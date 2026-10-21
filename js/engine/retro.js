// Logging a past day — the pure half (CONTRACT §24). DOM-free, so Node tests and any screen can
// use it.
//
// A past date is LOGGING WHAT HAPPENED — never planning. Everything written through these helpers
// is dated to that day and ends up status 'done' (or 'active' while it is still being filled in on
// the Workout screen), with startedAt/endedAt on that same calendar day. Those stamps are what make
// recovery.js (sessionTime), the weekly volume audit (planner.weekPlanSummary), History, the Body
// tab and the projection's history drivers attribute the work to the right day and week instead of
// to today.
//
// How far back: RETRO_DAYS days. 60 is long enough to catch up after a holiday or a few forgotten
// days, and short enough that a mistyped date can't silently rewrite the months of training history
// that progression, the projection and the body model read.
import { ds, parseDs, addDays, norm } from '../util.js';

export const RETRO_DAYS = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Oldest date that may still be logged.
export function retroFloor(now = new Date()) { return ds(addDays(norm(now), -RETRO_DAYS)); }

// Can `date` be logged after the fact? (today counts: "I did it this morning")
export function canLogPast(date, now = new Date()) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  return date <= ds(now) && date >= retroFloor(now);
}
export const isPastDate = (date, now = new Date()) => DATE_RE.test(String(date || '')) && date < ds(now);

// Why a date was refused — for messages and tests.
export function retroReason(date, now = new Date()) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return 'bad-date';
  if (date > ds(now)) return 'future';
  if (date < retroFloor(now)) return 'too-old';
  return null;
}

function hhmm(time) {
  const t = String(time || '');
  let m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) return [Number(m[1]), Number(m[2])];
  m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(t);
  if (m) { let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12; return [h, Number(m[2])]; }
  return null;
}

// When a retroactively logged session happened. Today → ending now; an earlier day → its class time
// if we know it, else 18:00, always clamped so both stamps land on `date` itself.
export function retroTimes(date, { time = null, minutes = 45, now = new Date() } = {}) {
  const mins = Math.max(5, Math.min(300, Math.round(Number(minutes) || 45)));
  if (!DATE_RE.test(String(date || '')) || date === ds(now)) {
    const end = new Date(now);
    return { startedAt: new Date(end.getTime() - mins * 60000).toISOString(), endedAt: end.toISOString() };
  }
  const start = parseDs(date);
  const t = hhmm(time);
  start.setHours(t ? t[0] : 18, t ? t[1] : 0, 0, 0);
  let end = new Date(start.getTime() + mins * 60000);
  if (ds(end) !== date) {   // a late start would spill past midnight: pull it back to end at 23:30
    end = parseDs(date); end.setHours(23, 30, 0, 0);
    return { startedAt: new Date(end.getTime() - mins * 60000).toISOString(), endedAt: end.toISOString() };
  }
  return { startedAt: start.toISOString(), endedAt: end.toISOString() };
}

function blockMinutes(s) {
  let m = 0;
  for (const b of s?.blocks || []) m += b.kind === 'class' ? Number(b.duration) || 0 : b.kind === 'cardio' ? Number(b.minutes) || 0 : 0;
  return m;
}

// Stamp a session as "this happened on s.date": status done, timestamps on that day, non-lift blocks
// ticked off. Lift sets are NOT invented — they only count when the user logged reps (CONTRACT §6).
export function markLogged(session, { now = new Date() } = {}) {
  const s = { ...session };
  const cls = (s.blocks || []).find(b => b.kind === 'class');
  const mins = Number(s.minutes) || blockMinutes(s) || Number(s.estMinutes) || 45;
  const { startedAt, endedAt } = retroTimes(s.date, { time: cls?.time || null, minutes: mins, now });
  s.status = 'done';
  s.startedAt = startedAt;
  s.endedAt = endedAt;
  s.blocks = (s.blocks || []).map(b => (b.kind === 'lift' ? b : { ...b, done: true }));
  delete s.plan;            // it happened; it is not a plan any more
  return s;
}
