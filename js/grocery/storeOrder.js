// Em&m Blog web: "Store order · My WinCo" sheet. Visible aisles in her walk order, ↑/↓, an aisle-number box per row,
// all lists vs just this one (only with a listId), "Reset to WinCo order". Saves on every change.
import { sheet, esc, toast, icon } from '../ui.js';
import * as G from './core.js';

export async function openStoreOrder({ listId = null, onChange = null } = {}) {
  await G.ready;
  let scope = listId && G.hasOwnOrder(listId) ? 'one' : 'all';
  const s = sheet({
    title: 'Store order · My WinCo',
    className: 'gs-order',
    body: `${listId ? `<div class="seg" role="group" aria-label="Which lists" id="so-scope">
        <button type="button" data-sc="all">All lists</button><button type="button" data-sc="one">Just this list</button></div>` : ''}
      <p class="note">The order you walk your store. Add your aisle numbers so lists say “Aisle 7 · Breakfast &amp; cereal”.</p>
      <ol class="so-list" id="so-list"></ol>`,
    foot: `<button type="button" class="btn soft" id="so-reset">Reset to WinCo order</button><button type="button" class="btn" id="so-done">Done</button>`,
  });
  const list = s.body.querySelector('#so-list');
  const cur = () => G.getAisleOrder(scope === 'one' ? listId : null);
  const changed = () => { if (onChange) onChange(); };
  const paint = () => {
    const sc = s.body.querySelector('#so-scope');
    if (sc) sc.querySelectorAll('[data-sc]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sc === scope)));
    const full = cur();
    const vis = G.order.visibleAisles(full, null, true);
    const nums = G.getAisleNumbers();
    list.innerHTML = vis.map((a, i) => {
      const inf = G.aisleInfo(a);
      return `<li class="so-row" data-a="${a}">
        <span class="so-e" aria-hidden="true">${inf.emoji}</span>
        <span class="so-l">${esc(inf.label)}</span>
        <label class="sr-only" for="so-n-${a}">Aisle number for ${esc(inf.label)}</label>
        <input class="txt so-num" id="so-n-${a}" data-num="${a}" maxlength="14" placeholder="#" value="${esc(nums[a] || '')}" autocomplete="off" inputmode="text">
        <button type="button" class="icon-btn plain" data-mv="-1" aria-label="Move ${esc(inf.label)} up" ${i === 0 ? 'disabled' : ''}>${icon.up}</button>
        <button type="button" class="icon-btn plain" data-mv="1" aria-label="Move ${esc(inf.label)} down" ${i === vis.length - 1 ? 'disabled' : ''}>${icon.down}</button>
      </li>`;
    }).join('');
  };
  paint();
  s.body.addEventListener('click', async (e) => {
    const sc = e.target.closest('[data-sc]');
    if (sc) {
      scope = sc.dataset.sc;
      if (scope === 'one' && !G.hasOwnOrder(listId)) await G.setAisleOrder(G.getAisleOrder(), listId);
      if (scope === 'all' && listId) await G.resetAisleOrder(listId);
      paint(); changed(); return;
    }
    const mv = e.target.closest('[data-mv]');
    if (!mv) return;
    const a = mv.closest('[data-a]').dataset.a;
    const full = cur();
    const vis = G.order.visibleAisles(full, null, true);
    const nextVis = G.order.moveAisle(vis, a, +mv.dataset.mv);
    await G.setAisleOrder(G.order.withVisibleOrder(full, nextVis), scope === 'one' ? listId : null);
    paint(); changed();
    const again = list.querySelector(`[data-a="${a}"] [data-mv="${mv.dataset.mv}"]`);
    if (again && !again.disabled) again.focus();
  });
  s.body.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-num]');
    if (!inp) return;
    await G.setAisleNumber(inp.dataset.num, inp.value);
    inp.value = G.getAisleNumbers()[inp.dataset.num] || '';
    changed();
  });
  s.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('[data-num]')) { e.preventDefault(); e.target.blur(); } });
  s.foot.querySelector('#so-reset').onclick = async () => {
    await G.resetAisleOrder(scope === 'one' ? listId : null);
    paint(); changed();
    toast('Back to the WinCo walk ♡', { emoji: '🗺️' });
  };
  s.foot.querySelector('#so-done').onclick = () => { document.activeElement && document.activeElement.blur(); s.close('done'); };
  return s.closed;
}
