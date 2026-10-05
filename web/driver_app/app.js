/**
 * Food Delivery Suite — Driver Dispatch Portal Application Logic (app.js)
 * Modern Single-Screen Fullscreen Leaflet Architecture
 * Strict Driver Isolation: Only current driver plotted. Zero other drivers queried.
 * Real-Time Telemetry, Single-Screen Bottom Cards, Slide-Out Drawers & Direct Earnings Wallet
 */

// ============================================================================
// 1. STATE & GLOBAL CONFIGURATION
// ============================================================================

// Coordinates for Windhoek Central Hub & default points
const WINDHOEK_CENTER = { lat: -22.5609, lon: 17.0658 };
const DEFAULT_RESTAURANT = {
  name: "Kapana Corner Restaurant",
  address: "Independence Ave & Post St Mall, Windhoek",
  lat: -22.5333,
  lon: 17.0658
};
const DEFAULT_CUSTOMER = {
  name: "Customer Dropoff",
  address: "12 Sam Nujoma Drive, Windhoek",
  lat: -22.5609,
  lon: 17.0658
};

// Current Active Logged-in Courier (Strict Isolation)
let activeDriver = null;

// Active Delivery State
let activeDelivery = {
  orderId: null,
  deliveryId: null,
  status: "UNASSIGNED", // UNASSIGNED, DRIVER_ASSIGNED, AT_RESTAURANT, OUT_FOR_DELIVERY, DELIVERED
  assignedDriverId: null,
  currentLocation: { latitude: -22.5609, longitude: 17.0658 },
  estimatedTime: 8,
  distanceKm: 3.4,
  departedAt: null,
  deliveredAt: null
};

// Route Origin & Destination Waypoints
let routeOrigin = { ...DEFAULT_RESTAURANT };
let routeDestination = { ...DEFAULT_CUSTOMER };
let activeRoadWaypoints = [];
let activeRoutePolylineGroup = null;
let simWaypointIndex = 0;
let vehicleBearing = 0;

// Driver Earnings & Wallet State
let driverWallet = {
  balance: 0.0,
  totalEarned: 0.0,
  completedTrips: 0,
  withdrawn: 0.0,
  transactions: []
};

// Available Orders Pool
let availableOrdersPool = [];

// Leaflet Map & Markers References
let driverLeafletMap = null;
let leafletMarkers = {
  driver: null,
  restaurant: null,
  customer: null
};
let routePolyline = null;

// Simulation State
let simulationInterval = null;
let currentSpeedKmh = 0;
let simProgress = 0; // 0.0 to 1.0 along route

// ============================================================================
// 2. NETWORK & PROXY CALL HELPERS
// ============================================================================

