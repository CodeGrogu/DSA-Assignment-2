# Metrics Package (`peerpressure/metrics`)

Prometheus and OpenMetrics registry and exposition support for the Distributed Food Delivery Platform microservices.

## Overview
This package provides a thread-safe in-memory `MetricsRegistry` supporting:
- Counters (`incrementCounter`)
- Gauges (`setGauge`)
- Histograms (`observeLatency`)
- Kafka Consumer Lag tracking (`setConsumerLag`)
- OpenMetrics / Prometheus Exposition format exporter (`exportPrometheus`, `getMetricsResponse`)

## Usage
```ballerina
import peerpressure/metrics;

metrics:recordHttpRequest("GET", "/health", 200, 15.5d, "order_service");
metrics:recordMessageLatency("orders.created", 22.0d, "order_service");
metrics:setConsumerLagMetric("order_service_group", "orders.created", 0);
```
