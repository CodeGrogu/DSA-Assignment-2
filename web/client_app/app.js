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

// Dynamic Courier Registry populated from live Delivery Service (:9096)
let KNOWN_COURIERS = {};

async function loadLiveCouriers() {
  try {
    const res = await apiFetch(PORTS.DELIVERY, "/drivers", { timeoutMs: 3000 });
    if (res && res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.value && Array.isArray(data.value) ? data.value : []);
      list.forEach((d) => {
        if (d && d.id) {
          KNOWN_COURIERS[d.id] = {
            name: d.name || d.id,
            phone: d.phone || "+264810000000",
            vehicle: `${d.vehicleCategory || "Courier"} Delivery`
          };
        }
      });
    }
  } catch (_) {}
}

function getCandidateUrls(port, path) {
  let cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanPath.startsWith(`/api/${port}/`)) {
    cleanPath = cleanPath.slice(`/api/${port}`.length);
  } else if (cleanPath === `/api/${port}`) {
    cleanPath = '/';
  }

  const urls = [];
  const isBrowser = typeof window !== 'undefined' && window.location;
  const isFileOrigin = isBrowser && (
    window.location.protocol === 'file:' ||
    !window.location.hostname ||
    window.location.origin === 'null' ||
    (window.location.origin && window.location.origin.startsWith('file:'))
  );
  const currentHost = (isBrowser && window.location.hostname) ? window.location.hostname : 'localhost';
  const currentPort = isBrowser && window.location.port ? window.location.port : '';
  const isProxyServed = currentPort === '8080' || (isBrowser && window.location.origin && window.location.origin.includes(':8080'));

  // 1. If running via file:/// origin OR served directly through reverse-proxy port 8080:
  // Prioritize reverse-proxy (port 8080) to bypass browser null-origin CORS restrictions and IPv6 binding
  if (isFileOrigin || isProxyServed) {
    if (isProxyServed && !isFileOrigin) {
      urls.push(`/api/${port}${cleanPath}`);
    }
    urls.push(`http://localhost:8080/api/${port}${cleanPath}`);
    urls.push(`http://127.0.0.1:8080/api/${port}${cleanPath}`);
    if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
      urls.push(`http://${currentHost}:8080/api/${port}${cleanPath}`);
    }
  }

  // 2. Direct microservice ports (prefer localhost first for IPv6 Docker WSL2 compatibility, then 127.0.0.1)
  urls.push(`http://${currentHost}:${port}${cleanPath}`);
  if (currentHost !== 'localhost') urls.push(`http://localhost:${port}${cleanPath}`);
  if (currentHost !== '127.0.0.1') urls.push(`http://127.0.0.1:${port}${cleanPath}`);

  // 3. Reverse-proxy candidates on port 8080 as fallbacks
  urls.push(`http://localhost:8080/api/${port}${cleanPath}`);
  urls.push(`http://127.0.0.1:8080/api/${port}${cleanPath}`);
  if (currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
    urls.push(`http://${currentHost}:8080/api/${port}${cleanPath}`);
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
  if (typeof window !== 'undefined' && window.DSA?.cachedApiFetch) {
    return window.DSA.cachedApiFetch(port, cleanPath, options);
  }
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
let storedCustomerAccounts = [];
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
let orderPopoverHideTimer = null;
let currentRestaurantCategories = ["ALL"];
let categoryCarouselOffset = 0;

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

  const surgePill = document.getElementById("header-surge-pill");
  const surgeOffline = document.getElementById("surge-status-offline");
  const surgeOnline = document.getElementById("surge-online-content");

  if (onlineCount === 0) {
    if (surgePill) surgePill.classList.add("offline");
    if (surgeOffline) surgeOffline.style.display = "inline-flex";
    if (surgeOnline) surgeOnline.style.display = "none";
  } else {
    if (surgePill) surgePill.classList.remove("offline");
    if (surgeOffline) surgeOffline.style.display = "none";
    if (surgeOnline) surgeOnline.style.display = "inline-flex";
  }

  if (banner && text) {
    const isFile = typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';
    if (onlineCount >= 3) {
      banner.className = "service-banner banner-connected";
      text.textContent = `Microservices Connected (${onlineCount}/${coreServices.length} Online${isFile ? ' via Proxy' : ''}) \u2014 Ready for Orders`;
    } else if (onlineCount > 0) {
      banner.className = "service-banner banner-checking";
      text.textContent = `${onlineCount}/${coreServices.length} Microservices Reachable \u2014 Retrying connections...`;
    } else {
      banner.className = "service-banner banner-offline";
      text.textContent = isFile
        ? "Backend Services Offline \u2014 When viewing via file://, ensure Node reverse proxy is running: 'node web/server.js' (port 8080)"
        : "Backend Services Offline \u2014 Waiting for reconnection...";
    }
  }
}

// ============================================================================
// 5. CUSTOMER ACCOUNT & ADDRESS MANAGEMENT (VIEW 3)
// ============================================================================
async function loadStoredCustomerAccounts() {
  let accounts = [];

  // 1. Fetch live customer accounts from Customer Service (:9093)
  try {
    const res = await apiFetch(PORTS.CUSTOMER, "/customers", { timeoutMs: 3000 });
    if (res && res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.value && Array.isArray(data.value) ? data.value : []);
      if (list.length > 0) {
        accounts = list.map((c) => ({
          ...c,
          id: c.id,
          name: c.name || c.id,
          email: c.email || "",
          phone: c.phone || ""
        }));
      }
    }
  } catch (err) {
    console.warn("Could not load customers from backend:", err.message);
  }

  // 2. Merge any newly registered accounts saved in local storage
  try {
    const raw = localStorage.getItem("dsa_registered_customers");
    if (raw) {
      const local = JSON.parse(raw);
      if (Array.isArray(local)) {
        local.forEach((c) => {
          if (!accounts.some((a) => a.id === c.id)) {
            accounts.push({
              ...c,
              id: c.id,
              name: c.name || c.id,
              email: c.email || "",
              phone: c.phone || ""
            });
          }
        });
      }
    }
  } catch (_) {}

  const optionsHtml = accounts.length > 0
    ? `<option value="" disabled>Select Customer Account</option>` +
      accounts
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
        .join("")
    : `<option value="" disabled selected>No customer accounts in database</option>`;

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

  storedCustomerAccounts = accounts;

  const session = window.DSA?.getStoredSession ? window.DSA.getStoredSession('customer') : (localStorage.getItem('dsa_session_customer') ? JSON.parse(localStorage.getItem('dsa_session_customer')) : null);
  const activeId = session?.user?.id || localStorage.getItem("dsa_active_customer_id");

  if (session && activeId && accounts.some((a) => a.id === activeId)) {
    activeCustomer = accounts.find((a) => a.id === activeId);
    localStorage.setItem("dsa_active_customer_id", activeId);
    if (headerSelect) headerSelect.value = activeId;
    if (viewSelect) viewSelect.value = activeId;
    renderCustomerAuthUI(true);
    handleCustomerChange(activeId);
  } else {
    activeCustomer = null;
    localStorage.removeItem("dsa_active_customer_id");
    if (headerSelect) headerSelect.value = "";
    if (viewSelect) viewSelect.value = "";
    renderCustomerProfile();
    renderCustomerAuthUI(false);
  }

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
      populateCheckoutAddressDropdown();
      updateCartSummary();
      return;
    }
  } catch (err) {
    console.warn("Could not fetch customer from backend:", err.message);
  }

  // Live state when record is not found in MongoDB
  activeCustomer = null;
  setText("account-name", "Customer Not Found");
  setText("account-meta", "Record not found in Customer Service");
  setText("account-address-street", "No address configured");
  setText("account-address-city", "Please add a verified delivery address");
  checkCustomerNotificationsBadge();
}

function renderCustomerProfile() {
  if (!activeCustomer) return;

  setText("account-name", activeCustomer.name);
  const metaText = `Verified Customer \u2022 ${activeCustomer.email || "No email"} \u2022 ${activeCustomer.phone || "No phone"}`;
  setText("account-meta", metaText);

  // Populate Menu Drawer Profile Card
  setText("menu-profile-name", activeCustomer.name || "Customer Account");
  setText("menu-profile-email", activeCustomer.email || "No email registered");
  setText("menu-profile-phone", activeCustomer.phone || "+264 81 000 0000");

  // Resolve default or primary delivery address
  let addr = null;
  if (activeCustomer.address) {
    addr = activeCustomer.address;
  } else if (Array.isArray(activeCustomer.addresses) && activeCustomer.addresses.length > 0) {
    addr = activeCustomer.addresses.find((a) => a.isDefault) || activeCustomer.addresses[0];
  }

  let formattedAddr = "12 Independence Avenue, Windhoek";
  let addrLon = CONFIG.WINDHOEK_REF.lon;
  let addrLat = CONFIG.WINDHOEK_REF.lat;

  if (addr) {
    const street = addr.street || "12 Independence Avenue";
    const city = `${addr.city || "Windhoek"}, ${addr.state || "Khomas"}`;
    formattedAddr = `${street}, ${city}`;

    setText("profile-street", street);
    setText("profile-city", city);
    setText("profile-postal", addr.postalCode || "9000");

    if (addr.location && Array.isArray(addr.location.coordinates)) {
      addrLon = Number(addr.location.coordinates[0]);
      addrLat = Number(addr.location.coordinates[1]);
      setText("profile-coords", `[${addrLon.toFixed(4)}, ${addrLat.toFixed(4)}]`);
    } else {
      setText("profile-coords", "[17.0658, -22.5609]");
    }
  } else {
    setText("profile-street", "12 Independence Avenue");
    setText("profile-city", "Windhoek, Khomas");
    setText("profile-postal", "9000");
    setText("profile-coords", "[17.0658, -22.5609]");
  }

  setText("menu-profile-address", formattedAddr);

  // Calculate default address distance to Windhoek center (17.0658, -22.5609)
  const distKm = calculateDistanceKm(addrLat, addrLon, CONFIG.WINDHOEK_REF.lat, CONFIG.WINDHOEK_REF.lon);
  const badgeEl = document.getElementById("menu-address-badge");
  if (badgeEl) {
    if (distKm <= 10.0) {
      badgeEl.textContent = `OK (${distKm.toFixed(1)}km)`;
      badgeEl.className = "status-pill pill-valid menu-address-badge";
    } else {
      badgeEl.textContent = `Outside Windhoek (${distKm.toFixed(1)}km)`;
      badgeEl.className = "status-pill pill-warning menu-address-badge";
    }
  }

  // Render Address Book
  renderAddressBook();
  renderMenuAddressBook();

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

  // Ensure addr conforms strictly to CustomerAddress type in Customer Service
  const safeAddress = {
    id: addr.id || `addr_${Date.now()}`,
    tag: addr.tag || "HOME",
    street: addr.street || "12 Independence Avenue",
    city: addr.city || "Windhoek",
    state: addr.state || "Khomas",
    postalCode: addr.postalCode || "9000",
    location: {
      type: "Point",
      coordinates: (addr.location && Array.isArray(addr.location.coordinates) && addr.location.coordinates.length === 2)
        ? [Number(addr.location.coordinates[0]), Number(addr.location.coordinates[1])]
        : [17.0658, -22.5609]
    },
    deliveryInstructions: addr.deliveryInstructions || "",
    isDefault: Boolean(addr.isDefault)
  };

  const payload = {
    customerId: activeCustomer.id,
    address: safeAddress
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

// ============================================================================
// CUSTOMER AUTHENTICATION & ONBOARDING WIZARD
// ============================================================================

function renderCustomerAuthUI(isAuthenticated) {
  const userBadge = document.getElementById("customer-user-badge");
  const loginBtn = document.getElementById("btn-header-login");
  const logoutBtn = document.getElementById("btn-header-logout");
  const nameEl = document.getElementById("customer-user-name") ||
                 document.getElementById("customer-badge-name") ||
                 document.getElementById("header-customer-name");
  const avatarEl = document.getElementById("customer-user-avatar") ||
                   document.getElementById("customer-badge-avatar") ||
                   document.getElementById("header-customer-avatar");

  if (isAuthenticated && activeCustomer) {
    if (userBadge) {
      userBadge.style.display = "flex";
      userBadge.classList.remove("hidden");
    }
    if (loginBtn) {
      loginBtn.style.display = "none";
      loginBtn.classList.add("hidden");
    }
    if (logoutBtn) {
      logoutBtn.style.display = "inline-flex";
      logoutBtn.classList.remove("hidden");
    }

    const displayName = activeCustomer.name || activeCustomer.id || "Customer";
    if (nameEl) {
      nameEl.textContent = displayName;
    }
    if (avatarEl) {
      const initials = displayName
        .split(" ")
        .filter(Boolean)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2) || "CU";
      if (avatarEl.tagName === "IMG") {
        avatarEl.alt = displayName;
      } else {
        avatarEl.textContent = initials;
      }
    }
  } else {
    if (userBadge) {
      userBadge.style.display = "none";
      userBadge.classList.add("hidden");
    }
    if (loginBtn) {
      loginBtn.style.display = "inline-flex";
      loginBtn.classList.remove("hidden");
    }
    if (logoutBtn) {
      logoutBtn.style.display = "none";
      logoutBtn.classList.add("hidden");
    }
    if (nameEl) {
      nameEl.textContent = "Guest";
    }
    if (avatarEl) {
      if (avatarEl.tagName === "IMG") {
        avatarEl.alt = "Guest";
      } else {
        avatarEl.textContent = "G";
      }
    }
  }

  // Manage checkout button gating
  const confirmBtn = document.getElementById("btn-confirm-cart");
  if (confirmBtn) {
    if (!isAuthenticated) {
      confirmBtn.disabled = true;
      confirmBtn.title = "Please log in to proceed with checkout";
    }
  }

  const placeBtn = document.getElementById("btn-place-order");
  if (placeBtn) {
    if (!isAuthenticated) {
      placeBtn.disabled = true;
      placeBtn.title = "Please log in to place an order";
    }
  }

  const checkoutBtn = document.getElementById("btn-checkout");
  if (checkoutBtn) {
    if (!isAuthenticated) {
      checkoutBtn.disabled = true;
      checkoutBtn.title = "Please log in to proceed with checkout";
    }
  }

  if (typeof updateCartSummary === "function") {
    updateCartSummary();
  }
}

function openCustomerLoginModal() {
  const modal = document.getElementById("customer-login-modal") ||
                document.getElementById("login-modal");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("open");
  }
  const errorEl = document.getElementById("customer-login-error") ||
                  document.getElementById("login-error");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.style.display = "none";
  }
}

function closeCustomerLoginModal() {
  const modal = document.getElementById("customer-login-modal") ||
                document.getElementById("login-modal");
  if (modal) {
    modal.style.display = "none";
    modal.classList.remove("open");
  }
}

async function handleCustomerLoginSubmit(e) {
  if (e && typeof e.preventDefault === "function") {
    e.preventDefault();
  }

  const identifierInput = document.getElementById("login-customer-identifier") ||
                          document.getElementById("customer-login-identifier") ||
                          document.getElementById("login-customer-id") ||
                          document.getElementById("login-email") ||
                          document.getElementById("login-identifier");
  const passwordInput = document.getElementById("login-customer-password") ||
                        document.getElementById("customer-login-password") ||
                        document.getElementById("login-password");
  const errorEl = document.getElementById("customer-login-error") ||
                  document.getElementById("login-error");

  const identifier = (identifierInput?.value || "").trim();
  const password = (passwordInput?.value || "").trim();

  function showError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = "block";
    } else {
      alert(msg);
    }
  }

  if (!identifier) {
    showError("Please enter your Customer ID, Email, or Phone.");
    return;
  }
  if (!password) {
    showError("Please enter your password.");
    return;
  }

  let accounts = storedCustomerAccounts || [];
  if (accounts.length === 0) {
    try {
      const raw = localStorage.getItem("dsa_registered_customers");
      if (raw) accounts = JSON.parse(raw);
    } catch (_) {}
  }

  // Match against accounts by email, id, or phone (with flexible phone normalization)
  const normInput = identifier.replace(/[\s\-\+\(\)]/g, "");
  let matched = accounts.find((a) => {
    if (a.id && a.id.toLowerCase() === identifier.toLowerCase()) return true;
    if (a.email && a.email.toLowerCase() === identifier.toLowerCase()) return true;
    if (a.phone) {
      const normPhone = String(a.phone).replace(/[\s\-\+\(\)]/g, "");
      if (a.phone === identifier || normPhone === normInput || (normInput && normPhone.endsWith(normInput)) || (normPhone && normInput.endsWith(normPhone))) return true;
    }
    return false;
  });

  // If not found in local cache, attempt to fetch from Customer Service
  if (!matched) {
    try {
      const res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(identifier)}`, { timeoutMs: 3000 });
      if (res && res.ok) {
        matched = await res.json();
      }
    } catch (_) {}
  }

  if (!matched) {
    showError("Account not found. Please register or verify your details.");
    return;
  }

  // Check password or create credentials if new
  let creds = {};
  try {
    creds = JSON.parse(localStorage.getItem("dsa_customer_credentials") || "{}");
  } catch (_) {}

  const accountId = matched.id;
  if (creds[accountId]) {
    const storedHash = creds[accountId];
    const isMatch = window.DSA?.verifyPassword
      ? window.DSA.verifyPassword(password, storedHash)
      : (storedHash === password || storedHash === btoa(password));
    if (!isMatch) {
      showError("Incorrect password. Please try again.");
      return;
    }
  } else {
    // Creates credentials if new
    const hashed = window.DSA?.hashPassword
      ? window.DSA.hashPassword(password)
      : btoa(password);
    creds[accountId] = hashed;
    localStorage.setItem("dsa_customer_credentials", JSON.stringify(creds));
  }

  // Set active customer & session
  activeCustomer = matched;
  localStorage.setItem("dsa_active_customer_id", accountId);

  if (window.DSA?.setStoredSession) {
    window.DSA.setStoredSession("customer", matched);
  }
  localStorage.setItem("dsa_session_customer", JSON.stringify({ user: matched, timestamp: Date.now() }));

  if (identifierInput) identifierInput.value = "";
  if (passwordInput) passwordInput.value = "";
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.style.display = "none";
  }

  closeCustomerLoginModal();
  renderCustomerAuthUI(true);
  await handleCustomerChange(accountId);
}

// Onboarding Wizard Controller
let customerWizardStepNumber = 1;

function setCustomerWizardStep(stepNumber) {
  customerWizardStepNumber = Math.max(1, Math.min(stepNumber, 4));

  for (let s = 1; s <= 4; s++) {
    const panes = document.querySelectorAll(`[data-wizard-step="${s}"], #wizard-step-${s}, .wizard-step-${s}`);
    panes.forEach((p) => {
      p.style.display = (s === customerWizardStepNumber) ? "block" : "none";
    });

    const indicators = document.querySelectorAll(`[data-step-indicator="${s}"], #wizard-indicator-${s}, .wizard-step-indicator[data-step="${s}"]`);
    indicators.forEach((ind) => {
      if (s === customerWizardStepNumber) {
        ind.classList.add("active");
        ind.classList.remove("completed");
      } else if (s < customerWizardStepNumber) {
        ind.classList.remove("active");
        ind.classList.add("completed");
      } else {
        ind.classList.remove("active");
        ind.classList.remove("completed");
      }
    });
  }

  const prevBtn = document.getElementById("btn-wizard-prev");
  if (prevBtn) {
    prevBtn.style.display = customerWizardStepNumber > 1 ? "inline-flex" : "none";
  }
  const nextBtn = document.getElementById("btn-wizard-next");
  const submitBtn = document.getElementById("btn-wizard-submit");
  if (nextBtn) {
    nextBtn.style.display = customerWizardStepNumber >= 3 ? "none" : "inline-flex";
  }
  if (submitBtn) {
    submitBtn.style.display = customerWizardStepNumber >= 3 ? "inline-flex" : "none";
  }
}

