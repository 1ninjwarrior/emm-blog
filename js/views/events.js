// Em&m Blog web: calendar events + reminder settings (same model as the phone app, see the app's
// src/features/today/events.ts + reminders.ts, compiled into js/app/today/*).
//
// events  {title, emoji, date, allDay, start, end, location, notes, repeat, color (0-5), reminders, createdAt, updatedAt}
// Reminders are stored exactly like the app's (minutes before, or 'morning'); they ring on her phone. While this
// tab is open the site can also show a browser notification (only if she allowed it), nothing more.
import { items, byId, add, update, remove } from '../store.js';
import { $, esc, sheet, confirmDlg, toast, ic, icon } from '../ui.js';
import { todayKey, describeDate, describeRepeat, formatTime } from '../app/today/recurrence.js';
import { eventsOn, describeEventTime, eventTitle, makeEvent, addMinutes, upcomingItems } from '../app/today/events.js';
import { TIMED_OPTIONS, UNTIMED_OPTIONS, toggleReminder, fitReminders, normalizeReminders, planReminders } from '../app/today/reminders.js';

/** The soft palette events share with lists (index 0-5, like the app's swatches). */
export const EVENT_COLORS = ['#FFC2D8', '#FFD3B0', '#FFE58A', '#BDEBC8', '#C4E4FF', '#DCCBFF'];
export const eventColor = (i) => EVENT_COLORS[((i || 0) % 6 + 6) % 6];
export const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 16.5v-5.2a5.5 5.5 0 0 1 11 0v5.2l1.5 1.5h-14zM10.2 20.2a2 2 0 0 0 3.6 0"/></svg>';
export const bell = (size = 15) => BELL.replace('<svg', `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`);

export const toEvent = (d) => makeEvent({ ...d, title: d.title || '', date: d.date || todayKey() }, d.createdAt || 0, d.id);
export const allEvents = () => items('events').map(toEvent);
const docOf = (e) => { const { id, ...rest } = e; return rest; };

export async function createEvent(v) {
  const e = makeEvent(v, Date.now(), '');
  return add('events', docOf(e));
}
async function saveEvent(id, v) {
  const cur = byId('events', id);
  if (!cur) return;
  const e = makeEvent({ ...toEvent(cur), ...v, updatedAt: Date.now() }, Date.now(), id);
  await update('events', id, docOf(e));
}

