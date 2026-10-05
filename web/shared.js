/**
 * Food Delivery Suite — Shared JavaScript Library (shared.js)
 * Modern Resilient Networking, Mathematical Projections, Formatters & UI Utilities
 */

// ============================================================================
// 1. ROBUST MULTI-PORT & PROXY NETWORKING
// ============================================================================

/**
 * Resolves candidate URLs in priority order:
 * 1. If running directly on reverse-proxy port 8080: relative /api/${port}${cleanPath}
 * 2. Direct microservice port on matching browser hostname (e.g. http://127.0.0.1:9091 or http://localhost:9091)
 * 3. Direct microservice port on fallback loopback interfaces (127.0.0.1, localhost)
 * 4. Reverse-proxy candidates on port 8080
 */
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
 * Resolves optimal primary API URL.
 */
function resolveApiUrl(port, path) {
  const candidates = getCandidateUrls(port, path);
  return candidates[0] || `/api/${port}${path.startsWith('/') ? path : '/' + path}`;
}

/**
 * Resilient API fetch that tries prioritized candidate URLs.
 * Default timeout is 4000ms.
 */
async function apiFetch(port, path, options = {}) {
  const timeoutMs = options.timeoutMs || options.timeout || 4000;
  const urls = getCandidateUrls(port, path);

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
      delete fetchOpts.timeout;

      const res = await fetch(url, fetchOpts);
      clearTimeout(timer);

      // If proxy gateway error (502/503/504), continue to direct microservice candidate
      if ((res.status === 502 || res.status === 503 || res.status === 504) && url.includes(':8080')) {
        lastError = new Error(`Proxy gateway error (${res.status}) on ${url}`);
        continue;
      }

      // If Live Server (or static server) returns 404 HTML, continue to next candidate
      const contentType = res.headers ? res.headers.get('content-type') || '' : '';
      if (res.status === 404 && contentType.includes('text/html')) {
        lastError = new Error(`404 HTML from static server on ${url}`);
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      // Network/Abort error: fall through to next candidate URL
    }
  }

  throw lastError || new Error(`Failed to reach service on port ${port} across all candidate URLs`);
}

// Immutable internal reference protecting shared fetcher from global scope hijacking
const _internalApiFetch = apiFetch;

/**
 * Checks service health on a specific port.
 * Calls apiFetch(port, '/health') and returns { up: boolean, latencyMs: number, data: object }.
 */
async function probeHealth(port) {
  const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  try {
    const res = await _internalApiFetch(port, '/health', { timeoutMs: 5000 });
    const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const latencyMs = Math.max(1, Math.round(end - start));

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { up: true, latencyMs, data, status: 'UP' };
    }
    const data = await res.json().catch(() => ({}));
    return { up: false, latencyMs, data, status: `HTTP ${res.status}` };
  } catch (err) {
    return { up: false, latencyMs: 0, data: { error: err.message }, status: 'OFFLINE' };
  }
}

// ============================================================================
// 1.5 DISTRIBUTED MULTI-TIER CACHING & OFFLINE PERSISTENCE ENGINE
// ============================================================================

function safeClone(obj) {
  if (obj === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch (_) {}
  }
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_) {
    return obj;
  }
}

function extractHeadersObj(headers) {
  if (!headers) return {};
  if (typeof headers.forEach === 'function') {
    const obj = {};
    headers.forEach((val, key) => { obj[key] = val; });
    return obj;
  }
  if (typeof headers.entries === 'function') {
    return Object.fromEntries(headers.entries());
  }
  return typeof headers === 'object' ? { ...headers } : {};
}

/**
 * Creates a synthetic Response mimicking the browser Fetch Response interface
 */
function createCachedResponse(data, status = 200, headers = {}) {
  let headerObj;
  if (typeof Headers !== 'undefined') {
    try {
      headerObj = new Headers(headers);
    } catch (_) {
      headerObj = {
        get: (k) => headers ? (headers[k] || headers[k.toLowerCase()] || null) : null,
        has: (k) => Boolean(headers && (k in headers || k.toLowerCase() in headers))
      };
    }
  } else {
    headerObj = {
      get: (k) => headers ? (headers[k] || headers[k.toLowerCase()] || null) : null,
      has: (k) => Boolean(headers && (k in headers || k.toLowerCase() in headers))
    };
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : `Status ${status}`,
    headers: headerObj,
    json: async () => safeClone(data),
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
    clone() {
      return createCachedResponse(data, status, headers);
    },
    _cached: true
  };
}

/**
 * Multi-Tier Cache Engine (Tier 1 Memory + Tier 2 Persistent LocalStorage)
 */
const DSA_CacheEngine = {
  _memoryCache: new Map(),
  _inflightRequests: new Map(),

  TTL: {
    STATIC: 600000,       // 10 min: /restaurants, /menu, /items
    SEMI_STATIC: 180000,  // 3 min: /customers, /addresses
    POLL_METRICS: 15000,  // 15 sec: /health, /pricing/current, /notifications/recipient/
    VOLATILE: 1500        // 1.5 sec: /orders/, /delivery/track/, /deliveries/ (memory memoization only)
  },

  getTtlForPath(path) {
    const p = String(path || '').toLowerCase();
    if (p.includes('/orders') || p.includes('/delivery/track') || p.includes('/deliveries')) {
      return { ttlMs: this.TTL.VOLATILE, memoryOnly: true };
    }
    if (p.includes('/health') || p.includes('/pricing/current') || p.includes('/notifications/recipient')) {
      return { ttlMs: this.TTL.POLL_METRICS, memoryOnly: false };
    }
    if (p.includes('/customers') || p.includes('/addresses')) {
      return { ttlMs: this.TTL.SEMI_STATIC, memoryOnly: false };
    }
    if (p.includes('/restaurants') || p.includes('/menu') || p.includes('/items')) {
      return { ttlMs: this.TTL.STATIC, memoryOnly: false };
    }
    return { ttlMs: 60000, memoryOnly: false };
  },

  get(key) {
    // 1. Check Tier 1 (Memory)
    if (this._memoryCache.has(key)) {
      return this._memoryCache.get(key);
    }
    // 2. Check Tier 2 (Persistent localStorage)
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('dsa_cache:' + key);
        if (raw) {
          const entry = JSON.parse(raw);
          if (entry && typeof entry === 'object' && entry.timestamp) {
            this._memoryCache.set(key, entry);
            return entry;
          } else {
            localStorage.removeItem('dsa_cache:' + key);
          }
        }
      } catch (err) {
        // Corrupted JSON - auto evict
        try { localStorage.removeItem('dsa_cache:' + key); } catch (_) {}
      }
    }
    return null;
  },

  set(key, data, ttlMs = 60000, status = 200, headers = {}, memoryOnly = false) {
    const timestamp = Date.now();
    const entry = { data, timestamp, ttlMs, status, headers };
    this._memoryCache.set(key, entry);

    if (!memoryOnly && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('dsa_cache:' + key, JSON.stringify(entry));
      } catch (err) {
        // QuotaExceededError - FIFO evict oldest 10 entries
        this.evictOldest(10);
        try {
          localStorage.setItem('dsa_cache:' + key, JSON.stringify(entry));
        } catch (_) {}
      }
    }
    return entry;
  },

  invalidate(key) {
    this._memoryCache.delete(key);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('dsa_cache:' + key);
      } catch (_) {}
    }
  },

  invalidatePrefix(prefix) {
    for (const k of this._memoryCache.keys()) {
      if (k.startsWith(prefix) || k.includes(prefix)) {
        this._memoryCache.delete(k);
      }
    }
    if (typeof localStorage !== 'undefined') {
      try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('dsa_cache:')) {
            const innerKey = k.slice('dsa_cache:'.length);
            if (innerKey.startsWith(prefix) || innerKey.includes(prefix)) {
              toRemove.push(k);
            }
          }
        }
        for (const k of toRemove) {
          localStorage.removeItem(k);
        }
      } catch (_) {}
    }
  },

  evictOldest(count = 10) {
    if (typeof localStorage === 'undefined') return;
    try {
      const items = [];
      const corrupted = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('dsa_cache:')) {
          try {
            const raw = localStorage.getItem(k);
            if (!raw) {
              corrupted.push(k);
              continue;
            }
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.timestamp === 'number') {
              items.push({ storageKey: k, timestamp: parsed.timestamp });
            } else {
              corrupted.push(k);
            }
          } catch (_) {
            corrupted.push(k);
          }
        }
      }

      for (const k of corrupted) {
        try { localStorage.removeItem(k); } catch (_) {}
      }

      items.sort((a, b) => a.timestamp - b.timestamp);
      const evictCount = Math.min(count, items.length);
      for (let i = 0; i < evictCount; i++) {
        try { localStorage.removeItem(items[i].storageKey); } catch (_) {}
      }
    } catch (_) {}
  },

  clear() {
    this._memoryCache.clear();
    this._inflightRequests.clear();
    if (typeof localStorage !== 'undefined') {
      try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('dsa_cache:')) {
            toRemove.push(k);
          }
        }
        for (const k of toRemove) {
          localStorage.removeItem(k);
        }
      } catch (_) {}
    }
  }
};