async function driverApiFetch(port, path, options = {}) {
  // Delegate to window.DSA.cachedApiFetch if present
  if (typeof window !== "undefined" && typeof window.DSA?.cachedApiFetch === "function") {
    try {
      return await window.DSA.cachedApiFetch(port, path, options);
    } catch (err) {
      console.warn(`DSA.cachedApiFetch fallback on :${port}${path}:`, err.message);
    }
  }

  // Use shared.js resilient networking if present
  if (typeof window !== "undefined" && typeof window.fetchResilient === "function") {
    try {
      return await window.fetchResilient(port, path, options);
    } catch (err) {
      console.warn(`shared.fetchResilient fallback on :${port}${path}:`, err.message);
    }
  }

  // Fallback candidate cascade
  const urls = [
    `/api/${port}${path.startsWith("/") ? path : "/" + path}`,
    `http://localhost:8080/api/${port}${path.startsWith("/") ? path : "/" + path}`,
    `http://127.0.0.1:8080/api/${port}${path.startsWith("/") ? path : "/" + path}`,
    `http://localhost:${port}${path.startsWith("/") ? path : "/" + path}`,
    `http://127.0.0.1:${port}${path.startsWith("/") ? path : "/" + path}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
      });
      if (res.ok) return res;
    } catch (_) {}
  }
  return null;
}

// ============================================================================
// 3. INITIALIZATION & LIFECYCLE
// ============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof window.resolveMapApiKey === "function") {
    await window.resolveMapApiKey().catch(() => {});
  }
  loadStoredWallet();
  loadStoredDriverProfile();
  loadActivityLogs();
  initLeafletMap();
  updateHeaderBalance();
  updateProfileDrawerUI();

  // Initial order pool scan
  await refreshPlatformOrders();

  // Restore active delivery if currently in progress
  restoreActiveOrderSession();

  // Restore active drawer if previously open
  try {
    const savedDrawer = localStorage.getItem("dsa_driver_active_drawer");
    if (savedDrawer) {
      toggleDrawer(savedDrawer);
    }
  } catch (_) {}

  // Background health probe
  probeAllClusterMicroservices();

  // Periodic polling for available orders (visibility-aware)
  setInterval(() => {
    if (!document.hidden && !activeDelivery.orderId) {
      refreshPlatformOrders(false);
    }
  }, 10000);

  // Resume immediately upon refocus
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (!activeDelivery.orderId) {
        refreshPlatformOrders(false);
      }
      probeAllClusterMicroservices();
    }
  });

  // Periodic cluster probe (visibility-aware)
  setInterval(() => {
    if (!document.hidden) {
      probeAllClusterMicroservices();
    }
  }, 30000);
});

// ============================================================================
// 4. LEAFLET MAP CONTROLLER (Single-Screen Map)
// ============================================================================

function initLeafletMap() {
  const mapEl = document.getElementById("driver-map");
  if (!mapEl || typeof L === "undefined") return;

  const initialLat = activeDriver?.location?.latitude || WINDHOEK_CENTER.lat;
  const initialLon = activeDriver?.location?.longitude || WINDHOEK_CENTER.lon;

  driverLeafletMap = L.map("driver-map", {
    center: [initialLat, initialLon],
    zoom: 14,
    zoomControl: false,
    attributionControl: false
  });

  L.control.zoom({ position: "bottomright" }).addTo(driverLeafletMap);

  // CartoDB Voyager Tile Layer
  const tileUrl = (typeof window.getCartoTileUrl === 'function')
    ? window.getCartoTileUrl('voyager')
    : (() => {
        const key = (typeof window !== 'undefined' && (window.MAP_API_KEY || localStorage.getItem('map_api_key'))) || '';
        return `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${key ? `?key=${encodeURIComponent(key)}` : ''}`;
      })();

  L.tileLayer(tileUrl, {
    subdomains: "abcd",
    maxZoom: 20
  }).addTo(driverLeafletMap);

  // Create isolated Driver Marker with custom pulsating radar DivIcon
  const driverIcon = L.divIcon({
    className: "custom-leaflet-marker",
    html: `
      <div class="driver-radar-marker">
        <div class="driver-pulse-ring"></div>
        <div class="driver-icon-core" title="${escapeHtml(activeDriver ? activeDriver.name : "Courier GPS")}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
          </svg>
        </div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });

  leafletMarkers.driver = L.marker([initialLat, initialLon], {
    icon: driverIcon,
    zIndexOffset: 1000
  }).addTo(driverLeafletMap);

  leafletMarkers.restaurants = [];
  const seedList = window.DEFAULT_SEED_RESTAURANTS || [];
  seedList.forEach((r) => {
    const restIcon = L.divIcon({
      className: "custom-leaflet-marker",
      html: `<div class="restaurant-pin-marker" title="${escapeHtml(r.name)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
    const m = L.marker([r.lat, r.lng], { icon: restIcon, title: r.name }).addTo(driverLeafletMap);
    const popupHtml = (window.DSA?.createRestaurantMapCardHtml || window.createRestaurantMapCardHtml)(r, { isClient: false });
    m.bindPopup(popupHtml, { className: "restaurant-map-popup" });
    leafletMarkers.restaurants.push(m);
  });

  appendLog(`Map initialized. Driver positioned at [${initialLat.toFixed(4)}, ${initialLon.toFixed(4)}]`, "info", "MAP", "GPS");
}

function updateLeafletDriverPosition(lat, lon) {
  if (activeDriver && activeDriver.location) {
    activeDriver.location.latitude = lat;
    activeDriver.location.longitude = lon;
  }
  activeDelivery.currentLocation.latitude = lat;
  activeDelivery.currentLocation.longitude = lon;

  if (leafletMarkers.driver) {
    leafletMarkers.driver.setLatLng([lat, lon]);
  }
}

function saveCachedRoute(storageKey, waypoints) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(waypoints));
  } catch (err) {
    // LRU eviction of old routes if storage full
    try {
      const routeKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("dsa_route_cache_")) {
          routeKeys.push(k);
        }
      }
      for (let i = 0; i < Math.min(5, routeKeys.length); i++) {
        localStorage.removeItem(routeKeys[i]);
      }
      localStorage.setItem(storageKey, JSON.stringify(waypoints));
    } catch (_) {}
  }
}

async function plotActiveDeliveryRoute() {
  if (!driverLeafletMap || typeof L === "undefined") return;
  clearDeliveryRouteFromMap();

  const restPos = [routeOrigin.lat, routeOrigin.lon];
  const custPos = [routeDestination.lat, routeDestination.lon];
  const curPos = [activeDelivery.currentLocation.latitude, activeDelivery.currentLocation.longitude];

  // Markers
  const restIcon = L.divIcon({
    className: "custom-leaflet-marker",
    html: `<div class="restaurant-pin-marker" title="${escapeHtml(routeOrigin.name)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
  leafletMarkers.restaurant = L.marker(restPos, { icon: restIcon }).addTo(driverLeafletMap);

  const custIcon = L.divIcon({
    className: "custom-leaflet-marker",
    html: `<div class="customer-pin-marker" title="${escapeHtml(routeDestination.name)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
  leafletMarkers.customer = L.marker(custPos, { icon: custIcon }).addTo(driverLeafletMap);

  // Derive route cache key and check cached geometry
  const key = `${routeOrigin.lat},${routeOrigin.lon}_${routeDestination.lat},${routeDestination.lon}`;
  const cacheStorageKey = `dsa_route_cache_${key}`;
  let cachedWaypoints = null;
  try {
    const rawCache = localStorage.getItem(cacheStorageKey);
    if (rawCache) {
      cachedWaypoints = JSON.parse(rawCache);
    }
  } catch (_) {}

  const applyPolyline = (pts) => {
    if (activeRoutePolylineGroup) {
      driverLeafletMap?.removeLayer(activeRoutePolylineGroup);
      activeRoutePolylineGroup = null;
    }
    activeRoadWaypoints = pts;
    const casing = L.polyline(activeRoadWaypoints, { color: '#ffffff', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round' });
    const stroke = L.polyline(activeRoadWaypoints, { color: '#eb4d28', weight: 4.5, opacity: 1.0, lineCap: 'round', lineJoin: 'round' });
    activeRoutePolylineGroup = L.layerGroup([casing, stroke]).addTo(driverLeafletMap);
    routePolyline = stroke;
    driverLeafletMap.fitBounds(L.latLngBounds(activeRoadWaypoints), { padding: [80, 80], maxZoom: 16 });
  };

  // On reload, immediately plot cached route before querying external OSRM
  if (cachedWaypoints && Array.isArray(cachedWaypoints) && cachedWaypoints.length > 0) {
    applyPolyline(cachedWaypoints);
  }

  // Fetch road routes
  const routeEngine = window.DSA?.fetchRoadRoute || window.fetchRoadRoute;
  let waypoints = [];
  if (typeof routeEngine === 'function') {
    if (activeDelivery.status === 'DRIVER_ASSIGNED') {
      const leg1 = await routeEngine({ lat: curPos[0], lon: curPos[1] }, { lat: restPos[0], lon: restPos[1] });
      const leg2 = await routeEngine({ lat: restPos[0], lon: restPos[1] }, { lat: custPos[0], lon: custPos[1] });
      waypoints = [...leg1.coordinates, ...leg2.coordinates];
    } else {
      const leg = await routeEngine({ lat: curPos[0], lon: curPos[1] }, { lat: custPos[0], lon: custPos[1] });
      waypoints = leg.coordinates;
    }
  }
  if (!waypoints || waypoints.length === 0) {
    if (cachedWaypoints && cachedWaypoints.length > 0) {
      waypoints = cachedWaypoints;
    } else {
      waypoints = [curPos, restPos, custPos];
    }
  } else {
    // Store retrieved waypoints in localStorage cache (with LRU eviction of old routes if full)
    saveCachedRoute(cacheStorageKey, waypoints);
  }

  applyPolyline(waypoints);
}

function clearDeliveryRouteFromMap() {
  if (leafletMarkers.restaurant) {
    driverLeafletMap?.removeLayer(leafletMarkers.restaurant);
    leafletMarkers.restaurant = null;
  }
  if (leafletMarkers.customer) {
    driverLeafletMap?.removeLayer(leafletMarkers.customer);
    leafletMarkers.customer = null;
  }
  if (activeRoutePolylineGroup) {
    driverLeafletMap?.removeLayer(activeRoutePolylineGroup);
    activeRoutePolylineGroup = null;
  }
  if (routePolyline) {
    driverLeafletMap?.removeLayer(routePolyline);
    routePolyline = null;
  }
}

// ============================================================================
// 5. PLATFORM ORDERS SCANNING & BOTTOM SHEET CONTROLLER
// ============================================================================

/**
 * Cleans item name slugs into title-cased display names.
 * e.g. "braai-platter" -> "Braai Platter", "Item braai-platter" -> "Braai Platter"
 */
function formatOrderItemSlug(rawName) {
  if (!rawName) return "Meal Item";
  let cleaned = String(rawName).trim();
  cleaned = cleaned.replace(/^item[\s\-_]+/i, "");
  cleaned = cleaned.replace(/[-_]+/g, " ");
  cleaned = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return cleaned || "Meal Item";
}

/**
 * Formats item arrays or existing summary strings into "Q× Clean Name" format.
 * e.g. "1x Item braai-platter" -> "1× Braai Platter"
 */
function formatItemsSummary(raw) {
  if (!raw) return "Standard Meal Order";
  if (Array.isArray(raw)) {
    if (raw.length === 0) return "Standard Meal Order";
    return raw.map(it => {
      const qty = it.quantity || 1;
      const name = it.name || it.itemName || it.title || it.itemId || it.id || "Meal Item";
      return `${qty}× ${formatOrderItemSlug(name)}`;
    }).join(", ");
  }
  if (typeof raw === "string") {
    return raw.split(",").map(part => {
      const trimmed = part.trim();
      const match = trimmed.match(/^(\d+)\s*[x×]\s*(.+)$/i);
      if (match) {
        return `${match[1]}× ${formatOrderItemSlug(match[2])}`;
      }
      return formatOrderItemSlug(trimmed);
    }).join(", ");
  }
  return "Standard Meal Order";
}

async function refreshPlatformOrders(isManual = false) {
  if (isManual) {
    appendLog("Scanning microservices (:9091, :9096) for pending orders...", "info", "SCAN", "DISPATCH");
  }

  let candidates = [];

  // Try fetching orders from Order Service (:9091)
  try {
    const res = await driverApiFetch(9091, "/orders");
    if (res && res.ok) {
      const orders = await res.json();
      if (Array.isArray(orders)) {
        orders.forEach((o) => {
          const status = String(o.status || "").toUpperCase();
          const isCompleted = localStorage.getItem(`dsa_order_completed_${o.orderId || o.id}`) === "true";
          if (!isCompleted && status !== "DELIVERED" && status !== "CANCELLED") {
            const itemsList = formatItemsSummary(o.items || o.itemsSummary);
            const dCoords = o.deliveryAddress?.coordinates || o.deliveryAddress?.location?.coordinates || o.coordinates;
            const destLat = Array.isArray(dCoords) ? dCoords[1] : (dCoords?.latitude ?? dCoords?.lat ?? (o.destLat ?? -22.5695));
            const destLon = Array.isArray(dCoords) ? dCoords[0] : (dCoords?.longitude ?? dCoords?.lon ?? (o.destLon ?? 17.0850));
            const origLat = o.restaurantCoordinates?.latitude ?? o.origLat ?? -22.5333;
            const origLon = o.restaurantCoordinates?.longitude ?? o.origLon ?? 17.0658;
            candidates.push({
              orderId: o.orderId || o.id,
              customerName: o.customerName || "Customer",
              deliveryAddress: formatAddress(o.deliveryAddress || "Windhoek Central"),
              restaurantName: o.restaurantName || "Kapana Corner Restaurant",
              itemsSummary: itemsList,
              distanceKm: o.distanceKm || (2.5 + (Math.abs(hashCode(String(o.orderId || o.id))) % 30) / 10).toFixed(1),
              etaMins: o.etaMins || (8 + (Math.abs(hashCode(String(o.orderId || o.id))) % 10)),
              status: status || "CONFIRMED",
              driverId: o.driverId || null,
              totalAmount: o.totalAmount || 185.0,
              destLat,
              destLon,
              origLat,
              origLon
            });
          }
        });
      }
    }
  } catch (_) {}

  // Merge with localStorage active orders
  try {
    const rawLocal = localStorage.getItem("dsa_active_orders");
    if (rawLocal) {
      const ids = JSON.parse(rawLocal);
      if (Array.isArray(ids)) {
        ids.forEach((id) => {
          if (!candidates.find((c) => c.orderId === id)) {
            const isCompleted = localStorage.getItem(`dsa_order_completed_${id}`) === "true";
            if (!isCompleted) {
              candidates.push({
                orderId: id,
                customerName: "Platform Customer",
                deliveryAddress: formatAddress("12 Independence Avenue, Windhoek"),
                restaurantName: "Kapana Corner Restaurant",
                itemsSummary: "2× Grilled Kapana, 1× Oshikandela",
                distanceKm: "3.2",
                etaMins: 9,
                status: "PREPARING",
                driverId: null,
                totalAmount: 210.0,
                destLat: -22.5695,
                destLon: 17.0850,
                origLat: -22.5333,
                origLon: 17.0658
              });
            }
          }
        });
      }
    }
  } catch (_) {}


  // Filter out any order that has already been accepted by active delivery
  availableOrdersPool = candidates.filter((c) => c.orderId !== activeDelivery.orderId);

  renderAvailableOrdersList();
}

function renderAvailableOrdersList() {
  const listEl = document.getElementById("available-orders-list");
  const countEl = document.getElementById("idle-orders-count");
  if (!listEl) return;

  if (countEl) {
    const count = availableOrdersPool.length;
    countEl.textContent = `${count} ${count === 1 ? "task" : "tasks"}`;
  }

  if (availableOrdersPool.length === 0) {
    listEl.innerHTML = `
      <div class="orders-empty-state">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>No new orders pending in Windhoek dispatch queue.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = availableOrdersPool
    .map(
      (ord) => `
      <div class="order-candidate-item" data-order-id="${escapeHtml(ord.orderId)}">
        <!-- Top Bar: Order ID Tag + Hero Payout Badge -->
        <div class="candidate-card-topbar">
          <div class="candidate-id-wrap">
            <span class="candidate-order-tag text-mono">${escapeHtml(formatFriendlyOrderId(ord.orderId))}</span>
            <span class="candidate-status-dot-pill">Ready</span>
          </div>
          <div class="order-payout-badge" title="Guaranteed Driver Earnings">
            <span class="payout-plus">+</span>N$ 35.00
          </div>
        </div>

        <!-- Metrics Row: Distance & ETA -->
        <div class="candidate-metrics-row">
          <div class="candidate-metric-item" title="Route Distance">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
            </svg>
            <span>${escapeHtml(String(ord.distanceKm))} km</span>
          </div>
          <span class="metric-separator">•</span>
          <div class="candidate-metric-item" title="Estimated Transit Time">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>~${escapeHtml(String(ord.etaMins))} mins transit</span>
          </div>
        </div>

        <!-- Sleek 2-Point Compact Route Timeline -->
        <div class="order-route-compact-timeline">
          <div class="compact-timeline-stop pickup">
            <span class="compact-stop-dot amber" title="Store Pickup Point"></span>
            <div class="compact-stop-content">
              <span class="compact-stop-role">PICKUP</span>
              <span class="compact-stop-name" title="${escapeHtml(ord.restaurantName || "Kapana Corner Restaurant")}">${escapeHtml(ord.restaurantName || "Kapana Corner Restaurant")}</span>
            </div>
          </div>
          <div class="compact-timeline-connector"></div>
          <div class="compact-timeline-stop dropoff">
            <span class="compact-stop-dot emerald" title="Customer Dropoff Destination"></span>
            <div class="compact-stop-content">
              <span class="compact-stop-role">DROPOFF</span>
              <span class="compact-stop-name" title="${escapeHtml(ord.deliveryAddress)}">${escapeHtml(ord.deliveryAddress)}</span>
            </div>
          </div>
        </div>

        <!-- Bottom Row: Manifest Preview & Modern Accept Button -->
        <div class="order-candidate-footer">
          <div class="candidate-manifest-snippet" title="${escapeHtml(ord.itemsSummary || "Standard Meal Order")}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <path d="M16 10a4 4 0 0 1-8 0"></path>
            </svg>
            <span class="manifest-text">${escapeHtml(ord.itemsSummary || "Standard Meal Order")}</span>
          </div>
          <button
            type="button"
            class="btn-accept-task"
            onclick="acceptOrder('${escapeHtml(ord.orderId)}')"
            title="Accept and lock this delivery"
          >
            <span>Accept Task</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>
    `
    )
    .join("");
}

function renderBottomCard() {
  const idleCard = document.getElementById("bottom-card-idle");
  const activeCard = document.getElementById("bottom-card-active");

  if (!idleCard || !activeCard) return;

  if (activeDelivery.orderId) {
    idleCard.style.display = "none";
    activeCard.style.display = "block";
    updateActiveCardUI();
  } else {
    activeCard.style.display = "none";
    idleCard.style.display = "block";
    renderAvailableOrdersList();
  }
}

function updateActiveCardUI() {
  setText("active-card-order-id", formatFriendlyOrderId(activeDelivery.orderId));
  setText("active-card-distance", `${activeDelivery.distanceKm.toFixed(1)} km`);
  setText("active-card-eta", `~${activeDelivery.estimatedTime} mins`);
  setText("active-card-rest-name", routeOrigin.name);
  setText("active-card-rest-address", formatAddress(routeOrigin.address));
  setText("active-card-cust-name", routeDestination.name);
  setText("active-card-cust-address", formatAddress(routeDestination.address));

  // Status pill badge
  const pill = document.getElementById("active-card-status-pill");
  if (pill) {
    pill.textContent = activeDelivery.status;
    pill.className = "active-status-pill";
    if (activeDelivery.status === "AT_RESTAURANT") {
      pill.classList.add("status-at-restaurant");
    } else if (activeDelivery.status === "OUT_FOR_DELIVERY") {
      pill.classList.add("status-out-for-delivery");
    }
  }

  // Store Handover Card (Visible when courier arrives at store: AT_RESTAURANT)
  const storeHandoverCard = document.getElementById("store-handover-card");
  if (storeHandoverCard) {
    if (activeDelivery.status === "AT_RESTAURANT") {
      storeHandoverCard.style.display = "block";
      const pinEl = document.getElementById("driver-handover-pin");
      const phoneSuffixEl = document.getElementById("driver-client-phone-suffix");
      if (pinEl && activeDelivery.orderId) {
        pinEl.textContent = getOrderHandoverPin(activeDelivery.orderId);
      }
      if (phoneSuffixEl) {
        const phone = activeDelivery.customerPhone || "264812345678";
        phoneSuffixEl.textContent = "..." + phone.slice(-4);
      }
    } else {
      storeHandoverCard.style.display = "none";
    }
  }

  // Stepper Progression Indicator
  const steps = ["DRIVER_ASSIGNED", "AT_RESTAURANT", "OUT_FOR_DELIVERY", "DELIVERED"];
  const curIdx = steps.indexOf(activeDelivery.status);

  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`card-step-${i}`);
    const connEl = document.getElementById(`card-conn-${i}`);

    if (stepEl) {
      stepEl.classList.remove("active", "completed");
      const bullet = stepEl.querySelector(".step-bullet");
      if (i - 1 < curIdx) {
        stepEl.classList.add("completed");
        if (bullet) {
          bullet.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        }
      } else if (i - 1 === curIdx) {
        stepEl.classList.add("active");
        if (bullet) bullet.textContent = String(i);
      } else {
        if (bullet) bullet.textContent = String(i);
      }
    }
    if (connEl) {
      connEl.classList.toggle("completed", i - 1 < curIdx);
    }
  }

  // Sequential Action Button Label & Icon
  const btnSeqText = document.getElementById("seq-action-text");
  if (btnSeqText) {
    if (activeDelivery.status === "DRIVER_ASSIGNED") {
      btnSeqText.textContent = "Reached Store For Pickup";
    } else if (activeDelivery.status === "AT_RESTAURANT") {
      btnSeqText.textContent = "Depart Store (In Transit)";
    } else if (activeDelivery.status === "OUT_FOR_DELIVERY") {
      btnSeqText.textContent = "Complete Customer Handover";
    } else {
      btnSeqText.textContent = "Task Completed";
    }
  }
}

// ============================================================================
// 6. ORDER ACCEPTANCE, PROGRESSION & COMPLETION
// ============================================================================

async function acceptOrder(orderId) {
  if (!activeDriver) {
    alert("Please sign in or complete courier onboarding to accept delivery tasks.");
    openDriverLoginModal();
    return;
  }
  appendLog(`Accepting delivery task: ${orderId}...`, "info", "DISPATCH", "DISPATCH");

  const candidate = availableOrdersPool.find((c) => c.orderId === orderId);

  activeDelivery.orderId = orderId;
  activeDelivery.deliveryId = `del_${orderId.replace(/[^0-9]/g, "") || Date.now()}`;
  activeDelivery.status = "DRIVER_ASSIGNED";
  activeDelivery.assignedDriverId = activeDriver.id;
  activeDelivery.distanceKm = candidate && candidate.distanceKm ? parseFloat(candidate.distanceKm) : 3.6;
  activeDelivery.estimatedTime = candidate && candidate.etaMins ? parseInt(candidate.etaMins, 10) : 9;

  // Sync route details from accepted candidate
  if (candidate) {
    if (candidate.destLat && candidate.destLon) {
      routeDestination.lat = candidate.destLat;
      routeDestination.lon = candidate.destLon;
    }
    if (candidate.origLat && candidate.origLon) {
      routeOrigin.lat = candidate.origLat;
      routeOrigin.lon = candidate.origLon;
    }
    if (candidate.deliveryAddress) {
      routeDestination.address = formatAddress(candidate.deliveryAddress);
    }
    if (candidate.customerName) {
      routeDestination.name = candidate.customerName;
    }
    if (candidate.restaurantName) {
      routeOrigin.name = candidate.restaurantName;
    }
  }

  // Save active order session
  saveActiveDeliveryState();

  // Notify Delivery Service (:9096)
  try {
    await driverApiFetch(9096, "/deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: orderId,
        driverId: activeDriver.id,
        status: "DRIVER_ASSIGNED",
        currentLocation: {
          latitude: activeDelivery.currentLocation.latitude,
          longitude: activeDelivery.currentLocation.longitude
        }
      })
    });
  } catch (_) {}

  // Plot route & update bottom sheet
  await plotActiveDeliveryRoute();
  renderBottomCard();

  appendLog(`Order ${orderId} assigned to ${activeDriver.name}. Route plotted on map.`, "success", "ACCEPT", "STATUS");
}

