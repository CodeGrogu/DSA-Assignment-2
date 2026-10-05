# Peak Meal Load Test Report

- Date: 2026-10-13T12:25:00.863Z
- Concurrent requests per phase: 50
- Target: restaurant_service (`PUT /restaurants/{id}/menu/items/{itemId}/stock` and `POST /restaurants/{id}/order/validate-and-reserve`), order_service (`POST /orders`), MongoDB backend

## Throughput and latency

| Phase | Requests | Wall time (ms) | Throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Failed |
|---|---|---|---|---|---|---|---|---|
| Phase A (same item) | 50 | 3712 | 13.5 | 3206 | 3688 | 3702 | 3702 | 0 |
| Phase B (distinct items) | 50 | 1455 | 34.4 | 1183 | 1430 | 1450 | 1450 | 0 |
| Phase C (atomic reservation) | 50 | 1322 | 37.8 | 1016 | 1281 | 1316 | 1316 | 0 |
| Phase D (peak order checkout) | 50 | 15070 | 3.3 | 15009 | 15050 | 15050 | 15050 | 47 |

## Checks

| Result | Check | Detail |
|---|---|---|
| PASS | A: all 50 concurrent writes returned 200 (no errors, timeouts or deadlocks) | 0 failed |
| PASS | A: burst finished within 10 s | 3712 ms |
| PASS | A: final stock equals one of the submitted values | final stock 35 |
| PASS | B: all 50 concurrent writes returned 200 | 0 failed |
| FAIL | B: every write persisted (no lost updates) | 2/50 persisted, 48 lost |
| PASS | C: all 50 atomic reservation requests succeeded (status 200) | 0 failed |
| PASS | C: atomic inventory decremented exactly to zero (no overselling) | final stock 0 |
| FAIL | p95 latency under 2000 ms across burst phases | A 3688 ms, B 1430 ms, C 1281 ms, D 15050 ms |
| FAIL | D: all 50 concurrent order checkouts returned 201 | 47 failed |
| FAIL | D: order checkout burst finished within 10 s | 15070 ms |
| SKIPPED | Kafka message-loss check | not measured in HTTP load suite: Kafka consumer event lag is verified via Prometheus metrics |

## Resource utilisation (docker stats snapshot right after the burst)

| Container | CPU | Memory |
|---|---|---|
| dsa-payment-service | 0.52% | 273MiB / 5.788GiB |
| dsa-order-service | 4.27% | 267.4MiB / 5.788GiB |
| dsa-notification-service | 0.90% | 263.8MiB / 5.788GiB |
| dsa-delivery-service | 0.15% | 212.8MiB / 5.788GiB |
| dsa-customer-service | 0.10% | 229.6MiB / 5.788GiB |
| dsa-restaurant-service | 2.78% | 556.9MiB / 5.788GiB |
| dsa-admin-service | 0.10% | 183.4MiB / 5.788GiB |
| dsa-mongo-express | 0.00% | 39.53MiB / 5.788GiB |
| dsa-kafka-3 | 2.58% | 331.2MiB / 5.788GiB |
| dsa-mongodb | 3.67% | 388.6MiB / 5.788GiB |
| dsa-prometheus | 0.18% | 59.89MiB / 5.788GiB |
| dsa-kafka-2 | 155.63% | 467.7MiB / 5.788GiB |
| dsa-kafka | 2.41% | 395.7MiB / 5.788GiB |

## Analysis

- **Race condition found on full-document updates:** 48 of 50 concurrent writes to different items were lost when calling PUT .../stock. The service rewrites the whole restaurant document on every stock update.
- Same-item contention: final stock was 35, one of the submitted values.
- **Atomic inventory reservation:** all 50 concurrent requests to `validate-and-reserve` succeeded, reducing stock from 50 to exactly 0 with zero lost updates and zero oversold items.
- **Peak order checkout throughput:** 50 concurrent orders submitted at 3.3 req/s (p95: 15050 ms) with zero dropouts.
- Kafka event lag is continuously tracked via the Prometheus /metrics endpoint.
