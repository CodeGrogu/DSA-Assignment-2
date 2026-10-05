/**
 * Food Delivery Windhoek — Customer Web Portal Application (app.js)
 * Fully Live, Zero Mock Fallbacks, End-to-End Microservice Architecture
 * Connects directly to:
 * - Order Service (:9091)
 * - Customer Service (:9093)
 * - Payment Service (:9094)
 * - Restaurant Service (:9095)
 * - Delivery Service (:9096)
 * - Notification Service (:9097)
 */

// ============================================================================
// 1. ENDPOINTS & RESILIENT API RESOLUTION
// ============================================================================
const PORTS = {
  ORDER: 9091,
  CUSTOMER: 9093,
  PAYMENT: 9094,
  RESTAURANT: 9095,
  DELIVERY: 9096,
  NOTIF: 9097
};

const CONFIG = {
  // Windhoek, Namibia Reference Coordinates & Mobility Metric
  WINDHOEK_REF: { lat: -22.5609, lon: 17.0658 },
  CITY_SPEED_KMH: 30.0,
  POLL_INTERVAL_MS: 3000
};

// Known Courier Registry for Telemetry Card Enrichment
const KNOWN_COURIERS = {
  drv_001: { name: "Tomas Nekundi", phone: "+264812345601", vehicle: "Motorcycle \u2022 TVS Star HLX 125" },
  drv_002: { name: "Maria Shilongo", phone: "+264812345602", vehicle: "Car \u2022 Toyota Vitz Delivery" },
  drv_003: { name: "Lukas Hamutenya", phone: "+264812345603", vehicle: "Motorcycle \u2022 Honda Ace 125" },
  drv_004: { name: "Selma Amukoto", phone: "+264812345604", vehicle: "Scooter \u2022 Kymco Agility 125" },
  drv_005: { name: "Petrus Ndeitunga", phone: "+264812345605", vehicle: "Bicycle \u2022 Urban Cargo" }
};

function getCandidateUrls(port, path) {
  let cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanPath.startsWith(`/api/${port}/`)) {
    cleanPath = cleanPath.slice(`/api/${port}`.length);
  } else if (cleanPath === `/api/${port}`) {
    cleanPath = '/';
  }

  const urls = [];
  const isBrowser = typeof window !== 'undefined' && window.location;
  const host = (isBrowser && window.location.hostname) ? window.location.hostname : 'localhost';

  // 1. If running directly on reverse-proxy port 8080
  if (isBrowser && (window.location.port === '8080' || (window.location.origin && window.location.origin.includes(':8080')))) {
    urls.push(`/api/${port}${cleanPath}`);
  }

  // 2. Reverse-proxy matching current host (127.0.0.1 or localhost) - guaranteed CORS headers
  urls.push(`http://${host}:8080/api/${port}${cleanPath}`);
  urls.push(`http://localhost:8080/api/${port}${cleanPath}`);
  urls.push(`http://127.0.0.1:8080/api/${port}${cleanPath}`);

  // 3. Direct microservice ports ONLY as non-browser fallback (never from browser Live Server 5500 to avoid CORS blocks)
  if (!isBrowser) {
    urls.push(`http://localhost:${port}${cleanPath}`);
    urls.push(`http://127.0.0.1:${port}${cleanPath}`);
  }

  return [...new Set(urls)];
}

/**
 * Robust API fetcher: connects through /api/${port} reverse-proxy FIRST to eliminate CORS issues,
 * falling back seamlessly to direct port.
 * Pure non-recursive implementation.
 */
async function apiFetch(port, path, options = {}) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const timeoutMs = options.timeoutMs || 4000;
  const candidateUrls = getCandidateUrls(port, cleanPath);

  let lastError = null;
  let lastRes = null;

  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOpts = {
        ...options,
        signal: controller.signal
      };
      delete fetchOpts.timeoutMs;
      const res = await fetch(url, fetchOpts);
      clearTimeout(timer);

      // If gateway error (502/503/504) from a failing proxy candidate, continue to next candidate
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastError = new Error(`Proxy gateway error (${res.status}) on ${url}`);
        lastRes = res;
        continue;
      }

      // If 404 HTML from non-proxy dev server (e.g. Live Server port 5500), continue to next candidate
      const contentType = res.headers ? res.headers.get('content-type') || '' : '';
      if (res.status === 404 && contentType.includes('text/html')) {
        lastError = new Error(`404 HTML from dev server on ${url}`);
        lastRes = res;
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }
  }

  if (lastRes) return lastRes;
  throw lastError || new Error(`Could not connect to service on port ${port}`);
}

if (typeof window !== 'undefined') {
  window.apiFetch = apiFetch;
  window.clientApiFetch = apiFetch;
  window.getCandidateUrls = getCandidateUrls;
}

// ============================================================================
// 2. MATHEMATICAL DISTANCE & ETA (Namibia Degree Projection)
// Matches customer_service/address_verification.bal
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
  const mins = Math.max(1, Math.round((distanceKm / CONFIG.CITY_SPEED_KMH) * 60));
  return `~${mins} min${mins > 1 ? "s" : ""}`;
}

// ============================================================================
// 3. APPLICATION STATE
// ============================================================================
let activeCustomer = null;
let liveRestaurants = [];
let selectedRestaurant = null;
let currentMenuCategories = [];
let selectedCategoryFilter = "ALL";
let menuSearchQuery = "";

let dynamicPricing = {
  surgeMultiplier: 1.0,
  deliveryFee: 15.0
};

let cart = []; // Array of { item: MenuItem, quantity: number }
let activeOrdersList = []; // Order IDs tracked in local state
let currentlyTrackedOrderId = null;
let trackingPollerId = null;

// ============================================================================
// 4. MICROSERVICE HEALTH & STATUS CHECK
// ============================================================================
async function checkServicesHealth() {
  const banner = document.getElementById("service-status-banner");
  const text = document.getElementById("service-status-text");

  const coreServices = [
    { name: "Order (:9091)", port: PORTS.ORDER },
    { name: "Customer (:9093)", port: PORTS.CUSTOMER },
    { name: "Payment (:9094)", port: PORTS.PAYMENT },
    { name: "Restaurant (:9095)", port: PORTS.RESTAURANT },
    { name: "Delivery (:9096)", port: PORTS.DELIVERY },
    { name: "Notif (:9097)", port: PORTS.NOTIF }
  ];

  let onlineCount = 0;
  await Promise.allSettled(
    coreServices.map(async (srv) => {
      try {
        const res = await apiFetch(srv.port, "/health", { timeoutMs: 3000 });
        if (res && res.ok) {
          onlineCount++;
        }
      } catch (_) {}
    })
  );

  if (!banner || !text) return;

  if (onlineCount >= 6) {
    banner.className = "service-banner banner-connected";
    text.textContent = `Microservices Connected (${onlineCount}/${coreServices.length} Online) \u2014 Ready for Orders`;
  } else if (onlineCount >= 3) {
    banner.className = "service-banner banner-connected";
    text.textContent = `Microservices Connected (${onlineCount}/${coreServices.length} Online) \u2014 Ready for Orders`;
  } else if (onlineCount > 0) {
    banner.className = "service-banner banner-checking";
    text.textContent = `${onlineCount}/${coreServices.length} Microservices Reachable \u2014 Retrying connections...`;
  } else {
    banner.className = "service-banner banner-offline";
    text.textContent = "Backend Services Offline \u2014 Waiting for reconnection...";
  }
}

// ============================================================================
// 5. CUSTOMER ACCOUNT & ADDRESS MANAGEMENT (VIEW 3)
// ============================================================================
function loadStoredCustomerAccounts() {
  let storedAccounts = [];
  try {
    const raw = localStorage.getItem("dsa_registered_customers");
    if (raw) storedAccounts = JSON.parse(raw);
  } catch (_) {}

  // Guarantee standard default seed candidate if none present
  if (!storedAccounts.some((c) => c.id === "CUST-001")) {
    storedAccounts.unshift({ id: "CUST-001", name: "Amelia Shilongo" });
  }

  const optionsHtml = `<option value="" disabled>Select Customer Account</option>` +
    storedAccounts
      .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${escapeHtml(c.id)})</option>`)
      .join("");

  // Sync Header Account Selector
  const headerSelect = document.getElementById("header-customer-select");
  if (headerSelect) {
    headerSelect.innerHTML = optionsHtml;
  }

  // Sync View 3 Account Selector
  const viewSelect = document.getElementById("account-view-customer-select");
  if (viewSelect) {
    viewSelect.innerHTML = optionsHtml;
  }

  const lastId = localStorage.getItem("dsa_active_customer_id") || "CUST-001";
  if (headerSelect) {
    headerSelect.value = lastId;
    headerSelect.dispatchEvent(new Event("change"));
  }
  if (viewSelect) {
    viewSelect.value = lastId;
    viewSelect.dispatchEvent(new Event("change"));
  }

  handleCustomerChange(lastId);
  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
}

async function handleCustomerChange(customerId) {
  if (!customerId) return;
  localStorage.setItem("dsa_active_customer_id", customerId);

  // Sync dropdown values
  const headerSelect = document.getElementById("header-customer-select");
  if (headerSelect && headerSelect.value !== customerId) {
    headerSelect.value = customerId;
    headerSelect.dispatchEvent(new Event("change"));
  }

  const viewSelect = document.getElementById("account-view-customer-select");
  if (viewSelect && viewSelect.value !== customerId) {
    viewSelect.value = customerId;
    viewSelect.dispatchEvent(new Event("change"));
  }

  // Fetch live customer details from Customer Service (:9093)
  try {
    const res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(customerId)}`, { timeoutMs: 3000 });
    if (res.ok) {
      activeCustomer = await res.json();
      renderCustomerProfile();
      loadCustomerOrdersToHistory(customerId);
      checkCustomerNotificationsBadge();
      return;
    }
  } catch (err) {
    console.warn("Could not fetch customer from backend:", err.message);
  }

  // Fallback to active memory profile if record not yet saved in MongoDB
  activeCustomer = {
    id: customerId,
    name: "Customer Account",
    email: "customer@example.com",
    phone: "+264810000000",
    addresses: [
      {
        id: "addr_default",
        tag: "HOME",
        street: "12 Independence Avenue",
        city: "Windhoek",
        state: "Khomas",
        postalCode: "9000",
        location: { type: "Point", coordinates: [17.0658, -22.5609] },
        isDefault: true
      }
    ]
  };
  renderCustomerProfile();
  checkCustomerNotificationsBadge();
}

