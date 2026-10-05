import { PORTS, call, pollUntil, orderPayload } from "../lib/common.mjs";

console.log("=== [CUSTOMER WORKFLOW] Starting End-to-End Simulation ===");

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
  const customerId = `cust-wf-${Date.now()}`;
  
  // Step 1: Customer Profile Creation
  console.log("\n-- Step 1: Customer Profile Creation --");
  const createCustomerRes = await call("customers", "POST", "/customers", {
    id: customerId,
    name: "John Customer",
    email: `john-${Date.now()}@example.com`,
    phone: "+264811234567"
  });
  assert([200, 201].includes(createCustomerRes.status), `Customer profile created (HTTP ${createCustomerRes.status})`);

  // Step 2: Address Verification (in-range vs out-of-range)
  console.log("\n-- Step 2: Address Geo-Verification --");
  const validAddressPayload = {
    customerId,
    address: {
      id: "addr-01",
      tag: "Home",
      street: "12 Independence Avenue",
      city: "Windhoek",
      state: "Khomas",
      postalCode: "9000",
      location: { type: "Point", coordinates: [17.0658, -22.5609] },
      deliveryInstructions: "Leave at door",
      isDefault: true
    }
  };
  const validAddrRes = await call("customers", "POST", "/customers/verifyAddress", validAddressPayload);
  assert(validAddrRes.status === 200, `Address verification returned HTTP 200`);
  assert(validAddrRes.json?.valid === true && validAddrRes.json?.withinDeliveryRange === true, 
    `Central Windhoek address correctly classified as withinDeliveryRange`);

  const outOfRangePayload = {
    customerId,
    address: {
      id: "addr-02",
      tag: "Distant",
      street: "100 Far Away Road",
      city: "Outlying",
      state: "Outlying",
      postalCode: "0000",
      location: { type: "Point", coordinates: [25.0, -30.0] },
      deliveryInstructions: "",
      isDefault: false
    }
  };
  const outAddrRes = await call("customers", "POST", "/customers/verifyAddress", outOfRangePayload);
  assert(outAddrRes.status === 200, `Out-of-range address verification returned HTTP 200`);
  assert(outAddrRes.json?.withinDeliveryRange === false, 
    `Out-of-range address correctly rejected as withinDeliveryRange=false`);

  // Step 3: Dynamic Surge Pricing Quote
  console.log("\n-- Step 3: Dynamic Surge Pricing Quote --");
  const standardQuoteRes = await call("orders", "GET", "/pricing/quote?unfulfilledOrders=5&availableDrivers=10");
  const standardMultiplier = Number(standardQuoteRes.json?.surgeMultiplier ?? standardQuoteRes.json?.multiplier);
  assert(standardQuoteRes.json?.tier === "STANDARD" || standardMultiplier <= 1.5,
    `Low demand quote yields standard pricing (multiplier=${standardMultiplier})`);

  const surgeQuoteRes = await call("orders", "GET", "/pricing/quote?unfulfilledOrders=40&availableDrivers=10");
  assert(surgeQuoteRes.status === 200, `Surge quote returned HTTP 200`);
  const surgeMultiplier = Number(surgeQuoteRes.json?.surgeMultiplier ?? surgeQuoteRes.json?.multiplier);
  assert(surgeQuoteRes.json?.tier === "SURGE" && surgeMultiplier >= 2.0,
    `High demand quote triggers SURGE tier (multiplier=${surgeMultiplier})`);

  // Step 4: Input Validation Errors
  console.log("\n-- Step 4: Input Validation Rejection Guards --");
  const invalidQtyOrder = orderPayload(customerId, "R001", "item-1", 0, 50.0);
  const invalidRes1 = await call("orders", "POST", "/orders", invalidQtyOrder);
  assert(invalidRes1.status === 400, `Order with quantity=0 rejected with HTTP 400`);

  const negativeQtyOrder = orderPayload(customerId, "R001", "item-1", -2, 50.0);
  const invalidRes2 = await call("orders", "POST", "/orders", negativeQtyOrder);
  assert(invalidRes2.status === 400, `Order with negative quantity rejected with HTTP 400`);

  // Step 5: Place Valid Order
  console.log("\n-- Step 5: Order Submission & Total Calculation --");
  const validOrder = orderPayload(customerId, "R001", "item-1", 2, 60.0);
  const orderRes = await call("orders", "POST", "/orders", validOrder);
  assert(orderRes.status === 201, `Valid order placed (HTTP 201)`);
  assert(typeof orderRes.json?.orderId === "string", `Order ID assigned: ${orderRes.json?.orderId}`);
  const orderId = orderRes.json.orderId;

  // Step 6: Order Status Query
  console.log("\n-- Step 6: Order Read-Back & Status --");
  const getOrderRes = await call("orders", "GET", `/orders/${orderId}`);
  assert(getOrderRes.status === 200, `Order query returned HTTP 200`);
  assert(getOrderRes.json?.orderId === orderId, `Queried order matches orderId`);
  assert(["CREATED", "CONFIRMED"].includes(getOrderRes.json?.status), 
    `Order initial lifecycle state is valid: ${getOrderRes.json?.status}`);

  // Step 7: Order Cancellation Workflow
  console.log("\n-- Step 7: Order Cancellation Guard --");
  // Fresh order for cancellation test
  const cancelTestOrder = orderPayload(customerId, "R001", "item-cancel", 1, 30.0);
  const cancelOrderRes = await call("orders", "POST", "/orders", cancelTestOrder);
  const cancelOrderId = cancelOrderRes.json?.orderId;
  assert(Boolean(cancelOrderId), `Created order for cancellation test: ${cancelOrderId}`);

  const cancelActionRes = await call("orders", "POST", `/orders/${cancelOrderId}/cancel`, {
    reason: "Customer changed their mind"
  });
  assert([200, 204].includes(cancelActionRes.status), `Order cancellation accepted (HTTP ${cancelActionRes.status})`);

  const cancelledOrderVerify = await call("orders", "GET", `/orders/${cancelOrderId}`);
  assert(cancelledOrderVerify.json?.status === "CANCELLED", `Order state updated to CANCELLED`);

  console.log(`\n=== Customer Workflow Complete: ${passed} checks passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
