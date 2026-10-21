// CONTRACT §24: the class schedule accumulates instead of being overwritten, so a past day still
// has its classes. Covers the scraper's pure merge (scripts/scrape-crunch.mjs) and the browser
// loader's view of it (js/classes/crunch.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { mergeDays, buildPayload, compactDay, addDaysDs, KEEP_BACK_DAYS } from '../scripts/scrape-crunch.mjs';
import { normalizeSchedule, dayFor } from '../js/classes/crunch.js';

const TODAY = '2026-10-21';
const NOW = new Date(2026, 9, 21, 7, 30, 0);

const cls = (name, start, duration = 45, extra = {}) => ({
  name, time: start, start, duration, instructor: 'Someone', category: 'Cardio', room: 'Group Fitness',
  description: 'Marketing copy we never show.', id: Math.abs(hash(name + start)), classify: { type: 'hiit', cardioMinutes: 36, intensity: 'intervals', muscles: { quads: 1 }, label: 'HIIT', blurb: 'b' }, ...extra,
});
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
const day = (date, names) => ({ date, classes: names.map(([n, t, d]) => cls(n, t, d)) });

// ---------------------------------------------------------------- the merge
test('§24 merge keeps the days already stored and adds the newly fetched ones', () => {
  const prev = { days: [day('2026-10-18', [['ZUMBA', '09:30', 60]]), day('2026-10-20', [['Superset HIIT (HIITZone)', '18:15']])] };
  const fetched = [day(TODAY, [['CircHIIT (HIITZone)', '05:30']]), day('2026-10-22', [['The Ride', '05:30']])];
  const out = mergeDays(prev.days, fetched, { today: TODAY });
  assert.deepEqual(out.map(d => d.date), ['2026-10-18', '2026-10-20', '2026-10-21', '2026-10-22'], 'old days survive, new days join, ascending');
  assert.equal(out[1].classes[0].name, 'Superset HIIT (HIITZone)', "Tuesday's class is still there the day after");
  assert.equal(out[3].classes[0].name, 'The Ride');
});

test('§24 merge prunes beyond the retention window and nothing inside it', () => {
  const inside = addDaysDs(TODAY, -(KEEP_BACK_DAYS - 1));
  const edge = addDaysDs(TODAY, -KEEP_BACK_DAYS);
  const outside = addDaysDs(TODAY, -(KEEP_BACK_DAYS + 1));
  const prev = { days: [day(outside, [['Old', '09:00']]), day(edge, [['Edge', '09:00']]), day(inside, [['Inside', '09:00']])] };
  const out = mergeDays(prev.days, [day(TODAY, [['Today', '05:30']])], { today: TODAY });
  assert.deepEqual(out.map(d => d.date), [edge, inside, TODAY]);
  assert.equal(KEEP_BACK_DAYS, 90, 'window covers the 60-day retro limit with slack');
  // A tighter window can be asked for.
  assert.deepEqual(mergeDays(prev.days, [], { today: TODAY, keepBack: 2 }).map(d => d.date), []);
});

test('§24 merge is idempotent: same input twice → identical output', () => {
  const prev = { days: [day('2026-10-19', [['Chisel', '08:30', 30]]), day('2026-10-20', [['ZUMBA', '18:30', 60]])] };
  const fetched = [day(TODAY, [['CircHIIT (HIITZone)', '05:30'], ['Chisel', '08:30', 30]]), day('2026-10-23', [['Barbell 45', '16:30']])];
  const once = mergeDays(prev.days, fetched, { today: TODAY });
  const twice = mergeDays(once, fetched, { today: TODAY });
  const thrice = mergeDays(twice, fetched, { today: TODAY });
  assert.equal(JSON.stringify(twice), JSON.stringify(once));
  assert.equal(JSON.stringify(thrice), JSON.stringify(once));

  // And the whole file, which is what the Action commits (fetchedAt is held fixed, as its diff does).
  const p1 = buildPayload({ prev, days: fetched, fetchedAt: 'FIXED', today: TODAY });
  const p2 = buildPayload({ prev: p1, days: fetched, fetchedAt: 'FIXED', today: TODAY });
  assert.equal(JSON.stringify(p2, null, 2), JSON.stringify(p1, null, 2), 'byte-identical file');
});

test('§24 re-fetching today merges rather than truncating (the endpoint drops classes that started)', () => {
  const prev = { days: [day(TODAY, [['CircHIIT (HIITZone)', '05:30'], ['Chisel', '08:30', 30], ['Barbell 45', '16:30']])] };
  // A midday run only sees the evening class.
  const out = mergeDays(prev.days, [day(TODAY, [['Barbell 45', '16:30']])], { today: TODAY });
  assert.deepEqual(out[0].classes.map(c => c.name), ['CircHIIT (HIITZone)', 'Chisel', 'Barbell 45'],
    "this morning's classes are not lost by an afternoon run");
});

