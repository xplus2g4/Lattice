"""course summaries

Revision ID: a7c3e1d9f204
Revises: 5e35c0550c51
Create Date: 2026-09-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "a7c3e1d9f204"
down_revision: str | None = "5e35c0550c51"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pgvector ships in the compose and CI images; the extension only has to be switched on.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "course_summaries",
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(384), nullable=False),
        sa.Column("embedding_model", sa.String(length=200), nullable=False),
        sa.Column("source_digest", sa.String(length=64), nullable=False),
        sa.Column(
            "refreshed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name=op.f("fk_course_summaries_course_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("course_id", name=op.f("pk_course_summaries")),
    )


def downgrade() -> None:
    op.drop_table("course_summaries")
    op.execute("DROP EXTENSION IF EXISTS vector")
