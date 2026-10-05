# notification_service

Consumes events from Kafka and notifies customers, restaurants and drivers.

## Topics it listens to

- `orders.events`
- `payments.events`
- `kitchen.events`
- `delivery.events`

## Kafka

- Local: `localhost:29092`
- Inside docker-compose network: `kafka:9092`

## Running locally

Make sure infra is up:

```powershell
docker compose -f docker-compose.infra.yml up -d
```

## MongoDB

Audit records are stored in:

- Database: `notification_service`
- Collection: `audit`
- Connection: `mongodb://root:password@localhost:27017/?authSource=admin`

To browse locally, open Mongo Express at http://localhost:8086 (root / password).
