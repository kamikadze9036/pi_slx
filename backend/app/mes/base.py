from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

@dataclass(frozen=True)
class HourObservation:
    start: datetime
    good_count: int
    scrap_count: int
    downtime_seconds: float
    microstop_seconds: float = 0
    ideal_cycle_seconds: float | None = None

@dataclass(frozen=True)
class DowntimeEvent:
    start: datetime
    end: datetime
    category: str
    reason: str

@dataclass(frozen=True)
class ScrapReport:
    at: datetime
    count: int
    reason: str

@dataclass(frozen=True)
class MesSnapshot:
    product: str | None
    order: str | None
    target_per_hour: float | None
    hours: list[HourObservation]
    downtime_events: list[DowntimeEvent] = field(default_factory=list)
    scrap_reports: list[ScrapReport] = field(default_factory=list)
    downtime_detail_available: bool = False
    scrap_detail_available: bool = False

class MesDataProvider(Protocol):
    def fetch_shift(self, mes_machine_id: str, start: datetime, end: datetime, now: datetime) -> MesSnapshot: ...
