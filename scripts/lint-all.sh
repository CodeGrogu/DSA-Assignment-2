#!/usr/bin/env bash
# scripts/lint-all.sh
# Standard monorepo linting and static analysis suite.

set -euo pipefail

echo "================================================================="
echo "       Monorepo Static Analysis & Linting Suite                  "
echo "================================================================="

echo "[1/3] Validating Docker Compose configurations..."
if [ -f "docker-compose.infra.yml" ]; then
    docker compose -f docker-compose.infra.yml config -q
    echo "  [PASS] docker-compose.infra.yml is valid."
fi

if [ -f "docker/docker-compose.services.yml" ]; then
    docker compose -f docker/docker-compose.services.yml config -q
    echo "  [PASS] docker/docker-compose.services.yml is valid."
fi

if [ -f "docker-compose-monitoring.yml" ]; then
    docker compose -f docker-compose-monitoring.yml config -q
    echo "  [PASS] docker-compose-monitoring.yml is valid."
fi

echo "[2/3] Checking Ballerina code formatting..."
bash scripts/format-all.sh --check

echo "[3/3] Validating Postman collections and environments..."
if command -v bun >/dev/null 2>&1; then
    bun scripts/validate-postman.mjs
elif command -v node >/dev/null 2>&1; then
    node scripts/validate-postman.mjs
else
    echo "  [FAIL] Neither bun nor node is installed to run validate-postman.mjs." >&2
    exit 1
fi
echo "  [PASS] All Postman collections and environments passed validation."

