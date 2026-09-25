import asyncio
import hashlib
import time
from collections.abc import Coroutine
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from lattice import telemetry
from lattice.config import Settings
from lattice.db.models import Course, Session, Turn, User
from lattice.db.repo import course_summaries, courses, materials, product_events, sessions, users
from lattice.grounding import NOT_COVERED, RELATED_POLICY
from lattice.retrieval import TierResult
from lattice.spend import Attribution, CeilingReached, check_ceiling, collect

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


@dataclass
class RelatedLane:
    """One related course's global tier, searched as the instructor principal.

    That principal owns every global dataset and no private one, so it structurally cannot
    reach a Note; and the lane's own datasets map makes `IsolationError` refuse a result
    from anywhere else, including the caller's own course.
    """

    code: str
    datasets: dict[UUID, str]
    # Cognee names a document after its stored file, the Material's sha256. The client
    # cannot list another course's Materials, so the filename is resolved here instead.
    filenames: dict[str, str]

    def attribute(self, result: TierResult) -> TierResult:
        evidence = [
            e.model_copy(update={"document_name": self.filename(e.document_name)})
            if e.document_name
            else e
            for e in result.evidence
        ]
        return result.model_copy(update={"course": self.code, "evidence": evidence})

    def filename(self, document_name: str) -> str:
        return (
            self.filenames.get(document_name)
            or self.filenames.get(Path(document_name).stem)
            or document_name
        )


async def _related_lanes(
    engine: Engine, db: AsyncSession, course: Course, k: int
) -> list[RelatedLane]:
    """Every database read happens here, before the searches run concurrently: one
    AsyncSession cannot be shared between coroutines."""
    lanes = []
    for neighbour in await course_summaries.nearest(db, course, k):
        dataset = await engine.global_dataset(neighbour.code)
        rows = await materials.for_course(db, neighbour)
        lanes.append(
            RelatedLane(
                neighbour.code, {dataset.id: "related"}, {m.sha256: m.filename for m in rows}
            )
        )
    return lanes


async def _timed(
    course: str, lane: str, search: Coroutine[None, None, list[TierResult]]
) -> list[TierResult]:
    """One search lane, its wall time observed under `ask_duration_seconds`."""
    started = time.monotonic()
    found = await search
    telemetry.ASK_DURATION.labels(course=course, lane=lane).observe(time.monotonic() - started)
    return found


async def answer_course(
    engine: Engine,
    db: AsyncSession,
    user: User,
    course_code: str,
    body: AskRequest,
    *,
    related_k: int = 0,
    settings: Settings | None = None,
) -> tuple[Session, Turn]:
    """Answer from the course's two tiers, plus the global tier of up to `related_k` related
    courses as reference material. The Session stays bound to one course; only retrieval
    reaches further, and only when this course has a summary to be compared by.

    With `settings`, the Ceiling is checked first and `CeilingReached` refuses the ask;
    without (evaluation scripts), nothing is refused. Every provider attempt is Spend
    attributed to the asking Principal and, once it exists, the assistant Turn; the
    related lanes run as the instructor but the student caused them."""
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
    if settings is not None:
        try:
            await check_ceiling(db, settings)
        except CeilingReached:
            telemetry.ASK_OUTCOME.labels(course=course.code, outcome="refused_budget").inc()
            raise
    principal = await engine.principal(user.email)
    global_ds, private_ds = await engine.enrol(course.code, principal)
    datasets = {global_ds.id: "course"}
    if not user.notes_opt_out:
        datasets[private_ds.id] = "notes"
    lanes = await _related_lanes(engine, db, course, related_k)
    instructor = await engine.instructor() if lanes else None
    started = time.monotonic()
    attribution = Attribution(user_id=user.id, course_id=course.id, course_code=course.code)
    async with collect(db, attribution) as collector:
        # Each lane is its own Cognee session, so related histories never mix with the
        # student's. The searches share one Collector: the gather children copy the context.
        own, *related = await asyncio.gather(
            _timed(
                course.code,
                "own",
                engine.search(principal, datasets, body.question, body.query_type, str(session.id)),
            ),
            *(
                _timed(
                    course.code,
                    "related",
                    engine.search(
                        instructor,
                        lane.datasets,
                        body.question,
                        body.query_type,
                        f"{session.id}-related-{lane.code}",
                        system_prompt=RELATED_POLICY,
                    ),
                )
                for lane in lanes
            ),
        )
        # Cognee lists the datasets in its own order; the course tier leads the answer.
        own = sorted(
            (r.model_copy(update={"course": course.code}) for r in own),
            key=lambda r: r.tier != "course",
        )
        results = list(own)
        for lane, found in zip(lanes, related, strict=True):
            # A related course that declines has nothing to add, so it is left out entirely.
            results.extend(lane.attribute(r) for r in found if not _declines(r.answer))
        asked = await sessions.add_turn(
            db, session, role="user", content={"text": body.question, "query_type": body.query_type}
        )
        text = compose_answer(own)
        cited = [e.chunk_id for r in results for e in r.evidence if e.chunk_id is not None]
        latency_ms = int((time.monotonic() - started) * 1000)
        answer = await sessions.add_turn(
            db,
            session,
            role="assistant",
            content={
                # One answer from the course's own tiers; related courses live only in `results`.
                "text": text,
                "query_type": body.query_type,
                "results": [r.model_dump(mode="json") for r in results],
            },
            cited_chunk_ids=cited,
            used_notes=any(
                r.tier == "notes" and (r.evidence or (body.query_type == "CHUNKS" and r.answer))
                for r in results
            ),
            latency_ms=latency_ms,
        )
        # The Turn exists now, so the rows flushed on exit can cite it.
        collector.attribution.turn_id = answer.id
    telemetry.ASK_OUTCOME.labels(
        course=course.code, outcome="answered" if text else "empty_answer"
    ).inc()
    telemetry.ASK_CITATIONS.labels(course=course.code).observe(len(cited))
    # Product events carry the question's length and hash, never its text.
    await product_events.record(
        db,
        user_id=user.id,
        course_id=course.id,
        name="ask.asked",
        properties={
            "session_id": str(session.id),
            "turn_id": str(asked.id),
            "question_len": len(body.question),
            "question_sha256": hashlib.sha256(body.question.encode("utf-8")).hexdigest(),
            "used_notes": not user.notes_opt_out,
            "related_courses": len(lanes),
        },
    )
    await product_events.record(
        db,
        user_id=user.id,
        course_id=course.id,
        name="ask.answered",
        properties={
            "turn_id": str(answer.id),
            "citations": len(cited),
            "empty_answer": not text,
            "latency_ms": latency_ms,
        },
    )
    return session, answer


async def ask_course(
    engine: Engine,
    db: AsyncSession,
    course: str,
    email: str,
    body: AskRequest,
    *,
    related_k: int = 0,
    settings: Settings | None = None,
) -> AskResponse:
    user = await users.get_or_create(db, email)
    session, answer = await answer_course(
        engine, db, user, course, body, related_k=related_k, settings=settings
    )
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
