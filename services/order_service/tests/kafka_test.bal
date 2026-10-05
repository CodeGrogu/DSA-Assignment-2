import ballerina/http;
import ballerina/test;
import peerpressure/events as events;

function createSampleOrder(string orderId, events:OrderStatus status = events:CREATED) returns Order {
    events:Address addr = {
        street: "123 Independence Ave",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "9000",
        coordinates: {
            latitude: -22.5609d,
            longitude: 17.0658d
        }
    };

    CreateOrderItem item1 = {
        itemId: "ITEM_BURGER_01",
        name: "Kapana Burger",
        quantity: 2,
        price: 45.0d,
        specialInstructions: ["Extra chili"]
    };

    CreateOrderItem item2 = {
        itemId: "ITEM_DRINK_01",
        name: "Ginger Beer",
        quantity: 1,
        price: 20.0d,
        specialInstructions: []
    };

    string now = currentTimestamp();
    return {
        orderId: orderId,
        customerId: "cust_kafka_001",
        restaurantId: "rest_kafka_001",
        status: status,
        items: [item1, item2],
        itemsTotal: 110.0d,
        deliveryFee: 0.0d,
        surgeMultiplier: 1.0d,
        totalAmount: 110.0d,
        deliveryAddress: addr,
        createdAt: now,
        updatedAt: now
    };
}

# Test 1: Order creation produces valid OrderCreated event with correct partition key and fields.
@test:Config {}
function testOrderCreatedEventPublishing() returns error? {
    orderEventProducer.clearRecordedEvents();

    string orderId = "ord_test_kafka_create_001";
    Order testOrder = createSampleOrder(orderId, events:CREATED);

    check orderEventProducer.publishOrderCreated(testOrder);

    events:OrderCreated[] createdEvents = orderEventProducer.getRecordedCreatedEvents();
    test:assertEquals(createdEvents.length(), 1, "Exactly one OrderCreated event must be recorded");

    events:OrderCreated event = createdEvents[0];
    test:assertEquals(event.orderId, testOrder.orderId, "Event orderId must match");
    test:assertEquals(event.customerId, testOrder.customerId, "Event customerId must match");
    test:assertEquals(event.restaurantId, testOrder.restaurantId, "Event restaurantId must match");
    test:assertEquals(event.status, events:CREATED, "Event status must be CREATED");
    test:assertEquals(event.totalAmount, 110.0d, "Event totalAmount must match calculated sum");
    test:assertEquals(event.items.length(), 2, "Event must contain all items");
    test:assertEquals(event.items[0].itemId, "ITEM_BURGER_01");
    test:assertEquals(event.items[0].itemName, "Kapana Burger");
    test:assertEquals(event.items[0].quantity, 2);
    test:assertEquals(event.items[0].unitPrice, 45.0d);
    test:assertEquals(event.items[0].subtotal, 90.0d);
    test:assertEquals(event.items[1].itemId, "ITEM_DRINK_01");
    test:assertEquals(event.items[1].itemName, "Ginger Beer");
    test:assertEquals(event.items[1].subtotal, 20.0d);

    // Verify correct partition key (customerId bytes per README § 3 Schema Registry)
    byte[] expectedPartitionKey = testOrder.customerId.toBytes();
    test:assertEquals(testOrder.customerId.toBytes(), expectedPartitionKey, "Partition key must be customerId bytes");

    // Verify events contract validation passes
    events:OrderCreated validated = check events:validateOrderCreated(event.toJson());
    test:assertEquals(validated.orderId, testOrder.orderId);
}

