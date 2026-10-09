"""Hourly good-piece ESTIMATE from carton declarations (never a measured count).

Operators declare good pieces when a carton is full, so cumulative good counts per product (cavity)
only change at declaration times. Between two consecutive declarations of the same order the
increase is spread linearly over time; an hour gets the part of every segment that overlaps it.
An hour is estimated only when every product with a segment in it is covered for the whole hour,
so the running hour (after the last declaration) and order changeovers stay unavailable.
"""
from datetime import datetime, timedelta, timezone

TOLERANCE_SECONDS = 1.0


def _time(value) -> datetime | None:
    try:
        result = datetime.fromisoformat(value)
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except (TypeError, ValueError):
        return None


def _segments(good: dict) -> list[tuple[str, str, datetime, datetime, float]]:
    """(product, order, start, end, increase) between consecutive events of the same product and order."""
    products = {item.get("product") for item in good.get("declarations", []) if isinstance(item, dict)}
    events: dict[tuple[str, str], list[tuple[datetime, float]]] = {}
    for item in [*good.get("baseline", []), *good.get("declarations", [])]:
        if not isinstance(item, dict) or item.get("product") not in products:
            continue
        at, qty = _time(item.get("time")), item.get("qty_good")
        if at is None or isinstance(qty, bool) or not isinstance(qty, (int, float)):
            continue
        events.setdefault((item["product"], str(item.get("order_ref"))), []).append((at, float(qty)))
    result = []
    for (product, order), rows in events.items():
        rows.sort(key=lambda row: row[0])
        result += [(product, order, a[0], b[0], b[1] - a[1]) for a, b in zip(rows, rows[1:])
                   if b[1] >= a[1] and b[0] > a[0]]
    return result


def add_order_bounds(good: dict | None, progress: dict | None, planned: list | None, running_order: str | None,
                     window_end: datetime) -> dict | None:
    """Add the start (0 pieces) and the end (final pieces) of orders so a changeover hour is covered.

    Counters of a new order start at 0 when it is launched, and a finished order ends with the final
    LIGOF count at the end of its last shift balance row. Both are approximations (production does not
    start the instant an order is launched), so hours using them stay estimates.
    """
    if not good or not progress:
        return good
    declarations = [i for i in good.get("declarations", []) if isinstance(i, dict) and _time(i.get("time"))]
    baseline = list(good.get("baseline", []))
    extra = []
    ends = {}
    for row in planned or []:
        end = _time(row.get("end")) if isinstance(row, dict) else None
        if end and row.get("order_ref"):
            ends[row["order_ref"]] = max(ends.get(row["order_ref"], end), end)
    for (order, product) in {(str(i.get("order_ref")), i.get("product")) for i in declarations}:
        info = progress.get(order) or {}
        mine = [i for i in declarations if str(i.get("order_ref")) == order and i.get("product") == product]
        first = min(_time(i["time"]) for i in mine)
        launched = _time(info.get("launched_at"))
        if launched and launched < first and not any(
                i.get("product") == product and str(i.get("order_ref")) == order for i in baseline):
            extra.append({"time": launched.isoformat(), "product": product, "order_ref": order, "qty_good": 0.0})
        end = ends.get(order)
        final = next((p.get("qty_good") for p in info.get("products") or [] if p.get("product") == product), None)
        last = max(mine, key=lambda i: _time(i["time"]))
        # A shift balance row ends with the shift unless the order itself ended earlier
        if (order != running_order and end and end < window_end - timedelta(minutes=1) and isinstance(final, (int, float))
                and not isinstance(final, bool) and final >= float(last.get("qty_good") or 0) and end > _time(last["time"])):
            extra.append({"time": end.isoformat(), "product": product, "order_ref": order, "qty_good": float(final)})
    # Only meant for estimate_good: extra events are added next to the baseline, declarations stay untouched
    return {**good, "baseline": baseline + extra}


