# New hourly overview: PDF layout and production-loss proposal

Status: implementation proposal and handoff, 2026-10-06. This document does not
describe an implemented or deployed feature. Baseline: `b6f94a9` on
`codex/plant-overview`, preceded by `1b00a04`; both application commits are
already deployed on SPC VM.

## Objective and scope

The owner wants `/display/{id}/hourly-new` to follow the uploaded
`Whiteboard.pdf` in the application's existing colors, with English controls
and one row per elapsed shift hour. Correct counts alone are insufficient:
the screen must explain OK output, production losses and recoverable output.
The current Euromap63 view shows independent cycle, stop-time and scrap bars,
plus count/stop gauges. Replace that presentation with a common production-loss
composition, output-efficiency gauge and actual/ideal-cycle gauge.

Preserve `/display/{id}/hourly`, `/imprint`, the fleet view and existing display
defaults. Source comments and reason names remain in their original language.
Do not rename recorded cycles or counter increases to OK pieces.

The original PDF is a local user-supplied reference and is not tracked in Git.
This proposal and its [wireframe](hourly-new-wireframe.svg) are self-contained
for an implementer who does not have that file. The wireframe uses synthetic,
fully reconciled data; it is not a screenshot of the plant or current software.

## What to reproduce from the reference

The PDF's table has a narrow vertical JOB column, machine/interval, one
composition column, OEE ring, cycle-difference ring, TYPE, REASON and COMMENT.
The composition contains a large green output segment and smaller loss
segments beside it; the ring caption shows output against a denominator,
for example `609 / 674`. The cycle ring shows a signed difference with actual
and ideal seconds beneath it. The final row aggregates the displayed scope.
There are also rows above 100%, so do not silently cap a numerical KPI at 100%.
The PDF does not establish the source system's exact denominator, exclusions
or counter semantics. The formulas below are the proposed application contract,
not an assertion about Shoplogix's internal calculation.

Adapt the machine-per-shift rows to hour-per-machine rows:

| Column | Proposed content |
| --- | --- |
| ORDER | Effective historical order(s), vertical; segmented if an hour has a changeover |
| HOUR / MACHINE | Server interval, machine, current-hour marker and expandable details |
| OUTPUT / LOSSES | One shared composition: OK, scrap, stop, micro-stop, speed loss; all in a common unit |
| OUTPUT EFFICIENCY | Ring and `OK / ideal capacity` caption; use `OEE` only when its inputs are verified |
| CYCLE | Signed actual-minus-ideal seconds, with actual / ideal caption |
| TYPE | Aggregated production and loss categories with quantities/durations |
| REASON | MES reason, grouped without losing quantity or duration |
| COMMENT | Read-only source comment; retain separate events with different comments |

Use the existing `--ov-*` colors: green OK, red scrap, orange downtime,
purple micro-stops, yellow slow running, blue excluded breaks, gray unknown.
Within one row the PDF-style composition consists of adjacent colored columns
of a common height; widths represent shares of the same capacity. It must not
be three independent bars normalized against the busiest/worst hour.
In minutes mode, use equivalent ideal-production time for OK and scrap,
and actual loss duration for stops. In pieces mode, use real OK/scrap counts
and ideal-rate piece equivalents for time losses. Explain equivalents in the
legend. Keep a separate preference under `hourly-new-unit`.

Above the table, show `OK PIECES`, `WITHOUT SCRAP / STOPS`, `RECOVERABLE OUTPUT`
and `IDEAL CAPACITY`. Preserve recorded-cycle, stop-count, observed-stop-time
and declared-scrap facts in a compact secondary strip/details for comparison
with the old screen. Partial data must still show these available facts.

## Define the two potentials explicitly

For an elapsed, fully covered interval with one effective order, let:

| Symbol | Definition / unit |
| --- | --- |
| T | Observed elapsed seconds, from server intervals, never future shift time |
| E | Explicitly excluded planned/no-demand seconds, supported by classified source data |
| P | Planned production seconds: `T - E` |
| C | Effective ideal seconds per machine cycle for this order and time |
| N | Effective pieces per cycle, including verified cavity configuration |
| r | Ideal pieces per second: `N / C` |
| G | Verified OK pieces for this production interval |
| S | Verified rejected pieces for the same interval and scope as G |
| D | Included downtime seconds, excluding E and micro-stops |
| M | Included micro-stop seconds, disjoint from D and E |
| R | Productive runtime: `P - D - M` |
| a | Achieved pieces per productive second: `(G + S) / R`, when R > 0 |

