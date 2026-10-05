import { PORTS, call, pollUntil } from "../lib/common.mjs";

console.log("=== [DELIVERY DRIVER WORKFLOW] Starting End-to-End Simulation ===");

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
  const orderId = `ord-del-${Date.now()}`;
  const driverId = `drv-${Date.now()}`;

  // Step 1: Dispatch Assignment
  console.log("\n-- Step 1: Dispatch Driver Assignment --");
  const dispatchPayload = {
    orderId,
    driverId,
    status: "DRIVER_ASSIGNED",
    currentLocation: {
      latitude: -22.5609,
      longitude: 17.0658
    }
  };
  const dispatchRes = await call("deliveries", "POST", "/deliveries", dispatchPayload);
  assert(dispatchRes.status === 201, `Driver dispatched (HTTP 201)`);
  assert(dispatchRes.json?.orderId === orderId, `Delivery matches order ID`);
  assert(dispatchRes.json?.driverId === driverId, `Delivery matches driver ID`);

  // Step 2: Query Live Tracking State
  console.log("\n-- Step 2: Query Live Tracking State --");
  const trackRes1 = await call("deliveries", "GET", `/delivery/track/${orderId}`);
  assert(trackRes1.status === 200, `Track query returned HTTP 200`);
  assert(trackRes1.json?.status === "DRIVER_ASSIGNED", `Track status is DRIVER_ASSIGNED`);
  assert(typeof trackRes1.json?.currentLocation === "object", `Current location GPS object present`);

  // Step 3: Transition to AT_RESTAURANT
  console.log("\n-- Step 3: Transition to AT_RESTAURANT --");
  const atRestPayload = {
    orderId,
    driverId,
    status: "AT_RESTAURANT",
    currentLocation: {
      latitude: -22.5615,
      longitude: 17.0665
    }
  };
  const atRestRes = await call("deliveries", "POST", "/deliveries", atRestPayload);
  assert(atRestRes.status === 201, `Status transitioned to AT_RESTAURANT (HTTP 201)`);

  const trackRes2 = await call("deliveries", "GET", `/delivery/track/${orderId}`);
  assert(trackRes2.json?.status === "AT_RESTAURANT", `Track reflects AT_RESTAURANT status`);

  // Step 4: Transition to OUT_FOR_DELIVERY (Picked Up)
  console.log("\n-- Step 4: Transition to OUT_FOR_DELIVERY --");
  const transitPayload = {
    orderId,
    driverId,
    status: "OUT_FOR_DELIVERY",
    currentLocation: {
      latitude: -22.5650,
      longitude: 17.0700
    }
  };
  const transitRes = await call("deliveries", "POST", "/deliveries", transitPayload);
  assert(transitRes.status === 201, `Status transitioned to OUT_FOR_DELIVERY (HTTP 201)`);

  const trackRes3 = await call("deliveries", "GET", `/delivery/track/${orderId}`);
  assert(trackRes3.json?.status === "OUT_FOR_DELIVERY", `Track reflects OUT_FOR_DELIVERY status`);

  // Step 5: Transition to DELIVERED
  console.log("\n-- Step 5: Transition to DELIVERED --");
  const deliveredPayload = {
    orderId,
    driverId,
    status: "DELIVERED",
    currentLocation: {
      latitude: -22.5700,
      longitude: 17.0750
    }
  };
  const deliveredRes = await call("deliveries", "POST", "/deliveries", deliveredPayload);
  assert(deliveredRes.status === 201, `Status transitioned to DELIVERED (HTTP 201)`);

  const trackRes4 = await call("deliveries", "GET", `/delivery/track/${orderId}`);
  assert(trackRes4.json?.status === "DELIVERED", `Track reflects final DELIVERED status`);

  console.log(`\n=== Delivery Workflow Complete: ${passed} checks passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
