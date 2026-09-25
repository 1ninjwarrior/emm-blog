// Em&m Blog: special-day (countdown) date math. Dates are local 'yyyy-mm-dd' keys.
import { parseKey, daysBetween, MONTHS } from './ui.js';

const pad = (n) => String(n).padStart(2, '0');

/** The same month/day in a given year (Feb 29 -> Feb 28 in normal years). */
function inYear(key, year) {
  const [, m, d] = key.split('-').map((x) => parseInt(x, 10));
  const last = new Date(year, m, 0).getDate();
  return `${year}-${pad(m)}-${pad(Math.min(d, last))}`;
}

/** {next, days, isToday, past, years} for a countdown doc {date, yearly}. */
export function dayStatus(cd, today) {
  if (!cd.yearly) {
    const days = daysBetween(today, cd.date);
    return { next: cd.date, days, isToday: days === 0, past: days < 0, years: null };
  }
  const ty = parseKey(today).getFullYear();
  let next = inYear(cd.date, ty);
  if (daysBetween(today, next) < 0) next = inYear(cd.date, ty + 1);
  const days = daysBetween(today, next);
  const years = parseKey(next).getFullYear() - parseKey(cd.date).getFullYear();
  return { next, days, isToday: days === 0, past: false, years: years > 0 ? years : null };
}

/** Upcoming (soonest first, today on top) and memories (past one-offs, most recent first). */
export function rankDays(list, today) {
  const ranked = list.filter((d) => d && d.date).map((d) => ({ d, st: dayStatus(d, today) }));
  return {
    upcoming: ranked.filter((r) => !r.st.past).sort((a, b) => a.st.days - b.st.days),
    memories: ranked.filter((r) => r.st.past).sort((a, b) => b.st.days - a.st.days),
  };
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "23 days", "tomorrow!", "today!", "5 days ago" */
export function countLabel(st) {
  if (st.isToday) return 'today!';
  if (st.days === 1) return 'tomorrow!';
  if (st.days > 1) return `${st.days} days`;
  const ago = -st.days;
  return ago === 1 ? 'yesterday' : `${ago} days ago`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Sat, Oct 18" (+ year if not this year). */
export function prettyDate(key, today) {
  const d = parseKey(key);
  const same = today ? parseKey(today).getFullYear() === d.getFullYear() : true;
  return `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}${same ? '' : ', ' + d.getFullYear()}`;
}
