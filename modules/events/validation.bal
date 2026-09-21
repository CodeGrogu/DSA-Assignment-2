// JSON serialization and schema validation functions for shared event records

public isolated function orderCreatedToJson(OrderCreated event) returns json {
    return event.toJson();
}

public isolated function paymentCompletedToJson(PaymentCompleted event) returns json {
    return event.toJson();
}

public isolated function kitchenOrderReadyToJson(KitchenOrderReady event) returns json {
    return event.toJson();
}

public isolated function deliveryStatusUpdatedToJson(DeliveryStatusUpdated event) returns json {
    return event.toJson();
}

public isolated function validateOrderCreated(json data) returns OrderCreated|error {
    OrderCreated event = check data.cloneWithType(OrderCreated);
    if event.eventId.trim().length() == 0 {
        return error("Validation failed: eventId must not be empty");
    }
    if event.orderId.trim().length() == 0 {
        return error("Validation failed: orderId must not be empty");
    }
    if event.customerId.trim().length() == 0 {
        return error("Validation failed: customerId must not be empty");
    }
    if event.restaurantId.trim().length() == 0 {
        return error("Validation failed: restaurantId must not be empty");
    }
    if event.totalAmount < 0d {
        return error("Validation failed: totalAmount cannot be negative");
    }
    if event.items.length() == 0 {
        return error("Validation failed: items must contain at least one order item");
    }
    foreach OrderItem item in event.items {
        if item.quantity <= 0 {
            return error("Validation failed: item quantity must be greater than zero");
        }
        if item.unitPrice < 0d {
            return error("Validation failed: item unitPrice cannot be negative");
        }
        if item.subtotal < 0d {
            return error("Validation failed: item subtotal cannot be negative");
        }
    }
    return event;
}

public isolated function validatePaymentCompleted(json data) returns PaymentCompleted|error {
    PaymentCompleted event = check data.cloneWithType(PaymentCompleted);
    if event.eventId.trim().length() == 0 {
        return error("Validation failed: eventId must not be empty");
    }
    if event.paymentId.trim().length() == 0 {
        return error("Validation failed: paymentId must not be empty");
    }
    if event.orderId.trim().length() == 0 {
        return error("Validation failed: orderId must not be empty");
    }
    if event.customerId.trim().length() == 0 {
        return error("Validation failed: customerId must not be empty");
    }
    if event.amount < 0d {
        return error("Validation failed: payment amount cannot be negative");
    }
    if event.currency.trim().length() == 0 {
        return error("Validation failed: currency must not be empty");
    }
    if event.paymentMethod.trim().length() == 0 {
        return error("Validation failed: paymentMethod must not be empty");
    }
    if event.transactionReference.trim().length() == 0 {
        return error("Validation failed: transactionReference must not be empty");
    }
    return event;
}

public isolated function validateKitchenOrderReady(json data) returns KitchenOrderReady|error {
    KitchenOrderReady event = check data.cloneWithType(KitchenOrderReady);
    if event.eventId.trim().length() == 0 {
        return error("Validation failed: eventId must not be empty");
    }
    if event.orderId.trim().length() == 0 {
        return error("Validation failed: orderId must not be empty");
    }
    if event.restaurantId.trim().length() == 0 {
        return error("Validation failed: restaurantId must not be empty");
    }
    if event.pickupReadyAt.trim().length() == 0 {
        return error("Validation failed: pickupReadyAt must not be empty");
    }
    return event;
}

public isolated function validateDeliveryStatusUpdated(json data) returns DeliveryStatusUpdated|error {
    DeliveryStatusUpdated event = check data.cloneWithType(DeliveryStatusUpdated);
    if event.eventId.trim().length() == 0 {
        return error("Validation failed: eventId must not be empty");
    }
    if event.deliveryId.trim().length() == 0 {
        return error("Validation failed: deliveryId must not be empty");
    }
    if event.orderId.trim().length() == 0 {
        return error("Validation failed: orderId must not be empty");
    }
    if event.driverId.trim().length() == 0 {
        return error("Validation failed: driverId must not be empty");
    }
    GeoCoordinate? coord = event.currentLocation;
    if coord is GeoCoordinate {
        if coord.latitude < -90d || coord.latitude > 90d {
            return error("Validation failed: latitude must be between -90 and 90 degrees");
        }
        if coord.longitude < -180d || coord.longitude > 180d {
            return error("Validation failed: longitude must be between -180 and 180 degrees");
        }
    }
    return event;
}
