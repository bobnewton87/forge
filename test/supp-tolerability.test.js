// §22.8 Tolerability as a first-class catalogue property, and the enclomiphene-vs-clomiphene isomer question.
//
// Bob: "I hear enclomiphene is better tolerated and has less of the estrogen effects. Study that, implement it."
// Every number asserted here is traceable to docs/research/endogenous-testosterone.md §12.
//
// The point of this file is that "better tolerated" must be a cited rate with a denominator and a named
// comparator, or it must be graded 'unknown'. It must never be a vibe. Most of what is tested below is that
// Forge refuses to claim more than the studies support — including, pointedly, that enclomiphene does NOT lower
// serum estradiol even though that is the half of Bob's claim everyone repeats.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPLEMENTS, TOLERABILITY, tolerabilityOf, worstTolerability, fmtRate,
} from '../js/data/supplements.js';
import { modifiersAt } from '../js/engine/metabolic.js';
import { tPlan } from '../js/engine/tplan.js';

const DATE = '2026-10-20';
const START = '2026-07-28';
const P = (supplements = [], metabolic = {}, extra = {}) => ({
  goal: 'recomp', bodyweight: 164, body: { birthYear: 1987, heightIn: 70 }, supplements,
  metabolic: { sleepHours: 7, stress: 3, ...metabolic }, ...extra,
});
const e = (id, dose = null) => ({ id, start: START, end: null, dose, active: true });
const mods = p => modifiersAt(p, DATE, { age: 39 });
const LOW = { totalT: 300, labDate: '2026-07-01', lh: 3.2 };
const EUGONADAL = { totalT: 550, labDate: '2026-07-01', lh: 4 };
const GRADED = ['clomiphene', 'enclomiphene', 'hcg', 'aromatase_inhibitor', 'tamoxifen', 'cabergoline'];

// ====================================================================== 1. the schema itself
test('§22.8: every graded item carries a comparator, a denominator for each rate, and its sources', () => {
  for (const id of GRADED) {
    const t = tolerabilityOf(id);
    assert.ok(t, `${id} must carry a tolerability block`);
    assert.ok(TOLERABILITY[t.grade], `${id} grade "${t.grade}" must be one of the four`);
    // A grade with no comparator is meaningless — "well tolerated" compared with WHAT?
    assert.ok(typeof t.comparedWith === 'string' && t.comparedWith.length > 20, `${id} must say what it was graded against`);
    assert.ok(['rct', 'observational', 'none'].includes(t.evidence), `${id} evidence kind`);
    assert.ok(typeof t.note === 'string' && t.note.length > 60, `${id} must carry the caveats that decide what the numbers are worth`);
    assert.ok(Array.isArray(t.events) && t.events.length >= 2, `${id} needs itemised events`);
    for (const ev of t.events) {
      assert.ok(typeof ev.label === 'string' && ev.label, `${id} event needs a label`);
      // THE rule this field exists for: no percentage without the fraction it came from. "3%" hides that it is
      // 2 men out of 66. A row may instead be narrative (pct null), but it may never be a bare percentage.
      if (typeof ev.pct === 'number') {
        assert.equal(typeof ev.n, 'number', `${id}/${ev.label}: a percentage needs its numerator`);
        assert.equal(typeof ev.of, 'number', `${id}/${ev.label}: a percentage needs its denominator`);
        assert.ok(ev.of > 0 && ev.n <= ev.of, `${id}/${ev.label}: ${ev.n} of ${ev.of} is not a rate`);
        assert.ok(Math.abs(ev.pct - (ev.n / ev.of) * 100) < 1.2, `${id}/${ev.label}: ${ev.pct}% does not match ${ev.n}/${ev.of}`);
      } else {
        assert.ok(typeof ev.arm === 'string' && ev.arm.length > 3, `${id}/${ev.label}: a narrative row must say what was observed`);
      }
      if (ev.vs) {
        assert.ok(typeof ev.vs.label === 'string' && ev.vs.label, `${id}/${ev.label}: a comparison needs the other arm named`);
        if (typeof ev.vs.pct === 'number') assert.equal(typeof ev.vs.of, 'number', `${id}/${ev.label}: comparator needs a denominator`);
      }
    }
    if (t.discontinuation) {
      const d = t.discontinuation;
      assert.equal(typeof d.of, 'number', `${id} discontinuation needs a denominator`);
      assert.ok(typeof d.source === 'string' && d.source, `${id} discontinuation needs a source`);
    }
    assert.ok(Array.isArray(t.sources) && t.sources.length >= 1, `${id} tolerability needs its own citations`);
    assert.ok(t.sources.every(s => /\d{4}/.test(s)), `${id} tolerability sources must be dated`);
  }
});

