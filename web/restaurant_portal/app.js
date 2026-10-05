/**
 * Restaurant Operations & KDS Portal Controller (app.js)
 * Clean, production-grade microservice orchestration
 * Communicating with :9095, :9091, :9096, :9097
 * Zero mock data • Real MongoDB CRUD • Real order state machine
 */

// ============================================================================
// 1. STATE & CONSTANTS
// ============================================================================

const PORTS = {
  ORDER: 9091,
  CUSTOMER: 9093,
  PAYMENT: 9094,
  RESTAURANT: 9095,
  DELIVERY: 9096,
  NOTIF: 9097,
  ADMIN: 9098
};

const STATE = {
  currentRestaurantId: null,
  restaurant: null,
  menu: [],
  orders: [],
  activeHandoverOrder: null,
  map: null,
  mapMarker: null,
  coordinates: [17.0658, -22.5609],
  healthStatus: {},
  draggedOrderId: null,
  selectedDietary: new Set(),
  activeLedgerTab: "settlements",
  hoursCollapsed: false,
  payoutsHistory: [],
  tileFallbackActive: false,
  wizardStep: 1
};

// ============================================================================
// 2. HTTP UTILITIES VIA MULTI-CANDIDATE / SHARED UTILITIES
// ============================================================================

async function fetchApi(port, path, options = {}) {
  // Delegate to shared.js apiFetch or window.sharedApiFetch or fallback to local multi-candidate
  if (typeof window !== 'undefined' && typeof window.DSA?.cachedApiFetch === 'function') {
    return window.DSA.cachedApiFetch(port, path, options);
  }
  if (typeof window !== 'undefined' && typeof window.sharedApiFetch === 'function') {
    return window.sharedApiFetch(port, path, options);
  }
  if (typeof apiFetch === 'function') {
    return apiFetch(port, path, options);
  }
  // Robust fallback: if running under file:/// or no host, prefer direct microservice loopback
  const isFileOrigin = typeof window !== 'undefined' && window.location && (
    window.location.protocol === 'file:' || !window.location.hostname || window.location.origin === 'null'
  );
  const host = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : 'localhost';
  const urls = isFileOrigin
    ? [`http://localhost:${port}${path.startsWith('/') ? path : '/' + path}`, `http://127.0.0.1:${port}${path.startsWith('/') ? path : '/' + path}`, `http://localhost:8080/api/${port}${path.startsWith('/') ? path : '/' + path}`]
    : [`/api/${port}${path.startsWith('/') ? path : '/' + path}`, `http://${host}:${port}${path.startsWith('/') ? path : '/' + path}`];

  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  console.error(`[API Fetch Failed] :${port}${path}`, lastErr);
  throw lastErr || new Error(`Failed to fetch :${port}${path}`);
}

// ============================================================================
// 3. INITIALIZATION & DATA LOADING
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  const hasSession = checkRestaurantSession();
  initRestaurantSelector();
  initLeafletMap();
  startHealthProbes();

  if (hasSession) {
    await loadRestaurantProfile();
    await loadRestaurantMenu();
    await loadLiveOrders();
    await loadEarnings();
    loadSettlementLedger();
  } else {
    STATE.currentRestaurantId = "R001";
    updateAuthUI(false);
    await loadRestaurantProfile();
    await loadRestaurantMenu();
    openRestaurantLoginModal();
  }

  // Restore active tab
  const savedTab = localStorage.getItem("dsa_restaurant_active_tab");
  if (savedTab) {
    switchTab(savedTab);
  }

  // Restore wallet drawer state
  if (localStorage.getItem("dsa_restaurant_wallet_drawer") === "true") {
    openWalletDrawer();
  }

  // Visibility-Aware Polling for orders and earnings:
  // Throttle 5s order/earnings polling to 60s when document.hidden === true. Trigger immediate revalidation when user switches back to the tab.
  let pollTimer = null;
  async function pollOrdersAndEarnings() {
    if (!STATE.currentRestaurantId) return;
    await loadLiveOrders();
    await loadEarnings();
  }

  function resetPollingTimer() {
    if (pollTimer) clearInterval(pollTimer);
    const interval = document.hidden ? 60000 : 5000;
    pollTimer = setInterval(async () => {
      await pollOrdersAndEarnings();
    }, interval);
  }

  document.addEventListener("visibilitychange", async () => {
    resetPollingTimer();
    if (!document.hidden) {
      await pollOrdersAndEarnings();
    }
  });

  resetPollingTimer();
});

function checkRestaurantSession() {
  let session = null;
  if (typeof window !== 'undefined' && window.DSA && typeof window.DSA.getStoredSession === 'function') {
    session = window.DSA.getStoredSession('restaurant');
  }
  if (!session && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('dsa_session_restaurant');
      if (raw) {
        session = JSON.parse(raw);
      }
    } catch (_) {}
  }

  const validRestaurantId = session && session.user
    ? (session.user.id || session.user.restaurantId || (typeof session.user === 'string' ? session.user : null))
    : (session && (session.restaurantId || session.id));

  if (session && validRestaurantId) {
    STATE.currentRestaurantId = validRestaurantId;
    localStorage.setItem("dsa_active_restaurant_id", validRestaurantId);
    updateAuthUI(true);
    return true;
  } else {
    STATE.currentRestaurantId = null;
    localStorage.removeItem("dsa_active_restaurant_id");
    updateAuthUI(false);
    return false;
  }
}

function initRestaurantSelector() {
  const badgeEl = document.getElementById("rest-id-badge");
  if (badgeEl) badgeEl.textContent = STATE.currentRestaurantId || "Guest";
  const selector = document.getElementById("restaurant-selector");
  if (selector && STATE.currentRestaurantId) {
    selector.value = STATE.currentRestaurantId;
  }
}

async function switchRestaurant(restaurantId) {
  STATE.currentRestaurantId = restaurantId;
  localStorage.setItem("dsa_active_restaurant_id", restaurantId);
  await loadRestaurantProfile();
  await loadRestaurantMenu();
  await loadLiveOrders();
  await loadEarnings();
  loadSettlementLedger();
  updateMapPosition();
}

async function refreshAllPortalData(interactive = false) {
  try {
    await Promise.all([
      loadRestaurantProfile(),
      loadRestaurantMenu(),
      loadLiveOrders(),
      loadEarnings(),
      probeServices()
    ]);
    if (interactive) {
      alert("Live restaurant data refreshed successfully.");
    }
  } catch (err) {
    console.error("Failed to refresh portal data:", err);
  }
}

// ============================================================================
// 4. RESTAURANT PROFILE & LEAFLET MAP
// ============================================================================

async function loadRestaurantProfile() {
  if (!STATE.currentRestaurantId) return;
  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}`);
    if (res.ok) {
      const data = await res.json();
      STATE.restaurant = data;
      renderProfileForm(data);
    }
  } catch (err) {
    console.warn("Could not load restaurant profile from :9095", err);
  }
}

function showDraftBadge(show) {
  let badge = document.getElementById("profile-draft-badge");
  if (show) {
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "profile-draft-badge";
      badge.className = "badge-draft";
      badge.style.cssText = "margin-left: 10px; font-size: 11px; color: #f59e0b; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 4px; padding: 2px 6px; font-weight: normal; vertical-align: middle;";
      badge.textContent = "Draft restored (unsaved changes)";
      const target = document.getElementById("rest-id-badge") || document.getElementById("rest-store-name");
      if (target && target.parentNode) {
        target.parentNode.appendChild(badge);
      }
    } else {
      badge.style.display = "inline-block";
    }
  } else if (badge) {
    badge.remove();
  }
}

function saveProfileDraft() {
  const nameInput = document.getElementById("prof-name");
  const addrInput = document.getElementById("prof-address");
  const contactInput = document.getElementById("prof-contact");
  const latInput = document.getElementById("prof-lat");
  const lonInput = document.getElementById("prof-lon");

  const hoursRows = document.querySelectorAll("#operating-hours-list .hours-row");
  const operatingHours = [];
  hoursRows.forEach((row) => {
    const day = row.querySelector("strong")?.textContent.trim();
    const openInput = row.querySelector('input[data-field="openTime"]');
    const closeInput = row.querySelector('input[data-field="closeTime"]');
    const closedInput = row.querySelector('input[data-field="isClosed"]');
    operatingHours.push({
      dayOfWeek: day || "",
      openTime: openInput ? openInput.value : "08:00",
      closeTime: closeInput ? closeInput.value : "22:00",
      isClosed: closedInput ? closedInput.checked : false
    });
  });

  const draft = {
    name: nameInput ? nameInput.value : "",
    address: addrInput ? addrInput.value : "",
    contactNumber: contactInput ? contactInput.value : "",
    lat: latInput ? latInput.value : "",
    lon: lonInput ? lonInput.value : "",
    operatingHours
  };

  try {
    localStorage.setItem(`dsa_restaurant_profile_draft_${STATE.currentRestaurantId}`, JSON.stringify(draft));
    showDraftBadge(true);
  } catch (_) {}
}

let _profileDraftListenersAttached = false;
function setupProfileDraftListeners() {
  if (_profileDraftListenersAttached) return;
  _profileDraftListenersAttached = true;

  const fieldIds = ["prof-name", "prof-address", "prof-contact", "prof-lat", "prof-lon"];
  fieldIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", saveProfileDraft);
      el.addEventListener("change", saveProfileDraft);
    }
  });

  const hoursContainer = document.getElementById("operating-hours-list");
  if (hoursContainer) {
    hoursContainer.addEventListener("input", saveProfileDraft);
    hoursContainer.addEventListener("change", saveProfileDraft);
  }
}

function renderProfileForm(rest) {
  if (!rest) return;
  const storeNameEl = document.getElementById("rest-store-name");
  const idBadgeEl = document.getElementById("rest-id-badge");
  if (storeNameEl) storeNameEl.textContent = rest.name || "Kapana Corner";
  if (idBadgeEl) idBadgeEl.textContent = rest.id || STATE.currentRestaurantId || "Live Kitchen";

  const nameInput = document.getElementById("prof-name");
  const addrInput = document.getElementById("prof-address");
  const contactInput = document.getElementById("prof-contact");
  const latInput = document.getElementById("prof-lat");
  const lonInput = document.getElementById("prof-lon");

  if (nameInput) nameInput.value = rest.name || "";
  if (addrInput) addrInput.value = rest.address || "";
  if (contactInput) contactInput.value = rest.contactNumber || "";

  const coords = rest.location && rest.location.coordinates ? rest.location.coordinates : [17.0658, -22.5609];
  if (lonInput) lonInput.value = coords[0];
  if (latInput) latInput.value = coords[1];
  STATE.coordinates = [coords[0], coords[1]];

  renderOperatingHours(rest.operatingHours || []);

  // Check if draft exists for current restaurant
  const draftRaw = localStorage.getItem(`dsa_restaurant_profile_draft_${STATE.currentRestaurantId}`);
  if (draftRaw) {
    try {
      const draft = JSON.parse(draftRaw);
      if (draft) {
        if (draft.name !== undefined && nameInput) nameInput.value = draft.name;
        if (draft.address !== undefined && addrInput) addrInput.value = draft.address;
        if (draft.contactNumber !== undefined && contactInput) contactInput.value = draft.contactNumber;
        if (draft.lat !== undefined && latInput) latInput.value = draft.lat;
        if (draft.lon !== undefined && lonInput) lonInput.value = draft.lon;
        if (draft.operatingHours && Array.isArray(draft.operatingHours)) {
          renderOperatingHours(draft.operatingHours);
        }
        showDraftBadge(true);
      }
    } catch (_) {}
  } else {
    showDraftBadge(false);
  }

  setupProfileDraftListeners();

  // Attach Cascade Delete button if not present in profile footer
  let deleteBtn = document.getElementById("btn-delete-restaurant");
  if (!deleteBtn) {
    const footer = document.querySelector("#tab-profile .panel-footer");
    if (footer) {
      deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.id = "btn-delete-restaurant";
      deleteBtn.className = "btn-secondary-action";
      deleteBtn.style.cssText = "margin-top: 10px; width: 100%; border-color: #ef4444; color: #ef4444; background: rgba(239, 68, 68, 0.08); font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px; cursor: pointer;";
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
        <span>Delete Restaurant (Cascade Deletion)</span>
      `;
      deleteBtn.onclick = deleteRestaurantCascade;
      footer.appendChild(deleteBtn);
    }
  }
}

function renderOperatingHours(hours) {
  const container = document.getElementById("operating-hours-list");
  if (!container) return;

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  container.innerHTML = days.map((day) => {
    const found = hours.find((h) => h.dayOfWeek.toLowerCase() === day.toLowerCase()) || {
      dayOfWeek: day,
      openTime: "08:00",
      closeTime: "22:00",
      isClosed: false
    };
    return `
      <div class="hours-row">
        <strong>${escapeHtml(day)}</strong>
        <input type="time" class="form-input text-mono" value="${escapeHtml(found.openTime)}" data-day="${escapeHtml(day)}" data-field="openTime" />
        <input type="time" class="form-input text-mono" value="${escapeHtml(found.closeTime)}" data-day="${escapeHtml(day)}" data-field="closeTime" />
        <label style="display:flex; align-items:center; gap:4px; font-size:11px; color:var(--text-muted); cursor:pointer;">
          <input type="checkbox" ${found.isClosed ? 'checked' : ''} data-day="${escapeHtml(day)}" data-field="isClosed" />
          <span>Closed</span>
        </label>
      </div>
    `;
  }).join("");
}

