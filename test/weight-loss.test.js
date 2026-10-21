// CONTRACT §23: the weight-loss goal and intentional lean loss.
// Evidence and DOIs: docs/research/weight-loss-lean-mass.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { baseline } from '../js/engine/bodycomp.js';
import { project, nutritionLab, lossRateFactor, proteinRetentionFactor } from '../js/engine/projection.js';
import { dailyTargets, macrosFor, lossRateDeficit } from '../js/engine/nutrition.js';
import {
  resolveTargets, applyTargetChange, describeChange, needsReplan, lossPlan, unitTargets, weeklyMinimums,
  priorityLimits, volumeFloorOf, GOALS, GOAL_INFO, GOAL_ORDER, LOSS_RATES, LIMITS, FLOOR_FACTOR,
  MAINTENANCE_FRACTION, VOLUME_FLOORS, LEAN_PROTECTION_INFO,
} from '../js/engine/targets.js';
import { defaultProfile } from '../js/store.js';
import { bobPlan, findBad } from './body-fixtures.js';

const NOW = new Date(2026, 9, 20, 9);
const TODAY = '2026-10-20';

// The worked example from the report: a 180 lb man at 25 % DXA body fat aiming at 160 lb.
const manBodyLog = () => ['2026-10-06', '2026-10-09', '2026-10-12', '2026-10-15', '2026-10-18', '2026-10-20']
  .map((d, i) => ({ d, w: 180 + (i % 2 ? 0.3 : -0.3) }));
const manMeas = () => [{ d: '2026-10-19', neck: 15.5, shoulders: 47, chest: 40, waist: 35, hips: 39, armL: 13.5, armR: 13.5, forearm: 11.5, thigh: 22.5, calf: 15, bodyFat: 25, bodyFatMethod: 'dxa' }];
function manProfile(extra = {}) {
  const d = defaultProfile();
  return { ...d, name: 'Test', goal: 'weight_loss', bodyweight: 180, cardioTargetMin: 120,
    nutrition: { ...d.nutrition, mode: 'off' },
    ...extra,
    body: { sex: 'male', heightIn: 70, birthYear: 1987, trainingMonths: 12, activity: 'desk', goalWeightLb: 160, ...(extra.body || {}) } };
}
const baseOf = profile => baseline({ profile, bodyLog: manBodyLog(), measurements: manMeas(), now: NOW });
function run(profile, extra = {}) {
  return project({ baseline: baseOf(profile), profile, sessions: bobPlan(TODAY, 2), weeks: 26, now: NOW, ...extra });
}
const end = r => r.series[r.series.length - 1];
const rateRow = (r, pct) => r.weightLoss.rates.find(x => Math.abs(x.pctPerWeek - pct) < 0.01);

// ---------------------------------------------------------------- the goal itself
test('§23: weight_loss is a goal, distinct from cut, and saved profiles are untouched', () => {
  assert.ok(GOALS.includes('weight_loss'));
  assert.deepEqual(GOAL_ORDER, ['recomp', 'lean_bulk', 'cut', 'weight_loss']);
  assert.notEqual(GOAL_INFO.cut.blurb, GOAL_INFO.weight_loss.blurb);
  assert.match(GOAL_INFO.cut.blurb, /keep muscle/i);
  assert.match(GOAL_INFO.weight_loss.blurb, /lean mass allowed to follow/i);
  // migrate() never rewrites a goal, and an unknown one still falls back to recomp
  assert.equal(resolveTargets({ goal: 'cut' }).goals.goal, 'cut');
  assert.equal(resolveTargets({ goal: 'nonsense' }).goals.goal, 'recomp');
  assert.equal(applyTargetChange({ goal: 'cut' }, { goals: { goal: 'not_a_goal' } }).goal, 'cut');
  assert.equal(applyTargetChange({ goal: 'cut' }, { goals: { goal: 'weight_loss' } }).goal, 'weight_loss');
  // a profile that never heard of the goal resolves exactly as before
  const t = resolveTargets(defaultProfile());
  assert.equal(t.goals.goal, 'recomp');
  assert.equal(t.goals.losing, false);
  assert.equal(t.goals.plan, null);
  assert.equal(t.minimums.floor.mode, 'evidence');
});

