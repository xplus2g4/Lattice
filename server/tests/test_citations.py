from lattice.engine import _dedupe_citations


def test_keeps_one_entry_per_artifact() -> None:
    edge = {"kind": "segment", "artifact_id": "a1", "document_name": "lecture-1.pdf"}

    citations = _dedupe_citations([edge, dict(edge)])

    assert [(c.kind, c.filename) for c in citations] == [("chunk", "lecture-1.pdf")]


def test_drops_unresolvable_items() -> None:
    items = [
        {"kind": "segment", "artifact_id": "a1"},
        {"kind": "graph_edge", "artifact_id": "a2", "relationship_name": "teaches"},
    ]

    citations = _dedupe_citations(items)

    assert [(c.kind, c.relation) for c in citations] == [("relation", "teaches")]
