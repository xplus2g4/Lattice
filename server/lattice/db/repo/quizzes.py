from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.base import utcnow
from lattice.db.models import Course, Quiz, QuizAnswer, QuizQuestion, User


async def get(db: AsyncSession, quiz_id: UUID) -> Quiz | None:
    return await db.get(Quiz, quiz_id)


async def create(
    db: AsyncSession,
    *,
    user: User,
    course: Course,
    kind: str,
    scope: dict[str, Any],
    questions: list[dict[str, Any]],
) -> Quiz:
    """A Quiz arrives whole: its questions are written with it, in the order given."""
    quiz = Quiz(user_id=user.id, course_id=course.id, kind=kind, scope_json=scope)
    quiz.questions = [
        QuizQuestion(position=position, answers=[], **question)
        for position, question in enumerate(questions)
    ]
    db.add(quiz)
    await db.flush()
    return quiz


async def append(
    db: AsyncSession, quiz: Quiz, *, base: int, questions: list[dict[str, Any]]
) -> list[QuizQuestion]:
    """Questions written later take positions from `base` up, so a batch keeps its place."""
    added = [
        QuizQuestion(position=base + offset, answers=[], **question)
        for offset, question in enumerate(questions)
    ]
    quiz.questions.extend(added)
    await db.flush()
    return added


async def for_course(
    db: AsyncSession,
    *,
    user: User,
    course: Course,
    kind: str | None = None,
    status: str | None = None,
    topic_id: UUID | None = None,
) -> list[Quiz]:
    query = select(Quiz).where(Quiz.user_id == user.id, Quiz.course_id == course.id)
    if kind is not None:
        query = query.where(Quiz.kind == kind)
    if status is not None:
        query = query.where(Quiz.status == status)
    if topic_id is not None:
        query = query.where(Quiz.questions.any(QuizQuestion.topic_id == topic_id))
    return list(await db.scalars(query.order_by(Quiz.created_at.desc())))


async def close(db: AsyncSession, quiz: Quiz, *, status: str, score: float | None = None) -> Quiz:
    quiz.status = status
    quiz.score = score
    quiz.submitted_at = utcnow()
    await db.flush()
    return quiz


async def remove(db: AsyncSession, quiz: Quiz) -> None:
    await db.delete(quiz)
    await db.flush()


async def question(db: AsyncSession, question_id: UUID) -> QuizQuestion | None:
    return await db.get(QuizQuestion, question_id)


async def record_answer(
    db: AsyncSession,
    *,
    question: QuizQuestion,
    answer_text: str,
    correct: bool | None,
    feedback: dict[str, Any] | None,
) -> QuizAnswer:
    """Each attempt is its own row; the attempt number continues where the last one stopped."""
    answer = QuizAnswer(
        question_id=question.id,
        attempt_no=len(question.answers) + 1,
        answer_text=answer_text,
        correct=correct,
        feedback_json=feedback,
    )
    db.add(answer)
    await db.flush()
    await db.refresh(question, ["answers"])
    return answer


async def by_topic(db: AsyncSession, *, user: User, course: Course) -> list[dict[str, Any]]:
    """Attempts and misses per Topic, the input #49 weights future questions with."""
    rows = await db.execute(
        select(
            QuizQuestion.topic_id,
            func.count(QuizAnswer.id),
            func.count(QuizAnswer.id).filter(QuizAnswer.correct.is_(False)),
        )
        .join(QuizAnswer, QuizAnswer.question_id == QuizQuestion.id)
        .join(Quiz, Quiz.id == QuizQuestion.quiz_id)
        .where(Quiz.user_id == user.id, Quiz.course_id == course.id)
        .group_by(QuizQuestion.topic_id)
    )
    return [
        {"topic_id": topic_id, "attempts": attempts, "misses": misses}
        for topic_id, attempts, misses in rows
    ]


async def history(
    db: AsyncSession, *, user: User, course: Course, limit: int = 30
) -> list[dict[str, Any]]:
    """The student's most recent answers in a course, newest first: what the remark reads."""
    rows = await db.execute(
        select(
            Quiz.scope_json,
            QuizQuestion.prompt,
            QuizQuestion.citation_json,
            QuizAnswer.correct,
            QuizAnswer.created_at,
        )
        .join(QuizQuestion, QuizQuestion.quiz_id == Quiz.id)
        .join(QuizAnswer, QuizAnswer.question_id == QuizQuestion.id)
        .where(Quiz.user_id == user.id, Quiz.course_id == course.id)
        .order_by(QuizAnswer.created_at.desc())
        .limit(limit)
    )
    return [
        {
            "topic_label": (citation or {}).get("topic") or (scope or {}).get("topic_label"),
            "page": (citation or {}).get("page"),
            "prompt": prompt,
            "correct": correct,
            "when": created_at.isoformat(timespec="minutes"),
        }
        for scope, prompt, citation, correct, created_at in rows
    ]
