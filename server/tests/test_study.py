from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from lattice.config import Settings
from lattice.main import create_app
from lattice.registry import Evidence, TierResult

ALICE = "alice@example.com"
BOB = "bob@example.com"
GLOBAL = UUID("00000000-0000-0000-0000-000000000001")
PRIVATE = UUID("00000000-0000-0000-0000-000000000002")


@pytest.fixture
def study_client(tmp_path):
    app = create_app(
        Settings(
            _env_file=None,
            dev_header_auth=True,
            cognee_root=tmp_path / "c",
            uploads_dir=tmp_path / "u",
        )
    )
    engine = SimpleNamespace(
        principal=AsyncMock(return_value=SimpleNamespace(id=PRIVATE)),
        enrol=AsyncMock(return_value=(SimpleNamespace(id=GLOBAL), SimpleNamespace(id=PRIVATE))),
        search=AsyncMock(return_value=[]),
        replace=AsyncMock(),
    )
    app.state.engine = engine
    return TestClient(app), engine


@pytest.mark.parametrize(
    "query_type", ["GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS"]
)
def test_ask_returns_both_tiers_and_records_a_session(study_client, query_type):
    client, engine = study_client
    engine.search.return_value = [
        TierResult(tier="course", dataset_name="cs2100-global", answer="Official", evidence=[]),
        TierResult(
            tier="notes",
            dataset_name="private",
            answer="My explanation",
            evidence=[Evidence.model_validate({"kind": "segment", "chunk_id": "n1"})],
        ),
    ]
    response = client.post(
        "/courses/cs2100/ask",
        headers={"X-User": ALICE},
        json={"question": "Explain sign extension", "query_type": query_type},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["turn"]["content"] == "Official\n\nMy explanation"
    assert body["turn"]["used_notes"] is True
    assert [r["tier"] for r in body["turn"]["results"]] == ["course", "notes"]
    session = client.get(
        f"/courses/cs2100/sessions/{body['session_id']}", headers={"X-User": ALICE}
    )
    assert [t["role"] for t in session.json()["turns"]] == ["user", "assistant"]


def test_chunks_marks_retrieved_private_notes_without_generated_evidence(study_client):
    client, engine = study_client
    engine.search.return_value = [
        TierResult(tier="notes", dataset_name="private", answer="My private thought", evidence=[])
    ]
    response = client.post(
        "/courses/cs2100/ask",
        headers={"X-User": ALICE},
        json={"question": "My thought?", "query_type": "CHUNKS"},
    )
    assert response.status_code == 200
    assert response.json()["turn"]["used_notes"] is True


def test_rest_dependencies_use_the_app_settings(tmp_path):
    app = create_app(
        Settings(
            _env_file=None, dev_header_auth=False, mcp_enabled=False, cognee_root=tmp_path / "c"
        )
    )
    response = TestClient(app).get("/courses/cs2100/notes", headers={"X-User": ALICE})
    assert response.status_code == 401


def test_empty_course_returns_no_results(study_client):
    client, _ = study_client
    response = client.post(
        "/courses/cs2100/ask", headers={"X-User": ALICE}, json={"question": "Anything?"}
    )
    assert response.status_code == 200
    assert response.json()["turn"]["results"] == []
    assert response.json()["turn"]["used_notes"] is False


@pytest.mark.parametrize("course,user", [("cs2100", BOB), ("cs101", ALICE)])
def test_session_cannot_be_reused_by_another_user_or_course(study_client, course, user):
    client, _ = study_client
    first = client.post(
        "/courses/cs2100/ask", headers={"X-User": ALICE}, json={"question": "Hello"}
    ).json()
    response = client.post(
        f"/courses/{course}/ask",
        headers={"X-User": user},
        json={"question": "Again", "session_id": first["session_id"]},
    )
    assert response.status_code == 403
    assert (
        client.get(
            f"/courses/{course}/sessions/{first['session_id']}", headers={"X-User": user}
        ).status_code
        == 404
    )


def test_search_failure_does_not_append_partial_turns(study_client):
    client, engine = study_client
    first = client.post(
        "/courses/cs2100/ask", headers={"X-User": ALICE}, json={"question": "Hello"}
    ).json()
    engine.search.side_effect = RuntimeError("unavailable")
    failed = client.post(
        "/courses/cs2100/ask",
        headers={"X-User": ALICE},
        json={"question": "Again", "session_id": first["session_id"]},
    )
    assert failed.status_code == 502
    session = client.get(
        f"/courses/cs2100/sessions/{first['session_id']}", headers={"X-User": ALICE}
    ).json()
    assert len(session["turns"]) == 2


def test_note_save_is_private_and_preserves_markdown(study_client, tmp_path):
    client, _ = study_client
    saved = client.put(
        "/courses/cs2100/notes/lecture-1",
        headers={"X-User": ALICE},
        json={"body_md": "# My Note\n\nSign extension copies the sign bit."},
    )
    assert saved.status_code == 202
    target = tmp_path / "u" / "cs2100" / "notes" / str(PRIVATE) / "lecture-1.md"
    assert target.read_text() == "# My Note\n\nSign extension copies the sign bit."
    notes = client.get("/courses/cs2100/notes", headers={"X-User": ALICE}).json()
    assert notes[0]["body_md"] == "# My Note\n\nSign extension copies the sign bit."
    assert notes[0]["status"] == "ready"
    assert client.get("/courses/cs2100/notes", headers={"X-User": BOB}).json() == []
    assert client.get("/courses/cs101/notes", headers={"X-User": ALICE}).json() == []
