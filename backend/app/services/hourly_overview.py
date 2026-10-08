"""New hourly overview: existing observations plus production-loss metrics.

The base payload is produced by the same builders (and caches) as the original dashboard and
imprint endpoints, so raw cycles, stops and declared scrap stay identical. Production metrics are
only computed where verified OK pieces and an effective rate exist; otherwise they are null with
the missing inputs named. See docs/hourly-new-pdf-proposal.md.
"""
from datetime import datetime, timezone

from app.services.hourly_loss import SegmentInput, SegmentResult, aggregate, calculate_segment

LIVE_MISSING = ["Verified OK pieces per hour", "Historical ideal cycle and pieces per cycle"]


def _overlaps(start: str, end: str, begin: datetime, finish: datetime) -> bool:
    return (datetime.fromisoformat(start) < finish and datetime.fromisoformat(end) > begin)


def _inside(at: str, begin: datetime, finish: datetime) -> bool:
    return begin <= datetime.fromisoformat(at) < finish


def _composition(i: SegmentInput, r: SegmentResult) -> dict:
    rate = i.pieces_per_cycle / i.ideal_cycle_seconds
    entries = {"good": (i.good_count / rate, i.good_count), "scrap": (i.scrap_count / rate, i.scrap_count),
               "downtime": (i.downtime_seconds, r.downtime_equiv),
               "microstop": (i.microstop_seconds, r.microstop_equiv),
               "speed_loss": (r.speed_loss_pieces / rate, r.speed_loss_pieces)}
    result = {key: {"seconds": s, "pieces": p} for key, (s, p) in entries.items()}
    result["break"] = {"seconds": i.excluded_seconds, "pieces": None}
    return result


def _live_inputs(live: dict, hour: dict, raw: dict, elapsed: float) -> SegmentInput | None:
    """Segment input for a live (Euromap63) hour whose OK pieces could be estimated, else None."""
    good, scrap, stops = hour.get("good_estimate"), raw["declared_scrap"], raw["stop_seconds"]
    cycle, per_cycle, order = live.get("planned_cycle_seconds"), live.get("pieces_per_cycle"), live.get("current_order")
    # The planned cycle belongs to the current order only; hours of other orders stay unavailable.
    if (good is None or scrap is None or stops is None or not cycle or not per_cycle
            or not order or set(hour.get("good_orders") or []) != {order}):
        return None
    # Interpolation noise can push an hour slightly above the ideal rate; that is not an inconsistency.
    return SegmentInput(elapsed, good, scrap, stops, 0, cycle, per_cycle, 0, gain_verified=True)


def _quality(status: str, missing: list[str], warnings: list[str]) -> dict:
    return {"status": status, "missing_inputs": missing, "warnings": warnings}


def _metrics(r: SegmentResult, kind: str) -> dict:
    return {"capacity": {"ideal_capacity": r.ideal_capacity,
                         "without_scrap_or_stops": r.without_scrap_or_stops,
                         "recoverable_output": r.recoverable_output},
            "efficiency": {"ratio": r.efficiency, "kind": kind, "denominator": r.ideal_capacity},
            "cycle": {"actual_seconds": r.cycle_actual_seconds, "ideal_seconds": r.ideal_cycle_seconds,
                      "delta_seconds": r.cycle_delta_seconds, "basis": "calculated"}}


