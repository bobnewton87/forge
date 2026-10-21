import test from 'node:test';
import assert from 'node:assert/strict';
import { baseline } from '../js/engine/bodycomp.js';
import { project, leanRatePctPerMonth, energyFactor, volumeFactor, setResponse, maintenanceProtection, proteinFactor,
  interferenceFactor, MUSCLE_SHARE } from '../js/engine/projection.js';
import { bobProfile, bobBodyLog, bobMeas, bobPlan, NOW, TODAY, findBad } from './body-fixtures.js';

const bobBase = (profile = bobProfile(), meas = bobMeas()) => baseline({ profile, bodyLog: bobBodyLog(), measurements: meas, now: NOW });
const run = (goal, extra = {}) => {
  const profile = bobProfile({ goal });
  return project({ baseline: bobBase(profile), profile, sessions: bobPlan(TODAY, 2), weeks: 12, now: NOW, ...extra });
};
const end = r => r.series[r.series.length - 1];

test('model curves are monotone and sensible', () => {
  assert.ok(leanRatePctPerMonth(0) > leanRatePctPerMonth(12) && leanRatePctPerMonth(12) > leanRatePctPerMonth(36));
  assert.ok(energyFactor(-1000) < energyFactor(-300) && energyFactor(-300) < energyFactor(0) && energyFactor(0) < energyFactor(300));
  const ratio = energyFactor(-300) / energyFactor(250);
  assert.ok(ratio > 0.4 && ratio < 0.55, String(ratio));                     // a deficit roughly halves it
  assert.ok(energyFactor(-1000) < 0.2);                                       // a big deficit → near zero
  assert.ok(energyFactor(1000) - energyFactor(500) < 0.05);                   // saturates in a surplus
  assert.equal(volumeFactor(0), 0);
  assert.ok(volumeFactor(50) < volumeFactor(105) && volumeFactor(105) <= 1.0001 && volumeFactor(400) <= 1.1);
  // per-group set response: 0 → 0, 10 → 1, diminishing, no decline anywhere.
  // Shape = SQUARE ROOT of fractional weekly sets, the best-fit model in Pelland 2025
  // (doi:10.1007/s40279-025-02344-w), exact to R_KNEE = 20 sets and bending to a plateau past the volumes
  // anyone has studied. CHANGED 2026-10-21: the old double-exponential plateaued at 1.36, which understated
  // 15-30 sets by 10-25 % against the meta-regression and flattened per-muscle emphasis.
  assert.equal(setResponse(0), 0);
  assert.ok(Math.abs(setResponse(10) - 1) < 1e-9);
  assert.ok(setResponse(20) - setResponse(10) < setResponse(10) - setResponse(0));
  assert.ok(setResponse(3) > 0.5 && setResponse(3) < 0.7, String(setResponse(3)));     // first sets do the most (Schoenfeld 2017)
  // exact √ through the data-supported range
  for (const s of [1, 2, 4, 8, 12, 16, 20]) assert.ok(Math.abs(setResponse(s) - Math.sqrt(s / 10)) < 1e-9, `√ at ${s}`);
  // past the knee it bends below √ and asymptotes, but keeps rising (Pelland: "diminishing returns but not an inverted-U")
  assert.ok(setResponse(30) > setResponse(20) && setResponse(30) < Math.sqrt(3));
  assert.ok(setResponse(60) > 2 && setResponse(1e4) < 2.5, `${setResponse(60)} / ${setResponse(1e4)}`);
  for (let x = 0; x < 200; x += 1) assert.ok(setResponse(x + 1) >= setResponse(x));
  // emphasis must be visible: 2x the sets is a materially bigger stimulus everywhere it matters
  for (const s of [4, 6, 8, 10, 12]) assert.ok(setResponse(2 * s) / setResponse(s) > 1.3, `2x at ${s} sets`);
  assert.ok(Math.abs(Object.values(MUSCLE_SHARE).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  // protein: plateau at 1 g/lb, clearly reduced at 0.5
  assert.equal(proteinFactor(1.0), 1); assert.equal(proteinFactor(1.4), 1);
  assert.ok(proteinFactor(0.5) < 0.75 && proteinFactor(0.4) <= 0.5 + 1e-9 && proteinFactor(0.8) > 0.95);
  // Cardio interference: free up to 250 effective min, then small, capped at 12 %.
  // CHANGED 2026-10-21: was free to 150 min, 4 %/100 min, cap 20 %. Schumann 2022
  // (doi:10.1007/s40279-021-01587-7, 43 trials) found hypertrophy SMD −0.01 (95 % CI −0.16 to 0.18) for
  // concurrent vs resistance-only training and no cycling-vs-running difference, so the old magnitude was
  // not defensible — and cardio's calorie cost is already modelled separately.
  assert.equal(interferenceFactor(100), 1);
  assert.equal(interferenceFactor(250), 1);
  assert.ok(interferenceFactor(400) > 0.95 && interferenceFactor(400) < 1, String(interferenceFactor(400)));
  assert.ok(interferenceFactor(5000) >= 0.88 - 1e-9 && interferenceFactor(5000) <= 0.88 + 1e-9);
  for (let m = 0; m < 1200; m += 25) assert.ok(interferenceFactor(m + 25) <= interferenceFactor(m) + 1e-12);
});

test('maintenance volume holds a muscle that growth volume would build (Bickel 2011, Spiering 2021)', () => {
  assert.equal(maintenanceProtection(0), 0);
  // ~2-3 fractional sets/week is already most of the protection, where setResponse is still climbing to 20+
  assert.ok(maintenanceProtection(1) > 0.5 && maintenanceProtection(1) < 0.65, String(maintenanceProtection(1)));
  assert.ok(maintenanceProtection(2) > 0.78, String(maintenanceProtection(2)));
  assert.ok(maintenanceProtection(3) > 0.9, String(maintenanceProtection(3)));
  assert.ok(maintenanceProtection(6) > 0.99);
  assert.ok(maintenanceProtection(1e6) <= 1);
  for (let s = 0; s < 30; s += 0.5) assert.ok(maintenanceProtection(s + 0.5) >= maintenanceProtection(s));
  // THE point of the curve: protection saturates far earlier than growth does.
  assert.ok(maintenanceProtection(3) / maintenanceProtection(12) > 0.9, 'maintenance is nearly maxed at 3 sets');
  assert.ok(setResponse(3) / setResponse(12) < 0.55, 'growth is nowhere near maxed at 3 sets');
});

test('Bob recomp (~300 kcal deficit, 4 lift + 120 cardio min) lands in the plausible range', () => {
  const r = run('recomp');
  const s = r.summary;
  assert.ok(s.fatLb <= -4 && s.fatLb >= -8, `fat ${s.fatLb}`);
  assert.ok(s.leanLb >= 1 && s.leanLb <= 3, `lean ${s.leanLb}`);
  assert.ok(s.bodyFatPct <= -2 && s.bodyFatPct >= -4.5, `bf ${s.bodyFatPct}`);
  assert.ok(s.waist < 0 && s.waist > -2, `waist ${s.waist}`);
  assert.equal(r.series.length, 13);
  assert.equal(r.series[0].date, TODAY);
  assert.equal(r.series[0].weightLb, 164);
  assert.equal(r.energy.intakeSource, 'goal');
  assert.ok(r.weekly.cardioMinPerWeek >= 90 && r.weekly.cardioMinPerWeek <= 125, String(r.weekly.cardioMinPerWeek));
  assert.ok(r.weekly.kcalIn < r.weekly.kcalOut);
});

test('cut loses more fat and weight than recomp; bulk gains weight and the most lean', () => {
  const rc = run('recomp').summary, cut = run('cut').summary, bulk = run('lean_bulk').summary;
  assert.ok(cut.fatLb < rc.fatLb && cut.weightLb < rc.weightLb);
  assert.ok(cut.fatLb <= -7 && cut.fatLb >= -13, `cut fat ${cut.fatLb}`);
  assert.ok(cut.leanLb >= -1 && cut.leanLb <= 2, `cut lean ${cut.leanLb}`);
  assert.ok(bulk.weightLb > 2 && bulk.weightLb < 9, `bulk weight ${bulk.weightLb}`);
  assert.ok(bulk.leanLb > rc.leanLb && bulk.leanLb <= 5, `bulk lean ${bulk.leanLb}`);
  assert.ok(bulk.fatLb > 0);
});

test('explicit intake overrides goal; nutrition mode drives intake when on', () => {
  const r = run('recomp', { intake: 2600 });
  assert.equal(r.energy.intakeSource, 'arg'); assert.equal(r.weekly.kcalIn, 2600);
  assert.ok(r.summary.weightLb > 0);
  const p = bobProfile({ goal: 'cut', nutrition: { mode: 'simple', calories: null, protein: null } });
  const n = project({ baseline: bobBase(p), profile: p, sessions: bobPlan(TODAY, 2), now: NOW });
  assert.equal(n.energy.intakeSource, 'nutrition');
  const c = bobProfile({ goal: 'recomp', nutrition: { mode: 'cycling' } });
  const nc = project({ baseline: bobBase(c), profile: c, sessions: bobPlan(TODAY, 2), now: NOW });
  assert.equal(nc.energy.intakeSource, 'nutrition');
  assert.deepEqual(findBad([n, nc]), []);
});

test('more training (and adherence) → more lean; no training → ~no lean gain', () => {
  const profile = bobProfile();
  const b = bobBase(profile);
  const lo = project({ baseline: b, profile, sessions: bobPlan(TODAY, 12), adherence: 0.4, now: NOW });
  const hi = project({ baseline: b, profile, sessions: bobPlan(TODAY, 12), adherence: 1, now: NOW });
  assert.ok(hi.summary.leanLb > lo.summary.leanLb);
  const none = project({ baseline: b, profile: { ...profile, schedule: null }, sessions: [], now: NOW });
  assert.ok(none.summary.leanLb <= 0.05, String(none.summary.leanLb));
  assert.equal(none.driverSource, 'none');
  assert.ok(none.missing.includes('sessions'));
});

test('repeatPlan extends a short plan; without it training stops after the last planned day', () => {
  const profile = bobProfile();
  const b = bobBase(profile);
  const rep = project({ baseline: b, profile, sessions: bobPlan(TODAY, 1), repeatPlan: true, now: NOW });
  const no = project({ baseline: b, profile, sessions: bobPlan(TODAY, 1), repeatPlan: false, now: NOW });
  assert.ok(rep.summary.leanLb > no.summary.leanLb);
  assert.ok(rep.weekly.perWeek[5].liftSets > 0);
  assert.equal(no.weekly.perWeek[5].liftSets, 0);
});

test('history alone and schedule alone can drive the projection', () => {
  const profile = bobProfile();
  const b = bobBase(profile);
  const hist = project({ baseline: b, profile, sessions: bobPlan('2026-09-21', 4, { status: 'done' }), now: NOW });
  assert.equal(hist.driverSource, 'history');
  assert.ok(hist.weekly.liftSetsPerWeek > 40 && hist.summary.leanLb > 0.5);
  const sched = project({ baseline: b, profile: { ...profile, schedule: { mon: { kind: 'lift', minutes: 45 }, wed: { kind: 'cardio', minutes: 40 }, sat: { kind: 'flex', minutes: 60 } } }, sessions: [], now: NOW });
  assert.equal(sched.driverSource, 'schedule');
  assert.ok(sched.weekly.liftSetsPerWeek > 0 && sched.weekly.cardioMinPerWeek > 0);
});

test('bands contain the likely line and widen over time', () => {
  const r = project({ baseline: bobBase(), profile: bobProfile(), sessions: bobPlan(TODAY, 2), weeks: 24, now: NOW });
  let prevW = -1, prevB = -1;
  for (const p of r.series) {
    for (const k of ['weightLb', 'bodyFatPct', 'leanLb']) assert.ok(p.low[k] <= p[k] + 1e-9 && p[k] <= p.high[k] + 1e-9, `${p.date} ${k}`);
    const w = p.high.weightLb - p.low.weightLb, bb = p.high.bodyFatPct - p.low.bodyFatPct;
    assert.ok(w >= prevW - 0.05 && bb >= prevB - 0.05, `band shrank at ${p.date}`);
    prevW = w; prevB = bb;
  }
  assert.equal(r.series[0].high.weightLb - r.series[0].low.weightLb, 0);
  assert.ok(prevW > 3);
});

test('low-data projections get wider bands and lower confidence', () => {
  const p = bobProfile();
  const rich = project({ baseline: bobBase(p), profile: p, sessions: [...bobPlan('2026-09-21', 4, { status: 'done' }), ...bobPlan(TODAY, 2)], now: NOW });
  const poorB = baseline({ profile: p, bodyLog: [{ d: '2026-06-01', w: 164 }], measurements: [], now: NOW });
  const poor = project({ baseline: poorB, profile: p, sessions: bobPlan(TODAY, 2), now: NOW });
  assert.equal(rich.confidence, 'high');
  assert.equal(poor.confidence, 'low');
  const width = r => end(r).high.weightLb - end(r).low.weightLb;
  assert.ok(width(poor) > width(rich));
});

test('milestones: valid dates, monotonic, in order', () => {
  const p = bobProfile({ goal: 'cut' });
  const r = project({ baseline: bobBase(p), profile: p, sessions: bobPlan(TODAY, 2), weeks: 52, now: NOW });
  const by = Object.fromEntries(r.milestones.map(m => [m.id, m]));
  for (const id of ['abs_upper', 'six_pack', 'goal_bf', 'sw_1_5', 'sw_1618', 'lean_5', 'lean_10', 'lean_vs_race']) assert.ok(by[id], id);
  for (const m of r.milestones) {
    assert.ok(m.date === null || /^\d{4}-\d{2}-\d{2}$/.test(m.date), m.id);
    assert.ok(m.date === null || (m.date >= TODAY && m.date <= end(r).date), m.id);
    assert.equal(typeof m.label, 'string'); assert.equal(typeof m.note, 'string');
  }
  const le = (a, b) => assert.ok(by[b].date === null || (by[a].date !== null && by[a].date <= by[b].date), `${a} before ${b}`);
  le('abs_upper', 'six_pack'); le('sw_1_5', 'sw_1618'); le('lean_5', 'lean_10');
  assert.ok(by.abs_upper.date, 'a 52-week cut from 22% should reach upper abs');
  // milestone date matches the first series point crossing the threshold (§20b: 15 % DXA-equivalent, was 12 % colloquial)
  assert.equal(by.abs_upper.target, 15);
  const first = r.series.find(pt => pt.bodyFatPct <= by.abs_upper.target);
  assert.equal(by.abs_upper.date, first.date);
  // series dates strictly increasing, weekly
  for (let i = 1; i < r.series.length; i++) assert.ok(r.series[i].date > r.series[i - 1].date);
});

test('shoulder:waist milestones only when both are measured', () => {
  const p = bobProfile();
  const meas = bobMeas().map(({ shoulders, ...m }) => m);
  const r = project({ baseline: bobBase(p, meas), profile: p, sessions: bobPlan(TODAY, 2), now: NOW });
  assert.ok(!r.milestones.some(m => m.id.startsWith('sw_')));
  assert.ok(r.shapeEstimated.includes('shoulders'));
  assert.equal(r.series[0].measurements.shoulders, undefined);
  assert.ok(r.series[0].shape.shoulders > 30);
  assert.equal(r.series[0].ratios.shoulderToWaist, null);
});

test('measurements: waist shrinks with fat loss, arms/shoulders grow with lean gain in a bulk', () => {
  const rc = run('recomp'), bulk = run('lean_bulk');
  const m0 = rc.series[0].measurements;
  assert.ok(end(rc).measurements.waist < m0.waist);
  assert.ok(end(bulk).measurements.arm > m0.arm);
  assert.ok(end(bulk).measurements.shoulders > m0.shoulders);
  assert.ok(end(bulk).measurements.arm - m0.arm < 1.5);
  for (const s of Object.keys(m0)) assert.ok(Math.abs(end(rc).measurements[s] - m0[s]) < 2.5, s);
});

test('missing data: weight only, no height/measurements → still projects weight and BF', () => {
  const p = bobProfile();
  p.body = { ...p.body, heightIn: null, birthYear: null };
  const b = baseline({ profile: p, bodyLog: [{ d: '2026-10-18', w: 164 }], measurements: [], now: NOW });
  const r = project({ baseline: b, profile: p, sessions: bobPlan(TODAY, 2), now: NOW });
  assert.equal(r.series.length, 13);
  assert.equal(r.bodyFatAssumed, true);
  assert.ok(r.series.every(pt => pt.bodyFatPct > 0 && pt.weightLb > 0));
  assert.deepEqual(r.series[0].measurements, {});
  assert.equal(r.shapeEstimated.length, 9);
  for (const f of ['height', 'waist', 'neck', 'bodyFat']) assert.ok(r.missing.includes(f), f);
  assert.ok(r.assumptions.some(a => /ASSUMED/.test(a)));
  assert.equal(r.confidence, 'low');
  assert.deepEqual(findBad(r), []);
});

test('no weight / no baseline → empty but well-formed result', () => {
  for (const b of [null, undefined, baseline({ now: NOW })]) {
    const r = project({ baseline: b, profile: {}, sessions: [], now: NOW });
    assert.deepEqual(r.series, []); assert.deepEqual(r.milestones, []);
    assert.ok(r.assumptions.length > 0); assert.ok(r.missing.includes('weight'));
    assert.deepEqual(findBad(r), []);
  }
});

test('no NaN/Infinity anywhere across many configurations, assumptions are plain strings', () => {
  const profiles = [bobProfile(), bobProfile({ goal: 'cut' }), bobProfile({ goal: 'lean_bulk', nutrition: { mode: 'cycling' } }),
    { body: { sex: 'female', heightIn: 64, trainingMonths: 0, activity: 'active' }, goal: 'weird' }, { body: { trainingMonths: 'x' } }, null];
  const sessionsSets = [[], bobPlan(TODAY, 2), bobPlan('2026-09-21', 4, { status: 'done' }),
    [{ date: TODAY, status: 'planned', blocks: [{ kind: 'lift', exId: 'nope', sets: [] }, { kind: 'class', classify: null }, { kind: 'cardio', modality: '??', minutes: 'x' }] }, { status: 'planned' }, null]];
  for (const p of profiles) for (const ss of sessionsSets) for (const weeks of [1, 12, 104, 0, 'x']) for (const adherence of [0, 0.85, 1, NaN]) {
    const b = baseline({ profile: p, bodyLog: [{ d: '2026-10-01', w: 150 }], measurements: [{ d: '2026-10-01', waist: 31, neck: 14, hips: 37 }], now: NOW });
    const r = project({ baseline: b, profile: p, sessions: ss, weeks, adherence, now: NOW });
    const bad = findBad(r);
    assert.deepEqual(bad, [], JSON.stringify({ p, weeks, adherence }));
    assert.ok(r.series.length >= 2);
    assert.ok(r.assumptions.every(a => typeof a === 'string' && a.length > 10 && !/NaN|undefined|null/.test(a)), r.assumptions.find(a => /NaN|undefined|null/.test(a)));
    assert.ok(['low', 'medium', 'high'].includes(r.confidence));
  }
});
