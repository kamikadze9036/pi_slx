from datetime import datetime, timezone
from app.mes.base import MesSnapshot

def validate_snapshot(snapshot: MesSnapshot, shift_start: datetime, shift_end: datetime) -> list[str]:
    warnings = set()
    start_utc = shift_start.astimezone(timezone.utc)
    end_utc = shift_end.astimezone(timezone.utc)
    intervals = []
    for hour in snapshot.hours:
        if hour.start.tzinfo is None or not start_utc <= hour.start.astimezone(timezone.utc) < end_utc:
            warnings.add("invalid_hour_timestamp")
        if hour.good_count < 0 or hour.scrap_count < 0 or hour.downtime_seconds < 0 or hour.microstop_seconds < 0:
            warnings.add("negative_input")
    for event in snapshot.downtime_events:
        if event.start.tzinfo is None or event.end.tzinfo is None:
            warnings.add("invalid_downtime_timestamp")
            continue
        begin = event.start.astimezone(timezone.utc)
        finish = event.end.astimezone(timezone.utc)
        if finish <= begin:
            warnings.add("invalid_downtime_interval")
            continue
        if begin < start_utc or finish > end_utc:
            warnings.add("downtime_outside_shift")
        intervals.append((begin, finish))
    intervals.sort()
    latest_end = None
    for begin, finish in intervals:
        if latest_end is not None and begin < latest_end:
            warnings.add("overlapping_downtime_intervals")
        latest_end = max(latest_end, finish) if latest_end else finish
    for report in snapshot.scrap_reports:
        if report.at.tzinfo is None or not start_utc <= report.at.astimezone(timezone.utc) < end_utc:
            warnings.add("invalid_scrap_timestamp")
        if report.count < 0:
            warnings.add("negative_input")
    if snapshot.scrap_detail_available and sum(item.count for item in snapshot.scrap_reports) > sum(item.scrap_count for item in snapshot.hours):
        warnings.add("scrap_reports_exceed_hourly_scrap")
    return sorted(warnings)
