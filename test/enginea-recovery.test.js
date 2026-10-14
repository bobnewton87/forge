import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeByRegion, muscleStatus, groupStatus, recommend, cardioStatus, weekSummary, streak } from '../js/engine/recovery.js';
import { REGIONS, GROUPS } from '../js/data/muscles.js';
import { SCULPT_GOALS } from '../js/data/sculpt.js';
import { getEx } from '../js/data/exercises.js';
import { lift, cardio, klass, sess, at } from './enginea-helpers.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const groupOf = r => REGIONS[r].group;
const primaryGroup = exId => { const m = getEx(exId).muscles; return groupOf(Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]); };
const noProfile = { groupPriority: {}, sculptGoals: [], cardioTargetMin: 120 };

test('volumeByRegion counts only done sets with reps, weighted by muscles', () => {
  const s = sess('2026-10-05', [lift('db_bench', [[50, 10], [50, 9], [50, 0], [50, 8, false], [null, null, false]])]);
  const v = volumeByRegion([s]);
  for (const [r, w] of Object.entries(getEx('db_bench').muscles)) close(v[r], 2 * w);
});

test('volumeByRegion: class credit when done, date window respected', () => {
  const sessions = [
    sess('2026-10-01', [klass({ abs: 2, quads: 1.5 }, 30)]),
    sess('2026-10-02', [klass({ abs: 5 }, 30, false)]),
    sess('2026-10-09', [lift('db_curl', [[25, 10]])]),
  ];
  const v = volumeByRegion(sessions, { from: '2026-10-01', to: '2026-10-05' });
  close(v.abs, 2); close(v.quads, 1.5);
  assert.equal(Object.keys(v).some(r => getEx('db_curl').muscles[r] && !['abs', 'quads'].includes(r)), false);
});

test('muscleStatus: sets7d is rolling 7 days, lastTrained/daysSince', () => {
  const now = at('2026-10-10', 18);
  const sessions = [
    sess('2026-10-03', [lift('db_lateral', [[20, 15], [20, 15], [20, 15]])]), // outside (8 days incl today? 10-3 = 7 days ago)
    sess('2026-10-05', [lift('db_lateral', [[20, 15], [20, 15]])]),
    sess('2026-10-12', [lift('db_lateral', [[20, 15]])]),  // future: ignored
  ];
  const m = muscleStatus(sessions, { now, profile: noProfile });
  close(m.delt_side.sets7d, 2 * getEx('db_lateral').muscles.delt_side);
  assert.equal(m.delt_side.lastTrained, '2026-10-05');
  assert.equal(m.delt_side.daysSince, 5);
  assert.equal(m.calves.lastTrained, null);
  assert.equal(m.calves.daysSince, null);
  for (const r of Object.values(m)) { assert.ok(r.readiness >= 0 && r.readiness <= 1); assert.ok(r.need >= 0 && r.need <= 1); }
});

test('targets scale with groupPriority and sculpt goals', () => {
  const base = muscleStatus([], { profile: noProfile });
  for (const r of Object.keys(REGIONS)) close(base[r].target.min, Math.round(REGIONS[r].weeklySets.min * 10) / 10, 0.051);
  const goalId = Object.keys(SCULPT_GOALS).find(g => SCULPT_GOALS[g].extraWeeklySets > 0);
  const goal = SCULPT_GOALS[goalId];
  const p = { groupPriority: { triceps: 1.5 }, sculptGoals: [goalId] };
  const m = muscleStatus([], { profile: p });
  const regs = Object.entries(goal.regions).filter(([r, w]) => REGIONS[r] && w > 0);
  const tot = regs.reduce((s, [, w]) => s + w, 0);
  for (const [r, w] of regs) {
    const gp = groupOf(r) === 'triceps' ? 1.5 : 1;
    close(m[r].target.min, REGIONS[r].weeklySets.min * gp + goal.extraWeeklySets * w / tot, 0.051);
  }
  close(m.triceps_lateral.target.min, REGIONS.triceps_lateral.weeklySets.min * 1.5 + (goal.regions.triceps_lateral ? goal.extraWeeklySets * goal.regions.triceps_lateral / tot : 0), 0.051);
});

