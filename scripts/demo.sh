#!/usr/bin/env bash
# One-command RivoCloud demo: infra (Docker) + 5 Nest services + dashboard + seed data.
#   bash scripts/demo.sh            start everything (idempotent) and seed
#   bash scripts/demo-stop.sh       stop what this script started
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DEMO_DIR="$ROOT/.demo"
LOG_DIR="$DEMO_DIR/logs"
PID_FILE="$DEMO_DIR/pids"
COMPOSE=(docker compose -f infrastructure/compose/docker-compose.infra.yml)
mkdir -p "$LOG_DIR"
touch "$PID_FILE"

say() { printf '\033[1;36m[demo]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[demo] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- environment ----------
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1090
  . <(tr -d '\r' < .env)
  set +a
fi
default() { local n="$1" v="$2"; if [ -z "${!n:-}" ]; then export "$n=$v"; else export "$n"; fi; }
default DATABASE_URL "postgresql://rivocloud:rivocloud_dev_password@localhost:5432/rivocloud"
default REDIS_URL "redis://localhost:6379"
default NATS_URL "nats://localhost:4222"
default CLICKHOUSE_URL "http://localhost:8123"
default MINIO_URL "http://localhost:9000"
default MINIO_ROOT_USER "rivocloud"
default MINIO_ROOT_PASSWORD "rivocloud_dev_password"
# Must equal MINIO_NOTIFY_WEBHOOK_AUTH_TOKEN_STORAGE in docker-compose.infra.yml so MinIO's own webhook is accepted.
default MINIO_WEBHOOK_AUTH_TOKEN "dev_minio_webhook_token_change_me"
default ZONE_SECRET_ENCRYPTION_KEY "0000000000000000000000000000000000000000000000000000000000000000"
default INTERNAL_API_SECRET "dev_internal_secret_change_me_please_1234"
default JWT_PRIVATE_KEY_PATH "./keys/private.pem"
default JWT_PUBLIC_KEY_PATH "./keys/public.pem"
default IDENTITY_SERVICE_URL "http://localhost:3001"
default CDN_SERVICE_URL "http://localhost:3003"
default STORAGE_SERVICE_URL "http://localhost:3004"
default ANALYTICS_SERVICE_URL "http://localhost:3006"
default SCHEDULER_SERVICE_URL "http://localhost:3005"
# Seeding logs in 4 users and calls hot endpoints; the 10/min auth limit would trip it.
export RATE_LIMIT_ENABLED=false
# Shows the "Demo accounts" quick-fill panel on the dashboard login page.
export NEXT_PUBLIC_DEMO_MODE=true
# Override if something else already owns :3000, e.g. DASHBOARD_PORT=3010 bash scripts/demo.sh
DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"

# ---------- helpers ----------
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
http_ok() { curl -fsS -o /dev/null --max-time 3 "$1" 2>/dev/null; }
wait_for() { # name, timeout_s, command...
  local name="$1" t="$2"; shift 2
  local i=0
  until "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -ge "$t" ] && die "$name did not become ready in ${t}s"
    sleep 1
  done
  say "$name ready"
}

# ---------- docker / infra ----------
docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop and retry."

PG_PORT="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://[^@]*@[^:/]+:([0-9]+).*#\1#')"
case "$PG_PORT" in ''|*[!0-9]*) PG_PORT=5432 ;; esac
SERVICES=(redis minio clickhouse nats)

if [ "$PG_PORT" = "5432" ]; then
  port_open 5432 || SERVICES+=(postgres)
elif ! port_open "$PG_PORT"; then
  say "Starting standalone Postgres container on port $PG_PORT"
  if [ "$PG_PORT" = "5433" ] && docker inspect rivocloud-test-postgres-5433 >/dev/null 2>&1; then
    docker start rivocloud-test-postgres-5433 >/dev/null
  else
    docker rm -f "rivocloud-demo-postgres-$PG_PORT" >/dev/null 2>&1 || true
    docker run -d --name "rivocloud-demo-postgres-$PG_PORT" -p "$PG_PORT:5432" \
      -e POSTGRES_USER=rivocloud -e POSTGRES_PASSWORD=rivocloud_dev_password -e POSTGRES_DB=rivocloud \
      postgres:16-alpine >/dev/null
  fi
