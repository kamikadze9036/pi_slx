from datetime import datetime, time, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo
from app.services.imprint import build_imprint

def test_imprint_matches_dashboard_totals():
    display = SimpleNamespace(id="demo", name="Demo", theme="dark")
    machine = SimpleNamespace(id="demo-machine", mes_id="demo-machine", name="Demo machine",
                              pieces_per_cycle=2, ideal_cycle_seconds=32.0)
    shift = SimpleNamespace(id="morning", name="Morning", start_time=time(6), end_time=time(14),
                            days=list(range(7)), active=True)
    now = datetime(2026, 9, 23, 10, 23, tzinfo=ZoneInfo("Europe/Prague")).astimezone(timezone.utc)
    imprint = build_imprint(display, machine, [shift], now)
    assert imprint["status"] == "ok"
    assert len(imprint["ticks"]) == 9
    assert sum(item["count"] for item in imprint["scrap_reports"]) == imprint["summary"]["scrap_count"]
    assert abs(sum(item["seconds"] for item in imprint["downtime_events"] if item["category"] != "micro_stop")
               - imprint["summary"]["downtime_seconds"]) < 0.001
    assert all(datetime.fromisoformat(item["end"]).astimezone(timezone.utc) <= now
               for item in imprint["downtime_events"])


def test_hourly_overview_cycle_estimate_and_settings(monkeypatch):
    from app.mes.base import DowntimeEvent, HourObservation, MesSnapshot, ScrapReport
    from app.services import dashboard
    from app.services.cache import SnapshotCache

    start = datetime(2026, 10, 6, 6, tzinfo=ZoneInfo("Europe/Prague"))
    snapshot = MesSnapshot("Product", "Order", 120, [HourObservation(start, 90, 10, 600, 60, 32)],
                           [DowntimeEvent(start, datetime(2026, 10, 6, 6, 10, tzinfo=start.tzinfo), "material", "Feed", "Operator note")],
                           [ScrapReport(start, 10, "Burn", "Scrap note")], True, True)
    monkeypatch.setattr(dashboard, "cache", SnapshotCache(5))
    # Imprint and dashboard must read the same cache and provider.
    monkeypatch.setattr("app.services.imprint.cache", dashboard.cache)
    monkeypatch.setattr(dashboard, "provider", SimpleNamespace(fetch_shift=lambda *args: snapshot))
    machine = SimpleNamespace(id="demo", mes_id="demo", name="Press", pieces_per_cycle=2, ideal_cycle_seconds=32)
    display = SimpleNamespace(id="demo", name="Demo", theme="light")
    shift = SimpleNamespace(id="morning", name="Morning", start_time=time(6), end_time=time(14), days=list(range(7)), active=True)
    settings = {"refresh_seconds": 20, "visible_kpis": ["oee"], "oee_warning_threshold": 0.8}
    result = build_imprint(display, machine, [shift], datetime(2026, 10, 6, 7, tzinfo=start.tzinfo), settings)
    hour = result["hours"][0]
    assert hour["ideal_cycle_seconds"] == 32
    assert hour["pieces_per_cycle"] == 2
    assert hour["estimated_cycle_seconds"] == 58.8
    assert result["display_settings"] == settings
    assert result["downtime_events"][0]["comment"] == "Operator note"
    assert result["scrap_reports"][0]["comment"] == "Scrap note"
