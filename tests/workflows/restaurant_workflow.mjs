import { PORTS, call, menuItem, restaurantPayload, findItem } from "../lib/common.mjs";

console.log("=== [RESTAURANT WORKFLOW] Starting End-to-End Simulation ===");

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
  const restTag = `rest-${Date.now()}`;
  const initialItems = [
    menuItem("braai-platter", 50),
    menuItem("kapana-special", 25)
  ];

  // Step 1: Restaurant Onboarding
  console.log("\n-- Step 1: Restaurant Onboarding --");
  const payload = restaurantPayload(restTag, initialItems);
  const createRes = await call("restaurants", "POST", "/restaurants", payload);
  assert([200, 201].includes(createRes.status), `Restaurant onboarded (HTTP ${createRes.status})`);
  const restaurantId = createRes.json?.id;
  assert(Boolean(restaurantId), `Restaurant ID assigned: ${restaurantId}`);

  // Step 2: Catalog & Menu Retrieval
  console.log("\n-- Step 2: Catalog & Menu Retrieval --");
  const getRestRes = await call("restaurants", "GET", `/restaurants/${restaurantId}`);
  assert(getRestRes.status === 200, `Restaurant retrieval returned HTTP 200`);
  const kapanaItem = findItem(getRestRes.json, "kapana-special");
  assert(Boolean(kapanaItem), `Found menu item 'kapana-special'`);
  assert(kapanaItem.stock === 25, `Initial stock verified as 25`);

  // Step 3: Stock Update
  console.log("\n-- Step 3: Stock Level Update --");
  const updateStockRes = await call("restaurants", "PUT", `/restaurants/${restaurantId}/menu/items/kapana-special/stock`, {
    stock: 60
  });
  assert(updateStockRes.status === 200, `Stock update returned HTTP 200`);

  const verifyStockRes = await call("restaurants", "GET", `/restaurants/${restaurantId}`);
  const updatedItem = findItem(verifyStockRes.json, "kapana-special");
  assert(updatedItem?.stock === 60, `Updated stock verified as 60`);

  // Step 4: Restock Operation
  console.log("\n-- Step 4: Restock Item --");
  const restockRes = await call("restaurants", "POST", `/restaurants/${restaurantId}/menu/items/kapana-special/restock`, {
    quantity: 15
  });
  assert(restockRes.status === 200, `Restock request returned HTTP 200`);

  const verifyRestockRes = await call("restaurants", "GET", `/restaurants/${restaurantId}`);
  const restockedItem = findItem(verifyRestockRes.json, "kapana-special");
  assert(restockedItem?.stock === 75, `Restocked stock verified as 75 (60 + 15)`);

  // Step 5: Price Update
  console.log("\n-- Step 5: Menu Item Price Update --");
  const priceRes = await call("restaurants", "PUT", `/restaurants/${restaurantId}/menu/items/kapana-special/price`, {
    price: 35.0
  });
  assert(priceRes.status === 200, `Price update returned HTTP 200`);

  const verifyPriceRes = await call("restaurants", "GET", `/restaurants/${restaurantId}`);
  const pricedItem = findItem(verifyPriceRes.json, "kapana-special");
  assert(pricedItem?.price === 35.0, `Updated price verified as 35.0`);

  // Step 6: Stock Overselling Protection (Negative stock guard)
  console.log("\n-- Step 6: Negative Stock Guard --");
  const badStockRes = await call("restaurants", "PUT", `/restaurants/${restaurantId}/menu/items/kapana-special/stock`, {
    stock: -10
  });
  assert([400, 422].includes(badStockRes.status), `Negative stock update rejected with HTTP ${badStockRes.status}`);

  console.log(`\n=== Restaurant Workflow Complete: ${passed} checks passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
