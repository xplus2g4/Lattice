"""Keep editable Note titles separate from identity and Cognify revisions."""

import sqlalchemy as sa
from alembic import op

revision = "d13a72e49b06"
down_revision = "c28fb7a91e04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notes", sa.Column("title", sa.String(200), nullable=False, server_default="Untitled Note")
    )


def downgrade() -> None:
    op.drop_column("notes", "title")
