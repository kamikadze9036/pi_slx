import json
from datetime import datetime
from pathlib import Path
from sqlalchemy import create_engine, text
from app.mes.base import DowntimeEvent, HourObservation, MesSnapshot, ScrapReport

class CicladesSqlServerProvider:
    """Executes site-approved, parameterized read-only queries with a normalized result contract."""
    def __init__(self, dsn: str, mapping_file: str):
        if not dsn or not mapping_file:
            raise ValueError("CICLADES_DSN and CICLADES_MAPPING_FILE are required")
        mapping = json.loads(Path(mapping_file).read_text(encoding="utf-8"))
        self.header_sql = self._select(mapping["header_query"])
        self.hours_sql = self._select(mapping["hours_query"])
        self.downtime_sql = self._select(mapping["downtime_events_query"]) if mapping.get("downtime_events_query") else None
        self.scrap_sql = self._select(mapping["scrap_reports_query"]) if mapping.get("scrap_reports_query") else None
        self.engine = create_engine(dsn, pool_pre_ping=True)

    @staticmethod
    def _select(query: str) -> str:
        if not query.lstrip().lower().startswith(("select ", "with ")) or ";" in query:
            raise ValueError("Ciclades mapping queries must be single read-only SELECT statements")
        return query

    def fetch_shift(self, mes_machine_id: str, start: datetime, end: datetime, now: datetime) -> MesSnapshot:
        params = {"machine_id": mes_machine_id, "shift_start": start, "shift_end": end, "now": now}
        with self.engine.connect() as connection:
            header = connection.execute(text(self.header_sql), params).mappings().first()
            rows = connection.execute(text(self.hours_sql), params).mappings().all()
            downtime_rows = connection.execute(text(self.downtime_sql), params).mappings().all() if self.downtime_sql else []
            scrap_rows = connection.execute(text(self.scrap_sql), params).mappings().all() if self.scrap_sql else []
        return MesSnapshot(
            header.get("product") if header else None,
            header.get("order") if header else None,
            float(header["target_per_hour"]) if header and header.get("target_per_hour") is not None else None,
            [HourObservation(row["start"], int(row["good_count"]), int(row["scrap_count"]),
                             float(row["downtime_seconds"]), float(row.get("microstop_seconds") or 0),
                             float(row["ideal_cycle_seconds"]) if row.get("ideal_cycle_seconds") is not None else None)
             for row in rows],
            [DowntimeEvent(row["start"], row["end"], str(row["category"]), str(row["reason"]))
             for row in downtime_rows],
            [ScrapReport(row["at"], int(row["count"]), str(row["reason"])) for row in scrap_rows],
            bool(self.downtime_sql), bool(self.scrap_sql))
