#!/usr/bin/env node
// End-to-end lifecycle test (PEE-181 / #115).
// Stage 0 verifies everything that exists today against the real platform.
// Stages 1-7 (order -> payment -> kitchen -> dispatch -> pickup -> delivery -> notification)
// are probed: a stage whose endpoints are not implemented is reported SKIPPED, never faked as PASS.
// Exit: 0 ok | 1 a check failed | 3 an endpoint now exists and needs wiring | 4 STRICT=1 and stages skipped

import { PORTS, call, createRestaurant, menuItem, findItem } from "../lib/common.mjs";

const rows = [];
const tag = {
  PASS: "PASS ",
  FAIL: "FAIL ",
  SKIPPED: "SKIP ",
  FOUND: "FOUND",
};

function record(id, name, status, detail = "") {
  rows.push({ id, name, status, detail });
  console.log(`[${tag[status]}] ${id} ${name}${detail ? ` - ${detail}` : ""}`);
}

const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function check(id, name, fn) {
  try {
    const result = await fn();
    record(id, name, "PASS", result ?? "");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(id, name, "FAIL", message);
  }
}

console.log("== Stage 0: platform and catalog prerequisites ==");

await check("0.1", "all 7 services healthy", async () => {
  for (const name of Object.keys(PORTS)) {
    const r = await call(name, "GET", "/health");
    must(
      r.status === 200 && r.json?.status === "UP",
      `${name} /health -> ${r.status} ${r.text.slice(0, 80)}`
    );
  }
  return "7/7 UP";
});

let restaurantId;

await check("0.2", "restaurant onboarded with a menu", async () => {
  const created = await createRestaurant("e2e", [menuItem("e2e-item-1", 100)]);
  must(
    created.ok,
    `POST /restaurants -> ${created.res.status} ${created.res.text.slice(0, 200)}`
  );
  restaurantId = created.id;
  return `id=${restaurantId}`;
});

await check("0.3", "stock update persisted", async () => {
  must(restaurantId, "no restaurant from 0.2");
  const put = await call("restaurants", "PUT", `/restaurants/${restaurantId}/menu/items/e2e-item-1/stock`, { stock: 40 });
  must(put.status === 200, `PUT stock -> ${put.status} ${put.text.slice(0, 150)}`);

  const got = await call("restaurants", "GET", `/restaurants/${restaurantId}`);
  const foundItem = findItem(got.json, "e2e-item-1");
  must(foundItem?.stock === 40, "stock was not 40 after the update");
  return "stock 100 -> 40";
});

await check("0.4", "payment service contract (unknown order -> 404 PAYMENT_NOT_FOUND)", async () => {
  const r = await call("payments", "GET", "/payments/order/e2e-unknown-order");
  must(r.status === 404, `expected 404, got ${r.status}`);
  must(r.json?.error?.code === "PAYMENT_NOT_FOUND", `unexpected body ${r.text.slice(0, 120)}`);
});

await check("0.5", "notification service reachable (recipient lookup)", async () => {
  const r = await call("notifications", "GET", "/notifications/recipient/e2e-unknown");
  must([200, 404].includes(r.status), `expected 200 or 404, got ${r.status}`);
  return `status ${r.status}`;
});

await check("0.6", "admin overview endpoint", async () => {
  const r = await call("admin", "GET", "/admin/stats/overview");
  must(r.status === 200, `expected 200, got ${r.status}`);
});

console.log("\n== Stages 1-7: order-to-delivery lifecycle ==");

async function probe(service, method, path) {
  const r = await call(service, method, path, {});
  if (r.status === 0) return "error";
  return r.status === 404 || r.status === 405 ? "missing" : "present";
}

const stages = [
  { id: "1", name: "Order placed", probe: ["orders", "POST", "/orders"] },
  { id: "2", name: "Payment settled", needs: "1" },
  { id: "3", name: "Kitchen preparation", needs: "1" },
  { id: "4", name: "Driver dispatched", probe: ["deliveries", "POST", "/deliveries"] },
  { id: "5", name: "Order picked up", needs: "4" },
  { id: "6", name: "Delivery completed", needs: "4" },
  { id: "7", name: "Customer notified", needs: "6" },
];

const state = {};

for (const s of stages) {
  if (s.probe) {
    const [service, method, path] = s.probe;
    const p = await probe(service, method, path);
    if (p === "missing") {
      state[s.id] = "SKIPPED";
      record(s.id, s.name, "SKIPPED", `no ${method} ${path} on the ${service} service yet`);
    } else if (p === "present") {
      state[s.id] = "FOUND";
      record(s.id, s.name, "FOUND", `${method} ${path} now exists - add its request and assertions to this script`);
    } else {
      state[s.id] = "FAIL";
      record(s.id, s.name, "FAIL", `${service} service not reachable`);
    }
  } else {
    state[s.id] = "SKIPPED";
    record(s.id, s.name, "SKIPPED", `depends on stage ${s.needs} (${state[s.needs]})`);
  }
}

const count = (st) => rows.filter((r) => r.status === st).length;
const verified = stages.filter((s) => state[s.id] === "PASS").length;

console.log(`\nSummary: ${count("PASS")} passed, ${count("FAIL")} failed, ${count("SKIPPED")} skipped, ${count("FOUND")} need wiring`);
console.log(`Lifecycle stages verified end to end: ${verified}/7`);

let code = 0;
if (count("FAIL")) code = 1;
else if (count("FOUND")) code = 3;
else if (process.env.STRICT === "1" && count("SKIPPED")) code = 4;

process.exit(code);

