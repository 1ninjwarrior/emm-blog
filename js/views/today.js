// Em&m Blog: Today tab (the daily planner), the Home "Today" card, the global quick add sheet and the
// Routines editor. Same model as the phone app (src/features/today + src/db/repos/tasks.ts); the pure
// planner logic is the app's own code, compiled into js/app/today/*.
//
// tasks     {title, notes, emoji, area, dueDate, dueTime, repeat, routineId, sort, createdAt, updatedAt, archived}
// taskDone  id `${taskId}|${key}` {taskId, date ('once' | occurrence date), doneAt, skipped}
// routines  {name, kind, emoji, enabled, config:{mode, labels}, sort, createdAt}
// events    see events.js (calendar events; never ticked, shown in "Happening" + Upcoming). Tasks may carry `reminders`.
import { watch, items, byId, add, set, update, remove, batch, loaded, newId } from '../store.js';
import { $, esc, sheet, fullscreen, confirmDlg, choose, toast, confetti, icon, ic, cornerHTML, reducedMotion } from '../ui.js';
import {
  ONCE, todayKey, addDays, dow, weekStart, fromKey, DAY_NAMES, DAY_SHORT, describeDate, describeRepeat, describeWhen,
  formatTime, longDate, buildDayPlan, upNext, indexDone, displayTitle,
} from '../app/today/recurrence.js';
import { parseTask } from '../app/today/parseTask.js';
import { TEMPLATES, templateFor, AREAS } from '../app/today/templates.js';
import { looksLikeEvent } from '../app/today/events.js';
import { fitReminders, normalizeReminders, defaultReminder, describeReminders } from '../app/today/reminders.js';
import { happeningHTML, eventCount, upcomingHTML, openEventSheet, createEvent, reminderChips, armTabPings, bell } from './events.js';

// ------------------------------------------------------------------ data
const toTask = (d) => ({
  id: d.id, title: d.title || '', notes: d.notes || '', emoji: d.emoji || null, area: d.area || null,
  dueDate: d.dueDate || null, dueTime: d.dueTime || null, repeat: d.repeat || null, routineId: d.routineId || null,
  sort: d.sort || 0, createdAt: d.createdAt || 0, updatedAt: d.updatedAt || 0, archived: !!d.archived,
  reminders: normalizeReminders(d.reminders),
});
const toRoutine = (d) => ({
  id: d.id, name: d.name || '', kind: d.kind || 'custom', emoji: d.emoji || null, enabled: d.enabled !== false,
  config: d.config || { mode: 'daily' }, sort: d.sort || 0, createdAt: d.createdAt || 0,
});
const docOf = (t) => { const { id, ...rest } = t; return rest; };

/** Optimistic ticks not written yet: `${taskId}|${key}` -> true/false. */
const ticks = new Map();
const tickTimers = new Map();

function planInput() {
  const done = [];
  const seen = new Set();
  for (const d of items('taskDone')) {
    const k = d.taskId + '|' + d.date;
    seen.add(k);
    const over = ticks.get(k);
    if (over === false) continue;
    done.push({ taskId: d.taskId, date: d.date, doneAt: d.doneAt || 0, skipped: !!d.skipped });
  }
  for (const [k, v] of ticks) {
    if (!v || seen.has(k)) continue;
    const i = k.lastIndexOf('|');
    done.push({ taskId: k.slice(0, i), date: k.slice(i + 1), doneAt: Date.now(), skipped: false });
  }
  return { tasks: items('tasks').map(toTask), done, routines: items('routines').map(toRoutine) };
}
function planFor(date, today = todayKey(), input = planInput()) { return buildDayPlan(input, date, today, indexDone(input.done)); }

const ready = Promise.all(['tasks', 'taskDone', 'routines', 'events'].map(loaded));
const listeners = new Set();
let scheduled = false;
function changed() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); });
}
['tasks', 'taskDone', 'routines', 'events'].forEach((n) => watch(n, changed));
ready.then(armTabPings);

export async function createTask(v) {
  const now = Date.now();
  return add('tasks', {
    title: v.title.trim(), notes: v.notes || '', emoji: v.emoji || null, area: v.area || null,
    dueDate: v.dueDate ?? null, dueTime: v.dueTime ?? null, repeat: v.repeat ?? null, routineId: v.routineId ?? null,
    sort: v.sort ?? 0, createdAt: now, updatedAt: now, archived: false, reminders: normalizeReminders(v.reminders || []),
  });
}
async function updateTask(id, patch) {
  const cur = byId('tasks', id);
  if (!cur) return;
  const ops = [{ c: 'tasks', id, d: { ...docOf(toTask(cur)), ...patch, updatedAt: Date.now() } }];
  // switching between one-off and repeating clears its ticks (like the app)
  if ('repeat' in patch && !!cur.repeat !== !!patch.repeat) for (const d of items('taskDone')) if (d.taskId === id) ops.push({ c: 'taskDone', id: d.id, d: null });
  await batch(ops);
}
async function deleteTask(id) {
  const ops = [{ c: 'tasks', id, d: null }];
  for (const d of items('taskDone')) if (d.taskId === id) ops.push({ c: 'taskDone', id: d.id, d: null });
  await batch(ops);
}
function writeDone(taskId, key, on) {
  const id = taskId + '|' + key;
  return on ? set('taskDone', id, { taskId, date: key, doneAt: Date.now(), skipped: false }) : remove('taskDone', id);
}
/** Optimistic tick; written ~360 ms later (a quick second tap cancels). */
function tick(taskId, key, on) {
  const k = taskId + '|' + key;
  const before = planFor(todayKey());
  ticks.set(k, on);
  clearTimeout(tickTimers.get(k));
  tickTimers.set(k, setTimeout(async () => {
    tickTimers.delete(k);
    try { await writeDone(taskId, key, on); } catch (e) { toast('Couldn’t save that tick. Try again?'); }
    ticks.delete(k);
    changed();
  }, 360));
  changed();
  const after = planFor(todayKey());
  if (on && after.total > 0 && after.doneCount === after.total && before.doneCount < before.total) {
    confetti();
    toast('All done — rest time ♡');
  }
}
/** Move a task to another day. Returns an undo. */
async function snooze(taskId, fromDate, toDate) {
  const t = byId('tasks', taskId);
  if (!t) return () => {};
  if (!t.repeat) {
    const prev = t.dueDate || null;
    await updateTask(taskId, { dueDate: toDate });
    return () => updateTask(taskId, { dueDate: prev });
  }
  const markId = taskId + '|' + fromDate;
  const copyId = 'l' + newId();
  const now = Date.now();
  await batch([
    { c: 'taskDone', id: markId, d: { taskId, date: fromDate, doneAt: now, skipped: true } },
    { c: 'tasks', id: copyId, d: { title: t.title, notes: t.notes || '', emoji: t.emoji || null, area: t.area || null, dueDate: toDate, dueTime: t.dueTime || null, repeat: null, routineId: null, sort: 0, createdAt: now, updatedAt: now, archived: false } },
  ]);
  return () => batch([{ c: 'taskDone', id: markId, d: null }, { c: 'tasks', id: copyId, d: null }]);
}

