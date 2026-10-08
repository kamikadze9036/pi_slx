from datetime import datetime, timezone
import pytest
from app.services.hourly_good import estimate_good
from app.services.hourly_overview import compute_overview

def utc(hour, minute=0):
    return datetime(2026, 10, 8, hour, minute, tzinfo=timezone.utc)

def declaration(hour, minute, good, product="A", order="OF1"):
    return {"time": utc(hour, minute).isoformat(), "product": product, "order_ref": order, "qty_good": good}

HOURS = [(utc(6), utc(7)), (utc(7), utc(8)), (utc(8), utc(9))]

def test_interpolates_increase_linearly_inside_hours():
    good = {"baseline": [declaration(5, 30, 1000)],
            "declarations": [declaration(6, 30, 1046), declaration(7, 30, 1092), declaration(8, 30, 1138)]}
    result = estimate_good(HOURS, good)
    assert result[0]["good"] == pytest.approx(46)      # 23 from the first segment + 23 from the second
    assert result[1]["good"] == pytest.approx(46)
    assert result[2]["good"] is None                   # not covered after the last declaration

def test_hour_not_covered_by_every_product_is_unavailable():
    good = {"baseline": [declaration(5, 0, 0), declaration(5, 0, 0, "B")],
            "declarations": [declaration(7, 0, 100), declaration(6, 30, 50, "B")]}
    result = estimate_good(HOURS[:2], good)
    assert result[0]["good"] is None   # product B only covered until 06:30
    assert result[1]["good"] is None

def test_order_change_breaks_the_segment():
    good = {"baseline": [declaration(5, 30, 900, order="OF1")],
            "declarations": [declaration(6, 30, 40, order="OF2")]}
    assert estimate_good(HOURS[:1], good)[0]["good"] is None

def test_missing_declarations_return_none():
    assert estimate_good(HOURS, None)[0]["good"] is None

def live_base(hour_overrides=None):
    hour = {"start": "2026-10-08T06:00:00+00:00", "end": "2026-10-08T07:00:00+00:00", "elapsed_seconds": 3600,
            "cycle_count": 100, "stop_seconds": 600, "stop_count": 1, "good_estimate": 184.0, "good_orders": ["OF1"],
            **(hour_overrides or {})}
    return {"status": "ok", "data_source": "euromap63",
            "live_shift": {"hours": [hour], "downtime_events": [], "scrap_declarations": [], "pieces_per_cycle": 4,
                           "planned_cycle_seconds": 60.0, "current_order": "OF1",
                           "summary": {"cycle_count": 100, "observed_stop_count": 1, "observed_stop_seconds": 600}}}

def test_live_hour_with_estimate_gets_production_metrics_marked_estimated():
    overview = compute_overview(live_base())["overview"]
    row = overview["hours"][0]
    assert row["production"]["count_basis"] == "estimated"
    assert row["capacity"]["ideal_capacity"] == pytest.approx(3600 / 60 * 4)
    assert row["quality"]["status"] == "provisional"
    assert overview["total"]["production"]["count_basis"] == "estimated"
    assert overview["total"]["estimate"] == {"hours_covered": 1, "hours_total": 1}

def test_live_hour_of_another_order_stays_unavailable():
    row = compute_overview(live_base({"good_orders": ["OF0"]}))["overview"]["hours"][0]
    assert row["capacity"] is None and row["production"] is None
