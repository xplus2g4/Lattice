from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lattice.config import Settings, get_settings
from lattice.main import create_app

USER = {"X-User": "alice@example.com"}


@pytest.fixture()
def client(tmp_path: Path):
    settings = Settings(
        dev_header_auth=True,
        uploads_dir=tmp_path / "uploads",
        cognee_root=tmp_path / "cognee",
        cors_origins=[],
    )
    app = create_app(settings)
    # Endpoints resolve Settings through the cached get_settings dependency,
    # not the app constructor, so tests must override it.
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


def seed_file(client: TestClient, course: str, name: str, body: bytes = b"x") -> Path:
    uploads = client.app.dependency_overrides[get_settings]().uploads_dir
    path = uploads / course / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


def test_courses_requires_auth(client: TestClient) -> None:
    assert client.get("/courses").status_code == 401


def test_courses_empty(client: TestClient) -> None:
    assert client.get("/courses", headers=USER).json() == []


def test_courses_discovers_upload_dirs(client: TestClient) -> None:
    seed_file(client, "cs3216", "lecture-1.pdf")
    seed_file(client, "cs3216", "lecture-2.pdf")
    seed_file(client, "cs2040s", "tutorial.md")
    (client.app.dependency_overrides[get_settings]().uploads_dir / "NOT-A-COURSE").mkdir()

    res = client.get("/courses", headers=USER)
    assert res.status_code == 200
    assert res.json() == [
        {"code": "cs2040s", "material_count": 1, "note_count": 0, "pending_count": 0},
        {"code": "cs3216", "material_count": 2, "note_count": 0, "pending_count": 0},
    ]


def test_materials_lists_disk_files_as_ready(client: TestClient) -> None:
    seed_file(client, "cs3216", "lecture-1.pdf")

    res = client.get("/courses/cs3216/materials", headers=USER)
    assert res.status_code == 200
    [material] = res.json()
    assert material["filename"] == "lecture-1.pdf"
    assert material["status"] == "ready"


def test_materials_skips_notes_dir_and_dotfiles(client: TestClient) -> None:
    seed_file(client, "cs3216", "notes/u1/n1.md")
    seed_file(client, "cs3216", ".DS_Store")
    seed_file(client, "cs3216", "slides.pdf")

    res = client.get("/courses/cs3216/materials", headers=USER)
    assert [m["filename"] for m in res.json()] == ["slides.pdf"]


def test_get_material_streams_file(client: TestClient) -> None:
    seed_file(client, "cs3216", "memo.txt", b"hello lattice")

    res = client.get("/courses/cs3216/materials/memo.txt", headers=USER)
    assert res.status_code == 200
    assert res.content == b"hello lattice"


def test_get_material_missing(client: TestClient) -> None:
    res = client.get("/courses/cs3216/materials/nope.pdf", headers=USER)
    assert res.status_code == 404


def test_get_material_rejects_traversal(client: TestClient) -> None:
    seed_file(client, "cs3216", "notes/u1/n1.md")

    res = client.get("/courses/cs3216/materials/notes%2Fu1%2Fn1.md", headers=USER)
    # 400 if the guard sees the decoded slash; 404 if routing rejects it first.
    assert res.status_code in (400, 404)


def test_sessions_empty(client: TestClient) -> None:
    res = client.get("/courses/cs3216/sessions", headers=USER)
    assert res.status_code == 200
    assert res.json() == []