function invalidateRelatedMutationCache(path) {
  const p = String(path || '').toLowerCase();
  if (p.includes('order')) {
    DSA_CacheEngine.invalidatePrefix('GET:8083:/orders');
    DSA_CacheEngine.invalidatePrefix('/orders');
    DSA_CacheEngine.invalidatePrefix('orders');
  }
  if (p.includes('deliver')) {
    DSA_CacheEngine.invalidatePrefix('GET:8084:/delivery');
    DSA_CacheEngine.invalidatePrefix('GET:8084:/deliveries');
    DSA_CacheEngine.invalidatePrefix('/delivery');
    DSA_CacheEngine.invalidatePrefix('/deliveries');
    DSA_CacheEngine.invalidatePrefix('delivery');
  }
  if (p.includes('customer') || p.includes('address')) {
    DSA_CacheEngine.invalidatePrefix('GET:8081:/customers');
    DSA_CacheEngine.invalidatePrefix('GET:8081:/addresses');
    DSA_CacheEngine.invalidatePrefix('/customers');
    DSA_CacheEngine.invalidatePrefix('/addresses');
    DSA_CacheEngine.invalidatePrefix('customers');
  }
  if (p.includes('restaurant') || p.includes('menu') || p.includes('item')) {
    DSA_CacheEngine.invalidatePrefix('GET:8082:/restaurants');
    DSA_CacheEngine.invalidatePrefix('GET:8082:/menu');
    DSA_CacheEngine.invalidatePrefix('/restaurants');
    DSA_CacheEngine.invalidatePrefix('/menu');
    DSA_CacheEngine.invalidatePrefix('restaurants');
  }
  if (p.includes('notification')) {
    DSA_CacheEngine.invalidatePrefix('GET:8085:/notifications');
    DSA_CacheEngine.invalidatePrefix('/notifications');
    DSA_CacheEngine.invalidatePrefix('notifications');
  }
  if (p.includes('pricing')) {
    DSA_CacheEngine.invalidatePrefix('GET:8083:/pricing');
    DSA_CacheEngine.invalidatePrefix('/pricing');
  }
}

function triggerBackgroundRevalidate(port, path, options, cacheKey, ttlMs, memoryOnly) {
  const bgKey = 'bg:' + cacheKey;
  if (DSA_CacheEngine._inflightRequests.has(bgKey)) {
    return;
  }
  const bgPromise = (async () => {
    try {
      const res = await _internalApiFetch(port, path, { ...options, _skipCache: true });
      if (res && res.ok) {
        let data;
        const contentType = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') || '' : '';
        if (contentType.includes('application/json')) {
          data = await res.json();
        } else {
          const text = await res.text();
          try { data = JSON.parse(text); } catch (_) { data = text; }
        }
        const headers = extractHeadersObj(res.headers);
        DSA_CacheEngine.set(cacheKey, data, ttlMs, res.status, headers, memoryOnly);
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
          window.dispatchEvent(new CustomEvent('dsa:cache-updated', {
            detail: { key: cacheKey, data, port, path }
          }));
        }
      }
    } catch (_) {
      // Ignore background errors
    } finally {
      DSA_CacheEngine._inflightRequests.delete(bgKey);
    }
  })();
  DSA_CacheEngine._inflightRequests.set(bgKey, bgPromise);
}

/**
 * Public async wrapper over apiFetch using SWR and mutation invalidation rules.
 */
async function cachedApiFetch(port, path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();

  // Mutation Invalidation Contract
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const res = await _internalApiFetch(port, path, options);
    invalidateRelatedMutationCache(path);
    return res;
  }

  // GET requests - SWR & Inflight Promise Sharing
  const cacheKey = options.cacheKey || `${method}:${port}:${path}`;
  const inflightKey = `${method}:${port}:${path}`;

  const { ttlMs: defaultTtl, memoryOnly: defaultMemoryOnly } = DSA_CacheEngine.getTtlForPath(path);
  const ttlMs = options.ttlMs !== undefined ? options.ttlMs : defaultTtl;
  const memoryOnly = options.memoryOnly !== undefined ? options.memoryOnly : defaultMemoryOnly;

  // Cache Check
  if (!options.bypassCache && !options._skipCache) {
    const cachedEntry = DSA_CacheEngine.get(cacheKey);
    if (cachedEntry) {
      const age = Date.now() - cachedEntry.timestamp;
      const isFresh = age < (cachedEntry.ttlMs || ttlMs);

      if (isFresh) {
        return createCachedResponse(cachedEntry.data, cachedEntry.status, cachedEntry.headers);
      }

      // Cache Hit + Stale (SWR)
      if (options.swr !== false) {
        triggerBackgroundRevalidate(port, path, options, cacheKey, ttlMs, memoryOnly);
        return createCachedResponse(cachedEntry.data, cachedEntry.status, cachedEntry.headers);
      }
    }
  }

  // Cache Miss or Forced Synchronous Revalidate
  if (DSA_CacheEngine._inflightRequests.has(inflightKey)) {
    return DSA_CacheEngine._inflightRequests.get(inflightKey);
  }

  const fetchPromise = (async () => {
    try {
      const res = await _internalApiFetch(port, path, options);
      if (res.ok) {
        let data;
        const contentType = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') || '' : '';
        if (contentType.includes('application/json')) {
          data = await res.json();
        } else {
          const text = await res.text();
          try { data = JSON.parse(text); } catch (_) { data = text; }
        }
        const headers = extractHeadersObj(res.headers);
        DSA_CacheEngine.set(cacheKey, data, ttlMs, res.status, headers, memoryOnly);
        return createCachedResponse(data, res.status, headers);
      }
      return res;
    } finally {
      DSA_CacheEngine._inflightRequests.delete(inflightKey);
    }
  })();

  DSA_CacheEngine._inflightRequests.set(inflightKey, fetchPromise);
  return fetchPromise;
}

/**
 * Persistent State Keeper with quota fallback and cross-tab/event sync
 */
const DSA_StateKeeper = {
  _prefix: 'dsa_state:',

  get(key, defaultValue = null) {
    if (typeof localStorage === 'undefined') return defaultValue;
    try {
      const raw = localStorage.getItem(this._prefix + key);
      if (raw === null || raw === undefined) return defaultValue;
      return JSON.parse(raw);
    } catch (_) {
      try { localStorage.removeItem(this._prefix + key); } catch (e) {}
      return defaultValue;
    }
  },

  set(key, value) {
    if (typeof localStorage === 'undefined') return false;
    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(this._prefix + key, serialized);
      this.broadcast(key, value);
      return true;
    } catch (err) {
      if (typeof DSA_CacheEngine !== 'undefined' && typeof DSA_CacheEngine.evictOldest === 'function') {
        DSA_CacheEngine.evictOldest(10);
        try {
          localStorage.setItem(this._prefix + key, JSON.stringify(value));
          this.broadcast(key, value);
          return true;
        } catch (_) {}
      }
      return false;
    }
  },

  remove(key) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(this._prefix + key);
      this.broadcast(key, null);
    } catch (_) {}
  },

  broadcast(key, value) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('dsa:state-changed', {
          detail: { key, value }
        }));
      } catch (_) {}
    }
  }
};

/**
 * Visibility-Aware Poller Helper that throttles background tabs
 */
