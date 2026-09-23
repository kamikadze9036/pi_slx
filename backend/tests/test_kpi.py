from datetime import datetime, time
from types import SimpleNamespace
from zoneinfo import ZoneInfo
from app.services.kpi import LossInput, calculate
from app.services.shifts import active_shift, hourly_intervals

def assert_balanced(result):
    total = (result.good_seconds + result.speed_loss_seconds + result.scrap_loss_seconds
             + result.downtime_seconds + result.microstop_seconds + result.unknown_seconds)
    assert abs(total - result.planned_seconds) < 0.001

def test_perfect_production():
    result = calculate(LossInput(3600, 225, 0, 0, 32, 2))
    assert result.oee == 1
    assert_balanced(result)

def test_downtime_only():
    result = calculate(LossInput(3600, 180, 0, 720, 32, 2))
    assert result.downtime_seconds == 720
    assert result.speed_loss_seconds == 0
    assert_balanced(result)

def test_speed_only():
    result = calculate(LossInput(3600, 180, 0, 0, 32, 2))
    assert result.speed_loss_seconds == 720
    assert_balanced(result)

def test_scrap_only():
    result = calculate(LossInput(3600, 200, 25, 0, 32, 2))
    assert result.scrap_loss_seconds == 400
    assert result.quality == 200 / 225
    assert_balanced(result)

def test_combined_losses():
    result = calculate(LossInput(3600, 140, 10, 600, 32, 2, 100))
    assert result.speed_loss_seconds == 500
    assert result.oee is not None
    assert_balanced(result)

def test_partial_current_hour():
    result = calculate(LossInput(23 * 60, 60, 2, 100, 32, 2))
    assert result.planned_seconds == 1380
    assert_balanced(result)

def test_night_shift_over_midnight():
    night = SimpleNamespace(id="night", name="Night", start_time=time(22), end_time=time(6), days=list(range(7)), active=True)
    now = datetime(2026, 9, 23, 2, 0, tzinfo=ZoneInfo("Europe/Prague"))
    selected = active_shift([night], now, "Europe/Prague")
    assert selected is not None
    _, start, end = selected
    assert start.date().isoformat() == "2026-09-22"
    assert end.date().isoformat() == "2026-09-23"
    assert len(hourly_intervals(start, end)) == 8

def test_night_shift_across_dst():
    night = SimpleNamespace(id="night", name="Night", start_time=time(22), end_time=time(6), days=list(range(7)), active=True)
    now = datetime(2026, 10, 25, 3, 30, tzinfo=ZoneInfo("Europe/Prague"))
    selected = active_shift([night], now, "Europe/Prague")
    assert selected is not None
    _, start, end = selected
    assert len(hourly_intervals(start, end)) == 9

def test_zero_production_and_missing_ideal():
    zero = calculate(LossInput(3600, 0, 0, 0, 32, 2))
    assert zero.oee is None and zero.status == "insufficient_data"
    assert_balanced(zero)
    missing = calculate(LossInput(3600, 10, 0, 600, None, 2))
    assert missing.unknown_seconds == 3000
    assert "missing_ideal_cycle" in missing.warnings
    assert_balanced(missing)

def test_multiple_cavities_and_overperformance():
    multiple = calculate(LossInput(3600, 200, 0, 400, 32, 2))
    assert multiple.good_seconds == 3200
    assert_balanced(multiple)
    over = calculate(LossInput(3600, 300, 0, 0, 32, 2))
    assert over.performance > 1
    assert over.speed_loss_seconds == 0
    assert "performance_above_100_percent" in over.warnings
    assert_balanced(over)
