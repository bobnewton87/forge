// One canonical body-fat scale, DXA-equivalent (CONTRACT §20b, docs/research/body-fat-dxa-scale.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { baseline, oneSiteBodyFat, toDxaScale, navyBodyFat, rfmBodyFat, BF_DXA } from '../js/engine/bodycomp.js';
import { project, FFMI_NATURAL_CEILING } from '../js/engine/projection.js';
import { BODY, ffmiBand } from '../js/engine/sex.js';
import { bobProfile, bobPlan, NOW } from './body-fixtures.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
// Bob's tape fixture: 69 in, 164 lb, waist 34.5 (navel), neck 15, born 1987 (39).
const bob = (extra = {}) => baseline({ profile: bobProfile(), bodyLog: [{ d: '2026-10-15', w: 164 }],
  measurements: [{ d: '2026-10-15', waist: 34.5, neck: 15, ...extra }], now: NOW });

test('one-site Army equations (Taylor 2024): male and female coefficients, men 40+ bias correction', () => {
  near(oneSiteBodyFat({ sex: 'male', waistIn: 34.5, weightLb: 164 }), -27.05 + 2.06 * 34.5 - 0.12 * 164, 0.06);
  near(oneSiteBodyFat({ sex: 'female', waistIn: 30, weightLb: 140 }), -8.06 + 1.25 * 30 - 0.004 * 140, 0.06);
  near(oneSiteBodyFat({ sex: 'male', waistIn: 34.5, weightLb: 164, age: 45 }), oneSiteBodyFat({ sex: 'male', waistIn: 34.5, weightLb: 164 }) - 1, 0.06);
  assert.equal(oneSiteBodyFat({ sex: 'male', waistIn: 34.5 }), null);
});

test('formula offsets onto the DXA scale: Navy +3 (men) / +1.7 (women), RFM −0.5 / −0.9, Deurenberg 0; manual by method', () => {
  assert.equal(toDxaScale('navy', 18, 'male'), 21); near(toDxaScale('navy', 25, 'female'), 26.7, 1e-9);
  assert.equal(toDxaScale('rfm', 24, 'male'), 23.5); near(toDxaScale('rfm', 30, 'female'), 29.1, 1e-9);
  assert.equal(toDxaScale('bmi', 22, 'male'), 22);
  assert.equal(toDxaScale('manual', 18, 'male', 'bia'), 21.5); assert.equal(toDxaScale('manual', 25, 'female', 'bia'), 29);
  assert.equal(toDxaScale('manual', 12, 'male', 'calipers'), 15); assert.equal(toDxaScale('manual', 22, 'male', 'dxa'), 22);
  assert.equal(toDxaScale('manual', 22, 'male', undefined), 22, 'unspecified = DXA');
});

test("Bob's tape fixture: ~22-24 % DXA-equivalent, a blend with a ±3.5 likely range and ±7 at 95 %", () => {
  const b = bob();
  assert.equal(b.bodyFatScale, 'dxa'); assert.equal(b.bodyFatMethod, 'blend');
  assert.ok(b.bodyFatPct >= 22 && b.bodyFatPct <= 24, String(b.bodyFatPct));
  assert.equal(b.bodyFatUncertainty, 3.5);
  near(b.bodyFatRange.high - b.bodyFatRange.low, 7, 0.11); near(b.bodyFatRange95.high - b.bodyFatRange95.low, 14, 0.11);
  // every source is reported on the DXA scale, the raw formula outputs separately
  assert.equal(b.bodyFatSourcesRaw.navy, navyBodyFat({ sex: 'male', heightIn: 69, neckIn: 15, waistIn: 34.5 }));
  near(b.bodyFatSources.navy, b.bodyFatSourcesRaw.navy + 3, 0.06);
  near(b.bodyFatSources.rfm, rfmBodyFat({ sex: 'male', heightIn: 69, waistIn: 34.5 }) - 0.5, 0.06);
  near(b.bodyFatSources.onesite, 24.3, 0.06);
  // inverse-variance blend reproduces the reported value
  const ws = Object.entries(b.bodyFatSources).filter(([, v]) => v != null).map(([k, v]) => [v, 1 / BF_DXA.se[k].male ** 2]);
  near(b.bodyFatPct, ws.reduce((a, [v, w]) => a + v * w, 0) / ws.reduce((a, [, w]) => a + w, 0), 0.06);
  assert.match(b.bodyFatNote, /DXA-equivalent/); assert.match(b.bodyFatNote, /95%/);
});

test('manual entries: DXA used as-is (±2); smart-scale and caliper readings converted and blended', () => {
  const dxa = bob({ bodyFat: 20, bodyFatMethod: 'dxa' });
  assert.equal(dxa.bodyFatPct, 20); assert.equal(dxa.bodyFatMethod, 'manual'); assert.equal(dxa.bodyFatUncertainty, 2);
  const bia = bob({ bodyFat: 18, bodyFatMethod: 'bia' });
  assert.equal(bia.bodyFatSources.manual, 21.5); assert.equal(bia.bodyFatMethod, 'blend'); assert.equal(bia.bodyFatSource, 'manual');
  assert.ok(bia.bodyFatPct > 21 && bia.bodyFatPct < 24); assert.match(bia.bodyFatNote, /smart-scale/);
  const cal = bob({ bodyFat: 12, bodyFatMethod: 'calipers' });
  assert.equal(cal.bodyFatSources.manual, 15); assert.equal(cal.bodyFatManualMethod, 'calipers');
});

test('BF-dependent constants are on the DXA scale', () => {
  assert.equal(FFMI_NATURAL_CEILING, 24.2); assert.equal(BODY.male.ffmiCeiling, 24.2);
  assert.equal(BODY.male.essentialBf, 5); assert.equal(BODY.male.defendedBf, 6);   // Friedl 1994 DXA 4-6 %; Pardue 2017 5.1 % DXA
  assert.equal(BODY.male.goalBodyFat, 15);
  assert.deepEqual(ffmiBand(24.5, 'male'), ['Rare without drugs', 'warn']); assert.deepEqual(ffmiBand(22, 'male'), ['Very muscular', 'good']);
  const r = project({ baseline: bob(), profile: bobProfile(), sessions: bobPlan('2026-10-19', 4), weeks: 52, now: NOW });
  const by = Object.fromEntries(r.milestones.map(m => [m.id, m]));
  assert.equal(by.abs_upper.target, 15); assert.equal(by.six_pack.target, 13); assert.equal(by.goal_bf.target, 15);
  assert.equal(by.ffmi_22.target, 21.3); assert.equal(by.ffmi_23.target, 22.2);
  assert.match(by.lean_vs_race.label, /9\.5%/);
  assert.match(r.assumptions.join(' '), /DXA-equivalent/);
  // a saved goal is never changed, but a low one gets a note
  const saved = project({ baseline: bob(), profile: bobProfile({ body: { ...bobProfile().body, goalBodyFat: 12 } }), sessions: bobPlan('2026-10-19', 4), weeks: 52, now: NOW });
  const g = saved.milestones.find(m => m.id === 'goal_bf');
  assert.equal(g.target, 12); assert.match(g.note, /DXA-equivalent is about 15%/);
});
