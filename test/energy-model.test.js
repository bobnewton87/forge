// Energy model: cardio METs, gross vs net kcal, bodyweight scaling, BMR equations, protein
// dose-response, dietary fat, carb cycling and adaptive TDEE.
//
// Every number asserted here is traceable to docs/research/energy-model.md. The point of this file is
// that a future edit cannot silently move a constant away from its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDIO, CLASS_CARDIO, INTENSITIES, RESTING_METS, EPOC_FRACTION,
  metsFor, classMets, estimateCalories, estimateNetCalories,
} from '../js/data/cardio.js';
import {
  bodyComp, tdee, sessionCalories, bmrFromLean, mifflinBmr, BMR_EQUATIONS,
  NEAT_FACTORS, TEF_FRACTION, ENERGY_COMPENSATION, compensatedKcal,
} from '../js/engine/bodycomp.js';
import {
  macrosFor, dailyTargets, adaptiveTdee, cycleMean, REFERENCE_WEEK, SIMPLE_DEFICIT,
  DEFAULT_PROTEIN, PROTEIN_EVIDENCE, FAT_EVIDENCE, KCAL_PER_LB_TREND,
  ADAPTIVE_WINDOW_DAYS, ADAPTIVE_MIN_DAYS, NUTRITION_TIPS,
} from '../js/engine/nutrition.js';

const LB_PER_KG = 2.20462;
const near = (a, b, tol = 1e-6, label = '') => assert.ok(Math.abs(a - b) <= tol, `${label}${label ? ': ' : ''}${a} vs ${b} (±${tol})`);
// Bob: 39, male, 69 in, 164 lb, 23 % body fat (DXA-equivalent).
const BOB = { weightLb: 164, heightIn: 69, bodyFatPct: 23, age: 39, sex: 'male' };
const bobComp = () => bodyComp(BOB);

// ---------------------------------------------------------------- 1. METs vs the 2024 Compendium
// Herrmann SD et al. 2024, J Sport Health Sci 13:6-12, doi:10.1016/j.jshs.2023.10.010.
// Specific Activity code → measured MET value, transcribed from pacompendium.com.
const COMPENDIUM_2024 = {
  '12060': 10.5, '12110': 13.0, '12120': 14.8, '12140': 9.3, '12145': 10.5,
  '17035': 7.0, '17036': 8.8, '17045': 6.5, '17082': 5.3, '17012': 7.8, '17190': 3.8, '17220': 5.5,
  '01220': 6.0, '01232': 10.3, '01270': 9.0,
  '02071': 5.0, '02073': 11.0, '02048': 5.0, '02049': 9.0, '02065': 9.3, '02068': 11.0, '02069': 9.0,
  '02210': 7.0, '02214': 11.0, '02024': 2.8, '02022': 3.8, '02035': 5.0, '02050': 6.0, '02061': 5.0,
  '02101': 2.3, '02103': 1.8, '02105': 2.8, '02160': 4.0, '02175': 2.3, '02280': 7.9, '02310': 6.5,
  '02006': 8.0, '02060': 5.5,
  '18230': 9.8, '18240': 5.8,
};

test('cardio METs cite a real 2024 Compendium code and match its measured value', () => {
  let cited = 0;
  for (const [id, c] of Object.entries(CARDIO)) {
    const { easyCode, hardCode } = c.mets;
    for (const [code, mets, end] of [[easyCode, c.metsEasy, 'easy'], [hardCode, c.metsHard, 'hard']]) {
      if (code == null) continue;                       // labelled ASSUMPTION in the source comment
      assert.ok(code in COMPENDIUM_2024, `${id}.${end}: code ${code} not in the transcribed table`);
      near(mets, COMPENDIUM_2024[code], 0.75, `${id}.${end}`);
      cited++;
    }
  }
  // Only air bike, trail-run hard, fast skipping and fast rucking are assumptions; everything else cites.
  assert.ok(cited >= 22, `only ${cited} MET values cite a Compendium code`);
  // A midCode means the Compendium publishes one value and easy/hard bracket it.
  for (const [id, c] of Object.entries(CARDIO)) {
    const mid = c.mets.midCode;
    if (mid == null) continue;
    assert.ok(mid in COMPENDIUM_2024, `${id}: midCode ${mid} not transcribed`);
    assert.ok(c.metsEasy < COMPENDIUM_2024[mid] && c.metsHard > COMPENDIUM_2024[mid], `${id} must bracket ${mid}`);
    near(metsFor(id, 'moderate'), COMPENDIUM_2024[mid], 0.1, id);
  }
  assert.ok(Object.values(CARDIO).filter(c => c.mets.midCode).length >= 2);
  // Class types carry the same citations and must match them too.
  let classCited = 0;
  for (const [type, c] of Object.entries(CLASS_CARDIO)) {
    for (const [code, mets, end] of [[c.easyCode, c.metsEasy, 'easy'], [c.hardCode, c.metsHard, 'hard']]) {
      if (code == null) continue;
      assert.ok(code in COMPENDIUM_2024, `class ${type}.${end}: code ${code} not transcribed`);
      near(mets, COMPENDIUM_2024[code], 0.75, `class ${type}.${end}`);
      classCited++;
    }
    if (c.midCode != null) {
      assert.ok(c.metsEasy < COMPENDIUM_2024[c.midCode] && c.metsHard > COMPENDIUM_2024[c.midCode], `class ${type} must bracket ${c.midCode}`);
      near(classMets(type, 'moderate'), COMPENDIUM_2024[c.midCode], 0.1, `class ${type}`);
    }
  }
  assert.ok(classCited >= 12, `only ${classCited} class MET values cite a code`);
  // The Compendium rounds the last digit to 0, 3, 5 or 8 — keep that convention so values stay comparable.
  for (const [id, c] of Object.entries(CARDIO)) {
    for (const v of [c.metsEasy, c.metsHard]) {
      assert.ok([0, 3, 5, 8].includes(Math.round(v * 10) % 10), `${id}: ${v} is not a Compendium-rounded MET`);
    }
  }
});

