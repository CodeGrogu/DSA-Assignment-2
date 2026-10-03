# Distributed Food Delivery Platform (Event-Driven Microservices)

[![CI Quality Gates](https://github.com/CodeGrogu/DSA-Assignment-2/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CodeGrogu/DSA-Assignment-2/actions/workflows/ci.yml)
[![CodeQL](https://github.com/CodeGrogu/DSA-Assignment-2/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/CodeGrogu/DSA-Assignment-2/actions/workflows/codeql.yml)
[![Linear Project](https://img.shields.io/badge/Linear-PEE--67_to_PEE--186-5E6AD2?logo=linear)](https://linear.app/peerpressure/project/distributed-food-delivery-platform-event-driven-microservices-83327d689776)
[![Ballerina](https://img.shields.io/badge/Ballerina-Swan_Lake_2201.13.5-20B6B0?logo=ballerina)](https://ballerina.io/)
[![Kafka](https://img.shields.io/badge/Kafka-KRaft_7.6.0-231F20?logo=apachekafka)](https://kafka.apache.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0-47A248?logo=mongodb)](https://www.mongodb.com/)

An in-progress distributed food delivery platform built with **Ballerina Swan Lake**, **Apache Kafka (KRaft mode)**, and **MongoDB** by the **Peer Pressure** team for **DSA612S: Distributed Systems & Applications (Assignment 2)**. Current implementation includes shared immutable event contracts, validation and tests, infrastructure Compose, and seven health-only service skeletons. Business endpoints, event producers/consumers, persistence, and the end-to-end order flow below are planned, not operational.

---

## 1. Planned System Architecture & C4 Diagrams

### 1.1 C4 Level 1: System Context Diagram

```mermaid
flowchart LR
    %% Styling Definitions
    classDef actorNode fill:#0b4884,stroke:#07325d,stroke-width:2px,color:#ffffff,font-family:sans-serif;
    classDef systemNode fill:#1168bd,stroke:#0b4884,stroke-width:2px,color:#ffffff,font-family:sans-serif;
    classDef clusterBox fill:none,stroke:#64748b,stroke-width:1.5px,stroke-dasharray: 4 4,color:#8b949e,font-family:sans-serif;

    subgraph Actors ["External System Actors"]
        direction TB
        customer["<b>Customer</b><br/>Places orders, tracks meals & receives alerts"]:::actorNode
        restaurant["<b>Restaurant Staff</b><br/>Manages catalogs, validates stock & prepares orders"]:::actorNode
        driver["<b>Delivery Driver</b><br/>Accepts dispatches, streams GPS & fulfills orders"]:::actorNode
        admin["<b>Platform Admin</b><br/>Monitors operations, revenue & SLA compliance"]:::actorNode
    end

    platform["<b>Distributed Food Delivery Platform</b><br/><i>[Event-Driven Microservices Architecture]</i><br/>Choreographs order placement, payment settlement, kitchen prep,<br/>and driver dispatch via Apache Kafka event streaming"]:::systemNode

    customer -->|"1. Orders & Payments<br/>(REST :9091)"| platform
    restaurant -->|"2. Kitchen Status & Menus<br/>(REST :9095)"| platform
    driver -->|"3. Delivery Status & GPS<br/>(REST :9096)"| platform
    admin -->|"4. Platform Analytics & SLAs<br/>(REST :9098)"| platform

    class Actors clusterBox;
```

### 1.2 C4 Level 2: Container Diagram & Event Choreography

```mermaid
flowchart TB
    classDef clientNode fill:#1f6feb,stroke:#388bfd,stroke-width:2px,color:#ffffff,font-family:sans-serif;
    classDef serviceNode fill:#0e706c,stroke:#20b6b0,stroke-width:2px,color:#ffffff,font-family:sans-serif;
    classDef kafkaNode fill:#b35900,stroke:#f0883e,stroke-width:2px,color:#ffffff,font-family:sans-serif;
    classDef mongoNode fill:#196c2e,stroke:#3fb950,stroke-width:2px,color:#ffffff,font-family:sans-serif;
    classDef clusterBox fill:none,stroke:#30363d,stroke-width:2px,stroke-dasharray: 4 4,color:#8b949e,font-family:sans-serif;

    subgraph Clients ["Client Applications & API Consumers"]
        direction LR
        clientApp["<b>Web & Mobile Applications</b><br/>Customer App • Restaurant Portal • Driver App • Admin Console"]:::clientNode
    end

    subgraph Cluster ["Ballerina Microservices Cluster (Swan Lake 2201.13.5)"]
        direction TB

        subgraph Tier1 ["Intake & Administration Tier"]
            direction LR
            orderSvc["<b>Order Service</b><br/><code>:9091</code><br/>Order Lifecycle FSM"]:::serviceNode
            custSvc["<b>Customer Service</b><br/><code>:9093</code><br/>Profiles & Addresses"]:::serviceNode
            adminSvc["<b>Admin Service</b><br/><code>:9098</code><br/>GMV & SLA Analytics"]:::serviceNode
        end

        subgraph Tier2 ["Operations & Fulfillment Tier"]
            direction LR
            paySvc["<b>Payment Service</b><br/><code>:9094</code><br/>Gateway & Ledger"]:::serviceNode
            restSvc["<b>Restaurant Service</b><br/><code>:9095</code><br/>Menus & Kitchen Prep"]:::serviceNode
            delSvc["<b>Delivery Service</b><br/><code>:9096</code><br/>Driver Dispatch & GPS"]:::serviceNode
            notifSvc["<b>Notification Service</b><br/><code>:9097</code><br/>Multi-Channel Alerts"]:::serviceNode
        end
    end

    subgraph Infra ["Shared Infrastructure Tier (Docker)"]
        direction LR
        kafka[("<b>Apache Kafka (KRaft)</b><br/><code>:29092 / :9092</code><br/>10 Partitioned Topics")]:::kafkaNode
        mongo[("<b>MongoDB 7.0</b><br/><code>:27017</code><br/>Document Collections")]:::mongoNode
    end

    clientApp -->|"HTTPS / REST Calls"| Cluster

    Cluster <==>|"Publish / Consume Events<br/>(orders.*, payments.*, delivery.*)"| kafka
    Cluster ==>|"State Persistence<br/>(TCP Driver :27017)"| mongo

    class Clients,Cluster,Tier1,Tier2,Infra clusterBox;
```

### 1.3 Planned Event Choreography Flow

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
| **Kafka KRaft Controller** | `29093` | - | PLAINTEXT | Quorum consensus (ZooKeeper-free) |
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

Event types are defined in shared contract library `peerpressure/events:0.1.0` in [`modules/events`](modules/events). Topics and publishers/consumers below describe planned integration; Compose does not provision topics yet. `OrderCreated` validation requires item subtotals to equal quantity × unit price and total amount to equal sum of item subtotals (no taxes or fees modeled).

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
- Python 3 (for the non-mutating, cross-platform formatting check)
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
# Response: {"status":"UP","service":"order_service","port":9091,"version":"0.1.0","contracts":"peerpressure/events:0.1.0"}
```

---

## 5. Team Attribution & Subsystem Ownership Matrix

**Organisation:** Peer Pressure | **Course:** DSA612S (Distributed Systems & Applications)  
**Institution:** Namibia University of Science and Technology (NUST)

Every team member has demonstrable code ownership across specific microservices, 5 parent issues, 10 subtasks, and 5 Pull Requests:

| Team Member | Student ID | GitHub Handle | Service / Domain Ownership | Milestone | Parents | Subtasks | Pull Requests | Linear Keys |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Jaden Awaseb** (Team Leader) | `224055054` | `@CodeGrogu` | **Order Service** & Monorepo Architecture | M1, M2, M4, M5 | #1 - #5 | #41 - #50 | #121 - #125 | `PEE-187`-`PEE-191` |
| **Henry Heita** | `223013692` | `@Henchoz` | **Kafka Infrastructure**, DLQ & Chaos | M1, M3, M4, M5 | #6 - #10 | #51 - #60 | #126 - #130 | `PEE-192`-`PEE-193`, `PEE-74`-`PEE-76` |
| **Florinda Immanuel** | `224082256` | `@Florriinnddaa` | **Customer Service** & MongoDB Persistence | M1, M2, M3, M5 | #11 - #15 | #61 - #70 | #131 - #135 | `PEE-77`-`PEE-81` |
| **Tapiwa Machekera** | `224059483` | `@Jerganov` | **Restaurant Service** & Kitchen Processing | M1, M2, M3, M5 | #16 - #20 | #71 - #80 | #136 - #140 | `PEE-82`-`PEE-86` |
| **Kondwani Kunkwenzu** | `224093894` | `@Kondwani112206`| **Payment Service**, Ledger & Saga Refunds | M1, M2, M4, M5 | #21 - #25 | #81 - #90 | #141 - #145 | `PEE-87`-`PEE-91` |
| **May-Lee Mulundu** | `223087858` | `@itsyagirlmay` | **Delivery Service** & Driver Dispatch | M1, M3, M4, M5 | #26 - #30 | #91 - #100 | #146 - #150 | `PEE-92`-`PEE-96` |
| **Liina Massipa** | `223114006` | `@LiinaMassipa` | **Notification Service** & Admin Analytics | M1, M3, M4, M5 | #31 - #35 | #101 - #110 | #151 - #155 | `PEE-97`-`PEE-101` |
| **Nangukuii Kangootui** | `224031066` | `@Nangukuii` | **E2E Testing**, Docker Compose & Defense | M1, M4, M5 | #36 - #40 | #111 - #120 | #156 - #160 | `PEE-102`-`PEE-106` |

---

## 6. Continuous Integration & Quality Gates

CI currently runs these five checks or reports (PR-specific jobs do not run on pushes):
1. **Ballerina Monorepo Quality Gate (`ballerina-ci`):** Topological build enforcing dry-run code formatting (`bal format -d`), automated unit test suites (`bal test`), package packing, local repository installation, and executable compilation (`bal build`). Service tests have not yet been implemented.
2. **Docker Compose Validation (`docker-compose-validate`):** Verifies configuration and matching network names across `docker-compose.infra.yml` and `docker/docker-compose.services.yml` without starting containers.
3. **Postman Shape Linting (`postman-lint`):** Checks basic Postman collection fields if collections exist.
4. **CodeQL Security Analysis (`codeql.yml`):** Uploads workflow supply-chain analysis results.
5. **PR Scope Report (`pr-scope-validate`):** Reports branch/issue mapping and changed files; does not enforce domain boundaries or deliverables.

The Ballerina job also builds the root workspace and smoke-tests Docker images, service health endpoints, and Kafka topic persistence on a Docker-enabled CI runner. The local `--check` formatter uses a temporary package copy so platform-specific line endings do not cause false failures or edit tracked sources.

---

## 7. Submission & Defense Schedule

- **Hard Code Freeze:** **05 October 2026, 23:59 CAT**
- **Oral Defense Window:** **N/A**
- **Repository:** [https://github.com/CodeGrogu/DSA-Assignment-2](https://github.com/CodeGrogu/DSA-Assignment-2)
- **Linear Workspace:** [https://linear.app/peerpressure](https://linear.app/peerpressure)