def compute_overview(base: dict) -> dict:
    """Add `overview` (per hour + total) to a dashboard/imprint/euromap payload."""
    live = base.get("live_shift")
    efficiency_kind = "oee" if base.get("data_source") == "mock" else "declared_output_ratio"
    hours_in = live["hours"] if live else base.get("hours", [])
    stops = (live["downtime_events"] if live else base.get("downtime_events")) or []
    declared = live["scrap_declarations"] if live else None
    reports = base.get("scrap_reports") or []
    rows, segments, composition_total = [], [], {}
    complete = True
    for hour in hours_in:
        begin, finish = datetime.fromisoformat(hour["start"]), datetime.fromisoformat(hour["end"])
        elapsed = hour["elapsed_seconds"]
        if live:
            declared_scrap = (None if declared is None else
                              sum(d["quantity"] for d in declared if _inside(d["time"], begin, finish)))
            raw = {"recorded_count": hour["cycle_count"], "stop_count": hour["stop_count"],
                   "stop_seconds": hour["stop_seconds"], "declared_scrap": declared_scrap}
        else:
            raw = {"recorded_count": None, "stop_seconds": hour["downtime_seconds"],
                   "stop_count": sum(_overlaps(e["start"], e["end"], begin, finish)
                                     and e.get("category") != "micro_stop" for e in stops),
                   "declared_scrap": sum(r["count"] for r in reports if _inside(r["at"], begin, finish))}
        row = {"start": hour["start"], "end": hour["end"], "elapsed_seconds": elapsed,
               "duration_seconds": hour.get("duration_seconds") or (finish - begin).total_seconds(),
               "raw_observations": raw, "production": None, "composition": None,
               "capacity": None, "efficiency": None, "cycle": None}
        estimated = live is not None and elapsed > 0 and _live_inputs(live, hour, raw, elapsed)
        if elapsed <= 0 or (live and not estimated):
            row["quality"] = _quality("insufficient_data", [] if elapsed <= 0 else LIVE_MISSING, [])
            complete = complete and elapsed <= 0 and not live
            rows.append(row)
            continue
        if estimated:
            inputs = estimated
            good_count, scrap_count, basis = inputs.good_count, inputs.scrap_count, "estimated"
            warnings = ["OK pieces estimated by interpolating carton declarations"]
        else:
            inputs = SegmentInput(elapsed, hour["good_count"], hour["scrap_count"], hour["downtime_seconds"],
                                  hour["microstop_seconds"], hour.get("ideal_cycle_seconds"),
                                  hour.get("pieces_per_cycle"), hour.get("excluded_break_seconds") or 0)
            good_count, scrap_count, basis = hour["good_count"], hour["scrap_count"], "recorded"
            warnings = list(hour.get("warnings") or [])
        result = calculate_segment(inputs)
        row["production"] = {"good_count": good_count, "scrap_count": scrap_count, "count_basis": basis}
        if result.status == "insufficient_data":
            row["quality"] = _quality(result.status, ["Ideal cycle and pieces per cycle"], warnings)
            complete = False
        else:
            row.update(_metrics(result, efficiency_kind))
            row["composition"] = _composition(inputs, result)
            row["quality"] = _quality("provisional" if estimated and result.status == "verified" else result.status,
                                      [], warnings)
            segments.append(result)
            for key, value in row["composition"].items():
                old = composition_total.setdefault(key, {"seconds": 0.0, "pieces": 0.0 if value["pieces"] is not None else None})
                old["seconds"] += value["seconds"]
                if value["pieces"] is not None:
                    old["pieces"] += value["pieces"]
        rows.append(row)

    elapsed_rows = [r for r in rows if r["elapsed_seconds"] > 0]
    estimated_total = bool(live) and bool(segments)
    total = {"raw_observations": _total_raw(base, live), "production": None, "composition": None,
             "capacity": None, "efficiency": None, "cycle": None,
             "quality": _quality("insufficient_data", [] if not live else LIVE_MISSING, [])}
    if elapsed_rows and (complete and len(segments) == len(elapsed_rows) or estimated_total):
        combined = aggregate(segments)
        total.update(_metrics(combined, efficiency_kind))
        total["production"] = {"good_count": combined.good_count, "scrap_count": combined.scrap_count,
                               "count_basis": "estimated" if estimated_total else "recorded"}
        total["composition"] = composition_total
        warnings = sorted({w for r in rows for w in r["quality"]["warnings"]})
        if estimated_total:
            total["estimate"] = {"hours_covered": len(segments), "hours_total": len(elapsed_rows)}
        total["quality"] = _quality("provisional" if estimated_total and combined.status == "verified" else combined.status,
                                    [], warnings)
    elif elapsed_rows and not live:
        total["quality"]["missing_inputs"] = ["Ideal cycle and pieces per cycle for every hour"]
    return {**base, "overview": {"hours": rows, "total": total}}


def _total_raw(base: dict, live: dict | None) -> dict:
    if live:
        summary = live["summary"]
        declared = live["scrap_declarations"]
        return {"recorded_count": summary["cycle_count"], "stop_count": summary["observed_stop_count"],
                "stop_seconds": summary["observed_stop_seconds"],
                "declared_scrap": None if declared is None else sum(d["quantity"] for d in declared)}
    summary = base.get("summary") or {}
    return {"recorded_count": None, "stop_count": len([e for e in base.get("downtime_events") or []
                                                      if e.get("category") != "micro_stop"]),
            "stop_seconds": summary.get("downtime_seconds"),
            "declared_scrap": summary.get("scrap_count")}


def build_hourly_overview(builder, *args, **kwargs) -> dict:
    base = builder(*args, **kwargs)
    return base if base.get("status") == "outside_shift" else compute_overview(base)
