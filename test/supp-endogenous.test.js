// Endogenous-testosterone therapies and lifestyle levers (SUPP). See docs/research/endogenous-testosterone.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { modifiersAt, metabolicBaseline, testosteroneEffect, tShiftPct, vermeulenFreeT, bmiOf, stackTimeline, SLEEP_T } from '../js/engine/metabolic.js';
import { SUPPLEMENTS, EVIDENCE, isModeled } from '../js/data/supplements.js';

const DATE = '2026-10-19';
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
// Bob: 39, 164 lb, 5'10"
const P = (supplements = [], metabolic = {}, extra = {}) => ({ goal: 'recomp', bodyweight: 164, body: { birthYear: 1987, heightIn: 70 }, supplements,
  metabolic: { totalT: null, freeT: null, labDate: null, onTrtT: null, vitD: null, hba1c: null, tsh: null, sleepHours: 7, stress: 3, ...metabolic }, ...extra });
const entry = (id, startDaysAgo = 84, dose = null) => ({ id, start: addDays(DATE, -startDaysAgo), end: null, dose, active: true });
const NUM_FIELDS = ['leanCeilingMult', 'leanRetentionMult', 'partitionShift', 'tdeeDelta', 'intakeDelta', 'waterLb', 'leanDirectLbPerWeek', 'fatDirectLbPerWeek'];
const assertFinite = (m, label = '') => {
  for (const k of NUM_FIELDS) assert.ok(typeof m[k] === 'number' && Number.isFinite(m[k]), `${label} ${k}=${m[k]}`);
  assert.ok(Number.isFinite(m.testosterone.level) && Number.isFinite(m.testosterone.natural), `${label} testosterone level/natural`);
  for (const c of m.contributions) assert.ok(typeof c.text === 'string' && !/NaN|undefined|Infinity/.test(c.text), `${label} contribution text: ${c.text}`);
  for (const w of m.warnings) assert.ok(!/NaN|undefined|Infinity/.test(w), `${label} warning: ${w}`);
};
const LOW = { totalT: 300, labDate: '2026-07-01', lh: 3.2 };          // secondary hypogonadism, lab drawn before therapy
const ENDOGENOUS = ['clomiphene', 'enclomiphene', 'hcg', 'aromatase_inhibitor', 'tamoxifen', 'cabergoline'];

test('the endogenous-T catalogue exists, is prescription-labeled and carries real citations', () => {
  for (const id of [...ENDOGENOUS, 'kisspeptin', 'pulsatile_gnrh', 'nasal_t', 'leydig_regen', 'fat_loss', 'energy_availability', 'endurance_load', 'alcohol', 'daa', 'fenugreek', 'boron', 'tribulus', 'maca', 'dhea', 'shilajit', 'forskolin']) {
    const s = SUPPLEMENTS[id];
    assert.ok(s, 'missing ' + id);
    assert.ok(EVIDENCE[s.evidence], `${id} evidence grade`);
    assert.ok(s.sources.length >= 1 && s.sources.every(x => /\d{4}/.test(x) || /FDA|WADA/.test(x)), `${id} sources`);
  }
  for (const id of ENDOGENOUS) {
    assert.match(SUPPLEMENTS[id].status, /prescription|not an fda-approved drug/i, id);
    assert.ok(typeof SUPPLEMENTS[id].typicalUse === 'string', `${id} typicalUse is context`);
    // context only: no self-administrable dosing numbers in the model
    assert.match(SUPPLEMENTS[id].model.dose.unit, /%/, `${id} dose unit is a share of the studied regimen`);
  }
  // research-only items project nothing
  for (const id of ['kisspeptin', 'pulsatile_gnrh', 'leydig_regen']) assert.equal(isModeled(SUPPLEMENTS[id]), false, id);
  // §22: nasal and oral testosterone ARE modeled, as exogenous testosterone on the Bhasin curve
  for (const id of ['nasal_t', 'oral_tu']) assert.equal(SUPPLEMENTS[id].model.kind, 'exogenousT', id);
  assert.equal(SUPPLEMENTS.leydig_regen.evidence, 'preclinical');
  assert.equal(SUPPLEMENTS.leydig_regen.typicalUse, null);
  assert.equal(SUPPLEMENTS.kisspeptin.typicalUse, null);
});

