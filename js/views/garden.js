// Em&m Blog: Habit Garden (web port of the app's src/features/garden). A garden that grows while habits are kept up
// and droops (never disappears) when they're not. Growth/health are never stored: growth.simulate replays each
// habit's waterings, so edits, restores and date changes always agree.
//
// habits        {title, emoji, species, schedule, reminder, sort, createdAt, archived, revivedCount}
// habitChecks   id `${habitId}|${date}`  {habitId, date, createdAt}   one doc = that day was watered
// gardenUnlocks id = reward key          {unlockedAt}                  stored the first time it's earned
//
// Exports: openGarden({plant, habit}) (overlay route #garden) and mountGardenInToday(container) (Today tab).
import { watch, items, byId, add, set, update, remove, batch, loaded, on, prefs } from '../store.js';
import { esc, sheet, fullscreen, confirmDlg, toast, confetti, icon, ic, todayKey } from '../ui.js';
import {
  SPECIES, SPECIES_INFO, STAGE_LABEL, MOOD_LABEL, WEATHER_LABEL, REVIVE_AFTER,
  cleanSchedule, describeSchedule, simulate, summarize, dotHistory, isSpecies,
} from '../app/garden/growth.js';
import { REWARDS, DECO_INFO, earnedRewards, rewardOf, unlockedSpecies, unlockedDecos, speciesReward } from '../app/garden/rewards.js';
import { habitMeta, wateredLine, streakText } from '../app/garden/copy.js';
import { keyOfTime } from '../app/today/recurrence.js';

const COLLS = ['habits', 'habitChecks', 'gardenUnlocks'];
const isDark = () => document.documentElement.getAttribute('data-emm') === 'dark';

// ---------------------------------------------------------------- the garden model

let memo = { h: null, c: null, u: null, today: '', g: null };

/** The whole garden for today (memoized on the collections' identity + the day). */
function garden(today = todayKey()) {
  const H = items('habits'), C = items('habitChecks'), U = items('gardenUnlocks');
  if (memo.g && memo.h === H && memo.c === C && memo.u === U && memo.today === today) return memo.g;
  const checksBy = new Map();
  for (const c of C) {
    let s = checksBy.get(c.habitId);
    if (!s) checksBy.set(c.habitId, (s = new Set()));
    s.add(c.date);
  }
  const all = [...H]
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map((habit) => {
      const like = { id: habit.id, createdDay: keyOfTime(habit.createdAt || Date.now()), schedule: cleanSchedule(habit.schedule), checks: checksBy.get(habit.id) || new Set() };
      return { habit, like, plant: simulate(like, today), species: isSpecies(habit.species) ? habit.species : 'tulip' };
    });
  const active = all.filter((x) => !x.habit.archived);
  const unlocked = new Set(U.map((u) => u.id));
  const g = {
    today, all, active,
    archived: all.filter((x) => x.habit.archived),
    summary: summarize(active.map((x) => x.like), today),
    unlocked,
    species: unlockedSpecies(unlocked),
    decos: unlockedDecos(unlocked),
  };
  memo = { h: H, c: C, u: U, today, g };
  return g;
}

const ready3 = () => Promise.all(COLLS.map((c) => loaded(c)));

// ---------------------------------------------------------------- writes

const claimed = new Set();
/** Store every reward earned by now; returns the new ones. Also caches revivals for the 💚 badge. */
async function checkRewards() {
  await ready3();
  const g = garden();
  for (const x of g.all) if (x.plant.revived > (x.habit.revivedCount || 0)) update('habits', x.habit.id, { revivedCount: x.plant.revived });
  const keys = earnedRewards({
    plants: g.all.map((x) => x.plant),
    planted: g.all.length,
    bestGardenStreak: summarize(g.all.map((x) => x.like), g.today).bestStreak,
    storedRevives: g.all.reduce((a, x) => a + (x.habit.revivedCount || 0), 0),
  });
  const fresh = keys.filter((k) => !byId('gardenUnlocks', k) && !claimed.has(k));
  if (!fresh.length) return [];
  fresh.forEach((k) => claimed.add(k));
  const now = Date.now();
  await batch(fresh.map((k) => ({ c: 'gardenUnlocks', id: k, d: { unlockedAt: now } })));
  return fresh.map(rewardOf).filter(Boolean);
}

function celebrate(rewards) {
  rewards.forEach((r, i) => setTimeout(() => {
    const emoji = r.deco ? DECO_INFO[r.deco].emoji : '🌸';
    confetti({ emoji: emoji + '🌸✨🌿', count: 46 });
    toast(`${r.toast} ♡`, { emoji, duration: 3200 });
  }, i * 2600));
}

/** Water (or un-water) a habit for a day, then celebrate anything it earned. */
export async function waterHabit(id, on, date = todayKey()) {
  const key = `${id}|${date}`;
  if (on) {
    if (byId('habitChecks', key)) return;
    await set('habitChecks', key, { habitId: id, date, createdAt: Date.now() });
    celebrate(await checkRewards());
  } else {
    if (!byId('habitChecks', key)) return;
    await remove('habitChecks', key);
  }
}

async function deleteHabit(id) {
  const ops = [{ c: 'habits', id, d: null }];
  for (const c of items('habitChecks')) if (c.habitId === id) ops.push({ c: 'habitChecks', id: c.id, d: null });
  await batch(ops);
}

// ---------------------------------------------------------------- art

const POT = '#E59A6C', POT_RIM = '#F0AE82', POT_SHADE = '#D4845A', SOIL = '#7A5241', LEAF = '#8CC56E', LEAF_DARK = '#6FAE55';
const DRY = '#B9A36A', DRY_DARK = '#A08A55', FACE = '#5A3A2E', CHEEK = '#F4A3A8';

