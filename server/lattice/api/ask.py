from fastapi import APIRouter, HTTPException

from lattice.api.deps import CourseCode, CurrentEmail, EngineDep, RegistryDep
from lattice.registry import Session
from lattice.study import AskRequest, AskResponse, SessionAccessError, ask_course

router = APIRouter(prefix="/courses/{course}", tags=["ask"])


@router.post("/ask")
async def ask(
    course: CourseCode,
    email: CurrentEmail,
    body: AskRequest,
    engine: EngineDep,
    registry: RegistryDep,
) -> AskResponse:
    try:
        return await ask_course(engine, registry, course, email, body)
    except SessionAccessError as exc:
        raise HTTPException(403, str(exc)) from None
    except Exception as exc:  # noqa: BLE001 - operations.md: search raises -> 502, no partial answer
        raise HTTPException(502, f"{type(exc).__name__}: {exc}") from exc


@router.get("/sessions/{session_id}")
async def get_session(
    course: CourseCode, session_id: str, email: CurrentEmail, registry: RegistryDep
) -> Session:
    session = registry.sessions.get(session_id)
    if session is None or session.course != course or session.owner != email:
        raise HTTPException(404, "no such session")
    return session
