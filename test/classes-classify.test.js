// CLASSES tests: classifier sanity across real Crunch class names, schedule normalization,
// and the shape of data/crunch-schedule.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classify, REGION_IDS, groupCredits, matchScore } from '../js/classes/classify.js';
import { normalizeSchedule } from '../js/classes/crunch.js';

const TYPES = ['hiit', 'cycle', 'cardio_dance', 'strength', 'sculpt', 'core', 'boxing', 'yoga', 'pilates', 'stretch', 'other'];
const INTENSITIES = ['easy', 'moderate', 'hard', 'intervals'];

// [name, duration, expected type]
const CASES = [
  ['Strong-er HIIT (HIITZone)', 45, 'hiit'],
  ['CircHIIT (HIITZone)', 45, 'hiit'],
  ['ExtremeHIIT (HIITZone)', 45, 'hiit'],
  ['Superset HIIT (HIITZone)', 45, 'hiit'],
  ['HIIT the Deck', 30, 'hiit'],
  ['Tabata', 30, 'hiit'],
  ['The Ride', 45, 'cycle'],
  ['The Ride: Let the Beat Drop', 45, 'cycle'],
  ['Ride 45', 45, 'cycle'],
  ['Spin', 45, 'cycle'],
  ['Fight Club', 45, 'boxing'],
  ['Kickboxing', 45, 'boxing'],
  ['Camp Crunch', 45, 'hiit'],
  ['Bootcamp', 45, 'hiit'],
  ['Belly, Butt, & Thighs Bootcamp', 30, 'sculpt'],
  ['Body Sculpt', 45, 'sculpt'],
  ['Chisel', 30, 'sculpt'],
  ['Top it Off', 30, 'sculpt'],
  ['Top to Bottom Burnout', 30, 'sculpt'],
  ['Cardio Sculpt', 45, 'hiit'],
  ['Barbell 45', 45, 'strength'],
  ['TRX', 45, 'strength'],
  ['Kettlebell Kickstart', 45, 'strength'],
  ['Absolution', 30, 'core'],
  ['Transform it: Core', 30, 'core'],
  ['Abs', 20, 'core'],
  ['Transform it: Cardio', 30, 'hiit'],
  ['Yoga Body Sculpt', 60, 'yoga'],
  ['Chill the Flow Out Yoga', 60, 'yoga'],
  ['Vinyasa Yoga', 60, 'yoga'],
  ['Hot Yoga', 60, 'yoga'],
  ['Anti-Gravity Yoga', 50, 'yoga'],
  ['P3 Pilates', 45, 'pilates'],
  ['Barre', 45, 'pilates'],
  ['ZUMBA ®', 60, 'cardio_dance'],
  ["So You Think You Can't Dance", 60, 'cardio_dance'],
  ['Pound', 45, 'cardio_dance'],
  ['Stretch', 30, 'stretch'],
  ['Foam Roll & Recover', 30, 'stretch'],
  ['Ropes Gone Wild', 30, 'hiit'],
];

test('real Crunch class names map to sane types', () => {
  for (const [name, dur, type] of CASES) {
    const c = classify(name, dur);
    assert.equal(c.type, type, `${name}: expected ${type}, got ${c.type}`);
  }
});

test('ClassInfo shape is valid and uses only real region ids', () => {
  const names = [...CASES.map(c => c[0]), 'Some Random Class', '', 'Peloton Power Zone Ride'];
  for (const name of names) {
    for (const dur of [20, 30, 45, 60, 90]) {
      const c = classify(name, dur);
      assert.ok(TYPES.includes(c.type), `${name}: bad type ${c.type}`);
      assert.ok(INTENSITIES.includes(c.intensity), `${name}: bad intensity`);
      assert.equal(typeof c.label, 'string');
      assert.equal(typeof c.blurb, 'string');
      assert.ok(c.blurb.length > 10, `${name}: blurb`);
      assert.ok(Number.isFinite(c.cardioMinutes) && c.cardioMinutes >= 0 && c.cardioMinutes <= dur, `${name}: cardio ${c.cardioMinutes}`);
      for (const [r, v] of Object.entries(c.muscles)) {
        assert.ok(REGION_IDS.includes(r), `${name}: bad region ${r}`);
        assert.ok(v > 0 && v <= 6, `${name}: ${r}=${v} out of range`);
      }
    }
  }
});

test('region ids match js/data/muscles.js when it is populated', async () => {
  const { REGIONS } = await import('../js/data/muscles.js');
  if (!REGIONS || Object.keys(REGIONS).length === 0) return; // stub
  for (const r of REGION_IDS) assert.ok(REGIONS[r], `REGION_IDS has ${r} not in REGIONS`);
});