Primary counterfactual requested by the owner:

```text
stop_recovery_at_achieved_rate = (D + M) * a
without_scrap_or_stops = G + S + stop_recovery_at_achieved_rate
recoverable_output = S + stop_recovery_at_achieved_rate
```

This recovers rejected pieces and stopped-time output at the achieved running
rate. It keeps the achieved running speed. It is a calculated counterfactual,
not a measured production count or an end-of-shift forecast. Use this label
and definition consistently, including tooltips and the total row.
For a fully stopped hour, R=0 makes a unavailable: the ideal capacity can still
be known, but this counterfactual cannot assume an achieved rate. A historical
rate may be used only as an explicitly sourced estimate, never a silent fallback.

Separately, capacity at the ideal cycle:

```text
ideal_capacity = P * r
speed_loss_pieces = max(0, R * r - (G + S))
speed_gain_pieces = max(0, (G + S) - R * r)
output_efficiency = G / ideal_capacity                 # when capacity > 0
cycle_actual = R * N / (G + S)                         # if using reconciled counts
cycle_delta = cycle_actual - C
```

For consistent data without a speed gain:

```text
ideal_capacity = G + S + D*r + M*r + speed_loss_pieces
```

Equivalently, time segments are `G/r`, `S/r`, D, M and
`max(0, R - (G+S)/r)`; their sum equals P. Render E separately in the composition
as excluded time/capacity; exclude it from planned capacity and productive
runtime. It contributes to neither potential as recoverable stopped time.
Do not infer E from missing cycles, a stop reason's spelling, or a current
machine state. Absent classifications mean exclusion is unknown, not zero.

The output ratio equals conventional OEE only with verified, aligned counts,
planned time, classified stops and ideal rates. With declaration-time counts,
label the ratio `DECLARED OUTPUT / CAPACITY` and keep OEE unavailable until
production-time reconciliation is established. An observed subset of stops
cannot support an unrestricted `WITHOUT SCRAP / STOPS` claim: expose an
explicit observed-loss estimate or keep that potential unavailable.

Do not automatically call negative speed loss a gain. Confirm rate, time
allocation, corrections and batching first. For a verified speed gain, retain
the raw ratio above 100% and show a gain indicator; do not change raw counts
to force a closed bar. Otherwise return an inconsistent-data status and
avoid displaying a misleading reconciled stack. A saturated ring may use a
badge for over-100% values, but its numeric label must retain the actual value.

## Worked acceptance example (synthetic)

One completed hour: T=3,600 s, E=0, C=30 s, N=2, G=170, S=10,
D=600 s, M=120 s. All coverage and production-time attribution are verified.

| Output | Expected value |
| --- | --- |
| OK pieces / scrap | 170 / 10 pcs |
| Downtime / micro-stops | 10 / 2 min |
| Ideal capacity | 240 pcs |
| Downtime / micro-stop equivalents | 40 / 8 pcs eq. |
| Speed loss | 12 pcs eq. = 3 min |
| Achieved output rate | 0.0625 pcs/s; downtime recovery 37.5, micro-stop recovery 7.5 pcs |
| Without scrap or stops | 225 pcs |
| Recoverable output | +55 pcs |
| OEE | 70.83%, caption `170 / 240 pcs` |
| Calculated actual / ideal cycle | 32.0 / 30.0 s, difference +2.0 s |
| Composition in pieces | 170 green + 10 red + 40 orange + 8 purple + 12 yellow = 240 |
| Composition in minutes | 42.5 green + 2.5 red + 10 orange + 2 purple + 3 yellow = 60 |

Never display 225 as the ideal-capacity denominator: it retains achieved
running speed. Conversely, 240 is not the potential obtained
by removing only scrap and stops. This distinction prevents an attractive but
ambiguous `actual / potential` gauge.
The stack uses ideal-rate equivalents (48 stopped-time pieces), whereas the
counterfactual recovers 45 stopped-time pieces at the achieved rate. Make this
distinction visible in tooltips; do not sum the stack's loss equivalents to
obtain the primary recoverable output.

## Verified source limitations to resolve first

The following findings come from source inspection and read-only checks on
SPC VM. Reverify them when implementing; source services may change.

