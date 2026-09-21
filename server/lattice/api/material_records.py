"""Material records: upload and deduplication (#34), ingest status and retry (#35),
Topic segmentation results (#41) and each student's reading position (#29)."""

import hashlib
from pathlib import PurePosixPath
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.api.deps import COURSE_CODE, CurrentUser, SessionDep, SettingsDep
from lattice.api.schemas import MaterialOut, ReadingPositionOut, TopicOut, UploadOut
from lattice.db.models import Course, Material, User
from lattice.db.repo import courses, jobs, materials

router = APIRouter(tags=["materials"])

ALLOWED_SUFFIXES = {".pdf", ".pptx", ".md", ".txt"}


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


async def _queue_ingest(session: AsyncSession, material: Material) -> None:
    """Queued in the request's transaction, so the Material and its job commit together."""
    await jobs.enqueue(
        session,
        kind="ingest_material",
        payload={"material_id": str(material.id)},
        dedupe_key=f"ingest_material:{material.id}",
    )


@router.post("/materials.upload", status_code=202)
async def upload_material(
    user: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    course: Annotated[str, Form(pattern=COURSE_CODE.pattern)],
    file: Annotated[UploadFile, File()],
) -> UploadOut:
    """Content-addressed: the same bytes uploaded twice join the first Material (#34)."""
    row = await _enrolled_course(session, user, course)
    filename = PurePosixPath(file.filename or "").name
    if not filename or PurePosixPath(filename).suffix.lower() not in ALLOWED_SUFFIXES:
        raise HTTPException(415, f"accepted: {', '.join(sorted(ALLOWED_SUFFIXES))}")

    limit = settings.max_upload_mb * 1024 * 1024
    body = await file.read(limit + 1)
    if len(body) > limit:
        raise HTTPException(413, f"max {settings.max_upload_mb} MB")
    sha256 = hashlib.sha256(body).hexdigest()

    existing = await materials.by_sha256(session, row, sha256)
    if existing is not None:
        return UploadOut(material=MaterialOut.model_validate(existing), deduplicated=True)

    target = settings.uploads_dir / row.code / f"{sha256}{PurePosixPath(filename).suffix.lower()}"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)

    material = await materials.create(
        session,
        course=row,
        uploader=user,
        title=filename,
        filename=filename,
        storage_uri=str(target),
        sha256=sha256,
    )
    await _queue_ingest(session, material)
    return UploadOut(material=MaterialOut.model_validate(material), deduplicated=False)


@router.get("/materials.list")
async def list_materials(course: str, user: CurrentUser, session: SessionDep) -> list[MaterialOut]:
    row = await _enrolled_course(session, user, course)
    return [MaterialOut.model_validate(m) for m in await materials.for_course(session, row)]


@router.get("/materials.get")
async def get_material(material: UUID, user: CurrentUser, session: SessionDep) -> MaterialOut:
    return MaterialOut.model_validate(await _readable(session, user, material))


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
async def retry_material(body: MaterialRef, user: CurrentUser, session: SessionDep) -> MaterialOut:
    """Only a failed ingest is retried; a running one would be cognified twice (#35)."""
    row = await _writable(session, user, body.material)
    if row.status != "failed":
        raise HTTPException(409, f"material is {row.status}, not failed")
    await materials.set_status(session, row, "queued")
    await _queue_ingest(session, row)
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
    return ReadingPositionOut.model_validate(position)


@router.get("/readingPosition.get")
async def get_reading_position(
    material: UUID, user: CurrentUser, session: SessionDep
) -> ReadingPositionOut | None:
    row = await _readable(session, user, material)
    position = await materials.reading_position(session, user=user, material=row)
    return None if position is None else ReadingPositionOut.model_validate(position)
