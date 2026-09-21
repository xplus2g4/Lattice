"""The Postgres queue: enqueue, dedupe, claim, heartbeat, retry and stale-lock recovery."""

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from lattice.db.base import utcnow
from lattice.db.models import Job
from lattice.db.repo import jobs, users

pytestmark = pytest.mark.asyncio


async def test_enqueue_persists_a_pending_job(session: AsyncSession) -> None:
    job = await jobs.enqueue(session, kind="ingest_material", payload={"material_id": "x"})

    assert job.status == "pending"
    assert job.attempts == 0
    assert job.payload_json == {"material_id": "x"}


async def test_the_same_key_enqueues_once(session: AsyncSession) -> None:
    first = await jobs.enqueue(
        session, kind="index_note", payload={"note_id": "a"}, dedupe_key="index_note:a"
    )
    second = await jobs.enqueue(
        session, kind="index_note", payload={"note_id": "a"}, dedupe_key="index_note:a"
    )

    assert second.id == first.id
    assert len(list(await session.scalars(select(Job)))) == 1


async def test_a_finished_job_is_revived_by_the_same_key(session: AsyncSession) -> None:
    """A Note edited after its indexing finished has to be cognified again."""
    job = await jobs.enqueue(
        session, kind="index_note", payload={"note_id": "a"}, dedupe_key="index_note:a"
    )
    await jobs.claim(session, worker="w1")
    await session.refresh(job)
    await jobs.complete(session, job)

    again = await jobs.enqueue(
        session, kind="index_note", payload={"note_id": "a"}, dedupe_key="index_note:a"
    )
    assert again.id == job.id
    assert again.status == "pending"


async def test_claiming_marks_the_job_running(session: AsyncSession) -> None:
    await jobs.enqueue(session, kind="index_note", payload={"note_id": "a"})

    claimed = await jobs.claim(session, worker="w1")
    assert claimed is not None
    assert claimed.status == "running"
    assert claimed.attempts == 1
    assert claimed.locked_by == "w1"
    assert claimed.locked_at is not None


async def test_an_empty_queue_claims_nothing(session: AsyncSession) -> None:
    assert await jobs.claim(session, worker="w1") is None


async def test_a_job_scheduled_for_later_is_not_due(session: AsyncSession) -> None:
    job = await jobs.enqueue(session, kind="index_note", payload={"note_id": "a"})
    job.run_after = utcnow() + timedelta(minutes=5)
    await session.flush()

    assert await jobs.claim(session, worker="w1") is None


async def test_two_workers_never_claim_the_same_job(migrated_database: str) -> None:
    """`for update skip locked` is the whole point: the second worker moves on (ADR 0003)."""
    engine = create_async_engine(migrated_database)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as setup:
            await jobs.enqueue(setup, kind="index_note", payload={"note_id": "only-one"})
            await setup.commit()

        async with maker() as first, maker() as second:
            # First worker holds its transaction open while the second one looks.
            claimed = await jobs.claim(first, worker="w1")
            missed = await jobs.claim(second, worker="w2")
            await first.commit()
            await second.commit()

        assert claimed is not None
        assert missed is None
    finally:
        async with maker() as cleanup:
            await cleanup.execute(delete(Job))
            await cleanup.commit()
        await engine.dispose()


async def test_heartbeat_keeps_the_lock_fresh(session: AsyncSession) -> None:
    await jobs.enqueue(session, kind="index_note", payload={"note_id": "a"})
    job = await jobs.claim(session, worker="w1")
    assert job is not None
    job.locked_at = utcnow() - timedelta(hours=1)
    await session.flush()

    await jobs.heartbeat(session, job)
    assert await jobs.release_stale(session, older_than=timedelta(minutes=5)) == []


async def test_completing_clears_the_lock(session: AsyncSession) -> None:
    await jobs.enqueue(session, kind="index_note", payload={"note_id": "a"})
    job = await jobs.claim(session, worker="w1")
    assert job is not None

    done = await jobs.complete(session, job)
    assert done.status == "done"
    assert done.locked_by is None
    assert done.locked_at is None


async def test_failing_retries_until_the_attempts_run_out(session: AsyncSession) -> None:
    await jobs.enqueue(session, kind="index_note", payload={"note_id": "a"})

    job = await jobs.claim(session, worker="w1")
    assert job is not None
    await jobs.fail(session, job, error="RuntimeError: boom", max_attempts=2)
    assert job.status == "pending"
    assert job.last_error == "RuntimeError: boom"
    assert job.run_after > utcnow()

    job.run_after = utcnow()
    await session.flush()
    again = await jobs.claim(session, worker="w1")
    assert again is not None
    await jobs.fail(session, again, error="RuntimeError: boom", max_attempts=2)
    assert again.status == "failed"
    assert again.attempts == 2


async def test_a_dead_workers_job_comes_back(session: AsyncSession) -> None:
    await jobs.enqueue(session, kind="index_note", payload={"note_id": "a"})
    job = await jobs.claim(session, worker="w1")
    assert job is not None
    job.locked_at = utcnow() - timedelta(hours=1)
    await session.flush()

    released = await jobs.release_stale(session, older_than=timedelta(minutes=5))
    assert [row.id for row in released] == [job.id]
    assert await jobs.claim(session, worker="w2") is not None


async def test_jobs_are_not_writable_over_http(student: AsyncClient) -> None:
    for path in ("/jobs.create", "/jobs.claim", "/jobs.delete"):
        assert (await student.post(path, json={})).status_code == 404


async def test_listing_jobs_is_for_admins_only(student: AsyncClient, session: AsyncSession) -> None:
    await jobs.enqueue(session, kind="index_note", payload={"note_id": "a"})
    await session.commit()

    assert (await student.get("/jobs.list")).status_code == 403


async def test_an_admin_sees_the_queue(student: AsyncClient, session: AsyncSession) -> None:
    await jobs.enqueue(session, kind="index_note", payload={"note_id": "a"})
    caller = await users.get_or_create(session, email="ada@example.com")
    caller.role = "admin"
    await session.commit()

    listed = await student.get("/jobs.list")
    assert listed.status_code == 200
    assert [job["kind"] for job in listed.json()] == ["index_note"]

    filtered = await student.get("/jobs.list", params={"status": "done"})
    assert filtered.json() == []
