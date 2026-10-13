"""Read shift observations through Euromap63; never infer good pieces from cycles."""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.services.cache import SnapshotCache
from app.services.hourly_good import add_order_bounds, estimate_good, order_remaining, planned_cycle_for, shift_orders, shift_totals
from app.services.shifts import hourly_intervals, selected_shift, utc_seconds

log = logging.getLogger("dashboard.euromap_shift")
cache = SnapshotCache(15)


def _time(value):
    try:
        result = datetime.fromisoformat(value)
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except (TypeError, ValueError):
        return None


# The downtimes endpoint only returns a stop whose bounding cycles both fall inside the
# requested window, so stops crossing a shift boundary vanish unless the window is padded.
DOWNTIME_PAD = timedelta(hours=12)
GOOD_PAD = timedelta(hours=3)


_client_lock = threading.Lock()
_clients: dict[str, httpx.Client] = {}
_catalog: dict[str, tuple[float, list]] = {}
CATALOG_TTL = 300
FINISHED_TTL = 6 * 3600
SETTLING_TTL = 60
_pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix="euromap")


def _shared_client(base: str) -> httpx.Client:
    # One pooled client keeps connections alive between shift switches
    with _client_lock:
        client = _clients.get(base)
        if client is None:
            client = _clients[base] = httpx.Client(base_url=base, timeout=15)
        return client


def _machine_catalog(client: httpx.Client, base: str) -> list:
    with _client_lock:
        cached = _catalog.get(base)
        if cached and time.monotonic() - cached[0] < CATALOG_TTL:
            return cached[1]
    response = client.get("/api/machines")
    response.raise_for_status()
    catalog = response.json()
    if not isinstance(catalog, list):
        raise ValueError("Invalid Euromap63 machine catalog")
    with _client_lock:
        _catalog[base] = (time.monotonic(), catalog)
    return catalog


def _json(client: httpx.Client, path: str, params: dict, check, label: str, code: str):
    """GET + validate; None (logged) when the endpoint is unavailable or malformed."""
    try:
        response = client.get(path, params=params)
        response.raise_for_status()
        value = response.json()
        if not check(value):
            raise ValueError(f"Invalid Euromap63 {label} response")
        return value
    except (httpx.HTTPError, ValueError):
        log.exception("Euromap63 %s unavailable machine=%s", label, code)
        return None


def _is_dict_with(key: str):
    return lambda value: isinstance(value, dict) and isinstance(value.get(key), list)