// routines (same semantics as the app's repo)
const routineStart = () => weekStart(todayKey());
const routineTasks = (rid) => items('tasks').filter((t) => t.routineId === rid).map(toTask).sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);
const choreDay = (t) => (t.repeat && t.repeat.k === 'weekly' && t.repeat.days.length === 1 ? t.repeat.days[0] : null);
const nextRoutineSort = () => items('routines').reduce((n, r) => Math.max(n, (r.sort || 0) + 1), 0);
function choreDoc(title, routineId, repeat, area, sort, archived = false) {
  const now = Date.now();
  return { title, notes: '', emoji: null, area: area || null, dueDate: routineStart(), dueTime: null, repeat, routineId, sort, createdAt: now, updatedAt: now, archived };
}
async function createRoutineFromTemplate(kind) {
  const tpl = templateFor(kind);
  if (!tpl) return null;
  const rid = 'l' + newId();
  const labels = {};
  if (tpl.days) for (const [day, v] of Object.entries(tpl.days)) labels[day] = v.label;
  const ops = [{ c: 'routines', id: rid, d: { name: tpl.name, kind: tpl.kind, emoji: tpl.emoji, enabled: true, config: tpl.mode === 'weekly' ? { mode: 'weekly', labels } : { mode: 'daily' }, sort: nextRoutineSort(), createdAt: Date.now() } }];
  let sort = 0;
  if (tpl.days) for (const [day, v] of Object.entries(tpl.days)) for (const title of v.chores) ops.push({ c: 'tasks', id: 'l' + newId(), d: choreDoc(title, rid, { k: 'weekly', days: [Number(day)] }, tpl.area, sort++) });
  for (const title of tpl.chores || []) ops.push({ c: 'tasks', id: 'l' + newId(), d: choreDoc(title, rid, { k: 'daily' }, tpl.area, sort++) });
  await batch(ops);
  return rid;
}
async function createRoutine(name, mode) {
  return add('routines', { name: name.trim(), kind: 'custom', emoji: null, enabled: true, config: mode === 'weekly' ? { mode: 'weekly', labels: {} } : { mode: 'daily' }, sort: nextRoutineSort(), createdAt: Date.now() });
}
async function setRoutineEnabled(rid, on) {
  const r = byId('routines', rid);
  if (!r) return;
  const ops = [{ c: 'routines', id: rid, d: { ...docOf(toRoutine(r)), enabled: on } }];
  for (const t of routineTasks(rid)) ops.push({ c: 'tasks', id: t.id, d: { ...docOf(t), archived: !on, updatedAt: Date.now() } });
  await batch(ops);
}
async function deleteRoutine(rid) {
  const ops = [{ c: 'routines', id: rid, d: null }];
  const ids = new Set(routineTasks(rid).map((t) => t.id));
  ids.forEach((id) => ops.push({ c: 'tasks', id, d: null }));
  for (const d of items('taskDone')) if (ids.has(d.taskId)) ops.push({ c: 'taskDone', id: d.id, d: null });
  await batch(ops);
}
async function addRoutineChore(rid, title, day) {
  const r = toRoutine(byId('routines', rid));
  const repeat = r.config.mode === 'weekly' && day !== null ? { k: 'weekly', days: [day] } : { k: 'daily' };
  const area = routineTasks(rid)[0]?.area || null;
  await add('tasks', choreDoc(title.trim(), rid, repeat, area, routineTasks(rid).length, !r.enabled));
}
async function moveRoutineDay(rid, from, to) {
  const r = toRoutine(byId('routines', rid));
  if (from === to || r.config.mode !== 'weekly') return;
  const labels = { ...(r.config.labels || {}) };
  const a = labels[String(from)], b = labels[String(to)];
  if (b !== undefined) labels[String(from)] = b; else delete labels[String(from)];
  if (a !== undefined) labels[String(to)] = a; else delete labels[String(to)];
  const ops = [{ c: 'routines', id: rid, d: { ...docOf(r), config: { ...r.config, labels } } }];
  for (const t of routineTasks(rid)) {
    const d = choreDay(t);
    const next = d === from ? to : d === to ? from : null;
    if (next !== null) ops.push({ c: 'tasks', id: t.id, d: { ...docOf(t), repeat: { k: 'weekly', days: [next] }, updatedAt: Date.now() } });
  }
  await batch(ops);
}

// ------------------------------------------------------------------ small helpers
const svgI = (name, size = 18) => ic(name, size);
const checkSvg = svgI('check', 16);
function metaOf(o, today, inRoutine) {
  const parts = [];
  if (o.overdue) { const d = describeDate(o.date, today); parts.push(`from ${d === 'Yesterday' ? 'yesterday' : d}`); }
  if (o.task.repeat && !inRoutine) parts.push(describeRepeat(o.task.repeat));
  if (o.task.area && !inRoutine) parts.push(o.task.area);
  return parts.join(' · ');
}
const routineTitle = (g, date) => `${g.routine.name}${g.label ? ` · ${DAY_NAMES[dow(date)]}: ${g.label}` : ''}`;
function rowHTML(o, today, inRoutine = false, mini = false) {
  const meta = mini ? (o.overdue ? 'from earlier' : '') : metaOf(o, today, inRoutine);
  const time = o.task.dueTime ? formatTime(o.task.dueTime) : '';
  const rings = !o.done && o.task.reminders && o.task.reminders.length && (o.task.dueDate || o.task.repeat);
  return `<div class="tk-row${o.done ? ' done' : ''}" data-id="${esc(o.task.id)}" data-dk="${esc(o.doneKey)}" data-date="${esc(o.date)}">
    <button type="button" class="cbox" role="checkbox" aria-checked="${o.done}" aria-label="${o.done ? 'Not done' : 'Done'}: ${esc(o.task.title)}" data-act="tick">${checkSvg}</button>
    <button type="button" class="tk-main" data-act="open"><span class="tk-title">${esc(displayTitle(o.task))}</span>${meta ? `<span class="tk-meta">${esc(meta)}</span>` : ''}</button>
    ${rings ? `<span class="tk-time" aria-label="Reminder on">${bell(14)}</span>` : ''}${time ? `<span class="tk-time">${esc(time)}</span>` : ''}
    <button type="button" class="icon-btn plain tk-more" data-act="more" aria-label="More for ${esc(o.task.title)}">${icon.more}</button>
  </div>`;
}