test('§22.8: a percentage is never printed without its fraction', () => {
  assert.equal(fmtRate({ pct: 13.8, n: 8, of: 58 }), '13.8% (8 of 58)');
  assert.equal(fmtRate({ pct: 47, n: 31, of: 66 }), '47% (31 of 66)');
  assert.equal(fmtRate(null), '');
  assert.equal(fmtRate({ arm: 'narrative only' }), '');       // no number to overstate
});

test('§22.8: a combination is only as tolerable as its least tolerable part', () => {
  const grade = ids => worstTolerability(ids.map(i => SUPPLEMENTS[i])).grade;
  assert.equal(grade(['enclomiphene']), 'good');
  assert.equal(grade(['enclomiphene', 'aromatase_inhibitor']), 'poor');   // the AI drags it down
  assert.equal(grade(['enclomiphene', 'clomiphene']), 'moderate');
  // Ungraded items (sleep, food, herbs) contribute nothing rather than defaulting to good.
  assert.equal(worstTolerability([SUPPLEMENTS.sleep_hygiene, SUPPLEMENTS.ashwagandha]), null);
  // An 'unknown' never outranks a measured grade, but is better than returning nothing at all.
  assert.equal(grade(['tamoxifen']), 'unknown');
  assert.equal(grade(['tamoxifen', 'clomiphene']), 'moderate');
  assert.equal(worstTolerability([]), null);
  assert.equal(worstTolerability(null), null);
});

// ====================================================================== 2. Bob's claim, part 1: tolerability
test('§22.8: "better tolerated" is supported, and the supporting numbers are the ones in Saffati 2024', () => {
  const enc = tolerabilityOf('enclomiphene'), clo = tolerabilityOf('clomiphene');
  assert.equal(enc.grade, 'good');
  assert.equal(clo.grade, 'moderate');
  assert.ok(TOLERABILITY[enc.grade].rank > TOLERABILITY[clo.grade].rank, 'enclomiphene outranks clomiphene on tolerability');
  // The headline comparison, in both entries, with the same denominators.
  const any = enc.events.find(x => /vs clomiphene/.test(x.label));
  assert.deepEqual([any.pct, any.n, any.of], [13.8, 8, 58]);
  assert.deepEqual([any.vs.pct, any.vs.n, any.vs.of], [47, 31, 66]);
  assert.match(any.p, /0\.001/);
  assert.match(any.p, /0\.18/);                                  // the odds ratio
  const cloSide = clo.events.find(x => /vs enclomiphene/.test(x.label));
  assert.deepEqual([cloSide.pct, cloSide.n, cloSide.of], [47, 31, 66]);
  // Libido is the single biggest contributor, and it is significant.
  const lib = enc.events.find(x => /libido/i.test(x.label));
  assert.deepEqual([lib.pct, lib.vs.pct], [8.6, 33.3]);
  // Both entries must disclose that this is ONE retrospective, unblinded, no-washout study.
  for (const t of [enc, clo]) {
    assert.match(t.note, /retrospective/i, 'the design must travel with the number');
  }
  assert.match(enc.note, /washout/i, 'no washout between the two drugs is the key confound');
  assert.match(enc.note, /unblinded/i);
  assert.match(enc.note, /never been a randomi[sz]ed trial of enclomiphene against clomiphene/i);
  // The randomized evidence says "no worse than placebo", which is a different and weaker claim.
  assert.ok(enc.events.some(x => /21/.test(String(x.pct)) && /no significant difference/i.test(String(x.p))),
    'the 21% phase-3 figure must be labelled as all arms pooled with no between-group difference');
  const phase3 = enc.events.find(x => x.pct === 21);
  assert.equal(phase3.of, 256);
  assert.match(phase3.arm, /all arms pooled/i,
    'CORRECTED: the old entry read 21% as an enclomiphene rate; it is the rate across enclomiphene, gel AND placebo');
});

