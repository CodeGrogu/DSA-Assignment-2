# Metrics Package (`peerpressure/metrics`)

Prometheus and OpenMetrics telemetry registry and exposition library for the Distributed Food Delivery Platform microservices.

---

## 1. Capabilities

- **Thread-Safe In-Memory Metrics Registry**:
  - `Counters`: Tracks request counts, message counts, error occurrences.
  - `Gauges`: Tracks active connections, memory, driver counts, stock levels.
  - `Histograms`: Observes latencies across HTTP endpoints and message handling.
  - `Consumer Lag`: Monitors consumer group offset lag across Kafka partitions.
- **OpenMetrics & Prometheus Exposition**:
  - Formats metrics into standard `# HELP` and `# TYPE` exposition lines.
  - Exposes `getMetricsResponse()` returning an `http:Response` with `text/plain; version=0.0.4; charset=utf-8` ready for Prometheus scrapers.

---

## 2. Usage

```ballerina
import peerpressure/metrics;

// Record HTTP request telemetry
metrics:recordHttpRequest("GET", "/health", 200, 15.5d, "order_service");

// Record Kafka event processing latency
metrics:recordMessageLatency("orders.created", 22.0d, "order_service");

// Set Kafka consumer lag metric
metrics:setConsumerLagMetric("order_service_group", "orders.created", 0);
```
