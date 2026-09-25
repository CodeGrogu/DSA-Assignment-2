# Shared Events Package (`peerpressure/events`)

Canonical Ballerina records, enumerations, and contract schemas for the Distributed Food Delivery Platform.

The seven parent-issue event names are `OrderCreatedEvent`, `PaymentCompletedEvent`,
`PaymentFailedEvent`, `KitchenStatusEvent`, `DeliveryAssignedEvent`,
`DeliveryStatusEvent`, and `NotificationEvent`. Existing `KitchenOrderReady` and
`DeliveryStatusUpdated` records and aliases remain supported. `KitchenStatusEvent`
represents `PREPARING` or `READY`; `DeliveryStatusEvent` aliases the existing
delivery-status payload. Each parent-issue event has a `*ToJson` serializer and
`validate*` deserializer in `validation.bal`.

Validation enforces closed record shapes, enum values, nonblank required identifiers,
amount and coordinate bounds, and consistency of order item and total amounts. It
does not yet parse timestamp strings or check currency/phone formats. No registry
service or message broker is needed to use these compile-time contracts.