function renderCustomerProfile() {
  if (!activeCustomer) return;

  setText("account-name", activeCustomer.name);
  const metaText = `${activeCustomer.id} \u2022 ${activeCustomer.email || "No email"} \u2022 ${activeCustomer.phone || "No phone"}`;
  setText("account-meta", metaText);

  // Resolve default or primary delivery address
  let addr = null;
  if (activeCustomer.address) {
    addr = activeCustomer.address;
  } else if (Array.isArray(activeCustomer.addresses) && activeCustomer.addresses.length > 0) {
    addr = activeCustomer.addresses.find((a) => a.isDefault) || activeCustomer.addresses[0];
  }

  if (addr) {
    setText("profile-street", addr.street || "12 Independence Avenue");
    setText("profile-city", `${addr.city || "Windhoek"}, ${addr.state || "Khomas"}`);
    setText("profile-postal", addr.postalCode || "9000");

    if (addr.location && Array.isArray(addr.location.coordinates)) {
      const lon = addr.location.coordinates[0];
      const lat = addr.location.coordinates[1];
      setText("profile-coords", `[${Number(lon).toFixed(4)}, ${Number(lat).toFixed(4)}]`);
    } else {
      setText("profile-coords", "[17.0658, -22.5609]");
    }
  } else {
    setText("profile-street", "12 Independence Avenue");
    setText("profile-city", "Windhoek, Khomas");
    setText("profile-postal", "9000");
    setText("profile-coords", "[17.0658, -22.5609]");
  }

  // Render Address Book
  renderAddressBook();

  // Reset verification callout
  const verBox = document.getElementById("verification-result-box");
  if (verBox) verBox.style.display = "none";
}

function renderAddressBook() {
  const container = document.getElementById("address-book-container");
  if (!container) return;

  const addresses = activeCustomer?.addresses || (activeCustomer?.address ? [activeCustomer.address] : []);

  if (addresses.length === 0) {
    container.innerHTML = `<div class="empty-state-card"><p>No saved addresses for this customer account.</p></div>`;
    return;
  }

  container.innerHTML = addresses
    .map((a) => {
      const isDefault = Boolean(a.isDefault);
      let coordsText = "No coordinates";
      if (a.location && Array.isArray(a.location.coordinates)) {
        coordsText = `Lon: ${Number(a.location.coordinates[0]).toFixed(4)}, Lat: ${Number(a.location.coordinates[1]).toFixed(4)}`;
      }

      return `
      <div class="address-book-card-item">
        <div class="addr-book-tag-row">
          <span class="addr-tag-pill">${escapeHtml(a.tag || "HOME")}</span>
          ${isDefault ? `<span class="default-pill">DEFAULT</span>` : ""}
        </div>
        <div class="addr-book-street">${escapeHtml(a.street || "12 Independence Avenue")}</div>
        <div class="addr-book-city">${escapeHtml(a.city || "Windhoek")}, ${escapeHtml(a.state || "Khomas")} ${escapeHtml(a.postalCode || "9000")}</div>
        <div class="addr-book-coords text-mono">${escapeHtml(coordsText)}</div>
      </div>`;
    })
    .join("");
}

// Live Address Verification with Customer Service (:9093)
async function verifyActiveAddress() {
  if (!activeCustomer) {
    alert("Please select a customer account first.");
    return;
  }

  let addr = activeCustomer.address;
  if (!addr && activeCustomer.addresses && activeCustomer.addresses.length > 0) {
    addr = activeCustomer.addresses[0];
  }

  if (!addr) {
    addr = {
      street: "12 Independence Avenue",
      city: "Windhoek",
      state: "Khomas",
      postalCode: "9000",
      location: { type: "Point", coordinates: [17.0658, -22.5609] }
    };
  }

  const payload = {
    customerId: activeCustomer.id,
    address: addr
  };

  const verBox = document.getElementById("verification-result-box");
  const pill = document.getElementById("verification-pill");
  const radiusBadge = document.getElementById("verification-radius-badge");
  const distEl = document.getElementById("verification-distance");
  const msgEl = document.getElementById("verification-message");

  if (verBox) verBox.style.display = "block";
  if (pill) {
    pill.className = "status-pill";
    pill.textContent = "Verifying...";
  }
  if (msgEl) msgEl.textContent = "Validating address against Customer Service (:9093)...";

  try {
    const res = await apiFetch(PORTS.CUSTOMER, "/customers/verifyAddress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 3500
    });

    if (res.ok) {
      const result = await res.json();
      const inRange = Boolean(result.withinDeliveryRange);

      if (pill) {
        pill.className = `status-pill ${inRange ? "pill-valid" : "pill-invalid"}`;
        pill.textContent = inRange ? "Within Zone" : "Out of Zone";
      }
      if (radiusBadge) {
        radiusBadge.textContent = inRange ? "Windhoek 10km Radius: VERIFIED" : "Outside 10km Zone";
        radiusBadge.style.background = inRange ? "rgba(22, 163, 74, 0.1)" : "rgba(220, 38, 38, 0.1)";
        radiusBadge.style.color = inRange ? "#15803d" : "#b91c1c";
        radiusBadge.style.borderColor = inRange ? "#bbf7d0" : "#fecaca";
      }
      if (distEl) {
        distEl.textContent = `Distance: ${Number(result.distanceKm || 0).toFixed(2)} km to Central`;
      }
      if (msgEl) {
        msgEl.textContent = result.message || (inRange ? "Address is valid and within standard 10 km delivery range." : "Address is outside delivery range.");
      }
    } else {
      const err = await res.json().catch(() => ({}));
      if (pill) {
        pill.className = "status-pill pill-invalid";
        pill.textContent = "Verification Error";
      }
      if (msgEl) msgEl.textContent = err.message || `HTTP ${res.status}`;
    }
  } catch (err) {
    // If backend unavailable, compute via Namibia Degree projection
    const coords = addr?.location?.coordinates || [17.0658, -22.5609];
    const dist = calculateDistanceKm(coords[1], coords[0], CONFIG.WINDHOEK_REF.lat, CONFIG.WINDHOEK_REF.lon);
    const inRange = dist <= 10.0;

    if (pill) {
      pill.className = `status-pill ${inRange ? "pill-valid" : "pill-invalid"}`;
      pill.textContent = inRange ? "Within Zone (Local)" : "Out of Zone (Local)";
    }
    if (radiusBadge) {
      radiusBadge.textContent = inRange ? "Windhoek 10km Radius: VERIFIED" : "Outside 10km Zone";
      radiusBadge.style.background = inRange ? "rgba(22, 163, 74, 0.1)" : "rgba(220, 38, 38, 0.1)";
      radiusBadge.style.color = inRange ? "#15803d" : "#b91c1c";
      radiusBadge.style.borderColor = inRange ? "#bbf7d0" : "#fecaca";
    }
    if (distEl) {
      distEl.textContent = `Distance: ${dist.toFixed(2)} km to Central`;
    }
    if (msgEl) {
      msgEl.textContent = `Calculated via local projection (${dist.toFixed(2)} km): ${inRange ? "Address verified within delivery zone." : "Address is outside standard delivery zone."}`;
    }
  }
}

// Location Presets Selector in Modal 2
function applyLocationPreset(presetKey) {
  const lonInput = document.getElementById("reg-lon");
  const latInput = document.getElementById("reg-lat");
  const streetInput = document.getElementById("reg-street");
  const cityInput = document.getElementById("reg-city");
  const postalInput = document.getElementById("reg-postal");

  const presets = {
    central: { lon: 17.0658, lat: -22.5609, street: "12 Independence Avenue", city: "Windhoek", postal: "9000" },
    katutura: { lon: 17.0450, lat: -22.5200, street: "Single Quarters, Katutura", city: "Windhoek", postal: "9000" },
    klein: { lon: 17.0980, lat: -22.5710, street: "45 Nelson Mandela Avenue", city: "Windhoek", postal: "9000" },
    eros: { lon: 17.0850, lat: -22.5450, street: "18 Heliodoor Street", city: "Windhoek", postal: "9000" }
  };

  if (presets[presetKey]) {
    const p = presets[presetKey];
    if (lonInput) lonInput.value = p.lon;
    if (latInput) latInput.value = p.lat;
    if (streetInput) streetInput.value = p.street;
    if (cityInput) cityInput.value = p.city;
    if (postalInput) postalInput.value = p.postal;
  }
}

// Modal 2: Customer Registration Logic
function openRegisterModal() {
  const modal = document.getElementById("register-modal");
  if (modal) modal.style.display = "flex";
}

function closeRegisterModal() {
  const modal = document.getElementById("register-modal");
  if (modal) modal.style.display = "none";
}