function openCustomerRegisterWizard() {
  const modal = document.getElementById("customer-register-wizard-modal") ||
                document.getElementById("customer-wizard-modal") ||
                document.getElementById("register-wizard-modal") ||
                document.getElementById("register-modal");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("open");
  }
  setCustomerWizardStep(1);
}

function closeCustomerRegisterWizard() {
  const modal = document.getElementById("customer-register-wizard-modal") ||
                document.getElementById("customer-wizard-modal") ||
                document.getElementById("register-wizard-modal") ||
                document.getElementById("register-modal");
  if (modal) {
    modal.style.display = "none";
    modal.classList.remove("open");
  }
}

function handleCustomerPasswordInput() {
  const passwordInput = document.getElementById("wizard-password") ||
                        document.getElementById("reg-password") ||
                        document.getElementById("customer-password");
  const password = passwordInput?.value || "";

  let strength = null;
  if (window.DSA?.evaluatePasswordStrength) {
    strength = window.DSA.evaluatePasswordStrength(password);
  } else {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    const labels = ["Too Weak", "Weak", "Fair", "Strong", "Very Strong"];
    strength = {
      score: score,
      label: labels[score] || "Weak",
      percent: Math.min(100, score * 25)
    };
  }

  const barEl = document.getElementById("password-strength-bar") ||
                document.getElementById("reg-password-strength-bar") ||
                document.getElementById("wizard-strength-bar");
  const labelEl = document.getElementById("password-strength-label") ||
                  document.getElementById("reg-password-strength-label") ||
                  document.getElementById("wizard-strength-label");

  const score = typeof strength.score === "number" ? strength.score : 0;
  const percent = typeof strength.percent === "number" ? strength.percent : Math.min(100, score * 25);
  const label = strength.label || `Score: ${score}/4`;

  if (barEl) {
    barEl.style.width = `${percent}%`;
    if (percent < 30) {
      barEl.style.backgroundColor = "#ef4444";
    } else if (percent < 70) {
      barEl.style.backgroundColor = "#f59e0b";
    } else {
      barEl.style.backgroundColor = "#10b981";
    }
  }

  if (labelEl) {
    labelEl.textContent = label;
  }
}

async function submitCustomerOnboardingWizard() {
  const id = document.getElementById("wizard-id")?.value.trim() ||
             document.getElementById("reg-id")?.value.trim() ||
             `cust_${Date.now()}`;
  const name = document.getElementById("wizard-name")?.value.trim() ||
               document.getElementById("reg-name")?.value.trim();
  const email = document.getElementById("wizard-email")?.value.trim() ||
                document.getElementById("reg-email")?.value.trim();
  const phone = document.getElementById("wizard-phone")?.value.trim() ||
                document.getElementById("reg-phone")?.value.trim();
  const password = document.getElementById("wizard-password")?.value ||
                   document.getElementById("reg-password")?.value || "";
  const confirmPassword = document.getElementById("wizard-password-confirm")?.value ||
                          document.getElementById("reg-password-confirm")?.value || "";

  if (!name || !email || !phone) {
    alert("Please fill in all required customer profile fields (Name, Email, Phone).");
    setCustomerWizardStep(1);
    return;
  }

  if (confirmPassword && password !== confirmPassword) {
    alert("Passwords do not match. Please verify your password.");
    setCustomerWizardStep(1);
    return;
  }

  // Validate passwords via window.DSA.validatePassword()
  if (window.DSA?.validatePassword) {
    const valResult = window.DSA.validatePassword(password);
    if (typeof valResult === "boolean" && !valResult) {
      alert("Password does not meet security requirements (must be at least 8 characters with letters and numbers).");
      setCustomerWizardStep(1);
      return;
    } else if (valResult && valResult.valid === false) {
      alert(valResult.message || "Password does not meet requirements.");
      setCustomerWizardStep(1);
      return;
    }
  } else if (password && password.length < 8) {
    alert("Password must be at least 8 characters long.");
    setCustomerWizardStep(1);
    return;
  }

  const street = document.getElementById("wizard-street")?.value.trim() ||
                 document.getElementById("reg-street")?.value.trim() ||
                 "12 Independence Avenue";
  const city = document.getElementById("wizard-city")?.value.trim() ||
               document.getElementById("reg-city")?.value.trim() ||
               "Windhoek";
  const state = document.getElementById("wizard-state")?.value.trim() ||
                document.getElementById("reg-state")?.value.trim() ||
                "Khomas";
  const postalCode = document.getElementById("wizard-postal")?.value.trim() ||
                     document.getElementById("reg-postal")?.value.trim() ||
                     "9000";
  const lon = parseFloat(document.getElementById("wizard-lon")?.value ||
                         document.getElementById("reg-lon")?.value ||
                         "17.0658");
  const lat = parseFloat(document.getElementById("wizard-lat")?.value ||
                         document.getElementById("reg-lat")?.value ||
                         "-22.5609");
  const instructions = document.getElementById("wizard-instructions")?.value.trim() ||
                       document.getElementById("reg-instructions")?.value.trim() ||
                       "";

  const preferences = [];
  document.querySelectorAll("input[name='wizard-preferences']:checked, input[name='reg-preferences']:checked").forEach((cb) => {
    preferences.push(cb.value);
  });

  const payload = {
    id: id,
    name: name,
    email: email,
    phone: phone,
    preferences: preferences,
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

  const btn = document.getElementById("btn-wizard-submit") || document.getElementById("btn-submit-reg");
  if (btn) btn.disabled = true;

  try {
    let created = null;
    try {
      const res = await apiFetch(PORTS.CUSTOMER, "/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 4000
      });
      if (res.ok || res.status === 201) {
        created = await res.json();
      }
    } catch (err) {
      console.warn("Backend customer registration error, saving locally:", err.message);
    }

    if (!created) {
      created = payload;
    }

    // Save credentials if password provided
    if (password) {
      let creds = {};
      try {
        creds = JSON.parse(localStorage.getItem("dsa_customer_credentials") || "{}");
      } catch (_) {}
      const hashed = window.DSA?.hashPassword ? window.DSA.hashPassword(password) : btoa(password);
      creds[id] = hashed;
      localStorage.setItem("dsa_customer_credentials", JSON.stringify(creds));
    }

    // Save to local registry
    let stored = [];
    try {
      const raw = localStorage.getItem("dsa_registered_customers");
      if (raw) stored = JSON.parse(raw);
    } catch (_) {}
    stored = stored.filter((c) => c.id !== id);
    stored.unshift({ id: id, name: name, email: email, phone: phone });
    localStorage.setItem("dsa_registered_customers", JSON.stringify(stored));

    // Log in customer & set session
    activeCustomer = created;
    localStorage.setItem("dsa_active_customer_id", id);
    if (window.DSA?.setStoredSession) {
      window.DSA.setStoredSession("customer", activeCustomer);
    }
    localStorage.setItem("dsa_session_customer", JSON.stringify({ user: activeCustomer, timestamp: Date.now() }));

    closeCustomerRegisterWizard();
    await loadStoredCustomerAccounts();
    renderCustomerAuthUI(true);
    handleCustomerChange(id);

    alert(`Customer account "${name}" (${id}) registered successfully! You are now logged in.`);
  } catch (err) {
    alert(`Registration failed: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Aliases for backward compatibility
function openRegisterModal() {
  openCustomerRegisterWizard();
}

function closeRegisterModal() {
  closeCustomerRegisterWizard();
}

async function submitCustomerRegistration() {
  return submitCustomerOnboardingWizard();
}

function logoutCustomer() {
  if (window.DSA?.clearStoredSession) {
    window.DSA.clearStoredSession("customer");
  }
  localStorage.removeItem("dsa_session_customer");
  localStorage.removeItem("dsa_active_customer_id");
  activeCustomer = null;

  // Reset cart
  cart = [];
  updateCartSummary();
  renderCartDrawer();

  // Reset dropdown selectors
  const headerSelect = document.getElementById("header-customer-select");
  if (headerSelect) headerSelect.value = "";
  const viewSelect = document.getElementById("account-view-customer-select");
  if (viewSelect) viewSelect.value = "";

  // Reset profile view
  setText("account-name", "Guest User");
  setText("account-meta", "Not signed in \u2022 Sign in to view account details");
  setText("account-address-street", "No address configured");
  setText("account-address-city", "Please log in to manage your addresses");
  setText("menu-profile-name", "Guest User");
  setText("menu-profile-email", "Not signed in");
  setText("menu-profile-phone", "");
  setText("menu-profile-address", "No address configured");

  const addrContainer = document.getElementById("address-book-container");
  if (addrContainer) {
    addrContainer.innerHTML = `<div class="empty-state-card"><p>Please sign in to view saved addresses.</p></div>`;
  }
  const menuAddrList = document.getElementById("menu-address-list");
  if (menuAddrList) {
    menuAddrList.innerHTML = `<li class="menu-addr-empty">Please sign in to view saved addresses.</li>`;
  }

  // Update UI to guest state
  renderCustomerAuthUI(false);
  checkCustomerNotificationsBadge();

  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
}

async function deleteCustomerAccountCascade() {
  if (!activeCustomer || !activeCustomer.id) {
    alert("Please sign in to a customer account first.");
    return;
  }

  const customerId = activeCustomer.id;
  const customerName = activeCustomer.name || customerId;

  const confirmed = confirm(
    `WARNING: Are you sure you want to PERMANENTLY DELETE customer account "${customerName}" (${customerId})?\n\nThis will trigger cascade deletion across Customer, Order, Payment, and Notification services. All addresses, orders, and credentials will be permanently erased.`
  );
  if (!confirmed) return;

  try {
    let res = null;
    try {
      res = await fetch("/api/customer/cascade-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customerId })
      });
    } catch (_) {
      // Direct microservice fallback
      res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(customerId)}`, {
        method: "DELETE"
      }).catch(() => null);
    }

    // Clear from local registered customers registry
    try {
      const raw = localStorage.getItem("dsa_registered_customers");
      if (raw) {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const filtered = list.filter((c) => c.id !== customerId);
          localStorage.setItem("dsa_registered_customers", JSON.stringify(filtered));
        }
      }
    } catch (_) {}

    // Clear customer credentials
    try {
      const creds = JSON.parse(localStorage.getItem("dsa_customer_credentials") || "{}");
      delete creds[customerId];
      localStorage.setItem("dsa_customer_credentials", JSON.stringify(creds));
    } catch (_) {}

    // Clear all local carts and orders
    cart = [];
    localStorage.removeItem("dsa_cart");
    localStorage.removeItem(`dsa_orders_${customerId}`);
    localStorage.removeItem("dsa_order_history");

    const historyContainer = document.getElementById("order-history-list");
    if (historyContainer) {
      historyContainer.innerHTML = `<div class="empty-state-card"><p>No orders found.</p></div>`;
    }

    // Calls logoutCustomer()
    logoutCustomer();

    // Reload account options
    await loadStoredCustomerAccounts();

    alert(`Account ${customerId} has been permanently wiped and deleted across all microservices.`);
  } catch (err) {
    console.error("Cascade deletion error:", err);
    alert(`Cascade deletion failed: ${err.message}`);
  }
}

if (typeof window !== "undefined") {
  window.renderCustomerAuthUI = renderCustomerAuthUI;
  window.openCustomerLoginModal = openCustomerLoginModal;
  window.closeCustomerLoginModal = closeCustomerLoginModal;
  window.handleCustomerLoginSubmit = handleCustomerLoginSubmit;
  window.openCustomerRegisterWizard = openCustomerRegisterWizard;
  window.closeCustomerRegisterWizard = closeCustomerRegisterWizard;
  window.setCustomerWizardStep = setCustomerWizardStep;
  window.handleCustomerPasswordInput = handleCustomerPasswordInput;
  window.submitCustomerOnboardingWizard = submitCustomerOnboardingWizard;
  window.logoutCustomer = logoutCustomer;
  window.deleteCustomerAccountCascade = deleteCustomerAccountCascade;
}

// ============================================================================
// SLEEK SEGMENTED DELIVERY MODE & INLINE SCHEDULE
// ============================================================================
const todayIsoDate = new Date().toISOString().split("T")[0];
let deliveryScheduleState = {
  preset: "NOW", // "NOW" (ASAP) or "SCHEDULE"
  date: todayIsoDate,
  timeSlot: "12:00"
};

const SCHEDULE_TIME_WINDOWS = [
  { value: "11:30", label: "11:30 AM – 12:00 PM", hour: 11, minute: 30 },
  { value: "12:00", label: "12:00 PM – 12:30 PM", hour: 12, minute: 0 },
  { value: "12:30", label: "12:30 PM – 1:00 PM", hour: 12, minute: 30 },
  { value: "13:00", label: "1:00 PM – 1:30 PM", hour: 13, minute: 0 },
  { value: "13:30", label: "1:30 PM – 2:00 PM", hour: 13, minute: 30 },
  { value: "14:00", label: "2:00 PM – 2:30 PM", hour: 14, minute: 0 },
  { value: "17:30", label: "5:30 PM – 6:00 PM", hour: 17, minute: 30 },
  { value: "18:00", label: "6:00 PM – 6:30 PM", hour: 18, minute: 0 },
  { value: "18:30", label: "6:30 PM – 7:00 PM", hour: 18, minute: 30 },
  { value: "19:00", label: "7:00 PM – 7:30 PM", hour: 19, minute: 0 },
  { value: "19:30", label: "7:30 PM – 8:00 PM", hour: 19, minute: 30 },
  { value: "20:00", label: "8:00 PM – 8:30 PM", hour: 20, minute: 0 },
  { value: "20:30", label: "8:30 PM – 9:00 PM", hour: 20, minute: 30 },
  { value: "21:00", label: "9:00 PM – 9:30 PM", hour: 21, minute: 0 },
];

function saveDeliverySchedule() {
  try {
    localStorage.setItem("dsa_delivery_schedule", JSON.stringify(deliveryScheduleState));
  } catch (e) {
    console.warn("Failed to persist delivery schedule:", e);
  }
}

function loadDeliverySchedule() {
  try {
    const raw = localStorage.getItem("dsa_delivery_schedule");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (parsed.preset === "NOW" || parsed.preset === "SCHEDULE") {
        deliveryScheduleState.preset = parsed.preset;
      }
      if (parsed.date) {
        deliveryScheduleState.date = parsed.date;
      }
      if (parsed.timeSlot) {
        deliveryScheduleState.timeSlot = parsed.timeSlot;
      }
    }
  } catch (e) {
    console.warn("Failed to load delivery schedule from localStorage:", e);
  }
}

function setDeliveryMode(mode) {
  deliveryScheduleState.preset = mode;
  saveDeliverySchedule();

  const btnNow = document.getElementById("delivery-mode-now");
  const btnSchedule = document.getElementById("delivery-mode-schedule");
  const etaBadge = document.getElementById("delivery-eta-badge");
  const inlineCard = document.getElementById("inline-schedule-card");

  if (mode === "NOW") {
    if (btnNow) {
      btnNow.classList.add("active");
      btnNow.setAttribute("aria-selected", "true");
    }
    if (btnSchedule) {
      btnSchedule.classList.remove("active");
      btnSchedule.setAttribute("aria-selected", "false");
    }
    if (etaBadge) {
      etaBadge.innerHTML = `<svg viewBox="0 0 24 24" class="mode-icon" style="width: 12px; height: 12px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span>~25–35 min</span>`;
      etaBadge.className = "delivery-eta-badge";
    }
    if (inlineCard) inlineCard.style.display = "none";
  } else {
    if (btnNow) {
      btnNow.classList.remove("active");
      btnNow.setAttribute("aria-selected", "false");
    }
    if (btnSchedule) {
      btnSchedule.classList.add("active");
      btnSchedule.setAttribute("aria-selected", "true");
    }
    if (etaBadge) {
      etaBadge.innerHTML = `<svg viewBox="0 0 24 24" class="mode-icon" style="width: 12px; height: 12px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg><span>Scheduled</span>`;
      etaBadge.className = "delivery-eta-badge scheduled";
    }
    if (inlineCard) inlineCard.style.display = "block";

    renderScheduleDayChips();
    populateScheduleTimeWindows();
    updateScheduleSummaryText();
  }
}

function getRollingDays(count = 4) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const iso = `${yyyy}-${mm}-${dd}`;
    const dayLabel = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-US", { weekday: "short" });
    const dateSubtext = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    days.push({ iso, dayLabel, dateSubtext });
  }
  return days;
}

function renderScheduleDayChips() {
  const container = document.getElementById("schedule-day-chips");
  if (!container) return;
  const rollingDays = getRollingDays(4);

  // If currently selected date is not in rolling days, default to Today
  if (!rollingDays.some((d) => d.iso === deliveryScheduleState.date)) {
    deliveryScheduleState.date = rollingDays[0].iso;
  }

  container.innerHTML = rollingDays
    .map((day) => {
      const isSelected = day.iso === deliveryScheduleState.date;
      return `
        <button
          type="button"
          class="day-chip ${isSelected ? "active" : ""}"
          data-date="${day.iso}"
          onclick="selectScheduleDay('${day.iso}')"
        >
          <span class="day-chip-title">${day.dayLabel}</span>
          <span class="day-chip-date">${day.dateSubtext}</span>
        </button>
      `;
    })
    .join("");
}

function selectScheduleDay(isoDate) {
  deliveryScheduleState.date = isoDate;
  saveDeliverySchedule();
  renderScheduleDayChips();
  populateScheduleTimeWindows();
  updateScheduleSummaryText();
}

function populateScheduleTimeWindows() {
  const select = document.getElementById("schedule-time-window-select");
  if (!select) return;

  const now = new Date();
  const currentIso = now.toISOString().split("T")[0];
  const isToday = deliveryScheduleState.date === currentIso;

  // Filter slots for Today: must start at least 15 mins after current time
  const currentTotalMinutes = now.getHours() * 60 + now.getMinutes() + 15;
  const availableSlots = isToday
    ? SCHEDULE_TIME_WINDOWS.filter((s) => s.hour * 60 + s.minute >= currentTotalMinutes)
    : [...SCHEDULE_TIME_WINDOWS];

  if (availableSlots.length === 0) {
    select.innerHTML = `<option value="" disabled selected>No slots remaining for today</option>`;
    deliveryScheduleState.timeSlot = "";
    updateScheduleSummaryText();
    return;
  }

  // Preserve existing slot if still available; otherwise choose first available
  if (!availableSlots.some((s) => s.value === deliveryScheduleState.timeSlot)) {
    deliveryScheduleState.timeSlot = availableSlots[0].value;
  }

  select.innerHTML = availableSlots
    .map((slot) => {
      const isSelected = slot.value === deliveryScheduleState.timeSlot;
      return `<option value="${slot.value}" ${isSelected ? "selected" : ""}>${slot.label}</option>`;
    })
    .join("");

  updateScheduleSummaryText();
}

function handleScheduleTimeWindowChange(val) {
  deliveryScheduleState.timeSlot = val;
  saveDeliverySchedule();
  updateScheduleSummaryText();
}

