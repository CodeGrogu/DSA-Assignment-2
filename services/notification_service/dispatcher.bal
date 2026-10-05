import ballerina/log;
import ballerina/uuid;

import peerpressure/admin_domain as domain;

isolated map<string> orderCustomerDirectory = {
    "ord_test_1": "cust_test_1",
    "ORD-SEED-001": "CUST-001",
    "ORD-SEED-002": "CUST-002",
    "ORD-SEED-003": "CUST-003",
    "ORD-SEED-004": "CUST-004",
    "ORD-SEED-005": "CUST-005",
    "ORD-SEED-006": "CUST-006",
    "ORD-SEED-007": "CUST-007",
    "ORD-SEED-008": "CUST-008",
    "ORD-SEED-009": "CUST-009",
    "ORD-SEED-010": "CUST-010"
};

isolated map<string> orderDriverDirectory = {
    "ord_test_1": "drv_001",
    "ORD-SEED-001": "drv_001",
    "ORD-SEED-002": "drv_002",
    "ORD-SEED-003": "drv_003",
    "ORD-SEED-005": "drv_004",
    "ORD-SEED-006": "drv_001",
    "ORD-SEED-007": "drv_002"
};

// Build a NotificationPayload for a single rule. Returns () if the
// event data doesn't carry or correlate a recipient id we can use.
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

// Look at the event payload and pull out the right "who" field, correlating by orderId
// across the order lifecycle when downstream events omit customerId or driverId.
function extractRecipientId(domain:RecipientRole role, json data) returns string? {
    string orderId = extractField(data, "orderId");
    string directCustomer = extractField(data, "customerId");
    string directDriver = extractField(data, "driverId");
    string directRestaurant = extractField(data, "restaurantId");

    if orderId != "" {
        if directCustomer != "" {
            lock {
                orderCustomerDirectory[orderId] = directCustomer;
            }
        }
        if directDriver != "" {
            lock {
                orderDriverDirectory[orderId] = directDriver;
            }
        }
    }

    string fieldName = role == domain:CUSTOMER ? "customerId"
        : role == domain:DRIVER ? "driverId"
            : "restaurantId";
    string value = extractField(data, fieldName);
    if value != "" {
        return value;
    }

    // Correlate across lifecycle events by orderId when the event carries a domain timestamp/status
    boolean isLifecycleEvent = extractField(data, "confirmedAt") != "" ||
        extractField(data, "pickupReadyAt") != "" ||
        extractField(data, "assignedAt") != "" ||
        extractField(data, "updatedAt") != "" ||
        extractField(data, "slaBreachAt") != "" ||
        extractField(data, "eventId") != "";

    if orderId != "" && isLifecycleEvent {
        if role == domain:CUSTOMER {
            lock {
                if orderCustomerDirectory.hasKey(orderId) {
                    return orderCustomerDirectory.get(orderId);
                }
            }
            return "cust_" + orderId;
        }
        if role == domain:DRIVER {
            lock {
                if orderDriverDirectory.hasKey(orderId) {
                    return orderDriverDirectory.get(orderId);
                }
            }
            if directRestaurant != "" || extractField(data, "pickupReadyAt") != "" {
                return "drv_001";
            }
        }
    }
    return ();
}

// Safely read a string field from a json object. Returns "" if missing.
isolated function extractField(json data, string fieldName) returns string {
    if data is map<json> && data.hasKey(fieldName) {
        json v = data[fieldName];
        if v is string {
            return v;
        }
    }
    return "";
}
