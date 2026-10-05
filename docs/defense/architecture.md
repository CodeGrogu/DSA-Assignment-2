# Distributed Alerting and Analytics - Architecture Reference

Who: Liina Massipa
Part of PR #155 - Defense documentation
Linear: PEE-101

This document is the technical reference behind the defense
demonstration. It covers the fan-out pub/sub design, the alert
dispatching pipeline, the analytics aggregation logic, and the
SLA monitoring pattern.

---

## 1. Fan-out pub/sub notification architecture

### 1.1 Why event-driven

Direct HTTP calls between services block. If the notification
service is slow, the order service that calls it has to wait or
fail. In our design, the order service publishes an event to Kafka
and moves on. Whoever cares about that event consumes it on their
own schedule.

That decoupling is the entire point of the architecture:

- The producer does not know which consumers exist
- Consumers can be added, removed, or scaled without touching producers
- A slow or crashed consumer does not affect the producer

### 1.2 Topics

We use four topics, each representing a business domain:

- `orders.events`
- `payments.events`
- `kitchen.events`
- `delivery.events`

Events are JSON envelopes with a type and a data payload, for example:

```json
{
  "eventType": "order.created",
  "data": {
    "eventId": "e1",
    "orderId": "o1",
    "customerId": "cust-42",
    "restaurantId": "r1",
    "totalAmount": 100.0
  }
}
```

### 1.3 The consumer

The notification service subscribes to all four topics using a single
Kafka consumer group called `notification-service`.

```ballerina
final kafka:ConsumerConfiguration consumerConfig = {
    groupId: CONSUMER_GROUP,
    topics: [TOPIC_ORDERS, TOPIC_PAYMENTS, TOPIC_KITCHEN, TOPIC_DELIVERY],
    offsetReset: kafka:OFFSET_RESET_EARLIEST,
    autoCommit: false
};
```

---

## 2. Alert dispatching pipeline

Every event follows the same path through the notification service.
The steps and their code locations:

### Step 1 - Envelope parsing

`parseEnvelope()` in `event_parser.bal` decodes the raw Kafka bytes
into JSON and checks that the message has both eventType and data.
Messages without that envelope are logged and dropped.

### Step 2 - Rule lookup

`rulesForEvent()` in `subscription_matrix.bal` returns all rules
matching the event type. If none match, the event is logged as
"No rules matched" and processing stops.

### Step 3 - Payload construction

`buildPayload()` in `dispatcher.bal` constructs a NotificationPayload
for each rule. It extracts the recipient ID from the event data based
on the recipient role:

- For CUSTOMER, it reads customerId
- For DRIVER, it reads driverId
- For RESTAURANT, it reads restaurantId

If the field is missing, the notification for that rule is skipped
with a warning. This is a safety net - malformed events cannot crash
the consumer.

### Step 4 - Template rendering

`renderSubject()` and `renderBody()` in `templates.bal` produce
human-readable text from the event type. Each rule has a template
name (for example sla_breach_customer), and the template function
maps that name to a message.

### Step 5 - Dispatch

`saveAudit()` in `audit_log.bal` writes one line per notification to
audit.log. The line format is:

timestamp | recipientId | channel | status | notificationId

Pipe-delimited so it is trivial to parse without a JSON library.

### Step 6 - Query

The service exposes GET /notifications/recipient/{id} on port 9095.
The endpoint reads the audit file, filters by recipient, and returns
a JSON array of notifications.

---

## 3. Analytics aggregation pipeline

The admin service (port 9098) exposes three endpoints. Each computes
an aggregation over the underlying data.

### 3.1 Overview endpoint

GET /admin/stats/overview returns platform-wide counts and sums:

- totalOrders - count of all orders
- grossMerchandiseValue - sum of totalAmount for orders that are not CANCELLED
- successfulPayments - count of payments with status COMPLETED
- failedPayments - count of payments with status FAILED
- activeDeliveries - count of deliveries with status not DELIVERED and not CANCELLED

### 3.2 Restaurant report

GET /admin/reports/restaurant?from=...&to=... groups orders by
restaurant and computes:

- orderCount - number of non-cancelled orders
- grossSales - sum of totalAmount
- commissionAmount - grossSales \* COMMISSION_RATE (10%)
- netPayout - grossSales minus commissionAmount

