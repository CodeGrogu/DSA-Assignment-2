import ballerina/test;

// Positive serialization and schema validation tests

@test:Config {}
function testOrderCreatedSerializationAndValidation() returns error? {
    OrderItem item = {
        itemId: "item-101",
        itemName: "Cheeseburger Deluxe",
        quantity: 2,
        unitPrice: 45.50,
        subtotal: 91.00,
        specialInstructions: ["Extra pickles", "No onions"]
    };

    Address addr = {
        street: "14 Independence Avenue",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10005",
        coordinates: {
            latitude: -22.5609,
            longitude: 17.0658
        }
    };

    OrderCreated event = {
        eventId: "evt-ord-001",
        orderId: "ord-9001",
        customerId: "cust-101",
        restaurantId: "rest-202",
        items: [item],
        totalAmount: 91.00,
        deliveryAddress: addr,
        status: CREATED,
        createdAt: "2026-09-21T12:00:00Z"
    };

    // Immutability runtime check across record hierarchy
    anydata eventData = event;
    test:assertTrue(eventData is readonly, "OrderCreated must be deeply immutable");
    anydata itemsData = event.items;
    test:assertTrue(itemsData is readonly, "Order items must be deeply immutable");
    anydata addressData = event.deliveryAddress;
    test:assertTrue(addressData is readonly, "Delivery address must be deeply immutable");

    // Serialization helper test
    json eventJson = orderCreatedToJson(event);

    // Schema validation test
    OrderCreated validated = check validateOrderCreated(eventJson);
    test:assertEquals(validated.orderId, "ord-9001");
    test:assertEquals(validated.customerId, "cust-101");
    test:assertEquals(validated.restaurantId, "rest-202");
    test:assertEquals(validated.totalAmount, 91.00d);
    test:assertEquals(validated.status, CREATED);
    test:assertEquals(validated.items.length(), 1);
    test:assertEquals(validated.items[0].itemName, "Cheeseburger Deluxe");
}

@test:Config {}
function testPaymentCompletedSerializationAndValidation() returns error? {
    PaymentCompleted event = {
        eventId: "evt-pay-001",
        paymentId: "pay-501",
        orderId: "ord-9001",
        customerId: "cust-101",
        amount: 91.00,
        currency: "NAD",
        paymentMethod: "DEBIT_CARD",
        transactionReference: "TXN-20260921-9988",
        completedAt: "2026-09-21T12:02:15Z"
    };

    // Immutability check
    anydata eventData = event;
    test:assertTrue(eventData is readonly, "PaymentCompleted must be deeply immutable");

    // Serialization helper test
    json eventJson = paymentCompletedToJson(event);

    // Schema validation test
    PaymentCompleted validated = check validatePaymentCompleted(eventJson);
    test:assertEquals(validated.paymentId, "pay-501");
    test:assertEquals(validated.orderId, "ord-9001");
    test:assertEquals(validated.amount, 91.00d);
    test:assertEquals(validated.currency, "NAD");
    test:assertEquals(validated.transactionReference, "TXN-20260921-9988");
}

@test:Config {}
function testKitchenOrderReadySerializationAndValidation() returns error? {
    KitchenOrderReady event = {
        eventId: "evt-kit-001",
        orderId: "ord-9001",
        restaurantId: "rest-202",
        pickupReadyAt: "2026-09-21T12:15:30Z"
    };

    // Immutability check
    anydata eventData = event;
    test:assertTrue(eventData is readonly, "KitchenOrderReady must be deeply immutable");

    // Serialization helper test
    json eventJson = kitchenOrderReadyToJson(event);

    // Schema validation test
    KitchenOrderReady validated = check validateKitchenOrderReady(eventJson);
    test:assertEquals(validated.orderId, "ord-9001");
    test:assertEquals(validated.restaurantId, "rest-202");
    test:assertEquals(validated.pickupReadyAt, "2026-09-21T12:15:30Z");
}