/** Little vector pot (seed / sprout / leaves, and drooping seedlings), viewBox 100×100 like the paintings. */
function vectorPlant(shape, droop = false, faded = false) {
  const leaf = droop ? DRY : LEAF, leafDark = droop ? DRY_DARK : LEAF_DARK;
  let plant = '';
  if (shape === 'seed') plant = `<ellipse cx="50" cy="61" rx="7" ry="5" fill="${droop ? DRY_DARK : '#C99A5B'}"/>${droop ? '' : `<path d="M50 57 C50 52 52 49 55 48 C54 52 52 55 50 57 Z" fill="${LEAF}"/>`}`;
  else if (shape === 'sprout') plant = `<g${droop ? ' transform="rotate(18 50 62)"' : ''}><path d="M50 62 C50 54 50 48 50 42" stroke="${leafDark}" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="${droop ? 'M50 45 C43 45 37 49 35 56 C42 56 48 52 50 45 Z' : 'M50 44 C44 36 36 35 31 38 C35 45 43 47 50 44 Z'}" fill="${leaf}"/>
    <path d="${droop ? 'M50 45 C57 45 63 49 65 56 C58 56 52 52 50 45 Z' : 'M50 44 C56 35 64 33 69 36 C66 44 57 47 50 44 Z'}" fill="${leafDark}"/></g>`;
  else plant = `<g${droop ? ' transform="rotate(12 50 62)"' : ''}><path d="M50 62 C50 50 50 38 50 24" stroke="${leafDark}" stroke-width="3.2" stroke-linecap="round" fill="none"/>
    <path d="M50 50 C42 43 32 43 26 47 C31 55 42 55 50 50 Z" fill="${leaf}"/><path d="M50 46 C58 38 68 38 74 42 C70 50 58 51 50 46 Z" fill="${leafDark}"/>
    <path d="M50 34 C44 27 37 26 32 29 C35 36 43 37 50 34 Z" fill="${leafDark}"/><path d="M50 30 C55 23 62 21 67 24 C64 31 57 33 50 30 Z" fill="${leaf}"/>
    <ellipse cx="50" cy="22" rx="4" ry="5" fill="${leaf}"/></g>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"${faded ? ' opacity=".72"' : ''}>${plant}
    <path d="M30 66 L70 66 L65 94 C64.5 96.5 62.5 98 60 98 L40 98 C37.5 98 35.5 96.5 35 94 Z" fill="${POT}"/>
    <path d="M62 66 L70 66 L65 94 C64.5 96.5 62.5 98 60 98 L58 98 Z" fill="${POT_SHADE}" opacity=".55"/>
    <path d="M27 60 C27 58.3 28.3 57 30 57 L70 57 C71.7 57 73 58.3 73 60 L73 65 C73 66.7 71.7 68 70 68 L30 68 C28.3 68 27 66.7 27 65 Z" fill="${POT_RIM}"/>
    <ellipse cx="50" cy="58.5" rx="20" ry="2.6" fill="${SOIL}"/>
    <circle cx="43" cy="80" r="2.2" fill="${FACE}"/><circle cx="57" cy="80" r="2.2" fill="${FACE}"/>
    <path d="${droop ? 'M46.5 87 C48.5 85 51.5 85 53.5 87' : 'M46.5 85 C48.5 87.5 51.5 87.5 53.5 85'}" stroke="${FACE}" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <ellipse cx="38.5" cy="84.5" rx="3" ry="1.8" fill="${CHEEK}" opacity=".8"/><ellipse cx="61.5" cy="84.5" rx="3" ry="1.8" fill="${CHEEK}" opacity=".8"/></svg>`;
}

/**
 * What a plant looks like. Only the blooms (+ tulip wilted) are painted, so, like the app's art.ts:
 * seed/sprout/leaves = vector pots; bud = bloom × .84; full = bloom × 1.06 + ✨; wilted/dried = tulip's painting for
 * tulips, otherwise the species' own bloom drooped + faded (CSS); seedlings that struggle = a drooping vector sprout.
 */
function artOf(species, stage, mood) {
  const struggling = mood === 'wilted' || mood === 'dried';
  const early = stage === 'seed' || stage === 'sprout' || stage === 'leaves';
  if (struggling && (stage === 'seed' || stage === 'sprout')) return { kind: 'vector', shape: stage, droop: true, faded: mood === 'dried', scale: 0.92 };
  if (struggling && species === 'tulip') return { kind: 'img', src: 'img/garden/tulip-wilted.png', scale: 1, cls: mood === 'dried' ? 'dried' : '' };
  if (struggling) return { kind: 'img', src: `img/garden/${species}-bloom.png`, scale: early ? 0.7 : 0.94, cls: mood === 'dried' ? 'droop dried' : 'droop' };
  if (early) return { kind: 'vector', shape: stage, droop: false, faded: false, scale: 0.92 };
  if (stage === 'bud') return { kind: 'img', src: `img/garden/${species}-bloom.png`, scale: 0.84, cls: 'bud' };
  return { kind: 'img', src: `img/garden/${species}-bloom.png`, scale: stage === 'full' ? 1.06 : 1, cls: '', sparkle: stage === 'full' };
}

function artHTML(a, alt = '') {
  if (a.kind === 'vector') return vectorPlant(a.shape, a.droop, a.faded);
  return `<img src="${a.src}" alt="${esc(alt)}" class="gp-img ${a.cls || ''}" draggable="false" decoding="async">${a.sparkle ? '<span class="gp-sparkle" aria-hidden="true">✨</span>' : ''}`;
}

/** A plant picture at a fixed pixel size (sheets, pickers, rows). */
export function plantPic(species, stage, mood, size, alt = '') {
  const a = artOf(species, stage, mood);
  return `<span class="gpic" style="width:${size}px;height:${size}px"><span class="gpic-in" style="transform:scale(${a.scale})">${artHTML(a, alt)}</span></span>`;
}

// ---------------------------------------------------------------- the scene

