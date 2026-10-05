# Delivery Service (`services/delivery_service`)

The **Delivery Service** manages delivery driver fleets, courier dispatch, geospatial tracking, and real-time transit state progression. It operates on HTTP port `9096`.

---

## 1. Responsibilities & Architecture

- **Driver Fleet Management**: Tracks courier profiles (`drv_001` .. `drv_008`), vehicle types (`MOTORCYCLE`, `CAR`, `BICYCLE`, `VAN`), availability (`AVAILABLE`, `BUSY`, `OFFLINE`), and live GPS coordinates.
- **Geospatial Proximity Dispatch**: Queries available couriers near the restaurant location using 2dsphere spherical geometry.
- **Delivery Lifecycle Progression**:
  Enforces delivery task transitions:
  `UNASSIGNED` → `DRIVER_ASSIGNED` → `AT_RESTAURANT` → `OUT_FOR_DELIVERY` → `DELIVERED`.
- **Dual-Layer Persistence**: Combines in-memory low-latency state tracking (`inMemoryDeliveries`) with MongoDB (`delivery_db.drivers` and `delivery_db.deliveries`) for persistent audit trails.
- **Live Tracking & Telemetry**: Exposes order tracking endpoints returning current coordinates and transit state.

---

## 2. HTTP Endpoints

| Method | Path | Description | Expected Response |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Microservice health check | `{"status": "UP", "service": "delivery_service", "port": 9096}` |
| `GET` | `/metrics` | Prometheus metrics scrape | Prometheus text metrics |
| `GET` | `/delivery/track/{orderId}` | Live GPS location and status | `{"deliveryId": "...", "orderId": "...", "status": "...", "currentLocation": {...}}` |
| `POST` | `/deliveries` | Create or update delivery state | `201 Created` with delivery record |

### Example Delivery Creation / Update Payload (`POST /deliveries`)
```json
{
  "orderId": "ORD-SEED-001",
  "deliveryId": "DEL-SEED-001",
  "driverId": "drv_001",
  "status": "OUT_FOR_DELIVERY",
  "currentLocation": {
    "latitude": -22.5609,
    "longitude": 17.0658
  }
}
```

---

## 3. Configuration (`Config.toml`)

```toml
[delivery_service]
port = 9096
kafkaBroker = "localhost:29092"   # In Docker: "kafka:9092"
mongoUri = "mongodb://delivery_user:delivery_password@localhost:27017/delivery_db?authSource=delivery_db"
```

Environment variable overrides:
- `KAFKA_BROKER`: Kafka host address.
- `MONGO_URI`: MongoDB connection string.
