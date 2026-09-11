import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lattice.api.deps import CourseCode, CurrentEmail, EngineDep, RegistryDep
from lattice.engine import QUERY_TYPES
from lattice.registry import Session, Turn

router = APIRouter(prefix="/courses/{course}", tags=["ask"])

QueryType = Literal["GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS"]
assert set(QueryType.__args__) == set(QUERY_TYPES)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2_000)
    query_type: QueryType = "GRAPH_COMPLETION"
    session_id: str | None = Field(default=None, max_length=64)


class AskResponse(BaseModel):
    session_id: str
    turn: Turn


@router.post("/ask")
async def ask(
    course: CourseCode,
    email: CurrentEmail,
    body: AskRequest,
    engine: EngineDep,
    registry: RegistryDep,
) -> AskResponse:
    try:
        session = registry.get_or_create_session(body.session_id, course, email)
    except KeyError:
        raise HTTPException(403, "session belongs to another course or user") from None

    user = await engine.principal(email)
    global_ds, private_ds = await engine.enrol(course, user)
    datasets = {global_ds.id: "course", private_ds.id: "notes"}

    started = time.monotonic()
    try:
        results = await engine.search(user, datasets, body.question, body.query_type, session.id)
    except Exception as exc:  # noqa: BLE001 - operations.md: search raises -> 502, no partial answer
        raise HTTPException(502, f"{type(exc).__name__}: {exc}") from exc
    session.turns.append(Turn(role="user", content=body.question))
    answer = Turn(
        role="assistant",
        content="\n\n".join(r.answer for r in results if r.answer),
        query_type=body.query_type,
        results=results,
        used_notes=any(r.tier == "notes" and r.evidence for r in results),
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    session.turns.append(answer)
    return AskResponse(session_id=session.id, turn=answer)


@router.get("/sessions/{session_id}")
async def get_session(
    course: CourseCode, session_id: str, email: CurrentEmail, registry: RegistryDep
) -> Session:
    session = registry.sessions.get(session_id)
    if session is None or session.course != course or session.owner != email:
        raise HTTPException(404, "no such session")
    return session
