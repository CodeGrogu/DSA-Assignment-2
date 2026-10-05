import ballerina/lang.'runtime as runtime;
import ballerina/log;
import ballerinax/kafka;
import peerpressure/events as events;

configurable boolean startKafkaConsumers = true;
configurable string paymentsCompletedTopic = "payments.completed";
configurable string paymentsFailedTopic = "payments.failed";
configurable string deliveryStatusUpdatedTopic = "delivery.status_updated";
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
    kafka:Consumer consumer = check new (kafkaBootstrapServers, {
        groupId: orderConsumerGroup,
        offsetReset: "earliest",
        autoCommit: false
    });
    string[] subscribedTopics = [paymentsCompletedTopic, paymentsFailedTopic, deliveryStatusUpdatedTopic];
    check consumer->subscribe(subscribedTopics);
    log:printInfo("Order Service Kafka consumer subscribed", topics = subscribedTopics, groupId = orderConsumerGroup);

    while true {
        kafka:AnydataConsumerRecord[] records = check consumer->poll(1.0);
        foreach kafka:AnydataConsumerRecord rec in records {
            error? procErr = processConsumerRecord(rec);
            if procErr is error {
                log:printError("Error processing record from Kafka topic", 'error = procErr, topic = rec.offset.partition.topic);
            }
        }
        if records.length() > 0 {
            check consumer->commit();
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
    } else if topic == deliveryStatusUpdatedTopic {
        events:DeliveryStatusUpdated event = check events:validateDeliveryStatusUpdated(parsed);
        _ = check processDeliveryStatusUpdated(event);
    } else {
        log:printWarn("Unhandled Kafka topic received", topic = topic);
    }
}

# Processes a PaymentCompleted event idempotently and deterministically.
# Transitions order from CREATED to CONFIRMED.
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
    return updated;
}

# Processes a PaymentFailed event idempotently and deterministically.
# Transitions order from CREATED to CANCELLED.
# Duplicate events for an already cancelled order are handled harmlessly.
# Illegal transitions are safely rejected with an error and logged.
public function processPaymentFailed(events:PaymentFailed event) returns Order|error {
    Order? existing = check orderStore.get(event.orderId);
    if existing is () {
        string msg = string `Order '${event.orderId}' not found for PaymentFailed event`;
        log:printWarn(msg);
        return error(msg);
    }

    // Idempotent duplicate: already CANCELLED
    if existing.status == events:CANCELLED {
        log:printInfo(string `Order '${event.orderId}' is already CANCELLED; ignoring duplicate PaymentFailed`);
        return existing;
    }

    // Enforce cancellation guard: only CREATED or CONFIRMED orders can be cancelled
    if !isCancellable(existing.status) {
        string msg = string `Order '${event.orderId}' cannot be cancelled in state '${existing.status}'`;
        log:printError(msg);
        return error(msg);
    }

    // Enforce FSM transition from current state to CANCELLED
    StateTransitionResult checkResult = validateTransition(existing.status, events:CANCELLED);
    if !checkResult.allowed {
        string reason = checkResult.rejectionReason ?: string `Illegal transition from '${existing.status}' to CANCELLED`;
        log:printError(string `Disallowed transition for order '${event.orderId}': ${reason}`);
        return error(reason);
    }

    Order updated = check orderStore.updateStatus(event.orderId, events:CANCELLED, (), event.reason);
    log:printInfo("Order updated to CANCELLED via PaymentFailed event", orderId = event.orderId, reason = event.reason);
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
