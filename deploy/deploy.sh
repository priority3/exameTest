#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

echo "[deploy] pulling images"
docker compose -f "$COMPOSE_FILE" pull

echo "[deploy] running migrations"
docker compose -f "$COMPOSE_FILE" run --rm migrate

echo "[deploy] restarting services"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

echo "[deploy] pruning unused images"
docker image prune -f >/dev/null 2>&1 || true

echo "[deploy] done"

