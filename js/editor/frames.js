// Em&m Blog editor: photo frames, drawn on canvas.
// A frame adds padding around the photo (fractions of the photo width) and draws a background
// "back" layer plus optional "front" decorations that overhang the photo edge (bows, tape, blossoms).
import { heartPath } from '../ui.js';

export const FRAMES = [
  { id: 'none', label: 'None', emoji: '🚫' },
  { id: 'polaroid', label: 'Polaroid', emoji: '📸' },
  { id: 'dots', label: 'Polka dots', emoji: '🩷' },
  { id: 'gingham', label: 'Gingham', emoji: '🧺' },
  { id: 'hearts', label: 'Hearts', emoji: '💕' },
  { id: 'blossoms', label: 'Blossoms', emoji: '🌸' },
  { id: 'bow', label: 'Bow', emoji: '🎀' },
  { id: 'scalloped', label: 'Scalloped', emoji: '🍥' },
  { id: 'film', label: 'Film strip', emoji: '🎞️' },
  { id: 'washi', label: 'Washi corners', emoji: '🩹' },
  { id: 'lace', label: 'Lace', emoji: '🤍' },
];

/** Legacy ids from the v1 site ('blossom') -> current ids. */
export function normFrame(id) {
  if (id === 'blossom') return 'blossoms';
  return FRAMES.some((f) => f.id === id) ? id : 'none';
}

const PADS = {
  none: [0, 0, 0, 0],
  polaroid: [0.06, 0.06, 0.06, 0.24],
  dots: [0.07, 0.07, 0.07, 0.07],
  gingham: [0.07, 0.07, 0.07, 0.07],
  hearts: [0.08, 0.08, 0.08, 0.08],
  blossoms: [0.08, 0.08, 0.08, 0.08],
  bow: [0.07, 0.13, 0.07, 0.07],
  scalloped: [0.09, 0.09, 0.09, 0.09],
  film: [0.13, 0.05, 0.13, 0.05],
  washi: [0.07, 0.07, 0.07, 0.07],
  lace: [0.1, 0.1, 0.1, 0.1],
};
/** Padding {l,t,r,b} as fractions of the photo width. */
export function framePad(id) {
  const p = PADS[normFrame(id)];
  return { l: p[0], t: p[1], r: p[2], b: p[3] };
}
/** Frames whose outline isn't a full rectangle (export as PNG to keep transparent edges). */
export const frameHasAlpha = (id) => ['scalloped', 'lace'].includes(normFrame(id));

