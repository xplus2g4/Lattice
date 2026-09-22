"""Wire shapes shared by the RPC endpoints.

The surface is RPC: verb-named endpoints, GET for reads with query arguments, POST with a JSON
body for writes. Nothing carries a resource id in the path.
"""

from datetime import datetime
from typing import Any
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


class CourseListOut(CourseOut):
    can_delete: bool


class MaterialOut(Record):
    id: UUID
    course_id: UUID
    title: str
    filename: str
    week: int | None
    lecture_no: int | None
    kind: str | None
    page_count: int | None
    sha256: str
    status: str
    error: str | None
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class UploadOut(BaseModel):
    material: MaterialOut
    # True when the course already held these bytes, so nothing was cognified again.
    deduplicated: bool


class TopicOut(Record):
    id: UUID
    material_id: UUID
    label: str
    page_start: int
    page_end: int
    position: int


class ReadingPositionOut(Record):
    material_id: UUID
    page: int
    updated_at: datetime


class NoteOut(Record):
    id: UUID
    title: str
    revision: int
    cognified_revision: int
    course_id: UUID
    material_id: UUID | None
    page: int | None
    body_md: str
    status: str
    error: str | None
    created_at: datetime
    updated_at: datetime


class TurnOut(Record):
    id: UUID
    session_id: UUID
    role: str
    content_json: dict[str, Any]
    cited_chunk_ids: list[str]
    used_notes: bool
    latency_ms: int | None
    created_at: datetime


class SessionOut(Record):
    id: UUID
    course_id: UUID
    turns: list[TurnOut]
    created_at: datetime
    last_turn_at: datetime


class AskOut(BaseModel):
    session: UUID
    turn: TurnOut


class QuizAnswerOut(Record):
    id: UUID
    question_id: UUID
    attempt_no: int
    answer_text: str
    correct: bool | None
    feedback_json: dict[str, Any] | None
    created_at: datetime


class QuizQuestionOut(Record):
    id: UUID
    quiz_id: UUID
    topic_id: UUID | None
    material_id: UUID | None
    position: int
    kind: str
    prompt: str
    options_json: list[str] | None
    expected_json: dict[str, Any] | None
    citation_json: dict[str, Any] | None
    answers: list[QuizAnswerOut]


class QuizOut(Record):
    id: UUID
    course_id: UUID
    kind: str
    scope_json: dict[str, Any]
    status: str
    score: float | None
    questions: list[QuizQuestionOut]
    created_at: datetime
    submitted_at: datetime | None


class TopicStat(BaseModel):
    topic_id: UUID | None
    attempts: int
    misses: int


class MeOut(BaseModel):
    user: UserOut
    courses: list[CourseOut]


class CourseSearchHit(BaseModel):
    course: CourseOut
    enrolled: bool


class CourseSearchOut(BaseModel):
    results: list[CourseSearchHit]