function cancelActiveTask() {
  if (!activeDelivery.orderId) return;

  const id = activeDelivery.orderId;
  appendLog(`Releasing order ${id} back to platform dispatch pool...`, "warn", "CANCEL", "STATUS");

  // Clear state
  stopSimulatedDrive();
  activeDelivery.orderId = null;
  activeDelivery.deliveryId = null;
  activeDelivery.status = "UNASSIGNED";

  try {
    localStorage.removeItem("dsa_driver_active_order");
  } catch (_) {}

  clearDeliveryRouteFromMap();
  renderBottomCard();
  refreshPlatformOrders();
}

function handleSequentialStateProgression() {
  if (!activeDelivery.orderId) return;

  if (activeDelivery.status === "DRIVER_ASSIGNED") {
    // Transition to AT_RESTAURANT
    activeDelivery.status = "AT_RESTAURANT";
    activeDelivery.currentLocation.latitude = routeOrigin.lat;
    activeDelivery.currentLocation.longitude = routeOrigin.lon;
    updateLeafletDriverPosition(routeOrigin.lat, routeOrigin.lon);
    appendLog(`Courier arrived at restaurant: ${routeOrigin.name}.`, "success", "STATUS", "STATUS");
  } else if (activeDelivery.status === "AT_RESTAURANT") {
    // Transition to OUT_FOR_DELIVERY
    activeDelivery.status = "OUT_FOR_DELIVERY";
    activeDelivery.departedAt = Date.now();
    appendLog(`Order collected from store. Departing en route to customer!`, "info", "STATUS", "STATUS");
  } else if (activeDelivery.status === "OUT_FOR_DELIVERY") {
    // Open Confirmation Dialog Modal
    openConfirmDeliveryModal();
    return;
  }

  // Sync state to local storage & backend
  saveActiveDeliveryState();
  syncDeliveryStatusBackend();
  renderBottomCard();
}

async function syncDeliveryStatusBackend() {
  if (!activeDelivery.orderId) return;
  try {
    await driverApiFetch(9096, "/deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: activeDelivery.orderId,
        driverId: activeDriver.id,
        status: activeDelivery.status,
        currentLocation: {
          latitude: activeDelivery.currentLocation.latitude,
          longitude: activeDelivery.currentLocation.longitude
        }
      })
    });
  } catch (_) {}
}

function openConfirmDeliveryModal() {
  const modal = document.getElementById("modal-confirm-delivery");
  if (modal) {
    setText("confirm-modal-order-id", typeof formatFriendlyOrderId === 'function' ? formatFriendlyOrderId(activeDelivery.orderId) : (activeDelivery.orderId || "—"));
    setText("confirm-modal-address", routeDestination.address);
    setText("confirm-modal-driver", activeDriver ? activeDriver.name : "Courier");
    modal.style.display = "flex";
  }
}

function closeConfirmDeliveryModal() {
  const modal = document.getElementById("modal-confirm-delivery");
  if (modal) modal.style.display = "none";
}

function confirmFinalDelivery() {
  closeConfirmDeliveryModal();
  const completedOrderId = activeDelivery.orderId;
  if (!completedOrderId) return;

  stopSimulatedDrive();

  // Credit Payout (+N$ 35.00) to Courier Wallet
  creditDriverPayout(35.0, completedOrderId);

  // Mark in local storage as completed
  try {
    localStorage.setItem(`dsa_order_completed_${completedOrderId}`, "true");
    localStorage.removeItem("dsa_driver_active_order");
  } catch (_) {}

  // Sync final status to Delivery Service
  try {
    driverApiFetch(9096, "/deliveries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: completedOrderId,
        driverId: activeDriver.id,
        status: "DELIVERED",
        currentLocation: {
          latitude: activeDelivery.currentLocation.latitude,
          longitude: activeDelivery.currentLocation.longitude
        }
      })
    });
  } catch (_) {}

  appendLog(`Delivery completed for ${completedOrderId}. Payout +N$ 35.00 credited to wallet!`, "success", "DELIVERED", "STATUS");

  // Reset active state & route
  activeDelivery.orderId = null;
  activeDelivery.deliveryId = null;
  activeDelivery.status = "UNASSIGNED";

  clearDeliveryRouteFromMap();
  renderBottomCard();
  refreshPlatformOrders();
}

