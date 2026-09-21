import asyncio
import hashlib
from concurrent.futures import ThreadPoolExecutor
from zipfile import ZipFile

import pytest

from lattice.page_notes import PageAnchor, PageNotes, RevisionConflict

ALICE = "alice@example.com"
BOB = "bob@example.com"


@pytest.fixture
def material(tmp_path):
    folder = tmp_path / "cs2100"
    folder.mkdir()
    content = b"Sign extension repeats the sign bit."
    (folder / "lecture.md").write_bytes(content)
    return tmp_path, PageAnchor(
        course="cs2100",
        filename="lecture.md",
        material_id=hashlib.sha256(content).hexdigest(),
        page_number=1,
    )


def test_page_note_survives_restart_and_upserts_without_duplicates(material):
    root, anchor = material
    notes = PageNotes(root)
    assert notes.get(ALICE, anchor).revision == 0
    first = notes.upsert(ALICE, anchor, "My first thought", expected_revision=0)
    assert first.revision == 1
    assert first.status == "queued"
    restarted = PageNotes(root)
    assert restarted.get(ALICE, anchor).body_md == "My first thought"
    second = restarted.upsert(ALICE, anchor, "A clearer thought", expected_revision=1)
    assert second.id == first.id
    assert second.revision == 2
    assert restarted.get(ALICE, anchor).body_md == "A clearer thought"
    assert restarted.get(BOB, anchor).body_md == ""
    with pytest.raises(RevisionConflict):
        notes.upsert(ALICE, anchor, "Stale edit", expected_revision=1)


def test_retries_and_empty_edits_are_safe(material):
    root, anchor = material
    notes = PageNotes(root)
    first = notes.upsert(ALICE, anchor, "My thought", expected_revision=0)
    assert notes.upsert(ALICE, anchor, "My thought", expected_revision=0) == first
    cleared = notes.upsert(ALICE, anchor, "", expected_revision=1)
    assert cleared.revision == 2
    assert notes.get(ALICE, anchor).body_md == ""
    assert cleared.cognified_revision == 0


def test_anchor_requires_the_actual_material_and_page(material):
    root, anchor = material
    notes = PageNotes(root)
    for changes in ({"page_number": 2}, {"material_id": "0" * 64}, {"course": "cs101"}):
        with pytest.raises(ValueError):
            notes.get(ALICE, anchor.model_copy(update=changes))
    (root / "cs2100" / "lecture.md").write_text("Changed Material", encoding="utf-8")
    with pytest.raises(ValueError, match="changed"):
        notes.upsert(ALICE, anchor, "A Note", expected_revision=0)


def test_pending_work_coalesces_and_survives_restart(material):
    root, anchor = material
    notes = PageNotes(root, delay_seconds=0)
    notes.upsert(ALICE, anchor, "First", expected_revision=0)
    latest = notes.upsert(ALICE, anchor, "Second", expected_revision=1)
    restarted = PageNotes(root, delay_seconds=0)
    pending = restarted.claim_pending()
    assert pending.body_md == "Second"
    assert pending.revision == latest.revision
    notes.upsert(ALICE, anchor, "Third", expected_revision=2)
    restarted.finish(pending)
    assert notes.get(ALICE, anchor).status == "queued"
    assert notes.claim_pending().body_md == "Third"


def test_failed_ingest_can_be_retried_without_losing_text(material):
    root, anchor = material
    notes = PageNotes(root, delay_seconds=0)
    notes.upsert(ALICE, anchor, "Keep this", expected_revision=0)
    pending = notes.claim_pending()
    notes.finish(pending, failed=True)
    assert notes.get(ALICE, anchor).status == "failed"
    assert notes.get(ALICE, anchor).body_md == "Keep this"
    retried = notes.upsert(ALICE, anchor, "Keep this", expected_revision=1)
    assert retried.revision == 1
    assert retried.status == "queued"


def test_cognify_uses_a_snapshot_and_keeps_new_edits_pending(material):
    root, anchor = material
    notes = PageNotes(root, delay_seconds=0)
    notes.upsert(ALICE, anchor, "First", expected_revision=0)

    async def ingest(snapshot):
        notes.upsert(ALICE, anchor, "Second", expected_revision=1)
        assert snapshot.body_md == "First"

    assert asyncio.run(notes.cognify_pending(ingest)) is True
    assert notes.get(ALICE, anchor).body_md == "Second"
    assert notes.get(ALICE, anchor).status == "queued"


def test_interrupted_cognify_is_recovered(material):
    root, anchor = material
    notes = PageNotes(root, delay_seconds=0)
    notes.upsert(ALICE, anchor, "Recover me", expected_revision=0)
    notes.claim_pending()
    restarted = PageNotes(root)
    restarted.recover()
    pending = restarted.claim_pending()
    assert pending.body_md == "Recover me"
    restarted.finish(pending)
    assert restarted.get(ALICE, anchor).cognified_revision == 1
    assert restarted.claim_pending() is None


def test_pdf_context_counts_real_pages_and_isolates_page_notes(tmp_path):
    from pypdf import PdfWriter

    folder = tmp_path / "cs2100"
    folder.mkdir()
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.add_blank_page(width=100, height=100)
    writer.write(folder / "lecture.pdf")
    notes = PageNotes(tmp_path)
    context = notes.context("cs2100", "lecture.pdf")
    assert context.page_count == 2
    first = PageAnchor(**context.model_dump(exclude={"page_count", "topic"}), page_number=1)
    second = first.model_copy(update={"page_number": 2})
    notes.upsert(ALICE, first, "Page one only", expected_revision=0)
    assert notes.get(ALICE, second).body_md == ""


def test_concurrent_writers_cannot_overwrite_a_newer_revision(material):
    root, anchor = material
    notes = PageNotes(root)

    def write(body):
        try:
            return notes.upsert(ALICE, anchor, body, expected_revision=0).body_md
        except RevisionConflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, ["First writer", "Second writer"]))
    assert results.count("conflict") == 1
    assert notes.get(ALICE, anchor).revision == 1
    assert notes.get(ALICE, anchor).body_md in {"First writer", "Second writer"}


def test_pptx_page_count_uses_presentation_order_not_archive_entries(tmp_path):
    folder = tmp_path / "cs2100"
    folder.mkdir()
    with ZipFile(folder / "lecture.pptx", "w") as archive:
        archive.writestr(
            "ppt/presentation.xml",
            (
                '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
                '<p:sldIdLst><p:sldId id="256"/><p:sldId id="257"/></p:sldIdLst>'
                "</p:presentation>"
            ),
        )
        archive.writestr("ppt/slides/slide99.xml", "not part of the presentation")
    assert PageNotes(tmp_path).context("cs2100", "lecture.pptx").page_count == 2


def test_cognify_failure_keeps_a_retryable_saved_note(material):
    root, anchor = material
    notes = PageNotes(root, delay_seconds=0)
    notes.upsert(ALICE, anchor, "My saved text", expected_revision=0)

    async def failing_ingest(snapshot):
        raise RuntimeError("sensitive-provider-error")

    assert asyncio.run(notes.cognify_pending(failing_ingest)) is True
    saved = notes.get(ALICE, anchor)
    assert saved.body_md == "My saved text"
    assert saved.status == "failed"
    assert "sensitive-provider-error" not in saved.model_dump_json()
    assert notes.claim_pending() is None


@pytest.mark.parametrize("filename", ["../lecture.md", "..\\lecture.md", "C:lecture.md"])
def test_material_context_rejects_path_traversal(material, filename):
    root, _ = material
    with pytest.raises(ValueError):
        PageNotes(root).context("cs2100", filename)
