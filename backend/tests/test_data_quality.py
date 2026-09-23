from datetime import datetime, timedelta, timezone
from app.mes.base import DowntimeEvent, HourObservation, MesSnapshot, ScrapReport
from app.services.data_quality import validate_snapshot

def test_overlaps_and_out_of_shift_events_are_reported():
    start = datetime(2026, 9, 23, 6, tzinfo=timezone.utc)
    end = start + timedelta(hours=8)
    snapshot = MesSnapshot(None, None, None,
        [HourObservation(start, 10, 1, 60)],
        [DowntimeEvent(start + timedelta(minutes=10), start + timedelta(minutes=20), "mechanical", "Fault"),
         DowntimeEvent(start + timedelta(minutes=15), start + timedelta(minutes=25), "material", "Feed"),
         DowntimeEvent(end - timedelta(minutes=5), end + timedelta(minutes=5), "quality", "Check")],
        [ScrapReport(start + timedelta(minutes=30), 2, "Surface")], True, True)
    warnings = validate_snapshot(snapshot, start, end)
    assert "overlapping_downtime_intervals" in warnings
    assert "downtime_outside_shift" in warnings
    assert "scrap_reports_exceed_hourly_scrap" in warnings
