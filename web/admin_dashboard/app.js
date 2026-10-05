const ADMIN_OVERVIEW = "http://localhost:9098/admin/stats/overview";
const NOTIF_URL = "http://localhost:9097/notifications/recipient/cust-42";

const SERVICES = [
  { id: "health-order", name: "order_service", port: 9091 },
  { id: "health-customer", name: "customer_service", port: 9093 },
  { id: "health-payment", name: "payment_service", port: 9094 },
  { id: "health-restaurant", name: "restaurant_service", port: 9095 },
  { id: "health-delivery", name: "delivery_service", port: 9096 },
  { id: "health-notif", name: "notification_service", port: 9097 },
  { id: "health-admin", name: "admin_service", port: 9098 },
];

const POLL_MS = 5000;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setHealth(id, isUp) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("up", "down");
  el.classList.add(isUp ? "up" : "down");
}

function formatNumber(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString();
}

function formatMoney(d) {
  if (d === null || d === undefined) return "—";
  return "N$ " + Number(d).toFixed(2);
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("fail") || s.includes("error")) return "bad";
  if (s.includes("pend") || s.includes("queue")) return "wait";
  if (s.includes("sent") || s.includes("deliver") || s.includes("ok")) return "good";
  return "";
}

async function loadOverview() {
  try {
    const res = await fetchWithTimeout(ADMIN_OVERVIEW, 3000);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    setText("kpi-orders", formatNumber(data.totalOrders));
    setText("kpi-gmv", formatMoney(data.grossMerchandiseValue));
    setText("kpi-payments-ok", formatNumber(data.successfulPayments));
    setText("kpi-payments-fail", formatNumber(data.failedPayments));
    setText("kpi-active", formatNumber(data.activeDeliveries));

    setText("last-updated", "Updated " + new Date().toLocaleTimeString());
    document.getElementById("last-updated").classList.remove("stale");
  } catch (e) {
    setText("last-updated", "Admin service unreachable");
    document.getElementById("last-updated").classList.add("stale");
  }
}

async function checkHealth() {
  await Promise.allSettled(
    SERVICES.map(async (svc) => {
      try {
        const res = await fetchWithTimeout(`http://localhost:${svc.port}/health`, 2500);
        setHealth(svc.id, res.ok);
      } catch (e) {
        setHealth(svc.id, false);
      }
    })
  );
}

async function loadNotifications() {
  try {
    const res = await fetchWithTimeout(NOTIF_URL, 3000);
    if (res.status === 404) {
      document.getElementById("notif-body").innerHTML =
        '<tr><td colspan="4" class="empty">No notifications for cust-42 yet</td></tr>';
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);

    const rows = await res.json();
    const body = document.getElementById("notif-body");

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">No notifications yet</td></tr>';
      return;
    }

    body.innerHTML = rows.slice(-10).reverse().map(r =>
      '<tr>' +
      '<td>' + (r.sentAt || '') + '</td>' +
      '<td><span class="badge">' + (r.channel || '') + '</span></td>' +
      '<td><span class="badge ' + statusClass(r.status) + '">' + (r.status || '') + '</span></td>' +
      '<td>' + (r.notificationId || '') + '</td>' +
      '</tr>'
    ).join('');
  } catch (e) {
    // If not reachable or error, leave empty state
  }
}

function refresh() {
  loadOverview();
  checkHealth();
  loadNotifications();
}

const refreshBtn = document.getElementById("btn-refresh");
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => refresh());
}

refresh();
setInterval(refresh, POLL_MS);