test('clomiphene raises effective T in a low-T secondary profile, and the lean effect follows the Bhasin curve', () => {
  const off = modifiersAt(P([], LOW), DATE);
  const on = modifiersAt(P([entry('clomiphene')], LOW), DATE);
  assertFinite(on, 'clomiphene');
  // meta-analysis: +274 ng/dL vs placebo at baselines 67–303 → ~570–580 from 300
  assert.ok(on.testosterone.level > 520 && on.testosterone.level < 620, `level ${on.testosterone.level}`);
  assert.equal(on.testosterone.source, 'endogenous');
  assert.ok(on.leanCeilingMult > off.leanCeilingMult * 1.1, 'low-T ceiling penalty lifts');
  assert.ok(on.leanDirectLbPerWeek > 0.05 && on.leanDirectLbPerWeek < 0.5, `direct lean ${on.leanDirectLbPerWeek}`);
  assert.ok(on.fatDirectLbPerWeek < 0, 'fat falls slightly');
  const tl = stackTimeline(P([entry('clomiphene', 0)], LOW), { from: DATE, weeks: 12 });
  assert.ok(tl.cumLeanDirect > 0.5 && tl.cumLeanDirect < 6, `12-week direct lean ${tl.cumLeanDirect} lb`);
  // and it is routed through testosteroneEffect, not an ad-hoc number.
  // CHANGED 2026-10-20: the reference level was hard-coded 500 (the old flat body-composition cap). The credit
  // is no longer clipped there for a man inside Soares 2018's population, so the reference now follows the
  // credited level the engine actually reports.
  const te = testosteroneEffect(on.testosterone.leanLevel, { baselineT: 300, weeksOn: 12, age: 39 });
  assert.ok(Math.abs(on.leanDirectLbPerWeek - te.leanDirectLbPerWeek) < 0.02, 'matches the shared curve at the credited level');
});

// REWRITTEN 2026-10-20. This test used to assert that clomiphene, enclomiphene and hCG do NOTHING for a man
// already in the normal range, and that each says "studied only in men with low testosterone". Both halves were
// wrong. The curves had been fitted to hypogonadal trials and then extrapolated to zero at 450 ng/dL, which was
// an inference, not a finding, and it is contradicted by:
//   Tenover & Bremner 1991 (PMID 1917692)  — healthy men 26–33, 519 → 1,390 ng/dL on clomiphene 100 mg/day, 8 wk.
//   Bremner 1987 (doi:10.1210/jcem-65-6-1118) — healthy men 22–35, 490 → 980 ng/dL in 7 days, same dose.
//   Krause 1992 — placebo-controlled, eugonadal men, tamoxifen 490 → 790 vs 530 → 560.
//   Cailleux-Bounacer 2008 / Panidis 2002 — hCG raises testosterone in normal men; that is what the Leydig
//   stimulation test IS.
// The hormone moves. What is still unknown is whether it buys a eugonadal man any muscle, so that is what this
// test now pins: a real rise, a lean number that exists, and an `extrapolated` flag on it.
test('the same therapies DO move a man already in the normal range — but the muscle is unproven there', () => {
  const base = modifiersAt(P(), DATE);
  for (const id of ['clomiphene', 'enclomiphene', 'hcg']) {
    const m = modifiersAt(P([entry(id)]), DATE);
    assertFinite(m, id);
    assert.ok(m.testosterone.level > m.testosterone.natural + 100, `${id} raises a normal man's level`);
    assert.ok(m.testosterone.freeT > m.testosterone.freeTBase, `${id} raises free T too`);
    assert.equal(m.testosterone.extrapolated, true, `${id} body composition is unmeasured in this population`);
    assert.ok(m.leanDirectLbPerWeek > base.leanDirectLbPerWeek, `${id} credits some lean, through the Bhasin curve`);
    assert.ok(m.contributions.some(c => c.id === id && /EXTRAPOLATION/.test(c.text)), `${id} labels it`);
  }
  // The aromatase inhibitor still moves the number and still credits exactly zero muscle (trials measured it).
  const ai = modifiersAt(P([entry('aromatase_inhibitor')]), DATE);
  assert.ok(ai.testosterone.level > ai.testosterone.natural + 100);
  assert.equal(ai.leanDirectLbPerWeek, base.leanDirectLbPerWeek, 'AI: no direct lean, ever');
  assert.equal(ai.leanCeilingMult, base.leanCeilingMult);
});