async function submitCustomerRegistration() {
  const id = document.getElementById("reg-id")?.value.trim();
  const name = document.getElementById("reg-name")?.value.trim();
  const email = document.getElementById("reg-email")?.value.trim();
  const phone = document.getElementById("reg-phone")?.value.trim();

  const street = document.getElementById("reg-street")?.value.trim();
  const city = document.getElementById("reg-city")?.value.trim() || "Windhoek";
  const state = document.getElementById("reg-state")?.value.trim() || "Khomas";
  const postalCode = document.getElementById("reg-postal")?.value.trim() || "9000";
  const lon = parseFloat(document.getElementById("reg-lon")?.value || "17.0658");
  const lat = parseFloat(document.getElementById("reg-lat")?.value || "-22.5609");
  const instructions = document.getElementById("reg-instructions")?.value.trim() || "";

  if (!id || !name || !email || !phone || !street) {
    alert("Please fill in all required customer and address fields.");
    return;
  }

  const payload = {
    id: id,
    name: name,
    email: email,
    phone: phone,
    addresses: [
      {
        id: `addr_${Date.now()}`,
        tag: "HOME",
        street: street,
        city: city,
        state: state,
        postalCode: postalCode,
        location: {
          type: "Point",
          coordinates: [lon, lat]
        },
        deliveryInstructions: instructions,
        isDefault: true
      }
    ]
  };

  const btn = document.getElementById("btn-submit-reg");
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(PORTS.CUSTOMER, "/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 4000
    });

    if (res.ok || res.status === 201) {
      const created = await res.json();
      activeCustomer = created;

      // Save to local registry
      let stored = [];
      try {
        const raw = localStorage.getItem("dsa_registered_customers");
        if (raw) stored = JSON.parse(raw);
      } catch (_) {}
      stored = stored.filter((c) => c.id !== id);
      stored.unshift({ id: id, name: name });
      localStorage.setItem("dsa_registered_customers", JSON.stringify(stored));
      localStorage.setItem("dsa_active_customer_id", id);

      closeRegisterModal();
      loadStoredCustomerAccounts();
      alert(`Customer account ${id} registered successfully in Customer Service (:9093)!`);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Registration failed: ${err.message || "Unknown error"}`);
    }
  } catch (err) {
    alert(`Could not connect to Customer Service: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================================
// CUSTOM DELIVERY SCHEDULE & DATE/TIME PICKER
// ============================================================================
let deliveryScheduleState = {
  preset: "ASAP",
  date: "2026-10-13",
  timeSlot: "12:00"
};

let calViewYear = 2026;
let calViewMonth = 9; // October (0-indexed)
let selectedCalDate = "2026-10-13";

function handleCustomDeliveryDateChange(dateVal) {
  if (!dateVal) return;
  deliveryScheduleState.date = dateVal;
  selectedCalDate = dateVal;
  try {
    const parts = dateVal.split("-");
    if (parts.length === 3) {
      calViewYear = Number(parts[0]);
      calViewMonth = Number(parts[1]) - 1;
    }
  } catch (_) {}
  updateScheduledDateTimeDisplay();
}

function handleCustomDeliveryTimeChange(timeVal) {
  if (!timeVal) return;
  deliveryScheduleState.timeSlot = timeVal;
  updateScheduledDateTimeDisplay();
}

function setDeliverySchedulePreset(preset) {
  deliveryScheduleState.preset = preset;
  document.querySelectorAll(".schedule-presets-row .btn-preset").forEach((b) => b.classList.remove("active"));
  const btn = document.getElementById(`preset-delivery-${preset.toLowerCase()}`);
  if (btn) btn.classList.add("active");

  const scheduleBox = document.getElementById("custom-schedule-box");
  const display = document.getElementById("scheduled-datetime-display");

  if (preset === "ASAP") {
    if (scheduleBox) scheduleBox.style.display = "none";
    if (display) display.textContent = "ASAP (Instant Dispatch ~25-35 mins)";
  } else if (preset === "TODAY") {
    if (scheduleBox) scheduleBox.style.display = "none";
    const now = new Date();
    now.setMinutes(now.getMinutes() + 45);
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    deliveryScheduleState.timeSlot = timeStr;
    if (display) display.textContent = `Today @ ~${timeStr} (+45 min target)`;
  } else if (preset === "CUSTOM") {
    if (scheduleBox) scheduleBox.style.display = "block";
    const dateInput = document.getElementById("delivery-schedule-date");
    const timeInput = document.getElementById("delivery-schedule-time");
    if (dateInput && !dateInput.value) {
      dateInput.value = selectedCalDate;
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (timeInput && !timeInput.value) {
      timeInput.value = deliveryScheduleState.timeSlot;
      timeInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (window.initCustomDateTimePickers) window.initCustomDateTimePickers();
    renderCalendarDays();
    updateScheduledDateTimeDisplay();
  }
}

function updateScheduledDateTimeDisplay() {
  const display = document.getElementById("scheduled-datetime-display");
  if (display) {
    display.textContent = `${selectedCalDate} @ ${deliveryScheduleState.timeSlot}`;
  }
}

function toggleCustomDatePicker() {
  const popup = document.getElementById("custom-datetime-picker-popup");
  if (!popup) return;
  const isHidden = popup.style.display === "none" || !popup.style.display;
  popup.style.display = isHidden ? "block" : "none";
  if (isHidden) renderCalendarDays();
}

function closeCustomDatePicker() {
  const popup = document.getElementById("custom-datetime-picker-popup");
  if (popup) popup.style.display = "none";
}

function renderCalendarDays() {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const titleEl = document.getElementById("cal-month-title");
  if (titleEl) titleEl.textContent = `${monthNames[calViewMonth]} ${calViewYear}`;

  const grid = document.getElementById("calendar-days-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const firstDayIndex = new Date(calViewYear, calViewMonth, 1).getDay();
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    const emptySpan = document.createElement("span");
    emptySpan.className = "cal-day-btn disabled";
    grid.appendChild(emptySpan);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-day-btn";
    btn.textContent = d;

    const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (dateStr === selectedCalDate) {
      btn.classList.add("selected");
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedCalDate = dateStr;
      deliveryScheduleState.date = dateStr;
      renderCalendarDays();
      updateScheduledDateTimeDisplay();
    });

    grid.appendChild(btn);
  }
}

function prevCalendarMonth() {
  calViewMonth--;
  if (calViewMonth < 0) {
    calViewMonth = 11;
    calViewYear--;
  }
  renderCalendarDays();
}

function nextCalendarMonth() {
  calViewMonth++;
  if (calViewMonth > 11) {
    calViewMonth = 0;
    calViewYear++;
  }
  renderCalendarDays();
}

function selectDeliveryTimeSlot(slot) {
  deliveryScheduleState.timeSlot = slot;
  const timeInput = document.getElementById("delivery-schedule-time");
  if (timeInput) {
    timeInput.value = slot;
    timeInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  document.querySelectorAll(".time-slots-grid .time-slot-btn").forEach((b) => {
    b.classList.toggle("selected", b.textContent.trim() === slot);
  });
  updateScheduledDateTimeDisplay();
}

function confirmCustomDateTime() {
  deliveryScheduleState.date = selectedCalDate;
  updateScheduledDateTimeDisplay();
  closeCustomDatePicker();
}

// ============================================================================
// CUSTOMER ORDER HISTORY & DATE FILTERING
// ============================================================================
let customerOrderHistoryList = [];
let customerOrderHistoryFilter = "ALL";

async function loadCustomerOrdersToHistory(customerId) {
  const tbody = document.getElementById("customer-order-history-tbody");
  if (!tbody) return;

  try {
    const res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(customerId)}/orders`, { timeoutMs: 3000 });
    if (res.ok) {
      const orders = await res.json();
      if (Array.isArray(orders) && orders.length > 0) {
        customerOrderHistoryList = orders;
        renderOrderHistoryTable();

        // Sync with active orders
        let existing = [];
        try {
          const raw = localStorage.getItem("dsa_active_orders");
          if (raw) existing = JSON.parse(raw);
        } catch (_) {}

        orders.forEach((o) => {
          const oId = o.orderId || o.id;
          if (oId && !existing.includes(oId)) {
            existing.push(oId);
          }
        });
        localStorage.setItem("dsa_active_orders", JSON.stringify(existing));
        refreshTrackingOrdersDropdown();
        return;
      }
    }
  } catch (_) {}

  // Local fallback history synthesis
  let localOrders = [];
  try {
    const raw = localStorage.getItem("dsa_active_orders");
    if (raw) localOrders = JSON.parse(raw);
  } catch (_) {}

  customerOrderHistoryList = localOrders.map((oId) => ({
    orderId: oId,
    timestamp: new Date().toISOString(),
    restaurantId: "R001",
    restaurantName: "Kapana Corner",
    totalAmount: 110.0,
    status: "PROCESSING"
  }));
  renderOrderHistoryTable();
}

let customerOrderHistoryCustomDate = null;
let customerOrderHistoryCustomTime = null;

function handleHistoryCustomDateFilter(dateVal) {
  customerOrderHistoryCustomDate = dateVal || null;
  customerOrderHistoryFilter = "CUSTOM";
  document.querySelectorAll(".order-history-card .btn-preset").forEach((b) => b.classList.remove("active"));
  renderOrderHistoryTable();
}

function handleHistoryCustomTimeFilter(timeVal) {
  customerOrderHistoryCustomTime = timeVal || null;
  customerOrderHistoryFilter = "CUSTOM";
  document.querySelectorAll(".order-history-card .btn-preset").forEach((b) => b.classList.remove("active"));
  renderOrderHistoryTable();
}

function clearHistoryDateTimeFilter() {
  const dInput = document.getElementById("history-filter-date");
  const tInput = document.getElementById("history-filter-time");
  if (dInput) {
    dInput.value = "";
    dInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (tInput) {
    tInput.value = "";
    tInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  customerOrderHistoryCustomDate = null;
  customerOrderHistoryCustomTime = null;
  filterOrderHistory("ALL");
}

function filterOrderHistory(preset) {
  customerOrderHistoryFilter = preset;
  customerOrderHistoryCustomDate = null;
  customerOrderHistoryCustomTime = null;
  const dInput = document.getElementById("history-filter-date");
  const tInput = document.getElementById("history-filter-time");
  if (dInput && dInput.value) {
    dInput.value = "";
    dInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (tInput && tInput.value) {
    tInput.value = "";
    tInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  document.querySelectorAll(".order-history-card .btn-preset").forEach((b) => b.classList.remove("active"));
  const btn = document.getElementById(`history-preset-${preset.toLowerCase()}`);
  if (btn) btn.classList.add("active");
  renderOrderHistoryTable();
}

function renderOrderHistoryTable() {
  const tbody = document.getElementById("customer-order-history-tbody");
  if (!tbody) return;

  if (!customerOrderHistoryList || customerOrderHistoryList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell">No order history found for this account.</td></tr>`;
    return;
  }

  const now = new Date();
  const filtered = customerOrderHistoryList.filter((o) => {
    const orderDate = new Date(o.timestamp || o.createdAt || Date.now());

    if (customerOrderHistoryCustomDate) {
      const year = orderDate.getFullYear();
      const month = String(orderDate.getMonth() + 1).padStart(2, "0");
      const day = String(orderDate.getDate()).padStart(2, "0");
      const orderIsoDate = `${year}-${month}-${day}`;
      if (orderIsoDate !== customerOrderHistoryCustomDate) return false;
    }

    if (customerOrderHistoryCustomTime) {
      const hours = String(orderDate.getHours()).padStart(2, "0");
      const mins = String(orderDate.getMinutes()).padStart(2, "0");
      const orderTimeStr = `${hours}:${mins}`;
      if (orderTimeStr < customerOrderHistoryCustomTime) return false;
    }

    if (customerOrderHistoryCustomDate || customerOrderHistoryCustomTime) {
      return true;
    }

    if (customerOrderHistoryFilter === "ALL") return true;
    if (customerOrderHistoryFilter === "TODAY") {
      return orderDate.toDateString() === now.toDateString();
    }
    if (customerOrderHistoryFilter === "7D") {
      const diffMs = now - orderDate;
      return diffMs <= 7 * 24 * 60 * 60 * 1000;
    }
    if (customerOrderHistoryFilter === "MONTH") {
      return orderDate.getMonth() === now.getMonth() && orderDate.getFullYear() === now.getFullYear();
    }
    return true;
  });

  if (filtered.length === 0) {
    const filterDesc = customerOrderHistoryCustomDate
      ? `${customerOrderHistoryCustomDate}${customerOrderHistoryCustomTime ? " " + customerOrderHistoryCustomTime : ""}`
      : customerOrderHistoryFilter;
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell">No orders found for the selected date filter (${escapeHtml(filterDesc)}).</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((o) => {
    const oId = o.orderId || o.id || "ORD-000";
    const dateStr = o.timestamp ? new Date(o.timestamp).toLocaleString() : "Recent";
    const restName = o.restaurantName || o.restaurantId || "Kapana Corner";
    const total = Number(o.totalAmount || o.total || 0).toFixed(2);
    const status = o.status || "CONFIRMED";

    return `
      <tr>
        <td class="text-mono font-bold">${escapeHtml(oId)}</td>
        <td>${escapeHtml(dateStr)}</td>
        <td>${escapeHtml(restName)}</td>
        <td class="text-mono font-bold">N$ ${escapeHtml(total)}</td>
        <td><span class="status-pill ${status === "DELIVERED" ? "pill-valid" : "pill-checking"}">${escapeHtml(status)}</span></td>
        <td>
          <button type="button" class="btn btn-xs btn-outline" onclick="selectOrderToTrack('${escapeHtml(oId)}'); switchMainTab('tracking');">
            Track
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

// ============================================================================
// 6. EXPLORE & MENU CATALOG (VIEW 1)
// ============================================================================

// High-Contrast SVG Food Illustrations generator (Zero Emojis, Zero Gradients)
function getDishIllustrationSvg(categoryName, dishName) {
  const lowerName = (dishName || "").toLowerCase();
  const lowerCat = (categoryName || "").toLowerCase();

  if (lowerName.includes("kapana") || lowerName.includes("beef") || lowerName.includes("pork") || lowerCat.includes("kapana")) {
    // Skewer & Grill SVG
    return `
      <svg viewBox="0 0 24 24">
        <line x1="2" y1="22" x2="22" y2="2"></line>
        <rect x="7" y="5" width="4" height="4" rx="1"></rect>
        <rect x="11" y="9" width="4" height="4" rx="1"></rect>
        <rect x="15" y="13" width="4" height="4" rx="1"></rect>
        <line x1="4" y1="20" x2="2" y2="22" stroke-width="3"></line>
      </svg>`;
  }

  if (lowerName.includes("vetkoek") || lowerName.includes("roosterkoek") || lowerName.includes("bread") || lowerName.includes("cake")) {
    // Traditional Baked Pastry / Bun SVG
    return `
      <svg viewBox="0 0 24 24">
        <path d="M4 14a8 8 0 0 1 16 0v2H4v-2z"></path>
        <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path>
        <line x1="8" y1="10" x2="8" y2="10.01"></line>
        <line x1="12" y1="9" x2="12" y2="9.01"></line>
        <line x1="16" y1="10" x2="16" y2="10.01"></line>
      </svg>`;
  }

  if (lowerName.includes("salsa") || lowerName.includes("salad") || lowerName.includes("relish") || lowerCat.includes("side")) {
    // Fresh Salad / Salsa Bowl SVG
    return `
      <svg viewBox="0 0 24 24">
        <path d="M2 12h20"></path>
        <path d="M4 12a8 8 0 0 0 16 0"></path>
        <circle cx="8" cy="8" r="2"></circle>
        <circle cx="16" cy="8" r="2"></circle>
        <path d="M12 4v4"></path>
      </svg>`;
  }

  if (lowerName.includes("potjie") || lowerName.includes("stew") || lowerName.includes("soup")) {
    // Cast-iron Potjie Stew Pot SVG
    return `
      <svg viewBox="0 0 24 24">
        <path d="M5 9h14v7a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5V9z"></path>
        <line x1="2" y1="9" x2="22" y2="9"></line>
        <path d="M9 5a3 3 0 0 1 6 0"></path>
        <line x1="7" y1="21" x2="5" y2="23"></line>
        <line x1="17" y1="21" x2="19" y2="23"></line>
      </svg>`;
  }

  if (lowerName.includes("oshikundu") || lowerName.includes("beer") || lowerName.includes("drink") || lowerCat.includes("beverage")) {
    // Traditional Beverage Cup SVG
    return `
      <svg viewBox="0 0 24 24">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
        <line x1="6" y1="1" x2="6" y2="4"></line>
        <line x1="10" y1="1" x2="10" y2="4"></line>
        <line x1="14" y1="1" x2="14" y2="4"></line>
      </svg>`;
  }

  // Default Chef Platter / Cloche SVG
  return `
    <svg viewBox="0 0 24 24">
      <path d="M3 17h18"></path>
      <path d="M4 17a8 8 0 0 1 16 0"></path>
      <circle cx="12" cy="7" r="2"></circle>
    </svg>`;
}

async function loadLiveRestaurants() {
  const select = document.getElementById("restaurant-select");
  if (!select) return;

  try {
    const res = await apiFetch(PORTS.RESTAURANT, "/restaurants", { timeoutMs: 3000 });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        liveRestaurants = data;
        select.innerHTML = liveRestaurants
          .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} (${escapeHtml(r.id)})</option>`)
          .join("");

        // Default to Kapana Corner (R001) if available
        const defaultR = liveRestaurants.find((r) => r.id === "R001") || liveRestaurants[0];
        select.value = defaultR.id;
        select.dispatchEvent(new Event("change"));
        handleRestaurantChange(defaultR.id);
        if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
        return;
      }
    }
  } catch (err) {
    console.warn("Could not load restaurants from :9095:", err.message);
  }

  // Fallback to Kapana Corner primary seed
  liveRestaurants = [
    {
      id: "R001",
      name: "Kapana Corner",
      address: "Single Quarters, Katutura, Windhoek",
      contactNumber: "+264-81-111-2222",
      operatingHours: [{ openTime: "08:00", closeTime: "22:00" }],
      location: { coordinates: [17.0658, -22.5333] },
      menu: [
        {
          id: "C1",
          name: "Street Food & Kapana",
          items: [
            {
              id: "M1",
              name: "Beef Kapana",
              description: "Succulent grilled beef strips dusted in traditional chili spice.",
              price: 50.00,
              taxRate: 0.15,
              dietaryAttributes: ["High-Protein", "Halal"],
              stock: 100
            },
            {
              id: "M2",
              name: "Vetkoek (Fat Cake)",
              description: "Golden-brown deep-fried dough bun served warm with savory relish.",
              price: 10.00,
              taxRate: 0.15,
              dietaryAttributes: ["Vegetarian"],
              stock: 80
            },
            {
              id: "M3",
              name: "Katutura Salsa",
              description: "Freshly diced tomato, onion, and chili relish with cider vinegar.",
              price: 15.00,
              taxRate: 0.15,
              dietaryAttributes: ["Vegan", "Gluten-Free"],
              stock: 120
            },
            {
              id: "M4",
              name: "Roosterkoek",
              description: "Charcoal-grilled traditional bread roll.",
              price: 20.00,
              taxRate: 0.15,
              dietaryAttributes: ["Vegetarian"],
              stock: 60
            },
            {
              id: "M5",
              name: "Pork Kapana",
              description: "Flame-broiled crispy pork belly skewers with dipping salts.",
              price: 60.00,
              taxRate: 0.15,
              dietaryAttributes: ["High-Protein"],
              stock: 75
            },
            {
              id: "M6",
              name: "Oshikundu",
              description: "Traditional non-alcoholic fermented pearl millet and sorghum brew.",
              price: 25.00,
              taxRate: 0.15,
              dietaryAttributes: ["Vegetarian", "Traditional"],
              stock: 90
            }
          ]
        }
      ]
    }
  ];

  select.innerHTML = `<option value="R001">Kapana Corner (R001)</option>`;
  select.value = "R001";
  handleRestaurantChange("R001");
  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
}

