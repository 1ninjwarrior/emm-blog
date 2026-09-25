// Em&m Blog web: grocery core. Lazy-loaded (it pulls in the ~2,000-item catalog), shared by the aisle walk,
// the shopping-list detail, shopping mode and "add to shopping list" from recipes.
//
// Items live inside the list doc (web shape): {id, text, qty, checked, link, price, sort, note?, need?, for?: string[], aisle?}.
// `aisle` is her manual override (an aisle id); otherwise the catalog decides (aisleOf(text)).
// Synced settings live in the `kv` collection with the app's key names (values stored as JSON values, not strings):
//   grocery_history {key: {name,n,a,last,iv,price,qty}}, grocery_aisle_order [ids], grocery_aisle_order:<listId>,
//   grocery_aisle_numbers {aisle: "7"}, grocery_walk_draft / grocery_walk_draft:<listId> (walk draft), grocery_staples.
import { loaded, kv, byId, add, patchSoon, flushNow, newId } from '../store.js';
import * as catalog from '../app/grocery/catalog.js';
import * as parse from '../app/grocery/parse.js';
import * as order from '../app/grocery/order.js';
import * as hist from '../app/grocery/historyModel.js';
import * as walkModel from '../app/grocery/walkModel.js';

export { catalog, parse, order, hist, walkModel };

/** Resolves once the synced settings + lists are loaded. */
export const ready = Promise.all([loaded('kv'), loaded('lists')]);

// ---------- aisle helpers ----------
export const aisleInfo = (id) => catalog.aisleInfo(id);
export const itemAisle = (it) => (it.aisle && catalog.isAisleId(it.aisle) ? it.aisle : catalog.aisleOf(it.text || ''));
export const itemEmoji = (it) => catalog.emojiOf(it.text || '', it.aisle || null);

// ---------- prefs (kv) ----------
/** kv value as JSON (tolerates a JSON string, e.g. from an older import). */
export function kvJSON(key) {
  const v = kv.get(key);
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } }
  return v;
}
export function getAisleOrder(listId = null) {
  const own = listId ? kvJSON('grocery_aisle_order:' + listId) : null;
  const all = kvJSON('grocery_aisle_order');
  return order.orderAisles(Array.isArray(own) ? own : Array.isArray(all) ? all : null);
}
export function hasOwnOrder(listId) { return !!(listId && Array.isArray(kvJSON('grocery_aisle_order:' + listId))); }
export function setAisleOrder(next, listId = null) { return kv.set(listId ? 'grocery_aisle_order:' + listId : 'grocery_aisle_order', [...next]); }
export function resetAisleOrder(listId = null) { return kv.set(listId ? 'grocery_aisle_order:' + listId : 'grocery_aisle_order', null); }
export function getAisleNumbers() { const v = kvJSON('grocery_aisle_numbers'); return v && typeof v === 'object' ? v : {}; }
export function setAisleNumber(aisle, raw) {
  const nums = { ...getAisleNumbers() };
  const t = order.cleanAisleNumber(raw);
  if (t) nums[aisle] = t; else delete nums[aisle];
  return kv.set('grocery_aisle_numbers', nums);
}

// ---------- history ----------
export function getHistory() { const v = kvJSON('grocery_history'); return v && typeof v === 'object' ? v : {}; }
function saveHistory(h) { return kv.soon('grocery_history', h, 400); }
export function noteAdded(list) {
  let h = getHistory();
  for (const x of list) h = hist.recordAdd(h, x.key, x.name);
  saveHistory(h);
}
export function notePurchased(list, now = Date.now()) {
  let h = getHistory();
  for (const x of list) h = hist.recordPurchase(h, x.key, x.name, now, x.price || null, x.qty || null);
  saveHistory(h);
}
export const boost = (item) => hist.boostOf(getHistory()[item.id]);