test('§23: goal weight, rate and date resolve through targets.lossPlan', () => {
  const p = manProfile({ body: { goalWeightLb: 160, lossRatePctPerWeek: 0.7 } });
  const pl = lossPlan(p, { weightLb: 180, now: NOW });
  assert.equal(pl.goalWeightLb, 160);
  assert.equal(pl.pctPerWeek, 0.7);
  assert.equal(pl.lbPerWeek, 1.26);
  assert.equal(pl.deficitKcal, lossRateDeficit(180, 0.7));
  assert.equal(pl.deficitKcal, 630);              // 180 × 0.7 % × 3500 / 7
  assert.equal(pl.toLoseLb, 20);
  assert.equal(pl.weeks, 16);
  assert.equal(pl.source, 'rate');
  assert.ok(pl.cardioMinPerWeek > 0);
  // no rate set → the evidence-backed default (Garthe 2011's slow arm)
  assert.equal(lossPlan(manProfile({ body: { goalWeightLb: 160 } }), { weightLb: 180, now: NOW }).pctPerWeek, 0.7);
  // a target date wins and sets the rate
  const dated = lossPlan(manProfile({ body: { goalWeightLb: 160, goalWeightDate: '2026-12-29' } }), { weightLb: 180, now: NOW });
  assert.equal(dated.source, 'date');
  assert.ok(dated.pctPerWeek > 1, String(dated.pctPerWeek));     // 20 lb in 10 weeks is fast
  assert.ok(dated.warnings.length, 'a fast date warns');
  // out-of-range values are clamped, never dropped silently
  assert.equal(applyTargetChange(manProfile(), { goals: { goalWeightLb: 5 } }).body.goalWeightLb, LIMITS.goalWeightLb[0]);
  assert.equal(applyTargetChange(manProfile(), { goals: { lossRatePctPerWeek: 99 } }).body.lossRatePctPerWeek, LIMITS.lossRatePctPerWeek[1]);
  assert.equal(applyTargetChange(manProfile(), { goals: { goalWeightLb: null } }).body.goalWeightLb, null);
});

// ---------------------------------------------------------------- the model
test('§23: Forbes partitions in the LOSS direction — leaner means more of the loss is lean', () => {
  // Isolate the catabolic term: a fast deficit with no training and low protein, so lean loss is not
  // masked by the training-driven gain. Same person, same rate, only the starting body fat differs.
  const at = bodyFat => {
    const meas = [{ ...manMeas()[0], waist: bodyFat >= 20 ? 35 : 30, bodyFat }];
    const p = manProfile({ nutrition: { mode: 'simple', proteinGPerLb: 0.6 }, schedule: {},
      body: { goalWeightLb: 140, lossRatePctPerWeek: 1.2 } });
    return project({ baseline: baseline({ profile: p, bodyLog: manBodyLog(), measurements: meas, now: NOW }),
      profile: p, sessions: [], weeks: 26, now: NOW, repeatPlan: false }).weightLoss;
  };
  const fat = at(28), lean = at(12);
  assert.ok(fat.leanLostLb > 0 && lean.leanLostLb > 0, `${fat.leanLostLb} / ${lean.leanLostLb}`);
  assert.ok(lean.leanShareOfLoss > fat.leanShareOfLoss,
    `lean start ${lean.leanShareOfLoss} should lose a bigger share as lean than ${fat.leanShareOfLoss}`);
  // and the underlying Forbes p is a decreasing function of fat mass
  const pForbes = fatKg => 10.4 / (10.4 + fatKg);
  assert.ok(pForbes(10) > pForbes(20) && pForbes(20) > pForbes(40));
});

test('§23: faster deficits cost more lean mass and less of the loss is fat (Garthe 2011)', () => {
  const r = run(manProfile({ body: { goalWeightLb: 160, lossRatePctPerWeek: 0.7 } }));
  const rates = r.weightLoss.rates;
  assert.ok(rates.length >= 4);
  // lean change falls monotonically as the rate rises
  for (let i = 1; i < rates.length; i++) {
    assert.ok(rates[i].leanLb <= rates[i - 1].leanLb + 1e-9,
      `lean at ${rates[i].pctPerWeek}% (${rates[i].leanLb}) should not beat ${rates[i - 1].pctPerWeek}% (${rates[i - 1].leanLb})`);
  }
  const slow = rateRow(r, 0.35), fast = rateRow(r, 1.4);
  assert.ok(slow.leanLb - fast.leanLb > 2, `slow keeps ≥2 lb more lean (${slow.leanLb} vs ${fast.leanLb})`);
  // the Garthe pattern: the fast arm gets to the same weight with LESS of it from fat
  const g07 = rateRow(r, 0.7), g10 = rateRow(r, 1);
  assert.ok(g10.reached && g10.weightLb < -15);
  assert.ok(g10.leanShareOfLoss > g07.leanShareOfLoss);
  // the curve itself
  assert.equal(lossRateFactor(0.7), 1);
  assert.ok(Math.abs(lossRateFactor(1) - 1.6) < 1e-9);
  assert.ok(lossRateFactor(0.35) < 1 && lossRateFactor(1.4) > lossRateFactor(1));
  assert.ok(lossRateFactor(99) <= 3 && lossRateFactor(0) >= 0.5);
  for (let x = 0; x < 3; x += 0.1) assert.ok(lossRateFactor(x + 0.1) >= lossRateFactor(x) - 1e-9);
});

