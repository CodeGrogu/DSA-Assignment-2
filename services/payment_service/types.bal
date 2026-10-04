import peerpressure/events;

public enum PaymentStatus {
    PENDING = "PENDING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    REFUNDED = "REFUNDED"
}

public enum EntryType {
    DEBIT = "DEBIT",
    CREDIT = "CREDIT"
}

public enum GatewayOutcome {
    SUCCESS = "SUCCESS",
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
    NETWORK_TIMEOUT = "NETWORK_TIMEOUT",
    INVALID_CARD = "INVALID_CARD",
    FRAUD_SUSPECTED = "FRAUD_SUSPECTED"
}

public type PaymentTransaction record {|
    string transactionId;
    string orderId;
    string customerId;
    decimal amount;
    string currency;
    string method;
    PaymentStatus status;
    string? failureReason = ();
    string idempotencyKey;
    string createdAt;
|};

public type LedgerEntry record {|
    string entryId;
    string transactionId;
    string orderId;
    string account;
    EntryType entryType;
    decimal amount;
    string currency;
    string method;
    PaymentStatus status;
    string createdAt;
|};

public type GatewayResult record {|
    PaymentStatus status;
    string? failureReason = ();
|};

public type KitchenRejectedEvent record {|
    string eventId;
    string orderId;
    string reason;
    string rejectedAt;
|};

public type OrderCreatedEvent events:OrderCreatedEvent;
public type OrderCancelledEvent events:OrderCancelledEvent;

public type OrderCreatedMessage record {|
    string eventId;
    string orderId;
    string customerId;
    string restaurantId;
    events:OrderItem[] items;
    decimal totalAmount;
    events:Address deliveryAddress;
    events:OrderStatus status = events:CREATED;
    string createdAt;
    string currency?;
    string simulatorOutcome?;
    string 'type?;
|};

public type OrderCancelledMessage record {|
    string eventId;
    string orderId;
    string reason;
    string cancelledBy;
    string cancelledAt;
    string 'type?;
|};

public type KitchenRejectedMessage record {|
    *KitchenRejectedEvent;
    string 'type?;
|};

public type PaymentCompletedEvent record {|
    string eventId;
    string paymentId;
    string transactionId;
    string orderId;
    string customerId;
    decimal amount;
    string currency;
    string paymentMethod;
    PaymentStatus status;
    string transactionReference;
    string completedAt;
    string timestamp;
|};

public type PaymentFailedEvent record {|
    string eventId;
    string transactionId;
    string orderId;
    string customerId;
    decimal amount;
    string currency;
    string paymentMethod;
    PaymentStatus status;
    string reason;
    string errorCode;
    string failedAt;
    string timestamp;
|};

public type PaymentRefundedEvent record {|
    string eventId;
    string paymentId;
    string transactionId;
    string orderId;
    string customerId;
    decimal amount;
    string currency;
    string paymentMethod;
    PaymentStatus status;
    string refundedAt;
    string timestamp;
|};

public type PaymentApiError record {|
    record {|
        string code;
        string message;
    |} 'error;
|};
