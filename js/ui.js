// Em&m Blog: shared UI kit. DOM helpers, sheets/dialogs, confirm, toasts, confetti,
// keyed list reconcile, dates, fonts, wake lock. No dependencies.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape any user text before putting it in HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Build one element (or a fragment when there are several top-level nodes) from an HTML string. */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.childNodes.length === 1 ? t.content.firstChild : t.content;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isPhone = () => matchMedia('(max-width: 699px)').matches;

/** Inline SVG icons (stroke = currentColor). */
export const icon = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.2A1.6 1.6 0 0 0 9.1 20.7h5.8a1.6 1.6 0 0 0 1.6-1.5L17.5 7M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3.5 20 6.5l-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5 4 17.5l3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/></svg>',
  drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5s-6 6.6-6 10.8a6 6 0 0 0 12 0C18 10.1 12 3.5 12 3.5z"/></svg>',
  cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 4.5h2.2l2 11h10.3l1.9-7.5H6.6"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="16.5" cy="19.5" r="1.3"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5 4 6.5v13l5-2 6 2 5-2v-13l-5 2z"/><path d="M9 4.5v13M15 6.5v13"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c.7 4.4 2.1 5.8 6.5 6.5-4.4.7-5.8 2.1-6.5 6.5-.7-4.4-2.1-5.8-6.5-6.5 4.4-.7 5.8-2.1 6.5-6.5z"/><path d="M18.5 15.5c.3 1.6.8 2.1 2.5 2.5-1.7.4-2.2.9-2.5 2.5-.3-1.6-.8-2.1-2.5-2.5 1.7-.4 2.2-.9 2.5-2.5z"/></svg>',
  timer: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3.5h4M18.5 7l1.3-1.3"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.5v13M15 5.5v13"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
};

/** Icon markup with stroke styling baked in (for places without .btn/.icon-btn CSS). */
export const ic = (name, size = 20) => (icon[name] || '').replace('<svg', `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`);

// ---------- body scroll lock (stacked) ----------
let locks = 0;
function lockScroll(on) {
  locks = Math.max(0, locks + (on ? 1 : -1));
  document.body.classList.toggle('no-scroll', locks > 0);
}

// ---------- sheets ----------
/**
 * Open a bottom sheet (phones) / centered card (desktop) inside a modal <dialog>.
 * body/foot may be HTML strings or Nodes. Returns {el, body, foot, close, closed}.
 * `onClose(reason)` runs after it has closed. `beforeClose()` may return false to cancel.
 */
export function sheet({ title = '', body = '', foot = '', wide = false, className = '', onClose, beforeClose, label } = {}) {
  const dlg = document.createElement('dialog');
  const tid = 'sh-' + uid();
  dlg.className = 'sheet' + (wide ? ' wide' : '') + (className ? ' ' + className : '');
  dlg.setAttribute('aria-labelledby', tid);
  dlg.innerHTML = `<div class="sheet-head"><span class="grabber" aria-hidden="true"></span>
      <h2 id="${tid}">${esc(title)}</h2>
      <button type="button" class="icon-btn plain sheet-close" aria-label="Close">${icon.close}</button></div>
    <div class="sheet-body"></div><div class="sheet-foot" hidden></div>`;
  if (label) dlg.setAttribute('aria-label', label);
  const bodyEl = dlg.querySelector('.sheet-body');
  const footEl = dlg.querySelector('.sheet-foot');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  if (foot) { footEl.hidden = false; if (typeof foot === 'string') footEl.innerHTML = foot; else footEl.append(foot); }
  let resolveClosed;
  const closed = new Promise((r) => (resolveClosed = r));
  let closing = false;
  const api = {
    el: dlg, body: bodyEl, foot: footEl, closed,
    setTitle(t) { dlg.querySelector('#' + tid).textContent = t; },
    close(reason) {
      if (closing) return;
      if (beforeClose && beforeClose(reason) === false) return;
      closing = true;
      dlg.classList.add('closing');
      const done = () => { dlg.close(); dlg.remove(); lockScroll(false); resolveClosed(reason); onClose && onClose(reason); };
      if (reducedMotion()) done(); else setTimeout(done, 200);
    },
  };
  dlg.querySelector('.sheet-close').onclick = () => api.close('x');
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); api.close('esc'); });
  dlg.addEventListener('mousedown', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) api.close('backdrop');
  });
  dragToClose(dlg, dlg.querySelector('.sheet-head'), () => api.close('drag'));
  document.body.append(dlg);
  lockScroll(true);
  dlg.showModal();
  // Don't auto-focus the close button; focus the first field if there is one.
  const first = bodyEl.querySelector('[autofocus]');
  dlg.tabIndex = -1;
  if (first) setTimeout(() => first.focus(), 60); else dlg.focus({ preventScroll: true });
  return api;
}

