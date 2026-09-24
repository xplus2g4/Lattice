import httpx
import pytest

from lattice.config import Settings
from lattice.grounding import NOT_COVERED
from lattice.main import create_app
from lattice.retrieval import Evidence, TierResult
from tests.test_materials import BOB, join

pytestmark = pytest.mark.asyncio


@pytest.mark.parametrize(
    "query_type", ["GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS"]
)
async def test_ask_returns_both_tiers_and_records_a_session(student, engine, query_type):
    await join(student, "cs2100")
    engine.results = [
        TierResult(tier="course", dataset_name="cs2100-global", answer="Official", evidence=[]),
        TierResult(
            tier="notes",
            dataset_name="private",
            answer="My explanation",
            evidence=[Evidence(kind="segment", chunk_id="n1")],
        ),
    ]
    response = await student.post(
        "/ask", json={"course": "cs2100", "question": "Explain", "query_type": query_type}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["turn"]["content_json"]["text"] == "Official\n\nMy explanation"
    assert body["turn"]["used_notes"] is True
    assert [r["tier"] for r in body["turn"]["content_json"]["results"]] == ["course", "notes"]
    session = await student.get("/sessions.get", params={"session": body["session"]})
    assert [t["role"] for t in session.json()["turns"]] == ["user", "assistant"]


async def test_answer_leads_with_the_course_and_leaves_out_a_tier_that_declined(student, engine):
    await join(student, "cs2100")
    engine.results = [
        TierResult(tier="notes", dataset_name="private", answer=NOT_COVERED, evidence=[]),
        TierResult(tier="course", dataset_name="cs2100-global", answer="Chaining.", evidence=[]),
    ]
    response = await student.post("/ask", json={"course": "cs2100", "question": "Collisions?"})
    assert response.status_code == 200
    content = response.json()["turn"]["content_json"]
    assert content["text"] == "Chaining."
    assert [r["tier"] for r in content["results"]] == ["course", "notes"]
    # The declining tier stays on record; only the composed answer leaves it out.
    assert content["results"][1]["answer"] == NOT_COVERED


async def test_answer_declines_once_when_no_tier_covers_the_question(student, engine):
    await join(student, "cs2100")
    engine.results = [
        TierResult(tier="course", dataset_name="cs2100-global", answer=NOT_COVERED, evidence=[]),
        TierResult(
            tier="notes",
            dataset_name="private",
            answer=f"Sorry, {NOT_COVERED[0].lower()}{NOT_COVERED[1:]}",
            evidence=[],
        ),
    ]
    response = await student.post("/ask", json={"course": "cs2100", "question": "Deadline?"})
    assert response.status_code == 200
    assert response.json()["turn"]["content_json"]["text"] == NOT_COVERED


async def test_chunks_marks_retrieved_private_notes_without_generated_evidence(student, engine):
    await join(student, "cs2100")
    engine.results = [
        TierResult(tier="notes", dataset_name="private", answer="My thought", evidence=[])
    ]
    response = await student.post(
        "/ask", json={"course": "cs2100", "question": "My thought?", "query_type": "CHUNKS"}
    )
    assert response.status_code == 200
    assert response.json()["turn"]["used_notes"] is True


async def test_rest_dependencies_use_the_app_settings(tmp_path):
    app = create_app(
        Settings(
            _env_file=None, dev_header_auth=False, mcp_enabled=False, cognee_root=tmp_path / "c"
        )
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/notes.list", params={"course": "cs2100"}, headers={"X-User": "ada@example.com"}
        )
    assert response.status_code == 401


async def test_empty_course_returns_no_results(student):
    await join(student, "cs2100")
    response = await student.post("/ask", json={"course": "cs2100", "question": "Anything?"})
    assert response.status_code == 200
    assert response.json()["turn"]["content_json"]["results"] == []
    assert response.json()["turn"]["used_notes"] is False


@pytest.mark.parametrize("foreign_user", [False, True])
async def test_session_cannot_be_reused_by_another_user_or_course(student, foreign_user):
    await join(student, "cs2100")
    await join(student, "cs101")
    await student.post("/enrolments.join", json={"course": "cs2100"}, headers=BOB)
    first = (await student.post("/ask", json={"course": "cs2100", "question": "Hello"})).json()
    headers = BOB if foreign_user else None
    response = await student.post(
        "/ask",
        headers=headers,
        json={
            "course": "cs2100" if foreign_user else "cs101",
            "question": "Again",
            "session": first["session"],
        },
    )
    assert response.status_code == (404 if foreign_user else 403)


async def test_search_failure_does_not_append_partial_turns(student, engine):
    await join(student, "cs2100")
    first = (await student.post("/ask", json={"course": "cs2100", "question": "Hello"})).json()
    engine.fail_with = RuntimeError("unavailable")
    failed = await student.post(
        "/ask", json={"course": "cs2100", "question": "Again", "session": first["session"]}
    )
    assert failed.status_code == 502
    session = await student.get("/sessions.get", params={"session": first["session"]})
    assert len(session.json()["turns"]) == 2


async def test_note_save_is_private_and_preserves_markdown(student):
    await join(student, "cs2100")
    saved = await student.post(
        "/notes.save",
        json={"course": "cs2100", "body_md": "# My Note\n\nSign extension copies the sign bit."},
    )
    assert saved.status_code == 202
    notes = (await student.get("/notes.list", params={"course": "cs2100"})).json()
    assert notes[0]["body_md"] == "# My Note\n\nSign extension copies the sign bit."
    assert notes[0]["status"] == "dirty"
    assert (await student.get("/notes.list", params={"course": "cs2100"}, headers=BOB)).json() == []
