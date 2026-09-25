import json
import logging
import secrets
from datetime import datetime, time, timezone, timedelta
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.schemas import MachineIn, MachineOut, ShiftIn, ShiftOut, DisplayIn, HeartbeatIn, DashboardSettingsIn
from app.core.config import settings
from app.core.display_settings import default_display_settings
from app.mes.demo_presses import DEMO_PRESSES
from app.db.models import AppSetting, AuditLog, Display, Machine, Shift
from app.db.session import SessionLocal, get_db
from app.services.dashboard import build_dashboard
from app.services.euromap_shift import build_euromap_shift
from app.services.imprint import build_imprint
from app.services.fleet import build_fleet
from app.services.shifts import InvalidShiftSelection, active_shift

class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({"time": datetime.now(timezone.utc).isoformat(), "level": record.levelname,
                           "message": record.getMessage(), "logger": record.name})

handler = logging.StreamHandler()
handler.setFormatter(JsonFormatter())
logging.basicConfig(level=logging.INFO, handlers=[handler])
log = logging.getLogger("dashboard")
app = FastAPI(title="Production Efficiency Dashboard", version="0.1.0")

@app.on_event("startup")
def seed_demo():
    with SessionLocal() as db:
        if not db.get(Machine, "demo-machine"):
            db.add(Machine(id="demo-machine", mes_id="demo-machine", name="LINE 07 / Assembly",
                           pieces_per_cycle=2, ideal_cycle_seconds=32.0, fleet_enabled=False))
        if not db.get(Display, "demo"):
            db.add(Display(id="demo", name="Assembly / Display 07", machine_id="demo-machine",
                           theme="light" if settings.mes_provider == "euromap63" else "dark"))
        if settings.mes_provider in ("mock", "euromap63"):
            demo_machine = db.get(Machine, "demo-machine")
            demo_machine.fleet_enabled = False
            for machine_id, machine_name in DEMO_PRESSES:
                if not db.get(Machine, machine_id):
                    db.add(Machine(id=machine_id, mes_id=machine_id,
                                   name=machine_name, fleet_enabled=True,
                                   pieces_per_cycle=2 if settings.mes_provider == "mock" else 1,
                                   ideal_cycle_seconds=32.0 if settings.mes_provider == "mock" else None))
                if not db.get(Display, machine_id):
                    db.add(Display(id=machine_id, name=f"{machine_id} display",
                                   machine_id=machine_id, theme="light"))
        if settings.mes_provider == "euromap63":
            demo_display = db.get(Display, "demo")
            if demo_display and demo_display.machine_id == "demo-machine":
                demo_display.machine_id = "P2700-01"
                demo_display.name = "P2700-01 / Injection"
        for ident, name, begin, end in [("morning", "Morning", time(6), time(14)),
                                        ("afternoon", "Afternoon", time(14), time(22)),
                                        ("night", "Night", time(22), time(6))]:
            if not db.get(Shift, ident):
                db.add(Shift(id=ident, name=name, start_time=begin, end_time=end, days=list(range(7))))
        if not db.get(AppSetting, "dashboard_settings"):
            db.add(AppSetting(key="dashboard_settings", value=default_display_settings()))
        db.commit()
    log.info("startup provider=%s", settings.mes_provider)

def require_admin(x_admin_key: str | None = Header(default=None)):
    if not settings.admin_api_key or not x_admin_key or not secrets.compare_digest(x_admin_key, settings.admin_api_key):
        raise HTTPException(401, "Invalid admin key")

def audit(db: Session, action: str, entity: str, entity_id: str, details: dict):
    db.add(AuditLog(at=datetime.now(timezone.utc), action=action, entity=entity,
                    entity_id=entity_id, details=details))

def dashboard_settings(db: Session) -> dict:
    item = db.get(AppSetting, "dashboard_settings")
    return {**default_display_settings(), **(item.value if item else {})}

def machine_or_404(db: Session, machine_id: str):
    machine = db.get(Machine, machine_id)
    if machine is None:
        raise HTTPException(404, "Unknown machine")
    return machine