// ------------------------------------------------------------------ rendering
/** The "Happening" section rows for a day. */
export function happeningHTML(date) {
  const occ = eventsOn(allEvents(), date);
  if (!occ.length) return '';
  return `<div class="label-quiet"><span>Happening</span></div><div class="td-rows">${occ.map(({ event: e }) => {
    const meta = [e.location, e.repeat ? describeRepeat(e.repeat) : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="ev-row" data-ev="${esc(e.id)}" style="--ev:${eventColor(e.color)}">
      <span class="ev-bar" aria-hidden="true"></span>
      <span class="ev-main"><span class="ev-time">${esc(describeEventTime(e))}</span><span class="tk-title">${esc(eventTitle(e))}</span>${meta ? `<span class="tk-meta">${esc(meta)}</span>` : ''}</span>
      ${e.reminders.length ? `<span class="ev-bell" aria-label="Reminder on">${bell()}</span>` : ''}</button>`;
  }).join('')}</div>`;
}

/** Per-day event count (the week strip pill). */
export const eventCount = (date) => eventsOn(allEvents(), date).length;

/** "Upcoming · next 2 weeks": events + dated open tasks (same rules as the app). */
export function upcomingHTML(tasks, isDone, open) {
  const today = todayKey();
  const up = upcomingItems(allEvents(), tasks, today, { isDone });
  const head = `<button type="button" class="label-quiet td-sec" data-fold="upcoming" aria-expanded="${open}"><span>Upcoming · next 2 weeks</span><span class="n">${up.length}</span><span class="grow"></span>${ic(open ? 'up' : 'down', 16)}</button>`;
  if (!open) return head;
  if (!up.length) return head + '<p class="muted ev-upempty">Nothing coming up ♡</p>';
  return head + `<div class="ev-up">${up.map((u, i) => `<button type="button" class="ev-uprow" data-day="${esc(u.date)}">
      <b class="${i && up[i - 1].date === u.date ? 'ghost' : ''}">${esc(u.day)}</b>
      <span class="ev-mark${u.color < 0 ? ' task' : ''}" style="--ev:${u.color < 0 ? 'transparent' : eventColor(u.color)}"></span>
      <span class="t">${esc(u.title)}</span>${u.time ? `<span class="muted">${esc(formatTime(u.time))}</span>` : ''}</button>`).join('')}</div>`;
}

// ------------------------------------------------------------------ reminder chips
/** Reminder chips (≤ 2; a third replaces the oldest) + "Reminders ring on your phone". */
export function reminderChips(box, value0, timed0, onChange) {
  let value = normalizeReminders(value0), timed = timed0;
  const draw = () => {
    const opts = timed ? TIMED_OPTIONS : UNTIMED_OPTIONS;
    const shown = fitReminders(value, timed);
    box.innerHTML = `<div class="chips">
        <button type="button" class="chip small" data-r="none" aria-pressed="${!shown.length}">None</button>
        ${opts.map((o) => `<button type="button" class="chip small" data-r="${o.value}" aria-pressed="${shown.includes(o.value)}">${esc(o.label)}</button>`).join('')}</div>
      ${shown.length ? `<p class="muted ev-note">${bell(14)} Reminders ring on your phone${inTabNote()}</p>` : ''}`;
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (b) {
      const r = b.dataset.r === 'none' ? null : b.dataset.r === 'morning' ? 'morning' : +b.dataset.r;
      value = r === null ? [] : toggleReminder(fitReminders(value, timed), r);
      draw(); onChange(value);
      return;
    }
    if (e.target.closest('[data-tabping]')) askTabPings().then(draw);
  });
  draw();
  return { setTimed(t) { timed = t; draw(); }, get: () => fitReminders(value, timed) };
}
const canNotify = () => typeof Notification !== 'undefined';
function inTabNote() {
  if (!canNotify()) return '.';
  if (Notification.permission === 'granted') return ' (and here while this tab is open).';
  if (Notification.permission === 'denied') return '.';
  return `. <button type="button" class="linkish" data-tabping>Also ping me in this tab</button>`;
}
async function askTabPings() {
  try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
  armTabPings();
}

// ------------------------------------------------------------------ in-tab pings (Notification API, tab open only)
let pingTimers = [];
/** Re-arm browser notifications for the next 24 h (only while this tab is open and she allowed it). */
export function armTabPings() {
  pingTimers.forEach(clearTimeout);
  pingTimers = [];
  if (!canNotify() || Notification.permission !== 'granted') return;
  const now = Date.now();
  const done = new Set(items('taskDone').map((d) => d.taskId + '|' + d.date));
  const list = [];
  for (const t of items('tasks')) {
    const rs = normalizeReminders(t.reminders);
    if (!rs.length || t.archived || !t.dueDate) continue;
    list.push({ kind: 'task', id: t.id, title: t.title || '', emoji: t.emoji || null, date: t.dueDate, time: t.dueTime || null, repeat: t.repeat || null, createdAt: t.createdAt || 0, reminders: rs });
  }
  for (const e of allEvents()) if (e.reminders.length) list.push({ kind: 'event', id: e.id, title: e.title, emoji: e.emoji, date: e.date, time: e.allDay ? null : e.start, end: e.end, location: e.location, repeat: e.repeat, createdAt: e.createdAt, reminders: e.reminders });
  const plan = planReminders(list, { now, cap: 30, skip: (it, d) => it.kind === 'task' && (done.has(it.id + '|' + (it.repeat ? d : 'once'))) });
  for (const p of plan) {
    const ms = p.fireAt - now;
    if (ms > 24 * 3600000) break;
    pingTimers.push(setTimeout(() => { try { new Notification(p.title, { body: p.body, tag: p.key }); } catch (e) { /* ignore */ } }, ms));
  }
}

// ------------------------------------------------------------------ event sheet
/** Edit an event (id) or finish a new one (draft {title?, date, start?, repeat?, reminders?}). */
export function openEventSheet(id, draft = null) {
  const cur = id ? byId('events', id) : null;
  if (id && !cur) return;
  const e = cur ? toEvent(cur) : makeEvent({ title: '', ...draft }, Date.now(), '');
  let when = { date: e.date, time: e.allDay ? null : e.start, repeat: e.repeat };
  let length = e.start && e.end ? minutes(e.end) - minutes(e.start) : null;
  let color = e.color;
  let reminders = e.reminders;
  const s = sheet({
    title: id ? 'Edit event' : 'New event',
    body: `<div class="field"><label class="lbl" for="es-title">Event</label><input class="txt" id="es-title" maxlength="200" value="${esc(e.title)}" placeholder="What’s happening?"></div>
      <div class="field"><span class="lbl">When</span><button type="button" class="chip es-when">${ic('calendar', 15)} <span></span></button></div>
      <div class="field es-len-f"><span class="lbl">How long</span><div class="chips es-len"></div></div>
      <div class="field"><span class="lbl">Remind me</span><div class="es-rem"></div></div>
      <div class="field"><span class="lbl">Color</span><div class="ev-swatches"></div></div>
      <div class="field"><label class="lbl" for="es-loc">Where (optional)</label><input class="txt" id="es-loc" maxlength="120" value="${esc(e.location)}" placeholder="Smile Dental, Mom’s house…"></div>
      <div class="field"><label class="lbl" for="es-notes">Notes</label><textarea class="txt" id="es-notes" rows="3" placeholder="Anything to remember">${esc(e.notes)}</textarea></div>
      <div class="field"><label class="lbl" for="es-emoji">Emoji (optional)</label><input class="txt" id="es-emoji" maxlength="8" value="${esc(e.emoji || '')}" placeholder="🦷" style="max-width:120px"></div>`,
    foot: `${id ? `<button type="button" class="btn ghost" data-a="del">${icon.trash} Delete</button>` : ''}<span style="flex:1"></span><button type="button" class="btn soft" data-a="x">Cancel</button><button type="button" class="btn" data-a="save">${id ? 'Save' : 'Add event'}</button>`,
  });
  const rem = reminderChips($('.es-rem', s.body), reminders, !!when.time, (v) => { reminders = v; });
  const drawWhen = () => {
    const t = todayKey();
    const head = when.repeat ? describeRepeat(when.repeat) : describeDate(when.date || t, t);
    $('.es-when span', s.body).textContent = when.time ? `${head} · ${formatTime(when.time)}` : `${head} · All day`;
    $('.es-len-f', s.body).hidden = !when.time;
    $('.es-len', s.body).innerHTML = [[0, 'Not sure'], [30, '30 min'], [60, '1 hr'], [120, '2 hr'], [180, '3 hr']]
      .map(([m, l]) => `<button type="button" class="chip small" data-len="${m}" aria-pressed="${(length || 0) === m}">${l}</button>`).join('');
    rem.setTimed(!!when.time);
  };
  const drawSw = () => { $('.ev-swatches', s.body).innerHTML = EVENT_COLORS.map((c, i) => `<button type="button" class="ev-sw" data-sw="${i}" style="background:${c}" aria-pressed="${color === i}" aria-label="Color ${i + 1}"></button>`).join(''); };
  drawWhen(); drawSw();
  $('.es-when', s.body).onclick = async () => {
    const { openWhenSheet } = await import('./today.js');
    const v = await openWhenSheet(when, 'When?', true);
    if (v) { when = { ...v, date: v.date || todayKey() }; drawWhen(); }
  };
  $('.es-len', s.body).onclick = (ev) => { const b = ev.target.closest('[data-len]'); if (b) { length = +b.dataset.len || null; drawWhen(); } };
  $('.ev-swatches', s.body).onclick = (ev) => { const b = ev.target.closest('[data-sw]'); if (b) { color = +b.dataset.sw; drawSw(); } };
  s.foot.onclick = async (ev) => {
    const a = ev.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'x') return s.close('x');
    if (a.dataset.a === 'del') {
      // close the sheet first, then ask (same rule as the app)
      s.close('del');
      const ok = await confirmDlg({ title: `Delete “${e.title}”?`, message: e.repeat ? 'It won’t come back on any day.' : '', confirmLabel: 'Delete', emoji: e.emoji || '📅', destructive: true });
      if (ok) { await remove('events', id); toast('Event deleted'); armTabPings(); }
      return;
    }
    const title = $('#es-title', s.body).value.trim();
    if (!title) return toast('It needs a name ♡', { emoji: '✏️' });
    const v = {
      title, emoji: $('#es-emoji', s.body).value.trim() || null, date: when.date || todayKey(), allDay: !when.time, start: when.time,
      end: when.time && length ? addMinutes(when.time, length) : null, repeat: when.repeat, location: $('#es-loc', s.body).value.trim(),
      notes: $('#es-notes', s.body).value.trim(), color, reminders: rem.get(),
    };
    if (id) await saveEvent(id, v); else await createEvent(v);
    toast(id ? 'Saved ♡' : 'Event added ♡', { emoji: '📅' });
    armTabPings();
    s.close('save');
  };
}
const minutes = (hhmm) => parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3), 10);

