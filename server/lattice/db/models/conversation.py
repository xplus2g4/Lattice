"""Sessions, Turns and the feedback a student leaves on an answer."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ARRAY, Boolean, CheckConstraint, Enum, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lattice.db.base import Base, created_at, uuid_pk

TurnRole = Enum("user", "assistant", name="turn_role", native_enum=False)


class Session(Base):
    """One student's conversation in one course; `/ask` appends to it."""

    __tablename__ = "sessions"

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    course_id: Mapped[UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    last_turn_at: Mapped[datetime] = created_at()
    created_at: Mapped[datetime] = created_at()

    turns: Mapped[list[Turn]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="Turn.created_at",
        lazy="selectin",
    )


class Turn(Base):
    """A question or an answer. `content_json` keeps the Tier results and their Evidence."""

    __tablename__ = "turns"

    id: Mapped[UUID] = uuid_pk()
    session_id: Mapped[UUID] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(TurnRole)
    content_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    cited_chunk_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    used_notes: Mapped[bool] = mapped_column(Boolean, default=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = created_at()

    session: Mapped[Session] = relationship(back_populates="turns")


class Feedback(Base):
    """One rating per student per Turn; saving again changes the rating."""

    __tablename__ = "feedback"
    __table_args__ = (CheckConstraint("rating in (-1, 1)", name="rating_is_thumb"),)

    turn_id: Mapped[UUID] = mapped_column(
        ForeignKey("turns.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()


__all__ = ["Feedback", "Session", "Turn", "TurnRole"]
