"""HTTP operations used by the separate MCP adapter."""

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lattice.api.ask import ceiling_response
from lattice.api.deps import ApiError, CurrentUser, EngineDep, SessionDep, SettingsDep
from lattice.db.repo import courses
from lattice.logging import request_id
from lattice.note_review import NoteReview, NoteReviewer
from lattice.page_notes import (
    Course,
    Filename,
    MaterialContext,
    NoteText,
    PageAnchor,
    PageNote,
    PageNotes,
    RevisionConflict,
)
from lattice.spend import Attribution, CeilingReached, check_ceiling, collect
from lattice.study import AskRequest, AskResponse, SessionAccessError, ask_course

router = APIRouter(prefix="/study", tags=["study"])
log = logging.getLogger(__name__)


class MaterialRequest(BaseModel):
    course: Course
    filename: Filename


class SavePageNote(BaseModel):
    anchor: PageAnchor
    body_md: NoteText
    expected_revision: int = Field(ge=0)


class ReviewRequest(BaseModel):
    course: Course
    body_md: NoteText


class CourseQuestion(AskRequest):
    course: Course


async def checked(operation):
    try:
        async with asyncio.timeout(125):
            return await operation
    except (SessionAccessError, courses.CourseAccessError) as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
    except CeilingReached as exc:
        raise ceiling_response(exc) from None
    except RevisionConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError:
        raise HTTPException(
            422, "Invalid input or Material/Page context; refresh context and retry"
        ) from None
    except Exception as exc:  # noqa: BLE001 - engine errors -> 502, never a partial answer
        log.exception("study operation failed")
        raise ApiError(502, f"{type(exc).__name__}: {exc}", request_id=request_id.get()) from exc


@router.post("/materialContext")
async def material_context(
    body: MaterialRequest, user: CurrentUser, db: SessionDep, settings: SettingsDep
) -> MaterialContext:
    return await checked(PageNotes(db, settings).context(user.email, body.course, body.filename))


@router.post("/pageNote.get")
async def get_page_note(
    body: PageAnchor, user: CurrentUser, db: SessionDep, settings: SettingsDep
) -> PageNote:
    return await checked(PageNotes(db, settings).get(user.email, body))


@router.post("/pageNote.save")
async def save_page_note(
    body: SavePageNote, user: CurrentUser, db: SessionDep, settings: SettingsDep
) -> PageNote:
    return await checked(
        PageNotes(db, settings).upsert(
            user.email, body.anchor, body.body_md, expected_revision=body.expected_revision
        )
    )


@router.post("/note.review")
async def review_note(
    body: ReviewRequest,
    user: CurrentUser,
    db: SessionDep,
    engine: EngineDep,
    settings: SettingsDep,
) -> NoteReview:
    # Costs completions, so the Ceiling applies; the Spend is the student's, in this course.
    course = await checked(courses.require_enrolment(db, user, body.course))
    await checked(check_ceiling(db, settings))
    reviewer = NoteReviewer(engine.retrieve_official, engine.generate)
    attribution = Attribution(user_id=user.id, course_id=course.id, course_code=course.code)
    async with collect(db, attribution):
        return await checked(reviewer.review(body.course, user.email, body.body_md))


@router.post("/ask")
async def ask(
    body: CourseQuestion,
    user: CurrentUser,
    db: SessionDep,
    engine: EngineDep,
    settings: SettingsDep,
) -> AskResponse:
    return await checked(ask_course(engine, db, body.course, user.email, body, settings=settings))
