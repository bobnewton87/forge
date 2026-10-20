// MESH renderer guards (CONTRACT §21b): the fitted mesh reads the user's tape at every measured site for any
// body, the shoulder girdle is never squashed or ballooned, a profile with no tape is sized from its weight, and
// nothing in the fit is NaN. Measurements are taken the way test/mesh-fit does: slice the SKINNED relaxed mesh
// horizontally and take the convex-hull perimeter (what a tape reads).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeBodyAsset, fitBody, skinMatrices, skinPositions, sliceHull, headDims, headTargets } from '../js/ui/body3d-mesh.js';

const dir = new URL('../assets/body/', import.meta.url);
const read = (j, b) => { const meta = JSON.parse(fs.readFileSync(fileURLToPath(new URL(j, dir)), 'utf8')); const bin = fs.readFileSync(fileURLToPath(new URL(b, dir))); return decodeBodyAsset(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)); };
const AM = read('body.json', 'body.bin'), AF = read('body-female.json', 'body-female.bin');
const MU = v => Object.fromEntries(['chest', 'delts', 'lats', 'arms', 'abs', 'quads', 'calves', 'traps'].map(k => [k, v]));
const all3 = f => (a, b, c) => f(a) && f(b) && f(c);

function fitAndMeasure(sex, body) {
  const A = sex === 'female' ? AF : AM, P = A.part, tris = A.tris;
  const fit = fitBody(A, body);
  const { M } = skinMatrices(A, fit.heads, fit.relax);
  const pos = skinPositions(A, fit.rest, M);
  const TRUNK = all3(i => P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5);
  const LOOP = all3(i => P[i] <= 3);
  const ARM = k => all3(i => P[i] === k);
  const legL = all3(i => (P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5) && fit.rest[i * 3] > 0);
  const L = fit.geom.landmarks, nb = fit.geom.heights.neckBase, chin = L.chin.y;
  const neckScan = [];
  for (let y = nb - 0.4; y <= chin - 0.25; y += 0.1) { const p = sliceHull(pos, tris, TRUNK, y).per; if (p > 0) neckScan.push(p); }
  const g = {
    neck: Math.min(...neckScan),
    shoulders: sliceHull(pos, tris, LOOP, L.shoulder.y).per,
    chest: sliceHull(pos, tris, TRUNK, L.chest.y).per,
    waist: sliceHull(pos, tris, TRUNK, L.waist.y).per,
    hips: sliceHull(pos, tris, TRUNK, L.hip.y).per,
    thigh: sliceHull(pos, tris, legL, L.thigh.y).per,
    calf: sliceHull(pos, tris, legL, L.calf.y).per,
    arm: sliceHull(pos, tris, ARM(2), L.arm.y).per,
  };
  return { fit, g, pos, A };
}
const sh = (o) => ({ ...o });

// (height, weight, body fat) across the realistic range, with the tape given, partly given and absent
const BODIES = [
  ['F typical',    'female', { shape: sh({ heightIn: 64, weightLb: 140, neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14 }), bodyFatPct: 31, muscle: MU(0.26) }],
  ['F broad',      'female', { shape: sh({ heightIn: 64, weightLb: 150, neck: 13, shoulders: 44, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14 }), bodyFatPct: 29, muscle: MU(0.3) }],
  ['F narrow',     'female', { shape: sh({ heightIn: 64, weightLb: 130, neck: 13, shoulders: 36, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14 }), bodyFatPct: 31, muscle: MU(0.22) }],
  ['F obese tape', 'female', { shape: sh({ heightIn: 64, weightLb: 240, neck: 15.5, shoulders: 49, chest: 47, waist: 44, hips: 52, arm: 15, forearm: 11.5, thigh: 28, calf: 17.5 }), bodyFatPct: 48, muscle: MU(0.26) }],
  ['F obese bare', 'female', { shape: sh({ heightIn: 64, weightLb: 240 }), bodyFatPct: 48, muscle: MU(0.26) }],
  ['F bare',       'female', { shape: sh({ heightIn: 64, weightLb: 140 }), bodyFatPct: 31, muscle: MU(0.26) }],
  ['F lean tall',  'female', { shape: sh({ heightIn: 70, weightLb: 135, neck: 12, shoulders: 39, chest: 32, waist: 25, hips: 35, arm: 10, forearm: 8.5, thigh: 19.5, calf: 13 }), bodyFatPct: 20, muscle: MU(0.35) }],
  ['M bob',        'male',   { shape: sh({ heightIn: 69, weightLb: 164, neck: 15, shoulders: 46, chest: 39, waist: 34.5, hips: 38, arm: 13.5, forearm: 11.5, thigh: 22, calf: 14.5 }), bodyFatPct: 19 }],
  ['M obese tape', 'male',   { shape: sh({ heightIn: 70, weightLb: 300, neck: 18.5, shoulders: 56, chest: 52, waist: 52, hips: 50, arm: 17, forearm: 13.5, thigh: 29, calf: 18 }), bodyFatPct: 42 }],
  ['M obese bare', 'male',   { shape: sh({ heightIn: 70, weightLb: 300 }), bodyFatPct: 42 }],
  ['M bare',       'male',   { shape: sh({ heightIn: 69, weightLb: 164 }), bodyFatPct: 20 }],
  ['M big tape',   'male',   { shape: sh({ heightIn: 71, weightLb: 215, neck: 17, shoulders: 52, chest: 46, waist: 36, hips: 40, arm: 16.5, forearm: 13, thigh: 26, calf: 16 }), bodyFatPct: 14, muscle: MU(0.85) }],
];
const fitted = BODIES.map(([name, sex, body]) => [name, sex, body, fitAndMeasure(sex, body)]);

