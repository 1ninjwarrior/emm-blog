// Em&m Blog: data layer.
// Three backends behind one API:
//   'live'   claude.ai Artifact: the runtime's `db` + `assets` + `downloads` capabilities
//   'device' a normal website (GitHub Pages): IndexedDB for every collection + photo/video blobs
//   'memory' ?demo, or when IndexedDB is unavailable (e.g. some private windows): in memory, not saved
//
//   await ready                      -> backend resolved (state.mode)
//   watch('posts', items => ...)     -> live array (sorted like the query), one subscription per collection
//   items('posts'), byId('posts', id)
//   add / update / set / remove      -> writes (one write at a time per doc, queued)
//   patchSoon(coll, id, patch, ms)   -> coalesced/debounced update (autosave, fast checkbox taps)
//   upload(blob, type) / blobSrc(id) / blobOf(id) / deleteAsset(id) / usage()
//   bulkPut(coll, docs) / clearAll() -> restore helpers (device/memory only)
//   prefs.get/set, on/emit           -> per-viewer prefs (localStorage) + tiny event bus
import * as idb from './idb.js';

/** Collections and the one query each is subscribed with. Items stay in these orders. */
export const COLLS = {
  boards: { field: 'createdAt', dir: 'asc', limit: 200 },
  posts: { field: 'createdAt', dir: 'desc', limit: 1000 },
  diary: { field: 'date', dir: 'desc', limit: 1000 },
  recipes: { field: 'updatedAt', dir: 'desc', limit: 500 },
  lists: { field: 'createdAt', dir: 'asc', limit: 300 },
  countdowns: { field: 'date', dir: 'asc', limit: 300 },
  // Today planner (same shapes as the app's tables, camelCase)
  tasks: { field: 'createdAt', dir: 'asc', limit: 2000 },
  taskDone: { field: 'date', dir: 'desc', limit: 5000 }, // id = taskId|date
  routines: { field: 'sort', dir: 'asc', limit: 100 },
  // Habit Garden
  habits: { field: 'sort', dir: 'asc', limit: 200 },
  habitChecks: { field: 'date', dir: 'desc', limit: 10000 }, // id = habitId|date
  gardenUnlocks: { field: 'unlockedAt', dir: 'asc', limit: 100 }, // id = reward key
  // Small synced settings (grocery history/staples/aisle numbers/walk drafts, share name, …): {id: key, value}
  kv: { field: 'id', dir: 'asc', limit: 500 },
};

export const state = {
  /** 'loading' until resolved, then 'live' (artifact db), 'device' (IndexedDB) or 'memory' (not saved). */
  mode: 'loading',
  db: null,
  assets: null,
  downloads: null,
  /** True when this viewer may create/edit. */
  canWrite: false,
  /** True for device + memory (no artifact runtime). */
  local: false,
  /** True only for 'memory': nothing is kept after closing the page. */
  memory: false,
  /** Why we fell back to memory ('demo' | 'unavailable'). */
  memoryWhy: '',
};

// ---------- tiny event bus ----------
const bus = new Map();
export function on(evt, fn) {
  if (!bus.has(evt)) bus.set(evt, new Set());
  bus.get(evt).add(fn);
  return () => bus.get(evt).delete(fn);
}
export function emit(evt, payload) {
  const set = bus.get(evt);
  if (set) for (const fn of [...set]) { try { fn(payload); } catch (e) { console.error(e); } }
}

