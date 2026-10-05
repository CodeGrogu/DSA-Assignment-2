/**
 * Food Delivery Platform — Admin Dashboard Controller (app.js)
 * Real-Time Platform Orchestration & Observability Controller
 * Modern Minimalist Architecture • 0 Gradients • 0 Emojis • ZERO Mock Seed Data
 */

// ============================================================================
// 1. ENDPOINTS & RESILIENT API RESOLUTION
// ============================================================================

const ADMIN_PORT = 9098;
const NOTIF_PORT = 9097;

const ADMIN_STATS = "/admin/stats/overview";
const ADMIN_RESTAURANT_REPORT = "/admin/reports/restaurant";
const ADMIN_DRIVER_REPORT = "/admin/reports/driver";
const NOTIF_URL = "/notifications/recipient";

const SERVICES = [
  { id: "health-order", name: "order_service", port: 9091 },
  { id: "health-customer", name: "customer_service", port: 9093 },
  { id: "health-payment", name: "payment_service", port: 9094 },
  { id: "health-restaurant", name: "restaurant_service", port: 9095 },
  { id: "health-delivery", name: "delivery_service", port: 9096 },
  { id: "health-notif", name: "notification_service", port: 9097 },
  { id: "health-admin", name: "admin_service", port: 9098 }
];

// Auto-refresh state
let autoRefreshIntervalMs = 5000;
let countdownRemainingSec = 5;
let tickerTimerId = null;

// Cached datasets for instant real-time searching and filtering
let cachedFinancialRows = [];
let cachedDriverRows = [];
let cachedNotifRows = [];
let cachedActivityEvents = [];
let currentNotifChannel = "ALL";
let currentNotifRecipient = "cust-42";

/**
 * Resolves candidate URLs in priority order.
 * When running in Live Server (port 5500) or any non-8080 dev port,
 * prioritizes http://localhost:8080/api/${port}${cleanPath} and http://127.0.0.1:8080/api/${port}${cleanPath}
 * so that requests reach the reverse proxy instead of hitting port 5500 (which returns 404).
 */
function getCandidateUrls(port, path) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const urls = [];
  const isBrowser = typeof window !== "undefined" && window.location;

  // 1. Only use relative /api/... if this page is directly served on the reverse proxy port (8080)
  if (isBrowser && (window.location.port === "8080" || window.location.origin.includes(":8080"))) {
    urls.push(`/api/${port}${cleanPath}`);
  }

  // 2. Guaranteed reverse-proxy URLs (avoids hitting Live Server 5500 with relative paths)
  urls.push(`http://localhost:8080/api/${port}${cleanPath}`);
  urls.push(`http://127.0.0.1:8080/api/${port}${cleanPath}`);

  // 3. Direct microservice ports (CORS/direct access fallback)
  urls.push(`http://127.0.0.1:${port}${cleanPath}`);
  urls.push(`http://localhost:${port}${cleanPath}`);

  return [...new Set(urls)];
}

/**
 * Resilient multi-candidate API fetcher with NO recursive loops.
 * Tries prioritized reverse proxy candidates first, with timeout and gateway recovery.
 */
async function callApi(port, path, options = {}) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const timeoutMs = options.timeoutMs || 3500;
  const urls = getCandidateUrls(port, cleanPath);

  let lastError = null;

  for (const url of urls) {
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

      // If reverse proxy returns gateway error (502/503/504), continue to next candidate
      if ((res.status === 502 || res.status === 503 || res.status === 504) && url.includes("/api/")) {
        lastError = new Error(`Proxy gateway error (${res.status}) on ${url}`);
        continue;
      }

      // If non-proxy URL returned 404 HTML (e.g. Live Server port 5500 fallback), continue to next candidate
      const contentType = res.headers ? res.headers.get("content-type") || "" : "";
      if (res.status === 404 && contentType.includes("text/html") && !url.includes(":8080")) {
        lastError = new Error(`404 HTML from non-proxy ${url}`);
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }
  }

  throw lastError || new Error(`Failed to reach service on port ${port} across all candidate URLs`);
}

// Ensure apiFetch is an alias to callApi, NOT a recursive delegation
if (typeof window !== "undefined") {
  window.apiFetch = callApi;
}

// ============================================================================
// 2. FORMATTERS & DOM UTILITIES
// ============================================================================

function setText(id, value) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return "0";
  return Number(n).toLocaleString();
}

