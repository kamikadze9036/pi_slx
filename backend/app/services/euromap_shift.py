"""Read shift observations through Euromap63; never infer good pieces from cycles."""

import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.services.cache import SnapshotCache
from app.services.shifts import hourly_intervals, selected_shift, utc_seconds

log = logging.getLogger("dashboard.euromap_shift")
cache = SnapshotCache(15)


def _time(value):
    try:
        result = datetime.fromisoformat(value)
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except (TypeError, ValueError):
        return None


def _fetch(machine_id: str, start: datetime, end: datetime):
    base = settings.euromap63_api_url.rstrip("/")
    if not base:
        raise ValueError("EUROMAP63_API_URL is required")
    with httpx.Client(base_url=base, timeout=15) as client:
        catalog_response = client.get("/api/machines")
        catalog_response.raise_for_status()
        catalog = catalog_response.json()
        if not isinstance(catalog, list):
            raise ValueError("Invalid Euromap63 machine catalog")
        machine = next((row for row in catalog if isinstance(row, dict)
                        and (row.get("cyclades_mac_refmac") or row.get("machine_code")) == machine_id), None)
        if machine is None or not machine.get("machine_code"):
            raise ValueError(f"Machine {machine_id} is not in Euromap63")
        code = str(machine["machine_code"])
        params = {"machine": code, "since": start.isoformat(), "until": end.isoformat()}
        downtime = cycles = None
        try:
            response = client.get("/api/downtimes", params=params)
            response.raise_for_status()
            downtime = response.json()
            if not isinstance(downtime, dict) or not isinstance(downtime.get("segments"), list):
                raise ValueError("Invalid Euromap63 downtime response")
        except (httpx.HTTPError, ValueError):
            log.exception("Euromap63 downtimes unavailable machine=%s", code)
            downtime = None
        try:
            response = client.get("/api/cycles", params=params)
            response.raise_for_status()
            cycles = response.json()
            if not isinstance(cycles, list):
                raise ValueError("Invalid Euromap63 cycles response")
            if len(cycles) >= 20000:
                raise ValueError("Euromap63 cycle response reached its row limit")
        except (httpx.HTTPError, ValueError):
            log.exception("Euromap63 cycles unavailable machine=%s", code)
            cycles = None
        if downtime is None and cycles is None:
            raise ValueError(f"No Euromap63 shift data available for {code}")
        return code, downtime, cycles


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
    (code, downtime, cycles), stale = cache.get(
        key, lambda: _fetch(machine.mes_id, start, observed_end))

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
                       "reason": str(row.get("reason") or "Unclassified stop")})
    events.sort(key=lambda item: item["start"])

    cycle_times = []
    for row in cycles if isinstance(cycles, list) else []:
        at = _time(row.get("time")) if isinstance(row, dict) else None
        if at is not None and start.astimezone(timezone.utc) <= at < observed_end:
            cycle_times.append(at)
    cycle_times.sort()
    stop_source = downtime.get("source") if downtime else None
    has_stop_coverage = bool(events) or (stop_source == "cycles" and len(cycle_times) >= 2)

    hours = []
    for begin, finish in hourly_intervals(start, end):
        begin_utc = begin.astimezone(timezone.utc)
        finish_utc = min(finish.astimezone(timezone.utc), observed_end)
        if finish_utc <= begin_utc:
            continue
        hour_cycles = sum(begin_utc <= at < finish_utc for at in cycle_times)
        stop_seconds = sum(utc_seconds(max(begin_utc, _time(item["start"])),
                                       min(finish_utc, _time(item["end"]))) for item in events)
        hours.append({"start": begin.isoformat(), "end": finish.isoformat(),
                      "elapsed_seconds": utc_seconds(begin_utc, finish_utc),
                      "cycle_count": hour_cycles if cycle_times else None,
                      "stop_seconds": stop_seconds if has_stop_coverage else None,
                      "stop_count": sum(_time(item["start"]) < finish_utc and _time(item["end"]) > begin_utc
                                        for item in events) if has_stop_coverage else None})

    bin_start = start.astimezone(timezone.utc)
    bin_size = timedelta(minutes=10)
    bins = []
    while bin_start < observed_end:
        bin_end = min(bin_start + bin_size, observed_end)
        bins.append({"start": bin_start.isoformat(),
                     "count": sum(bin_start <= at < bin_end for at in cycle_times)})
        bin_start = bin_end

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
                           "cycles_available": cycles is not None and bool(cycle_times),
                           "hours": hours, "cycle_bins": bins if cycle_times else [],
                           "downtime_events": events,
                           "summary": {"recorded_cycles": len(cycle_times) if cycle_times else None,
                                       "observed_stop_seconds": sum(item["seconds"] for item in events)
                                       if has_stop_coverage else None,
                                       "observed_stop_count": len(events) if has_stop_coverage else None}}}
