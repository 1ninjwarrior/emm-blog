// Em&m Blog: "Ask AI to change this recipe" (the app's AskAi.tsx + aiEdit.ts + editApi.ts, for the web).
// POST {API_BASE}/api/recipe-edit with {recipe, request} → {recipe, summary, label, changes, notes?} or {error, message}.
// Uses the same per-browser import code as "Import from a link" (x-emm-import-token). Nothing is saved until she
// taps "Save changes" (in place, with Undo + "Undo last AI change" from kv `recipe_prev_<id>`) or "Save as a new recipe".
import { API_BASE } from '../config.js';
import { add, blobOf, byId, errText, kv, newId, update, upload } from '../store.js';
import { confetti, esc, icon, sheet, toast } from '../ui.js';
import { diffLines, metaChanges, reuseRows, variantTitle } from '../app/recipes/editDiff.js';
import { EDIT_EXAMPLES, EDIT_LIMITS, EDIT_PROGRESS } from '../app/recipes/editTypes.js';
import { splitSource, withSource } from '../app/recipes/source.js';
import { importCode, setImportCode } from './importer.js';

const TIMEOUT_MS = 60000;
const PLACEHOLDERS = ['✨ Ask to change this recipe…', ...EDIT_EXAMPLES.map((e) => `✨ e.g. “${e}”`)];
const prevKey = (id) => `recipe_prev_${id}`;

