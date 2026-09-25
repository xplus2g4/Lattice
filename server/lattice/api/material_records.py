"""Material records: upload and deduplication (#34), ingest status and retry (#35),
Topic segmentation results (#41) and each student's reading position (#29)."""

from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.api.deps import COURSE_CODE, CurrentUser, IngestDep, SessionDep, SettingsDep
from lattice.api.schemas import MaterialOut, ReadingPositionOut, TopicOut, UploadOut
from lattice.api.uploads import receive
from lattice.db.models import Course, Material, User
from lattice.db.repo import courses, materials, product_events

router = APIRouter(tags=["materials"])

# No .pptx: Cognee 1.5.4 has no PPTX loader, so a deck only ever ends as a failed ingest.
# Re-add it with the loader or conversion path chosen for #6.
ALLOWED_SUFFIXES = {".pdf", ".md", ".txt"}


class MaterialRef(BaseModel):
    material: UUID


class UpdateMaterial(MaterialRef):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    week: int | None = Field(default=None, ge=0, le=52)
    lecture_no: int | None = Field(default=None, ge=0)
    kind: str | None = Field(default=None, pattern="^(slides|tutorial|memo)$")
    page_count: int | None = Field(default=None, ge=1)


class TopicIn(BaseModel):
    label: str = Field(min_length=1, max_length=300)
    page_start: int = Field(ge=1)
    page_end: int = Field(ge=1)


class ReplaceTopics(MaterialRef):
    topics: list[TopicIn]


class SetReadingPosition(MaterialRef):
    page: int = Field(ge=1)


async def _enrolled_course(session: AsyncSession, user: User, code: str) -> Course:
    course = await courses.by_code(session, code)
    if course is None:
        raise HTTPException(404, "no such course")
    if await courses.enrolment(session, user.id, course.id) is None:
        raise HTTPException(403, "not enrolled in this course")
    return course


async def _readable(session: AsyncSession, user: User, material_id: UUID) -> Material:
    """A Material is readable by the course's members and nobody else."""
    material = await materials.get(session, material_id)
    if material is None:
        raise HTTPException(404, "no such material")
    if await courses.enrolment(session, user.id, material.course_id) is None:
        raise HTTPException(403, "not enrolled in this course")
    return material


async def _writable(session: AsyncSession, user: User, material_id: UUID) -> Material:
    """Mutating one belongs to whoever uploaded it, or to the course owner."""
    material = await _readable(session, user, material_id)
    if user.id not in (material.created_by, material.course.owner_user_id):
        raise HTTPException(403, "only the uploader or the course owner may change this")
    return material


@router.post("/materials.upload", status_code=202)
async def upload_material(
    user: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    ingest: IngestDep,
    background: BackgroundTasks,
    course: Annotated[str, Form(pattern=COURSE_CODE.pattern)],
    file: Annotated[UploadFile, File()],
) -> UploadOut:
    """Content-addressed: the same bytes uploaded twice join the first Material (#34)."""
    row = await _enrolled_course(session, user, course)
    received = await receive(file, allowed=ALLOWED_SUFFIXES, max_mb=settings.max_upload_mb)

    existing = await materials.by_sha256(session, row, received.sha256)
    if existing is not None:
        return UploadOut(material=MaterialOut.model_validate(existing), deduplicated=True)

    # Dedup runs before any disk write, as before.
    target = received.store(settings.uploads_dir / row.code)
    material = await materials.create(
        session,
        course=row,
        uploader=user,
        title=received.filename,
        filename=received.filename,
        storage_uri=str(target),
        sha256=received.sha256,
    )
    background.add_task(ingest.material, material.id)
    await product_events.record(
        session,
        user_id=user.id,
        course_id=row.id,
        name="material.uploaded",
        properties={
            "material_id": str(material.id),
            "kind": Path(received.filename).suffix[1:],
            "pages": material.page_count,
        },
    )
    return UploadOut(material=MaterialOut.model_validate(material), deduplicated=False)


@router.get("/materials.list")
async def list_materials(course: str, user: CurrentUser, session: SessionDep) -> list[MaterialOut]:
    row = await _enrolled_course(session, user, course)
    return [MaterialOut.model_validate(m) for m in await materials.for_course(session, row)]


