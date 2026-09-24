import hashlib
from uuid import UUID
from zipfile import ZipFile

import pytest
import pytest_asyncio

from lattice.db.models import Note
from lattice.ingest import Ingest
from lattice.page_notes import PageAnchor, PageNotes, RevisionConflict, material_context
from tests.test_materials import BOB, join, upload

ALICE = "ada@example.com"
BOB_EMAIL = "bob@example.com"
CONTENT = b"Sign extension repeats the sign bit."
pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def anchor(student):
    await join(student, "cs2100")
    await upload(student, content=CONTENT, filename="lecture.md", course="cs2100")
    await student.post("/enrolments.join", json={"course": "cs2100"}, headers=BOB)
    return PageAnchor(
        course="cs2100",
        filename="lecture.md",
        material_id=hashlib.sha256(CONTENT).hexdigest(),
        page_number=1,
    )


async def test_page_note_survives_new_sessions_and_upserts_without_duplicates(
    anchor, session, sessionmaker, settings
):
    store = PageNotes(session, settings)
    assert (await store.get(ALICE, anchor)).revision == 0
    first = await store.upsert(ALICE, anchor, "My first thought", expected_revision=0)
    assert first.revision == 1 and first.status == "queued"
    await session.commit()
    async with sessionmaker() as reopened:
        restarted = PageNotes(reopened, settings)
        assert (await restarted.get(ALICE, anchor)).body_md == "My first thought"
        second = await restarted.upsert(ALICE, anchor, "A clearer thought", expected_revision=1)
        await reopened.commit()
    assert second.id == first.id and second.revision == 2
    assert (await store.get(ALICE, anchor)).body_md == "A clearer thought"
    assert (await store.get(BOB_EMAIL, anchor)).body_md == ""
    with pytest.raises(RevisionConflict):
        await store.upsert(ALICE, anchor, "Stale edit", expected_revision=1)


async def test_retries_and_empty_edits_are_safe(anchor, session, settings):
    store = PageNotes(session, settings)
    first = await store.upsert(ALICE, anchor, "My thought", expected_revision=0)
    assert (
        await store.upsert(ALICE, anchor, "My thought", expected_revision=0)
    ).revision == first.revision
    cleared = await store.upsert(ALICE, anchor, "", expected_revision=1)
    assert cleared.revision == 2
    assert (await store.get(ALICE, anchor)).body_md == ""


async def test_anchor_requires_the_actual_material_and_page(anchor, session, settings):
    store = PageNotes(session, settings)
    for changes in ({"page_number": 2}, {"material_id": "0" * 64}):
        with pytest.raises(ValueError):
            await store.get(ALICE, anchor.model_copy(update=changes))
    target = settings.uploads_dir / "cs2100" / f"{anchor.material_id}.md"
    target.write_text("Changed Material", encoding="utf-8")
    with pytest.raises(ValueError, match="changed"):
        await store.upsert(ALICE, anchor, "A Note", expected_revision=0)


async def test_pending_work_coalesces_and_is_revision_safe(
    anchor, session, sessionmaker, settings, engine, monkeypatch
):
    store = PageNotes(session, settings, delay_seconds=0)
    await store.upsert(ALICE, anchor, "First", expected_revision=0)
    await store.upsert(ALICE, anchor, "Second", expected_revision=1)
    await session.commit()

    async def replace(dataset, owner, path):
        assert path.read_text(encoding="utf-8") == "Second"
        await store.upsert(ALICE, anchor, "Third", expected_revision=2)
        await session.commit()

    monkeypatch.setattr(engine, "replace", replace)
    assert await Ingest(sessionmaker, engine, settings).cognify_pending()
    saved = await store.get(ALICE, anchor)
    assert saved.body_md == "Third" and saved.status == "queued"
    assert saved.cognified_revision == 0


async def test_failed_ingest_can_be_retried_without_losing_text(
    anchor, session, sessionmaker, settings, engine
):
    store = PageNotes(session, settings, delay_seconds=0)
    first = await store.upsert(ALICE, anchor, "Keep this", expected_revision=0)
    await session.commit()
    engine.fail_with = RuntimeError("unavailable")
    await Ingest(sessionmaker, engine, settings).note(UUID(first.id))
    failed = await store.get(ALICE, anchor)
    assert failed.status == "failed" and failed.body_md == "Keep this"
    retry = await store.upsert(ALICE, anchor, "Keep this", expected_revision=1)
    assert retry.revision == 1 and retry.status == "queued"


async def test_interrupted_ingest_is_recovered(anchor, session, sessionmaker, settings, engine):
    store = PageNotes(session, settings, delay_seconds=0)
    saved = await store.upsert(ALICE, anchor, "Recover me", expected_revision=0)
    row = await session.get(Note, UUID(saved.id))
    row.status = "indexing"
    row.ingest_attempts = 1
    await session.commit()
    restarted = Ingest(sessionmaker, engine, settings)
    await restarted.recover_notes()
    assert await restarted.cognify_pending()
    after = await store.get(ALICE, anchor)
    assert after.status == "ready" and after.cognified_revision == 1


async def test_empty_edit_removes_the_private_artifact(
    anchor, session, sessionmaker, settings, engine
):
    store = PageNotes(session, settings, delay_seconds=0)
    saved = await store.upsert(ALICE, anchor, "", expected_revision=0)
    await session.commit()
    assert await Ingest(sessionmaker, engine, settings).cognify_pending()
    assert engine.cleared[0][1] == f"{saved.id}.md"
    assert (await store.get(ALICE, anchor)).status == "ready"


async def test_pdf_context_counts_real_pages(tmp_path):
    from pypdf import PdfWriter

    folder = tmp_path / "cs2100"
    folder.mkdir()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.add_blank_page(width=100, height=100)
    writer.write(folder / "lecture.pdf")
    assert material_context(tmp_path, "cs2100", "lecture.pdf", 1024**2).page_count == 2


async def test_pptx_page_count_uses_presentation_order_not_archive_entries(tmp_path):
    folder = tmp_path / "cs2100"
    folder.mkdir()
    with ZipFile(folder / "lecture.pptx", "w") as archive:
        archive.writestr(
            "ppt/presentation.xml",
            (
                '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
                '<p:sldIdLst><p:sldId id="256"/><p:sldId id="257"/></p:sldIdLst></p:presentation>'
            ),
        )
        archive.writestr("ppt/slides/slide99.xml", "not part of the presentation")
    assert material_context(tmp_path, "cs2100", "lecture.pptx", 1024**2).page_count == 2


@pytest.mark.parametrize("filename", ["../lecture.md", "..\\lecture.md", "C:lecture.md"])
async def test_material_context_rejects_path_traversal(tmp_path, filename):
    with pytest.raises(ValueError):
        material_context(tmp_path, "cs2100", filename, 1024**2)
