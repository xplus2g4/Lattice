"""The ingest queue, a Postgres table rather than a broker (ADR 0003)."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Enum, Index, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lattice.db.base import Base, created_at, updated_at, uuid_pk

JobKind = Enum(
    "ingest_material",
    "index_note",
    "reindex_course",
    "segment_topics",
    name="job_kind",
    native_enum=False,
)
JobStatus = Enum("pending", "running", "done", "failed", name="job_status", native_enum=False)


class Job(Base):
    """One unit of work for the Worker.

    `dedupe_key` is unique, so a Note autosaved five times while its job is still pending
    coalesces into that one job instead of five cognify runs.
    """

    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_claimable", "status", "run_after"),)

    id: Mapped[UUID] = uuid_pk()
    kind: Mapped[str] = mapped_column(JobKind)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(JobStatus, default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    run_after: Mapped[datetime] = created_at()
    dedupe_key: Mapped[str | None] = mapped_column(Text, unique=True)
    locked_by: Mapped[str | None] = mapped_column(Text)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


__all__ = ["Job", "JobKind", "JobStatus"]
