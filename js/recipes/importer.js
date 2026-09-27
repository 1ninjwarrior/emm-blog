// Em&m Blog: "Import from a link" (the app's ImportRecipeScreen + importApi, for the web).
// POST {API_BASE}/api/recipe-import with {url?|text?|imageBase64?} → {recipe, confidence, source, warnings, foundVia?, continue?}
// While the answer carries `continue`, re-POST {continue} (fresh server run) up to 4 times; if a follow-up fails
// we keep the answer we already have. The import code (the app's public "speed bump" token) is asked for once per
// browser and kept only in this browser's localStorage (never in the site's files).
import { API_BASE } from '../config.js';
import { esc, sheet, toast, icon, loadImage } from '../ui.js';

const CODE_KEY = 'emm-import-code';
const TIMEOUT_MS = 75000;
const URL_RE = /https?:\/\/[^\s<>"']+/i;
const VIDEO_RE = /youtu\.?be|instagram\.com|tiktok\.com/i;
const YT_RE = /^https?:\/\/([a-z]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i;
const TRANSCRIPT_MAX = 40000; // = the server's IMPORT_TRANSCRIPT_MAX
const YT_TIP = 'Tip: on YouTube, tap ··· → Show transcript, copy it and paste here';

const STEPS = {
  video: ['Watching the video…', 'Listening for the recipe…', 'Writing down the ingredients…', 'Checking their links…', 'Looking for the full recipe…', 'Tidying up the steps…', 'Almost there… ✨'],
  page: ['Opening the page…', 'Reading the recipe…', 'Tidying up the steps…', 'Almost there… ✨'],
  text: ['Reading it through…', 'Sorting ingredients from steps…', 'Almost there… ✨'],
  photo: ['Looking at your photo…', 'Reading the recipe…', 'Tidying up the steps…', 'Almost there… ✨'],
};

export function importCode() { try { return localStorage.getItem(CODE_KEY) || ''; } catch (e) { return ''; } }
export function setImportCode(v) { try { if (v) localStorage.setItem(CODE_KEY, v.trim()); else localStorage.removeItem(CODE_KEY); } catch (e) { /* ignore */ } }

/** Pull the first link out of whatever she pasted (share sheets often add text around it). */
export function linkIn(s) {
  const m = URL_RE.exec(String(s || '').trim());
  return m ? m[0].replace(/[).,!?]+$/, '') : null;
}

async function postImport(req, signal) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/recipe-import`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-emm-import-token': importCode() },
      body: JSON.stringify(req),
    });
    const json = await res.json().catch(() => null);
    if (json && ('recipe' in json || 'error' in json)) return json;
    return { error: 'server', message: res.status === 404 ? 'Recipe import isn’t available right now.' : 'Something went wrong. Try again in a moment.' };
  } catch (e) {
    if (signal && signal.aborted) return { error: 'server', message: 'Cancelled' };
    return { error: 'server', message: ctl.signal.aborted ? 'That took too long. Try again, or paste the caption instead.' : 'Couldn’t reach the recipe helper. Are you online?' };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** The app's requestRecipeImport: first call + up to 4 `continue` follow-ups. */
export async function requestRecipeImport(req, signal, onLookingFurther) {
  let res = await postImport(req, signal);
  for (let i = 0; i < 4 && res.continue && !(signal && signal.aborted); i++) {
    if (onLookingFurther) onLookingFurther();
    const next = await postImport({ continue: res.continue }, signal);
    if (signal && signal.aborted) return next;
    if ('recipe' in next || next.error === 'no_recipe_found') res = next;
    else break;
  }
  const out = { ...res };
  delete out.continue;
  return out;
}

/** A picked photo → ≤1600px JPEG base64 (no data: prefix). */
export async function photoToBase64(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = Math.min(1, 1600 / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1] || null;
  } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
}

/** Best effort: the video/page thumbnail as a Blob (usually blocked by CORS on the web → null). */
export async function fetchThumbnail(url) {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { signal: ctl.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    clearTimeout(t);
    if (!r.ok) return null;
    const b = await r.blob();
    return /^image\//.test(b.type) && b.size > 500 ? b : null;
  } catch (e) { return null; }
}

function errTitle(e) {
  return ({
    private_or_blocked: 'We couldn’t peek at that one',
    no_recipe_found: 'No recipe in there',
    unsupported_link: 'That link won’t work',
    too_long: 'That’s a big one',
    rate_limited: 'Little break time',
    unauthorized: 'That import code didn’t work',
  })[e.error] || 'Something went wrong';
}

/**
 * YouTube hides a video's captions from servers (and browsers can't read them cross-origin), so a video whose
 * recipe is only spoken comes back weak on the web. The app reads the captions on the phone instead.
 */
function weakYouTube(res) {
  if ('recipe' in res) return res.confidence === 'low' && !res.foundVia;
  return res.error === 'no_recipe_found' || res.error === 'private_or_blocked';
}

/**
 * The import sheet. Callbacks:
 *   onRecipe(res, {kind}) : an OK response (recipe filled in by the caller)
 *   onShared(payload)     : she pasted an Em&m Blog share link
 *   onLocal(text)         : "Sort it out here" (offline parser)
 *   shareLinkPayload(t)   : detector (from codec.js)
 */
export function openImportSheet({ url = '', text = '', onRecipe, onShared, onLocal, shareLinkPayload }) {
  let abort = null, stepTimer = 0, phase = 'idle', last = { text: '', wasLink: false, yt: null };
  let pairWith = null; // a YouTube link whose transcript she's about to paste
  let weakOk = null; // a weak YouTube answer she can still use
  const s = sheet({
    title: 'Import a recipe ✨',
    className: 'import-sheet',
    body: `<div class="imp-idle" id="imp-idle">
        <p class="imp-help">Paste a link from YouTube, Instagram, TikTok or a recipe site (or the caption itself). We’ll write it down for you to check ♡</p>
        <div class="field imp-code" id="imp-code-row" hidden>
          <label class="lbl" for="imp-code">Import code</label>
          <input class="txt" id="imp-code" autocomplete="off" spellcheck="false" placeholder="paste the code">
          <p class="note">Ask Jaden for the import code ♡ (you only need it once on this browser)</p>
        </div>
        <div class="field"><label class="lbl" for="imp-input">Link or caption</label>
          <textarea class="txt" id="imp-input" rows="4" placeholder="https://www.youtube.com/shorts/…" autofocus></textarea></div>
        <div class="imp-row">
          <button type="button" class="btn soft small" id="imp-paste">${icon.copy} Paste</button>
          <label class="btn soft small" id="imp-photo-lbl" tabindex="0">${icon.upload} Use a photo<input type="file" id="imp-photo" accept="image/*" hidden></label>
        </div>
        <div class="imp-err" id="imp-err" hidden role="alert"></div>
      </div>
      <div class="imp-working" id="imp-working" hidden aria-live="polite">
        <div class="imp-spin" aria-hidden="true">🍳</div><p id="imp-step"></p>
        <button type="button" class="btn ghost small" id="imp-cancel">Cancel</button>
      </div>`,
    foot: `<button type="button" class="btn soft" id="imp-close">Not now</button><button type="button" class="btn" id="imp-go">Import ♡</button>`,
    onClose: () => { if (abort) abort.abort(); clearInterval(stepTimer); },
  });
  const $s = (x) => s.body.querySelector(x) || s.foot.querySelector(x);
  const input = $s('#imp-input');
  input.value = url || text || '';
  const showCode = () => { $s('#imp-code-row').hidden = !!importCode(); };
  showCode();

  const setPhase = (p, kind) => {
    phase = p;
    $s('#imp-idle').hidden = p === 'working';
    $s('#imp-working').hidden = p !== 'working';
    s.foot.hidden = p === 'working';
    clearInterval(stepTimer);
    if (p === 'working') {
      const steps = STEPS[kind];
      let i = 0;
      const el = $s('#imp-step');
      el.textContent = steps[0];
      s._steps = steps;
      s._step = (n) => { i = Math.max(i, n); el.textContent = steps[Math.min(i, steps.length - 1)]; };
      stepTimer = setInterval(() => { if (i < steps.length - 1) { i++; el.textContent = steps[i]; } }, kind === 'video' ? 3200 : 2200);
    }
  };

  const showError = (err) => {
    const box = $s('#imp-err');
    if (last.yt && weakYouTube(err)) { showYouTubeHelp(err); return; }
    const canLocal = !last.wasLink && err.error === 'server' && last.text.trim() && !linkIn(last.text);
    const btns = [];
    if (err.error === 'unauthorized') { setImportCode(''); showCode(); }
    else if (last.wasLink) btns.push(`<button type="button" class="btn soft small" data-f="caption">Paste the caption instead</button>`);
    if (err.error !== 'unauthorized' && err.error !== 'rate_limited') btns.push(`<button type="button" class="btn soft small" data-f="photo">Use a photo</button>`);
    if (canLocal || (!last.wasLink && last.text.trim() && err.error !== 'unauthorized')) btns.push(`<button type="button" class="btn soft small" data-f="local">Sort it out here</button>`);
    if (err.error === 'server') btns.push(`<button type="button" class="btn ghost small" data-f="retry">${icon.refresh} Try again</button>`);
    box.innerHTML = `<b>${esc(errTitle(err))}</b><p>${esc(err.error === 'unauthorized' ? 'Check the import code and try again ♡' : err.message || '')}</p><div class="imp-row">${btns.join('')}</div>`;
    box.hidden = false;
  };

  /** A weak YouTube result (or none): offer the transcript / a photo, and keep a usable answer one tap away. */
  const showYouTubeHelp = (res) => {
    const box = $s('#imp-err');
    const ok = 'recipe' in res;
    weakOk = ok ? res : null;
    const btns = [
      ok ? `<button type="button" class="btn small" data-f="use">Use it anyway</button>` : '',
      `<button type="button" class="btn soft small" data-f="transcript">Paste the transcript</button>`,
      `<button type="button" class="btn soft small" data-f="photo">Use a photo</button>`,
    ];
    const title = ok ? 'We only got part of it' : errTitle(res);
    const msg = ok
      ? 'YouTube doesn’t let the website hear what’s said in this video, so amounts may be missing. The app can, or paste the transcript here.'
      : res.message || '';
    box.innerHTML = `<b>${esc(title)}</b><p>${esc(msg)}</p><p class="imp-tip">${esc(YT_TIP)}</p><div class="imp-row">${btns.join('')}</div>`;
    box.hidden = false;
  };

  const askTranscript = () => {
    pairWith = last.yt;
    weakOk = null;
    input.value = '';
    input.placeholder = 'Paste the transcript here…';
    $s('#imp-err').hidden = true;
    input.focus();
  };

  const run = async (req, kind) => {
    if (abort) abort.abort();
    const ctl = new AbortController();
    abort = ctl;
    $s('#imp-err').hidden = true;
    setPhase('working', kind);
    const res = await requestRecipeImport(req, ctl.signal, () => s._step && s._step(STEPS.video.indexOf('Looking for the full recipe…')));
    if (ctl.signal.aborted) return;
    setPhase('idle');
    if ('recipe' in res && !(last.yt && !req.transcript && weakYouTube(res))) {
      s.close('ok');
      onRecipe(res, { kind });
      return;
    }
    showError(res);
  };

  const needCode = () => {
    if (importCode()) return false;
    const v = $s('#imp-code').value.trim();
    if (v) { setImportCode(v); showCode(); return false; }
    $s('#imp-code').focus();
    toast('Add the import code first ♡', { emoji: '🔑' });
    return true;
  };

  const go = () => {
    const t = input.value.trim();
    if (!t) { input.focus(); return; }
    const shared = shareLinkPayload ? shareLinkPayload(t) : null;
    if (shared) { s.close('shared'); onShared(shared); return; }
    if (needCode()) return;
    const link = linkIn(t);
    if (pairWith && !link) {
      // the transcript of the YouTube video she just tried
      last = { text: t, wasLink: false, yt: pairWith };
      run({ url: pairWith, transcript: t.slice(0, TRANSCRIPT_MAX) }, 'video');
      return;
    }
    pairWith = null;
    input.placeholder = 'https://www.youtube.com/shorts/…';
    last = { text: t, wasLink: !!link, yt: link && YT_RE.test(link) ? link : null };
    if (link) run({ url: link }, VIDEO_RE.test(link) ? 'video' : 'page');
    else run({ text: t }, 'text');
  };

  const pickPhoto = async (file) => {
    if (needCode()) return;
    setPhase('working', 'photo');
    const b64 = await photoToBase64(file);
    if (!b64) { setPhase('idle'); toast('Couldn’t open that photo', { emoji: '🥲' }); return; }
    const extra = input.value.trim() && !linkIn(input.value) ? input.value.trim() : undefined;
    last = { text: input.value, wasLink: false, yt: null };
    run({ imageBase64: b64, text: extra }, 'photo');
  };

  $s('#imp-go').onclick = go;
  $s('#imp-close').onclick = () => s.close('cancel');
  $s('#imp-cancel').onclick = () => { if (abort) abort.abort(); setPhase('idle'); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } });
  $s('#imp-paste').onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) { toast('Your clipboard is empty', { emoji: '📋' }); return; }
      input.value = t; $s('#imp-err').hidden = true;
    } catch (e) { toast('Paste with ⌘V / long-press instead ♡', { emoji: '📋' }); input.focus(); }
  };
  const photoInput = $s('#imp-photo');
  $s('#imp-photo-lbl').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); photoInput.click(); } });
  photoInput.addEventListener('change', () => { const f = photoInput.files[0]; photoInput.value = ''; if (f) pickPhoto(f); });
  $s('#imp-err').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const f = b.dataset.f;
    if (f === 'caption') { input.value = ''; $s('#imp-err').hidden = true; input.focus(); }
    if (f === 'transcript') askTranscript();
    if (f === 'use' && weakOk) { const res = weakOk; weakOk = null; s.close('ok'); onRecipe(res, { kind: 'video' }); }
    if (f === 'photo') photoInput.click();
    if (f === 'local') { s.close('local'); onLocal(last.text); }
    if (f === 'retry') go();
  });
  // Deep link (#import?url=…) starts right away.
  if (url && importCode()) setTimeout(go, 300);
  return s;
}
