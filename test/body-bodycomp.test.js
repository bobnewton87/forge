import test from 'node:test';
import assert from 'node:assert/strict';
import { navyBodyFat, bodyComp, baseline, tdee, sessionCalories, rfmBodyFat, bmiBodyFat } from '../js/engine/bodycomp.js';
import { bobProfile, bobBodyLog, bobMeas, bobPlan, NOW, TODAY, findBad } from './body-fixtures.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}±${tol}, got ${a}`);

test('navyBodyFat: male known example (70 in, neck 15, waist 34 → ≈17.5%)', () => {
  // 86.010·log10(19) − 70.041·log10(70) + 36.76 = 109.985 − 129.231 + 36.76 = 17.51
  near(navyBodyFat({ sex: 'male', heightIn: 70, neckIn: 15, waistIn: 34 }), 17.5, 0.1);
  near(navyBodyFat({ sex: 'male', heightIn: 69, neckIn: 15, waistIn: 33.5 }), 17.0, 0.2);
});

test('navyBodyFat: female uses hips', () => {
  // 163.205·log10(28+38−13) − 97.684·log10(64) − 78.387 ≈ 26.5
  const bf = navyBodyFat({ sex: 'female', heightIn: 64, neckIn: 13, waistIn: 28, hipsIn: 38 });
  near(bf, 163.205 * Math.log10(53) - 97.684 * Math.log10(64) - 78.387, 0.06);
  assert.equal(navyBodyFat({ sex: 'female', heightIn: 64, neckIn: 13, waistIn: 28 }), null);
});

test('navyBodyFat: null on missing / invalid input', () => {
  assert.equal(navyBodyFat({ sex: 'male', heightIn: 70, neckIn: 15 }), null);
  assert.equal(navyBodyFat({ sex: 'male', neckIn: 15, waistIn: 34 }), null);
  assert.equal(navyBodyFat({ sex: 'male', heightIn: 70, neckIn: 16, waistIn: 15 }), null);   // waist < neck
  assert.equal(navyBodyFat({ sex: 'male', heightIn: 'abc', neckIn: 15, waistIn: 34 }), null);
  assert.equal(navyBodyFat({ sex: 'male', heightIn: -70, neckIn: 15, waistIn: 34 }), null);
  assert.equal(navyBodyFat(), null);
});

test('bodyComp: Katch-McArdle with body fat, FFMI math', () => {
  const c = bodyComp({ weightLb: 164, heightIn: 69, bodyFatPct: 22, age: 39, sex: 'male', waistIn: 33.5 });
  near(c.leanLb, 127.9, 0.1); near(c.fatLb, 36.1, 0.1);
  const leanKg = 164 * 0.78 / 2.20462, m = 69 * 0.0254;
  assert.equal(c.bmr, Math.round(370 + 21.6 * leanKg));
  assert.equal(c.bmrMethod, 'katch');
  near(c.ffmi, leanKg / (m * m), 0.06);
  near(c.ffmiNormalized, leanKg / (m * m) + 6.1 * (1.8 - m), 0.06);
  near(c.bmi, (164 / 2.20462) / (m * m), 0.06);
  near(c.waistToHeight, 33.5 / 69, 0.01);
});

test('bodyComp: Mifflin-St Jeor without body fat; graceful without height/weight', () => {
  const c = bodyComp({ weightLb: 164, heightIn: 69, age: 39, sex: 'male' });
  const kg = 164 / 2.20462, cm = 69 * 2.54;
  near(c.bmr, 10 * kg + 6.25 * cm - 5 * 39 + 5, 1);
  assert.equal(c.bmrMethod, 'mifflin'); assert.equal(c.leanLb, null); assert.equal(c.ffmi, null);
  const f = bodyComp({ weightLb: 140, heightIn: 64, age: 30, sex: 'female' });
  near(f.bmr, 10 * 140 / 2.20462 + 6.25 * 64 * 2.54 - 150 - 161, 1);
  const noAge = bodyComp({ weightLb: 164, heightIn: 69 });
  assert.equal(noAge.ageAssumed, true);
  const noH = bodyComp({ weightLb: 164 });
  assert.equal(noH.bmi, null); assert.ok(noH.bmr > 1000);
  const none = bodyComp({});
  assert.equal(none.weightLb, null); assert.equal(none.bmr, null);
  assert.deepEqual(findBad([c, f, noAge, noH, none]), []);
});

