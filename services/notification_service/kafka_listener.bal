import ballerina/log;
import ballerinax/kafka;

import peerpressure/admin_domain as domain;

final kafka:ConsumerConfiguration consumerConfig = {
    groupId: CONSUMER_GROUP,
    topics: [TOPIC_ORDERS, TOPIC_PAYMENTS, TOPIC_KITCHEN, TOPIC_DELIVERY],
    offsetReset: kafka:OFFSET_RESET_EARLIEST,
    autoCommit: false
};

listener kafka:Listener kafkaListener = new (kafkaBootstrapServers(), consumerConfig);

service on kafkaListener {

    remote function onConsumerRecord(kafka:Caller caller, kafka:BytesConsumerRecord[] records) returns error? {
        foreach kafka:BytesConsumerRecord rec in records {
            handleOne(rec.value);
        }
        check caller->commit();
    }

    remote function onError(kafka:Error err) returns error? {
        log:printError("Kafka consumer hit an error", 'error = err);
    }
}

function handleOne(byte[] raw) {
    ParsedEvent? parsed = parseEnvelope(raw);
    if parsed is () {
        return;
    }

    domain:SubscriptionRule[] rules = domain:rulesForEvent(parsed.eventType);
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
