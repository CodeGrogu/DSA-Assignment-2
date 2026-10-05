import ballerina/http;
import ballerina/test;

@test:Config {}
function testSplitPipeBasic() {
    string[] parts = splitPipe("2026-01-01T00:00:00Z | cust-42 | PUSH | SENT | abc-123");
    test:assertEquals(parts.length(), 5);
    test:assertEquals(parts[1], "cust-42");
    test:assertEquals(parts[2], "PUSH");
    test:assertEquals(parts[3], "SENT");
}

@test:Config {}
function testSplitPipeHandlesWhitespace() {
    string[] parts = splitPipe("a|b|c");
    test:assertEquals(parts[0], "a");
    test:assertEquals(parts[1], "b");
    test:assertEquals(parts[2], "c");
}

@test:Config {}
function testHealthEndpoint() returns error? {
    http:Client clientEP = check new (string `http://localhost:${port}`);
    json res = check clientEP->get("/health");
    test:assertEquals(check res.status, "UP");
    test:assertEquals(check res.'service, "notification_service");
    test:assertEquals(check res.port, port);
    test:assertEquals(check res.version, "0.1.0");
    test:assertEquals(check res.contracts, "peerpressure/events:0.1.0");
}

@test:Config {}
function testRecipientNotFound() returns error? {
    http:Client clientEP = check new (string `http://localhost:${port}`);
    http:Response res = check clientEP->get("/notifications/recipient/nonexistent-user-12345");
    test:assertEquals(res.statusCode, 404);
}

