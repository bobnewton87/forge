// Browser loader for the Crunch Allen schedule (data/crunch-schedule.json, refreshed daily
// by .github/workflows/crunch-scrape.yml).
// CONTRACT-NOTE: the returned object also carries address/phone/locationUrl/source and an
// `error` string when nothing could be loaded. `date` = today's date if the schedule covers
// it, else the next day present, else the most recent past day. Each class may carry extra
// fields from the scraper (start 'HH:MM', category, room, description, id).
// CONTRACT-NOTE (§24): the file holds PAST days too — the scraper merges instead of overwriting
// and keeps ~90 days back — so a day that has already happened can still be shown and logged.
// `days` keeps every day in the file, ascending; `stale` only means "nothing at or after today".
import { classify } from './classify.js';
import { ds } from '../util.js';

const URL_ = './data/crunch-schedule.json';
let memo = null;

async function fetchJson() {
  try {
    const res = await fetch(URL_ + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) return await res.json();
    throw new Error('HTTP ' + res.status);
  } catch (err) {
    // Offline: fall back to whatever the service worker cached.
    if (typeof caches !== 'undefined') {
      try {
        const hit = await caches.match(URL_, { ignoreSearch: true });
        if (hit) return await hit.json();
      } catch { /* ignore */ }
    }
    try {
      const res = await fetch(URL_);
      if (res.ok) return await res.json();
    } catch { /* ignore */ }
    if (memo) return memo.raw;
    throw err;
  }
}

function toStart(time) {
  const t = time && /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(time);
  if (!t) return null;
  let h = Number(t[1]) % 12;
  if (/pm/i.test(t[3])) h += 12;
  return String(h).padStart(2, '0') + ':' + t[2];
}

export function normalizeSchedule(raw, now = new Date()) {
  const today = ds(now);
  let days = Array.isArray(raw?.days) ? raw.days : [];
  // Radiance-style single-day payload ({date, classes}) is accepted too.
  if (!days.length && raw?.date && Array.isArray(raw.classes)) days = [{ date: raw.date, classes: raw.classes }];
  days = days
    .filter(d => d && d.date && Array.isArray(d.classes))
    .map(d => ({
      ...d,
      classes: d.classes.map(c => {
        const duration = Number(c.duration) || 45;
        return {
          ...c,
          duration,
          start: c.start || toStart(c.time),
          instructor: c.instructor || null,
          classify: c.classify && c.classify.type ? c.classify : classify(c.name, duration),
        };
      }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const newest = days.length ? days[days.length - 1].date : null;
  // The file accumulates history (the scraper merges, CONTRACT §24), so `days` normally starts well
  // before today. `date` = the day to show by default: today, else the next day we have, else the
  // most recent past one. `stale` stays "we have no data at or after today" — a file full of past
  // days is not stale as long as today is in it.
  const upcoming = days.find(d => d.date >= today);
  return {
    club: raw?.club || raw?.location || 'Crunch Allen',
    address: raw?.address || '510 N Watters Rd, Allen, TX 75013',
    phone: raw?.phone || '469.824.3022',
    locationUrl: raw?.locationUrl || 'https://www.crunch.com/locations/allen',
    source: raw?.source || null,
    date: days.some(d => d.date === today) ? today : (upcoming?.date || newest || null),
    fetchedAt: raw?.fetchedAt || raw?.scrapedAt || null,
    stale: !newest || newest < today,
    days,
  };
}

// The classes that were (or are) scheduled on one day, or null when we never fetched it.
// Past days come from the schedule file's history; the picker degrades to the class catalogue
// when this returns null (CONTRACT §24).
export function dayFor(sched, date) {
  return (sched?.days || []).find(d => d.date === date) || null;
}

export async function loadSchedule() {
  try {
    const raw = await fetchJson();
    const out = normalizeSchedule(raw);
    memo = { raw, at: Date.now() };
    return out;
  } catch (err) {
    return { club: 'Crunch Allen', date: null, fetchedAt: null, stale: true, days: [], error: String(err?.message || err) };
  }
}
