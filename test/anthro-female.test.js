// Female anthropometry (CONTRACT §21): ANSUR II female segment ratios, bust / natural-waist / hips landmarks,
// girth fitting, per-side bone overrides, and the male path left untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyGeometry, perimeter, proportions, boneFromTape, tapeFromBone, HEIGHTS, HEIGHTS_FEMALE, SEGMENT_RATIOS_FEMALE, BONE_RATIOS_FEMALE,
  LENGTH_NORMS, LANDMARK_OFFSETS } from '../js/engine/anthro.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const pct = (a, b) => Math.abs(a / b - 1) * 100;
const TYPICAL = { sex: 'female', heightIn: 64, neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14, bodyFatPct: 29 };
const ATHLETIC = { sex: 'female', heightIn: 66, neck: 12.5, shoulders: 40.5, chest: 34, waist: 25.5, hips: 36.5, arm: 11.5, forearm: 9.5, thigh: 21, calf: 14, bodyFatPct: 20 };

test('female tables come from ANSUR II female (n = 1,986) via ratio-of-ratios, with direct bust / natural-waist sites', () => {
  // direct [AN2F] values
  assert.equal(HEIGHTS_FEMALE.chest, 0.719);          // bust point (ANSUR chest height, women)
  assert.equal(HEIGHTS_FEMALE.waist, 0.628);          // WHO natural waist (10th rib / iliac crest midpoint)
  near(HEIGHTS_FEMALE.navel, 0.6004, 1e-4, 'navel');
  // skeletal heights: male value × RoR
  near(HEIGHTS_FEMALE.hipJoint, 0.530 * 1.0135, 1e-4, 'hip joint (trochanterion RoR)');
  near(HEIGHTS_FEMALE.knee, 0.285 * 1.0081, 1e-4, 'knee (tibiale RoR)');
  near(HEIGHTS_FEMALE.acromion, 0.818 * 0.9991, 1e-4, 'acromion');
  near(HEIGHTS_FEMALE.ankle, 0.039 * 0.9306, 1e-4, 'ankle (lateral malleolus RoR)');
  // women: proportionally longer legs, lower bust point than the male nipple, natural waist above the navel
  assert.ok(HEIGHTS_FEMALE.hipJoint > HEIGHTS.hipJoint && HEIGHTS_FEMALE.crotch < HEIGHTS.crotch + 0.001);
  assert.ok(HEIGHTS_FEMALE.waist - HEIGHTS_FEMALE.navel > 0.02);
  // segment ratios and bones scaled by the matching RoR
  near(SEGMENT_RATIOS_FEMALE.thigh, 0.245 * 1.0198, 1e-4); near(SEGMENT_RATIOS_FEMALE.shank, 0.246 * 1.0234, 1e-4);
  near(BONE_RATIOS_FEMALE.upperArm, 0.1618 * 0.9905, 1e-4);
  const P = proportions('female');
  assert.equal(P.sex, 'female');
  near(P.lengthNorms.upperArm.median, 0.2050, 1e-9); near(P.lengthNorms.thigh.median, 0.2505, 1e-9); near(P.lengthNorms.shank.median, 0.2300, 1e-9);
  assert.equal(proportions('male').heights, HEIGHTS);
  assert.equal(proportions('male').lengthNorms, LENGTH_NORMS);
  assert.equal(proportions().landmarkOffsets, LANDMARK_OFFSETS);
});

test('no "male ratios" warning for women any more, and typical female tapes raise no sanity warnings', () => {
  for (const b of [TYPICAL, ATHLETIC, { sex: 'female' }]) {
    const g = bodyGeometry(b);
    assert.equal(g.sex, 'female');
    assert.ok(!g.warnings.some(w => /male segment ratios/i.test(w)), g.warnings.join('|'));
    if (b.chest) assert.deepEqual(g.warnings, [], `${JSON.stringify(b)}: ${g.warnings.join('|')}`);
  }
  // an hourglass 36-24-36 (hips 1.5 × waist) is normal for a woman, a male hips/waist warning would fire
  assert.deepEqual(bodyGeometry({ sex: 'female', heightIn: 65, chest: 36, waist: 24, hips: 36, bodyFatPct: 25 }).warnings, []);
  assert.ok(bodyGeometry({ heightIn: 65, chest: 36, waist: 24, hips: 36, bodyFatPct: 25 }).warnings.some(w => /Hips/.test(w)));
});

test('female landmarks: bust at the bust point, natural waist above the navel, hips at the widest, every tape reproduced', () => {
  for (const b of [TYPICAL, ATHLETIC]) {
    const g = bodyGeometry(b), L = g.landmarks, H = b.heightIn;
    near(L.chest.y / H, 0.719, 0.002, 'bust height');
    near(L.waist.y / H, 0.628, 0.002, 'natural waist height');
    near(g.heights.navel / H, 0.6004, 0.002, 'navel height');
    assert.ok(L.waist.y - g.heights.navel > 1.5 && L.waist.y - g.heights.navel < 2.3, `waist ${L.waist.y} navel ${g.heights.navel}`);
    assert.ok(L.underbust.y < L.chest.y - 2 && L.underbust.y > L.waist.y, `fold ${L.underbust.y}`);
    near(L.hip.y / H, 0.5116, 0.002, 'hips height');
    for (const [k, site] of [['chest', 'chest'], ['waist', 'waist'], ['hip', 'hips'], ['neck', 'neck'], ['thigh', 'thigh'], ['calf', 'calf'], ['shoulder', 'shoulders']]) {
      const lm = L[k];
      assert.ok(pct(perimeter(lm.rx, lm.rz, lm.n), b[site]) < 1, `${k}: ${perimeter(lm.rx, lm.rz, lm.n)} vs ${b[site]}`);
    }
    // hips are wider than deep (gynoid; [AN2F] buttock depth / hip breadth 0.654) and wider than the bust
    assert.ok(L.hip.rz / L.hip.rx < 0.75 && L.hip.rx > L.chest.rx);
  }
});

