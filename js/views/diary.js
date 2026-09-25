// Em&m Blog: Diary tab. Today card + prompt of the day, streaks, mood calendar, on this day,
// searchable entry list, notebook editor (autosave), journal read view, save-as-image.
//
// diary doc: {date 'yyyy-mm-dd', mood, weather, title, body, photoIds[], tags[], createdAt, updatedAt, favorite}
import { state, ready, watch, add, set, remove, patchSoon, flushNow, byId, prefs, deleteAsset, blobSrc, errText, thumbSrc } from '../store.js';
import {
  $, esc, sheet, confirmDlg, choose, toast, confetti, reconcile, emptyHTML, debounce, icon,
  todayKey, parseKey, addDays, MONTHS, WEEKDAYS, loadFonts, loadImage, cornerHTML,
} from '../ui.js';
import { saveCanvas, copyText, roundRect, wrapLines, dottedBg, tape, tokens, makeCanvas } from '../share.js';
import { uploadPhoto } from '../posts.js';

// ---------- constants (mirrors the app's src/features/diary/data.ts) ----------
export const MOODS = [
  { id: 'happy', emoji: '😊', label: 'happy', color: '#FFD86B' },
  { id: 'loved', emoji: '🥰', label: 'loved', color: '#FF9EC2' },
  { id: 'excited', emoji: '🤩', label: 'excited', color: '#FFB36B' },
  { id: 'calm', emoji: '😌', label: 'calm', color: '#9FD8C4' },
  { id: 'grateful', emoji: '🙏', label: 'grateful', color: '#C9E59A' },
  { id: 'silly', emoji: '🤪', label: 'silly', color: '#D9B8FF' },
  { id: 'tired', emoji: '😴', label: 'tired', color: '#B9C4DD' },
  { id: 'sad', emoji: '🥺', label: 'sad', color: '#9EC6E8' },
  { id: 'anxious', emoji: '😰', label: 'anxious', color: '#C7B7A3' },
  { id: 'angry', emoji: '😤', label: 'angry', color: '#FF8C8C' },
];
const moodOf = (id) => MOODS.find((m) => m.id === id) || null;
export const WEATHERS = [
  { id: 'sunny', emoji: '☀️', label: 'sunny' },
  { id: 'cloudy', emoji: '☁️', label: 'cloudy' },
  { id: 'rainy', emoji: '🌧️', label: 'rainy' },
  { id: 'snowy', emoji: '❄️', label: 'snowy' },
  { id: 'windy', emoji: '🍃', label: 'windy' },
  { id: 'stormy', emoji: '⛈️', label: 'stormy' },
];
const weatherOf = (id) => WEATHERS.find((w) => w.id === id) || null;

const PROMPTS = [
  'What made you smile today?', 'Three tiny wins from today', 'Something you’re looking forward to', 'A song stuck in your head',
  'Describe today as a dessert', 'What’s one thing you’re grateful for right now?', 'The best thing you ate today',
  'Who made your day a little brighter?', 'A small moment you want to remember', 'If today had a color, what would it be?',
  'Something that made you laugh', 'What did you learn today?', 'A cozy thing you did for yourself', 'Describe your outfit today',
  'What’s on your mind right now?', 'A place you’d love to be right now', 'Something kind someone did for you',
  'Something kind you did for someone', 'What would make tomorrow lovely?', 'A little thing that felt like magic',
  'Your comfort show or movie lately', 'Three words to describe today', 'A memory that popped into your head',
  'What are you proud of this week?', 'Something you want to try soon', 'The sky today looked like…',
  'A smell that reminded you of something', 'What does your perfect lazy day look like?', 'Something you’re excited to tell someone',
  'A tiny goal for tomorrow', 'What’s been making you happy lately?', 'A text that made you smile',
  'Describe today as a weather forecast', 'If today were a movie, what’s the title?', 'Your favorite moment of the day',
  'Something you let go of today', 'A compliment you got (or gave!)', 'What song would be today’s soundtrack?',
  'A dream you had recently', 'Something that felt hard, and how you got through it', 'What’s a little luxury you enjoyed?',
  'Describe your current vibe in emoji', 'Three things in your room you love', 'A snack you’re craving', 'Someone you miss right now',
  'The last photo on your phone and its story', 'A place that feels like home', 'Something you’re looking forward to this month',
  'What would you tell yourself a year ago?', 'A favorite thing about us ♡', 'Today’s little adventure',
  'What made you feel loved today?', 'A habit you’re building', 'Something you noticed on a walk', 'Your current favorite word',
  'A book, show or game you’re into', 'If today was a flower, which one?', 'A wish for this week', 'The coziest part of your day',
  'Write a tiny love note to yourself',
];
const dayNumber = (key) => { const d = parseKey(key); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); };
const promptOfDay = (key = todayKey()) => PROMPTS[dayNumber(key) % PROMPTS.length];

const FONTS = [
  { id: 'caveat', label: 'Caveat', family: "'Caveat', cursive", canvas: 'Caveat', size: 25 },
  { id: 'patrick', label: 'Patrick', family: "'Patrick Hand', cursive", canvas: 'Patrick Hand', size: 20 },
  { id: 'nunito', label: 'Nunito', family: "'Nunito', sans-serif", canvas: 'Nunito', size: 16.5 },
];
const fontId = () => { const f = prefs.get('diary-font', 'caveat'); return FONTS.some((x) => x.id === f) ? f : 'caveat'; };
const fontDef = (id = fontId()) => FONTS.find((f) => f.id === id) || FONTS[0];

