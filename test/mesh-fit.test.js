// MESH renderer accuracy: the deformed MakeHuman mesh must read the user's tape at every landmark.
// We load the built assets, fit three bodies, re-pose the bind mesh into the relaxed (anthro rest) pose with
// plain linear-blend skinning (exactly what the GPU does), slice it horizontally at each landmark height and
// take the convex-hull perimeter of the section (what a tape reads, bridging concavities).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeBodyAsset, fitBody, skinMatrices, skinPositions, sliceHull, flexPeakGirth, poseGlobals, POSES } from '../js/ui/body3d-mesh.js';

const dir = new URL('../assets/body/', import.meta.url);
const meta = JSON.parse(fs.readFileSync(fileURLToPath(new URL('body.json', dir)), 'utf8'));
const bin = fs.readFileSync(fileURLToPath(new URL('body.bin', dir)));
const A = decodeBodyAsset(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

const BODIES = {
  bob: { shape: { heightIn: 69, neck: 15, shoulders: 46, chest: 39, waist: 34.5, hips: 38, arm: 13.5, forearm: 11.5, thigh: 22, calf: 14.5 }, bodyFatPct: 19 },
  tallLean: { shape: { heightIn: 73, neck: 16.5, shoulders: 51, chest: 44, waist: 33, hips: 39.5, arm: 15.5, forearm: 12.5, thigh: 24, calf: 15.5 }, bodyFatPct: 11,
    muscle: { chest: 0.8, delts: 0.8, lats: 0.75, arms: 0.8, abs: 0.7, quads: 0.7, calves: 0.6, traps: 0.7 } },
  shortHeavy: { shape: { heightIn: 66, neck: 16, shoulders: 45, chest: 42, waist: 40, hips: 41, arm: 13, forearm: 11, thigh: 24, calf: 15.5 }, bodyFatPct: 29 },
};

const P = A.part;   // 0 torso, 1 head/neck, 2 armL, 3 armR, 4 legL, 5 legR, 6 eye
const all3 = f => (a, b, c) => f(a) && f(b) && f(c);
const TRUNK = all3(i => P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5);
const LOOP = all3(i => P[i] <= 3);                    // shoulders tape: torso + both arms
const ARM = k => all3(i => P[i] === k);

function relaxedMesh(fit) {
  const { M } = skinMatrices(A, fit.heads, fit.relax);
  return skinPositions(A, fit.rest, M);
}
function measure(fit) {
  const pos = relaxedMesh(fit), L = fit.geom.landmarks, tris = A.tris;
  // side from the bind pose (legs apart there), so thighs that touch/cross the midline are still split correctly
  const legL = all3(i => (P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5) && fit.rest[i * 3] > 0);
  const legR = all3(i => (P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5) && fit.rest[i * 3] < 0);
  const g = {
    // the neck tape settles on the narrowest section between the neck base and the jaw
    neck: Math.min(...Array.from({ length: Math.round((L.chin.y - 0.25 - (fit.geom.heights.neckBase - 0.4)) / 0.1) + 1 },
      (_, k) => sliceHull(pos, tris, TRUNK, fit.geom.heights.neckBase - 0.4 + k * 0.1).per).filter(g => g > 0)),
    shoulders: sliceHull(pos, tris, LOOP, L.shoulder.y).per,
    chest: sliceHull(pos, tris, TRUNK, L.chest.y).per,
    waist: sliceHull(pos, tris, TRUNK, L.waist.y).per,
    hips: sliceHull(pos, tris, TRUNK, L.hip.y).per,
    armRelaxedL: sliceHull(pos, tris, ARM(2), L.arm.y).per,
    armRelaxedR: sliceHull(pos, tris, ARM(3), L.arm.y).per,
    forearmRelaxedL: sliceHull(pos, tris, ARM(2), L.forearm.y).per,
    thighL: sliceHull(pos, tris, legL, L.thigh.y).per,
    thighR: sliceHull(pos, tris, legR, L.thigh.y).per,
    calfL: sliceHull(pos, tris, legL, L.calf.y).per,
    calfR: sliceHull(pos, tris, legR, L.calf.y).per,
    armFlexedL: flexPeakGirth(fit, "L", fit.flexAmp),
  };
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < A.nMesh; i++) if (P[i] !== 6) { ymin = Math.min(ymin, pos[i * 3 + 1]); ymax = Math.max(ymax, pos[i * 3 + 1]); }
  return { g, pos, height: ymax - ymin, floor: ymin };
}
const pct = (a, b) => (a / b - 1) * 100;

const fits = {};
for (const [name, b] of Object.entries(BODIES)) fits[name] = fitBody(A, b);

