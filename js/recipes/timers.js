// Em&m Blog: kitchen timers (like the app's global timer store). They keep running when cook mode closes,
// show as a slim bar above the tab bar, and ring (chime + confetti + toast) when done.
// A timer: {id, label, total (ms), end (ms epoch) | null when paused, left (ms, when paused), rang}
import { esc, toast, confetti, icon } from '../ui.js';

const timers = new Map();
const listeners = new Set();
let tick = 0;
let bar = null, bubble = null, audioCtx = null;

const now = () => Date.now();
const leftOf = (t) => (t.end == null ? t.left : Math.max(0, t.end - now()));

/** "4:05", "1:02:00" */
export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`;
}

export function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [880, 1175, 1568].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.9);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + i * 0.18); o.stop(t0 + i * 0.18 + 1);
    });
  } catch (e) { /* no audio, that's ok */ }
}

/** Start a timer. seconds > 0. Returns its id. Same key (e.g. recipe+step) restarts it. */
export function startTimer(label, seconds, key = null) {
  const id = key || 't' + now().toString(36) + Math.random().toString(36).slice(2, 5);
  // Unlock audio on this user gesture so the chime can play later.
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* ignore */ }
  timers.set(id, { id, label, total: seconds * 1000, end: now() + seconds * 1000, left: 0, rang: false });
  run();
  toast(`Timer started: ${label}`, { emoji: '⏲️' });
  return id;
}
export function stopTimer(id) { timers.delete(id); closeBubble(); run(); }
export function togglePause(id) {
  const t = timers.get(id);
  if (!t || t.rang) return;
  if (t.end == null) { t.end = now() + t.left; } else { t.left = leftOf(t); t.end = null; }
  run();
}
export function addMinute(id) {
  const t = timers.get(id);
  if (!t) return;
  if (t.rang) { t.rang = false; t.end = now() + 60000; t.total = 60000; }
  else if (t.end == null) t.left += 60000; else t.end += 60000;
  t.total += 60000;
  run();
}
export const listTimers = () => [...timers.values()].map((t) => ({ ...t, leftMs: leftOf(t), paused: t.end == null && !t.rang }));
/** Subscribe to changes (every half second while any timer exists). Returns unsubscribe. */
export function onTimers(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function run() {
  if (timers.size && !tick) tick = setInterval(step, 500);
  if (!timers.size && tick) { clearInterval(tick); tick = 0; }
  step();
}

function step() {
  for (const t of timers.values()) {
    if (!t.rang && t.end != null && t.end <= now()) {
      t.rang = true;
      chime();
      toast(`Timer done: ${t.label}`, { emoji: '⏰', duration: 6000 });
      confetti({ emoji: '⏰✨', count: 30 });
      const id = t.id;
      setTimeout(() => { const x = timers.get(id); if (x && x.rang) { timers.delete(id); run(); } }, 30000);
    }
  }
  draw();
  for (const fn of [...listeners]) { try { fn(listTimers()); } catch (e) { console.error(e); } }
}

// ---------- slim bar ----------
function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'timer-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Kitchen timers');
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tid]');
    if (b) openBubble(b.dataset.tid, b);
  });
  document.body.append(bar);
  return bar;
}

function draw() {
  const list = listTimers();
  document.body.classList.toggle('has-timers', list.length > 0);
  if (!list.length) { if (bar) bar.hidden = true; closeBubble(); return; }
  ensureBar().hidden = false;
  // A dialog (cook mode, sheets) sits in the top layer; keep the bar visible above the page only.
  const html = list.map((t) => `<button type="button" class="tb-item${t.rang ? ' done' : ''}${t.paused ? ' paused' : ''}" data-tid="${esc(t.id)}" aria-label="${esc(t.label)}: ${t.rang ? 'done' : fmtClock(t.leftMs) + ' left'}${t.paused ? ', paused' : ''}. Tap for options">
      <span class="tb-ic" aria-hidden="true">${icon.timer}</span><b>${t.rang ? 'done!' : fmtClock(t.leftMs)}</b><span class="tb-l">${esc(t.label)}</span></button>`).join('');
  if (bar._html !== html) { bar.innerHTML = html; bar._html = html; }
  if (bubble) drawBubble();
}

function openBubble(id, anchor) {
  closeBubble();
  bubble = document.createElement('div');
  bubble.className = 'timer-bubble';
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-label', 'Timer options');
  bubble.dataset.tid = id;
  document.body.append(bubble);
  const r = anchor.getBoundingClientRect();
  bubble.style.left = Math.max(12, Math.min(innerWidth - 312, r.left + r.width / 2 - 150)) + 'px';
  bubble.style.bottom = (innerHeight - r.top + 10) + 'px';
  bubble.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    const tid = bubble.dataset.tid;
    if (a.dataset.a === 'pause') togglePause(tid);
    if (a.dataset.a === 'plus') addMinute(tid);
    if (a.dataset.a === 'cancel') { stopTimer(tid); return; }
    if (a.dataset.a === 'close') closeBubble();
  });
  drawBubble();
  setTimeout(() => {
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', onEsc, true);
    const f = bubble && bubble.querySelector('button');
    if (f) f.focus();
  }, 0);
}
function drawBubble() {
  const t = listTimers().find((x) => x.id === bubble.dataset.tid);
  if (!t) { closeBubble(); return; }
  const html = `<p class="tbb-l">${esc(t.label)}</p><p class="tbb-c">${t.rang ? 'Done ♡' : fmtClock(t.leftMs)}${t.paused ? ' · paused' : ''}</p>
    <div class="tbb-row">${t.rang ? '' : `<button type="button" class="btn soft small" data-a="pause">${t.paused ? icon.play + ' Resume' : icon.pause + ' Pause'}</button>`}
    <button type="button" class="btn soft small" data-a="plus">+1 min</button>
    <button type="button" class="btn ghost small" data-a="cancel">${t.rang ? 'Clear' : 'Cancel'}</button></div>`;
  if (bubble._html !== html) { bubble.innerHTML = html; bubble._html = html; }
}
function outside(e) { if (bubble && !bubble.contains(e.target) && !(bar && bar.contains(e.target))) closeBubble(); }
function onEsc(e) { if (e.key === 'Escape' && bubble) { e.stopPropagation(); closeBubble(); } }
function closeBubble() {
  if (!bubble) return;
  bubble.remove(); bubble = null;
  removeEventListener('pointerdown', outside, true);
  removeEventListener('keydown', onEsc, true);
}
