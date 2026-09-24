"""Grill me over the wire: write a Quiz from a page range, grade it in one submit.

Records are `quiz_records.py`'s; the writing, grading and remark are `lattice.quiz`'s. This
module joins the two and keeps the answer key on the server until the Quiz is graded.
"""

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lattice.api.deps import COURSE_CODE, CurrentUser, EngineDep, SessionDep, SettingsDep
from lattice.api.quiz_records import _enrolled_course, _own_quiz
from lattice.api.schemas import GradedQuizOut, QuizOut, quiz_out
from lattice.db.models import Course
from lattice.db.repo import materials, quizzes
from lattice.quiz import HISTORY_LIMIT, MAX_PAGES, Asked, Grill, GrillError, page_text

router = APIRouter(tags=["quizzes"])


class GenerateGrill(BaseModel):
    course: str = Field(pattern=COURSE_CODE.pattern)
    material: UUID
    page_start: int = Field(ge=1)
    page_end: int = Field(ge=1)


class GivenAnswer(BaseModel):
    question: UUID
    answer_text: str = Field(max_length=10_000)


class GradeGrill(BaseModel):
    quiz: UUID
    answers: list[GivenAnswer] = Field(min_length=1, max_length=50)


@router.post("/quizzes.generate", status_code=201)
async def generate_quiz(
    body: GenerateGrill,
    user: CurrentUser,
    session: SessionDep,
    engine: EngineDep,
    settings: SettingsDep,
) -> QuizOut:
    """Up to ten questions on one Material's page range, answer key withheld."""
    course = await _enrolled_course(session, user, body.course)
    material = await materials.get(session, body.material)
    if material is None or material.course_id != course.id:
        raise HTTPException(404, "no such material")
    if body.page_end < body.page_start:
        raise HTTPException(422, "page_end is before page_start")
    if body.page_end - body.page_start + 1 > MAX_PAGES:
        raise HTTPException(422, f"at most {MAX_PAGES} pages per quiz")
    path = Path(material.storage_uri).resolve()
    if path.parent != (settings.uploads_dir / course.code).resolve() or not path.is_file():
        raise HTTPException(404, "material bytes are unavailable")
    try:
        pages = page_text(path, body.page_start, body.page_end)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        written = await Grill(engine.generate).write(pages)
    except GrillError as exc:
        raise HTTPException(502, str(exc)) from exc
    quiz = await quizzes.create(
        session,
        user=user,
        course=course,
        kind="grill",
        scope={
            "material_id": str(material.id),
            "page_start": pages[0].page,
            "page_end": pages[-1].page,
            "topic_label": written.topic_label,
        },
        questions=[
            {
                "kind": question.kind,
                "prompt": question.prompt,
                "material_id": material.id,
                "options_json": question.options,
                "expected_json": {"answer": question.answer, "explanation": question.explanation},
                "citation_json": {"page": question.page},
            }
            for question in written.questions
        ],
    )
    return quiz_out(quiz)


@router.post("/quizzes.grade")
async def grade_quiz(
    body: GradeGrill, user: CurrentUser, session: SessionDep, engine: EngineDep
) -> GradedQuizOut:
    """Every question answered at once; the Quiz closes with a score and a remark."""
    quiz = await _own_quiz(session, user, body.quiz)
    if quiz.status != "open":
        raise HTTPException(409, f"quiz already {quiz.status}")
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
