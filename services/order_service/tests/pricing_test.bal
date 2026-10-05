import ballerina/http;
import ballerina/test;

import peerpressure/events as events;

# Test 1: STANDARD surge tier when ratio R <= 1.0 during off-peak hours.
@test:Config {}
function testStandardTierOffPeakPricing() {
    // 8 unfulfilled orders / 10 available drivers -> R = 0.8 <= 1.0
    decimal multiplier = calculateSurgeMultiplier(8, 10, 10);
    test:assertEquals(multiplier, 1.0d, "STANDARD tier off-peak multiplier must be 1.0");

    string tier = getSurgeTierName(0.8d);
    test:assertEquals(tier, "STANDARD");

    decimal fee = calculateDeliveryFee(15.0d, multiplier);
    test:assertEquals(fee, 15.0d);

    PricingQuote quote = pricingEngine.getQuote(8, 10, 10);
    test:assertEquals(quote.surgeMultiplier, 1.0d);
    test:assertEquals(quote.tier, "STANDARD");
    test:assertEquals(quote.deliveryFee, 15.0d);
    test:assertEquals(quote.baseFee, 15.0d);
    test:assertFalse(quote.peakHourApplied);

    // Boundary condition: R = 1.0 exactly
    decimal boundaryMultiplier = calculateSurgeMultiplier(10, 10, 10);
    test:assertEquals(boundaryMultiplier, 1.0d);
    test:assertEquals(getSurgeTierName(1.0d), "STANDARD");
}

# Test 2: MODERATE surge tier when 1.0 < R <= 2.0 during off-peak hours.
@test:Config {}
function testModerateTierOffPeakPricing() {
    // 15 unfulfilled orders / 10 available drivers -> R = 1.5
    decimal multiplier = calculateSurgeMultiplier(15, 10, 10);
    test:assertEquals(multiplier, 1.25d, "MODERATE tier multiplier must be 1.25");

    string tier = getSurgeTierName(1.5d);
    test:assertEquals(tier, "MODERATE");

    decimal fee = calculateDeliveryFee(15.0d, multiplier);
    test:assertEquals(fee, 18.75d);

    PricingQuote quote = pricingEngine.getQuote(15, 10, 10);
    test:assertEquals(quote.surgeMultiplier, 1.25d);
    test:assertEquals(quote.tier, "MODERATE");
    test:assertEquals(quote.deliveryFee, 18.75d);
    test:assertFalse(quote.peakHourApplied);

    // Boundary condition: R = 2.0 exactly
    decimal boundaryMultiplier = calculateSurgeMultiplier(20, 10, 10);
    test:assertEquals(boundaryMultiplier, 1.25d);
    test:assertEquals(getSurgeTierName(2.0d), "MODERATE");
}

# Test 3: HIGH surge tier when 2.0 < R <= 3.0 during off-peak hours.
@test:Config {}
function testHighTierOffPeakPricing() {
    // 25 unfulfilled orders / 10 available drivers -> R = 2.5
    decimal multiplier = calculateSurgeMultiplier(25, 10, 10);
    test:assertEquals(multiplier, 1.5d, "HIGH tier multiplier must be 1.5");

    string tier = getSurgeTierName(2.5d);
    test:assertEquals(tier, "HIGH");

    decimal fee = calculateDeliveryFee(15.0d, multiplier);
    test:assertEquals(fee, 22.5d);

    PricingQuote quote = pricingEngine.getQuote(25, 10, 10);
    test:assertEquals(quote.surgeMultiplier, 1.5d);
    test:assertEquals(quote.tier, "HIGH");
    test:assertEquals(quote.deliveryFee, 22.5d);
    test:assertFalse(quote.peakHourApplied);

    // Boundary condition: R = 3.0 exactly
    decimal boundaryMultiplier = calculateSurgeMultiplier(30, 10, 10);
    test:assertEquals(boundaryMultiplier, 1.5d);
    test:assertEquals(getSurgeTierName(3.0d), "HIGH");
}

