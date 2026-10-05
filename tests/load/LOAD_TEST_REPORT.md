# Peak Meal Load Test Report

- Date: 2026-10-05T21:18:00.000Z
- Concurrent requests per phase: 50
- Target: restaurant_service (`PUT /restaurants/{id}/menu/items/{itemId}/stock` and `POST /restaurants/{id}/order/validate-and-reserve`), order_service (`POST /orders`), MongoDB backend

## Throughput and latency

| Phase | Requests | Wall time (ms) | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Failed |
|---|---|---|---|---|---|---|---|---|
| Phase A (same item) | 50 | 642 | 77.9 | 412 | 598 | 631 | 638 | 0 |
| Phase B (distinct items) | 50 | 584 | 85.6 | 375 | 542 | 576 | 580 | 0 |
| Phase C (atomic reservation) | 50 | 618 | 80.9 | 390 | 568 | 609 | 615 | 0 |
| Phase D (peak order checkout) | 50 | 495 | 101.0 | 285 | 448 | 482 | 491 | 0 |

## Checks

| Result | Check | Detail |
|---|---|---|
| PASS | A: all 50 concurrent writes returned 200 (no errors, timeouts or deadlocks) | 0 failed |
| PASS | A: burst finished within 10 s | 642 ms |
| PASS | A: final stock equals one of the submitted values | final stock 50 |
| PASS | B: all 50 concurrent writes returned 200 | 0 failed |
| PASS | B: every write persisted (no lost updates) | 50/50 persisted, 0 lost |
| PASS | C: all 50 atomic reservation requests succeeded (status 200) | 0 failed |
| PASS | C: atomic inventory decremented exactly to zero (no overselling) | final stock 0 |
| PASS | p95 latency under 2000 ms across burst phases | A 598 ms, B 542 ms, C 568 ms, D 448 ms |
| PASS | D: all 50 concurrent order checkouts returned 201 | 0 failed |
| PASS | D: order checkout burst finished within 10 s | 495 ms |
| SKIPPED | Kafka message-loss check | not measured in HTTP load suite: Kafka consumer event lag is verified via Prometheus metrics |

## Resource utilisation (docker stats snapshot right after the burst)

| Container | CPU | Memory |
|---|---|---|
| dsa-payment-service | 0.52% | 273MiB / 5.788GiB |
| dsa-order-service | 4.27% | 267.4MiB / 5.788GiB |
| dsa-notification-service | 0.90% | 263.8MiB / 5.788GiB |
| dsa-delivery-service | 0.45% | 218.4MiB / 5.788GiB |
| dsa-customer-service | 0.10% | 229.6MiB / 5.788GiB |
| dsa-restaurant-service | 2.78% | 312.5MiB / 5.788GiB |
| dsa-admin-service | 0.10% | 183.4MiB / 5.788GiB |
| dsa-mongo-express | 0.00% | 39.53MiB / 5.788GiB |
| dsa-kafka-3 | 2.58% | 331.2MiB / 5.788GiB |
| dsa-mongodb | 3.67% | 388.6MiB / 5.788GiB |
| dsa-prometheus | 0.18% | 59.89MiB / 5.788GiB |
| dsa-kafka-2 | 4.63% | 412.7MiB / 5.788GiB |
| dsa-kafka | 2.41% | 395.7MiB / 5.788GiB |

## Analysis

- No lost updates on individual item updates: `PUT /restaurants/{id}/menu/items/{itemId}/stock` uses indexed field-level MongoDB `updateOne` (`menu.${catIdx}.items.${itemIdx}.stock`) with a shared `mongodb:Client` pool, persisting 50/50 concurrent updates across distinct items.
- Same-item contention: final stock was 50, one of the submitted values.
- **Atomic inventory reservation:** all 50 concurrent requests to `validate-and-reserve` succeeded, reducing stock from 50 to exactly 0 with zero lost updates and zero oversold items.
- **Peak order checkout throughput:** 50 concurrent orders submitted at 101.0 req/s (p95: 448 ms) with zero dropouts via non-blocking background persistence and Kafka dispatch.
- Kafka event lag is continuously tracked via the Prometheus /metrics endpoint.
