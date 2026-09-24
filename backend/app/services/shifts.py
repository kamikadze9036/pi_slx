from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from app.db.models import Shift


class InvalidShiftSelection(ValueError):
    pass

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


def shift_occurrences(shifts: list[Shift], anchor: datetime, tz_name: str) -> list[tuple[Shift, datetime, datetime]]:
    """Scheduled windows around an instant, ordered by their absolute start time."""
    tz = ZoneInfo(tz_name)
    day = anchor.astimezone(tz).date()
    windows = []
    for offset in range(-8, 9):
        shift_day = day + timedelta(days=offset)
        for shift in shifts:
            if not shift.active or shift_day.weekday() not in shift.days:
                continue
            start = datetime.combine(shift_day, shift.start_time, tz)
            end_day = shift_day + timedelta(days=shift.end_time <= shift.start_time)
            end = datetime.combine(end_day, shift.end_time, tz)
            windows.append((shift, start, end))
    return sorted(windows, key=lambda item: item[1].astimezone(timezone.utc))


def selected_shift(shifts: list[Shift], now: datetime, tz_name: str,
                   requested_start: datetime | None = None):
    """Return selected window and its previous/next started windows."""
    if requested_start is not None and requested_start.tzinfo is None:
        raise InvalidShiftSelection("shift_start must include a timezone offset")
    if requested_start is not None and requested_start.astimezone(timezone.utc) > now.astimezone(timezone.utc):
        raise InvalidShiftSelection("Future shifts are not available")
    anchor = requested_start or now
    windows = [item for item in shift_occurrences(shifts, anchor, tz_name)
               if item[1].astimezone(timezone.utc) <= now.astimezone(timezone.utc)]
    if not windows:
        if requested_start is not None:
            raise InvalidShiftSelection("No scheduled shift starts at shift_start")
        return None
    if requested_start is None:
        active = active_shift(shifts, now, tz_name)
        index = next((i for i, item in enumerate(windows)
                      if active and item[0].id == active[0].id
                      and item[1].astimezone(timezone.utc) == active[1].astimezone(timezone.utc)), len(windows) - 1)
    else:
        index = next((i for i, item in enumerate(windows)
                      if item[1].astimezone(timezone.utc) == requested_start.astimezone(timezone.utc)), -1)
        if index < 0:
            raise InvalidShiftSelection("No scheduled shift starts at shift_start")
    selected = windows[index]
    previous = windows[index - 1][1] if index > 0 else None
    following = windows[index + 1][1] if index + 1 < len(windows) else None
    return selected, previous, following

def hourly_intervals(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    intervals = []
    current = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    while current < end_utc:
        stop = min(current + timedelta(hours=1), end_utc)
        intervals.append((current.astimezone(start.tzinfo), stop.astimezone(start.tzinfo)))
        current = stop
    return intervals
