// Em&m Blog: Special days (countdowns) section inside the Lists tab.
//
// countdowns doc: {title, emoji, date: 'yyyy-mm-dd', yearly: bool, createdAt}
import { state, ready, watch, add, set, remove, update, prefs, items, byId, errText } from '../store.js';
import { esc, h, sheet, confirmDlg, toast, confetti, reconcile, emptyHTML, icon, todayKey } from '../ui.js';
import { rankDays, countLabel, prettyDate, ordinal } from '../days.js';

const DAY_EMOJI = ['🎂', '💕', '💍', '🎉', '✈️', '🎄', '🎃', '🌸', '🏖️', '🎓', '🏡', '🐶', '🎁', '⭐', '🍰', '💌'];

let sec = null, watching = false;

function ensureWatch() {
  if (watching) return;
  watching = true;
  watch('countdowns', () => { if (sec) render(); });
  ready.then(() => { if (sec) render(); });
}

export function mountSection(el) {
  sec = el;
  el.innerHTML = `<div class="lists-bar">
      <p class="lists-hint muted">birthdays, anniversaries, trips… ✨</p>
      <button type="button" class="btn" id="days-new">${icon.plus} Add a day</button>
    </div>
    <div class="day-cards" id="days-upcoming"></div>
    <div id="days-empty"></div>
    <div id="days-mem-wrap" hidden><div class="section-label">Memories ♡</div><div class="day-mems" id="days-mems"></div></div>`;
  el.querySelector('#days-new').onclick = () => openNewCountdown();
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-key]');
    if (c && state.canWrite) dayForm(byId('countdowns', c.dataset.key));
  });
  ensureWatch();
  render();
  // Roll over at midnight while open.
  setInterval(() => { if (sec && sec._today !== todayKey()) render(); }, 60000);
}

const sigOf = (r, today) => [r.d.title, r.d.emoji, r.d.date, r.d.yearly, today].join('~');

function upNode(r, today) {
  const { d, st } = r;
  const big = st.isToday ? '🎉' : st.days;
  const unit = st.isToday ? 'today!' : st.days === 1 ? 'day' : 'days';
  const yearsTxt = st.years ? (/(anniv|together|us\b|dating|married|wedding)/i.test(d.title) ? `${ordinal(st.years)} anniversary` : /birthday|bday/i.test(d.title) ? `turns ${st.years}` : `${ordinal(st.years)} time`) : '';
  const pct = d.yearly ? Math.round(100 * (1 - st.days / 365)) : null;
  const n = h(`<button type="button" class="day-card pressable${st.isToday ? ' today' : st.days <= 7 ? ' soon' : ''}" aria-label="${esc(d.title)}: ${esc(countLabel(st))}">
      <span class="dc-emoji" aria-hidden="true">${esc(d.emoji || '🎉')}</span>
      <span class="dc-body"><b>${esc(d.title || 'Special day')}</b>
        <span class="dc-date">${esc(prettyDate(st.next, today))}${d.yearly ? ' · every year' : ''}</span>
        ${yearsTxt ? `<span class="dc-years">✨ ${esc(yearsTxt)}</span>` : ''}</span>
      <span class="dc-count"><b>${big}</b><small>${esc(st.isToday ? 'it’s today!' : st.days === 1 ? 'tomorrow!' : unit + ' to go')}</small></span>
      ${pct !== null && !st.isToday ? `<span class="dc-bar" aria-hidden="true"><i style="width:${Math.max(3, Math.min(100, pct))}%"></i></span>` : ''}
    </button>`);
  n._sig = sigOf(r, today);
  return n;
}
function memNode(r, today) {
  const n = h(`<button type="button" class="day-mem pressable" aria-label="${esc(r.d.title)}, ${esc(countLabel(r.st))}"><span aria-hidden="true">${esc(r.d.emoji || '🌸')}</span><b>${esc(r.d.title || 'A day')}</b><small>${esc(prettyDate(r.d.date, today))} · ${esc(countLabel(r.st))}</small></button>`);
  n._sig = sigOf(r, today);
  return n;
}