test('§23: protein and lifting change how much lean survives (Mettler 2010, Weinheimer 2010)', () => {
  // protein retention curve: steeper than the growth curve, plateaus by ~1.1 g/lb
  assert.ok(proteinRetentionFactor(0.45) < 0.6 && proteinRetentionFactor(1.05) > 0.95);
  assert.ok(Math.abs(proteinRetentionFactor(1.4) - proteinRetentionFactor(1.1)) < 1e-9, 'no benefit past 1.1 g/lb');
  for (let g = 0.3; g < 1.4; g += 0.05) assert.ok(proteinRetentionFactor(g + 0.05) >= proteinRetentionFactor(g) - 1e-9);

  const body = { goalWeightLb: 160, lossRatePctPerWeek: 1 };
  const hi = run(manProfile({ body, nutrition: { mode: 'simple', proteinGPerLb: 1.1 } }));
  const lo = run(manProfile({ body, nutrition: { mode: 'simple', proteinGPerLb: 0.6 } }));
  assert.ok(lo.weightLoss.leanLostLb > hi.weightLoss.leanLostLb,
    `low protein loses more lean (${lo.weightLoss.leanLostLb} vs ${hi.weightLoss.leanLostLb})`);
  assert.ok(lo.weightLoss.proteinRetention < hi.weightLoss.proteinRetention);

  // lifting: same food, no planned training at all vs the full plan
  const prof = manProfile({ body, nutrition: { mode: 'simple', proteinGPerLb: 0.8 } });
  const lifting = project({ baseline: baseOf(prof), profile: prof, sessions: bobPlan(TODAY, 2), weeks: 26, now: NOW });
  const none = project({ baseline: baseOf(prof), profile: { ...prof, schedule: {} }, sessions: [], weeks: 26, now: NOW, repeatPlan: false });
  assert.ok(none.weightLoss.leanLostLb > lifting.weightLoss.leanLostLb,
    `not lifting loses more lean (${none.weightLoss.leanLostLb} vs ${lifting.weightLoss.leanLostLb})`);
});

test('§23: the lean-protection preset really changes the outcome (it writes protein + floors)', () => {
  const base = manProfile({ body: { goalWeightLb: 160, lossRatePctPerWeek: 1 }, nutrition: { mode: 'simple' } });
  const protect = applyTargetChange(base, { goals: { leanProtection: 'protect' } });
  const minimal = applyTargetChange(base, { goals: { leanProtection: 'minimal' } });
  // the preset is not a fudge factor: it writes the inputs the model reads
  assert.equal(protect.nutrition.proteinGPerLb, LEAN_PROTECTION_INFO.protect.proteinGPerLb);
  assert.equal(minimal.nutrition.proteinGPerLb, LEAN_PROTECTION_INFO.minimal.proteinGPerLb);
  assert.equal(volumeFloorOf(protect), 'evidence');
  assert.equal(volumeFloorOf(minimal), 'minimum');
  const a = run(protect), b = run(minimal);
  assert.ok(b.weightLoss.leanLostLb > a.weightLoss.leanLostLb,
    `"minimum body mass" loses more lean (${b.weightLoss.leanLostLb} vs ${a.weightLoss.leanLostLb})`);
  assert.equal(a.weightLoss.leanProtection, 'protect');
  assert.equal(b.weightLoss.leanProtection, 'minimal');
});

