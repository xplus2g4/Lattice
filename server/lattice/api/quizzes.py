"""Grill me over the wire: plan a Quiz over a whole Material, write its questions batch by
batch, grade it in one submit.

Records are `quiz_records.py`'s; the writing, grading and remark are `lattice.quiz`'s. This
module joins the two and keeps the answer key on the server until the Quiz is graded.
"""

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.api.deps import COURSE_CODE, CurrentUser, EngineDep, SessionDep, SettingsDep
from lattice.api.quiz_records import _enrolled_course, _own_quiz
from lattice.api.schemas import (
    BatchOut,
    GradedQuizOut,
    GrillPlanOut,
    QuizQuestionOut,
    question_out,
    quiz_out,
)
from lattice.config import Settings
from lattice.db.models import Course, Material, Quiz
from lattice.db.repo import materials, quizzes
from lattice.quiz import (
    BATCH_STRIDE,
    HISTORY_LIMIT,
    Asked,
    Grill,
    GrillError,
    page_count,
    page_text,
    plan_batches,
    questions_per_batch,
)

router = APIRouter(tags=["quizzes"])


class GenerateGrill(BaseModel):
    course: str = Field(pattern=COURSE_CODE.pattern)
    material: UUID


class ExtendGrill(BaseModel):
    quiz: UUID
    batch: int = Field(ge=0)


class GivenAnswer(BaseModel):
    question: UUID
    answer_text: str = Field(max_length=10_000)


class GradeGrill(BaseModel):
    quiz: UUID
    answers: list[GivenAnswer] = Field(min_length=1, max_length=100)


def _stored_file(material: Material, course: Course, settings: Settings) -> Path:
    path = Path(material.storage_uri).resolve()
    if path.parent != (settings.uploads_dir / course.code).resolve() or not path.is_file():
        raise HTTPException(404, "material bytes are unavailable")
    return path


def _batches(quiz: Quiz) -> list[tuple[int, int]]:
    return [(int(start), int(end)) for start, end in quiz.scope_json.get("batches", [])]


@router.post("/quizzes.generate", status_code=201)
async def generate_quiz(
    body: GenerateGrill,
    user: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
) -> GrillPlanOut:
    """Plan a Grill over every page of a Material. No question is written yet: the client
    asks for each batch with `quizzes.extend`, all at once, and shows them as they land."""
    course = await _enrolled_course(session, user, body.course)
    material = await materials.get(session, body.material)
    if material is None or material.course_id != course.id:
        raise HTTPException(404, "no such material")
    path = _stored_file(material, course, settings)
    try:
        batches = plan_batches(page_count(path))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    quiz = await quizzes.create(
        session,
        user=user,
        course=course,
        kind="grill",
        scope={
            "material_id": str(material.id),
            "page_start": 1,
            "page_end": batches[-1][1],
            "topic_label": material.title,
            "batches": [list(batch) for batch in batches],
        },
        questions=[],
    )
    return GrillPlanOut(
        quiz=quiz_out(quiz),
        batches=[
            BatchOut(index=index, page_start=start, page_end=end)
            for index, (start, end) in enumerate(batches)
        ],
    )


@router.post("/quizzes.extend")
async def extend_quiz(
    body: ExtendGrill,
    user: CurrentUser,
    session: SessionDep,
    engine: EngineDep,
    settings: SettingsDep,
) -> list[QuizQuestionOut]:
    """Write one batch's questions. Asking twice for the same batch returns what the first
    call wrote, so a retry after a lost response never doubles the questions."""
    quiz = await _own_quiz(session, user, body.quiz)
    if quiz.status != "open":
        raise HTTPException(409, f"quiz already {quiz.status}")
    batches = _batches(quiz)
    if body.batch >= len(batches):
        raise HTTPException(422, "no such batch")
    written_before = _written(quiz, body.batch)
    if written_before:
        return [question_out(question, withhold=True) for question in written_before]
    course = await session.get(Course, quiz.course_id)
    material = await materials.get(session, UUID(str(quiz.scope_json["material_id"])))
    if material is None or course is None:
        raise HTTPException(404, "no such material")
    start, end = batches[body.batch]
    try:
        pages = page_text(_stored_file(material, course, settings), start, end)
        written = await Grill(engine.generate).write(pages, count=questions_per_batch(len(batches)))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except GrillError as exc:
        raise HTTPException(502, str(exc)) from exc
    rows = [
        {
            "kind": question.kind,
            "prompt": question.prompt,
            "material_id": material.id,
            "options_json": question.options,
            "expected_json": {"answer": question.answer, "explanation": question.explanation},
            "citation_json": {"page": question.page, "topic": written.topic_label},
        }
        for question in written.questions
    ]
    try:
        async with session.begin_nested():
            added = await quizzes.append(
                session, quiz, base=body.batch * BATCH_STRIDE, questions=rows
            )
    except IntegrityError:
        # Two requests raced for the same batch; the first one's questions stand.
        await session.refresh(quiz, ["questions"])
        added = _written(quiz, body.batch)
    return [question_out(question, withhold=True) for question in added]


def _written(quiz: Quiz, batch: int) -> list:
    return [q for q in quiz.questions if q.position // BATCH_STRIDE == batch]


@router.post("/quizzes.grade")
async def grade_quiz(
    body: GradeGrill, user: CurrentUser, session: SessionDep, engine: EngineDep
) -> GradedQuizOut:
    """Every question answered at once; the Quiz closes with a score and a remark."""
    quiz = await _own_quiz(session, user, body.quiz)
    if quiz.status != "open":
        raise HTTPException(409, f"quiz already {quiz.status}")
    if not quiz.questions:
        raise HTTPException(422, "this quiz has no questions yet")
    by_id = {question.id: question for question in quiz.questions}
    given = {answer.question: answer.answer_text for answer in body.answers}
    if set(given) != set(by_id):
        raise HTTPException(422, "answer every question of this quiz, and only those")
    grill = Grill(engine.generate)
    asked = [
        Asked(
            position=question.position,
            kind=question.kind,
            prompt=question.prompt,
            answer=(question.expected_json or {}).get("answer", ""),
        )
        for question in quiz.questions
    ]
    try:
        grades = await grill.grade(
            asked, {by_id[qid].position: text for qid, text in given.items()}
        )
    except GrillError as exc:
        raise HTTPException(502, str(exc)) from exc
    for question, grade in zip(quiz.questions, grades, strict=True):
        await quizzes.record_answer(
            session,
            question=question,
            answer_text=given[question.id],
            correct=grade.correct,
            feedback={"reason": grade.reason},
        )
    score = sum(grade.correct is True for grade in grades) / len(grades)
    await quizzes.close(session, quiz, status="submitted", score=score)
    course = await session.get(Course, quiz.course_id)
    remark = await grill.remark(
        await quizzes.history(session, user=user, course=course, limit=HISTORY_LIMIT)
    )
    return GradedQuizOut(quiz=quiz_out(quiz), remark=remark)


__all__ = ["router"]


def _unused(_: AsyncSession) -> None:  # pragma: no cover
    """Keeps the AsyncSession import honest for type checkers; SessionDep carries the type."""