/** Ask for a day. Resolves 'yyyy-mm-dd' or null. */
function pickDay(title = 'Move to…', value = addDays(todayKey(), 1)) {
  return new Promise((resolve) => {
    let v = null;
    const s = sheet({
      title,
      body: `<form class="field" id="pd-form"><label class="lbl" for="pd-date">Day</label><input class="txt" type="date" id="pd-date" value="${esc(value)}" required autofocus></form>`,
      foot: `<button type="button" class="btn soft" data-a="x">Cancel</button><button type="button" class="btn" data-a="ok">Move</button>`,
      onClose: () => resolve(v),
    });
    const ok = () => { const d = $('#pd-date', s.body).value; if (d) { v = d; s.close('ok'); } };
    $('#pd-form', s.body).onsubmit = (e) => { e.preventDefault(); ok(); };
    s.foot.onclick = (e) => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'ok') ok(); else s.close('x'); };
  });
}

/** Row interactions shared by the Today list and the Home card. */
function wireRows(box, getViewing) {
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    const row = e.target.closest('.tk-row');
    if (!b || !row || row._swiped) { if (row) row._swiped = false; return; }
    const { id, dk, date } = row.dataset;
    const act = b.dataset.act;
    if (act === 'tick') {
      const on = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', String(on));
      row.classList.toggle('done', on);
      tick(id, dk, on);
    } else if (act === 'open') openTaskSheet(id);
    else if (act === 'more') moreMenu(id, date, getViewing());
  });
  // swipe right = done, swipe left = next day
  let sx = 0, sy = 0, cur = null, dx = 0, horiz = null;
  box.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.tk-row');
    if (!row || e.button !== 0 || e.pointerType === 'mouse') return;
    cur = row; sx = e.clientX; sy = e.clientY; dx = 0; horiz = null;
  });
  box.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (horiz === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) horiz = Math.abs(mx) > Math.abs(my) * 1.3;
    if (!horiz) return;
    dx = mx;
    cur.style.transform = `translateX(${Math.max(-120, Math.min(120, dx))}px)`;
    cur.dataset.swipe = dx > 0 ? 'done' : 'later';
  });
  const end = async () => {
    const row = cur;
    cur = null;
    if (!row || !horiz) return;
    row._swiped = true;
    setTimeout(() => { row._swiped = false; }, 50);
    row.style.transition = 'transform .2s var(--ease)';
    row.style.transform = '';
    setTimeout(() => { row.style.transition = ''; delete row.dataset.swipe; }, 220);
    const { id, dk, date } = row.dataset;
    if (dx > 80) {
      const cb = row.querySelector('.cbox');
      if (cb.getAttribute('aria-checked') !== 'true') { cb.setAttribute('aria-checked', 'true'); row.classList.add('done'); tick(id, dk, true); }
    } else if (dx < -80) {
      const viewing = getViewing();
      const to = addDays(viewing, 1);
      moveTask(id, date, to, viewing);
    }
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', () => { if (cur) { cur.style.transform = ''; cur = null; } });
}
async function moveTask(id, fromDate, to, viewing) {
  const undo = await snooze(id, fromDate, to);
  const label = to === addDays(todayKey(), 1) ? 'tomorrow' : describeDate(to, todayKey());
  toast(`Moved to ${label}`, { undo: () => undo() });
  void viewing;
}
async function moreMenu(id, date, viewing) {
  const t = byId('tasks', id);
  if (!t) return;
  const isToday = viewing === todayKey();
  const v = await choose({ title: t.title, options: [
    { value: 'later', emoji: '🌙', label: isToday ? 'Tomorrow' : 'Next day' },
    { value: 'pick', emoji: '📅', label: 'Pick a day' },
    { value: 'edit', emoji: '✏️', label: 'Edit' },
    { value: 'del', emoji: '🗑️', label: 'Delete', danger: true },
  ] });
  if (v === 'later') moveTask(id, date, addDays(viewing, 1), viewing);
  else if (v === 'pick') { const d = await pickDay(); if (d) moveTask(id, date, d, viewing); }
  else if (v === 'edit') openTaskSheet(id);
  else if (v === 'del') askDelete(id);
}
async function askDelete(id) {
  const t = byId('tasks', id);
  if (!t) return false;
  const ok = await confirmDlg({ title: `Delete “${t.title}”?`, message: t.repeat ? 'It won’t come back on any day.' : '', confirmLabel: 'Delete', emoji: '🗑️', destructive: true });
  if (!ok) return false;
  await deleteTask(id);
  toast('Task deleted');
  return true;
}

