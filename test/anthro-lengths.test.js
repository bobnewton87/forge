// §16c per-side segment lengths (ANTHRO-2): tape → joint-centre bones, per-side joints, stature
// consistency, plausibility warnings, and the baseline → projection → 3D pass-through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyGeometry, perimeter, crossSectionAt, boneFromTape, tapeFromBone, LENGTH_FIELDS, LENGTH_NORMS, LANDMARK_OFFSETS } from '../js/engine/anthro.js';
import { baseline } from '../js/engine/bodycomp.js';
import { project } from '../js/engine/projection.js';
import { BOB, LEAN, TALL, ALL, SITE_LM } from './anthro-fixtures.js';
import { bobProfile, bobBodyLog, bobMeas, bobPlan, NOW, TODAY } from './body-fixtures.js';

const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const seg = k => k.slice(0, -1);
function walkNumbers(o, path, out) {
  if (typeof o === 'number') { if (!Number.isFinite(o)) out.push(path); return out; }
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walkNumbers(v, `${path}.${k}`, out);
  return out;
}
// Bob-ish tapes with a deliberate right-side bias.
const LEN = { upperArmL: 14.2, upperArmR: 14.5, forearmL: 11.0, forearmR: 11.1, thighL: 17.0, thighR: 17.4, shankL: 15.6, shankR: 15.5 };

test('given tape lengths reproduce joint-centre bones within ±2% after the landmark offsets', () => {
  for (const [name, base] of Object.entries({ BOB, LEAN, TALL })) {
    const H = base.heightIn;
    // scale the tapes with stature so every fixture gets plausible inputs
    const L = Object.fromEntries(Object.entries(LEN).map(([k, v]) => [k, Math.round(v * H / 69 * 10) / 10]));
    const g = bodyGeometry({ ...base, lengths: L });
    for (const k of LENGTH_FIELDS) {
      const want = boneFromTape(seg(k), L[k], H);
      assert.ok(rel(g.bones[k], want) < 0.02, `${name} ${k}: bone ${g.bones[k].toFixed(3)} vs ${want.toFixed(3)}`);
      assert.ok(rel(g.bones[k], want) < 0.002, `${name} ${k} should be essentially exact`);
      assert.equal(g.lengthSource[k], 'measured');
      assert.equal(g.lengths[k], L[k]);
    }
    assert.deepEqual(g.warnings, [], `${name} warnings: ${g.warnings.join(' | ')}`);
    assert.ok(!g.estimated.some(e => LENGTH_FIELDS.includes(e)));
  }
  // offsets round-trip and are documented in inches for this stature
  assert.ok(Math.abs(tapeFromBone('thigh', boneFromTape('thigh', 17, 69), 69) - 17) < 1e-12);
  const g = bodyGeometry({ ...BOB, lengths: LEN });
  for (const s of Object.keys(LANDMARK_OFFSETS)) assert.ok(Math.abs(g.landmarkOffsets[s] - LANDMARK_OFFSETS[s] * 69) < 1e-12);
});