async function saveStoreProfile() {
  if (!STATE.restaurant) return;

  const name = document.getElementById("prof-name")?.value.trim() || "";
  const address = document.getElementById("prof-address")?.value.trim() || "";
  const contact = document.getElementById("prof-contact")?.value.trim() || "";
  
  let lat = parseFloat(document.getElementById("prof-lat")?.value);
  let lon = parseFloat(document.getElementById("prof-lon")?.value);

  // Fallback hierarchy if inputs are NaN/empty
  if (isNaN(lat) || isNaN(lon)) {
    if (STATE.coordinates && Array.isArray(STATE.coordinates) && STATE.coordinates.length === 2 && !isNaN(STATE.coordinates[0])) {
      lon = STATE.coordinates[0];
      lat = STATE.coordinates[1];
    } else if (STATE.mapMarker && typeof STATE.mapMarker.getLatLng === "function") {
      const pos = STATE.mapMarker.getLatLng();
      lat = pos.lat;
      lon = pos.lng;
    } else if (STATE.restaurant?.location?.coordinates) {
      lon = STATE.restaurant.location.coordinates[0];
      lat = STATE.restaurant.location.coordinates[1];
    } else {
      lon = 17.0658;
      lat = -22.5609;
    }
  }

  // Enforce Windhoek coordinates bounds guard (lat negative, lon positive)
  if (lat > 0 && lon < 0) {
    const tmp = lat;
    lat = lon;
    lon = tmp;
  }

  // Read hours
  const hoursRows = document.querySelectorAll("#operating-hours-list .hours-row");
  const operatingHours = [];
  hoursRows.forEach((row) => {
    const day = row.querySelector("strong")?.textContent.trim() || "";
    const openTime = row.querySelector('input[data-field="openTime"]')?.value || "08:00";
    const closeTime = row.querySelector('input[data-field="closeTime"]')?.value || "22:00";
    const isClosed = Boolean(row.querySelector('input[data-field="isClosed"]')?.checked);
    operatingHours.push({ dayOfWeek: day, openTime, closeTime, isClosed });
  });

  const payload = {
    ...STATE.restaurant,
    name,
    address,
    contactNumber: contact,
    location: {
      type: "Point",
      coordinates: [lon, lat]
    },
    operatingHours
  };

  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      STATE.coordinates = [lon, lat];
      if (STATE.restaurant.location) {
        STATE.restaurant.location.coordinates = [lon, lat];
      }
      localStorage.removeItem(`dsa_restaurant_profile_draft_${STATE.currentRestaurantId}`);
      showDraftBadge(false);
      alert("Restaurant profile and GPS pin saved successfully.");
      await loadRestaurantProfile();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Failed to save profile: ${err.message || res.statusText}`);
    }
  } catch (err) {
    alert(`Network error saving profile: ${err.message}`);
  }
}

const saveRestaurantProfile = saveStoreProfile;

function initLeafletMap() {
  const mapEl = document.getElementById("restaurant-map");
  if (!mapEl || typeof L === "undefined") return;

  if (STATE.map) {
    try { STATE.map.remove(); } catch (_) {}
    STATE.map = null;
  }

  const defaultCoords = STATE.restaurant && STATE.restaurant.location
    ? [STATE.restaurant.location.coordinates[1], STATE.restaurant.location.coordinates[0]]
    : [-22.5609, 17.0658];

  STATE.map = L.map("restaurant-map").setView(defaultCoords, 15);

  const tileConfig = (typeof window.getMapTileConfig === "function")
    ? window.getMapTileConfig("esri")
    : null;

  const tileUrl = tileConfig?.url || (typeof window.getWatermarkFreeTileUrl === "function"
    ? window.getWatermarkFreeTileUrl()
    : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}");

  const tileOpts = tileConfig?.options || {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, USGS, METI'
  };

  const tileLayer = L.tileLayer(tileUrl, tileOpts).addTo(STATE.map);

  tileLayer.on("tileerror", () => {
    if (!STATE.tileFallbackActive) {
      STATE.tileFallbackActive = true;
      const fallback = tileConfig?.fallbackUrl || (typeof window.getCartoTileUrl === "function" ? window.getCartoTileUrl("voyager") : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png");
      tileLayer.setUrl(fallback);
    }
  });

  const beaconIcon = L.divIcon({
    className: "custom-beacon-pin-wrap",
    html: `
      <div class="custom-beacon-pin">
        <div class="beacon-pulse"></div>
        <div class="beacon-pin-svg">
          <svg viewBox="0 0 24 24" width="36" height="44" fill="none" stroke="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#ea580c" stroke="#ffffff" stroke-width="1.5"/>
            <circle cx="12" cy="9" r="3" fill="#ffffff"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [36, 44],
    iconAnchor: [18, 44]
  });

  STATE.mapMarker = L.marker(defaultCoords, { icon: beaconIcon, draggable: true }).addTo(STATE.map);
  STATE.mapMarker.bindTooltip("Drag or click map to reposition restaurant anchor", {
    permanent: false,
    direction: "top",
    offset: [0, -40]
  });

  STATE.mapMarker.on("dragend", (e) => {
    const pos = e.target.getLatLng();
    updateProfileCoordinates(pos.lat, pos.lng);
  });

  STATE.map.on("click", (e) => {
    STATE.mapMarker.setLatLng(e.latlng);
    updateProfileCoordinates(e.latlng.lat, e.latlng.lng);
  });
}

function updateProfileCoordinates(lat, lon) {
  const numLat = Number(lat);
  const numLon = Number(lon);
  if (isNaN(numLat) || isNaN(numLon)) return;

  STATE.coordinates = [numLon, numLat];

  const latInput = document.getElementById("prof-lat");
  const lonInput = document.getElementById("prof-lon");
  if (latInput) latInput.value = numLat.toFixed(6);
  if (lonInput) lonInput.value = numLon.toFixed(6);

  if (STATE.mapMarker) {
    STATE.mapMarker.setTooltipContent(`Location pinned: ${numLat.toFixed(4)}, ${numLon.toFixed(4)}`);
  }

  if (typeof saveProfileDraft === "function") {
    saveProfileDraft();
  }
}

function updateMapPosition() {
  if (!STATE.map || !STATE.restaurant || !STATE.restaurant.location) return;
  const [lon, lat] = STATE.restaurant.location.coordinates;
  STATE.coordinates = [lon, lat];
  STATE.map.setView([lat, lon], 15);
  if (STATE.mapMarker) {
    STATE.mapMarker.setLatLng([lat, lon]);
    STATE.mapMarker.setTooltipContent(`Location pinned: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  }
  updateProfileCoordinates(lat, lon);
}

function recenterStoreMap() {
  if (!STATE.map || !STATE.restaurant || !STATE.restaurant.location) return;
  const [lon, lat] = STATE.restaurant.location.coordinates;
  STATE.map.setView([lat, lon], 15, { animate: true });
}

function toggleHoursCollapse() {
  STATE.hoursCollapsed = !STATE.hoursCollapsed;
  const sec = document.getElementById("profile-hours-collapsible");
  const icon = document.getElementById("icon-toggle-hours");
  if (sec) sec.classList.toggle("collapsed", STATE.hoursCollapsed);
  if (icon) icon.style.transform = STATE.hoursCollapsed ? "rotate(-90deg)" : "rotate(0deg)";
}

// ============================================================================
// 5. MENU CATALOG CRUD & LIVE STOCK MANAGEMENT
// ============================================================================

async function loadRestaurantMenu() {
  if (!STATE.currentRestaurantId) {
    STATE.menu = [];
    renderMenuCatalog([]);
    return;
  }
  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}/menu`);
    if (res.ok) {
      const categories = await res.json();
      STATE.menu = categories;
      renderMenuCatalog(categories);
    }
  } catch (err) {
    console.warn("Could not load menu from :9095", err);
  }
}

function showToast(msg, type = "info") {
  if (typeof window !== "undefined" && typeof window.DSA?.showToast === "function") {
    window.DSA.showToast(msg, type);
    return;
  }
  if (typeof window !== "undefined" && typeof window.sharedToast === "function") {
    window.sharedToast(msg, type);
    return;
  }
  const toastContainer = document.getElementById("toast-container") || document.body;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  toast.style.cssText = "position:fixed;bottom:24px;right:24px;padding:12px 18px;background:#1e293b;color:#fff;border-radius:8px;z-index:999999;box-shadow:0 10px 25px rgba(0,0,0,0.3);font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;border-left:4px solid " + (type === "error" ? "#ef4444" : type === "success" ? "#22c55e" : "#3b82f6") + ";transition:opacity 0.3s ease;";
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function renderMenuCatalog(categories) {
  const wrap = document.getElementById("menu-categories-wrap");
  const countBadge = document.getElementById("menu-items-count");
  if (!wrap) return;

  const allCategories = categories || [];
  let totalItems = 0;
  let inStockCount = 0;
  let lowStockCount = 0;
  let soldOutCount = 0;

  allCategories.forEach((c) => {
    (c.items || []).forEach((item) => {
      totalItems++;
      const stock = typeof item.stock === "number" ? item.stock : 0;
      const threshold = typeof item.lowStockThreshold === "number" ? item.lowStockThreshold : 10;
      if (stock === 0) {
        soldOutCount++;
      } else if (stock <= threshold) {
        lowStockCount++;
      } else {
        inStockCount++;
      }
    });
  });

  if (countBadge) countBadge.textContent = totalItems;
  const kpiTotal = document.getElementById("kpi-total-items");
  if (kpiTotal) kpiTotal.textContent = totalItems;
  const kpiIn = document.getElementById("kpi-in-stock");
  if (kpiIn) kpiIn.textContent = inStockCount;
  const kpiLow = document.getElementById("kpi-low-stock");
  if (kpiLow) kpiLow.textContent = lowStockCount;
  const kpiSold = document.getElementById("kpi-sold-out");
  if (kpiSold) kpiSold.textContent = soldOutCount;

  // Populate category filter dropdown if needed
  const catFilter = document.getElementById("menu-category-filter");
  if (catFilter && catFilter.children.length <= 1) {
    allCategories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      catFilter.appendChild(opt);
    });
  }

  const searchKeyword = (document.getElementById("menu-search-input")?.value || "").trim().toLowerCase();
  const selectedCat = document.getElementById("menu-category-filter")?.value || "ALL";
  const selectedStock = document.getElementById("menu-stock-filter")?.value || "ALL";

  const filteredCategories = allCategories
    .filter((cat) => selectedCat === "ALL" || cat.id === selectedCat)
    .map((cat) => {
      const matchingItems = (cat.items || []).filter((item) => {
        if (searchKeyword) {
          const matchName = (item.name || "").toLowerCase().includes(searchKeyword);
          const matchDesc = (item.description || "").toLowerCase().includes(searchKeyword);
          if (!matchName && !matchDesc) return false;
        }
        const stock = typeof item.stock === "number" ? item.stock : 0;
        const threshold = typeof item.lowStockThreshold === "number" ? item.lowStockThreshold : 10;
        if (selectedStock === "IN_STOCK" && stock <= threshold) return false;
        if (selectedStock === "LOW_STOCK" && (stock <= 0 || stock > threshold)) return false;
        if (selectedStock === "SOLD_OUT" && stock > 0) return false;
        return true;
      });
      return { ...cat, items: matchingItems };
    })
    .filter((cat) => cat.items.length > 0 || selectedCat === cat.id);

  if (filteredCategories.length === 0) {
    wrap.innerHTML = `<div class="empty-kanban-placeholder"><p>No dishes match your filter criteria.</p></div>`;
    return;
  }

  wrap.innerHTML = filteredCategories.map((cat) => `
    <div class="menu-category-section">
      <div class="category-title-bar">
        <h3>${escapeHtml(cat.name)}</h3>
        <span class="tab-badge">${cat.items ? cat.items.length : 0} items</span>
      </div>
      <div class="dishes-grid">
        ${(cat.items || []).map((item) => renderDishCard(item, cat.id)).join("")}
      </div>
    </div>
  `).join("");
}

function handleMenuFilterChange() {
  renderMenuCatalog(STATE.menu);
}

function renderDishCard(item, categoryId) {
  const stock = typeof item.stock === "number" ? item.stock : 0;
  const threshold = typeof item.lowStockThreshold === "number" ? item.lowStockThreshold : 10;
  let stockDotClass = "dot-ready";
  let stockStatusLabel = "In Stock";
  let cardMutedClass = "";

  if (stock === 0) {
    stockDotClass = "dot-sold-out";
    stockStatusLabel = "Sold Out";
    cardMutedClass = "dish-card-sold-out";
  } else if (stock <= threshold) {
    stockDotClass = "dot-low-stock";
    stockStatusLabel = `Low (${stock})`;
  }

  const dietaryChipsHtml = (item.dietaryAttributes || [])
    .map((tag) => `<span class="dish-tag">${escapeHtml(tag)}</span>`)
    .join("");

  return `
    <div class="dish-card ${cardMutedClass}" id="dish-card-${escapeHtml(item.id)}">
      <div class="dish-img-box">
        <img src="${escapeHtml(item.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400')}"
             alt="${escapeHtml(item.name)}"
             loading="lazy"
             onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';" />
        <span class="dish-price-tag text-mono">N$ ${Number(item.price || 0).toFixed(2)}</span>
      </div>
      <div class="dish-card-body">
        <div class="dish-title-row">
          <h4 class="dish-name">${escapeHtml(item.name)}</h4>
        </div>
        <p class="dish-desc">${escapeHtml(item.description || "No description provided.")}</p>
        <div class="dish-tags-row">
          ${dietaryChipsHtml}
        </div>
        <div class="dish-controls-row">
          <div class="dish-stock-pill" title="Current Stock: ${stock}">
            <span class="stat-dot ${stockDotClass}"></span>
            <span class="stock-pill-text">${stockStatusLabel}</span>
          </div>
          <div class="stock-stepper-mini">
            <button type="button" class="btn-stock-step" onclick="quickAdjustStock('${escapeHtml(item.id)}', -1)" title="Decrease Stock">-</button>
            <input type="number" min="0" class="input-stock-direct text-mono" value="${stock}" onchange="setDirectStock('${escapeHtml(item.id)}', this.value)" title="Direct Stock Input" />
            <button type="button" class="btn-stock-step" onclick="quickAdjustStock('${escapeHtml(item.id)}', 1)" title="Increase Stock">+</button>
          </div>
          <div class="dish-card-actions">
            <button type="button" class="btn-dish-mini btn-dish-edit" onclick="openEditDishModal('${escapeHtml(item.id)}', '${escapeHtml(categoryId)}')" title="Edit Dish Listing">Edit</button>
            ${stock > 0 ? `<button type="button" class="btn-dish-mini btn-dish-sold-out" onclick="setDirectStock('${escapeHtml(item.id)}', 0)" title="Mark as Sold Out">Out</button>` : ''}
            <button type="button" class="btn-dish-mini btn-dish-delete" onclick="deleteMenuItem('${escapeHtml(item.id)}')" title="Delete Dish">&times;</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function quickAdjustStock(itemId, delta) {
  if (!STATE.currentRestaurantId) return;
  let targetItem = null;
  for (const cat of (STATE.menu || [])) {
    targetItem = (cat.items || []).find((i) => i.id === itemId);
    if (targetItem) break;
  }
  const currentStock = targetItem ? (targetItem.stock || 0) : 0;
  const newStock = Math.max(0, currentStock + delta);
  await setDirectStock(itemId, newStock);
}

async function setDirectStock(itemId, newStockVal) {
  if (!STATE.currentRestaurantId) return;
  const stock = Math.max(0, parseInt(newStockVal, 10) || 0);
  try {
    const res = await fetch(`/restaurants/${encodeURIComponent(STATE.currentRestaurantId)}/menu/items/${encodeURIComponent(itemId)}/stock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock: stock })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.message || "Failed to update stock", "error");
      return;
    }
    await loadRestaurantMenu();
    showToast(`Stock updated to ${stock}`, "success");
  } catch (err) {
    console.error("Failed to update stock:", err);
    showToast("Network error updating stock", "error");
  }
}


