// Em&m Blog: Backup & restore for the website (device/memory backends only).
//
//  Web backup  = Emm-Blog-web-backup-yyyy-mm-dd-HHmm.zip
//     web-backup.json  {format:'emm-blog-web-backup', formatVersion:1, createdAt, counts, prefs, collections:{name:[docs]}}  (DEFLATE)
//     media/<assetId>  every stored photo/video/render (STORED, zero-copy)
//  Restore     = any web backup, or the PHONE APP's backup zip (manifest.json + emm.db + media/…), which is read
//                with sql.js (vendored, lazy) and mapped onto the web collections. Web → app isn't possible:
//                the app can't read web backups.
//
//  inspect(file)  -> {kind:'web'|'app', createdAt, counts, lines, plan}   (reads + validates everything, writes nothing)
//  applyPlan(plan, onProgress) -> replaces everything in this browser
//  backupNow(onProgress)       -> Blob of a web backup
import { COLLS, state, loaded, batch, clearAll, blobIds, blobOf, putBlobAs, deleteAsset, reloadOtherTabs, prefs, kv } from '../store.js';
import { ZipWriter, openZip, mimeOf } from './zip.js';

export const FORMAT = 'emm-blog-web-backup';
export const FORMAT_VERSION = 1;
const APP_FORMAT = 'emm-blog-backup';
const APP_FORMAT_VERSION = 1;
const APP_SCHEMA_MAX = 4;
const PREF_KEYS = ['mode', 'accent', 'flowers', 'diary-font'];
/** The web's list colors (lists.js LIST_COLORS); the app stores a swatch index. */
const LIST_COLORS = ['#FFC2D8', '#FFD3B0', '#FFE58A', '#BDEBC8', '#C4E4FF', '#DCCBFF'];

export class BackupError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new BackupError(code, message); };

/** Friendly text for anything that went wrong. */
export function friendlyError(e) {
  if (e instanceof BackupError) return e.message;
  const c = e && e.code;
  if (c === 'not_zip') return 'That file isn’t a backup (it’s not a .zip). Nothing was changed.';
  if (c === 'damaged') return 'That backup looks damaged, so nothing was changed. Try another copy?';
  if (c === 'too_big') return 'That backup is too big to open in a browser. Nothing was changed.';
  if (c === 'quota_exceeded' || (e && e.name === 'QuotaExceededError')) return 'This browser ran out of space. Free some up, then try again.';
  return 'Something went wrong, so nothing was changed. Try again?';
}

