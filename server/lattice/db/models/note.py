"""Notes: a student's own writing, private to them and to their Tier."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Enum, ForeignKey, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lattice.db.base import Base, created_at, updated_at, uuid_pk
from lattice.db.models.identity import Course, User

NoteStatus = Enum("dirty", "indexing", "ready", "failed", name="note_status", native_enum=False)


class Note(Base):
    """Anchored to a page of a Material, or loose in the course when quickly jotted (#37).

    An anchored Note is one per student per page (#38): saving again edits that one.
    """

    __tablename__ = "notes"
    __table_args__ = (
        Index(
            "uq_notes_user_id_material_id_page",
            "user_id",
            "material_id",
            "page",
            unique=True,
            postgresql_where=text("material_id is not null"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    course_id: Mapped[UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    material_id: Mapped[UUID | None] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"))
    page: Mapped[int | None] = mapped_column(Integer)
    body_md: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(NoteStatus, default="dirty")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    course: Mapped[Course] = relationship(lazy="selectin")
    user: Mapped[User] = relationship(lazy="selectin")


__all__ = ["Note", "NoteStatus"]
