"""What a retrieval returns, in Lattice's terms rather than Cognee's.

Lives outside `engine.py` so the API and the tables can speak about Evidence and Tiers
without importing the Cognee seam.
"""

from typing import Literal

from pydantic import BaseModel


class Evidence(BaseModel):
    kind: str
    dataset_id: str | None = None
    data_id: str | None = None
    chunk_id: str | None = None
    chunk_index: int | None = None
    document_name: str | None = None
    label: str | None = None
    relationship_name: str | None = None
    page_start: int | None = None
    page_end: int | None = None


class TierResult(BaseModel):
    # `related`: the global tier of a nearest-neighbour course, searched as reference material.
    tier: Literal["course", "notes", "related"]
    dataset_name: str
    # The course the result came from; for `related` it is not the Session's course.
    course: str | None = None
    answer: str | None
    evidence: list[Evidence]