test('baseline: merges latest weigh-in, latest per site, arm average, age', () => {
  const meas = [
    { d: '2026-09-01', neck: 15.5, waist: 35, shoulders: 46, armL: 13, armR: 13.5, thigh: 23 },
    { d: '2026-10-10', waist: 34, armL: 13.5 },
    { d: '2026-10-15', armR: 14 },
    { d: '2026-12-01', waist: 30 },          // future → ignored
  ];
  const b = baseline({ profile: bobProfile(), bodyLog: [{ d: '2026-10-01', w: 166 }, { d: '2026-10-18', w: 164.2 }, { d: '2026-11-01', w: 150 }], measurements: meas, now: NOW });
  assert.equal(b.weightLb, 164.2); assert.equal(b.weightDate, '2026-10-18');
  assert.equal(b.measurements.waist, 34); assert.equal(b.measurements.neck, 15.5); assert.equal(b.measurements.thigh, 23);
  assert.equal(b.measurements.arm, 13.75);
  assert.equal(b.measuredOn.arm, '2026-10-15');
  assert.equal(b.age, 2026 - 1987);
  assert.equal(b.bodyFatSource, 'navy');
  // §20b DXA scale: the value is the inverse-variance blend of the DXA-scale estimates (Navy + 3, one-site Army, RFM − 0.5,
  // Deurenberg), no longer the raw Navy number (which read ~3 points low vs DXA in men).
  assert.equal(b.bodyFatMethod, 'blend');
  near(b.bodyFatSources.navy, b.navyBodyFatPct + 3, 0.06);
  assert.ok(b.bodyFatPct > b.navyBodyFatPct);
  near(b.ratios.shoulderToWaist, 46 / 34, 0.01);
  assert.ok(b.missing.includes('chest'));
  assert.ok(!b.missing.includes('waist'));
  assert.ok(b.missingInfo.every(x => x.why && x.label));
});

test('baseline: body-fat source priority manual > navy > estimate', () => {
  const p = bobProfile();
  const manual = baseline({ profile: p, bodyLog: bobBodyLog(), measurements: bobMeas(), now: NOW });
  assert.equal(manual.bodyFatSource, 'manual'); assert.equal(manual.bodyFatPct, 22);
  assert.ok(manual.navyBodyFatPct > 10);            // navy still reported for comparison
  const noManual = bobMeas().map(({ bodyFat, ...m }) => m);
  const navy = baseline({ profile: p, bodyLog: bobBodyLog(), measurements: noManual, now: NOW });
  assert.equal(navy.bodyFatSource, 'navy');
  const est = baseline({ profile: p, bodyLog: bobBodyLog(), measurements: [], now: NOW });
  assert.equal(est.bodyFatSource, 'estimate'); assert.equal(est.bodyFatEstimated, true);
  assert.ok(est.bodyFatPct > 12 && est.bodyFatPct < 30, String(est.bodyFatPct));
  assert.ok(est.missing.includes('bodyFat'));
  const noH = baseline({ profile: { ...p, body: { ...p.body, heightIn: null } }, bodyLog: bobBodyLog(), measurements: noManual, now: NOW });
  // §20b: the one-site Army equation needs only waist + weight, so a body-fat estimate exists without height.
  assert.equal(noH.bodyFatSource, 'estimate'); assert.equal(noH.bodyFatMethod, 'onesite');
  assert.ok(noH.missing.includes('height'));
  assert.equal(noH.ratios.waistToHeight, null);
});

