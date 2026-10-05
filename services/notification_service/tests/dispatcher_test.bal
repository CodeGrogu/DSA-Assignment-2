import ballerina/test;

import peerpressure/admin_domain as domain;

@test:Config {}
function testParseOrderCreatedEnvelope() {
    json data = {
        "eventId": "evt-1",
        "orderId": "ord-1",
        "customerId": "cust-42",
        "restaurantId": "rest-9",
        "totalAmount": 250.00
    };
    json envelope = {"eventType": "order.created", "data": data};

    byte[] raw = envelope.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);

    test:assertTrue(parsed is ParsedEvent);
    if parsed is ParsedEvent {
        test:assertEquals(parsed.eventType, "order.created");
    }
}

@test:Config {}
function testBadEnvelopeIsRejected() {
    json notAnEnvelope = {"foo": "bar"};
    byte[] raw = notAnEnvelope.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);
    test:assertTrue(parsed is ());
}

@test:Config {}
function testExtractRecipientIdForCustomer() {
    json data = {"customerId": "cust-7", "orderId": "ord-9"};
    string? id = extractRecipientId(domain:CUSTOMER, data);
    test:assertEquals(id, "cust-7");
}

@test:Config {}
function testExtractRecipientIdMissingField() {
    json data = {"orderId": "ord-9"};
    string? id = extractRecipientId(domain:CUSTOMER, data);
    test:assertTrue(id is ());
}

@test:Config {}
function testRenderSubjectForSlaBreach() {
    test:assertEquals(renderSubject("sla_breach_customer"), "Order delay");
}

@test:Config {}
function testParseRawOrderCreatedEvent() {
    json rawOrder = {
        "eventId": "evt-raw-1",
        "orderId": "ord-1",
        "customerId": "cust-42",
        "restaurantId": "rest-9",
        "totalAmount": 250.00,
        "status": "CREATED",
        "createdAt": "2026-10-13T10:00:00Z"
    };
    byte[] raw = rawOrder.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);

    test:assertTrue(parsed is ParsedEvent);
    if parsed is ParsedEvent {
        test:assertEquals(parsed.eventType, "order.created");
        test:assertEquals(extractField(parsed.data, "orderId"), "ord-1");
        test:assertEquals(extractField(parsed.data, "customerId"), "cust-42");
    }
}

@test:Config {}
function testParseRawOrderConfirmedEvent() {
    json rawConfirmed = {
        "eventId": "evt-raw-2",
        "orderId": "ord-1",
        "paymentId": "pay-1",
        "estimatedDeliveryMinutes": 30,
        "confirmedAt": "2026-10-13T10:05:00Z"
    };
    byte[] raw = rawConfirmed.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);

    test:assertTrue(parsed is ParsedEvent);
    if parsed is ParsedEvent {
        test:assertEquals(parsed.eventType, "order.confirmed");
    }
}

@test:Config {}
function testParseRawPaymentCompletedEvent() {
    json rawPayment = {
        "eventId": "evt-raw-3",
        "paymentId": "pay-100",
        "orderId": "ord-1",
        "customerId": "cust-42",
        "amount": 250.00,
        "completedAt": "2026-10-13T10:06:00Z"
    };
    byte[] raw = rawPayment.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);

    test:assertTrue(parsed is ParsedEvent);
    if parsed is ParsedEvent {
        test:assertEquals(parsed.eventType, "payment.completed");
    }
}

@test:Config {}
function testParseRawKitchenOrderReadyEvent() {
    json rawKitchen = {
        "eventId": "evt-raw-4",
        "orderId": "ord-1",
        "restaurantId": "rest-9",
        "pickupAddress": "123 Main St",
        "pickupReadyAt": "2026-10-13T10:15:00Z"
    };
    byte[] raw = rawKitchen.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);

    test:assertTrue(parsed is ParsedEvent);
    if parsed is ParsedEvent {
        test:assertEquals(parsed.eventType, "kitchen.order.ready");
    }
}

@test:Config {}
function testParseRawDeliveryAssignedEvent() {
    json rawDelivery = {
        "eventId": "evt-raw-5",
        "deliveryId": "del-1",
        "orderId": "ord-1",
        "driverId": "drv-1",
        "driverName": "Alice",
        "driverPhone": "123456",
        "assignedAt": "2026-10-13T10:20:00Z"
    };
    byte[] raw = rawDelivery.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);

    test:assertTrue(parsed is ParsedEvent);
    if parsed is ParsedEvent {
        test:assertEquals(parsed.eventType, "delivery.assigned");
    }
}

@test:Config {}
function testParseRawDeliveryDeliveredStatusEvent() {
    json rawDeliveryStatus = {
        "eventId": "evt-raw-6",
        "deliveryId": "del-1",
        "orderId": "ord-1",
        "driverId": "drv-1",
        "status": "DELIVERED",
        "updatedAt": "2026-10-13T10:35:00Z"
    };
    byte[] raw = rawDeliveryStatus.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);

    test:assertTrue(parsed is ParsedEvent);
    if parsed is ParsedEvent {
        test:assertEquals(parsed.eventType, "delivery.completed");
    }
}

@test:Config {}
function testParseEnvelopeWithTopicFallback() {
    json minimalData = {
        "orderId": "ord-99"
    };
    byte[] raw = minimalData.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw, "orders.created");

    test:assertTrue(parsed is ParsedEvent);
    if parsed is ParsedEvent {
        test:assertEquals(parsed.eventType, "order.created");
    }
}