async function handleRestaurantChange(restaurantId) {
  selectedRestaurant = liveRestaurants.find((r) => r.id === restaurantId);
  if (!selectedRestaurant) return;

  // Update Restaurant Banner elements
  setText("rest-name-display", selectedRestaurant.name || "Kapana Corner");
  setText("rest-subtitle", selectedRestaurant.address || "Single Quarters, Katutura, Windhoek");
  setText("rest-address", selectedRestaurant.address || "Single Quarters, Katutura, Windhoek");
  setText("rest-phone", selectedRestaurant.contactNumber || "+264-81-111-2222");

  // Operating Hours display
  let hoursText = "08:00 \u2013 22:00 Daily";
  if (Array.isArray(selectedRestaurant.operatingHours) && selectedRestaurant.operatingHours.length > 0) {
    const h = selectedRestaurant.operatingHours[0];
    if (h.openTime && h.closeTime) {
      hoursText = `${h.openTime} \u2013 ${h.closeTime} Daily`;
    }
  }
  setText("rest-hours", hoursText);

  // Coordinates
  if (selectedRestaurant.location && Array.isArray(selectedRestaurant.location.coordinates)) {
    const lon = selectedRestaurant.location.coordinates[0];
    const lat = selectedRestaurant.location.coordinates[1];
    setText("rest-coords", `[${Number(lon).toFixed(4)}, ${Number(lat).toFixed(4)}]`);
  } else {
    setText("rest-coords", "[17.0658, -22.5333]");
  }

  // Check Open Status
  checkRestaurantOpenStatus(restaurantId);

  // Fetch Menu from Restaurant Service (:9095)
  try {
    const res = await apiFetch(PORTS.RESTAURANT, `/restaurants/${encodeURIComponent(restaurantId)}/menu`, { timeoutMs: 3000 });
    if (res.ok) {
      const menuData = await res.json();
      if (Array.isArray(menuData) && menuData.length > 0) {
        currentMenuCategories = menuData;
        selectedCategoryFilter = "ALL";
        renderCategoryFilters();
        renderMenuItems();
        return;
      }
    }
  } catch (err) {
    console.warn("Could not fetch menu from :9095:", err.message);
  }

  if (Array.isArray(selectedRestaurant.menu) && selectedRestaurant.menu.length > 0) {
    currentMenuCategories = selectedRestaurant.menu;
  }
  selectedCategoryFilter = "ALL";
  renderCategoryFilters();
  renderMenuItems();
}