test('MET values that changed in the 2024 revision moved the right way', () => {
  // The old (2011-era, hand-tuned) values and what the 2024 Compendium measures. These are the four
  // modalities that were materially wrong, so a regression here is a real accuracy loss.
  assert.ok(CARDIO.walk_incline.metsEasy >= 7, '12-3-30 incline walking is 8.8 METs (17036), not 5');
  assert.equal(CARDIO.walk_incline.metsHard, 8.8);
  assert.ok(CARDIO.hiit_bodyweight.metsHard >= 11, 'burpee/Tabata HIIT measures 11.0 METs (02214)');
  assert.ok(CARDIO.elliptical.metsHard >= 9, 'vigorous elliptical measures 9.0 METs (02049)');
  assert.ok(CARDIO.row.metsHard >= 11, 'rowing at 150-199 W measures 11.0 METs (02073)');
  // Pilates and stretching were over-read as classes.
  assert.ok(CLASS_CARDIO.pilates.metsHard <= 2.8, 'Pilates general is 2.8 METs (02105), not 3.5');
  assert.ok(CLASS_CARDIO.stretch.metsEasy <= 2.3);
});

test('a moderate spin class and a moderate stair-climber return their single measured value', () => {
  // Where the Compendium has one measured number, easy/hard must bracket it so 'moderate' lands on it.
  near(classMets('cycle', 'moderate'), COMPENDIUM_2024['01270'], 0.01);     // 9.0
  near(metsFor('spin', 'moderate'), COMPENDIUM_2024['01270'], 0.01);        // 9.0
  near(metsFor('stairmaster', 'moderate'), COMPENDIUM_2024['02065'], 0.1);  // 9.3
});

test('classes and cardio share ONE intensity model (CONTRACT §18)', () => {
  // Both interpolate metsEasy→metsHard by INTENSITIES[k].factor. No separate ±10 % scaler.
  for (const [type, c] of Object.entries(CLASS_CARDIO)) {
    near(classMets(type, 'easy'), c.metsEasy, 1e-9, type);
    near(classMets(type, 'hard'), c.metsHard, 1e-9, type);
    near(classMets(type, 'moderate'), (c.metsEasy + c.metsHard) / 2, 1e-9, type);
    near(classMets(type, 'intervals'), c.metsEasy + (c.metsHard - c.metsEasy) * INTENSITIES.intervals.factor, 1e-9, type);
    assert.ok(c.metsHard > c.metsEasy, type);
  }
  for (const [id, c] of Object.entries(CARDIO)) {
    near(metsFor(id, 'easy'), c.metsEasy, 1e-9, id);
    near(metsFor(id, 'hard'), c.metsHard, 1e-9, id);
  }
  classMets('not-a-class-type');                                            // falls back to 'other', no throw
  near(classMets('nope', 'easy'), CLASS_CARDIO.other.metsEasy, 1e-9);
});

// ---------------------------------------------------------------- 2. kcal scaling and gross vs net
test('cardio kcal are METs × kg × hours: linear in bodyweight, minutes and METs', () => {
  // 1 MET = 3.5 mL O2/kg/min ≈ 1.0 kcal/kg/h (Herrmann 2024 §2.5).
  assert.equal(RESTING_METS, 1);
  const k = (lb, min, int = 'easy') => estimateCalories('bike', min, int, lb);
  // Exact formula, not a trend.
  near(k(165, 60), Math.round(CARDIO.bike.metsEasy * (165 / LB_PER_KG)), 0.5);
  // Doubling bodyweight doubles kcal.
  near(k(300, 45) / k(150, 45), 2, 0.02);
  // Doubling minutes doubles kcal.
  near(k(164, 60) / k(164, 30), 2, 0.02);
  // Heavier always burns more at the same session; lighter always less.
  assert.ok(k(200, 30) > k(164, 30));
  assert.ok(k(120, 30) < k(164, 30));
  // A 1 kcal/kg/h check anyone can do by hand: 1 MET for 1 h at 74.4 kg ≈ 74 kcal.
  near(1 * (164 / LB_PER_KG), 74.39, 0.01);
  // Degenerate input never produces NaN or a negative.
  for (const args of [['nope', 30, 'easy', 165], ['bike', 0, 'easy', 165], ['bike', 30, 'bogus', 0], ['bike', -5, 'easy', -5]]) {
    const v = estimateCalories(...args);
    assert.ok(Number.isFinite(v) && v >= 0, JSON.stringify(args));
    assert.ok(Number.isFinite(estimateNetCalories(...args)) && estimateNetCalories(...args) >= 0);
  }
});

