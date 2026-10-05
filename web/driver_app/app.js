/**
 * Food Delivery Suite — Delivery Driver Web App Logic (app.js)
 * Real-Time Telemetry & Dispatch Operations Controller
 * Connects directly to Ballerina Delivery Service (:9096) and Order Service (:9091)
 * Uses reverse-proxy /api/${port} first to ensure guaranteed CORS and reliable connectivity
 */

// ============================================================================
// 1. STATE & CONFIGURATION
// ============================================================================

// Fleet Driver Presets
const FLEET_DRIVERS = {
  drv_001: {
    id: "drv_001",
    name: "Tomas Nekundi",
    phone: "+264812345601",
    vehicleCategory: "MOTORCYCLE",
    availability: "AVAILABLE"
  },
  drv_002: {
    id: "drv_002",
    name: "Selma Shikongo",
    phone: "+264812345602",
    vehicleCategory: "CAR",
    availability: "AVAILABLE"
  },
  drv_003: {
    id: "drv_003",
    name: "Johannes Paulus",
    phone: "+264812345603",
    vehicleCategory: "VAN",
    availability: "AVAILABLE"
  },
  drv_004: {
    id: "drv_004",
    name: "Ndapewa Amukoto",
    phone: "+264812345604",
    vehicleCategory: "BICYCLE",
    availability: "AVAILABLE"
  }
};

// Active Driver Profile
let activeDriver = {
  id: "drv_001",
  name: "Tomas Nekundi",
  phone: "+264812345601",
  vehicleCategory: "MOTORCYCLE",
  availability: "AVAILABLE",
  location: {
    latitude: -22.5609,
    longitude: 17.0658
  },
  schedule: {
    date: new Date().toISOString().split("T")[0],
    slot: "FULL",
    startTime: "06:00",
    endTime: "22:00"
  }
};

// Active Delivery Task
let activeDelivery = {
  orderId: "",
  deliveryId: "",
  driverId: "drv_001",
  status: "UNASSIGNED",
  currentLocation: {
    latitude: -22.5609,
    longitude: 17.0658
  },
  heading: 180,
  departedAt: null,
  deliveredAt: null,
  lastUpdated: null
};

// Route Endpoints (Windhoek Urban Corridor)
let routeOrigin = {
  name: "Kapana Corner Restaurant",
  address: "Single Quarters, Katutura, Windhoek",
  lat: -22.5333,
  lon: 17.0658
};

let routeDestination = {
  name: "Customer Residence",
  address: "12 Independence Avenue, Windhoek Central",
  lat: -22.5609,
  lon: 17.0658
};

// Simulation & Interval Handles
let simulationInterval = null;
let transitTimerInterval = null;
let activeLogFilter = "ALL";

// Default Delivery Instructions
const DEFAULT_INSTRUCTIONS = "Ring bell twice, gate code #4912. Contact customer upon arrival (+264 81 999 8877). Contactless doorstep dropoff preferred if customer is away.";

// ============================================================================
// 2. ROBUST API RESOLUTION & NETWORKING
// ============================================================================

/**
 * Resolves candidate URLs in priority order for robust API connectivity:
 * 1. If running on port 8080: /api/${port}${cleanPath}
 * 2. http://localhost:8080/api/${port}${cleanPath}
 * 3. http://127.0.0.1:8080/api/${port}${cleanPath}
 * 4. http://127.0.0.1:${port}${cleanPath}
 * 5. http://localhost:${port}${cleanPath}
 */
function getDriverCandidateUrls(port, path) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const urls = [];

  const isBrowser = typeof window !== "undefined" && window.location;
  if (isBrowser) {
    if (window.location.port === "8080" || window.location.origin.includes(":8080")) {
      urls.push(`/api/${port}${cleanPath}`);
    }
  }

  // Guaranteed CORS-free proxy candidates on port 8080 prioritized
  urls.push(`http://localhost:8080/api/${port}${cleanPath}`);
  urls.push(`http://127.0.0.1:8080/api/${port}${cleanPath}`);
  urls.push(`http://127.0.0.1:${port}${cleanPath}`);
  urls.push(`http://localhost:${port}${cleanPath}`);

  return [...new Set(urls)];
}

/**
 * Resilient API fetch connecting through /api/${port} first to eliminate CORS issues,
 * falling back seamlessly to direct port.
 */
async function driverApiFetch(port, path, options = {}) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const timeoutMs = options.timeoutMs || 4000;

  // Use shared.js apiFetch if globally present and not recursive
  if (
    typeof window !== "undefined" &&
    typeof window.apiFetch === "function" &&
    window.apiFetch !== driverApiFetch
  ) {
    try {
      return await window.apiFetch(port, cleanPath, options);
    } catch (_) {
      // Fall through to driver candidate URLs
    }
  }

  const urls = getDriverCandidateUrls(port, cleanPath);
  let lastErr = null;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const fetchOpts = { ...options, signal: controller.signal };
      delete fetchOpts.timeoutMs;
      const res = await fetch(url, fetchOpts);
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }

  throw lastErr || new Error(`Failed to reach service on port ${port}`);
}

/**
 * Probes Delivery Service (:9096) and Order Service (:9091)
 */
async function checkServicesHealth() {
  const banner = document.getElementById("service-status-banner");
  const text = document.getElementById("service-status-text");

  let delUp = false;
  let ordUp = false;

  try {
    const resDel = await driverApiFetch(9096, "/health", { timeoutMs: 2500 });
    delUp = resDel && resDel.ok;
  } catch (_) {
    delUp = false;
  }

  try {
    const resOrd = await driverApiFetch(9091, "/health", { timeoutMs: 2500 });
    ordUp = resOrd && resOrd.ok;
  } catch (_) {
    ordUp = false;
  }

  if (!banner || !text) return false;

  if (delUp) {
    banner.className = "service-banner banner-connected";
    text.innerHTML = `Connected to Delivery Service (:9096) &bull; ${
      ordUp ? "Order Service (:9091) Operational" : "Order Service (:9091) Standby"
    }`;
    return true;
  } else {
    banner.className = "service-banner banner-offline";
    text.textContent = "Delivery Service (:9096) Unreachable — Retrying in 5s...";
    return false;
  }
}

// ============================================================================
// 3. MATHEMATICAL SPATIAL MODEL & SVG PROJECTION
// Exact match to customer_service/address_verification.bal
// ============================================================================

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const latDiff = Number(lat1) - Number(lat2);
  const lonDiff = Number(lon1) - Number(lon2);
  const latKm = latDiff * 111.0;
  const lonKm = lonDiff * 102.5;
  return Math.sqrt(latKm * latKm + lonKm * lonKm);
}

function calculateETA(distanceKm) {
  if (distanceKm <= 0.05) return "Arrived";
  const mins = Math.max(1, Math.round((distanceKm / 30.0) * 60));
  return `${mins} min${mins > 1 ? "s" : ""}`;
}

/**
 * Projects real-world Windhoek GPS coordinates to SVG coordinate space.
 * Map Bounding Box:
 * North: -22.5250, South: -22.5700
 * West: 17.0450, East: 17.0850
 */
function projectCoordinatesToSvg(lat, lon, svgWidth = 720, svgHeight = 380) {
  const latNorth = -22.5250;
  const latSouth = -22.5700;
  const lonWest = 17.0450;
  const lonEast = 17.0850;

  const cLat = Math.max(latSouth, Math.min(latNorth, Number(lat)));
  const cLon = Math.max(lonWest, Math.min(lonEast, Number(lon)));

  const x = ((cLon - lonWest) / (lonEast - lonWest)) * svgWidth;
  const y = ((latNorth - cLat) / (latNorth - latSouth)) * svgHeight;

  return { x: Math.round(x), y: Math.round(y) };
}

// ============================================================================
// 4. NAVIGATION TABS
// ============================================================================

