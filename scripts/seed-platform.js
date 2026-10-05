/**
 * PeerPressure Distributed Food Delivery Platform - Master Platform Seeder
 * 
 * OVERRIDE GUARANTEE:
 * This script unconditionally wipes and resets all databases and collections 
 * across customer_db, restaurant_db, delivery_db, order_db, payment_db, 
 * payments_db, and notification_db. Existing records are purged regardless of 
 * prior state, leaving all services in a clean, consistent canonical baseline.
 * 
 * Execution:
 *   mongosh -u root -p password --authenticationDatabase admin scripts/seed-platform.js
 * Or inside Docker container:
 *   docker exec -i dsa-mongodb mongosh -u root -p password --authenticationDatabase admin < scripts/seed-platform.js
 */

const log = typeof print === "function" ? print : console.log;

function loadJson(filePath, fallbackData) {
  try {
    if (typeof require === "function") {
      const fs = require("fs");
      const path = require("path");
      const resolved = path.resolve(filePath);
      if (fs.existsSync(resolved)) {
        const raw = fs.readFileSync(resolved, "utf8");
        return JSON.parse(raw);
      }
    }
  } catch (err) {
    log("Notice: Reading file " + filePath + " failed (" + err.message + "), using embedded canonical dataset.");
  }
  return fallbackData;
}

// Ensure database context exists
if (typeof db === "undefined") {
  log("Error: MongoDB 'db' context is undefined. Execute via mongosh or with an active database connection.");
  if (typeof quit === "function") quit(1);
}

log("================================================================================");
log("  PEERPRESSURE DISTRIBUTED FOOD DELIVERY PLATFORM: CANONICAL SEED OVERRIDE");
log("================================================================================");

// 1. CUSTOMER DB
(function seedCustomerDb() {
  log("\n[1/6] Seeding customer_db.customers (OVERRIDE MODE)...");
  const customerDb = db.getSiblingDB("customer_db");
  const collection = customerDb.getCollection("customers");

  // Load external or embedded customers
  const customers = [
    {
      "id": "CUST-001",
      "name": "Amelia Shilongo",
      "email": "amelia.shilongo@example.com",
      "phone": "+264811234501",
      "addresses": [
        {
          "id": "ADDR-001",
          "tag": "Home",
          "street": "12 Independence Avenue",
          "city": "Windhoek",
          "state": "Khomas",
          "postalCode": "10005",
          "deliveryInstructions": "Please call when you arrive.",
          "isDefault": true,
          "location": { "type": "Point", "coordinates": [17.0658, -22.5609] }
        }
      ]
    },
    {
      "id": "CUST-002",
      "name": "Daniel Amutenya",
      "email": "daniel.amutenya@example.com",
      "phone": "+264811234502",
      "addresses": [
        {
          "id": "ADDR-002",
          "tag": "Home",
          "street": "45 Sam Nujoma Drive",
          "city": "Windhoek",
          "state": "Khomas",
          "postalCode": "10006",
          "deliveryInstructions": "Leave the order with security if unavailable.",
          "isDefault": true,
          "location": { "type": "Point", "coordinates": [17.0836, -22.5687] }
        }
      ]
    },
    {
      "id": "CUST-003",
      "name": "Maria Ndeitunga",
      "email": "maria.ndeitunga@example.com",
      "phone": "+264811234503",
      "addresses": [
        {
          "id": "ADDR-003",
          "tag": "Work",
          "street": "8 Robert Mugabe Avenue",
          "city": "Windhoek",
          "state": "Khomas",
          "postalCode": "10007",
          "deliveryInstructions": "Deliver between 12:00 and 14:00.",
          "isDefault": true,
          "location": { "type": "Point", "coordinates": [17.0894, -22.5671] }
        }
      ]
    },
    {
      "id": "CUST-004",
      "name": "Thomas Nangolo",
      "email": "thomas.nangolo@example.com",
      "phone": "+264811234504",
      "addresses": [
        {
          "id": "ADDR-004",
          "tag": "Home",
          "street": "23 Dr Kenneth Kaunda Street",
          "city": "Windhoek",
          "state": "Khomas",
          "postalCode": "10008",
          "deliveryInstructions": "Gate is on the left side of the property.",
          "isDefault": true,
          "location": { "type": "Point", "coordinates": [17.0762, -22.5515] }
        }
      ]
    },
    {
      "id": "CUST-005",
      "name": "Selma Uusiku",
      "email": "selma.uusiku@example.com",
      "phone": "+264811234505",
      "addresses": [
        {
          "id": "ADDR-005",
          "tag": "Home",
          "street": "17 Nelson Mandela Avenue",
          "city": "Windhoek",
          "state": "Khomas",
          "postalCode": "10009",
          "deliveryInstructions": "Please ring the bell at the main entrance.",
          "isDefault": true,
          "location": { "type": "Point", "coordinates": [17.0951, -22.5742] }
        }
      ]
    }
  ];

  const data = loadJson("data/seed_customers.json", customers);

  // UNCONDITIONAL OVERRIDE: Purge prior records
  collection.deleteMany({});
  collection.insertMany(data);
  collection.createIndex({ email: 1 }, { unique: true });
  collection.createIndex({ "addresses.location": "2dsphere" });
  log("-> Overrode customer_db.customers: " + collection.countDocuments() + " records active.");
})();

