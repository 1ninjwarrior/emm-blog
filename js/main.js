// Em&m Blog: app shell. Tabs + hash deep links, the ＋ create menu, light/dark + looks,
// flower border, and boot. Views are lazy-loaded ES modules with mount(el) / show() / hide().
import { init, state, prefs, on, watch, byId } from './store.js';
import { $, $$, sheet, esc, toast } from './ui.js';

const TABS = ['home', 'today', 'lists', 'diary', 'me'];
const LOADERS = {
  home: () => import('./views/home.js'),
  today: () => import('./views/today.js'),
  diary: () => import('./views/diary.js'),
  lists: () => import('./views/lists.js'),
  me: () => import('./views/me.js'),
};
/** Hash aliases -> [tab, sub-section]. */
const ALIASES = { recipes: ['lists', 'recipes'], mylists: ['lists', 'lists'], shopping: ['lists', 'lists'], specialdays: ['lists', 'days'], days: ['lists', 'days'], settings: ['me', null] };

/**
 * Overlay routes: they open on top of the current tab (like the app's slide-up cards).
 * '#garden', '#garden?plant=1', '#garden?habit=<id>', '#routines', '#grocery', '#grocery?list=<id>',
 * '#import?url=…', '#receive=<share payload>' (the part after '#' in a …/r#1.… link).
 */
const OVERLAYS = {
  garden: async (q) => (await import('./views/garden.js')).openGarden({ plant: q.get('plant') === '1', habit: q.get('habit') }),
  routines: async (q) => (await import('./views/today.js')).openRoutines(q.get('open')),
  grocery: async (q) => (await import('./grocery/walk.js')).openWalk({ listId: q.get('list'), aisle: q.get('aisle') }),
  import: async (q) => { await go('lists', 'recipes', { push: false }); (await import('./views/recipes.js')).openImport({ url: q.get('url'), text: q.get('text') }); },
  receive: async (q, raw) => { await go('lists', 'recipes', { push: false }); (await import('./views/recipes.js')).openReceive(raw); },
};

const mounted = {};
let current = null;

async function view(tab) {
  if (!mounted[tab]) {
    mounted[tab] = LOADERS[tab]().then((m) => { m.mount($('#view-' + tab)); return m; });
  }
  return mounted[tab];
}