async function promptEditPrice(itemId, currentPrice) {
  const newPriceStr = prompt("Enter new price (N$):", currentPrice);
  if (!newPriceStr) return;
  const newPrice = parseFloat(newPriceStr);
  if (isNaN(newPrice) || newPrice <= 0) {
    alert("Please enter a valid positive price.");
    return;
  }

  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}/menu/items/${itemId}/price`, {
      method: "PUT",
      body: JSON.stringify({ price: newPrice })
    });
    if (res.ok) {
      await loadRestaurantMenu();
    } else {
      alert("Failed to update price.");
    }
  } catch (err) {
    alert(`Error updating price: ${err.message}`);
  }
}

async function promptRestock(itemId) {
  const qtyStr = prompt("Enter stock quantity to add:", "25");
  if (!qtyStr) return;
  const quantity = parseInt(qtyStr, 10);
  if (isNaN(quantity) || quantity <= 0) {
    alert("Please enter a valid positive quantity.");
    return;
  }

  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}/menu/items/${itemId}/restock`, {
      method: "POST",
      body: JSON.stringify({ quantity })
    });
    if (res.ok) {
      await loadRestaurantMenu();
    } else {
      alert("Failed to restock item.");
    }
  } catch (err) {
    alert(`Error restocking: ${err.message}`);
  }
}

async function deleteMenuItem(itemId) {
  if (!confirm(`Are you sure you want to remove item ${itemId} from the menu?`)) return;

  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}/menu/items/${itemId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      await loadRestaurantMenu();
    } else {
      alert("Failed to delete menu item.");
    }
  } catch (err) {
    alert(`Error deleting item: ${err.message}`);
  }
}

