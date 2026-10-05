# Resilience Module (`peerpressure/resilience`)

Provides fault tolerance, exponential backoff retries, error classification, and Dead Letter Queue (DLQ) routing for event-driven microservices.

## Features
- **Transient Error Classification**: `isTransient(error)` classifies exceptions into transient (network timeout, broker unavailable, temporary I/O) vs permanent (deserialization errors, validation failures, poison pills).
- **Exponential Backoff**: `executeWithRetry` provides configurable retry policies (default 3 attempts with 1s, 2s, 4s backoff) and immediately bypasses retries on non-transient failures.
- **Dead Letter Queue (DLQ) Router**: `DlqRouter` dispatches poison pills and unprocessable messages to `<topic>.dlq` with 6 diagnostic headers:
  - `x-exception-message`
  - `x-source-topic`
  - `x-retry-count`
  - `x-timestamp`
  - `x-original-partition`
  - `x-original-offset`
