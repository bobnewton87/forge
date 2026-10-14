#!/usr/bin/env node
// Fetches the Crunch Allen group-class schedule and writes data/crunch-schedule.json.
//
// Source (primary): the public JSON endpoint used by crunch.com's own class-schedule
// widget (CrunchClassManager in class-manager-*.js):
//   GET https://www.crunch.com/crunch_core/occurrences?club_id=549
// It is unauthenticated and returns every upcoming class occurrence for the club
// (~6-7 days ahead) in ONE request. Crunch Allen: club id 549 (MMS/ABC id 20235).
//
// Fallback: if that endpoint fails or returns nothing, scrape "Today's Classes" from the
// server-rendered location page (same approach as Radiance's scrape-crunch.js).
//
// Node 20, no npm deps. Usage: node scripts/scrape-crunch.mjs

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../js/classes/classify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'data', 'crunch-schedule.json');

const CLUB_ID = 549;
const LOCATION_URL = 'https://www.crunch.com/locations/allen';
const OCCURRENCES_URL = `https://www.crunch.com/crunch_core/occurrences?club_id=${CLUB_ID}`;
const TZ = 'America/Chicago';
const DAYS_AHEAD = 7;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function get(url, accept, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'locale=en' },
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), accept, maxRedirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} on ${url}`)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}

function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDaysDs(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}
// '14:30' → '2:30 pm' (same display format as the Crunch page / Radiance)
function fmt12(hh, mm) {
  const h = Number(hh);
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
function decodeEntities(s) {
  return String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}
function cleanName(s) { return decodeEntities(s).replace(/\s*®\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function oneLine(s) { return s ? String(s).replace(/\s+/g, ' ').trim() : null; }

// ---------- primary: JSON occurrences ----------
function parseOccurrences(arr) {
  const today = todayLocal();
  const last = addDaysDs(today, DAYS_AHEAD - 1);
  const byDay = new Map();
  for (const o of arr) {
    if (!o || o.cancelled) continue;
    // local_start_time is the club's wall-clock time encoded with a (misleading) 'Z' suffix.
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(o.local_start_time || '');
    if (!m) continue;
    const [, date, hh, mm] = m;
    if (date < today || date > last) continue;
    const name = cleanName(o.name || o.activity_name || 'Class');
    const duration = Number(o.duration) || null;
    const instr = Array.isArray(o.instructors) && o.instructors.length
      ? o.instructors.map(i => i.full_name).filter(Boolean).join(', ') : null;
    const cls = {
      name, time: fmt12(hh, mm), start: `${hh}:${mm}`, duration, instructor: instr,
      category: o.category || null, room: o.room || null,
      description: oneLine(o.description),
      id: o.id ?? null,
      classify: classify(name, duration || 45),
    };
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(cls);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, classes]) => ({ date, classes: classes.sort((a, b) => a.start.localeCompare(b.start)) }));
}

// ---------- fallback: today's classes from the location page HTML ----------
function parseTodayHtml(html) {
  const re = /<li class="list-block__item__link">[\s\S]*?<p class="list-block__item__link__title type--e3 type--white">([^<]+?)<\/p>\s*<p class="type--c5 type--gray-light">\s*([^<]+?)<\/p>/g;
  const classes = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = cleanName(m[1]);
    const parts = decodeEntities(m[2]).split('|').map(p => p.trim());
    const time = parts[0] || null;
    const duration = parseInt((parts[1] || '').match(/\d+/)?.[0] || '', 10) || null;
    let start = null;
    const t = time && /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(time);
    if (t) { let h = Number(t[1]) % 12; if (/pm/i.test(t[3])) h += 12; start = `${String(h).padStart(2, '0')}:${t[2]}`; }
    classes.push({ name, time, start, duration, instructor: parts[2] || null, classify: classify(name, duration || 45) });
  }
  return classes.length ? [{ date: todayLocal(), classes }] : [];
}

async function main() {
  let days = [];
  let source = 'occurrences';
  try {
    const json = JSON.parse(await get(OCCURRENCES_URL, 'application/json'));
    if (!Array.isArray(json)) throw new Error('unexpected occurrences payload');
    days = parseOccurrences(json);
  } catch (err) {
    console.error('Occurrences endpoint failed:', err.message);
  }
  if (!days.length) {
    source = 'location-page';
    try { days = parseTodayHtml(await get(LOCATION_URL, 'text/html,application/xhtml+xml')); }
    catch (err) { console.error('Location page failed:', err.message); }
  }
  const count = days.reduce((s, d) => s + d.classes.length, 0);
  const payload = {
    club: 'Crunch Allen',
    clubId: CLUB_ID,
    address: '510 N Watters Rd, Allen, TX 75013',
    phone: '469.824.3022',
    locationUrl: LOCATION_URL,
    source,
    fetchedAt: new Date().toISOString(),
    days,
  };
  if (count === 0) {
    console.error('ERROR: 0 classes parsed. Crunch endpoint or page structure may have changed. Not overwriting.');
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${OUT}: ${count} classes over ${days.length} day(s) via ${source} (${days.map(d => d.date).join(', ')})`);
}

main().catch((err) => { console.error('Scrape failed:', err.message); process.exit(1); });
