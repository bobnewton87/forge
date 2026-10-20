// MESH renderer smoothness + per-side skeleton (CONTRACT §16c).
//
// Smoothness is measured on the fitted mesh re-posed into the relaxed pose with plain linear-blend skinning (what
// the GPU draws), independently of the renderer's own helpers:
//   (a) dihedral angles between adjacent faces: max / p99 over the body (intentional sharp features such as lips,
//       eyelids, ears, nostrils, fingers and toes are excluded by their sharpness in the canonical base mesh, and the
//       two self-contact zones of the relaxed pose, the crotch and the armpits, where skinning folds skin that is
//       pressed together, are excluded too), plus the crease the FIT adds on top of the posed source mesh;
//   (b) displacement-field roughness: mean umbrella-Laplacian magnitude of (fitted − posed source);
//   (c) normals: duplicated (seam) vertices carry identical normals, and normals stay continuous across the region
//       (part) boundaries head/neck↔torso, arm↔torso and leg↔torso.
// Same metric on the previous renderer (commit cc560e7), bob / tallLean → after this pass:
//   dihedral max 73.0 / 87.2° → 57.2 / 65.7°   (p99 29.8 / 30.5 → 29.5 / 29.5°, dominated by the base mesh's own detail)
//   fit-added crease max 55.6 / 75.4° → 31.7 / 39.5°, p99.9 27.1 / 37.3° → 15.0 / 15.5°, p99 9.2 / 9.0° → 6.9 / 7.0°
//   head/neck edges creased > 12° by the fit 122 / 138 → 13 / 27
//   displacement roughness 0.0172 / 0.0196 in → 0.0109 / 0.0124 in
//   part-boundary normal jump max 30.6 / 34.2° → 27.7 / 26.1°
// The thresholds below sit between the two.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeBodyAsset, fitBody, skinMatrices, skinPositions, sliceHull, sideJoints } from '../js/ui/body3d-mesh.js';
import { bodyGeometry } from '../js/engine/anthro.js';

const dir = new URL('../assets/body/', import.meta.url);
const meta = JSON.parse(fs.readFileSync(fileURLToPath(new URL('body.json', dir)), 'utf8'));
const bin = fs.readFileSync(fileURLToPath(new URL('body.bin', dir)));
const A = decodeBodyAsset(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const P = A.part, T = A.tris, n = A.nMesh;
const REPORT = !!process.env.MESH_REPORT;

const BOB = { heightIn: 69, neck: 15, shoulders: 46, chest: 39, waist: 34.5, hips: 38, arm: 13.5, forearm: 11.5, thigh: 22, calf: 14.5 };
const BODIES = {
  bob: { shape: BOB, bodyFatPct: 19 },
  tallLean: { shape: { heightIn: 73, neck: 16.5, shoulders: 51, chest: 44, waist: 33, hips: 39.5, arm: 15.5, forearm: 12.5, thigh: 24, calf: 15.5 }, bodyFatPct: 11,
    muscle: { chest: 0.8, delts: 0.8, lats: 0.75, arms: 0.8, abs: 0.7, quads: 0.7, calves: 0.6, traps: 0.7 } },
};

// ---------------------------------------------------------------- independent topology / metric helpers
const pkey = i => `${Math.round(A.base[i * 3] * 1e4)},${Math.round(A.base[i * 3 + 1] * 1e4)},${Math.round(A.base[i * 3 + 2] * 1e4)}`;
const weld = new Int32Array(n); { const m = new Map(); for (let i = 0; i < n; i++) { const k = pkey(i); if (!m.has(k)) m.set(k, i); weld[i] = m.get(k); } }
const edges = new Map();   // welded edge → [tri, tri]
for (let t = 0; t < T.length / 3; t++) for (let e = 0; e < 3; e++) {
  const a = weld[T[t * 3 + e]], b = weld[T[t * 3 + (e + 1) % 3]], k = a < b ? a * 65536 + b : b * 65536 + a;
  let r = edges.get(k); if (!r) edges.set(k, r = []); r.push(t);
}
const nbr = Array.from({ length: n }, () => new Set());
for (const k of edges.keys()) { const a = Math.floor(k / 65536), b = k % 65536; nbr[a].add(b); nbr[b].add(a); }
for (let i = 0; i < n; i++) if (weld[i] !== i) nbr[i] = nbr[weld[i]];
function faceNormals(pos) {
  const F = new Float64Array(T.length);
  for (let t = 0; t < T.length / 3; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    F[t * 3] = x / l; F[t * 3 + 1] = y / l; F[t * 3 + 2] = z / l;
  }
  return F;
}
function dihedrals(pos) {
  const F = faceNormals(pos), out = new Map();
  for (const [k, v] of edges) {
    if (v.length !== 2) continue;
    const [p, q] = v, d = F[p * 3] * F[q * 3] + F[p * 3 + 1] * F[q * 3 + 1] + F[p * 3 + 2] * F[q * 3 + 2];
    out.set(k, Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI);
  }
  return out;
}
const quant = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const baseDih = dihedrals(A.base);
// bone-group shares per vertex (0 torso 1 head/neck 2 armL 3 armR 4 legL 5 legR)
const grp = new Float32Array(n * 6);
for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const w = A.skinW[i * 4 + k]; if (w) grp[i * 6 + A.bones[A.skinIdx[i * 4 + k]].group] += w; }

