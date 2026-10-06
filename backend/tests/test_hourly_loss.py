import pytest
from app.services.hourly_loss import SegmentInput, aggregate, calculate_segment

def example(**kw):
    base = dict(elapsed_seconds=3600, good_count=170, scrap_count=10, downtime_seconds=600,
                microstop_seconds=120, ideal_cycle_seconds=30, pieces_per_cycle=2)
    return SegmentInput(**{**base, **kw})

def test_worked_example():
    r = calculate_segment(example())
    assert r.ideal_capacity == pytest.approx(240)
    assert r.downtime_equiv == pytest.approx(40)
    assert r.microstop_equiv == pytest.approx(8)
    assert r.speed_loss_pieces == pytest.approx(12)
    assert r.stop_recovery == pytest.approx(45)
    assert r.without_scrap_or_stops == pytest.approx(225)
    assert r.recoverable_output == pytest.approx(55)
    assert r.efficiency == pytest.approx(170 / 240)
    assert r.cycle_actual_seconds == pytest.approx(32)
    assert r.cycle_delta_seconds == pytest.approx(2)
    assert r.status == "verified"
    stack = 170 + 10 + r.downtime_equiv + r.microstop_equiv + r.speed_loss_pieces
    assert stack == pytest.approx(r.ideal_capacity)

def test_excluded_break_removes_ideal_rate_capacity():
    r = calculate_segment(example(excluded_seconds=60, downtime_seconds=0, microstop_seconds=0,
                                  good_count=100, scrap_count=0))
    assert r.ideal_capacity == pytest.approx(240 - 60 * 2 / 30)
    assert r.recoverable_output == pytest.approx(0)

def test_fully_stopped_hour_has_no_counterfactual():
    r = calculate_segment(example(good_count=0, scrap_count=0, downtime_seconds=3600,
                                  microstop_seconds=0))
    assert r.ideal_capacity == pytest.approx(240)
    assert r.without_scrap_or_stops is None
    assert r.efficiency == 0

def test_missing_rate_is_unavailable_not_guessed():
    r = calculate_segment(example(ideal_cycle_seconds=None))
    assert r.ideal_capacity is None and r.efficiency is None
    assert r.status == "insufficient_data"

def test_unverified_gain_is_inconsistent_and_ratio_not_capped():
    r = calculate_segment(example(good_count=300, scrap_count=0, downtime_seconds=0,
                                  microstop_seconds=0))
    assert r.status == "inconsistent"
    assert r.efficiency == pytest.approx(300 / 240)
    ok = calculate_segment(example(good_count=300, scrap_count=0, downtime_seconds=0,
                                   microstop_seconds=0, gain_verified=True))
    assert ok.status == "verified" and ok.speed_gain_pieces == pytest.approx(60)

def test_aggregate_sums_before_ratio_and_mixes_rates():
    a = calculate_segment(example())
    b = calculate_segment(example(ideal_cycle_seconds=60, pieces_per_cycle=1, good_count=50,
                                  scrap_count=0, downtime_seconds=0, microstop_seconds=0))
    t = aggregate([a, b])
    assert t.good_count == 220
    assert t.ideal_capacity == pytest.approx(240 + 60)
    assert t.efficiency == pytest.approx(220 / 300)
    assert t.ideal_cycle_seconds is None and t.cycle_delta_seconds is None
    same = aggregate([a, a])
    assert same.cycle_actual_seconds == pytest.approx(32)
    assert same.recoverable_output == pytest.approx(110)

def test_aggregate_keeps_unavailable_unavailable():
    t = aggregate([calculate_segment(example()), calculate_segment(example(ideal_cycle_seconds=None))])
    assert t.ideal_capacity is None and t.efficiency is None
    assert t.status == "insufficient_data"