test('credits are conservative and directionally right', () => {
  const sculpt = classify('Body Sculpt', 45);
  for (const r of ['chest_mid', 'lats', 'delt_side', 'quads', 'glutes', 'abs']) {
    assert.ok(sculpt.muscles[r] >= 1.5 && sculpt.muscles[r] <= 3, `sculpt ${r}=${sculpt.muscles[r]}`);
  }
  const abs = classify('Absolution', 30);
  assert.ok(abs.muscles.abs >= 4 && abs.muscles.abs <= 6);
  assert.ok(abs.muscles.obliques >= 2);
  const ride = classify('The Ride', 45);
  assert.ok(ride.muscles.quads > 0 && ride.muscles.quads <= 1.5);
  assert.ok(!ride.muscles.chest_mid);
  assert.ok(ride.cardioMinutes >= 35);
  const hiit = classify('ExtremeHIIT (HIITZone)', 45);
  assert.ok(hiit.cardioMinutes >= 30 && hiit.cardioMinutes <= 40);
  assert.equal(hiit.intensity, 'intervals');
  const yoga = classify('Chill the Flow Out Yoga', 60);
  assert.ok(yoga.cardioMinutes <= 10);
  assert.deepEqual(classify('Stretch', 30).muscles, {});
  // Upper-body class gives more triceps/side-delt credit than spin, but less than a real lift day (~6+).
  const top = groupCredits(classify('Top it Off', 30).muscles);
  assert.ok(top.triceps >= 2 && top.triceps <= 4);
  assert.ok(top.shoulders >= 2 && top.shoulders <= 4);
  // Longer class → more credit, but capped.
  assert.ok(classify('Body Sculpt', 60).muscles.chest_mid > classify('Body Sculpt', 30).muscles.chest_mid);
  assert.ok(classify('Body Sculpt', 180).muscles.chest_mid <= 3);
});

test('modifiers add focus credit (Ride + Abs)', () => {
  const plain = classify('The Ride', 45);
  const abs = classify('Ride + Abs', 45);
  assert.equal(abs.type, 'cycle');
  assert.ok((abs.muscles.abs || 0) > (plain.muscles.abs || 0));
});

test('matchScore respects time and targets', () => {
  const top = { name: 'Top it Off', duration: 30 };
  assert.ok(matchScore(top, { minutes: 45, targets: ['triceps'] }).good);
  assert.ok(matchScore(top, { minutes: 45, targets: ['shoulder_width'] }).good);
  assert.ok(!matchScore(top, { minutes: 20, targets: ['triceps'] }).good);
  assert.ok(!matchScore({ name: 'The Ride', duration: 45 }, { minutes: 60, targets: ['chest'] }).good);
  assert.ok(matchScore({ name: 'The Ride', duration: 45 }, { minutes: 60, targets: ['cardio'] }).good);
});

test('normalizeSchedule: stale flag, re-classify, radiance shape', () => {
  const now = new Date(2026, 9, 10, 8, 0);
  const s = normalizeSchedule({ club: 'Crunch Allen', fetchedAt: 'x', days: [
    { date: '2026-10-11', classes: [{ name: 'The Ride', time: '6:00 pm', duration: 45, instructor: null }] },
    { date: '2026-10-10', classes: [{ name: 'Absolution', time: '9:30 am', duration: 30 }] },
  ] }, now);
  assert.equal(s.stale, false);
  assert.equal(s.date, '2026-10-10');
  assert.equal(s.days[0].date, '2026-10-10');
  assert.equal(s.days[0].classes[0].classify.type, 'core');
  assert.equal(s.days[1].classes[0].start, '18:00');
  const old = normalizeSchedule({ days: [{ date: '2026-10-01', classes: [] }] }, now);
  assert.equal(old.stale, true);
  const rad = normalizeSchedule({ location: 'Crunch Allen', date: '2026-10-10', classes: [{ name: 'Zumba', time: '9:30 am', duration: 60 }] }, now);
  assert.equal(rad.days.length, 1);
  assert.equal(rad.days[0].classes[0].classify.type, 'cardio_dance');
  assert.equal(normalizeSchedule(null, now).stale, true);
});

test('data/crunch-schedule.json has the contract shape', () => {
  const j = JSON.parse(fs.readFileSync(new URL('../data/crunch-schedule.json', import.meta.url), 'utf8'));
  assert.equal(typeof j.club, 'string');
  assert.ok(Array.isArray(j.days));
  // §24: the file accumulates history, and a day that has already happened is COMPACTED by
  // scripts/scrape-crunch.mjs down to name/time/start/duration/instructor — `classify` is dropped on
  // purpose and recomputed by normalizeSchedule() on load. So the shape is asserted after
  // normalization (which is what the app actually reads), not on the raw rows.
  const sched = normalizeSchedule(j, new Date());
  assert.ok(sched.days.length);
  for (const d of sched.days) {
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const c of d.classes) {
      assert.equal(typeof c.name, 'string');
      assert.ok(c.classify && TYPES.includes(c.classify.type), `${d.date} ${c.name}: ${JSON.stringify(c.classify)}`);
      for (const r of Object.keys(c.classify.muscles)) assert.ok(REGION_IDS.includes(r));
    }
  }
  // Every day at or after today still carries its own classify in the file (only past days are
  // compacted). `today` is the LOCAL calendar day, the same one the scraper and the app use.
  const n = new Date();
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  for (const d of j.days.filter(x => x.date >= today)) {
    for (const c of d.classes) assert.ok(c.classify && TYPES.includes(c.classify.type), `${d.date} ${c.name} lost its classify`);
  }
});

test('class picker renders without a DOM', async () => {
  const { renderClassPicker } = await import('../js/ui/classes.js');
  const { ds, addDays } = await import('../js/util.js');
  const html = renderClassPicker({}, { date: ds(addDays(new Date(), 2)), minutes: 45, targets: ['triceps'] });
  assert.match(html, /cls-picker/);
  assert.match(html, /Log a different class/);
  // §24: a past date puts the picker in logging mode, with the class catalogue always available.
  const retro = renderClassPicker({}, { date: ds(addDays(new Date(), -1)), minutes: 45, targets: [] });
  assert.match(retro, /Which class did you do\?/);
  assert.match(retro, /Log a class by name/);
  assert.match(retro, /data-cls-cat="Circuit HIIT"/);
});
