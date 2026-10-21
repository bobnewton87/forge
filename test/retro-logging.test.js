// CONTRACT §24: logging a day that has already happened.
// The back-limit, the timestamps, and the promise that a retroactively logged session lands in the
// RIGHT week and the right recency for every reader (recovery, the weekly volume audit, History).
import test from 'node:test';
import assert from 'node:assert/strict';

import { RETRO_DAYS, retroFloor, canLogPast, isPastDate, retroReason, retroTimes, markLogged } from '../js/engine/retro.js';
import { sessionVolume, weekSummary, groupStatus, cardioStatus } from '../js/engine/recovery.js';
import { weekPlanSummary } from '../js/engine/planner.js';
import { classify } from '../js/classes/classify.js';
import { ds, addDays, weekStart, parseDs } from '../js/util.js';

// Bob's case: Wednesday 2026-10-21, logging the Circuit HIIT class he took on Tuesday 2026-10-20.
const NOW = new Date(2026, 9, 21, 7, 30, 0);     // 2026-10-21 07:30 local
const TODAY = '2026-10-21';
const YESTERDAY = '2026-10-20';

function classSession(date, { name = 'Circuit HIIT', duration = 45, time = '5:30 am' } = {}) {
  return markLogged({
    id: 's_' + date + '_' + name, date, status: 'active', startedAt: null, endedAt: null,
    location: 'crunch', minutes: duration, title: name, targets: [], source: 'class',
    blocks: [{ kind: 'class', provider: 'crunch', name, time, duration, instructor: null, classify: classify(name, duration), done: false }],
    rationale: [], notes: '',
  }, { now: NOW });
}
function liftSession(date, { sets = 4, reps = 10, w = 60 } = {}) {
  return markLogged({
    id: 's_lift_' + date, date, status: 'active', startedAt: null, endedAt: null, location: 'home', minutes: 45,
    title: 'Logged upper body', targets: ['chest'], source: 'generated',
    blocks: [{ kind: 'lift', exId: 'db_bench', group: null, target: { sets, repMin: reps, repMax: reps, rest: 90, weight: w, reps, note: null },
      sets: Array.from({ length: sets }, () => ({ w, r: reps, done: true })) }],
    rationale: [], notes: '',
  }, { now: NOW });
}

test('§24 modules import cleanly and the class catalogue is usable for a day we never cached', async () => {
  const pure = await import('../js/engine/retro.js');
  for (const f of ['retroFloor', 'canLogPast', 'retroReason', 'retroTimes', 'markLogged']) assert.equal(typeof pure[f], 'function', f);
  const ui = await import('../js/ui/retro.js');
  for (const f of ['openRetroSheet', 'openRetroClasses', 'openRetroCardio', 'startRetroLog', 'canLogPast']) assert.equal(typeof ui[f], 'function', f);
  await import('../js/ui/classes.js');
  await import('../js/ui/history.js');

  const { CLASS_CATALOGUE } = await import('../js/classes/classify.js');
  assert.ok(CLASS_CATALOGUE.length >= 12);
  const circuit = CLASS_CATALOGUE.find(c => c.name === 'Circuit HIIT');
  assert.ok(circuit, 'Bob\'s class is offerable by name');
  assert.equal(classify(circuit.name, circuit.duration).type, 'hiit');
  for (const c of CLASS_CATALOGUE) {
    assert.equal(typeof c.name, 'string');
    assert.ok(c.duration >= 15 && c.duration <= 90, c.name);
    assert.ok(classify(c.name, c.duration).label, c.name);
  }
});

