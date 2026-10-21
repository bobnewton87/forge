// §11 PER-MUSCLE SPECIFICITY (2026-10-21). Bob: "if you do more arms or biceps, it's going to make the
// biceps specifically bigger. And if you neglect quads, it's going to not make those bigger, maintain, or
// whatever it is. It shouldn't just be a wholesale ballooning to perfection."
// This file is the contract for that claim, end to end: sets → stimulus → per-group lean → per-group
// percent → tape girth → the 0..1 scores the 3D body consumes. Every number here is produced by
// project(), not asserted by hand, and the research behind each curve is in docs/research/growth-model.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { project, setResponse, maintenanceProtection, MUSCLE_SHARE } from '../js/engine/projection.js';
import { NOW, TODAY } from './body-fixtures.js';
import { ds, parseDs, addDays } from '../js/util.js';

const liftB = (exId, n) => ({ kind: 'lift', exId, group: null,
  target: { sets: n, repMin: 8, repMax: 12, rest: 90, weight: 30, reps: 10, note: null },
  sets: Array.from({ length: n }, () => ({ w: 30, r: null, done: false })) });

// days = [[dayOffsetInWeek, [[exerciseId, sets], ...]], ...], repeated for `weeks` weeks.
function plan(weeks, days) {
  const out = []; let n = 0;
  const start = parseDs(TODAY);
  for (let w = 0; w < weeks; w++) for (const [off, ex] of days) {
    out.push({ id: 's' + (++n), date: ds(addDays(start, 7 * w + off)), status: 'planned', minutes: 45, location: 'crunch',
      title: 'Lift', targets: [], source: 'generated', rationale: [], notes: '', plan: { auto: true, kind: 'lift' },
      blocks: ex.map(([id, s]) => liftB(id, s)) });
  }
  return out;
}
const profile = (goal, extra = {}) => ({ name: 'T', goal, nutrition: { mode: 'off' }, cardioTargetMin: 0,
  body: { sex: 'male', heightIn: 69, birthYear: 1987, trainingMonths: 7, activity: 'desk' }, ...extra });
const base = () => ({ date: TODAY, weightLb: 164, heightIn: 69, age: 39, sex: 'male', bodyFatPct: 23,
  measurements: { neck: 15, shoulders: 47, chest: 39, waist: 33.5, hips: 37.5, arm: 13.4, forearm: 11, thigh: 22, calf: 14.5 },
  missing: [], missingInfo: [] });
const run = (sessions, goal, weeks, extra = {}) =>
  project({ baseline: base(), profile: profile(goal), sessions, weeks, now: NOW, repeatPlan: true, adherence: 1, ...extra });
const endOf = r => r.series[r.series.length - 1];
const rowFor = (r, g) => r.muscleGain.find(m => m.group === g);

// Three plans used throughout: arms only, legs only, and biceps at 1x vs 2x the volume.
const ARMS = [[0, [['db_curl', 5], ['tri_pushdown', 5]]], [2, [['db_curl', 5], ['tri_pushdown', 5]]], [4, [['db_curl', 5], ['tri_pushdown', 5]]]];
const LEGS = [[0, [['leg_press', 5], ['db_rdl', 5]]], [2, [['leg_press', 5], ['db_rdl', 5]]], [4, [['leg_press', 5], ['db_rdl', 5]]]];
const BI_1X = [[0, [['db_curl', 3]]], [3, [['db_curl', 3]]]];
const BI_2X = [[0, [['db_curl', 6]]], [3, [['db_curl', 6]]]];

