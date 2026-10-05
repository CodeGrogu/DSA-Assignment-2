import ballerina/lang.'runtime as runtime;
import ballerina/log;
import ballerinax/kafka;

# Resilient Kafka producer wrapper providing connection reuse, thread-safe reconnection,
# and retries with backoff for transient publish failures.
public isolated class ResilientProducer {
    private final readonly & ProducerConfig config;
    private kafka:Producer? producer = ();

    # Initializes the ResilientProducer with configuration.
    # Connection to the broker is lazily initialized on first publish or explicitly via `connect()`.
    #
    # + config - The producer configuration settings
    public isolated function init(ProducerConfig config = {}) {
        self.config = config.cloneReadOnly();
    }

    # Explicitly connects to the Kafka cluster if not already connected.
    #
    # + return - `()` on success, or a `ConnectionError`
    public isolated function connect() returns ConnectionError? {
        lock {
            if self.producer is kafka:Producer {
                return;
            }
            kafka:ProducerConfiguration producerConfig = {
                clientId: self.config.clientId,
                acks: self.config.acks,
                enableIdempotence: self.config.enableIdempotence,
                retryCount: self.config.maxRetries
            };
            kafka:Producer|error result = trap new (self.config.bootstrapServers, producerConfig);
            if result is kafka:Producer {
                self.producer = result;
                log:printInfo("ResilientProducer successfully connected to Kafka",
                        bootstrapServers = self.config.bootstrapServers,
                        clientId = self.config.clientId
                );
            } else {
                return error ConnectionError("Failed to initialize Kafka producer connection",
                    bootstrapServers = self.config.bootstrapServers,
                    reason = result.message()
                );
            }
        }
    }

    # Retrieves or creates the underlying Kafka producer safely within a lock.
    #
    # + return - The active `kafka:Producer` or a `ConnectionError`
    private isolated function getOrCreateProducer() returns kafka:Producer|ConnectionError {
        lock {
            if self.producer is kafka:Producer {
                return <kafka:Producer>self.producer;
            }
        }
        ConnectionError? connErr = self.connect();
        if connErr is ConnectionError {
            return connErr;
        }
        lock {
            if self.producer is kafka:Producer {
                return <kafka:Producer>self.producer;
            }
            return error ConnectionError("Kafka producer instance unavailable after connection",
                bootstrapServers = self.config.bootstrapServers,
                reason = "Producer reference was null"
            );
        }
    }

    # Resets the active producer instance in case of a broken connection.
    private isolated function invalidateProducer() {
        lock {
            self.producer = ();
        }
    }

    # Publishes raw byte payload to a topic with automatic retry attempts.
    #
    # + topic - The destination Kafka topic
    # + value - Payload byte array
    # + key - Optional partition key byte array
    # + headers - Optional key-value message headers
    # + return - `()` on successful publish or `PublishError`
    public isolated function publish(string topic, byte[] value, byte[]? key = (), map<byte[]>? headers = ()) returns PublishError? {
        int attempts = 0;
        int maxRetries = self.config.maxRetries;
        string lastErrorMsg = "";

        while attempts <= maxRetries {
            attempts += 1;
            kafka:Producer|ConnectionError prod = self.getOrCreateProducer();
            if prod is ConnectionError {
                lastErrorMsg = prod.message();
                self.invalidateProducer();
                if attempts <= maxRetries {
                    runtime:sleep(self.config.retryBackoffSeconds * <decimal>attempts);
                    continue;
                }
                break;
            }

            kafka:AnydataProducerRecord recordToSend = {
                topic: topic,
                value: value,
                key: key,
                headers: headers
            };

            error? sendErr = trap prod->send(recordToSend);
            if sendErr is () {
                return;
            }

            lastErrorMsg = sendErr.message();
            log:printWarn("Kafka publish failed; retrying",
                    topic = topic,
                    attempt = attempts,
                    maxRetries = maxRetries,
                    'error = sendErr
            );
            self.invalidateProducer();

            if attempts <= maxRetries {
                runtime:sleep(self.config.retryBackoffSeconds * <decimal>attempts);
            }
        }

        return error PublishError("Failed to publish event after maximum retry attempts",
            topic = topic,
            attempts = attempts,
            reason = lastErrorMsg
        );
    }

    # Publishes a Ballerina `json` payload to a Kafka topic.
    #
    # + topic - Destination Kafka topic
    # + payload - JSON value to serialize and send
    # + key - Optional partition key string
    # + headers - Optional headers
    # + return - `()` on success or `PublishError`
    public isolated function publishJson(string topic, json payload, string? key = (), map<byte[]>? headers = ()) returns PublishError? {
        byte[] valueBytes = payload.toJsonString().toBytes();
        byte[]? keyBytes = key is string ? key.toBytes() : ();
        return self.publish(topic, valueBytes, keyBytes, headers);
    }

    # Closes the producer connection cleanly.
    #
    # + return - `()` or `error` if close fails
    public isolated function close() returns error? {
        lock {
            kafka:Producer? prod = self.producer;
            if prod is kafka:Producer {
                check prod->close();
                self.producer = ();
            }
        }
    }
}