// ------------------------------------------------------------------ When editor
const TIME_PRESETS = [{ label: 'Morning', t: '08:00' }, { label: 'Noon', t: '12:00' }, { label: 'Afternoon', t: '15:00' }, { label: 'Evening', t: '19:00' }];
function kindOf(r) {
  if (!r) return 'none';
  if (r.k === 'weekly' && r.days.length === 5 && [1, 2, 3, 4, 5].every((d) => r.days.includes(d)) && !(r.every > 1)) return 'weekdays';
  return r.k;
}
/** Chip-based day/time/repeat editor. Controlled: value {date, time, repeat}; onChange(next). */
function whenEditor(box, value0, onChange, event = false) {
  let value = { ...value0 };
  const today = todayKey();
  const chip = (label, on, attrs) => `<button type="button" class="chip small" aria-pressed="${!!on}" ${attrs}>${esc(label)}</button>`;
  function draw() {
    const kind = kindOf(value.repeat);
    const repeating = kind !== 'none';
    const tomorrow = addDays(today, 1);
    const customDate = value.date && value.date !== today && value.date !== tomorrow;
    const customTime = value.time && !TIME_PRESETS.some((p) => p.t === value.time);
    const r = value.repeat;
    const every = r && r.k !== 'yearly' ? (r.every || 1) : 1;
    box.innerHTML = `
      <div class="we-sec"><div class="lbl">${repeating ? 'Starts' : 'Day'}</div><div class="chips">
        ${chip('Today', value.date === today, 'data-d="today"')}${chip('Tomorrow', value.date === tomorrow, 'data-d="tomorrow"')}
        <label class="chip small we-date" aria-pressed="${!!customDate}">${customDate ? esc(describeDate(value.date, today)) : 'Pick a day'}<input type="date" data-d="pick" value="${esc(value.date || '')}" aria-label="Pick a day"></label>
        ${repeating || event ? '' : chip('Anytime', !value.date, 'data-d="none"')}</div></div>
      <div class="we-sec"><div class="lbl">Time</div><div class="chips">
        ${chip(event ? 'All day' : 'No time', !value.time, 'data-t=""')}${TIME_PRESETS.map((p) => chip(p.label, value.time === p.t, `data-t="${p.t}"`)).join('')}
        <label class="chip small we-date" aria-pressed="${!!customTime}">${customTime ? esc(formatTime(value.time)) : 'Exact time'}<input type="time" data-t="pick" value="${esc(value.time || '')}" aria-label="Exact time"></label></div></div>
      <div class="we-sec"><div class="lbl">Repeat</div><div class="chips">
        ${[['none', 'Never'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']].map(([k, l]) => chip(l, kind === k, `data-r="${k}"`)).join('')}</div>
        ${kind === 'weekly' ? `<div class="chips we-days" role="group" aria-label="Days">${[1, 2, 3, 4, 5, 6, 0].map((d) => chip(DAY_SHORT[d], r.days.includes(d), `data-wd="${d}"`)).join('')}</div>` : ''}
        ${repeating && kind !== 'yearly' ? `<div class="we-every"><span class="muted">Every</span><button type="button" class="icon-btn soft" data-ev="-1" aria-label="Less often">${icon.minus}</button><b>${every}</b><button type="button" class="icon-btn soft" data-ev="1" aria-label="More often">${icon.plus}</button><span class="muted">${kind === 'daily' ? (every === 1 ? 'day' : 'days') : kind === 'monthly' ? (every === 1 ? 'month' : 'months') : every === 1 ? 'week' : 'weeks'}</span></div>` : ''}
      </div>
      <p class="we-sum muted">${esc(describeWhen(value, today))}</p>`;
  }
  function setDate(date) {
    let repeat = value.repeat;
    if (repeat && repeat.k === 'yearly' && date) { const d = fromKey(date); repeat = { k: 'yearly', month: d.getMonth() + 1, day: d.getDate() }; }
    if (repeat && repeat.k === 'monthly' && date) repeat = { ...repeat, day: fromKey(date).getDate() };
    value = { ...value, date: repeat ? (date || today) : date, repeat };
  }
  function setKind(k) {
    const base = value.date || today;
    const d = fromKey(base);
    let repeat = null;
    if (k === 'daily') repeat = { k: 'daily' };
    if (k === 'weekdays') repeat = { k: 'weekly', days: [1, 2, 3, 4, 5] };
    if (k === 'weekly') repeat = { k: 'weekly', days: [dow(base)] };
    if (k === 'monthly') repeat = { k: 'monthly', day: d.getDate() };
    if (k === 'yearly') repeat = { k: 'yearly', month: d.getMonth() + 1, day: d.getDate() };
    value = { ...value, repeat, date: repeat ? base : value.date };
  }
  const emit = () => { draw(); onChange(value); };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.d === 'today') setDate(today);
    else if (b.dataset.d === 'tomorrow') setDate(addDays(today, 1));
    else if (b.dataset.d === 'none') setDate(null);
    else if (b.dataset.t !== undefined) value = { ...value, time: b.dataset.t || null };
    else if (b.dataset.r) setKind(b.dataset.r);
    else if (b.dataset.wd !== undefined) {
      const day = +b.dataset.wd, r = value.repeat;
      const has = r.days.includes(day);
      if (has && r.days.length === 1) return;
      value = { ...value, repeat: { ...r, days: has ? r.days.filter((x) => x !== day) : [...r.days, day] } };
    } else if (b.dataset.ev) {
      const r = value.repeat;
      const ev = Math.min(r.k === 'daily' ? 60 : 12, Math.max(1, (r.every || 1) + +b.dataset.ev));
      value = { ...value, repeat: { ...r, every: ev } };
    } else return;
    emit();
  });
  box.addEventListener('change', (e) => {
    const i = e.target;
    if (i.dataset.d === 'pick' && i.value) setDate(i.value);
    else if (i.dataset.t === 'pick' && i.value) value = { ...value, time: i.value };
    else return;
    emit();
  });
  draw();
  return { get: () => value };
}
export function openWhenSheet(value, title = 'When?', event = false) {
  return new Promise((resolve) => {
    let out = null, cur = value;
    const s = sheet({
      title, body: '<div class="we"></div>',
      foot: `<button type="button" class="btn soft" data-a="x">Cancel</button><button type="button" class="btn" data-a="ok">Done</button>`,
      onClose: () => resolve(out),
    });
    whenEditor($('.we', s.body), value, (v) => { cur = v; }, event);
    s.foot.onclick = (e) => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'ok') out = cur; s.close(a.dataset.a); };
  });
}

// ------------------------------------------------------------------ quick add bar
/**
 * The natural-language add bar. Enter adds and keeps focus; the chip under it shows what it understood
 * ("Fri · 3:00 PM"); tap it to adjust. getFallback() = the day being viewed (when no day is said).
 */
