from datetime import datetime, time, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.services import euromap_shift
from app.services.cache import SnapshotCache


PRAGUE = ZoneInfo("Europe/Prague")
SHIFT = SimpleNamespace(id="morning", name="Morning", start_time=time(6), end_time=time(14),
                        days=list(range(7)), active=True)
DISPLAY = SimpleNamespace(id="P2700-01", name="Press display", theme="light")
MACHINE = SimpleNamespace(id="P2700-01", mes_id="P2700-01", name="Krauss Maffei MC5")


def test_real_shift_counts_cycles_and_clips_stops_without_inventing_pieces(monkeypatch):
    monkeypatch.setattr(euromap_shift, "cache", SnapshotCache(15))
    monkeypatch.setattr(euromap_shift, "_fetch", lambda machine, start, end: (
        "KM-MC5-01",
        {"source": "cycles", "segments": [
            {"start": "2026-09-24T06:55:00+02:00", "end": "2026-09-24T07:10:00+02:00",
             "reason": "Material feed"}]},
        [{"time": "2026-09-24T06:10:00+02:00"},
         {"time": "2026-09-24T07:20:00+02:00"}]))
    now = datetime(2026, 9, 25, 10, tzinfo=PRAGUE).astimezone(timezone.utc)
    result = euromap_shift.build_euromap_shift(
        DISPLAY, MACHINE, [SHIFT], now, {"refresh_seconds": 10},
        datetime(2026, 9, 24, 6, tzinfo=PRAGUE))
    live = result["live_shift"]
    assert result["data_source"] == "euromap63"
    assert live["summary"] == {"recorded_cycles": 2, "observed_stop_seconds": 900,
                               "observed_stop_count": 1}
    assert live["hours"][0]["stop_seconds"] == 300
    assert live["hours"][1]["stop_seconds"] == 600
    assert live["hours"][0]["cycle_count"] == 1
    assert live["hours"][1]["cycle_count"] == 1
    assert "production" not in result and "oee" not in result


def test_empty_recording_is_unavailable_not_zero(monkeypatch):
    monkeypatch.setattr(euromap_shift, "cache", SnapshotCache(15))
    monkeypatch.setattr(euromap_shift, "_fetch", lambda machine, start, end: (
        "P1100-03", {"source": "histo_events", "segments": []}, []))
    now = datetime(2026, 9, 25, 10, tzinfo=PRAGUE).astimezone(timezone.utc)
    result = euromap_shift.build_euromap_shift(
        DISPLAY, MACHINE, [SHIFT], now, {"refresh_seconds": 10},
        datetime(2026, 9, 24, 6, tzinfo=PRAGUE))
    live = result["live_shift"]
    assert live["summary"]["recorded_cycles"] is None
    assert live["summary"]["observed_stop_seconds"] is None
    assert live["hours"][0]["cycle_count"] is None
    assert live["hours"][0]["stop_seconds"] is None
