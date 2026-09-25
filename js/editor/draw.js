// Em&m Blog editor: freehand drawing.
// Strokes live in the single draw layer: {t, c, w, p}
//   t = 'pen' | 'marker' | 'hl' (highlighter) | 'neon' | 'eraser'
//   c = colour, w = width as a fraction of canvas width, p = flat [x,y,x,y...] normalized 0..1
// The editor keeps all strokes rendered on their own offscreen canvas, so the eraser only
// ever erases drawing (never the photo, text or stickers).

export const TOOLS = [
  { id: 'pen', label: 'Pen', emoji: '🖊️' },
  { id: 'marker', label: 'Marker', emoji: '🖍️' },
  { id: 'hl', label: 'Highlighter', emoji: '🖌️' },
  { id: 'neon', label: 'Neon', emoji: '💡' },
  { id: 'eraser', label: 'Eraser', emoji: '🧽' },
];
export const SIZES = [0.006, 0.012, 0.02, 0.032, 0.05];

const round4 = (v) => Math.round(v * 10000) / 10000;

/** Start a stroke at a normalized point. */
export function newStroke(tool, color, size, x, y) {
  return { t: tool, c: color, w: size, p: [round4(x), round4(y)] };
}
/** Append a point if it moved far enough (keeps docs small). minDist is normalized. Returns true if added. */
export function addPoint(st, x, y, minDist = 0.003) {
  const n = st.p.length;
  const dx = x - st.p[n - 2], dy = y - st.p[n - 1];
  if (dx * dx + dy * dy < minDist * minDist) return false;
  st.p.push(round4(x), round4(y));
  return true;
}

function tracePath(ctx, p, W, H) {
  ctx.beginPath();
  const n = p.length / 2;
  ctx.moveTo(p[0] * W, p[1] * H);
  if (n === 1) { ctx.lineTo(p[0] * W + 0.01, p[1] * H); return; }
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2] * W, y = p[i * 2 + 1] * H;
    const nx = p[i * 2 + 2] * W, ny = p[i * 2 + 3] * H;
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  ctx.lineTo(p[(n - 1) * 2] * W, p[(n - 1) * 2 + 1] * H);
}

/** Render one stroke onto ctx (a canvas of W x H px). */
export function renderStroke(ctx, st, W, H) {
  if (!st || !st.p || st.p.length < 2) return;
  const lw = Math.max(1, st.w * W);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  tracePath(ctx, st.p, W, H);
  switch (st.t) {
    case 'eraser':
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = lw * 2;
      ctx.strokeStyle = '#000';
      ctx.stroke();
      break;
    case 'marker':
      ctx.globalAlpha = 0.88;
      ctx.lineWidth = lw * 1.4;
      ctx.strokeStyle = st.c;
      ctx.stroke();
      break;
    case 'hl':
      ctx.globalAlpha = 0.38;
      ctx.lineCap = 'butt';
      ctx.lineWidth = lw * 2.6;
      ctx.strokeStyle = st.c;
      ctx.stroke();
      break;
    case 'neon':
      ctx.shadowColor = st.c;
      ctx.shadowBlur = lw * 2.2;
      ctx.lineWidth = lw;
      ctx.strokeStyle = st.c;
      ctx.stroke();
      ctx.stroke();
      ctx.shadowBlur = lw * 0.6;
      ctx.lineWidth = lw * 0.4;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.stroke();
      break;
    default:
      ctx.lineWidth = lw;
      ctx.strokeStyle = st.c;
      ctx.stroke();
  }
  ctx.restore();
}

/** Render every stroke onto a (cleared) canvas. */
export function renderStrokes(canvas, strokes) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const st of strokes || []) renderStroke(ctx, st, canvas.width, canvas.height);
}
