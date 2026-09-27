// Em&m Blog: Recipes section (inside the Lists tab).
//
// recipes doc: {title, emoji, photoId, servings, prepMin, cookMin, ingredients:[{id,text,checked}],
//               steps:[{id,text}], notes, tags:[], favorite, createdAt, updatedAt}
import { state, ready, watch, add, set, remove, patchSoon, flushNow, prefs, newId, items, byId, blobSrc, deleteAsset, errText, thumbSrc } from '../store.js';
import { esc, h, sheet, fullscreen, confirmDlg, toast, confetti, reconcile, emptyHTML, icon, choose, clamp, debounce, keepAwake, fileDrop, loadImage, reducedMotion } from '../ui.js';
import { copyText, saveCanvas, makeCanvas, roundRect, drawText, tokens, dottedBg, tape, wrapLines } from '../share.js';
import { uploadPhoto } from '../posts.js';
import { splitSource, withSource, hostOf } from '../app/recipes/source.js';
import { findTimers } from '../app/recipes/quantity.js';
import { startTimer, onTimers, stopTimer, fmtClock } from '../recipes/timers.js';

const RECIPE_EMOJI = ['🍰', '🧁', '🍪', '🍝', '🍜', '🥗', '🍲', '🥞', '🍕', '🌮', '🍛', '🥘', '🍓', '🍋', '☕', '🍵'];

// ---------- quantities ----------
const UNI = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8, '⅕': 1 / 5, '⅙': 1 / 6 };
const NUM = '(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d*\\s?[½⅓⅔¼¾⅛⅜⅝⅞⅕⅙]|\\d+(?:[.,]\\d+)?)';
const QTY_RE = new RegExp('^(\\s*)(' + NUM + ')(?:(\\s*(?:-|–|to)\\s*)(' + NUM + '))?');

export function parseNum(s) {
  s = String(s).trim();
  let m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) return +m[1] + +m[2] / (+m[3] || 1);
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return +m[1] / (+m[2] || 1);
  m = s.match(/^(\d*)\s?([½⅓⅔¼¾⅛⅜⅝⅞⅕⅙])$/);
  if (m) return (+m[1] || 0) + UNI[m[2]];
  return parseFloat(s.replace(',', '.'));
}
const FRACS = [[1 / 8, '⅛'], [1 / 6, '⅙'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']];
/** Pretty-print: 1.5 -> "1½", 0.333 -> "⅓", 2.4 -> "2.4". */
export function fmtNum(n) {
  if (!isFinite(n)) return '';
  let whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.04) return String(whole);
  if (frac > 0.96) return String(whole + 1);
  for (const [v, g] of FRACS) if (Math.abs(frac - v) < 0.035) return (whole ? whole : '') + g;
  return String(Math.round(n * 10) / 10);
}
/** Scale the quantity at the start of an ingredient line. */
export function scaleLine(text, f) {
  if (!f || Math.abs(f - 1) < 1e-6) return text;
  const m = String(text).match(QTY_RE);
  if (!m) return text;
  const a = parseNum(m[2]);
  if (!isFinite(a)) return text;
  let out = m[1] + fmtNum(a * f);
  if (m[4]) { const b = parseNum(m[4]); if (isFinite(b)) out += m[3] + fmtNum(b * f); }
  return out + text.slice(m[0].length);
}

// ---------- paste importer ----------
const HEAD_ING = /^\s*(ingredients?|what you'?ll need|you'?ll need|shopping list)\s*:?\s*$/i;
const HEAD_STEP = /^\s*(steps?|directions?|method|instructions?|preparation|how to make( it)?)\s*:?\s*$/i;
const HEAD_NOTE = /^\s*(notes?|tips?)\s*:?\s*$/i;
const toMin = (n, u) => Math.round(parseFloat(n) * (/^h/i.test(u) ? 60 : 1));
export function parseRecipeText(raw) {
  const out = { title: '', servings: null, prepMin: null, cookMin: null, ingredients: [], steps: [], notes: '' };
  let mode = null;
  const notes = [];
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  for (let line of lines) {
    const t = line.trim();
    if (!t) continue;
    let m, meta = false;
    if ((m = t.match(/prep(?:aration)?(?:\s*time)?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(h(?:ou)?rs?|hr|min(?:ute)?s?)/i))) { out.prepMin = toMin(m[1], m[2]); meta = true; }
    if ((m = t.match(/cook(?:ing)?(?:\s*time)?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(h(?:ou)?rs?|hr|min(?:ute)?s?)/i))) { out.cookMin = toMin(m[1], m[2]); meta = true; }
    if ((m = t.match(/(?:^|\W)(?:serves|servings|yield|makes)\s*[:\-]?\s*(\d+)/i))) { out.servings = +m[1]; meta = true; }
    if (meta && t.length < 60) continue;
    if (HEAD_ING.test(t)) { mode = 'ing'; continue; }
    if (HEAD_STEP.test(t)) { mode = 'step'; continue; }
    if (HEAD_NOTE.test(t)) { mode = 'note'; continue; }
    const bullet = /^\s*(?:[-*•·◦▪–]|\[\s?\])\s+/.test(line);
    const numbered = /^\s*(?:step\s*)?\d+\s*[.):]\s+/i.test(line);
    const clean = t.replace(/^(?:[-*•·◦▪–]|\[\s?\])\s+/, '').replace(/^(?:step\s*)?\d+\s*[.):]\s+/i, '').trim();
    if (!out.title && !mode && !bullet && !numbered && t.length < 80) { out.title = t.replace(/^#+\s*/, ''); continue; }
    if (mode === 'ing') out.ingredients.push(clean);
    else if (mode === 'step') out.steps.push(clean);
    else if (mode === 'note') notes.push(t);
    else if (numbered || clean.length > 70 || /\.$/.test(clean)) out.steps.push(clean);
    else out.ingredients.push(clean);
  }
  out.notes = notes.join('\n');
  return out;
}

/** Minutes mentioned in a step: [{min, label}] */
export function stepTimers(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(minutes?|mins?|hours?|hrs?|hr)\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const n = parseFloat(m[2] || m[1]);
    const min = /^h/i.test(m[3]) ? n * 60 : n;
    // one timer per distinct duration (steps often repeat "10 minutes")
    if (min > 0 && min <= 24 * 60 && !out.some((t) => t.min === min)) out.push({ min, label: m[0] });
  }
  return out;
}

// ---------- section ----------
let sec = null, watching = false, openView = null;
let q = '', tag = 'all';

function ensureWatch() {
  if (watching) return;
  watching = true;
  watch('recipes', () => { if (sec) renderGrid(); if (openView) openView.render(); });
  ready.then(() => { if (sec) renderGrid(); });
}

