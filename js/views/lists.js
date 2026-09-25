// Em&m Blog: Lists tab host (Recipes · Lists · Special days) + the Lists section itself.
//
// lists doc: {title, emoji, kind: shopping|todo|wishlist|packing|bucket|other, color,
//             items:[{id,text,qty,checked,link,price,sort, note?, need?, for?:[recipe tags], aisle?}], createdAt, updatedAt, sort}
// Items live INSIDE the list doc; rapid item edits go through patchSoon (optimistic + coalesced).
// Shopping lists get the grocery superpowers from js/grocery/* (catalog aisles in her store order, smart add bar,
// Start shopping, Add by aisle). That code + the catalog load lazily, only when a shopping list opens.
import { state, ready, watch, add, set, remove, patchSoon, flushNow, prefs, newId, items, byId, errText, kv, loaded } from '../store.js';
import { $, esc, h, sheet, confirmDlg, toast, confetti, reconcile, emptyHTML, icon, choose, clamp, reducedMotion, cornerHTML } from '../ui.js';
import { copyText, saveCanvas, makeCanvas, roundRect, drawText, tokens, dottedBg, tape, wrapLines } from '../share.js';

// ---------- constants ----------
export const KINDS = [
  { id: 'shopping', emoji: '🛒', label: 'Shopping' },
  { id: 'todo', emoji: '✅', label: 'To-do' },
  { id: 'wishlist', emoji: '🎁', label: 'Wishlist' },
  { id: 'packing', emoji: '🧳', label: 'Packing' },
  { id: 'bucket', emoji: '🌈', label: 'Bucket list' },
  { id: 'other', emoji: '📝', label: 'Other' },
];
const kindOf = (id) => KINDS.find((k) => k.id === id) || KINDS[5];
export const LIST_COLORS = ['#FFC2D8', '#FFD3B0', '#FFE58A', '#BDEBC8', '#C4E4FF', '#DCCBFF'];
const LIST_EMOJI = ['🛒', '✅', '🎁', '🧳', '🌈', '📝', '💕', '🍓', '🏡', '✨', '🎀', '🌸', '📚', '🎂', '🧺', '🌙'];

const TEMPLATES = [
  { id: 'groceries', emoji: '🛒', title: 'Weekly groceries', kind: 'shopping', color: '#BDEBC8', items: ['milk', 'eggs', 'bread', 'bananas', 'spinach', 'chicken', 'pasta', 'cheese', 'yogurt', 'coffee'] },
  { id: 'weekend', emoji: '✅', title: 'Weekend to-do', kind: 'todo', color: '#FFE58A', items: ['laundry', 'water the plants', 'grocery run', 'call mom', 'tidy the desk', 'movie night ♡'] },
  { id: 'packing', emoji: '🧳', title: 'Trip packing', kind: 'packing', color: '#C4E4FF', items: ['ID / passport', 'phone charger', 'toothbrush', 'pajamas', 'comfy shoes', 'sunscreen', 'snacks for the road', 'cute outfit'] },
  { id: 'dates', emoji: '💕', title: 'Date ideas', kind: 'bucket', color: '#FFC2D8', items: ['picnic in the park', 'sunset walk', 'bake cookies together', 'stargazing', 'thrift store date', 'museum day', 'cook a fancy dinner'] },
  { id: 'birthday', emoji: '🎁', title: 'Birthday wishlist', kind: 'wishlist', color: '#DCCBFF', items: ['fluffy slippers', 'a new book', 'flowers', 'cute mug'] },
  { id: 'blank', emoji: '📝', title: '', kind: 'todo', color: '#FFD3B0', items: [] },
];

// Aisle grouping for shopping lists (keyword dictionary, first match wins).
const AISLES = [
  ['produce', '🥬 Produce', 'apple banana berry berries strawberr blueberr raspberr grape lemon lime orange avocado tomato potato onion garlic ginger carrot celery lettuce spinach kale cucumber pepper zucchini broccoli cauliflower mushroom herb basil cilantro parsley mint fruit veg salad peach pear mango pineapple melon cherry cherries corn squash pumpkin scallion shallot leek cabbage asparagus bean sprout'],
  ['dairy', '🧀 Dairy & eggs', 'milk cheese butter yogurt yoghurt cream egg eggs creme sour cream cottage mozzarella parmesan cheddar feta ricotta half-and-half kefir'],
  ['bakery', '🥐 Bakery', 'bread bagel croissant bun buns roll rolls tortilla pita baguette muffin cake loaf brioche sourdough'],
  ['meat', '🍗 Meat & fish', 'chicken beef pork turkey bacon sausage ham steak mince ground salmon tuna fish shrimp prawn lamb meat tofu tempeh'],
  ['frozen', '🧊 Frozen', 'frozen ice cream ice pizza popsicle peas'],
  ['drinks', '🧃 Drinks', 'water juice soda coffee tea wine beer kombucha lemonade sparkling drink matcha'],
  ['snacks', '🍪 Snacks', 'chips crisps cookie cookies chocolate candy popcorn cracker crackers pretzel nuts granola bar snack gummy'],
  ['pantry', '🥫 Pantry', 'rice pasta noodle flour sugar salt oil olive vinegar sauce soy honey jam peanut cereal oats oat spice cinnamon vanilla baking soda powder yeast broth stock can canned beans lentil chickpea tomato paste ketchup mustard mayo syrup maple cocoa'],
  ['household', '🧽 Household', 'paper towel towels toilet tissue detergent soap dish sponge trash bag bags foil wrap cleaner bleach candle battery batteries lightbulb'],
  ['care', '🧴 Personal care', 'shampoo conditioner toothpaste toothbrush deodorant lotion razor floss skincare sunscreen makeup cotton pads vitamins'],
];
const AISLE_RE = AISLES.map(([id, label, words]) => ({ id, label, re: new RegExp('\\b(' + words.split(' ').map((w) => w.replace(/[-]/g, '\\-')).join('|') + ')', 'i') }));
export function aisleOf(text) {
  const t = String(text || '').toLowerCase();
  for (const a of AISLE_RE) if (a.re.test(t)) return a.id;
  return 'other';
}
const aisleLabel = (id) => (AISLE_RE.find((a) => a.id === id) || { label: '🧺 Other' }).label;
const AISLE_ORDER = AISLE_RE.map((a) => a.id).concat('other');

