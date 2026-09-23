from app.core.config import settings

KPI_KEYS = ("oee", "availability", "performance", "quality", "good", "scrap", "downtime", "speed_loss")

def default_display_settings():
    return {"refresh_seconds": settings.poll_seconds,
            "visible_kpis": list(KPI_KEYS),
            "oee_warning_threshold": 0.7}
