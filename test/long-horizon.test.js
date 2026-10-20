// LONG-HORIZON: projections out to 5 years (260 weeks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { baseline } from '../js/engine/bodycomp.js';
import { project, nutritionLab, leanRatePctPerMonth, ceilingFactor, testosteroneCeilingShift, sampleWeeks, buildPhasePlan,
  PHASE_PRESETS, FFMI_NATURAL_CEILING, MAX_WEEKS } from '../js/engine/projection.js';
import { bobProfile, bobBodyLog, bobMeas, bobPlan, NOW, TODAY, findBad } from './body-fixtures.js';

const P = bobProfile();
const B = baseline({ profile: P, bodyLog: bobBodyLog(), measurements: bobMeas(), now: NOW });
const PLAN = bobPlan(TODAY, 2);
const neutral = o => () => ({ leanCeilingMult: 1, leanRetentionMult: 1, partitionShift: 0, tdeeDelta: 0, intakeDelta: 0, waterLb: 0,
  leanDirectLbPerWeek: 0, fatDirectLbPerWeek: 0, contributions: [], warnings: [], ...o });
const long = (extra = {}) => project({ baseline: B, profile: P, sessions: PLAN, weeks: 260, now: NOW, fullSeries: true, ...extra });
const ffmiOf = (leanLb, heightIn = 69) => { const h = heightIn * 0.0254; return leanLb / 2.20462 / (h * h) + 6.1 * (1.8 - h); };

test('training-age decay: monotonic through year 10+, year averages inside the Aragon/McDonald ranges', () => {
  for (let m = 0; m < 200; m += 0.5) assert.ok(leanRatePctPerMonth(m + 0.5) < leanRatePctPerMonth(m), `not decreasing at ${m} mo`);
  const yearAvg = y => { let s = 0; for (let m = 12 * (y - 1); m < 12 * y; m += 0.25) s += leanRatePctPerMonth(m); return s / 48; };
  const [y1, y2, y3, y4, y5] = [1, 2, 3, 4, 5].map(yearAvg);
  assert.ok(y1 >= 1 && y1 <= 1.5, `year 1 ${y1}`);
  assert.ok(y2 >= 0.5 && y2 <= 1, `year 2 ${y2}`);
  assert.ok(y3 >= 0.25 && y3 <= 0.5, `year 3 ${y3}`);
  assert.ok(y4 < y3 && y5 < y4 && y5 > 0.05, `years 4-5 ${y4} ${y5}`);
  // realized lean gain per year shrinks year over year in a steady lean bulk
  const r = long({ intake: { surplus: 300, proteinGPerLb: 1 }, useStack: false });
  const f = r.seriesFull, perYear = [0, 1, 2, 3, 4].map(y => f[52 * (y + 1)].leanLb - f[52 * y].leanLb);
  for (let i = 1; i < perYear.length; i++) assert.ok(perYear[i] < perYear[i - 1], perYear.join(' > '));
});

test('genetic ceiling: soft cap curve, natural FFMI never exceeds the ceiling (bands ≤ ceiling + 1.5)', () => {
  assert.equal(ceilingFactor(5), 1); assert.equal(ceilingFactor(0), 0); assert.equal(ceilingFactor(-1), 0);
  for (let g = 0; g < 4; g += 0.1) assert.ok(ceilingFactor(g + 0.1) >= ceilingFactor(g));
  // extreme natural scenario: double the lean rate, big surplus, 5 years
  const r = long({ intake: { surplus: 800, proteinGPerLb: 1 }, modifiersFn: neutral({ leanCeilingMult: 3 }) });
  let maxF = 0;
  for (const p of r.seriesFull) {
    maxF = Math.max(maxF, p.ffmi);
    assert.ok(ffmiOf(p.leanLb) <= FFMI_NATURAL_CEILING + 0.05, `week ${p.week} FFMI ${ffmiOf(p.leanLb)}`);
    assert.ok(ffmiOf(p.high.leanLb) <= FFMI_NATURAL_CEILING + 1.5 + 0.1, `high band week ${p.week}`);
    assert.ok(p.low.fatLb > 0 && p.low.bodyFatPct >= 4.9, `fat band week ${p.week}`);
  }
  assert.ok(maxF > 23.5, `should approach the ceiling: ${maxF}`);
  assert.equal(r.ceiling.ffmiNatural, 25);
  // someone starting near the ceiling barely moves
  const big = { ...P, body: { ...P.body, trainingMonths: 60 } };
  const bb = baseline({ profile: big, bodyLog: [{ d: TODAY, w: 182 }], measurements: [{ d: TODAY, bodyFat: 10 }], now: NOW });
  const near = project({ baseline: bb, profile: big, sessions: PLAN, weeks: 260, now: NOW, intake: { surplus: 500 }, useStack: false, fullSeries: true });
  const f0 = near.seriesFull[0].ffmi, fN = near.seriesFull[260].ffmi;
  assert.ok(f0 > 24 && fN <= 25.05 && fN - f0 < 1, `${f0} → ${fN}`);
});

