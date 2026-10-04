import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

const services = [
  { col: "orders", svc: "order_service", env: "orders_url", port: 9091 },
  { col: "customers", svc: "customer_service", env: "customers_url", port: 9093 },
  { col: "payments", svc: "payment_service", env: "payments_url", port: 9094 },
  {
    col: "restaurants", svc: "restaurant_service", env: "restaurants_url", port: 9095,
    extra: [{
      name: "Seed database", method: "POST", path: "seed",
      description: "Seeds restaurants and menus into MongoDB.",
      test: `pm.test("status code is 200", function () {
  pm.response.to.have.status(200);
});

pm.test("body confirms seeding", function () {
  pm.expect(pm.response.json()).to.eql({ message: "Database seeded successfully" });
});`,
    }],
  },
  { col: "deliveries", svc: "delivery_service", env: "deliveries_url", port: 9096 },
  { col: "notifications", svc: "notification_service", env: "notifications_url", port: 9097 },
  { col: "admin", svc: "admin_service", env: "admin_url", port: 9098 },
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
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
};

for (const s of services) {
  const requests = [
    { name: "Health check", method: "GET", path: "health", description: `Liveness probe for the ${s.svc.replace(/_/g, " ")}.`, test: healthTest(s) },
    ...(s.extra ?? []),
  ];

  const items = requests.map((r) => ({
    name: r.name,
    event: [{ listen: "test", script: { type: "text/javascript", exec: r.test.split("\n") } }],
    request: {
      method: r.method,
      header: [],
      url: { raw: `{{${s.env}}}/${r.path}`, host: [`{{${s.env}}}`], path: [r.path] },
      description: r.description,
    },
  }));

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
