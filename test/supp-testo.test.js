// §22 Natural testosterone therapies, interactions and the planner.
// Every expected number here is traceable to docs/research/endogenous-testosterone.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modifiersAt, combineEndogenous, estradiolFatEffect, tShiftPct, testosteroneEffect, vermeulenFreeT,
  PITUITARY_CEILING, TESTIS_CEILING, COMBO_BONUS, E2_FAT, ASSUMED_E2, ASSUMED_SHBG,
  LH_PRIMARY, LH_PRIMARY_HARD,
} from '../js/engine/metabolic.js';
import { SUPPLEMENTS, isRx, RX_IDS, T_LAB_PANEL, isExogenousT } from '../js/data/supplements.js';
import { tPlan, SINGLE_IDS, COMBOS } from '../js/engine/tplan.js';
import * as PJ from '../js/engine/projection.js';

const DATE = '2026-10-20';
const START = '2026-07-28';                                   // ~12 weeks before DATE
const P = (supplements = [], metabolic = {}, extra = {}) => ({
  goal: 'recomp', bodyweight: 164, body: { birthYear: 1987, heightIn: 70 }, supplements,
  metabolic: { sleepHours: 7, stress: 3, ...metabolic }, ...extra,
});
const e = (id, start = START, dose = null) => ({ id, start, end: null, dose, active: true });
const mods = (p, opts = {}) => modifiersAt(p, DATE, { age: 39, ...opts });
const LOW = { totalT: 300, labDate: '2026-07-01', lh: 3.2 };            // secondary hypogonadism
// CHANGED 2026-10-20: used to be lh 14. 14 is only "slightly elevated" and Keihani 2020 (n=332) found such men
// still respond, so Forge now attenuates there instead of zeroing. A hard zero needs a clearly raised LH.
const PRIMARY = { totalT: 300, labDate: '2026-07-01', lh: 20 };         // unambiguous testicular failure
const PRIMARY_MILD = { totalT: 300, labDate: '2026-07-01', lh: 14 };    // EMAS "primary" but only mildly raised
const COMPENSATED = { totalT: 520, labDate: '2026-07-01', lh: 12 };     // EMAS "compensated": normal T, raised LH
const EUGONADAL = { totalT: 519, labDate: '2026-07-01', lh: 4 };        // Tenover & Bremner 1991's young men

// ====================================================================== 1. single items vs trial means
test('single-item testosterone responses reproduce the trial means', () => {
  // Hohl 2025 meta-analysis: SERMs +273.8 ng/dL (95 % CI 191.9–355.7) from baselines 67–303.
  const clo = mods(P([e('clomiphene')], LOW)).testosterone;
  assert.ok(clo.level - clo.natural > 191 && clo.level - clo.natural < 356, `clomiphene +${clo.level - clo.natural} outside the Hohl CI`);
  // Tienforti 2023: enclomiphene +216 ng/dL (188–245) in obesity-related androgen deficiency.
  const enc = mods(P([e('enclomiphene')], LOW)).testosterone;
  assert.ok(enc.level - enc.natural > 150 && enc.level - enc.natural < 280, `enclomiphene +${enc.level - enc.natural}`);
  // Liu 2002: hCG raised total T about 150 %.
  const hcg = mods(P([e('hcg')], LOW)).testosterone;
  assert.ok(Math.abs((hcg.level / hcg.natural - 1) * 100 - 150) < 20, `hCG ${(hcg.level / hcg.natural - 1) * 100}%`);
  // Krause 1992: tamoxifen 490 → 790 ng/dL (+61 %) in EUGONADAL men.
  const tam = mods(P([e('tamoxifen')], { totalT: 490, labDate: '2026-07-01', lh: 4 })).testosterone;
  assert.ok(Math.abs(tam.level - 790) < 40, `tamoxifen reached ${tam.level}, expected ≈790`);
  // Mauras 2000: an aromatase inhibitor raises T ~58 % in eugonadal males too — no low-T gate.
  const ai = mods(P([e('aromatase_inhibitor')], { totalT: 550, labDate: '2026-07-01', lh: 4 })).testosterone;
  assert.ok(ai.level > ai.natural * 1.4, `AI in a eugonadal man: ${ai.natural} → ${ai.level}`);
  // Leder 2004: 343 → 572 ng/dL (+67 %).
  const ai2 = mods(P([e('aromatase_inhibitor')], { totalT: 343, labDate: '2026-07-01', lh: 4 })).testosterone;
  assert.ok(Math.abs(ai2.level - 572) < 70, `AI from 343 reached ${ai2.level}, Leder measured 572`);
  // Ashwagandha ≈ +12 % (Zhu 2026 SMD 0.33); tongkat only below ~300.
  const ash = mods(P([e('ashwagandha')])).testosterone;
  assert.ok(ash.level > ash.natural * 1.08 && ash.level < ash.natural * 1.16);
  assert.equal(mods(P([e('tongkat_ali')])).testosterone.level, mods(P()).testosterone.natural);
});

// ====================================================================== 1b. the EUGONADAL correction (2026-10-20)
// Bob: "the clomiphene thing — I bet that works for anyone". On the hormone, he is right.
test('clomiphene raises testosterone in a man whose level is already normal', () => {
  // Tenover & Bremner 1991 (PMID 1917692): five HEALTHY men aged 26–33, baseline 18.0 nmol/L = 519 ng/dL, on
  // 50 mg twice daily for 8 weeks, reached 48.2 nmol/L = 1,390 ng/dL. Bremner 1987 (doi:10.1210/jcem-65-6-1118):
  // 14 healthy men 22–35, 490 → 980 ng/dL in 7 days. Krause 1992 is the placebo-controlled anchor at 490 → 790.
  // Forge is deliberately conservative against all three: a constant ≈+274 ng/dL (Hohl 2025's pooled effect).
  const clo = mods(P([e('clomiphene')], EUGONADAL)).testosterone;
  assert.ok(clo.level > clo.natural + 200, `a eugonadal man must get a real rise, got ${clo.natural} → ${clo.level}`);
  assert.ok(clo.level - clo.natural < 320, `...but not more than the measured hypogonadal effect: +${clo.level - clo.natural}`);
  // and it must be well under what was actually observed at that baseline, i.e. conservative, not invented
  assert.ok(clo.level < 1390, 'below the highest group mean ever reported (Tenover 1991)');
  // The old model returned EXACTLY zero here. That expectation is gone for good.
  assert.notEqual(clo.level, clo.natural);
  for (const id of ['enclomiphene', 'tamoxifen', 'hcg']) {
    const t = mods(P([e(id)], EUGONADAL)).testosterone;
    assert.ok(t.level > t.natural + 100, `${id} must also move at a normal baseline, got ${t.natural} → ${t.level}`);
  }
  // Mid-normal with no labs at all (Bob): the planner's default man still gets a modeled rise.
  const bob = mods(P([e('clomiphene')])).testosterone;
  assert.ok(bob.level > bob.natural + 200 && bob.level < 900, `${bob.natural} → ${bob.level}`);
});

test('the percentage rise still shrinks as the baseline rises — because the absolute rise is flat', () => {
  // Hohl 2025 pooled ONE absolute effect (+273.8 ng/dL) across baselines 67–303; Keihani 2020 (n=332) and
  // Kim 2026 (n=292) both found baseline total T did not predict the response. A constant absolute rise is a
  // falling percentage. Above 550 Forge tapers the absolute rise too (an assumption — nothing was studied there).
  const pct = [], delta = [];
  for (const T of [200, 300, 400, 500, 600, 800]) {
    const g = tShiftPct(SUPPLEMENTS.clomiphene.model, { baselineT: T, lh: 3 });
    pct.push(g.pct); delta.push(T * g.pct / 100);
  }
  for (let i = 1; i < pct.length; i++) assert.ok(pct[i] < pct[i - 1], `percentage must fall: ${pct}`);
  for (const d of delta.slice(0, 4)) assert.ok(Math.abs(d - 274) < 10, `absolute rise flat at ≈+274 up to 500: ${delta}`);
  assert.ok(delta[5] < delta[0], 'and tapers above 550');
  assert.ok(pct[5] > 15, 'but never collapses to zero inside the human range');
});

test('a clearly raised LH with a low testosterone still zeroes it — a slightly raised one does not', () => {
  // EMAS (Tajar 2010, doi:10.1210/jc.2009-1796) sets 9.4 IU/L: low T + LH > 9.4 = primary, normal T + LH > 9.4 =
  // compensated. Keihani 2020: baseline LH did NOT predict response, and "most patients with normal or slightly
  // elevated baseline gonadotropin levels" respond. Kim 2026: a gradient (OR 0.82 per mIU/mL), not a cliff.
  assert.equal(LH_PRIMARY, 9.4);
  assert.equal(LH_PRIMARY_HARD, 18.8);
  const at = lh => mods(P([e('clomiphene')], { totalT: 300, labDate: '2026-07-01', lh })).testosterone;
  const full = at(3).level - 300;
  assert.ok(full > 200);
  assert.equal(at(9).level - 300, full, 'inside the EMAS range, LH does not matter at all (Keihani 2020)');
  const mild = at(14).level - 300;
  assert.ok(mild > 0 && mild < full, `LH 14 attenuates rather than zeroing: +${mild} vs +${full}`);
  assert.ok(Math.abs(mild / full - (LH_PRIMARY_HARD - 14) / (LH_PRIMARY_HARD - LH_PRIMARY)) < 0.02, 'linear fade');
  assert.equal(at(20).level, 300, 'a clearly raised LH with a low T is primary failure: zero');
  // Compensated hypogonadism — raised LH but a NORMAL testosterone — is not blocked at all.
  const comp = mods(P([e('clomiphene')], COMPENSATED)).testosterone;
  assert.ok(comp.level > comp.natural + 200, `compensated must still respond, got ${comp.natural} → ${comp.level}`);
  assert.ok(mods(P([e('clomiphene')], COMPENSATED)).contributions.some(c => c.id === 'clomiphene' && /compensated/i.test(c.text)));
});