function createVisibilityAwarePoller(callback, options = {}) {
  const activeIntervalMs = options.activeIntervalMs || 5000;
  const hiddenIntervalMs = options.hiddenIntervalMs || 60000;
  const immediateOnVisible = options.immediateOnVisible !== false;

  let timerId = null;
  let isRunning = false;
  let currentInterval = activeIntervalMs;

  async function tick() {
    if (!isRunning) return;
    try {
      await callback();
    } catch (err) {
      console.warn('[DSA Poller] Error in poll callback:', err);
    }
  }

  function scheduleNext(interval) {
    clear();
    if (!isRunning) return;
    currentInterval = interval || (isDocumentHidden() ? hiddenIntervalMs : activeIntervalMs);
    timerId = setTimeout(async () => {
      await tick();
      scheduleNext(currentInterval);
    }, currentInterval);
  }

  function clear() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function isDocumentHidden() {
    return typeof document !== 'undefined' && Boolean(document.hidden);
  }

  function handleVisibilityChange() {
    if (!isRunning) return;
    if (isDocumentHidden()) {
      scheduleNext(hiddenIntervalMs);
    } else {
      if (immediateOnVisible) {
        clear();
        tick().finally(() => {
          scheduleNext(activeIntervalMs);
        });
      } else {
        scheduleNext(activeIntervalMs);
      }
    }
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (immediateOnVisible) {
      tick().finally(() => {
        scheduleNext(isDocumentHidden() ? hiddenIntervalMs : activeIntervalMs);
      });
    } else {
      scheduleNext(isDocumentHidden() ? hiddenIntervalMs : activeIntervalMs);
    }
  }

  function stop() {
    isRunning = false;
    clear();
    if (typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  }

  function restart(newInterval) {
    stop();
    if (newInterval) {
      currentInterval = newInterval;
    }
    start();
  }

  return {
    start,
    stop,
    restart,
    tick
  };
}

// ============================================================================
// 2. MATHEMATICAL SPATIAL MODEL (Windhoek Degree Projection)
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
  return `~${mins} min${mins > 1 ? "s" : ""}`;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

async function fetchRoadRoute(origin, destination, options = {}) {
  // Normalize coordinates: detect GeoJSON [lon, lat] vs Leaflet [lat, lon]
  let lat1 = Number(origin.lat ?? origin.latitude ?? (Array.isArray(origin) ? (origin[0] < 0 ? origin[0] : origin[1]) : -22.5609));
  let lon1 = Number(origin.lon ?? origin.lng ?? origin.longitude ?? (Array.isArray(origin) ? (origin[0] > 0 ? origin[0] : origin[1]) : 17.0658));
  let lat2 = Number(destination.lat ?? destination.latitude ?? (Array.isArray(destination) ? (destination[0] < 0 ? destination[0] : destination[1]) : -22.5695));
  let lon2 = Number(destination.lon ?? destination.lng ?? destination.longitude ?? (Array.isArray(destination) ? (destination[0] > 0 ? destination[0] : destination[1]) : 17.0850));

  // Windhoek bounds guard: Latitude is negative (-22.x), Longitude is positive (+17.x)
  if (lat1 > 0 && lon1 < 0) { const temp = lat1; lat1 = lon1; lon1 = temp; }
  if (lat2 > 0 && lon2 < 0) { const temp = lat2; lat2 = lon2; lon2 = temp; }

  const routeKey = `${lat1.toFixed(4)},${lon1.toFixed(4)}_${lat2.toFixed(4)},${lon2.toFixed(4)}`;
  if (typeof DSA_CacheEngine !== 'undefined') {
    const cached = DSA_CacheEngine.get(routeKey);
    if (cached && cached.data) {
      return cached.data;
    }
  }

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 3500) : null;
    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: controller ? controller.signal : undefined });
    if (timeoutId) clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates) {
        const osrmCoords = data.routes[0].geometry.coordinates; // [[lon, lat], ...]
        const coordinates = osrmCoords.map(c => [c[1], c[0]]); // Leaflet [lat, lon]
        const waypoints = osrmCoords.map(c => ({ lat: c[1], lng: c[0] }));
        const distanceKm = Number((data.routes[0].distance / 1000).toFixed(2));
        const durationMins = Math.max(1, Math.round(data.routes[0].duration / 60));
        const routeResult = { coordinates, waypoints, distanceKm, durationMins, source: 'osrm' };
        if (typeof DSA_CacheEngine !== 'undefined') {
          DSA_CacheEngine.set(routeKey, routeResult, 7200000);
        }
        return routeResult;
      }
    }
  } catch (_) {}

  // Fallback: Realistic Windhoek arterial road corridor spline connecting origin to destination
  const tVals = [0.0, 0.08, 0.16, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.84, 0.92, 1.0];
  const roadWiggle = [
    [0.0, 0.0],
    [0.0006, 0.0008],
    [0.0014, 0.0012],
    [0.0022, 0.0019],
    [0.0018, 0.0025],
    [0.0009, 0.0021],
    [-0.0002, 0.0015],
    [-0.0008, 0.0022],
    [0.0004, 0.0028],
    [0.0015, 0.0021],
    [0.0009, 0.0011],
    [0.0, 0.0]
  ];
  const sign = lon2 >= lon1 ? 1 : -1;
  const coordinates = tVals.map((t, idx) => {
    const lat = lat1 + (lat2 - lat1) * t + roadWiggle[idx][0];
    const lon = lon1 + (lon2 - lon1) * t + roadWiggle[idx][1] * sign;
    return [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
  });
  const waypoints = coordinates.map(c => ({ lat: c[0], lng: c[1] }));
  const dist = calculateDistanceKm(lat1, lon1, lat2, lon2) * 1.25;
  const fallbackResult = {
    coordinates,
    waypoints,
    distanceKm: Number(dist.toFixed(2)),
    durationMins: Math.max(1, Math.round((dist / 30.0) * 60)),
    source: 'corridor_fallback'
  };
  if (typeof DSA_CacheEngine !== 'undefined') {
    DSA_CacheEngine.set(routeKey, fallbackResult, 7200000);
  }
  return fallbackResult;
}