def _fetch(machine_id: str, start: datetime, end: datetime, include_current_status: bool):
    base = settings.euromap63_api_url.rstrip("/")
    if not base:
        raise ValueError("EUROMAP63_API_URL is required")
    client = _shared_client(base)
    catalog = _machine_catalog(client, base)
    machine = next((row for row in catalog if isinstance(row, dict)
                    and (row.get("cyclades_mac_refmac") or row.get("machine_code")) == machine_id), None)
    if machine is None or not machine.get("machine_code"):
        raise ValueError(f"Machine {machine_id} is not in Euromap63")
    code = str(machine["machine_code"])
    params = {"machine": code, "since": start.isoformat(), "until": end.isoformat()}
    now = datetime.now(timezone.utc)

    def call(path, query, check, label):
        return _pool.submit(_json, client, path, query, check, label, code)

    # The endpoints are independent: run them concurrently instead of one after another
    f_downtime = call("/api/downtimes", {**params, "since": (start - DOWNTIME_PAD).isoformat(),
                                         "until": min(end + DOWNTIME_PAD, now).isoformat()},
                      _is_dict_with("segments"), "downtimes")
    f_cycles = call("/api/cycles", params, lambda v: isinstance(v, list), "cycles")
    f_status = (call("/api/machines/status", {}, lambda v: isinstance(v, list), "current status")
                if include_current_status else None)
    f_scrap = call("/api/scrap-declarations", params, _is_dict_with("declarations"), "scrap declarations")
    f_cavities = call("/api/machines/cavity-scrap", {"machine": code}, _is_dict_with("cavities"), "cavity scrap")
    f_shift_cavities = call("/api/machines/cavity-scrap/shift", params, _is_dict_with("products"),
                            "shift cavity scrap")
    f_good = call("/api/machines/good-declarations",
                  # Declarations after the window close the last interpolation segments of its final hours
                  {"machine": code, "since": start.isoformat(), "until": min(end + GOOD_PAD, now).isoformat()},
                  _is_dict_with("declarations"), "good declarations")
    f_planned = call("/api/machines/planned-cycles", params, _is_dict_with("orders"), "planned cycles")

    downtime = f_downtime.result()
    cycles = f_cycles.result()
    if isinstance(cycles, list) and len(cycles) >= 20000:
        log.error("Euromap63 cycle response reached its row limit machine=%s", code)
        cycles = None
    derived = None
    f_derived = (call("/api/cycles/cyclades-derived", params, lambda v: isinstance(v, list), "counter history")
                 if not cycles else None)
    current_status = None
    if f_status is not None:
        rows = f_status.result()
        current_status = next((row for row in rows or [] if isinstance(row, dict)
                               and row.get("machine_code") == code), None)
    scrap = f_scrap.result()
    cavities = f_cavities.result() if scrap is not None else None
    if cavities is not None:
        shift_cavities = f_shift_cavities.result()
        if shift_cavities is not None:
            cavities["shift_products"] = shift_cavities["products"]
        declared = f_good.result()
        if declared is not None:
            cavities["good_declarations"] = declared
    if f_derived is not None:
        derived = f_derived.result()
    if downtime is None and cycles is None and derived is None and current_status is None:
        raise ValueError(f"No Euromap63 shift data available for {code}")
    planned = f_planned.result()
    planned_cycles = planned["orders"] if planned is not None else None
    # Progress (launch time, planned quantity, final counts) of every order seen in the shift
    wanted = []
    if isinstance(current_status, dict) and current_status.get("order_ref"):
        wanted.append(current_status["order_ref"])
    for source in ((cavities or {}).get("good_declarations") or {}).get("declarations", []), planned_cycles or []:
        for item in source:
            ref = item.get("order_ref") if isinstance(item, dict) else None
            if ref and ref not in wanted:
                wanted.append(ref)
    futures = {ref: call("/api/orders/progress", {"order_ref": ref}, lambda v: True, f"order progress {ref}")
               for ref in wanted[:5]}
    progress = {ref: future.result() for ref, future in futures.items()}
    progress = {ref: value for ref, value in progress.items() if value is not None}
    return code, downtime, cycles, derived, current_status, scrap, cavities, planned_cycles, progress