test('§23: the projection aims at the goal weight, stops there, and shows the split', () => {
  const r = run(manProfile({ body: { goalWeightLb: 165, lossRatePctPerWeek: 1 } }), { weeks: 52 });
  const wl = r.weightLoss;
  assert.ok(wl.reached && wl.week > 0);
  assert.ok(Math.abs(wl.atGoal.weightLb - 165) < 1.5, String(wl.atGoal.weightLb));
  // after the goal, intake rises to maintenance: weight stops falling
  const after = r.series.filter(p => p.week > wl.week + 4);
  if (after.length) assert.ok(after[after.length - 1].weightLb > 165 - 2, 'does not keep dieting past the goal');
  const ms = r.milestones.find(m => m.id === 'goal_weight');
  assert.ok(ms && ms.reached && /fat/.test(ms.note) && /lean mass/.test(ms.note));
  assert.equal(r.milestones[0].id, 'goal_weight', 'the goal weight leads the milestone list');
  // intake is the one the deficit formula implies
  assert.ok(Math.abs(r.energy.intakeStart - (r.energy.tdeeStart - wl.deficitKcal)) <= 2);
});

test('§23: the projected body shrinks — tape sites and 3D muscle scores both move down', () => {
  const r = run(manProfile({ body: { goalWeightLb: 155, lossRatePctPerWeek: 1.4 }, nutrition: { mode: 'simple', proteinGPerLb: 0.6 } }), { weeks: 52 });
  const a = r.series[0], z = end(r);
  assert.ok(z.weightLb < a.weightLb - 10);
  for (const site of ['waist', 'hips', 'chest', 'thigh', 'arm', 'neck']) {
    assert.ok(z.shape[site] < a.shape[site], `${site} should shrink: ${a.shape[site]} → ${z.shape[site]}`);
  }
  assert.ok(z.shape.waist < a.shape.waist - 1.5, 'the waist moves most');
  // lean loss pulls the per-group muscle totals (and so the 3D scores) down
  assert.ok(r.weightLoss.leanLostLb > 0);
  const lostSomewhere = Object.values(z.muscleLb).some(v => v < -0.05);
  assert.ok(lostSomewhere, 'some muscle group ends with less lean mass');
  assert.ok(z.muscle.quads <= a.muscle.quads + 1e-9 || z.muscle.chest <= a.muscle.chest + 1e-9);
  assert.deepEqual(findBad(r.series), []);
});

// ---------------------------------------------------------------- floors and warnings
test('§23: below-floor set targets are allowed ONLY under the weight-loss goal', () => {
  const lose = applyTargetChange(manProfile(), { training: { volumePolicy: { floors: 'maintenance' } } });
  assert.equal(volumeFloorOf(lose), 'maintenance');
  assert.equal(resolveTargets(lose).minimums.floor.factor, MAINTENANCE_FRACTION);
  const U = unitTargets(lose);
  assert.ok(U.triceps.min < U.triceps.growthMin, `${U.triceps.min} < ${U.triceps.growthMin}`);
  assert.ok(Math.abs(U.triceps.min - Math.round(U.triceps.growthMin * MAINTENANCE_FRACTION * 10) / 10) < 1e-9);
  assert.ok(weeklyMinimums(lose).triceps.min < weeklyMinimums(manProfile()).triceps.min, 'the displayed group floors follow');

  // the SAME saved setting is inert under every other goal
  for (const goal of ['recomp', 'cut', 'lean_bulk']) {
    const other = { ...lose, goal };
    assert.equal(volumeFloorOf(other), 'evidence', goal);
    assert.equal(resolveTargets(other).minimums.floor.belowFloor, false, goal);
    assert.deepEqual(unitTargets(other), unitTargets({ ...manProfile(), goal }), goal);
  }
  assert.ok(VOLUME_FLOORS.includes('minimum'));
});

test('§23: priority sliders reach 0 (detrain a muscle) only under the weight-loss goal', () => {
  assert.deepEqual(priorityLimits({ goal: 'recomp' }), LIMITS.priority);
  assert.deepEqual(priorityLimits({ goal: 'weight_loss' }), LIMITS.priorityLoss);
  assert.deepEqual(LIMITS.priority, [0.5, 2], 'the normal floor is unchanged');
  // other goals clamp a 0 back up to 0.5
  assert.equal(applyTargetChange({ goal: 'cut' }, { training: { groupPriority: { quads: 0 } } }).groupPriority.quads, 0.5);
  const p = applyTargetChange(manProfile(), { goals: { leanProtection: 'minimal' } });
  const zeroed = applyTargetChange(p, { training: { groupPriority: { quads: 0, calves: 0 } } });
  assert.equal(zeroed.groupPriority.quads, 0);
  const U = unitTargets(zeroed);
  assert.equal(U.quads.target, 0, 'a 0x slider means no planned sets');
  assert.equal(U.quads.min, 0);
  assert.ok(U.quads.growthBase > 0, 'the growth number is still reported, so the UI can show what was given up');
  // switching the goal away brings the floors straight back
  assert.ok(unitTargets({ ...zeroed, goal: 'cut' }).quads.target > 0);
});