// ============================================================================
// 3. FORMATTERS & DOM UTILITIES
// ============================================================================
function setText(id, text) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatMoney(amount) {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return "N$ 0.00";
  return "N$ " + Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return "0";
  return Number(n).toLocaleString();
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

function formatAddress(addr, options = {}) {
  const fallback = options.defaultText || "Windhoek Central";
  if (!addr) return fallback;

  if (typeof addr === 'string') {
    const trimmed = addr.trim();
    if (trimmed === "" || trimmed === "[object Object]") return fallback;
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        return formatAddress(JSON.parse(trimmed), options);
      } catch (_) {}
    }
    return trimmed;
  }

  if (typeof addr === 'object') {
    const street = addr.street || addr.streetAddress || addr.addressLine1 || addr.address || addr.name || "";
    const suburb = addr.suburb || addr.neighborhood || addr.area || "";
    const city = addr.city || addr.town || "Windhoek";
    const parts = [street, suburb, city].filter(p => typeof p === 'string' && p.trim().length > 0 && p.trim() !== "[object Object]");
    if (parts.length > 0) return parts.join(", ");
    if (addr.latitude || addr.lat) {
      const lat = Number(addr.latitude || addr.lat);
      const lon = Number(addr.longitude || addr.lon || addr.lng);
      if (!isNaN(lat) && !isNaN(lon)) return `Windhoek (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
    }
  }
  return fallback;
}

function formatFriendlyOrderId(id) {
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

// ============================================================================
// 2.2 NAME RESOLVERS & RIBBON POLYLINE ENGINE
// ============================================================================
const KNOWN_CUSTOMERS = {
  "CUST-001": "Amelia Shilongo",
  "CUST-002": "Daniel Amutenya",
  "CUST-003": "Maria Ndeitunga",
  "CUST-004": "Lukas Haikali",
  "CUST-005": "Selma Shikongo"
};

const KNOWN_DRIVERS = {
  "drv_001": "Tomas Nekundi",
  "drv_002": "Maria Shilongo",
  "drv_003": "Lukas Hamutenya",
  "drv_004": "Selma Amukoto",
  "drv_005": "Johannes Nuuyoma",
  "drv_006": "Ndapewa Shifotoka",
  "drv_007": "Petrus Shipanga",
  "drv_008": "Aina Shikongo"
};

const KNOWN_RESTAURANTS = {
  "R001": "Kapana Corner",
  "R002": "Joe's Beerhouse",
  "R003": "The Stellenbosch Wine Bar and Bistro",
  "R004": "Kubata Restaurant",
  "R005": "Garnish Restaurant"
};

function resolveCustomerName(idOrObj) {
  if (!idOrObj) return "Verified Customer";
  if (typeof idOrObj === "object") {
    if (idOrObj.name) return idOrObj.name;
    if (idOrObj.id && KNOWN_CUSTOMERS[idOrObj.id]) return KNOWN_CUSTOMERS[idOrObj.id];
    return "Verified Customer";
  }
  const id = String(idOrObj).trim();
  return KNOWN_CUSTOMERS[id] || "Verified Customer";
}

function resolveDriverName(idOrObj) {
  if (!idOrObj) return "Verified Courier";
  if (typeof idOrObj === "object") {
    if (idOrObj.name) return idOrObj.name;
    if (idOrObj.id && KNOWN_DRIVERS[idOrObj.id]) return KNOWN_DRIVERS[idOrObj.id];
    return "Verified Courier";
  }
  const id = String(idOrObj).trim();
  return KNOWN_DRIVERS[id] || "Verified Courier";
}

function resolveRestaurantName(idOrObj) {
  if (!idOrObj) return "Live Kitchen";
  if (typeof idOrObj === "object") {
    if (idOrObj.name) return idOrObj.name;
    if (idOrObj.id && KNOWN_RESTAURANTS[idOrObj.id]) return KNOWN_RESTAURANTS[idOrObj.id];
    return "Live Kitchen";
  }
  const id = String(idOrObj).trim();
  return KNOWN_RESTAURANTS[id] || "Live Kitchen";
}

function createRibbonPolylineGroup(latLngs, options = {}) {
  if (typeof L === "undefined" || !latLngs || latLngs.length === 0) return null;
  const casingColor = options.casingColor || "#ffffff";
  const casingWeight = options.casingWeight || 8;
  const casingOpacity = options.casingOpacity ?? 0.95;
  const coreColor = options.coreColor || "#eb4d28";
  const coreWeight = options.coreWeight || 4.5;
  const coreOpacity = options.coreOpacity ?? 1.0;

  const casing = L.polyline(latLngs, {
    color: casingColor,
    weight: casingWeight,
    opacity: casingOpacity,
    lineCap: "round",
    lineJoin: "round"
  });

  const core = L.polyline(latLngs, {
    color: coreColor,
    weight: coreWeight,
    opacity: coreOpacity,
    lineCap: "round",
    lineJoin: "round"
  });

  return L.layerGroup([casing, core]);
}

// Modal Helpers
function openModal(modalId) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(modalId);
  if (el) el.style.display = "flex";
}

function closeModal(modalId) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(modalId);
  if (el) el.style.display = "none";
}

// Generic Tab Switcher
function setupTabNavigation(navContainerSelector, activeClass = "active") {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`${navContainerSelector} .nav-tab-btn`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");
      if (!targetId) return;

      // Update nav buttons
      document.querySelectorAll(`${navContainerSelector} .nav-tab-btn`).forEach((b) => b.classList.remove(activeClass));
      btn.classList.add(activeClass);

      // Update view panels
      document.querySelectorAll(".view-section").forEach((panel) => panel.classList.remove(activeClass));
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add(activeClass);
    });
  });
}

/**
 * Smart Positioning for floating popups (menus, datetime cards).
 * Automatically flips UP when space below is constrained.
 * Automatically aligns RIGHT when space to the right is constrained.
 * Clamps width and height to fit comfortably inside the container/viewport.
 */
function positionFloatingPopup(wrapper, popupEl, options = {}) {
  const isMenu = options.isMenu || false;
  const isCard = options.isCard || false;
  const defaultHeight = options.defaultHeight || (isCard ? 310 : 220);
  const minHeight = 110;

  // Find enclosing container (modal, drawer, or viewport)
  const container = wrapper.closest('.modal-card, .modal-dialog, .cart-drawer, .drawer-body, .cart-items-scroll') || null;
  const triggerRect = wrapper.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  // Vertical space calculation
  let spaceBelow = viewportHeight - triggerRect.bottom - 16;
  let spaceAbove = triggerRect.top - 16;

  if (container) {
    const cRect = container.getBoundingClientRect();
    const cSpaceBelow = cRect.bottom - triggerRect.bottom - 16;
    const cSpaceAbove = triggerRect.top - cRect.top - 16;
    spaceBelow = Math.min(spaceBelow, cSpaceBelow);
    spaceAbove = Math.min(spaceAbove, cSpaceAbove);
  }

  // Determine if it should flip UP
  const shouldFlipUp = (spaceBelow < defaultHeight) && (spaceAbove > spaceBelow);

  if (shouldFlipUp) {
    wrapper.classList.add('open-up');
    popupEl.style.top = 'auto';
    popupEl.style.bottom = isCard ? 'calc(100% + 6px)' : 'calc(100% + 4px)';
    const maxH = Math.max(minHeight, Math.min(defaultHeight, spaceAbove));
    popupEl.style.maxHeight = `${Math.floor(maxH)}px`;
  } else {
    wrapper.classList.remove('open-up');
    popupEl.style.bottom = 'auto';
    popupEl.style.top = isCard ? 'calc(100% + 6px)' : 'calc(100% + 4px)';
    const maxH = Math.max(minHeight, Math.min(defaultHeight, spaceBelow));
    popupEl.style.maxHeight = `${Math.floor(maxH)}px`;
  }

  // Horizontal space & container boundary calculation
  const containerRight = container ? container.getBoundingClientRect().right - 12 : viewportWidth - 12;
  const maxAvailableWidth = container ? Math.min(container.clientWidth - 24, viewportWidth - 24) : viewportWidth - 24;

  popupEl.style.maxWidth = `${Math.floor(Math.max(160, maxAvailableWidth))}px`;

  // For datetime card: width is ~290px; for menu: width is at least trigger width
  const targetWidth = isCard ? 290 : Math.max(triggerRect.width, popupEl.scrollWidth || 0);

  if (triggerRect.left + targetWidth > containerRight) {
    popupEl.style.left = 'auto';
    popupEl.style.right = '0';
  } else {
    popupEl.style.left = '0';
    popupEl.style.right = 'auto';
  }
}

/**
 * Universal Custom Dropdown Menu Initializer
 * Replaces native OS dropdown popups with a modern, custom-styled floating menu.
 */
function initCustomDropdownMenus(root = document) {
  if (typeof document === 'undefined') return;
  const selects = root.querySelectorAll('select:not([data-custom-dropdown-init="true"])');
  selects.forEach(select => {
    // If the select is already inside a custom-dropdown-root, mark and skip
    if (select.closest('.custom-dropdown-root')) {
      select.setAttribute('data-custom-dropdown-init', 'true');
      return;
    }
    select.setAttribute('data-custom-dropdown-init', 'true');

    // Completely remove any redundant sibling chevron icon in parent wrapper
    if (select.parentElement) {
      select.parentElement.querySelectorAll('.select-chevron-icon, .select-arrow').forEach(icon => {
        icon.remove();
      });
    }

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-dropdown-root' + (select.classList.contains('select-sm') ? ' select-sm' : '');
    if (select.id) wrapper.setAttribute('data-target-select', select.id);
    
    // Hide native select visually but keep it accessible for forms and event listeners
    select.classList.add('custom-select-hidden');
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);

    // Create trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-dropdown-trigger';
    
    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'custom-dropdown-label';
    const activeOpt = select.options[select.selectedIndex];
    triggerLabel.textContent = activeOpt ? activeOpt.text : (select.getAttribute('placeholder') || 'Select option...');

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'custom-dropdown-arrow');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

    trigger.appendChild(triggerLabel);
    trigger.appendChild(chevron);
    wrapper.appendChild(trigger);

    // Create floating menu
    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';
    menu.setAttribute('role', 'listbox');

    function updateSingleOptionState() {
      const isSingle = select.options.length <= 1;
      wrapper.classList.toggle('single-option', isSingle);
      chevron.style.display = isSingle ? 'none' : '';
    }

    // Rebuild Menu items
    function rebuildMenu() {
      menu.innerHTML = '';
      updateSingleOptionState();

      if (select.options.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'custom-dropdown-item disabled';
        emptyItem.textContent = 'No options available';
        menu.appendChild(emptyItem);
        return;
      }

      Array.from(select.options).forEach((opt, idx) => {
        const item = document.createElement('div');
        item.className = 'custom-dropdown-item' + (idx === select.selectedIndex ? ' selected' : '') + (opt.disabled ? ' disabled' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', opt.value);
        
        const itemText = document.createElement('span');
        itemText.className = 'item-text';
        itemText.textContent = opt.text;
        item.appendChild(itemText);

        if (idx === select.selectedIndex) {
          const checkIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          checkIcon.setAttribute('class', 'item-check');
          checkIcon.setAttribute('viewBox', '0 0 24 24');
          checkIcon.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
          item.appendChild(checkIcon);
        }

        if (!opt.disabled) {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            select.selectedIndex = idx;
            select.value = opt.value;
            triggerLabel.textContent = opt.text;
            closeAllDropdowns();
            rebuildMenu();
            select.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
        menu.appendChild(item);
      });
    }

    rebuildMenu();
    wrapper.appendChild(menu);

    // Toggle open/close with smart positioning
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      // If only 1 or 0 options, do not open dropdown menu
      if (select.options.length <= 1) {
        return;
      }
      const isOpen = wrapper.classList.contains('open');
      closeAllDropdowns();
      closeAllDatePickers();
      if (!isOpen) {
        rebuildMenu();
        wrapper.classList.add('open');
        positionFloatingPopup(wrapper, menu, { isMenu: true, defaultHeight: 220 });
      }
    });

    // Listen to native change event in case code changes it programmatically
    select.addEventListener('change', () => {
      const curOpt = select.options[select.selectedIndex];
      if (curOpt) {
        triggerLabel.textContent = curOpt.text;
      }
      rebuildMenu();
    });

    // Mutation observer on select to detect options added/removed dynamically
    const observer = new MutationObserver(() => {
      const curOpt = select.options[select.selectedIndex];
      if (curOpt) triggerLabel.textContent = curOpt.text;
      rebuildMenu();
    });
    observer.observe(select, { childList: true, subtree: true });
  });
}

function closeAllDropdowns() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.custom-dropdown-root.open').forEach(el => {
    el.classList.remove('open', 'open-up');
  });
}

function closeAllDatePickers() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.custom-datetime-root.open').forEach(el => {
    el.classList.remove('open', 'open-up');
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown-root')) {
      closeAllDropdowns();
    }
    if (!e.target.closest('.custom-datetime-root')) {
      closeAllDatePickers();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
      closeAllDatePickers();
    }
  });

  window.addEventListener('resize', () => {
    closeAllDropdowns();
    closeAllDatePickers();
  });

  document.addEventListener('scroll', (e) => {
    const activePopup = document.querySelector('.custom-dropdown-root.open .custom-dropdown-menu, .custom-datetime-root.open .custom-datetime-card');
    if (activePopup && !activePopup.contains(e.target)) {
      closeAllDropdowns();
      closeAllDatePickers();
    }
  }, true);

  // Close modals on backdrop click to ensure no click-blocking overlay ever lingers
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
      e.target.style.display = 'none';
      e.target.classList.remove('open');
      e.target.classList.remove('active');
    }
  });

  // Auto initialize on DOM ready and observe dynamically added selects & date/time inputs
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initCustomDropdownMenus();
      initCustomDateTimePickers();
    });
  } else {
    setTimeout(() => {
      initCustomDropdownMenus();
      initCustomDateTimePickers();
    }, 50);
  }

  // Periodic scan to catch selects and date pickers added asynchronously by app templates
  setInterval(() => {
    initCustomDropdownMenus();
    initCustomDateTimePickers();
    document.querySelectorAll('.custom-dropdown-root').forEach(wrap => {
      const sel = wrap.querySelector('select');
      const lbl = wrap.querySelector('.custom-dropdown-label');
      const arr = wrap.querySelector('.custom-dropdown-arrow');
      if (sel) {
        const isSingle = sel.options.length <= 1;
        wrap.classList.toggle('single-option', isSingle);
        if (arr) arr.style.display = isSingle ? 'none' : '';
        if (lbl && sel.options[sel.selectedIndex]) {
          const expected = sel.options[sel.selectedIndex].text;
          if (lbl.textContent !== expected) {
            lbl.textContent = expected;
          }
        }
      }
    });
    document.querySelectorAll('.custom-datetime-root').forEach(wrap => {
      const inp = wrap.querySelector('input');
      const lbl = wrap.querySelector('.custom-datetime-label');
      if (inp && lbl && typeof inp._customFormatDisplay === 'function') {
        const expected = inp._customFormatDisplay(inp.value);
        if (lbl.textContent !== expected) {
          lbl.textContent = expected;
          if (!inp.value) lbl.classList.add('placeholder');
          else lbl.classList.remove('placeholder');
        }
      }
    });
  }, 500);
}

/**
 * Bespoke Custom Date & Time Picker Initializer
 * Replaces native OS date/time popups with an elegant floating calendar & time selector.
 * Supports:
 * - input[type="date"]
 * - input[type="datetime-local"]
 * - input[type="time"]
 * Includes month navigation, day grid, hour/minute steppers, and preset buttons.
 * Guarantees zero invisible click-blocking overlays.
 */
function initCustomDateTimePickers(root = document) {
  if (typeof document === 'undefined') return;
  const inputs = root.querySelectorAll('input[type="date"]:not([data-custom-datetime-init="true"]), input[type="time"]:not([data-custom-datetime-init="true"]), input[type="datetime-local"]:not([data-custom-datetime-init="true"])');

  inputs.forEach(input => {
    if (input.closest('.custom-datetime-root')) {
      input.setAttribute('data-custom-datetime-init', 'true');
      return;
    }
    input.setAttribute('data-custom-datetime-init', 'true');

    const isTime = input.type === 'time';
    const isDateTime = input.type === 'datetime-local';
    const isDate = input.type === 'date' || isDateTime;

    // Create wrapper - only preserve sizing/modifier classes, NOT form control styles like form-input
    const modifierClasses = (input.className || '')
      .split(/\s+/)
      .filter((c) => c && !['form-input', 'input-text', 'form-control', 'form-select'].includes(c))
      .join(' ');
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-datetime-root' + (modifierClasses ? ' ' + modifierClasses : '') + (input.classList.contains('select-sm') ? ' select-sm' : '');
    if (input.id) wrapper.setAttribute('data-target-input', input.id);

    // Hide native input visually but keep accessible
    input.classList.add('custom-input-hidden');
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    // Trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-datetime-trigger';

    const triggerLeft = document.createElement('div');
    triggerLeft.className = 'custom-datetime-trigger-left';

    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('class', 'custom-datetime-icon');
    iconSvg.setAttribute('viewBox', '0 0 24 24');
    if (isTime) {
      iconSvg.innerHTML = '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>';
    } else {
      iconSvg.innerHTML = '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>';
    }

    const label = document.createElement('span');
    label.className = 'custom-datetime-label';

    function formatDisplay(val) {
      if (!val) {
        if (input.placeholder) return input.placeholder;
        if (isDateTime) return 'Select date & time...';
        if (isTime) return 'Select time...';
        return 'Select date...';
      }
      if (isTime) {
        return val;
      }
      if (isDateTime) {
        try {
          const [dPart, tPart] = val.split('T');
          if (dPart) {
            const parts = dPart.split('-');
            if (parts.length === 3) {
              const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
              const dateFmt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
              return tPart ? `${dateFmt}, ${tPart}` : dateFmt;
            }
          }
        } catch (_) {}
        return val;
      }
      // isDate
      try {
        const parts = val.split('-');
        if (parts.length === 3) {
          const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        }
      } catch (_) {}
      return val;
    }

    // Attach formatter to input for periodic sync
    input._customFormatDisplay = formatDisplay;

    function updateLabel() {
      const display = formatDisplay(input.value);
      label.textContent = display;
      if (!input.value) label.classList.add('placeholder');
      else label.classList.remove('placeholder');
    }

    updateLabel();

    triggerLeft.appendChild(iconSvg);
    triggerLeft.appendChild(label);
    trigger.appendChild(triggerLeft);

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'custom-dropdown-arrow');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
    trigger.appendChild(chevron);
    wrapper.appendChild(trigger);

    // Floating card
    const card = document.createElement('div');
    card.className = 'custom-datetime-card';

    // State
    const now = new Date();
    let selectedYear = null;
    let selectedMonth = null;
    let selectedDay = null;
    let selectedHour = 12;
    let selectedMinute = 0;
    let viewingYear = now.getFullYear();
    let viewingMonth = now.getMonth();

    function syncStateFromInput() {
      const val = input.value || '';
      if (!val) {
        selectedYear = null;
        selectedMonth = null;
        selectedDay = null;
        selectedHour = 12;
        selectedMinute = 0;
        viewingYear = now.getFullYear();
        viewingMonth = now.getMonth();
        return;
      }

      if (isTime) {
        const parts = val.split(':');
        selectedHour = Math.max(0, Math.min(23, Number(parts[0]) || 0));
        selectedMinute = Math.max(0, Math.min(59, Number(parts[1]) || 0));
      } else if (isDateTime) {
        const [dPart, tPart] = val.split('T');
        if (dPart) {
          const dParts = dPart.split('-');
          if (dParts.length === 3) {
            selectedYear = Number(dParts[0]);
            selectedMonth = Number(dParts[1]) - 1;
            selectedDay = Number(dParts[2]);
            viewingYear = selectedYear;
            viewingMonth = selectedMonth;
          }
        }
        if (tPart) {
          const tParts = tPart.split(':');
          selectedHour = Math.max(0, Math.min(23, Number(tParts[0]) || 0));
          selectedMinute = Math.max(0, Math.min(59, Number(tParts[1]) || 0));
        }
      } else if (isDate) {
        const dParts = val.split('-');
        if (dParts.length === 3) {
          selectedYear = Number(dParts[0]);
          selectedMonth = Number(dParts[1]) - 1;
          selectedDay = Number(dParts[2]);
          viewingYear = selectedYear;
          viewingMonth = selectedMonth;
        }
      }
    }

    function commitValue(newVal) {
      input.value = newVal;
      updateLabel();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function renderCard() {
      card.innerHTML = '';

      // Calendar Section
      if (isDate) {
        const header = document.createElement('div');
        header.className = 'calendar-header';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'calendar-nav-btn';
        prevBtn.setAttribute('aria-label', 'Previous Month');
        prevBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        prevBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          viewingMonth--;
          if (viewingMonth < 0) {
            viewingMonth = 11;
            viewingYear--;
          }
          renderCard();
        });

        const monthTitle = document.createElement('span');
        monthTitle.className = 'calendar-month-title';
        const dRef = new Date(viewingYear, viewingMonth, 1);
        monthTitle.textContent = dRef.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'calendar-nav-btn';
        nextBtn.setAttribute('aria-label', 'Next Month');
        nextBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        nextBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          viewingMonth++;
          if (viewingMonth > 11) {
            viewingMonth = 0;
            viewingYear++;
          }
          renderCard();
        });

        header.appendChild(prevBtn);
        header.appendChild(monthTitle);
        header.appendChild(nextBtn);
        card.appendChild(header);

        // Weekday names
        const weekdays = document.createElement('div');
        weekdays.className = 'calendar-weekdays';
        ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(w => {
          const wd = document.createElement('div');
          wd.textContent = w;
          weekdays.appendChild(wd);
        });
        card.appendChild(weekdays);

        // Days grid
        const grid = document.createElement('div');
        grid.className = 'calendar-days-grid';

        const firstDayIndex = new Date(viewingYear, viewingMonth, 1).getDay();
        const totalDays = new Date(viewingYear, viewingMonth + 1, 0).getDate();

        // Padding before first day
        for (let i = 0; i < firstDayIndex; i++) {
          const emptyCell = document.createElement('div');
          emptyCell.className = 'calendar-day empty';
          grid.appendChild(emptyCell);
        }

        const todayObj = new Date();
        const todayY = todayObj.getFullYear();
        const todayM = todayObj.getMonth();
        const todayD = todayObj.getDate();

        for (let day = 1; day <= totalDays; day++) {
          const dayCell = document.createElement('div');
          dayCell.className = 'calendar-day';
          dayCell.textContent = day;

          if (viewingYear === todayY && viewingMonth === todayM && day === todayD) {
            dayCell.classList.add('today');
          }
          if (viewingYear === selectedYear && viewingMonth === selectedMonth && day === selectedDay) {
            dayCell.classList.add('selected');
          }

          dayCell.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedYear = viewingYear;
            selectedMonth = viewingMonth;
            selectedDay = day;

            const yStr = String(selectedYear).padStart(4, '0');
            const mStr = String(selectedMonth + 1).padStart(2, '0');
            const dStr = String(selectedDay).padStart(2, '0');

            if (isDateTime) {
              const hStr = String(selectedHour).padStart(2, '0');
              const minStr = String(selectedMinute).padStart(2, '0');
              commitValue(`${yStr}-${mStr}-${dStr}T${hStr}:${minStr}`);
              renderCard();
            } else {
              commitValue(`${yStr}-${mStr}-${dStr}`);
              closeAllDatePickers();
            }
          });

          grid.appendChild(dayCell);
        }
        card.appendChild(grid);
      }

      // Time Section with Steppers
      if (isTime || isDateTime) {
        const timeSec = document.createElement('div');
        timeSec.className = 'custom-time-section';

        const timeLbl = document.createElement('span');
        timeLbl.className = 'custom-time-label';
        timeLbl.textContent = 'Time (24h)';

        const steppersWrap = document.createElement('div');
        steppersWrap.className = 'custom-time-steppers-wrap';

        function applyTimeChange() {
          const hStr = String(selectedHour).padStart(2, '0');
          const minStr = String(selectedMinute).padStart(2, '0');
          if (isTime) {
            commitValue(`${hStr}:${minStr}`);
          } else if (isDateTime) {
            if (selectedYear === null) {
              const dNow = new Date();
              selectedYear = dNow.getFullYear();
              selectedMonth = dNow.getMonth();
              selectedDay = dNow.getDate();
            }
            const yStr = String(selectedYear).padStart(4, '0');
            const mStr = String(selectedMonth + 1).padStart(2, '0');
            const dStr = String(selectedDay).padStart(2, '0');
            commitValue(`${yStr}-${mStr}-${dStr}T${hStr}:${minStr}`);
            renderCard();
          }
        }

        // Hour Stepper
        const hrStepper = document.createElement('div');
        hrStepper.className = 'custom-stepper-unit';

        const hrUpBtn = document.createElement('button');
        hrUpBtn.type = 'button';
        hrUpBtn.className = 'stepper-btn';
        hrUpBtn.setAttribute('aria-label', 'Increment Hour');
        hrUpBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"></polyline></svg>';
        hrUpBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedHour = (selectedHour + 1) % 24;
          applyTimeChange();
          hrInput.value = String(selectedHour).padStart(2, '0');
        });

        const hrInput = document.createElement('input');
        hrInput.type = 'text';
        hrInput.inputMode = 'numeric';
        hrInput.pattern = '[0-9]*';
        hrInput.maxLength = 2;
        hrInput.className = 'custom-time-input-box';
        hrInput.value = String(selectedHour).padStart(2, '0');
        hrInput.addEventListener('click', (e) => e.stopPropagation());
        hrInput.addEventListener('input', () => {
          let clean = hrInput.value.replace(/\D/g, '');
          if (clean.length > 2) clean = clean.slice(0, 2);
          hrInput.value = clean;
          let v = parseInt(clean, 10);
          if (!isNaN(v)) {
            selectedHour = Math.max(0, Math.min(23, v));
            applyTimeChange();
          }
        });
        hrInput.addEventListener('blur', () => {
          let v = parseInt(hrInput.value, 10);
          if (isNaN(v)) v = 0;
          selectedHour = Math.max(0, Math.min(23, v));
          hrInput.value = String(selectedHour).padStart(2, '0');
          applyTimeChange();
        });

        const hrDownBtn = document.createElement('button');
        hrDownBtn.type = 'button';
        hrDownBtn.className = 'stepper-btn';
        hrDownBtn.setAttribute('aria-label', 'Decrement Hour');
        hrDownBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        hrDownBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedHour = (selectedHour - 1 + 24) % 24;
          applyTimeChange();
          hrInput.value = String(selectedHour).padStart(2, '0');
        });

        hrStepper.appendChild(hrUpBtn);
        hrStepper.appendChild(hrInput);
        hrStepper.appendChild(hrDownBtn);

        // Colon
        const colon = document.createElement('span');
        colon.className = 'custom-time-colon';
        colon.textContent = ':';

        // Minute Stepper
        const minStepper = document.createElement('div');
        minStepper.className = 'custom-stepper-unit';

        const minUpBtn = document.createElement('button');
        minUpBtn.type = 'button';
        minUpBtn.className = 'stepper-btn';
        minUpBtn.setAttribute('aria-label', 'Increment Minute');
        minUpBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"></polyline></svg>';
        minUpBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedMinute = (selectedMinute + 5) % 60;
          applyTimeChange();
          minInput.value = String(selectedMinute).padStart(2, '0');
        });

        const minInput = document.createElement('input');
        minInput.type = 'text';
        minInput.inputMode = 'numeric';
        minInput.pattern = '[0-9]*';
        minInput.maxLength = 2;
        minInput.className = 'custom-time-input-box';
        minInput.value = String(selectedMinute).padStart(2, '0');
        minInput.addEventListener('click', (e) => e.stopPropagation());
        minInput.addEventListener('input', () => {
          let clean = minInput.value.replace(/\D/g, '');
          if (clean.length > 2) clean = clean.slice(0, 2);
          minInput.value = clean;
          let v = parseInt(clean, 10);
          if (!isNaN(v)) {
            selectedMinute = Math.max(0, Math.min(59, v));
            applyTimeChange();
          }
        });
        minInput.addEventListener('blur', () => {
          let v = parseInt(minInput.value, 10);
          if (isNaN(v)) v = 0;
          selectedMinute = Math.max(0, Math.min(59, v));
          minInput.value = String(selectedMinute).padStart(2, '0');
          applyTimeChange();
        });

        const minDownBtn = document.createElement('button');
        minDownBtn.type = 'button';
        minDownBtn.className = 'stepper-btn';
        minDownBtn.setAttribute('aria-label', 'Decrement Minute');
        minDownBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        minDownBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedMinute = (selectedMinute - 5 + 60) % 60;
          applyTimeChange();
          minInput.value = String(selectedMinute).padStart(2, '0');
        });

        minStepper.appendChild(minUpBtn);
        minStepper.appendChild(minInput);
        minStepper.appendChild(minDownBtn);

        steppersWrap.appendChild(hrStepper);
        steppersWrap.appendChild(colon);
        steppersWrap.appendChild(minStepper);

        timeSec.appendChild(timeLbl);
        timeSec.appendChild(steppersWrap);
        card.appendChild(timeSec);
      }

      // Presets Bar
      const presets = document.createElement('div');
      presets.className = 'custom-picker-presets';

      const presetLeft = document.createElement('div');
      presetLeft.className = 'picker-preset-group';

      if (isDate && !isDateTime) {
        const todayBtn = document.createElement('button');
        todayBtn.type = 'button';
        todayBtn.className = 'picker-preset-btn';
        todayBtn.textContent = 'Today';
        todayBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          const yStr = String(d.getFullYear()).padStart(4, '0');
          const mStr = String(d.getMonth() + 1).padStart(2, '0');
          const dStr = String(d.getDate()).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}`);
          closeAllDatePickers();
        });
        presetLeft.appendChild(todayBtn);

        const tomorrowBtn = document.createElement('button');
        tomorrowBtn.type = 'button';
        tomorrowBtn.className = 'picker-preset-btn';
        tomorrowBtn.textContent = 'Tomorrow';
        tomorrowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          d.setDate(d.getDate() + 1);
          const yStr = String(d.getFullYear()).padStart(4, '0');
          const mStr = String(d.getMonth() + 1).padStart(2, '0');
          const dStr = String(d.getDate()).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}`);
          closeAllDatePickers();
        });
        presetLeft.appendChild(tomorrowBtn);

        const yestBtn = document.createElement('button');
        yestBtn.type = 'button';
        yestBtn.className = 'picker-preset-btn';
        yestBtn.textContent = 'Yesterday';
        yestBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          d.setDate(d.getDate() - 1);
          const yStr = String(d.getFullYear()).padStart(4, '0');
          const mStr = String(d.getMonth() + 1).padStart(2, '0');
          const dStr = String(d.getDate()).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}`);
          closeAllDatePickers();
        });
        presetLeft.appendChild(yestBtn);
      } else if (isDateTime) {
        const nowBtn = document.createElement('button');
        nowBtn.type = 'button';
        nowBtn.className = 'picker-preset-btn';
        nowBtn.textContent = 'Now';
        nowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          selectedYear = d.getFullYear();
          selectedMonth = d.getMonth();
          selectedDay = d.getDate();
          selectedHour = d.getHours();
          selectedMinute = d.getMinutes();
          const yStr = String(selectedYear).padStart(4, '0');
          const mStr = String(selectedMonth + 1).padStart(2, '0');
          const dStr = String(selectedDay).padStart(2, '0');
          const hStr = String(selectedHour).padStart(2, '0');
          const minStr = String(selectedMinute).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}T${hStr}:${minStr}`);
          renderCard();
        });
        presetLeft.appendChild(nowBtn);

        const todayBtn = document.createElement('button');
        todayBtn.type = 'button';
        todayBtn.className = 'picker-preset-btn';
        todayBtn.textContent = 'Today';
        todayBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          selectedYear = d.getFullYear();
          selectedMonth = d.getMonth();
          selectedDay = d.getDate();
          const yStr = String(selectedYear).padStart(4, '0');
          const mStr = String(selectedMonth + 1).padStart(2, '0');
          const dStr = String(selectedDay).padStart(2, '0');
          const hStr = String(selectedHour).padStart(2, '0');
          const minStr = String(selectedMinute).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}T${hStr}:${minStr}`);
          renderCard();
        });
        presetLeft.appendChild(todayBtn);
      } else if (isTime) {
        const nowBtn = document.createElement('button');
        nowBtn.type = 'button';
        nowBtn.className = 'picker-preset-btn';
        nowBtn.textContent = 'Now';
        nowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          selectedHour = d.getHours();
          selectedMinute = d.getMinutes();
          const hStr = String(selectedHour).padStart(2, '0');
          const minStr = String(selectedMinute).padStart(2, '0');
          commitValue(`${hStr}:${minStr}`);
          renderCard();
        });
        presetLeft.appendChild(nowBtn);

        const noonBtn = document.createElement('button');
        noonBtn.type = 'button';
        noonBtn.className = 'picker-preset-btn';
        noonBtn.textContent = '12:00';
        noonBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedHour = 12;
          selectedMinute = 0;
          commitValue('12:00');
          renderCard();
        });
        presetLeft.appendChild(noonBtn);

        const eveBtn = document.createElement('button');
        eveBtn.type = 'button';
        eveBtn.className = 'picker-preset-btn';
        eveBtn.textContent = '18:00';
        eveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedHour = 18;
          selectedMinute = 0;
          commitValue('18:00');
          renderCard();
        });
        presetLeft.appendChild(eveBtn);
      }

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'picker-preset-btn';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedYear = null;
        selectedMonth = null;
        selectedDay = null;
        commitValue('');
        closeAllDatePickers();
      });
      presetLeft.appendChild(clearBtn);

      presets.appendChild(presetLeft);

      if (isTime || isDateTime) {
        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'picker-preset-btn btn-confirm';
        doneBtn.textContent = 'Apply';
        doneBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeAllDatePickers();
        });
        presets.appendChild(doneBtn);
      }

      card.appendChild(presets);
    }

    syncStateFromInput();
    renderCard();
    wrapper.appendChild(card);

    // Toggle open with smart positioning
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrapper.classList.contains('open');
      closeAllDatePickers();
      closeAllDropdowns();
      if (!isOpen) {
        syncStateFromInput();
        renderCard();
        wrapper.classList.add('open');
        positionFloatingPopup(wrapper, card, { isCard: true, defaultHeight: isDate ? 320 : 250 });
      }
    });

    // Native input listeners
    input.addEventListener('change', () => {
      syncStateFromInput();
      updateLabel();
      renderCard();
    });
    input.addEventListener('input', () => {
      syncStateFromInput();
      updateLabel();
      renderCard();
    });
  });
}