function switchDriverTab(tabId) {
  document.querySelectorAll(".header-nav .nav-tab-btn").forEach((btn) => {
    const isActive = btn.getAttribute("data-tab") === tabId;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll(".view-section").forEach((sec) => {
    sec.classList.toggle("active", sec.id === tabId);
  });
}

function setupNavTabs() {
  document.querySelectorAll(".header-nav .nav-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      if (tabId) switchDriverTab(tabId);
    });
  });
}

// ============================================================================
// 5. DRIVER PROFILE MANAGEMENT & PRESET SWITCHER
// ============================================================================

function loadSavedDriverProfile() {
  try {
    const saved = localStorage.getItem("dsa_active_driver_profile");
    if (saved) {
      const parsed = JSON.parse(saved);
      activeDriver = { ...activeDriver, ...parsed };
    }
  } catch (_) {}

  // Sync Header Driver Selector
  const headerSelect = document.getElementById("header-driver-select");
  if (headerSelect) {
    if (FLEET_DRIVERS[activeDriver.id]) {
      headerSelect.value = activeDriver.id;
    } else {
      headerSelect.value = "drv_001";
    }
    headerSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Populate Modal Fields
  const presetSelect = document.getElementById("modal-preset-driver");
  const idInput = document.getElementById("modal-input-driver-id");
  const nameInput = document.getElementById("modal-input-driver-name");
  const phoneInput = document.getElementById("modal-input-driver-phone");
  const vehicleSelect = document.getElementById("modal-select-vehicle");
  const availSelect = document.getElementById("modal-select-availability");

  if (presetSelect) {
    presetSelect.value = FLEET_DRIVERS[activeDriver.id] ? activeDriver.id : "custom";
    presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (idInput) idInput.value = activeDriver.id;
  if (nameInput) nameInput.value = activeDriver.name;
  if (phoneInput) phoneInput.value = activeDriver.phone;
  if (vehicleSelect) {
    vehicleSelect.value = activeDriver.vehicleCategory;
    vehicleSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // Populate Shift Schedule Fields
  const shiftDateInput = document.getElementById("modal-input-shift-date");
  const shiftSlotSelect = document.getElementById("modal-select-shift-slot");
  const shiftStartInput = document.getElementById("modal-input-shift-start");
  const shiftEndInput = document.getElementById("modal-input-shift-end");

  const sched = activeDriver.schedule || {
    date: new Date().toISOString().split("T")[0],
    slot: "FULL",
    startTime: "06:00",
    endTime: "22:00"
  };

  if (shiftDateInput) shiftDateInput.value = sched.date;
  if (shiftSlotSelect) {
    shiftSlotSelect.value = sched.slot;
    shiftSlotSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (shiftStartInput) shiftStartInput.value = sched.startTime;
  if (shiftEndInput) shiftEndInput.value = sched.endTime;

  updateDriverHeaderUI();
}

function handleHeaderDriverSelect(driverId) {
  if (FLEET_DRIVERS[driverId]) {
    const preset = FLEET_DRIVERS[driverId];
    activeDriver.id = preset.id;
    activeDriver.name = preset.name;
    activeDriver.phone = preset.phone;
    activeDriver.vehicleCategory = preset.vehicleCategory;

    try {
      localStorage.setItem("dsa_active_driver_profile", JSON.stringify(activeDriver));
    } catch (_) {}

    loadSavedDriverProfile();
    updateTaskUI();
    appendLog(
      `Active fleet driver switched to: ${activeDriver.name} (${activeDriver.id}) — Vehicle: ${activeDriver.vehicleCategory}`,
      "info",
      "DRIVER",
      "STATUS"
    );
  }
}

function handleShiftSelect(shift) {
  const shiftLabels = {
    ALL: "All Shifts",
    MORNING: "Morning Shift (06:00 - 14:00)",
    AFTERNOON: "Afternoon Shift (14:00 - 22:00)",
    NIGHT: "Night Shift (22:00 - 06:00)"
  };
  appendLog(`Shift filter set to: ${shiftLabels[shift] || shift}`, "info", "SHIFT", "STATUS");
}

function applyDriverPreset(presetId) {
  if (presetId === "custom") return;
  if (FLEET_DRIVERS[presetId]) {
    const preset = FLEET_DRIVERS[presetId];
    const idInput = document.getElementById("modal-input-driver-id");
    const nameInput = document.getElementById("modal-input-driver-name");
    const phoneInput = document.getElementById("modal-input-driver-phone");
    const vehicleSelect = document.getElementById("modal-select-vehicle");

    if (idInput) idInput.value = preset.id;
    if (nameInput) nameInput.value = preset.name;
    if (phoneInput) phoneInput.value = preset.phone;
    if (vehicleSelect) {
      vehicleSelect.value = preset.vehicleCategory;
      vehicleSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
}

function openCourierProfileModal() {
  const modal = document.getElementById("modal-courier-profile");
  if (modal) modal.style.display = "flex";

  const presetSelect = document.getElementById("modal-preset-driver");
  const idInput = document.getElementById("modal-input-driver-id");
  const nameInput = document.getElementById("modal-input-driver-name");
  const phoneInput = document.getElementById("modal-input-driver-phone");
  const vehicleSelect = document.getElementById("modal-select-vehicle");
  const availSelect = document.getElementById("modal-select-availability");

  if (presetSelect) {
    presetSelect.value = FLEET_DRIVERS[activeDriver.id] ? activeDriver.id : "custom";
    presetSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (idInput) idInput.value = activeDriver.id;
  if (nameInput) nameInput.value = activeDriver.name;
  if (phoneInput) phoneInput.value = activeDriver.phone;
  if (vehicleSelect) {
    vehicleSelect.value = activeDriver.vehicleCategory;
    vehicleSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (availSelect) {
    availSelect.value = activeDriver.availability;
    availSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const shiftDateInput = document.getElementById("modal-input-shift-date");
  const shiftSlotSelect = document.getElementById("modal-select-shift-slot");
  const shiftStartInput = document.getElementById("modal-input-shift-start");
  const shiftEndInput = document.getElementById("modal-input-shift-end");

  const sched = activeDriver.schedule || {
    date: new Date().toISOString().split("T")[0],
    slot: "FULL",
    startTime: "06:00",
    endTime: "22:00"
  };

  if (shiftDateInput) shiftDateInput.value = sched.date;
  if (shiftSlotSelect) {
    shiftSlotSelect.value = sched.slot;
    shiftSlotSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (shiftStartInput) shiftStartInput.value = sched.startTime;
  if (shiftEndInput) shiftEndInput.value = sched.endTime;
}

function handleModalShiftSlotChange(slot) {
  const startInput = document.getElementById("modal-input-shift-start");
  const endInput = document.getElementById("modal-input-shift-end");

  if (slot === "MORNING") {
    if (startInput) startInput.value = "06:00";
    if (endInput) endInput.value = "14:00";
  } else if (slot === "AFTERNOON") {
    if (startInput) startInput.value = "14:00";
    if (endInput) endInput.value = "22:00";
  } else if (slot === "NIGHT") {
    if (startInput) startInput.value = "22:00";
    if (endInput) endInput.value = "06:00";
  } else if (slot === "FULL") {
    if (startInput) startInput.value = "06:00";
    if (endInput) endInput.value = "22:00";
  }
}

function closeCourierProfileModal() {
  const modal = document.getElementById("modal-courier-profile");
  if (modal) modal.style.display = "none";
}

function saveCourierProfile() {
  const id = document.getElementById("modal-input-driver-id")?.value.trim() || "drv_001";
  const name = document.getElementById("modal-input-driver-name")?.value.trim() || "Tomas Nekundi";
  const phone = document.getElementById("modal-input-driver-phone")?.value.trim() || "+264812345601";
  const vehicle = document.getElementById("modal-select-vehicle")?.value || "MOTORCYCLE";
  const availability = document.getElementById("modal-select-availability")?.value || "AVAILABLE";

  const shiftDate = document.getElementById("modal-input-shift-date")?.value || new Date().toISOString().split("T")[0];
  const shiftSlot = document.getElementById("modal-select-shift-slot")?.value || "FULL";
  const shiftStart = document.getElementById("modal-input-shift-start")?.value || "06:00";
  const shiftEnd = document.getElementById("modal-input-shift-end")?.value || "22:00";

  activeDriver.id = id;
  activeDriver.name = name;
  activeDriver.phone = phone;
  activeDriver.vehicleCategory = vehicle;
  activeDriver.availability = availability;
  activeDriver.schedule = {
    date: shiftDate,
    slot: shiftSlot,
    startTime: shiftStart,
    endTime: shiftEnd
  };

  try {
    localStorage.setItem("dsa_active_driver_profile", JSON.stringify(activeDriver));
  } catch (_) {}

  closeCourierProfileModal();
  updateDriverHeaderUI();
  updateTaskUI();
  appendLog(
    `Driver profile saved: ${name} (${id}) — Vehicle: ${vehicle}, Shift: ${shiftStart}-${shiftEnd} (${shiftSlot})`,
    "success",
    "PROFILE",
    "STATUS"
  );
}

function cycleCourierStatus() {
  const statuses = ["AVAILABLE", "BUSY", "OFFLINE"];
  const currentIndex = statuses.indexOf(activeDriver.availability);
  const nextStatus = statuses[(currentIndex + 1) % statuses.length];

  activeDriver.availability = nextStatus;
  try {
    localStorage.setItem("dsa_active_driver_profile", JSON.stringify(activeDriver));
  } catch (_) {}

  updateDriverHeaderUI();
  appendLog(`Courier status toggled to: ${nextStatus}`, "info", "STATUS", "STATUS");
}

function updateDriverHeaderUI() {
  const headerSelect = document.getElementById("header-driver-select");
  if (headerSelect && FLEET_DRIVERS[activeDriver.id]) {
    headerSelect.value = activeDriver.id;
  }
  setText("header-driver-name", "Profile");
  setText("header-status-text", activeDriver.availability);
  setText("mini-vehicle-type", activeDriver.vehicleCategory);
  setText("mini-driver-status", activeDriver.availability);

  // Status Pill visual color cues
  const pillToggle = document.getElementById("header-status-toggle");
  const dot = document.getElementById("header-status-dot");
  if (pillToggle && dot) {
    pillToggle.classList.remove("status-available", "status-busy", "status-offline");
    dot.className = "status-dot";

    if (activeDriver.availability === "AVAILABLE") {
      pillToggle.classList.add("status-available");
      dot.classList.add("dot-available");
    } else if (activeDriver.availability === "BUSY") {
      pillToggle.classList.add("status-busy");
      dot.classList.add("dot-busy");
    } else {
      pillToggle.classList.add("status-offline");
      dot.classList.add("dot-offline");
    }
  }

  // Update vehicle icon in SVG map if needed
  updateMapVehicleIcon();
}

function updateMapVehicleIcon() {
  const iconGroup = document.getElementById("svg-icon-motorcycle");
  if (!iconGroup) return;

  if (activeDriver.vehicleCategory === "CAR" || activeDriver.vehicleCategory === "VAN") {
    iconGroup.innerHTML = `
      <rect x="-8" y="-4" width="16" height="8" rx="2" fill="none" stroke="#eb4d28" stroke-width="1.2" />
      <circle cx="-5" cy="4" r="2" fill="none" stroke="#eb4d28" stroke-width="1" />
      <circle cx="5" cy="4" r="2" fill="none" stroke="#eb4d28" stroke-width="1" />
      <path d="M-5 -4 L-2 -7 L3 -7 L6 -4" fill="none" stroke="#eb4d28" stroke-width="1.1" stroke-linecap="round" />
    `;
  } else {
    // Motorcycle / Bicycle default
    iconGroup.innerHTML = `
      <circle cx="-5" cy="3" r="2.5" fill="none" stroke="#eb4d28" stroke-width="1.2" />
      <circle cx="5" cy="3" r="2.5" fill="none" stroke="#eb4d28" stroke-width="1.2" />
      <path d="M-5 3 L-1 -2 L3 -2 L5 3 M-1 -2 L2 3" fill="none" stroke="#eb4d28" stroke-width="1.2" stroke-linecap="round" />
    `;
  }
}

// ============================================================================
// 6. PLATFORM ORDERS INTEGRATION & TASK LOOKUP
// ============================================================================

function refreshPlatformOrderChips() {
  const container = document.getElementById("platform-order-chips");
  if (!container) return;

  let orders = [];
  try {
    const raw = localStorage.getItem("dsa_active_orders");
    if (raw) orders = JSON.parse(raw);
  } catch (_) {}

  // Fallback to sample orders if none in localStorage
  if (!orders || orders.length === 0) {
    orders = ["ord_101", "ord_102", "ord_test_1"];
  }

  container.innerHTML = orders
    .map(
      (orderId) => `
    <button type="button" class="order-chip ${
      orderId === activeDelivery.orderId ? "active" : ""
    }" onclick="loadOrder('${escapeHtml(orderId)}')">
      ${escapeHtml(orderId)}
    </button>`
    )
    .join("");
}

async function loadOrder(orderId) {
  if (!orderId || !orderId.trim()) {
    appendLog("Please enter a valid Order ID.", "warn", "LOOKUP", "STATUS");
    return;
  }

  const targetId = orderId.trim();
  appendLog(`Querying delivery records for order: ${targetId}...`, "info", "LOOKUP", "STATUS");

  const input = document.getElementById("order-id-input");
  if (input) input.value = targetId;

  // 1. Query Order Service (:9091) for order & deliveryAddress details
  try {
    const orderRes = await driverApiFetch(9091, `/orders/${encodeURIComponent(targetId)}`, { timeoutMs: 3000 });
    if (orderRes && orderRes.ok) {
      const orderData = await orderRes.json();
      if (orderData.deliveryAddress) {
        routeDestination.address = `${orderData.deliveryAddress.street || "12 Independence Avenue"}, ${
          orderData.deliveryAddress.city || "Windhoek"
        }`;
        if (orderData.deliveryAddress.coordinates) {
          routeDestination.lat = Number(orderData.deliveryAddress.coordinates.latitude) || -22.5609;
          routeDestination.lon = Number(orderData.deliveryAddress.coordinates.longitude) || 17.0658;
        }
      }
      if (orderData.restaurantId) {
        routeOrigin.name = `Kapana Corner (${orderData.restaurantId})`;
      }
    }
  } catch (_) {
    // Keep default Windhoek corridor coordinates
  }

  // 2. Query Delivery Service (:9096) for tracking record
  try {
    const delRes = await driverApiFetch(9096, `/delivery/track/${encodeURIComponent(targetId)}`, { timeoutMs: 3000 });
    if (delRes && delRes.ok) {
      const delData = await delRes.json();
      activeDelivery.orderId = delData.orderId || targetId;
      activeDelivery.deliveryId = delData.deliveryId || `del_${targetId}`;
      activeDelivery.driverId = delData.driverId || activeDriver.id;
      activeDelivery.status = delData.status || "UNASSIGNED";
      if (delData.currentLocation) {
        activeDelivery.currentLocation = {
          latitude: Number(delData.currentLocation.latitude) || -22.5333,
          longitude: Number(delData.currentLocation.longitude) || 17.0658
        };
      }
      activeDelivery.lastUpdated = new Date().toLocaleTimeString();
      appendLog(`Delivery task loaded for ${targetId}: status = ${activeDelivery.status}`, "success", "GET 200", "STATUS");
    } else {
      activeDelivery.orderId = targetId;
      activeDelivery.deliveryId = `del_${targetId}`;
      activeDelivery.driverId = activeDriver.id;
      activeDelivery.status = "UNASSIGNED";
      activeDelivery.currentLocation = { latitude: routeOrigin.lat, longitude: routeOrigin.lon };
      activeDelivery.lastUpdated = new Date().toLocaleTimeString();
      appendLog(`Order ${targetId} ready for dispatch assignment.`, "info", "TASK", "STATUS");
    }
  } catch (_) {
    activeDelivery.orderId = targetId;
    activeDelivery.deliveryId = `del_${targetId}`;
    activeDelivery.driverId = activeDriver.id;
    activeDelivery.status = "UNASSIGNED";
    activeDelivery.currentLocation = { latitude: routeOrigin.lat, longitude: routeOrigin.lon };
    activeDelivery.lastUpdated = new Date().toLocaleTimeString();
    appendLog(`Service session initialized for order ${targetId}.`, "info", "TASK", "STATUS");
  }

  // Load Special Delivery Instructions from storage
  loadDeliveryInstructions(targetId);

  // Restore or reset Transit Timer timestamps
  restoreTransitTimers(targetId);

  updateTaskUI();
  refreshPlatformOrderChips();
}

// ============================================================================
// 7. SPECIAL DELIVERY INSTRUCTIONS
// ============================================================================

function loadDeliveryInstructions(orderId) {
  let instructions = DEFAULT_INSTRUCTIONS;
  try {
    const saved = localStorage.getItem(`dsa_instructions_${orderId}`);
    if (saved) instructions = saved;
  } catch (_) {}

  setText("delivery-instructions-text", instructions);
  const input = document.getElementById("delivery-instructions-input");
  if (input) input.value = instructions;
}

function toggleEditInstructions() {
  const viewEl = document.getElementById("delivery-instructions-view");
  const editEl = document.getElementById("delivery-instructions-edit");
  const btnLabel = document.getElementById("instructions-btn-label");

  if (!viewEl || !editEl) return;

  const isEditing = editEl.style.display !== "none";
  if (isEditing) {
    viewEl.style.display = "block";
    editEl.style.display = "none";
    if (btnLabel) btnLabel.textContent = "Edit Note";
  } else {
    viewEl.style.display = "none";
    editEl.style.display = "block";
    if (btnLabel) btnLabel.textContent = "Close";
    const currentText = document.getElementById("delivery-instructions-text")?.textContent || "";
    const input = document.getElementById("delivery-instructions-input");
    if (input) input.value = currentText;
  }
}

function cancelEditInstructions() {
  const viewEl = document.getElementById("delivery-instructions-view");
  const editEl = document.getElementById("delivery-instructions-edit");
  const btnLabel = document.getElementById("instructions-btn-label");

  if (viewEl) viewEl.style.display = "block";
  if (editEl) editEl.style.display = "none";
  if (btnLabel) btnLabel.textContent = "Edit Note";
}

function saveDeliveryInstructions() {
  const input = document.getElementById("delivery-instructions-input");
  const newText = input?.value.trim() || DEFAULT_INSTRUCTIONS;

  setText("delivery-instructions-text", newText);

  if (activeDelivery.orderId) {
    try {
      localStorage.setItem(`dsa_instructions_${activeDelivery.orderId}`, newText);
    } catch (_) {}
  }

  cancelEditInstructions();
  appendLog("Special delivery instructions updated.", "info", "NOTE", "STATUS");
}

// ============================================================================
// 8. DELIVERY STATE MACHINE & DISPATCH UPDATE
// ============================================================================

async function updateDeliveryState(nextStatus, customLocation = null) {
  if (!activeDelivery.orderId) {
    appendLog("No active order loaded. Load or select an order first.", "warn", "STATE", "STATUS");
    return;
  }

  const locationToSend = customLocation || activeDelivery.currentLocation;

  // Handle transit timestamps
  if (nextStatus === "OUT_FOR_DELIVERY" && !activeDelivery.departedAt) {
    activeDelivery.departedAt = Date.now();
    try {
      localStorage.setItem(`dsa_transit_departed_${activeDelivery.orderId}`, String(activeDelivery.departedAt));
    } catch (_) {}
  } else if (nextStatus === "DELIVERED" && !activeDelivery.deliveredAt) {
    activeDelivery.deliveredAt = Date.now();
    try {
      localStorage.setItem(`dsa_transit_delivered_${activeDelivery.orderId}`, String(activeDelivery.deliveredAt));
    } catch (_) {}
  }

  const payload = {
    orderId: activeDelivery.orderId,
    deliveryId: activeDelivery.deliveryId || `del_${activeDelivery.orderId}`,
    driverId: activeDriver.id,
    status: nextStatus,
    currentLocation: {
      latitude: Number(locationToSend.latitude),
      longitude: Number(locationToSend.longitude)
    }
  };

  const startTime = performance.now();
  appendLog(`Dispatching POST /deliveries: status=${nextStatus}...`, "info", "DISPATCH", "STATUS");

  try {
    const res = await driverApiFetch(9096, "/deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 4000
    });

    const elapsedMs = Math.round(performance.now() - startTime);

    if (res && (res.ok || res.status === 201)) {
      const data = await res.json().catch(() => ({}));
      activeDelivery.status = data.status || nextStatus;
      if (data.currentLocation) {
        activeDelivery.currentLocation = {
          latitude: Number(data.currentLocation.latitude),
          longitude: Number(data.currentLocation.longitude)
        };
      }
      activeDelivery.lastUpdated = new Date().toLocaleTimeString();
      appendLog(`Delivery state updated to ${activeDelivery.status} (${elapsedMs}ms)`, "success", "POST 201", "STATUS");
    } else {
      activeDelivery.status = nextStatus;
      activeDelivery.lastUpdated = new Date().toLocaleTimeString();
      appendLog(
        `Delivery Service responded HTTP ${res ? res.status : "ERR"}. State set to ${nextStatus}.`,
        "warn",
        "POST",
        "ERRORS"
      );
    }
  } catch (err) {
    activeDelivery.status = nextStatus;
    activeDelivery.lastUpdated = new Date().toLocaleTimeString();
    appendLog(`Network dispatch fallback: state set to ${nextStatus} (${err.message})`, "warn", "LOCAL", "ERRORS");
  }

  updateTaskUI();
}

// Confirmation Dialog before Confirming Final Delivery
function handleConfirmDeliveredClick() {
  if (!activeDelivery.orderId) {
    appendLog("No active order loaded.", "warn", "DELIVERY", "STATUS");
    return;
  }
  openConfirmDeliveryModal();
}

function openConfirmDeliveryModal() {
  const modal = document.getElementById("modal-confirm-delivery");
  if (modal) {
    setText("confirm-modal-order-id", activeDelivery.orderId || "—");
    setText("confirm-modal-address", routeDestination.address || "12 Independence Avenue, Windhoek");
    setText("confirm-modal-driver", `${activeDriver.name} (${activeDriver.id})`);
    modal.style.display = "flex";
  }
}

function closeConfirmDeliveryModal() {
  const modal = document.getElementById("modal-confirm-delivery");
  if (modal) modal.style.display = "none";
}

function confirmFinalDelivery() {
  closeConfirmDeliveryModal();
  updateDeliveryState("DELIVERED");
}

// ============================================================================
// 9. TRANSIT TIMER DISPLAY LOGIC
// ============================================================================

function restoreTransitTimers(orderId) {
  activeDelivery.departedAt = null;
  activeDelivery.deliveredAt = null;

  try {
    const dep = localStorage.getItem(`dsa_transit_departed_${orderId}`);
    if (dep) activeDelivery.departedAt = Number(dep);

    const del = localStorage.getItem(`dsa_transit_delivered_${orderId}`);
    if (del) activeDelivery.deliveredAt = Number(del);
  } catch (_) {}
}

function updateTransitTimer() {
  const isTransit = activeDelivery.status === "OUT_FOR_DELIVERY" || activeDelivery.status === "IN_TRANSIT";
  const isDelivered = activeDelivery.status === "DELIVERED";

  if (isTransit) {
    const departed = activeDelivery.departedAt || Date.now();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - departed) / 1000));
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const secs = String(elapsedSec % 60).padStart(2, "0");
    const timerStr = `${mins}:${secs}`;

    setText("state-transit-timer", timerStr);
    setText("mini-transit-time", timerStr);
    setText("task-transit-timer", `${timerStr} (In Transit)`);
  } else if (isDelivered) {
    if (activeDelivery.departedAt && activeDelivery.deliveredAt) {
      const elapsedSec = Math.max(0, Math.floor((activeDelivery.deliveredAt - activeDelivery.departedAt) / 1000));
      const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
      const secs = String(elapsedSec % 60).padStart(2, "0");
      const timerStr = `${mins}:${secs}`;

      setText("state-transit-timer", `${timerStr} (Completed)`);
      setText("mini-transit-time", timerStr);
      setText("task-transit-timer", `${timerStr} (Delivered)`);
    } else {
      setText("state-transit-timer", "Completed");
      setText("mini-transit-time", "00:00");
      setText("task-transit-timer", "Delivered");
    }
  } else {
    setText("state-transit-timer", "00:00");
    setText("mini-transit-time", "--:--");
    setText("task-transit-timer", "--:-- (Not Departed)");
  }
}

// ============================================================================
// 10. UI SYNCHRONIZATION & TELEMETRY METRICS
// ============================================================================

function updateTaskUI() {
  // Tasks Tab Overview Card
  setText("task-order-id", activeDelivery.orderId || "—");
  setText("task-delivery-id", activeDelivery.deliveryId || "—");
  setText("task-driver-name", `${activeDriver.name} (${activeDriver.id})`);
  setText("task-vehicle-type", activeDriver.vehicleCategory);
  setText("task-origin-summary", routeOrigin.address);
  setText("task-dest-summary", routeDestination.address);

  // Status Detail description
  let detailDesc = "Waiting for order assignment";
  if (activeDelivery.status === "DRIVER_ASSIGNED") detailDesc = "Courier assigned — En route to restaurant pickup";
  else if (activeDelivery.status === "AT_RESTAURANT") detailDesc = "Courier arrived at restaurant — collecting order";
  else if (activeDelivery.status === "OUT_FOR_DELIVERY" || activeDelivery.status === "IN_TRANSIT")
    detailDesc = "Order collected — Transit to customer dropoff";
  setText("task-status-detail", detailDesc);

  // Working Shift Schedule Readout
  const sched = activeDriver.schedule || { startTime: "06:00", endTime: "22:00", slot: "FULL" };
  setText("task-driver-shift", `${sched.startTime} - ${sched.endTime} (${sched.slot || "FULL"})`);

  // Subcard Origin & Destination
  setText("subcard-origin-name", routeOrigin.name);
  setText("subcard-origin-address", routeOrigin.address);
  setText("subcard-dest-name", routeDestination.name);
  setText("subcard-dest-address", routeDestination.address);

  // State Controller Tab Card
  setText("state-controller-order-id", activeDelivery.orderId || "No Order Loaded");

  // Status Pill Styling
  const pill = document.getElementById("task-status-pill");
  if (pill) {
    pill.className = "status-pill";
    const st = activeDelivery.status;
    pill.textContent = st;

    if (st === "DRIVER_ASSIGNED") pill.classList.add("pill-info");
    else if (st === "AT_RESTAURANT") pill.classList.add("pill-warn");
    else if (st === "OUT_FOR_DELIVERY" || st === "IN_TRANSIT") pill.classList.add("pill-good");
    else if (st === "DELIVERED") pill.classList.add("pill-good");
    else pill.classList.add("pill-neutral");
  }

  // Visual Stepper Progression with Checkmarks & Pulse Ring
  const stateOrder = ["DRIVER_ASSIGNED", "AT_RESTAURANT", "OUT_FOR_DELIVERY", "DELIVERED"];
  const currentIndex = stateOrder.indexOf(activeDelivery.status);

  for (let i = 1; i <= 4; i++) {
    const nodeEl = document.getElementById(`step-node-${i}`);
    const circleEl = document.getElementById(`stepper-circle-${i}`);
    const connector = document.getElementById(`connector-${i}-${i + 1}`);

    const isPast = currentIndex >= 0 && i - 1 < currentIndex;
    const isCurrent = currentIndex >= 0 && i - 1 === currentIndex;
    const isFuture = currentIndex < 0 || i - 1 > currentIndex;

    if (nodeEl) {
      nodeEl.classList.remove("active", "completed", "disabled");
      if (isPast) nodeEl.classList.add("completed");
      else if (isCurrent) nodeEl.classList.add("active");
      else if (isFuture) nodeEl.classList.add("disabled");
    }

    if (circleEl) {
      if (isPast) {
        // SVG Checkmark icon for completed steps
        circleEl.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
      } else {
        circleEl.innerHTML = `<span class="step-num">${i}</span>`;
      }
    }

    if (connector) {
      connector.classList.toggle("completed", isPast);
    }
  }

  // Stepper Action Buttons
  const btnAccept = document.getElementById("btn-step-accept");
  const btnRest = document.getElementById("btn-step-restaurant");
  const btnTransit = document.getElementById("btn-step-transit");
  const btnDelivered = document.getElementById("btn-step-delivered");

  const isAssigned = activeDelivery.status === "DRIVER_ASSIGNED";
  const isAtRest = activeDelivery.status === "AT_RESTAURANT";
  const isTransit = activeDelivery.status === "OUT_FOR_DELIVERY" || activeDelivery.status === "IN_TRANSIT";
  const isDelivered = activeDelivery.status === "DELIVERED";
  const hasOrder = Boolean(activeDelivery.orderId);

  if (btnAccept) {
    btnAccept.classList.toggle("active-action", hasOrder && !isAssigned && !isAtRest && !isTransit && !isDelivered);
    btnAccept.disabled = !hasOrder || isAssigned || isAtRest || isTransit || isDelivered;
  }
  if (btnRest) {
    btnRest.classList.toggle("active-action", isAssigned);
    btnRest.disabled = !isAssigned;
  }
  if (btnTransit) {
    btnTransit.classList.toggle("active-action", isAtRest);
    btnTransit.disabled = !isAtRest;
  }
  if (btnDelivered) {
    btnDelivered.classList.toggle("active-action", isTransit);
    btnDelivered.disabled = !isTransit;
  }

  // Route & Telemetry Tab UI
  setText("origin-name", routeOrigin.name);
  setText("origin-address", routeOrigin.address);
  setText("origin-coords", `[${routeOrigin.lat.toFixed(4)}, ${routeOrigin.lon.toFixed(4)}]`);

  setText("dest-name", routeDestination.name);
  setText("dest-address", routeDestination.address);
  setText("dest-coords", `[${routeDestination.lat.toFixed(4)}, ${routeDestination.lon.toFixed(4)}]`);

  // Driver Coordinates Readout
  const curLat = activeDelivery.currentLocation.latitude;
  const curLon = activeDelivery.currentLocation.longitude;
  setText("driver-lat-display", curLat.toFixed(4));
  setText("driver-lon-display", curLon.toFixed(4));
  setText("mini-coords-readout", `${curLat.toFixed(4)}, ${curLon.toFixed(4)}`);

  const mapsLink = document.getElementById("link-google-maps");
  if (mapsLink) {
    mapsLink.href = `https://www.google.com/maps?q=${curLat},${curLon}`;
  }

  // Distance & ETA Calculations
  const distKm = calculateDistanceKm(curLat, curLon, routeDestination.lat, routeDestination.lon);
  setText("metric-distance-km", distKm.toFixed(1));
  setText("metric-eta-minutes", calculateETA(distKm));

  // Heading calculation
  const headingText = activeDelivery.heading === 180 ? "180° S" : `${activeDelivery.heading}°`;
  setText("metric-heading", headingText);
  setText("metric-speed", "30 km/h");

  // Trip Completion Percentage
  const totalTripKm = calculateDistanceKm(routeOrigin.lat, routeOrigin.lon, routeDestination.lat, routeDestination.lon);
  let percent = 0;
  if (activeDelivery.status === "DELIVERED") {
    percent = 100;
  } else if (totalTripKm > 0) {
    const traveledKm = Math.max(0, totalTripKm - distKm);
    percent = Math.min(95, Math.round((traveledKm / totalTripKm) * 100));
  }

  setText("route-progress-percentage", `${percent}%`);
  const bar = document.getElementById("route-progress-bar");
  if (bar) bar.style.width = `${percent}%`;

  // Update SVG Vector Map Vehicle Marker Position
  updateMapVehicle(curLat, curLon);
}

// ============================================================================
// 11. GOOGLE MAPS PLATFORM LIVE DISPATCH MAP
// AdvancedMarkerElement integration with mapId: 'DEMO_MAP_ID'
// ============================================================================

let driverGoogleMap = null;
let driverGmpMarkers = {
  restaurant: null,
  customer: null,
  driver: null
};
let driverRoutePolyline = null;
let isGmpInitialized = false;

async function initDriverGoogleMap() {
  const mapCanvas = document.getElementById("driver-google-map");
  const banner = document.getElementById("driver-map-banner");
  if (!mapCanvas) return;

  try {
    const { Map, AdvancedMarkerElement } = await window.loadGoogleMapsLibraries();
    
    const center = GOOGLE_MAPS_CONFIG.coordinates.windhoekCentral;
    driverGoogleMap = new Map(mapCanvas, {
      zoom: 14,
      center: { lat: center.lat, lng: center.lng },
      mapId: GOOGLE_MAPS_CONFIG.mapId, // Mandatory for AdvancedMarkerElement (CF9)
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: true
    });

    // 1. Restaurant Pin (Kapana Corner)
    const restPos = { lat: routeOrigin.lat, lng: routeOrigin.lon };
    const restEl = createCustomMarkerElement({
      type: "restaurant",
      title: routeOrigin.name || "Kapana Corner Restaurant",
      subtitle: `${routeOrigin.lat.toFixed(4)}, ${routeOrigin.lon.toFixed(4)}`
    });
    driverGmpMarkers.restaurant = new AdvancedMarkerElement({
      map: driverGoogleMap,
      position: restPos,
      title: routeOrigin.name || "Restaurant (Kapana Corner)",
      content: restEl
    });

    // 2. Customer Dropoff Pin
    const custPos = { lat: routeDestination.lat, lng: routeDestination.lon };
    const custEl = createCustomMarkerElement({
      type: "customer",
      title: routeDestination.name || "Customer Destination",
      subtitle: `${routeDestination.lat.toFixed(4)}, ${routeDestination.lon.toFixed(4)}`
    });
    driverGmpMarkers.customer = new AdvancedMarkerElement({
      map: driverGoogleMap,
      position: custPos,
      title: routeDestination.name || "Customer Destination",
      content: custEl
    });

    // 3. Courier Live Vehicle Marker
    const curLat = activeDelivery.currentLocation.latitude || center.lat;
    const curLon = activeDelivery.currentLocation.longitude || center.lng;
    const driverEl = createCustomMarkerElement({
      type: "driver",
      title: `${activeDriver.name || "Tomas Nekundi"} (${activeDriver.vehicleCategory || "Motorcycle"})`,
      subtitle: `${curLat.toFixed(4)}, ${curLon.toFixed(4)}`
    });
    driverGmpMarkers.driver = new AdvancedMarkerElement({
      map: driverGoogleMap,
      position: { lat: curLat, lng: curLon },
      title: `Courier: ${activeDriver.name}`,
      content: driverEl
    });

    // 4. Delivery trajectory polyline
    if (window.google?.maps?.Polyline) {
      driverRoutePolyline = new google.maps.Polyline({
        map: driverGoogleMap,
        path: [restPos, custPos],
        strokeColor: "#eb4d28",
        strokeOpacity: 0.8,
        strokeWeight: 4
      });
    }

    isGmpInitialized = true;
    if (banner) banner.style.display = "none";
    appendLog("Google Maps initialized with AdvancedMarkerElement on DEMO_MAP_ID.", "success", "MAP", "GPS");
  } catch (err) {
    console.warn("Google Maps load failed:", err);
    isGmpInitialized = false;
    if (banner) {
      banner.style.display = "flex";
      setText("driver-map-banner-text", `Google Maps Notice: ${err.message}. Click 'Set API Key' to configure credentials.`);
    }
    appendLog(`Google Maps initialization note: ${err.message}`, "warn", "MAP", "GPS");
  }
}

function promptApiKey() {
  const currentKey = localStorage.getItem("google_maps_api_key") || "";
  const input = prompt("Enter Google Maps Platform API Key (or leave empty for Maps Demo Key):", currentKey);
  if (input !== null) {
    localStorage.setItem("google_maps_api_key", input.trim());
    location.reload();
  }
}

function updateMapVehicle(lat, lon) {
  setText("map-courier-coords", `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`);

  // Update Google Maps AdvancedMarkerElement position
  if (driverGmpMarkers.driver) {
    driverGmpMarkers.driver.position = { lat: Number(lat), lng: Number(lon) };
    const subtitleEl = driverGmpMarkers.driver.content?.querySelector(".gmp-pin-subtitle");
    if (subtitleEl) {
      subtitleEl.textContent = `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
    }
  }

  // Update Google Maps Restaurant and Destination markers if order updated
  if (driverGmpMarkers.restaurant) {
    driverGmpMarkers.restaurant.position = { lat: routeOrigin.lat, lng: routeOrigin.lon };
  }
  if (driverGmpMarkers.customer) {
    driverGmpMarkers.customer.position = { lat: routeDestination.lat, lng: routeDestination.lon };
  }

  // Update Polyline
  if (driverRoutePolyline) {
    driverRoutePolyline.setPath([
      { lat: routeOrigin.lat, lng: routeOrigin.lon },
      { lat: Number(lat), lng: Number(lon) },
      { lat: routeDestination.lat, lng: routeDestination.lon }
    ]);
  }
}



// ============================================================================
// 12. GPS WAYPOINT SIMULATION & CONTINUOUS DRIVE
// ============================================================================

function setWaypoint(lat, lon, label) {
  activeDelivery.currentLocation.latitude = Number(lat);
  activeDelivery.currentLocation.longitude = Number(lon);

  appendLog(`Driver waypoint updated: ${label} [${lat}, ${lon}]`, "info", "GPS", "GPS");

  if (activeDelivery.orderId) {
    updateDeliveryState(activeDelivery.status, activeDelivery.currentLocation);
  } else {
    updateTaskUI();
  }
}

function startSimulatedDrive() {
  const label = document.getElementById("text-simulate-drive");

  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
    if (label) label.textContent = "Simulate Live Drive to Customer";
    appendLog("Simulated drive cancelled.", "warn", "SIM", "STATUS");
    return;
  }

  if (!activeDelivery.orderId) {
    appendLog("Please load an order before starting simulated drive.", "warn", "SIM", "STATUS");
    return;
  }

  if (label) label.textContent = "Stop Simulated Drive";
  appendLog("Starting live drive progression from pickup to customer...", "info", "SIM", "GPS");

  // Discrete waypoints representing Windhoek urban drive
  const driveWaypoints = [
    { lat: -22.5333, lon: 17.0658, status: "AT_RESTAURANT", label: "At Restaurant (Kapana Corner)" },
    { lat: -22.5375, lon: 17.0658, status: "OUT_FOR_DELIVERY", label: "Departing Katutura Single Quarters" },
    { lat: -22.5420, lon: 17.0658, status: "OUT_FOR_DELIVERY", label: "Independence Ave Northbound corridor" },
    { lat: -22.5471, lon: 17.0658, status: "OUT_FOR_DELIVERY", label: "Halfway En Route (Windhoek North)" },
    { lat: -22.5525, lon: 17.0658, status: "OUT_FOR_DELIVERY", label: "Approaching Sam Nujoma intersection" },
    { lat: -22.5580, lon: 17.0658, status: "OUT_FOR_DELIVERY", label: "Near Customer (Independence Ave CBD)" },
    { lat: -22.5600, lon: 17.0658, status: "OUT_FOR_DELIVERY", label: "Entering Customer Street" },
    { lat: -22.5609, lon: 17.0658, status: "DELIVERED", label: "At Customer Doorstep (Delivered)" }
  ];

  let stepIdx = 0;

  // Step through waypoints every 1000ms (1 second)
  simulationInterval = setInterval(() => {
    if (stepIdx >= driveWaypoints.length) {
      clearInterval(simulationInterval);
      simulationInterval = null;
      if (label) label.textContent = "Simulate Live Drive to Customer";
      appendLog("Simulated drive complete: Order delivered successfully.", "success", "SIM", "STATUS");
      return;
    }

    const wp = driveWaypoints[stepIdx];
    activeDelivery.currentLocation.latitude = wp.lat;
    activeDelivery.currentLocation.longitude = wp.lon;

    appendLog(`Transit simulation: ${wp.label} [${wp.lat}, ${wp.lon}]`, "info", "GPS", "GPS");
    updateDeliveryState(wp.status, activeDelivery.currentLocation);

    stepIdx++;
  }, 1000);
}

// ============================================================================
// 13. ACTIVITY LOGGING & CATEGORY FILTERING
// ============================================================================

function appendLog(message, type = "info", badge = "INFO", category = "STATUS") {
  const container = document.getElementById("event-log-stream");
  if (!container) return;

  const now = new Date().toTimeString().split(" ")[0];
  const row = document.createElement("div");
  row.className = `event-log-entry ${type}`;
  row.setAttribute("data-category", category);

  let badgeClass = "badge-info";
  if (type === "success") badgeClass = "badge-success";
  else if (type === "warn") badgeClass = "badge-warn";
  else if (type === "error") badgeClass = "badge-error";

  row.innerHTML = `
    <span class="log-time text-mono">${now}</span>
    <span class="log-badge ${badgeClass}">${escapeHtml(badge)}</span>
    <span class="log-message">${escapeHtml(message)}</span>
  `;

  // Respect current active filter
  if (activeLogFilter !== "ALL") {
    if (activeLogFilter === "ERRORS" && type !== "error" && type !== "warn") {
      row.style.display = "none";
    } else if (activeLogFilter !== "ERRORS" && category !== activeLogFilter) {
      row.style.display = "none";
    }
  }

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function filterLogs(filterCategory) {
  activeLogFilter = filterCategory;

  // Update button classes
  document.querySelectorAll(".log-filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-filter") === filterCategory);
  });

  // Filter entries in stream
  document.querySelectorAll("#event-log-stream .event-log-entry").forEach((entry) => {
    const entryCat = entry.getAttribute("data-category") || "STATUS";
    const isError = entry.classList.contains("error") || entry.classList.contains("warn");

    if (filterCategory === "ALL") {
      entry.style.display = "flex";
    } else if (filterCategory === "ERRORS") {
      entry.style.display = isError ? "flex" : "none";
    } else {
      entry.style.display = entryCat === filterCategory ? "flex" : "none";
    }
  });
}

function clearLog() {
  const container = document.getElementById("event-log-stream");
  if (container) {
    container.innerHTML = `
      <div class="event-log-entry info" data-category="STATUS">
        <span class="log-time text-mono">${new Date().toTimeString().split(" ")[0]}</span>
        <span class="log-badge badge-info">RESET</span>
        <span class="log-message">Activity log stream reset.</span>
      </div>
    `;
  }
}

// ============================================================================
// 14. HELPERS & EVENT SETUP
// ============================================================================

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setupEventListeners() {
  // Navigation Tabs
  setupNavTabs();

  // Search Load Order
  const loadBtn = document.getElementById("btn-load-order");
  const orderInput = document.getElementById("order-id-input");

  if (loadBtn && orderInput) {
    loadBtn.addEventListener("click", () => loadOrder(orderInput.value));
    orderInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadOrder(orderInput.value);
      }
    });
  }

  // Quick GPS waypoint buttons
  document.getElementById("sim-btn-restaurant")?.addEventListener("click", () =>
    setWaypoint(-22.5333, 17.0658, "At Restaurant")
  );
  document.getElementById("sim-btn-halfway")?.addEventListener("click", () =>
    setWaypoint(-22.5471, 17.0658, "Halfway En Route")
  );
  document.getElementById("sim-btn-near")?.addEventListener("click", () =>
    setWaypoint(-22.5580, 17.0658, "Near Customer")
  );
  document.getElementById("sim-btn-doorstep")?.addEventListener("click", () =>
    setWaypoint(-22.5609, 17.0658, "At Customer Doorstep")
  );

  // Close modals on backdrop click
  const profileModal = document.getElementById("modal-courier-profile");
  if (profileModal) {
    profileModal.addEventListener("click", (e) => {
      if (e.target === profileModal) closeCourierProfileModal();
    });
  }

  const confirmModal = document.getElementById("modal-confirm-delivery");
  if (confirmModal) {
    confirmModal.addEventListener("click", (e) => {
      if (e.target === confirmModal) closeConfirmDeliveryModal();
    });
  }

  // Close shift date/time picker on outside click
  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".shift-datetime-picker-wrap");
    if (wrap && !wrap.contains(e.target)) {
      closeShiftDateTimePicker();
    }
  });

  // Close modals and popups on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCourierProfileModal();
      closeConfirmDeliveryModal();
      closeShiftDateTimePicker();
    }
  });
}

// ============================================================================
// 15. CUSTOM SHIFT DATE & TIME PICKER CONTROLLER
// ============================================================================

let activeShiftFilter = {
  preset: "today",
  date: new Date().toISOString().split("T")[0],
  startTime: "06:00",
  endTime: "22:00",
  slot: "FULL"
};

let shiftCalViewYear = new Date().getFullYear();
let shiftCalViewMonth = new Date().getMonth(); // 0-indexed
let selectedShiftDate = new Date().toISOString().split("T")[0];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function renderShiftCalendar() {
  const monthTitle = document.getElementById("shift-cal-month-title");
  if (monthTitle) {
    monthTitle.textContent = `${MONTH_NAMES[shiftCalViewMonth]} ${shiftCalViewYear}`;
  }

  const grid = document.getElementById("shift-cal-days-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const firstDayIndex = new Date(shiftCalViewYear, shiftCalViewMonth, 1).getDay();
  const totalDays = new Date(shiftCalViewYear, shiftCalViewMonth + 1, 0).getDate();
  const todayStr = new Date().toISOString().split("T")[0];

  // Padding empty cells before day 1
  for (let i = 0; i < firstDayIndex; i++) {
    const empty = document.createElement("span");
    empty.className = "calendar-day-btn disabled";
    grid.appendChild(empty);
  }

  // Days in month
  for (let d = 1; d <= totalDays; d++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calendar-day-btn";
    btn.textContent = d;

    const mStr = String(shiftCalViewMonth + 1).padStart(2, "0");
    const dStr = String(d).padStart(2, "0");
    const thisDateStr = `${shiftCalViewYear}-${mStr}-${dStr}`;

    if (thisDateStr === todayStr) btn.classList.add("today");
    if (thisDateStr === selectedShiftDate) btn.classList.add("selected");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedShiftDate = thisDateStr;
      activeShiftFilter.date = thisDateStr;
      activeShiftFilter.preset = "custom";

      // Clear active presets
      document.querySelectorAll(".shift-presets-row .btn-preset").forEach((b) => b.classList.remove("active"));

      const dateInput = document.getElementById("shift-input-date");
      if (dateInput) dateInput.value = thisDateStr;

      renderShiftCalendar();
      updateShiftSubtitle();
    });

    grid.appendChild(btn);
  }
}

function prevShiftCalMonth() {
  shiftCalViewMonth--;
  if (shiftCalViewMonth < 0) {
    shiftCalViewMonth = 11;
    shiftCalViewYear--;
  }
  renderShiftCalendar();
}

function nextShiftCalMonth() {
  shiftCalViewMonth++;
  if (shiftCalViewMonth > 11) {
    shiftCalViewMonth = 0;
    shiftCalViewYear++;
  }
  renderShiftCalendar();
}

function updateShiftSubtitle() {
  const subtitle = document.getElementById("shift-dropdown-subtitle");
  if (!subtitle) return;

  const dateLabel = selectedShiftDate || "All Dates";
  subtitle.textContent = `${dateLabel} (${activeShiftFilter.startTime} - ${activeShiftFilter.endTime})`;
}

function toggleShiftDateTimePicker() {
  const dd = document.getElementById("shift-datetime-dropdown");
  if (!dd) return;
  const isVisible = dd.style.display !== "none";
  dd.style.display = isVisible ? "none" : "block";

  if (!isVisible) {
    if (activeShiftFilter.date) {
      selectedShiftDate = activeShiftFilter.date;
      const parts = activeShiftFilter.date.split("-");
      if (parts.length === 3) {
        shiftCalViewYear = Number(parts[0]);
        shiftCalViewMonth = Number(parts[1]) - 1;
      }
    }
    renderShiftCalendar();
    updateShiftSubtitle();

    const startInput = document.getElementById("shift-input-start");
    const endInput = document.getElementById("shift-input-end");
    if (startInput) startInput.value = activeShiftFilter.startTime;
    if (endInput) endInput.value = activeShiftFilter.endTime;
  }
}

function closeShiftDateTimePicker() {
  const dd = document.getElementById("shift-datetime-dropdown");
  if (dd) dd.style.display = "none";
}

function selectShiftPreset(preset) {
  activeShiftFilter.preset = preset;

  document.querySelectorAll(".shift-presets-row .btn-preset").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-shift-preset") === preset);
  });

  const now = new Date();
  if (preset === "today") {
    selectedShiftDate = now.toISOString().split("T")[0];
    shiftCalViewYear = now.getFullYear();
    shiftCalViewMonth = now.getMonth();
    activeShiftFilter.date = selectedShiftDate;
    activeShiftFilter.startTime = "06:00";
    activeShiftFilter.endTime = "22:00";
    activeShiftFilter.slot = "FULL";
  } else if (preset === "yesterday") {
    const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    selectedShiftDate = yest.toISOString().split("T")[0];
    shiftCalViewYear = yest.getFullYear();
    shiftCalViewMonth = yest.getMonth();
    activeShiftFilter.date = selectedShiftDate;
    activeShiftFilter.startTime = "06:00";
    activeShiftFilter.endTime = "22:00";
    activeShiftFilter.slot = "FULL";
  } else if (preset === "7days") {
    const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    selectedShiftDate = now.toISOString().split("T")[0];
    shiftCalViewYear = now.getFullYear();
    shiftCalViewMonth = now.getMonth();
    activeShiftFilter.date = selectedShiftDate;
    activeShiftFilter.startTime = "00:00";
    activeShiftFilter.endTime = "23:59";
    activeShiftFilter.slot = "FULL";
  } else {
    selectedShiftDate = "";
    activeShiftFilter.date = "";
    activeShiftFilter.startTime = "00:00";
    activeShiftFilter.endTime = "23:59";
    activeShiftFilter.slot = "FULL";
  }

  const startInput = document.getElementById("shift-input-start");
  const endInput = document.getElementById("shift-input-end");
  const dateInput = document.getElementById("shift-input-date");
  if (startInput) startInput.value = activeShiftFilter.startTime;
  if (endInput) endInput.value = activeShiftFilter.endTime;
  if (dateInput) dateInput.value = activeShiftFilter.date;

  // Sync slot pills
  document.querySelectorAll(".shift-slots-row .btn-slot-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-slot") === activeShiftFilter.slot);
  });

  renderShiftCalendar();
  updateShiftSubtitle();
}

function applyShiftWindowSlot(slot) {
  activeShiftFilter.slot = slot;

  document.querySelectorAll(".shift-slots-row .btn-slot-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-slot") === slot);
  });

  const slotSelect = document.getElementById("shift-select-slot");
  if (slotSelect) slotSelect.value = slot;

  if (slot === "MORNING") {
    activeShiftFilter.startTime = "06:00";
    activeShiftFilter.endTime = "14:00";
  } else if (slot === "AFTERNOON") {
    activeShiftFilter.startTime = "14:00";
    activeShiftFilter.endTime = "22:00";
  } else if (slot === "NIGHT") {
    activeShiftFilter.startTime = "22:00";
    activeShiftFilter.endTime = "06:00";
  } else {
    activeShiftFilter.startTime = "06:00";
    activeShiftFilter.endTime = "22:00";
  }

  const startInput = document.getElementById("shift-input-start");
  const endInput = document.getElementById("shift-input-end");
  if (startInput) startInput.value = activeShiftFilter.startTime;
  if (endInput) endInput.value = activeShiftFilter.endTime;

  updateShiftSubtitle();
}

function handleShiftTimeChange() {
  const startInput = document.getElementById("shift-input-start");
  const endInput = document.getElementById("shift-input-end");

  if (startInput) activeShiftFilter.startTime = startInput.value || "06:00";
  if (endInput) activeShiftFilter.endTime = endInput.value || "22:00";

  updateShiftSubtitle();
}

function applyShiftDateTimeFilter() {
  const startInput = document.getElementById("shift-input-start");
  const endInput = document.getElementById("shift-input-end");

  if (startInput) activeShiftFilter.startTime = startInput.value;
  if (endInput) activeShiftFilter.endTime = endInput.value;
  activeShiftFilter.date = selectedShiftDate;

  const label = document.getElementById("shift-datetime-label");
  if (label) {
    if (activeShiftFilter.preset === "today") {
      label.textContent = `Today (${activeShiftFilter.startTime}-${activeShiftFilter.endTime})`;
    } else if (activeShiftFilter.preset === "yesterday") {
      label.textContent = `Yesterday (${activeShiftFilter.startTime}-${activeShiftFilter.endTime})`;
    } else if (activeShiftFilter.preset === "7days") {
      label.textContent = "Last 7 Days";
    } else if (activeShiftFilter.date) {
      label.textContent = `${activeShiftFilter.date} (${activeShiftFilter.startTime}-${activeShiftFilter.endTime})`;
    } else {
      label.textContent = "All Shifts";
    }
  }

  closeShiftDateTimePicker();
  appendLog(
    `Shift date & time filter applied: [Date: ${activeShiftFilter.date || "All"}, Window: ${activeShiftFilter.startTime} - ${activeShiftFilter.endTime}]`,
    "info",
    "SHIFT",
    "STATUS"
  );
}

function resetShiftDateTimeFilter() {
  selectShiftPreset("today");
  applyShiftDateTimeFilter();
}

// Initial Boot
document.addEventListener("DOMContentLoaded", () => {
  loadSavedDriverProfile();
  setupEventListeners();
  renderShiftCalendar();
  updateShiftSubtitle();
  checkServicesHealth();
  refreshPlatformOrderChips();
  loadDeliveryInstructions("ord_101");
  updateTaskUI();
  if (typeof initDriverGoogleMap === "function") initDriverGoogleMap();

  if (typeof initCustomDropdownMenus === "function") initCustomDropdownMenus();
  if (typeof initCustomDateTimePickers === "function") initCustomDateTimePickers();

  // Periodic Service Health and Platform Orders refresh
  setInterval(checkServicesHealth, 5000);
  setInterval(refreshPlatformOrderChips, 4000);

  // 1-second interval for transit timer calculations
  transitTimerInterval = setInterval(updateTransitTimer, 1000);
});

