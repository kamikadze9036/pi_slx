# Architecture and calculation notes

```
Ciclades SQL Server (read-only) / Mock MES
             ↓
      MesDataProvider
             ↓
 FastAPI shift + KPI services ── PostgreSQL configuration
             ↓
     frontend-ready API
             ↓
 React display / admin page in Nginx
```

The backend holds no session state. PostgreSQL stores machines, shift definitions, display mappings, heartbeats, and an audit log of admin edits. The five-second MES snapshot cache is process-local; deployment currently starts one Uvicorn worker. A multi-worker deployment would need a shared cache such as Redis to preserve query coalescing.

The shift engine uses timezone-aware timestamps and divides shifts into 3600-second elapsed intervals, with the final interval possibly shorter. On a daylight-saving fall-back night, a 22:00–06:00 shift has nine elapsed hours; on spring-forward, seven. A completed interval's bar fills its elapsed planned capacity. The current interval fills only time up to the server's current timestamp.

For an observation, `ideal_per_piece = ideal_cycle_seconds / pieces_per_cycle`. Good and scrap counts are multiplied by this factor. `runtime = planned - downtime`; `speed_loss = runtime - microstops - good_ideal - scrap_ideal`. OEE is `availability × performance × quality`, with components calculated from raw counts and runtime. When ideal time exceeds productive runtime, the bar's good and scrap segments are proportionally fit to available runtime, speed loss is zero, and a data-quality warning is emitted. Raw performance is preserved and may exceed 100%. When ideal cycle or essential counts are missing, OEE is unavailable and unexplained runtime is shown as unknown.

The SQL provider accepts site-supplied SELECT queries that return a normalized row contract. The source login must itself be read-only. Query validation in the app is a secondary guard, not a substitute for database permissions. The hourly query must aggregate downtime accurately; the optional detailed event query supplies the chronological view. Overlapping downtime must be resolved or flagged in the site mapping.
The optional detailed mapping adds raw downtime and scrap-report events. The shift imprint places those events on a chronological track and groups them by reason. The hourly dashboard continues to aggregate loss categories before rendering; it never reuses the chronological sequence for its loss bars.
The backend flags overlapping downtime events, invalid/out-of-shift timestamps, negative input values, scrap reports that exceed hourly scrap, missing ideal cycle, and performance above 100%. Warnings appear in the dashboard payload and footer; the app does not silently repair source events.

## Current limitations

- One site timezone is configured per deployment. Multiple sites require a `Plant` model and per-display timezone mapping.
- Break exclusion is supported in the KPI input model but not yet configurable in the admin UI; the demo counts the full shift as planned time.
- The admin UI supports creating/updating machines, displays, shifts, refresh rate, visible summary KPIs, and an OEE warning threshold. Category colors remain fixed for now.
- The `GET /api/machines/{id}/shift/{shift_id}` endpoint returns the shift definition; historical shift dashboards require a date-aware query contract.
- No production Ciclades mapping is supplied. Complete the mapping checklist before setting `MES_PROVIDER=ciclades`.
