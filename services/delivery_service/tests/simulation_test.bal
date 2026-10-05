import ballerina/test;

@test:Config {}
function testHaversineZeroDistanceIdenticalCoordinates() {
    LocationCoordinates windhoekCbd = {
        latitude: -22.5609d,
        longitude: 17.0658d
    };

    decimal distance = calculateHaversineDistance(windhoekCbd, windhoekCbd);
    test:assertEquals(distance, 0.0d);
}

@test:Config {}
function testHaversineDistanceKnownCoordinates() {
    // Windhoek CBD to Katutura (~4.4 - 4.5 km straight-line)
    LocationCoordinates windhoekCbd = {
        latitude: -22.5609d,
        longitude: 17.0658d
    };
    LocationCoordinates katutura = {
        latitude: -22.5227d,
        longitude: 17.0505d
    };

    decimal distance = calculateHaversineDistance(windhoekCbd, katutura);
    test:assertTrue(distance > 4.0d && distance < 5.0d, string `Expected distance ~4.5km, got ${distance}`);

    // Equator 1-degree latitude test: (0.0, 0.0) to (1.0, 0.0) is ~111.1949 km
    LocationCoordinates eq1 = {latitude: 0.0d, longitude: 0.0d};
    LocationCoordinates eq2 = {latitude: 1.0d, longitude: 0.0d};
    decimal eqDistance = calculateHaversineDistance(eq1, eq2);
    test:assertEquals(eqDistance, 111.1949d);
}

@test:Config {}
function testDynamicEtaCalculation() {
    // Zero distance should be 0 minutes
    test:assertEquals(calculateDynamicEta(0.0d, 40.0d), 0);

    // 40 km at default speed (40 km/h) -> 60 minutes
    test:assertEquals(calculateDynamicEta(40.0d), 60);

    // 20 km at 40 km/h -> 30 minutes
    test:assertEquals(calculateDynamicEta(20.0d, 40.0d), 30);

    // 10 km at 40 km/h -> 15 minutes
    test:assertEquals(calculateDynamicEta(10.0d, 40.0d), 15);

    // 15 km at 60 km/h -> 15 minutes
    test:assertEquals(calculateDynamicEta(15.0d, 60.0d), 15);

    // 5 km at 30 km/h -> 10 minutes
    test:assertEquals(calculateDynamicEta(5.0d, 30.0d), 10);
}

@test:Config {}
function testInterpolateCoordinates() {
    LocationCoordinates startLoc = {
        latitude: -22.5600d,
        longitude: 17.0600d
    };
    LocationCoordinates destLoc = {
        latitude: -22.5800d,
        longitude: 17.0800d
    };

    // Fraction 0.0 -> Start location
    LocationCoordinates p0 = interpolateCoordinates(startLoc, destLoc, 0.0d);
    test:assertEquals(p0.latitude, startLoc.latitude);
    test:assertEquals(p0.longitude, startLoc.longitude);

    // Fraction 1.0 -> Destination location
    LocationCoordinates p1 = interpolateCoordinates(startLoc, destLoc, 1.0d);
    test:assertEquals(p1.latitude, destLoc.latitude);
    test:assertEquals(p1.longitude, destLoc.longitude);

    // Fraction 0.5 -> Midpoint (-22.5700, 17.0700)
    LocationCoordinates pMid = interpolateCoordinates(startLoc, destLoc, 0.5d);
    test:assertEquals(pMid.latitude, -22.5700d);
    test:assertEquals(pMid.longitude, 17.0700d);
}

@test:Config {}
function testRouteSimulationProgression() {
    LocationCoordinates restaurantLoc = {
        latitude: -22.5609d,
        longitude: 17.0658d
    };
    LocationCoordinates customerLoc = {
        latitude: -22.5227d,
        longitude: 17.0505d
    };

    DeliveryTask task = {
        deliveryId: "DEL-101",
        orderId: "ORD-501",
        driverId: "DRV-001",
        status: OUT_FOR_DELIVERY,
        createdAt: "2026-10-05T20:00:00Z"
    };

    // Initialize simulation
    RouteSimulation sim = createRouteSimulation(task, restaurantLoc, customerLoc, 0.1d, 40.0d);
    test:assertEquals(sim.deliveryId, "DEL-101");
    test:assertEquals(sim.currentProgress, 0.0d);
    test:assertFalse(sim.isCompleted);
    test:assertTrue(sim.remainingDistanceKm > 4.0d);
    test:assertTrue(sim.remainingEtaMinutes > 0);

    // Advance 1 step (10%)
    RouteSimulation step1 = advanceSimulationStep(sim, 40.0d);
    test:assertEquals(step1.currentProgress, 0.1d);
    test:assertFalse(step1.isCompleted);
    test:assertTrue(step1.remainingDistanceKm < sim.remainingDistanceKm);

    // Simulate full route
    RouteSimulation[] history = simulateFullRoute(task, restaurantLoc, customerLoc, 0.1d, 40.0d);
    // 0%, 10%, 20%, ..., 100% -> 11 steps
    test:assertEquals(history.length(), 11);

    RouteSimulation initialStep = history[0];
    test:assertEquals(initialStep.currentProgress, 0.0d);
    test:assertEquals(initialStep.currentLocation, restaurantLoc);
    test:assertFalse(initialStep.isCompleted);

    RouteSimulation finalStep = history[10];
    test:assertEquals(finalStep.currentProgress, 1.0d);
    test:assertEquals(finalStep.currentLocation, customerLoc);
    test:assertEquals(finalStep.remainingDistanceKm, 0.0d);
    test:assertEquals(finalStep.remainingEtaMinutes, 0);
    test:assertTrue(finalStep.isCompleted);
}

@test:Config {}
function testAdvanceTaskStepHelper() {
    LocationCoordinates startLoc = {latitude: -22.5600d, longitude: 17.0600d};
    LocationCoordinates endLoc = {latitude: -22.5800d, longitude: 17.0800d};

    DeliveryTask task = {
        deliveryId: "DEL-102",
        orderId: "ORD-502",
        driverId: "DRV-002",
        status: OUT_FOR_DELIVERY,
        createdAt: "2026-10-05T20:00:00Z"
    };

    // Step at 0.5 progressing by 0.5 reaches 1.0 (delivered)
    SimulationStepResult result = advanceTaskStep(task, startLoc, endLoc, 0.5d, 0.5d);
    test:assertTrue(result.isCompleted);
    test:assertEquals(result.currentLocation, endLoc);
    test:assertEquals(result.remainingDistanceKm, 0.0d);
    test:assertEquals(result.remainingEtaMinutes, 0);
    test:assertEquals(result.currentProgress, 1.0d);
}
