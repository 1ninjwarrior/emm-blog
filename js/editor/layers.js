// Em&m Blog editor: layer model (text + stickers), drawing, bounds, hit tests.
//
// Coordinates are normalized to the whole output canvas (photo + frame):
//   x, y   centre, as fractions of canvas width / height
//   s      size as a fraction of canvas width (sticker width, or text font size)
//   rot    radians
// Layer shapes:
//   {id, type:'text', text, x, y, s, rot, font, color, style:'plain'|'bubble'|'outline'|'glow', align:'left'|'center'|'right'}
//   {id, type:'sticker', kind:'emoji', e, x, y, s, rot}
//   {id, type:'sticker', kind:'img', file, x, y, s, rot, ar}      (file inside img/stickers/, ar = h/w)
//   {id, type:'draw', strokes:[...]}                                (see draw.js; exactly one, ordered with the rest)

export const FONTS = [
  { id: 'Sniglet', label: 'Sniglet', weight: 800 },
  { id: 'Nunito', label: 'Nunito', weight: 800 },
  { id: 'Caveat', label: 'Caveat', weight: 700 },
  { id: 'Pacifico', label: 'Pacifico', weight: 400 },
  { id: 'DM Serif Display', label: 'Serif', weight: 400 },
  { id: 'Space Mono', label: 'Mono', weight: 700 },
  { id: 'Patrick Hand', label: 'Patrick', weight: 400 },
  { id: 'Fredoka', label: 'Fredoka', weight: 600 },
];
export const fontOf = (id) => FONTS.find((f) => f.id === id) || FONTS[0];

export const COLORS = ['#FFFFFF', '#1E1B1D', '#FF6B9D', '#D9437E', '#FF8C8C', '#FFB36B', '#FFE08A', '#9ADB8F', '#7FD1C7', '#8CC0EE', '#B899F0', '#FFC2D8', '#C8A27E', '#5B3A29'];

export const STICKER_EMOJIS = [
  { name: 'Love', list: ['💖', '💕', '💗', '💓', '💞', '💘', '💝', '❤️', '🩷', '🤍', '💌', '💋', '🥰', '😘', '🫶', '💐'] },
  { name: 'Flowers', list: ['🌸', '🌷', '🌼', '🌺', '🌻', '🌹', '💮', '🪷', '🍀', '🌿', '🍃', '🍄'] },
  { name: 'Sparkle', list: ['✨', '⭐', '🌟', '💫', '🌙', '🌈', '☁️', '☀️', '🫧', '🎀', '👑', '💎', '🦋', '🪩'] },
  { name: 'Critters', list: ['🐰', '🧸', '🐱', '🐶', '🐻', '🐼', '🐥', '🐣', '🦢', '🐸', '🐨', '🦊', '🐹', '🐝', '🐞', '🦄'] },
  { name: 'Treats', list: ['🍓', '🍒', '🍑', '🍰', '🧁', '🍩', '🎂', '🍪', '🍦', '🍭', '🍬', '🧋', '☕', '🍵', '🥐', '🍕'] },
  { name: 'Fun', list: ['🎉', '🎈', '🎁', '📸', '🎧', '🎵', '📚', '✏️', '💅', '👗', '👒', '🕶️', '🏖️', '✈️', '🗺️', '🔥'] },
];

let uidN = 0;
export const lid = () => 'L' + Date.now().toString(36) + (uidN++).toString(36);

// ---------- sticker images ----------
const imgCache = new Map(); // file -> {img, ok}
let onImgLoad = () => {};
export function setImageLoadHandler(fn) { onImgLoad = fn; }
export function stickerImage(file) {
  let c = imgCache.get(file);
  if (!c) {
    const img = new Image();
    c = { img, ok: false, p: null };
    c.p = new Promise((res) => {
      img.onload = () => { c.ok = true; onImgLoad(); res(); };
      img.onerror = () => res();
    });
    img.src = 'img/stickers/' + encodeURIComponent(file);
    imgCache.set(file, c);
  }
  return c;
}
/** Wait for every image sticker used by these layers (before export). */
export function imagesReady(layers) {
  return Promise.all(layers.filter((l) => l.type === 'sticker' && l.kind === 'img').map((l) => stickerImage(l.file).p));
}