export async function requestRecipeEdit(req, signal) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/recipe-edit`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-emm-import-token': importCode() },
      body: JSON.stringify(req),
    });
    const json = await res.json().catch(() => null);
    if (json && ('recipe' in json || 'error' in json)) return json;
    return { error: 'server', message: res.status === 404 ? 'The recipe helper isn’t available right now.' : 'Something went wrong. Try again in a moment.' };
  } catch (e) {
    if (signal && signal.aborted) return { error: 'server', message: 'Cancelled' };
    return { error: 'server', message: ctl.signal.aborted ? 'That took too long. Try again?' : 'You look offline. Try again when you’re connected ♡' };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** What the AI sees: saved amounts (never the scaled view), notes without the "From:" lines. */
export function toEditable(r) {
  return {
    title: r.title || '',
    servings: r.servings || null,
    prepMin: r.prepMin || null,
    cookMin: r.cookMin || null,
    ingredients: (r.ingredients || []).map((i) => String(i.text || '').trim()).filter(Boolean),
    steps: (r.steps || []).map((s) => String(s.text || '').trim()).filter(Boolean),
    notes: splitSource(r.notes || '').notes,
    tags: r.tags || [],
  };
}

function patchFrom(r, e) {
  const { source } = splitSource(r.notes || '');
  return {
    title: e.title.trim() || r.title,
    servings: e.servings,
    prepMin: e.prepMin,
    cookMin: e.cookMin,
    ingredients: reuseRows(r.ingredients || [], e.ingredients, 'ingredient', (text) => ({ id: newId(), text, checked: false }), (old, text) => ({ ...old, text, checked: false })),
    steps: reuseRows(r.steps || [], e.steps, 'step', (text) => ({ id: newId(), text })),
    notes: withSource(e.notes, source && source.title, source && source.url),
    tags: e.tags,
    updatedAt: Date.now(),
  };
}

const prevOf = (id) => {
  try { const p = JSON.parse(kv.get(prevKey(id), '') || 'null'); return p && p.v === 1 && p.prev ? p : null; } catch (e) { return null; }
};
export const hasAiPrev = (id) => !!prevOf(id);

export async function undoAiEdit(id) {
  const p = prevOf(id);
  if (!p || !byId('recipes', id)) return false;
  await update('recipes', id, { ...p.prev, updatedAt: Date.now() });
  await kv.set(prevKey(id), null);
  return true;
}
export const clearAiPrev = (id) => (prevOf(id) ? kv.set(prevKey(id), null) : null);

async function saveInPlace(id, e) {
  const r = byId('recipes', id);
  if (!r) throw new Error('gone');
  const prev = { title: r.title, servings: r.servings || null, prepMin: r.prepMin || null, cookMin: r.cookMin || null, ingredients: r.ingredients || [], steps: r.steps || [], notes: r.notes || '', tags: r.tags || [] };
  const patch = patchFrom(r, e);
  await kv.set(prevKey(id), JSON.stringify({ v: 1, at: patch.updatedAt, prev })); // first, so the view's re-render sees it
  await update('recipes', id, patch);
}

async function saveAsNew(id, e, label) {
  const r = byId('recipes', id);
  let photoId = null;
  try {
    const blob = r.photoId ? await blobOf(r.photoId) : null;
    if (blob) photoId = (await upload(blob, blob.type)).id;
  } catch (err) { photoId = null; }
  const { source } = splitSource(r.notes || '');
  const now = Date.now();
  return add('recipes', {
    title: variantTitle(r.title || '', e.title, label), emoji: r.emoji || '🍰', photoId,
    servings: e.servings, prepMin: e.prepMin, cookMin: e.cookMin,
    ingredients: e.ingredients.map((text) => ({ id: newId(), text, checked: false })),
    steps: e.steps.map((text) => ({ id: newId(), text })),
    notes: withSource(e.notes, source && source.title, source && source.url),
    tags: e.tags, favorite: false, createdAt: now, updatedAt: now,
  });
}

// ---------- UI bits ----------

function progress(el) {
  let i = 0;
  el.hidden = false;
  el.textContent = '✨ ' + EDIT_PROGRESS[0];
  const t = setInterval(() => { i = (i + 1) % EDIT_PROGRESS.length; el.textContent = '✨ ' + EDIT_PROGRESS[i]; }, 2400);
  return () => { clearInterval(t); el.hidden = true; };
}

function askRowHTML(pfx, placeholder) {
  return `<div class="ai-ask">
      <textarea class="ai-input" id="${pfx}-input" rows="1" maxlength="${EDIT_LIMITS.request}" placeholder="${esc(placeholder)}" aria-label="Ask AI to change this recipe"></textarea>
      <button type="button" class="ai-send" id="${pfx}-send" aria-label="Ask" disabled>${icon.up || '↑'}</button>
    </div>
    <div class="ai-code" id="${pfx}-code" hidden><input class="txt" id="${pfx}-code-in" autocomplete="off" spellcheck="false" placeholder="import code"><span>Ask Jaden for the import code ♡ (once per browser)</span></div>
    <p class="ai-progress" id="${pfx}-progress" hidden aria-live="polite"></p>
    <p class="ai-err" id="${pfx}-err" hidden role="alert"></p>`;
}

/** Wire an input row: autosize, enable send, Enter sends (Shift+Enter = new line), rotating placeholder. */
function wireAsk(root, pfx, onSend, { rotate = true } = {}) {
  const $ = (x) => root.querySelector(x);
  const input = $(`#${pfx}-input`), send = $(`#${pfx}-send`), code = $(`#${pfx}-code`);
  const size = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 130) + 'px'; send.disabled = !input.value.trim(); };
  input.addEventListener('input', size);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (input.value.trim()) go(); } });
  let rot = 0, timer = 0;
  if (rotate) timer = setInterval(() => { if (!document.contains(input)) { clearInterval(timer); return; } if (document.activeElement !== input && !input.value) { rot = (rot + 1) % PLACEHOLDERS.length; input.placeholder = PLACEHOLDERS[rot]; } }, 3200);
  const go = () => {
    const request = input.value.trim();
    if (!request) return;
    if (!importCode()) {
      const v = $(`#${pfx}-code-in`).value.trim();
      if (!v) { code.hidden = false; $(`#${pfx}-code-in`).focus(); toast('Add the import code first ♡', { emoji: '🔑' }); return; }
      setImportCode(v);
      code.hidden = true;
    }
    onSend(request);
  };
  send.onclick = go;
  return {
    input,
    busy(on) { input.disabled = on; send.disabled = on || !input.value.trim(); },
    clear() { input.value = ''; size(); },
    error(msg, err) {
      const box = $(`#${pfx}-err`);
      if (err === 'unauthorized') { setImportCode(''); code.hidden = false; msg = 'That import code didn’t work. Check it and try again ♡'; }
      box.textContent = msg || '';
      box.hidden = !msg;
    },
    progress: () => progress($(`#${pfx}-progress`)),
  };
}

function previewHTML(base, res, note) {
  const after = res.recipe;
  const ing = diffLines(base.ingredients, after.ingredients, 'ingredient');
  const st = diffLines(base.steps, after.steps, 'step');
  const meta = metaChanges(base, after);
  const mark = (k) => (k === 'new' ? '<span class="ai-mark">new</span>' : k === 'changed' ? '<span class="ai-mark soft">edited</span>' : '');
  const removed = [...ing.removed, ...st.removed];
  return `<p class="ai-summary">${esc(res.summary)}</p>
    ${res.notes ? `<p class="ai-tip">✨ ${esc(res.notes)}</p>` : ''}
    ${meta.length ? `<p class="ai-meta">${esc(meta.join(' · '))}</p>` : ''}
    ${note ? `<p class="ai-meta">${esc(note)}</p>` : ''}
    <div class="section-label">Ingredients</div>
    <ul class="ai-list">${ing.lines.map((l) => `<li class="${l.kind}"><span class="tx">${esc(l.text)}${l.kind === 'changed' && l.was ? `<s class="was">was ${esc(l.was)}</s>` : ''}</span>${mark(l.kind)}</li>`).join('')}</ul>
    <div class="section-label">Steps</div>
    <ol class="ai-list steps">${st.lines.map((l, i) => `<li class="${l.kind}"><span class="n">${i + 1}</span><span class="tx">${esc(l.text)}</span>${mark(l.kind)}</li>`).join('')}</ol>
    ${removed.length ? `<details class="ai-removed"><summary>Removed (${removed.length})</summary>${removed.map((t) => `<s>${esc(t)}</s>`).join('')}</details>` : ''}`;
}