test('net kcal = gross minus the one resting MET, and gross is always the larger', () => {
  for (const id of Object.keys(CARDIO)) {
    for (const int of ['easy', 'moderate', 'hard', 'intervals']) {
      const gross = estimateCalories(id, 45, int, 164), net = estimateNetCalories(id, 45, int, 164);
      assert.ok(net < gross, `${id}/${int}: net ${net} should be below gross ${gross}`);
      const restKcal = RESTING_METS * (164 / LB_PER_KG) * (45 / 60);        // ~56 kcal
      near(gross - net, restKcal, 1.5, `${id}/${int}`);
    }
  }
  // The size of the error this prevents: a 45-min easy run.
  const gross = estimateCalories('run', 45, 'easy', 164);
  assert.ok(gross - estimateNetCalories('run', 45, 'easy', 164) >= 50);
});

test('tdee() subtracts the resting burn BMR+NEAT already covers (no double-counting)', () => {
  const comp = bobComp();
  const run = { date: '2026-10-10', status: 'done',
    blocks: [{ kind: 'cardio', modality: 'run', minutes: 60, intensity: 'easy', done: true }] };
  const t = tdee({ comp, activity: 'desk', sessions: [run], from: '2026-10-01', to: '2026-10-28', now: new Date('2026-10-28T12:00:00Z') });
  const gross = sessionCalories(run, { weightLb: comp.weightLb });
  const restPerMin = (comp.bmr + comp.bmr * NEAT_FACTORS.desk) / 1440;
  const expectedNet = gross - restPerMin * 60;
  const days = 28;
  near(t.exercise, expectedNet / days, 1.5);
  // The subtraction is real and material: ~90 kcal off a 1-hour run at Bob's size.
  assert.ok(gross - expectedNet > 70, String(gross - expectedNet));
  // TDEE = BMR + NEAT + net exercise, nothing else.
  near(t.total, comp.bmr + t.neat + t.exercise, 1.5);
  assert.equal(t.neat, Math.round(comp.bmr * NEAT_FACTORS.desk));
  // A session so light it costs less than resting can never reduce TDEE.
  const nap = { date: '2026-10-10', status: 'done', blocks: [{ kind: 'class', duration: 60, done: true, classify: { type: 'stretch', intensity: 'easy' } }] };
  assert.ok(tdee({ comp, activity: 'desk', sessions: [nap], from: '2026-10-01', to: '2026-10-28', now: new Date('2026-10-28T12:00:00Z') }).exercise >= 0);
});

test('more cardio means more burn, linearly in minutes, and the marginal return is compensated', () => {
  const comp = bobComp();
  // One 7-day window, so `min` reads as minutes per week and the result as kcal/day.
  const at = min => tdee({ comp, activity: 'desk',
    sessions: min ? [{ date: '2026-10-05', status: 'done', blocks: [{ kind: 'cardio', modality: 'bike', minutes: min, intensity: 'easy', done: true }] }] : [],
    from: '2026-10-01', to: '2026-10-07', now: new Date('2026-10-07T12:00:00Z') }).total;
  const base = at(0);
  let prev = base;
  for (const min of [30, 60, 90, 120, 180, 240]) {          // a realistic weekly range, as one session
    const v = at(min);
    assert.ok(v > prev, `cardio ${min} min should burn more than the step below (${v} vs ${prev})`);
    prev = v;
  }
  // Strictly linear in minutes inside tdee(): the bend comes from compensation, not from the kcal model.
  near((at(240) - base) / (at(120) - base), 2, 0.05);
  // Compensation: ~72 % of an added burn shows up in total expenditure (Careau 2021).
  assert.equal(ENERGY_COMPENSATION, 0.28);
  near(compensatedKcal(500), 360, 1e-9);
  near(compensatedKcal(-500), -360, 1e-9);                   // symmetric
  near(compensatedKcal(500, 0), 500, 1e-9);                  // no compensation → pass-through
  near(compensatedKcal(500, 1), 0, 1e-9);                    // full compensation
  for (const bad of [null, undefined, NaN, 'x']) assert.equal(compensatedKcal(bad), 0);
  near(compensatedKcal(500, 5), 0, 1e-9);                    // clamped to [0, 1]
  near(compensatedKcal(500, -5), 500, 1e-9);
  // Bob's own number: 240 min/week of easy cycling is ~+330 kcal/day gross-of-compensation,
  // ~+240 after it. Both positive, so "more cardio burns fat faster" holds — just at 72 % of the
  // number on the machine, before appetite.
  const added = at(240) - base;
  assert.ok(added > 150 && added < 500, String(added));
  assert.ok(compensatedKcal(added) < added && compensatedKcal(added) > 0.6 * added);
  // EPOC is documented and deliberately not applied: 6-15 % of net cost (LaForgia 2006), inside the
  // ±20 % error of the MET estimate itself.
  assert.ok(EPOC_FRACTION.low === 0.06 && EPOC_FRACTION.high === 0.15);
  assert.ok(EPOC_FRACTION.high < 0.2);
});

