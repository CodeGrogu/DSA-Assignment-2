import { PORTS, call } from "../lib/common.mjs";

console.log("=== [ADMIN & NOTIFICATION WORKFLOW] Starting End-to-End Simulation ===");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    failed++;
    throw new Error(message);
  }
  console.log(`[PASS] ${message}`);
  passed++;
}

async function run() {
  // Step 1: Admin System Overview
  console.log("\n-- Step 1: Admin System Overview --");
  const overviewRes = await call("admin", "GET", "/admin/stats/overview");
  assert(overviewRes.status === 200, `Admin overview returned HTTP 200`);
  assert(overviewRes.json?.systemHealth === "HEALTHY" || overviewRes.json?.totalOrders !== undefined, 
    `Admin overview contains valid platform statistics (totalOrders: ${overviewRes.json?.totalOrders})`);

  // Step 2: Restaurant Performance & SLA Report
  console.log("\n-- Step 2: Restaurant SLA Report --");
  const restReportRes = await call("admin", "GET", "/admin/reports/restaurant?from=2026-01-01&to=2026-12-31");
  assert(restReportRes.status === 200, `Restaurant SLA report returned HTTP 200`);
  assert(Array.isArray(restReportRes.json), `Restaurant report returned array of metrics`);

  // Step 3: Driver Performance & SLA Report
  console.log("\n-- Step 3: Driver SLA Report --");
  const driverReportRes = await call("admin", "GET", "/admin/reports/driver?from=2026-01-01&to=2026-12-31");
  assert(driverReportRes.status === 200, `Driver SLA report returned HTTP 200`);
  assert(Array.isArray(driverReportRes.json), `Driver report returned array of metrics`);

  // Step 4: Notification Recipient Audit Verification
  console.log("\n-- Step 4: Notification Service Verification --");
  const notifRes = await call("notifications", "GET", "/notifications/recipient/cust-e2e-001");
  assert([200, 404].includes(notifRes.status), `Notification endpoint returned expected status (HTTP ${notifRes.status})`);

  // Step 5: Prometheus Observability Check Across All Services
  console.log("\n-- Step 5: Prometheus Metrics Scrape Across Services --");
  for (const [svcName, port] of Object.entries(PORTS)) {
    const metricsRes = await call(svcName, "GET", "/metrics");
    assert(metricsRes.status === 200, `${svcName} exposes Prometheus metrics on :${port}/metrics (HTTP 200)`);
  }

  console.log(`\n=== Admin & Notification Workflow Complete: ${passed} checks passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
