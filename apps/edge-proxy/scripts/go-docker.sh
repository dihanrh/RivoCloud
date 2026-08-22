#!/usr/bin/env bash
set -euo pipefail

if [ -n "${CI:-}" ]; then
  # GitHub Actions runners have a native Go toolchain (actions/setup-go) —
  # skip Docker entirely there. The Docker wrapper below only exists to work
  # around this dev machine having no native Go toolchain.
  exec "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
WIN_REPO_ROOT="$(cygpath -w "$REPO_ROOT" 2>/dev/null || echo "$REPO_ROOT")"

# Containers can't reach the host (Redis, or the manual-verification origin
# server) via "localhost" — Docker Desktop exposes the host as
# host.docker.internal instead. Local-dev-only workaround for this machine
# having no native Go toolchain; CI runs Go natively via actions/setup-go,
# where localhost is correct as-is.
rewrite_localhost() {
  local value="${1:-}"
  value="${value/127.0.0.1/host.docker.internal}"
  value="${value/localhost/host.docker.internal}"
  echo "$value"
}

CONTAINER_REDIS_URL="$(rewrite_localhost "${REDIS_URL:-redis://localhost:6379}")"
CONTAINER_ORIGIN_URL="$(rewrite_localhost "${EDGE_PROXY_DEMO_ORIGIN_URL:-http://localhost:9999}")"
CONTAINER_PORT="${EDGE_PROXY_PORT:-8888}"

DOCKER_ARGS=(
  --rm
  -v "${WIN_REPO_ROOT}://workspace"
  -w "//workspace/apps/edge-proxy"
  -e CGO_ENABLED=0
  -e GOFLAGS=-mod=mod
  -e REDIS_URL="${CONTAINER_REDIS_URL}"
  -e EDGE_PROXY_PORT="${CONTAINER_PORT}"
  -e EDGE_PROXY_DEMO_ORIGIN_URL="${CONTAINER_ORIGIN_URL}"
  -e EDGE_PROXY_L1_MAX_ENTRIES="${EDGE_PROXY_L1_MAX_ENTRIES:-}"
)

# Only `go run` binds a port something outside the container needs to reach
# (manual verification, Task 9) — publish it only then. Publishing
# unconditionally would make concurrent `lint`/`typecheck`/`test:unit`
# invocations (turbo may run a package's own tasks concurrently — none of
# them declare a dependsOn ordering against each other) race for the same
# host port and fail with "address already in use".
if [ "${1:-}" = "go" ] && [ "${2:-}" = "run" ]; then
  DOCKER_ARGS+=(-p "${CONTAINER_PORT}:${CONTAINER_PORT}")
fi

docker run "${DOCKER_ARGS[@]}" golang:1.23-alpine "$@"
