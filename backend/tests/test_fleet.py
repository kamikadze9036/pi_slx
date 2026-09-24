from datetime import datetime, timezone
from types import SimpleNamespace

from app.services import fleet


def test_fleet_keeps_machine_failures_isolated_and_maps_euromap_ids(monkeypatch):
    monkeypatch.setattr(fleet.settings, "mes_provider", "ciclades")
    machines = [SimpleNamespace(id="P2700-01", mes_id="P2700-01", name="Krauss Maffei MC5"),
                SimpleNamespace(id="P220-002", mes_id="P220-002", name="Presse 220 T")]
    displays = [SimpleNamespace(id="press-display", machine_id="P2700-01")]
    rows = [{"machine_code": "KM-MC5-01", "cyclades_mac_refmac": "P2700-01",
             "state": "bez_zakazky", "order_ref": None, "machine_name": "KM MC5",
             "cycle_time_real_s": 49.2,
             "worst_cavity_scrap": {"cavity_no": 2, "reject_pct": 9.6, "target_pct": 5.0}},
            {"machine_code": "P220-002", "cyclades_mac_refmac": "P220-002", "state": "stoji",
             "stop_reason": "Material feed"},
            {"machine_code": "P300-009", "cyclades_mac_refmac": "P300-009", "state": "bezi",
             "machine_name": "Presse 300 T"},
            {"machine_code": "P400-012", "cyclades_mac_refmac": "P400-012", "state": "bezi",
             "machine_name": "Hidden press"}]
    monkeypatch.setattr(fleet, "live_machine_rows", lambda: (rows, "euromap63"))
    monkeypatch.setattr(fleet, "collector_health_rows", lambda: [
        {"machine_code": "KM-MC5-01", "status": "ok", "seconds_since_last_cycle": 11},
        {"machine_code": "P220-002", "status": "unknown", "seconds_since_last_cycle": None}])
    monkeypatch.setattr(fleet, "get_provider", lambda: object())

    def dashboard(display, machine, shifts, now, settings):
        if machine.id == "P220-002":
            raise RuntimeError("one machine failed")
        return {"status": "ok", "summary": {"oee": 0.81, "good_count": 100,
                "scrap_count": 3, "downtime_seconds": 600, "warnings": []},
                "production": {"target": 120, "product": "Part", "order": "old order"},
                "shift": {"name": "Morning"}, "last_successful_update": None}

    monkeypatch.setattr(fleet, "build_dashboard", dashboard)
    result = fleet.build_fleet(machines, displays, [], datetime.now(timezone.utc),
                               {"refresh_seconds": 10, "oee_warning_threshold": 0.7}, {"P400-012"})
    assert [item["mes_id"] for item in result["machines"]] == ["P220-002", "P300-009", "P2700-01"]
    assert result["summary"]["total"] == 3
    assert result["summary"]["stopped"] == 1
    assert result["summary"]["unavailable"] == 2
    assert result["summary"]["average_oee"] == 0.81
    assert result["summary"]["collectors_online"] == 1
    assert result["summary"]["with_cycle_time"] == 1
    assert result["machines"][-1]["display_id"] == "press-display"
    assert result["machines"][-1]["order"] is None
    assert result["machines"][-1]["collector_status"] == "ok"
    assert result["machines"][-1]["last_cycle_age_s"] == 11
    assert result["machines"][-1]["worst_cavity_scrap"]["cavity_no"] == 2
    assert result["machines"][0]["kpi_state"] == "unavailable"
    assert result["machines"][1]["kpi_state"] == "unconfigured"


def test_live_fleet_does_not_publish_mock_shift_kpis(monkeypatch):
    monkeypatch.setattr(fleet.settings, "mes_provider", "mock")
    monkeypatch.setattr(fleet, "live_machine_rows", lambda: ([{
        "machine_code": "KM-MC5-01", "cyclades_mac_refmac": "P2700-01",
        "state": "bezi", "order_ref": "OF-123", "cycle_time_real_s": 49.2,
    }], "euromap63"))
    monkeypatch.setattr(fleet, "collector_health_rows", lambda: [])
    monkeypatch.setattr(fleet, "build_dashboard", lambda *args: (_ for _ in ()).throw(
        AssertionError("mock KPI provider must not be used")))
    machine = SimpleNamespace(id="P2700-01", mes_id="P2700-01", name="Press")
    result = fleet.build_fleet([machine], [], [], datetime.now(timezone.utc),
                               {"refresh_seconds": 10, "oee_warning_threshold": 0.7})
    card = result["machines"][0]
    assert card["live_state"] == "bezi"
    assert card["order"] == "OF-123"
    assert card["cycle_time_real_s"] == 49.2
    assert card["oee"] is None
    assert card["good_count"] is None
    assert result["summary"]["average_oee"] is None
