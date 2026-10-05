import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

const JSON_HEADERS = [{ key: "Content-Type", value: "application/json" }];

const services = [
  {
    col: "orders",
    svc: "order_service",
    env: "orders_url",
    port: 9091,
    extra: [
      {
        name: "Get order by ID",
        method: "GET",
        path: "orders/ord_test_1",
        description: "Retrieves order details by order ID.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200 or 404", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 404]);
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches order schema when found", function () {
  if (pm.response.code === 200) {
    pm.response.to.have.header("Content-Type");
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
    pm.response.to.have.jsonSchema({
      type: "object",
      required: ["orderId", "customerId", "restaurantId", "items", "status"],
      properties: {
        orderId: { type: "string" },
        customerId: { type: "string" },
        restaurantId: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["itemId", "name", "quantity", "price"],
            properties: {
              itemId: { type: "string" },
              name: { type: "string" },
              quantity: { type: "integer" },
              price: { type: "number" }
            }
          }
        },
        deliveryAddress: { type: "object" },
        status: { type: "string" }
      }
    });
  }
});`,
      },
      {
        name: "Create order",
        method: "POST",
        path: "orders",
        description: "Creates a new order for a customer from a restaurant.",
        headers: JSON_HEADERS,
        body: {
          customerId: "cust_test_1",
          restaurantId: "R001",
          items: [
            {
              itemId: "M1",
              name: "Beef Kapana",
              quantity: 2,
              price: 50.0,
            },
          ],
          deliveryAddress: {
            street: "123 Independence Ave",
            city: "Windhoek",
            state: "Khomas",
            postalCode: "9000",
          },
        },
        test: `pm.test("status code is 201 or 200", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 201]);
});

pm.test("Content-Type header is JSON", function () {
  pm.response.to.have.header("Content-Type");
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches created order schema", function () {
  pm.response.to.have.jsonSchema({
    type: "object",
    required: ["orderId", "status"],
    properties: {
      orderId: { type: "string" },
      customerId: { type: "string" },
      restaurantId: { type: "string" },
      status: { type: "string" },
      items: { type: "array" },
      deliveryAddress: { type: "object" }
    }
  });
});`,
      },
    ],
  },
  {
    col: "customers",
    svc: "customer_service",
    env: "customers_url",
    port: 9093,
    extra: [
      {
        name: "Get customer by ID",
        method: "GET",
        path: "customers/cust_test_1",
        description: "Retrieves customer profile and default address by customer ID.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200 or 404", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 404]);
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches customer schema when found", function () {
  if (pm.response.code === 200) {
    pm.response.to.have.header("Content-Type");
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
    pm.response.to.have.jsonSchema({
      type: "object",
      required: ["name", "email"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        address: { type: "object" }
      }
    });
  }
});`,
      },
      {
        name: "Create customer",
        method: "POST",
        path: "customers",
        description: "Registers a new customer profile.",
        headers: JSON_HEADERS,
        body: {
          name: "John Doe",
          email: "cust_test_1@example.com",
          phone: "+264811234567",
          address: {
            street: "123 Independence Ave",
            city: "Windhoek",
            state: "Khomas",
            postalCode: "9000",
          },
        },
        test: `pm.test("status code is 201 or 200", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 201]);
});

pm.test("Content-Type header is JSON", function () {
  pm.response.to.have.header("Content-Type");
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches created customer schema", function () {
  pm.response.to.have.jsonSchema({
    type: "object",
    required: ["name", "email"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      address: { type: "object" }
    }
  });
});`,
      },
    ],
  },
  {
    col: "payments",
    svc: "payment_service",
    env: "payments_url",
    port: 9094,
    extra: [
      {
        name: "Get payment by ID",
        method: "GET",
        path: "payments/pay_test_1",
        description: "Retrieves payment details by payment ID.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200 or 404", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 404]);
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches payment schema when found", function () {
  if (pm.response.code === 200) {
    pm.response.to.have.header("Content-Type");
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
    pm.response.to.have.jsonSchema({
      type: "object",
      required: ["orderId", "amount", "status"],
      properties: {
        paymentId: { type: "string" },
        transactionId: { type: "string" },
        orderId: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string" },
        status: { type: "string" },
        paymentMethod: { type: "string" }
      }
    });
  }
});`,
      },
      {
        name: "Create payment",
        method: "POST",
        path: "payments",
        description: "Authorizes and processes a payment for an order.",
        headers: JSON_HEADERS,
        body: {
          orderId: "ord_test_1",
          amount: 100.0,
          paymentMethod: "CREDIT_CARD",
        },
        test: `pm.test("status code is 201 or 200", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 201]);
});