// ---------- list writes ----------
const union = (a, b) => { const out = [...(a || [])]; for (const x of b || []) if (!out.includes(x)) out.push(x); return out.length ? out : null; };
const clone = (its) => its.map((i) => ({ ...i }));
function writeItems(listId, itemsArr, ms = 30) {
  return patchSoon('lists', listId, { items: itemsArr, updatedAt: Date.now() }, ms);
}
export const newGroceryItem = (f, sort) => {
  const it = { id: newId(), text: f.name, qty: f.qty || null, checked: false, link: '', price: f.price || '', sort };
  if (f.note) it.note = f.note;
  if (f.need) it.need = f.need;
  if (f.recipes && f.recipes.length) it.for = f.recipes;
  if (f.aisle) it.aisle = f.aisle;
  return it;
};

/**
 * Merge incoming groceries into a list's items by catalog identity (the app's upsertGroceries):
 * unchecked match -> qty merges ('bump' = +1, 'sum' = amounts add) + notes/recipes merge; checked match -> back unchecked
 * with the new qty; otherwise a new row. Nothing new is ever pre-ticked. Returns {items, added, bumped}.
 */
export function mergeInto(current, incoming, mode = 'bump') {
  const its = clone(current || []);
  const open = new Map(), done = new Map();
  for (const it of its) {
    const k = catalog.itemKey(it.text || '');
    const t = it.checked ? done : open;
    if (!t.has(k)) t.set(k, it);
  }
  const fresh = new Map();
  const res = { added: [], bumped: [] };
  for (const inc of incoming) {
    const name = String(inc.name || '').trim();
    if (!name) continue;
    const k = catalog.itemKey(name);
    const w = open.get(k) || done.get(k);
    if (w) {
      const was = !!w.checked;
      w.checked = false;
      w.qty = was ? inc.qty || null : parse.mergeQty(w.qty || null, inc.qty || null, mode);
      if (!w.note && inc.note) w.note = inc.note;
      if (!w.price && inc.price) w.price = inc.price;
      const need = was ? inc.need || null : parse.mergeQty(w.need || null, inc.need || null, 'sum');
      if (need) w.need = need; else delete w.need;
      const rec = was ? inc.recipes || null : union(w.for, inc.recipes);
      if (rec) w.for = rec; else delete w.for;
      if (!w.aisle && inc.aisle) w.aisle = inc.aisle;
      if (was) { done.delete(k); open.set(k, w); }
      res.bumped.push({ name: w.text, qty: w.qty });
      continue;
    }
    const p = fresh.get(k);
    if (p) {
      p.qty = parse.mergeQty(p.qty || null, inc.qty || null, mode);
      p.need = parse.mergeQty(p.need || null, inc.need || null, 'sum');
      p.recipes = union(p.recipes, inc.recipes);
      p.note = p.note || inc.note;
      p.aisle = p.aisle || inc.aisle;
      continue;
    }
    fresh.set(k, { ...inc, name });
  }
  let sort = Date.now();
  for (const f of fresh.values()) { its.push(newGroceryItem(f, sort++)); res.added.push({ name: f.name, qty: f.qty || null }); }
  return { items: its, ...res };
}

export async function upsertGroceries(listId, incoming, mode = 'bump') {
  await flushNow('lists', listId);
  const l = byId('lists', listId);
  if (!l) return { added: [], bumped: [] };
  const r = mergeInto(l.items || [], incoming, mode);
  writeItems(listId, r.items);
  noteAdded(incoming.filter((i) => String(i.name || '').trim()).map((i) => ({ key: catalog.itemKey(i.name), name: String(i.name).trim() })));
  return r;
}

/** Smart add bar: "milk, 2 lb chicken, 3 avocados". */
export function typedToIncoming(raw) {
  return parse.splitMulti(raw).map((p) => { const g = parse.parseGroceryInput(p); return { name: g.name, qty: g.qty, note: g.note, price: g.price }; }).filter((x) => x.name);
}
export const addTyped = (listId, raw) => upsertGroceries(listId, typedToIncoming(raw), 'bump');