test('supraphysiologic testosterone raises the reachable FFMI (Kouri), natural T does not', () => {
  assert.equal(testosteroneCeilingShift(600), 0); assert.equal(testosteroneCeilingShift(1000), 0);
  assert.ok(Math.abs(testosteroneCeilingShift(2400) - 2) < 1e-9);
  assert.equal(testosteroneCeilingShift(9000), testosteroneCeilingShift(2400));   // no extrapolation
  const intake = { surplus: 600, proteinGPerLb: 1 };
  const nat = long({ intake, modifiersFn: neutral({ leanCeilingMult: 2.5 }) });
  const sup = long({ intake, modifiersFn: neutral({ leanCeilingMult: 2.5, testosterone: { source: 'trt', level: 2400, natural: 550 } }) });
  const fNat = ffmiOf(nat.seriesFull[260].leanLb), fSup = ffmiOf(sup.seriesFull[260].leanLb);
  assert.ok(fNat <= 25.05, `natural ${fNat}`);
  assert.ok(fSup > 25.5 && fSup <= 27.05, `supraphysiologic ${fSup}`);
  assert.equal(sup.ceiling.ffmiEffective, 27);
  assert.ok(sup.assumptions.some(a => /raises the reachable ceiling/.test(a)));
  const natHigh = long({ intake, modifiersFn: neutral({ testosterone: { source: 'natural', level: 1200 } }) });
  assert.equal(natHigh.ceiling.tShift, 0);
});

test('fixed intake converges (Hall 2011): week 200→260 weight change < 1 lb; untrained surplus decelerates', () => {
  for (const surplus of [300, -300, 0]) {
    const f = long({ intake: { surplus, proteinGPerLb: 1 }, useStack: false }).seriesFull;
    assert.ok(Math.abs(f[260].weightLb - f[200].weightLb) < 1, `surplus ${surplus}: ${f[200].weightLb} → ${f[260].weightLb}`);
  }
  const untrained = { ...P, schedule: null };
  for (const surplus of [-300, -150]) {
    const f = project({ baseline: B, profile: untrained, sessions: [], weeks: 260, now: NOW, intake: { surplus }, useStack: false, fullSeries: true }).seriesFull;
    assert.ok(Math.abs(f[260].weightLb - f[200].weightLb) < 1, `untrained ${surplus}`);
  }
  // fat-only gains settle slowly but clearly decelerate: year 5 adds < 1/3 of year 1
  const f = project({ baseline: B, profile: untrained, sessions: [], weeks: 260, now: NOW, intake: { surplus: 300 }, useStack: false, fullSeries: true }).seriesFull;
  const y1 = f[52].weightLb - f[0].weightLb, y5 = f[260].weightLb - f[208].weightLb;
  assert.ok(y1 > 5 && y5 < y1 / 3, `${y1} vs ${y5}`);
  // adaptive thermogenesis is bounded and fades after a diet: 12-week cut, then maintenance
  const r = project({ baseline: B, profile: P, sessions: PLAN, weeks: 40, now: NOW, phases: [{ weeks: 12, goal: 'cut', surplus: -600 }, { weeks: 200, goal: 'maintain' }], phasesRepeat: false, useStack: false });
  const pw = r.weekly.perWeek;
  for (const w of pw.slice(12)) assert.equal(w.balance, 0);                  // maintenance = weight-stable
  assert.ok(pw.slice(0, 12).every(w => w.balance < 0), 'deficit during the cut');
});

