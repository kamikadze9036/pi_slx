"""Add a selectable appearance for each display."""
from alembic import op
import sqlalchemy as sa

revision = "0002_display_theme"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("displays", sa.Column("theme", sa.String(16), nullable=False, server_default="dark"))


def downgrade():
    op.drop_column("displays", "theme")