function relaxed(fit) { const { M, J } = skinMatrices(A, fit.heads, fit.relax); return { pos: skinPositions(A, fit.rest, M), M, J }; }
function excluded(fit, pos, J) {
  // intentional sharp features (sharp already in the canonical mesh) and the relaxed pose's self-contact zones
  const yCr = fit.geom.landmarks.crotch.y, ySh = Math.min(J[A.B.uarm1L][1], J[A.B.uarm1R][1]);
  const contact = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], arm = grp[i * 6 + 2] + grp[i * 6 + 3], trunk = grp[i * 6];
    if (Math.abs(x) < 2.6 && Math.abs(y - yCr) < 1.8) contact[i] = 1;                         // crotch
    if (y < ySh - 0.6 && y > ySh - 6 && arm > 0.04 && trunk > 0.04) contact[i] = 1;           // axilla fold
    if (P[i] === 6) contact[i] = 1;
  }
  return k => { const a = Math.floor(k / 65536), b = k % 65536; return contact[a] || contact[b] || baseDih.get(k) > 30; };
}
function smoothness(fit) {
  const { pos, M, J } = relaxed(fit), skip = excluded(fit, pos, J);
  const dFit = dihedrals(pos), dSrc = dihedrals(fit.src);
  const abs = [], add = [];
  let headNeck12 = 0;
  for (const [k, a] of dFit) {
    if (skip(k)) continue;
    abs.push(a); const inc = a - dSrc.get(k); add.push(inc);
    const v = Math.floor(k / 65536); if (inc > 12 && P[v] === 1) headNeck12++;
  }
  // (b) roughness of the fit displacement
  let rough = 0, rc = 0;
  for (let i = 0; i < n; i++) {
    if (P[i] === 6 || !nbr[i].size) continue;
    let x = 0, y = 0, z = 0;
    for (const j of nbr[i]) { x += pos[j * 3] - fit.src[j * 3]; y += pos[j * 3 + 1] - fit.src[j * 3 + 1]; z += pos[j * 3 + 2] - fit.src[j * 3 + 2]; }
    const m = nbr[i].size;
    rough += Math.hypot(x / m - (pos[i * 3] - fit.src[i * 3]), y / m - (pos[i * 3 + 1] - fit.src[i * 3 + 1]), z / m - (pos[i * 3 + 2] - fit.src[i * 3 + 2])); rc++;
  }
  // (c) skinned (relaxed) vertex normals: seams + part boundaries
  const N = new Float64Array(n * 3), R = fit.restNrm;
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = A.skinW[i * 4 + k]; if (!w) continue; const m = A.skinIdx[i * 4 + k] * 16;
      x += w * (M[m] * R[i * 3] + M[m + 4] * R[i * 3 + 1] + M[m + 8] * R[i * 3 + 2]);
      y += w * (M[m + 1] * R[i * 3] + M[m + 5] * R[i * 3 + 1] + M[m + 9] * R[i * 3 + 2]);
      z += w * (M[m + 2] * R[i * 3] + M[m + 6] * R[i * 3 + 1] + M[m + 10] * R[i * 3 + 2]);
    }
    const l = Math.hypot(x, y, z) || 1; N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l;
  }
  const ang = (i, j) => Math.acos(Math.max(-1, Math.min(1, N[i * 3] * N[j * 3] + N[i * 3 + 1] * N[j * 3 + 1] + N[i * 3 + 2] * N[j * 3 + 2]))) * 180 / Math.PI;
  let seamMax = 0, dups = 0;
  for (let i = 0; i < n; i++) if (weld[i] !== i) { dups++; seamMax = Math.max(seamMax, ang(i, weld[i])); }
  const cross = [];
  for (const [k] of dFit) {
    if (skip(k)) continue;
    const a = Math.floor(k / 65536), b = k % 65536;
    if (P[a] !== P[b] && P[a] !== 6 && P[b] !== 6) cross.push(ang(a, b));
  }
  return {
    absMax: quant(abs, 1), absP99: quant(abs, 0.99), addMax: quant(add, 1), addP999: quant(add, 0.999), addP99: quant(add, 0.99), headNeck12,
    rough: rough / rc, seamMax, dups, crossMax: quant(cross, 1), crossP99: quant(cross, 0.99), crossN: cross.length,
  };
}