test('underbust: a model value from bust and body fat (cup grows with fat), or the tape when given', () => {
  const g = bodyGeometry(TYPICAL);
  near(g.landmarks.chest.girth / g.landmarks.underbust.girth, 1 / (0.862 + 0.0035 * (28 - 29)), 0.01, 'bust / underbust');
  assert.equal(g.derived.underbustSource, 'model');
  const lean = bodyGeometry({ ...TYPICAL, bodyFatPct: 20 }), heavy = bodyGeometry({ ...TYPICAL, bodyFatPct: 38 });
  assert.ok(lean.landmarks.underbust.girth > g.landmarks.underbust.girth && heavy.landmarks.underbust.girth < g.landmarks.underbust.girth);
  const t = bodyGeometry({ ...TYPICAL, underbust: 29.5 });
  near(t.landmarks.underbust.girth, 29.5, 0.01, 'underbust tape'); assert.equal(t.derived.underbustSource, 'tape');
  assert.ok(bodyGeometry({ ...TYPICAL, underbust: 36 }).warnings.some(w => /Underbust/.test(w)));
});

test('female default (ratio) skeleton reproduces the ANSUR II female length medians', () => {
  const H = 64, g = bodyGeometry({ sex: 'female', heightIn: H, chest: 35, waist: 29, hips: 39 });
  // tape lengths implied by the ratio skeleton (bone + landmark offset) vs [AN2F] medians × stature
  near(g.lengths.upperArmL / H, 0.2050, 0.004, 'shoulder-elbow');
  near(g.lengths.forearmL / H, 0.1550, 0.004, 'olecranon-ulnar styloid');
  near(g.lengths.thighL / H, 0.2505, 0.003, 'trochanterion-tibiale');
  near(g.lengths.shankL / H, 0.2300, 0.003, 'tibiale-lateral malleolus');
  near(g.joints.hipL.y / H, 0.5372, 0.002, 'hip joint'); near(g.joints.kneeL.y / H, 0.2873, 0.002, 'knee joint');
  near(g.heights.fingertip / H, 0.3809, 0.006, 'fingertip');
  near((H - g.landmarks.chin.y) / H, 0.1322, 0.002, 'head height (vertex - menton)');
});

test('female per-side bone lengths still override the ratios (and use the female landmark offsets)', () => {
  const lengths = { upperArmL: 12.9, upperArmR: 13.4, thighL: 16.0, thighR: 16.3, shankL: 14.6, shankR: 14.6, forearmL: 9.9 };
  const g = bodyGeometry({ ...TYPICAL, lengths });
  for (const k of ['upperArmL', 'upperArmR', 'thighL', 'thighR', 'shankL', 'shankR', 'forearmL']) {
    near(g.bones[k], boneFromTape(k.slice(0, -1), lengths[k], 64, 'female'), 0.06, k);
    assert.equal(g.lengthSource[k], 'measured');
  }
  assert.equal(g.lengthSource.forearmR, 'mirrored');
  assert.ok(g.asymmetry.some(a => a.segment === 'upperArm' && a.longer === 'right'));
  near(tapeFromBone('thigh', boneFromTape('thigh', 16, 64, 'female'), 64, 'female'), 16, 1e-9);
  // the offsets differ (slightly) by sex
  assert.notEqual(boneFromTape('upperArm', 13, 64, 'female'), boneFromTape('upperArm', 13, 64, 'male'));
  // implausible lengths are clamped with a female-range warning
  assert.ok(bodyGeometry({ ...TYPICAL, lengths: { upperArmL: 17 } }).warnings.some(w => /upper arm length/.test(w)));
});

test('shoulder frame: female ANSUR median shoulder tape gives the median-relative biacromial the male model gives', () => {
  // [AN2F] median shoulder circumference 40.4 in ↔ biacromial 14.37 in; male 46.3 ↔ 16.34 (the loop reads ≈ 6 % narrow for both)
  const f = bodyGeometry({ sex: 'female', heightIn: 64, shoulders: 40.4, chest: 37, bodyFatPct: 28 }).breadths.biacromial / 14.37;
  const m = bodyGeometry({ heightIn: 69, shoulders: 46.3, chest: 41.6, bodyFatPct: 20 }).breadths.biacromial / 16.34;
  near(f, m, 0.015, 'relative biacromial');
});

test('male geometry is unchanged by the female work', () => {
  const g = bodyGeometry({ heightIn: 69, neck: 15, shoulders: 46, chest: 39, waist: 34.5, hips: 38, arm: 13.5, forearm: 11.5, thigh: 22, calf: 14.5, bodyFatPct: 19 });
  assert.equal(g.sex, 'male');
  assert.equal(g.heights.navel, g.landmarks.waist.y);   // men tape the waist at the navel
  assert.equal(g.derived.underbustSource, undefined);
  near(g.landmarks.chest.y, 0.720 * 69, 1e-9, 'male chest height (D&C)');
  near(bodyGeometry({ heightIn: 69, shoulders: 46.3, chest: 41.6, bodyFatPct: 20 }).breadths.biacromial, 15.40, 0.01, 'male biacromial (pre-female value)');
  assert.equal(HEIGHTS.chest, 0.720); assert.equal(HEIGHTS.waist, 0.600);
});