# Test 4: SURGE tier when 3.0 < R <= 5.0 during off-peak hours.
@test:Config {}
function testSurgeTierOffPeakPricing() {
    // 40 unfulfilled orders / 10 available drivers -> R = 4.0
    decimal multiplier = calculateSurgeMultiplier(40, 10, 10);
    test:assertEquals(multiplier, 2.0d, "SURGE tier multiplier must be 2.0");

    string tier = getSurgeTierName(4.0d);
    test:assertEquals(tier, "SURGE");

    decimal fee = calculateDeliveryFee(15.0d, multiplier);
    test:assertEquals(fee, 30.0d);

    PricingQuote quote = pricingEngine.getQuote(40, 10, 10);
    test:assertEquals(quote.surgeMultiplier, 2.0d);
    test:assertEquals(quote.tier, "SURGE");
    test:assertEquals(quote.deliveryFee, 30.0d);
    test:assertFalse(quote.peakHourApplied);

    // Boundary condition: R = 5.0 exactly
    decimal boundaryMultiplier = calculateSurgeMultiplier(50, 10, 10);
    test:assertEquals(boundaryMultiplier, 2.0d);
    test:assertEquals(getSurgeTierName(5.0d), "SURGE");
}

# Test 5: PEAK surge tier when R > 5.0 during off-peak hours (capped at maxSurgeMultiplier).
@test:Config {}
function testPeakTierOffPeakPricing() {
    // 60 unfulfilled orders / 10 available drivers -> R = 6.0
    decimal multiplier = calculateSurgeMultiplier(60, 10, 10);
    test:assertEquals(multiplier, 3.0d, "PEAK tier multiplier must be 3.0");

    string tier = getSurgeTierName(6.0d);
    test:assertEquals(tier, "PEAK");

    decimal fee = calculateDeliveryFee(15.0d, multiplier);
    test:assertEquals(fee, 45.0d);

    PricingQuote quote = pricingEngine.getQuote(60, 10, 10);
    test:assertEquals(quote.surgeMultiplier, 3.0d);
    test:assertEquals(quote.tier, "PEAK");
    test:assertEquals(quote.deliveryFee, 45.0d);
    test:assertFalse(quote.peakHourApplied);
}

# Test 6: Zero available drivers safety and fleet collapse protection.
@test:Config {}
function testDivisionByZeroSafety() {
    // availableDrivers = 0 with 0 orders evaluates to STANDARD 1.0x
    decimal zeroOrdersMultiplier = calculateSurgeMultiplier(0, 0, 10);
    test:assertEquals(zeroOrdersMultiplier, 1.0d, "0 orders and 0 drivers should yield STANDARD 1.0");

    PricingQuote zeroQuote = pricingEngine.getQuote(0, 0, 10);
    test:assertEquals(zeroQuote.surgeMultiplier, 1.0d);
    test:assertEquals(zeroQuote.tier, "STANDARD");

    // Fleet collapse: 5 unfulfilled orders / 0 drivers -> acute driver shortage -> PEAK tier (maxSurgeMultiplier 3.0)
    decimal fiveOrdersMultiplier = calculateSurgeMultiplier(5, 0, 10);
    test:assertEquals(fiveOrdersMultiplier, 3.0d, "Driver depletion under demand must yield PEAK tier 3.0");

    // 10 unfulfilled orders / 0 drivers -> PEAK tier (3.0)
    decimal tenOrdersMultiplier = calculateSurgeMultiplier(10, 0, 10);
    test:assertEquals(tenOrdersMultiplier, 3.0d);
}

# Test 7: Lunch peak hour bonus (+0.2x) during hours 12 and 13.
@test:Config {}
function testLunchPeakHourBonus() {
    test:assertTrue(isPeakHour(12), "Hour 12 must be peak hour");
    test:assertTrue(isPeakHour(13), "Hour 13 must be peak hour");

    // STANDARD base 1.0 + 0.2 peak = 1.2
    decimal mult12 = calculateSurgeMultiplier(5, 10, 12);
    test:assertEquals(mult12, 1.2d, "Hour 12 must apply +0.2 peak bonus");

    decimal mult13 = calculateSurgeMultiplier(5, 10, 13);
    test:assertEquals(mult13, 1.2d, "Hour 13 must apply +0.2 peak bonus");

    PricingQuote quote = pricingEngine.getQuote(5, 10, 12);
    test:assertEquals(quote.surgeMultiplier, 1.2d);
    test:assertEquals(quote.deliveryFee, 18.0d); // 15.0 * 1.2
    test:assertTrue(quote.peakHourApplied);
}

