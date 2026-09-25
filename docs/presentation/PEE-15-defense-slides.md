\# PEE-15 — NoSQL Data Modeling \& Customer Persistence



\## Peer Pressure — DSA Assignment 2



\---



\# Slide 1 — NoSQL Data Modeling \& Customer Persistence



\### Presentation Topics



\* Document-oriented schema design vs relational normalization

\* Geospatial `2dsphere` indexing and spatial lookup performance

\* Data consistency across microservice boundaries

\* Live customer account creation

\* Address management

\* Customer profile update

\* Order history

\* MongoDB database-state verification

\* Persistent storage

\* Replica-set configuration



\### Defense Introduction



> "This presentation demonstrates how our system uses MongoDB for NoSQL data storage and how the customer journey is persisted from the API layer into MongoDB. I will explain our document model, geospatial indexing, microservice data ownership, and the persistence evidence we collected."



\---



\# Slide 2 — Document-Oriented Schema vs Relational Normalization



\## Relational Database Approach



In a relational database:



\* Data is stored in tables.

\* Tables contain rows and columns.

\* Relationships are represented using foreign keys.

\* Data is commonly normalized to reduce duplication.

\* Related information may require JOIN operations.



\### Example Relational Design



```text

CUSTOMER

\---------

customer\_id

name

email

phone



ADDRESS

\---------

address\_id

customer\_id

street

city

state

postal\_code

```



The `customer\_id` connects the customer to their addresses.



\## MongoDB Document-Oriented Approach



MongoDB stores data as documents.



Our customer model embeds addresses inside the customer document.



```text

Customer

├── id

├── name

├── email

├── phone

└── addresses\[]

&#x20;   ├── id

&#x20;   ├── tag

&#x20;   ├── street

&#x20;   ├── city

&#x20;   ├── state

&#x20;   ├── postalCode

&#x20;   ├── location

&#x20;   ├── deliveryInstructions

&#x20;   └── isDefault

```



\### Defense Explanation



> "In a relational design, customer and address information would normally be stored in separate normalized tables and related using a foreign key. In our MongoDB design, addresses are embedded inside the customer document because they are closely related to the customer and are commonly accessed together."



\---



\# Slide 3 — Example MongoDB Customer Document



\## Example



```json

{

&#x20; "id": "CUST-001",

&#x20; "name": "Amelia Shilongo",

&#x20; "email": "amelia.shilongo@example.com",

&#x20; "phone": "+264810000001",

&#x20; "addresses": \[

&#x20;   {

&#x20;     "id": "ADDR-001",

&#x20;     "tag": "Home",

&#x20;     "street": "1 Independence Avenue",

&#x20;     "city": "Windhoek",

&#x20;     "state": "Khomas",

&#x20;     "postalCode": "10001",

&#x20;     "location": {

&#x20;       "type": "Point",

&#x20;       "coordinates": \[17.0658, -22.5609]

&#x20;     },

&#x20;     "isDefault": true

&#x20;   }

&#x20; ]

}

```



\## Important Parts



\### Customer information



```text

id

name

email

phone

```



\### Address information



```text

id

tag

street

city

state

postalCode

```



\### Geographic information



```text

location

&#x20;   type: Point

&#x20;   coordinates: \[longitude, latitude]

```



\### Why this model?



\* Customer and address information can be represented together.

\* Addresses are naturally related to one customer.

\* GeoJSON coordinates are stored directly with the address.

\* MongoDB supports nested documents and arrays.

\* The structure is convenient for customer-focused API operations.



\### Defense Explanation



> "The customer document contains the customer's basic information and an embedded addresses array. Each address also contains a GeoJSON Point, allowing MongoDB's geospatial indexing capabilities to be applied to customer locations."



\---



\# Slide 4 — Geospatial 2dsphere Indexing



\## Why use a 2dsphere index?



Our customer addresses contain geographic coordinates using GeoJSON.



MongoDB's `2dsphere` index supports geographic queries.



\## Our Index



```javascript

customerDb.customers.createIndex(

&#x20;   { "addresses.location": "2dsphere" }

);

```



The index is created on:



```text

addresses.location

```



using:



```text

2dsphere

```



\## Example Spatial Query



