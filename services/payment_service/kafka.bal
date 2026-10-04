import ballerina/lang.'runtime as runtime;
import ballerina/log;
import ballerina/time;
import ballerinax/kafka;

configurable string kafkaBootstrapServers = "kafka:9092";
configurable string orderTopic = "orders.created";
configurable string sharedOrdersTopic = "orders.events";
configurable string orderCancelledTopic = "orders.cancelled";
configurable string kitchenRejectedTopic = "kitchen.rejected";
configurable string paymentsEventsTopic = "payments.events";
configurable string paymentsCompletedTopic = "payments.completed";
configurable string paymentsFailedTopic = "payments.failed";
configurable string paymentsRefundedTopic = "payments.refunded";
configurable string paymentConsumerGroup = "payment-service";
configurable string refundConsumerGroup = "payment-refund-service";
configurable boolean publishDedicatedPaymentTopics = true;
configurable string simulatorDefaultMode = "SUCCESS";
configurable int gatewayTimeoutSeconds = 2;
configurable string paymentMethod = "CARD";

class PaymentEventPublisher {
    private kafka:Producer? producer = ();

    public function publish(string topic, string orderId, string payload) returns error? {
        lock {
            kafka:Producer? currentProducer = self.producer;
            if currentProducer is kafka:Producer {
                check currentProducer->send({topic, key: orderId.toBytes(), value: payload.toBytes()});
            } else {
                kafka:Producer newProducer = check new (kafkaBootstrapServers, {clientId: "payment-service"});
                self.producer = newProducer;
                check newProducer->send({topic, key: orderId.toBytes(), value: payload.toBytes()});
            }
        }
    }
}

final PaymentEventPublisher paymentEventPublisher = new;

public function main() returns error? {
    _ = start runPaymentConsumers();
}