function closeAllDatePickers() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.custom-datetime-root.open').forEach(el => el.classList.remove('open'));
}

// ============================================================================
// 4. GOOGLE MAPS PLATFORM INTEGRATION & COORDINATES
// Adhering to Google Maps Platform Best Practices:
// - Explicit container height (CF2)
// - AdvancedMarkerElement with mapId: 'DEMO_MAP_ID' (CF7, CF9)
// - POJO {lat, lng} literals (CF6)
// - Attribution: gmp_git_agentskills_v1
// ============================================================================

let _resolvedMapApiKey = null;

const GOOGLE_MAPS_CONFIG = {
  mapId: "DEMO_MAP_ID",
  attributionTag: "gmp_git_agentskills_v1",
  coordinates: {
    windhoekCentral: { lat: -22.5609, lng: 17.0658 },
    restaurantLocation: { lat: -22.5609, lng: 17.0658 },
    customerDelivery: { lat: -22.5695, lng: 17.0850 },
    courierLocation: { lat: -22.5700, lng: 17.0800 }
  }
};

let _gmpLoaderPromise = null;

async function resolveMapApiKey() {
  if (_resolvedMapApiKey) return _resolvedMapApiKey;
  if (typeof window !== 'undefined' && window.MAP_API_KEY) {
    _resolvedMapApiKey = window.MAP_API_KEY;
    return _resolvedMapApiKey;
  }
  if (typeof window !== 'undefined') {
    const local = localStorage.getItem('map_api_key') || localStorage.getItem('google_maps_api_key');
    if (local) {
      _resolvedMapApiKey = local;
      return _resolvedMapApiKey;
    }
  }
  const isBrowser = typeof window !== 'undefined' && window.location;
  const isFileOrigin = isBrowser && (
    window.location.protocol === 'file:' ||
    !window.location.hostname ||
    window.location.origin === 'null' ||
    (window.location.origin && window.location.origin.startsWith('file:'))
  );
  const endpoints = isFileOrigin
    ? ['http://localhost:8080/api/config', 'http://127.0.0.1:8080/api/config']
    : ['/api/config', 'http://localhost:8080/api/config', 'http://127.0.0.1:8080/api/config'];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep);
      if (res.ok) {
        const data = await res.json();
        const key = data.mapApiKey || data.MAP_API_KEY || '';
        if (key) {
          _resolvedMapApiKey = key;
          if (typeof window !== 'undefined') window.MAP_API_KEY = key;
          return _resolvedMapApiKey;
        }
      }
    } catch (_) {}
  }
  if (typeof process !== 'undefined' && process.env && process.env.MAP_API_KEY) {
    _resolvedMapApiKey = process.env.MAP_API_KEY;
    return _resolvedMapApiKey;
  }
  return _resolvedMapApiKey || '';
}

