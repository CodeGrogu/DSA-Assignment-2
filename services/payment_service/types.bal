import peerpressure/events;

public type PaymentStatus events:PaymentStatus;

public const events:PaymentStatus PENDING = events:PENDING;
public const events:PaymentStatus COMPLETED = events:COMPLETED;
public const events:PaymentStatus FAILED = events:FAILED;
public const events:PaymentStatus REFUNDED = events:REFUNDED;

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
    string? paymentId = ();
    string transactionId;
    string orderId;
    string customerId;
    decimal amount;
    string currency;
    string method;
    string? paymentMethod = ();
    PaymentStatus status;
    string? failureReason = ();
    string idempotencyKey;
    string createdAt;
    string? completedAt = ();
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

public type KitchenRejectedEvent events:KitchenRejectedEvent;

public type OrderCreatedEvent events:OrderCreatedEvent;

public type OrderCancelledEvent events:OrderCancelledEvent;

public type PaymentCompletedEvent events:PaymentCompletedEvent;

public type PaymentFailedEvent events:PaymentFailedEvent;

public type PaymentRefundedEvent events:PaymentRefundedEvent;

public type OrderCreatedMessage record {|
    string eventId;
    string orderId;
    string customerId;
    string restaurantId;
    events:OrderItem[] items;
    decimal totalAmount;
    decimal deliveryFee = 0d;
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
    string customerId = "";
    string reason;
    string cancelledBy;
    string cancelledAt;
    string 'type?;
|};

public type KitchenRejectedMessage record {|
    string eventId;
    string orderId;
    string customerId = "";
    string restaurantId = "";
    string reason;
    string rejectedAt;
    string 'type?;
|};

public type PaymentApiError record {|
    record {|
        string code;
        string message;
    |} 'error;
|};
