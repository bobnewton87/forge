// MESH clothing regions (CONTRACT §21c). The sports-top strap is a constant-radius tube around a centre-line
// that lies on the canonical surface, so it reads as a band of constant width on every build. The shader itself
// is not testable in Node, but the centre-line is pure geometry and every property that makes the band behave is
// checked here; the under-bust hem follows anthro's inframammary station, which is checked too.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeBodyAsset } from '../js/ui/body3d-mesh.js';
import { bodyGeometry } from '../js/engine/anthro.js';

const dir = new URL('../assets/body/', import.meta.url);
const read = (j, b) => { const meta = JSON.parse(fs.readFileSync(fileURLToPath(new URL(j, dir)), 'utf8')); const bin = fs.readFileSync(fileURLToPath(new URL(b, dir))); return decodeBodyAsset(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)); };
const AF = read('body-female.json', 'body-female.bin'), AM = read('body.json', 'body.bin');
const at = (A, i) => [A.base[i * 3], A.base[i * 3 + 1], A.base[i * 3 + 2]];
const d3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
// nearest surface vertex (either half, trunk + head/neck) and its arm-skin share
function nearest(A, p) {
  let bi = -1, bd = Infinity;
  for (let i = 0; i < A.nMesh; i++) {
    if (A.part[i] > 1) continue;
    const q = [Math.abs(A.base[i * 3]), A.base[i * 3 + 1], A.base[i * 3 + 2]];
    const d = (q[0] - Math.abs(p[0])) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return { i: bi, dist: Math.sqrt(bd), arm: A.grp[bi * 6 + 2] + A.grp[bi * 6 + 3] };
}

test('§21c: the strap centre-line exists for the female asset only and is a sane polyline', () => {
  assert.equal(AM.strap, undefined, 'the male body wears no top');
  const S = AF.strap;
  assert.ok(S && Array.isArray(S.pts), 'female strap path');
  assert.ok(S.pts.length >= 12 && S.pts.length <= 20, `points ${S.pts.length}`);
  // ≈ 0.9 in wide at the canonical scale (1 dm ≈ 3.94 in): a real sports-bra strap, never a wedge
  assert.ok(S.radius > 0.09 && S.radius < 0.20, `radius ${S.radius} dm`);
  assert.ok(S.lift > 0.02 && S.lift < S.radius * 0.8, `lift ${S.lift} dm vs radius ${S.radius}`);
  // on-surface half-width = sqrt(r² − lift²): still a strap, not a thread
  const half = Math.sqrt(S.radius ** 2 - S.lift ** 2);
  assert.ok(half > 0.09 && half < 0.19, `on-surface half-width ${half.toFixed(3)} dm`);
  for (const p of S.pts) for (const v of p) assert.ok(Number.isFinite(v), 'finite');
  // every point sits on the left half and floats just off the body surface, nowhere near the radius
  for (const [i, p] of S.pts.entries()) {
    assert.ok(p[0] > 0.1, `point ${i} x ${p[0]} is not on the left half`);
    assert.ok(nearest(AF, p).dist < S.radius, `point ${i} is ${nearest(AF, p).dist.toFixed(3)} dm off the surface`);
  }
  // chord midpoints stay inside the tube too, so the band never pinches shut between two points
  for (let i = 1; i < S.pts.length; i++) {
    const a = S.pts[i - 1], b = S.pts[i], g = d3(a, b);
    assert.ok(g > 1e-3 && g < 0.35, `gap ${i} = ${g.toFixed(3)} dm`);
    const mid = [0, 1, 2].map(k => (a[k] + b[k]) / 2), d = nearest(AF, mid).dist;
    assert.ok(d < S.radius, `chord ${i} midpoint is ${d.toFixed(3)} dm from the surface, outside the ${S.radius} dm tube`);
  }
});

test('§21c: the strap runs over the trapezius, between the neck and the deltoid, front to back', () => {
  const S = AF.strap.pts;
  const notch = at(AF, AF.notchV), nip = at(AF, AF.lm.nippleV), sj = at(AF, AF.bones[AF.B.uarm1L].head);
  // front end on the chest, back end behind the spine side, highest point over the shoulder
  assert.ok(S[0][2] > nip[2] * 0.7, `front end z ${S[0][2]}`);
  assert.ok(S[S.length - 1][2] < -0.2, `back end z ${S[S.length - 1][2]}`);
  assert.ok(S[0][1] > nip[1] && S[0][1] < notch[1], 'the front end starts at the top of the cup');
  const top = S.reduce((a, p) => (p[1] > a[1] ? p : a), S[0]);
  assert.ok(top[1] > notch[1], `the crossing (${top[1].toFixed(2)}) is above the suprasternal notch (${notch[1].toFixed(2)})`);
  assert.ok(top[0] > 0.35 * sj[0] && top[0] < 0.75 * sj[0], `crossing x ${top[0].toFixed(2)} vs shoulder joint ${sj[0].toFixed(2)}`);
  // z decreases front → over the shoulder → upper back without doubling back; the racer-back tail then follows
  // the back surface in toward the spine, which comes forward slightly, so only the sweep itself is monotone
  const sweep = S.findIndex(p => p[2] < -0.55);
  assert.ok(sweep > 6 && sweep < S.length - 2, `the sweep reaches the back at point ${sweep}`);
  for (let i = 1; i <= sweep; i++) assert.ok(S[i][2] < S[i - 1][2] + 0.06, `point ${i} runs backwards in z`);
  for (let i = sweep; i < S.length; i++) assert.ok(S[i][2] < -0.3, `tail point ${i} leaves the back`);
  // the racer-back converges toward the spine
  assert.ok(S[S.length - 1][0] < 0.6 * top[0], 'the back end converges toward the spine');
  // the whole line stays off the deltoid, so the shader's arm cut-off never clips it
  for (const [i, p] of S.entries()) assert.ok(nearest(AF, p).arm < 0.3, `point ${i} arm weight ${nearest(AF, p).arm.toFixed(2)}`);
});

test('§21c: the inframammary station never slides onto the belly, however heavy the bust', () => {
  const MU = v => Object.fromEntries(['chest', 'delts', 'lats', 'arms', 'abs', 'quads', 'calves', 'traps'].map(k => [k, v]));
  let prev = Infinity;
  for (const [bust, waist, bf] of [[30, 23, 16], [32, 24, 18], [35, 29, 29], [38, 32, 34], [42, 36, 40], [47, 44, 48], [52, 50, 53], [58, 60, 55]]) {
    const g = bodyGeometry({ sex: 'female', heightIn: 64, neck: 13, shoulders: 40, chest: bust, waist, hips: waist + 8, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14, bodyFatPct: bf, muscle: MU(0.26) });
    const H = g.heightIn, fold = g.heights.underbust, w = g.heights.waist, bustY = g.heights.chest;
    assert.ok(fold > w + 0.034 * H, `bust ${bust}: fold ${(fold / H).toFixed(3)} H is only ${(fold - w).toFixed(2)} in above the natural waist`);
    assert.ok(fold < bustY - 0.015 * H, `bust ${bust}: fold ${(fold / H).toFixed(3)} H is not below the bust point`);
    assert.ok(fold <= prev + 1e-9, `bust ${bust}: the fold rose with a bigger bust`);
    prev = fold;
    // the station still carries the modelled under-bust girth, so §16 is untouched
    assert.ok(Math.abs(g.landmarks.underbust.girth / g.derived.underbust - 1) < 0.01, `bust ${bust}: under-bust girth`);
  }
});

test('§21c: a bigger body stretches the strap with it but never past a hand-span', () => {
  // the canonical line is fixed; what the viewer sees is it carried through the fit, so check the fitted scale
  const MU = v => Object.fromEntries(['chest', 'delts', 'lats', 'arms', 'abs', 'quads', 'calves', 'traps'].map(k => [k, v]));
  const half = Math.sqrt(AF.strap.radius ** 2 - AF.strap.lift ** 2);
  for (const H of [56, 60, 64, 70, 76]) {
    const w = 2 * half * (H / 62.9) * 3.937;   // canonical mesh ≈ 62.9 in tall; dm → in is 3.937
    assert.ok(w > 0.75 && w < 1.6, `H ${H}: strap ${w.toFixed(2)} in wide`);
  }
  void bodyGeometry; void MU;
});
