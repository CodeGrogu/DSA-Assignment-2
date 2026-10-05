# Delivery Domain Module (`peerpressure/delivery_domain`)

The `delivery_domain` module provides shared types, geospatial coordinate validation, courier state machines, and lifecycle transitions for the delivery service and dispatch workflows.

---

## 1. Domain Types & State Machines

### Courier Types
- `DriverAvailability`: `"AVAILABLE"` | `"BUSY"` | `"OFFLINE"`
- `DriverState`: `"AVAILABLE"` | `"ASSIGNED"` | `"DELIVERING"` | `"OFFLINE"`
- `VehicleCategory`: `"CAR"` | `"MOTORCYCLE"` | `"BICYCLE"` | `"VAN"`
- `LocationCoordinates`: Decimal `latitude` and `longitude` records.
- `Driver`: Canonical courier profile with vehicle category, live coordinates, and availability.

### Delivery Lifecycle
- `DeliveryTaskStatus`:
  `"UNASSIGNED"` → `"DRIVER_ASSIGNED"` → `"AT_RESTAURANT"` → `"OUT_FOR_DELIVERY"` → `"DELIVERED"`
- `DeliveryTask`: Canonical delivery assignment record linking `deliveryId`, `orderId`, `driverId`, status, and transit timestamps.
- `isValidDeliveryTransition`: Pure validator preventing invalid or backwards status transitions.
- `transitionDelivery`: Executes transition returning updated `DeliveryTask` or structured error.

---

## 2. Geospatial Validation

- `isValidCoordinates(LocationCoordinates coords)`: Validates that coordinates fall within standard geographic boundaries and specific Namibian operational zones.
- `isValidDriver(Driver driver)`: Validates required ID, non-empty phone, and valid vehicle category.

---

## 3. Installation & Dependency

```toml
[[dependency]]
org = "peerpressure"
name = "delivery_domain"
version = "0.1.0"
repository = "local"
```