@test:Config {}
function testDeliveryStatusUpdatedSerializationAndValidation() returns error? {
    GeoCoordinate coord = {
        latitude: -22.5695,
        longitude: 17.0850
    };

    DeliveryStatusUpdated event = {
        eventId: "evt-del-001",
        deliveryId: "del-701",
        orderId: "ord-9001",
        driverId: "drv-33",
        status: PICKED_UP,
        currentLocation: coord,
        updatedAt: "2026-09-21T12:20:00Z"
    };

    // Immutability check
    anydata eventData = event;
    test:assertTrue(eventData is readonly, "DeliveryStatusUpdated must be deeply immutable");
    anydata locData = event.currentLocation;
    test:assertTrue(locData is readonly, "Current location must be deeply immutable");

    // Serialization helper test
    json eventJson = deliveryStatusUpdatedToJson(event);

    // Schema validation test
    DeliveryStatusUpdated validated = check validateDeliveryStatusUpdated(eventJson);
    test:assertEquals(validated.deliveryId, "del-701");
    test:assertEquals(validated.driverId, "drv-33");
    test:assertEquals(validated.status, PICKED_UP);
    test:assertNotEquals(validated.currentLocation, ());
}

@test:Config {}
function testBackwardCompatibilityTypeAliases() returns error? {
    // Verify aliases point to identical immutable records
    OrderCreatedEvent orderEvt = {
        eventId: "evt-alias-01",
        orderId: "ord-alias-01",
        customerId: "cust-01",
        restaurantId: "rest-01",
        items: [
            {
                itemId: "it-1",
                itemName: "Drink",
                quantity: 1,
                unitPrice: 15.00,
                subtotal: 15.00,
                specialInstructions: []
            }
        ],
        totalAmount: 15.00,
        deliveryAddress: {
            street: "Sam Nujoma Drive",
            city: "Windhoek",
            state: "Khomas",
            postalCode: "10005"
        },
        status: CREATED,
        createdAt: "2026-09-21T10:00:00Z"
    };
    OrderCreated directOrder = orderEvt;
    test:assertEquals(directOrder.orderId, "ord-alias-01");

    PaymentCompletedEvent payEvt = {
        eventId: "evt-pay-alias",
        paymentId: "pay-alias",
        orderId: "ord-alias-01",
        customerId: "cust-01",
        amount: 15.00,
        currency: "NAD",
        paymentMethod: "CASH",
        transactionReference: "TXN-001",
        completedAt: "2026-09-21T10:01:00Z"
    };
    PaymentCompleted directPayment = payEvt;
    test:assertEquals(directPayment.paymentId, "pay-alias");

    KitchenReadyEvent kitEvt = {
        eventId: "evt-kit-alias",
        orderId: "ord-alias-01",
        restaurantId: "rest-01",
        pickupReadyAt: "2026-09-21T10:10:00Z"
    };
    KitchenOrderReady directKitchen = kitEvt;
    test:assertEquals(directKitchen.orderId, "ord-alias-01");

    DeliveryStatusUpdateEvent delEvt = {
        eventId: "evt-del-alias",
        deliveryId: "del-01",
        orderId: "ord-alias-01",
        driverId: "drv-01",
        status: ASSIGNED,
        updatedAt: "2026-09-21T10:12:00Z"
    };
    DeliveryStatusUpdated directDelivery = delEvt;
    test:assertEquals(directDelivery.deliveryId, "del-01");
}

// Negative schema validation tests

@test:Config {}
function testValidateOrderCreatedMissingRequiredField() {
    json invalidJson = {
        eventId: "evt-001",
        // missing orderId
        customerId: "cust-101",
        restaurantId: "rest-202",
        totalAmount: 50.00
    };

    OrderCreated|error result = validateOrderCreated(invalidJson);
    test:assertTrue(result is error, "Validation must fail when required field orderId is missing");
}

@test:Config {}
function testValidateOrderCreatedInvalidDataType() {
    json invalidJson = {
        eventId: "evt-001",
        orderId: "ord-001",
        customerId: "cust-101",
        restaurantId: "rest-202",
        items: "invalid-string-instead-of-array",
        totalAmount: 50.00,
        deliveryAddress: {
            street: "Street",
            city: "City",
            state: "State",
            postalCode: "10005"
        },
        createdAt: "2026-09-21T12:00:00Z"
    };

    OrderCreated|error result = validateOrderCreated(invalidJson);
    test:assertTrue(result is error, "Validation must fail when items is not an array");
}

@test:Config {}
function testValidateOrderCreatedInvalidStatusEnum() {
    json invalidJson = {
        eventId: "evt-001",
        orderId: "ord-001",
        customerId: "cust-101",
        restaurantId: "rest-202",
        items: [
            {
                itemId: "it-1",
                itemName: "Item",
                quantity: 1,
                unitPrice: 10.00,
                subtotal: 10.00,
                specialInstructions: []
            }
        ],
        totalAmount: 10.00,
        deliveryAddress: {
            street: "Street",
            city: "City",
            state: "State",
            postalCode: "10005"
        },
        status: "NON_EXISTENT_STATUS",
        createdAt: "2026-09-21T12:00:00Z"
    };

    OrderCreated|error result = validateOrderCreated(invalidJson);
    test:assertTrue(result is error, "Validation must fail when status is not a valid OrderStatus enum");
}

