import peerpressure/events as events;

# Result of evaluating an FSM state transition request.
public type StateTransitionResult record {|
    boolean allowed;
    string? rejectionReason = ();
|};

# Validates whether a state transition from `currentStatus` to `newStatus` is legally allowed.
public isolated function validateTransition(events:OrderStatus currentStatus, events:OrderStatus newStatus) returns StateTransitionResult {
    if currentStatus == newStatus {
        return {
            allowed: false,
            rejectionReason: string `Order is already in state ${currentStatus}`
        };
    }

    match [currentStatus, newStatus] {
        [events:CREATED, events:CONFIRMED] => {
            return {allowed: true};
        }
        [events:CREATED, events:CANCELLED] => {
            return {allowed: true};
        }
        [events:CONFIRMED, events:PREPARING] => {
            return {allowed: true};
        }
        [events:CONFIRMED, events:CANCELLED] => {
            return {allowed: true};
        }
        [events:PREPARING, events:READY] => {
            return {allowed: true};
        }
        [events:READY, events:OUT_FOR_DELIVERY] => {
            return {allowed: true};
        }
        [events:OUT_FOR_DELIVERY, events:DELIVERED] => {
            return {allowed: true};
        }
        _ => {
            return {
                allowed: false,
                rejectionReason: string `Illegal transition from ${currentStatus} to ${newStatus}`
            };
        }
    }
}

# Checks whether an order in state `status` can be cancelled.
# Orders can ONLY be cancelled in CREATED or CONFIRMED state.
# Once kitchen preparation begins (PREPARING), cancellation is strictly prohibited.
public isolated function isCancellable(events:OrderStatus status) returns boolean {
    return status == events:CREATED || status == events:CONFIRMED;
}

# Validates input payload for order creation according to domain rules.
public isolated function validateCreateOrderRequest(CreateOrderRequest req) returns string? {
    if req.customerId.trim().length() == 0 {
        return "Customer ID must not be empty";
    }
    if req.restaurantId.trim().length() == 0 {
        return "Restaurant ID must not be empty";
    }
    if req.items.length() == 0 {
        return "Order must contain at least one item";
    }
    if req.items.length() > 50 {
        return "Order item count exceeds maximum limit of 50";
    }
    foreach CreateOrderItem item in req.items {
        if item.itemId.trim().length() == 0 {
            return "Item ID must not be empty";
        }
        if item.name.trim().length() == 0 {
            return "Item name must not be empty";
        }
        if item.quantity <= 0 {
            return string `Item '${item.name}' quantity must be greater than zero`;
        }
        if item.quantity > 1000 {
            return string `Item '${item.name}' quantity exceeds maximum limit of 1000`;
        }
        if item.price <= 0.0d {
            return string `Item '${item.name}' price must be greater than zero`;
        }
        if item.price > 100000.0d {
            return string `Item '${item.name}' price exceeds reasonable maximum limit`;
        }
    }
    if req.deliveryAddress.street.trim().length() == 0 {
        return "Delivery street address must not be empty";
    }
    if req.deliveryAddress.city.trim().length() == 0 {
        return "Delivery city must not be empty";
    }

    events:GeoCoordinate? coords = req.deliveryAddress.coordinates;
    if coords is events:GeoCoordinate {
        if coords.latitude < -90.0d || coords.latitude > 90.0d {
            return "Delivery latitude must be between -90 and 90 degrees";
        }
        if coords.longitude < -180.0d || coords.longitude > 180.0d {
            return "Delivery longitude must be between -180 and 180 degrees";
        }
    }

    return ();
}
