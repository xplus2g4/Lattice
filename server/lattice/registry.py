"""In-process registry of materials, notes and sessions.

Deliberately not persisted: the knowledge itself lives in Cognee's datasets, and the
application tables in data-model.md are Postgres work that has not started. Restarting the
API empties this registry while everything stays searchable.
"""

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, model_validator

IngestStatus = Literal["queued", "cognifying", "ready", "failed"]


def now() -> datetime:
    return datetime.now(UTC)


# These models are the response bodies, so they are also the frozen contract
# (contracts/openapi.json, ADR 0005). A field with a default is emitted as optional, so
# anything the API always sends is declared required here and passed explicitly below,
# even when that costs a few keywords at the construction site.


class Material(BaseModel):
    course: str
    filename: str
    status: IngestStatus
    error: str | None
    created_at: datetime
    updated_at: datetime


class Note(BaseModel):
    course: str
    owner: str
    id: str
    body_md: str
    status: IngestStatus
    error: str | None
    updated_at: datetime


class Evidence(BaseModel):
    """A Cognee `EvidenceReference`, normalised so every field is present, possibly null.

    Which fields Cognee populates depends on `kind` (`segment`, `graph_node`, `graph_edge`),
    so the incoming dict is sparse; the contract is not.
    """

    kind: str
    dataset_id: str | None
    data_id: str | None
    chunk_id: str | None
    chunk_index: int | None
    document_name: str | None
    label: str | None
    relationship_name: str | None

    @model_validator(mode="before")
    @classmethod
    def _fill_absent(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {name: data.get(name) for name in cls.model_fields}
        return data


class TierResult(BaseModel):
    tier: Literal["course", "notes"]
    dataset_name: str
    answer: str | None
    evidence: list[Evidence]


class Turn(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    query_type: str | None
    results: list[TierResult]
    used_notes: bool
    latency_ms: int | None
    created_at: datetime


def user_turn(content: str) -> Turn:
    return Turn(
        id=uuid4().hex,
        role="user",
        content=content,
        query_type=None,
        results=[],
        used_notes=False,
        latency_ms=None,
        created_at=now(),
    )


class Session(BaseModel):
    id: str
    course: str
    owner: str
    turns: list[Turn]
    created_at: datetime


class Registry:
    def __init__(self) -> None:
        self.materials: dict[tuple[str, str], Material] = {}
        self.notes: dict[tuple[str, str, str], Note] = {}
        self.sessions: dict[str, Session] = {}

    def upsert_material(self, course: str, filename: str) -> Material:
        at = now()
        material = Material(
            course=course,
            filename=filename,
            status="queued",
            error=None,
            created_at=at,
            updated_at=at,
        )
        self.materials[(course, filename)] = material
        return material

    def list_materials(self, course: str) -> list[Material]:
        return sorted(
            (m for (c, _), m in self.materials.items() if c == course),
            key=lambda m: m.created_at,
        )

    def upsert_note(self, course: str, owner: str, note_id: str, body_md: str) -> Note:
        note = Note(
            course=course,
            owner=owner,
            id=note_id,
            body_md=body_md,
            status="queued",
            error=None,
            updated_at=now(),
        )
        self.notes[(course, owner, note_id)] = note
        return note

    def list_notes(self, course: str, owner: str) -> list[Note]:
        return sorted(
            (n for (c, o, _), n in self.notes.items() if c == course and o == owner),
            key=lambda n: n.updated_at,
        )

    def get_or_create_session(self, session_id: str | None, course: str, owner: str) -> Session:
        if session_id:
            session = self.sessions.get(session_id)
            if session is not None:
                if session.course != course or session.owner != owner:
                    raise KeyError(session_id)
                return session
        session = Session(
            id=session_id or uuid4().hex,
            course=course,
            owner=owner,
            turns=[],
            created_at=now(),
        )
        self.sessions[session.id] = session
        return session


def set_status(item: Material | Note, status: IngestStatus, error: str | None = None) -> None:
    item.status = status
    item.error = error
    item.updated_at = now()
