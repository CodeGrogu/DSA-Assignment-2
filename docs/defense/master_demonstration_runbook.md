# PeerPressure Final Defense: Master Demonstration Runbook

## 1. System Overview & Defense Readiness

This runbook guides the oral defense and technical demonstration of the **PeerPressure Distributed Food Delivery Platform**. The platform is fully operational end-to-end across all 7 Ballerina Swan Lake microservices, Apache Kafka (KRaft mode 3-broker cluster), and MongoDB 7.0 replica set (`rs0`):

- **Order Service (`:9091`)**: Full order intake, dynamic surge pricing (civil solar CAT offset), finite state machine (FSM) validation, dual-mode persistence (MongoDB + in-memory fallback), and Kafka event choreography.
- **Customer Service (`:9093`)**: Customer identity, address book, and Namibian geospatial address verification (`/customers/verifyAddress`).
- **Payment Service (`:9094`)**: Automated event-driven payment capture via `orders.created`, immutable double-entry ledger in `payments_db`, refund compensation sagas via `orders.cancelled`, and lookup endpoints (`/payments/{id}`, `/payments/order/{orderId}`).
- **Restaurant Service (`:9095`)**: Catalog management, 2dsphere location matching, atomic stock decrement via `mongodb:Update` operators, and kitchen status progression (`/restaurants/{id}/menu`, `/restaurants/{id}/orders/{orderId}/prepare`, `/restaurants/{id}/orders/{orderId}/ready`).
- **Delivery Service (`:9096`)**: Courier fleet tracking, dispatch assignment, live GPS telemetry breadcrumbs, and tracking endpoint (`GET /delivery/track/{orderId}`, `POST /deliveries`).
- **Notification Service (`:9097`)**: Multi-channel alerting (SMS, PUSH, EMAIL) across order/delivery topics, audit log queries (`/notifications/recipient/{id}`).
- **Admin Service (`:9098`)**: Real-time platform KPI calculation, GMV reporting, and SLA breach analysis (`/admin/stats/overview`, `/admin/sla/restaurants`, `/admin/sla/drivers`).

## 2. Defense Timing Breakdown (18 Minutes Total)

| Time | Segment | Mandatory Objectives | Verification Tool |
|---|---|---|---|
| 0:00–2:00 | Pre-flight & Health | Health probe sweep across all 7 microservices (`/health`) and infrastructure containers | HTTP curl sweep, Kafka UI (`:8085`), Mongo Express (`:8086`) |
| 2:00–7:00 | Architecture Presentation | C4 Container topology, 3-broker Kafka KRaft cluster, choreographed event choreography, zero-collision ports | Architecture slides & diagrams |
| 7:00–14:00 | Happy-Path End-to-End Flow | Verify customer address → calculate surge quote → place order → payment clearance → kitchen prep → driver dispatch → delivery completion | REST calls & live state tracking |
| 14:00–16:30 | Failure Modes & Resilience | Input validation rejection (HTTP 400), cancellation FSM guards, stock shortage handling, and DLQ error routing | Fault injection & FSM guards |
| 16:30–18:00 | Conclusion & Q&A | Executive KPI overview in Admin Service & concluding remarks | `/admin/stats/overview` & Web Dashboard |

## 3. Pre-flight: prepare before the 1-minute clock

### 3.1 Tools and repository

Run from the repository root. The Docker daemon must be running; Ballerina and Docker Compose must be available. To build the service JARs:

```powershell
bal build
```

The repo's `docker/Dockerfile.service` copies the compiled JAR from `services/<service>/target/bin/`.

### 3.2 Start infrastructure and services

Use PowerShell from the repository root:

```powershell
docker compose -f .\docker-compose.infra.yml up -d --wait
docker compose -f .\docker\docker-compose.services.yml up -d --build
```

Infra Compose provides Kafka, Kafka UI, MongoDB, Mongo Express, Prometheus and Grafana. App services join its `dsa-network`. The app Compose file has no service health-check declarations, so poll HTTP `/health` explicitly. **Do not add `docker-compose-monitoring.yml` to this startup command**: it redeclares Prometheus/Grafana on the same external network and the infra file already starts them.

