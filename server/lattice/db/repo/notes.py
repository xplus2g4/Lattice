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


async def by_sha256(
    session: AsyncSession, *, user: User, course: Course, sha256: str
) -> Note | None:
    return await session.scalar(
        select(Note).where(
            Note.user_id == user.id, Note.course_id == course.id, Note.sha256 == sha256
        )
    )


async def add_file(
    session: AsyncSession,
    *,
    user: User,
    course: Course,
    filename: str,
    sha256: str,
    storage_uri: str,
) -> Note:
    """A Note that is a stored PDF: nothing is being typed, so no debounce delay."""
    note = Note(
        user_id=user.id,
        course_id=course.id,
        body_md="",
        filename=filename,
        sha256=sha256,
        storage_uri=storage_uri,
        revision=1,
        status="dirty",
    )
    session.add(note)
    await session.flush()
    return note


async def save(
    session: AsyncSession,
    *,
    user: User,
    course: Course,
    body_md: str,
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
        if note.storage_uri is not None:
            raise ValueError("a PDF Note has no editable body")
        if note.user_id != user.id or note.course_id != course.id:
            raise ValueError("note belongs to another course or user")
        if material is not None and note.material_id != material.id:
            raise ValueError("note belongs to another material")
        if page is not None and note.page != page:
            raise ValueError("note belongs to another page")
        if note.body_md == body_md and note.status != "failed":
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
