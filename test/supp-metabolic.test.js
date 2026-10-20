import test from 'node:test';
import assert from 'node:assert/strict';
import { modifiersAt, metabolicBaseline, testosteroneEffect, stackTimeline, resolveDose, convertDose, averageTotalT } from '../js/engine/metabolic.js';
import { SUPPLEMENTS } from '../js/data/supplements.js';

const DATE = '2026-10-19';
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const P = (supplements = [], metabolic = {}, extra = {}) => ({ goal: 'recomp', bodyweight: 165, body: { birthYear: 1987 }, supplements,
  metabolic: { totalT: null, freeT: null, labDate: null, onTrtT: null, vitD: null, hba1c: null, tsh: null, sleepHours: 7, stress: 3, ...metabolic }, ...extra });
const entry = (id, startDaysAgo = 0, dose = null, extra = {}) => ({ id, start: addDays(DATE, -startDaysAgo), end: null, dose, active: true, ...extra });
const NUM_FIELDS = ['leanCeilingMult', 'leanRetentionMult', 'partitionShift', 'tdeeDelta', 'intakeDelta', 'waterLb', 'leanDirectLbPerWeek', 'fatDirectLbPerWeek'];
const assertFinite = (m, label = '') => { for (const k of NUM_FIELDS) assert.ok(typeof m[k] === 'number' && Number.isFinite(m[k]), `${label} ${k}=${m[k]}`); };

test('no stack, no values: neutral-ish, numbers finite, averages flagged as assumed', () => {
  const m = modifiersAt(P([], { sleepHours: null, stress: null }), DATE);
  assertFinite(m);
  assert.ok(Math.abs(m.leanCeilingMult - 1) < 0.03, 'only a gentle age factor at 39');
  assert.equal(m.leanDirectLbPerWeek, 0);
  assert.equal(m.waterLb, 0);
  assert.ok(m.assumptions.some(a => /assumed average/i.test(a) && /testosterone/i.test(a)));
  assert.ok(m.assumptions.some(a => /vitamin d/i.test(a)));
  assert.ok(m.contributions.some(c => c.assumedAverage));
  assert.equal(averageTotalT(39), metabolicBaseline(P(), { date: DATE }).levels.totalT);
  assert.ok(Math.abs(averageTotalT(39) - 550) <= 10);
});

test('creatine: ceiling > 1 and water > 0, ramped by weeks', () => {
  const base = modifiersAt(P(), DATE).leanCeilingMult;
  const wk0 = modifiersAt(P([entry('creatine', 0)]), DATE);
  const wk1 = modifiersAt(P([entry('creatine', 7)]), DATE);
  const wk8 = modifiersAt(P([entry('creatine', 56)]), DATE);
  assert.equal(wk0.waterLb, 0);
  assert.ok(wk1.waterLb > 0 && wk1.waterLb < wk8.waterLb, 'water ramps');
  assert.ok(wk1.leanCeilingMult > base && wk1.leanCeilingMult < wk8.leanCeilingMult, 'ceiling ramps');
  assert.ok(wk8.leanCeilingMult / base > 1.05 && wk8.leanCeilingMult / base < 1.2);
  assert.ok(wk8.waterLb >= 1 && wk8.waterLb <= 2.5, '+1–2 lb water');
  assert.equal(wk8.leanDirectLbPerWeek, 0, 'no training-independent lean from creatine');
  // future start: not active yet
  assert.equal(modifiersAt(P([{ id: 'creatine', start: addDays(DATE, 7), active: true }]), DATE).waterLb, 0);
});

test('creatine dose: 20 g ≈ 5 g at steady state, 20 g only saturates faster; below 3 g is partial', () => {
  const at = (days, value) => modifiersAt(P([entry('creatine', days, { value, unit: 'g/day' })]), DATE);
  assert.equal(at(70, 20).leanCeilingMult, at(70, 5).leanCeilingMult);
  assert.equal(at(70, 20).waterLb, at(70, 5).waterLb);
  assert.ok(at(5, 20).waterLb > at(5, 5).waterLb, 'loading gets there sooner');
  assert.ok(at(70, 1).waterLb < at(70, 5).waterLb, '1 g/day does not fully saturate');
  // unit conversion: 5000 mg/day == 5 g/day
  assert.equal(modifiersAt(P([entry('creatine', 70, { value: 5000, unit: 'mg/day' })]), DATE).leanCeilingMult, at(70, 5).leanCeilingMult);
  // string dose
  assert.equal(modifiersAt(P([entry('creatine', 70, '5 g')]), DATE).leanCeilingMult, at(70, 5).leanCeilingMult);
});

