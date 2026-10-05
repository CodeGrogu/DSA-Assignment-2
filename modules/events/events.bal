public type OrderCreated readonly & record {|
    string eventId;
    string orderId;
    string customerId;
    string restaurantId;
    OrderItem[] items;
    decimal totalAmount;
    decimal deliveryFee = 0d;
    Address deliveryAddress;
    OrderStatus status = CREATED;
    string createdAt;
|};

public type OrderCreatedEvent OrderCreated;

public type OrderConfirmed readonly & record {|
    string eventId;
    string orderId;
    string customerId = "";
    string restaurantId = "";
    OrderItem[] items = [];
    string paymentId;
    int estimatedDeliveryMinutes;
    string confirmedAt;
|};

public type OrderConfirmedEvent OrderConfirmed;

public type OrderPreparing readonly & record {|
    string eventId;
    string orderId;
    string customerId = "";
    string restaurantId;
    string preparingStartedAt;
|};

public type OrderPreparingEvent OrderPreparing;

public type OrderCancelled readonly & record {|
    string eventId;
    string orderId;
    string customerId = "";
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

public type PaymentRefunded readonly & record {|
    string eventId;
    string paymentId;
    string orderId;
    string customerId;
    decimal amount;
    string currency;
    string paymentMethod;
    string refundedAt;
|};

public type PaymentRefundedEvent PaymentRefunded;

public type KitchenPreparing readonly & record {|
    string eventId;
    string orderId;
    string restaurantId;
    int estimatedPrepMinutes;
    string startedAt;
|};

public type KitchenPreparingEvent KitchenPreparing;

// Covers both preparation and readiness without changing the existing ready-only event.
public type KitchenStatusEvent readonly & record {|
    string eventId;
    string orderId;
    string restaurantId;
    OrderStatus status;
    string updatedAt;
|};

public type KitchenOrderReady readonly & record {|
    string eventId;
    string orderId;
    string customerId = "";
    string driverId = "";
    string restaurantId;
    string pickupAddress;
    string pickupReadyAt;
|};

public type KitchenReadyEvent KitchenOrderReady;

public type KitchenOrderReadyEvent KitchenOrderReady;

public type KitchenRejected readonly & record {|
    string eventId;
    string orderId;
    string customerId = "";
    string restaurantId = "";
    string reason;
    string rejectedAt;
|};

public type KitchenRejectedEvent KitchenRejected;

public type DeliveryAssigned readonly & record {|
    string eventId;
    string deliveryId;
    string orderId;
    string customerId = "";
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
    string customerId = "";
    string driverId;
    DeliveryStatus status;
    GeoCoordinate? currentLocation = ();
    string updatedAt;
|};

public type DeliveryStatusUpdateEvent DeliveryStatusUpdated;

public type DeliveryStatusUpdatedEvent DeliveryStatusUpdated;

public type DeliveryStatusEvent DeliveryStatusUpdated;

public type NotificationEvent readonly & record {|
    string eventId;
    string recipientId;
    string channel;
    string subject;
    string message;
    string? orderId = ();
    string timestamp;
|};
