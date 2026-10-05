import ballerina/test;

@test:Config {}
function testValidDeliveryTransitions() {
    test:assertTrue(
            isValidDeliveryTransition(UNASSIGNED, DRIVER_ASSIGNED)
    );

    test:assertTrue(
            isValidDeliveryTransition(DRIVER_ASSIGNED, AT_RESTAURANT)
    );

    test:assertTrue(
            isValidDeliveryTransition(AT_RESTAURANT, OUT_FOR_DELIVERY)
    );

    test:assertTrue(
            isValidDeliveryTransition(OUT_FOR_DELIVERY, DELIVERED)
    );
}

@test:Config {}
function testInvalidDeliveryTransitions() {
    test:assertFalse(
            isValidDeliveryTransition(UNASSIGNED, DELIVERED)
    );

    test:assertFalse(
            isValidDeliveryTransition(UNASSIGNED, AT_RESTAURANT)
    );

    test:assertFalse(
            isValidDeliveryTransition(AT_RESTAURANT, DELIVERED)
    );

    test:assertFalse(
            isValidDeliveryTransition(DELIVERED, OUT_FOR_DELIVERY)
    );
}

@test:Config {}
function testDeliveryTransitionFunction() returns error? {
    DeliveryTaskStatus|error result =
        transitionDelivery(UNASSIGNED, DRIVER_ASSIGNED);

    test:assertEquals(result, DRIVER_ASSIGNED);

    DeliveryTaskStatus|error invalidResult =
        transitionDelivery(UNASSIGNED, DELIVERED);

    test:assertTrue(invalidResult is error);

    return;
}

@test:Config {}
function testValidCoordinates() {
    LocationCoordinates windhoek = {
        latitude: -22.5609d,
        longitude: 17.0658d
    };

    test:assertTrue(isValidCoordinates(windhoek));
}

@test:Config {}
function testInvalidCoordinates() {
    LocationCoordinates invalidLocation = {
        latitude: 100.0d,
        longitude: 17.0658d
    };

    test:assertFalse(isValidCoordinates(invalidLocation));
}

@test:Config {}
function testDriverRecord() {
    Driver driver = {
        id: "DRV-001",
        name: "Amelia Shilongo",
        phone: "+264811234567",
        vehicleCategory: "CAR",
        availability: "AVAILABLE",
        state: "AVAILABLE",
        location: {
            latitude: -22.5609d,
            longitude: 17.0658d
        }
    };

    test:assertTrue(isValidDriver(driver));
}
