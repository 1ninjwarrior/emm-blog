// Em&m Blog: sharing. Canvas -> PNG/JPEG -> downloads capability, copy text, and small
// canvas drawing helpers for "save as a pretty image" cards.
import { state } from './store.js';
import { toast, sheet, esc } from './ui.js';

export const canvasToBlob = (canvas, type = 'image/png', quality = 0.92) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, quality));

/** Safe file name: "em-m-diary-2026-09-25.png". */
export function fileName(base, ext = 'png') {
  const s = String(base || 'em-m').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 60) || 'em-m';
  return `${s}.${ext}`;
}

/**
 * Offer a Blob to the viewer as a file. Uses the downloads capability (the viewer confirms).
 * Without it (a normal website) it downloads the file (or opens the share sheet for images on phones).
 */
export async function saveBlob(blob, filename) {
  if (state.downloads) {
    try {
      await state.downloads.save({ filename, data: blob });
      toast('Saved ♡', { emoji: '📥' });
      return true;
    } catch (e) {
      const c = e && e.code;
      if (c === 'declined') return false;
      if (c === 'rate_limited') { toast('One moment, then try again'); return false; }
      if (c !== 'unavailable' && c !== 'not_granted' && c !== 'capability_disabled' && c !== 'capability_removed') {
        toast('Couldn’t save that one. Try again?');
        return false;
      }
    }
  }
  // A normal website: a plain download (on phones with file sharing, offer the share sheet for images
  // so they can go straight to Photos).
  try {
    const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
    const coarse = matchMedia('(pointer: coarse)').matches;
    if (file && coarse && blob.type.startsWith('image/') && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Saved to your downloads ♡', { emoji: '📥' });
    return true;
  } catch (e) {
    toast('Couldn’t save that one. Try again?');
    return false;
  }
}

/** Canvas -> file offer. */
export async function saveCanvas(canvas, base, { type = 'image/png', quality = 0.92 } = {}) {
  try {
    const blob = await canvasToBlob(canvas, type, quality);
    return saveBlob(blob, fileName(base, type === 'image/jpeg' ? 'jpg' : 'png'));
  } catch (e) {
    toast('Couldn’t make the image. Try again?');
    return false;
  }
}

/** Save an image that's already at a URL (e.g. /_blob/id) as a file. */
export async function saveUrl(url, base) {
  try {
    const r = await fetch(url);
    const blob = await r.blob();
    const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : blob.type === 'image/gif' ? 'gif' : blob.type === 'video/mp4' ? 'mp4' : blob.type === 'video/webm' ? 'webm' : 'png';
    return saveBlob(blob, fileName(base, ext));
  } catch (e) {
    toast('Couldn’t fetch that file. Try again?');
    return false;
  }
}

/** Copy text; call from a click handler. */
export async function copyText(text, done = 'Copied ♡') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, { emoji: '📋' });
    return true;
  } catch (e) {
    // Fallback: a selectable textarea in a sheet.
    const s = sheet({ title: 'Copy this ♡', body: `<textarea class="txt" id="copy-fallback" rows="8" readonly>${esc(text)}</textarea><p class="note">Select all and copy.</p>` });
    const ta = s.body.querySelector('textarea');
    ta.focus(); ta.select();
    return false;
  }
}

// ---------- canvas drawing helpers ----------
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Wrap text into lines that fit maxWidth with the current ctx.font. Keeps explicit newlines. */
export function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxWidth || !line) {
        // Break very long single words.
        if (!line && ctx.measureText(word).width > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > maxWidth && chunk) { out.push(chunk); chunk = ''; }
            chunk += ch;
          }
          line = chunk;
        } else line = test;
      } else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/** Draw wrapped text; returns the y after the last line. maxLines adds an ellipsis. */
export function drawText(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  let lines = wrapLines(ctx, text, maxWidth);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  for (const l of lines) { ctx.fillText(l, x, y); y += lineHeight; }
  return y;
}

/** Fill a dotted "paper" background like the site. */
export function dottedBg(ctx, w, h, bg, dot, step = 26) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dot;
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) { ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.283); ctx.fill(); }
}

/** A washi tape strip. */
export function tape(ctx, cx, cy, w, h, rot, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

/** Read the current theme tokens for canvas drawing. */
export function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  return {
    bg: g('--bg'), dot: g('--bg-dot'), paper: g('--paper'), ink: g('--ink'), muted: g('--muted'), pink: g('--pink'),
    pinkInk: g('--pink-ink'), rose: g('--rose'), blush: g('--blush'), line: g('--line'), tape: g('--tape'),
    petals: [1, 2, 3, 4, 5].map((i) => g('--petal-' + i)),
  };
}

/** A new canvas of w x h. */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w); c.height = Math.round(h);
  return c;
}
