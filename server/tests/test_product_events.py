"""Product events written by the course, Note and Quiz routes, inside the action's transaction."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.db.models import Course, ProductEvent
from tests.test_materials import join
from tests.test_notes import save
from tests.test_quizzes import answer, create, question

pytestmark = pytest.mark.asyncio


async def events(session: AsyncSession, name: str) -> list[ProductEvent]:
    return list(
        await session.scalars(
            select(ProductEvent).where(ProductEvent.name == name).order_by(ProductEvent.occurred_at)
        )
    )


async def course_id(session: AsyncSession, code: str = "cs3216"):
    return (await session.scalar(select(Course).where(Course.code == code))).id


async def test_joining_records_once_and_leaving_records_the_departure(
    student: AsyncClient, session: AsyncSession
) -> None:
    await join(student)
    await student.post("/enrolments.join", json={"course": "cs3216"})
    assert len(await events(session, "course.joined")) == 1

    await student.post("/enrolments.leave", json={"course": "cs3216"})
    await student.post("/enrolments.leave", json={"course": "cs3216"})
    left = await events(session, "course.left")
    assert len(left) == 1
    assert left[0].course_id == await course_id(session)
    assert left[0].properties == {}


async def test_saving_a_note_records_its_size(student: AsyncClient, session: AsyncSession) -> None:
    await join(student)
    note = await save(student, body_md="hash collisions: two keys, one bucket")

    (saved,) = await events(session, "note.saved")
    assert saved.course_id == await course_id(session)
    assert saved.properties == {"note_id": note["id"], "chars": 37}


async def test_a_quiz_records_its_start_and_the_correct_count_at_submit(
    student: AsyncClient, session: AsyncSession
) -> None:
    await join(student)
    quiz = await create(student, questions=[question("q1"), question("q2"), question("q3")])
    q1, q2, _ = (q["id"] for q in quiz["questions"])
    await answer(student, q1, "wrong", correct=False)
    await answer(student, q1, "right on retry", correct=True)
    await answer(student, q2, "wrong", correct=False)
    await student.post("/quizzes.submit", json={"quiz": quiz["id"], "score": 0.33})

    (started,) = await events(session, "quiz.started")
    (submitted,) = await events(session, "quiz.submitted")
    assert started.course_id == submitted.course_id == await course_id(session)
    assert started.properties == {"quiz_id": quiz["id"], "kind": "pop", "questions": 3}
    assert submitted.properties == {
        "quiz_id": quiz["id"],
        "kind": "pop",
        "questions": 3,
        "correct": 1,
    }


async def test_abandoning_a_quiz_records_it(student: AsyncClient, session: AsyncSession) -> None:
    await join(student)
    quiz = await create(student, kind="grill")
    await student.post("/quizzes.abandon", json={"quiz": quiz["id"]})

    (abandoned,) = await events(session, "quiz.abandoned")
    assert abandoned.properties == {"quiz_id": quiz["id"], "kind": "grill", "questions": 1}
    assert await events(session, "quiz.submitted") == []
