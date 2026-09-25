// Em&m Blog: Me. Light/dark, app color (Home "All" look), little stats, storage, about.
import { state, ready, watch, items, prefs, usage, on, want, kv } from '../store.js';
import { $, esc, confetti, LOOKS, lookSwatch, toast, confirmDlg, icon } from '../ui.js';

let root;

export function mount(el) {
  root = el;
  el.innerHTML = `
    <header class="phead"><div><h1>Me</h1><p class="sub">make it yours ♡</p></div>
      <div class="actions"><span class="status" id="me-status"></span></div></header>
    <div class="me-grid">
      <div class="card tape" id="me-stats-card"><div class="stats" id="me-stats"></div></div>
      <div class="card">
        <h3>Appearance</h3>
        <div class="seg" role="group" aria-label="Light or dark" id="me-mode" style="margin-top:8px">
          <button type="button" id="me-mode-light" data-m="light">☀️ Light</button>
          <button type="button" id="me-mode-dark" data-m="dark">🌙 Dark</button>
        </div>
        <p class="note">Dark mode is a soft dusty rose, easy on sleepy eyes.</p>
        <label class="switch-row" style="display:flex;align-items:center;gap:10px;margin-top:12px;font-weight:700">
          <input type="checkbox" id="me-flowers" style="width:20px;height:20px;accent-color:var(--pink)"> Flower border
        </label>
      </div>
      <div class="card">
        <h3>App color</h3>
        <div class="look-grid" id="me-looks" role="group" aria-label="App color" style="margin-top:10px"></div>
        <p class="note" id="me-look-note"></p>
      </div>
      <div class="card">
        <h3>Storage</h3>
        <p id="me-storage" style="font-weight:800">Checking…</p>
        <div class="meter" id="me-meter" hidden><i style="width:0"></i></div>
        <p class="note" id="me-storage-note"></p>
      </div>
      <div class="card data-card" id="me-data">
        <h3>Your data</h3>
        <p class="data-when" id="me-data-when">…</p>
        <p class="data-nudge" id="me-data-nudge" hidden></p>
        <div class="data-btns">
          <button type="button" class="btn" id="me-backup">${icon.download} Back up this browser</button>
          <button type="button" class="btn soft" id="me-restore">${icon.upload} Restore a backup</button>
          <button type="button" class="btn soft" id="me-import-app">📱 Import from the phone app</button>
        </div>
        <div class="data-progress" id="me-data-progress" hidden><div class="pbar"><i></i></div><span class="muted-line" aria-live="polite"></span></div>
        <p class="note">A backup is one .zip file with everything, photos included. Keep it somewhere safe (iCloud Drive, Google Drive…).
          Phone app backups (app → Me → Your data → Back up now) can be opened here too. The phone app can’t open website backups yet.</p>
        <input type="file" id="me-data-file" accept=".zip,application/zip" hidden>
      </div>
      <div class="card">
        <button type="button" class="about pressable" id="me-about" style="background:none;padding:0">
          <img src="img/app-icon.png" alt="" width="72" height="72">
          <span><b>Em&amp;m Blog 🌸</b><span class="muted" style="font-weight:700">made with love, just for you ♡ (tap me)</span></span>
        </button>
      </div>
    </div>`;
  $('#me-mode', el).onclick = async (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    (await import('../main.js')).setMode(b.dataset.m);
    drawMode();
  };
  const fl = $('#me-flowers', el);
  fl.checked = prefs.get('flowers') === 'on';
  fl.onchange = () => {
    prefs.set('flowers', fl.checked ? 'on' : null);
    if (fl.checked) document.documentElement.setAttribute('data-flowers', 'on'); else document.documentElement.removeAttribute('data-flowers');
  };
  $('#me-looks', el).onclick = (e) => {
    const b = e.target.closest('[data-l]');
    if (!b) return;
    prefs.set('accent', b.dataset.l);
    drawLooks();
    const r = b.getBoundingClientRect();
    confetti({ x: r.left + r.width / 2, y: r.top + 20, count: 26 });
  };
  $('#me-about', el).onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    confetti({ emoji: '💖🌸✨', x: r.left + 40, y: r.top + 30, count: 90 });
    confetti({ count: 60 });
  };
  ['posts', 'boards', 'diary', 'recipes', 'lists', 'countdowns'].forEach((c) => watch(c, drawStats));
  mountData(el);
  on('prefs', (k) => { if (k === 'mode') drawMode(); if (k === 'accent' || k === 'board') drawLooks(); });
  ready.then(() => {
    welcomeBack();
    $('#me-status', el).className = state.memory ? 'status preview' : 'status';
    $('#me-status', el).textContent = state.memory ? 'Not saved in this window' : '';
    drawStorage();
  });
  drawMode(); drawLooks(); drawStats();
}