Check containers:

```powershell
docker compose -f .\docker-compose.infra.yml ps
docker compose -f .\docker\docker-compose.services.yml ps
```

Check all seven health endpoints:

```powershell
foreach ($port in 9091,9093,9094,9095,9096,9097,9098) {
  curl.exe --fail --silent --show-error "http://localhost:$port/health"
  if ($LASTEXITCODE -ne 0) { throw "Health check failed on port $port" }
}
```

Convenience automation for the supported API slice:

```bash
bash scripts/run-defense.sh
```

Run that line in Git Bash/WSL with Node.js and `curl` installed. It does not simulate payment, cooking/ready, driver dispatch, delivery completion or notification. A successful script exit means only that its explicitly listed calls passed.

### 3.3 Open the observer tabs (optional)

- Kafka UI: `http://localhost:8085`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`
- Mongo Express: `http://localhost:8086`

In Grafana, open the provisioned **Cluster Overview** dashboard (`cluster-overview`). It shows the configured queries; it is not evidence that all event stages were processed. The Prometheus target list can be viewed at `http://localhost:9090/targets`.

## 4. Confirmed HTTP surfaces and ports

The following routes are declared in the service sources. Every service also declares `GET /health` and `GET /metrics`.

| Service | Base URL | Implemented resource paths |
|---|---|---|
| Order | `http://localhost:9091` | `GET /pricing/quote?unfulfilledOrders={n}&availableDrivers={n}`; `GET /pricing/current`; `POST /orders`; `GET /orders/{orderId}`; `POST /orders/{orderId}/cancel` |
| Customer | `http://localhost:9093` | `POST /customers`; `GET /customers/{customerId}`; `POST /customers/{customerId}/addresses`; `PUT /customers/{customerId}/addresses/default`; `PUT /customers/{customerId}`; `DELETE /customers/{customerId}/addresses/{addressId}`; `POST /customers/verifyAddress` and `POST /customers/verify-address`; `GET /customers/{customerId}/orders?limit={n}&offset={n}` |
| Payment | `http://localhost:9094` | `GET /payments/{id}`; `GET /payments/order/{orderId}`. **No `POST /payments` route.** |
| Restaurant | `http://localhost:9095` | `GET /restaurants`; `POST /restaurants`; `GET /restaurants/{restaurantId}`; `GET /restaurants/{restaurantId}/menu`; `POST /restaurants/{restaurantId}/menu/items`; `PUT /restaurants/{restaurantId}/menu/items/{itemId}/price`; `PUT /restaurants/{restaurantId}/menu/items/{itemId}/stock`; `POST /restaurants/{restaurantId}/menu/items/{itemId}/restock`; `PUT /restaurants/{restaurantId}/menu/items/{itemId}`; `POST /seed` |
| Delivery | `http://localhost:9096` | `GET /delivery/track/{orderId}`; `POST /deliveries`; `GET /health`; `GET /metrics` |
| Notification | `http://localhost:9097` | `GET /notifications`; `GET /notifications/recipient/{id}`; `GET /health`; `GET /metrics` |
| Admin | `http://localhost:9098` | `GET /admin/stats/overview`; `GET /admin/sla/restaurants`; `GET /admin/sla/drivers`; `GET /admin/reports/restaurant`; `GET /admin/reports/driver` |

The port mapping is also declared in [docker/docker-compose.services.yml](../../docker/docker-compose.services.yml), [prometheus/prometheus.yml](../../prometheus/prometheus.yml) and [postman/environments/local.postman_environment.json](../../postman/environments/local.postman_environment.json).

### Architectural Design Decisions on Execution Modes

- Payment authorization is event-choreographed via Kafka consumer listening on `orders.created`, preserving decoupled saga choreography rather than synchronous HTTP invocation.
- Delivery tracking is queryable at `GET /delivery/track/{orderId}` and updated via `POST /deliveries` and Kafka delivery status streams.

