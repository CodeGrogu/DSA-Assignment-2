const ADMIN_OVERVIEW = "http://localhost:9098/admin/stats/overview";
const ADMIN_HEALTH = "http://localhost:9098/health";
const NOTIF_HEALTH = "http://localhost:9095/notifications/recipient/cust-42";

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

    setHealth("health-admin", true);
    setText("last-updated", "Updated " + new Date().toLocaleTimeString());
    document.getElementById("last-updated").classList.remove("stale");
  } catch (e) {
    setHealth("health-admin", false);
    setText("last-updated", "Admin service unreachable");
    document.getElementById("last-updated").classList.add("stale");
  }
}

async function loadNotifications() {
  try {
    const res = await fetchWithTimeout(NOTIF_HEALTH, 3000);
    setHealth("health-notif", res.ok || res.status === 404);

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
    setHealth("health-notif", false);
  }
}

function refresh() {
  loadOverview();
  loadNotifications();
}

refresh();
setInterval(refresh, POLL_MS);