test('§23: floors and safety warnings fire, and the evidence is attached', () => {
  const t = resolveTargets(applyTargetChange(manProfile({ body: { goalWeightLb: 160, lossRatePctPerWeek: 1.4 } }), { goals: { leanProtection: 'minimal' } }));
  assert.ok(t.warnings.some(w => /aggressive|beyond anything tested/i.test(w)), JSON.stringify(t.warnings));
  assert.ok(t.warnings.some(w => /below the volume that builds muscle/i.test(w)));
  assert.ok(t.warnings.some(w => /Mettler 2010/.test(w)), 'low protein is called out');
  assert.ok(t.minimums.floor.evidence.some(e => /Bickel/.test(e.source)));
  assert.ok(t.minimums.floor.evidence.some(e => /doi:/.test(e.source)), 'every floor claim carries a DOI');

  // the projection raises its own, simulated warnings
  const r = run(manProfile({ body: { goalWeightLb: 120, lossRatePctPerWeek: 1.4 } }), { weeks: 78 });
  const w = r.weightLoss.warnings.join(' | ');
  assert.match(w, /essential fat|cannot go below|defend/i);
  assert.match(w, /Murphy & Koehler 2022/);
  assert.ok(r.energyAvailability, 'energy availability is checked for men under this goal');
  assert.match(r.assumptions.join(' '), /Forbes/);
  assert.match(r.assumptions.join(' '), /Garthe 2011/);
  assert.match(r.assumptions.join(' '), /Villareal 2006/);
  // and it still never blocks: the projection runs and is finite
  assert.deepEqual(findBad(r.series), []);
  assert.ok(r.series.length > 2);
});

test('§23: a rate faster than the body delivers is reported, not hidden', () => {
  const r = run(manProfile({ body: { goalWeightLb: 160, lossRatePctPerWeek: 0.7 } }));
  const wl = r.weightLoss;
  assert.ok(wl.projectedLbPerWeek > 0 && wl.projectedLbPerWeek < wl.lbPerWeek, `${wl.projectedLbPerWeek} < ${wl.lbPerWeek}`);
  assert.ok(wl.warnings.some(x => /only delivers/.test(x)));
});

// ---------------------------------------------------------------- nutrition
test('§23: nutrition sizes the deficit from the rate and matches the projection', () => {
  const p = manProfile({ body: { goalWeightLb: 160, lossRatePctPerWeek: 0.7 }, nutrition: { mode: 'simple' } });
  const t = dailyTargets(p, { bodyweight: 180, tdee: 2700 });
  assert.equal(t.goal, 'weight_loss');
  assert.equal(t.calories, 2070);                         // 2700 − 630
  assert.equal(t.calories, 2700 - lossRateDeficit(180, 0.7));
  // carb cycling still works and averages near the same place
  const cyc = { ...p, nutrition: { mode: 'cycling' } };
  const days = ['lift', 'cardio', 'rest', 'both'].map(d => dailyTargets(cyc, { dayType: d, bodyweight: 180, tdee: 2700 }).calories);
  assert.ok(Math.min(...days) < 2070 && Math.max(...days) > 2070, String(days));
  // a user-set calorie target still wins
  assert.equal(dailyTargets({ ...p, nutrition: { mode: 'simple', calories: 2400 } }, { bodyweight: 180, tdee: 2700 }).calories, 2400);
  // lower protein is framed as lean loss, not slower growth
  const m = macrosFor({ ...p, nutrition: { mode: 'simple', proteinGPerLb: 0.6 } }, { calories: 2070, bodyweight: 180 });
  assert.ok(m.warnings.some(x => /Mettler 2010/.test(x)), JSON.stringify(m.warnings));
  assert.ok(!m.warnings.some(x => /muscle gain is reduced/.test(x)));
  // and energy availability is checked for men here too
  const ea = dailyTargets(p, { bodyweight: 180, tdee: 2700, leanLb: 135, exerciseKcal: 400 });
  assert.ok(ea.energyAvailability < 30 && ea.warnings.some(x => /Energy availability/.test(x)));
  // §20 is untouched: pregnancy never plans a deficit, even under this goal
  const preg = dailyTargets({ ...p, body: { ...p.body, sex: 'female', pregnancy: 'pregnant' } }, { bodyweight: 150, tdee: 2200 });
  assert.ok(preg.calories >= 2200 - 160, String(preg.calories));
});