test('bulk/cut phase cycles: sawtooth fat, lean rising cycle over cycle', () => {
  const r = long({ phases: 'cycles' });
  const f = r.seriesFull;
  assert.ok(r.phases.length >= 22, String(r.phases.length));
  assert.equal(r.phases[0].goal, 'lean_bulk'); assert.equal(r.phases[1].goal, 'cut');
  let prevLean = -1;
  for (let c = 0; c < 10; c++) {
    const s = 22 * c, peak = s + 16, trough = s + 22;
    assert.ok(f[peak].fatLb > f[s].fatLb + 0.5, `cycle ${c}: fat rises in the bulk`);
    assert.ok(f[trough].fatLb < f[peak].fatLb - 1.5, `cycle ${c}: fat falls in the cut`);
    assert.ok(f[trough].leanLb > prevLean, `cycle ${c}: lean keeps rising`);
    prevLean = f[trough].leanLb;
  }
  // phase boundaries are kept in the downsampled series, so the sawtooth peaks survive
  const weeks = new Set(r.series.map(p => p.week));
  for (const ph of r.phases) assert.ok(weeks.has(ph.startWeek), `boundary ${ph.startWeek}`);
  assert.ok(r.series.every(p => p.phase && typeof p.phase.goal === 'string'));
  // sequential plan continues at maintenance; deficit phases stop at the goal
  const bc = long({ phases: 'bulk_cut' });
  assert.equal(bc.phases[bc.phases.length - 1].after, true);
  const rec = long({ phases: 'recomp' });
  assert.ok(rec.seriesFull.every(p => p.bodyFatPct >= 6), 'never below the defended floor');
  assert.ok(rec.phases.some(p => p.maintenanceWeeks > 0), 'reaches goal and switches to maintenance');
  // custom phases, presets and plan helper
  const plan = buildPhasePlan({ blocks: [{ weeks: 4, goal: 'bulk' }, { weeks: 2, goal: 'cut', calories: 2000 }], repeat: true, start: '2026-09-28' }, true, 20, TODAY);
  assert.equal(plan.offset, 3);
  assert.equal(plan.at[0].bi, 0); assert.equal(plan.at[1].bi, 1); assert.equal(plan.at[3].bi, 0);
  assert.equal(plan.blocks[1].calories, 2000);
  assert.equal(PHASE_PRESETS.length, 4);
  assert.equal(buildPhasePlan(null), null); assert.equal(buildPhasePlan('nope'), null); assert.equal(buildPhasePlan([]), null);
});

test('bands widen with the horizon and stay physiological', () => {
  for (const extra of [{ intake: { surplus: 250, proteinGPerLb: 1 } }, { phases: 'cycles' }]) {
    const r = long(extra);
    const width = w => { const p = r.seriesFull[w]; return [p.high.weightLb - p.low.weightLb, p.high.leanLb - p.low.leanLb]; };
    const ws = [4, 26, 52, 104, 260].map(width);
    for (let i = 1; i < ws.length; i++) {
      assert.ok(ws[i][0] >= ws[i - 1][0] - 0.1, `weight band ${JSON.stringify(ws)}`);
      assert.ok(ws[i][1] >= ws[i - 1][1] - 0.1, `lean band ${JSON.stringify(ws)}`);
    }
    assert.ok(ws[4][1] > 2 * ws[1][1], 'lean band grows with years');
    for (const p of r.seriesFull) {
      assert.ok(p.low.weightLb <= p.weightLb + 1e-9 && p.weightLb <= p.high.weightLb + 1e-9);
      assert.ok(p.low.leanLb <= p.leanLb + 1e-9 && p.leanLb <= p.high.leanLb + 1e-9);
      assert.ok(p.low.fatLb > 0 && p.low.bodyFatPct > 0);
      assert.ok(ffmiOf(p.high.leanLb) <= 26.6);
    }
  }
});

test('no NaN over 260 weeks for 4 profiles × intake modes; downsampling and seriesFull', () => {
  const profiles = [
    P,
    { body: { sex: 'female', heightIn: 64, birthYear: 1990, trainingMonths: 0, activity: 'active' }, goal: 'cut', nutrition: { mode: 'cycling', phases: { preset: 'cycles' } } },
    { body: { sex: 'male', heightIn: null, birthYear: null, trainingMonths: 48, activity: 'light' }, goal: 'lean_bulk', nutrition: { mode: 'simple' } },
    { body: { trainingMonths: 'x' }, goal: 'weird', nutrition: { phases: [{ weeks: 'x', goal: 'zzz', surplus: 'nan' }, null] } },
  ];
  for (const prof of profiles) for (const extra of [{}, { phases: 'cycles' }, { phases: 'bulk_cut', progressionRealism: true }, { intake: { calories: 1500 }, stopAtGoal: true }]) {
    const b = baseline({ profile: prof, bodyLog: [{ d: '2026-10-01', w: 150 }], measurements: [{ d: '2026-10-01', waist: 31, neck: 14, hips: 37 }], now: NOW });
    const r = project({ baseline: b, profile: prof, sessions: PLAN, weeks: 260, now: NOW, ...extra });
    assert.deepEqual(findBad(r), [], JSON.stringify({ prof, extra }));
    assert.ok(r.series.length > 100 && r.series.length < 170, String(r.series.length));
    assert.equal(r.series[r.series.length - 1].week, 260);
    assert.ok(r.series.every((p, i) => i === 0 || p.week > r.series[i - 1].week));
    assert.ok(r.series.every(p => p.weightLb > 50 && p.bodyFatPct >= 4.9 && p.leanLb > 0));
    assert.ok(r.assumptions.every(a => typeof a === 'string' && !/NaN|undefined/.test(a)));
  }
  assert.deepEqual(sampleWeeks(26), Array.from({ length: 27 }, (_, i) => i));
  const s52 = sampleWeeks(52);
  assert.equal(s52.length, 27 + 13); assert.equal(s52[27], 28);
  assert.equal(long({ fullSeries: false }).seriesFull, undefined);
  assert.equal(long().seriesFull.length, 261);
  assert.equal(project({ baseline: B, profile: P, sessions: PLAN, weeks: 999, now: NOW }).summary.weeks, MAX_WEEKS);
  assert.equal(project({ baseline: B, profile: P, sessions: PLAN, weeks: 260, now: NOW }).horizon.label, '5 years');
});

