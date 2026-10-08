"""Hourly good-piece ESTIMATE from carton declarations (never a measured count).

Operators declare good pieces when a carton is full, so cumulative good counts per product (cavity)
only change at declaration times. Between two consecutive declarations of the same order the
increase is spread linearly over time; an hour gets the part of every segment that overlaps it.
An hour is estimated only when every product with a segment in it is covered for the whole hour,
so the running hour (after the last declaration) and order changeovers stay unavailable.
"""
from datetime import datetime, timezone

TOLERANCE_SECONDS = 1.0


def _time(value) -> datetime | None:
    try:
        result = datetime.fromisoformat(value)
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except (TypeError, ValueError):
        return None


def _segments(good: dict) -> dict[str, list[tuple[datetime, datetime, float, str]]]:
    products = {item.get("product") for item in good.get("declarations", []) if isinstance(item, dict)}
    events: dict[str, list[tuple[datetime, float, str]]] = {}
    for item in [*good.get("baseline", []), *good.get("declarations", [])]:
        if not isinstance(item, dict) or item.get("product") not in products:
            continue
        at, qty = _time(item.get("time")), item.get("qty_good")
        if at is None or isinstance(qty, bool) or not isinstance(qty, (int, float)):
            continue
        events.setdefault(item["product"], []).append((at, float(qty), str(item.get("order_ref"))))
    result = {}
    for product, rows in events.items():
        rows.sort(key=lambda row: row[0])
        result[product] = [(a[0], b[0], b[1] - a[1], a[2]) for a, b in zip(rows, rows[1:])
                           if a[2] == b[2] and b[1] >= a[1] and b[0] > a[0]]
    return result


def estimate_good(hours: list[tuple[datetime, datetime]], good: dict | None) -> list[dict]:
    """One {"good": float | None, "orders": [..]} per (begin, finish) UTC hour interval."""
    if not good:
        return [{"good": None, "orders": []} for _ in hours]
    segments = _segments(good)
    out = []
    for begin, finish in hours:
        total, orders, valid, touched = 0.0, set(), True, False
        for rows in segments.values():
            covered = 0.0
            for start, end, delta, order in rows:
                overlap = (min(end, finish) - max(start, begin)).total_seconds()
                if overlap <= 0:
                    continue
                covered += overlap
                total += delta * overlap / (end - start).total_seconds()
                orders.add(order)
            if covered > 0:
                touched = True
                if covered < (finish - begin).total_seconds() - TOLERANCE_SECONDS:
                    valid = False
        out.append({"good": total if touched and valid else None,
                    "orders": sorted(orders) if touched and valid else []})
    return out