// ---------------------------------------------------------------- 3. BMR equations
test('BMR equations reproduce their published formulas exactly', () => {
  // Cunningham JJ 1991, Am J Clin Nutr 54:963-9 (doi:10.1093/ajcn/54.6.963): REE = 370 + 21.6 × FFM kg.
  for (const ffmKg of [40, 50, 57.3, 60, 80]) {
    assert.equal(bmrFromLean(ffmKg * LB_PER_KG), Math.round(370 + 21.6 * ffmKg), `FFM ${ffmKg} kg`);
  }
  assert.equal(bmrFromLean(60 * LB_PER_KG), 1666);           // worked by hand: 370 + 1296
  assert.equal(bmrFromLean(0), null);
  assert.equal(bmrFromLean(null), null);
  // Mifflin-St Jeor (1990): 10 × kg + 6.25 × cm − 5 × age + 5 (men) / −161 (women).
  // Worked example, 80 kg / 180 cm / 45 y man: 800 + 1125 − 225 + 5 = 1705.
  assert.equal(mifflinBmr({ weightLb: 80 * LB_PER_KG, heightIn: 180 / 2.54, age: 45, sex: 'male' }), 1705);
  // Same body as a woman: 1705 − 166 = 1539.
  assert.equal(mifflinBmr({ weightLb: 80 * LB_PER_KG, heightIn: 180 / 2.54, age: 45, sex: 'female' }), 1539);
  assert.equal(mifflinBmr({ weightLb: 164 }), null);         // needs height
  // Ageing costs ~5 kcal/day/year in this equation, by construction.
  const a = mifflinBmr({ weightLb: 164, heightIn: 69, age: 30 }), b = mifflinBmr({ weightLb: 164, heightIn: 69, age: 40 });
  assert.equal(a - b, 50);
});

test('bodyComp picks the lean-mass equation when body fat is known, Mifflin when it is not', () => {
  const withBf = bobComp();
  assert.equal(withBf.bmrMethod, 'katch');                   // key kept for API compatibility
  assert.equal(withBf.bmrEquation, BMR_EQUATIONS.katch.name);
  assert.equal(BMR_EQUATIONS.katch.name, 'Cunningham 1991'); // it was mis-attributed to Katch-McArdle
  assert.equal(BMR_EQUATIONS.katch.doi, '10.1093/ajcn/54.6.963');
  assert.equal(withBf.bmr, bmrFromLean(withBf.leanLb));
  const noBf = bodyComp({ weightLb: 164, heightIn: 69, age: 39, sex: 'male' });
  assert.equal(noBf.bmrMethod, 'mifflin');
  assert.equal(noBf.bmr, mifflinBmr({ weightLb: 164, heightIn: 69, age: 39, sex: 'male' }));
  const noHeight = bodyComp({ weightLb: 164 });
  assert.equal(noHeight.bmrMethod, 'weight');
  // Switching equations must not be a cliff: at a normal body composition they agree within ~5 %.
  assert.ok(Math.abs(withBf.bmr - noBf.bmr) / noBf.bmr < 0.05, `${withBf.bmr} vs ${noBf.bmr}`);
  // The lean-mass equation is sex-neutral by construction (the sex difference lives in lean mass).
  assert.equal(bodyComp({ ...BOB, sex: 'female' }).bmr, withBf.bmr);
  // Uncertainty is reported, not hidden. Published equations disagree, and in lean muscular people
  // they read low (Tinsley 2018, doi:10.1139/apnm-2018-0412).
  assert.ok(withBf.bmrRange.low <= withBf.bmr && withBf.bmrRange.high > withBf.bmr);
  assert.ok(withBf.bmrRange.high - withBf.bmrRange.low > 100, 'the real spread is a few hundred kcal');
  // Cunningham 1991 is the LOW end of that spread, which is the known bias direction.
  assert.equal(withBf.bmrRange.low, withBf.bmr);
  assert.match(withBf.bmrNote, /Cunningham 1991/);
  assert.match(withBf.bmrNote, /Tinsley 2018/);
  assert.match(noBf.bmrNote, /Mifflin-St Jeor/);
  for (const c of [withBf, noBf, noHeight]) assert.ok(Number.isFinite(c.bmr) && c.bmr > 800);
});

