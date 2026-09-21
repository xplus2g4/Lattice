"""The Worker: claim a job, run the ingest it names, record how it went."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from lattice.db.repo import jobs
from lattice.ingest import Ingest
from lattice.worker import Worker
from tests.test_ingest import a_material

pytestmark = pytest.mark.asyncio


def a_worker(sessionmaker: async_sessionmaker, engine, settings) -> Worker:
    return Worker(sessionmaker, Ingest(sessionmaker, engine, settings), settings)


async def test_an_ingest_job_cognifies_its_material(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    material = await a_material(session, tmp_path)
    job = await jobs.enqueue(
        session, kind="ingest_material", payload={"material_id": str(material.id)}
    )
    await session.commit()

    assert await a_worker(sessionmaker, engine, settings).run_once() is True

    await session.refresh(material)
    await session.refresh(job)
    assert material.status == "ready"
    assert engine.cognified == [str(tmp_path / "week1.pdf")]
    assert job.status == "done"
    assert job.locked_by is None


async def test_an_empty_queue_is_no_work(
    sessionmaker: async_sessionmaker, engine, settings
) -> None:
    assert await a_worker(sessionmaker, engine, settings).run_once() is False


async def test_a_cognify_failure_lands_on_the_material_not_the_queue(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    material = await a_material(session, tmp_path)
    job = await jobs.enqueue(
        session, kind="ingest_material", payload={"material_id": str(material.id)}
    )
    await session.commit()
    engine.fail_with = RuntimeError("cognee is down")

    await a_worker(sessionmaker, engine, settings).run_once()

    await session.refresh(job)
    await session.refresh(material)
    # The Ingest owns the Material's status, and #35 makes retrying the student's call; the
    # queue only retries what the Ingest could not record, like a database it cannot reach.
    assert material.status == "failed"
    assert material.error == "RuntimeError: cognee is down"
    assert job.status == "done"
    assert job.attempts == 1


async def test_an_unknown_kind_fails_the_job(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings
) -> None:
    job = await jobs.enqueue(session, kind="reindex_course", payload={"course": "cs3216"})
    await session.commit()
    settings.worker_max_attempts = 1

    await a_worker(sessionmaker, engine, settings).run_once()

    await session.refresh(job)
    assert job.status == "failed"
    assert job.last_error is not None
    assert "reindex_course" in job.last_error


async def test_a_job_naming_a_deleted_material_still_completes(
    session: AsyncSession, sessionmaker: async_sessionmaker, engine, settings, tmp_path
) -> None:
    material = await a_material(session, tmp_path)
    job = await jobs.enqueue(
        session, kind="ingest_material", payload={"material_id": str(material.id)}
    )
    await session.delete(material)
    await session.commit()

    await a_worker(sessionmaker, engine, settings).run_once()

    await session.refresh(job)
    assert job.status == "done"
    assert engine.cognified == []
