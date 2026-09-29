# Live Demonstration Walkthrough: Customer Journey Lifecycle

**Team:** Peer Pressure  
**Module:** Customer Service & Persistence Defense  
**Linear Issue:** `PEE-81` (Subtask `PEE-135` / Subtask #69)

---

## 1. Overview & Objectives

This walkthrough provides a step-by-step evaluator script demonstrating the end-to-end customer journey lifecycle on the **Distributed Food Delivery Platform**.

It validates:
1. Customer registration with schema validation and conflict detection (`409 Conflict`).
2. Profile lookup and profile update.
3. Multi-address delivery location management with strict Namibia geographic bounding.
4. Setting a default delivery address.
5. Internal checkout address resolution and delivery feasibility checking (`POST /customers/verify-address`).
6. Paginated customer past order history query (`GET /customers/{id}/orders`).
7. Address deletion.

---

## 2. Prerequisites & Environment Setup

Ensure the infrastructure and `customer_service` are running:

```bash
# 1. Start MongoDB replica set
docker compose -f docker-compose.infra.yml up -d mongodb

# 2. Verify replica set PRIMARY status
docker exec -it dsa-mongodb mongosh -u acehood3556_db_user -p AWkhv04ohWCtc2cl --authenticationDatabase admin --eval "rs.status().members[0].stateStr"

# 3. Start Customer Service (port 9093)
cd services/customer_service
bal run
```

---

## 3. Step-by-Step Live Demonstration Script

### Step 1: Health Check Verification
Verify service availability and contract compatibility:
```bash
curl -i -X GET http://localhost:9093/health
```
**Expected Response:** `HTTP/1.1 200 OK`
```json
{
  "status": "UP",
  "service": "customer_service",
  "port": 9093,
  "version": "0.1.0",
  "contracts": "peerpressure/events:0.1.0"
}
```

---

### Step 2: New Customer Account Registration
Register a new customer profile located in Windhoek, Namibia:
```bash
curl -i -X POST http://localhost:9093/customers \
  -H "Content-Type: application/json" \
  -d '{
    "id": "CUST-DEMO-001",
    "name": "Ester Shikongo",
    "email": "ester.shikongo@example.com",
    "phone": "+264819876543",
    "addresses": [
      {
        "id": "ADDR-DEMO-001",
        "tag": "Home",
        "street": "14 Bach Street",
        "city": "Windhoek",
        "state": "Khomas",
        "postalCode": "10001",
        "location": {
          "type": "Point",
          "coordinates": [17.0755, -22.5645]
        },
        "deliveryInstructions": "Ring the bell at gate 2",
        "isDefault": true
      }
    ]
  }'
```
**Expected Response:** `HTTP/1.1 201 Created` returning the saved customer object.

---

### Step 3: Duplicate Email Conflict Detection
Attempt registering the same email address again to prove duplicate prevention:
```bash
curl -i -X POST http://localhost:9093/customers \
  -H "Content-Type: application/json" \
  -d '{
    "id": "CUST-DEMO-002",
    "name": "Duplicate Tester",
    "email": "ester.shikongo@example.com",
    "phone": "+264811112222",
    "addresses": []
  }'
```
**Expected Response:** `HTTP/1.1 409 Conflict`
```json
{
  "message": "Customer email already exists"
}
```

---

### Step 4: Customer Profile Retrieval
Retrieve the persisted customer profile by ID:
```bash
curl -i -X GET http://localhost:9093/customers/CUST-DEMO-001
```
**Expected Response:** `HTTP/1.1 200 OK` with full customer profile details.

---

### Step 5: Add Secondary Delivery Address (Work Address)
Add a second delivery location (Work) in central Windhoek:
```bash
curl -i -X POST http://localhost:9093/customers/CUST-DEMO-001/addresses \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ADDR-DEMO-002",
    "tag": "Work",
    "street": "10 Independence Avenue",
    "city": "Windhoek",
    "state": "Khomas",
    "postalCode": "10005",
    "location": {
      "type": "Point",
      "coordinates": [17.0841, -22.5692]
    },
    "deliveryInstructions": "Deliver to reception desk, 3rd floor",
    "isDefault": false
  }'
```
**Expected Response:** `HTTP/1.1 201 Created`

---

### Step 6: Geographic Boundary Validation (Rejection Outside Namibia)
Attempt adding an address located outside Namibian territorial boundaries (e.g. London, UK):
```bash
curl -i -X POST http://localhost:9093/customers/CUST-DEMO-001/addresses \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ADDR-INVALID",
    "tag": "Abroad",
    "street": "10 Downing Street",
    "city": "London",
    "state": "UK",
    "postalCode": "SW1A2AA",
    "location": {
      "type": "Point",
      "coordinates": [-0.1276, 51.5074]
    },
    "deliveryInstructions": "",
    "isDefault": false
  }'
```
**Expected Response:** `HTTP/1.1 400 Bad Request`
```json
{
  "message": "Longitude is outside Namibia"
}
```

---

### Step 7: Update Default Delivery Address
Switch default delivery location to the Work address:
```bash
curl -i -X PUT http://localhost:9093/customers/CUST-DEMO-001/addresses/default \
  -H "Content-Type: application/json" \
  -d '{
    "addressId": "ADDR-DEMO-002"
  }'
```
**Expected Response:** `HTTP/1.1 200 OK` confirming `ADDR-DEMO-002` now has `isDefault: true` while `ADDR-DEMO-001` has `isDefault: false`.

---

### Step 8: Update Customer Contact Profile
Update the customer's contact phone number:
```bash
curl -i -X PUT http://localhost:9093/customers/CUST-DEMO-001 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ester Shikongo-Amutenya",
    "phone": "+264819998877"
  }'
```
**Expected Response:** `HTTP/1.1 200 OK` reflecting updated contact name and phone.

---

### Step 9: Delivery Address Feasibility Check
Validate whether an order checkout address is reachable within delivery radius:
```bash
curl -i -X POST http://localhost:9093/customers/verify-address \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "CUST-DEMO-001",
    "address": {
      "id": "ADDR-DEMO-001",
      "tag": "Home",
      "street": "14 Bach Street",
      "city": "Windhoek",
      "state": "Khomas",
      "postalCode": "10001",
      "location": {
        "type": "Point",
        "coordinates": [17.0755, -22.5645]
      },
      "deliveryInstructions": "Ring the bell",
      "isDefault": false
    }
  }'
```
**Expected Response:** `HTTP/1.1 200 OK`
```json
{
  "valid": true,
  "withinDeliveryRange": true,
  "distanceKm": 1.13,
  "message": "Address is within delivery range"
}
```

---

### Step 10: Query Customer Order History
Query paginated order history:
```bash
curl -i -X GET "http://localhost:9093/customers/CUST-DEMO-001/orders?limit=5&offset=0"
```
**Expected Response:** `HTTP/1.1 200 OK` returning an array of past orders.

---

### Step 11: Delete Delivery Address
Remove secondary address `ADDR-DEMO-002`:
```bash
curl -i -X DELETE http://localhost:9093/customers/CUST-DEMO-001/addresses/ADDR-DEMO-002
```
**Expected Response:** `HTTP/1.1 200 OK`
```json
{
  "message": "Address deleted successfully"
}
```