const GROUND = 0.56;
const SKY = {
  light: { sunny: ['#BFE2FF', '#FFEAF2'], partly: ['#CCDFF3', '#FBEAF0'], cloudy: ['#D6DCE6', '#F2E8EE'], rain: ['#B7C2D2', '#E4DEE8'] },
  dark: { sunny: ['#2F2B55', '#533A5C'], partly: ['#2C2B48', '#46344F'], cloudy: ['#2A2B3A', '#3C3344'], rain: ['#222839', '#352F40'] },
};
const GRASS = { light: ['#C9E8A9', '#A9D68A'], dark: ['#4C6B4F', '#3A5540'] };
const SOILC = { light: '#D9A77E', dark: '#6B4B3E' };
const PLACES = {
  fence: { x: 0.5, bottom: GROUND + 0.02, size: 0.96 },
  birdhouse: { x: 0.08, bottom: GROUND + 0.1, size: 0.14 },
  gnome: { x: 0.93, bottom: GROUND + 0.16, size: 0.1 },
  'stepping-stones': { x: 0.5, bottom: 1.0, size: 0.3 },
  mushroom: { x: 0.17, bottom: 0.99, size: 0.075 },
  'watering-can': { x: 0.075, bottom: 0.985, size: 0.13 },
  bunny: { x: 0.92, bottom: 0.975, size: 0.12 },
  butterfly: { x: 0.22, bottom: 0.36, size: 0.075 },
  bee: { x: 0.74, bottom: 0.44, size: 0.06 },
  'fairy-lights': { x: 0.5, bottom: 0.2, size: 1 },
};
const BACK_DECOS = ['fairy-lights', 'fence', 'birdhouse', 'gnome', 'stepping-stones'];

/** Plants in 1–3 staggered rows with a gentle arc (the app's layoutPlants). Units: W=1, H=ratio. */
function layoutPlants(n, W, H) {
  if (!n) return [];
  const rows = n <= 4 ? 1 : n <= 9 ? 2 : 3;
  const perRow = Math.ceil(n / rows);
  let back = Math.floor(n / 2);
  if (back % 2 === 1 && (n - back) % 2 === 1) back -= 1;
  const bases = rows === 1 ? [0.9] : rows === 2 ? [0.74, 0.93] : [0.68, 0.81, 0.94];
  const out = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const inRow = r === rows - 1 ? n - i : rows === 2 ? back : Math.min(perRow, n - i);
    const scale = rows === 1 ? 1 : 0.8 + (0.2 * r) / (rows - 1);
    const left = 0.14, span = 1 - left * 2;
    const size = Math.min((W * 0.72) / (Math.max(inRow, 2) - 0.1), H * (rows === 1 ? 0.58 : 0.4)) * scale;
    for (let k = 0; k < inRow; k++) {
      const front = r === rows - 1;
      const t = front ? (inRow === 1 ? 0.5 : k / (inRow - 1)) : (k + 0.5) / inRow;
      const arc = Math.sin(Math.PI * t) * H * 0.035;
      out.push({ x: W * (left + span * t), base: H * bases[r] - arc, size, row: r });
      i++;
    }
  }
  return out;
}

function skyHTML(weather, dark) {
  const parts = [];
  if (dark) {
    parts.push('<span class="gs-moon"></span>');
    const stars = [[8, 10], [18, 22], [30, 8], [44, 16], [58, 6], [70, 20], [84, 12], [92, 28], [36, 30], [62, 34]];
    parts.push(stars.map(([x, y], i) => `<i class="gs-star" style="left:${x}%;top:${y}%;animation-delay:${(i * 0.7) % 4}s"></i>`).join(''));
  } else if (weather === 'sunny' || weather === 'partly') {
    parts.push('<span class="gs-sun"></span>');
    if (weather === 'sunny') parts.push([[20, 18], [46, 10], [66, 26], [34, 34]].map(([x, y], i) => `<i class="gs-spark" style="left:${x}%;top:${y}%;animation-delay:${i * 1.3}s">✦</i>`).join(''));
  }
  if (weather !== 'sunny') {
    const n = weather === 'partly' ? 2 : 3;
    const cls = weather === 'rain' ? 'gs-cloud rain' : 'gs-cloud';
    for (let i = 0; i < n; i++) parts.push(`<span class="${cls}" style="left:${[8, 52, 30][i]}%;top:${[10, 6, 22][i]}%;--s:${[1, 0.8, 0.65][i]};animation-delay:${-i * 9}s"></span>`);
  }
  if (weather === 'rain') {
    parts.push('<span class="gs-rain">' + Array.from({ length: 16 }, (_, i) => `<i style="left:${4 + i * 6}%;animation-delay:${(i * 0.37) % 1.2}s"></i>`).join('') + '</span>');
  }
  return parts.join('');
}

function decoHTML(d, dark) {
  const p = PLACES[d];
  const style = `left:${(p.x * 100).toFixed(1)}%;bottom:${((1 - p.bottom) * 100).toFixed(1)}%;width:${(p.size * 100).toFixed(1)}%`;
  if (d === 'fence') {
    const posts = Array.from({ length: 13 }, (_, i) => `<rect x="${i * 8 + 1}" y="2" width="4.5" height="16" rx="2" fill="${dark ? '#8B6F5E' : '#E9CFB5'}"/>`).join('');
    return `<span class="gdeco fence" style="${style}"><svg viewBox="0 0 104 20" preserveAspectRatio="none"><rect x="0" y="6" width="104" height="2.6" rx="1.3" fill="${dark ? '#7A5F50' : '#DDBB9A'}"/><rect x="0" y="12.5" width="104" height="2.6" rx="1.3" fill="${dark ? '#7A5F50' : '#DDBB9A'}"/>${posts}</svg></span>`;
  }
  if (d === 'fairy-lights') {
    const colors = ['#FFE08A', '#FFB4CF', '#B8E3FF', '#C9F2B8'];
    const dots = Array.from({ length: 11 }, (_, i) => { const x = 4 + i * 9.2, y = 5 + Math.sin((i / 10) * Math.PI) * 9; return `${dark ? `<circle cx="${x}" cy="${y}" r="3" fill="${colors[i % 4]}" opacity=".3"/>` : ''}<circle cx="${x}" cy="${y}" r="1.6" fill="${colors[i % 4]}"/>`; }).join('');
    return `<span class="gdeco lights" style="${style}"><svg viewBox="0 0 100 20" preserveAspectRatio="none"><path d="M0 3 Q50 26 100 3" stroke="${dark ? '#8F8AA8' : '#B7A79B'}" stroke-width=".7" fill="none"/>${dots}</svg></span>`;
  }
  if (d === 'stepping-stones') {
    return `<span class="gdeco stones" style="${style}"><svg viewBox="0 0 60 24"><ellipse cx="14" cy="18" rx="10" ry="4.5" fill="${dark ? '#8C8795' : '#D9D2CC'}"/><ellipse cx="32" cy="12" rx="8" ry="3.6" fill="${dark ? '#827D8C' : '#E2DBD5'}"/><ellipse cx="47" cy="7" rx="6.5" ry="3" fill="${dark ? '#7A7584' : '#E8E2DC'}"/></svg></span>`;
  }
  return `<span class="gdeco emo ${d}" style="${style}" title="${esc(DECO_INFO[d].name)}">${DECO_INFO[d].emoji}</span>`;
}

