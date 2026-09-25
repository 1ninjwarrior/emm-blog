// Em&m Blog: collage maker (full-screen).
//
//   openCollage({boardId, post})   make a new collage post, or re-edit a collage post
//   renderCollageBase(edit)        -> object URL of the undecorated collage (used by the story editor)
//
// Saved on the post (kind 'collage'):
//   edit = {type:'collage', v:1, template, aspect:'1:1'|'4:5'|'9:16', spacing (0..40, per-mille of the
//           short side), radius (0..80, per-mille), bg, cells:[{assetId, x, y, zoom}], story: <story edit|null>}
//   renderedId / rw / rh = the flattened, decorated image the grid shows.
// Cell x/y = centre of the visible window as fractions of the photo; zoom >= 1.
import { $, esc, fullscreen, confirmDlg, toast, confetti, loadImage, clamp, isPhone, reducedMotion } from '../ui.js';
import { blobSrc, deleteAsset } from '../store.js';
import { uploadPhoto, saveRender, errText } from '../posts.js';
import { heartPath } from '../ui.js';
import { openStoryEditor, renderStory } from './editor.js';
import { roundRectPath } from './layers.js';

const MAX = 9;
export const ASPECTS = [
  { id: '1:1', label: '1:1', ar: 1 },
  { id: '4:5', label: '4:5', ar: 4 / 5 },
  { id: '9:16', label: '9:16', ar: 9 / 16 },
];
const arOf = (id) => (ASPECTS.find((a) => a.id === id) || ASPECTS[1]).ar;

const grid = (cols, rows) => {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([c / cols, r / rows, 1 / cols, 1 / rows]);
  return out;
};
/** Templates: cells are [x, y, w, h] fractions (plus rotation for scatter). */
export const TEMPLATES = [
  { id: 'grid2', label: '2 grid', cells: grid(2, 1) },
  { id: 'grid3', label: '3 stack', cells: grid(1, 3) },
  { id: 'grid4', label: '4 grid', cells: grid(2, 2) },
  { id: 'grid6', label: '6 grid', cells: grid(2, 3) },
  { id: 'grid9', label: '9 grid', cells: grid(3, 3) },
  { id: 'big2', label: '1 big + 2', cells: [[0, 0, 0.62, 1], [0.62, 0, 0.38, 0.5], [0.62, 0.5, 0.38, 0.5]] },
  { id: 'big3', label: '1 big + 3', cells: [[0, 0, 1, 0.64], [0, 0.64, 1 / 3, 0.36], [1 / 3, 0.64, 1 / 3, 0.36], [2 / 3, 0.64, 1 / 3, 0.36]] },
  { id: 'strip', label: 'Photo strip', special: true, cells: [0, 1, 2, 3].map((i) => [0.14, 0.04 + i * 0.215, 0.72, 0.195]) },
  { id: 'film', label: 'Film strip', special: true, cells: [0, 1, 2].map((i) => [0.17, 0.045 + i * 0.315, 0.66, 0.28]) },
  { id: 'scatter', label: 'Polaroids', special: true, cells: [[0.06, 0.05, 0.5, 0.42, -0.12], [0.46, 0.08, 0.5, 0.42, 0.1], [0.07, 0.5, 0.5, 0.42, 0.08], [0.45, 0.52, 0.5, 0.42, -0.07]] },
  { id: 'heart', label: 'Heart', special: true, cells: grid(2, 2) },
  { id: 'magazine', label: 'Magazine', special: true, cells: [[0, 0.17, 1, 0.52], [0, 0.69, 0.5, 0.31], [0.5, 0.69, 0.5, 0.31]] },
];
const tplOf = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[2];
function autoTemplate(n) { return n <= 2 ? 'grid2' : n === 3 ? 'big2' : n === 4 ? 'grid4' : n <= 6 ? 'grid6' : 'grid9'; }

