db = db.getSiblingDB("customer_db");

db.createCollection("customers");
db.createCollection("restaurants");
db.createCollection("orders");
db.createCollection("payments");
db.createCollection("drivers");
db.createCollection("deliveries");
db.createCollection("notifications");

db.customers.createIndex(
  { email: 1 },
  { unique: true }
);

db.customers.createIndex(
  { location: "2dsphere" }
);

db.restaurants.createIndex(
  { location: "2dsphere" }
);

db.payments.createIndex(
  { idempotencyKey: 1 },
  { unique: true }
);
