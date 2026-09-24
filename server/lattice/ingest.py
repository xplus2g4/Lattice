"""Cognifying a Material or a Note, and recording how it went.

Runs outside the request that queued it, so it opens its own session: the caller's
transaction is long gone by the time Cognee returns. Phase 7 replaces the background task
with a job the Worker claims; the body below moves across unchanged.
"""

import asyncio
from datetime import timedelta
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from lattice.config import Settings
from lattice.db.base import utcnow
from lattice.db.models import Note
from lattice.db.repo import materials, notes
from lattice.engine import Engine


class Ingest:
    def __init__(
        self, sessionmaker: async_sessionmaker, engine: Engine, settings: Settings
    ) -> None:
        self.sessionmaker = sessionmaker
        self.engine = engine
        self.settings = settings
        self._note_lock = asyncio.Lock()

    async def material(self, material_id: UUID) -> None:
        async with self.sessionmaker() as session:
            material = await materials.get(session, material_id)
            if material is None:
                return
            path = Path(material.storage_uri)
            await materials.set_status(session, material, "cognifying")
            await session.commit()

            try:
                dataset = await self.engine.global_dataset(material.course.code)
                await self.engine.replace(dataset, await self.engine.instructor(), path.resolve())
            except Exception as exc:  # noqa: BLE001 - surfaced to the client as status=failed
                await materials.set_status(
                    session, material, "failed", f"{type(exc).__name__}: {exc}"
                )
            else:
                await materials.set_status(session, material, "ready")
            await session.commit()

    async def recover_notes(self) -> None:
        async with self.sessionmaker() as session:
            await session.execute(
                update(Note)
                .where(Note.status == "indexing")
                .values(
                    status="dirty",
                    run_after=utcnow(),
                    ingest_attempts=func.greatest(Note.ingest_attempts - 1, 0),
                )
            )
            await session.commit()

    async def cognify_pending(self) -> bool:
        async with self.sessionmaker() as session:
            note_id = await notes.pending(session)
        if note_id is None:
            return False
        await self.note(note_id)
        return True

    async def note(self, note_id: UUID) -> None:
        """Into the author's private Dataset only, never the course's global one (#39)."""
        async with self._note_lock:
            async with self.sessionmaker() as session:
                note = await session.scalar(
                    select(Note).where(Note.id == note_id).with_for_update()
                )
                if (
                    note is None
                    or note.status not in {"dirty", "failed"}
                    or note.user.notes_opt_out
                    or note.ingest_attempts >= 3
                    or (note.run_after is not None and note.run_after > utcnow())
                ):
                    return
                course, body, revision = note.course.code, note.body_md, note.revision
                storage_uri = note.storage_uri
                owner = note.user.email
                note.ingest_attempts += 1
                await notes.set_status(session, note, "indexing")
                await session.commit()

            error = None
            try:
                principal = await self.engine.principal(owner)
                _, private = await self.engine.enrol(course, principal)
                if storage_uri is not None:
                    # A PDF Note: hand the stored file to the engine's own loader. The name
                    # is <sha256>.pdf, so a re-cognify replaces rather than duplicates.
                    await self.engine.replace(private, principal, Path(storage_uri).resolve())
                else:
                    path = self._note_path(course, note_id, principal.id)
                    path.write_text(body, encoding="utf-8")
                    if body.strip():
                        await self.engine.replace(private, principal, path.resolve())
                    else:
                        await self.engine.clear(private, principal, path.name)
            except Exception as exc:  # noqa: BLE001 - surfaced to the client as status=failed
                error = f"{type(exc).__name__}: {exc}"

            async with self.sessionmaker() as session:
                values = {
                    "status": "ready" if error is None else "failed",
                    "error": error,
                    "run_after": None
                    if error is None
                    else utcnow() + timedelta(seconds=30 * note.ingest_attempts),
                }
                if error is None:
                    values["cognified_revision"] = revision
                await session.execute(
                    update(Note)
                    .where(Note.id == note_id, Note.revision == revision)
                    .values(**values)
                )
                await session.commit()

    def _note_path(self, course: str, note_id: UUID, principal_id: UUID) -> Path:
        path = self.settings.uploads_dir / course / "notes" / str(principal_id) / f"{note_id}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path
