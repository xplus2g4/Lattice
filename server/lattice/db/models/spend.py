"""Spend: the ledger of what each LLM call cost, one row per provider attempt."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from lattice.db.base import Base, utcnow, uuid_pk


class Spend(Base):
    """One provider attempt, attributed to the course it served and, for a Turn, to the
    Principal who asked. Cognify Spend and course-summary embeddings carry no `user_id`.
    Per-Turn and per-Material totals are `GROUP BY` over this table, never stored.

    `usd` is null when no price is configured for `model`; `model` is the litellm name with
    its provider prefix stripped. `request_id` ties the attempt back to the request log.
    """

    __tablename__ = "spend"
    __table_args__ = (
        Index("ix_spend_occurred_at", "occurred_at"),
        Index("ix_spend_course_id_occurred_at", "course_id", "occurred_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    course_id: Mapped[UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    turn_id: Mapped[UUID | None] = mapped_column(ForeignKey("turns.id", ondelete="CASCADE"))
    material_id: Mapped[UUID | None] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"))
    note_id: Mapped[UUID | None] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(Text)  # 'completion' | 'embedding'
    model: Mapped[str] = mapped_column(Text)
    prompt_tokens: Mapped[int] = mapped_column(Integer)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    request_id: Mapped[str | None] = mapped_column(Text)


__all__ = ["Spend"]