function quickAddBar(box, { getFallback, autofocus = false, onAdded, kind: kind0 = 'task', toggle = false } = {}) {
  box.innerHTML = `<form class="qa" autocomplete="off">
      ${toggle ? `<div class="seg qa-kind" role="group" aria-label="Add a"><button type="button" data-k="task">Task</button><button type="button" data-k="event">Event</button></div>` : ''}
      <div class="qa-field"><span class="qa-plus" aria-hidden="true">${svgI('plus', 18)}</span>
      <input class="txt qa-input" name="q" placeholder="Add a task… “laundry tomorrow”" aria-label="Add a task" enterkeyhint="done" maxlength="200" ${autofocus ? 'autofocus' : ''}>
      <button type="submit" class="btn small qa-add" hidden>Add</button></div>
      <div class="chips qa-chips" hidden><button type="button" class="chip small qa-chip" aria-label="Change when"></button>
        <button type="button" class="chip small qa-bell" aria-label="Reminder"></button>
        <button type="button" class="chip small qa-ev" hidden>📅 Event?</button></div>
      <div class="qa-rem" hidden></div>
    </form>`;
  const form = $('form', box), input = $('.qa-input', box), chipEl = $('.qa-chip', box), addBtn = $('.qa-add', box);
  const chips = $('.qa-chips', box), bellEl = $('.qa-bell', box), evEl = $('.qa-ev', box), remBox = $('.qa-rem', box);
  let override = null, kind = kind0, reminders = [], remUi = null;
  const today = () => todayKey();
  const whenOf = (text) => {
    let w = override;
    if (!w) {
      const p = parseTask(text, today());
      w = { date: p.date ?? (p.anytime || p.repeat ? null : getFallback()), time: p.time, repeat: p.repeat };
    }
    return kind === 'event' && !w.date ? { ...w, date: getFallback() || today() } : w;
  };
  const refresh = () => {
    const has = !!input.value.trim();
    chips.hidden = !has; addBtn.hidden = !has;
    input.placeholder = kind === 'event' ? 'Add an event… “dinner with mom fri 7pm”' : 'Add a task… “laundry tomorrow”';
    box.querySelectorAll('[data-k]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === kind)));
    if (!has) { remBox.hidden = true; return; }
    const w = whenOf(input.value);
    chipEl.innerHTML = `${svgI(w.repeat ? 'repeat' : 'calendar', 15)} ${esc(kind === 'event' && !w.time ? describeWhen(w, today()) + ' · All day' : describeWhen(w, today()))}`;
    const can = kind === 'event' || !!w.date || !!w.repeat;
    const shown = can ? fitReminders(reminders, !!w.time) : [];
    bellEl.hidden = !can;
    bellEl.innerHTML = `${bell(14)}${shown.length ? ' ' + esc(shown.length > 1 ? `${shown.length} reminders` : describeReminders(shown, !!w.time)) : ''}`;
    bellEl.setAttribute('aria-pressed', String(shown.length > 0));
    if (remUi) remUi.setTimed(!!w.time);
    evEl.hidden = !(kind === 'task' && looksLikeEvent(input.value, parseTask(input.value, today())));
    evEl.textContent = toggle ? '📅 Looks like an event · make it one' : '📅 Event?';
  };
  const setKind = (k) => { kind = k; refresh(); input.focus(); };
  input.addEventListener('input', refresh);
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) setKind(b.dataset.k); });
  evEl.onclick = () => setKind('event');
  chipEl.onclick = async () => {
    const v = await openWhenSheet(whenOf(input.value), 'When?', kind === 'event');
    if (v) override = v;
    refresh();
    input.focus();
  };
  bellEl.onclick = () => {
    const w = whenOf(input.value);
    if (!reminders.length) reminders = [defaultReminder(!!w.time)];
    remBox.hidden = !remBox.hidden || !reminders.length;
    if (!remUi) remUi = reminderChips(remBox, reminders, !!w.time, (v) => { reminders = v; refresh(); });
    refresh();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value;
    const p = parseTask(text, today());
    const title = p.title || (override ? text.trim() : '');
    if (!title) { toast('Give it a name ♡', { emoji: '✏️' }); return; }
    const w = whenOf(text);
    const rs = fitReminders(reminders, !!w.time);
    input.value = ''; override = null; reminders = []; remUi = null; remBox.innerHTML = ''; remBox.hidden = true;
    const wasEvent = kind === 'event';
    if (!toggle) kind = 'task';
    refresh(); input.focus();
    if (wasEvent) {
      await createEvent({ title, date: w.date, start: w.time, allDay: !w.time, repeat: w.repeat, reminders: rs });
      toast(`Event added · ${w.repeat ? describeRepeat(w.repeat) : describeDate(w.date, today())}${w.time ? ` · ${formatTime(w.time)}` : ''} ♡`, { emoji: '📅' });
    } else {
      await createTask({ title, dueDate: w.date, dueTime: w.time, repeat: w.repeat, reminders: w.date || w.repeat ? rs : [] });
      if (w.repeat) toast(`Added · ${describeRepeat(w.repeat)} ♡`);
      else if (w.date !== getFallback()) toast(`Added ${w.date ? `for ${describeDate(w.date, today())}` : 'to Anytime'} ♡`);
    }
    armTabPings();
    onAdded && onAdded(w);
  };
  refresh();
  return { input, set(text) { input.value = text; refresh(); } };
}

/** The global quick add (Create → Task, Home card "Add"): Task | Event. */
export function openQuickAdd(dateKey = null, kind = 'task') {
  const t = todayKey();
  const title = dateKey && dateKey !== t ? `Add to ${describeDate(dateKey, t) === 'Tomorrow' ? 'tomorrow' : longDate(dateKey)}` : 'Add something';
  const s = sheet({ title, body: '<div class="qa-host"></div><p class="note muted">Try “dentist Friday 3pm” or “dinner with mom fri 7pm” ♡</p>' });
  quickAddBar($('.qa-host', s.body), { getFallback: () => dateKey || todayKey(), autofocus: true, kind, toggle: true });
  setTimeout(() => $('.qa-input', s.body)?.focus(), 80);
  return s;
}