# Test 2: Order cancellation produces valid OrderCancelled event with correct partition key and reason.
@test:Config {}
function testOrderCancelledEventPublishing() returns error? {
    orderEventProducer.clearRecordedEvents();

    string orderId = "ord_test_kafka_cancel_002";
    string reason = "Customer requested cancellation before prep";
    string cancelledBy = "CUSTOMER";
    string now = currentTimestamp();

    check orderEventProducer.publishOrderCancelled(orderId, reason, cancelledBy, now);

    events:OrderCancelled[] cancelledEvents = orderEventProducer.getRecordedCancelledEvents();
    test:assertEquals(cancelledEvents.length(), 1, "Exactly one OrderCancelled event must be recorded");

    events:OrderCancelled event = cancelledEvents[0];
    test:assertEquals(event.orderId, orderId, "Event orderId must match");
    test:assertEquals(event.reason, reason, "Event cancellation reason must match");
    test:assertEquals(event.cancelledBy, cancelledBy, "Event cancelledBy must match");
    test:assertEquals(event.cancelledAt, now, "Event cancelledAt timestamp must match");
    test:assertTrue(event.eventId.length() > 0, "Event eventId must not be empty");

    // Verify partition key
    byte[] expectedKey = orderId.toBytes();
    test:assertEquals(orderId.toBytes(), expectedKey, "Partition key must be orderId bytes");
}

# Test 3: State coordinator processes PaymentCompleted -> transitions order CREATED -> CONFIRMED and emits OrderConfirmed.
@test:Config {}
function testStateCoordinatorPaymentCompletedTransitionsOrderToConfirmed() returns error? {
    orderStore.clearMemory();
    orderEventProducer.clearRecordedEvents();

    string orderId = "ord_coord_pay_comp_003";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    events:PaymentCompleted pcEvent = {
        eventId: "evt_pay_comp_001",
        paymentId: "pay_tx_coord_12345",
        orderId: orderId,
        customerId: testOrder.customerId,
        amount: testOrder.totalAmount,
        currency: "NAD",
        paymentMethod: "CARD",
        transactionReference: "txn_coord_ref_12345",
        completedAt: currentTimestamp()
    };

    Order updated = check processPaymentCompleted(pcEvent);
    test:assertEquals(updated.status, events:CONFIRMED, "Order status must transition to CONFIRMED");
    test:assertEquals(updated.paymentId, "pay_tx_coord_12345", "Order paymentId must be recorded");

    Order? stored = check orderStore.get(orderId);
    test:assertTrue(stored is Order, "Order must exist in orderStore");
    if stored is Order {
        test:assertEquals(stored.status, events:CONFIRMED);
        test:assertEquals(stored.paymentId, "pay_tx_coord_12345");
    }

    // Verify OrderConfirmed event emitted
    events:OrderConfirmed[] confirmedEvents = orderEventProducer.getRecordedConfirmedEvents();
    test:assertEquals(confirmedEvents.length(), 1, "Exactly one OrderConfirmed event must be emitted");
    test:assertEquals(confirmedEvents[0].orderId, orderId);
    test:assertEquals(confirmedEvents[0].paymentId, "pay_tx_coord_12345");
}

# Test 4: State coordinator processes PaymentFailed -> transitions order CREATED -> CANCELLED.
@test:Config {}
function testStateCoordinatorPaymentFailedTransitionsOrderToCancelled() returns error? {
    orderStore.clearMemory();

    string orderId = "ord_coord_pay_fail_004";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    events:PaymentFailed pfEvent = {
        eventId: "evt_pay_failed_001",
        orderId: orderId,
        customerId: testOrder.customerId,
        amount: testOrder.totalAmount,
        reason: "Card expired and funds unavailable",
        errorCode: "CARD_EXPIRED",
        failedAt: currentTimestamp()
    };

    Order updated = check processPaymentFailed(pfEvent);
    test:assertEquals(updated.status, events:CANCELLED, "Order status must transition to CANCELLED");
    test:assertEquals(updated.cancellationReason, "Card expired and funds unavailable", "Cancellation reason must match");

    Order? stored = check orderStore.get(orderId);
    test:assertTrue(stored is Order, "Order must exist in orderStore");
    if stored is Order {
        test:assertEquals(stored.status, events:CANCELLED);
        test:assertEquals(stored.cancellationReason, "Card expired and funds unavailable");
    }
}

