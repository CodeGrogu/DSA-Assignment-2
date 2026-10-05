import ballerina/http;
import ballerina/io;
import ballerina/test;

isolated function getTestClient() returns http:Client|error {
    return new (string `http://localhost:${port}`);
}

isolated function resolveSeedFilePath() returns string|error {
    string[] candidates = [
        "services/admin_service/seed_data.json",
        "./seed_data.json",
        "admin_service/seed_data.json"
    ];
    foreach string path in candidates {
        string|error content = io:fileReadString(path);
        if content is string {
            return path;
        }
    }
    return error("Could not find seed_data.json in candidate paths");
}

@test:Config {}
function testHealthEndpoint() returns error? {
    http:Client clientEp = check getTestClient();
    http:Response resp = check clientEp->get("/health");
    test:assertEquals(resp.statusCode, 200);

    json payload = check resp.getJsonPayload();
    test:assertTrue(payload is map<json>);
    map<json> payloadMap = <map<json>>payload;

    test:assertEquals(payloadMap["status"], "UP");
    test:assertEquals(payloadMap["service"], "admin_service");
    test:assertEquals(payloadMap["port"], port);
    test:assertEquals(payloadMap["version"], "0.1.0");
    test:assertEquals(payloadMap["contracts"], "peerpressure/events:0.1.0");
}

@test:Config {}
function testStatsOverviewWithSeedPresent() returns error? {
    http:Client clientEp = check getTestClient();
    http:Response resp = check clientEp->get("/admin/stats/overview");
    test:assertEquals(resp.statusCode, 200);

    json payload = check resp.getJsonPayload();
    test:assertTrue(payload is map<json>);
    map<json> payloadMap = <map<json>>payload;

    test:assertTrue(payloadMap.hasKey("totalOrders"));
    test:assertTrue(payloadMap.hasKey("grossMerchandiseValue"));
    test:assertTrue(payloadMap.hasKey("successfulPayments"));
    test:assertTrue(payloadMap.hasKey("failedPayments"));
    test:assertTrue(payloadMap.hasKey("activeDeliveries"));
    test:assertTrue(payloadMap.hasKey("generatedAt"));

    test:assertEquals(payloadMap["totalOrders"], 5);
    decimal gmv = check (payloadMap["grossMerchandiseValue"]).cloneWithType(decimal);
    test:assertEquals(gmv, 571.25d);
    test:assertEquals(payloadMap["successfulPayments"], 4);
    test:assertEquals(payloadMap["failedPayments"], 1);
    test:assertEquals(payloadMap["activeDeliveries"], 1);
    test:assertTrue((payloadMap["generatedAt"] ?: "").toString().length() > 0);
}

@test:Config {}
function testRestaurantReportWithoutParams() returns error? {
    http:Client clientEp = check getTestClient();
    http:Response resp = check clientEp->get("/admin/reports/restaurant");
    test:assertEquals(resp.statusCode, 200);

    json payload = check resp.getJsonPayload();
    test:assertTrue(payload is json[]);
    json[] reports = <json[]>payload;
    test:assertEquals(reports.length(), 2);

    foreach json r in reports {
        test:assertTrue(r is map<json>);
        map<json> row = <map<json>>r;
        test:assertTrue(row.hasKey("restaurantId"));
        test:assertTrue(row.hasKey("orderCount"));
        test:assertTrue(row.hasKey("grossSales"));
        test:assertTrue(row.hasKey("commissionAmount"));
        test:assertTrue(row.hasKey("netPayout"));
    }
}

@test:Config {}
function testRestaurantReportWithQueryParams() returns error? {
    http:Client clientEp = check getTestClient();
    http:Response resp = check clientEp->get("/admin/reports/restaurant?from=2026-10-01&to=2026-10-01");
    test:assertEquals(resp.statusCode, 200);

    json payload = check resp.getJsonPayload();
    test:assertTrue(payload is json[]);
    json[] reports = <json[]>payload;
    test:assertEquals(reports.length(), 1);

    test:assertTrue(reports[0] is map<json>);
    map<json> r1 = <map<json>>reports[0];
    test:assertEquals(r1["restaurantId"], "r1");
    test:assertEquals(r1["orderCount"], 1);
    test:assertEquals(r1["grossSales"], 120.00d);
    test:assertEquals(r1["commissionAmount"], 12.00d);
    test:assertEquals(r1["netPayout"], 108.00d);
}

