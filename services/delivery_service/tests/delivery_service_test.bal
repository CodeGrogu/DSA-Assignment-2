import ballerina/http;
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

@test:Config {}
function testTrackDeliveryEndpoint() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    http:Response resp = check clientEp->get("/delivery/track/ord_test_1");
    test:assertEquals(resp.statusCode, 200);

    json payload = check resp.getJsonPayload();
    test:assertTrue(payload is map<json>);
    map<json> body = <map<json>>payload;
    test:assertEquals(body["orderId"], "ord_test_1");
    test:assertEquals(body["driverId"], "drv_001");
    test:assertEquals(body["status"], "IN_TRANSIT");
    test:assertTrue(body.hasKey("currentLocation"));

    http:Response customResp = check clientEp->get("/delivery/track/ord_custom_99");
    test:assertEquals(customResp.statusCode, 200);
    json customPayload = check customResp.getJsonPayload();
    test:assertTrue(customPayload is map<json>);
    map<json> customBody = <map<json>>customPayload;
    test:assertEquals(customBody["orderId"], "ord_custom_99");
    test:assertEquals(customBody["deliveryId"], "del_ord_custom_99");
}

@test:Config {}
function testCreateAndTrackDelivery() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json payload = {
        orderId: "ord_new_456",
        driverId: "drv_002",
        status: "DRIVER_ASSIGNED",
        currentLocation: {
            latitude: -22.5700d,
            longitude: 17.0800d
        }
    };
    http:Response postResp = check clientEp->post("/deliveries", payload);
    test:assertEquals(postResp.statusCode, 201);
    json postBody = check postResp.getJsonPayload();
    test:assertTrue(postBody is map<json>);
    map<json> postMap = <map<json>>postBody;
    test:assertEquals(postMap["orderId"], "ord_new_456");
    test:assertEquals(postMap["driverId"], "drv_002");
    test:assertEquals(postMap["status"], "DRIVER_ASSIGNED");

    http:Response trackResp = check clientEp->get("/delivery/track/ord_new_456");
    test:assertEquals(trackResp.statusCode, 200);
    json trackBody = check trackResp.getJsonPayload();
    test:assertTrue(trackBody is map<json>);
    map<json> trackMap = <map<json>>trackBody;
    test:assertEquals(trackMap["orderId"], "ord_new_456");
    test:assertEquals(trackMap["driverId"], "drv_002");
    test:assertEquals(trackMap["status"], "DRIVER_ASSIGNED");
}

@test:Config {}
function testCreateDeliveryValidation() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json badPayload = {
        orderId: ""
    };
    http:Response badResp = check clientEp->post("/deliveries", badPayload);
    test:assertEquals(badResp.statusCode, 400);
}

