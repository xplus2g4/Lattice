"""Wire shapes shared by the RPC endpoints.

The surface is RPC: verb-named endpoints, GET for reads with query arguments, POST with a JSON
body for writes. Nothing carries a resource id in the path.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class Record(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(Record):
    id: UUID
    email: str
    name: str | None
    role: str
    notes_opt_out: bool
    created_at: datetime


class CourseOut(Record):
    id: UUID
    code: str
    name: str
    term: str | None
    owner_user_id: UUID
    global_dataset_name: str
    created_at: datetime


class EnrolmentOut(Record):
    user_id: UUID
    course_id: UUID
    user_dataset_name: str
    created_at: datetime


class MeOut(BaseModel):
    user: UserOut
    courses: list[CourseOut]


class CourseSearchHit(BaseModel):
    course: CourseOut
    enrolled: bool


class CourseSearchOut(BaseModel):
    results: list[CourseSearchHit]