const RATIO = 0.78;

/** The garden scene (HTML/CSS/SVG). Plants are buttons when interactive. */
function sceneHTML(g, { interactive = true } = {}) {
  const dark = isDark();
  const mode = dark ? 'dark' : 'light';
  const w = g.summary.weather;
  const [s0, s1] = SKY[mode][w];
  const slots = layoutPlants(g.active.length, 1, RATIO);
  const decos = new Set(g.decos);
  const G = GRASS[mode];
  const ground = `<svg class="gs-ground" viewBox="0 0 100 ${RATIO * 100}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="gs-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${G[0]}"/><stop offset="1" stop-color="${G[1]}"/></linearGradient></defs>
    <path d="M0 ${RATIO * 100 * (GROUND + 0.05)} Q 50 ${RATIO * 100 * (GROUND - 0.07)} 100 ${RATIO * 100 * (GROUND + 0.05)} L 100 ${RATIO * 100} L 0 ${RATIO * 100} Z" fill="url(#gs-grass)"/>
    <ellipse cx="50" cy="${RATIO * 100 * 0.97}" rx="46" ry="${RATIO * 100 * 0.13}" fill="${SOILC[mode]}" opacity=".35"/>
    ${[6, 30, 55, 80, 95].map((f) => `<path d="M${f} ${RATIO * 100 * (GROUND + 0.1)} l.6 -2.2 l.4 2.2 l.6 -2.8 l.4 2.8" stroke="${G[1]}" stroke-width=".35" fill="none"/>`).join('')}</svg>`;
  const plants = g.active.map((x, i) => {
    const sl = slots[i];
    const p = x.plant;
    const a = artOf(x.species, p.stage, p.mood);
    const grown = 0.84 + 0.16 * p.growth;
    const drawn = sl.size * a.scale * grown;
    const healthy = p.mood === 'thriving' || p.mood === 'ok';
    const cls = `gp${healthy ? ' sway' : ''}${p.mood === 'thirsty' ? ' thirsty' : ''}`;
    const label = `${x.habit.title}: ${STAGE_LABEL[p.stage]}, ${MOOD_LABEL[p.mood]}`;
    const tag = interactive ? 'button type="button"' : 'span';
    const end = interactive ? 'button' : 'span';
    const badge = p.revived > 0 || (x.habit.revivedCount || 0) > 0 ? '<span class="gp-badge" aria-hidden="true">💚</span>' : '';
    return `<${tag} class="${cls}" data-plant="${esc(x.habit.id)}" aria-label="${esc(label)}" style="left:${((sl.x - drawn / 2) * 100).toFixed(2)}%;bottom:${((1 - sl.base / RATIO) * 100).toFixed(2)}%;width:${(drawn * 100).toFixed(2)}%;z-index:${10 + sl.row};--d:${((i * 430) % 1500) / 1000}s;--t:${2.6 + (i % 3) * 0.3}s">
      <span class="gp-body">${artHTML(a)}</span>${badge}</${end}>`;
  }).join('');
  const back = BACK_DECOS.filter((d) => decos.has(d)).map((d) => decoHTML(d, dark)).join('');
  const front = [...decos].filter((d) => !BACK_DECOS.includes(d)).map((d) => decoHTML(d, dark)).join('');
  return `<div class="gscene ${mode} w-${w}" style="--s0:${s0};--s1:${s1}" role="img" aria-label="Your garden: ${esc(g.active.length ? `${g.active.length} plant${g.active.length === 1 ? '' : 's'}, ${WEATHER_LABEL[w]}` : 'empty, waiting for a first habit')}">
    <div class="gs-sky" aria-hidden="true">${skyHTML(w, dark)}</div>${ground}${back}
    <div class="gs-plants">${plants}</div>${front}</div>`;
}

// ---------------------------------------------------------------- water drop

const DROP_D = 'M12 1.5 C12 1.5 3 12 3 18.5 C3 23.5 7 27.5 12 27.5 C17 27.5 21 23.5 21 18.5 C21 12 12 1.5 12 1.5 Z';
const dropHTML = (id, watered, title, big) => `<button type="button" class="gdrop${big ? ' big' : ''}" data-water="${esc(id)}" aria-pressed="${watered}" aria-label="${esc(watered ? `${title}: watered today. Tap to undo` : `Water ${title}`)}">
  <svg viewBox="0 0 24 29" aria-hidden="true"><path class="ring" d="${DROP_D}"/><path class="fill" d="${DROP_D}"/><ellipse class="shine" cx="8.6" cy="18.5" rx="2.2" ry="3.4"/></svg></button>`;

function habitRowHTML(x, big = true) {
  const h = x.habit;
  return `<div class="grow-row${big ? ' big' : ''}" data-key="${esc(h.id)}">
    <button type="button" class="grow-main" data-open="${esc(h.id)}">
      ${h.emoji ? `<span class="grow-emoji" aria-hidden="true">${esc(h.emoji)}</span>` : ''}
      <span class="grow-txt"><b>${esc(h.title)}</b><span>${esc(habitMeta(x.plant, x.like.schedule))}</span></span>
    </button>${dropHTML(h.id, x.plant.doneToday, h.title, big)}</div>`;
}

/** Tap on a drop: optimistic pop, then write. */
function onDropClick(btn, afterOn) {
  const id = btn.dataset.water;
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.remove('pop'); void btn.offsetWidth; if (on) btn.classList.add('pop');
  setTimeout(() => {
    waterHabit(id, on).catch((e) => { console.error(e); toast('Couldn’t save that. Try again?'); });
    if (on && afterOn) afterOn(id);
  }, 160);
}

