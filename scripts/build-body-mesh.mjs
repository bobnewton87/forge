#!/usr/bin/env node
// Offline asset builder for the MESH 3D renderer (js/ui/body3d-mesh.js). Node 20, no dependencies.
//
//   node scripts/build-body-mesh.mjs <makehuman-data-dir> [outDir = assets/body] [--sex=male|female]
//
// <makehuman-data-dir> must contain files downloaded (as plain data, nothing executed) from
// github.com/makehumancommunity/makehuman @ a8bc2d54ff0ac92e78ff71431b1023eda42bf482, path makehuman/data/:
//   base.obj                  (3dobjs/base.obj, the hm08 base mesh)
//   default.mhskel            (rigs/default.mhskel)
//   default_weights.mhw       (rigs/default_weights.mhw)
//   targets/*.target          (targets/macrodetails/{caucasian,african,asian}-<sex>-young.target and the nine
//                              targets/macrodetails/universal-<sex>-young-*muscle-*weight.target)
//   targets/breast/*.target   (female only: targets/breast/female-young-averagemuscle-averageweight-
//                              {min,max}cup-averagefirmness.target, the cup-size morphs)
// All of these are CC0 1.0 (see assets/body/LICENSE-ASSETS.md). No MakeHuman program code is used.
//
// Output (assets/body/):
//   male   (default): body.json + body.bin
//   female (--sex=female): body-female.json + body-female.bin, loaded lazily by the renderer only for
//          profile.body.sex === 'female' (CONTRACT §21). Same topology, skeleton and skin weights; the default
//          shape is MakeHuman's young female (ethnic mix as the male build) at average muscle / weight, the morph
//          grid is the universal-female-young muscle × weight grid, plus two sparse cup-size morphs and an
//          inframammary-fold landmark (imfV).
//   body.json  layout + skeleton + landmark descriptors (small)
//   body.bin   little-endian typed arrays: quantized positions, triangle indices, skin indices/weights,
//              part labels, and sparse quantized morph deltas (macro muscle/weight grid).
// The male output is byte-identical to the pre-female builds (nothing in its code path changed).
//
// Units in the asset are MakeHuman decimetres, Y up, the figure faces +Z, its left side is +X.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2), FLAGS = ARGS.filter(a => a.startsWith('--')), POSARGS = ARGS.filter(a => !a.startsWith('--'));
const SRC = POSARGS[0];
const OUT = POSARGS[1] || path.join(HERE, '..', 'assets', 'body');
const SEX = FLAGS.includes('--sex=female') || FLAGS.includes('--female') ? 'female' : 'male';
const FEMALE = SEX === 'female';
if (!SRC) { console.error('usage: node scripts/build-body-mesh.mjs <makehuman-data-dir> [outDir] [--sex=male|female]'); process.exit(1); }

// ethnic blend of the default shape (the female build uses the same weights as the male one)
const ETHNIC = FEMALE ? { 'caucasian-female-young': 0.7, 'african-female-young': 0.15, 'asian-female-young': 0.15 }
  : { 'caucasian-male-young': 0.7, 'african-male-young': 0.15, 'asian-male-young': 0.15 };
const UNIV = `universal-${SEX}-young-`;
// female cup-size morphs (MakeHuman BreastSize modifier at average muscle/weight/firmness; 0.5 = no target)
const CUPS = FEMALE ? ['mincup', 'maxcup'] : [];
const cupTarget = c => `breast/female-young-averagemuscle-averageweight-${c}-averagefirmness`;
const GRID = ['minmuscle-minweight', 'minmuscle-averageweight', 'minmuscle-maxweight',
  'averagemuscle-minweight', 'averagemuscle-maxweight',
  'maxmuscle-minweight', 'maxmuscle-averageweight', 'maxmuscle-maxweight'];
const NAVEL = 4121;          // centre of the navel (from targets/stomach/stomach-navel-in.target)

