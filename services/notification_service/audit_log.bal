import ballerina/io;
import ballerina/log;
import ballerina/time;

import peerpressure/admin_domain as domain;

final string AUDIT_FILE = "./audit.log";

public function buildAuditRecord(domain:NotificationPayload payload, string status) returns domain:NotificationAuditRecord {
    string now = time:utcToString(time:utcNow());
    return {
        notificationId: payload.notificationId,
        role: payload.role,
        recipientId: payload.recipientId,
        channel: payload.channel,
        severity: payload.severity,
        payload: payload.toString(),
        status: status,
        sentAt: now
    };
}

public function saveAudit(domain:NotificationPayload payload, string status) returns error? {
    string now = time:utcToString(time:utcNow());

    // Copy the payload field by field so we can stamp our own createdAt.
    domain:NotificationPayload filled = {
        notificationId: payload.notificationId,
        role: payload.role,
        recipientId: payload.recipientId,
        channel: payload.channel,
        severity: payload.severity,
        subject: payload.subject,
        body: payload.body,
        relatedEventType: payload.relatedEventType,
        relatedEventId: payload.relatedEventId,
        createdAt: now
    };

    domain:NotificationAuditRecord entry = buildAuditRecord(filled, status);

    string line = string `${entry.sentAt} | ${entry.recipientId} | ${entry.channel.toString()} | ${entry.status} | ${entry.notificationId}`;

    error? result = io:fileWriteString(AUDIT_FILE, line + "\n", io:APPEND);
    if result is error {
        log:printError("Couldn't write audit line", 'error = result, recipient = entry.recipientId);
        return result;
    }

    log:printInfo("Audit saved",
            recipient = entry.recipientId,
            channel = entry.channel.toString(),
            status = entry.status);
    return;
}
