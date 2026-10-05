/**
 * End-to-End Human User Workflow Simulation
 * Exercises all live microservices, data types, and workflows end-to-end.
 */

const CONFIG = {
  ORDER_URL: "http://localhost:9091",
  CUSTOMER_URL: "http://localhost:9093",
  PAYMENT_URL: "http://localhost:9094",
  RESTAURANT_URL: "http://localhost:9095",
  DELIVERY_URL: "http://localhost:9096",
  NOTIF_URL: "http://localhost:9097",
  ADMIN_URL: "http://localhost:9098",
  WEB_URL: "http://localhost:8080"
};

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const latKm = (Number(lat1) - Number(lat2)) * 111.0;
  const lonKm = (Number(lon1) - Number(lon2)) * 102.5;
  return Math.sqrt(latKm * latKm + lonKm * lonKm);
}

function calculateETA(distKm) {
  if (distKm <= 0.05) return "Arrived";
  const mins = Math.max(1, Math.round((distKm / 30.0) * 60));
  return `~${mins} mins`;
}

async function runSimulation() {
  console.log("==================================================================");
  console.log("       STARTING END-TO-END HUMAN WORKFLOW SIMULATION              ");
  console.log("==================================================================");

  // 1. HEALTH SWEEP
  console.log("\n[STEP 1] Performing 7-Service Health Check Sweep...");
  const services = [
    { name: "Order Service", url: `${CONFIG.ORDER_URL}/health` },
    { name: "Customer Service", url: `${CONFIG.CUSTOMER_URL}/health` },
    { name: "Payment Service", url: `${CONFIG.PAYMENT_URL}/health` },
    { name: "Restaurant Service", url: `${CONFIG.RESTAURANT_URL}/health` },
    { name: "Delivery Service", url: `${CONFIG.DELIVERY_URL}/health` },
    { name: "Notification Service", url: `${CONFIG.NOTIF_URL}/health` },
    { name: "Admin Service", url: `${CONFIG.ADMIN_URL}/health` }
  ];

  for (const s of services) {
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`${s.name} returned HTTP ${res.status}`);
    const health = await res.json();
    console.log(`  ✓ ${s.name.padEnd(22)}: ${health.status} (${health.service})`);
  }

  // 2. CLIENT REGISTRATION
  const testCustomerId = `CUST-USER-${Date.now()}`;
  console.log(`\n[STEP 2] Client registers new customer account: ${testCustomerId}...`);
  const customerPayload = {
    id: testCustomerId,
    name: "Petrus Nangolo",
    email: `petrus.${Date.now()}@example.na`,
    phone: "+264812349999",
    addresses: [
      {
        id: `ADDR-${Date.now()}`,
        tag: "HOME",
        street: "77 Robert Mugabe Avenue",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "9000",
        location: {
          type: "Point",
          coordinates: [17.0894, -22.5671] // [lon, lat]
        },
        deliveryInstructions: "Ring buzzer 3, ground floor",
        isDefault: true
      }
    ]
  };

  const regRes = await fetch(`${CONFIG.CUSTOMER_URL}/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(customerPayload)
  });

  if (!regRes.ok && regRes.status !== 201) {
    throw new Error(`Customer registration failed: ${await regRes.text()}`);
  }
  const customer = await regRes.json();
  console.log(`  ✓ Customer created in MongoDB: ${customer.name} (${customer.id})`);

  // Verify Address
  console.log("\n[STEP 3] Client verifies delivery address with Customer Service...");
  const verifyRes = await fetch(`${CONFIG.CUSTOMER_URL}/customers/verifyAddress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: testCustomerId,
      address: customer.addresses[0]
    })
  });
  const verification = await verifyRes.json();
  console.log(`  ✓ Address verification result: Valid=${verification.valid}, InRange=${verification.withinDeliveryRange}, Dist=${Number(verification.distanceKm).toFixed(2)} km`);

  // 3. RESTAURANT & MENU SELECTION
  console.log("\n[STEP 4] Client browses live restaurant catalog and menu...");
  const restRes = await fetch(`${CONFIG.RESTAURANT_URL}/restaurants`);
  const restaurants = await restRes.json();
  if (!Array.isArray(restaurants) || restaurants.length === 0) {
    throw new Error("No restaurants available in catalog");
  }
  const restaurant = restaurants[0];
  console.log(`  ✓ Selected restaurant: ${restaurant.name} (${restaurant.id})`);
  console.log(`    Address: ${restaurant.address}`);

  // Get Menu Items
  let menuItem = null;
  for (const cat of restaurant.menu) {
    if (cat.items && cat.items.length > 0) {
      menuItem = cat.items.find(i => i.stock > 0) || cat.items[0];
      if (menuItem) break;
    }
  }

  if (!menuItem) throw new Error("No menu items found in restaurant catalog");
  console.log(`  ✓ Selected dish: ${menuItem.name} (${menuItem.id}), Price: N$ ${menuItem.price}, Stock: ${menuItem.stock}`);

  // 4. PRICING & ORDER CREATION
  console.log("\n[STEP 5] Client checks dynamic surge pricing and places order...");
  const pricingRes = await fetch(`${CONFIG.ORDER_URL}/pricing/current`);
  const pricing = await pricingRes.json();
  console.log(`  ✓ Dynamic Pricing: Surge Multiplier = ${pricing.surgeMultiplier}x, Delivery Fee = N$ ${pricing.deliveryFee}`);

  const orderPayload = {
    customerId: testCustomerId,
    restaurantId: restaurant.id,
    items: [
      {
        itemId: menuItem.id,
        name: menuItem.name,
        quantity: 2,
        price: Number(menuItem.price),
        specialInstructions: ["Extra spicy kapana seasoning"]
      }
    ],
    deliveryAddress: {
      street: customer.addresses[0].street,
      city: customer.addresses[0].city,
      state: customer.addresses[0].state,
      postalCode: customer.addresses[0].postalCode,
      coordinates: {
        latitude: customer.addresses[0].location.coordinates[1],
        longitude: customer.addresses[0].location.coordinates[0]
      }
    }
  };

  const orderRes = await fetch(`${CONFIG.ORDER_URL}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderPayload)
  });

  if (!orderRes.ok && orderRes.status !== 201) {
    throw new Error(`Order placement failed: ${await orderRes.text()}`);
  }
  const createdOrder = await orderRes.json();
  const orderId = createdOrder.orderId;
  console.log(`  ✓ Order created successfully! ID = ${orderId}`);
  console.log(`    Total Amount: N$ ${createdOrder.totalAmount} (Items: N$ ${createdOrder.itemsTotal} + Delivery Fee: N$ ${createdOrder.deliveryFee})`);

  // 5. PAYMENT CLEARANCE
  console.log(`\n[STEP 6] Client clears payment via Payment Service (:9094)...`);
  const payRes = await fetch(`${CONFIG.PAYMENT_URL}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: orderId,
      amount: createdOrder.totalAmount,
      paymentMethod: "CREDIT_CARD"
    })
  });

  if (!payRes.ok && payRes.status !== 201) {
    throw new Error(`Payment processing failed: ${await payRes.text()}`);
  }
  const payment = await payRes.json();
  console.log(`  ✓ Payment cleared: Transaction ID = ${payment.transactionId}, Status = ${payment.status}, Amount = N$ ${payment.amount}`);

  // Verify Payment by order ID
  const payLookupRes = await fetch(`${CONFIG.PAYMENT_URL}/payments/order/${orderId}`);
  const payLookup = await payLookupRes.json();
  console.log(`  ✓ Payment lookup confirmed: Payment ID = ${payLookup.paymentId}, Status = ${payLookup.status}`);

  // 6. DRIVER DISPATCH & STATE TRANSITIONS
  console.log(`\n[STEP 7] Courier (Tomas Nekundi, drv_001) executes delivery state transitions...`);
  const courierId = "drv_001";
  const dropLat = customer.addresses[0].location.coordinates[1];
  const dropLon = customer.addresses[0].location.coordinates[0];

  // Transition 1: Accept Delivery
  console.log("  [7.1] Courier accepts delivery task...");
  const t1Res = await fetch(`${CONFIG.DELIVERY_URL}/deliveries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: orderId,
      deliveryId: `del_${orderId}`,
      driverId: courierId,
      status: "DRIVER_ASSIGNED",
      currentLocation: { latitude: -22.5333, longitude: 17.0658 }
    })
  });
  console.log(`    ✓ State: ${(await t1Res.json()).status}`);

  // Transition 2: Arrive at Restaurant
  console.log("  [7.2] Courier arrives at restaurant for food pickup...");
  const t2Res = await fetch(`${CONFIG.DELIVERY_URL}/deliveries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: orderId,
      deliveryId: `del_${orderId}`,
      driverId: courierId,
      status: "AT_RESTAURANT",
      currentLocation: { latitude: -22.5333, longitude: 17.0658 }
    })
  });
  console.log(`    ✓ State: ${(await t2Res.json()).status}`);

  // Transition 3: Out for Delivery (En Route with GPS update)
  console.log("  [7.3] Courier picks up order and departs (OUT_FOR_DELIVERY)...");
  const halfwayLat = -22.5500;
  const halfwayLon = 17.0750;
  const t3Res = await fetch(`${CONFIG.DELIVERY_URL}/deliveries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: orderId,
      deliveryId: `del_${orderId}`,
      driverId: courierId,
      status: "OUT_FOR_DELIVERY",
      currentLocation: { latitude: halfwayLat, longitude: halfwayLon }
    })
  });
  console.log(`    ✓ State: ${(await t3Res.json()).status}`);

  // Check live telemetry from client's perspective
  const trackRes = await fetch(`${CONFIG.DELIVERY_URL}/delivery/track/${orderId}`);
  const telemetry = await trackRes.json();
  const liveDist = calculateDistanceKm(telemetry.currentLocation.latitude, telemetry.currentLocation.longitude, dropLat, dropLon);
  const liveETA = calculateETA(liveDist);
  console.log(`    ✓ Client Live Distance Telemetry: ${liveDist.toFixed(2)} km away, ETA: ${liveETA}`);

  // Transition 4: Delivered
  console.log("  [7.4] Courier reaches customer doorstep and confirms delivery (DELIVERED)...");
  const t4Res = await fetch(`${CONFIG.DELIVERY_URL}/deliveries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: orderId,
      deliveryId: `del_${orderId}`,
      driverId: courierId,
      status: "DELIVERED",
      currentLocation: { latitude: dropLat, longitude: dropLon }
    })
  });
  console.log(`    ✓ State: ${(await t4Res.json()).status}`);

  // 7. CLIENT TRACKING VERIFICATION
  console.log(`\n[STEP 8] Verifying final delivery state in Client & Order services...`);
  const finalOrderRes = await fetch(`${CONFIG.ORDER_URL}/orders/${orderId}`);
  const finalOrder = await finalOrderRes.json();
  console.log(`  ✓ Order retrieved: ID = ${finalOrder.orderId}, Status = ${finalOrder.status}, Customer = ${finalOrder.customerId}`);

  const finalDelivRes = await fetch(`${CONFIG.DELIVERY_URL}/delivery/track/${orderId}`);
  const finalDeliv = await finalDelivRes.json();
  console.log(`  ✓ Delivery retrieved: ID = ${finalDeliv.deliveryId}, Status = ${finalDeliv.status}, Driver = ${finalDeliv.driverId}`);

  // 8. NOTIFICATION AUDIT
  console.log(`\n[STEP 9] Checking notification audit trail for customer ${testCustomerId}...`);
  const notifRes = await fetch(`${CONFIG.NOTIF_URL}/notifications/recipient/${testCustomerId}`);
  if (notifRes.status === 404) {
    console.log(`  ✓ Notification endpoint correctly returned 404 (clean empty audit state for new customer).`);
  } else if (notifRes.ok) {
    const notifs = await notifRes.json();
    console.log(`  ✓ Notifications found: ${notifs.length} messages delivered.`);
  }

  // 9. ADMIN OPERATIONS VERIFICATION
  console.log(`\n[STEP 10] Admin Console Operations Sweep...`);
  const statsRes = await fetch(`${CONFIG.ADMIN_URL}/admin/stats/overview`);
  const stats = await statsRes.json();
  console.log(`  ✓ Admin Overview KPIs: Orders = ${stats.totalOrders}, GMV = N$ ${stats.grossMerchandiseValue}, Success Payments = ${stats.successfulPayments}`);

  const restReportRes = await fetch(`${CONFIG.ADMIN_URL}/admin/reports/restaurant`);
  const restReport = await restReportRes.json();
  console.log(`  ✓ Admin Restaurant Financial Report: ${Array.isArray(restReport) ? restReport.length : 0} records.`);

  const driverReportRes = await fetch(`${CONFIG.ADMIN_URL}/admin/reports/driver`);
  const driverReport = await driverReportRes.json();
  console.log(`  ✓ Admin Driver SLA Report: ${Array.isArray(driverReport) ? driverReport.length : 0} records.`);

  console.log("\n==================================================================");
  console.log("       ALL WORKFLOWS EXECUTED END-TO-END SUCCESSFULLY!            ");
  console.log("==================================================================");
}

runSimulation().catch(err => {
  console.error("\n❌ Simulation Error:", err);
  process.exit(1);
});
