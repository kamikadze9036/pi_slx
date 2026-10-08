"""New displays default to the hourly overview."""
from alembic import op

revision = "0004_hourly_new_default"
down_revision = "0003_fleet_enabled"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("displays", "dashboard_type", server_default="hourly-new")


def downgrade():
    op.alter_column("displays", "dashboard_type", server_default="production-efficiency")
