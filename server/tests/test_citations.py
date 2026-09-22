from lattice.citations import answer_text


def test_regular_evidence_prose_is_not_removed():
    prose = "An explanation.\n\nEvidence:\nThe experiment supports this conclusion."
    assert answer_text(prose) == prose