test('testosteroneEffect: natural level → no direct effect; ordering 2400 > 1000 > 550 > 250 on therapy', () => {
  const nat = testosteroneEffect(550, { age: 39 });
  assert.equal(nat.leanDirectLbPerWeek, 0);
  assert.ok(Math.abs(nat.leanCeilingMult - 1) < 1e-9);
  const lean = t => { const e = testosteroneEffect(t, { baselineT: 550, weeksOn: 0, age: 39 }); return 12 * e.leanDirectLbPerWeek + 3 * e.leanCeilingMult; };
  assert.ok(lean(2400) > lean(1000) && lean(1000) > lean(550) && lean(550) > lean(250));
  // Bhasin 2001 20-week fit points (kg), relative to the fit's zero at ~300 ng/dL, young men
  const k20 = t => testosteroneEffect(t, { baselineT: 300, weeksOn: 0, age: 25 }).lean20Lb / 2.20462;
  assert.ok(Math.abs(k20(540) - 2.1) < 1.5, 'near +3.4 kg at 540 (fit)');
  assert.ok(Math.abs(k20(2400) - 7.9) < 1.0, '≈ +7.9 kg at 2,400');
  assert.ok(Math.abs(k20(1350) - 5.2) < 0.6, '≈ +5.2 kg at 1,350');
  // Bhasin 1996 check: 550 → 2,400 for 10 weeks ≈ +3.2 kg without exercise
  const e96 = testosteroneEffect(2400, { baselineT: 550, weeksOn: 10, age: 25 });
  assert.ok(Math.abs(e96.cumLeanLb / 2.20462 - 3.2) < 1.0, `10-week cumulative ${e96.cumLeanLb / 2.2} kg`);
  // ceiling at ~600 mg/wk levels ≈ (1.9 + 1.0) / 1.9
  assert.ok(Math.abs(testosteroneEffect(2400, { baselineT: 550, weeksOn: 0 }).leanCeilingMult - 1.53) < 0.03);
  // saturating time course: most change in the first ~20 weeks
  const late = testosteroneEffect(1000, { baselineT: 550, weeksOn: 40 }), early = testosteroneEffect(1000, { baselineT: 550, weeksOn: 0 });
  assert.ok(late.leanDirectLbPerWeek < early.leanDirectLbPerWeek * 0.1);
  assert.ok(testosteroneEffect(1000, { baselineT: 550, weeksOn: 20 }).cumLeanLb > 0.75 * late.asymptoteLb);
  // fat falls at higher levels
  assert.ok(testosteroneEffect(2400, { baselineT: 550 }).fatDirectLbPerWeek < 0);
});

test('testosterone: plateau beyond the studied range with a warning; low natural T reduces ceiling and drifts slightly negative', () => {
  const at = on => modifiersAt(P([entry('trt', 0)], { totalT: 550, onTrtT: on, labDate: '2026-09-01' }), DATE);
  const a = at(2400), b = at(5000);
  assert.equal(b.leanCeilingMult, a.leanCeilingMult);
  assert.equal(b.leanDirectLbPerWeek, a.leanDirectLbPerWeek);
  assert.ok(b.warnings.some(w => /beyond the studied range/i.test(w)));
  assert.ok(!a.warnings.some(w => /beyond the studied range/i.test(w)));
  assert.ok(testosteroneEffect(5000, {}).beyondStudied);
  // no cap at the normal range
  assert.ok(at(2400).leanDirectLbPerWeek > at(1000).leanDirectLbPerWeek && at(1000).leanDirectLbPerWeek > at(750).leanDirectLbPerWeek);
  // low natural T
  const low = modifiersAt(P([], { totalT: 250, labDate: '2026-09-01' }), DATE);
  const mid = modifiersAt(P([], { totalT: 550, labDate: '2026-09-01' }), DATE);
  assert.ok(low.leanCeilingMult < mid.leanCeilingMult * 0.85);
  assert.ok(low.leanDirectLbPerWeek < 0 && low.leanDirectLbPerWeek > -0.1, 'slightly negative');
  // naturally high T within/above normal: no training advantage (Morton 2018)
  assert.equal(modifiersAt(P([], { totalT: 1000, labDate: '2026-09-01' }), DATE).leanCeilingMult, mid.leanCeilingMult);
});