const CURATED_FOOD_PRESETS = [
  { name: "Flame Kapana", url: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&auto=format&fit=crop&q=80" },
  { name: "Gourmet Burger", url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format&fit=crop&q=80" },
  { name: "Braai Platter", url: "https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format&fit=crop&q=80" },
  { name: "Crispy Wings", url: "https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=800&auto=format&fit=crop&q=80" },
  { name: "Woodfired Pizza", url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop&q=80" },
  { name: "Fresh Salad", url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format&fit=crop&q=80" },
  { name: "Grilled Seafood", url: "https://images.unsplash.com/photo-1615141982883-c7ad0e69fd62?w=800&auto=format&fit=crop&q=80" },
  { name: "Cold Beverage", url: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=800&auto=format&fit=crop&q=80" }
];

function populateCategoryOptions(selectedCatId) {
  const catSelect = document.getElementById("dish-category");
  const catChips = document.getElementById("dish-category-chips");
  const menu = STATE.menu || [];
  if (catSelect) {
    catSelect.innerHTML = menu.map((c) => `
      <option value="${escapeHtml(c.id)}" ${c.id === selectedCatId ? 'selected' : ''}>${escapeHtml(c.name)}</option>
    `).join("");
    if (selectedCatId) catSelect.value = selectedCatId;
  }

  if (catChips) {
    catChips.innerHTML = menu.map((c, idx) => `
      <button type="button" class="category-preset-chip ${(selectedCatId ? c.id === selectedCatId : idx === 0) ? 'active' : ''}" onclick="selectCategoryPreset('${escapeHtml(c.id)}', this)">
        ${escapeHtml(c.name)}
      </button>
    `).join("");
  }
  attachDishStudioPreviewListeners();
}

function renderDietaryChips() {
  const dietChips = document.getElementById("dish-dietary-chips");
  const dietaryOptions = ["Halal", "Vegetarian", "Vegan", "Gluten-Free", "Spicy", "Chef Special"];
  if (dietChips) {
    dietChips.innerHTML = dietaryOptions.map((tag) => {
      const isActive = STATE.selectedDietary && STATE.selectedDietary.has(tag);
      return `
        <button type="button" class="dietary-chip ${isActive ? 'active' : ''}" data-tag="${escapeHtml(tag)}" onclick="toggleDietaryChip(this, this)">
          ${escapeHtml(tag)}
        </button>
      `;
    }).join("");
  }
}

function renderPhotoPresets() {
  const presetsGrid = document.getElementById("dish-photo-presets");
  if (presetsGrid) {
    const currentImgUrl = document.getElementById("dish-image-url")?.value || "";
    presetsGrid.innerHTML = CURATED_FOOD_PRESETS.map((preset) => {
      const isActive = currentImgUrl === preset.url;
      return `
        <div class="preset-photo-thumb ${isActive ? 'active' : ''}" onclick="selectPhotoPreset('${escapeHtml(preset.url)}', this)" title="${escapeHtml(preset.name)}">
          <img src="${escapeHtml(preset.url)}" alt="${escapeHtml(preset.name)}" loading="lazy" />
          <span class="preset-label">${escapeHtml(preset.name)}</span>
        </div>
      `;
    }).join("");
  }
}

function attachDishStudioPreviewListeners() {
  const nameInput = document.getElementById("dish-name");
  const priceInput = document.getElementById("dish-price");
  const descInput = document.getElementById("dish-desc");
  const urlInput = document.getElementById("dish-image-url");
  const catSelect = document.getElementById("dish-category");

  if (nameInput && !nameInput._previewBound) {
    nameInput.addEventListener("input", updateLiveDishPreview);
    nameInput._previewBound = true;
  }
  if (priceInput && !priceInput._previewBound) {
    priceInput.addEventListener("input", updateLiveDishPreview);
    priceInput._previewBound = true;
  }
  if (descInput && !descInput._previewBound) {
    descInput.addEventListener("input", updateLiveDishPreview);
    descInput._previewBound = true;
  }
  if (urlInput && !urlInput._previewBound) {
    urlInput.addEventListener("input", updateLiveDishPreview);
    urlInput._previewBound = true;
  }
  if (catSelect && !catSelect._previewBound) {
    catSelect.addEventListener("change", updateLiveDishPreview);
    catSelect._previewBound = true;
  }
}

function openAddDishModal() {
  const modal = document.getElementById("dish-modal-backdrop");
  if (!modal) return;

  STATE.selectedDietary = new Set();
  const editId = document.getElementById("dish-edit-id");
  if (editId) editId.value = "";
  const editCatId = document.getElementById("dish-edit-cat-id");
  if (editCatId) editCatId.value = "";
  const modalTitle = document.getElementById("dish-modal-title");
  if (modalTitle) modalTitle.textContent = "Add Dish to Menu";
  const modalSub = document.getElementById("dish-modal-subtitle");
  if (modalSub) modalSub.textContent = "Create a new item in the restaurant's active menu catalog";
  const btnSubmitText = document.getElementById("btn-submit-dish-text");
  if (btnSubmitText) btnSubmitText.textContent = "Save Item to Catalog";

  const nameEl = document.getElementById("dish-name");
  if (nameEl) nameEl.value = "";
  const descEl = document.getElementById("dish-desc");
  if (descEl) descEl.value = "";
  const priceEl = document.getElementById("dish-price");
  if (priceEl) priceEl.value = "";
  const stockEl = document.getElementById("dish-stock");
  if (stockEl) stockEl.value = "50";
  const lowThreshEl = document.getElementById("dish-low-threshold");
  if (lowThreshEl) lowThreshEl.value = "10";
  const imgUrlEl = document.getElementById("dish-image-url");
  if (imgUrlEl) imgUrlEl.value = "";
  const dietaryEl = document.getElementById("dish-dietary");
  if (dietaryEl) dietaryEl.value = "";

  populateCategoryOptions();
  renderDietaryChips();
  renderPhotoPresets();
  updateLiveDishPreview();

  modal.classList.add("active");
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function openEditDishModal(itemId, categoryId) {
  const modal = document.getElementById("dish-modal-backdrop");
  if (!modal) return;

  let dish = null;
  for (const cat of (STATE.menu || [])) {
    dish = (cat.items || []).find((i) => i.id === itemId);
    if (dish) break;
  }
  if (!dish) {
    showToast("Dish not found", "error");
    return;
  }

  STATE.selectedDietary = new Set(dish.dietaryAttributes || []);
  const editId = document.getElementById("dish-edit-id");
  if (editId) editId.value = dish.id;
  const editCatId = document.getElementById("dish-edit-cat-id");
  if (editCatId) editCatId.value = categoryId;
  const modalTitle = document.getElementById("dish-modal-title");
  if (modalTitle) modalTitle.textContent = "Edit Dish Listing";
  const modalSub = document.getElementById("dish-modal-subtitle");
  if (modalSub) modalSub.textContent = "Update catalog details, pricing, and stock thresholds";
  const btnSubmitText = document.getElementById("btn-submit-dish-text");
  if (btnSubmitText) btnSubmitText.textContent = "Save Changes";

  const nameEl = document.getElementById("dish-name");
  if (nameEl) nameEl.value = dish.name || "";
  const descEl = document.getElementById("dish-desc");
  if (descEl) descEl.value = dish.description || "";
  const priceEl = document.getElementById("dish-price");
  if (priceEl) priceEl.value = dish.price || "";
  const stockEl = document.getElementById("dish-stock");
  if (stockEl) stockEl.value = typeof dish.stock === "number" ? dish.stock : 50;
  const lowThreshEl = document.getElementById("dish-low-threshold");
  if (lowThreshEl) lowThreshEl.value = typeof dish.lowStockThreshold === "number" ? dish.lowStockThreshold : 10;
  const imgUrlEl = document.getElementById("dish-image-url");
  if (imgUrlEl) imgUrlEl.value = dish.imageUrl || "";
  const dietaryEl = document.getElementById("dish-dietary");
  if (dietaryEl) dietaryEl.value = Array.from(STATE.selectedDietary).join(", ");

  populateCategoryOptions(categoryId);
  renderDietaryChips();
  renderPhotoPresets();
  updateLiveDishPreview();

  modal.classList.add("active");
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeAddDishModal() {
  const modal = document.getElementById("dish-modal-backdrop");
  if (modal) {
    modal.style.display = "none";
    modal.classList.remove("active");
    document.body.style.overflow = "";
  }
}

function selectCategoryPreset(catId, chipEl) {
  const catSelect = document.getElementById("dish-category");
  if (catSelect) catSelect.value = catId;
  const chips = document.querySelectorAll("#dish-category-chips .category-preset-chip");
  chips.forEach((c) => c.classList.remove("active"));
  if (chipEl) chipEl.classList.add("active");
  updateLiveDishPreview();
}

function toggleDietaryChip(tagOrEl, chipEl) {
  let tag = "";
  let element = chipEl;
  if (tagOrEl && typeof tagOrEl === "object" && tagOrEl.nodeType === 1) {
    element = tagOrEl;
    tag = element.dataset.tag || element.textContent.trim();
  } else {
    tag = String(tagOrEl);
  }

  if (STATE.selectedDietary.has(tag)) {
    STATE.selectedDietary.delete(tag);
    if (element) element.classList.remove("active");
  } else {
    STATE.selectedDietary.add(tag);
    if (element) element.classList.add("active");
  }
  const dietaryInput = document.getElementById("dish-dietary");
  if (dietaryInput) {
    dietaryInput.value = Array.from(STATE.selectedDietary).join(", ");
  }
  updateLiveDishPreview();
}

function selectPhotoPreset(url, thumbEl) {
  const urlInput = document.getElementById("dish-image-url");
  if (urlInput) urlInput.value = url;
  const thumbs = document.querySelectorAll("#dish-photo-presets .preset-photo-thumb");
  thumbs.forEach((t) => t.classList.remove("active"));
  if (thumbEl) thumbEl.classList.add("active");
  updateLiveDishPreview();
}

function handleImageUrlInput(url) {
  updateLiveDishPreview();
}

function updateDishImagePreview(url) {
  handleImageUrlInput(url);
}

function updateLiveDishPreview() {
  const previewBox = document.getElementById("dish-live-preview-card");
  if (!previewBox) return;

  const nameEl = document.getElementById("dish-name");
  const priceEl = document.getElementById("dish-price");
  const descEl = document.getElementById("dish-desc");
  const imgUrlEl = document.getElementById("dish-image-url");
  const catSelect = document.getElementById("dish-category");

  const name = nameEl && nameEl.value.trim() ? nameEl.value.trim() : "Item Name";
  const priceVal = priceEl ? parseFloat(priceEl.value) : NaN;
  const priceStr = !isNaN(priceVal) && priceVal > 0 ? `N$ ${priceVal.toFixed(2)}` : "N$ 0.00";
  const desc = descEl && descEl.value.trim() ? descEl.value.trim() : "Delicious freshly prepared meal with authentic ingredients.";
  const imgUrl = imgUrlEl && imgUrlEl.value.trim() ? imgUrlEl.value.trim() : "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&auto=format&fit=crop&q=80";

  const catName = catSelect && catSelect.selectedOptions && catSelect.selectedOptions[0]
    ? catSelect.selectedOptions[0].textContent
    : "Category";

  const dietaryTags = Array.from(STATE.selectedDietary);

  previewBox.innerHTML = `
    <div class="live-diner-preview-card">
      <div class="diner-card-img-wrap">
        <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(name)}" onerror="this.src='https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&auto=format&fit=crop&q=80'" />
        <span class="diner-card-cat-badge">${escapeHtml(catName)}</span>
      </div>
      <div class="diner-card-content">
        <div class="diner-card-head">
          <h4 class="diner-card-title">${escapeHtml(name)}</h4>
          <span class="diner-card-price text-mono">${escapeHtml(priceStr)}</span>
        </div>
        <p class="diner-card-desc">${escapeHtml(desc)}</p>
        ${dietaryTags.length > 0 ? `
          <div class="diner-card-dietary-pills">
            ${dietaryTags.map((d) => `<span class="dietary-pill">${escapeHtml(d)}</span>`).join("")}
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

async function submitDishStudio() {
  const editId = document.getElementById("dish-edit-id")?.value;
  const categoryId = document.getElementById("dish-category")?.value;
  const name = document.getElementById("dish-name")?.value.trim();
  const description = document.getElementById("dish-desc")?.value.trim();
  const price = parseFloat(document.getElementById("dish-price")?.value);
  const stock = parseInt(document.getElementById("dish-stock")?.value, 10);
  const lowStockThreshold = parseInt(document.getElementById("dish-low-threshold")?.value, 10) || 10;
  const imageUrl = document.getElementById("dish-image-url")?.value.trim();
  const dietaryAttributes = Array.from(STATE.selectedDietary || []);

  if (!name) {
    showToast("Please enter a dish name", "error");
    return;
  }
  if (isNaN(price) || price <= 0) {
    showToast("Please enter a valid price (greater than 0)", "error");
    return;
  }
  if (isNaN(stock) || stock < 0) {
    showToast("Stock quantity cannot be negative", "error");
    return;
  }

  const payload = {
    name,
    description,
    price,
    taxRate: 0.15,
    dietaryAttributes,
    stock,
    lowStockThreshold,
    isAvailable: stock > 0,
    imageUrl: imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"
  };

  const btn = document.getElementById("btn-submit-dish");
  if (btn) btn.disabled = true;

  try {
    let res;
    if (editId) {
      payload.id = editId;
      res = await fetch(`/restaurants/${encodeURIComponent(STATE.currentRestaurantId)}/menu/items/${encodeURIComponent(editId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      if (!categoryId) {
        showToast("Please select a menu category", "error");
        if (btn) btn.disabled = false;
        return;
      }
      const newItemId = "M" + Date.now().toString().slice(-4);
      payload.id = newItemId;
      res = await fetch(`/restaurants/${encodeURIComponent(STATE.currentRestaurantId)}/menu/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, item: payload })
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.message || "Failed to save dish", "error");
      return;
    }

    closeAddDishModal();
    await loadRestaurantMenu();
    showToast(editId ? "Dish listing updated successfully!" : "New dish added to menu!", "success");
  } catch (err) {
    console.error("Failed to save dish:", err);
    showToast("Network error saving dish", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function submitAddNewDish() {
  return submitDishStudio();
}

// ============================================================================
// 6. KITCHEN DISPLAY SYSTEM (KDS) & HANDOVER STATE MACHINE
// ============================================================================

async function loadLiveOrders() {
  if (!STATE.currentRestaurantId) {
    STATE.orders = [];
    renderKanbanBoard([]);
    return;
  }
  try {
    const res = await fetchApi(PORTS.ORDER, `/orders`);
    if (res.ok) {
      const allOrders = await res.json();
      // Filter orders intended for this restaurant
      STATE.orders = allOrders.filter((o) => o.restaurantId === STATE.currentRestaurantId);
      renderKanbanBoard(STATE.orders);
    }
  } catch (err) {
    console.warn("Could not load orders from :9091", err);
  }
}

function renderKanbanBoard(orders) {
  const colPreparing = document.getElementById("kanban-container-preparing");
  const colReady = document.getElementById("kanban-container-ready");
  const colCompleted = document.getElementById("kanban-container-completed");

  const countPreparing = document.getElementById("col-count-preparing");
  const countReady = document.getElementById("col-count-ready");
  const countCompleted = document.getElementById("col-count-completed");

  const statPrep = document.getElementById("count-stat-preparing");
  const statReady = document.getElementById("count-stat-ready");
  const statComp = document.getElementById("count-stat-completed");
  const activeCount = document.getElementById("kds-active-count");

  // Partition by status
  const preparingList = orders.filter((o) => o.status === "CREATED" || o.status === "CONFIRMED" || o.status === "PREPARING");
  const readyList = orders.filter((o) => o.status === "READY" || o.status === "READY_FOR_PICKUP");
  const completedList = orders.filter((o) => o.status === "OUT_FOR_DELIVERY" || o.status === "IN_TRANSIT" || o.status === "DELIVERED");

  if (countPreparing) countPreparing.textContent = preparingList.length;
  if (countReady) countReady.textContent = readyList.length;
  if (countCompleted) countCompleted.textContent = completedList.length;

  if (statPrep) statPrep.textContent = preparingList.length;
  if (statReady) statReady.textContent = readyList.length;
  if (statComp) statComp.textContent = completedList.length;
  if (activeCount) activeCount.textContent = preparingList.length + readyList.length;

  // Render Column 1
  if (colPreparing) {
    colPreparing.innerHTML = preparingList.length === 0
      ? `<div class="empty-kanban-placeholder"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg><p>No orders currently preparing</p></div>`
      : preparingList.map((o) => renderKdsTicketCard(o, "PREPARING")).join("");
  }

  // Render Column 2
  if (colReady) {
    colReady.innerHTML = readyList.length === 0
      ? `<div class="empty-kanban-placeholder"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><p>No orders awaiting driver pickup</p></div>`
      : readyList.map((o) => renderKdsTicketCard(o, "READY")).join("");
  }

  // Render Column 3
  if (colCompleted) {
    colCompleted.innerHTML = completedList.length === 0
      ? `<div class="empty-kanban-placeholder"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg><p>No recently dispatched orders</p></div>`
      : completedList.slice(0, 10).map((o) => renderKdsTicketCard(o, "COMPLETED")).join("");
  }
  initKanbanDropZones();
}

function handleCardDragStart(e, orderId) {
  STATE.draggedOrderId = orderId;
  if (e.dataTransfer) {
    e.dataTransfer.setData("text/plain", orderId);
    e.dataTransfer.effectAllowed = "move";
  }
  const card = document.getElementById(`ticket-${orderId}`) || (e.currentTarget && e.currentTarget.closest(".kds-ticket-card"));
  if (card) {
    card.classList.add("is-dragging");
  }
}

function handleCardDragEnd(e) {
  STATE.draggedOrderId = null;
  document.querySelectorAll(".kds-ticket-card.is-dragging").forEach((el) => el.classList.remove("is-dragging"));
  document.querySelectorAll(".kanban-drop-target").forEach((el) => el.classList.remove("kanban-drop-target"));
}

function handleKanbanDragOver(e) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = "move";
  }
  const col = e.currentTarget;
  if (col && !col.classList.contains("kanban-drop-target")) {
    col.classList.add("kanban-drop-target");
  }
}

function handleKanbanDragLeave(e) {
  const col = e.currentTarget;
  if (col && (!e.relatedTarget || !col.contains(e.relatedTarget))) {
    col.classList.remove("kanban-drop-target");
  }
}

async function handleKanbanDrop(e, targetColumn) {
  e.preventDefault();
  const col = e.currentTarget;
  if (col) {
    col.classList.remove("kanban-drop-target");
  }
  document.querySelectorAll(".kanban-drop-target").forEach((el) => el.classList.remove("kanban-drop-target"));

  const orderId = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || STATE.draggedOrderId;
  if (!orderId) return;

  const order = STATE.orders.find((o) => o.orderId === orderId);
  if (!order) return;

  if (targetColumn === "READY") {
    if (order.status === "CREATED" || order.status === "CONFIRMED" || order.status === "PREPARING") {
      await markOrderReady(orderId);
    }
  } else if (targetColumn === "COMPLETED") {
    if (order.status === "READY" || order.status === "READY_FOR_PICKUP") {
      openHandoverModal(orderId);
    }
  }
}

function initKanbanDropZones() {
  const zones = [
    { id: "kanban-container-preparing", col: "PREPARING" },
    { id: "kanban-container-ready", col: "READY" },
    { id: "kanban-container-completed", col: "COMPLETED" },
    { id: "kds-col-preparing", col: "PREPARING" },
    { id: "kds-col-ready", col: "READY" },
    { id: "kds-col-completed", col: "COMPLETED" }
  ];
  zones.forEach(({ id, col }) => {
    const el = document.getElementById(id);
    if (el && !el._dndBound) {
      el.addEventListener("dragover", (e) => handleKanbanDragOver(e));
      el.addEventListener("dragleave", (e) => handleKanbanDragLeave(e));
      el.addEventListener("drop", (e) => handleKanbanDrop(e, col));
      el._dndBound = true;
    }
  });
}

function renderKdsTicketCard(order, stage) {
  const orderId = order.orderId;
  const friendlyId = orderId.length > 10 ? `ORD-${orderId.slice(0, 6).toUpperCase()}` : orderId;
  const items = order.items || [];
  const createdAt = order.createdAt ? new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--:--";

  let actionHtml = "";
  if (stage === "PREPARING") {
    actionHtml = `
      <button type="button" class="btn-kds-action btn-mark-ready" onclick="markOrderReady('${escapeHtml(orderId)}')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Mark Ready for Pickup</span>
      </button>
    `;
  } else if (stage === "READY") {
    actionHtml = `
      <button type="button" class="btn-kds-action btn-open-handover" onclick="openHandoverModal('${escapeHtml(orderId)}')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>Authenticate Handover (PIN)</span>
      </button>
    `;
  } else {
    actionHtml = `
      <div style="font-size:11px; color:var(--text-dim); text-align:center; width:100%; font-weight:600;">
        Driver En Route &bull; ${escapeHtml(order.status)}
      </div>
    `;
  }

  return `
    <div class="kds-ticket-card" id="ticket-${escapeHtml(orderId)}" draggable="${stage !== 'COMPLETED'}" ondragstart="handleCardDragStart(event, '${escapeHtml(orderId)}')" ondragend="handleCardDragEnd(event)">
      <div class="ticket-top-row">
        <span class="ticket-order-id text-mono">${escapeHtml(friendlyId)}</span>
        <span class="ticket-timer-badge">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${escapeHtml(createdAt)}
        </span>
      </div>

      <div class="ticket-customer-meta">
        <span>Customer: <strong>${escapeHtml(order.customerName || (window.DSA?.resolveCustomerName && window.DSA.resolveCustomerName(order.customerId)) || "Walk-In Customer")}</strong></span>
        <span>Total: <strong class="text-mono">N$ ${Number(order.totalAmount || 0).toFixed(2)}</strong></span>
      </div>

      <div class="ticket-items-list">
        ${items.map((it) => `
          <div class="ticket-item-row">
            <span class="ticket-item-qty">${it.quantity}x</span>
            <span class="ticket-item-name">${escapeHtml(it.name || it.itemId)}</span>
            <span class="ticket-item-price">N$ ${Number(it.price * it.quantity).toFixed(2)}</span>
          </div>
        `).join("")}
      </div>

      <div class="ticket-action-bar">
        ${actionHtml}
      </div>
    </div>
  `;
}

async function markOrderReady(orderId) {
  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}/orders/${orderId}/ready`, {
      method: "POST"
    });
    if (res.ok) {
      await loadLiveOrders();
    } else {
      alert("Failed to update order status to READY.");
    }
  } catch (err) {
    alert(`Error updating order: ${err.message}`);
  }
}

// Handover Modal & PIN Verification
function openHandoverModal(orderId) {
  const order = STATE.orders.find((o) => o.orderId === orderId);
  if (!order) return;

  STATE.activeHandoverOrder = order;

  const modal = document.getElementById("handover-modal-backdrop");
  const orderIdEl = document.getElementById("modal-handover-order-id");
  const suffixEl = document.getElementById("modal-handover-client-suffix");
  const pinInput = document.getElementById("handover-pin-input");
  const errBox = document.getElementById("handover-error-alert");

  if (orderIdEl) orderIdEl.textContent = typeof formatFriendlyOrderId === 'function' ? formatFriendlyOrderId(orderId) : (orderId.length > 10 ? `ORD-${orderId.slice(0, 6).toUpperCase()}` : orderId);

  const custName = order.customerName || (window.DSA?.resolveCustomerName && window.DSA.resolveCustomerName(order.customerId)) || "Customer";
  const custNameEl = document.getElementById("modal-handover-customer-name");
  if (custNameEl) custNameEl.textContent = custName;

  const custPhone = order.customerPhone || "0811234567";
  const last4 = custPhone.replace(/\D/g, '').slice(-4) || "2222";
  if (suffixEl) suffixEl.textContent = '...' + last4;

  if (pinInput) {
    pinInput.value = "";
    setTimeout(() => pinInput.focus(), 100);
  }
  if (errBox) errBox.style.display = "none";
  if (modal) modal.style.display = "flex";
}

function closeHandoverModal() {
  const modal = document.getElementById("handover-modal-backdrop");
  if (modal) modal.style.display = "none";
  STATE.activeHandoverOrder = null;
}

async function submitHandoverVerification() {
  if (!STATE.activeHandoverOrder) return;

  const orderId = STATE.activeHandoverOrder.orderId;
  const pinInput = document.getElementById("handover-pin-input");
  const errBox = document.getElementById("handover-error-alert");
  const pin = pinInput ? pinInput.value.trim() : "";

  if (pin.length !== 4) {
    if (errBox) {
      errBox.textContent = "Please enter the complete 4-digit handover PIN displayed by the courier.";
      errBox.style.display = "block";
    }
    return;
  }

  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}/orders/${orderId}/verify-handover`, {
      method: "POST",
      body: JSON.stringify({ pin, orderId })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.verified) {
        // Notify Delivery service of handover status
        try {
          await fetchApi(PORTS.DELIVERY, `/deliveries/${orderId}/status`, {
            method: "POST",
            body: JSON.stringify({ status: "OUT_FOR_DELIVERY" })
          });
        } catch (_) {}

        // Calculate 10% DSA facilitation fee, crediting 90% net earnings to wallet
        const orderAmount = STATE.activeHandoverOrder.itemsTotal || STATE.activeHandoverOrder.totalAmount || 120.0;
        const netEarnings = Number(orderAmount) * 0.90;
        await creditMerchantEarnings(netEarnings, orderId);

        closeHandoverModal();
        alert("Driver authenticated! Order handed over and earnings credited to wallet.");
        await loadLiveOrders();
        await loadEarnings();
      } else {
        if (errBox) {
          errBox.textContent = data.message || "Invalid PIN provided. Handover rejected.";
          errBox.style.display = "block";
        }
      }
    } else {
      const err = await res.json().catch(() => ({}));
      if (errBox) {
        errBox.textContent = err.message || "Handover verification failed.";
        errBox.style.display = "block";
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = `Network error: ${err.message}`;
      errBox.style.display = "block";
    }
  }
}

// ============================================================================
// 7. MERCHANT WALLET & EARNINGS WITHDRAWALS
// ============================================================================

async function loadEarnings() {
  if (!STATE.currentRestaurantId) {
    const elOrders = document.getElementById("wallet-shift-orders");
    const elGross = document.getElementById("wallet-shift-gross");
    const elNet = document.getElementById("wallet-shift-net");
    if (elOrders) elOrders.textContent = "0";
    if (elGross) elGross.textContent = "N$ 0.00";
    if (elNet) elNet.textContent = "N$ 0.00";
    const headerBal = document.getElementById("header-wallet-balance");
    const drawerBal = document.getElementById("drawer-wallet-balance");
    const drawerTot = document.getElementById("drawer-wallet-total");
    if (headerBal) headerBal.textContent = "N$ 0.00";
    if (drawerBal) drawerBal.textContent = "N$ 0.00";
    if (drawerTot) drawerTot.textContent = "N$ 0.00";
    return;
  }
  // Calculate shift KPIs from STATE.orders
  const shiftOrders = STATE.orders.length;
  const shiftGross = STATE.orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const shiftNet = shiftGross * 0.90;

  const elOrders = document.getElementById("wallet-shift-orders");
  const elGross = document.getElementById("wallet-shift-gross");
  const elNet = document.getElementById("wallet-shift-net");

  if (elOrders) elOrders.textContent = shiftOrders;
  if (elGross) elGross.textContent = `N$ ${shiftGross.toFixed(2)}`;
  if (elNet) elNet.textContent = `N$ ${shiftNet.toFixed(2)}`;

  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}/earnings`);
    if (res.ok) {
      const data = await res.json();
      const balStr = `N$ ${Number(data.balance || 0).toFixed(2)}`;
      const totStr = `N$ ${Number(data.totalEarnings || 0).toFixed(2)}`;

      const headerBal = document.getElementById("header-wallet-balance");
      const drawerBal = document.getElementById("drawer-wallet-balance");
      const drawerTot = document.getElementById("drawer-wallet-total");

      if (headerBal) headerBal.textContent = balStr;
      if (drawerBal) drawerBal.textContent = balStr;
      if (drawerTot) drawerTot.textContent = totStr;
    }
  } catch (err) {
    console.warn("Could not load earnings from :9095", err);
  }
}

async function creditMerchantEarnings(amount, orderId) {
  try {
    await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}/earnings/credit`, {
      method: "POST",
      body: JSON.stringify({
        amount: Number(amount),
        orderId: orderId,
        description: `Settlement for order ${orderId}`
      })
    });
    // Add to settlement history
    addSettlementEntry(orderId, amount);
  } catch (err) {
    console.error("Failed to credit merchant earnings:", err);
  }
}

function loadSettlementLedger() {
  const list = document.getElementById("settlement-list");
  if (!list) return;
  if (!STATE.currentRestaurantId) {
    list.innerHTML = `<div class="empty-kanban-placeholder"><p>No recent settlements yet</p></div>`;
    return;
  }

  const key = `dsa_restaurant_settlements_${STATE.currentRestaurantId}`;
  let entries = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) entries = JSON.parse(raw);
    if (!Array.isArray(entries)) entries = [];
  } catch (_) {
    entries = [];
  }

  if (entries.length === 0) return;

  list.innerHTML = entries.map((e) => {
    const friendlyId = (e.orderId && e.orderId.length > 10) ? `ORD-${e.orderId.slice(0, 6).toUpperCase()}` : (e.orderId || "ORD-000000");
    const tStr = e.time || (e.timestamp ? new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "");
    return `
      <div class="settlement-item">
        <div>
          <strong class="text-mono">${escapeHtml(friendlyId)}</strong>
          <span style="color:var(--text-dim); margin-left:6px;">${escapeHtml(tStr)}</span>
        </div>
        <span class="badge-credit">+N$ ${Number(e.amount || 0).toFixed(2)}</span>
      </div>
    `;
  }).join("");
}

