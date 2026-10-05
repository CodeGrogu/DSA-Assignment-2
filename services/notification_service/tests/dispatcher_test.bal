import ballerina/test;

import peerpressure/admin_domain as domain;

@test:Config {}
function testParseOrderCreatedEnvelope() {
    json data = {
        "eventId": "evt-1",
        "orderId": "ord-1",
        "customerId": "cust-42",
        "restaurantId": "rest-9",
        "totalAmount": 250.00
    };
    json envelope = {"eventType": "order.created", "data": data};

    byte[] raw = envelope.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);

    test:assertTrue(parsed is ParsedEvent);
    if parsed is ParsedEvent {
        test:assertEquals(parsed.eventType, "order.created");
    }
}

@test:Config {}
function testBadEnvelopeIsRejected() {
    json notAnEnvelope = {"foo": "bar"};
    byte[] raw = notAnEnvelope.toString().toBytes();
    ParsedEvent? parsed = parseEnvelope(raw);
    test:assertTrue(parsed is ());
}

@test:Config {}
function testExtractRecipientIdForCustomer() {
    json data = {"customerId": "cust-7", "orderId": "ord-9"};
    string? id = extractRecipientId(domain:CUSTOMER, data);
    test:assertEquals(id, "cust-7");
}

@test:Config {}
function testExtractRecipientIdMissingField() {
    json data = {"orderId": "ord-9"};
    string? id = extractRecipientId(domain:CUSTOMER, data);
    test:assertTrue(id is ());
}

@test:Config {}
function testRenderSubjectForSlaBreach() {
    test:assertEquals(renderSubject("sla_breach_customer"), "Order delay");
}
