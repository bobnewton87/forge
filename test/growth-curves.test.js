// Response-curve audit (2026-10-21). Each test pins a curve to the published finding it came from, so a
// future edit that drifts away from the literature fails here rather than silently changing the product.
// Sources and uncertainties: docs/research/growth-model.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { project, nutritionLab, setResponse, maintenanceProtection, leanRatePctPerMonth, ceilingFactor,
  energyFactor, proteinFactor, proteinRetentionFactor, interferenceFactor, adaptation, lossRateFactor,
  FFMI_NATURAL_CEILING } from '../js/engine/projection.js';
import { NOW, TODAY, bobPlan, bobProfile, bobBodyLog, bobMeas } from './body-fixtures.js';
import { baseline } from '../js/engine/bodycomp.js';

const bobBase = (bf = 23) => {
  const b = baseline({ profile: bobProfile(), bodyLog: bobBodyLog(), measurements: bobMeas(), now: NOW });
  b.bodyFatPct = bf; b.weightLb = 164; b.heightIn = 69; b.age = 39;
  return b;
};

test('setResponse follows Pelland 2025: square root, monotone, no inverted-U, bounded', () => {
  // Best-fit model for weekly FRACTIONAL set volume → hypertrophy was the SQUARE ROOT model
  // (doi:10.1007/s40279-025-02344-w): marginal slope +0.24 %/set at the mean of 12.25 sets, 100 %
  // posterior probability of a positive slope, "diminishing returns but not an inverted-U".
  assert.equal(setResponse(0), 0);
  assert.equal(setResponse(-5), 0);
  assert.equal(setResponse(10), 1);
  for (const s of [0.5, 1, 2, 4, 8, 12, 16, 20]) assert.ok(Math.abs(setResponse(s) - Math.sqrt(s / 10)) < 1e-9, `√ at ${s} sets`);
  // Never declines, anywhere, ever (an inverted-U is NOT supported).
  let prev = -1;
  for (let s = 0; s <= 400; s += 0.25) { const v = setResponse(s); assert.ok(v >= prev, `declined at ${s}`); prev = v; }
  // Bounded: past the volumes Pelland's efficiency tiers call "unclear" (43+ sets) it flattens.
  assert.ok(setResponse(1e6) < 2.5 && setResponse(1e6) > 2.4);
  // Diminishing returns in the right direction: each extra set buys less than the one before.
  for (const s of [2, 5, 10, 20, 40]) assert.ok(setResponse(s + 1) - setResponse(s) < setResponse(s) - setResponse(s - 1), `at ${s}`);
  // The efficiency tiers imply the marginal set at 5-10 is worth clearly more than at 30-42.
  const marg = s => setResponse(s + 1) - setResponse(s);
  assert.ok(marg(7) > 3 * marg(36), `${marg(7)} vs ${marg(36)}`);
  // Minimum effective dose = 4 fractional sets: must already be a substantial fraction of the 10-set dose.
  assert.ok(setResponse(4) > 0.55 && setResponse(4) < 0.7, String(setResponse(4)));
});

test('maintenance protection saturates where growth is still climbing', () => {
  // Bickel 2011 (doi:10.1249/MSS.0b013e318207c15d): young adults kept all their hypertrophy for 32 weeks
  // on 1/9 of the dose that built it. Spiering 2021 (doi:10.1519/JSC.0000000000003964): 1 session/week,
  // 1 set/exercise holds muscle size for up to 32 weeks.
  assert.equal(maintenanceProtection(0), 0);
  assert.equal(maintenanceProtection(-1), 0);
  for (let s = 0; s < 40; s += 0.25) assert.ok(maintenanceProtection(s + 0.25) >= maintenanceProtection(s));
  assert.ok(maintenanceProtection(1e6) <= 1 && maintenanceProtection(1e6) > 0.999);
  // The ratio that encodes "maintenance ≪ growth": at 1/9 of a 12-set dose (≈1.3 sets) protection is
  // already most of the way up, while growth is barely a third of the way.
  const ninth = 12 / 9;
  assert.ok(maintenanceProtection(ninth) > 0.6, String(maintenanceProtection(ninth)));
  assert.ok(setResponse(ninth) / setResponse(12) < 0.4, String(setResponse(ninth) / setResponse(12)));
});