// 2. RESTAURANT DB
(function seedRestaurantDb() {
  log("\n[2/6] Seeding restaurant_db.restaurants (OVERRIDE MODE)...");
  const restaurantDb = db.getSiblingDB("restaurant_db");
  const collection = restaurantDb.getCollection("restaurants");

  const fallbackRestaurants = [
    {
      "id": "R001",
      "name": "Kapana Corner",
      "address": "Single Quarters, Katutura, Windhoek",
      "location": { "type": "Point", "coordinates": [17.0658, -22.5333] },
      "contactNumber": "+264-81-111-2222",
      "operatingHours": [
        { "dayOfWeek": "Monday", "openTime": "08:00", "closeTime": "21:00", "isClosed": false },
        { "dayOfWeek": "Tuesday", "openTime": "08:00", "closeTime": "21:00", "isClosed": false },
        { "dayOfWeek": "Wednesday", "openTime": "08:00", "closeTime": "21:00", "isClosed": false },
        { "dayOfWeek": "Thursday", "openTime": "08:00", "closeTime": "21:00", "isClosed": false },
        { "dayOfWeek": "Friday", "openTime": "08:00", "closeTime": "22:00", "isClosed": false },
        { "dayOfWeek": "Saturday", "openTime": "08:00", "closeTime": "23:00", "isClosed": false },
        { "dayOfWeek": "Sunday", "openTime": "09:00", "closeTime": "20:00", "isClosed": false }
      ],
      "menu": [
        {
          "id": "C1",
          "name": "Street Food & Kapana",
          "items": [
            { "id": "M1", "name": "Beef Kapana", "description": "Succulent grilled beef strips dusted in chili spice", "price": 50.00, "taxRate": 0.15, "dietaryAttributes": ["High-Protein", "Halal"], "stock": 100 },
            { "id": "M2", "name": "Vetkoek (Fat Cake)", "description": "Golden deep-fried dough bun", "price": 10.00, "taxRate": 0.15, "dietaryAttributes": ["Vegetarian"], "stock": 80 },
            { "id": "M3", "name": "Katutura Salsa", "description": "Freshly diced tomato and onion salsa", "price": 15.00, "taxRate": 0.15, "dietaryAttributes": ["Vegan", "Gluten-Free"], "stock": 120 },
            { "id": "M4", "name": "Roosterkoek", "description": "Charcoal-grilled traditional bread roll", "price": 20.00, "taxRate": 0.15, "dietaryAttributes": ["Vegetarian"], "stock": 60 },
            { "id": "M5", "name": "Pork Kapana", "description": "Flame-broiled crispy pork skewers", "price": 60.00, "taxRate": 0.15, "dietaryAttributes": ["High-Protein"], "stock": 75 },
            { "id": "M6", "name": "Oshikundu", "description": "Traditional non-alcoholic fermented pearl millet brew", "price": 25.00, "taxRate": 0.15, "dietaryAttributes": ["Vegetarian", "Traditional"], "stock": 90 }
          ]
        }
      ]
    },
    {
      "id": "R002",
      "name": "Namibian Potjie Kitchen",
      "address": "Independence Ave, Windhoek CBD, Windhoek",
      "location": { "type": "Point", "coordinates": [17.0836, -22.5601] },
      "contactNumber": "+264-81-333-4444",
      "operatingHours": [
        { "dayOfWeek": "Monday", "openTime": "11:00", "closeTime": "22:00", "isClosed": false },
        { "dayOfWeek": "Tuesday", "openTime": "11:00", "closeTime": "22:00", "isClosed": false },
        { "dayOfWeek": "Wednesday", "openTime": "11:00", "closeTime": "22:00", "isClosed": false },
        { "dayOfWeek": "Thursday", "openTime": "11:00", "closeTime": "22:00", "isClosed": false },
        { "dayOfWeek": "Friday", "openTime": "11:00", "closeTime": "23:00", "isClosed": false },
        { "dayOfWeek": "Saturday", "openTime": "11:00", "closeTime": "23:00", "isClosed": false },
        { "dayOfWeek": "Sunday", "openTime": "12:00", "closeTime": "21:00", "isClosed": false }
      ],
      "menu": [
        {
          "id": "C2",
          "name": "Cast-Iron Potjie Stews",
          "items": [
            { "id": "M7", "name": "Beef Potjiekos", "description": "Slow-cooked beef stew with carrots and potatoes", "price": 120.00, "taxRate": 0.15, "dietaryAttributes": ["Slow-Cooked"], "stock": 50 },
            { "id": "M8", "name": "Lamb Potjiekos", "description": "Kalahari lamb braised with red wine and rosemary", "price": 140.00, "taxRate": 0.15, "dietaryAttributes": ["Slow-Cooked"], "stock": 45 },
            { "id": "M9", "name": "Oxtail Potjiekos", "description": "Rich gelatinous oxtail simmered in brown ale", "price": 160.00, "taxRate": 0.15, "dietaryAttributes": ["Chef-Special"], "stock": 35 },
            { "id": "M10", "name": "Chicken Potjiekos", "description": "Free-range chicken stew with corn dumplings", "price": 110.00, "taxRate": 0.15, "dietaryAttributes": ["Farmhouse"], "stock": 55 },
            { "id": "M11", "name": "Vegetable Potjiekos", "description": "Butternut, green beans, carrots in coconut curry", "price": 90.00, "taxRate": 0.15, "dietaryAttributes": ["Vegetarian", "Gluten-Free"], "stock": 40 },
            { "id": "M12", "name": "Mahangu Pap", "description": "Steamed pearl millet flour porridge", "price": 30.00, "taxRate": 0.15, "dietaryAttributes": ["Vegan", "Gluten-Free"], "stock": 80 }
          ]
        }
      ]
    }
  ];

  const data = loadJson("data/seed_restaurants.json", fallbackRestaurants);

  // UNCONDITIONAL OVERRIDE
  collection.deleteMany({});
  collection.insertMany(data);
  collection.createIndex({ location: "2dsphere" });
  log("-> Overrode restaurant_db.restaurants: " + collection.countDocuments() + " records active.");
})();