export function show() { if (state.mode !== 'loading') drawStorage(); }
export function hide() {}

function drawMode() {
  const dark = prefs.get('mode') === 'dark';
  root.querySelectorAll('#me-mode [data-m]').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.m === 'dark') === dark));
}

function drawLooks() {
  const accent = prefs.get('accent', 'pink');
  $('#me-looks', root).innerHTML = LOOKS.map((l) => `<button type="button" class="look-btn" id="me-look-${l.id}" data-l="${l.id}" aria-pressed="${accent === l.id}"><span class="ring"><i style="background:${lookSwatch(l.id)}"></i></span>${esc(l.label)}</button>`).join('');
  const b = prefs.get('board', 'all');
  $('#me-look-note', root).textContent = b && b !== 'all' && items('boards').some((x) => x.id === b)
    ? 'A board is open on Home, so its own look is showing right now ♡'
    : 'Used everywhere, and for “All” on Home. Boards can have their own look.';
}

function drawStats() {
  const posts = items('posts');
  const photos = posts.filter((p) => p.kind === 'photo' || p.kind === 'collage').length;
  const stats = [
    ['📌', posts.length, 'pins'],
    ['📷', photos, 'photos'],
    ['📔', items('diary').length, 'pages'],
    ['🧁', items('recipes').length, 'recipes'],
    ['📝', items('lists').length, 'lists'],
    ['🎂', items('countdowns').length, 'special days'],
    ['💭', posts.filter((p) => p.kind === 'thought').length, 'thoughts'],
    ['🗂️', items('boards').length, 'boards'],
  ];
  const html = stats.map(([e, n, l]) => `<div class="s"><span class="e" aria-hidden="true">${e}</span><b>${n}</b><span>${l}</span></div>`).join('');
  const box = $('#me-stats', root);
  if (box._html !== html) { box.innerHTML = html; box._html = html; }
}

const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB');

async function drawStorage() {
  const u = await usage();
  const t = $('#me-storage', root), note = $('#me-storage-note', root), meter = $('#me-meter', root);
  if (!u) {
    t.textContent = '💾 Photos are saved with the page';
    note.textContent = 'Storage details are only shown to people who can edit.';
    meter.hidden = true;
    return;
  }
  if (u.local) {
    if (u.memory) {
      t.textContent = `💾 ${fmtBytes(u.bytes)} in this window`;
      note.textContent = state.memoryWhy === 'demo' ? 'Demo mode: nothing is saved when you close this page.' : 'This browser won’t let the site save (private window?). Nothing is kept after you close it.';
      meter.hidden = true;
      return;
    }
    t.textContent = `💾 ${fmtBytes(u.usage || u.bytes)} used · ${u.files} photo${u.files === 1 ? '' : 's'} & video${u.files === 1 ? '' : 's'}`;
    if (u.quota) {
      meter.hidden = false;
      const pct = Math.min(100, ((u.usage || u.bytes) / u.quota) * 100);
      meter.firstElementChild.style.width = Math.max(2, pct).toFixed(1) + '%';
    } else meter.hidden = true;
    note.textContent = 'Saved in this browser on this computer. Back up to keep it safe.' + (u.persisted ? '' : ' (The browser may tidy it away if space runs very low.)');
    return;
  }
  t.textContent = `💾 ${fmtBytes(u.bytes)} used · ${u.files} file${u.files === 1 ? '' : 's'}`;
  if (u.maxBytes) {
    meter.hidden = false;
    const pct = Math.min(100, (u.bytes / u.maxBytes) * 100);
    meter.firstElementChild.style.width = Math.max(2, pct).toFixed(1) + '%';
    note.textContent = `${pct.toFixed(pct < 10 ? 1 : 0)}% of ${fmtBytes(u.maxBytes)}. Everything is saved with this page, shared with anyone you share it with.`;
    if (pct > 90) toast('Storage is almost full, maybe tidy up a little ♡', { emoji: '📦' });
  } else note.textContent = 'Everything is saved with this page.';
}

// Make sure every collection the stats need is subscribed even before other tabs open.
['diary', 'recipes', 'lists', 'countdowns'].forEach(want);

// ---------- Your data (backup & restore) ----------
let busy = false;
function mountData(el) {
  const file = $('#me-data-file', el);
  let pickKind = 'any';
  $('#me-backup', el).onclick = doBackup;
  $('#me-restore', el).onclick = () => { if (!busy) { pickKind = 'any'; file.click(); } };
  $('#me-import-app', el).onclick = () => { if (!busy) { pickKind = 'app'; file.click(); } };
  file.onchange = () => { const f = file.files && file.files[0]; file.value = ''; if (f) doRestore(f, pickKind); };
  watch('kv', drawDataWhen);
  ['posts', 'diary', 'recipes'].forEach((c) => watch(c, drawDataWhen));
  ready.then(() => {
    const local = state.local;
    ['#me-backup', '#me-restore', '#me-import-app'].forEach((s) => { $(s, el).disabled = !local; });
    drawDataWhen();
  });
}