test('TRT from low to mid-normal restores and lifts the ceiling, adds direct lean; Bob example', () => {
  const natural = modifiersAt(P([], { totalT: 310, labDate: '2026-09-01', sleepHours: 6.5 }), DATE);
  const onTrt = modifiersAt(P([entry('trt', 0)], { totalT: 310, onTrtT: 750, labDate: '2026-09-01', sleepHours: 6.5 }), DATE);
  assert.ok(onTrt.leanCeilingMult > natural.leanCeilingMult * 1.1);
  assert.ok(onTrt.leanDirectLbPerWeek > 0.3 && onTrt.leanDirectLbPerWeek < 1.2);
  assert.ok(onTrt.fatDirectLbPerWeek < 0);
  assert.ok(onTrt.risks.some(r => /sperm|fertility/i.test(r.text)));
  // TRT to the person's own natural level does ~nothing
  const same = modifiersAt(P([entry('trt', 0)], { totalT: 600, onTrtT: 600, labDate: '2026-09-01' }), DATE);
  assert.ok(Math.abs(same.leanDirectLbPerWeek) < 0.01);
  // without the stack: natural values only
  assert.equal(modifiersAt(P([entry('trt', 0)], { totalT: 310, onTrtT: 750, labDate: '2026-09-01', sleepHours: 6.5 }), DATE, { useStack: false }).leanCeilingMult, natural.leanCeilingMult);
});

test('TRT without labs warns and assumes; dose estimates level via Bhasin 2001', () => {
  const m = modifiersAt(P([entry('trt', 0)]), DATE);
  assertFinite(m);
  assert.ok(m.warnings.some(w => /no on-therapy testosterone lab/i.test(w)));
  assert.ok(m.warnings.some(w => /natural .*total T/i.test(w)));
  assert.equal(m.testosterone.level, 600);
  const d600 = modifiersAt(P([entry('trt', 0, { value: 600, unit: 'mg/week' })], { totalT: 550, labDate: '2026-09-01' }), DATE);
  assert.ok(Math.abs(d600.testosterone.level - 2370) < 5);
  const d125 = modifiersAt(P([entry('trt', 0, { value: 125, unit: 'mg/week' })], { totalT: 550, labDate: '2026-09-01' }), DATE);
  assert.ok(Math.abs(d125.leanDirectLbPerWeek) < 0.05, '125 mg/wk ≈ normal level → ~0 vs natural 550');
});

test('sleep 5 h hurts the ceiling and lean retention; 7–9 h is baseline', () => {
  const s7 = modifiersAt(P([], { sleepHours: 7 }), DATE), s8 = modifiersAt(P([], { sleepHours: 8.5 }), DATE), s5 = modifiersAt(P([], { sleepHours: 5 }), DATE, { inDeficit: true });
  assert.equal(s7.leanCeilingMult, s8.leanCeilingMult);
  assert.ok(s5.leanCeilingMult < s7.leanCeilingMult * 0.95);
  assert.ok(s5.leanRetentionMult >= 1.5);
  assert.equal(s7.leanRetentionMult, 1);
  assert.ok(s5.warnings.some(w => /Nedeltcheva/.test(w)));
});