def estimate_good(hours: list[tuple[datetime, datetime]], good: dict | None) -> list[dict]:
    """Per (begin, finish) UTC hour: estimated OK pieces, the orders involved and a part per order.

    Each order that ran in the hour covers its own time range (every product of it must be covered over
    that range) and the ranges together must cover the hour, so a changeover between two orders is fine
    but the running hour after the last declaration is not.
    """
    empty = {"good": None, "orders": [], "products": 0, "parts": []}
    if not good:
        return [dict(empty) for _ in hours]
    segments = _segments(good)
    out = []
    for begin, finish in hours:
        per_order: dict[str, dict] = {}
        for product, order, start, end, delta in segments:
            lo, hi = max(start, begin), min(end, finish)
            overlap = (hi - lo).total_seconds()
            if overlap <= 0:
                continue
            entry = per_order.setdefault(order, {"products": {}, "start": lo, "end": hi, "good": 0.0})
            entry["products"][product] = entry["products"].get(product, 0.0) + overlap
            entry["good"] += delta * overlap / (end - start).total_seconds()
            entry["start"], entry["end"] = min(entry["start"], lo), max(entry["end"], hi)
        valid = bool(per_order)
        for entry in per_order.values():
            length = (entry["end"] - entry["start"]).total_seconds()
            if any(covered < length - TOLERANCE_SECONDS for covered in entry["products"].values()):
                valid = False
        cursor = begin
        for entry in sorted(per_order.values(), key=lambda e: e["start"]):
            if (entry["start"] - cursor).total_seconds() > TOLERANCE_SECONDS:
                valid = False
            cursor = max(cursor, entry["end"])
        if (finish - cursor).total_seconds() > TOLERANCE_SECONDS:
            valid = False
        if not valid:
            out.append(dict(empty))
            continue
        parts = [{"order": order, "good": entry["good"], "products": len(entry["products"]),
                  "start": entry["start"].isoformat(), "end": entry["end"].isoformat()}
                 for order, entry in sorted(per_order.items(), key=lambda item: item[1]["start"])]
        out.append({"good": sum(p["good"] for p in parts), "orders": [p["order"] for p in parts],
                    "products": max(p["products"] for p in parts), "parts": parts})
    return out


def shift_totals(good: dict | None) -> dict | None:
    """Cyclades' own shift figures: last declaration of each product minus its baseline.

    Cyclades books pieces made (cycle based) but not yet declared as OK or scrap as delta scrap,
    so made = ok + scrap + delta_scrap; delta_scrap shrinks again when a carton is declared.
    """
    if not good or not good.get("declarations"):
        return None
    last: dict = {}
    for item in sorted((i for i in good["declarations"] if isinstance(i, dict) and _time(i.get("time"))),
                       key=lambda i: _time(i["time"])):
        last[item.get("product")] = item
    baselines = {i.get("product"): i for i in good.get("baseline", []) if isinstance(i, dict)}
    keys = (("made", "qty_made"), ("ok", "qty_good"), ("scrap", "qty_reject"), ("delta_scrap", "qty_delta_reject"))
    totals = {name: 0.0 for name, _ in keys}
    for product, item in last.items():
        base = baselines.get(product)
        if base and base.get("order_ref") != item.get("order_ref"):
            base = None
        for name, column in keys:
            value = float(item.get(column) or 0)
            start = float(base.get(column) or 0) if base else 0.0
            # Delta scrap is a state that shrinks when cartons are declared, not a cumulative counter
            totals[name] += value - start if value >= start or name == "delta_scrap" else value
    return {**totals, "as_of": max(i["time"] for i in last.values()), "products": len(last)}


def planned_cycle_for(order: str, begin: datetime, finish: datetime, rows: list | None) -> float | None:
    """Planned cycle (seconds) of an order: the shift row overlapping the hour, else the latest one."""
    candidates = []
    for row in rows or []:
        cycle = row.get("planned_cycle_s") if isinstance(row, dict) else None
        start, end = _time(row.get("start")), _time(row.get("end"))
        if row.get("order_ref") != order or isinstance(cycle, bool) or not isinstance(cycle, (int, float)) or cycle <= 0 or start is None or end is None:
            continue
        candidates.append((start, end, float(cycle)))
    if not candidates:
        return None
    overlapping = [c for c in candidates if min(c[1], finish) > max(c[0], begin)]
    return max(overlapping or candidates, key=lambda c: c[0])[2]


