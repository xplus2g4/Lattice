import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

import lattice.engine as module
from lattice.config import Settings
from lattice.db.base import utcnow as now
from lattice.engine import Engine, IsolationError
from lattice.page_notes import PageAnchor, PageNote, text_hash

GLOBAL = UUID("00000000-0000-0000-0000-000000000001")
PRIVATE = UUID("00000000-0000-0000-0000-000000000002")
CHUNK = UUID("00000000-0000-0000-0000-000000000003")


def test_removing_course_clears_only_its_datasets_and_cached_permissions(engine, monkeypatch):
    empty = AsyncMock()
    monkeypatch.setattr(module.cognee.datasets, "empty_dataset", empty)

    async def run():
        principal = await engine.principal("alice@example.com")
        await engine.enrol("cs2100", principal)
        await engine.enrol("cs2100x", principal)
        module.get_authorized_dataset_by_name.reset_mock()
        await engine.delete_course("cs2100", ["alice@example.com"])
        names = [call.args[0] for call in module.get_authorized_dataset_by_name.await_args_list]
        assert names == ["cs2100-global", f"cs2100-user-{principal.id}"]
        assert empty.await_count == 2
        assert all(not name.startswith("cs2100-") for name, _ in engine._datasets)
        assert (principal.id, "cs2100") not in engine._enrolled
        assert (principal.id, "cs2100x") in engine._enrolled

    asyncio.run(run())


@pytest.fixture
def engine(tmp_path, monkeypatch):
    monkeypatch.setattr(
        module, "get_user_by_email", AsyncMock(return_value=SimpleNamespace(id=PRIVATE))
    )
    monkeypatch.setattr(
        module,
        "get_authorized_dataset_by_name",
        AsyncMock(
            side_effect=lambda name, *args: SimpleNamespace(
                id=GLOBAL if name.endswith("-global") else PRIVATE
            )
        ),
    )
    monkeypatch.setattr(module, "give_permission_on_dataset", AsyncMock())
    monkeypatch.setattr(module, "has_dataset_data", AsyncMock(return_value=True))
    return Engine(Settings(_env_file=None, cognee_root=tmp_path / "c"))


def test_official_retrieval_preserves_chunk_identity_and_excludes_private_notes(
    engine, monkeypatch
):
    async def search(question, **kwargs):
        assert kwargs["dataset_ids"] == [GLOBAL]
        assert kwargs["query_type"] == module.SearchType.CHUNKS
        return [
            {
                "dataset_id": GLOBAL,
                "objects_result": [
                    SimpleNamespace(
                        id=CHUNK,
                        payload={
                            "text": "Sign extension repeats the sign bit.",
                            "document_name": "lecture.md",
                            "chunk_index": 0,
                        },
                    )
                ],
            }
        ]

    monkeypatch.setattr(module.cognee, "search", search)
    chunks = asyncio.run(engine.retrieve_official("cs2100", "alice@example.com", "Sign extension"))
    assert chunks[0].chunk_id == CHUNK
    assert chunks[0].text == "Sign extension repeats the sign bit."
    assert chunks[0].material_name == "lecture.md"


def test_official_retrieval_preserves_evidence_late_in_a_long_chunk(engine, monkeypatch):
    fact = "An 8-bit two's-complement integer ranges from -128 to +127."
    text = "Earlier lecture content. " * 250 + fact
    monkeypatch.setattr(
        module.cognee,
        "search",
        AsyncMock(
            return_value=[
                {
                    "dataset_id": GLOBAL,
                    "objects_result": [
                        SimpleNamespace(
                            id=CHUNK,
                            payload={
                                "text": text,
                                "document_name": "lecture.pdf",
                                "chunk_index": 1,
                            },
                        )
                    ],
                }
            ]
        ),
    )
    chunks = asyncio.run(engine.retrieve_official("cs2100", "alice@example.com", fact))
    assert chunks[0].text.endswith(fact)


def test_official_retrieval_rejects_a_private_dataset_result(engine, monkeypatch):
    monkeypatch.setattr(module.cognee, "search", AsyncMock(return_value=[{"dataset_id": PRIVATE}]))
    with pytest.raises(IsolationError):
        asyncio.run(engine.retrieve_official("cs2100", "alice@example.com", "Sign extension"))


def test_clearing_a_page_note_removes_only_its_own_private_content(engine, monkeypatch):
    anchor = PageAnchor(course="cs2100", filename="lecture.md", material_id="a" * 64, page_number=1)
    note = PageNote(
        id="b" * 64,
        anchor=anchor,
        owner="alice@example.com",
        body_md="",
        revision=2,
        content_hash=text_hash(""),
        cognified_revision=1,
        status="cognifying",
        updated_at=now(),
        run_after=None,
    )
    monkeypatch.setattr(
        module,
        "get_dataset_data",
        AsyncMock(
            return_value=[
                SimpleNamespace(id=CHUNK, name=f"page-note-{note.id}"),
                SimpleNamespace(id=GLOBAL, name="legacy-note"),
            ]
        ),
    )
    deleted = AsyncMock()
    added = AsyncMock()
    monkeypatch.setattr(module.cognee.datasets, "delete_data", deleted)
    monkeypatch.setattr(module.cognee, "add", added)
    asyncio.run(engine.cognify_note(note))
    assert deleted.await_args.args[:2] == (PRIVATE, CHUNK)
    assert deleted.await_count == 1
    added.assert_not_awaited()