test('NEAT factors are non-exercise PALs inside the IOM bands, and include TEF', () => {
  // 1 + factor, read as a PAL for everything except planned training (IOM DRI 2005 bands:
  // sedentary 1.0-1.39, low active 1.4-1.59, active 1.6-1.89).
  assert.ok(1 + NEAT_FACTORS.desk >= 1.0 && 1 + NEAT_FACTORS.desk <= 1.39);
  assert.ok(1 + NEAT_FACTORS.light >= 1.4 && 1 + NEAT_FACTORS.light <= 1.59);
  assert.ok(1 + NEAT_FACTORS.active >= 1.6 && 1 + NEAT_FACTORS.active <= 1.89);
  assert.ok(NEAT_FACTORS.desk < NEAT_FACTORS.light && NEAT_FACTORS.light < NEAT_FACTORS.active);
  // TEF for a mixed diet at balance: 5-15 % of daily expenditure (Westerterp 2004).
  assert.equal(TEF_FRACTION.typical, 0.1);
  assert.ok(TEF_FRACTION.low === 0.05 && TEF_FRACTION.high === 0.15);
  // It is inside the NEAT factor, so the desk factor must be at least that big.
  assert.ok(NEAT_FACTORS.desk > TEF_FRACTION.typical);
  // Activity level moves TDEE in the right direction and by a sane amount.
  const comp = bobComp();
  const T = a => tdee({ comp, activity: a, sessions: [], now: new Date('2026-10-28T12:00:00Z') }).total;
  assert.ok(T('active') > T('light') && T('light') > T('desk'));
  near(T('active') - T('desk'), comp.bmr * (NEAT_FACTORS.active - NEAT_FACTORS.desk), 1.5);
});

// ---------------------------------------------------------------- 4. protein
test('protein evidence constants agree with each other in both units', () => {
  // Morton 2018 (doi:10.1136/bjsports-2017-097608): plateau 1.62 g/kg, CI top ~2.2 g/kg.
  near(PROTEIN_EVIDENCE.plateauGPerLb, PROTEIN_EVIDENCE.plateauGPerKg / LB_PER_KG, 0.01);
  near(PROTEIN_EVIDENCE.ceilingGPerLb, PROTEIN_EVIDENCE.ceilingGPerKg / LB_PER_KG, 0.01);
  assert.equal(PROTEIN_EVIDENCE.doi, '10.1136/bjsports-2017-097608');
  // The growth-goal default is the top of Morton's interval, not the plateau: deliberate safety margin.
  assert.equal(DEFAULT_PROTEIN.recomp, PROTEIN_EVIDENCE.ceilingGPerLb);
  assert.equal(DEFAULT_PROTEIN.lean_bulk, PROTEIN_EVIDENCE.ceilingGPerLb);
  // The cut default is above it, because the deficit dose-response runs past the plateau (Longland 2016).
  assert.ok(DEFAULT_PROTEIN.cut > DEFAULT_PROTEIN.recomp);
  // Helms 2014's lean-mass range, converted at Bob's body comp, brackets the app's bodyweight target.
  const leanLb = 164 * 0.77, leanKg = leanLb / LB_PER_KG;
  const lo = leanKg * PROTEIN_EVIDENCE.deficitGPerKgLean[0] / 164, hi = leanKg * PROTEIN_EVIDENCE.deficitGPerKgLean[1] / 164;
  assert.ok(lo < DEFAULT_PROTEIN.cut && DEFAULT_PROTEIN.cut <= hi + 0.1, `${lo}-${hi} g/lb BW vs ${DEFAULT_PROTEIN.cut}`);
});

test('protein target is per lb of BODYWEIGHT and scales linearly with it', () => {
  const g = (bw, pg = 1) => macrosFor({ goal: 'recomp', nutrition: { proteinGPerLb: pg } }, { calories: 2800, bodyweight: bw }).protein;
  assert.equal(g(164), 164);
  assert.equal(g(200), 200);
  near(g(300) / g(150), 2, 0.01);
  near(g(164, 1.15), 164 * 1.15, 1);
  // Reported back in the same unit it was set in.
  const m = macrosFor({ goal: 'recomp', nutrition: { proteinGPerLb: 1.15 } }, { calories: 2800, bodyweight: 164 });
  near(m.proteinGPerLb, 1.15, 0.01);
  // Clamped, never NaN.
  assert.ok(macrosFor({ nutrition: { proteinGPerLb: 99 } }, { calories: 2800, bodyweight: 164 }).proteinGPerLb <= 2.01);
  assert.ok(macrosFor({ nutrition: { proteinGPerLb: -5 } }, { calories: 2800, bodyweight: 164 }).protein > 0);
});