// ------------------------------------------------------------------ parse inputs
function parseOBJ(file) {
  const V = []; const faces = []; let g = '';
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (l.startsWith('v ')) { const p = l.trim().split(/\s+/); V.push([+p[1], +p[2], +p[3]]); }
    else if (l.startsWith('g ')) g = l.slice(2).trim();
    else if (l.startsWith('f ')) faces.push({ g, v: l.trim().split(/\s+/).slice(1).map(s => parseInt(s, 10) - 1) });
  }
  return { V, faces };
}
function readTarget(name) {
  const m = new Map();
  for (const l of fs.readFileSync(path.join(SRC, 'targets', name + '.target'), 'utf8').split('\n')) {
    if (!l || l[0] === '#') continue;
    const p = l.trim().split(/\s+/); if (p.length < 4) continue;
    m.set(+p[0], [+p[1], +p[2], +p[3]]);
  }
  return m;
}
const obj = parseOBJ(path.join(SRC, 'base.obj'));
const skel = JSON.parse(fs.readFileSync(path.join(SRC, 'default.mhskel'), 'utf8'));
const mhw = JSON.parse(fs.readFileSync(path.join(SRC, 'default_weights.mhw'), 'utf8')).weights;

// ------------------------------------------------------------------ default shape = base + ethnic + universal(avg,avg)
const P0 = obj.V.map(v => v.slice());
for (const [name, w] of Object.entries(ETHNIC)) for (const [i, d] of readTarget(name)) { P0[i][0] += w * d[0]; P0[i][1] += w * d[1]; P0[i][2] += w * d[2]; }
for (const [i, d] of readTarget(UNIV + 'averagemuscle-averageweight')) { P0[i][0] += d[0]; P0[i][1] += d[1]; P0[i][2] += d[2]; }
const TG = GRID.map(n => readTarget(UNIV + n));
const TC = CUPS.map(c => readTarget(cupTarget(c)));

// ------------------------------------------------------------------ keep body + eyeballs
const KEEP = new Set(['body', 'helper-l-eye', 'helper-r-eye']);
const keptFaces = obj.faces.filter(f => KEEP.has(f.g));
const used = new Set(); for (const f of keptFaces) for (const i of f.v) used.add(i);
const order = [...used].sort((a, b) => a - b);          // body 0..13379 keeps MakeHuman indices
const remap = new Map(order.map((o, i) => [o, i]));
const nMesh = order.length;
const isEye = new Uint8Array(nMesh);
for (const f of keptFaces) if (f.g !== 'body') for (const i of f.v) isEye[remap.get(i)] = 1;

// triangulate (quads split along the shorter diagonal of the default shape)
const tris = [];
const dist = (a, b) => Math.hypot(P0[a][0] - P0[b][0], P0[a][1] - P0[b][1], P0[a][2] - P0[b][2]);
for (const f of keptFaces) {
  const v = f.v;
  if (v.length === 3) tris.push(v[0], v[1], v[2]);
  else if (v.length === 4) {
    if (dist(v[0], v[2]) <= dist(v[1], v[3])) tris.push(v[0], v[1], v[2], v[0], v[2], v[3]);
    else tris.push(v[0], v[1], v[3], v[1], v[2], v[3]);
  } else for (let k = 1; k < v.length - 1; k++) tris.push(v[0], v[k], v[k + 1]);
}
const triIdx = Uint16Array.from(tris.map(i => remap.get(i)));