test('L ≠ R gives per-side joints, pelvic obliquity and asymmetry entries; stature stays fixed', () => {
  const g0 = bodyGeometry(BOB), g = bodyGeometry({ ...BOB, lengths: LEN });
  const j = g.joints;
  assert.ok(j.elbowR.y < j.elbowL.y, 'longer right upper arm → lower right elbow');
  assert.ok(j.wristR.y < j.wristL.y);
  assert.ok(j.hipR.y > j.hipL.y, 'longer right leg → higher right hip');
  assert.ok(Math.abs(j.kneeL.y - j.kneeR.y - (g.bones.shankL - g.bones.shankR)) < 0.01);
  assert.ok(g.pelvis.obliquityIn < 0 && g.pelvis.tiltDeg < 0 && Math.abs(g.pelvis.obliquityIn - (j.hipL.y - j.hipR.y)) < 1e-12);
  assert.equal(j.shoulderL.y, j.shoulderR.y, 'shoulders stay level');
  // the head and stature are untouched; the pelvis joint follows the mean hip height
  assert.equal(g.landmarks.vertex.y, 69);
  assert.equal(g.landmarks.chin.y, g0.landmarks.chin.y);
  assert.deepEqual(g.head, g0.head);
  assert.ok(Math.abs(j.pelvis.y - (j.hipL.y + j.hipR.y) / 2) < 1e-9);
  // asymmetry: > 0.25 in only (forearm 0.1 and shank 0.1 are not listed)
  const segs = g.asymmetry.map(a => a.segment).sort();
  assert.deepEqual(segs, ['leg', 'thigh', 'upperArm']);
  const th = g.asymmetry.find(a => a.segment === 'thigh');
  assert.equal(th.longer, 'right'); assert.equal(th.diffIn, 0.4);
  assert.match(th.note, /^Right thigh 0\.4 in longer than left/);
  // per-side profiles follow their own joints
  assert.ok(Math.abs(g.profiles.legL.find(p => p.name === 'knee').y - j.kneeL.y) < 1e-9);
  assert.ok(Math.abs(g.profiles.legR.find(p => p.name === 'knee').y - j.kneeR.y) < 1e-9);
  assert.ok(Math.abs(g.profiles.armR.find(p => p.name === 'elbow').y - j.elbowR.y) < 1e-9);
  // everything stays ordered top to bottom
  for (const prof of Object.values(g.profiles)) for (let i = 1; i < prof.length; i++) assert.ok(prof[i].y > prof[i - 1].y);
  for (const S of ['L', 'R']) assert.ok(j.head.y > j.neck.y && j.neck.y > j['shoulder' + S].y && j['shoulder' + S].y > j['elbow' + S].y && j['elbow' + S].y > j['wrist' + S].y && j['hip' + S].y > j['knee' + S].y && j['knee' + S].y > j['ankle' + S].y);
});

test('missing lengths come from the ratio skeleton; one side mirrors the other', () => {
  const g0 = bodyGeometry(BOB);
  // no lengths: identical skeleton to the girth-only model, symmetric, nothing listed as estimated
  assert.deepEqual(g0.estimated, []);
  for (const k of LENGTH_FIELDS) {
    assert.equal(g0.lengthSource[k], 'ratio');
    assert.ok(Math.abs(g0.lengths[k] - tapeFromBone(seg(k), g0.bones[k], 69)) < 1e-12);
    assert.equal(g0.bones[k], g0.bones[seg(k)]);
  }
  assert.deepEqual(g0.asymmetry, []);
  assert.equal(g0.pelvis.obliquityIn, 0);
  // the ratio skeleton's implied tapes sit on the ANSUR II medians at median stature (±2%)
  const gm = bodyGeometry({ ...BOB, heightIn: 69.1 });
  for (const s of ['upperArm', 'forearm', 'thigh', 'shank']) assert.ok(rel(gm.lengths[s + 'L'], LENGTH_NORMS[s].median * 69.1) < 0.02, `${s} ${gm.lengths[s + 'L']}`);
  assert.ok(rel(gm.lengths.upperArmL, 14.29) < 0.01 && rel(gm.lengths.thighL, 16.97) < 0.01 && rel(gm.lengths.shankL, 15.55) < 0.01);
  // only the left upper arm: right mirrors it, the rest is ratio (and listed)
  const g1 = bodyGeometry({ ...BOB, lengths: { upperArmL: 15 } });
  assert.equal(g1.lengthSource.upperArmR, 'mirrored');
  assert.ok(rel(g1.bones.upperArmR, boneFromTape('upperArm', 15, 69)) < 0.002);
  assert.ok(g1.estimated.includes('upperArmR') && g1.estimated.includes('thighL') && !g1.estimated.includes('upperArmL'));
  assert.equal(g1.lengthSource.thighL, 'ratio');
  // arms only: legs and torso keep the exact ratio heights
  assert.equal(g1.joints.hipL.y, g0.joints.hipL.y);
  assert.equal(g1.joints.kneeR.y, g0.joints.kneeR.y);
  assert.equal(g1.landmarks.waist.y, g0.landmarks.waist.y);
  assert.equal(g1.joints.shoulderL.y, g0.joints.shoulderL.y);
  // store-style keys and shape.lengths are accepted too
  const g2 = bodyGeometry({ shape: { ...BOB, lengths: { lenThighL: 17.5, lenThighR: 17.5 } } });
  assert.equal(g2.lengthSource.thighL, 'measured');
  assert.ok(rel(g2.bones.thighR, boneFromTape('thigh', 17.5, 69)) < 0.002);
  // longer legs at the same stature: hips rise, the trunk compresses, the head stays
  assert.ok(g2.joints.hipL.y > g0.joints.hipL.y && g2.landmarks.waist.y > g0.landmarks.waist.y && g2.landmarks.waist.y < g0.landmarks.chest.y);
  assert.equal(g2.landmarks.chin.y, g0.landmarks.chin.y);
});

