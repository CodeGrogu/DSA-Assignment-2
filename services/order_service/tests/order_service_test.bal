import ballerina/test;
import peerpressure/events as events;

@test:Config {}
function testOrderStoreLifecycleAndGuardEnforcement() returns error? {
    orderStore.clearMemory();

    events:Address addr = {
        street: "45 Sam Nujoma Dr",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "9000"
    };

    CreateOrderItem item1 = {
        itemId: "ITEM_1",
        name: "Braai Plate",
        quantity: 2,
        price: 60.0d
    };

    string orderId = "ord_test_lifecycle_001";
    string now = currentTimestamp();

    Order testOrder = {
        orderId: orderId,
        customerId: "cust_456",
        restaurantId: "rest_789",
        status: events:CREATED,
        items: [item1],
        itemsTotal: 120.0d,
        deliveryFee: 0.0d,
        surgeMultiplier: 1.0d,
        totalAmount: 120.0d,
        deliveryAddress: addr,
        createdAt: now,
        updatedAt: now
    };

    // 1. Save order
    check orderStore.save(testOrder);

    // 2. Query order
    Order? fetched = check orderStore.get(orderId);
    test:assertTrue(fetched is Order);
    if fetched is Order {
        test:assertEquals(fetched.status, events:CREATED);
        test:assertEquals(fetched.totalAmount, 120.0d);
    }

    // 3. Advance to CONFIRMED
    Order confirmed = check orderStore.updateStatus(orderId, events:CONFIRMED, "PAY_TX_999");
    test:assertEquals(confirmed.status, events:CONFIRMED);
    test:assertEquals(confirmed.paymentId, "PAY_TX_999");

    // 4. Advance to PREPARING
    Order preparing = check orderStore.updateStatus(orderId, events:PREPARING);
    test:assertEquals(preparing.status, events:PREPARING);

    // 5. Verify that in PREPARING state, cancellation is disallowed by guard
    test:assertFalse(isCancellable(preparing.status));

    // 5b. Verify that calling updateStatus to CANCELLED in PREPARING fails at the storage layer!
    Order|error illegalCancel = orderStore.updateStatus(orderId, events:CANCELLED);
    test:assertTrue(illegalCancel is error);

    // 6. Advance to READY
    Order ready = check orderStore.updateStatus(orderId, events:READY);
    test:assertEquals(ready.status, events:READY);

    // 7. Advance to OUT_FOR_DELIVERY
    Order inTransit = check orderStore.updateStatus(orderId, events:OUT_FOR_DELIVERY);
    test:assertEquals(inTransit.status, events:OUT_FOR_DELIVERY);

    // 8. Advance to DELIVERED
    Order delivered = check orderStore.updateStatus(orderId, events:DELIVERED);
    test:assertEquals(delivered.status, events:DELIVERED);
}

@test:Config {}
function testOrderStoreCancellationInCreatedState() returns error? {
    orderStore.clearMemory();

    events:Address addr = {
        street: "78 Nelson Mandela Ave",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "9000"
    };

    CreateOrderItem item = {
        itemId: "ITEM_2",
        name: "Oshifima Combo",
        quantity: 1,
        price: 35.0d
    };

    string orderId = "ord_test_cancel_002";
    string now = currentTimestamp();

    Order 'order = {
        orderId: orderId,
        customerId: "cust_888",
        restaurantId: "rest_999",
        status: events:CREATED,
        items: [item],
        itemsTotal: 35.0d,
        deliveryFee: 0.0d,
        surgeMultiplier: 1.0d,
        totalAmount: 35.0d,
        deliveryAddress: addr,
        createdAt: now,
        updatedAt: now
    };

    check orderStore.save('order);
    test:assertTrue(isCancellable('order.status));

    Order cancelled = check orderStore.updateStatus(orderId, events:CANCELLED, (), "Customer requested cancellation");
    test:assertEquals(cancelled.status, events:CANCELLED);
    test:assertEquals(cancelled.cancellationReason, "Customer requested cancellation");
}
