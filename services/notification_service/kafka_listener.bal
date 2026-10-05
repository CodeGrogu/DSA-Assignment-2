import ballerina/log;
import ballerinax/kafka;

import peerpressure/admin_domain as domain;

final kafka:ConsumerConfiguration consumerConfig = {
    groupId: CONSUMER_GROUP,
    topics: SUBSCRIPTION_TOPICS,
    offsetReset: kafka:OFFSET_RESET_EARLIEST,
    autoCommit: false
};

listener kafka:Listener kafkaListener = new (kafkaBootstrapServers(), consumerConfig);

service on kafkaListener {

    remote function onConsumerRecord(kafka:Caller caller, kafka:BytesConsumerRecord[] records) returns error? {
        foreach kafka:BytesConsumerRecord rec in records {
            handleOne(rec.value, rec.offset.partition.topic);
        }
        check caller->commit();
    }

    remote function onError(kafka:Error err) returns error? {
        log:printError("Kafka consumer hit an error", 'error = err);
    }
}

function handleOne(byte[] raw, string? topic = ()) {
    ParsedEvent? parsed = parseEnvelope(raw, topic);
    if parsed is () {
        return;
    }

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
        domain:NotificationPayload? payload = buildPayload(rule, parsed.data);
        if payload is domain:NotificationPayload {
            // Pretend we sent it — then write an audit row to Mongo.
            checkpanic saveAudit(payload, "SENT");
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
