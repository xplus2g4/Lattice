"""The claim/heartbeat/complete/fail API the Worker runs on (ADR 0003).

Enqueueing happens in the request's own transaction, so a Material and the job that cognifies
it are committed together or not at all.
"""

from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.base import utcnow
from lattice.db.models import Job

BACKOFF = timedelta(seconds=30)


async def enqueue(
    db: AsyncSession,
    *,
    kind: str,
    payload: dict[str, Any],
    dedupe_key: str | None = None,
) -> Job:
    """A repeated enqueue under the same key revives the existing job rather than adding one."""
    if dedupe_key is None:
        job = Job(kind=kind, payload_json=payload)
        db.add(job)
        await db.flush()
        return job

    statement = (
        insert(Job)
        .values(kind=kind, payload_json=payload, dedupe_key=dedupe_key)
        .on_conflict_do_update(
            index_elements=[Job.dedupe_key],
            set_={
                "payload_json": payload,
                "status": "pending",
                "run_after": utcnow(),
                "locked_by": None,
                "locked_at": None,
                "updated_at": utcnow(),
            },
        )
        .returning(Job)
        .execution_options(populate_existing=True)
    )
    return (await db.execute(statement)).scalar_one()


async def claim(db: AsyncSession, *, worker: str) -> Job | None:
    """One due job, locked against the other workers by `for update skip locked`."""
    due = (
        select(Job.id)
        .where(Job.status == "pending", Job.run_after <= utcnow())
        .order_by(Job.run_after)
        .limit(1)
        .with_for_update(skip_locked=True)
        .scalar_subquery()
    )
    claimed = (
        update(Job)
        .where(Job.id == due)
        .values(
            status="running",
            attempts=Job.attempts + 1,
            locked_by=worker,
            locked_at=utcnow(),
            updated_at=utcnow(),
        )
        .returning(Job)
        .execution_options(synchronize_session=False, populate_existing=True)
    )
    return (await db.execute(claimed)).scalar_one_or_none()


async def heartbeat(db: AsyncSession, job: Job) -> Job:
    """Says the holder is still alive, so `release_stale` leaves this job alone."""
    job.locked_at = utcnow()
    await db.flush()
    return job


async def complete(db: AsyncSession, job: Job) -> Job:
    job.status = "done"
    job.locked_by = None
    job.locked_at = None
    job.last_error = None
    await db.flush()
    return job


async def fail(db: AsyncSession, job: Job, *, error: str, max_attempts: int) -> Job:
    """Back off and try again until the attempts run out; then the job stays failed."""
    job.last_error = error[:2_000]
    job.locked_by = None
    job.locked_at = None
    if job.attempts >= max_attempts:
        job.status = "failed"
    else:
        job.status = "pending"
        job.run_after = utcnow() + BACKOFF * job.attempts
    await db.flush()
    return job


async def release_stale(db: AsyncSession, *, older_than: timedelta) -> list[Job]:
    """A worker that died mid-job holds its lock forever; this is how the job comes back."""
    released = (
        update(Job)
        .where(Job.status == "running", Job.locked_at < utcnow() - older_than)
        .values(status="pending", locked_by=None, locked_at=None, updated_at=utcnow())
        .returning(Job)
        .execution_options(synchronize_session=False, populate_existing=True)
    )
    return list((await db.execute(released)).scalars())


async def get(db: AsyncSession, job_id: UUID) -> Job | None:
    return await db.get(Job, job_id)


async def recent(db: AsyncSession, *, status: str | None = None, limit: int = 50) -> list[Job]:
    query = select(Job).order_by(Job.created_at.desc()).limit(limit)
    if status is not None:
        query = query.where(Job.status == status)
    return list(await db.scalars(query))
