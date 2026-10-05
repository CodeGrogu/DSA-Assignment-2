import ballerina/http;
import ballerina/test;

@test:Config {}
function testCustomerRecordConstruction() returns error? {
    CustomerAddress address = {
        id: "ADDR-001",
        tag: "Home",
        street: "12 Independence Avenue",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10001",
        location: {
            'type: "Point",
            coordinates: [17.0658, -22.5609]
        },
        deliveryInstructions: "Ring bell twice",
        isDefault: true
    };

    Customer customer = {
        id: "CUST-001",
        name: "Amelia Shilongo",
        email: "amelia.shilongo@example.com",
        phone: "+264810000001",
        addresses: [address]
    };

    test:assertEquals(customer.id, "CUST-001");
    test:assertEquals(customer.name, "Amelia Shilongo");
    test:assertEquals(customer.email, "amelia.shilongo@example.com");
    test:assertEquals(customer.addresses.length(), 1);
    test:assertEquals(customer.addresses[0].id, "ADDR-001");
    test:assertEquals(customer.addresses[0].location.coordinates[0], 17.0658);
    test:assertEquals(customer.addresses[0].location.coordinates[1], -22.5609);
    test:assertTrue(customer.addresses[0].isDefault);
}

@test:Config {}
function testGeoJsonPointValidationSuccess() returns error? {
    GeoJSONPoint validPoint = {
        'type: "Point",
        coordinates: [17.0658, -22.5609]
    };
    string? err = validateGeoJSONPoint(validPoint);
    test:assertEquals(err, ());
}

@test:Config {}
function testGeoJsonPointValidationInvalidCoordinates() returns error? {
    GeoJSONPoint invalidType = {
        'type: "Polygon",
        coordinates: [17.0658, -22.5609]
    };
    string? errType = validateGeoJSONPoint(invalidType);
    test:assertTrue(errType is string && errType.includes("Point"));

    GeoJSONPoint wrongLength = {
        'type: "Point",
        coordinates: [17.0658]
    };
    string? errLen = validateGeoJSONPoint(wrongLength);
    test:assertTrue(errLen is string && errLen.includes("coordinates"));

    GeoJSONPoint outOfBoundsLon = {
        'type: "Point",
        coordinates: [195.0, -22.0]
    };
    string? errLon = validateGeoJSONPoint(outOfBoundsLon);
    test:assertTrue(errLon is string && errLon.includes("Longitude"));

    GeoJSONPoint outOfBoundsLat = {
        'type: "Point",
        coordinates: [17.0, -95.0]
    };
    string? errLat = validateGeoJSONPoint(outOfBoundsLat);
    test:assertTrue(errLat is string && errLat.includes("Latitude"));
}

@test:Config {}
function testCustomerAddressValidation() returns error? {
    CustomerAddress validAddress = {
        id: "ADDR-002",
        tag: "Work",
        street: "50 Robert Mugabe Avenue",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10002",
        location: {
            'type: "Point",
            coordinates: [17.0850, -22.5700]
        },
        deliveryInstructions: "Leave at reception",
        isDefault: false
    };
    string? err = validateCustomerAddress(validAddress);
    test:assertEquals(err, ());

    CustomerAddress missingStreet = {
        id: "ADDR-003",
        tag: "Work",
        street: "   ",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10002",
        location: {
            'type: "Point",
            coordinates: [17.0850, -22.5700]
        },
        deliveryInstructions: "",
        isDefault: false
    };
    string? errStreet = validateCustomerAddress(missingStreet);
    test:assertTrue(errStreet is string && errStreet.includes("street"));
}

