// Em&m Blog: "For this step" ingredient lists (the app's stepIngredients.ts + stepIngsApi.ts, for the web).
// The instant local guess comes from the app's matcher (js/app/recipes/stepIngredients.js, loaded on first use: it
// pulls in the grocery catalog). A stored AI mapping (steps[k].ings + ingsSig, same shape as the app) wins while the
// recipe's texts still match; when there's none, POST {API_BASE}/api/recipe-step-ingredients once per recipe version
// with the per-browser import code (never asks for the code by itself). Offline / no code / failure = the local guess.
// Checkmarks: a step that uses a WHOLE line shares the main ingredient checkmark; a PART of a line (or a line split
// across steps) gets its own per-step tick in kv `recipe_step_checks:<id>` (cleared by "uncheck all").
import { API_BASE } from '../config.js';
import { byId, kv, update } from '../store.js';
import { esc, icon } from '../ui.js';
import { sanitizeStepIngs, stepIngsSig, storedStepIngs } from '../app/recipes/stepIngTypes.js';
import { importCode } from './importer.js';

let matcher = null;
/** The app's matcher module (loads the grocery catalog once). */
export function loadMatcher() {
  if (!matcher) matcher = import('../app/recipes/stepIngredients.js');
  return matcher;
}

/** Display rows per step for recipe `r` at factor `f` (needs the loaded matcher module `m`). */
export function stepRows(m, r, f) {
  const ings = (r.ingredients || []).map((i) => String(i.text || ''));
  const { map } = m.stepIngredientsFor({ ingredients: r.ingredients || [], steps: r.steps || [] });
  return (r.steps || []).map((_, k) => m.stepIngLines(ings, map[k] || [], f));
}

// ---------- the AI mapping: once per recipe version ----------
const triedKey = (id) => `recipe_step_ings_tried:${id}`;
const RETRY_MS = 30 * 60 * 1000;
const running = new Set();

export async function ensureStepIngs(id) {
  const r = byId('recipes', id);
  const code = importCode();
  if (!r || !code || running.has(id) || !(r.steps || []).length || !(r.ingredients || []).length) return;
  if (storedStepIngs(r.ingredients, r.steps)) return;
  const ingredients = r.ingredients.map((i) => String(i.text || '').trim());
  const steps = r.steps.map((s) => String(s.text || '').trim());
  const sig = stepIngsSig(ingredients, steps);
  let tried = null;
  try { tried = JSON.parse(kv.get(triedKey(id), '') || 'null'); } catch (e) { tried = null; }
  if (tried && tried.sig === sig && (!tried.retryAt || Date.now() < tried.retryAt)) return;
  running.add(id);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    let retry = true;
    let json = null;
    try {
      const res = await fetch(`${API_BASE}/api/recipe-step-ingredients`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-emm-import-token': code },
        body: JSON.stringify({ ingredients, steps }),
      });
      json = await res.json().catch(() => null);
      if (json && json.error) retry = json.error === 'server' || json.error === 'rate_limited';
    } catch (e) { json = null; }
    if (json && Array.isArray(json.steps)) {
      await kv.set(triedKey(id), JSON.stringify({ sig }));
      const now = byId('recipes', id);
      // only when she didn't edit it meanwhile
      if (now && stepIngsSig(now.ingredients.map((i) => String(i.text || '').trim()), now.steps.map((s) => String(s.text || '').trim())) === sig) {
        const map = sanitizeStepIngs(json.steps, ingredients.length, steps.length);
        await update('recipes', id, { steps: now.steps.map((s, k) => ({ ...s, ings: map[k], ingsSig: sig })) });
      }
    } else {
      await kv.set(triedKey(id), JSON.stringify(retry ? { sig, retryAt: Date.now() + RETRY_MS } : { sig }));
    }
  } finally {
    clearTimeout(timer);
    running.delete(id);
  }
}

// ---------- per-step ticks for portions ----------
const checksKey = (id) => `recipe_step_checks:${id}`;
function checks(id) {
  try { const a = JSON.parse(kv.get(checksKey(id), '') || '[]'); return new Set(Array.isArray(a) ? a : []); } catch (e) { return new Set(); }
}
export const clearStepChecks = (id) => kv.set(checksKey(id), null);

const own = (l) => l.partial || l.shared;
export function isRowChecked(r, stepId, l) {
  const main = !!((r.ingredients || [])[l.i] || {}).checked;
  return main || (own(l) && checks(r.id).has(`${stepId}:${l.i}`));
}

/** Toggle one row; returns the ingredients patch for the main list (or null when only a per-step tick changed). */
export async function toggleRow(r, stepId, l) {
  const ing = (r.ingredients || [])[l.i];
  if (!ing) return null;
  const flip = () => r.ingredients.map((x) => (x.id === ing.id ? { ...x, checked: !x.checked } : x));
  if (!own(l)) return flip();
  const set = checks(r.id);
  const k = `${stepId}:${l.i}`;
  if (ing.checked) {
    set.delete(k);
    await kv.set(checksKey(r.id), set.size ? JSON.stringify([...set]) : null);
    return flip();
  }
  if (set.has(k)) set.delete(k); else set.add(k);
  await kv.set(checksKey(r.id), set.size ? JSON.stringify([...set]) : null);
  return null;
}

// ---------- markup ----------
const scaleWhole = (m, r, l, f) => {
  const line = String(((r.ingredients || [])[l.i] || {}).text || '').replace(/^\s*[~≈]\s*/, '');
  return m.stepIngLines([line], [{ i: 0 }], f)[0]?.qty || null;
};
function note(m, r, l, f) {
  if (l.partial) { const whole = scaleWhole(m, r, l, f); return whole && whole !== l.qty ? `of ${whole}` : ''; }
  return l.shared ? 'divided' : '';
}

/** The recipe view's compact "For this step" block (max 6 rows, "+N more"). */
export function blockHTML(m, r, stepId, lines, f, { open = false, canEdit = true } = {}) {
  if (!lines.length) return '';
  const max = 6;
  const shown = open || lines.length <= max ? lines : lines.slice(0, max - 1);
  const more = lines.length - shown.length;
  return `<div class="rv-sing"><div class="rv-sing-lbl">For this step</div>${shown.map((l) => rowHTML(m, r, stepId, l, f, 'rv-sing-row', canEdit)).join('')}${more ? `<button type="button" class="rv-sing-more" data-more="${esc(stepId)}">+${more} more</button>` : ''}</div>`;
}

/** Cook mode's big "You'll need for this step" list. */
export function cookHTML(m, r, stepId, lines, f) {
  if (!lines.length) return '';
  return `<div class="cook-sing"><div class="cook-sing-lbl">You’ll need for this step</div>${lines.map((l) => rowHTML(m, r, stepId, l, f, 'cook-sing-row', true)).join('')}</div>`;
}

function rowHTML(m, r, stepId, l, f, cls, canEdit) {
  const on = isRowChecked(r, stepId, l);
  const n = note(m, r, l, f);
  const label = `${l.qty ? l.qty + ' ' : ''}${l.name}${n ? ', ' + n : ''}`;
  return `<button type="button" class="${cls}${on ? ' checked' : ''}" data-step="${esc(stepId)}" data-i="${l.i}" aria-pressed="${on}" aria-label="${esc(label)}" ${canEdit ? '' : 'disabled'}>
    <span class="box" aria-hidden="true">${icon.check}</span><span class="tx">${l.qty ? `<b>${esc(l.qty)}</b> ` : ''}${esc(l.name)}${n ? ` <small>${esc(n)}</small>` : ''}</span></button>`;
}