/** The preview sheet (nothing is saved until she picks an action). */
function openPreview({ id, base, start, note, onDone }) {
  let result = start.result, label = start.result.label, last = { recipe: base, request: start.request }, abort = null;
  const s = sheet({
    title: '✨ Suggested changes',
    wide: true,
    className: 'ai-sheet',
    body: `<div id="ai-pv"></div><div class="ai-refine">${askRowHTML('ai-rf', 'Tweak it… e.g. “use sweet potatoes”')}</div>`,
    foot: `<button type="button" class="btn link small" id="ai-discard">Discard</button><button type="button" class="btn ghost small" id="ai-retry">${icon.refresh || ''} Try again</button>
      <span class="grow"></span><button type="button" class="btn soft" id="ai-new">Save as a new recipe</button><button type="button" class="btn" id="ai-save">Save changes</button>`,
    onClose: () => { if (abort) abort.abort(); },
  });
  const $ = (x) => s.body.querySelector(x) || s.foot.querySelector(x);
  const paint = () => { $('#ai-pv').innerHTML = previewHTML(base, result, note); };
  paint();
  const btns = ['#ai-save', '#ai-new', '#ai-retry'];
  const run = async (call, ask) => {
    if (abort) abort.abort();
    const ctl = new AbortController();
    abort = ctl;
    ask.error('');
    ask.busy(true);
    btns.forEach((b) => ($(b).disabled = true));
    const stop = ask.progress();
    const res = await requestRecipeEdit(call, ctl.signal);
    if (ctl.signal.aborted) return;
    stop();
    ask.busy(false);
    btns.forEach((b) => ($(b).disabled = false));
    if ('error' in res) { ask.error(res.message, res.error); return; }
    result = res;
    if (!label) label = res.label;
    last = call;
    ask.clear();
    paint();
    $('#ai-pv').scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const ask = wireAsk(s.body, 'ai-rf', (request) => run({ recipe: result.recipe, request }, ask), { rotate: false });
  $('#ai-retry').onclick = () => run(last, ask);
  $('#ai-discard').onclick = () => s.close('discard');
  $('#ai-save').onclick = async () => {
    $('#ai-save').disabled = true;
    try {
      await saveInPlace(id, result.recipe);
      s.close('saved');
      onDone('saved');
      toast('Recipe updated ♡', { emoji: '✨', undo: () => undoAiEdit(id).then((ok) => ok && toast('Back to how it was ♡', { emoji: '↩️' })).catch((e) => toast(errText(e))), duration: 6000 });
    } catch (e) { $('#ai-save').disabled = false; toast(errText(e)); }
  };
  $('#ai-new').onclick = async () => {
    $('#ai-new').disabled = true;
    try {
      const nid = await saveAsNew(id, result.recipe, label || result.label);
      s.close('new');
      onDone('new', nid);
      confetti({ emoji: '✨', count: 30 });
      toast('Saved as a new recipe ♡', { emoji: byId('recipes', id)?.emoji || '🍰' });
    } catch (e) { $('#ai-new').disabled = false; toast(errText(e)); }
  };
  return s;
}

/**
 * The calm input under a recipe's steps/notes (recipe view). `getFactor()` is only used for the
 * "amounts are for N servings" note: the AI always gets the recipe at its saved servings.
 */
export function mountAskAi(el, { id, getFactor, onNewRecipe }) {
  el.innerHTML = askRowHTML('ai-q', PLACEHOLDERS[0]);
  let abort = null;
  const ask = wireAsk(el, 'ai-q', async (request) => {
    const r = byId('recipes', id);
    if (!r) return;
    const base = toEditable(r);
    if (!base.ingredients.length && !base.steps.length) { ask.error('Add some ingredients or steps first ♡'); return; }
    if (abort) abort.abort();
    const ctl = new AbortController();
    abort = ctl;
    ask.error('');
    ask.busy(true);
    const stop = ask.progress();
    const res = await requestRecipeEdit({ recipe: base, request }, ctl.signal);
    if (ctl.signal.aborted) return;
    stop();
    ask.busy(false);
    if ('error' in res) { ask.error(res.message, res.error); return; }
    const f = getFactor();
    const note = f !== 1 && r.servings ? `Amounts are for ${r.servings} servings, as saved. Scaling still works after.` : '';
    openPreview({ id, base, start: { request, result: res }, note, onDone: (how, nid) => { ask.clear(); if (how === 'new' && onNewRecipe) onNewRecipe(nid); } });
  });
  return { destroy() { if (abort) abort.abort(); } };
}