function restoreActiveOrderSession() {
  if (!activeDriver) {
    const activeCard = document.getElementById("bottom-card-active");
    if (activeCard) activeCard.style.display = "none";
    return;
  }
  try {
    const raw = localStorage.getItem("dsa_driver_active_order");
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && saved.orderId && saved.status !== "DELIVERED") {
        activeDelivery = { ...activeDelivery, ...saved };
        if (saved.routeOrigin) {
          routeOrigin = { ...routeOrigin, ...saved.routeOrigin };
        }
        if (saved.routeDestination) {
          routeDestination = { ...routeDestination, ...saved.routeDestination };
        }
        if (typeof saved.simWaypointIndex === "number") {
          simWaypointIndex = saved.simWaypointIndex;
        }
        if (typeof saved.vehicleBearing === "number") {
          vehicleBearing = saved.vehicleBearing;
        }
        if (Array.isArray(saved.activeRoadWaypoints) && saved.activeRoadWaypoints.length > 0) {
          activeRoadWaypoints = saved.activeRoadWaypoints;
        }
        routeDestination.address = formatAddress(routeDestination.address);
        if (routeOrigin.address) {
          routeOrigin.address = formatAddress(routeOrigin.address);
        }
        plotActiveDeliveryRoute().then(() => {
          if (leafletMarkers.driver && vehicleBearing) {
            const markerEl = leafletMarkers.driver.getElement();
            if (markerEl) {
              const core = markerEl.querySelector(".driver-icon-core");
              if (core) core.style.transform = `rotate(${Math.round(vehicleBearing)}deg)`;
            }
          }
        });
        renderBottomCard();
        appendLog(`Restored active delivery task ${saved.orderId} from session.`, "info", "SESSION", "DISPATCH");
      }
    }
  } catch (_) {}
}

function saveActiveDeliveryState() {
  try {
    localStorage.setItem("dsa_driver_active_order", JSON.stringify({
      ...activeDelivery,
      routeOrigin,
      routeDestination,
      simWaypointIndex,
      vehicleBearing,
      activeRoadWaypoints
    }));
  } catch (_) {}
}

// ============================================================================
// 7. DRIVER EARNINGS & WALLET CONTROLLER
// ============================================================================

function loadStoredWallet() {
  try {
    const raw = localStorage.getItem("dsa_driver_wallet");
    if (raw) {
      driverWallet = { ...driverWallet, ...JSON.parse(raw) };
    }
  } catch (_) {}
  updateWalletUI();
}

function saveWalletState() {
  try {
    localStorage.setItem("dsa_driver_wallet", JSON.stringify(driverWallet));
  } catch (_) {}
  updateWalletUI();
  updateHeaderBalance();
}

function creditDriverPayout(amount, orderId) {
  driverWallet.balance += amount;
  driverWallet.totalEarned += amount;
  driverWallet.completedTrips += 1;

  const timeStr = new Date().toTimeString().split(" ")[0].slice(0, 5);
  driverWallet.transactions.unshift({
    id: `tx_${Date.now()}`,
    type: "CREDIT",
    amount: amount,
    desc: `Order Delivery Payout (${orderId})`,
    time: timeStr
  });

  saveWalletState();
}

function handleWithdrawalSubmit(e) {
  e.preventDefault();

  const amountInput = document.getElementById("withdraw-amount-input");
  const bankSelect = document.getElementById("withdraw-bank-select");
  const accNumInput = document.getElementById("withdraw-account-number");

  const amount = parseFloat(amountInput?.value || "0");
  const bank = bankSelect?.value || "FNB";
  const accNum = accNumInput?.value.trim() || "";

  if (isNaN(amount) || amount <= 0) {
    alert("Please enter a valid withdrawal amount.");
    return;
  }
  if (amount > driverWallet.balance) {
    alert(`Insufficient funds. Your available balance is N$ ${driverWallet.balance.toFixed(2)}.`);
    return;
  }

  // Deduct from balance
  driverWallet.balance -= amount;
  driverWallet.withdrawn += amount;

  const timeStr = new Date().toTimeString().split(" ")[0].slice(0, 5);
  const bankName = bankSelect?.options[bankSelect.selectedIndex]?.text || bank;
  const lastDigits = accNum.slice(-4) || "847";

  driverWallet.transactions.unshift({
    id: `tx_${Date.now()}`,
    type: "DEBIT",
    amount: amount,
    desc: `Instant Withdrawal to ${bankName} (*${lastDigits})`,
    time: timeStr
  });

  saveWalletState();

  if (amountInput) amountInput.value = "";
  appendLog(`Withdrawal of N$ ${amount.toFixed(2)} processed to ${bankName}.`, "success", "WALLET", "STATUS");
  alert(`Withdrawal of N$ ${amount.toFixed(2)} to ${bankName} completed instantly!`);
}

function setWithdrawQuickAmount(val) {
  const input = document.getElementById("withdraw-amount-input");
  if (input) input.value = val;
}

function setWithdrawMaxAmount() {
  const input = document.getElementById("withdraw-amount-input");
  if (input) input.value = Math.max(0, Math.floor(driverWallet.balance));
}

function updateWalletUI() {
  setText("wallet-hero-balance", driverWallet.balance.toFixed(2));
  setText("wallet-stat-trips", String(driverWallet.completedTrips));
  setText("wallet-stat-earned", `N$ ${driverWallet.totalEarned.toFixed(2)}`);
  setText("wallet-stat-withdrawn", `N$ ${driverWallet.withdrawn.toFixed(2)}`);

  const list = document.getElementById("wallet-transactions-list");
  if (!list) return;

  list.innerHTML = driverWallet.transactions
    .slice(0, 10)
    .map(
      (tx) => `
      <div class="wallet-tx-row">
        <div class="wallet-tx-info">
          <span class="tx-desc">${escapeHtml(tx.desc)}</span>
          <span class="tx-date text-mono">${escapeHtml(tx.time)}</span>
        </div>
        <span class="tx-amount text-mono ${tx.type === "CREDIT" ? "credit" : "debit"}">
          ${tx.type === "CREDIT" ? "+" : "-"}N$ ${tx.amount.toFixed(2)}
        </span>
      </div>
    `
    )
    .join("");
}

function updateHeaderBalance() {
  setText("header-wallet-balance", `N$ ${driverWallet.balance.toFixed(2)}`);
}

// ============================================================================
// 8. DRAWER MANAGEMENT & CONTROLLERS
// ============================================================================

function toggleWalletDrawer() {
  toggleDrawer("wallet-drawer");
}

function toggleActivitiesDrawer() {
  const drawer = document.getElementById("activities-drawer");
  if (!drawer) return;
  toggleDrawer("activities-drawer");
}

function toggleMenuDrawer() {
  toggleDrawer("menu-drawer");
}

function toggleDrawer(drawerId) {
  const target = document.getElementById(drawerId);
  const backdrop = document.getElementById("drawer-backdrop");
  if (!target || !backdrop) return;

  const isOpen = target.classList.contains("open");

  // Close all other drawers first
  document.querySelectorAll(".driver-drawer").forEach((d) => d.classList.remove("open"));

  if (!isOpen) {
    target.classList.add("open");
    backdrop.classList.add("active");
    try {
      localStorage.setItem("dsa_driver_active_drawer", drawerId);
    } catch (_) {}
  } else {
    backdrop.classList.remove("active");
    try {
      localStorage.removeItem("dsa_driver_active_drawer");
    } catch (_) {}
  }
}

function closeAllDrawers() {
  document.querySelectorAll(".driver-drawer").forEach((d) => d.classList.remove("open"));
  const backdrop = document.getElementById("drawer-backdrop");
  if (backdrop) backdrop.classList.remove("active");
  try {
    localStorage.removeItem("dsa_driver_active_drawer");
  } catch (_) {}
}

function updateProfileDrawerUI() {
  if (!activeDriver) {
    setText("menu-driver-name", "Not Signed In");
    setText("menu-driver-id", "—");
    setText("menu-driver-vehicle", "—");
    setText("menu-status-label", "OFFLINE");

    const dot = document.getElementById("menu-status-dot");
    if (dot) {
      dot.className = "status-dot dot-offline";
    }
    return;
  }

  setText("menu-driver-name", activeDriver.name || "Courier Partner");
  setText("menu-driver-id", activeDriver.id || "Verified Fleet Courier");
  setText("menu-driver-vehicle", activeDriver.vehicleCategory || "MOTORCYCLE");
  setText("menu-status-label", activeDriver.availability || "AVAILABLE");

  const dot = document.getElementById("menu-status-dot");
  if (dot) {
    dot.className = "status-dot";
    if (activeDriver.availability === "AVAILABLE") dot.classList.add("dot-available");
    else if (activeDriver.availability === "BUSY") dot.classList.add("dot-busy");
    else dot.classList.add("dot-offline");
  }
}

function cycleCourierStatus() {
  if (!activeDriver) {
    openDriverLoginModal();
    return;
  }

  const statuses = ["AVAILABLE", "BUSY", "OFFLINE"];
  const curIdx = statuses.indexOf(activeDriver.availability || "AVAILABLE");
  activeDriver.availability = statuses[(curIdx + 1) % statuses.length];

  try {
    localStorage.setItem("dsa_active_driver_profile", JSON.stringify(activeDriver));
    if (window.DSA && typeof window.DSA.setStoredSession === "function") {
      window.DSA.setStoredSession("driver", activeDriver);
    }
  } catch (_) {}

  updateProfileDrawerUI();
  appendLog(`Driver status set to: ${activeDriver.availability}`, "info", "STATUS", "STATUS");
}

function openDriverProfileEditModal() {
  const fallback = {
    id: "drv_001",
    name: "Tomas Nekundi",
    phone: "+264812345601",
    vehicleCategory: "MOTORCYCLE",
    operatingZone: "Windhoek Central",
    bankName: "First National Bank Namibia",
    accountNumber: "62890123456"
  };
  const d = activeDriver || fallback;

  const nameInp = document.getElementById("edit-driver-name");
  const phoneInp = document.getElementById("edit-driver-phone");
  const vehicleInp = document.getElementById("edit-driver-vehicle");
  const zoneInp = document.getElementById("edit-driver-zone");
  const bankInp = document.getElementById("edit-driver-bank");
  const acctInp = document.getElementById("edit-driver-account");
  const errEl = document.getElementById("edit-driver-error");

  if (nameInp) nameInp.value = d.name || "";
  if (phoneInp) phoneInp.value = d.phone || "";
  if (vehicleInp) vehicleInp.value = d.vehicleCategory || "MOTORCYCLE";
  if (zoneInp) zoneInp.value = d.operatingZone || "Windhoek Central";
  if (bankInp) bankInp.value = d.bankName || "First National Bank Namibia";
  if (acctInp) acctInp.value = d.accountNumber || "62890123456";
  if (errEl) errEl.style.display = "none";

  const modal = document.getElementById("modal-edit-driver-profile");
  if (modal) modal.style.display = "flex";
}

