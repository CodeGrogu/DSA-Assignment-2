set -uo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not inside a git repo"; exit 2; }
cd "$ROOT"
ENV_FILE="postman/environments/local.environment.yaml"
command -v postman >/dev/null 2>&1 || { echo "Postman CLI not found. Install it, then run: postman login"; exit 2; }
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 2; }
[[ -n "${POSTMAN_API_KEY:-}" ]] && postman login --with-api-key "$POSTMAN_API_KEY" >/dev/null

echo "Waiting for services (up to 90s)..."
for port in 9091 9093 9094 9095 9096 9097 9098; do
  ok=0
  for _ in $(seq 1 45); do
    curl -fsS "http://localhost:$port/health" >/dev/null 2>&1 && { ok=1; break; }
    sleep 2
  done
  [[ $ok -eq 1 ]] || { echo "Service on port $port is not healthy. Run: docker compose up -d"; exit 2; }
done

postman environment lint "$ENV_FILE" || exit 1
fail=0
for dir in postman/collections/*/; do
  echo; echo "=== $(basename "$dir")"
  postman collection lint "$dir" || fail=1
  postman collection run "$dir" -e "$ENV_FILE" || fail=1
done
[[ $fail -eq 0 ]] && echo "ALL POSTMAN COLLECTIONS PASSED" || echo "SOME POSTMAN COLLECTIONS FAILED"
exit $fail

