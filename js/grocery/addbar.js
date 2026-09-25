// Em&m Blog web: the grocery smart add bar for shopping lists. Typing shows catalog suggestions (emoji, aisle,
// "♡ usual", "on list · 2 ＋1", her own past things "💗 yours", "✏️ as typed"). Enter adds what she typed
// (several at once: "milk, 2 lb chicken"); picking a suggestion keeps her typed amount ("3 avo" -> Avocado ×3).
import { byId } from '../store.js';
import { esc, toast, debounce } from '../ui.js';
import * as G from './core.js';

export function attachAddBar(form, input, listId) {
  const box = document.createElement('div');
  box.className = 'ga-sugs';
  box.id = 'ga-sugs-' + listId;
  box.setAttribute('role', 'listbox');
  box.setAttribute('aria-label', 'Suggestions');
  box.hidden = true;
  form.after(box);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', box.id);
  input.setAttribute('aria-expanded', 'false');
  input.placeholder = 'add something… (try “2 lb chicken, milk”)';
  let sugs = [];
  let active = -1;

  const onListCounts = () => {
    const m = new Map();
    for (const it of (byId('lists', listId)?.items || [])) if (!it.checked) m.set(G.catalog.itemKey(it.text), it.qty || '1');
    return m;
  };
  const hide = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; input.removeAttribute('aria-activedescendant'); };
  const paint = () => {
    box.innerHTML = sugs.map((s, i) => `<button type="button" role="option" id="ga-o-${i}" class="ga-sug${i === active ? ' on' : ''}" aria-selected="${i === active}" data-i="${i}">
      <span class="ga-e" aria-hidden="true">${esc(s.emoji)}</span><span class="ga-n">${esc(s.name)}</span><span class="ga-m">${esc(s.meta)}</span></button>`).join('');
    box.hidden = !sugs.length;
    input.setAttribute('aria-expanded', String(!!sugs.length));
    if (active >= 0) input.setAttribute('aria-activedescendant', 'ga-o-' + active); else input.removeAttribute('aria-activedescendant');
  };
  const suggest = debounce(() => {
    const raw = input.value;
    const last = raw.split(/[,;\n]/).pop().trim();
    if (!last) { sugs = []; hide(); return; }
    const parsed = G.parse.parseGroceryInput(last);
    const q = parsed.name;
    if (!q) { sugs = []; hide(); return; }
    const hist = G.getHistory();
    const on = onListCounts();
    const out = [];
    const seen = new Set();
    for (const h of G.catalog.searchCatalog(q, 6, G.boost)) {
      const it = h.item;
      seen.add(it.id);
      const e = hist[it.id];
      const onQty = on.get(it.id);
      const meta = [G.aisleInfo(it.aisle).short, e && e.n * 3 + e.a >= 3 ? '♡ usual' : '', onQty ? `on list · ${onQty} ＋1` : ''].filter(Boolean).join(' · ');
      out.push({ name: it.name, emoji: it.emoji, meta, qty: parsed.qty, note: parsed.note });
    }
    for (const m of G.hist.historyMatches(hist, q.toLowerCase(), 3)) {
      if (seen.has(m.key) || G.catalog.catalogById(m.key)) continue;
      out.push({ name: m.name, emoji: '💗', meta: 'yours', qty: parsed.qty, note: parsed.note });
    }
    if (!out.some((s) => s.name.toLowerCase() === q.toLowerCase())) out.push({ name: q, emoji: '✏️', meta: 'as typed', qty: parsed.qty, note: parsed.note, typed: true });
    sugs = out.slice(0, 7);
    active = -1;
    paint();
  }, 80);

  const addIncoming = async (incoming) => {
    const r = await G.upsertGroceries(listId, incoming, 'bump');
    const t = G.addToastText(r);
    if (t) toast(t, { duration: 1600 });
  };
  const pick = (s) => {
    // replace the last comma part with the picked suggestion; add the rest as typed
    const parts = input.value.split(/[,;\n]/);
    parts.pop();
    const before = parts.join(',').trim();
    const incoming = before ? G.typedToIncoming(before) : [];
    incoming.push({ name: s.name, qty: s.qty || null, note: s.note || null });
    input.value = '';
    sugs = []; hide();
    addIncoming(incoming);
    input.focus();
  };

  input.addEventListener('input', suggest);
  input.addEventListener('keydown', (e) => {
    if (box.hidden || !sugs.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % sugs.length; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = active <= 0 ? sugs.length - 1 : active - 1; paint(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopPropagation(); pick(sugs[active]); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement)) hide(); }, 150));
  box.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(sugs[+b.dataset.i]); });

  /** Enter with no suggestion highlighted: add everything typed. */
  return function submitTyped() {
    const raw = input.value.trim();
    if (!raw) return;
    input.value = '';
    sugs = []; hide();
    addIncoming(G.typedToIncoming(raw));
    input.focus();
  };
}