test('§22.8: the differences that were NOT significant are reported as not significant', () => {
  const enc = tolerabilityOf('enclomiphene');
  for (const label of [/erectile/i, /gynecomastia/i]) {
    const ev = enc.events.find(x => label.test(x.label));
    assert.ok(ev, 'expected an event matching ' + label);
    assert.match(String(ev.p), /not significant/i, `${ev.label} must not be sold as a win`);
  }
  // Hematocrit: no difference, and said so.
  const hct = enc.events.find(x => /hematocrit/i.test(x.label));
  assert.match(String(hct.p), /0\.85|no difference/i);
});

test('§22.8: the one finding that runs AGAINST enclomiphene is in its own entry', () => {
  const enc = tolerabilityOf('enclomiphene');
  const igf = enc.events.find(x => /IGF-1/.test(x.label));
  assert.ok(igf, 'the IGF-1 fall must be reported, not buried');
  assert.match(igf.arm, /FELL/);
  assert.match(String(igf.p), /against enclomiphene/i);
  // And in the risks list, where a reader looking for reasons not to will find it.
  assert.ok(SUPPLEMENTS.enclomiphene.risks.some(r => /IGF-1/.test(r)));
});

test('§22.8: the aromatase inhibitor is the one graded poor, on a measured structural harm', () => {
  const ai = tolerabilityOf('aromatase_inhibitor');
  assert.equal(ai.grade, 'poor');
  assert.ok(ai.events.some(x => /bone mineral density/i.test(x.label) && /FELL/.test(x.arm)));
  // Not graded poor because men complained — they did not. That distinction is the point.
  const sym = ai.events.find(x => /symptom score/i.test(x.label));
  assert.match(String(sym.p), /0\.634|no difference/i);
});

test('§22.8: where nobody measured it, the grade is "unknown" rather than a flattering guess', () => {
  const tam = tolerabilityOf('tamoxifen');
  assert.equal(tam.grade, 'unknown');
  assert.equal(tam.evidence, 'none');
  assert.equal(tam.discontinuation, null);
  assert.match(tam.note, /silence as safety/i, 'the reasoning must be stated, not just the grade');
  assert.ok(tam.events.some(x => /thromboembolism/i.test(x.label)), 'the known VTE risk is still listed');
  // hCG likewise has no AE table; it is graded on what the trials DID measure.
  const hcg = tolerabilityOf('hcg');
  assert.equal(hcg.discontinuation, null);
  assert.match(hcg.headline, /No adverse-event table/i);
  assert.ok(hcg.events.some(x => /testis volume/i.test(x.label)));
});