/** "2x milk" / "milk x2" / "milk ×2" -> {text, qty} */
export function parseQty(raw) {
  const s = raw.trim();
  let m = s.match(/^(\d{1,3})\s*[x×]\s+(.+)$/i);
  if (m) return { text: m[2].trim(), qty: m[1] };
  m = s.match(/^(.+?)\s+[x×]\s*(\d{1,3})$/i);
  if (m) return { text: m[1].trim(), qty: m[2] };
  return { text: s, qty: null };
}

const normText = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
export const newItem = (text, qty = null, sort = Date.now()) => ({ id: newId(), text, qty, checked: false, link: '', price: '', sort });

// ---------- grocery (lazy) ----------
let G = null;
let gLoading = null;
/** Load the grocery core (catalog etc.) once. */
export function grocery() {
  if (!gLoading) gLoading = import('../grocery/core.js').then(async (m) => { await m.ready; G = m; return m; });
  return gLoading;
}

// ---------- tab host ----------
let root, host = {};
let curSeg = null;
const SEGS = [
  { id: 'recipes', label: '🧁 Recipes', hash: '#recipes' },
  { id: 'lists', label: '📝 Lists', hash: '#mylists' },
  { id: 'days', label: '🎂 Special days', hash: '#specialdays' },
];
const secMounted = {};

export function mount(el) {
  root = el;
  el.innerHTML = `<header class="phead">${cornerHTML()}
      <div><h1>Lists</h1><p class="sub">recipes, to-dos &amp; days we count down to ♡</p></div>
    </header>
    <div class="seg lists-seg" role="group" aria-label="Section">${SEGS.map((s) => `<button type="button" id="seg-${s.id}" data-s="${s.id}" aria-pressed="false">${s.label}</button>`).join('')}</div>
    ${SEGS.map((s) => `<div class="lsec" data-sec="${s.id}" hidden></div>`).join('')}`;
  el.querySelector('.lists-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (b) show(b.dataset.s);
  });
  for (const s of SEGS) host[s.id] = el.querySelector(`[data-sec="${s.id}"]`);
}

export async function show(sub) {
  const seg = SEGS.some((s) => s.id === sub) ? sub : prefs.get('lists-seg', 'recipes');
  curSeg = SEGS.some((s) => s.id === seg) ? seg : 'recipes';
  prefs.set('lists-seg', curSeg);
  for (const s of SEGS) {
    host[s.id].hidden = s.id !== curSeg;
    root.querySelector('#seg-' + s.id).setAttribute('aria-pressed', String(s.id === curSeg));
  }
  const hash = SEGS.find((s) => s.id === curSeg).hash;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  if (!secMounted[curSeg]) {
    secMounted[curSeg] = true;
    if (curSeg === 'lists') mountListsSection(host.lists);
    else if (curSeg === 'recipes') (await import('./recipes.js')).mountSection(host.recipes);
    else (await import('./countdowns.js')).mountSection(host.days);
  }
}
export function hide() {}

// ---------- Lists section ----------
let sec = null;
let detail = null; // {id, render}
let watching = false;

function ensureWatch() {
  if (watching) return;
  watching = true;
  watch('lists', () => {
    if (sec) renderCards();
    if (detail) detail.render();
  });
  ready.then(() => { if (sec) renderCards(); });
}

function mountListsSection(el) {
  sec = el;
  el.innerHTML = `<div class="walk-entry" id="walk-entry" hidden></div>
    <div class="lists-bar">
      <p class="lists-hint muted">tap a list to open it ✨</p>
      <button type="button" class="btn soft" id="lists-new">${icon.plus} New list</button>
    </div>
    <div class="list-cards" id="list-cards"></div>
    <div id="lists-empty"></div>`;
  el.querySelector('#lists-new').onclick = () => openNewList();
  const we = el.querySelector('#walk-entry');
  we.addEventListener('click', async (e) => {
    if (e.target.closest('#walk-fresh')) {
      let d = kv.get('grocery_walk_draft');
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
      const n = d && d.picks ? Object.keys(d.picks).length : 0;
      const ok = await confirmDlg({ title: 'Start a fresh list?', message: `Your ${n} picked thing${n === 1 ? '' : 's'} will be cleared.`, confirmLabel: 'Start fresh', cancelLabel: 'Keep them', emoji: '🧺' });
      if (!ok) return;
      await kv.set('grocery_walk_draft', null);
      toast('Fresh cart ♡', { emoji: '🛒', duration: 1200 });
      return;
    }
    if (e.target.closest('#walk-go')) location.hash = 'grocery';
  });
  watch('kv', renderWalkEntry);
  el.querySelector('#list-cards').addEventListener('click', (e) => {
    const c = e.target.closest('[data-key]');
    if (c) openList(c.dataset.key);
  });
  ensureWatch();
  renderCards();
}

function renderWalkEntry() {
  const we = sec && sec.querySelector('#walk-entry');
  if (!we) return;
  we.hidden = !state.canWrite;
  let d = kv.get('grocery_walk_draft');
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
  const n = d && d.picks ? Object.keys(d.picks).length : 0;
  const html = `<button type="button" class="card walk-card" id="walk-go" aria-label="${n ? `Resume grocery list, ${n} items` : 'New grocery list, aisle by aisle'}">
      <span class="walk-blob" aria-hidden="true">🛒</span>
      <span class="walk-txt"><b>${n ? 'Where you left off' : 'New grocery list'}</b><small>${n ? `${n} thing${n === 1 ? '' : 's'} picked so far` : 'walk the store aisle by aisle'}</small></span>
      <span class="walk-go">${n ? 'Resume' : 'Start'}</span></button>
    ${n ? `<button type="button" class="btn link small walk-fresh" id="walk-fresh">or start a fresh one</button>` : ''}`;
  if (we._html !== html) { we.innerHTML = html; we._html = html; }
}

