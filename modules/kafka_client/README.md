# Kafka Client Module (`peerpressure/kafka_client`)

Provides resilient Apache Kafka producer and consumer wrappers with built-in retries, connection pooling, and error trapping for the PeerPressure microservices.

---

## 1. Features & Capabilities

- **ResilientProducer**:
  - Connection pooling and thread-safe publishing across strands.
  - Idempotent producer settings (`enableIdempotence = true`, `acks = "all"`).
  - Configurable backoff retry policy for transient network drops.
- **Defensive Deserialization**:
  - `safeParseJson(byte[] payload)` converts Kafka wire bytes safely to JSON without throwing unhandled panics.
  - Distinguishes between UTF-8 decoding errors and malformed JSON syntax.
  - Returns typed `DeserializationError` instances to protect consumer event loops from starvation or crashes.
- **Typed Error Hierarchy**:
  - `ConnectionError`: Broker unreachable or bootstrap resolution failure.
  - `PublishError`: Message send failure after retries exhausted.
  - `DeserializationError`: Corrupted or invalid payload structure.

---

## 2. Usage Example

```ballerina
import peerpressure/kafka_client;

// Resilient producer initialization
kafka_client:ResilientProducer producer = check new({
    bootstrapServers: "localhost:29092",
    clientId: "order-service-producer"
});

// Resilient send
check producer.publish("orders.created", orderId, payload);
```
