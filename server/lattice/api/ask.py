"""Asking a course a question, and the Session it accumulates into."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession as DbSession

from lattice.api.deps import COURSE_CODE, CurrentUser, EngineDep, SessionDep
from lattice.api.schemas import AskOut, SessionOut, TurnOut
from lattice.db.models import Session, User
from lattice.db.repo import courses, sessions
from lattice.study import AskRequest as StudyRequest
from lattice.study import QueryType, SessionAccessError, answer_course

router = APIRouter(tags=["ask"])


class AskRequest(BaseModel):
    course: str = Field(pattern=COURSE_CODE.pattern)
    question: str = Field(min_length=1, max_length=2_000)
    query_type: QueryType = "GRAPH_COMPLETION"
    session: UUID | None = None


class Rating(BaseModel):
    turn: UUID
    rating: Literal[-1, 1]
    comment: str | None = Field(default=None, max_length=2_000)


async def _own_session(db: DbSession, user: User, session_id: UUID) -> Session:
    session = await sessions.get(db, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(404, "no such session")
    return session


@router.post("/ask")
async def ask(body: AskRequest, user: CurrentUser, db: SessionDep, engine: EngineDep) -> AskOut:
    """Both Turns are persisted, so a reload replays the conversation the student had."""
    try:
        session, answer = await answer_course(
            engine,
            db,
            user,
            body.course,
            StudyRequest(
                question=body.question,
                query_type=body.query_type,
                session_id=None if body.session is None else str(body.session),
            ),
        )
    except (courses.CourseAccessError, SessionAccessError) as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
    except Exception as exc:  # noqa: BLE001 - operations.md: search raises -> 502, no partial answer
        raise HTTPException(502, f"{type(exc).__name__}: {exc}") from exc
    return AskOut(session=session.id, turn=TurnOut.model_validate(answer))


@router.get("/sessions.list")
async def list_sessions(course: str, user: CurrentUser, db: SessionDep) -> list[SessionOut]:
    row = await courses.by_code(db, course)
    if row is None:
        raise HTTPException(404, "no such course")
    found = await sessions.for_course(db, user=user, course=row)
    return [SessionOut.model_validate(session) for session in found]


@router.get("/sessions.get")
async def get_session(session: UUID, user: CurrentUser, db: SessionDep) -> SessionOut:
    return SessionOut.model_validate(await _own_session(db, user, session))


@router.post("/feedback.record")
async def record_feedback(body: Rating, user: CurrentUser, db: SessionDep) -> dict[str, int]:
    """Only on an answer in your own Session, and only one rating per Turn."""
    turn = await sessions.turn(db, body.turn)
    if turn is None:
        raise HTTPException(404, "no such turn")
    await _own_session(db, user, turn.session_id)
    if turn.role != "assistant":
        raise HTTPException(422, "only an answer can be rated")
    saved = await sessions.rate(db, turn=turn, user=user, rating=body.rating, comment=body.comment)
    return {"rating": saved.rating}
