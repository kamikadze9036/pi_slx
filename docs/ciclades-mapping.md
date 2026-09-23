# Ciclades SQL Server mapping

No Ciclades schema is assumed. Before enabling `MES_PROVIDER=ciclades`, obtain read-only SQL Server credentials and confirm the exact tables, columns, timestamp timezone, units, aggregation semantics, and row volume with the MES owner.

## Information needed

1. Machine/line identifier and its relation to the machine IDs configured in the app.
2. Current production order and product/reference.
3. Good and scrap piece counts, their timestamp grain, and whether counts are cumulative or interval deltas.
4. Cycle counts, ideal cycle seconds, cavities/pieces per cycle, and changeovers within a shift.
5. Downtime start/end timestamps, reason/category, planned break markers, and how overlapping intervals are represented.
6. Site timezone of SQL timestamps and daylight-saving behavior.
7. Target output or rate semantics: pieces per hour, per order, or per shift.
8. Data latency, index availability, and a safe query budget on the production MES.

Create a JSON file outside Git with two parameterized SELECT statements:

```json
{
  "header_query": "SELECT ... AS product, ... AS [order], ... AS target_per_hour WHERE ... = :machine_id",
  "hours_query": "SELECT ... AS start, ... AS good_count, ... AS scrap_count, ... AS downtime_seconds, ... AS microstop_seconds, ... AS ideal_cycle_seconds WHERE ... = :machine_id AND ... >= :shift_start AND ... < :shift_end"
}
```

To populate the shift imprint with classified events and scrap reasons, add two more site-approved queries:
Merge all four query keys into the same JSON object.

```json
{
  "downtime_events_query": "SELECT ... AS start, ... AS [end], ... AS category, ... AS reason WHERE ... = :machine_id AND ... < :shift_end AND ... > :shift_start",
  "scrap_reports_query": "SELECT ... AS at, ... AS count, ... AS reason WHERE ... = :machine_id AND ... >= :shift_start AND ... < :shift_end"
}
```

Each downtime row describes one event with timezone-aware start/end timestamps and a stable category such as `mechanical`, `material`, `quality`, `micro_stop`, `planned`, or `other`. Each scrap row describes one report with a timezone-aware timestamp, nonnegative piece count, and reason. The queries must not return future events beyond `:now` unless the source explicitly marks them as scheduled; the app clips event display at the current time. If either query is absent, the corresponding details are shown as unavailable rather than fabricated.

The ellipses are placeholders, not runnable SQL. `start` must be a timezone-aware timestamp equal to an hourly interval start returned by the shift engine. `good_count` and `scrap_count` must be nonnegative interval totals. `downtime_seconds` and `microstop_seconds` are elapsed seconds in the interval. `ideal_cycle_seconds` is seconds per machine cycle. `target_per_hour` is good pieces per elapsed hour. Queries receive `:machine_id`, `:shift_start`, `:shift_end`, and `:now` bind parameters. `header_query` may return zero or one row; `hours_query` must return at most one row per interval.

Mount the file read-only into the backend container and set `CICLADES_MAPPING_FILE` to its path there. Use a SQLAlchemy `mssql+pymssql://...` DSN with a SQL Server account granted SELECT only. Validate the mapping against known shift reports, including night shifts, DST, downtime overlaps, multiple cavities, product changes, and incomplete current hours, before using live data for operational decisions.