test('protein warnings mark the plateau below and the ceiling above, deficit-aware', () => {
  const at = (pg, goal = 'recomp') => macrosFor({ goal, nutrition: { proteinGPerLb: pg } }, { calories: 2800, bodyweight: 164 }).warnings.join(' | ');
  // Below the plateau: warned, with Morton's actual number in both units.
  assert.match(at(0.5), /Morton 2018/);
  assert.match(at(0.5), /1\.62 g\/kg/);
  assert.match(at(0.5), /0\.73 g\/lb/);
  // At and just above the plateau: no complaint in either direction.
  assert.equal(at(0.8), '');
  assert.equal(at(1.0), '');
  assert.equal(at(1.15), '');
  assert.equal(at(1.3), '');
  // Well past the ceiling: flagged as unnecessary for growth...
  assert.match(at(1.6), /did not add lean mass/);
  // ...but NOT as useless in a deficit, where Longland 2016 found it still paid.
  assert.match(at(1.6, 'cut'), /Longland 2016/);
  assert.doesNotMatch(at(1.6, 'cut'), /did not add lean mass/);
  assert.match(at(1.6, 'weight_loss'), /Longland 2016/);
  // The shape of the curve: warn, flat, warn — one boundary each side, nothing in between.
  const flagged = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0].map(p => at(p) !== '');
  assert.deepEqual(flagged, [true, true, true, false, false, false, false, false, false, false, true, true, true, true, true]);
});

test('protein is reported per lb of lean mass too, and flagged only where that matters', () => {
  // Bob at 23 % body fat: the two units are close, so no note.
  const bob = macrosFor({ goal: 'cut', nutrition: { proteinGPerLb: 1.15 } }, { calories: 2500, bodyweight: 164, leanLb: 164 * 0.77 });
  near(bob.proteinGPerLbLean, bob.protein / (164 * 0.77), 0.01);
  near(bob.proteinGPerKgLean, bob.proteinGPerLbLean * LB_PER_KG, 0.02);
  assert.ok(bob.proteinGPerLbLean > bob.proteinGPerLb);
  assert.ok(!bob.warnings.some(w => /lean mass/i.test(w) && /body fat/.test(w)), bob.warnings.join(' | '));
  // At 38 % body fat the units diverge and the note appears with the lean-based gram range.
  const heavy = macrosFor({ goal: 'cut', nutrition: { proteinGPerLb: 1.15 } }, { calories: 2500, bodyweight: 250, leanLb: 250 * 0.62 });
  assert.ok(heavy.warnings.some(w => /Helms 2014/.test(w)), heavy.warnings.join(' | '));
  assert.ok(heavy.warnings.some(w => /2\.3-3\.1 g\/kg of lean mass/.test(w)));
  // Without lean mass the extra fields are simply absent — never NaN.
  const noLean = macrosFor({ goal: 'cut', nutrition: { proteinGPerLb: 1.15 } }, { calories: 2500, bodyweight: 164 });
  assert.equal(noLean.proteinGPerLbLean, undefined);
  assert.ok(Number.isFinite(noLean.protein));
  // dailyTargets passes lean mass through.
  const t = dailyTargets({ bodyweight: 250, goal: 'cut', nutrition: { mode: 'simple' } }, { bodyweight: 250, tdee: 3000, leanLb: 250 * 0.62 });
  assert.ok(Number.isFinite(t.proteinGPerLbLean));
  assert.ok(t.warnings.some(w => /Helms 2014/.test(w)));
});

// ---------------------------------------------------------------- 5. dietary fat
test('dietary fat is modelled as a FLOOR, with no fat-makes-you-fat mechanism', () => {
  assert.equal(FAT_EVIDENCE.floorPct, 20);
  assert.deepEqual(FAT_EVIDENCE.amdr, [20, 35]);              // IOM AMDR
  assert.deepEqual(FAT_EVIDENCE.athleteRange, [15, 30]);      // Helms 2014
  // Whittaker & Wu 2021 (doi:10.1016/j.jsbmb.2021.105878): total T −0.38 SD (CI −0.75 to −0.01).
  assert.equal(FAT_EVIDENCE.totalTestosteroneSMD, -0.38);
  assert.deepEqual(FAT_EVIDENCE.totalTestosteroneCI, [-0.75, -0.01]);
  assert.equal(FAT_EVIDENCE.doi, '10.1016/j.jsbmb.2021.105878');
  // The effect is small: the confidence interval nearly touches zero.
  assert.ok(FAT_EVIDENCE.totalTestosteroneCI[1] > -0.05);
  const w = pct => macrosFor({ goal: 'recomp', nutrition: { fatPct: pct } }, { calories: 2800, bodyweight: 164 }).warnings.join(' | ');
  // Warned BELOW the floor only. There is no high-fat warning, because there is no evidence for one.
  assert.match(w(15), /Fat is only/);
  assert.match(w(15), /Whittaker 2021/);
  assert.match(w(15), /eating MORE fat does not make you gain fat/);
  assert.equal(w(25), '');
  assert.equal(w(35), '');
  assert.equal(w(45), '');                                     // no "too much fat" warning anywhere
  assert.equal(w(60), '');
  // At equal calories and protein, moving fat up or down does not change the calorie target at all —
  // which is the model's way of saying the split is not a body-composition lever.
  const a = macrosFor({ goal: 'recomp', nutrition: { fatPct: 20 } }, { calories: 2800, bodyweight: 164 });
  const b = macrosFor({ goal: 'recomp', nutrition: { fatPct: 35 } }, { calories: 2800, bodyweight: 164 });
  assert.equal(a.protein, b.protein);
  near(a.protein * 4 + a.carbs * 4 + a.fat * 9, b.protein * 4 + b.carbs * 4 + b.fat * 9, 20);
  assert.ok(b.fat > a.fat && b.carbs < a.carbs);               // carbs are what moves
  // The claim shown to the user says the same thing.
  assert.ok(NUTRITION_TIPS.some(t => /does not make you fat/.test(t) && /surplus/.test(t)));
  assert.match(FAT_EVIDENCE.noFatteningMechanism, /not more fattening/);
});