test('a muscle with ZERO planned sets gains nothing, under every goal', () => {
  for (const [goal, W] of [['lean_bulk', 52], ['recomp', 26], ['cut', 52], ['weight_loss', 26]]) {
    const r = run(plan(4, ARMS), goal, W);
    const e = endOf(r);
    for (const g of ['chest', 'back', 'shoulders', 'core', 'glutes', 'quads', 'hamstrings', 'calves']) {
      assert.equal(rowFor(r, g).setsPerWeek, 0, `${goal}: ${g} should have no planned sets`);
      assert.ok(e.muscleLb[g] <= 1e-9, `${goal}: ${g} gained ${e.muscleLb[g]} lb on zero sets`);
      assert.ok(e.musclePct[g] <= 1e-9, `${goal}: ${g} grew ${e.musclePct[g]}% on zero sets`);
    }
    // and the trained ones DO gain
    assert.ok(e.musclePct.biceps > 2, `${goal}: biceps only grew ${e.musclePct.biceps}%`);
    assert.ok(e.musclePct.triceps > 2, `${goal}: triceps only grew ${e.musclePct.triceps}%`);
  }
});

test('in a deficit an untrained muscle loses roughly its anatomical share of the lean loss', () => {
  const r = run(plan(4, ARMS), 'cut', 52);
  const e = endOf(r);
  const lost = r.partition.leanLossLb;
  assert.ok(lost > 0.5, `the cut must actually cost lean mass (${lost} lb)`);
  // Untrained groups carry essentially all of it, in proportion to MUSCLE_SHARE.
  const untrained = ['chest', 'back', 'shoulders', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];
  const shareSum = untrained.reduce((a, g) => a + MUSCLE_SHARE[g], 0);
  for (const g of untrained) {
    const expect = -lost * MUSCLE_SHARE[g] / shareSum;
    assert.ok(e.muscleLb[g] < 0, `${g} must shrink (got ${e.muscleLb[g]})`);
    assert.ok(Math.abs(e.muscleLb[g] - expect) < 0.12 + 0.2 * Math.abs(expect),
      `${g} lost ${e.muscleLb[g]} lb, its share says about ${expect.toFixed(2)}`);
  }
  // Every untrained group loses the same PERCENTAGE (a share-proportional loss is a uniform relative loss).
  const pcts = untrained.map(g => e.musclePct[g]);
  assert.ok(Math.max(...pcts) - Math.min(...pcts) < 0.3, `uniform relative loss, got ${JSON.stringify(pcts)}`);
  // The trained arms gain THROUGH the same cut: that is the whole point.
  assert.ok(e.musclePct.biceps > 5 && e.musclePct.triceps > 5, `arms ${e.musclePct.biceps}/${e.musclePct.triceps}%`);
});

test('maintenance volume HOLDS a muscle that growth volume would build (Bickel 2011, Spiering 2021)', () => {
  // Same deficit, same everything, except calves get 3 fractional sets a week instead of none.
  const none = run(plan(4, ARMS), 'cut', 52);
  const maint = run(plan(4, [...ARMS, [5, [['db_calf', 3]]]]), 'cut', 52);
  const a = endOf(none).musclePct.calves, b = endOf(maint).musclePct.calves;
  assert.ok(a < -4, `with no calf work they should visibly shrink over a year (${a}%)`);
  assert.ok(b > a + 3, `3 sets/week must hold them far better than none (${b}% vs ${a}%)`);
  assert.ok(b > -1.5, `3 sets/week should roughly HOLD, not shrink (${b}%)`);
  // and it is the protection curve, not the growth curve, doing the work: 3 sets grows almost nothing
  assert.ok(maintenanceProtection(3) > 0.9 && setResponse(3) < 0.6);
});