```javascript

{

&#x20; "addresses.location": {

&#x20;   "$nearSphere": {

&#x20;     "$geometry": {

&#x20;       "type": "Point",

&#x20;       "coordinates": \[17.0658, -22.5609]

&#x20;     },

&#x20;     "$maxDistance": 10000

&#x20;   }

&#x20; }

}

```



\### Query Meaning



```text

Longitude = 17.0658

Latitude  = -22.5609

Maximum distance = 10,000 metres

```



\### Defense Explanation



> "We use a 2dsphere index because our customer addresses contain geographic coordinates in GeoJSON format. This allows MongoDB to efficiently perform spatial searches such as finding addresses near a specified location."



\---



\# Slide 5 — Geospatial Query Performance



\## Using `explain()`



We used:



```javascript

explain("executionStats")

```



to determine whether MongoDB actually used the geospatial index.



\## Query Plan Result



```text

winningPlan:

&#x20; stage: GEO\_NEAR\_2DSPHERE



indexName:

&#x20; addresses.location\_2dsphere

```



\## Execution Statistics



```text

nReturned:

&#x20; 13



totalKeysExamined:

&#x20; 68



totalDocsExamined:

&#x20; 13



executionTimeMillis:

&#x20; 43

```



\## What does this prove?



\* `GEO\_NEAR\_2DSPHERE` confirms the geospatial execution strategy.

\* `addresses.location\_2dsphere` confirms that our 2dsphere index was selected.

\* 68 index keys were examined.

\* 13 documents were examined.

\* 13 documents were returned.

\* The query completed in 43 milliseconds in our test environment.



\### Important Note



The 43 ms result is a measurement from our current test dataset. It does not guarantee the same performance at a larger scale.



\### Defense Explanation



> "I used explain with executionStats to verify that the geospatial index was actually being used. The winning plan contains GEO\_NEAR\_2DSPHERE and the index name is addresses.location\_2dsphere. The query returned 13 documents, examined 68 index keys and 13 documents, and completed in 43 milliseconds in our test environment."



\---



\# Slide 6 — Data Consistency Across Microservice Boundaries



\## Service-Level Database Ownership



Our system separates data between services.



```text

Customer Service

&#x20;      │

&#x20;      └── customer\_db



Order Service

&#x20;      │

&#x20;      └── order\_db



Payment Service

&#x20;      │

&#x20;      └── payment\_db

```



Each service is responsible for its own database.



\## How consistency is maintained



\* Each microservice owns its relevant data.

\* A service updates its own database.

\* Services communicate through APIs and events.

\* Services do not directly modify another service's database.

\* Validation is performed before data is persisted.

\* This reduces coupling between services.



\## Example



```text

Customer Service

&#x20;      ↓

Customer created

&#x20;      ↓

Customer data persisted

&#x20;      ↓

API/Event communication

&#x20;      ↓

Other services process their own data

```



\### Defense Explanation



> "Instead of using one shared database transaction across all microservices, each service owns its own data. Services communicate through APIs and events. This gives each service clear ownership and reduces direct coupling between databases."



\---



\# Slide 7 — Live Customer Journey: Create Customer



\## Step 1 — Create Customer



\### API Request



```http

POST /customers

```



\### Example Request Body



```json

{

&#x20; "id": "API-TEST-001",

&#x20; "name": "API Test Customer",

&#x20; "email": "api.test.001@example.com",

&#x20; "phone": "+264810000099",

&#x20; "addresses": \[]

}

```



\### PowerShell Test



```powershell

$body = @{

&#x20;   id = "API-TEST-001"

&#x20;   name = "API Test Customer"

&#x20;   email = "api.test.001@example.com"

&#x20;   phone = "+264810000099"

&#x20;   addresses = @()

} | ConvertTo-Json



Invoke-RestMethod `

&#x20;   -Method Post `

&#x20;   -Uri http://localhost:9093/customers `

&#x20;   -ContentType "application/json" `

&#x20;   -Body $body

```



\### Result



The customer is created and stored in:



```text

customer\_db.customers

```



\### Defense Explanation



> "First, I send a POST request to the customers resource. The request contains the customer's ID, name, email, phone number and an empty addresses array. The Customer Service then persists this document to MongoDB."



\---



\# Slide 8 — Live Customer Journey: Add Address



\## Step 2 — Add Address



\### API Request



```http

POST /customers/API-TEST-001/addresses