test('gates: high LH (primary) blocks the SERM/hCG class; cabergoline needs a high prolactin; zinc needs a deficiency', () => {
  // CHANGED 2026-10-20: LH 14 is only "slightly elevated" and Keihani 2020 (n=332) found such men still respond,
  // so Forge now attenuates there. A hard zero needs a clearly raised LH (2x the EMAS 9.4 cut-off).
  const mild = modifiersAt(P([entry('clomiphene')], { ...LOW, lh: 14 }), DATE);
  assert.ok(mild.testosterone.level > mild.testosterone.natural, 'LH 14 attenuates, it does not block');
  assert.ok(mild.testosterone.level < modifiersAt(P([entry('clomiphene')], LOW), DATE).testosterone.level);
  const primary = modifiersAt(P([entry('clomiphene')], { ...LOW, lh: 22 }), DATE);
  assert.equal(primary.testosterone.level, primary.testosterone.natural);
  assert.ok(primary.contributions.some(c => /testicular\) failure/i.test(c.text)));

  const noPrl = modifiersAt(P([entry('cabergoline')], { totalT: 280, labDate: '2026-07-01' }), DATE);
  assert.equal(noPrl.testosterone.level, noPrl.testosterone.natural, 'no prolactin entered → nothing');
  assert.ok(noPrl.contributions.some(c => /enter your prolactin/i.test(c.text)));
  const normalPrl = modifiersAt(P([entry('cabergoline')], { totalT: 280, labDate: '2026-07-01', prolactin: 9 }), DATE);
  assert.equal(normalPrl.testosterone.level, normalPrl.testosterone.natural);
  const highPrl = modifiersAt(P([entry('cabergoline')], { totalT: 280, labDate: '2026-07-01', prolactin: 45 }), DATE);
  assert.ok(highPrl.testosterone.level > 400, `prolactin treated → ${highPrl.testosterone.level}`);
});

test('replete zinc does nothing; a measured deficiency does something', () => {
  const base = modifiersAt(P(), DATE);
  const replete = modifiersAt(P([entry('zma')], { zinc: 95 }), DATE);
  assert.equal(replete.testosterone.level, replete.testosterone.natural);
  assert.equal(replete.leanCeilingMult, base.leanCeilingMult);
  assert.ok(replete.contributions.some(c => c.id === 'zma' && /above the deficiency cutoff/i.test(c.text)));

  const unknown = modifiersAt(P([entry('zma')]), DATE);
  assert.equal(unknown.testosterone.level, unknown.testosterone.natural, 'no zinc lab → no effect claimed');

  const low = modifiersAt(P([entry('zma')], { totalT: 320, labDate: '2026-07-01', zinc: 55 }), DATE);
  assert.ok(low.testosterone.level > 320, `deficient → ${low.testosterone.level}`);
  assert.ok(low.leanCeilingMult > modifiersAt(P([], { totalT: 320, labDate: '2026-07-01', zinc: 55 }), DATE).leanCeilingMult);
});