// ====================================================================== 3. Bob's claim, part 2: estrogen
test('§22.8: "less estrogen" is split into serum estradiol (NOT supported) and estrogen effects (supported)', () => {
  // CORRECTED 2026-10-20. e2Pct used to be 45 against clomiphene's 90, i.e. "estradiol rises half as much
  // because the estrogenic isomer is gone". The data say otherwise: serum E2 rises because a SERM raises
  // testosterone, which is the substrate aromatase works on, and removing zuclomiphene does nothing to
  // aromatase. Thomas 2023 measured 29.5 -> 67 pg/mL on enclomiphene (p=0.003) against 31 -> 37.6 on
  // clomiphene (p=0.074) — if anything the wrong way round.
  assert.equal(SUPPLEMENTS.enclomiphene.model.e2Pct, 85);
  assert.equal(SUPPLEMENTS.clomiphene.model.e2Pct, 90);
  const enc = mods(P([e('enclomiphene')], LOW)).testosterone;
  const clo = mods(P([e('clomiphene')], LOW)).testosterone;
  assert.ok(enc.estradiol > enc.estradiolBase * 1.5, 'enclomiphene must RAISE modeled estradiol substantially');
  assert.ok(Math.abs(enc.estradiol - clo.estradiol) / clo.estradiol < 0.15,
    `the two SERMs must now be within 15% on serum estradiol (${enc.estradiol} vs ${clo.estradiol})`);
  // And the entry must say so in words, because the number alone will be read the other way.
  assert.match(SUPPLEMENTS.enclomiphene.model.e2Note, /goes UP/);
  assert.ok(SUPPLEMENTS.enclomiphene.effects.some(x => /SERUM ESTRADIOL STILL RISES/.test(x)));
  assert.ok(SUPPLEMENTS.enclomiphene.risks.some(x => /estradiol goes UP/i.test(x)));
  // Neither SERM may ever feed the Finkelstein fat term: that term is driven by estrogen ACTION being BLOCKED,
  // and a SERM raises the hormone while blocking the receptor only in some tissues. (Both SERMs do still move
  // fat a little, but through the testosterone→body-composition curve, which is a different mechanism.)
  assert.ok(SUPPLEMENTS.enclomiphene.model.e2ActionNote.length > 80);
  assert.equal(enc.e2ActionDrop, 0, 'a SERM must never register a loss of estrogen action');
  assert.equal(clo.e2ActionDrop, 0);
  const ai = mods(P([e('aromatase_inhibitor')], LOW)).testosterone;
  assert.ok(ai.e2ActionDrop > 0, 'only an aromatase inhibitor blocks estrogen action');
  assert.ok(ai.estradiol < ai.estradiolBase, 'and only it lowers serum estradiol');
});

test('§22.8: the isomer pharmacology is in the catalogue with its numbers', () => {
  const m = SUPPLEMENTS.enclomiphene.mechanism;
  assert.match(m, /62%/);                 // trans-enclomiphene share of clomiphene citrate
  assert.match(m, /38%/);                 // cis-zuclomiphene share
  assert.match(m, /30 days/);             // zuclomiphene half-life
  assert.match(m, /10 h/);                // enclomiphene half-life
  assert.match(m, /20:1/);                // Helo 2017 steady-state serum ratio
  assert.match(m, /44\.0 ng\/mL/);        // and the measured concentrations behind it
  assert.match(m, /2\.2 ng\/mL/);
  assert.ok(SUPPLEMENTS.enclomiphene.sources.some(s => /Helo/.test(s) && /10\.1111\/bju\.13625/.test(s)));
});

