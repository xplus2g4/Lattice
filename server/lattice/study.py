import time
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from lattice.engine import QUERY_TYPES, Engine
from lattice.registry import Registry, Turn, now, user_turn

QueryType = Literal["GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS"]
assert set(QueryType.__args__) == set(QUERY_TYPES)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2_000)
    query_type: QueryType = "GRAPH_COMPLETION"
    session_id: str | None = Field(default=None, max_length=64)


class AskResponse(BaseModel):
    session_id: str
    turn: Turn


class SessionAccessError(PermissionError):
    pass


async def ask_course(
    engine: Engine, registry: Registry, course: str, email: str, body: AskRequest
) -> AskResponse:
    try:
        session = registry.get_or_create_session(body.session_id, course, email)
    except KeyError:
        raise SessionAccessError("session belongs to another course or user") from None
    user = await engine.principal(email)
    global_ds, private_ds = await engine.enrol(course, user)
    datasets = {global_ds.id: "course", private_ds.id: "notes"}
    started = time.monotonic()
    results = await engine.search(user, datasets, body.question, body.query_type, session.id)
    answer = Turn(
        id=uuid4().hex,
        role="assistant",
        content="\n\n".join(r.answer for r in results if r.answer),
        query_type=body.query_type,
        results=results,
        used_notes=any(
            r.tier == "notes" and (r.evidence or (body.query_type == "CHUNKS" and r.answer))
            for r in results
        ),
        latency_ms=int((time.monotonic() - started) * 1000),
        created_at=now(),
    )
    session.turns.extend([user_turn(body.question), answer])
    return AskResponse(session_id=session.id, turn=answer)
