// Em&m Blog editor: photo filters + adjustments.
// Uses ctx.filter where the browser supports it; otherwise falls back to a per-pixel colour
// matrix (same look, minus blur) so Safari versions without ctx.filter still get filters.

/** Each filter = list of CSS filter ops + an optional colour wash drawn on top. */
export const FILTERS = [
  { id: 'none', label: 'Original', ops: [] },
  { id: 'rosy', label: 'Rosy', ops: [['brightness', 1.04], ['saturate', 1.12], ['hue-rotate', -8]], wash: ['#FF8DB7', 0.14, 'soft-light'] },
  { id: 'peachy', label: 'Peachy', ops: [['brightness', 1.05], ['saturate', 1.1], ['sepia', 0.12]], wash: ['#FFB08A', 0.18, 'soft-light'] },
  { id: 'warm', label: 'Warm', ops: [['sepia', 0.22], ['saturate', 1.2], ['brightness', 1.03]], wash: ['#FFB347', 0.1, 'overlay'] },
  { id: 'cool', label: 'Cool', ops: [['saturate', 0.95], ['hue-rotate', 12], ['brightness', 1.03]], wash: ['#7FB8FF', 0.14, 'soft-light'] },
  { id: 'film', label: 'Film', ops: [['contrast', 0.9], ['saturate', 0.85], ['sepia', 0.18], ['brightness', 1.06]], wash: ['#2E6B5E', 0.08, 'lighten'], grain: true },
  { id: 'dreamy', label: 'Dreamy', ops: [['brightness', 1.1], ['saturate', 1.15], ['contrast', 0.9]], wash: ['#FFD6F0', 0.22, 'screen'], glow: true },
  { id: 'vintage', label: 'Vintage', ops: [['sepia', 0.45], ['contrast', 0.92], ['brightness', 1.05], ['saturate', 0.9]], wash: ['#C98B4D', 0.12, 'multiply'], vignette: true },
  { id: 'bw', label: 'B&W', ops: [['grayscale', 1], ['contrast', 1.12], ['brightness', 1.03]] },
  { id: 'pop', label: 'Pop', ops: [['saturate', 1.55], ['contrast', 1.15]] },
];
export const filterOf = (id) => FILTERS.find((f) => f.id === id) || FILTERS[0];
export const DEFAULT_ADJUST = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

/** All ops for a filter + adjustments (sliders are -100..100). */
function opsFor(filterId, adjust = DEFAULT_ADJUST) {
  const ops = [...filterOf(filterId).ops];
  const a = { ...DEFAULT_ADJUST, ...(adjust || {}) };
  if (a.brightness) ops.push(['brightness', 1 + a.brightness / 200]);
  if (a.contrast) ops.push(['contrast', 1 + a.contrast / 200]);
  if (a.saturation) ops.push(['saturate', 1 + a.saturation / 100]);
  return ops;
}
const cssOf = (ops) => ops.map(([k, v]) => (k === 'hue-rotate' ? `hue-rotate(${v}deg)` : `${k}(${v})`)).join(' ') || 'none';

let support = null;
/** Does ctx.filter really work here? (Checks pixels, not just the property.) */
export function canvasFilterSupported() {
  if (support !== null) return support;
  try {
    const a = document.createElement('canvas'); a.width = a.height = 2;
    const actx = a.getContext('2d'); actx.fillStyle = '#ff0000'; actx.fillRect(0, 0, 2, 2);
    const b = document.createElement('canvas'); b.width = b.height = 2;
    const bctx = b.getContext('2d', { willReadFrequently: true });
    bctx.filter = 'grayscale(1)';
    bctx.drawImage(a, 0, 0);
    const d = bctx.getImageData(0, 0, 1, 1).data;
    support = Math.abs(d[0] - d[1]) < 30;
  } catch (e) { support = false; }
  return support;
}

