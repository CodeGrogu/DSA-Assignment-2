# PeerPressure Final Defense: Master Demonstration Runbook

## 1. System Overview & Defense Readiness

This runbook guides the oral defense and technical demonstration of the **PeerPressure Distributed Food Delivery Platform**. The platform is operational end-to-end across all 7 Ballerina Swan Lake microservices, Apache Kafka, and MongoDB:

- **Order Service (`:9091`)**: Full order intake, dynamic surge pricing (civil solar CAT offset), finite state machine (FSM) validation, dual-mode persistence (MongoDB + in-memory cache), and Kafka event choreography.
- **Customer Service (`:9093`)**: Customer identity, address book, Namibian geospatial address verification (`/customers/verifyAddress`), and customer order history (`/customers/{customerId}/orders`).
- **Payment Service (`:9094`)**: Automated event-driven payment capture via `orders.created` and direct `POST /payments`, immutable double-entry ledger in `payments_db`, refund compensation sagas via `orders.cancelled`, and lookup endpoints (`/payments`, `/payments/{id}`, `/payments/order/{orderId}`).
- **Restaurant Service (`:9095`)**: Catalog management, 2dsphere location matching, indexed per-item atomic stock decrement via `mongodb:Update` operators, and kitchen status progression (`/restaurants/{id}/menu`, `/restaurants/{id}/order/validate-and-reserve`).
- **Delivery Service (`:9096`)**: Courier fleet tracking (`GET /drivers`), nearest-driver dispatch assignment via spherical Haversine distance, FSM enforcement via `peerpressure/delivery_domain`, background `kitchen.orders.ready` consumer, and tracking endpoints (`GET /delivery/track/{orderId}`, `GET /deliveries`, `POST /deliveries`).
- **Notification Service (`:9097`)**: Multi-channel alerting (SMS, PUSH, EMAIL) across all 9 domain topics + 4 `*.events` topics with `peerpressure/kafka_client` & `peerpressure/resilience` DLQ routing, MongoDB + file audit persistence, and query endpoints (`GET /notifications`, `GET /notifications/recipient/{id}`).
- **Admin Service (`:9098`)**: Real-time platform KPI calculation, GMV reporting, and cross-midnight SLA turnaround analysis (`/admin/stats/overview`, `/admin/reports/restaurant`, `/admin/reports/driver`, `/admin/sla/restaurants`, `/admin/sla/drivers`).

## 2. Defense Timing Breakdown (18 Minutes Total)

| Time | Segment | Mandatory Objectives | Verification Tool |
|---|---|---|---|
| 0:00–2:00 | Pre-flight & Health | Health probe sweep across all 7 microservices (`/health`) and infrastructure containers | HTTP curl sweep, Kafka UI (`:8085`), Mongo Express (`:8086`) |
| 2:00–7:00 | Architecture Presentation | C4 Container topology, choreographed event choreography, zero-collision ports | Architecture slides & diagrams |
| 7:00–14:00 | Happy-Path End-to-End Flow | Verify customer address → calculate surge quote → place order → payment clearance → kitchen prep → driver dispatch → delivery completion | REST calls & live state tracking |
| 14:00–16:30 | Failure Modes & Resilience | Input validation rejection (HTTP 400), cancellation FSM guards, stock shortage handling, and DLQ error routing | Fault injection & FSM guards |
| 16:30–18:00 | Conclusion & Q&A | Executive KPI overview in Admin Service & concluding remarks | `/admin/stats/overview` & Web Dashboard |

## 3. Pre-flight: prepare before the 1-minute clock

### 3.1 Start infrastructure and services

Use PowerShell from the repository root:

```powershell
docker compose -f .\docker-compose.infra.yml up -d --wait
docker compose -f .\docker\docker-compose.services.yml up -d --build
```

Check all seven health endpoints:

```powershell
foreach ($port in 9091,9093,9094,9095,9096,9097,9098) {
  curl.exe --fail --silent --show-error "http://localhost:$port/health"
  if ($LASTEXITCODE -ne 0) { throw "Health check failed on port $port" }
}
```

Or run the automated defense script:

```bash
bash scripts/run-defense.sh
```

Or run the 7-stage end-to-end integration test:

```bash
node tests/integration/e2e-lifecycle.mjs
```

## 4. Confirmed HTTP surfaces and ports

| Service | Base URL | Implemented resource paths |
|---|---|---|
| Order | `http://localhost:9091` | `GET /pricing/quote?unfulfilledOrders={n}&availableDrivers={n}`; `GET /pricing/current`; `POST /orders`; `GET /orders`; `GET /orders/{orderId}`; `POST /orders/{orderId}/cancel`; `GET /customers/{customerId}/orders` |
| Customer | `http://localhost:9093` | `POST /customers`; `GET /customers/{customerId}`; `POST /customers/{customerId}/addresses`; `PUT /customers/{customerId}/addresses/default`; `PUT /customers/{customerId}`; `DELETE /customers/{customerId}/addresses/{addressId}`; `POST /customers/verifyAddress` and `POST /customers/verify-address`; `GET /customers/{customerId}/orders?limit={n}&offset={n}` |
| Payment | `http://localhost:9094` | `POST /payments`; `GET /payments`; `GET /payments/{id}`; `GET /payments/order/{orderId}` |
| Restaurant | `http://localhost:9095` | `GET /restaurants`; `POST /restaurants`; `GET /restaurants/{restaurantId}`; `GET /restaurants/{restaurantId}/menu`; `POST /restaurants/{restaurantId}/menu/items`; `PUT /restaurants/{restaurantId}/menu/items/{itemId}/price`; `PUT /restaurants/{restaurantId}/menu/items/{itemId}/stock`; `POST /restaurants/{restaurantId}/menu/items/{itemId}/restock`; `PUT /restaurants/{restaurantId}/menu/items/{itemId}`; `POST /restaurants/{restaurantId}/order/validate-and-reserve`; `POST /seed` |
| Delivery | `http://localhost:9096` | `GET /delivery/track/{orderId}`; `GET /deliveries`; `GET /drivers`; `POST /deliveries`; `GET /health`; `GET /metrics` |
| Notification | `http://localhost:9097` | `GET /notifications`; `GET /notifications/recipient/{id}`; `GET /health`; `GET /metrics` |
| Admin | `http://localhost:9098` | `GET /admin/stats/overview`; `GET /admin/sla/restaurants`; `GET /admin/sla/drivers`; `GET /admin/reports/restaurant`; `GET /admin/reports/driver` |

## 5. Team ownership

- Jaden Awaseb—Lead Architecture, Dynamic Surge Pricing, Order Lifecycle Demo
- Henry Heita—Order Service & DB Schema
- Florinda Immanuel—Customer Service & Balance Management
- Tapiwa Machekera—Payment Service, Payment Processing & Saga Compensation
- Kondwani Kunkwenzu—Restaurant Service & Menu Concurrency
- May-Lee Mulundu—Delivery Service & Driver Dispatch
- Liina Massipa—Admin Service & Real-Time Web Monitor
- Nangukuii Kangootui—Integration Testing, Defense Runner, Architecture & Contributor Audits
