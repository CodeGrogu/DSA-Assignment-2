#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_URL="${BASE_URL:-http://localhost}"

for command in curl node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$command" >&2
    exit 2
  fi
done

check_health() {
  local service="$1"
  local port="$2"
  local response
  response="$(curl --fail --silent --show-error --max-time 5 "$BASE_URL:$port/health")" || {
    printf 'Health check failed: %s on port %s\n' "$service" "$port" >&2
    return 1
  }
  printf '%s' "$response" | node -e '
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => body += chunk);
    process.stdin.on("end", () => {
      const [expectedService, expectedPort] = process.argv.slice(1);
      try {
        const health = JSON.parse(body);
        if (health.status !== "UP" || health.service !== expectedService ||
            Number(health.port) !== Number(expectedPort)) {
          throw new Error("unexpected health response");
        }
        console.log(`${health.service} :${health.port} ${health.status}`);
      } catch (error) {
        console.error(`Invalid health response for ${expectedService}: ${error.message}`);
        process.exitCode = 1;
      }
    });
  ' "$service" "$port"
}

printf '%s\n' '== Health checks =='
check_health order_service 9091
check_health customer_service 9093
check_health payment_service 9094
check_health restaurant_service 9095
check_health delivery_service 9096
check_health notification_service 9097
check_health admin_service 9098

printf '%s\n' '== Customer address verification =='
address_payload='{"customerId":"cust-defense","address":{"id":"addr-defense","tag":"Home","street":"12 Independence Avenue","city":"Windhoek","state":"Khomas","postalCode":"9000","location":{"type":"Point","coordinates":[17.0658,-22.5609]},"deliveryInstructions":"","isDefault":true}}'
address_response="$(curl --fail --silent --show-error --max-time 10 \
  -X POST "$BASE_URL:9093/customers/verifyAddress" \
  -H 'Content-Type: application/json' --data-binary "$address_payload")"
printf '%s' "$address_response" | node -e '
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => body += chunk);
  process.stdin.on("end", () => {
    try {
      const result = JSON.parse(body);
      if (result.valid !== true || result.withinDeliveryRange !== true) {
        throw new Error("address was not accepted within the delivery range");
      }
      console.log(`valid=${result.valid}; withinDeliveryRange=${result.withinDeliveryRange}; distanceKm=${result.distanceKm}`);
    } catch (error) {
      console.error(`Address verification failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
'

printf '%s\n' '== Surge quote =='
quote_response="$(curl --fail --silent --show-error --max-time 10 \
  "$BASE_URL:9091/pricing/quote?unfulfilledOrders=40&availableDrivers=10")"
printf '%s' "$quote_response" | node -e '
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => body += chunk);
  process.stdin.on("end", () => {
    try {
      const quote = JSON.parse(body);
      if (quote.tier !== "SURGE") throw new Error(`expected SURGE tier, received ${quote.tier}`);
      console.log(JSON.stringify(quote));
    } catch (error) {
      console.error(`Surge quote failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
'

printf '%s\n' '== Create and retrieve an order =='
order_payload='{"customerId":"cust-defense","restaurantId":"R001","items":[{"itemId":"M1","name":"Beef Kapana","quantity":1,"price":50}],"deliveryAddress":{"street":"12 Independence Avenue","city":"Windhoek","state":"Khomas","postalCode":"9000"}}'
created_order="$(curl --fail --silent --show-error --max-time 10 \
  -X POST "$BASE_URL:9091/orders" \
  -H 'Content-Type: application/json' --data-binary "$order_payload")"
order_id="$(printf '%s' "$created_order" | node -e '
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => body += chunk);
  process.stdin.on("end", () => {
    try {
      const order = JSON.parse(body);
      if (!order.orderId) throw new Error("response is missing orderId");
      console.log(order.orderId);
    } catch (error) {
      console.error(`Order creation failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
')"
printf 'created order: %s\n' "$order_id"
retrieved_order="$(curl --fail --silent --show-error --max-time 10 "$BASE_URL:9091/orders/$order_id")"
printf '%s' "$retrieved_order" | node -e '
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => body += chunk);
  process.stdin.on("end", () => {
    try {
      const order = JSON.parse(body);
      if (!order.orderId || !order.status) throw new Error("response is missing order identity or status");
      console.log(`orderId=${order.orderId}; currentStatus=${order.status}; totalAmount=${order.totalAmount}`);
    } catch (error) {
      console.error(`Order retrieval failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
'

printf '%s\n' '== Admin overview (seed-file-backed) =='
curl --fail --silent --show-error --max-time 10 "$BASE_URL:9098/admin/stats/overview"
printf '\n'

printf '%s\n' '== Deterministic validation failure and recovery check =='
invalid_order='{"customerId":"cust-defense","restaurantId":"R001","items":[{"itemId":"M1","name":"Beef Kapana","quantity":0,"price":50}],"deliveryAddress":{"street":"12 Independence Avenue","city":"Windhoek","state":"Khomas","postalCode":"9000"}}'
failure_status="$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' \
  -X POST "$BASE_URL:9091/orders" \
  -H 'Content-Type: application/json' --data-binary "$invalid_order")"
if [[ "$failure_status" != "400" ]]; then
  printf 'Expected HTTP 400 for quantity=0; received HTTP %s\n' "$failure_status" >&2
  exit 1
fi
printf 'invalid order correctly rejected with HTTP %s\n' "$failure_status"
check_health order_service 9091

cat <<'EOF'

Supported API slice completed.
This runner does NOT claim payment, kitchen-ready, driver dispatch/transit,
delivery completion, or notification were completed end-to-end. See
docs/defense/master_demonstration_runbook.md for the verified implementation
boundaries and defense-day go/no-go checks.
EOF
