from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c28fb7a91e04"
down_revision: str | None = "8c84be6b6e5d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.add_column(
        "notes", sa.Column("cognified_revision", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "notes", sa.Column("ingest_attempts", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column("notes", sa.Column("run_after", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE notes SET cognified_revision = revision WHERE status = 'ready'")


def downgrade() -> None:
    op.drop_column("notes", "run_after")
    op.drop_column("notes", "ingest_attempts")
    op.drop_column("notes", "cognified_revision")
    op.drop_column("notes", "revision")
