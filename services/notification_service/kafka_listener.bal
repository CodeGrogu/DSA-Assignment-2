import ballerina/log;
import ballerina/time;
import ballerinax/kafka;

import peerpressure/admin_domain as domain;
import peerpressure/resilience;

final kafka:ConsumerConfiguration consumerConfig = {
    groupId: CONSUMER_GROUP,
    topics: SUBSCRIPTION_TOPICS,
    offsetReset: kafka:OFFSET_RESET_EARLIEST,
    autoCommit: false
};

listener kafka:Listener kafkaListener = new (kafkaBootstrapServers(), consumerConfig);

final resilience:DlqRouter notificationDlqRouter = new ((), {
    bootstrapServers: kafkaBootstrapServers(),
    clientId: "notification-service-dlq"
});

service on kafkaListener {

    remote function onConsumerRecord(kafka:Caller caller, kafka:BytesConsumerRecord[] records) returns error? {
        foreach kafka:BytesConsumerRecord rec in records {
            string sourceTopic = rec.offset.partition.topic;
            byte[] rawPayload = rec.value;
            error? procResult = resilience:executeWithRetry(function() returns error? {
                        return processNotificationRecord(rawPayload, sourceTopic);
                    });
            if procResult is error {
                error? dlqErr = notificationDlqRouter.routeToDlq(rawPayload, {
                    sourceTopic: sourceTopic,
                    originalPartition: rec.offset.partition.partition,
                    originalOffset: rec.offset.offset,
                    retryCount: 1,
                    exceptionMessage: procResult.message(),
                    timestamp: time:utcToString(time:utcNow())
                });
                if dlqErr is error {
                    log:printWarn("Failed to route poison-pill notification message to DLQ", 'error = dlqErr);
                }
            }
        }
        check caller->commit();
    }

    remote function onError(kafka:Error err) {
        log:printError("Kafka listener error", 'error = err);
    }
}

function processNotificationRecord(byte[] raw, string? topic = ()) returns error? {
    ParsedEvent|error? parsed = trap parseEnvelope(raw, topic);
    if parsed is error|() {
        return error("Unrecognizable or malformed event payload");
    }
    handleParsedEvent(parsed);
}

function handleOne(byte[] raw, string? topic = ()) {
    ParsedEvent? parsed = parseEnvelope(raw, topic);
    if parsed is () {
        return;
    }
    handleParsedEvent(parsed);
}

function handleParsedEvent(ParsedEvent parsed) {
    domain:SubscriptionRule[] rules = domain:rulesForEvent(parsed.eventType);
    if rules.length() == 0 {
        string altType = getAlternateEventType(parsed.eventType);
        if altType != "" {
            rules = domain:rulesForEvent(altType);
        }
    }
    if rules.length() == 0 {
        log:printInfo("No rules matched this event", eventType = parsed.eventType);
        return;
    }

    foreach domain:SubscriptionRule rule in rules {
        domain:NotificationPayload|error? notif = trap buildPayload(rule, parsed.data);
        if notif is error|() {
            continue;
        }
        error? err = trap saveAudit(notif, "SENT");
        if err is error {
            log:printError("Audit write failed", 'error = err);
        }
    }
}

isolated function getAlternateEventType(string eventType) returns string {
    match eventType {
        "payment.completed" => {
            return "payments.completed";
        }
        "payments.completed" => {
            return "payment.completed";
        }
        "payment.failed" => {
            return "payments.failed";
        }
        "payments.failed" => {
            return "payment.failed";
        }
        "orders.created" => {
            return "order.created";
        }
        "order.created" => {
            return "orders.created";
        }
        "orders.confirmed" => {
            return "order.confirmed";
        }
        "order.confirmed" => {
            return "orders.confirmed";
        }
        "kitchen.orders.ready" => {
            return "kitchen.order.ready";
        }
        "kitchen.order.ready" => {
            return "kitchen.orders.ready";
        }
        "orders.preparing" => {
            return "order.preparing";
        }
        "order.preparing" => {
            return "orders.preparing";
        }
        "orders.cancelled" => {
            return "order.cancelled";
        }
        "order.cancelled" => {
            return "orders.cancelled";
        }
        _ => {
            return "";
        }
    }
}
