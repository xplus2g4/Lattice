import json
import os

import pytest

from lattice.config import Settings
from lattice.db.repo import courses, materials, users
from lattice.engine import Engine
from lattice.ingest import Ingest
from lattice.note_review import NoteReviewer
from lattice.page_notes import PageAnchor, PageNotes, text_hash
from lattice.study import AskRequest, ask_course

MATERIAL = (
    "# Signed binary values\n\n"
    "Sign extension repeats the most significant sign bit when widening a two's-complement "
    "integer, preserving its signed value. Zero extension fills the new high bits with zero. "
    "For a negative two's-complement value, zero extension changes the signed value. "
    "Four-bit 1110 represents -2; sign-extending it to eight bits gives 11111110, still -2. "
    "Zero-extending 1110 gives 00001110, which represents 14.\n"
)
QUESTIONS = [
    {"kind": "direct", "question": "Which bit does sign extension repeat?"},
    {
        "kind": "paraphrase",
        "question": "How do I widen a negative binary integer without changing its value?",
    },
    {"kind": "comparison", "question": "How do sign extension and zero extension differ?"},
    {
        "kind": "application",
        "question": "Sign-extend four-bit 1110 to eight bits. What value does it represent?",
    },
    {
        "kind": "false_premise",
        "question": "Why does zero extension preserve the signed value of every negative integer?",
    },
    {"kind": "unsupported", "question": "What date is the course's final exam?"},
]


@pytest.mark.canary
@pytest.mark.skipif(
    os.environ.get("LATTICE_RUN_STUDY_EVAL") != "1",
    reason="opt-in paid smoke evaluation: set LATTICE_RUN_STUDY_EVAL=1 with an LLM key",
)
async def test_live_study_retrieval_review_and_isolation(
    record_property, workspace, session, sessionmaker
):
    settings = Settings(_env_file=None, cognee_root=workspace / "c", uploads_dir=workspace / "u")
    folder = settings.uploads_dir / "cseval"
    folder.mkdir(parents=True)
    path = folder / "binary.md"
    path.write_text(MATERIAL, encoding="utf-8")
    engine = Engine(settings)
    await engine.start()
    owner = await users.get_or_create(session, "alice@example.com")
    course = await courses.create(
        session, code="cseval", name="Study evaluation", term=None, owner=owner
    )
    for email in ("alice@example.com", "bob@example.com"):
        user = await users.get_or_create(session, email)
        principal = await engine.principal(email)
        _, private = await engine.enrol(course.code, principal)
        user.cognee_principal_id = principal.id
        await courses.enrol(session, user=user, course=course, user_dataset_name=private.name)
    material = await materials.create(
        session,
        course=course,
        uploader=owner,
        title="binary.md",
        filename="binary.md",
        storage_uri=str(path),
        sha256=text_hash(MATERIAL),
    )
    await session.commit()
    ingest = Ingest(sessionmaker, engine, settings)
    await ingest.material(material.id)
    dataset = await engine.global_dataset("cseval")
    notes = PageNotes(session, settings, delay_seconds=0)
    context = await notes.context("alice@example.com", "cseval", "binary.md")
    anchor = PageAnchor(**context.model_dump(exclude={"page_count", "topic"}), page_number=1)
    marker = "violet-tungsten-mnemonic"
    await notes.upsert(
        "alice@example.com",
        anchor,
        f"My private sign extension mnemonic is {marker}.",
        expected_revision=0,
    )
    await session.commit()
    assert await ingest.cognify_pending()
    assert (await notes.get("alice@example.com", anchor)).status == "ready"
    alice = await ask_course(
        engine,
        session,
        "cseval",
        "alice@example.com",
        AskRequest(question="What is my sign extension mnemonic?", query_type="CHUNKS"),
    )
    assert marker in alice.model_dump_json()
    bob = await ask_course(
        engine,
        session,
        "cseval",
        "bob@example.com",
        AskRequest(question="What is my sign extension mnemonic?", query_type="CHUNKS"),
    )
    assert marker not in bob.model_dump_json()
    assert bob.turn.results
    records = []
    for mode in ("GRAPH_COMPLETION", "RAG_COMPLETION", "HYBRID_COMPLETION", "CHUNKS"):
        for case in QUESTIONS:
            answer = await ask_course(
                engine,
                session,
                "cseval",
                "bob@example.com",
                AskRequest(
                    question=case["question"],
                    query_type=mode,
                ),
            )
            assert answer.turn.results
            assert all(result.tier == "course" for result in answer.turn.results)
            records.append({**case, "mode": mode, "turn": answer.turn.model_dump(mode="json")})
    record_property("study_qa_smoke_results", json.dumps(records))
    reviewer = NoteReviewer(engine.retrieve_official, engine.generate)
    for draft, verdict in [
        ("Sign extension repeats the sign bit.", "supported"),
        ("Sign extension always fills the new bits with zero.", "contradicted"),
        ("The course final exam is on 18 December.", "insufficient_evidence"),
    ]:
        reviewed = await reviewer.review("cseval", "alice@example.com", draft)
        assert reviewed.findings
        assert any(f.verdict == verdict for f in reviewed.findings)
        for finding in reviewed.findings:
            assert all(c.dataset_id == dataset.id for c in finding.citations)
    await notes.upsert("alice@example.com", anchor, "", expected_revision=1)
    await session.commit()
    assert await ingest.cognify_pending()
    after_clear = await ask_course(
        engine,
        session,
        "cseval",
        "alice@example.com",
        AskRequest(question="What is my sign extension mnemonic?", query_type="CHUNKS"),
    )
    assert marker not in after_clear.model_dump_json()
