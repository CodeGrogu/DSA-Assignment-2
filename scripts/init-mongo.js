// MongoDB Initialization Script
// Databases, collections, indexes, and service users are provisioned during bootstrap.

function ensureCollection(database, collectionName) {
    if (!database.getCollectionNames().includes(collectionName)) {
        database.createCollection(collectionName);
        print("Created collection: " + database.getName() + "." + collectionName);
    }
}

function ensureUser(databaseName, username, password, roles) {
    const targetDb = db.getSiblingDB(databaseName);
    try {
        targetDb.createUser({
            user: username,
            pwd: password,
            roles: roles
        });
        print("Created user: " + username + " on " + databaseName);
    } catch (e) {
        if (e.message && (e.message.includes("already exists") || e.code === 51003)) {
            targetDb.updateUser(username, { pwd: password, roles: roles });
            print("Updated existing user: " + username + " on " + databaseName);
        } else {
            throw e;
        }
    }
}

// Customer Service database
const customerDb = db.getSiblingDB("customer_db");
ensureCollection(customerDb, "customers");
customerDb.customers.createIndex(
    { email: 1 },
    { unique: true }
);
customerDb.customers.createIndex(
    { "addresses.location": "2dsphere" }
);

// Order Service database
const orderDb = db.getSiblingDB("order_db");
ensureCollection(orderDb, "orders");
orderDb.orders.createIndex(
    { customerId: 1, createdAt: -1 }
);

// Restaurant Service database
const restaurantDb = db.getSiblingDB("restaurant_db");
ensureCollection(restaurantDb, "restaurants");
restaurantDb.restaurants.createIndex(
    { location: "2dsphere" }
);

// Payment Service database
const paymentDb = db.getSiblingDB("payment_db");
ensureCollection(paymentDb, "payments");
paymentDb.payments.createIndex(
    { idempotencyKey: 1 },
    { unique: true }
);

// Payment service v2 uses multiple immutable transactions per order for refunds.
const paymentsDb = db.getSiblingDB("payments_db");
if (paymentsDb.getCollectionNames().includes("transactions")) {
    const legacyOrderIndex = paymentsDb.transactions.getIndexes().find(
        index => index.name === "orderId_1" && index.unique === true
    );
    if (legacyOrderIndex) {
        paymentsDb.transactions.dropIndex(legacyOrderIndex.name);
    }
}
ensureCollection(paymentsDb, "transactions");
ensureCollection(paymentsDb, "ledger_entries");
ensureCollection(paymentsDb, "idempotency_keys");
paymentsDb.transactions.createIndex({ orderId: 1, createdAt: -1 });

// Delivery Service database
const deliveryDb = db.getSiblingDB("delivery_db");
ensureCollection(deliveryDb, "deliveries");
ensureCollection(deliveryDb, "drivers");
deliveryDb.drivers.createIndex(
    { location: "2dsphere" }
);

// Notification Service database
const notificationDb = db.getSiblingDB("notification_db");
ensureCollection(notificationDb, "notifications");

// Service users
ensureUser("customer_db", "customer_user", "customer_password", [{ role: "readWrite", db: "customer_db" }]);
ensureUser("order_db", "order_user", "order_password", [{ role: "readWrite", db: "order_db" }]);
ensureUser("restaurant_db", "restaurant_user", "restaurant_password", [{ role: "readWrite", db: "restaurant_db" }]);
ensureUser("payment_db", "payment_user", "payment_password", [{ role: "readWrite", db: "payment_db" }]);
ensureUser("delivery_db", "delivery_user", "delivery_password", [{ role: "readWrite", db: "delivery_db" }]);
ensureUser("notification_db", "notification_user", "notification_password", [{ role: "readWrite", db: "notification_db" }]);

print("MongoDB initialization completed successfully.");