test('leanRatePctPerMonth is a monotone CEILING and its realised output is literature-plausible', () => {
  for (let m = 0; m < 300; m += 0.5) assert.ok(leanRatePctPerMonth(m + 0.5) < leanRatePctPerMonth(m), `at ${m} mo`);
  assert.ok(leanRatePctPerMonth(0) > 1.2 && leanRatePctPerMonth(0) < 1.6);     // Aragon/McDonald year-1 top end
  assert.ok(leanRatePctPerMonth(1e6) >= 0 && leanRatePctPerMonth(1e6) < 1e-6);  // decays to nothing, never negative
  assert.ok(leanRatePctPerMonth(-5) === leanRatePctPerMonth(0));                 // guards bad input
  // The table is a coaching heuristic (Aragon / McDonald), NOT a fitted curve — the weakest constant in
  // the model. What can be checked is that the REALISED rate (ceiling × every other factor) lands where
  // trials land: 6-12 week resistance-training studies gain of order 1-2 kg of lean in novices, i.e.
  // roughly 0.5-1 % of bodyweight per month, and far less once trained.
  const atAge = months => {
    const p0 = bobProfile();
    const prof = bobProfile({ goal: 'lean_bulk', body: { ...p0.body, trainingMonths: months } });
    return project({ baseline: bobBase(), profile: prof, sessions: bobPlan(TODAY, 4), weeks: 13, now: NOW,
      intake: { surplus: 250, proteinGPerLb: 1.0 }, adherence: 1 });
  };
  const novice = atAge(0), vet = atAge(60);
  const perMonth = r => 100 * r.summary.leanLb / 164 / 3;
  assert.ok(perMonth(novice) > 0.45 && perMonth(novice) < 1.2,
    `novice realised ${perMonth(novice).toFixed(2)} %BW/month (${novice.summary.leanLb} lb in 13 wk)`);
  assert.ok(perMonth(vet) < perMonth(novice) / 2.5,
    `5 years in must be far slower (${perMonth(vet).toFixed(2)} vs ${perMonth(novice).toFixed(2)} %BW/month)`);
  assert.ok(perMonth(vet) > 0, 'but not zero');
  // The ceiling must sit above the realised number — a ceiling, not a prediction.
  for (const r of [novice, vet]) assert.ok(r.partition.leanCeilingLb > r.summary.leanLb * 1.05,
    `ceiling ${r.partition.leanCeilingLb} vs realised ${r.summary.leanLb}`);
});

test('ceilingFactor approaches the limit asymptotically and never crosses it', () => {
  assert.equal(ceilingFactor(0), 0);
  assert.equal(ceilingFactor(-1), 0);
  assert.equal(ceilingFactor(4), 1);
  assert.equal(ceilingFactor(40), 1);
  for (let g = 0; g < 6; g += 0.05) assert.ok(ceilingFactor(g + 0.05) >= ceilingFactor(g));
  // zero slope where it joins 1 (no kink), and it is the LAST 4 FFMI points that slow down
  assert.ok(1 - ceilingFactor(3.9) < 0.01);
  assert.ok(ceilingFactor(2) > 0.7 && ceilingFactor(2) < 0.8);
  assert.ok(ceilingFactor(0.5) < 0.3);
});

test('energyFactor reproduces Garthe 2013: more surplus buys fat, not lean', () => {
  // Garthe 2013 (doi:10.1080/17461391.2011.643923): elite athletes, +620 kcal/day between arms, both
  // lifting 4x/week. Fat mass +15 % vs +3 %; "gain in LBM was not different between groups".
  assert.ok(energyFactor(250) > 0.9, String(energyFactor(250)));
  assert.ok(energyFactor(870) - energyFactor(250) < 0.09, `+620 kcal must buy almost no extra lean (${energyFactor(870) - energyFactor(250)})`);
  assert.ok(energyFactor(1500) - energyFactor(500) < 0.03);
  // Now the same claim end to end, in pounds: the extra food must land in fat.
  const prof = bobProfile({ goal: 'lean_bulk' });
  const sess = bobPlan(TODAY, 4);
  const lo = project({ baseline: bobBase(), profile: prof, sessions: sess, weeks: 12, now: NOW, intake: { surplus: 250, proteinGPerLb: 1.0 }, adherence: 1 });
  const hi = project({ baseline: bobBase(), profile: prof, sessions: sess, weeks: 12, now: NOW, intake: { surplus: 870, proteinGPerLb: 1.0 }, adherence: 1 });
  const dLean = hi.summary.leanLb - lo.summary.leanLb, dFat = hi.summary.fatLb - lo.summary.fatLb;
  assert.ok(dFat > 4 * Math.max(0.05, dLean), `+620 kcal/day: +${dFat} lb fat vs +${dLean} lb lean`);
  // monotone, bounded, continuous through zero
  for (let b = -2000; b < 2000; b += 25) assert.ok(energyFactor(b + 25) > energyFactor(b), `at ${b}`);
  assert.ok(energyFactor(-1000) < 0.2 && energyFactor(1e5) <= 1);
  assert.ok(Math.abs(energyFactor(0) - 0.7) < 1e-9);
});

