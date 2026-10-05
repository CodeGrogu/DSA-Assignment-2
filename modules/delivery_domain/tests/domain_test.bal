import ballerina/test;

@test:Config {}
function testValidDeliveryTransitions() {
    test:assertTrue(isValidDeliveryTransition(UNASSIGNED, DRIVER_ASSIGNED));
    test:assertTrue(isValidDeliveryTransition(DRIVER_ASSIGNED, AT_RESTAURANT));
    test:assertTrue(isValidDeliveryTransition(AT_RESTAURANT, OUT_FOR_DELIVERY));
    test:assertTrue(isValidDeliveryTransition(OUT_FOR_DELIVERY, DELIVERED));
}

@test:Config {}
function testInvalidDeliveryTransitions() {
    // Skipping transitions
    test:assertFalse(isValidDeliveryTransition(UNASSIGNED, AT_RESTAURANT));
    test:assertFalse(isValidDeliveryTransition(UNASSIGNED, OUT_FOR_DELIVERY));
    test:assertFalse(isValidDeliveryTransition(UNASSIGNED, DELIVERED));
    test:assertFalse(isValidDeliveryTransition(DRIVER_ASSIGNED, OUT_FOR_DELIVERY));
    test:assertFalse(isValidDeliveryTransition(DRIVER_ASSIGNED, DELIVERED));
    test:assertFalse(isValidDeliveryTransition(AT_RESTAURANT, DELIVERED));

    // Backward transitions
    test:assertFalse(isValidDeliveryTransition(DRIVER_ASSIGNED, UNASSIGNED));
    test:assertFalse(isValidDeliveryTransition(AT_RESTAURANT, DRIVER_ASSIGNED));
    test:assertFalse(isValidDeliveryTransition(OUT_FOR_DELIVERY, AT_RESTAURANT));
    test:assertFalse(isValidDeliveryTransition(DELIVERED, OUT_FOR_DELIVERY));
    test:assertFalse(isValidDeliveryTransition(DELIVERED, UNASSIGNED));

    // Self transitions
    test:assertFalse(isValidDeliveryTransition(UNASSIGNED, UNASSIGNED));
    test:assertFalse(isValidDeliveryTransition(DRIVER_ASSIGNED, DRIVER_ASSIGNED));
    test:assertFalse(isValidDeliveryTransition(AT_RESTAURANT, AT_RESTAURANT));
    test:assertFalse(isValidDeliveryTransition(OUT_FOR_DELIVERY, OUT_FOR_DELIVERY));
    test:assertFalse(isValidDeliveryTransition(DELIVERED, DELIVERED));
}

@test:Config {}
function testTransitionDelivery() returns error? {
    DeliveryTaskStatus result = check transitionDelivery(UNASSIGNED, DRIVER_ASSIGNED);
    test:assertEquals(result, DRIVER_ASSIGNED);

    result = check transitionDelivery(DRIVER_ASSIGNED, AT_RESTAURANT);
    test:assertEquals(result, AT_RESTAURANT);

    result = check transitionDelivery(AT_RESTAURANT, OUT_FOR_DELIVERY);
    test:assertEquals(result, OUT_FOR_DELIVERY);

    result = check transitionDelivery(OUT_FOR_DELIVERY, DELIVERED);
    test:assertEquals(result, DELIVERED);

    DeliveryTaskStatus|error invalidResult = transitionDelivery(UNASSIGNED, DELIVERED);
    test:assertTrue(invalidResult is error);
    if invalidResult is error {
        test:assertEquals(invalidResult.message(), "Invalid delivery transition from UNASSIGNED to DELIVERED");
    }

    DeliveryTaskStatus|error backwardResult = transitionDelivery(DELIVERED, OUT_FOR_DELIVERY);
    test:assertTrue(backwardResult is error);
}

