set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not inside a git repo"; exit 2; }
cd "$ROOT"
ENV_FILE="postman/environments/local.postman_environment.json"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE. Run: node scripts/build-postman-collections.mjs"; exit 2; }
if command -v bunx >/dev/null 2>&1; then NEWMAN=(bunx newman)
elif command -v npx >/dev/null 2>&1; then NEWMAN=(npx --yes newman)
else echo "Install Node.js (npx) or Bun (bunx) to run Newman."; exit 2; fi

echo "Waiting for services (up to 90s)..."
for port in 9091 9093 9094 9095 9096 9097 9098; do
  ok=0
  for _ in $(seq 1 45); do
    curl -fsS "http://localhost:$port/health" >/dev/null 2>&1 && { ok=1; break; }
    sleep 2
  done
  [[ $ok -eq 1 ]] || { echo "Service on port $port is not healthy. Run: docker compose up -d"; exit 2; }
done

fail=0
for file in postman/*.postman_collection.json; do
  echo; echo "=== $(basename "$file" .postman_collection.json)"
  "${NEWMAN[@]}" run "$file" -e "$ENV_FILE" --reporters cli || fail=1
done
[[ $fail -eq 0 ]] && echo "ALL POSTMAN COLLECTIONS PASSED" || echo "SOME POSTMAN COLLECTIONS FAILED"
exit $fail