// ------------------------------------------------------------------ collapsed skeleton (30 bones)
const side = s => ({
  clav: [`clavicle.${s}`, `shoulder01.${s}`], uarm1: [`upperarm01.${s}`], uarm2: [`upperarm02.${s}`],
  farm1: [`lowerarm01.${s}`], farm2: [`lowerarm02.${s}`],
  hand: [`wrist.${s}`, `metacarpal1.${s}`, `metacarpal2.${s}`, `metacarpal3.${s}`, `metacarpal4.${s}`],
  fing1: [2, 3, 4, 5].map(k => `finger${k}-1.${s}`),
  fing2: [2, 3, 4, 5].flatMap(k => [`finger${k}-2.${s}`, `finger${k}-3.${s}`]),
  thumb: [1, 2, 3].map(k => `finger1-${k}.${s}`),
  thigh: [`upperleg01.${s}`, `upperleg02.${s}`], shin: [`lowerleg01.${s}`, `lowerleg02.${s}`],
  foot: [`foot.${s}`, ...[1, 2, 3, 4, 5].flatMap(t => [1, 2, 3].map(k => `toe${t}-${k}.${s}`)).filter(b => skel.bones[b])],
});
const L = side('L'), R = side('R');
// [name, parent, MakeHuman bones, head-joint source, tail-joint source]
const BONES = [
  ['pelvis', null, ['root', 'pelvis.L', 'pelvis.R'], 'root', 'spine05'],
  ['spine1', 'pelvis', ['spine05', 'spine04'], 'spine05', 'spine04!'],
  ['spine2', 'spine1', ['spine03'], 'spine03', 'spine03!'],
  ['chest', 'spine2', ['spine02', 'spine01', 'breast.L', 'breast.R'], 'spine02', 'spine01!'],
  ['neck', 'chest', ['neck01', 'neck02', 'neck03'], 'neck01', 'neck03!'],
  ['head', 'neck', null /* everything else above the neck */, 'head', 'head!'],
];
for (const [S, B] of [['L', L], ['R', R]]) {
  BONES.push(
    ['clav' + S, 'chest', B.clav, B.clav[0], B.clav[1] + '!'],
    ['uarm1' + S, 'clav' + S, B.uarm1, B.uarm1[0], B.uarm1[0] + '!'],
    ['uarm2' + S, 'uarm1' + S, B.uarm2, B.uarm2[0], B.uarm2[0] + '!'],
    ['farm1' + S, 'uarm2' + S, B.farm1, B.farm1[0], B.farm1[0] + '!'],
    ['farm2' + S, 'farm1' + S, B.farm2, B.farm2[0], B.farm2[0] + '!'],
    ['hand' + S, 'farm2' + S, B.hand, B.hand[0], `metacarpal2.${S}!`],
    ['fing1' + S, 'hand' + S, B.fing1, B.fing1, B.fing1.map(b => b + '!')],
    ['fing2' + S, 'fing1' + S, B.fing2, B.fing2.filter(b => b.endsWith(`-2.${S}`)), B.fing2.filter(b => b.endsWith(`-3.${S}`)).map(b => b + '!')],
    ['thumb' + S, 'hand' + S, B.thumb, B.thumb[0], B.thumb[2] + '!'],
  );
}
for (const [S, B] of [['L', L], ['R', R]]) {
  BONES.push(
    ['thigh' + S, 'pelvis', B.thigh, B.thigh[0], B.thigh[1] + '!'],
    ['shin' + S, 'thigh' + S, B.shin, B.shin[0], B.shin[1] + '!'],
    ['foot' + S, 'shin' + S, B.foot, B.foot[0], B.foot[0] + '!'],
  );
}
const boneIndex = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const mhToBone = {};
for (const [name, , list] of BONES) if (list) for (const b of list) mhToBone[b] = name;
for (const b of Object.keys(skel.bones)) if (!mhToBone[b]) {
  // facial bones, eyes, jaw, tongue, special* -> head
  mhToBone[b] = 'head';
}

