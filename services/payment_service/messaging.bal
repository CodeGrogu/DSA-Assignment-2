import ballerina/os;
import ballerinax/kafka;

import peerpressure/events;

configurable string kafkaBroker = "localhost:9092";

isolated kafka:Producer? cachedPaymentProducer = ();

function paymentProducer() returns kafka:Producer|error {
    string broker = kafkaBootstrapServers();

    kafka:Producer producer;
    lock {
        if cachedPaymentProducer is kafka:Producer {
            producer = <kafka:Producer>cachedPaymentProducer;
        } else {
            kafka:Producer newProducer = check new (broker, {
                acks: kafka:ACKS_ALL,
                retryCount: 3,
                enableIdempotence: true
            });
            cachedPaymentProducer = newProducer;
            producer = newProducer;
        }
    }
    return producer;
}

function kafkaBootstrapServers() returns string {
    string? configuredBroker = os:getEnv("KAFKA_BROKER");
    if configuredBroker is string {
        return configuredBroker;
    }
    return kafkaBroker;
}

# Publishes a successful payment event keyed by its order ID.
# + event - The payment completion event to publish.
# + return - An error if Kafka cannot accept the event.
public function publishPaymentCompleted(events:PaymentCompleted event) returns error? {
    kafka:Producer producer = check paymentProducer();
    string message = event.toJson().toJsonString();
    check producer->send({
        topic: "payments.completed",
        key: event.orderId.toBytes(),
        value: message.toBytes()
    });
}

# Publishes a failed payment event keyed by its order ID.
# + event - The payment failure event to publish.
# + return - An error if Kafka cannot accept the event.
public function publishPaymentFailed(events:PaymentFailed event) returns error? {
    kafka:Producer producer = check paymentProducer();
    string message = event.toJson().toJsonString();
    check producer->send({
        topic: "payments.failed",
        key: event.orderId.toBytes(),
        value: message.toBytes()
    });
}

# Publishes a refunded payment event keyed by its order ID.
# + event - The payment refund event to publish.
# + return - An error if Kafka cannot accept the event.
public function publishPaymentRefunded(events:PaymentRefunded event) returns error? {
    kafka:Producer producer = check paymentProducer();
    string message = event.toJson().toJsonString();
    check producer->send({
        topic: "payments.refunded",
        key: event.orderId.toBytes(),
        value: message.toBytes()
    });
}