@router.get("/materials.get")
async def get_material(material: UUID, user: CurrentUser, session: SessionDep) -> MaterialOut:
    return MaterialOut.model_validate(await _readable(session, user, material))


@router.get("/materials.download", response_class=FileResponse)
async def download_material(
    material: UUID, user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> FileResponse:
    row = await _readable(session, user, material)
    path = Path(row.storage_uri).resolve()
    if path.parent != (settings.uploads_dir / row.course.code).resolve() or not path.is_file():
        raise HTTPException(404, "material bytes are unavailable")
    return FileResponse(path, filename=row.filename)


@router.post("/materials.update")
async def update_material(
    body: UpdateMaterial, user: CurrentUser, session: SessionDep
) -> MaterialOut:
    row = await _writable(session, user, body.material)
    return MaterialOut.model_validate(
        await materials.update(
            session,
            row,
            title=body.title,
            week=body.week,
            lecture_no=body.lecture_no,
            kind=body.kind,
            page_count=body.page_count,
        )
    )


@router.post("/materials.retry", status_code=202)
async def retry_material(
    body: MaterialRef,
    user: CurrentUser,
    session: SessionDep,
    ingest: IngestDep,
    background: BackgroundTasks,
) -> MaterialOut:
    """Only a failed ingest is retried; a running one would be cognified twice (#35)."""
    row = await _writable(session, user, body.material)
    if row.status != "failed":
        raise HTTPException(409, f"material is {row.status}, not failed")
    await materials.set_status(session, row, "queued")
    background.add_task(ingest.material, row.id)
    return MaterialOut.model_validate(row)


@router.post("/materials.delete")
async def delete_material(
    body: MaterialRef, user: CurrentUser, session: SessionDep
) -> dict[str, bool]:
    """Drops the record and its Topics. Removing the cognified data is #36's job."""
    await materials.remove(session, await _writable(session, user, body.material))
    return {"deleted": True}


@router.post("/topics.replace")
async def replace_topics(
    body: ReplaceTopics, user: CurrentUser, session: SessionDep
) -> list[TopicOut]:
    row = await _writable(session, user, body.material)
    for topic in body.topics:
        if topic.page_end < topic.page_start:
            raise HTTPException(422, "page_end precedes page_start")
    replaced = await materials.replace_topics(
        session, row, [(t.label, t.page_start, t.page_end) for t in body.topics]
    )
    return [TopicOut.model_validate(t) for t in replaced]


@router.get("/topics.list")
async def list_topics(material: UUID, user: CurrentUser, session: SessionDep) -> list[TopicOut]:
    row = await _readable(session, user, material)
    return [TopicOut.model_validate(t) for t in await materials.topics_for(session, row)]


@router.post("/readingPosition.set")
async def set_reading_position(
    body: SetReadingPosition, user: CurrentUser, session: SessionDep
) -> ReadingPositionOut:
    row = await _readable(session, user, body.material)
    position = await materials.set_reading_position(
        session, user=user, material=row, page=body.page
    )
    topics = await materials.topics_for(session, row)
    topic = next((t for t in topics if t.page_start <= body.page <= t.page_end), None)
    opened = {
        "material_id": str(row.id),
        "page": body.page,
        "topic_id": None if topic is None else str(topic.id),
    }
    await product_events.record(
        session, user_id=user.id, course_id=row.course_id, name="page.opened", properties=opened
    )
    # Landing on a Topic's last page is the closest thing to finishing it.
    if topic is not None and body.page == topic.page_end:
        await product_events.record(
            session,
            user_id=user.id,
            course_id=row.course_id,
            name="topic.finished",
            properties=opened,
        )
    return ReadingPositionOut.model_validate(position)


@router.get("/readingPosition.get")
async def get_reading_position(
    material: UUID, user: CurrentUser, session: SessionDep
) -> ReadingPositionOut | None:
    row = await _readable(session, user, material)
    position = await materials.reading_position(session, user=user, material=row)
    return None if position is None else ReadingPositionOut.model_validate(position)
