"""Cognifying a Material or a Note, and recording how it went.

Runs outside the request that queued it, so it opens its own session: the caller's
transaction is long gone by the time Cognee returns. Phase 7 replaces the background task
with a job the Worker claims; the body below moves across unchanged.
"""

import asyncio
import time
from datetime import timedelta
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lattice import telemetry
from lattice.config import Settings
from lattice.db.base import utcnow
from lattice.db.models import Material, Note
from lattice.db.repo import materials, notes, product_events
from lattice.engine import Engine
from lattice.spend import Attribution, CeilingReached, check_ceiling, collect

MAX_NOTE_ATTEMPTS = 3


class Ingest:
    def __init__(
        self, sessionmaker: async_sessionmaker, engine: Engine, settings: Settings
    ) -> None:
        self.sessionmaker = sessionmaker
        self.engine = engine
        self.settings = settings
        self._note_lock = asyncio.Lock()

    async def material(self, material_id: UUID, chunk_size: int | None = None) -> None:
        """Cognify one Material into the course's global Dataset. Under the Ceiling it fails
        without touching the engine; the instructor retries after the reset. The Spend is
        the course's: no Principal, this Material."""
        # Wait for the engine before opening a session or claiming "cognifying": while another
        # file has the turn this one is still queued, and holds no connection from the pool.
        async with self.engine.turn:
            async with self.sessionmaker() as session:
                material = await materials.get(session, material_id)
                if material is None:
                    return
                try:
                    await check_ceiling(session, self.settings)
                except CeilingReached as exc:
                    await self._finish_material(
                        session,
                        material,
                        f"Ceiling reached; retry after {exc.reset_at.isoformat()}",
                    )
                    await session.commit()
                    return
                path = Path(material.storage_uri)
                await materials.set_status(session, material, "cognifying")
                await session.commit()

                code = material.course.code
                attribution = Attribution(
                    user_id=None,
                    course_id=material.course_id,
                    material_id=material.id,
                    course_code=code,
                )
                started = time.monotonic()
                try:
                    dataset = await self.engine.global_dataset(code)
                    instructor = await self.engine.instructor()
                    async with collect(self.sessionmaker, attribution):
                        await self.engine.replace(dataset, instructor, path.resolve(), chunk_size)
                except Exception as exc:  # noqa: BLE001 - surfaced to the client as status=failed
                    error = f"{type(exc).__name__}: {exc}"
                else:
                    error = None
                telemetry.COGNIFY_DURATION.labels(course=code, kind="material").observe(
                    time.monotonic() - started
                )
                await self._finish_material(session, material, error)
                await session.commit()

    async def recover_materials(self) -> list[UUID]:
        """Materials the last process left queued or cognifying: their background task died
        with it. Re-queued here, in upload order, and handed back for start-up to schedule."""
        async with self.sessionmaker() as session:
            ids = list(
                await session.scalars(
                    select(Material.id)
                    .where(Material.status.in_(("queued", "cognifying")))
                    .order_by(Material.created_at)
                )
            )
            if ids:
                await session.execute(
                    update(Material).where(Material.id.in_(ids)).values(status="queued", error=None)
                )
            await session.commit()
        return ids

    async def _finish_material(
        self, session: AsyncSession, material: Material, error: str | None
    ) -> None:
        """Set the terminal status and record the outcome, in Telemetry and as the
        uploader's Product event, inside the same transaction."""
        outcome = "ready" if error is None else "failed"
        await materials.set_status(session, material, outcome, error)
        telemetry.COGNIFY_OUTCOME.labels(
            course=material.course.code, kind="material", outcome=outcome
        ).inc()
        await product_events.record(
            session,
            user_id=material.created_by,
            course_id=material.course_id,
            name=f"material.{outcome}",
            # No attempt counter on Material yet: every run is the first.
            properties={"material_id": str(material.id), "attempts": 1},
        )

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
        """Cognify the next dirty Note; False when there is none or the Ceiling is reached
        (the Note stays dirty, no attempt consumed), so the loop sleeps."""
        async with self.sessionmaker() as session:
            note_id = await notes.pending(session)
            if note_id is None:
                return False
            try:
                await check_ceiling(session, self.settings)
            except CeilingReached:
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
                    or note.ingest_attempts >= MAX_NOTE_ATTEMPTS
                    or (note.run_after is not None and note.run_after > utcnow())
                ):
                    return
                course, body, revision = note.course.code, note.body_md, note.revision
                storage_uri = note.storage_uri
                owner = note.user.email
                note.ingest_attempts += 1
                await notes.set_status(session, note, "indexing")
                await session.commit()
            attempts = note.ingest_attempts
            attribution = Attribution(
                user_id=note.user_id, course_id=note.course_id, note_id=note_id, course_code=course
            )
            error = None
            started = time.monotonic()
            try:
                async with self.engine.turn:
                    principal = await self.engine.principal(owner)
                    _, private = await self.engine.enrol(course, principal)
                    async with collect(self.sessionmaker, attribution):
                        if storage_uri is not None:
                            # A PDF Note: hand the stored file to the engine's own loader. The
                            # name is <sha256>.pdf, so a re-cognify replaces rather than
                            # duplicates.
                            await self.engine.replace(
                                private, principal, Path(storage_uri).resolve()
                            )
                        else:
                            path = self._note_path(course, note_id, principal.id)
                            path.write_text(body, encoding="utf-8")
                            if body.strip():
                                await self.engine.replace(private, principal, path.resolve())
                            else:
                                await self.engine.clear(private, principal, path.name)
            except Exception as exc:  # noqa: BLE001 - surfaced to the client as status=failed
                error = f"{type(exc).__name__}: {exc}"
            telemetry.COGNIFY_DURATION.labels(course=course, kind="note").observe(
                time.monotonic() - started
            )
            if error is None:
                outcome = "ready"
            elif attempts < MAX_NOTE_ATTEMPTS:
                outcome = "retried"
            else:
                outcome = "failed"
            telemetry.COGNIFY_OUTCOME.labels(course=course, kind="note", outcome=outcome).inc()

            async with self.sessionmaker() as session:
                values = {
                    "status": "ready" if error is None else "failed",
                    "error": error,
                    "run_after": None
                    if error is None
                    else utcnow() + timedelta(seconds=30 * attempts),
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
