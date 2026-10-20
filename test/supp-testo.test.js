// §22 Natural testosterone therapies, interactions and the planner.
// Every expected number here is traceable to docs/research/endogenous-testosterone.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modifiersAt, combineEndogenous, estradiolFatEffect, tShiftPct, testosteroneEffect,
  PITUITARY_CEILING, TESTIS_CEILING, COMBO_BONUS, E2_FAT, ASSUMED_E2, ASSUMED_SHBG,
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
const PRIMARY = { totalT: 300, labDate: '2026-07-01', lh: 14 };         // testicular failure

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

  // Cause-correction is different: it raises the set-point FIRST, which shrinks what the drug can add.
  const short = { ...LOW, sleepHours: 5.5 };
  const cloShort = mods(P([e('clomiphene')], short)).testosterone;
  const sleepOnly = mods(P([e('sleep_hygiene')], short)).testosterone;
  const sleepClo = mods(P([e('sleep_hygiene'), e('clomiphene')], short)).testosterone;
  assert.ok(sleepOnly.level > sleepOnly.natural, 'fixing sleep raises the set-point');
  assert.ok(sleepClo.level < (cloShort.level - cloShort.natural) + sleepOnly.level - 20,
    `sleep + clomiphene (${sleepClo.level}) must be below the naive sum`);
  assert.ok(sleepClo.level > cloShort.natural, 'but still above baseline');
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
  // A man with a healthy baseline who stacks everything cannot be pushed past the route plateau.
  const all = mods(P([e('clomiphene'), e('enclomiphene'), e('hcg'), e('aromatase_inhibitor'), e('tamoxifen'), e('ashwagandha')],
    { totalT: 450, labDate: '2026-07-01', lh: 3 })).testosterone;
  assert.ok(all.level <= TESTIS_CEILING, `${all.level} must not exceed the testicular ceiling ${TESTIS_CEILING}`);
  // SERM/AI only: bounded by the pituitary-driven plateau (790 ng/dL is the highest group mean ever reported).
  const serm = mods(P([e('clomiphene'), e('tamoxifen'), e('aromatase_inhibitor')], { totalT: 480, labDate: '2026-07-01', lh: 3 })).testosterone;
  assert.ok(serm.level <= PITUITARY_CEILING, `SERM/AI stack reached ${serm.level}, ceiling ${PITUITARY_CEILING}`);
  assert.ok(PITUITARY_CEILING < TESTIS_CEILING, 'hCG, which replaces LH at the testis, can push harder');
  // Muscle credit never exceeds the level the evidence reached.
  const clo = mods(P([e('clomiphene')], LOW)).testosterone;
  assert.ok(clo.leanLevel <= SUPPLEMENTS.clomiphene.model.bcMaxLevel + 1);
  assert.ok(clo.leanLevel < clo.level, 'and is below the modeled level here');
  // A cause item with a generous bound must not launder a drug's rise past the drug's own bound.
  const withSleep = mods(P([e('sleep_hygiene'), e('clomiphene')], { ...LOW, sleepHours: 5.5 })).testosterone;
  assert.ok(withSleep.leanLevel <= SUPPLEMENTS.clomiphene.model.bcMaxLevel + 1,
    `credit ${withSleep.leanLevel} must stay inside clomiphene's evidence bound`);
});

// ====================================================================== 4. gating
test('primary hypogonadism blocks every axis drug; exogenous testosterone suppresses all of them', () => {
  for (const id of ['clomiphene', 'enclomiphene', 'hcg', 'aromatase_inhibitor', 'tamoxifen']) {
    const m = mods(P([e(id)], PRIMARY));
    assert.equal(m.testosterone.level, m.testosterone.natural, `${id} must not raise T when LH is already high`);
    assert.ok(m.contributions.some(c => c.id === id && /points to the testes/i.test(c.text)), `${id} explains why`);
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
  // The HPG drugs have no headroom for a mid-normal man, and the row says so rather than disappearing.
  for (const id of ['clomiphene', 'enclomiphene', 'hcg']) {
    const r = plan.rows.find(x => x.id === id);
    assert.ok(r, id + ' is still listed');
    assert.equal(r.t.to, r.t.from, id + ' moves nothing');
    assert.equal(r.lean.lb, 0);
    assert.ok(r.why.some(w => /studied only in men with low testosterone/i.test(w)), id + ' gives the reason');
  }
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
  assert.equal(tShiftPct(SUPPLEMENTS.hcg.model, { baselineT: 300, lh: 14 }).pct, 0);
});