function render() {
  if (!sec) return;
  const today = todayKey();
  sec._today = today;
  sec.querySelector('#days-new').hidden = !state.canWrite;
  const { upcoming, memories } = rankDays(items('countdowns'), today);
  reconcile(sec.querySelector('#days-upcoming'), upcoming, (r) => r.d.id, (r) => upNode(r, today), (n, r) => (n._sig === sigOf(r, today) ? n : upNode(r, today)));
  reconcile(sec.querySelector('#days-mems'), memories, (r) => r.d.id, (r) => memNode(r, today), (n, r) => (n._sig === sigOf(r, today) ? n : memNode(r, today)));
  sec.querySelector('#days-mem-wrap').hidden = !memories.length;
  const empty = sec.querySelector('#days-empty');
  empty.innerHTML = state.mode !== 'loading' && !upcoming.length && !memories.length
    ? emptyHTML({ img: 'img/illustrations/empty-special-days.png', title: 'No special days yet', text: state.canWrite ? 'Add birthdays, anniversaries and trips, and we’ll count down together ♡' : 'Nothing to count down to yet.', action: state.canWrite ? 'Add a special day' : '', actionId: 'days-empty-new' })
    : '';
  const b = empty.querySelector('#days-empty-new');
  if (b) b.onclick = () => openNewCountdown();
  // Confetti once per day per viewer when something is today.
  const todays = upcoming.filter((r) => r.st.isToday);
  if (todays.length && !sec.hidden && sec.offsetParent !== null) {
    const key = today + ':' + todays.map((r) => r.d.id).sort().join(',');
    if (prefs.get('days-confetti') !== key) {
      prefs.set('days-confetti', key);
      setTimeout(() => { confetti({ emoji: todays.map((r) => r.d.emoji || '🎉').join('') + '🎉', count: 110 }); toast(`Today is ${todays[0].d.title}! 🎉`); }, 300);
    }
  }
}

export async function openNewCountdown() {
  await ready;
  if (!state.canWrite) { toast('This is view-only for you ♡', { emoji: '👀' }); return; }
  dayForm(null);
}

function dayForm(d) {
  if (d === undefined) return;
  const editing = !!d;
  let emoji = d?.emoji || '🎂';
  const s = sheet({
    title: editing ? 'Edit special day' : 'New special day ♡',
    body: `<div class="field"><label class="lbl" for="cd-title">What’s the day?</label><input class="txt" id="cd-title" maxlength="60" placeholder="our anniversary, Em’s birthday…" autocomplete="off" value="${esc(d?.title || '')}"></div>
      <div class="field"><label class="lbl" for="cd-date">Date</label><input class="txt" id="cd-date" type="date" value="${esc(d?.date || todayKey())}"></div>
      <label class="switch" for="cd-yearly"><input type="checkbox" id="cd-yearly" ${d ? (d.yearly ? 'checked' : '') : 'checked'}> Every year (birthdays, anniversaries)</label>
      <div class="field"><span class="lbl" id="cd-emoji-lbl">Emoji</span><div class="emoji-row" id="cd-emojis" role="group" aria-labelledby="cd-emoji-lbl">${DAY_EMOJI.map((e, i) => `<button type="button" id="cd-emoji-${i}" data-e="${e}" aria-label="${e}" aria-pressed="${e === emoji}">${e}</button>`).join('')}</div></div>
      <p class="err" id="cd-err" hidden></p>`,
    foot: `${editing ? `<button type="button" class="btn link" id="cd-del" style="color:var(--danger);margin-right:auto">Delete</button>` : ''}<button type="button" class="btn soft" id="cd-cancel">Cancel</button><button type="button" class="btn" id="cd-save">${editing ? 'Save' : 'Add it'}</button>`,
  });
  const b = s.body;
  b.querySelector('#cd-emojis').addEventListener('click', (e) => {
    const x = e.target.closest('[data-e]');
    if (!x) return;
    emoji = x.dataset.e;
    b.querySelectorAll('[data-e]').forEach((y) => y.setAttribute('aria-pressed', String(y === x)));
  });
  const save = async () => {
    const title = b.querySelector('#cd-title').value.trim();
    const date = b.querySelector('#cd-date').value;
    const yearly = b.querySelector('#cd-yearly').checked;
    const err = b.querySelector('#cd-err');
    if (!title) { err.textContent = 'Give it a name ♡'; err.hidden = false; b.querySelector('#cd-title').focus(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err.textContent = 'Pick a date'; err.hidden = false; return; }
    const btn = s.foot.querySelector('#cd-save');
    btn.disabled = true;
    try {
      if (editing) await update('countdowns', d.id, { title, date, yearly, emoji });
      else await add('countdowns', { title, date, yearly, emoji, createdAt: Date.now() });
      s.close('saved');
      toast(editing ? 'Saved ♡' : 'Counting down ♡', { emoji });
      if (!editing) confetti({ emoji, count: 36 });
    } catch (e) { err.textContent = errText(e); err.hidden = false; btn.disabled = false; }
  };
  s.foot.querySelector('#cd-save').onclick = save;
  s.foot.querySelector('#cd-cancel').onclick = () => s.close('cancel');
  b.querySelector('#cd-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const del = s.foot.querySelector('#cd-del');
  if (del) del.onclick = async () => {
    const ok = await confirmDlg({ title: `Delete “${d.title}”?`, confirmLabel: 'Delete', destructive: true, emoji: '🗑️' });
    if (!ok) return;
    s.close('del');
    const { id, ...data } = d;
    try {
      await remove('countdowns', id);
      toast('Special day deleted', { undo: () => set('countdowns', id, data).catch((e) => toast(errText(e))) });
    } catch (e) { toast(errText(e)); }
  };
  if (!editing) setTimeout(() => b.querySelector('#cd-title').focus(), 80);
}
