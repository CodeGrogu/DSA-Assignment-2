# Docker Configurations (`docker/`)

Standardized containerization artifacts for the Distributed Food Delivery Platform microservices.

## Directory Structure

* `docker/Dockerfile.service`: Reusable production containerfile based on `eclipse-temurin:17-jre-jammy` executing compiled Ballerina `.jar` services under non-root user `ballerina` (UID 10001).
* `docker/docker-compose.services.yml`: Microservices orchestration manifest wiring all 7 services to the shared `dsa-network` bridge.

## Quickstart

### 1. Build Microservice Binaries
Before building containers, compile the Ballerina executables:
```bash
# Compile entire workspace
bal build
```

### 2. Launch Supporting Infrastructure
Ensure Kafka and MongoDB are running:
```bash
docker compose -f docker-compose.infra.yml up -d
```

### 3. Launch Microservices Cluster
```bash
docker compose -f docker/docker-compose.services.yml up -d --build
```

### 4. Verify Endpoints
* Order Service: `http://localhost:9091/health`
* Customer Service: `http://localhost:9093/health`
* Payment Service: `http://localhost:9094/health`
* Restaurant Service: `http://localhost:9095/health`
* Delivery Service: `http://localhost:9096/health`
* Notification Service: `http://localhost:9097/health`
* Admin Service: `http://localhost:9098/health`