test('age, stress and vitamin D factors', () => {
  const young = modifiersAt(P([], {}, { body: { birthYear: 1996 } }), DATE).leanCeilingMult;
  const old = modifiersAt(P([], {}, { body: { birthYear: 1961 } }), DATE).leanCeilingMult;
  assert.ok(old < young && old > young * 0.85, 'gentle age decline');
  assert.ok(modifiersAt(P([], { stress: 5 }), DATE).leanCeilingMult < modifiersAt(P([], { stress: 3 }), DATE).leanCeilingMult);
  const def = modifiersAt(P([], { vitD: 12, labDate: '2026-09-01' }), DATE).leanCeilingMult;
  const ok = modifiersAt(P([], { vitD: 35, labDate: '2026-09-01' }), DATE).leanCeilingMult;
  assert.ok(def < ok);
  // supplementing a deficiency closes the gap after ~12 weeks; not deficient → no effect
  const fixed = modifiersAt(P([entry('vitamin_d', 120, { value: 2000, unit: 'IU/day' })], { vitD: 12, labDate: '2026-06-01' }), DATE).leanCeilingMult;
  assert.ok(fixed > def && Math.abs(fixed - ok) < 0.005);
  assert.equal(modifiersAt(P([entry('vitamin_d', 120)], { vitD: 35, labDate: '2026-06-01' }), DATE).leanCeilingMult, ok);
});

test('GLP-1, stimulants and MK-677: dose-driven effects and conflict warnings', () => {
  const sema = d => modifiersAt(P([entry('semaglutide', 200, d == null ? null : { value: d, unit: 'mg/week' })], {}, { goal: 'lean_bulk' }), DATE);
  assert.ok(sema(2.4).intakeDelta < -300 && sema(2.4).intakeDelta > -600);
  assert.ok(sema(1.0).intakeDelta > sema(2.4).intakeDelta, 'lower dose, smaller effect');
  assert.equal(sema(5).intakeDelta, sema(2.4).intakeDelta, 'plateau at studied max');
  assert.ok(sema(2.4).warnings.some(w => /lean-bulk/i.test(w)));
  const tirz = d => modifiersAt(P([entry('tirzepatide', 300, { value: d, unit: 'mg/week' })]), DATE).intakeDelta;
  assert.ok(tirz(15) < tirz(10) && tirz(10) < tirz(5) && tirz(5) < 0);
  // escalation ramp
  assert.ok(modifiersAt(P([entry('semaglutide', 14)]), DATE).intakeDelta > sema(2.4).intakeDelta);
  const add = modifiersAt(P([entry('adderall', 400), entry('caffeine', 400)], {}, { goal: 'lean_bulk' }), DATE);
  assert.ok(add.intakeDelta < 0);
  assert.ok(add.warnings.some(w => /appetite/i.test(w)) && add.warnings.some(w => /caffeine/i.test(w)));
  const mk = modifiersAt(P([entry('mk677', 60)], { hba1c: 5.9, labDate: '2026-09-01' }), DATE);
  assert.ok(mk.waterLb > 2 && mk.leanDirectLbPerWeek === 0, 'MK-677 = water, not tissue');
  assert.ok(mk.warnings.some(w => /HbA1c/.test(w)));
  assert.ok(modifiersAt(P([entry('mk677', 60)]), DATE).warnings.some(w => /HbA1c/.test(w)), 'missing HbA1c also flagged');
});

test('studied-duration limits: SARM direct lean stops after the studied weeks; peptides with no evidence do nothing', () => {
  const lgdEarly = modifiersAt(P([entry('lgd4033', 7)]), DATE), lgdLate = modifiersAt(P([entry('lgd4033', 60)]), DATE);
  assert.ok(lgdEarly.leanDirectLbPerWeek > 0);
  assert.equal(lgdLate.leanDirectLbPerWeek, 0);
  const pep = modifiersAt(P([entry('bpc157', 30), entry('tb500', 30), entry('ipamorelin_cjc', 30)]), DATE);
  const none = modifiersAt(P(), DATE);
  for (const k of NUM_FIELDS) assert.equal(pep[k], none[k], k);
  assert.ok(pep.warnings.some(w => /unregulated/i.test(w)));
});

test('stopping: end date removes effects, creatine water washes out over ~4 weeks', () => {
  const stopped = (daysSinceEnd) => modifiersAt(P([{ id: 'creatine', start: addDays(DATE, -100), end: addDays(DATE, -daysSinceEnd), dose: null, active: false }]), DATE);
  assert.ok(stopped(7).waterLb > 0 && stopped(7).waterLb < 1.6);
  assert.equal(stopped(35).waterLb, 0);
  assert.equal(stopped(7).leanCeilingMult, modifiersAt(P(), DATE).leanCeilingMult);
  // inactive with no end date: ignored
  assert.equal(modifiersAt(P([{ id: 'creatine', start: '2026-01-01', end: null, active: false }]), DATE).waterLb, 0);
});