// ---------------------------------------------------------------- the garden overlay

let ui = null; // {fs, body, perk}

export async function openGarden({ plant = false, habit = null } = {}) {
  if (!ui) {
    const fs = fullscreen({ className: 'route garden-fs', label: 'Your garden', onClose: async () => { offs.forEach((f) => f()); ui = null; (await import('../main.js')).resetHash(); } });
    fs.el.innerHTML = `<div class="gd-scroll"><div class="gd-wrap">
      <header class="gd-head">
        <button type="button" class="icon-btn" data-a="close" aria-label="Close">${icon.close}</button>
        <div class="gd-title"><h1>Your garden</h1><p id="gd-sub"></p></div>
        <button type="button" class="icon-btn soft" data-a="treasures" aria-label="Garden treasures">${icon.sparkle}</button>
      </header>
      <div class="gd-scene" id="gd-scene"></div>
      <button type="button" class="gd-caption" data-a="treasures" id="gd-caption"></button>
      <div id="gd-body"></div>
    </div></div>`;
    ui = { fs, perk: null, today: todayKey() };
    const offs = COLLS.map((c) => watch(c, () => schedule()));
    offs.push(on('prefs', (k) => { if (k === 'mode' || k === 'accent') schedule(); }));
    fs.el.addEventListener('click', onGardenClick);
    await ready3();
    render();
    setTimeout(() => checkRewards().then(celebrate).catch(() => {}), 600);
  }
  if (plant) { history.replaceState(null, '', '#garden'); openEditor(null); }
  else if (habit) { history.replaceState(null, '', '#garden'); await ready3(); if (byId('habits', habit)) openPlant(habit); }
}

let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

function render() {
  if (!ui) return;
  const el = ui.fs.el;
  const g = garden();
  const s = g.summary;
  el.querySelector('#gd-sub').textContent = g.active.length ? `${wateredLine(s.due, s.done)} · ${WEATHER_LABEL[s.weather]}` : 'Every habit grows a flower';
  el.querySelector('#gd-scene').innerHTML = sceneHTML(g);
  const cap = el.querySelector('#gd-caption');
  cap.hidden = !g.active.length;
  cap.textContent = [s.streak > 0 ? `${s.streak}-day garden streak` : null, `${g.unlocked.size} treasure${g.unlocked.size === 1 ? '' : 's'} found`].filter(Boolean).join(' · ');
  const due = g.active.filter((x) => x.plant.dueToday);
  const rest = g.active.filter((x) => !x.plant.dueToday);
  let html = '';
  if (!g.active.length) {
    html = `<div class="empty gd-empty"><img src="img/garden/tulip-bloom.png" alt="" width="120" height="120"><h2>Plant your first habit</h2>
      <p>Water it each day and watch it grow. Miss a few and it gets thirsty — it always forgives you ♡</p>
      <button type="button" class="btn" data-a="plant">Plant a habit</button></div>`;
  } else {
    html += `<h2 class="label-quiet">${due.length ? 'Water today' : 'Nothing to water today ♡'}</h2><div class="grow-list">${due.map((x) => habitRowHTML(x)).join('')}</div>`;
    if (rest.length) html += `<h2 class="label-quiet">Resting today</h2><div class="gd-resting">${rest.map((x) => `<button type="button" class="gd-rest" data-open="${esc(x.habit.id)}"><b>${esc((x.habit.emoji ? x.habit.emoji + ' ' : '') + x.habit.title)}</b>${streakText(x.plant) ? `<span>${esc(streakText(x.plant))}</span>` : ''}</button>`).join('')}</div>`;
    html += `<button type="button" class="btn block gd-plant" data-a="plant">${ic('plus', 18)} Plant a habit</button>`;
  }
  if (g.archived.length) html += `<button type="button" class="btn ghost small gd-shed" data-a="shed">🪴 ${g.archived.length} resting in the shed</button>`;
  el.querySelector('#gd-body').innerHTML = html;
  if (ui.perk) {
    const n = el.querySelector(`.gp[data-plant="${CSS.escape(ui.perk)}"]`);
    ui.perk = null;
    if (n) { n.classList.add('perk'); setTimeout(() => n.classList.remove('perk'), 1300); }
  }
}

function perkPlant(id) {
  if (!ui) return;
  ui.perk = id;
  const n = ui.fs.el.querySelector(`.gp[data-plant="${CSS.escape(id)}"]`);
  if (n) { n.classList.add('perk'); setTimeout(() => n.classList.remove('perk'), 1300); }
}

function onGardenClick(e) {
  const t = e.target;
  const drop = t.closest('[data-water]');
  if (drop) { onDropClick(drop, perkPlant); return; }
  const p = t.closest('[data-plant]');
  if (p) { openPlant(p.dataset.plant); return; }
  const o = t.closest('[data-open]');
  if (o) { openPlant(o.dataset.open); return; }
  const a = t.closest('[data-a]');
  if (!a) return;
  const act = a.dataset.a;
  if (act === 'close') ui.fs.close('x');
  else if (act === 'treasures') openTreasures();
  else if (act === 'plant') openEditor(null);
  else if (act === 'shed') openShed();
}

// ---------------------------------------------------------------- plant sheet