// ------------------------------------------------------------------ task sheet
export function openTaskSheet(id) {
  const t0 = byId('tasks', id);
  if (!t0) return;
  const t = toTask(t0);
  let when = { date: t.dueDate, time: t.dueTime, repeat: t.repeat };
  let area = t.area || '';
  let custom = !!area && !AREAS.includes(area);
  const s = sheet({
    title: 'Edit task',
    body: `<div class="field"><label class="lbl" for="ts-title">Task</label><input class="txt" id="ts-title" maxlength="200" value="${esc(t.title)}" placeholder="What needs doing?"></div>
      <div class="field"><span class="lbl">When</span><button type="button" class="chip ts-when">${svgI('calendar', 15)} <span></span></button></div>
      <div class="field ts-rem-f"><span class="lbl">Remind me</span><div class="ts-rem"></div></div>
      <div class="field"><span class="lbl">Area</span><div class="chips ts-areas"></div><input class="txt ts-custom" maxlength="30" placeholder="Garden, Pets, Study…" hidden></div>
      <div class="field"><label class="lbl" for="ts-notes">Notes</label><textarea class="txt" id="ts-notes" rows="3" placeholder="Anything to remember">${esc(t.notes)}</textarea></div>
      <div class="field"><label class="lbl" for="ts-emoji">Emoji (optional)</label><input class="txt" id="ts-emoji" maxlength="8" value="${esc(t.emoji || '')}" placeholder="🌿" style="max-width:120px"></div>`,
    foot: `<button type="button" class="btn ghost" data-a="del">${icon.trash} Delete</button><span style="flex:1"></span><button type="button" class="btn soft" data-a="x">Cancel</button><button type="button" class="btn" data-a="save">Save</button>`,
  });
  const whenLbl = $('.ts-when span', s.body);
  let reminders = t.reminders || [];
  const rem = reminderChips($('.ts-rem', s.body), reminders, !!when.time, (v) => { reminders = v; });
  const drawWhen = () => {
    whenLbl.textContent = describeWhen(when, todayKey());
    $('.ts-rem-f', s.body).hidden = !when.date && !when.repeat; // anytime tasks have no day to ring on
    rem.setTimed(!!when.time);
  };
  const customIn = $('.ts-custom', s.body);
  const drawAreas = () => {
    $('.ts-areas', s.body).innerHTML = [['', 'None'], ...AREAS.map((a) => [a, a]), ['__custom', 'Other…']]
      .map(([v, l]) => `<button type="button" class="chip small" data-area="${esc(v)}" aria-pressed="${v === '__custom' ? custom : !custom && area === v}">${esc(l)}</button>`).join('');
    customIn.hidden = !custom;
    if (custom) customIn.value = area;
  };
  drawWhen(); drawAreas();
  $('.ts-when', s.body).onclick = async () => { const v = await openWhenSheet(when); if (v) { when = v; drawWhen(); } };
  $('.ts-areas', s.body).onclick = (e) => {
    const b = e.target.closest('[data-area]');
    if (!b) return;
    if (b.dataset.area === '__custom') { custom = true; area = AREAS.includes(area) ? '' : area; drawAreas(); customIn.focus(); return; }
    custom = false; area = b.dataset.area; drawAreas();
  };
  s.foot.onclick = async (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'x') return s.close('x');
    if (a.dataset.a === 'del') { if (await askDelete(id)) s.close('del'); return; }
    const title = $('#ts-title', s.body).value.trim();
    if (!title) return toast('It needs a name ♡', { emoji: '✏️' });
    const ar = custom ? customIn.value.trim() : area;
    await updateTask(id, { title, notes: $('#ts-notes', s.body).value, emoji: $('#ts-emoji', s.body).value.trim() || null, area: ar || null, dueDate: when.date, dueTime: when.time, repeat: when.repeat, reminders: when.date || when.repeat ? rem.get() : [] });
    armTabPings();
    toast('Saved ♡');
    s.close('save');
  };
}

// ------------------------------------------------------------------ Today tab
let root, listBox, viewing = null, userPicked = false;
const folded = new Set(['anytime', 'done']);