// ---------------------------------------------------------------- cohesion
test('§23: one resolver drives every screen, and changes describe themselves', () => {
  const before = manProfile({ body: { goalWeightLb: null } });
  const after = applyTargetChange(before, { goals: { goalWeightLb: 160, lossRatePctPerWeek: 1, leanProtection: 'balanced' } });
  const txt = describeChange(before, after);
  assert.match(txt, /goal weight 160 lb/);
  assert.match(txt, /1%\/week loss/);
  assert.match(txt, /balanced|maintenance/i);
  // the set floors change what the planner builds, so they force a re-plan
  assert.ok(needsReplan(after, applyTargetChange(after, { training: { volumePolicy: { floors: 'minimum' } } })));
  // the same numbers come out of the resolver, the nutrition engine and the projection
  const t = resolveTargets(after, { now: NOW });
  const r = run(after);
  // lossPlan() uses profile.bodyweight; the projection uses the baseline's weigh-in trend. In the app
  // store.logBodyweight keeps them in step, so they agree to within a rounding of the latest weigh-in.
  assert.ok(Math.abs(t.goals.plan.deficitKcal - r.weightLoss.deficitKcal) <= 10,
    `${t.goals.plan.deficitKcal} vs ${r.weightLoss.deficitKcal}`);
  assert.equal(t.goals.goalWeightLb, r.weightLoss.goalWeightLb);
  assert.equal(t.goals.lossRatePctPerWeek, r.weightLoss.ratePctPerWeek);
  const nt = dailyTargets({ ...after, nutrition: { ...after.nutrition, mode: 'simple' } }, { bodyweight: 180, tdee: Math.round(r.energy.tdeeStart) });
  assert.ok(Math.abs(nt.calories - r.energy.intakeStart) <= 15, `${nt.calories} vs ${r.energy.intakeStart}`);
});

test('§23: the goal-specific machinery stays gated to weight_loss', () => {
  // The deficit PARTITION is universal (see the §23-universal tests below), but the goal weight, the
  // "what it costs" block, the below-growth floors and the 0x priority sliders are weight_loss only.
  const snap = goal => {
    const p = manProfile({ goal, nutrition: { mode: 'simple' }, body: { goalWeightLb: 160, lossRatePctPerWeek: 1.4, leanProtection: 'minimal' } });
    const q = { ...p, volumePolicy: { ...(p.volumePolicy || {}), floors: 'minimum' }, groupPriority: { quads: 0.5 } };
    const r = project({ baseline: baseOf(q), profile: q, sessions: bobPlan(TODAY, 2), weeks: 26, now: NOW });
    return JSON.stringify({ series: r.series, summary: r.summary, milestones: r.milestones, weekly: r.weekly,
      partition: r.partition, energy: r.energy, assumptions: r.assumptions,
      units: unitTargets(q), mins: weeklyMinimums(q), floor: resolveTargets(q).minimums.floor.mode,
      nut: ['lift', 'rest'].map(d => dailyTargets(q, { dayType: d, bodyweight: 180, tdee: 2700 })) });
  };
  for (const goal of ['recomp', 'cut', 'lean_bulk']) {
    const r = JSON.parse(snap(goal));
    assert.equal(r.floor, 'evidence', `${goal}: below-floor settings are inert`);
    assert.equal(r.units.triceps.min, 10, `${goal}: the evidence floor is intact`);
    assert.ok(r.units.quads.growthMin === undefined, `${goal}: no lowered-floor annotation`);
    assert.equal(r.weightLoss, undefined, `${goal}: no weight-loss block`);
    // the goal WEIGHT is weight_loss-only: no goal_weight milestone leaks into the other goals
    assert.ok(!r.milestones.some(m => m.id === 'goal_weight'), `${goal}: no goal-weight milestone`);
    // the shared deficit model, however, IS explained everywhere (Bob: "better model everywhere")
    assert.ok(r.assumptions.join(' ').includes('Garthe 2011'), `${goal}: the partition is explained`);
    assert.ok(!r.assumptions.join(' ').includes('Your goal is LOSING WEIGHT'), `${goal}: no weight-loss lead-in`);
  }
  // and the goal really does change things when it IS weight_loss
  const wl = run(manProfile({ nutrition: { mode: 'simple' }, body: { goalWeightLb: 160, lossRatePctPerWeek: 1.4 } }));
  assert.ok(wl.weightLoss);
  assert.match(wl.assumptions.join(' '), /Garthe 2011/);
  assert.match(wl.assumptions.join(' '), /Your goal is LOSING WEIGHT/);
  assert.match(wl.assumptions.join(' '), /Villareal 2006/);
});