// ---------- prefs (per viewer, localStorage with memory fallback) ----------
const memPrefs = {};
export const prefs = {
  get(key, def = null) {
    try { const v = localStorage.getItem('emm-' + key); if (v !== null) return v; } catch (e) { /* storage blocked */ }
    return key in memPrefs ? memPrefs[key] : def;
  },
  set(key, val) {
    memPrefs[key] = val;
    try { if (val === null || val === undefined) localStorage.removeItem('emm-' + key); else localStorage.setItem('emm-' + key, String(val)); } catch (e) { /* ignore */ }
    emit('prefs', key);
  },
  getJSON(key, def) { try { const v = this.get(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
  setJSON(key, val) { this.set(key, JSON.stringify(val)); },
};

// ---------- boot ----------
let readyResolve;
export const ready = new Promise((r) => (readyResolve = r));
const hasClaude = () => !!(window.claude && typeof window.claude.use === 'function');
const isDemo = () => /[?&]demo\b/.test(location.search);

export async function init() {
  if (hasClaude()) {
    const use = (n) => { try { return window.claude.use(n).catch(() => null); } catch (e) { return Promise.resolve(null); } };
    const [db, assets, downloads] = await Promise.all([use('db'), use('assets'), use('downloads')]);
    state.db = db; state.assets = assets; state.downloads = downloads;
    if (db) { state.mode = 'live'; state.canWrite = !!assets; }
  }
  if (state.mode === 'loading') {
    state.local = true;
    state.canWrite = true;
    if (!isDemo()) {
      try {
        await idb.open();
        const blobs = await idb.loadBlobs();
        for (const b of blobs) localBlobs.set(b.id, { blob: b.blob, url: null, size: b.size || (b.blob && b.blob.size) || 0, type: b.type });
        state.mode = 'device';
      } catch (e) {
        console.warn('IndexedDB unavailable, using memory', e);
        state.memoryWhy = 'unavailable';
      }
    } else state.memoryWhy = 'demo';
    if (state.mode === 'loading') { state.mode = 'memory'; state.memory = true; }
  }
  for (const name of Object.keys(COLLS)) if (cache[name].wanted) start(name);
  readyResolve(state);
  emit('ready', state);
  if (state.mode === 'device') askPersist();
  return state;
}

/** Ask the browser not to evict our data under storage pressure. Resolves true when granted. */
export async function askPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return false; }
}
export async function isPersisted() {
  try { return !!(navigator.storage && navigator.storage.persisted && (await navigator.storage.persisted())); } catch (e) { return false; }
}

// ---------- collections cache ----------
const cache = {};
for (const name of Object.keys(COLLS)) {
  cache[name] = { items: [], map: new Map(), snaps: new Map(), loaded: false, wanted: false, started: false, listeners: new Set(), error: null };
}

function cmpFor(name) {
  const { field, dir } = COLLS[name];
  const s = dir === 'desc' ? -1 : 1;
  return (a, b) => {
    const x = a[field], y = b[field];
    if (x === y) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (x === undefined || x === null) return 1;
    if (y === undefined || y === null) return -1;
    return (x < y ? -1 : 1) * s;
  };
}

function notify(name) {
  const c = cache[name];
  for (const fn of [...c.listeners]) { try { fn(c.items, c); } catch (e) { console.error(e); } }
  emit('data', name);
}

function start(name) {
  const c = cache[name];
  if (c.started || state.mode === 'loading') return;
  c.started = true;
  if (state.mode === 'memory') { c.loaded = true; notify(name); return; }
  if (state.mode === 'device') { loadDevice(name); return; }
  const q = COLLS[name];
  state.db.collection(name).orderBy(q.field, q.dir).limit(q.limit).onSnapshot((snap) => {
    const next = [];
    const snaps = new Map();
    for (const s of snap.docs) {
      const prev = c.snaps.get(s.id);
      // Delivered snapshots are the same object when a doc didn't change: reuse our item so
      // views can skip re-rendering it (keyed diff by identity).
      const item = prev && prev.snap === s ? prev.item : Object.freeze({ id: s.id, ...s.data() });
      snaps.set(s.id, { snap: s, item });
      // Unsaved coalesced edits (patchSoon) stay visible on top of the server copy.
      const p = pending.get(name + '/' + s.id);
      next.push(p ? Object.freeze(deepMerge(item, p.patch)) : item);
    }
    c.snaps = snaps;
    c.items = next;
    c.map = new Map(next.map((i) => [i.id, i]));
    c.loaded = true;
    c.error = null;
    notify(name);
  }, (err) => {
    c.error = err;
    c.loaded = true;
    console.warn('subscription error', name, err);
    notify(name);
    emit('sync-error', { name, err });
  });
}

async function loadDevice(name) {
  const c = cache[name];
  try {
    const rows = await idb.loadColl(name);
    // Anything written while we were loading wins over what was on disk.
    const map = new Map(rows.map((r) => [r.id, Object.freeze(r)]));
    for (const [id, it] of c.map) map.set(id, it);
    for (const id of c.deleted || []) map.delete(id);
    c.map = map;
    c.items = [...map.values()].sort(cmpFor(name));
    c.error = null;
  } catch (e) {
    console.warn('load failed', name, e);
    c.error = e;
    emit('sync-error', { name, err: e });
  }
  c.deleted = null;
  c.loaded = true;
  notify(name);
}

/** Subscribe to a collection. Calls `fn(items)` now if loaded and on every change. Returns unwatch. */
export function watch(name, fn) {
  const c = cache[name];
  if (!c) throw new Error('unknown collection ' + name);
  c.listeners.add(fn);
  c.wanted = true;
  start(name);
  if (c.loaded) { try { fn(c.items, c); } catch (e) { console.error(e); } }
  return () => c.listeners.delete(fn);
}
export const items = (name) => cache[name].items;
export const byId = (name, id) => (id ? cache[name].map.get(id) || null : null);
export const isLoaded = (name) => cache[name].loaded;
/** Make sure a collection is subscribed (without a listener). */
export function want(name) { cache[name].wanted = true; start(name); }
/** Resolves once a collection has loaded (subscribing it if needed). */
export function loaded(name) {
  want(name);
  if (cache[name].loaded) return Promise.resolve(cache[name].items);
  return new Promise((res) => { const off = watch(name, (it, c) => { if (c.loaded) { setTimeout(() => off(), 0); res(it); } }); });
}

// Local mutation helpers: keep items immutable (new object per change) and sorted.
function localPut(name, item, { silent = false } = {}) {
  const c = cache[name];
  const frozen = Object.freeze(item);
  c.map.set(item.id, frozen);
  c.items = [...c.map.values()].sort(cmpFor(name));
  if (!silent) notify(name);
  return frozen;
}
function localDel(name, id, { silent = false } = {}) {
  const c = cache[name];
  c.map.delete(id);
  c.items = c.items.filter((i) => i.id !== id);
  if (!c.loaded) (c.deleted || (c.deleted = new Set())).add(id);
  if (!silent) notify(name);
}

// Device writes: one IndexedDB transaction per change, in order; other tabs hear about it.
let chan = null;
try {
  chan = 'BroadcastChannel' in self ? new BroadcastChannel('emm-blog') : null;
  if (chan) chan.onmessage = (e) => onRemote(e.data);
} catch (e) { chan = null; }
async function persist(ops) {
  if (state.mode !== 'device') return;
  try {
    await idb.write(ops);
    if (chan) chan.postMessage({ t: 'docs', ops: ops.map((o) => ({ c: o.c, id: o.id })) });
  } catch (e) {
    emit('save-error', { err: e });
    throw e.name === 'QuotaExceededError' ? { code: 'quota_exceeded' } : e;
  }
}
async function onRemote(msg) {
  if (!msg || state.mode !== 'device') return;
  if (msg.t === 'reload') { location.reload(); return; }
  if (msg.t === 'blob' && msg.id) {
    if (msg.del) { const b = localBlobs.get(msg.id); if (b && b.url) URL.revokeObjectURL(b.url); localBlobs.delete(msg.id); return; }
    try { const blob = await idb.getBlob(msg.id); if (blob) localBlobs.set(msg.id, { blob, url: null, size: blob.size, type: blob.type }); } catch (e) { /* ignore */ }
    return;
  }
  if (msg.t !== 'docs') return;
  const touched = new Set();
  for (const o of msg.ops || []) {
    if (!cache[o.c] || !cache[o.c].started) continue;
    touched.add(o.c);
  }
  // Re-read the touched collections (small) so this tab matches.
  for (const name of touched) {
    try {
      const rows = await idb.loadColl(name);
      const c = cache[name];
      const map = new Map();
      for (const r of rows) { const prev = c.map.get(r.id); map.set(r.id, prev && JSON.stringify(prev) === JSON.stringify(r) ? prev : Object.freeze(r)); }
      c.map = map;
      c.items = [...map.values()].sort(cmpFor(name));
      notify(name);
    } catch (e) { /* ignore */ }
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}
const clean = (o) => JSON.parse(JSON.stringify(o)); // strips undefined, clones

// One write at a time per document.
const chains = new Map();
function queued(path, fn) {
  const prev = chains.get(path) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(path, next);
  next.finally(() => { if (chains.get(path) === next) chains.delete(path); }).catch(() => {});
  return next;
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function retryOnce(fn) {
  try { return await fn(); } catch (e) {
    if (e && (e.code === 'unavailable' || e.code === 'store_unavailable')) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
      return fn();
    }
    throw e;
  }
}

/** Create a document; resolves its id. */
export async function add(name, data) {
  await ready;
  const body = clean(data);
  if (state.local) {
    const id = 'l' + newId();
    const it = localPut(name, { id, ...body });
    await queued(name + '/' + id, () => persist([{ c: name, id, d: it }]));
    return id;
  }
  const ref = state.db.collection(name).doc();
  await queued(ref.path, () => retryOnce(() => ref.set(body)));
  return ref.id;
}

/** Replace a whole document (creating it if needed). */
export async function set(name, id, data) {
  await ready;
  const body = clean(data);
  if (state.local) {
    const it = localPut(name, { id, ...body });
    await queued(name + '/' + id, () => persist([{ c: name, id, d: it }]));
    return;
  }
  const ref = state.db.doc(name + '/' + id);
  await queued(ref.path, () => retryOnce(() => ref.set(body)));
}

/** Merge fields into an existing document (nested objects merge, arrays replace). */
export async function update(name, id, patch) {
  await ready;
  const body = clean(patch);
  if (state.local) {
    const cur = cache[name].map.get(id);
    if (!cur) return;
    const it = localPut(name, deepMerge(cur, body));
    await queued(name + '/' + id, () => persist([{ c: name, id, d: it }]));
    return;
  }
  const ref = state.db.doc(name + '/' + id);
  await queued(ref.path, () => retryOnce(() => ref.update(body)));
}

export async function remove(name, id) {
  await ready;
  cancelSoon(name, id);
  if (state.local) {
    localDel(name, id);
    await queued(name + '/' + id, () => persist([{ c: name, id, d: null }]));
    return;
  }
  const ref = state.db.doc(name + '/' + id);
  await queued(ref.path, () => retryOnce(() => ref.delete()));
}

/**
 * Several writes at once (device/memory: one transaction, one notify per collection).
 * ops: [{c, id, d}] where d = full doc data (set) or null (delete). Returns the ids.
 * In the artifact it falls back to individual writes.
 */
export async function batch(ops) {
  await ready;
  if (!state.local) {
    await Promise.all(ops.map((o) => (o.d === null ? remove(o.c, o.id) : set(o.c, o.id, o.d))));
    return ops.map((o) => o.id);
  }
  const touched = new Set();
  const rows = [];
  for (const o of ops) {
    const id = o.id || 'l' + newId();
    if (o.d === null) { cancelSoon(o.c, id); localDel(o.c, id, { silent: true }); rows.push({ c: o.c, id, d: null }); }
    else rows.push({ c: o.c, id, d: localPut(o.c, { id, ...clean(o.d) }, { silent: true }) });
    touched.add(o.c);
  }
  touched.forEach(notify);
  await queued('batch', () => persist(rows));
  return rows.map((r) => r.id);
}

/** Restore helper: wipe these collections (device/memory only). */
export async function clearAll(names = Object.keys(COLLS)) {
  await ready;
  if (!state.local) throw new Error('not local');
  for (const n of names) { pending.forEach((p, k) => { if (k.startsWith(n + '/')) { clearTimeout(p.timer); pending.delete(k); } }); }
  if (state.mode === 'device') await idb.clearColls(names);
  for (const n of names) { const c = cache[n]; c.map = new Map(); c.items = []; notify(n); }
}

// Coalesced updates: many quick changes -> one write per pause.
const pending = new Map();
/** Debounced merge-update. Returns a promise that resolves when this batch is written. */
export function patchSoon(name, id, patch, ms = 600) {
  const key = name + '/' + id;
  let p = pending.get(key);
  if (!p) {
    p = { patch: {}, timer: 0, waiters: [] };
    pending.set(key, p);
  }
  Object.assign(p.patch, patch);
  clearTimeout(p.timer);
  // Optimistic: show the change right away.
  const c = cache[name];
  const cur = c.map.get(id);
  if (cur) {
    const merged = Object.freeze(deepMerge(cur, patch));
    c.map.set(id, merged);
    c.items = c.items.map((i) => (i.id === id ? merged : i));
    notify(name);
  }
  const done = new Promise((res, rej) => p.waiters.push({ res, rej }));
  p.timer = setTimeout(() => flushSoon(key), ms);
  emit('saving', { name, id });
  return done;
}
async function flushSoon(key) {
  const p = pending.get(key);
  if (!p) return;
  pending.delete(key);
  const [name, id] = key.split('/');
  try {
    if (state.local) {
      // The optimistic copy already has the patch: just write the current doc.
      const cur = cache[name].map.get(id);
      if (cur) await queued(key, () => persist([{ c: name, id, d: cur }]));
    } else await update(name, id, p.patch);
    p.waiters.forEach((w) => w.res());
    emit('saved', { name, id });
  } catch (e) {
    p.waiters.forEach((w) => w.rej(e));
    emit('save-error', { name, id, err: e });
  }
}
/** Write any pending coalesced patch for this doc right now. */
export function flushNow(name, id) {
  const key = name + '/' + id;
  const p = pending.get(key);
  if (!p) return Promise.resolve();
  clearTimeout(p.timer);
  return flushSoon(key);
}
function cancelSoon(name, id) {
  const key = name + '/' + id;
  const p = pending.get(key);
  if (p) { clearTimeout(p.timer); pending.delete(key); p.waiters.forEach((w) => w.res()); }
}
addEventListener('pagehide', () => { for (const key of [...pending.keys()]) flushSoon(key); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') for (const key of [...pending.keys()]) flushSoon(key); });

// ---------- small synced settings (kv collection) ----------
export const kv = {
  get(key, def = null) { const d = cache.kv.map.get(key); return d && d.value !== undefined ? d.value : def; },
  set(key, value) { return value === null || value === undefined ? remove('kv', key) : set('kv', key, { value }); },
  /** Debounced write (typing, fast taps). */
  soon(key, value, ms = 400) {
    if (!cache.kv.map.get(key)) return set('kv', key, { value });
    return patchSoon('kv', key, { value }, ms);
  },
};

// ---------- assets ----------
const localBlobs = new Map(); // id -> {blob, url, size, type}

/** Upload a blob. Resolves {id, url}. */
export async function upload(blob, type) {
  await ready;
  const t = type || blob.type || 'image/jpeg';
  if (state.local) {
    const id = 'local' + newId();
    const url = URL.createObjectURL(blob);
    if (state.mode === 'device') {
      try { await idb.putBlob(id, blob, t); } catch (e) { URL.revokeObjectURL(url); throw e && e.name === 'QuotaExceededError' ? { code: 'quota_exceeded' } : e; }
      if (chan) chan.postMessage({ t: 'blob', id });
    }
    localBlobs.set(id, { blob, url, size: blob.size, type: t });
    return { id, url };
  }
  if (!state.assets) throw { code: 'not_granted' };
  return retryOnce(() => state.assets.upload(blob, { type: t }));
}

/** Display URL for an asset id stored in a doc. */
export function blobSrc(id) {
  if (!id) return '';
  const l = localBlobs.get(id);
  if (l) { if (!l.url && l.blob) l.url = URL.createObjectURL(l.blob); return l.url || ''; }
  if (String(id).startsWith('demo:')) return String(id).slice(5); // demo seed data urls
  if (state.local) return ''; // unknown on this device (e.g. a photo that wasn't in a restored backup)
  return '/_blob/' + id;
}

/** The Blob behind an asset id (device/memory), or null. Used by backups. */
export async function blobOf(id) {
  const l = localBlobs.get(id);
  if (l && l.blob) return l.blob;
  if (state.local) return null;
  try { const r = await fetch(blobSrc(id)); return r.ok ? await r.blob() : null; } catch (e) { return null; }
}
/** Every stored asset id (device/memory). */
export const blobIds = () => [...localBlobs.keys()];

/** Restore helper: store a blob under a fixed id. */
export async function putBlobAs(id, blob, type) {
  await ready;
  const t = type || blob.type;
  if (state.mode === 'device') await idb.putBlob(id, blob, t);
  const old = localBlobs.get(id);
  if (old && old.url) URL.revokeObjectURL(old.url);
  localBlobs.set(id, { blob, url: null, size: blob.size, type: t });
}
/** Restore helper: remove every blob. */
export async function clearBlobs() {
  await ready;
  if (state.mode === 'device') await idb.clearBlobs();
  localBlobs.forEach((b) => b.url && URL.revokeObjectURL(b.url));
  localBlobs.clear();
}
/** Tell other open tabs to reload (after a restore). */
export function reloadOtherTabs() { if (chan) chan.postMessage({ t: 'reload' }); }

/** Delete an asset nothing points at anymore. Never throws. */
export async function deleteAsset(id) {
  if (!id) return;
  try {
    if (localBlobs.has(id)) {
      const b = localBlobs.get(id);
      if (b.url) URL.revokeObjectURL(b.url);
      localBlobs.delete(id);
      if (state.mode === 'device') { await idb.delBlob(id); if (chan) chan.postMessage({ t: 'blob', id, del: 1 }); }
      return;
    }
    if (state.assets && !String(id).startsWith('demo:')) await state.assets.delete(id);
  } catch (e) { /* stays orphaned; harmless */ }
}

/** {bytes, maxBytes, files, maxFiles, local, quota, usage} or null. */
export async function usage() {
  await ready;
  if (state.local) {
    let bytes = 0;
    localBlobs.forEach((b) => (bytes += b.size || 0));
    let quota = 0, used = 0;
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); quota = e.quota || 0; used = e.usage || 0; } } catch (e) { /* ignore */ }
    return { bytes, files: localBlobs.size, maxBytes: 0, maxFiles: 0, local: true, memory: state.memory, quota, usage: used, persisted: await isPersisted() };
  }
  if (!state.assets) return null;
  try { return (await state.assets.list()).usage; } catch (e) { return null; }
}

/** Friendly text for any capability error code. */
export function errText(err) {
  const c = err && err.code;
  return ({
    too_large: 'That file is over 20 MB. Try a smaller one.',
    unsupported_type: 'That file type isn’t supported. Try JPG, PNG, GIF, WebP, MP4 or WebM.',
    quota_or_state: 'Storage is full. Delete a few old posts to make room.',
    quota_exceeded: 'You’ve saved a LOT. Delete a few old things to make room.',
    rate_limited: 'Slow down a little, then try again.',
    resource_exhausted: 'Slow down a little, then try again.',
    invalid_argument: 'You can look, but not edit here ♡',
    not_granted: 'Saving isn’t available here.',
    revoked: 'Saving isn’t available right now.',
  })[c] || 'Something went wrong. Try again in a moment.';
}

/** Used by the ?demo preview seeding (memory mode only). */
export function _localSeed(name, list) {
  for (const it of list) cache[name].map.set(it.id, Object.freeze(it));
  cache[name].items = [...cache[name].map.values()].sort(cmpFor(name));
  if (cache[name].started) notify(name);
}
