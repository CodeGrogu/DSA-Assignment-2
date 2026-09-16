public type OrderCreatedEvent record {|
    string eventId;
    string orderId;
    string customerId;
    string restaurantId;
    OrderItem[] items;
    decimal totalAmount;
    Address deliveryAddress;
    OrderStatus status = CREATED;
    string createdAt;
|};

public type OrderConfirmedEvent record {|
    string eventId;
    string orderId;
    string paymentId;
    int estimatedDeliveryMinutes;
    string confirmedAt;
|};

public type OrderCancelledEvent record {|
    string eventId;
    string orderId;
    string reason;
    string cancelledBy;
    string cancelledAt;
|};

public type PaymentCompletedEvent record {|
    string eventId;
    string paymentId;
    string orderId;
    string customerId;
    decimal amount;
    string currency;
    string paymentMethod;
    string transactionReference;
    string completedAt;
|};

public type PaymentFailedEvent record {|
    string eventId;
    string orderId;
    string customerId;
    decimal amount;
    string reason;
    string errorCode;
    string failedAt;
|};

public type KitchenPreparingEvent record {|
    string eventId;
    string orderId;
    string restaurantId;
    int estimatedPrepMinutes;
    string startedAt;
|};

public type KitchenReadyEvent record {|
    string eventId;
    string orderId;
    string restaurantId;
    string pickupReadyAt;
|};

public type DeliveryAssignedEvent record {|
    string eventId;
    string deliveryId;
    string orderId;
    string driverId;
    string driverName;
    string driverPhone;
    string assignedAt;
|};

public type DeliveryStatusUpdateEvent record {|
    string eventId;
    string deliveryId;
    string orderId;
    string driverId;
    DeliveryStatus status;
    GeoCoordinate? currentLocation = ();
    string updatedAt;
|};

public type NotificationEvent record {|
    string eventId;
    string recipientId;
    string channel;
    string subject;
    string message;
    string? orderId = ();
    string timestamp;
|};