/** Switch tab. sub = optional section inside the tab (e.g. 'recipes'). */
export async function go(tab, sub = null, { push = true } = {}) {
  if (!TABS.includes(tab)) tab = 'home';
  const prev = current;
  current = tab;
  for (const t of TABS) {
    const el = $('#view-' + t);
    const on = t === tab;
    if (el.hidden === on) el.hidden = !on;
    $('#tab-' + t).setAttribute('aria-current', on ? 'page' : 'false');
  }
  if (push) {
    const h = '#' + (sub && tab === 'lists' ? { recipes: 'recipes', lists: 'mylists', days: 'specialdays' }[sub] || tab : tab);
    document.querySelectorAll('dialog[open].route').forEach((d) => d.dispatchEvent(new Event('cancel')));
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  if (prev !== tab) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  try { prefs.set('tab', tab); } catch (e) { /* ignore */ }
  const mods = await Promise.all([view(tab), prev && prev !== tab ? view(prev) : null]);
  if (prev && prev !== tab && mods[1] && mods[1].hide) mods[1].hide();
  if (mods[0].show) mods[0].show(sub);
  applyLook();
}

/** Put the hash back to the current tab (after an overlay closes). */
export function resetHash() {
  const h = '#' + (current || 'home');
  if (location.hash !== h) history.replaceState(null, '', h);
}

function fromHash() {
  const rawHash = location.hash.replace(/^#/, '');
  const rm = rawHash.match(/^receive=(.+)$/i);
  if (rm) { if (!current) go('home', null, { push: false }); OVERLAYS.receive(new URLSearchParams(), rm[1]).catch(onOverlayError); return; }
  const [name, qs] = rawHash.split('?');
  const ov = OVERLAYS[decodeURIComponent(name || '').toLowerCase()];
  if (ov) { if (!current) go('home', null, { push: false }); ov(new URLSearchParams(qs || '')).catch(onOverlayError); return; }
  const h = decodeURIComponent(rawHash).toLowerCase();
  if (h === 'create') { go(current || 'home'); openCreate(); return; }
  if (ALIASES[h]) return go(ALIASES[h][0], ALIASES[h][1], { push: false });
  if (TABS.includes(h)) return go(h, null, { push: false });
  return go(current || 'home', null, { push: false });
}
function onOverlayError(err) { console.error(err); toast('Oops, that didn’t open. Try again?'); resetHash(); }

/** Open an overlay route from code (keeps the hash in sync so reload/back works). */
export function openRoute(route) { location.hash = route; }

// ---------- create menu ----------
const CREATE = [
  { id: 'task', emoji: '✅', label: 'Task', run: async () => (await import('./views/today.js')).openQuickAdd() },
  { id: 'photo', img: 'img/create/photo.png', emoji: '📷', label: 'Photo', run: async () => { await go('home'); (await view('home')).openComposer('photo'); } },
  { id: 'video', img: 'img/create/video.png', emoji: '🎬', label: 'Video', run: async () => { await go('home'); (await view('home')).openComposer('video'); } },
  { id: 'thought', img: 'img/create/thought.png', emoji: '💭', label: 'Thought', run: async () => { await go('home'); (await view('home')).openComposer('thought'); } },
  { id: 'collage', img: 'img/create/collage.png', emoji: '🖼️', label: 'Collage', run: async () => { const m = await import('./editor/collage.js'); m.openCollage({ boardId: (await view('home')).currentBoardId() }); } },
  { id: 'diary', img: 'img/create/diary.png', emoji: '📔', label: 'Diary page', run: async () => { await go('diary'); (await view('diary')).openNewEntry(); } },
  { id: 'recipe', img: 'img/create/recipe.png', emoji: '🧁', label: 'Recipe', run: async () => { await go('lists', 'recipes'); (await import('./views/recipes.js')).openNewRecipe(); } },
  { id: 'list', img: 'img/create/list.png', emoji: '📝', label: 'List', run: async () => pickListKind() },
  { id: 'habit', emoji: '🌷', label: 'Habit', run: async () => openRoute('garden?plant=1') },
  { id: 'day', emoji: '🎂', label: 'Special day', run: async () => { await go('lists', 'days'); (await import('./views/countdowns.js')).openNewCountdown(); } },
];

/** "What kind of list?" like the app: aisle-by-aisle grocery list vs any other list. */
async function pickListKind() {
  const { choose } = await import('./ui.js');
  const v = await choose({ title: 'What kind of list?', options: [
    { value: 'walk', emoji: '🧺', label: 'Grocery list (aisle by aisle)' },
    { value: 'other', emoji: '📝', label: 'Other list' },
  ] });
  if (v === 'walk') openRoute('grocery');
  else if (v === 'other') { await go('lists', 'lists'); (await import('./views/lists.js')).openNewList(); }
}

export function openCreate() {
  if (state.mode !== 'loading' && !state.canWrite) {
    toast('This is view-only for you ♡', { emoji: '👀' });
    return;
  }
  const s = sheet({
    title: 'Make something ♡',
    body: `<div class="tiles">${CREATE.map((c) => `<button type="button" class="tile" id="create-${c.id}" data-c="${c.id}"><span class="e" aria-hidden="true">${c.img ? `<img src="${c.img}" alt="" width="44" height="44">` : c.emoji}</span>${esc(c.label)}</button>`).join('')}</div>`,
  });
  s.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const item = CREATE.find((c) => c.id === b.dataset.c);
    s.close('pick');
    setTimeout(() => item.run().catch((err) => { console.error(err); toast('Oops, that didn’t open. Try again?'); }), 180);
  });
}

// ---------- light / dark + looks ----------
export function setMode(m) {
  prefs.set('mode', m === 'dark' ? 'dark' : 'light');
  applyMode();
}
function applyMode() {
  if (prefs.get('mode') === 'dark') document.documentElement.setAttribute('data-emm', 'dark');
  else document.documentElement.removeAttribute('data-emm');
}