const MILESTONES = [3, 7, 14, 30, 100];
function streakMessage(n) {
  if (n >= 100) return `${n} days in a row! You’re a diary legend 👑`;
  if (n >= 30) return `${n} days! A whole month of memories 🌙`;
  if (n >= 14) return `${n} day streak! Two whole weeks ♡`;
  if (n >= 7) return `A full week of pages! ${n} days ✨`;
  return `${n} days in a row, keep going ♡`;
}
/** Consecutive days with an entry, ending today (or yesterday, so it survives until bedtime). */
function computeStreak(dates, today = todayKey()) {
  const s = new Set(dates);
  const wroteToday = s.has(today);
  let day = wroteToday ? today : addDays(today, -1);
  let count = 0;
  while (s.has(day)) { count++; day = addDays(day, -1); }
  return { count, wroteToday, start: addDays(day, 1) };
}

function fmtLongKey(key) {
  const d = parseKey(key);
  const y = d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : '';
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}${y}`;
}
function agoLabel(key, today = todayKey()) {
  const a = parseKey(key), b = parseKey(today);
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (months >= 12 && months % 12 === 0) return months === 12 ? 'a year ago' : `${months / 12} years ago`;
  if (months >= 12) return `${Math.floor(months / 12)}y ${months % 12}m ago`;
  return months === 1 ? 'a month ago' : `${months} months ago`;
}
function addMonths(key, n) {
  const d = parseKey(key);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return todayKey(t);
}
function entryAsText(e) {
  const m = moodOf(e.mood), w = weatherOf(e.weather);
  const head = [fmtLongKey(e.date), m && `${m.emoji} ${m.label}`, w && `${w.emoji} ${w.label}`].filter(Boolean).join('  ·  ');
  const tags = e.tags || [];
  return [head, e.title && `\n${e.title}`, e.body && `\n${e.body}`, tags.length ? `\n${tags.map((t) => '#' + t).join(' ')}` : ''].filter(Boolean).join('\n').trim();
}
const cleanTag = (t) => String(t || '').trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 24);

// ---------- view state ----------
let root = null;
let entries = [];          // sorted date desc (store order)
let loaded = false;
let month = null;          // 'yyyy-mm' shown in the calendar
let query = '';
let tagFilter = '';
let favOnly = false;
let unlocked = false;
let lastToday = todayKey();

const coverOn = () => prefs.get('diary-cover') === '1';
const canWrite = () => state.mode !== 'loading' && state.canWrite;

export function mount(el) {
  root = el;
  month = lastToday.slice(0, 7);
  el.classList.add('diary-view');
  el.innerHTML = `
    <header class="phead">${cornerHTML()}
      <div><h1>Diary</h1><p class="sub">little pages of your days ♡</p></div>
      <div class="actions">
        <span class="status" id="diary-status"></span>
        <button type="button" class="icon-btn" id="diary-menu" aria-label="Diary settings">${icon.more}</button>
      </div>
    </header>
    <div class="diary-cover" id="diary-cover" hidden>
      <button type="button" class="dcover" id="diary-cover-open" aria-label="Open the diary">
        <span class="dcover-strap" aria-hidden="true"></span>
        <img src="img/illustrations/diary-locked.png" alt="" width="150" height="150">
        <b>Em’s diary</b>
        <span>tap to open ♡</span>
      </button>
      <p class="note">This is just a cover so the diary isn’t the first thing people see. It’s not a real lock.</p>
    </div>
    <div class="diary-main" id="diary-main">
      <div class="diary-side">
        <div id="diary-today"></div>
        <div id="diary-cal" class="card dcal"></div>
        <div id="diary-otd"></div>
      </div>
      <div class="diary-entries">
        <div class="dfilters">
          <div class="search"><label class="sr-only" for="diary-search">Search entries</label>${icon.search}
            <input class="txt" id="diary-search" type="search" placeholder="Search your pages…" autocomplete="off"></div>
          <div class="chips scroll" id="diary-tags" role="group" aria-label="Filter entries"></div>
        </div>
        <div id="diary-list" class="dlist"></div>
        <div id="diary-empty"></div>
      </div>
    </div>`;

  const search = $('#diary-search', el);
  const onSearch = debounce(() => { query = search.value.trim().toLowerCase(); renderList(); }, 150);
  search.addEventListener('input', onSearch);

  el.addEventListener('click', onClick);
  $('#diary-menu', el).addEventListener('click', openMenu);
  $('#diary-cover-open', el).addEventListener('click', (e) => {
    unlocked = true;
    const c = e.currentTarget;
    c.classList.add('opening');
    setTimeout(() => { c.classList.remove('opening'); applyCover(); }, 380);
  });

  watch('diary', (list) => {
    entries = list.filter((e) => e && e.date);
    loaded = true;
    render();
    checkMilestone();
  });
  ready.then(() => render());
  applyCover();
  render();
}

export function show() {
  const t = todayKey();
  if (t !== lastToday) { lastToday = t; month = t.slice(0, 7); }
  applyCover();
  if (root) render();
}
export function hide() {
  unlocked = false; // the cover comes back next time
}

function applyCover() {
  if (!root) return;
  const on = coverOn() && !unlocked;
  $('#diary-cover', root).hidden = !on;
  $('#diary-main', root).hidden = on;
}

async function openMenu() {
  const opts = [
    { label: coverOn() ? 'Turn off the diary cover' : 'Put a cover on the diary', emoji: '📕', value: 'cover' },
    { label: 'Handwriting: ' + fontDef().label + ' (change)', emoji: '✍️', value: 'font' },
  ];
  if (canWrite()) opts.unshift({ label: 'Write today’s page', emoji: '📝', value: 'new' });
  const v = await choose({ title: 'Diary ♡', options: opts });
  if (v === 'new') openNewEntry();
  if (v === 'cover') {
    const on = !coverOn();
    prefs.set('diary-cover', on ? '1' : null);
    unlocked = !on ? unlocked : true; // don't cover immediately while you're here
    applyCover();
    toast(on ? 'Cover on. It shows next time you open the diary (just a cover, not a lock)' : 'Cover off ♡', { emoji: '📕' });
  }
  if (v === 'font') {
    const f = await choose({ title: 'Handwriting', options: FONTS.map((x) => ({ label: x.label + (x.id === fontId() ? ' ✓' : ''), value: x.id, emoji: '✍️' })) });
    if (f) { prefs.set('diary-font', f); render(); }
  }
}

// ---------- rendering ----------
function entryForDate(key) { return entries.find((e) => e.date === key) || null; }

function render() {
  if (!root) return;
  const st = $('#diary-status', root);
  st.className = 'status' + (state.memory ? ' preview' : '');
  st.textContent = state.mode === 'loading' ? 'Opening your diary…' : state.memory ? 'Not saved in this window' : '';
  renderToday();
  renderCalendar();
  renderOnThisDay();
  renderTags();
  renderList();
}

function renderToday() {
  const today = todayKey();
  const e = entryForDate(today);
  const streak = computeStreak(entries.map((x) => x.date), today);
  const d = parseKey(today);
  const flame = streak.count >= 3 ? '🔥' : '✨';
  const badge = streak.count
    ? `<span class="dstreak${streak.count >= 3 ? ' hot' : ''}" title="${esc(streakMessage(streak.count))}"><span aria-hidden="true">${flame}</span> ${streak.count} day${streak.count === 1 ? '' : 's'}</span>`
    : '';
  const nextM = MILESTONES.find((m) => m > streak.count);
  const hint = streak.count && !streak.wroteToday ? 'Write today to keep your streak going ♡' : streak.count && nextM ? `${nextM - streak.count} more to ${nextM} ✨` : '';
  $('#diary-today', root).innerHTML = `
    <div class="card tape dtoday">
      <div class="dtoday-top">
        <div class="ddate"><b>${d.getDate()}</b><span>${esc(MONTHS[d.getMonth()].slice(0, 3))}</span></div>
        <div class="dtoday-t"><span class="lbl">${esc(WEEKDAYS[d.getDay()])}</span>
          <p class="dprompt">${esc(promptOfDay(today))}</p></div>
        ${badge}
      </div>
      ${e ? `<button type="button" class="dtoday-peek" data-open="${esc(e.id)}">${moodOf(e.mood) ? `<span class="e" aria-hidden="true">${moodOf(e.mood).emoji}</span>` : ''}<span>${esc(e.title || firstLine(e.body) || 'Today’s page')}</span></button>` : ''}
      <div class="row between">
        <span class="muted small">${esc(hint)}</span>
        ${canWrite() ? `<button type="button" class="btn" id="diary-write" data-act="write-today">${e ? 'Keep writing ✍️' : 'Write today’s page ✍️'}</button>` : ''}
      </div>
    </div>`;
}
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

function renderCalendar() {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysIn = new Date(y, m, 0).getDate();
  const today = todayKey();
  const byDate = new Map();
  for (const e of entries) if (e.date.startsWith(month) && !byDate.has(e.date)) byDate.set(e.date, e);
  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<span class="dc-blank" aria-hidden="true"></span>';
  for (let d = 1; d <= daysIn; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const e = byDate.get(key);
    const mood = e && moodOf(e.mood);
    const future = key > today;
    const label = `${MONTHS[m - 1]} ${d}${e ? ', ' + (mood ? mood.label : 'written') : ''}`;
    cells += `<button type="button" class="dc-day${e ? ' has' : ''}${key === today ? ' today' : ''}" data-day="${key}" ${future ? 'disabled' : ''}
      aria-label="${esc(label)}" ${mood ? `style="--mood:${mood.color}"` : ''}><span class="n">${d}</span>${mood ? `<span class="m" aria-hidden="true">${mood.emoji}</span>` : e ? '<span class="m dot" aria-hidden="true">♡</span>' : ''}</button>`;
  }
  const counts = new Map();
  for (const e of byDate.values()) if (e.mood) counts.set(e.mood, (counts.get(e.mood) || 0) + 1);
  const pills = MOODS.filter((x) => counts.has(x.id)).sort((a, b) => counts.get(b.id) - counts.get(a.id))
    .map((x) => `<span class="dmood-pill" style="--mood:${x.color}"><span aria-hidden="true">${x.emoji}</span> ${esc(x.label)} <b>${counts.get(x.id)}</b></span>`).join('');
  const isNow = month === today.slice(0, 7);
  $('#diary-cal', root).innerHTML = `
    <div class="dc-head">
      <button type="button" class="icon-btn plain" id="diary-prev" data-act="prev" aria-label="Previous month">${icon.back}</button>
      <h3>${esc(MONTHS[m - 1])} <span>${y}</span></h3>
      <button type="button" class="icon-btn plain" id="diary-next" data-act="next" aria-label="Next month" ${isNow ? 'disabled' : ''}>${icon.next}</button>
    </div>
    <div class="dc-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w) => `<span class="dc-w" aria-hidden="true">${w}</span>`).join('')}${cells}</div>
    <div class="dmoods">${pills || `<span class="muted small">${byDate.size ? 'No moods picked this month' : 'No pages this month yet ♡'}</span>`}</div>
    <p class="muted small dc-count">${byDate.size} page${byDate.size === 1 ? '' : 's'} in ${esc(MONTHS[m - 1])}</p>`;
}

function renderOnThisDay() {
  const today = todayKey();
  const md = today.slice(5);
  const ty = today.slice(0, 4);
  const monthAgo = addMonths(today, -1);
  const mem = entries.filter((e) => (e.date.slice(5) === md && e.date.slice(0, 4) < ty) || e.date === monthAgo);
  const box = $('#diary-otd', root);
  if (!mem.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="section-label">On this day <span aria-hidden="true">🕰️</span></div>
    <div class="dotd">${mem.slice(0, 4).map((e) => {
      const mood = moodOf(e.mood);
      return `<button type="button" class="dotd-card pressable" data-open="${esc(e.id)}">
        <span class="lbl">${esc(agoLabel(e.date, today))}</span>
        <b>${mood ? mood.emoji + ' ' : ''}${esc(e.title || firstLine(e.body) || fmtLongKey(e.date))}</b>
        ${e.body && e.title ? `<span class="snip">${esc(firstLine(e.body)).slice(0, 90)}</span>` : ''}</button>`;
    }).join('')}</div>`;
}