function dragToClose(dlg, handle, close) {
  let y0 = null, dy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (!isPhone() || e.target.closest('button')) return;
    y0 = e.clientY; dy = 0;
    handle.setPointerCapture(e.pointerId);
    dlg.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    dlg.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    dlg.style.transition = 'transform .25s var(--ease)';
    if (dy > 90) { dlg.style.transform = 'translateY(100%)'; setTimeout(close, 120); }
    else dlg.style.transform = '';
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/** A full-screen modal layer (editor, cook mode). Returns {el, close, closed}. */
export function fullscreen({ className = '', label = '', onClose, beforeClose } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'fullscreen' + (className ? ' ' + className : '');
  if (label) dlg.setAttribute('aria-label', label);
  let resolveClosed, closing = false;
  const closed = new Promise((r) => (resolveClosed = r));
  const api = {
    el: dlg, closed,
    close(reason) {
      if (closing) return;
      if (beforeClose && beforeClose(reason) === false) return;
      closing = true;
      dlg.classList.add('closing');
      const done = () => { dlg.close(); dlg.remove(); lockScroll(false); resolveClosed(reason); onClose && onClose(reason); };
      if (reducedMotion()) done(); else setTimeout(done, 170);
    },
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); api.close('esc'); });
  document.body.append(dlg);
  lockScroll(true);
  dlg.showModal();
  return api;
}

/** In-page confirm. Resolves true/false. */
export function confirmDlg({ title = 'Are you sure?', message = '', confirmLabel = 'Yes', cancelLabel = 'Keep it', emoji = '🥺', destructive = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dlg';
    const tid = 'cf-' + uid();
    dlg.setAttribute('aria-labelledby', tid);
    dlg.innerHTML = `<div class="e" aria-hidden="true">${esc(emoji)}</div><h2 id="${tid}">${esc(title)}</h2>${message ? `<p>${esc(message)}</p>` : ''}
      <div class="row"><button type="button" class="btn soft" data-v="0">${esc(cancelLabel)}</button>
      <button type="button" class="btn ${destructive ? 'danger' : ''}" data-v="1">${esc(confirmLabel)}</button></div>`;
    let done = false;
    const finish = (v) => {
      if (done) return; done = true;
      dlg.classList.add('closing');
      setTimeout(() => { dlg.close(); dlg.remove(); resolve(v); }, reducedMotion() ? 0 : 150);
    };
    dlg.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) finish(b.dataset.v === '1'); else if (e.target === dlg) finish(false); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector(destructive ? '[data-v="0"]' : '[data-v="1"]').focus();
  });
}

/** Ask for one line of text. Resolves the string or null. */
export function askText({ title = '', label = '', value = '', placeholder = '', okLabel = 'Save', maxlength = 80, id = 'ask-input' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const s = sheet({
      title,
      body: `<form class="field" id="${id}-form"><label class="lbl" for="${id}">${esc(label)}</label>
        <input class="txt" id="${id}" maxlength="${maxlength}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autofocus></form>`,
      foot: `<button type="button" class="btn soft" data-a="cancel">Cancel</button><button type="button" class="btn" data-a="ok">${esc(okLabel)}</button>`,
      onClose: () => resolve(result),
    });
    const input = s.body.querySelector('input');
    const ok = () => { result = input.value.trim(); s.close('ok'); };
    s.body.querySelector('form').onsubmit = (e) => { e.preventDefault(); ok(); };
    s.foot.onclick = (e) => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'ok') ok(); else s.close('cancel'); };
  });
}

