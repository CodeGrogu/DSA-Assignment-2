# Docker Infrastructure & Service Orchestration (`docker/`)

Standardized containerization artifacts and multi-service orchestration for the Distributed Food Delivery Platform.

---

## 1. Directory Structure & Files

- `docker/Dockerfile.service`: Multi-stage reusable containerfile based on `eclipse-temurin:21-jre-jammy` executing compiled Ballerina `.jar` microservices under non-root user `ballerina` (UID 10001).
- `docker/docker-compose.services.yml`: Microservices orchestration manifest wiring all 7 services to the shared `dsa-network` bridge.
- `docker-compose.infra.yml` (Root): Shared infrastructure manifest provisioning Apache Kafka (KRaft mode 3-broker cluster), Kafka UI, MongoDB 7.0 Replica Set, Mongo Express, Prometheus, and Grafana.

---

## 2. Infrastructure & Port Mapping Registry

| Container Name | Service | Internal Port | Host Port | Web Dashboard / Probe |
| :--- | :--- | :---: | :---: | :--- |
| `dsa-kafka` | Kafka Broker 1 (KRaft) | `9092` | `29092` | Kafka Broker (Primary) |
| `dsa-kafka-2` | Kafka Broker 2 (KRaft) | `9092` | `29094` | Kafka Broker 2 |
| `dsa-kafka-3` | Kafka Broker 3 (KRaft) | `9092` | `29096` | Kafka Broker 3 |
| `dsa-kafka-ui` | Kafka UI Dashboard | `8080` | `8085` | http://localhost:8085 |
| `dsa-mongodb` | MongoDB 7.0 (rs0) | `27017` | `27017` | Replica Set `rs0` |
| `dsa-mongo-express` | Mongo Express Web UI | `8081` | `8086` | http://localhost:8086 (`root`/`password`) |
| `dsa-prometheus` | Prometheus Telemetry | `9090` | `9090` | http://localhost:9090 |
| `dsa-grafana` | Grafana Dashboards | `3000` | `3001` | http://localhost:3001 (`admin`/`admin`) |
| `dsa-order-service` | Order Service | `9091` | `9091` | http://localhost:9091/health |
| `dsa-customer-service` | Customer Service | `9093` | `9093` | http://localhost:9093/health |
| `dsa-payment-service` | Payment Service | `9094` | `9094` | http://localhost:9094/health |
| `dsa-restaurant-service` | Restaurant Service | `9095` | `9095` | http://localhost:9095/health |
| `dsa-delivery-service` | Delivery Service | `9096` | `9096` | http://localhost:9096/health |
| `dsa-notification-service` | Notification Service | `9097` | `9097` | http://localhost:9097/health |
| `dsa-admin-service` | Admin Service | `9098` | `9098` | http://localhost:9098/health |

---

## 3. Quickstart & Deployment

### Step 1: Launch Infrastructure
```bash
docker compose -f docker-compose.infra.yml up -d
```

### Step 2: Build & Start All Microservices
```bash
# 1. Compile Ballerina workspace binaries
bal build

# 2. Build and launch all 7 services
docker compose -f docker-compose.infra.yml -f docker/docker-compose.services.yml up -d --build
```

---

## 4. Seeding Database (Unconditional Override)

To reset all databases to canonical baseline inside Docker:
```bash
docker exec -i dsa-mongodb mongosh -u root -p password --authenticationDatabase admin < scripts/seed-platform.js
```
This purges all prior records and creates fresh canonical datasets with indexes.