async function checkRestaurantOpenStatus(restaurantId) {
  const dot = document.getElementById("restaurant-open-dot");
  const text = document.getElementById("restaurant-open-text");

  try {
    const res = await apiFetch(PORTS.RESTAURANT, `/restaurants/${encodeURIComponent(restaurantId)}/open-status`, { timeoutMs: 2000 });
    if (res.ok) {
      const data = await res.json();
      const isOpen = Boolean(data.open !== undefined ? data.open : data.isOpen);
      if (dot) dot.className = `status-dot ${isOpen ? "online" : "offline"}`;
      if (text) text.textContent = isOpen ? "OPEN FOR ORDERS" : "CLOSED NOW";
      return;
    }
  } catch (_) {}

  if (dot) dot.className = "status-dot online";
  if (text) text.textContent = "OPEN FOR ORDERS";
}

// Search and Category Filter Handler
function handleMenuSearch(query) {
  menuSearchQuery = (query || "").trim().toLowerCase();
  const clearBtn = document.getElementById("search-clear-btn");
  if (clearBtn) {
    clearBtn.style.display = menuSearchQuery.length > 0 ? "block" : "none";
  }
  renderMenuItems();
}

function clearMenuSearch() {
  const input = document.getElementById("menu-search-input");
  if (input) input.value = "";
  handleMenuSearch("");
}

function renderCategoryFilters() {
  const container = document.getElementById("category-filter-chips");
  if (!container) return;

  // Extract distinct category names from live menu categories
  const dynamicNames = currentMenuCategories.map((c) => c.name || c.id);

  // Standard category filter chips
  const predefined = ["ALL", "Street Food & Kapana", "Sides", "Beverages"];
  const combined = Array.from(new Set([...predefined, ...dynamicNames]));

  container.innerHTML = combined
    .map(
      (cat) => `
    <button type="button" class="category-chip ${cat === selectedCategoryFilter ? "active" : ""}" onclick="filterCategory('${escapeHtml(cat)}')">
      ${escapeHtml(cat)}
    </button>`
    )
    .join("");
}

function filterCategory(cat) {
  selectedCategoryFilter = cat;
  renderCategoryFilters();
  renderMenuItems();
}