// ---------- colour-matrix fallback ----------
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; // 3x4 (rgb + offset)
function mul(a, b) { // a after b
  const r = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += a[i * 4 + k] * b[k * 4 + j];
      if (j === 3) v += a[i * 4 + 3];
      r.push(v);
    }
  }
  return r;
}
function opMatrix(k, v) {
  switch (k) {
    case 'brightness': return [v, 0, 0, 0, 0, v, 0, 0, 0, 0, v, 0];
    case 'contrast': { const o = 128 * (1 - v); return [v, 0, 0, o, 0, v, 0, o, 0, 0, v, o]; }
    case 'saturate': return [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0, 0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0, 0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v, 0];
    case 'grayscale': { const s = 1 - v; return opMatrix('saturate', s); }
    case 'sepia': { const s = 1 - v; return [0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0, 0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0, 0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s, 0]; }
    case 'hue-rotate': {
      const a = (v * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      return [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0];
    }
    default: return I();
  }
}
function applyMatrix(ctx, w, h, ops) {
  if (!ops.length) return;
  let m = I();
  for (const [k, v] of ops) m = mul(opMatrix(k, v), m);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = m[0] * r + m[1] * g + m[2] * b + m[3];
    d[i + 1] = m[4] * r + m[5] * g + m[6] * b + m[7];
    d[i + 2] = m[8] * r + m[9] * g + m[10] * b + m[11];
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Draw `source` into ctx at (dx,dy,dw,dh) from source rect (sx,sy,sw,sh) with the filter + adjust.
 * The target region is assumed to be inside a canvas we own (it may read pixels back).
 */
export function drawFiltered(ctx, source, s, d, filterId, adjust) {
  const f = filterOf(filterId);
  const ops = opsFor(filterId, adjust);
  const a = { ...DEFAULT_ADJUST, ...(adjust || {}) };
  const [sx, sy, sw, sh] = s, [dx, dy, dw, dh] = d;
  ctx.save();
  ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
  if (canvasFilterSupported()) {
    ctx.filter = cssOf(ops);
    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.filter = 'none';
    if (f.glow) { // soft bloom
      ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'screen';
      ctx.filter = `blur(${Math.max(2, dw / 90)}px) brightness(1.1)`;
      ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  } else {
    // Filter into a scratch canvas, then copy.
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(dw)); c.height = Math.max(1, Math.round(dh));
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
    try { applyMatrix(cx, c.width, c.height, ops); } catch (e) { /* tainted or too big: unfiltered */ }
    ctx.drawImage(c, dx, dy, dw, dh);
  }
  if (f.wash) {
    ctx.globalCompositeOperation = f.wash[2];
    ctx.globalAlpha = f.wash[1];
    ctx.fillStyle = f.wash[0];
    ctx.fillRect(dx, dy, dw, dh);
  }
  if (a.warmth) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(0.6, Math.abs(a.warmth) / 160);
    ctx.fillStyle = a.warmth > 0 ? '#FF9A3C' : '#3C8CFF';
    ctx.fillRect(dx, dy, dw, dh);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (f.vignette) {
    const g = ctx.createRadialGradient(dx + dw / 2, dy + dh / 2, Math.min(dw, dh) * 0.35, dx + dw / 2, dy + dh / 2, Math.max(dw, dh) * 0.75);
    g.addColorStop(0, 'rgba(60,30,10,0)'); g.addColorStop(1, 'rgba(60,30,10,.42)');
    ctx.fillStyle = g; ctx.fillRect(dx, dy, dw, dh);
  }
  if (f.grain) {
    // cheap film grain: a tiny noise tile, repeated
    const t = grainTile();
    ctx.globalAlpha = 0.09; ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(t, 'repeat');
    ctx.fillRect(dx, dy, dw, dh);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

let grain = null;
function grainTile() {
  if (grain) return grain;
  grain = document.createElement('canvas'); grain.width = grain.height = 96;
  const g = grain.getContext('2d');
  const img = g.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return grain;
}