export function mountSection(el) {
  sec = el;
  el.innerHTML = `<div class="rc-bar">
      <div class="search grow"><label class="sr-only" for="recipes-search">Search recipes</label>${icon.search}<input class="txt" id="recipes-search" type="search" placeholder="search recipes, ingredients…" autocomplete="off"></div>
      <button type="button" class="btn soft" id="recipes-import">${icon.link} Import</button>
      <button type="button" class="btn" id="recipes-new">${icon.plus} New recipe</button>
    </div>
    <div class="chips scroll" id="recipes-tags" role="group" aria-label="Filter recipes"></div>
    <div class="rc-grid" id="recipes-grid"></div>
    <div id="recipes-empty"></div>`;
  el.querySelector('#recipes-new').onclick = () => openNewRecipe();
  el.querySelector('#recipes-import').onclick = () => openImport();
  const s = el.querySelector('#recipes-search');
  s.addEventListener('input', debounce(() => { q = s.value.trim().toLowerCase(); renderGrid(); }, 120));
  el.querySelector('#recipes-tags').addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (b) { tag = b.dataset.tag; renderGrid(); } });
  el.querySelector('#recipes-grid').addEventListener('click', (e) => { const c = e.target.closest('[data-key]'); if (c) openRecipe(c.dataset.key); });
  ensureWatch();
  renderGrid();
}