test('baseline: empty / garbage input never throws and has no NaN', () => {
  for (const args of [{}, { profile: null, bodyLog: null, measurements: null }, { profile: { bodyweight: 170 }, bodyLog: [{ d: '2026-10-01', w: 'x' }], measurements: [{ d: '2026-10-01', waist: 'abc' }] }]) {
    const b = baseline({ ...args, now: NOW });
    assert.deepEqual(findBad(b), []);
    assert.ok(Array.isArray(b.missing));
  }
  assert.equal(baseline({ profile: { bodyweight: 170 }, now: NOW }).weightLb, 170);
  assert.equal(baseline({ now: NOW }).comp, null);
});

test('sessionCalories: lift, cardio and class; done vs planned', () => {
  const [lift] = bobPlan(TODAY, 1);
  const k = sessionCalories(lift, { weightLb: 164 });
  assert.ok(k >= 4 * 45 * 0.9 && k <= 6 * 45 * 1.05, String(k));
  assert.ok(sessionCalories(lift, { weightLb: 200 }) > k);
  assert.equal(sessionCalories({ ...lift, status: 'done' }, { weightLb: 164 }), 0);    // nothing completed
  const cardio = { status: 'done', blocks: [{ kind: 'cardio', modality: 'bike', minutes: 60, intensity: 'easy', done: true }] };
  assert.ok(sessionCalories(cardio, { weightLb: 164 }) > 250);
  const cls = { status: 'done', blocks: [{ kind: 'class', duration: 45, done: true, classify: { type: 'hiit', intensity: 'hard', muscles: {} } }] };
  const yoga = { status: 'done', blocks: [{ kind: 'class', duration: 45, done: true, classify: { type: 'yoga', intensity: 'easy', muscles: {} } }] };
  assert.ok(sessionCalories(cls, { weightLb: 164 }) > 2 * sessionCalories(yoga, { weightLb: 164 }));
  assert.equal(sessionCalories({}, {}), 0);
});

test('tdee: NEAT by activity plus exercise', () => {
  const comp = bodyComp({ weightLb: 164, heightIn: 69, bodyFatPct: 22 });
  const sessions = bobPlan('2026-09-21', 4, { status: 'done' });
  const t = tdee({ comp, activity: 'desk', sessions, now: NOW });
  assert.equal(t.bmr, comp.bmr); assert.equal(t.neat, Math.round(comp.bmr * 0.3));
  assert.ok(t.exercise > 80 && t.exercise < 450, String(t.exercise));
  assert.equal(t.total, Math.round(comp.bmr + comp.bmr * 0.3 + t.exercise) || t.total);
  const active = tdee({ comp, activity: 'active', sessions, now: NOW });
  assert.ok(active.total > t.total);
  const none = tdee({ comp, activity: 'desk', sessions: [], now: NOW });
  assert.equal(none.exercise, 0);
  assert.ok(t.total > 2000 && t.total < 2800, String(t.total));
  assert.deepEqual(findBad([t, active, none, tdee({})]), []);
});

