"""Asking a course a question, and the Session it accumulates into."""

import logging
import math
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession as DbSession

from lattice import telemetry
from lattice.api.deps import COURSE_CODE, ApiError, CurrentUser, EngineDep, SessionDep, SettingsDep
from lattice.api.schemas import AskOut, SessionOut, TurnOut
from lattice.db.models import Session, User
from lattice.db.repo import courses, product_events, sessions
from lattice.logging import request_id
from lattice.spend import CeilingReached
from lattice.study import AskRequest as StudyRequest
from lattice.study import QueryType, SessionAccessError, answer_course

router = APIRouter(tags=["ask"])
log = logging.getLogger(__name__)


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


def ceiling_response(exc: CeilingReached) -> ApiError:
    """The Ceiling as a 429: `Retry-After` for clients, `reset_at` for people reading it."""
    wait = max(1, math.ceil((exc.reset_at - datetime.now(UTC)).total_seconds()))
    return ApiError(
        429,
        "daily spend ceiling reached",
        headers={"Retry-After": str(wait)},
        reset_at=exc.reset_at.isoformat(),
    )


@router.post("/ask")
async def ask(
    body: AskRequest,
    user: CurrentUser,
    db: SessionDep,
    engine: EngineDep,
    settings: SettingsDep,
) -> AskOut:
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
            related_k=settings.related_courses_k,
            settings=settings,
        )
    except (courses.CourseAccessError, SessionAccessError) as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
    except CeilingReached as exc:
        raise ceiling_response(exc) from None
    except Exception as exc:  # noqa: BLE001 - operations.md: search raises -> 502, no partial answer
        log.exception("ask failed: %s", body.course)
        telemetry.ASK_OUTCOME.labels(course=body.course, outcome="engine_error").inc()
        raise ApiError(502, f"{type(exc).__name__}: {exc}", request_id=request_id.get()) from exc
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
    session = await _own_session(db, user, turn.session_id)
    if turn.role != "assistant":
        raise HTTPException(422, "only an answer can be rated")
    saved = await sessions.rate(db, turn=turn, user=user, rating=body.rating, comment=body.comment)
    await product_events.record(
        db,
        user_id=user.id,
        course_id=session.course_id,
        name="feedback.recorded",
        properties={"turn_id": str(turn.id), "value": body.rating},
    )
    return {"rating": saved.rating}
