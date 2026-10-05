import ballerina/http;
import ballerina/test;

@test:Config {}
function testVerifyAddressInsideRange() returns error? {
    AddressVerificationRequest req = {
        customerId: "CUST-001",
        address: {
            id: "ADDR-TEST-001",
            tag: "Home",
            street: "12 Independence Avenue",
            city: "Windhoek",
            state: "Khomas",
            postalCode: "10005",
            location: {
                'type: "Point",
                coordinates: [17.0658, -22.5609]
            },
            deliveryInstructions: "Call on arrival",
            isDefault: true
        }
    };

    AddressVerificationResponse res = check verifyCustomerAddress(req);
    test:assertTrue(res.valid);
    test:assertTrue(res.withinDeliveryRange);
}

@test:Config {}
function testVerifyAddressOutsideNamibia() returns error? {
    AddressVerificationRequest req = {
        customerId: "CUST-001",
        address: {
            id: "ADDR-TEST-OUT",
            tag: "Home",
            street: "10 Downing Street",
            city: "London",
            state: "London",
            postalCode: "SW1A2AA",
            location: {
                'type: "Point",
                coordinates: [-0.1276, 51.5074]
            },
            deliveryInstructions: "",
            isDefault: false
        }
    };

    AddressVerificationResponse res = check verifyCustomerAddress(req);
    test:assertFalse(res.valid);
    test:assertFalse(res.withinDeliveryRange);
}

@test:Config {}
function testValidateNamibiaCoordinatesValid() returns error? {
    GeoJSONPoint validPoint = {
        'type: "Point",
        coordinates: [17.0658, -22.5609]
    };
    error? err = validateNamibiaCoordinates(validPoint);
    test:assertEquals(err, ());
}

@test:Config {}
function testValidateNamibiaCoordinatesInvalid() returns error? {
    GeoJSONPoint invalidLon = {
        'type: "Point",
        coordinates: [10.0, -22.5609]
    };
    error? errLon = validateNamibiaCoordinates(invalidLon);
    test:assertTrue(errLon is error, "Should fail for longitude outside Namibia");

    GeoJSONPoint invalidLat = {
        'type: "Point",
        coordinates: [17.0658, 10.0]
    };
    error? errLat = validateNamibiaCoordinates(invalidLat);
    test:assertTrue(errLat is error, "Should fail for latitude outside Namibia");

    GeoJSONPoint invalidType = {
        'type: "Polygon",
        coordinates: [17.0658, -22.5609]
    };
    error? errType = validateNamibiaCoordinates(invalidType);
    test:assertTrue(errType is error, "Should fail for non-Point type");

    GeoJSONPoint invalidLen = {
        'type: "Point",
        coordinates: [17.0658]
    };
    error? errLen = validateNamibiaCoordinates(invalidLen);
    test:assertTrue(errLen is error, "Should fail for invalid coordinate array length");
}

@test:Config {}
function testOfflineSetDefaultAddressFailsWhenMongoOffline() returns error? {
    error? result = setDefaultAddress("CUST-OFFLINE", "ADDR-001");
    test:assertTrue(result is error, "Should return error when MongoDB is offline");
    if result is error {
        test:assertTrue(
                result is DatabaseOperationError || result is CustomerNotFoundError || result is AddressNotFoundError,
                "Error should be DatabaseOperationError, CustomerNotFoundError, or AddressNotFoundError"
        );
    }
}

@test:Config {}
function testOfflineUpdateProfileFailsWhenMongoOffline() returns error? {
    error? result = updateCustomerProfile("CUST-OFFLINE", "Offline Name", "+264810000999");
    test:assertTrue(result is error, "Should return error when MongoDB is offline");
    if result is error {
        test:assertTrue(
                result is DatabaseOperationError || result is CustomerNotFoundError,
                "Error should be DatabaseOperationError or CustomerNotFoundError"
        );
    }
}

@test:Config {}
function testOfflineDeleteAddressFailsWhenMongoOffline() returns error? {
    error? result = deleteCustomerAddress("CUST-OFFLINE", "ADDR-001");
    test:assertTrue(result is error, "Should return error when MongoDB is offline");
    if result is error {
        test:assertTrue(
                result is DatabaseOperationError || result is CustomerNotFoundError || result is AddressNotFoundError,
                "Error should be DatabaseOperationError, CustomerNotFoundError, or AddressNotFoundError"
        );
    }
}

@test:Config {}
function testHttpMetricsEndpoint() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    http:Response res = check clientEp->get("/metrics");
    test:assertEquals(res.statusCode, 200);
    string payload = check res.getTextPayload();
    test:assertTrue(payload.includes("http_requests_total") || payload.includes("# HELP"));
}

@test:Config {}
function testHttpPostCustomersInvalidCoordinates() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json payload = {
        "id": "CUST-INV-COORD",
        "name": "Invalid Coord User",
        "email": "inv_coord@example.com",
        "phone": "+264811234567",
        "addresses": [
            {
                "id": "ADDR-INV-1",
                "tag": "Home",
                "street": "10 London Road",
                "city": "London",
                "state": "London",
                "postalCode": "SW1A2AA",
                "location": {
                    "type": "Point",
                    "coordinates": [-0.1276, 51.5074]
                },
                "deliveryInstructions": "",
                "isDefault": true
            }
        ]
    };
    http:Response res = check clientEp->post("/customers", payload);
    test:assertEquals(res.statusCode, 400);
}

@test:Config {}
function testHttpPostCustomersInvalidPayload() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json payload = {
        "id": "",
        "name": "",
        "email": "not-an-email",
        "phone": ""
    };
    http:Response res = check clientEp->post("/customers", payload);
    test:assertEquals(res.statusCode, 400);
}

@test:Config {}
function testHttpPostCustomerAddressInvalidCoordinates() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json addrPayload = {
        "id": "ADDR-BAD",
        "tag": "Home",
        "street": "Bad Street",
        "city": "Nowhere",
        "state": "Khomas",
        "postalCode": "10001",
        "location": {
            "type": "Point",
            "coordinates": [50.0, 50.0]
        },
        "deliveryInstructions": "",
        "isDefault": false
    };
    http:Response res = check clientEp->post("/customers/CUST-001/addresses", addrPayload);
    test:assertEquals(res.statusCode, 400);
}

@test:Config {}
function testHttpPostVerifyAddressEndpoints() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json reqPayload = {
        "customerId": "CUST-001",
        "address": {
            "id": "ADDR-TEST",
            "tag": "Home",
            "street": "12 Independence Avenue",
            "city": "Windhoek",
            "state": "Khomas",
            "postalCode": "10005",
            "location": {
                "type": "Point",
                "coordinates": [17.0658, -22.5609]
            },
            "deliveryInstructions": "",
            "isDefault": true
        }
    };
    http:Response res1 = check clientEp->post("/customers/verifyAddress", reqPayload);
    test:assertEquals(res1.statusCode, 200);

    http:Response res2 = check clientEp->post("/customers/verify-address", reqPayload);
    test:assertEquals(res2.statusCode, 200);
}
