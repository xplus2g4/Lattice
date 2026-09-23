from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.base import utcnow
from lattice.db.models import Course, Feedback, Session, Turn, User


async def get(db: AsyncSession, session_id: UUID) -> Session | None:
    return await db.get(Session, session_id)


async def create(db: AsyncSession, *, user: User, course: Course) -> Session:
    session = Session(user_id=user.id, course_id=course.id)
    db.add(session)
    await db.flush()
    return session


async def for_course(db: AsyncSession, *, user: User, course: Course) -> list[Session]:
    return list(
        await db.scalars(
            select(Session)
            .where(Session.user_id == user.id, Session.course_id == course.id)
            .order_by(Session.last_turn_at.desc())
        )
    )


async def for_course_all_users(
    db: AsyncSession, *, course: Course
) -> list[tuple[Session, str]]:
    """Every Session in a course, each with its owner's email. Admin reads only."""
    rows = await db.execute(
        select(Session, User.email)
        .join(User, User.id == Session.user_id)
        .where(Session.course_id == course.id)
        .order_by(Session.last_turn_at.desc())
    )
    return [(session, email) for session, email in rows]


async def add_turn(
    db: AsyncSession,
    session: Session,
    *,
    role: str,
    content: dict[str, Any],
    cited_chunk_ids: list[str] | None = None,
    used_notes: bool = False,
    latency_ms: int | None = None,
) -> Turn:
    turn = Turn(
        session_id=session.id,
        role=role,
        content_json=content,
        cited_chunk_ids=cited_chunk_ids or [],
        used_notes=used_notes,
        latency_ms=latency_ms,
    )
    db.add(turn)
    session.last_turn_at = utcnow()
    await db.flush()
    return turn


async def turn(db: AsyncSession, turn_id: UUID) -> Turn | None:
    return await db.get(Turn, turn_id)


async def rate(
    db: AsyncSession, *, turn: Turn, user: User, rating: int, comment: str | None
) -> Feedback:
    """One rating per student per Turn; changing your mind overwrites it."""
    statement = (
        insert(Feedback)
        .values(turn_id=turn.id, user_id=user.id, rating=rating, comment=comment)
        .on_conflict_do_update(
            index_elements=[Feedback.turn_id, Feedback.user_id],
            set_={"rating": rating, "comment": comment},
        )
        .returning(Feedback)
    )
    return (await db.execute(statement)).scalar_one()