test('inconsistent or implausible inputs → warnings, clamping, never NaN', () => {
  // legs far too long for a 64 in stature
  const tall = bodyGeometry({ heightIn: 64, lengths: { thighL: 19, thighR: 19, shankL: 18, shankR: 18 } });
  assert.ok(tall.warnings.some(w => /long for a 64 in stature/.test(w)), tall.warnings.join(' | '));
  assert.ok(tall.joints.hipL.y <= 0.585 * 64 + 1e-6, `hip ${tall.joints.hipL.y}`);
  assert.ok(tall.joints.neck.y < tall.joints.head.y && tall.joints.pelvis.y < tall.joints.neck.y);
  // plausible per segment but too long together → the stature check scales the legs
  const sum = bodyGeometry({ heightIn: 66, lengths: { thighL: 18.8, thighR: 18.8, shankL: 16.7, shankR: 16.7 } });
  assert.ok(sum.warnings.some(w => /hip joints/.test(w)), sum.warnings.join(' | '));
  assert.ok(sum.pelvis.legScale < 1 && Math.abs(sum.joints.hipL.y - 0.585 * 66) < 0.01);
  // huge left/right leg difference: pelvis tilt capped at 0.8 in, longer knee flexes, bones honoured
  const lld = bodyGeometry({ ...BOB, lengths: { thighL: 17, thighR: 18.4, shankL: 15.5, shankR: 15.5 } });
  assert.ok(Math.abs(Math.abs(lld.pelvis.obliquityIn) - 0.8 * 69 / 69.1) < 0.01, `obliquity ${lld.pelvis.obliquityIn}`);
  assert.ok(lld.pelvis.kneeFlexIn.R > 0 && lld.pelvis.kneeFlexIn.L === 0);
  assert.ok(lld.joints.kneeR.z > lld.joints.kneeL.z);
  assert.ok(rel(lld.bones.thighR, boneFromTape('thigh', 18.4, 69)) < 0.002 && rel(lld.bones.shankR, boneFromTape('shank', 15.5, 69)) < 0.002);
  assert.ok(lld.warnings.some(w => /right leg measures/.test(w)));
  // garbage, units mistakes and absurd values
  const junk = bodyGeometry({ ...BOB, lengths: { upperArmL: 'abc', upperArmR: -3, forearmL: 0, forearmR: 120, thighL: NaN, thighR: '', shankL: null, shankR: 3 } });
  assert.ok(junk.warnings.some(w => /forearmR length 120 in was ignored/.test(w)));
  assert.ok(junk.warnings.some(w => /shankR length 3 in was ignored/.test(w)));
  assert.ok(LENGTH_FIELDS.every(k => junk.lengthSource[k] === 'ratio'));
  const tiny = bodyGeometry({ ...BOB, lengths: { upperArmL: 9, upperArmR: 9 } });
  assert.ok(tiny.warnings.some(w => /Left upper arm length 9 in is short/.test(w)));
  assert.ok(tiny.lengths.upperArmL >= LENGTH_NORMS.upperArm.range[0] * 69 - 1e-9);
  for (const g of [tall, sum, lld, junk, tiny]) assert.deepEqual(walkNumbers(g, 'g', []), []);
  // fuzz
  let seed = 777;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 80; i++) {
    const H = 58 + 26 * rnd(), L = {};
    for (const k of LENGTH_FIELDS) if (rnd() < 0.7) L[k] = Math.round((4 + 26 * rnd()) * 10) / 10;
    const g = bodyGeometry({ heightIn: H, waist: 30 + 10 * rnd(), lengths: L });
    assert.deepEqual(walkNumbers(g, 'g', []), [], `fuzz ${i}`);
    assert.ok(g.joints.hipL.y <= 0.585 * H + 1e-6 && g.joints.hipR.y <= 0.585 * H + 0.8 * H / 69.1 + 1e-6);
    assert.ok(Math.abs(g.pelvis.obliquityIn) <= 0.8 * H / 69.1 + 1e-6);
  }
});