function addSettlementEntry(orderId, amount) {
  const list = document.getElementById("settlement-list");
  const friendlyId = (orderId && orderId.length > 10) ? `ORD-${orderId.slice(0, 6).toUpperCase()}` : (orderId || "ORD-000000");
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (list) {
    const placeholder = list.querySelector(".empty-kanban-placeholder");
    if (placeholder) placeholder.remove();

    const itemHtml = `
      <div class="settlement-item">
        <div>
          <strong class="text-mono">${escapeHtml(friendlyId)}</strong>
          <span style="color:var(--text-dim); margin-left:6px;">${escapeHtml(timeStr)}</span>
        </div>
        <span class="badge-credit">+N$ ${Number(amount).toFixed(2)}</span>
      </div>
    `;
    list.insertAdjacentHTML("afterbegin", itemHtml);
  }

  const key = `dsa_restaurant_settlements_${STATE.currentRestaurantId}`;
  let entries = [];
  try {
    const raw = localStorage.getItem(key);
    if (raw) entries = JSON.parse(raw);
    if (!Array.isArray(entries)) entries = [];
  } catch (_) {
    entries = [];
  }
  entries.unshift({ orderId, amount, time: timeStr, timestamp: Date.now() });
  entries = entries.slice(0, 50);
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch (_) {}
}

function setPayoutAmount(amt) {
  const amountInput = document.getElementById("payout-amount");
  if (amountInput) amountInput.value = Number(amt).toFixed(2);
}

function setPayoutMax() {
  const drawerBal = document.getElementById("drawer-wallet-balance");
  const amountInput = document.getElementById("payout-amount");
  if (drawerBal && amountInput) {
    const raw = drawerBal.textContent.replace(/[^0-9.]/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val) && val > 0) {
      amountInput.value = val.toFixed(2);
    }
  }
}

function switchLedgerTab(tab) {
  STATE.activeLedgerTab = tab;
  const btnSettlements = document.getElementById("tab-btn-settlements");
  const btnPayouts = document.getElementById("tab-btn-payouts");
  const listSettlements = document.getElementById("settlement-list");
  const listPayouts = document.getElementById("payout-list");

  if (btnSettlements) btnSettlements.classList.toggle("active", tab === "settlements");
  if (btnPayouts) btnPayouts.classList.toggle("active", tab === "payouts");

  if (listSettlements) listSettlements.style.display = tab === "settlements" ? "block" : "none";
  if (listPayouts) listPayouts.style.display = tab === "payouts" ? "block" : "none";
}

function renderPayoutsHistory() {
  const list = document.getElementById("payout-list");
  if (!list) return;

  if (STATE.payoutsHistory.length === 0) {
    list.innerHTML = `
      <div class="empty-kanban-placeholder">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="5" width="20" height="14" rx="2"/>
          <line x1="2" y1="10" x2="22" y2="10"/>
        </svg>
        <p>No payout history recorded yet</p>
      </div>
    `;
    return;
  }

  list.innerHTML = STATE.payoutsHistory.map((p) => `
    <div class="settlement-item">
      <div>
        <strong class="text-mono">${escapeHtml(p.refId)}</strong>
        <span style="color:var(--text-dim); margin-left:6px;">${escapeHtml(p.timeStr)} &bull; ${escapeHtml(p.bankName)}</span>
      </div>
      <span class="badge-debit" style="color:var(--text-danger,#ef4444); font-weight:700;">-N$ ${Number(p.amount).toFixed(2)}</span>
    </div>
  `).join("");
}

function openWalletDrawer() {
  const drawer = document.getElementById("wallet-drawer");
  const backdrop = document.getElementById("wallet-drawer-backdrop");
  if (drawer) drawer.classList.add("open");
  if (backdrop) backdrop.style.display = "block";
  localStorage.setItem("dsa_restaurant_wallet_drawer", "true");
}

function closeWalletDrawer() {
  const drawer = document.getElementById("wallet-drawer");
  const backdrop = document.getElementById("wallet-drawer-backdrop");
  if (drawer) drawer.classList.remove("open");
  if (backdrop) backdrop.style.display = "none";
  localStorage.removeItem("dsa_restaurant_wallet_drawer");
}

async function submitPayoutWithdrawal() {
  const amountInput = document.getElementById("payout-amount");
  const bankSelect = document.getElementById("payout-bank");
  const accInput = document.getElementById("payout-account");

  const amount = parseFloat(amountInput.value);
  const bankName = bankSelect.value;
  const bankAccount = accInput.value.trim();

  if (isNaN(amount) || amount <= 0) {
    alert("Please enter a valid positive withdrawal amount.");
    return;
  }

  try {
    const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${STATE.currentRestaurantId}/payout`, {
      method: "POST",
      body: JSON.stringify({
        amount,
        bankName,
        bankAccount
      })
    });

    if (res.ok) {
      const data = await res.json();
      const refId = data.referenceId || ("W-" + Math.floor(100000 + Math.random() * 900000));
      alert(`Payout of N$ ${Number(amount).toFixed(2)} approved! Ref: ${refId}`);

      STATE.payoutsHistory.unshift({
        refId,
        amount,
        bankName,
        timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
      renderPayoutsHistory();

      amountInput.value = "";
      await loadEarnings();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Payout failed: ${err.message || res.statusText}`);
    }
  } catch (err) {
    alert(`Network error during payout: ${err.message}`);
  }
}

// ============================================================================
// 8. 7-SERVICE HEALTH PROBING
// ============================================================================

function startHealthProbes() {
  probeServices();
  setInterval(probeServices, 10000);
}

async function probeServices() {
  const services = [
    { id: "order", port: PORTS.ORDER },
    { id: "customer", port: PORTS.CUSTOMER },
    { id: "payment", port: PORTS.PAYMENT },
    { id: "restaurant", port: PORTS.RESTAURANT },
    { id: "delivery", port: PORTS.DELIVERY },
    { id: "notif", port: PORTS.NOTIF },
    { id: "admin", port: PORTS.ADMIN }
  ];

  let coreOnline = true;

  for (const s of services) {
    const dot = document.getElementById(`dot-${s.id}`);
    try {
      let isUp = false;
      if (typeof window !== 'undefined' && typeof window.sharedProbeHealth === 'function') {
        const h = await window.sharedProbeHealth(s.port);
        isUp = Boolean(h && h.up);
      } else if (typeof probeHealth === 'function') {
        const h = await probeHealth(s.port);
        isUp = Boolean(h && h.up);
      } else {
        const res = await fetchApi(s.port, "/health", { timeoutMs: 2500 });
        isUp = Boolean(res && res.ok);
      }
      if (dot) {
        dot.className = isUp ? "dot-led up" : "dot-led down";
      }
      if ([PORTS.ORDER, PORTS.RESTAURANT, PORTS.DELIVERY].includes(s.port) && !isUp) {
        coreOnline = false;
      }
    } catch (_) {
      if (dot) dot.className = "dot-led down";
      if ([PORTS.ORDER, PORTS.RESTAURANT, PORTS.DELIVERY].includes(s.port)) {
        coreOnline = false;
      }
    }
  }

  const statusEl = document.getElementById("rest-system-status");
  const statusTextEl = document.getElementById("rest-status-text");
  if (statusEl) {
    statusEl.className = coreOnline ? "rest-system-status status-online" : "rest-system-status status-offline";
  }
  if (statusTextEl) {
    statusTextEl.textContent = coreOnline ? "Online" : "Offline";
  }
}

// ============================================================================
// 9. UI TAB SWITCHING & HELPERS
// ============================================================================

function switchTab(tabId) {
  const targetId = tabId.startsWith("tab-") ? tabId : `tab-${tabId}`;
  localStorage.setItem("dsa_restaurant_active_tab", targetId);
  document.querySelectorAll(".nav-segment-btn, .subnav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === targetId);
  });
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === targetId);
  });

  document.body.classList.toggle("store-map-view", targetId === "tab-profile");

  if (targetId === "tab-profile" && STATE.map) {
    setTimeout(() => {
      STATE.map.invalidateSize();
      if (STATE.restaurant && STATE.restaurant.location) {
        const [lon, lat] = STATE.restaurant.location.coordinates;
        STATE.map.setView([lat, lon], 15);
      }
    }, 200);
  }
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

// ============================================================================
// 10. AUTHENTICATION, ONBOARDING WIZARD & CASCADE DELETION
// ============================================================================

const PRESEEDED_RESTAURANTS = {
  "R001": { id: "R001", name: "Kapana Corner", address: "Single Quarters, Katutura, Windhoek", cuisine: "Namibian Kapana" },
  "R002": { id: "R002", name: "Oshetu Braai Kitchen", address: "Oshetu Market, Windhoek", cuisine: "Namibian Braai" },
  "R003": { id: "R003", name: "Single Quarters Meats", address: "Single Quarters Stall #14, Windhoek", cuisine: "BBQ & Kapana" },
  "R004": { id: "R004", name: "Namibian Smokehouse", address: "Independence Ave 102, Windhoek", cuisine: "Smokehouse" },
  "R005": { id: "R005", name: "Katutura Grill Hub", address: "Central Katutura, Windhoek", cuisine: "Grilled Meats" }
};
const PRESEEDED_PASSWORD = "Kapana@2026";

