import ballerina/test;
import peerpressure/events as events;

@test:Config {}
function testValidStateTransitions() {
    // 1. CREATED -> CONFIRMED
    StateTransitionResult res1 = validateTransition(events:CREATED, events:CONFIRMED);
    test:assertTrue(res1.allowed);

    // 2. CREATED -> CANCELLED
    StateTransitionResult res2 = validateTransition(events:CREATED, events:CANCELLED);
    test:assertTrue(res2.allowed);

    // 3. CONFIRMED -> PREPARING
    StateTransitionResult res3 = validateTransition(events:CONFIRMED, events:PREPARING);
    test:assertTrue(res3.allowed);

    // 4. CONFIRMED -> CANCELLED
    StateTransitionResult res4 = validateTransition(events:CONFIRMED, events:CANCELLED);
    test:assertTrue(res4.allowed);

    // 5. PREPARING -> READY
    StateTransitionResult res5 = validateTransition(events:PREPARING, events:READY);
    test:assertTrue(res5.allowed);

    // 6. READY -> OUT_FOR_DELIVERY
    StateTransitionResult res6 = validateTransition(events:READY, events:OUT_FOR_DELIVERY);
    test:assertTrue(res6.allowed);

    // 7. OUT_FOR_DELIVERY -> DELIVERED
    StateTransitionResult res7 = validateTransition(events:OUT_FOR_DELIVERY, events:DELIVERED);
    test:assertTrue(res7.allowed);
}

@test:Config {}
function testInvalidStateTransitionsAreRejected() {
    // Cannot skip states: CREATED -> READY
    StateTransitionResult jump1 = validateTransition(events:CREATED, events:READY);
    test:assertFalse(jump1.allowed);

    // Cannot skip states: CREATED -> DELIVERED
    StateTransitionResult jump2 = validateTransition(events:CREATED, events:DELIVERED);
    test:assertFalse(jump2.allowed);

    // Cannot transition from terminal states: DELIVERED -> CREATED
    StateTransitionResult term1 = validateTransition(events:DELIVERED, events:CREATED);
    test:assertFalse(term1.allowed);

    // Cannot transition from terminal states: CANCELLED -> CONFIRMED
    StateTransitionResult term2 = validateTransition(events:CANCELLED, events:CONFIRMED);
    test:assertFalse(term2.allowed);

    // Cannot transition to identical state
    StateTransitionResult same = validateTransition(events:CREATED, events:CREATED);
    test:assertFalse(same.allowed);
}

@test:Config {}
function testCancellationGuardRules() {
    // Cancellable states
    test:assertTrue(isCancellable(events:CREATED));
    test:assertTrue(isCancellable(events:CONFIRMED));

    // Non-cancellable states (Preparation started, ready, in transit, delivered, or already cancelled)
    test:assertFalse(isCancellable(events:PREPARING));
    test:assertFalse(isCancellable(events:READY));
    test:assertFalse(isCancellable(events:OUT_FOR_DELIVERY));
    test:assertFalse(isCancellable(events:DELIVERED));
    test:assertFalse(isCancellable(events:CANCELLED));
}

@test:Config {}
function testOrderPayloadValidation() {
    events:Address validAddr = {
        street: "Independence Ave 101",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "9000"
    };

    CreateOrderItem validItem = {
        itemId: "item_01",
        name: "Kapana Platter",
        quantity: 2,
        price: 45.0d
    };

    // Valid payload
    CreateOrderRequest validReq = {
        customerId: "cust_100",
        restaurantId: "rest_200",
        items: [validItem],
        deliveryAddress: validAddr
    };
    test:assertEquals(validateCreateOrderRequest(validReq), ());

    // Empty customer
    CreateOrderRequest emptyCust = {
        customerId: "   ",
        restaurantId: "rest_200",
        items: [validItem],
        deliveryAddress: validAddr
    };
    test:assertEquals(validateCreateOrderRequest(emptyCust), "Customer ID must not be empty");

    // Empty restaurant
    CreateOrderRequest emptyRest = {
        customerId: "cust_100",
        restaurantId: "",
        items: [validItem],
        deliveryAddress: validAddr
    };
    test:assertEquals(validateCreateOrderRequest(emptyRest), "Restaurant ID must not be empty");

    // Empty items
    CreateOrderRequest emptyItems = {
        customerId: "cust_100",
        restaurantId: "rest_200",
        items: [],
        deliveryAddress: validAddr
    };
    test:assertEquals(validateCreateOrderRequest(emptyItems), "Order must contain at least one item");

    // Invalid item quantity <= 0
    CreateOrderItem badQtyItem = {
        itemId: "item_01",
        name: "Kapana Platter",
        quantity: 0,
        price: 45.0d
    };
    CreateOrderRequest badQtyReq = {
        customerId: "cust_100",
        restaurantId: "rest_200",
        items: [badQtyItem],
        deliveryAddress: validAddr
    };
    test:assertEquals(validateCreateOrderRequest(badQtyReq), "Item 'Kapana Platter' quantity must be greater than zero");

    // Invalid item price <= 0
    CreateOrderItem badPriceItem = {
        itemId: "item_01",
        name: "Kapana Platter",
        quantity: 1,
        price: 0.0d
    };
    CreateOrderRequest badPriceReq = {
        customerId: "cust_100",
        restaurantId: "rest_200",
        items: [badPriceItem],
        deliveryAddress: validAddr
    };
    test:assertEquals(validateCreateOrderRequest(badPriceReq), "Item 'Kapana Platter' price must be greater than zero");

    // Missing street address
    events:Address badAddr = {
        street: "",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "9000"
    };
    CreateOrderRequest badAddrReq = {
        customerId: "cust_100",
        restaurantId: "rest_200",
        items: [validItem],
        deliveryAddress: badAddr
    };
    test:assertEquals(validateCreateOrderRequest(badAddrReq), "Delivery street address must not be empty");
}
