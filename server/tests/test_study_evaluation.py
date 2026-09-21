import asyncio
import json
import os
import tempfile
from pathlib import Path

import pytest

from lattice.config import Settings
from lattice.engine import Engine
from lattice.note_review import NoteReviewer
from lattice.page_notes import PageAnchor, PageNotes
from lattice.registry import Registry
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
def test_live_study_retrieval_review_and_isolation(record_property):
    async def exercise(root):
        settings = Settings(_env_file=None, cognee_root=root / "c", uploads_dir=root / "u")
        folder = settings.uploads_dir / "cseval"
        folder.mkdir(parents=True)
        material = folder / "binary.md"
        material.write_text(MATERIAL, encoding="utf-8")
        engine = Engine(settings)
        await engine.start()
        dataset = await engine.global_dataset("cseval")
        await engine.replace(dataset, await engine.instructor(), material)
        notes = PageNotes(settings.uploads_dir, delay_seconds=0)
        context = notes.context("cseval", "binary.md")
        anchor = PageAnchor(**context.model_dump(exclude={"page_count", "topic"}), page_number=1)
        marker = "violet-tungsten-mnemonic"
        notes.upsert(
            "alice@example.com",
            anchor,
            f"My private sign extension mnemonic is {marker}.",
            expected_revision=0,
        )
        assert await notes.cognify_pending(engine.cognify_note)
        assert notes.get("alice@example.com", anchor).status == "ready"
        registry = Registry()
        alice = await ask_course(
            engine,
            registry,
            "cseval",
            "alice@example.com",
            AskRequest(question="What is my sign extension mnemonic?", query_type="CHUNKS"),
        )
        assert marker in alice.model_dump_json()
        bob = await ask_course(
            engine,
            registry,
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
                    registry,
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
        notes.upsert("alice@example.com", anchor, "", expected_revision=1)
        assert await notes.cognify_pending(engine.cognify_note)
        after_clear = await ask_course(
            engine,
            registry,
            "cseval",
            "alice@example.com",
            AskRequest(question="What is my sign extension mnemonic?", query_type="CHUNKS"),
        )
        assert marker not in after_clear.model_dump_json()

    with tempfile.TemporaryDirectory(prefix="lateval") as directory:
        asyncio.run(exercise(Path(directory)))