/** Menu of choices. options: [{label, emoji, value, danger}] -> resolves value or null. */
export function choose({ title = '', options = [] } = {}) {
  return new Promise((resolve) => {
    let v = null;
    const s = sheet({
      title,
      body: `<div class="menu-list">${options.map((o, i) => `<button type="button" class="menu-item${o.danger ? ' danger' : ''}" data-i="${i}"><span class="e" aria-hidden="true">${esc(o.emoji || '')}</span>${esc(o.label)}</button>`).join('')}</div>`,
      onClose: () => resolve(v),
    });
    s.body.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { v = options[+b.dataset.i].value; s.close('pick'); } };
  });
}

// ---------- toasts ----------
/** toast('Saved ♡', {emoji, undo: fn, duration}) -> {dismiss} */
export function toast(msg, { emoji = '', undo = null, duration = undo ? 5000 : 2600, action = null } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return { dismiss() {} };
  while (host.children.length > 2) host.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="msg">${emoji ? esc(emoji) + ' ' : ''}${esc(msg)}</span>`;
  const btnSpec = undo ? { label: 'Undo', fn: undo } : action;
  if (btnSpec) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = btnSpec.label;
    b.onclick = () => { dismiss(); btnSpec.fn(); };
    el.append(b);
  }
  host.append(el);
  let t = setTimeout(dismiss, duration);
  el.addEventListener('pointerenter', () => clearTimeout(t));
  el.addEventListener('pointerleave', () => { clearTimeout(t); t = setTimeout(dismiss, 1500); });
  function dismiss() {
    clearTimeout(t);
    if (!el.isConnected) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  }
  return { dismiss };
}

// ---------- confetti ----------
let confettiParts = [];
let confettiRaf = 0;
/**
 * Lightweight canvas confetti. confetti() for a pink burst from the top,
 * confetti({emoji:'🎂', x, y}) to burst from a point (client px), count to tune.
 */
export function confetti({ emoji = '', x = null, y = null, count = 70 } = {}) {
  const cv = document.getElementById('confetti');
  if (!cv) return;
  cv.classList.add('on');
  const small = reducedMotion();
  const cs = getComputedStyle(document.documentElement);
  const colors = [1, 2, 3, 4, 5].map((i) => cs.getPropertyValue('--petal-' + i).trim() || '#FF9EC2').concat(['#FFE08A', '#FFFFFF']);
  const W = innerWidth, H = innerHeight;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const n = small ? Math.min(12, count) : count;
  const emojis = emoji ? [...emoji].filter((c) => c.trim() && c !== '️') : [];
  for (let i = 0; i < n; i++) {
    const fromPoint = x !== null;
    const ang = fromPoint ? Math.random() * Math.PI * 2 : Math.PI / 2 + (Math.random() - 0.5) * 1.2;
    const sp = fromPoint ? 4 + Math.random() * 7 : 2 + Math.random() * 4;
    confettiParts.push({
      x: fromPoint ? x : Math.random() * W,
      y: fromPoint ? y : -20 - Math.random() * H * 0.3,
      vx: Math.cos(ang) * sp,
      vy: fromPoint ? Math.sin(ang) * sp - 4 : Math.sin(ang) * sp,
      r: 5 + Math.random() * 6,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0],
      shape: emojis.length && Math.random() < 0.45 ? 'e' : ['heart', 'dot', 'rect'][(Math.random() * 3) | 0],
      e: emojis.length ? emojis[(Math.random() * emojis.length) | 0] : '',
      life: 0,
      max: small ? 60 : 140 + Math.random() * 80,
    });
  }
  if (!confettiRaf) confettiRaf = requestAnimationFrame(tickConfetti);
}
function tickConfetti() {
  const cv = document.getElementById('confetti');
  const ctx = cv.getContext('2d');
  const dpr = cv.width / innerWidth;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  confettiParts = confettiParts.filter((p) => p.life < p.max && p.y < innerHeight + 40);
  for (const p of confettiParts) {
    p.life++;
    p.vy += 0.16; p.vx *= 0.99; p.vy *= 0.99;
    p.x += p.vx + Math.sin(p.life / 12) * 0.6; p.y += p.vy; p.rot += p.vr;
    const a = p.life > p.max - 30 ? (p.max - p.life) / 30 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === 'e') { ctx.font = `${p.r * 3}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.e, 0, 0); }
    else if (p.shape === 'heart') { heartPath(ctx, 0, 0, p.r * 1.6); ctx.fill(); }
    else if (p.shape === 'dot') { ctx.beginPath(); ctx.arc(0, 0, p.r * 0.7, 0, 6.283); ctx.fill(); }
    else ctx.fillRect(-p.r * 0.6, -p.r * 0.3, p.r * 1.2, p.r * 0.6);
    ctx.restore();
  }
  if (confettiParts.length) confettiRaf = requestAnimationFrame(tickConfetti);
  else { confettiRaf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); cv.classList.remove('on'); }
}
/** Heart path centered at x,y with width s. Also used by frames / share cards. */
export function heartPath(ctx, x, y, s) {
  const k = s / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + k * 0.75);
  ctx.bezierCurveTo(x - k * 1.25, y - k * 0.05, x - k * 0.7, y - k * 1.05, x, y - k * 0.4);
  ctx.bezierCurveTo(x + k * 0.7, y - k * 1.05, x + k * 1.25, y - k * 0.05, x, y + k * 0.75);
  ctx.closePath();
}

