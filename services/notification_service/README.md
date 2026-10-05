# Notification Service (`services/notification_service`)

The **Notification Service** acts as the asynchronous multi-channel alerting hub and compliance audit logger for the PeerPressure distributed food delivery platform. It operates on HTTP port `9097`.

---

## 1. Responsibilities & Architecture

- **Multi-Channel Dispatching**: Simulates and formats notifications across three delivery channels:
  - `SMS`: Urgent order updates and courier arrival texts sent to customer phone numbers.
  - `PUSH`: Real-time push alerts sent to the Restaurant Kitchen Portal and Delivery Driver App.
  - `EMAIL`: Formal receipts, invoices, and cancellation summaries.
- **Subscription Rule Matrix**: Maps event types to recipient roles (`CUSTOMER`, `RESTAURANT`, `DRIVER`) and determines notification templates.
- **Audit Log Persistence**: Appends immutable audit records into MongoDB `notification_db.notifications` for compliance verification, admin reviews, and tracking.
- **Kafka Event Ingestion**: Consumes events across multiple domain streams:
  - `orders.events` / `orders.created` / `orders.confirmed` / `orders.cancelled`
  - `payments.events` / `payments.completed` / `payments.failed`
  - `kitchen.events` / `kitchen.orders.ready`
  - `delivery.events` / `delivery.assigned` / `delivery.status`

---

## 2. HTTP Endpoints

| Method | Path | Description | Expected Response |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Microservice health check | `{"status": "UP", "service": "notification_service", "port": 9097}` |
| `GET` | `/metrics` | Prometheus metrics scrape | Prometheus text metrics |
| `GET` | `/notifications` | List recent dispatched notification audit records | Array of `NotificationAuditRecord` |
| `GET` | `/notifications/recipient/{id}` | Query notifications sent to specific recipient | Array of matching audit records |

---

## 3. Configuration (`Config.toml`)

```toml
[notification_service]
port = 9097
kafkaBroker = "localhost:29092"   # In Docker: "kafka:9092"
mongoUri = "mongodb://notification_user:notification_password@localhost:27017/notification_db?authSource=notification_db"
```

Environment variable overrides:
- `KAFKA_BROKER`: Kafka broker address.
- `MONGO_URI`: MongoDB connection URI.
