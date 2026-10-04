import peerpressure/events;

public type Currency "NAD"|"ZAR"|"USD";

public enum PaymentMethod {
    CARD = "CARD",
    CASH = "CASH"
}

public enum LedgerEntryType {
    DEBIT = "DEBIT",
    CREDIT = "CREDIT"
}

public type PaymentTransaction readonly & record {|
    string transactionId;
    string orderId;
    string customerId = "unknown";
    decimal amount;
    Currency currency = "NAD";
    PaymentMethod paymentMethod = CARD;
    events:PaymentStatus status;
    string idempotencyKey;
    string transactionReference;
    string? errorCode = ();
    string? failureReason = ();
    string createdAt;
    string updatedAt;
|};

public type IdempotencyRecord readonly & record {|
    string idempotencyKey;
    string orderId;
    string customerId = "unknown";
    decimal amount;
    Currency currency = "NAD";
    string transactionId;
    PaymentMethod paymentMethod = CARD;
    events:PaymentStatus status;
    string transactionReference = "";
    string? errorCode = ();
    string? failureReason = ();
    boolean eventPublished = false;
    string createdAt;
    string updatedAt;
|};

public type RefundRecord readonly & record {|
    string refundId;
    string transactionId;
    string orderId;
    string customerId;
    decimal amount;
    Currency currency = "NAD";
    string transactionReference;
    string reason;
    events:PaymentStatus status = events:REFUNDED;
    string refundedAt;
    boolean eventPublished = false;
|};

public type LedgerEntry readonly & record {|
    string entryId;
    string transactionId;
    string orderId;
    string account;
    LedgerEntryType entryType;
    decimal amount;
    Currency currency = "NAD";
    string createdAt;
    string? reversalOf = ();
|};