```



\### Example Request Body



```json

{

&#x20; "id": "API-ADDR-001",

&#x20; "tag": "Home",

&#x20; "street": "1 Independence Avenue",

&#x20; "city": "Windhoek",

&#x20; "state": "Khomas",

&#x20; "postalCode": "10001",

&#x20; "location": {

&#x20;   "type": "Point",

&#x20;   "coordinates": \[17.0658, -22.5609]

&#x20; },

&#x20; "deliveryInstructions": "Leave at the front door",

&#x20; "isDefault": true

}

```



\### PowerShell Test



```powershell

$address = @{

&#x20;   id = "API-ADDR-001"

&#x20;   tag = "Home"

&#x20;   street = "1 Independence Avenue"

&#x20;   city = "Windhoek"

&#x20;   state = "Khomas"

&#x20;   postalCode = "10001"

&#x20;   location = @{

&#x20;       type = "Point"

&#x20;       coordinates = @(17.0658, -22.5609)

&#x20;   }

&#x20;   deliveryInstructions = "Leave at the front door"

&#x20;   isDefault = $true

} | ConvertTo-Json -Depth 5



Invoke-RestMethod `

&#x20;   -Method Post `

&#x20;   -Uri http://localhost:9093/customers/API-TEST-001/addresses `

&#x20;   -ContentType "application/json" `

&#x20;   -Body $address

```



\### Result



The address is added to the customer's:



```text

addresses\[]

```



array.



\### Defense Explanation



> "I then use the customer's ID in the URL to add an address. The address contains normal address information as well as GeoJSON coordinates. The service adds the address to the customer's embedded addresses array."



\---



\# Slide 9 — Live Customer Journey: Update Profile



\## Step 3 — Update Customer Profile



\### API Request



```http

PATCH /customers/API-TEST-001

```



\### Example Request Body



```json

{

&#x20; "name": "API Updated Customer",

&#x20; "phone": "+264810000088"

}

```



\### PowerShell Test



```powershell

$profile = @{

&#x20;   name = "API Updated Customer"

&#x20;   phone = "+264810000088"

} | ConvertTo-Json



Invoke-RestMethod `

&#x20;   -Method Patch `

&#x20;   -Uri http://localhost:9093/customers/API-TEST-001 `

&#x20;   -ContentType "application/json" `

&#x20;   -Body $profile

```



\### Result



```text

ID: API-TEST-001

Name: API Updated Customer

Phone: +264810000088

```



The updated customer remains stored in:



```text

customer\_db.customers

```



\### Defense Explanation



> "The PATCH request updates the customer's name and phone number. The service uses MongoDB's update operation to modify those fields and then retrieves the updated customer document."



\---



\# Slide 10 — Order History



\## Step 4 — Query Customer Order History



\### API Request



```http

GET /orders/customer/CUST-001

```



\### What does it do?



The request asks the Order Service to return orders belonging to customer:



```text

CUST-001

```



\### PowerShell Test



```powershell

Invoke-RestMethod http://localhost:9091/orders/customer/CUST-001

```



\### Actual Test Result



```text

Order ID: ORDER-TEST-001

Customer ID: CUST-001

Restaurant ID: REST-001

Total Amount: 50

Status: CREATED

Created At: 2026-09-25T19:00:00Z

```



\### Defense Explanation



> "The Order Service exposes an endpoint that retrieves orders for a particular customer. In our test, CUST-001 returned ORDER-TEST-001 with a total amount of 50 and status CREATED."



\---



\# Slide 11 — MongoDB State Verification



\## Verify the Order Directly in MongoDB



\### Command



```powershell

docker exec dsa-mongodb mongosh `

&#x20; -u root `

&#x20; -p password `

&#x20; --authenticationDatabase admin `

&#x20; --eval "db.getSiblingDB('order\_db').orders.findOne({orderId:'ORDER-TEST-001'})"

```



\### Example Result



```text

orderId: 'ORDER-TEST-001'

customerId: 'CUST-001'

restaurantId: 'REST-001'

totalAmount: 50

status: 'CREATED'

createdAt: '2026-09-25T19:00:00Z'

```



The MongoDB document also contains:



```text

items

deliveryAddress

customerId

restaurantId

status

createdAt

```



\## What This Demonstrates



```text

API Request

&#x20;    ↓