// ---------- keyed list reconcile ----------
/**
 * Make `container`'s children match `list`, reusing DOM nodes by key.
 * create(item) -> Node; update(node, item) -> Node (may return a new node) is only called when the
 * item object changed identity. Keeps untouched cards (and their loaded images) alive.
 */
export function reconcile(container, list, keyOf, create, update) {
  const old = new Map();
  for (const n of [...container.children]) if (n.dataset && n.dataset.key) old.set(n.dataset.key, n);
  let ref = container.firstElementChild;
  const seen = new Set();
  for (const item of list) {
    const k = String(keyOf(item));
    seen.add(k);
    let node = old.get(k);
    if (!node) {
      node = create(item);
      node.dataset.key = k;
      node._item = item;
    } else if (node._item !== item) {
      const nn = update ? update(node, item) : create(item);
      if (nn !== node) { nn.dataset.key = k; node.replaceWith(nn); if (ref === node) ref = nn; node = nn; }
      node._item = item;
    }
    if (node !== ref) container.insertBefore(node, ref);
    else ref = ref.nextElementSibling;
  }
  for (const [k, n] of old) if (!seen.has(k)) n.remove();
}

// ---------- empty states ----------
export function emptyHTML({ img = '', emoji = '🌸', title = '', text = '', action = '', actionId = '' } = {}) {
  return `<div class="empty">${img ? `<img src="${esc(img)}" alt="" width="120" height="120">` : `<div class="e" aria-hidden="true">${esc(emoji)}</div>`}
    <h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${action ? `<button type="button" class="btn" ${actionId ? `id="${esc(actionId)}"` : ''}>${esc(action)}</button>` : ''}</div>`;
}