test('a measured on-therapy lab wins over the modeled rise, and is not double counted', () => {
  const modeled = modifiersAt(P([entry('enclomiphene')], LOW), DATE);
  const measured = modifiersAt(P([entry('enclomiphene')], { ...LOW, onTrtT: 620 }), DATE);
  assert.equal(measured.testosterone.level, 620);
  assert.equal(measured.testosterone.source, 'measured');
  assert.notEqual(modeled.testosterone.level, 620);
  assert.ok(measured.notes.some(n => /used as-is/i.test(n)));
  // a lab drawn while already taking a booster is treated as already reflecting it
  const during = modifiersAt(P([{ id: 'ashwagandha', start: '2026-06-01', end: null, dose: null, active: true }], { totalT: 600, labDate: '2026-09-01' }), DATE);
  assert.equal(during.testosterone.level, during.testosterone.natural);
  assert.ok(during.contributions.some(c => /already in your number/i.test(c.text)));
});

test('aromatase inhibitors raise the number but are credited with no muscle (trials measured it and found none)', () => {
  const off = modifiersAt(P([], LOW), DATE);
  const ai = modifiersAt(P([entry('aromatase_inhibitor')], LOW), DATE);
  assert.ok(ai.testosterone.level > 420, `T rises: ${ai.testosterone.level}`);
  assert.equal(ai.leanCeilingMult, off.leanCeilingMult, 'no ceiling credit');
  assert.equal(ai.leanDirectLbPerWeek, off.leanDirectLbPerWeek, 'no direct lean credit');
  assert.ok(ai.warnings.some(w => /no muscle from it/i.test(w)));
  assert.ok(ai.risks.some(r => /bone/i.test(r.text)));
});

test('muscle credit stops at the level the trials actually measured', () => {
  // CHANGED 2026-10-20: the credit used to be hard-capped at Soares 2018's inferred 500 ng/dL for everyone.
  // It is now capped at 500 only in the sense of being labelled MEASURED up to there; above it Forge still runs
  // the Bhasin curve but flags the result `extrapolated` (bcExtrapMaxLevel), and the planner then ranks the row
  // on a floor of zero. A hypogonadal man landing at ~573 is still inside Soares' population (entry T ≤300), so
  // he stays 'measured'; a eugonadal man is not, so he does not.
  const m = modifiersAt(P([entry('clomiphene')], LOW), DATE);
  assert.ok(m.testosterone.leanLevel <= m.testosterone.level + 1 && m.testosterone.leanLevel > m.testosterone.natural);
  assert.equal(m.testosterone.extrapolated, false, 'a man inside Soares 2018 (entry T <=300) keeps MEASURED');
  const eug = modifiersAt(P([entry('clomiphene')], { totalT: 540, labDate: '2026-07-01', lh: 4 }), DATE);
  assert.equal(eug.testosterone.extrapolated, true, 'a eugonadal man is past that trial population');
  assert.ok(eug.testosterone.leanLevel <= SUPPLEMENTS.clomiphene.model.bcExtrapMaxLevel + 1);
  // tamoxifen in a eugonadal man: §22 case (b). The number moves, muscle IS credited through the Bhasin curve,
  // bounded at Krause 1992's achieved 790 ng/dL, and the row is flagged an extrapolation.
  const tam = modifiersAt(P([entry('tamoxifen')]), DATE);
  assert.ok(tam.testosterone.level > tam.testosterone.natural * 1.4, 'T rises ~60%');
  assert.equal(tam.testosterone.extrapolated, true, 'flagged as an extrapolation');
  assert.ok(tam.testosterone.leanLevel <= 790, 'bounded by the level Krause 1992 reached');
  assert.ok(tam.contributions.some(c => c.id === 'tamoxifen' && /EXTRAPOLATION/i.test(c.text)), 'and says so');
});

