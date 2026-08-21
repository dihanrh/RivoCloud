#!/usr/bin/env bash
set -euo pipefail

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

# -p publishes the proxy's own listen port so `go run`/`dev` are reachable
# from the host during manual verification (Task 9); it's a harmless no-op
# for commands that don't bind a port, like `go test`/`go build`/`go vet`.
docker run --rm \
  -p "${CONTAINER_PORT}:${CONTAINER_PORT}" \
  -v "${WIN_REPO_ROOT}://workspace" \
  -w "//workspace/apps/edge-proxy" \
  -e CGO_ENABLED=0 \
  -e GOFLAGS=-mod=mod \
  -e REDIS_URL="${CONTAINER_REDIS_URL}" \
  -e EDGE_PROXY_PORT="${CONTAINER_PORT}" \
  -e EDGE_PROXY_DEMO_ORIGIN_URL="${CONTAINER_ORIGIN_URL}" \
  -e EDGE_PROXY_L1_MAX_ENTRIES="${EDGE_PROXY_L1_MAX_ENTRIES:-}" \
  golang:1.23-alpine \
  "$@"