const totalMin = (r) => (r.prepMin || 0) + (r.cookMin || 0);
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`);
const cardSig = (r) => [r.title, r.emoji, r.photoId, r.favorite, r.prepMin, r.cookMin, r.servings, (r.tags || []).join(',')].join('~');

function cardNode(r) {
  const t = totalMin(r);
  const n = h(`<button type="button" class="rc-card pressable" aria-label="${esc(r.title || 'Untitled recipe')}">
    <span class="rc-pic">${r.photoId ? `<img src="${esc(thumbSrc(r.photoId, 480))}" alt="" loading="lazy" decoding="async">` : `<span class="rc-emoji" aria-hidden="true">${esc(r.emoji || '🍰')}</span>`}
      ${r.favorite ? '<span class="rc-fav" aria-label="favorite">💖</span>' : ''}</span>
    <span class="rc-info"><b>${esc(r.title || 'Untitled recipe')}</b>
      <span class="rc-meta">${t ? `⏱ ${fmtMin(t)}` : ''}${t && r.servings ? ' · ' : ''}${r.servings ? `🍽 ${r.servings}` : ''}${!t && !r.servings ? `${(r.ingredients || []).length} ingredients` : ''}</span></span>
  </button>`);
  const img = n.querySelector('img');
  if (img) { img.onload = () => img.classList.add('ok'); img.onerror = () => img.replaceWith(h(`<span class="rc-emoji" aria-hidden="true">${esc(r.emoji || '🍰')}</span>`)); }
  n._sig = cardSig(r);
  return n;
}

function renderGrid() {
  if (!sec) return;
  const all = items('recipes');
  sec.querySelector('#recipes-new').hidden = !state.canWrite;
  sec.querySelector('#recipes-import').hidden = !state.canWrite;
  const tags = [...new Set(all.flatMap((r) => r.tags || []))].sort();
  if (tag !== 'all' && tag !== 'fav' && !tags.includes(tag)) tag = 'all';
  const tagsEl = sec.querySelector('#recipes-tags');
  tagsEl.innerHTML = all.length ? [['all', 'All'], ['fav', '💖 Favorites'], ...tags.map((t) => [t, '#' + t])].map(([v, l]) => `<button type="button" class="chip" data-tag="${esc(v)}" aria-pressed="${tag === v}">${esc(l)}</button>`).join('') : '';
  const list = all.filter((r) => {
    if (tag === 'fav' && !r.favorite) return false;
    if (tag !== 'all' && tag !== 'fav' && !(r.tags || []).includes(tag)) return false;
    if (!q) return true;
    return [r.title, r.notes, ...(r.tags || []), ...(r.ingredients || []).map((i) => i.text)].join(' ').toLowerCase().includes(q);
  });
  reconcile(sec.querySelector('#recipes-grid'), list, (r) => r.id, cardNode, (node, r) => (node._sig === cardSig(r) ? node : cardNode(r)));
  const empty = sec.querySelector('#recipes-empty');
  const loaded = state.mode !== 'loading';
  if (!loaded) empty.innerHTML = '';
  else if (!all.length) empty.innerHTML = emptyHTML({ img: 'img/illustrations/empty-recipes.png', title: 'No recipes yet', text: state.canWrite ? 'Save your favorite things to cook together. Paste a link from YouTube, TikTok, Instagram or a recipe site ♡' : 'Nothing cooking here yet.', action: state.canWrite ? 'Import from a link' : '', actionId: 'recipes-empty-new' });
  else if (!list.length) empty.innerHTML = emptyHTML({ img: 'img/illustrations/no-results.png', title: 'Nothing matches', text: 'Try another word or tag ♡' });
  else empty.innerHTML = '';
  const b = empty.querySelector('#recipes-empty-new');
  if (b) {
    b.onclick = () => openImport();
    b.insertAdjacentHTML('afterend', `<button type="button" class="btn link small" id="recipes-empty-write">or write one yourself</button>`);
    empty.querySelector('#recipes-empty-write').onclick = () => openNewRecipe();
  }
}

// ---------- import from a link / shared links ----------
/** Open the "Import from a link" sheet (route '#import?url=…'). */
export async function openImport({ url = '', text = '' } = {}) {
  await ready;
  if (!state.canWrite) { toast('This is view-only for you ♡', { emoji: '👀' }); return; }
  const [{ openImportSheet, fetchThumbnail }, { shareLinkPayload }] = await Promise.all([import('../recipes/importer.js'), import('../app/recipes/share/codec.js')]);
  resetRoute();
  openImportSheet({
    url: url || '', text: text || '',
    shareLinkPayload,
    onShared: (payload) => openReceive(payload),
    onLocal: (t) => recipeForm(null, { prefill: fromParsed(parseRecipeText(t)) }),
    onRecipe: async (res, { kind }) => {
      const p = res.recipe;
      await new Promise((r) => setTimeout(r, 220)); // let the import sheet finish closing
      let photoId = null;
      if (kind !== 'photo' && kind !== 'text' && p.thumbnailUrl) {
        const blob = await fetchThumbnail(p.thumbnailUrl);
        if (blob) { try { photoId = (await uploadPhoto(blob)).assetId; } catch (e) { photoId = null; } }
      }
      recipeForm(null, {
        prefill: {
          title: p.title || '', emoji: p.emoji || '🍰', photoId,
          servings: p.servings ?? null, prepMin: p.prepMin ?? null, cookMin: p.cookMin ?? null,
          ingredients: p.ingredients || [], steps: p.steps || [],
          notes: withSource(p.notes || '', p.sourceTitle, p.sourceUrl),
          tags: p.tags || [],
        },
        note: importNote(res),
      });
    },
  });
}

const fromParsed = (r) => ({ title: r.title, servings: r.servings, prepMin: r.prepMin, cookMin: r.cookMin, ingredients: r.ingredients, steps: r.steps, notes: r.notes, tags: [] });

/** The app's importNote: a banner only when it found the creator's full recipe or wasn't sure. */
function importNote(res) {
  if (res.foundVia) {
    const siteName = (res.foundVia.siteName || '').trim() || hostOf(res.foundVia.url);
    return { found: { siteName, url: res.foundVia.url }, warnings: (res.warnings || []).slice(0, 2) };
  }
  if (!res.confidence || res.confidence === 'high') return null;
  if (res.confidence === 'medium' && !(res.warnings || []).length) return null;
  const src = res.recipe && res.recipe.sourceUrl;
  const video = res.source === 'transcript' || (res.source === 'caption' && /youtu|instagram|tiktok/i.test(src || ''));
  return { confidence: res.confidence, video, warnings: (res.warnings || []).slice(0, 3) };
}
function noteHTML(n) {
  if (!n) return '';
  const title = n.found ? `Found the full recipe on ${esc(n.found.siteName)} ✨`
    : n.confidence === 'low' ? (n.video ? 'Double-check the amounts: the video didn’t say everything' : 'Double-check the amounts: not everything was written down')
    : 'Give it a quick look before saving';
  return `<div class="imp-note" id="recipe-imp-note" role="note"><span class="imp-note-ic" aria-hidden="true">${icon.sparkle}</span><div class="grow">
    <b>${title}</b>${n.found && /^https?:\/\//.test(n.found.url) ? `<a class="imp-note-link" href="${esc(n.found.url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(n.found.url))}</a>` : ''}
    ${(n.warnings || []).map((w) => `<p>${esc(w)}</p>`).join('')}</div>
    <button type="button" class="icon-btn plain" id="recipe-imp-note-x" aria-label="Dismiss">${icon.close}</button></div>`;
}

/** A recipe someone shared (route '#receive=<payload>'). */
export async function openReceive(payload) {
  resetRoute();
  const m = await import('../recipes/sharing.js');
  return m.openReceive(payload, { openRecipe });
}

async function resetRoute() {
  if (/^#(import|receive)/i.test(location.hash)) { try { (await import('../main.js')).resetHash(); } catch (e) { /* ignore */ } }
}

// ---------- editor ----------
export async function openNewRecipe() {
  await ready;
  if (!state.canWrite) { toast('This is view-only for you ♡', { emoji: '👀' }); return; }
  recipeForm(null);
}

function recipeForm(r0, { prefill = null, note = null } = {}) {
  const editing = !!r0;
  const pre = prefill;
  const src = r0 || (pre ? {
    ...pre,
    ingredients: (pre.ingredients || []).map((t) => ({ id: newId(), text: String(t), checked: false })),
    steps: (pre.steps || []).map((t) => ({ id: newId(), text: String(t) })),
    tags: (pre.tags || []).map((t) => String(t).toLowerCase()),
  } : null);
  const v = {
    emoji: src?.emoji || '🍰',
    photoId: src?.photoId || null,
    ingredients: (src?.ingredients || []).map((i) => ({ ...i })),
    steps: (src?.steps || []).map((s) => ({ ...s })),
  };
  const uploaded = pre && pre.photoId ? [pre.photoId] : []; // photo ids uploaded in this session (cleanup if cancelled)
  if (!v.ingredients.length) v.ingredients.push({ id: newId(), text: '', checked: false });
  if (!v.steps.length) v.steps.push({ id: newId(), text: '' });
  let saved = false;
  const s = sheet({
    title: editing ? 'Edit recipe' : pre ? 'Check it over ♡' : 'New recipe ♡',
    wide: true,
    body: `${noteHTML(note)}${editing || pre ? '' : `<div class="rf-ctas"><button type="button" class="paste-cta" id="recipe-import-open"><span class="e" aria-hidden="true">🔗</span><span><b>Import from a link</b><small>YouTube, TikTok, Instagram or a recipe site</small></span></button>
      <button type="button" class="paste-cta" id="recipe-paste-open"><span class="e" aria-hidden="true">📋</span><span><b>Paste a whole recipe</b><small>we’ll sort out the ingredients and steps for you</small></span></button></div>`}
      <div class="rf-top">
        <div class="rf-photo" id="recipe-photo-zone">
          <label class="drop small" for="recipe-photo" id="recipe-photo-drop"><span class="e" aria-hidden="true">📷</span><strong>Add photo</strong><input type="file" id="recipe-photo" accept="image/*" hidden></label>
          <div class="rf-photo-pv" id="recipe-photo-pv" hidden><img alt="Recipe photo"><button type="button" class="icon-btn" id="recipe-photo-rm" aria-label="Remove photo">${icon.close}</button></div>
        </div>
        <div class="rf-main">
          <div class="field"><label class="lbl" for="recipe-title">Title</label><input class="txt" id="recipe-title" maxlength="80" placeholder="strawberry shortcake" autocomplete="off" value="${esc(src?.title || '')}"></div>
          <div class="rf-nums">
            <div class="field"><label class="lbl" for="recipe-servings">Serves</label><input class="txt" id="recipe-servings" type="number" min="1" max="99" inputmode="numeric" value="${esc(src?.servings ?? '')}"></div>
            <div class="field"><label class="lbl" for="recipe-prep">Prep min</label><input class="txt" id="recipe-prep" type="number" min="0" max="999" inputmode="numeric" value="${esc(src?.prepMin ?? '')}"></div>
            <div class="field"><label class="lbl" for="recipe-cook">Cook min</label><input class="txt" id="recipe-cook" type="number" min="0" max="999" inputmode="numeric" value="${esc(src?.cookMin ?? '')}"></div>
          </div>
        </div>
      </div>
      <div class="field"><span class="lbl" id="recipe-emoji-lbl">Emoji</span><div class="emoji-row" id="recipe-emojis" role="group" aria-labelledby="recipe-emoji-lbl">${RECIPE_EMOJI.map((e, i) => `<button type="button" id="recipe-emoji-${i}" data-e="${e}" aria-label="${e}" aria-pressed="${e === v.emoji}">${e}</button>`).join('')}</div></div>
      <div class="field"><span class="lbl">Ingredients</span><div class="rows-edit" id="recipe-ings"></div><button type="button" class="btn soft small add-row" id="recipe-ing-add">${icon.plus} Add ingredient</button></div>
      <div class="field"><span class="lbl">Steps</span><div class="rows-edit steps" id="recipe-steps"></div><button type="button" class="btn soft small add-row" id="recipe-step-add">${icon.plus} Add step</button></div>
      <div class="field"><label class="lbl" for="recipe-tags">Tags</label><input class="txt" id="recipe-tags" maxlength="120" placeholder="dessert, quick, date night" autocomplete="off" value="${esc((src?.tags || []).join(', '))}"></div>
      <div class="field"><label class="lbl" for="recipe-notes">Notes</label><textarea class="txt" id="recipe-notes" rows="3" maxlength="5000" placeholder="little tips, where it’s from…">${esc(src?.notes || '')}</textarea></div>
      <p class="err" id="recipe-err" hidden></p>`,
    foot: `<span class="status grow" id="recipe-status"></span><button type="button" class="btn soft" id="recipe-cancel">Cancel</button><button type="button" class="btn" id="recipe-save">${editing ? 'Save' : 'Save recipe'}</button>`,
    onClose: () => { if (!saved) uploaded.forEach((id) => deleteAsset(id)); },
  });
  const b = s.body;
  const $b = (x) => b.querySelector(x);

  // rows editor
  const rowsHtml = (kind, list) => list.map((it, i) => `<div class="re-row" data-id="${esc(it.id)}">
      <span class="re-n" aria-hidden="true">${kind === 'steps' ? i + 1 : '•'}</span>
      <label class="sr-only" for="recipe-${kind}-${esc(it.id)}">${kind === 'steps' ? 'Step ' + (i + 1) : 'Ingredient ' + (i + 1)}</label>
      ${kind === 'steps'
        ? `<textarea class="txt" id="recipe-${kind}-${esc(it.id)}" rows="2" maxlength="800" data-k="${kind}" placeholder="what to do…">${esc(it.text)}</textarea>`
        : `<input class="txt" id="recipe-${kind}-${esc(it.id)}" maxlength="200" data-k="${kind}" placeholder="1 cup flour" value="${esc(it.text)}" autocomplete="off">`}
      <span class="re-acts"><button type="button" class="icon-btn plain" data-mv="-1" aria-label="Move up">↑</button><button type="button" class="icon-btn plain" data-mv="1" aria-label="Move down">↓</button><button type="button" class="icon-btn plain" data-rm aria-label="Remove">${icon.close}</button></span>
    </div>`).join('');
  const drawRows = (kind, focusId) => {
    const list = kind === 'steps' ? v.steps : v.ingredients;
    const host = $b(kind === 'steps' ? '#recipe-steps' : '#recipe-ings');
    host.innerHTML = rowsHtml(kind, list);
    if (focusId) { const f = host.querySelector(`[data-id="${CSS.escape(focusId)}"] .txt`); if (f) f.focus(); }
  };
  const syncRows = () => {
    b.querySelectorAll('.re-row .txt').forEach((inp) => {
      const list = inp.dataset.k === 'steps' ? v.steps : v.ingredients;
      const it = list.find((x) => x.id === inp.closest('.re-row').dataset.id);
      if (it) it.text = inp.value;
    });
  };
  const addRow = (kind, afterId = null) => {
    syncRows();
    const list = kind === 'steps' ? v.steps : v.ingredients;
    const it = kind === 'steps' ? { id: newId(), text: '' } : { id: newId(), text: '', checked: false };
    const at = afterId ? list.findIndex((x) => x.id === afterId) + 1 : list.length;
    list.splice(at, 0, it);
    drawRows(kind, it.id);
  };
  drawRows('ings'); drawRows('steps');
  $b('#recipe-ing-add').onclick = () => addRow('ings');
  $b('#recipe-step-add').onclick = () => addRow('steps');
  b.addEventListener('click', (e) => {
    const row = e.target.closest('.re-row');
    const em = e.target.closest('[data-e]');
    if (em) { v.emoji = em.dataset.e; b.querySelectorAll('#recipe-emojis [data-e]').forEach((x) => x.setAttribute('aria-pressed', String(x === em))); return; }
    if (!row) return;
    const kind = row.parentElement.id === 'recipe-steps' ? 'steps' : 'ings';
    const list = kind === 'steps' ? v.steps : v.ingredients;
    const i = list.findIndex((x) => x.id === row.dataset.id);
    const mv = e.target.closest('[data-mv]');
    if (mv) { syncRows(); const j = clamp(i + +mv.dataset.mv, 0, list.length - 1); const [x] = list.splice(i, 1); list.splice(j, 0, x); drawRows(kind, x.id); }
    if (e.target.closest('[data-rm]')) { syncRows(); list.splice(i, 1); if (!list.length) list.push(kind === 'steps' ? { id: newId(), text: '' } : { id: newId(), text: '', checked: false }); drawRows(kind); }
  });
  b.addEventListener('keydown', (e) => {
    const inp = e.target.closest('.re-row input.txt');
    if (inp && e.key === 'Enter') { e.preventDefault(); addRow('ings', inp.closest('.re-row').dataset.id); }
    if (e.target.id === 'recipe-title' && e.key === 'Enter') e.preventDefault();
  });
  // also accept pasting several lines into one ingredient box
  b.addEventListener('paste', (e) => {
    const inp = e.target.closest('.re-row input.txt');
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (!inp || !text || !text.includes('\n')) return;
    e.preventDefault();
    syncRows();
    const lines = text.split('\n').map((x) => x.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    const at = v.ingredients.findIndex((x) => x.id === inp.closest('.re-row').dataset.id);
    const cur = v.ingredients[at];
    if (cur && !cur.text.trim()) v.ingredients.splice(at, 1);
    v.ingredients.splice(Math.max(0, cur && !cur.text.trim() ? at : at + 1), 0, ...lines.map((t) => ({ id: newId(), text: t, checked: false })));
    drawRows('ings');
  });

  // photo
  const pv = $b('#recipe-photo-pv'), drop = $b('#recipe-photo-drop');
  const showPhoto = () => { pv.hidden = !v.photoId; drop.hidden = !!v.photoId; if (v.photoId) pv.querySelector('img').src = blobSrc(v.photoId); };
  showPhoto();
  fileDrop(drop, $b('#recipe-photo'), async (files) => {
    const st = s.foot.querySelector('#recipe-status');
    st.textContent = 'Adding photo…';
    try {
      const up = await uploadPhoto(files[0]);
      uploaded.push(up.assetId);
      v.photoId = up.assetId;
      showPhoto();
      st.textContent = '';
    } catch (e) { st.textContent = errText(e); }
  });
  $b('#recipe-photo-rm').onclick = () => { v.photoId = null; showPhoto(); };

  const noteX = $b('#recipe-imp-note-x');
  if (noteX) noteX.onclick = () => $b('#recipe-imp-note').remove();
  const impBtn = $b('#recipe-import-open');
  if (impBtn) impBtn.onclick = () => { s.close('import'); setTimeout(() => openImport(), 220); };
  // paste importer
  const pasteBtn = $b('#recipe-paste-open');
  if (pasteBtn) pasteBtn.onclick = () => {
    const ps = sheet({
      title: 'Paste a recipe 📋',
      body: `<div class="field"><label class="lbl" for="recipe-paste">Paste the whole thing</label><textarea class="txt" id="recipe-paste" rows="12" placeholder="Strawberry shortcake&#10;Serves 4 · Prep 15 min&#10;&#10;Ingredients&#10;- 2 cups flour&#10;- 1/2 cup sugar&#10;&#10;Steps&#10;1. Mix everything…" autofocus></textarea></div><p class="note">We look for “Ingredients” / “Steps” headings, bullets, numbers and times like “Prep: 10 min”.</p>`,
      foot: `<button type="button" class="btn soft" id="recipe-paste-cancel">Cancel</button><button type="button" class="btn" id="recipe-paste-go">Fill it in ✨</button>`,
    });
    ps.foot.querySelector('#recipe-paste-cancel').onclick = () => ps.close();
    ps.foot.querySelector('#recipe-paste-go').onclick = () => {
      const r = parseRecipeText(ps.body.querySelector('#recipe-paste').value);
      if (!r.ingredients.length && !r.steps.length && !r.title) { ps.body.querySelector('#recipe-paste').focus(); return; }
      if (r.title) $b('#recipe-title').value = r.title;
      if (r.servings) $b('#recipe-servings').value = r.servings;
      if (r.prepMin != null) $b('#recipe-prep').value = r.prepMin;
      if (r.cookMin != null) $b('#recipe-cook').value = r.cookMin;
      if (r.notes) $b('#recipe-notes').value = r.notes;
      if (r.ingredients.length) v.ingredients = r.ingredients.map((t) => ({ id: newId(), text: t, checked: false }));
      if (r.steps.length) v.steps = r.steps.map((t) => ({ id: newId(), text: t }));
      drawRows('ings'); drawRows('steps');
      ps.close('ok');
      toast(`Found ${r.ingredients.length} ingredients & ${r.steps.length} steps ✨`);
    };
  };

  const num = (x) => { const n = parseInt($b(x).value, 10); return isFinite(n) && n >= 0 ? n : null; };
  const save = async () => {
    syncRows();
    const title = $b('#recipe-title').value.trim();
    const err = $b('#recipe-err');
    if (!title) { err.textContent = 'Give it a name ♡'; err.hidden = false; $b('#recipe-title').focus(); return; }
    const btn = s.foot.querySelector('#recipe-save');
    btn.disabled = true;
    const now = Date.now();
    const data = {
      title, emoji: v.emoji, photoId: v.photoId || null,
      servings: num('#recipe-servings') || null, prepMin: num('#recipe-prep'), cookMin: num('#recipe-cook'),
      ingredients: v.ingredients.filter((i) => i.text.trim()).map((i) => ({ id: i.id, text: i.text.trim(), checked: !!i.checked })),
      steps: v.steps.filter((x) => x.text.trim()).map((x) => ({ id: x.id, text: x.text.trim() })),
      tags: [...new Set($b('#recipe-tags').value.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 12),
      notes: $b('#recipe-notes').value.trim(),
      updatedAt: now,
    };
    try {
      let id;
      if (editing) {
        await patchSoon('recipes', r0.id, data, 10);
        id = r0.id;
        if (r0.photoId && r0.photoId !== data.photoId) deleteAsset(r0.photoId);
      } else {
        id = await add('recipes', { ...data, favorite: false, createdAt: now });
      }
      saved = true;
      uploaded.filter((x) => x !== data.photoId).forEach((x) => deleteAsset(x));
      s.close('saved');
      toast(editing ? 'Saved ♡' : 'Recipe saved ♡', { emoji: data.emoji });
      if (!editing) { confetti({ emoji: data.emoji, count: 40 }); setTimeout(() => openRecipe(id), 240); }
    } catch (e) { err.textContent = errText(e); err.hidden = false; btn.disabled = false; }
  };
  s.foot.querySelector('#recipe-save').onclick = save;
  s.foot.querySelector('#recipe-cancel').onclick = () => s.close('cancel');
  if (!editing) setTimeout(() => $b('#recipe-title').focus(), 80);
}

// ---------- view ----------
export function openRecipe(id) {
  const r0 = byId('recipes', id);
  if (!r0) return;
  const canEdit = state.canWrite;
  let serv = r0.servings || 1;
  const s = sheet({
    title: `${r0.emoji || '🍰'} ${r0.title || 'Recipe'}`,
    wide: true,
    className: 'recipe-sheet',
    body: `<div class="rv-hero" id="rv-hero"></div>
      <div class="rv-meta" id="rv-meta"></div>
      <div class="rv-acts">
        <button type="button" class="btn" id="rv-cook">👩‍🍳 Cook mode</button>
        ${canEdit ? `<button type="button" class="btn soft" id="rv-shop">${icon.cart} Add to grocery list</button>` : ''}
        <button type="button" class="btn soft" id="rv-send">${icon.link} Send</button>
        ${canEdit ? `<button type="button" class="icon-btn" id="rv-fav" aria-pressed="false" aria-label="Favorite">${icon.heart}</button>` : ''}
      </div>
      <div class="rv-cols">
        <section class="rv-ings"><div class="section-label">Ingredients <span class="grow"></span>
          <span class="scaler" id="rv-scaler"><button type="button" class="q" id="rv-serv-minus" aria-label="Fewer servings">−</button><b id="rv-serv"></b><button type="button" class="q" id="rv-serv-plus" aria-label="More servings">+</button></span></div>
          <ul class="rv-ing-list" id="rv-ings"></ul>
          ${canEdit ? `<button type="button" class="btn link small" id="rv-reset" hidden>uncheck all</button>` : ''}</section>
        <section class="rv-steps"><div class="section-label">Steps</div><ol class="rv-step-list" id="rv-steps"></ol>
          <div id="rv-notes"></div></section>
      </div>
      ${canEdit ? '<div class="rv-ai" id="rv-ai"></div>' : ''}`,
    foot: `<button type="button" class="btn soft small" id="rv-copy">${icon.copy} Copy</button>
      <button type="button" class="btn soft small" id="rv-image">${icon.download} Save card</button>
      ${canEdit ? `<button type="button" class="btn link small" id="rv-ai-undo" hidden>${icon.undo || ''} Undo last AI change</button><button type="button" class="btn soft small" id="rv-edit">${icon.edit} Edit</button><button type="button" class="btn link small" id="rv-del" style="color:var(--danger)">Delete</button>` : ''}`,
    onClose: () => { if (openView && openView.id === id) openView = null; flushNow('recipes', id); if (ai) ai.destroy(); },
  });
  let ai = null, aiMod = null; // "Ask AI to change this recipe" (js/recipes/aiEdit.js, loaded on open)
  const b = s.body, $b = (x) => b.querySelector(x) || s.foot.querySelector(x);
  let heroFor = null;
  const factor = () => { const r = byId('recipes', id); return r && r.servings ? serv / r.servings : serv; };

  const render = () => {
    const r = byId('recipes', id);
    if (!r) { s.close('gone'); return; }
    s.setTitle(`${r.emoji || '🍰'} ${r.title || 'Recipe'}`);
    if (heroFor !== (r.photoId || r.emoji)) {
      heroFor = r.photoId || r.emoji;
      $b('#rv-hero').innerHTML = r.photoId ? `<img src="${esc(blobSrc(r.photoId))}" alt="${esc(r.title)}">` : `<span class="rc-emoji big" aria-hidden="true">${esc(r.emoji || '🍰')}</span>`;
    }
    const t = totalMin(r);
    $b('#rv-meta').innerHTML = [r.prepMin ? `<span>🥣 prep ${fmtMin(r.prepMin)}</span>` : '', r.cookMin ? `<span>🔥 cook ${fmtMin(r.cookMin)}</span>` : '', t && r.prepMin && r.cookMin ? `<span>⏱ ${fmtMin(t)} total</span>` : '', ...(r.tags || []).map((x) => `<span class="tag">#${esc(x)}</span>`)].join('');
    const fav = $b('#rv-fav');
    if (fav) { fav.setAttribute('aria-pressed', String(!!r.favorite)); fav.setAttribute('aria-label', r.favorite ? 'Unfavorite' : 'Favorite'); }
    $b('#rv-serv').textContent = r.servings ? `${fmtNum(serv)} serving${serv === 1 ? '' : 's'}` : `×${fmtNum(serv)}`;
    const f = factor();
    const ings = r.ingredients || [];
    $b('#rv-ings').querySelectorAll('li:not([data-key])').forEach((n) => n.remove());
    reconcile($b('#rv-ings'), ings, (i) => i.id, (i) => ingNode(i, f), (n, i) => ingNode(i, f));
    // re-scale all when factor changed
    if ($b('#rv-ings')._f !== f) { $b('#rv-ings')._f = f; [...$b('#rv-ings').children].forEach((n) => { const i = ings.find((x) => x.id === n.dataset.key); if (i) n.querySelector('.tx').textContent = scaleLine(i.text, f); }); }
    if (!ings.length) $b('#rv-ings').innerHTML = '<li class="muted">No ingredients yet.</li>';
    const reset = $b('#rv-reset');
    if (reset) reset.hidden = !ings.some((i) => i.checked);
    $b('#rv-steps').innerHTML = (r.steps || []).length ? r.steps.map((x) => `<li>${esc(x.text)}</li>`).join('') : '<li class="muted">No steps yet.</li>';
    const { notes: plainNotes, source } = splitSource(r.notes || '');
    $b('#rv-notes').innerHTML = (plainNotes ? `<div class="rv-note"><b>Notes ♡</b><p>${esc(plainNotes)}</p></div>` : '')
      + (source && /^https?:\/\//.test(source.url) ? `<a class="rv-source" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">From: ${esc(source.title)}</a>` : '');
    $b('#rv-cook').disabled = !(r.steps || []).length;
    if ($b('#rv-ai-undo')) $b('#rv-ai-undo').hidden = !(aiMod && aiMod.hasAiPrev(id));
  };
  const ingNode = (i, f) => {
    const n = h(`<li class="rv-ing${i.checked ? ' checked' : ''}"><button type="button" class="ld-check" aria-pressed="${!!i.checked}" ${canEdit ? '' : 'disabled'} aria-label="${i.checked ? 'Uncheck' : 'Check'} ${esc(i.text)}"><span class="box" aria-hidden="true">${icon.check}</span></button><span class="tx">${esc(scaleLine(i.text, f))}</span></li>`);
    return n;
  };
  b.addEventListener('click', (e) => {
    const li = e.target.closest('.rv-ing');
    if (li && canEdit && (e.target.closest('.ld-check') || e.target.closest('.tx'))) {
      const r = byId('recipes', id);
      li.classList.toggle('checked'); li.classList.add('pop');
      const ings = (r.ingredients || []).map((x) => (x.id === li.dataset.key ? { ...x, checked: !x.checked } : x));
      patchSoon('recipes', id, { ingredients: ings }, 700).catch((err) => toast(errText(err)));
    }
  });
  $b('#rv-serv-minus').onclick = () => { const r = byId('recipes', id); serv = r.servings ? Math.max(1, serv - 1) : Math.max(0.5, serv - 0.5); render(); };
  $b('#rv-serv-plus').onclick = () => { const r = byId('recipes', id); serv = r.servings ? Math.min(99, serv + 1) : Math.min(20, serv + 0.5); render(); };
  if ($b('#rv-reset')) $b('#rv-reset').onclick = () => { const r = byId('recipes', id); patchSoon('recipes', id, { ingredients: r.ingredients.map((x) => ({ ...x, checked: false })) }, 50); };
  if ($b('#rv-fav')) $b('#rv-fav').onclick = (e) => {
    const r = byId('recipes', id);
    patchSoon('recipes', id, { favorite: !r.favorite }, 300);
    if (!r.favorite) { const rc = e.currentTarget.getBoundingClientRect(); confetti({ emoji: '💖', x: rc.left + 20, y: rc.top + 20, count: 24 }); }
  };
  $b('#rv-cook').onclick = () => cookMode(id, factor());
  if ($b('#rv-shop')) $b('#rv-shop').onclick = () => openAddToGrocery(byId('recipes', id), factor());
  $b('#rv-send').onclick = async () => (await import('../recipes/sharing.js')).sendRecipeLink(byId('recipes', id));
  $b('#rv-copy').onclick = () => copyText(recipeAsText(byId('recipes', id), factor()), 'Recipe copied ♡');
  $b('#rv-image').onclick = () => saveRecipeCard(byId('recipes', id), factor());
  if ($b('#rv-edit')) $b('#rv-edit').onclick = () => { s.close('edit'); setTimeout(() => recipeForm(byId('recipes', id)), 200); };
  if ($b('#rv-del')) $b('#rv-del').onclick = async () => {
    const r = byId('recipes', id);
    const ok = await confirmDlg({ title: `Delete “${r.title || 'this recipe'}”?`, confirmLabel: 'Delete', destructive: true, emoji: '🗑️' });
    if (!ok) return;
    s.close('del');
    const { id: rid, ...data } = r;
    try {
      await remove('recipes', rid);
      if (aiMod) aiMod.clearAiPrev(rid);
      let undone = false;
      toast('Recipe deleted', { undo: () => { undone = true; set('recipes', rid, data).catch((e) => toast(errText(e))); } });
      if (data.photoId) setTimeout(() => { if (!undone) deleteAsset(data.photoId); }, 7000);
    } catch (e) { toast(errText(e)); }
  };
  if (canEdit) {
    import('../recipes/aiEdit.js').then((m) => {
      aiMod = m;
      if (!b.isConnected) return;
      ai = m.mountAskAi($b('#rv-ai'), { id, getFactor: factor, onNewRecipe: (nid) => { s.close('ai-new'); setTimeout(() => openRecipe(nid), 240); } });
      render();
    }).catch(() => {});
    $b('#rv-ai-undo').onclick = async () => {
      if (!(aiMod && aiMod.hasAiPrev(id))) return;
      const ok = await confirmDlg({ title: 'Undo the last AI change?', message: 'The recipe goes back to how it was before (edits you made since then are undone too).', confirmLabel: 'Undo', emoji: '↩️' });
      if (!ok || !byId('recipes', id)) return;
      try { if (await aiMod.undoAiEdit(id)) toast('Back to how it was ♡', { emoji: '↩️' }); render(); } catch (e) { toast(errText(e)); }
    };
  }
  openView = { id, render };
  render();
}