test('readiness: big session takes longer to recover than a small touch', () => {
  const big = [sess('2026-10-09', [lift('db_lateral', Array(8).fill([20, 15]))], { endedAt: at('2026-10-09', 18).toISOString() })];
  const small = [sess('2026-10-09', [lift('db_lateral', [[20, 15], [20, 15]])], { endedAt: at('2026-10-09', 18).toISOString() })];
  const now = at('2026-10-10', 12); // 18h later
  const rb = muscleStatus(big, { now, profile: noProfile }).delt_side.readiness;
  const rs = muscleStatus(small, { now, profile: noProfile }).delt_side.readiness;
  assert.ok(rb < 0.5, 'big session still fatigued: ' + rb);
  assert.ok(rs > rb + 0.25, `small ${rs} > big ${rb}`);
  const later = muscleStatus(big, { now: at('2026-10-13', 12), profile: noProfile }).delt_side.readiness;
  assert.equal(later, 1);
  // Readiness rises monotonically over time
  let prev = -1;
  for (let h = 19; h <= 120; h += 6) { const d = new Date(at('2026-10-09', 0).getTime() + h * 3600e3); const r = muscleStatus(big, { now: d, profile: noProfile }).delt_side.readiness; assert.ok(r >= prev); prev = r; }
});

test('need: stale and behind ranks higher than recently hit and on target', () => {
  const now = at('2026-10-10', 18);
  const t = REGIONS.delt_side.weeklySets.min;
  const sets = Math.ceil(t / getEx('db_lateral').muscles.delt_side) + 1;
  const m = muscleStatus([sess('2026-10-08', [lift('db_lateral', Array(sets).fill([20, 15]))])], { now, profile: noProfile });
  assert.ok(m.delt_side.need < m.calves.need, `${m.delt_side.need} < ${m.calves.need}`);
  const g = groupStatus([], { now, profile: { groupPriority: { triceps: 1.5, calves: 0.5 }, sculptGoals: [] } });
  assert.ok(g.triceps.need > g.calves.need);
  assert.ok(g.triceps.regions.triceps_long);
});

test('groupStatus: group sets count each set once (strongest credit in group)', () => {
  const now = at('2026-10-10', 18);
  const g = groupStatus([sess('2026-10-10', [lift('db_bench', [[50, 10], [50, 10], [50, 10], [50, 10]])])], { now, profile: noProfile });
  const m = getEx('db_bench').muscles;
  const chestMax = Math.max(...Object.entries(m).filter(([r]) => groupOf(r) === 'chest').map(([, w]) => w));
  close(g.chest.sets7d, 4 * chestMax);
  assert.equal(g.chest.lastTrained, '2026-10-10');
  assert.ok(g.chest.readiness < 0.5);
  assert.deepEqual(Object.keys(g).sort(), Object.keys(GROUPS).sort());
});