pm.test("Content-Type header is JSON", function () {
  pm.response.to.have.header("Content-Type");
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches payment transaction schema", function () {
  pm.response.to.have.jsonSchema({
    type: "object",
    required: ["orderId", "amount", "status"],
    properties: {
      paymentId: { type: "string" },
      transactionId: { type: "string" },
      orderId: { type: "string" },
      amount: { type: "number" },
      currency: { type: "string" },
      status: { type: "string" },
      paymentMethod: { type: "string" }
    }
  });
});`,
      },
    ],
  },
  {
    col: "restaurants",
    svc: "restaurant_service",
    env: "restaurants_url",
    port: 9095,
    extra: [
      {
        name: "Seed database",
        method: "POST",
        path: "seed",
        description:
          "Seeds restaurants and menus into MongoDB. The service inserts fixed IDs (R001-R005) without upsert, " +
          "so re-running against an already-seeded database returns 500. Both outcomes are accepted here.",
        test: `pm.test("seed succeeds (200) or database is already seeded (500)", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 500]);
});

pm.test("on 200 the body confirms seeding", function () {
  if (pm.response.code === 200) {
    pm.expect(pm.response.json()).to.eql({ message: "Database seeded successfully" });
  }
});`,
      },
      {
        name: "Get all restaurants",
        method: "GET",
        path: "restaurants",
        description: "Retrieves the list of available restaurants.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200", function () {
  pm.response.to.have.status(200);
});

pm.test("Content-Type header is JSON", function () {
  pm.response.to.have.header("Content-Type");
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches restaurants list schema", function () {
  pm.response.to.have.jsonSchema({
    type: "array",
    items: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        address: { type: "string" }
      }
    }
  });
});`,
      },
      {
        name: "Get restaurant menu",
        method: "GET",
        path: "restaurants/R001/menu",
        description: "Retrieves the menu categories and items for restaurant R001.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200 or 404", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 404]);
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches menu schema when found", function () {
  if (pm.response.code === 200) {
    pm.response.to.have.header("Content-Type");
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
    pm.response.to.have.jsonSchema({
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "items"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "name", "price"],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                description: { type: "string" },
                price: { type: "number" }
              }
            }
          }
        }
      }
    });
  }
});`,
      },
    ],
  },
  {
    col: "deliveries",
    svc: "delivery_service",
    env: "deliveries_url",
    port: 9096,
    extra: [
      {
        name: "Track delivery",
        method: "GET",
        path: "delivery/track/ord_test_1",
        description: "Retrieves delivery status and location for an order.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200 or 404", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 404]);
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches delivery tracking schema when found", function () {
  if (pm.response.code === 200) {
    pm.response.to.have.header("Content-Type");
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
    pm.response.to.have.jsonSchema({
      type: "object",
      required: ["orderId", "status"],
      properties: {
        deliveryId: { type: "string" },
        orderId: { type: "string" },
        driverId: { type: "string" },
        status: { type: "string" },
        currentLocation: { type: "object" }
      }
    });
  }
});`,
      },
    ],
  },
  {
    col: "notifications",
    svc: "notification_service",
    env: "notifications_url",
    port: 9097,
    extra: [
      {
        name: "Get notifications by recipient",
        method: "GET",
        path: "notifications/recipient/cust_test_1",
        description: "Retrieves notification history for a specific recipient.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200 or 404", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 404]);
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches notifications schema when found", function () {
  if (pm.response.code === 200) {
    pm.response.to.have.header("Content-Type");
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
    pm.response.to.have.jsonSchema({
      type: "array",
      items: {
        type: "object",
        required: ["recipientId"],
        properties: {
          notificationId: { type: "string" },
          recipientId: { type: "string" },
          channel: { type: "string" },
          status: { type: "string" },
          sentAt: { type: "string" }
        }
      }
    });
  }
});`,
      },
    ],
  },
  {
    col: "admin",
    svc: "admin_service",
    env: "admin_url",
    port: 9098,
    extra: [
      {
        name: "Get admin stats overview",
        method: "GET",
        path: "admin/stats/overview",
        description: "Retrieves aggregate platform performance statistics.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200", function () {
  pm.response.to.have.status(200);
});

pm.test("Content-Type header is JSON", function () {
  pm.response.to.have.header("Content-Type");
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches stats overview schema", function () {
  pm.response.to.have.jsonSchema({
    type: "object",
    required: ["totalOrders", "grossMerchandiseValue", "successfulPayments", "failedPayments", "activeDeliveries"],
    properties: {
      totalOrders: { type: "integer" },
      grossMerchandiseValue: { type: "number" },
      successfulPayments: { type: "integer" },
      failedPayments: { type: "integer" },
      activeDeliveries: { type: "integer" },
      generatedAt: { type: "string" }
    }
  });
});`,
      },
      {
        name: "Get restaurant report",
        method: "GET",
        path: "admin/reports/restaurant?from=2026-10-01&to=2026-10-05",
        description: "Retrieves restaurant order count, gross sales, commission, and net payout reports within date range.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200", function () {
  pm.response.to.have.status(200);
});