// 3. DELIVERY DB
(function seedDeliveryDb() {
  log("\n[3/6] Seeding delivery_db (drivers & deliveries) (OVERRIDE MODE)...");
  const deliveryDb = db.getSiblingDB("delivery_db");
  const driverCol = deliveryDb.getCollection("drivers");
  const deliveryCol = deliveryDb.getCollection("deliveries");

  const fallbackDrivers = [
    {
      "id": "drv_001",
      "name": "Tomas Nekundi",
      "phone": "+264812345601",
      "vehicleCategory": "MOTORCYCLE",
      "availability": "AVAILABLE",
      "state": "AVAILABLE",
      "location": { "type": "Point", "coordinates": [17.0658, -22.5609] },
      "latitude": -22.5609,
      "longitude": 17.0658
    },
    {
      "id": "drv_002",
      "name": "Maria Shilongo",
      "phone": "+264812345602",
      "vehicleCategory": "CAR",
      "availability": "AVAILABLE",
      "state": "AVAILABLE",
      "location": { "type": "Point", "coordinates": [17.0836, -22.5687] },
      "latitude": -22.5687,
      "longitude": 17.0836
    },
    {
      "id": "drv_003",
      "name": "Lukas Hamutenya",
      "phone": "+264812345603",
      "vehicleCategory": "MOTORCYCLE",
      "availability": "AVAILABLE",
      "state": "AVAILABLE",
      "location": { "type": "Point", "coordinates": [17.0894, -22.5671] },
      "latitude": -22.5671,
      "longitude": 17.0894
    }
  ];

  const driversData = loadJson("data/seed_drivers.json", fallbackDrivers);
  const deliveriesData = loadJson("data/seed_deliveries.json", [
    {
      "deliveryId": "DEL-SEED-001",
      "orderId": "ORD-SEED-001",
      "driverId": "drv_001",
      "status": "DELIVERED",
      "currentLocation": { "latitude": -22.5609, "longitude": 17.0658 }
    }
  ]);

  // UNCONDITIONAL OVERRIDE
  driverCol.deleteMany({});
  driverCol.insertMany(driversData);
  driverCol.createIndex({ location: "2dsphere" });

  deliveryCol.deleteMany({});
  deliveryCol.insertMany(deliveriesData);

  log("-> Overrode delivery_db.drivers: " + driverCol.countDocuments() + " records active.");
  log("-> Overrode delivery_db.deliveries: " + deliveryCol.countDocuments() + " records active.");
})();