const fits = {}; for (const [k, b] of Object.entries(BODIES)) fits[k] = fitBody(A, b);
for (const name of Object.keys(BODIES)) {
  test(`${name}: fitted relaxed mesh is smooth (no fit-made creases, smooth displacement, continuous normals)`, () => {
    const m = smoothness(fits[name]);
    if (REPORT) console.log(`\n[${name} smoothness]`, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(4)])));
    // (a) surface: overall dihedrals and the crease the fit adds on top of the posed source mesh
    assert.ok(m.absP99 < 30, `dihedral p99 ${m.absP99.toFixed(1)}°`);
    assert.ok(m.absMax < 70, `dihedral max ${m.absMax.toFixed(1)}° (was 73 / 87)`);
    assert.ok(m.addP99 < 8, `fit-added crease p99 ${m.addP99.toFixed(2)}° (was 9.2 / 9.0)`);
    assert.ok(m.addP999 < 20, `fit-added crease p99.9 ${m.addP999.toFixed(1)}° (was 27 / 37)`);
    assert.ok(m.addMax < 48, `fit-added crease max ${m.addMax.toFixed(1)}° (was 56 / 75)`);
    assert.ok(m.headNeck12 <= 45, `head/neck edges creased > 12° by the fit: ${m.headNeck12} (was 122 / 138)`);
    // (b) displacement roughness (inches)
    assert.ok(m.rough < 0.0145, `displacement roughness ${m.rough.toFixed(4)} in (was 0.0172 / 0.0196)`);
    // (c) normals: identical across duplicated seam vertices, continuous across region (part) boundaries
    assert.ok(m.seamMax < 1e-3, `seam normal jump ${m.seamMax}° over ${m.dups} duplicated vertices`);
    assert.ok(m.crossN > 100 && m.crossMax < 30, `part-boundary normal jump p99 ${m.crossP99.toFixed(1)}° max ${m.crossMax.toFixed(1)}° (was 31 / 34)`);
  });
}