test('lifestyle: sleep sets the assumed level, extension recovers it, fat loss is gated on obesity, endurance load lowers it', () => {
  const short = metabolicBaseline(P([], { sleepHours: 5 }), { date: DATE });
  const ok = metabolicBaseline(P([], { sleepHours: 8 }), { date: DATE });
  assert.ok(short.levels.totalT < ok.levels.totalT * 0.95, 'short sleep lowers the assumed level');
  assert.ok(short.assumptions.some(a => /Leproult/.test(a)));
  // a real lab overrides the sleep adjustment
  assert.equal(metabolicBaseline(P([], { sleepHours: 5, totalT: 600, labDate: '2026-09-01' }), { date: DATE }).levels.totalT, 600);

  const ext = modifiersAt(P([entry('sleep_hygiene')], { sleepHours: 5 }), DATE);
  assert.ok(ext.testosterone.level > ext.testosterone.natural, 'extension recovers some of it');
  assert.equal(modifiersAt(P([entry('sleep_hygiene')], { sleepHours: 8 }), DATE).testosterone.level, modifiersAt(P([], { sleepHours: 8 }), DATE).testosterone.natural, 'nothing to recover at 8 h');

  const lean = modifiersAt(P([entry('fat_loss')]), DATE);
  assert.equal(lean.testosterone.level, lean.testosterone.natural, 'lean man: no T effect from fat loss');
  assert.ok(lean.contributions.some(c => /BMI/.test(c.text)));
  const obese = modifiersAt(P([entry('fat_loss')], LOW, { bodyweight: 240 }), DATE);
  assert.ok(obese.testosterone.level > obese.testosterone.natural, 'obese: fat loss raises T');

  const endo = modifiersAt(P([entry('endurance_load')]), DATE);
  assert.ok(endo.testosterone.level < endo.testosterone.natural * 0.8, 'high endurance volume lowers it');
  assert.ok(endo.leanDirectLbPerWeek < 0);
});

test('supplement verdicts are honest: boosters are null or small, D-aspartic acid at the high dose is negative', () => {
  const base = modifiersAt(P(), DATE);
  for (const id of ['tribulus', 'maca', 'dhea', 'fenugreek', 'boron', 'shilajit', 'forskolin']) {
    const m = modifiersAt(P([entry(id)]), DATE);
    assert.equal(m.testosterone.level, base.testosterone.natural, `${id} must not move T`);
    assert.equal(m.leanCeilingMult, base.leanCeilingMult, `${id} must not move the ceiling`);
  }
  assert.equal(modifiersAt(P([entry('tongkat_ali')]), DATE).testosterone.level, base.testosterone.natural, 'tongkat: nothing at a normal level');
  assert.ok(modifiersAt(P([entry('tongkat_ali')], { totalT: 280, labDate: '2026-07-01' }), DATE).testosterone.level > 280, 'tongkat: something when low');
  const ash = modifiersAt(P([entry('ashwagandha')]), DATE);
  assert.ok(ash.testosterone.level > base.testosterone.natural && ash.testosterone.level < base.testosterone.natural * 1.2, 'ashwagandha ~+12%');

  const daa3 = modifiersAt(P([entry('daa', 84, { value: 3, unit: 'g/day' })]), DATE);
  const daa6 = modifiersAt(P([entry('daa', 84, { value: 6, unit: 'g/day' })]), DATE);
  assert.equal(daa3.testosterone.level, base.testosterone.natural, '3 g/day: null');
  assert.ok(daa6.testosterone.level < base.testosterone.natural * 0.95, '6 g/day lowered T in trained men');
  assert.ok(daa6.leanDirectLbPerWeek < 0);
});

test('testosterone therapy suppresses the endogenous items rather than stacking with them', () => {
  const m = modifiersAt(P([entry('trt', 0), entry('clomiphene'), entry('ashwagandha')], { totalT: 310, onTrtT: 800, labDate: '2026-07-01' }), DATE);
  assertFinite(m, 'trt + endogenous');
  assert.equal(m.testosterone.level, 800);
  assert.equal(m.testosterone.source, 'lab');
  for (const id of ['clomiphene', 'ashwagandha']) assert.ok(m.contributions.some(c => c.id === id && /no effect while on testosterone therapy/i.test(c.text)), id);
});