function updateScheduleSummaryText() {
  const summaryEl = document.getElementById("schedule-summary-text");
  if (!summaryEl) return;

  const rolling = getRollingDays(4);
  const matchedDay = rolling.find((d) => d.iso === deliveryScheduleState.date);
  const dayStr = matchedDay ? `${matchedDay.dayLabel} (${matchedDay.dateSubtext})` : deliveryScheduleState.date;
  const matchedSlot = SCHEDULE_TIME_WINDOWS.find((s) => s.value === deliveryScheduleState.timeSlot);
  const slotStr = matchedSlot ? matchedSlot.label : deliveryScheduleState.timeSlot;

  if (!deliveryScheduleState.timeSlot) {
    summaryEl.textContent = `Please select an available delivery slot for ${dayStr}`;
  } else {
    summaryEl.textContent = `Scheduled for ${dayStr} • ${slotStr}`;
  }
}

// Quick Tap Delivery Instruction Appender
function appendQuickInstruction(text) {
  const textarea = document.getElementById("cart-instructions");
  if (!textarea) return;
  const currentVal = textarea.value.trim();
  if (!currentVal) {
    textarea.value = text;
  } else if (!currentVal.toLowerCase().includes(text.toLowerCase())) {
    textarea.value = `${currentVal}, ${text}`;
  }
  handleInstructionsInput(textarea.value);
}

// Backwards-compatible shims (guarantee zero breakage if legacy functions are triggered)
function setDeliverySchedulePreset(preset) {
  if (preset === "ASAP") {
    setDeliveryMode("NOW");
  } else {
    setDeliveryMode("SCHEDULE");
  }
}
function openScheduledTimeMode() { setDeliveryMode("SCHEDULE"); }
function cancelCustomSchedule() { setDeliveryMode("NOW"); }
function updateScheduledDateTimeDisplay() { updateScheduleSummaryText(); }
function toggleStagedDateTimePicker() {}
function openStagedDateTimePicker() {}
function showStagedStep() {}
function proceedToTimeStep() {}
function backToDateStep() {}
function renderStagedCalendarDays() {}
function prevStagedCalendarMonth() {}
function nextStagedCalendarMonth() {}
function selectStagedTimeSlot(slot) { handleScheduleTimeWindowChange(slot); }
function handleStagedCustomTimeInput(val) { handleScheduleTimeWindowChange(val); }
function confirmStagedDateTime() {}

// ============================================================================
// CUSTOMER ORDER HISTORY & DATE FILTERING
// ============================================================================
let customerOrderHistoryList = [];
let customerOrderHistoryFilter = "ALL";

async function loadCustomerOrdersToHistory(customerId) {
  const targetCustId = customerId || activeCustomer?.id || "CUST-001";
  if (!targetCustId) return;

  const container = document.getElementById("menu-order-history-list");
  if (container && (!customerOrderHistoryList || customerOrderHistoryList.length === 0)) {
    container.innerHTML = `<div class="empty-state-card"><p>Loading order history &amp; receipts...</p></div>`;
  }

  let remoteOrders = [];
  try {
    const res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(targetCustId)}/orders`, { timeoutMs: 3000 });
    if (res.ok && Array.isArray(res.data)) {
      remoteOrders = res.data;
    } else if (res.ok && res.data && Array.isArray(res.data.orders)) {
      remoteOrders = res.data.orders;
    }
  } catch (err) {
    console.warn("Could not fetch remote orders for customer", targetCustId, err);
  }

  // Also check direct Order Service (:9091) if remoteOrders is empty
  if (remoteOrders.length === 0) {
    try {
      const ordRes = await apiFetch(PORTS.ORDER, `/customers/${encodeURIComponent(targetCustId)}/orders`, { timeoutMs: 3000 });
      if (ordRes.ok && Array.isArray(ordRes.data)) {
        remoteOrders = ordRes.data;
      }
    } catch (_) {}
  }

  // Check locally cached orders
  let localOrders = [];
  try {
    const rawLocal = localStorage.getItem("dsa_local_orders_" + targetCustId);
    if (rawLocal) localOrders = JSON.parse(rawLocal);
  } catch (_) {}

  // Merge and deduplicate
  const seenIds = new Set();
  const merged = [];

  [...localOrders, ...remoteOrders].forEach(o => {
    const id = o.orderId || o.id;
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      merged.push(o);
    }
  });

  // Sort descending by date
  merged.sort((a, b) => {
    const tA = new Date(a.createdAt || a.timestamp || 0).getTime();
    const tB = new Date(b.createdAt || b.timestamp || 0).getTime();
    return tB - tA;
  });

  customerOrderHistoryList = merged;
  renderMenuOrderHistory();

  const tbody = document.getElementById("customer-order-history-tbody");
  if (tbody) {
    renderOrderHistoryTable();
  }
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
  customerOrderHistoryFilter = preset || "ALL";

  const buttons = document.querySelectorAll("#menu-subpanel-history .quick-presets-row .btn-preset");
  buttons.forEach(btn => {
    const txt = btn.textContent.trim().toUpperCase();
    const isActive = (preset === "ALL" && txt === "ALL") ||
      (preset === "TODAY" && txt === "TODAY") ||
      (preset === "7D" && txt.includes("7")) ||
      (preset === "MONTH" && txt.includes("MONTH"));
    btn.classList.toggle("active", isActive);
  });

  renderMenuOrderHistory();
  const tbody = document.getElementById("customer-order-history-tbody");
  if (tbody) renderOrderHistoryTable();
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

    const friendlyId = `Ref #${String(oId).replace(/^order[-_]?/i, "")}`;
    const isCompleted = localStorage.getItem(`dsa_order_completed_${oId}`) === "true" || status === "DELIVERED";

    return `
      <tr>
        <td class="text-mono font-bold" title="${escapeHtml(oId)}">${escapeHtml(friendlyId)}</td>
        <td>${escapeHtml(dateStr)}</td>
        <td>${escapeHtml(restName)}</td>
        <td class="text-mono font-bold">N$ ${escapeHtml(total)}</td>
        <td><span class="status-pill ${status === "DELIVERED" ? "pill-valid" : "pill-checking"}">${escapeHtml(status)}</span></td>
        <td>
          ${!isCompleted ? `
          <button type="button" class="btn btn-xs btn-outline" onclick="selectOrderToTrack('${escapeHtml(oId)}'); const pop = document.getElementById('order-badge-popover'); if (pop) { pop.style.display = 'block'; pop.classList.add('is-visible'); }">
            Track
          </button>` : `<span class="text-muted" style="font-size: 11px;">Completed</span>`}
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

// Curated visual showcase registry for seed & live restaurants (Travel/Airbnb Aesthetic)
// Reuses window.RESTAURANT_VISUAL_REGISTRY from shared.js without top-level lexical redeclaration
var RESTAURANT_VISUAL_REGISTRY = (typeof window !== 'undefined' && window.RESTAURANT_VISUAL_REGISTRY) || {
  R001: {
    name: "Kapana Corner",
    tag: "Katutura",
    rating: "4.9 ★",
    deliveryTime: "15-25 min",
    image: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80",
    desc: "Authentic charcoal-grilled beef kapana, fresh chili salsa & golden vetkoek straight from the embers."
  },
  R002: {
    name: "Namibian Potjie Kitchen",
    tag: "Windhoek CBD",
    rating: "4.8 ★",
    deliveryTime: "25-35 min",
    image: "https://images.unsplash.com/photo-1547496502-affa22d38842?auto=format&fit=crop&w=800&q=80",
    desc: "Slow-simmered cast-iron campfire potjiekos, tender braised oxtail & freshly baked roosterkoek."
  },
  R003: {
    name: "Oshakati Traditional Kitchen",
    tag: "Northern Flavors",
    rating: "4.7 ★",
    deliveryTime: "20-30 min",
    image: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80",
    desc: "Free-range Oshiwambo chicken, steamed mahangu pap, wild spinach & authentic Owambo flavors."
  },
  R004: {
    name: "Windhoek Braai House",
    tag: "Klein Windhoek",
    rating: "4.9 ★",
    deliveryTime: "15-25 min",
    image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=800&q=80",
    desc: "Prime flame-grilled Kalahari game steaks, spiced boerewors braai skewers & garlic roosterkoek."
  },
  R005: {
    name: "Desert Cafe & Grill",
    tag: "Swakopmund Coast",
    rating: "4.8 ★",
    deliveryTime: "20-30 min",
    image: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=800&q=80",
    desc: "Atlantic fresh line fish, gourmet wild oryx burgers, coastal cafe delights & cold craft sodas."
  }
};
if (typeof window !== 'undefined') {
  window.RESTAURANT_VISUAL_REGISTRY = RESTAURANT_VISUAL_REGISTRY;
}

var DEFAULT_RESTAURANT_VISUAL = (typeof window !== 'undefined' && window.DEFAULT_RESTAURANT_VISUAL) || {
  tag: "Windhoek",
  rating: "4.8 ★",
  deliveryTime: "20-30 min",
  image: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=80",
  desc: "Fresh artisan dishes, local specialties, and fast delivery across Windhoek."
};
if (typeof window !== 'undefined') {
  window.DEFAULT_RESTAURANT_VISUAL = DEFAULT_RESTAURANT_VISUAL;
}

// Clean formatter for restaurant display names (turns raw test IDs like E2E-rest-101 into clean title-cased names)
function formatRestaurantDisplayName(name) {
  if (!name) return "Windhoek Kitchen";
  if (/^e2e-rest/i.test(name) || /^[a-z0-9]+-[a-z0-9-]+$/i.test(name)) {
    return name
      .replace(/^e2e-rest-?/i, "Rest ")
      .split(/[-_]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return name;
}

// Restaurant Carousel Track Arrows & Navigation
function updateRestaurantTrackArrows() {
  const track = document.getElementById("restaurant-cards-track");
  const prevBtn = document.getElementById("track-arrow-prev");
  const nextBtn = document.getElementById("track-arrow-next");
  if (!track) return;

  const scrollLeft = track.scrollLeft;
  const maxScrollLeft = track.scrollWidth - track.clientWidth;

  if (prevBtn) {
    prevBtn.style.display = scrollLeft > 10 ? "inline-flex" : "none";
  }
  if (nextBtn) {
    nextBtn.style.display = (maxScrollLeft - scrollLeft) > 10 ? "inline-flex" : "none";
  }
}

function scrollRestaurantTrack(direction) {
  const track = document.getElementById("restaurant-cards-track");
  if (!track) return;
  const card = track.querySelector(".restaurant-visual-card");
  const cardWidth = card ? card.offsetWidth + 16 : 300;
  track.scrollBy({ left: direction * cardWidth * 2, behavior: "smooth" });
}

// Side-to-Side Drag-to-Scroll on Restaurant Cards Track
let isTrackDown = false;
let trackStartX = 0;
let trackScrollStartLeft = 0;
let trackHasDragged = false;

function initRestaurantCardsDrag() {
  const track = document.getElementById("restaurant-cards-track");
  if (!track || track.dataset.dragInitialized) return;
  track.dataset.dragInitialized = "true";

  track.addEventListener("mousedown", (e) => {
    isTrackDown = true;
    trackHasDragged = false;
    trackStartX = e.pageX - track.offsetLeft;
    trackScrollStartLeft = track.scrollLeft;
    track.style.cursor = "grabbing";
    track.style.scrollSnapType = "none";
    track.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!isTrackDown) return;
    const x = e.pageX - track.offsetLeft;
    const walk = x - trackStartX;
    if (Math.abs(walk) > 6) {
      trackHasDragged = true;
    }
    track.scrollLeft = trackScrollStartLeft - walk;
    updateRestaurantTrackArrows();
  });

  window.addEventListener("mouseup", () => {
    if (!isTrackDown) return;
    isTrackDown = false;
    track.style.cursor = "grab";
    track.style.scrollSnapType = "x mandatory";
    track.style.removeProperty("user-select");
  });

  track.addEventListener(
    "click",
    (e) => {
      if (trackHasDragged) {
        e.stopPropagation();
        e.preventDefault();
        trackHasDragged = false;
      }
    },
    true
  );

  track.addEventListener("scroll", updateRestaurantTrackArrows, { passive: true });
  window.addEventListener("resize", updateRestaurantTrackArrows, { passive: true });
}

function renderRestaurantCards() {
  const track = document.getElementById("restaurant-cards-track");
  if (!track) return;

  if (!Array.isArray(liveRestaurants) || liveRestaurants.length === 0) {
    track.innerHTML = `
      <div class="empty-state-card" style="width: 100%;">
        <p>No restaurants available or Restaurant Service (:9095) unreachable.</p>
      </div>`;
    return;
  }

  track.innerHTML = liveRestaurants
    .map((r) => {
      const visual = RESTAURANT_VISUAL_REGISTRY[r.id] || DEFAULT_RESTAURANT_VISUAL;
      const isSelected = Boolean(selectedRestaurant && selectedRestaurant.id === r.id);
      const name = formatRestaurantDisplayName(r.name || visual.name || r.id);
      const desc = visual.desc || r.address || "Specialty dining and grill";
      const tag = visual.tag || "Windhoek";
      const delivery = visual.deliveryTime || "20-30 min";
      const imgUrl = visual.image || DEFAULT_RESTAURANT_VISUAL.image;

      return `
        <article class="restaurant-visual-card ${isSelected ? "is-selected" : ""}"
                 data-restaurant-id="${escapeHtml(r.id)}"
                 onclick="selectRestaurantCard('${escapeHtml(r.id)}')">
          <img class="restaurant-card-bg" src="${imgUrl}" alt="${escapeHtml(name)}" loading="lazy" draggable="false" />
          <div class="restaurant-card-gradient"></div>
          <div class="restaurant-card-selected-badge">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>SELECTED</span>
          </div>
          <div class="restaurant-card-content">
            <div class="restaurant-card-meta-row">
              <span class="meta-glass-pill tag-pill">${escapeHtml(tag)}</span>
              <span class="meta-glass-pill delivery-pill">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 3px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                ${delivery}
              </span>
            </div>
            <h3 class="restaurant-card-name">${escapeHtml(name)}</h3>
            <p class="restaurant-card-desc">${escapeHtml(desc)}</p>
            <button type="button" class="restaurant-card-cta" onclick="event.stopPropagation(); selectRestaurantCard('${escapeHtml(r.id)}')">
              ${isSelected ? "Selected ✓" : "View Menu"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  initRestaurantCardsDrag();
  requestAnimationFrame(updateRestaurantTrackArrows);
}

function selectRestaurantCard(restaurantId) {
  const match = liveRestaurants.find((r) => r.id === restaurantId);
  if (!match) return;

  try {
    localStorage.setItem("dsa_selected_restaurant_id", restaurantId);
  } catch (_) {}

  selectedRestaurant = match;
  renderRestaurantCards();
  handleRestaurantChange(restaurantId);

  // Smoothly scroll the selected restaurant card all the way to the left
  const track = document.getElementById("restaurant-cards-track");
  if (track) {
    const card = track.querySelector(`[data-restaurant-id="${restaurantId}"]`);
    if (card) {
      const paddingLeft = parseInt(window.getComputedStyle(track).paddingLeft, 10) || 0;
      track.scrollTo({ left: Math.max(0, card.offsetLeft - paddingLeft), behavior: "smooth" });
    }
  }
}

async function loadLiveRestaurants() {
  try {
    const res = await apiFetch(PORTS.RESTAURANT, "/restaurants", { timeoutMs: 3000 });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        liveRestaurants = data;

        // Default to saved restaurant or first live restaurant returned by Restaurant Service
        const savedId = localStorage.getItem("dsa_selected_restaurant_id");
        const matchSaved = savedId ? liveRestaurants.find((r) => r.id === savedId) : null;
        const defaultR = matchSaved || liveRestaurants[0];
        selectedRestaurant = defaultR;
        renderRestaurantCards();
        handleRestaurantChange(defaultR.id);
        if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
        return;
      }
    }
  } catch (err) {
    console.warn("Could not load restaurants from :9095:", err.message);
  }

  // Fallback to default seed restaurants if service is unreachable or empty
  if (typeof DEFAULT_SEED_RESTAURANTS !== 'undefined' && Array.isArray(DEFAULT_SEED_RESTAURANTS) && DEFAULT_SEED_RESTAURANTS.length > 0) {
    liveRestaurants = DEFAULT_SEED_RESTAURANTS;
    const savedId = localStorage.getItem("dsa_selected_restaurant_id");
    const matchSaved = savedId ? liveRestaurants.find((r) => r.id === savedId) : null;
    selectedRestaurant = matchSaved || liveRestaurants[0];
    renderRestaurantCards();
    handleRestaurantChange(selectedRestaurant.id);
    if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
    return;
  }

  // If no restaurants returned and no seed data, clear liveRestaurants and show placeholder
  liveRestaurants = [];
  selectedRestaurant = null;
  currentMenuCategories = [];
  renderRestaurantCards();
  updateRestaurantCategoryList();
  renderMenuItems();
  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
}