Order Service

&#x20;    ↓

MongoDB

&#x20;    ↓

Persisted Order Document

```



\### Defense Explanation



> "After receiving the API response, I verify the same order directly in MongoDB using its order ID. This confirms that the order returned by the API corresponds to a document persisted in the order database."



\---



\# Slide 12 — Customer Database Verification



\## Verify the Customer Directly in MongoDB



\### Command



```powershell

docker exec dsa-mongodb mongosh `

&#x20; -u root `

&#x20; -p password `

&#x20; --authenticationDatabase admin `

&#x20; --eval "db.getSiblingDB('customer\_db').customers.findOne({id:'API-TEST-001'})"

```



\### What should be visible?



```text

id:

API-TEST-001



name:

API Updated Customer



phone:

+264810000088



addresses:

\[

&#x20;   API-ADDR-001

]

```



The address contains:



```text

street

city

state

postalCode

location

deliveryInstructions

isDefault

```



\### Defense Explanation



> "I can also verify the customer directly in MongoDB. This confirms that the customer profile update and address addition were persisted in the customer document."



\---



\# Slide 13 — Persistent Storage



\## Docker Volume



MongoDB uses a named Docker volume:



```text

dsa-assignment-2\_mongo-data

```



mounted at:



```text

/data/db

```



\### Verified Mount



```text

Type: volume

Name: dsa-assignment-2\_mongo-data

Destination: /data/db

Driver: local

RW: true

```



\## Persistence Test



\### 1. Before Restart



We queried:



```text

ORDER-TEST-001

```



The document existed.



\### 2. Restart MongoDB



```powershell

docker restart dsa-mongodb

```



\### 3. Check Health



```powershell

docker inspect --format '{{.State.Health.Status}}' dsa-mongodb

```



Result:



```text

healthy

```



\### 4. Query the Same Order Again



```text

ORDER-TEST-001

```



The document was still present.



\### Same ObjectId



```text

6ab6e32cd4ebe1de4705a5b5

```



\### Defense Explanation



> "I verified persistence by querying ORDER-TEST-001 before restarting MongoDB. I restarted the container, waited until the health status returned to healthy, and queried the same order again. The document and its original ObjectId were still present. This demonstrates persistence through the Docker volume."



\---



\# Slide 14 — MongoDB Replica Set Status



\## Verification Command



```powershell

docker exec dsa-mongodb mongosh `

&#x20; -u root `

&#x20; -p password `

&#x20; --authenticationDatabase admin `

&#x20; --eval "rs.status().members"

```



\### Result



```text

name:

mongodb:27017



health:

1



state:

1



stateStr:

PRIMARY



self:

true

```



\## Interpretation



\### `health: 1`



The MongoDB member is healthy.



\### `stateStr: PRIMARY`



The current MongoDB member is the PRIMARY.



\### `self: true`



The MongoDB instance is reporting its own member status.



\## Important Limitation



The current development environment contains \*\*one replica-set member\*\*.



Therefore:



\* Replica-set mode is configured.

\* A PRIMARY state is demonstrated.

\* Multi-node replication is not being claimed.

\* Multi-node failover cannot be demonstrated with the current setup.



\### Defense Explanation



> "MongoDB is configured as a replica set and the current member is healthy and PRIMARY. Our development environment currently contains one member, so this demonstrates replica-set configuration and primary state rather than multi-node replication or failover."



\---



\# Slide 15 — Complete Customer Data Flow



\## Customer Journey



```text

Customer

&#x20;  ↓

POST /customers

&#x20;  ↓

Customer Service

&#x20;  ↓

customer\_db

&#x20;  ↓

Add Address

&#x20;  ↓

Embedded addresses\[]

&#x20;  ↓

GeoJSON Location

&#x20;  ↓

2dsphere Index

```



\## Order Journey



```text

Customer

&#x20;  ↓

Order Service

&#x20;  ↓

GET /orders/customer/{customerId}

&#x20;  ↓

order\_db

&#x20;  ↓

Order History

```



\## Database Verification



```text

API

&#x20;↓

Microservice

&#x20;↓

MongoDB

&#x20;↓

Persisted Document