test('helpers: free-T math, BMI, gates and the sleep curve behave', () => {
  assert.ok(Math.abs(vermeulenFreeT(550, 40) - 104) < 6, 'Vermeulen free T for 550 ng/dL @ SHBG 40');
  assert.ok(vermeulenFreeT(550, 80) < vermeulenFreeT(550, 20), 'high SHBG → less free T');
  assert.equal(vermeulenFreeT(null, 40), null);
  assert.ok(Math.abs(bmiOf({ body: { heightIn: 70 } }, 164) - 23.5) < 0.2);
  assert.equal(bmiOf({ body: {} }, 164), null);
  assert.equal(SLEEP_T[SLEEP_T.length - 1][1], 1);
  // CHANGED 2026-10-20: was `=== 0`. The old curve zeroed above 450 ng/dL on an inference that the eugonadal
  // measurements contradict (Tenover 1991, Bremner 1987). The percentage still falls as the baseline rises —
  // because the measured effect is a roughly constant +274 ng/dL — but it never hits zero inside the human range.
  const at900 = tShiftPct(SUPPLEMENTS.clomiphene.model, { baselineT: 900 }).pct;
  assert.ok(at900 > 15 && at900 < 30, `clomiphene at a 900 ng/dL baseline: ${at900}%`);
  assert.ok(at900 < tShiftPct(SUPPLEMENTS.clomiphene.model, { baselineT: 450 }).pct, 'and keeps falling');
  assert.ok(tShiftPct(SUPPLEMENTS.clomiphene.model, { baselineT: 250, lh: 3 }).pct > 50);
  // the panel labs show up as information
  const b = metabolicBaseline(P([], { totalT: 280, labDate: '2026-09-01', lh: 2.1, shbg: 45, prolactin: 38, ferritin: 18 }), { date: DATE });
  assert.ok(b.factors.some(f => f.id === 'hormones' && /prolactin/i.test(f.note)));
  assert.ok(b.notes.some(n => /calculated free t/i.test(n)));
  assert.equal(b.levels.shbg, 45);
});

test('garbage in, no NaN out', () => {
  const junk = [
    P(ENDOGENOUS.map(id => entry(id, 30)), { totalT: 'abc', lh: -5, prolactin: 'x', zinc: NaN, onTrtT: '9e9', sleepHours: -3 }),
    P([entry('clomiphene', 0), entry('clomiphene', 400), entry('hcg', 1e5)], { totalT: 1, lh: 1e9 }),
    P([entry('fat_loss')], {}, { bodyweight: 'heavy', body: { heightIn: 'tall', birthYear: 'x' } }),
    { supplements: [{ id: 'clomiphene' }, { id: 'endurance_load', start: 'nope' }], metabolic: null },
  ];
  for (const [i, p] of junk.entries()) {
    assertFinite(modifiersAt(p, DATE), 'junk' + i);
    assertFinite(modifiersAt(p, 'not-a-date'), 'junk-date' + i);
    const tl = stackTimeline(p, { from: DATE, weeks: 8 });
    assert.ok(Number.isFinite(tl.cumLeanDirect) && Number.isFinite(tl.cumFatDirect), 'timeline ' + i);
  }
  // every catalogue item, alone, at an absurd dose
  for (const id of Object.keys(SUPPLEMENTS)) {
    const m = modifiersAt(P([entry(id, 52 * 7, { value: 1e6, unit: SUPPLEMENTS[id].model?.dose?.unit || 'mg/day' })], { totalT: 240, labDate: '2026-01-01', lh: 2, prolactin: 60, zinc: 40 }), DATE);
    assertFinite(m, id);
    assert.ok(m.testosterone.level > 0 && m.testosterone.level < 1e5, `${id} level ${m.testosterone.level}`);
  }
});
