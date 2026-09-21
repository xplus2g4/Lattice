"""Quiz records: persistence, attempts, privacy, lifecycle, and per-Topic statistics."""

import pytest
from httpx import AsyncClient

from tests.test_materials import BOB, join, upload

pytestmark = pytest.mark.asyncio


def question(prompt: str = "What is a hash collision?", **extra) -> dict:
    return {"kind": "short_answer", "prompt": prompt, **extra}


async def create(client: AsyncClient, headers: dict | None = None, **body) -> dict:
    payload = {"course": "cs3216", "kind": "pop", "questions": [question()], **body}
    response = await client.post("/quizzes.create", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def answer(client: AsyncClient, question_id: str, text: str, correct: bool | None) -> dict:
    response = await client.post(
        "/quizAnswers.record",
        json={"question": question_id, "answer_text": text, "correct": correct},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def topic_id(client: AsyncClient) -> str:
    material = (await upload(client))["material"]["id"]
    topics = await client.post(
        "/topics.replace",
        json={
            "material": material,
            "topics": [{"label": "Hashing", "page_start": 1, "page_end": 4}],
        },
    )
    return topics.json()[0]["id"]


async def test_creating_a_quiz_keeps_its_questions_in_order(student: AsyncClient) -> None:
    await join(student)

    quiz = await create(
        student,
        kind="grill",
        scope={"weeks": [3]},
        questions=[question("first"), question("second", kind="mcq", options_json=["a", "b"])],
    )

    assert quiz["status"] == "open"
    assert quiz["scope_json"] == {"weeks": [3]}
    asked = [(q["position"], q["prompt"]) for q in quiz["questions"]]
    assert asked == [(0, "first"), (1, "second")]
    assert quiz["questions"][1]["options_json"] == ["a", "b"]


async def test_a_quiz_survives_the_request(student: AsyncClient) -> None:
    """#44: results are records, not something held in memory until the tab closes."""
    await join(student)
    quiz = await create(student)

    fetched = await student.get("/quizzes.get", params={"quiz": quiz["id"]})
    assert fetched.status_code == 200
    assert fetched.json()["id"] == quiz["id"]


async def test_a_quiz_needs_an_enrolment(student: AsyncClient) -> None:
    await join(student)

    response = await student.post(
        "/quizzes.create",
        json={"course": "cs3216", "kind": "pop", "questions": [question()]},
        headers=BOB,
    )
    assert response.status_code == 403


async def test_a_question_cannot_cite_another_course(student: AsyncClient) -> None:
    await join(student)
    await join(student, code="cs3217")
    elsewhere = (await upload(student, course="cs3217"))["material"]["id"]

    response = await student.post(
        "/quizzes.create",
        json={
            "course": "cs3216",
            "kind": "pop",
            "questions": [question(material_id=elsewhere)],
        },
    )
    assert response.status_code == 404


async def test_answering_twice_keeps_both_attempts(student: AsyncClient) -> None:
    """#43: a retry is a second row, so the first miss stays visible."""
    await join(student)
    quiz = await create(student)
    question_id = quiz["questions"][0]["id"]

    first = await answer(student, question_id, "no idea", correct=False)
    second = await answer(student, question_id, "two keys, one bucket", correct=True)

    assert (first["attempt_no"], second["attempt_no"]) == (1, 2)
    fetched = await student.get("/quizzes.get", params={"quiz": quiz["id"]})
    attempts = fetched.json()["questions"][0]["answers"]
    assert [(a["attempt_no"], a["correct"]) for a in attempts] == [(1, False), (2, True)]


async def test_submitting_closes_the_quiz_with_its_score(student: AsyncClient) -> None:
    await join(student)
    quiz = await create(student)

    submitted = await student.post("/quizzes.submit", json={"quiz": quiz["id"], "score": 0.5})
    assert submitted.json()["status"] == "submitted"
    assert submitted.json()["score"] == 0.5
    assert submitted.json()["submitted_at"] is not None


async def test_a_closed_quiz_takes_no_more_answers(student: AsyncClient) -> None:
    await join(student)
    quiz = await create(student)
    await student.post("/quizzes.abandon", json={"quiz": quiz["id"]})

    response = await student.post(
        "/quizAnswers.record",
        json={"question": quiz["questions"][0]["id"], "answer_text": "late"},
    )
    assert response.status_code == 409


async def test_a_quiz_closes_once(student: AsyncClient) -> None:
    await join(student)
    quiz = await create(student)
    await student.post("/quizzes.submit", json={"quiz": quiz["id"]})

    again = await student.post("/quizzes.submit", json={"quiz": quiz["id"]})
    assert again.status_code == 409


async def test_listing_filters_by_kind_and_status(student: AsyncClient) -> None:
    await join(student)
    pop = await create(student)
    await create(student, kind="grill")
    await student.post("/quizzes.submit", json={"quiz": pop["id"]})

    listed = await student.get("/quizzes.list", params={"course": "cs3216", "kind": "pop"})
    assert [q["id"] for q in listed.json()] == [pop["id"]]
    open_ones = await student.get("/quizzes.list", params={"course": "cs3216", "status": "open"})
    assert [q["kind"] for q in open_ones.json()] == ["grill"]


async def test_listing_filters_by_topic(student: AsyncClient) -> None:
    await join(student)
    topic = await topic_id(student)
    on_topic = await create(student, questions=[question(topic_id=topic)])
    await create(student)

    listed = await student.get("/quizzes.list", params={"course": "cs3216", "topic_id": topic})
    assert [q["id"] for q in listed.json()] == [on_topic["id"]]


async def test_another_students_quiz_is_invisible(student: AsyncClient) -> None:
    await join(student)
    await join(student, code="cs3216", headers=BOB)
    quiz = await create(student)

    peeked = await student.get("/quizzes.get", params={"quiz": quiz["id"]}, headers=BOB)
    assert peeked.status_code == 404
    listed = await student.get("/quizzes.list", params={"course": "cs3216"}, headers=BOB)
    assert listed.json() == []
    answered = await student.post(
        "/quizAnswers.record",
        json={"question": quiz["questions"][0]["id"], "answer_text": "peeking"},
        headers=BOB,
    )
    assert answered.status_code == 404


async def test_deleting_a_quiz_takes_its_answers(student: AsyncClient) -> None:
    await join(student)
    quiz = await create(student)
    await answer(student, quiz["questions"][0]["id"], "guess", correct=False)

    await student.post("/quizzes.delete", json={"quiz": quiz["id"]})
    assert (await student.get("/quizzes.get", params={"quiz": quiz["id"]})).status_code == 404
    stats = await student.get("/quizStats.byTopic", params={"course": "cs3216"})
    assert stats.json() == []


async def test_stats_count_attempts_and_misses_per_topic(student: AsyncClient) -> None:
    """#49 weights future questions on these counts, so a miss must outlive the Quiz."""
    await join(student)
    topic = await topic_id(student)
    quiz = await create(student, questions=[question(topic_id=topic)])
    question_id = quiz["questions"][0]["id"]
    await answer(student, question_id, "no idea", correct=False)
    await answer(student, question_id, "two keys, one bucket", correct=True)

    stats = await student.get("/quizStats.byTopic", params={"course": "cs3216"})
    assert stats.json() == [{"topic_id": topic, "attempts": 2, "misses": 1}]


async def test_stats_ignore_another_students_answers(student: AsyncClient) -> None:
    await join(student)
    await join(student, code="cs3216", headers=BOB)
    topic = await topic_id(student)
    mine = await create(student, questions=[question(topic_id=topic)])
    await answer(student, mine["questions"][0]["id"], "wrong", correct=False)

    stats = await student.get("/quizStats.byTopic", params={"course": "cs3216"}, headers=BOB)
    assert stats.json() == []


async def test_quizzes_need_an_identity(client: AsyncClient) -> None:
    response = await client.get("/quizStats.byTopic", params={"course": "cs3216"})
    assert response.status_code == 401
