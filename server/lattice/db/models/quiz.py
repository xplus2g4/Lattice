"""Quizzes and what a student answered. Generation and grading live elsewhere."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lattice.db.base import Base, created_at, uuid_pk

QuizKind = Enum("pop", "grill", name="quiz_kind", native_enum=False)
QuizStatus = Enum("open", "submitted", "abandoned", name="quiz_status", native_enum=False)
QuestionKind = Enum("short_answer", "mcq", name="quiz_question_kind", native_enum=False)


class Quiz(Base):
    """A pop quiz on the Topic just read, or a grill over a scope the student chose."""

    __tablename__ = "quizzes"

    id: Mapped[UUID] = uuid_pk()
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    course_id: Mapped[UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(QuizKind)
    scope_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(QuizStatus, default="open")
    score: Mapped[float | None] = mapped_column(Float)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()

    questions: Mapped[list[QuizQuestion]] = relationship(
        back_populates="quiz",
        cascade="all, delete-orphan",
        order_by="QuizQuestion.position",
        lazy="selectin",
    )


class QuizQuestion(Base):
    """Positioned within its Quiz, and pointed at the Topic or Material it came from."""

    __tablename__ = "quiz_questions"
    __table_args__ = (UniqueConstraint("quiz_id", "position"),)

    id: Mapped[UUID] = uuid_pk()
    quiz_id: Mapped[UUID] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"))
    topic_id: Mapped[UUID | None] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"))
    material_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("materials.id", ondelete="SET NULL")
    )
    position: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(QuestionKind)
    prompt: Mapped[str] = mapped_column(Text)
    options_json: Mapped[list[str] | None] = mapped_column(JSONB)
    expected_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    citation_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    quiz: Mapped[Quiz] = relationship(back_populates="questions", lazy="selectin")
    answers: Mapped[list[QuizAnswer]] = relationship(
        back_populates="question",
        cascade="all, delete-orphan",
        order_by="QuizAnswer.attempt_no",
        lazy="selectin",
    )


class QuizAnswer(Base):
    """One row per attempt, so a retry never overwrites what the student first said."""

    __tablename__ = "quiz_answers"
    __table_args__ = (UniqueConstraint("question_id", "attempt_no"),)

    id: Mapped[UUID] = uuid_pk()
    question_id: Mapped[UUID] = mapped_column(ForeignKey("quiz_questions.id", ondelete="CASCADE"))
    attempt_no: Mapped[int] = mapped_column(Integer)
    answer_text: Mapped[str] = mapped_column(Text)
    correct: Mapped[bool | None] = mapped_column()
    feedback_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = created_at()

    question: Mapped[QuizQuestion] = relationship(back_populates="answers")


__all__ = ["Quiz", "QuizAnswer", "QuizQuestion"]