// joint positions: mean of the joint's vertex list (they include helper cubes that we drop from the mesh)
function jointSpec(src) {   // 'bone' -> its head joint, 'bone!' -> its tail joint, arrays are averaged
  const list = Array.isArray(src) ? src : [src];
  return list.map(s => s.endsWith('!') ? skel.bones[s.slice(0, -1)].tail : skel.bones[s].head);
}
function jointVerts(src) { return jointSpec(src).flatMap(j => skel.joints[j]); }
const pivotVerts = [];  // per virtual vertex: list of original vertex indices to average
for (const [, , , h, t] of BONES) { pivotVerts.push(jointVerts(h)); pivotVerts.push(jointVerts(t)); }
const nPiv = pivotVerts.length;
// auxiliary points (palm orientation / reach): index + pinky knuckles and middle fingertip per side
const AUX = ['knuckleIndexL', 'knucklePinkyL', 'fingertipL', 'knuckleIndexR', 'knucklePinkyR', 'fingertipR'];
for (const S of ['L', 'R']) pivotVerts.push(jointVerts(`finger2-1.${S}`), jointVerts(`finger5-1.${S}`), jointVerts(`finger3-3.${S}!`));
const nVirt = pivotVerts.length;
const meanOf = (ids, A) => { const c = [0, 0, 0]; for (const i of ids) { c[0] += A[i][0]; c[1] += A[i][1]; c[2] += A[i][2]; } return c.map(x => x / ids.length); };

// ------------------------------------------------------------------ skin weights -> top 4 collapsed bones
const acc = Array.from({ length: nMesh }, () => new Map());
for (const [mhBone, list] of Object.entries(mhw)) {
  const b = boneIndex[mhToBone[mhBone] || 'head'];
  for (const [vi, w] of list) {
    const k = remap.get(vi); if (k === undefined) continue;
    acc[k].set(b, (acc[k].get(b) || 0) + w);
  }
}
const skinIdx = new Uint8Array(nMesh * 4), skinW = new Uint8Array(nMesh * 4);
let unweighted = 0;
for (let i = 0; i < nMesh; i++) {
  let arr = [...acc[i].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (isEye[i]) arr = [[boneIndex.head, 1]];
  if (!arr.length) { arr = [[boneIndex.chest, 1]]; unweighted++; }
  const s = arr.reduce((t, e) => t + e[1], 0);
  let q = arr.map(e => Math.round(e[1] / s * 255));
  q[0] += 255 - q.reduce((t, x) => t + x, 0);
  for (let k = 0; k < 4; k++) { skinIdx[i * 4 + k] = arr[k] ? arr[k][0] : arr[0][0]; skinW[i * 4 + k] = arr[k] ? q[k] : 0; }
}

// part labels (dominant bone group): 0 torso, 1 head/neck, 2 armL, 3 armR, 4 legL, 5 legR, 6 eye
const PARTS = ['torso', 'head', 'armL', 'armR', 'legL', 'legR', 'eye'];
const boneGroup = BONES.map(([n]) => {
  if (/^(pelvis|spine|chest|clav)/.test(n)) return 0;
  if (/^(neck|head)/.test(n)) return 1;
  if (/L$/.test(n)) return /^(thigh|shin|foot)/.test(n) ? 4 : 2;
  return /^(thigh|shin|foot)/.test(n) ? 5 : 3;
});
const part = new Uint8Array(nMesh);
for (let i = 0; i < nMesh; i++) {
  if (isEye[i]) { part[i] = 6; continue; }
  const g = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 4; k++) g[boneGroup[skinIdx[i * 4 + k]]] += skinW[i * 4 + k];
  part[i] = g.indexOf(Math.max(...g));
}

// ------------------------------------------------------------------ positions (mesh + virtual pivots)
const POS = [];
for (const o of order) POS.push(P0[o]);
for (const ids of pivotVerts) POS.push(meanOf(ids, P0));
const N = POS.length;
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify({ POS, part: [...part], tris: [...triIdx], nMesh }));

// morph deltas for the macro grid (sparse), incl. pivots
const sparseMorph = (T, name) => {
  const entries = [];
  for (let k = 0; k < nMesh; k++) { const d = T.get(order[k]); if (d && (d[0] || d[1] || d[2])) entries.push([k, d]); }
  pivotVerts.forEach((ids, j) => {
    const c = [0, 0, 0]; for (const i of ids) { const d = T.get(i); if (d) { c[0] += d[0]; c[1] += d[1]; c[2] += d[2]; } }
    if (c[0] || c[1] || c[2]) entries.push([nMesh + j, c.map(x => x / ids.length)]);
  });
  return { name, entries };
};
const morphs = TG.map((T, ti) => sparseMorph(T, GRID[ti]));
const cupMorphs = TC.map((T, ci) => sparseMorph(T, CUPS[ci]));