test('§24 a fresh fetch is authoritative for future days (moved or cancelled classes disappear)', () => {
  const prev = { days: [day('2026-10-23', [['Barbell 45', '16:30'], ['Cancelled Thing', '18:00']])] };
  const out = mergeDays(prev.days, [day('2026-10-23', [['Barbell 45', '17:30']])], { today: TODAY });
  assert.deepEqual(out[0].classes.map(c => `${c.name}@${c.start}`), ['Barbell 45@17:30']);
});

test('§24 past days are compacted to the fields the app shows, and stay sorted', () => {
  const out = mergeDays([day('2026-10-20', [['ZUMBA', '18:30', 60], ['Superset HIIT (HIITZone)', '06:15']])], [], { today: TODAY });
  assert.deepEqual(Object.keys(out[0].classes[0]), ['name', 'time', 'start', 'duration', 'instructor']);
  assert.deepEqual(out[0].classes.map(c => c.start), ['06:15', '18:30'], 'ascending by start time');
  assert.deepEqual(compactDay(compactDay(out[0])), out[0], 'compacting is idempotent');
  // Today and later keep the full payload (classify, description, room…).
  const full = mergeDays([], [day(TODAY, [['CircHIIT (HIITZone)', '05:30']])], { today: TODAY });
  assert.ok(full[0].classes[0].classify && full[0].classes[0].id != null);
});

test('§24 merge ignores malformed days instead of poisoning the file', () => {
  const out = mergeDays([null, { date: 'nope', classes: [] }, { date: '2026-10-20' }, day('2026-10-20', [['ZUMBA', '18:30', 60]])],
    [undefined, { classes: [] }], { today: TODAY });
  assert.deepEqual(out.map(d => d.date), ['2026-10-20']);
});

// ---------------------------------------------------------------- the loader
test('§24 normalizeSchedule serves a past day and keeps `stale` meaning "nothing at or after today"', () => {
  const raw = { club: 'Crunch Allen', days: [day('2026-08-01', [['Old', '09:00']]), day('2026-10-20', [['Superset HIIT (HIITZone)', '18:15']]), day(TODAY, [['CircHIIT (HIITZone)', '05:30']]), day('2026-10-24', [['The Ride', '09:30']])] };
  const s = normalizeSchedule(raw, NOW);
  assert.equal(s.stale, false, 'a file full of old days is NOT stale while it still covers today');
  assert.equal(s.date, TODAY);
  assert.equal(s.days.length, 4, 'past days are kept, not filtered out');

  const past = dayFor(s, '2026-10-20');
  assert.ok(past, 'the day Bob is asking about is served');
  assert.equal(past.classes[0].name, 'Superset HIIT (HIITZone)');
  assert.ok(past.classes[0].classify && past.classes[0].classify.type, 'classify is recomputed for compacted past days');
  assert.equal(past.classes[0].start, '18:15');
  assert.equal(dayFor(s, '2026-10-19'), null, 'a day we never fetched reports nothing (the picker then offers the catalogue)');

  // Only "no data at or after today" is stale.
  assert.equal(normalizeSchedule({ days: [day('2026-10-19', [['x', '09:00']]), day('2026-10-20', [['y', '09:00']])] }, NOW).stale, true);
  assert.equal(normalizeSchedule({ days: [] }, NOW).stale, true);
  // With nothing upcoming, `date` falls back to the most recent day we have (not the oldest).
  assert.equal(normalizeSchedule({ days: [day('2026-09-01', [['a', '09:00']]), day('2026-10-20', [['b', '09:00']])] }, NOW).date, '2026-10-20');
  // With a gap over today, the next day we do have.
  assert.equal(normalizeSchedule({ days: [day('2026-10-20', [['b', '09:00']]), day('2026-10-24', [['c', '09:00']])] }, NOW).date, '2026-10-24');
});

test('§24 the committed schedule file parses, is sorted and carries its retention window', () => {
  const file = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'data', 'crunch-schedule.json'), 'utf8'));
  assert.ok(Array.isArray(file.days) && file.days.length);
  const dates = file.days.map(d => d.date);
  assert.deepEqual(dates, [...dates].sort(), 'ascending, diff-friendly');
  assert.equal(new Set(dates).size, dates.length, 'one entry per day');
  const s = normalizeSchedule(file, NOW);
  for (const d of s.days) for (const c of d.classes) assert.ok(c.classify && c.classify.type, `${d.date}: ${c.name} has no credit`);
});