function progress(l) {
  const it = l.items || [];
  const done = it.filter((i) => i.checked).length;
  return { done, total: it.length, pct: it.length ? done / it.length : 0 };
}

function sortedLists() {
  return [...items('lists')].sort((a, b) => (a.sort ?? a.createdAt) - (b.sort ?? b.createdAt));
}

function cardSig(l) { const p = progress(l); return [l.title, l.emoji, l.kind, l.color, p.done, p.total, (l.items || []).slice(0, 3).map((i) => i.text + i.checked).join('|')].join('~'); }

function cardNode(l) {
  const p = progress(l);
  const k = kindOf(l.kind);
  const preview = (l.items || []).filter((i) => !i.checked).slice(0, 3);
  const n = h(`<button type="button" class="list-card pressable" style="--lc:${esc(l.color || LIST_COLORS[0])}" aria-label="${esc(l.title || 'Untitled list')}, ${p.done} of ${p.total} done">
      <span class="lc-top"><span class="lc-emoji" aria-hidden="true">${esc(l.emoji || k.emoji)}</span>
        <span class="ring" style="--p:${Math.round(p.pct * 100)}" aria-hidden="true"><span>${p.total ? Math.round(p.pct * 100) + '%' : '·'}</span></span></span>
      <b class="lc-title">${esc(l.title || 'Untitled list')}</b>
      <span class="lc-meta">${esc(k.label)} · ${p.done}/${p.total} done</span>
      <span class="lc-preview">${preview.length ? preview.map((i) => `<span>○ ${esc(i.text)}</span>`).join('') : `<span class="muted">${p.total ? 'all done! ✨' : 'nothing here yet'}</span>`}</span>
      <span class="lc-bar" aria-hidden="true"><i style="width:${Math.round(p.pct * 100)}%"></i></span>
    </button>`);
  n._sig = cardSig(l);
  return n;
}

function renderCards() {
  if (!sec) return;
  const list = sortedLists();
  const wrap = sec.querySelector('#list-cards');
  sec.querySelector('#lists-new').hidden = !state.canWrite;
  reconcile(wrap, list, (l) => l.id, cardNode, (node, l) => (node._sig === cardSig(l) ? node : cardNode(l)));
  const empty = sec.querySelector('#lists-empty');
  const loaded = state.mode !== 'loading';
  empty.innerHTML = !list.length && loaded
    ? emptyHTML({ img: 'img/illustrations/empty-lists.png', title: 'No lists yet', text: state.canWrite ? 'Groceries, to-dos, wishlists, date ideas… start one from a cute template ♡' : 'Nothing here yet.', action: state.canWrite ? 'Start a list' : '', actionId: 'lists-empty-new' })
    : '';
  const b = empty.querySelector('#lists-empty-new');
  if (b) b.onclick = () => openNewList();
}

// ---------- new / edit list sheet ----------
export async function openNewList() {
  await ready;
  if (!state.canWrite) { toast('This is view-only for you ♡', { emoji: '👀' }); return; }
  listForm(null);
}

