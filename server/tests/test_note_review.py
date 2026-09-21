import asyncio
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from lattice.note_review import (
    Claim,
    ClaimAssessment,
    ClaimSet,
    NoteReviewer,
    ReviewChunk,
    ReviewError,
)
from lattice.page_notes import text_hash

CHUNK = ReviewChunk(
    chunk_id=UUID("00000000-0000-0000-0000-000000000003"),
    dataset_id=UUID("00000000-0000-0000-0000-000000000001"),
    material_name="lecture.md",
    chunk_index=0,
    text="Sign extension repeats the sign bit, preserving the signed value.",
)


def test_review_returns_cited_correction_without_saving_a_note():
    body = "Sign extension always adds zero bits."
    generate = AsyncMock(
        side_effect=[
            ClaimSet(claims=[Claim(excerpt=body, statement=body)], has_more=False),
            ClaimAssessment(
                verdict="contradicted",
                explanation="Sign extension repeats the sign bit, which can be one.",
                correction="Sign extension repeats the sign bit.",
                citations=[CHUNK.chunk_id],
            ),
        ]
    )
    retrieve = AsyncMock(return_value=[CHUNK])
    result = asyncio.run(
        NoteReviewer(retrieve, generate).review("cs2100", "alice@example.com", body)
    )
    assert result.draft_hash == text_hash(body)
    assert result.findings[0].verdict == "contradicted"
    assert result.findings[0].citations == [CHUNK]
    assert result.findings[0].excerpt == body


@pytest.mark.parametrize("citations", [[], [uuid4()]])
def test_unresolvable_feedback_is_not_presented_as_a_verdict(citations):
    body = "A factual claim."
    generate = AsyncMock(
        side_effect=[
            ClaimSet(claims=[Claim(excerpt=body, statement=body)], has_more=False),
            ClaimAssessment(
                verdict="supported", explanation="Trust me", correction=None, citations=citations
            ),
        ]
    )
    result = asyncio.run(
        NoteReviewer(AsyncMock(return_value=[CHUNK]), generate).review(
            "cs2100", "alice@example.com", body
        )
    )
    assert result.findings[0].verdict == "insufficient_evidence"
    assert result.findings[0].citations == []
    assert result.findings[0].correction is None


def test_no_evidence_does_not_mean_incorrect():
    body = "A factual claim."
    generate = AsyncMock(
        return_value=ClaimSet(claims=[Claim(excerpt=body, statement=body)], has_more=False)
    )
    result = asyncio.run(
        NoteReviewer(AsyncMock(return_value=[]), generate).review(
            "cs2100", "alice@example.com", body
        )
    )
    assert result.findings[0].verdict == "insufficient_evidence"
    assert generate.await_count == 1


def test_fabricated_excerpt_and_provider_failure_are_errors():
    for output in [
        ClaimSet(claims=[Claim(excerpt="Not in the Note", statement="Anything")], has_more=False),
        RuntimeError("secret provider details"),
    ]:
        generate = (
            AsyncMock(side_effect=output)
            if isinstance(output, Exception)
            else AsyncMock(return_value=output)
        )
        with pytest.raises(ReviewError, match="could not be completed") as error:
            asyncio.run(
                NoteReviewer(AsyncMock(), generate).review("cs2100", "alice@example.com", "My Note")
            )
        assert "secret" not in str(error.value)


def test_long_draft_reports_limited_coverage_and_hashes_the_whole_draft():
    body = "A factual claim. " + "x" * 20_000
    generate = AsyncMock(return_value=ClaimSet(claims=[], has_more=False))
    result = asyncio.run(
        NoteReviewer(AsyncMock(), generate).review("cs2100", "alice@example.com", body)
    )
    assert result.truncated is True
    assert result.reviewed_characters == 12_000
    assert result.input_characters == len(body)
    assert result.draft_hash == text_hash(body)


def test_evidence_over_budget_is_explicitly_omitted_not_silently_clipped():
    body = "A factual claim."
    huge = CHUNK.model_copy(update={"text": "x" * 24_001})
    generate = AsyncMock(
        return_value=ClaimSet(claims=[Claim(excerpt=body, statement=body)], has_more=False)
    )
    result = asyncio.run(
        NoteReviewer(AsyncMock(return_value=[huge]), generate).review(
            "cs2100", "alice@example.com", body
        )
    )
    assert result.findings[0].verdict == "insufficient_evidence"
    assert result.findings[0].evidence_limited is True
    assert generate.await_count == 1


def test_review_timeout_is_bounded():
    async def slow(*args):
        await asyncio.sleep(1)

    with pytest.raises(ReviewError):
        asyncio.run(
            NoteReviewer(AsyncMock(), slow, timeout_seconds=0.01).review(
                "cs2100", "alice@example.com", "A claim"
            )
        )
