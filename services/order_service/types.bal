import ballerina/time;
import peerpressure/events as events;

# Input item representation for incoming order creation requests.
public type CreateOrderItem record {|
    string itemId;
    string name;
    int quantity;
    decimal price;
    string[] specialInstructions = [];
|};

# Request payload for creating a customer order.
public type CreateOrderRequest record {|
    string customerId;
    string restaurantId;
    CreateOrderItem[] items;
    events:Address deliveryAddress;
|};

# Canonical Order record persisted in database and shared across the domain.
public type Order record {|
    string orderId;
    string customerId;
    string restaurantId;
    events:OrderStatus status;
    CreateOrderItem[] items;
    decimal itemsTotal;
    decimal deliveryFee;
    decimal surgeMultiplier;
    decimal totalAmount;
    events:Address deliveryAddress;
    string? paymentId = ();
    string? cancellationReason = ();
    string createdAt;
    string updatedAt;
|};

# Request payload for an order cancellation request.
public type CancelOrderRequest record {|
    string reason = "Customer requested cancellation";
|};

# Response payload for an order cancellation request.
public type CancelOrderResponse record {|
    string orderId;
    events:OrderStatus status;
    string message;
    string cancelledAt;
|};

# Standard error response returned across Order Service HTTP endpoints.
public type ErrorResponse record {|
    string 'error;
    string message;
    string timestamp;
|};

# Generates current RFC 3339 timestamp.
public isolated function currentTimestamp() returns string {
    return time:utcToString(time:utcNow());
}
