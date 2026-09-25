"""Note records: quick notes (#37), page-anchored autosave (#38), private indexing (#39)."""

from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.api.deps import COURSE_CODE, CurrentUser, IngestDep, SessionDep, SettingsDep
from lattice.api.schemas import NoteOut, NoteUploadOut
from lattice.api.uploads import receive
from lattice.db.models import Course, Material, Note, User
from lattice.db.repo import courses, materials, notes, product_events

router = APIRouter(tags=["notes"])

NOTE_SUFFIXES = {".pdf"}


class SaveNote(BaseModel):
    course: str = Field(pattern=COURSE_CODE.pattern)
    body_md: str = Field(max_length=50_000)
    expected_revision: int | None = Field(default=None, ge=0)
    note: UUID | None = None
    material: UUID | None = None
    page: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def page_needs_a_material(self) -> SaveNote:
        if self.page is not None and self.material is None:
            raise ValueError("page without material")
        return self


class NoteRef(BaseModel):
    note: UUID


async def _enrolled_course(session: AsyncSession, user: User, code: str) -> Course:
    try:
        return await courses.require_enrolment(session, user, code)
    except courses.CourseAccessError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None


async def _own_note(session: AsyncSession, user: User, note_id: UUID) -> Note:
    note = await notes.get(session, note_id)
    if note is None or note.user_id != user.id:
        # Someone else's Note is not theirs to know about.
        raise HTTPException(404, "no such note")
    return note


async def _material(session: AsyncSession, user: User, material_id: UUID | None) -> Material | None:
    if material_id is None:
        return None
    material = await materials.get(session, material_id)
    if material is None:
        raise HTTPException(404, "no such material")
    if await courses.enrolment(session, user.id, material.course_id) is None:
        raise HTTPException(403, "not enrolled in this course")
    return material


@router.post("/notes.save", status_code=202)
async def save_note(
    body: SaveNote,
    user: CurrentUser,
    session: SessionDep,
    ingest: IngestDep,
    background: BackgroundTasks,
) -> NoteOut:
    """Upserts on (student, material, page) when anchored, so autosave never piles up rows."""
    course = await _enrolled_course(session, user, body.course)
    try:
        note = await notes.save(
            session,
            user=user,
            course=course,
            body_md=body.body_md,
            material=await _material(session, user, body.material),
            page=body.page,
            note=None if body.note is None else await _own_note(session, user, body.note),
            expected_revision=body.expected_revision,
        )
    except notes.RevisionConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    await product_events.record(
        session,
        user_id=user.id,
        course_id=note.course_id,
        name="note.saved",
        properties={"note_id": str(note.id), "chars": len(body.body_md)},
    )
    if not user.notes_opt_out:
        background.add_task(ingest.note, note.id)
    return NoteOut.model_validate(note)


@router.post("/notes.upload", status_code=202)
async def upload_note(
    user: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    ingest: IngestDep,
    background: BackgroundTasks,
    course: Annotated[str, Form(pattern=COURSE_CODE.pattern)],
    file: Annotated[UploadFile, File()],
) -> NoteUploadOut:
    """One Note per PDF, into the student's private tier; the same bytes twice join the first."""
    row = await _enrolled_course(session, user, course)
    received = await receive(file, allowed=NOTE_SUFFIXES, max_mb=settings.max_upload_mb)

    existing = await notes.by_sha256(session, user=user, course=row, sha256=received.sha256)
    if existing is not None:
        return NoteUploadOut(note=NoteOut.model_validate(existing), deduplicated=True)

    # Per student, so a classmate's identical PDF is a separate private Note. Typed Notes
    # live under notes/<principal_id>/<note_id>.md, so the two never collide.
    target = received.store(settings.uploads_dir / row.code / "notes" / str(user.id))
    note = await notes.add_file(
        session,
        user=user,
        course=row,
        filename=received.filename,
        sha256=received.sha256,
        storage_uri=str(target),
    )
    await product_events.record(
        session,
        user_id=user.id,
        course_id=note.course_id,
        name="note.uploaded",
        properties={"note_id": str(note.id), "chars": None},
    )
    if not user.notes_opt_out:
        background.add_task(ingest.note, note.id)
    return NoteUploadOut(note=NoteOut.model_validate(note), deduplicated=False)


@router.get("/notes.list")
async def list_notes(
    course: str, user: CurrentUser, session: SessionDep, material: UUID | None = None
) -> list[NoteOut]:
    row = await courses.by_code(session, course)
    if row is None:
        raise HTTPException(404, "no such course")
    found = await notes.for_course(
        session, user=user, course=row, material=await _material(session, user, material)
    )
    return [NoteOut.model_validate(note) for note in found]


@router.get("/notes.get")
async def get_note(
    user: CurrentUser,
    session: SessionDep,
    note: UUID | None = None,
    material: UUID | None = None,
    page: int | None = None,
) -> NoteOut | None:
    """By id, or by the page it is anchored to: the reader asks before it has one."""
    if note is not None:
        return NoteOut.model_validate(await _own_note(session, user, note))
    if material is None or page is None:
        raise HTTPException(422, "pass note, or material and page")
    anchored = await notes.anchored(
        session, user=user, material=await _material(session, user, material), page=page
    )
    return None if anchored is None else NoteOut.model_validate(anchored)


@router.get("/notes.download", response_class=FileResponse)
async def download_note(
    note: UUID, user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> FileResponse:
    """A PDF Note's bytes, so the reader can open it; only its author may read them."""
    row = await _own_note(session, user, note)
    if row.storage_uri is None or row.filename is None:
        raise HTTPException(404, "this note has no file")
    path = Path(row.storage_uri).resolve()
    expected = (settings.uploads_dir / row.course.code / "notes" / str(user.id)).resolve()
    if path.parent != expected or not path.is_file():
        raise HTTPException(404, "note bytes are unavailable")
    return FileResponse(path, filename=row.filename)


@router.post("/notes.delete")
async def delete_note(body: NoteRef, user: CurrentUser, session: SessionDep) -> dict[str, bool]:
    """Drops the record; what was cognified into the private Dataset is #36's territory."""
    await notes.remove(session, await _own_note(session, user, body.note))
    return {"deleted": True}