test('milestones at long horizons: FFMI, near-ceiling, lean +15/+20, dates on series points', () => {
  const r = long({ phases: 'cycles', intake: undefined });
  const by = Object.fromEntries(r.milestones.map(m => [m.id, m]));
  for (const id of ['ffmi_22', 'ffmi_23', 'near_ceiling', 'lean_15', 'lean_20', 'lean_10', 'abs_upper']) assert.ok(by[id], id);
  assert.ok(by.ffmi_22.date && by.lean_15.date, 'reached within 5 years');
  const dates = new Set(r.series.map(p => p.date));
  for (const m of r.milestones) if (m.date) { assert.ok(dates.has(m.date), m.id); assert.ok(m.week >= 0 && m.week <= 260); }
  const first = r.series.find(p => p.ffmi >= 22);
  assert.equal(by.ffmi_22.date, first.date);
  assert.ok(r.assumptions.some(a => /Kouri/.test(a)) && r.assumptions.some(a => /Hall/.test(a)) && r.assumptions.some(a => /phases/i.test(a)));
});

test('the nutrition lab works at 5 years; constant intakes converge', () => {
  const lab = nutritionLab({ baseline: B, profile: P, sessions: PLAN, weeks: 260, now: NOW, useStack: false });
  assert.equal(lab.points.length, 15);
  assert.deepEqual(findBad(lab), []);
  for (let i = 1; i < lab.points.length; i++) assert.ok(lab.points[i].fatLb >= lab.points[i - 1].fatLb - 0.3, `fat monotone at ${lab.points[i].surplus}`);
  assert.ok(lab.explanation.some(t => /converge|levels off|steady/i.test(t)));
  assert.ok(lab.sweetSpot.from >= 0 && lab.sweetSpot.to <= 700, JSON.stringify(lab.sweetSpot));
});

test('performance: 260-week projection + 15-point lab at 260 weeks in < 250 ms', () => {
  project({ baseline: B, profile: P, sessions: PLAN, weeks: 26, now: NOW });   // warm-up (JIT)
  const t0 = performance.now();
  const r = project({ baseline: B, profile: P, sessions: PLAN, weeks: 260, now: NOW });
  const lab = nutritionLab({ baseline: B, profile: P, sessions: PLAN, weeks: 260, now: NOW });
  const ms = performance.now() - t0;
  assert.equal(r.summary.weeks, 260); assert.equal(lab.points.length, 15);
  assert.ok(ms < 250, `${ms.toFixed(0)} ms`);
});

test('saved phases: targets.js dated list and nutrition.phasePlan both drive the default projection', () => {
  const dated = { ...P, nutrition: { mode: 'simple', phases: [{ label: 'Lean bulk', start: TODAY, end: '2027-02-08', surplus: 300, calories: null }, { label: 'Mini-cut', start: '2027-02-08', end: '2027-03-22', surplus: -500, calories: null }] } };
  const r = project({ baseline: B, profile: dated, sessions: PLAN, weeks: 52, now: NOW });
  assert.deepEqual(r.phases.map(p => p.goal), ['lean_bulk', 'cut', 'maintain']);
  assert.equal(r.phases[1].startWeek, 16); assert.equal(r.phases[2].startWeek, 22);
  const meta = { ...P, nutrition: { mode: 'simple', phasePlan: { preset: 'cycles', repeat: true, start: TODAY } } };
  const m = project({ baseline: B, profile: meta, sessions: PLAN, weeks: 52, now: NOW });
  assert.equal(m.phases.length, 5); assert.equal(m.phases[2].goal, 'lean_bulk'); assert.equal(m.phases[3].startWeek, 38);
  // an explicit intake (the what-if slider) or phases:null overrides the saved plan
  assert.equal(project({ baseline: B, profile: meta, sessions: PLAN, weeks: 52, now: NOW, intake: { calories: 2400 } }).phases.length, 0);
  assert.equal(project({ baseline: B, profile: meta, sessions: PLAN, weeks: 52, now: NOW, phases: null }).phases.length, 0);
});
