from datetime import timedelta
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.base import utcnow
from lattice.db.models import Course, Material, Note, User


class RevisionConflict(ValueError):
    pass


async def get(session: AsyncSession, note_id: UUID) -> Note | None:
    return await session.get(Note, note_id)


async def anchored(
    session: AsyncSession, *, user: User, material: Material, page: int
) -> Note | None:
    return await session.scalar(
        select(Note)
        .where(Note.user_id == user.id, Note.material_id == material.id, Note.page == page)
        .execution_options(populate_existing=True)
    )


async def save(
    session: AsyncSession,
    *,
    user: User,
    course: Course,
    body_md: str,
    title: str | None = None,
    material: Material | None = None,
    page: int | None = None,
    note: Note | None = None,
    expected_revision: int | None = None,
    delay_seconds: float = 5,
) -> Note:
    """Edits `note` when given, else the page's Note (#38), else writes a new one (#37)."""
    if material is not None:
        if material.course_id != course.id:
            raise ValueError("material belongs to another course")
        if page is not None and (page < 1 or (material.page_count and page > material.page_count)):
            raise ValueError("page does not exist in this material")
        await session.execute(
            select(Material.id).where(Material.id == material.id).with_for_update()
        )
    if note is None and material is not None and page is not None:
        note = await anchored(session, user=user, material=material, page=page)
    if note is not None:
        note = await session.scalar(
            select(Note)
            .where(Note.id == note.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if note.user_id != user.id or note.course_id != course.id:
            raise ValueError("note belongs to another course or user")
        if material is not None and note.material_id != material.id:
            raise ValueError("note belongs to another material")
        if page is not None and note.page != page:
            raise ValueError("note belongs to another page")
        if note.body_md == body_md and note.status != "failed":
            if title is not None:
                note.title = title
                await session.flush()
            return note
    current_revision = 0 if note is None else note.revision
    if expected_revision is not None and expected_revision != current_revision:
        raise RevisionConflict("Note changed; read its current revision before editing")
    if note is None:
        note = Note(
            user_id=user.id,
            course_id=course.id,
            material_id=None if material is None else material.id,
            page=page,
            revision=1,
        )
        session.add(note)
    elif note.body_md != body_md:
        note.revision += 1
    note.body_md = body_md
    if title is not None:
        note.title = title
    note.status = "dirty"
    note.error = None
    note.ingest_attempts = 0
    note.run_after = utcnow() + timedelta(seconds=delay_seconds)
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


async def pending(session: AsyncSession) -> UUID | None:
    return await session.scalar(
        select(Note.id)
        .join(User, User.id == Note.user_id)
        .where(
            Note.status.in_(["dirty", "failed"]),
            Note.ingest_attempts < 3,
            User.notes_opt_out.is_(False),
            or_(Note.run_after.is_(None), Note.run_after <= utcnow()),
        )
        .order_by(Note.updated_at)
        .limit(1)
    )


async def remove(session: AsyncSession, note: Note) -> None:
    await session.delete(note)
    await session.flush()
