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

**Important:** this deck walks through the verified end-to-end implementation across all 7 Ballerina Swan Lake microservices, Apache Kafka (KRaft), and MongoDB 7.0.

**Target defense window: 18 minutes**

---

## 18-minute defense plan

| Segment | Time | What to show |
|---|---:|---|
| Pre-flight | 1 min | Service health and monitoring availability |
| Architecture | 5 min | C4 Context, Container, Component; boundaries and events |
| Happy-path demo | 7 min | Address validation, quote, order create/read, payment, kitchen prep/ready, courier dispatch/delivery, notification, admin snapshot |
| Failure/resilience | 4 min | Invalid order rejected with HTTP 400; illegal FSM transitions rejected; poison-pill DLQ routing |
| Conclusion | 1 min | Results, architectural guarantees, team ownership |

---

## Problem domain and requirements

**Domain:** coordinate customers, restaurants and menus, payment processing, food preparation, delivery, customer notifications and operational reporting.

**Requirements evidenced by this repository**

- Register/query customer profiles and verify a delivery address against a Windhoek-centered 10 km radius.
- Accept orders, calculate delivery pricing, track guarded order-state transitions and support cancellation before preparation.
- Persist customer, restaurant, order, payment, delivery, and notification data in service-owned MongoDB databases (`customer_db`, `order_db`, `restaurant_db`, `payments_db`, `delivery_db`, `notification_db`).
- Use Kafka contracts/events for asynchronous order, payment, kitchen, delivery, and notification coordination.
- Provide HTTP health/metrics endpoints, Prometheus scraping and a provisioned Grafana dashboard.
- Expose an Admin reporting API backed by checked-in seed data and live service aggregation.

Address validation checks Namibia coordinate bounds, then estimates distance from Central Windhoek with a local degree-to-kilometre projection (111 km per latitude degree; 102.5 km per longitude degree) and a Newton-Raphson square root.

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
                       | events & persistence
                       v
                   Kafka + MongoDB

