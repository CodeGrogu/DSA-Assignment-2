import ballerina/test;

@test:Config {}
function testOrderCreatedEventSerialization() returns error? {
    OrderItem item = {
        itemId: "item-1",
        itemName: "Burger",
        quantity: 2,
        unitPrice: 9.99,
        subtotal: 19.98,
        specialInstructions: ["No onions"]
    };

    Address addr = {
        street: "123 Main St",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "9000"
    };

    OrderCreatedEvent event = {
        eventId: "evt-001",
        orderId: "ord-100",
        customerId: "cust-50",
        restaurantId: "rest-10",
        items: [item],
        totalAmount: 19.98,
        deliveryAddress: addr,
        status: CREATED,
        createdAt: "2026-09-16T12:00:00Z"
    };

    json eventJson = event.toJson();
    OrderCreatedEvent deserialized = check eventJson.cloneWithType(OrderCreatedEvent);
    test:assertEquals(deserialized.orderId, "ord-100");
    test:assertEquals(deserialized.status, CREATED);
    test:assertEquals(deserialized.items.length(), 1);
}

@test:Config {}
function testPaymentCompletedEventSerialization() returns error? {
    PaymentCompletedEvent event = {
        eventId: "evt-pay-001",
        paymentId: "pay-100",
        orderId: "ord-100",
        customerId: "cust-50",
        amount: 19.98,
        currency: "USD",
        paymentMethod: "CREDIT_CARD",
        transactionReference: "TXN-998877",
        completedAt: "2026-09-16T12:01:00Z"
    };

    json eventJson = event.toJson();
    PaymentCompletedEvent deserialized = check eventJson.cloneWithType(PaymentCompletedEvent);
    test:assertEquals(deserialized.paymentId, "pay-100");
    test:assertEquals(deserialized.amount, 19.98d);
}

@test:Config {}
function testDeliveryStatusUpdateEventSerialization() returns error? {
    GeoCoordinate coord = {
        latitude: -22.5609,
        longitude: 17.0658
    };

    DeliveryStatusUpdateEvent event = {
        eventId: "evt-del-001",
        deliveryId: "del-100",
        orderId: "ord-100",
        driverId: "drv-05",
        status: PICKED_UP,
        currentLocation: coord,
        updatedAt: "2026-09-16T12:15:00Z"
    };

    json eventJson = event.toJson();
    DeliveryStatusUpdateEvent deserialized = check eventJson.cloneWithType(DeliveryStatusUpdateEvent);
    test:assertEquals(deserialized.status, PICKED_UP);
}
