#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose -f infrastructure/compose/docker-compose.infra.yml up -d

echo ""
echo "Infra services starting. Check status with:"
echo "  docker compose -f infrastructure/compose/docker-compose.infra.yml ps"
echo ""
echo "Postgres  -> localhost:5432 (db: rivocloud, user: rivocloud)"
echo "Redis     -> localhost:6379"
echo "MinIO     -> http://localhost:9000 (console: http://localhost:9001)"
echo "ClickHouse-> http://localhost:8123"
echo "NATS      -> localhost:4222 (monitor: http://localhost:8222)"
echo "Prometheus-> http://localhost:9090"
echo "Grafana   -> http://localhost:3002"
echo "Loki      -> http://localhost:3100"
