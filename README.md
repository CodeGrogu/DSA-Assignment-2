# Distributed Food Delivery Platform (Event-Driven Microservices)

[![CI Quality Gates](https://github.com/CodeGrogu/DSA-Assignment-2/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CodeGrogu/DSA-Assignment-2/actions/workflows/ci.yml)
[![CodeQL](https://github.com/CodeGrogu/DSA-Assignment-2/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/CodeGrogu/DSA-Assignment-2/actions/workflows/codeql.yml)
[![Linear Project](https://img.shields.io/badge/Linear-PEE--67_to_PEE--186-5E6AD2?logo=linear)](https://linear.app/peerpressure/project/distributed-food-delivery-platform-event-driven-microservices-83327d689776)
[![Ballerina](https://img.shields.io/badge/Ballerina-Swan_Lake_2201.13.5-20B6B0?logo=ballerina)](https://ballerina.io/)
[![Kafka](https://img.shields.io/badge/Kafka-KRaft_7.6.0-231F20?logo=apachekafka)](https://kafka.apache.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0-47A248?logo=mongodb)](https://www.mongodb.com/)

An enterprise-grade, distributed, event-driven food delivery platform engineered with **Ballerina Swan Lake**, **Apache Kafka (KRaft mode)**, and **MongoDB**. Built by the **Peer Pressure** team for **DSA612S: Distributed Systems & Applications (Assignment 2)**.

---

## 1. System Architecture & C4 Diagrams

### 1.1 C4 Level 1: System Context Diagram

```mermaid
C4Context
    title System Context Diagram - Distributed Food Delivery Platform

    Person(customer, "Customer", "Places orders, tracks status, and receives notifications.")
    Person(restaurant, "Restaurant Staff", "Accepts orders, updates preparation stages, and manages menus.")
    Person(driver, "Delivery Driver", "Accepts delivery assignments, updates delivery status and GPS coordinates.")
    Person(admin, "Platform Admin", "Monitors platform health, restaurant revenue, and driver SLA performance.")

    System(platform, "Distributed Food Delivery Platform", "Choreographs order placement, payment settlement, kitchen prep, and driver dispatch via event streaming.")

    Rel(customer, platform, "Browses menus, places orders, makes payments via REST API")
    Rel(restaurant, platform, "Updates order preparation and inventory via REST API")
    Rel(driver, platform, "Updates delivery tracking & GPS coordinates via REST API")
    Rel(admin, platform, "Inspects analytics, GMV, and SLA metrics via REST API")
```

### 1.2 C4 Level 2: Container Diagram & Event Choreography

```mermaid
C4Container
    title Container Architecture & Kafka Event Choreography

    Container(orderSvc, "Order Service", "Ballerina (:9091)", "FSM state machine managing order lifecycles (CREATED -> DELIVERED).")
    Container(custSvc, "Customer Service", "Ballerina (:9093)", "Customer profile, delivery address validation, and order history.")
    Container(restSvc, "Restaurant Service", "Ballerina (:9095)", "Restaurant catalog, inventory validation, and kitchen prep emitter.")
    Container(paySvc, "Payment Service", "Ballerina (:9094)", "Payment gateway simulation, transaction ledger, and refund compensation.")
    Container(delSvc, "Delivery Service", "Ballerina (:9096)", "Proximity-based driver matching and real-time delivery tracking.")
    Container(notifSvc, "Notification Service", "Ballerina (:9097)", "Multi-channel event consumer & persistent notification audit logger.")
    Container(adminSvc, "Admin Service", "Ballerina (:9098)", "Aggregates GMV, revenue shares, driver turnaround, and SLA breach metrics.")

    ContainerDb(kafka, "Apache Kafka (KRaft)", "Docker (:29092 / :9092)", "High-throughput, persistent event backbone with 10 partitioned topics.")
    ContainerDb(mongo, "MongoDB 7.0", "Docker (:27017)", "Persistent document store for order, customer, ledger, and restaurant data.")

    Rel(orderSvc, kafka, "Emits orders.created, orders.cancelled", "Kafka Producer")
    Rel(kafka, paySvc, "Consumes orders.created", "Kafka Consumer")
    Rel(paySvc, kafka, "Emits payments.completed, payments.failed", "Kafka Producer")
    Rel(kafka, orderSvc, "Consumes payments.completed -> CONFIRMED", "Kafka Consumer")
    Rel(kafka, restSvc, "Consumes payments.completed -> PREPARING", "Kafka Consumer")
    Rel(restSvc, kafka, "Emits orders.ready", "Kafka Producer")
    Rel(kafka, delSvc, "Consumes orders.ready -> driver assigned", "Kafka Consumer")
    Rel(delSvc, kafka, "Emits delivery.assigned, delivery.status", "Kafka Producer")
    Rel(kafka, notifSvc, "Subscribes to all domain events", "Kafka Consumer")
    Rel(orderSvc, mongo, "Persists orders & audit logs", "MongoDB Driver")
    Rel(custSvc, mongo, "Persists customer profiles", "MongoDB Driver")
```

### 1.3 Event Choreography Flow

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant OrderSvc as Order Service (:9091)
    participant Kafka as Apache Kafka (:29092)
    participant PaySvc as Payment Service (:9094)
    participant RestSvc as Restaurant Service (:9095)
    participant DelSvc as Delivery Service (:9096)
    participant NotifSvc as Notification Service (:9097)

    Customer->>OrderSvc: POST /orders (Create Order)
    OrderSvc->>Kafka: Emit OrderCreatedEvent (orders.created)
    Kafka-->>PaySvc: Consume OrderCreatedEvent
    PaySvc->>PaySvc: Process Payment Simulation
    PaySvc->>Kafka: Emit PaymentCompletedEvent (payments.completed)
    Kafka-->>OrderSvc: Consume PaymentCompletedEvent (Transition -> CONFIRMED)
    Kafka-->>RestSvc: Consume PaymentCompletedEvent (Kitchen -> PREPARING)
    RestSvc->>Kafka: Emit KitchenReadyEvent (orders.ready)
    Kafka-->>DelSvc: Consume KitchenReadyEvent (Match & Assign Driver)
    DelSvc->>Kafka: Emit DeliveryAssignedEvent (delivery.assigned)
    DelSvc->>Kafka: Emit DeliveryStatusUpdateEvent (delivery.status: DELIVERED)
    Kafka-->>OrderSvc: Transition -> DELIVERED
    Kafka-->>NotifSvc: Multi-topic Consumer Dispatches Customer/Driver Alerts
```

---

## 2. Zero-Collision Port Allocation Scheme

To prevent network port collisions between local host processes, Docker infrastructure, and microservices on developer workstations, all endpoints are mapped strictly according to the following registry:

| Component / Service | Internal Port | Host Port | Protocol | Purpose & Collision Safeguard |
| :--- | :---: | :---: | :---: | :--- |
| **Kafka Broker (Host Listener)** | `29092` | `29092` | PLAINTEXT_HOST | **Avoids collision with standard host Kafka port 9092** |
| **Kafka Broker (Internal)** | `9092` | `9092` | PLAINTEXT | High-speed inter-container communication on bridge network |
| **Kafka KRaft Controller** | `29093` | — | PLAINTEXT | Quorum consensus (ZooKeeper-free) |
| **Kafka UI Dashboard** | `8080` | `8085` | HTTP | Web management dashboard for topics and consumer groups |
| **MongoDB Primary** | `27017` | `27017` | TCP | Document storage for entity collections & ledgers |
| **Mongo Express UI** | `8081` | `8086` | HTTP | Interactive MongoDB web browser |
| **Order Service** | `9091` | `9091` | HTTP REST | Order intake, state machine, and customer query API |
| **Customer Service** | `9093` | `9093` | HTTP REST | Customer profile, addresses, and order history |
| **Payment Service** | `9094` | `9094` | HTTP REST | Payment simulation, transaction ledger, and refunds |
| **Restaurant Service** | `9095` | `9095` | HTTP REST | Menu catalog, operating hours, and stock management |
| **Delivery Service** | `9096` | `9096` | HTTP REST | Driver matching, dispatching, and tracking lifecycle |
| **Notification Service** | `9097` | `9097` | HTTP REST | Alert dispatching simulation and audit log API |
| **Admin Service** | `9098` | `9098` | HTTP REST | Executive analytics, GMV calculation, and SLA breach reports |

---

## 3. Kafka Topic Taxonomy & Schema Registry

All events are strongly typed via the shared contract library `codegrogu/events:0.1.0` in [`modules/events`](file:///modules/events):

| Topic Name | Partitions | Key Strategy | Emitted By | Primary Consumers | Event Record Type |
| :--- | :---: | :--- | :--- | :--- | :--- |
| `orders.created` | 3 | `customerId` | Order Service | Payment Service, Notification Service | `OrderCreatedEvent` |
| `orders.confirmed` | 3 | `orderId` | Order Service | Notification Service, Admin Service | `OrderConfirmedEvent` |
| `orders.cancelled` | 3 | `orderId` | Order Service | Payment Service (Refunds), Notification | `OrderCancelledEvent` |
| `payments.completed` | 3 | `orderId` | Payment Service | Order Service, Restaurant Service | `PaymentCompletedEvent` |
| `payments.failed` | 3 | `orderId` | Payment Service | Order Service (Abort FSM), Notification | `PaymentFailedEvent` |
| `orders.preparing` | 3 | `restaurantId`| Restaurant Service | Order Service, Notification Service | `KitchenPreparingEvent` |
| `orders.ready` | 3 | `restaurantId`| Restaurant Service | Delivery Service (Driver Dispatch) | `KitchenReadyEvent` |
| `delivery.assigned` | 3 | `driverId` | Delivery Service | Order Service, Notification Service | `DeliveryAssignedEvent` |
| `delivery.status` | 3 | `orderId` | Delivery Service | Order Service, Notification, Admin | `DeliveryStatusUpdateEvent` |
| `notifications.dispatched` | 3 | `recipientId` | Notification Service | Audit Logger, Admin Analytics | `NotificationEvent` |

---

## 4. Local Development Quickstart

### 4.1 Prerequisites
- [Ballerina Swan Lake](https://ballerina.io/downloads/) `2201.13.5`
- [Docker & Docker Compose](https://docs.docker.com/compose/)
- [Bun](https://bun.sh/) (strictly no npm)

### 4.2 Step 1: Clone and Configure Environment
```bash
git clone https://github.com/CodeGrogu/DSA-Assignment-2.git
cd DSA-Assignment-2

# Copy environment configuration
cp .env.example .env
```

### 4.3 Step 2: Bootstrap Local Infrastructure
Start Apache Kafka (KRaft mode) and MongoDB:
```bash
docker compose -f docker-compose.infra.yml up -d
```
Verify infrastructure health:
- **Kafka UI:** [http://localhost:8085](http://localhost:8085)
- **Mongo Express:** [http://localhost:8086](http://localhost:8086) (User: `root`, Password: `password`)

### 4.4 Step 3: Build & Install Shared Event Contracts
In the Ballerina monorepo, shared packages in `modules/` must be installed locally before microservices can compile:
```bash
cd modules/events
bal test
bal pack
bal push --repository local
cd ../..
```

### 4.5 Step 4: Build Microservices
Build all microservices:
```bash
# Example: Build Order Service
cd services/order_service
bal test
bal build
bal run
```

Test health check:
```bash
curl http://localhost:9091/health
# Response: {"status":"UP","service":"order_service","port":9091,"version":"0.1.0","contracts":"codegrogu/events:0.1.0"}
```

---

## 5. Team Attribution & Subsystem Ownership Matrix

Every team member has demonstrable code ownership across specific microservices, 5 parent issues, 10 subtasks, and 5 Pull Requests:

| Team Member | GitHub Handle | Service / Domain Ownership | Milestone | Parents | Subtasks | Pull Requests | Linear Keys |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Jaden Awaseb** | `@CodeGrogu` | **Order Service** & Monorepo Architecture | M1, M2, M4, M5 | #1 – #5 | #41 – #50 | #121 – #125 | `PEE-67`–`PEE-71` |
| **Henry Heita** | `@Henchoz` | **Kafka Infrastructure**, DLQ & Chaos | M1, M3, M4, M5 | #6 – #10 | #51 – #60 | #126 – #130 | `PEE-72`–`PEE-76` |
| **Florinda Funya** | `@Florriinnddaa` | **Customer Service** & MongoDB Persistence | M1, M2, M3, M5 | #11 – #15 | #61 – #70 | #131 – #135 | `PEE-77`–`PEE-81` |
| **Tapiwa Kelvin** | `@Jerganov` | **Restaurant Service** & Kitchen Processing | M1, M2, M3, M5 | #16 – #20 | #71 – #80 | #136 – #140 | `PEE-82`–`PEE-86` |
| **Kondwani Kunkwenzu** | `@Kondwani112206`| **Payment Service**, Ledger & Saga Refunds | M1, M2, M4, M5 | #21 – #25 | #81 – #90 | #141 – #145 | `PEE-87`–`PEE-91` |
| **Mayleenda** | `@itsyagirlmay` | **Delivery Service** & Driver Dispatch | M1, M3, M4, M5 | #26 – #30 | #91 – #100 | #146 – #150 | `PEE-92`–`PEE-96` |
| **Liina Massipa** | `@LiinaMassipa` | **Notification Service** & Admin Analytics | M1, M3, M4, M5 | #31 – #35 | #101 – #110 | #151 – #155 | `PEE-97`–`PEE-101` |
| **Nangu Tjizoo** | `@Nangukuii` | **E2E Testing**, Docker Compose & Defense | M1, M4, M5 | #36 – #40 | #111 – #120 | #156 – #160 | `PEE-102`–`PEE-106` |

---

## 6. Continuous Integration & Quality Gates

Every Pull Request and commit to `main` is validated by four automated quality gates:
1. **Ballerina Monorepo Quality Gate (`ballerina-ci`):** Topological build enforcing code formatting (`bal format`), automated unit test suites (`bal test`), package packing, local repository installation, and executable compilation (`bal build`).
2. **Docker Compose Validation (`docker-compose-validate`):** Verifies syntax, healthchecks, networks, and environment variables across `docker-compose.infra.yml` and `docker-compose.yml`.
3. **Postman Schema Linting (`postman-lint`):** Validates Postman collection JSON schemas using Bun.
4. **CodeQL Security Analysis (`codeql.yml`):** Analyzes workflow supply-chain security.
5. **PR Domain Scope Verification (`pr-scope-validate`):** Dynamically audits each Pull Request against designated domain boundaries and deliverables.

---

## 7. Submission & Defense Schedule

- **Hard Code Freeze:** **05 October 2026, 23:59 CAT**
- **Oral Defense Window:** **N/A**
- **Repository:** [https://github.com/CodeGrogu/DSA-Assignment-2](https://github.com/CodeGrogu/DSA-Assignment-2)
- **Linear Workspace:** [https://linear.app/peerpressure](https://linear.app/peerpressure)
