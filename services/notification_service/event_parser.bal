import ballerina/log;

// Wrapper every service puts around its payload so we know what it is.
// Shape: { "eventType": "order.created", "data": { ... } }
public type EventEnvelope record {|
    string eventType;
    json data;
|};

// Result of parsing a raw payload — carries both the type and the typed record.
public type ParsedEvent record {|
    string eventType;
    json data;
|};

// Try to decode bytes into an envelope or raw domain event. Returns nil if it doesn't match.
public function parseEnvelope(byte[] raw, string? topic = ()) returns ParsedEvent? {
    string|error textResult = string:fromBytes(raw);
    if textResult is error {
        log:printWarn("Failed to decode raw bytes to string", 'error = textResult);
        return ();
    }
    string text = textResult;

    json|error payloadResult = payloadFromJson(text);
    if payloadResult is error {
        log:printWarn("Failed to parse JSON payload", 'error = payloadResult, payload = text);
        return ();
    }
    json payload = payloadResult;

    // Must be a JSON object
    if payload !is map<json> {
        log:printWarn("Dropped a message — payload is not a JSON object", payload = text);
        return ();
    }

    // 1. Explicit envelope with eventType and data
    if payload.hasKey("eventType") && payload.hasKey("data") {
        json eventTypeVal = payload["eventType"];
        if eventTypeVal is string && eventTypeVal.trim().length() > 0 {
            return {
                eventType: eventTypeVal.trim(),
                data: payload["data"]
            };
        }
    }

    // 2. Explicit eventType at root level without separate "data" key
    if payload.hasKey("eventType") {
        json eventTypeVal = payload["eventType"];
        if eventTypeVal is string && eventTypeVal.trim().length() > 0 {
            return {
                eventType: eventTypeVal.trim(),
                data: payload
            };
        }
    }

    // 3. Fallback for alternate event type property names ("event_type", "type")
    if payload.hasKey("event_type") {
        json eventTypeVal = payload["event_type"];
        if eventTypeVal is string && eventTypeVal.trim().length() > 0 {
            json data = payload.hasKey("data") ? payload["data"] : payload;
            return {
                eventType: eventTypeVal.trim(),
                data: data
            };
        }
    }

    if payload.hasKey("type") {
        json typeVal = payload["type"];
        if typeVal is string && typeVal.trim().length() > 0 {
            string? mapped = mapTypeIdentifier(typeVal.trim());
            if mapped is string {
                json data = payload.hasKey("data") ? payload["data"] : payload;
                return {
                    eventType: mapped,
                    data: data
                };
            }
        }
    }

    // 4. Infer eventType from raw domain event contents, eventId, and topic
    string? inferredType = inferEventType(payload, topic);
    if inferredType is string {
        return {
            eventType: inferredType,
            data: payload
        };
    }

    log:printWarn("Dropped a message — no eventType/data envelope or recognizable domain event", payload = text);
    return ();
}

// Map common PascalCase or snake_case type identifiers to domain event types
isolated function mapTypeIdentifier(string rawType) returns string? {
    match rawType {
        "OrderCreated"|"OrderCreatedEvent"|"order_created" => {
            return "order.created";
        }
        "OrderConfirmed"|"OrderConfirmedEvent"|"order_confirmed" => {
            return "order.confirmed";
        }
        "OrderCancelled"|"OrderCancelledEvent"|"order_cancelled" => {
            return "order.cancelled";
        }
        "OrderPreparing"|"OrderPreparingEvent"|"order_preparing" => {
            return "order.preparing";
        }
        "PaymentCompleted"|"PaymentCompletedEvent"|"payment_completed" => {
            return "payment.completed";
        }
        "PaymentFailed"|"PaymentFailedEvent"|"payment_failed" => {
            return "payment.failed";
        }
        "KitchenOrderReady"|"KitchenReadyEvent"|"KitchenOrderReadyEvent"|"kitchen_order_ready" => {
            return "kitchen.order.ready";
        }
        "DeliveryAssigned"|"DeliveryAssignedEvent"|"delivery_assigned" => {
            return "delivery.assigned";
        }
        "DeliveryStatusUpdated"|"DeliveryStatusUpdateEvent"|"delivery_status_updated" => {
            return "delivery.status";
        }
        _ => {
            return ();
        }
    }
}

// Infer event type from payload fields, eventId, or topic
isolated function inferEventType(map<json> data, string? topic) returns string? {
    string? status = getStringField(data, "status");
    string? eventId = getStringField(data, "eventId");

    // Check specific timestamp / lifecycle fields first
    if data.hasKey("pickupReadyAt") || data.hasKey("pickupAddress") {
        return "kitchen.order.ready";
    }

    if data.hasKey("confirmedAt") {
        return "order.confirmed";
    }

    if data.hasKey("preparingStartedAt") {
        return "order.preparing";
    }

    if data.hasKey("cancelledAt") || data.hasKey("cancelledBy") {
        return "order.cancelled";
    }

    if data.hasKey("completedAt") && (data.hasKey("paymentId") || data.hasKey("transactionId") || data.hasKey("transactionReference") || topic == "payments.completed") {
        return "payment.completed";
    }

    if data.hasKey("failedAt") || (data.hasKey("errorCode") && data.hasKey("reason") && (data.hasKey("amount") || data.hasKey("paymentId"))) {
        return "payment.failed";
    }

    if data.hasKey("assignedAt") || (data.hasKey("driverName") && data.hasKey("driverPhone") && data.hasKey("deliveryId")) {
        return "delivery.assigned";
    }

    if data.hasKey("deliveredAt") {
        return "delivery.completed";
    }

    if data.hasKey("slaBreached") || data.hasKey("sla_breach") {
        return "delivery.sla_breach";
    }

    // Check status value
    if status is string {
        string normalizedStatus = status.trim().toUpperAscii();
        match normalizedStatus {
            "CREATED" => {
                return "order.created";
            }
            "CONFIRMED" => {
                return "order.confirmed";
            }
            "PREPARING" => {
                return "order.preparing";
            }
            "READY" => {
                return "kitchen.order.ready";
            }
            "CANCELLED" => {
                return "order.cancelled";
            }
            "COMPLETED" => {
                if data.hasKey("paymentId") || data.hasKey("transactionId") || topic == "payments.completed" {
                    return "payment.completed";
                }
                if data.hasKey("deliveryId") || topic == "delivery.status" {
                    return "delivery.completed";
                }
                return "payment.completed";
            }
            "FAILED" => {
                if data.hasKey("paymentId") || data.hasKey("errorCode") || topic == "payments.failed" {
                    return "payment.failed";
                }
                return "payment.failed";
            }
            "ASSIGNED" => {
                return "delivery.assigned";
            }
            "DELIVERED" => {
                return "delivery.completed";
            }
            "PICKED_UP"|"IN_TRANSIT" => {
                return "delivery.status";
            }
            _ => {
            }
        }
    }

    // Check paymentId with completedAt or status
    if data.hasKey("paymentId") {
        if data.hasKey("completedAt") {
            return "payment.completed";
        }
    }

    // Check topic-based inference
    if topic is string {
        match topic {
            "orders.created" => {
                return "order.created";
            }
            "orders.confirmed" => {
                return "order.confirmed";
            }
            "orders.cancelled" => {
                return "order.cancelled";
            }
            "payments.completed" => {
                return "payment.completed";
            }
            "payments.failed" => {
                return "payment.failed";
            }
            "orders.preparing" => {
                return "order.preparing";
            }
            "kitchen.orders.ready" => {
                return "kitchen.order.ready";
            }
            "delivery.assigned" => {
                return "delivery.assigned";
            }
            "delivery.status" => {
                if data.hasKey("deliveredAt") {
                    return "delivery.completed";
                }
                return "delivery.status";
            }
            _ => {
            }
        }
    }

    // Check eventId naming patterns
    if eventId is string {
        string lowerId = eventId.toLowerAscii();
        if lowerId.includes("created") {
            return "order.created";
        }
        if lowerId.includes("confirmed") {
            return "order.confirmed";
        }
        if lowerId.includes("cancelled") {
            return "order.cancelled";
        }
        if lowerId.includes("completed") && (data.hasKey("paymentId") || lowerId.includes("pay")) {
            return "payment.completed";
        }
        if lowerId.includes("failed") && (data.hasKey("paymentId") || lowerId.includes("pay")) {
            return "payment.failed";
        }
        if lowerId.includes("preparing") {
            return "order.preparing";
        }
        if lowerId.includes("ready") {
            return "kitchen.order.ready";
        }
        if lowerId.includes("assigned") {
            return "delivery.assigned";
        }
        if lowerId.includes("delivered") {
            return "delivery.completed";
        }
        if lowerId.includes("sla") || lowerId.includes("breach") {
            return "delivery.sla_breach";
        }
    }

    // Characteristic domain field combinations
    if data.hasKey("deliveryId") && data.hasKey("driverId") {
        return "delivery.status";
    }

    if data.hasKey("totalAmount") && data.hasKey("items") && (data.hasKey("customerId") || data.hasKey("orderId")) {
        return "order.created";
    }

    return ();
}

// Helper to extract a string field from map<json> safely
isolated function getStringField(map<json> data, string fieldName) returns string? {
    if data.hasKey(fieldName) {
        json val = data[fieldName];
        if val is string {
            return val;
        }
    }
    return ();
}

// Parse a JSON string. Small wrapper so we can add logging later.
function payloadFromJson(string text) returns json|error {
    return text.fromJsonString();
}

