from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import Course, Enrolment, Material, Note, User

PENDING_STATUSES = ("queued", "converting", "cognifying")


async def by_code(session: AsyncSession, code: str) -> Course | None:
    return await session.scalar(select(Course).where(Course.code == code))


async def create(
    session: AsyncSession, *, code: str, name: str, term: str | None, owner: User
) -> Course:
    course = Course(
        code=code,
        name=name,
        term=term,
        owner_user_id=owner.id,
        global_dataset_name=f"{code}-global",
    )
    session.add(course)
    await session.flush()
    return course


async def update(
    session: AsyncSession, course: Course, *, name: str | None, term: str | None
) -> Course:
    if name is not None:
        course.name = name
    if term is not None:
        course.term = term
    await session.flush()
    return course


async def search(session: AsyncSession, user: User, query: str) -> list[tuple[Course, bool]]:
    """Exact code or substring title, each result carrying the caller's enrolment state."""
    enrolled = select(Enrolment.course_id).where(Enrolment.user_id == user.id).scalar_subquery()
    rows = await session.execute(
        select(Course, Course.id.in_(enrolled))
        .where(or_(Course.code == query.lower(), Course.name.ilike(f"%{query}%")))
        .order_by(Course.code)
    )
    return [(course, bool(is_enrolled)) for course, is_enrolled in rows]


async def enrolled_courses(session: AsyncSession, user: User) -> list[Course]:
    return list(
        await session.scalars(
            select(Course)
            .join(Enrolment, Enrolment.course_id == Course.id)
            .where(Enrolment.user_id == user.id)
            .order_by(Course.code)
        )
    )


async def summaries(session: AsyncSession, user: User) -> list[tuple[Course, int, int, int]]:
    """Each enrolled course with its material count, the caller's note count, and
    how many materials are still mid-ingest — what the home screen's cards show."""
    enrolled = await enrolled_courses(session, user)
    ids = [course.id for course in enrolled]
    if not ids:
        return []
    material_rows = (
        await session.execute(
            select(
                Material.course_id,
                func.count(),
                func.count().filter(Material.status.in_(PENDING_STATUSES)),
            )
            .where(Material.course_id.in_(ids))
            .group_by(Material.course_id)
        )
    ).all()
    material_counts = {course_id: (total, pending) for course_id, total, pending in material_rows}
    note_rows = (
        await session.execute(
            select(Note.course_id, func.count())
            .where(Note.user_id == user.id, Note.course_id.in_(ids))
            .group_by(Note.course_id)
        )
    ).all()
    note_counts = {course_id: count for course_id, count in note_rows}
    return [
        (course, *material_counts.get(course.id, (0, 0)), note_counts.get(course.id, 0))
        for course in enrolled
    ]


async def enrolment(session: AsyncSession, user_id: UUID, course_id: UUID) -> Enrolment | None:
    return await session.get(Enrolment, (user_id, course_id))


async def enrol(
    session: AsyncSession, *, user: User, course: Course, user_dataset_name: str
) -> Enrolment:
    """Idempotent: a second join returns the existing row rather than raising."""
    existing = await enrolment(session, user.id, course.id)
    if existing is not None:
        return existing
    row = Enrolment(user_id=user.id, course_id=course.id, user_dataset_name=user_dataset_name)
    session.add(row)
    await session.flush()
    return row


async def unenrol(session: AsyncSession, user: User, course: Course) -> bool:
    row = await enrolment(session, user.id, course.id)
    if row is None:
        return False
    await session.delete(row)
    await session.flush()
    return True


async def roster(session: AsyncSession, course: Course) -> list[User]:
    return list(
        await session.scalars(
            select(User)
            .join(Enrolment, Enrolment.user_id == User.id)
            .where(Enrolment.course_id == course.id)
            .order_by(User.email)
        )
    )


async def enrolment_count(session: AsyncSession, course: Course) -> int:
    return await session.scalar(
        select(func.count()).select_from(Enrolment).where(Enrolment.course_id == course.id)
    )
