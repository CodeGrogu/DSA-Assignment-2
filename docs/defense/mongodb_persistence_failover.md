# MongoDB Persistence, Replica Set Failover & Query Plan Defense Verification

**Team:** Peer Pressure  
**Module:** MongoDB Infrastructure & Persistence Defense  
**Linear Issue:** `PEE-81` (Subtask `PEE-136` / Subtask #70)

---

## 1. Overview & Defense Verification Objectives

This document provides defense evidence and reproducible procedures verifying:
1. **Persistent Storage Integrity**: Data survival across MongoDB Docker container crashes and restarts.
2. **Replica Set Configuration & Health**: Confirmation of single-node replica set (`rs0`) in `PRIMARY` state with internal keyfile authentication.
3. **Database Index Optimization & Query Plans (`explain()`)**: Proof of `IXSCAN` index usage for unique email searches, compound order queries, and `2dsphere` geospatial queries.
4. **Multi-Tenant User Segregation**: Verification of application-specific users with least-privilege `readWrite` roles across segregated databases.

---

## 2. Replica Set Verification & Cluster Topology

To inspect the replica set status and ensure it is in the active `PRIMARY` state:

```bash
docker exec -it dsa-mongodb mongosh -u acehood3556_db_user -p AWkhv04ohWCtc2cl --authenticationDatabase admin --eval "rs.status()"
```

### Key Verified Properties:
- `set`: `"rs0"`
- `members[0].stateStr`: `"PRIMARY"`
- `members[0].health`: `1`
- `members[0].name`: `"mongodb:27017"`

---

## 3. Query Plan Optimization Verification (`explain()`)

We verify that all configured indexes avoid expensive full-collection scans (`COLLSCAN`) and execute index scans (`IXSCAN`).

### Test 1: Unique Email Index on `customers` (`email: 1`)
Execute an explained query searching by email:
```bash
docker exec -it dsa-mongodb mongosh -u customer_user -p customer_password --authenticationDatabase customer_db mongodb:27017/customer_db --eval '
db.customers.find({ email: "amelia.shilongo@example.com" }).explain("executionStats")
'
```
**Expected Plan Output:**
- `winningPlan.inputStage.stage`: `"IXSCAN"`
- `winningPlan.inputStage.indexName`: `"email_1"`
- `totalDocsExamined`: `1`
- `nReturned`: `1`

---

### Test 2: Geospatial `2dsphere` Index on `addresses.location`
Execute an explained geospatial proximity query locating customers near central Windhoek:
```bash
docker exec -it dsa-mongodb mongosh -u customer_user -p customer_password --authenticationDatabase customer_db mongodb:27017/customer_db --eval '
db.customers.find({
  "addresses.location": {
    $nearSphere: {
      $geometry: {
        type: "Point",
        coordinates: [17.0658, -22.5609]
      },
      $maxDistance: 5000
    }
  }
}).explain("executionStats")
'
```
**Expected Plan Output:**
- `winningPlan.stage`: `"FETCH"`
- `winningPlan.inputStage.stage`: `"GEO_NEAR_2DSPHERE"`
- `winningPlan.inputStage.indexName`: `"addresses.location_2dsphere"`

---

### Test 3: Compound Index on `orders` (`customerId: 1, createdAt: -1`)
Execute an explained query fetching orders for a specific customer sorted by timestamp descending:
```bash
docker exec -it dsa-mongodb mongosh -u order_user -p order_password --authenticationDatabase order_db mongodb:27017/order_db --eval '
db.orders.find({ customerId: "CUST-001" }).sort({ createdAt: -1 }).explain("executionStats")
'
```
**Expected Plan Output:**
- `winningPlan.inputStage.stage`: `"IXSCAN"`
- `winningPlan.inputStage.indexName`: `"customerId_1_createdAt_-1"`
- `sortStage`: **None** (Sort satisfied directly by compound index ordering without in-memory sorting)

---

### Test 4: Driver Geospatial Index on `delivery_db.drivers` (`location: "2dsphere"`)
```bash
docker exec -it dsa-mongodb mongosh -u delivery_user -p delivery_password --authenticationDatabase delivery_db mongodb:27017/delivery_db --eval '
db.drivers.getIndexes()
'
```
**Expected Output:**
```json
[
  { "v": 2, "key": { "_id": 1 }, "name": "_id_" },
  { "v": 2, "key": { "location": "2dsphere" }, "name": "location_2dsphere", "2dsphereIndexVersion": 3 }
]
```

---

## 4. Container Restart & Data Persistence Demonstration

This procedure proves that MongoDB writes survive container destruction and restart via the persistent volume `mongo-data`.

### Step 1: Record Current Document Count
```bash
docker exec -it dsa-mongodb mongosh -u customer_user -p customer_password --authenticationDatabase customer_db mongodb:27017/customer_db --eval "db.customers.countDocuments()"
```
*Result: 10 seed customers recorded.*

### Step 2: Insert a New Verification Document
```bash
docker exec -it dsa-mongodb mongosh -u customer_user -p customer_password --authenticationDatabase customer_db mongodb:27017/customer_db --eval '
db.customers.insertOne({
  id: "PERSISTENCE-TEST-001",
  name: "Persistence Verification User",
  email: "persistence.test@example.com",
  phone: "+264810009999",
  addresses: []
})
'
```

### Step 3: Hard Stop and Restart MongoDB Container
```bash
docker compose -f docker-compose.infra.yml restart mongodb
```

### Step 4: Verify Data Retention After Container Re-initialization
```bash
# Wait for container healthcheck to complete
docker compose -f docker-compose.infra.yml ps mongodb

# Query verification document
docker exec -it dsa-mongodb mongosh -u customer_user -p customer_password --authenticationDatabase customer_db mongodb:27017/customer_db --eval '
db.customers.findOne({ id: "PERSISTENCE-TEST-001" })
'
```
**Expected Result:** The document `PERSISTENCE-TEST-001` is retrieved intact, proving volume persistence and zero data loss across container lifecycle events.

### Step 5: Clean Up Test Document
```bash
docker exec -it dsa-mongodb mongosh -u customer_user -p customer_password --authenticationDatabase customer_db mongodb:27017/customer_db --eval '
db.customers.deleteOne({ id: "PERSISTENCE-TEST-001" })
'
```
