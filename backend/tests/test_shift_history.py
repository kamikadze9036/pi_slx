from datetime import datetime, time, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.services.dashboard import build_dashboard
from app.services.imprint import build_imprint
from app.services.shifts import InvalidShiftSelection, selected_shift


PRAGUE = ZoneInfo("Europe/Prague")
SHIFTS = [
    SimpleNamespace(id="morning", name="Morning", start_time=time(6), end_time=time(14), days=list(range(7)), active=True),
    SimpleNamespace(id="afternoon", name="Afternoon", start_time=time(14), end_time=time(22), days=list(range(7)), active=True),
    SimpleNamespace(id="night", name="Night", start_time=time(22), end_time=time(6), days=list(range(7)), active=True),
]
DISPLAY = SimpleNamespace(id="demo", name="Demo", theme="light")
MACHINE = SimpleNamespace(id="demo-machine", mes_id="demo-machine", name="Demo machine",
                          pieces_per_cycle=2, ideal_cycle_seconds=32.0)


def test_previous_night_shift_is_complete_and_has_adjacent_navigation():
    now = datetime(2026, 9, 24, 10, tzinfo=PRAGUE).astimezone(timezone.utc)
    previous_start = datetime(2026, 9, 23, 22, tzinfo=PRAGUE)
    selected, previous, following = selected_shift(SHIFTS, now, "Europe/Prague", previous_start)
    assert selected[0].id == "night"
    assert selected[2] == datetime(2026, 9, 24, 6, tzinfo=PRAGUE)
    assert previous.hour == 14 and following.hour == 6

    dashboard = build_dashboard(DISPLAY, MACHINE, SHIFTS, now, requested_start=previous_start)
    imprint = build_imprint(DISPLAY, MACHINE, SHIFTS, now, requested_start=previous_start)
    assert dashboard["status"] == imprint["status"] == "ok"
    assert dashboard["shift_navigation"]["is_current"] is False
    assert dashboard["refresh_seconds"] >= 60
    assert len(dashboard["hours"]) == len(imprint["hours"]) == 8
    assert all(hour["elapsed_seconds"] == hour["duration_seconds"] for hour in dashboard["hours"])
    assert imprint["summary"]["good_count"] == dashboard["summary"]["good_count"]
    assert all(datetime.fromisoformat(event["end"]) <= selected[2].astimezone(timezone.utc)
               for event in imprint["downtime_events"])
    assert dashboard["hours"][0]["piece_equivalents"]["good"] == dashboard["hours"][0]["good_count"]


def test_current_shift_and_invalid_history_requests():
    now = datetime(2026, 9, 24, 10, tzinfo=PRAGUE).astimezone(timezone.utc)
    selected, _, following = selected_shift(SHIFTS, now, "Europe/Prague")
    assert selected[0].id == "morning"
    assert following is None
    with pytest.raises(InvalidShiftSelection):
        selected_shift(SHIFTS, now, "Europe/Prague", datetime(2026, 9, 24, 14, tzinfo=PRAGUE))
    with pytest.raises(InvalidShiftSelection):
        selected_shift(SHIFTS, now, "Europe/Prague", datetime(2026, 9, 23, 21, tzinfo=PRAGUE))
    with pytest.raises(InvalidShiftSelection):
        selected_shift(SHIFTS, now, "Europe/Prague", datetime(2026, 9, 23, 22))


def test_mock_history_changes_between_shifts():
    now = datetime(2026, 9, 24, 10, tzinfo=PRAGUE).astimezone(timezone.utc)
    first = build_dashboard(DISPLAY, MACHINE, SHIFTS, now,
                            requested_start=datetime(2026, 9, 23, 6, tzinfo=PRAGUE))
    second = build_dashboard(DISPLAY, MACHINE, SHIFTS, now,
                             requested_start=datetime(2026, 9, 23, 14, tzinfo=PRAGUE))
    assert first["hours"][0]["good_count"] != second["hours"][0]["good_count"]


def test_night_shift_history_across_dst_change():
    now = datetime(2026, 10, 26, 10, tzinfo=PRAGUE).astimezone(timezone.utc)
    previous_start = datetime(2026, 10, 24, 22, tzinfo=PRAGUE)
    dashboard = build_dashboard(DISPLAY, MACHINE, SHIFTS, now, requested_start=previous_start)
    assert len(dashboard["hours"]) == 9
    assert sum(hour["elapsed_seconds"] for hour in dashboard["hours"]) == 9 * 3600
