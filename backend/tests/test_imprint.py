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