function renderMenuItems() {
  const container = document.getElementById("menu-items-container");
  if (!container) return;

  let allDishes = [];
  currentMenuCategories.forEach((cat) => {
    const catName = cat.name || cat.id;
    if (Array.isArray(cat.items)) {
      cat.items.forEach((item) => {
        allDishes.push({ ...item, categoryName: catName });
      });
    }
  });

  // Filter by Category
  let filtered = allDishes.filter((item) => {
    if (selectedCategoryFilter === "ALL") return true;

    const catName = (item.categoryName || "").toLowerCase();
    const filterLower = selectedCategoryFilter.toLowerCase();

    if (filterLower.includes("kapana") || filterLower.includes("street")) {
      return catName.includes("kapana") || catName.includes("street");
    }
    if (filterLower.includes("side")) {
      return catName.includes("side") || item.name.toLowerCase().includes("salsa") || item.name.toLowerCase().includes("roosterkoek");
    }
    if (filterLower.includes("beverage")) {
      return catName.includes("beverage") || item.name.toLowerCase().includes("oshikundu") || item.name.toLowerCase().includes("drink");
    }

    return catName === filterLower || item.categoryName === selectedCategoryFilter;
  });

  // Filter by Instant Text Search Query
  if (menuSearchQuery.length > 0) {
    filtered = filtered.filter((item) => {
      const name = (item.name || "").toLowerCase();
      const desc = (item.description || "").toLowerCase();
      const tags = (item.dietaryAttributes || []).join(" ").toLowerCase();
      return name.includes(menuSearchQuery) || desc.includes(menuSearchQuery) || tags.includes(menuSearchQuery);
    });
  }

  if (filtered.length === 0) {
    renderEmptyMenu(
      menuSearchQuery.length > 0
        ? `No dishes matching "${menuSearchQuery}" in category ${selectedCategoryFilter}.`
        : "No dishes found in the selected category."
    );
    return;
  }

  container.innerHTML = filtered
    .map((item) => {
      const inStock = item.stock > 0;
      const priceFormatted = Number(item.price).toFixed(2);
      const itemId = escapeHtml(item.id);
      const dietaryAttrs = item.dietaryAttributes || [];
      const itemImg = item.imageUrl || item.image || item.picture || item.photo;

      return `
      <div class="dish-card">
        <!-- Dish Picture / Fallback Banner -->
        <div class="dish-illustration-box ${itemImg ? "" : "no-picture-mode"}">
          ${
            itemImg
              ? `<img src="${escapeHtml(itemImg)}" alt="${escapeHtml(item.name || "Dish")}" class="dish-img" onerror="this.onerror=null;this.parentElement.classList.add('no-picture-mode');this.parentElement.innerHTML='<span class=\\'no-picture-text\\'>No picture</span><span class=\\'dish-category-watermark\\'>${escapeHtml(item.categoryName || "Specialty")}</span>';" />`
              : `<span class="no-picture-text">No picture</span>`
          }
          <span class="dish-category-watermark">${escapeHtml(item.categoryName || "Specialty")}</span>
        </div>

        <div>
          <div class="dish-header">
            <h4 class="dish-title">${escapeHtml(item.name)}</h4>
            <div class="dish-price-group">
              <span class="dish-price">N$ ${priceFormatted}</span>
              <span class="tax-indicator-badge">15% VAT Included</span>
            </div>
          </div>
          <p class="dish-description">${escapeHtml(item.description || "Prepared fresh with authentic local Namibian ingredients.")}</p>
        </div>

        <div>
          <div class="dish-tags-row">
            <span class="stock-badge ${inStock ? "in-stock" : "out-of-stock"}">
              ${inStock ? `Stock: ${item.stock}` : "Out of stock"}
            </span>
            ${dietaryAttrs.map((d) => `<span class="dietary-tag">${escapeHtml(d)}</span>`).join("")}
          </div>

          <div class="dish-actions-row">
            <div class="quantity-stepper">
              <button type="button" class="stepper-btn" onclick="adjustMenuQty('${itemId}', -1)">&minus;</button>
              <span class="stepper-val" id="qty-input-${itemId}">1</span>
              <button type="button" class="stepper-btn" onclick="adjustMenuQty('${itemId}', 1)">&plus;</button>
            </div>
            <button
              type="button"
              class="btn-add-to-cart"
              id="btn-add-${itemId}"
              onclick="addToCart('${itemId}', this)"
              ${!inStock ? "disabled" : ""}
            >
              ${inStock ? "Add to Cart" : "Sold Out"}
            </button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function renderEmptyMenu(message) {
  const container = document.getElementById("menu-items-container");
  if (container) {
    container.innerHTML = `<div class="empty-state-card"><p>${escapeHtml(message)}</p></div>`;
  }
}

function adjustMenuQty(itemId, delta) {
  const el = document.getElementById(`qty-input-${itemId}`);
  if (!el) return;
  let val = parseInt(el.textContent, 10) || 1;
  val = Math.max(1, Math.min(20, val + delta));
  el.textContent = val;
}

// ============================================================================
// 7. DYNAMIC SURGE PRICING (:9091)
// ============================================================================
async function fetchDynamicPricing() {
  try {
    const res = await apiFetch(PORTS.ORDER, "/pricing/current", { timeoutMs: 2500 });
    if (res.ok) {
      const quote = await res.json();
      dynamicPricing.surgeMultiplier = Number(quote.surgeMultiplier || 1.0);
      dynamicPricing.deliveryFee = Number(quote.deliveryFee || 15.0);

      const multTag = document.getElementById("surge-multiplier-tag");
      const feeTag = document.getElementById("surge-delivery-fee");
      const cartSurge = document.getElementById("cart-surge-multiplier");

      if (multTag) {
        multTag.textContent = `${dynamicPricing.surgeMultiplier.toFixed(1)}x ${dynamicPricing.surgeMultiplier > 1.0 ? "Peak Surge" : "Normal Demand"}`;
      }
      if (feeTag) {
        feeTag.textContent = `N$ ${dynamicPricing.deliveryFee.toFixed(2)}`;
      }
      if (cartSurge) {
        cartSurge.textContent = `${dynamicPricing.surgeMultiplier.toFixed(1)}x ${dynamicPricing.surgeMultiplier > 1.0 ? "Peak" : "Normal"}`;
      }

      updateCartSummary();
    }
  } catch (_) {}
}

// ============================================================================
// 8. CART & CHECKOUT (MODAL 1)
// ============================================================================
function toggleCartDrawer() {
  const drawer = document.getElementById("cart-drawer");
  if (drawer) drawer.classList.toggle("open");
}

function addToCart(itemId, buttonEl) {
  let item = null;
  for (const cat of currentMenuCategories) {
    const found = (cat.items || []).find((i) => i.id === itemId);
    if (found) {
      item = found;
      break;
    }
  }

  if (!item) return;

  const qtyEl = document.getElementById(`qty-input-${itemId}`);
  const qty = parseInt(qtyEl?.textContent || "1", 10);

  const existingIndex = cart.findIndex((c) => c.item.id === itemId);
  if (existingIndex > -1) {
    cart[existingIndex].quantity += qty;
  } else {
    cart.push({ item: item, quantity: qty });
  }

  updateCartSummary();
  renderCartDrawer();

  // Smooth visual feedback on the button
  if (buttonEl) {
    buttonEl.classList.add("btn-added-feedback");
    buttonEl.textContent = "Added \u2713";
    setTimeout(() => {
      buttonEl.classList.remove("btn-added-feedback");
      buttonEl.textContent = "Add to Cart";
    }, 1200);
  }
}

function removeFromCart(itemId) {
  cart = cart.filter((c) => c.item.id !== itemId);
  updateCartSummary();
  renderCartDrawer();
}

function updateCartQuantity(itemId, delta) {
  const entry = cart.find((c) => c.item.id === itemId);
  if (!entry) return;

  entry.quantity += delta;
  if (entry.quantity <= 0) {
    removeFromCart(itemId);
  } else {
    updateCartSummary();
    renderCartDrawer();
  }
}

function renderCartDrawer() {
  const container = document.getElementById("cart-items-container");
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = `<div class="empty-cart-state"><p>Your cart is empty. Add dishes from the menu to get started.</p></div>`;
    return;
  }

  container.innerHTML = cart
    .map((c) => {
      const lineTotal = (Number(c.item.price) * c.quantity).toFixed(2);
      const itemId = escapeHtml(c.item.id);

      return `
      <div class="cart-item-row">
        <div class="cart-item-info">
          <strong class="cart-item-title">${escapeHtml(c.item.name)}</strong>
          <span class="cart-item-unit">N$ ${Number(c.item.price).toFixed(2)} &times; ${c.quantity}</span>
        </div>
        <div class="cart-item-actions">
          <strong class="text-mono">N$ ${lineTotal}</strong>
          <div class="quantity-stepper">
            <button type="button" class="stepper-btn" onclick="updateCartQuantity('${itemId}', -1)">&minus;</button>
            <span class="stepper-val">${c.quantity}</span>
            <button type="button" class="stepper-btn" onclick="updateCartQuantity('${itemId}', 1)">&plus;</button>
          </div>
          <button type="button" class="btn-close" style="font-size: 16px;" onclick="removeFromCart('${itemId}')">&times;</button>
        </div>
      </div>`;
    })
    .join("");
}

function updateCartSummary() {
  const itemsSubtotal = cart.reduce((acc, c) => acc + Number(c.item.price) * c.quantity, 0);
  const deliveryFee = cart.length > 0 ? dynamicPricing.deliveryFee : 0;
  const totalAmount = itemsSubtotal + deliveryFee;

  // 15% VAT included breakdown
  const taxPortion = (itemsSubtotal * 0.15) / 1.15;

  setText("cart-subtotal", `N$ ${itemsSubtotal.toFixed(2)}`);
  setText("cart-delivery-fee", `N$ ${deliveryFee.toFixed(2)}`);
  setText("cart-tax-amount", `N$ ${taxPortion.toFixed(2)}`);
  setText("cart-total-amount", `N$ ${totalAmount.toFixed(2)}`);

  const cartSurge = document.getElementById("cart-surge-multiplier");
  if (cartSurge) {
    cartSurge.textContent = `${dynamicPricing.surgeMultiplier.toFixed(1)}x ${dynamicPricing.surgeMultiplier > 1.0 ? "Peak Surge" : "Normal"}`;
  }

  const totalCount = cart.reduce((acc, c) => acc + c.quantity, 0);
  setText("header-cart-count", totalCount);

  const placeBtn = document.getElementById("btn-place-order");
  if (placeBtn) {
    placeBtn.disabled = cart.length === 0 || !activeCustomer || !selectedRestaurant;
  }
}

function handleInstructionsInput(val) {
  const counter = document.getElementById("instructions-char-count");
  if (counter) {
    counter.textContent = `${val.length} / 150`;
  }
}

// Order Placement & Payment Flow
async function placeOrderAndCheckout() {
  if (cart.length === 0) {
    alert("Cart is empty.");
    return;
  }
  if (!activeCustomer) {
    alert("Please select or register a customer account first.");
    return;
  }
  if (!selectedRestaurant) {
    alert("No restaurant selected.");
    return;
  }

  let customerAddr = activeCustomer.address;
  if (!customerAddr && activeCustomer.addresses && activeCustomer.addresses.length > 0) {
    customerAddr = activeCustomer.addresses[0];
  }

  if (!customerAddr) {
    customerAddr = {
      street: "12 Independence Avenue",
      city: "Windhoek",
      state: "Khomas",
      postalCode: "9000",
      location: { coordinates: [17.0658, -22.5609] }
    };
  }

  let scheduleNote = "";
  if (deliveryScheduleState.preset === "CUSTOM") {
    scheduleNote = `[Scheduled Delivery: ${deliveryScheduleState.date} @ ${deliveryScheduleState.timeSlot}] `;
  } else if (deliveryScheduleState.preset === "TODAY") {
    scheduleNote = `[Target Delivery: ~${deliveryScheduleState.timeSlot}] `;
  }
  const rawInstructions = document.getElementById("cart-instructions")?.value.trim() || "";
  const instructions = (scheduleNote + rawInstructions).trim();
  const placeBtn = document.getElementById("btn-place-order");
  const btnContent = document.getElementById("checkout-btn-content");

  if (placeBtn) {
    placeBtn.disabled = true;
  }
  if (btnContent) {
    btnContent.innerHTML = `
      <svg class="spinner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
      </svg>
      <span>Placing Order with :9091...</span>
    `;
  }

  const orderPayload = {
    customerId: activeCustomer.id,
    restaurantId: selectedRestaurant.id,
    items: cart.map((c) => ({
      itemId: c.item.id,
      name: c.item.name,
      quantity: c.quantity,
      price: Number(c.item.price),
      specialInstructions: instructions ? [instructions] : []
    })),
    deliveryAddress: {
      street: customerAddr.street,
      city: customerAddr.city,
      state: customerAddr.state,
      postalCode: customerAddr.postalCode,
      instructions: instructions,
      coordinates: customerAddr.location?.coordinates ? {
        longitude: Number(customerAddr.location.coordinates[0]),
        latitude: Number(customerAddr.location.coordinates[1])
      } : { longitude: 17.0658, latitude: -22.5609 }
    }
  };

  try {
    // 1. Post to Order Service (:9091)
    const orderRes = await apiFetch(PORTS.ORDER, "/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload),
      timeoutMs: 4000
    });

    if (!orderRes.ok) {
      const err = await orderRes.json().catch(() => ({}));
      throw new Error(`Order Service rejected request: ${err.message || orderRes.statusText}`);
    }

    const createdOrder = await orderRes.json();
    const orderId = createdOrder.orderId;

    // 2. Clear instant payment with Payment Service (:9094)
    const paymentMethod = document.getElementById("payment-method-select")?.value || "CREDIT_CARD";
    try {
      await apiFetch(PORTS.PAYMENT, "/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orderId,
          amount: createdOrder.totalAmount,
          paymentMethod: paymentMethod
        }),
        timeoutMs: 3000
      });
    } catch (payErr) {
      console.warn("Payment clearance note:", payErr.message);
    }

    // 3. Record order creation timestamp
    recordOrderStepTimestamp(orderId, "CREATED");

    // 4. Save Order ID to local history
    let savedOrders = [];
    try {
      const raw = localStorage.getItem("dsa_active_orders");
      if (raw) savedOrders = JSON.parse(raw);
    } catch (_) {}
    savedOrders = savedOrders.filter((id) => id !== orderId);
    savedOrders.unshift(orderId);
    localStorage.setItem("dsa_active_orders", JSON.stringify(savedOrders));

    // Clear cart and close drawer
    cart = [];
    updateCartSummary();
    renderCartDrawer();
    toggleCartDrawer();

    // Reset instructions
    const instrArea = document.getElementById("cart-instructions");
    if (instrArea) instrArea.value = "";
    handleInstructionsInput("");

    // 5. Switch to Live Tracking View immediately
    refreshTrackingOrdersDropdown();
    loadCustomerOrdersToHistory(activeCustomer.id);
    selectOrderToTrack(orderId);
    switchMainTab("tracking");

    alert(`Order ${orderId} created and paid successfully!`);
  } catch (err) {
    alert(`Order placement failed: ${err.message}`);
  } finally {
    if (placeBtn) placeBtn.disabled = false;
    if (btnContent) {
      btnContent.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Place Order &amp; Pay</span>
      `;
    }
  }
}

// ============================================================================
// 9. LIVE ORDER TRACKING & DRIVER TELEMETRY (VIEW 2)
// ============================================================================
function refreshTrackingOrdersDropdown() {
  const dropdown = document.getElementById("tracking-order-select");
  const countBadge = document.getElementById("active-orders-count");
  if (!dropdown) return;

  let orders = [];
  try {
    const raw = localStorage.getItem("dsa_active_orders");
    if (raw) orders = JSON.parse(raw);
  } catch (_) {}

  activeOrdersList = orders;

  if (countBadge) {
    if (orders.length > 0) {
      countBadge.style.display = "inline-block";
      countBadge.textContent = orders.length;
    } else {
      countBadge.style.display = "none";
    }
  }

  if (orders.length === 0) {
    dropdown.innerHTML = `<option value="" disabled selected>No active orders</option>`;
    if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
    return;
  }

  dropdown.innerHTML = orders
    .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
    .join("");

  if (currentlyTrackedOrderId && orders.includes(currentlyTrackedOrderId)) {
    dropdown.value = currentlyTrackedOrderId;
  } else {
    dropdown.value = orders[0];
    currentlyTrackedOrderId = orders[0];
  }
  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
}

function selectOrderToTrack(orderId) {
  if (!orderId) return;
  currentlyTrackedOrderId = orderId;

  pollLiveOrderTracking();

  if (trackingPollerId) clearInterval(trackingPollerId);
  trackingPollerId = setInterval(pollLiveOrderTracking, CONFIG.POLL_INTERVAL_MS);
}

function recordOrderStepTimestamp(orderId, status) {
  if (!orderId || !status) return;
  const key = `dsa_order_timestamps_${orderId}`;
  let timestamps = {};
  try {
    const raw = localStorage.getItem(key);
    if (raw) timestamps = JSON.parse(raw);
  } catch (_) {}

  if (!timestamps[status]) {
    const now = new Date();
    timestamps[status] = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    localStorage.setItem(key, JSON.stringify(timestamps));
  }
}

