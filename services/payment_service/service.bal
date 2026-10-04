import ballerina/http;
import ballerina/time;
import ballerina/uuid;

import peerpressure/events;

configurable GatewayMode gatewayMode = SUCCESS;
configurable int port = 9094;

service / on new http:Listener(port) {

    resource function get health() returns json {
        return {
            status: "UP",
            "service": "payment_service",
            port: port,
            version: "0.1.0",
            contracts: "peerpressure/events:0.1.0"
        };
    }

    resource function get payments/[string paymentId]() returns json|http:NotFound|http:InternalServerError {
        PaymentTransaction?|error transactionResult = findTransactionById(paymentId);
        if transactionResult is error {
            return paymentPersistenceError();
        }
        if transactionResult is () {
            return <http:NotFound>{
                body: {
                    "error": "PAYMENT_NOT_FOUND",
                    message: "No payment transaction exists for the supplied ID"
                }
            };
        }
        return transactionResponse(transactionResult);
    }

    resource function get payments/'order/[string orderId]() returns json|http:NotFound|http:InternalServerError {
        PaymentTransaction?|error transactionResult = findTransactionByOrderId(orderId);
        if transactionResult is error {
            return paymentPersistenceError();
        }
        if transactionResult is () {
            return <http:NotFound>{
                body: {
                    "error": "PAYMENT_NOT_FOUND",
                    message: "No payment transaction exists for the supplied order ID"
                }
            };
        }
        return transactionResponse(transactionResult);
    }

    resource function post payments/[string orderId](
            @http:Header {name: "Idempotency-Key"} string idempotencyKey,
            @http:Payload json payload
    ) returns json|http:BadRequest|http:Conflict|http:InternalServerError {
        if idempotencyKey == "" {
            return <http:BadRequest>{
                body: {
                    "error": "MISSING_IDEMPOTENCY_KEY",
                    message: "Idempotency-Key header is required"
                }
            };
        }

        decimal|http:BadRequest amountResult = decimalFromJson(payload);
        if amountResult is http:BadRequest {
            return amountResult;
        }
        decimal amount = amountResult;
        if amount <= 0d {
            return <http:BadRequest>{
                body: {
                    "error": "INVALID_AMOUNT",
                    message: "Payment amount must be greater than zero"
                }
            };
        }

        Currency|error currencyResult = currencyFromJson(payload);
        if currencyResult is error {
            return <http:BadRequest>{
                body: {
                    "error": "INVALID_CURRENCY",
                    message: "Currency must be NAD, ZAR, or USD"
                }
            };
        }
        Currency currency = currencyResult;

        IdempotencyRecord?|error existingResult = findIdempotencyRecord(idempotencyKey);
        if existingResult is error {
            return paymentPersistenceError();
        }
        if existingResult is IdempotencyRecord {
            if existingResult.orderId != orderId || existingResult.amount != amount ||
                existingResult.currency != currency {
                return idempotencyConflict();
            }
            if existingResult.status == events:PENDING {
                IdempotencyRecord|error resumedResult = finalizePayment(existingResult);
                if resumedResult is error {
                    return paymentPersistenceError();
                }
                return idempotencyResponse(resumedResult);
            }
            if !existingResult.eventPublished {
                error? retryPublishResult = publishPaymentOutcome(existingResult);
                if retryPublishResult is error {
                    return paymentPersistenceError();
                }
            }
            return idempotencyResponse(existingResult);
        }

        PaymentTransaction?|error orderPaymentResult = findTransactionByOrderId(orderId);
        if orderPaymentResult is error {
            return paymentPersistenceError();
        }
        if orderPaymentResult is PaymentTransaction {
            if orderPaymentResult.idempotencyKey == idempotencyKey {
                return transactionResponse(orderPaymentResult);
            }
            return <http:Conflict>{
                body: {
                    "error": "PAYMENT_ALREADY_EXISTS",
                    message: "A payment transaction already exists for this order"
                }
            };
        }

        string now = time:utcNow().toString();
        IdempotencyRecord reservation = {
            idempotencyKey,
            orderId,
            customerId: customerIdFromJson(payload),
            amount,
            currency,
            transactionId: uuid:createType1AsString(),
            status: events:PENDING,
            createdAt: now,
            updatedAt: now
        };
        error? reservationResult = reserveIdempotencyKey(reservation);
        if reservationResult is error {
            IdempotencyRecord?|error concurrentResult = findIdempotencyRecord(idempotencyKey);
            if concurrentResult is IdempotencyRecord {
                if concurrentResult.orderId != orderId || concurrentResult.amount != amount ||
                    concurrentResult.currency != currency {
                    return idempotencyConflict();
                }
                if concurrentResult.status == events:PENDING {
                    IdempotencyRecord|error resumedResult = finalizePayment(concurrentResult);
                    if resumedResult is error {
                        return paymentPersistenceError();
                    }
                    return idempotencyResponse(resumedResult);
                }
                return idempotencyResponse(concurrentResult);
            }
            return paymentPersistenceError();
        }

        IdempotencyRecord|error finalResult = finalizePayment(reservation);
        if finalResult is error {
            return paymentPersistenceError();
        }
        return idempotencyResponse(finalResult);
    }
}