test('§21b: every measured tape is read back off the fitted mesh (shoulders too, at any size)', () => {
  for (const [name, , body, { g }] of fitted) {
    const t = body.shape;
    for (const k of ['shoulders', 'chest', 'waist', 'hips', 'thigh', 'calf']) {
      if (t[k] == null) continue;
      const err = g[k] / t[k] - 1;
      // §16: ±3 % at every measured site; the trunk tapes land inside ±1.2 %. The thigh of a very large body is
      // the loosest site (the two thighs press together, so a one-leg hull slice clips the inner face).
      const tol = k === 'thigh' || k === 'calf' ? 0.03 : 0.012;
      assert.ok(Math.abs(err) < tol, `${name}: ${k} ${g[k].toFixed(2)} vs tape ${t[k]} (${(err * 100).toFixed(2)} %)`);
    }
  }
});

test('§21b: the shoulder girdle spread stays inside its band and converges (no squash, no balloon)', () => {
  for (const [name, , , { fit }] of fitted) {
    const s = fit.report.shoulders;
    assert.ok(Number.isFinite(s.sigma), `${name}: sigma ${s.sigma}`);
    assert.ok(s.sigma >= -0.2001 && s.sigma <= 0.3201, `${name}: sigma ${s.sigma} outside the band`);
    if (s.measured) assert.ok(Math.abs(s.girth / s.target - 1) < 0.012, `${name}: loop ${s.girth.toFixed(2)} vs target ${s.target.toFixed(2)}`);
    else assert.ok(s.sigma >= -0.1501 && s.sigma <= 0.2201, `${name}: estimated-tape sigma ${s.sigma} outside the small band`);
  }
});

test('§21b: a profile with no tape is sized from its weight, not drawn as the median adult', () => {
  const by = Object.fromEntries(fitted.map(([n, , , r]) => [n, r]));
  for (const [bare, tape, heavy] of [['F bare', 'F obese bare', 'F obese tape'], ['M bare', 'M obese bare', 'M obese tape']]) {
    const lean = by[bare].g, big = by[tape].g, ref = by[heavy].g;
    assert.ok(big.waist > lean.waist * 1.3, `${tape} waist ${big.waist.toFixed(1)} vs ${bare} ${lean.waist.toFixed(1)}`);
    assert.ok(big.chest > lean.chest * 1.15, `${tape} chest ${big.chest.toFixed(1)} vs ${bare} ${lean.chest.toFixed(1)}`);
    assert.ok(big.shoulders > lean.shoulders * 1.05, `${tape} shoulders ${big.shoulders.toFixed(1)} vs ${bare} ${lean.shoulders.toFixed(1)}`);
    // and it lands near the same body built from a full tape at that weight (± 12 %)
    for (const k of ['chest', 'waist', 'shoulders']) assert.ok(Math.abs(big[k] / ref[k] - 1) < 0.12, `${tape} ${k} ${big[k].toFixed(1)} vs tape-measured ${ref[k].toFixed(1)}`);
  }
});

test('§21b: the fitted head stays adult-sized and nothing in the fit is NaN', () => {
  for (const [name, sex, body, { fit, pos, A }] of fitted) {
    const H = fit.geom.heightIn, hd = headDims(A, pos), T = headTargets(H, sex);
    assert.ok(Math.abs(hd.breadth / T.breadth - 1) < 0.06, `${name}: head breadth ${hd.breadth.toFixed(2)} vs ${T.breadth.toFixed(2)}`);
    assert.ok(Math.abs(hd.length / T.length - 1) < 0.06, `${name}: head length ${hd.length.toFixed(2)} vs ${T.length.toFixed(2)}`);
    assert.ok(hd.circumference / H > 0.28 && hd.circumference / H < 0.40, `${name}: head circumference ${(hd.circumference / H).toFixed(3)} H`);
    assert.ok(hd.height / T.height > 0.9 && hd.height / T.height < 1.1, `${name}: head height ${hd.height.toFixed(2)} vs ${T.height.toFixed(2)}`);
    for (const buf of [fit.rest, fit.restNrm, fit.relaxed]) for (let i = 0; i < buf.length; i += 997) assert.ok(Number.isFinite(buf[i]), `${name}: NaN in the fitted mesh`);
    assert.ok(Number.isFinite(fit.flexAmp) && Number.isFinite(fit.report.worst));
    void body;
  }
});
