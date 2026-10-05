// Shared helpers for the integration and load tests (Node 18+, no dependencies).
export const PORTS = {
  orders: 9091, customers: 9093, payments: 9094, restaurants: 9095,
  deliveries: 9096, notifications: 9097, admin: 9098,
};

export const base = (name) =>
  process.env[`${name.toUpperCase()}_URL`] ?? `http://localhost:${PORTS[name]}`;

export async function call(name, method, path, body, timeoutMs = 15000) {
  const started = performance.now();
  try {
    const res = await fetch(`${base(name)}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json, text, ms: performance.now() - started };
  } catch (err) {
    return { status: 0, json: undefined, text: String(err), ms: performance.now() - started };
  }
}

export const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0;

export const menuItem = (id, stock) => ({ id, name: `Item ${id}`, price: 25.5, stock });

export function restaurantPayload(tag, items) {
  return {
    name: `E2E-${tag}-${Date.now()}`,
    address: "1 Test Street, Windhoek",
    location: { type: "Point", coordinates: [17.0658, -22.5609] },
    contactNumber: "+264811234567",
    menu: [{ id: "cat-main", name: "Mains", items }],
  };
}

export async function createRestaurant(tag, items) {
  const res = await call("restaurants", "POST", "/restaurants", restaurantPayload(tag, items));
  const ok = [200, 201].includes(res.status) && typeof res.json?.id === "string" && res.json.id !== "";
  return { ok, id: res.json?.id, res };
}

export function findItem(restaurant, itemId) {
  for (const cat of restaurant?.menu ?? []) {
    for (const it of cat.items ?? []) if (it.id === itemId) return it;
  }
  return undefined;
}

