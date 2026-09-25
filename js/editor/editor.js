// Em&m Blog: Instagram-story style photo editor (full-screen, canvas based).
//
//   openStoryEditor({src, post, model, title}) -> Promise<null | {blob, width, height, edit}>
//   renderStory(src, edit, maxSide = 1440)     -> Promise<{blob, width, height, edit}>  (headless flatten)
//
// The editable model (`edit`) stored on posts:
//   {type:'story', v:2, base:{assetId}, crop:{aspect:'original'|'1:1'|'4:5'|'9:16', cx, cy, zoom},
//    rotate: 0|90|180|270, filter, adjust:{brightness,contrast,saturation,warmth}, frame, layers:[...]}
// Layers are described in layers.js (text / sticker) and draw.js (the single draw layer).
// Coordinates are normalized to the whole output canvas, so it re-renders at any size.
//
// Base image: `src`, else originalSrc(post). For collage posts (post.kind === 'collage' with a
// collage edit) the base is re-rendered from the collage model (collage.js renderCollageBase) and the
// returned edit is the collage edit with its `story` field replaced by the new story model.
import { $, esc, fullscreen, confirmDlg, toast, loadFonts, loadImage, clamp, reducedMotion, isPhone } from '../ui.js';
import { originalSrc } from '../posts.js';
import { FILTERS, DEFAULT_ADJUST, drawFiltered } from './filters.js';
import { FRAMES, normFrame, framePad, frameHasAlpha, drawFrameBack, drawFrameFront } from './frames.js';
import {
  FONTS, COLORS, STICKER_EMOJIS, lid, loadManifest, stickerImage, imagesReady, setImageLoadHandler,
  drawLayer, drawSelection, hitLayer, handlePos, layerSize, legacyStickersToLayers, fontOf,
} from './layers.js';
import { TOOLS, SIZES, newStroke, addPoint, renderStroke, renderStrokes } from './draw.js';

export const ASPECTS = [
  { id: 'original', label: 'Original', ar: null },
  { id: '1:1', label: '1:1', ar: 1 },
  { id: '4:5', label: '4:5', ar: 4 / 5 },
  { id: '9:16', label: '9:16', ar: 9 / 16 },
];
const EDITOR_FONTS = FONTS.map((f) => f.id);
const MAX_SIDE = 1440;

// ---------------------------------------------------------------------------
// model helpers
// ---------------------------------------------------------------------------
function blankModel() {
  return {
    type: 'story', v: 2, base: { assetId: null },
    crop: { aspect: 'original', cx: 0.5, cy: 0.5, zoom: 1 },
    rotate: 0, filter: 'none', adjust: { ...DEFAULT_ADJUST }, frame: 'none',
    layers: [{ id: lid(), type: 'draw', strokes: [] }],
  };
}
/** Make any stored model safe to edit (fills defaults, exactly one draw layer). */
function sanitize(m) {
  const b = blankModel();
  if (!m || m.type !== 'story') return b;
  const out = {
    ...b,
    base: { assetId: (m.base && m.base.assetId) || null },
    crop: { ...b.crop, ...(m.crop || {}) },
    rotate: [0, 90, 180, 270].includes(m.rotate) ? m.rotate : 0,
    filter: FILTERS.some((f) => f.id === m.filter) ? m.filter : 'none',
    adjust: { ...DEFAULT_ADJUST, ...(m.adjust || {}) },
    frame: normFrame(m.frame),
    layers: Array.isArray(m.layers) ? JSON.parse(JSON.stringify(m.layers)).filter((l) => l && ['text', 'sticker', 'draw'].includes(l.type)) : [],
  };
  if (!ASPECTS.some((a) => a.id === out.crop.aspect)) out.crop.aspect = 'original';
  const draws = out.layers.filter((l) => l.type === 'draw');
  if (!draws.length) out.layers.unshift({ id: lid(), type: 'draw', strokes: [] });
  else if (draws.length > 1) {
    const all = draws.flatMap((d) => d.strokes || []);
    out.layers = out.layers.filter((l) => l.type !== 'draw' || l === draws[0]);
    draws[0].strokes = all;
  }
  for (const l of out.layers) { if (!l.id) l.id = lid(); if (l.type === 'draw' && !Array.isArray(l.strokes)) l.strokes = []; }
  return out;
}