// ---------------------------------------------------------------- the back limit
test('§24 back limit: today and the last RETRO_DAYS days can be logged, nothing older or future', () => {
  assert.equal(RETRO_DAYS, 60);
  assert.equal(retroFloor(NOW), ds(addDays(NOW, -60)));
  assert.equal(retroFloor(NOW), '2026-08-22');

  assert.equal(canLogPast(TODAY, NOW), true, 'today');
  assert.equal(canLogPast(YESTERDAY, NOW), true, 'yesterday');
  assert.equal(canLogPast(ds(addDays(NOW, -59)), NOW), true, '59 days back');
  assert.equal(canLogPast(retroFloor(NOW), NOW), true, 'exactly the floor');
  assert.equal(canLogPast(ds(addDays(NOW, -61)), NOW), false, '61 days back');
  assert.equal(canLogPast('2026-10-22', NOW), false, 'tomorrow is planning, not logging');
  for (const bad of [null, undefined, '', 'yesterday', '2026-10-7', 42, {}]) assert.equal(canLogPast(bad, NOW), false, String(bad));

  assert.equal(retroReason(TODAY, NOW), null);
  assert.equal(retroReason('2026-12-01', NOW), 'future');
  assert.equal(retroReason('2026-01-01', NOW), 'too-old');
  assert.equal(retroReason('nope', NOW), 'bad-date');

  assert.equal(isPastDate(YESTERDAY, NOW), true);
  assert.equal(isPastDate(TODAY, NOW), false, 'today is not "past"');
});

// ---------------------------------------------------------------- timestamps
test('§24 timestamps: a retro session is stamped on its OWN day, from the class time when known', () => {
  const t = retroTimes(YESTERDAY, { time: '5:30 am', minutes: 45, now: NOW });
  assert.equal(ds(new Date(t.startedAt)), YESTERDAY);
  assert.equal(ds(new Date(t.endedAt)), YESTERDAY);
  assert.equal(new Date(t.startedAt).getHours(), 5);
  assert.equal(new Date(t.startedAt).getMinutes(), 30);
  assert.equal(Math.round((new Date(t.endedAt) - new Date(t.startedAt)) / 60000), 45);

  // 24-hour strings work too (the scraper's `start` field).
  assert.equal(new Date(retroTimes(YESTERDAY, { time: '18:15', now: NOW }).startedAt).getHours(), 18);

  // No idea when: early evening, still on the day.
  const noTime = retroTimes(YESTERDAY, { minutes: 60, now: NOW });
  assert.equal(new Date(noTime.startedAt).getHours(), 18);
  assert.equal(ds(new Date(noTime.endedAt)), YESTERDAY);

  // A late class can't spill into the next day.
  const late = retroTimes(YESTERDAY, { time: '11:15 pm', minutes: 90, now: NOW });
  assert.equal(ds(new Date(late.startedAt)), YESTERDAY);
  assert.equal(ds(new Date(late.endedAt)), YESTERDAY);

  // Today → it just finished.
  const today = retroTimes(TODAY, { minutes: 30, now: NOW });
  assert.equal(new Date(today.endedAt).getTime(), NOW.getTime());
});

test('§24 markLogged: status done, non-lift blocks ticked, lift sets untouched, never a plan', () => {
  const s = classSession(YESTERDAY);
  assert.equal(s.status, 'done');
  assert.equal(s.date, YESTERDAY);
  assert.equal(s.blocks[0].done, true, 'the class is ticked off so it counts (CONTRACT §6)');
  assert.equal(ds(new Date(s.startedAt)), YESTERDAY);
  assert.equal(ds(new Date(s.endedAt)), YESTERDAY);
  assert.ok(!('plan' in s), 'a log is not a plan');

  // Lift sets are never invented: only what the user logged counts.
  const blank = markLogged({ date: YESTERDAY, minutes: 45, blocks: [{ kind: 'lift', exId: 'db_bench', target: { sets: 3 }, sets: [{ w: null, r: null, done: false }] }] }, { now: NOW });
  assert.equal(blank.blocks[0].sets[0].done, false);
  assert.equal(sessionVolume(blank).liftSets, 0);

  // A planned session that is being logged loses its plan tag.
  const wasPlanned = markLogged({ date: YESTERDAY, minutes: 30, status: 'planned', plan: { auto: true, kind: 'cardio' }, blocks: [{ kind: 'cardio', modality: 'run', minutes: 30, intensity: 'easy', done: false }] }, { now: NOW });
  assert.equal(wasPlanned.status, 'done');
  assert.ok(!('plan' in wasPlanned));
  assert.equal(wasPlanned.blocks[0].done, true);
});

