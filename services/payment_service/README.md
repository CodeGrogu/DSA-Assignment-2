# Payment Service (`services/payment_service`)

The **Payment Service** manages financial transactions, payment simulation, double-entry ledger bookkeeping, idempotency verification, and automated refund sagas for the distributed food delivery platform. It operates on HTTP port `9094`.

---

## 1. Responsibilities & Architecture

- **Event-Driven Payment Settlement**: Consumes `orders.created` and `orders.cancelled` from Kafka, deterministically evaluating payments and publishing financial results.
- **Double-Entry Ledger**: Appends immutable debit and credit ledger rows into MongoDB for every transaction. Refunds append offsetting reversal records rather than mutating prior ledger rows.
- **Dual Database Compatibility**: Supports both legacy singular `payment_db` and modern plural `payments_db` with `transactions`, `ledger_entries`, and `idempotency_keys` collections.
- **Strict Idempotency**: Guards against duplicate charges using unique MongoDB indexes on `idempotencyKey`. Duplicate requests return the original transaction receipt without reprocessing.
- **Configurable Simulator Outcomes**:
  Supports simulation modes: `SUCCESS`, `INSUFFICIENT_FUNDS`, `NETWORK_TIMEOUT`, `INVALID_CARD`, `FRAUD_SUSPECTED`. Can be globally configured in `Config.toml` or overridden per event using `simulatorOutcome`.

---

## 2. HTTP Endpoints

| Method | Path | Description | Expected Response |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Microservice health probe | `{"status": "UP", "service": "payment_service", "port": 9094}` |
| `GET` | `/metrics` | Prometheus metrics scrape | Prometheus text metrics |
| `GET` | `/payments/{id}` | Query payment by payment ID | `Transaction` record or `404 Not Found` |
| `GET` | `/payments/order/{orderId}` | Query payment by associated order ID | `Transaction` record or `404 Not Found` |

---

## 3. Kafka Topics & Event Contracts

- **Consumed Topics**:
  - `orders.created` / `orders.events` (Triggers payment authorization)
  - `orders.cancelled` (Triggers refund saga reversal)
  - `kitchen.rejected` (Triggers automated compensation refund)
- **Emitted Topics**:
  - `payments.events` (Unified stream of payment events)
  - `payments.completed` (Dedicated stream consumed by Order Service to confirm order)
  - `payments.failed` (Dedicated stream consumed by Order Service to abort FSM)
  - `payments.refunded` (Published when refund saga completes)

---

## 4. Configuration (`Config.toml`)

```toml
[payment_service]
port = 9094
kafkaBootstrapServers = "localhost:29092"   # In Docker: "kafka:9092"
mongoUri = "mongodb://payment_user:payment_password@localhost:27017/payments_db?authSource=payments_db"
orderTopic = "orders.created"
simulatorDefaultMode = "SUCCESS"
publishDedicatedPaymentTopics = true
```
