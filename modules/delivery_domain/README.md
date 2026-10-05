# delivery_domain

Shared domain models, validations, and state machine transitions for the delivery service and dispatch workflows.

## What's in here

- `models.bal` — `DriverAvailability`, `DriverState`, `VehicleCategory`, `DeliveryTaskStatus`, `LocationCoordinates`, `Driver`, `DeliveryTask`
- `state_machine.bal` — Delivery task status constants and transition logic (`isValidDeliveryTransition`, `transitionDelivery`)
- `validation.bal` — Validation functions for geographic coordinates (`isValidCoordinates`) and driver records (`isValidDriver`)

## How to use it

In a service `Ballerina.toml`, add:

```toml
[[dependency]]
org = "peerpressure"
name = "delivery_domain"
version = "0.1.0"
repository = "local"
```