@test:Config {}
function testCustomerValidation() returns error? {
    Customer validCustomer = {
        id: "CUST-002",
        name: "Jonas Shipahu",
        email: "jonas.shipahu@example.com",
        phone: "+264810000002",
        addresses: []
    };
    string? err = validateCustomer(validCustomer);
    test:assertEquals(err, ());

    Customer invalidEmail = {
        id: "CUST-003",
        name: "Invalid User",
        email: "invalid-email-string",
        phone: "+264810000003",
        addresses: []
    };
    string? errEmail = validateCustomer(invalidEmail);
    test:assertTrue(errEmail is string && errEmail.includes("email"));

    Customer emptyId = {
        id: "",
        name: "Invalid User",
        email: "user@example.com",
        phone: "+264810000003",
        addresses: []
    };
    string? errId = validateCustomer(emptyId);
    test:assertTrue(errId is string && errId.includes("ID"));
}

@test:Config {}
function testDefaultAddressResolution() returns error? {
    CustomerAddress addr1 = {
        id: "ADDR-001",
        tag: "Secondary",
        street: "1st Ave",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10001",
        location: {'type: "Point", coordinates: [17.0, -22.0]},
        isDefault: false
    };
    CustomerAddress addr2 = {
        id: "ADDR-002",
        tag: "Primary",
        street: "2nd Ave",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "10001",
        location: {'type: "Point", coordinates: [17.1, -22.1]},
        isDefault: true
    };

    Customer customerWithDefault = {
        id: "CUST-100",
        name: "Test Customer",
        email: "test@example.com",
        phone: "+264810000100",
        addresses: [addr1, addr2]
    };

    CustomerAddress? resolved = getDefaultAddress(customerWithDefault);
    test:assertTrue(resolved is CustomerAddress);
    if resolved is CustomerAddress {
        test:assertEquals(resolved.id, "ADDR-002");
    }

    Customer customerWithoutAddresses = {
        id: "CUST-101",
        name: "No Address Customer",
        email: "noaddr@example.com",
        phone: "+264810000101",
        addresses: []
    };
    test:assertEquals(getDefaultAddress(customerWithoutAddresses), ());
}

@test:Config {}
function testTypedErrorCreationAndMatching() returns error? {
    error dupErr = error DuplicateEmailError("Customer email already exists");
    test:assertTrue(dupErr is DuplicateEmailError, "Should match DuplicateEmailError");

    error notFoundErr = error CustomerNotFoundError("Customer not found");
    test:assertTrue(notFoundErr is CustomerNotFoundError, "Should match CustomerNotFoundError");

    error dbOpErr = error DatabaseOperationError("Database connection failed");
    test:assertTrue(dbOpErr is DatabaseOperationError, "Should match DatabaseOperationError");
}

@test:Config {}
function testOfflineFastFailWhenMongoUnreachable() returns error? {
    Customer|error result = getCustomerById("NON-EXISTENT-ID");
    test:assertTrue(result is error, "Should return error when MongoDB is offline");
    if result is error {
        test:assertTrue(
                result is DatabaseOperationError || result is CustomerNotFoundError,
                "Error should be DatabaseOperationError or CustomerNotFoundError"
        );
    }
}

@test:Config {}
function testOfflineInsertFastFailWhenMongoUnreachable() returns error? {
    Customer testCust = {
        id: "TEST-CUST-OFFLINE",
        name: "Offline User",
        email: "offline@example.com",
        phone: "+264810000999",
        addresses: []
    };
    error? result = insertCustomer(testCust);
    test:assertTrue(result is error, "Should return error when MongoDB is offline");
    if result is error {
        test:assertTrue(
                result is DatabaseOperationError || result is DuplicateEmailError,
                "Error should be DatabaseOperationError or DuplicateEmailError"
        );
    }
}

@test:Config {}
function testHealthEndpoint() returns error? {
    http:Client clientEp = check new (string `http://localhost:${port}`);
    http:Response res = check clientEp->get("/health");
    test:assertEquals(res.statusCode, 200);
    json payload = check res.getJsonPayload();
    test:assertTrue(payload is map<json>);
    map<json> jsonMap = <map<json>>payload;
    test:assertEquals(jsonMap["status"], "UP");
    test:assertEquals(jsonMap["service"], "customer_service");
}
