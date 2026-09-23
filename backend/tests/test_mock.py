from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from app.mes.mock import MockMesDataProvider
from app.services.shifts import hourly_intervals

def test_mock_events_match_hourly_totals():
    tz = ZoneInfo("Europe/Prague")
    start = datetime(2026, 9, 23, 6, tzinfo=tz)
    end = start + timedelta(hours=8)
    snapshot = MockMesDataProvider().fetch_shift("demo-machine", start, end, end.astimezone(timezone.utc))
    assert snapshot.downtime_detail_available and snapshot.scrap_detail_available
    assert len(snapshot.hours) == 8
    for hour, (begin, finish) in zip(snapshot.hours, hourly_intervals(start, end)):
        events = [event for event in snapshot.downtime_events if begin <= event.start < finish]
        downtime = sum((event.end - event.start).total_seconds() for event in events if event.category != "micro_stop")
        micro = sum((event.end - event.start).total_seconds() for event in events if event.category == "micro_stop")
        scrap = sum(item.count for item in snapshot.scrap_reports if begin <= item.at < finish)
        assert abs(hour.downtime_seconds - downtime) < 0.001
        assert abs(hour.microstop_seconds - micro) < 0.001
        assert hour.scrap_count == scrap

def test_current_hour_has_no_future_events():
    tz = ZoneInfo("Europe/Prague")
    start = datetime(2026, 9, 23, 6, tzinfo=tz)
    now = start + timedelta(minutes=20)
    snapshot = MockMesDataProvider().fetch_shift("demo-machine", start, start + timedelta(hours=8), now)
    assert len(snapshot.hours) == 1
    assert all(event.end <= now for event in snapshot.downtime_events)
    assert all(report.at <= now for report in snapshot.scrap_reports)
