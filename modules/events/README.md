# Shared Events Package (`peerpressure/events`)

The `events` package defines canonical, immutable Ballerina records, enumerations, validation logic, and serialization schemas for event choreography across the Distributed Food Delivery Platform.

---

## 1. Event Contracts Registry

| Event Record | Topic(s) | Key | Emitted By | Primary Consumers |
| :--- | :--- | :--- | :--- | :--- |
| `OrderCreatedEvent` | `orders.created`, `orders.events` | `customerId` | Order Service | Payment Service, Notification Service |
| `OrderConfirmedEvent` | `orders.confirmed`, `orders.events` | `orderId` | Order Service | Restaurant Service, Notification Service, Admin Service |
| `OrderCancelledEvent` | `orders.cancelled`, `orders.events` | `orderId` | Order Service | Payment Service (Refunds), Notification Service |
| `PaymentCompletedEvent`| `payments.completed`, `payments.events` | `orderId` | Payment Service | Order Service, Notification Service |
| `PaymentFailedEvent` | `payments.failed`, `payments.events` | `orderId` | Payment Service | Order Service, Notification Service |
| `KitchenStatusEvent` / `KitchenOrderReady` | `kitchen.orders.ready`, `orders.preparing`, `kitchen.events` | `orderId` | Restaurant Service | Order Service, Delivery Service, Notification Service |
| `DeliveryAssignedEvent`| `delivery.assigned`, `delivery.events` | `driverId` | Delivery Service | Order Service, Notification Service |
| `DeliveryStatusEvent` / `DeliveryStatusUpdated` | `delivery.status`, `delivery.events` | `orderId` | Delivery Service | Order Service, Notification Service, Admin Service |
| `NotificationEvent` | `notifications.dispatched` | `recipientId` | Notification Service | Admin Analytics, Audit Logger |

---

## 2. Validation & Serialization

Every canonical event record has a corresponding:
- Serializer: `*ToJson(event)` converting typed Ballerina records into wire-ready JSON objects.
- Deserializer & Validator: `validate*(jsonPayload)` ensuring:
  - Required non-blank fields (`eventId`, `orderId`, timestamps).
  - Positive numeric quantities and non-negative financial values.
  - Subtotal consistency: item subtotals match quantity × price.
  - Total consistency: order total matches sum of item subtotals + delivery fees.
  - Valid latitude/longitude bounds.

---

## 3. Installation & Dependency

```toml
[[dependency]]
org = "peerpressure"
name = "events"
version = "0.1.0"
repository = "local"
```
