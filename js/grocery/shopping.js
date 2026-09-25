// Em&m Blog web: Shopping mode for a shopping list. Full screen, items grouped in store order with big rows,
// tap anywhere on a row to tick, finished aisles fold with a mini confetti of the aisle emoji, the screen stays
// awake, and "Done shopping" moves the cart into history (with Undo).
import { byId, watch, patchSoon, flushNow } from '../store.js';
import { fullscreen, toast, confetti, esc, icon, keepAwake, reducedMotion } from '../ui.js';
import * as G from './core.js';

export async function openShopping(listId) {
  await G.ready;
  if (!byId('lists', listId)) return;
  const release = await keepAwake();
  const folded = new Set();
  let firstPaint = true;
  const fs = fullscreen({ className: 'gs-fs', label: 'Shopping mode', onClose: () => { release(); off(); flushNow('lists', listId); } });
  const el = fs.el;
  el.innerHTML = `<div class="gs">
    <header class="gw-head">
      <button type="button" class="icon-btn" id="gs-close" aria-label="Close shopping mode">${icon.close}</button>
      <div class="gw-title"><h2>Shopping</h2><span class="muted-line" id="gs-sub"></span></div>
      <button type="button" class="icon-btn" id="gs-order" aria-label="Store order">${icon.map}</button>
    </header>
    <div class="pbar gw-prog" aria-hidden="true"><i id="gs-bar"></i></div>
    <main class="gs-body" id="gs-body"></main>
    <footer class="gw-bar"><button type="button" class="btn block" id="gs-done"></button></footer>
  </div>`;
  const body = el.querySelector('#gs-body');
  el.querySelector('#gs-close').onclick = () => fs.close('x');
  el.querySelector('#gs-order').onclick = async () => { const { openStoreOrder } = await import('./storeOrder.js'); openStoreOrder({ listId, onChange: render }); };

  function render() {
    const l = byId('lists', listId);
    if (!l) { fs.close('gone'); return; }
    const its = [...(l.items || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const order = G.getAisleOrder(listId);
    const nums = G.getAisleNumbers();
    const groups = G.order.groupByAisle(its, G.itemAisle, order);
    const done = its.filter((i) => i.checked).length;
    const left = groups.filter((g) => g.items.some((i) => !i.checked)).length;
    el.querySelector('#gs-sub').textContent = its.length ? `${done} of ${its.length}${left ? ` · ${left} aisle${left === 1 ? '' : 's'} left` : ' · all in the cart ✨'}` : l.title || '';
    el.querySelector('#gs-bar').style.width = (its.length ? Math.round((done / its.length) * 100) : 0) + '%';
    const btn = el.querySelector('#gs-done');
    btn.textContent = done ? `Done shopping (${done})` : 'Tick things as they go in the cart';
    btn.disabled = !done;
    if (!its.length) { body.innerHTML = `<div class="empty"><div class="e" aria-hidden="true">🛒</div><h2>Nothing to shop for, lucky you ♡</h2></div>`; return; }
    body.innerHTML = groups.map((g) => {
      const inf = G.aisleInfo(g.aisle);
      const n = G.order.aisleNumberLabel(nums[g.aisle]);
      const all = g.items.every((i) => i.checked);
      if (all && !folded.has(g.aisle) && !firstPaint) {
        folded.add(g.aisle);
        const prev = body.querySelector(`[data-aisle="${g.aisle}"]`);
        if (prev && !reducedMotion()) { const r = prev.getBoundingClientRect(); confetti({ emoji: inf.emoji, x: r.left + 40, y: Math.max(40, r.top + 20), count: 18 }); }
      }
      if (all && firstPaint) folded.add(g.aisle);
      if (!all) folded.delete(g.aisle);
      const fold = all && folded.has(g.aisle);
      const head = `<h3 class="gs-aisle"><span aria-hidden="true">${inf.emoji}</span> ${n ? `<span class="muted">${esc(n)} ·</span> ` : ''}${esc(inf.label)} <span class="muted">${g.items.filter((i) => !i.checked).length || '✓'}</span></h3>`;
      if (fold) return `<section class="gs-group folded" data-aisle="${g.aisle}"><details><summary>${head}</summary><div class="gs-rows">${g.items.map(row).join('')}</div></details></section>`;
      return `<section class="gs-group" data-aisle="${g.aisle}">${head}<div class="gs-rows">${g.items.map(row).join('')}</div></section>`;
    }).join('');
    firstPaint = false;
  }
  const row = (i) => {
    const sub = [i.qty ? (/^\d+$/.test(i.qty) ? '×' + i.qty : i.qty) : '', i.note || '', i.need ? 'need ' + i.need : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="gs-row${i.checked ? ' on' : ''}" role="checkbox" aria-checked="${!!i.checked}" data-id="${esc(i.id)}">
      <span class="cbox" aria-hidden="true" aria-checked="${!!i.checked}">${icon.check}</span>
      <span class="gs-e" aria-hidden="true">${esc(G.itemEmoji(i))}</span>
      <span class="gs-t"><b>${esc(i.text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
  };

  body.addEventListener('click', (e) => {
    const r = e.target.closest('.gs-row');
    if (!r) return;
    const l = byId('lists', listId);
    const its = (l.items || []).map((i) => ({ ...i }));
    const x = its.find((i) => i.id === r.dataset.id);
    if (!x) return;
    x.checked = !x.checked;
    r.classList.toggle('on', x.checked);
    r.setAttribute('aria-checked', String(x.checked));
    patchSoon('lists', listId, { items: its, updatedAt: Date.now() }, 300);
    const id = x.id;
    requestAnimationFrame(() => { const n = body.querySelector(`[data-id="${CSS.escape(id)}"]`); if (n) n.focus({ preventScroll: true }); });
  });

  el.querySelector('#gs-done').onclick = async () => {
    const res = await G.finishShopping(listId);
    if (!res.count) return;
    confetti({ emoji: '🛒✨💖', count: 90 });
    fs.close('done');
    toast(`Done shopping! ${res.count} thing${res.count === 1 ? '' : 's'} put away ♡`, { emoji: '🎉', undo: res.undo });
  };

  const off = watch('lists', render);
  render();
}
