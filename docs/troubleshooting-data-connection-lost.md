# "DATA CONNECTION LOST" on spc-vm

Seen three times; the cause confirmed on 2026-10-08 was a wrong deploy command.

## Symptom
The display shows `DATA CONNECTION LOST` / the stale banner. In the backend logs:

- `dashboard calculation failed display=...` / `hourly overview calculation failed display=...`
- `Euromap63 live status unavailable`
- `/api/displays/<id>/dashboard` and `/hourly-overview` return **503**; `/api/fleet/dashboard` still returns 200.

## Cause
The backend must be attached to **two** networks: `pi_slx_default` and the external `euromap63-docker_default`
(that is where `euromap63_api` lives). The second network comes only from the override file `deploy/spc-vm.compose.yml`.

A plain `docker compose up -d --build` ignores the override, so the recreated backend is only on `pi_slx_default`.
It then cannot resolve `euromap63_api`: `httpx.ConnectError: [Errno -3] Temporary failure in name resolution`,
and every Euromap63 based endpoint answers 503. The frontend reports that as connection lost.

## Fix
Always deploy on the VM with the script (it passes both compose files):

```
ssh spc-vm "cd ~/pi_slx && bash deploy/spc-vm.sh"
```

Never `docker compose up/build` without `-f docker-compose.yml -f deploy/spc-vm.compose.yml`.

## Check
```
ssh spc-vm "docker inspect pi_slx-backend-1 --format '{{json .NetworkSettings.Networks}}'"   # must list both networks
ssh spc-vm "docker ps --format '{{.Names}}\t{{.Status}}' | grep euromap63_api"                # must be Up
```
If both are fine, the cause is something else (e.g. `euromap63_api` down) – look at its container logs.

## Debugging note
`JsonFormatter` in `backend/app/main.py` used to drop `exc_info`, so `log.exception(...)` printed no traceback.
It now adds an `exception` field, so the real error is visible in `docker compose logs backend`.
Older builds: call the builder in `docker compose exec backend python`
(`PYTHONPATH=/app`, `SessionLocal` from `app.db.session`, `build_euromap_shift(...)`).