/** The whole app takes the look of the board open on Home, else the accent chosen in Me. */
export function applyLook() {
  const boardId = prefs.get('board', 'all');
  const b = boardId && boardId !== 'all' ? byId('boards', boardId) : null;
  const look = (b && b.look) || prefs.get('accent', 'pink') || 'pink';
  const root = document.documentElement;
  if (look === 'pink') root.removeAttribute('data-look'); else root.setAttribute('data-look', look);
  try { localStorage.setItem('emm-look-now', look); } catch (e) { /* ignore */ }
}

// ---------- flower border (SVG symbols, placed once per resize) ----------
function flowers() {
  const box = document.getElementById('flowers');
  const NS = 'http://www.w3.org/2000/svg';
  const kinds = ['bloom', 'bloom', 'daisy', 'bloom', 'tulip', 'daisy', 'leaf', 'heart'];
  const petals = [1, 2, 3, 4, 5].map((i) => `var(--petal-${i})`);
  const mids = ['#FFF3B8', '#FFE08A', '#FFFFFF'];
  let seed;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), (seed - 1) / 2147483646);
  let lastW = 0, lastH = 0;
  function place() {
    const W = innerWidth, H = innerHeight;
    if (Math.abs(W - lastW) < 2 && Math.abs(H - lastH) < 120) return; // ignore mobile URL-bar jiggle
    lastW = W; lastH = H;
    const frag = document.createDocumentFragment();
    box.querySelectorAll('svg.f').forEach((n) => n.remove());
    seed = 20260923;
    const small = W < 700;
    const step = small ? 70 : 84;
    const add = (x, y) => {
      const k = kinds[Math.floor(rnd() * kinds.length)];
      let sz = (small ? 26 : 40) + rnd() * (small ? 16 : 34);
      if (k === 'heart' || k === 'leaf') sz *= 0.65;
      const el = document.createElementNS(NS, 'svg');
      el.setAttribute('class', 'f');
      el.setAttribute('width', sz); el.setAttribute('height', sz);
      el.style.left = x - sz / 2 + 'px'; el.style.top = y - sz / 2 + 'px';
      el.style.transform = 'rotate(' + Math.round(rnd() * 360 - 180) + 'deg)';
      el.style.color = petals[Math.floor(rnd() * petals.length)];
      el.style.setProperty('--mid', mids[Math.floor(rnd() * mids.length)]);
      const u = document.createElementNS(NS, 'use');
      u.setAttribute('href', '#fl-' + k);
      el.appendChild(u);
      frag.appendChild(el);
    };
    const edge = () => rnd() * (small ? 14 : 22) - (small ? 8 : 6);
    for (let x = rnd() * 30; x < W + 20; x += step * (0.75 + rnd() * 0.5)) { add(x, edge()); if (!small) add(x, H - edge()); }
    for (let y = step; y < H - step / 2; y += step * (0.75 + rnd() * 0.5)) { add(edge(), y); add(W - edge(), y); }
    box.appendChild(frag);
  }
  let t;
  place();
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(place, 200); });
}

// ---------- boot ----------
function boot() {
  applyMode();
  applyLook();
  flowers();
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (b.dataset.tab === 'create') return openCreate();
    go(b.dataset.tab);
  });
  $('.rail-brand').addEventListener('click', (e) => { e.preventDefault(); go('home'); });
  addEventListener('hashchange', fromHash);
  // Keyboard: "n" opens the create menu when not typing.
  addEventListener('keydown', (e) => {
    if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.closest && t.closest('input,textarea,select,[contenteditable],dialog')) return;
    openCreate();
  });
  on('prefs', (k) => { if (k === 'board' || k === 'accent') applyLook(); if (k === 'mode') applyMode(); });
  watch('boards', applyLook);
  const h = location.hash.replace('#', '');
  if (h) fromHash(); else go('home', null, { push: false });
  init().then(async (st) => {
    if (st.memory && /[?&]demo\b/.test(location.search)) (await import('./demo.js')).seed();
    // Warm up the other tabs in idle time so switching feels instant.
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
    idle(() => TABS.forEach((t) => LOADERS[t]().catch(() => {})));
  });
}

boot();
