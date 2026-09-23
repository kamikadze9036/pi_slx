from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from app.db.models import Shift

def utc_seconds(start: datetime, end: datetime) -> float:
    return max(0.0, (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds())

def active_shift(shifts: list[Shift], now: datetime, tz_name: str) -> tuple[Shift, datetime, datetime] | None:
    tz = ZoneInfo(tz_name)
    local_now = now.astimezone(tz)
    for day_offset in (0, -1):
        day = local_now.date() + timedelta(days=day_offset)
        for shift in shifts:
            if not shift.active or day.weekday() not in shift.days:
                continue
            start = datetime.combine(day, shift.start_time, tz)
            end_day = day + timedelta(days=1 if shift.end_time <= shift.start_time else 0)
            end = datetime.combine(end_day, shift.end_time, tz)
            if start.astimezone(timezone.utc) <= now.astimezone(timezone.utc) < end.astimezone(timezone.utc):
                return shift, start, end
    return None

def hourly_intervals(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    intervals = []
    current = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    while current < end_utc:
        stop = min(current + timedelta(hours=1), end_utc)
        intervals.append((current.astimezone(start.tzinfo), stop.astimezone(start.tzinfo)))
        current = stop
    return intervals
