// Em&m Blog web: "Walk the store" (the app's aisle walk + review). Overlay route '#grocery'
// ('#grocery?list=<id>' = "Add by aisle" for an existing shopping list, '?aisle=<id>' jumps to an aisle).
// Only the current aisle is rendered; each tile re-renders on its own when its pick changes.
import { byId, kv } from '../store.js';
import { fullscreen, sheet, confirmDlg, askText, toast, confetti, esc, icon, debounce, reducedMotion } from '../ui.js';
import * as G from './core.js';

const UNITS = [null, 'lb', 'oz', 'pack', 'bag', 'box', 'can', 'jar', 'bottle', 'bunch', 'dozen', 'gallon', 'carton', 'tub', 'loaf', 'head', 'pint', 'case', 'roll', 'pouch', 'block', 'tube', 'ct'];
const LIST_COLORS = ['#FFC2D8', '#FFD3B0', '#FFE58A', '#BDEBC8', '#C4E4FF', '#DCCBFF'];
const REVIEW_EMOJI = ['🛒', '🧺', '🥑', '🍓', '🥐', '🍝', '🥗', '🧁', '🏡', '✨'];

let open = null; // the one open walk

export async function openWalk({ listId = null, aisle = null } = {}) {
  if (open) { open.focus(); return; }
  await G.ready;
  const target = listId && byId('lists', listId) ? listId : 'new';
  if (listId && target === 'new') toast('That list is gone, starting a new one ♡');
  const W = { target, listId: target === 'new' ? null : target };

  // draft: saved one, else (Add by aisle) pre-filled from the list's unchecked items
  let draft = G.getDraft(target);
  if (!draft) {
    const first = G.getAisleOrder(W.listId)[0];
    draft = G.walkModel.emptyDraft(target, first);
    if (W.listId) Object.assign(draft, G.draftFromList(W.listId));
  }
  draft = { ...draft, picks: { ...draft.picks }, prefill: { ...(draft.prefill || {}) } };
  let aisles = [];
  let idx = 0;
  let query = '';
  let everywhere = false;
  let mode = 'walk'; // | 'review'
  const review = { title: G.walkModel.defaultListName(), emoji: '🛒', color: LIST_COLORS[3] };

  const computeAisles = () => {
    const keep = new Set(Object.values(draft.picks).map((p) => p.aisle));
    aisles = G.order.visibleAisles(G.getAisleOrder(W.listId), keep, false);
  };
  computeAisles();
  idx = Math.max(0, aisles.indexOf(aisle && aisles.includes(aisle) ? aisle : draft.aisle));

  const save = debounce(() => kv.set(G.draftKey(target), { ...draft, updatedAt: Date.now() }).catch(() => {}), 450);
  let changed = false, finished = false;
  const touch = (picksChanged = true) => { draft.aisle = aisles[idx]; if (picksChanged) changed = true; if (changed || !W.listId) save(); };

  const fs = fullscreen({ className: 'route gw-fs', label: 'Walk the store', onClose: async () => { open = null; save.cancel(); await persistNow(); (await import('../main.js')).resetHash(); } });
  const el = fs.el;
  const persistNow = () => {
    const n = Object.keys(draft.picks).length;
    if (finished || (!n && !W.listId) || (W.listId && !changed)) return kv.set(G.draftKey(target), null).catch(() => {});
    return kv.set(G.draftKey(target), { ...draft, aisle: aisles[idx], updatedAt: Date.now() }).catch(() => {});
  };
  open = { focus: () => el.focus() };

  // ---------------------------------------------------------------- walk screen
  function renderWalk() {
    mode = 'walk';
    el.innerHTML = `<div class="gw">
      <header class="gw-head">
        <button type="button" class="icon-btn" id="gw-close" aria-label="Close (your picks are kept)">${icon.close}</button>
        <div class="gw-title"><h2 id="gw-h"></h2><span class="muted-line" id="gw-of"></span></div>
        <button type="button" class="icon-btn" id="gw-over" aria-label="Start over">${icon.refresh}</button>
      </header>
      <div class="pbar gw-prog" aria-hidden="true"><i id="gw-bar"></i></div>
      <nav class="gw-strip" id="gw-strip" aria-label="Aisles"></nav>
      <div class="gw-search">
        <label class="sr-only" for="gw-q">Search</label>
        <input class="txt" id="gw-q" type="search" placeholder="Search" autocomplete="off" value="${esc(query)}">
        <button type="button" class="chip" id="gw-every" aria-pressed="${everywhere}">${everywhere ? '🌍 All aisles' : '📍 This aisle'}</button>
      </div>
      <main class="gw-body" id="gw-body" tabindex="-1"></main>
      <button type="button" class="gw-pill" id="gw-pill" hidden></button>
      <footer class="gw-bar">
        <button type="button" class="btn ghost small" id="gw-back">${icon.back} Back</button>
        <span class="gw-here muted-line" id="gw-here" aria-live="polite"></span>
        <button type="button" class="btn" id="gw-next"></button>
      </footer>
    </div>`;
    const q = el.querySelector('#gw-q');
    q.addEventListener('input', debounce(() => { query = q.value.trim(); renderBody(); }, 90));
    el.querySelector('#gw-every').onclick = (e) => { everywhere = !everywhere; e.currentTarget.setAttribute('aria-pressed', String(everywhere)); e.currentTarget.textContent = everywhere ? '🌍 All aisles' : '📍 This aisle'; renderBody(); };
    el.querySelector('#gw-close').onclick = () => { if (Object.keys(draft.picks).length && !W.listId) toast('Saved your spot ♡', { emoji: '🛒', duration: 1400 }); fs.close('x'); };
    el.querySelector('#gw-over').onclick = startOver;
    el.querySelector('#gw-back').onclick = () => go(idx - 1);
    el.querySelector('#gw-next').onclick = () => (idx >= aisles.length - 1 ? renderReview() : go(idx + 1));
    el.querySelector('#gw-pill').onclick = renderReview;
    el.querySelector('#gw-strip').addEventListener('click', (e) => {
      const c = e.target.closest('[data-aisle]');
      if (c) { go(aisles.indexOf(c.dataset.aisle)); return; }
      if (e.target.closest('#gw-order')) storeOrder();
    });
    const body = el.querySelector('#gw-body');
    body.addEventListener('click', onBodyClick);
    body.addEventListener('contextmenu', (e) => { const t = e.target.closest('[data-key]'); if (t) { e.preventDefault(); editPick(t.dataset.key); } });
    longPress(body, (t) => editPick(t.dataset.key));
    swipe(body);
    renderHead();
    renderBody();
  }

  function renderHead() {
    if (mode !== 'walk') return;
    const a = aisles[idx];
    const nums = G.getAisleNumbers();
    const inf = G.aisleInfo(a);
    el.querySelector('#gw-h').textContent = `${inf.emoji} ${G.order.aisleTitle(a, nums)}`;
    el.querySelector('#gw-of').textContent = `${idx + 1} of ${aisles.length}`;
    el.querySelector('#gw-bar').style.width = Math.round(((idx + 1) / aisles.length) * 100) + '%';
    const counts = G.walkModel.countByAisle(draft.picks);
    const strip = el.querySelector('#gw-strip');
    strip.innerHTML = aisles.map((x, i) => { const n = counts.get(x) || 0; const f = G.aisleInfo(x); return `<button type="button" class="gw-chip" data-aisle="${x}" aria-pressed="${i === idx}" aria-label="${esc(f.label)}${n ? `, ${n} picked` : ''}"><span aria-hidden="true">${f.emoji}</span> ${esc(f.short)}${n ? ` <b class="gw-badge">${n}</b>` : ''}</button>`; }).join('')
      + `<button type="button" class="gw-chip" id="gw-order" aria-label="Store order and aisle numbers">🗺️ Store order</button>`;
    const cur = strip.querySelector('[aria-pressed="true"]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    const here = Object.values(draft.picks).filter((p) => p.aisle === a).length;
    const total = Object.keys(draft.picks).length;
    el.querySelector('#gw-here').textContent = here ? `${here} picked here` : '';
    el.querySelector('#gw-back').disabled = idx === 0;
    const last = idx >= aisles.length - 1;
    el.querySelector('#gw-next').textContent = last ? 'Review list ♡' : 'Next aisle';
    const pill = el.querySelector('#gw-pill');
    pill.hidden = !total;
    pill.textContent = `${total} item${total === 1 ? '' : 's'} · Review`;
  }

  function tileHTML(item, key = item.id) {
    const p = draft.picks[key];
    const picked = !!(p && p.n > 0);
    const name = item.name;
    return `<div class="gw-tile${picked ? ' on' : ''}" data-key="${esc(key)}" role="group" aria-label="${esc(name)}">
      <button type="button" class="gw-t-main" data-act="tap" aria-pressed="${picked}" title="${esc(name)}">
        <span class="gw-e" aria-hidden="true">${esc(item.emoji || '🛍️')}</span><span class="gw-n">${esc(name)}</span>
        ${picked ? `<span class="gw-ck" aria-hidden="true">${icon.check}</span>` : ''}
      </button>
      ${picked ? `<div class="gw-step"><button type="button" data-act="minus" aria-label="Less ${esc(name)}">${icon.minus}</button><b>${esc(G.walkModel.pickLabel(p))}</b><button type="button" data-act="plus" aria-label="More ${esc(name)}">${icon.plus}</button></div>` : ''}
    </div>`;
  }
  const grid = (arr) => `<div class="gw-grid">${arr.join('')}</div>`;
  const sectionHead = (t, hint = '') => `<h3 class="label-quiet">${esc(t)}${hint ? ` <span class="grow"></span><span>${esc(hint)}</span>` : ''}</h3>`;
  const ownTile = () => `<div class="gw-tile own"><button type="button" class="gw-t-main" data-act="own"><span class="gw-e" aria-hidden="true">＋</span><span class="gw-n">Something else</span></button></div>`;

  function renderBody() {
    if (mode !== 'walk') return;
    const a = aisles[idx];
    const inf = G.aisleInfo(a);
    const body = el.querySelector('#gw-body');
    let html = '';
    if (query) {
      const hits = G.catalog.searchCatalog(query, 40, G.boost, everywhere ? undefined : a);
      html += sectionHead(everywhere ? 'Everywhere' : `In ${inf.short}`, `${hits.length} found`);
      html += hits.length ? grid(hits.map((h) => tileHTML(h.item))) : `<p class="note">${everywhere ? 'Nothing like that… add it as your own ♡' : `Not in ${esc(inf.short)}… try 🌍 All aisles, or add it as your own ♡`}</p>`;
      html += `<div class="gw-grid"><div class="gw-tile own"><button type="button" class="gw-t-main" data-act="ownq"><span class="gw-e" aria-hidden="true">＋</span><span class="gw-n">Add “${esc(query)}”</span></button></div></div>`;
    } else {
      const h = G.getHistory();
      const usual = G.hist.usuals(h, new Set(), 60).map((s) => G.catalog.catalogById(s.key)).filter((it) => it && it.aisle === a).slice(0, 8);
      if (usual.length) html += sectionHead('⭐ Your usuals in this aisle') + grid(usual.map((it) => tileHTML(it)));
      const own = Object.values(draft.picks).filter((p) => p.aisle === a && !G.catalog.catalogById(p.key));
      if (own.length) html += sectionHead('💗 Yours') + grid(own.map((p) => tileHTML({ name: p.name, emoji: p.emoji }, p.key)));
      for (const sec of G.catalog.catalogSections(a)) html += sectionHead(sec.sub) + grid(sec.items.map((it) => tileHTML(it)));
      html += grid([ownTile()]);
      const last = idx >= aisles.length - 1;
      html += `<p class="gw-hint note">${last ? 'Last aisle! Review your list ♡' : `Swipe or tap “Next aisle” for ${esc(G.aisleInfo(aisles[idx + 1]).label)} ${G.aisleInfo(aisles[idx + 1]).emoji}`}</p>`;
    }
    body.innerHTML = html;
    body.scrollTop = 0;
  }

  /** Re-render every tile of one key (it can appear in usuals + its section). */
  function refreshTile(key) {
    el.querySelectorAll(`.gw-tile[data-key="${CSS.escape(key)}"]`).forEach((t) => {
      const p = draft.picks[key];
      const it = G.catalog.catalogById(key) || (p ? { name: p.name, emoji: p.emoji } : { name: t.getAttribute('aria-label'), emoji: '🛍️' });
      const hadFocus = t.contains(document.activeElement) && document.activeElement.dataset.act;
      const tmp = document.createElement('div');
      tmp.innerHTML = tileHTML(it, key);
      const n = tmp.firstElementChild;
      if (p && p.n > 0 && !reducedMotion()) n.classList.add('pop');
      t.replaceWith(n);
      if (hadFocus) (n.querySelector(`[data-act="${hadFocus}"]`) || n.querySelector('[data-act="tap"]')).focus();
    });
    renderHead();
  }

  function setPick(key, fn) {
    const cur = draft.picks[key];
    const next = fn(cur);
    if (!next || next.n <= 0) delete draft.picks[key];
    else draft.picks[key] = next;
    touch();
    refreshTile(key);
  }

  function onBodyClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'own' || act === 'ownq') { addOwn(act === 'ownq' ? query : ''); return; }
    const key = b.closest('[data-key]').dataset.key;
    const a = aisles[idx];
    if (act === 'tap') {
      setPick(key, (p) => {
        if (p) return { ...p, n: G.walkModel.stepN(p.n, 1, p.unit), raw: null };
        const it = G.catalog.catalogById(key);
        return it ? G.walkModel.pickFromItem(it) : null;
      });
      void a;
    } else if (act === 'plus') setPick(key, (p) => p && { ...p, n: G.walkModel.stepN(p.n, 1, p.unit), raw: null });
    else if (act === 'minus') setPick(key, (p) => p && { ...p, n: G.walkModel.stepN(p.n, -1, p.unit), raw: null });
  }

  async function addOwn(prefill = '') {
    const text = await askText({ title: 'Something else', label: 'What is it?', value: prefill, placeholder: 'the good sourdough, birthday candles…', okLabel: 'Add it ♡', maxlength: 80, id: 'gw-own' });
    if (!text) return;
    const p = G.walkModel.pickFromText(text, aisles[idx]);
    const cur = draft.picks[p.key];
    draft.picks[p.key] = cur ? { ...cur, n: G.walkModel.stepN(cur.n, 1, cur.unit) } : p;
    touch();
    query = '';
    const q = el.querySelector('#gw-q');
    if (q) q.value = '';
    renderHead(); renderBody();
    toast(`Added ${p.name} ♡`, { duration: 1400 });
  }

  function editPick(key, after = null) {
    const p0 = draft.picks[key];
    const it = G.catalog.catalogById(key);
    let p = p0 ? { ...p0 } : it ? G.walkModel.pickFromItem(it) : null;
    if (!p) return;
    const s = sheet({
      title: `${p.emoji || '🛍️'} ${p.name}`,
      body: `<div class="field"><span class="lbl">How much</span>
          <div class="gw-step big"><button type="button" data-ps="-1" aria-label="Less">${icon.minus}</button><b id="ps-amt"></b><button type="button" data-ps="1" aria-label="More">${icon.plus}</button></div></div>
        <div class="chips scroll" id="ps-units" role="group" aria-label="Unit">${UNITS.map((u) => `<button type="button" class="chip small" data-u="${u || ''}">${u || 'each'}</button>`).join('')}</div>
        <div class="field"><label class="lbl" for="ps-note">Note</label><input class="txt" id="ps-note" maxlength="80" placeholder="the organic one, ripe, big bag…" value="${esc(p.note || '')}" autocomplete="off"></div>`,
      foot: `${p0 ? `<button type="button" class="btn soft" id="ps-rm" style="margin-right:auto">${icon.trash} Remove</button>` : ''}<button type="button" class="btn" id="ps-done">Done</button>`,
    });
    const paint = () => {
      s.body.querySelector('#ps-amt').textContent = p.unit ? `${G.parse.formatNum(p.n)} ${G.parse.unitLabel(p.unit, p.n)}` : G.parse.formatNum(p.n);
      s.body.querySelectorAll('[data-u]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.u || null) === (p.unit || null))));
    };
    paint();
    s.body.addEventListener('click', (e) => {
      const st = e.target.closest('[data-ps]'), u = e.target.closest('[data-u]');
      if (st) { const min = p.unit === 'lb' || p.unit === 'kg' ? 0.5 : 1; p.n = Math.max(min, G.walkModel.stepN(p.n, +st.dataset.ps, p.unit)); p.raw = null; paint(); }
      if (u) { p.unit = u.dataset.u || null; p.raw = null; paint(); }
    });
    const done = () => {
      p.note = s.body.querySelector('#ps-note').value.trim() || null;
      draft.picks[key] = p;
      touch(); s.close('done');
      if (mode === 'walk') refreshTile(key); else if (after) after();
    };
    s.foot.querySelector('#ps-done').onclick = done;
    s.body.querySelector('#ps-note').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
    const rm = s.foot.querySelector('#ps-rm');
    if (rm) rm.onclick = () => { delete draft.picks[key]; touch(); s.close('rm'); if (mode === 'walk') refreshTile(key); else if (after) after(); };
  }

  function go(i) {
    if (i < 0 || i >= aisles.length || i === idx) return;
    const dir = i > idx ? 1 : -1;
    idx = i;
    query = '';
    const q = el.querySelector('#gw-q');
    if (q) q.value = '';
    touch(false);
    renderHead(); renderBody();
    const body = el.querySelector('#gw-body');
    if (!reducedMotion()) { body.classList.remove('in-l', 'in-r'); void body.offsetWidth; body.classList.add(dir > 0 ? 'in-r' : 'in-l'); }
  }

  async function startOver() {
    const n = Object.keys(draft.picks).length;
    const ok = await confirmDlg({ title: 'Start over?', message: W.listId ? 'Your changes here go back to what’s on the list.' : `Your ${n} picked thing${n === 1 ? '' : 's'} will be cleared.`, confirmLabel: 'Start over', cancelLabel: 'Keep them', emoji: '🧺' });
    if (!ok) return;
    draft.picks = {}; draft.prefill = {};
    if (W.listId) Object.assign(draft, G.draftFromList(W.listId));
    computeAisles();
    idx = 0;
    touch();
    renderWalk();
  }

  async function storeOrder() {
    const { openStoreOrder } = await import('./storeOrder.js');
    await openStoreOrder({ listId: W.listId });
    const cur = aisles[idx];
    computeAisles();
    idx = Math.max(0, aisles.indexOf(cur));
    if (mode === 'walk') { renderHead(); renderBody(); } else renderReview();
  }

  // ---------------------------------------------------------------- review
  function renderReview() {
    mode = 'review';
    touch(false);
    const isNew = !W.listId;
    const list = W.listId ? byId('lists', W.listId) : null;
    el.innerHTML = `<div class="gw gw-review">
      <header class="gw-head">
        <button type="button" class="icon-btn" id="gr-back" aria-label="Keep shopping">${icon.back}</button>
        <div class="gw-title"><h2>${isNew ? 'Review your list' : esc(list ? list.title || 'Your list' : 'Your list')}</h2><span class="muted-line" id="gr-count"></span></div>
        <span style="width:42px"></span>
      </header>
      <main class="gw-body" id="gr-body">
        ${isNew ? `<div class="gr-form card">
          <div class="field"><label class="lbl" for="gr-name">Name</label><input class="txt" id="gr-name" maxlength="60" placeholder="Groceries" value="${esc(review.title)}" autocomplete="off"></div>
          <div class="emoji-row" id="gr-emoji" role="group" aria-label="Emoji">${REVIEW_EMOJI.map((e) => `<button type="button" data-e="${e}" aria-label="${e}" aria-pressed="${e === review.emoji}">${e}</button>`).join('')}</div>
          <div class="swatches" id="gr-color" role="group" aria-label="Color">${LIST_COLORS.map((c, i) => `<button type="button" class="sw-btn" data-c="${c}" aria-label="Color ${i + 1}" aria-pressed="${c === review.color}" style="background:${c}"></button>`).join('')}</div>
        </div>` : ''}
        <div id="gr-groups"></div>
      </main>
      <footer class="gw-bar"><button type="button" class="btn block" id="gr-save">${isNew ? 'Create list ♡' : 'Save to list ♡'}</button></footer>
    </div>`;
    el.querySelector('#gr-back').onclick = () => renderWalk();
    const body = el.querySelector('#gr-body');
    body.addEventListener('click', (e) => {
      const em = e.target.closest('[data-e]'), c = e.target.closest('[data-c]');
      if (em) { review.emoji = em.dataset.e; body.querySelectorAll('[data-e]').forEach((b) => b.setAttribute('aria-pressed', String(b === em))); return; }
      if (c) { review.color = c.dataset.c; body.querySelectorAll('[data-c]').forEach((b) => b.setAttribute('aria-pressed', String(b === c))); return; }
      const more = e.target.closest('[data-more]');
      if (more) { idx = Math.max(0, aisles.indexOf(more.dataset.more)); renderWalk(); return; }
      const r = e.target.closest('[data-rk]');
      if (!r) return;
      const key = r.dataset.rk;
      const act = e.target.closest('[data-ra]');
      if (!act) return;
      const a = act.dataset.ra;
      if (a === 'x') { delete draft.picks[key]; touch(); paintGroups(); }
      else if (a === 'plus' || a === 'minus') {
        const p = draft.picks[key];
        const n = G.walkModel.stepN(p.n, a === 'plus' ? 1 : -1, p.unit);
        if (n <= 0) delete draft.picks[key]; else draft.picks[key] = { ...p, n, raw: null };
        touch(); paintGroups();
      } else if (a === 'edit') editPick(key, paintGroups);
    });
    const name = el.querySelector('#gr-name');
    if (name) name.addEventListener('input', () => { review.title = name.value; });
    el.querySelector('#gr-save').onclick = saveReview;
    paintGroups();
  }

  function paintGroups() {
    const box = el.querySelector('#gr-groups');
    if (!box) return;
    const picks = Object.values(draft.picks).filter((p) => p.n > 0).sort((a, b) => a.t - b.t);
    const order = G.getAisleOrder(W.listId);
    const nums = G.getAisleNumbers();
    el.querySelector('#gr-count').textContent = `${picks.length} item${picks.length === 1 ? '' : 's'}`;
    el.querySelector('#gr-save').disabled = !picks.length && !W.listId;
    if (!picks.length) {
      box.innerHTML = `<div class="empty"><div class="e" aria-hidden="true">🧺</div><h2>Nothing picked yet</h2><p>Walk the aisles and tap what you need ♡</p><button type="button" class="btn" data-more="${aisles[0]}">Start walking</button></div>`;
      return;
    }
    box.innerHTML = G.order.groupByAisle(picks, (p) => p.aisle, order).map((g) => {
      const inf = G.aisleInfo(g.aisle);
      return `<section class="gr-group"><h3 class="label-quiet"><span aria-hidden="true">${inf.emoji}</span> ${esc(G.order.aisleTitle(g.aisle, nums))} <span class="grow"></span><span>${g.items.length}</span></h3>
        <div class="gr-rows card">${g.items.map((p) => `<div class="gr-row" data-rk="${esc(p.key)}">
          <button type="button" class="gr-name" data-ra="edit"><span aria-hidden="true">${esc(p.emoji || '🛍️')}</span> <span><b>${esc(p.name)}</b>${p.note ? `<small class="muted-line">${esc(p.note)}</small>` : ''}</span></button>
          <div class="gw-step"><button type="button" data-ra="minus" aria-label="Less ${esc(p.name)}">${icon.minus}</button><b>${esc(G.walkModel.pickLabel(p))}</b><button type="button" data-ra="plus" aria-label="More ${esc(p.name)}">${icon.plus}</button></div>
          <button type="button" class="icon-btn plain" data-ra="x" aria-label="Remove ${esc(p.name)}">${icon.close}</button>
        </div>`).join('')}</div>
        <button type="button" class="btn link small" data-more="${g.aisle}">＋ add more</button></section>`;
    }).join('');
  }

  async function saveReview() {
    const btn = el.querySelector('#gr-save');
    btn.disabled = true;
    try {
      let id = W.listId, msg;
      if (!W.listId) {
        const title = (review.title || '').trim() || G.walkModel.defaultListName();
        id = await G.createListFromDraft(draft.picks, { title, emoji: review.emoji, color: review.color });
        msg = `${Object.keys(draft.picks).length} things on ${title} ♡`;
      } else {
        const plan = await G.saveDraftToList(W.listId, draft.picks, draft.prefill);
        const bits = [plan.add.length && `${plan.add.length} added`, plan.update.length && `${plan.update.length} changed`, plan.remove.length && `${plan.remove.length} removed`].filter(Boolean);
        msg = bits.length ? `${bits.join(' · ')} ♡` : 'All saved ♡';
      }
      save.cancel();
      finished = true;
      draft.picks = {}; draft.prefill = {};
      await kv.set(G.draftKey(target), null);
      confetti({ count: 50 });
      toast(msg, { emoji: '🛒' });
      fs.close('saved');
      const main = await import('../main.js');
      await main.go('lists', 'lists');
      (await import('../views/lists.js')).openList(id);
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      toast('Couldn’t save that. Try again?');
    }
  }

  // ---------------------------------------------------------------- gestures
  function longPress(box, fn) {
    let t = 0, fired = false;
    box.addEventListener('pointerdown', (e) => {
      const tile = e.target.closest('.gw-tile[data-key]');
      if (!tile || e.button > 0) return;
      fired = false;
      clearTimeout(t);
      t = setTimeout(() => { fired = true; fn(tile); }, 520);
    });
    const cancel = () => clearTimeout(t);
    box.addEventListener('pointerup', cancel);
    box.addEventListener('pointercancel', cancel);
    box.addEventListener('pointermove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancel(); });
    box.addEventListener('click', (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  }
  function swipe(box) {
    let x0 = null, y0 = 0;
    box.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; x0 = e.clientX; y0 = e.clientY; });
    box.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(idx + (dx < 0 ? 1 : -1));
    });
    box.addEventListener('pointercancel', () => (x0 = null));
  }
  el.addEventListener('keydown', (e) => {
    if (mode !== 'walk' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
  });

  renderWalk();
}

/** Clear the "new list" draft (Lists → "or start a fresh one"). */
export async function clearNewDraft() {
  await G.ready;
  return kv.set(G.draftKey('new'), null);
}
