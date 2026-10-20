import test from 'node:test';
import assert from 'node:assert/strict';
import { baseline } from '../js/engine/bodycomp.js';
import { project, nutritionLab } from '../js/engine/projection.js';
import { bobProfile, bobBodyLog, bobMeas, bobPlan, NOW, TODAY, findBad } from './body-fixtures.js';
import { ds, parseDs, addDays } from '../js/util.js';

// Bob: 69 in, 164 lb, 22 % BF, 7 months lifting, 4 lift days, ~100 cardio min/week, 12 weeks.
const P = bobProfile();
const B = baseline({ profile: P, bodyLog: bobBodyLog(), measurements: bobMeas(), now: NOW });
const PLAN = bobPlan(TODAY, 2, { cardioMin: 100 });
// Sanity targets test the nutrition model itself, so the supplement/metabolic stack is neutral unless a
// test injects a mock (SUPP's real defaults, e.g. an age factor, are tested in their own files).
const run = (intake, extra = {}) => project({ baseline: B, profile: P, sessions: PLAN, weeks: 12, now: NOW, intake, useStack: !!extra.modifiersFn, ...extra });
const S = r => r.summary;
const inRange = (x, lo, hi, msg) => assert.ok(x >= lo && x <= hi, `${msg}: ${x} not in [${lo}, ${hi}]`);

test('Bob recomp at −300: fat −5…−8 lb, lean +1…+2.5 lb', () => {
  const s = S(run({ surplus: -300 }));
  inRange(s.fatLb, -8, -5, 'fat'); inRange(s.leanLb, 1, 2.5, 'lean');
});

test('Bob +300 at 1 g/lb protein: lean +3…+5, fat +1…+3', () => {
  const r = run({ surplus: 300, proteinGPerLb: 1 });
  inRange(S(r).leanLb, 3, 5, 'lean'); inRange(S(r).fatLb, 1, 3, 'fat');
  assert.equal(r.energy.intakeMode, 'surplus'); assert.equal(r.energy.intakeSource, 'arg');
  assert.equal(r.energy.surplusStart, 300);
  assert.equal(r.energy.proteinGPerLb, 1);
});

test('Bob +1000: barely more lean than +500 (≤ +1 lb) but much more fat (~+6…+11 lb)', () => {
  const a = S(run({ surplus: 500, proteinGPerLb: 1 })), b = S(run({ surplus: 1000, proteinGPerLb: 1 }));
  const d = b.leanLb - a.leanLb;
  assert.ok(d >= -0.05 && d <= 1, `lean diff ${d}`);
  inRange(b.fatLb, 6, 11, 'fat at +1000');
  assert.ok(b.fatLb - a.fatLb > 4, `fat diff ${b.fatLb - a.fatLb}`);
});

test('protein at 0.5 g/lb clearly reduces lean gain vs 1.0 g/lb', () => {
  const lo = S(run({ surplus: 300, proteinGPerLb: 0.5 })), hi = S(run({ surplus: 300, proteinGPerLb: 1 }));
  assert.ok(hi.leanLb - lo.leanLb >= 0.7, `${lo.leanLb} vs ${hi.leanLb}`);
  // above 1 g/lb: no added benefit
  const vhi = S(run({ surplus: 300, proteinGPerLb: 1.4 }));
  assert.ok(Math.abs(vhi.leanLb - hi.leanLb) <= 0.1);
});

test('carb/fat split barely matters at equal calories and protein', () => {
  const a = S(run({ surplus: 300, proteinGPerLb: 1, fatPct: 20 })), b = S(run({ surplus: 300, proteinGPerLb: 1, fatPct: 35 }));
  assert.ok(Math.abs(a.leanLb - b.leanLb) <= 0.2 && Math.abs(a.fatLb - b.fatLb) <= 0.3);
  const r = run({ surplus: 300, proteinGPerLb: 1, fatPct: 15 });
  assert.ok(r.macros.warnings.some(w => /Fat is only/.test(w)));
});