test('muscle credit is driven by FREE testosterone, and the SHBG rise is what makes it smaller', () => {
  // The objection: a SERM raises total T, estradiol AND SHBG together, so free T might move much less.
  // The measurement: Bremner 1987 — total T 490 → 980 and SHBG 24.5 → 31.3 nmol/L left the bioavailable fraction
  // at 65% → 66%. Forge's own Vermeulen routine reproduces that, which is the validation below.
  const f0 = vermeulenFreeT(490, 24.5), f1 = vermeulenFreeT(980, 31.3);
  assert.ok(Math.abs((f1 / f0) / (980 / 490) - 1) < 0.03, `free T tracks total T on a SERM: ratio ${(f1 / f0).toFixed(2)} vs 2.00`);
  // So in practice the correction is ~1.0 and it does NOT silently inflate anything...
  const clo = mods(P([e('clomiphene')], EUGONADAL)).testosterone;
  assert.ok(clo.freeT > clo.freeTBase, 'free T goes up');
  assert.ok(clo.freeAdj <= 1, 'and the adjustment can only ever take credit away, never add it');
  assert.ok(clo.freeAdj > 0.9, 'with the measured +4 nmol/L SHBG rise it barely bites');
  // ...but it does bite when SHBG actually moves a long way, which is the whole point of computing it.
  const parts = [{ id: 'clomiphene', name: 'x', item: SUPPLEMENTS.clomiphene, dose: null, resp: 1, ramp: 1, weeksOn: 12,
    model: { ...SUPPLEMENTS.clomiphene.model, shbgDelta: 15 } }];
  const big = combineEndogenous(parts, { baselineT: 543, lh: 3, shbg: 35 });
  assert.ok(big.freeAdj < 0.92, `a +15 nmol/L SHBG rise must cost credit, got ${big.freeAdj}`);
  assert.ok(big.creditLevel < big.level, 'so the credited level falls below the serum level');
});

test('every modeled own-axis item declares where its body-composition credit comes from', () => {
  for (const id of SINGLE_IDS) {
    const s = SUPPLEMENTS[id];
    assert.ok(s, id);
    const m = s.model || {};
    if (!['tEndogenous', 'tShift'].includes(m.kind)) continue;
    assert.ok(['measured', 'extrapolated', 'none'].includes(m.bodyComp), `${id} needs a bodyComp class`);
    assert.ok(typeof m.bcNote === 'string' && m.bcNote.length > 40, `${id} must say where the bound comes from`);
    assert.ok(Number.isFinite(m.ceilingNg) && m.ceilingNg > 0, `${id} needs a route ceiling`);
    assert.ok(Array.isArray(m.tCI) && m.tCI[0] <= 1 && m.tCI[1] >= 1, `${id} needs a CI bracketing the point estimate`);
    assert.ok(Array.isArray(m.monitor) && m.monitor.length >= 1, `${id} needs monitoring labs`);
    if (m.bodyComp !== 'none') assert.ok(Number.isFinite(m.bcMaxLevel) && m.bcMaxLevel > 0, `${id} needs bcMaxLevel`);
  }
  // The flat 550 ceiling is gone.
  assert.equal(typeof (SUPPLEMENTS.clomiphene.model.leanCapLevel), 'undefined');
  assert.equal(SUPPLEMENTS.clomiphene.model.bcMaxLevel, 500);     // Soares 2018
  assert.equal(SUPPLEMENTS.hcg.model.bcMaxLevel, 870);            // Liu 2002 (inferred — an assumption)
  assert.equal(SUPPLEMENTS.enclomiphene.model.bcMaxLevel, 604);   // Wiehle 2013, highest group mean
  assert.equal(SUPPLEMENTS.aromatase_inhibitor.model.bodyComp, 'none');
});

// ====================================================================== 2. non-additivity
test('combinations are not additive: the largest LH-driven item wins (Habous 2018)', () => {
  const clo = mods(P([e('clomiphene')], LOW)).testosterone;
  const hcg = mods(P([e('hcg')], LOW)).testosterone;
  const both = mods(P([e('clomiphene'), e('hcg')], LOW)).testosterone;
  const dClo = clo.level - clo.natural, dHcg = hcg.level - hcg.natural, dBoth = both.level - both.natural;
  assert.ok(dClo > 50 && dHcg > 50, 'both do something alone');
  assert.ok(dBoth < dClo + dHcg - 50, `combination ${dBoth} must be well below the sum ${dClo + dHcg}`);
  assert.ok(Math.abs(dBoth - Math.max(dClo, dHcg)) < 1, 'and equals the larger of the two (the measured result)');
  assert.equal(COMBO_BONUS, 0);
  assert.ok(mods(P([e('clomiphene'), e('hcg')], LOW)).notes.some(n => /Habous 2018/.test(n)), 'and says why');

  // SERM + AI: same lever, so no extra testosterone either.
  const ai = mods(P([e('aromatase_inhibitor')], LOW)).testosterone;
  const sermAi = mods(P([e('clomiphene'), e('aromatase_inhibitor')], LOW)).testosterone;
  assert.ok(sermAi.level - sermAi.natural < (clo.level - clo.natural) + (ai.level - ai.natural) - 50);

  // A supplement on top of a drug adds nothing: same final common path.
  const cloAsh = mods(P([e('clomiphene'), e('ashwagandha')], LOW)).testosterone;
  assert.ok(Math.abs(cloAsh.level - clo.level) < 1, 'ashwagandha adds nothing on top of clomiphene');

  // Cause-correction is different: it raises the set-point FIRST, and the drug then works from there.
  // CHANGED 2026-10-20. The old assertion was that this must land WELL BELOW the naive sum, i.e. that raising a
  // man's baseline shrinks what clomiphene can add. That is not what the evidence says. Hohl 2025 pooled a single
  // absolute effect (+273.8 ng/dL) across baselines 67–303, and the two largest predictor cohorts — Keihani 2020
  // (n=332) and Kim 2026 (n=292) — both found baseline total testosterone did NOT predict the response. Below
  // ~550 ng/dL the two are therefore close to additive on the number. The shrink only appears once the taper
  // above 550 starts, so that is where it is now asserted.
  const short = { ...LOW, sleepHours: 5.5 };
  const cloShort = mods(P([e('clomiphene')], short)).testosterone;
  const sleepOnly = mods(P([e('sleep_hygiene')], short)).testosterone;
  const sleepClo = mods(P([e('sleep_hygiene'), e('clomiphene')], short)).testosterone;
  assert.ok(sleepOnly.level > sleepOnly.natural, 'fixing sleep raises the set-point');
  assert.ok(sleepClo.level > cloShort.level, 'and the drug then works from the higher baseline');
  assert.ok(sleepClo.level <= (cloShort.level - cloShort.natural) + sleepOnly.level + 2,
    `sleep + clomiphene (${sleepClo.level}) is never MORE than the naive sum`);
  // Up at the top of the curve the absolute rise does taper, so the shrink reappears.
  const hiBase = { totalT: 700, labDate: '2026-07-01', lh: 3 };
  const d700 = tShiftPct(SUPPLEMENTS.clomiphene.model, { baselineT: 700, lh: 3 }).pct * 700 / 100;
  const d300 = tShiftPct(SUPPLEMENTS.clomiphene.model, { baselineT: 300, lh: 3 }).pct * 300 / 100;
  assert.ok(d700 < d300 - 5, `the absolute rise tapers at a high baseline: ${d700} vs ${d300}`);
  assert.ok(mods(P([e('clomiphene')], hiBase)).testosterone.level > 700, 'but is still positive');
});

test('combineEndogenous is directly testable and saturating', () => {
  const part = (id, over = {}) => ({ id, name: SUPPLEMENTS[id].name, item: SUPPLEMENTS[id],
    model: { ...SUPPLEMENTS[id].model, ...over }, dose: null, resp: 1, ramp: 1, weeksOn: 12 });
  const c = combineEndogenous([part('clomiphene'), part('hcg')], { baselineT: 250, lh: 3 });
  assert.ok(c.level > 250 && c.level <= TESTIS_CEILING);
  assert.equal(c.parts.filter(p => p.role === 'subsumed').length, 1, 'exactly one item is subsumed');
  assert.ok(c.levelHi > c.level, 'the optimistic bound adds a little of the second item');
  assert.ok(c.levelLo <= c.level);
});