test('§23: a saved floor mode survives unrelated volumePolicy edits', () => {
  let p = applyTargetChange(manProfile(), { training: { volumePolicy: { floors: 'minimum' } } });
  p = applyTargetChange(p, { training: { volumePolicy: { maxMinutes: 100 } } });
  assert.equal(p.volumePolicy.floors, 'minimum');
  assert.equal(p.volumePolicy.maxMinutes, 100);
  assert.equal(volumeFloorOf(p), 'minimum');
  // and a profile that never set one still reports no floors key at all
  assert.equal(resolveTargets(defaultProfile()).training.volumePolicy.floors, undefined);
});

test('§23: the rate presets are the ones the evidence names', () => {
  const pcts = LOSS_RATES.map(r => r.pctPerWeek);
  assert.ok(pcts.includes(0.7) && pcts.includes(1), 'Garthe 2011\'s two achieved rates are offered');
  assert.ok(LOSS_RATES.find(r => r.pctPerWeek === 0.7).note.includes('Garthe'));
  assert.deepEqual([...pcts].sort((a, b) => a - b), pcts, 'listed slowest first');
  assert.ok(Object.keys(FLOOR_FACTOR).every(k => VOLUME_FLOORS.includes(k)));
});

// ---------------------------------------------------------------- §23 universal: the model is not the label
// "Better model everywhere": the deficit partition (Forbes + the deficit protein-retention curve + the
// Garthe rate penalty + the 0.95 clamp) runs under EVERY goal. Physiology does not read the goal field.
const noGoalWeight = { goalWeightLb: null, lossRatePctPerWeek: null };
// Same food, same protein, same training — only the goal label differs.
const atGoalLabel = (goal, deficit, protein, weeks = 26) => {
  const p = manProfile({ goal, body: { ...noGoalWeight } });
  return project({ baseline: baseOf(p), profile: p, sessions: bobPlan(TODAY, 2), weeks, now: NOW,
    intake: { surplus: -deficit, proteinGPerLb: protein } });
};

test('§23 universal: the goal label does not change the deficit partition', () => {
  const ref = atGoalLabel('recomp', 600, 0.8);
  for (const goal of ['cut', 'weight_loss', 'lean_bulk']) {
    const r = atGoalLabel(goal, 600, 0.8);
    assert.equal(r.partition.leanLossLb, ref.partition.leanLossLb, `${goal}: same lean lost`);
    assert.equal(r.partition.leanLossFrac, ref.partition.leanLossFrac, `${goal}: same lean share of the loss`);
    assert.equal(r.partition.lossRatePctPerWeek, ref.partition.lossRatePctPerWeek, `${goal}: same rate`);
    assert.deepEqual(r.series.map(p => [p.leanLb, p.fatLb]), ref.series.map(p => [p.leanLb, p.fatLb]), `${goal}: same series`);
  }
  // and it really is the §23 model, not the old one: the partition is reported for a plain recomp
  assert.ok(ref.partition.leanLossLb > 0 && ref.partition.leanLossFrac > 0);
  assert.ok(ref.partition.lossRatePctPerWeek > 0);
  assert.deepEqual(findBad(ref.series), []);
});

test('§23 universal: cut and recomp pay the rate and protein penalties too', () => {
  // Slow + high protein vs fast + low protein, both under `cut`, both honest.
  const slow = atGoalLabel('cut', 350, 1.1), fast = atGoalLabel('cut', 1000, 0.5);
  assert.ok(fast.partition.leanLossLb > slow.partition.leanLossLb * 4,
    `a fast low-protein cut costs materially more lean (${fast.partition.leanLossLb} vs ${slow.partition.leanLossLb})`);
  assert.ok(fast.partition.leanLossFrac > slow.partition.leanLossFrac,
    `${fast.partition.leanLossFrac} vs ${slow.partition.leanLossFrac}`);
  assert.ok(fast.partition.lossRatePctPerWeek > slow.partition.lossRatePctPerWeek);
  // each lever on its own, under `recomp`, at the same calories
  const hiP = atGoalLabel('recomp', 1000, 1.1), loP = atGoalLabel('recomp', 1000, 0.5);
  assert.ok(loP.partition.leanLossLb > hiP.partition.leanLossLb,
    `low protein loses more lean under recomp (${loP.partition.leanLossLb} vs ${hiP.partition.leanLossLb})`);
  const slowSame = atGoalLabel('recomp', 350, 0.8), fastSame = atGoalLabel('recomp', 1000, 0.8);
  assert.ok(fastSame.partition.leanLossFrac > slowSame.partition.leanLossFrac,
    `the rate penalty bites under recomp (${fastSame.partition.leanLossFrac} vs ${slowSame.partition.leanLossFrac})`);
  // the lean share of every pound lost is never allowed past the 0.95 clamp
  for (const r of [slow, fast, hiP, loP]) assert.ok(r.partition.leanLossFrac <= 0.95);
});

