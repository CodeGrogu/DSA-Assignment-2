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
function testVerifyAddressIncompleteFields() returns error? {
    AddressVerificationRequest reqEmptyStreet = {
        customerId: "CUST-001",
        address: {
            id: "ADDR-TEST-002",
            tag: "Home",
            street: "   ",
            city: "Windhoek",
            state: "Khomas",
            postalCode: "10005",
            location: {
                'type: "Point",
                coordinates: [17.0658, -22.5609]
            },
            deliveryInstructions: "",
            isDefault: false
        }
    };
    var res1 = verifyCustomerAddress(reqEmptyStreet);
    test:assertTrue(res1 is error);
    if res1 is error {
        test:assertEquals(res1.message(), "Address is incomplete");
    }

    AddressVerificationRequest reqEmptyCity = {
        customerId: "CUST-001",
        address: {
            id: "ADDR-TEST-003",
            tag: "Home",
            street: "12 Independence Ave",
            city: "",
            state: "Khomas",
            postalCode: "10005",
            location: {
                'type: "Point",
                coordinates: [17.0658, -22.5609]
            },
            deliveryInstructions: "",
            isDefault: false
        }
    };
    var res2 = verifyCustomerAddress(reqEmptyCity);
    test:assertTrue(res2 is error);
    if res2 is error {
        test:assertEquals(res2.message(), "Address is incomplete");
    }
}

@test:Config {}
function testVerifyAddressOutsideDeliveryRangeWithinNamibia() returns error? {
    AddressVerificationRequest req = {
        customerId: "CUST-001",
        address: {
            id: "ADDR-TEST-SWK",
            tag: "Beach House",
            street: "Sam Nujoma Avenue",
            city: "Swakopmund",
            state: "Erongo",
            postalCode: "13001",
            location: {
                'type: "Point",
                coordinates: [14.53, -22.68]
            },
            deliveryInstructions: "",
            isDefault: false
        }
    };

    AddressVerificationResponse res = check verifyCustomerAddress(req);
    test:assertTrue(res.valid);
    test:assertFalse(res.withinDeliveryRange);
    test:assertTrue(res.distanceKm > 10.0);
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

@test:Config {}
function testGetOrderClientResilient() returns error? {
    http:Client|error clientResult = getOrderClient();
    test:assertTrue(clientResult is http:Client, "getOrderClient should return an http:Client without panicking");
}

@test:Config {}
function testHttpGetOrdersEmptyCustomerId() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    http:Response res = check clientEp->get("/customers/%20/orders");
    test:assertEquals(res.statusCode, 400);
}

@test:Config {}
function testHttpGetOrdersCustomerNotFoundOrOffline() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    http:Response res = check clientEp->get("/customers/NONEXISTENT-CUST/orders");
    test:assertEquals(res.statusCode, 404, "Should return 404 when customer not found");
}

@test:Config {}
function testGetCustomerOrdersCustomerNotFound() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    http:Response res = check clientEp->get("/customers/CUST-NOT-FOUND/orders");
    test:assertEquals(res.statusCode, 404, "Should return HTTP 404 when customer is not found");
    json payload = check res.getJsonPayload();
    test:assertTrue(payload is map<json>);
    map<json> resMap = <map<json>>payload;
    test:assertEquals(resMap["message"], "Customer not found");
}

@test:Config {}
function testGetCustomerOrdersOfflineOrderService() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    http:Response res = check clientEp->get("/customers/CUST-EXISTS/orders");
    test:assertEquals(res.statusCode, 200, "Should return HTTP 200 with empty array when order service is offline");
    json payload = check res.getJsonPayload();
    test:assertTrue(payload is json[], "Payload should be a JSON array");
    json[] orders = <json[]>payload;
    test:assertEquals(orders.length(), 0, "Orders array should be empty when order service is offline");
}

