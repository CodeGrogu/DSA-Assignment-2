# Restaurant Service (`services/restaurant_service`)

The **Restaurant Service** manages dining venues, menus, operating hours, stock reservations, and kitchen order processing. It operates on HTTP port `9095`.

---

## 1. Responsibilities & Architecture

- **Catalog & Menu Management**: Houses detailed restaurant listings (e.g. Kapana Corner, Namibian Potjie Kitchen) with categorised menus, pricing in Namibian Dollars (NAD), 15% VAT, and dietary tags (`Vegetarian`, `Vegan`, `Halal`, `High-Protein`, `Gluten-Free`).
- **Inventory & Stock Decrement**: Atomically verifies and deducts menu stock using standard `mongodb:Update` operators (`{"inc": {"menu.items.$.stock": -qty}}`) with optimistic concurrency guards to prevent overselling.
- **Geospatial Location**: Stores 2dsphere GeoJSON points (`[longitude, latitude]`) for proximity matching and radius-based delivery calculations.
- **Unconditional Baseline Seeding**: Automatically populates canonical Namibian restaurants on startup or via `seedDatabase()`, wiping prior data to guarantee an accurate baseline state.
- **Kafka Event Choreography**:
  - **Consumes**: `orders.confirmed` (triggers stock reservation and kitchen cooking).
  - **Emits**: `orders.preparing` (food is on the grill/in the pot), `kitchen.orders.ready` (food packaged, ready for courier dispatch).

---

## 2. HTTP Endpoints

| Method | Path | Description | Expected Response |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Microservice health check | `{"status": "UP", "service": "restaurant_service", "port": 9095}` |
| `GET` | `/metrics` | Prometheus metrics scrape | Prometheus text metrics |
| `GET` | `/restaurants` | List all active restaurants | Array of `Restaurant` objects |
| `GET` | `/restaurants/{id}` | Get restaurant profile & menu | `Restaurant` record or `404` |
| `GET` | `/restaurants/{id}/menu` | Get categorized menu items | Array of categories and menu items |
| `POST` | `/restaurants/{id}/orders/{orderId}/prepare` | Manually mark order as preparing | `{"status": "PREPARING", "orderId": "..."}` |
| `POST` | `/restaurants/{id}/orders/{orderId}/ready` | Manually mark kitchen order ready | `{"status": "READY", "orderId": "..."}` |

---

## 3. Configuration (`Config.toml`)

```toml
[restaurant_service]
port = 9095
kafkaBroker = "localhost:29092"   # In Docker: "kafka:9092"
mongoUri = "mongodb://restaurant_user:restaurant_password@localhost:27017/restaurant_db?authSource=restaurant_db"
```

Environment variable overrides:
- `KAFKA_BROKER`: Kafka bootstrap host.
- `MONGO_URI`: MongoDB connection URI.

---

## 4. Canonical Seed Overrides

The service ships with built-in canonical restaurant fixtures for Windhoek and Swakopmund. When running `scripts/seed-platform.js` or initializing the service, any prior or stale restaurant records in `restaurant_db.restaurants` are unconditionally wiped and replaced with the verified catalog.
