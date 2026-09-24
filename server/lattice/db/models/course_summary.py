"""One summary vector per course, for choosing the related courses `/ask` also searches."""

from datetime import datetime
from uuid import UUID

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lattice.db.base import Base, updated_at
from lattice.db.models.identity import Course

# The DDL pins the width: an embedding model of another size needs a migration, not an
# env change. Matches `EMBEDDING_DIMENSIONS` for the model Cognify uses (bge-small-en-v1.5).
EMBEDDING_DIMENSIONS = 384


class CourseSummary(Base):
    """The unit-length mean of a course's ready Materials' profile embeddings, so courses can
    be compared to each other without an LLM. Only a course with at least one ready Material
    has a row; a course without one is never a related course."""

    __tablename__ = "course_summaries"

    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True
    )
    # What was embedded, kept so a surprising neighbour can be explained.
    summary_text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIMENSIONS))
    embedding_model: Mapped[str] = mapped_column(String(200))
    # sha256 over the ready Materials' identity and Topic labels; unchanged means no re-embed.
    source_digest: Mapped[str] = mapped_column(String(64))
    refreshed_at: Mapped[datetime] = updated_at()

    course: Mapped[Course] = relationship(lazy="selectin")


__all__ = ["EMBEDDING_DIMENSIONS", "CourseSummary"]