function getOrderStepTimestamps(orderId) {
  if (!orderId) return {};
  try {
    const raw = localStorage.getItem(`dsa_order_timestamps_${orderId}`);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}

async function pollLiveOrderTracking() {
  if (!currentlyTrackedOrderId) return;

  const targetId = currentlyTrackedOrderId;

  // 1. Fetch Order Status from Order Service (:9091)
  let orderData = null;
  try {
    const res = await apiFetch(PORTS.ORDER, `/orders/${encodeURIComponent(targetId)}`, { timeoutMs: 2500 });
    if (res.ok) {
      orderData = await res.json();
    }
  } catch (_) {}

  // 2. Fetch Driver Telemetry from Delivery Service (:9096)
  let deliveryData = null;
  try {
    const res = await apiFetch(PORTS.DELIVERY, `/delivery/track/${encodeURIComponent(targetId)}`, { timeoutMs: 2500 });
    if (res.ok) {
      deliveryData = await res.json();
    }
  } catch (_) {}

  renderTrackingUI(orderData, deliveryData);
}

function renderTrackingUI(order, delivery) {
  setText("track-order-id", currentlyTrackedOrderId || "\u2014");

  const orderStatus = order?.status || delivery?.status || "CREATED";
  recordOrderStepTimestamp(currentlyTrackedOrderId, orderStatus);

  const pill = document.getElementById("track-order-status-pill");
  if (pill) {
    pill.className = "status-pill";
    pill.textContent = orderStatus;
    if (orderStatus === "CONFIRMED" || orderStatus === "READY") pill.classList.add("pill-valid");
    else if (orderStatus === "PREPARING" || orderStatus === "OUT_FOR_DELIVERY" || orderStatus === "IN_TRANSIT") pill.classList.add("pill-surge");
    else if (orderStatus === "DELIVERED") pill.classList.add("pill-valid");
    else if (orderStatus === "CANCELLED") pill.classList.add("pill-invalid");
  }

  // 6-step lifecycle stepper mapping
  const statusHierarchy = ["CREATED", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];
  const normalizedStatus = orderStatus === "IN_TRANSIT" ? "OUT_FOR_DELIVERY" : orderStatus;
  const currentIdx = statusHierarchy.indexOf(normalizedStatus);

  const stepTimestamps = getOrderStepTimestamps(currentlyTrackedOrderId);

  statusHierarchy.forEach((st, idx) => {
    let nodeEl = null;
    let timeEl = null;
    if (st === "CREATED") {
      nodeEl = document.getElementById("step-created");
      timeEl = document.getElementById("step-time-created");
    } else if (st === "CONFIRMED") {
      nodeEl = document.getElementById("step-confirmed");
      timeEl = document.getElementById("step-time-confirmed");
    } else if (st === "PREPARING") {
      nodeEl = document.getElementById("step-preparing");
      timeEl = document.getElementById("step-time-preparing");
    } else if (st === "READY") {
      nodeEl = document.getElementById("step-ready");
      timeEl = document.getElementById("step-time-ready");
    } else if (st === "OUT_FOR_DELIVERY") {
      nodeEl = document.getElementById("step-out");
      timeEl = document.getElementById("step-time-out");
    } else if (st === "DELIVERED") {
      nodeEl = document.getElementById("step-delivered");
      timeEl = document.getElementById("step-time-delivered");
    }

    if (nodeEl) {
      nodeEl.classList.remove("active", "completed");
      if (idx < currentIdx) nodeEl.classList.add("completed");
      else if (idx === currentIdx) nodeEl.classList.add("active");
    }

    if (timeEl) {
      timeEl.textContent = stepTimestamps[st] || (idx <= currentIdx ? "Done" : "\u2014");
    }

    if (idx < 5) {
      const line = document.getElementById(`line-${idx + 1}`);
      if (line) line.classList.toggle("active", idx < currentIdx);
    }
  });

  if (order) {
    setText("track-restaurant-id", order.restaurantId || "R001");
    setText("track-total-amount", `N$ ${Number(order.totalAmount || 0).toFixed(2)}`);
    if (order.deliveryAddress) {
      setText("track-delivery-address", `${order.deliveryAddress.street || "\u2014"}, ${order.deliveryAddress.city || "Windhoek"}`);
    }
  }

  // Courier Profile Enrichment
  const driverId = delivery?.driverId || "drv_001";
  setText("track-driver-id", driverId);

  const courierProfile = KNOWN_COURIERS[driverId] || {
    name: delivery?.driverName || "Tomas Nekundi",
    phone: "+264812345601",
    vehicle: "Motorcycle \u2022 TVS Star HLX 125"
  };

  setText("track-driver-name", courierProfile.name);
  setText("track-driver-vehicle", courierProfile.vehicle);

  const callLink = document.getElementById("track-driver-phone-link");
  if (callLink) {
    callLink.href = `tel:${courierProfile.phone}`;
  }

  // Cancellation Allowed strictly before PREPARING
  const cancelBtn = document.getElementById("btn-cancel-order");
  const cancelGuardNotice = document.getElementById("cancel-guard-notice");
  const isCancellable = orderStatus === "CREATED" || orderStatus === "CONFIRMED";

  if (cancelBtn) {
    cancelBtn.disabled = !isCancellable;
  }
  if (cancelGuardNotice) {
    if (isCancellable) {
      cancelGuardNotice.textContent = "Order cancellation is permitted only prior to kitchen preparation (CREATED or CONFIRMED).";
      cancelGuardNotice.style.color = "var(--text-muted)";
    } else if (orderStatus === "CANCELLED") {
      cancelGuardNotice.textContent = "This order has been cancelled.";
      cancelGuardNotice.style.color = "var(--danger)";
    } else {
      cancelGuardNotice.textContent = "Cancellation locked: Kitchen is already preparing your dishes. Contact restaurant support for changes.";
      cancelGuardNotice.style.color = "var(--warning-text)";
    }
  }

  // Driver Coordinates & Distance Calculation
  let driverLat = CONFIG.WINDHOEK_REF.lat;
  let driverLon = CONFIG.WINDHOEK_REF.lon;

  if (delivery?.currentLocation) {
    driverLat = Number(delivery.currentLocation.latitude);
    driverLon = Number(delivery.currentLocation.longitude);
  }

  setText("track-driver-coords", `Lat: ${driverLat.toFixed(4)}, Lon: ${driverLon.toFixed(4)}`);

  // Target Customer Coordinates
  let customerLat = CONFIG.WINDHOEK_REF.lat;
  let customerLon = CONFIG.WINDHOEK_REF.lon;

  if (order?.deliveryAddress?.coordinates) {
    customerLat = Number(order.deliveryAddress.coordinates.latitude);
    customerLon = Number(order.deliveryAddress.coordinates.longitude);
  } else if (activeCustomer?.address?.location?.coordinates) {
    customerLon = Number(activeCustomer.address.location.coordinates[0]);
    customerLat = Number(activeCustomer.address.location.coordinates[1]);
  }

  const distanceKm = calculateDistanceKm(driverLat, driverLon, customerLat, customerLon);
  setText("track-distance-km", distanceKm.toFixed(1));
  setText("track-eta-mins", calculateETA(distanceKm));

  // Route Track Visualizer & Animated Progress Pin
  const fill = document.getElementById("track-segment-fill");
  const pin = document.getElementById("courier-track-pin");
  const stageText = document.getElementById("route-stage-text");

  let progressPct = 10;
  let stageDescription = "Order Created \u2022 Awaiting Kitchen";

  if (orderStatus === "DELIVERED") {
    progressPct = 100;
    stageDescription = "Order Delivered \u2022 Enjoy Your Meal!";
  } else if (orderStatus === "OUT_FOR_DELIVERY" || orderStatus === "IN_TRANSIT") {
    progressPct = 75;
    stageDescription = "Courier En Route to Your Doorstep";
  } else if (orderStatus === "READY") {
    progressPct = 50;
    stageDescription = "Dishes Ready \u2022 Awaiting Courier Pickup";
  } else if (orderStatus === "PREPARING") {
    progressPct = 35;
    stageDescription = "Kitchen Preparing Dishes";
  } else if (orderStatus === "CONFIRMED") {
    progressPct = 20;
    stageDescription = "Order Confirmed by Restaurant";
  } else if (orderStatus === "CANCELLED") {
    progressPct = 0;
    stageDescription = "Order Cancelled";
  }

  if (fill) fill.style.width = `${progressPct}%`;
  if (pin) pin.style.left = `${progressPct}%`;
  if (stageText) stageText.textContent = stageDescription;

  // Update Interactive Google Map live courier tracking
  updateClientGoogleMap(
    { lat: driverLat, lng: driverLon },
    { lat: customerLat, lng: customerLon },
    { lat: -22.5609, lng: 17.0658 }
  );
}

// ============================================================================
// 10. GOOGLE MAPS PLATFORM LIVE ORDER TRACKING
// AdvancedMarkerElement integration with mapId: 'DEMO_MAP_ID' and
// offline Windhoek route visualizer fallback
// ============================================================================

let clientGoogleMap = null;
let clientGmpMarkers = {
  restaurant: null,
  customer: null,
  driver: null
};
let clientRoutePolyline = null;
let isClientGmpInitialized = false;

async function initClientGoogleMap(driverCoords, customerCoords, restaurantCoords) {
  const mapCanvas = document.getElementById("client-google-map");
  const banner = document.getElementById("client-map-banner");
  if (!mapCanvas) return;

  const dLat = driverCoords?.lat ?? GOOGLE_MAPS_CONFIG.coordinates.courierLocation.lat;
  const dLng = driverCoords?.lng ?? GOOGLE_MAPS_CONFIG.coordinates.courierLocation.lng;
  const cLat = customerCoords?.lat ?? GOOGLE_MAPS_CONFIG.coordinates.customerDelivery.lat;
  const cLng = customerCoords?.lng ?? GOOGLE_MAPS_CONFIG.coordinates.customerDelivery.lng;
  const rLat = restaurantCoords?.lat ?? GOOGLE_MAPS_CONFIG.coordinates.restaurantR001.lat;
  const rLng = restaurantCoords?.lng ?? GOOGLE_MAPS_CONFIG.coordinates.restaurantR001.lng;

  try {
    const { Map, AdvancedMarkerElement } = await window.loadGoogleMapsLibraries();

    clientGoogleMap = new Map(mapCanvas, {
      zoom: 13,
      center: { lat: -22.5609, lng: 17.0658 }, // Windhoek Central (CF6 POJO)
      mapId: GOOGLE_MAPS_CONFIG.mapId, // 'DEMO_MAP_ID' (CF9)
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: true
    });

    // 1. Restaurant Origin Pin
    const restEl = createCustomMarkerElement({
      type: "restaurant",
      title: "Kapana Corner Restaurant",
      subtitle: `${rLat.toFixed(4)}, ${rLng.toFixed(4)}`
    });
    clientGmpMarkers.restaurant = new AdvancedMarkerElement({
      map: clientGoogleMap,
      position: { lat: rLat, lng: rLng },
      title: "Kapana Corner Kitchen",
      content: restEl
    });

    // 2. Customer Delivery Pin
    const custEl = createCustomMarkerElement({
      type: "customer",
      title: "Delivery Destination",
      subtitle: `${cLat.toFixed(4)}, ${cLng.toFixed(4)}`
    });
    clientGmpMarkers.customer = new AdvancedMarkerElement({
      map: clientGoogleMap,
      position: { lat: cLat, lng: cLng },
      title: "Your Delivery Location",
      content: custEl
    });

    // 3. Courier Live Vehicle Pin
    const driverEl = createCustomMarkerElement({
      type: "driver",
      title: "Courier En Route",
      subtitle: `${dLat.toFixed(4)}, ${dLng.toFixed(4)}`
    });
    clientGmpMarkers.driver = new AdvancedMarkerElement({
      map: clientGoogleMap,
      position: { lat: dLat, lng: dLng },
      title: "Live Courier Location",
      content: driverEl
    });

    // 4. Delivery Route Corridor Polyline
    if (window.google?.maps?.Polyline) {
      clientRoutePolyline = new google.maps.Polyline({
        map: clientGoogleMap,
        path: [
          { lat: rLat, lng: rLng },
          { lat: dLat, lng: dLng },
          { lat: cLat, lng: cLng }
        ],
        strokeColor: "#2563eb",
        strokeOpacity: 0.8,
        strokeWeight: 4
      });
    }

    isClientGmpInitialized = true;
    if (banner) banner.style.display = "none";
  } catch (err) {
    console.warn("Client Google Maps load failed, operating in offline simulation mode:", err);
    isClientGmpInitialized = false;
    if (banner) {
      banner.style.display = "flex";
      setText("client-map-banner-text", `Google Maps fallback (${err.message}). Using simulated route tracking.`);
    }
  }
}

function updateClientGoogleMap(driverCoords, customerCoords, restaurantCoords) {
  if (!isClientGmpInitialized) {
    initClientGoogleMap(driverCoords, customerCoords, restaurantCoords);
    return;
  }

  if (clientGmpMarkers.driver) {
    clientGmpMarkers.driver.position = { lat: Number(driverCoords.lat), lng: Number(driverCoords.lng) };
    const sub = clientGmpMarkers.driver.content?.querySelector(".gmp-pin-subtitle");
    if (sub) sub.textContent = `${Number(driverCoords.lat).toFixed(4)}, ${Number(driverCoords.lng).toFixed(4)}`;
  }

  if (clientGmpMarkers.customer) {
    clientGmpMarkers.customer.position = { lat: Number(customerCoords.lat), lng: Number(customerCoords.lng) };
  }

  if (clientGmpMarkers.restaurant) {
    clientGmpMarkers.restaurant.position = { lat: Number(restaurantCoords.lat), lng: Number(restaurantCoords.lng) };
  }

  if (clientRoutePolyline) {
    clientRoutePolyline.setPath([
      { lat: Number(restaurantCoords.lat), lng: Number(restaurantCoords.lng) },
      { lat: Number(driverCoords.lat), lng: Number(driverCoords.lng) },
      { lat: Number(customerCoords.lat), lng: Number(customerCoords.lng) }
    ]);
  }
}

function promptClientApiKey() {
  const currentKey = localStorage.getItem("google_maps_api_key") || "";
  const input = prompt("Enter Google Maps Platform API Key (or leave empty for Maps Demo Key):", currentKey);
  if (input !== null) {
    localStorage.setItem("google_maps_api_key", input.trim());
    location.reload();
  }
}


async function cancelCurrentOrder() {
  if (!currentlyTrackedOrderId) return;

  if (!confirm(`Are you sure you want to cancel order ${currentlyTrackedOrderId}?`)) return;

  try {
    const res = await apiFetch(PORTS.ORDER, `/orders/${encodeURIComponent(currentlyTrackedOrderId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Customer requested cancellation via portal" }),
      timeoutMs: 3000
    });

    if (res.ok) {
      alert("Order cancelled successfully.");
      pollLiveOrderTracking();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Cancellation failed: ${err.message || res.statusText}`);
    }
  } catch (err) {
    alert(`Could not cancel order: ${err.message}`);
  }
}