// ---------- recipe → grocery list (the app's AddToShoppingSheet: nothing pre-ticked) ----------
async function openAddToGrocery(r, f = 1) {
  if (!r) return;
  const ings = (r.ingredients || []).filter((i) => i.text.trim());
  if (!ings.length) { toast('No ingredients yet ♡'); return; }
  const picked = new Set();
  const s = sheet({
    title: 'Add to grocery list',
    className: 'grocery-pick-sheet',
    body: `<p class="imp-help">Pick what you need to buy ♡</p>
      <div class="gp-top"><button type="button" class="chip" id="gp-all" aria-pressed="false">Select all</button></div>
      <ul class="gp-list" id="gp-list">${ings.map((i) => `<li><button type="button" class="gp-row" data-id="${esc(i.id)}" role="checkbox" aria-checked="false">
        <span class="cbox" aria-hidden="true">${icon.check}</span><span class="gp-tx"><span>${esc(scaleLine(i.text, f))}</span><small class="gp-to" data-to="${esc(i.id)}"></small></span></button></li>`).join('')}</ul>`,
    foot: `<button type="button" class="btn soft" id="gp-cancel">Cancel</button><button type="button" class="btn" id="gp-add" disabled>Add</button>`,
  });
  const $s = (x) => s.body.querySelector(x) || s.foot.querySelector(x);
  const draw = () => {
    s.body.querySelectorAll('.gp-row').forEach((b) => { const on = picked.has(b.dataset.id); b.setAttribute('aria-checked', String(on)); b.querySelector('.cbox').setAttribute('aria-checked', String(on)); });
    $s('#gp-add').disabled = !picked.size;
    $s('#gp-add').textContent = picked.size ? `Add ${picked.size}` : 'Add';
    $s('#gp-all').setAttribute('aria-pressed', String(picked.size === ings.length));
    $s('#gp-all').textContent = picked.size === ings.length ? 'Select none' : 'Select all';
  };
  s.body.addEventListener('click', (e) => {
    const b = e.target.closest('.gp-row');
    if (b) { picked.has(b.dataset.id) ? picked.delete(b.dataset.id) : picked.add(b.dataset.id); draw(); return; }
    if (e.target.closest('#gp-all')) { if (picked.size === ings.length) picked.clear(); else ings.forEach((i) => picked.add(i.id)); draw(); }
  });
  $s('#gp-cancel').onclick = () => s.close('cancel');
  $s('#gp-add').onclick = async () => {
    const lines = ings.filter((i) => picked.has(i.id)).map((i) => scaleLine(i.text, f));
    s.close('add');
    (await import('./lists.js')).addToShoppingList(lines, r.title);
  };
  draw();
  // "→ 🧄 Garlic" previews (the catalog loads lazily; the sheet works without it)
  try {
    const [{ ingredientToGrocery }, { emojiOf }] = await Promise.all([import('../app/grocery/parse.js'), import('../app/grocery/catalog.js')]);
    for (const i of ings) {
      const el = s.body.querySelector(`[data-to="${CSS.escape(i.id)}"]`);
      if (!el) continue;
      const g = ingredientToGrocery(scaleLine(i.text, f));
      el.textContent = g ? `→ ${emojiOf(g.name)} ${g.name}${g.qty ? ' · ' + g.qty : ''}` : '→ skipped (water, etc.)';
    }
  } catch (e) { console.warn('grocery preview', e); }
}