for (const [name, b] of Object.entries(BODIES)) {
  test(`${name}: every tape girth is reproduced within ±3% on the deformed, skinned mesh`, () => {
    const fit = fits[name], L = fit.geom.landmarks, s = b.shape;
    const { g } = measure(fit);
    const rows = [
      ['neck', g.neck, s.neck], ['shoulders', g.shoulders, s.shoulders], ['chest', g.chest, s.chest],
      ['waist', g.waist, s.waist], ['hips', g.hips, s.hips],
      ['arm (flexed tape)', g.armFlexedL, s.arm], ['arm relaxed L', g.armRelaxedL, L.arm.relaxed.girth], ['arm relaxed R', g.armRelaxedR, L.arm.relaxed.girth],
      ['forearm relaxed', g.forearmRelaxedL, L.forearm.relaxed.girth],
      ['thigh L', g.thighL, s.thigh], ['thigh R', g.thighR, s.thigh], ['calf L', g.calfL, s.calf], ['calf R', g.calfR, s.calf],
    ];
    const report = rows.map(([k, got, want]) => `${k.padEnd(18)} ${got.toFixed(2).padStart(6)} / ${want.toFixed(2).padStart(6)} in  ${pct(got, want) >= 0 ? '+' : ''}${pct(got, want).toFixed(2)}%`).join('\n');
    if (process.env.MESH_REPORT) console.log(`\n[${name}]\n${report}`);
    for (const [k, got, want] of rows) assert.ok(Math.abs(pct(got, want)) <= 3, `${name} ${k}: ${got.toFixed(2)} vs ${want} (${pct(got, want).toFixed(2)}%)\n${report}`);
    // forearm tape is a clenched-fist (flexed) girth: relaxed × flex.forearm must reproduce it
    assert.ok(Math.abs(pct(g.forearmRelaxedL * fit.geom.flex.forearm, s.forearm)) <= 3);
  });

  test(`${name}: stature, floor contact and segment proportions match anthro`, () => {
    const fit = fits[name], G = fit.geom;
    const { height, floor } = measure(fit);
    assert.ok(Math.abs(height - b.shape.heightIn) / b.shape.heightIn < 0.005, `height ${height} vs ${b.shape.heightIn}`);
    assert.ok(Math.abs(floor) < 0.05, `floor ${floor}`);
    const { J } = skinMatrices(A, fit.heads, fit.relax);
    const at = n => J[A.B[n]];
    const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const j = G.joints, gj = k => [j[k].x, j[k].y, j[k].z];
    // joint heights (rest pose)
    for (const [bone, key] of [['uarm1L', 'shoulderL'], ['farm1L', 'elbowL'], ['handL', 'wristL'], ['shinL', 'kneeL'], ['footL', 'ankleL'], ['thighL', 'hipL']]) {
      assert.ok(Math.abs(at(bone)[1] - j[key].y) < 0.5, `${name} ${key} height ${at(bone)[1].toFixed(2)} vs ${j[key].y.toFixed(2)}`);
    }
    // limb segment lengths (joint centre to joint centre) within 3%
    const segs = [['upper arm', len(at('uarm1L'), at('farm1L')), len(gj('shoulderL'), gj('elbowL'))],
      ['forearm', len(at('farm1L'), at('handL')), len(gj('elbowL'), gj('wristL'))],
      ['thigh', len(at('thighL'), at('shinL')), len(gj('hipL'), gj('kneeL'))],
      ['shank', len(at('shinL'), at('footL')), len(gj('kneeL'), gj('ankleL'))]];
    for (const [k, got, want] of segs) assert.ok(Math.abs(pct(got, want)) <= 3, `${name} ${k} ${got.toFixed(2)} vs ${want.toFixed(2)}`);
    // overall ratios: crotch (inseam) and shoulder heights / stature
    for (const [k, y] of [['crotch', G.landmarks.crotch.y], ['chest', G.landmarks.chest.y], ['chin', G.landmarks.chin.y]]) assert.ok(y / G.heightIn > 0.4 && y / G.heightIn < 0.9, k);
  });
}

test('bind pose round-trips: skinning the un-posed mesh reproduces the fitted pose exactly', () => {
  const fit = fits.bob, pos = relaxedMesh(fit);
  let d = 0; for (let i = 0; i < pos.length; i++) d = Math.max(d, Math.abs(pos[i] - fit.relaxed[i]));
  assert.ok(d < 1e-3, `max deviation ${d}`);
});

test('every pose produces finite, grounded geometry of the right height', () => {
  const fit = fits.bob;
  for (const name of POSES) {
    const pose = poseGlobals({ A, rest: fit.heads, frames: fit.frames, geom: fit.geom, sections: fit.sections }, name);
    const { M } = skinMatrices(A, fit.heads, pose);
    const pos = skinPositions(A, fit.rest, M);
    let ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < A.nMesh; i++) { assert.ok(Number.isFinite(pos[i * 3]) && Number.isFinite(pos[i * 3 + 1])); if (P[i] === 4 || P[i] === 5) ymin = Math.min(ymin, pos[i * 3 + 1]); ymax = Math.max(ymax, pos[i * 3 + 1]); }
    assert.ok(ymin > -1.5 && ymin < 1.5, `${name} floor ${ymin}`);
    assert.ok(ymax > 60, `${name} top ${ymax}`);
  }
});

test('asset budget: ≤ 15k vertices and ≤ 1.5 MB', () => {
  assert.ok(A.nMesh <= 15000, `${A.nMesh} verts`);
  const size = fs.statSync(fileURLToPath(new URL('body.bin', dir))).size + fs.statSync(fileURLToPath(new URL('body.json', dir))).size;
  assert.ok(size <= 1.5 * 1024 * 1024, `${size} bytes`);
});
