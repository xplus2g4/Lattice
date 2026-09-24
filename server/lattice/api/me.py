from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lattice.api.deps import CurrentUser, SessionDep
from lattice.api.schemas import CourseOut, MeOut, UserOut
from lattice.db.repo import courses, users

router = APIRouter(tags=["me"])


class UpdateMe(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    notes_opt_out: bool | None = None


@router.get("/me.get")
async def get_me(user: CurrentUser, session: SessionDep) -> MeOut:
    enrolled = await courses.enrolled_courses(session, user)
    return MeOut(
        user=UserOut.model_validate(user),
        courses=[CourseOut.model_validate(c) for c in enrolled],
    )


@router.post("/me.update")
async def update_me(user: CurrentUser, body: UpdateMe, session: SessionDep) -> UserOut:
    updated = await users.update(session, user, name=body.name, notes_opt_out=body.notes_opt_out)
    return UserOut.model_validate(updated)


@router.get("/users.list")
async def list_users(user: CurrentUser, session: SessionDep) -> list[UserOut]:
    """Everyone who has signed up. Instructors need this to see who has joined."""
    if user.role not in ("instructor", "admin"):
        raise HTTPException(403, "only instructors and admins may view users")
    return [UserOut.model_validate(u) for u in await users.list_all(session)]