```



\---



\# Slide 16 — Overall Defense Summary



\## NoSQL Data Modeling



\* MongoDB document-oriented design

\* Embedded customer addresses

\* Nested documents and arrays

\* GeoJSON location storage



\## Geospatial Indexing



\* `2dsphere` index

\* `$nearSphere` spatial query

\* `explain("executionStats")`

\* `GEO\_NEAR\_2DSPHERE`

\* `addresses.location\_2dsphere`



\## Microservice Consistency



\* Service-level database ownership

\* API/event communication

\* Controlled persistence

\* Reduced database coupling



\## Customer Workflow



\* Customer registration

\* Address addition

\* Profile update

\* Order history query

\* MongoDB state verification



\## Persistence



\* Named Docker volume

\* Successful container restart

\* Data retained after restart

\* MongoDB health restored



\## Replica Set



\* Replica-set configuration

\* Healthy PRIMARY state

\* Single-member development environment



\---



\# Slide 17 — Final Defense Statement



> "Our MongoDB design uses a document-oriented structure that keeps customer information and related addresses together. We use GeoJSON and a 2dsphere index to support geographic queries, and we verified the index usage through MongoDB execution statistics. Each microservice owns its database and communicates through controlled APIs and events rather than directly modifying another service's database. During the live demonstration, we create a customer, add an address, update the profile, retrieve order history, and verify the persisted state directly in MongoDB. We also demonstrated that the data survives a MongoDB container restart because the database uses persistent Docker storage."



\---



\# LIVE DEFENSE COMMAND CHECKLIST



\## 1. Start MongoDB



```powershell

docker compose -f docker-compose.infra.yml up -d mongodb

```



\## 2. Check MongoDB Health



```powershell

docker inspect --format '{{.State.Health.Status}}' dsa-mongodb

```



Expected:



```text

healthy

```



\## 3. Start Customer Service



```powershell

bal run services\\customer\_service

```



Customer Service:



```text

Port 9093

```



\## 4. Start Order Service



```powershell

bal run services\\order\_service

```



Order Service:



```text

Port 9091

```



\## 5. Create Customer



```powershell

$body = @{

&#x20;   id = "API-TEST-001"

&#x20;   name = "API Test Customer"

&#x20;   email = "api.test.001@example.com"

&#x20;   phone = "+264810000099"

&#x20;   addresses = @()

} | ConvertTo-Json



Invoke-RestMethod `

&#x20;   -Method Post `

&#x20;   -Uri http://localhost:9093/customers `

&#x20;   -ContentType "application/json" `

&#x20;   -Body $body

```



\## 6. Add Address



```powershell

$address = @{

&#x20;   id = "API-ADDR-001"

&#x20;   tag = "Home"

&#x20;   street = "1 Independence Avenue"

&#x20;   city = "Windhoek"

&#x20;   state = "Khomas"

&#x20;   postalCode = "10001"

&#x20;   location = @{

&#x20;       type = "Point"

&#x20;       coordinates = @(17.0658, -22.5609)

&#x20;   }

&#x20;   deliveryInstructions = "Leave at the front door"

&#x20;   isDefault = $true

} | ConvertTo-Json -Depth 5



Invoke-RestMethod `

&#x20;   -Method Post `

&#x20;   -Uri http://localhost:9093/customers/API-TEST-001/addresses `

&#x20;   -ContentType "application/json" `

&#x20;   -Body $address

```



\## 7. Update Profile



```powershell

$profile = @{

&#x20;   name = "API Updated Customer"

&#x20;   phone = "+264810000088"

} | ConvertTo-Json



Invoke-RestMethod `

&#x20;   -Method Patch `

&#x20;   -Uri http://localhost:9093/customers/API-TEST-001 `

&#x20;   -ContentType "application/json" `

&#x20;   -Body $profile

```



\## 8. Retrieve Order History



```powershell

Invoke-RestMethod http://localhost:9091/orders/customer/CUST-001

```



\## 9. Verify Customer in MongoDB



```powershell

docker exec dsa-mongodb mongosh `

&#x20; -u root `

&#x20; -p password `

&#x20; --authenticationDatabase admin `

&#x20; --eval "db.getSiblingDB('customer\_db').customers.findOne({id:'API-TEST-001'})"

```



\## 10. Verify Order in MongoDB



```powershell

docker exec dsa-mongodb mongosh `

&#x20; -u root `

&#x20; -p password `

&#x20; --authenticationDatabase admin `