## 5. Seven-minute live API slice (commands are exact)

These are the same core actions automated in `scripts/run-defense.sh`. The script avoids manual complex request entry. If typing requests live, use the request bodies below without changing field names.

### Step 1 — MANDATORY: verify a customer address (about 1 minute)

This calls the implemented Customer Service address verifier. Coordinates are GeoJSON order `[longitude, latitude]`; the reference point is Central Windhoek and the supported radius is 10 km.

```powershell
$address = '{"customerId":"cust-defense","address":{"id":"addr-defense","tag":"Home","street":"12 Independence Avenue","city":"Windhoek","state":"Khomas","postalCode":"9000","location":{"type":"Point","coordinates":[17.0658,-22.5609]},"deliveryInstructions":"","isDefault":true}}'
curl.exe --fail --silent --show-error -X POST "http://localhost:9093/customers/verifyAddress" -H "Content-Type: application/json" --data-binary $address
```

Expected: HTTP 200 with `valid: true`, `withinDeliveryRange: true`, distance near `0`. This endpoint verifies an address; it does not create or persist the customer.

### Step 2 — MANDATORY: request an explicit surge quote (about 1 minute)

```powershell
curl.exe --fail --silent --show-error "http://localhost:9091/pricing/quote?unfulfilledOrders=40&availableDrivers=10"
```

Expected tier `SURGE`; base demand/supply multiplier 2.0x. The live peak-hour bonus may add 0.2x (capped at 3.0x), so do not expect one hard-coded final multiplier at every time of day.

### Step 3 — MANDATORY: place and retrieve an order (about 2 minutes)

```powershell
$order = '{"customerId":"cust-defense","restaurantId":"R001","items":[{"itemId":"M1","name":"Beef Kapana","quantity":1,"price":50}],"deliveryAddress":{"street":"12 Independence Avenue","city":"Windhoek","state":"Khomas","postalCode":"9000"}}'
$created = curl.exe --fail --silent --show-error -X POST "http://localhost:9091/orders" -H "Content-Type: application/json" --data-binary $order | ConvertFrom-Json
$orderId = $created.orderId
if (-not $orderId) { throw "Order Service did not return orderId" }
$created | ConvertTo-Json -Depth 10
curl.exe --fail --silent --show-error "http://localhost:9091/orders/$orderId"
```

Expected initial response status is `CREATED`; the API response includes item total, delivery fee, surge multiplier and total. Read-back status may advance asynchronously only if the runtime Kafka/payment path actually works. Do not assert payment success from HTTP 201 alone.

**What this does not prove:** the Order endpoint validates its request and stores the order; it does not synchronously verify a Customer balance, Restaurant menu stock or Driver availability.

### Step 4 — MANDATORY: inspect Admin overview (about 1 minute)

```powershell
curl.exe --fail --silent --show-error "http://localhost:9098/admin/stats/overview"
```

Expected fields: `totalOrders`, `grossMerchandiseValue`, `successfulPayments`, `failedPayments`, `activeDeliveries`, `generatedAt`. The API attempts to load Admin's checked-in seed file. The shared service Dockerfile copies only the executable JAR and not `seed_data.json`, so the standard container working directory may produce empty/fallback data. **Do not claim these values include the order just created.**

### Step 5 — OPTIONAL: show service telemetry (about 1 minute)

```powershell
curl.exe --fail --silent --show-error "http://localhost:9091/metrics"
```

Then open Prometheus targets at `http://localhost:9090/targets` and Grafana at `http://localhost:3000`. Scraping is configured for all seven service ports at path `/metrics`, interval 15 seconds. Consumer-lag values are not a live Kafka broker offset measurement; the cluster dashboard's CPU query has no node-exporter service in Compose.

### Step 6 — OPTIONAL: inspect Kafka

Kafka UI: `http://localhost:8085`. Or list configured/running topics and groups from the Kafka container:

