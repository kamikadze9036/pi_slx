# Plant overview and factory data handoff

The `/fleet` screen is an overview of the injection press catalog. It shows current press state and shift performance as **separate data streams**. A stopped press can still have a strong shift OEE from earlier production; a low OEE does not prove it is stopped now.

On the factory VM, `MES_PROVIDER=euromap63`. The overview displays only observed data from the Euromap63 API and does not calculate or show shift OEE or good/scrap piece totals. Per-press hourly and imprint views read recorded cycles and observed stop intervals through `/api/cycles` and `/api/downtimes`; they label gaps and sampled event times as incomplete or approximate. No direct Cyclades connection is configured in `pi_slx`.

When `MES_PROVIDER=mock` but Euromap63 is connected, the fleet screen shows **live machine information only**: state, current order, actual/planned cycle time, worst-cavity scrap for the entire current order, and Euromap collector health. It does not show simulated OEE or shift counts on the fleet cards. The hourly and imprint detail screens still use simulated shift data and label it accordingly. Worst-cavity scrap comes from Cyclades `LIGOF` through Euromap63 and is cumulative for the order, not this shift. A collector status of `unknown` means no Euromap cycle collector is configured for that press; its live state may still come from Cyclades.

## Existing systems reviewed

- [euromap63](https://github.com/kamikadze9036/euromap63) already has a hall view and a cached `GET /api/machines/status` endpoint for 20 presses. Its `cyclades_mac_refmac` is the join key to Ciclades; `P2700-01` has Euromap `machine_code=KM-MC5-01`.
- [pi_cyclades](https://github.com/kamikadze9036/pi_cyclades) documents the Ciclades machine catalog and shift/result tables. The repository is useful for designing the SQL mapping, but its schema notes must still be verified against the running database before production calculations are enabled.
- `claude-skills` contains VM deployment notes. Deployment is intentionally outside this local preparation task.

The demo seeds those 20 identifiers only when `MES_PROVIDER=mock`. All values and live states in that mode are synthetic; the banner says `DEMO / SIMULATED DATA`.

## Connect the existing live state service

On the Ubuntu VM, set these in this project's `.env`:

```dotenv
EUROMAP63_API_URL=http://host.docker.internal:8091
EUROMAP63_FRONTEND_URL=http://YOUR-VM-HOSTNAME-OR-IP:8092
```

Docker Compose maps `host.docker.internal` to the host gateway for the backend container. The API URL is fetched server-side once per overview refresh; the frontend URL only creates a browser link to the existing detail page. The service uses the Euromap63 `cyclades_mac_refmac` field to join to our `Machine.mes_id`. If the live API fails, live-state counts become unavailable rather than zero, while existing KPI cards remain visible. If Euromap63 knows a press that this app has not configured, it still appears as `KPI NOT CONNECTED`.

The fleet backend also reads `GET /api/collectors/health` once per refresh. Collector failures leave its health fields unavailable without changing machine states. Cycle times and the worst cavity for the current order come from `GET /api/machines/status`. No Euromap cycle count is turned into good pieces: cavity count, cycle resets, and order assignment must be validated first.

Cyclades' own per-cycle traceability table is a separate feed from the Euromap63 collector in this repository. The local `pi_cyclades` inventory at commit `7a291d8` found traceability rows only for `P1100-03` as of 2026-09-24. It does not expand cycle coverage to the other presses or establish an hourly good-piece count. See [ciclades-mapping.md](ciclades-mapping.md).

## Connect shift KPIs

Set `MES_PROVIDER=ciclades`, supply a read-only SQL Server DSN and a reviewed JSON query mapping as described in [ciclades-mapping.md](ciclades-mapping.md). Create a `Machine` for each press in the admin page with `mes_id` equal to its Ciclades `MAC_REFMAC`, correct pieces per cycle and ideal cycle time, and `SHOW IN PLANT OVERVIEW` enabled. Create a Display mapping for presses that need this app's hourly/imprint drilldown. Unconfigured presses can still link to the existing Euromap63 detail page if `EUROMAP63_FRONTEND_URL` is set.

The current SQL adapter requires **hourly interval totals**. `pi_cyclades` identifies `Resultat_equipe` as a shift result source, while `BILAN_SAISIE_EQUIPE` is a series of **cumulative declarations within a shift**. Those rows cannot be summed directly into hours. `LIGOF` is cumulative across an entire order, not a shift. Before deploying KPI calculations, validate interval deltas, reset/changeover handling, timestamp timezone, overnight shift attribution, cycle/cavity changes and scrap denominator against known Ciclades reports. Confirm whether the existing report `TRS` should match this app's OEE formula. Leave KPI cells unavailable until that mapping is verified.

## Deployment checks

1. `GET /api/fleet/dashboard` returns 20 presses sorted by numeric tonnage and press suffix, with `live_source=euromap63` when connected.
2. Verify `P2700-01` joins to Euromap `KM-MC5-01` by `cyclades_mac_refmac` and its detail link opens the correct machine.
3. Compare a running press, a stopped press, a press without an order, and an unknown press against the existing Euromap63 hall view.
4. Compare good pieces, scrap, downtime and OEE for one morning and one overnight shift against a validated Ciclades report before trusting all 20 KPI cards.
5. Check `/fleet` at the actual shop-floor display resolution and viewing distance. The screen is designed for 1920×1080 with 20 cards; smaller viewports scroll.
