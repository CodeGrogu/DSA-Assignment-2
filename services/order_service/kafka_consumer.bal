import ballerina/lang.'runtime as runtime;
import ballerina/log;
import ballerinax/kafka;

import peerpressure/events as events;

configurable boolean startKafkaConsumers = true;
configurable string paymentsCompletedTopic = "payments.completed";
configurable string paymentsFailedTopic = "payments.failed";
configurable string kitchenPreparingTopic = "orders.preparing";
configurable string kitchenReadyTopic = "kitchen.orders.ready";
configurable string kitchenRejectedTopic = "kitchen.rejected";
configurable string deliveryStatusUpdatedTopic = "delivery.status";
configurable string orderConsumerGroup = "order-service-group";

# Module initialization starting the Kafka consumers in the background if enabled.
function init() returns error? {
    if enableKafka && startKafkaConsumers {
        _ = start runOrderEventConsumerLoop();
    } else {
        log:printInfo("Kafka consumers disabled via configuration", enableKafka = enableKafka, startKafkaConsumers = startKafkaConsumers);
    }
}

# Continuous background consumer loop for subscribed order coordination topics.
function runOrderEventConsumerLoop() returns error? {
    log:printInfo("Starting Order Service Kafka consumer background loop");
    while true {
        error? loopResult = pollOrderEventTopics();
        if loopResult is error {
            log:printError("Order Kafka consumer loop encountered error; retrying in 5s", 'error = loopResult);
            runtime:sleep(5.0d);
        }
    }
}

# Polls subscribed Kafka topics and dispatches records.
function pollOrderEventTopics() returns error? {
    kafka:Consumer consumer = check new (getEffectiveKafkaServers(), {
        groupId: orderConsumerGroup,
        offsetReset: "earliest",
        autoCommit: false
    });
    string[] subscribedTopics = [
        paymentsCompletedTopic,
        paymentsFailedTopic,
        kitchenPreparingTopic,
        kitchenReadyTopic,
        kitchenRejectedTopic,
        deliveryStatusUpdatedTopic
    ];
    if kitchenReadyTopic != "orders.ready" {
        subscribedTopics.push("orders.ready");
    }
    check consumer->subscribe(subscribedTopics);
    log:printInfo("Order Service Kafka consumer subscribed", topics = subscribedTopics, groupId = orderConsumerGroup);

    while true {
        kafka:AnydataConsumerRecord[] records = check consumer->poll(1.0);
        foreach kafka:AnydataConsumerRecord rec in records {
            error? procErr = processConsumerRecord(rec);
            if procErr is error {
                log:printError("Error processing record from Kafka topic; routing to DLQ", 'error = procErr, topic = rec.offset.partition.topic);
                byte[]|error rawPayload = extractPayloadBytes(rec.value);
                if rawPayload is byte[] {
                    orderEventProducer.publishRawDlq(rec.offset.partition.topic, rawPayload, procErr.message());
                }
            }
        }
        if records.length() > 0 {
            check consumer->commit();
        } else {
            runtime:sleep(0.5d);
        }
    }
}

# Processes a single Kafka consumer record from any subscribed topic.
public function processConsumerRecord(kafka:AnydataConsumerRecord rec) returns error? {
    string topic = rec.offset.partition.topic;
    byte[] valueBytes = check extractPayloadBytes(rec.value);
    return dispatchTopicPayload(topic, valueBytes);
}

# Extracts raw byte array from record payload.
isolated function extractPayloadBytes(anydata recordValue) returns byte[]|error {
    if recordValue is byte[] {
        return recordValue;
    } else if recordValue is string {
        return recordValue.toBytes();
    }
    return error("Kafka record value must be byte[] or string");
}

# Dispatches a raw byte payload to the appropriate event coordinator handler based on topic.
public function dispatchTopicPayload(string topic, byte[] payloadBytes) returns error? {
    string rawJson = check string:fromBytes(payloadBytes);
    json parsed = check rawJson.fromJsonString();

    if topic == paymentsCompletedTopic {
        events:PaymentCompleted event = check events:validatePaymentCompleted(parsed);
        _ = check processPaymentCompleted(event);
    } else if topic == paymentsFailedTopic {
        events:PaymentFailed event = check events:validatePaymentFailed(parsed);
        _ = check processPaymentFailed(event);
    } else if topic == kitchenPreparingTopic {
        _ = check processKitchenPreparingJson(parsed);
    } else if topic == kitchenReadyTopic || topic == "orders.ready" || topic == "kitchen.orders.ready" {
        _ = check processKitchenReadyJson(parsed);
    } else if topic == kitchenRejectedTopic {
        events:KitchenRejected event = check events:validateKitchenRejected(parsed);
        _ = check processKitchenRejected(event);
    } else if topic == deliveryStatusUpdatedTopic {
        events:DeliveryStatusUpdated event = check events:validateDeliveryStatusUpdated(parsed);
        _ = check processDeliveryStatusUpdated(event);
    } else {
        log:printWarn("Unhandled Kafka topic received", topic = topic);
    }
}

# Processes a PaymentCompleted event idempotently and deterministically.
# Transitions order from CREATED to CONFIRMED and publishes OrderConfirmed.
# Duplicate events for an already confirmed or downstream order are handled harmlessly.
# Illegal transitions are safely rejected with an error and logged.
public function processPaymentCompleted(events:PaymentCompleted event) returns Order|error {
    Order? existing = check orderStore.get(event.orderId);
    if existing is () {
        string msg = string `Order '${event.orderId}' not found for PaymentCompleted event`;
        log:printWarn(msg);
        return error(msg);
    }

    // Idempotent duplicate: already in CONFIRMED
    if existing.status == events:CONFIRMED {
        log:printInfo(string `Order '${event.orderId}' is already CONFIRMED; ignoring duplicate PaymentCompleted`);
        return existing;
    }

    // If order has already progressed downstream (e.g. PREPARING, READY, OUT_FOR_DELIVERY, DELIVERED), payment was already processed
    if existing.status == events:PREPARING || existing.status == events:READY ||
        existing.status == events:OUT_FOR_DELIVERY || existing.status == events:DELIVERED {
        log:printInfo(string `Order '${event.orderId}' is already in downstream state '${existing.status}'; ignoring duplicate PaymentCompleted`);
        return existing;
    }

    // Enforce FSM transition from current state to CONFIRMED
    StateTransitionResult checkResult = validateTransition(existing.status, events:CONFIRMED);
    if !checkResult.allowed {
        string reason = checkResult.rejectionReason ?: string `Illegal transition from '${existing.status}' to CONFIRMED`;
        log:printError(string `Disallowed transition for order '${event.orderId}': ${reason}`);
        return error(reason);
    }

    Order updated = check orderStore.updateStatus(event.orderId, events:CONFIRMED, event.paymentId);
    log:printInfo("Order updated to CONFIRMED via PaymentCompleted event", orderId = event.orderId, paymentId = event.paymentId);

    // Emit OrderConfirmed domain event to orders.confirmed
    error? pubErr = orderEventProducer.publishOrderConfirmed(updated, currentTimestamp());
    if pubErr is error {
        log:printError("Failed to publish OrderConfirmed event", 'error = pubErr, orderId = event.orderId);
    }

    return updated;
}

# Processes a PaymentFailed event idempotently and deterministically.
# Transitions order from CREATED to CANCELLED.
# Duplicate events for an already cancelled order are handled harmlessly.
# Illegal transitions are safely rejected with an error and logged.
public function processPaymentFailed(events:PaymentFailed event) returns Order|error {
    return cancelOrderFromFailureEvent(event.orderId, event.reason, "PaymentFailed");
}

# Processes a KitchenRejected event idempotently and deterministically.
# Transitions order from CONFIRMED (or CREATED) to CANCELLED.
public function processKitchenRejected(events:KitchenRejected event) returns Order|error {
    return cancelOrderFromFailureEvent(event.orderId, event.reason, "KitchenRejected");
}

function cancelOrderFromFailureEvent(string orderId, string reason, string sourceEventName) returns Order|error {
    Order? existing = check orderStore.get(orderId);
    if existing is () {
        string msg = string `Order '${orderId}' not found for ${sourceEventName} event`;
        log:printWarn(msg);
        return error(msg);
    }

    // Idempotent duplicate: already CANCELLED
    if existing.status == events:CANCELLED {
        log:printInfo(string `Order '${orderId}' is already CANCELLED; ignoring duplicate ${sourceEventName}`);
        return existing;
    }

    // Enforce cancellation guard: only CREATED or CONFIRMED orders can be cancelled
    if !isCancellable(existing.status) {
        string msg = string `Order '${orderId}' cannot be cancelled in state '${existing.status}'`;
        log:printError(msg);
        return error(msg);
    }

    // Enforce FSM transition from current state to CANCELLED
    StateTransitionResult checkResult = validateTransition(existing.status, events:CANCELLED);
    if !checkResult.allowed {
        string rejection = checkResult.rejectionReason ?: string `Illegal transition from '${existing.status}' to CANCELLED`;
        log:printError(string `Disallowed transition for order '${orderId}': ${rejection}`);
        return error(rejection);
    }

    Order updated = check orderStore.updateStatus(orderId, events:CANCELLED, (), reason);
    log:printInfo(string `Order updated to CANCELLED via ${sourceEventName} event`, orderId = orderId, reason = reason);
    return updated;
}

# Processes a DeliveryStatusUpdated event idempotently and deterministically.
# - If status == PICKED_UP -> transitions READY -> OUT_FOR_DELIVERY
# - If status == DELIVERED -> transitions OUT_FOR_DELIVERY -> DELIVERED
# Duplicate events are handled harmlessly.
# Illegal transitions (e.g., CREATED -> DELIVERED) are safely rejected with an error and logged.
public function processDeliveryStatusUpdated(events:DeliveryStatusUpdated event) returns Order|error {
    Order? existing = check orderStore.get(event.orderId);
    if existing is () {
        string msg = string `Order '${event.orderId}' not found for DeliveryStatusUpdated event`;
        log:printWarn(msg);
        return error(msg);
    }

    if event.status == events:PICKED_UP {
        // Idempotent duplicate: already OUT_FOR_DELIVERY or DELIVERED
        if existing.status == events:OUT_FOR_DELIVERY || existing.status == events:DELIVERED {
            log:printInfo(string `Order '${event.orderId}' is already at or past OUT_FOR_DELIVERY ('${existing.status}'); ignoring duplicate PICKED_UP`);
            return existing;
        }

        // FSM rule: only READY -> OUT_FOR_DELIVERY is legal
        StateTransitionResult checkResult = validateTransition(existing.status, events:OUT_FOR_DELIVERY);
        if !checkResult.allowed {
            string reason = checkResult.rejectionReason ?: string `Illegal transition from '${existing.status}' to OUT_FOR_DELIVERY (must be in READY state)`;
            log:printError(string `Disallowed transition for order '${event.orderId}': ${reason}`);
            return error(reason);
        }

        Order updated = check orderStore.updateStatus(event.orderId, events:OUT_FOR_DELIVERY);
        log:printInfo("Order updated to OUT_FOR_DELIVERY via DeliveryStatusUpdated", orderId = event.orderId);
        return updated;
    } else if event.status == events:DELIVERED {
        // Idempotent duplicate: already DELIVERED
        if existing.status == events:DELIVERED {
            log:printInfo(string `Order '${event.orderId}' is already DELIVERED; ignoring duplicate DELIVERED event`);
            return existing;
        }

        // FSM rule: only OUT_FOR_DELIVERY -> DELIVERED is legal
        StateTransitionResult checkResult = validateTransition(existing.status, events:DELIVERED);
        if !checkResult.allowed {
            string reason = checkResult.rejectionReason ?: string `Illegal transition from '${existing.status}' to DELIVERED (must be in OUT_FOR_DELIVERY state)`;
            log:printError(string `Disallowed transition for order '${event.orderId}': ${reason}`);
            return error(reason);
        }

        Order updated = check orderStore.updateStatus(event.orderId, events:DELIVERED);
        log:printInfo("Order updated to DELIVERED via DeliveryStatusUpdated", orderId = event.orderId);
        return updated;
    } else {
        log:printInfo(string `Ignoring DeliveryStatusUpdated with uncoordinated status '${event.status}' for order '${event.orderId}'`);
        return existing;
    }
}

# Helper function to process PaymentCompleted from JSON.
public function processPaymentCompletedJson(json payload) returns Order|error {
    events:PaymentCompleted event = check events:validatePaymentCompleted(payload);
    return processPaymentCompleted(event);
}

# Helper function to process PaymentFailed from JSON.
public function processPaymentFailedJson(json payload) returns Order|error {
    events:PaymentFailed event = check events:validatePaymentFailed(payload);
    return processPaymentFailed(event);
}

# Helper function to process DeliveryStatusUpdated from JSON.
public function processDeliveryStatusUpdatedJson(json payload) returns Order|error {
    events:DeliveryStatusUpdated event = check events:validateDeliveryStatusUpdated(payload);
    return processDeliveryStatusUpdated(event);
}

# Processes an order entering PREPARING state idempotently and deterministically.
# Transitions order from CONFIRMED to PREPARING.
public function processKitchenPreparing(string orderId) returns Order|error {
    Order? existing = check orderStore.get(orderId);
    if existing is () {
        string msg = string `Order '${orderId}' not found for KitchenPreparing event`;
        log:printWarn(msg);
        return error(msg);
    }

    if existing.status == events:PREPARING || existing.status == events:READY ||
        existing.status == events:OUT_FOR_DELIVERY || existing.status == events:DELIVERED {
        log:printInfo(string `Order '${orderId}' is already at or past PREPARING ('${existing.status}'); ignoring duplicate preparing event`);
        return existing;
    }

    StateTransitionResult checkResult = validateTransition(existing.status, events:PREPARING);
    if !checkResult.allowed {
        string reason = checkResult.rejectionReason ?: string `Illegal transition from '${existing.status}' to PREPARING`;
        log:printError(string `Disallowed transition for order '${orderId}': ${reason}`);
        return error(reason);
    }

    Order updated = check orderStore.updateStatus(orderId, events:PREPARING);
    log:printInfo("Order updated to PREPARING via KitchenPreparing event", orderId = orderId);
    return updated;
}

# Processes an order entering READY state idempotently and deterministically.
# Transitions order from PREPARING to READY.
public function processKitchenReady(string orderId) returns Order|error {
    Order? existing = check orderStore.get(orderId);
    if existing is () {
        string msg = string `Order '${orderId}' not found for KitchenReady event`;
        log:printWarn(msg);
        return error(msg);
    }

    if existing.status == events:READY || existing.status == events:OUT_FOR_DELIVERY ||
        existing.status == events:DELIVERED {
        log:printInfo(string `Order '${orderId}' is already at or past READY ('${existing.status}'); ignoring duplicate ready event`);
        return existing;
    }

    StateTransitionResult checkResult = validateTransition(existing.status, events:READY);
    if !checkResult.allowed {
        string reason = checkResult.rejectionReason ?: string `Illegal transition from '${existing.status}' to READY`;
        log:printError(string `Disallowed transition for order '${orderId}': ${reason}`);
        return error(reason);
    }

    Order updated = check orderStore.updateStatus(orderId, events:READY);
    log:printInfo("Order updated to READY via KitchenReady event", orderId = orderId);
    return updated;
}

# Helper function to process KitchenPreparing from JSON using shared event validators.
public function processKitchenPreparingJson(json payload) returns Order|error {
    events:OrderPreparing|error orderPrep = events:validateOrderPreparing(payload);
    if orderPrep is events:OrderPreparing {
        return processKitchenPreparing(orderPrep.orderId);
    }
    events:KitchenPreparing|error kitchenPrep = events:validateKitchenPreparing(payload);
    if kitchenPrep is events:KitchenPreparing {
        return processKitchenPreparing(kitchenPrep.orderId);
    }
    events:KitchenStatusEvent statusEvt = check events:validateKitchenStatus(payload);
    if statusEvt.status != events:PREPARING {
        return error("Validation failed: expected PREPARING kitchen status");
    }
    return processKitchenPreparing(statusEvt.orderId);
}

# Helper function to process KitchenReady from JSON using shared event validators.
public function processKitchenReadyJson(json payload) returns Order|error {
    events:KitchenOrderReady|error readyEvt = events:validateKitchenOrderReady(payload);
    if readyEvt is events:KitchenOrderReady {
        return processKitchenReady(readyEvt.orderId);
    }
    events:KitchenStatusEvent statusEvt = check events:validateKitchenStatus(payload);
    if statusEvt.status != events:READY {
        return error("Validation failed: expected READY kitchen status");
    }
    return processKitchenReady(statusEvt.orderId);
}
