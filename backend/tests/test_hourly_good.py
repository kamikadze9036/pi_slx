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


def test_shift_totals_use_baseline_of_the_same_order_and_expose_delta_scrap():
    from app.services.hourly_good import shift_totals
    row = lambda h, m, made, ok, rej, delta, order="OF1": {**declaration(h, m, ok, order=order),
                                                          "qty_made": made, "qty_reject": rej, "qty_delta_reject": delta}
    good = {"baseline": [row(5, 0, 100, 90, 6, 4)], "declarations": [row(7, 0, 150, 120, 8, 22), row(6, 0, 130, 105, 7, 18)]}
    totals = shift_totals(good)
    assert (totals["made"], totals["ok"], totals["scrap"], totals["delta_scrap"]) == (50, 30, 2, 18)
    assert shift_totals({"baseline": [], "declarations": []}) is None


def test_delta_scrap_may_decrease_when_cartons_are_declared():
    from app.services.hourly_good import shift_totals
    row = lambda h, made, ok, rej, delta: {**declaration(h, 0, ok), "qty_made": made, "qty_reject": rej, "qty_delta_reject": delta}
    totals = shift_totals({"baseline": [row(5, 100, 80, 5, 15)], "declarations": [row(7, 160, 146, 6, 8)]})
    assert (totals["made"], totals["ok"], totals["scrap"], totals["delta_scrap"]) == (60, 66, 1, -7)
    assert totals["made"] == totals["ok"] + totals["scrap"] + totals["delta_scrap"]


def test_planned_cycle_prefers_the_row_overlapping_the_hour():
    from app.services.hourly_good import planned_cycle_for
    rows = [{"order_ref": "OF1", "planned_cycle_s": 50.0, "start": utc(0).isoformat(), "end": utc(6).isoformat()},
            {"order_ref": "OF1", "planned_cycle_s": 55.0, "start": utc(6).isoformat(), "end": utc(14).isoformat()},
            {"order_ref": "OF2", "planned_cycle_s": 40.0, "start": utc(0).isoformat(), "end": utc(14).isoformat()}]
    assert planned_cycle_for("OF1", utc(7), utc(8), rows) == 55.0
    assert planned_cycle_for("OF1", utc(20), utc(21), rows) == 55.0   # no overlap: latest row
    assert planned_cycle_for("OF3", utc(7), utc(8), rows) is None
    assert planned_cycle_for("OF1", utc(7), utc(8), None) is None


def test_hour_of_a_non_current_order_uses_its_own_planned_cycle_and_product_count():
    base = live_base({"good_orders": ["OF0"], "good_products": 2, "planned_cycle_seconds": 40.0})
    row = compute_overview(base)["overview"]["hours"][0]
    assert row["capacity"]["ideal_capacity"] == pytest.approx(3600 / 40 * 2)
    assert row["production"]["count_basis"] == "estimated"
