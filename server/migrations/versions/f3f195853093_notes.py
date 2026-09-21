"""notes

Revision ID: f3f195853093
Revises: b4a77f721f8d
Create Date: 2026-09-21 10:07:02.101997
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3f195853093"
down_revision: str | None = "b4a77f721f8d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ANCHORED = sa.text("material_id is not null")


def upgrade() -> None:
    op.create_table(
        "notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=True),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("body_md", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("dirty", "indexing", "ready", "failed", name="note_status", native_enum=False),
            nullable=False,
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["course_id"], ["courses.id"], name=op.f("fk_notes_course_id"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["material_id"],
            ["materials.id"],
            name=op.f("fk_notes_material_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_notes_user_id"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notes")),
    )
    op.create_index(
        "uq_notes_user_id_material_id_page",
        "notes",
        ["user_id", "material_id", "page"],
        unique=True,
        postgresql_where=ANCHORED,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_notes_user_id_material_id_page", table_name="notes", postgresql_where=ANCHORED
    )
    op.drop_table("notes")
