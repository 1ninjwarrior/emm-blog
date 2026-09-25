// Em&m Blog: post helpers shared by Home, the story editor and the collage maker.
//
// posts doc: {kind: photo|video|thought|collage, assetId, text, tint, createdAt, boardId,
//             frame, stickers:[{e,x,y,s}]          <- legacy decorate (v1 site)
//             w, h                                 <- original size (new posts)
//             edit: {type:'story'|'collage', v, ...} <- editable model (additive)
//             renderedId, rw, rh                   <- flattened image of the edit (grid shows it)
//             favorite, updatedAt}
import { add, set, update, remove, upload, deleteAsset, blobSrc, byId, errText } from './store.js';

const OK_IMG = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX = 20 * 1024 * 1024;

/** The URL a post card should show (rendered edit first, then original). */
export const postSrc = (p) => blobSrc(p.renderedId || p.assetId);
export const originalSrc = (p) => blobSrc(p.assetId);
/** Known display size or null. */
export function postSize(p) {
  if (p.renderedId && p.rw && p.rh) return { w: p.rw, h: p.rh };
  if (!p.renderedId && p.w && p.h) return { w: p.w, h: p.h };
  return null;
}
/** Legacy frame/stickers decorate (drawn with CSS) when there's no flattened render. */
export const hasLegacyDeco = (p) => !p.renderedId && p.kind === 'photo' && ((p.frame && p.frame !== 'none') || (p.stickers && p.stickers.length));

function decodeImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

/**
 * Get an uploadable image blob + size from a File. Converts HEIC/huge files to JPEG and
 * downsizes anything larger than `maxSide` (default 2400px) so uploads stay quick.
 */
export async function prepImage(file, maxSide = 2400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeImage(url);
    const w = img.naturalWidth, h = img.naturalHeight;
    const big = Math.max(w, h) > maxSide;
    if (OK_IMG.includes(file.type) && file.size <= MAX && !big && file.type !== 'image/gif') return { blob: file, type: file.type, w, h };
    if (file.type === 'image/gif' && file.size <= MAX) return { blob: file, type: file.type, w, h }; // keep animation
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
    const type = keepAlpha ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((r) => c.toBlob(r, type, 0.88));
    if (!blob) throw new Error('encode');
    if (blob.size > MAX) {
      const j = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
      return { blob: j, type: 'image/jpeg', w: c.width, h: c.height };
    }
    return { blob, type, w: c.width, h: c.height };
  } catch (e) {
    throw { code: 'unsupported_type' };
  } finally { URL.revokeObjectURL(url); }
}

/** Upload a photo File. Resolves {assetId, w, h, url}. */
export async function uploadPhoto(file) {
  const { blob, type, w, h } = await prepImage(file);
  const r = await upload(blob, type);
  return { assetId: r.id, url: r.url, w, h };
}

export function videoInfo(file) {
  if (file.size > MAX) throw { code: 'too_large' };
  return { blob: file, type: file.type === 'video/webm' ? 'video/webm' : 'video/mp4' };
}

/** Create a post; resolves its id. */
export function createPost(data) {
  const now = Date.now();
  return add('posts', { text: '', boardId: null, favorite: false, createdAt: now, updatedAt: now, ...data });
}

export const updatePost = (id, patch) => update('posts', id, { ...patch, updatedAt: Date.now() });

/**
 * Save an editor result onto a post (or create a new post when postId is null).
 * result: {blob, width, height, edit}. Uploads the render, stores its id, then deletes the old render.
 * extra: fields for a new post (kind, boardId, text, assetId, w, h).
 * Resolves the post id.
 */
export async function saveRender(postId, result, extra = {}) {
  const up = await upload(result.blob, result.blob.type || 'image/png');
  const fields = { edit: result.edit, renderedId: up.id, rw: Math.round(result.width), rh: Math.round(result.height) };
  if (!postId) return createPost({ kind: 'photo', ...extra, ...fields });
  const old = byId('posts', postId);
  const oldRender = old && old.renderedId;
  // Once a post has an editable model, drop the legacy frame/stickers so they aren't drawn twice.
  await updatePost(postId, { ...fields, ...extra, frame: 'none', stickers: [] });
  if (oldRender && oldRender !== up.id) deleteAsset(oldRender);
  return postId;
}

/** Every asset id a post points at. */
export function postAssetIds(p) {
  const ids = new Set([p.assetId, p.renderedId]);
  const e = p.edit;
  if (e && e.type === 'collage' && Array.isArray(e.cells)) e.cells.forEach((c) => c && ids.add(c.assetId));
  if (e && e.base && e.base.assetId) ids.add(e.base.assetId);
  ids.delete(undefined); ids.delete(null); ids.delete('');
  return [...ids];
}

/**
 * Delete a post doc now; its assets are deleted after `graceMs` unless undo() is called first.
 * Resolves {undo}. undo() re-creates the doc with the same id and data.
 */
export async function deletePost(p, graceMs = 7000) {
  const { id, ...data } = p;
  await remove('posts', id);
  let undone = false;
  const t = setTimeout(() => { if (!undone) postAssetIds(p).forEach((a) => deleteAsset(a)); }, graceMs);
  return {
    async undo() { undone = true; clearTimeout(t); await set('posts', id, data); },
  };
}

export { errText };