// ---------- little drawing helpers ----------
export function flower(ctx, x, y, r, petal, mid = '#FFE08A', rot = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.5, r * 0.32, r * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = mid;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.beginPath(); ctx.arc(-r * 0.07, -r * 0.07, r * 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function bow(ctx, x, y, w, color = '#FF85B3', dark = '#D9437E') {
  const s = w / 100;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = dark; ctx.lineWidth = 3.5;
  ctx.shadowColor = 'rgba(120,20,60,.25)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  ctx.fillStyle = color;
  // tails
  ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(-20, 42); ctx.lineTo(-11, 38); ctx.lineTo(-5, 47); ctx.lineTo(5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, 2); ctx.lineTo(20, 42); ctx.lineTo(11, 38); ctx.lineTo(5, 47); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  // loops
  ctx.beginPath(); ctx.moveTo(0, -2); ctx.bezierCurveTo(-10, -22, -44, -30, -46, -8); ctx.bezierCurveTo(-47, 10, -20, 12, 0, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -2); ctx.bezierCurveTo(10, -22, 44, -30, 46, -8); ctx.bezierCurveTo(47, 10, 20, 12, 0, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-12, -2); ctx.quadraticCurveTo(-24, -12, -34, -10); ctx.moveTo(12, -2); ctx.quadraticCurveTo(24, -12, 34, -10); ctx.stroke();
  // knot
  ctx.fillStyle = dark === '#D9437E' ? '#FFA6C6' : color;
  ctx.strokeStyle = dark; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.ellipse(0, 1, 9, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.beginPath(); ctx.ellipse(-3, -3, 2.4, 3.2, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function tapeStrip(ctx, cx, cy, w, h, rot, color) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
  // zig-zag torn ends
  const z = h / 6;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 0; i < 6; i++) ctx.lineTo(w / 2 + (i % 2 ? 0 : z * 0.8), -h / 2 + (i + 1) * z);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = 0; i < 6; i++) ctx.lineTo(-w / 2 - (i % 2 ? 0 : z * 0.8), h / 2 - (i + 1) * z);
  ctx.closePath();
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#FFFFFF';
  for (let x = -w / 2 + h * 0.3; x < w / 2; x += h * 0.55) { ctx.beginPath(); ctx.arc(x, 0, h * 0.12, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function scallopPath(ctx, x, y, w, h, r) {
  // bumpy outline around a rect, bumps of radius r
  ctx.beginPath();
  const nx = Math.max(3, Math.round(w / (r * 2))), ny = Math.max(3, Math.round(h / (r * 2)));
  const sx = w / nx, sy = h / ny;
  for (let i = 0; i < nx; i++) ctx.arc(x + sx * (i + 0.5), y, sx / 2, Math.PI, 0);
  for (let i = 0; i < ny; i++) ctx.arc(x + w, y + sy * (i + 0.5), sy / 2, -Math.PI / 2, Math.PI / 2);
  for (let i = nx - 1; i >= 0; i--) ctx.arc(x + sx * (i + 0.5), y + h, sx / 2, 0, Math.PI);
  for (let i = ny - 1; i >= 0; i--) ctx.arc(x, y + sy * (i + 0.5), sy / 2, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
}

/** Background of the frame (under the photo). r = photo rect {x,y,w,h}. */
export function drawFrameBack(ctx, id, W, H, r) {
  id = normFrame(id);
  const u = r.w;
  ctx.save();
  switch (id) {
    case 'polaroid': {
      ctx.fillStyle = '#FFFDF9'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = u * 0.004; ctx.strokeRect(0, 0, W, H);
      break;
    }
    case 'dots': {
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
      const st = u * 0.05, rr = u * 0.012;
      ctx.fillStyle = '#FF9EC2';
      for (let y = st / 2, row = 0; y < H + st; y += st, row++) for (let x = (row % 2 ? st / 2 : 0); x < W + st; x += st) { ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.283); ctx.fill(); }
      break;
    }
    case 'gingham': {
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
      const s = u * 0.035;
      ctx.fillStyle = 'rgba(255,142,183,.42)';
      for (let y = 0; y < H; y += s * 2) ctx.fillRect(0, y, W, s);
      for (let x = 0; x < W; x += s * 2) ctx.fillRect(x, 0, s, H);
      break;
    }
    case 'hearts': {
      ctx.fillStyle = '#FFF1F6'; ctx.fillRect(0, 0, W, H);
      const st = u * 0.07;
      ctx.fillStyle = '#FF8DB7';
      for (let y = st / 2, row = 0; y < H + st; y += st, row++) for (let x = (row % 2 ? st / 2 : 0); x < W + st; x += st) { heartPath(ctx, x, y, st * 0.42); ctx.fill(); }
      break;
    }
    case 'blossoms': {
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#FFD2E2'; ctx.lineWidth = u * 0.012;
      ctx.strokeRect(r.x - u * 0.025, r.y - u * 0.025, r.w + u * 0.05, r.h + u * 0.05);
      const cols = ['#FFB8D1', '#FFD2E2', '#FFC9DC'];
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647), (seed - 1) / 2147483646);
      const n = Math.round((W + H) / (u * 0.07));
      for (let i = 0; i < n; i++) {
        const side = i % 4, t = rnd();
        const x = side === 0 ? t * W : side === 1 ? W - rnd() * r.x * 0.7 : side === 2 ? t * W : rnd() * r.x * 0.7;
        const y = side === 0 ? rnd() * r.y * 0.7 : side === 1 ? t * H : side === 2 ? H - rnd() * (H - r.y - r.h) * 0.7 : t * H;
        flower(ctx, x, y, u * 0.022, cols[i % 3], '#FFF3B8', rnd() * 6);
      }
      break;
    }
    case 'bow': {
      ctx.fillStyle = '#FFC9DC'; ctx.fillRect(0, 0, W, H);
      ctx.setLineDash([u * 0.018, u * 0.014]);
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = u * 0.007;
      const m = u * 0.03;
      ctx.strokeRect(m, m, W - m * 2, H - m * 2);
      break;
    }
    case 'scalloped': {
      const rr = u * 0.035;
      scallopPath(ctx, rr, rr, W - rr * 2, H - rr * 2, rr);
      ctx.fillStyle = '#FFB8D1'; ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(r.x - u * 0.04, r.y - u * 0.04, r.w + u * 0.08, r.h + u * 0.08);
      ctx.setLineDash([u * 0.012, u * 0.012]);
      ctx.strokeStyle = '#FF8DB7'; ctx.lineWidth = u * 0.005;
      ctx.strokeRect(r.x - u * 0.022, r.y - u * 0.022, r.w + u * 0.044, r.h + u * 0.044);
      break;
    }
    case 'film': {
      ctx.fillStyle = '#1E1B1D'; ctx.fillRect(0, 0, W, H);
      const hw = u * 0.045, hh = u * 0.032, gap = u * 0.03;
      ctx.fillStyle = '#F6EFE8';
      for (let y = gap; y + hh < H; y += hh + gap) {
        for (const x of [r.x / 2 - hw / 2, W - r.x / 2 - hw / 2]) {
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, hw, hh, hh * 0.25) : ctx.rect(x, y, hw, hh); ctx.fill();
        }
      }
      ctx.fillStyle = '#FF9A3C';
      ctx.font = `700 ${u * 0.026}px "Space Mono", monospace`;
      ctx.save(); ctx.translate(r.x * 0.2, H * 0.5); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('EM&M 400  ♡  ', 0, 0); ctx.restore();
      break;
    }
    case 'washi': {
      ctx.fillStyle = '#FFF8EF'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(214,170,140,.08)';
      for (let y = 0; y < H; y += u * 0.02) ctx.fillRect(0, y, W, u * 0.004);
      break;
    }
    case 'lace': {
      const rr = u * 0.03;
      scallopPath(ctx, rr, rr, W - rr * 2, H - rr * 2, rr);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      // eyelet holes in the lace band
      ctx.globalCompositeOperation = 'destination-out';
      const band = u * 0.05, step = u * 0.04;
      const holes = (x0, y0, x1, y1) => {
        const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / step);
        for (let i = 0; i <= n; i++) { const t = i / n; ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, u * 0.008, 0, 6.283); ctx.fill(); }
      };
      holes(band, band, W - band, band); holes(band, H - band, W - band, H - band);
      holes(band, band, band, H - band); holes(W - band, band, W - band, H - band);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#FFB8D1'; ctx.lineWidth = u * 0.012;
      ctx.strokeRect(r.x - u * 0.02, r.y - u * 0.02, r.w + u * 0.04, r.h + u * 0.04);
      break;
    }
    default: break;
  }
  ctx.restore();
}

