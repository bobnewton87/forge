// Shared, DOM-free helpers. Dates are local calendar dates as 'YYYY-MM-DD'.

export function ds(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function parseDs(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function norm(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
// Whole calendar days from a → b (b later = positive). Accepts Date or 'YYYY-MM-DD'.
export function daysBetween(a, b) {
  const A = typeof a === 'string' ? parseDs(a) : norm(a);
  const B = typeof b === 'string' ? parseDs(b) : norm(b);
  return Math.round((B - A) / 864e5);
}
export function weekStart(d = new Date()) { const day = d.getDay(); return norm(addDays(d, day === 0 ? -6 : 1 - day)); }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtShort(d) { if (typeof d === 'string') d = parseDs(d); return MONTHS[d.getMonth()] + ' ' + d.getDate(); }
export function fmtDay(d) { if (typeof d === 'string') d = parseDs(d); return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); }
export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
export function round(x, step = 1) { return Math.round(x / step) * step; }
export function sum(arr, f = x => x) { return arr.reduce((s, x) => s + f(x), 0); }
// Deterministic PRNG (mulberry32) for reproducible variety.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function uid(prefix = 'id') { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