function allTags() {
  const c = new Map();
  for (const e of entries) for (const t of e.tags || []) c.set(t, (c.get(t) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map((x) => x[0]);
}
function renderTags() {
  const tags = allTags();
  if (tagFilter && !tags.includes(tagFilter)) tags.unshift(tagFilter);
  const favCount = entries.filter((e) => e.favorite).length;
  $('#diary-tags', root).innerHTML =
    `<button type="button" class="chip" id="diary-tag-all" data-tag="" aria-pressed="${!tagFilter && !favOnly}">All <span class="n">${entries.length || ''}</span></button>` +
    `<button type="button" class="chip" id="diary-tag-fav" data-fav="1" aria-pressed="${favOnly}">♡ Favorites <span class="n">${favCount || ''}</span></button>` +
    tags.map((t, i) => `<button type="button" class="chip" id="diary-tag-${i}" data-tag="${esc(t)}" aria-pressed="${tagFilter === t}">#${esc(t)}</button>`).join('');
}

function filtered() {
  return entries.filter((e) => {
    if (favOnly && !e.favorite) return false;
    if (tagFilter && !(e.tags || []).includes(tagFilter)) return false;
    if (query) {
      const hay = `${e.title || ''}\n${e.body || ''}\n${(e.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

function renderList() {
  const list = $('#diary-list', root);
  const empty = $('#diary-empty', root);
  const rows = [];
  let lastMonth = '';
  const shown = filtered();
  for (const e of shown) {
    const mk = e.date.slice(0, 7);
    if (mk !== lastMonth) {
      lastMonth = mk;
      const [y, m] = mk.split('-').map(Number);
      rows.push({ head: true, key: 'm:' + mk, label: `${MONTHS[m - 1]} ${y}` });
    }
    rows.push(e);
  }
  reconcile(list, rows, (r) => (r.head ? r.key : r.id), createRow, (node, r) => (r.head ? node : createRow(r)));
  if (!loaded && state.mode !== 'local') { empty.innerHTML = '<p class="muted small" style="text-align:center">Opening your pages…</p>'; return; }
  if (shown.length) { empty.innerHTML = ''; return; }
  empty.innerHTML = entries.length
    ? emptyHTML({ img: 'img/illustrations/no-results.png', title: 'Nothing matches', text: 'Try another word or tag.' })
    : emptyHTML({
      img: 'img/illustrations/empty-diary.png', title: 'Your diary is waiting ♡',
      text: canWrite() ? 'Write your very first page. Just a few words about today is perfect.' : 'No pages yet. Check back soon!',
      action: canWrite() ? 'Write the first page' : '', actionId: 'diary-first',
    });
}

function createRow(r) {
  if (r.head) {
    const el = document.createElement('div');
    el.className = 'dmonth';
    el.textContent = r.label;
    el._item = r;
    return el;
  }
  const e = r;
  const d = parseKey(e.date);
  const mood = moodOf(e.mood), w = weatherOf(e.weather);
  const photo = (e.photoIds || [])[0];
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'dentry pressable';
  el.dataset.open = e.id;
  if (mood) el.style.setProperty('--mood', mood.color);
  el.innerHTML = `
    <span class="dentry-date"><b>${d.getDate()}</b><span>${esc(WEEKDAYS[d.getDay()].slice(0, 3))}</span></span>
    <span class="dentry-t">
      <span class="dentry-title">${mood ? `<span aria-hidden="true">${mood.emoji}</span> ` : ''}${esc(e.title || firstLine(e.body) || 'A little page')}</span>
      <span class="dentry-body">${esc(e.title ? firstLine(e.body) : String(e.body || '').split('\n').filter((l) => l.trim())[1] || '').slice(0, 140)}</span>
      <span class="dentry-meta">${w ? `<span>${w.emoji} ${esc(w.label)}</span>` : ''}${(e.tags || []).slice(0, 3).map((t) => `<span>#${esc(t)}</span>`).join('')}${(e.photoIds || []).length ? `<span>📷 ${(e.photoIds || []).length}</span>` : ''}</span>
    </span>
    ${photo ? `<img class="dentry-ph" src="${esc(thumbSrc(photo, 240))}" alt="" loading="lazy" decoding="async">` : ''}
    ${e.favorite ? '<span class="dentry-fav" aria-label="favorite">♥</span>' : ''}`;
  return el;
}

// ---------- events ----------
function onClick(ev) {
  const t = ev.target;
  const open = t.closest('[data-open]');
  if (open) return openEntry(open.dataset.open);
  const day = t.closest('[data-day]');
  if (day) {
    const e = entryForDate(day.dataset.day);
    if (e) return openEntry(e.id);
    if (canWrite()) return openEditor(null, day.dataset.day);
    return toast('No page that day');
  }
  const tag = t.closest('[data-tag]');
  if (tag) { tagFilter = tag.dataset.tag; favOnly = false; renderTags(); renderList(); return; }
  if (t.closest('[data-fav]')) { favOnly = !favOnly; tagFilter = ''; renderTags(); renderList(); return; }
  const act = t.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'write-today') return openNewEntry();
    if (a === 'prev' || a === 'next') {
      const [y, m] = month.split('-').map(Number);
      const d = new Date(y, m - 1 + (a === 'prev' ? -1 : 1), 1);
      month = todayKey(d).slice(0, 7);
      renderCalendar();
    }
  }
  if (t.closest('#diary-first')) openNewEntry();
}

// ---------- streak celebrations ----------
function checkMilestone() {
  if (!loaded) return;
  const s = computeStreak(entries.map((e) => e.date));
  const hit = [...MILESTONES].reverse().find((m) => s.count >= m);
  if (!hit) return;
  const seen = prefs.getJSON('diary-celebrated', {});
  if (seen.start === s.start && seen.m >= hit) return;
  prefs.setJSON('diary-celebrated', { start: s.start, m: hit });
  setTimeout(() => {
    confetti({ emoji: hit >= 100 ? '👑✨' : hit >= 30 ? '🌙✨' : '🔥💖' });
    toast(streakMessage(s.count), { emoji: '🎉', duration: 4200 });
  }, 400);
}

// ---------- open / read view ----------
export async function openNewEntry() {
  await ready;
  const e = entryForDate(todayKey());
  if (e) return canWrite() ? openEditor(e) : openEntry(e.id);
  if (!canWrite()) return toast('This diary is view-only for you ♡', { emoji: '👀' });
  openEditor(null, todayKey());
}

export async function openEntry(id) {
  const e = byId('diary', id);
  if (!e) return toast('That page is gone');
  if (coverOn() && !unlocked) { unlocked = true; applyCover(); }
  const mood = moodOf(e.mood), w = weatherOf(e.weather);
  const f = fontDef();
  const photos = e.photoIds || [];
  const s = sheet({
    title: fmtLongKey(e.date),
    wide: true,
    className: 'dread-sheet',
    body: `
      <article class="journal" style="--dfont:${f.family};--dsize:${f.size}px">
        <div class="jhead">
          ${mood ? `<span class="jsticker" style="--mood:${mood.color}"><span aria-hidden="true">${mood.emoji}</span> ${esc(mood.label)}</span>` : ''}
          ${w ? `<span class="jsticker w"><span aria-hidden="true">${w.emoji}</span> ${esc(w.label)}</span>` : ''}
          ${e.favorite ? '<span class="jsticker fav">♥ favorite</span>' : ''}
        </div>
        ${e.title ? `<h3 class="jtitle">${esc(e.title)}</h3>` : ''}
        ${photos.length ? `<div class="jphotos n${Math.min(photos.length, 4)}">${photos.map((p, i) => `<figure class="jphoto" style="--r:${[-3, 2.5, -1.5, 3][i % 4]}deg"><img src="${esc(blobSrc(p))}" alt="Diary photo ${i + 1}" loading="lazy"></figure>`).join('')}</div>` : ''}
        <div class="jbody">${e.body ? esc(e.body) : '<span class="muted">(no words, just vibes ♡)</span>'}</div>
        ${(e.tags || []).length ? `<div class="jtags">${e.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
      </article>`,
    foot: `
      ${canWrite() ? `<button type="button" class="btn link" id="dread-del" data-a="del" style="color:var(--danger);margin-right:auto">${icon.trash} Delete</button>` : ''}
      <button type="button" class="btn soft small" id="dread-copy" data-a="copy">${icon.copy} Copy</button>
      <button type="button" class="btn soft small" id="dread-save" data-a="save">${icon.download} Save image</button>
      ${canWrite() ? `<button type="button" class="btn soft small" id="dread-fav" data-a="fav" aria-pressed="${!!e.favorite}">${e.favorite ? '♥ Loved' : '♡ Favorite'}</button>
      <button type="button" class="btn small" id="dread-edit" data-a="edit">${icon.edit} Edit</button>` : ''}`,
  });
  s.foot.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const cur = byId('diary', id) || e;
    const a = b.dataset.a;
    if (a === 'copy') copyText(entryAsText(cur));
    if (a === 'save') { b.disabled = true; try { await saveEntryImage(cur); } finally { b.disabled = false; } }
    if (a === 'edit') { s.close('edit'); setTimeout(() => openEditor(cur), 210); }
    if (a === 'fav') {
      const v = !cur.favorite;
      b.textContent = v ? '♥ Loved' : '♡ Favorite';
      b.setAttribute('aria-pressed', v);
      patchSoon('diary', id, { favorite: v }, 300).catch((err) => toast(errText(err)));
      if (v) { const r = b.getBoundingClientRect(); confetti({ emoji: '💖', x: r.left + r.width / 2, y: r.top, count: 24 }); }
    }
    if (a === 'del') {
      const ok = await confirmDlg({ title: 'Delete this page?', message: 'You can undo for a few seconds.', confirmLabel: 'Delete', destructive: true, emoji: '📔' });
      if (!ok) return;
      s.close('del');
      deleteEntry(cur);
    }
  });
}

async function deleteEntry(e) {
  const { id, ...data } = e;
  try { await remove('diary', id); } catch (err) { toast(errText(err)); return; }
  let undone = false;
  const t = setTimeout(() => { if (!undone) (e.photoIds || []).forEach((p) => deleteAsset(p)); }, 7000);
  toast('Page deleted', {
    emoji: '🗑️',
    undo: async () => {
      undone = true; clearTimeout(t);
      try { await set('diary', id, data); toast('Page is back ♡'); } catch (err) { toast(errText(err)); }
    },
  });
}

// ---------- editor ----------
function openEditor(entry, dateKey) {
  if (!canWrite()) return toast('This diary is view-only for you ♡', { emoji: '👀' });
  if (coverOn() && !unlocked) { unlocked = true; applyCover(); }
  let id = entry ? entry.id : null;
  let creating = null;
  let dirtyAfterCreate = false;
  const draft = {
    date: entry ? entry.date : dateKey || todayKey(),
    mood: entry ? entry.mood || null : null,
    weather: entry ? entry.weather || null : null,
    title: entry ? entry.title || '' : '',
    body: entry ? entry.body || '' : '',
    photoIds: entry ? [...(entry.photoIds || [])] : [],
    tags: entry ? [...(entry.tags || [])] : [],
    favorite: entry ? !!entry.favorite : false,
  };
  let fid = fontId();
  const f = () => fontDef(fid);
  const s = sheet({
    title: entry ? 'Dear diary ♡' : 'A new page ♡',
    wide: true,
    className: 'dedit-sheet',
    body: `
      <div class="de-top">
        <div class="field de-datef"><label class="lbl" for="de-date">Date</label>
          <input type="date" class="txt" id="de-date" value="${esc(draft.date)}" max="${todayKey()}"></div>
        <div class="field"><span class="lbl" id="de-font-lbl">Handwriting</span>
          <div class="seg" role="group" aria-labelledby="de-font-lbl">${FONTS.map((x) => `<button type="button" id="de-font-${x.id}" data-font="${x.id}" aria-pressed="${x.id === fid}" style="font-family:${x.family}">${x.label}</button>`).join('')}</div></div>
        <button type="button" class="icon-btn de-fav" id="de-fav" aria-pressed="${draft.favorite}" aria-label="Favorite">${draft.favorite ? '♥' : '♡'}</button>
      </div>
      <div class="field"><span class="lbl" id="de-mood-lbl">How are you feeling?</span>
        <div class="de-moods" role="group" aria-labelledby="de-mood-lbl">${MOODS.map((m) => `<button type="button" id="de-mood-${m.id}" data-mood="${m.id}" aria-pressed="${draft.mood === m.id}" style="--mood:${m.color}"><span class="e" aria-hidden="true">${m.emoji}</span><span>${m.label}</span></button>`).join('')}</div></div>
      <div class="field"><span class="lbl" id="de-weather-lbl">Weather</span>
        <div class="de-weather" role="group" aria-labelledby="de-weather-lbl">${WEATHERS.map((w) => `<button type="button" id="de-weather-${w.id}" data-weather="${w.id}" aria-pressed="${draft.weather === w.id}" title="${w.label}" aria-label="${w.label}">${w.emoji}</button>`).join('')}</div></div>
      <div class="paper" id="de-paper" style="--dfont:${f().family};--dsize:${f().size}px">
        <label class="sr-only" for="de-title">Title</label>
        <input class="de-title" id="de-title" maxlength="120" placeholder="Title (optional)" value="${esc(draft.title)}" autocomplete="off">
        <label class="sr-only" for="de-body">Your page</label>
        <textarea class="de-body" id="de-body" placeholder="${esc(draft.date === todayKey() ? promptOfDay() : 'Dear diary…')}">${esc(draft.body)}</textarea>
      </div>
      <div class="field"><span class="lbl">Photos</span>
        <div class="de-photos" id="de-photos"></div></div>
      <div class="field"><label class="lbl" for="de-tag-input">Tags</label>
        <div class="de-tags" id="de-tags"><input class="de-tag-input" id="de-tag-input" placeholder="add a tag + Enter" maxlength="24" autocomplete="off"></div></div>`,
    foot: `<span class="de-status" id="de-status" aria-live="polite">${entry ? 'saved ♡' : ''}</span>
      <button type="button" class="btn" id="de-done" data-a="done">Done</button>`,
    beforeClose: () => { if (id) flushNow('diary', id); return true; },
    onClose: () => { if (!id && creating) creating.then(() => {}); },
  });
  const B = s.body;
  const status = $('#de-status', s.foot);
  const setStatus = (t, cls = '') => { status.textContent = t; status.className = 'de-status ' + cls; };

  function save(fields) {
    Object.assign(draft, fields);
    setStatus('saving…', 'busy');
    if (!id) {
      if (!creating) {
        const now = Date.now();
        creating = add('diary', { ...draft, createdAt: now, updatedAt: now }).then((nid) => {
          id = nid;
          if (dirtyAfterCreate) { dirtyAfterCreate = false; return patch(draft); }
          setStatus('saved ♡', 'ok');
          if (draft.date === todayKey()) setTimeout(checkMilestone, 200);
        }).catch((err) => { creating = null; setStatus(errText(err), 'bad'); });
      } else dirtyAfterCreate = true;
      return;
    }
    patch(fields);
  }
  function patch(fields) {
    return patchSoon('diary', id, { ...fields, updatedAt: Date.now() }, 700)
      .then(() => setStatus('saved ♡', 'ok'))
      .catch((err) => setStatus(errText(err), 'bad'));
  }

  const body = $('#de-body', B);
  const grow = () => { body.style.height = 'auto'; body.style.height = Math.max(body.scrollHeight, 8 * 32) + 'px'; };
  body.addEventListener('input', () => { grow(); save({ body: body.value }); });
  requestAnimationFrame(grow);
  $('#de-title', B).addEventListener('input', (e) => save({ title: e.target.value }));
  $('#de-date', B).addEventListener('change', (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) save({ date: e.target.value }); });

  B.addEventListener('click', (e) => {
    const t = e.target;
    const fb = t.closest('[data-font]');
    if (fb) {
      fid = fb.dataset.font;
      prefs.set('diary-font', fid);
      B.querySelectorAll('[data-font]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.font === fid));
      const paper = $('#de-paper', B);
      paper.style.setProperty('--dfont', f().family);
      paper.style.setProperty('--dsize', f().size + 'px');
      if (fid === 'patrick') loadFonts(['Patrick Hand']);
      requestAnimationFrame(grow);
      return;
    }
    const mb = t.closest('[data-mood]');
    if (mb) {
      const v = draft.mood === mb.dataset.mood ? null : mb.dataset.mood;
      B.querySelectorAll('[data-mood]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mood === v));
      save({ mood: v });
      return;
    }
    const wb = t.closest('[data-weather]');
    if (wb) {
      const v = draft.weather === wb.dataset.weather ? null : wb.dataset.weather;
      B.querySelectorAll('[data-weather]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.weather === v));
      save({ weather: v });
      return;
    }
    if (t.closest('#de-fav')) {
      const v = !draft.favorite;
      const b = $('#de-fav', B);
      b.setAttribute('aria-pressed', v);
      b.textContent = v ? '♥' : '♡';
      if (v) { const r = b.getBoundingClientRect(); confetti({ emoji: '💖', x: r.left + r.width / 2, y: r.top + r.height / 2, count: 20 }); }
      save({ favorite: v });
      return;
    }
    const rp = t.closest('[data-rmphoto]');
    if (rp) {
      const pid = rp.dataset.rmphoto;
      const next = draft.photoIds.filter((x) => x !== pid);
      save({ photoIds: next });
      renderPhotos();
      // Delete the file once the doc no longer points at it.
      setTimeout(() => { if (!draft.photoIds.includes(pid)) deleteAsset(pid); }, 2500);
      return;
    }
    const rt = t.closest('[data-rmtag]');
    if (rt) { save({ tags: draft.tags.filter((x) => x !== rt.dataset.rmtag) }); renderTagChips(); $('#de-tag-input', B).focus(); }
  });

  // photos
  let uploading = 0;
  function renderPhotos() {
    const box = $('#de-photos', B);
    box.innerHTML = draft.photoIds.map((p, i) => `<div class="de-ph" style="--r:${[-2, 2, -1, 1.5][i % 4]}deg"><img src="${esc(blobSrc(p))}" alt="Photo ${i + 1}"><button type="button" id="de-rm-${i}" data-rmphoto="${esc(p)}" aria-label="Remove photo ${i + 1}">✕</button></div>`).join('')
      + (uploading ? `<div class="de-ph loading" aria-label="Uploading">⏳</div>` : '')
      + (draft.photoIds.length < 8 ? `<label class="de-add" for="de-photo-input"><span aria-hidden="true">📷</span><span>add photo</span><input type="file" id="de-photo-input" accept="image/*" multiple hidden></label>` : '');
    const inp = $('#de-photo-input', box);
    if (inp) inp.addEventListener('change', async () => {
      const files = [...inp.files].filter((x) => x.type.startsWith('image/')).slice(0, 8 - draft.photoIds.length);
      inp.value = '';
      for (const file of files) {
        uploading++; renderPhotos();
        try {
          const r = await uploadPhoto(file);
          save({ photoIds: [...draft.photoIds, r.assetId] });
        } catch (err) { toast(errText(err)); }
        uploading--; renderPhotos();
      }
    });
  }
  renderPhotos();

  // tags
  const tagInput = $('#de-tag-input', B);
  function renderTagChips() {
    const box = $('#de-tags', B);
    box.querySelectorAll('.de-tag').forEach((n) => n.remove());
    for (const [i, t] of draft.tags.entries()) {
      const c = document.createElement('span');
      c.className = 'de-tag';
      c.innerHTML = `#${esc(t)} <button type="button" id="de-rmtag-${i}" data-rmtag="${esc(t)}" aria-label="Remove tag ${esc(t)}">✕</button>`;
      box.insertBefore(c, tagInput);
    }
  }
  const addTag = () => {
    const parts = tagInput.value.split(',').map(cleanTag).filter(Boolean);
    if (!parts.length) return;
    const next = [...draft.tags];
    for (const p of parts) if (!next.includes(p) && next.length < 12) next.push(p);
    tagInput.value = '';
    save({ tags: next });
    renderTagChips();
  };
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
    else if (e.key === 'Backspace' && !tagInput.value && draft.tags.length) { save({ tags: draft.tags.slice(0, -1) }); renderTagChips(); }
  });
  tagInput.addEventListener('blur', addTag);
  renderTagChips();

  s.foot.addEventListener('click', (e) => { if (e.target.closest('[data-a="done"]')) s.close('done'); });
  if (!entry) setTimeout(() => body.focus(), 350);
}

// ---------- save as image ----------
async function saveEntryImage(e) {
  toast('Making your page…', { emoji: '🎨', duration: 1500 });
  const f = fontDef();
  await loadFonts(['Patrick Hand']);
  try { await Promise.all([document.fonts.load('800 40px Sniglet'), document.fonts.load('700 40px Caveat'), document.fonts.load('800 20px Nunito'), document.fonts.load(`40px "${f.canvas}"`)]); } catch (err) { /* ok */ }
  const T = tokens();
  const W = 1080, PAD = 70, CW = W - PAD * 2, IN = 56; // canvas width, outer pad, card width, inner pad
  const TW = CW - IN * 2;
  const bodySize = Math.round(f.size * 1.9), LH = Math.round(Math.max(bodySize * 1.3, 52));
  const bodyFont = `${f.id === 'nunito' ? '600 ' : ''}${bodySize}px "${f.canvas}", cursive`;
  const titleFont = '800 54px Sniglet, Nunito, sans-serif';

  const photos = [];
  for (const p of (e.photoIds || []).slice(0, 4)) { try { photos.push(await loadImage(blobSrc(p))); } catch (err) { /* skip */ } }

  // measure
  const mc = makeCanvas(10, 10).getContext('2d');
  mc.font = titleFont;
  const titleLines = e.title ? wrapLines(mc, e.title, TW).slice(0, 3) : [];
  mc.font = bodyFont;
  let bodyLines = e.body ? wrapLines(mc, e.body, TW) : [];
  if (bodyLines.length > 34) { bodyLines = bodyLines.slice(0, 34); bodyLines[33] = bodyLines[33] + ' …'; }
  const photoH = photos.length ? (photos.length === 1 ? 560 : photos.length === 2 ? 400 : 330 * Math.ceil(photos.length / 2) + 20) : 0;
  const tags = e.tags || [];
  let h = PAD + 40 + IN;          // top + tape room
  h += 60 + 70;                   // date + stickers row
  h += titleLines.length * 64 + (titleLines.length ? 20 : 0);
  h += photoH ? photoH + 40 : 0;
  h += Math.max(bodyLines.length, 3) * LH + 20;
  h += tags.length ? 60 : 0;
  h += IN + 70 + PAD;             // bottom + footer
  const H = Math.round(h);

  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  dottedBg(ctx, W, H, T.bg, T.dot, 30);
  // card
  const cx = PAD, cy = PAD + 30, ch = H - PAD * 2 - 30 - 50;
  ctx.save();
  ctx.shadowColor = 'rgba(120,30,70,.22)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  roundRect(ctx, cx, cy, CW, ch, 36); ctx.fillStyle = T.paper; ctx.fill();
  ctx.restore();
  tape(ctx, W / 2, cy + 4, 220, 50, -0.05, T.tape);

  let y = cy + IN + 20;
  const mood = moodOf(e.mood), w = weatherOf(e.weather);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = T.pink; ctx.font = '700 46px Caveat, cursive';
  ctx.fillText(fmtLongKey(e.date), cx + IN, y + 30);
  y += 60;
  // stickers row
  let sx = cx + IN;
  const sticker = (text, bg) => {
    ctx.font = '800 26px Nunito, sans-serif';
    const tw = ctx.measureText(text).width + 40;
    roundRect(ctx, sx, y, tw, 50, 25); ctx.fillStyle = bg; ctx.fill();
    ctx.fillStyle = '#5B2A43'; ctx.fillText(text, sx + 20, y + 34);
    sx += tw + 12;
  };
  if (mood) sticker(`${mood.emoji} ${mood.label}`, mood.color);
  if (w) sticker(`${w.emoji} ${w.label}`, T.blush);
  if (e.favorite) sticker('♥ favorite', T.blush);
  y += (mood || w || e.favorite) ? 70 : 10;
  // title
  if (titleLines.length) {
    ctx.fillStyle = T.ink; ctx.font = titleFont;
    for (const l of titleLines) { ctx.fillText(l, cx + IN, y + 50); y += 64; }
    y += 20;
  }
  // photos
  if (photos.length) {
    const cols = photos.length === 1 ? 1 : 2;
    const rows = Math.ceil(photos.length / cols);
    const gap = 26;
    const pw = (TW - gap * (cols - 1)) / cols;
    const ph = photos.length === 1 ? 560 : photos.length === 2 ? 400 : 330;
    photos.forEach((img, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const px = cx + IN + c * (pw + gap), py = y + r * (ph + 20);
      ctx.save();
      ctx.translate(px + pw / 2, py + ph / 2);
      ctx.rotate([-0.03, 0.025, -0.015, 0.03][i % 4]);
      ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.shadowColor = 'transparent';
      const bw = 14, iw = pw - bw * 2, ih = ph - bw * 2;
      const scale = Math.max(iw / img.naturalWidth, ih / img.naturalHeight);
      const sw = iw / scale, sh = ih / scale;
      ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, -pw / 2 + bw, -ph / 2 + bw, iw, ih);
      ctx.restore();
      tape(ctx, px + pw / 2, py + 4, 110, 32, [0.06, -0.08, 0.05, -0.04][i % 4], T.tape);
    });
    y += rows * ph + (rows - 1) * 20 + 40;
  }
  // lined paper + body
  ctx.strokeStyle = T.line; ctx.lineWidth = 2;
  const lines = Math.max(bodyLines.length, 3);
  for (let i = 0; i < lines; i++) {
    const ly = y + (i + 1) * LH + 2;
    ctx.beginPath(); ctx.moveTo(cx + IN - 10, ly); ctx.lineTo(cx + CW - IN + 10, ly); ctx.stroke();
  }
  ctx.fillStyle = T.ink; ctx.font = bodyFont;
  bodyLines.forEach((l, i) => ctx.fillText(l, cx + IN, y + (i + 1) * LH - Math.round(LH * 0.22)));
  y += lines * LH + 20;
  // tags
  if (tags.length) {
    ctx.font = '800 26px Nunito, sans-serif'; ctx.fillStyle = T.muted;
    ctx.fillText(tags.slice(0, 8).map((t) => '#' + t).join('  '), cx + IN, y + 34);
  }
  // footer
  ctx.textAlign = 'center';
  ctx.fillStyle = T.pink; ctx.font = '800 34px Sniglet, Nunito, sans-serif';
  ctx.fillText('Em&m Blog ♡', W / 2, H - PAD / 2 - 6);
  await saveCanvas(cv, `em-m-diary-${e.date}`);
}
