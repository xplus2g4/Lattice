"""Materials, their Topics, and where each student stopped reading."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lattice.db.base import Base, created_at, updated_at, uuid_pk
from lattice.db.models.identity import Course

MaterialKind = Enum("slides", "tutorial", "memo", name="material_kind", native_enum=False)
IngestStatus = Enum(
    "queued",
    "converting",
    "cognifying",
    "ready",
    "failed",
    name="ingest_status",
    native_enum=False,
)


class Material(Base):
    """An official teaching artifact. One row per distinct file per course: the sha256 is
    unique inside a course, so a re-upload of the same bytes joins the existing Material."""

    __tablename__ = "materials"
    __table_args__ = (UniqueConstraint("course_id", "sha256"),)

    id: Mapped[UUID] = uuid_pk()
    course_id: Mapped[UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    week: Mapped[int | None] = mapped_column(Integer)
    lecture_no: Mapped[int | None] = mapped_column(Integer)
    kind: Mapped[str | None] = mapped_column(MaterialKind)
    title: Mapped[str] = mapped_column(String(300))
    filename: Mapped[str] = mapped_column(String(300))
    storage_uri: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    page_count: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(IngestStatus, default="queued")
    error: Mapped[str | None] = mapped_column(Text)
    cognify_tokens: Mapped[int | None] = mapped_column(Integer)
    cognify_cost_usd: Mapped[float | None] = mapped_column(Numeric(10, 4))
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    course: Mapped[Course] = relationship(lazy="selectin")
    topics: Mapped[list[Topic]] = relationship(
        back_populates="material",
        cascade="all, delete-orphan",
        order_by="Topic.position",
        lazy="selectin",
    )


class Topic(Base):
    """A contiguous page range of one Material, produced by segmentation (#41)."""

    __tablename__ = "topics"
    __table_args__ = (UniqueConstraint("material_id", "position"),)

    id: Mapped[UUID] = uuid_pk()
    material_id: Mapped[UUID] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(300))
    page_start: Mapped[int] = mapped_column(Integer)
    page_end: Mapped[int] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer)

    material: Mapped[Material] = relationship(back_populates="topics")


class ReadingPosition(Base):
    """The page a student last had open, per Material. Private to that student (#29)."""

    __tablename__ = "reading_positions"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    material_id: Mapped[UUID] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), primary_key=True
    )
    page: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = updated_at()


__all__ = ["IngestStatus", "Material", "MaterialKind", "ReadingPosition", "Topic"]
