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
    revision: int
    cognified_revision: int
    course_id: UUID
    material_id: UUID | None
    page: int | None
    body_md: str
    # Set when the Note is a stored PDF; then body_md is "" (required-nullable, ADR 0005).
    filename: str | None
    sha256: str | None
    status: str
    error: str | None
    created_at: datetime
    updated_at: datetime


class NoteUploadOut(BaseModel):
    note: NoteOut
    # True when this student already holds these bytes in this course.
    deduplicated: bool


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


def question_out(question: Any, *, withhold: bool) -> QuizQuestionOut:
    out = QuizQuestionOut.model_validate(question)
    if withhold:
        out.expected_json = None
    return out


def quiz_out(quiz: Any) -> QuizOut:
    """The answer key stays on the server while a Quiz is open."""
    out = QuizOut.model_validate(quiz)
    # Batches append in memory in arrival order; on the wire they go by position (page order).
    out.questions.sort(key=lambda question: question.position)
    if out.status == "open":
        for question in out.questions:
            question.expected_json = None
    return out


class BatchOut(BaseModel):
    index: int
    page_start: int
    page_end: int


class GrillPlanOut(BaseModel):
    """A Grill just planned: the Quiz without questions, and the batches to ask for."""

    quiz: QuizOut
    batches: list[BatchOut]


class GradedQuizOut(BaseModel):
    quiz: QuizOut
    # Drawn from the student's history at submit time and not stored; "" when there is
    # nothing to say or the model did not answer.
    remark: str


class InviteOut(BaseModel):
    """Returned once at creation: `token` is the only copy of the invite secret."""

    token: str
    role: str
    expires_at: datetime
    created_at: datetime


class InviteSummaryOut(BaseModel):
    """An invite's status for the manage view. Never carries the token itself."""

    id: UUID
    role: str
    expires_at: datetime
    created_at: datetime
    created_by_email: str | None
    used_at: datetime | None
    used_by_email: str | None


class MeOut(BaseModel):
    user: UserOut
    courses: list[CourseOut]


class CourseSearchHit(BaseModel):
    course: CourseOut
    enrolled: bool


class CourseSearchOut(BaseModel):
    results: list[CourseSearchHit]