// ------------------------------------------------------------------ landmark descriptors (on the default shape)
const pivot = (name, tail = false) => POS[nMesh + boneIndex[name] * 2 + (tail ? 1 : 0)];
let minY = Infinity, maxY = -Infinity, topV = 0, soleV = 0;
for (let i = 0; i < nMesh; i++) if (!isEye[i]) { const y = POS[i][1]; if (y < minY) { minY = y; soleV = i; } if (y > maxY) { maxY = y; topV = i; } }
// midline vertices
const mid = []; for (let i = 0; i < nMesh; i++) if (!isEye[i] && Math.abs(POS[i][0]) < 1e-4) mid.push(i);
// crotch: lowest midline vertex above the knees
let crotchV = -1; for (const i of mid) { const y = POS[i][1]; if (y > pivot('shinL')[1] + 1 && y < POS[NAVEL][1] && (crotchV < 0 || y < POS[crotchV][1])) crotchV = i; }
// buttock: most posterior midline-adjacent point between crotch and navel (glutes are off-midline: use |x|<1.2)
let buttV = -1;
for (let i = 0; i < nMesh; i++) {
  if (isEye[i] || part[i] === 2 || part[i] === 3) continue;
  const p = POS[i]; if (p[1] < POS[crotchV][1] || p[1] > POS[NAVEL][1] || Math.abs(p[0]) > 1.2) continue;
  if (buttV < 0 || p[2] < POS[buttV][2]) buttV = i;
}
// chin (menton): lowest midline point of the face that is in front of the throat
const headY = pivot('head')[1];
let chinV = -1;
for (const i of mid) { const p = POS[i]; if (p[1] > pivot('neck')[1] + 0.2 && p[1] < headY + 0.3 && p[2] > 1.2 && (chinV < 0 || p[1] < POS[chinV][1])) chinV = i; }
const nippleV = skel.joints[skel.bones['breast.L'].tail][0];

// girth profile helper on the default shape: convex-hull perimeter of a plane slice through filtered triangles
function sliceGirth(o, n, triOk, maxR = 99) {
  let u = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const d = u[0] * n[0] + u[1] * n[1] + u[2] * n[2]; u = norm([u[0] - d * n[0], u[1] - d * n[1], u[2] - d * n[2]]);
  const v = cross(n, u);
  const pts = [];
  for (let t = 0; t < triIdx.length; t += 3) {
    if (!triOk(triIdx[t], triIdx[t + 1], triIdx[t + 2])) continue;
    for (let e = 0; e < 3; e++) {
      const a = POS[triIdx[t + e]], b = POS[triIdx[t + (e + 1) % 3]];
      const da = (a[0] - o[0]) * n[0] + (a[1] - o[1]) * n[1] + (a[2] - o[2]) * n[2];
      const db = (b[0] - o[0]) * n[0] + (b[1] - o[1]) * n[1] + (b[2] - o[2]) * n[2];
      if ((da < 0) === (db < 0)) continue;
      const s = da / (da - db), q = [a[0] + (b[0] - a[0]) * s - o[0], a[1] + (b[1] - a[1]) * s - o[1], a[2] + (b[2] - a[2]) * s - o[2]];
      const x = q[0] * u[0] + q[1] * u[1] + q[2] * u[2], y = q[0] * v[0] + q[1] * v[1] + q[2] * v[2];
      if (x * x + y * y < maxR * maxR) pts.push([x, y]);
    }
  }
  return hullPerimeter(pts);
}
function hullPerimeter(pts) {
  if (pts.length < 3) return 0;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let per = 0; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return per;
}
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const allOf = (set) => (a, b, c) => set.has(part[a]) && set.has(part[b]) && set.has(part[c]);

