// Em&m Blog: recipe links, same format as the app (…/r#1.<deflated json>[.<tiny jpeg>], see codec.js).
//   openReceive(payload)   preview → Save to my recipes / Not now, duplicate detection
//   sendRecipeLink(recipe) build the link (photo shrunk until it fits) → share sheet or copy
import { ready, add, items, byId, kv, loaded, upload, blobSrc, newId, errText } from '../store.js';
import { esc, sheet, toast, confetti, loadImage, emptyHTML } from '../ui.js';
import { copyText } from '../share.js';
import { decodePayload, friendlyShareError, recipeFingerprint, buildShareLink, LIMITS } from '../app/recipes/share/codec.js';
import { splitSource, withSource } from '../app/recipes/source.js';

// ---------- receive ----------
export function findDuplicate(r) {
  const fp = recipeFingerprint(r.title, r.ingredients);
  return items('recipes').find((x) => recipeFingerprint(x.title || '', (x.ingredients || []).map((i) => i.text)) === fp) || null;
}

/** Save a decoded shared recipe as a normal recipe. Resolves the new id. */
export async function saveIncoming({ recipe: r, photo }) {
  let photoId = null;
  if (photo && photo.length) {
    try { photoId = (await upload(new Blob([photo], { type: 'image/jpeg' }), 'image/jpeg')).id; } catch (e) { photoId = null; }
  }
  let notes = r.notes || '';
  if (r.from) notes = notes ? `${notes}\n\nShared by ${r.from} ♡` : `Shared by ${r.from} ♡`;
  notes = withSource(notes, r.sourceTitle, r.sourceUrl);
  const now = Date.now();
  return add('recipes', {
    title: r.title, emoji: r.emoji || '🍰', photoId,
    servings: r.servings ?? null, prepMin: r.prepMin ?? null, cookMin: r.cookMin ?? null,
    ingredients: r.ingredients.map((t) => ({ id: newId(), text: t, checked: false })),
    steps: r.steps.map((t) => ({ id: newId(), text: t })),
    notes, tags: [...new Set((r.tags || []).map((t) => String(t).toLowerCase()))].slice(0, 12),
    favorite: false, createdAt: now, updatedAt: now,
  });
}

/** Preview a shared recipe. openRecipe(id) is called after saving / "Open existing". */
export async function openReceive(payload, { openRecipe }) {
  await ready;
  let dec;
  try { dec = decodePayload(payload); } catch (e) {
    const f = friendlyShareError(e);
    const s = sheet({ title: 'A shared recipe', body: emptyHTML({ img: 'img/illustrations/no-results.png', title: f.title, text: f.message }), foot: `<button type="button" class="btn" id="rcv-ok">Okay</button>` });
    s.foot.querySelector('#rcv-ok').onclick = () => s.close('ok');
    return s;
  }
  await loaded('recipes');
  const r = dec.recipe;
  const photoUrl = dec.photo ? URL.createObjectURL(new Blob([dec.photo], { type: 'image/jpeg' })) : null;
  const dup = findDuplicate(r);
  const s = sheet({
    title: 'A recipe for you ♡',
    className: 'receive-sheet',
    body: `<article class="rcv-card">
        <div class="rcv-pic${photoUrl ? '' : ' noimg'}">${photoUrl ? `<img src="${photoUrl}" alt="">` : `<span class="rc-emoji big" aria-hidden="true">${esc(r.emoji || '🍰')}</span>`}</div>
        <h3 class="rcv-title">${esc(r.emoji || '🍰')} ${esc(r.title)}</h3>
        ${r.from ? `<p class="rcv-from">from ${esc(r.from)} ♡</p>` : ''}
        <p class="muted-line">${r.ingredients.length} ingredient${r.ingredients.length === 1 ? '' : 's'} · ${r.steps.length} step${r.steps.length === 1 ? '' : 's'}${r.servings ? ` · serves ${r.servings}` : ''}</p>
        ${r.ingredients.length ? `<ul class="rcv-ings">${r.ingredients.slice(0, 5).map((t) => `<li>${esc(t)}</li>`).join('')}${r.ingredients.length > 5 ? `<li class="muted">+ ${r.ingredients.length - 5} more</li>` : ''}</ul>` : ''}
      </article>
      ${dup ? `<p class="rcv-dup" id="rcv-dup"><b>You already have this one ♡</b></p>` : ''}`,
    foot: dup
      ? `<button type="button" class="btn soft" id="rcv-copy">Save as a copy</button><button type="button" class="btn" id="rcv-open">Open existing</button>`
      : `<button type="button" class="btn soft" id="rcv-no">Not now</button><button type="button" class="btn" id="rcv-save">Save to my recipes</button>`,
    onClose: () => { if (photoUrl) URL.revokeObjectURL(photoUrl); },
  });
  const save = async (btn) => {
    btn.disabled = true;
    try {
      const id = await saveIncoming(dec);
      s.close('saved');
      confetti({ emoji: r.emoji || '🍰', count: 50 });
      toast('Saved to your recipes ♡', { emoji: r.emoji || '🍰' });
      setTimeout(() => openRecipe(id), 260);
    } catch (e) { btn.disabled = false; toast(errText(e)); }
  };
  const q = (x) => s.foot.querySelector(x);
  if (q('#rcv-no')) q('#rcv-no').onclick = () => s.close('no');
  if (q('#rcv-save')) q('#rcv-save').onclick = (e) => save(e.currentTarget);
  if (q('#rcv-copy')) q('#rcv-copy').onclick = (e) => save(e.currentTarget);
  if (q('#rcv-open')) q('#rcv-open').onclick = () => { s.close('open'); setTimeout(() => openRecipe(dup.id), 220); };
  return s;
}