// 4. ORDER DB
(function seedOrderDb() {
  log("\n[4/6] Seeding order_db.orders (OVERRIDE MODE)...");
  const orderDb = db.getSiblingDB("order_db");
  const collection = orderDb.getCollection("orders");

  const fallbackOrders = [
    {
      "orderId": "ORD-SEED-001",
      "customerId": "CUST-001",
      "restaurantId": "R001",
      "status": "DELIVERED",
      "items": [
        { "itemId": "M1", "name": "Beef Kapana", "quantity": 2, "price": 50.00 }
      ],
      "itemsTotal": 100.00,
      "deliveryFee": 25.00,
      "surgeMultiplier": 1.0,
      "totalAmount": 125.00,
      "deliveryAddress": { "street": "12 Independence Avenue", "city": "Windhoek", "state": "Khomas", "postalCode": "10005" },
      "createdAt": "2026-10-01T12:00:00Z",
      "updatedAt": "2026-10-01T12:45:00Z"
    }
  ];

  const data = loadJson("data/seed_orders.json", fallbackOrders);

  // UNCONDITIONAL OVERRIDE
  collection.deleteMany({});
  collection.insertMany(data);
  collection.createIndex({ customerId: 1, createdAt: -1 });
  log("-> Overrode order_db.orders: " + collection.countDocuments() + " records active.");
})();

// 5. PAYMENT DBS
(function seedPaymentDbs() {
  log("\n[5/6] Seeding payment_db and payments_db (OVERRIDE MODE)...");
  const paymentDb = db.getSiblingDB("payment_db");
  const paymentsDb = db.getSiblingDB("payments_db");

  const fallbackPayments = [
    {
      "paymentId": "PAY-SEED-001",
      "orderId": "ORD-SEED-001",
      "amount": 145.00,
      "status": "COMPLETED",
      "idempotencyKey": "IDEM-PAY-001-ORD-001",
      "completedAt": "2026-10-01T12:01:30Z"
    }
  ];

  const data = loadJson("data/seed_payments.json", fallbackPayments);

  // UNCONDITIONAL OVERRIDE: Purge both single and plural payment stores
  paymentDb.payments.deleteMany({});
  paymentDb.payments.insertMany(data);
  paymentDb.payments.createIndex({ idempotencyKey: 1 }, { unique: true });

  paymentsDb.payments.deleteMany({});
  paymentsDb.payments.insertMany(data);
  paymentsDb.payments.createIndex({ idempotencyKey: 1 }, { unique: true });

  paymentsDb.transactions.deleteMany({});
  paymentsDb.transactions.insertMany(data);
  paymentsDb.transactions.createIndex({ orderId: 1, createdAt: -1 });

  log("-> Overrode payment_db.payments: " + paymentDb.payments.countDocuments() + " records active.");
  log("-> Overrode payments_db.payments & transactions: " + paymentsDb.payments.countDocuments() + " records active.");
})();

// 6. NOTIFICATION DB
(function seedNotificationDb() {
  log("\n[6/6] Seeding notification_db.notifications (OVERRIDE MODE)...");
  const notifDb = db.getSiblingDB("notification_db");
  const collection = notifDb.getCollection("notifications");

  const fallbackNotifications = [
    {
      "notificationId": "NOTIF-SEED-001",
      "recipientId": "CUST-001",
      "channel": "SMS",
      "eventType": "OrderCreatedEvent",
      "message": "Your order ORD-SEED-001 has been placed.",
      "status": "DELIVERED",
      "sentAt": "2026-10-01T12:00:05Z"
    }
  ];

  const data = loadJson("data/seed_notifications.json", fallbackNotifications);

  // UNCONDITIONAL OVERRIDE
  collection.deleteMany({});
  collection.insertMany(data);
  log("-> Overrode notification_db.notifications: " + collection.countDocuments() + " records active.");
})();

log("\n================================================================================");
log("  PLATFORM SEED OVERRIDE COMPLETE: ALL COLLECTIONS SYNCHRONIZED TO CANONICAL BASELINE");
log("================================================================================\n");

if (typeof quit === "function") quit(0);