// search a fraction t in [t0,t1] between joints A and B that maximizes / minimizes the girth
function profile(A, B, triOk, t0, t1, mode, maxR) {
  const n = norm(sub(B, A)); let best = null;
  for (let t = t0; t <= t1 + 1e-9; t += 0.01) {
    const g = sliceGirth(lerp(A, B, t), n, triOk, maxR);
    if (g > 0 && (!best || (mode === 'max' ? g > best.g : g < best.g))) best = { t: +t.toFixed(2), g };
  }
  return best;
}
const legL = allOf(new Set([4])), armL = allOf(new Set([2])), headP = allOf(new Set([1, 0]));
const kneeL = pivot('shinL'), ankleL = pivot('footL'), hipL = pivot('thighL');
const shL = pivot('uarm1L'), elL = pivot('farm1L'), wrL = pivot('handL');
const calf = profile(kneeL, ankleL, legL, 0.15, 0.6, 'max', 1.2);
const ankle = profile(kneeL, ankleL, legL, 0.7, 0.93, 'min', 1.0);
const biceps = profile(shL, elL, armL, 0.45, 0.75, 'max', 0.9);
const forearm = profile(elL, wrL, armL, 0.12, 0.45, 'max', 0.8);
const wrist = profile(elL, wrL, armL, 0.85, 1.0, 'min', 0.6);
const neckB = pivot('neck'), chinP = POS[chinV];
const neckMin = profile([0, neckB[1], neckB[2]], [0, chinP[1], pivot('head')[2]], headP, 0.2, 0.75, 'min', 1.2);

const lm = {
  topV, soleV, navelV: NAVEL, nippleV, crotchV, buttV, chinV,
  calfT: calf.t, ankleT: ankle.t, bicepsT: biceps.t, forearmT: forearm.t, wristT: wrist.t, neckT: neckMin.t,
};
// female: inframammary fold (imfV) = the lowest point of the left breast, i.e. the lowest front-facing vertex the
// max-cup morph moves noticeably (> 25 % of its peak) in the nipple's column; the fit anchors it to anthro's
// underbust height so the bust and underbust stations land on the breast and on the ribcage below it.
if (FEMALE) {
  const T = TC[CUPS.indexOf('maxcup')], xN = POS[nippleV][0];
  let dMax = 0; for (const [i, d] of T) if (remap.has(i)) dMax = Math.max(dMax, Math.hypot(d[0], d[1], d[2]));
  let imf = -1;
  for (const [i, d] of T) {
    const k = remap.get(i); if (k === undefined || part[k] !== 0) continue;
    const p = POS[k]; if (Math.hypot(d[0], d[1], d[2]) < 0.25 * dMax || Math.abs(p[0] - xN) > 0.3 || p[1] > POS[nippleV][1]) continue;
    if (imf < 0 || p[1] < POS[imf][1]) imf = k;
  }
  lm.imfV = imf;
}
const IN = 3.937008, fy = y => ((y - minY) * IN).toFixed(2);
console.log('height (in)', ((maxY - minY) * IN).toFixed(2), ' verts', nMesh, '+', nVirt, 'virtual  tris', triIdx.length / 3, ' unweighted', unweighted);
console.log('landmarks y(in): navel', fy(POS[NAVEL][1]), 'nipple', fy(POS[nippleV][1]), 'crotch', fy(POS[crotchV][1]), 'buttock', fy(POS[buttV][1]),
  'chin', fy(POS[chinV][1]), 'knee', fy(kneeL[1]), 'ankleJ', fy(ankleL[1]), 'shoulderJ', fy(shL[1]), 'neckBase', fy(neckB[1]));
if (FEMALE) console.log('female: imf y(in)', fy(POS[lm.imfV][1]), 'nipple x/z (dm)', POS[nippleV][0].toFixed(3), POS[nippleV][2].toFixed(3));
console.log('profiles', JSON.stringify({ calf, ankle, biceps, forearm, wrist, neckMin }, (k, v) => typeof v === 'number' ? +(k === 'g' ? v * IN : v).toFixed(3) : v));

