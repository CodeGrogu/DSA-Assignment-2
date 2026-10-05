# Kafka Client Module (`peerpressure/kafka_client`)

Provides resilient Kafka producer and consumer wrappers for the PeerPressure distributed architecture.

## Features
- **ResilientProducer**: Thread-safe connection pooling, automatic retries with backoff, idempotent message publishing (`enableIdempotence = true`, `acks = "all"`).
- **Deserializer**: `safeParseJson` and `extractBytes` trapping UTF-8 decoding and malformed JSON syntax errors into typed `DeserializationError` instances to protect consumer event loops from crashing.
- **Error Typing**: Structured errors including `DeserializationError`, `PublishError`, and `ConnectionError`.
