"""The queue-consuming process: claim a job, run it, record how it went (ADR 0003).

Same codebase as the API, never serves HTTP. Run it with `python -m lattice.worker`.
"""

import asyncio
import logging
import os
import socket
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import async_sessionmaker

from lattice.config import Settings, get_settings
from lattice.db import Database
from lattice.db.models import Job
from lattice.db.repo import jobs
from lattice.engine import Engine
from lattice.ingest import Ingest

log = logging.getLogger("lattice.worker")


class Worker:
    def __init__(
        self, sessionmaker: async_sessionmaker, ingest: Ingest, settings: Settings
    ) -> None:
        self.sessionmaker = sessionmaker
        self.ingest = ingest
        self.settings = settings
        self.name = f"{socket.gethostname()}:{os.getpid()}"

    async def run_forever(self) -> None:
        while True:
            if not await self.run_once():
                await asyncio.sleep(self.settings.worker_poll_seconds)

    async def run_once(self) -> bool:
        """Claim and run one job. False when the queue had nothing due."""
        await self.release_stale()
        async with self.sessionmaker() as session:
            job = await jobs.claim(session, worker=self.name)
            await session.commit()
        if job is None:
            return False

        try:
            await self.perform(job)
        except Exception as exc:  # noqa: BLE001 - recorded on the job, then retried
            log.exception("job %s failed", job.id)
            await self._finish(job, error=f"{type(exc).__name__}: {exc}")
        else:
            await self._finish(job, error=None)
        return True

    async def perform(self, job: Job) -> None:
        """What each kind of job means. Unknown kinds fail loudly rather than vanish."""
        payload = job.payload_json
        match job.kind:
            case "ingest_material":
                await self.ingest.material(UUID(payload["material_id"]))
            case "index_note":
                await self.ingest.note(UUID(payload["note_id"]))
            case _:
                raise NotImplementedError(f"no handler for {job.kind}")

    async def release_stale(self) -> list[Job]:
        async with self.sessionmaker() as session:
            released = await jobs.release_stale(
                session, older_than=timedelta(seconds=self.settings.worker_lock_ttl_seconds)
            )
            await session.commit()
            return released

    async def _finish(self, job: Job, *, error: str | None) -> None:
        async with self.sessionmaker() as session:
            row = await jobs.get(session, job.id)
            if row is None:
                return
            if error is None:
                await jobs.complete(session, row)
            else:
                await jobs.fail(
                    session, row, error=error, max_attempts=self.settings.worker_max_attempts
                )
            await session.commit()


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    engine = Engine(settings)
    await engine.start()
    database = Database(settings)
    ingest = Ingest(database.sessionmaker, engine, settings)
    worker = Worker(database.sessionmaker, ingest, settings)
    log.info("worker %s polling every %ss", worker.name, settings.worker_poll_seconds)
    try:
        await worker.run_forever()
    finally:
        await database.dispose()


if __name__ == "__main__":
    asyncio.run(main())