// ---------- send ----------
export function recipeToShared(r, from = '') {
  const { notes, source } = splitSource(r.notes || '');
  const out = {
    v: 1,
    title: (r.title || '').trim() || 'Untitled',
    emoji: r.emoji || '🍰',
    servings: r.servings ?? null,
    prepMin: r.prepMin ?? null,
    cookMin: r.cookMin ?? null,
    ingredients: (r.ingredients || []).map((i) => i.text.trim()).filter(Boolean).slice(0, LIMITS.items),
    steps: (r.steps || []).map((x) => x.text.trim()).filter(Boolean).slice(0, LIMITS.items),
    notes,
    tags: r.tags || [],
  };
  if (source) { out.sourceUrl = source.url; out.sourceTitle = source.title; }
  if (from) out.from = from;
  return out;
}

const THUMB_STEPS = [[240, 0.6], [200, 0.5], [160, 0.45], [128, 0.4]];
async function linkThumbs(photoId) {
  const out = [];
  const src = photoId && blobSrc(photoId);
  if (!src) return out;
  let img;
  try { img = await loadImage(src); } catch (e) { return out; }
  const w = img.naturalWidth, h = img.naturalHeight;
  const crop = w / h > 4 / 3 ? { x: (w - (h * 4) / 3) / 2, y: 0, w: (h * 4) / 3, h } : { x: 0, y: (h - (w * 3) / 4) / 2, w, h: (w * 3) / 4 };
  for (const [width, q] of THUMB_STEPS) {
    const c = document.createElement('canvas');
    c.width = width; c.height = Math.round((width * 3) / 4);
    c.getContext('2d').drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', q));
    if (blob) out.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}

/** Build the link (shrinking the photo until it fits) → {url, withPhoto, photoDropped}. */
export async function makeRecipeLink(r, from) {
  const shared = recipeToShared(r, from);
  let last = buildShareLink(shared, []);
  const thumbs = await linkThumbs(r.photoId);
  for (const t of thumbs) {
    const l = buildShareLink(shared, [t]);
    if (l.withPhoto) return l;
    last = l;
  }
  return { ...last, photoDropped: thumbs.length > 0 };
}

/** Share sheet: your name (optional, remembered) + Send / Copy link. */
export async function sendRecipeLink(r0) {
  await loaded('kv');
  const s = sheet({
    title: 'Send to someone ♡',
    body: `<p class="imp-help">They get a link that opens the recipe (in Em&amp;m Blog, or on the web). Nothing is uploaded: the recipe travels inside the link.</p>
      <div class="field"><label class="lbl" for="share-name">Your name for shares</label>
      <input class="txt" id="share-name" maxlength="40" placeholder="Emma" autocomplete="nickname" value="${esc(kv.get('share_name', '') || '')}"></div>`,
    foot: `<button type="button" class="btn soft" id="share-copy">Copy link</button><button type="button" class="btn" id="share-send">Send link</button>`,
  });
  const run = async (mode) => {
    const name = s.body.querySelector('#share-name').value.trim();
    if (name !== (kv.get('share_name', '') || '')) kv.set('share_name', name || null).catch(() => {});
    const r = byId('recipes', r0.id) || r0;
    const l = await makeRecipeLink(r, name);
    if (l.photoDropped) toast('Photo not included, it was too big for a link', { emoji: '📷' });
    const title = `${r.emoji || '🍰'} ${r.title} — a recipe from Em&m Blog ♡`;
    if (mode === 'send' && navigator.share) {
      try { await navigator.share({ title, text: title, url: l.url }); s.close('sent'); return l.url; } catch (e) { if (e && e.name === 'AbortError') return null; }
    }
    await copyText(l.url, 'Link copied ♡');
    s.close('copied');
    return l.url;
  };
  s.foot.querySelector('#share-copy').onclick = () => run('copy');
  s.foot.querySelector('#share-send').onclick = () => run('send');
  return s;
}