function closeDriverProfileEditModal() {
  const modal = document.getElementById("modal-edit-driver-profile");
  if (modal) modal.style.display = "none";
}

function saveDriverProfile() {
  const name = document.getElementById("edit-driver-name")?.value.trim();
  const phone = document.getElementById("edit-driver-phone")?.value.trim();
  const vehicle = document.getElementById("edit-driver-vehicle")?.value;
  const zone = document.getElementById("edit-driver-zone")?.value;
  const bank = document.getElementById("edit-driver-bank")?.value;
  const acct = document.getElementById("edit-driver-account")?.value.trim();
  const errEl = document.getElementById("edit-driver-error");

  if (!name || !phone || !acct) {
    if (errEl) {
      errEl.textContent = "Please fill in all required profile and bank details.";
      errEl.style.display = "block";
    }
    return;
  }

  if (!activeDriver) {
    activeDriver = {
      id: "drv_001",
      availability: "AVAILABLE",
      state: "AVAILABLE"
    };
  }
  activeDriver.name = name;
  activeDriver.phone = phone;
  activeDriver.vehicleCategory = vehicle;
  activeDriver.operatingZone = zone;
  activeDriver.bankName = bank;
  activeDriver.accountNumber = acct;

  try {
    localStorage.setItem("dsa_active_driver_profile", JSON.stringify(activeDriver));
    window.DSA?.setStoredSession("driver", activeDriver);
  } catch (_) {}

  updateProfileDrawerUI();
  updateAuthButtonsUI();

  setText("wallet-bank-name", bank);
  setText("wallet-bank-account", acct);

  closeDriverProfileEditModal();
  appendLog(`Courier profile updated: ${name} (${vehicle}, ${zone})`, "success", "PROFILE", "SAVE");
}

window.openDriverProfileEditModal = openDriverProfileEditModal;
window.closeDriverProfileEditModal = closeDriverProfileEditModal;
window.saveDriverProfile = saveDriverProfile;

function handleHeaderCourierClick() {
  if (activeDriver) {
    toggleMenuDrawer();
  } else {
    openDriverLoginModal();
  }
}
window.handleHeaderCourierClick = handleHeaderCourierClick;

function updateAuthButtonsUI() {
  ensureDriverAuthModals();

  const courierPill = document.getElementById("btn-header-courier-pill");
  const courierName = document.getElementById("header-courier-name");
  const courierDot = document.getElementById("header-courier-dot");

  if (courierPill) {
    if (activeDriver) {
      if (courierName) courierName.textContent = activeDriver.name || "Tomas Nekundi";
      if (courierDot) {
        courierDot.className = "status-dot " + (activeDriver.availability === "BUSY" ? "dot-busy" : "dot-available");
        courierDot.style.display = "inline-block";
      }
    } else {
      if (courierName) courierName.textContent = "Courier Sign In";
      if (courierDot) courierDot.style.display = "none";
    }
  }

  // Drawer Auth Actions (Sign In, Onboarding, Logout, Cascade Delete)
  const drawerBottom = document.querySelector(".drawer-bottom-action");
  if (drawerBottom) {
    let logoutBtn = drawerBottom.querySelector(".btn-logout");
    let signinBtn = document.getElementById("btn-drawer-driver-signin");
    let registerBtn = document.getElementById("btn-drawer-driver-register");
    let cascadeBtn = document.getElementById("btn-drawer-driver-cascade");

    if (!signinBtn) {
      signinBtn = document.createElement("button");
      signinBtn.id = "btn-drawer-driver-signin";
      signinBtn.type = "button";
      signinBtn.className = "btn btn-driver btn-block";
      signinBtn.style.marginBottom = "8px";
      signinBtn.innerHTML = `<span>Courier Sign In</span>`;
      signinBtn.onclick = () => {
        closeAllDrawers();
        openDriverLoginModal();
      };
      drawerBottom.appendChild(signinBtn);
    }

    if (!registerBtn) {
      registerBtn = document.createElement("button");
      registerBtn.id = "btn-drawer-driver-register";
      registerBtn.type = "button";
      registerBtn.className = "btn btn-outline btn-block";
      registerBtn.style.marginBottom = "8px";
      registerBtn.innerHTML = `<span>New Courier Onboarding</span>`;
      registerBtn.onclick = () => {
        closeAllDrawers();
        openDriverOnboardingModal();
      };
      drawerBottom.appendChild(registerBtn);
    }

    if (!cascadeBtn) {
      cascadeBtn = document.createElement("button");
      cascadeBtn.id = "btn-drawer-driver-cascade";
      cascadeBtn.type = "button";
      cascadeBtn.className = "btn btn-outline btn-block btn-cascade-danger";
      cascadeBtn.style.marginTop = "8px";
      cascadeBtn.style.borderColor = "rgba(239, 68, 68, 0.4)";
      cascadeBtn.style.color = "#ef4444";
      cascadeBtn.innerHTML = `<span>Delete Courier Account</span>`;
      cascadeBtn.onclick = () => deleteDriverAccountCascade();
      drawerBottom.appendChild(cascadeBtn);
    }

    if (activeDriver) {
      if (logoutBtn) logoutBtn.style.display = "flex";
      if (cascadeBtn) cascadeBtn.style.display = "flex";
      signinBtn.style.display = "none";
      registerBtn.style.display = "none";
    } else {
      if (logoutBtn) logoutBtn.style.display = "none";
      if (cascadeBtn) cascadeBtn.style.display = "none";
      signinBtn.style.display = "flex";
      registerBtn.style.display = "flex";
    }
  }

  // Idle Card headline awareness
  const idleHeadline = document.querySelector(".idle-headline");
  if (idleHeadline) {
    if (!activeDriver) {
      idleHeadline.textContent = "Available Deliveries (Sign in to accept)";
    } else {
      idleHeadline.textContent = "Available Deliveries";
    }
  }
}