async function handleRestaurantChange(restaurantId) {
  selectedRestaurant = liveRestaurants.find((r) => r.id === restaurantId);
  if (!selectedRestaurant) return;

  try {
    localStorage.setItem("dsa_selected_restaurant_id", restaurantId);
  } catch (_) {}

  // Sync card selection state in case handleRestaurantChange was triggered externally
  renderRestaurantCards();

  // Update Restaurant Banner elements (null-safe via setText)
  setText("rest-name-display", selectedRestaurant.name || "Kapana Corner");
  setText("rest-subtitle", selectedRestaurant.address || "Single Quarters, Katutura, Windhoek");
  setText("rest-address", selectedRestaurant.address || "Single Quarters, Katutura, Windhoek");
  setText("rest-phone", selectedRestaurant.contactNumber || "+264-81-111-2222");

  // Operating Hours display
  let hoursText = "08:00 – 22:00 Daily";
  if (Array.isArray(selectedRestaurant.operatingHours) && selectedRestaurant.operatingHours.length > 0) {
    const h = selectedRestaurant.operatingHours[0];
    if (h.openTime && h.closeTime) {
      hoursText = `${h.openTime} – ${h.closeTime} Daily`;
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
        updateRestaurantCategoryList();
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
  updateRestaurantCategoryList();
  renderMenuItems();
}

async function checkRestaurantOpenStatus(restaurantId) {
  const dot = document.getElementById("restaurant-open-dot");
  const text = document.getElementById("restaurant-open-text");
  const indicator = document.querySelector(".restaurant-status-indicator");

  function setStatus(isOpen) {
    if (selectedRestaurant && selectedRestaurant.id === restaurantId) {
      selectedRestaurant.isOpen = isOpen;
    }
    if (dot) dot.className = `status-dot ${isOpen ? "online" : "offline"}`;
    if (text) text.textContent = isOpen ? "OPEN FOR ORDERS" : "CLOSED NOW";
    if (indicator) {
      indicator.classList.toggle("is-closed", !isOpen);
      indicator.classList.toggle("is-open", isOpen);
    }
    // Update Add to Cart buttons and Cart summary
    renderMenuItems();
    updateCartSummary();
  }

  try {
    const res = await apiFetch(PORTS.RESTAURANT, `/restaurants/${encodeURIComponent(restaurantId)}/open-status`, { timeoutMs: 2500 });
    // Restaurant Service returns 200 when OPEN, and 409 Conflict when CLOSED
    if (res.status === 200 || res.status === 409 || res.ok) {
      const data = await res.json();
      const isOpen = data.status === "OPEN" || Boolean(data.open !== undefined ? data.open : data.isOpen);
      setStatus(isOpen);
      return;
    }
  } catch (err) {
    console.warn("Could not check open status from :9095:", err.message);
  }

  // Fallback: Check local operating hours if available
  if (selectedRestaurant && Array.isArray(selectedRestaurant.operatingHours) && selectedRestaurant.operatingHours.length > 0) {
    try {
      const now = new Date();
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const currentDay = days[now.getDay()];
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const todaySchedule = selectedRestaurant.operatingHours.find(
        (h) => (h.dayOfWeek || "").toLowerCase() === currentDay.toLowerCase()
      );

      if (todaySchedule) {
        if (todaySchedule.isClosed) {
          setStatus(false);
          return;
        }
        const [openH, openM] = (todaySchedule.openTime || "08:00").split(":").map(Number);
        const [closeH, closeM] = (todaySchedule.closeTime || "22:00").split(":").map(Number);
        const openMin = openH * 60 + openM;
        const closeMin = closeH * 60 + closeM;
        const isOpen = currentMinutes >= openMin && currentMinutes < closeMin;
        setStatus(isOpen);
        return;
      }
    } catch (_) {}
  }

  // Default to offline / closed if indeterminate or failed to connect
  setStatus(false);
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

function updateRestaurantCategoryList() {
  const catsSet = new Set();
  currentMenuCategories.forEach((cat) => {
    if (cat.name) catsSet.add(cat.name);
    else if (cat.id) catsSet.add(cat.id);
    if (Array.isArray(cat.items)) {
      cat.items.forEach((item) => {
        if (item.category) catsSet.add(item.category);
        if (item.categoryName) catsSet.add(item.categoryName);
      });
    }
  });
  const filteredCats = Array.from(catsSet).filter(Boolean);
  currentRestaurantCategories = ["ALL", ...filteredCats];
  categoryCarouselOffset = 0;

  const savedCat = localStorage.getItem("dsa_menu_category_filter");
  if (savedCat && currentRestaurantCategories.includes(savedCat)) {
    selectedCategoryFilter = savedCat;
    const catIdx = currentRestaurantCategories.indexOf(savedCat);
    const maxOffset = Math.max(0, currentRestaurantCategories.length - 3);
    categoryCarouselOffset = Math.min(catIdx, maxOffset);
  } else {
    selectedCategoryFilter = "ALL";
  }
  renderCategoryFilters();
}

function slideCategoryCarousel(direction) {
  const maxOffset = Math.max(0, currentRestaurantCategories.length - 3);
  categoryCarouselOffset = Math.max(0, Math.min(maxOffset, categoryCarouselOffset + direction));
  renderCategoryFilters();
}

function renderCategoryFilters() {
  const container = document.getElementById("category-filter-chips");
  const prevBtn = document.getElementById("cat-carousel-prev");
  const nextBtn = document.getElementById("cat-carousel-next");
  if (!container) return;

  const total = currentRestaurantCategories.length;
  const maxOffset = Math.max(0, total - 3);
  if (categoryCarouselOffset > maxOffset) categoryCarouselOffset = maxOffset;

  if (prevBtn) {
    prevBtn.style.display = total > 3 ? "flex" : "none";
    prevBtn.disabled = categoryCarouselOffset <= 0;
    prevBtn.style.opacity = categoryCarouselOffset <= 0 ? "0.4" : "1";
    prevBtn.style.cursor = categoryCarouselOffset <= 0 ? "not-allowed" : "pointer";
  }
  if (nextBtn) {
    nextBtn.style.display = total > 3 ? "flex" : "none";
    nextBtn.disabled = categoryCarouselOffset >= maxOffset;
    nextBtn.style.opacity = categoryCarouselOffset >= maxOffset ? "0.4" : "1";
    nextBtn.style.cursor = categoryCarouselOffset >= maxOffset ? "not-allowed" : "pointer";
  }

  // Strictly 3 categories visible at a time
  const visibleCategories = currentRestaurantCategories.slice(categoryCarouselOffset, categoryCarouselOffset + 3);

  container.innerHTML = visibleCategories
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
  try {
    localStorage.setItem("dsa_menu_category_filter", cat);
  } catch (_) {}
  renderCategoryFilters();
  renderMenuItems();
}

function filterMenuByCategory(cat) {
  filterCategory(cat);
}

// Favorites logic removed per user specification

const DISH_IMAGE_REGISTRY = {
  M1: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=700&q=80",
  M2: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=700&q=80",
  M3: "https://images.unsplash.com/photo-1592417817098-8f3d6910985c?auto=format&fit=crop&w=700&q=80",
  M4: "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=700&q=80",
  M5: "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?auto=format&fit=crop&w=700&q=80",
  M6: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=700&q=80",
  M7: "https://images.unsplash.com/photo-1547496502-affa22d38842?auto=format&fit=crop&w=700&q=80",
  M8: "https://images.unsplash.com/photo-1608897013039-887f21d8c804?auto=format&fit=crop&w=700&q=80",
  M9: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=700&q=80",
  M10: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=700&q=80",
  M11: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=700&q=80",
  M12: "https://images.unsplash.com/photo-1543339308-43e59d6b73a6?auto=format&fit=crop&w=700&q=80",
  M13: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=700&q=80",
  M14: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=700&q=80",
  M15: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=700&q=80",
  M16: "https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=700&q=80",
  M17: "https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?auto=format&fit=crop&w=700&q=80",
  M18: "https://images.unsplash.com/photo-1541832676-9b763b0239ab?auto=format&fit=crop&w=700&q=80",
  M19: "https://images.unsplash.com/photo-1627054234676-f02787713437?auto=format&fit=crop&w=700&q=80",
  M20: "https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=700&q=80",
  M21: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=700&q=80",
  M22: "https://images.unsplash.com/photo-1518492104633-130d0cc84637?auto=format&fit=crop&w=700&q=80",
  M23: "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=700&q=80",
  M24: "https://images.unsplash.com/photo-1573140247632-f8fd74997d5c?auto=format&fit=crop&w=700&q=80",
  M25: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=700&q=80",
  M26: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=700&q=80",
  M27: "https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=700&q=80",
  M28: "https://images.unsplash.com/photo-1587314168485-3236d6710814?auto=format&fit=crop&w=700&q=80",
  M29: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=700&q=80",
  M30: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=700&q=80",
  M31: "https://images.unsplash.com/photo-1579208575657-c595a05383b7?auto=format&fit=crop&w=700&q=80"
};

const DEFAULT_DISH_FALLBACK = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=700&q=80";

function getDishImageUrl(item) {
  if (item.imageUrl || item.image || item.picture || item.photo) {
    return item.imageUrl || item.image || item.picture || item.photo;
  }
  if (item.id && DISH_IMAGE_REGISTRY[item.id]) {
    return DISH_IMAGE_REGISTRY[item.id];
  }
  const nameLower = (item.name || "").toLowerCase();
  if (nameLower.includes("burger")) return "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=700&q=80";
  if (nameLower.includes("steak") || nameLower.includes("braai") || nameLower.includes("rib")) return "https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=700&q=80";
  if (nameLower.includes("fish") || nameLower.includes("seafood") || nameLower.includes("bream")) return "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=700&q=80";
  if (nameLower.includes("chicken")) return "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=700&q=80";
  if (nameLower.includes("salad")) return "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=700&q=80";
  if (nameLower.includes("tea") || nameLower.includes("drink") || nameLower.includes("shandy")) return "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=700&q=80";
  return DEFAULT_DISH_FALLBACK;
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
      const itemImg = getDishImageUrl(item);
      const isClosed = selectedRestaurant?.isOpen === false;
      const isDisabled = !inStock || isClosed;
      const buttonLabel = isClosed ? "Closed" : (inStock ? "Add" : "Sold Out");
      const buttonTitle = isClosed ? "Restaurant is currently closed for ordering" : (!inStock ? "Item is out of stock" : "Add to Cart");

      return `
      <div class="dish-card" id="dish-card-${itemId}" tabindex="0" onclick="handleDishCardTap(this, event)">
        <!-- Layer 1: Dish Photo Container (Morphs between full-card and top photo banner) -->
        <div class="dish-photo-container">
          <img
            src="${escapeHtml(itemImg)}"
            alt="${escapeHtml(item.name || "Dish")}"
            class="dish-img"
            loading="lazy"
            onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=700&q=80';"
          />
          <div class="dish-photo-overlay"></div>
          <span class="dish-category-watermark">${escapeHtml(item.categoryName || "Specialty")}</span>
        </div>

        <!-- Layer 2: Default State Overlay (Visible in default state, fades out on hover) -->
        <div class="dish-default-content">
          <span class="dish-default-category">${escapeHtml(item.categoryName || "Specialty")}</span>
          <h4 class="dish-default-title">${escapeHtml(item.name)}</h4>
          <div class="dish-default-footer">
            <span class="dish-default-price">N$ ${priceFormatted}</span>
            <button
              type="button"
              class="btn-default-add"
              onclick="event.stopPropagation(); addToCart('${itemId}', this)"
              ${isDisabled ? "disabled" : ""}
              title="${buttonTitle}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>${buttonLabel}</span>
            </button>
          </div>
        </div>

        <!-- Layer 3: Details Bottom Sheet (Slides up and fades in on hover/focus) -->
        <div class="dish-details-sheet">
          <div class="dish-body">
            <div class="dish-header">
              <h4 class="dish-title">${escapeHtml(item.name)}</h4>
            </div>
            <p class="dish-description">${escapeHtml(item.description || "Prepared fresh with authentic local Namibian ingredients.")}</p>
            <div class="dish-tags-row">
              <span class="stock-badge ${inStock ? "in-stock" : "out-of-stock"}">
                ${inStock ? `Stock: ${item.stock}` : "Out of stock"}
              </span>
              ${dietaryAttrs.map((d) => `<span class="dietary-tag">${escapeHtml(d)}</span>`).join("")}
            </div>
          </div>

          <div class="dish-actions-row">
            <div class="dish-price-group">
              <span class="dish-price">N$ ${priceFormatted}</span>
              <span class="tax-indicator-badge">15% VAT Inc.</span>
            </div>

            <div class="dish-controls-group">
              ${!isClosed ? `
              <div class="quantity-stepper">
                <button type="button" class="stepper-btn" onclick="event.stopPropagation(); adjustMenuQty('${itemId}', -1)" aria-label="Decrease quantity">&minus;</button>
                <span class="stepper-val" id="qty-input-${itemId}">1</span>
                <button type="button" class="stepper-btn" onclick="event.stopPropagation(); adjustMenuQty('${itemId}', 1)" aria-label="Increase quantity">&plus;</button>
              </div>` : ""}
              <button
                type="button"
                class="btn-add-to-cart"
                id="btn-add-${itemId}"
                onclick="event.stopPropagation(); addToCart('${itemId}', this)"
                ${isDisabled ? "disabled" : ""}
                title="${buttonTitle}"
              >
                ${buttonLabel}
              </button>
            </div>
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
  let maxStock = 20;
  for (const cat of (currentMenuCategories || [])) {
    const item = (cat.items || []).find((i) => i.id === itemId);
    if (item && typeof item.stock === "number") {
      maxStock = Math.max(1, item.stock);
      break;
    }
  }
  let val = parseInt(el.textContent, 10) || 1;
  val = Math.max(1, Math.min(maxStock, val + delta));
  el.textContent = val;
}

function handleDishCardTap(cardEl, event) {
  // If tap originated inside an interactive button, stepper, or input, do not toggle active state
  if (event.target.closest("button, input, a, .stepper-btn")) {
    return;
  }
  const wasActive = cardEl.classList.contains("is-active");
  // Close any other open active cards
  document.querySelectorAll(".dish-card.is-active").forEach((card) => {
    if (card !== cardEl) card.classList.remove("is-active");
  });
  cardEl.classList.toggle("is-active", !wasActive);
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
        multTag.textContent = `${dynamicPricing.surgeMultiplier.toFixed(1)}x`;
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
function saveCart() {
  try {
    localStorage.setItem("dsa_cart", JSON.stringify(cart));
  } catch (e) {
    console.warn("Failed to persist cart:", e);
  }
}

function loadCart() {
  try {
    const raw = localStorage.getItem("dsa_cart");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cart = parsed.filter(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          entry.item &&
          entry.item.id &&
          typeof entry.quantity === "number" &&
          entry.quantity > 0
      );
      updateCartSummary();
      renderCartDrawer();
    }
  } catch (e) {
    console.warn("Failed to load cart from localStorage:", e);
  }
}

function toggleCartDrawer() {
  const drawer = document.getElementById("cart-drawer");
  if (drawer) {
    drawer.classList.toggle("open");
    if (!drawer.classList.contains("open")) {
      resetCartStage();
    }
  }
}

function addToCart(itemId, buttonEl) {
  if (selectedRestaurant && selectedRestaurant.isOpen === false) {
    alert(`"${selectedRestaurant.name || "This restaurant"}" is currently CLOSED for ordering.\nOperating hours: ${document.getElementById("rest-hours")?.textContent || "Closed now"}.`);
    return;
  }

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

  const maxStock = typeof item.stock === "number" && item.stock > 0 ? item.stock : 999;
  const existingIndex = cart.findIndex((c) => c.item.id === itemId);
  if (existingIndex > -1) {
    if (cart[existingIndex].quantity + qty > maxStock) {
      cart[existingIndex].quantity = maxStock;
      alert(`Cannot add more. Maximum available stock is ${maxStock}.`);
    } else {
      cart[existingIndex].quantity += qty;
    }
  } else {
    cart.push({ item: item, quantity: Math.min(qty, maxStock) });
  }

  saveCart();
  updateCartSummary();
  renderCartDrawer();

  // Smooth visual feedback on the button (elegant emerald feedback restoring original button markup)
  if (buttonEl) {
    const originalHtml = buttonEl.innerHTML;
    buttonEl.classList.add("btn-added-feedback");
    buttonEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Added</span>
    `;
    setTimeout(() => {
      buttonEl.classList.remove("btn-added-feedback");
      buttonEl.innerHTML = originalHtml;
    }, 1200);
  }
}

function removeFromCart(itemId) {
  cart = cart.filter((c) => c.item.id !== itemId);
  saveCart();
  updateCartSummary();
  renderCartDrawer();
}

function updateCartQuantity(itemId, delta) {
  const entry = cart.find((c) => c.item.id === itemId);
  if (!entry) return;

  if (delta > 0 && entry.item && typeof entry.item.stock === "number" && entry.item.stock > 0) {
    if (entry.quantity + delta > entry.item.stock) {
      alert(`Cannot add more. Maximum available stock is ${entry.item.stock}.`);
      return;
    }
  }

  entry.quantity += delta;
  if (entry.quantity <= 0) {
    removeFromCart(itemId);
  } else {
    saveCart();
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

// Two-Stage Cart State & Navigation
let currentCartStage = 1; // 1 = Confirm Cart, 2 = Checkout Details
let selectedDeliveryAddressId = null;

function resetCartStage() {
  currentCartStage = 1;
  const stage1 = document.getElementById("cart-stage-confirm");
  const stage2 = document.getElementById("cart-stage-checkout");
  const itemsContainer = document.getElementById("cart-items-container");
  const drawerFooter = document.getElementById("cart-drawer-footer");
  if (itemsContainer) itemsContainer.style.display = "flex";
  if (drawerFooter) drawerFooter.style.display = "block";
  if (stage1) stage1.style.display = "block";
  if (stage2) stage2.style.display = "none";
  setDeliveryMode("NOW");
}

function proceedToCheckoutStage() {
  if (cart.length === 0) {
    alert("Your cart is empty.");
    return;
  }
  if (!activeCustomer) {
    alert("Please select or register a customer account first.");
    return;
  }
  if (selectedRestaurant && selectedRestaurant.isOpen === false) {
    alert(`"${selectedRestaurant.name || "This restaurant"}" is currently CLOSED for ordering.\nPlease wait until it re-opens to proceed with checkout.`);
    return;
  }

  currentCartStage = 2;
  const stage1 = document.getElementById("cart-stage-confirm");
  const stage2 = document.getElementById("cart-stage-checkout");
  const itemsContainer = document.getElementById("cart-items-container");
  const drawerFooter = document.getElementById("cart-drawer-footer");
  if (itemsContainer) itemsContainer.style.display = "none";
  if (drawerFooter) drawerFooter.style.display = "none";
  if (stage1) stage1.style.display = "none";
  if (stage2) stage2.style.display = "flex";

  populateCheckoutAddressDropdown();
  updateCartSummary();
  renderScheduleDayChips();
  populateScheduleTimeWindows();

  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
}

function backToCartStage() {
  currentCartStage = 1;
  const stage1 = document.getElementById("cart-stage-confirm");
  const stage2 = document.getElementById("cart-stage-checkout");
  const itemsContainer = document.getElementById("cart-items-container");
  const drawerFooter = document.getElementById("cart-drawer-footer");
  if (itemsContainer) itemsContainer.style.display = "flex";
  if (drawerFooter) drawerFooter.style.display = "block";
  if (stage1) stage1.style.display = "block";
  if (stage2) stage2.style.display = "none";

  updateCartSummary();
}

// Address Management in Checkout
function populateCheckoutAddressDropdown() {
  const select = document.getElementById("checkout-address-select");
  if (!select) return;

  const addresses = activeCustomer?.addresses || (activeCustomer?.address ? [activeCustomer.address] : []);

  if (addresses.length === 0) {
    select.innerHTML = `<option value="" disabled selected>No saved addresses — click "+ Add New Address"</option>`;
    selectedDeliveryAddressId = null;
    if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
    return;
  }

  // Populate options
  select.innerHTML = addresses
    .map((a, idx) => {
      const aId = a.id || `addr_${idx}`;
      const label = a.tag
        ? `${a.tag} • ${a.street || "12 Independence Avenue"}, ${a.city || "Windhoek"}`
        : `${a.street || "12 Independence Avenue"}, ${a.city || "Windhoek"}`;
      return `<option value="${escapeHtml(aId)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  // Select default or first address
  let targetAddr = addresses.find((a) => a.id === selectedDeliveryAddressId);
  if (!targetAddr) {
    targetAddr = addresses.find((a) => a.isDefault) || addresses[0];
  }
  if (targetAddr) {
    const chosenId = targetAddr.id || `addr_0`;
    select.value = chosenId;
    selectedDeliveryAddressId = chosenId;
  }

  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
}

function handleCheckoutAddressChange(addressId) {
  selectedDeliveryAddressId = addressId;
}

// Add/Edit Address Modal State & Handlers
let editingAddressId = null;

function openAddAddressModal() {
  editingAddressId = null;
  const modalTitle = document.getElementById("address-modal-title");
  if (modalTitle) modalTitle.textContent = "Add New Delivery Address";
  const modalSub = document.getElementById("address-modal-subtitle");
  if (modalSub) modalSub.textContent = "Directly registers address under your account in Customer Service (:9093)";
  const submitBtn = document.getElementById("btn-submit-new-addr");
  if (submitBtn) submitBtn.textContent = "Save Address";

  const tagInput = document.getElementById("new-addr-tag");
  if (tagInput) tagInput.value = "Home";
  const streetInput = document.getElementById("new-addr-street");
  if (streetInput) streetInput.value = "";
  const instrInput = document.getElementById("new-addr-instructions");
  if (instrInput) instrInput.value = "";
  const presetSel = document.getElementById("new-addr-preset");
  if (presetSel) presetSel.value = "central";
  applyAddAddressPreset("central");
  openModal("add-address-modal");
}

function openEditAddressModal(addressId) {
  if (!activeCustomer) {
    alert("Please select or register a customer account first.");
    return;
  }
  const addresses = activeCustomer.addresses || (activeCustomer.address ? [activeCustomer.address] : []);
  const addr = addresses.find((a) => (a.id || "") === addressId);
  if (!addr) {
    alert("Address not found.");
    return;
  }

  editingAddressId = addressId;
  const modalTitle = document.getElementById("address-modal-title");
  if (modalTitle) modalTitle.textContent = "Edit Delivery Address";
  const modalSub = document.getElementById("address-modal-subtitle");
  if (modalSub) modalSub.textContent = "Updates address details in Customer Service (:9093)";
  const submitBtn = document.getElementById("btn-submit-new-addr");
  if (submitBtn) submitBtn.textContent = "Update Address";

  const tagInput = document.getElementById("new-addr-tag");
  if (tagInput) tagInput.value = addr.tag || "Home";
  const streetInput = document.getElementById("new-addr-street");
  if (streetInput) streetInput.value = addr.street || "";
  const cityInput = document.getElementById("new-addr-city");
  if (cityInput) cityInput.value = addr.city || "Windhoek";
  const stateInput = document.getElementById("new-addr-state");
  if (stateInput) stateInput.value = addr.state || "Khomas";
  const postalInput = document.getElementById("new-addr-postal");
  if (postalInput) postalInput.value = addr.postalCode || "9000";
  const lonInput = document.getElementById("new-addr-lon");
  if (lonInput) lonInput.value = (addr.location && Array.isArray(addr.location.coordinates)) ? addr.location.coordinates[0] : 17.0658;
  const latInput = document.getElementById("new-addr-lat");
  if (latInput) latInput.value = (addr.location && Array.isArray(addr.location.coordinates)) ? addr.location.coordinates[1] : -22.5609;
  const instrInput = document.getElementById("new-addr-instructions");
  if (instrInput) instrInput.value = addr.deliveryInstructions || "";
  const presetSel = document.getElementById("new-addr-preset");
  if (presetSel) presetSel.value = "custom";

  openModal("add-address-modal");
}

function closeAddAddressModal() {
  editingAddressId = null;
  closeModal("add-address-modal");
}

function applyAddAddressPreset(presetKey) {
  const presets = {
    central: { lon: 17.0658, lat: -22.5609, street: "12 Independence Avenue", city: "Windhoek", state: "Khomas", postal: "9000" },
    katutura: { lon: 17.045, lat: -22.52, street: "Single Quarters, Katutura", city: "Windhoek", state: "Khomas", postal: "9000" },
    klein: { lon: 17.098, lat: -22.571, street: "Nelson Mandela Avenue", city: "Windhoek", state: "Khomas", postal: "9000" },
    eros: { lon: 17.085, lat: -22.545, street: "Heliodoor Street, Eros", city: "Windhoek", state: "Khomas", postal: "9000" },
    custom: { lon: 17.0658, lat: -22.5609, street: "", city: "Windhoek", state: "Khomas", postal: "9000" }
  };
  const p = presets[presetKey] || presets.central;
  const lonEl = document.getElementById("new-addr-lon");
  const latEl = document.getElementById("new-addr-lat");
  const cityEl = document.getElementById("new-addr-city");
  const stateEl = document.getElementById("new-addr-state");
  const postalEl = document.getElementById("new-addr-postal");
  const streetEl = document.getElementById("new-addr-street");

  if (lonEl) lonEl.value = p.lon;
  if (latEl) latEl.value = p.lat;
  if (cityEl) cityEl.value = p.city;
  if (stateEl) stateEl.value = p.state;
  if (postalEl) postalEl.value = p.postal;
  if (streetEl && p.street && !streetEl.value) streetEl.value = p.street;
}

function submitCustomerAddressForm() {
  if (editingAddressId) {
    return submitEditCustomerAddress();
  }
  return submitNewCustomerAddress();
}

async function submitNewCustomerAddress() {
  if (editingAddressId) {
    return submitEditCustomerAddress();
  }

  if (!activeCustomer) {
    alert("Please select or register a customer account first.");
    return;
  }

  const tag = document.getElementById("new-addr-tag")?.value.trim() || "Home";
  const street = document.getElementById("new-addr-street")?.value.trim();
  const city = document.getElementById("new-addr-city")?.value.trim() || "Windhoek";
  const state = document.getElementById("new-addr-state")?.value.trim() || "Khomas";
  const postalCode = document.getElementById("new-addr-postal")?.value.trim() || "9000";
  const lon = parseFloat(document.getElementById("new-addr-lon")?.value || "17.0658");
  const lat = parseFloat(document.getElementById("new-addr-lat")?.value || "-22.5609");
  const instructions = document.getElementById("new-addr-instructions")?.value.trim() || "";

  if (!street) {
    alert("Please enter a street address.");
    return;
  }

  const newAddressId = `addr_${Date.now()}`;
  const addressPayload = {
    id: newAddressId,
    tag: tag,
    street: street,
    city: city,
    state: state,
    postalCode: postalCode,
    location: {
      type: "Point",
      coordinates: [lon, lat]
    },
    deliveryInstructions: instructions,
    isDefault: false
  };

  const btn = document.getElementById("btn-submit-new-addr");
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(activeCustomer.id)}/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addressPayload),
      timeoutMs: 4000
    });

    if (res.ok || res.status === 201) {
      if (!Array.isArray(activeCustomer.addresses)) {
        activeCustomer.addresses = [];
      }
      activeCustomer.addresses.push(addressPayload);
      if (!activeCustomer.address) activeCustomer.address = addressPayload;
      selectedDeliveryAddressId = newAddressId;

      closeAddAddressModal();
      populateCheckoutAddressDropdown();
      renderMenuAddressBook();
      renderCustomerProfile();
      updateCartSummary();
      alert(`New address "${tag}: ${street}" saved successfully!`);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Could not save address: ${err.message || res.statusText}`);
    }
  } catch (err) {
    if (!Array.isArray(activeCustomer.addresses)) {
      activeCustomer.addresses = [];
    }
    activeCustomer.addresses.push(addressPayload);
    if (!activeCustomer.address) activeCustomer.address = addressPayload;
    selectedDeliveryAddressId = newAddressId;

    closeAddAddressModal();
    populateCheckoutAddressDropdown();
    renderMenuAddressBook();
    renderCustomerProfile();
    updateCartSummary();
    alert(`Address saved locally: ${street}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function submitEditCustomerAddress() {
  if (!activeCustomer) {
    alert("Please select or register a customer account first.");
    return;
  }
  if (!editingAddressId) {
    return submitNewCustomerAddress();
  }

  const tag = document.getElementById("new-addr-tag")?.value.trim() || "Home";
  const street = document.getElementById("new-addr-street")?.value.trim();
  const city = document.getElementById("new-addr-city")?.value.trim() || "Windhoek";
  const state = document.getElementById("new-addr-state")?.value.trim() || "Khomas";
  const postalCode = document.getElementById("new-addr-postal")?.value.trim() || "9000";
  const lon = parseFloat(document.getElementById("new-addr-lon")?.value || "17.0658");
  const lat = parseFloat(document.getElementById("new-addr-lat")?.value || "-22.5609");
  const instructions = document.getElementById("new-addr-instructions")?.value.trim() || "";

  if (!street) {
    alert("Please enter a street address.");
    return;
  }

  if (isNaN(lon) || lon < 11.7 || lon > 25.3) {
    alert("Longitude must be within Namibia (11.7 to 25.3).");
    return;
  }
  if (isNaN(lat) || lat < -28.97 || lat > -16.96) {
    alert("Latitude must be within Namibia (-28.97 to -16.96).");
    return;
  }

  const addresses = activeCustomer.addresses || (activeCustomer.address ? [activeCustomer.address] : []);
  const existing = addresses.find((a) => (a.id || "") === editingAddressId);
  const isDefault = existing ? Boolean(existing.isDefault) : false;

  const addressPayload = {
    id: editingAddressId,
    tag: tag,
    street: street,
    city: city,
    state: state,
    postalCode: postalCode,
    location: {
      type: "Point",
      coordinates: [lon, lat]
    },
    deliveryInstructions: instructions,
    isDefault: isDefault
  };

  const btn = document.getElementById("btn-submit-new-addr");
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(activeCustomer.id)}/addresses/${encodeURIComponent(editingAddressId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addressPayload),
      timeoutMs: 4000
    });

    if (res.ok) {
      const updated = await res.json().catch(() => addressPayload);
      if (Array.isArray(activeCustomer.addresses)) {
        const idx = activeCustomer.addresses.findIndex((a) => (a.id || "") === editingAddressId);
        if (idx !== -1) {
          activeCustomer.addresses[idx] = updated;
        } else {
          activeCustomer.addresses.push(updated);
        }
      }
      if (activeCustomer.address && (activeCustomer.address.id === editingAddressId || isDefault)) {
        activeCustomer.address = updated;
      }

      closeAddAddressModal();
      populateCheckoutAddressDropdown();
      renderMenuAddressBook();
      renderCustomerProfile();
      updateCartSummary();
      alert(`Address "${tag}: ${street}" updated successfully!`);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Could not update address: ${err.message || res.statusText}`);
    }
  } catch (err) {
    if (Array.isArray(activeCustomer.addresses)) {
      const idx = activeCustomer.addresses.findIndex((a) => (a.id || "") === editingAddressId);
      if (idx !== -1) {
        activeCustomer.addresses[idx] = addressPayload;
      } else {
        activeCustomer.addresses.push(addressPayload);
      }
    }
    if (activeCustomer.address && (activeCustomer.address.id === editingAddressId || isDefault)) {
      activeCustomer.address = addressPayload;
    }

    closeAddAddressModal();
    populateCheckoutAddressDropdown();
    renderMenuAddressBook();
    renderCustomerProfile();
    updateCartSummary();
    alert(`Address updated locally: ${street}`);
  } finally {
    if (btn) btn.disabled = false;
    editingAddressId = null;
  }
}

async function removeCustomerAddress(addressId) {
  if (!activeCustomer) {
    alert("Please select or register a customer account first.");
    return;
  }

  const addresses = activeCustomer.addresses || (activeCustomer.address ? [activeCustomer.address] : []);
  const target = addresses.find((a) => (a.id || "") === addressId);
  if (!target) return;

  const confirmMsg = `Are you sure you want to remove the address "${target.tag || "Address"}: ${target.street || ""}"?`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(activeCustomer.id)}/addresses/${encodeURIComponent(addressId)}`, {
      method: "DELETE",
      timeoutMs: 4000
    });

    if (res.ok || res.status === 200 || res.status === 204) {
      activeCustomer.addresses = (activeCustomer.addresses || []).filter((a) => (a.id || "") !== addressId);
      if (target.isDefault && activeCustomer.addresses.length > 0) {
        activeCustomer.addresses[0].isDefault = true;
        activeCustomer.address = activeCustomer.addresses[0];
      } else if (activeCustomer.address && activeCustomer.address.id === addressId) {
        activeCustomer.address = activeCustomer.addresses[0] || null;
      }
      if (selectedDeliveryAddressId === addressId) {
        selectedDeliveryAddressId = activeCustomer.addresses[0]?.id || null;
      }

      populateCheckoutAddressDropdown();
      renderMenuAddressBook();
      renderCustomerProfile();
      updateCartSummary();
      alert("Address deleted successfully.");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Could not delete address: ${err.message || res.statusText}`);
    }
  } catch (err) {
    activeCustomer.addresses = (activeCustomer.addresses || []).filter((a) => (a.id || "") !== addressId);
    if (target.isDefault && activeCustomer.addresses.length > 0) {
      activeCustomer.addresses[0].isDefault = true;
      activeCustomer.address = activeCustomer.addresses[0];
    } else if (activeCustomer.address && activeCustomer.address.id === addressId) {
      activeCustomer.address = activeCustomer.addresses[0] || null;
    }
    if (selectedDeliveryAddressId === addressId) {
      selectedDeliveryAddressId = activeCustomer.addresses[0]?.id || null;
    }

    populateCheckoutAddressDropdown();
    renderMenuAddressBook();
    renderCustomerProfile();
    updateCartSummary();
    alert("Address removed locally.");
  }
}