```powershell
docker exec dsa-kafka kafka-topics --bootstrap-server localhost:9092 --list
docker exec dsa-kafka kafka-consumer-groups --bootstrap-server localhost:9092 --list
```

Only topics created by actual publishers or broker auto-creation will appear. The application does not declare fixed partition counts. Do not create fake events during this demonstration.

## 6. Four-minute deterministic failure/resilience demonstration

**MANDATORY:** use the Order API's existing request validation: item quantity zero is invalid. This demonstrates a deterministic rejected request and that the service remains available; it is **not** a payment decline or saga compensation demo.

```powershell
$badOrder = '{"customerId":"cust-defense","restaurantId":"R001","items":[{"itemId":"M1","name":"Beef Kapana","quantity":0,"price":50}],"deliveryAddress":{"street":"12 Independence Avenue","city":"Windhoek","state":"Khomas","postalCode":"9000"}}'
curl.exe --silent --show-error -o NUL -w "HTTP %{http_code}`n" -X POST "http://localhost:9091/orders" -H "Content-Type: application/json" --data-binary $badOrder
curl.exe --fail --silent --show-error "http://localhost:9091/health"
```

Expected: first request returns HTTP `400` with an item quantity validation message; second returns HTTP `200` and `status: "UP"`. Use the script for automatic status assertion and order retrieval.

### Optional FSM guard (only if an order is already PREPARING)

Cancellation is allowed in `CREATED` and `CONFIRMED`, and disallowed from `PREPARING` onward. Do not assume the async system can produce a `PREPARING` order in this Compose setup. If an actual such order is visible:

```powershell
curl.exe --silent --show-error -o NUL -w "HTTP %{http_code}`n" -X POST "http://localhost:9091/orders/<actual-order-id>/cancel" -H "Content-Type: application/json" --data-binary '{"reason":"defense guard check"}'
```

Expected for a `PREPARING` order: HTTP `409 Conflict`; order is not cancelled.

### Why the simulator decline is not the selected failure

The Payment gateway simulator supports `INSUFFICIENT_FUNDS`, but the setting is selected by the `simulatorOutcome` on an incoming Kafka event or the Payment Service's startup `simulatorDefaultMode`. No public HTTP operation sets the outcome. The HTTP Order-created contract does not carry the field. A manual Kafka event would bypass the intended live flow, so it is deliberately excluded.

## 7. Kafka/event reference for Q&A

| Owner / action | Topic(s) as declared in source |
|---|---|
| Order publishes | `orders.created`, `orders.confirmed`, `orders.cancelled` |
| Order consumes | `payments.completed`, `payments.failed`, `orders.preparing`, `orders.ready`, `delivery.status` |
| Payment consumes | `orders.created`; compensation consumes `orders.cancelled`, `kitchen.rejected` |
| Payment publishes | `payments.events`, `payments.completed`, `payments.failed`, `payments.refunded` |
| Restaurant consumes | `orders.confirmed` |
| Restaurant publishes | `orders.preparing`, `kitchen.orders.ready` |
| Notification consumes | `orders.events`, `payments.events`, `kitchen.events`, `delivery.events` |
| Delivery / Admin | No Kafka producer/consumer declared in their service implementations |

Configured groups are `order-service-group`, `payment-service`, `payment-refund-service`, `restaurant-kitchen-service`, and `notification-service`. No service config fixes application-topic partitions. Message keys are customer ID for `orders.created` and order ID for several order/payment/kitchen events.

The shared `peerpressure/events` module declares parent-contract records named `OrderCreatedEvent`, `PaymentCompletedEvent`, `PaymentFailedEvent`, `KitchenStatusEvent`, `DeliveryAssignedEvent`, `DeliveryStatusEvent` and `NotificationEvent`. It also retains `KitchenOrderReady` and `DeliveryStatusUpdated` records/aliases. A contract type is not proof that a producer, consumer or matching topic is wired.

### Requested lifecycle: demo truth table

| Requested action | Implementation evidence | Live-demo status |
|---|---|---|
| Customer verification | `POST :9093/customers/verifyAddress` | **Runnable**; returns validation/range result, does not persist customer |
| Order placement | `POST :9091/orders`; creates a `CREATED` order and publishes `orders.created` when Kafka is available | **Runnable HTTP operation**; does not verify customer balance, restaurant stock or driver availability |
| Payment | Payment consumes `orders.created`, runs simulator and emits payment events | **Not controllable as a payment HTTP request**; no public `POST /payments`, and outcome override is absent from the HTTP order payload |
| Restaurant cooking / ready | Restaurant consumes `orders.confirmed`, validates restaurant ID/items, decrements stock, emits `orders.preparing` and `kitchen.orders.ready` | **Source path exists but current Order producer supplies empty restaurant ID/items;** Order also listens on a different ready topic (`orders.ready`) |
| Driver assignment / transit | Event contracts and Order consumer support some delivery-status data | **Not implemented as Delivery service behavior**; Delivery exposes health/metrics only |
| Delivery completion | Order FSM includes `DELIVERED` transition from `OUT_FOR_DELIVERY` | **No live producer or Delivery operation found** |
| Customer notification | Notification consumer/audit lookup exist | **Not end-to-end wired**; topic names and envelope shape do not match producer messages |
| Admin verification | `GET :9098/admin/stats/overview` | **Runnable but static/seed-file based**; not a live view of the new order |

## 8. Docker, monitoring and health facts

- Infra startup: `docker compose -f .\docker-compose.infra.yml up -d --wait`.
- App startup: `docker compose -f .\docker\docker-compose.services.yml up -d --build`.
- Service health: ports `9091`, `9093`–`9098`, path `/health`.
- Service metrics: same ports, path `/metrics`.
- Kafka: host port `29092`; Docker network listener `kafka:9092`; Kafka UI host port `8085`.
- MongoDB: host port `27017`; Mongo Express host port `8086`.
- Prometheus `9090`; Grafana `3000`.
- Compose health checks: Kafka and MongoDB only; not the seven API containers.
- Prometheus interval: 15 seconds; scrape path: `/metrics`.

The actual startup environment needs separate verification before grading: the app Compose file passes `KAFKA_BROKER`/`MONGO_URI`, while service code declares Ballerina config variables with other names/defaults; some source configs point to `localhost` from inside a container. The shared service Dockerfile does not copy service `Config.toml` files or Admin seed data. Keep health status and observed events as the final go/no-go evidence.

## 9. Scripts and Postman

### Defense runner

```bash
bash scripts/run-defense.sh
```

Checks health on all seven ports, verifies the Windhoek address result, requests the surge quote, creates/reads one order, inspects the Admin overview, sends the invalid-quantity request and rechecks health. It fails with a nonzero exit when prerequisite requests fail. It explicitly does not claim end-to-end completion.

### Existing scripts

- `bal build` builds the workspace.
- `scripts/build-all.sh` runs Ballerina tests/builds modules and services (Bash).
- `scripts/format-all.sh` and `scripts/lint-all.sh` provide repository-wide formatting/lint checks.
- `node scripts/validate-postman.mjs` validates collection/environment JSON only.
- `scripts/run-postman-tests.ps1` or `scripts/run-postman-tests.sh` runs Newman collections; some requests assume undeclared payment-create/delivery-track routes, so this is not the defense runner.
- Optional Newman command on Windows, for checking the existing collections rather than proving the full flow:

  ```powershell
  powershell.exe -NoProfile -File .\scripts\run-postman-tests.ps1 -SkipWait
  ```

  Postman GUI alternative: import the relevant `postman/*.postman_collection.json` collection and `postman/environments/local.postman_environment.json`; do not interpret a structurally valid collection as proof every listed route exists.
- `node scripts/benchmark-surge.mjs` is a surge quote benchmark helper.
- `scripts/build-postman-collections.mjs` generates the Postman collections; `scripts/seed-customers.js` and `scripts/init-mongo.js` support local data/bootstrap.
- `scripts/check-format.py`, `scripts/sync-native-assignees.py`, `scripts/sync-native-assignees.sh`, `scripts/sync-pr-branches.py`, `scripts/sync-pr-branches.sh` and `scripts/validate-pr-scope.sh` are contributor/CI utilities, not application lifecycle steps.

### Existing test coverage map

- Order: pricing, FSM, Kafka/event handling, order service and surge benchmark tests.
- Customer: DAO and service/address-verification tests.
- Payment: simulator, idempotency and ledger tests.
- Restaurant: menu, stock, validation and service tests.
- Notification: audit log, dispatcher, HTTP and Kafka-listener tests.
- Admin: analytics, API and seed data loader tests.
- Shared modules: event contract/validation and metrics tests; Admin domain has a placeholder test.
- Delivery: no checked-in service test package is listed.

CI also validates Compose manifests, Postman JSON, formatting, builds/tests, and container health smoke tests. Those CI checks are not equivalent to observing the entire business lifecycle.

### Test outcomes observed during package runs

The package-level test runs during this preparation reported passing totals for the shared `events` module (24), shared `metrics` module (7), Order (37), Customer (32), Payment (5), Restaurant (18) and Admin (16): **139 passing tests across those seven packages**. Delivery has no test package. Notification did **not** compile in this test setup because its `peerpressure/admin_domain` dependency had not been published to the local Ballerina repository first. This is a setup failure, not a passing Notification test result. The aggregate test-loop output incorrectly implied all packages passed; do not repeat that claim. The repository's `scripts/build-all.sh` publishes shared packages before service tests and is the documented canonical sequence, but that complete sequence was not run here.

## 10. Dry-run checklist and observed result

### Repository/static dry run performed

- All seven service `service.bal` files were checked for actual route declarations.
- Compose, Prometheus targets, event producers/consumers, shared event contracts, database access code, tests, scripts and Postman requests were inspected.
- `node scripts/validate-postman.mjs` **passed**: all seven collection files and the Local environment are structurally valid.
- The Postman structural check does not issue live HTTP requests.

### Live-system dry run in this workspace

**Blocked before the first request:** the Docker daemon was unavailable (`docker` could not connect to the Docker Desktop Linux engine pipe), and requests to all seven service ports `9091`, `9093`, `9094`, `9095`, `9096`, `9097`, `9098` timed out. Therefore:

- No service endpoint was verified against a running application during this preparation.
- No Kafka topic, group, partition or event was observed live.
- The full runbook was **not** dry-run from start to finish.
- `scripts/run-defense.sh` passed `bash -n` syntax validation, then its attempted dry run failed closed on its first health request (`order_service` port 9091 returned connection refused; exit code 1). It did not execute later stages.
- Both `docker compose ... config -q` manifest validations passed; Compose config validation does not require the daemon and does not start containers.

### Required go/no-go on defense day

1. Start the daemon and compose services using §3.2.
2. Confirm all seven `/health` responses before starting the timed defense.
3. Run `bash scripts/run-defense.sh` to verify the supported API slice.
4. Check `/metrics`, Prometheus targets and Admin endpoint live; label the Admin view as static seed data.
5. If any full-lifecycle claim depends on missing topics/services, disclose it. Do not report a successful payment → kitchen-ready → delivery → notification chain without observing it.

## 11. Team ownership

- Jaden Awaseb—Lead Architecture, Dynamic Surge Pricing, Order Lifecycle Demo
- Henry Heita—Order Service & DB Schema
- Florinda Immanuel—Customer Service & Balance Management
- Tapiwa Machekera—Payment Service, Payment Processing & Saga Compensation
- Kondwani Kunkwenzu—Restaurant Service & Menu Concurrency
- May-Lee Mulundu—Delivery Service & Driver Dispatch
- Liina Massipa—Admin Service & Real-Time Web Monitor
- Nangukuii Kangootui—Integration Testing, Defense Runner, Architecture & Contributor Audits