/** Toast text for an add (null = quiet). */
export function addToastText(r) {
  const n = r.added.length + r.bumped.length;
  if (n > 1) return `Added ${n} things ♡`;
  const b = r.bumped[0];
  if (!b) return null;
  if (!b.qty) return `+1 ${b.name}`;
  return /^\d+$/.test(b.qty) ? `+1 ${b.name} · ×${b.qty}` : `${b.name} → ${b.qty}`;
}

/** "Done shopping": checked items -> history, then removed. Resolves {count, undo}. */
export async function finishShopping(listId) {
  await flushNow('lists', listId);
  const l = byId('lists', listId);
  const before = clone((l && l.items) || []);
  const bought = before.filter((i) => i.checked);
  if (!bought.length) return { count: 0, undo: () => {} };
  const snap = getHistory();
  notePurchased(bought.map((i) => ({ key: catalog.itemKey(i.text), name: i.text, price: i.price || null, qty: i.qty || null })));
  writeItems(listId, before.filter((i) => !i.checked));
  return {
    count: bought.length,
    undo: () => { writeItems(listId, before); kv.set('grocery_history', snap); },
  };
}

/** Recipe ingredient lines -> incoming groceries (catalog names; cooking amounts become `need`). */
export function linesToIncoming(lines, tag = null) {
  const out = [];
  for (const line of lines) {
    const g = parse.ingredientToGrocery(String(line || ''));
    if (g) out.push({ name: g.name, qty: g.qty, need: g.need, recipes: tag ? [tag] : null });
  }
  return out;
}

// ---------- walk drafts ----------
export const draftKey = (target) => (target === 'new' ? 'grocery_walk_draft' : 'grocery_walk_draft:' + target);
export function getDraft(target) {
  const d = kvJSON(draftKey(target));
  return d && typeof d === 'object' && d.picks ? d : null;
}

/** New shopping list from the walk. Resolves the list id. */
export async function createListFromDraft(picks, { title, emoji, color }) {
  const incoming = walkModel.draftToIncoming(picks, getAisleOrder());
  const now = Date.now();
  const r = mergeInto([], incoming.map((i) => ({ name: i.name, qty: i.qty, note: i.note, aisle: i.aisle })), 'sum');
  const id = await add('lists', { title, emoji, kind: 'shopping', color, items: r.items, createdAt: now, updatedAt: now, sort: now });
  noteAdded(incoming.map((i) => ({ key: catalog.itemKey(i.name), name: i.name })));
  return id;
}

/** "Add by aisle" save: changed amounts/notes updated, deselected pre-filled rows removed, new picks merged. */
export async function saveDraftToList(listId, picks, prefill) {
  await flushNow('lists', listId);
  const l = byId('lists', listId);
  if (!l) throw new Error('list gone');
  const plan = walkModel.planSave(picks, prefill, getAisleOrder(listId));
  let its = clone(l.items || []);
  const rm = new Set(plan.remove);
  its = its.filter((i) => !rm.has(i.id));
  for (const u of plan.update) {
    const x = its.find((i) => i.id === u.itemId);
    if (!x) continue;
    x.qty = u.qty || null;
    if (u.note) x.note = u.note; else delete x.note;
  }
  const r = mergeInto(its, plan.add.map((i) => ({ name: i.name, qty: i.qty, note: i.note, aisle: i.aisle })), 'sum');
  writeItems(listId, r.items);
  noteAdded(plan.add.map((i) => ({ key: catalog.itemKey(i.name), name: i.name })));
  return plan;
}

/** Draft pre-filled from a list's unchecked items (Add by aisle). */
export function draftFromList(listId) {
  const l = byId('lists', listId);
  const picks = {}, prefill = {};
  let t = 1;
  for (const it of (l && l.items) || []) {
    if (it.checked) continue;
    const a = itemAisle(it);
    const p = walkModel.pickFromRow(it.text, it.qty || null, it.note || null, a, t++);
    if (picks[p.key]) continue;
    picks[p.key] = p;
    prefill[p.key] = { itemId: it.id, qty: it.qty || null, note: it.note || null };
  }
  return { picks, prefill };
}