// ====================================================================== 3. ceilings
test('the testicular / pituitary capacity ceiling bounds total LH-driven output', () => {
  // CHANGED 2026-10-20. The ceilings were 800 / 1,100, justified as "the highest group mean any SERM or AI trial
  // reached is 790 (Krause 1992)". That survey missed the eugonadal trials. The highest group mean ANY own-axis
  // trial has reported is 48.2 nmol/L = 1,390 ng/dL — clomiphene 50 mg twice daily for 8 weeks in five healthy
  // men aged 26–33 (Tenover & Bremner 1991). So both ceilings are now 1,390 and they are equal: nobody has shown
  // hCG pushing past a SERM (its highest figure is Liu 2002's inferred ≈870).
  assert.equal(PITUITARY_CEILING, 1390);
  assert.equal(TESTIS_CEILING, 1390);
  assert.ok(PITUITARY_CEILING <= TESTIS_CEILING);
  // A man with a healthy baseline who stacks everything cannot be pushed past the route plateau.
  const all = mods(P([e('clomiphene'), e('enclomiphene'), e('hcg'), e('aromatase_inhibitor'), e('tamoxifen'), e('ashwagandha')],
    { totalT: 450, labDate: '2026-07-01', lh: 3 })).testosterone;
  assert.ok(all.level <= TESTIS_CEILING, `${all.level} must not exceed the testicular ceiling ${TESTIS_CEILING}`);
  // Per-item ceilings are what actually bind, and each is the highest group mean that item reported.
  assert.equal(SUPPLEMENTS.clomiphene.model.ceilingNg, 1390);   // Tenover 1991
  assert.equal(SUPPLEMENTS.enclomiphene.model.ceilingNg, 764);  // Wiehle 2013, 25 mg day-42 Cmax
  assert.equal(SUPPLEMENTS.tamoxifen.model.ceilingNg, 790);     // Krause 1992
  const tam = mods(P([e('tamoxifen')], { totalT: 700, labDate: '2026-07-01', lh: 3 })).testosterone;
  assert.ok(tam.level <= 790 + 0.5, `tamoxifen capped at its own 790, got ${tam.level}`);
  const enc = mods(P([e('enclomiphene')], { totalT: 650, labDate: '2026-07-01', lh: 3 })).testosterone;
  assert.ok(enc.level <= 764 + 0.5, `enclomiphene capped at its own 764, got ${enc.level}`);
  // Muscle credit never exceeds the level the evidence reached. For a man INSIDE Soares 2018's population
  // (T ≤300) the credit is MEASURED and stays near that trial's landing zone.
  const clo = mods(P([e('clomiphene')], LOW)).testosterone;
  assert.equal(clo.extrapolated, false, 'a hypogonadal man is inside Soares 2018');
  assert.ok(clo.leanLevel <= clo.level + 1 && clo.leanLevel > clo.natural);
  // A eugonadal man is OUTSIDE it (baseline above Soares' T ≤300 entry), so the credit is flagged extrapolated.
  const eug = mods(P([e('clomiphene')], EUGONADAL)).testosterone;
  assert.equal(eug.extrapolated, true, 'a eugonadal man is past the body-composition evidence');
  assert.ok(eug.leanLevel <= SUPPLEMENTS.clomiphene.model.bcExtrapMaxLevel + 1);
  // A cause item with a generous bound must not launder a drug's rise past the drug's own bound.
  const withSleep = mods(P([e('sleep_hygiene'), e('clomiphene')], { ...LOW, sleepHours: 5.5 })).testosterone;
  assert.ok(withSleep.leanLevel <= withSleep.level + 1,
    `credit ${withSleep.leanLevel} must stay inside clomiphene's evidence bound`);
});

// ====================================================================== 4. gating
test('primary hypogonadism blocks every axis drug; exogenous testosterone suppresses all of them', () => {
  // CHANGED 2026-10-20: PRIMARY is now LH 20, not LH 14. At 14 the response is attenuated, not abolished
  // (Keihani 2020, Kim 2026) — see the dedicated LH test above.
  for (const id of ['clomiphene', 'enclomiphene', 'hcg', 'aromatase_inhibitor', 'tamoxifen']) {
    const m = mods(P([e(id)], PRIMARY));
    assert.equal(m.testosterone.level, m.testosterone.natural, `${id} must not raise T when LH is clearly high`);
    // REWORDED 2026-10-21 — see the note in supp-endogenous.test.js. The assertion checks the substance of the
    // explanation rather than the old "(testicular)" parenthesis that Bob misread.
    const note = m.contributions.filter(c => c.id === id).map(c => c.text).join(' ');
    assert.match(note, /primary/i, `${id} explains why`);
    assert.match(note, /not being acted on|already being shouted/i, `${id} says the signal is maximal and unheeded`);
    assert.match(note, /not how they look/i, `${id} says it is not visible from outside`);
    const mild = mods(P([e(id)], PRIMARY_MILD)).testosterone;
    assert.ok(mild.level > mild.natural, `${id} must still do something at a only slightly raised LH`);
  }
  // The AI still blocks aromatase, so it still costs estrogen action and fat even when the T gate says no.
  const ai = mods(P([e('aromatase_inhibitor')], PRIMARY));
  assert.ok(ai.testosterone.e2ActionDrop > 0.2, 'estrogen action still falls');
  assert.ok(ai.fatDirectLbPerWeek > 0, 'and fat still goes up');

  // On any exogenous testosterone route, own-axis items are ignored.
  for (const exo of ['trt', 'oral_tu', 'nasal_t']) {
    const m = mods(P([e(exo), e('clomiphene'), e('hcg')], { totalT: 310, onTrtT: 800, labDate: '2026-07-01' }));
    assert.equal(m.testosterone.level, 800, exo);
    for (const id of ['clomiphene', 'hcg']) {
      assert.ok(m.contributions.some(c => c.id === id && /no effect while on testosterone therapy/i.test(c.text)), `${exo} + ${id}`);
    }
    assert.ok(isExogenousT(SUPPLEMENTS[exo]), exo + ' is exogenous');
  }
  // Oral TU with no lab falls back to its trial mean, clearly flagged.
  const oral = mods(P([e('oral_tu')], { totalT: 250, labDate: '2026-07-01' }));
  assert.equal(oral.testosterone.level, SUPPLEMENTS.oral_tu.model.trialLevel);
  assert.ok(oral.warnings.some(w => /no measured level entered/i.test(w)));
  // Natesto's partial axis preservation is stated.
  assert.ok(mods(P([e('nasal_t')], { totalT: 250, labDate: '2026-07-01' })).notes.some(n => /LH stayed normal/i.test(n)));
});

test('deficiency corrections only help when the deficiency exists', () => {
  const baseT = mods(P()).testosterone.natural;
  assert.equal(mods(P([e('cabergoline')], { totalT: 280, labDate: '2026-07-01', prolactin: 8 })).testosterone.level, 280);
  assert.ok(mods(P([e('cabergoline')], { totalT: 280, labDate: '2026-07-01', prolactin: 45, lh: 2 })).testosterone.level > 400);
  assert.equal(mods(P([e('zma')], { zinc: 95 })).testosterone.level, baseT);
  assert.ok(mods(P([e('zma')], { totalT: 320, labDate: '2026-07-01', zinc: 55 })).testosterone.level > 320);
  // Vitamin D: nothing unless deficient.
  const vdOk = mods(P([e('vitamin_d')], { vitD: 35 })), vdLow = mods(P([e('vitamin_d')], { vitD: 12 }));
  assert.equal(vdOk.leanCeilingMult, mods(P([], { vitD: 35 })).leanCeilingMult);
  assert.ok(vdLow.leanCeilingMult > mods(P([], { vitD: 12 })).leanCeilingMult);
  // Energy availability needs an entered deficit.
  assert.equal(mods(P([e('energy_availability')])).testosterone.level, baseT);
  const fed = mods(P([e('energy_availability')], { deficitKcal: 1000 }));
  assert.ok(fed.testosterone.level > fed.testosterone.natural, 'undoing a real deficit recovers testosterone');
});

// ====================================================================== 5. the aromatase-inhibitor case
test('aromatase inhibitor: testosterone up, lean flat, fat up through the estradiol term', () => {
  const off = mods(P([], LOW));
  const ai = mods(P([e('aromatase_inhibitor')], LOW));
  assert.ok(ai.testosterone.level > off.testosterone.level + 100, 'the number goes up a lot');
  assert.equal(ai.leanCeilingMult, off.leanCeilingMult, 'no ceiling credit');
  assert.equal(ai.leanDirectLbPerWeek, off.leanDirectLbPerWeek, 'no direct lean credit');
  assert.equal(ai.testosterone.leanLevel, ai.testosterone.natural, 'muscle credited at baseline, i.e. none');
  assert.ok(ai.fatDirectLbPerWeek > off.fatDirectLbPerWeek, 'and fat goes UP (Finkelstein 2013)');
  assert.ok(ai.testosterone.estradiol < ai.testosterone.estradiolBase, 'estradiol falls');
  assert.ok(ai.warnings.some(w => /no muscle from it/i.test(w)));
  assert.ok(ai.notes.some(n => /Finkelstein 2013/.test(n) && /ASSUMPTION/.test(n)), 'the fat magnitude is labelled an assumption');
  assert.ok(ai.risks.some(r => /bone/i.test(r.text)));

  // The scaling is what reconciles Finkelstein with the real-world trials: a partial estradiol drop is a small cost.
  const full = estradiolFatEffect(0.90, { weeksOn: 16 });
  const real = estradiolFatEffect(0.35, { weeksOn: 16 });
  assert.ok(full.cumLb > real.cumLb * 2, 'near-total blockade costs much more than a real-world 35 % drop');
  assert.ok(Math.abs(full.cumLb - E2_FAT.kgAtFullBlock * 2.20462) < 0.2, 'anchored on the 16-week assumption');
  assert.ok(estradiolFatEffect(0).fatDirectLbPerWeek === 0);

  // Colleluori 2020 reversal: severe obesity with a high estradiol → no penalty.
  const rev = estradiolFatEffect(0.5, { weeksOn: 26, bmi: 38, estradiol: 32 });
  assert.equal(rev.reversed, true);
  assert.equal(rev.fatDirectLbPerWeek, 0);
  assert.ok(rev.loLb < 0, 'the trial direction is the optimistic end');
  assert.ok(/Colleluori 2020/.test(rev.note));
  const obeseAi = mods(P([e('fat_loss'), e('aromatase_inhibitor')], { totalT: 280, labDate: '2026-07-01', lh: 4, estradiol: 32 }, { bodyweight: 280 }));
  assert.ok(obeseAi.fatDirectLbPerWeek <= 0, 'no fat penalty in the one population where it reversed');
  // Finkelstein found NO lean effect from estradiol, so the term must never touch lean.
  assert.equal(mods(P([e('aromatase_inhibitor')], { ...LOW, estradiol: 30 })).leanDirectLbPerWeek, off.leanDirectLbPerWeek);
});

