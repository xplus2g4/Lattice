"""Cognifying a Material or a Note, and recording how it went.

Runs outside the request that queued it, so it opens its own session: the caller's
transaction is long gone by the time Cognee returns. Phase 7 replaces the background task
with a job the Worker claims; the body below moves across unchanged.
"""

from pathlib import Path
from uuid import UUID

from sqlalchemy.ext.asyncio import async_sessionmaker

from lattice.config import Settings
from lattice.db.repo import materials, notes
from lattice.engine import Engine


class Ingest:
    def __init__(
        self, sessionmaker: async_sessionmaker, engine: Engine, settings: Settings
    ) -> None:
        self.sessionmaker = sessionmaker
        self.engine = engine
        self.settings = settings

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

    async def note(self, note_id: UUID) -> None:
        """Into the author's private Dataset only, never the course's global one (#39)."""
        async with self.sessionmaker() as session:
            note = await notes.get(session, note_id)
            if note is None:
                return
            course, body = note.course.code, note.body_md
            await notes.set_status(session, note, "indexing")
            await session.commit()

            try:
                principal = await self.engine.principal(note.user.email)
                path = self._note_path(course, note_id, principal.id)
                path.write_text(body)
                _, private = await self.engine.enrol(course, principal)
                await self.engine.replace(private, principal, path.resolve())
            except Exception as exc:  # noqa: BLE001 - surfaced to the client as status=failed
                await notes.set_status(session, note, "failed", f"{type(exc).__name__}: {exc}")
            else:
                await notes.set_status(session, note, "ready")
            await session.commit()

    def _note_path(self, course: str, note_id: UUID, principal_id: UUID) -> Path:
        path = self.settings.uploads_dir / course / "notes" / str(principal_id) / f"{note_id}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path
