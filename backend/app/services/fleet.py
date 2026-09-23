"""Plant overview combining per-shift KPIs with the existing Euromap63 live state."""
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from types import SimpleNamespace
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.db.models import Display, Machine, Shift
from app.mes.demo_presses import DEMO_PRESSES
from app.services.dashboard import build_dashboard, get_provider

log = logging.getLogger("dashboard.fleet")


def press_sort_key(code: str):
    match = re.match(r"^P?(\d+)-(\d+)", code)
    return (0, int(match[1]), int(match[2]), code) if match else (1, 0, 0, code)


def live_machine_rows():
    """Return live status separately from KPI data; never invent a running state."""
    if settings.euromap63_api_url:
        try:
            response = httpx.get(settings.euromap63_api_url.rstrip("/") + "/api/machines/status", timeout=4)
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list):
                raise ValueError("Expected a list of machine statuses")
            return [row for row in rows if isinstance(row, dict)], "euromap63"
        except (httpx.HTTPError, ValueError):
            log.exception("Euromap63 live status unavailable")
            return [], "unavailable"
    if settings.mes_provider == "mock":
        rows = []
        for index, (code, name) in enumerate(DEMO_PRESSES):
            state = "stoji" if index in (3, 11, 17) else "bez_zakazky" if index in (6, 14) else "bezi"
            rows.append({"machine_code": "KM-MC5-01" if code == "P2700-01" else code,
                         "cyclades_mac_refmac": code, "machine_name": name,
                         "state": state, "stop_reason": "Material feed" if state == "stoji" else None,
                         "order_ref": None if state == "bez_zakazky" else f"DEMO-{code}",
                         "cycle_time_real_s": 33.2 + index % 5, "cycle_time_planned_s": 32.0})
        return rows, "demo"
    return [], "not_configured"


def _card(machine, display, shifts, now, display_settings):
    base = {"id": machine.id, "name": machine.name, "mes_id": machine.mes_id,
            "display_id": display.id if display else None,
            "kpi_state": "unavailable", "oee": None, "good_count": None,
            "target_good": None, "scrap_count": None, "downtime_seconds": None,
            "shift_name": None, "product": None, "order": None,
            "warnings": [], "last_successful_update": None}
    try:
        candidate = display or SimpleNamespace(id=machine.id, name=machine.name, theme="light")
        data = build_dashboard(candidate, machine, shifts, now, display_settings)
        if data["status"] == "outside_shift":
            return {**base, "kpi_state": "outside_shift"}
        summary, production = data["summary"], data["production"]
        if data["status"] == "stale":
            state = "stale"
        elif summary["oee"] is None:
            state = "no_data"
        elif summary["oee"] < display_settings["oee_warning_threshold"]:
            state = "attention"
        else:
            state = "on_track"
        return {**base, "kpi_state": state, "oee": summary["oee"],
                "good_count": summary["good_count"], "target_good": production["target"],
                "scrap_count": summary["scrap_count"],
                "downtime_seconds": summary["downtime_seconds"],
                "shift_name": data["shift"]["name"], "product": production["product"],
                "order": production["order"], "warnings": summary["warnings"],
                "last_successful_update": data["last_successful_update"]}
    except Exception:
        log.exception("Fleet KPI calculation failed machine=%s", machine.id)
        return base


def build_fleet(machines: list[Machine], displays: list[Display], shifts: list[Shift],
                now: datetime, display_settings: dict, excluded_mes_ids: set[str] | None = None):
    live_rows, live_source = live_machine_rows()
    live_by_mes = {str(row.get("cyclades_mac_refmac") or row.get("machine_code")): row
                   for row in live_rows if row.get("cyclades_mac_refmac") or row.get("machine_code")}
    display_by_machine = {}
    for display in displays:
        display_by_machine.setdefault(display.machine_id, display)

    # Initialize the provider before workers start; its SQL engine is then shared safely.
    if machines:
        try:
            get_provider()
        except Exception:
            log.exception("Fleet MES provider unavailable")

    cards = []
    with ThreadPoolExecutor(max_workers=min(5, max(1, len(machines)))) as executor:
        futures = {executor.submit(_card, machine, display_by_machine.get(machine.id),
                                   shifts, now, display_settings): machine for machine in machines}
        for future in as_completed(futures):
            cards.append(future.result())

    configured_mes_ids = {machine.mes_id for machine in machines}
    excluded_mes_ids = excluded_mes_ids or set()
    for code, row in live_by_mes.items():
        if code not in configured_mes_ids and code not in excluded_mes_ids:
            cards.append({"id": code, "name": row.get("machine_name") or code,
                          "mes_id": code, "display_id": None, "kpi_state": "unconfigured",
                          "oee": None, "good_count": None, "target_good": None,
                          "scrap_count": None, "downtime_seconds": None, "shift_name": None,
                          "product": None, "order": None, "warnings": [],
                          "last_successful_update": None})

    detail_base = settings.euromap63_frontend_url.rstrip("/")
    for card in cards:
        row = live_by_mes.get(card["mes_id"], {})
        card["live_state"] = row.get("state") if live_source in ("euromap63", "demo") else None
        card["stop_reason"] = row.get("stop_reason")
        card["order"] = None if row.get("state") == "bez_zakazky" else row.get("order_ref") or card["order"]
        card["tool"] = row.get("tool_label") or row.get("tool_ref")
        card["cycle_time_real_s"] = row.get("cycle_time_real_s")
        card["cycle_time_planned_s"] = row.get("cycle_time_planned_s")
        card["live_detail_url"] = (f"{detail_base}/machine.html?code={quote(str(row['machine_code']))}"
                                   if detail_base and row.get("machine_code") else None)
    cards.sort(key=lambda card: press_sort_key(card["mes_id"]))
    valid_oee = [card["oee"] for card in cards if card["oee"] is not None and card["kpi_state"] != "stale"]
    live_available = live_source in ("euromap63", "demo")
    return {"server_time": now.isoformat(), "refresh_seconds": max(15, display_settings["refresh_seconds"]),
            "data_source": settings.mes_provider, "live_source": live_source,
            "oee_warning_threshold": display_settings["oee_warning_threshold"],
            "summary": {"total": len(cards),
                        "running": sum(card["live_state"] == "bezi" for card in cards) if live_available else None,
                        "stopped": sum(card["live_state"] == "stoji" for card in cards) if live_available else None,
                        "without_order": sum(card["live_state"] == "bez_zakazky" for card in cards) if live_available else None,
                        "attention": sum(card["kpi_state"] == "attention" for card in cards),
                        "unavailable": sum(card["kpi_state"] in ("unavailable", "stale", "unconfigured", "no_data") for card in cards),
                        "average_oee": sum(valid_oee) / len(valid_oee) if valid_oee else None},
            "machines": cards}
