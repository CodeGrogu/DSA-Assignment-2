import ballerina/test;

import peerpressure/admin_domain as domain;

@test:Config {}
function testBuildAuditRecordPreservesFields() {
    domain:NotificationPayload p = {
        notificationId: "n-1",
        role: domain:CUSTOMER,
        recipientId: "cust-42",
        channel: domain:PUSH,
        severity: domain:INFO,
        subject: "Hi",
        body: "Hello",
        relatedEventType: "order.created",
        relatedEventId: "evt-1",
        createdAt: "2026-10-04T10:00:00Z"
    };

    domain:NotificationAuditRecord entry = buildAuditRecord(p, "SENT");

    test:assertEquals(entry.notificationId, "n-1");
    test:assertEquals(entry.recipientId, "cust-42");
    test:assertEquals(entry.channel, domain:PUSH);
    test:assertEquals(entry.status, "SENT");
    test:assertTrue(entry.sentAt.length() > 0);
}