@test:Config {}
function testValidateOrderCreatedNegativeAmount() {
    json invalidJson = {
        eventId: "evt-001",
        orderId: "ord-001",
        customerId: "cust-101",
        restaurantId: "rest-202",
        items: [
            {
                itemId: "it-1",
                itemName: "Item",
                quantity: 1,
                unitPrice: 10.00,
                subtotal: 10.00,
                specialInstructions: []
            }
        ],
        totalAmount: -25.00,
        deliveryAddress: {
            street: "Street",
            city: "City",
            state: "State",
            postalCode: "10005"
        },
        status: "CREATED",
        createdAt: "2026-09-21T12:00:00Z"
    };

    OrderCreated|error result = validateOrderCreated(invalidJson);
    test:assertTrue(result is error, "Validation must fail when totalAmount is negative");
}

@test:Config {}
function testValidateOrderCreatedEmptyItemsList() {
    json invalidJson = {
        eventId: "evt-001",
        orderId: "ord-001",
        customerId: "cust-101",
        restaurantId: "rest-202",
        items: [],
        totalAmount: 0.00,
        deliveryAddress: {
            street: "Street",
            city: "City",
            state: "State",
            postalCode: "10005"
        },
        status: "CREATED",
        createdAt: "2026-09-21T12:00:00Z"
    };

    OrderCreated|error result = validateOrderCreated(invalidJson);
    test:assertTrue(result is error, "Validation must fail when items list is empty");
}

@test:Config {}
function testValidatePaymentCompletedNegativeAmount() {
    json invalidJson = {
        eventId: "evt-pay-01",
        paymentId: "pay-01",
        orderId: "ord-01",
        customerId: "cust-01",
        amount: -50.00,
        currency: "NAD",
        paymentMethod: "CARD",
        transactionReference: "TXN-001",
        completedAt: "2026-09-21T12:00:00Z"
    };

    PaymentCompleted|error result = validatePaymentCompleted(invalidJson);
    test:assertTrue(result is error, "Validation must fail when payment amount is negative");
}

@test:Config {}
function testValidatePaymentCompletedMissingField() {
    json invalidJson = {
        eventId: "evt-pay-01",
        paymentId: "pay-01",
        orderId: "ord-01",
        customerId: "cust-01",
        amount: 50.00,
        currency: "NAD"
        // missing transactionReference, paymentMethod, completedAt
    };

    PaymentCompleted|error result = validatePaymentCompleted(invalidJson);
    test:assertTrue(result is error, "Validation must fail when required payment fields are missing");
}

@test:Config {}
function testValidateKitchenOrderReadyMissingField() {
    json invalidJson = {
        eventId: "evt-kit-01",
        orderId: "ord-01"
        // missing restaurantId and pickupReadyAt
    };

    KitchenOrderReady|error result = validateKitchenOrderReady(invalidJson);
    test:assertTrue(result is error, "Validation must fail when kitchen fields are missing");
}

@test:Config {}
function testValidateDeliveryStatusUpdatedInvalidCoordinates() {
    json invalidJson = {
        eventId: "evt-del-01",
        deliveryId: "del-01",
        orderId: "ord-01",
        driverId: "drv-01",
        status: "PICKED_UP",
        currentLocation: {
            latitude: 195.0, // Invalid: exceeds 90 degrees
            longitude: 17.06
        },
        updatedAt: "2026-09-21T12:00:00Z"
    };

    DeliveryStatusUpdated|error result = validateDeliveryStatusUpdated(invalidJson);
    test:assertTrue(result is error, "Validation must fail when latitude is out of bounds");
}

@test:Config {}
function testValidateDeliveryStatusUpdatedInvalidEnum() {
    json invalidJson = {
        eventId: "evt-del-01",
        deliveryId: "del-01",
        orderId: "ord-01",
        driverId: "drv-01",
        status: "UNKNOWN_FLYING_STATUS",
        updatedAt: "2026-09-21T12:00:00Z"
    };

    DeliveryStatusUpdated|error result = validateDeliveryStatusUpdated(invalidJson);
    test:assertTrue(result is error, "Validation must fail when delivery status enum is invalid");
}