function idempotencyResponse(IdempotencyRecord idempotencyRecord) returns json {
    return {
        transactionId: idempotencyRecord.transactionId,
        orderId: idempotencyRecord.orderId,
        amount: idempotencyRecord.amount,
        currency: idempotencyRecord.currency,
        status: idempotencyRecord.status,
        transactionReference: idempotencyRecord.transactionReference,
        idempotencyKey: idempotencyRecord.idempotencyKey,
        errorCode: idempotencyRecord.errorCode,
        failureReason: idempotencyRecord.failureReason
    };
}

function transactionResponse(PaymentTransaction paymentTransaction) returns json {
    return {
        transactionId: paymentTransaction.transactionId,
        orderId: paymentTransaction.orderId,
        amount: paymentTransaction.amount,
        currency: paymentTransaction.currency,
        status: paymentTransaction.status,
        transactionReference: paymentTransaction.transactionReference,
        idempotencyKey: paymentTransaction.idempotencyKey
    };
}

function publishPaymentOutcome(IdempotencyRecord idempotencyRecord) returns error? {
    if idempotencyRecord.status == events:COMPLETED {
        events:PaymentCompleted completedEvent = {
            eventId: idempotencyRecord.transactionId,
            paymentId: idempotencyRecord.transactionId,
            orderId: idempotencyRecord.orderId,
            customerId: idempotencyRecord.customerId,
            amount: idempotencyRecord.amount,
            currency: idempotencyRecord.currency,
            paymentMethod: idempotencyRecord.paymentMethod.toString(),
            transactionReference: idempotencyRecord.transactionReference,
            completedAt: idempotencyRecord.updatedAt
        };
        check publishPaymentCompleted(completedEvent);
    } else if idempotencyRecord.status == events:FAILED {
        string reason = "Payment authorization failed";
        if idempotencyRecord.failureReason is string {
            reason = <string>idempotencyRecord.failureReason;
        }
        string errorCode = "PAYMENT_FAILED";
        if idempotencyRecord.errorCode is string {
            errorCode = <string>idempotencyRecord.errorCode;
        }
        events:PaymentFailed failedEvent = {
            eventId: idempotencyRecord.transactionId,
            orderId: idempotencyRecord.orderId,
            customerId: idempotencyRecord.customerId,
            amount: idempotencyRecord.amount,
            reason,
            errorCode,
            failedAt: idempotencyRecord.updatedAt
        };
        check publishPaymentFailed(failedEvent);
    } else {
        return;
    }
    check markPaymentEventPublished(idempotencyRecord.idempotencyKey);
}

function customerIdFromJson(json payload) returns string {
    json|error customerIdValue = payload.customerId;
    if customerIdValue is string && customerIdValue.trim().length() > 0 {
        return customerIdValue;
    }
    return "unknown";
}

function idempotencyConflict() returns http:Conflict {
    return <http:Conflict>{
        body: {
            "error": "IDEMPOTENCY_KEY_REUSED",
            message: "Idempotency-Key was already used with different payment details"
        }
    };
}

function paymentPersistenceError() returns http:InternalServerError {
    return <http:InternalServerError>{
        body: {
            "error": "PAYMENT_PERSISTENCE_ERROR",
            message: "The payment could not be safely persisted"
        }
    };
}

function decimalFromJson(json payload) returns decimal|http:BadRequest {
    json|error amountValue = payload.amount;

    if amountValue is error {
        return <http:BadRequest>{
            body: {
                "error": "INVALID_PAYLOAD",
                message: "amount is required"
            }
        };
    }

    if amountValue is decimal {
        return amountValue;
    }

    if amountValue is int {
        return <decimal>amountValue;
    }

    return <http:BadRequest>{
        body: {
            "error": "INVALID_AMOUNT",
            message: "amount must be numeric"
        }
    };
}

function currencyFromJson(json payload) returns Currency|error {
    json|error currencyValue = payload.currency;
    if currencyValue is error {
        return "NAD";
    }
    if currencyValue is string {
        if currencyValue == "NAD" || currencyValue == "ZAR" || currencyValue == "USD" {
            return <Currency>currencyValue;
        }
    }
    return error("Unsupported payment currency");
}