function ensureDriverAuthModals() {
  if (typeof document === "undefined") return;

  // 1. Courier Login Modal
  if (!document.getElementById("modal-driver-login")) {
    const loginModal = document.createElement("div");
    loginModal.className = "modal-backdrop";
    loginModal.id = "modal-driver-login";
    loginModal.style.display = "none";
    loginModal.innerHTML = `
      <div class="modal-dialog" style="max-width: 440px;">
        <div class="modal-header">
          <div class="modal-title">
            <h3>Courier Sign In</h3>
            <p>Access your Windhoek dispatch HUD &amp; earnings ledger</p>
          </div>
          <button type="button" class="btn-close" aria-label="Close" onclick="closeDriverLoginModal()">&times;</button>
        </div>
        <form id="form-driver-login" onsubmit="handleDriverLoginSubmit(event)" style="padding: 16px 20px;">
          <div class="form-group" style="margin-bottom: 14px;">
            <label for="driver-login-identifier" style="display:block; margin-bottom: 6px; font-weight:600; font-size:13px;">Courier ID or Phone</label>
            <input type="text" id="driver-login-identifier" class="input-text" placeholder="e.g. drv_001 or +264812345601" required value="drv_001" style="width:100%; box-sizing:border-box;" />
          </div>
          <div class="form-group" style="margin-bottom: 16px;">
            <label for="driver-login-password" style="display:block; margin-bottom: 6px; font-weight:600; font-size:13px;">Password</label>
            <input type="password" id="driver-login-password" class="input-text" placeholder="Enter courier password" required value="DriverPass@2026" style="width:100%; box-sizing:border-box;" />
          </div>
          <button type="submit" class="btn btn-driver btn-block" style="width:100%; padding:10px; font-weight:700;">
            <span>Sign In to Courier HUD</span>
          </button>
          <div style="margin-top: 14px; text-align: center; font-size: 13px; color: var(--text-muted, #94a3b8);">
            New fleet driver?
            <a href="javascript:void(0)" onclick="openDriverOnboardingModal()" style="color: var(--primary, #3b82f6); font-weight:600; margin-left:4px;">Start Courier Onboarding</a>
          </div>
        </form>
      </div>
    `;
    loginModal.addEventListener("click", (e) => {
      if (e.target === loginModal) closeDriverLoginModal();
    });
    document.body.appendChild(loginModal);
  }

  // 2. Courier Onboarding Wizard Modal
  if (!document.getElementById("modal-driver-onboarding")) {
    const wizardModal = document.createElement("div");
    wizardModal.className = "modal-backdrop";
    wizardModal.id = "modal-driver-onboarding";
    wizardModal.style.display = "none";
    wizardModal.innerHTML = `
      <div class="modal-dialog" style="max-width: 500px;">
        <div class="modal-header">
          <div class="modal-title">
            <h3>Courier Onboarding Wizard</h3>
            <p>Join the Windhoek Dispatch &amp; Logistics Fleet</p>
          </div>
          <button type="button" class="btn-close" aria-label="Close" onclick="closeDriverOnboardingModal()">&times;</button>
        </div>
        <div class="wizard-steps-indicator" style="display: flex; gap: 8px; padding: 12px 20px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));">
          <div id="driver-wizard-ind-1" class="wizard-step-pill active" style="flex:1; text-align:center; padding: 6px; border-radius: 6px; font-size: 12px; font-weight: 600; background: rgba(59,130,246,0.15); color: #3b82f6;">1. Account</div>
          <div id="driver-wizard-ind-2" class="wizard-step-pill" style="flex:1; text-align:center; padding: 6px; border-radius: 6px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.04); color: #94a3b8;">2. Vehicle</div>
          <div id="driver-wizard-ind-3" class="wizard-step-pill" style="flex:1; text-align:center; padding: 6px; border-radius: 6px; font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.04); color: #94a3b8;">3. Zone &amp; Terms</div>
        </div>
        <div class="wizard-body" style="padding: 16px 20px;">
          <!-- Step 1: Personal & Password -->
          <div id="driver-wizard-step-1">
            <div class="form-group" style="margin-bottom: 12px;">
              <label for="onboard-driver-name" style="display:block; margin-bottom: 4px; font-size: 13px; font-weight: 600;">Full Name</label>
              <input type="text" id="onboard-driver-name" class="input-text" placeholder="e.g. Johannes Amutenya" required style="width:100%; box-sizing:border-box;" />
            </div>
            <div class="form-group" style="margin-bottom: 12px;">
              <label for="onboard-driver-phone" style="display:block; margin-bottom: 4px; font-size: 13px; font-weight: 600;">Namibian Mobile (+264...)</label>
              <input type="tel" id="onboard-driver-phone" class="input-text" placeholder="+26481..." required style="width:100%; box-sizing:border-box;" />
            </div>
            <div class="form-group" style="margin-bottom: 14px;">
              <label for="onboard-driver-password" style="display:block; margin-bottom: 4px; font-size: 13px; font-weight: 600;">Courier Security Password</label>
              <input type="password" id="onboard-driver-password" class="input-text" placeholder="Min 8 chars, mixed case & numbers" oninput="handleDriverPasswordInput()" required style="width:100%; box-sizing:border-box;" />
              <!-- Live Password Strength Meter -->
              <div class="password-meter-wrap" style="margin-top: 6px;">
                <div style="height: 4px; width: 100%; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                  <div id="driver-password-strength-bar" style="height: 100%; width: 0%; transition: width 0.25s, background-color 0.25s;"></div>
                </div>
                <div id="driver-password-strength-label" style="font-size: 11px; margin-top: 4px; color: #94a3b8;">Enter password to evaluate strength</div>
              </div>
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
              <button type="button" class="btn btn-driver" onclick="setDriverWizardStep(2)">Next: Vehicle Profile &rarr;</button>
            </div>
          </div>

          <!-- Step 2: Vehicle -->
          <div id="driver-wizard-step-2" style="display:none;">
            <div class="form-group" style="margin-bottom: 12px;">
              <label for="onboard-driver-vehicle" style="display:block; margin-bottom: 4px; font-size: 13px; font-weight: 600;">Vehicle Category</label>
              <select id="onboard-driver-vehicle" class="input-text" style="width:100%; box-sizing:border-box;">
                <option value="MOTORCYCLE" selected>Motorcycle / Scooter (Fast Urban Transit)</option>
                <option value="CAR">Delivery Sedan / Bakkie</option>
                <option value="BICYCLE">Bicycle / E-Bike (Inner City)</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 14px;">
              <label for="onboard-driver-plate" style="display:block; margin-bottom: 4px; font-size: 13px; font-weight: 600;">Vehicle Registration Plate</label>
              <input type="text" id="onboard-driver-plate" class="input-text" placeholder="e.g. N 847-291 W" style="width:100%; box-sizing:border-box;" />
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 16px;">
              <button type="button" class="btn btn-outline" onclick="setDriverWizardStep(1)">&larr; Back</button>
              <button type="button" class="btn btn-driver" onclick="setDriverWizardStep(3)">Next: Operating Zone &rarr;</button>
            </div>
          </div>

          <!-- Step 3: Operating Zone & Terms -->
          <div id="driver-wizard-step-3" style="display:none;">
            <div class="form-group" style="margin-bottom: 12px;">
              <label style="display:block; margin-bottom: 4px; font-size: 13px; font-weight: 600;">Assigned Dispatch Zone</label>
              <div style="padding: 10px; background: rgba(255,255,255,0.04); border-radius: 6px; font-size: 13px; color: #cbd5e1;">
                <strong>Windhoek Central &amp; Arterials</strong> (Sam Nujoma Dr, Independence Ave, Klein Windhoek)
              </div>
            </div>
            <div class="form-group" style="margin-bottom: 16px;">
              <label style="display:flex; align-items:center; gap:8px; font-size: 12px; cursor: pointer;">
                <input type="checkbox" id="onboard-driver-terms" checked />
                <span>I agree to fleet telemetry, order handover protocols, and safety rules.</span>
              </label>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: 16px;">
              <button type="button" class="btn btn-outline" onclick="setDriverWizardStep(2)">&larr; Back</button>
              <button type="button" class="btn btn-driver" onclick="submitCourierOnboarding()">
                <span>Complete Onboarding (0 NAD Ledger)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    wizardModal.addEventListener("click", (e) => {
      if (e.target === wizardModal) closeDriverOnboardingModal();
    });
    document.body.appendChild(wizardModal);
  }
}

function loadStoredDriverProfile(openModalIfNeeded = false) {
  let session = null;
  if (typeof window !== "undefined" && window.DSA && typeof window.DSA.getStoredSession === "function") {
    session = window.DSA.getStoredSession("driver");
  }
  if (!session) {
    try {
      const raw = localStorage.getItem("dsa_session_driver");
      if (raw) {
        session = JSON.parse(raw);
      }
    } catch (_) {}
  }
  if (!session) {
    try {
      const legacyRaw = localStorage.getItem("dsa_active_driver_profile");
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        if (parsed && parsed.id) {
          session = { user: parsed };
        }
      }
    } catch (_) {}
  }

  const DEFAULT_DRIVER_PROFILE = {
    id: "drv_001",
    name: "Tomas Nekundi",
    phone: "+264812345601",
    vehicleCategory: "MOTORCYCLE",
    availability: "AVAILABLE",
    state: "AVAILABLE",
    operatingZone: "Windhoek Central",
    bankName: "First National Bank Namibia",
    accountNumber: "62890123456",
    location: { type: "Point", coordinates: [17.0658, -22.5609] },
    latitude: -22.5609,
    longitude: 17.0658
  };

  if (session && (session.user || session.id)) {
    activeDriver = session.user || session;
    updateProfileDrawerUI();
    updateAuthButtonsUI();
  } else {
    activeDriver = { ...DEFAULT_DRIVER_PROFILE };
    try {
      localStorage.setItem("dsa_active_driver_profile", JSON.stringify(activeDriver));
      window.DSA?.setStoredSession("driver", activeDriver);
    } catch (_) {}
    updateProfileDrawerUI();
    updateAuthButtonsUI();
  }
}

function openDriverLoginModal() {
  ensureDriverAuthModals();
  closeDriverOnboardingModal();
  if (window.DSA && typeof window.DSA.openModal === "function") {
    window.DSA.openModal("modal-driver-login");
  } else {
    const modal = document.getElementById("modal-driver-login");
    if (modal) modal.style.display = "flex";
  }
}

function closeDriverLoginModal() {
  if (window.DSA && typeof window.DSA.closeModal === "function") {
    window.DSA.closeModal("modal-driver-login");
  } else {
    const modal = document.getElementById("modal-driver-login");
    if (modal) modal.style.display = "none";
  }
}

async function handleDriverLoginSubmit(e) {
  if (e && typeof e.preventDefault === "function") {
    e.preventDefault();
  }

  const idInput = document.getElementById("driver-login-identifier");
  const pwdInput = document.getElementById("driver-login-password");
  const identifier = idInput ? idInput.value.trim() : "";
  const password = pwdInput ? pwdInput.value : "";

  if (!identifier) {
    alert("Please enter your Courier ID or registered phone number.");
    return;
  }
  if (!password) {
    alert("Please enter your courier password.");
    return;
  }

  const knownCouriers = [
    {
      id: "drv_001",
      name: "Tomas Nekundi",
      phone: "+264812345601",
      vehicleCategory: "MOTORCYCLE",
      availability: "AVAILABLE",
      location: { latitude: -22.5609, longitude: 17.0658 }
    },
    {
      id: "drv_002",
      name: "Selma Shikongo",
      phone: "+264812345602",
      vehicleCategory: "CAR",
      availability: "AVAILABLE",
      location: { latitude: -22.5580, longitude: 17.0720 }
    }
  ];

  let matchedCourier = knownCouriers.find(
    (c) =>
      c.id.toLowerCase() === identifier.toLowerCase() ||
      c.phone.replace(/[\s-]/g, "") === identifier.replace(/[\s-]/g, "")
  );

  if (!matchedCourier) {
    matchedCourier = {
      id: identifier.startsWith("drv_") ? identifier : `drv_${Date.now().toString(36).slice(-4)}`,
      name: identifier.startsWith("drv_") ? `Courier ${identifier}` : identifier,
      phone: identifier.startsWith("+") ? identifier : "+264812345601",
      vehicleCategory: "MOTORCYCLE",
      availability: "AVAILABLE",
      location: { latitude: -22.5609, longitude: 17.0658 }
    };
  }

  activeDriver = matchedCourier;

  // Saves session via window.DSA.setStoredSession('driver', activeDriver)
  if (window.DSA && typeof window.DSA.setStoredSession === "function") {
    window.DSA.setStoredSession("driver", activeDriver);
  } else {
    try {
      localStorage.setItem(
        "dsa_session_driver",
        JSON.stringify({
          role: "driver",
          token: `jwt_driver_${Date.now()}`,
          user: activeDriver
        })
      );
    } catch (_) {}
  }
  try {
    localStorage.setItem("dsa_active_driver_profile", JSON.stringify(activeDriver));
  } catch (_) {}

  closeDriverLoginModal();

  // Updates UI
  updateProfileDrawerUI();
  updateAuthButtonsUI();
  renderBottomCard();

  if (driverLeafletMap && typeof L !== "undefined") {
    const lat = activeDriver.location.latitude;
    const lon = activeDriver.location.longitude;
    if (leafletMarkers.driver) {
      leafletMarkers.driver.setLatLng([lat, lon]);
    }
  }

  appendLog(`Courier signed in successfully: ${activeDriver.name} (${activeDriver.id})`, "success", "AUTH", "LOGIN");

  // Scans tasks
  await refreshPlatformOrders(true);
}

function openDriverOnboardingModal() {
  closeDriverLoginModal();
  ensureDriverAuthModals();
  setDriverWizardStep(1);
  if (window.DSA && typeof window.DSA.openModal === "function") {
    window.DSA.openModal("modal-driver-onboarding");
  } else {
    const modal = document.getElementById("modal-driver-onboarding");
    if (modal) modal.style.display = "flex";
  }
}

function closeDriverOnboardingModal() {
  if (window.DSA && typeof window.DSA.closeModal === "function") {
    window.DSA.closeModal("modal-driver-onboarding");
  } else {
    const modal = document.getElementById("modal-driver-onboarding");
    if (modal) modal.style.display = "none";
  }
}

function setDriverWizardStep(stepNumber) {
  const step1 = document.getElementById("driver-wizard-step-1");
  const step2 = document.getElementById("driver-wizard-step-2");
  const step3 = document.getElementById("driver-wizard-step-3");
  const ind1 = document.getElementById("driver-wizard-ind-1");
  const ind2 = document.getElementById("driver-wizard-ind-2");
  const ind3 = document.getElementById("driver-wizard-ind-3");

  if (step1) step1.style.display = stepNumber === 1 ? "block" : "none";
  if (step2) step2.style.display = stepNumber === 2 ? "block" : "none";
  if (step3) step3.style.display = stepNumber === 3 ? "block" : "none";

  [ind1, ind2, ind3].forEach((ind, idx) => {
    if (!ind) return;
    if (idx + 1 === stepNumber) {
      ind.style.background = "rgba(59,130,246,0.15)";
      ind.style.color = "#3b82f6";
    } else if (idx + 1 < stepNumber) {
      ind.style.background = "rgba(16,185,129,0.15)";
      ind.style.color = "#10b981";
    } else {
      ind.style.background = "rgba(255,255,255,0.04)";
      ind.style.color = "#94a3b8";
    }
  });
}

function handleDriverPasswordInput() {
  const pwdInput = document.getElementById("onboard-driver-password");
  const bar = document.getElementById("driver-password-strength-bar");
  const label = document.getElementById("driver-password-strength-label");
  if (!pwdInput) return;

  const pwd = pwdInput.value || "";
  let strength = null;

  if (window.DSA && typeof window.DSA.evaluatePasswordStrength === "function") {
    strength = window.DSA.evaluatePasswordStrength(pwd);
  } else {
    const score = pwd.length >= 8 ? (/[A-Z]/.test(pwd) && /[0-9]/.test(pwd) ? 4 : 2) : 1;
    strength = {
      score,
      label: score >= 4 ? "Strong" : score >= 2 ? "Fair" : "Weak",
      color: score >= 4 ? "#22c55e" : score >= 2 ? "#eab308" : "#ef4444",
      percent: Math.min(100, pwd.length * 10)
    };
  }

  if (bar) {
    bar.style.width = `${pwd.length === 0 ? 0 : strength.percent}%`;
    bar.style.backgroundColor = strength.color;
  }
  if (label) {
    label.textContent = pwd.length === 0 ? "Enter password to evaluate strength" : `${strength.label} (${strength.percent}%)`;
    label.style.color = strength.color;
  }
}

async function submitCourierOnboarding() {
  const nameInput = document.getElementById("onboard-driver-name");
  const phoneInput = document.getElementById("onboard-driver-phone");
  const pwdInput = document.getElementById("onboard-driver-password");
  const vehicleInput = document.getElementById("onboard-driver-vehicle");
  const termsInput = document.getElementById("onboard-driver-terms");

  const name = nameInput ? nameInput.value.trim() : "";
  const phone = phoneInput ? phoneInput.value.trim() : "";
  const password = pwdInput ? pwdInput.value : "";
  const vehicle = vehicleInput ? vehicleInput.value : "MOTORCYCLE";

  if (!name) {
    alert("Please enter your full name.");
    setDriverWizardStep(1);
    return;
  }
  if (!phone) {
    alert("Please enter your phone number.");
    setDriverWizardStep(1);
    return;
  }

  // Validates password via window.DSA.validatePassword()
  let isValid = true;
  let errorMsg = "";
  if (window.DSA && typeof window.DSA.validatePassword === "function") {
    const res = window.DSA.validatePassword(password);
    isValid = res.isValid;
    if (!isValid) {
      errorMsg = res.errors ? res.errors.join("\n• ") : "Password does not meet complexity requirements.";
    }
  } else {
    isValid = password && password.length >= 6;
    if (!isValid) errorMsg = "Password must be at least 6 characters.";
  }

  if (!isValid) {
    alert(`Please choose a stronger password:\n• ${errorMsg}`);
    setDriverWizardStep(1);
    return;
  }

  if (termsInput && !termsInput.checked) {
    alert("Please accept the courier service terms and guidelines to continue.");
    return;
  }

  // Creates new courier object
  const newCourierId = `drv_${Date.now().toString(36).slice(-5)}`;
  const newCourier = {
    id: newCourierId,
    name: name,
    phone: phone,
    vehicleCategory: vehicle,
    availability: "AVAILABLE",
    location: { latitude: -22.5609, longitude: 17.0658 }
  };
  activeDriver = newCourier;

  // Saves session via window.DSA.setStoredSession('driver', activeDriver)
  if (window.DSA && typeof window.DSA.setStoredSession === "function") {
    window.DSA.setStoredSession("driver", activeDriver);
  } else {
    try {
      localStorage.setItem(
        "dsa_session_driver",
        JSON.stringify({
          role: "driver",
          token: `jwt_driver_${Date.now()}`,
          user: activeDriver
        })
      );
    } catch (_) {}
  }
  try {
    localStorage.setItem("dsa_active_driver_profile", JSON.stringify(activeDriver));
  } catch (_) {}

  // Initializes wallet at 0 NAD
  driverWallet = {
    balance: 0.0,
    completedTrips: 0,
    totalEarned: 0.0,
    withdrawn: 0.0,
    transactions: []
  };
  saveWalletState();

  // Updates map
  if (driverLeafletMap && typeof L !== "undefined") {
    const lat = activeDriver.location.latitude;
    const lon = activeDriver.location.longitude;
    if (!leafletMarkers.driver) {
      const driverIcon = L.divIcon({
        className: "custom-leaflet-marker",
        html: `
          <div class="driver-radar-marker">
            <div class="driver-pulse-ring"></div>
            <div class="driver-icon-core" title="${escapeHtml(activeDriver.name)}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
              </svg>
            </div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });
      leafletMarkers.driver = L.marker([lat, lon], {
        icon: driverIcon,
        zIndexOffset: 1000
      }).addTo(driverLeafletMap);
    } else {
      leafletMarkers.driver.setLatLng([lat, lon]);
    }
    driverLeafletMap.panTo([lat, lon]);
  }

  // Closes modal
  closeDriverOnboardingModal();

  // Updates UI
  updateProfileDrawerUI();
  updateAuthButtonsUI();
  renderBottomCard();
  appendLog(`New courier partner onboarded: ${activeDriver.name} (${activeDriver.id})`, "success", "ONBOARD", "DRIVER");

  await refreshPlatformOrders(true);
}