def display_or_404(db: Session, display_id: str):
    display = db.get(Display, display_id)
    if display is None or not display.active:
        raise HTTPException(404, "Unknown or disabled display")
    return display

@app.get("/api/health")
def health():
    return {"status": "ok", "provider": settings.mes_provider}

@app.get("/api/displays/{display_id}")
def get_display(display_id: str, db: Session = Depends(get_db)):
    display = display_or_404(db, display_id)
    return {"id": display.id, "name": display.name, "machine_id": display.machine_id,
            "dashboard_type": display.dashboard_type, "theme": display.theme, "active": display.active}


@app.get("/api/fleet/dashboard")
def fleet_dashboard(db: Session = Depends(get_db)):
    all_machines = list(db.scalars(select(Machine)))
    machines = [machine for machine in all_machines if machine.active and machine.fleet_enabled]
    excluded_mes_ids = {machine.mes_id for machine in all_machines if not machine.active or not machine.fleet_enabled}
    displays = list(db.scalars(select(Display).where(Display.active).order_by(Display.id)))
    shifts = list(db.scalars(select(Shift).where(Shift.active)))
    return build_fleet(machines, displays, shifts, datetime.now(timezone.utc), dashboard_settings(db), excluded_mes_ids)

@app.get("/api/displays/{display_id}/dashboard")
def dashboard(display_id: str, shift_start: datetime | None = None, db: Session = Depends(get_db)):
    display = display_or_404(db, display_id)
    machine = machine_or_404(db, display.machine_id)
    if not machine.active:
        raise HTTPException(404, "Machine disabled")
    try:
        builder = build_euromap_shift if settings.mes_provider == "euromap63" else build_dashboard
        return builder(display, machine, list(db.scalars(select(Shift).where(Shift.active))),
                       datetime.now(timezone.utc), dashboard_settings(db), shift_start)
    except InvalidShiftSelection as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception:
        log.exception("dashboard calculation failed display=%s", display_id)
        raise HTTPException(503, "MES data unavailable")

@app.post("/api/displays/{display_id}/heartbeat")
def heartbeat(display_id: str, payload: HeartbeatIn, request: Request, db: Session = Depends(get_db)):
    display = display_or_404(db, display_id)
    was_offline = not display.last_seen or datetime.now(timezone.utc) - display.last_seen.astimezone(timezone.utc) > timedelta(seconds=45)
    display.last_seen = datetime.now(timezone.utc)
    display.last_client = request.headers.get("user-agent", "")[:300]
    display.last_ip = request.client.host if request.client else None
    display.frontend_version = payload.frontend_version
    db.commit()
    if was_offline:
        log.info("display online id=%s machine=%s", display.id, display.machine_id)
    return {"ok": True}

@app.get("/api/displays/{display_id}/shift-imprint")
def shift_imprint(display_id: str, shift_start: datetime | None = None, db: Session = Depends(get_db)):
    display = display_or_404(db, display_id)
    machine = machine_or_404(db, display.machine_id)
    if not machine.active:
        raise HTTPException(404, "Machine disabled")
    try:
        builder = build_euromap_shift if settings.mes_provider == "euromap63" else build_imprint
        return builder(display, machine, list(db.scalars(select(Shift).where(Shift.active))),
                       datetime.now(timezone.utc), dashboard_settings(db), shift_start)
    except InvalidShiftSelection as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception:
        log.exception("shift imprint calculation failed display=%s", display_id)
        raise HTTPException(503, "MES data unavailable")

@app.get("/api/machines", response_model=list[MachineOut])
def machines(db: Session = Depends(get_db)):
    return list(db.scalars(select(Machine).order_by(Machine.name)))

@app.get("/api/machines/{machine_id}", response_model=MachineOut)
def machine(machine_id: str, db: Session = Depends(get_db)):
    return machine_or_404(db, machine_id)

