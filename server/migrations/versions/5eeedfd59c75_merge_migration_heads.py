"""merge migration heads

Revision ID: 5eeedfd59c75
Revises: a7c3e1d9f204, eb6a954685bc
Create Date: 2026-09-24 23:42:03.906737
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '5eeedfd59c75'
down_revision: str | None = ('a7c3e1d9f204', 'eb6a954685bc')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
