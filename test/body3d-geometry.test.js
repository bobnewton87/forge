// MODEL-3D: the 3D physique must be to scale. These tests sample the SAME signed-distance field the
// WebGL shader draws (the SDF is written once in a GLSL/JS dialect inside js/ui/body3d-sdf.js) and compare
// it with the shared anthropometric geometry (js/engine/anthro.js): every tape girth at its landmark
// height (±3%; the arm both flexed in the double-biceps pose and relaxed = flexed / flex.arm when hanging),
// landmark heights and joint-centre bone lengths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBodyGeometry, measureGirths, measureLandmarks, anthroTargets, GIRTH_KEYS, PARAMS } from '../js/ui/body3d-sdf.js';

const BODIES = {
  bob: { shape: { heightIn: 69, neck: 15, shoulders: 46, chest: 39, waist: 34.5, hips: 38, arm: 13.5, forearm: 11.5, thigh: 22, calf: 14.5 }, bf: 18, muscle: null },
  lean: { shape: { heightIn: 69, neck: 15.5, shoulders: 50, chest: 41.5, waist: 30.5, hips: 37, arm: 15, forearm: 12, thigh: 23, calf: 15 }, bf: 10,
    muscle: { chest: 0.75, delts: 0.8, lats: 0.75, arms: 0.75, abs: 0.8, quads: 0.6, calves: 0.6, traps: 0.7 } },
  heavy: { shape: { heightIn: 69, neck: 17, shoulders: 49, chest: 45, waist: 42, hips: 44, arm: 15, forearm: 12.5, thigh: 26, calf: 16.5 }, bf: 30,
    muscle: { chest: 0.3, delts: 0.3, lats: 0.3, arms: 0.3, abs: 0.2, quads: 0.4, calves: 0.4, traps: 0.3 } },
  tall: { shape: { heightIn: 75, neck: 16, shoulders: 50, chest: 42, waist: 33, hips: 39, arm: 14.5, forearm: 12, thigh: 24, calf: 15.5 }, bf: 15, muscle: null },
};
const solved = {};
const geo = name => (solved[name] ||= buildBodyGeometry(BODIES[name].shape, BODIES[name].muscle, BODIES[name].bf));

for (const name of Object.keys(BODIES)) {
  test(`${name}: every SDF girth matches the tape / anthro landmark girth within 3%`, () => {
    const D = geo(name);
    assert.ok(D.A, 'anthro geometry is used');
    const want = anthroTargets(D.A);
    const tape = BODIES[name].shape;
    // anthro reproduces the tape exactly at its landmarks (flexed arm; the relaxed forearm is tape / flex)
    for (const k of ['neck', 'shoulders', 'chest', 'waist', 'hips', 'arm', 'thigh', 'calf']) assert.ok(Math.abs(want[k] / tape[k] - 1) < 0.01, `anthro ${k}`);
    const m = measureGirths(D);            // independent re-measure of the solved SDF
    const rows = [];
    for (const k of GIRTH_KEYS) {
      const got = m.girths[k], err = got / want[k] - 1;
      rows.push(`${k} ${got.toFixed(2)}/${want[k].toFixed(2)} (${(err * 100).toFixed(2)}%)`);
      assert.ok(Math.abs(err) <= 0.03, `${name} ${k}: model ${got.toFixed(2)} in vs ${want[k].toFixed(2)} in (${(err * 100).toFixed(1)}%)`);
    }
    if (process.env.BODY3D_VERBOSE) console.log(name, rows.join(' | '));
  });

  test(`${name}: girths are taken at anthro's landmark heights`, () => {
    const D = geo(name), L = D.A.landmarks, at = D.measured.at;
    for (const [k, lm] of [['neck', 'neck'], ['shoulders', 'shoulder'], ['chest', 'chest'], ['waist', 'waist'], ['hips', 'hip'], ['thigh', 'thigh'], ['calf', 'calf'], ['forearm', 'forearm']]) {
      assert.ok(Math.abs(at[k] - L[lm].y) < 0.15, `${name} ${k} measured at ${at[k].toFixed(2)} in, landmark at ${L[lm].y.toFixed(2)} in`);
    }
  });

  test(`${name}: landmark heights and bone lengths match anthropometry`, () => {
    const D = geo(name), A = D.A, L = measureLandmarks(D), H = L.heightIn;
    const near = (label, got, want, tolFrac) => assert.ok(Math.abs(got - want) / H <= tolFrac,
      `${name} ${label}: ${got.toFixed(2)} in vs ${want.toFixed(2)} in (tol ${(tolFrac * H).toFixed(2)} in)`);
    near('stature (vertex)', L.vertex, H, 0.006);
    near('sole on the floor', L.sole, 0, 0.004);
    near('chin', L.chin, A.heights.chin, 0.006);
    near('top of shoulder (acromion + skin)', L.acromion, A.heights.acromion + 0.006 * H, 0.012);
    near('crotch', L.crotch, A.heights.crotch, 0.02);
    near('shoulder joint', L.shoulderJoint, A.joints.shoulderL.y, 0.002);
    near('hip joint', L.hipJoint, A.joints.hipL.y, 0.002);
    near('knee', L.knee, A.joints.kneeL.y, 0.004);
    near('ankle', L.ankle, A.joints.ankleL.y, 0.004);
    near('upper arm (joint centres)', L.upperArm, A.bones.upperArm, 0.003);
    near('forearm (joint centres)', L.forearm, A.bones.forearm, 0.003);
    near('hand', L.hand, A.segments.hand, 0.005);
    near('foot', L.foot, A.segments.foot, 0.008);
  });
}

test('height scales every length; bigger tape gives a bigger model', () => {
  const a = geo('bob'), b = geo('tall');
  assert.ok(Math.abs(b.P.Lu / a.P.Lu - 75 / 69) < 0.01, 'upper arm scales with stature');
  assert.ok(geo('heavy').P.wstA > a.P.wstA, 'heavier waist is wider');
});

test('every shader parameter is defined and finite', () => {
  for (const name of Object.keys(BODIES)) {
    const D = geo(name);
    for (const p of PARAMS) assert.ok(Number.isFinite(D.P[p]), `${name}: P_${p} = ${D.P[p]}`);
  }
});