// ====================================================================== 6. the planner
test('the planner ranks by lean and fat, not by the testosterone rise', () => {
  const plan = tPlan(P([], LOW), { now: DATE, age: 39, bodyweightLb: 164 });
  assert.equal(plan.hidden, false);
  const byId = Object.fromEntries(plan.rows.map(r => [r.id, r]));
  const ai = byId.aromatase_inhibitor, hcg = byId.hcg;
  assert.ok(ai && hcg);
  // The AI moves testosterone a long way and still ranks below items that move it less.
  assert.ok(ai.t.to - ai.t.from > 100, 'AI raises T');
  assert.equal(ai.lean.lb, 0, 'and adds no lean');
  assert.ok(ai.fat.lb > 0, 'and adds fat');
  assert.ok(plan.rows.indexOf(hcg) < plan.rows.indexOf(ai), 'so it ranks below hCG');
  const scores = plan.rows.map(r => r.score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] <= scores[i - 1] + 1e-9, 'rows are sorted by net lb');
  // A combination is present and is not the sum of its parts.
  const combo = byId['clomiphene+hcg'];
  assert.ok(combo && combo.combo);
  assert.ok(combo.lean.lb <= byId.clomiphene.lean.lb + byId.hcg.lean.lb - 1, 'combination < sum of parts');
  // Ranges, evidence, labs and prescriber status are all carried.
  for (const r of plan.rows) {
    assert.ok(r.lean.lo <= r.lean.lb + 1e-6 && r.lean.hi >= r.lean.lb - 1e-6, `${r.id} lean range brackets the point`);
    assert.ok(typeof r.evidence === 'string' && r.evidence.length > 0, `${r.id} evidence`);
    assert.ok(['measured', 'extrapolated', 'none'].includes(r.bodyComp), `${r.id} bodyComp`);
    if (r.rx) assert.ok(r.ids.some(isRx), `${r.id} rx flag matches the catalogue`);
  }
  // Extrapolated rows have a lower bound of zero: zero is what has actually been measured.
  const tam = byId.tamoxifen;
  assert.equal(tam.extrapolated, true);
  assert.equal(tam.lean.lo, 0);
  assert.ok(tam.rx && tam.wada.length, 'and carries its prescriber and anti-doping status');
});

test('the planner is honest about zeros, and puts the labs first when they are missing', () => {
  const plan = tPlan(P(), { now: DATE, age: 39, bodyweightLb: 164 });       // Bob: no labs at all
  assert.equal(plan.labs.decisive, false);
  const labsAction = plan.actions.find(a => a.kind === 'labs');
  assert.ok(labsAction, 'getting labs is the first action');
  assert.ok(labsAction.labs.length >= 8 && labsAction.labs.every(l => l.why));
  assert.deepEqual(labsAction.labs.map(l => l.k).sort(), T_LAB_PANEL.map(l => l.k).sort());
  // CHANGED 2026-10-20, and this is the heart of the correction. These three used to be pinned at "moves
  // nothing, lean 0, reason: studied only in men with low testosterone". That was wrong: clomiphene's rise in
  // eugonadal men is measured (Tenover 1991, Bremner 1987) and hCG stimulation is the standard test of Leydig
  // reserve in normal men. They now move, and the honesty has shifted from the hormone to the MUSCLE.
  for (const id of ['clomiphene', 'enclomiphene', 'hcg']) {
    const r = plan.rows.find(x => x.id === id);
    assert.ok(r, id + ' is still listed');
    assert.ok(r.t.to > r.t.from + 100, `${id} must now move a mid-normal man's testosterone (${r.t.from} → ${r.t.to})`);
    assert.ok(r.lean.lb > 0, `${id} shows a modeled lean number`);
    assert.equal(r.lean.lo, 0, `${id} range starts at zero: nothing has been measured here`);
    assert.equal(r.bodyComp, 'extrapolated', `${id} is labelled extrapolated for a eugonadal man`);
    assert.equal(r.extrapolated, true);
    assert.ok(r.score <= 0.05, `${id} is ranked on that zero floor, not on the mid-point (score ${r.score})`);
    assert.ok(r.why.some(w => /EXTRAPOLATION/.test(w) && /gonadotropins switched off/.test(w)),
      id + ' says the T→lean curve came from exogenous testosterone');
  }
  // Clomiphene is the best-evidenced of the three at a normal baseline and must show the biggest modeled rise
  // of the two SERMs, because it is the one with eugonadal measurements behind it.
  const cl = plan.rows.find(x => x.id === 'clomiphene'), en = plan.rows.find(x => x.id === 'enclomiphene');
  assert.ok(cl.t.to > en.t.to, 'clomiphene > enclomiphene at a normal baseline');
  assert.ok(cl.freeT.to > cl.freeT.from, 'and free testosterone rises with it');
  // Refuted supplements are listed at zero with the reason, not omitted.
  for (const id of ['tribulus', 'maca', 'dhea']) assert.ok(plan.rows.some(r => r.id === id), id);
  assert.ok(plan.assumptions.some(a => /assumed average/i.test(a)));
  assert.ok(plan.assumptions.some(a => /Estradiol: assumed/.test(a)));
  assert.ok(/S4\.2/.test(plan.wada) && /S4\.1/.test(plan.wada) && /S2\.2/.test(plan.wada));
});

test('the planner is hidden for women (§20)', () => {
  const f = tPlan(P([], {}, { body: { sex: 'female', birthYear: 1990 } }), { now: DATE, age: 36 });
  assert.equal(f.female, true);
  assert.equal(f.hidden, true);
  assert.equal(f.rows.length, 0);
  assert.match(f.why, /male hypothalamic/i);
});

test('the planner survives a profile with nothing in it', () => {
  for (const p of [{}, null, { supplements: 'nope', metabolic: 5 }, P([e('clomiphene', 'bad-date')])]) {
    const r = tPlan(p, { now: DATE });
    assert.ok(Array.isArray(r.rows));
    for (const row of r.rows) {
      for (const k of [row.lean.lb, row.lean.lo, row.lean.hi, row.fat.lb, row.score, row.t.to]) assert.ok(Number.isFinite(k), `${row.id} ${k}`);
    }
  }
});

// ====================================================================== 7. no change for everyone else
test('a user with none of these items gets byte-identical numbers', () => {
  const m = mods(P([e('creatine')]));
  const golden = { leanCeilingMult: 1.102, leanRetentionMult: 1, partitionShift: 0, tdeeDelta: 0,
    intakeDelta: 0, waterLb: 1.6, leanDirectLbPerWeek: 0, fatDirectLbPerWeek: 0 };
  for (const [k, v] of Object.entries(golden)) assert.equal(m[k] + 0, v, `${k} changed`);
  const t = m.testosterone;
  assert.equal(t.level, 548); assert.equal(t.natural, 548); assert.equal(t.leanLevel, 548);
  assert.equal(t.source, 'natural'); assert.equal(t.e2ActionDrop, 0); assert.equal(t.extrapolated, false);
  assert.equal(t.estradiol, null); assert.equal(t.shbg, null);
  assert.match(t.note, /within the normal range/);
  // and the projection is unchanged too
  const base = { profile: P([e('creatine')]), baseline: { weightLb: 164, bodyFatPct: 23, age: 39, heightIn: 70, measurements: {} },
    sessions: [], weeks: 12, now: new Date(DATE + 'T12:00:00') };
  const a = PJ.project(base), b = PJ.project(base);
  assert.deepEqual(a.summary, b.summary);
  assert.equal(JSON.stringify(a.series), JSON.stringify(b.series));
});

test('catalogue bookkeeping: rx flags, exogenous routes and combination definitions', () => {
  assert.ok(RX_IDS.includes('clomiphene') && RX_IDS.includes('hcg') && RX_IDS.includes('oral_tu'));
  assert.ok(!RX_IDS.includes('ashwagandha') && !RX_IDS.includes('sleep_hygiene'));
  for (const id of RX_IDS) assert.equal(isRx(SUPPLEMENTS[id]), true, id);
  for (const c of COMBOS) {
    assert.ok(c.ids.length >= 2 && c.ids.every(id => SUPPLEMENTS[id]), c.ids.join('+'));
    assert.ok(typeof c.why === 'string' && c.why.length > 30, c.ids.join('+') + ' needs a rationale');
  }
  assert.equal(ASSUMED_E2, 25);
  assert.equal(ASSUMED_SHBG, 35);
  assert.ok(testosteroneEffect(500, { baselineT: 300 }).leanDirectLbPerWeek > 0);
  // CHANGED 2026-10-20: was `lh: 14 → 0`. 14 now attenuates (Keihani 2020); 20 is the clear zero.
  assert.equal(tShiftPct(SUPPLEMENTS.hcg.model, { baselineT: 300, lh: 20 }).pct, 0);
  assert.ok(tShiftPct(SUPPLEMENTS.hcg.model, { baselineT: 300, lh: 14 }).pct > 0);
  // No own-axis item may keep a hard zero-above-a-normal-level gate any more: every one of them was fitted only
  // to hypogonadal trials, and the eugonadal measurements contradict the extrapolation to zero.
  for (const id of ['clomiphene', 'enclomiphene', 'hcg', 'tamoxifen', 'cabergoline', 'aromatase_inhibitor']) {
    const g = SUPPLEMENTS[id].model.gate || {};
    assert.ok(!g.lowTOnly && g.noEffectAbove == null, `${id} must not carry a hard zero-above gate any more`);
  }
  // ...except where the SHAPE itself is the evidence. Cabergoline gives back what prolactin took, so it really
  // does taper to nothing at a normal testosterone — and it still needs a measured high prolactin.
  assert.equal(SUPPLEMENTS.cabergoline.model.gate.highProlactin, true);
  assert.equal(tShiftPct(SUPPLEMENTS.cabergoline.model, { baselineT: 750, lh: 3, prolactin: 60 }).pct, 0);
  assert.ok(tShiftPct(SUPPLEMENTS.cabergoline.model, { baselineT: 250, lh: 3, prolactin: 60 }).pct > 50);
  // Tongkat ali's zero in the normal range is also genuine (the meta-analysis subgroup was not significant).
  assert.equal(SUPPLEMENTS.tongkat_ali.model.tPct, 0);
});

