import ballerina/log;

import peerpressure/kafka_client;

# Resolves the Dead Letter Queue topic name for a given source topic.
# Appends `.dlq` suffix if not already ending in `.dlq`.
#
# + sourceTopic - The original Kafka topic name
# + return - The DLQ topic name
public isolated function resolveDlqTopic(string sourceTopic) returns string {
    if sourceTopic.endsWith(".dlq") {
        return sourceTopic;
    }
    return string `${sourceTopic}.dlq`;
}

# Constructs the 6 diagnostic headers required for DLQ message tracing.
#
# + context - The DLQ diagnostic context
# + return - Map of header keys to byte array values
public isolated function buildDiagnosticHeaders(DlqContext context) returns map<byte[]> {
    return {
        "x-exception-message": context.exceptionMessage.toBytes(),
        "x-source-topic": context.sourceTopic.toBytes(),
        "x-retry-count": context.retryCount.toString().toBytes(),
        "x-timestamp": context.timestamp.toBytes(),
        "x-original-partition": context.originalPartition.toString().toBytes(),
        "x-original-offset": context.originalOffset.toString().toBytes()
    };
}

# Dead Letter Queue router that redirects poison-pill and unprocessable messages
# to dedicated `<topic>.dlq` topics with standard diagnostic metadata headers.
public isolated class DlqRouter {
    private final kafka_client:ResilientProducer producer;

    # Initializes the DLQ router.
    #
    # + producer - An existing ResilientProducer or `()` to initialize a default producer
    # + config - Optional producer configuration if creating a new producer
    public isolated function init(kafka_client:ResilientProducer? producer = (), kafka_client:ProducerConfig config = {}) {
        if producer is kafka_client:ResilientProducer {
            self.producer = producer;
        } else {
            self.producer = new (config);
        }
    }

    # Routes an unprocessable message payload to the Dead Letter Queue topic
    # with the 6 required diagnostic headers.
    #
    # + payload - Raw message bytes that could not be processed
    # + context - Diagnostic execution context
    # + key - Optional original record key
    # + return - `()` on successful routing, or `error` if dispatch to DLQ fails
    public isolated function routeToDlq(byte[] payload, DlqContext context, byte[]? key = ()) returns error? {
        string dlqTopic = resolveDlqTopic(context.sourceTopic);
        map<byte[]> headers = buildDiagnosticHeaders(context);

        log:printWarn("Routing poison-pill message to Dead Letter Queue",
                sourceTopic = context.sourceTopic,
                dlqTopic = dlqTopic,
                reason = context.exceptionMessage,
                retryCount = context.retryCount,
                originalOffset = context.originalOffset,
                originalPartition = context.originalPartition
        );

        return self.producer.publish(dlqTopic, payload, key, headers);
    }
}
