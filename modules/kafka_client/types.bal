import ballerinax/kafka;

# Configuration options for the resilient Kafka producer.
public type ProducerConfig record {|
    # Comma-separated list of Kafka broker host:port pairs.
    string bootstrapServers = "localhost:9092";
    # Unique identifier for this producer instance.
    string clientId = "resilient-producer";
    # Number of acknowledgments required.
    kafka:ProducerAcks acks = kafka:ACKS_ALL;
    # Whether to enable idempotent message delivery.
    boolean enableIdempotence = true;
    # Maximum number of retry attempts for failed publish attempts.
    int maxRetries = 3;
    # Delay between retry attempts in seconds.
    decimal retryBackoffSeconds = 1.0;
    # Buffer memory or request timeout in seconds if applicable.
    decimal requestTimeoutSeconds = 30.0;
|};

# Configuration options for the Kafka consumer.
public type ConsumerConfig record {|
    # Comma-separated list of Kafka broker host:port pairs.
    string bootstrapServers = "localhost:9092";
    # Consumer group identifier.
    string groupId;
    # Topics to subscribe to.
    string[] topics = [];
    # Strategy when no previous offset exists: "earliest" or "latest".
    string offsetReset = "earliest";
    # Whether to automatically commit offsets periodically.
    boolean autoCommit = false;
    # Session timeout in seconds.
    decimal sessionTimeoutSeconds = 45.0;
|};

# Error detail for deserialization failures.
public type DeserializationErrorDetail record {|
    # The raw string or byte representation that failed parsing.
    string rawContent;
    # The error message describing why parsing failed.
    string reason;
|};

# Distinct error returned when payload cannot be parsed as valid JSON or expected schema.
public type DeserializationError distinct error<DeserializationErrorDetail>;

# Error detail for producer publish failures.
public type PublishErrorDetail record {|
    # Target topic that failed.
    string topic;
    # Number of attempts made before failing.
    int attempts;
    # Underlying root cause message.
    string reason;
|};

# Distinct error returned when Kafka producer fails to deliver an event.
public type PublishError distinct error<PublishErrorDetail>;

# Error detail for connection/client initialization failures.
public type ConnectionErrorDetail record {|
    # The bootstrap servers attempted.
    string bootstrapServers;
    # Underlying reason for failure.
    string reason;
|};

# Distinct error returned when connecting to the Kafka broker fails.
public type ConnectionError distinct error<ConnectionErrorDetail>;

# Union of all kafka_client error types.
public type KafkaClientError DeserializationError|PublishError|ConnectionError;