function getMapApiKeySync() {
  if (_resolvedMapApiKey) return _resolvedMapApiKey;
  if (typeof window !== 'undefined') {
    return window.MAP_API_KEY || localStorage.getItem('map_api_key') || localStorage.getItem('google_maps_api_key') || '';
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env.MAP_API_KEY || '';
  }
  return '';
}

function getCartoTileUrl(style = 'voyager', apiKey = '') {
  const key = apiKey || getMapApiKeySync();
  if (key) {
    return `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`;
  }
  // Esri World Street Map keyless, block-free, watermark-free fallback
  return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
}

function getWatermarkFreeTileUrl() {
  return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
}

function getEsriTileUrl() {
  return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
}

function getMapTileConfig(provider = 'auto', apiKey = '') {
  const key = apiKey || getMapApiKeySync();
  if (provider === 'carto' && key) {
    return {
      url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`,
      options: {
        subdomains: 'abcd',
        maxZoom: 20,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }
    };
  }
  // Default to Esri World Street Map for keyless reliability (no 403 blocks, no watermarks)
  return {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, USGS, METI'
    },
    fallbackUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  };
}

/**
 * Modern Google Maps API Dynamic Script Loader with @googlemaps/js-api-loader fallback pattern.
 * Resolves libraries { Map, AdvancedMarkerElement, PinElement } using importLibrary.
 */
function loadGoogleMapsLibraries(customKey = "") {
  if (typeof window === "undefined") return Promise.reject(new Error("No window context"));
  
  if (_gmpLoaderPromise) return _gmpLoaderPromise;

  _gmpLoaderPromise = new Promise((resolve, reject) => {
    // If already initialized with importLibrary
    if (window.google?.maps?.importLibrary) {
      return Promise.all([
        window.google.maps.importLibrary("maps"),
        window.google.maps.importLibrary("marker")
      ]).then(([mapsLib, markerLib]) => {
        resolve({
          Map: mapsLib.Map,
          AdvancedMarkerElement: markerLib.AdvancedMarkerElement,
          PinElement: markerLib.PinElement
        });
      }).catch(reject);
    }

    const key = customKey || window.GOOGLE_MAPS_API_KEY || window.MAP_API_KEY || getMapApiKeySync() || localStorage.getItem("google_maps_api_key") || "";

    // Bootstrap dynamic script loader
    const script = document.createElement("script");
    script.id = "gmp-script-loader";
    const params = new URLSearchParams({
      v: "weekly",
      loading: "async"
    });
    if (key) {
      params.set("key", key);
    }
    // Usage attribution tracking
    params.set("client", GOOGLE_MAPS_CONFIG.attributionTag);

    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;

    // Timeout after 6 seconds to trigger offline fallback smoothly
    const timeoutId = setTimeout(() => {
      reject(new Error("Google Maps load timeout. Reverting to offline Windhoek vector map."));
    }, 6000);

    script.onload = () => {
      clearTimeout(timeoutId);
      if (window.google?.maps?.importLibrary) {
        Promise.all([
          window.google.maps.importLibrary("maps"),
          window.google.maps.importLibrary("marker")
        ]).then(([mapsLib, markerLib]) => {
          resolve({
            Map: mapsLib.Map,
            AdvancedMarkerElement: markerLib.AdvancedMarkerElement,
            PinElement: markerLib.PinElement
          });
        }).catch(reject);
      } else {
        reject(new Error("Google Maps loaded without importLibrary support"));
      }
    };

    script.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error("Google Maps network request failed. Reverting to offline Windhoek vector map."));
    };

    document.head.appendChild(script);
  });

  return _gmpLoaderPromise;
}

/**
 * Creates custom styled HTML pin elements for AdvancedMarkerElement
 */
function createCustomMarkerElement({ type, title, subtitle }) {
  const wrapper = document.createElement("div");
  wrapper.className = `gmp-advanced-pin-marker gmp-pin-${type}`;

  let iconSvg = "";
  if (type === "driver") {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 17h10l3-6H8l-1 3H4"/></svg>`;
  } else if (type === "restaurant") {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;
  } else {
    // customer destination
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  }

  wrapper.innerHTML = `
    <div class="gmp-pin-badge">
      <div class="gmp-pin-icon-wrap">${iconSvg}</div>
      <div class="gmp-pin-text">
        <strong class="gmp-pin-title">${escapeHtml(title)}</strong>
        ${subtitle ? `<span class="gmp-pin-subtitle">${escapeHtml(subtitle)}</span>` : ""}
      </div>
    </div>
    <div class="gmp-pin-arrow"></div>
  `;
  return wrapper;
}

// ============================================================================
// 5. AUTHENTICATION, PASSWORD VALIDATION & SECURITY UTILITIES
// ============================================================================

function validatePassword(password, confirmPassword = null) {
  const p = String(password || "");
  const checks = {
    length: p.length >= 8 && p.length <= 64,
    uppercase: /[A-Z]/.test(p),
    lowercase: /[a-z]/.test(p),
    number: /[0-9]/.test(p),
    special: /[^A-Za-z0-9]/.test(p),
    match: confirmPassword !== null ? p === String(confirmPassword) : true
  };

  const errors = [];
  if (!checks.length) errors.push("Password must be between 8 and 64 characters.");
  if (!checks.uppercase) errors.push("Password must include at least one uppercase letter (A-Z).");
  if (!checks.lowercase) errors.push("Password must include at least one lowercase letter (a-z).");
  if (!checks.number) errors.push("Password must include at least one number (0-9).");
  if (!checks.special) errors.push("Password must include at least one special symbol (!@#$%^&*...).");
  if (!checks.match) errors.push("Passwords do not match.");

  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (checks.uppercase && checks.lowercase) score++;
  if (checks.number && checks.special) score++;
  if (score > 4) score = 4;

  const isValid = checks.length && checks.uppercase && checks.lowercase && checks.number && checks.special && checks.match;
  return { isValid, score, errors, checks };
}

function evaluatePasswordStrength(password) {
  const { score, checks } = validatePassword(password);
  const levels = [
    { score: 0, label: "Very Weak", color: "#ef4444", percent: 15 },
    { score: 1, label: "Weak", color: "#f97316", percent: 35 },
    { score: 2, label: "Fair", color: "#eab308", percent: 60 },
    { score: 3, label: "Good", color: "#06b6d4", percent: 80 },
    { score: 4, label: "Strong", color: "#22c55e", percent: 100 }
  ];
  return { ...levels[score], checks };
}

async function hashPassword(password) {
  const str = String(password || "");
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for simple environments
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return hex.repeat(8).slice(0, 64);
}

function getStoredSession(role = 'customer') {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('dsa_session_' + role);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.token) return data;
    return null;
  } catch (_) {
    return null;
  }
}