@app.get("/api/machines/{machine_id}/current-shift")
def machine_current_shift(machine_id: str, db: Session = Depends(get_db)):
    machine_or_404(db, machine_id)
    selected = active_shift(list(db.scalars(select(Shift))), datetime.now(timezone.utc), settings.site_timezone)
    if not selected:
        raise HTTPException(404, "No current shift")
    shift, start, end = selected
    return {"id": shift.id, "name": shift.name, "start": start, "end": end}

@app.get("/api/machines/{machine_id}/shift/{shift_id}")
def machine_shift(machine_id: str, shift_id: str, db: Session = Depends(get_db)):
    machine_or_404(db, machine_id)
    shift = db.get(Shift, shift_id)
    if not shift:
        raise HTTPException(404, "Unknown shift")
    return {"id": shift.id, "name": shift.name, "start_time": shift.start_time,
            "end_time": shift.end_time, "days": shift.days}

@app.get("/api/config/shifts", response_model=list[ShiftOut])
def shifts(db: Session = Depends(get_db)):
    return list(db.scalars(select(Shift).order_by(Shift.start_time)))

@app.get("/api/config/dashboard-settings", response_model=DashboardSettingsIn)
def get_dashboard_settings(db: Session = Depends(get_db)):
    return dashboard_settings(db)

@app.put("/api/admin/dashboard-settings", response_model=DashboardSettingsIn, dependencies=[Depends(require_admin)])
def save_dashboard_settings(payload: DashboardSettingsIn, db: Session = Depends(get_db)):
    value = payload.model_dump()
    item = db.get(AppSetting, "dashboard_settings") or AppSetting(key="dashboard_settings")
    item.value = value
    db.add(item)
    audit(db, "update", "dashboard_settings", "dashboard_settings", value)
    db.commit()
    return value

@app.get("/api/admin/displays", dependencies=[Depends(require_admin)])
def admin_displays(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    return [{"id": item.id, "name": item.name, "machine_id": item.machine_id,
             "dashboard_type": item.dashboard_type, "theme": item.theme, "active": item.active,
             "last_seen": item.last_seen,
             "online": bool(item.last_seen and (now - item.last_seen.astimezone(timezone.utc)).total_seconds() < 45)}
            for item in db.scalars(select(Display).order_by(Display.id))]

@app.put("/api/admin/machines/{machine_id}", response_model=MachineOut, dependencies=[Depends(require_admin)])
def save_machine(machine_id: str, payload: MachineIn, db: Session = Depends(get_db)):
    if machine_id != payload.id:
        raise HTTPException(400, "ID mismatch")
    item = db.get(Machine, machine_id) or Machine(id=machine_id)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    db.add(item)
    audit(db, "upsert", "machine", machine_id, payload.model_dump())
    db.commit()
    return item

@app.put("/api/admin/shifts/{shift_id}", response_model=ShiftOut, dependencies=[Depends(require_admin)])
def save_shift(shift_id: str, payload: ShiftIn, db: Session = Depends(get_db)):
    if shift_id != payload.id or any(day not in range(7) for day in payload.days):
        raise HTTPException(400, "Invalid shift ID or days")
    item = db.get(Shift, shift_id) or Shift(id=shift_id)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    db.add(item)
    audit(db, "upsert", "shift", shift_id, payload.model_dump(mode="json"))
    db.commit()
    return item

@app.put("/api/admin/displays/{display_id}", dependencies=[Depends(require_admin)])
def save_display(display_id: str, payload: DisplayIn, db: Session = Depends(get_db)):
    if display_id != payload.id:
        raise HTTPException(400, "ID mismatch")
    machine_or_404(db, payload.machine_id)
    item = db.get(Display, display_id) or Display(id=display_id)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    db.add(item)
    audit(db, "upsert", "display", display_id, payload.model_dump())
    db.commit()
    log.info("display mapping updated id=%s machine=%s", display_id, payload.machine_id)
    return {"id": item.id, "name": item.name, "machine_id": item.machine_id,
            "dashboard_type": item.dashboard_type, "theme": item.theme, "active": item.active}
