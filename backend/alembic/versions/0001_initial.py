"""Initial configuration tables."""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("machines",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("mes_id", sa.String(128), nullable=False, unique=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("pieces_per_cycle", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ideal_cycle_seconds", sa.Float(), nullable=True))
    op.create_table("shifts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("days", sa.JSON(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_table("displays",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("machine_id", sa.String(64), sa.ForeignKey("machines.id"), nullable=False),
        sa.Column("dashboard_type", sa.String(64), nullable=False, server_default="production-efficiency"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_client", sa.String(300), nullable=True),
        sa.Column("last_ip", sa.String(64), nullable=True),
        sa.Column("frontend_version", sa.String(64), nullable=True))
    op.create_table("app_settings",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False))
    op.create_table("audit_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("entity", sa.String(80), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False))

def downgrade():
    op.drop_table("audit_log")
    op.drop_table("app_settings")
    op.drop_table("displays")
    op.drop_table("shifts")
    op.drop_table("machines")