test('protein: growth plateaus at Morton 2018, retention plateaus later (deficit-specific)', () => {
  // Morton 2018 break point 1.62 g/kg = 0.74 g/lb (95 % CI 1.03-2.20 g/kg = 0.47-1.00 g/lb).
  assert.ok(proteinFactor(0.74) > 0.9, `at the break point (${proteinFactor(0.74)})`);
  assert.equal(proteinFactor(1.0), 1);
  assert.equal(proteinFactor(3), 1);                                   // no reward above the upper CI
  for (let g = 0; g < 1.2; g += 0.05) assert.ok(proteinFactor(g + 0.05) >= proteinFactor(g));
  // The two curves answer different questions and must not be interchangeable: sparing muscle in a
  // deficit needs MORE protein than growing it in a surplus (Mettler 2010, Longland 2016, Helms 2014).
  for (const g of [0.5, 0.6, 0.7, 0.8, 0.9]) assert.ok(proteinRetentionFactor(g) < proteinFactor(g), `at ${g} g/lb`);
  assert.ok(proteinRetentionFactor(1.0) < 1 && proteinRetentionFactor(1.1) >= 1 - 1e-9);
  for (let g = 0; g < 1.3; g += 0.05) assert.ok(proteinRetentionFactor(g + 0.05) >= proteinRetentionFactor(g));
});

test('cardio interference is small and only appears at endurance-athlete volumes (Schumann 2022)', () => {
  // Schumann 2022 (doi:10.1007/s40279-021-01587-7, 43 trials): hypertrophy SMD −0.01 (95 % CI −0.16 to
  // 0.18) for concurrent vs resistance-only, no cycling-vs-running moderation. Those trials sit at roughly
  // 40-150 aerobic min/week, so the model must be exactly neutral there.
  for (const m of [0, 40, 90, 150, 200, 250]) assert.equal(interferenceFactor(m), 1, `${m} min must be free`);
  assert.ok(interferenceFactor(450) > 0.94);
  assert.ok(interferenceFactor(1e6) >= 0.88 - 1e-9, 'capped at 12 %');
  for (let m = 0; m < 2000; m += 25) assert.ok(interferenceFactor(m + 25) <= interferenceFactor(m) + 1e-12);
  // End to end: a lot of easy cycling must cost Bob's lean gain only a little, because the calories it
  // burns are already modelled and must not be double-counted as interference.
  const prof = bobProfile({ goal: 'lean_bulk' });
  const sess = bobPlan(TODAY, 4);
  const a = project({ baseline: bobBase(), profile: prof, sessions: sess, weeks: 13, now: NOW, intake: { surplus: 300, proteinGPerLb: 1.0 }, adherence: 1 });
  const b = project({ baseline: bobBase(), profile: prof, sessions: sess, weeks: 13, now: NOW, intake: { surplus: 300, proteinGPerLb: 1.0 }, adherence: 1,
    cardioDeltaMin: 200, cardioModality: 'bike', cardioIntensity: 'easy' });
  assert.ok(b.partition.interferenceFactor <= a.partition.interferenceFactor);
  assert.ok(b.partition.interferenceFactor > 0.9, `${b.partition.interferenceFactor}`);
  // Running still costs more than cycling (Wilson 2012 found it; Schumann 2022 did not — the weight is
  // halfway between), but the gap must stay modest.
  const runr = project({ baseline: bobBase(), profile: prof, sessions: sess, weeks: 13, now: NOW, intake: { surplus: 300, proteinGPerLb: 1.0 }, adherence: 1,
    cardioDeltaMin: 200, cardioModality: 'run', cardioIntensity: 'moderate' });
  assert.ok(runr.partition.interferenceFactor <= b.partition.interferenceFactor);
  assert.ok(b.partition.interferenceFactor - runr.partition.interferenceFactor < 0.1);
});