function setStoredSession(role, userObject) {
  try {
    if (typeof localStorage === 'undefined') return;
    const session = {
      role,
      token: 'jwt_' + role + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
      loginAt: new Date().toISOString(),
      user: userObject
    };
    localStorage.setItem('dsa_session_' + role, JSON.stringify(session));
    return session;
  } catch (_) {
    return null;
  }
}

function clearStoredSession(role = 'customer') {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem('dsa_session_' + role);
  } catch (_) {}
}

function hasValidSession(role = 'customer') {
  return getStoredSession(role) !== null;
}

// ============================================================================
// 6. RESTAURANT REGISTRY, SEED COORDINATES & MAP CARD GENERATION
// ============================================================================

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
    tag: "Coastal Flavors",
    rating: "4.8 ★",
    deliveryTime: "20-30 min",
    image: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=800&q=80",
    desc: "Atlantic fresh line fish, gourmet wild oryx burgers, coastal cafe delights & cold craft sodas."
  }
};

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

var DEFAULT_SEED_RESTAURANTS = (typeof window !== 'undefined' && window.DEFAULT_SEED_RESTAURANTS) || [
  {
    id: "R001",
    name: "Kapana Corner",
    address: "Single Quarters, Katutura, Windhoek",
    lat: -22.5333,
    lng: 17.0658,
    contactNumber: "+264 61 299 1101"
  },
  {
    id: "R002",
    name: "Namibian Potjie Kitchen",
    address: "Independence Ave, Windhoek CBD, Windhoek",
    lat: -22.5601,
    lng: 17.0836,
    contactNumber: "+264 61 299 1102"
  },
  {
    id: "R003",
    name: "Oshakati Traditional Kitchen",
    address: "Mandume Ndemufayo Ave, Windhoek",
    lat: -22.5510,
    lng: 17.0720,
    contactNumber: "+264 61 299 1103"
  },
  {
    id: "R004",
    name: "Windhoek Braai House",
    address: "Sam Nujoma Drive, Klein Windhoek, Windhoek",
    lat: -22.5608,
    lng: 17.0805,
    contactNumber: "+264 61 299 1104"
  },
  {
    id: "R005",
    name: "Desert Cafe & Grill",
    address: "Robert Mugabe Ave, Windhoek Central",
    lat: -22.5720,
    lng: 17.0890,
    contactNumber: "+264 61 299 1105"
  }
];