function drawDataWhen() {
  if (!root) return;
  const when = $('#me-data-when', root), nudge = $('#me-data-nudge', root);
  if (!state.local) { when.textContent = 'Backups are for the website version.'; nudge.hidden = true; return; }
  const last = Number(kv.get('backup_last_manual', 0)) || 0;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  when.textContent = !last ? 'Not backed up yet' : days === 0 ? 'Backed up today ♡' : days === 1 ? 'Backed up yesterday' : `Backed up ${days} days ago`;
  const hasData = items('posts').length + items('diary').length + items('recipes').length > 0;
  const show = hasData && (!last || days > 30);
  nudge.hidden = !show;
  if (show) nudge.textContent = last ? 'It’s been a while ♡ a fresh backup keeps everything safe.' : 'Everything lives only in this browser. Make a backup so nothing gets lost ♡';
}

function progress(frac, label) {
  const box = $('#me-data-progress', root);
  if (frac === null) { box.hidden = true; return; }
  box.hidden = false;
  box.querySelector('i').style.width = Math.round(Math.max(0.03, frac) * 100) + '%';
  box.querySelector('span').textContent = label || '';
}
function setBusy(on) {
  busy = on;
  ['#me-backup', '#me-restore', '#me-import-app'].forEach((s) => { $(s, root).disabled = on || !state.local; });
}

async function doBackup() {
  if (busy) return;
  setBusy(true);
  progress(0.02, 'Packing everything…');
  try {
    const bk = await import('../backup/index.js');
    const { blob, name, counts } = await bk.backupNow((f, l) => progress(f * 0.95, l));
    progress(1, 'Saving…');
    const { saveBlob } = await import('../share.js');
    await saveBlob(blob, name);
    toast(`Backed up: ${bk.describeCounts(counts)} ♡`, { emoji: '💾' });
  } catch (e) {
    console.error(e);
    const bk = await import('../backup/index.js').catch(() => null);
    toast(bk ? bk.friendlyError(e) : 'Couldn’t make the backup. Try again?');
  } finally { setBusy(false); progress(null); drawDataWhen(); }
}

async function doRestore(f, kind) {
  if (busy) return;
  setBusy(true);
  progress(0.03, 'Opening the backup…');
  let bk;
  try {
    bk = await import('../backup/index.js');
    const info = await bk.inspect(f, (x, l) => progress(x * 0.3, l));
    progress(null);
    if (kind === 'app' && info.kind !== 'app') toast('That’s a website backup, so it’ll restore as one ♡', { emoji: '💾' });
    const date = bk.niceDate(info.createdAt);
    const ok = await confirmDlg({
      title: info.kind === 'app' ? 'Import from your phone?' : 'Restore this backup?',
      message: info.kind === 'app'
        ? `Import from your phone backup (${date}): ${bk.describeCounts(info.counts)}? This replaces everything in this browser.`
        : `This replaces everything in this browser with the backup from ${date}: ${bk.describeCounts(info.counts)}.`,
      confirmLabel: info.kind === 'app' ? 'Import' : 'Restore',
      cancelLabel: 'Not now',
      emoji: info.kind === 'app' ? '📱' : '💾',
      destructive: true,
    });
    if (!ok) return;
    await bk.applyPlan(info.plan, (x, l) => progress(x, l));
    if (info.kind === 'web') await (await import('../store.js')).kv.set('backup_last_manual', info.createdAt);
    prefs.set('backup-restored', JSON.stringify({ at: info.createdAt, kind: info.kind }));
    progress(1, 'Done ♡');
    setTimeout(() => { location.hash = '#me'; location.reload(); }, 250);
  } catch (e) {
    console.error(e);
    toast(bk ? bk.friendlyError(e) : 'Couldn’t open that file. Nothing was changed.', { emoji: '🥺', duration: 5000 });
  } finally { setBusy(false); progress(null); }
}

function welcomeBack() {
  const raw = prefs.get('backup-restored');
  if (!raw) return;
  prefs.set('backup-restored', null);
  let info = {};
  try { info = JSON.parse(raw); } catch (e) { /* ignore */ }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = info.at ? new Date(info.at) : null;
  toast(`Welcome back ♡ ${info.kind === 'app' ? 'Imported' : 'Restored'}${d ? ` ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : ''}`, { emoji: '🌸', duration: 4000 });
  confetti();
}