test('carbohydrate has at most a token effect, because the evidence is thin', () => {
  // Vargas-Molina 2022 (doi:10.3390/ijerph191912629): ketogenic vs control in resistance-trained
  // participants, NO significant difference in fat-free mass. So an independent carbohydrate term on the
  // hypertrophy ceiling cannot be large. Checked through the partition, which reports carbFactor.
  const prof = bobProfile({ goal: 'lean_bulk' });
  const sess = bobPlan(TODAY, 4);
  const mk = fatPct => project({ baseline: bobBase(), profile: prof, sessions: sess, weeks: 13, now: NOW,
    intake: { surplus: 300, proteinGPerLb: 1.0, fatPct }, adherence: 1 });
  const normal = mk(25), keto = mk(60);
  assert.ok(keto.partition.carbFactor <= normal.partition.carbFactor);
  assert.ok(keto.partition.carbFactor >= 0.97, `even near-ketogenic may cost at most ~2-3 % (${keto.partition.carbFactor})`);
  assert.equal(normal.partition.carbFactor, 1);
});

test('adaptation matches Levine 1999 at the dose Levine actually tested', () => {
  // Levine 1999 (doi:10.1126/science.283.5399.212): +1,000 kcal/day for 8 weeks raised total daily energy
  // expenditure by ≈ 531 kcal/day, two thirds of it NEAT.
  const a = adaptation(1000, 99, 0);
  assert.ok(a > 450 && a < 600, `${a} kcal/day burnt off at +1000 (Levine measured ≈531)`);
  assert.ok(adaptation(1000, 0, 0) < a, 'and it ramps in, not instantly');
  // Deficit side is a saving, not a burn, and is bounded.
  assert.ok(adaptation(-1000, 99, 0) < 0);
  assert.ok(Math.abs(adaptation(-1000, 99, 0)) < 1000, 'never more than the deficit itself');
  assert.ok(Math.abs(adaptation(-1000, 99, 20)) > Math.abs(adaptation(-1000, 99, 0)), 'grows with mass lost');
  assert.equal(adaptation(0), 0);
  for (let b = -1500; b < 1500; b += 50) {
    const lo = adaptation(b, 99, 0), hi = adaptation(b + 50, 99, 0);
    assert.ok(hi >= lo - 1e-9, `monotone at ${b}`);
  }
});

test('lossRateFactor is anchored on Garthe 2011 and clamped', () => {
  assert.ok(Math.abs(lossRateFactor(0.7) - 1) < 1e-9, '1.0 at the demonstrated 0.7 %/week');
  assert.ok(lossRateFactor(1.0) > 1.5 && lossRateFactor(1.0) < 1.7, `${lossRateFactor(1.0)}`);
  assert.ok(lossRateFactor(0.3) < 1 && lossRateFactor(0.3) >= 0.5);
  assert.ok(lossRateFactor(10) <= 3 && lossRateFactor(0) >= 0.5);
  for (let r = 0; r < 4; r += 0.05) assert.ok(lossRateFactor(r + 0.05) >= lossRateFactor(r));
});