function createRestaurantMapCardHtml(restaurant, options = {}) {
  const isClient = options && options.isClient === true;
  if (!restaurant) return '<div class="restaurant-popup-card">No restaurant information</div>';

  const rId = String(restaurant.id || 'R001');
  const visual = RESTAURANT_VISUAL_REGISTRY[rId] || DEFAULT_RESTAURANT_VISUAL;
  const name = restaurant.name || visual.name || 'Windhoek Kitchen';
  const tag = visual.tag || 'Local Kitchen';
  const rating = visual.rating || '4.8 ★';
  const deliveryTime = visual.deliveryTime || '20-30 min';
  const imgUrl = visual.image || DEFAULT_RESTAURANT_VISUAL.image;
  const desc = visual.desc || 'Fresh artisan dishes and fast local delivery.';
  const address = restaurant.address || 'Windhoek, Namibia';
  const phone = restaurant.contactNumber || restaurant.phone || '+264 61 299 1100';

  const esc = (typeof escapeHtml === 'function') ? escapeHtml : (str => String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

  const actionSection = isClient
    ? `<button type="button" class="btn btn-sm btn-primary restaurant-popup-action-btn" onclick="if(typeof window.openRestaurantCatalogFromMap==='function'){window.openRestaurantCatalogFromMap('${esc(rId)}');}">View Menu &amp; Catalog</button>`
    : `<div class="restaurant-popup-driver-note"><span class="driver-note-label">Pickup Kitchen</span><span class="driver-note-contact">${esc(phone)}</span></div>`;

  return `
    <div class="restaurant-popup-card" data-restaurant-id="${esc(rId)}">
      <div class="restaurant-popup-media">
        <img src="${imgUrl}" alt="${esc(name)}" class="restaurant-popup-img" loading="lazy" />
      </div>
      <div class="restaurant-popup-content">
        <div class="restaurant-popup-tag-row">
          <span class="restaurant-popup-tag">${esc(tag)}</span>
          <span class="restaurant-popup-rating">${esc(rating)}</span>
        </div>
        <h4 class="restaurant-popup-title">${esc(name)}</h4>
        <p class="restaurant-popup-desc">${esc(desc)}</p>
        <div class="restaurant-popup-meta">
          <span class="meta-address"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> ${esc(address)}</span>
          <span class="meta-eta"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${esc(deliveryTime)}</span>
        </div>
        ${actionSection}
      </div>
    </div>
  `;
}

// Browser global export
if (typeof window !== 'undefined') {
  window.GOOGLE_MAPS_CONFIG = GOOGLE_MAPS_CONFIG;
  window.loadGoogleMapsLibraries = loadGoogleMapsLibraries;
  window.createCustomMarkerElement = createCustomMarkerElement;
  window.resolveMapApiKey = resolveMapApiKey;
  window.getMapApiKeySync = getMapApiKeySync;
  window.getCartoTileUrl = getCartoTileUrl;
  window.getMapTileConfig = getMapTileConfig;
  window.getWatermarkFreeTileUrl = getWatermarkFreeTileUrl;
  window.getEsriTileUrl = getEsriTileUrl;
  window.calculateBearing = calculateBearing;
  window.fetchRoadRoute = fetchRoadRoute;
  window.formatAddress = formatAddress;
  window.formatFriendlyOrderId = formatFriendlyOrderId;
  window.resolveCustomerName = resolveCustomerName;
  window.resolveDriverName = resolveDriverName;
  window.resolveRestaurantName = resolveRestaurantName;
  window.createRibbonPolylineGroup = createRibbonPolylineGroup;
  window.validatePassword = validatePassword;
  window.evaluatePasswordStrength = evaluatePasswordStrength;
  window.hashPassword = hashPassword;
  window.getStoredSession = getStoredSession;
  window.setStoredSession = setStoredSession;
  window.clearStoredSession = clearStoredSession;
  window.hasValidSession = hasValidSession;
  window.DSA_CacheEngine = DSA_CacheEngine;
  window.cachedApiFetch = cachedApiFetch;
  window.DSA_StateKeeper = DSA_StateKeeper;
  window.createVisibilityAwarePoller = createVisibilityAwarePoller;
  window.createCachedResponse = createCachedResponse;
  window.RESTAURANT_VISUAL_REGISTRY = RESTAURANT_VISUAL_REGISTRY;
  window.DEFAULT_SEED_RESTAURANTS = DEFAULT_SEED_RESTAURANTS;
  window.createRestaurantMapCardHtml = createRestaurantMapCardHtml;

  window.DSA = {
    getCandidateUrls,
    resolveApiUrl,
    apiFetch,
    probeHealth,
    DSA_CacheEngine,
    cachedApiFetch,
    DSA_StateKeeper,
    createVisibilityAwarePoller,
    createCachedResponse,
    calculateDistanceKm,
    calculateETA,
    calculateBearing,
    fetchRoadRoute,
    formatAddress,
    formatFriendlyOrderId,
    resolveCustomerName,
    resolveDriverName,
    resolveRestaurantName,
    createRibbonPolylineGroup,
    setText,
    formatMoney,
    formatNumber,
    escapeHtml,
    openModal,
    closeModal,
    setupTabNavigation,
    initCustomDropdownMenus,
    closeAllDropdowns,
    initCustomDateTimePickers,
    closeAllDatePickers,
    GOOGLE_MAPS_CONFIG,
    loadGoogleMapsLibraries,
    createCustomMarkerElement,
    resolveMapApiKey,
    getMapApiKeySync,
    getCartoTileUrl,
    getMapTileConfig,
    getWatermarkFreeTileUrl,
    getEsriTileUrl,
    validatePassword,
    evaluatePasswordStrength,
    hashPassword,
    getStoredSession,
    setStoredSession,
    clearStoredSession,
    hasValidSession,
    RESTAURANT_VISUAL_REGISTRY,
    DEFAULT_SEED_RESTAURANTS,
    createRestaurantMapCardHtml
  };
  window.sharedApiFetch = apiFetch;
  window.sharedProbeHealth = probeHealth;
  window.initCustomDropdownMenus = initCustomDropdownMenus;
  window.initCustomDateTimePickers = initCustomDateTimePickers;
}

// Export for Node environments / testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getCandidateUrls,
    resolveApiUrl,
    apiFetch,
    probeHealth,
    DSA_CacheEngine,
    cachedApiFetch,
    DSA_StateKeeper,
    createVisibilityAwarePoller,
    createCachedResponse,
    calculateDistanceKm,
    calculateETA,
    calculateBearing,
    fetchRoadRoute,
    formatAddress,
    formatFriendlyOrderId,
    resolveCustomerName,
    resolveDriverName,
    resolveRestaurantName,
    createRibbonPolylineGroup,
    setText,
    formatMoney,
    formatNumber,
    escapeHtml,
    openModal,
    closeModal,
    setupTabNavigation,
    initCustomDropdownMenus,
    closeAllDropdowns,
    GOOGLE_MAPS_CONFIG,
    loadGoogleMapsLibraries,
    createCustomMarkerElement,
    resolveMapApiKey,
    getMapApiKeySync,
    getCartoTileUrl,
    getMapTileConfig,
    getWatermarkFreeTileUrl,
    getEsriTileUrl,
    validatePassword,
    evaluatePasswordStrength,
    hashPassword,
    getStoredSession,
    setStoredSession,
    clearStoredSession,
    hasValidSession,
    RESTAURANT_VISUAL_REGISTRY,
    DEFAULT_SEED_RESTAURANTS,
    createRestaurantMapCardHtml
  };
}