test('adding 150 bike min/week at the same intake: less fat, lean roughly unchanged', () => {
  const base = run({ surplus: 300, proteinGPerLb: 1 });
  const cal = base.energy.intakeStart;
  const same = run({ calories: cal, proteinGPerLb: 1 });
  const more = run({ calories: cal, proteinGPerLb: 1 }, { cardioDeltaMin: 150, cardioModality: 'bike', cardioIntensity: 'easy' });
  assert.ok(more.summary.fatLb < same.summary.fatLb - 1, `${more.summary.fatLb} vs ${same.summary.fatLb}`);
  assert.ok(Math.abs(more.summary.leanLb - same.summary.leanLb) <= 0.6, `${more.summary.leanLb} vs ${same.summary.leanLb}`);
  assert.ok(more.weekly.cardioMinPerWeek >= same.weekly.cardioMinPerWeek + 145);
  assert.ok(more.energy.tdeeStart > same.energy.tdeeStart + 80);
  // running interferes more than cycling at high volume
  const bike = run({ calories: cal, proteinGPerLb: 1 }, { cardioDeltaMin: 300, cardioModality: 'bike', cardioIntensity: 'moderate' });
  const runb = run({ calories: cal, proteinGPerLb: 1 }, { cardioDeltaMin: 300, cardioModality: 'run', cardioIntensity: 'moderate' });
  assert.ok(runb.partition.interferenceFactor < bike.partition.interferenceFactor);
  // negative delta removes cardio (not below zero)
  const less = run({ calories: cal, proteinGPerLb: 1 }, { cardioDeltaMin: -500 });
  assert.equal(less.weekly.cardioMinPerWeek, 0);
  assert.ok(less.summary.fatLb > same.summary.fatLb);
});

test('nutritionLab: 15 points, sweet spot ≈ +200…+500, diminishing returns, plain-English explanation', () => {
  const lab = nutritionLab({ baseline: B, profile: P, sessions: PLAN, weeks: 12, now: NOW, proteinGPerLb: 1, useStack: false });
  assert.equal(lab.points.length, 15);
  assert.equal(lab.points[0].surplus, -750); assert.equal(lab.points[14].surplus, 1000);
  inRange(lab.sweetSpot.from, 150, 300, 'from'); inRange(lab.sweetSpot.to, 400, 550, 'to');
  assert.match(lab.sweetSpot.note, /kcal\/day/);
  // fat rises monotonically with calories; lean saturates
  for (let i = 1; i < lab.points.length; i++) assert.ok(lab.points[i].fatLb >= lab.points[i - 1].fatLb);
  const at = s => lab.points.find(p => p.surplus === s);
  assert.ok(at(1000).leanLb - at(500).leanLb <= 0.5);
  assert.ok(at(250).leanLb - at(-250).leanLb > 1);
  assert.ok(at(1000).marginalLeanPerFat < at(125).marginalLeanPerFat);
  assert.ok(lab.explanation.length >= 6 && lab.explanation.every(t => typeof t === 'string' && t.length > 30 && !/NaN|undefined|null/.test(t)));
  assert.ok(lab.explanation.some(t => /Morton 2018/.test(t)) && lab.explanation.some(t => /Levine/.test(t)));
  const p05 = lab.proteinCurve.find(p => p.gPerLb === 0.5), p10 = lab.proteinCurve.find(p => p.gPerLb === 1);
  assert.ok(p10.leanLb > p05.leanLb + 0.5);
  assert.equal(lab.maintenance, run({ surplus: 0 }).energy.tdeeStart);
  assert.deepEqual(findBad(lab), []);
});