let manifest = null;
/** Sticker manifest grouped: [{name, items:[{file,name}]}]. Never rejects. */
export async function loadManifest() {
  if (manifest) return manifest;
  try {
    const r = await fetch('img/stickers/manifest.json', { cache: 'no-cache' });
    const m = await r.json();
    const cats = Array.isArray(m.categories) ? [...m.categories] : [];
    const groups = new Map(cats.map((c) => [c, []]));
    for (const s of m.stickers || []) {
      if (!s || !s.file) continue;
      const cat = s.category && groups.has(s.category) ? s.category : (s.category || 'More');
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push({ file: s.file, name: s.name || s.file.replace(/\.\w+$/, '') });
    }
    manifest = [...groups].filter(([, items]) => items.length).map(([name, items]) => ({ name, items }));
  } catch (e) { manifest = []; }
  return manifest;
}

// ---------- text ----------
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
export const textFont = (l, px) => { const f = fontOf(l.font); return `${f.weight} ${px}px "${f.id}", "Nunito", sans-serif`; };
const LINE = 1.2;

/** Text metrics in canvas px: {lines, w, h, lh, px, pad}. */
function measureText(ctx, l, W) {
  const px = Math.max(4, l.s * W);
  ctx.font = textFont(l, px);
  const lines = String(l.text || ' ').split('\n');
  let w = 0;
  for (const t of lines) w = Math.max(w, ctx.measureText(t || ' ').width);
  const lh = px * LINE;
  const pad = l.style === 'bubble' ? px * 0.45 : px * 0.15;
  return { lines, w: w + pad * 2, h: lines.length * lh + pad * 2 - (lh - px) * 0.4, lh, px, pad };
}

function contrastInk(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex || '');
  if (!m) return '#1E1B1D';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#5B2A43' : '#FFFFFF';
}

/** Box size (px) of a layer at canvas size W x H. */
export function layerSize(ctx, l, W) {
  if (l.type === 'text') { const m = measureText(ctx, l, W); return { w: m.w, h: m.h }; }
  if (l.type === 'sticker') { const w = l.s * W; return { w, h: l.kind === 'img' ? w * (l.ar || 1) : w }; }
  return { w: 0, h: 0 };
}