function listForm(l) {
  const editing = !!l;
  let v = { title: l?.title || '', emoji: l?.emoji || '📝', kind: l?.kind || 'todo', color: l?.color || LIST_COLORS[0], tpl: null };
  const s = sheet({
    title: editing ? 'Edit list' : 'New list ♡',
    body: `${editing ? '' : `<div class="field"><span class="lbl">Start from</span><div class="tpl-grid" id="list-tpls">${TEMPLATES.map((t) => `<button type="button" class="tpl" id="list-tpl-${t.id}" data-t="${t.id}" aria-pressed="false" style="--lc:${t.color}"><span class="e" aria-hidden="true">${t.emoji}</span>${esc(t.title || 'Blank')}<small>${t.items.length ? t.items.length + ' items' : 'empty'}</small></button>`).join('')}</div></div>`}
      <div class="field"><label class="lbl" for="list-title">Name</label><input class="txt" id="list-title" maxlength="60" placeholder="groceries, weekend plans…" autocomplete="off" value="${esc(v.title)}"></div>
      <div class="field"><span class="lbl" id="list-kind-lbl">Kind</span><div class="chips" id="list-kinds" role="group" aria-labelledby="list-kind-lbl">${KINDS.map((k) => `<button type="button" class="chip" id="list-kind-${k.id}" data-k="${k.id}" aria-pressed="false">${k.emoji} ${k.label}</button>`).join('')}</div></div>
      <div class="field"><span class="lbl" id="list-emoji-lbl">Emoji</span><div class="emoji-row" id="list-emojis" role="group" aria-labelledby="list-emoji-lbl">${LIST_EMOJI.map((e, i) => `<button type="button" id="list-emoji-${i}" data-e="${e}" aria-label="${e}" aria-pressed="false">${e}</button>`).join('')}</div></div>
      <div class="field"><span class="lbl" id="list-color-lbl">Color</span><div class="swatches" id="list-colors" role="group" aria-labelledby="list-color-lbl">${LIST_COLORS.map((c, i) => `<button type="button" class="sw-btn" id="list-color-${i}" data-c="${c}" aria-label="Color ${i + 1}" aria-pressed="false" style="background:${c}"></button>`).join('')}</div></div>
      <p class="err" id="list-err" hidden></p>`,
    foot: `${editing ? `<button type="button" class="btn link" id="list-del" style="color:var(--danger);margin-right:auto">Delete list</button>` : ''}<button type="button" class="btn soft" id="list-cancel">Cancel</button><button type="button" class="btn" id="list-save">${editing ? 'Save' : 'Create list'}</button>`,
  });
  const b = s.body;
  const paint = () => {
    b.querySelectorAll('[data-k]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === v.kind)));
    b.querySelectorAll('[data-e]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.e === v.emoji)));
    b.querySelectorAll('[data-c]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.c === v.color)));
    b.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.t === v.tpl)));
  };
  paint();
  b.addEventListener('click', (e) => {
    const t = e.target.closest('[data-t]'), k = e.target.closest('[data-k]'), em = e.target.closest('[data-e]'), c = e.target.closest('[data-c]');
    if (t) {
      const tp = TEMPLATES.find((x) => x.id === t.dataset.t);
      v = { ...v, tpl: tp.id, kind: tp.kind, emoji: tp.emoji, color: tp.color };
      const ti = b.querySelector('#list-title');
      if (tp.title || !ti.value || TEMPLATES.some((x) => x.title === ti.value)) ti.value = tp.title;
    }
    if (k) v.kind = k.dataset.k;
    if (em) v.emoji = em.dataset.e;
    if (c) v.color = c.dataset.c;
    if (t || k || em || c) paint();
  });
  const save = async () => {
    const title = b.querySelector('#list-title').value.trim();
    const err = b.querySelector('#list-err');
    if (!title) { err.textContent = 'Give your list a name ♡'; err.hidden = false; b.querySelector('#list-title').focus(); return; }
    const btn = s.foot.querySelector('#list-save');
    btn.disabled = true;
    try {
      const now = Date.now();
      if (editing) {
        await patchSoon('lists', l.id, { title, emoji: v.emoji, kind: v.kind, color: v.color, updatedAt: now }, 10);
        s.close('saved');
        toast('Saved ♡');
      } else {
        const tp = TEMPLATES.find((x) => x.id === v.tpl);
        const its = (tp ? tp.items : []).map((text, i) => newItem(text, null, now + i));
        const id = await add('lists', { title, emoji: v.emoji, kind: v.kind, color: v.color, items: its, createdAt: now, updatedAt: now, sort: now });
        s.close('saved');
        toast('List made ♡', { emoji: v.emoji });
        confetti({ count: 30 });
        setTimeout(() => openList(id, { focusAdd: true }), 240);
      }
    } catch (e) {
      err.textContent = errText(e); err.hidden = false; btn.disabled = false;
    }
  };
  s.foot.querySelector('#list-save').onclick = save;
  s.foot.querySelector('#list-cancel').onclick = () => s.close('cancel');
  b.querySelector('#list-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const del = s.foot.querySelector('#list-del');
  if (del) del.onclick = async () => { s.close('del'); if (detail && detail.sheet) detail.sheet.close('del'); deleteList(l); };
  if (!editing) setTimeout(() => b.querySelector('#list-title').focus(), 80);
}

async function deleteList(l) {
  const ok = await confirmDlg({ title: `Delete “${l.title || 'this list'}”?`, message: `${(l.items || []).length} items go with it.`, confirmLabel: 'Delete', destructive: true, emoji: '🗑️' });
  if (!ok) return;
  const { id, ...data } = byId('lists', l.id) || l;
  try {
    await remove('lists', id);
    toast('List deleted', { undo: () => set('lists', id, data).catch((e) => toast(errText(e))) });
  } catch (e) { toast(errText(e)); }
}

// ---------- list detail ----------
function mutate(id, fn, ms = 350) {
  const l = byId('lists', id);
  if (!l) return;
  const its = (l.items || []).map((i) => ({ ...i }));
  const out = fn(its) || its;
  return patchSoon('lists', id, { items: out, updatedAt: Date.now() }, ms).catch((e) => toast(errText(e)));
}

export function openList(id, { focusAdd = false } = {}) {
  const l0 = byId('lists', id);
  if (!l0) return;
  if (l0.kind === 'shopping' && !G) {
    grocery().then(() => openList(id, { focusAdd })).catch((e) => { console.error(e); toast('Couldn’t open the grocery helpers. Try again?'); });
    return;
  }
  const canEdit = state.canWrite;
  const shop = l0.kind === 'shopping' && !!G;
  const s = sheet({
    title: `${l0.emoji || '📝'} ${l0.title || 'Untitled list'}`,
    wide: true,
    className: 'list-sheet',
    body: `<div class="ld-head"><span class="ld-prog" id="ld-prog"></span><span class="lc-bar big" aria-hidden="true"><i id="ld-bar"></i></span></div>
      ${shop && canEdit ? `<div class="ld-shop-actions">
        <button type="button" class="btn" id="ld-shop">Start shopping 🛒</button>
        <button type="button" class="btn soft" id="ld-walk">${icon.map} Add by aisle</button>
        <button type="button" class="icon-btn soft" id="ld-order" aria-label="Store order and aisle numbers">${icon.filter}</button></div>` : ''}
      ${canEdit ? `<form class="add-bar" id="ld-add-form" autocomplete="off">
        <label class="sr-only" for="ld-add">Add an item</label>
        <input class="txt" id="ld-add" maxlength="140" placeholder="add something… (try “2x milk”)" enterkeyhint="done">
        <button type="submit" class="btn" id="ld-add-btn" aria-label="Add item">${icon.plus}</button></form>` : ''}
      <div class="ld-items" id="ld-items"></div>
      <div id="ld-empty"></div>
      <details class="ld-done" id="ld-done-wrap" ${prefs.get('list-done-open', '1') === '1' ? 'open' : ''}><summary id="ld-done-sum">Done</summary><div class="ld-rows" id="ld-done"></div></details>`,
    foot: `<button type="button" class="btn soft small" id="ld-copy">${icon.copy} Copy</button>
      <button type="button" class="btn soft small" id="ld-image">${icon.download} Save image</button>
      ${canEdit ? `<button type="button" class="btn soft small" id="ld-more">${icon.more} More</button>` : ''}`,
    onClose: () => { if (detail && detail.id === id) detail = null; flushNow('lists', id); },
  });
  const b = s.body;
  const itemsEl = b.querySelector('#ld-items'), doneEl = b.querySelector('#ld-done'), doneWrap = b.querySelector('#ld-done-wrap');
  doneWrap.addEventListener('toggle', () => prefs.set('list-done-open', doneWrap.open ? '1' : '0'));

  const render = () => {
    const l = byId('lists', id);
    if (!l) { s.close('gone'); return; }
    s.setTitle(`${l.emoji || '📝'} ${l.title || 'Untitled list'}`);
    s.el.style.setProperty('--lc', l.color || LIST_COLORS[0]);
    const its = [...(l.items || [])].sort((a, b2) => (a.sort ?? 0) - (b2.sort ?? 0));
    const open = its.filter((i) => !i.checked), done = its.filter((i) => i.checked);
    const p = progress(l);
    b.querySelector('#ld-prog').textContent = p.total ? `${p.done} of ${p.total} done${p.done === p.total ? ' ✨' : ''}` : 'empty list';
    b.querySelector('#ld-bar').style.width = Math.round(p.pct * 100) + '%';
    // groups: shopping lists by aisle; others one group
    let groups;
    if (shop) {
      const nums = G.getAisleNumbers();
      groups = G.order.groupByAisle(open, G.itemAisle, G.getAisleOrder(id)).map((g) => {
        const inf = G.aisleInfo(g.aisle);
        const n = G.order.aisleNumberLabel(nums[g.aisle]);
        return { key: g.aisle + '|' + (n || ''), label: `${inf.emoji} ${n ? n + ' · ' : ''}${inf.label}`, count: g.items.length, items: g.items };
      });
    } else if (l.kind === 'shopping') {
      groups = AISLE_ORDER.map((a) => ({ key: a, label: aisleLabel(a), items: open.filter((i) => aisleOf(i.text) === a) })).filter((g) => g.items.length);
    } else groups = [{ key: 'all', label: '', items: open }];
    const sb = b.querySelector('#ld-shop');
    if (sb) sb.disabled = !its.length;
    reconcile(itemsEl, groups, (g) => g.key, (g) => groupNode(g, l), (node, g) => { node._g = g; fillGroup(node, g, l); return node; });
    reconcile(doneEl, done, (i) => i.id, (i) => rowNode(i, l), (node, i) => updateRow(node, i, l));
    doneWrap.hidden = !done.length;
    b.querySelector('#ld-done-sum').textContent = `Done (${done.length})`;
    b.querySelector('#ld-empty').innerHTML = !its.length ? `<p class="ld-empty-note">${canEdit ? 'Type above and press Enter to add ♡' : 'Nothing on this list yet.'}</p>` : !open.length ? `<p class="ld-empty-note">All done! You’re amazing ✨</p>` : '';
  };
  const groupNode = (g, l) => {
    const n = h(`<div class="ld-group"><p class="ld-aisle"></p><div class="ld-rows"></div></div>`);
    n._g = g;
    fillGroup(n, g, l);
    return n;
  };
  function fillGroup(node, g, l) {
    const lab = node.querySelector('.ld-aisle');
    lab.hidden = !g.label;
    lab.textContent = g.label;
    if (g.count) { const c = document.createElement('span'); c.className = 'ld-aisle-n'; c.textContent = ' ' + g.count; lab.append(c); }
    const rows = node.querySelector('.ld-rows');
    reconcile(rows, g.items, (i) => i.id, (i) => rowNode(i, l), (n2, i) => updateRow(n2, i, l));
  }

  const rowNode = (it, l) => {
    const n = h(`<div class="ld-row" role="listitem">
        <div class="ld-swipe-bg" aria-hidden="true">${icon.trash}</div>
        <div class="ld-row-in">
          <button type="button" class="ld-check" data-a="check" aria-pressed="false"><span class="box" aria-hidden="true">${icon.check}</span></button>
          <button type="button" class="ld-text" data-a="edit"><span class="t"></span><span class="x"></span></button>
          <span class="ld-qty" hidden><button type="button" class="q" data-a="qminus" aria-label="Less">−</button><b></b><button type="button" class="q" data-a="qplus" aria-label="More">+</button></span>
          <a class="ld-link icon-btn plain" target="_blank" rel="noopener noreferrer" hidden aria-label="Open link">🔗</a>
          ${canEdit ? `<button type="button" class="ld-del icon-btn plain" data-a="del" aria-label="Delete item">${icon.close}</button>` : ''}
        </div></div>`);
    updateRow(n, it, l, true);
    if (canEdit) swipeable(n, () => delItem(it.id));
    return n;
  };
  function updateRow(n, it, l, first) {
    const sig = [it.text, it.qty, it.checked, it.link, it.price, l.kind, it.note, it.need, (it.for || []).join(','), it.aisle, shop].join('~');
    if (!first && n._sig === sig) return n;
    n._sig = sig;
    n.dataset.id = it.id;
    n.classList.toggle('checked', !!it.checked);
    const ck = n.querySelector('.ld-check');
    ck.setAttribute('aria-pressed', String(!!it.checked));
    ck.setAttribute('aria-label', (it.checked ? 'Uncheck ' : 'Check ') + it.text);
    ck.disabled = !canEdit;
    n.querySelector('.t').textContent = (shop ? G.itemEmoji(it) + ' ' : '') + it.text;
    const extra = [it.note || '', it.need ? 'need ' + it.need : '', (it.for || []).join(' '), it.price ? it.price : '', !['shopping', 'packing'].includes(l.kind) && it.qty ? '×' + it.qty : ''].filter(Boolean).join(' · ');
    n.querySelector('.x').textContent = extra;
    const q = n.querySelector('.ld-qty');
    const stepper = ['shopping', 'packing'].includes(l.kind) && canEdit && !it.checked;
    q.hidden = !stepper;
    q.querySelector('b').textContent = it.qty || '1';
    const a = n.querySelector('.ld-link');
    const safe = /^https?:\/\//i.test(it.link || '') ? it.link : '';
    a.hidden = !safe;
    if (safe) a.href = safe;
    n.querySelector('.ld-text').disabled = !canEdit;
    return n;
  }

  const toggleItem = (rowEl, itemId) => {
    const l = byId('lists', id);
    const it = (l.items || []).find((i) => i.id === itemId);
    if (!it) return;
    const willCheck = !it.checked;
    // Instant feedback, then move it after the little animation.
    rowEl.classList.toggle('checked', willCheck);
    rowEl.classList.add('pop');
    rowEl.querySelector('.ld-check').setAttribute('aria-pressed', String(willCheck));
    setTimeout(() => {
      mutate(id, (its) => { const x = its.find((i) => i.id === itemId); if (x) x.checked = willCheck; });
      const after = byId('lists', id);
      const all = (after.items || []);
      if (willCheck && all.length && all.every((i) => i.checked)) {
        const r = rowEl.getBoundingClientRect();
        confetti({ emoji: '✨💖', x: r.left + 30, y: r.top + 20, count: 60 });
        toast('List complete! ✨', { emoji: after.emoji || '🎉' });
      } else if (willCheck && !reducedMotion()) {
        const r = rowEl.getBoundingClientRect();
        confetti({ x: r.left + 26, y: r.top + r.height / 2, count: 8 });
      }
    }, reducedMotion() ? 0 : 320);
  };

  const delItem = (itemId) => {
    const l = byId('lists', id);
    const idx = (l.items || []).findIndex((i) => i.id === itemId);
    if (idx < 0) return;
    const removed = { ...l.items[idx] };
    mutate(id, (its) => its.filter((i) => i.id !== itemId), 200);
    toast(`Removed “${removed.text}”`, { undo: () => mutate(id, (its) => { its.splice(Math.min(idx, its.length), 0, removed); return its; }, 50) });
  };

  b.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    const row = a.closest('.ld-row');
    const itemId = row && row.dataset.id;
    if (!itemId || !canEdit) return;
    const act = a.dataset.a;
    if (act === 'check') toggleItem(row, itemId);
    else if (act === 'del') delItem(itemId);
    else if (act === 'qplus' || act === 'qminus') {
      mutate(id, (its) => {
        const x = its.find((i) => i.id === itemId);
        if (!x) return;
        if (shop) {
          const cur = G.parse.parseQty(x.qty || null);
          if (act === 'qminus' && (!cur || cur.n <= 1)) return; // one is the least (delete removes it)
          x.qty = G.parse.stepQty(x.qty || null, act === 'qplus' ? 1 : -1);
          return;
        }
        const n = clamp((parseInt(x.qty, 10) || 1) + (act === 'qplus' ? 1 : -1), 1, 99); x.qty = n > 1 ? String(n) : null;
      }, 500);
    } else if (act === 'edit') editItem(id, itemId);
  });

  const form = b.querySelector('#ld-add-form');
  if (form && shop) {
    const input = form.querySelector('#ld-add');
    import('../grocery/addbar.js').then((m) => {
      const submit = m.attachAddBar(form, input, id);
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    });
    if (focusAdd) setTimeout(() => input.focus(), 120);
  } else if (form) {
    const input = form.querySelector('#ld-add');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = input.value.trim();
      if (!raw) return;
      const parts = raw.split(/\s*[,;]\s*(?=\S)/).length > 1 && raw.includes(',') ? raw.split(/\s*,\s*/) : [raw];
      const now = Date.now();
      mutate(id, (its) => { parts.filter(Boolean).forEach((p, i) => { const { text, qty } = parseQty(p); its.push(newItem(text, qty, now + i)); }); }, 250);
      input.value = '';
      input.focus();
    });
    if (focusAdd) setTimeout(() => input.focus(), 120);
  }

  const shopBtn = b.querySelector('#ld-shop');
  if (shopBtn) shopBtn.onclick = async () => { await flushNow('lists', id); (await import('../grocery/shopping.js')).openShopping(id); };
  const walkBtn = b.querySelector('#ld-walk');
  if (walkBtn) walkBtn.onclick = async () => { await flushNow('lists', id); s.close('walk'); location.hash = 'grocery?list=' + encodeURIComponent(id); };
  const ordBtn = b.querySelector('#ld-order');
  if (ordBtn) ordBtn.onclick = async () => (await import('../grocery/storeOrder.js')).openStoreOrder({ listId: id, onChange: render });
  s.foot.querySelector('#ld-copy').onclick = () => copyText(listAsText(byId('lists', id)), 'List copied ♡');
  s.foot.querySelector('#ld-image').onclick = () => saveListImage(byId('lists', id));
  const more = s.foot.querySelector('#ld-more');
  if (more) more.onclick = async () => {
    const l = byId('lists', id);
    const v = await choose({ title: l.title || 'List', options: [
      { label: 'Edit name, kind & color', emoji: '✏️', value: 'edit' },
      { label: 'Uncheck everything', emoji: '↩️', value: 'uncheck' },
      { label: 'Clear checked items', emoji: '🧹', value: 'clear' },
      { label: 'Delete list', emoji: '🗑️', value: 'delete', danger: true },
    ] });
    if (v === 'edit') listForm(l);
    if (v === 'uncheck') { mutate(id, (its) => its.forEach((i) => (i.checked = false)), 50); toast('Fresh start ♡'); }
    if (v === 'clear') {
      const before = (l.items || []).map((i) => ({ ...i }));
      const n = before.filter((i) => i.checked).length;
      if (!n) { toast('Nothing checked yet'); return; }
      mutate(id, (its) => its.filter((i) => !i.checked), 50);
      toast(`Cleared ${n} item${n > 1 ? 's' : ''}`, { undo: () => patchSoon('lists', id, { items: before, updatedAt: Date.now() }, 50) });
    }
    if (v === 'delete') { s.close('del'); deleteList(l); }
  };

  detail = { id, render, sheet: s };
  render();
}