function formatMoney(amount) {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return "N$ 0.00";
  return (
    "N$ " +
    Number(amount).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusPillClass(status) {
  const s = String(status || "").toLowerCase();
  if (
    s.includes("fail") ||
    s.includes("error") ||
    s.includes("cancel") ||
    s.includes("declined") ||
    s.includes("breach") ||
    s.includes("down") ||
    s.includes("offline")
  ) {
    return "pill-bad";
  }
  if (
    s.includes("pend") ||
    s.includes("queue") ||
    s.includes("wait") ||
    s.includes("cook") ||
    s.includes("prep")
  ) {
    return "pill-warn";
  }
  if (
    s.includes("sent") ||
    s.includes("deliver") ||
    s.includes("ok") ||
    s.includes("success") ||
    s.includes("complete") ||
    s.includes("settle") ||
    s.includes("up")
  ) {
    return "pill-good";
  }
  return "pill-neutral";
}

/**
 * Latency color-coder:
 * <50ms: success green (latency-fast)
 * 50-150ms: slate (latency-normal)
 * >150ms: warning amber (latency-slow)
 */
function latencyClass(ms) {
  if (ms < 50) return "latency-fast";
  if (ms <= 150) return "latency-normal";
  return "latency-slow";
}

function renderEmptyBanner(title, message) {
  return `
    <tr>
      <td colspan="5">
        <div class="table-empty-banner">
          <svg viewBox="0 0 24 24" class="empty-icon">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(message)}</p>
        </div>
      </td>
    </tr>
  `;
}

// ============================================================================
// 3. TAB NAVIGATION SYSTEM
// ============================================================================

const TAB_NAME_MAP = {
  overview: "tab-overview",
  "tab-overview": "tab-overview",
  health: "tab-service-health",
  "service-health": "tab-service-health",
  "tab-service-health": "tab-service-health",
  financial: "tab-financial",
  "tab-financial": "tab-financial",
  driver: "tab-driver-sla",
  drivers: "tab-driver-sla",
  "driver-sla": "tab-driver-sla",
  "tab-driver-sla": "tab-driver-sla",
  notification: "tab-notifications",
  notifications: "tab-notifications",
  "tab-notifications": "tab-notifications"
};

function switchTab(tabIdentifier) {
  if (!tabIdentifier || typeof document === "undefined") return;
  const targetId = TAB_NAME_MAP[tabIdentifier.toLowerCase()] || tabIdentifier;

  const tabButtons = document.querySelectorAll(".nav-tab-btn");
  const tabPanels = document.querySelectorAll(".view-section");

  tabButtons.forEach((btn) => {
    const btnTab = btn.getAttribute("data-tab");
    const isActive = btnTab === targetId || btn.id === `nav-${targetId}`;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  tabPanels.forEach((panel) => {
    const isTarget = panel.id === targetId;
    panel.classList.toggle("active", isTarget);
  });

  // Context-aware refresh on tab change
  if (targetId === "tab-financial") {
    const from = document.getElementById("fin-date-from")?.value || "";
    const to = document.getElementById("fin-date-to")?.value || "";
    loadRestaurantReport(from, to);
  } else if (targetId === "tab-driver-sla") {
    const from = document.getElementById("sla-date-from")?.value || "";
    const to = document.getElementById("sla-date-to")?.value || "";
    loadDriverReport(from, to);
  } else if (targetId === "tab-notifications") {
    const recipient = document.getElementById("notif-recipient-input")?.value?.trim() || currentNotifRecipient;
    loadNotifications(recipient);
  } else if (targetId === "tab-service-health") {
    checkHealth();
  }
}

function getActiveTabId() {
  if (typeof document === "undefined") return "tab-overview";
  const activePanel = document.querySelector(".view-section.active");
  return activePanel ? activePanel.id : "tab-overview";
}

// ============================================================================
// 4. PLATFORM OVERVIEW & LIVE ACTIVITY
// ============================================================================

async function loadOverview() {
  const lastUpdatedEl = typeof document !== "undefined" ? document.getElementById("last-updated") : null;

  try {
    const res = await callApi(ADMIN_PORT, ADMIN_STATS, { timeoutMs: 3000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const gmv = Number(data.grossMerchandiseValue || 0);
    const totalOrders = Number(data.totalOrders || 0);
    const successPayments = Number(data.successfulPayments || 0);
    const failPayments = Number(data.failedPayments || 0);
    const activeDeliveries = Number(data.activeDeliveries || 0);

    setText("kpi-gmv", formatMoney(gmv));
    setText("kpi-orders", formatNumber(totalOrders));
    setText("kpi-payments-ok", formatNumber(successPayments));
    setText("kpi-payments-fail", formatNumber(failPayments));
    setText("kpi-active", formatNumber(activeDeliveries));

    // Dynamic KPI Metric Comparisons & Subtitles
    const feeAmount = gmv * 0.1;
    setText("kpi-gmv-fee", `+${formatMoney(feeAmount)} Commission (10%)`);

    const totalAttempts = successPayments + failPayments;
    const settleRate = totalAttempts > 0 ? ((successPayments / totalAttempts) * 100).toFixed(1) : "100.0";
    setText("kpi-success-rate", `${settleRate}% Settle Rate`);

    const disputeRate = totalAttempts > 0 ? ((failPayments / totalAttempts) * 100).toFixed(1) : "0.0";
    setText("kpi-fail-rate", `${disputeRate}% Dispute Rate`);

    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
      lastUpdatedEl.className = "status-pill pill-good";
    }

    await updateRecentActivity();
    return data;
  } catch (err) {
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = "Admin service offline";
      lastUpdatedEl.className = "status-pill pill-bad";
    }
  }
}

async function updateRecentActivity() {
  if (typeof document === "undefined") return;
  const tbody = document.getElementById("recent-activity-body");
  if (!tbody) return;

  try {
    // Attempt to pull real audit trail from notification_service as activity stream
    const recipientsToProbe = ["cust-42", "CUST-001", "CUST-002", "drv_001"];
    const results = await Promise.allSettled(
      recipientsToProbe.map((r) =>
        callApi(NOTIF_PORT, `${NOTIF_URL}/${encodeURIComponent(r)}`, { timeoutMs: 2000 })
          .then((res) => (res.ok ? res.json() : []))
          .catch(() => [])
      )
    );

    const merged = [];
    results.forEach((r) => {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        merged.push(...r.value);
      }
    });

    if (merged.length > 0) {
      // Sort reverse chronological
      merged.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
      cachedActivityEvents = merged;
      renderActivityTable();
      return;
    }
  } catch (_) {}

  cachedActivityEvents = [];
  renderActivityTable();
}

function renderActivityTable() {
  if (typeof document === "undefined") return;
  const tbody = document.getElementById("recent-activity-body");
  if (!tbody) return;

  const searchInput = document.getElementById("activity-search-input");
  const filterTerm = searchInput ? searchInput.value.trim().toLowerCase() : "";

  let list = cachedActivityEvents;
  if (filterTerm) {
    list = list.filter(
      (item) =>
        String(item.recipientId || "").toLowerCase().includes(filterTerm) ||
        String(item.channel || "").toLowerCase().includes(filterTerm) ||
        String(item.status || "").toLowerCase().includes(filterTerm) ||
        String(item.notificationId || "").toLowerCase().includes(filterTerm)
    );
  }

  if (!list || list.length === 0) {
    tbody.innerHTML = renderEmptyBanner(
      "No Recent Platform Activity",
      filterTerm
        ? `No activity events match "${escapeHtml(filterTerm)}".`
        : "Real-time transactional, courier dispatch, and notification stream events will appear here as they occur."
    );
    return;
  }

  const topRecent = list.slice(0, 15);
  tbody.innerHTML = topRecent
    .map(
      (item) => `
      <tr>
        <td><span class="text-mono">${escapeHtml(item.sentAt || new Date().toISOString())}</span></td>
        <td><strong>notification_service</strong></td>
        <td><span class="status-pill pill-neutral">${escapeHtml(item.channel || "NOTIFICATION")}</span></td>
        <td><code>${escapeHtml(item.notificationId || item.recipientId || "—")}</code></td>
        <td><span class="status-pill ${statusPillClass(item.status)}">${escapeHtml(item.status || "SENT")}</span></td>
      </tr>`
    )
    .join("");
}

// ============================================================================
// 5. SYSTEM HEALTH & INFRASTRUCTURE MONITORING
// ============================================================================

async function checkHealth() {
  let onlineCount = 0;

  await Promise.allSettled(
    SERVICES.map(async (svc) => {
      const dotEl = typeof document !== "undefined" ? document.getElementById(svc.id) : null;
      const latencyId = svc.id.replace("health-", "latency-");
      const latencyEl = typeof document !== "undefined" ? document.getElementById(latencyId) : null;

      const startTime = performance.now();
      try {
        const res = await callApi(svc.port, "/health", { timeoutMs: 2500 });
        const durationMs = Math.max(1, Math.round(performance.now() - startTime));

        if (res.ok) {
          onlineCount++;
          if (dotEl) dotEl.className = "dot up";
          if (latencyEl) {
            latencyEl.textContent = `${durationMs} ms`;
            latencyEl.className = `service-latency ${latencyClass(durationMs)}`;
          }
        } else {
          if (dotEl) dotEl.className = "dot down";
          if (latencyEl) {
            latencyEl.textContent = `HTTP ${res.status}`;
            latencyEl.className = "service-latency latency-down";
          }
        }
      } catch (_) {
        if (dotEl) dotEl.className = "dot down";
        if (latencyEl) {
          latencyEl.textContent = "Offline";
          latencyEl.className = "service-latency latency-down";
        }
      }
    })
  );

  updateHealthBadgesAndBanner(onlineCount);
  checkAuxiliaryHealth();
}

/**
 * Pings an individual microservice on demand to test latency instantly.
 */
async function pingSingleService(port, dotId, latencyId) {
  if (typeof document === "undefined") return;
  const dotEl = document.getElementById(dotId);
  const latencyEl = document.getElementById(latencyId);

  if (latencyEl) {
    latencyEl.textContent = "Pinging...";
    latencyEl.className = "service-latency";
  }

  const startTime = performance.now();
  try {
    const res = await callApi(port, "/health", { timeoutMs: 2500 });
    const durationMs = Math.max(1, Math.round(performance.now() - startTime));

    if (res.ok) {
      if (dotEl) dotEl.className = "dot up";
      if (latencyEl) {
        latencyEl.textContent = `${durationMs} ms`;
        latencyEl.className = `service-latency ${latencyClass(durationMs)}`;
      }
    } else {
      if (dotEl) dotEl.className = "dot down";
      if (latencyEl) {
        latencyEl.textContent = `HTTP ${res.status}`;
        latencyEl.className = "service-latency latency-down";
      }
    }
  } catch (_) {
    if (dotEl) dotEl.className = "dot down";
    if (latencyEl) {
      latencyEl.textContent = "Offline";
      latencyEl.className = "service-latency latency-down";
    }
  }

  // Recalculate global online count
  recomputeServiceCounts();
}

function recomputeServiceCounts() {
  if (typeof document === "undefined") return;
  const upDots = document.querySelectorAll(".services-health-grid .dot.up");
  updateHealthBadgesAndBanner(upDots.length);
}

function updateHealthBadgesAndBanner(onlineCount) {
  if (typeof document === "undefined") return;
  const total = SERVICES.length;

  // Header dynamic live service health counter badge
  const headerCountEl = document.getElementById("header-service-count");
  const headerCountText = document.getElementById("service-count-text");
  const headerDot = document.getElementById("header-service-dot");

  if (headerCountText) {
    headerCountText.textContent = `${onlineCount}/${total} UP`;
  }
  if (headerCountEl) {
    if (onlineCount === total) {
      headerCountEl.className = "status-pill pill-good";
      if (headerDot) headerDot.className = "dot up";
    } else if (onlineCount > 0) {
      headerCountEl.className = "status-pill pill-warn";
      if (headerDot) headerDot.className = "dot up";
    } else {
      headerCountEl.className = "status-pill pill-bad";
      if (headerDot) headerDot.className = "dot down";
    }
  }

  // Tab 2 Navigation tab badge
  const healthTabBadge = document.getElementById("badge-health");
  if (healthTabBadge) {
    healthTabBadge.textContent = `${onlineCount}/${total}`;
    healthTabBadge.className = onlineCount === total ? "tab-badge badge-good" : "tab-badge";
  }

  // Global Service Connectivity Banner
  const banner = document.getElementById("service-status-banner");
  const bannerText = document.getElementById("service-status-text");

  if (onlineCount === total) {
    if (banner) banner.className = "service-banner banner-connected";
    if (bannerText) bannerText.textContent = `All ${total} Microservices Online (:9091 - :9098) — Platform Healthy`;
  } else if (onlineCount > 0) {
    if (banner) banner.className = "service-banner banner-checking";
    if (bannerText) bannerText.textContent = `${onlineCount}/${total} Services Reachable — Retrying connections...`;
  } else {
    if (banner) banner.className = "service-banner banner-offline";
    if (bannerText) bannerText.textContent = "Backend Services Offline — Waiting for reconnection...";
  }
}

async function checkAuxiliaryHealth() {
  if (typeof document === "undefined") return;

  const promDot = document.getElementById("status-prometheus");
  if (promDot) {
    try {
      const res = await callApi(9090, "/-/healthy", { timeoutMs: 2000 });
      promDot.className = res.ok ? "dot up" : "dot down";
    } catch (_) {}
  }

  const grafanaDot = document.getElementById("status-grafana");
  if (grafanaDot) {
    try {
      const res = await callApi(3000, "/api/health", { timeoutMs: 2000 });
      grafanaDot.className = res.ok ? "dot up" : "dot down";
    } catch (_) {}
  }

  const mongoDot = document.getElementById("status-mongo");
  if (mongoDot) {
    try {
      const res = await callApi(8086, "/", { timeoutMs: 2000 });
      mongoDot.className = (res.ok || res.status === 401 || res.status === 200 || res.status < 500) ? "dot up" : "dot down";
    } catch (_) {}
  }
}

// ============================================================================
// 6. RESTAURANT FINANCIAL REPORT
// ============================================================================

async function loadRestaurantReport(from = "", to = "") {
  const tbody = typeof document !== "undefined" ? document.getElementById("financial-report-body") : null;
  const tfoot = typeof document !== "undefined" ? document.getElementById("financial-report-foot") : null;

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table-cell">Loading restaurant financial report...</td></tr>`;
  }
  if (tfoot) tfoot.style.display = "none";

  try {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const queryString = params.toString();
    const endpoint = queryString ? `${ADMIN_RESTAURANT_REPORT}?${queryString}` : ADMIN_RESTAURANT_REPORT;

    const res = await callApi(ADMIN_PORT, endpoint, { timeoutMs: 3500 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();

    cachedFinancialRows = Array.isArray(rows) ? rows : [];
    renderFinancialTable();
    return cachedFinancialRows;
  } catch (err) {
    cachedFinancialRows = [];
    if (tbody) {
      tbody.innerHTML = renderEmptyBanner(
        "Financial Report Unavailable",
        `Failed to reach admin_service: ${escapeHtml(err.message)}`
      );
    }
    if (tfoot) tfoot.style.display = "none";
    return [];
  }
}

function renderFinancialTable() {
  if (typeof document === "undefined") return;
  const tbody = document.getElementById("financial-report-body");
  const tfoot = document.getElementById("financial-report-foot");
  const rowCountEl = document.getElementById("fin-row-count");
  if (!tbody) return;

  const searchInput = document.getElementById("fin-search-input");
  const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : "";

  let filtered = cachedFinancialRows;
  if (searchTerm) {
    filtered = filtered.filter((r) =>
      String(r.restaurantId || "").toLowerCase().includes(searchTerm)
    );
  }

  if (rowCountEl) {
    rowCountEl.textContent =
      cachedFinancialRows.length === 0
        ? "0 restaurants"
        : `Showing ${filtered.length} of ${cachedFinancialRows.length} restaurants`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = renderEmptyBanner(
      "No Restaurant Sales Recorded",
      searchTerm
        ? `No restaurants match "${escapeHtml(searchTerm)}".`
        : "No sales activity recorded for the specified date range."
    );
    if (tfoot) tfoot.style.display = "none";
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (r) => `
      <tr>
        <td class="col-left"><strong>${escapeHtml(r.restaurantId)}</strong></td>
        <td class="col-right">${formatNumber(r.orderCount)}</td>
        <td class="col-right col-money">${formatMoney(r.grossSales)}</td>
        <td class="col-right col-money" style="color: var(--admin-accent);">${formatMoney(r.commissionAmount)}</td>
        <td class="col-right col-money"><strong>${formatMoney(r.netPayout)}</strong></td>
      </tr>`
    )
    .join("");

  // Platform Totals Summary Row
  if (tfoot) {
    const totOrders = filtered.reduce((acc, r) => acc + Number(r.orderCount || 0), 0);
    const totGross = filtered.reduce((acc, r) => acc + Number(r.grossSales || 0), 0);
    const totFee = filtered.reduce((acc, r) => acc + Number(r.commissionAmount || 0), 0);
    const totNet = filtered.reduce((acc, r) => acc + Number(r.netPayout || 0), 0);

    setText("fin-total-orders", formatNumber(totOrders));
    setText("fin-total-gross", formatMoney(totGross));
    setText("fin-total-fee", formatMoney(totFee));
    setText("fin-total-net", formatMoney(totNet));
    tfoot.style.display = "";
  }
}

/**
 * Handles Quick Date Presets ('today', '7d', 'month', 'all')
 */
function applyFinPreset(preset) {
  const now = new Date();
  const toISO = (d) => d.toISOString().split("T")[0];
  let from = "";
  let to = "";

  if (preset === "today") {
    from = toISO(now);
    to = toISO(now);
  } else if (preset === "7d") {
    const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    from = toISO(past);
    to = toISO(now);
  } else if (preset === "month") {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    from = toISO(firstDay);
    to = toISO(now);
  } else {
    // "all"
    from = "";
    to = "";
  }

  const fromEl = document.getElementById("fin-date-from");
  const toEl = document.getElementById("fin-date-to");
  const fromTimeEl = document.getElementById("fin-time-from");
  const toTimeEl = document.getElementById("fin-time-to");
  if (fromEl) {
    fromEl.value = from;
    fromEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (toEl) {
    toEl.value = to;
    toEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (fromTimeEl) {
    fromTimeEl.value = preset === "all" ? "" : "00:00";
    fromTimeEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (toTimeEl) {
    toTimeEl.value = preset === "all" ? "" : "23:59";
    toTimeEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  document.querySelectorAll('.btn-preset[data-report="fin"]').forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-preset") === preset);
  });

  loadRestaurantReport(from, to);
}

// ============================================================================
// 7. DRIVER SLA AUDIT REPORT
// ============================================================================

async function loadDriverReport(from = "", to = "") {
  const tbody = typeof document !== "undefined" ? document.getElementById("driver-sla-body") : null;
  const tfoot = typeof document !== "undefined" ? document.getElementById("driver-sla-foot") : null;

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table-cell">Loading driver SLA audit report...</td></tr>`;
  }
  if (tfoot) tfoot.style.display = "none";

  try {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const queryString = params.toString();
    const endpoint = queryString ? `${ADMIN_DRIVER_REPORT}?${queryString}` : ADMIN_DRIVER_REPORT;

    const res = await callApi(ADMIN_PORT, endpoint, { timeoutMs: 3500 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();

    cachedDriverRows = Array.isArray(rows) ? rows : [];
    renderDriverTable();
    return cachedDriverRows;
  } catch (err) {
    cachedDriverRows = [];
    if (tbody) {
      tbody.innerHTML = renderEmptyBanner(
        "Driver SLA Report Unavailable",
        `Failed to reach admin_service: ${escapeHtml(err.message)}`
      );
    }
    if (tfoot) tfoot.style.display = "none";
    return [];
  }
}

function renderDriverTable() {
  if (typeof document === "undefined") return;
  const tbody = document.getElementById("driver-sla-body");
  const tfoot = document.getElementById("driver-sla-foot");
  const rowCountEl = document.getElementById("sla-row-count");
  if (!tbody) return;

  const searchInput = document.getElementById("sla-search-input");
  const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : "";

  const complianceSelect = document.getElementById("sla-compliance-filter");
  const complianceVal = complianceSelect ? complianceSelect.value : "all";

  let filtered = cachedDriverRows;

  // 1. Search term filter (ID or Name)
  if (searchTerm) {
    filtered = filtered.filter(
      (r) =>
        String(r.driverId || "").toLowerCase().includes(searchTerm) ||
        String(r.driverName || "").toLowerCase().includes(searchTerm)
    );
  }

  // 2. SLA Compliance Filter
  if (complianceVal === "breaches") {
    filtered = filtered.filter((r) => Number(r.slaBreaches || 0) > 0);
  } else if (complianceVal === "compliant") {
    filtered = filtered.filter((r) => Number(r.slaBreaches || 0) === 0);
  }

  if (rowCountEl) {
    rowCountEl.textContent =
      cachedDriverRows.length === 0
        ? "0 couriers"
        : `Showing ${filtered.length} of ${cachedDriverRows.length} couriers`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = renderEmptyBanner(
      "No Driver Activity Recorded",
      searchTerm || complianceVal !== "all"
        ? "No couriers match the current filter criteria."
        : "No completed deliveries found in the courier telemetry database."
    );
    if (tfoot) tfoot.style.display = "none";
    return;
  }

  tbody.innerHTML = filtered
    .map((r) => {
      const breaches = Number(r.slaBreaches || 0);
      const breachBadge =
        breaches > 0
          ? `<span class="status-pill pill-bad">${breaches} breach${breaches > 1 ? "es" : ""}</span>`
          : `<span class="status-pill pill-good">0 (Compliant)</span>`;

      const avgTurnaround =
        r.averageTurnaroundMinutes !== undefined && r.averageTurnaroundMinutes !== null
          ? `${Number(r.averageTurnaroundMinutes).toFixed(1)} min`
          : "—";

      return `
      <tr>
        <td class="col-left"><strong>${escapeHtml(r.driverId)}</strong></td>
        <td class="col-left">${escapeHtml(r.driverName || "—")}</td>
        <td class="col-right">${formatNumber(r.completedDeliveries)}</td>
        <td class="col-right">${avgTurnaround}</td>
        <td class="col-center">${breachBadge}</td>
      </tr>`;
    })
    .join("");

  // Fleet Totals Summary Row
  if (tfoot) {
    const totDeliveries = filtered.reduce((acc, r) => acc + Number(r.completedDeliveries || 0), 0);
    const totBreaches = filtered.reduce((acc, r) => acc + Number(r.slaBreaches || 0), 0);

    let weightedTurnaroundSum = 0;
    filtered.forEach((r) => {
      const count = Number(r.completedDeliveries || 0);
      const avg = Number(r.averageTurnaroundMinutes || 0);
      weightedTurnaroundSum += count * avg;
    });
    const fleetAvg = totDeliveries > 0 ? (weightedTurnaroundSum / totDeliveries).toFixed(1) + " min" : "—";

    setText("sla-total-deliveries", formatNumber(totDeliveries));
    setText("sla-avg-turnaround", fleetAvg);
    setText(
      "sla-total-breaches",
      totBreaches > 0
        ? `${totBreaches} total`
        : "0 breaches"
    );
    tfoot.style.display = "";
  }
}

/**
 * Handles Driver SLA Quick Date Presets ('today', '7d', 'month', 'all')
 */
function applySlaPreset(preset) {
  const now = new Date();
  const toISO = (d) => d.toISOString().split("T")[0];
  let from = "";
  let to = "";

  if (preset === "today") {
    from = toISO(now);
    to = toISO(now);
  } else if (preset === "7d") {
    const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    from = toISO(past);
    to = toISO(now);
  } else if (preset === "month") {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    from = toISO(firstDay);
    to = toISO(now);
  } else {
    // "all"
    from = "";
    to = "";
  }

  const fromEl = document.getElementById("sla-date-from");
  const toEl = document.getElementById("sla-date-to");
  const fromTimeEl = document.getElementById("sla-time-from");
  const toTimeEl = document.getElementById("sla-time-to");
  if (fromEl) {
    fromEl.value = from;
    fromEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (toEl) {
    toEl.value = to;
    toEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (fromTimeEl) {
    fromTimeEl.value = preset === "all" ? "" : "00:00";
    fromTimeEl.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (toTimeEl) {
    toTimeEl.value = preset === "all" ? "" : "23:59";
    toTimeEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  document.querySelectorAll('.btn-preset[data-report="sla"]').forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-preset") === preset);
  });

  loadDriverReport(from, to);
}

// ============================================================================
// 8. NOTIFICATION AUDIT TRAIL
// ============================================================================

async function loadNotifications(recipientId) {
  const targetRecipient = recipientId ? recipientId.trim() : "cust-42";
  currentNotifRecipient = targetRecipient;
  const tbody = typeof document !== "undefined" ? document.getElementById("notif-body") : null;

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table-cell">Loading audit trail for ${escapeHtml(
      targetRecipient
    )}...</td></tr>`;
  }

  try {
    const endpoint = `${NOTIF_URL}/${encodeURIComponent(targetRecipient)}`;
    const res = await callApi(NOTIF_PORT, endpoint, { timeoutMs: 3500 });

    if (res.status === 404) {
      cachedNotifRows = [];
      renderNotifTable();
      return [];
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();

    cachedNotifRows = Array.isArray(rows) ? rows : [];
    renderNotifTable();
    return cachedNotifRows;
  } catch (err) {
    cachedNotifRows = [];
    if (tbody) {
      tbody.innerHTML = renderEmptyBanner(
        "Audit Trail Unavailable",
        `Notification service unreachable: ${escapeHtml(err.message)}`
      );
    }
    return [];
  }
}

function renderNotifTable() {
  if (typeof document === "undefined") return;
  const tbody = document.getElementById("notif-body");
  const summaryEl = document.getElementById("notif-filter-summary");
  const countEl = document.getElementById("notif-row-count");
  if (!tbody) return;

  let filtered = cachedNotifRows;
  if (currentNotifChannel !== "ALL") {
    filtered = filtered.filter(
      (r) => String(r.channel || "").toUpperCase() === currentNotifChannel
    );
  }

  if (summaryEl) {
    summaryEl.textContent = `Showing ${currentNotifChannel} channel for ${currentNotifRecipient}`;
  }
  if (countEl) {
    countEl.textContent = `${filtered.length} dispatch${filtered.length === 1 ? "" : "es"}`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = renderEmptyBanner(
      "No Notifications Found",
      currentNotifChannel !== "ALL"
        ? `No ${currentNotifChannel} records found for recipient "${escapeHtml(currentNotifRecipient)}".`
        : `No dispatch records found for recipient "${escapeHtml(currentNotifRecipient)}".`
    );
    return;
  }

  // Display recent dispatches in reverse chronological order
  const recent = [...filtered].reverse();
  tbody.innerHTML = recent
    .map(
      (r) => `
      <tr>
        <td><span class="text-mono">${escapeHtml(r.sentAt || "—")}</span></td>
        <td><strong>${escapeHtml(r.recipientId || currentNotifRecipient)}</strong></td>
        <td><span class="status-pill pill-neutral">${escapeHtml(r.channel || "—")}</span></td>
        <td><span class="status-pill ${statusPillClass(r.status)}">${escapeHtml(r.status || "—")}</span></td>
        <td><code>${escapeHtml(r.notificationId || "—")}</code></td>
      </tr>`
    )
    .join("");
}

// ============================================================================
// 9. EVENT LISTENERS & INITIALIZATION
// ============================================================================

function setupEventListeners() {
  if (typeof document === "undefined") return;

  // Navigation tab click handlers
  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      if (targetTab) switchTab(targetTab);
    });
  });

  // Header "Refresh Now" button
  const refreshBtn = document.getElementById("btn-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      manualRefresh();
    });
  }

  // Auto-refresh interval select
  const intervalSelect = document.getElementById("auto-refresh-interval");
  if (intervalSelect) {
    intervalSelect.addEventListener("change", () => {
      const val = parseInt(intervalSelect.value, 10);
      autoRefreshIntervalMs = isNaN(val) ? 5000 : val;
      if (autoRefreshIntervalMs > 0) {
        countdownRemainingSec = Math.round(autoRefreshIntervalMs / 1000);
        updateCountdownBadge();
      } else {
        const textEl = document.getElementById("countdown-text");
        if (textEl) textEl.textContent = "Off";
      }
    });
  }

  // Ping All microservices buttons (in header card and in banner)
  const pingAllBtn = document.getElementById("btn-ping-all");
  if (pingAllBtn) {
    pingAllBtn.addEventListener("click", () => {
      checkHealth();
    });
  }

  const bannerPingBtn = document.getElementById("banner-ping-btn");
  if (bannerPingBtn) {
    bannerPingBtn.addEventListener("click", () => {
      checkHealth();
    });
  }

  // Individual Ping buttons on service cards
  document.querySelectorAll(".btn-ping-service").forEach((btn) => {
    btn.addEventListener("click", () => {
      const port = parseInt(btn.getAttribute("data-port"), 10);
      const dotId = btn.getAttribute("data-dot");
      const latencyId = btn.getAttribute("data-latency");
      if (port && dotId && latencyId) {
        pingSingleService(port, dotId, latencyId);
      }
    });
  });

  // Platform Overview: Activity Search and Refresh
  const refreshActivityBtn = document.getElementById("btn-refresh-activity");
  if (refreshActivityBtn) {
    refreshActivityBtn.addEventListener("click", () => {
      updateRecentActivity();
    });
  }

  const activitySearchInput = document.getElementById("activity-search-input");
  if (activitySearchInput) {
    activitySearchInput.addEventListener("input", () => {
      renderActivityTable();
    });
  }

  // Financial Report: Quick Date Presets
  document.querySelectorAll('.btn-preset[data-report="fin"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.getAttribute("data-preset");
      if (preset) applyFinPreset(preset);
    });
  });

  // Financial Report: Search Input Filter
  const finSearchInput = document.getElementById("fin-search-input");
  if (finSearchInput) {
    finSearchInput.addEventListener("input", () => {
      renderFinancialTable();
    });
  }

  // Financial Report submit & clear buttons
  const finReportBtn = document.getElementById("btn-generate-fin-report");
  if (finReportBtn) {
    finReportBtn.addEventListener("click", () => {
      const from = document.getElementById("fin-date-from")?.value || "";
      const to = document.getElementById("fin-date-to")?.value || "";
      loadRestaurantReport(from, to);
    });
  }

  const clearFinBtn = document.getElementById("btn-clear-fin-dates");
  if (clearFinBtn) {
    clearFinBtn.addEventListener("click", () => {
      applyFinPreset("all");
    });
  }

  // Driver SLA Report: Quick Date Presets
  document.querySelectorAll('.btn-preset[data-report="sla"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.getAttribute("data-preset");
      if (preset) applySlaPreset(preset);
    });
  });

  // Driver SLA Report: Search Input Filter & Compliance Filter
  const slaSearchInput = document.getElementById("sla-search-input");
  if (slaSearchInput) {
    slaSearchInput.addEventListener("input", () => {
      renderDriverTable();
    });
  }

  const slaComplianceFilter = document.getElementById("sla-compliance-filter");
  if (slaComplianceFilter) {
    slaComplianceFilter.addEventListener("change", () => {
      renderDriverTable();
    });
  }

  // Driver SLA submit & clear buttons
  const slaReportBtn = document.getElementById("btn-generate-sla-report");
  if (slaReportBtn) {
    slaReportBtn.addEventListener("click", () => {
      const from = document.getElementById("sla-date-from")?.value || "";
      const to = document.getElementById("sla-date-to")?.value || "";
      loadDriverReport(from, to);
    });
  }

  const clearSlaBtn = document.getElementById("btn-clear-sla-dates");
  if (clearSlaBtn) {
    clearSlaBtn.addEventListener("click", () => {
      applySlaPreset("all");
    });
  }

  // Notification Audit: Quick Recipient Chips
  document.querySelectorAll(".recipient-chip[data-recipient]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const recipient = chip.getAttribute("data-recipient");
      document.querySelectorAll(".recipient-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");

      const notifInput = document.getElementById("notif-recipient-input");
      const notifSelect = document.getElementById("notif-recipient-select");
      if (notifInput) notifInput.value = recipient;
      if (notifSelect) {
        // If recipient is among options, select it, else set to custom
        const exists = Array.from(notifSelect.options).some((o) => o.value === recipient);
        notifSelect.value = exists ? recipient : "custom";
        toggleCustomRecipientInput(notifSelect.value === "custom");
        notifSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      loadNotifications(recipient);
    });
  });

  // Notification Audit: Channel Filter Buttons
  document.querySelectorAll(".btn-channel[data-channel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-channel").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentNotifChannel = btn.getAttribute("data-channel") || "ALL";
      renderNotifTable();
    });
  });

  // Notification Recipient Select dropdown
  const notifSelect = document.getElementById("notif-recipient-select");
  const notifInput = document.getElementById("notif-recipient-input");
  if (notifSelect) {
    notifSelect.addEventListener("change", () => {
      if (notifSelect.value === "custom") {
        toggleCustomRecipientInput(true);
        if (notifInput) notifInput.focus();
      } else {
        toggleCustomRecipientInput(false);
        if (notifInput) notifInput.value = notifSelect.value;
        syncRecipientChips(notifSelect.value);
        loadNotifications(notifSelect.value);
      }
    });
  }

  // Notification search button & enter key
  const searchNotifBtn = document.getElementById("btn-search-notif");
  if (searchNotifBtn && notifInput) {
    searchNotifBtn.addEventListener("click", () => {
      const val = notifInput.value.trim() || "cust-42";
      syncRecipientChips(val);
      loadNotifications(val);
    });

    notifInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = notifInput.value.trim() || "cust-42";
        syncRecipientChips(val);
        loadNotifications(val);
      }
    });
  }

  // Initialize Custom Date & Time Pickers for financial and SLA date filters
  initCustomDatePickers();
}

/**
 * Custom Date & Time Picker Controller for Admin Dashboard
 * Replaces native OS date and time popups with bespoke floating calendar & time selectors.
 * Features:
 * - Calendar month navigation (prev/next)
 * - Interactive date selection
 * - Integrated and standalone hour & minute time inputs with quick chips
 * - Presets ('Today', 'Yesterday', 'Clear' for date; 'Now', 'Clear' for time)
 * - Single border, single chevron arrow, zero duplicate wrappers
 */
function initCustomDatePickers(root = document) {
  if (typeof document === "undefined") return;

  const inputs = root.querySelectorAll(
    'input[type="date"]:not([data-custom-datepicker-init="true"]), input[type="time"]:not([data-custom-datepicker-init="true"])'
  );

  inputs.forEach((input) => {
    // Prevent double-wrapping by setting both our flag and shared.js flag
    input.setAttribute("data-custom-datepicker-init", "true");
    input.setAttribute("data-custom-datetime-init", "true");

    const isTime = input.type === "time";

    // Visually hide native date/time input while preserving form bindings
    input.style.position = "absolute";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    input.style.width = "0";
    input.style.height = "0";
    input.style.margin = "0";
    input.style.padding = "0";
    input.style.border = "none";

    // Create custom datepicker wrapper
    const wrap = document.createElement("div");
    wrap.className = "custom-datepicker-wrap" + (isTime ? " custom-timepicker-wrap" : "");
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    let curDate = input.value && !isTime ? new Date(input.value + "T00:00:00") : null;
    let viewYear = curDate && !isNaN(curDate.getTime()) ? curDate.getFullYear() : new Date().getFullYear();
    let viewMonth = curDate && !isNaN(curDate.getTime()) ? curDate.getMonth() : new Date().getMonth();
    let selectedTime = isTime ? (input.value || "00:00") : (input.dataset.time || "00:00");

    // Trigger button with single border and single chevron
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-datepicker-trigger";

    const triggerLeft = document.createElement("div");
    triggerLeft.className = "custom-datepicker-trigger-left";

    const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    iconSvg.setAttribute("class", "custom-datepicker-icon");
    iconSvg.setAttribute("viewBox", "0 0 24 24");
    if (isTime) {
      iconSvg.innerHTML = '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>';
    } else {
      iconSvg.innerHTML = '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>';
    }

    const label = document.createElement("span");
    label.className = "custom-datepicker-label" + (input.value ? "" : " placeholder");

    function formatDisplay(val) {
      if (!val) return isTime ? "Select time..." : "Select date...";
      if (isTime) return val;
      try {
        const parts = val.split("-");
        if (parts.length === 3) {
          const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          const formatted = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
          return input.dataset.time ? `${formatted} ${input.dataset.time}` : formatted;
        }
      } catch (_) {}
      return val;
    }

    label.textContent = formatDisplay(input.value);

    triggerLeft.appendChild(iconSvg);
    triggerLeft.appendChild(label);
    trigger.appendChild(triggerLeft);

    const triggerRight = document.createElement("div");
    triggerRight.className = "custom-datepicker-trigger-right";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "custom-datepicker-clear";
    clearBtn.innerHTML = "&times;";
    clearBtn.title = isTime ? "Clear time" : "Clear date";
    clearBtn.style.display = input.value ? "flex" : "none";

    const chevronSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevronSvg.setAttribute("class", "custom-datepicker-chevron");
    chevronSvg.setAttribute("viewBox", "0 0 24 24");
    chevronSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

    triggerRight.appendChild(clearBtn);
    triggerRight.appendChild(chevronSvg);
    trigger.appendChild(triggerRight);

    wrap.appendChild(trigger);

    // Floating Popup
    const popup = document.createElement("div");
    popup.className = "custom-datepicker-popup";
    wrap.appendChild(popup);

    function updateLabel(val) {
      if (val) {
        label.textContent = formatDisplay(val);
        label.classList.remove("placeholder");
        clearBtn.style.display = "flex";
      } else {
        label.textContent = isTime ? "Select time..." : "Select date...";
        label.classList.add("placeholder");
        clearBtn.style.display = "none";
      }
    }

    function renderPopup() {
      popup.innerHTML = "";

      if (isTime) {
        // --- Standalone Time Picker Popup ---
        const header = document.createElement("div");
        header.className = "datepicker-header";
        const title = document.createElement("span");
        title.className = "datepicker-title";
        title.textContent = "Select Time";
        header.appendChild(title);
        popup.appendChild(header);

        const timeRow = document.createElement("div");
        timeRow.className = "datepicker-time-row standalone";

        const timeInputs = document.createElement("div");
        timeInputs.className = "datepicker-time-inputs";

        const curParts = (input.value || "00:00").split(":");
        const hInput = document.createElement("input");
        hInput.type = "number";
        hInput.min = "0";
        hInput.max = "23";
        hInput.className = "datepicker-time-input";
        hInput.value = String(curParts[0] || "00").padStart(2, "0");

        const colon = document.createElement("span");
        colon.textContent = ":";
        colon.style.fontWeight = "700";

        const mInput = document.createElement("input");
        mInput.type = "number";
        mInput.min = "0";
        mInput.max = "59";
        mInput.className = "datepicker-time-input";
        mInput.value = String(curParts[1] || "00").padStart(2, "0");

        function applyTimeInput() {
          const hh = String(Math.max(0, Math.min(23, Number(hInput.value) || 0))).padStart(2, "0");
          const mm = String(Math.max(0, Math.min(59, Number(mInput.value) || 0))).padStart(2, "0");
          const timeVal = `${hh}:${mm}`;
          input.value = timeVal;
          updateLabel(timeVal);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        hInput.addEventListener("change", applyTimeInput);
        mInput.addEventListener("change", applyTimeInput);

        timeInputs.appendChild(hInput);
        timeInputs.appendChild(colon);
        timeInputs.appendChild(mInput);
        timeRow.appendChild(timeInputs);
        popup.appendChild(timeRow);

        // Quick time chips
        const timeChips = document.createElement("div");
        timeChips.className = "datepicker-time-chips-wrap";
        ["00:00", "06:00", "12:00", "18:00", "22:00", "23:59"].forEach((t) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "datepicker-time-chip";
          chip.textContent = t;
          chip.addEventListener("click", (e) => {
            e.stopPropagation();
            input.value = t;
            updateLabel(t);
            wrap.classList.remove("open");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          });
          timeChips.appendChild(chip);
        });
        popup.appendChild(timeChips);

        // Presets: 'Now', 'Clear'
        const footer = document.createElement("div");
        footer.className = "datepicker-presets-footer";

        const nowBtn = document.createElement("button");
        nowBtn.type = "button";
        nowBtn.className = "datepicker-preset-btn";
        nowBtn.textContent = "Now";
        nowBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const d = new Date();
          const hh = String(d.getHours()).padStart(2, "0");
          const mm = String(d.getMinutes()).padStart(2, "0");
          const val = `${hh}:${mm}`;
          input.value = val;
          updateLabel(val);
          wrap.classList.remove("open");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });

        const clearTimeBtn = document.createElement("button");
        clearTimeBtn.type = "button";
        clearTimeBtn.className = "datepicker-preset-btn";
        clearTimeBtn.textContent = "Clear";
        clearTimeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          input.value = "";
          updateLabel("");
          wrap.classList.remove("open");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });

        footer.appendChild(nowBtn);
        footer.appendChild(clearTimeBtn);
        popup.appendChild(footer);

      } else {
        // --- Full Date & Time Picker Popup ---
        // 1. Month Navigation Header
        const header = document.createElement("div");
        header.className = "datepicker-header";

        const prevBtn = document.createElement("button");
        prevBtn.type = "button";
        prevBtn.className = "datepicker-nav-btn";
        prevBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        prevBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          viewMonth--;
          if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
          }
          renderPopup();
        });

        const title = document.createElement("span");
        title.className = "datepicker-title";
        const monthNames = [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"
        ];
        title.textContent = `${monthNames[viewMonth]} ${viewYear}`;

        const nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className = "datepicker-nav-btn";
        nextBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        nextBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          viewMonth++;
          if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
          }
          renderPopup();
        });

        header.appendChild(prevBtn);
        header.appendChild(title);
        header.appendChild(nextBtn);
        popup.appendChild(header);

        // 2. Weekdays
        const weekdays = document.createElement("div");
        weekdays.className = "datepicker-weekdays";
        ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((day) => {
          const dEl = document.createElement("span");
          dEl.textContent = day;
          weekdays.appendChild(dEl);
        });
        popup.appendChild(weekdays);

        // 3. Days Grid
        const grid = document.createElement("div");
        grid.className = "datepicker-days-grid";

        const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

        // Filler days from prev month
        for (let i = firstDayIndex - 1; i >= 0; i--) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "datepicker-day other-month";
          btn.textContent = prevMonthDays - i;
          btn.disabled = true;
          grid.appendChild(btn);
        }

        const todayStr = new Date().toISOString().split("T")[0];
        const selectedStr = input.value;

        for (let day = 1; day <= daysInMonth; day++) {
          const dayBtn = document.createElement("button");
          dayBtn.type = "button";
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

          dayBtn.className = "datepicker-day";
          if (dateStr === todayStr) dayBtn.classList.add("today");
          if (dateStr === selectedStr) dayBtn.classList.add("active");
          dayBtn.textContent = day;

          dayBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            input.value = dateStr;
            updateLabel(dateStr);
            wrap.classList.remove("open");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          });

          grid.appendChild(dayBtn);
        }
        popup.appendChild(grid);

        // 4. Time Selector Row inside Calendar Popup
        const timeRow = document.createElement("div");
        timeRow.className = "datepicker-time-row";

        const timeLabel = document.createElement("span");
        timeLabel.className = "datepicker-time-label";
        timeLabel.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Time';

        const timeInputs = document.createElement("div");
        timeInputs.className = "datepicker-time-inputs";

        const curT = selectedTime.split(":");
        const hInput = document.createElement("input");
        hInput.type = "number";
        hInput.min = "0";
        hInput.max = "23";
        hInput.className = "datepicker-time-input";
        hInput.value = String(curT[0] || "00").padStart(2, "0");

        const colon = document.createElement("span");
        colon.textContent = ":";
        colon.style.fontWeight = "700";

        const mInput = document.createElement("input");
        mInput.type = "number";
        mInput.min = "0";
        mInput.max = "59";
        mInput.className = "datepicker-time-input";
        mInput.value = String(curT[1] || "00").padStart(2, "0");

        function onTimeChange() {
          const hh = String(Math.max(0, Math.min(23, Number(hInput.value) || 0))).padStart(2, "0");
          const mm = String(Math.max(0, Math.min(59, Number(mInput.value) || 0))).padStart(2, "0");
          selectedTime = `${hh}:${mm}`;
          input.dataset.time = selectedTime;
          if (input.value) updateLabel(input.value);
        }

        hInput.addEventListener("change", onTimeChange);
        mInput.addEventListener("change", onTimeChange);

        timeInputs.appendChild(hInput);
        timeInputs.appendChild(colon);
        timeInputs.appendChild(mInput);

        const timeChips = document.createElement("div");
        timeChips.className = "datepicker-time-chips";
        ["00:00", "12:00", "23:59"].forEach((t) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "datepicker-time-chip";
          chip.textContent = t;
          chip.addEventListener("click", (e) => {
            e.stopPropagation();
            const parts = t.split(":");
            hInput.value = parts[0];
            mInput.value = parts[1];
            selectedTime = t;
            input.dataset.time = t;
            if (input.value) updateLabel(input.value);
          });
          timeChips.appendChild(chip);
        });

        timeRow.appendChild(timeLabel);
        timeRow.appendChild(timeInputs);
        timeRow.appendChild(timeChips);
        popup.appendChild(timeRow);

        // 5. Presets Footer: 'Today', 'Yesterday', 'Clear'
        const footer = document.createElement("div");
        footer.className = "datepicker-presets-footer";

        const presets = [
          { label: "Today", getVal: () => new Date().toISOString().split("T")[0] },
          { label: "Yesterday", getVal: () => new Date(Date.now() - 86400000).toISOString().split("T")[0] },
          { label: "Clear", getVal: () => "" }
        ];

        presets.forEach((p) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "datepicker-preset-btn";
          btn.textContent = p.label;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const val = p.getVal();
            input.value = val;
            updateLabel(val);
            wrap.classList.remove("open");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          });
          footer.appendChild(btn);
        });

        popup.appendChild(footer);
      }
    }

    // Toggle open/close
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = wrap.classList.contains("open");
      if (typeof closeAllDatePickers === "function") closeAllDatePickers();
      if (typeof closeAllDropdowns === "function") closeAllDropdowns();
      document.querySelectorAll(".custom-datepicker-wrap.open").forEach((el) => el.classList.remove("open"));

      if (!isOpen) {
        if (input.value && !isTime) {
          const d = new Date(input.value + "T00:00:00");
          if (!isNaN(d.getTime())) {
            viewYear = d.getFullYear();
            viewMonth = d.getMonth();
          }
        }
        renderPopup();
        wrap.classList.add("open");
      }
    });

    // Clear button action
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      input.value = "";
      delete input.dataset.time;
      updateLabel("");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Listen to programmatic changes (e.g. applyFinPreset, applySlaPreset)
    input.addEventListener("change", () => {
      updateLabel(input.value);
    });
  });
}

// Global click outside and escape handlers for custom datepicker popups
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".custom-datepicker-wrap")) {
      document.querySelectorAll(".custom-datepicker-wrap.open").forEach((el) => el.classList.remove("open"));
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".custom-datepicker-wrap.open").forEach((el) => el.classList.remove("open"));
    }
  });
}

function toggleCustomRecipientInput(show) {
  const group = document.getElementById("notif-custom-recipient-group");
  if (group) group.style.display = show ? "flex" : "none";
}

function syncRecipientChips(recipient) {
  document.querySelectorAll(".recipient-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.getAttribute("data-recipient") === recipient);
  });
}

function updateCountdownBadge() {
  const textEl = document.getElementById("countdown-text");
  if (textEl) {
    textEl.textContent = autoRefreshIntervalMs > 0 ? `${countdownRemainingSec}s` : "Off";
  }
}

function startTicker() {
  if (tickerTimerId) clearInterval(tickerTimerId);
  tickerTimerId = setInterval(() => {
    if (autoRefreshIntervalMs <= 0) return;
    countdownRemainingSec--;
    if (countdownRemainingSec <= 0) {
      countdownRemainingSec = Math.round(autoRefreshIntervalMs / 1000);
      pollCycle();
    }
    updateCountdownBadge();
  }, 1000);
}

function stopTicker() {
  if (tickerTimerId) {
    clearInterval(tickerTimerId);
    tickerTimerId = null;
  }
}

function manualRefresh() {
  loadOverview();
  checkHealth();

  const activeTab = getActiveTabId();
  if (activeTab === "tab-financial") {
    const from = document.getElementById("fin-date-from")?.value || "";
    const to = document.getElementById("fin-date-to")?.value || "";
    loadRestaurantReport(from, to);
  } else if (activeTab === "tab-driver-sla") {
    const from = document.getElementById("sla-date-from")?.value || "";
    const to = document.getElementById("sla-date-to")?.value || "";
    loadDriverReport(from, to);
  } else if (activeTab === "tab-notifications") {
    const recipient = document.getElementById("notif-recipient-input")?.value?.trim() || currentNotifRecipient;
    loadNotifications(recipient);
  }

  // Reset countdown on manual refresh
  if (autoRefreshIntervalMs > 0) {
    countdownRemainingSec = Math.round(autoRefreshIntervalMs / 1000);
    updateCountdownBadge();
  }
}

function pollCycle() {
  loadOverview();
  checkHealth();

  const activeTab = getActiveTabId();
  if (activeTab === "tab-notifications" && typeof document !== "undefined") {
    const recipient = document.getElementById("notif-recipient-input")?.value?.trim() || currentNotifRecipient;
    loadNotifications(recipient);
  }
}

function initDefaults() {
  if (typeof document === "undefined") return;

  countdownRemainingSec = Math.round(autoRefreshIntervalMs / 1000);
  updateCountdownBadge();
  startTicker();

  // Initialize custom datepickers
  initCustomDatePickers();

  // Initial data loading across tabs
  loadOverview();
  checkHealth();
  loadRestaurantReport("", "");
  loadDriverReport("", "");
  loadNotifications("cust-42");
}

// Bootstrap on DOM ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setupEventListeners();
      initDefaults();
    });
  } else {
    setupEventListeners();
    initDefaults();
  }
}

// Global Exports
const AdminApp = {
  callApi,
  apiFetch: callApi,
  initCustomDatePickers,
  SERVICES,
  ADMIN_PORT,
  NOTIF_PORT,
  ADMIN_STATS,
  ADMIN_RESTAURANT_REPORT,
  ADMIN_DRIVER_REPORT,
  NOTIF_URL,
  switchTab,
  loadOverview,
  updateRecentActivity,
  checkHealth,
  pingSingleService,
  loadRestaurantReport,
  loadDriverReport,
  loadNotifications,
  applyFinPreset,
  applySlaPreset,
  manualRefresh,
  startTicker,
  stopTicker
};

if (typeof window !== "undefined") {
  window.AdminApp = AdminApp;
  window.callApi = callApi;
  window.apiFetch = callApi;
  window.initCustomDatePickers = initCustomDatePickers;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = AdminApp;
}