/** A rotated copy of the source image (max long side `cap`). */
function rotatedSource(img, rotate, cap) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = Math.min(1, cap / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
  const side = rotate % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = side ? h : w; c.height = side ? w : h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

/** Output geometry at long side L: {W, H, r:{x,y,w,h}} (r = photo rect). sw/sh = rotated source size. */
function geom(m, sw, sh, L) {
  const asp = ASPECTS.find((a) => a.id === m.crop.aspect);
  const ar = (asp && asp.ar) || sw / sh;
  const pad = framePad(m.frame);
  const wr = 1 + pad.l + pad.r, hr = 1 / ar + pad.t + pad.b;
  const pw = L / Math.max(wr, hr);
  return { W: Math.max(1, Math.round(pw * wr)), H: Math.max(1, Math.round(pw * hr)), r: { x: pw * pad.l, y: pw * pad.t, w: pw, h: pw / ar }, ar };
}

/** The source window shown in the photo rect, for crop {cx, cy, zoom}. */
function cropWindow(crop, sw, sh, r) {
  const scale = Math.max(r.w / sw, r.h / sh) * Math.max(1, crop.zoom || 1);
  const w = Math.min(sw, r.w / scale), h = Math.min(sh, r.h / scale);
  const x = clamp((crop.cx ?? 0.5) * sw - w / 2, 0, sw - w);
  const y = clamp((crop.cy ?? 0.5) * sh - h / 2, 0, sh - h);
  return { x, y, w, h, scale };
}
function clampCrop(crop, sw, sh, r) {
  const win = cropWindow(crop, sw, sh, r);
  crop.cx = Math.round(((win.x + win.w / 2) / sw) * 10000) / 10000;
  crop.cy = Math.round(((win.y + win.h / 2) / sh) * 10000) / 10000;
}

/** Frame + filtered photo (the part that only changes with crop/filter/frame). */
function drawBase(ctx, m, src, W, H, r) {
  drawFrameBack(ctx, m.frame, W, H, r);
  const win = cropWindow(m.crop, src.width, src.height, r);
  drawFiltered(ctx, src, [win.x, win.y, win.w, win.h], [r.x, r.y, r.w, r.h], m.filter, m.adjust);
  drawFrameFront(ctx, m.frame, W, H, r);
}

/** Keep the model small (< ~200 KB): thin out drawing points if needed. */
function compact(m) {
  let json = JSON.stringify(m);
  let guard = 0;
  while (json.length > 200000 && guard++ < 6) {
    for (const l of m.layers) if (l.type === 'draw') for (const st of l.strokes) {
      if (st.p.length > 8) { const p = []; for (let i = 0; i < st.p.length; i += 4) p.push(st.p[i], st.p[i + 1]); p.push(st.p[st.p.length - 2], st.p[st.p.length - 1]); st.p = p; }
    }
    json = JSON.stringify(m);
  }
  return m;
}

/** Flatten a model over an already-loaded image. */
async function flatten(img, m, maxSide = MAX_SIDE) {
  await Promise.all([loadFonts(usedFonts(m)), imagesReady(m.layers)]);
  const src = rotatedSource(img, m.rotate, 4000);
  const g = geom(m, src.width, src.height, maxSide);
  const c = document.createElement('canvas');
  c.width = g.W; c.height = g.H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const alpha = frameHasAlpha(m.frame);
  drawBase(ctx, m, src, g.W, g.H, g.r);
  for (const l of m.layers) {
    if (l.type === 'draw') {
      if (!l.strokes.length) continue;
      const d = document.createElement('canvas'); d.width = g.W; d.height = g.H;
      renderStrokes(d, l.strokes);
      ctx.drawImage(d, 0, 0);
    } else drawLayer(ctx, l, g.W, g.H);
  }
  const type = alpha ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), type, 0.9));
  return { blob, width: g.W, height: g.H };
}
const usedFonts = (m) => [...new Set(m.layers.filter((l) => l.type === 'text').map((l) => fontOf(l.font).id))];

/** Headless: render an edit model over an image URL. */
export async function renderStory(src, edit, maxSide = MAX_SIDE) {
  const img = await loadImage(src);
  const m = compact(sanitize(edit));
  const r = await flatten(img, m, maxSide);
  return { ...r, edit: m };
}

// ---------------------------------------------------------------------------
// the editor
// ---------------------------------------------------------------------------
export async function openStoryEditor({ src = '', post = null, model = null, title = 'Decorate' } = {}) {
  let collageEdit = null;
  let revokeSrc = null;
  if (!src && post && post.kind === 'collage' && post.edit && post.edit.type === 'collage') {
    collageEdit = post.edit;
    try {
      const { renderCollageBase } = await import('./collage.js');
      src = await renderCollageBase(collageEdit);
      revokeSrc = src;
    } catch (e) { toast('Couldn’t open that collage. Try again?'); return null; }
    if (!model) model = collageEdit.story || null;
  }
  if (!src && post) src = originalSrc(post);
  if (!model && post && post.edit && post.edit.type === 'story') model = post.edit;
  if (!src) { toast('No photo to decorate'); return null; }

  return new Promise((resolve) => {
    let result = null;
    let forceClose = false;
    const layer = fullscreen({
      className: 'ed-dialog', label: title,
      beforeClose: () => {
        if (forceClose || !isDirty()) return true;
        confirmDlg({ title: 'Toss your changes?', message: 'Your decorations won’t be saved.', confirmLabel: 'Toss them', cancelLabel: 'Keep editing', emoji: '🥺', destructive: true })
          .then((ok) => { if (ok) { forceClose = true; layer.close('discard'); } });
        return false;
      },
      onClose: () => { cleanup(); if (revokeSrc && revokeSrc.startsWith('blob:')) URL.revokeObjectURL(revokeSrc); resolve(result); },
    });
    const Ed = createEditor(layer, { src, post, model, title, collage: !!collageEdit });
    const cleanup = Ed.cleanup;
    const isDirty = Ed.isDirty;
    Ed.onSave = (r) => {
      result = r;
      if (collageEdit) result = { ...r, edit: { ...collageEdit, story: r.edit } };
      forceClose = true;
      layer.close('save');
    };
    Ed.onCancel = () => layer.close('cancel');
  });
}

