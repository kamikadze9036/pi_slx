#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  umask 077
  cat > .env <<EOF
POSTGRES_DB=production_dashboard
POSTGRES_USER=dashboard
POSTGRES_PASSWORD=$(openssl rand -hex 32)
ADMIN_API_KEY=$(openssl rand -hex 32)
MES_PROVIDER=euromap63
SITE_TIMEZONE=Europe/Prague
POLL_SECONDS=10
VITE_APP_VERSION=0.1.0
HTTP_PORT=8088
EUROMAP63_API_URL=http://euromap63_api:8000
EUROMAP63_FRONTEND_URL=http://172.24.0.191:8092
EOF
fi

docker compose -f docker-compose.yml -f deploy/spc-vm.compose.yml up -d --build