The from and to parameters filter by the createdAt date
(YYYY-MM-DD comparison). Both are optional.

### 3.3 Driver report

GET /admin/reports/driver?from=...&to=... groups deliveries by
driver and computes:

- completedDeliveries - count of deliveries with status DELIVERED
- averageTurnaroundMinutes - running mean of deliveredAt minus assignedAt
- slaBreaches - count of deliveries whose turnaround exceeds
  SLA_MINUTES (45 minutes by default)

### 3.4 MongoDB aggregation design

The current implementation reads from seed_data.json. The production
version would run the same logic as MongoDB aggregation pipelines.
Here is the equivalent pipeline for each report.

Overview - order totals:

```javascript
db.orders.aggregate([
  { $match: { status: { $ne: "CANCELLED" } } },
  {
    $group: {
      _id: null,
      totalOrders: { $sum: 1 },
      grossMerchandiseValue: { $sum: "$totalAmount" },
    },
  },
]);
```

// Restaurant report:

db.orders.aggregate([
{ $match: { status: { $ne: "CANCELLED" } } },
  { $group: {
      _id: "$restaurantId",
orderCount: { $sum: 1 },
      grossSales: { $sum: "$totalAmount" }
}},
{ $project: {
      _id: 0,
      restaurantId: "$\_id",
orderCount: 1,
grossSales: 1,
commissionAmount: { $multiply: ["$grossSales", 0.10] },
netPayout: { $subtract: ["$grossSales", { $multiply: ["$grossSales", 0.10] }] }
}}
])

// Driver with SLA breach count

db.deliveries.aggregate([
{ $match: { status: "DELIVERED" } },
  { $addFields: {
      turnaroundMin: {
        $divide: [
          { $subtract: ["$deliveredAt", "$assignedAt"] },
          60000
        ]
      }
  }},
  { $group: {
      _id: "$driverId",
driverName: { $first: "$driverName" },
completedDeliveries: { $sum: 1 },
      averageTurnaroundMinutes: { $avg: "$turnaroundMin" },
slaBreaches: {
$sum: { $cond: [{ $gt: ["$turnaroundMin", 45] }, 1, 0] }
}
}}
])

The Ballerina implementation in analytics.bal computes the same
result. If we switched the data source to MongoDB tomorrow, these
pipelines are what the service would issue. The HTTP layer would
not change.

---

## 4. SLA monitoring pattern

The SLA threshold is a single constant in analytics.bal:

```ballerina
const decimal SLA_MINUTES = 45.0d;
```

---

## 5. Scope and known limitations

### What is fully built

- admin_domain - shared types, subscription matrix
- notification_service - consumer, dispatcher, audit log, HTTP endpoint
- admin_service - overview and report endpoints

### What is scaffolded

- order_service, payment_service, delivery_service, restaurant_service,
  customer_service - each has a health endpoint and depends on the
  events contract. No business logic.

### Known issue

The Ballerina MongoDB connector 5.2.4 could not authenticate against
our dockerised Mongo. We tested against Mongo 6 and 7, on Java 21,
with hardcoded credentials, and the driver rejected the SCRAM
handshake each time. We documented the issue and switched the audit
log to a file. The interface (saveAudit, the HTTP endpoint) is
unchanged, so swapping back to Mongo when the connector is fixed
is a small change.

### What we would do next

- Split the notification consumer by topic to scale horizontally
- Move the audit log and analytics to MongoDB once the connector
  supports our environment
- Add real SMS and email gateways behind the existing dispatcher
- Wire the scaffolded services to produce real events on Kafka

---

## 6. Quick reference - which file does what

| File                                             | Purpose                     |
| ------------------------------------------------ | --------------------------- |
| modules/admin_domain/subscription_matrix.bal     | Event-to-notification rules |
| services/notification_service/kafka_listener.bal | Kafka consumer service      |
| services/notification_service/event_parser.bal   | Envelope decoding           |
| services/notification_service/dispatcher.bal     | Payload construction        |
| services/notification_service/templates.bal      | Message templates           |
| services/notification_service/audit_log.bal      | Persistence                 |
| services/notification_service/http_service.bal   | Query endpoint on 9095      |
| services/admin_service/analytics.bal             | Aggregation logic           |
| services/admin_service/data_loader.bal           | Reads seed data             |
| services/admin_service/service.bal               | HTTP endpoints on 9098      |
