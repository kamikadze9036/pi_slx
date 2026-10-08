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

def live_base(hour_overrides=None, parts=None):
    start, end = "2026-10-08T06:00:00+00:00", "2026-10-08T07:00:00+00:00"
    hour = {"start": start, "end": end, "elapsed_seconds": 3600, "cycle_count": 100, "stop_seconds": 600, "stop_count": 1,
            "good_estimate": 184.0, "good_orders": ["OF1"],
            "good_parts": parts or [{"order": "OF1", "good": 184.0, "products": 4, "start": start, "end": end,
                                     "planned_cycle_seconds": 60.0}],
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

def test_live_hour_of_another_order_without_planned_cycle_stays_unavailable():
    parts = [{"order": "OF0", "good": 100.0, "products": 4, "start": "2026-10-08T06:00:00+00:00",
              "end": "2026-10-08T07:00:00+00:00", "planned_cycle_seconds": None}]
    row = compute_overview(live_base(parts=parts))["overview"]["hours"][0]
    assert row["capacity"] is None and row["production"] is None

def test_hour_of_a_non_current_order_uses_its_own_planned_cycle_and_product_count():
    parts = [{"order": "OF0", "good": 100.0, "products": 2, "start": "2026-10-08T06:00:00+00:00",
              "end": "2026-10-08T07:00:00+00:00", "planned_cycle_seconds": 40.0}]
    row = compute_overview(live_base(parts=parts))["overview"]["hours"][0]
    assert row["capacity"]["ideal_capacity"] == pytest.approx(3600 / 40 * 2)
    assert row["production"]["count_basis"] == "estimated"

def test_changeover_hour_is_computed_per_order_and_summed():
    parts = [{"order": "OF0", "good": 50.0, "products": 2, "start": "2026-10-08T06:00:00+00:00",
              "end": "2026-10-08T06:30:00+00:00", "planned_cycle_seconds": 40.0},
             {"order": "OF1", "good": 90.0, "products": 4, "start": "2026-10-08T06:30:00+00:00",
              "end": "2026-10-08T07:00:00+00:00", "planned_cycle_seconds": 60.0}]
    row = compute_overview(live_base(parts=parts))["overview"]["hours"][0]
    assert row["capacity"]["ideal_capacity"] == pytest.approx(1800 / 40 * 2 + 1800 / 60 * 4)
    assert row["production"]["good_count"] == pytest.approx(140)
    assert sum(v["seconds"] for v in row["composition"].values()) == pytest.approx(3600)


def test_estimator_covers_a_changeover_hour_with_order_start_and_end_events():
    from app.services.hourly_good import add_order_bounds
    declarations = [declaration(7, 10, 46, "A", "NEW")]
    good = {"baseline": [declaration(5, 30, 900, "A", "OLD")], "declarations": [declaration(6, 10, 940, "A", "OLD"), *declarations]}
    progress = {"OLD": {"launched_at": utc(0).isoformat(), "products": [{"product": "A", "qty_good": 1000}]},
                "NEW": {"launched_at": utc(6, 30).isoformat(), "products": []}}
    planned = [{"order_ref": "OLD", "start": utc(0).isoformat(), "end": utc(6, 30).isoformat()}]
    result = estimate_good([(utc(6), utc(7))], add_order_bounds(good, progress, planned, "NEW", utc(14)))[0]
    assert result["orders"] == ["OLD", "NEW"]
    assert [p["good"] for p in result["parts"]] == pytest.approx([70.0, 46 * 30 / 40])
    assert result["parts"][0]["end"] == utc(6, 30).isoformat() and result["parts"][1]["start"] == utc(6, 30).isoformat()

def test_planned_cycle_prefers_the_row_overlapping_the_hour():
    from app.services.hourly_good import planned_cycle_for
    rows = [{"order_ref": "OF1", "planned_cycle_s": 50.0, "start": utc(0).isoformat(), "end": utc(6).isoformat()},
            {"order_ref": "OF1", "planned_cycle_s": 55.0, "start": utc(6).isoformat(), "end": utc(14).isoformat()},
            {"order_ref": "OF2", "planned_cycle_s": 40.0, "start": utc(0).isoformat(), "end": utc(14).isoformat()}]
    assert planned_cycle_for("OF1", utc(7), utc(8), rows) == 55.0
    assert planned_cycle_for("OF1", utc(20), utc(21), rows) == 55.0   # no overlap: latest row
    assert planned_cycle_for("OF3", utc(7), utc(8), rows) is None
    assert planned_cycle_for("OF1", utc(7), utc(8), None) is None


def test_shift_orders_lists_finished_before_running_with_cavity_scrap():
    from app.services.hourly_good import shift_orders
    decl = lambda h, product, order, good, rej: {"time": utc(h).isoformat(), "product": product, "order_ref": order,
                                                 "qty_good": good, "qty_reject": rej, "qty_made": good + rej, "qty_delta_reject": 0}
    good = {"baseline": [], "declarations": [decl(6, "B2", "OF1", 90, 10), decl(6, "B1", "OF1", 95, 5),
                                              decl(8, "B2", "OF1", 190, 10), decl(9, "C1", "OF2", 50, 0)]}
    planned = [{"order_ref": "OF1", "tool": "MO1", "tool_label": "Panel", "planned_cycle_s": 50.0,
                "start": utc(5).isoformat(), "end": utc(9).isoformat()},
               {"order_ref": "OF2", "tool": "MO2", "tool_label": "Cover", "planned_cycle_s": 40.0,
                "start": utc(5).isoformat(), "end": utc(14).isoformat()}]
    orders = shift_orders(planned, good, "OF2", utc(14))
    assert [o["order_ref"] for o in orders] == ["OF1", "OF2"]
    assert [o["status"] for o in orders] == ["finished", "running"]
    first = orders[0]
    assert first["ended_at"] == utc(9).isoformat() and first["tool"] == "MO1"
    assert [(c["cavity_no"], c["product"]) for c in first["cavities"]] == [(1, "B1"), (2, "B2")]
    assert first["cavities"][1]["reject_pct"] == pytest.approx(5.0)   # last declaration 190 good / 10 scrap


def test_order_remaining_matches_cyclades_formula_with_scrap_allowance():
    from app.services.hourly_good import order_remaining
    progress = {"products": [{"qty_planned": 912, "qty_good": 544}, {"qty_planned": 912, "qty_good": 544}],
                "planned_duration_raw": 53953.9, "worked_fab_raw": 0, "worked_stops_raw": 0}
    remaining = order_remaining(progress, 58.0)
    assert remaining["pieces_left"] == 368
    assert remaining["hours"] == pytest.approx(368 / 912 * 53953.9 / 3600)       # ~6.05 h, Cyclades shows 6.0
    assert remaining["hours_without_allowance"] == pytest.approx(368 * 58 / 3600)
    assert order_remaining(None, 50) is None
    assert order_remaining({"products": [{"qty_planned": 100, "qty_good": 40}]}, 60)["hours"] == pytest.approx(60 * 60 / 3600)


def test_order_end_event_is_not_added_when_the_balance_row_just_ends_with_the_shift():
    from app.services.hourly_good import add_order_bounds
    good = {"baseline": [], "declarations": [declaration(6, 10, 940, "A", "OLD")]}
    progress = {"OLD": {"launched_at": utc(0).isoformat(), "products": [{"product": "A", "qty_good": 5000}]}}
    planned = [{"order_ref": "OLD", "start": utc(0).isoformat(), "end": utc(14).isoformat()}]
    bounded = add_order_bounds(good, progress, planned, None, utc(14))
    assert all(e["qty_good"] != 5000 for e in bounded["baseline"])
