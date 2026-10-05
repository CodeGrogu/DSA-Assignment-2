import ballerina/http;
import ballerina/test;

@test:Config {}
isolated function testConcurrentBurstStockDecrementPreventsOverselling() returns error? {
    http:Client clientEp = check new ("http://localhost:9095");

    // 1. Create a restaurant
    json restaurantPayload = {
        name: "Test Burger Joint",
        address: "123 Test St",
        contactNumber: "1234567890",
        location: {
            'type: "Point",
            coordinates: [18.4232, -33.9249]
        },
        operatingHours: [
            {
                dayOfWeek: "Monday",
                openTime: "00:00",
                closeTime: "23:59"
            },
            {
                dayOfWeek: "Tuesday",
                openTime: "00:00",
                closeTime: "23:59"
            },
            {
                dayOfWeek: "Wednesday",
                openTime: "00:00",
                closeTime: "23:59"
            },
            {
                dayOfWeek: "Thursday",
                openTime: "00:00",
                closeTime: "23:59"
            },
            {
                dayOfWeek: "Friday",
                openTime: "00:00",
                closeTime: "23:59"
            },
            {
                dayOfWeek: "Saturday",
                openTime: "00:00",
                closeTime: "23:59"
            },
            {
                dayOfWeek: "Sunday",
                openTime: "00:00",
                closeTime: "23:59"
            }
        ],
        holidayExceptions: [],
        menu: [
            {
                id: "C1",
                name: "Mains",
                items: [
                    {
                        id: "M1",
                        name: "Burger",
                        price: 10.0,
                        stock: 5,
                        isAvailable: true
                    }
                ]
            }
        ]
    };

    http:Response res = check clientEp->post("/restaurants", restaurantPayload);
    test:assertEquals(res.statusCode, 201);
    json created = check res.getJsonPayload();
    string restId = check created.id;
    string itemId = "M1";

    // 2. Launch 20 concurrent worker requests for 1 item each
    future<http:Response|error>[] futures = [];
    foreach int i in 1 ... 20 {
        future<http:Response|error> f = start sendReservationRequest(clientEp, restId, itemId);
        futures.push(f);
    }

    int successCount = 0;
    int conflictCount = 0;
    foreach future<http:Response|error> f in futures {
        http:Response|error reqRes = wait f;
        if reqRes is http:Response {
            if reqRes.statusCode == 200 {
                successCount += 1;
            } else if reqRes.statusCode == 409 {
                conflictCount += 1;
            } else {
                test:assertFail("Unexpected status code: " + reqRes.statusCode.toString());
            }
        } else {
            test:assertFail("Request failed: " + reqRes.message());
        }
    }

    test:assertEquals(successCount, 5, "Exactly 5 requests should succeed");
    test:assertEquals(conflictCount, 15, "Exactly 15 requests should fail due to conflict");

    // 3. Verify final DB stock == 0
    http:Response menuRes = check clientEp->get(string `/restaurants/${restId}/menu`);
    test:assertEquals(menuRes.statusCode, 200);
    json payload = check menuRes.getJsonPayload();
    json[] menuArray = <json[]>payload;
    map<json> firstCat = <map<json>>menuArray[0];
    json[] items = <json[]>firstCat["items"];
    map<json> firstItem = <map<json>>items[0];
    int stock = <int>firstItem["stock"];
    test:assertEquals(stock, 0, "Stock should be exactly 0");
}

isolated function sendReservationRequest(http:Client clientEp, string restId, string itemId) returns http:Response|error {
    return clientEp->post(string `/restaurants/${restId}/order/validate-and-reserve`, {
        items: [{itemId: itemId, quantity: 1}]
    });
}
