// Shared helpers for the integration and load tests (Node 18+, no dependencies).

export const PORTS = {
  orders: 9091,
  customers: 9093,
  payments: 9094,
  restaurants: 9095,
  deliveries: 9096,
  notifications: 9097,
  admin: 9098,
} as const;

export type ServiceName = keyof typeof PORTS;

export interface HttpCallResult<T = unknown> {
  status: number;
  json?: T;
  text: string;
  ms: number;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface LocationCoordinates {
  type: "Point";
  coordinates: [number, number];
}

export interface RestaurantPayload {
  name: string;
  address: string;
  location: LocationCoordinates;
  contactNumber: string;
  menu: MenuCategory[];
}

export interface CreateRestaurantResult {
  ok: boolean;
  id?: string;
  res: HttpCallResult<{ id?: string }>;
}

export const base = (name: ServiceName): string =>
  process.env[`${name.toUpperCase()}_URL`] ?? `http://localhost:${PORTS[name]}`;

export async function call<T = unknown>(
  name: ServiceName,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs: number = 15000
): Promise<HttpCallResult<T>> {
  const started = performance.now();
  try {
    const res = await fetch(`${base(name)}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    let json: T | undefined;
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = undefined;
    }

    return { status: res.status, json, text, ms: performance.now() - started };
  } catch (err) {
    return {
      status: 0,
      json: undefined,
      text: err instanceof Error ? err.message : String(err),
      ms: performance.now() - started,
    };
  }
}

export const percentile = (sorted: number[], p: number): number =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
    : 0;

export const menuItem = (id: string, stock: number): MenuItem => ({
  id,
  name: `Item ${id}`,
  price: 25.5,
  stock,
});

export function restaurantPayload(
  tag: string,
  items: MenuItem[]
): RestaurantPayload {
  return {
    name: `E2E-${tag}-${Date.now()}`,
    address: "1 Test Street, Windhoek",
    location: { type: "Point", coordinates: [17.0658, -22.5609] },
    contactNumber: "+264811234567",
    menu: [{ id: "cat-main", name: "Mains", items }],
  };
}

export async function createRestaurant(
  tag: string,
  items: MenuItem[]
): Promise<CreateRestaurantResult> {
  const res = await call<{ id?: string }>(
    "restaurants",
    "POST",
    "/restaurants",
    restaurantPayload(tag, items)
  );

  const ok =
    [200, 201].includes(res.status) &&
    typeof res.json?.id === "string" &&
    res.json.id !== "";

  return { ok, id: res.json?.id, res };
}

export function findItem(
  restaurant: { menu?: MenuCategory[] } | null | undefined,
  itemId: string
): MenuItem | undefined {
  for (const cat of restaurant?.menu ?? []) {
    for (const it of cat.items ?? []) {
      if (it.id === itemId) return it;
    }
  }
  return undefined;
}
s