@test:Config {}
function testCoordinatesValidation() {
    LocationCoordinates windhoek = {
        latitude: -22.5609d,
        longitude: 17.0658d
    };
    test:assertTrue(isValidCoordinates(windhoek));

    LocationCoordinates origin = {
        latitude: 0.0d,
        longitude: 0.0d
    };
    test:assertTrue(isValidCoordinates(origin));

    LocationCoordinates maxBounds = {
        latitude: 90.0d,
        longitude: 180.0d
    };
    test:assertTrue(isValidCoordinates(maxBounds));

    LocationCoordinates minBounds = {
        latitude: -90.0d,
        longitude: -180.0d
    };
    test:assertTrue(isValidCoordinates(minBounds));

    LocationCoordinates latTooHigh = {
        latitude: 90.0001d,
        longitude: 0.0d
    };
    test:assertFalse(isValidCoordinates(latTooHigh));

    LocationCoordinates latTooLow = {
        latitude: -90.0001d,
        longitude: 0.0d
    };
    test:assertFalse(isValidCoordinates(latTooLow));

    LocationCoordinates lonTooHigh = {
        latitude: 0.0d,
        longitude: 180.0001d
    };
    test:assertFalse(isValidCoordinates(lonTooHigh));

    LocationCoordinates lonTooLow = {
        latitude: 0.0d,
        longitude: -180.0001d
    };
    test:assertFalse(isValidCoordinates(lonTooLow));
}

@test:Config {}
function testDriverValidation() {
    Driver validDriver = {
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
    test:assertTrue(isValidDriver(validDriver));

    Driver emptyIdDriver = {
        id: "",
        name: "Amelia Shilongo",
        phone: "+264811234567",
        vehicleCategory: "MOTORCYCLE",
        availability: "AVAILABLE",
        state: "AVAILABLE",
        location: {
            latitude: -22.5609d,
            longitude: 17.0658d
        }
    };
    test:assertFalse(isValidDriver(emptyIdDriver));

    Driver emptyNameDriver = {
        id: "DRV-002",
        name: "",
        phone: "+264811234567",
        vehicleCategory: "BICYCLE",
        availability: "AVAILABLE",
        state: "AVAILABLE",
        location: {
            latitude: -22.5609d,
            longitude: 17.0658d
        }
    };
    test:assertFalse(isValidDriver(emptyNameDriver));

    Driver emptyPhoneDriver = {
        id: "DRV-003",
        name: "John Doe",
        phone: "",
        vehicleCategory: "VAN",
        availability: "OFFLINE",
        state: "OFFLINE",
        location: {
            latitude: -22.5609d,
            longitude: 17.0658d
        }
    };
    test:assertFalse(isValidDriver(emptyPhoneDriver));

    Driver invalidLocationDriver = {
        id: "DRV-004",
        name: "Jane Doe",
        phone: "+264819876543",
        vehicleCategory: "CAR",
        availability: "BUSY",
        state: "DELIVERING",
        location: {
            latitude: 100.0d,
            longitude: 17.0658d
        }
    };
    test:assertFalse(isValidDriver(invalidLocationDriver));
}

@test:Config {}
function testDeliveryTaskModel() {
    DeliveryTask task = {
        deliveryId: "DEL-101",
        orderId: "ORD-501",
        status: UNASSIGNED,
        createdAt: "2026-10-05T20:00:00Z"
    };

    test:assertEquals(task.deliveryId, "DEL-101");
    test:assertEquals(task.orderId, "ORD-501");
    test:assertEquals(task.status, UNASSIGNED);
    test:assertEquals(task.driverId, ());
    test:assertEquals(task.assignedAt, ());
    test:assertEquals(task.pickedUpAt, ());
    test:assertEquals(task.deliveredAt, ());

    DeliveryTask completedTask = {
        deliveryId: "DEL-102",
        orderId: "ORD-502",
        driverId: "DRV-001",
        status: DELIVERED,
        createdAt: "2026-10-05T20:00:00Z",
        assignedAt: "2026-10-05T20:05:00Z",
        pickedUpAt: "2026-10-05T20:15:00Z",
        deliveredAt: "2026-10-05T20:35:00Z"
    };

    test:assertEquals(completedTask.status, DELIVERED);
    test:assertEquals(completedTask.driverId, "DRV-001");
}
