"""Admin reads over records: what students asked, per course.

Records only, per the architecture's "no super-user retrieval path": an admin can
read session rows, but there is deliberately no way to run `/ask` as another
student — that would query their private dataset.
"""

from uuid import UUID

from fastapi import APIRouter, HTTPException

from lattice.api.deps import AdminUser, SessionDep
from lattice.api.schemas import AdminSessionOut, TurnOut
from lattice.db.models import Session
from lattice.db.repo import courses, sessions, users

router = APIRouter(tags=["admin"])


def _out(session: Session, email: str) -> AdminSessionOut:
    return AdminSessionOut(
        id=session.id,
        course_id=session.course_id,
        user_email=email,
        turns=[TurnOut.model_validate(t) for t in session.turns],
        created_at=session.created_at,
        last_turn_at=session.last_turn_at,
    )


@router.get("/admin/sessions.list")
async def list_sessions(
    _: AdminUser,
    db: SessionDep,
    course: str,
    user: str | None = None,
) -> list[AdminSessionOut]:
    """Every student's Session in one course, or one student's with `?user=<email>`."""
    row = await courses.by_code(db, course)
    if row is None:
        raise HTTPException(404, "no such course")
    if user is None:
        return [_out(s, email) for s, email in await sessions.for_course_all_users(db, course=row)]
    owner = await users.by_email(db, user.strip().lower())
    if owner is None:
        return []
    return [_out(s, owner.email) for s in await sessions.for_course(db, user=owner, course=row)]


@router.get("/admin/sessions.get")
async def get_session(_: AdminUser, db: SessionDep, session: UUID) -> AdminSessionOut:
    found = await sessions.get(db, session)
    if found is None:
        raise HTTPException(404, "no such session")
    owner = await users.by_id(db, found.user_id)
    return _out(found, owner.email if owner else "unknown")