def order_remaining(progress: dict | None, cycle_s: float | None) -> dict | None:
    """Expected time to finish a running order, as Cyclades shows it.

    Share of the order still missing on the slowest product (planned minus good, the product with
    the fewest good pieces limits the order) times the planned order duration OF_DUREOFPREV, which is
    the planned quantity x planned cycle x (1 + scrap allowance). Verified against Cyclades on two presses
    (12.68 h and 6.0 h). Without the planned duration: missing pieces x planned cycle, no allowance.
    """
    if not isinstance(progress, dict):
        return None
    ratios, left = [], []
    for product in progress.get("products") or []:
        planned, good = product.get("qty_planned"), product.get("qty_good")
        if isinstance(planned, (int, float)) and isinstance(good, (int, float)) and planned > 0:
            missing = max(0.0, planned - good)
            left.append(missing)
            ratios.append(missing / planned)
    if not left:
        return None
    plain = max(left) * cycle_s / 3600 if cycle_s and cycle_s > 0 else None
    duration = progress.get("planned_duration_raw")
    hours = max(ratios) * duration / 3600 if isinstance(duration, (int, float)) and duration > 0 else plain
    return {"hours": hours, "hours_without_allowance": plain, "pieces_left": max(left)}


def shift_orders(planned: list | None, good: dict | None, current_order: str | None, shift_end: datetime,
                 current_cavities: list | None = None, remaining: dict | None = None,
                 progress: dict | None = None) -> list[dict]:
    """Orders that ran in the shift, oldest first, each with scrap per cavity since the order start.

    Per-product counters of BILAN_SAISIE_EQUIPE are cumulative per order, so the last declaration of a
    product inside the shift is its order total up to the end of the shift. Cyclades gives the cavity
    number only for the running order; for finished orders it is the rank of the product reference,
    which matches the Cyclades numbering on every press checked.

    A finished order leaves the live Cyclades tables, so `progress` (live or archive LIGOF rows,
    filled by the Euromap63 API) still provides the cavity number, product label, target scrap and
    end time; the counts stay those of the last declaration inside the shift.
    """
    last: dict[tuple[str, str], dict] = {}
    first_seen: dict[str, datetime] = {}
    for item in sorted((i for i in (good or {}).get("declarations", []) if isinstance(i, dict) and _time(i.get("time"))),
                       key=lambda i: _time(i["time"])):
        last[(str(item.get("order_ref")), item.get("product"))] = item
        first_seen.setdefault(str(item.get("order_ref")), _time(item["time"]))
    info: dict[str, dict] = {}
    for row in planned or []:
        order, start, end = row.get("order_ref"), _time(row.get("start")), _time(row.get("end"))
        if not order or start is None or end is None:
            continue
        entry = info.setdefault(order, {"end": end, "start": start})
        entry["end"], entry["start"] = max(entry["end"], end), min(entry["start"], start)
        entry.update(tool=row.get("tool"), tool_label=row.get("tool_label"), planned_cycle_s=row.get("planned_cycle_s"))
    orders = []
    for order in sorted(set(first_seen) | set(info), key=lambda o: first_seen.get(o) or info[o]["start"]):
        running = order == current_order
        products = sorted(product for (ref, product) in last if ref == order and product)
        if running and current_cavities:
            rows = [{"cavity_no": c["cavity_no"], "product": c["product"], "label": c.get("label"),
                     "qty_good": c.get("qty_good"), "qty_reject": c.get("qty_reject"),
                     "reject_pct": c.get("reject_pct"), "target_pct": c.get("target_pct")} for c in current_cavities]
        else:
            rows = []
            known = {p.get("product"): p for p in (progress or {}).get(order, {}).get("products") or []}
            for number, product in enumerate(products, start=1):
                item = last[(order, product)]
                good_qty, reject = float(item.get("qty_good") or 0), float(item.get("qty_reject") or 0)
                meta = known.get(product) or {}
                rows.append({"cavity_no": meta.get("cavity_no") or number, "product": product, "label": meta.get("label"),
                             "qty_good": good_qty, "qty_reject": reject, "target_pct": meta.get("target_pct"),
                             "reject_pct": reject / (good_qty + reject) * 100 if good_qty + reject > 0 else None})
        if not running and not rows and not info.get(order, {}).get("tool"):
            continue  # shift balance rows without declarations or tool are not real production
        end = info.get(order, {}).get("end")
        finished_at = _time((progress or {}).get(order, {}).get("ended_at"))
        if finished_at and not running:
            end = finished_at
        orders.append({"order_ref": order, "status": "running" if running else "finished",
                       "tool": info.get(order, {}).get("tool"), "tool_label": info.get(order, {}).get("tool_label"),
                       "planned_cycle_s": info.get(order, {}).get("planned_cycle_s"),
                       "remaining": remaining if running else None,
                       "ended_at": end.isoformat() if end and not running and end < shift_end else None,
                       "cavities": rows})
    return orders