const pad = (n) => String(n).padStart(2, '0');
export function backupFileName(d = new Date()) {
  return `Emm-Blog-web-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (ms) => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };

// ---------- counts ----------
function countsOf(cols, mediaCount) {
  const posts = cols.posts || [];
  return {
    pins: posts.length,
    photos: posts.filter((p) => p.kind === 'photo' || p.kind === 'collage').length,
    videos: posts.filter((p) => p.kind === 'video').length,
    boards: (cols.boards || []).length,
    diary: (cols.diary || []).length,
    recipes: (cols.recipes || []).length,
    lists: (cols.lists || []).length,
    tasks: (cols.tasks || []).filter((t) => !t.routineId).length,
    routines: (cols.routines || []).length,
    events: (cols.events || []).length,
    habits: (cols.habits || []).length,
    countdowns: (cols.countdowns || []).length,
    media: mediaCount,
  };
}
/** "42 pins, 18 diary pages, 9 recipes…" (only what's there). */
export function describeCounts(c) {
  const parts = [];
  const add = (n, one, many) => { if (n) parts.push(`${n} ${n === 1 ? one : many}`); };
  add(c.pins, 'pin', 'pins');
  add(c.diary, 'diary page', 'diary pages');
  add(c.recipes, 'recipe', 'recipes');
  add(c.lists, 'list', 'lists');
  add(c.tasks, 'task', 'tasks');
  add(c.routines, 'routine', 'routines');
  add(c.events, 'event', 'events');
  add(c.habits, 'habit', 'habits');
  add(c.countdowns, 'special day', 'special days');
  add(c.boards, 'board', 'boards');
  add(c.media, 'photo & video file', 'photo & video files');
  return parts.length ? parts.join(', ') : 'nothing yet';
}

// ---------- back up ----------
/** Everything in this browser as a web backup zip Blob. onProgress(0..1, label). */
export async function backupNow(onProgress = () => {}) {
  if (!state.local) fail('unsupported', 'Backups are for the website version.');
  const names = Object.keys(COLLS);
  const cols = {};
  for (const n of names) cols[n] = (await loaded(n)).map((d) => ({ ...d }));
  const ids = blobIds();
  const createdAt = Date.now();
  const p = {};
  for (const k of PREF_KEYS) { const v = prefs.get(k); if (v !== null && v !== undefined) p[k] = v; }
  const doc = { format: FORMAT, formatVersion: FORMAT_VERSION, createdAt, app: { name: 'Em&m Blog web', platform: 'web' }, counts: countsOf(cols, ids.length), prefs: p, collections: cols };
  const zip = new ZipWriter();
  await zip.add('web-backup.json', JSON.stringify(doc), { deflate: true });
  let i = 0;
  const skipped = [];
  for (const id of ids) {
    const b = await blobOf(id);
    if (b) await zip.add('media/' + id, b); else skipped.push(id);
    onProgress(++i / Math.max(1, ids.length), 'Packing photos…');
  }
  const blob = zip.finish();
  await kv.set('backup_last_manual', createdAt);
  return { blob, name: backupFileName(new Date(createdAt)), counts: doc.counts, skipped };
}

// ---------- inspect ----------
/** Read and validate a backup file (web or phone app). Writes nothing. */
export async function inspect(file, onProgress = () => {}) {
  const zip = await openZip(file);
  if (zip.entries.has('web-backup.json')) return inspectWeb(zip);
  if (zip.entries.has('manifest.json') && zip.entries.has('emm.db')) return inspectApp(zip, onProgress);
  if (zip.entries.has('recipe.json')) fail('recipe', 'That’s a shared recipe, not a backup. Open it from Recipes → Import.');
  fail('not_backup', 'That zip isn’t an Em&m Blog backup. Nothing was changed.');
}

async function inspectWeb(zip) {
  let doc;
  try { doc = JSON.parse(await zip.text('web-backup.json')); } catch (e) { if (e && e.code) throw e; fail('damaged', 'That backup looks damaged, so nothing was changed.'); }
  if (!doc || doc.format !== FORMAT) fail('not_backup', 'That zip isn’t an Em&m Blog backup. Nothing was changed.');
  if (!(doc.formatVersion >= 1) || doc.formatVersion > FORMAT_VERSION) fail('newer', 'That backup was made by a newer version of the website. Reload the page (to update), then try again.');
  const cols = {};
  for (const name of Object.keys(COLLS)) {
    const list = doc.collections && doc.collections[name];
    if (list === undefined) { cols[name] = []; continue; }
    if (!Array.isArray(list)) fail('damaged', 'That backup looks damaged, so nothing was changed.');
    cols[name] = list.filter((d) => d && typeof d === 'object' && typeof d.id === 'string' && d.id);
  }
  const media = [...zip.entries.keys()].filter((n) => n.startsWith('media/') && /^media\/[A-Za-z0-9._-]+$/.test(n)).map((n) => n.slice(6));
  const counts = countsOf(cols, media.length);
  return {
    kind: 'web', createdAt: doc.createdAt || Date.now(), counts,
    plan: { cols, media: media.map((id) => ({ id, entry: 'media/' + id })), prefs: doc.prefs || {}, zip },
  };
}

// ---------- the phone app's backup ----------
let sqlPromise = null;
/** sql.js (vendored js/vendor/sql-wasm.{js,wasm}), loaded only for app imports. */
function loadSql() {
  if (sqlPromise) return sqlPromise;
  const base = new URL('../vendor/', import.meta.url).href;
  sqlPromise = new Promise((resolve, reject) => {
    if (window.initSqlJs) { resolve(window.initSqlJs); return; }
    const s = document.createElement('script');
    s.src = base + 'sql-wasm.js';
    s.onload = () => (window.initSqlJs ? resolve(window.initSqlJs) : reject(new Error('sql.js missing')));
    s.onerror = () => reject(new Error('sql.js failed to load'));
    document.head.append(s);
  }).then((init) => init({ locateFile: (f) => base + f }));
  sqlPromise.catch(() => { sqlPromise = null; });
  return sqlPromise;
}

const J = (s, def) => { if (s === null || s === undefined || s === '') return def; try { const v = JSON.parse(s); return v ?? def; } catch (e) { return def; } };
const B = (v) => !!Number(v);
const N = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function inspectApp(zip, onProgress) {
  let manifest;
  try { manifest = JSON.parse(await zip.text('manifest.json')); } catch (e) { if (e && e.code) throw e; fail('damaged', 'That backup looks damaged, so nothing was changed.'); }
  if (!manifest || manifest.format !== APP_FORMAT) fail('not_backup', 'That zip isn’t an Em&m Blog backup. Nothing was changed.');
  if (manifest.formatVersion > APP_FORMAT_VERSION) fail('newer', 'That phone backup is newer than this website understands yet. Nothing was changed.');
  onProgress(0.1, 'Opening the backup…');
  const SQL = await loadSql().catch(() => fail('offline', 'Couldn’t load the backup reader. Check your internet connection, then try again.'));
  const dbBytes = await zip.bytes('emm.db');
  let db;
  try { db = new SQL.Database(dbBytes); } catch (e) { fail('damaged', 'That backup’s database looks damaged, so nothing was changed.'); }
  try {
    const ver = (db.exec('PRAGMA user_version')[0] || { values: [[0]] }).values[0][0];
    if (ver > APP_SCHEMA_MAX) fail('newer', 'That phone backup is from a newer app than this website understands. Nothing was changed.');
    onProgress(0.3, 'Reading your things…');
    return { kind: 'app', createdAt: manifest.createdAt || Date.now(), schemaVersion: ver, ...mapApp(db, zip) };
  } finally { db.close(); }
}

/** Every row of a table as objects ([] if the table doesn't exist in this older backup). */
function rows(db, table) {
  try {
    const exists = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
    if (!exists.length) return [];
    const res = db.exec(`SELECT * FROM ${table}`);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
  } catch (e) { return []; }
}

function mapApp(db, zip) {
  const has = (name) => !!name && zip.entries.has('media/' + name);
  const media = new Set();
  const useFile = (...names) => { for (const n of names) if (n && has(n)) { media.add(n); return n; } return null; };

  const kvRows = rows(db, 'kv');
  const kvMap = new Map(kvRows.map((r) => [r.key, r.value]));
  const cols = Object.fromEntries(Object.keys(COLLS).map((n) => [n, []]));

  cols.boards = rows(db, 'boards').map((r) => ({ id: r.id, name: r.name || 'Board', emoji: r.emoji || '🌸', look: r.look || 'pink', createdAt: N(r.created_at) || Date.now(), sort: N(r.sort) || 0 }));

  cols.posts = rows(db, 'posts').map((r) => {
    const d = { id: r.id, kind: r.kind, text: r.text || '', tint: N(r.tint) || 0, boardId: r.board_id || null, favorite: B(r.favorite), pinned: B(r.pinned),
      createdAt: N(r.created_at) || Date.now(), updatedAt: N(r.updated_at) || N(r.created_at) || Date.now(), w: N(r.width) || 0, h: N(r.height) || 0 };
    if (r.kind !== 'thought') {
      const asset = r.kind === 'video' ? useFile(r.media_file) : useFile(r.media_file, r.thumb_file);
      if (asset) d.assetId = asset;
      if (r.kind === 'video') { const still = useFile(r.thumb_file); if (still) d.posterId = still; }
      if (r.rendered_file && r.rendered_file !== r.media_file) {
        const rend = useFile(r.rendered_file, r.rendered_thumb_file);
        if (rend) { d.renderedId = rend; d.rw = N(r.rendered_width) || d.w; d.rh = N(r.rendered_height) || d.h; }
      }
      if (r.kind === 'collage' && !d.assetId && d.renderedId) d.assetId = d.renderedId;
    }
    const edit = J(r.edit_json, null);
    if (edit) d.appEdit = edit; // the phone editor's project; the web shows the flattened render instead
    return d;
  });

  const diaryFavs = new Set(J(kvMap.get('diary_favorites'), []));
  cols.diary = rows(db, 'diary_entries').map((r) => {
    const photos = J(r.photos_json, []);
    const photoIds = [];
    for (const p of Array.isArray(photos) ? photos : []) {
      const f = typeof p === 'string' ? useFile(p) : p && useFile(p.f, p.t);
      if (f) photoIds.push(f);
    }
    return { id: r.id, date: r.date, mood: r.mood || null, weather: r.weather || null, title: r.title || '', body: r.body || '', photoIds,
      tags: J(r.tags_json, []), favorite: diaryFavs.has(r.id), createdAt: N(r.created_at) || Date.now(), updatedAt: N(r.updated_at) || Date.now() };
  });

  cols.recipes = rows(db, 'recipes').map((r) => {
    const [hero, thumb] = String(r.photo_file || '').split('|');
    const photoId = useFile(hero, thumb);
    return { id: r.id, title: r.title || '', emoji: r.emoji || '🍰', photoId: photoId || null, servings: N(r.servings), prepMin: N(r.prep_min), cookMin: N(r.cook_min),
      ingredients: (J(r.ingredients_json, []) || []).map((i) => ({ ...i, checked: B(i.checked) })), steps: J(r.steps_json, []), notes: r.notes || '', tags: J(r.tags_json, []), favorite: B(r.favorite),
      createdAt: N(r.created_at) || Date.now(), updatedAt: N(r.updated_at) || Date.now() };
  });

  const itemsByList = new Map();
  for (const it of rows(db, 'list_items')) {
    const [name, extraRaw] = String(it.text || '').split('\u001F');
    const x = J(extraRaw, {});
    const item = { id: it.id, text: name || '', qty: it.qty || null, checked: B(it.checked), sort: N(it.sort) ?? N(it.created_at) ?? 0, link: x.url || '', price: x.price || '' };
    if (x.note) item.note = x.note;
    if (x.need) item.need = x.need;
    if (Array.isArray(x.for) && x.for.length) item.for = x.for;
    if (x.aisle) item.aisle = x.aisle;
    if (!itemsByList.has(it.list_id)) itemsByList.set(it.list_id, []);
    itemsByList.get(it.list_id).push(item);
  }
  cols.lists = rows(db, 'lists').map((r) => {
    const [sw, sub] = String(r.color || '').split('|');
    const n = parseInt(sw, 10);
    const items = (itemsByList.get(r.id) || []).sort((a, b) => a.sort - b.sort);
    return { id: r.id, title: r.title || '', emoji: r.emoji || '📝', kind: sub === 'bucket' ? 'bucket' : r.kind || 'todo',
      color: LIST_COLORS[((Number.isFinite(n) ? n : 0) % LIST_COLORS.length + LIST_COLORS.length) % LIST_COLORS.length],
      items, createdAt: N(r.created_at) || Date.now(), updatedAt: N(r.updated_at) || Date.now(), sort: N(r.sort) || 0 };
  });

  cols.countdowns = rows(db, 'countdowns').map((r) => {
    const [date, flag] = String(r.date || '').split('/');
    return { id: r.id, title: r.title || '', emoji: r.emoji || '🎉', date, yearly: flag === 'yearly', createdAt: N(r.created_at) || Date.now() };
  });

  cols.routines = rows(db, 'routines').map((r) => ({ id: r.id, name: r.name || '', kind: r.kind || 'custom', emoji: r.emoji || null, enabled: B(r.enabled),
    config: J(r.config_json, null), sort: N(r.sort) || 0, createdAt: N(r.created_at) || Date.now() }));
  cols.tasks = rows(db, 'tasks').map((r) => ({ id: r.id, title: r.title || '', notes: r.notes || '', emoji: r.emoji || null, area: r.area || null,
    dueDate: r.due_date || null, dueTime: r.due_time || null, repeat: J(r.repeat_json, null), routineId: r.routine_id || null,
    sort: N(r.sort) || 0, createdAt: N(r.created_at) || Date.now(), updatedAt: N(r.updated_at) || Date.now(), archived: B(r.archived),
    reminders: J(r.reminders_json, []) || [] }));
  // v5 calendar events (older app backups have no table: rows() gives [])
  cols.events = rows(db, 'events').map((r) => ({ id: r.id, title: r.title || '', emoji: r.emoji || null, date: r.date, allDay: B(r.all_day) || !r.start_time,
    start: B(r.all_day) ? null : r.start_time || null, end: B(r.all_day) ? null : r.end_time || null, location: r.location || '', notes: r.notes || '',
    repeat: J(r.repeat_json, null), color: N(r.color) || 0, reminders: J(r.reminders_json, []) || [], createdAt: N(r.created_at) || Date.now(), updatedAt: N(r.updated_at) || Date.now() }));
  cols.taskDone = rows(db, 'task_done').map((r) => ({ id: `${r.task_id}|${r.date}`, taskId: r.task_id, date: r.date, doneAt: N(r.done_at) || Date.now(), skipped: B(r.skipped) }));
  cols.habits = rows(db, 'habits').map((r) => ({ id: r.id, title: r.title || '', emoji: r.emoji || null, species: r.species || 'tulip',
    schedule: J(r.schedule_json, { k: 'daily' }), reminder: r.reminder || null, sort: N(r.sort) || 0, createdAt: N(r.created_at) || Date.now(),
    archived: B(r.archived), revivedCount: N(r.revived_count) || 0 }));
  cols.habitChecks = rows(db, 'habit_checks').map((r) => ({ id: `${r.habit_id}|${r.date}`, habitId: r.habit_id, date: r.date, createdAt: N(r.created_at) || Date.now() }));
  cols.gardenUnlocks = rows(db, 'garden_unlocks').map((r) => ({ id: r.key, unlockedAt: N(r.unlocked_at) || Date.now() }));

  // Small settings the website understands. JSON text values become objects (e.g. grocery_aisle_numbers).
  const prefsOut = {};
  for (const [key, value] of kvMap) {
    if (key === 'theme_mode') { if (value === 'dark' || value === 'light') prefsOut.mode = value; continue; }
    if (key === 'accent_look') { if (value) prefsOut.accent = value; continue; }
    if (key === 'diary_font' && value) { prefsOut['diary-font'] = value; }
    if (/^grocery_/.test(key) || key === 'share_name' || key === 'lists_tab_segment') {
      let v = value;
      if (typeof v === 'string' && /^[[{"]/.test(v.trim())) { try { v = JSON.parse(v); } catch (e) { /* keep text */ } }
      cols.kv.push({ id: key, value: v });
    }
  }

  const list = [...media].map((name) => ({ id: name, entry: 'media/' + name, type: mimeOf(name) }));
  return { counts: countsOf(cols, list.length), plan: { cols, media: list, prefs: prefsOut, zip } };
}

// ---------- apply ----------
/**
 * Replace everything in this browser with a plan from inspect(). Media go in first (so a failure there leaves
 * her current data untouched), then the documents are swapped, then old files nobody points at are removed.
 */
export async function applyPlan(plan, onProgress = () => {}) {
  if (!state.local) fail('unsupported', 'Restoring is for the website version.');
  const { cols, media, zip } = plan;
  const before = new Set(blobIds());
  const keep = new Set();
  let i = 0;
  for (const m of media) {
    const blob = await zip.blob(m.entry, m.type || mimeOf(m.id));
    await putBlobAs(m.id, blob, m.type || blob.type || mimeOf(m.id));
    keep.add(m.id);
    onProgress(0.05 + 0.75 * (++i / Math.max(1, media.length)), 'Bringing back photos…');
  }
  onProgress(0.82, 'Putting everything back…');
  const names = Object.keys(COLLS);
  await clearAll(names);
  const ops = [];
  for (const n of names) for (const d of cols[n] || []) { const { id, ...rest } = d; ops.push({ c: n, id, d: rest }); }
  for (let k = 0; k < ops.length; k += 400) {
    await batch(ops.slice(k, k + 400));
    onProgress(0.82 + 0.15 * Math.min(1, (k + 400) / Math.max(1, ops.length)), 'Putting everything back…');
  }
  for (const id of before) if (!keep.has(id)) await deleteAsset(id);
  for (const [k, v] of Object.entries(plan.prefs || {})) if (PREF_KEYS.includes(k)) prefs.set(k, v);
  onProgress(1, 'Done');
  reloadOtherTabs();
}