| Source | Available facts | Limitation / required action |
| --- | --- | --- |
| Euromap `/api/cycles` | Timestamp, cycle counter/time, order reference | A cycle is not an OK piece. Validate historical order attribution before rate selection. |
| `/api/cycles/cyclades-derived` | Sampled counter deltas, windows, order and target cycle | Coarse samples and resets; do not imply individual-cycle precision. |
| `/api/downtimes` | Stop intervals/reasons from cycle gaps or sampled state | Coverage can be incomplete; boundaries and classification need explicit quality metadata. |
| `/api/scrap-declarations` | Timestamped reason, product, order and rejected quantity | Declaration time is not necessarily production time; preserve every declaration. |
| `/api/machines/cavity-scrap` | Current-order cumulative cavity quantities | Entire-order/current-state data, not historical hourly OK output or cavity configuration. |
| `/api/machines/cavity-scrap/shift` | Windowed per-product cumulative-counter deltas | Declared OK pieces can lag production until packing. Current implementation partitions by product and uses the last order plus a baseline. Independently queried hours did not reconcile to the shift, and falling counters were treated as resets. Do not sum hourly calls or infer OK as made minus reject. |
| `/api/machines/cycle-targets` | Some historical order-cycle targets | A live order's historical entry was absent despite a current planned-cycle value. Current cycle values must not be applied retroactively. |
| Local Machine configuration | `pieces_per_cycle`, `ideal_cycle_seconds` | Demonstration/stale parameters were inconsistent with live MES values. Do not silently use these as verified historical norms. |

The existing Euromap services live in the separate `~/euromap63-docker` checkout;
this proposal does not change that service or grant an instruction to rewrite
its collector. If a source API extension is needed, describe its exact scope,
commit it in its own repository and preserve the collector/database history.
Prefer one bounded production-history response, not repeated synchronous SQL
queries for every hour on every dashboard refresh.

Recommended normalization:

1. Fetch declaration history with stable event IDs, timestamps, machine,
   product AND order keys, and original good/reject fields. Establish whether
   these are event quantities or cumulative counters and what corrections mean.
2. Normalize cumulative values once over the selected shift plus necessary
   baselines, retaining every order/product transition and correction. Do not
   treat every decrease as a fresh order or reuse the current order's cavities.
3. Produce hourly and shift totals from that one normalized ledger. Allocation
   must be additive. If corrections cannot be attributed reliably, report the
   affected metric as inconsistent rather than hiding negatives or inventing
   a new reject count.
4. Provide effective order/rate/cavity intervals covering planned time,
   including periods without cycles. Verify seconds-per-cycle versus
   seconds-per-piece. Never derive N from an order-name suffix or the number
   of current cavity rows.
5. Merge/clip overlapping stops and establish exclusion categories and
   coverage. Unknown time stays unknown; missing data does not prove running.

Use declared OK pieces as the recommended factual fallback, explicitly
labelled `DECLARED OK PIECES` with declaration-time basis. Do not make an
estimated cycle-derived OK count the default. The owner has not yet selected
between declared counts and a visibly marked estimate; document that product
choice before enabling an estimated mode.

## Proposed backend contract

Add an independent service and endpoint for the new presentation:
`GET /api/displays/{id}/hourly-overview?shift_start=...`.
Reuse shift selection and the existing cached observation snapshot, so the
old dashboard, imprint and new overview agree on raw cycles/stops/scrap.
The new endpoint adds normalized production and loss calculations; leave
the old `/dashboard` and `/shift-imprint` contracts and behavior compatible.
Keep SQL/provider-specific interpretation outside the calculation engine.

For each hour and total expose a typed result containing:

```text
interval: start, end, elapsed_seconds, planned_seconds, excluded_seconds
orders: effective order/rate segments; unknown segments stay explicit
raw_observations: recorded count, distinct stop count, stop seconds,
                  declared scrap (same facts as the existing dashboard)
production: good_count, scrap_count, count_basis, source_as_of
capacity: ideal_capacity, without_scrap_or_stops, recoverable_output
losses: mutually exclusive categories, seconds, piece equivalents
efficiency: ratio, kind (oee | declared_output_ratio), denominator
cycle: actual_seconds, ideal_seconds, delta_seconds, basis
quality: per-metric status, coverage, missing inputs and warnings
```

Use null for unavailable metrics and a per-metric status such as verified,
provisional, insufficient_data or inconsistent. A valid zero is distinct from
null. Keep raw observations, declaration scrap and reconciled production scrap
separate when their bases differ; differences need an explanation and source
time, not a silent overwrite. Source failure should retain the last valid
snapshot and its timestamp, with the existing stale banner.

