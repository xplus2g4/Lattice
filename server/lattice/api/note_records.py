"""Note records: quick notes (#37), page-anchored autosave (#38), private indexing (#39)."""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.api.deps import COURSE_CODE, CurrentUser, IngestDep, SessionDep
from lattice.api.schemas import NoteOut
from lattice.db.models import Material, Note, User
from lattice.db.repo import courses, materials, notes

router = APIRouter(tags=["notes"])


class SaveNote(BaseModel):
    course: str = Field(pattern=COURSE_CODE.pattern)
    body_md: str = Field(min_length=1, max_length=50_000)
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
    course = await courses.by_code(session, body.course)
    if course is None:
        raise HTTPException(404, "no such course")
    if await courses.enrolment(session, user.id, course.id) is None:
        raise HTTPException(403, "not enrolled in this course")

    note = await notes.save(
        session,
        user=user,
        course=course,
        body_md=body.body_md,
        material=await _material(session, user, body.material),
        page=body.page,
        note=None if body.note is None else await _own_note(session, user, body.note),
    )
    if not user.notes_opt_out:
        background.add_task(ingest.note, note.id)
    return NoteOut.model_validate(note)


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


@router.post("/notes.delete")
async def delete_note(body: NoteRef, user: CurrentUser, session: SessionDep) -> dict[str, bool]:
    """Drops the record; what was cognified into the private Dataset is #36's territory."""
    await notes.remove(session, await _own_note(session, user, body.note))
    return {"deleted": True}