// ====================================================================== §22.9 presentation, scenarios, causes
// Bob: "Right now it's barely adding anything, and I just don't think that's accurate. It helps a lot of people
// a lot." Then: "enclomiphene works for non hypogonadal males if there is some specific issue that is causing
// low T ... I want the game changing results to be the default with the caveats mentioned."
// He was right twice over, and the first half was a bug Forge introduced, not a disagreement about evidence.
import { scenarioBand, SCENARIOS, SCENARIO_IDS, T_REFERENCE_RANGE, T_REFERENCE_PCTILE } from '../js/engine/tplan.js';
import { rampExposureLoss, stackTimeline } from '../js/engine/metabolic.js';

const BOB = { now: DATE, age: 39, bodyweightLb: 164, weeks: 52 };
const BOB_PROJ = { ...BOB, baseline: { weightLb: 164, bfPct: 9, date: DATE }, sessions: [], projectFn: PJ.project, maxProjections: 20 };

test('§22.9 a row leads with the CENTRAL estimate, not the conservative ranking score', () => {
  const plan = tPlan(P(), BOB_PROJ);
  const clo = plan.rows.find(r => r.id === 'clomiphene');
  assert.ok(clo, 'clomiphene row exists');
  // THE BUG. For a man at an assumed mid-normal baseline the row used to headline `score`, which for an item
  // with no body-composition measurement is pinned to the conservative END of its own range (zero). The row
  // therefore announced "±0 lb net" immediately above its own body saying "+4.4 lb lean".
  assert.ok(clo.net, 'the row carries a net estimate');
  assert.ok(clo.lean.lb > 2, `lean is substantial (${clo.lean.lb} lb)`);
  assert.ok(clo.net.lb > 2, `and the headline says so (${clo.net.lb} lb net) instead of ~0`);
  // net is lean minus fat, and its range is the widest honest reading of the two.
  assert.ok(Math.abs(clo.net.lb - (clo.lean.lb - clo.fat.lb)) < 0.02, 'net = lean − fat');
  assert.ok(Math.abs(clo.net.lo - (clo.lean.lo - clo.fat.hi)) < 0.02, 'net.lo pairs the low lean with the high fat');
  assert.ok(Math.abs(clo.net.hi - (clo.lean.hi - clo.fat.lo)) < 0.02, 'net.hi pairs the high lean with the low fat');
  assert.ok(clo.net.lo <= clo.net.lb && clo.net.lb <= clo.net.hi, 'the estimate sits inside its own range');
  // AND THE HONESTY IS UNCHANGED. The range still starts at (or below) zero because nothing has been weighed in
  // a man like him, the per-man evidence class still says so, and the score still ranks conservatively.
  assert.equal(clo.bodyComp, 'extrapolated', 'still labelled an extrapolation for this man');
  assert.equal(clo.extrapolated, true);
  assert.ok(clo.lean.lo <= 0, 'the lean range still starts at zero where nothing was measured');
  assert.ok(clo.score <= 0.05, 'the RANKING score is still the conservative end');
  assert.ok(clo.score < clo.net.lb, 'ranking is conservative, display is the estimate — they are different numbers');
  assert.ok(clo.t.assumed === true, 'and the row still says the starting number was assumed');
  assert.ok(clo.tolerability && clo.tolerability.grade, 'tolerability still travels with the row');
});

test('§22.9 the scenario band shows the measured, much larger result at a suppressed baseline', () => {
  const band = scenarioBand(P(), BOB_PROJ);
  assert.equal(band.length, 4, 'four scenarios across the width of the reference range');
  assert.deepEqual(band.map(s => s.key), ['suppressed', 'lowNormal', 'average', 'highNormal']);
  const sup = band.find(s => s.key === 'suppressed');
  const avg = band.find(s => s.key === 'average');
  const hi = band.find(s => s.key === 'highNormal');
  for (const sc of band) assert.deepEqual(sc.rows.map(r => r.id), [...SCENARIO_IDS], `${sc.key} covers the same therapies`);
  const net = (sc, id) => sc.rows.find(r => r.id === id).net.lb;
  // THE POINT BOB WAS MAKING. In a man whose own axis is suppressed these are not modest, and the result is
  // MEASURED rather than extrapolated (Soares 2018 for clomiphene, Liu 2002 for hCG).
  assert.ok(net(sup, 'clomiphene+hcg') > 8, `suppressed axis: clomiphene + hCG ${net(sup, 'clomiphene+hcg')} lb net`);
  assert.equal(sup.rows.find(r => r.id === 'clomiphene').bodyComp, 'measured');
  assert.equal(sup.rows.find(r => r.id === 'clomiphene+hcg').bodyComp, 'measured');
  // 300 ng/dL is at the BOTTOM of the harmonized range, not outside it — the 5th percentile is 303 and the
  // 2.5th is 264. That distinction is the whole reason the band exists, so the data has to get it right.
  assert.equal(sup.lowEnd, true, '300 ng/dL is at or below the harmonized 5th percentile');
  assert.equal(sup.belowRange, false, '...and still technically inside the range, whose floor is 264');
  // ...and it is a gradient, not a cliff: the modeled benefit falls monotonically as the baseline rises.
  for (const id of SCENARIO_IDS) {
    assert.ok(net(sup, id) >= net(avg, id) - 0.01, `${id}: suppressed ≥ average`);
    assert.ok(net(avg, id) >= net(hi, id) - 0.01, `${id}: average ≥ high-normal`);
  }
  assert.ok(net(sup, 'clomiphene') > net(avg, 'clomiphene') * 1.5, 'and the gap is large, not cosmetic');
  // THE LINE NOT TO CROSS: the band must never read as a prediction about him. Exactly one column is marked as
  // nearest his own level, it is the population average, and nothing here changed the baseline Forge assumes.
  assert.equal(band.filter(s => s.yours).length, 1, 'exactly one column is flagged as closest to him');
  assert.equal(band.find(s => s.yours).key, 'average', 'and with no lab that column is the population average');
  const plan = tPlan(P(), BOB);
  assert.equal(plan.tAssumed, true);
  assert.ok(plan.tAssumedLevel > 500 && plan.tAssumedLevel < 600, `assumed baseline is unchanged (${plan.tAssumedLevel})`);
  assert.equal(plan.rows.find(r => r.id === 'clomiphene').t.from, plan.tAssumedLevel, 'his rows still run off his own level');
  // A man WITH a low lab gets the suppressed column flagged as his, which is the same machinery read the other way.
  assert.equal(scenarioBand(P([], LOW), BOB).find(s => s.yours).key, 'suppressed');
  // ...and a man whose LH says PRIMARY is outside the band's premise entirely. Every column is a secondary case,
  // his own rows are correctly modeled at zero, and the band must not be the one place that contradicts them.
  const prim = scenarioBand(P([], PRIMARY), BOB);
  assert.equal(prim.filter(s => s.yours).length, 0, 'no column is flagged as his');
  assert.equal(prim[0].notApplicable, true);
  assert.match(prim[0].whyNot, /SECONDARY/, 'says why the band does not apply to him');
  assert.match(prim[0].whyNot, /not how they look|respond to the signal/i, 'without the "small testicles" misreading');
  const primPlan = tPlan(P([], PRIMARY), BOB_PROJ);
  assert.equal(primPlan.rows.find(r => r.id === 'clomiphene').net.lb, 0, 'and his own row stays at zero');
  // Every column carries its caveats as data, not as prose the UI has to remember.
  for (const sc of band) { assert.ok(sc.headline && sc.body && sc.pctile, `${sc.key} carries its own caveats`); }
});

test('§22.9 the width of "normal" is the harmonized range, and it is wide', () => {
  assert.deepEqual([...T_REFERENCE_RANGE], [264, 916], 'Travison 2017, healthy non-obese men 19–39');
  const pct = Object.fromEntries(T_REFERENCE_PCTILE);
  assert.equal(pct[5], 303); assert.equal(pct[50], 531); assert.equal(pct[95], 852);
  assert.ok(T_REFERENCE_RANGE[1] / T_REFERENCE_RANGE[0] > 3.4, 'end to end it is a >3.4-fold spread');
  // A man at 350 is inside the range and still far below the median: that is the gap these drugs are used in.
  assert.ok(350 > T_REFERENCE_RANGE[0] && 350 < pct[50] * 0.7);
  const plan = tPlan(P(), BOB);
  assert.deepEqual([...plan.referenceRange], [264, 916], 'and the planner hands it to the UI');
});

