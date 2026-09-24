from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.base import utcnow
from lattice.db.models import Course, Material, ReadingPosition, Topic, User


async def by_sha256(session: AsyncSession, course: Course, sha256: str) -> Material | None:
    return await session.scalar(
        select(Material).where(Material.course_id == course.id, Material.sha256 == sha256)
    )


async def by_filename(session: AsyncSession, course: Course, filename: str) -> Material | None:
    """The newest Material under a filename — a re-upload keeps the earlier row."""
    return await session.scalar(
        select(Material)
        .where(Material.course_id == course.id, Material.filename == filename)
        .order_by(Material.created_at.desc())
        .limit(1)
    )


async def get(session: AsyncSession, material_id: UUID) -> Material | None:
    return await session.get(Material, material_id)


async def create(
    session: AsyncSession,
    *,
    course: Course,
    uploader: User,
    title: str,
    filename: str,
    storage_uri: str,
    sha256: str,
) -> Material:
    material = Material(
        course_id=course.id,
        created_by=uploader.id,
        title=title,
        filename=filename,
        storage_uri=storage_uri,
        sha256=sha256,
    )
    session.add(material)
    await session.flush()
    return material


async def update(
    session: AsyncSession,
    material: Material,
    *,
    title: str | None = None,
    week: int | None = None,
    lecture_no: int | None = None,
    kind: str | None = None,
    page_count: int | None = None,
) -> Material:
    for field, value in (
        ("title", title),
        ("week", week),
        ("lecture_no", lecture_no),
        ("kind", kind),
        ("page_count", page_count),
    ):
        if value is not None:
            setattr(material, field, value)
    await session.flush()
    return material


async def set_status(
    session: AsyncSession, material: Material, status: str, error: str | None = None
) -> Material:
    material.status = status
    material.error = error
    await session.flush()
    return material


async def for_course(session: AsyncSession, course: Course) -> list[Material]:
    return list(
        await session.scalars(
            select(Material)
            .where(Material.course_id == course.id)
            .order_by(Material.week, Material.created_at)
        )
    )


async def remove(session: AsyncSession, material: Material) -> None:
    await session.delete(material)
    await session.flush()


async def replace_topics(
    session: AsyncSession, material: Material, topics: list[tuple[str, int, int]]
) -> list[Topic]:
    """Segmentation reruns wholesale, so the previous run's Topics go with it."""
    await session.execute(delete(Topic).where(Topic.material_id == material.id))
    rows = [
        Topic(
            material_id=material.id,
            label=label,
            page_start=page_start,
            page_end=page_end,
            position=position,
        )
        for position, (label, page_start, page_end) in enumerate(topics)
    ]
    session.add_all(rows)
    await session.flush()
    return rows


async def topics_for(session: AsyncSession, material: Material) -> list[Topic]:
    return list(
        await session.scalars(
            select(Topic).where(Topic.material_id == material.id).order_by(Topic.position)
        )
    )


async def topic(session: AsyncSession, topic_id: UUID) -> Topic | None:
    return await session.get(Topic, topic_id)


async def set_reading_position(
    session: AsyncSession, *, user: User, material: Material, page: int
) -> ReadingPosition:
    statement = (
        insert(ReadingPosition)
        .values(user_id=user.id, material_id=material.id, page=page)
        .on_conflict_do_update(
            index_elements=[ReadingPosition.user_id, ReadingPosition.material_id],
            set_={"page": page, "updated_at": utcnow()},
        )
        .returning(ReadingPosition)
    )
    return (await session.execute(statement)).scalar_one()


async def reading_position(
    session: AsyncSession, *, user: User, material: Material
) -> ReadingPosition | None:
    return await session.get(ReadingPosition, (user.id, material.id))
