import time
from datetime import datetime
from typing import TYPE_CHECKING, Literal
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import Session, Turn, User
from lattice.db.repo import courses, sessions, users
from lattice.grounding import NOT_COVERED
from lattice.retrieval import TierResult

if TYPE_CHECKING:
    from lattice.engine import Engine

QueryType = Literal["GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS"]


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2_000)
    query_type: QueryType = "GRAPH_COMPLETION"
    session_id: str | None = Field(default=None, max_length=64)


class AnswerTurn(BaseModel):
    id: str
    role: Literal["assistant"] = "assistant"
    content: str
    query_type: str
    results: list[TierResult]
    used_notes: bool
    latency_ms: int | None
    created_at: datetime


class AskResponse(BaseModel):
    session_id: str
    turn: AnswerTurn


class SessionAccessError(PermissionError):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code


def _declines(answer: str | None) -> bool:
    """The tier said its context has nothing on the question; matched as loosely as the canary."""
    return answer is not None and NOT_COVERED.rstrip(".").lower() in answer.lower()


def compose_answer(results: list[TierResult]) -> str:
    """One answer across tiers, rather than one per tier.

    Cognee generates a completion per dataset, so a question the Notes do not cover gets a
    "not covered" reply from that tier beside the real answer from the course. Such a tier
    is left out; only when every tier declines does the reader see the sentinel, once.
    """
    answered = [r.answer for r in results if r.answer and not _declines(r.answer)]
    if answered:
        return "\n\n".join(answered)
    return NOT_COVERED if any(_declines(r.answer) for r in results) else ""


async def answer_course(
    engine: Engine, db: AsyncSession, user: User, course_code: str, body: AskRequest
) -> tuple[Session, Turn]:
    course = await courses.require_enrolment(db, user, course_code)
    if body.session_id is None:
        session = await sessions.create(db, user=user, course=course)
    else:
        try:
            session_id = UUID(body.session_id)
        except ValueError:
            raise SessionAccessError(404, "no such session") from None
        session = await sessions.get(db, session_id)
        if session is None or session.user_id != user.id:
            raise SessionAccessError(404, "no such session")
        if session.course_id != course.id:
            raise SessionAccessError(403, "session belongs to another course")
    principal = await engine.principal(user.email)
    global_ds, private_ds = await engine.enrol(course.code, principal)
    datasets = {global_ds.id: "course"}
    if not user.notes_opt_out:
        datasets[private_ds.id] = "notes"
    started = time.monotonic()
    # Cognee lists the datasets in its own order; the course tier leads the answer.
    results = sorted(
        await engine.search(principal, datasets, body.question, body.query_type, str(session.id)),
        key=lambda r: r.tier != "course",
    )
    await sessions.add_turn(
        db, session, role="user", content={"text": body.question, "query_type": body.query_type}
    )
    answer = await sessions.add_turn(
        db,
        session,
        role="assistant",
        content={
            "text": compose_answer(results),
            "query_type": body.query_type,
            "results": [r.model_dump(mode="json") for r in results],
        },
        cited_chunk_ids=[e.chunk_id for r in results for e in r.evidence if e.chunk_id is not None],
        used_notes=any(
            r.tier == "notes" and (r.evidence or (body.query_type == "CHUNKS" and r.answer))
            for r in results
        ),
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    return session, answer


async def ask_course(
    engine: Engine, db: AsyncSession, course: str, email: str, body: AskRequest
) -> AskResponse:
    user = await users.get_or_create(db, email)
    session, answer = await answer_course(engine, db, user, course, body)
    return AskResponse(
        session_id=str(session.id),
        turn=AnswerTurn(
            id=str(answer.id),
            content=answer.content_json["text"],
            query_type=body.query_type,
            results=answer.content_json["results"],
            used_notes=answer.used_notes,
            latency_ms=answer.latency_ms,
            created_at=answer.created_at,
        ),
    )
