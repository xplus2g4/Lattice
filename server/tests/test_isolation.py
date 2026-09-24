"""ADR 0002's second enforcement layer, tested against fabricated Cognee payloads.

These cost nothing and run on every PR. The first layer, Cognee's own dataset permissions,
needs a real cognify and lives in `test_canary.py`. The private helpers are tested directly
because they are the check: going through `Engine.search` would only add a Cognee mock
between the test and the thing being asserted.
"""

from uuid import uuid4

import pytest
from cognee.infrastructure.databases.vector.models.ScoredResult import ScoredResult

from lattice.engine import IsolationError, _tier_result

COURSE = uuid4()
MINE = uuid4()
SOMEONE_ELSE = uuid4()
RELATED = uuid4()
DATASETS = {COURSE: "course", MINE: "notes"}


def result(dataset_id, evidence=None):
    return {
        "dataset_id": dataset_id,
        "dataset_name": "cs101-global",
        "text_result": "hash tables are week 3",
        "evidence": evidence or [],
    }


def segment(dataset_id, artifact="a1"):
    # A string, which is how Cognee serialises dataset_id on evidence items.
    return {"kind": "segment", "artifact_id": artifact, "dataset_id": str(dataset_id)}


def test_accepts_the_callers_own_datasets():
    assert _tier_result(result(COURSE), DATASETS).tier == "course"
    assert _tier_result(result(MINE), DATASETS).tier == "notes"


def test_accepts_dataset_id_as_a_string():
    """Cognee gives a UUID on results and a string on evidence; both must resolve."""
    assert _tier_result(result(str(COURSE)), DATASETS).tier == "course"


def test_rejects_a_result_from_another_principals_dataset():
    with pytest.raises(IsolationError):
        _tier_result(result(SOMEONE_ELSE), DATASETS)


def test_rejects_a_citation_from_another_principals_dataset():
    """The answer is the caller's, but one citation points somewhere they cannot read."""
    with pytest.raises(IsolationError):
        _tier_result(result(COURSE, [segment(SOMEONE_ELSE)]), DATASETS)


@pytest.mark.parametrize("missing", [None, "", "not-a-uuid"])
def test_rejects_a_result_with_no_usable_dataset_id(missing):
    """Previously these were labelled `course` by default and returned to the browser."""
    with pytest.raises(IsolationError):
        _tier_result(result(missing), DATASETS)


def test_keeps_citations_that_name_no_dataset():
    """Graph nodes and edges carry no dataset_id; the result's own dataset covers them."""
    evidence = [{"kind": "graph_edge", "artifact_id": "e1", "relationship_name": "taught_in"}]
    assert len(_tier_result(result(COURSE, evidence), DATASETS).evidence) == 1


def test_accepts_a_related_courses_global_dataset():
    """The related lane searches another course's global tier under its own datasets map."""
    assert _tier_result(result(RELATED), {RELATED: "related"}).tier == "related"


def test_the_related_lane_refuses_even_the_callers_own_datasets():
    """A per-lane map means anything from another dataset, the caller's included, is refused."""
    with pytest.raises(IsolationError):
        _tier_result(result(COURSE), {RELATED: "related"})


def test_still_dedupes_citations():
    """Cognee repeats a segment once per citing edge; the check must not break that."""
    evidence = [segment(COURSE), segment(COURSE), segment(COURSE, "a2")]
    assert len(_tier_result(result(COURSE, evidence), DATASETS).evidence) == 2


def chunk(chunk_id, text):
    return {"id": chunk_id, "score": 0.1, "payload": {"text": text}}


def cited(objects, chunk_id="c1"):
    raw = result(COURSE, [{**segment(COURSE), "chunk_id": chunk_id}])
    return _tier_result({**raw, "objects_result": objects}, DATASETS).evidence[0]


def test_a_chunk_opening_on_a_page_label_starts_on_that_page():
    e = cited([chunk("c1", "Page 3:\nHashing\n\nPage 4:\nProbing\n")])
    assert (e.page_start, e.page_end) == (3, 4)


def test_a_chunk_opening_mid_page_starts_on_the_page_before():
    e = cited({"chunks": [chunk("c1", "…continued\n\nPage 7:\nTrees\nPage 9:\nHeaps")]})
    assert (e.page_start, e.page_end) == (6, 9)


def test_a_chunk_without_page_labels_or_text_gets_no_pages():
    assert cited([chunk("c1", "a note with no page labels")]).page_start is None
    assert cited([]).page_start is None


def test_reads_page_labels_from_cognee_scored_results():
    chunk_id = uuid4()
    scored = ScoredResult(id=chunk_id, score=0.1, payload={"text": "Page 2:\nStacks"})
    e = cited([scored], str(chunk_id))
    assert (e.page_start, e.page_end) == (2, 2)


@pytest.mark.parametrize("wrap", (lambda t: t, lambda t: [t]), ids=("string", "list"))
def test_drops_cognees_plain_text_evidence_block_from_the_answer(wrap):
    """Graph completion returns its completion wrapped in a one-element list (observed live)."""
    raw = result(COURSE)
    text = "Chaining.\n\nEvidence:\n- chunk 0 of document abc (data_id: d1, chunk_id: c1)\n"
    assert _tier_result({**raw, "text_result": wrap(text)}, DATASETS).answer == "Chaining."
