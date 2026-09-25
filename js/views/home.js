// Em&m Blog: Home. Boards row with looks, filters, masonry pin grid (keyed + paginated),
// post viewer, composer (photo / video / thought), board editor, next-special-day card.
import { state, ready, watch, items, byId, prefs, add, update, remove, upload, errText, on } from '../store.js';
import { $, esc, h, sheet, confirmDlg, choose, toast, confetti, reconcile, icon, fmtDate, todayKey, fileDrop, LOOKS, lookSwatch, emptyHTML, reducedMotion, cornerHTML } from '../ui.js';
import { postSrc, cardSrc, originalSrc, postSize, hasLegacyDeco, uploadPhoto, videoInfo, createPost, updatePost, saveRender, deletePost } from '../posts.js';
import { saveUrl, copyText } from '../share.js';
import { rankDays, countLabel, prettyDate } from '../days.js';

const PAGE = 60;
const BOARD_EMOJI = ['🌸', '🎀', '💖', '✨', '🦋', '🍓', '🧸', '🌷', '☁️', '🐰', '👗', '🍰', '📸', '🌈', '💌', '🏖️', '🎧', '📚'];
const FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'photo', label: 'Photos' },
  { id: 'video', label: 'Videos' },
  { id: 'thought', label: 'Thoughts' },
  { id: 'collage', label: 'Collages' },
  { id: 'fav', label: '♡ Favorites' },
];
const LEGACY_FRAMES = ['none', 'polaroid', 'dots', 'gingham', 'hearts', 'blossom', 'bow'];

let root, grid, sentinel;
let filter = prefs.get('filter', 'all');
let shown = PAGE;
let firstPaint = true;
let io;

export const currentBoardId = () => { const b = prefs.get('board', 'all'); return b && b !== 'all' && byId('boards', b) ? b : null; };
const boardOf = (id) => byId('boards', id);

// ---------------------------------------------------------------- mount
export function mount(el) {
  root = el;
  el.innerHTML = `
    <header class="phead">${cornerHTML()}
      <div>
        <h1>Em<span class="amp">&amp;</span>m Blog</h1>
        <p class="sub">little things I love, all pinned in one place ♡</p>
      </div>
      <div class="actions">
        <span class="status" id="home-status">Opening your board…</span>
        <button type="button" class="icon-btn" id="home-mode" aria-label="Switch light or dark"></button>
        <a class="icon-btn" id="home-settings" href="#me" aria-label="Settings">${icon.settings}</a>
        <button type="button" class="btn" id="home-new" hidden>${icon.plus.replace('<svg', '<svg fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"')} New post</button>
      </div>
    </header>
    <div class="home-top">
      <div id="home-today"></div>
      <div id="home-special"></div>
    </div>
    <nav class="boards" id="home-boards" aria-label="Boards"></nav>
    <div class="boardhead" id="home-boardhead" hidden></div>
    <div class="filterbar">
      <div class="chips scroll" id="home-filters" role="group" aria-label="Show"></div>
    </div>
    <div id="home-empty"></div>
    <div class="pins" id="home-grid" aria-live="polite"></div>
    <div class="more-sentinel" id="home-more" aria-hidden="true"></div>`;
  grid = $('#home-grid', el);
  sentinel = $('#home-more', el);

  $('#home-new', el).onclick = () => openComposer('photo');
  $('#home-mode', el).onclick = async () => { (await import('../main.js')).setMode(prefs.get('mode') === 'dark' ? 'light' : 'dark'); modeIcon(); };
  modeIcon();
  $('#home-boards', el).addEventListener('click', onBoardsClick);
  $('#home-boardhead', el).addEventListener('click', (e) => { if (e.target.closest('#home-edit-board')) openBoardEditor(boardOf(currentBoardId())); });
  $('#home-filters', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f; prefs.set('filter', filter); shown = PAGE;
    render();
  });
  // Fade images in when they arrive (capturing: load doesn't bubble).
  const loaded = (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('ok'); };
  grid.addEventListener('load', loaded, true);
  grid.addEventListener('error', loaded, true);
  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.pin[data-key]');
    if (c) openViewer(c.dataset.key);
  });
  io = new IntersectionObserver((ents) => {
    if (ents.some((x) => x.isIntersecting) && shown < visible().length) { shown += PAGE; renderGrid(); }
  }, { rootMargin: '900px 0px' });
  io.observe(sentinel);

  watch('posts', render);
  watch('boards', render);
  watch('countdowns', renderSpecial);
  // Today card (tasks) at the top of Home, like the app. Lazy so Home stays fast.
  import('./today.js').then((m) => m.mountTodayCard($('#home-today', el))).catch((e) => console.warn('today card', e));
  ready.then(() => { statusLine(); render(); });
  on('prefs', (k) => { if (k === 'mode') modeIcon(); });
  render();
}

