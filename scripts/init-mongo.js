// MongoDB infrastructure initialization for the DSA project.
// Creates the replica set, required collections, and indexes.

try {
  rs.status();
  print("Replica set already initialized.");
} catch (e) {
  rs.initiate({
    _id: "rs0",
    members: [
      {
        _id: 0,
        host: "mongodb:27017"
      }
    ]
  });

  print("Replica set initialized.");
}

function ensureCollection(database, collectionName) {
  if (!database.getCollectionNames().includes(collectionName)) {
    database.createCollection(collectionName);
    print("Created collection: " + database.getName() + "." + collectionName);
  }
}

// Customer database
const customerDb = db.getSiblingDB("customer_db");

ensureCollection(customerDb, "customers");

customerDb.customers.createIndex(
  { email: 1 },
  { unique: true }
);

customerDb.customers.createIndex(
  { "addresses.location": "2dsphere" }
);

// Restaurant database
const restaurantDb = db.getSiblingDB("restaurant_db");

ensureCollection(restaurantDb, "restaurants");

restaurantDb.restaurants.createIndex(
  { location: "2dsphere" }
);

// Order database
const orderDb = db.getSiblingDB("order_db");

ensureCollection(orderDb, "orders");

// Payment database
const paymentDb = db.getSiblingDB("payment_db");

ensureCollection(paymentDb, "payments");

paymentDb.payments.createIndex(
  { idempotencyKey: 1 },
  { unique: true }
);

// Delivery database
const deliveryDb = db.getSiblingDB("delivery_db");

ensureCollection(deliveryDb, "drivers");
ensureCollection(deliveryDb, "deliveries");

deliveryDb.drivers.createIndex(
  { location: "2dsphere" }
);

// Notification database
const notificationDb = db.getSiblingDB("notification_db");

ensureCollection(notificationDb, "notifications");

print("MongoDB infrastructure initialization completed.");