import ballerina/log;
import ballerina/uuid;

import peerpressure/admin_domain as domain;

// Build a NotificationPayload for a single rule. Returns () if the
// event data doesn't carry a recipient id we can use.
function buildPayload(domain:SubscriptionRule rule, json data) returns domain:NotificationPayload? {
    string? recipientId = extractRecipientId(rule.recipient, data);
    if recipientId is () {
        log:printWarn("No recipient id in event data", role = rule.recipient.toString());
        return ();
    }
    string eventId = extractField(data, "eventId");
    return {
        notificationId: uuid:createType1AsString(),
        role: rule.recipient,
        recipientId: recipientId,
        channel: rule.channel,
        severity: rule.severity,
        subject: renderSubject(rule.template),
        body: renderBody(rule.template, data),
        relatedEventType: rule.eventType,
        relatedEventId: eventId,
        createdAt: "" // filled in by caller so tests can freeze time
    };
}

// Look at the event payload and pull out the right "who" field.
// Different events put the id in different places.
function extractRecipientId(domain:RecipientRole role, json data) returns string? {
    string fieldName = role == domain:CUSTOMER ? "customerId"
        : role == domain:DRIVER ? "driverId"
            : "restaurantId";
    string value = extractField(data, fieldName);
    return value == "" ? () : value;
}

// Safely read a string field from a json object. Returns "" if missing.
function extractField(json data, string fieldName) returns string {
    if data is map<json> && data.hasKey(fieldName) {
        json v = data[fieldName];
        if v is string {
            return v;
        }
    }
    return "";
}
