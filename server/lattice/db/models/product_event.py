"""Product events: what a student did, written by the API inside the action's transaction."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lattice.db.base import Base, utcnow, uuid_pk


class ProductEvent(Base):
    """One row per Product event (`ask.asked`, `quiz.submitted`, ...). `properties` carries
    ids, counts and hashes only, never content: the table is what product questions are
    answered from, and it must stay safe to aggregate."""

    __tablename__ = "product_events"
    __table_args__ = (
        Index("ix_product_events_occurred_at", "occurred_at"),
        Index("ix_product_events_user_id_occurred_at", "user_id", "occurred_at"),
        Index("ix_product_events_course_id_occurred_at", "course_id", "occurred_at"),
    )

    id: Mapped[UUID] = uuid_pk()
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    course_id: Mapped[UUID | None] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text)
    properties: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )


__all__ = ["ProductEvent"]