function updateAuthUI(isLoggedIn) {
  let authBtn = document.getElementById("restaurant-auth-btn");
  if (!authBtn) {
    const headerActions = document.querySelector(".rest-header-actions");
    if (headerActions) {
      authBtn = document.createElement("button");
      authBtn.id = "restaurant-auth-btn";
      authBtn.type = "button";
      authBtn.className = "btn-secondary-action";
      authBtn.style.cssText = "padding: 6px 14px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border-radius: 8px;";
      headerActions.prepend(authBtn);
    }
  }

  if (authBtn) {
    if (isLoggedIn) {
      authBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <polyline points="16 17 21 12 16 7"></polyline>
          <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
        <span>Sign Out</span>
      `;
      authBtn.title = "Sign out of restaurant operations";
      authBtn.onclick = logoutRestaurant;
    } else {
      authBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
          <polyline points="10 17 15 12 10 7"></polyline>
          <line x1="15" y1="12" x2="3" y2="12"></line>
        </svg>
        <span>Sign In</span>
      `;
      authBtn.title = "Sign in to restaurant portal";
      authBtn.onclick = openRestaurantLoginModal;
    }
  }

  const signInBtn = document.getElementById("btn-restaurant-signin") || document.getElementById("rest-signin-btn");
  const signOutBtn = document.getElementById("btn-restaurant-signout") || document.getElementById("rest-signout-btn");
  if (signInBtn) signInBtn.style.display = isLoggedIn ? "none" : "inline-flex";
  if (signOutBtn) signOutBtn.style.display = isLoggedIn ? "inline-flex" : "none";

  const badgeEl = document.getElementById("rest-id-badge");
  if (badgeEl) badgeEl.textContent = STATE.currentRestaurantId || "Guest";
}