// ---------------------------------------------------------------- per-side limb lengths (CONTRACT §16c)
const LENGTHS = { upperArmL: 14.2, upperArmR: 14.6, forearmL: 11.0, forearmR: 11.0, thighL: 17.0, thighR: 17.4, shankL: 16.5, shankR: 16.5 };
const BIG = { upperArmL: 13.4, upperArmR: 14.8, forearmL: 10.5, forearmR: 11.3, thighL: 16.4, thighR: 17.6, shankL: 16.0, shankR: 16.9 };
function geomWith(lengths) {
  const g = bodyGeometry({ ...BOB, lengths, bodyFatPct: 19, sex: 'male' });
  if (!(g.bones && g.bones.upperArmL)) {
    // anthro without per-side output: derive per-side joint-centre bones from the symmetric ones by the tape ratios
    const avg = k => (lengths[k + 'L'] + lengths[k + 'R']) / 2;
    for (const k of ['upperArm', 'forearm', 'thigh', 'shank']) for (const s of ['L', 'R']) g.bones[k + s] = g.bones[k] * lengths[k + s] / avg(k);
  }
  return g;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pct = (a, b) => (a / b - 1) * 100;
for (const [label, lengths] of [['14.2/14.6 arm, 17.0/17.4 thigh', LENGTHS], ['large asymmetry', BIG]]) {
  test(`per-side skeleton (${label}): joint-to-joint lengths ±2% per side, L−R differences kept, girths ±3% at per-side heights`, () => {
    const geom = geomWith(lengths), fit = fitBody(A, { shape: BOB, bodyFatPct: 19, geom });
    const want = sideJoints(geom), wj = k => [want[k].x, want[k].y, want[k].z];
    const { pos, J } = relaxed(fit), at = b => J[A.B[b]];
    const rows = [];
    for (const s of ['L', 'R']) {
      rows.push([`upperArm${s}`, dist(at('uarm1' + s), at('farm1' + s)), dist(wj('shoulder' + s), wj('elbow' + s))]);
      rows.push([`forearm${s}`, dist(at('farm1' + s), at('hand' + s)), dist(wj('elbow' + s), wj('wrist' + s))]);
      rows.push([`thigh${s}`, dist(at('thigh' + s), at('shin' + s)), dist(wj('hip' + s), wj('knee' + s))]);
      rows.push([`shank${s}`, dist(at('shin' + s), at('foot' + s)), dist(wj('knee' + s), wj('ankle' + s))]);
    }
    // the per-side targets are anthro's per-side bones
    for (const [k, , w] of rows) assert.ok(Math.abs(pct(w, geom.bones[k])) < 0.5, `${k} joints vs bones ${w.toFixed(2)} / ${geom.bones[k].toFixed(2)}`);
    const report = rows.map(([k, g, w]) => `${k.padEnd(10)} ${g.toFixed(2)} / ${w.toFixed(2)} in  ${pct(g, w).toFixed(2)}%`).join('\n');
    if (REPORT) console.log(`\n[per-side ${label}]\n${report}`);
    for (const [k, g, w] of rows) assert.ok(Math.abs(pct(g, w)) <= 2, `${k}\n${report}`);
    const m = Object.fromEntries(rows.map(([k, g, w]) => [k, { g, w }]));
    for (const k of ['upperArm', 'forearm', 'thigh', 'shank']) {
      const dg = m[k + 'R'].g - m[k + 'L'].g, dw = m[k + 'R'].w - m[k + 'L'].w;
      assert.ok(Math.abs(dg - dw) < 0.2, `${k} R−L ${dg.toFixed(2)} vs ${dw.toFixed(2)} in`);
    }
    // girths at each side's own landmark heights
    const prof = (part, name) => geom.profiles[part].find(p => p.name === name);
    const legSide = sg => (a, b, c) => [a, b, c].every(i => (P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5) && fit.rest[i * 3] * sg > 0);
    const armP = k => (a, b, c) => P[a] === k && P[b] === k && P[c] === k;
    const g = [];
    for (const [s, sg, ap] of [['L', 1, 2], ['R', -1, 3]]) {
      const lp = n2 => { const p = prof('leg' + s, n2); return want['knee' + s] && p ? p : null; };
      for (const nm of ['thigh', 'calf']) { const p = lp(nm); g.push([`${nm}${s}`, sliceHull(pos, T, legSide(sg), p.y).per, p.girth]); }
      for (const nm of ['arm', 'forearm']) { const p = prof('arm' + s, nm); g.push([`${nm}${s} relaxed`, sliceHull(pos, T, armP(ap), p.y).per, p.girth]); }
    }
    for (const [k, got, w] of [...g, ['waist', sliceHull(pos, T, (a, b, c) => [a, b, c].every(i => P[i] !== 2 && P[i] !== 3 && P[i] !== 6), geom.landmarks.waist.y).per, geom.landmarks.waist.girth]]) {
      assert.ok(Math.abs(pct(got, w)) <= 3, `${k} ${got.toFixed(2)} vs ${w.toFixed(2)}`);
    }
  });
}

test('fit stays fast enough for live update() (cached thereafter)', () => {
  const t0 = performance.now(); fitBody(A, { shape: { ...BOB, waist: 35.25 }, bodyFatPct: 18 }); const ms = performance.now() - t0;
  assert.ok(ms < 1500, `fit ${ms.toFixed(0)} ms`);
});
