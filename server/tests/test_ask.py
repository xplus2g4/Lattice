"""Asking a course: the Session, its Turns, and the feedback left on an answer."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from lattice.config import get_settings
from lattice.db.repo import course_summaries, courses
from lattice.grounding import NOT_COVERED
from lattice.retrieval import Evidence, TierResult
from tests.conftest import basis
from tests.test_materials import BOB, join, upload

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


async def summarised(session: AsyncSession, code: str) -> None:
    """Give a course a summary so it can be a related course. Every summary here is the same
    vector, so whichever other course has one is the nearest."""
    course = await courses.by_code(session, code)
    assert course is not None
    await course_summaries.upsert(
        session,
        course,
        summary_text=code,
        embedding=basis(0),
        embedding_model="fake-embedding",
        source_digest="0" * 64,
    )


async def test_related_courses_are_searched_as_reference_material(
    student: AsyncClient, answering, session: AsyncSession
) -> None:
    """The nearest courses' global tiers are searched too, as the instructor principal, and
    their answers come back labelled `related` with the course they came from."""
    await join(student)
    await join(student, "cs2040")
    week5 = (
        await upload(student, content=b"open addressing", filename="week5.pdf", course="cs2040")
    )["material"]
    for code in ("cs3216", "cs2040"):
        await summarised(session, code)
    answering.results.append(
        TierResult(
            tier="related",
            dataset_name="cs2040-global",
            answer="CS2040 covers open addressing.",
            evidence=[Evidence(kind="segment", chunk_id="chunk-3", document_name=week5["sha256"])],
        )
    )

    answered = await ask(student)

    turn = answered["turn"]
    results = turn["content_json"]["results"]
    assert [(r["tier"], r["course"]) for r in results] == [
        ("course", "cs3216"),
        ("notes", "cs3216"),
        ("related", "cs2040"),
    ]
    # The transcript text is the course's own answer; the related one lives in results.
    assert "open addressing" not in turn["content_json"]["text"]
    assert turn["cited_chunk_ids"] == ["chunk-1", "chunk-2", "chunk-3"]
    # Evidence names the Material by filename: the client cannot list cs2040's Materials.
    assert results[2]["evidence"][0]["document_name"] == "week5.pdf"
    # Searched as the instructor, over cs2040's global dataset and nothing else.
    assert answering.searched_as == ["ada@example.com", "instructor@lattice.example"]
    assert list(answering.searched[1].values()) == ["related"]


async def test_a_related_course_that_declines_is_left_out(
    student: AsyncClient, answering, session: AsyncSession
) -> None:
    """Reference material with nothing on the question adds nothing, so unlike the course's
    own tiers a declining related course is dropped rather than shown declining."""
    await join(student)
    await join(student, "cs2040")
    for code in ("cs3216", "cs2040"):
        await summarised(session, code)
    answering.results.append(
        TierResult(tier="related", dataset_name="cs2040-global", answer=NOT_COVERED, evidence=[])
    )

    answered = await ask(student)

    results = answered["turn"]["content_json"]["results"]
    assert [r["tier"] for r in results] == ["course", "notes"]
    assert len(answering.searched) == 2


async def test_related_courses_are_off_when_k_is_zero(
    student: AsyncClient, answering, session: AsyncSession, app, settings
) -> None:
    await join(student)
    await join(student, "cs2040")
    for code in ("cs3216", "cs2040"):
        await summarised(session, code)
    app.dependency_overrides[get_settings] = lambda: settings.model_copy(
        update={"related_courses_k": 0}
    )

    await ask(student)
    assert len(answering.searched) == 1


async def test_a_course_without_a_summary_has_no_related_courses(
    student: AsyncClient, answering, session: AsyncSession
) -> None:
    """Nothing to compare by yet: the refresh has not seen a ready Material in this course."""
    await join(student)
    await join(student, "cs2040")
    await summarised(session, "cs2040")

    await ask(student)
    assert len(answering.searched) == 1
