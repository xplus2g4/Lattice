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
    # Cognee's position and similarity for segment evidence; graph evidence carries neither.
    rank: int | None = None
    score: float | None = None


class TierResult(BaseModel):
    tier: Literal["course", "notes"]
    dataset_name: str
    answer: str | None
    evidence: list[Evidence]
