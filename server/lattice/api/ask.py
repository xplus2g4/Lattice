"""Asking a course a question, and the Session it accumulates into."""

import time
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession as DbSession

from lattice.api.deps import COURSE_CODE, CurrentUser, EngineDep, SessionDep
from lattice.api.schemas import AskOut, SessionOut, TurnOut
from lattice.db.models import Session, User
from lattice.db.repo import courses, sessions
from lattice.engine import QUERY_TYPES
from lattice.retrieval import TierResult

router = APIRouter(tags=["ask"])

QueryType = Literal["GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS"]
assert set(QueryType.__args__) == set(QUERY_TYPES)


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


def _cited_chunk_ids(results: list[TierResult]) -> list[str]:
    return [e.chunk_id for r in results for e in r.evidence if e.chunk_id is not None]


@router.post("/ask")
async def ask(body: AskRequest, user: CurrentUser, db: SessionDep, engine: EngineDep) -> AskOut:
    """Both Turns are persisted, so a reload replays the conversation the student had."""
    course = await courses.by_code(db, body.course)
    if course is None:
        raise HTTPException(404, "no such course")
    if await courses.enrolment(db, user.id, course.id) is None:
        raise HTTPException(403, "not enrolled in this course")

    session = (
        await sessions.create(db, user=user, course=course)
        if body.session is None
        else await _own_session(db, user, body.session)
    )
    if session.course_id != course.id:
        raise HTTPException(403, "session belongs to another course")

    principal = await engine.principal(user.email)
    global_ds, private_ds = await engine.enrol(course.code, principal)
    datasets = {global_ds.id: "course"} | ({} if user.notes_opt_out else {private_ds.id: "notes"})

    started = time.monotonic()
    try:
        results = await engine.search(
            principal, datasets, body.question, body.query_type, str(session.id)
        )
    except Exception as exc:  # noqa: BLE001 - operations.md: search raises -> 502, no partial answer
        raise HTTPException(502, f"{type(exc).__name__}: {exc}") from exc

    await sessions.add_turn(
        db, session, role="user", content={"text": body.question, "query_type": body.query_type}
    )
    answer = await sessions.add_turn(
        db,
        session,
        role="assistant",
        content={
            "text": "\n\n".join(r.answer for r in results if r.answer),
            "query_type": body.query_type,
            "results": [r.model_dump(mode="json") for r in results],
        },
        cited_chunk_ids=_cited_chunk_ids(results),
        used_notes=any(r.tier == "notes" and r.evidence for r in results),
        latency_ms=int((time.monotonic() - started) * 1000),
    )
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
