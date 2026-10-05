# Admin Service (`services/admin_service`)

The **Admin Service** provides high-level executive analytics, operational KPIs, SLA breach detection, and system health reporting for platform administrators and operations teams. It operates on HTTP port `9098`.

---

## 1. Responsibilities & Architecture

- **Platform KPI Overview**: Computes platform Gross Merchandise Value (GMV in NAD), total order volumes, successful vs failed payment counts, average delivery duration, and active deliveries.
- **SLA Breach Monitoring**:
  - **Restaurant SLA**: Monitors preparation duration against service thresholds (e.g., alert if prep time exceeds 30 minutes).
  - **Driver SLA**: Monitors delivery fulfillment times, driver ratings, and completed trips.
- **Configurable Seed Data Loader**: Dynamically loads seed datasets (`seed_data.json`, `data/seed_platform.json`, or environment path `SEED_DATA_PATH`) to provide rich analytical dashboards and baseline metrics.
- **Prometheus Telemetry**: Scrapes and aggregates internal service metrics to expose `/metrics` for Grafana dashboards.

---

## 2. HTTP Endpoints

| Method | Path | Description | Expected Response |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Microservice health check | `{"status": "UP", "service": "admin_service", "port": 9098}` |
| `GET` | `/metrics` | Prometheus metrics scrape | Prometheus text metrics |
| `GET` | `/admin/stats/overview` | Executive platform metrics | `PlatformOverview` JSON (totalOrders, gmv, successRate, etc.) |
| `GET` | `/admin/sla/restaurants` | Restaurant performance report | Array of `RestaurantReport` items with SLA breaches |
| `GET` | `/admin/sla/drivers` | Driver performance report | Array of `DriverReport` items with trip stats |

### Example Platform Overview Response (`GET /admin/stats/overview`)
```json
{
  "totalOrders": 14,
  "completedOrders": 10,
  "cancelledOrders": 2,
  "inFlightOrders": 2,
  "grossMerchandiseValue": 2045.75,
  "successfulPayments": 12,
  "failedPayments": 1,
  "refundedPayments": 1,
  "activeDeliveries": 2,
  "averageDeliveryTimeMinutes": 32.5
}
```

---

## 3. Configuration & Seed Path

The seed loader searches the following locations in order:
1. `SEED_DATA_PATH` (environment variable)
2. `Config.toml` configured `seedDataPath`
3. `./seed_data.json`
4. `services/admin_service/seed_data.json`
5. `admin_service/seed_data.json`