/** Draw one text/sticker layer. (Draw layers are drawn by the editor from their cached canvas.) */
export function drawLayer(ctx, l, W, H) {
  const x = l.x * W, y = l.y * H;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(l.rot || 0);
  if (l.type === 'sticker') {
    const w = l.s * W;
    if (l.kind === 'img') {
      const c = stickerImage(l.file);
      const h = w * (l.ar || 1);
      if (c.ok) {
        ctx.shadowColor = 'rgba(80,20,50,.22)'; ctx.shadowBlur = w * 0.04; ctx.shadowOffsetY = w * 0.02;
        ctx.drawImage(c.img, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.beginPath(); ctx.arc(0, 0, w * 0.3, 0, 6.283); ctx.fill();
      }
    } else {
      ctx.font = `${w * 0.86}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = w * 0.05; ctx.shadowOffsetY = w * 0.025;
      ctx.fillText(l.e, 0, w * 0.04);
    }
  } else if (l.type === 'text') {
    const m = measureText(ctx, l, W);
    ctx.font = textFont(l, m.px);
    ctx.textBaseline = 'middle';
    const align = l.align || 'center';
    ctx.textAlign = align;
    const tx = align === 'left' ? -m.w / 2 + m.pad : align === 'right' ? m.w / 2 - m.pad : 0;
    const top = -m.h / 2 + m.pad + m.px * 0.5;
    const color = l.color || '#FFFFFF';
    if (l.style === 'bubble') {
      ctx.fillStyle = color;
      ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = m.px * 0.25; ctx.shadowOffsetY = m.px * 0.08;
      roundRectPath(ctx, -m.w / 2, -m.h / 2, m.w, m.h, Math.min(m.px * 0.7, m.h / 2));
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = contrastInk(color);
      m.lines.forEach((t, i) => ctx.fillText(t, tx, top + i * m.lh));
    } else if (l.style === 'outline') {
      ctx.lineJoin = 'round'; ctx.miterLimit = 2;
      ctx.lineWidth = m.px * 0.22;
      ctx.strokeStyle = contrastInk(color) === '#FFFFFF' ? '#FFFFFF' : '#5B2A43';
      m.lines.forEach((t, i) => ctx.strokeText(t, tx, top + i * m.lh));
      ctx.fillStyle = color;
      m.lines.forEach((t, i) => ctx.fillText(t, tx, top + i * m.lh));
    } else if (l.style === 'glow') {
      ctx.shadowColor = color; ctx.shadowBlur = m.px * 0.55;
      ctx.fillStyle = '#FFFFFF';
      for (let k = 0; k < 2; k++) m.lines.forEach((t, i) => ctx.fillText(t, tx, top + i * m.lh));
      ctx.shadowBlur = m.px * 0.15;
      ctx.fillStyle = '#FFFFFF';
      m.lines.forEach((t, i) => ctx.fillText(t, tx, top + i * m.lh));
    } else {
      ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = m.px * 0.12; ctx.shadowOffsetY = m.px * 0.04;
      ctx.fillStyle = color;
      m.lines.forEach((t, i) => ctx.fillText(t, tx, top + i * m.lh));
    }
  }
  ctx.restore();
}

export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Point (canvas px) in the layer's local, unrotated frame. */
export function toLocal(l, px, py, W, H) {
  const dx = px - l.x * W, dy = py - l.y * H;
  const c = Math.cos(-(l.rot || 0)), s = Math.sin(-(l.rot || 0));
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** Topmost text/sticker layer under a point (canvas px), or null. slop = extra px for fingers. */
export function hitLayer(ctx, layers, px, py, W, H, slop = 0) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.type !== 'text' && l.type !== 'sticker') continue;
    const { w, h } = layerSize(ctx, l, W);
    const p = toLocal(l, px, py, W, H);
    const m = slop + Math.max(0, 24 - Math.min(w, h) / 2); // small things get a bigger target
    if (Math.abs(p.x) <= w / 2 + m && Math.abs(p.y) <= h / 2 + m) return l;
  }
  return null;
}

/** Corner handle position (canvas px) for a layer: bottom-right corner of its rotated box. */
export function handlePos(ctx, l, W, H) {
  const { w, h } = layerSize(ctx, l, W);
  const hx = w / 2 + 6, hy = h / 2 + 6;
  const c = Math.cos(l.rot || 0), s = Math.sin(l.rot || 0);
  return { x: l.x * W + hx * c - hy * s, y: l.y * H + hx * s + hy * c };
}

/** Selection outline + handle. scale = canvas px per CSS px (so chrome looks the same size). */
export function drawSelection(ctx, l, W, H, scale) {
  const { w, h } = layerSize(ctx, l, W);
  ctx.save();
  ctx.translate(l.x * W, l.y * H);
  ctx.rotate(l.rot || 0);
  ctx.setLineDash([6 * scale, 5 * scale]);
  ctx.lineWidth = 2 * scale;
  ctx.strokeStyle = '#FFFFFF';
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 3 * scale;
  roundRectPath(ctx, -w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 10 * scale);
  ctx.stroke();
  ctx.setLineDash([]);
  // handle
  const r = 11 * scale;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(w / 2 + 6, h / 2 + 6, r, 0, 6.283); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#D9437E'; ctx.lineWidth = 2.2 * scale;
  ctx.beginPath(); ctx.arc(w / 2 + 6, h / 2 + 6, r * 0.5, -0.3, 4.2); ctx.stroke();
  ctx.restore();
}

/** Legacy v1 decorate {frame, stickers:[{e,x,y,s}]} -> emoji layers. photo rect r and W,H in px. */
export function legacyStickersToLayers(stickers, r, W, H) {
  return (stickers || []).filter((k) => k && k.e).map((k) => {
    const fontPx = ((+k.s || 14) / 100) * r.w;
    return {
      id: lid(), type: 'sticker', kind: 'emoji', e: String(k.e),
      x: (r.x + ((+k.x || 50) / 100) * r.w) / W,
      y: (r.y + ((+k.y || 50) / 100) * r.h) / H,
      s: fontPx / 0.86 / W, rot: 0,
    };
  });
}