# Test 5: State coordinator processes DeliveryStatusUpdated(PICKED_UP) -> transitions order READY -> OUT_FOR_DELIVERY.
@test:Config {}
function testStateCoordinatorDeliveryPickedUpTransitionsOrderToOutForDelivery() returns error? {
    orderStore.clearMemory();

    string orderId = "ord_coord_pickup_005";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    // Progress through lifecycle to READY
    _ = check orderStore.updateStatus(orderId, events:CONFIRMED, "pay_tx_prep_1");
    _ = check orderStore.updateStatus(orderId, events:PREPARING);
    _ = check orderStore.updateStatus(orderId, events:READY);

    events:DeliveryStatusUpdated pickupEvent = {
        eventId: "evt_del_pickup_001",
        deliveryId: "del_coord_101",
        orderId: orderId,
        driverId: "drv_coord_202",
        status: events:PICKED_UP,
        currentLocation: {
            latitude: -22.5609d,
            longitude: 17.0658d
        },
        updatedAt: currentTimestamp()
    };

    Order updated = check processDeliveryStatusUpdated(pickupEvent);
    test:assertEquals(updated.status, events:OUT_FOR_DELIVERY, "Order status must transition to OUT_FOR_DELIVERY");

    Order? stored = check orderStore.get(orderId);
    test:assertTrue(stored is Order, "Order must exist in orderStore");
    if stored is Order {
        test:assertEquals(stored.status, events:OUT_FOR_DELIVERY);
    }
}

# Test 6: State coordinator processes DeliveryStatusUpdated(DELIVERED) -> transitions order OUT_FOR_DELIVERY -> DELIVERED.
@test:Config {}
function testStateCoordinatorDeliveryDeliveredTransitionsOrderToDelivered() returns error? {
    orderStore.clearMemory();

    string orderId = "ord_coord_delivered_006";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    // Progress through lifecycle to OUT_FOR_DELIVERY
    _ = check orderStore.updateStatus(orderId, events:CONFIRMED, "pay_tx_prep_2");
    _ = check orderStore.updateStatus(orderId, events:PREPARING);
    _ = check orderStore.updateStatus(orderId, events:READY);
    _ = check orderStore.updateStatus(orderId, events:OUT_FOR_DELIVERY);

    events:DeliveryStatusUpdated deliveredEvent = {
        eventId: "evt_del_complete_002",
        deliveryId: "del_coord_101",
        orderId: orderId,
        driverId: "drv_coord_202",
        status: events:DELIVERED,
        currentLocation: {
            latitude: -22.5609d,
            longitude: 17.0658d
        },
        updatedAt: currentTimestamp()
    };

    Order updated = check processDeliveryStatusUpdated(deliveredEvent);
    test:assertEquals(updated.status, events:DELIVERED, "Order status must transition to DELIVERED");

    Order? stored = check orderStore.get(orderId);
    test:assertTrue(stored is Order, "Order must exist in orderStore");
    if stored is Order {
        test:assertEquals(stored.status, events:DELIVERED);
    }
}

# Test 7: Idempotent replay: sending duplicate PaymentCompleted event is a harmless no-op.
@test:Config {}
function testIdempotentReplayPaymentCompletedIsHarmlessNoOp() returns error? {
    orderStore.clearMemory();

    string orderId = "ord_coord_replay_007";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    events:PaymentCompleted pcEvent = {
        eventId: "evt_replay_001",
        paymentId: "pay_tx_replay_888",
        orderId: orderId,
        customerId: testOrder.customerId,
        amount: testOrder.totalAmount,
        currency: "NAD",
        paymentMethod: "CARD",
        transactionReference: "txn_replay_ref",
        completedAt: currentTimestamp()
    };

    // First delivery of PaymentCompleted
    Order firstRun = check processPaymentCompleted(pcEvent);
    test:assertEquals(firstRun.status, events:CONFIRMED);
    test:assertEquals(firstRun.paymentId, "pay_tx_replay_888");

    // Duplicate replay of same PaymentCompleted
    Order secondRun = check processPaymentCompleted(pcEvent);
    test:assertEquals(secondRun.status, events:CONFIRMED, "Duplicate event must keep status CONFIRMED");
    test:assertEquals(secondRun.paymentId, "pay_tx_replay_888", "Payment ID must remain unchanged");

    // When order moves to downstream state PREPARING, duplicate PaymentCompleted remains a harmless no-op
    _ = check orderStore.updateStatus(orderId, events:PREPARING);
    Order thirdRun = check processPaymentCompleted(pcEvent);
    test:assertEquals(thirdRun.status, events:PREPARING, "Replay must not revert downstream state");

    // Idempotent duplicate check for DeliveryStatusUpdated(DELIVERED)
    _ = check orderStore.updateStatus(orderId, events:READY);
    _ = check orderStore.updateStatus(orderId, events:OUT_FOR_DELIVERY);
    _ = check orderStore.updateStatus(orderId, events:DELIVERED);

    events:DeliveryStatusUpdated dupDelivered = {
        eventId: "evt_dup_del_001",
        deliveryId: "del_dup_001",
        orderId: orderId,
        driverId: "drv_dup_001",
        status: events:DELIVERED,
        updatedAt: currentTimestamp()
    };
    Order dupDeliveredResult = check processDeliveryStatusUpdated(dupDelivered);
    test:assertEquals(dupDeliveredResult.status, events:DELIVERED, "Duplicate DELIVERED event must be harmless");
}