export function recipeAsText(r, f = 1) {
  if (!r) return '';
  const meta = [r.servings ? `Serves ${fmtNum(r.servings * f)}` : '', r.prepMin ? `Prep ${fmtMin(r.prepMin)}` : '', r.cookMin ? `Cook ${fmtMin(r.cookMin)}` : ''].filter(Boolean).join(' · ');
  return [
    `${r.emoji || '🍰'} ${r.title}`, meta, '',
    'Ingredients', ...(r.ingredients || []).map((i) => `• ${scaleLine(i.text, f)}`), '',
    'Steps', ...(r.steps || []).map((x, i) => `${i + 1}. ${x.text}`),
    r.notes ? `\nNotes\n${r.notes}` : '',
    (r.tags || []).length ? '\n' + r.tags.map((t) => '#' + t).join(' ') : '',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim();
}

// ---------- cook mode (timers live in ../recipes/timers.js so they keep running after it closes) ----------
async function cookMode(id, f) {
  const r = byId('recipes', id);
  const steps = (r.steps || []);
  if (!steps.length) return;
  let i = 0;
  let release = () => {};
  let tick = 0;
  const fs = fullscreen({
    className: 'cook',
    label: 'Cook mode',
    onClose: () => { release(); if (tick && tick.clear) tick.clear(); },
  });
  keepAwake().then((rel) => { release = rel; }).catch(() => {});
  fs.el.innerHTML = `<div class="cook-wrap">
      <header class="cook-top"><button type="button" class="icon-btn" id="cook-close" aria-label="Close cook mode">${icon.close}</button>
        <b class="cook-title">${esc(r.emoji || '🍰')} ${esc(r.title)}</b><span class="cook-count" id="cook-count"></span></header>
      <div class="cook-timers" id="cook-timers" aria-live="polite"></div>
      <div class="cook-stage" id="cook-stage"><p class="cook-step" id="cook-step"></p><div class="cook-tbtns" id="cook-tbtns"></div></div>
      <div class="cook-dots" id="cook-dots" aria-hidden="true">${steps.map(() => '<i></i>').join('')}</div>
      <footer class="cook-nav"><button type="button" class="btn soft" id="cook-prev">${icon.back} Back</button><button type="button" class="btn" id="cook-next">Next ${icon.next}</button></footer>
    </div>`;
  const $f = (x) => fs.el.querySelector(x);
  const show = (dir = 0) => {
    const st = steps[i];
    $f('#cook-count').textContent = `Step ${i + 1} of ${steps.length}`;
    const p = $f('#cook-step');
    p.textContent = st.text;
    p.classList.remove('in-l', 'in-r'); void p.offsetWidth;
    if (dir) p.classList.add(dir > 0 ? 'in-r' : 'in-l');
    $f('#cook-tbtns').innerHTML = findTimers(st.text).map((t, k) => `<button type="button" class="btn soft" data-t="${k}" id="cook-timer-${i}-${k}">${icon.timer} Start ${esc(t.label)} timer</button>`).join('');
    [...$f('#cook-dots').children].forEach((d, k) => d.classList.toggle('on', k === i));
    $f('#cook-prev').disabled = i === 0;
    $f('#cook-next').innerHTML = i === steps.length - 1 ? 'Done! 🎉' : `Next ${icon.next}`;
  };
  const go = (d) => {
    if (d > 0 && i === steps.length - 1) { confetti({ emoji: '🎉' + (r.emoji || '🍰'), count: 90 }); toast('Bon appétit ♡', { emoji: r.emoji || '🍰' }); fs.close('done'); return; }
    const n = clamp(i + d, 0, steps.length - 1);
    if (n !== i) { i = n; show(d); }
  };
  const drawTimers = (list) => {
    const host = $f('#cook-timers');
    if (!host) return;
    host.innerHTML = list.map((t) => `<span class="cook-timer${t.rang ? ' done' : ''}"><b>${t.rang ? 'done!' : fmtClock(t.leftMs)}</b> ${esc(t.label)}<button type="button" class="q" data-stop="${esc(t.id)}" aria-label="Stop timer">×</button></span>`).join('');
  };
  const offTimers = onTimers(drawTimers);
  tick = { clear: offTimers };
  fs.el.addEventListener('click', (e) => {
    if (e.target.closest('#cook-close')) fs.close('x');
    else if (e.target.closest('#cook-prev')) go(-1);
    else if (e.target.closest('#cook-next')) go(1);
    else if (e.target.closest('[data-t]')) {
      const t = findTimers(steps[i].text)[+e.target.closest('[data-t]').dataset.t];
      startTimer(`${r.emoji || '🍰'} step ${i + 1} · ${t.label}`, t.seconds, `${id}:${i}:${t.label}`);
    } else if (e.target.closest('[data-stop]')) { stopTimer(e.target.closest('[data-stop]').dataset.stop); }
  });
  fs.el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') { if (!e.target.closest('button') || e.key === 'ArrowRight') { e.preventDefault(); go(1); } }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });
  // swipe
  const stage = $f('#cook-stage');
  let x0 = null, y0 = 0;
  stage.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
  stage.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  });
  show();
  $f('#cook-next').focus();
}

