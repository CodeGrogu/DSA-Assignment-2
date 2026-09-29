import ballerina/http;
import ballerina/test;

final http:Client customerHttpClient = check new ("http://localhost:9093");

@test:Config {}
function testHealthEndpoint() returns error? {
    http:Response res = check customerHttpClient->get("/health");
    test:assertEquals(res.statusCode, 200);
}

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
                coordinates: [-0.1276, 51.5074] // London coordinates
            },
            deliveryInstructions: "",
            isDefault: false
        }
    };

    AddressVerificationResponse res = check verifyCustomerAddress(req);
    test:assertFalse(res.valid);
    test:assertFalse(res.withinDeliveryRange);
}
