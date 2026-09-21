from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import Course, Material, Note, User


async def get(session: AsyncSession, note_id: UUID) -> Note | None:
    return await session.get(Note, note_id)


async def anchored(
    session: AsyncSession, *, user: User, material: Material, page: int
) -> Note | None:
    return await session.scalar(
        select(Note).where(
            Note.user_id == user.id, Note.material_id == material.id, Note.page == page
        )
    )


async def save(
    session: AsyncSession,
    *,
    user: User,
    course: Course,
    body_md: str,
    material: Material | None = None,
    page: int | None = None,
    note: Note | None = None,
) -> Note:
    """Edits `note` when given, else the page's Note (#38), else writes a new one (#37)."""
    if note is None and material is not None and page is not None:
        note = await anchored(session, user=user, material=material, page=page)
    if note is None:
        note = Note(
            user_id=user.id,
            course_id=course.id,
            material_id=None if material is None else material.id,
            page=page,
        )
        session.add(note)
    note.body_md = body_md
    note.status = "dirty"
    note.error = None
    await session.flush()
    return note


async def set_status(
    session: AsyncSession, note: Note, status: str, error: str | None = None
) -> Note:
    note.status = status
    note.error = error
    await session.flush()
    return note


async def for_course(
    session: AsyncSession, *, user: User, course: Course, material: Material | None = None
) -> list[Note]:
    """Only ever the caller's own: a Note is private to its author."""
    query = select(Note).where(Note.user_id == user.id, Note.course_id == course.id)
    if material is not None:
        query = query.where(Note.material_id == material.id)
    return list(await session.scalars(query.order_by(Note.page, Note.created_at)))


async def remove(session: AsyncSession, note: Note) -> None:
    await session.delete(note)
    await session.flush()
