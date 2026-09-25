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
    monkeypatch.setattr(euromap_shift, "_fetch", lambda machine, start, end, current: (
        "KM-MC5-01",
        {"source": "cycles", "segments": [
            {"start": "2026-09-24T06:55:00+02:00", "end": "2026-09-24T07:10:00+02:00",
             "reason": "Material feed"}]},
        [{"time": "2026-09-24T06:10:00+02:00"},
         {"time": "2026-09-24T07:20:00+02:00"}], None, None))
    now = datetime(2026, 9, 25, 10, tzinfo=PRAGUE).astimezone(timezone.utc)
    result = euromap_shift.build_euromap_shift(
        DISPLAY, MACHINE, [SHIFT], now, {"refresh_seconds": 10},
        datetime(2026, 9, 24, 6, tzinfo=PRAGUE))
    live = result["live_shift"]
    assert result["data_source"] == "euromap63"
    assert live["summary"] == {"cycle_count": 2, "observed_stop_seconds": 900,
                               "observed_stop_count": 1}
    assert live["cycle_source"] == "recorded"
    assert live["hours"][0]["stop_seconds"] == 300
    assert live["hours"][1]["stop_seconds"] == 600
    assert live["hours"][0]["cycle_count"] == 1
    assert live["hours"][1]["cycle_count"] == 1
    assert "production" not in result and "oee" not in result


def test_empty_recording_is_unavailable_not_zero(monkeypatch):
    monkeypatch.setattr(euromap_shift, "cache", SnapshotCache(15))
    monkeypatch.setattr(euromap_shift, "_fetch", lambda machine, start, end, current: (
        "P1100-03", {"source": "histo_events", "segments": []}, [], [], None))
    now = datetime(2026, 9, 25, 10, tzinfo=PRAGUE).astimezone(timezone.utc)
    result = euromap_shift.build_euromap_shift(
        DISPLAY, MACHINE, [SHIFT], now, {"refresh_seconds": 10},
        datetime(2026, 9, 24, 6, tzinfo=PRAGUE))
    live = result["live_shift"]
    assert live["summary"]["cycle_count"] is None
    assert live["summary"]["observed_stop_seconds"] is None
    assert live["hours"][0]["cycle_count"] is None
    assert live["hours"][0]["stop_seconds"] is None


def test_sampled_counter_increase_is_shown_without_claiming_piece_output(monkeypatch):
    monkeypatch.setattr(euromap_shift, "cache", SnapshotCache(15))
    monkeypatch.setattr(euromap_shift, "_fetch", lambda machine, start, end, current: (
        "P600-002", {"source": "histo_events", "segments": []}, [], [
            {"window_start": "2026-09-25T06:00:00+02:00", "time": "2026-09-25T06:15:00+02:00",
             "delta_count": 15.0},
            {"window_start": "2026-09-25T06:15:00+02:00", "time": "2026-09-25T06:30:00+02:00",
             "delta_count": 14.0},
            {"window_start": "2026-09-25T06:30:00+02:00", "time": "2026-09-25T06:45:00+02:00",
             "delta_count": -4.0},
        ], {"state": "bezi", "order_ref": "OF-42", "cycle_time_real_s": 59.0}))
    now = datetime(2026, 9, 25, 7, tzinfo=PRAGUE).astimezone(timezone.utc)
    result = euromap_shift.build_euromap_shift(
        DISPLAY, MACHINE, [SHIFT], now, {"refresh_seconds": 10})
    live = result["live_shift"]
    assert live["cycle_source"] == "counter"
    assert live["summary"]["cycle_count"] == 29
    assert live["hours"][0]["cycle_count"] == 29
    assert live["hours"][0]["stop_seconds"] is None
    assert len(live["cycle_bins"]) == 2
    assert live["current_machine"]["order_ref"] == "OF-42"
    assert "production" not in result and "summary" not in result
