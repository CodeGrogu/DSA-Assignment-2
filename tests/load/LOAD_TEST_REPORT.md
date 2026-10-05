# Peak Meal Load Test Report

- Date: 2026-10-16T11:20:00.000Z
- Concurrent requests per phase: 50
- Target: restaurant_service (`PUT /restaurants/{id}/menu/items/{itemId}/stock` and `POST /restaurants/{id}/order/validate-and-reserve`), order_service (`POST /orders`), MongoDB backend

## Historical Pre-Remediation vs Post-Remediation Summary

Prior to remediation (run `2026-10-13T10:34:41.519Z`), whole-document replacement in `restaurant_service` and per-request `mongodb:Client` instantiation caused `48/50` lost updates in Phase B and `47/50` failed requests under 50-client burst contention.

Following the remediation in `restaurant_service/db.bal` and `service.bal`:
1. **Singleton `mongodb:Client` Connection Pool**: All services now reuse a shared `mongodb:Client` instance rather than creating a new pool per request.
2. **Atomic Positional `$inc` & `$set` Updates**: Stock updates and reservations use targeted positional field updates (`menu.${catIdx}.items.${itemIdx}.stock`) with `$gte` atomic guards and multi-item compensating rollback.
3. **CAT (`UTC+2`) Operating-Hours Alignment & 7-Day Seed Schedule**: All 5 seeded restaurants (`R001`–`R005`) are configured with full Monday–Sunday operating hours in CAT (`UTC+2`).
4. **Thread-Safe Kafka Producer & MongoDB Read-Through**: `order_service` synchronizes `self.producer` inside a `lock` block and merges MongoDB documents into `listAll()`, `getByCustomer()`, and `getUnfulfilledOrderCount()`.
