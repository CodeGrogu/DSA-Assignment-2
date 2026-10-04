import ballerina/time;
import ballerina/uuid;
import ballerinax/kafka;

import peerpressure/events;

listener kafka:Listener ordersListener = new (kafkaBootstrapServers(), {
    groupId: "payment-service",
    topics: ["orders.created", "orders.cancelled", "kitchen.rejected"],
    offsetReset: kafka:OFFSET_RESET_EARLIEST,
    autoCommit: false
});

service on ordersListener {
    remote function onConsumerRecord(kafka:Caller caller, kafka:BytesConsumerRecord[] records) returns error? {
        foreach kafka:BytesConsumerRecord consumerRecord in records {
            string eventText = check string:fromBytes(consumerRecord.value);
            json eventData = check eventText.fromJsonString();
            string topic = consumerRecord.offset.partition.topic;
            if topic == "orders.created" {
                events:OrderCreated orderEvent = check events:validateOrderCreated(eventData);
                if orderEvent.totalAmount <= 0d {
                    return error("Payment order amount must be greater than zero");
                }
                check processOrderCreated(orderEvent);
            } else if topic == "orders.cancelled" {
                events:OrderCancelled cancellation = check events:validateOrderCancelled(eventData);
                check refundOrder(cancellation.orderId, cancellation.reason);
            } else if topic == "kitchen.rejected" {
                events:KitchenRejected rejection = check events:validateKitchenRejected(eventData);
                check refundOrder(rejection.orderId, rejection.reason);
            }
        }
        check caller->commit();
    }
}

function refundOrder(string orderId, string reason) returns error? {
    PaymentTransaction?|error transactionResult = findTransactionByOrderId(orderId);
    if transactionResult is error {
        return transactionResult;
    }
    if transactionResult is () || transactionResult.status != events:COMPLETED {
        return;
    }
    PaymentTransaction paymentTransaction = transactionResult;

    RefundRecord?|error existingRefund = findRefundByOrderId(orderId);
    if existingRefund is error {
        return existingRefund;
    }
    RefundRecord refundRecord;
    if existingRefund is RefundRecord {
        refundRecord = existingRefund;
    } else {
        string now = time:utcNow().toString();
        RefundRecord candidate = {
            refundId: uuid:createType1AsString(),
            transactionId: paymentTransaction.transactionId,
            orderId,
            customerId: paymentTransaction.customerId,
            amount: paymentTransaction.amount,
            currency: paymentTransaction.currency,
            transactionReference: paymentTransaction.transactionReference,
            reason,
            refundedAt: now
        };
        error? insertResult = insertRefundRecord(candidate);
        if insertResult is error {
            RefundRecord?|error concurrentRefund = findRefundByOrderId(orderId);
            if concurrentRefund is RefundRecord {
                refundRecord = concurrentRefund;
            } else {
                return insertResult;
            }
        } else {
            refundRecord = candidate;
        }
    }

    string now = time:utcNow().toString();
    LedgerEntry[] reversals = [
        {
            entryId: refundRecord.refundId + "-debit",
            transactionId: paymentTransaction.transactionId,
            orderId,
            account: "restaurant_payable",
            entryType: DEBIT,
            amount: paymentTransaction.amount,
            currency: paymentTransaction.currency,
            createdAt: now,
            reversalOf: paymentTransaction.transactionId
        },
        {
            entryId: refundRecord.refundId + "-credit",
            transactionId: paymentTransaction.transactionId,
            orderId,
            account: "payment_gateway_clearing",
            entryType: CREDIT,
            amount: paymentTransaction.amount,
            currency: paymentTransaction.currency,
            createdAt: now,
            reversalOf: paymentTransaction.transactionId
        }
    ];
    check insertLedgerEntries(reversals);
    check updatePaymentStatus(orderId, events:REFUNDED, now);

    if !refundRecord.eventPublished {
        events:PaymentRefunded refundedEvent = {
            eventId: refundRecord.refundId,
            paymentId: refundRecord.transactionId,
            orderId: refundRecord.orderId,
            customerId: refundRecord.customerId,
            amount: refundRecord.amount,
            currency: refundRecord.currency,
            transactionReference: refundRecord.transactionReference,
            refundReference: refundRecord.refundId,
            reason: refundRecord.reason,
            refundedAt: refundRecord.refundedAt
        };
        check publishPaymentRefunded(refundedEvent);
        check markRefundEventPublished(orderId);
    }
}

function processOrderCreated(events:OrderCreated orderEvent) returns error? {
    IdempotencyRecord?|error existingRecord = findIdempotencyRecord(orderEvent.eventId);
    if existingRecord is error {
        return existingRecord;
    }
    if existingRecord is IdempotencyRecord {
        if existingRecord.orderId != orderEvent.orderId || existingRecord.amount != orderEvent.totalAmount {
            return error("Order event ID was reused with different payment details");
        }
        return finishOrderPayment(existingRecord);
    }

    PaymentTransaction?|error orderPayment = findTransactionByOrderId(orderEvent.orderId);
    if orderPayment is error {
        return orderPayment;
    }
    if orderPayment is PaymentTransaction {
        return;
    }

    string transactionId = uuid:createType1AsString();
    string now = time:utcNow().toString();
    IdempotencyRecord reservation = {
        idempotencyKey: orderEvent.eventId,
        orderId: orderEvent.orderId,
        customerId: orderEvent.customerId,
        amount: orderEvent.totalAmount,
        transactionId,
        status: events:PENDING,
        createdAt: now,
        updatedAt: now
    };
    error? reserveResult = reserveIdempotencyKey(reservation);
    if reserveResult is error {
        IdempotencyRecord?|error concurrentRecord = findIdempotencyRecord(orderEvent.eventId);
        if concurrentRecord is IdempotencyRecord {
            return finishOrderPayment(concurrentRecord);
        }
        return reserveResult;
    }
    check finishOrderPayment(reservation);
}

function finishOrderPayment(IdempotencyRecord reservation) returns error? {
    if reservation.status == events:PENDING {
        _ = check finalizePayment(reservation);
    } else if !reservation.eventPublished {
        check publishPaymentOutcome(reservation);
    }
}
