# Admin Domain Module (`peerpressure/admin_domain`)

The `admin_domain` module provides shared records, enumerations, notification subscription matrices, and SLA analytics models for the administration and notification services.

---

## 1. Domain Types & Models

### Notification Types
- `Severity`: `"INFO"` | `"WARN"` | `"CRITICAL"`
- `Channel` / `DeliveryChannel`: `"EMAIL"` | `"SMS"` | `"PUSH"`
- `RecipientRole`: `"CUSTOMER"` | `"RESTAURANT"` | `"DRIVER"`
- `NotificationPayload`: Closed record with message subject, body, channel, priority, and metadata.
- `NotificationAuditRecord`: Immutable audit trail entry stored in MongoDB.

### Analytics Types
- `PlatformOverview`: Platform-level KPIs including total orders, GMV, payment success rate, active deliveries, and average delivery time.
- `RestaurantReport`: Performance analytics per restaurant, tracking volume, revenue, preparation latency, and SLA breach counts.
- `DriverReport`: Performance analytics per courier, tracking assigned trips, completion rate, customer rating, and delivery latency.

---

## 2. Installation & Dependency

To use `peerpressure/admin_domain` in any Ballerina package:

```toml
[[dependency]]
org = "peerpressure"
name = "admin_domain"
version = "0.1.0"
repository = "local"
```

To build and publish locally:
```bash
bal pack
bal push --repository local
```
