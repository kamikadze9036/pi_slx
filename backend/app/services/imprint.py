from datetime import datetime, timezone
from app.db.models import Display, Machine, Shift
from app.services.dashboard import build_dashboard, cache, get_provider
from app.services.shifts import active_shift, hourly_intervals, utc_seconds
from app.core.config import settings

def build_imprint(display: Display, machine: Machine, shifts: list[Shift], now: datetime, display_settings: dict | None = None):
    dashboard = build_dashboard(display, machine, shifts, now, display_settings)
    if dashboard["status"] == "outside_shift":
        return dashboard
    _, start, end = active_shift(shifts, now, settings.site_timezone)
    snapshot, _ = cache.get((machine.mes_id, start.isoformat()),
                            lambda: get_provider().fetch_shift(machine.mes_id, start, end, now))
    elapsed_end = min(end.astimezone(timezone.utc), now.astimezone(timezone.utc))
    events = []
    reasons = {}
    for event in snapshot.downtime_events:
        if event.start.tzinfo is None or event.end.tzinfo is None:
            continue
        begin = max(start.astimezone(timezone.utc), event.start.astimezone(timezone.utc))
        finish = min(elapsed_end, event.end.astimezone(timezone.utc))
        if finish <= begin:
            continue
        seconds = utc_seconds(begin, finish)
        events.append({"start": begin.isoformat(), "end": finish.isoformat(),
                       "category": event.category, "reason": event.reason, "seconds": seconds})
        label = (event.category, event.reason)
        reasons[label] = reasons.get(label, 0) + seconds
    reports = []
    scrap_reasons = {}
    for item in snapshot.scrap_reports:
        if item.at.tzinfo is None or item.count < 0:
            continue
        if item.at.astimezone(timezone.utc) > elapsed_end or item.at.astimezone(timezone.utc) < start.astimezone(timezone.utc):
            continue
        reports.append({"at": item.at.isoformat(), "count": item.count, "reason": item.reason})
        scrap_reasons[item.reason] = scrap_reasons.get(item.reason, 0) + item.count
    unclassified = dashboard["summary"]["scrap_count"] - sum(scrap_reasons.values())
    if unclassified > 0:
        scrap_reasons["Unclassified"] = unclassified
    return {
        "status": dashboard["status"], "server_time": dashboard["server_time"],
        "last_successful_update": dashboard["last_successful_update"],
        "refresh_seconds": dashboard["refresh_seconds"],
        "display": dashboard["display"], "machine": dashboard["machine"],
        "shift": dashboard["shift"], "production": dashboard["production"],
        "summary": dashboard["summary"],
        "ticks": [begin.isoformat() for begin, _ in hourly_intervals(start, end)] + [end.isoformat()],
        "hours": [{"start": hour["start"], "end": hour["end"], "good_count": hour["good_count"],
                   "scrap_count": hour["scrap_count"], "downtime_seconds": hour["downtime_seconds"],
                   "microstop_seconds": hour["microstop_seconds"], "oee": hour["oee"],
                   "target_good": hour["target_good"]} for hour in dashboard["hours"]],
        "downtime_events": sorted(events, key=lambda item: item["start"]),
        "downtime_reasons": [{"category": category, "reason": reason, "seconds": seconds}
                             for (category, reason), seconds in sorted(reasons.items(), key=lambda pair: -pair[1])],
        "scrap_reports": sorted(reports, key=lambda item: item["at"]),
        "scrap_reasons": [{"reason": reason, "count": count} for reason, count in sorted(scrap_reasons.items(), key=lambda pair: -pair[1])],
        "downtime_detail_available": snapshot.downtime_detail_available,
        "scrap_detail_available": snapshot.scrap_detail_available,
    }
