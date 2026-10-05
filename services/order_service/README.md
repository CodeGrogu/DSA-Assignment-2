# Order Service (`services/order_service`)

The **Order Service** is the central transactional coordinator and stateful core of the PeerPressure distributed food delivery platform. It operates on HTTP port `9091` and acts as the state machine orchestrator managing customer orders throughout their entire lifecycle.

---

## 1. Responsibilities & Architecture

- **Finite State Machine (FSM)**: Manages strict order lifecycle transitions:
  `CREATED` → `CONFIRMED` → `PREPARING` → `READY` → `OUT_FOR_DELIVERY` → `DELIVERED` (or `CANCELLED`).
  Illegal transitions and regressions from terminal states are blocked.
- **Dynamic Surge & Pricing Engine**: Calculates item subtotals, VAT tax (15% in Namibia), dynamic delivery fees based on distance, and civil solar surge multipliers (1.0× to 3.0× during Windhoek lunch and dinner peaks, CAT = UTC+2).
- **Dual-Mode Persistence**: Connects to MongoDB (`order_db.orders`) with automatic fallback to an isolated, thread-safe in-memory store during database maintenance or network partitions.
- **Kafka Event Choreography**:
  - **Emits**: `orders.created`, `orders.confirmed`, `orders.cancelled`.
  - **Consumes**: `payments.events` / `payments.completed`, `payments.failed`, `kitchen.orders.ready` / `kitchen.events`, `delivery.status` / `delivery.events`.
  - **Starvation Protection**: Asynchronous cooperative scheduler sleep yields (`runtime:sleep(0.5d)`) on empty polls to prevent Ballerina worker thread starvation.

---

## 2. HTTP Endpoints

| Method | Path | Description | Expected Payload / Response |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Microservice health probe | `{"status": "UP", "service": "order_service", "port": 9091}` |
| `GET` | `/metrics` | Prometheus / OpenMetrics scrape | Prometheus metrics output |
| `POST` | `/orders` | Place a new customer order | Request: `CreateOrderRequest` → Response: `201 Created` (`Order`) |
| `GET` | `/orders/{orderId}` | Fetch order details by ID | Response: `200 OK` (`Order`) or `404 Not Found` |
| `POST` | `/orders/{orderId}/cancel` | Cancel an order prior to prep | Request: `CancelOrderRequest` → Response: `200 OK` (`CancelOrderResponse`) |

### Example Order Creation Payload (`POST /orders`)
```json
{
  "customerId": "CUST-001",
  "restaurantId": "R001",
  "items": [
    {
      "itemId": "M1",
      "name": "Beef Kapana",
      "quantity": 2,
      "price": 50.00,
      "specialInstructions": ["Extra chili spice on the side"]
    }
  ],
  "deliveryAddress": {
    "street": "12 Independence Avenue",
    "city": "Windhoek",
    "state": "Khomas",
    "postalCode": "10005"
  }
}
```

---

## 3. Configuration (`Config.toml`)

```toml
[order_service]
port = 9091
kafkaBroker = "localhost:29092"   # Internal container: "kafka:9092"
mongoUri = "mongodb://order_user:order_password@localhost:27017/order_db?authSource=order_db"
```

Environment variable overrides:
- `KAFKA_BROKER`: Overrides Kafka broker address (e.g. `kafka:9092`).
- `MONGO_URI`: Overrides MongoDB connection string.

---

## 4. Kafka Topics & Choreography

```mermaid
flowchart LR
    client["Client (Customer)"] -->|"POST /orders"| orderSvc["Order Service (:9091)"]
    orderSvc -->|"orders.created"| kafka["Kafka Broker (:29092)"]
    kafka -->|"payments.completed"| orderSvc
    orderSvc -->|"orders.confirmed"| kafka
    kafka -->|"kitchen.orders.ready"| orderSvc
    kafka -->|"delivery.status (DELIVERED)"| orderSvc
```