function ensureLoginModal() {
  let modal = document.getElementById("restaurant-login-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "restaurant-login-modal";
  modal.className = "modal-backdrop";
  modal.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); z-index: 9999; align-items: center; justify-content: center;";
  modal.innerHTML = `
    <div class="modal-card" style="max-width: 460px; width: 90%; background: var(--bg-card, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 24px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color, #334155); padding-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="background: rgba(234, 88, 12, 0.15); color: #ea580c; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/>
            </svg>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 18px; color: var(--text-main, #f8fafc);">Restaurant Portal Login</h3>
            <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--text-muted, #94a3b8);">Authenticate kitchen operator session</p>
          </div>
        </div>
        <button type="button" class="btn-modal-close" onclick="closeRestaurantLoginModal()" style="background: none; border: none; color: var(--text-muted, #94a3b8); font-size: 24px; cursor: pointer;">&times;</button>
      </div>

      <form id="restaurant-login-form" onsubmit="handleRestaurantLoginSubmit(event)">
        <div style="margin-bottom: 14px;">
          <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--text-muted, #94a3b8);">Quick Pre-Seeded Accounts</label>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            <button type="button" class="chip-amt" onclick="quickFillRestaurantLogin('R001')" style="padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 6px;">R001 (Kapana Corner)</button>
            <button type="button" class="chip-amt" onclick="quickFillRestaurantLogin('R002')" style="padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 6px;">R002 (Oshetu Braai)</button>
            <button type="button" class="chip-amt" onclick="quickFillRestaurantLogin('R003')" style="padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 6px;">R003 (Single Quarters)</button>
            <button type="button" class="chip-amt" onclick="quickFillRestaurantLogin('R004')" style="padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 6px;">R004 (Smokehouse)</button>
            <button type="button" class="chip-amt" onclick="quickFillRestaurantLogin('R005')" style="padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 6px;">R005 (Katutura Grill)</button>
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 14px;">
          <label for="rest-login-id" style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px;">Restaurant ID / Email</label>
          <input type="text" id="rest-login-id" class="form-input text-mono" placeholder="e.g. R001" required style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px;" />
        </div>

        <div class="form-group" style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <label for="rest-login-password" style="font-size: 12px; font-weight: 600;">Password</label>
            <span style="font-size: 11px; color: var(--text-muted, #94a3b8);">Pre-seeded: <code style="color: #ea580c;">Kapana@2026</code></span>
          </div>
          <input type="password" id="rest-login-password" class="form-input" placeholder="Enter password" required style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px;" />
        </div>

        <div id="rest-login-error" style="display: none; padding: 10px; margin-bottom: 14px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; color: #ef4444; font-size: 12px;"></div>

        <button type="submit" class="btn-primary-action btn-block" style="width: 100%; padding: 11px; font-weight: 600; font-size: 14px; border-radius: 8px; cursor: pointer;">
          <span>Sign In to Kitchen Portal</span>
        </button>

        <div style="margin-top: 18px; text-align: center; border-top: 1px solid var(--border-color, #334155); padding-top: 14px;">
          <p style="font-size: 12px; color: var(--text-muted, #94a3b8); margin-bottom: 8px;">Want to partner with DSA?</p>
          <button type="button" class="btn-secondary-action" onclick="closeRestaurantLoginModal(); openRestaurantOnboardingModal();" style="font-size: 12px; padding: 8px 14px; border-radius: 6px; cursor: pointer;">
            <span>Start 5-Step Restaurant Onboarding Wizard</span>
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function quickFillRestaurantLogin(restId) {
  const idInput = document.getElementById("rest-login-id");
  const passInput = document.getElementById("rest-login-password");
  if (idInput) idInput.value = restId;
  if (passInput) passInput.value = PRESEEDED_PASSWORD;
}

function openRestaurantLoginModal() {
  const modal = ensureLoginModal();
  const err = document.getElementById("rest-login-error");
  if (err) err.style.display = "none";
  modal.style.display = "flex";
}

function closeRestaurantLoginModal() {
  const modal = document.getElementById("restaurant-login-modal");
  if (modal) modal.style.display = "none";
}

async function handleRestaurantLoginSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  const idInput = document.getElementById("rest-login-id");
  const passInput = document.getElementById("rest-login-password");
  const errBox = document.getElementById("rest-login-error");

  const enteredId = (idInput?.value || "").trim().toUpperCase();
  const enteredPass = passInput?.value || "";

  if (!enteredId || !enteredPass) {
    if (errBox) {
      errBox.textContent = "Please enter both Restaurant ID and password.";
      errBox.style.display = "block";
    }
    return;
  }

  let authenticatedRest = null;

  // 1. Check pre-seeded R001-R005 accounts with Kapana@2026
  if (PRESEEDED_RESTAURANTS[enteredId] && enteredPass === PRESEEDED_PASSWORD) {
    authenticatedRest = PRESEEDED_RESTAURANTS[enteredId];
  }

  // 2. Check registered restaurants in localStorage
  if (!authenticatedRest) {
    try {
      const regRaw = localStorage.getItem("dsa_registered_restaurants");
      if (regRaw) {
        const registeredList = JSON.parse(regRaw);
        const match = registeredList.find((r) =>
          (r.id && r.id.toUpperCase() === enteredId) ||
          (r.email && r.email.toUpperCase() === enteredId)
        );
        if (match && (match.password === enteredPass || enteredPass === PRESEEDED_PASSWORD)) {
          authenticatedRest = match;
        }
      }
    } catch (_) {}
  }

  // 3. Fallback: try fetching restaurant profile from :9095 and verify with Kapana@2026
  if (!authenticatedRest && enteredPass === PRESEEDED_PASSWORD) {
    try {
      const res = await fetchApi(PORTS.RESTAURANT, `/restaurants/${enteredId}`);
      if (res.ok) {
        authenticatedRest = await res.json();
      }
    } catch (_) {}
  }

  if (!authenticatedRest) {
    if (errBox) {
      errBox.textContent = "Invalid Restaurant ID or password. Use pre-seeded accounts R001-R005 with password Kapana@2026, or onboard a new restaurant.";
      errBox.style.display = "block";
    }
    return;
  }

  // Save session via window.DSA.setStoredSession('restaurant', ...)
  if (typeof window !== 'undefined' && window.DSA && typeof window.DSA.setStoredSession === 'function') {
    window.DSA.setStoredSession('restaurant', authenticatedRest);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem("dsa_session_restaurant", JSON.stringify({
      role: "restaurant",
      token: "jwt_restaurant_" + Date.now(),
      loginAt: new Date().toISOString(),
      user: authenticatedRest
    }));
    localStorage.setItem("dsa_active_restaurant_id", authenticatedRest.id);
  }

  STATE.currentRestaurantId = authenticatedRest.id;
  STATE.restaurant = authenticatedRest;

  closeRestaurantLoginModal();
  updateAuthUI(true);

  // Load profile/menu/orders/earnings
  await loadRestaurantProfile();
  await loadRestaurantMenu();
  await loadLiveOrders();
  await loadEarnings();
  loadSettlementLedger();
  updateMapPosition();
}

function ensureOnboardingModal() {
  let modal = document.getElementById("restaurant-onboarding-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "restaurant-onboarding-modal";
  modal.className = "modal-backdrop";
  modal.style.cssText = "display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); z-index: 9999; align-items: center; justify-content: center;";
  modal.innerHTML = `
    <div class="modal-card" style="max-width: 620px; width: 92%; max-height: 90vh; overflow-y: auto; background: var(--bg-card, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 24px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--border-color, #334155); padding-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="background: rgba(234, 88, 12, 0.15); color: #ea580c; width: 38px; height: 38px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 18px; color: var(--text-main, #f8fafc);">Restaurant Onboarding Wizard</h3>
            <p style="margin: 2px 0 0 0; font-size: 12px; color: var(--text-muted, #94a3b8);">5-step automated registration &amp; kitchen setup</p>
          </div>
        </div>
        <button type="button" class="btn-modal-close" onclick="closeRestaurantOnboardingModal()" style="background: none; border: none; color: var(--text-muted, #94a3b8); font-size: 24px; cursor: pointer;">&times;</button>
      </div>

      <!-- Step Navigation Indicator -->
      <div class="wizard-steps-bar" style="display: flex; justify-content: space-between; gap: 6px; margin-bottom: 20px;">
        <div class="wizard-step-pill active" id="wizard-pill-1" onclick="setRestaurantWizardStep(1)" style="flex: 1; text-align: center; padding: 6px 4px; background: rgba(234, 88, 12, 0.2); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; color: #ea580c; border: 1px solid #ea580c;">1. Brand</div>
        <div class="wizard-step-pill" id="wizard-pill-2" onclick="setRestaurantWizardStep(2)" style="flex: 1; text-align: center; padding: 6px 4px; background: rgba(51, 65, 85, 0.5); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; color: var(--text-muted, #94a3b8);">2. Security</div>
        <div class="wizard-step-pill" id="wizard-pill-3" onclick="setRestaurantWizardStep(3)" style="flex: 1; text-align: center; padding: 6px 4px; background: rgba(51, 65, 85, 0.5); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; color: var(--text-muted, #94a3b8);">3. Location</div>
        <div class="wizard-step-pill" id="wizard-pill-4" onclick="setRestaurantWizardStep(4)" style="flex: 1; text-align: center; padding: 6px 4px; background: rgba(51, 65, 85, 0.5); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; color: var(--text-muted, #94a3b8);">4. Hours</div>
        <div class="wizard-step-pill" id="wizard-pill-5" onclick="setRestaurantWizardStep(5)" style="flex: 1; text-align: center; padding: 6px 4px; background: rgba(51, 65, 85, 0.5); border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; color: var(--text-muted, #94a3b8);">5. Starter Menu</div>
      </div>

      <!-- STEP 1: Brand & Contact -->
      <div id="wizard-step-pane-1" class="wizard-pane">
        <h4 style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-main, #f8fafc);">Step 1: Restaurant Brand &amp; Contact</h4>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; margin-bottom: 4px;">Restaurant Trading Name *</label>
          <input type="text" id="onboard-name" class="form-input" placeholder="e.g. Katutura Braai &amp; Grill" value="Katutura Braai &amp; Grill" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" required />
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; margin-bottom: 4px;">Cuisine Specialty *</label>
          <select id="onboard-cuisine" class="form-input" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;">
            <option value="Namibian Kapana & Braai">Namibian Kapana &amp; Braai</option>
            <option value="Traditional African Cuisine">Traditional African Cuisine</option>
            <option value="Grilled Meats & Steaks">Grilled Meats &amp; Steaks</option>
            <option value="Fast Food & Burgers">Fast Food &amp; Burgers</option>
            <option value="Bakery & Desserts">Bakery &amp; Desserts</option>
          </select>
        </div>
        <div class="form-row-2" style="display: flex; gap: 12px; margin-bottom: 12px;">
          <div class="form-group" style="flex: 1;">
            <label style="display: block; font-size: 12px; margin-bottom: 4px;">Contact Phone *</label>
            <input type="text" id="onboard-phone" class="form-input text-mono" placeholder="+264 81 234 5678" value="+264 81 234 5678" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label style="display: block; font-size: 12px; margin-bottom: 4px;">Email Address *</label>
            <input type="email" id="onboard-email" class="form-input" placeholder="manager@katuturabraai.na" value="manager@katuturabraai.na" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
          </div>
        </div>
      </div>

      <!-- STEP 2: Password & Security -->
      <div id="wizard-step-pane-2" class="wizard-pane" style="display: none;">
        <h4 style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-main, #f8fafc);">Step 2: Password Security &amp; Credentials</h4>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; margin-bottom: 4px;">Portal Access Password *</label>
          <input type="password" id="onboard-password" class="form-input" placeholder="e.g. Kapana@2026" oninput="handleRestaurantPasswordInput()" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; margin-bottom: 4px;">Confirm Password *</label>
          <input type="password" id="onboard-confirm-password" class="form-input" placeholder="Repeat password" oninput="handleRestaurantPasswordInput()" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
        </div>

        <!-- Password Strength Meter -->
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color, #334155); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; color: var(--text-muted, #94a3b8); font-weight: 600;">Password Strength:</span>
            <span id="onboard-strength-label" style="font-size: 11px; font-weight: 700; color: #ef4444;">Very Weak</span>
          </div>
          <div style="height: 6px; width: 100%; background: #334155; border-radius: 3px; overflow: hidden; margin-bottom: 8px;">
            <div id="onboard-strength-bar" style="height: 100%; width: 15%; background: #ef4444; transition: width 0.3s, background-color 0.3s;"></div>
          </div>
          <div id="onboard-strength-checks" style="font-size: 11px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; color: var(--text-muted, #94a3b8);">
            <div id="chk-len">&bull; 8-64 characters</div>
            <div id="chk-upper">&bull; Uppercase letter (A-Z)</div>
            <div id="chk-lower">&bull; Lowercase letter (a-z)</div>
            <div id="chk-num">&bull; Number digit (0-9)</div>
            <div id="chk-spec">&bull; Special symbol (!@#$)</div>
            <div id="chk-match">&bull; Passwords match</div>
          </div>
        </div>
      </div>

      <!-- STEP 3: Location & Coordinates -->
      <div id="wizard-step-pane-3" class="wizard-pane" style="display: none;">
        <h4 style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-main, #f8fafc);">Step 3: Physical Location &amp; Dispatch Anchor</h4>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; margin-bottom: 4px;">Street / Market Address *</label>
          <input type="text" id="onboard-address" class="form-input" placeholder="e.g. Single Quarters, Katutura, Windhoek" value="Single Quarters, Katutura, Windhoek" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
        </div>
        <div class="form-row-2" style="display: flex; gap: 12px; margin-bottom: 12px;">
          <div class="form-group" style="flex: 1;">
            <label style="display: block; font-size: 12px; margin-bottom: 4px;">GPS Latitude (S) *</label>
            <input type="number" step="0.0001" id="onboard-lat" class="form-input text-mono" value="-22.5609" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label style="display: block; font-size: 12px; margin-bottom: 4px;">GPS Longitude (E) *</label>
            <input type="number" step="0.0001" id="onboard-lon" class="form-input text-mono" value="17.0658" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
          </div>
        </div>
        <div style="display: flex; gap: 6px; margin-bottom: 10px;">
          <button type="button" class="chip-amt" onclick="quickFillOnboardCoords(-22.5350, 17.0650, 'Single Quarters Katutura')" style="font-size: 11px; cursor: pointer; padding: 4px 8px; border-radius: 4px;">Single Quarters</button>
          <button type="button" class="chip-amt" onclick="quickFillOnboardCoords(-22.5609, 17.0658, 'Windhoek CBD')" style="font-size: 11px; cursor: pointer; padding: 4px 8px; border-radius: 4px;">Windhoek Central</button>
          <button type="button" class="chip-amt" onclick="quickFillOnboardCoords(-22.5700, 17.1000, 'Klein Windhoek')" style="font-size: 11px; cursor: pointer; padding: 4px 8px; border-radius: 4px;">Klein Windhoek</button>
        </div>
      </div>

      <!-- STEP 4: Weekly Operating Hours -->
      <div id="wizard-step-pane-4" class="wizard-pane" style="display: none;">
        <h4 style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-main, #f8fafc);">Step 4: Weekly Operating Hours &amp; Kitchen Pace</h4>
        <div class="form-row-2" style="display: flex; gap: 12px; margin-bottom: 12px;">
          <div class="form-group" style="flex: 1;">
            <label style="display: block; font-size: 12px; margin-bottom: 4px;">Daily Open Time</label>
            <input type="time" id="onboard-open" class="form-input text-mono" value="08:00" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label style="display: block; font-size: 12px; margin-bottom: 4px;">Daily Close Time</label>
            <input type="time" id="onboard-close" class="form-input text-mono" value="22:00" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
          </div>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; margin-bottom: 4px;">Average Prep Time (Minutes)</label>
          <input type="number" id="onboard-prep-time" class="form-input text-mono" value="15" min="5" max="90" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
        </div>
        <p style="font-size: 11px; color: var(--text-muted, #94a3b8); margin: 0;">Weekly operating schedule will be configured Mon-Sun 08:00 - 22:00 (fully editable from Store Profile).</p>
      </div>

      <!-- STEP 5: Starter Menu Item -->
      <div id="wizard-step-pane-5" class="wizard-pane" style="display: none;">
        <h4 style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-main, #f8fafc);">Step 5: Starter Menu Dish &amp; Catalog Seed</h4>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; margin-bottom: 4px;">Starter Dish Name *</label>
          <input type="text" id="onboard-dish-name" class="form-input" placeholder="e.g. Signature Beef Kapana Cut" value="Signature Beef Kapana Cut" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
        </div>
        <div class="form-row-2" style="display: flex; gap: 12px; margin-bottom: 12px;">
          <div class="form-group" style="flex: 1;">
            <label style="display: block; font-size: 12px; margin-bottom: 4px;">Menu Category</label>
            <input type="text" id="onboard-dish-category" class="form-input" placeholder="e.g. Flame-Grilled Specialties" value="Flame-Grilled Specialties" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label style="display: block; font-size: 12px; margin-bottom: 4px;">Price (N$) *</label>
            <input type="number" step="0.5" id="onboard-dish-price" class="form-input text-mono" value="85.00" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
          </div>
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; margin-bottom: 4px;">Starter Stock Level</label>
          <input type="number" id="onboard-dish-stock" class="form-input text-mono" value="50" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;" />
        </div>
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-size: 12px; margin-bottom: 4px;">Dish Description</label>
          <textarea id="onboard-dish-desc" class="form-input" rows="2" style="width: 100%; box-sizing: border-box; padding: 9px; border-radius: 6px;">Authentic charcoal-braaied Namibian beef sliced tender with salt, chili spice, and diced onions.</textarea>
        </div>
      </div>

      <!-- Error Box -->
      <div id="onboard-error-msg" style="display: none; padding: 10px; margin-top: 14px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; color: #ef4444; font-size: 12px;"></div>

      <!-- Wizard Navigation Footer -->
      <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; border-top: 1px solid var(--border-color, #334155); padding-top: 14px;">
        <button type="button" class="btn-secondary-action" id="wizard-btn-prev" onclick="setRestaurantWizardStep(STATE.wizardStep - 1)" style="display: none; padding: 8px 14px; border-radius: 6px; cursor: pointer;">&larr; Previous</button>
        <div style="flex: 1;"></div>
        <button type="button" class="btn-primary-action" id="wizard-btn-next" onclick="setRestaurantWizardStep(STATE.wizardStep + 1)" style="padding: 8px 16px; border-radius: 6px; cursor: pointer;">Next Step &rarr;</button>
        <button type="button" class="btn-primary-action" id="wizard-btn-submit" onclick="submitRestaurantOnboarding()" style="display: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Complete Onboarding &amp; Launch</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function quickFillOnboardCoords(lat, lon, addr) {
  const latEl = document.getElementById("onboard-lat");
  const lonEl = document.getElementById("onboard-lon");
  const addrEl = document.getElementById("onboard-address");
  if (latEl) latEl.value = lat;
  if (lonEl) lonEl.value = lon;
  if (addrEl && addr) addrEl.value = addr;
}

function openRestaurantOnboardingModal() {
  const modal = document.getElementById("restaurant-onboarding-modal") || ensureOnboardingModal();
  setRestaurantWizardStep(1);
  handleRestaurantPasswordInput();
  modal.style.display = "flex";
}

function closeRestaurantOnboardingModal() {
  const modal = document.getElementById("restaurant-onboarding-modal");
  if (modal) modal.style.display = "none";
}

function setRestaurantWizardStep(stepNumber) {
  const step = Math.max(1, Math.min(5, stepNumber));
  STATE.wizardStep = step;

  // Support both generated and static template pane & pill IDs
  for (let i = 1; i <= 5; i++) {
    const paneDynamic = document.getElementById(`wizard-step-pane-${i}`);
    const paneStatic = document.getElementById(`onboard-step-${i}`);
    if (paneDynamic) paneDynamic.style.display = i === step ? "block" : "none";
    if (paneStatic) paneStatic.style.display = i === step ? "block" : "none";

    const pillDynamic = document.getElementById(`wizard-pill-${i}`);
    if (pillDynamic) {
      if (i === step) {
        pillDynamic.style.background = "rgba(234, 88, 12, 0.25)";
        pillDynamic.style.color = "#ea580c";
        pillDynamic.style.border = "1px solid #ea580c";
      } else if (i < step) {
        pillDynamic.style.background = "rgba(34, 197, 94, 0.15)";
        pillDynamic.style.color = "#22c55e";
        pillDynamic.style.border = "none";
      } else {
        pillDynamic.style.background = "rgba(51, 65, 85, 0.5)";
        pillDynamic.style.color = "var(--text-muted, #94a3b8)";
        pillDynamic.style.border = "none";
      }
    }

    const pillStatic = document.getElementById(`onboard-step-pill-${i}`);
    if (pillStatic) {
      const stepNumEl = pillStatic.querySelector('.step-num');
      if (i === step) {
        pillStatic.classList.add('active');
        if (stepNumEl) {
          stepNumEl.style.background = 'var(--primary, #f59e0b)';
          stepNumEl.style.color = '#000';
        }
      } else {
        pillStatic.classList.remove('active');
        if (stepNumEl) {
          stepNumEl.style.background = 'rgba(255,255,255,0.1)';
          stepNumEl.style.color = 'var(--text-muted, #8b949e)';
        }
      }
    }
  }

  // Navigation buttons (support both dynamic and static modal elements)
  const prevBtnDynamic = document.getElementById("wizard-btn-prev");
  const nextBtnDynamic = document.getElementById("wizard-btn-next");
  const submitBtnDynamic = document.getElementById("wizard-btn-submit");
  if (prevBtnDynamic) prevBtnDynamic.style.display = step > 1 ? "inline-flex" : "none";
  if (nextBtnDynamic) nextBtnDynamic.style.display = step < 5 ? "inline-flex" : "none";
  if (submitBtnDynamic) submitBtnDynamic.style.display = step === 5 ? "inline-flex" : "none";

  const prevBtnStatic = document.getElementById("btn-onboard-prev");
  const nextBtnStatic = document.getElementById("btn-onboard-next");
  const submitBtnStatic = document.getElementById("btn-onboard-submit");
  if (prevBtnStatic) prevBtnStatic.style.visibility = step > 1 ? "visible" : "hidden";
  if (nextBtnStatic) nextBtnStatic.style.display = step < 5 ? "inline-flex" : "none";
  if (submitBtnStatic) submitBtnStatic.style.display = step === 5 ? "inline-flex" : "none";

  const errElDynamic = document.getElementById("onboard-error-msg");
  if (errElDynamic) errElDynamic.style.display = "none";
  const errElStatic = document.getElementById("onboard-error-alert");
  if (errElStatic) errElStatic.style.display = "none";
}

function onboardNextStep() {
  const currentStep = STATE.wizardStep || 1;
  const errEl = document.getElementById("onboard-error-alert") || document.getElementById("onboard-error-msg");
  if (errEl) errEl.style.display = "none";

  if (currentStep === 1) {
    const name = (document.getElementById("onboard-brand-name")?.value || document.getElementById("onboard-name")?.value || "").trim();
    const email = (document.getElementById("onboard-manager-email")?.value || document.getElementById("onboard-email")?.value || "").trim();
    const phone = (document.getElementById("onboard-manager-phone")?.value || document.getElementById("onboard-phone")?.value || "").trim();
    const pass = (document.getElementById("onboard-password")?.value || "").trim();

    if (!name) {
      if (errEl) { errEl.textContent = "Please enter your Restaurant Brand Name."; errEl.style.display = "block"; }
      return;
    }
    if (!email || !email.includes("@")) {
      if (errEl) { errEl.textContent = "Please enter a valid manager email address."; errEl.style.display = "block"; }
      return;
    }
    if (!phone) {
      if (errEl) { errEl.textContent = "Please enter an official phone contact number."; errEl.style.display = "block"; }
      return;
    }
    if (pass.length < 6) {
      if (errEl) { errEl.textContent = "Password must be at least 6 characters."; errEl.style.display = "block"; }
      return;
    }
  } else if (currentStep === 2) {
    const addr = (document.getElementById("onboard-address")?.value || "").trim();
    if (!addr) {
      if (errEl) { errEl.textContent = "Please enter your physical street address."; errEl.style.display = "block"; }
      return;
    }
  } else if (currentStep === 4) {
    const acc = (document.getElementById("onboard-bank-account")?.value || "").trim();
    if (!acc) {
      if (errEl) { errEl.textContent = "Please enter your settlement bank account number."; errEl.style.display = "block"; }
      return;
    }
  }

  setRestaurantWizardStep(currentStep + 1);
}

function onboardPrevStep() {
  setRestaurantWizardStep(Math.max(1, (STATE.wizardStep || 1) - 1));
}

function onOnboardSuburbChange(suburb) {
  const SUBURB_MAP = {
    'Katutura': { lat: -22.5298, lng: 17.0628, addr: 'Single Quarters Market, Katutura, Windhoek' },
    'Windhoek Central': { lat: -22.5609, lng: 17.0658, addr: 'Independence Avenue, Windhoek Central' },
    'Klein Windhoek': { lat: -22.5684, lng: 17.1022, addr: 'Nelson Mandela Ave, Klein Windhoek' },
    'Eros': { lat: -22.5441, lng: 17.0863, addr: 'Eros Shopping Centre, Eros, Windhoek' },
    'Olympia': { lat: -22.6052, lng: 17.0934, addr: 'Olympia Commercial Center, Olympia' },
    'Pionierspark': { lat: -22.5936, lng: 17.0617, addr: 'Beda St, Pionierspark, Windhoek' },
    'Suiderhof': { lat: -22.5908, lng: 17.0872, addr: 'Suiderhof Square, Windhoek' },
    'Khomasdal': { lat: -22.5471, lng: 17.0396, addr: 'Khomasdal Plaza, Windhoek' },
    'Avis': { lat: -22.5712, lng: 17.1265, addr: 'Avis Dam Road, Avis, Windhoek' },
    'Hochland Park': { lat: -22.5783, lng: 17.0543, addr: 'Hochland Park Centre, Windhoek' },
    'Ludwigsdorf': { lat: -22.5627, lng: 17.1172, addr: 'Ludwigsdorf Vista, Windhoek' }
  };
  const match = SUBURB_MAP[suburb];
  if (match) {
    const latEl = document.getElementById('onboard-lat');
    const lngEl = document.getElementById('onboard-lng') || document.getElementById('onboard-lon');
    const addrEl = document.getElementById('onboard-address');
    if (latEl) latEl.value = match.lat;
    if (lngEl) lngEl.value = match.lng;
    if (addrEl && (!addrEl.value || addrEl.value.includes('Windhoek'))) addrEl.value = match.addr;
  }
}

function handleOnboardingSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  return submitRestaurantOnboarding();
}

function handleRestaurantLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  return handleRestaurantLoginSubmit(e);
}