pm.test("Content-Type header is JSON", function () {
  pm.response.to.have.header("Content-Type");
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches restaurant report schema", function () {
  pm.response.to.have.jsonSchema({
    type: "array",
    items: {
      type: "object",
      required: ["restaurantId", "orderCount", "grossSales", "commissionAmount", "netPayout"],
      properties: {
        restaurantId: { type: "string" },
        orderCount: { type: "integer" },
        grossSales: { type: "number" },
        commissionAmount: { type: "number" },
        netPayout: { type: "number" }
      }
    }
  });
});`,
      },
      {
        name: "Get driver report",
        method: "GET",
        path: "admin/reports/driver?from=2026-10-01&to=2026-10-05",
        description: "Retrieves driver delivery metrics, turnaround times, and SLA breaches within date range.",
        headers: JSON_HEADERS,
        test: `pm.test("status code is 200", function () {
  pm.response.to.have.status(200);
});

pm.test("Content-Type header is JSON", function () {
  pm.response.to.have.header("Content-Type");
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches driver report schema", function () {
  pm.response.to.have.jsonSchema({
    type: "array",
    items: {
      type: "object",
      required: ["driverId", "driverName", "completedDeliveries", "averageTurnaroundMinutes", "slaBreaches"],
      properties: {
        driverId: { type: "string" },
        driverName: { type: "string" },
        completedDeliveries: { type: "integer" },
        averageTurnaroundMinutes: { type: "number" },
        slaBreaches: { type: "integer" }
      }
    }
  });
});`,
      },
    ],
  },
];

const healthTest = (s) => `const expectedService = "${s.svc}";
const expectedPort = ${s.port};

pm.test("status code is 200", function () {
  pm.response.to.have.status(200);
});

pm.test("Content-Type header is JSON", function () {
  pm.response.to.have.header("Content-Type");
  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

pm.test("response time is under 2000 ms", function () {
  pm.expect(pm.response.responseTime).to.be.below(2000);
});

pm.test("body matches health schema", function () {
  pm.response.to.have.jsonSchema({
    type: "object",
    required: ["status", "service", "port", "version", "contracts"],
    properties: {
      status: { type: "string" },
      service: { type: "string" },
      port: { type: "integer" },
      version: { type: "string" },
      contracts: { type: "string" }
    }
  });
});

pm.test("status is UP", function () {
  pm.expect(pm.response.json().status).to.eql("UP");
});

pm.test("service name and port are correct", function () {
  const body = pm.response.json();
  pm.expect(body.service).to.eql(expectedService);
  pm.expect(body.port).to.eql(expectedPort);
});`;

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = text.replace(/\r\n/g, "\n");
  fs.writeFileSync(file, normalized.endsWith("\n") ? normalized : normalized + "\n");
};

for (const s of services) {
  const requests = [
    {
      name: "Health check",
      method: "GET",
      path: "health",
      description: `Liveness probe for the ${s.svc.replace(/_/g, " ")}.`,
      test: healthTest(s),
    },
    ...(s.extra ?? []),
  ];

  const items = requests.map((r) => {
    const item = {
      name: r.name,
      event: [{ listen: "test", script: { type: "text/javascript", exec: r.test.split(/\r?\n/) } }],
      request: {
        method: r.method,
        header: r.headers ?? [],
        // Plain string URL: {{*_url}} already contains scheme, host and port.
        url: `{{${s.env}}}/${r.path}`,
        description: r.description,
      },
    };

    if (r.body) {
      item.request.body = {
        mode: "raw",
        raw: typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2),
        options: {
          raw: {
            language: "json",
          },
        },
      };
    }

    return item;
  });

  write(
    path.join(root, "postman", `${s.col}.postman_collection.json`),
    JSON.stringify({ info: { name: s.col, description: `${s.svc} API tests`, schema: SCHEMA }, item: items }, null, 2)
  );
}

write(
  path.join(root, "postman", "environments", "local.postman_environment.json"),
  JSON.stringify({
    id: "7c1f1b0a-3d4e-4f5a-9b6c-0a1b2c3d4e5f",
    name: "Local",
    values: services.map((s) => ({ key: s.env, value: `http://localhost:${s.port}`, type: "default", enabled: true })),
    _postman_variable_scope: "environment",
  }, null, 2)
);

console.log(`Generated ${services.length} JSON collections and the Newman environment.`);