function createEditor(layer, { src, post, model, title, collage }) {
  const root = layer.el;
  root.innerHTML = `
  <div class="ed" id="ed-root">
    <header class="ed-top">
      <button type="button" class="ed-ic" id="ed-cancel" aria-label="Close editor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <h2 class="ed-title">${esc(title)}</h2>
      <div class="ed-hist">
        <button type="button" class="ed-ic" id="ed-undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/></svg></button>
        <button type="button" class="ed-ic" id="ed-redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7l4.5 4.5L15 16"/><path d="M19 11.5h-9a5 5 0 0 0 0 10h2"/></svg></button>
      </div>
      <button type="button" class="btn small ed-save" id="ed-save">Save ♡</button>
    </header>
    <div class="ed-main">
      <div class="ed-stage" id="ed-stage">
        <canvas id="ed-canvas" class="ed-canvas" tabindex="0" aria-label="Photo canvas. Drag things to move them, Delete removes the selected one."></canvas>
        <div class="ed-selbar" id="ed-selbar" hidden>
          <button type="button" class="ed-chip" data-sel="edit" id="ed-sel-edit">✏️ Edit</button>
          <button type="button" class="ed-chip" data-sel="up" id="ed-sel-up" aria-label="Bring forward" title="Bring forward">⬆️</button>
          <button type="button" class="ed-chip" data-sel="down" id="ed-sel-down" aria-label="Send back" title="Send back">⬇️</button>
          <button type="button" class="ed-chip" data-sel="dup" id="ed-sel-dup" aria-label="Duplicate" title="Duplicate">⧉</button>
          <button type="button" class="ed-chip danger" data-sel="del" id="ed-sel-del" aria-label="Delete" title="Delete">🗑️</button>
        </div>
        <div class="ed-trash" id="ed-trash" hidden aria-hidden="true">🗑️</div>
        <p class="ed-hint" id="ed-hint" aria-live="polite"></p>
        <div class="ed-loading" id="ed-loading"><span class="ed-spin" aria-hidden="true">🌸</span>getting your photo ready…</div>
      </div>
      <aside class="ed-panel" aria-label="Tools">
        <div class="ed-tabs" role="tablist" id="ed-tabs">
          ${[['stickers', '🧸', 'Stickers'], ['text', 'Aa', 'Text'], ['draw', '✍️', 'Draw'], ['filters', '🎞️', 'Filters'], ['adjust', '🎚️', 'Adjust'], ['crop', '✂️', 'Crop'], ['frames', '🖼️', 'Frames']]
            .map(([id, e, l]) => `<button type="button" role="tab" class="ed-tab" id="ed-tab-${id}" data-tab="${id}" aria-selected="false" aria-controls="ed-pane"><span class="e" aria-hidden="true">${e}</span>${l}</button>`).join('')}
        </div>
        <div class="ed-pane" id="ed-pane" role="tabpanel"></div>
      </aside>
    </div>
    <div class="ed-textbox" id="ed-textbox" hidden>
      <div class="ed-textcard" role="group" aria-label="Edit text">
        <label class="sr-only" for="ed-text-input">Your text</label>
        <textarea id="ed-text-input" class="ed-text-input" rows="2" maxlength="300" placeholder="type something cute…"></textarea>
        <div class="ed-row ed-fonts" id="ed-text-fonts" role="group" aria-label="Font">
          ${FONTS.map((f) => `<button type="button" class="ed-chip" id="ed-font-${f.id.replace(/\s+/g, '-').toLowerCase()}" data-font="${esc(f.id)}" style="font-family:'${esc(f.id)}';font-weight:${f.weight}">${esc(f.label)}</button>`).join('')}
        </div>
        <div class="ed-row" role="group" aria-label="Style">
          ${[['plain', 'Aa', 'Plain'], ['bubble', '💬', 'Bubble'], ['outline', '🅰️', 'Outline'], ['glow', '✨', 'Glow']].map(([id, e, l]) => `<button type="button" class="ed-chip" id="ed-style-${id}" data-style="${id}">${e} ${l}</button>`).join('')}
          <span class="ed-sep"></span>
          ${[['left', '⇤'], ['center', '↔'], ['right', '⇥']].map(([id, e]) => `<button type="button" class="ed-chip" id="ed-align-${id}" data-align="${id}" aria-label="Align ${id}">${e}</button>`).join('')}
        </div>
        <div class="ed-row ed-colors" id="ed-text-colors" role="group" aria-label="Colour">
          ${COLORS.map((c, i) => `<button type="button" class="ed-color" id="ed-tcolor-${i}" data-color="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('')}
        </div>
        <div class="ed-row">
          <label class="ed-lbl" for="ed-text-size">Size</label>
          <input type="range" id="ed-text-size" min="2" max="30" step="0.5">
          <button type="button" class="btn small" id="ed-text-done">Done ♡</button>
        </div>
      </div>
    </div>
  </div>`;

  // ---------- state ----------
  const canvas = $('#ed-canvas', root);
  const ctx = canvas.getContext('2d');
  const stage = $('#ed-stage', root);
  let m = sanitize(model);
  let img = null, prevSrc = null; // preview-size rotated source
  let g = null; // display geometry
  let baseCache = document.createElement('canvas');
  let drawCanvas = document.createElement('canvas');
  let baseDirty = true, dirty = true, raf = 0;
  let selected = null; // layer id
  let tab = 'stickers';
  let drawTool = 'pen', drawColor = '#FF6B9D', drawSize = SIZES[1];
  let liveStroke = null;
  let editingText = null;
  let history = [], hi = -1;
  let destroyed = false;
  const dpr = () => Math.min(2.5, window.devicePixelRatio || 1);
  const api = { onSave: null, onCancel: null, cleanup, isDirty };

  const drawLayerOf = () => m.layers.find((l) => l.type === 'draw');
  const selLayer = () => m.layers.find((l) => l.id === selected) || null;

  // ---------- history ----------
  const snap = () => JSON.stringify(m);
  function commit() {
    const s = snap();
    if (history[hi] === s) return;
    history = history.slice(0, hi + 1);
    history.push(s);
    if (history.length > 60) history.shift();
    hi = history.length - 1;
    syncHistBtns();
  }
  function restore(s) {
    const prevRot = m.rotate;
    m = JSON.parse(s);
    if (m.rotate !== prevRot) buildSources();
    if (selected && !selLayer()) selected = null;
    resize();
    renderDrawCanvas();
    baseDirty = true; markDirty();
    renderPane(); syncSel(); syncHistBtns();
  }
  function undo() { if (hi > 0) { hi--; restore(history[hi]); } }
  function redo() { if (hi < history.length - 1) { hi++; restore(history[hi]); } }
  function syncHistBtns() { $('#ed-undo', root).disabled = hi <= 0; $('#ed-redo', root).disabled = hi >= history.length - 1; }
  function isDirty() { return history.length > 0 && snap() !== history[0]; }

  // ---------- rendering ----------
  function markDirty() { dirty = true; if (!raf && !destroyed) raf = requestAnimationFrame(frame); }
  setImageLoadHandler(markDirty);

  function buildSources() {
    if (!img) return;
    prevSrc = rotatedSource(img, m.rotate, 1800);
  }

  function resize() {
    if (!prevSrc) return;
    const box = stage.getBoundingClientRect();
    const padX = isPhone() ? 16 : 36, padY = isPhone() ? 64 : 76;
    const bw = Math.max(80, box.width - padX * 2), bh = Math.max(80, box.height - padY * 2);
    const g0 = geom(m, prevSrc.width, prevSrc.height, 1000);
    const ratio = g0.W / g0.H;
    let cw = Math.min(bw, bh * ratio), ch = cw / ratio;
    const d = dpr();
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    const L = Math.round(Math.max(cw, ch) * d);
    g = geom(m, prevSrc.width, prevSrc.height, L);
    if (canvas.width !== g.W || canvas.height !== g.H) { canvas.width = g.W; canvas.height = g.H; }
    if (baseCache.width !== g.W || baseCache.height !== g.H) { baseCache.width = g.W; baseCache.height = g.H; }
    if (drawCanvas.width !== g.W || drawCanvas.height !== g.H) { drawCanvas.width = g.W; drawCanvas.height = g.H; renderDrawCanvas(); }
    baseDirty = true; markDirty();
  }
  function renderDrawCanvas() { const dl = drawLayerOf(); renderStrokes(drawCanvas, dl ? dl.strokes : []); markDirty(); }

  function frame() {
    raf = 0;
    if (!dirty || !g || !prevSrc || destroyed) return;
    dirty = false;
    const { W, H } = g;
    if (baseDirty) {
      const b = baseCache.getContext('2d');
      b.clearRect(0, 0, W, H);
      drawBase(b, m, prevSrc, W, H, g.r);
      baseDirty = false;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(baseCache, 0, 0);
    for (const l of m.layers) {
      if (l.type === 'draw') {
        ctx.drawImage(drawCanvas, 0, 0);
        if (liveStroke && liveStroke.t !== 'eraser') renderStroke(ctx, liveStroke, W, H);
      } else drawLayer(ctx, l, W, H);
    }
    const s = selLayer();
    if (s && tab !== 'draw' && tab !== 'crop' && !editingText) drawSelection(ctx, s, W, H, dpr());
  }

  // ---------- load ----------
  (async () => {
    try {
      const [im] = await Promise.all([loadImage(src), loadFonts(EDITOR_FONTS)]);
      if (destroyed) return;
      img = im;
      buildSources();
      // Legacy v1 {frame, stickers} -> layers (only when there's no story model yet).
      if (!model && post && !(post.edit && post.edit.type === 'story')) {
        if (post.frame) m.frame = normFrame(post.frame);
        if (Array.isArray(post.stickers) && post.stickers.length) {
          const gg = geom(m, prevSrc.width, prevSrc.height, 1000);
          m.layers.push(...legacyStickersToLayers(post.stickers, gg.r, gg.W, gg.H));
        }
      }
      $('#ed-loading', root).hidden = true;
      resize();
      renderDrawCanvas();
      commit();
      setTab(m.layers.length > 1 || m.frame !== 'none' ? 'stickers' : 'stickers');
    } catch (e) {
      $('#ed-loading', root).innerHTML = '<span aria-hidden="true">🥺</span> couldn’t load that photo';
    }
  })();

  // ---------- coordinates ----------
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  }

  // ---------- layers ----------
  function addLayer(l) {
    m.layers.push(l);
    selected = l.id;
    commit(); syncSel(); markDirty();
    popIn(l);
  }
  function popIn(l) {
    if (reducedMotion()) return;
    const target = l.s, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 260);
      const e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); // back-out
      l.s = target * Math.max(0.2, e);
      markDirty();
      if (k < 1 && !destroyed) requestAnimationFrame(step); else { l.s = target; markDirty(); }
    };
    requestAnimationFrame(step);
  }
  const jitter = () => (Math.random() - 0.5) * 0.16;
  function addEmoji(e) { addLayer({ id: lid(), type: 'sticker', kind: 'emoji', e, x: 0.5 + jitter(), y: 0.5 + jitter(), s: 0.2, rot: (Math.random() - 0.5) * 0.4 }); }
  function addImageSticker(file) {
    const c = stickerImage(file);
    const make = () => ({ id: lid(), type: 'sticker', kind: 'img', file, x: 0.5 + jitter(), y: 0.5 + jitter(), s: 0.3, rot: (Math.random() - 0.5) * 0.3, ar: c.ok ? c.img.naturalHeight / c.img.naturalWidth : 1 });
    if (c.ok) addLayer(make()); else c.p.then(() => addLayer(make()));
  }
  function addText() {
    const l = { id: lid(), type: 'text', text: '', x: 0.5, y: 0.45, s: 0.085, rot: 0, font: 'Sniglet', color: '#FFFFFF', style: 'bubble', align: 'center' };
    const last = [...m.layers].reverse().find((x) => x.type === 'text');
    if (last) { l.font = last.font; l.color = last.color; l.style = last.style; }
    m.layers.push(l);
    selected = l.id;
    openTextEditor(l, true);
  }
  function deleteSelected() {
    const l = selLayer();
    if (!l) return;
    m.layers = m.layers.filter((x) => x !== l);
    selected = null;
    commit(); syncSel(); markDirty();
  }
  function moveSelected(dir) {
    const l = selLayer(); if (!l) return;
    const i = m.layers.indexOf(l), j = clamp(i + dir, 0, m.layers.length - 1);
    if (i === j) return;
    m.layers.splice(i, 1); m.layers.splice(j, 0, l);
    commit(); markDirty();
    toast(dir > 0 ? 'Brought forward' : 'Sent back', { duration: 1200 });
  }
  function duplicateSelected() {
    const l = selLayer(); if (!l) return;
    const c = { ...JSON.parse(JSON.stringify(l)), id: lid(), x: clamp(l.x + 0.05, 0, 1), y: clamp(l.y + 0.05, 0, 1) };
    m.layers.splice(m.layers.indexOf(l) + 1, 0, c);
    selected = c.id;
    commit(); syncSel(); markDirty();
  }

  function syncSel() {
    const l = selLayer();
    const show = !!l && tab !== 'draw' && tab !== 'crop' && !editingText;
    $('#ed-selbar', root).hidden = !show;
    $('#ed-sel-edit', root).hidden = !(l && l.type === 'text');
    updateHint();
    markDirty();
  }
  function updateHint() {
    const h = $('#ed-hint', root);
    let t = '';
    if (tab === 'draw') t = drawTool === 'eraser' ? 'Rub out any drawing 🧽' : 'Draw right on your photo ✍️';
    else if (tab === 'crop') t = 'Drag to move the photo · pinch or scroll to zoom';
    else if (selLayer()) t = isPhone() ? 'Pinch to resize & turn · drag to the bin to delete' : 'Drag the ◐ handle to resize & turn (Shift: no turning)';
    else if (m.layers.length <= 1) t = 'Add stickers or words, then drag them around ♡';
    h.textContent = t;
    h.hidden = !t;
  }

  // ---------- text editor ----------
  function openTextEditor(l, isNew = false) {
    editingText = { layer: l, isNew, before: JSON.stringify(l) };
    const box = $('#ed-textbox', root);
    box.hidden = false;
    const input = $('#ed-text-input', root);
    input.value = l.text;
    $('#ed-text-size', root).value = String(Math.round(l.s * 200) / 2);
    syncTextBox();
    syncSel();
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }
  function syncTextBox() {
    if (!editingText) return;
    const l = editingText.layer;
    const f = fontOf(l.font);
    const input = $('#ed-text-input', root);
    input.style.fontFamily = `'${f.id}', Nunito, sans-serif`;
    input.style.fontWeight = f.weight;
    input.style.textAlign = l.align;
    input.style.color = l.style === 'bubble' ? '' : l.color;
    input.style.setProperty('--bubble', l.style === 'bubble' ? l.color : 'transparent');
    root.querySelectorAll('[data-font]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.font === l.font));
    root.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === l.style));
    root.querySelectorAll('[data-align]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.align === l.align));
    root.querySelectorAll('[data-color]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.color === l.color));
    markDirty();
  }
  function closeTextEditor() {
    if (!editingText) return;
    const l = editingText.layer;
    editingText = null;
    $('#ed-textbox', root).hidden = true;
    l.text = l.text.replace(/\s+$/, '');
    if (!l.text.trim()) { m.layers = m.layers.filter((x) => x !== l); selected = null; }
    commit();
    syncSel(); markDirty();
  }
  $('#ed-text-input', root).addEventListener('input', (e) => { if (editingText) { editingText.layer.text = e.target.value; markDirty(); } });
  $('#ed-text-input', root).addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTextEditor(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeTextEditor(); }
  });
  $('#ed-textbox', root).addEventListener('click', (e) => {
    if (!editingText) return;
    const l = editingText.layer;
    const b = e.target.closest('button');
    if (e.target.id === 'ed-textbox') return closeTextEditor();
    if (!b) return;
    if (b.dataset.font) l.font = b.dataset.font;
    else if (b.dataset.style) l.style = b.dataset.style;
    else if (b.dataset.align) l.align = b.dataset.align;
    else if (b.dataset.color) l.color = b.dataset.color;
    else if (b.id === 'ed-text-done') return closeTextEditor();
    syncTextBox();
  });
  $('#ed-text-size', root).addEventListener('input', (e) => { if (editingText) { editingText.layer.s = +e.target.value / 100; markDirty(); } });

  // ---------- panels ----------
  function setTab(t) {
    tab = t;
    root.querySelectorAll('.ed-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    root.classList.toggle('ed-drawing', t === 'draw');
    root.classList.toggle('ed-cropping', t === 'crop');
    renderPane();
    syncSel();
  }
  $('#ed-tabs', root).addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { if (b.dataset.tab === 'text' && tab === 'text') addText(); else setTab(b.dataset.tab); } });

  let stickerCat = null;
  let filterThumbs = null;
  function renderPane() {
    const pane = $('#ed-pane', root);
    const scrollKeep = pane.scrollTop;
    if (tab === 'stickers') {
      pane.innerHTML = `<div class="ed-cats" id="ed-cats" role="group" aria-label="Sticker groups"></div><div class="ed-stickers" id="ed-stickers"></div>`;
      loadManifest().then((groups) => {
        if (tab !== 'stickers') return;
        const cats = [...groups.map((gr) => ({ name: gr.name, img: gr.items })), ...STICKER_EMOJIS.map((gr) => ({ name: gr.name, emoji: gr.list }))];
        if (!stickerCat || !cats.some((c) => c.name === stickerCat)) stickerCat = cats[0] && cats[0].name;
        $('#ed-cats', root).innerHTML = cats.map((c, i) => `<button type="button" class="ed-chip" id="ed-cat-${i}" data-cat="${esc(c.name)}" aria-pressed="${c.name === stickerCat}">${c.img ? '🎨 ' : ''}${esc(c.name)}</button>`).join('');
        const cur = cats.find((c) => c.name === stickerCat);
        const grid = $('#ed-stickers', root);
        if (!cur) { grid.innerHTML = ''; return; }
        grid.classList.toggle('imgs', !!cur.img);
        grid.innerHTML = cur.img
          ? cur.img.map((s, i) => `<button type="button" class="ed-stk img" id="ed-stk-img-${i}" data-file="${esc(s.file)}" aria-label="Add ${esc(s.name)} sticker" title="${esc(s.name)}"><img src="img/stickers/${esc(encodeURIComponent(s.file))}" alt="" loading="lazy" decoding="async"></button>`).join('')
          : cur.emoji.map((e, i) => `<button type="button" class="ed-stk" id="ed-stk-e-${i}" data-e="${esc(e)}" aria-label="Add ${esc(e)} sticker">${esc(e)}</button>`).join('');
      });
    } else if (tab === 'text') {
      pane.innerHTML = `<div class="ed-pane-center">
        <button type="button" class="btn" id="ed-add-text">＋ Add words</button>
        <p class="ed-note">Double-tap words on the photo to change them. Pick fonts, colours and bubble styles ✨</p>
        <div class="ed-font-preview">${FONTS.map((f) => `<span style="font-family:'${esc(f.id)}';font-weight:${f.weight}">${esc(f.label)}</span>`).join('')}</div></div>`;
    } else if (tab === 'draw') {
      pane.innerHTML = `
        <div class="ed-row" role="group" aria-label="Brush">${TOOLS.map((t) => `<button type="button" class="ed-chip" id="ed-tool-${t.id}" data-tool="${t.id}" aria-pressed="${t.id === drawTool}">${t.emoji} ${t.label}</button>`).join('')}</div>
        <div class="ed-row" role="group" aria-label="Brush size">${SIZES.map((s, i) => `<button type="button" class="ed-size" id="ed-size-${i}" data-size="${s}" aria-pressed="${s === drawSize}" aria-label="Size ${i + 1}"><i style="width:${6 + i * 5}px;height:${6 + i * 5}px"></i></button>`).join('')}</div>
        <div class="ed-row ed-colors" role="group" aria-label="Brush colour">${COLORS.map((c, i) => `<button type="button" class="ed-color" id="ed-dcolor-${i}" data-dcolor="${c}" style="--c:${c}" aria-pressed="${c === drawColor}" aria-label="Colour ${c}"></button>`).join('')}</div>
        <div class="ed-row"><button type="button" class="btn small soft" id="ed-clear-draw">Clear drawing</button></div>`;
    } else if (tab === 'filters') {
      pane.innerHTML = `<div class="ed-filters" role="group" aria-label="Filters">${FILTERS.map((f) => `<button type="button" class="ed-filter" id="ed-filter-${f.id}" data-filter="${f.id}" aria-pressed="${m.filter === f.id}"><canvas width="72" height="72" aria-hidden="true"></canvas><span>${esc(f.label)}</span></button>`).join('')}</div>`;
      drawFilterThumbs(pane);
    } else if (tab === 'adjust') {
      pane.innerHTML = `${[['brightness', '☀️ Brightness'], ['contrast', '◐ Contrast'], ['saturation', '🌈 Saturation'], ['warmth', '🔥 Warmth']].map(([k, l]) => `
        <div class="ed-slider"><label for="ed-adj-${k}">${l}</label><input type="range" id="ed-adj-${k}" data-adj="${k}" min="-100" max="100" step="1" value="${m.adjust[k] || 0}"><output id="ed-adj-${k}-out" for="ed-adj-${k}">${m.adjust[k] || 0}</output></div>`).join('')}
        <div class="ed-row"><button type="button" class="btn small soft" id="ed-adj-reset">Reset</button></div>`;
    } else if (tab === 'crop') {
      pane.innerHTML = `<div class="ed-row" role="group" aria-label="Shape">${ASPECTS.map((a) => `<button type="button" class="ed-chip" id="ed-aspect-${a.id.replace(':', '-')}" data-aspect="${a.id}" aria-pressed="${m.crop.aspect === a.id}">${esc(a.label)}</button>`).join('')}</div>
        <div class="ed-slider"><label for="ed-zoom">🔍 Zoom</label><input type="range" id="ed-zoom" min="1" max="4" step="0.01" value="${m.crop.zoom || 1}"></div>
        <div class="ed-row"><button type="button" class="btn small soft" id="ed-rotate">↻ Rotate 90°</button><button type="button" class="btn small ghost" id="ed-crop-reset">Reset</button></div>`;
    } else if (tab === 'frames') {
      pane.innerHTML = `<div class="ed-frames" role="group" aria-label="Frames">${FRAMES.map((f) => `<button type="button" class="ed-frame" id="ed-frame-${f.id}" data-frame="${f.id}" aria-pressed="${m.frame === f.id}"><canvas width="64" height="64" aria-hidden="true"></canvas><span>${esc(f.label)}</span></button>`).join('')}</div>`;
      pane.querySelectorAll('.ed-frame canvas').forEach((c) => frameThumb(c, c.parentElement.dataset.frame));
    }
    pane.scrollTop = scrollKeep;
  }

  function drawFilterThumbs(pane) {
    if (!prevSrc) return;
    if (!filterThumbs) {
      // a small centre crop to filter
      const s = Math.min(prevSrc.width, prevSrc.height);
      filterThumbs = document.createElement('canvas'); filterThumbs.width = filterThumbs.height = 144;
      filterThumbs.getContext('2d').drawImage(prevSrc, (prevSrc.width - s) / 2, (prevSrc.height - s) / 2, s, s, 0, 0, 144, 144);
    }
    pane.querySelectorAll('.ed-filter').forEach((b, i) => {
      const c = b.querySelector('canvas');
      c.width = c.height = 144;
      setTimeout(() => drawFiltered(c.getContext('2d'), filterThumbs, [0, 0, 144, 144], [0, 0, 144, 144], b.dataset.filter, DEFAULT_ADJUST), i * 16);
    });
  }
  function frameThumb(c, id) {
    const W = 128, H = 128;
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const pad = framePad(id);
    const pw = W / Math.max(1 + pad.l + pad.r, 1 + pad.t + pad.b) * 0.9;
    const fw = pw * (1 + pad.l + pad.r), fh = pw * (1 + pad.t + pad.b);
    x.translate((W - fw) / 2, (H - fh) / 2);
    const r = { x: pw * pad.l, y: pw * pad.t, w: pw, h: pw };
    drawFrameBack(x, id, fw, fh, r);
    const gr = x.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    gr.addColorStop(0, '#FFD2E2'); gr.addColorStop(1, '#FF8DB7');
    x.fillStyle = gr; x.fillRect(r.x, r.y, r.w, r.h);
    x.font = `${pw * 0.4}px serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(id === 'none' ? '🚫' : '♡', r.x + r.w / 2, r.y + r.h / 2);
    drawFrameFront(x, id, fw, fh, r);
  }

  const pane = $('#ed-pane', root);
  pane.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cat) { stickerCat = b.dataset.cat; renderPane(); return; }
    if (b.dataset.e) return addEmoji(b.dataset.e);
    if (b.dataset.file) return addImageSticker(b.dataset.file);
    if (b.id === 'ed-add-text') return addText();
    if (b.dataset.tool) { drawTool = b.dataset.tool; renderPane(); updateHint(); return; }
    if (b.dataset.size) { drawSize = +b.dataset.size; renderPane(); return; }
    if (b.dataset.dcolor) { drawColor = b.dataset.dcolor; if (drawTool === 'eraser') drawTool = 'pen'; renderPane(); return; }
    if (b.id === 'ed-clear-draw') {
      const dl = drawLayerOf();
      if (dl && dl.strokes.length) { dl.strokes = []; renderDrawCanvas(); commit(); toast('Drawing cleared', { undo: undo }); }
      return;
    }
    if (b.dataset.filter) { m.filter = b.dataset.filter; baseDirty = true; markDirty(); commit(); pane.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); return; }
    if (b.id === 'ed-adj-reset') { m.adjust = { ...DEFAULT_ADJUST }; baseDirty = true; markDirty(); commit(); renderPane(); return; }
    if (b.dataset.aspect) { m.crop.aspect = b.dataset.aspect; m.crop.cx = 0.5; m.crop.cy = 0.5; resize(); commit(); renderPane(); return; }
    if (b.id === 'ed-rotate') { m.rotate = (m.rotate + 90) % 360; buildSources(); filterThumbs = null; m.crop.cx = 0.5; m.crop.cy = 0.5; resize(); commit(); return; }
    if (b.id === 'ed-crop-reset') { m.crop = { aspect: 'original', cx: 0.5, cy: 0.5, zoom: 1 }; m.rotate = 0; buildSources(); filterThumbs = null; resize(); commit(); renderPane(); return; }
    if (b.dataset.frame) { m.frame = b.dataset.frame; resize(); commit(); pane.querySelectorAll('[data-frame]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); return; }
  });
  pane.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.adj) { m.adjust[t.dataset.adj] = +t.value; const o = $('#' + t.id + '-out', root); if (o) o.textContent = t.value; baseDirty = true; markDirty(); }
    if (t.id === 'ed-zoom') { m.crop.zoom = +t.value; clampCrop(m.crop, prevSrc.width, prevSrc.height, g.r); baseDirty = true; markDirty(); }
  });
  pane.addEventListener('change', (e) => { if (e.target.dataset.adj || e.target.id === 'ed-zoom') commit(); });

  // ---------- selection bar ----------
  $('#ed-selbar', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-sel]'); if (!b) return;
    const a = b.dataset.sel;
    if (a === 'edit') { const l = selLayer(); if (l && l.type === 'text') openTextEditor(l); }
    if (a === 'up') moveSelected(1);
    if (a === 'down') moveSelected(-1);
    if (a === 'dup') duplicateSelected();
    if (a === 'del') deleteSelected();
  });

  // ---------- pointer gestures ----------
  const pts = new Map();
  let gest = null;
  let lastTap = { id: null, t: 0 };
  const trash = $('#ed-trash', root);
  function overTrash(e) {
    if (trash.hidden) return false;
    const r = trash.getBoundingClientRect();
    return e.clientX > r.left - 20 && e.clientX < r.right + 20 && e.clientY > r.top - 20 && e.clientY < r.bottom + 20;
  }
  function twoFinger() {
    const [a, b] = [...pts.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!g || editingText) return;
    canvas.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    pts.set(e.pointerId, p);
    const { W, H } = g;
    if (pts.size === 2) {
      const tf = twoFinger();
      if (tab === 'crop') { gest = { type: 'pinchCrop', tf, zoom: m.crop.zoom || 1 }; return; }
      if (gest && gest.type === 'draw') { liveStroke = null; gest = null; markDirty(); }
      const l = (gest && gest.layer) || selLayer();
      if (l && l.type !== 'draw') { gest = { type: 'pinch', layer: l, tf, s: l.s, rot: l.rot || 0, x: l.x, y: l.y }; trash.hidden = true; }
      return;
    }
    if (pts.size > 2) return;
    if (tab === 'draw') {
      const dl = drawLayerOf();
      liveStroke = newStroke(drawTool, drawColor, drawSize, p.x / W, p.y / H);
      gest = { type: 'draw', dl };
      if (drawTool === 'eraser') renderStroke(drawCanvas.getContext('2d'), liveStroke, W, H);
      markDirty();
      return;
    }
    if (tab === 'crop') { gest = { type: 'pan', p, cx: m.crop.cx, cy: m.crop.cy }; return; }
    const s = selLayer();
    if (s && s.type !== 'draw') {
      const hp = handlePos(ctx, s, W, H);
      if (Math.hypot(p.x - hp.x, p.y - hp.y) < 22 * dpr() * (e.pointerType === 'touch' ? 1.4 : 1)) {
        const v = { x: p.x - s.x * W, y: p.y - s.y * H };
        gest = { type: 'handle', layer: s, d: Math.hypot(v.x, v.y), ang: Math.atan2(v.y, v.x), s: s.s, rot: s.rot || 0 };
        return;
      }
    }
    const hit = hitLayer(ctx, m.layers, p.x, p.y, W, H, e.pointerType === 'touch' ? 10 * dpr() : 2);
    if (hit) {
      const now = performance.now();
      if (e.pointerType === 'touch' && lastTap.id === hit.id && now - lastTap.t < 320 && hit.type === 'text') { lastTap = { id: null, t: 0 }; gest = null; openTextEditor(hit); return; }
      lastTap = { id: hit.id, t: now };
      selected = hit.id;
      gest = { type: 'move', layer: hit, p, x: hit.x, y: hit.y, moved: false };
      syncSel();
    } else {
      if (selected) { selected = null; syncSel(); }
      gest = null;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !gest || !g) return;
    const p = toCanvas(e);
    pts.set(e.pointerId, p);
    const { W, H } = g;
    if (gest.type === 'draw' && liveStroke) {
      const added = addPoint(liveStroke, p.x / W, p.y / H, 1.5 / Math.max(W, H));
      if (added && liveStroke.t === 'eraser') {
        const n = liveStroke.p.length;
        renderStroke(drawCanvas.getContext('2d'), { ...liveStroke, p: liveStroke.p.slice(Math.max(0, n - 6)) }, W, H);
      }
      if (added) markDirty();
    } else if (gest.type === 'move') {
      const l = gest.layer;
      const dx = p.x - gest.p.x, dy = p.y - gest.p.y;
      if (!gest.moved && Math.hypot(dx, dy) < 3 * dpr()) return;
      gest.moved = true;
      l.x = clamp(gest.x + dx / W, -0.2, 1.2);
      l.y = clamp(gest.y + dy / H, -0.2, 1.2);
      trash.hidden = false;
      trash.classList.toggle('hot', overTrash(e));
      markDirty();
    } else if (gest.type === 'pinch' && pts.size >= 2) {
      const tf = twoFinger(), l = gest.layer;
      l.s = clamp(gest.s * (tf.d / gest.tf.d), 0.015, 3);
      l.rot = gest.rot + (tf.ang - gest.tf.ang);
      l.x = gest.x + (tf.mx - gest.tf.mx) / W;
      l.y = gest.y + (tf.my - gest.tf.my) / H;
      markDirty();
    } else if (gest.type === 'handle') {
      const l = gest.layer;
      const v = { x: p.x - l.x * W, y: p.y - l.y * H };
      l.s = clamp(gest.s * (Math.hypot(v.x, v.y) / Math.max(1, gest.d)), 0.015, 3);
      if (!e.shiftKey) {
        let r = gest.rot + (Math.atan2(v.y, v.x) - gest.ang);
        const q = Math.PI / 4, near = Math.round(r / q) * q;
        if (Math.abs(r - near) < 0.05) r = near; // gentle snap to 45°
        l.rot = r;
      } else l.rot = gest.rot;
      markDirty();
    } else if (gest.type === 'pan') {
      const win = cropWindow(m.crop, prevSrc.width, prevSrc.height, g.r);
      m.crop.cx = gest.cx - ((p.x - gest.p.x) / win.scale) / prevSrc.width;
      m.crop.cy = gest.cy - ((p.y - gest.p.y) / win.scale) / prevSrc.height;
      clampCrop(m.crop, prevSrc.width, prevSrc.height, g.r);
      baseDirty = true; markDirty();
    } else if (gest.type === 'pinchCrop' && pts.size >= 2) {
      const tf = twoFinger();
      m.crop.zoom = clamp(gest.zoom * (tf.d / gest.tf.d), 1, 4);
      clampCrop(m.crop, prevSrc.width, prevSrc.height, g.r);
      const z = $('#ed-zoom', root); if (z) z.value = m.crop.zoom;
      baseDirty = true; markDirty();
    }
  });

  function endPointer(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!gest) return;
    if (gest.type === 'draw') {
      if (liveStroke) {
        const dl = gest.dl;
        dl.strokes.push(liveStroke);
        if (liveStroke.t !== 'eraser') renderStroke(drawCanvas.getContext('2d'), liveStroke, g.W, g.H);
        liveStroke = null;
        commit(); markDirty();
      }
      gest = null;
      return;
    }
    if (gest.type === 'move') {
      const hot = overTrash(e) && gest.moved;
      trash.hidden = true; trash.classList.remove('hot');
      if (hot) { deleteSelected(); toast('Removed', { emoji: '🗑️', undo }); }
      else if (gest.moved) commit();
      gest = null;
      return;
    }
    if (gest.type === 'pinch' || gest.type === 'pinchCrop') {
      if (pts.size === 0) { commit(); gest = null; }
      else if (gest.type === 'pinch') { // one finger left: keep dragging it
        const [id, p] = [...pts.entries()][0];
        void id;
        const l = gest.layer;
        commit();
        gest = { type: 'move', layer: l, p, x: l.x, y: l.y, moved: true };
      } else gest = null;
      return;
    }
    commit();
    gest = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);

  canvas.addEventListener('dblclick', (e) => {
    if (!g || tab === 'draw' || tab === 'crop') return;
    const p = toCanvas(e);
    const hit = hitLayer(ctx, m.layers, p.x, p.y, g.W, g.H, 2);
    if (hit && hit.type === 'text') openTextEditor(hit);
    else if (!hit && tab === 'text') addText();
  });

  let wheelCommit = 0;
  canvas.addEventListener('wheel', (e) => {
    if (!g) return;
    const k = Math.exp(-e.deltaY * 0.0015);
    if (tab === 'crop') {
      e.preventDefault();
      m.crop.zoom = clamp((m.crop.zoom || 1) * k, 1, 4);
      clampCrop(m.crop, prevSrc.width, prevSrc.height, g.r);
      const z = $('#ed-zoom', root); if (z) z.value = m.crop.zoom;
      baseDirty = true; markDirty();
    } else {
      const l = selLayer();
      if (!l || l.type === 'draw') return;
      e.preventDefault();
      if (e.altKey) l.rot = (l.rot || 0) + e.deltaY * 0.004;
      else l.s = clamp(l.s * k, 0.015, 3);
      markDirty();
    }
    clearTimeout(wheelCommit);
    wheelCommit = setTimeout(commit, 300);
  }, { passive: false });

  // ---------- keyboard ----------
  function onKey(e) {
    if (destroyed) return;
    const typing = e.target.closest && e.target.closest('input,textarea,select');
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { if (typing) return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { if (typing) return; e.preventDefault(); redo(); return; }
    if (typing) return;
    const l = selLayer();
    if ((e.key === 'Delete' || e.key === 'Backspace') && l) { e.preventDefault(); deleteSelected(); return; }
    if (mod && e.key.toLowerCase() === 'd' && l) { e.preventDefault(); duplicateSelected(); return; }
    if (e.key === 'Enter' && l && l.type === 'text' && e.target === canvas) { e.preventDefault(); openTextEditor(l); return; }
    if (l && e.key.startsWith('Arrow') && e.target === canvas) {
      e.preventDefault();
      const st = e.shiftKey ? 0.03 : 0.005;
      if (e.key === 'ArrowLeft') l.x -= st; if (e.key === 'ArrowRight') l.x += st;
      if (e.key === 'ArrowUp') l.y -= st; if (e.key === 'ArrowDown') l.y += st;
      markDirty(); clearTimeout(wheelCommit); wheelCommit = setTimeout(commit, 400);
      return;
    }
  }
  root.addEventListener('keydown', onKey);
  root.addEventListener('keydown', (e) => {
    // Escape: close text box / deselect before the dialog's own close
    if (e.key !== 'Escape') return;
    if (editingText) { e.preventDefault(); e.stopPropagation(); closeTextEditor(); }
    else if (selected) { e.preventDefault(); e.stopPropagation(); selected = null; syncSel(); }
  }, true);

  // ---------- top bar ----------
  $('#ed-undo', root).onclick = undo;
  $('#ed-redo', root).onclick = redo;
  $('#ed-cancel', root).onclick = () => api.onCancel && api.onCancel();
  $('#ed-save', root).onclick = async () => {
    if (!img) return;
    if (editingText) closeTextEditor();
    const btn = $('#ed-save', root);
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const out = compact(JSON.parse(snap()));
      out.base = { assetId: (post && post.assetId) || (model && model.base && model.base.assetId) || null };
      if (collage) out.base.assetId = null;
      const r = await flatten(img, out, MAX_SIDE);
      api.onSave && api.onSave({ ...r, edit: out });
    } catch (e) {
      console.error(e);
      toast('Couldn’t make the picture. Try again?');
      btn.disabled = false; btn.textContent = 'Save ♡';
    }
  };

  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);

  function cleanup() {
    destroyed = true;
    ro.disconnect();
    cancelAnimationFrame(raf);
    setImageLoadHandler(() => {});
  }
  return api;
}