function editItem(listId, itemId) {
  const l = byId('lists', listId);
  const it = (l.items || []).find((i) => i.id === itemId);
  if (!it) return;
  const wish = l.kind === 'wishlist';
  const shop = l.kind === 'shopping' && !!G;
  const aisleOpts = shop ? G.order.visibleAisles(G.getAisleOrder(listId), new Set([G.itemAisle(it)]), true) : [];
  const s = sheet({
    title: 'Edit item',
    body: `<div class="field"><label class="lbl" for="li-text">Item</label><input class="txt" id="li-text" maxlength="140" value="${esc(it.text)}" autocomplete="off"></div>
      <div class="field"><label class="lbl" for="li-qty">Quantity</label><input class="txt" id="li-qty" maxlength="20" value="${esc(it.qty || '')}" placeholder="e.g. 2 or 500 g" autocomplete="off"></div>
      ${shop ? `<div class="field"><label class="lbl" for="li-note">Note</label><input class="txt" id="li-note" maxlength="80" value="${esc(it.note || '')}" placeholder="the organic one, ripe, big bag…" autocomplete="off"></div>
      <div class="field"><label class="lbl" for="li-aisle">Aisle</label><select class="txt" id="li-aisle">${aisleOpts.map((a) => `<option value="${a}" ${a === G.itemAisle(it) ? 'selected' : ''}>${G.aisleInfo(a).emoji} ${esc(G.aisleInfo(a).label)}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label class="lbl" for="li-link">Link ${wish ? '' : '(optional)'}</label><input class="txt" id="li-link" type="url" maxlength="500" value="${esc(it.link || '')}" placeholder="https://…" autocomplete="off"></div>
      <div class="field"><label class="lbl" for="li-price">Price ${wish ? '' : '(optional)'}</label><input class="txt" id="li-price" maxlength="20" value="${esc(it.price || '')}" placeholder="$25" autocomplete="off"></div>`,
    foot: `<button type="button" class="btn soft" id="li-cancel">Cancel</button><button type="button" class="btn" id="li-save">Save</button>`,
  });
  const g = (x) => s.body.querySelector(x).value.trim();
  const save = () => {
    const text = g('#li-text');
    if (!text) { s.body.querySelector('#li-text').focus(); return; }
    let link = g('#li-link');
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    mutate(listId, (its) => {
      const x = its.find((i) => i.id === itemId);
      if (!x) return;
      Object.assign(x, { text, qty: g('#li-qty') || null, link, price: g('#li-price') });
      if (shop) {
        const note = g('#li-note');
        if (note) x.note = note; else delete x.note;
        const a = s.body.querySelector('#li-aisle').value;
        // only store an override when she files it somewhere the catalog wouldn't
        if (a && a !== G.catalog.aisleOf(text)) x.aisle = a; else delete x.aisle;
      }
    }, 50);
    s.close('saved');
  };
  s.foot.querySelector('#li-save').onclick = save;
  s.foot.querySelector('#li-cancel').onclick = () => s.close('cancel');
  s.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } });
  setTimeout(() => s.body.querySelector('#li-text').focus(), 80);
}

