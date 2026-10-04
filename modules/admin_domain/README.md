# admin_domain

Shared types and rules for notifications and admin analytics.

## What's in here

- `enums.bal` — Severity (INFO/WARN/CRITICAL), Channel (EMAIL/SMS/PUSH), RecipientRole (CUSTOMER/RESTAURANT/DRIVER)
- `notification_types.bal` — NotificationPayload, NotificationAuditRecord, SubscriptionRule
- `subscription_matrix.bal` — the "when X happens, notify Y" rules
- `analytics_types.bal` — PlatformOverview, RestaurantReport, DriverReport, DailyMetricsSnapshot

## How to use it

In a service `Ballerina.toml`, add:

```toml
[[dependency]]
org = "peerpressure"
name = "admin_domain"
version = "0.1.0"
repository = "local"
```
