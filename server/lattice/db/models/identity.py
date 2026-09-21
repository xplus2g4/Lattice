"""Users, courses and enrolments: who the caller is and what they may read."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lattice.db.base import Base, created_at, updated_at, uuid_pk

Role = Enum("student", "instructor", "admin", name="user_role", native_enum=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(Role, default="student")
    notes_opt_out: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set on first enrolment, when the engine identity is created.
    cognee_principal_id: Mapped[UUID | None] = mapped_column()
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    enrolments: Mapped[list[Enrolment]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    term: Mapped[str | None] = mapped_column(String(32))
    owner_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    global_dataset_name: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = created_at()

    enrolments: Mapped[list[Enrolment]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )


class Enrolment(Base):
    """A user's membership of a course. Carries no role: Materials are crowd-uploaded, and
    mutating one is the uploader's or the course owner's right, not an enrolment's."""

    __tablename__ = "enrolments"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    course_id: Mapped[UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True
    )
    user_dataset_name: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = created_at()

    user: Mapped[User] = relationship(back_populates="enrolments")
    course: Mapped[Course] = relationship(back_populates="enrolments", lazy="selectin")


__all__ = ["Course", "Enrolment", "User"]