@test:Config {}
function testAddressVerificationValidDeliveryRange() returns error? {
    AddressVerificationRequest req = {
        customerId: "CUST-001",
        address: {
            id: "ADDR-VALID-RANGE",
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
    test:assertTrue(res.valid, "Address should be valid");
    test:assertTrue(res.withinDeliveryRange, "Address should be within delivery range");
    test:assertTrue(res.distanceKm >= 0.0 && res.distanceKm <= 10.0, "Distance should be within 10 km");
    test:assertEquals(res.message, "Address is within delivery range");

    // Also verify via HTTP POST endpoint
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json payload = check req.cloneWithType(json);
    http:Response httpRes = check clientEp->post("/customers/verifyAddress", payload);
    test:assertEquals(httpRes.statusCode, 200);
    json httpJson = check httpRes.getJsonPayload();
    AddressVerificationResponse parsed = check httpJson.cloneWithType(AddressVerificationResponse);
    test:assertTrue(parsed.valid);
    test:assertTrue(parsed.withinDeliveryRange);
}

@test:Config {}
function testAddressVerificationOutsideDeliveryRange() returns error? {
    AddressVerificationRequest req = {
        customerId: "CUST-001",
        address: {
            id: "ADDR-OUTSIDE-RANGE",
            tag: "Beach House",
            street: "42 Sam Nujoma Avenue",
            city: "Swakopmund",
            state: "Erongo",
            postalCode: "13001",
            location: {
                'type: "Point",
                coordinates: [14.5053, -22.6792]
            },
            deliveryInstructions: "",
            isDefault: false
        }
    };

    AddressVerificationResponse res = check verifyCustomerAddress(req);
    test:assertTrue(res.valid, "Address within Namibia should be valid");
    test:assertFalse(res.withinDeliveryRange, "Address outside delivery radius should not be within range");
    test:assertTrue(res.distanceKm > 10.0, "Distance should exceed 10 km");
    test:assertEquals(res.message, "Address is outside delivery range");

    // Also verify via HTTP POST endpoint
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json payload = check req.cloneWithType(json);
    http:Response httpRes = check clientEp->post("/customers/verifyAddress", payload);
    test:assertEquals(httpRes.statusCode, 200);
    json httpJson = check httpRes.getJsonPayload();
    AddressVerificationResponse parsed = check httpJson.cloneWithType(AddressVerificationResponse);
    test:assertTrue(parsed.valid);
    test:assertFalse(parsed.withinDeliveryRange);
}

@test:Config {}
function testAddressVerificationIncompleteAddress() returns error? {
    // 1. Direct function verification returns error
    AddressVerificationRequest incompleteReq = {
        customerId: "CUST-001",
        address: {
            id: "ADDR-INCOMPLETE",
            tag: "Home",
            street: "   ",
            city: "Windhoek",
            state: "Khomas",
            postalCode: "10005",
            location: {
                'type: "Point",
                coordinates: [17.0658, -22.5609]
            },
            deliveryInstructions: "",
            isDefault: false
        }
    };
    AddressVerificationResponse|error result = verifyCustomerAddress(incompleteReq);
    test:assertTrue(result is error, "Direct verification with incomplete address should return an error");
    if result is error {
        test:assertEquals(result.message(), "Address is incomplete");
    }

    // 2. HTTP POST with incomplete/missing address payload returns 400
    http:Client clientEp = check new (string `http://localhost:${port}`);
    json invalidPayload = {
        "customerId": "CUST-001"
    };
    http:Response res400 = check clientEp->post("/customers/verifyAddress", invalidPayload);
    test:assertEquals(res400.statusCode, 400, "Incomplete payload should return HTTP 400");

    // 3. HTTP POST with invalid coordinates returns 400
    json invalidCoordPayload = {
        "customerId": "CUST-001",
        "address": {
            "id": "ADDR-BAD-COORD",
            "tag": "Home",
            "street": "12 Independence Avenue",
            "city": "Windhoek",
            "state": "Khomas",
            "postalCode": "10005",
            "location": {
                "type": "Polygon",
                "coordinates": [17.0658, -22.5609]
            },
            "deliveryInstructions": "",
            "isDefault": false
        }
    };
    http:Response resCoord = check clientEp->post("/customers/verifyAddress", invalidCoordPayload);
    test:assertEquals(resCoord.statusCode, 400, "Invalid coordinates should return HTTP 400");
}

@test:Mock {
    functionName: "getCustomerById"
}
test:MockFunction getCustomerByIdMockFn = new ();

@test:BeforeSuite
function setupMocks() {
    test:when(getCustomerByIdMockFn).call("mockGetCustomerById");
}

public function mockGetCustomerById(string id) returns Customer|error {
    if id == "CUST-EXISTS" || id == "CUST-001" {
        return {
            id: id,
            name: "Amelia Shilongo",
            email: "amelia@example.com",
            phone: "+264810000001",
            addresses: []
        };
    }
    if id == "CUST-NOT-FOUND" || id == "NONEXISTENT-CUST" {
        return error CustomerNotFoundError("Customer not found");
    }
    return error DatabaseOperationError("Failed to access collection: mongo offline");
}