export const BACKGROUNDS = [
  { id: 'white', label: 'White', fill: '#FFFFFF' },
  { id: 'blush', label: 'Blush', fill: '#FFE6EF' },
  { id: 'pink', label: 'Pink', fill: '#FF9EC2' },
  { id: 'cream', label: 'Cream', fill: '#FFF6E6' },
  { id: 'sage', label: 'Sage', fill: '#DDEBD6' },
  { id: 'lavender', label: 'Lavender', fill: '#E6DCF6' },
  { id: 'blue', label: 'Baby blue', fill: '#D7E9F8' },
  { id: 'plum', label: 'Plum', fill: '#3B2331' },
  { id: 'gingham', label: 'Gingham', swatch: 'repeating-linear-gradient(0deg,rgba(255,142,183,.45) 0 6px,transparent 6px 12px),repeating-linear-gradient(90deg,rgba(255,142,183,.45) 0 6px,#fff 6px 12px)' },
  { id: 'dots', label: 'Polka dots', swatch: 'radial-gradient(circle,#FF9EC2 28%,transparent 31%) 0 0/10px 10px,#fff' },
  { id: 'gradient', label: 'Dreamy', swatch: 'linear-gradient(135deg,#FFD6E7,#E6DCF6 55%,#D7E9F8)' },
  { id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(160deg,#FFE3B8,#FFB8C8 60%,#F29AC0)' },
];

function drawBackground(ctx, bg, W, H) {
  const b = BACKGROUNDS.find((x) => x.id === bg) || BACKGROUNDS[0];
  const u = Math.min(W, H);
  if (b.fill) { ctx.fillStyle = b.fill; ctx.fillRect(0, 0, W, H); return; }
  if (bg === 'gingham') {
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    const s = u * 0.035;
    ctx.fillStyle = 'rgba(255,142,183,.42)';
    for (let y = 0; y < H; y += s * 2) ctx.fillRect(0, y, W, s);
    for (let x = 0; x < W; x += s * 2) ctx.fillRect(x, 0, s, H);
  } else if (bg === 'dots') {
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    const st = u * 0.05;
    ctx.fillStyle = '#FF9EC2';
    for (let y = st / 2, r = 0; y < H + st; y += st, r++) for (let x = r % 2 ? st / 2 : 0; x < W + st; x += st) { ctx.beginPath(); ctx.arc(x, y, u * 0.011, 0, 6.283); ctx.fill(); }
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    if (bg === 'sunset') { g.addColorStop(0, '#FFE3B8'); g.addColorStop(0.6, '#FFB8C8'); g.addColorStop(1, '#F29AC0'); }
    else { g.addColorStop(0, '#FFD6E7'); g.addColorStop(0.55, '#E6DCF6'); g.addColorStop(1, '#D7E9F8'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

/** Pixel rects for the template's cells: [{x,y,w,h,rot,cx,cy}] */
function cellRects(model, W, H) {
  const t = tplOf(model.template);
  const u = Math.min(W, H);
  const sp = ((model.spacing ?? 14) / 1000) * u;
  return t.cells.map((c) => {
    let x = c[0] * W, y = c[1] * H, w = c[2] * W, h = c[3] * H;
    if (t.id === 'scatter') {
      // polaroid: photo is a square-ish window inside a white card; card is the rect
      return { x, y, w, h, rot: c[4] || 0 };
    }
    if (t.special && t.id !== 'magazine') { x += sp / 2; y += sp / 2; w -= sp; h -= sp; }
    else {
      const l = c[0] < 0.001 ? sp : sp / 2, r = c[0] + c[2] > 0.999 ? sp : sp / 2;
      const tp = c[1] < 0.001 ? sp : sp / 2, b = c[1] + c[3] > 0.999 ? sp : sp / 2;
      x += l; y += tp; w -= l + r; h -= tp + b;
    }
    return { x, y, w: Math.max(1, w), h: Math.max(1, h), rot: 0 };
  });
}
/** The photo window inside a rect (scatter cards have a white border + bottom lip). */
function photoRect(model, r) {
  if (model.template !== 'scatter') return r;
  const m = r.w * 0.06;
  return { x: r.x + m, y: r.y + m, w: r.w - m * 2, h: r.h - m * 2 - r.w * 0.12, rot: r.rot };
}

function drawCover(ctx, src, cell, r) {
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const scale = Math.max(r.w / sw, r.h / sh) * Math.max(1, cell.zoom || 1);
  const w = Math.min(sw, r.w / scale), h = Math.min(sh, r.h / scale);
  const x = clamp((cell.x ?? 0.5) * sw - w / 2, 0, sw - w), y = clamp((cell.y ?? 0.5) * sh - h / 2, 0, sh - h);
  ctx.drawImage(src, x, y, w, h, r.x, r.y, r.w, r.h);
}

/**
 * Draw the whole collage. images[i] = drawable for slot i (or null = empty placeholder).
 * ui = {selected, target, lifted} for on-screen chrome (omit when exporting).
 */
export function drawCollage(ctx, model, images, W, H, ui = null) {
  const t = tplOf(model.template);
  const u = Math.min(W, H);
  const rad = ((model.radius ?? 18) / 1000) * u;
  drawBackground(ctx, model.bg, W, H);
  const rects = cellRects(model, W, H);

  if (t.id === 'film') {
    ctx.fillStyle = '#1E1B1D';
    ctx.fillRect(W * 0.08, 0, W * 0.84, H);
    const hw = W * 0.045, hh = W * 0.03, gap = W * 0.035;
    ctx.fillStyle = '#F6EFE8';
    for (let y = gap; y + hh < H; y += hh + gap) for (const x of [W * 0.105, W * 0.895 - hw]) { roundRectPath(ctx, x, y, hw, hh, hh * 0.25); ctx.fill(); }
  }
  if (t.id === 'strip') {
    ctx.save();
    ctx.shadowColor = 'rgba(80,20,50,.18)'; ctx.shadowBlur = u * 0.03;
    ctx.fillStyle = '#FFFFFF';
    roundRectPath(ctx, W * 0.1, H * 0.015, W * 0.8, H * 0.97, u * 0.015); ctx.fill();
    ctx.restore();
  }
  if (t.id === 'magazine') {
    ctx.fillStyle = model.bg === 'plum' ? '#FFE3EE' : '#A3275A';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `400 ${H * 0.1}px "DM Serif Display", Georgia, serif`;
    ctx.fillText('Em & m', W / 2, H * 0.085);
    ctx.font = `700 ${H * 0.022}px "Nunito", sans-serif`;
    ctx.fillText('THE LOVE ISSUE  ♡  ' + new Date().getFullYear(), W / 2, H * 0.155);
  }

  ctx.save();
  if (t.id === 'heart') {
    const s = Math.min(W, H) * 1.02;
    heartPath(ctx, W / 2, H / 2 + s * 0.06, s);
    ctx.clip();
  }
  rects.forEach((r0, i) => {
    const img = images[i];
    const lifted = ui && ui.lifted === i;
    ctx.save();
    ctx.translate(r0.x + r0.w / 2, r0.y + r0.h / 2);
    if (r0.rot) ctx.rotate(r0.rot);
    ctx.translate(-(r0.x + r0.w / 2), -(r0.y + r0.h / 2));
    if (lifted) ctx.globalAlpha = 0.45;
    if (t.id === 'scatter') {
      ctx.save();
      ctx.shadowColor = 'rgba(60,20,40,.28)'; ctx.shadowBlur = u * 0.025; ctx.shadowOffsetY = u * 0.008;
      ctx.fillStyle = '#FFFDF9';
      ctx.fillRect(r0.x, r0.y, r0.w, r0.h);
      ctx.restore();
    }
    const r = photoRect(model, r0);
    ctx.save();
    roundRectPath(ctx, r.x, r.y, r.w, r.h, t.id === 'scatter' || t.id === 'film' ? Math.min(rad, u * 0.01) : rad);
    ctx.clip();
    if (img) drawCover(ctx, img, model.cells[i] || {}, r);
    else if (ui) {
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#D9437E'; ctx.globalAlpha = 0.7;
      ctx.font = `800 ${Math.min(r.w, r.h) * 0.28}px "Nunito", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+', r.x + r.w / 2, r.y + r.h / 2);
      ctx.globalAlpha = 1;
    } else { ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
    ctx.restore();
    if (ui && (ui.selected === i || ui.target === i)) {
      ctx.lineWidth = Math.max(3, u * 0.008);
      ctx.strokeStyle = ui.target === i ? '#FFD35C' : '#FFFFFF';
      ctx.setLineDash(ui.target === i ? [] : [u * 0.015, u * 0.01]);
      ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 4;
      roundRectPath(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, rad);
      ctx.stroke();
    }
    ctx.restore();
  });
  ctx.restore();

  if (t.id === 'heart') {
    const s = Math.min(W, H) * 1.02;
    ctx.save();
    heartPath(ctx, W / 2, H / 2 + s * 0.06, s);
    ctx.lineWidth = u * 0.012; ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
    ctx.restore();
  }
  if (t.id === 'strip') {
    ctx.fillStyle = '#D9437E';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${H * 0.028}px "Caveat", cursive`;
    const d = new Date();
    ctx.fillText(`em & m ♡ ${d.getMonth() + 1}.${d.getDate()}.${String(d.getFullYear()).slice(2)}`, W / 2, H * 0.94);
  }
  return rects;
}

/** Load drawable images for a saved collage edit. */
async function loadCellImages(edit) {
  return Promise.all((edit.cells || []).map((c) => (c && c.assetId ? loadImage(blobSrc(c.assetId)).catch(() => null) : null)));
}

function sizeFor(aspect, L) {
  const ar = arOf(aspect);
  return ar >= 1 ? { W: L, H: Math.round(L / ar) } : { W: Math.round(L * ar), H: L };
}

async function renderToBlob(model, images, L = 1440) {
  const { W, H } = sizeFor(model.aspect, L);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  drawCollage(ctx, model, images, W, H, null);
  const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.92));
  return { blob, width: W, height: H };
}

/** Object URL of the undecorated collage for a saved edit (caller revokes). */
export async function renderCollageBase(edit, L = 1440) {
  const images = await loadCellImages(edit);
  const { blob } = await renderToBlob(edit, images, L);
  return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function downscale(img, cap = 1200) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = Math.min(1, cap / Math.max(w, h));
  if (k === 1) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export async function openCollage({ boardId = null, post = null } = {}) {
  const editing = post && post.edit && post.edit.type === 'collage' ? post : null;
  const base = editing ? editing.edit : null;
  // photos: [{file?, url, assetId?, img (full), prev (display), x, y, zoom}]
  const photos = [];
  const model = {
    type: 'collage', v: 1,
    template: base ? base.template : 'grid4',
    aspect: base ? base.aspect : '4:5',
    spacing: base ? base.spacing ?? 14 : 14,
    radius: base ? base.radius ?? 18 : 18,
    bg: base ? base.bg || 'white' : 'white',
    cells: [],
    story: base ? base.story || null : null,
  };
  let templateChosen = !!base;
  let saved = false, changed = false;
  let decorated = null; // {blob, width, height, key} when the story render matches the current collage
  let selected = -1;
  let tab = 'photos';
  let caption = editing ? editing.text || '' : '';

  let forceClose = false;
  const layer = fullscreen({
    className: 'ed-dialog', label: 'Collage maker',
    beforeClose: () => {
      if (forceClose || saved || !changed) return true;
      confirmDlg({ title: 'Toss this collage?', message: 'Your layout won’t be saved.', confirmLabel: 'Toss it', cancelLabel: 'Keep going', emoji: '🥺', destructive: true })
        .then((ok) => { if (ok) { forceClose = true; layer.close('discard'); } });
      return false;
    },
    onClose: () => { destroyed = true; ro.disconnect(); photos.forEach((p) => p.file && URL.revokeObjectURL(p.url)); },
  });
  let destroyed = false;
  const root = layer.el;
  root.innerHTML = `
  <div class="ed cl" id="cl-root">
    <header class="ed-top">
      <button type="button" class="ed-ic" id="cl-cancel" aria-label="Close collage maker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <h2 class="ed-title">${editing ? 'Edit collage' : 'Collage'}</h2>
      <button type="button" class="btn small soft" id="cl-decorate">✨ Decorate</button>
      <button type="button" class="btn small ed-save" id="cl-save">${editing ? 'Save ♡' : 'Pin it ♡'}</button>
    </header>
    <div class="ed-main">
      <div class="ed-stage" id="cl-stage">
        <canvas id="cl-canvas" class="ed-canvas" tabindex="0" aria-label="Collage. Drag a photo to move it inside its box, press and hold to swap boxes."></canvas>
        <div class="ed-selbar" id="cl-cellbar" hidden>
          <button type="button" class="ed-chip" id="cl-cell-replace" data-cell="replace">🔁 Replace</button>
          <button type="button" class="ed-chip" id="cl-cell-fit" data-cell="fit">🔍 Reset zoom</button>
          <button type="button" class="ed-chip danger" id="cl-cell-remove" data-cell="remove">🗑️ Remove</button>
        </div>
        <div class="cl-ghost" id="cl-ghost" hidden aria-hidden="true"></div>
        <p class="ed-hint" id="cl-hint" aria-live="polite"></p>
        <div class="cl-badge" id="cl-badge" hidden>✨ decorated <button type="button" id="cl-undecorate" aria-label="Remove decorations">×</button></div>
        <div class="ed-loading" id="cl-loading" hidden><span class="ed-spin" aria-hidden="true">🌸</span><span id="cl-loading-msg">loading…</span></div>
      </div>
      <aside class="ed-panel" aria-label="Collage tools">
        <div class="ed-tabs" role="tablist" id="cl-tabs">
          ${[['photos', '📷', 'Photos'], ['layout', '🧩', 'Layout'], ['style', '🎨', 'Style']].map(([id, e, l]) => `<button type="button" role="tab" class="ed-tab" id="cl-tab-${id}" data-tab="${id}" aria-selected="${id === tab}" aria-controls="cl-pane"><span class="e" aria-hidden="true">${e}</span>${l}</button>`).join('')}
        </div>
        <div class="ed-pane" id="cl-pane" role="tabpanel"></div>
      </aside>
    </div>
    <input type="file" id="cl-file" accept="image/*" multiple hidden>
    <input type="file" id="cl-file-one" accept="image/*" hidden>
  </div>`;

  const canvas = $('#cl-canvas', root);
  const ctx = canvas.getContext('2d');
  const stage = $('#cl-stage', root);
  const fileAll = $('#cl-file', root), fileOne = $('#cl-file-one', root);
  let replaceSlot = -1;
  let W = 0, H = 0, raf = 0, dirty = true, rects = [];
  let ui = { selected: -1, target: -1, lifted: -1 };
  const dpr = () => Math.min(2.5, window.devicePixelRatio || 1);

  const tpl = () => tplOf(model.template);
  const slotCount = () => tpl().cells.length;
  const images = () => Array.from({ length: slotCount() }, (_, i) => (photos[i] ? photos[i].prev : null));
  const collageKey = () => JSON.stringify([model.template, model.aspect, model.spacing, model.radius, model.bg, photos.slice(0, slotCount()).map((p) => [p.url, p.x, p.y, p.zoom])]);

  function markDirty() { dirty = true; if (!raf && !destroyed) raf = requestAnimationFrame(draw); }
  function touched() { changed = true; if (decorated && decorated.key !== collageKey()) decorated = null; }

  function resize() {
    const box = stage.getBoundingClientRect();
    const padX = isPhone() ? 16 : 36, padY = isPhone() ? 60 : 76;
    const bw = Math.max(80, box.width - padX * 2), bh = Math.max(80, box.height - padY * 2);
    const ar = arOf(model.aspect);
    const cw = Math.min(bw, bh * ar), ch = cw / ar;
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    const s = sizeFor(model.aspect, Math.round(Math.max(cw, ch) * dpr()));
    W = s.W; H = s.H;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    markDirty();
  }
  function draw() {
    raf = 0;
    if (!dirty || destroyed || !W) return;
    dirty = false;
    ctx.clearRect(0, 0, W, H);
    rects = drawCollage(ctx, { ...model, cells: photos.slice(0, slotCount()).map((p) => p && { x: p.x, y: p.y, zoom: p.zoom }) }, images(), W, H, ui);
  }

  function syncUI() {
    ui.selected = selected;
    $('#cl-cellbar', root).hidden = !(selected >= 0 && photos[selected]);
    const h = $('#cl-hint', root);
    const n = Math.min(photos.length, slotCount());
    h.textContent = !photos.length ? 'Add 2 to 9 photos to start ♡'
      : n < slotCount() ? `Tap a + box to fill it (${n}/${slotCount()})`
        : isPhone() ? 'Drag to move a photo · pinch to zoom · hold to swap' : 'Drag to move · scroll to zoom · hold (or Alt-drag) to swap';
    $('#cl-badge', root).hidden = !model.story;
    $('#cl-save', root).disabled = photos.length < 1;
    $('#cl-decorate', root).disabled = photos.length < 1;
    markDirty();
  }

  // ---------- photos ----------
  async function addFiles(files, slot = -1) {
    const room = MAX - photos.length + (slot >= 0 && photos[slot] ? 1 : 0);
    const list = files.filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    if (files.length > list.length) toast(`Up to ${MAX} photos per collage ♡`);
    if (!list.length) return;
    const loading = $('#cl-loading', root);
    loading.hidden = false; $('#cl-loading-msg', root).textContent = 'adding photos…';
    for (const f of list) {
      const url = URL.createObjectURL(f);
      try {
        const img = await loadImage(url);
        const p = { file: f, url, assetId: null, img, prev: downscale(img), x: 0.5, y: 0.5, zoom: 1 };
        if (slot >= 0 && slot < photos.length) {
          const old = photos[slot];
          if (old.file) URL.revokeObjectURL(old.url);
          photos[slot] = p;
          slot = -1;
        } else if (slot >= 0) { photos.push(p); slot = -1; } else photos.push(p);
      } catch (e) { URL.revokeObjectURL(url); toast('One photo couldn’t be opened'); }
    }
    loading.hidden = true;
    if (!templateChosen) model.template = autoTemplate(photos.length);
    touched(); renderPane(); syncUI();
  }
  fileAll.addEventListener('change', () => { const f = [...fileAll.files]; fileAll.value = ''; addFiles(f); });
  fileOne.addEventListener('change', () => { const f = [...fileOne.files]; fileOne.value = ''; if (f.length) addFiles(f, replaceSlot); });
  function pickFor(slot) { replaceSlot = slot; fileOne.click(); }
  function removePhoto(i) {
    const p = photos[i]; if (!p) return;
    photos.splice(i, 1);
    if (p.file) URL.revokeObjectURL(p.url);
    selected = -1;
    if (!templateChosen && photos.length) model.template = autoTemplate(photos.length);
    touched(); renderPane(); syncUI();
  }
  // drop anywhere on the editor
  root.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('over'); });
  root.addEventListener('dragleave', (e) => { if (e.target === stage || !root.contains(e.relatedTarget)) stage.classList.remove('over'); });
  root.addEventListener('drop', (e) => {
    e.preventDefault(); stage.classList.remove('over');
    const files = [...(e.dataTransfer && e.dataTransfer.files || [])];
    if (!files.length) return;
    let slot = -1;
    if (e.target === canvas && rects.length) { const p = toCanvas(e); slot = hitCell(p.x, p.y); if (slot >= photos.length) slot = photos.length; }
    addFiles(files, files.length === 1 ? slot : -1);
  });

  // ---------- panes ----------
  function renderPane() {
    const pane = $('#cl-pane', root);
    if (tab === 'photos') {
      pane.innerHTML = `
        <label class="cl-drop" for="cl-file" id="cl-drop"><span class="e" aria-hidden="true">📷</span><strong>${photos.length ? 'Add more photos' : 'Choose photos'}</strong><small>or drag them here · 2 to 9 photos</small></label>
        <div class="cl-thumbs" id="cl-thumbs">${photos.map((p, i) => `<div class="cl-thumb${i >= slotCount() ? ' unused' : ''}"><img src="${esc(p.url)}" alt="Photo ${i + 1}"><span class="n">${i + 1}</span><button type="button" id="cl-rm-${i}" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join('')}</div>
        ${photos.length > slotCount() ? `<p class="ed-note">This layout shows ${slotCount()} photos. Pick a bigger layout to use them all.</p>` : ''}
        <div class="field"><label class="lbl" for="cl-caption">Caption (optional)</label>
        <textarea class="txt" id="cl-caption" rows="2" maxlength="600" placeholder="what's the story here?">${esc(caption)}</textarea></div>`;
    } else if (tab === 'layout') {
      pane.innerHTML = `
        <div class="ed-row" role="group" aria-label="Shape">${ASPECTS.map((a) => `<button type="button" class="ed-chip" id="cl-aspect-${a.id.replace(':', '-')}" data-aspect="${a.id}" aria-pressed="${model.aspect === a.id}">${a.label}</button>`).join('')}</div>
        <div class="cl-templates" role="group" aria-label="Layouts">${TEMPLATES.map((t) => `<button type="button" class="cl-tpl" id="cl-tpl-${t.id}" data-tpl="${t.id}" aria-pressed="${model.template === t.id}">
          <span class="cl-mini${t.id === 'heart' ? ' heart' : ''}${t.id === 'film' ? ' film' : ''}" aria-hidden="true">${t.cells.map((c) => `<i style="left:${c[0] * 100}%;top:${c[1] * 100}%;width:${c[2] * 100}%;height:${c[3] * 100}%;${c[4] ? `transform:rotate(${c[4]}rad)` : ''}"></i>`).join('')}</span>
          <span>${esc(t.label)}</span><small>${t.cells.length}</small></button>`).join('')}</div>`;
    } else {
      pane.innerHTML = `
        <div class="ed-slider"><label for="cl-spacing">↔ Spacing</label><input type="range" id="cl-spacing" min="0" max="40" step="1" value="${model.spacing}"></div>
        <div class="ed-slider"><label for="cl-radius">◜ Corners</label><input type="range" id="cl-radius" min="0" max="80" step="1" value="${model.radius}"></div>
        <p class="lbl">Background</p>
        <div class="cl-bgs" role="group" aria-label="Background">${BACKGROUNDS.map((b) => `<button type="button" class="cl-bg" id="cl-bg-${b.id}" data-bg="${b.id}" aria-pressed="${model.bg === b.id}" aria-label="${esc(b.label)}" title="${esc(b.label)}" style="background:${b.swatch || b.fill}"></button>`).join('')}</div>`;
    }
  }
  $('#cl-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    tab = b.dataset.tab;
    root.querySelectorAll('#cl-tabs .ed-tab').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderPane();
  });
  const pane = $('#cl-pane', root);
  pane.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rm) return removePhoto(+b.dataset.rm);
    if (b.dataset.aspect) { model.aspect = b.dataset.aspect; touched(); resize(); renderPane(); return; }
    if (b.dataset.tpl) { model.template = b.dataset.tpl; templateChosen = true; selected = -1; touched(); renderPane(); syncUI(); return; }
    if (b.dataset.bg) { model.bg = b.dataset.bg; touched(); pane.querySelectorAll('[data-bg]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); markDirty(); }
  });
  pane.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cl-spacing') { model.spacing = +t.value; touched(); markDirty(); }
    if (t.id === 'cl-radius') { model.radius = +t.value; touched(); markDirty(); }
    if (t.id === 'cl-caption') { caption = t.value; changed = true; }
  });

  // ---------- canvas gestures ----------
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  function hitCell(x, y) {
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const c = Math.cos(-(r.rot || 0)), s = Math.sin(-(r.rot || 0));
      const lx = (x - cx) * c - (y - cy) * s, ly = (x - cx) * s + (y - cy) * c;
      if (Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.h / 2) return i;
    }
    return -1;
  }
  const pts = new Map();
  let gest = null, holdT = 0;
  const ghost = $('#cl-ghost', root);
  function startSwap(e) {
    if (!gest || gest.type !== 'pan') return;
    gest = { type: 'swap', from: gest.i };
    ui.lifted = gest.from;
    const p = photos[gest.from];
    ghost.style.backgroundImage = `url("${p.url}")`;
    ghost.hidden = false;
    moveGhost(e);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) { /* ignore */ }
    markDirty();
  }
  function moveGhost(e) {
    const r = stage.getBoundingClientRect();
    ghost.style.transform = `translate(${e.clientX - r.left - 36}px, ${e.clientY - r.top - 36}px) rotate(-4deg)`;
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    pts.set(e.pointerId, p);
    if (pts.size === 2 && gest && (gest.type === 'pan')) {
      clearTimeout(holdT);
      const [a, b] = [...pts.values()];
      const i = gest.i;
      gest = { type: 'pinch', i, d: Math.hypot(b.x - a.x, b.y - a.y), zoom: photos[i].zoom };
      return;
    }
    if (pts.size > 1) return;
    const i = hitCell(p.x, p.y);
    if (i < 0) { selected = -1; syncUI(); gest = null; return; }
    if (!photos[i]) { gest = null; pickFor(i); return; }
    gest = { type: 'pan', i, p, x: photos[i].x, y: photos[i].y, moved: false, ev: e };
    if (e.altKey) startSwap(e);
    else holdT = setTimeout(() => { if (gest && gest.type === 'pan' && !gest.moved) startSwap(gest.ev); }, 380);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !gest) return;
    const p = toCanvas(e);
    pts.set(e.pointerId, p);
    if (gest.type === 'pan') {
      gest.ev = e;
      const dx = p.x - gest.p.x, dy = p.y - gest.p.y;
      if (!gest.moved && Math.hypot(dx, dy) < 6 * dpr()) return;
      gest.moved = true; clearTimeout(holdT);
      const ph = photos[gest.i], r = photoRect(model, rects[gest.i]);
      const src = ph.prev, sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
      const scale = Math.max(r.w / sw, r.h / sh) * ph.zoom;
      // rotate the drag into the card's frame for scattered polaroids
      const c = Math.cos(-(r.rot || 0)), s = Math.sin(-(r.rot || 0));
      const ldx = dx * c - dy * s, ldy = dx * s + dy * c;
      const win = { w: Math.min(sw, r.w / scale), h: Math.min(sh, r.h / scale) };
      ph.x = clamp(gest.x - ldx / scale / sw, win.w / 2 / sw, 1 - win.w / 2 / sw);
      ph.y = clamp(gest.y - ldy / scale / sh, win.h / 2 / sh, 1 - win.h / 2 / sh);
      touched(); markDirty();
    } else if (gest.type === 'swap') {
      moveGhost(e);
      const t = hitCell(p.x, p.y);
      const tgt = t >= 0 && t !== gest.from ? t : -1;
      if (tgt !== ui.target) { ui.target = tgt; markDirty(); }
    } else if (gest.type === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const ph = photos[gest.i];
      ph.zoom = clamp(gest.zoom * (Math.hypot(b.x - a.x, b.y - a.y) / gest.d), 1, 4);
      touched(); markDirty();
    }
  });
  function end(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    clearTimeout(holdT);
    if (!gest) return;
    if (gest.type === 'pan' && !gest.moved) { selected = selected === gest.i ? -1 : gest.i; syncUI(); }
    if (gest.type === 'swap') {
      const t = ui.target;
      if (t >= 0) {
        const a = gest.from;
        while (photos.length <= t) photos.push(null);
        [photos[a], photos[t]] = [photos[t], photos[a]];
        // keep photos dense: move holes to the end
        for (let k = photos.length - 1; k >= 0; k--) if (!photos[k]) photos.splice(k, 1);
        selected = -1;
        touched();
        if (!reducedMotion()) toast('Swapped ♡', { duration: 1000 });
        renderPane();
      }
      ui.target = -1; ui.lifted = -1; ghost.hidden = true;
      syncUI();
    }
    if (pts.size === 0) gest = null;
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    const p = toCanvas(e);
    const i = hitCell(p.x, p.y);
    if (i < 0 || !photos[i]) return;
    e.preventDefault();
    photos[i].zoom = clamp(photos[i].zoom * Math.exp(-e.deltaY * 0.0015), 1, 4);
    touched(); markDirty();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    if (selected < 0 || !photos[selected]) return;
    const ph = photos[selected];
    const st = e.shiftKey ? 0.05 : 0.01;
    const k = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (k) { e.preventDefault(); ph.x = clamp(ph.x + k[0], 0, 1); ph.y = clamp(ph.y + k[1], 0, 1); touched(); markDirty(); }
    if (e.key === '+' || e.key === '=') { ph.zoom = clamp(ph.zoom * 1.1, 1, 4); touched(); markDirty(); }
    if (e.key === '-') { ph.zoom = clamp(ph.zoom / 1.1, 1, 4); touched(); markDirty(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePhoto(selected); }
  });

  $('#cl-cellbar', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-cell]'); if (!b || selected < 0) return;
    if (b.dataset.cell === 'replace') pickFor(selected);
    if (b.dataset.cell === 'fit') { const p = photos[selected]; p.x = 0.5; p.y = 0.5; p.zoom = 1; touched(); markDirty(); }
    if (b.dataset.cell === 'remove') removePhoto(selected);
  });

  // ---------- decorate / save ----------
  async function baseBlob(full) {
    const imgs = Array.from({ length: slotCount() }, (_, i) => (photos[i] ? (full ? photos[i].img : photos[i].prev) : null));
    return renderToBlob({ ...model, cells: photos.slice(0, slotCount()).map(cellOf) }, imgs, 1440);
  }
  const cellOf = (p) => (p ? { assetId: p.assetId, x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000, zoom: Math.round(p.zoom * 1000) / 1000 } : null);

  $('#cl-decorate', root).onclick = async () => {
    if (!photos.length) return;
    const btn = $('#cl-decorate', root);
    btn.disabled = true;
    try {
      const { blob } = await baseBlob(true);
      const url = URL.createObjectURL(blob);
      const r = await openStoryEditor({ src: url, model: model.story, title: 'Decorate collage' });
      URL.revokeObjectURL(url);
      if (r) {
        model.story = { ...r.edit, base: { assetId: null } };
        decorated = { blob: r.blob, width: r.width, height: r.height, key: collageKey() };
        changed = true;
        toast('Decorations added ✨');
      }
    } catch (e) { console.error(e); toast('Couldn’t open the decorator. Try again?'); }
    btn.disabled = false;
    syncUI();
  };
  $('#cl-undecorate', root).onclick = () => { model.story = null; decorated = null; changed = true; syncUI(); toast('Decorations removed'); };

  $('#cl-cancel', root).onclick = () => layer.close('cancel');
  $('#cl-save', root).onclick = async () => {
    const used = photos.slice(0, slotCount()).filter(Boolean);
    if (!used.length) { toast('Add a photo first ♡'); return; }
    const btn = $('#cl-save', root);
    btn.disabled = true;
    const loading = $('#cl-loading', root), msg = $('#cl-loading-msg', root);
    loading.hidden = false;
    try {
      // 1) upload new photos
      const toUpload = used.filter((p) => !p.assetId);
      let n = 0;
      for (const p of toUpload) {
        msg.textContent = `saving photos ${++n} of ${toUpload.length}…`;
        const r = await uploadPhoto(p.file);
        p.assetId = r.assetId;
      }
      // 2) flatten (reuse the decorated render if nothing changed since)
      msg.textContent = 'making your collage…';
      let out;
      if (model.story && decorated && decorated.key === collageKey()) out = decorated;
      else {
        const b = await baseBlob(true);
        if (model.story) {
          const url = URL.createObjectURL(b.blob);
          try { out = await renderStory(url, model.story); } finally { URL.revokeObjectURL(url); }
        } else out = b;
      }
      const edit = {
        type: 'collage', v: 1, template: model.template, aspect: model.aspect, spacing: model.spacing, radius: model.radius, bg: model.bg,
        cells: photos.slice(0, slotCount()).map(cellOf).filter(Boolean), story: model.story || null,
      };
      msg.textContent = 'pinning it…';
      const text = caption.trim();
      if (editing) {
        await saveRender(editing.id, { blob: out.blob, width: out.width, height: out.height, edit }, { text });
        // photos no longer in the collage
        const keep = new Set(edit.cells.map((c) => c.assetId));
        (base.cells || []).forEach((c) => { if (c && c.assetId && !keep.has(c.assetId)) deleteAsset(c.assetId); });
      } else {
        await saveRender(null, { blob: out.blob, width: out.width, height: out.height, edit }, { kind: 'collage', boardId: boardId || null, text });
      }
      saved = true;
      toast(editing ? 'Collage saved ♡' : 'Collage pinned ♡', { emoji: '🖼️' });
      confetti({ emoji: '💖✨🌸' });
      forceClose = true;
      layer.close('save');
    } catch (e) {
      console.error(e);
      toast(errText(e));
      loading.hidden = true;
      btn.disabled = false;
    }
  };

  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);

  // ---------- load an existing collage ----------
  if (editing) {
    const loading = $('#cl-loading', root);
    loading.hidden = false;
    const imgs = await loadCellImages(base);
    (base.cells || []).forEach((c, i) => {
      const img = imgs[i];
      if (!c || !img) return;
      photos.push({ file: null, url: blobSrc(c.assetId), assetId: c.assetId, img, prev: downscale(img), x: c.x ?? 0.5, y: c.y ?? 0.5, zoom: c.zoom || 1 });
    });
    loading.hidden = true;
  }
  renderPane();
  syncUI();
  resize();
  if (!editing) setTimeout(() => { if (!photos.length && !destroyed) $('#cl-drop', root)?.focus(); }, 80);
  await layer.closed;
}