test('2x the sets visibly diverges over 6 and 12 months', () => {
  const nums = [26, 52].map(W => {
    const a = run(plan(4, BI_1X), 'lean_bulk', W), b = run(plan(4, BI_2X), 'lean_bulk', W);
    const ra = rowFor(a, 'biceps'), rb = rowFor(b, 'biceps');
    assert.ok(Math.abs(rb.setsPerWeek / ra.setsPerWeek - 2) < 0.05, `the plans really are 1x vs 2x (${ra.setsPerWeek} vs ${rb.setsPerWeek})`);
    return { W, lo: ra.pct, hi: rb.pct, loArm: endOf(a).shape.arm, hiArm: endOf(b).shape.arm };
  });
  for (const n of nums) {
    // Both grow, the doubled one clearly more. √2 ≈ 1.41 is the Pelland 2025 square-root prediction;
    // allow 1.25-1.55 for the ceiling and energy factors acting on top of it.
    assert.ok(n.lo > 1 && n.hi > n.lo, `${n.W}w: ${n.lo}% vs ${n.hi}%`);
    const ratio = n.hi / n.lo;
    assert.ok(ratio > 1.25 && ratio < 1.6, `${n.W}w: 2x the sets gave ${ratio.toFixed(2)}x the growth (${n.lo}% vs ${n.hi}%)`);
    assert.ok(n.hi - n.lo > 3, `${n.W}w: the gap must be visible, not rounding (${(n.hi - n.lo).toFixed(1)} points)`);
  }
  // 12 months must diverge more than 6 months: emphasis compounds.
  assert.ok(nums[1].hi - nums[1].lo > nums[0].hi - nums[0].lo);
  // and it reaches the tape
  assert.ok(nums[1].hiArm > nums[1].loArm, `arm girth ${nums[1].loArm} vs ${nums[1].hiArm}`);
});

test('arms-only grows the arm girth and leaves the thigh alone; legs-only does the reverse', () => {
  // Maintenance calories so fat change does not move the tape and muddy the comparison.
  const arms = run(plan(4, ARMS), 'lean_bulk', 52, { intake: { surplus: 0, proteinGPerLb: 1.0 } });
  const legs = run(plan(4, LEGS), 'lean_bulk', 52, { intake: { surplus: 0, proteinGPerLb: 1.0 } });
  const a0 = arms.series[0].shape, aN = endOf(arms).shape;
  const l0 = legs.series[0].shape, lN = endOf(legs).shape;
  // arms-only: arm up, thigh and calf flat
  assert.ok(aN.arm - a0.arm > 0.35, `arms-only must grow the arm (${a0.arm} → ${aN.arm})`);
  assert.ok(Math.abs(aN.thigh - l0.thigh) < 0.15 || aN.thigh - a0.thigh < 0.1, `arms-only must not grow the thigh (${a0.thigh} → ${aN.thigh})`);
  assert.ok(Math.abs(aN.calf - a0.calf) < 0.1, `arms-only must not grow the calf (${a0.calf} → ${aN.calf})`);
  // legs-only: thigh up, arm flat
  assert.ok(lN.thigh - l0.thigh > 0.6, `legs-only must grow the thigh (${l0.thigh} → ${lN.thigh})`);
  assert.ok(lN.arm - l0.arm < 0.1, `legs-only must not grow the arm (${l0.arm} → ${lN.arm})`);
  // crossed comparison: each plan beats the other on its own site
  assert.ok(aN.arm - a0.arm > lN.arm - l0.arm + 0.3);
  assert.ok(lN.thigh - l0.thigh > aN.thigh - a0.thigh + 0.3);
});

test('emphasis reaches the 0..1 muscle scores the 3D body consumes', () => {
  const arms = run(plan(4, ARMS), 'lean_bulk', 52, { intake: { surplus: 0, proteinGPerLb: 1.0 } });
  const legs = run(plan(4, LEGS), 'lean_bulk', 52, { intake: { surplus: 0, proteinGPerLb: 1.0 } });
  const a0 = arms.series[0].muscle, aN = endOf(arms).muscle;
  const l0 = legs.series[0].muscle, lN = endOf(legs).muscle;
  assert.ok(aN.arms - a0.arms > 0.05, `arms-only raises the arms score (${a0.arms} → ${aN.arms})`);
  // A fixed intake drifts into a small deficit as weight is gained (maintenance rises), so untrained
  // groups give up a sliver. "Flat" here means ≤ 0.02 of a 0..1 score against the arms' ≥ 0.05 rise.
  assert.ok(Math.abs(aN.quads - a0.quads) <= 0.02, `and leaves quads where they were (${a0.quads} → ${aN.quads})`);
  assert.ok(aN.arms - a0.arms > 3 * Math.abs(aN.quads - a0.quads), 'arms move far more than quads');
  assert.ok(lN.quads - l0.quads > 0.05, `legs-only raises the quads score (${l0.quads} → ${lN.quads})`);
  assert.ok(Math.abs(lN.arms - l0.arms) < 0.02, `and leaves arms where they were (${l0.arms} → ${lN.arms})`);
  for (const p of [...arms.series, ...legs.series]) for (const v of Object.values(p.muscle)) {
    assert.ok(v >= 0.02 - 1e-9 && v <= 0.98 + 1e-9, `score out of range: ${v}`);
  }
});

