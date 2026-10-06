from datetime import datetime, time, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import pytest
from app.services import euromap_shift
from app.services.cache import SnapshotCache
from app.services.hourly_overview import build_hourly_overview, compute_overview
from app.services.imprint import build_imprint

PRAGUE = ZoneInfo("Europe/Prague")
SHIFT = SimpleNamespace(id="morning", name="Morning", start_time=time(6), end_time=time(14),
                        days=list(range(7)), active=True)

def hour(**kw):
    base = dict(start="2026-10-06T06:00:00+02:00", end="2026-10-06T07:00:00+02:00",
                duration_seconds=3600, elapsed_seconds=3600, good_count=170, scrap_count=10,
                downtime_seconds=600, microstop_seconds=120, excluded_break_seconds=0,
                ideal_cycle_seconds=30, pieces_per_cycle=2, warnings=[])
    return {**base, **kw}

def test_verified_hour_matches_worked_example_and_keeps_observations():
    base = {"status": "ok", "data_source": "mock", "hours": [hour()],
            "downtime_events": [{"start": "2026-10-06T06:10:00+02:00", "end": "2026-10-06T06:20:00+02:00",
                                 "category": "downtime", "reason": "Material"}],
            "scrap_reports": [{"at": "2026-10-06T06:30:00+02:00", "count": 10, "reason": "Burn"}],
            "summary": {"downtime_seconds": 600, "scrap_count": 10}}
    overview = compute_overview(base)["overview"]
    row, total = overview["hours"][0], overview["total"]
    assert row["capacity"]["ideal_capacity"] == pytest.approx(240)
    assert row["capacity"]["without_scrap_or_stops"] == pytest.approx(225)
    assert row["capacity"]["recoverable_output"] == pytest.approx(55)
    assert row["efficiency"] == {"ratio": pytest.approx(170 / 240), "kind": "oee", "denominator": pytest.approx(240)}
    assert row["cycle"]["delta_seconds"] == pytest.approx(2)
    assert sum(v["pieces"] for k, v in row["composition"].items() if v["pieces"] is not None) == pytest.approx(240)
    assert sum(v["seconds"] for v in row["composition"].values()) == pytest.approx(3600)
    assert row["raw_observations"] == {"recorded_count": None, "stop_seconds": 600, "stop_count": 1, "declared_scrap": 10}
    assert total["capacity"]["recoverable_output"] == pytest.approx(55)
    assert total["quality"]["status"] == "verified"

def test_missing_rate_gives_null_metrics_not_fallback():
    base = {"status": "ok", "data_source": "ciclades", "hours": [hour(ideal_cycle_seconds=None)],
            "summary": {"downtime_seconds": 600, "scrap_count": 10}}
    overview = compute_overview(base)["overview"]
    assert overview["hours"][0]["capacity"] is None
    assert overview["hours"][0]["quality"]["status"] == "insufficient_data"
    assert overview["total"]["efficiency"] is None
    assert overview["hours"][0]["raw_observations"]["stop_seconds"] == 600

def test_future_hour_is_not_invented():
    base = {"status": "ok", "data_source": "mock", "hours": [hour(), hour(elapsed_seconds=0, start="2026-10-06T07:00:00+02:00")],
            "summary": {}}
    overview = compute_overview(base)["overview"]
    assert overview["hours"][1]["capacity"] is None
    assert overview["total"]["quality"]["status"] == "verified"

def test_euromap_live_keeps_observations_without_production_metrics(monkeypatch):
    monkeypatch.setattr(euromap_shift, "cache", SnapshotCache(15))
    monkeypatch.setattr(euromap_shift, "_fetch", lambda machine, start, end, current: (
        "KM-1", {"source": "cycles", "segments": [{"start": "2026-09-24T06:55:00+02:00",
                                                    "end": "2026-09-24T07:10:00+02:00", "reason": "Feed"}]},
        [{"time": "2026-09-24T06:10:00+02:00"}, {"time": "2026-09-24T07:20:00+02:00"}], None, None,
        {"declarations": [{"time": "2026-09-24T06:30:00+02:00", "quantity": 2.0, "reason": "Burn"}]}, None))
    display = SimpleNamespace(id="d", name="D", theme="light")
    machine = SimpleNamespace(id="m", mes_id="m", name="M")
    now = datetime(2026, 9, 24, 8, tzinfo=PRAGUE).astimezone(timezone.utc)
    result = build_hourly_overview(euromap_shift.build_euromap_shift, display, machine, [SHIFT], now,
                                   {"refresh_seconds": 20, "visible_kpis": [], "oee_warning_threshold": 0.7})
    first = result["overview"]["hours"][0]
    assert first["raw_observations"]["recorded_count"] == 1
    assert first["raw_observations"]["stop_seconds"] == 300
    assert first["raw_observations"]["declared_scrap"] == 2
    assert first["capacity"] is None and first["quality"]["missing_inputs"]
    assert result["overview"]["total"]["raw_observations"]["recorded_count"] == 2
    assert result["overview"]["total"]["efficiency"] is None

def test_mock_provider_end_to_end():
    display = SimpleNamespace(id="demo", name="Demo", theme="dark")
    machine = SimpleNamespace(id="demo-machine", mes_id="demo-machine", name="Demo", pieces_per_cycle=2, ideal_cycle_seconds=32.0)
    now = datetime(2026, 9, 23, 10, 23, tzinfo=PRAGUE).astimezone(timezone.utc)
    result = build_hourly_overview(build_imprint, display, machine, [SHIFT], now)
    assert len(result["overview"]["hours"]) == len(result["hours"])
    assert result["overview"]["total"]["production"]["good_count"] == result["summary"]["good_count"]