// ---------------------------------------------------------------- credit
test('§24 a retro class gets the same credit as one logged live', () => {
  const v = sessionVolume(classSession(YESTERDAY));
  assert.ok(v.cardioMin >= 30, `Circuit HIIT should credit real cardio minutes, got ${v.cardioMin}`);
  assert.ok(Object.keys(v.regions).length > 0, 'and some muscle credit');
  const live = sessionVolume({ ...classSession(TODAY) });
  assert.deepEqual(v.groups, live.groups);
  assert.equal(v.cardioMin, live.cardioMin);
});

// ---------------------------------------------------------------- week attribution
test('§24 a workout logged for last Tuesday counts toward THAT week, not this one', () => {
  // 2026-10-21 is a Wednesday, so last Tuesday (2026-10-13) is in the previous calendar week.
  const lastTue = '2026-10-13';
  assert.notEqual(ds(weekStart(parseDs(lastTue))), ds(weekStart(NOW)), 'fixture: different weeks');
  const s = liftSession(lastTue);
  const profile = { cardioTargetMin: 150 };

  const thisWeek = weekSummary([s], { now: NOW });
  assert.equal(thisWeek.liftSets, 0, 'this week is untouched');
  assert.equal(thisWeek.sessions, 0);

  const thatWeek = weekPlanSummary([s], { weekStart: parseDs(lastTue), profile, now: NOW });
  assert.ok((thatWeek.liftSets.done || 0) >= 4, `last week's coverage counts it: ${JSON.stringify(thatWeek.liftSets)}`);
  assert.equal(thatWeek.sessions.done, 1);

  const nowWeek = weekPlanSummary([s], { weekStart: weekStart(NOW), profile, now: NOW });
  assert.equal(nowWeek.sessions.done, 0, "and this week's coverage does not");

  // Cardio minutes land in the right week too.
  const ride = classSession(lastTue, { name: 'The Ride', duration: 45, time: '9:30 am' });
  assert.ok(weekPlanSummary([ride], { weekStart: parseDs(lastTue), profile, now: NOW }).cardioMinutes.done > 0);
  assert.equal(weekPlanSummary([ride], { weekStart: weekStart(NOW), profile, now: NOW }).cardioMinutes.done, 0);
});

test('§24 recovery sees a retro session on its own day, not as training "today"', () => {
  const s = liftSession(YESTERDAY);
  const gs = groupStatus([s], { now: NOW, profile: {} });
  assert.equal(gs.chest.daysSince, 1, 'yesterday, not 0');
  assert.ok(gs.chest.sets7d >= 4, 'but still inside the rolling 7-day volume');

  const fiveAgo = ds(addDays(NOW, -5));
  assert.equal(groupStatus([liftSession(fiveAgo)], { now: NOW, profile: {} }).chest.daysSince, 5);

  // A retro cardio day sets the cardio recency, again on its own day.
  const cs = cardioStatus([classSession(YESTERDAY)], { now: NOW, profile: { cardioTargetMin: 150 } });
  assert.equal(cs.daysSince, 1);
  assert.ok(cs.minutes7d > 0);
});

test('§24 a retro session is a normal "done" session: History, Body and the projection pick it up', () => {
  const s = classSession(YESTERDAY);
  // The shape every consumer filters on (status/date), plus ordered stamps.
  assert.equal(s.status, 'done');
  assert.ok(new Date(s.endedAt) > new Date(s.startedAt));
  assert.ok(s.date < TODAY);
  // Sorted by date like any other session (store.sortSessions ordering key).
  const sorted = [classSession(TODAY), s].sort((a, b) => a.date.localeCompare(b.date) || String(a.startedAt).localeCompare(String(b.startedAt)));
  assert.equal(sorted[0].date, YESTERDAY);
});