test('per-muscle model: more triceps sets → more triceps lean and a bigger arm; others ~unchanged', () => {
  const extra = PLAN.map(s => (s.plan?.kind === 'lift' ? { ...s, blocks: [...s.blocks,
    { kind: 'lift', exId: 'tri_pushdown', group: null, target: { sets: 4, repMin: 10, repMax: 15, rest: 60, weight: 30, reps: 12, note: null },
      sets: Array.from({ length: 4 }, () => ({ w: 30, r: null, done: false })) }] } : s));
  const intake = { calories: 2600, proteinGPerLb: 1 };
  const a = run(intake), b = project({ baseline: B, profile: P, sessions: extra, weeks: 12, now: NOW, intake, useStack: false });
  const ea = a.series[12], eb = b.series[12];
  assert.ok(b.weekly.setsByGroup.triceps > a.weekly.setsByGroup.triceps + 10);
  assert.ok(eb.muscleLb.triceps > ea.muscleLb.triceps * 1.1, `${ea.muscleLb.triceps} → ${eb.muscleLb.triceps}`);
  assert.ok(eb.shape.arm > ea.shape.arm || eb.muscle.arms > ea.muscle.arms);
  assert.ok(b.weekly.responseByGroup.triceps > a.weekly.responseByGroup.triceps);
  for (const g of ['chest', 'back', 'quads', 'core']) {
    assert.ok(Math.abs(eb.muscleLb[g] - ea.muscleLb[g]) <= Math.max(0.03, 0.05 * Math.abs(ea.muscleLb[g])), g);
  }
  assert.ok(Math.abs(b.summary.leanLb - a.summary.leanLb) < 0.5);
});

test('per-muscle model: 0 sets → ~0 growth; whole-body lean = Σ groups; diminishing returns via the plan', () => {
  const r = run({ surplus: 300, proteinGPerLb: 1 });
  for (const p of r.series) {
    const sum = Object.values(p.muscleLb).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - (p.leanLb - r.series[0].leanLb)) <= 0.12, `week ${p.week}: ${sum} vs ${p.leanLb - r.series[0].leanLb}`);
  }
  assert.equal(r.weekly.responseByGroup.calves, 0);       // fixture has no calf work
  assert.ok(Math.abs(r.series[12].muscleLb.calves) <= 0.01);
  assert.ok(r.series[12].muscle.calves <= r.series[0].muscle.calves + 0.005);
  assert.ok(r.series[12].muscle.delts > r.series[0].muscle.delts);
  // Bob's start (FFMI ≈ 19-20) lands near the middle of the 0..1 scores
  for (const v of Object.values(r.series[0].muscle)) inRange(v, 0.4, 0.6, 'start score');
  // doubling the whole plan's sets adds less than the first half did (diminishing returns)
  const dbl = PLAN.map(s => (s.plan?.kind === 'lift' ? { ...s, blocks: [...s.blocks, ...s.blocks] } : s));
  const none = project({ baseline: B, profile: P, sessions: PLAN.filter(s => s.plan?.kind !== 'lift'), weeks: 12, now: NOW, intake: { surplus: 300, proteinGPerLb: 1 }, useStack: false });
  const two = project({ baseline: B, profile: P, sessions: dbl, weeks: 12, now: NOW, intake: { surplus: 300, proteinGPerLb: 1 }, useStack: false });
  const g1 = r.summary.leanLb - none.summary.leanLb, g2 = two.summary.leanLb - r.summary.leanLb;
  assert.ok(g1 > 0 && g2 > 0 && g2 < g1, `first ${g1}, second ${g2}`);
});

test('energy is conserved every week (balance = lean × 1,250 + fat × 3,500 − direct fat)', () => {
  for (const intake of [{ surplus: 300, proteinGPerLb: 1 }, { surplus: 900, proteinGPerLb: 0.6 }]) {
    const r = run(intake);
    for (const w of r.weekly.perWeek) {
      const stored = w.leanGain * 1250 + (w.fatChange - w.fatDirect) * 3500;
      assert.ok(Math.abs(w.balance * 7 - stored) <= 45, `${w.weekStart}: ${w.balance * 7} vs ${stored}`);
    }
  }
});

// ---------------------------------------------------------------- stack (supplements/therapies) via a mock
const mods = over => () => ({ leanCeilingMult: 1, leanRetentionMult: 1, partitionShift: 0, tdeeDelta: 0, intakeDelta: 0, waterLb: 0,
  leanDirectLbPerWeek: 0, fatDirectLbPerWeek: 0, contributions: [], warnings: [], ...over });