&#x20; --eval "db.getSiblingDB('order\_db').orders.findOne({orderId:'ORDER-TEST-001'})"

```



\## 11. Check Replica Set



```powershell

docker exec dsa-mongodb mongosh `

&#x20; -u root `

&#x20; -p password `

&#x20; --authenticationDatabase admin `

&#x20; --eval "rs.status().members"

```



\## 12. Check Customer Indexes



```powershell

docker exec dsa-mongodb mongosh `

&#x20; -u root `

&#x20; -p password `

&#x20; --authenticationDatabase admin `

&#x20; --eval "db.getSiblingDB('customer\_db').customers.getIndexes()"

```



\---



\# QUESTIONS THE LECTURER MAY ASK



\## Why did you choose MongoDB?



> "MongoDB is suitable because our customer data contains nested information such as addresses. The document model allows related information to be represented together, and it also supports GeoJSON and geospatial indexes."



\## Why embed addresses?



> "Addresses belong directly to a customer and are commonly accessed with customer information. Embedding them keeps related data together and avoids an additional join-style lookup."



\## Why use a 2dsphere index?



> "The addresses contain geographic coordinates using GeoJSON. The 2dsphere index is designed for geographic queries and allows MongoDB to efficiently perform spatial searches."



\## How do you know the index was used?



> "I used explain with executionStats. The winning plan contained GEO\_NEAR\_2DSPHERE and the index name was addresses.location\_2dsphere."



\## What does `$nearSphere` do?



> "It performs a geographic proximity query around a specified GeoJSON point. In our example, we search within a maximum distance of 10,000 metres."



\## What does `totalKeysExamined` mean?



> "It represents the number of index keys MongoDB examined during query execution. In our test, 68 index keys were examined."



\## What does `totalDocsExamined` mean?



> "It represents the number of documents MongoDB examined. In our test, 13 documents were examined."



\## What does `executionTimeMillis: 43` mean?



> "The query took 43 milliseconds in our test environment. It is a measurement for our current dataset and is not a guarantee of production performance."



\## How do your microservices maintain consistency?



> "Each microservice owns its own data. Services communicate through APIs and events instead of directly modifying another service's database. This gives each service clear ownership of its data."



\## Do you have multi-node MongoDB replication?



> "The current development environment is configured as a MongoDB replica set with one PRIMARY member. Therefore, we can demonstrate the replica-set configuration and PRIMARY state, but we are not claiming multi-node replication or failover."



\## How did you prove persistence?



> "I queried ORDER-TEST-001, restarted the MongoDB container, waited for the container to become healthy, and queried the same order again. The document and its ObjectId were still present. The database uses the named Docker volume dsa-assignment-2\_mongo-data mounted at /data/db."



\## How do you add a customer?



> "The customer is added through the Customer Service API using POST /customers. The request contains the customer ID, name, email, phone and addresses."



\## How do you add an address?



> "I send a POST request to /customers/{customerId}/addresses with the address information and GeoJSON coordinates."



\## How do you update a customer?



> "I use PATCH /customers/{customerId} and provide the fields that need to be updated, such as name and phone."



\## How do you retrieve a customer's orders?



> "I use GET /orders/customer/{customerId}. The Order Service queries order\_db for orders matching that customer ID."



\---



\# FINAL LIVE DEMONSTRATION FLOW



```text

1\. Start MongoDB

&#x20;       ↓

2\. Check MongoDB health

&#x20;       ↓

3\. Start Customer Service

&#x20;       ↓

4\. Start Order Service

&#x20;       ↓

5\. Create customer

&#x20;       ↓

6\. Add customer address

&#x20;       ↓

7\. Update customer profile

&#x20;       ↓

8\. Retrieve order history

&#x20;       ↓

9\. Verify customer in MongoDB

&#x20;       ↓

10\. Verify order in MongoDB

&#x20;       ↓

11\. Show 2dsphere index

&#x20;       ↓

12\. Show explain() evidence

&#x20;       ↓

13\. Show replica-set status

&#x20;       ↓

14\. Explain persistent Docker volume

```



\# Final Takeaway



> "The demonstration shows the complete path from the customer API to persistent MongoDB data, while demonstrating document-oriented modeling, geospatial indexing, microservice data ownership, query-plan evidence, and persistent storage."