test('§22.9 reversible causes are named, graded against this man\'s data, and point at the fix', () => {
  const plan = tPlan(P(), BOB);
  const keys = plan.causes.map(c => c.key);
  for (const k of ['obesity', 'sleep', 'energy', 'endurance', 'alcohol', 'prolactin', 'opioids', 'shbg']) {
    assert.ok(keys.includes(k), `names ${k} as a reversible cause`);
  }
  for (const c of plan.causes) {
    assert.ok(['yes', 'maybe', 'no', 'unknown'].includes(c.status), `${c.key} status`);
    assert.ok(c.text && c.said, `${c.key} says what it is and what Forge can see`);
  }
  const by = Object.fromEntries(plan.causes.map(c => [c.key, c]));
  // Forge must not claim to know what it has not been told.
  assert.equal(by.prolactin.status, 'unknown', 'no prolactin lab entered → unknown, not ruled out');
  assert.equal(by.energy.status, 'unknown', 'no deficit entered → unknown');
  assert.equal(by.opioids.modeled, false, 'opioids are a documented cause Forge does NOT model, and says so');
  // ...and must use what it has.
  assert.equal(by.obesity.status, 'no', 'a lean man: ruled out by the data entered');
  const fat = tPlan(P([], {}, { bodyweight: 260 }), { ...BOB, bodyweightLb: 260 });
  assert.equal(fat.causes.find(c => c.key === 'obesity').status, 'yes');
  assert.equal(tPlan(P([], { sleepHours: 5 }), BOB).causes.find(c => c.key === 'sleep').status, 'yes');
  assert.equal(tPlan(P([], { prolactin: 60 }), BOB).causes.find(c => c.key === 'prolactin').status, 'yes');
  assert.equal(tPlan(P([], { shbg: 80 }), BOB).causes.find(c => c.key === 'shbg').status, 'yes');
  assert.equal(tPlan(P([], { deficitKcal: 900 }), BOB).causes.find(c => c.key === 'energy').status, 'yes');
  // Each modeled cause points at a catalogue item that models it, so "fix the cause" is actionable, not advice.
  for (const c of plan.causes) if (c.modeled) assert.ok(SUPPLEMENTS[c.fix], `${c.key} → ${c.fix} exists`);
});

test('§22.9 this man\'s own risk factors are flagged as plausible, never asserted', () => {
  const bare = tPlan(P(), BOB);
  assert.deepEqual(bare.flags, [], 'a profile with no risk factors gets no flags');
  // Bob's three: an endurance background, a prescribed appetite-suppressing stimulant, and the low energy
  // availability that follows from both and that Forge currently models at zero.
  const bob = tPlan(P([e('adderall')], {}, { cardioTargetMin: 300 }), BOB);
  const keys = bob.flags.map(f => f.key);
  assert.deepEqual(keys, ['endurance', 'stimulant', 'lea', 'verdict']);
  const verdict = bob.flags.find(f => f.verdict);
  assert.match(verdict.text, /plausible/i, 'the verdict is that a low baseline is PLAUSIBLE');
  assert.match(verdict.text, /do not make it a fact|not make it a fact/i, 'and explicitly not a fact');
  assert.match(verdict.text, /lab/i, 'and a lab settles it');
  // The flags must not move the number. Forge still assumes the population average for him.
  assert.equal(bob.tAssumed, true);
  assert.equal(bob.tAssumedLevel, bare.tAssumedLevel, 'risk factors do not lower the assumed baseline');
  // Entering a deficit resolves the one Forge was blind to.
  const quantified = tPlan(P([e('adderall')], { deficitKcal: 800 }, { cardioTargetMin: 300 }), BOB);
  assert.ok(!quantified.flags.some(f => f.key === 'lea'), 'the "unquantified" flag goes away once he quantifies it');
  assert.ok(quantified.flags.some(f => f.key === 'endurance'), 'the other two stand');
});

test('§22.9 the serum ramp delays the muscle curve; it no longer docks its asymptote', () => {
  // THE DOUBLE DISCOUNT THAT WAS REAL. The accrual curve is saturating (most of the gain in the first weeks,
  // rate decaying as e^(−w/τ)) while the endogenous items ramp their serum level in over `rampWeeks`. Evaluating
  // the decaying rate at RAW elapsed weeks meant the highest-rate weeks were spent at a reduced amplitude and
  // the clock had already passed them by the time the level arrived. A 6-week titration permanently removed
  // ~20% of the asymptote — for Bob, 3.05 lb instead of 3.83 lb, for ever. No trial supports that.
  assert.equal(rampExposureLoss(52, 0), 0, 'no ramp, no loss');
  assert.equal(rampExposureLoss(52, 6), 3, 'past the ramp the lag is half the ramp window');
  assert.ok(Math.abs(rampExposureLoss(6, 6) - 3) < 1e-9, 'at the end of the ramp, exactly half of it');
  assert.ok(Math.abs(rampExposureLoss(3, 6) - 2.25) < 1e-9, 'inside the ramp it is the integral of (1 − ramp)');
  assert.ok(rampExposureLoss(2, 6) < rampExposureLoss(4, 6), 'monotone while ramping');

  const wk12 = modifiersAt(P([e('clomiphene', '2026-07-28')]), DATE, { age: 39 });
  assert.ok(wk12.testosterone.weeksEff > 0 && wk12.testosterone.weeksEff < wk12.testosterone.weeksOn,
    `effective exposure (${wk12.testosterone.weeksEff}) lags elapsed weeks (${wk12.testosterone.weeksOn})`);

  // It is a DELAY: run the clock out and the cumulative gain reaches the Bhasin asymptote instead of stalling
  // a fifth of the way short of it.
  const p = P([e('clomiphene', DATE)]);
  const short = stackTimeline(p, { from: DATE, weeks: 20, age: 39, bodyweightLb: 164 });
  const year = stackTimeline(p, { from: DATE, weeks: 52, age: 39, bodyweightLb: 164 });
  const far = stackTimeline(p, { from: DATE, weeks: 260, age: 39, bodyweightLb: 164 });
  const lvl = modifiersAt(P([e('clomiphene', '2025-10-21')]), DATE, { age: 39 }).testosterone;
  const asym = testosteroneEffect(lvl.leanLevel, { baselineT: lvl.natural, weeksOn: 2000, age: 39 }).asymptoteLb;
  assert.ok(asym > 3 && asym < 5, `the undamped asymptote is the Bhasin number (${asym} lb)`);
  assert.ok(short.cumLeanDirect < year.cumLeanDirect, 'still monotone in time');
  assert.ok(year.cumLeanDirect > asym * 0.95, `12 months reaches the asymptote (${year.cumLeanDirect} vs ${asym})`);
  assert.ok(far.cumLeanDirect > asym * 0.95 && far.cumLeanDirect < asym * 1.1, 'and settles there rather than running away');
  // The ramp still exists and still costs time early on — that part is measured (levels move over 2–6 weeks).
  assert.ok(short.cumLeanDirect < asym * 0.85, '20 weeks is NOT the full asymptote: the titration still costs time');
});

test('§22.9 every endogenous entry reads as an encyclopedia entry, including what is unknown', () => {
  for (const id of ['clomiphene', 'enclomiphene', 'hcg', 'aromatase_inhibitor', 'tamoxifen', 'cabergoline']) {
    const md = SUPPLEMENTS[id].model;
    assert.ok(Array.isArray(md.unknowns) && md.unknowns.length >= 3, `${id}: says what is NOT known`);
    assert.ok(Array.isArray(md.interactions) && md.interactions.length >= 3, `${id}: lists interactions`);
    for (const ix of md.interactions) {
      assert.ok(ix.with && ix.text, `${id}: an interaction names what it is with and what happens`);
      assert.ok(['pharmacodynamic', 'pharmacokinetic', 'additive'].includes(ix.kind), `${id}: ${ix.with} kind`);
    }
    // The things the planner shows must all be there to show.
    assert.ok(['measured', 'extrapolated', 'none'].includes(md.bodyComp), `${id}: body-composition evidence class`);
    assert.ok(md.monitor && md.monitor.length, `${id}: monitoring`);
    assert.ok(md.suits && md.notSuits, `${id}: who it suits and does not`);
    assert.ok(md.timeCourse && md.wada, `${id}: time course and anti-doping`);
    assert.ok(md.tolerability && md.tolerability.events.length, `${id}: adverse events with denominators`);
    assert.ok(SUPPLEMENTS[id].sources.length >= 3, `${id}: citations`);
  }
  // The one interaction in this category that genuinely changes drug levels is flagged as such.
  const tam = SUPPLEMENTS.tamoxifen.model.interactions.find(i => /CYP2D6/.test(i.with));
  assert.ok(tam && tam.kind === 'pharmacokinetic', 'tamoxifen: CYP2D6 is a pharmacokinetic interaction');
  // ...and enclomiphene's missing long-term safety data is listed as an unknown, because it is the main one.
  assert.ok(SUPPLEMENTS.enclomiphene.model.unknowns.some(u => /16 week|long-term/i.test(u)));
});