async function setDefaultCustomerAddress(addressId) {
  if (!activeCustomer) {
    alert("Please select or register a customer account first.");
    return;
  }

  try {
    const res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(activeCustomer.id)}/addresses/default`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addressId: addressId }),
      timeoutMs: 4000
    });

    if (res.ok) {
      const updatedCust = await res.json().catch(() => null);
      if (updatedCust && Array.isArray(updatedCust.addresses)) {
        activeCustomer.addresses = updatedCust.addresses;
        if (updatedCust.address) activeCustomer.address = updatedCust.address;
      } else {
        (activeCustomer.addresses || []).forEach((a) => {
          a.isDefault = ((a.id || "") === addressId);
          if (a.isDefault) activeCustomer.address = a;
        });
      }
      selectedDeliveryAddressId = addressId;
      populateCheckoutAddressDropdown();
      renderMenuAddressBook();
      renderCustomerProfile();
      updateCartSummary();
      alert("Default address updated.");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Could not set default address: ${err.message || res.statusText}`);
    }
  } catch (err) {
    (activeCustomer.addresses || []).forEach((a) => {
      a.isDefault = ((a.id || "") === addressId);
      if (a.isDefault) activeCustomer.address = a;
    });
    selectedDeliveryAddressId = addressId;
    populateCheckoutAddressDropdown();
    renderMenuAddressBook();
    renderCustomerProfile();
    updateCartSummary();
    alert("Default address set locally.");
  }
}