// ====================================================================== 4. the A15 correction
test('§22.7/A15 corrected: the eugonadal arm is enclomiphene\'s OWN measured size with clomiphene\'s shape', () => {
  // The hypogonadal arm is a measurement of THIS drug: Tienforti 2023, +7.50 nmol/L = +216 ng/dL (188-245).
  const enc = mods(P([e('enclomiphene')], LOW)).testosterone;
  const rise = enc.level - enc.natural;
  assert.ok(rise > 188 && rise < 245, `enclomiphene +${rise} must sit inside Tienforti's measured CI`);
  // The old comment claimed the whole arm was "clomiphene scaled by 216/274". That was circular, because
  // Hohl's 274 pools clomiphene AND enclomiphene trials together. The catalogue must now say so, in both
  // entries, so nobody re-derives the same mistake.
  const src = SUPPLEMENTS.clomiphene.sources.find(s => /Hohl/.test(s));
  assert.match(src, /pools clomiphene and enclomiphene together/i);
  assert.ok(SUPPLEMENTS.clomiphene.effects.some(x => /class estimate, not a clomiphene-specific one/i.test(x)));
  // The isomer-matched comparison that is NOT circular, and the two head-to-heads that disagree with it.
  assert.ok(SUPPLEMENTS.enclomiphene.effects.some(x => /\+333/.test(x) && /0\.65/.test(x)), 'Tienforti clomiphene vs enclomiphene');
  assert.ok(SUPPLEMENTS.enclomiphene.effects.some(x => /Thomas 2023/.test(x) && /Saffati 2024/.test(x) && /p=0\.491/.test(x)),
    'both direct head-to-heads, with their p-values');
  // That unresolved disagreement is carried in the CI, not hidden in the point estimate.
  const ci = SUPPLEMENTS.enclomiphene.model.tCI;
  assert.deepEqual(ci, [0.80, 1.45]);
  assert.ok(ci[1] > 1.3, 'the high end must allow enclomiphene to equal clomiphene, which is what Saffati found');
  assert.ok(ci[0] < 0.85, 'the low end must carry Tienforti\'s 0.65 reading');
});

test('§22.8: the dose ladder is a real dose-response, and it is still not a dosing instruction', () => {
  // Wiehle 2013 is the only dose-ranging trial in men. Measured as a rise over each arm's own baseline, the
  // two lower arms are indistinguishable at ~43% of the top arm and the step up is at the top dose.
  const m = SUPPLEMENTS.enclomiphene.model;
  assert.deepEqual(m.response, [[0, 0], [25, 0.43], [50, 0.43], [100, 1]]);
  // Still expressed as a share of the studied regimen, never in mg: no self-administrable number in the model.
  assert.match(m.dose.unit, /%/);
  const full = mods(P([e('enclomiphene')], LOW)).testosterone;
  const low = mods(P([e('enclomiphene', { value: 25, unit: '% of the studied regimen' })], LOW)).testosterone;
  const mid = mods(P([e('enclomiphene', { value: 50, unit: '% of the studied regimen' })], LOW)).testosterone;
  assert.ok(low.level < full.level, 'the low arm must do less than the full regimen');
  assert.equal(Math.round(low.level), Math.round(mid.level), 'the two lower arms were not different from each other');
  const ratio = (low.level - low.natural) / (full.level - full.natural);
  assert.ok(Math.abs(ratio - 0.43) < 0.03, `low arm is ${Math.round(ratio * 100)}% of full, expected ≈43%`);
  // The mg numbers live in the prose, as trial findings.
  assert.ok(SUPPLEMENTS.enclomiphene.effects.some(x => /6\.25 mg/.test(x) && /604 ± 160/.test(x)));
});

test('§22.8: the ceiling and bcMaxLevel are re-derived and each says which measurement it is', () => {
  const m = SUPPLEMENTS.enclomiphene.model;
  // 764 = Wiehle 2013's 25 mg day-42 24-h Cmax: the highest group mean by ANY measure. Kept deliberately,
  // because the morning-comparable 604 is the highest level seen in obese HYPOGONADAL men at the only dose
  // anyone pushed to — not a probe of the drug's ceiling, which nobody has run in a eugonadal man.
  assert.equal(m.ceilingNg, 764);
  assert.equal(m.maxLevel, 764);
  // 604 = the highest MORNING group mean, and a hard bound on muscle credit. For enclomiphene these two bounds
  // are the same KIND of thing for a different reason than for clomiphene: there is no body-composition trial
  // at all, so the muscle bound is simply "the highest level this drug has been shown to produce".
  assert.equal(m.bcMaxLevel, 604);
  assert.equal(m.bodyComp, 'extrapolated');
  assert.match(m.bcNote, /604/);
  assert.match(m.bcNote, /has ever measured body composition/i);
  assert.match(m.bcNote, /highest morning group mean/i);
  // The ceiling still binds: a eugonadal man cannot be modeled past it.
  const hi = mods(P([e('enclomiphene')], { totalT: 650, labDate: '2026-07-01', lh: 3 })).testosterone;
  assert.ok(hi.level <= 764 + 0.5, `capped at 764, got ${hi.level}`);
});