test('recommend avoids just-trained groups and favours stale priority groups', () => {
  const now = at('2026-10-10', 17);
  const sessions = [
    // Heavy chest + triceps yesterday evening
    sess('2026-10-09', [lift('db_bench', Array(5).fill([50, 10])), lift('db_skull', Array(5).fill([25, 10]))], { endedAt: at('2026-10-09', 19).toISOString() }),
    // Back/biceps recently-ish, side delts a week ago
    sess('2026-10-07', [lift('db_row', Array(4).fill([60, 10])), lift('db_curl', Array(3).fill([25, 10]))]),
    sess('2026-10-03', [lift('db_lateral', [[20, 15], [20, 15]])]),
  ];
  const profile = { groupPriority: { shoulders: 1.4, triceps: 1.3, quads: 0.5, hamstrings: 0.5, glutes: 0.5, calves: 0.5 }, sculptGoals: [], cardioTargetMin: 120 };
  const recs = recommend(sessions, { now, profile, minutes: 45 });
  assert.ok(recs.length >= 3 && recs.length <= 5);
  const gs = groupStatus(sessions, { now, profile });
  assert.ok(gs.chest.readiness < 0.5 && gs.triceps.readiness < 0.5, 'fixture: chest/triceps fatigued');
  for (const r of recs) {
    assert.ok(!r.groups.includes('chest') && !r.groups.includes('triceps'), 'recommended fatigued: ' + r.label);
    assert.ok(r.label && r.reasons.length > 0 && typeof r.score === 'number');
    assert.ok(Array.isArray(r.targets) && r.targets.length);
  }
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].score >= recs[i].score);
  assert.ok(recs[0].groups.includes('shoulders'), 'top pick includes stale priority shoulders: ' + recs[0].label);
  assert.ok(recs.some(r => r.reasons.some(x => /cardio/i.test(x))), 'cardio behind is mentioned');
});

test('recommend sizes options by minutes', () => {
  const short = recommend([], { now: at('2026-10-10'), profile: noProfile, minutes: 20 });
  for (const r of short) assert.ok(r.groups.length <= 2, r.label);
  const long = recommend([], { now: at('2026-10-10'), profile: noProfile, minutes: 60 });
  const avg = arr => arr.reduce((s, r) => s + r.groups.length, 0) / arr.length;
  assert.ok(avg(long) > avg(short));
});

test('recommend falls back to recovering groups only when nothing else', () => {
  const now = at('2026-10-10', 13);
  const all = Object.keys(REGIONS).map(r => ({ kind: 'class', provider: 'other', name: 'x', time: null, duration: 60, instructor: null, done: true, classify: { type: 'strength', cardioMinutes: 0, intensity: 'hard', muscles: { [r]: 10 }, label: '', blurb: '' } }));
  const recs = recommend([sess('2026-10-10', all, { endedAt: at('2026-10-10', 12).toISOString() })], { now, profile: noProfile, minutes: 45 });
  assert.ok(recs.length >= 3);
  assert.ok(recs.every(r => r.recovering));
});

test('cardioStatus sums cardio + class minutes over 7 days', () => {
  const now = at('2026-10-10');
  const sessions = [
    sess('2026-10-01', [cardio(60)]),
    sess('2026-10-06', [cardio(30), cardio(20, false)]),
    sess('2026-10-08', [klass({ abs: 1 }, 40)]),
  ];
  const c = cardioStatus(sessions, { now, profile: { cardioTargetMin: 150 } });
  assert.equal(c.minutes7d, 70); assert.equal(c.sessions7d, 2); assert.equal(c.daysSince, 2); assert.equal(c.target, 150);
  assert.match(c.suggestion, /80 min short/);
  const done = cardioStatus(sessions, { now, profile: { cardioTargetMin: 60 } });
  assert.match(done.suggestion, /met/);
  assert.equal(cardioStatus([], { now, profile: {} }).daysSince, null);
});

test('weekSummary and streak', () => {
  const now = at('2026-10-10'); // Saturday; week starts Mon 10-05
  const sessions = [
    sess('2026-10-04', [lift('db_curl', [[25, 10]])]),
    sess('2026-10-08', [lift('db_curl', [[25, 10], [25, 10]]), cardio(20)]),
    sess('2026-10-09', [cardio(30)]),
    sess('2026-10-10', [lift('db_curl', [[25, 10, false]])]),   // nothing done
  ];
  const w = weekSummary(sessions, { now });
  assert.equal(w.sessions, 2); assert.equal(w.liftSets, 2); assert.equal(w.cardioMinutes, 50);
  assert.ok(w.byGroup.biceps > 0);
  const st = streak(sessions, { now });
  assert.equal(st.days, 2);           // 10-08, 10-09 (today not yet logged)
  assert.equal(st.weeksActive, 2);    // this week + last week
});