// ---------- dates (local yyyy-mm-dd keys) ----------
const pad = (n) => String(n).padStart(2, '0');
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseKey(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  return new Date(y || 2000, (m || 1) - 1, d || 1);
}
export function addDays(key, n) { const d = parseKey(key); d.setDate(d.getDate() + n); return todayKey(d); }
export const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
/** "Sep 23" (+ year if not this year) from a ms timestamp. */
export function fmtDate(ms) {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''}`;
}
/** "Thursday, September 25" from a key. */
export function fmtLong(key) {
  const d = parseKey(key);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''}`;
}
/** "Sep 25" / "Sep 25, 2024" from a key. */
export function fmtKey(key) {
  const d = parseKey(key);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''}`;
}

// ---------- fonts ----------
const FONT_URLS = {
  Pacifico: 'Pacifico',
  'DM Serif Display': 'DM+Serif+Display',
  'Space Mono': 'Space+Mono:wght@400;700',
  Fredoka: 'Fredoka:wght@500;600;700',
  'Patrick Hand': 'Patrick+Hand',
};
const fontLinks = new Set();
/** Make sure Google Font families are loaded (for canvas drawing). Never rejects. */
export async function loadFonts(families) {
  const missing = families.filter((f) => FONT_URLS[f] && !fontLinks.has(f));
  if (missing.length) {
    missing.forEach((f) => fontLinks.add(f));
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + missing.map((f) => 'family=' + FONT_URLS[f]).join('&') + '&display=swap';
    document.head.append(link);
    await new Promise((r) => { link.onload = r; link.onerror = r; setTimeout(r, 3000); });
  }
  try {
    await Promise.race([
      Promise.all(families.map((f) => document.fonts.load(`40px "${f}"`))),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch (e) { /* fall back to system fonts */ }
}

// ---------- images ----------
export function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.decoding = 'async';
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('image failed: ' + src));
    i.src = src;
  });
}

// ---------- wake lock ----------
/** Keep the screen awake (cook mode). Returns release(). Tolerates rejection. */
export async function keepAwake() {
  let lock = null;
  const req = async () => { try { lock = await navigator.wakeLock.request('screen'); } catch (e) { lock = null; } };
  if (!('wakeLock' in navigator)) return () => {};
  await req();
  const onVis = () => { if (document.visibilityState === 'visible' && lock === null) req(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { document.removeEventListener('visibilitychange', onVis); try { lock && lock.release(); } catch (e) { /* ignore */ } lock = undefined; };
}

/** Wire a file drop zone + input. onFiles(File[]) */
export function fileDrop(zone, input, onFiles, accept = (f) => f.type.startsWith('image/')) {
  input.addEventListener('change', () => { const f = [...input.files].filter(accept); input.value = ''; if (f.length) onFiles(f); });
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => { const f = [...(e.dataTransfer?.files || [])].filter(accept); if (f.length) onFiles(f); });
}

/** Look swatch gradient for a look id. */
export const LOOKS = [
  { id: 'pink', label: 'Pink', a: '#FCE9EF', b: '#C8437D' },
  { id: 'brown', label: 'Brown', a: '#F3E8DD', b: '#9A6443' },
  { id: 'sage', label: 'Sage', a: '#E6EFE2', b: '#557F58' },
  { id: 'lavender', label: 'Lavender', a: '#EFE7F9', b: '#8660C2' },
  { id: 'blue', label: 'Baby blue', a: '#E3EFF9', b: '#3C77AE' },
];
export const lookSwatch = (id) => { const l = LOOKS.find((x) => x.id === id) || LOOKS[0]; return `linear-gradient(135deg,${l.a} 50%,${l.b} 50%)`; };

/** Read a CSS token value (e.g. css('--pink')). */
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The tiny blossom cluster for main tab headers (Home, Today, Lists, Diary). Uses the #fl-* symbols in index.html. */
export const cornerHTML = () => `<svg class="corner" viewBox="0 0 84 60" aria-hidden="true">
  <g style="color:var(--petal-2)"><use href="#fl-bloom" x="40" y="2" width="30" height="30" style="--mid:#FFF3B8"/></g>
  <g style="color:var(--petal-3)"><use href="#fl-bloom" x="62" y="20" width="20" height="20" style="--mid:#FFFFFF"/></g>
  <g style="color:var(--petal-1)"><use href="#fl-daisy" x="24" y="24" width="18" height="18"/></g>
  <use href="#fl-leaf" x="56" y="36" width="16" height="16"/></svg>`;