test('§22.9 the planner never hides a positive estimate behind a conservative bucket', () => {
  // The second face of the same bug: the UI bucketed rows on the SIGN of `score`. Because `score` is
  // leanLo − fatHi and the projection can put a hair of fat on the high side, clomiphene scored −0.1 and was
  // filed under "changes something, but not in your favour" — a drug the same page credits with +4 lb of lean.
  // The engine now has to make the distinction available: evidence class and central estimate, separately.
  const plan = tPlan(P(), BOB_PROJ);
  const live = plan.rows.filter(r => r.applies && !r.cost);
  const positive = live.filter(r => r.net.lb > 0.05);
  assert.ok(positive.length >= 3, 'several therapies are modeled to add lean mass for him');
  for (const r of positive) {
    assert.ok(r.bodyComp === 'measured' || r.bodyComp === 'extrapolated',
      `${r.id}: a positive estimate carries an evidence class that explains it`);
    assert.ok(r.net.hi >= r.net.lb, `${r.id}: range contains the estimate`);
  }
  // A row with a genuinely measured null stays null — the fix must not promote those.
  const ai = live.find(r => r.id === 'aromatase_inhibitor');
  if (ai) assert.ok(ai.net.lb <= 0.05 || ai.bodyComp === 'none', 'the AI does not become a muscle drug');
});

// ====================================================================== §22.10 tLeanShare composition
// Caught in review of §22.9: clomiphene + aromatase inhibitor ranked ABOVE clomiphene alone (+4.6 vs +4.3 lb
// net). The AI's modeled rise at a mid-normal baseline (+322 ng/dL) is LARGER than clomiphene's (+275), so the
// AI won the "largest LH-driven item" contest, clomiphene was subsumed and contributed nothing to the level
// (COMBO_BONUS = 0) — and the entire 548 → 870, produced start to finish by the AI, was then credited for
// muscle under clomiphene's evidence bound. Adding a drug with four randomized nulls on body composition and a
// 'poor' tolerability grade IMPROVED the row.
//
// Four trials say AI-driven testosterone does not build muscle:
//   Burnett-Bowie 2009a (RCT, men ≥60, anastrozole 1 mg, 12 mo): total T 323 → 525 ng/dL — a SERM-sized rise —
//     and body composition by CT AND DXA, and strength, did not change.
//   Burnett-Bowie 2009b (RCT, n=69, 12 mo): spine BMD FELL on anastrozole and rose on placebo (p=0.0014).
//   Loves 2013 (RCT, letrozole, obese hypogonadal men): same null on body composition.
//   Juang 2014: same.
// That is what `tLeanShare: 0` encodes, and it now has to survive composition.
const AI = 'aromatase_inhibitor';

test('§22.10 an aromatase inhibitor never increases modeled lean, in any combination or at any baseline', () => {
  // The headline invariant. If this ever fails again, the planner is steering people toward the worst option.
  for (const met of [{}, LOW, EUGONADAL, { totalT: 400, labDate: '2026-07-01', lh: 4 }, { totalT: 750, labDate: '2026-07-01', lh: 4 }]) {
    const plan = tPlan(P([], met), BOB_PROJ);
    const row = id => plan.rows.find(r => r.id === id);
    const label = met.totalT ? `T0=${met.totalT}` : 'no labs';
    for (const base of ['clomiphene', 'hcg']) {
      const solo = row(base), combo = row(`${base}+${AI}`);
      if (!solo || !combo) continue;
      assert.ok(combo.lean.lb <= solo.lean.lb + 0.001,
        `${label}: ${base} + AI lean ${combo.lean.lb} must not exceed ${base} alone ${solo.lean.lb}`);
      assert.ok(combo.net.lb <= solo.net.lb + 0.001,
        `${label}: ${base} + AI net ${combo.net.lb} must not exceed ${base} alone ${solo.net.lb}`);
      // ...and the estradiol fat penalty is still engaged. NOTE the invariant is on estrogen ACTION and on the
      // direct Finkelstein term, not on the row's projected fat delta: the projection couples the two, so a
      // combination that builds less lean also deposits slightly less fat, and asserting "more fat" would be
      // asserting an artefact of that coupling rather than the thing being tested.
      assert.ok(combo.e2.actionDrop > 0.3, `${label}: ${base} + AI still blocks estrogen action`);
      assert.ok(combo.t.credited <= solo.t.credited + 1,
        `${label}: the AI's share of the rise earns no muscle credit`);
      // The RANGE too. Before the fix the interval was scaled off the combined SERUM confidence interval, so
      // the AI's own wide CI (tCI [0.45, 2.2]) pushed the top of the row's range ABOVE the SERM's own upside
      // (+10.1 against +7.1) on a rise that credits nothing.
      assert.ok(combo.net.hi <= solo.net.hi + 0.001,
        `${label}: ${base} + AI upside ${combo.net.hi} must not exceed ${base} alone ${solo.net.hi}`);
      assert.ok(combo.lean.hi <= solo.lean.hi + 0.001, `${label}: ${base} + AI lean upside is not widened`);
    }
    // Every row's range must contain its own estimate — the interval is scaled off the credited level now,
    // and a degenerate credited change must fall back to the estimate rather than collapsing to zero.
    for (const r of plan.rows) {
      assert.ok(r.net.lo <= r.net.lb + 1e-9 && r.net.lb <= r.net.hi + 1e-9,
        `${label}: ${r.id} net ${r.net.lb} sits inside [${r.net.lo}, ${r.net.hi}]`);
    }
    // The AI on its own is never a muscle drug either.
    const ai = row(AI);
    if (ai) assert.ok(ai.lean.lb <= 0.05, `${label}: the AI alone credits no lean (${ai.lean.lb})`);
  }
});

test('§22.10 tLeanShare composes: the credit level is the creditable items composed, not the serum level', () => {
  const mk = ids => ids.map(id => ({ id, name: SUPPLEMENTS[id].name, item: SUPPLEMENTS[id], model: SUPPLEMENTS[id].model, dose: null, resp: 1, ramp: 1, weeksOn: 52 }));
  const ctx = { baselineT: 548, lh: 4, bmi: 23.5, age: 39, estradiol: 25, shbg: 35 };
  const solo = combineEndogenous(mk(['clomiphene']), ctx);
  const combo = combineEndogenous(mk(['clomiphene', AI]), ctx);
  // THE SETUP that made this a bug rather than a rounding error: the AI is the DRIVER and clomiphene is
  // subsumed, so the serum rise is entirely the AI's.
  assert.equal(combo.driverId, AI, 'the AI out-rises clomiphene at a mid-normal baseline');
  assert.equal(combo.parts.find(p => p.id === 'clomiphene').role, 'subsumed');
  assert.ok(combo.level > solo.level, `the combination reaches a higher serum level (${Math.round(combo.level)} vs ${Math.round(solo.level)})`);
  // THE FIX: the credit is composed over the creditable items only, so it lands exactly on clomiphene alone.
  assert.ok(Math.abs(combo.creditLevel - solo.creditLevel) < 1,
    `credit ${Math.round(combo.creditLevel)} equals clomiphene alone ${Math.round(solo.creditLevel)}`);
  assert.ok(combo.leanLevelCap < combo.level - 1, 'and the cap is below the serum level');
  assert.deepEqual(combo.uncreditedIds, [AI], 'the AI is named as the uncredited contributor');
  assert.equal(solo.uncreditedIds.length, 0, 'nothing is uncredited when nothing has a reduced share');
  // The estradiol machinery is untouched: the fat cost still applies in full.
  assert.ok(combo.e2ActionDrop > 0.3, 'estrogen action still blocked');
  assert.ok(combo.e2 < solo.e2, 'estradiol still falls');
  // And it really reaches the body model: the direct (calorie-independent) fat term is higher on the combination.
  const mSolo = mods(P([e('clomiphene')])), mCombo = mods(P([e('clomiphene'), e(AI)]));
  assert.ok(mCombo.fatDirectLbPerWeek > mSolo.fatDirectLbPerWeek + 0.001,
    `the Finkelstein fat term is applied (${mCombo.fatDirectLbPerWeek} vs ${mSolo.fatDirectLbPerWeek} lb/wk)`);
  assert.ok(mCombo.leanDirectLbPerWeek <= mSolo.leanDirectLbPerWeek + 1e-9,
    'while the direct lean term is no higher than clomiphene alone');
  // The row explains itself rather than silently differing.
  assert.ok(combo.notes.some(n => /credits muscle on at most/i.test(n)), 'says how much of the rise is credited');
  assert.ok(combo.notes.some(n => /fat cost that follows from it, still apply/i.test(n)), 'and that the fat cost still applies');
});

test('§22.10 the share cap applies to every creditable partner and to a measured on-therapy lab', () => {
  const mk = ids => ids.map(id => ({ id, name: SUPPLEMENTS[id].name, item: SUPPLEMENTS[id], model: SUPPLEMENTS[id].model, dose: null, resp: 1, ramp: 1, weeksOn: 52 }));
  for (const T0 of [300, 400, 548, 750]) {
    const ctx = { baselineT: T0, lh: 4, bmi: 23.5, age: 39, estradiol: 25, shbg: 35 };
    for (const partner of ['clomiphene', 'enclomiphene', 'hcg', 'tamoxifen']) {
      const solo = combineEndogenous(mk([partner]), ctx);
      const combo = combineEndogenous(mk([partner, AI]), ctx);
      assert.ok(combo.creditLevel <= solo.creditLevel + 1,
        `T0=${T0} ${partner}: adding the AI must not raise the credited level (${Math.round(combo.creditLevel)} vs ${Math.round(solo.creditLevel)})`);
    }
    // The AI alone credits nothing at all, at any baseline.
    const ai = combineEndogenous(mk([AI]), ctx);
    assert.ok(Math.abs(ai.creditLevel - T0) < 1, `T0=${T0}: the AI alone credits no rise`);
    assert.equal(ai.creditSource, null);
  }
  // A MEASURED on-therapy lab replaces the modeled level and must go through the same split — otherwise
  // entering a lab would reinstate the bug.
  const prof = (ids, onTrtT) => P(ids.map(id => e(id, '2026-04-01')), { totalT: 548, labDate: '2026-01-01', lh: 4, onTrtT });
  const soloLab = mods(prof(['clomiphene'], 900)).testosterone;
  const comboLab = mods(prof(['clomiphene', AI], 900)).testosterone;
  assert.equal(soloLab.source, 'measured');
  assert.equal(Math.round(soloLab.level), 900);
  assert.equal(Math.round(comboLab.level), 900, 'the measured lab is still used as-is for the serum number');
  assert.ok(comboLab.leanLevel < soloLab.leanLevel - 1,
    `but the credited level is reduced (${Math.round(comboLab.leanLevel)} vs ${Math.round(soloLab.leanLevel)})`);
  assert.ok(comboLab.leanLevel > 548, 'and it is still a real rise, not zeroed');
});

