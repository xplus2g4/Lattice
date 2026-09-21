"""Asking a course: the Session, its Turns, and the feedback left on an answer."""

import pytest
from httpx import AsyncClient

from lattice.retrieval import Evidence, TierResult
from tests.test_materials import BOB, join

pytestmark = pytest.mark.asyncio


@pytest.fixture
def answering(engine):
    """The engine answers from both Tiers, citing one chunk in each."""
    engine.results = [
        TierResult(
            tier="course",
            dataset_name="cs3216-global",
            answer="Hash tables are in week 3.",
            evidence=[Evidence(kind="segment", chunk_id="chunk-1", document_name="week3.pdf")],
        ),
        TierResult(
            tier="notes",
            dataset_name="cs3216-user-1",
            answer="You wrote that too.",
            evidence=[Evidence(kind="segment", chunk_id="chunk-2")],
        ),
    ]
    return engine


async def ask(client: AsyncClient, question: str = "when are hash tables?", **body) -> dict:
    response = await client.post("/ask", json={"course": "cs3216", "question": question, **body})
    assert response.status_code == 200, response.text
    return response.json()


async def test_an_answer_is_a_turn_in_a_new_session(student: AsyncClient, answering) -> None:
    await join(student)

    answered = await ask(student)

    assert answered["turn"]["role"] == "assistant"
    assert answered["turn"]["content_json"]["text"].startswith("Hash tables")
    assert answered["turn"]["used_notes"] is True
    assert answered["turn"]["cited_chunk_ids"] == ["chunk-1", "chunk-2"]


async def test_the_conversation_survives_the_request(student: AsyncClient, answering) -> None:
    """The point of the table: a reload replays what was asked, registry.py could not."""
    await join(student)
    first = await ask(student, "first question")

    again = await ask(student, "second question", session=first["session"])

    session = await student.get("/sessions.get", params={"session": first["session"]})
    roles = [turn["role"] for turn in session.json()["turns"]]
    assert roles == ["user", "assistant", "user", "assistant"]
    assert again["session"] == first["session"]


async def test_the_question_is_kept_beside_the_answer(student: AsyncClient, answering) -> None:
    await join(student)
    answered = await ask(student, "when are hash tables?")

    session = await student.get("/sessions.get", params={"session": answered["session"]})
    asked = session.json()["turns"][0]
    assert (asked["role"], asked["content_json"]["text"]) == ("user", "when are hash tables?")


async def test_sessions_are_listed_newest_first(student: AsyncClient, answering) -> None:
    await join(student)
    older = await ask(student, "first")
    newer = await ask(student, "second")

    listed = await student.get("/sessions.list", params={"course": "cs3216"})
    assert [s["id"] for s in listed.json()] == [newer["session"], older["session"]]


async def test_a_session_belongs_to_the_student_who_asked(student: AsyncClient, answering) -> None:
    await join(student)
    mine = await ask(student)
    await student.post("/enrolments.join", json={"course": "cs3216"}, headers=BOB)

    stolen = await student.get("/sessions.get", params={"session": mine["session"]}, headers=BOB)
    assert stolen.status_code == 404


async def test_asking_needs_enrolment(student: AsyncClient, answering) -> None:
    await join(student)

    response = await student.post(
        "/ask", json={"course": "cs3216", "question": "let me in"}, headers=BOB
    )
    assert response.status_code == 403


async def test_opting_out_leaves_the_private_tier_unsearched(
    student: AsyncClient, answering
) -> None:
    await join(student)
    await student.post("/me.update", json={"notes_opt_out": True})

    await ask(student)
    assert [tier for tier in answering.searched[-1].values()] == ["course"]


async def test_a_failing_engine_is_a_bad_gateway(student: AsyncClient, engine) -> None:
    await join(student)
    engine.fail_with = RuntimeError("cognee is down")

    response = await student.post("/ask", json={"course": "cs3216", "question": "hello"})
    assert response.status_code == 502


async def test_feedback_is_one_rating_per_turn(student: AsyncClient, answering) -> None:
    await join(student)
    answered = await ask(student)
    turn = answered["turn"]["id"]

    assert (await student.post("/feedback.record", json={"turn": turn, "rating": 1})).json() == {
        "rating": 1
    }
    changed = await student.post(
        "/feedback.record", json={"turn": turn, "rating": -1, "comment": "wrong week"}
    )
    assert changed.json() == {"rating": -1}


async def test_feedback_needs_your_own_session(student: AsyncClient, answering) -> None:
    await join(student)
    answered = await ask(student)
    await student.post("/enrolments.join", json={"course": "cs3216"}, headers=BOB)

    response = await student.post(
        "/feedback.record", json={"turn": answered["turn"]["id"], "rating": 1}, headers=BOB
    )
    assert response.status_code == 404


async def test_only_an_answer_can_be_rated(student: AsyncClient, answering) -> None:
    await join(student)
    answered = await ask(student)
    session = await student.get("/sessions.get", params={"session": answered["session"]})
    question = session.json()["turns"][0]["id"]

    response = await student.post("/feedback.record", json={"turn": question, "rating": 1})
    assert response.status_code == 422


async def test_asking_needs_an_identity(client: AsyncClient) -> None:
    response = await client.post("/ask", json={"course": "cs3216", "question": "hello"})
    assert response.status_code == 401
