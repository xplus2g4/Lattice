"""Cognifying a Material, and recording how it went.

Runs outside the request that queued it, so it opens its own session: the caller's
transaction is long gone by the time Cognee returns. Phase 7 replaces the background task
with a job the Worker claims; the body below moves across unchanged.
"""

from pathlib import Path
from uuid import UUID

from sqlalchemy.ext.asyncio import async_sessionmaker

from lattice.db.repo import materials
from lattice.engine import Engine


class Ingest:
    def __init__(self, sessionmaker: async_sessionmaker, engine: Engine) -> None:
        self.sessionmaker = sessionmaker
        self.engine = engine

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
