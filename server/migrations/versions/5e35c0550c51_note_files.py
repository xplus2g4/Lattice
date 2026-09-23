from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5e35c0550c51"
down_revision: str | None = "c28fb7a91e04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A Note backed by an uploaded PDF: the file's name, hash and where its bytes live.
    op.add_column("notes", sa.Column("filename", sa.String(300), nullable=True))
    op.add_column("notes", sa.Column("sha256", sa.String(64), nullable=True))
    op.add_column("notes", sa.Column("storage_uri", sa.Text(), nullable=True))
    op.create_index(
        "uq_notes_user_id_course_id_sha256",
        "notes",
        ["user_id", "course_id", "sha256"],
        unique=True,
        postgresql_where=sa.text("sha256 is not null"),
    )


def downgrade() -> None:
    op.drop_index("uq_notes_user_id_course_id_sha256", table_name="notes")
    op.drop_column("notes", "storage_uri")
    op.drop_column("notes", "sha256")
    op.drop_column("notes", "filename")
