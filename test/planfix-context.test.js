// PLAN-FIX: bidirectional planning context (planner.contextFor, recovery plan mode, suggestForDay).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../js/store.js';
import { contextFor, simulateDone, planRange, suggestForDay } from '../js/engine/planner.js';
import { recommend, groupStatus, sessionVolume } from '../js/engine/recovery.js';
import { buildWorkout } from '../js/engine/generator.js';
import { DEFAULT_LOCATIONS } from '../js/data/equipment.js';

const NOW = new Date(2026, 9, 19, 6, 0);   // Monday 06:00
const LOC = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.id, l]));
const profile = () => defaultProfile();

function liftDay(date, exIds, sets = 4, plan = { auto: false, kind: 'lift' }) {
  return {
    id: 'p_' + date + exIds.join(''), date, status: 'planned', startedAt: null, endedAt: null, location: 'crunch', minutes: 45,
    title: 'x', targets: [], source: 'manual', rationale: [], notes: '', plan,
    blocks: exIds.map(exId => ({ kind: 'lift', exId, group: null, target: { sets, repMin: 8, repMax: 12, rest: 60, weight: null, reps: 10, note: null },
      sets: Array.from({ length: sets }, () => ({ w: null, r: null, done: false })) })),
  };
}
const shoulderDay = date => liftDay(date, ['db_shoulder', 'db_lateral', 'cable_lateral', 'face_pull']);

test('contextFor splits planned days into before/after (simulated) and keeps real sessions as history', () => {
  const done = { ...liftDay('2026-10-18', ['db_curl']), id: 'd1', status: 'done' };
  done.blocks[0].sets = done.blocks[0].sets.map(() => ({ w: 30, r: 10, done: true }));
  const sessions = [
    done,
    liftDay('2026-10-17', ['db_bench']),                      // missed plan (before today) → ignored
    liftDay('2026-10-19', ['db_bench']),                      // before the date
    liftDay('2026-10-21', ['db_row']),                        // the date itself → ignored
    shoulderDay('2026-10-22'),                                // after
    { ...liftDay('2026-10-23', []), plan: { auto: false, kind: 'rest' } },   // rest → ignored
    liftDay('2026-11-10', ['db_row']),                        // beyond horizon
  ];
  const c = contextFor('2026-10-21', sessions, { now: NOW });
  assert.deepEqual(c.before.map(s => s.date), ['2026-10-19']);
  assert.deepEqual(c.after.map(s => s.date), ['2026-10-22']);
  assert.equal(c.upcoming, c.after);
  assert.ok(c.before.every(s => s.status === 'done') && c.after.every(s => s.status === 'done'), 'simulated as done');
  assert.ok(sessionVolume(c.after[0]).liftSets > 0);
  assert.deepEqual(c.history.map(s => s.date).sort(), ['2026-10-18', '2026-10-19']);
});

test('recovery plan mode: weekly sets include planned days after now, reasons say so', () => {
  const p = profile();
  const thu = simulateDone(shoulderDay('2026-10-22'));
  const now = new Date(2026, 9, 21, 12);
  const plain = groupStatus([], { now, profile: p });
  const planned = groupStatus([], { now, profile: p, upcoming: [thu] });
  assert.equal(plain.shoulders.planned, undefined, 'no plan fields without upcoming');
  assert.ok(planned.shoulders.sets7d > plain.shoulders.sets7d, 'planned sets counted');
  assert.equal(planned.shoulders.planned, planned.shoulders.sets7d);
  assert.ok(planned.shoulders.need < plain.shoulders.need, 'less need once the plan covers it');
  const recs = recommend([], { now, profile: p, minutes: 45, location: LOC.crunch, upcoming: [thu] });
  assert.ok(recs.some(r => r.reasons.some(x => /incl\. planned/.test(x))));
  const recs0 = recommend([], { now, profile: p, minutes: 45, location: LOC.crunch });
  assert.ok(recs0.every(r => r.reasons.every(x => !/incl\. planned/.test(x))), 'unchanged without upcoming');
});

test('a group trained by the next planned day is flagged as a clash and not the top pick', () => {
  const p = profile();
  const thu = simulateDone(shoulderDay('2026-10-22'));
  const wedNoon = new Date(2026, 9, 21, 12);
  const gs = groupStatus([], { now: wedNoon, profile: p, upcoming: [thu] });
  assert.equal(gs.shoulders.aheadDate, '2026-10-22');
  assert.ok(gs.shoulders.aheadReadiness < 0.5, `ahead readiness ${gs.shoulders.aheadReadiness}`);
  assert.equal(gs.chest.aheadReadiness, 1);
  const recs = recommend([], { now: wedNoon, profile: p, minutes: 45, location: LOC.crunch, upcoming: [thu] });
  const top = recs.find(r => !r.recovering);
  assert.ok(top && !top.groups.includes('shoulders'), `top pick ${top && top.label}`);
  const clash = recs.find(r => r.clash);
  if (clash) assert.ok(clash.recovering && clash.reasons[0].includes('planned Thu'));
  // two days ahead is far enough for a 48 h group
  const tue = groupStatus([], { now: new Date(2026, 9, 20, 12), profile: p, upcoming: [thu] });
  assert.ok(tue.shoulders.aheadReadiness >= 0.5);
});

test('suggestForDay sees the planned days AFTER it (no shoulders the day before a shoulder day)', () => {
  const p = profile();
  p.schedule = { ...p.schedule, wed: { kind: 'lift', minutes: 45, location: 'crunch' } };
  const sessions = [shoulderDay('2026-10-22'), liftDay('2026-10-23', ['db_shoulder', 'db_lateral', 'tri_pushdown', 'cable_oh_ext'])];
  for (const seed of [1, 2, 3, 4, 5]) {
    const wed = suggestForDay('2026-10-21', { profile: p, sessions, now: NOW, seed });
    assert.equal(wed.plan.kind, 'lift');
    assert.ok(!wed.plan.groups.includes('shoulders'), `seed ${seed}: ${wed.plan.groups}`);
  }
});

test('planRange builds around user-touched days after a date and never replaces them', () => {
  const p = profile();
  const custom = shoulderDay('2026-10-22');
  const out = planRange({ from: '2026-10-19', days: 7, profile: p, sessions: [custom], now: NOW });
  assert.ok(!out.some(s => s.date === '2026-10-22'), 'custom day kept');
  const wed = out.find(s => s.date === '2026-10-21');   // default schedule: cardio
  const tue = out.find(s => s.date === '2026-10-20');
  assert.ok(wed && tue);
  // Monday/Tuesday lift days know Thursday covers shoulders: weekly shoulder volume isn't stacked the day before
  assert.ok(!(wed.plan.groups || []).includes('shoulders'));
});

// §18.y (2026-10-24): a stored rationale no longer quotes weekly set numbers (they went stale, and they were
// group sums the weekly rows never show); the live per-unit numbers are drawn where the workout is shown.
test('buildWorkout forwards upcoming, and its rationale quotes no weekly set numbers', () => {
  const p = profile();
  const thu = simulateDone(shoulderDay('2026-10-22'));
  const s = buildWorkout({ targets: ['triceps'], minutes: 30, location: LOC.crunch, profile: p, sessions: [], now: new Date(2026, 9, 20, 12), upcoming: [thu], seed: 3 });
  assert.ok(s.rationale.some(r => /^Focus: Triceps/.test(r)), s.rationale.join(' | '));
  assert.ok(!s.rationale.some(r => /target sets|sets this week|\d+\/\d+ /.test(r)), s.rationale.join(' | '));
});