// ====================================================================== 5. the planner surfaces it
test('§22.8: the planner carries tolerability on the row, with its comparator', () => {
  const plan = tPlan(P([], EUGONADAL), { now: DATE, age: 39, bodyweightLb: 164 });
  const enc = plan.rows.find(r => r.id === 'enclomiphene');
  const clo = plan.rows.find(r => r.id === 'clomiphene');
  for (const r of [enc, clo]) {
    assert.ok(r.tolerability, `${r.id} row must carry tolerability`);
    assert.ok(r.tolerability.short && r.tolerability.label && r.tolerability.explain);
    assert.ok(r.tolerability.comparedWith, `${r.id} row must carry what it was graded against`);
    assert.ok(r.tolerability.events.length >= 2);
  }
  assert.equal(enc.tolerability.grade, 'good');
  assert.equal(clo.tolerability.grade, 'moderate');
  // Rows with nothing measured carry no grade rather than an invented one.
  assert.equal(plan.rows.find(r => r.id === 'sleep_hygiene').tolerability, null);
  assert.equal(plan.rows.find(r => r.id === 'ashwagandha').tolerability, null);
  // A combination takes the worst grade of its parts and names which parts were graded.
  const combo = plan.rows.find(r => r.id === 'clomiphene+aromatase_inhibitor');
  assert.ok(combo, 'the SERM + AI combination is listed');
  assert.equal(combo.tolerability.grade, 'poor');
  assert.ok(combo.tolerability.from.length >= 2, 'a combination says which of its items carry data');
});

test('§22.8: tolerability breaks ties but never outranks measured body composition', () => {
  const plan = tPlan(P([], EUGONADAL), { now: DATE, age: 39, bodyweightLb: 164 });
  const idx = id => plan.rows.findIndex(r => r.id === id);
  // Bob's actual question. At a normal baseline these two score identically (zero, both extrapolated) on the
  // same evidence grade, so before §22.8 the order was alphabetical. Now the better-tolerated one leads.
  assert.equal(plan.rows[idx('enclomiphene')].score, plan.rows[idx('clomiphene')].score);
  assert.equal(plan.rows[idx('enclomiphene')].evidence, plan.rows[idx('clomiphene')].evidence);
  assert.ok(idx('enclomiphene') < idx('clomiphene'), 'the better-tolerated of two tied rows goes first');
  // But it is only a TIEBREAK: the AI is graded poor and still has to lose on score, not on grade, and a row
  // with a real measured lean effect must still beat a well-tolerated one with none.
  const ai = plan.rows[idx('aromatase_inhibitor')];
  assert.ok(ai.score < plan.rows[idx('enclomiphene')].score, 'ranking is still lean − fat first');
  const sorted = [...plan.rows].sort((a, b) => b.score - a.score);
  assert.equal(sorted[0].score, plan.rows[0].score, 'the top row is still the top-scoring row');
});

test('§22.8: nothing changed for a man with none of these in his stack', () => {
  const before = mods(P([], LOW));
  assert.equal(before.leanDirectLbPerWeek, 0);
  assert.equal(before.contributions.filter(c => GRADED.includes(c.id)).length, 0);
  // And the new field never leaks into the modifier output, which ENGINE-NUTRI consumes.
  assert.equal('tolerability' in before, false);
});