test('the nutrition lab is goal-aware: a cut gets the rate trade-off, not a surplus sweet spot', () => {
  const sess = bobPlan(TODAY, 4);
  const labFor = goal => {
    const prof = bobProfile({ goal });
    return nutritionLab({ baseline: bobBase(), profile: prof, sessions: sess, weeks: 26, now: NOW });
  };
  for (const goal of ['recomp', 'lean_bulk']) {
    const lab = labFor(goal);
    assert.equal(lab.frame, 'surplus', goal);
    assert.equal(lab.sweetSpot.label, 'Sweet spot');
    assert.ok(lab.sweetSpot.from >= 0, `${goal}: the band is a surplus (${lab.sweetSpot.from})`);
    assert.match(lab.sweetSpot.note, /lean mass over/);
  }
  for (const goal of ['cut', 'weight_loss']) {
    const lab = labFor(goal);
    assert.equal(lab.frame, 'deficit', goal);
    assert.equal(lab.sweetSpot.label, 'Target rate');
    assert.ok(lab.sweetSpot.to <= 0, `${goal}: the band is a deficit (${lab.sweetSpot.from}..${lab.sweetSpot.to})`);
    assert.ok(lab.sweetSpot.from <= lab.sweetSpot.to);
    // It must TALK about the trade-off, not about a surplus.
    assert.match(lab.sweetSpot.note, /rate band, not a muscle-gain sweet spot/);
    assert.match(lab.sweetSpot.note, /% of bodyweight a week/);
    assert.match(lab.sweetSpot.note, /lean/);
    assert.match(lab.explanation[0], /not about finding a surplus/);
    // and every point must carry the rate and the lean share of the loss, so the chart can show them
    const deficits = lab.points.filter(p => p.surplus < -100);
    assert.ok(deficits.length > 2);
    for (const p of deficits) {
      assert.ok(p.lossRatePctPerWeek > 0, `rate missing at ${p.surplus}`);
      assert.ok(p.leanShareOfLoss != null && p.leanShareOfLoss >= 0 && p.leanShareOfLoss <= 1, `lean share at ${p.surplus}`);
    }
    // faster loss costs a bigger lean share: the trade-off the chart exists to show
    const fast = deficits[0], slow = deficits[deficits.length - 1];
    assert.ok(fast.lossRatePctPerWeek > slow.lossRatePctPerWeek);
    assert.ok(fast.leanShareOfLoss >= slow.leanShareOfLoss);
    // the sweep leans into the deficit side rather than asking a surplus question
    assert.ok(lab.points[0].surplus <= -900, `${goal}: sweep should reach a deep deficit (${lab.points[0].surplus})`);
  }
  // An explicit calorieRange from the caller still wins.
  const prof = bobProfile({ goal: 'cut' });
  const fixed = nutritionLab({ baseline: bobBase(), profile: prof, sessions: sess, weeks: 26, now: NOW, calorieRange: [-300, 300] });
  assert.equal(fixed.points[0].surplus, -300);
  assert.ok(fixed.points[fixed.points.length - 1].surplus <= 300);
  assert.ok(fixed.points[fixed.points.length - 1].surplus > 300 - 125);
});

// The full 8-year horizon is the expensive case (5 scenario simulations x 418 weeks), so one goal gets the
// whole horizon and the others a 3-year one; the asymptote is already reached well before year 8.
test('8 years stays sane: no blow-ups, no asymptote violations, bounded output', () => {
  for (const [goal, weeks] of [['lean_bulk', 418], ['recomp', 156], ['cut', 156]]) {
    const prof = bobProfile({ goal });
    const r = project({ baseline: bobBase(), profile: prof, sessions: bobPlan(TODAY, 12), weeks, now: NOW, repeatPlan: true });
    const e = r.series[r.series.length - 1];
    assert.ok(e.ffmi <= FFMI_NATURAL_CEILING + 1e-6, `${goal}: FFMI ${e.ffmi} > ${FFMI_NATURAL_CEILING}`);
    assert.ok(e.leanLb > 100 && e.leanLb < 175, `${goal}: lean ${e.leanLb}`);
    assert.ok(e.bodyFatPct > 3 && e.bodyFatPct < 60, `${goal}: bf ${e.bodyFatPct}`);
    assert.ok(e.weightLb > 100 && e.weightLb < 400, `${goal}: weight ${e.weightLb}`);
    // lean mass must converge, not keep compounding: the last year adds less than the first
    const at = w => r.series.reduce((b, p) => (Math.abs(p.week - w) < Math.abs(b.week - w) ? p : b), r.series[0]);
    const y1 = at(52).leanLb - r.series[0].leanLb, yN = at(weeks).leanLb - at(weeks - 52).leanLb;
    assert.ok(yN < y1, `${goal}: the last year (${yN.toFixed(2)}) must add less lean than year 1 (${y1.toFixed(2)})`);
    assert.ok(yN >= -2, `${goal}: and it must not run away downward (${yN.toFixed(2)})`);
    for (const p of r.series) for (const v of Object.values(p.musclePct)) assert.ok(Number.isFinite(v) && v > -60 && v < 300, `${goal}: musclePct ${v}`);
  }
});