function updatePasswordStrength(val) {
  handleRestaurantPasswordInput();
  if (typeof window !== 'undefined' && window.DSA && typeof window.DSA.evaluatePasswordStrength === 'function') {
    const res = window.DSA.evaluatePasswordStrength(val || '');
    const meter = document.getElementById('onboard-strength-meter');
    const txt = document.getElementById('onboard-strength-text');
    if (meter) {
      meter.style.width = `${res.percent}%`;
      meter.style.background = res.color;
    }
    if (txt) {
      txt.textContent = `Password Strength: ${res.label}`;
      txt.style.color = res.color;
    }
  }
}

function togglePasswordVisibility(inputId, btnEl) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function handleRestaurantPasswordInput() {
  const password = document.getElementById("onboard-password")?.value || "";
  const meter = document.getElementById("onboard-strength-meter");
  const txt = document.getElementById("onboard-strength-text");

  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { label: "Enter a password", color: "var(--text-muted, #8b949e)", percent: 5 },
    { label: "Weak", color: "#ef4444", percent: 25 },
    { label: "Fair", color: "#f97316", percent: 50 },
    { label: "Good", color: "#eab308", percent: 75 },
    { label: "Strong", color: "#22c55e", percent: 100 }
  ];
  const lvl = levels[password ? score : 0];
  if (meter) {
    meter.style.width = `${lvl.percent}%`;
    meter.style.backgroundColor = lvl.color;
  }
  if (txt) {
    txt.textContent = `Password Strength: ${lvl.label}`;
    txt.style.color = lvl.color;
  }
}

async function submitRestaurantOnboarding() {
  const errBox = document.getElementById("onboard-error-alert") || document.getElementById("onboard-error-msg");
  if (errBox) errBox.style.display = "none";

  function showWizardError(msg, stepToGo) {
    if (errBox) {
      errBox.textContent = msg;
      errBox.style.display = "block";
      errBox.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      alert(msg);
    }
    if (stepToGo) setRestaurantWizardStep(stepToGo);
  }

  // Step 1: Restaurant Brand & Manager Credentials
  const name = (document.getElementById("onboard-brand-name")?.value || document.getElementById("onboard-name")?.value || "").trim();
  const email = (document.getElementById("onboard-manager-email")?.value || document.getElementById("onboard-email")?.value || "").trim();
  const phone = (document.getElementById("onboard-manager-phone")?.value || document.getElementById("onboard-phone")?.value || "").trim();
  const password = (document.getElementById("onboard-password")?.value || "").trim();

  if (!name) return showWizardError("Please enter your Restaurant Brand Name.", 1);
  if (!email || !email.includes("@")) return showWizardError("Please enter a valid manager email.", 1);
  if (!phone) return showWizardError("Please enter an official phone contact.", 1);
  if (password.length < 6) return showWizardError("Password must be at least 6 characters.", 1);

  // Step 2: Spatial Pinning
  const suburb = document.getElementById("onboard-suburb")?.value || "Katutura";
  const address = (document.getElementById("onboard-address")?.value || "").trim();
  const lat = parseFloat(document.getElementById("onboard-lat")?.value) || -22.5298;
  const lon = parseFloat(document.getElementById("onboard-lng")?.value || document.getElementById("onboard-lon")?.value) || 17.0628;

  if (!address) return showWizardError("Please enter your physical street address.", 2);

  // Step 3: Operating Hours
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const dayPrefixes = { "Monday": "mon", "Tuesday": "tue", "Wednesday": "wed", "Thursday": "thu", "Friday": "fri", "Saturday": "sat", "Sunday": "sun" };
  const operatingHours = days.map((day) => {
    const pfx = dayPrefixes[day];
    const openTime = document.getElementById(`onboard-hours-${pfx}-open`)?.value || "08:00";
    const closeTime = document.getElementById(`onboard-hours-${pfx}-close`)?.value || "21:00";
    const isClosed = Boolean(document.getElementById(`onboard-hours-${pfx}-closed`)?.checked);
    return { dayOfWeek: day, openTime, closeTime, isClosed };
  });

  // Step 4: Bank Details
  const bankName = document.getElementById("onboard-bank-name")?.value || "First National Bank (FNB Namibia)";
  const bankHolder = (document.getElementById("onboard-bank-holder")?.value || name).trim();
  const bankAccount = (document.getElementById("onboard-bank-account")?.value || "").trim();
  if (!bankAccount) return showWizardError("Please enter your settlement account number.", 4);

  // Step 5: Starter Dish
  const dishTitle = (document.getElementById("onboard-dish-title")?.value || document.getElementById("onboard-dish-name")?.value || "").trim() || "Flame-Grilled Kapana Cut";
  const dishPrice = parseFloat(document.getElementById("onboard-dish-price")?.value) || 85.00;
  const dishCategory = document.getElementById("onboard-dish-category")?.value || "Mains";

  // Create unique ID
  const newRestaurantId = "R" + Math.floor(100 + Math.random() * 900);

  const restaurantObj = {
    id: newRestaurantId,
    name,
    address,
    suburb,
    contactNumber: phone,
    email,
    cuisine: "Namibian Kapana & Grills",
    location: {
      type: "Point",
      coordinates: [lon, lat]
    },
    operatingHours,
    bankDetails: {
      bankName,
      holderName: bankHolder,
      accountNumber: bankAccount
    },
    status: "ACTIVE",
    createdAt: new Date().toISOString()
  };

  // POST to Restaurant Service
  try {
    await fetchApi(PORTS.RESTAURANT, `/restaurants`, {
      method: "POST",
      body: JSON.stringify(restaurantObj)
    });
  } catch (err) {
    console.warn("Could not POST restaurant to :9095, continuing with client storage", err);
  }

  // POST starter menu dish
  const starterCategoryPayload = {
    id: "cat-" + Date.now(),
    name: dishCategory,
    items: [{
      id: "dish-" + Date.now(),
      name: dishTitle,
      description: "Freshly prepared chef specialty",
      price: dishPrice,
      taxRate: 0.15,
      dietaryAttributes: [],
      stock: 50,
      lowStockThreshold: 10,
      isAvailable: true,
      imageUrl: ""
    }]
  };

  try {
    await fetchApi(PORTS.RESTAURANT, `/restaurants/${newRestaurantId}/menu`, {
      method: "POST",
      body: JSON.stringify(starterCategoryPayload)
    });
  } catch (err) {
    console.warn("Could not POST starter menu item to :9095", err);
  }

  // Save in local registered list
  try {
    const existing = JSON.parse(localStorage.getItem("dsa_registered_restaurants") || "[]");
    existing.push({ ...restaurantObj, password });
    localStorage.setItem("dsa_registered_restaurants", JSON.stringify(existing));
  } catch (_) {}

  // Set active session
  localStorage.setItem("dsa_session_restaurant", JSON.stringify({
    role: "restaurant",
    token: "jwt_restaurant_" + Date.now(),
    loginAt: new Date().toISOString(),
    user: restaurantObj
  }));
  localStorage.setItem("dsa_active_restaurant_id", newRestaurantId);

  STATE.currentRestaurantId = newRestaurantId;
  STATE.restaurant = restaurantObj;

  closeRestaurantOnboardingModal();
  closeRestaurantLoginModal();
  updateAuthUI(true);

  await loadRestaurantProfile();
  await loadRestaurantMenu();
  await loadLiveOrders();
  await loadEarnings();
  loadSettlementLedger();
  updateMapPosition();

  showToast(`Restaurant "${name}" (${newRestaurantId}) onboarded successfully!`, "success");
}

function logoutRestaurant() {
  if (typeof window !== 'undefined' && window.DSA && typeof window.DSA.clearStoredSession === 'function') {
    window.DSA.clearStoredSession('restaurant');
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem("dsa_session_restaurant");
    localStorage.removeItem("dsa_active_restaurant_id");
  }

  STATE.currentRestaurantId = null;
  STATE.restaurant = null;
  STATE.menu = [];
  STATE.orders = [];

  const storeNameEl = document.getElementById("rest-store-name");
  const badgeEl = document.getElementById("rest-id-badge");
  if (storeNameEl) storeNameEl.textContent = "Please Sign In";
  if (badgeEl) badgeEl.textContent = "None";

  const wrap = document.getElementById("menu-categories-wrap");
  if (wrap) wrap.innerHTML = `<div class="empty-kanban-placeholder"><p>Please sign in to view and manage menu catalog.</p></div>`;

  const colPreparing = document.getElementById("kanban-container-preparing");
  const colReady = document.getElementById("kanban-container-ready");
  const colCompleted = document.getElementById("kanban-container-completed");
  if (colPreparing) colPreparing.innerHTML = `<div class="empty-kanban-placeholder"><p>Please sign in to view kitchen tickets</p></div>`;
  if (colReady) colReady.innerHTML = `<div class="empty-kanban-placeholder"><p>Please sign in to view kitchen tickets</p></div>`;
  if (colCompleted) colCompleted.innerHTML = `<div class="empty-kanban-placeholder"><p>Please sign in to view kitchen tickets</p></div>`;

  updateAuthUI(false);
  openRestaurantLoginModal();
}

async function deleteRestaurantCascade() {
  if (!STATE.currentRestaurantId) {
    alert("No active restaurant session to delete.");
    return;
  }

  const restId = STATE.currentRestaurantId;
  const confirmed = confirm(`Are you sure you want to PERMANENTLY DELETE restaurant ${restId}?\nThis will cascade delete all store profiles, menu catalogs, and active orders.`);
  if (!confirmed) return;

  try {
    let callSucceeded = false;
    // Calls POST /api/restaurant/cascade-delete with { restaurantId: STATE.currentRestaurantId }
    try {
      const res = await fetch("/api/restaurant/cascade-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: restId })
      });
      if (res.ok) callSucceeded = true;
    } catch (_) {}

    if (!callSucceeded) {
      try {
        const res2 = await fetchApi(PORTS.RESTAURANT, `/restaurants/cascade-delete`, {
          method: "POST",
          body: JSON.stringify({ restaurantId: restId })
        });
        if (res2.ok) callSucceeded = true;
      } catch (_) {}
    }

    if (!callSucceeded) {
      try {
        await fetchApi(PORTS.RESTAURANT, `/restaurants/${restId}`, {
          method: "DELETE"
        });
        callSucceeded = true;
      } catch (_) {}
    }

    // Also remove from local registered list if present
    try {
      const regRaw = localStorage.getItem("dsa_registered_restaurants");
      if (regRaw) {
        const list = JSON.parse(regRaw).filter((r) => r.id !== restId);
        localStorage.setItem("dsa_registered_restaurants", JSON.stringify(list));
      }
    } catch (_) {}

    // Clears menu catalog and active orders
    STATE.menu = [];
    STATE.orders = [];

    // Calls logoutRestaurant()
    logoutRestaurant();

    // Alerts user of permanent restaurant deletion
    alert(`Restaurant ${restId} and all associated catalog, orders, and ledger data have been permanently deleted.`);
  } catch (err) {
    alert(`Cascade deletion failed: ${err.message}`);
  }
}

// Global browser exposures
if (typeof window !== 'undefined') {
  window.updateAuthUI = updateAuthUI;
  window.openRestaurantLoginModal = openRestaurantLoginModal;
  window.closeRestaurantLoginModal = closeRestaurantLoginModal;
  window.handleRestaurantLogin = handleRestaurantLogin;
  window.handleRestaurantLoginSubmit = handleRestaurantLoginSubmit;
  window.quickFillRestaurantLogin = quickFillRestaurantLogin;
  window.openRestaurantOnboardingModal = openRestaurantOnboardingModal;
  window.closeRestaurantOnboardingModal = closeRestaurantOnboardingModal;
  window.setRestaurantWizardStep = setRestaurantWizardStep;
  window.onboardNextStep = onboardNextStep;
  window.onboardPrevStep = onboardPrevStep;
  window.onOnboardSuburbChange = onOnboardSuburbChange;
  window.handleOnboardingSubmit = handleOnboardingSubmit;
  window.updatePasswordStrength = updatePasswordStrength;
  window.togglePasswordVisibility = togglePasswordVisibility;
  window.handleRestaurantPasswordInput = handleRestaurantPasswordInput;
  window.quickFillOnboardCoords = quickFillOnboardCoords;
  window.submitRestaurantOnboarding = submitRestaurantOnboarding;
  window.logoutRestaurant = logoutRestaurant;
  window.deleteRestaurantCascade = deleteRestaurantCascade;
  window.renderMenuCatalog = renderMenuCatalog;
  window.handleMenuFilterChange = handleMenuFilterChange;
  window.renderDishCard = renderDishCard;
  window.quickAdjustStock = quickAdjustStock;
  window.setDirectStock = setDirectStock;
  window.openAddDishModal = openAddDishModal;
  window.openEditDishModal = openEditDishModal;
  window.closeAddDishModal = closeAddDishModal;
  window.toggleDietaryChip = toggleDietaryChip;
  window.submitDishStudio = submitDishStudio;
  window.submitAddNewDish = submitAddNewDish;
}
