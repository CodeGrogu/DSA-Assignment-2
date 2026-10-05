import ballerina/log;

import peerpressure/kafka_client;

// Event envelope we expect on the wire:
// {
//   "eventType": "order.created",
//   "data": { ... }
// }
// Or a raw domain event (OrderCreatedEvent, PaymentCompletedEvent, etc.)

public type ParsedEvent record {|
    string eventType;
    json data;
|};

// Try to decode bytes into an envelope or raw domain event using kafka_client:safeParseJson.
public function parseEnvelope(byte[] raw, string? topic = ()) returns ParsedEvent? {
    json|kafka_client:DeserializationError payloadResult = kafka_client:safeParseJson(raw);
    if payloadResult is kafka_client:DeserializationError {
        log:printWarn("Failed to deserialize raw Kafka payload", 'error = payloadResult);
        return ();
    }
    json payload = payloadResult;

    // Must be a JSON object
    if payload !is map<json> {
        log:printWarn("Dropped a message — payload is not a JSON object", payload = payload.toJsonString());
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

    log:printWarn("Dropped a message — no eventType/data envelope or recognizable domain event", payload = payload.toJsonString());
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

    if data.hasKey("slaBreachAt") || data.hasKey("slaBreached") || data.hasKey("sla_breach") {
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
                if data.hasKey("deliveryId") || topic == "delivery.status" {
                    return "delivery.completed";
                }
                return "payment.completed";
            }
            "FAILED" => {
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
            "delivery.sla_breach" => {
                return "delivery.sla_breach";
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