test('the genetic ceiling binds per muscle, not wholesale', () => {
  // 8 years of arms-only in a surplus: the arms should run out of their own room while the untouched
  // groups keep ALL of theirs. Under the old global guard every group was rescaled by one factor.
  const r = run(plan(4, ARMS), 'lean_bulk', 418);
  const bi = rowFor(r, 'biceps'), q = rowFor(r, 'quads');
  assert.ok(bi.pct > 25, `arms grow a lot over 8 years (${bi.pct}%)`);
  assert.ok(bi.roomPct < q.roomPct - 15, `the arms must be nearer their own limit than the untrained quads (${bi.roomPct}% vs ${q.roomPct}%)`);
  assert.equal(q.pct, 0, 'and the quads neither grew nor were held back');
  // Nothing anywhere may pass the ceiling.
  const ceil = r.ceiling.ffmiNatural;
  for (const p of r.series) assert.ok(p.ffmi == null || p.ffmi <= ceil + 1e-6, `FFMI ${p.ffmi} > ceiling ${ceil}`);
  // Every group's cumulative gain stays inside its own share of the allowance.
  const last = endOf(r);
  for (const m of r.muscleGain) assert.ok(m.roomLb >= 0, `${m.group} passed its own cap (room ${m.roomLb})`);
  assert.deepEqual(Object.keys(last.musclePct).sort(), Object.keys(last.muscleLb).sort());
});

test('per-muscle percent is the headline, and it is consistent with pounds and the base masses', () => {
  const r = run(plan(4, ARMS), 'lean_bulk', 52);
  const e = endOf(r);
  for (const g of Object.keys(MUSCLE_SHARE)) {
    const base = r.muscleBaseLb[g];
    assert.ok(base > 0, `${g} needs a base mass`);
    const expect = 100 * e.muscleLb[g] / base;
    assert.ok(Math.abs(e.musclePct[g] - expect) < 0.6, `${g}: ${e.musclePct[g]}% vs ${expect.toFixed(2)}%`);
  }
  // Percent, not pounds, is what shows emphasis: triceps gain MORE pounds than biceps (bigger muscle)
  // while growing by the same percent, and back would out-gain both in pounds on zero sets. The old
  // absolute-pound chart hid exactly this.
  assert.ok(e.muscleLb.triceps > e.muscleLb.biceps, 'triceps are the bigger muscle');
  assert.ok(Math.abs(e.musclePct.triceps - e.musclePct.biceps) < 0.6, 'same sets → same percent');
  // Sum of per-group pounds = the whole-body lean change from training (no leakage).
  const sum = Object.values(e.muscleLb).reduce((a, b) => a + b, 0);
  const dLean = e.leanLb - r.series[0].leanLb;
  assert.ok(Math.abs(sum - dLean) < 0.25, `per-group lb must add up to the lean delta (${sum.toFixed(2)} vs ${dLean.toFixed(2)})`);
});

test('the per-muscle report is ordered, complete and finite', () => {
  const r = run(plan(4, ARMS), 'recomp', 52);
  assert.equal(r.muscleGain.length, Object.keys(MUSCLE_SHARE).length);
  for (let i = 1; i < r.muscleGain.length; i++) assert.ok(r.muscleGain[i - 1].pct >= r.muscleGain[i].pct, 'sorted by growth');
  for (const m of r.muscleGain) for (const [k, v] of Object.entries(m)) {
    if (k === 'group') continue;
    assert.ok(Number.isFinite(v), `${m.group}.${k} = ${v}`);
  }
});
