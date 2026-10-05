import ballerina/lang.'runtime as runtime;

public type PaymentGatewaySimulator object {
    public function authorize(string outcome, int timeoutSeconds) returns GatewayResult|error;
};

public final PaymentGatewaySimulator paymentGatewaySimulator = object {
    public function authorize(string outcome, int timeoutSeconds) returns GatewayResult|error {
        match outcome {
            "SUCCESS" => {
                return {status: COMPLETED};
            }
            "INSUFFICIENT_FUNDS" => {
                return {status: FAILED, failureReason: "Insufficient funds"};
            }
            "NETWORK_TIMEOUT" => {
                runtime:sleep(timeoutSeconds * 1.0d);
                return error("Payment gateway timed out");
            }
            "INVALID_CARD" => {
                return {status: FAILED, failureReason: "Card is invalid"};
            }
            "FRAUD_SUSPECTED" => {
                return {status: FAILED, failureReason: "Fraud verification failed"};
            }
            _ => {
                return error("Unsupported payment gateway outcome: " + outcome);
            }
        }
    }
};

public isolated function makeLedgerEntries(PaymentTransaction payment, boolean refund) returns LedgerEntry[] {
    string timestamp = payment.createdAt;
    EntryType customerEntry = refund ? CREDIT : DEBIT;
    EntryType platformEntry = refund ? DEBIT : CREDIT;
    PaymentStatus entryStatus = refund ? REFUNDED : COMPLETED;

    return [
        {
            entryId: payment.transactionId + (refund ? "-refund-customer" : "-customer"),
            transactionId: payment.transactionId,
            orderId: payment.orderId,
            account: "customer:" + payment.customerId,
            entryType: customerEntry,
            amount: payment.amount,
            currency: payment.currency,
            method: payment.method,
            status: entryStatus,
            createdAt: timestamp
        },
        {
            entryId: payment.transactionId + (refund ? "-refund-platform" : "-platform"),
            transactionId: payment.transactionId,
            orderId: payment.orderId,
            account: "platform",
            entryType: platformEntry,
            amount: payment.amount,
            currency: payment.currency,
            method: payment.method,
            status: entryStatus,
            createdAt: timestamp
        }
    ];
}

public function isSupportedCurrency(string currency) returns boolean {
    return currency == "NAD" || currency == "USD" || currency == "ZAR" || currency == "MWK";
}

public function createIdempotencyKey(string orderId, string operation) returns string {
    return operation + ":" + orderId;
}

public function isDuplicate(PaymentTransaction? existing) returns boolean {
    return existing is PaymentTransaction;
}
