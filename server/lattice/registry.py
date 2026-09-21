"""In-process registry of materials, notes and sessions.

Deliberately not persisted: the knowledge itself lives in Cognee's datasets, and the
application tables in data-model.md are Postgres work that has not started. Restarting the
API empties this registry while everything stays searchable.
"""

from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

IngestStatus = Literal["queued", "cognifying", "ready", "failed"]


def now() -> datetime:
    return datetime.now(UTC)


class Material(BaseModel):
    course: str
    filename: str
    status: IngestStatus = "queued"
    error: str | None = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)


class Note(BaseModel):
    course: str
    owner: str
    id: str
    body_md: str
    status: IngestStatus = "queued"
    error: str | None = None
    updated_at: datetime = Field(default_factory=now)


class Citation(BaseModel):
    """What a cited chunk or relation resolves to, in domain terms.

    Engine payloads are translated into this shape in `engine.py`, so nothing
    Cognee-specific (dataset ids, document names) crosses the API.
    """

    kind: str
    filename: str | None = None
    chunk_index: int | None = None
    relation: str | None = None
    label: str | None = None


class TierResult(BaseModel):
    tier: Literal["global", "private"]
    answer: str | None
    citations: list[Citation]


class Turn(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    role: Literal["user", "assistant"]
    content: str
    query_type: str | None = None
    results: list[TierResult] = []
    used_notes: bool = False
    latency_ms: int | None = None
    created_at: datetime = Field(default_factory=now)


class Session(BaseModel):
    id: str
    course: str
    owner: str
    turns: list[Turn] = []
    created_at: datetime = Field(default_factory=now)


class Registry:
    def __init__(self) -> None:
        self.materials: dict[tuple[str, str], Material] = {}
        self.notes: dict[tuple[str, str, str], Note] = {}
        self.sessions: dict[str, Session] = {}

    def upsert_material(self, course: str, filename: str) -> Material:
        material = Material(course=course, filename=filename)
        self.materials[(course, filename)] = material
        return material

    def list_materials(self, course: str) -> list[Material]:
        return sorted(
            (m for (c, _), m in self.materials.items() if c == course),
            key=lambda m: m.created_at,
        )

    def upsert_note(self, course: str, owner: str, note_id: str, body_md: str) -> Note:
        note = Note(course=course, owner=owner, id=note_id, body_md=body_md)
        self.notes[(course, owner, note_id)] = note
        return note

    def list_notes(self, course: str, owner: str) -> list[Note]:
        return sorted(
            (n for (c, o, _), n in self.notes.items() if c == course and o == owner),
            key=lambda n: n.updated_at,
        )

    def list_sessions(self, course: str, owner: str) -> list[Session]:
        return sorted(
            (s for s in self.sessions.values() if s.course == course and s.owner == owner),
            key=lambda s: s.created_at,
            reverse=True,
        )

    def get_or_create_session(self, session_id: str | None, course: str, owner: str) -> Session:
        if session_id:
            session = self.sessions.get(session_id)
            if session is not None:
                if session.course != course or session.owner != owner:
                    raise KeyError(session_id)
                return session
        session = Session(id=session_id or uuid4().hex, course=course, owner=owner)
        self.sessions[session.id] = session
        return session

    def get_session(self, session_id: str, course: str, owner: str) -> Session | None:
        session = self.sessions.get(session_id)
        if session is None or session.course != course or session.owner != owner:
            return None
        return session


def set_status(item: Material | Note, status: IngestStatus, error: str | None = None) -> None:
    item.status = status
    item.error = error
    item.updated_at = now()
