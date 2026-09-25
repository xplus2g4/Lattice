"""The ingest queues as the watchdog sees them: how deep, and how old their oldest item is.

Materials queue on their status alone. Notes only count while the ingest loop would still
pick them up: a `dirty` Note past its retry cap, waiting out a back-off, or belonging to a
student who opted out is not queued, it is finished or parked, and must not read as a stuck
queue. A Note that is `indexing` is in flight whatever its attempt count.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.base import utcnow
from lattice.db.models import Material, Note, User

MATERIAL_QUEUE = ("queued", "converting", "cognifying")
NOTE_QUEUE = ("dirty", "indexing")
NOTE_MAX_ATTEMPTS = 3


@dataclass(frozen=True, slots=True)
class Queue:
    """`depth` has one entry per queue status, zero included; `oldest` is the earliest
    `updated_at` still queued, None when the queue is empty."""

    depth: dict[str, int]
    oldest: datetime | None


def _queue(statuses: tuple[str, ...], rows: list) -> Queue:
    depth = dict.fromkeys(statuses, 0)
    oldest = None
    for status, count, first in rows:
        depth[status] = count
        if oldest is None or first < oldest:
            oldest = first
    return Queue(depth, oldest)


async def material_queue(session: AsyncSession) -> Queue:
    rows = await session.execute(
        select(Material.status, func.count(), func.min(Material.updated_at))
        .where(Material.status.in_(MATERIAL_QUEUE))
        .group_by(Material.status)
    )
    return _queue(MATERIAL_QUEUE, list(rows))


async def note_queue(session: AsyncSession) -> Queue:
    eligible_dirty = and_(
        Note.status == "dirty",
        Note.ingest_attempts < NOTE_MAX_ATTEMPTS,
        User.notes_opt_out.is_(False),
        or_(Note.run_after.is_(None), Note.run_after <= utcnow()),
    )
    rows = await session.execute(
        select(Note.status, func.count(), func.min(Note.updated_at))
        .join(User, User.id == Note.user_id)
        .where(or_(Note.status == "indexing", eligible_dirty))
        .group_by(Note.status)
    )
    return _queue(NOTE_QUEUE, list(rows))