test('§22.10 the honesty around the AI is unchanged, and nothing else regressed', () => {
  // The AI must still raise the testosterone NUMBER — that part is measured, including in eugonadal males
  // (Mauras 2000, +58%), and the catalogue deliberately has no low-T gate on it.
  const plan = tPlan(P(), BOB_PROJ);
  const ai = plan.rows.find(r => r.id === AI);
  assert.ok(ai.t.to > ai.t.from + 150, `the AI still raises total T (${ai.t.from} → ${ai.t.to})`);
  assert.equal(ai.bodyComp, 'none', 'and is still badged as having no muscle effect');
  assert.ok(ai.net.lb < 0, 'and still nets negative, because estrogen runs fat (Finkelstein 2013)');
  assert.ok(ai.tolerability.grade === 'poor', 'and is still graded poorly tolerated');
  assert.ok(plan.rows.find(r => r.id === `clomiphene+${AI}`).warnings.some(w => /no muscle|credits NO muscle/i.test(w)),
    'the combination warns that one of its items adds testosterone without muscle');
  // A subsumed item that IS creditable, behind a driver that is not, has to say so — otherwise the row reads
  // as though the lean mass came from the drug with no body-composition evidence.
  const m = mods(P([e('clomiphene'), e(AI)]));
  const cloText = m.contributions.find(c => c.id === 'clomiphene').text;
  assert.match(cloText, /only item here with body-composition evidence/i);
  assert.match(cloText, /ALL of the modeled lean mass on this row is credited to it/);
  // Combinations of two creditable items are untouched by any of this.
  const mk = ids => ids.map(id => ({ id, name: SUPPLEMENTS[id].name, item: SUPPLEMENTS[id], model: SUPPLEMENTS[id].model, dose: null, resp: 1, ramp: 1, weeksOn: 52 }));
  const ctx = { baselineT: 548, lh: 4, bmi: 23.5, age: 39, estradiol: 25, shbg: 35 };
  const ch = combineEndogenous(mk(['clomiphene', 'hcg']), ctx);
  assert.ok(Math.abs(ch.leanLevelCap - ch.level) < 1, 'two creditable items: the cap is the level itself');
  assert.equal(ch.uncreditedIds.length, 0);
  // A SUPPRESSION is credited in full whatever the share: tLeanShare says a rise does not build muscle, never
  // that a fall does not cost it.
  const loss = combineEndogenous(mk(['endurance_load']), ctx);
  assert.ok(loss.level < 548 && Math.abs(loss.creditLevel - loss.level) < 1, 'a modeled loss is credited in full');
});

test('\u00a722.10 a FRACTIONAL tLeanShare composes proportionally (no catalogue item uses one yet)', () => {
  // `tLeanShare` is documented as a share, and only the value 0 is in the catalogue today. The composition is
  // written for the general case so that an item with, say, half its rise supported by body-composition data
  // can be added without re-deriving any of this. Pinned with a synthetic item rather than by inventing a
  // fractional share for a real drug.
  const mk = (id, over = {}) => ({ id, name: SUPPLEMENTS[id].name, item: SUPPLEMENTS[id],
    model: { ...SUPPLEMENTS[id].model, ...over }, dose: null, resp: 1, ramp: 1, weeksOn: 52 });
  const ctx = { baselineT: 548, lh: 4, bmi: 23.5, age: 39, estradiol: 25, shbg: 35 };
  const full = combineEndogenous([mk('clomiphene')], ctx);
  const half = combineEndogenous([mk('clomiphene', { tLeanShare: 0.5 })], ctx);
  const none = combineEndogenous([mk('clomiphene', { tLeanShare: 0 })], ctx);
  assert.ok(Math.abs(full.level - half.level) < 1, 'the SERUM level is unchanged by the share');
  // Half the rise is creditable, so half of it reaches the credit level.
  const rise = full.level - 548;
  assert.ok(Math.abs((half.leanLevelCap - 548) - rise * 0.5) < 2,
    `half the rise is creditable (${Math.round(half.leanLevelCap - 548)} of ${Math.round(rise)})`);
  assert.ok(half.creditLevel < full.creditLevel && half.creditLevel > 548, 'and the credit lands between');
  assert.ok(Math.abs(none.creditLevel - 548) < 1, 'a zero share credits nothing');
  assert.deepEqual(half.uncreditedIds, ['clomiphene'], 'a partial share is reported as uncredited too');
});

test('\u00a722.10 the cap works through the CAUSE chain too, and leaves Colleluori\'s exception alone', () => {
  // The lean pass runs over the cause axis as well as the LH axis, so a zero-share item cannot raise the
  // set-point the credit is computed from either. The pairing that exercises this is the one real-world case
  // where an AI is defensible: fat loss + an aromatase inhibitor in a severely obese hypogonadal man, which is
  // the arm Colleluori 2020 randomized and the one population where lowering estradiol did NOT cost fat.
  const obese = { goal: 'recomp', bodyweight: 260, body: { birthYear: 1987, heightIn: 70 }, supplements: [],
    metabolic: { sleepHours: 5, stress: 3, deficitKcal: 900, totalT: 280, lh: 3.1, labDate: '2026-07-01' } };
  const plan = tPlan(obese, { ...BOB_PROJ, bodyweightLb: 260, baseline: { weightLb: 260, bfPct: 30, date: DATE } });
  const solo = plan.rows.find(r => r.id === 'fat_loss');
  const combo = plan.rows.find(r => r.id === `fat_loss+${AI}`);
  assert.ok(solo && combo, 'both rows exist for an obese hypogonadal profile');
  // LEAN is the invariant, and it holds: the AI raises the serum number and credits nothing.
  assert.ok(combo.lean.lb <= solo.lean.lb + 0.001, `lean ${combo.lean.lb} vs ${solo.lean.lb}`);
  assert.ok(combo.lean.hi <= solo.lean.hi + 0.001, 'and the lean upside is not widened');
  assert.ok(combo.t.to > solo.t.to + 50, 'even though the combination reaches a much higher serum level');
  assert.ok(combo.t.credited <= solo.t.credited + 1, 'none of which is credited');
  // NET may be a shade better here, and that is a measured finding rather than a leak: the fat sign-reversal
  // gate (BMI ≥ 35 with a reasonable estradiol) is Colleluori 2020. The fat term is what moved, not the lean.
  assert.ok(combo.fat.lb <= solo.fat.lb + 0.001, 'and any net gain comes from the fat term, not the lean term');
  // Every range still contains its estimate across this profile too.
  for (const r of plan.rows) {
    assert.ok(r.net.lo <= r.net.lb + 1e-9 && r.net.lb <= r.net.hi + 1e-9, `${r.id} range contains its estimate`);
  }
});

test('\u00a722.10 every row\'s range contains its own estimate, at every baseline', () => {
  // The invariant that caught three separate leaks (docs \u00a715.8): freeAdj evaluated at the serum level rather
  // than the credited one; the zero floors applied BEFORE the range ends were ordered, so for a falling fat
  // value the floor overwrote the real low end (tamoxifen in an obese hypogonadal man read "fat \u22121.5 lb,
  // range \u22120.89 to 0" and headlined "+2.3 lb net, 0 to +1.9"); and a body-composition bound leaving the
  // interval not bracketing the credited mid (hCG: "fat +0.1 lb, range +0.11 to +0.15").
  const PROFILES = [
    ['no labs', 164, 9, { sleepHours: 7, stress: 3 }],
    ['low-T secondary', 164, 9, LOW],
    ['eugonadal', 164, 9, EUGONADAL],
    ['primary', 164, 9, PRIMARY],
    ['high-normal', 164, 9, { totalT: 850, lh: 4, labDate: '2026-07-01' }],
    ['obese hypogonadal', 260, 30, { sleepHours: 5, stress: 3, deficitKcal: 900, totalT: 280, lh: 3.1, labDate: '2026-07-01' }],
  ];
  let checked = 0;
  for (const [label, bw, bf, met] of PROFILES) {
    const plan = tPlan({ goal: 'recomp', bodyweight: bw, body: { birthYear: 1987, heightIn: 70 }, supplements: [], metabolic: met },
      { ...BOB_PROJ, bodyweightLb: bw, baseline: { weightLb: bw, bfPct: bf, date: DATE } });
    for (const r of plan.rows) {
      for (const [k, v] of [['lean', r.lean], ['fat', r.fat], ['net', r.net]]) {
        assert.ok(v.lo <= v.lb + 1e-9 && v.lb <= v.hi + 1e-9,
          `${label}: ${r.id} ${k} estimate ${v.lb} is outside its range [${v.lo}, ${v.hi}]`);
        checked++;
      }
    }
  }
  assert.ok(checked > 300, `checked a meaningful number of ranges (${checked})`);
});
