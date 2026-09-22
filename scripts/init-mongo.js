// Initialize the single-node replica set
try {
    rs.initiate({
        _id: "rs0",
        members: [
            {
                _id: 0,
                host: "localhost:27017"
            }
        ]
    });
} catch (e) {
    print("Replica set initialization: " + e);
}

// Wait for the replica set to become PRIMARY
for (let i = 0; i < 30; i++) {
    try {
        if (db.adminCommand({ hello: 1 }).isWritablePrimary) {
            break;
        }
    } catch (e) {
        print("Waiting for PRIMARY...");
    }
    sleep(1000); 
}


// Customer Service database
db = db.getSiblingDB("customer_db");

db.createCollection("customers");

db.customers.createIndex(
    { email: 1 },
    { unique: true }
);

db.customers.createIndex(
    { location: "2dsphere" }
);


// Order Service database
db = db.getSiblingDB("order_db");

db.createCollection("orders");

db.orders.createIndex(
    { customerId: 1, createdAt: -1 }
);


// Restaurant Service database
db = db.getSiblingDB("restaurant_db");

db.createCollection("restaurants");

db.restaurants.createIndex(
    { location: "2dsphere" }
);


// Payment Service database
db = db.getSiblingDB("payment_db");

db.createCollection("payments");

db.payments.createIndex(
    { idempotencyKey: 1 },
    { unique: true }
);


// Delivery Service database
db = db.getSiblingDB("delivery_db");

db.createCollection("deliveries");
db.createCollection("drivers");


// Notification Service database
db = db.getSiblingDB("notification_db");

db.createCollection("notifications");

print("MongoDB initialization completed successfully.");
