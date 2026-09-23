from datetime import time
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class MachineIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    mes_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=160)
    active: bool = True
    fleet_enabled: bool = True
    pieces_per_cycle: int = Field(default=1, ge=1)
    ideal_cycle_seconds: float | None = Field(default=None, gt=0)

class MachineOut(MachineIn):
    model_config = ConfigDict(from_attributes=True)

class ShiftIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=100)
    start_time: time
    end_time: time
    days: list[int] = Field(min_length=1)
    active: bool = True

class ShiftOut(ShiftIn):
    model_config = ConfigDict(from_attributes=True)

class DisplayIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    machine_id: str
    active: bool = True
    dashboard_type: Literal["production-efficiency", "shift-imprint"] = "production-efficiency"
    theme: Literal["dark", "light"] = "dark"

class DisplayOut(DisplayIn):
    model_config = ConfigDict(from_attributes=True)
    last_seen: str | None = None
    online: bool = False

class HeartbeatIn(BaseModel):
    frontend_version: str = Field(default="unknown", max_length=64)

class DashboardSettingsIn(BaseModel):
    refresh_seconds: int = Field(ge=3, le=300)
    visible_kpis: list[Literal["oee", "availability", "performance", "quality", "good", "scrap", "downtime", "speed_loss"]] = Field(min_length=1)
    oee_warning_threshold: float = Field(ge=0, le=1)
