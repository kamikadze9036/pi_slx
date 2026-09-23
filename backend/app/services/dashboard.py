from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from app.core.config import settings
from app.db.models import Display, Machine, Shift
from app.mes.mock import MockMesDataProvider
from app.mes.ciclades import CicladesSqlServerProvider
from app.services.cache import SnapshotCache
from app.services.data_quality import validate_snapshot
from app.services.kpi import LossInput, calculate
from app.services.shifts import active_shift, hourly_intervals, utc_seconds

cache = SnapshotCache(5)
provider = None

def get_provider():
    global provider
    if provider is None:
        if settings.mes_provider == "mock":
            provider = MockMesDataProvider()
        elif settings.mes_provider == "ciclades":
            provider = CicladesSqlServerProvider(settings.ciclades_dsn, settings.ciclades_mapping_file)
        else:
            raise ValueError(f"Unsupported MES_PROVIDER: {settings.mes_provider}")
    return provider

def build_dashboard(display: Display, machine: Machine, shifts: list[Shift], now: datetime, display_settings: dict | None = None):
    display_settings = display_settings or {"refresh_seconds": settings.poll_seconds,
                                            "visible_kpis": [], "oee_warning_threshold": 0.7}
    selected = active_shift(shifts, now, settings.site_timezone)
    if selected is None:
        return {"display": {"id": display.id, "name": display.name, "theme": display.theme},
                "machine": {"id": machine.id, "name": machine.name}, "status": "outside_shift",
                "server_time": now.isoformat(), "refresh_seconds": display_settings["refresh_seconds"]}
    shift, shift_start, shift_end = selected
    key = (machine.mes_id, shift_start.isoformat())
    snapshot, stale = cache.get(key, lambda: get_provider().fetch_shift(machine.mes_id, shift_start, shift_end, now))
    source_warnings = validate_snapshot(snapshot, shift_start, shift_end)
    by_start = {item.start.astimezone(timezone.utc): item for item in snapshot.hours if item.start.tzinfo is not None}
    hours = []
    sum_good = sum_scrap = 0
    elapsed_total = 0.0
    planned_total = runtime_total = ideal_total = 0.0
    downtime_total = speed_total = 0.0
    missing_ideal = False
    for begin, end in hourly_intervals(shift_start, shift_end):
        duration = utc_seconds(begin, end)
        elapsed = max(0.0, min(duration, (now - begin.astimezone(timezone.utc)).total_seconds()))
        if elapsed <= 0:
            continue
        observation = by_start.get(begin.astimezone(timezone.utc))
        good = observation.good_count if observation else 0
        scrap = observation.scrap_count if observation else 0
        downtime = observation.downtime_seconds if observation else 0
        micro = observation.microstop_seconds if observation else 0
        ideal_cycle = (observation.ideal_cycle_seconds or machine.ideal_cycle_seconds) if observation else None
        result = calculate(LossInput(elapsed, good, scrap, downtime, ideal_cycle, machine.pieces_per_cycle, micro))
        hours.append({"start": begin.isoformat(), "end": end.isoformat(),
                      "duration_seconds": duration, "elapsed_seconds": elapsed,
                      "good_seconds": result.good_seconds, "speed_loss_seconds": result.speed_loss_seconds,
                      "microstop_seconds": result.microstop_seconds, "downtime_seconds": result.downtime_seconds,
                      "scrap_loss_seconds": result.scrap_loss_seconds, "unknown_seconds": result.unknown_seconds,
                      "excluded_break_seconds": result.excluded_break_seconds,
                      "good_count": good, "scrap_count": scrap,
                      "target_good": round(snapshot.target_per_hour * elapsed / 3600) if snapshot.target_per_hour is not None else None,
                      "oee": result.oee, "performance": result.performance,
                      "status": result.status, "warnings": result.warnings,
                      "current": elapsed < duration})
        sum_good += good
        sum_scrap += scrap
        elapsed_total += elapsed
        planned_total += result.planned_seconds
        runtime_total += result.planned_seconds - result.downtime_seconds
        downtime_total += result.downtime_seconds
        speed_total += result.speed_loss_seconds
        if ideal_cycle is None:
            missing_ideal = True
        else:
            ideal_total += (good + scrap) * ideal_cycle / machine.pieces_per_cycle
    availability = runtime_total / planned_total if planned_total else None
    performance = ideal_total / runtime_total if runtime_total and not missing_ideal else None
    quality = sum_good / (sum_good + sum_scrap) if sum_good + sum_scrap else None
    oee = availability * performance * quality if None not in (availability, performance, quality) else None
    warnings = sorted(set(source_warnings + [w for h in hours for w in h["warnings"]]))
    target = round(snapshot.target_per_hour * elapsed_total / 3600) if snapshot.target_per_hour is not None else None
    return {
        "status": "stale" if stale else "ok", "server_time": now.isoformat(),
        "last_successful_update": None if not stale else cache._entries[key][2],
        "refresh_seconds": display_settings["refresh_seconds"], "display_settings": display_settings,
        "display": {"id": display.id, "name": display.name, "theme": display.theme},
        "machine": {"id": machine.id, "name": machine.name},
        "shift": {"id": shift.id, "name": shift.name, "start": shift_start.isoformat(), "end": shift_end.isoformat()},
        "production": {"product": snapshot.product, "order": snapshot.order,
                       "target": target, "actual_good": sum_good, "scrap": sum_scrap,
                       "delta": sum_good - target if target is not None else None},
        "hours": hours,
        "summary": {"availability": availability, "performance": performance,
                    "quality": quality, "oee": oee, "status": "ok" if oee is not None else "insufficient_data",
                    "warnings": warnings,
                    "good_count": sum_good, "scrap_count": sum_scrap,
                    "scrap_percent": sum_scrap / (sum_good + sum_scrap) if sum_good + sum_scrap else None,
                    "downtime_seconds": downtime_total,
                    "speed_loss_seconds": speed_total}
    }