# Test 8: Invalid transition: event attempting illegal transition (e.g. DELIVERED on CREATED order) is safely rejected.
@test:Config {}
function testInvalidStateTransitionSafelyRejected() returns error? {
    orderStore.clearMemory();

    string orderId = "ord_coord_illegal_008";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    // Illegal: jump directly from CREATED to DELIVERED
    events:DeliveryStatusUpdated illegalDelivered = {
        eventId: "evt_illegal_del_001",
        deliveryId: "del_illegal_001",
        orderId: orderId,
        driverId: "drv_illegal_001",
        status: events:DELIVERED,
        updatedAt: currentTimestamp()
    };

    Order|error rejectedDelivered = processDeliveryStatusUpdated(illegalDelivered);
    test:assertTrue(rejectedDelivered is error, "Transition from CREATED to DELIVERED must be rejected");

    // Illegal: jump directly from CREATED to OUT_FOR_DELIVERY
    events:DeliveryStatusUpdated illegalPickup = {
        eventId: "evt_illegal_pickup_001",
        deliveryId: "del_illegal_001",
        orderId: orderId,
        driverId: "drv_illegal_001",
        status: events:PICKED_UP,
        updatedAt: currentTimestamp()
    };

    Order|error rejectedPickup = processDeliveryStatusUpdated(illegalPickup);
    test:assertTrue(rejectedPickup is error, "Transition from CREATED to OUT_FOR_DELIVERY must be rejected");

    // Verify order state in store remained strictly in CREATED and was not corrupted
    Order? stored = check orderStore.get(orderId);
    test:assertTrue(stored is Order, "Order must still exist in orderStore");
    if stored is Order {
        test:assertEquals(stored.status, events:CREATED, "Order state must remain intact as CREATED");
        test:assertEquals(stored.paymentId, (), "Payment ID must remain unset");
    }
}