// ------------------------------------------------------------------ pack
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (const p of POS) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
const qScale = mx.map((m, k) => (m - mn[k]) / 65535);
const posQ = new Uint16Array(N * 3);
POS.forEach((p, i) => { for (let k = 0; k < 3; k++) posQ[i * 3 + k] = Math.round((p[k] - mn[k]) / qScale[k]); });

const chunks = []; let off = 0; const layout = {};
function put(name, arr, extra = {}) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  layout[name] = { offset: off, length: arr.length, type: arr.constructor.name, ...extra };
  chunks.push(bytes); off += bytes.length;
  const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
}
put('position', posQ, { min: mn, scale: qScale });
put('index', triIdx);
put('skinIndex', skinIdx);
put('skinWeight', skinW);
put('part', part);
const packMorph = (m, prefix, list) => {
  let amax = 0; for (const [, d] of m.entries) for (const x of d) amax = Math.max(amax, Math.abs(x));
  const sc = amax / 32767 || 1;
  const idx = new Uint16Array(m.entries.length), dq = new Int16Array(m.entries.length * 3);
  m.entries.forEach(([k, d], j) => { idx[j] = k; for (let a = 0; a < 3; a++) dq[j * 3 + a] = Math.round(d[a] / sc); });
  const name = prefix + m.name;
  put(name + ':i', idx); put(name + ':d', dq, { scale: sc });
  list.push({ name: m.name, index: name + ':i', delta: name + ':d' });
};
layout.morphs = [];
for (const m of morphs) packMorph(m, 'morph:', layout.morphs);
if (FEMALE) { layout.cups = []; for (const m of cupMorphs) packMorph(m, 'cup:', layout.cups); }
const bin = Buffer.concat(chunks.map(c => Buffer.from(c)));
const meta = {
  format: 'forge-body-mesh', version: 1,
  source: { repo: 'https://github.com/makehumancommunity/makehuman', commit: 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482', license: 'CC0-1.0',
    files: ['makehuman/data/3dobjs/base.obj', 'makehuman/data/rigs/default.mhskel', 'makehuman/data/rigs/default_weights.mhw', 'makehuman/data/targets/macrodetails/*'] },
  units: 'dm', up: 'y', front: '+z', left: '+x',
  ethnicMix: ETHNIC,
  counts: { vertices: N, mesh: nMesh, pivots: nPiv, aux: nVirt - nPiv, triangles: triIdx.length / 3 },
  parts: PARTS,
  aux: Object.fromEntries(AUX.map((n, i) => [n, nMesh + nPiv + i])),
  bones: BONES.map(([name, parent], i) => ({ name, parent: parent ? boneIndex[parent] : -1, head: nMesh + i * 2, tail: nMesh + i * 2 + 1, group: boneGroup[i] })),
  landmarks: lm,
  layout,
};
if (FEMALE) {   // (the male meta keeps its exact pre-female bytes: no `sex` key means male)
  meta.sex = 'female';
  meta.source.files.push('makehuman/data/targets/breast/female-young-averagemuscle-averageweight-{min,max}cup-averagefirmness.target');
}
const BASE = FEMALE ? 'body-female' : 'body';
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, BASE + '.bin'), bin);
fs.writeFileSync(path.join(OUT, BASE + '.json'), JSON.stringify(meta));
console.log('wrote', path.join(OUT, BASE + '.bin'), (bin.length / 1024).toFixed(1) + ' KB;', BASE + '.json', (JSON.stringify(meta).length / 1024).toFixed(1) + ' KB');
console.log('morph entries', morphs.map(m => m.name + ':' + m.entries.length).join(' ') + (FEMALE ? '  cups ' + cupMorphs.map(m => m.name + ':' + m.entries.length).join(' ') : ''));
