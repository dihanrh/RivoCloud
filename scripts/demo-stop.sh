#!/usr/bin/env bash
# Stops exactly the processes scripts/demo.sh started (PIDs in .demo/pids).
#   bash scripts/demo-stop.sh           stop apps
#   bash scripts/demo-stop.sh --infra   also `docker compose stop` the infra containers
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PID_FILE=".demo/pids"

kill_tree() {
  local pid="$1"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      # $pid is an MSYS pid; taskkill needs the Windows pid. /T also takes down child processes.
      local win="$pid"
      [ -r "/proc/$pid/winpid" ] && win="$(cat "/proc/$pid/winpid")"
      cmd //c "taskkill /PID $win /T /F" >/dev/null 2>&1 || true
      ;;
    *)
      local kids k
      kids="$(pgrep -P "$pid" 2>/dev/null || true)"
      for k in $kids; do kill_tree "$k"; done
      kill "$pid" 2>/dev/null || true
      ;;
  esac
}

if [ -f "$PID_FILE" ]; then
  while read -r name pid; do
    [ -n "${pid:-}" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "[demo-stop] stopping $name ($pid)"
      kill_tree "$pid"
    fi
  done <"$PID_FILE"
  : >"$PID_FILE"
else
  echo "[demo-stop] no $PID_FILE; nothing to stop"
fi

if [ "${1:-}" = "--infra" ]; then
  echo "[demo-stop] stopping infra containers"
  docker compose -f infrastructure/compose/docker-compose.infra.yml stop redis minio clickhouse nats postgres 2>/dev/null || true
  docker stop rivocloud-test-postgres-5433 >/dev/null 2>&1 || true
fi
echo "[demo-stop] done"
