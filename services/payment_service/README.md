# Payment service

The service consumes `OrderCreatedEvent` messages from `orders.created` by default and handles `OrderCancelledEvent` from `orders.cancelled` plus `KitchenRejectedEvent` from `kitchen.rejected`. It always publishes to `payments.events` and optionally duplicates completion and failure events to `payments.completed` and `payments.failed` when `publishDedicatedPaymentTopics` is enabled. Refunds are published to `payments.refunded`. Kafka message keys are order IDs.

`OrderCreatedEvent` follows the shared contract in `modules/events`: `eventId`, `orderId`, `customerId`, `restaurantId`, `items`, `totalAmount`, `deliveryAddress`, `status`, and `createdAt`. A missing currency is treated as NAD. `simulatorOutcome` may be supplied on the input event to override the configured simulator mode.

Example successful event:

```json
{
  "eventId": "evt-100",
  "orderId": "order-100",
  "customerId": "customer-10",
  "restaurantId": "restaurant-2",
  "items": [
    {
      "itemId": "item-1",
      "itemName": "Kapana",
      "quantity": 1,
      "unitPrice": 125.5,
      "subtotal": 125.5
    }
  ],
  "totalAmount": 125.5,
  "deliveryAddress": {
    "street": "1 Main Street",
    "city": "Windhoek",
    "state": "Khomas",
    "postalCode": "9000"
  },
  "status": "CREATED",
  "createdAt": "2026-10-04T12:00:00Z",
  "currency": "NAD",
  "simulatorOutcome": "SUCCESS"
}
```

Completion and failure event messages preserve the shared event fields and additionally include `transactionId`, `status`, and `timestamp`; completion uses `paymentId`/`transactionReference`, while failures expose `errorCode` and `reason`. The locally defined Kitchen-rejection payload is `{eventId, orderId, reason, rejectedAt}` because this repository currently has no Kitchen service or rejection contract.

## HTTP API

- `GET /payments/{id}` returns a transaction or `404`.
- `GET /payments/order/{orderId}` returns the order's payment or `404`.
- Errors use `{"error":{"code":"...","message":"..."}}`.

## Run and test

Build the monorepo from its root with `bal build`. Bring up Kafka and MongoDB, then build and run the payment container:

```powershell
docker compose -f docker-compose.infra.yml up -d
bal build
docker compose -f docker-compose.infra.yml -f docker/docker-compose.services.yml up -d --build payment-service
bal test services/payment_service
```

Use the `orderTopic` setting in `Config.toml` to consume `orders.created`, or set it to `orders.events` to subscribe to a shared topic (which is filtered by `type: "OrderCreatedEvent"`). Use the `simulatorDefaultMode` setting to select `SUCCESS`, `INSUFFICIENT_FUNDS`, `NETWORK_TIMEOUT`, `INVALID_CARD`, or `FRAUD_SUSPECTED`. Input `simulatorOutcome` overrides the default for one event. A timeout waits `gatewayTimeoutSeconds` and then yields a failed payment.

The checked-in `Config.toml` contains local-only Docker defaults (`root`/`password`), not deployment credentials. If the credentials or ports in `.env` are changed, update the matching `mongoUri`/`kafkaBootstrapServers` settings before starting the service.

The idempotency key is stored as MongoDB `_id` and explicit `key`/`idempotencyKey` fields with unique indexes for compatibility. The MongoDB initialization script migrates a legacy unique `orderId` index to a non-unique order/timestamp lookup index so refund transactions can be appended for an order. Ledger rows are append-only; refund rows reverse the original debit and credit rather than editing prior rows. Timestamps use RFC 3339 UTC strings.