test('absurd stack and garbage inputs: bounded, no NaN', () => {
  const all = Object.keys(SUPPLEMENTS).map(id => entry(id, 30, { value: 1e6, unit: SUPPLEMENTS[id].model?.dose?.unit || 'mg/day' }));
  const dupes = Array.from({ length: 30 }, () => entry('creatine', 60));
  const m = modifiersAt(P([...all, ...dupes], { totalT: 2500, onTrtT: 99999, vitD: 250, hba1c: 15, tsh: 50, sleepHours: 14, stress: 5, labDate: '2026-01-01' }), DATE);
  assertFinite(m, 'absurd');
  assert.ok(m.leanCeilingMult <= 2.0 && m.leanCeilingMult >= 0.4);
  assert.ok(m.leanDirectLbPerWeek <= 2.0);
  assert.ok(m.waterLb <= 12);
  assert.ok(m.intakeDelta >= -1200 && m.intakeDelta <= 600);
  // duplicates of one item count once
  assert.equal(modifiersAt(P(dupes), DATE).leanCeilingMult, modifiersAt(P([entry('creatine', 60)]), DATE).leanCeilingMult);
  // low extreme
  const lo = modifiersAt(P([], { totalT: 20, sleepHours: 1, stress: 5, vitD: 2, hba1c: 12, labDate: '2026-09-01' }, { body: { birthYear: 1930 } }), DATE);
  assertFinite(lo, 'low');
  assert.ok(lo.leanCeilingMult >= 0.4);
  // garbage
  const junk = [null, undefined, {}, { supplements: 'x', metabolic: 'y' }, { supplements: [null, 5, { id: 'nope' }, { id: 'creatine', start: 'garbage', dose: { value: 'abc', unit: 7 } }], metabolic: { totalT: 'abc', sleepHours: -3, stress: 99, vitD: NaN, onTrtT: -5 } }];
  for (const j of junk) { assertFinite(modifiersAt(j, DATE), 'junk'); assertFinite(modifiersAt(j, 'not-a-date'), 'junk date'); }
  assertFinite(modifiersAt(P([entry('trt', 0)], { onTrtT: '9e9' }), DATE));
  for (const t of [0, -1, NaN, null, 'x', 1e9]) { const e = testosteroneEffect(t, { baselineT: t, weeksOn: t, age: t }); for (const k of ['leanDirectLbPerWeek', 'leanCeilingMult', 'fatDirectLbPerWeek']) assert.ok(Number.isFinite(e[k]), `${t} ${k}`); }
});

test('helpers: dose resolution, unit conversion, timeline', () => {
  assert.equal(convertDose(5, 'g/day', 'mg/day'), 5000);
  assert.equal(convertDose(700, 'mg/week', 'mg/day'), 100);
  assert.equal(convertDose(50, 'mcg/day', 'IU/day'), 2000);
  const d = resolveDose(null, SUPPLEMENTS.creatine.model);
  assert.equal(d.value, 5); assert.equal(d.assumed, true);
  assert.equal(resolveDose({ value: 30, unit: 'g/day' }, SUPPLEMENTS.creatine.model).beyond, true);
  const tl = stackTimeline(P([entry('trt', 0)], { totalT: 310, onTrtT: 750, labDate: '2026-09-01' }), { from: DATE, weeks: 12 });
  assert.equal(tl.weeks.length, 13);
  assert.ok(tl.cumLeanDirect > 2 && tl.cumLeanDirect < 10);
  assert.ok(tl.cumFatDirect < 0);
});

test('stop date is the first day off: stopping today removes the effect today', () => {
  const p = P([{ id: 'trt', start: '2026-08-01', end: DATE, dose: null, active: false }], { totalT: 310, onTrtT: 750, labDate: '2026-09-01' });
  const m = modifiersAt(p, DATE);
  assert.equal(m.leanDirectLbPerWeek, modifiersAt(P([], { totalT: 310, labDate: '2026-09-01' }), DATE).leanDirectLbPerWeek);
  assert.ok(m.warnings.some(w => /after stopping testosterone/i.test(w)));
  assert.ok(modifiersAt(p, addDays(DATE, -1)).leanDirectLbPerWeek > 0, 'still on the day before');
});