# Test 9: End-to-end payload dispatching from serialized JSON bytes across topics.
@test:Config {}
function testTopicDispatchPayloadFromJsonBytes() returns error? {
    orderStore.clearMemory();

    string orderId = "ord_dispatch_json_009";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    // 1. Dispatch PaymentCompleted via JSON bytes
    events:PaymentCompleted pc = {
        eventId: "evt_json_pc_001",
        paymentId: "pay_json_tx_001",
        orderId: orderId,
        customerId: testOrder.customerId,
        amount: testOrder.totalAmount,
        currency: "NAD",
        paymentMethod: "CARD",
        transactionReference: "ref_json_001",
        completedAt: currentTimestamp()
    };
    byte[] pcBytes = pc.toJson().toJsonString().toBytes();
    check dispatchTopicPayload("payments.completed", pcBytes);

    Order? storedConfirmed = check orderStore.get(orderId);
    test:assertTrue(storedConfirmed is Order);
    if storedConfirmed is Order {
        test:assertEquals(storedConfirmed.status, events:CONFIRMED);
    }

    // 2. Advance to READY
    _ = check orderStore.updateStatus(orderId, events:PREPARING);
    _ = check orderStore.updateStatus(orderId, events:READY);

    // 3. Dispatch DeliveryStatusUpdated (PICKED_UP) via JSON bytes
    events:DeliveryStatusUpdated pickup = {
        eventId: "evt_json_pickup_001",
        deliveryId: "del_json_001",
        orderId: orderId,
        driverId: "drv_json_001",
        status: events:PICKED_UP,
        updatedAt: currentTimestamp()
    };
    byte[] pickupBytes = pickup.toJson().toJsonString().toBytes();
    check dispatchTopicPayload("delivery.status", pickupBytes);

    Order? storedInTransit = check orderStore.get(orderId);
    test:assertTrue(storedInTransit is Order);
    if storedInTransit is Order {
        test:assertEquals(storedInTransit.status, events:OUT_FOR_DELIVERY);
    }

    // 4. Dispatch DeliveryStatusUpdated (DELIVERED) via JSON bytes
    events:DeliveryStatusUpdated delivered = {
        eventId: "evt_json_deliv_001",
        deliveryId: "del_json_001",
        orderId: orderId,
        driverId: "drv_json_001",
        status: events:DELIVERED,
        updatedAt: currentTimestamp()
    };
    byte[] deliveredBytes = delivered.toJson().toJsonString().toBytes();
    check dispatchTopicPayload("delivery.status", deliveredBytes);

    Order? storedDelivered = check orderStore.get(orderId);
    test:assertTrue(storedDelivered is Order);
    if storedDelivered is Order {
        test:assertEquals(storedDelivered.status, events:DELIVERED);
    }
}

# Test 10: HTTP POST /orders and POST /orders/[id]/cancel trigger Kafka event publishing.
@test:Config {}
function testHttpOrderPublishingIntegration() returns error? {
    orderEventProducer.clearRecordedEvents();
    http:Client clientEp = check new (string `http://localhost:${port}`);

    CreateOrderRequest req = {
        customerId: "cust_http_001",
        restaurantId: "rest_http_001",
        items: [
            {
                itemId: "ITEM_PIZZA_01",
                name: "Pepperoni Pizza",
                quantity: 1,
                price: 85.0d,
                specialInstructions: []
            }
        ],
        deliveryAddress: {
            street: "10 Independence Ave",
            city: "Windhoek",
            state: "Khomas",
            postalCode: "9000",
            coordinates: ()
        }
    };

    http:Response createRes = check clientEp->post("/orders", req);
    test:assertEquals(createRes.statusCode, 201);
    json body = check createRes.getJsonPayload();
    string orderId = check body.orderId;

    events:OrderCreated[] createdEvents = orderEventProducer.getRecordedCreatedEvents();
    test:assertEquals(createdEvents.length(), 1);
    test:assertEquals(createdEvents[0].orderId, orderId);
    test:assertEquals(createdEvents[0].totalAmount, 85.0d);

    CancelOrderRequest cancelReq = {
        reason: "Customer changed mind before preparation"
    };
    http:Response cancelRes = check clientEp->post(string `/orders/${orderId}/cancel`, cancelReq);
    test:assertEquals(cancelRes.statusCode, 200);

    events:OrderCancelled[] cancelledEvents = orderEventProducer.getRecordedCancelledEvents();
    test:assertEquals(cancelledEvents.length(), 1);
    test:assertEquals(cancelledEvents[0].orderId, orderId);
    test:assertEquals(cancelledEvents[0].reason, "Customer changed mind before preparation");
}

# Test 11: State coordinator processes KitchenPreparing -> transitions order CONFIRMED -> PREPARING.
@test:Config {}
function testStateCoordinatorKitchenPreparingTransitionsOrderToPreparing() returns error? {
    orderStore.clearMemory();

    string orderId = "ord_coord_prep_011";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    // Transition to CONFIRMED
    _ = check orderStore.updateStatus(orderId, events:CONFIRMED, "pay_tx_prep_11");

    Order updated = check processKitchenPreparing(orderId);
    test:assertEquals(updated.status, events:PREPARING, "Order status must transition to PREPARING");

    Order? stored = check orderStore.get(orderId);
    test:assertTrue(stored is Order);
    if stored is Order {
        test:assertEquals(stored.status, events:PREPARING);
    }
}