/** Horizontal swipe (touch) reveals delete; vertical scrolling still works (touch-action: pan-y). */
function swipeable(row, onDelete) {
  const inner = row.querySelector('.ld-row-in');
  let x0 = 0, y0 = 0, dx = 0, active = false, decided = false, horiz = false, pid = null;
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; active = true; decided = false; horiz = false; pid = e.pointerId;
  });
  row.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== pid) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!decided && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      decided = true;
      horiz = Math.abs(mx) > Math.abs(my) * 1.2;
      if (horiz) { try { row.setPointerCapture(pid); } catch (err) { /* ignore */ } inner.style.transition = 'none'; row.classList.add('swiping'); }
      else active = false;
    }
    if (horiz) { dx = Math.min(0, mx); inner.style.transform = `translateX(${dx}px)`; row.classList.toggle('armed', dx < -90); }
  });
  const end = () => {
    if (!active) return;
    active = false;
    inner.style.transition = '';
    row.classList.remove('swiping', 'armed');
    if (horiz && dx < -90) {
      inner.style.transform = 'translateX(-110%)';
      setTimeout(onDelete, 160);
    } else inner.style.transform = '';
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  // Don't let a finished swipe also "click" the text.
  row.addEventListener('click', (e) => { if (horiz && Math.abs(dx) > 8) { e.stopPropagation(); e.preventDefault(); horiz = false; } }, true);
}