For order changes within an hour calculate each rate interval separately:
`sum(P_i * N_i/C_i)` for ideal capacity, and
`sum((D_i+M_i) * (G_i+S_i)/R_i)` for achieved-rate stop recovery. Calculate
ideal-rate stop equivalents separately for the composition, then aggregate. Never
multiply a whole hour or shift by a simple average cycle/cavity count.
Sum G, S and capacity before computing total efficiency; do not average
percentages. For varying rates use a clearly named output-weighted equivalent
cycle or show `Mixed orders` and a per-order cycle detail. Do not imply a
single measured cycle or a single ideal cycle across incompatible products.

Event IDs allow a stop crossing hourly boundaries to contribute clipped time
to both hours but count once in the shift total. Use offset-aware `[start,end)`
intervals and existing server-generated DST hours. Round only for rendering;
never sum rounded minutes or loss equivalents.

## Implementation sequence for Claude

1. Start from `codex/plant-overview` at or after `b6f94a9`. Read this proposal,
   `docs/architecture.md`, `docs/ciclades-mapping.md` and the wireframe. Confirm
   the declaration/correction and historical rate inputs before live KPIs.
2. Add a normalized production-observation adapter and a pure hourly-loss
   calculation service (suggested new files under `backend/app/services/`).
   Audit existing `kpi.py`: it fits bars when ideal time exceeds runtime;
   do not let that alter new raw counts or conceal inconsistent data.
3. Add the new endpoint in `backend/app/main.py` and explicit response models
   in `backend/app/api/schemas.py`. Extend `frontend/src/types.ts`. Batch/cache
   source reads and preserve observation parity with the existing endpoint.
4. Change `frontend/src/pages/DashboardNew.tsx` to consume the new endpoint.
   Extend `frontend/src/hourly-model.ts` without frontend reconstruction of
   source counter semantics. Replace `RecordedActivity` and live count/stop
   gauges in `frontend/src/pages/HourlyOverview.tsx`; adapt
   `frontend/src/hourly-overview.css` to the common composition and two rings.
5. Retain English labels, both themes, source details, search, shift navigation,
   unit preference, current-state strip and the unfiltered shift total.
   Unavailable production/rates must leave observation facts visible, with
   an honest partial-data state. Do not label this fallback PDF-complete.
6. Add the meaningful calculations/data-quality tests below, build, inspect
   desktop/mobile views, and document the real source validation. Update README
   to describe implemented behavior only. Commit and push the implementation
   to the agreed working branch for review; do not replace old defaults.

## Acceptance and release checks

- The synthetic example above passes in minutes and pieces, including the
  separate 225 and 240 potentials, +55 gap and +2.0 s cycle delta.
- A 60-second excluded break removes exactly its ideal-rate capacity from
  ideal capacity; planned exclusion is not counted as recoverable unplanned loss.
- Two orders with different C/N inside an hour use interval rates. Missing
  historical order/rate or unclassified stop coverage produces null/partial
  metrics, never a fallback to current-order or mock settings.
- Declaration batching, corrections, product reuse on a new order, resets,
  duplicate timestamps and missing baselines are covered. Hourly sums reconcile
  to a single normalized shift ledger, with a surfaced reconciliation status.
- Overlapping stops do not double-count duration. A boundary-crossing stop is
  counted once in the shift summary. Spring/fall DST and partial hours pass.
- Zero output with complete coverage can be zero; no observations is unavailable.
  No division by zero or fabricated 100% ring. Above-100% data is retained and
  either verified as gain or marked inconsistent.
- Keep existing observation-parity checks for cycles, stop counts/durations and
  declaration scrap against the old view, using a fixed snapshot/completed shift.
  These facts remain distinct from the new production metrics.
- Verify stale/offline behavior, English labels, details/comments, filter-invariant
  totals, unit persistence, light/dark themes and a scrollable mobile table.
- Run backend tests (`MES_PROVIDER=mock pytest -q`), frontend model tests
  (`node --test tests/*.test.mjs` from `frontend`), TypeScript and production build.
  Confirm real inputs with a known shift report before enabling verified KPIs.
- Deployment must retain a rollback image/source revision and compare display
  settings before/after. Preserve the original hourly route/default, MES history
  and PostgreSQL volume. Changing backend code requires deploying the backend
  as well as the frontend; do not deploy a UI that expects an absent endpoint.

Deliver a concise implementation report naming resolved source gaps, remaining
limitations and the tested formula examples. A screen with only cycles and
observed stops is still useful, but does not complete this PDF-based requirement.