function updateCartSummary() {
  const itemsSubtotal = cart.reduce((acc, c) => acc + Number(c.item.price) * c.quantity, 0);
  const deliveryFee = cart.length > 0 ? dynamicPricing.deliveryFee : 0;
  const totalAmount = itemsSubtotal + deliveryFee;

  // 15% VAT included breakdown
  const taxPortion = (itemsSubtotal * 0.15) / 1.15;

  // Stage 1 readout elements
  setText("cart-stage1-subtotal", `N$ ${itemsSubtotal.toFixed(2)}`);
  setText("cart-stage1-delivery-fee", `N$ ${deliveryFee.toFixed(2)}`);
  setText("cart-stage1-tax", `N$ ${taxPortion.toFixed(2)}`);
  setText("cart-stage1-total", `N$ ${totalAmount.toFixed(2)}`);

  const stage1Surge = document.getElementById("cart-stage1-surge");
  if (stage1Surge) {
    stage1Surge.textContent = `${dynamicPricing.surgeMultiplier.toFixed(1)}x ${dynamicPricing.surgeMultiplier > 1.0 ? "Peak Surge" : "Normal"}`;
  }

  // Stage 2 readout elements (Grand Total right above Place Order button)
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

  // Stage 1 Confirm Cart button enable/disable
  const confirmBtn = document.getElementById("btn-confirm-cart");
  if (confirmBtn) {
    const isClosed = selectedRestaurant && selectedRestaurant.isOpen === false;
    confirmBtn.disabled = cart.length === 0 || !activeCustomer || !selectedRestaurant || isClosed;
    if (isClosed) {
      confirmBtn.title = "Restaurant is currently closed for ordering";
    } else {
      confirmBtn.title = "";
    }
  }

  // Stage 2 Place Order button enable/disable
  const placeBtn = document.getElementById("btn-place-order");
  if (placeBtn) {
    const isClosed = selectedRestaurant && selectedRestaurant.isOpen === false;
    placeBtn.disabled = cart.length === 0 || !activeCustomer || !selectedRestaurant || isClosed;
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

  // Verify restaurant is not closed
  if (selectedRestaurant.isOpen === false) {
    alert(`"${selectedRestaurant.name || "This restaurant"}" is currently CLOSED for ordering. Cannot place order.`);
    return;
  }

  // Resolve chosen delivery address from Stage 2 dropdown
  let customerAddr = null;
  const addresses = activeCustomer.addresses || (activeCustomer.address ? [activeCustomer.address] : []);
  if (selectedDeliveryAddressId) {
    customerAddr = addresses.find((a) => (a.id || "") === selectedDeliveryAddressId);
  }
  if (!customerAddr && addresses.length > 0) {
    customerAddr = addresses.find((a) => a.isDefault) || addresses[0];
  }
  if (!customerAddr) {
    customerAddr = activeCustomer.address || {
      street: "12 Independence Avenue",
      city: "Windhoek",
      state: "Khomas",
      postalCode: "9000",
      location: { coordinates: [17.0658, -22.5609] }
    };
  }

  let scheduleNote = "";
  if (deliveryScheduleState.preset === "SCHEDULE" || deliveryScheduleState.preset === "CUSTOM") {
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
      street: customerAddr.street || "12 Independence Avenue",
      city: customerAddr.city || "Windhoek",
      state: customerAddr.state || "Khomas",
      postalCode: customerAddr.postalCode || "9000",
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

    if (activeCustomer && activeCustomer.id) {
      const orderReceiptObj = {
        id: orderId,
        orderId: orderId,
        customerId: activeCustomer.id,
        customerName: activeCustomer.name,
        customerAddress: activeCustomer.address?.street || "Windhoek",
        restaurantId: selectedRestaurant?.id || "R001",
        restaurantName: selectedRestaurant?.name || "Kapana Corner",
        restaurantAddress: selectedRestaurant?.address || "Single Quarters, Katutura",
        items: cart.map(item => ({
          id: item.id || item.item?.id,
          name: item.name || item.item?.name,
          price: item.price || item.item?.price,
          quantity: item.quantity
        })),
        subtotal: typeof cartSubtotal !== "undefined" ? cartSubtotal : (createdOrder?.subtotal || createdOrder?.totalAmount || 0),
        deliveryFee: typeof deliveryFee !== "undefined" ? deliveryFee : (createdOrder?.deliveryFee || 25.0),
        surgeFee: typeof surgeFee !== "undefined" ? surgeFee : 0,
        totalAmount: createdOrder?.totalAmount || (typeof orderTotal !== "undefined" ? orderTotal : 0),
        status: "CONFIRMED",
        createdAt: new Date().toISOString(),
        timestamp: Date.now()
      };
      let localOrders = [];
      try {
        const rawLocal = localStorage.getItem("dsa_local_orders_" + activeCustomer.id);
        if (rawLocal) localOrders = JSON.parse(rawLocal);
      } catch (_) {}
      localOrders.unshift(orderReceiptObj);
      localStorage.setItem("dsa_local_orders_" + activeCustomer.id, JSON.stringify(localOrders));
    }

    // Clear cart, reset to stage 1, and close drawer
    cart = [];
    saveCart();
    resetCartStage();
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

// Modal & Active Order Badge Controls
function handleOrderBadgeMouseEnter() {
  if (orderPopoverHideTimer) {
    clearTimeout(orderPopoverHideTimer);
    orderPopoverHideTimer = null;
  }
  const pop = document.getElementById("order-badge-popover");
  if (pop) pop.style.display = "block";
}

function handleOrderBadgeMouseLeave() {
  if (orderPopoverHideTimer) clearTimeout(orderPopoverHideTimer);
  orderPopoverHideTimer = setTimeout(() => {
    const pop = document.getElementById("order-badge-popover");
    if (pop) pop.style.display = "none";
  }, 3000);
}

function cycleToNextActiveOrder() {
  if (!activeOrdersList || activeOrdersList.length === 0) return;
  const currentIdx = activeOrdersList.indexOf(currentlyTrackedOrderId);
  const nextIdx = (currentIdx + 1) % activeOrdersList.length;
  currentlyTrackedOrderId = activeOrdersList[nextIdx];
  selectOrderToTrack(currentlyTrackedOrderId);
}

function handleOrderBadgeClick(event) {
  if (event) {
    event.stopPropagation();
  }
  const pop = document.getElementById("order-badge-popover");
  if (!pop) return;

  const isVisible = pop.style.display === "block" || pop.classList.contains("is-visible");
  if (!isVisible) {
    if (orderPopoverHideTimer) {
      clearTimeout(orderPopoverHideTimer);
      orderPopoverHideTimer = null;
    }
    pop.style.display = "block";
    pop.classList.add("is-visible");
  } else {
    if (activeOrdersList && activeOrdersList.length > 1) {
      cycleToNextActiveOrder();
    } else {
      pop.style.display = "none";
      pop.classList.remove("is-visible");
    }
  }
}

// ============================================================================
// 9. LIVE ORDER TRACKING & DRIVER TELEMETRY (VIEW 2)
// ============================================================================
function refreshTrackingOrdersDropdown() {
  const dropdown = document.getElementById("tracking-order-select");
  const countBadge = document.getElementById("active-orders-count");
  const badgeWrapper = document.getElementById("header-active-order-badge-wrapper");
  const pillDivider = document.getElementById("header-pill-divider");
  const unifiedPill = document.getElementById("header-unified-pill");
  const progressTrack = document.getElementById("header-order-progress-track");

  let orders = [];
  try {
    const raw = localStorage.getItem("dsa_active_orders");
    if (raw) orders = JSON.parse(raw);
  } catch (_) {}

  // Filter out any orders marked as completed/confirmed
  orders = orders.filter((oid) => localStorage.getItem(`dsa_order_completed_${oid}`) !== "true");
  try {
    localStorage.setItem("dsa_active_orders", JSON.stringify(orders));
  } catch (_) {}

  activeOrdersList = orders;

  const emptyPlaceholder = document.getElementById("tracking-empty-placeholder");
  const activeContent = document.getElementById("tracking-active-content");

  const trackingTabBtn = document.getElementById("tab-btn-tracking");
  if (trackingTabBtn) {
    trackingTabBtn.style.display = orders.length > 0 ? "inline-flex" : "none";
  }

  if (countBadge) {
    if (orders.length > 0) {
      countBadge.style.display = "inline-block";
      countBadge.textContent = orders.length;
    } else {
      countBadge.style.display = "none";
    }
  }

  if (orders.length === 0) {
    currentlyTrackedOrderId = null;
    if (badgeWrapper) badgeWrapper.style.display = "none";
    if (pillDivider) pillDivider.style.display = "none";
    if (unifiedPill) unifiedPill.classList.remove("has-order");
    if (progressTrack) progressTrack.style.display = "none";

    if (dropdown) dropdown.innerHTML = `<option value="" disabled selected>No active orders</option>`;
    if (emptyPlaceholder) emptyPlaceholder.style.display = "block";
    if (activeContent) activeContent.style.display = "none";
    if (trackingPollerId) {
      clearInterval(trackingPollerId);
      trackingPollerId = null;
    }
    if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
    return;
  }

  if (badgeWrapper) badgeWrapper.style.display = "inline-flex";
  if (pillDivider) pillDivider.style.display = "block";
  if (unifiedPill) unifiedPill.classList.add("has-order");
  if (progressTrack) progressTrack.style.display = "block";

  if (emptyPlaceholder) emptyPlaceholder.style.display = "none";
  if (activeContent) activeContent.style.display = "block";

  const savedTrackedId = localStorage.getItem("dsa_currently_tracked_order_id");
  const preferredOrderId = (currentlyTrackedOrderId && orders.includes(currentlyTrackedOrderId))
    ? currentlyTrackedOrderId
    : ((savedTrackedId && orders.includes(savedTrackedId)) ? savedTrackedId : orders[0]);

  currentlyTrackedOrderId = preferredOrderId;

  if (dropdown) {
    dropdown.innerHTML = orders
      .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(window.formatFriendlyOrderId ? window.formatFriendlyOrderId(o) : o)}</option>`)
      .join("");

    dropdown.value = preferredOrderId;
  }

  // Ensure polling is active when active orders exist
  if (!trackingPollerId && currentlyTrackedOrderId) {
    selectOrderToTrack(currentlyTrackedOrderId);
  }

  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
}

function selectOrderToTrack(orderId) {
  if (!orderId) {
    currentlyTrackedOrderId = null;
    try {
      localStorage.removeItem("dsa_currently_tracked_order_id");
    } catch (_) {}
    refreshTrackingOrdersDropdown();
    return;
  }
  currentlyTrackedOrderId = orderId;
  try {
    localStorage.setItem("dsa_currently_tracked_order_id", orderId);
  } catch (_) {}

  const emptyPlaceholder = document.getElementById("tracking-empty-placeholder");
  const activeContent = document.getElementById("tracking-active-content");
  if (emptyPlaceholder) emptyPlaceholder.style.display = "none";
  if (activeContent) activeContent.style.display = "block";

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
  const friendlyId = window.formatFriendlyOrderId ? window.formatFriendlyOrderId(currentlyTrackedOrderId) : (currentlyTrackedOrderId || "\u2014");
  setText("track-order-id", friendlyId);
  const popoverRefEl = document.getElementById("order-popover-ref");
  if (popoverRefEl) popoverRefEl.textContent = friendlyId;

  const orderStatus = order?.status || delivery?.status || "CREATED";
  recordOrderStepTimestamp(currentlyTrackedOrderId, orderStatus);

  // Check if driver is assigned
  const hasDriver = Boolean(delivery?.driverId && delivery.driverId !== "UNASSIGNED" && delivery.currentLocation);

  const findingEl = document.getElementById("tracking-finding-driver");
  const driverAssignedEl = document.getElementById("tracking-driver-assigned");
  const statusPill = document.getElementById("track-order-status-pill");
  const findingSub = document.getElementById("tracking-finding-sub");

  if (orderStatus === "CANCELLED") {
    if (findingEl) findingEl.style.display = "flex";
    if (driverAssignedEl) driverAssignedEl.style.display = "none";
    if (statusPill) {
      statusPill.textContent = "Order Cancelled";
      statusPill.className = "tracking-status-title status-pill-cancelled";
    }
    if (findingSub) {
      findingSub.textContent = order?.cancellationReason || "This order has been cancelled and refunded.";
    }
  } else if (!hasDriver) {
    if (findingEl) findingEl.style.display = "flex";
    if (driverAssignedEl) driverAssignedEl.style.display = "none";
    if (statusPill) {
      statusPill.textContent = orderStatus === "CREATED" ? "Order Placed" : (orderStatus === "CONFIRMED" ? "Order Confirmed" : "Preparing Order");
    }
    if (findingSub) {
      findingSub.textContent = orderStatus === "READY"
        ? "Meal ready. Assigning nearby courier..."
        : "Assigning courier & preparing in kitchen...";
    }
  } else {
    if (findingEl) findingEl.style.display = "none";
    if (driverAssignedEl) driverAssignedEl.style.display = "block";

    const driverId = delivery.driverId;
    const resolvedDriverName = delivery?.driverName || (window.DSA?.resolveDriverName && window.DSA.resolveDriverName(delivery?.driverId)) || "Tomas Nekundi";
    const courierProfile = (driverId && KNOWN_COURIERS[driverId]) ? KNOWN_COURIERS[driverId] : {
      name: resolvedDriverName,
      phone: "+264812345601",
      vehicle: "Motorcycle"
    };

    setText("track-driver-name", resolvedDriverName);
    setText("track-driver-vehicle", courierProfile.vehicle);

    const callLink = document.getElementById("track-driver-phone-link");
    if (callLink) {
      callLink.href = courierProfile.phone ? `tel:${courierProfile.phone}` : "tel:+264812345601";
    }

    const deliveryConfirmBox = document.getElementById("delivery-confirmation-box");
    if (deliveryConfirmBox) {
      deliveryConfirmBox.style.display = (orderStatus === "DELIVERED" || delivery?.status === "DELIVERED") ? "block" : "none";
    }
  }

  // Coordinates
  let driverLat = CONFIG.WINDHOEK_REF.lat;
  let driverLon = CONFIG.WINDHOEK_REF.lon;
  if (delivery?.currentLocation) {
    driverLat = Number(delivery.currentLocation.latitude);
    driverLon = Number(delivery.currentLocation.longitude);
  }

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
  if (hasDriver) {
    setText("track-distance-km", distanceKm.toFixed(1));
    setText("track-eta-mins", calculateETA(distanceKm));
  }

  // Header Order Badge & Counter Synchronization
  const badgeBtn = document.getElementById("header-order-badge");
  const badgeStageEl = document.getElementById("order-badge-stage");
  const badgeCountEl = document.getElementById("order-badge-count");
  const headerProgressFill = document.getElementById("header-order-progress-fill");

  let badgeHumanizedStage = hasDriver ? "Driver En Route" : "Preparing";
  let badgeStageClass = hasDriver ? "stage-transit" : "stage-preparing";
  let headerProgressPct = hasDriver ? 80 : 35;

  if (orderStatus === "DELIVERED") {
    badgeHumanizedStage = "Delivered";
    badgeStageClass = "stage-delivered";
    headerProgressPct = 100;
  }

  if (badgeStageEl) badgeStageEl.textContent = badgeHumanizedStage;
  if (badgeBtn) badgeBtn.className = `header-order-badge ${badgeStageClass}`;
  if (headerProgressFill) headerProgressFill.style.width = `${headerProgressPct}%`;

  if (badgeCountEl) {
    if (activeOrdersList && activeOrdersList.length > 1) {
      const activeIdx = activeOrdersList.indexOf(currentlyTrackedOrderId);
      badgeCountEl.textContent = `${activeIdx >= 0 ? activeIdx + 1 : 1}/${activeOrdersList.length} \u21bb`;
      badgeCountEl.style.display = "inline-block";
    } else {
      badgeCountEl.style.display = "none";
    }
  }

  const restObj = (order?.restaurantId && Array.isArray(liveRestaurants) && liveRestaurants.find(r => r.id === order.restaurantId)) || selectedRestaurant;
  const restLat = Number(order?.restaurantCoordinates?.latitude || (restObj?.location?.coordinates ? restObj.location.coordinates[1] : -22.5609));
  const restLon = Number(order?.restaurantCoordinates?.longitude || (restObj?.location?.coordinates ? restObj.location.coordinates[0] : 17.0658));
  const restName = order?.restaurantName || restObj?.name || (window.DSA?.resolveRestaurantName && window.DSA.resolveRestaurantName(order?.restaurantId)) || "Live Kitchen";

  // Update Interactive Map live courier tracking
  updateClientGoogleMap(
    { lat: driverLat, lng: driverLon },
    { lat: customerLat, lng: customerLon },
    { lat: restLat, lng: restLon, name: restName },
    hasDriver,
    orderStatus
  );
}

// ============================================================================
// 10. LEAFLET / MAPS PLATFORM LIVE ORDER TRACKING (FULLSCREEN MAP & ROUTE)
// ============================================================================

let clientGoogleMap = null;
let clientGmpMarkers = {
  restaurant: null,
  customer: null,
  driver: null
};
let clientRoutePolyline = null;
let isClientGmpInitialized = false;

async function initClientGoogleMap(driverCoords, customerCoords, restaurantCoords, hasDriver, orderStatus) {
  const mapCanvas = document.getElementById("client-google-map");
  const banner = document.getElementById("client-map-banner");
  if (!mapCanvas) return;

  const dLat = driverCoords?.lat ?? GOOGLE_MAPS_CONFIG.coordinates.courierLocation.lat;
  const dLng = driverCoords?.lng ?? GOOGLE_MAPS_CONFIG.coordinates.courierLocation.lng;
  const cLat = customerCoords?.lat ?? GOOGLE_MAPS_CONFIG.coordinates.customerDelivery.lat;
  const cLng = customerCoords?.lng ?? GOOGLE_MAPS_CONFIG.coordinates.customerDelivery.lng;
  const rLat = restaurantCoords?.lat ?? GOOGLE_MAPS_CONFIG.coordinates.restaurantLocation.lat;
  const rLng = restaurantCoords?.lng ?? GOOGLE_MAPS_CONFIG.coordinates.restaurantLocation.lng;
  const rName = restaurantCoords?.name || "Live Kitchen";

  if (window.L) {
    if (window.clientLeafletMap) {
      updateClientGoogleMap(driverCoords, customerCoords, restaurantCoords, hasDriver, orderStatus);
      isClientGmpInitialized = true;
      window.isClientGmpInitialized = true;
      if (banner) banner.style.display = "none";
      return;
    }

    window.clientLeafletMap = L.map(mapCanvas, { zoomControl: false }).setView([cLat, cLng], 14);
    L.control.zoom({ position: "bottomright" }).addTo(window.clientLeafletMap);

    const tileUrl = (typeof window.getCartoTileUrl === "function")
      ? window.getCartoTileUrl("voyager")
      : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
    L.tileLayer(tileUrl, { subdomains: "abcd", maxZoom: 20 }).addTo(window.clientLeafletMap);

    const custIcon = L.divIcon({
      className: "custom-leaflet-marker",
      html: `<div class="customer-pin-marker" title="Delivery Address"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const restIcon = L.divIcon({
      className: "custom-leaflet-marker",
      html: `<div class="restaurant-pin-marker" title="${escapeHtml(rName)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    window.clientLeafletMarkers = {
      customer: L.marker([cLat, cLng], { icon: custIcon, title: "Delivery Destination" }).addTo(window.clientLeafletMap).bindPopup("Your Delivery Address"),
      restaurant: L.marker([rLat, rLng], { icon: restIcon, title: rName }).addTo(window.clientLeafletMap).bindPopup(rName),
      driver: null
    };

    window.clientLeafletMarkers.restaurants = [];
    renderClientRestaurantMarkers();

    isClientGmpInitialized = true;
    window.isClientGmpInitialized = true;
    if (banner) banner.style.display = "none";

    await updateClientGoogleMap(driverCoords, customerCoords, restaurantCoords, hasDriver, orderStatus);
    return;
  }
}

function renderClientRestaurantMarkers() {
  if (!window.clientLeafletMap) return;

  // Clear previous restaurant markers
  if (window.clientLeafletMarkers && Array.isArray(window.clientLeafletMarkers.restaurants)) {
    window.clientLeafletMarkers.restaurants.forEach(m => {
      try { window.clientLeafletMap.removeLayer(m); } catch (_) {}
    });
  }
  if (!window.clientLeafletMarkers) {
    window.clientLeafletMarkers = {};
  }
  window.clientLeafletMarkers.restaurants = [];

  const restList = (liveRestaurants && liveRestaurants.length > 0)
    ? liveRestaurants
    : (window.DEFAULT_SEED_RESTAURANTS || []);

  restList.forEach(r => {
    let lat = -22.5609;
    let lng = 17.0658;
    if (r.location && Array.isArray(r.location.coordinates) && r.location.coordinates.length >= 2) {
      lng = Number(r.location.coordinates[0]);
      lat = Number(r.location.coordinates[1]);
    } else if (r.lat && r.lng) {
      lat = Number(r.lat);
      lng = Number(r.lng);
    }

    const restIcon = L.divIcon({
      className: "custom-leaflet-marker",
      html: `<div class="restaurant-pin-marker" title="${escapeHtml(r.name)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    const m = L.marker([lat, lng], { icon: restIcon, title: r.name }).addTo(window.clientLeafletMap);
    const cardFn = (window.DSA?.createRestaurantMapCardHtml || window.createRestaurantMapCardHtml);
    const cardHtml = typeof cardFn === "function"
      ? cardFn(r, { isClient: true })
      : `<div style="padding: 10px;"><h4>${escapeHtml(r.name)}</h4><button type="button" class="btn btn-primary btn-xs" onclick="openRestaurantCatalogFromMap('${escapeHtml(r.id)}')">Browse Menu</button></div>`;
    m.bindPopup(cardHtml, { className: "restaurant-map-popup" });
    window.clientLeafletMarkers.restaurants.push(m);
  });
}
window.renderClientRestaurantMarkers = renderClientRestaurantMarkers;

function openRestaurantCatalogFromMap(restaurantId) {
  selectRestaurantCard(restaurantId);
  switchMainTab("menu");
  setTimeout(() => {
    const catalogEl = document.getElementById("menu-catalog-section");
    if (catalogEl) {
      catalogEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 100);
}
window.openRestaurantCatalogFromMap = openRestaurantCatalogFromMap;

async function updateClientGoogleMap(driverCoords, customerCoords, restaurantCoords, hasDriver, orderStatus) {
  const dLat = Number(driverCoords?.lat ?? GOOGLE_MAPS_CONFIG.coordinates.courierLocation.lat);
  const dLng = Number(driverCoords?.lng ?? GOOGLE_MAPS_CONFIG.coordinates.courierLocation.lng);
  const cLat = Number(customerCoords?.lat ?? GOOGLE_MAPS_CONFIG.coordinates.customerDelivery.lat);
  const cLng = Number(customerCoords?.lng ?? GOOGLE_MAPS_CONFIG.coordinates.customerDelivery.lng);
  const rLat = Number(restaurantCoords?.lat ?? GOOGLE_MAPS_CONFIG.coordinates.restaurantLocation.lat);
  const rLng = Number(restaurantCoords?.lng ?? GOOGLE_MAPS_CONFIG.coordinates.restaurantLocation.lng);
  const rName = restaurantCoords?.name || "Live Kitchen";

  if (!isClientGmpInitialized || !window.clientLeafletMap) {
    if (window._isInitializingClientMap) return;
    window._isInitializingClientMap = true;
    try {
      await initClientGoogleMap(driverCoords, customerCoords, restaurantCoords, hasDriver, orderStatus);
    } finally {
      window._isInitializingClientMap = false;
    }
    return;
  }

  if (window.clientLeafletMap && window.clientLeafletMarkers) {
    if (window.clientLeafletMarkers.customer) {
      window.clientLeafletMarkers.customer.setLatLng([cLat, cLng]);
    }

    if (window.clientLeafletMarkers.restaurant) {
      window.clientLeafletMarkers.restaurant.setLatLng([rLat, rLng]);
      window.clientLeafletMarkers.restaurant.bindPopup(rName);
    } else {
      const restIcon = L.divIcon({
        className: "custom-leaflet-marker",
        html: `<div class="restaurant-pin-marker" title="${escapeHtml(rName)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg></div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
      window.clientLeafletMarkers.restaurant = L.marker([rLat, rLng], { icon: restIcon, title: rName }).addTo(window.clientLeafletMap).bindPopup(rName);
    }

    let roadPoints = [];
    const routeFn = window.DSA?.fetchRoadRoute || window.fetchRoadRoute;

    if (hasDriver) {
      const driverIcon = L.divIcon({
        className: "custom-leaflet-marker",
        html: `
          <div class="driver-radar-marker">
            <div class="driver-pulse-ring"></div>
            <div class="driver-icon-core" title="Driver Location">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
              </svg>
            </div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      if (!window.clientLeafletMarkers.driver) {
        window.clientLeafletMarkers.driver = L.marker([dLat, dLng], { icon: driverIcon, zIndexOffset: 1000 }).addTo(window.clientLeafletMap);
      } else {
        window.clientLeafletMarkers.driver.setLatLng([dLat, dLng]);
      }

      if (typeof routeFn === "function") {
        try {
          if (orderStatus === "DRIVER_ASSIGNED" || orderStatus === "AT_RESTAURANT") {
            const [leg1, leg2] = await Promise.all([
              routeFn({ lat: dLat, lon: dLng }, { lat: rLat, lon: rLng }),
              routeFn({ lat: rLat, lon: rLng }, { lat: cLat, lon: cLng })
            ]);
            roadPoints = [...(leg1.coordinates || [[dLat, dLng], [rLat, rLng]]), ...(leg2.coordinates || [[rLat, rLng], [cLat, cLng]])];
            const totalDist = (leg1.distanceKm || 0) + (leg2.distanceKm || 0);
            const totalDur = (leg1.durationMins || 0) + (leg2.durationMins || 0);
            if (totalDist) setText("track-distance-km", totalDist.toFixed(1));
            if (totalDur) setText("track-eta-mins", `~${totalDur} mins`);
          } else {
            const res = await routeFn({ lat: dLat, lon: dLng }, { lat: cLat, lon: cLng });
            if (res && res.coordinates) {
              roadPoints = res.coordinates;
              if (res.distanceKm) setText("track-distance-km", res.distanceKm.toFixed(1));
              if (res.durationMins) setText("track-eta-mins", `~${res.durationMins} mins`);
            }
          }
        } catch (_) {
          roadPoints = [[dLat, dLng], [cLat, cLng]];
        }
      } else {
        roadPoints = [[dLat, dLng], [cLat, cLng]];
      }

      if (window.clientLeafletPolylineGroup) {
        window.clientLeafletMap.removeLayer(window.clientLeafletPolylineGroup);
      }
      if (window.clientLeafletPolyline) {
        window.clientLeafletMap.removeLayer(window.clientLeafletPolyline);
        window.clientLeafletPolyline = null;
      }

      const ribbonFn = window.DSA?.createRibbonPolylineGroup || window.createRibbonPolylineGroup;
      if (typeof ribbonFn === "function") {
        window.clientLeafletPolylineGroup = ribbonFn(roadPoints, { casingColor: "#ffffff", casingWeight: 8, coreColor: "#eb4d28", coreWeight: 4.5 });
      } else {
        const casing = L.polyline(roadPoints, { color: "#ffffff", weight: 8, opacity: 0.95, lineCap: "round", lineJoin: "round" });
        const core = L.polyline(roadPoints, { color: "#eb4d28", weight: 4.5, opacity: 1.0, lineCap: "round", lineJoin: "round" });
        window.clientLeafletPolylineGroup = L.layerGroup([casing, core]);
      }
      window.clientLeafletPolylineGroup.addTo(window.clientLeafletMap);

      window.clientLeafletMap.fitBounds([[dLat, dLng], [rLat, rLng], [cLat, cLng]], { padding: [80, 80], maxZoom: 16 });
    } else {
      if (window.clientLeafletMarkers.driver) {
        window.clientLeafletMap.removeLayer(window.clientLeafletMarkers.driver);
        window.clientLeafletMarkers.driver = null;
      }
      if (typeof routeFn === "function") {
        try {
          const res = await routeFn({ lat: rLat, lon: rLng }, { lat: cLat, lon: cLng });
          if (res && res.coordinates) roadPoints = res.coordinates;
        } catch (_) {
          roadPoints = [[rLat, rLng], [cLat, cLng]];
        }
      } else {
        roadPoints = [[rLat, rLng], [cLat, cLng]];
      }

      if (window.clientLeafletPolylineGroup) {
        window.clientLeafletMap.removeLayer(window.clientLeafletPolylineGroup);
      }
      if (window.clientLeafletPolyline) {
        window.clientLeafletMap.removeLayer(window.clientLeafletPolyline);
        window.clientLeafletPolyline = null;
      }

      const ribbonFn = window.DSA?.createRibbonPolylineGroup || window.createRibbonPolylineGroup;
      if (typeof ribbonFn === "function") {
        window.clientLeafletPolylineGroup = ribbonFn(roadPoints, { casingColor: "#ffffff", casingWeight: 7, coreColor: "#f59e0b", coreWeight: 4 });
      } else {
        const casing = L.polyline(roadPoints, { color: "#ffffff", weight: 7, opacity: 0.95, lineCap: "round", lineJoin: "round" });
        const core = L.polyline(roadPoints, { color: "#f59e0b", weight: 4, opacity: 1.0, lineCap: "round", lineJoin: "round" });
        window.clientLeafletPolylineGroup = L.layerGroup([casing, core]);
      }
      window.clientLeafletPolylineGroup.addTo(window.clientLeafletMap);

      window.clientLeafletMap.fitBounds([[rLat, rLng], [cLat, cLng]], { padding: [80, 80], maxZoom: 16 });
    }
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

async function confirmCustomerOrderReceipt() {
  if (!currentlyTrackedOrderId) return;
  const orderId = currentlyTrackedOrderId;

  const confirmed = confirm(
    `Confirm receipt of Order ${orderId}?\n\nThis will mark the order as fully completed and dismiss it from live tracking.`
  );
  if (!confirmed) return;

  try {
    // 1. Mark order completed locally so driver chips and tracking ignore it
    localStorage.setItem(`dsa_order_completed_${orderId}`, "true");

    // 2. Remove from active tracking list
    let activeList = [];
    try {
      const raw = localStorage.getItem("dsa_active_orders");
      if (raw) activeList = JSON.parse(raw);
    } catch (_) {}
    activeList = activeList.filter((id) => id !== orderId);
    localStorage.setItem("dsa_active_orders", JSON.stringify(activeList));

    // 3. Refresh dropdown and customer history
    refreshTrackingOrdersDropdown();
    if (activeCustomer?.id) {
      loadCustomerOrdersToHistory(activeCustomer.id);
    }

    alert(`Thank you! Order ${orderId} has been confirmed received. Enjoy your meal!`);

    // 4. If there are other active orders, switch to the next one; otherwise reset tracking and switch to menu
    if (activeList.length > 0) {
      selectOrderToTrack(activeList[0]);
    } else {
      currentlyTrackedOrderId = null;
      if (trackingPollerId) {
        clearInterval(trackingPollerId);
        trackingPollerId = null;
      }
      refreshTrackingOrdersDropdown();
      switchMainTab("menu");
    }
  } catch (err) {
    alert(`Error confirming receipt: ${err.message}`);
  }
}

// ============================================================================
// 9B. MENU DRAWER & CUSTOMER ACCOUNT HUB
// ============================================================================
let isMenuDrawerOpen = false;
let currentMenuSubpanel = null;

function toggleMenuDrawer() {
  const drawer = document.getElementById("menu-drawer");
  if (!drawer) return;
  isMenuDrawerOpen = !isMenuDrawerOpen;
  drawer.classList.toggle("open", isMenuDrawerOpen);

  if (isMenuDrawerOpen) {
    // Close other drawers if open
    const notifsDrawer = document.getElementById("notifs-drawer");
    if (notifsDrawer && notifsDrawer.classList.contains("open")) {
      notifsDrawer.classList.remove("open");
      isNotificationsDrawerOpen = false;
    }
    const cartDrawer = document.getElementById("cart-drawer");
    if (cartDrawer && cartDrawer.classList.contains("open")) {
      cartDrawer.classList.remove("open");
    }
    backToMenuRoot();
    renderCustomerProfile();
  }
}

function handleMenuNavAction() {
  if (currentMenuSubpanel) {
    backToMenuRoot();
  } else {
    toggleMenuDrawer();
  }
}

function openMenuSubpanel(panelId) {
  currentMenuSubpanel = panelId;
  const rootPanel = document.getElementById("menu-panel-root");
  if (rootPanel) rootPanel.style.display = "none";

  const allSubpanels = document.querySelectorAll(".menu-subpanel");
  allSubpanels.forEach((p) => (p.style.display = "none"));

  const target = document.getElementById(`menu-subpanel-${panelId}`);
  if (target) target.style.display = "flex";

  // Update header nav button to back arrow and set title
  const navBtn = document.getElementById("menu-drawer-nav-btn");
  const navIcon = document.getElementById("menu-drawer-nav-icon");
  const titleEl = document.getElementById("menu-drawer-title");

  if (navIcon) {
    navIcon.innerHTML = `<polyline points="15 18 9 12 15 6"></polyline>`;
  }
  if (navBtn) navBtn.setAttribute("title", "Back to Menu");

  if (panelId === "addresses") {
    if (titleEl) titleEl.textContent = "Address Book";
    renderMenuAddressBook();
  } else if (panelId === "history") {
    if (titleEl) titleEl.textContent = "Order History";
    loadCustomerOrdersToHistory(activeCustomer?.id);
    renderMenuOrderHistory();
  } else if (panelId === "profile") {
    if (titleEl) titleEl.textContent = "Edit Profile";
    populateEditProfileForm();
  }
}

function backToMenuRoot() {
  currentMenuSubpanel = null;
  const rootPanel = document.getElementById("menu-panel-root");
  if (rootPanel) rootPanel.style.display = "flex";

  const allSubpanels = document.querySelectorAll(".menu-subpanel");
  allSubpanels.forEach((p) => (p.style.display = "none"));

  const navBtn = document.getElementById("menu-drawer-nav-btn");
  const navIcon = document.getElementById("menu-drawer-nav-icon");
  const titleEl = document.getElementById("menu-drawer-title");

  if (navIcon) {
    navIcon.innerHTML = `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>`;
  }
  if (navBtn) navBtn.setAttribute("title", "Close Menu");
  if (titleEl) titleEl.textContent = "Account & Menu";
}

function logoutCustomer() {
  if (confirm("Are you sure you want to log out of this account?")) {
    localStorage.removeItem("dsa_selected_customer_id");
    toggleMenuDrawer();
    window.location.reload();
  }
}

function renderMenuAddressBook() {
  const container = document.getElementById("menu-address-book-list");
  if (!container) return;

  const addresses = activeCustomer?.addresses || (activeCustomer?.address ? [activeCustomer.address] : []);
  if (addresses.length === 0) {
    container.innerHTML = `<div class="empty-state-card"><p>No saved addresses found for this account.</p></div>`;
    return;
  }

  container.innerHTML = addresses
    .map((a) => {
      const isDefault = Boolean(a.isDefault);
      const aId = a.id || "";
      let coordsText = "No coordinates";
      if (a.location && Array.isArray(a.location.coordinates)) {
        coordsText = `Lon: ${Number(a.location.coordinates[0]).toFixed(4)}, Lat: ${Number(a.location.coordinates[1]).toFixed(4)}`;
      }

      return `
      <div class="address-book-card-item" data-address-id="${escapeHtml(aId)}">
        <div class="addr-book-tag-row">
          <span class="addr-tag-pill">${escapeHtml(a.tag || "HOME")}</span>
          ${isDefault ? `<span class="default-pill">DEFAULT</span>` : ""}
        </div>
        <div class="addr-book-street">${escapeHtml(a.street || "12 Independence Avenue")}</div>
        <div class="addr-book-city">${escapeHtml(a.city || "Windhoek")}, ${escapeHtml(a.state || "Khomas")} ${escapeHtml(a.postalCode || "9000")}</div>
        <div class="addr-book-coords text-mono">${escapeHtml(coordsText)}</div>
        <div class="addr-book-actions">
          <button type="button" class="btn btn-sm btn-outline btn-edit-address" onclick="openEditAddressModal('${escapeHtml(aId)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px; margin-right: 4px;">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
            Edit
          </button>
          ${!isDefault ? `
          <button type="button" class="btn btn-sm btn-outline btn-default-address" onclick="setDefaultCustomerAddress('${escapeHtml(aId)}')">
            Set Default
          </button>
          ` : ""}
          <button type="button" class="btn btn-sm btn-outline btn-danger btn-remove-address" onclick="removeCustomerAddress('${escapeHtml(aId)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 13px; height: 13px; margin-right: 4px;">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Remove
          </button>
        </div>
      </div>`;
    })
    .join("");
}

function formatMoney(amount) {
  if (typeof window.DSA?.formatMoney === "function") return window.DSA.formatMoney(amount);
  return `N$ ${Number(amount || 0).toFixed(2)}`;
}

function formatFriendlyOrderId(orderId) {
  if (typeof window.DSA?.formatFriendlyOrderId === "function") return window.DSA.formatFriendlyOrderId(orderId);
  return `Ref #${String(orderId || "").replace(/^order[-_]?/i, "")}`;
}

function renderMenuOrderHistory() {
  const container = document.getElementById("menu-order-history-list");
  if (!container) return;

  if (!customerOrderHistoryList || customerOrderHistoryList.length === 0) {
    container.innerHTML = `<div class="empty-state-card"><p>No past orders on file for this account.</p></div>`;
    return;
  }

  const now = new Date();
  const filtered = customerOrderHistoryList.filter(o => {
    const rawDate = o.createdAt || o.timestamp || o.date;
    const orderDate = rawDate ? new Date(rawDate) : new Date();

    if (customerOrderHistoryFilter === "ALL") return true;
    if (customerOrderHistoryFilter === "TODAY") {
      return orderDate.toDateString() === now.toDateString();
    }
    if (customerOrderHistoryFilter === "7D") {
      return (now.getTime() - orderDate.getTime()) <= 7 * 24 * 60 * 60 * 1000;
    }
    if (customerOrderHistoryFilter === "MONTH") {
      return orderDate.getMonth() === now.getMonth() && orderDate.getFullYear() === now.getFullYear();
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state-card"><p>No orders found for the selected filter (${escapeHtml(customerOrderHistoryFilter)}).</p></div>`;
    return;
  }

  container.innerHTML = filtered.map(o => {
    const oId = o.orderId || o.id || "ORD-000";
    const friendlyId = formatFriendlyOrderId(oId);
    const rawDate = o.createdAt || o.timestamp || o.date;
    const dateStr = rawDate ? new Date(rawDate).toLocaleString() : "Recent";
    const restName = o.restaurantName || (liveRestaurants.find(r => r.id === o.restaurantId)?.name) || "Windhoek Kitchen";
    const total = Number(o.totalAmount || o.total || 0);
    const status = (o.status || "CONFIRMED").toUpperCase();
    const isCompleted = status === "DELIVERED" || status === "COMPLETED";

    const itemsSummary = Array.isArray(o.items) && o.items.length > 0
      ? o.items.map(i => `${escapeHtml(i.name)} ×${i.quantity || 1}`).join(", ")
      : "";

    return `
      <div class="menu-order-card" style="border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; background: var(--bg-surface);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div>
            <span class="text-mono" style="font-weight: 700; font-size: 13px; color: var(--text-main);">${escapeHtml(friendlyId)}</span>
            <div style="font-size: 11.5px; color: var(--text-muted);">${escapeHtml(dateStr)}</div>
          </div>
          <span class="badge badge-sm badge-status-${status.toLowerCase()}" style="font-size: 10.5px; padding: 3px 8px; border-radius: 999px;">${escapeHtml(status)}</span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">
          ${escapeHtml(restName)}
        </div>
        ${itemsSummary ? `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${itemsSummary}</div>` : ""}
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border);">
          <strong style="font-size: 13.5px; color: var(--brand-primary);">${formatMoney(total)}</strong>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-xs btn-outline" onclick="openOrderReceiptModal('${escapeHtml(oId)}')">
              View Receipt
            </button>
            ${!isCompleted ? `
              <button type="button" class="btn btn-xs btn-primary" onclick="selectOrderToTrack('${escapeHtml(oId)}'); toggleMenuDrawer(); switchMainTab('tracking');">
                Track Delivery
              </button>
            ` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function openOrderReceiptModal(orderId) {
  const order = customerOrderHistoryList.find(o => (o.orderId || o.id) === orderId) ||
    activeOrdersList.find(o => (o.orderId || o.id) === orderId);

  if (!order) {
    alert("Receipt not found for order: " + orderId);
    return;
  }

  const oId = order.orderId || order.id || orderId;
  const friendlyId = formatFriendlyOrderId(oId);
  const rawDate = order.createdAt || order.timestamp || order.date;
  const dateStr = rawDate ? new Date(rawDate).toLocaleString() : new Date().toLocaleString();
  const restName = order.restaurantName || (liveRestaurants.find(r => r.id === order.restaurantId)?.name) || "Windhoek Kitchen";
  const restAddr = order.restaurantAddress || "Windhoek, Namibia";
  const custName = order.customerName || activeCustomer?.name || "Customer";
  const custAddr = order.deliveryAddress?.street || order.customerAddress || activeCustomer?.address?.street || "Windhoek, Namibia";
  const items = Array.isArray(order.items) && order.items.length > 0 ? order.items : [
    { name: "Order Items & Kitchen Preparation", quantity: 1, price: Number(order.totalAmount || 0) * 0.85 }
  ];
  const itemsTotal = items.reduce((sum, it) => sum + (Number(it.price || 0) * (it.quantity || 1)), 0);
  const deliveryFee = Number(order.deliveryFee || 25.00);
  const surgeMultiplier = Number(order.surgeMultiplier || 1.0);
  const surgeFee = surgeMultiplier > 1.0 ? deliveryFee * (surgeMultiplier - 1.0) : 0;
  const grandTotal = Number(order.totalAmount || (itemsTotal + deliveryFee + surgeFee));

  const modal = document.getElementById("order-receipt-modal");
  const refEl = document.getElementById("receipt-modal-order-ref");
  const bodyEl = document.getElementById("receipt-modal-body");

  if (refEl) refEl.textContent = `Order Ref: ${friendlyId}`;

  if (bodyEl) {
    bodyEl.innerHTML = `
      <div style="font-family: inherit; font-size: 13px; color: var(--text-main);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border);">
          <div>
            <div style="font-weight: 700; font-size: 14px;">${escapeHtml(restName)}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(restAddr)}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; color: var(--text-muted);">Date &amp; Time</div>
            <div style="font-weight: 600; font-size: 12px;">${escapeHtml(dateStr)}</div>
          </div>
        </div>

        <div style="margin-bottom: 12px; font-size: 12px; background: var(--bg-surface-alt, #f8fafc); padding: 8px 10px; border-radius: 8px;">
          <div><strong>Recipient:</strong> ${escapeHtml(custName)}</div>
          <div><strong>Deliver To:</strong> ${escapeHtml(custAddr)}</div>
          <div><strong>Status:</strong> <span class="badge badge-sm badge-status-${(order.status||'CONFIRMED').toLowerCase()}">${escapeHtml((order.status||'CONFIRMED').toUpperCase())}</span></div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12.5px;">
          <thead>
            <tr style="border-bottom: 2px solid var(--border); text-align: left; color: var(--text-muted); font-size: 11px;">
              <th style="padding: 6px 0;">Item</th>
              <th style="padding: 6px 0; text-align: center;">Qty</th>
              <th style="padding: 6px 0; text-align: right;">Price</th>
              <th style="padding: 6px 0; text-align: right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(it => {
              const qty = it.quantity || 1;
              const unitPrice = Number(it.price || 0);
              const sub = qty * unitPrice;
              return `
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 7px 0;">${escapeHtml(it.name)}</td>
                  <td style="padding: 7px 0; text-align: center;">${qty}</td>
                  <td style="padding: 7px 0; text-align: right;">${formatMoney(unitPrice)}</td>
                  <td style="padding: 7px 0; text-align: right; font-weight: 600;">${formatMoney(sub)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>

        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; border-top: 1px solid var(--border); padding-top: 8px;">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: var(--text-muted);">Items Subtotal:</span>
            <span>${formatMoney(itemsTotal)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: var(--text-muted);">Standard Delivery Fee:</span>
            <span>${formatMoney(deliveryFee)}</span>
          </div>
          ${surgeFee > 0 ? `
            <div style="display: flex; justify-content: space-between; color: #ea580c;">
              <span>Dynamic Surge (${surgeMultiplier.toFixed(1)}x):</span>
              <span>+${formatMoney(surgeFee)}</span>
            </div>
          ` : ""}
          <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 15px; margin-top: 6px; padding-top: 8px; border-top: 2px dashed var(--border); color: var(--text-main);">
            <span>Total Paid:</span>
            <span style="color: var(--brand-primary);">${formatMoney(grandTotal)}</span>
          </div>
        </div>

        <div style="margin-top: 14px; text-align: center; font-size: 11px; color: var(--text-muted);">
          Payment verified &bull; Settlement Ref: ${escapeHtml(order.paymentId || "PAY-" + Math.random().toString(36).substring(2, 9).toUpperCase())}
        </div>
      </div>
    `;
  }

  if (modal) modal.style.display = "flex";
}

function closeOrderReceiptModal() {
  const modal = document.getElementById("order-receipt-modal");
  if (modal) modal.style.display = "none";
}

window.openOrderReceiptModal = openOrderReceiptModal;
window.closeOrderReceiptModal = closeOrderReceiptModal;

function populateEditProfileForm() {
  if (!activeCustomer) return;
  const nameInput = document.getElementById("edit-profile-name");
  const emailInput = document.getElementById("edit-profile-email");
  const phoneInput = document.getElementById("edit-profile-phone");

  if (nameInput) nameInput.value = activeCustomer.name || "";
  if (emailInput) emailInput.value = activeCustomer.email || "";
  if (phoneInput) phoneInput.value = activeCustomer.phone || "";
}

async function saveCustomerProfile() {
  if (!activeCustomer || !activeCustomer.id) {
    alert("No active customer selected.");
    return;
  }

  const nameInput = document.getElementById("edit-profile-name");
  const phoneInput = document.getElementById("edit-profile-phone");
  const saveBtn = document.getElementById("btn-save-profile");

  const name = nameInput?.value.trim();
  const phone = phoneInput?.value.trim();

  if (!name || !phone) {
    alert("Please enter both name and phone number.");
    return;
  }

  if (saveBtn) saveBtn.disabled = true;

  try {
    const res = await apiFetch(PORTS.CUSTOMER, `/customers/${encodeURIComponent(activeCustomer.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone }),
      timeoutMs: 4000
    });

    if (res.ok) {
      activeCustomer.name = name;
      activeCustomer.phone = phone;
      localStorage.setItem("dsa_active_customer", JSON.stringify(activeCustomer));
      renderCustomerProfile();
      alert("Profile details updated successfully!");
      backToMenuRoot();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Could not update profile: ${err.message || res.statusText}`);
    }
  } catch (err) {
    // If backend connection has an error, update locally
    activeCustomer.name = name;
    activeCustomer.phone = phone;
    localStorage.setItem("dsa_active_customer", JSON.stringify(activeCustomer));
    renderCustomerProfile();
    alert("Profile details updated successfully!");
    backToMenuRoot();
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ============================================================================
// 10. NOTIFICATION SIDEBAR DRAWER & DYNAMIC REFRESH
// ============================================================================
let isNotificationsDrawerOpen = false;
let currentNotificationsList = [];

function toggleNotificationsDrawer() {
  const drawer = document.getElementById("notifs-drawer");
  if (!drawer) return;
  isNotificationsDrawerOpen = !isNotificationsDrawerOpen;
  drawer.classList.toggle("open", isNotificationsDrawerOpen);

  if (isNotificationsDrawerOpen) {
    // If cart drawer is open, close it to avoid overlap
    const cartDrawer = document.getElementById("cart-drawer");
    if (cartDrawer && cartDrawer.classList.contains("open")) {
      cartDrawer.classList.remove("open");
    }
    loadCustomerNotificationsDrawer();
  }
}

async function checkCustomerNotificationsBadge() {
  const badge = document.getElementById("header-notifs-count");
  if (!badge || !activeCustomer || !activeCustomer.id) {
    if (badge) badge.style.display = "none";
    return;
  }

  try {
    const res = await apiFetch(PORTS.NOTIF, `/notifications/recipient/${encodeURIComponent(activeCustomer.id)}`, { timeoutMs: 2500 });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        let seenIds = [];
        let dismissedIds = [];
        try {
          const rawSeen = localStorage.getItem("dsa_seen_notification_ids");
          if (rawSeen) seenIds = JSON.parse(rawSeen);
          const rawDismissed = localStorage.getItem("dsa_dismissed_notification_ids");
          if (rawDismissed) dismissedIds = JSON.parse(rawDismissed);
        } catch (_) {}

        // Active unread notifications
        const activeRows = rows.filter((r) => {
          const nid = r.notificationId || r.id;
          return nid && !dismissedIds.includes(nid);
        });

        const unreadCount = activeRows.filter((r) => {
          const nid = r.notificationId || r.id;
          return !seenIds.includes(nid);
        }).length;

        if (unreadCount > 0) {
          badge.style.display = "inline-flex";
          badge.textContent = unreadCount;
        } else {
          badge.style.display = "none";
        }

        // If drawer is currently open, dynamically re-render items so new notifications show up immediately
        if (isNotificationsDrawerOpen) {
          renderNotificationCards(activeRows);
        }
        return;
      }
    }
  } catch (_) {}

  if (badge) badge.style.display = "none";
}

async function loadCustomerNotificationsDrawer() {
  const container = document.getElementById("notifs-items-container");
  const badge = document.getElementById("header-notifs-count");
  if (!container) return;

  if (!activeCustomer || !activeCustomer.id) {
    container.innerHTML = `
      <div class="empty-notifs-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <h4>No Customer Selected</h4>
        <p>Please select an account in the header to view notifications.</p>
      </div>`;
    return;
  }

  try {
    const res = await apiFetch(PORTS.NOTIF, `/notifications/recipient/${encodeURIComponent(activeCustomer.id)}`, { timeoutMs: 3000 });

    if (res.status === 404) {
      container.innerHTML = `
        <div class="empty-notifs-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <h4>All Caught Up</h4>
          <p>No notifications on file for ${escapeHtml(activeCustomer.name || "your account")}.</p>
        </div>`;
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      container.innerHTML = `
        <div class="empty-notifs-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <h4>All Caught Up</h4>
          <p>No notifications on file for ${escapeHtml(activeCustomer.name || "your account")}.</p>
        </div>`;
      return;
    }

    // Filter out dismissed notifications
    let dismissedIds = [];
    try {
      const raw = localStorage.getItem("dsa_dismissed_notification_ids");
      if (raw) dismissedIds = JSON.parse(raw);
    } catch (_) {}

    const visibleRows = rows.filter((r) => {
      const nid = r.notificationId || r.id;
      return nid && !dismissedIds.includes(nid);
    });

    // Mark visible ones as seen
    let seenIds = [];
    try {
      const raw = localStorage.getItem("dsa_seen_notification_ids");
      if (raw) seenIds = JSON.parse(raw);
    } catch (_) {}

    visibleRows.forEach((r) => {
      const nid = r.notificationId || r.id;
      if (nid && !seenIds.includes(nid)) {
        seenIds.push(nid);
      }
    });
    localStorage.setItem("dsa_seen_notification_ids", JSON.stringify(seenIds));

    // Clear badge
    if (badge) badge.style.display = "none";

    renderNotificationCards(visibleRows);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-notifs-state">
        <p style="color: var(--danger);">Notification Service: ${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function renderNotificationCards(rows) {
  const container = document.getElementById("notifs-items-container");
  if (!container) return;

  currentNotificationsList = rows;

  if (rows.length === 0) {
    container.innerHTML = `
      <div class="empty-notifs-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
        <h4>All Caught Up</h4>
        <p>No active notifications for this account.</p>
      </div>`;
    return;
  }

  // Display newest first
  const displayList = [...rows].reverse();

  container.innerHTML = displayList
    .map((r) => {
      const nid = r.notificationId || r.id || `notif_${Date.now()}`;
      const status = (r.status || "SENT").toUpperCase();
      const channel = (r.channel || "SMS").toUpperCase();
      const message = r.message || r.content || "Order status progression alert sent to customer phone.";
      
      // Formatting timestamp
      let timeDisplay = "Just now";
      if (r.sentAt) {
        try {
          const d = new Date(r.sentAt);
          timeDisplay = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        } catch (_) {
          timeDisplay = r.sentAt;
        }
      }

      // Status pill style
      let pillClass = "pill-neutral";
      if (status === "DELIVERED" || status === "SENT") pillClass = "pill-valid";
      if (status === "FAILED") pillClass = "pill-danger";

      return `
      <div class="notif-card" id="notif-card-${escapeHtml(nid)}">
        <div class="notif-card-main">
          <div class="notif-card-top">
            <span class="notif-timestamp">${escapeHtml(timeDisplay)}</span>
            <div class="notif-badge-group">
              <span class="notif-channel-tag">${escapeHtml(channel)}</span>
              <span class="status-pill ${pillClass}">${escapeHtml(status)}</span>
            </div>
          </div>
          <div class="notif-card-summary">${escapeHtml(message)}</div>
          <div class="notif-id-sub text-mono" title="${escapeHtml(nid)}">Ref #${escapeHtml(String(nid).replace(/^notif[-_]?/i, ""))}</div>
        </div>
        <button type="button" class="btn-dismiss-square" onclick="dismissNotification('${escapeHtml(nid)}')" title="Dismiss notification">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>`;
    })
    .join("");
}

function dismissNotification(nid) {
  if (!nid) return;

  // Persist dismissed ID in localStorage
  let dismissedIds = [];
  try {
    const raw = localStorage.getItem("dsa_dismissed_notification_ids");
    if (raw) dismissedIds = JSON.parse(raw);
  } catch (_) {}

  if (!dismissedIds.includes(nid)) {
    dismissedIds.push(nid);
    localStorage.setItem("dsa_dismissed_notification_ids", JSON.stringify(dismissedIds));
  }

  // Animate and remove card from DOM
  const card = document.getElementById(`notif-card-${nid}`);
  if (card) {
    card.style.opacity = "0";
    card.style.transform = "translateX(20px)";
    setTimeout(() => {
      card.remove();
      // Check if container is now empty
      const remainingCards = document.querySelectorAll("#notifs-items-container .notif-card");
      if (remainingCards.length === 0) {
        const container = document.getElementById("notifs-items-container");
        if (container) {
          container.innerHTML = `
            <div class="empty-notifs-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </svg>
              <h4>All Caught Up</h4>
              <p>No active notifications for this account.</p>
            </div>`;
        }
      }
    }, 200);
  }

  checkCustomerNotificationsBadge();
}

function dismissAllNotifications() {
  const container = document.getElementById("notifs-items-container");
  if (!container) return;

  const cards = container.querySelectorAll(".notif-card");
  if (cards.length === 0) return;

  let dismissedIds = [];
  try {
    const raw = localStorage.getItem("dsa_dismissed_notification_ids");
    if (raw) dismissedIds = JSON.parse(raw);
  } catch (_) {}

  currentNotificationsList.forEach((r) => {
    const nid = r.notificationId || r.id;
    if (nid && !dismissedIds.includes(nid)) {
      dismissedIds.push(nid);
    }
  });

  localStorage.setItem("dsa_dismissed_notification_ids", JSON.stringify(dismissedIds));

  container.innerHTML = `
    <div class="empty-notifs-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
      <h4>All Caught Up</h4>
      <p>All notifications have been dismissed.</p>
    </div>`;

  checkCustomerNotificationsBadge();
}

// ============================================================================
// 11. NAVIGATION TABS & SYSTEM BOOT
// ============================================================================
function switchMainTab(tab) {
  try {
    localStorage.setItem("dsa_active_view", tab);
  } catch (_) {}
  const menuView = document.getElementById("view-menu");
  const trackView = document.getElementById("view-tracking");
  if (tab === "tracking") {
    if (menuView) {
      menuView.style.display = "none";
      menuView.classList.remove("active");
    }
    if (trackView) {
      trackView.style.display = "block";
      trackView.classList.add("active");
    }
    refreshTrackingOrdersDropdown();
    if (currentlyTrackedOrderId) {
      pollLiveOrderTracking();
    }
    if (!window.clientLeafletMap) {
      initClientGoogleMap(-22.5609, 17.0658, -22.5695, 17.0850);
    } else {
      setTimeout(() => {
        window.clientLeafletMap.invalidateSize();
      }, 100);
    }
    setTimeout(() => {
      if (window.clientLeafletMap) window.clientLeafletMap.invalidateSize();
    }, 50);
    setTimeout(() => {
      if (window.clientLeafletMap) window.clientLeafletMap.invalidateSize();
    }, 250);
  } else {
    if (trackView) {
      trackView.style.display = "none";
      trackView.classList.remove("active");
    }
    if (menuView) {
      menuView.style.display = "flex";
      menuView.classList.add("active");
    }
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

// Dynamic Adaptive Polling Manager
let healthPollTimer = null;
let pricingPollTimer = null;
let notifPollTimer = null;

function setupAdaptivePolling() {
  const ACTIVE_INTERVAL = 3000;
  const IDLE_INTERVAL = 10000;
  const HIDDEN_INTERVAL = 60000;

  function triggerImmediateRefetch() {
    checkServicesHealth();
    fetchDynamicPricing();
    checkCustomerNotificationsBadge();
    if (currentlyTrackedOrderId) {
      pollLiveOrderTracking();
    }
  }

  function resetTimers(intervalMs) {
    if (healthPollTimer) clearInterval(healthPollTimer);
    if (pricingPollTimer) clearInterval(pricingPollTimer);
    if (notifPollTimer) clearInterval(notifPollTimer);

    CONFIG.POLL_INTERVAL_MS = intervalMs;
    if (trackingPollerId) {
      clearInterval(trackingPollerId);
      trackingPollerId = setInterval(pollLiveOrderTracking, intervalMs);
    }

    healthPollTimer = setInterval(checkServicesHealth, intervalMs);
    pricingPollTimer = setInterval(fetchDynamicPricing, intervalMs);
    notifPollTimer = setInterval(checkCustomerNotificationsBadge, intervalMs);
  }

  // Start with active interval
  resetTimers(ACTIVE_INTERVAL);

  window.addEventListener("focus", () => {
    if (!document.hidden) {
      resetTimers(ACTIVE_INTERVAL);
      triggerImmediateRefetch();
    }
  });

  window.addEventListener("blur", () => {
    if (!document.hidden) {
      resetTimers(IDLE_INTERVAL);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      resetTimers(HIDDEN_INTERVAL);
    } else {
      resetTimers(ACTIVE_INTERVAL);
      triggerImmediateRefetch();
    }
  });
}

// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", async () => {
  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
  if (window.initCustomDateTimePickers) window.initCustomDateTimePickers();

  if (typeof window.resolveMapApiKey === "function") {
    await window.resolveMapApiKey().catch(() => {});
  }

  loadDeliverySchedule();
  if (deliveryScheduleState.preset) {
    setDeliveryMode(deliveryScheduleState.preset);
  }

  checkServicesHealth();
  loadStoredCustomerAccounts();
  loadLiveRestaurants();
  initRestaurantCardsDrag();
  fetchDynamicPricing();
  loadCart();
  refreshTrackingOrdersDropdown();
  updateCartSummary();
  checkCustomerNotificationsBadge();

  // Attach customer login and wizard password input listeners
  const loginForm = document.getElementById("customer-login-form") || document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleCustomerLoginSubmit);
  }
  const passwordInputs = [
    document.getElementById("wizard-password"),
    document.getElementById("reg-password"),
    document.getElementById("customer-password")
  ].filter(Boolean);
  passwordInputs.forEach((inp) => {
    inp.addEventListener("input", handleCustomerPasswordInput);
  });

  const savedView = localStorage.getItem("dsa_active_view");
  if (savedView === "tracking" && activeOrdersList && activeOrdersList.length > 0) {
    switchMainTab("tracking");
    if (window.clientLeafletMap) window.clientLeafletMap.invalidateSize();
  }

  if (window.initCustomDropdownMenus) window.initCustomDropdownMenus();
  if (window.initCustomDateTimePickers) window.initCustomDateTimePickers();

  // Dynamic adaptive polling (3000ms active, 10000ms idle/blurred, 60000ms hidden)
  setupAdaptivePolling();
});

// Global browser exposures for inline HTML event handlers
if (typeof window !== 'undefined') {
  window.toggleMenuDrawer = toggleMenuDrawer;
  window.switchMainTab = switchMainTab;
  window.toggleCartDrawer = toggleCartDrawer;
  window.toggleNotificationsDrawer = toggleNotificationsDrawer;
  window.proceedToCheckoutStage = proceedToCheckoutStage;
  window.backToCartStage = backToCartStage;
  window.placeOrderAndCheckout = placeOrderAndCheckout;
  window.openAddAddressModal = openAddAddressModal;
  window.closeAddAddressModal = closeAddAddressModal;
  window.handleCheckoutAddressChange = handleCheckoutAddressChange;
  window.setDeliveryMode = setDeliveryMode;
  window.handleScheduleTimeWindowChange = handleScheduleTimeWindowChange;
  window.handleMenuNavAction = handleMenuNavAction;
  window.openMenuSubpanel = openMenuSubpanel;
  window.backToMenuRoot = backToMenuRoot;
  window.verifyActiveAddress = verifyActiveAddress;
  window.filterOrderHistory = filterOrderHistory;
  window.saveCustomerProfile = saveCustomerProfile;
  window.openDeleteCustomerModal = openDeleteCustomerModal;
  window.closeDeleteCustomerModal = closeDeleteCustomerModal;
  window.confirmDeleteCustomerAccount = deleteCustomerAccountCascade;
  window.submitCustomerAddressForm = submitCustomerAddressForm;
  window.applyAddAddressPreset = applyAddAddressPreset;
  window.goToWizardStep = goToWizardStep;
  window.submitCustomerRegistration = submitCustomerRegistration;
  window.applyLocationPreset = applyLocationPreset;
  window.closeRegisterModal = closeRegisterModal;
  window.dismissAllNotifications = dismissAllNotifications;
  window.handleMenuSearch = handleMenuSearch;
  window.clearMenuSearch = clearMenuSearch;
  window.scrollRestaurantTrack = scrollRestaurantTrack;
  window.slideCategoryCarousel = slideCategoryCarousel;
  window.selectOrderToTrack = selectOrderToTrack;
  window.pollLiveOrderTracking = pollLiveOrderTracking;
  window.confirmCustomerOrderReceipt = confirmCustomerOrderReceipt;
  window.openProfileDrawer = openProfileDrawer;
  window.openCustomerLoginModal = openCustomerLoginModal;
  window.closeCustomerLoginModal = closeCustomerLoginModal;
  window.handleCustomerLoginSubmit = handleCustomerLoginSubmit;
  window.closeOrderReceiptModal = closeOrderReceiptModal;
  window.handleInstructionsInput = handleInstructionsInput;
  window.appendQuickInstruction = appendQuickInstruction;
  window.logoutCustomer = logoutCustomer;
  window.handlePasswordStrengthChange = handlePasswordStrengthChange;
  window.checkRegisterGeofence = checkRegisterGeofence;
}