/** Decorations above the photo (may overhang the edge). */
export function drawFrameFront(ctx, id, W, H, r) {
  id = normFrame(id);
  const u = r.w;
  ctx.save();
  switch (id) {
    case 'polaroid': {
      // soft inner edge so the photo sits "in" the paper
      ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = u * 0.004;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'hearts': {
      ctx.fillStyle = '#FF6B9D';
      ctx.shadowColor = 'rgba(120,20,60,.25)'; ctx.shadowBlur = u * 0.01;
      heartPath(ctx, r.x + r.w - u * 0.02, r.y + r.h - u * 0.02, u * 0.14); ctx.fill();
      ctx.fillStyle = '#FFB8D1';
      heartPath(ctx, r.x + r.w - u * 0.12, r.y + r.h + u * 0.02, u * 0.08); ctx.fill();
      break;
    }
    case 'blossoms': {
      const f = (x, y, s, c, rot) => flower(ctx, x, y, u * s, c, '#FFE08A', rot);
      ctx.shadowColor = 'rgba(120,20,60,.2)'; ctx.shadowBlur = u * 0.008; ctx.shadowOffsetY = u * 0.003;
      f(r.x + u * 0.01, r.y + u * 0.02, 0.1, '#FF9EC2', 0.2);
      f(r.x + u * 0.1, r.y - u * 0.01, 0.065, '#FFC9DC', 1);
      f(r.x - u * 0.01, r.y + u * 0.11, 0.055, '#F27AA7', 2);
      f(r.x + r.w - u * 0.01, r.y + r.h - u * 0.02, 0.1, '#FF9EC2', 0.7);
      f(r.x + r.w - u * 0.1, r.y + r.h + u * 0.01, 0.06, '#FFC9DC', 1.6);
      f(r.x + r.w + u * 0.005, r.y + r.h - u * 0.11, 0.05, '#F27AA7', 2.4);
      break;
    }
    case 'bow': bow(ctx, W / 2, r.y - u * 0.005, u * 0.32); break;
    case 'washi': {
      const tw = u * 0.28, th = u * 0.075;
      const cols = ['rgba(255,141,183,.75)', 'rgba(169,214,190,.8)', 'rgba(255,214,120,.8)', 'rgba(190,170,240,.8)'];
      tapeStrip(ctx, r.x + u * 0.02, r.y + u * 0.02, tw, th, -Math.PI / 4, cols[0]);
      tapeStrip(ctx, r.x + r.w - u * 0.02, r.y + u * 0.02, tw, th, Math.PI / 4, cols[1]);
      tapeStrip(ctx, r.x + u * 0.02, r.y + r.h - u * 0.02, tw, th, Math.PI / 4, cols[2]);
      tapeStrip(ctx, r.x + r.w - u * 0.02, r.y + r.h - u * 0.02, tw, th, -Math.PI / 4, cols[3]);
      break;
    }
    case 'film': {
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = u * 0.006;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      break;
    }
    default: break;
  }
  ctx.restore();
}