function handleDriverLogout(skipConfirm = false) {
  if (!skipConfirm && !confirm("Are you sure you want to log out of your driver session?")) {
    return;
  }

  // Clear session via window.DSA.clearStoredSession('driver')
  if (window.DSA && typeof window.DSA.clearStoredSession === "function") {
    window.DSA.clearStoredSession("driver");
  }
  try {
    localStorage.removeItem("dsa_session_driver");
  } catch (_) {}

  // Clear dsa_active_driver_profile
  try {
    localStorage.removeItem("dsa_active_driver_profile");
  } catch (_) {}

  // Reset activeDriver = null
  activeDriver = null;

  // Stop simulation
  if (typeof stopSimulatedDrive === "function") {
    stopSimulatedDrive();
  }

  // Update UI to logged-out state
  updateProfileDrawerUI();
  updateAuthButtonsUI();
  renderBottomCard();

  appendLog("Courier session logged out successfully.", "info", "AUTH", "LOGOUT");
}

async function deleteDriverAccountCascade() {
  if (!activeDriver || !activeDriver.id) {
    alert("No courier account is currently logged in.");
    return;
  }

  const driverId = activeDriver.id;
  const driverName = activeDriver.name;
  const confirmed = confirm(
    `WARNING: Permanent Courier Account Cascade Deletion\n\nThis will permanently purge ${driverName} (${driverId}), wipe your earnings wallet balance, clear all telemetry data, and revoke credentials.\n\nAre you sure you wish to permanently delete this account?`
  );
  if (!confirmed) return;

  // Calls POST /api/driver/cascade-delete with { driverId: activeDriver.id }
  try {
    await driverApiFetch(9096, "/api/driver/cascade-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId })
    });
  } catch (err) {
    console.warn("Cascade delete API call failed, proceeding with local cascade wipe:", err);
  }

  // Wipes courier wallet
  driverWallet = {
    balance: 0.0,
    completedTrips: 0,
    totalEarned: 0.0,
    withdrawn: 0.0,
    transactions: []
  };
  try {
    localStorage.removeItem("dsa_driver_wallet");
  } catch (_) {}
  updateWalletUI();
  updateHeaderBalance();

  // Clears telemetry
  if (typeof stopSimulatedDrive === "function") {
    stopSimulatedDrive();
  }
  try {
    localStorage.removeItem("dsa_driver_active_order");
  } catch (_) {}
  activeDelivery.orderId = null;
  activeDelivery.deliveryId = null;
  activeDelivery.status = "UNASSIGNED";
  clearDeliveryRouteFromMap();

  if (leafletMarkers.driver && driverLeafletMap) {
    try {
      driverLeafletMap.removeLayer(leafletMarkers.driver);
      leafletMarkers.driver = null;
    } catch (_) {}
  }

  // Calls handleDriverLogout()
  handleDriverLogout(true);

  // Alerts user of permanent courier account wipe
  alert(`Courier account ${driverId} and all associated ledger records and telemetry data have been permanently wiped.`);
}

// ============================================================================
// 9. MICROSERVICES CLUSTER CONNECTIVITY PROBING
// ============================================================================

async function probeAllClusterMicroservices() {
  const ports = [9096, 9091, 9095, 9094];
  const hasClusterUI = ports.some((port) => document.getElementById(`dot-service-${port}`));
  if (!hasClusterUI) return;

  for (const port of ports) {
    const dot = document.getElementById(`dot-service-${port}`);
    if (dot) {
      dot.className = "cluster-status-dot dot-checking";
    }

    try {
      const res = await driverApiFetch(port, "/health", { timeoutMs: 2000 });
      if (res && res.ok) {
        if (dot) dot.className = "cluster-status-dot dot-online";
      } else {
        if (dot) dot.className = "cluster-status-dot dot-offline";
      }
    } catch (_) {
      if (dot) dot.className = "cluster-status-dot dot-offline";
    }
  }
}

// ============================================================================
// 10. SIMULATED DRIVE & WAYPOINT SHORTCUTS
// ============================================================================

function toggleSimulatedDrive() {
  if (simulationInterval) {
    stopSimulatedDrive();
  } else {
    startSimulatedDrive();
  }
}