test('stack: leanDirectLbPerWeek adds lean at the same intake, paid for out of fat (energy conserved)', () => {
  const intake = { calories: 2600, proteinGPerLb: 1 };
  const a = run(intake, { modifiersFn: mods({}) });
  const b = run(intake, { modifiersFn: mods({ leanDirectLbPerWeek: 0.4, contributions: [{ id: 't', name: 'Test T', evidence: 'strong', text: 'Mock testosterone effect.', assumedAverage: true }] }) });
  const dL = b.summary.leanLb - a.summary.leanLb, dF = b.summary.fatLb - a.summary.fatLb;
  assert.ok(dL > 4.4 && dL < 5.2, `lean +${dL}`);                  // 12 × 0.4 = 4.8
  // building it costs ~1,250 kcal/lb out of fat; the extra lean also raises BMR a little (more fat burned)
  const paid = -dL * 1250 / 3500;
  assert.ok(dF <= paid + 0.1 && dF >= paid - 0.6, `fat ${dF} vs ${paid}`);
  for (const w of b.weekly.perWeek) {
    const stored = w.leanGain * 1250 + (w.fatChange - w.fatDirect) * 3500;
    assert.ok(Math.abs(w.balance * 7 - stored) <= 45);
  }
  // direct lean is spread over all muscles, even untrained calves
  assert.ok(b.series[12].muscleLb.calves > 0.15);
  assert.equal(b.stack.direct.lean, 4.8);
  assert.ok(b.assumptions.some(t => /Mock testosterone effect\. \(assumed average\)/.test(t)));
  assert.ok(b.assumptions.some(t => /Bhasin 1996/.test(t) && /additivity is an assumption/.test(t)));
  assert.equal(b.stack.contributions.length, 1);
});

test('stack: leanCeilingMult is not flattened, retention, fatDirect, water, tdee/intake deltas, useStack=false', () => {
  const intake = { surplus: 300, proteinGPerLb: 1 };
  const base = run(intake, { modifiersFn: mods({}) });
  const big = run(intake, { modifiersFn: mods({ leanCeilingMult: 2 }) });
  assert.ok(big.summary.leanLb > base.summary.leanLb * 1.7, `${base.summary.leanLb} → ${big.summary.leanLb}`);
  const fat = run(intake, { modifiersFn: mods({ fatDirectLbPerWeek: -0.2 }) });
  // −0.2 lb/week × 12 = −2.4 lb, minus a little energy feedback: since the long-horizon model (Hall 2011) lets fat
  // mass and body weight raise maintenance, less fat means slightly lower burn, so ~0.2 lb comes back.
  assert.ok(Math.abs(fat.summary.fatLb - (base.summary.fatLb - 2.4)) <= 0.35);
  assert.ok(Math.abs(fat.summary.leanLb - base.summary.leanLb) <= 0.1);
  // water: scale only, starting after today
  const water = run(intake, { modifiersFn: mods({}), useStack: true });
  const wet = run(intake, { modifiersFn: (p, d) => mods({ waterLb: d > TODAY ? 3 : 0 })() });
  assert.equal(wet.series[0].waterLb, 0); assert.equal(wet.series[0].weightLb, 164);
  assert.equal(wet.series[12].waterLb, 3);
  assert.ok(Math.abs(wet.summary.weightLb - water.summary.weightLb - 3) <= 0.11);
  assert.equal(wet.summary.leanLb, water.summary.leanLb); assert.equal(wet.summary.fatLb, water.summary.fatLb);
  assert.ok(Math.abs(wet.series[12].bodyFatPct - water.series[12].bodyFatPct) <= 0.05);   // BF% is tissue-based
  // retention in a deficit
  const cut = { surplus: -700, proteinGPerLb: 1 };
  const c1 = run(cut, { modifiersFn: mods({}) }), c2 = run(cut, { modifiersFn: mods({ leanRetentionMult: 0.3 }) });
  assert.ok(c2.summary.leanLb > c1.summary.leanLb);
  // tdeeDelta always applies; intakeDelta only when intake is the goal default
  const t = run(intake, { modifiersFn: mods({ tdeeDelta: 200 }) });
  assert.ok(t.summary.fatLb < base.summary.fatLb - 1);
  const goalA = run(null, { modifiersFn: mods({}) }), goalB = run(null, { modifiersFn: mods({ intakeDelta: -300 }) });
  assert.ok(goalB.weekly.kcalIn < goalA.weekly.kcalIn - 250);
  const setB = run(intake, { modifiersFn: mods({ intakeDelta: -300 }) });
  assert.equal(setB.weekly.kcalIn, base.weekly.kcalIn);
  // useStack=false → neutral even with a strong mock
  const off = run(intake, { modifiersFn: mods({ leanCeilingMult: 2, leanDirectLbPerWeek: 1, waterLb: 5 }), useStack: false });
  assert.equal(off.summary.leanLb, base.summary.leanLb);
  assert.equal(off.stack.used, false);
  assert.ok(off.assumptions.some(a => /switched off/.test(a)));
  // garbage from the stack never produces NaN
  const junk = run(intake, { modifiersFn: () => ({ leanCeilingMult: NaN, leanDirectLbPerWeek: 'x', waterLb: Infinity, contributions: 'nope', warnings: [null, 5, 'Real warning.'] }) });
  assert.deepEqual(findBad(junk), []);
  assert.deepEqual(junk.stack.warnings, ['Real warning.']);
  const thrower = run(intake, { modifiersFn: () => { throw new Error('boom'); } });
  assert.equal(thrower.summary.leanLb, base.summary.leanLb);
});

