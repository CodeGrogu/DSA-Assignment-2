#!/usr/bin/env bash
# Runs every Postman collection with Newman (no Postman account or API key needed).
# The restaurants collection (POST /seed) always runs first.
# Prereqs: platform running:
#   docker compose -f docker-compose.infra.yml up -d --wait
#   docker compose -f docker/docker-compose.services.yml up -d
# and newman (global), Bun (bunx) or Node.js (npx).
# Exit: 0 all pass | 1 a collection failed | 2 prerequisites missing
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not inside a git repo"; exit 2; }
cd "$ROOT"
ENV_FILE="postman/environments/local.postman_environment.json"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE. Run: node scripts/build-postman-collections.mjs"; exit 2; }

if command -v newman >/dev/null 2>&1; then NEWMAN=(newman)
elif command -v bunx >/dev/null 2>&1; then NEWMAN=(bunx newman)
elif command -v npx >/dev/null 2>&1; then NEWMAN=(npx --yes newman)
else echo "Install newman (npm i -g newman), Bun (bunx) or Node.js (npx)."; exit 2; fi

UP="docker compose -f docker-compose.infra.yml up -d --wait && docker compose -f docker/docker-compose.services.yml up -d"
echo "Waiting for services (up to 90s)..."
for port in 9091 9093 9094 9095 9096 9097 9098; do
  ok=0
  for _ in $(seq 1 45); do
    curl -fsS "http://localhost:$port/health" >/dev/null 2>&1 && { ok=1; break; }
    sleep 2
  done
  [[ $ok -eq 1 ]] || { echo "Service on port $port is not healthy. Run: $UP"; exit 2; }
done

files=("postman/restaurants.postman_collection.json")
for f in postman/*.postman_collection.json; do
  [[ "$f" == "postman/restaurants.postman_collection.json" ]] || files+=("$f")
done

fail=0
for file in "${files[@]}"; do
  echo; echo "=== $(basename "$file" .postman_collection.json)"
  "${NEWMAN[@]}" run "$file" -e "$ENV_FILE" --reporters cli || fail=1
done
[[ $fail -eq 0 ]] && echo "ALL POSTMAN COLLECTIONS PASSED" || echo "SOME POSTMAN COLLECTIONS FAILED"
exit $fail