Operators ---> Prometheus ---> Grafana
```

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
- All seven service containers pass consistent `BAL_CONFIG_VAR_*`, `KAFKA_BROKER`, and `MONGO_URI` settings.

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

---

## Seven microservices: actual surface

| Service | Port | Implemented HTTP surface beyond health/metrics |
|---|---:|---|
| Order | 9091 | `POST /orders`, `GET /orders`, `GET /orders/{orderId}`, `POST /orders/{orderId}/cancel`, `GET /customers/{customerId}/orders`, `GET /pricing/quote`, `GET /pricing/current` |
| Customer | 9093 | Customer CRUD/address operations; `POST /customers/verifyAddress`; `GET /customers/{customerId}/orders` |
| Payment | 9094 | `POST /payments`, `GET /payments`, `GET /payments/{id}`, `GET /payments/order/{orderId}`; Kafka-driven settlement and refund sagas |
| Restaurant | 9095 | Restaurant/menu CRUD, atomic per-item stock/price/restock updates, `POST /restaurants/{id}/order/validate-and-reserve`, `POST /seed` |
| Delivery | 9096 | `POST /deliveries` (FSM transitions + Kafka publishing), `GET /deliveries`, `GET /drivers`, `GET /delivery/track/{orderId}` (Haversine distance & ETA) |
| Notification | 9097 | `GET /notifications`, `GET /notifications/recipient/{id}`, resilient Kafka consumer with DLQ routing |
| Admin | 9098 | `GET /admin/stats/overview`, `GET /admin/reports/restaurant` (`/admin/sla/restaurants`), `GET /admin/reports/driver` (`/admin/sla/drivers`) |

All seven declare `GET /health` and `GET /metrics`.

---

## Event-driven communication: end-to-end choreography

**Producer/consumer paths in service code**

- Order produces `orders.created`, `orders.confirmed` (including `restaurantId` and `items`), and `orders.cancelled`.
- Payment consumes `orders.created`, `orders.cancelled`, and `kitchen.rejected`; publishes `payments.events`, `payments.completed`, `payments.failed`, and `payments.refunded`.
- Restaurant consumes `orders.confirmed`; atomically decrements menu stock and publishes `orders.preparing` and `kitchen.orders.ready`.
- Delivery consumes `kitchen.orders.ready`; assigns the nearest available courier using spherical Haversine distance and publishes `delivery.assigned`, `delivery.status`, and `delivery.events`.
- Order consumes `payments.completed`, `payments.failed`, `orders.preparing`, `kitchen.orders.ready` (plus `orders.ready`), and `delivery.status`.
- Notification subscribes to all domain topics (`orders.created`, `orders.confirmed`, `orders.cancelled`, `payments.completed`, `payments.failed`, `orders.preparing`, `kitchen.orders.ready`, `delivery.assigned`, `delivery.status`) and legacy `*.events` topics, parsing both `{eventType, data}` envelopes and raw domain events via `peerpressure/kafka_client` and routing poison pills via `peerpressure/resilience`.

---

## Topics, partitions and consumer groups

| Group ID | Owner | Subscription in code |
|---|---|---|
| `order-service-group` | Order | `payments.completed`, `payments.failed`, `orders.preparing`, `kitchen.orders.ready`, `delivery.status` |
| `payment-service` | Payment | `orders.created` |
| `payment-refund-service` | Payment | `orders.cancelled`, `kitchen.rejected` |
| `restaurant-kitchen-service` | Restaurant | `orders.confirmed` |
| `delivery-service-group` | Delivery | `kitchen.orders.ready` |
| `notification-service` | Notification | All 9 canonical domain topics + 4 `*.events` topics |

---

## Shared event contracts

The shared `peerpressure/events` module declares:

- `OrderCreatedEvent`
- `PaymentCompletedEvent` and `PaymentFailedEvent`
- `KitchenStatusEvent`
- `DeliveryAssignedEvent` and `DeliveryStatusEvent`
- `NotificationEvent`

Existing `KitchenOrderReady` and `DeliveryStatusUpdated` records/aliases remain supported.

---

## Database-per-service: implementation evidence

| Service | Code-level persistence evidence |
|---|---|
| Customer | MongoDB `customer_db`, `customers` collection |
| Order | MongoDB `order_db`, `orders` + in-memory cache |
| Restaurant | MongoDB `restaurant_db`, `restaurants` with indexed per-item atomic stock updates |
| Payment | MongoDB `payments_db` (`transactions`, `payment_ledger`, `idempotency_keys`) |
| Delivery | MongoDB `delivery_db`, `deliveries` + in-memory tracking cache |
| Notification | Appends audit rows to `./audit.log` and persists to MongoDB `notification_db`, `notifications` |
| Admin | Loads baseline `seed_data.json` and merges live snapshots from Order, Payment, and Delivery APIs |

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
2. Resolves exact `(categoryIndex, itemIndex)` and atomically decrements each menu item's stock with a MongoDB `updateOne` filter that requires `menu.${categoryIndex}.items.${itemIndex}.stock >= requested quantity`.
3. If a later item cannot be decremented, rolls back earlier decrements atomically.
4. Emits `orders.preparing`, then starts the configured cooking delay before publishing `kitchen.orders.ready`.

---

## Driver dispatch and telemetry

- Delivery Service manages a Windhoek courier fleet (`drv_001`..`drv_004`) and selects the nearest available driver via spherical Haversine distance (`calculateDistanceKm`) and road-factor ETA (`calculateEtaMinutes`).
- Enforces the shared `peerpressure/delivery_domain` finite state machine (`UNASSIGNED -> DRIVER_ASSIGNED -> AT_RESTAURANT -> OUT_FOR_DELIVERY -> DELIVERED`).
- Consumes `kitchen.orders.ready` automatically and publishes `delivery.assigned`, `delivery.status`, and `delivery.events`.

---

## Payment processing and compensation

- Payment consumes `orders.created` events and also exposes `POST /payments` for synchronous authorization; the gateway simulator supports `SUCCESS`, `INSUFFICIENT_FUNDS`, `NETWORK_TIMEOUT`, `INVALID_CARD` and `FRAUD_SUSPECTED`.
- Completed/failed transactions are persisted, idempotency keys are enforced, and immutable double-entry `CHARGE`/`REFUND` ledger entries are created.
- Refund handling consumes `orders.cancelled` and `kitchen.rejected` events, and publishes `payments.refunded`.
- Order cancellation is guarded by the state machine; cancellation is allowed only before `PREPARING`.

---

## Order lifecycle: end-to-end state machine

```text
CREATED --> CONFIRMED --> PREPARING --> READY --> OUT_FOR_DELIVERY --> DELIVERED
    |           |
    +-----------+--> CANCELLED
```

- FSM tests and code cover these legal transitions. Cancellation is disallowed after preparation begins (`HTTP 409 Conflict`).
- Payment completion transitions `CREATED -> CONFIRMED` and publishes `orders.confirmed`.
- Restaurant consumes `orders.confirmed`, emits `orders.preparing`, and emits `kitchen.orders.ready`.
- Delivery consumes `kitchen.orders.ready`, dispatches the nearest courier, and emits `delivery.status` (`OUT_FOR_DELIVERY` -> `DELIVERED`).

---

## Observability, monitoring and health

- Every service declares `/health` and `/metrics`; Prometheus scrapes `order-service:9091` and `customer-service:9093` through `admin-service:9098` on `/metrics` every 15 seconds.
- Grafana is provisioned with a Cluster Overview dashboard for HTTP request rate/latency, consumer lag and broker CPU.
- Prometheus UI: `http://localhost:9090`; Grafana: `http://localhost:3000`; dashboard UID: `cluster-overview`.

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

**What is evidenced:** seven separately packaged service projects, HTTP APIs/health surfaces, shared event contracts, Order pricing/state logic, Restaurant stock concurrency guards, Payment simulator/ledger logic, Haversine courier dispatch, resilient DLQ routing, observability configuration and automated tests.

### Questions
