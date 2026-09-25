import asyncio
from pathlib import Path
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


def test_replace_forgets_the_file_when_cognify_fails(engine, monkeypatch):
    """Cognee re-runs every item without a completed marker on the next Cognify of the Dataset,
    so a file whose Cognify failed would fail every later file in the course too."""
    added = SimpleNamespace(id=CHUNK, name="deck")
    # Nothing under this name before the add; the half-cognified item afterwards.
    monkeypatch.setattr(module, "get_dataset_data", AsyncMock(side_effect=[[], [added]]))
    monkeypatch.setattr(module.cognee, "add", AsyncMock())
    monkeypatch.setattr(module.cognee, "cognify", AsyncMock(side_effect=RuntimeError("timeout")))
    deleted = AsyncMock()
    monkeypatch.setattr(module.cognee.datasets, "delete_data", deleted)
    dataset, user = SimpleNamespace(id=GLOBAL), SimpleNamespace(id=PRIVATE)

    async def replace():
        async with engine.turn:
            await engine.replace(dataset, user, Path("/uploads/deck.pdf"))

    with pytest.raises(RuntimeError, match="timeout"):
        asyncio.run(replace())
    deleted.assert_awaited_once_with(GLOBAL, CHUNK, user=user, mode="hard")


def test_replace_many_cognifies_several_files_in_one_call(engine, monkeypatch):
    """BENCH-0001: one add and one cognify for the batch; earlier data under a name goes first."""
    stale = SimpleNamespace(id=CHUNK, name="b")
    monkeypatch.setattr(module, "get_dataset_data", AsyncMock(return_value=[stale]))
    added, cognified, deleted = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(module.cognee, "add", added)
    monkeypatch.setattr(module.cognee, "cognify", cognified)
    monkeypatch.setattr(module.cognee.datasets, "delete_data", deleted)
    dataset, user = SimpleNamespace(id=GLOBAL), SimpleNamespace(id=PRIVATE)
    paths = [Path("/uploads/a.pdf"), Path("/uploads/b.pdf")]

    async def replace_many():
        async with engine.turn:
            await engine.replace_many(dataset, user, paths)

    asyncio.run(replace_many())
    deleted.assert_awaited_once_with(GLOBAL, CHUNK, user=user, mode="hard")
    added.assert_awaited_once_with(
        ["/uploads/a.pdf", "/uploads/b.pdf"], dataset_id=GLOBAL, user=user
    )
    cognified.assert_awaited_once_with(
        datasets=[GLOBAL], user=user, data_per_batch=2, chunk_size=None
    )


def test_replace_many_drops_every_file_when_the_batch_fails(engine, monkeypatch):
    """Cognee rolls the whole run back when one item fails, so no half-done file may stay."""
    other = UUID("00000000-0000-0000-0000-000000000004")
    after = [SimpleNamespace(id=CHUNK, name="a"), SimpleNamespace(id=other, name="b")]
    monkeypatch.setattr(module, "get_dataset_data", AsyncMock(side_effect=[[], after]))
    monkeypatch.setattr(module.cognee, "add", AsyncMock())
    monkeypatch.setattr(module.cognee, "cognify", AsyncMock(side_effect=RuntimeError("timeout")))
    deleted = AsyncMock()
    monkeypatch.setattr(module.cognee.datasets, "delete_data", deleted)
    dataset, user = SimpleNamespace(id=GLOBAL), SimpleNamespace(id=PRIVATE)

    async def replace_many():
        async with engine.turn:
            await engine.replace_many(
                dataset, user, [Path("/uploads/a.pdf"), Path("/uploads/b.pdf")]
            )

    with pytest.raises(RuntimeError, match="timeout"):
        asyncio.run(replace_many())
    assert sorted(call.args[1] for call in deleted.await_args_list) == sorted([CHUNK, other])