test('baseline: L/R limbs, legacy thigh/calf count as both sides, asymmetry notes', () => {
  const meas = [
    { d: '2026-09-01', thigh: 22, calf: 14.5, arm: 13 },                          // legacy = both sides
    { d: '2026-10-10', thighL: 22.5, thighR: 23.25, armL: 13.25 },
    { d: '2026-10-15', calfR: 15 },
  ];
  const b = baseline({ profile: bobProfile(), bodyLog: bobBodyLog(), measurements: meas, now: NOW });
  const l = b.measurements.limbs;
  assert.deepEqual(l, { armL: 13.25, armR: 13, thighL: 22.5, thighR: 23.25, calfL: 14.5, calfR: 15 });
  assert.equal(b.measurements.thigh, 22.88);                // (22.5 + 23.25) / 2, rounded
  assert.equal(b.measurements.calf, 14.75);
  assert.equal(b.measurements.arm, 13.13);
  assert.equal(b.measuredOn.calf, '2026-10-15');
  const sites = b.asymmetry.map(a => a.site).sort();
  assert.deepEqual(sites, ['thigh']);                        // 0.75 > 0.5; calf diff 0.5 is not flagged
  assert.match(b.asymmetry[0].note, /right thigh/);
  // only legacy values → both sides equal, no asymmetry
  const leg = baseline({ profile: bobProfile(), bodyLog: bobBodyLog(), measurements: bobMeas(), now: NOW });
  assert.equal(leg.measurements.limbs.thighL, 22); assert.equal(leg.measurements.limbs.thighR, 22);
  assert.equal(leg.measurements.thigh, 22);
  assert.deepEqual(leg.asymmetry, []);
  // one side only → used as the site value
  const one = baseline({ profile: bobProfile(), bodyLog: bobBodyLog(), measurements: [{ d: '2026-10-01', calfL: 15 }], now: NOW });
  assert.equal(one.measurements.calf, 15); assert.equal(one.measurements.limbs.calfR, null);
  assert.deepEqual(findBad([b, leg, one]), []);
});

test('baseline: body-fat sources, spread and uncertainty; RFM estimate when only waist is known', () => {
  near(rfmBodyFat({ sex: 'male', heightIn: 69, waistIn: 33.5 }), 64 - 20 * 69 / 33.5, 0.06);
  near(rfmBodyFat({ sex: 'female', heightIn: 64, waistIn: 30 }), 76 - 20 * 64 / 30, 0.06);
  assert.equal(rfmBodyFat({ heightIn: 69 }), null);
  assert.ok(bmiBodyFat({ weightLb: 164, heightIn: 69, age: 39 }) > 15);
  const p = bobProfile();
  const all = baseline({ profile: p, bodyLog: bobBodyLog(), measurements: bobMeas(), now: NOW });
  assert.equal(all.bodyFatMethod, 'manual');
  for (const k of ['manual', 'navy', 'rfm', 'bmi']) assert.ok(all.bodyFatSources[k] > 5, k);
  const vals = Object.values(all.bodyFatSources);
  near(all.bodyFatSpread, Math.max(...vals) - Math.min(...vals), 0.11);
  // §20b: an entered value with no method counts as a DXA scan (the reference scale): ±2, not widened by tape disagreement.
  assert.equal(all.bodyFatUncertainty, 2);
  assert.ok(all.bodyFatRange.low < 22 && all.bodyFatRange.high > 22);
  assert.match(all.bodyFatNote, /Navy/);
  // waist but no neck → RFM estimate (not the BMI formula)
  const waistOnly = baseline({ profile: p, bodyLog: bobBodyLog(), measurements: [{ d: '2026-10-18', waist: 33.5 }], now: NOW });
  // §20b: waist + weight + height → one-site Army, RFM and Deurenberg are blended on the DXA scale (was RFM alone, 22.8).
  assert.equal(waistOnly.bodyFatSource, 'estimate'); assert.equal(waistOnly.bodyFatMethod, 'blend');
  near(waistOnly.bodyFatSources.rfm, 22.8 - 0.5, 0.11);
  assert.ok(waistOnly.bodyFatPct > 20 && waistOnly.bodyFatPct < 26, String(waistOnly.bodyFatPct));
  assert.ok(waistOnly.bodyFatUncertainty >= 3.5);
  const none = baseline({ profile: p, bodyLog: bobBodyLog(), measurements: [], now: NOW });
  assert.equal(none.bodyFatMethod, 'bmi'); assert.equal(none.bodyFatSpread, null); assert.ok(none.bodyFatUncertainty >= 5);
  assert.deepEqual(findBad([all, waistOnly, none]), []);
});