fi

say "Starting infra containers: ${SERVICES[*]}"
"${COMPOSE[@]}" up -d "${SERVICES[@]}" >/dev/null

wait_for "Postgres ($PG_PORT)" 90 port_open "$PG_PORT"
wait_for "Redis" 60 port_open 6379
wait_for "ClickHouse" 90 http_ok "http://127.0.0.1:8123/ping"
wait_for "MinIO" 90 http_ok "http://127.0.0.1:9000/minio/health/live"

# ---------- migrations / keys ----------
if [ ! -f apps/identity-service/keys/private.pem ]; then
  say "Generating JWT keys"
  (cd apps/identity-service && node scripts/generate-jwt-keys.cjs)
fi

say "Running database migrations"
migrated=0
for attempt in 1 2 3 4 5 6; do
  if pnpm --filter @rivocloud/db migrate:deploy >"$LOG_DIR/migrate.log" 2>&1; then
    migrated=1
    break
  fi
  sleep 3
done
if [ "$migrated" != 1 ]; then
  tail -20 "$LOG_DIR/migrate.log" >&2
  die "migrations failed (see $LOG_DIR/migrate.log)"
fi

# ---------- apps ----------
# Services run through vite-node (apps/*/vite-node.config.ts, SWC): tsx/esbuild emits no
# decorator metadata, which NestJS constructor injection needs.
start_app() { # name, dir, port, health_path, command...
  local name="$1" dir="$2" port="$3" hp="$4"
  shift 4
  if http_ok "http://127.0.0.1:$port$hp"; then
    say "$name already up on :$port (skipping start)"
    return 0
  fi
  if port_open "$port"; then die "port $port is in use by something that is not $name"; fi
  say "Starting $name on :$port"
  (
    cd "$ROOT/$dir"
    PORT="$port" nohup "$@" >"$LOG_DIR/$name.log" 2>&1 &
    echo "$name $!" >>"$PID_FILE"
  )
}

VN=(node node_modules/vite-node/vite-node.mjs -c vite-node.config.ts --watch src/main.ts)
start_app identity-service  apps/identity-service  3001 /api/v1/health "${VN[@]}"
start_app analytics-service apps/analytics-service 3006 /api/v1/health "${VN[@]}"
start_app cdn-service       apps/cdn-service       3003 /api/v1/health "${VN[@]}"
start_app storage-service   apps/storage-service   3004 /api/v1/health "${VN[@]}"
start_app scheduler         apps/scheduler         3005 /api/v1/health "${VN[@]}"
start_app dashboard         apps/dashboard         "$DASHBOARD_PORT" /login node node_modules/next/dist/bin/next dev -p "$DASHBOARD_PORT"

for pair in identity-service:3001:/api/v1/health analytics-service:3006:/api/v1/health cdn-service:3003:/api/v1/health \
            storage-service:3004:/api/v1/health scheduler:3005:/api/v1/health dashboard:$DASHBOARD_PORT:/login; do
  IFS=: read -r n p h <<<"$pair"
  wait_for "$n" 240 http_ok "http://127.0.0.1:$p$h"
done

# ---------- seed ----------
say "Seeding demo data"
DASHBOARD_URL="http://localhost:$DASHBOARD_PORT" node scripts/seed-demo.mjs

cat <<MSG

  RivoCloud demo is up:  http://localhost:$DASHBOARD_PORT
  Logs:                  .demo/logs/     Stop:  bash scripts/demo-stop.sh [--infra]

  owner@demo.rivo / admin@demo.rivo / dev@demo.rivo / viewer@demo.rivo
  Password for all:      DemoPass123!
MSG
