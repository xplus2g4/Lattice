from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.base import utcnow
from lattice.db.models import Course, CourseSummary

# MAGIC NUMBER (2026-09-24): a guess, not a measurement. The lowest cosine similarity at
# which another course still counts as related. text-embedding-3-small packs most pairs of
# texts well above zero, and mean-pooled course vectors sit closer together still, so 0.75 is
# meant to keep a data-structures course away from a poetry course while letting two CS
# courses through. Revisit with a real course set (docs/benchmarks template) before trusting it.
MIN_SIMILARITY = 0.75


async def get(session: AsyncSession, course: Course) -> CourseSummary | None:
    return await session.get(CourseSummary, course.id)


async def upsert(
    session: AsyncSession,
    course: Course,
    *,
    summary_text: str,
    embedding: list[float],
    embedding_model: str,
    source_digest: str,
) -> CourseSummary:
    """One row per course; a refresh overwrites the previous summary in place."""
    values = {
        "summary_text": summary_text,
        "embedding": embedding,
        "embedding_model": embedding_model,
        "source_digest": source_digest,
        "refreshed_at": utcnow(),
    }
    statement = (
        insert(CourseSummary)
        .values(course_id=course.id, **values)
        .on_conflict_do_update(index_elements=[CourseSummary.course_id], set_=values)
        .returning(CourseSummary)
    )
    return (await session.execute(statement)).scalar_one()


async def remove(session: AsyncSession, course: Course) -> None:
    await session.execute(delete(CourseSummary).where(CourseSummary.course_id == course.id))


async def nearest(session: AsyncSession, course: Course, k: int) -> list[Course]:
    """The `k` other courses whose summary is closest to this one's by cosine distance and
    at least `MIN_SIMILARITY` similar, so a lone unrelated course is not dragged in.

    Empty when this course has no summary yet. Courses number in the tens, so the scan is
    exact and unindexed; ties break on code for a stable order.
    """
    if k <= 0 or await get(session, course) is None:
        return []
    mine = (
        select(CourseSummary.embedding)
        .where(CourseSummary.course_id == course.id)
        .scalar_subquery()
    )
    distance = CourseSummary.embedding.cosine_distance(mine)
    rows = await session.scalars(
        select(Course)
        .join(CourseSummary, CourseSummary.course_id == Course.id)
        .where(Course.id != course.id, distance <= 1 - MIN_SIMILARITY)
        .order_by(distance, Course.code)
        .limit(k)
    )
    return list(rows)