test('§23 universal: a surplus is untouched and a tiny deficit costs almost nothing', () => {
  // lean_bulk in a surplus never enters the branch at all
  const bulk = atGoalLabel('lean_bulk', -300, 0.8);     // = +300 kcal/day
  assert.equal(bulk.partition.leanLossLb, 0);
  assert.equal(bulk.partition.leanLossFrac, null, 'no deficit weeks, so nothing to report');
  assert.equal(bulk.partition.lossRatePctPerWeek, null);
  assert.ok(bulk.summary.leanLb > 0 && bulk.summary.fatLb > 0);
  // 50 kcal/day: continuous, tiny, and nowhere near a cliff.
  // THRESHOLD RAISED 0.15 → 0.25 lb (2026-10-21, §11 per-muscle protection). The old number was tuned when
  // lean-loss protection was whole-body: bobPlan trains almost no legs and zero calves, yet those groups got
  // the full benefit of its shoulder volume. They are now exposed in proportion to their OWN sets
  // (Bickel 2011, Spiering 2021), so a share-weighted body with untrained groups loses slightly more. 0.17 lb
  // of lean over 26 weeks against +4.6 lb gained is still "almost nothing", which is what this test means.
  const tiny = atGoalLabel('recomp', 50, 0.8), none = atGoalLabel('recomp', 0, 0.8);
  assert.ok(tiny.partition.leanLossLb >= 0 && tiny.partition.leanLossLb < 0.25,
    `a 50 kcal deficit must not suddenly cost lean mass (${tiny.partition.leanLossLb} lb over 26 weeks)`);
  assert.ok(tiny.partition.leanLossLb >= none.partition.leanLossLb - 1e-9);
  assert.ok(tiny.summary.leanLb > 0, 'and it still builds muscle');
  // monotone in the deficit, with no jump: 0 → 50 → 150 → 300 → 600
  let prev = -1;
  for (const d of [0, 50, 150, 300, 600]) {
    const v = atGoalLabel('recomp', d, 0.8).partition.leanLossLb;
    assert.ok(v >= prev - 1e-9, `lean lost should rise with the deficit (${d}: ${v} after ${prev})`);
    prev = v;
  }
  // the rate curve itself is finite and bounded everywhere, including nonsense input
  for (const x of [0, 1e-9, 0.35, 0.7, 1, 2, 50, 1e6, -5, NaN, undefined, null, 'x']) {
    const f = lossRateFactor(x);
    assert.ok(Number.isFinite(f) && f >= 0.5 && f <= 3, `lossRateFactor(${x}) = ${f}`);
  }
  for (const x of [0, 0.3, 0.8, 5, -1, NaN, undefined, null]) {
    const f = proteinRetentionFactor(x);
    assert.ok(Number.isFinite(f) && f > 0 && f <= 1, `proteinRetentionFactor(${x}) = ${f}`);
  }
});

test('§23 universal: the partition is explained and the lab tells the deficit story', () => {
  const r = atGoalLabel('recomp', 600, 0.8);
  const txt = r.assumptions.join(' ');
  assert.match(txt, /Garthe 2011/);
  assert.match(txt, /Mettler 2010/);
  assert.match(txt, /whatever your goal is called/);
  assert.ok(!/prevents most \(~90%\)/.test(txt), 'the old "muscle is basically safe" line is gone');
  const lab = nutritionLab({ baseline: baseOf(manProfile({ goal: 'cut', body: { ...noGoalWeight } })),
    profile: manProfile({ goal: 'cut', body: { ...noGoalWeight } }), sessions: bobPlan(TODAY, 2), weeks: 26, now: NOW,
    calorieRange: [-750, 500], step: 250, proteinGPerLb: 0.6 });
  const le = lab.explanation.join(' ');
  assert.match(le, /deficit end of this sweep is not free/);
  assert.match(le, /same partition whatever your goal is called/);
});