export function show() { renderSpecial(); }
export function hide() {}

function modeIcon() {
  const b = root && $('#home-mode', root);
  if (!b) return;
  const dark = prefs.get('mode') === 'dark';
  b.innerHTML = dark ? icon.sun : icon.moon;
  b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

function statusLine() {
  const s = $('#home-status', root);
  if (state.memory) { s.className = 'status preview'; s.textContent = state.memoryWhy === 'demo' ? 'Demo: not saved' : 'Not saved in this window'; }
  else s.textContent = '';
  $('#home-new', root).hidden = !state.canWrite;
}

// ---------------------------------------------------------------- data views
function inBoard() {
  const b = currentBoardId();
  const all = items('posts');
  return b ? all.filter((p) => p.boardId === b) : all;
}
function visible() {
  const list = inBoard();
  if (filter === 'all') return list;
  if (filter === 'fav') return list.filter((p) => p.favorite);
  return list.filter((p) => p.kind === filter);
}

// ---------------------------------------------------------------- render
function render() {
  if (!root) return;
  renderBoards();
  renderFilters();
  renderGrid();
}

function renderBoards() {
  const all = items('posts');
  const boards = items('boards');
  const cur = currentBoardId() || 'all';
  const counts = new Map();
  for (const p of all) if (p.boardId) counts.set(p.boardId, (counts.get(p.boardId) || 0) + 1);
  const html =
    `<button type="button" class="bpill" data-b="all" aria-pressed="${cur === 'all'}"><span class="e">🏠</span>All <span class="n">${all.length || ''}</span></button>` +
    boards.map((b) => `<button type="button" class="bpill" data-b="${esc(b.id)}" aria-pressed="${cur === b.id}"><span class="e">${esc(b.emoji || '🌸')}</span>${esc(b.name)} <span class="n">${counts.get(b.id) || ''}</span></button>`).join('') +
    (state.canWrite ? `<button type="button" class="bpill add" id="home-add-board"><span class="e">＋</span>New board</button>` : '');
  const nav = $('#home-boards', root);
  if (nav._html !== html) { nav.innerHTML = html; nav._html = html; }
  const bh = $('#home-boardhead', root);
  const b = boardOf(currentBoardId());
  bh.hidden = !b;
  const bhHtml = b ? `<h2>${esc(b.emoji || '🌸')} ${esc(b.name)}</h2>${state.canWrite ? '<button type="button" class="btn soft small" id="home-edit-board">Edit board</button>' : ''}` : '';
  if (bh._html !== bhHtml) { bh.innerHTML = bhHtml; bh._html = bhHtml; }
}

function renderFilters() {
  const list = inBoard();
  const c = { all: list.length, photo: 0, video: 0, thought: 0, collage: 0, fav: 0 };
  for (const p of list) { c[p.kind] = (c[p.kind] || 0) + 1; if (p.favorite) c.fav++; }
  const f = FILTERS.filter((x) => x.id === 'all' || x.id === filter || c[x.id] || (x.id !== 'collage' && x.id !== 'fav'));
  const html = f.map((x) => `<button type="button" class="chip" data-f="${x.id}" aria-pressed="${filter === x.id}">${x.label}<span class="n">${c[x.id] || ''}</span></button>`).join('');
  const el = $('#home-filters', root);
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

function renderGrid() {
  const loaded = state.mode !== 'loading';
  const all = items('posts');
  const list = visible();
  const empty = $('#home-empty', root);
  const b = boardOf(currentBoardId());
  let emptyHtml = '';
  if (loaded && !all.length && !items('boards').length) emptyHtml = welcomeHTML();
  else if (loaded && !list.length) {
    emptyHtml = !inBoard().length && b
      ? emptyHTML({ img: 'img/illustrations/empty-board.png', title: `${b.name} is empty`, text: state.canWrite ? 'Pin something here ♡' : 'Nothing pinned here yet.', action: state.canWrite ? 'Pin something' : '', actionId: 'home-empty-new' })
      : emptyHTML({ img: 'img/illustrations/no-results.png', title: filter === 'fav' ? 'No favorites yet' : `No ${FILTERS.find((x) => x.id === filter)?.label.toLowerCase() || 'posts'} yet`, text: filter === 'fav' ? 'Tap ♡ on a post to keep it here.' : 'Pick “Everything” to see the whole board.' });
  }
  if (empty._html !== emptyHtml) {
    empty.innerHTML = emptyHtml; empty._html = emptyHtml;
    const nb = $('#home-empty-new', empty);
    if (nb) nb.onclick = () => openComposer('photo');
  }
  const page = list.slice(0, shown);
  const animate = !firstPaint && !reducedMotion();
  reconcile(grid, page, (p) => p.id, (p) => { const n = cardEl(p); if (animate) n.classList.add('enter'); return n; }, (node, p) => cardEl(p));
  if (loaded && all.length) firstPaint = false;
}

function welcomeHTML() {
  return `<div class="empty"><img src="img/illustrations/welcome.png" alt="" width="160" height="160">
    <h2>Your board is ready ♡</h2>
    <p>${state.canWrite ? 'Tap ＋ to pin your first photo, video, thought or collage. Everything you pin stays here for next time.' : 'Nothing has been pinned yet. Check back soon!'}</p>
    ${state.canWrite ? '<button type="button" class="btn" id="home-empty-new">Pin something</button>' : ''}</div>
    <div class="pins" style="margin-top:22px" aria-hidden="true">
      <div class="pin example thought t2"><span class="tag">Example</span><div class="inner"><p class="words">iced strawberry matcha + a good book = perfect sunday</p><span class="meta"><span class="heart">♡</span>Sep 21</span></div></div>
      <div class="pin example"><span class="tag">Example</span><div class="inner"><div class="fake">sunset pic</div><div class="cap"><p>golden hour from the pier</p><span class="meta">Sep 18</span></div></div></div>
      <div class="pin example"><span class="tag">Example</span><div class="inner"><div class="fake wide">video</div><div class="cap"><p>puppy zoomies (turn sound on)</p><span class="meta">Video · Sep 14</span></div></div></div>
      <div class="pin example thought t1"><span class="tag">Example</span><div class="inner"><p class="words">note to self: drink water, text grandma, buy more hair clips</p><span class="meta"><span class="heart">♡</span>Sep 10</span></div></div>
    </div>`;
}

// ---------------------------------------------------------------- cards
function decoHTML(src, p, alt, lazy) {
  const st = (p.stickers || []).map((k) => `<span class="stk" style="left:${+k.x}%;top:${+k.y}%;--s:${+k.s}">${esc(k.e)}</span>`).join('');
  const fr = LEGACY_FRAMES.includes(p.frame) ? p.frame : 'none';
  return `<div class="deco fr-${fr}"><div class="pic"><img src="${esc(src)}" alt="${esc(alt)}"${lazy ? ' loading="lazy" decoding="async"' : ''}>${st}</div></div>`;
}

function cardEl(p) {
  const fav = p.favorite ? '<span class="fav" aria-label="Favorite">💗</span>' : '';
  if (p.kind === 'thought') {
    return h(`<button type="button" class="pin thought t${+p.tint || 1}" aria-label="Open thought">${fav}
      <div class="inner"><p class="words">${esc(p.text)}</p><span class="meta"><span class="heart">♡</span>${fmtDate(p.createdAt)}</span></div></button>`);
  }
  const size = postSize(p);
  const ar = size ? ` width="${size.w}" height="${size.h}" style="aspect-ratio:${size.w}/${size.h}"` : '';
  let media;
  if (p.kind === 'video') {
    media = `<div class="media"><video src="${esc(originalSrc(p))}#t=0.1" muted playsinline preload="metadata"></video><span class="badge" aria-hidden="true">▶</span></div>`;
  } else if (hasLegacyDeco(p)) {
    media = decoHTML(cardSrc(p), p, p.text || 'Photo', true);
  } else {
    media = `<div class="media"><img src="${esc(cardSrc(p))}" alt="${esc(p.text || (p.kind === 'collage' ? 'Collage' : 'Photo'))}" loading="lazy" decoding="async"${ar}>${p.kind === 'collage' ? '<span class="badge" aria-hidden="true">🖼️</span>' : ''}</div>`;
  }
  const cap = `<div class="cap">${p.text ? `<p>${esc(p.text)}</p>` : ''}<span class="meta">${p.kind === 'video' ? 'Video · ' : p.kind === 'collage' ? 'Collage · ' : ''}${fmtDate(p.createdAt)}</span></div>`;
  return h(`<button type="button" class="pin ${p.kind}" aria-label="Open ${p.kind}">${fav}<div class="inner">${media}${cap}</div></button>`);
}

// ---------------------------------------------------------------- special day
function renderSpecial() {
  if (!root) return;
  const box = $('#home-special', root);
  const today = todayKey();
  const { upcoming } = rankDays(items('countdowns'), today);
  const next = upcoming[0];
  let html = '';
  if (next) {
    const { d, st } = next;
    html = `<button type="button" class="special-card pressable${st.isToday ? ' today' : ''}" id="home-special-btn">
      <span class="e" aria-hidden="true">${esc(d.emoji || '🎂')}</span>
      <span class="t"><b>${esc(d.title || 'Special day')}</b><span>${st.isToday ? 'it’s today!! 🎉' : prettyDate(st.next, today)}</span></span>
      <span class="n">${st.isToday ? '🎉' : st.days}<small>${st.isToday ? 'today' : st.days === 1 ? 'day to go' : 'days to go'}</small></span></button>`;
  }
  if (box._html === html) return;
  box._html = html;
  box.innerHTML = html;
  const b = $('#home-special-btn', box);
  if (b) b.onclick = async () => { (await import('../main.js')).go('lists', 'days'); };
  if (next && next.st.isToday && prefs.get('confetti-day') !== today + next.d.id) {
    prefs.set('confetti-day', today + next.d.id);
    setTimeout(() => confetti({ emoji: next.d.emoji || '🎉' }), 400);
  }
}

// ---------------------------------------------------------------- boards
function onBoardsClick(e) {
  if (e.target.closest('#home-add-board')) return openBoardEditor(null);
  const b = e.target.closest('[data-b]');
  if (!b) return;
  prefs.set('board', b.dataset.b);
  shown = PAGE;
  firstPaint = true;
  render();
  b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function openBoardEditor(board) {
  let emoji = board ? board.emoji || '🌸' : '🌸';
  let look = board ? board.look || 'pink' : 'pink';
  const s = sheet({
    title: board ? 'Edit board' : 'New board',
    body: `<form class="field" id="board-form" style="gap:16px">
      <div class="field"><label class="lbl" for="board-name">Board name</label>
        <input class="txt" id="board-name" maxlength="40" placeholder="outfits, food, us two…" autocomplete="off" value="${esc(board ? board.name : '')}" autofocus></div>
      <div class="field"><span class="lbl" id="board-emoji-lbl">Cover</span><div class="emoji-row" id="board-emoji" role="group" aria-labelledby="board-emoji-lbl"></div></div>
      <div class="field"><span class="lbl" id="board-look-lbl">Color aesthetic</span><div class="looks" id="board-look" role="group" aria-labelledby="board-look-lbl"></div>
        <p class="note">The whole site switches to this look while the board is open ♡</p></div>
      <p class="err" id="board-err" hidden></p></form>`,
    foot: `${board ? '<button type="button" class="btn link" id="board-delete" style="margin-right:auto;color:var(--danger)">Delete board</button>' : ''}
      <button type="button" class="btn soft" id="board-cancel">Cancel</button><button type="button" class="btn" id="board-save">${board ? 'Save' : 'Create board'}</button>`,
  });
  const drawEmoji = () => { $('#board-emoji', s.el).innerHTML = BOARD_EMOJI.map((e) => `<button type="button" data-e="${e}" aria-pressed="${e === emoji}" aria-label="${e}">${e}</button>`).join(''); };
  const drawLooks = () => { $('#board-look', s.el).innerHTML = LOOKS.map((l) => `<button type="button" class="look" data-l="${l.id}" aria-pressed="${l.id === look}"><i style="background:${lookSwatch(l.id)}"></i>${l.label}</button>`).join(''); };
  drawEmoji(); drawLooks();
  $('#board-emoji', s.el).onclick = (e) => { const x = e.target.closest('[data-e]'); if (x) { emoji = x.dataset.e; drawEmoji(); } };
  $('#board-look', s.el).onclick = (e) => { const x = e.target.closest('[data-l]'); if (x) { look = x.dataset.l; drawLooks(); } };
  $('#board-cancel', s.el).onclick = () => s.close('cancel');
  const save = async () => {
    const name = $('#board-name', s.el).value.trim();
    const err = $('#board-err', s.el);
    if (!name) { err.textContent = 'Give your board a name.'; err.hidden = false; return; }
    const btn = $('#board-save', s.el);
    btn.disabled = true;
    try {
      if (board) await update('boards', board.id, { name, emoji, look });
      else { const id = await add('boards', { name, emoji, look, createdAt: Date.now() }); prefs.set('board', id); }
      s.close('ok');
      render();
      toast(board ? 'Saved ♡' : 'Board created ♡', { emoji });
      if (!board) confetti({ emoji, count: 40 });
    } catch (e) { err.textContent = errText(e); err.hidden = false; btn.disabled = false; }
  };
  $('#board-save', s.el).onclick = save;
  $('#board-form', s.el).onsubmit = (e) => { e.preventDefault(); save(); };
  const del = $('#board-delete', s.el);
  if (del) del.onclick = async () => {
    const mine = items('posts').filter((p) => p.boardId === board.id);
    const ok = await confirmDlg({ title: `Delete “${board.name}”?`, message: mine.length ? `Its ${mine.length} post${mine.length > 1 ? 's' : ''} will stay in All.` : 'It’s empty, so nothing else changes.', confirmLabel: 'Delete board', destructive: true });
    if (!ok) return;
    try {
      for (const p of mine) await update('posts', p.id, { boardId: null });
      await remove('boards', board.id);
      prefs.set('board', 'all');
      s.close('deleted');
      render();
      toast('Board deleted');
    } catch (e) { toast(errText(e)); }
  };
}

function boardOptions(sel) {
  return `<option value="">No board (All only)</option>` + items('boards').map((b) => `<option value="${esc(b.id)}"${b.id === sel ? ' selected' : ''}>${esc(b.emoji || '')} ${esc(b.name)}</option>`).join('');
}

// ---------------------------------------------------------------- viewer
let viewerDlg = null;
function openViewer(id) {
  const p = byId('posts', id);
  if (!p) return;
  if (!viewerDlg) {
    viewerDlg = document.createElement('dialog');
    viewerDlg.className = 'viewer';
    viewerDlg.setAttribute('aria-label', 'Post');
    viewerDlg.tabIndex = -1;
    viewerDlg.addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); });
    viewerDlg.addEventListener('mousedown', (e) => { if (e.target === viewerDlg) { const r = viewerDlg.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeViewer(); } });
    viewerDlg.addEventListener('keydown', (e) => {
      if (e.target.closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    });
    document.body.append(viewerDlg);
  }
  viewerDlg.dataset.id = id;
  drawViewer(p);
  if (!viewerDlg.open) { viewerDlg.classList.remove('closing'); viewerDlg.showModal(); document.body.classList.add('no-scroll'); }
  viewerDlg.focus({ preventScroll: true });
}
function closeViewer() {
  if (!viewerDlg || !viewerDlg.open) return;
  viewerDlg.classList.add('closing');
  setTimeout(() => { viewerDlg.querySelectorAll('video').forEach((v) => v.pause()); viewerDlg.close(); viewerDlg.innerHTML = ''; document.body.classList.remove('no-scroll'); }, reducedMotion() ? 0 : 170);
}
function step(d) {
  const list = visible();
  const i = list.findIndex((x) => x.id === viewerDlg.dataset.id);
  const n = list[i + d];
  if (n) openViewer(n.id);
}

function drawViewer(p) {
  const canEdit = state.canWrite;
  const list = visible();
  const i = list.findIndex((x) => x.id === p.id);
  let stage;
  if (p.kind === 'thought') stage = `<div class="stage stage-note t${+p.tint || 1}"><p>${esc(p.text)}</p></div>`;
  else if (p.kind === 'video') stage = `<div class="stage video"><video src="${esc(originalSrc(p))}" controls playsinline autoplay></video></div>`;
  else if (hasLegacyDeco(p)) stage = `<div class="stage">${decoHTML(postSrc(p), p, p.text || 'Photo')}</div>`;
  else stage = `<div class="stage"><img src="${esc(postSrc(p))}" alt="${esc(p.text || 'Photo')}"></div>`;
  const b = boardOf(p.boardId);
  const editLabel = p.kind === 'collage' ? '🖼️ Edit collage' : p.edit ? '✨ Edit' : '✨ Decorate';
  viewerDlg.classList.toggle('has-media', p.kind !== 'thought');
  viewerDlg.innerHTML = `
    <div style="position:relative;display:grid;min-height:0">
      ${stage}
      <button type="button" class="icon-btn close" id="viewer-close" aria-label="Close">${icon.close}</button>
      ${i > 0 ? `<button type="button" class="icon-btn nav prev" id="viewer-prev" aria-label="Previous">${icon.back}</button>` : ''}
      ${i >= 0 && i < list.length - 1 ? `<button type="button" class="icon-btn nav next" id="viewer-next" aria-label="Next">${icon.next}</button>` : ''}
    </div>
    <div class="foot">
      ${p.kind !== 'thought' && p.text ? `<p class="c">${esc(p.text)}</p>` : ''}
      <span class="meta"><span class="heart">♡</span>${esc(p.kind)} · ${fmtDate(p.createdAt)}${b ? ' · ' + esc(b.emoji || '') + ' ' + esc(b.name) : ''}</span>
      <div class="acts">
        ${canEdit ? `<button type="button" class="btn small ${p.favorite ? '' : 'soft'}" id="viewer-fav" aria-pressed="${!!p.favorite}">${p.favorite ? '💗 Favorite' : '♡ Favorite'}</button>` : ''}
        ${canEdit && (p.kind === 'photo' || p.kind === 'collage') ? `<button type="button" class="btn small soft" id="viewer-edit">${editLabel}</button>` : ''}
        ${p.kind === 'thought' && canEdit ? `<button type="button" class="btn small soft" id="viewer-edit-thought">${icon.edit.replace('<svg', '<svg fill="none" stroke="currentColor" stroke-width="2.2"')} Edit</button>` : ''}
        ${p.kind !== 'thought' ? `<button type="button" class="btn small soft" id="viewer-save">${icon.download.replace('<svg', '<svg fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"')} Save ${p.kind === 'video' ? 'video' : 'image'}</button>` : ''}
        ${p.text ? `<button type="button" class="btn small soft" id="viewer-copy">📋 Copy ${p.kind === 'thought' ? 'text' : 'caption'}</button>` : ''}
      </div>
      ${canEdit ? `<div class="field"><label class="lbl" for="viewer-move">Board</label><select class="txt" id="viewer-move">${boardOptions(p.boardId)}</select></div>
        <div class="row"><button type="button" class="btn link" id="viewer-delete" style="color:var(--danger);padding-left:0">${icon.trash.replace('<svg', '<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"')} Delete</button></div>` : ''}
    </div>`;
  const q = (s) => viewerDlg.querySelector(s);
  q('#viewer-close').onclick = closeViewer;
  const prev = q('#viewer-prev'); if (prev) prev.onclick = () => step(-1);
  const next = q('#viewer-next'); if (next) next.onclick = () => step(1);
  const fav = q('#viewer-fav');
  if (fav) fav.onclick = async (e) => {
    const on = !p.favorite;
    try {
      await updatePost(p.id, { favorite: on });
      if (on) { const r = e.currentTarget?.getBoundingClientRect?.() || fav.getBoundingClientRect(); confetti({ emoji: '💗', x: r.left + r.width / 2, y: r.top, count: 24 }); }
      const np = byId('posts', p.id); if (np) drawViewer(np);
    } catch (err) { toast(errText(err)); }
  };
  const ed = q('#viewer-edit');
  if (ed) ed.onclick = () => editPost(p);
  const et = q('#viewer-edit-thought');
  if (et) et.onclick = () => { closeViewer(); openComposer('thought', p); };
  const sv = q('#viewer-save');
  if (sv) sv.onclick = () => saveUrl(p.kind === 'video' ? originalSrc(p) : postSrc(p), `em-m-${p.kind}-${todayKey(new Date(p.createdAt))}`);
  const cp = q('#viewer-copy');
  if (cp) cp.onclick = () => copyText(p.text);
  const mv = q('#viewer-move');
  if (mv) mv.onchange = async () => {
    const boardId = mv.value || null;
    try { await updatePost(p.id, { boardId }); toast(boardId ? `Moved to ${boardOf(boardId)?.name || 'board'} ♡` : 'Removed from board'); }
    catch (e) { toast(errText(e)); }
  };
  const del = q('#viewer-delete');
  if (del) del.onclick = async () => {
    const ok = await confirmDlg({ title: 'Delete this post?', message: 'You can undo for a few seconds.', confirmLabel: 'Delete', destructive: true, emoji: '🗑️' });
    if (!ok) return;
    try {
      const r = await deletePost(p);
      closeViewer();
      toast('Deleted', { undo: () => r.undo().then(() => toast('Back again ♡')).catch((e) => toast(errText(e))) });
    } catch (e) { toast(errText(e)); }
  };
}

async function editPost(p) {
  try {
    if (p.kind === 'collage') {
      closeViewer();
      const m = await import('../editor/collage.js');
      m.openCollage({ post: p });
      return;
    }
    const m = await import('../editor/editor.js');
    const res = await m.openStoryEditor({ post: p, model: p.edit && p.edit.type === 'story' ? p.edit : null, title: p.edit ? 'Edit' : 'Decorate' });
    if (!res) return;
    if (res.edit && res.edit.base && !res.edit.base.assetId) res.edit.base.assetId = p.assetId;
    toast('Saving…', { emoji: '✨', duration: 1500 });
    await saveRender(p.id, res);
    toast('Saved ♡', { emoji: '✨' });
    confetti({ count: 50 });
    const np = byId('posts', p.id);
    if (np && viewerDlg && viewerDlg.open) drawViewer(np);
  } catch (e) { console.error(e); toast(errText(e)); }
}

// ---------------------------------------------------------------- composer
/** Open the composer. kind: photo|video|thought. editing: an existing thought to edit. */
export async function openComposer(kind = 'photo', editing = null) {
  await ready;
  if (!state.canWrite) { toast('This is view-only for you ♡', { emoji: '👀' }); return; }
  let files = [];
  let urls = [];
  let tint = editing ? +editing.tint || 1 : 1;
  const s = sheet({
    title: editing ? 'Edit thought' : 'Pin something new',
    body: `
      ${editing ? '' : `<div class="kinds" role="group" aria-label="Post type">
        <button type="button" class="kind" id="compose-kind-photo" data-k="photo"><span class="e" aria-hidden="true">📷</span>Photo</button>
        <button type="button" class="kind" id="compose-kind-video" data-k="video"><span class="e" aria-hidden="true">🎬</span>Video</button>
        <button type="button" class="kind" id="compose-kind-thought" data-k="thought"><span class="e" aria-hidden="true">💭</span>Thought</button></div>`}
      <div id="compose-media" class="field" style="gap:12px">
        <label class="drop" id="compose-drop" for="compose-file">
          <span class="e" aria-hidden="true">🌷</span>
          <strong id="compose-drop-title">Choose photos</strong>
          <small id="compose-drop-hint">or drag them here · pick as many as you like</small>
          <input type="file" id="compose-file" accept="image/*" multiple hidden>
        </label>
        <div class="previews" id="compose-previews"></div>
        <div class="field"><label class="lbl" for="compose-caption">Caption (optional)</label>
          <textarea class="txt" id="compose-caption" maxlength="600" rows="2" placeholder="what’s the story here?"></textarea></div>
      </div>
      <div id="compose-thought" class="field" style="gap:12px">
        <div class="field"><label class="lbl" for="compose-thought-text">Your thought</label>
          <textarea class="txt hand" id="compose-thought-text" maxlength="1200" rows="4" placeholder="today I’m grateful for…">${esc(editing ? editing.text : '')}</textarea></div>
        <div class="field"><span class="lbl" id="compose-tint-lbl">Note color</span>
          <div class="swatches" id="compose-tints" role="group" aria-labelledby="compose-tint-lbl">
            ${[1, 2, 3, 4].map((t) => `<button type="button" class="sw-btn" id="compose-tint-${t}" data-t="${t}" aria-label="Note color ${t}" style="background:var(--note-${t})"></button>`).join('')}
          </div></div>
      </div>
      ${editing ? '' : `<div class="field"><label class="lbl" for="compose-board">Board</label><select class="txt" id="compose-board">${boardOptions(currentBoardId() || '')}</select></div>`}
      <div class="progress" id="compose-progress" hidden><i style="width:0"></i></div>
      <p class="err" id="compose-err" hidden></p>`,
    foot: `<span class="status" id="compose-status" style="margin-right:auto"></span>
      <button type="button" class="btn soft" id="compose-decorate" hidden>✨ Decorate first</button>
      <button type="button" class="btn" id="compose-submit">${editing ? 'Save' : 'Pin it'}</button>`,
    beforeClose: (reason) => !(busy && reason !== 'done'),
    onClose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  });
  const q = (sel) => s.el.querySelector(sel);
  const fileInput = q('#compose-file');
  let busy = false;

  const showErr = (m) => { const e = q('#compose-err'); e.textContent = m; e.hidden = !m; };
  function setKind(k) {
    kind = k;
    s.el.querySelectorAll('.kind').forEach((b) => b.setAttribute('aria-pressed', b.dataset.k === k));
    q('#compose-media').hidden = k === 'thought';
    q('#compose-thought').hidden = k !== 'thought';
    fileInput.accept = k === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/*';
    fileInput.multiple = k === 'photo';
    q('#compose-drop-title').textContent = k === 'video' ? 'Choose a video' : 'Choose photos';
    q('#compose-drop-hint').textContent = k === 'video' ? 'or drag it here · MP4 or WebM, up to 20 MB' : 'or drag them here · pick as many as you like';
    setFiles([]);
    if (k === 'thought') setTimeout(() => q('#compose-thought-text').focus(), 50);
  }
  function setFiles(list) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    files = list;
    urls = files.map((f) => URL.createObjectURL(f));
    const pv = q('#compose-previews');
    pv.innerHTML = files.map((f, i) => `<div class="pv">${f.type.startsWith('video') ? `<video src="${urls[i]}" muted></video>` : `<img src="${urls[i]}" alt="Photo ${i + 1}">`}<button type="button" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('');
    q('#compose-decorate').hidden = !(kind === 'photo' && files.length === 1);
    showErr('');
  }
  q('#compose-previews').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) setFiles(files.filter((_, i) => i !== +b.dataset.rm)); };
  fileDrop(q('#compose-drop'), fileInput, (f) => setFiles(kind === 'video' ? f.slice(0, 1) : [...files, ...f]), (f) => (kind === 'video' ? f.type.startsWith('video') : f.type.startsWith('image') || /\.(heic|heif)$/i.test(f.name)));
  s.el.querySelectorAll('.kind').forEach((b) => (b.onclick = () => setKind(b.dataset.k)));
  const drawTints = () => s.el.querySelectorAll('.sw-btn').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.t === tint));
  q('#compose-tints').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { tint = +b.dataset.t; drawTints(); } };
  drawTints();
  setKind(editing ? 'thought' : kind);

  const progress = (done, total) => {
    const bar = q('#compose-progress');
    bar.hidden = !total;
    bar.firstElementChild.style.width = total ? Math.round((done / total) * 100) + '%' : '0';
    q('#compose-status').textContent = total ? (total > 1 ? `Pinning ${Math.min(done + 1, total)} of ${total}…` : 'Pinning…') : '';
  };

  const boardId = () => (q('#compose-board') ? q('#compose-board').value || null : null);

  async function submit(decorate = false) {
    if (busy) return;
    showErr('');
    if (kind === 'thought') {
      const text = q('#compose-thought-text').value.trim();
      if (!text) return showErr('Write something first ♡');
      busy = true;
      try {
        if (editing) await updatePost(editing.id, { text, tint });
        else await createPost({ kind: 'thought', text, tint, boardId: boardId() });
        busy = false; s.close('done');
        toast(editing ? 'Saved ♡' : 'Pinned ♡', { emoji: '💭' });
      } catch (e) { showErr(errText(e)); busy = false; }
      return;
    }
    if (!files.length) return showErr(kind === 'video' ? 'Choose a video first.' : 'Choose at least one photo.');
    const text = q('#compose-caption').value.trim();
    const bId = boardId();
    if (decorate) {
      const m = await import('../editor/editor.js');
      const res = await m.openStoryEditor({ src: urls[0], title: 'Decorate' });
      if (!res) return;
      busy = true; q('#compose-submit').disabled = true;
      progress(0, 1);
      try {
        const up = await uploadPhoto(files[0]);
        if (res.edit && res.edit.base) res.edit.base.assetId = up.assetId;
        await saveRender(null, res, { kind: 'photo', assetId: up.assetId, w: up.w, h: up.h, text, boardId: bId });
        busy = false; s.close('done');
        toast('Pinned ♡', { emoji: '✨' }); confetti({ count: 60 });
      } catch (e) { showErr(errText(e)); busy = false; q('#compose-submit').disabled = false; progress(0, 0); }
      return;
    }
    busy = true; q('#compose-submit').disabled = true;
    let done = 0;
    try {
      for (const f of files) {
        progress(done, files.length);
        if (kind === 'video') {
          const { blob, type } = videoInfo(f);
          const up = await upload(blob, type);
          await createPost({ kind: 'video', assetId: up.id, text, boardId: bId });
        } else {
          const up = await uploadPhoto(f);
          await createPost({ kind: 'photo', assetId: up.assetId, w: up.w, h: up.h, text, boardId: bId });
        }
        done++;
      }
      progress(done, files.length);
      busy = false; s.close('done');
      toast(done > 1 ? `Pinned ${done} posts ♡` : 'Pinned ♡', { emoji: kind === 'video' ? '🎬' : '📷' });
      if (done > 2) confetti({ count: 50 });
    } catch (e) {
      showErr((done ? `Saved ${done} of ${files.length}. ` : '') + errText(e));
      setFiles(files.slice(done));
      busy = false; q('#compose-submit').disabled = false; progress(0, 0);
    }
  }
  q('#compose-submit').onclick = () => submit(false);
  q('#compose-decorate').onclick = () => submit(true);
}