# Test 8: Dinner peak hour bonus (+0.2x) during hours 18, 19, and 20.
@test:Config {}
function testDinnerPeakHourBonus() {
    test:assertTrue(isPeakHour(18), "Hour 18 must be peak hour");
    test:assertTrue(isPeakHour(19), "Hour 19 must be peak hour");
    test:assertTrue(isPeakHour(20), "Hour 20 must be peak hour");

    // Non-peak hours adjacent to windows
    test:assertFalse(isPeakHour(11), "Hour 11 must be off-peak");
    test:assertFalse(isPeakHour(14), "Hour 14 must be off-peak");
    test:assertFalse(isPeakHour(17), "Hour 17 must be off-peak");
    test:assertFalse(isPeakHour(21), "Hour 21 must be off-peak");
    test:assertFalse(isPeakHour(0), "Hour 0 must be off-peak");

    // MODERATE tier base 1.25 + 0.2 = 1.45
    decimal mult18 = calculateSurgeMultiplier(15, 10, 18);
    test:assertEquals(mult18, 1.45d);

    decimal mult19 = calculateSurgeMultiplier(15, 10, 19);
    test:assertEquals(mult19, 1.45d);

    decimal mult20 = calculateSurgeMultiplier(15, 10, 20);
    test:assertEquals(mult20, 1.45d);

    PricingQuote quote = pricingEngine.getQuote(15, 10, 19);
    test:assertEquals(quote.surgeMultiplier, 1.45d);
    test:assertEquals(quote.deliveryFee, 21.75d); // 15.0 * 1.45
    test:assertTrue(quote.peakHourApplied);
}

# Test 9: Capping at maxSurgeMultiplier (3.0x upper limit).
@test:Config {}
function testCappingAtMaxSurgeMultiplier() {
    // PEAK tier base 3.0 + 0.2 peak bonus = 3.2 -> capped at maxSurgeMultiplier (3.0)
    decimal cappedLunch = calculateSurgeMultiplier(60, 10, 12);
    test:assertEquals(cappedLunch, 3.0d, "PEAK + lunch bonus must be capped at maxSurgeMultiplier 3.0");

    decimal cappedDinner = calculateSurgeMultiplier(100, 1, 18);
    test:assertEquals(cappedDinner, 3.0d, "PEAK + dinner bonus must be capped at maxSurgeMultiplier 3.0");

    PricingQuote quote = pricingEngine.getQuote(100, 1, 18);
    test:assertEquals(quote.surgeMultiplier, 3.0d);
    test:assertEquals(quote.deliveryFee, 45.0d);
}

# Test 10: Lower bound floor at minSurgeMultiplier (1.0x).
@test:Config {}
function testLowerBoundMinSurgeMultiplier() {
    decimal minMult = calculateSurgeMultiplier(0, 50, 10);
    test:assertEquals(minMult, 1.0d, "Surge multiplier cannot drop below minSurgeMultiplier 1.0");
    test:assertTrue(minMult >= minSurgeMultiplier);
}

# Test 11: Resilient handling of negative inputs in calculations.
@test:Config {}
function testNegativeInputsHandling() {
    // Negative unfulfilled orders normalized to 0
    decimal negOrders = calculateSurgeMultiplier(-10, 10, 10);
    test:assertEquals(negOrders, 1.0d);

    // Negative drivers normalized to effective 1
    decimal negDrivers = calculateSurgeMultiplier(0, -5, 10);
    test:assertEquals(negDrivers, 1.0d);

    // Both negative
    PricingQuote quote = pricingEngine.getQuote(-20, -10, 10);
    test:assertEquals(quote.surgeMultiplier, 1.0d);
    test:assertEquals(quote.tier, "STANDARD");
    test:assertEquals(quote.deliveryFee, 15.0d);
}

# Test 12: PricingEngine thread-safe supply and demand updates.
@test:Config {}
function testPricingEngineSupplyDemandUpdates() {
    pricingEngine.setSupplyDemand(25, 10);
    PricingQuote quote = pricingEngine.getCurrentQuote();

    test:assertEquals(quote.tier, "HIGH");
    test:assertEquals(quote.baseFee, 15.0d);
    test:assertTrue(quote.surgeMultiplier >= 1.5d, "Surge multiplier must be at least base HIGH 1.5");
    test:assertTrue(quote.deliveryFee >= 22.5d);
    test:assertTrue(quote.timestamp.length() > 0);
}

# Test 13: HTTP GET /pricing/quote endpoint with valid query parameters.
@test:Config {}
function testHttpPricingQuoteEndpointValid() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);

    http:Response res = check clientEp->get("/pricing/quote?unfulfilledOrders=15&availableDrivers=10");
    test:assertEquals(res.statusCode, 200);

    json body = check res.getJsonPayload();
    test:assertEquals(check body.tier, "MODERATE");
    test:assertEquals(check body.baseFee, 15.0d);
    decimal multiplier = check body.surgeMultiplier;
    test:assertTrue(multiplier == 1.25d || multiplier == 1.45d, "Multiplier must be 1.25 (off-peak) or 1.45 (peak)");
    decimal deliveryFee = check body.deliveryFee;
    test:assertTrue(deliveryFee == 18.75d || deliveryFee == 21.75d, "Delivery fee must be 18.75 or 21.75");
    string ts = check body.timestamp;
    test:assertTrue(ts.length() > 0);
}