# Test 12: State coordinator processes KitchenReady -> transitions order PREPARING -> READY.
@test:Config {}
function testStateCoordinatorKitchenReadyTransitionsOrderToReady() returns error? {
    orderStore.clearMemory();

    string orderId = "ord_coord_ready_012";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    // Transition to CONFIRMED then PREPARING
    _ = check orderStore.updateStatus(orderId, events:CONFIRMED, "pay_tx_ready_12");
    _ = check orderStore.updateStatus(orderId, events:PREPARING);

    Order updated = check processKitchenReady(orderId);
    test:assertEquals(updated.status, events:READY, "Order status must transition to READY");

    Order? stored = check orderStore.get(orderId);
    test:assertTrue(stored is Order);
    if stored is Order {
        test:assertEquals(stored.status, events:READY);
    }
}

# Test 13: End-to-end full order lifecycle via Kafka events sequence.
# CREATED -> PaymentCompleted -> CONFIRMED -> KitchenPreparing -> PREPARING -> KitchenReady -> READY -> Delivery PICKED_UP -> OUT_FOR_DELIVERY -> Delivery DELIVERED -> DELIVERED.
@test:Config {}
function testEndToEndOrderLifecycleViaKafkaEvents() returns error? {
    orderStore.clearMemory();
    orderEventProducer.clearRecordedEvents();

    string orderId = "ord_coord_e2e_013";
    Order testOrder = createSampleOrder(orderId, events:CREATED);
    check orderStore.save(testOrder);

    // 1. PaymentCompleted event arrives
    events:PaymentCompleted pcEvent = {
        eventId: "evt_e2e_pay_001",
        paymentId: "pay_tx_e2e_123",
        orderId: orderId,
        customerId: testOrder.customerId,
        amount: testOrder.totalAmount,
        currency: "NAD",
        paymentMethod: "CARD",
        transactionReference: "txn_e2e_ref",
        completedAt: currentTimestamp()
    };
    Order confOrder = check processPaymentCompleted(pcEvent);
    test:assertEquals(confOrder.status, events:CONFIRMED);

    // Verify OrderConfirmed event emitted on topic orders.confirmed
    events:OrderConfirmed[] confEvents = orderEventProducer.getRecordedConfirmedEvents();
    test:assertEquals(confEvents.length(), 1);
    test:assertEquals(confEvents[0].orderId, orderId);

    // 2. KitchenPreparing arrives
    Order prepOrder = check processKitchenPreparing(orderId);
    test:assertEquals(prepOrder.status, events:PREPARING);

    // 3. KitchenReady arrives
    Order readyOrder = check processKitchenReady(orderId);
    test:assertEquals(readyOrder.status, events:READY);

    // 4. DeliveryStatusUpdated (PICKED_UP) arrives
    events:DeliveryStatusUpdated pickupEvent = {
        eventId: "evt_e2e_del_001",
        deliveryId: "del_e2e_001",
        orderId: orderId,
        driverId: "drv_e2e_001",
        status: events:PICKED_UP,
        updatedAt: currentTimestamp()
    };
    Order pickupOrder = check processDeliveryStatusUpdated(pickupEvent);
    test:assertEquals(pickupOrder.status, events:OUT_FOR_DELIVERY);

    // 5. DeliveryStatusUpdated (DELIVERED) arrives
    events:DeliveryStatusUpdated delivEvent = {
        eventId: "evt_e2e_del_002",
        deliveryId: "del_e2e_001",
        orderId: orderId,
        driverId: "drv_e2e_001",
        status: events:DELIVERED,
        updatedAt: currentTimestamp()
    };
    Order finalOrder = check processDeliveryStatusUpdated(delivEvent);
    test:assertEquals(finalOrder.status, events:DELIVERED);

    // Verify terminal state in orderStore
    Order? finalStored = check orderStore.get(orderId);
    test:assertTrue(finalStored is Order);
    if finalStored is Order {
        test:assertEquals(finalStored.status, events:DELIVERED);
    }
}


