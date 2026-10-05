---
marp: true
theme: default
paginate: true
size: 16:9
---

<style>
section { font-size: 25px; }
h1 { color: #174a70; }
h2 { color: #174a70; }
table { font-size: 19px; }
pre { font-size: 18px; line-height: 1.15; }
strong { color: #a34413; }
</style>

# PeerPressure
## Distributed Food Delivery Platform

### Final defense | implementation-led walkthrough

**Important:** this deck distinguishes implemented behavior from contract/design intent. The checked-in implementation does not currently support a complete live order-to-delivery walkthrough.

**Target defense window: 18 minutes**

---

## 18-minute defense plan

| Segment | Time | What to show |
|---|---:|---|
| Pre-flight | 1 min | Service health and monitoring availability |
| Architecture | 5 min | C4 Context, Container, Component; boundaries and events |
| Happy-path demo | 7 min | Address validation, quote, order create/read, admin snapshot; trace the event path and its cut-offs |
| Failure/resilience | 4 min | Invalid order rejected with HTTP 400; service remains healthy |
| Conclusion | 1 min | Results, known limitations, team ownership |

**Do not claim** that payment, kitchen-ready, dispatch, delivery completion, or customer notification was demonstrated end-to-end unless those missing integrations have first been implemented and verified.

---

## Problem domain and requirements

**Domain:** coordinate customers, restaurants and menus, payment processing, food preparation, delivery, customer notifications and operational reporting.

**Requirements evidenced by this repository**

- Register/query customer profiles and verify a delivery address against a Windhoek-centered 10 km radius.
- Accept orders, calculate delivery pricing, track guarded order-state transitions and support cancellation before preparation.
- Persist customer, restaurant, order and payment data in service-owned MongoDB databases where the service code connects to MongoDB.
- Use Kafka contracts/events for asynchronous order, payment and kitchen coordination.
- Provide HTTP health/metrics endpoints, Prometheus scraping and a provisioned Grafana dashboard.
- Expose a small Admin reporting API backed by checked-in seed data.

Address validation checks Namibia coordinate bounds, then estimates distance from Central Windhoek with a local degree-to-kilometre projection (111 km per latitude degree; 102.5 km per longitude degree) and a Newton-Raphson square root.

**Implementation boundary:** the repository contains APIs and event components, not a customer-facing web application or an executable end-to-end driver workflow.

---

## C4 — Context

```text
Customer / restaurant / driver / admin clients
                    |
                 HTTP/JSON
                    v
+------------------------------------------+
| PeerPressure food-delivery platform      |
| Order  Customer  Payment  Restaurant     |
| Delivery  Notification  Admin            |
+----------------------+-------------------+
                       | events, where wired
                       v
                   Kafka + MongoDB
               (Mongo used by some services)

Operators ---> Prometheus ---> Grafana
```

This is a **system boundary view**, not a claim that the shown external user interfaces or driver API exist. The checked-in Delivery service has no dispatch or tracking resources.

---

## C4 — Container view

```text
                 +--------------------------+
HTTP clients --> | Seven service containers |
                 | Ports :9091, :9093-:9098 |
                 +----+------------+--------+
                      |            |
                  Kafka :9092   MongoDB :27017
                  Kafka UI     Mongo Express

Prometheus :9090 -------------> Grafana :3000
```

- Compose declares shared `dsa-network`; infra starts Kafka, MongoDB, Prometheus and Grafana with their UIs.
- **No Compose health checks for API containers;** only Kafka and MongoDB. Config mapping still requires live validation.

---

## C4 — Component view: Order Service

```text
Order HTTP (:9091)
  orders / cancel / pricing / health / metrics
    |
    +--> validate request + calculate price
    +--> OrderStore: memory + MongoDB "orders"
    +--> producer: orders.created / confirmed / cancelled
    +<-- consumer: payment / kitchen / delivery topics
```

The code has a state machine, storage and event handlers. A transition handler is not proof that another service produces the matching event.

---

## Seven microservices: actual surface

| Service | Port | Implemented HTTP surface beyond health/metrics |
|---|---:|---|
| Order | 9091 | Order create/read/cancel; pricing quote/current |
| Customer | 9093 | Customer CRUD/address operations; address verification; customer orders lookup |
| Payment | 9094 | Read payment by payment ID or order ID; Kafka-driven processing (no payment-create HTTP route) |
| Restaurant | 9095 | Restaurant/menu read/write, stock/price update, seed |
| Delivery | 9096 | **None**; only `/health` and `/metrics` |
| Notification | 9097 | Notification audit lookup by recipient |
| Admin | 9098 | Overview, restaurant report, driver report |

All seven declare `GET /health` and `GET /metrics`. The exact API paths and caveats are in the runbook.

---

## Event-driven communication: declared vs wired

**Producer/consumer paths in service code**

- Order produces `orders.created`, `orders.confirmed`, `orders.cancelled`.
- Payment consumes `orders.created`; it also consumes `orders.cancelled` and `kitchen.rejected` for compensation. It publishes `payments.events`, `payments.completed`, `payments.failed`, and `payments.refunded`.
- Restaurant consumes `orders.confirmed`; publishes `orders.preparing` and `kitchen.orders.ready`.
- Order consumes payment events, `orders.preparing`, `orders.ready`, and `delivery.status`.
- Notification subscribes to `orders.events`, `payments.events`, `kitchen.events`, and `delivery.events`.

**Integration caveats verified from the names/contracts**

- Restaurant publishes `kitchen.orders.ready`; Order listens on `orders.ready`.
- Order's `OrderConfirmed` producer leaves restaurant ID and item list at their contract defaults (empty), while Restaurant validates both as required.
- Notification's aggregate `*.events` topics do not match the Order/Payment/Restaurant producer topic names shown above.
- Notification parses `{eventType, data}` envelopes; the shown producers serialize direct event records, so the payload shapes also need an adapter.
- Delivery has no Kafka producer/consumer in its service implementation.

---

## Topics, partitions and consumer groups

| Group ID | Owner | Subscription in code |
|---|---|---|
| `order-service-group` | Order | `payments.completed`, `payments.failed`, `orders.preparing`, `orders.ready`, `delivery.status` |
| `payment-service` | Payment | `orders.created` by default |
| `payment-refund-service` | Payment | `orders.cancelled`, `kitchen.rejected` |
| `restaurant-kitchen-service` | Restaurant | `orders.confirmed` |
| `notification-service` | Notification | `orders.events`, `payments.events`, `kitchen.events`, `delivery.events` |

**Partitions:** no application-topic partition counts or replication settings are declared by the service code or infra Compose configuration. Kafka uses broker defaults/auto-creation behavior if enabled. Do not present a specific topic partition count as an application guarantee.

Order and payment messages use order IDs or customer IDs as keys in the producer code. Kafka keying does not by itself prove a configured partition count or end-to-end exactly-once behavior.

---

## Shared event contracts

The shared `peerpressure/events` module declares:

- `OrderCreatedEvent`
- `PaymentCompletedEvent` and `PaymentFailedEvent`
- `KitchenStatusEvent`
- `DeliveryAssignedEvent` and `DeliveryStatusEvent`
- `NotificationEvent`

Existing `KitchenOrderReady` and `DeliveryStatusUpdated` records/aliases remain supported. These are compile-time schemas/serializers/deserializers; the presence of a contract is not proof of a producer, consumer or matched topic in the running platform.

---

## Database-per-service: implementation evidence

| Service | Code-level persistence evidence |
|---|---|
| Customer | MongoDB `customer_db`, `customers` collection |
| Order | MongoDB `order_db`, `orders`; also keeps an in-memory map and falls back when connection setup fails |
| Restaurant | MongoDB `restaurant_db`, `restaurants`; stock decrement uses a conditional update |
| Payment | MongoDB transaction, ledger and idempotency collections in the payment ledger code |
| Delivery | No implemented persistence/API path in the service file |
| Notification | Appends audit rows to `./audit.log`; Mongo connector code is explicitly disabled |
| Admin | Loads overview/report inputs from `seed_data.json` candidates; the standard service Dockerfile copies only the JAR, not this JSON file |

Separate Mongo DB names are a useful isolation design, but the Compose `MONGO_URI` values, bootstrap databases, per-service defaults and checked-in Ballerina configs are not fully aligned. Do not claim all seven services are connected to isolated live databases. Admin may load an empty fallback dataset in the standard container working directory.

---

## Implemented algorithm: dynamic surge pricing

Order pricing computes demand/supply ratio **R = unfulfilled orders / available drivers**:

| Ratio | Tier | Base multiplier |
|---:|---|---:|
| R <= 1 | STANDARD | 1.00x |
| 1 < R <= 2 | MODERATE | 1.25x |
| 2 < R <= 3 | HIGH | 1.50x |
| 3 < R <= 5 | SURGE | 2.00x |
| R > 5 | PEAK | 3.00x cap |

- Zero drivers with demand returns the configured max; zero orders and zero drivers returns 1x.
- Lunch (12:00–13:59) and dinner (18:00–20:59), at configured CAT offset UTC+2, add 0.2x subject to the 3x cap.
- Default base fee is 15.00; the resulting delivery fee is rounded to two decimals.
- Endpoint for an explicit supply/demand quote: `GET /pricing/quote?unfulfilledOrders=40&availableDrivers=10`.

---

## Implemented algorithm: stock concurrency protection

Restaurant kitchen processing:

1. Validates a confirmed order and requires positive item quantities.
2. Atomically decrements each menu item's stock with a MongoDB `updateOne` filter that requires `stock >= requested quantity`.
3. If a later item cannot be decremented, attempts to add earlier decrements back.
4. Emits `orders.preparing`, then starts the configured cooking delay before publishing the ready event.

**Precision:** this is guarded per-item atomic update plus best-effort rollback, not a single multi-item Mongo transaction. The checked-in service has no dedicated concurrency reservation API.

---

## Driver dispatch and customer balance: honest status

**Not implemented as a runnable service workflow in this repository**

- Delivery `service.bal` declares only `GET /health` and `GET /metrics`.
- No driver assignment, refusal handling, nearest-driver selection, transit update endpoint or delivery-completion publisher is present there.
- Shared event records describe `DeliveryAssigned` and `DeliveryStatusUpdated`; Order's consumer has a `delivery.status` handler. These contracts/handlers do not constitute an operational dispatcher.
- Customer records have no balance field or balance-management endpoint. Payment maintains transaction/ledger records and a simulator; that is not a customer balance API.

The requested ownership labels are retained on the team slide, but role labels are not treated as proof of shipped functionality.

---

## Payment processing and compensation

- Payment consumes order-created events; the gateway simulator supports `SUCCESS`, `INSUFFICIENT_FUNDS`, `NETWORK_TIMEOUT`, `INVALID_CARD` and `FRAUD_SUSPECTED`.
- Completed/failed transactions are persisted, idempotency keys are used, and charge/refund ledger entries are created.
- Refund handling consumes order-cancelled and kitchen-rejected events, and publishes `payments.refunded`.
- `simulatorOutcome` can override the configured default **on the Kafka input event**; there is no `POST /payments` HTTP operation in this service.
- Order cancellation is guarded by the state machine; cancellation is allowed only before `PREPARING`.

**Live-demo constraint:** the Order-created event generated by the HTTP endpoint does not expose a payment simulator outcome field. The failure simulation is not selectable from the public HTTP API as checked in.

---

## Order lifecycle: state model vs live integration

```text
CREATED --> CONFIRMED --> PREPARING --> READY --> OUT_FOR_DELIVERY --> DELIVERED
    |           |
    +-----------+--> CANCELLED
```

- FSM tests and code cover these legal transitions. Cancellation is disallowed after preparation begins.
- Payment completion can move an existing Order from `CREATED` to `CONFIRMED`.
- Restaurant consumes `orders.confirmed`, sends `orders.preparing`, then emits `kitchen.orders.ready`.
- **Mismatch:** Order's default ready-topic subscription is `orders.ready`, not `kitchen.orders.ready`.
- Notification also expects an envelope shape that these producers do not emit.
- **Missing live stages:** there is no Delivery implementation to assign a driver or publish the later delivery statuses; notification subscriptions also do not match the producer topics.

This diagram is the **implemented state machine**, not evidence that every transition currently occurs in a composed live run.

---

## Observability, monitoring and health

- Every service declares `/health` and `/metrics`; Prometheus scrapes `order-service:9091` and `customer-service:9093` through `admin-service:9098` on `/metrics` every 15 seconds.
- Grafana is provisioned with a Cluster Overview dashboard for HTTP request rate/latency, consumer lag and broker CPU.
- Prometheus UI: `http://localhost:9090`; Grafana: `http://localhost:3000`; dashboard UID: `cluster-overview`.
- The consumer lag metrics are set in service code as gauge values, including hard-coded zero values in health handlers; they are not a live broker-offset measurement.
- The Grafana CPU panel queries `node_cpu_seconds_total`, but the Compose stack does not define a node-exporter service.
- Docker health checks exist for Kafka and MongoDB only; application health endpoints are HTTP resources, not Compose health-check declarations.

---

## Tests, scripts and runtime evidence

- Ballerina module/service tests cover pricing tiers, state transitions, event contracts, payment simulator outcomes, address validation, inventory and Admin analytics/API behavior.
- `scripts/build-all.sh` builds/tests modules and services; CI runs `bal test --test-report --code-coverage`, `bal build`, Compose config checks and service health smoke checks.
- `node scripts/validate-postman.mjs` validates checked-in collection/environment JSON. It does **not** execute requests.
- `scripts/run-postman-tests.ps1` / `.sh` run Newman against all collections; some requests are stale relative to service resources (for example payment create and delivery tracking).
- `scripts/benchmark-surge.mjs` exercises a local quote endpoint.
- This workspace inspection found Docker unavailable and all seven HTTP ports unreachable; no live system run can be reported for this environment.

---

## Demonstration verdict and safe claims

**Runnable core:** all service health checks; customer address verification; explicit surge quote; HTTP order create/read; deterministic invalid-order rejection; Admin overview API response.

**Not currently demonstrable end-to-end from the checked-in interfaces:** a selectable payment failure through HTTP, confirmed-to-ready completion through matching topic names, driver dispatch/transit/delivery completion, delivery-triggered customer notification, or an Admin dashboard that reflects the just-created order.

Use the runbook's stop/go checks. If the grader requires the full lifecycle, state that it is a known integration gap; do not inject fabricated events or claim the static Admin seed represents the just-created order.

---

## Team ownership

- Jaden Awaseb—Lead Architecture, Dynamic Surge Pricing, Order Lifecycle Demo
- Henry Heita—Order Service & DB Schema
- Florinda Immanuel—Customer Service & Balance Management
- Tapiwa Machekera—Payment Service, Payment Processing & Saga Compensation
- Kondwani Kunkwenzu—Restaurant Service & Menu Concurrency
- May-Lee Mulundu—Delivery Service & Driver Dispatch
- Liina Massipa—Admin Service & Real-Time Web Monitor
- Nangukuii Kangootui—Integration Testing, Defense Runner, Architecture & Contributor Audits

---

## Conclusion

**What is evidenced:** seven separately packaged service projects, HTTP APIs/health surfaces, shared event contracts, Order pricing/state logic, Restaurant stock concurrency guards, Payment simulator/ledger logic, observability configuration and automated tests.

**What the defense must disclose:** the current service/API/topic wiring does not realize the complete delivery lifecycle. The runbook demonstrates only operations that can be directly tied to the checked-in endpoints and scripts.

### Questions