# Test 14: HTTP GET /pricing/quote endpoint rejects negative input values with 400 Bad Request.
@test:Config {}
function testHttpPricingQuoteEndpointRejectsNegativeInputs() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);

    // Negative unfulfilled orders
    http:Response res1 = check clientEp->get("/pricing/quote?unfulfilledOrders=-5&availableDrivers=10");
    test:assertEquals(res1.statusCode, 400);
    json body1 = check res1.getJsonPayload();
    test:assertEquals(check body1.'error, "BadRequest");

    // Negative available drivers
    http:Response res2 = check clientEp->get("/pricing/quote?unfulfilledOrders=10&availableDrivers=-2");
    test:assertEquals(res2.statusCode, 400);
    json body2 = check res2.getJsonPayload();
    test:assertEquals(check body2.'error, "BadRequest");
}

# Test 15: HTTP GET /pricing/current endpoint returns real-time platform quote.
@test:Config {}
function testHttpPricingCurrentEndpoint() returns error? {
    pricingEngine.setSupplyDemand(40, 10); // R = 4.0 -> SURGE

    http:Client clientEp = check new (string `http://localhost:${port}`);
    http:Response res = check clientEp->get("/pricing/current");
    test:assertEquals(res.statusCode, 200);

    json body = check res.getJsonPayload();
    test:assertEquals(check body.tier, "SURGE");
    test:assertEquals(check body.baseFee, 15.0d);
    decimal multiplier = check body.surgeMultiplier;
    test:assertTrue(multiplier == 2.0d || multiplier == 2.2d, "Multiplier must be 2.0 (off-peak) or 2.2 (peak)");
}

# Test 16: Order creation dynamically calculates surge multiplier and sets deliveryFee and totalAmount.
@test:Config {}
function testOrderCreationDynamicPricingIntegration() returns error? {
    pricingEngine.setSupplyDemand(0, 10); // STANDARD tier
    orderEventProducer.clearRecordedEvents();

    http:Client clientEp = check new (string `http://localhost:${port}`);

    CreateOrderRequest req = {
        customerId: "cust_pricing_integration_001",
        restaurantId: "rest_pricing_001",
        items: [
            {
                itemId: "ITEM_BURGER_01",
                name: "Kapana Burger",
                quantity: 2,
                price: 50.0d,
                specialInstructions: []
            }
        ],
        deliveryAddress: {
            street: "20 Fidel Castro St",
            city: "Windhoek",
            state: "Khomas",
            postalCode: "9000",
            coordinates: ()
        }
    };

    http:Response res = check clientEp->post("/orders", req);
    test:assertEquals(res.statusCode, 201);

    json body = check res.getJsonPayload();
    string orderId = check body.orderId;
    decimal itemsTotal = check body.itemsTotal;
    decimal deliveryFee = check body.deliveryFee;
    decimal surgeMultiplier = check body.surgeMultiplier;
    decimal totalAmount = check body.totalAmount;

    test:assertEquals(itemsTotal, 100.0d, "itemsTotal must equal 2 * 50 = 100.0");
    test:assertTrue(surgeMultiplier >= 1.0d, "surgeMultiplier must be at least 1.0");
    test:assertEquals(deliveryFee, 15.0d * surgeMultiplier, "deliveryFee must equal baseDeliveryFee * surgeMultiplier");
    test:assertEquals(totalAmount, itemsTotal + deliveryFee, "totalAmount must strictly equal itemsTotal + deliveryFee");

    // Validate published Kafka OrderCreated event
    events:OrderCreated[] createdEvents = orderEventProducer.getRecordedCreatedEvents();
    test:assertEquals(createdEvents.length(), 1);
    test:assertEquals(createdEvents[0].orderId, orderId);
    // Per judicial remedy: OrderCreated event conveys full order total including delivery fee line item
    test:assertEquals(createdEvents[0].totalAmount, totalAmount, "OrderCreated event totalAmount must equal full order total");
    test:assertEquals(createdEvents[0].items.length(), 2, "OrderCreated event items must contain food item plus delivery fee line item");
    test:assertEquals(createdEvents[0].items[1].itemId, "DELIVERY_FEE");

    // Verify contract schema validation passes on the generated event
    events:OrderCreated validated = check events:validateOrderCreated(createdEvents[0].toJson());
    test:assertEquals(validated.orderId, orderId);
}
