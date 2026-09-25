# Production Efficiency Dashboard

Shop-floor dashboard for production status and shift observations. The factory VM reads the existing Euromap63 Docker API; local development can still use a simulated MES provider. Direct Ciclades SQL integration is optional and requires a verified site query mapping.

## Quick start on Ubuntu

```bash
git clone https://github.com/kamikadze9036/pi_slx.git
cd pi_slx
cp .env.example .env
# Edit POSTGRES_PASSWORD and ADMIN_API_KEY in .env.
docker compose up -d --build
```

For the factory VM (`spc-vm`), deploy the `codex/plant-overview` branch into
`~/pi_slx` and run `bash deploy/spc-vm.sh`. The script creates a private `.env`
on first run, exposes port `8088`, and joins the backend to the existing
Euromap63 Docker network for live machine state, recorded cycles, and observed stop intervals. The factory VM does not display simulated production counts.

Open `http://SERVER/fleet` for the 20-press plant overview, `http://SERVER/display/demo` for the hourly production display, `http://SERVER/display/demo/imprint` for the chronological shift imprint, and `http://SERVER/admin` for configuration. Admin can select which machines appear in the plant overview and set each display's default dashboard type and dark or light theme. The explicit `/hourly` and `/imprint` URLs remain available for either view. Append `?theme=light` or `?theme=dark` to a display or fleet URL for a temporary visual comparison without changing the saved setting. `HTTP_PORT` in `.env` changes the exposed web port (the local Windows demo uses `8088`). The frontend proxies `/api` to the backend; PostgreSQL and the backend are not exposed on the host. Admin writes require the `ADMIN_API_KEY` entered on the admin page. Keep the app inside a trusted LAN until a site authentication and HTTPS proxy are installed.

Both display views have previous/next shift navigation. The selected shift is kept when switching between hourly records and the shift imprint. In Euromap63 mode they show recorded machine cycles where the press has its own collector. For other presses they show increases from Euromap63's sampled machine counter when available, plus observed stop intervals. The current shift also shows current machine state, order and cycle time separately from shift history. A cycle or counter increase is not a good piece, and gaps or sampled state events do not provide complete OEE, scrap, or precise downtime at shift boundaries. Unavailable values are shown as such. The minutes/pieces toggle is available only for providers with verified piece totals. The API accepts an offset-aware `shift_start` query parameter; omitting it selects the active or most recently completed scheduled shift.

`docker compose logs -f backend` shows startup and errors. `docker compose down` stops services without deleting configuration. To run tests in the backend image:

```bash
docker compose run --rm -e MES_PROVIDER=mock backend pytest -q
```

The backend runs Alembic migrations before starting. A fresh database receives three shifts and Display ID `demo`. In Euromap63 mode, the display points to press `P2700-01` with the light theme, and the 20-press catalog is configured without synthetic cycle settings. Existing customized display mappings are preserved. Mock mode remains available for local development.
The admin page also controls the dashboard refresh interval, visible summary KPI tiles, and the OEE warning threshold.

## How it works

- `/display/{id}` looks up the server-side machine mapping for that display, polls the dashboard API, and sends a heartbeat every 15 seconds.
- The backend selects the active shift in `SITE_TIMEZONE`, including overnight shifts, and splits it into elapsed hourly intervals.
- `MockMesDataProvider` generates a repeatable, live shift profile. Counts in the current hour grow as time passes.
- The KPI engine calculates good time, scrap-equivalent time, speed loss, micro stops, and downtime. The API provides precomputed bars and KPI values so the kiosk does little work.
- The shift imprint shows a chronological machine-state track, hourly good/target/scrap output, stop reasons, and reported scrap reasons. Its event track is intentionally different from the category-aggregated bars on the hourly screen.
- In Euromap63 mode, the plant overview shows real state, order, cycle time, current-order worst-cavity scrap and collector health, without simulated shift KPIs. The shift views use `/api/cycles`, `/api/cycles/cyclades-derived`, and `/api/downtimes` from that same service. See [docs/fleet-integration.md](docs/fleet-integration.md).
- MES snapshots are cached for five seconds per machine and shift. When the source fails, the last valid snapshot is returned as stale and the display shows a connection warning.
- Admin settings reside in PostgreSQL; MES production history is not copied there.

The display uses one contiguous segment per loss category. Segments are aggregated by type, not placed in event chronology. Future time in the current hour remains dark and is excluded from KPI calculations. An unavailable ideal cycle produces `insufficient_data` and an unknown segment instead of invented OEE.

## Configuration

| Variable | Purpose |
| --- | --- |
| `MES_PROVIDER` | `euromap63` on the factory VM; `mock` for local demo or `ciclades` for a validated direct SQL mapping |
| `SITE_TIMEZONE` | IANA timezone, default `Europe/Prague` |
| `POLL_SECONDS` | Dashboard refresh period, default `10` |
| `POSTGRES_*` | Configuration database credentials |
| `ADMIN_API_KEY` | Key for admin read/write endpoints |
| `CICLADES_DSN` | SQLAlchemy SQL Server DSN using a read-only login |
| `CICLADES_MAPPING_FILE` | Container path to JSON with site-approved SELECT queries |
| `EUROMAP63_API_URL` | Optional backend URL for existing Euromap63 live state API, e.g. `http://host.docker.internal:8091` |
| `EUROMAP63_FRONTEND_URL` | Optional browser URL for its per-machine detail page, e.g. `http://VM-IP:8092` |

To enable Ciclades, provide the mapping described in [docs/ciclades-mapping.md](docs/ciclades-mapping.md) and mount the approved file into the backend container. No Ciclades tables or columns are assumed by this repository.

## API

`GET /api/health`, `GET /api/fleet/dashboard`, `GET /api/displays/{id}`, `GET /api/displays/{id}/dashboard`, `GET /api/displays/{id}/shift-imprint`, `POST /api/displays/{id}/heartbeat`, `GET /api/machines`, `GET /api/machines/{id}`, `GET /api/machines/{id}/current-shift`, `GET /api/machines/{id}/shift/{shift_id}`, `GET /api/config/shifts`, and `GET /api/config/dashboard-settings` are available. `GET /api/admin/displays`, `PUT /api/admin/{machines|shifts|displays}/{id}`, and `PUT /api/admin/dashboard-settings` require the `X-Admin-Key` header. FastAPI's interactive schema is available inside the backend network at `/docs`.

## Development

The container build is the supported path. For local development, start PostgreSQL, set `DATABASE_URL` and `ADMIN_API_KEY`, then run `alembic upgrade head` and `uvicorn app.main:app --reload` from `backend/`. Run `npm install && npm run dev` from `frontend/`; Vite proxies API traffic to localhost:8000.

See [docs/architecture.md](docs/architecture.md) for calculation and deployment notes and [docs/raspberry-pi-kiosk.md](docs/raspberry-pi-kiosk.md) for a kiosk example.
