"""Quiz records (#44) and the per-Topic counts weighting feeds on (#49).

Writing and grading live in `quizzes.py`; this module only remembers. `quizzes.create` still
takes a Quiz already written, for callers that bring their own questions.
"""

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.api.deps import COURSE_CODE, CurrentUser, SessionDep
from lattice.api.schemas import QuizAnswerOut, QuizOut, TopicStat, quiz_out
from lattice.db.models import Course, Quiz, QuizQuestion, User
from lattice.db.repo import courses, materials, quizzes

router = APIRouter(tags=["quizzes"])


class NewQuestion(BaseModel):
    kind: Literal["short_answer", "mcq"]
    prompt: str = Field(min_length=1, max_length=4_000)
    topic_id: UUID | None = None
    material_id: UUID | None = None
    options_json: list[str] | None = None
    expected_json: dict[str, Any] | None = None
    citation_json: dict[str, Any] | None = None


class NewQuiz(BaseModel):
    course: str = Field(pattern=COURSE_CODE.pattern)
    kind: Literal["pop", "grill"]
    scope: dict[str, Any] = Field(default_factory=dict)
    questions: list[NewQuestion] = Field(min_length=1, max_length=50)


class QuizRef(BaseModel):
    quiz: UUID


class SubmitQuiz(QuizRef):
    score: float | None = Field(default=None, ge=0, le=1)


class RecordAnswer(BaseModel):
    question: UUID
    answer_text: str = Field(max_length=10_000)
    correct: bool | None = None
    feedback: dict[str, Any] | None = None


async def _enrolled_course(session: AsyncSession, user: User, code: str) -> Course:
    course = await courses.by_code(session, code)
    if course is None:
        raise HTTPException(404, "no such course")
    if await courses.enrolment(session, user.id, course.id) is None:
        raise HTTPException(403, "not enrolled in this course")
    return course


async def _own_quiz(session: AsyncSession, user: User, quiz_id: UUID) -> Quiz:
    quiz = await quizzes.get(session, quiz_id)
    if quiz is None or quiz.user_id != user.id:
        # Someone else's results are not theirs to see.
        raise HTTPException(404, "no such quiz")
    return quiz


async def _own_question(session: AsyncSession, user: User, question_id: UUID) -> QuizQuestion:
    question = await quizzes.question(session, question_id)
    if question is None or question.quiz.user_id != user.id:
        raise HTTPException(404, "no such question")
    return question


async def _check_sources(session: AsyncSession, course: Course, question: NewQuestion) -> None:
    """A question may only cite Material from the course the Quiz belongs to."""
    material_id = question.material_id
    if question.topic_id is not None:
        topic = await materials.topic(session, question.topic_id)
        if topic is None:
            raise HTTPException(404, "no such topic")
        material_id = material_id or topic.material_id
        if material_id != topic.material_id:
            raise HTTPException(422, "topic belongs to another material")
    if material_id is None:
        return
    material = await materials.get(session, material_id)
    if material is None or material.course_id != course.id:
        raise HTTPException(404, "no such material")


@router.post("/quizzes.create", status_code=201)
async def create_quiz(body: NewQuiz, user: CurrentUser, session: SessionDep) -> QuizOut:
    course = await _enrolled_course(session, user, body.course)
    for question in body.questions:
        await _check_sources(session, course, question)
    quiz = await quizzes.create(
        session,
        user=user,
        course=course,
        kind=body.kind,
        scope=body.scope,
        questions=[question.model_dump() for question in body.questions],
    )
    return quiz_out(quiz)


@router.get("/quizzes.list")
async def list_quizzes(
    course: str,
    user: CurrentUser,
    session: SessionDep,
    kind: Literal["pop", "grill"] | None = None,
    status: Literal["open", "submitted", "abandoned"] | None = None,
    topic_id: UUID | None = None,
) -> list[QuizOut]:
    row = await _enrolled_course(session, user, course)
    found = await quizzes.for_course(
        session, user=user, course=row, kind=kind, status=status, topic_id=topic_id
    )
    return [quiz_out(quiz) for quiz in found]


@router.get("/quizzes.get")
async def get_quiz(quiz: UUID, user: CurrentUser, session: SessionDep) -> QuizOut:
    return quiz_out(await _own_quiz(session, user, quiz))


@router.post("/quizzes.submit")
async def submit_quiz(body: SubmitQuiz, user: CurrentUser, session: SessionDep) -> QuizOut:
    quiz = await _own_quiz(session, user, body.quiz)
    if quiz.status != "open":
        raise HTTPException(409, f"quiz already {quiz.status}")
    return quiz_out(await quizzes.close(session, quiz, status="submitted", score=body.score))


@router.post("/quizzes.abandon")
async def abandon_quiz(body: QuizRef, user: CurrentUser, session: SessionDep) -> QuizOut:
    quiz = await _own_quiz(session, user, body.quiz)
    if quiz.status != "open":
        raise HTTPException(409, f"quiz already {quiz.status}")
    return quiz_out(await quizzes.close(session, quiz, status="abandoned"))


@router.post("/quizzes.delete")
async def delete_quiz(body: QuizRef, user: CurrentUser, session: SessionDep) -> dict[str, bool]:
    await quizzes.remove(session, await _own_quiz(session, user, body.quiz))
    return {"deleted": True}


@router.post("/quizAnswers.record", status_code=201)
async def record_answer(
    body: RecordAnswer, user: CurrentUser, session: SessionDep
) -> QuizAnswerOut:
    """Answering twice keeps both rows, so a retry is visible in the statistics."""
    question = await _own_question(session, user, body.question)
    if question.quiz.status != "open":
        raise HTTPException(409, f"quiz already {question.quiz.status}")
    answer = await quizzes.record_answer(
        session,
        question=question,
        answer_text=body.answer_text,
        correct=body.correct,
        feedback=body.feedback,
    )
    return QuizAnswerOut.model_validate(answer)


@router.get("/quizStats.byTopic")
async def stats_by_topic(course: str, user: CurrentUser, session: SessionDep) -> list[TopicStat]:
    row = await _enrolled_course(session, user, course)
    return [
        TopicStat.model_validate(stat)
        for stat in await quizzes.by_topic(session, user=user, course=row)
    ]