export function mount(el) {
  root = el;
  el.classList.add('today-view');
  el.innerHTML = `
    <header class="phead">${cornerHTML()}
      <div><h1 id="td-title">Today</h1><p class="sub" id="td-sub"></p></div>
      <div class="actions"><a class="btn soft small" href="#routines">${svgI('repeat', 16)} Routines</a></div>
    </header>
    <div class="td-week" id="td-week" role="group" aria-label="This week"></div>
    <div class="td-progress" id="td-progress" hidden><span class="muted-line" id="td-count"></span><div class="pbar"><i></i></div></div>
    <div class="td-qa" id="td-qa"></div>
    <div id="td-garden"></div>
    <div class="td-list" id="td-list" aria-live="polite"></div>`;
  listBox = $('#td-list', el);
  quickAddBar($('#td-qa', el), { getFallback: () => viewDay() });
  $('#td-week', el).onclick = (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    viewing = b.dataset.day === todayKey() ? null : b.dataset.day;
    userPicked = !!viewing;
    render();
  };
  // long-press (touch) / right-click a day: add something to it
  $('#td-week', el).addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b || b.classList.contains('td-back')) return;
    e.preventDefault();
    openQuickAdd(b.dataset.day);
  });
  listBox.addEventListener('click', (e) => {
    const h = e.target.closest('[data-fold]');
    if (h) { const id = h.dataset.fold; if (folded.has(id)) folded.delete(id); else folded.add(id); render(); return; }
    if (e.target.closest('#td-empty-add')) $('.qa-input', root).focus();
    const ev = e.target.closest('[data-ev]');
    if (ev) { openEventSheet(ev.dataset.ev); return; }
    const up = e.target.closest('.ev-uprow');
    if (up) { viewing = up.dataset.day === todayKey() ? null : up.dataset.day; userPicked = !!viewing; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  wireRows(listBox, () => viewDay());
  import('./garden.js').then((m) => m.mountGardenInToday && m.mountGardenInToday($('#td-garden', el))).catch(() => {});
  listeners.add(() => { if (!root.hidden) render(); });
  ready.then(render);
  render();
}
const viewDay = () => viewing || todayKey();
export function show() {
  if (!userPicked) viewing = null;
  render();
}
export function hide() { userPicked = false; }

function render() {
  if (!root) return;
  const today = todayKey();
  const date = viewDay();
  const isToday = date === today;
  $('#td-title', root).textContent = isToday ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : DAY_NAMES[dow(date)];
  $('#td-sub', root).textContent = longDate(date);
  const input = planInput();
  const idx = indexDone(input.done);
  // week strip
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  if (!days.includes(date)) days.push(date);
  $('#td-week', root).innerHTML = days.map((d) => {
    const p = buildDayPlan(input, d, today, idx);
    const open = p.total - p.doneCount + (d === today ? 0 : 0);
    const evs = eventCount(d);
    const dots = (evs ? '<i class="ev"></i>' : '') + (p.total && open === 0 ? '<i class="all"></i>' : Array.from({ length: Math.min(evs ? 2 : 3, open) }, () => '<i></i>').join(''));
    return `<button type="button" class="td-day${d === date ? ' on' : ''}${d === today ? ' today' : ''}" data-day="${d}" aria-pressed="${d === date}" aria-label="${esc(longDate(d))}${open ? `, ${open} open` : ''}${evs ? `, ${evs} ${evs === 1 ? 'event' : 'events'}` : ''}">
      <span class="w">${d === today ? 'Today' : DAY_SHORT[dow(d)]}</span><b>${fromKey(d).getDate()}</b><span class="dots">${dots}</span></button>`;
  }).join('') + (isToday ? '' : `<button type="button" class="chip small td-back" data-day="${today}">Back to today</button>`);
  const plan = buildDayPlan(input, date, today, idx);
  const prog = $('#td-progress', root);
  prog.hidden = !plan.total;
  if (plan.total) {
    $('#td-count', root).textContent = `${plan.doneCount} of ${plan.total} done`;
    prog.querySelector('i').style.width = Math.round((plan.doneCount / plan.total) * 100) + '%';
  }
  const out = [];
  const section = (id, title, n, count = n) => {
    if (!n) return false;
    const f = folded.has(id);
    out.push(`<button type="button" class="label-quiet td-sec" data-fold="${id}" aria-expanded="${!f}"><span>${esc(title)}</span><span class="n">${count}</span><span class="grow"></span>${svgI(f ? 'down' : 'up', 16)}</button>`);
    return !f;
  };
  const rows = (arr, inRoutine) => { out.push(`<div class="td-rows">${arr.map((o) => rowHTML(o, today, inRoutine)).join('')}</div>`); };
  const happening = happeningHTML(date);
  out.push(happening);
  if (plan.total && plan.doneCount === plan.total && !plan.anytime.length) out.push('<p class="td-alldone">All done — rest time ♡</p>');
  if (section('overdue', 'From earlier', plan.overdue.length)) rows(plan.overdue);
  if (section('day', isToday ? 'Today' : DAY_NAMES[dow(date)], plan.scheduled.length)) rows(plan.scheduled);
  for (const g of plan.routines) if (section('r-' + g.routine.id, routineTitle(g, date), g.items.length)) rows(g.items, true);
  if (section('anytime', 'Anytime', plan.anytime.length)) rows(plan.anytime);
  if (section('done', isToday ? 'Done today' : 'Done', plan.done.length)) rows(plan.done);
  if (!plan.total && !plan.anytime.length && !happening) {
    out.push(`<div class="empty td-empty"><img src="img/illustrations/empty-lists.png" alt="" width="110" height="110">
      <h2>${isToday ? 'Nothing planned — enjoy your day ♡' : `Nothing planned for ${DAY_NAMES[dow(date)]} ♡`}</h2>
      <p>Type a task above, like “water plants every 3 days”.</p><button type="button" class="btn" id="td-empty-add">Add a task</button></div>`);
  }
  out.push(upcomingHTML(input.tasks, (id, key) => idx.has(id + '|' + key), !folded.has('upcoming')));
  const html = out.join('');
  if (listBox._html !== html) { listBox.innerHTML = html; listBox._html = html; }
}

// ------------------------------------------------------------------ Home card
export function mountTodayCard(box) {
  if (!box) return;
  box.classList.add('today-card-host');
  const draw = () => {
    const today = todayKey();
    const plan = planFor(today, today);
    const next = upNext(plan);
    const shown = next.slice(0, 4);
    let body;
    if (!plan.total && !plan.anytime.length) body = `<div class="tc-empty"><span class="muted">Nothing planned today ♡</span><button type="button" class="btn soft small" data-tc="add">${svgI('plus', 16)} Add</button></div>`;
    else if (plan.total && !next.length) body = '<p class="tc-empty muted">All done — rest time ♡</p>';
    else if (!next.length) body = `<a class="tc-empty muted" href="#today">${plan.anytime.length} anytime ${plan.anytime.length === 1 ? 'task' : 'tasks'} waiting, no rush ♡</a>`;
    else body = `<div class="td-rows tc-rows">${shown.map((o) => rowHTML(o, today, false, true)).join('')}</div>${next.length > 4 ? `<a class="tc-more muted" href="#today">+ ${next.length - 4} more</a>` : ''}`;
    const html = `<section class="card today-card" aria-label="Today">
      <div class="tc-head"><h3>Today${plan.total ? ` <span class="muted">· ${plan.doneCount} of ${plan.total} done</span>` : ''}</h3><a class="tc-all" href="#today">See all</a></div>
      ${plan.total ? `<div class="pbar"><i style="width:${Math.round((plan.doneCount / plan.total) * 100)}%"></i></div>` : ''}${body}</section>`;
    if (box._html !== html) { box.innerHTML = html; box._html = html; }
  };
  box.addEventListener('click', (e) => { if (e.target.closest('[data-tc="add"]')) openQuickAdd(); });
  wireRows(box, () => todayKey());
  listeners.add(draw);
  ready.then(draw);
  draw();
}

// ------------------------------------------------------------------ Routines editor
let routinesOpen = null;
export async function openRoutines(which = null) {
  if (routinesOpen) return;
  await ready;
  const fs = fullscreen({ className: 'route routines-fs', label: 'Routines', onClose: async () => { routinesOpen = null; listeners.delete(draw); (await import('../main.js')).resetHash(); } });
  routinesOpen = fs;
  const expanded = new Set();
  const moving = new Map(); // rid -> day being moved
  if (which) {
    const r = items('routines').find((x) => x.id === which || x.kind === which);
    if (r) expanded.add(r.id);
  }
  let newMode = 'weekly';
  fs.el.innerHTML = `<div class="rt-wrap"><header class="rt-head"><button type="button" class="icon-btn" data-rt="close" aria-label="Close">${icon.close}</button><h2>Routines</h2></header><div class="rt-body"></div></div>`;
  const body = $('.rt-body', fs.el);
  function routineCard(r) {
    const tasks = routineTasks(r.id);
    const weekly = r.config.mode === 'weekly';
    const open = expanded.has(r.id);
    const summary = `${weekly ? 'Day by day' : 'Every day'} · ${tasks.length} ${tasks.length === 1 ? 'chore' : 'chores'}${r.enabled ? '' : ' · off'}`;
    let inner = '';
    if (open) {
      const choreRows = (list) => list.map((t) => `<div class="rt-chore"><button type="button" class="rt-chore-t" data-edit="${esc(t.id)}">${esc(t.title)}</button><button type="button" class="icon-btn plain" data-delchore="${esc(t.id)}" aria-label="Remove ${esc(t.title)}">${icon.close}</button></div>`).join('');
      const addRow = (day) => `<form class="rt-add" data-day="${day ?? ''}"><input class="txt" placeholder="Add a chore" aria-label="Add a chore" maxlength="120"><button type="submit" class="btn soft small">Add</button></form>`;
      if (weekly) {
        const mv = moving.get(r.id);
        inner = [1, 2, 3, 4, 5, 6, 0].map((d) => {
          const list = tasks.filter((t) => choreDay(t) === d);
          return `<div class="rt-day"><div class="rt-day-head"><b>${DAY_NAMES[d]}</b>
            <input class="txt rt-label" data-label="${d}" value="${esc(r.config.labels?.[String(d)] || '')}" placeholder="Name this day…" aria-label="${DAY_NAMES[d]} name" maxlength="40">
            <button type="button" class="btn link small" data-move="${d}">${mv === d ? 'Cancel' : 'Move'}</button></div>
            ${mv === d ? `<div class="chips rt-move">${[1, 2, 3, 4, 5, 6, 0].filter((x) => x !== d).map((x) => `<button type="button" class="chip small" data-moveto="${x}">${DAY_SHORT[x]}</button>`).join('')}</div>` : ''}
            ${choreRows(list)}${addRow(d)}</div>`;
        }).join('');
      } else inner = `<div class="rt-day">${choreRows(tasks)}${addRow(null)}</div>`;
      inner += `<div class="rt-foot"><input class="txt rt-name" value="${esc(r.name)}" aria-label="Routine name" maxlength="60"><button type="button" class="btn ghost small" data-delr="1">${icon.trash} Delete</button></div>`;
    }
    return `<section class="card rt-card" data-rid="${esc(r.id)}">
      <div class="rt-top"><button type="button" class="rt-toggle" data-expand="1" aria-expanded="${open}"><b>${esc(r.emoji ? r.emoji + ' ' + r.name : r.name)}</b><span class="muted-line">${esc(summary)}</span></button>
        <label class="switch"><input type="checkbox" data-on="1" ${r.enabled ? 'checked' : ''} aria-label="${esc(r.name)} on"><span></span></label></div>${inner}</section>`;
  }
  function draw() {
    const routines = items('routines').map(toRoutine).sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);
    const have = new Set(routines.map((r) => r.kind));
    const tpls = TEMPLATES.filter((t) => !have.has(t.kind));
    const focusEl = document.activeElement;
    const keep = focusEl && body.contains(focusEl) && focusEl.matches('input') ? { sel: focusEl.dataset.label ? `[data-rid="${focusEl.closest('[data-rid]')?.dataset.rid}"] [data-label="${focusEl.dataset.label}"]` : null } : null;
    if (keep && keep.sel) return; // don't redraw under her typing a day label
    body.innerHTML = `${routines.map(routineCard).join('')}
      ${tpls.length ? `<div class="label-quiet">${routines.length ? 'More ideas' : 'Start with one'}</div>${tpls.map((t) => `<div class="card rt-tpl"><div><b>${esc(t.name)}</b><span class="muted-line">${esc(t.blurb)}</span></div><button type="button" class="btn small" data-tpl="${t.kind}">Turn on</button></div>`).join('')}` : ''}
      <div class="label-quiet">Your own</div>
      <form class="card rt-new"><input class="txt" id="rt-new-name" placeholder="Name it… “Plant care”, “Sunday reset”" maxlength="60" aria-label="New routine name">
        <div class="chips">${[['daily', 'Every day'], ['weekly', 'Day by day']].map(([m, l]) => `<button type="button" class="chip small" data-mode="${m}" aria-pressed="${newMode === m}">${l}</button>`).join('')}</div>
        <button type="submit" class="btn small">Create</button></form>`;
  }
  body.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-rid]');
    const rid = card && card.dataset.rid;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tpl) { const id = await createRoutineFromTemplate(b.dataset.tpl); if (id) { expanded.add(id); draw(); confetti({ count: 40 }); toast('Routine on ♡'); } return; }
    if (b.dataset.mode) { newMode = b.dataset.mode; draw(); return; }
    if (!rid) return;
    if (b.dataset.expand) { if (expanded.has(rid)) expanded.delete(rid); else expanded.add(rid); draw(); }
    else if (b.dataset.move !== undefined) { const d = +b.dataset.move; moving.get(rid) === d ? moving.delete(rid) : moving.set(rid, d); draw(); }
    else if (b.dataset.moveto !== undefined) { const from = moving.get(rid); moving.delete(rid); await moveRoutineDay(rid, from, +b.dataset.moveto); toast('Moved ♡'); }
    else if (b.dataset.delchore) { await deleteTask(b.dataset.delchore); }
    else if (b.dataset.edit) openTaskSheet(b.dataset.edit);
    else if (b.dataset.delr) {
      const r = byId('routines', rid);
      if (await confirmDlg({ title: `Delete “${r.name}”?`, message: 'Its chores go too.', confirmLabel: 'Delete', emoji: '🗑️', destructive: true })) { await deleteRoutine(rid); toast('Routine deleted'); }
    }
  });
  body.addEventListener('change', async (e) => {
    const i = e.target;
    const rid = i.closest('[data-rid]')?.dataset.rid;
    if (!rid) return;
    const r = toRoutine(byId('routines', rid));
    if (i.dataset.on) await setRoutineEnabled(rid, i.checked);
    else if (i.dataset.label !== undefined) { i.blur(); await update('routines', rid, { config: { ...r.config, labels: { ...(r.config.labels || {}), [i.dataset.label]: i.value.trim() } } }); }
    else if (i.classList.contains('rt-name') && i.value.trim()) await update('routines', rid, { name: i.value.trim() });
  });
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.classList.contains('rt-new')) {
      const name = $('#rt-new-name', body).value.trim();
      if (!name) return toast('Give it a name ♡', { emoji: '✏️' });
      const id = await createRoutine(name, newMode);
      expanded.add(id);
      draw();
      toast('Routine added ♡');
      return;
    }
    if (f.classList.contains('rt-add')) {
      const input = f.querySelector('input');
      const title = input.value.trim();
      if (!title) return;
      const rid = f.closest('[data-rid]').dataset.rid;
      const day = f.dataset.day === '' ? null : +f.dataset.day;
      await addRoutineChore(rid, title, day);
      requestAnimationFrame(() => { const again = body.querySelector(`[data-rid="${rid}"] .rt-add[data-day="${f.dataset.day}"] input`); again && again.focus(); });
    }
  });
  fs.el.querySelector('[data-rt="close"]').onclick = () => fs.close('x');
  listeners.add(draw);
  draw();
  if (!reducedMotion()) fs.el.querySelector('.rt-wrap').animate([{ transform: 'translateY(24px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
}
