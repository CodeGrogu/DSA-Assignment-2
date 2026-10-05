import ballerina/log;
import ballerinax/kafka;

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
            string payload = check string:fromBytes(rec.value);
            log:printInfo("Got a Kafka event", payload = payload);
        }
        // Tell Kafka we've handled these.
        check caller->commit();
    }

    remote function onError(kafka:Error err) returns error? {
        log:printError("Kafka consumer hit an error", 'error = err);
    }
}
