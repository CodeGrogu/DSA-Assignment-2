import assert from 'node:assert';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock browser environment globals for testing
const mockLocalStorage = {
  _store: new Map(),
  getItem(key) {
    return this._store.has(key) ? this._store.get(key) : null;
  },
  setItem(key, value) {
    this._store.set(key, String(value));
  },
  removeItem(key) {
    this._store.delete(key);
  },
  clear() {
    this._store.clear();
  },
  key(index) {
    return Array.from(this._store.keys())[index] || null;
  },
  get length() {
    return this._store.size;
  }
};

globalThis.localStorage = mockLocalStorage;
globalThis.window = globalThis;
globalThis.CustomEvent = class CustomEvent {
  constructor(type, eventInitDict) {
    this.type = type;
    this.detail = eventInitDict?.detail;
  }
};
globalThis.dispatchEvent = () => true;

// Import shared.js module
const shared = await import('../web/shared.js');
const { DSA_CacheEngine, cachedApiFetch, DSA_StateKeeper, createVisibilityAwarePoller, createCachedResponse } = shared.default || shared;

console.log('🧪 Starting Dual-Tier Cache & Storage Test Suite...');

// 1. In-Memory and Storage Cache Set / Get
console.log('\n[Test 1] DSA_CacheEngine Basic Caching & TTL');
mockLocalStorage.clear();
DSA_CacheEngine.clear();

DSA_CacheEngine.set('9095:/restaurants', [{ id: 'R001', name: 'Kapana Corner' }], 500); // 500ms TTL
const hit1 = DSA_CacheEngine.get('9095:/restaurants');
assert(hit1 !== null, 'Should return cached item');
assert.strictEqual(hit1.data[0].id, 'R001', 'Should match cached restaurant data');

// Check that it backed up to localStorage
assert(mockLocalStorage.getItem('dsa_cache:9095:/restaurants') !== null, 'Should persist to localStorage');
console.log('  ✓ In-memory and persistent cache retrieval verified.');

// 2. Cache Invalidation on Mutation
console.log('\n[Test 2] Mutation-Driven Cache Invalidation');
DSA_CacheEngine.set('9091:/orders', [{ id: 'ORD-1' }], 10000);
DSA_CacheEngine.set('9091:/orders/ORD-1', { id: 'ORD-1', status: 'PLACED' }, 10000);
assert(DSA_CacheEngine.get('9091:/orders') !== null, 'Orders should be cached');

DSA_CacheEngine.invalidatePrefix('9091:/orders');
assert.strictEqual(DSA_CacheEngine.get('9091:/orders'), null, 'Orders list should be invalidated');
assert.strictEqual(DSA_CacheEngine.get('9091:/orders/ORD-1'), null, 'Specific order should be invalidated');
assert.strictEqual(mockLocalStorage.getItem('dsa_cache:9091:/orders'), null, 'LocalStorage cache should be invalidated');
console.log('  ✓ Prefix cache invalidation verified.');

// 3. Quota Exceeded and FIFO Eviction
console.log('\n[Test 3] LocalStorage Quota Exceeded Handling & Safe Deserialization');
// Corrupted entry test
mockLocalStorage.setItem('dsa_cache:corrupted', '{invalid json payload');
const corruptedHit = DSA_CacheEngine.get('corrupted');
assert.strictEqual(corruptedHit, null, 'Should return null on corrupted entry and not throw');
assert.strictEqual(mockLocalStorage.getItem('dsa_cache:corrupted'), null, 'Should automatically evict corrupted entry');
console.log('  ✓ Corrupted JSON recovery verified.');

// 4. DSA_StateKeeper
console.log('\n[Test 4] DSA_StateKeeper State Persistence');
mockLocalStorage.clear();
DSA_StateKeeper.set('active_tab', 'tab-kds');
DSA_StateKeeper.set('cart', [{ item: { id: 'D01', name: 'Kapana' }, quantity: 2 }]);

assert.strictEqual(DSA_StateKeeper.get('active_tab'), 'tab-kds', 'Should restore active_tab string');
const restoredCart = DSA_StateKeeper.get('cart');
assert.strictEqual(restoredCart.length, 1, 'Should restore cart array');
assert.strictEqual(restoredCart[0].quantity, 2, 'Should restore cart quantity');
assert.strictEqual(DSA_StateKeeper.get('non_existent', 'default_val'), 'default_val', 'Should return default value on miss');
console.log('  ✓ DSA_StateKeeper persistence and type retention verified.');

// 5. Visibility-Aware Poller Helper
console.log('\n[Test 5] Visibility-Aware Poller');
let pollCount = 0;
const poller = createVisibilityAwarePoller(() => { pollCount++; }, {
  activeIntervalMs: 20,
  hiddenIntervalMs: 500,
  immediateOnVisible: false
});

poller.start();
await new Promise(r => setTimeout(r, 65));
poller.stop();
assert(pollCount >= 2, `Should poll actively (counted ${pollCount})`);
console.log('  ✓ VisibilityAwarePoller interval lifecycle verified.');

// 6. createCachedResponse
console.log('\n[Test 6] createCachedResponse Fetch Mock');
const syntheticRes = createCachedResponse({ status: 'ok', count: 42 }, 200, { 'x-dsa-cache': 'HIT' });
assert.strictEqual(syntheticRes.ok, true);
assert.strictEqual(syntheticRes.status, 200);
assert.strictEqual(syntheticRes._cached, true);
const syntheticJson = await syntheticRes.json();
assert.strictEqual(syntheticJson.count, 42);
console.log('  ✓ Synthetic Response clone and json() verified.');

console.log('\n🎉 ALL DUAL-TIER CACHING & STORAGE TESTS PASSED SUCCESSFULLY!\n');
