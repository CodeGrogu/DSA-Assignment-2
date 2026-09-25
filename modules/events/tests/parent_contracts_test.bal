import ballerina/test;

@test:Config {}
function testPaymentFailedContract() returns error? {
    PaymentFailedEvent event = {
        eventId: "evt-failed", orderId: "ord-1", customerId: "cust-1", amount: 20.50,
        reason: "Declined", errorCode: "CARD_DECLINED", failedAt: "2026-09-21T12:02:00Z"
    };
    test:assertEquals(check validatePaymentFailed(paymentFailedToJson(event)), event);

    map<json> invalid = {
        eventId: "evt-failed", orderId: "ord-1", customerId: "cust-1", amount: -1.00,
        reason: "Declined", errorCode: "CARD_DECLINED", failedAt: "2026-09-21T12:02:00Z"
    };
    test:assertTrue(validatePaymentFailed(invalid) is error);
}

@test:Config {}
function testKitchenStatusContract() returns error? {
    KitchenStatusEvent event = {
        eventId: "evt-kitchen", orderId: "ord-1", restaurantId: "rest-1",
        status: PREPARING, updatedAt: "2026-09-21T12:03:00Z"
    };
    test:assertEquals(check validateKitchenStatus(kitchenStatusToJson(event)), event);

    map<json> invalid = {
        eventId: "evt-kitchen", orderId: "ord-1", restaurantId: "rest-1",
        status: "DELIVERED", updatedAt: "2026-09-21T12:03:00Z"
    };
    test:assertTrue(validateKitchenStatus(invalid) is error);
}

@test:Config {}
function testDeliveryAssignedContract() returns error? {
    DeliveryAssignedEvent event = {
        eventId: "evt-assigned", deliveryId: "del-1", orderId: "ord-1", driverId: "drv-1",
        driverName: "Driver", driverPhone: "+26412345678", assignedAt: "2026-09-21T12:04:00Z"
    };
    test:assertEquals(check validateDeliveryAssigned(deliveryAssignedToJson(event)), event);

    map<json> invalid = {
        eventId: "evt-assigned", deliveryId: "del-1", orderId: "ord-1", driverId: "drv-1",
        driverName: "Driver", driverPhone: " ", assignedAt: "2026-09-21T12:04:00Z"
    };
    test:assertTrue(validateDeliveryAssigned(invalid) is error);
}

@test:Config {}
function testDeliveryStatusAliasContract() returns error? {
    DeliveryStatusEvent event = {
        eventId: "evt-status", deliveryId: "del-1", orderId: "ord-1", driverId: "drv-1",
        status: PICKED_UP, currentLocation: {latitude: -22.57, longitude: 17.08},
        updatedAt: "2026-09-21T12:05:00Z"
    };
    test:assertEquals(check validateDeliveryStatus(deliveryStatusToJson(event)), event);

    map<json> invalid = {
        eventId: "evt-status", deliveryId: "del-1", orderId: "ord-1", driverId: "drv-1",
        status: "PICKED_UP", currentLocation: {latitude: 95.0, longitude: 17.08},
        updatedAt: "2026-09-21T12:05:00Z"
    };
    test:assertTrue(validateDeliveryStatus(invalid) is error);
}

@test:Config {}
function testNotificationContract() returns error? {
    NotificationEvent event = {
        eventId: "evt-notify", recipientId: "cust-1", channel: "SMS", subject: "Order update",
        message: "Ready", orderId: "ord-1", timestamp: "2026-09-21T12:06:00Z"
    };
    test:assertEquals(check validateNotificationEvent(notificationEventToJson(event)), event);

    map<json> invalid = {
        eventId: "evt-notify", recipientId: "cust-1", channel: "SMS", subject: "Order update",
        message: " ", timestamp: "2026-09-21T12:06:00Z"
    };
    test:assertTrue(validateNotificationEvent(invalid) is error);
}
