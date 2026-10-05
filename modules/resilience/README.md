# Resilience Module (`peerpressure/resilience`)

Provides fault tolerance, exponential backoff retries, error classification, and Dead Letter Queue (DLQ) routing for event-driven microservices.

---

## 1. Features & Architecture

- **Transient vs Permanent Error Classification**:
  - `isTransient(error)` inspects error types and messages.
  - Classifies temporary network drops, broker disconnects, and lock contentions as *transient* (eligible for retry).
  - Classifies JSON deserialization failures, schema contract violations, and business invariant rejections as *permanent* (immediately routed to DLQ without wasteful retries).
- **Exponential Backoff Retries**:
  - `executeWithRetry`: Configurable attempts (default 3) with exponential backoff delays (1s, 2s, 4s).
  - Immediately bypasses retries on non-transient errors.
- **Dead Letter Queue (DLQ) Router**:
  - `DlqRouter` publishes unprocessable messages to `<topic>.dlq`.
  - Injects 6 diagnostic headers for debugging:
    - `x-exception-message`: Root cause error message.
    - `x-source-topic`: Topic where the failure occurred.
    - `x-retry-count`: Number of failed retry attempts.
    - `x-timestamp`: RFC 3339 failure timestamp.
    - `x-original-partition`: Partition offset where message was read.
    - `x-original-offset`: Exact offset of the unprocessable record.
