public type OrderCreated readonly & record {|
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

public type OrderCreatedEvent OrderCreated;

public type OrderConfirmed readonly & record {|
    string eventId;
    string orderId;
    string paymentId;
    int estimatedDeliveryMinutes;
    string confirmedAt;
|};

public type OrderConfirmedEvent OrderConfirmed;

public type OrderCancelled readonly & record {|
    string eventId;
    string orderId;
    string reason;
    string cancelledBy;
    string cancelledAt;
|};

public type OrderCancelledEvent OrderCancelled;

public type PaymentCompleted readonly & record {|
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

public type PaymentCompletedEvent PaymentCompleted;

public type PaymentFailed readonly & record {|
    string eventId;
    string orderId;
    string customerId;
    decimal amount;
    string reason;
    string errorCode;
    string failedAt;
|};

public type PaymentFailedEvent PaymentFailed;

public type KitchenPreparing readonly & record {|
    string eventId;
    string orderId;
    string restaurantId;
    int estimatedPrepMinutes;
    string startedAt;
|};

public type KitchenPreparingEvent KitchenPreparing;

public type KitchenOrderReady readonly & record {|
    string eventId;
    string orderId;
    string restaurantId;
    string pickupReadyAt;
|};

public type KitchenReadyEvent KitchenOrderReady;

public type KitchenOrderReadyEvent KitchenOrderReady;

public type DeliveryAssigned readonly & record {|
    string eventId;
    string deliveryId;
    string orderId;
    string driverId;
    string driverName;
    string driverPhone;
    string assignedAt;
|};

public type DeliveryAssignedEvent DeliveryAssigned;

public type DeliveryStatusUpdated readonly & record {|
    string eventId;
    string deliveryId;
    string orderId;
    string driverId;
    DeliveryStatus status;
    GeoCoordinate? currentLocation = ();
    string updatedAt;
|};

public type DeliveryStatusUpdateEvent DeliveryStatusUpdated;

public type DeliveryStatusUpdatedEvent DeliveryStatusUpdated;

public type NotificationEvent readonly & record {|
    string eventId;
    string recipientId;
    string channel;
    string subject;
    string message;
    string? orderId = ();
    string timestamp;
|};