// ---------------------------------------------------------------- calibration, confidence, outputs
function logs(tdee, days = 28) {
  const bodyLog = [], foodLog = [];
  let w = 164;
  for (let i = days; i >= 1; i--) {
    const d = ds(addDays(parseDs(TODAY), -i));
    const eat = 2700 + (i % 3 - 1) * 150;
    w += (eat - tdee) / 3500;
    bodyLog.push({ d, w: Math.round((w + ((i * 7) % 5 - 2) * 0.3) * 10) / 10 });
    foodLog.push({ d, kcal: eat });
  }
  return { bodyLog, foodLog };
}

test('adaptive TDEE calibrates maintenance and raises confidence', () => {
  const sparseB = baseline({ profile: P, bodyLog: [{ d: '2026-10-18', w: 164 }], measurements: [], now: NOW });
  const plain = project({ baseline: sparseB, profile: P, sessions: PLAN, now: NOW });
  const { bodyLog, foodLog } = logs(2800);
  const cal = project({ baseline: sparseB, profile: P, sessions: PLAN, now: NOW, bodyLog, foodLog });
  assert.equal(plain.tdeeCalibration.applied, false);
  assert.equal(cal.tdeeCalibration.applied, true);
  assert.ok(cal.tdeeCalibration.adaptive > 2600 && cal.tdeeCalibration.adaptive < 3000, String(cal.tdeeCalibration.adaptive));
  assert.ok(cal.tdeeCalibration.offset > 100);
  assert.ok(cal.energy.tdeeStart > plain.energy.tdeeStart + 100);
  const rank = { low: 0, medium: 1, high: 2 };
  assert.ok(rank[cal.confidence] > rank[plain.confidence], `${plain.confidence} → ${cal.confidence}`);
  assert.ok(cal.assumptions.some(a => /calibrated with your own data/.test(a)));
  // a precomputed adaptive result works too
  const pre = project({ baseline: sparseB, profile: P, sessions: PLAN, now: NOW, adaptive: { tdee: 2900, confidence: 'high', from: '2026-09-21', to: '2026-10-18' } });
  assert.ok(pre.tdeeCalibration.applied && pre.tdeeCalibration.weight === 0.9);
});