test('girth fidelity is unchanged when lengths are given', () => {
  for (const [name, input] of Object.entries(ALL)) {
    const g0 = bodyGeometry(input), g = bodyGeometry({ ...input, lengths: LEN });
    for (const [site, lm] of Object.entries(SITE_LM)) {
      const L = g.landmarks[lm], P = perimeter(L.rx, L.rz, L.n);
      assert.ok(rel(P, g.inputs[site]) < 0.01, `${name} ${site}: ${P} vs ${g.inputs[site]}`);
      assert.ok(rel(P, g0.landmarks[lm].girth) < 1e-9, `${name} ${site} girth changed`);
    }
    // per-side sections at the (moved) tape heights still reproduce the tapes
    assert.ok(rel(crossSectionAt(g, g.profiles.legL.find(p => p.name === 'thigh').y, 'thighL').girth, g.inputs.thigh) < 0.01);
    assert.ok(rel(crossSectionAt(g, g.profiles.legR.find(p => p.name === 'calf').y, 'calfR').girth, g.inputs.calf) < 0.01);
  }
});

test('baseline exposes lengths + length asymmetry; projection and shapeOf pass them through', async () => {
  const meas = [...bobMeas(), { d: '2026-10-18', lenUpperArmL: 14.2, lenUpperArmR: 14.3, lenThighL: 17.0, lenThighR: 17.4, lenShankL: 15.6 }];
  const merged = [{ ...meas[0], ...meas[1] }];
  const later = [...merged, { d: '2026-10-19', lenShankR: 15.5 }];
  const b = baseline({ profile: bobProfile(), bodyLog: bobBodyLog(), measurements: later, now: NOW });
  assert.deepEqual(b.measurements.lengths, { upperArmL: 14.2, upperArmR: 14.3, forearmL: null, forearmR: null, thighL: 17, thighR: 17.4, shankL: 15.6, shankR: 15.5 });
  assert.equal(b.measuredOn.lenShankR, '2026-10-19');
  assert.deepEqual(b.lengthAsymmetry.map(a => a.segment), ['thigh']);
  assert.match(b.lengthAsymmetry[0].note, /^Right thigh 0\.4 in longer than left/);
  assert.equal(b.lengthAsymmetry[0].diffIn, 0.4);
  assert.ok(Array.isArray(b.asymmetry) && b.asymmetry.every(a => a.site));   // girth list untouched
  // projection: every series point carries the static lengths; the model math is unchanged
  const profile = bobProfile();
  const args = { profile, sessions: bobPlan(TODAY, 2), weeks: 12, now: NOW };
  const r = project({ baseline: b, ...args });
  const b0 = baseline({ profile, bodyLog: bobBodyLog(), measurements: bobMeas(), now: NOW });
  const r0 = project({ baseline: b0, ...args });
  const want = { upperArmL: 14.2, upperArmR: 14.3, thighL: 17, thighR: 17.4, shankL: 15.6, shankR: 15.5 };
  for (const p of r.series) assert.deepEqual(p.shape.lengths, want);
  assert.ok(r0.series.every(p => !('lengths' in p.shape)));
  assert.deepEqual(r.series.map(p => [p.weightLb, p.leanLb, p.fatLb, p.shape.waist, p.shape.arm, JSON.stringify(p.muscle)]),
    r0.series.map(p => [p.weightLb, p.leanLb, p.fatLb, p.shape.waist, p.shape.arm, JSON.stringify(p.muscle)]));
  // the renderer helper (DOM-free part of js/ui/projection.js) forwards them; anthro honours them
  globalThis.window ??= undefined;
  const ui = await import('../js/ui/projection.js').catch(() => null);
  if (ui && typeof ui.shapeOf === 'function') {
    const sh = ui.shapeOf(r.series[3], 69);
    assert.deepEqual(sh.lengths, want);
    assert.deepEqual(ui.shapeOf({ measurements: b.measurements }, 69).lengths, want);   // nulls dropped
    assert.equal(ui.shapeOf(r0.series[0], 69).lengths, undefined);
    const g = bodyGeometry({ ...sh, bodyFatPct: 20 });
    assert.equal(g.lengthSource.thighR, 'measured');
    assert.equal(g.lengthSource.forearmL, 'ratio');
  }
});