function openPlant(id) {
  const find = () => garden().all.find((x) => x.habit.id === id);
  if (!find()) return;
  const s = sheet({ title: '', className: 'gsheet', body: '<div class="gps"></div>' });
  const draw = () => {
    const x = find();
    if (!x) { s.close('gone'); return; }
    const h = x.habit, p = x.plant, g = garden();
    s.setTitle(`${h.emoji ? h.emoji + ' ' : ''}${h.title}`);
    const status = p.dried ? (p.reviving ? `Reviving · ${REVIVE_AFTER - p.reviving} more waterings` : 'Dried up · water it 3 days in a row to revive') : `${STAGE_LABEL[p.stage]} · ${MOOD_LABEL[p.mood]}`;
    const streak = streakText(p);
    const best = p.bestStreak > p.streak ? `best ${p.bestStreak}` : null;
    const dots = dotHistory(x.like, g.today, 30).filter((d) => d.dot !== 'none');
    s.body.querySelector('.gps').innerHTML = `
      <div class="gps-top">${plantPic(x.species, p.stage, p.mood, 112, SPECIES_INFO[x.species].name)}
        <div class="gps-info"><b>${esc(status)}</b>
          <span>${esc(SPECIES_INFO[x.species].name)} · ${esc(describeSchedule(x.like.schedule))}</span>
          ${x.like.schedule.k === 'weekly' ? `<span>${p.weekDone} of ${p.weekNeed} this week</span>` : ''}
          <span>${esc([streak || 'No streak yet', best].filter(Boolean).join(' · '))}</span>
          ${p.revived > 0 || (h.revivedCount || 0) > 0 ? '<span>💚 came back from dried</span>' : ''}</div></div>
      <h3 class="label-quiet">Last 30 days</h3>
      <div class="gdots" role="img" aria-label="${dots.filter((d) => d.dot === 'done').length} waterings in the last 30 days">${dots.map((d) => `<i class="${d.dot}" title="${d.date}"></i>`).join('')}</div>
      ${!h.archived
        ? `<button type="button" class="btn block ${p.doneToday ? 'soft' : ''}" data-p="water" aria-label="${p.doneToday ? 'Watered today. Tap to undo' : 'Water it'}">${p.doneToday ? 'Watered today ✓' : 'Water it 💧'}</button>`
        : '<button type="button" class="btn block" data-p="unrest">Bring it back 🌱</button>'}
      <div class="gps-row"><button type="button" class="btn soft small" data-p="edit">${ic('edit', 16)} Edit</button>
        ${!h.archived ? '<button type="button" class="btn soft small" data-p="rest">🪴 Rest it</button>' : `<button type="button" class="btn ghost small" data-p="delete">${ic('trash', 16)} Delete</button>`}</div>`;
  };
  draw();
  const offs = COLLS.map((c) => watch(c, () => requestAnimationFrame(draw)));
  s.closed.then(() => offs.forEach((f) => f()));
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const x = find();
    if (!x) return;
    const h = x.habit;
    const act = b.dataset.p;
    if (act === 'water') {
      const on = !x.plant.doneToday;
      s.close('water');
      await waterHabit(h.id, on);
      if (on) perkPlant(h.id);
    } else if (act === 'edit') { s.close('edit'); setTimeout(() => openEditor(h.id), 220); }
    else if (act === 'unrest') { await update('habits', h.id, { archived: false }); toast('Back in the garden ♡', { emoji: '🌱' }); s.close('ok'); }
    else if (act === 'rest') {
      const ok = await confirmDlg({ title: `Rest “${h.title}”?`, message: 'Its plant moves to the shed with all its history. You can bring it back any time.', confirmLabel: 'Move to the shed', emoji: '🪴' });
      if (!ok) return;
      await update('habits', h.id, { archived: true });
      toast('Resting in the shed ♡', { emoji: '🪴' });
      s.close('ok');
    } else if (act === 'delete') {
      const ok = await confirmDlg({ title: `Delete “${h.title}”?`, message: 'The plant and every watering are gone for good.', confirmLabel: 'Delete', emoji: '🗑️', destructive: true });
      if (!ok) return;
      s.close('ok');
      await deleteHabit(h.id);
      toast('Deleted', { emoji: '🍂' });
    }
  });
}

// ---------------------------------------------------------------- plant / edit a habit