// ---------------------------------------------------------------- 6. carb cycling
test('carb cycling is zero-sum: the day types average to the target intake', () => {
  const P = (mode, goal) => ({ bodyweight: 164, goal, nutrition: { mode, calories: null, surplus: null } });
  for (const goal of ['recomp', 'lean_bulk', 'cut', 'weight_loss']) {
    const flat = dailyTargets(P('simple', goal), { tdee: 2800 }).calories;
    let days = 0, sum = 0;
    for (const [dayType, n] of Object.entries(REFERENCE_WEEK)) {
      days += n; sum += n * dailyTargets(P('cycling', goal), { dayType, tdee: 2800 }).calories;
    }
    near(sum / days, flat, 10, goal);
    // ...and the spread is still there: training days higher than rest days.
    const lift = dailyTargets(P('cycling', goal), { dayType: 'lift', tdee: 2800 }).calories;
    const rest = dailyTargets(P('cycling', goal), { dayType: 'rest', tdee: 2800 }).calories;
    const both = dailyTargets(P('cycling', goal), { dayType: 'both', tdee: 2800 }).calories;
    assert.ok(both > lift && lift > rest, goal);
  }
  // cycleMean is the mean of the offsets over the week, which is what makes the above exact.
  for (const goal of ['recomp', 'lean_bulk', 'cut', 'weight_loss']) {
    const cm = cycleMean(goal, REFERENCE_WEEK);
    assert.ok(Number.isFinite(cm));
    // The old code used SIMPLE_DEFICIT here; that it is NOT the mean is exactly the bug that was fixed.
    assert.ok(Math.abs(cm - SIMPLE_DEFICIT[goal]) > 1, `${goal}: cycleMean ${cm} vs flat ${SIMPLE_DEFICIT[goal]}`);
  }
  // A caller's own week is honoured, and junk input falls back instead of producing NaN.
  near(cycleMean('recomp', { rest: 7 }), 500, 1e-9);           // CYCLE values are deficits BELOW maintenance
  assert.ok(Number.isFinite(cycleMean('recomp', {})));
  assert.ok(Number.isFinite(cycleMean('recomp', null)));
  assert.ok(Number.isFinite(cycleMean('nonsense', REFERENCE_WEEK)));
  assert.equal(Object.values(REFERENCE_WEEK).reduce((a, b) => a + b, 0), 7);
});

// ---------------------------------------------------------------- 7. adaptive TDEE
const synthetic = ({ kcal, lbPerWeek, days, startW = 170, startD = new Date('2026-08-01T12:00:00Z') }) => {
  const bodyLog = [], foodLog = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startD.getTime() + i * 864e5).toISOString().slice(0, 10);
    bodyLog.push({ d, w: startW + lbPerWeek * i / 7 });
    foodLog.push({ d, kcal });
  }
  return { bodyLog, foodLog, to: bodyLog[bodyLog.length - 1].d };
};

test('adaptiveTdee recovers a known burn from synthetic intake and weight change', () => {
  // Eat 2,400 and lose exactly 0.5 lb/week ⇒ burn 2,400 + 0.5/7 × 3,500 = 2,650 kcal/day.
  const s = synthetic({ kcal: 2400, lbPerWeek: -0.5, days: 28 });
  const r = adaptiveTdee(s);
  assert.ok(r && r.tdee, 'expected a result');
  near(r.tdee, 2400 + 0.5 / 7 * KCAL_PER_LB_TREND, 6);
  near(r.avgIntake, 2400, 1);
  near(r.lbPerWeek, -0.5, 0.05);
  // Gaining reverses the sign.
  const up = adaptiveTdee(synthetic({ kcal: 3000, lbPerWeek: +0.5, days: 28 }));
  near(up.tdee, 3000 - 0.5 / 7 * KCAL_PER_LB_TREND, 6);
  // Stable weight ⇒ TDEE is intake.
  const flat = adaptiveTdee(synthetic({ kcal: 2600, lbPerWeek: 0, days: 28 }));
  near(flat.tdee, 2600, 6);
  // Reconciliation identity, exactly: intake − rate × kcal/lb.
  for (const [kcal, rate] of [[2000, -1], [2800, -0.25], [3200, 1], [2500, 0]]) {
    const x = adaptiveTdee(synthetic({ kcal, lbPerWeek: rate, days: 28 }));
    near(x.tdee, kcal - rate / 7 * KCAL_PER_LB_TREND, 8, `${kcal}/${rate}`);
  }
  assert.equal(KCAL_PER_LB_TREND, 3500);
});

