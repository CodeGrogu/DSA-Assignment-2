// JSON serialization and schema validation functions for shared event records

public isolated function orderCreatedToJson(OrderCreated event) returns json {
    return event.toJson();
}

public isolated function paymentCompletedToJson(PaymentCompleted event) returns json {
    return event.toJson();
}

public isolated function paymentFailedToJson(PaymentFailedEvent event) returns json {
    return event.toJson();
}

public isolated function kitchenStatusToJson(KitchenStatusEvent event) returns json {
    return event.toJson();
}

public isolated function kitchenOrderReadyToJson(KitchenOrderReady event) returns json {
    return event.toJson();
}

public isolated function deliveryAssignedToJson(DeliveryAssignedEvent event) returns json {
    return event.toJson();
}

public isolated function deliveryStatusUpdatedToJson(DeliveryStatusUpdated event) returns json {
    return event.toJson();
}

public isolated function deliveryStatusToJson(DeliveryStatusEvent event) returns json {
    return deliveryStatusUpdatedToJson(event);
}

public isolated function notificationEventToJson(NotificationEvent event) returns json {
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
    if event.status != CREATED {
        return error("Validation failed: order creation status must be CREATED");
    }
    if event.totalAmount < 0d {
        return error("Validation failed: totalAmount cannot be negative");
    }
    if event.items.length() == 0 {
        return error("Validation failed: items must contain at least one order item");
    }
    decimal calculatedTotal = 0d;
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
        if item.subtotal != item.unitPrice * <decimal>item.quantity {
            return error("Validation failed: item subtotal must equal quantity times unitPrice");
        }
        calculatedTotal += item.subtotal;
    }
    if event.totalAmount != calculatedTotal {
        return error("Validation failed: totalAmount must equal the sum of item subtotals");
    }
    GeoCoordinate? destination = event.deliveryAddress.coordinates;
    if destination is GeoCoordinate {
        if destination.latitude < -90d || destination.latitude > 90d {
            return error("Validation failed: latitude must be between -90 and 90 degrees");
        }
        if destination.longitude < -180d || destination.longitude > 180d {
            return error("Validation failed: longitude must be between -180 and 180 degrees");
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

public isolated function validatePaymentFailed(json data) returns PaymentFailedEvent|error {
    PaymentFailedEvent event = check data.cloneWithType(PaymentFailedEvent);
    if event.eventId.trim().length() == 0 || event.orderId.trim().length() == 0 ||
            event.customerId.trim().length() == 0 {
        return error("Validation failed: payment failure IDs must not be empty");
    }
    if event.amount < 0d {
        return error("Validation failed: payment failure amount cannot be negative");
    }
    if event.reason.trim().length() == 0 || event.errorCode.trim().length() == 0 ||
            event.failedAt.trim().length() == 0 {
        return error("Validation failed: payment failure details must not be empty");
    }
    return event;
}

public isolated function validateKitchenStatus(json data) returns KitchenStatusEvent|error {
    KitchenStatusEvent event = check data.cloneWithType(KitchenStatusEvent);
    if event.eventId.trim().length() == 0 || event.orderId.trim().length() == 0 ||
            event.restaurantId.trim().length() == 0 || event.updatedAt.trim().length() == 0 {
        return error("Validation failed: kitchen status IDs and updatedAt must not be empty");
    }
    if event.status != PREPARING && event.status != READY {
        return error("Validation failed: kitchen status must be PREPARING or READY");
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

public isolated function validateDeliveryAssigned(json data) returns DeliveryAssignedEvent|error {
    DeliveryAssignedEvent event = check data.cloneWithType(DeliveryAssignedEvent);
    if event.eventId.trim().length() == 0 || event.deliveryId.trim().length() == 0 ||
            event.orderId.trim().length() == 0 || event.driverId.trim().length() == 0 {
        return error("Validation failed: delivery assignment IDs must not be empty");
    }
    if event.driverName.trim().length() == 0 || event.driverPhone.trim().length() == 0 ||
            event.assignedAt.trim().length() == 0 {
        return error("Validation failed: delivery assignment details must not be empty");
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

public isolated function validateDeliveryStatus(json data) returns DeliveryStatusEvent|error {
    return validateDeliveryStatusUpdated(data);
}

public isolated function validateNotificationEvent(json data) returns NotificationEvent|error {
    NotificationEvent event = check data.cloneWithType(NotificationEvent);
    if event.eventId.trim().length() == 0 || event.recipientId.trim().length() == 0 ||
            event.channel.trim().length() == 0 || event.subject.trim().length() == 0 ||
            event.message.trim().length() == 0 || event.timestamp.trim().length() == 0 {
        return error("Validation failed: notification fields must not be empty");
    }
    string? orderId = event.orderId;
    if orderId is string && orderId.trim().length() == 0 {
        return error("Validation failed: orderId must not be blank when provided");
    }
    return event;
}