test('series exposes shape (with heightIn), muscle scores, muscleLb, water, L/R limbs; legacy fields intact', () => {
  const meas = [{ ...bobMeas()[0], thigh: undefined, thighL: 22, thighR: 22.75 }];
  const b = baseline({ profile: P, bodyLog: bobBodyLog(), measurements: meas, now: NOW });
  const r = project({ baseline: b, profile: P, sessions: PLAN, now: NOW, intake: { surplus: 300, proteinGPerLb: 1 } });
  for (const k of ['series', 'summary', 'milestones', 'assumptions', 'confidence', 'shapeEstimated', 'missingInfo', 'weekly', 'energy', 'macros', 'partition', 'startBodyFat', 'stack']) assert.ok(k in r, k);
  const p0 = r.series[0], pN = r.series[12];
  for (const k of ['neck', 'shoulders', 'chest', 'waist', 'hips', 'arm', 'forearm', 'thigh', 'calf', 'heightIn']) assert.ok(p0.shape[k] > 0, k);
  assert.equal(p0.shape.heightIn, 69);
  for (const k of ['chest', 'delts', 'lats', 'arms', 'abs', 'quads', 'calves', 'traps']) { assert.ok(pN.muscle[k] >= 0 && pN.muscle[k] <= 1, k); }
  assert.ok(pN.limbs.thighL > 22 && pN.limbs.thighR > 22.75);
  assert.ok(Math.abs((pN.limbs.thighR - pN.limbs.thighL) - 0.75) < 0.02);
  assert.equal(p0.measurements.thigh, 22.4);   // 22.375, tape values are shown to 0.1 in
  assert.ok(r.startBodyFat.uncertainty >= 3 && r.startBodyFat.range.low < 22);
  assert.ok(r.assumptions.every(a => typeof a === 'string' && a.length > 10 && !/NaN|undefined|null/.test(a)));
  assert.ok(r.assumptions.some(a => /Schoenfeld/.test(a)) && r.assumptions.some(a => /Pelland 2024/.test(a)));
});

test('no NaN anywhere in project/nutritionLab across odd inputs', () => {
  const bs = [B, baseline({ profile: { body: { trainingMonths: 'x' } }, bodyLog: [{ d: '2026-10-01', w: 150 }], now: NOW })];
  const intakes = [null, 2500, '3000', { surplus: 'x' }, { surplus: -2500, proteinGPerLb: 0.1, fatPct: 90 }, { calories: -5 }, { surplus: 1200, fatPct: 5 }];
  for (const b of bs) for (const intake of intakes) for (const cd of [0, -999, 400, NaN]) for (const mod of ['run', 'nope']) {
    const r = project({ baseline: b, profile: P, sessions: PLAN, now: NOW, intake, cardioDeltaMin: cd, cardioModality: mod, cardioIntensity: 'weird', weeks: 8 });
    assert.deepEqual(findBad(r), [], JSON.stringify({ intake, cd, mod }));
  }
  for (const args of [{}, { baseline: null }, { baseline: B, calorieRange: [500, -500], step: 0 }, { baseline: B, calorieRange: 'x', step: 'y', proteinGPerLb: 'z' },
    { baseline: B, profile: null, sessions: null, weeks: 0 }, { baseline: B, profile: P, sessions: PLAN, cardioDeltaMin: 300, fatPct: 12 }]) {
    const lab = nutritionLab({ now: NOW, ...args });
    assert.deepEqual(findBad(lab), [], JSON.stringify(args).slice(0, 80));
    assert.ok(Array.isArray(lab.points) && Array.isArray(lab.explanation) && lab.sweetSpot);
  }
});

test('performance: 24-week projection + 15-point lab in < 300 ms', () => {
  const t0 = performance.now();
  const r = project({ baseline: B, profile: P, sessions: bobPlan(TODAY, 4, { cardioMin: 100 }), weeks: 24, now: NOW });
  const lab = nutritionLab({ baseline: B, profile: P, sessions: bobPlan(TODAY, 4, { cardioMin: 100 }), weeks: 24, now: NOW });
  const ms = performance.now() - t0;
  assert.equal(r.series.length, 25); assert.equal(lab.points.length, 15);
  assert.ok(ms < 300, `${ms.toFixed(0)} ms`);
});

test('sweet-spot note never prints a degenerate range', () => {
  const lab = nutritionLab({ baseline: B, profile: P, sessions: PLAN, now: NOW, calorieRange: [300, 300], step: 125 });
  assert.equal(lab.points.length, 1);
  assert.equal(lab.sweetSpot.from, lab.sweetSpot.to);
  assert.doesNotMatch(lab.sweetSpot.note, /(\d+(?:\.\d+)?)-\1\b/);
  assert.doesNotMatch(lab.sweetSpot.note, /to \+300/);
  const full = nutritionLab({ baseline: B, profile: P, sessions: PLAN, now: NOW });
  assert.doesNotMatch(full.sweetSpot.note, /(\d+(?:\.\d+)?)-\1 lb/);
});