export const PRESETS = [
  { title: 'Drink water', emoji: '💧', schedule: { k: 'daily' } },
  { title: 'Take vitamins', emoji: '💊', schedule: { k: 'daily' } },
  { title: 'Skincare', emoji: '🧴', schedule: { k: 'daily' } },
  { title: 'Walk', emoji: '🚶‍♀️', schedule: { k: 'weekly', times: 4 } },
  { title: 'Read', emoji: '📖', schedule: { k: 'daily' } },
  { title: 'Stretch', emoji: '🧘‍♀️', schedule: { k: 'daily' } },
  { title: 'Journal', emoji: '📓', schedule: { k: 'daily' } },
  { title: 'Tidy 10 min', emoji: '🧹', schedule: { k: 'daily' } },
  { title: 'Floss', emoji: '🦷', schedule: { k: 'daily' } },
  { title: 'No phone in bed', emoji: '📵', schedule: { k: 'daily' } },
];
const EMOJIS = ['🌷', '💧', '💊', '🧴', '🚶‍♀️', '📖', '🧘‍♀️', '📓', '🧹', '🦷', '📵', '🍎', '😴', '💪', '🎨', '💌'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEK_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REMINDERS = [{ label: 'None', value: null }, { label: 'Morning', value: '08:00' }, { label: 'Midday', value: '12:30' }, { label: 'Evening', value: '20:00' }];

function scheduleOf(d) {
  return cleanSchedule(d.kind === 'days' ? { k: 'days', days: d.days } : d.kind === 'weekly' ? { k: 'weekly', times: d.times } : { k: 'daily' });
}
function fromSchedule(d, s) {
  if (s.k === 'days') return { ...d, kind: 'days', days: [...s.days] };
  if (s.k === 'weekly') return { ...d, kind: 'weekly', times: s.times };
  return { ...d, kind: 'daily' };
}

async function openEditor(habitId) {
  await ready3();
  const g = garden();
  const species = g.species;
  const blank = () => ({ title: '', emoji: '🌷', species: species[0] || 'tulip', kind: 'daily', days: [1, 2, 3, 4, 5], times: 3, reminder: null });
  const h = habitId ? byId('habits', habitId) : null;
  let d = h ? fromSchedule({ ...blank(), title: h.title, emoji: h.emoji || null, species: isSpecies(h.species) ? h.species : 'tulip', reminder: h.reminder || null }, cleanSchedule(h.schedule)) : blank();
  let step = h ? 'form' : 'pick';
  const s = sheet({ title: h ? 'Edit habit' : 'Plant a habit', className: 'gsheet', body: '<div class="ged"></div>' });
  const box = s.body.querySelector('.ged');

  const drawPick = () => {
    s.setTitle('Plant a habit');
    box.innerHTML = `<p class="muted-line gd-lead">Pick one to start, or make your own. Every habit grows a little flower ♡</p>
      <div class="ged-presets">${PRESETS.map((p, i) => `<button type="button" class="ged-preset" data-preset="${i}"><span aria-hidden="true">${p.emoji}</span>${esc(p.title)}</button>`).join('')}</div>
      <button type="button" class="btn soft block" data-preset="own">${ic('edit', 16)} My own habit</button>`;
  };
  const drawForm = () => {
    s.setTitle(h ? 'Edit habit' : 'Your new habit');
    const emojis = [...new Set([d.emoji, ...EMOJIS].filter(Boolean))];
    box.innerHTML = `<div class="field"><label class="lbl" for="ged-name">Name</label>
        <input class="txt" id="ged-name" maxlength="60" placeholder="e.g. Drink water" value="${esc(d.title)}" autocomplete="off" ${d.title ? '' : 'autofocus'}></div>
      <h3 class="label-quiet">Emoji</h3>
      <div class="ged-emojis" role="group" aria-label="Emoji">${emojis.map((e) => `<button type="button" data-emoji="${esc(e)}" aria-pressed="${d.emoji === e}" aria-label="Emoji ${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <h3 class="label-quiet">Flower</h3>
      <div class="ged-flowers" role="group" aria-label="Flower">${SPECIES.map((sp) => {
        const open = species.includes(sp);
        return `<button type="button" class="ged-flower${open ? '' : ' locked'}" data-species="${sp}" aria-pressed="${d.species === sp}" aria-label="${esc(SPECIES_INFO[sp].name + (open ? '' : ', locked'))}">
          ${plantPic(sp, 'bloom', 'thriving', 58)}<span>${open ? '' : '🔒 '}${esc(SPECIES_INFO[sp].name)}</span></button>`;
      }).join('')}</div>
      <h3 class="label-quiet">How often</h3>
      <div class="seg ged-kind" role="group" aria-label="How often">${[['daily', 'Every day'], ['days', 'Some days'], ['weekly', 'Times a week']].map(([k, l]) => `<button type="button" data-kind="${k}" aria-pressed="${d.kind === k}">${l}</button>`).join('')}</div>
      ${d.kind === 'days' ? `<div class="ged-days" role="group" aria-label="Days">${WEEK.map((w) => `<button type="button" data-day="${w}" aria-pressed="${d.days.includes(w)}" aria-label="${WEEK_NAME[w]}">${WEEK_LETTER[w]}</button>`).join('')}</div>` : ''}
      ${d.kind === 'weekly' ? `<div class="ged-times"><span class="stepper"><button type="button" data-times="-1" aria-label="Fewer">${ic('minus', 16)}</button><b>${d.times}×</b><button type="button" data-times="1" aria-label="More">${ic('plus', 16)}</button></span><span class="muted-line">times a week · any days that week</span></div>` : ''}
      <h3 class="label-quiet">Reminder</h3>
      <div class="chips">${REMINDERS.map((r, i) => `<button type="button" class="chip" data-rem="${i}" aria-pressed="${d.reminder === r.value}">${r.label}</button>`).join('')}</div>
      <p class="muted-line">Saved for later — gentle reminders are coming soon.</p>
      <button type="button" class="btn block" data-save="1">${h ? 'Save' : 'Plant it 🌱'}</button>
      ${h ? '' : `<button type="button" class="btn ghost small" data-back="1">${ic('back', 16)} Back</button>`}`;
    const inp = box.querySelector('#ged-name');
    inp.addEventListener('input', () => { d.title = inp.value; });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    if (!d.title) setTimeout(() => inp.focus(), 60);
  };
  const draw = () => (step === 'pick' ? drawPick() : drawForm());

  const save = async () => {
    const title = d.title.trim();
    if (!title) { toast('Give it a name ♡', { emoji: '✏️' }); return; }
    const fields = { title, emoji: d.emoji, species: d.species, schedule: scheduleOf(d), reminder: d.reminder };
    if (h) {
      await update('habits', h.id, fields);
      toast('Saved ♡', { emoji: SPECIES_INFO[d.species].emoji });
      s.close('saved');
      return;
    }
    const sort = items('habits').reduce((m, x) => Math.max(m, x.sort ?? 0), 0) + 1;
    s.close('saved');
    await add('habits', { ...fields, sort, createdAt: Date.now(), archived: false, revivedCount: 0 });
    setTimeout(async () => {
      confetti({ emoji: '🌱🌸✨🌿', count: 50 });
      toast(`Planted “${title}” ♡`, { emoji: '🌱' });
      celebrate(await checkRewards());
    }, 260);
  };

  box.addEventListener('click', (e) => {
    const t = e.target;
    const pre = t.closest('[data-preset]');
    if (pre) {
      const p = pre.dataset.preset === 'own' ? null : PRESETS[+pre.dataset.preset];
      const base = { ...blank(), species: d.species };
      d = p ? fromSchedule({ ...base, title: p.title, emoji: p.emoji }, p.schedule) : base;
      step = 'form'; draw(); return;
    }
    const keepName = () => { const i = box.querySelector('#ged-name'); if (i) d.title = i.value; };
    const em = t.closest('[data-emoji]');
    if (em) { keepName(); d.emoji = em.dataset.emoji; box.querySelectorAll('[data-emoji]').forEach((b) => b.setAttribute('aria-pressed', String(b === em))); return; }
    const sp = t.closest('[data-species]');
    if (sp) {
      const k = sp.dataset.species;
      if (!species.includes(k)) { toast(`Unlock it: ${(speciesReward(k)?.hint || 'keep watering').toLowerCase()} ♡`, { emoji: SPECIES_INFO[k].emoji }); return; }
      d.species = k; box.querySelectorAll('[data-species]').forEach((b) => b.setAttribute('aria-pressed', String(b === sp))); return;
    }
    const kd = t.closest('[data-kind]');
    if (kd) { keepName(); d.kind = kd.dataset.kind; drawForm(); box.querySelector(`[data-kind="${d.kind}"]`)?.focus(); return; }
    const dy = t.closest('[data-day]');
    if (dy) { const w = +dy.dataset.day; d.days = d.days.includes(w) ? d.days.filter((x) => x !== w) : [...d.days, w]; dy.setAttribute('aria-pressed', String(d.days.includes(w))); return; }
    const tm = t.closest('[data-times]');
    if (tm) { d.times = Math.max(1, Math.min(6, d.times + +tm.dataset.times)); tm.parentElement.querySelector('b').textContent = `${d.times}×`; return; }
    const rm = t.closest('[data-rem]');
    if (rm) { d.reminder = REMINDERS[+rm.dataset.rem].value; box.querySelectorAll('[data-rem]').forEach((b) => b.setAttribute('aria-pressed', String(b === rm))); return; }
    if (t.closest('[data-save]')) { keepName(); save(); return; }
    if (t.closest('[data-back]')) { step = 'pick'; draw(); }
  });
  draw();
}

// ---------------------------------------------------------------- treasures + shed

function openTreasures() {
  const g = garden();
  const s = g.summary;
  sheet({
    title: 'Garden treasures',
    className: 'gsheet',
    body: `<p class="muted-line">${esc([s.streak > 0 ? `${s.streak}-day garden streak` : 'No garden streak yet', s.bestStreak > s.streak ? `best ${s.bestStreak}` : null].filter(Boolean).join(' · '))}</p>
      <div class="gtre">${REWARDS.map((r) => {
        const got = g.unlocked.has(r.key);
        const emoji = r.deco ? DECO_INFO[r.deco].emoji : '🌸';
        const name = [r.deco ? DECO_INFO[r.deco].name : null, r.species ? SPECIES_INFO[r.species].name : null].filter(Boolean).join(' + ');
        return `<div class="gtre-row${got ? ' got' : ''}"><span class="gtre-e" aria-hidden="true">${got ? emoji : '🔒'}</span>
          <span class="gtre-t"><b>${esc(name)}</b><span>${got ? 'Found ✓' : esc(r.hint)}</span></span>
          ${r.species ? plantPic(r.species, 'bloom', 'thriving', 40) : ''}</div>`;
      }).join('')}</div>`,
  });
}

function openShed() {
  const g = garden();
  const s = sheet({
    title: 'The shed',
    className: 'gsheet',
    body: `<p class="muted-line">Resting plants keep their history. Bring one back any time.</p>
      <div class="gd-shedlist">${g.archived.map((x) => `<button type="button" class="gd-rest block" data-shed="${esc(x.habit.id)}">${plantPic(x.species, x.plant.stage, x.plant.mood, 34)}<b>${esc((x.habit.emoji ? x.habit.emoji + ' ' : '') + x.habit.title)}</b></button>`).join('')}</div>`,
  });
  s.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shed]');
    if (!b) return;
    s.close('pick');
    setTimeout(() => openPlant(b.dataset.shed), 220);
  });
}

// ---------------------------------------------------------------- Today tab: compact row + Habits section

/**
 * Renders into `container` (and keeps it live): "Your garden · 3 of 5 watered · sunny ✨" (→ #garden) and a
 * collapsible "Habits" section with today's due habits and their water drops. Returns an unmount function.
 */
export function mountGardenInToday(container) {
  container.classList.add('gtoday');
  let raf2 = 0;
  const draw = () => {
    raf2 = 0;
    if (!COLLS.every((c) => items(c) !== undefined)) return;
    const g = garden();
    const s = g.summary;
    const hero = g.active[0];
    const line = g.active.length ? `${wateredLine(s.due, s.done)} · ${WEATHER_LABEL[s.weather]}` : 'Every habit grows a little flower';
    const due = g.active.filter((x) => x.plant.dueToday);
    const open = prefs.get('today-habits', 'open') !== 'closed';
    const doneN = due.filter((x) => x.plant.doneToday).length;
    container.innerHTML = `<a class="gt-row" href="#garden" aria-label="${esc(g.active.length ? `Your garden: ${line}` : 'Grow a habit garden')}">
        ${hero ? plantPic(hero.species, hero.plant.stage, hero.plant.mood, 40) : plantPic('tulip', 'bloom', 'thriving', 40)}
        <span class="gt-txt"><b>${g.active.length ? 'Your garden' : 'Grow a habit garden'}</b><span>${esc(line)}</span></span>
        <span class="gt-go" aria-hidden="true">${ic('next', 16)}</span></a>
      ${due.length ? `<button type="button" class="label-quiet gt-toggle" aria-expanded="${open}" data-toggle="1">Habits <span class="muted-line">${doneN} of ${due.length}</span><span class="grow"></span>${ic(open ? 'up' : 'down', 16)}</button>
        ${open ? `<div class="grow-list compact">${due.map((x) => `<div class="grow-row" data-key="${esc(x.habit.id)}">
          <a class="grow-main" href="#garden?habit=${encodeURIComponent(x.habit.id)}">${x.habit.emoji ? `<span class="grow-emoji" aria-hidden="true">${esc(x.habit.emoji)}</span>` : ''}
            <span class="grow-txt"><b>${esc(x.habit.title)}</b><span>${esc(habitMeta(x.plant, x.like.schedule))}</span></span></a>
          ${dropHTML(x.habit.id, x.plant.doneToday, x.habit.title, false)}</div>`).join('')}</div>` : ''}` : ''}`;
  };
  const sched = () => { if (!raf2) raf2 = requestAnimationFrame(draw); };
  const onClick = (e) => {
    const drop = e.target.closest('[data-water]');
    if (drop) { e.preventDefault(); onDropClick(drop); return; }
    if (e.target.closest('[data-toggle]')) { prefs.set('today-habits', prefs.get('today-habits', 'open') === 'closed' ? 'open' : 'closed'); draw(); }
  };
  container.addEventListener('click', onClick);
  const offs = COLLS.map((c) => watch(c, sched));
  // a new day: re-plan at the next visibility change
  const onVis = () => { if (document.visibilityState === 'visible') sched(); };
  document.addEventListener('visibilitychange', onVis);
  ready3().then(sched);
  return () => { offs.forEach((f) => f()); container.removeEventListener('click', onClick); document.removeEventListener('visibilitychange', onVis); };
}

/** For Home/other summaries: {plants, due, done, weather}. */
export function gardenSummary() {
  const g = garden();
  return { plants: g.active.length, due: g.summary.due, done: g.summary.done, weather: g.summary.weather };
}
