"""Looking at the queue. Admins only: a job's payload names other students' Notes."""

from typing import Literal

from fastapi import APIRouter, HTTPException

from lattice.api.deps import CurrentUser, SessionDep
from lattice.api.schemas import JobOut
from lattice.db.repo import jobs

router = APIRouter(tags=["jobs"])


@router.get("/jobs.list")
async def list_jobs(
    user: CurrentUser,
    session: SessionDep,
    status: Literal["pending", "running", "done", "failed"] | None = None,
    limit: int = 50,
) -> list[JobOut]:
    if user.role != "admin":
        raise HTTPException(403, "admins only")
    found = await jobs.recent(session, status=status, limit=min(limit, 200))
    return [JobOut.model_validate(job) for job in found]