// ---------- share ----------
export function listAsText(l) {
  if (!l) return '';
  const its = [...(l.items || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const line = (i) => `${i.checked ? '☑' : '☐'} ${i.text}${i.qty ? ' ×' + i.qty : ''}${i.price ? ' · ' + i.price : ''}${i.link ? ' ' + i.link : ''}`;
  let body;
  if (l.kind === 'shopping' && G) {
    const nums = G.getAisleNumbers();
    const gline = (i) => `${i.checked ? '☑' : '☐'} ${G.itemEmoji(i)} ${i.text}${i.qty ? (/^\d+$/.test(i.qty) ? ' ×' + i.qty : ' · ' + i.qty) : ''}${i.note ? ' (' + i.note + ')' : ''}${i.price ? ' · ' + i.price : ''}`;
    body = G.order.groupByAisle(its, G.itemAisle, G.getAisleOrder(l.id)).map((g) => `${G.order.aisleShareHeading(g.aisle, nums)}\n${g.items.map(gline).join('\n')}`).join('\n\n');
  } else if (l.kind === 'shopping') {
    body = AISLE_ORDER.map((a) => { const g = its.filter((i) => aisleOf(i.text) === a); return g.length ? `${aisleLabel(a)}\n${g.map(line).join('\n')}` : ''; }).filter(Boolean).join('\n\n');
  } else body = its.map(line).join('\n');
  return `${l.emoji || '📝'} ${l.title || 'List'}\n\n${body}`.trim();
}

async function saveListImage(l) {
  if (!l) return;
  const T = tokens();
  const its = [...(l.items || [])].sort((a, b) => (a.checked - b.checked) || (a.sort ?? 0) - (b.sort ?? 0)).slice(0, 40);
  const W = 1080, pad = 90, lh = 64;
  const measure = makeCanvas(10, 10).getContext('2d');
  measure.font = '600 38px Nunito, sans-serif';
  const rows = its.map((i) => ({ i, lines: wrapLines(measure, i.text + (i.qty ? ` ×${i.qty}` : ''), W - pad * 2 - 150).slice(0, 2) }));
  const H = Math.max(900, 330 + rows.reduce((s, r) => s + r.lines.length * 48 + 18, 0) + 140);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  dottedBg(ctx, W, H, T.bg, T.dot);
  ctx.save();
  ctx.shadowColor = 'rgba(120,30,70,.18)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  roundRect(ctx, 50, 70, W - 100, H - 130, 44); ctx.fillStyle = T.paper; ctx.fill();
  ctx.restore();
  ctx.fillStyle = l.color || LIST_COLORS[0];
  roundRect(ctx, 50, 70, W - 100, 22, 11); ctx.fill();
  tape(ctx, W / 2, 72, 200, 46, -0.05, T.tape);
  ctx.textBaseline = 'alphabetic';
  ctx.font = '96px serif'; ctx.fillText(l.emoji || '📝', pad, 230);
  ctx.fillStyle = T.pink; ctx.font = '800 64px Sniglet, Nunito, sans-serif';
  drawText(ctx, l.title || 'List', pad + 130, 215, W - pad * 2 - 140, 70, 1);
  const p = progress(l);
  ctx.fillStyle = T.muted; ctx.font = '700 30px Nunito, sans-serif';
  ctx.fillText(`${p.done} of ${p.total} done ♡`, pad + 132, 262);
  let y = 340;
  for (const r of rows) {
    ctx.lineWidth = 5; ctx.strokeStyle = T.pink;
    roundRect(ctx, pad, y - 34, 44, 44, 12);
    if (r.i.checked) { ctx.fillStyle = T.pink; ctx.fill(); ctx.strokeStyle = T.pinkInk; ctx.beginPath(); ctx.moveTo(pad + 10, y - 12); ctx.lineTo(pad + 20, y - 2); ctx.lineTo(pad + 35, y - 22); ctx.stroke(); }
    else ctx.stroke();
    ctx.fillStyle = r.i.checked ? T.muted : T.ink;
    ctx.font = '600 38px Nunito, sans-serif';
    let yy = y;
    for (const ln of r.lines) {
      ctx.fillText(ln, pad + 70, yy);
      if (r.i.checked) { const w = ctx.measureText(ln).width; ctx.fillRect(pad + 70, yy - 13, w, 3); }
      yy += 48;
    }
    y = yy + 18;
  }
  ctx.fillStyle = T.muted; ctx.font = '700 34px Caveat, cursive';
  ctx.textAlign = 'center'; ctx.fillText('made with love · Em&m Blog', W / 2, H - 90);
  saveCanvas(c, `${l.title || 'list'}`);
}

/**
 * Add ingredient lines to a shopping list (used by recipes). Asks which list (or makes "Groceries").
 * Lines are mapped through the grocery catalog ("2 cups flour" -> Flour, need 2 cups), merged with what's already
 * on the list (same thing = one row, amounts add up), and tagged with the recipe. Nothing is ever pre-ticked:
 * a checked match comes back unchecked. Resolves the number of rows added or updated.
 */
export async function addToShoppingList(lines, fromTitle = '') {
  await ready;
  if (!state.canWrite) { toast('This is view-only for you ♡'); return 0; }
  await loaded('lists');
  const shops = items('lists').filter((l) => l.kind === 'shopping');
  const opts = shops.map((l) => ({ label: l.title || 'Shopping list', emoji: l.emoji || '🛒', value: l.id }));
  opts.push({ label: 'New list: Groceries', emoji: '✨', value: '__new' });
  const pick = shops.length ? await choose({ title: 'Add to which list?', options: opts }) : '__new';
  if (!pick) return 0;
  try {
    const g = await grocery();
    const tag = fromTitle ? (fromTitle.length > 18 ? fromTitle.slice(0, 17) + '…' : fromTitle) : null;
    const incoming = g.linesToIncoming(lines.map((t) => String(t || '').trim()).filter(Boolean), tag);
    if (!incoming.length) { toast('Nothing to add from that one'); return 0; }
    const now = Date.now();
    if (pick === '__new') {
      const r = g.mergeInto([], incoming, 'sum');
      await add('lists', { title: 'Groceries', emoji: '🛒', kind: 'shopping', color: '#BDEBC8', items: r.items, createdAt: now, updatedAt: now, sort: now });
      g.noteAdded(incoming.map((i) => ({ key: g.catalog.itemKey(i.name), name: i.name })));
      toast(`Added ${r.items.length} to Groceries`, { emoji: '🛒' });
      return r.items.length;
    }
    const l = byId('lists', pick);
    const r = await g.upsertGroceries(pick, incoming, 'sum');
    const n = r.added.length + r.bumped.length;
    toast(r.bumped.length ? `Added ${r.added.length}, updated ${r.bumped.length} on ${l.title || 'your list'}` : `Added ${n} to ${l.title || 'your list'}`, { emoji: '🛒' });
    return n;
  } catch (e) { console.error(e); toast(errText(e)); return 0; }
}