@test:Config {}
function testDriverReportWithoutParams() returns error? {
    http:Client clientEp = check getTestClient();
    http:Response resp = check clientEp->get("/admin/reports/driver");
    test:assertEquals(resp.statusCode, 200);

    json payload = check resp.getJsonPayload();
    test:assertTrue(payload is json[]);
    json[] reports = <json[]>payload;
    test:assertEquals(reports.length(), 2);

    foreach json r in reports {
        test:assertTrue(r is map<json>);
        map<json> row = <map<json>>r;
        test:assertTrue(row.hasKey("driverId"));
        test:assertTrue(row.hasKey("driverName"));
        test:assertTrue(row.hasKey("completedDeliveries"));
        test:assertTrue(row.hasKey("averageTurnaroundMinutes"));
        test:assertTrue(row.hasKey("slaBreaches"));
    }
}

@test:Config {}
function testDriverReportWithQueryParams() returns error? {
    http:Client clientEp = check getTestClient();
    http:Response resp = check clientEp->get("/admin/reports/driver?from=2026-10-01&to=2026-10-01");
    test:assertEquals(resp.statusCode, 200);

    json payload = check resp.getJsonPayload();
    test:assertTrue(payload is json[]);
    json[] reports = <json[]>payload;
    test:assertEquals(reports.length(), 1);

    test:assertTrue(reports[0] is map<json>);
    map<json> d1 = <map<json>>reports[0];
    test:assertEquals(d1["driverId"], "dr1");
    test:assertEquals(d1["driverName"], "Tomas");
    test:assertEquals(d1["completedDeliveries"], 1);
    test:assertEquals(d1["averageTurnaroundMinutes"], 30.0d);
    test:assertEquals(d1["slaBreaches"], 0);
}

@test:Config {
    dependsOn: [
        testStatsOverviewWithSeedPresent,
        testRestaurantReportWithoutParams,
        testRestaurantReportWithQueryParams,
        testDriverReportWithoutParams,
        testDriverReportWithQueryParams
    ]
}
function testStatsOverviewWithEmptySeed() returns error? {
    string seedPath = check resolveSeedFilePath();
    string originalContent = check io:fileReadString(seedPath);
    // Write empty string to simulate an empty seed file
    check io:fileWriteString(seedPath, "");

    http:Client clientEp = check getTestClient();
    http:Response|error resp = clientEp->get("/admin/stats/overview");

    // Always restore the original seed content
    check io:fileWriteString(seedPath, originalContent);

    http:Response actualResp = check resp;
    test:assertEquals(actualResp.statusCode, 200);

    json payload = check actualResp.getJsonPayload();
    test:assertTrue(payload is map<json>);
    map<json> payloadMap = <map<json>>payload;

    test:assertTrue(payloadMap.hasKey("totalOrders"));
    test:assertTrue(payloadMap.hasKey("grossMerchandiseValue"));
    test:assertTrue(payloadMap.hasKey("successfulPayments"));
    test:assertTrue(payloadMap.hasKey("failedPayments"));
    test:assertTrue(payloadMap.hasKey("activeDeliveries"));
    test:assertTrue(payloadMap.hasKey("generatedAt"));

    test:assertEquals(payloadMap["totalOrders"], 0);
    decimal gmv = check (payloadMap["grossMerchandiseValue"]).cloneWithType(decimal);
    test:assertEquals(gmv, 0d);
    test:assertEquals(payloadMap["successfulPayments"], 0);
    test:assertEquals(payloadMap["failedPayments"], 0);
    test:assertEquals(payloadMap["activeDeliveries"], 0);
    test:assertTrue((payloadMap["generatedAt"] ?: "").toString().length() > 0);
}

@test:Config {
    dependsOn: [testStatsOverviewWithEmptySeed]
}
function testStatsOverviewWithEmptyJsonObjectSeed() returns error? {
    string seedPath = check resolveSeedFilePath();
    string originalContent = check io:fileReadString(seedPath);
    // Write empty json object
    check io:fileWriteString(seedPath, "{}");

    http:Client clientEp = check getTestClient();
    http:Response|error resp = clientEp->get("/admin/stats/overview");

    // Always restore the original seed content
    check io:fileWriteString(seedPath, originalContent);

    http:Response actualResp = check resp;
    test:assertEquals(actualResp.statusCode, 200);

    json payload = check actualResp.getJsonPayload();
    test:assertTrue(payload is map<json>);
    map<json> payloadMap = <map<json>>payload;

    test:assertEquals(payloadMap["totalOrders"], 0);
    decimal gmvEmpty = check (payloadMap["grossMerchandiseValue"]).cloneWithType(decimal);
    test:assertEquals(gmvEmpty, 0d);
    test:assertEquals(payloadMap["successfulPayments"], 0);
    test:assertEquals(payloadMap["failedPayments"], 0);
    test:assertEquals(payloadMap["activeDeliveries"], 0);
    test:assertTrue((payloadMap["generatedAt"] ?: "").toString().length() > 0);
}