test('adaptiveTdee window, minimums and confidence ladder', () => {
  assert.equal(ADAPTIVE_WINDOW_DAYS, 28);
  assert.equal(ADAPTIVE_MIN_DAYS, 10);
  // Below the minimum there is no answer at all, rather than a bad one.
  assert.equal(adaptiveTdee(synthetic({ kcal: 2400, lbPerWeek: -0.5, days: 9 })), null);
  assert.ok(adaptiveTdee(synthetic({ kcal: 2400, lbPerWeek: -0.5, days: 10 })));
  assert.equal(adaptiveTdee({ bodyLog: [], foodLog: [] }), null);
  assert.equal(adaptiveTdee({}), null);
  // The default window is the last ADAPTIVE_WINDOW_DAYS days that have data.
  const long = synthetic({ kcal: 2400, lbPerWeek: -0.5, days: 120 });
  const r = adaptiveTdee(long);
  near(require_days(r.from, r.to), ADAPTIVE_WINDOW_DAYS, 0);
  // Confidence rises with coverage.
  assert.equal(adaptiveTdee(synthetic({ kcal: 2400, lbPerWeek: -0.5, days: 28 })).confidence, 'high');
  const sparse = synthetic({ kcal: 2400, lbPerWeek: -0.5, days: 28 });
  const thin = { bodyLog: sparse.bodyLog.filter((_, i) => i % 2 === 0), foodLog: sparse.foodLog.filter((_, i) => i % 2 === 0), to: sparse.to };
  assert.ok(['low', 'medium'].includes(adaptiveTdee(thin).confidence));
  // Once the EWMA has settled (30+ days of history) the trend slope is used instead of raw weigh-ins.
  assert.equal(adaptiveTdee(long).method, 'trend');
  assert.equal(adaptiveTdee(synthetic({ kcal: 2400, lbPerWeek: -0.5, days: 28 })).method, 'raw');
  // Either way it recovers the same burn on clean data.
  near(adaptiveTdee(long).tdee, 2650, 40);
  // Nonsense in, "that doesn't add up" out — never a believable-looking wrong number.
  const absurd = synthetic({ kcal: 1200, lbPerWeek: +4, days: 28 });
  const bad = adaptiveTdee(absurd);
  assert.equal(bad.tdee, null);
  assert.equal(bad.confidence, 'low');
  assert.match(bad.note, /do not add up/);
  // Noise does not bias it: ±2 lb of daily water swings around the same real trend.
  const noisy = synthetic({ kcal: 2400, lbPerWeek: -0.5, days: 56 });
  noisy.bodyLog = noisy.bodyLog.map((e, i) => ({ ...e, w: e.w + (i % 2 ? 1.6 : -1.6) }));
  near(adaptiveTdee(noisy).tdee, 2650, 120);
});
function require_days(from, to) {
  return Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 864e5) + 1;
}

// ---------------------------------------------------------------- 8. Bob's own numbers
test("Bob's numbers are internally consistent end to end", () => {
  const comp = bobComp();
  near(comp.leanLb, 164 * 0.77, 0.2);
  // Resting burn and maintenance.
  assert.ok(comp.bmr > 1500 && comp.bmr < 1700, String(comp.bmr));
  const maint = tdee({ comp, activity: 'desk', sessions: [], now: new Date('2026-10-28T12:00:00Z') }).total;
  near(maint, comp.bmr * (1 + NEAT_FACTORS.desk), 1.5);
  // Nutrition quotes the same maintenance it is handed, and the macros add up to the calories.
  const t = dailyTargets({ bodyweight: 164, goal: 'recomp', nutrition: { mode: 'simple' } },
    { bodyweight: 164, tdee: maint, leanLb: comp.leanLb });
  assert.equal(t.tdee, Math.round(maint));
  assert.equal(t.calories, Math.round((maint - SIMPLE_DEFICIT.recomp) / 10) * 10);
  assert.ok(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.calories) <= 12);
  assert.equal(t.protein, Math.round(164 * DEFAULT_PROTEIN.recomp));
  // No stray NaN anywhere in the outputs this task touched.
  const seen = [comp, t, adaptiveTdee(synthetic({ kcal: 2400, lbPerWeek: -0.5, days: 28 }))];
  const walk = (o, path = '') => {
    if (o == null) return;
    if (typeof o === 'number') { assert.ok(Number.isFinite(o), `NaN at ${path}`); return; }
    if (typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  };
  for (const o of seen) walk(o);
});
