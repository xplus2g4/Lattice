from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.api.deps import COURSE_CODE, CurrentUser, EngineDep, SessionDep
from lattice.api.schemas import CourseOut, CourseSearchHit, CourseSearchOut, EnrolmentOut, UserOut
from lattice.db.models import Course, User
from lattice.db.repo import courses, users

router = APIRouter(tags=["courses"])

CourseCode = Field(pattern=COURSE_CODE.pattern)


class CreateCourse(BaseModel):
    code: str = CourseCode
    name: str = Field(min_length=1, max_length=200)
    term: str | None = Field(default=None, max_length=32)


class UpdateCourse(BaseModel):
    course: str = CourseCode
    name: str | None = Field(default=None, min_length=1, max_length=200)
    term: str | None = Field(default=None, max_length=32)


class CourseRef(BaseModel):
    course: str = CourseCode


async def _course(session: AsyncSession, code: str) -> Course:
    course = await courses.by_code(session, code)
    if course is None:
        raise HTTPException(404, "no such course")
    return course


async def _enrolled_course(session: AsyncSession, user: User, code: str) -> Course:
    course = await _course(session, code)
    if await courses.enrolment(session, user.id, course.id) is None:
        raise HTTPException(403, "not enrolled in this course")
    return course


@router.get("/courses.search")
async def search_courses(user: CurrentUser, session: SessionDep, q: str = "") -> CourseSearchOut:
    """Exact code or substring title, with the caller's enrolment state on each hit."""
    hits = await courses.search(session, user, q)
    return CourseSearchOut(
        results=[
            CourseSearchHit(course=CourseOut.model_validate(course), enrolled=enrolled)
            for course, enrolled in hits
        ]
    )


@router.get("/courses.get")
async def get_course(course: str, _: CurrentUser, session: SessionDep) -> CourseOut:
    return CourseOut.model_validate(await _course(session, course))


@router.get("/courses.list")
async def list_courses(user: CurrentUser, session: SessionDep) -> list[CourseOut]:
    return [CourseOut.model_validate(c) for c in await courses.enrolled_courses(session, user)]


@router.post("/courses.create", status_code=201)
async def create_course(user: CurrentUser, body: CreateCourse, session: SessionDep) -> CourseOut:
    """One course per code. An existing code is a 409 carrying it, so the caller can join."""
    existing = await courses.by_code(session, body.code)
    if existing is not None:
        raise HTTPException(
            409,
            {
                "reason": "course_exists",
                "course": CourseOut.model_validate(existing).model_dump(mode="json"),
            },
        )
    course = await courses.create(
        session, code=body.code, name=body.name, term=body.term, owner=user
    )
    return CourseOut.model_validate(course)


@router.post("/courses.update")
async def update_course(user: CurrentUser, body: UpdateCourse, session: SessionDep) -> CourseOut:
    course = await _course(session, body.course)
    if course.owner_user_id != user.id and user.role != "admin":
        raise HTTPException(403, "only the course owner may change it")
    return CourseOut.model_validate(
        await courses.update(session, course, name=body.name, term=body.term)
    )


@router.post("/enrolments.join")
async def join_course(
    user: CurrentUser, body: CourseRef, session: SessionDep, engine: EngineDep
) -> EnrolmentOut:
    """Record the enrolment and create the engine-side datasets it grants."""
    course = await _course(session, body.course)
    principal = await engine.principal(user.email)
    if user.cognee_principal_id != principal.id:
        await users.set_principal(session, user, principal.id)
    _, private = await engine.enrol(course.code, principal)
    enrolment = await courses.enrol(
        session, user=user, course=course, user_dataset_name=private.name
    )
    return EnrolmentOut.model_validate(enrolment)


@router.post("/enrolments.leave")
async def leave_course(user: CurrentUser, body: CourseRef, session: SessionDep) -> dict[str, bool]:
    """Drops the record only; the private Dataset and its Notes survive a re-join."""
    course = await _course(session, body.course)
    return {"left": await courses.unenrol(session, user, course)}


@router.get("/enrolments.list")
async def list_enrolments(course: str, user: CurrentUser, session: SessionDep) -> list[UserOut]:
    row = await _enrolled_course(session, user, course)
    return [UserOut.model_validate(u) for u in await courses.roster(session, row)]