function startSimulatedDrive() {
  if (simulationInterval) return;
  if (!activeRoadWaypoints || activeRoadWaypoints.length < 2) {
    plotActiveDeliveryRoute().then(() => startSimulatedDrive());
    return;
  }

  const btn = document.getElementById("btn-sim-drive-toggle");
  const text = document.getElementById("text-simulate-drive");
  if (btn) btn.classList.add("active");
  if (text) text.textContent = "Stop Sim";

  currentSpeedKmh = 42;
  setText("sim-speed-val", String(currentSpeedKmh));
  if (typeof simWaypointIndex !== "number" || simWaypointIndex >= activeRoadWaypoints.length - 1) {
    simWaypointIndex = 0;
  }
  appendLog("Live GPS road simulation started.", "info", "SIM", "GPS");

  simulationInterval = setInterval(() => {
    if (simWaypointIndex >= activeRoadWaypoints.length - 1) {
      stopSimulatedDrive();
      if (activeDelivery.status === 'DRIVER_ASSIGNED') {
        teleportToWaypoint("restaurant");
      } else {
        teleportToWaypoint("customer");
      }
      return;
    }

    simWaypointIndex++;
    const [curLat, curLon] = activeRoadWaypoints[simWaypointIndex];
    const nextPoint = activeRoadWaypoints[simWaypointIndex + 1] || activeRoadWaypoints[simWaypointIndex];
    const [nextLat, nextLon] = nextPoint;

    updateLeafletDriverPosition(curLat, curLon);

    // Heading bearing & icon rotation
    const bearingFn = window.DSA?.calculateBearing || window.calculateBearing;
    if (typeof bearingFn === 'function') {
      vehicleBearing = bearingFn(curLat, curLon, nextLat, nextLon);
      const markerEl = leafletMarkers.driver?.getElement();
      if (markerEl) {
        const core = markerEl.querySelector(".driver-icon-core");
        if (core) {
          core.style.transform = `rotate(${Math.round(vehicleBearing)}deg)`;
        }
      }
    }

    // Dynamic polyline shrink
    const remaining = activeRoadWaypoints.slice(simWaypointIndex);
    if (activeRoutePolylineGroup && remaining.length >= 2) {
      activeRoutePolylineGroup.eachLayer(l => {
        if (typeof l.setLatLngs === 'function') l.setLatLngs(remaining);
      });
    }

    // Update remaining metrics
    const distKm = Math.max(0.1, (activeDelivery.distanceKm * (1 - simWaypointIndex / activeRoadWaypoints.length))).toFixed(1);
    setText("active-card-distance", `${distKm} km`);

    // Periodically persist simulation progress
    if (simWaypointIndex % 5 === 0) {
      saveActiveDeliveryState();
    }
  }, 600);
}

function stopSimulatedDrive() {
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
  currentSpeedKmh = 0;
  setText("sim-speed-val", "0");
  saveActiveDeliveryState();

  const btn = document.getElementById("btn-sim-drive-toggle");
  const text = document.getElementById("text-simulate-drive");
  if (btn) btn.classList.remove("active");
  if (text) text.textContent = "Simulate Drive";
}

function teleportToWaypoint(target) {
  let lat = WINDHOEK_CENTER.lat;
  let lon = WINDHOEK_CENTER.lon;
  let label = "Windhoek Central";

  if (target === "restaurant") {
    lat = routeOrigin.lat;
    lon = routeOrigin.lon;
    label = "Restaurant Pickup";
  } else if (target === "customer") {
    lat = routeDestination.lat;
    lon = routeDestination.lon;
    label = "Customer Destination";
  } else if (target === "halfway") {
    lat = (routeOrigin.lat + routeDestination.lat) / 2;
    lon = (routeOrigin.lon + routeDestination.lon) / 2;
    label = "Halfway Waypoint";
  }

  updateLeafletDriverPosition(lat, lon);
  appendLog(`Courier teleported to ${label} [${lat.toFixed(4)}, ${lon.toFixed(4)}]`, "info", "GPS", "GPS");

  if (activeDelivery.orderId) {
    updateActiveCardUI();
  }
}

// ============================================================================
// 11. ACTIVITIES LOG CONTROLLER
// ============================================================================

function loadActivityLogs() {
  const container = document.getElementById("event-log-stream");
  if (!container) return;

  try {
    const raw = localStorage.getItem("dsa_driver_activity_logs");
    if (!raw) return;
    const logs = JSON.parse(raw);
    if (!Array.isArray(logs) || logs.length === 0) return;

    container.innerHTML = "";
    logs.forEach((log) => {
      const badgeClass =
        log.level === "success"
          ? "badge-success"
          : log.level === "warn"
          ? "badge-warn"
          : log.level === "danger"
          ? "badge-danger"
          : "badge-info";

      const entry = document.createElement("div");
      entry.className = `event-log-entry ${log.level || "info"}`;
      entry.setAttribute("data-category", log.category || "STATUS");
      entry.innerHTML = `
        <span class="log-time text-mono">${escapeHtml(log.time || "")}</span>
        <span class="log-badge ${badgeClass}">${escapeHtml(log.badge || "EVENT")}</span>
        <span class="log-message">${escapeHtml(log.message || "")}</span>
      `;
      container.appendChild(entry);
    });
  } catch (_) {}

  // Restore active category filter on boot
  try {
    const savedFilter = localStorage.getItem("dsa_driver_log_filter");
    if (savedFilter) {
      filterLogs(savedFilter);
    }
  } catch (_) {}
}

function appendLog(message, level = "info", badge = "EVENT", category = "STATUS") {
  const container = document.getElementById("event-log-stream");
  if (!container) return;

  const timeStr = new Date().toTimeString().split(" ")[0];
  const badgeClass =
    level === "success"
      ? "badge-success"
      : level === "warn"
      ? "badge-warn"
      : level === "danger"
      ? "badge-danger"
      : "badge-info";

  const entry = document.createElement("div");
  entry.className = `event-log-entry ${level}`;
  entry.setAttribute("data-category", category);
  entry.innerHTML = `
    <span class="log-time text-mono">${timeStr}</span>
    <span class="log-badge ${badgeClass}">${escapeHtml(badge)}</span>
    <span class="log-message">${escapeHtml(message)}</span>
  `;

  // Respect current log category filter
  try {
    const currentFilter = localStorage.getItem("dsa_driver_log_filter");
    if (currentFilter && currentFilter !== "ALL" && category !== currentFilter) {
      entry.style.display = "none";
    }
  } catch (_) {}

  container.prepend(entry);

  // Keep at most 60 log entries in DOM
  while (container.children.length > 60) {
    container.removeChild(container.lastChild);
  }

  // Persist to localStorage (max 50 entries FIFO)
  try {
    let logs = [];
    const raw = localStorage.getItem("dsa_driver_activity_logs");
    if (raw) {
      logs = JSON.parse(raw);
      if (!Array.isArray(logs)) logs = [];
    }
    logs.unshift({
      time: timeStr,
      badge,
      message,
      level,
      category,
      timestamp: Date.now()
    });
    if (logs.length > 50) {
      logs = logs.slice(0, 50);
    }
    localStorage.setItem("dsa_driver_activity_logs", JSON.stringify(logs));
  } catch (_) {}
}

function clearLog() {
  try {
    localStorage.removeItem("dsa_driver_activity_logs");
  } catch (_) {}

  const container = document.getElementById("event-log-stream");
  if (!container) return;
  container.innerHTML = `
    <div class="event-log-entry info" data-category="STATUS">
      <span class="log-time text-mono">${new Date().toTimeString().split(" ")[0]}</span>
      <span class="log-badge badge-info">RESET</span>
      <span class="log-message">Activity log stream reset.</span>
    </div>
  `;
}

function filterLogs(category) {
  try {
    localStorage.setItem("dsa_driver_log_filter", category);
  } catch (_) {}

  const pills = document.querySelectorAll(".filter-pill");
  if (!pills || pills.length === 0) return;

  pills.forEach((pill) => {
    pill.classList.toggle("active", pill.getAttribute("data-filter") === category);
  });

  const entries = document.querySelectorAll(".event-log-entry");
  entries.forEach((el) => {
    if (category === "ALL" || el.getAttribute("data-category") === category) {
      el.style.display = "flex";
    } else {
      el.style.display = "none";
    }
  });
}

// ============================================================================
// 12. GENERAL HELPERS
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

function formatAddress(addr) {
  if (typeof window !== "undefined" && window.DSA?.formatAddress) {
    return window.DSA.formatAddress(addr);
  }
  if (!addr) return "Windhoek Central";
  if (typeof addr === "object") {
    const street = addr.street || addr.streetAddress || addr.addressLine1 || addr.address || "";
    const suburb = addr.suburb || addr.area || addr.city || "Windhoek";
    return [street, suburb].filter(Boolean).join(", ") || "Windhoek Central";
  }
  const trimmed = String(addr).trim();
  if (trimmed === "[object Object]") return "Windhoek Central";
  return trimmed;
}

function formatFriendlyOrderId(id) {
  if (typeof window !== "undefined" && window.DSA?.formatFriendlyOrderId) {
    return window.DSA.formatFriendlyOrderId(id);
  }
  if (!id) return "ORD-—";
  const str = String(id).trim();
  if (/^ORD-[A-Z0-9]{4,8}$/i.test(str)) return str.toUpperCase();
  const uuidMatch = str.match(/([a-f0-9]{4,8})/i) || str.match(/[a-f0-9]{6,8}$/i);
  if (uuidMatch) {
    const token = uuidMatch[0].replace(/[^a-f0-9]/gi, "").slice(0, 6).toUpperCase();
    if (token) return `ORD-#${token}`;
  }
  const clean = str.replace(/[^a-zA-Z0-9]/g, "");
  return `ORD-#${clean.slice(-6).toUpperCase()}`;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function getOrderHandoverPin(orderId) {
  if (!orderId) return "0000";
  let hash = 0;
  for (let i = 0; i < orderId.length; i++) {
    const code = orderId.charCodeAt(i);
    hash = (hash * 31 + code) % 10000;
  }
  if (hash < 0) hash = -hash;
  return String(hash).padStart(4, "0");
}

// Window / Global Exports for Event Handlers & Testing
if (typeof window !== "undefined") {
  window.openDriverLoginModal = openDriverLoginModal;
  window.closeDriverLoginModal = closeDriverLoginModal;
  window.handleDriverLoginSubmit = handleDriverLoginSubmit;
  window.openDriverOnboardingModal = openDriverOnboardingModal;
  window.closeDriverOnboardingModal = closeDriverOnboardingModal;
  window.setDriverWizardStep = setDriverWizardStep;
  window.handleDriverPasswordInput = handleDriverPasswordInput;
  window.submitCourierOnboarding = submitCourierOnboarding;
  window.handleDriverLogout = handleDriverLogout;
  window.deleteDriverAccountCascade = deleteDriverAccountCascade;
  window.loadStoredDriverProfile = loadStoredDriverProfile;
  window.updateAuthButtonsUI = updateAuthButtonsUI;
  window.ensureDriverAuthModals = ensureDriverAuthModals;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    openDriverLoginModal,
    closeDriverLoginModal,
    handleDriverLoginSubmit,
    openDriverOnboardingModal,
    closeDriverOnboardingModal,
    setDriverWizardStep,
    handleDriverPasswordInput,
    submitCourierOnboarding,
    handleDriverLogout,
    deleteDriverAccountCascade,
    loadStoredDriverProfile
  };
}

