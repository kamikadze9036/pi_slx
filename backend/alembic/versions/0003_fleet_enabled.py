"""Allow machines to be included in the plant overview."""
from alembic import op
import sqlalchemy as sa

revision = "0003_fleet_enabled"
down_revision = "0002_display_theme"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("machines", sa.Column("fleet_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade():
    op.drop_column("machines", "fleet_enabled")