function runPaymentConsumers() returns error? {
    while true {
        error? result = consumePaymentEvents();
        if result is error {
            log:printError("Payment event consumers stopped; retrying", 'error = result);
            runtime:sleep(2.0d);
        }
    }
}

function consumePaymentEvents() returns error? {
    kafka:Consumer orderConsumer = check new (kafkaBootstrapServers, {
        groupId: paymentConsumerGroup,
        offsetReset: "earliest",
        autoCommit: false
    });
    check orderConsumer->subscribe([orderTopic]);
    kafka:Consumer refundConsumer = check new (kafkaBootstrapServers, {
        groupId: refundConsumerGroup,
        offsetReset: "earliest",
        autoCommit: false
    });
    string[] refundTopics = [orderCancelledTopic, kitchenRejectedTopic];
    check refundConsumer->subscribe(refundTopics);
    log:printInfo("Payment event consumers subscribed", orderTopic = orderTopic, refundTopics = refundTopics);

    while true {
        kafka:AnydataConsumerRecord[] orderRecords = check orderConsumer->poll(0.5);
        foreach kafka:AnydataConsumerRecord kafkaRecord in orderRecords {
            check processOrderRecord(kafkaRecord);
        }
        check orderConsumer->commit();

        kafka:AnydataConsumerRecord[] refundRecords = check refundConsumer->poll(0.5);
        foreach kafka:AnydataConsumerRecord kafkaRecord in refundRecords {
            check processRefundRecord(kafkaRecord);
        }
        check refundConsumer->commit();
    }
}

function processOrderRecord(kafka:AnydataConsumerRecord kafkaRecord) returns error? {
    map<json> payload = check parseRecordPayload(kafkaRecord.value);
    string? eventType = check getString(payload, "type");
    boolean sharedTopic = kafkaRecord.offset.partition.topic == sharedOrdersTopic;
    if (sharedTopic && eventType == "OrderCreatedEvent") || !sharedTopic {
        OrderCreatedMessage orderEvent = check payload.cloneWithType(OrderCreatedMessage);
        check processOrder(orderEvent);
    }
}

function processRefundRecord(kafka:AnydataConsumerRecord kafkaRecord) returns error? {
    map<json> payload = check parseRecordPayload(kafkaRecord.value);
    string? eventType = check getString(payload, "type");
    string? cancelledAt = check getString(payload, "cancelledAt");
    string? rejectedAt = check getString(payload, "rejectedAt");
    if kafkaRecord.offset.partition.topic == orderCancelledTopic &&
        (eventType == "OrderCancelledEvent" || cancelledAt is string) {
        OrderCancelledMessage cancelled = check payload.cloneWithType(OrderCancelledMessage);
        check refundOrder(cancelled.orderId, cancelled.reason);
    } else if kafkaRecord.offset.partition.topic == kitchenRejectedTopic &&
        (eventType == "KitchenRejectedEvent" || rejectedAt is string) {
        KitchenRejectedMessage rejected = check payload.cloneWithType(KitchenRejectedMessage);
        check refundOrder(rejected.orderId, rejected.reason);
    }
}

function parseRecordPayload(anydata recordValue) returns map<json>|error {
    if recordValue is byte[] {
        string raw = check string:fromBytes(recordValue);
        json parsed = check raw.fromJsonString();
        return check parsed.cloneWithType();
    }
    return error("Expected a byte-array Kafka event");
}

function processOrder(OrderCreatedMessage orderEvent) returns error? {
    string idempotencyKey = createIdempotencyKey(orderEvent.orderId, "charge");
    PaymentTransaction? previous = check findByIdempotencyKey(idempotencyKey);
    if isDuplicate(previous) {
        log:printInfo("Ignoring duplicate charge event", orderId = orderEvent.orderId);
        return;
    }
    PaymentTransaction? existingCharge = check findTransactionById(orderEvent.orderId + "-charge");
    if isDuplicate(existingCharge) {
        log:printInfo("Ignoring already-persisted charge event", orderId = orderEvent.orderId);
        return;
    }
    string currency = orderEvent.currency ?: "NAD";
    if orderEvent.totalAmount <= 0.0d {
        return persistFailedOrder(orderEvent, idempotencyKey, currency, "Amount must be greater than zero", "INVALID_AMOUNT");
    }
    if !isSupportedCurrency(currency) {
        return persistFailedOrder(orderEvent, idempotencyKey, currency, "Unsupported currency: " + currency, "INVALID_CURRENCY");
    }
    string outcome = orderEvent.simulatorOutcome ?: simulatorDefaultMode;

    GatewayResult|error gatewayResult = paymentGatewaySimulator.authorize(outcome, gatewayTimeoutSeconds);
    if gatewayResult is error {
        string reason = outcome == "NETWORK_TIMEOUT" ? "Payment gateway timed out" : gatewayResult.message();
        return persistFailedOrder(orderEvent, idempotencyKey, currency, reason, outcome);
    }
    if gatewayResult.status == FAILED {
        string reason = gatewayResult.failureReason ?: "Payment authorization failed";
        return persistFailedOrder(orderEvent, idempotencyKey, currency, reason, outcome);
    }

    PaymentTransaction payment = {
        transactionId: orderEvent.orderId + "-charge",
        orderId: orderEvent.orderId,
        customerId: orderEvent.customerId,
        amount: orderEvent.totalAmount,
        currency,
        method: paymentMethod,
        status: COMPLETED,
        idempotencyKey,
        createdAt: currentTimestamp()
    };
    check persistCharge(payment);
    check publishCompleted(payment);
}

function persistFailedOrder(OrderCreatedMessage orderEvent, string key, string currency, string reason, string code) returns error? {
    PaymentTransaction payment = {
        transactionId: orderEvent.orderId + "-charge",
        orderId: orderEvent.orderId,
        customerId: orderEvent.customerId,
        amount: orderEvent.totalAmount,
        currency,
        method: paymentMethod,
        status: FAILED,
        failureReason: reason,
        idempotencyKey: key,
        createdAt: currentTimestamp()
    };
    check persistCharge(payment);
    PaymentFailedEvent event = {
        eventId: payment.transactionId + "-failed",
        transactionId: payment.transactionId,
        orderId: payment.orderId,
        customerId: payment.customerId,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.method,
        status: FAILED,
        reason,
        errorCode: code,
        failedAt: payment.createdAt,
        timestamp: payment.createdAt
    };
    check publishEvent(paymentsEventsTopic, event.orderId, event);
    if publishDedicatedPaymentTopics {
        check publishEvent(paymentsFailedTopic, event.orderId, event);
    }
}

function publishCompleted(PaymentTransaction payment) returns error? {
    PaymentCompletedEvent event = {
        eventId: payment.transactionId + "-completed",
        paymentId: payment.transactionId,
        transactionId: payment.transactionId,
        orderId: payment.orderId,
        customerId: payment.customerId,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.method,
        status: COMPLETED,
        transactionReference: payment.transactionId,
        completedAt: payment.createdAt,
        timestamp: payment.createdAt
    };
    check publishEvent(paymentsEventsTopic, event.orderId, event);
    if publishDedicatedPaymentTopics {
        check publishEvent(paymentsCompletedTopic, event.orderId, event);
    }
}

function refundOrder(string orderId, string reason) returns error? {
    PaymentTransaction? original = check findCapturedTransactionByOrder(orderId);
    if original !is PaymentTransaction || original.status != COMPLETED {
        log:printInfo("No captured payment to refund", orderId = orderId);
        return;
    }
    PaymentTransaction? existingRefund = check findTransactionById(orderId + "-refund");
    if isDuplicate(existingRefund) {
        log:printInfo("Ignoring already-persisted refund event", orderId = orderId);
        return;
    }
    string refundKey = createIdempotencyKey(orderId, "refund");
    PaymentTransaction? previousRefund = check findByIdempotencyKey(refundKey);
    if isDuplicate(previousRefund) {
        log:printInfo("Ignoring duplicate refund event", orderId = orderId);
        return;
    }
    PaymentTransaction refund = {
        transactionId: orderId + "-refund",
        orderId,
        customerId: original.customerId,
        amount: original.amount,
        currency: original.currency,
        method: original.method,
        status: REFUNDED,
        idempotencyKey: refundKey,
        createdAt: currentTimestamp()
    };
    check persistRefund(refund);
    PaymentRefundedEvent event = {
        eventId: refund.transactionId + "-refunded",
        paymentId: refund.transactionId,
        transactionId: refund.transactionId,
        orderId,
        customerId: refund.customerId,
        amount: refund.amount,
        currency: refund.currency,
        paymentMethod: refund.method,
        status: REFUNDED,
        refundedAt: refund.createdAt,
        timestamp: refund.createdAt
    };
    check publishEvent(paymentsRefundedTopic, orderId, event);
    log:printInfo("Payment refunded", orderId = orderId, reason = reason);
}

function publishEvent(string topic, string orderId, json event) returns error? {
    string payload = event.toJsonString();
    check paymentEventPublisher.publish(topic, orderId, payload);
}

function currentTimestamp() returns string {
    return time:utcToString(time:utcNow());
}

function getString(map<json> payload, string key) returns string?|error {
    if payload.hasKey(key) {
        json value = payload[key];
        if value is string {
            return value;
        }
    }
    return ();
}
