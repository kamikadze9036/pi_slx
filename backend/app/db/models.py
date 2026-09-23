from datetime import datetime, time
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Time
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class Machine(Base):
    __tablename__ = "machines"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    mes_id: Mapped[str] = mapped_column(String(128), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    fleet_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    pieces_per_cycle: Mapped[int] = mapped_column(Integer, default=1)
    ideal_cycle_seconds: Mapped[float | None] = mapped_column(Float)

class Shift(Base):
    __tablename__ = "shifts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    days: Mapped[list[int]] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class Display(Base):
    __tablename__ = "displays"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    machine_id: Mapped[str] = mapped_column(ForeignKey("machines.id"))
    machine: Mapped[Machine] = relationship()
    dashboard_type: Mapped[str] = mapped_column(String(64), default="production-efficiency")
    theme: Mapped[str] = mapped_column(String(16), default="dark")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_client: Mapped[str | None] = mapped_column(String(300))
    last_ip: Mapped[str | None] = mapped_column(String(64))
    frontend_version: Mapped[str | None] = mapped_column(String(64))

class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)

class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    action: Mapped[str] = mapped_column(String(80))
    entity: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(64))
    details: Mapped[dict] = mapped_column(JSON)
