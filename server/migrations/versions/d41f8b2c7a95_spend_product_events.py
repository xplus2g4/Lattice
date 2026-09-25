"""spend and product events

Revision ID: d41f8b2c7a95
Revises: 5eeedfd59c75
Create Date: 2026-09-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d41f8b2c7a95"
down_revision: str | None = "5eeedfd59c75"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "spend",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("turn_id", sa.Uuid(), nullable=True),
        sa.Column("material_id", sa.Uuid(), nullable=True),
        sa.Column("note_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("cached_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("usd", sa.Numeric(precision=12, scale=6), nullable=True),
        sa.Column("request_id", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["course_id"], ["courses.id"], name=op.f("fk_spend_course_id"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["material_id"],
            ["materials.id"],
            name=op.f("fk_spend_material_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["note_id"], ["notes.id"], name=op.f("fk_spend_note_id"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["turn_id"], ["turns.id"], name=op.f("fk_spend_turn_id"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_spend_user_id"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_spend")),
    )
    op.create_index("ix_spend_occurred_at", "spend", ["occurred_at"])
    op.create_index("ix_spend_course_id_occurred_at", "spend", ["course_id", "occurred_at"])

    op.create_table(
        "product_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "properties",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name=op.f("fk_product_events_course_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_product_events_user_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_product_events")),
    )
    op.create_index("ix_product_events_occurred_at", "product_events", ["occurred_at"])
    op.create_index(
        "ix_product_events_user_id_occurred_at", "product_events", ["user_id", "occurred_at"]
    )
    op.create_index(
        "ix_product_events_course_id_occurred_at", "product_events", ["course_id", "occurred_at"]
    )

    # Never written: Cognify Spend now lives in the ledger, one row per attempt.
    op.drop_column("materials", "cognify_cost_usd")
    op.drop_column("materials", "cognify_tokens")


def downgrade() -> None:
    op.add_column("materials", sa.Column("cognify_tokens", sa.Integer(), nullable=True))
    op.add_column(
        "materials",
        sa.Column("cognify_cost_usd", sa.Numeric(precision=10, scale=4), nullable=True),
    )
    op.drop_index("ix_product_events_course_id_occurred_at", table_name="product_events")
    op.drop_index("ix_product_events_user_id_occurred_at", table_name="product_events")
    op.drop_index("ix_product_events_occurred_at", table_name="product_events")
    op.drop_table("product_events")
    op.drop_index("ix_spend_course_id_occurred_at", table_name="spend")
    op.drop_index("ix_spend_occurred_at", table_name="spend")
    op.drop_table("spend")