def build_euromap_shift(display, machine, shifts, now: datetime,
                        display_settings: dict, requested_start: datetime | None = None):
    selected = selected_shift(shifts, now, settings.site_timezone, requested_start)
    if selected is None:
        return {"display": {"id": display.id, "name": display.name, "theme": display.theme},
                "machine": {"id": machine.id, "name": machine.name}, "status": "outside_shift",
                "server_time": now.isoformat(), "refresh_seconds": display_settings["refresh_seconds"],
                "data_source": "euromap63"}
    (shift, start, end), previous, following = selected
    now_utc = now.astimezone(timezone.utc)
    current = start.astimezone(timezone.utc) <= now_utc < end.astimezone(timezone.utc)
    observed_end = min(end.astimezone(timezone.utc), now_utc)
    key = (machine.mes_id, start.isoformat(), observed_end.isoformat() if not current else "current")
    # Past shifts also need the machine's current order and planned cycle: the hourly overview
    # derives production metrics from it for hours that belong to that same order.
    # A finished shift no longer changes (apart from declarations still arriving shortly after it ended)
    ttl = None
    if not current:
        ttl = FINISHED_TTL if now_utc - end.astimezone(timezone.utc) > GOOD_PAD else SETTLING_TTL
    (code, downtime, cycles, derived, current_status, scrap, cavity_data, *extra), stale = cache.get(
        key, lambda: _fetch(machine.mes_id, start, observed_end, True), ttl)

    events = []
    for row in downtime.get("segments", []) if downtime else []:
        if not isinstance(row, dict):
            continue
        raw_start, raw_end = _time(row.get("start")), _time(row.get("end"))
        if raw_start is None or raw_end is None:
            continue
        begin = max(start.astimezone(timezone.utc), raw_start)
        finish = min(observed_end, raw_end)
        if finish <= begin:
            continue
        events.append({"start": begin.isoformat(), "end": finish.isoformat(),
                       "seconds": utc_seconds(begin, finish),
                       "reason": str(row.get("reason") or "Unclassified stop"),
                       **({"comment": row["comment"]} if isinstance(row.get("comment"), str) else {})})
    events.sort(key=lambda item: item["start"])

    cavity_rows, cavity_by_product, cavity_order = [], {}, None
    shift_total = None
    if cavity_data is not None:
        cavity_order = cavity_data.get("order_ref")
        shift_products = {row["product"]: row for row in cavity_data.get("shift_products", [])
                          if isinstance(row, dict) and row.get("product")}
        # Sum over every product of the shift, not only the cavities of the machine's current order
        made = sum(row.get("qty_made") or 0 for row in shift_products.values())
        reject = sum(row.get("qty_reject") or 0 for row in shift_products.values())
        if made > 0:
            shift_total = {"made": made, "reject": reject, "reject_pct": round(reject / made * 100, 2)}
        cavity_source = cavity_data["cavities"]
        # The machine's current order is not the order of an earlier shift: show the cavities of the order
        # that produced most in this shift, taken from its (live or archived) LIGOF rows.
        made_by_order: dict = {}
        for row in shift_products.values():
            made_by_order[row.get("order_ref")] = made_by_order.get(row.get("order_ref"), 0) + (row.get("qty_made") or 0)
        shift_order = max(made_by_order, key=made_by_order.get) if made_by_order else None
        progress_by_order = extra[1] if len(extra) > 1 and isinstance(extra[1], dict) else {}
        archived = (progress_by_order.get(shift_order) or {}).get("products") if shift_order else None
        if shift_order and shift_order != cavity_order and not made_by_order.get(cavity_order) and archived:
            cavity_order = shift_order
            cavity_source = []
            for item in archived:
                good_qty, reject = item.get("qty_good"), item.get("qty_reject")
                total = (good_qty or 0) + (reject or 0)
                cavity_source.append({"cavity_no": item.get("cavity_no"), "product": item.get("product"),
                                      "label": item.get("label"), "qty_good": good_qty, "qty_reject": reject,
                                      "reject_pct": round((reject or 0) / total * 100, 2) if total > 0 else None,
                                      "target_pct": item.get("target_pct")})
        for row in cavity_source:
            number = row.get("cavity_no") if isinstance(row, dict) else None
            if isinstance(number, bool) or not isinstance(number, int) or not row.get("product"):
                continue
            cavity_by_product[row["product"]] = number
            shift_row = shift_products.get(row["product"], {})
            cavity_rows.append({"cavity_no": number, "product": row["product"], "label": row.get("label"),
                                "qty_good": row.get("qty_good"), "qty_reject": row.get("qty_reject"),
                                "reject_pct": row.get("reject_pct"), "target_pct": row.get("target_pct"),
                                "shift_made": shift_row.get("qty_made"), "shift_reject": shift_row.get("qty_reject"),
                                "shift_reject_pct": shift_row.get("reject_pct")})
        cavity_rows.sort(key=lambda item: item["cavity_no"])

    declarations = None
    if scrap is not None:
        declarations = []
        for row in scrap["declarations"]:
            at = _time(row.get("time")) if isinstance(row, dict) else None
            quantity = row.get("quantity") if isinstance(row, dict) else None
            if (at is None or not start.astimezone(timezone.utc) <= at < observed_end
                    or isinstance(quantity, bool) or not isinstance(quantity, (int, float)) or quantity <= 0):
                continue
            declarations.append({"time": at.isoformat(), "quantity": quantity,
                                 "reason": str(row.get("reason") or "Unspecified"),
                                 "product": row.get("product"),
                                 # Cavity numbers are only valid for the order they were read for
                                 "cavity_no": cavity_by_product.get(row.get("product"))
                                 if row.get("order_ref") in (None, cavity_order) else None,
                                 **({"comment": row["comment"]} if isinstance(row.get("comment"), str) else {})})
        declarations.sort(key=lambda item: item["time"])

    cycle_times = []
    for row in cycles if isinstance(cycles, list) else []:
        at = _time(row.get("time")) if isinstance(row, dict) else None
        if at is not None and start.astimezone(timezone.utc) <= at < observed_end:
            cycle_times.append(at)
    cycle_times.sort()
    counter_intervals = []
    if not cycle_times:
        for row in derived if isinstance(derived, list) else []:
            if not isinstance(row, dict):
                continue
            begin, finish = _time(row.get("window_start")), _time(row.get("time"))
            delta = row.get("delta_count")
            if (begin is None or finish is None or begin < start.astimezone(timezone.utc)
                    or finish > observed_end or finish <= begin or isinstance(delta, bool)
                    or not isinstance(delta, (int, float)) or delta < 0 or not float(delta).is_integer()):
                continue
            counter_intervals.append({"start": begin.isoformat(), "end": finish.isoformat(),
                                      "count": int(delta)})
    cycle_source = "recorded" if cycle_times else "counter" if counter_intervals else None
    stop_source = downtime.get("source") if downtime else None
    has_stop_coverage = bool(events) or (stop_source == "cycles" and len(cycle_times) >= 2)

    hours = []
    good_hours = []
    for begin, finish in hourly_intervals(start, end):
        begin_utc = begin.astimezone(timezone.utc)
        finish_utc = min(finish.astimezone(timezone.utc), observed_end)
        if finish_utc <= begin_utc:
            continue
        hour_counter_intervals = [item for item in counter_intervals
                                  if begin_utc <= _time(item["start"]) < finish_utc]
        hour_cycles = (sum(begin_utc <= at < finish_utc for at in cycle_times) if cycle_times
                       else sum(item["count"] for item in hour_counter_intervals))
        stop_seconds = sum(utc_seconds(max(begin_utc, _time(item["start"])),
                                       min(finish_utc, _time(item["end"]))) for item in events)
        good_hours.append((begin_utc, finish_utc))
        hours.append({"start": begin.isoformat(), "end": finish.isoformat(),
                      "elapsed_seconds": utc_seconds(begin_utc, finish_utc),
                      "cycle_count": hour_cycles if cycle_times or hour_counter_intervals else None,
                      "stop_seconds": stop_seconds if has_stop_coverage else None,
                      "stop_count": sum(_time(item["start"]) < finish_utc and _time(item["end"]) > begin_utc
                                        for item in events) if has_stop_coverage else None})

    planned_cycles = extra[0] if extra else None
    order_progress = extra[1] if len(extra) > 1 else None
    current_order = (current_status or {}).get("order_ref")
    good_all = (cavity_data or {}).get("good_declarations")
    # Totals and the order list describe the shift itself, only the interpolation may look past its end
    good_window = ({**good_all, "declarations": [item for item in good_all["declarations"]
                                                 if _time(item.get("time")) is not None and _time(item["time"]) < observed_end]}
                   if good_all else None)
    bounded = add_order_bounds(good_all, order_progress, planned_cycles,
                               current_order, end.astimezone(timezone.utc))
    estimates = estimate_good(good_hours, bounded)
    for hour, estimate, (begin_utc, finish_utc) in zip(hours, estimates, good_hours):
        hour["good_estimate"] = estimate["good"]
        hour["good_orders"] = estimate["orders"]
        hour["good_products"] = estimate["products"]
        # One entry per order that ran in the hour, each with its own planned cycle and time range
        hour["good_parts"] = [{**part, "planned_cycle_seconds": planned_cycle_for(part["order"], begin_utc, finish_utc, planned_cycles)}
                              for part in estimate.get("parts", [])]
        hour["planned_cycle_seconds"] = (hour["good_parts"][0]["planned_cycle_seconds"] if len(hour["good_parts"]) == 1 else None)
    planned_cycle = (current_status or {}).get("cycle_time_planned_s")

    bins = []
    if cycle_times:
        bin_start = start.astimezone(timezone.utc)
        bin_size = timedelta(minutes=10)
        while bin_start < observed_end:
            bin_end = min(bin_start + bin_size, observed_end)
            bins.append({"start": bin_start.isoformat(),
                         "count": sum(bin_start <= at < bin_end for at in cycle_times)})
            bin_start = bin_end
    else:
        bins = [{"start": item["start"], "count": item["count"]} for item in counter_intervals]

    return {"status": "stale" if stale else "ok", "server_time": now.isoformat(),
            "last_successful_update": cache._entries[key][2] if stale else None,
            "refresh_seconds": max(15, display_settings["refresh_seconds"]) if current else 60,
            "data_source": "euromap63",
            "display": {"id": display.id, "name": display.name, "theme": display.theme},
            "machine": {"id": machine.id, "name": machine.name},
            "shift": {"id": shift.id, "name": shift.name, "start": start.isoformat(), "end": end.isoformat()},
            "shift_navigation": {"previous": previous.isoformat() if previous else None,
                                 "next": following.isoformat() if following else None, "is_current": current},
            "live_shift": {"machine_code": code,
                           "detail_url": (f"{settings.euromap63_frontend_url.rstrip('/')}/machine.html?code={quote(code)}"
                                          if settings.euromap63_frontend_url else None),
                           "stop_source": stop_source if stop_source in ("cycles", "histo_events") else None,
                           "downtime_available": downtime is not None,
                           "cycles_endpoint_available": cycles is not None,
                           "cycles_available": cycle_source is not None,
                           "cycle_source": cycle_source,
                           "bin_minutes": 10 if cycle_source == "recorded" else 15,
                           "current_machine": current_status,
                           "orders": shift_orders(planned_cycles, good_window,
                                                  (current_status or {}).get("order_ref"), end.astimezone(timezone.utc),
                                                  (cavity_rows if cavity_order == (current_status or {}).get("order_ref") else None) or None,
                                                  order_remaining((order_progress or {}).get(current_order), (current_status or {}).get("cycle_time_planned_s")),
                                                  order_progress),
                           "cyclades_shift": shift_totals(good_window),
                           "pieces_per_cycle": len(cavity_rows) or None,
                           "planned_cycle_seconds": planned_cycle if isinstance(planned_cycle, (int, float))
                           and not isinstance(planned_cycle, bool) and planned_cycle > 0 else None,
                           "current_order": (current_status or {}).get("order_ref"),
                           "hours": hours, "cycle_bins": bins,
                           "downtime_events": events,
                           "scrap_declarations": declarations,
                           "cavities": {"order_ref": cavity_order, "rows": cavity_rows, "shift_total": shift_total},
                           "summary": {"cycle_count": len(cycle_times) if cycle_times else
                                       sum(item["count"] for item in counter_intervals) if counter_intervals else None,
                                       "observed_stop_seconds": sum(item["seconds"] for item in events)
                                       if has_stop_coverage else None,
                                       "observed_stop_count": len(events) if has_stop_coverage else None}}}
