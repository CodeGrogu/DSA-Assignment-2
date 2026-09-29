// MongoDB Initialization Script
// Databases, collections, indexes, and service users are provisioned during bootstrap.


// Customer Service database
db = db.getSiblingDB("customer_db");

db.createCollection("customers");

db.customers.createIndex(
    { email: 1 },
    { unique: true }
);

db.customers.createIndex(
    { "addresses.location": "2dsphere" }
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

db.drivers.createIndex(
    { location: "2dsphere" }
);


// Notification Service database
db = db.getSiblingDB("notification_db");

db.createCollection("notifications");


// Service users
db.getSiblingDB("customer_db").createUser({
    user: "customer_user",
    pwd: "customer_password",
    roles: [{ role: "readWrite", db: "customer_db" }]
});

db.getSiblingDB("order_db").createUser({
    user: "order_user",
    pwd: "order_password",
    roles: [{ role: "readWrite", db: "order_db" }]
});

db.getSiblingDB("restaurant_db").createUser({
    user: "restaurant_user",
    pwd: "restaurant_password",
    roles: [{ role: "readWrite", db: "restaurant_db" }]
});

db.getSiblingDB("payment_db").createUser({
    user: "payment_user",
    pwd: "payment_password",
    roles: [{ role: "readWrite", db: "payment_db" }]
});

db.getSiblingDB("delivery_db").createUser({
    user: "delivery_user",
    pwd: "delivery_password",
    roles: [{ role: "readWrite", db: "delivery_db" }]
});

db.getSiblingDB("notification_db").createUser({
    user: "notification_user",
    pwd: "notification_password",
    roles: [{ role: "readWrite", db: "notification_db" }]
});

print("MongoDB initialization completed successfully.");