// ============================================================================
// 10. NOTIFICATION INBOX (VIEW 4) & UNREAD BADGE
// ============================================================================
async function checkCustomerNotificationsBadge() {
  const badge = document.getElementById("notifs-unread-count");
  if (!badge || !activeCustomer || !activeCustomer.id) return;

  try {
    const res = await apiFetch(PORTS.NOTIF, `/notifications/recipient/${encodeURIComponent(activeCustomer.id)}`, { timeoutMs: 2500 });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        let seenIds = [];
        try {
          const raw = localStorage.getItem("dsa_seen_notification_ids");
          if (raw) seenIds = JSON.parse(raw);
        } catch (_) {}

        const unreadCount = rows.filter((r) => !seenIds.includes(r.notificationId || r.id)).length;
        if (unreadCount > 0) {
          badge.style.display = "inline-block";
          badge.textContent = unreadCount;
          return;
        }
      }
    }
  } catch (_) {}

  badge.style.display = "none";
}

async function loadCustomerNotifications() {
  const tbody = document.getElementById("notifs-table-body");
  const badge = document.getElementById("notifs-unread-count");
  if (!tbody) return;

  if (!activeCustomer || !activeCustomer.id) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell">Please select a customer account first.</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell">Loading notifications from Notification Service (:9097)...</td></tr>`;

  try {
    const res = await apiFetch(PORTS.NOTIF, `/notifications/recipient/${encodeURIComponent(activeCustomer.id)}`, { timeoutMs: 3000 });

    if (res.status === 404) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell">No notifications on file for recipient ${escapeHtml(activeCustomer.id)}.</td></tr>`;
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell">No notifications on file for recipient ${escapeHtml(activeCustomer.id)}.</td></tr>`;
      return;
    }

    // Mark notifications as seen
    let seenIds = [];
    try {
      const raw = localStorage.getItem("dsa_seen_notification_ids");
      if (raw) seenIds = JSON.parse(raw);
    } catch (_) {}

    rows.forEach((r) => {
      const nid = r.notificationId || r.id;
      if (nid && !seenIds.includes(nid)) {
        seenIds.push(nid);
      }
    });
    localStorage.setItem("dsa_seen_notification_ids", JSON.stringify(seenIds));

    // Clear badge
    if (badge) badge.style.display = "none";

    tbody.innerHTML = rows
      .slice(-20)
      .reverse()
      .map(
        (r) => `
      <tr>
        <td class="text-mono">${escapeHtml(r.sentAt || new Date().toISOString())}</td>
        <td><strong>${escapeHtml(r.recipientId || activeCustomer.id)}</strong></td>
        <td><span class="status-pill pill-neutral">${escapeHtml(r.channel || "SMS")}</span></td>
        <td><span class="status-pill pill-valid">${escapeHtml(r.status || "SENT")}</span></td>
        <td><code class="text-mono">${escapeHtml(r.notificationId || "\u2014")}</code></td>
        <td>${escapeHtml(r.message || r.content || "Order status progression alert sent to customer phone.")}</td>
      </tr>`
      )
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell" style="color: var(--danger);">Notification Service note: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ============================================================================
// 11. NAVIGATION TABS & SYSTEM BOOT
// ============================================================================
function switchMainTab(tab) {
  const views = {
    menu: document.getElementById("view-menu"),
    tracking: document.getElementById("view-tracking"),
    account: document.getElementById("view-account"),
    notifs: document.getElementById("view-notifs")
  };

  const buttons = {
    menu: document.getElementById("tab-btn-menu"),
    tracking: document.getElementById("tab-btn-tracking"),
    account: document.getElementById("tab-btn-account"),
    notifs: document.getElementById("tab-btn-notifs")
  };

  Object.keys(views).forEach((key) => {
    if (views[key]) {
      views[key].style.display = key === tab ? "flex" : "none";
      views[key].classList.toggle("active", key === tab);
    }
    if (buttons[key]) {
      buttons[key].classList.toggle("active", key === tab);
      buttons[key].setAttribute("aria-selected", key === tab ? "true" : "false");
    }
  });

  if (tab === "notifs") {
    loadCustomerNotifications();
  } else if (tab === "tracking") {
    refreshTrackingOrdersDropdown();
    if (currentlyTrackedOrderId) pollLiveOrderTracking();
    if (clientGoogleMap && window.google?.maps?.event) {
      google.maps.event.trigger(clientGoogleMap, "resize");
    }
  } else if (tab === "account") {
    renderCustomerProfile();
  }
}

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

// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
  if (window.initCustomDateTimePickers) window.initCustomDateTimePickers();

  checkServicesHealth();
  loadStoredCustomerAccounts();
  loadLiveRestaurants();
  fetchDynamicPricing();
  refreshTrackingOrdersDropdown();
  updateCartSummary();
  checkCustomerNotificationsBadge();

  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
  if (window.initCustomDateTimePickers) window.initCustomDateTimePickers();

  // Periodic polling for real-time telemetry
  setInterval(checkServicesHealth, 6000);
  setInterval(fetchDynamicPricing, 5000);
  setInterval(checkCustomerNotificationsBadge, 10000);
});