// ---------- recipe card image ----------
async function saveRecipeCard(r, f = 1) {
  if (!r) return;
  const T = tokens();
  const W = 1080, pad = 96;
  const m = makeCanvas(10, 10).getContext('2d');
  m.font = '600 34px Nunito, sans-serif';
  const ingLines = (r.ingredients || []).slice(0, 24).map((i) => wrapLines(m, scaleLine(i.text, f), (W - pad * 2) - 50).slice(0, 2));
  const stepLines = (r.steps || []).slice(0, 12).map((x) => wrapLines(m, x.text, W - pad * 2 - 70).slice(0, 4));
  let img = null;
  if (r.photoId) { try { img = await loadImage(blobSrc(r.photoId)); } catch (e) { img = null; } }
  const heroH = img ? 560 : 0;
  const H = 160 + heroH + 220 + ingLines.reduce((s, l) => s + l.length * 44 + 10, 0) + 110 + stepLines.reduce((s, l) => s + l.length * 44 + 18, 0) + 180;
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  dottedBg(ctx, W, H, T.bg, T.dot);
  ctx.save(); ctx.shadowColor = 'rgba(120,30,70,.18)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  roundRect(ctx, 48, 64, W - 96, H - 120, 44); ctx.fillStyle = T.paper; ctx.fill(); ctx.restore();
  let y = 64;
  if (img) {
    ctx.save(); roundRect(ctx, 48, 64, W - 96, heroH, 44); ctx.clip();
    const s = Math.max((W - 96) / img.naturalWidth, heroH / img.naturalHeight);
    const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
    ctx.drawImage(img, 48 + (W - 96 - iw) / 2, 64 + (heroH - ih) / 2, iw, ih);
    ctx.restore();
    y += heroH;
  }
  tape(ctx, W / 2, 66, 220, 48, 0.04, T.tape);
  y += 110;
  ctx.textBaseline = 'alphabetic';
  ctx.font = '84px serif'; ctx.fillText(r.emoji || '🍰', pad, y);
  ctx.fillStyle = T.pink; ctx.font = '800 60px Sniglet, Nunito, sans-serif';
  drawText(ctx, r.title || 'Recipe', pad + 110, y - 8, W - pad * 2 - 110, 64, 1);
  y += 56;
  ctx.fillStyle = T.muted; ctx.font = '700 30px Nunito, sans-serif';
  ctx.fillText([r.servings ? `serves ${fmtNum(r.servings * f)}` : '', r.prepMin ? `prep ${fmtMin(r.prepMin)}` : '', r.cookMin ? `cook ${fmtMin(r.cookMin)}` : ''].filter(Boolean).join('  ·  '), pad, y);
  y += 80;
  ctx.fillStyle = T.pink; ctx.font = '800 40px Sniglet, Nunito, sans-serif'; ctx.fillText('Ingredients', pad, y); y += 54;
  ctx.font = '600 34px Nunito, sans-serif';
  for (const lines of ingLines) {
    ctx.fillStyle = T.rose; ctx.beginPath(); ctx.arc(pad + 12, y - 11, 8, 0, 6.283); ctx.fill();
    ctx.fillStyle = T.ink;
    for (const ln of lines) { ctx.fillText(ln, pad + 40, y); y += 44; }
    y += 10;
  }
  y += 40;
  ctx.fillStyle = T.pink; ctx.font = '800 40px Sniglet, Nunito, sans-serif'; ctx.fillText('Steps', pad, y); y += 54;
  stepLines.forEach((lines, k) => {
    ctx.fillStyle = T.blush; ctx.beginPath(); ctx.arc(pad + 20, y - 12, 22, 0, 6.283); ctx.fill();
    ctx.fillStyle = T.pink; ctx.font = '800 26px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(k + 1), pad + 20, y - 3); ctx.textAlign = 'left';
    ctx.fillStyle = T.ink; ctx.font = '600 34px Nunito, sans-serif';
    for (const ln of lines) { ctx.fillText(ln, pad + 64, y); y += 44; }
    y += 18;
  });
  ctx.fillStyle = T.muted; ctx.font = '700 36px Caveat, cursive'; ctx.textAlign = 'center';
  ctx.fillText('made with love · Em&m Blog', W / 2, H - 90);
  saveCanvas(c, r.title || 'recipe');
}
