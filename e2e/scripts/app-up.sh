#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

BUILD_ID="${BUILD_NUMBER:-local}"
IMAGE_TAG="${BUILD_NUMBER:-$(git rev-parse --short HEAD 2>/dev/null || echo local)}"
DIRTY=""
if [[ -z "${BUILD_NUMBER:-}" && -z "${E2E_IMAGE:-}" && -n "$(git status --porcelain 2>/dev/null)" ]]; then
    DIRTY=1
    IMAGE_TAG="${IMAGE_TAG}-dirty"
fi
export E2E_IMAGE="${E2E_IMAGE:-gripello:e2e-${IMAGE_TAG}}"
export COMPOSE_PROJECT_NAME="gripello-e2e-${BUILD_ID}"

if [[ -n "$DIRTY" || "$(docker images -q "$E2E_IMAGE" 2>/dev/null)" == "" ]]; then
    echo "[e2e] building $E2E_IMAGE ..."
    docker buildx build --platform linux/amd64 --load -t "$E2E_IMAGE" .
fi

docker volume inspect gripello-e2e-yarn-cache >/dev/null 2>&1 || docker volume create gripello-e2e-yarn-cache >/dev/null

docker compose -p "$COMPOSE_PROJECT_NAME" -f e2e/docker-compose.e2e.yml down -v --remove-orphans >/dev/null 2>&1 || true
docker compose -p "$COMPOSE_PROJECT_NAME" -f e2e/docker-compose.e2e.yml up \
    --abort-on-container-exit --exit-code-from e2e
