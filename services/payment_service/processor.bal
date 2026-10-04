import ballerina/time;

import peerpressure/events;

function finalizePayment(IdempotencyRecord reservation) returns IdempotencyRecord|error {
    PaymentTransaction?|error storedTransaction = findTransactionById(reservation.transactionId);
    if storedTransaction is error {
        return storedTransaction;
    }

    events:PaymentStatus status = events:PENDING;
    string transactionReference = "";
    string? errorCode = ();
    string? failureReason = ();
    PaymentMethod paymentMethod = reservation.paymentMethod;
    string now = time:utcNow().toString();

    if storedTransaction is PaymentTransaction {
        status = storedTransaction.status;
        transactionReference = storedTransaction.transactionReference;
        errorCode = storedTransaction.errorCode;
        failureReason = storedTransaction.failureReason;
        paymentMethod = storedTransaction.paymentMethod;
    } else {
        GatewayResult gatewayResult = simulateAuthorization(reservation.amount, gatewayMode);
        status = events:FAILED;
        if gatewayResult.authorized {
            status = events:COMPLETED;
        }
        transactionReference = gatewayResult.transactionReference;
        errorCode = gatewayResult.errorCode;
        failureReason = gatewayResult.failureReason;

        PaymentTransaction paymentTransaction = {
            transactionId: reservation.transactionId,
            orderId: reservation.orderId,
            customerId: reservation.customerId,
            amount: reservation.amount,
            currency: reservation.currency,
            paymentMethod,
            status,
            idempotencyKey: reservation.idempotencyKey,
            transactionReference,
            errorCode,
            failureReason,
            createdAt: reservation.createdAt,
            updatedAt: now
        };
        check insertPaymentTransaction(paymentTransaction);
    }

    if status == events:COMPLETED {
        LedgerEntry[] entries = [
            {
                entryId: reservation.transactionId + "-debit",
                transactionId: reservation.transactionId,
                orderId: reservation.orderId,
                account: "payment_gateway_clearing",
                entryType: DEBIT,
                amount: reservation.amount,
                currency: reservation.currency,
                createdAt: now
            },
            {
                entryId: reservation.transactionId + "-credit",
                transactionId: reservation.transactionId,
                orderId: reservation.orderId,
                account: "restaurant_payable",
                entryType: CREDIT,
                amount: reservation.amount,
                currency: reservation.currency,
                createdAt: now
            }
        ];
        check insertLedgerEntries(entries);
    }

    IdempotencyRecord completedRecord = {
        idempotencyKey: reservation.idempotencyKey,
        orderId: reservation.orderId,
        customerId: reservation.customerId,
        amount: reservation.amount,
        currency: reservation.currency,
        transactionId: reservation.transactionId,
        paymentMethod,
        status,
        transactionReference,
        errorCode,
        failureReason,
        createdAt: reservation.createdAt,
        updatedAt: now
    };
    check completeIdempotencyKey(completedRecord);
    check publishPaymentOutcome(completedRecord);
    return completedRecord;
}
