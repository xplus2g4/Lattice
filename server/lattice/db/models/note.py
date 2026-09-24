"""Notes: a student's own writing, private to them and to their Tier."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lattice.db.base import Base, created_at, updated_at, uuid_pk
from lattice.db.models.identity import Course, User

NoteStatus = Enum("dirty", "indexing", "ready", "failed", name="note_status", native_enum=False)


class Note(Base):
    """Anchored to a page of a Material, or loose in the course when quickly jotted (#37).

    An anchored Note is one per student per page (#38): saving again edits that one.
    A Note can also be a PDF the student uploaded; then `storage_uri` is set and `body_md`
    is empty.
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
        # The same PDF uploaded twice by one student joins the first Note, as Materials do.
        Index(
            "uq_notes_user_id_course_id_sha256",
            "user_id",
            "course_id",
            "sha256",
            unique=True,
            postgresql_where=text("sha256 is not null"),
        ),
    )

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    course_id: Mapped[UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    material_id: Mapped[UUID | None] = mapped_column(ForeignKey("materials.id", ondelete="CASCADE"))
    page: Mapped[int | None] = mapped_column(Integer)
    # Set only on a Note that is an uploaded PDF; such a Note keeps body_md == "".
    filename: Mapped[str | None] = mapped_column(String(300))
    sha256: Mapped[str | None] = mapped_column(String(64))
    storage_uri: Mapped[str | None] = mapped_column(Text)
    body_md: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    cognified_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    ingest_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    run_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(NoteStatus, default="dirty")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    course: Mapped[Course] = relationship(lazy="selectin")
    user: Mapped[User] = relationship(lazy="selectin")


__all__ = ["Note", "NoteStatus"]
