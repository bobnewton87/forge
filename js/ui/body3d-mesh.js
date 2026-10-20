// 3D physique viewer, MESH variant (CONTRACT §16 + §16b). Raw WebGL2, no libraries, no build step.
//
// A real human base mesh (MakeHuman hm08, CC0; see assets/body/LICENSE-ASSETS.md) is deformed to the
// user's tape measurements:
//   1. MakeHuman macro targets (muscle × weight grid) give the body its muscular / fat character, per region
//      (muscle scores) and from body-fat %.
//   2. The mesh is posed into anthro.js' rest pose (arms hanging, palms to thighs) with linear-blend skinning.
//   3. In that pose every landmark height is remapped (monotone cubic) onto anthro's heights, the arm joints
//      are moved onto anthro's joints, and horizontal cross-sections are scaled about their centres so the
//      convex-hull perimeter (what a tape reads) hits anthro's section at every profile station (all tape
//      sites incl. the shoulders loop around both arms), with smooth interpolation in between.
//   4. The fitted pose is un-skinned back to the bind pose, so every other pose is plain skinning.
//
//   mountBody3D(el, { shape, muscle, bodyFatPct, pose, compareShape, autoRotate, height, showScale, showPoses, onPose })
//     → { update(opts), setPose(name), destroy() }
//   POSES, supported()
//
// CONTRACT-NOTE (extras, all optional):
//   - compareShape may carry its own bodyFatPct / muscle (else the main body's are used). It is drawn as a
//     translucent Fresnel ghost (depth-tested against the main body, so you see where "now" sticks out).
//   - showScale (default false) draws a height ruler; showPoses (default true) renders pose chips;
//     onPose(name) is called when a chip is tapped; label (string) draws a corner caption.
//   - Handle extras: canvas, getPose(), stats() → { fitMs, frameMs, verts, tris }, setView(yawRad, pitchRad).
//   - Pure helpers for tests/tools: decodeBodyAsset, fitBody, poseGlobals, skinMatrices, skinPositions,
//     sliceHull, flexGirthAt, POSE_SPECS.
//   - Flexed poses (front/back double biceps, side chest) bulge the upper arm to the flexed biceps tape
//     (anthro: arm/forearm tapes are flexed; the hanging rest arm uses the relaxed girth).
import { bodyGeometry } from '../engine/anthro.js';

export const POSES = ['relaxed', 'front_double_biceps', 'lat_spread', 'side_chest', 'back_double_biceps'];
const POSE_LABEL = {
  relaxed: 'Relaxed', front_double_biceps: 'Front double bi', lat_spread: 'Lat spread',
  side_chest: 'Side chest', back_double_biceps: 'Back double bi',
};
const IN = 3.937007874;     // inches per MakeHuman decimetre
const DEF_SHAPE = { neck: 15, shoulders: 46, chest: 39, waist: 33, hips: 38, arm: 13, forearm: 11, thigh: 22, calf: 14.5, heightIn: 69 };
const DEF_MUSCLE = { chest: 0.4, delts: 0.4, lats: 0.4, arms: 0.4, abs: 0.4, quads: 0.5, calves: 0.5, traps: 0.4 };
const DEF_BF = 18;
const TRUNK_SKIP = new Set(['crotch', 'shoulder', 'acromion', 'trap', 'neckBase', 'chin']);
const ARM_SKIP = new Set(['armTop', 'deltoid']);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let cachedSupport = null;
export function supported() {
  if (cachedSupport !== null) return cachedSupport;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    cachedSupport = !!gl;
    const lose = gl && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) { cachedSupport = false; }
  return cachedSupport;
}

// ================================================================== vector / quaternion math
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = a => Math.hypot(a[0], a[1], a[2]);
const vnorm = a => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vlerp = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const mirrorX = a => [-a[0], a[1], a[2]];
const QI = () => [0, 0, 0, 1];
function qAxis(axis, ang) { const a = vnorm(axis), s = Math.sin(ang / 2); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(ang / 2)]; }
function qMul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
const qConj = q => [-q[0], -q[1], -q[2], q[3]];
function qRot(q, v) {
  const [x, y, z, w] = q; const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
function qFromMat(m) { // m: [c0x,c0y,c0z, c1x,c1y,c1z, c2x,c2y,c2z] column-major
  const m00 = m[0], m10 = m[1], m20 = m[2], m01 = m[3], m11 = m[4], m21 = m[5], m02 = m[6], m12 = m[7], m22 = m[8];
  const tr = m00 + m11 + m22; let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  const l = Math.hypot(...q); return q.map(x => x / l);
}
// rotation taking frame (a0, b0) to (a1, b1); a*, b* need not be exactly orthogonal (b is orthogonalised)
function qFrames(a0, b0, a1, b1) {
  const f = (a, b) => { const x = vnorm(a); const y = vnorm(vsub(b, vmul(x, vdot(b, x)))); return [x, y, vcross(x, y)]; };
  const F0 = f(a0, b0), F1 = f(a1, b1);
  // R = F1 * F0^T
  const R = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) { let s = 0; for (let k = 0; k < 3; k++) s += F1[k][r] * F0[k][c]; R[c * 3 + r] = s; }
  return qFromMat(R);
}
function qFromTo(a, b) {
  const u = vnorm(a), v = vnorm(b); const d = vdot(u, v);
  if (d > 0.999999) return QI();
  if (d < -0.999999) { let ax = vcross([1, 0, 0], u); if (vlen(ax) < 1e-6) ax = vcross([0, 1, 0], u); return qAxis(ax, Math.PI); }
  const c = vcross(u, v); const q = [c[0], c[1], c[2], 1 + d]; const l = Math.hypot(...q); return q.map(x => x / l);
}
function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; let bb = b;
  if (d < 0) { d = -d; bb = b.map(x => -x); }
  if (d > 0.9995) { const q = a.map((x, i) => x + (bb[i] - x) * t); const l = Math.hypot(...q); return q.map(x => x / l); }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((x, i) => x * wa + bb[i] * wb);
}
// signed twist angle about axis n taking vector a to vector b (both projected onto the plane ⊥ n)
function twistAngle(n, a, b) {
  const pa = vnorm(vsub(a, vmul(n, vdot(a, n)))), pb = vnorm(vsub(b, vmul(n, vdot(b, n))));
  return Math.atan2(vdot(vcross(pa, pb), n), vdot(pa, pb));
}

// ================================================================== small numerics
// Monotone cubic (Fritsch–Carlson / PCHIP) through (xs, ys); xs strictly increasing.
function pchip(xs, ys) {
  const n = xs.length, d = new Array(n).fill(0);
  if (n === 1) return { xs, ys, d };
  const h = [], del = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; del[i] = (ys[i + 1] - ys[i]) / h[i]; }
  if (n === 2) { d[0] = d[1] = del[0]; return { xs, ys, d }; }
  for (let i = 1; i < n - 1; i++) {
    if (del[i - 1] * del[i] <= 0) d[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]); }
  }
  const end = (h0, h1, d0, d1) => {
    let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(s) !== Math.sign(d0)) s = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0;
    return s;
  };
  d[0] = end(h[0], h[1], del[0], del[1]); d[n - 1] = end(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
  return { xs, ys, d };
}
function pchipEval(c, x, extrapolate = false) {
  const { xs, ys, d } = c, n = xs.length;
  if (n === 1) return ys[0];
  if (x <= xs[0]) return extrapolate ? ys[0] + d[0] * (x - xs[0]) : ys[0];
  if (x >= xs[n - 1]) return extrapolate ? ys[n - 1] + d[n - 1] * (x - xs[n - 1]) : ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const hh = xs[hi] - xs[lo], t = (x - xs[lo]) / hh, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * hh * d[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * hh * d[hi];
}
// convex hull (monotone chain) of [x, z] points → { per, minx, maxx, minz, maxz }
export function hull2(pts) {
  const out = { per: 0, minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity, n: pts.length };
  for (const p of pts) { if (p[0] < out.minx) out.minx = p[0]; if (p[0] > out.maxx) out.maxx = p[0]; if (p[1] < out.minz) out.minz = p[1]; if (p[1] > out.maxz) out.maxz = p[1]; }
  if (pts.length < 3) return out;
  const s = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = s.length - 1; i >= 0; i--) { const p = s[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; out.per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  out.hull = h;
  return out;
}
// triangles bucketed by the 1-unit height bands they span (crossing searches touch only one bucket)
function triBins(pos, tris) {
  const bins = new Map();
  for (let k = 0; k < tris.length; k += 3) {
    const y0 = pos[tris[k] * 3 + 1], y1 = pos[tris[k + 1] * 3 + 1], y2 = pos[tris[k + 2] * 3 + 1];
    const lo = Math.floor(Math.min(y0, y1, y2)), hi = Math.floor(Math.max(y0, y1, y2));
    for (let b = lo; b <= hi; b++) { let arr = bins.get(b); if (!arr) bins.set(b, arr = []); arr.push(k); }
  }
  return bins;
}
// edges of the triangles accepted by `ok(i0,i1,i2)` that cross the horizontal plane y = Y → {a, b, t}
function crossings(pos, tris, ok, Y, bins) {
  const a = [], b = [], t = [];
  const cand = bins ? (bins.get(Math.floor(Y)) || []) : null, nc = cand ? cand.length : tris.length / 3;
  for (let c = 0; c < nc; c++) {
    const k = cand ? cand[c] : c * 3;
    const i0 = tris[k], i1 = tris[k + 1], i2 = tris[k + 2];
    const y0 = pos[i0 * 3 + 1], y1 = pos[i1 * 3 + 1], y2 = pos[i2 * 3 + 1];
    if ((y0 < Y && y1 < Y && y2 < Y) || (y0 >= Y && y1 >= Y && y2 >= Y)) continue;
    if (!ok(i0, i1, i2)) continue;
    const E = [[i0, i1, y0, y1], [i1, i2, y1, y2], [i2, i0, y2, y0]];
    for (const [p, q, yp, yq] of E) if ((yp < Y) !== (yq < Y)) { a.push(p); b.push(q); t.push((Y - yp) / (yq - yp)); }
  }
  return { a, b, t };
}
function crossPoints(pos, cx) {
  const pts = new Array(cx.a.length);
  for (let k = 0; k < cx.a.length; k++) {
    const i = cx.a[k] * 3, j = cx.b[k] * 3, t = cx.t[k];
    pts[k] = [pos[i] + (pos[j] - pos[i]) * t, pos[i + 2] + (pos[j + 2] - pos[i + 2]) * t];
  }
  return pts;
}
/** Horizontal slice of a mesh: convex-hull perimeter ("tape") of the triangles accepted by `ok` at height Y. */
export function sliceHull(pos, tris, ok, Y, filterPt = null) {
  let pts = crossPoints(pos, crossings(pos, tris, ok, Y));
  if (filterPt) pts = pts.filter(filterPt);
  return hull2(pts);
}

// ================================================================== asset
/** Decode body.json + body.bin (ArrayBuffer) into typed arrays. Units stay MakeHuman decimetres. */
export function decodeBodyAsset(meta, buf) {
  const L = meta.layout;
  const T = { Uint16Array, Int16Array, Uint8Array, Float32Array, Int32Array, Uint32Array };
  const view = name => new T[L[name].type](buf, L[name].offset, L[name].length);
  const N = meta.counts.vertices, nMesh = meta.counts.mesh;
  const q = view('position'), mn = L.position.min, sc = L.position.scale;
  const base = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) base[i] = mn[i % 3] + q[i] * sc[i % 3];
  const skinIdx = new Uint8Array(view('skinIndex'));
  const sw = view('skinWeight'), skinW = new Float32Array(sw.length);
  for (let i = 0; i < sw.length; i++) skinW[i] = sw[i] / 255;
  const morphs = L.morphs.map(m => {
    const idx = new Uint16Array(view(m.index)), dq = view(m.delta), s = L[m.delta].scale, d = new Float32Array(dq.length);
    for (let i = 0; i < dq.length; i++) d[i] = dq[i] * s;
    return { name: m.name, idx, d };
  });
  const bones = meta.bones;
  const B = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const asset = { meta, N, nMesh, base, tris: new Uint16Array(view('index')), skinIdx, skinW, part: new Uint8Array(view('part')), morphs, bones, B, lm: meta.landmarks, aux: meta.aux };
  prepareAsset(asset);
  return asset;
}
let assetPromise = null;
export function loadBodyAsset(baseUrl) {
  if (!assetPromise) {
    const base = baseUrl || new URL('../../assets/body/', import.meta.url);
    assetPromise = Promise.all([
      fetch(new URL('body.json', base)).then(r => { if (!r.ok) throw new Error('body.json ' + r.status); return r.json(); }),
      fetch(new URL('body.bin', base)).then(r => { if (!r.ok) throw new Error('body.bin ' + r.status); return r.arrayBuffer(); }),
    ]).then(([m, b]) => decodeBodyAsset(m, b)).catch(e => { assetPromise = null; throw e; });
  }
  return assetPromise;
}

// per-vertex bone-group weights, arm segment weights, smooth normals of the default shape, muscle region masks
function prepareAsset(A) {
  const { nMesh, skinIdx, skinW, bones, base, B } = A;
  const grp = new Float32Array(nMesh * 6), seg = new Float32Array(nMesh * 3);
  const segOf = bones.map(b => (/^uarm/.test(b.name) ? 0 : /^farm/.test(b.name) ? 1 : /^(hand|fing|thumb)/.test(b.name) ? 2 : -1));
  for (let i = 0; i < nMesh; i++) for (let k = 0; k < 4; k++) {
    const b = skinIdx[i * 4 + k], w = skinW[i * 4 + k]; if (!w) continue;
    grp[i * 6 + bones[b].group] += w;
    if (segOf[b] >= 0) seg[i * 3 + segOf[b]] += w;
  }
  A.grp = grp; A.seg = seg;
  {
    const hp = n => { const i = bones[B[n]].head; return [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]]; };
    A._front = ['L', 'R'].map(s => { const u = vnorm(vsub(hp('farm1' + s), hp('uarm1' + s))), f = vnorm(vsub(hp('hand' + s), hp('farm1' + s))); return vnorm(vsub(f, vmul(u, vdot(f, u)))); });
  }
  A.canonNormals = computeNormals(base, A.tris, nMesh);
  // muscle region masks on the default shape (decimetres)
  const P = (i) => [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
  const piv = name => P(bones[B[name]].head);
  const yNav = base[A.lm.navelV * 3 + 1], yNip = base[A.lm.nippleV * 3 + 1], yCr = base[A.lm.crotchV * 3 + 1];
  const shL = piv('uarm1L'), shR = piv('uarm1R'), yNeck = piv('neck')[1], yKnee = piv('shinL')[1], yChin = base[A.lm.chinV * 3 + 1];
  const REG = ['chest', 'delts', 'lats', 'arms', 'abs', 'quads', 'calves', 'traps'];
  const masks = new Float32Array(nMesh * 8);
  const band = (y, a, b, f = 0.25) => sstep(a - f, a + f, y) * (1 - sstep(b - f, b + f, y));
  for (let i = 0; i < nMesh; i++) {
    const p = P(i), nz = A.canonNormals[i * 3 + 2], nx = A.canonNormals[i * 3];
    const g = grp.subarray(i * 6, i * 6 + 6);
    const arm = g[2] + g[3], leg = g[4] + g[5], trunk = g[0] + g[1] * (p[1] < yChin ? 1 : 0);
    const dS = Math.min(vlen(vsub(p, shL)), vlen(vsub(p, shR)));
    const delt = (1 - sstep(0.55, 1.25, dS)) * (arm + trunk);
    const front = sstep(-0.15, 0.45, nz), back = sstep(-0.15, 0.45, -nz), lat = Math.abs(nx);
    const m = [
      trunk * front * band(p[1], yNip - 0.75, shL[1] + 0.25) * (1 - delt),            // chest
      delt,                                                                           // delts
      trunk * Math.max(back, lat * 0.8) * band(p[1], yNav + 0.2, shL[1] - 0.15) * (1 - delt), // lats
      arm * (1 - delt),                                                               // arms
      trunk * front * band(p[1], yCr + 0.45, yNip - 0.75),                            // abs
      leg * sstep(yKnee - 0.35, yKnee + 0.35, p[1]),                                  // quads (and glutes via legs)
      leg * (1 - sstep(yKnee - 0.35, yKnee + 0.35, p[1])),                            // calves
      (trunk * back * band(p[1], shL[1] - 0.7, yNeck + 1.2) + g[1] * (p[1] < yChin ? 1 : 0) * back) * (1 - delt * 0.5), // traps
    ];
    let s = m.reduce((t, x) => t + x, 0);
    const k = s > 1 ? 1 / s : 1;
    for (let r = 0; r < 8; r++) masks[i * 8 + r] = m[r] * k;
  }
  A.regions = REG; A.masks = masks;

  // Region sculpt fields (canonical dm, at full development). Applied before the fit, so the fit keeps every
  // girth exact and the sculpt only redistributes shape inside each cross-section.
  const SC = ['delts', 'chest', 'lats', 'traps', 'quads', 'calves', 'arms'];
  const R = SC.length, sculpt = new Float32Array(nMesh * 3 * R);
  const put = (i, r, v, k) => { if (!(k > 1e-5)) return; const o = (i * R + r) * 3; sculpt[o] += v[0] * k; sculpt[o + 1] += v[1] * k; sculpt[o + 2] += v[2] * k; };
  const xNip = Math.abs(base[A.lm.nippleV * 3]);
  const knL = piv('shinL'), ankL = piv('footL'), elL = piv('farm1L'), elR = piv('farm1R');
  const g2 = (d, w) => Math.exp(-(d * d) / (w * w));
  for (let i = 0; i < nMesh; i++) {
    if (A.part[i] === 6) continue;
    const p = P(i), n = [A.canonNormals[i * 3], A.canonNormals[i * 3 + 1], A.canonNormals[i * 3 + 2]];
    const g = grp.subarray(i * 6, i * 6 + 6);
    const arm = g[2] + g[3], leg = g[4] + g[5], trunk = g[0] + (p[1] < yChin ? g[1] : 0);
    const sg = p[0] >= 0 ? 1 : -1, ax = Math.abs(p[0]), S = sg > 0 ? shL : shR, E = sg > 0 ? elL : elR;
    const nl = n[0] * sg;   // lateral-facing component
    // delts: rounded cap about the shoulder joint, centred on the lateral head
    {
      const dc = [S[0] + sg * 0.2, S[1] - 0.32, S[2] + 0.02], rad = vnorm(vsub(p, S));
      const f = clamp(rad[0] * sg * 0.8 + 0.3, 0, 1) * (1 - sstep(-0.1, 0.45, rad[1]) * 0.6);
      put(i, 0, rad, 0.24 * g2(vlen(vsub(p, dc)), 0.62) * f * (arm + trunk));
    }
    // pecs: forward bulk with a crisp lower border that rises toward the armpit, fading at the clavicle
    if (trunk > 0 && n[2] > -0.1) {
      const lowY = yNip - 0.55 + 0.5 * sstep(0.55, 1.35, ax), upY = S[1] + 0.05;
      const inY = sstep(lowY - 0.05, lowY + 0.1, p[1]) * (1 - sstep(upY - 0.55, upY, p[1]));
      const inX = sstep(0.04, 0.22, ax) * (1 - sstep(1.2, 1.45, ax));
      const thick = inY * inX * (0.55 + 0.45 * (1 - sstep(yNip - 0.1, upY, p[1])));
      put(i, 1, vnorm([sg * 0.3, -0.05, 1]), 0.16 * thick * trunk * sstep(-0.1, 0.4, n[2]));
    }
    // lats: lateral push under the armpit tapering to the waist (V-taper)
    if (trunk > 0) {
      const yb = sstep(yNav + 0.15, yNip - 0.35, p[1]) * (1 - sstep(yNip + 0.2, yNip + 0.6, p[1]));
      const prof = 0.35 + 0.65 * sstep(yNav + 0.15, yNip + 0.15, p[1]);
      const f = clamp(-n[2] * 0.6 + nl * 0.8, 0, 1) * sstep(0.45, 0.9, ax);
      put(i, 2, vnorm([sg, 0, -0.3]), 0.2 * yb * prof * f * trunk);
    }
    // traps: upper trapezius slope from the neck to the acromion (up and back)
    {
      const tw = trunk + (p[1] < yChin ? g[1] : 0) * 0.6;
      if (tw > 0 && n[2] < 0.45) {
        const yb = sstep(S[1] - 0.35, S[1] + 0.05, p[1]) * (1 - sstep(yNeck - 0.05, yNeck + 0.35, p[1]));
        const xb = g2(ax - 0.55, 0.38) * (1 - sstep(S[0] * sg * 0.75, S[0] * sg, ax));
        put(i, 3, vnorm([sg * 0.1, 0.8, -0.45]), 0.2 * yb * xb * clamp(n[1] * 0.7 - n[2] * 0.5 + 0.2, 0, 1) * tw);
      }
    }
    // quads: vastus lateralis sweep, vastus medialis teardrop, rectus femoris
    if (leg > 0 && p[1] > yKnee + 0.2 && p[1] < yCr) {
      const t = (p[1] - yKnee) / (yCr - yKnee);
      put(i, 4, vnorm([sg, 0, 0.25]), 0.14 * g2(t - 0.45, 0.24) * Math.max(0, nl) * leg);
      put(i, 4, vnorm([-sg * 0.5, 0, 0.85]), 0.1 * g2(t - 0.17, 0.1) * clamp(-nl * 0.7 + n[2] * 0.5, 0, 1) * leg);
      put(i, 4, [0, 0, 1], 0.05 * g2(t - 0.55, 0.25) * Math.max(0, n[2]) * leg);
    }
    // calves: gastrocnemius heads (medial lower and fuller)
    if (leg > 0 && p[1] < yKnee && p[1] > ankL[1]) {
      const u = (yKnee - p[1]) / (yKnee - ankL[1]);
      const med = Math.max(0, -nl);
      put(i, 5, vnorm([-sg * 0.2, 0, -1]), 0.11 * g2(u - (0.27 + 0.05 * med), 0.14) * Math.max(0, -n[2]) * (0.8 + 0.4 * med) * leg);
    }
    // arms: biceps peak (front of the elbow fold) and triceps (back), radial from the humerus axis
    if (arm > 0) {
      const d = vsub(E, S), L2 = vdot(d, d), t = clamp(vdot(vsub(p, S), d) / L2, 0, 1);
      const r = vsub(p, vadd(S, vmul(d, t))), rn = vnorm(r);
      const fr = A._front ? A._front[sg > 0 ? 0 : 1] : [0, 0, 1];
      const c = vdot(rn, fr);
      put(i, 6, rn, (0.09 * g2(t - 0.58, 0.2) * Math.max(0, c) + 0.06 * g2(t - 0.4, 0.22) * Math.max(0, -c)) * arm);
    }
  }
  A.sculptRegions = SC; A.sculpt = sculpt;
  // hair / brows / eyes reference (canonical dm)
  let ey = 0, ex = 0, ez = 0, ne = 0;
  for (let i = 0; i < nMesh; i++) if (A.part[i] === 6) { ey += base[i * 3 + 1]; ex += Math.abs(base[i * 3]); ez += base[i * 3 + 2]; ne++; }
  A.eye = [ey / ne, ex / ne, ez / ne];
}
function computeNormals(pos, tris, n, out) {
  const N = out || new Float32Array(n * 3); N.fill(0);
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k] * 3, b = tris[k + 1] * 3, c = tris[k + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
  }
  for (let i = 0; i < n; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
  return N;
}
// cavity term: how far a vertex sits below the average of its neighbours, along its normal (0 = flat/convex)
function computeCavity(pos, nrm, tris, n) {
  const acc = new Float32Array(n * 3), cnt = new Float32Array(n), len = new Float32Array(n);
  const addN = (i, j) => {
    const jx = pos[j * 3], jy = pos[j * 3 + 1], jz = pos[j * 3 + 2], dx = jx - pos[i * 3], dy = jy - pos[i * 3 + 1], dz = jz - pos[i * 3 + 2];
    acc[i * 3] += jx; acc[i * 3 + 1] += jy; acc[i * 3 + 2] += jz; cnt[i]++; len[i] += Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k], b = tris[k + 1], c = tris[k + 2];
    addN(a, b); addN(b, a); addN(b, c); addN(c, b); addN(c, a); addN(a, c);
  }
  const cav = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!cnt[i]) continue;
    const dx = acc[i * 3] / cnt[i] - pos[i * 3], dy = acc[i * 3 + 1] / cnt[i] - pos[i * 3 + 1], dz = acc[i * 3 + 2] / cnt[i] - pos[i * 3 + 2];
    const h = (dx * nrm[i * 3] + dy * nrm[i * 3 + 1] + dz * nrm[i * 3 + 2]) / (len[i] / cnt[i] + 1e-6);
    cav[i] = clamp(h * 2.2, 0, 1);
  }
  // one smoothing pass
  const sm = new Float32Array(n), c2 = new Float32Array(n);
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k], b = tris[k + 1], c = tris[k + 2];
    sm[a] += cav[b] + cav[c]; sm[b] += cav[a] + cav[c]; sm[c] += cav[a] + cav[b]; c2[a] += 2; c2[b] += 2; c2[c] += 2;
  }
  for (let i = 0; i < n; i++) cav[i] = c2[i] ? 0.5 * cav[i] + 0.5 * sm[i] / c2[i] : cav[i];
  return cav;
}

// ================================================================== morphing (macro muscle × weight grid)
function muscleParam(score) { return clamp(0.35 + 0.65 * score, 0, 1); }
function weightParam(bf) { return clamp(0.5 + (bf - 20) / 28, 0.08, 1); }
function morphPositions(A, bf, muscle) {
  const P = Float32Array.from(A.base);
  const mu = { ...DEF_MUSCLE, ...(muscle || {}) };
  const reg = A.regions.map(r => muscleParam(clamp(num(mu[r]) ?? 0.4, 0, 1)));
  const mDef = muscleParam(A.regions.reduce((t, r) => t + clamp(num(mu[r]) ?? 0.4, 0, 1), 0) / A.regions.length);
  const w = weightParam(bf);
  const wv = { min: Math.max(0, 1 - 2 * w), max: Math.max(0, 2 * w - 1) }; wv.avg = 1 - wv.min - wv.max;
  const N = A.N, nMesh = A.nMesh, mv = new Float32Array(N * 3);   // per-vertex muscle min/avg/max weights
  for (let i = 0; i < N; i++) {
    let m = mDef;
    if (i < nMesh) { let s = 0, acc = 0; for (let r = 0; r < 8; r++) { const k = A.masks[i * 8 + r]; s += k; acc += k * reg[r]; } m = acc + (1 - s) * mDef; }
    const mn = Math.max(0, 1 - 2 * m), mx = Math.max(0, 2 * m - 1);
    mv[i * 3] = mn; mv[i * 3 + 1] = 1 - mn - mx; mv[i * 3 + 2] = mx;
  }
  const MI = { minmuscle: 0, averagemuscle: 1, maxmuscle: 2 };
  for (const m of A.morphs) {
    const [mk, wk] = m.name.split('-');
    const mi = MI[mk], ww = wv[wk.replace('weight', '')];
    if (!ww && mi === 1) continue;
    for (let j = 0; j < m.idx.length; j++) {
      const i = m.idx[j], k = mv[i * 3 + mi] * ww; if (!k) continue;
      P[i * 3] += k * m.d[j * 3]; P[i * 3 + 1] += k * m.d[j * 3 + 1]; P[i * 3 + 2] += k * m.d[j * 3 + 2];
    }
  }
  // region sculpt, scaled by each score (≈ flat at 0.3, full at 1) and softened by fat
  const R = A.sculptRegions.length, fat = 1 - 0.45 * sstep(14, 30, bf);
  const amp = A.sculptRegions.map(r => clamp(0.1 + 1.15 * clamp(num(mu[r]) ?? 0.4, 0, 1), 0, 1.25) * fat);
  for (let i = 0; i < nMesh; i++) for (let r = 0; r < R; r++) {
    const k = amp[r]; if (!k) continue;
    const o = (i * R + r) * 3; P[i * 3] += k * A.sculpt[o]; P[i * 3 + 1] += k * A.sculpt[o + 1]; P[i * 3 + 2] += k * A.sculpt[o + 2];
  }
  return P;
}

// ================================================================== skeleton, poses, skinning
const SIDES = ['L', 'R'];
function restSkeleton(A, P) {
  const nb = A.bones.length, heads = [], tails = [];
  for (let b = 0; b < nb; b++) {
    const h = A.bones[b].head, t = A.bones[b].tail;
    heads.push([P[h * 3], P[h * 3 + 1], P[h * 3 + 2]]); tails.push([P[t * 3], P[t * 3 + 1], P[t * 3 + 2]]);
  }
  const aux = {}; for (const [k, i] of Object.entries(A.aux)) aux[k] = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  return { heads, tails, aux };
}
// orientation frames of the bind pose (they do not change with the fit)
function restFrames(A, sk) {
  const H = n => sk.heads[A.B[n]];
  const F = {};
  for (const s of SIDES) {
    const S = H('uarm1' + s), E = H('farm1' + s), W = H('hand' + s), tip = sk.aux['fingertip' + s];
    const u0 = vnorm(vsub(E, S)), f0 = vnorm(vsub(W, E)), hd0 = vnorm(vsub(tip, W));
    let h0 = vcross(u0, f0); h0 = vlen(h0) > 1e-3 ? vnorm(h0) : [0, 0, 1];
    const k0 = vnorm(vsub(sk.aux['knuckleIndex' + s], sk.aux['knucklePinky' + s]));
    const p0 = vnorm(s === 'L' ? vcross(hd0, k0) : vcross(k0, hd0));
    const t0 = vnorm(vsub(H('shin' + s), H('thigh' + s))), s0 = vnorm(vsub(H('foot' + s), H('shin' + s)));
    F[s] = { u0, f0, hd0, h0, k0, p0, t0, s0 };
  }
  return F;
}
function boneLen(heads, A, a, b) { return vlen(vsub(heads[A.B[b]], heads[A.B[a]])); }

// Pose authoring: directions in body space (x = subject's left, y up, z forward) for the LEFT side; the right
// side mirrors x unless given. u = upper arm (shoulder→elbow), f = forearm (elbow→wrist), palm = palm normal.
export const POSE_SPECS = {
  relaxed: { view: { yaw: 0.32, pitch: 0.06 }, curl: 0.12, flex: 0 },
  // upper arms ~horizontal (abducted ~95°), elbows flexed ~110° so fists come up beside the head
  front_double_biceps: {
    view: { yaw: 0.0, pitch: 0.04 }, flex: 1, curl: 1, lat: 0.7,
    arm: { u: [0.985, -0.02, 0.17], f: [-0.1, 0.995, -0.03], palm: [-0.5, -0.1, -0.86] },
    clav: 4, legs: { t: [0.07, -1, 0.0], s: [0.035, -1, -0.02] },
  },
  // fists on the waist, elbows forward, lats flared
  lat_spread: {
    view: { yaw: 0.0, pitch: 0.04 }, flex: 0.3, curl: 1, lat: 1.6,
    ik: { target: 'waist', pole: [0.45, -0.1, 0.9] }, palm: [-0.4, 0.2, -0.9],
    clav: 3, chestScale: [1.02, 1, 1.02], legs: { t: [0.07, -1, 0.0], s: [0.035, -1, -0.02] },
  },
  // left side to the camera: hips turned ~15°, chest ~45°, chest lifted, front (left) arm across the body, hands clasped
  side_chest: {
    view: { yaw: 1.42, pitch: 0.05 }, flex: 0.85, curl: 1, lat: 0.4,
    pelvisTwist: 0.14, twist: 0.74, lean: -0.1, clav: 4,
    armL: { ik: { target: 'clasp', offset: [0.9, 0, -0.1], pole: [0.9, -0.25, -0.6] }, palm: [-0.2, 0.9, -0.3] },
    armR: { ik: { target: 'clasp', offset: [-0.9, -0.5, 0.5], pole: [-0.8, -0.55, -0.35] }, palm: [0.3, -0.2, -0.9] },
    chestScale: [1.0, 1, 1.05],
    legsL: { t: [0.06, -0.97, 0.24], s: [0.0, -0.99, -0.14] }, legsR: { t: [-0.05, -1, -0.03], s: [-0.03, -1, -0.02] },
  },
  // the front double biceps from behind: scapulae retracted, elbows slightly back
  back_double_biceps: {
    view: { yaw: Math.PI, pitch: 0.06 }, flex: 1, curl: 1, lat: 1.0, retract: 0.2,
    arm: { u: [0.98, -0.02, -0.17], f: [-0.1, 0.995, -0.06], palm: [-0.5, -0.1, -0.86] },
    clav: 7, legs: { t: [0.07, -1, 0.0], s: [0.035, -1, -0.02] },
  },
};

function twoBoneIK(S, T, Lu, Lf, pole) {
  let d = vsub(T, S); let L = vlen(d);
  L = clamp(L, Math.abs(Lu - Lf) + 1e-3, Lu + Lf - 1e-3);
  const dn = vnorm(d);
  const a = (Lu * Lu - Lf * Lf + L * L) / (2 * L), h = Math.sqrt(Math.max(0, Lu * Lu - a * a));
  const pn = vnorm(vsub(pole, vmul(dn, vdot(pole, dn))));
  const E = vadd(vadd(S, vmul(dn, a)), vmul(pn, h));
  return { u: vnorm(vsub(E, S)), f: vnorm(vsub(vadd(S, vmul(dn, L)), E)) };
}

/**
 * Global bone rotations for a pose. ctx = { A, rest (bind heads), frames, geom, sections }.
 * Returns { q: [quat per bone], scale: {boneIdx: [sx,sy,sz]}, flex: [L, R] }.
 */
export function poseGlobals(ctx, name) {
  const { A, frames } = ctx;
  const nb = A.bones.length, B = A.B, q = new Array(nb).fill(null).map(QI), scale = {};
  const spec = POSE_SPECS[name] || POSE_SPECS.relaxed;
  const heads = ctx.rest;
  // torso chain: pelvis turn, cumulative spine twist, chest lift (extension)
  const twist = spec.twist || 0, pt = spec.pelvisTwist || 0, lean = spec.lean || 0, Y = [0, 1, 0], X = [1, 0, 0];
  const qPel = qAxis(Y, pt);
  q[B.pelvis] = qPel;
  q[B.spine1] = qMul(qAxis(Y, mix(pt, twist, 0.3)), qAxis(X, lean * 0.3));
  q[B.spine2] = qMul(qAxis(Y, mix(pt, twist, 0.65)), qAxis(X, lean * 0.7));
  q[B.chest] = qMul(qAxis(Y, twist), qAxis(X, lean));
  q[B.neck] = qAxis(Y, twist * 1.02); q[B.head] = qAxis(Y, twist * 1.08);
  if (spec.chestScale) scale[B.chest] = spec.chestScale;
  for (const s of SIDES) {
    const sg = s === 'L' ? 1 : -1;
    const elev = (spec.clav || 0) * Math.PI / 180;
    q[B['clav' + s]] = qMul(q[B.chest], qMul(qAxis([0, 1, 0], sg * (spec.retract || 0)), qAxis([0, 0, 1], sg * elev)));
  }
  const qT = q[B.chest], bodyDir = v => qRot(qT, v);
  // FK helper to get the posed head of a bone from the current q (scale ignored for the IK targets)
  const posedHead = (bi) => {
    const chain = []; for (let b = bi; b >= 0; b = A.bones[b].parent) chain.unshift(b);
    let J = heads[chain[0]];
    for (let k = 1; k < chain.length; k++) { const p = chain[k - 1], c = chain[k]; J = vadd(J, qRot(q[p], vsub(heads[c], heads[p]))); }
    return J;
  };
  const armSpec = (s) => {
    const own = spec['arm' + s];
    if (own) return own;
    if (spec.arm) return s === 'L' ? spec.arm : { u: mirrorX(spec.arm.u), f: mirrorX(spec.arm.f), palm: mirrorX(spec.arm.palm) };
    if (spec.ik) return { ik: spec.ik, palm: s === 'L' ? spec.palm : mirrorX(spec.palm) };
    return null;
  };
  const order = spec.armR && spec.armR.ik ? ['L', 'R'] : ['L', 'R'];
  for (const s of order) {
    const F = frames[s], sg = s === 'L' ? 1 : -1;
    let u, f, palm;
    const as = armSpec(s);
    const S = posedHead(B['uarm1' + s]);
    const Lu = boneLen(heads, A, 'uarm1' + s, 'farm1' + s), Lf = boneLen(heads, A, 'farm1' + s, 'hand' + s);
    if (!as) { // relaxed: aim at anthro's rest joints
      const g = ctx.geom.joints;
      const gS = g['shoulder' + s], gE = g['elbow' + s], gW = g['wrist' + s];
      u = vnorm([gE.x - gS.x, gE.y - gS.y, gE.z - gS.z]); f = vnorm([gW.x - gE.x, gW.y - gE.y, gW.z - gE.z]);
      palm = [-sg, 0, 0.12];
    } else if (as.ik) {
      let T;
      const sec = ctx.sections || {};
      const w = sec.waist || { w: 6, d: 4.5, cz: 0, y: ctx.geom.landmarks.waist.y };
      if (as.ik.target === 'waist') {
        T = [sg * (w.w + 0.6), w.y + 0.8, w.cz - 0.6];
      } else if (as.ik.target === 'clasp') {   // in front of the abdomen, turned with the chest
        const C = [1.0 + as.ik.offset[0], w.y + 3.2 + as.ik.offset[1], w.cz + w.d + 2.2 + as.ik.offset[2]];
        T = qRot(qAxis(Y, twist * 0.85), C);
      }
      // the IK solves for the wrist; hand length is carried by the hand bone
      const pole = bodyDir(spec['arm' + s] ? as.ik.pole : (s === 'L' ? as.ik.pole : mirrorX(as.ik.pole)));
      ({ u, f } = twoBoneIK(S, T, Lu, Lf, pole));
      palm = bodyDir(as.palm || [-sg, 0, 0]);
    } else { u = bodyDir(vnorm(as.u)); f = bodyDir(vnorm(as.f)); palm = bodyDir(vnorm(as.palm)); }
    // hinge (elbow axis) and frames
    let h = vcross(u, f);
    if (vlen(h) < 0.05) h = qRot(qFromTo(F.u0, u), F.h0);
    h = vnorm(h);
    const qU = qFrames(F.u0, F.h0, u, h);
    const qSw = qFromTo(F.u0, u);
    const tw = 2 * Math.atan2(vdot([qMul(qConj(qSw), qU)[0], qMul(qConj(qSw), qU)[1], qMul(qConj(qSw), qU)[2]], F.u0), qMul(qConj(qSw), qU)[3]);
    q[B['uarm1' + s]] = qMul(qAxis(u, tw * 0.5), qSw);
    q[B['uarm2' + s]] = qU;
    let qF = qFrames(F.f0, F.h0, f, h);
    const pr = twistAngle(f, qRot(qF, F.p0), palm);
    q[B['farm1' + s]] = qMul(qAxis(f, pr * 0.5), qF);
    qF = qMul(qAxis(f, pr), qF);
    q[B['farm2' + s]] = qF;
    q[B['hand' + s]] = qF;
    // fingers: curl about the knuckle axis toward the palm
    const curl = spec.curl ?? 0.2;
    const kAx = qRot(qF, F.k0), pN = qRot(qF, F.p0), hd = qRot(qF, F.hd0);
    const sgn = Math.sign(vdot(vcross(kAx, hd), pN)) || 1;   // rotating hd toward the palm
    const c1 = qMul(qAxis(kAx, sgn * curl * 1.35), qF);
    q[B['fing1' + s]] = c1;
    q[B['fing2' + s]] = qMul(qAxis(kAx, sgn * curl * 1.45), c1);
    q[B['thumb' + s]] = qMul(qAxis(hd, -sg * curl * 0.35), qMul(qAxis(kAx, sgn * curl * 0.45), qF));
    if (s === 'L') { // remember the posed left wrist for two-handed poses
      const qtmp = q.slice();
      const J = (() => { let J0 = S; J0 = vadd(J0, qRot(qtmp[B['uarm2' + s]], vsub(heads[B['farm1' + s]], heads[B['uarm1' + s]]))); return vadd(J0, qRot(qF, vsub(heads[B['hand' + s]], heads[B['farm1' + s]]))); })();
      ctx._wristL = J;
    }
  }
  // legs
  for (const s of SIDES) {
    const F = frames[s];
    const ls = spec['legs' + s] || (spec.legs ? (s === 'L' ? spec.legs : { t: mirrorX(spec.legs.t), s: mirrorX(spec.legs.s) }) : null);
    let t, sh;
    if (!ls) {
      const g = ctx.geom.joints;
      const gH = g['hip' + s], gK = g['knee' + s], gA = g['ankle' + s];
      t = vnorm([gK.x - gH.x, gK.y - gH.y, gK.z - gH.z]); sh = vnorm([gA.x - gK.x, gA.y - gK.y, gA.z - gK.z]);
    } else { t = vnorm(ls.t); sh = vnorm(ls.s); }
    q[B['thigh' + s]] = qMul(qPel, qFromTo(F.t0, t));
    q[B['shin' + s]] = qMul(qPel, qFromTo(F.s0, sh));
    q[B['foot' + s]] = qPel;
  }
  return { q, scale, flex: spec.flex || 0, lat: spec.lat || 0 };
}

/** Skinning matrices (column-major 4×4 per bone) + posed joint heads, given bind heads and global rotations. */
export function skinMatrices(A, heads, pose, rootOffset = [0, 0, 0]) {
  const nb = A.bones.length, M = new Float32Array(nb * 16), J = new Array(nb);
  const lin = new Array(nb);   // 3×3 linear part (rotation × optional scale), column-major
  for (let b = 0; b < nb; b++) {
    const p = A.bones[b].parent, qb = pose.q[b];
    const R = quatMat(qb);
    const sc = pose.scale && pose.scale[b];
    const Lm = sc ? [R[0] * sc[0], R[1] * sc[0], R[2] * sc[0], R[3] * sc[1], R[4] * sc[1], R[5] * sc[1], R[6] * sc[2], R[7] * sc[2], R[8] * sc[2]] : R;
    lin[b] = Lm;
    if (p < 0) J[b] = vadd(heads[b], rootOffset);
    else { const d = vsub(heads[b], heads[p]); const Lp = lin[p]; J[b] = vadd(J[p], [Lp[0] * d[0] + Lp[3] * d[1] + Lp[6] * d[2], Lp[1] * d[0] + Lp[4] * d[1] + Lp[7] * d[2], Lp[2] * d[0] + Lp[5] * d[1] + Lp[8] * d[2]]); }
    // M = T(J) * L * T(-head)
    const h = heads[b], o = b * 16;
    M[o] = Lm[0]; M[o + 1] = Lm[1]; M[o + 2] = Lm[2]; M[o + 3] = 0;
    M[o + 4] = Lm[3]; M[o + 5] = Lm[4]; M[o + 6] = Lm[5]; M[o + 7] = 0;
    M[o + 8] = Lm[6]; M[o + 9] = Lm[7]; M[o + 10] = Lm[8]; M[o + 11] = 0;
    M[o + 12] = J[b][0] - (Lm[0] * h[0] + Lm[3] * h[1] + Lm[6] * h[2]);
    M[o + 13] = J[b][1] - (Lm[1] * h[0] + Lm[4] * h[1] + Lm[7] * h[2]);
    M[o + 14] = J[b][2] - (Lm[2] * h[0] + Lm[5] * h[1] + Lm[8] * h[2]);
    M[o + 15] = 1;
  }
  return { M, J };
}
function quatMat(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
}
/** CPU linear-blend skinning of the first n vertices of `pos`. */
export function skinPositions(A, pos, M, n = A.nMesh, out) {
  const o = out || new Float32Array(n * 3), { skinIdx, skinW } = A;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let rx = 0, ry = 0, rz = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinW[i * 4 + k]; if (!w) continue;
      const m = skinIdx[i * 4 + k] * 16;
      rx += w * (M[m] * x + M[m + 4] * y + M[m + 8] * z + M[m + 12]);
      ry += w * (M[m + 1] * x + M[m + 5] * y + M[m + 9] * z + M[m + 13]);
      rz += w * (M[m + 2] * x + M[m + 6] * y + M[m + 10] * z + M[m + 14]);
    }
    o[i * 3] = rx; o[i * 3 + 1] = ry; o[i * 3 + 2] = rz;
  }
  return o;
}
function unskinPositions(A, posed, M, n = A.nMesh) {
  const o = new Float32Array(n * 3), { skinIdx, skinW } = A, b = new Float64Array(12);
  for (let i = 0; i < n; i++) {
    b.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = skinW[i * 4 + k]; if (!w) continue;
      const m = skinIdx[i * 4 + k] * 16;
      for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) b[c * 3 + r] += w * M[m + c * 4 + r];
    }
    const px = posed[i * 3] - b[9], py = posed[i * 3 + 1] - b[10], pz = posed[i * 3 + 2] - b[11];
    const a = b[0], d = b[3], g = b[6], bb = b[1], e = b[4], h = b[7], c = b[2], f = b[5], k2 = b[8];
    const det = a * (e * k2 - f * h) - d * (bb * k2 - c * h) + g * (bb * f - c * e) || 1e-9;
    // inverse of [[a d g],[bb e h],[c f k2]]
    o[i * 3] = ((e * k2 - f * h) * px + (g * f - d * k2) * py + (d * h - g * e) * pz) / det;
    o[i * 3 + 1] = ((h * c - bb * k2) * px + (a * k2 - g * c) * py + (g * bb - a * h) * pz) / det;
    o[i * 3 + 2] = ((bb * f - e * c) * px + (d * c - a * f) * py + (a * e - d * bb) * pz) / det;
  }
  return o;
}

// ================================================================== fitting
function geometryFor(shape, bodyFatPct, muscle) {
  const sh = { ...DEF_SHAPE, ...(shape || {}) };
  const avg = (a, b) => (num(a) && num(b) ? (a + b) / 2 : num(a) ?? num(b));
  const limbs = {};
  for (const k of ['armL', 'armR', 'thighL', 'thighR', 'calfL', 'calfR']) if (num(sh[k])) limbs[k] = sh[k];
  for (const k of ['arm', 'thigh', 'calf']) if (!num(shape?.[k])) { const a = avg(sh[k + 'L'], sh[k + 'R']); if (a) sh[k] = a; }
  return bodyGeometry({ ...sh, limbs, bodyFatPct: num(bodyFatPct) ?? DEF_BF, muscle: { ...DEF_MUSCLE, ...(muscle || {}) }, sex: 'male' });
}

/**
 * Fit the base mesh to a body. Returns the bind-pose (rest) positions in inches, the bind skeleton, the
 * fitted relaxed-pose positions, and a report of every station.
 */
export function fitBody(A, opts = {}) {
  const t0 = now();
  const bf = num(opts.bodyFatPct) ?? DEF_BF;
  const geom = opts.geom || geometryFor(opts.shape, bf, opts.muscle);
  const H = geom.heightIn, LM = geom.landmarks, GJ = geom.joints;
  const { nMesh, N, B, bones, part, grp, seg, tris } = A;
  const nb = bones.length;

  // 1. morph, convert to inches, floor at 0
  const P = morphPositions(A, bf, opts.muscle);
  let minY = Infinity;
  for (let i = 0; i < nMesh; i++) if (part[i] !== 6 && P[i * 3 + 1] < minY) minY = P[i * 3 + 1];
  for (let i = 0; i < N; i++) { P[i * 3] *= IN; P[i * 3 + 1] = (P[i * 3 + 1] - minY) * IN; P[i * 3 + 2] *= IN; }
  const sk0 = restSkeleton(A, P);
  const frames = restFrames(A, sk0);

  // 2. pose the unfitted mesh into anthro's rest pose
  const ctx0 = { A, rest: sk0.heads, frames, geom };
  const relax = poseGlobals(ctx0, 'relaxed');
  const { M: M0, J: J0 } = skinMatrices(A, sk0.heads, relax);
  const Q = skinPositions(A, P, M0);
  let qMin = Infinity, qMax = -Infinity;
  for (let i = 0; i < nMesh; i++) if (part[i] !== 6) { const y = Q[i * 3 + 1]; if (y < qMin) qMin = y; if (y > qMax) qMax = y; }
  for (let i = 0; i < nMesh; i++) Q[i * 3 + 1] -= qMin;
  const Jq = J0.map(j => [j[0], j[1] - qMin, j[2]]);
  const auxBone = { fingertipL: 'fing2L', fingertipR: 'fing2R' };
  const tipQ = {};
  for (const s of SIDES) { const k = 'fingertip' + s, b = B[auxBone[k]] * 16, p = sk0.aux[k]; tipQ[s] = [M0[b] * p[0] + M0[b + 4] * p[1] + M0[b + 8] * p[2] + M0[b + 12], M0[b + 1] * p[0] + M0[b + 5] * p[1] + M0[b + 9] * p[2] + M0[b + 13] - qMin, M0[b + 2] * p[0] + M0[b + 6] * p[1] + M0[b + 10] * p[2] + M0[b + 14]]; }
  const Hm = qMax - qMin, hs = H / Hm;
  const qy = i => Q[i * 3 + 1];

  // 3a. vertical remap anchors (mesh height → anthro height), all in the rest pose
  const yKnee = Jq[B.shinL][1], yAnk = Jq[B.footL][1], yCr = qy(A.lm.crotchV);
  const anchors = [
    [0, 0],
    [yAnk, GJ.ankleL.y],
    [yKnee + A.lm.calfT * (yAnk - yKnee), LM.calf.y],
    [yKnee, GJ.kneeL.y],
    [yCr - 0.017 * Hm, LM.thigh.y],
    [yCr, LM.crotch.y],
    [qy(A.lm.buttV), LM.hip.y],
    [Jq[B.thighL][1], GJ.hipL.y],
    [qy(A.lm.navelV), LM.waist.y],
    [qy(A.lm.nippleV), LM.chest.y],
    [Jq[B.uarm1L][1], GJ.shoulderL.y],
    [Jq[B.neck][1], geom.heights.neckBase],
    [qy(A.lm.chinV), LM.chin.y],
    [Hm, H],
  ].sort((a, b) => a[0] - b[0]);
  const ax = [], ay = [];
  for (const [m, t] of anchors) if (!ax.length || (m > ax[ax.length - 1] + 0.05 && t > ay[ay.length - 1] + 0.05)) { ax.push(m); ay.push(t); }
  const ymap = pchip(ax, ay);
  const Y = y => pchipEval(ymap, y, true);
  const z0 = (Jq[B.uarm1L][2] + Jq[B.thighL][2]) / 2;

  // 3b. arm joint targets (anthro joints; the shoulder keeps the mesh's own depth)
  const armT = {};
  for (const s of SIDES) {
    const gS = GJ['shoulder' + s], gE = GJ['elbow' + s], gW = GJ['wrist' + s], gT = GJ['hand' + s];
    const S1 = [gS.x, gS.y, (Jq[B['uarm1' + s]][2] - z0) * hs];
    const E1 = vadd(S1, [gE.x - gS.x, gE.y - gS.y, gE.z - gS.z]);
    const W1 = vadd(E1, [gW.x - gE.x, gW.y - gE.y, gW.z - gE.z]);
    // the hand keeps its own (posed) direction; only its length follows anthro
    const restHand = vlen(vsub(sk0.aux['fingertip' + s], sk0.heads[B['hand' + s]]));
    const T1 = vadd(W1, vmul(vsub(tipQ[s], Jq[B['hand' + s]]), geom.segments.hand / restHand));
    armT[s] = { src: [Jq[B['uarm1' + s]], Jq[B['farm1' + s]], Jq[B['hand' + s]], tipQ[s]], dst: [S1, E1, W1, T1] };
  }
  if (opts.debug) opts.debug.armT = armT, opts.debug.Jq = Jq;
  const trunkMap = (x, y, z) => [x * hs, Y(y), (z - z0) * hs];
  const armMap = (s, x, y, z, w0, w1, w2) => {
    const T = armT[s]; let ox = 0, oy = 0, oz = 0; const ws = [w0, w1, w2], sw = w0 + w1 + w2 || 1;
    for (let k = 0; k < 3; k++) {
      if (!ws[k]) continue;
      const a = T.src[k], b = T.src[k + 1], a1 = T.dst[k], b1 = T.dst[k + 1];
      const d = vsub(b, a), L2 = vdot(d, d), rel = [x - a[0], y - a[1], z - a[2]];
      const t = vdot(rel, d) / L2, r = vsub(rel, vmul(d, t));
      const p = vadd(vadd(a1, vmul(vsub(b1, a1), t)), vmul(r, hs));
      ox += ws[k] * p[0]; oy += ws[k] * p[1]; oz += ws[k] * p[2];
    }
    return [ox / sw, oy / sw, oz / sw];
  };
  const V1 = new Float32Array(nMesh * 3);
  for (let i = 0; i < nMesh; i++) {
    const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2];
    let px = x * hs, py = Y(y), pz = (z - z0) * hs;
    const aL = grp[i * 6 + 2], aR = grp[i * 6 + 3];
    if (aL + aR > 1e-4) {
      const s = aL >= aR ? 'L' : 'R', a = aL + aR;
      const q = armMap(s, x, y, z, seg[i * 3], seg[i * 3 + 1], seg[i * 3 + 2]);
      px += (q[0] - px) * a; py += (q[1] - py) * a; pz += (q[2] - pz) * a;
    }
    V1[i * 3] = px; V1[i * 3 + 1] = py; V1[i * 3 + 2] = pz;
  }
  // mapped pivots
  const segOfBone = b => (/^uarm/.test(bones[b].name) ? 0 : /^farm/.test(bones[b].name) ? 1 : /^(hand|fing|thumb)/.test(bones[b].name) ? 2 : -1);
  const J1 = Jq.map((j, b) => {
    const sgb = segOfBone(b);
    if (sgb < 0) return trunkMap(j[0], j[1], j[2]);
    const s = bones[b].name.endsWith('L') ? 'L' : 'R';
    return armMap(s, j[0], j[1], j[2], sgb === 0 ? 1 : 0, sgb === 1 ? 1 : 0, sgb === 2 ? 1 : 0);
  });

  // 4. stations: horizontal sections scaled about their centres to anthro's sections
  const yCr1 = LM.crotch.y;
  const wbuf = new Float64Array(5), ebuf = new Float64Array(4);
  const stackW = (i, x, y, out = new Float64Array(5)) => {     // weights of [trunk, armL, armR, legL, legR]
    const o6 = i * 6, g4 = grp[o6 + 4], g5 = grp[o6 + 5];
    const up = sstep(yCr1 - 0.6, yCr1 + 1.2, y);
    const torso = grp[o6] + grp[o6 + 1];
    out[0] = (torso + g4 + g5) * up; out[1] = grp[o6 + 2]; out[2] = grp[o6 + 3];
    const left = P[i * 3] > 0;
    out[3] = (g4 + (left ? torso : 0)) * (1 - up); out[4] = (g5 + (left ? 0 : torso)) * (1 - up);
    return out;
  };
  const notArm = (a, b, c) => (part[a] < 2 || part[a] === 4 || part[a] === 5) && (part[b] < 2 || part[b] === 4 || part[b] === 5) && (part[c] < 2 || part[c] === 4 || part[c] === 5);
  const isPart = k => (a, b, c) => part[a] === k && part[b] === k && part[c] === k;
  const legSide = (sg) => (a, b, c) => (part[a] < 2 || part[a] > 3) && (part[b] < 2 || part[b] > 3) && (part[c] < 2 || part[c] > 3) && part[a] !== 6 &&
    P[a * 3] * sg > 0 && P[b * 3] * sg > 0 && P[c * 3] * sg > 0;   // side from the bind pose (legs apart)
  const stacks = [
    // upper-torso sections at deltoid/acromion/trap level are torso-only model values (not tapes) and the mesh's
    // part split there is ambiguous; the shoulders tape (loop around both arms) is enforced separately below.
    { name: 'trunk', ok: notArm, src: [...geom.profiles.torso.filter(s => !TRUNK_SKIP.has(s.name)), ...geom.profiles.neck.filter(s => s.name !== 'neckBase')] },
    { name: 'armL', ok: isPart(2), src: geom.profiles.armL.filter(s => !ARM_SKIP.has(s.name)), tail: 'hand' },
    { name: 'armR', ok: isPart(3), src: geom.profiles.armR.filter(s => !ARM_SKIP.has(s.name)), tail: 'hand' },
    { name: 'legL', ok: legSide(1), src: geom.profiles.legL.filter(s => s.name !== 'legTop'), tail: 'foot' },
    { name: 'legR', ok: legSide(-1), src: geom.profiles.legR.filter(s => s.name !== 'legTop'), tail: 'foot' },
  ];
  const touched = new Uint8Array(nMesh), bins = triBins(V1, tris);
  // the neck tape settles on the narrowest neck section between the neck base and the jaw
  let neckY = LM.neck.y;
  {
    let best = Infinity;
    for (let y = geom.heights.neckBase - 0.4; y <= LM.chin.y - 0.25; y += 0.1) {
      const g = hull2(crossPoints(V1, crossings(V1, tris, notArm, y, bins))).per;
      if (g > 0 && g < best) { best = g; neckY = y; }
    }
  }
  for (const st of stacks) {
    st.stations = st.src.map(s => ({ name: s.name, y: st.name === 'trunk' && s.name === 'neck' ? neckY : s.y, rx: s.rx, rz: s.rz, G: s.girth, cx: 0, cz: 0, kx: 1, kz: 1 })).sort((a, b) => a.y - b.y);
    for (const s of st.stations) {
      s.cross = crossings(V1, tris, st.ok, s.y, bins);
      for (const i of s.cross.a) touched[i] = 1; for (const i of s.cross.b) touched[i] = 1;
      const m = hull2(crossPoints(V1, s.cross));
      s.cx = st.name === 'trunk' ? 0 : (m.minx + m.maxx) / 2; s.cz = (m.minz + m.maxz) / 2;
      s.w0 = (m.maxx - m.minx) / 2; s.d0 = (m.maxz - m.minz) / 2; s.P0 = m.per;
      s.kx = m.per > 0 ? s.rx / s.w0 : 1; s.kz = m.per > 0 ? s.rz / s.d0 : 1;
      if (!(m.per > 0) || m.n < 6) s.dead = true;
    }
    st.stations = st.stations.filter(s => !s.dead);
  }
  // head pseudo-station: anthro head breadth/length about the head's own centre
  {
    const hc = geom.head.center.y; let mx = 0, zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < nMesh; i++) if ((part[i] === 1 || part[i] === 6) && V1[i * 3 + 1] > hc - 0.5) {
      mx = Math.max(mx, Math.abs(V1[i * 3])); zmin = Math.min(zmin, V1[i * 3 + 2]); zmax = Math.max(zmax, V1[i * 3 + 2]);
    }
    const tr = stacks[0];
    const head = { name: 'head', y: hc, rx: geom.head.rx, rz: geom.head.rz, cx: 0, cz: (zmin + zmax) / 2, kx: geom.head.rx / mx, kz: geom.head.rz / ((zmax - zmin) / 2), fixed: true };
    tr.stations.push(head, { ...head, name: 'top', y: H + 1 });
  }
  const buildProfiles = () => {
    for (const st of stacks) {
      const ys = st.stations.map(s => s.y);
      st.p = { kx: pchip(ys, st.stations.map(s => s.kx)), kz: pchip(ys, st.stations.map(s => s.kz)), cx: pchip(ys, st.stations.map(s => s.cx)), cz: pchip(ys, st.stations.map(s => s.cz)) };
      st.ylo = ys[0];
    }
  };
  const evalStack = (st, y, out = new Float64Array(4)) => {
    let kx = pchipEval(st.p.kx, y), kz = pchipEval(st.p.kz, y);
    const cx = pchipEval(st.p.cx, y), cz = pchipEval(st.p.cz, y);
    if (st.tail && y < st.ylo) { const f = sstep(st.ylo - (st.tail === 'hand' ? 1.8 : 1.2), st.ylo, y); kx = mix(1, kx, f); kz = mix(1, kz, f); }
    out[0] = kx; out[1] = kz; out[2] = cx; out[3] = cz;
    return out;
  };
  const deform = (src, out, idxList) => {
    const list = idxList || null, n = list ? list.length : nMesh;
    for (let k = 0; k < n; k++) {
      const i = list ? list[k] : k;
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
      const w = stackW(i, x, y, wbuf);
      let dx = 0, dz = 0;
      for (let s = 0; s < 5; s++) {
        if (w[s] < 1e-5) continue;
        const e = evalStack(stacks[s], y, ebuf), kx = e[0], kz = e[1], cx = e[2], cz = e[3];
        dx += w[s] * (cx + (x - cx) * kx - x); dz += w[s] * (cz + (z - cz) * kz - z);
      }
      out[i * 3] = x + dx; out[i * 3 + 1] = y; out[i * 3 + 2] = z + dz;
    }
    return out;
  };
  const touchedList = []; for (let i = 0; i < nMesh; i++) if (touched[i]) touchedList.push(i);
  const V2 = new Float32Array(V1);
  let iters = 0, worst = 1;
  for (; iters < 10; iters++) {
    buildProfiles();
    deform(V1, V2, touchedList);
    worst = 0;
    for (const st of stacks) for (const s of st.stations) {
      if (s.fixed) continue;
      const m = hull2(crossPoints(V2, s.cross));
      const w = (m.maxx - m.minx) / 2, d = (m.maxz - m.minz) / 2;
      const asp = (s.rx / s.rz) / (w / d), ra = Math.sqrt(asp);
      s.kx *= ra; s.kz /= ra;
      const f = s.G / m.per; s.kx *= f; s.kz *= f;
      s.err = m.per / s.G - 1; worst = Math.max(worst, Math.abs(s.err));
    }
    if (worst < 2e-4) break;
  }
  buildProfiles();
  deform(V1, V2);
  const stationScale = (p, sIdx) => { const [kx, kz, cx, cz] = evalStack(stacks[sIdx], p[1]); return [cx + (p[0] - cx) * kx, p[1], cz + (p[2] - cz) * kz]; };
  const J2 = J1.map((j, b) => {
    const g = bones[b].group;   // 0 torso 1 head 2 armL 3 armR 4 legL 5 legR
    const sIdx = g === 2 ? 1 : g === 3 ? 2 : g === 4 ? (j[1] < yCr1 ? 3 : 0) : g === 5 ? (j[1] < yCr1 ? 4 : 0) : 0;
    return stationScale(j, sIdx);
  });

  // 5. the shoulders tape: a horizontal loop at deltoid level around both arms; spread the shoulder girdle
  const shY = LM.shoulder.y, chY = LM.chest.y, nbY = geom.heights.neckBase;
  const shCross = crossings(V2, tris, (a, b, c) => part[a] < 4 && part[b] < 4 && part[c] < 4, shY, bins);
  const shList = [...new Set([...shCross.a, ...shCross.b])];
  const gSp = y => sstep(chY + 0.3 * (shY - chY), shY, y) * (1 - sstep(nbY - 1.6, nbY - 0.15, y));
  const xSh = { L: J2[B.uarm1L][0], R: J2[B.uarm1R][0] };
  const spreadPt = (i, x, y, sigma) => {
    const a = grp[i * 6 + 2] + grp[i * 6 + 3];
    const s = grp[i * 6 + 2] >= grp[i * 6 + 3] ? 'L' : 'R';
    return mix(x * (1 + sigma * gSp(y)), x + sigma * xSh[s], a);
  };
  const V3 = new Float32Array(V2);
  const loopAt = (sigma) => {
    for (const i of shList) V3[i * 3] = spreadPt(i, V2[i * 3], V2[i * 3 + 1], sigma);
    return hull2(crossPoints(V3, shCross)).per;
  };
  let sA = 0, pA = loopAt(0), sB = 0.04, pB = loopAt(sB);
  const Gsh = LM.shoulder.girth;
  for (let k = 0; k < 8 && Math.abs(pB - Gsh) > 1e-3; k++) {
    const sN = clamp(sB + (Gsh - pB) * (sB - sA) / ((pB - pA) || 1e-6), -0.3, 0.45);
    sA = sB; pA = pB; sB = sN; pB = loopAt(sB);
  }
  const sigma = sB;
  for (let i = 0; i < nMesh; i++) V3[i * 3] = spreadPt(i, V2[i * 3], V2[i * 3 + 1], sigma);
  const J3 = J2.map((j, b) => {
    const g = bones[b].group;
    if (g === 2) return [j[0] + sigma * xSh.L, j[1], j[2]];
    if (g === 3) return [j[0] + sigma * xSh.R, j[1], j[2]];
    if (g === 0) return [j[0] * (1 + sigma * gSp(j[1])), j[1], j[2]];
    return j;
  });

  // 6. back to the bind pose: bind skeleton with fitted lengths and bind orientations, then inverse skinning
  const heads1 = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const p = bones[b].parent;
    if (p < 0) { heads1[b] = J3[b]; continue; }
    heads1[b] = vadd(heads1[p], qRot(qConj(relax.q[p]), vsub(J3[b], J3[p])));
  }
  const { M: M1 } = skinMatrices(A, heads1, relax);
  const rest = unskinPositions(A, V3, M1);
  const restNrm = computeNormals(rest, tris, nMesh);
  const flare = new Float32Array(nMesh * 3), RS = A.sculptRegions.length, li = A.sculptRegions.indexOf('lats');
  for (let i = 0; i < nMesh; i++) { const o = (i * RS + li) * 3; flare[i * 3] = A.sculpt[o] / 0.2; flare[i * 3 + 1] = A.sculpt[o + 1] / 0.2; flare[i * 3 + 2] = A.sculpt[o + 2] / 0.2; }
  const cavity = computeCavity(rest, restNrm, tris, nMesh);

  // flexed-arm bulge amplitude so the flexed biceps section reaches the flexed tape (anthro flex.arm)
  const fit = {
    A, geom, bf, muscle: opts.muscle, rest, restNrm, cavity, flare, heads: heads1, frames, relaxed: V3, relax,
    sections: {}, neckY, report: { stations: [], shoulders: { girth: loopAt(sigma), target: Gsh, sigma }, iters, worst, hs, anchors: ax.map((m, i) => [m, ay[i]]) },
  };
  for (const st of stacks) for (const s of st.stations) {
    if (s.fixed) continue;
    fit.report.stations.push({ stack: st.name, name: s.name, y: s.y, target: s.G, err: s.err, kx: s.kx, kz: s.kz, w0: s.w0, d0: s.d0, P0: s.P0, rx: s.rx, rz: s.rz, cx: s.cx, cz: s.cz });
    if (st.name === 'trunk') fit.sections[s.name] = { y: s.y, w: s.rx, d: s.rz, cx: s.cx, cz: s.cz };
  }
  fit.flexAmp = calibrateFlex(fit);
  fit.ms = now() - t0;
  return fit;
}

// ---------------------------------------------------------------- biceps flex bulge (CPU twin of the shader)
function armAxis(fit, s) {
  const { A, heads, frames } = fit;
  const a = heads[A.B['uarm1' + s]], b = heads[A.B['farm1' + s]];
  const F = frames[s];
  const front = vnorm(vsub(F.f0, vmul(F.u0, vdot(F.f0, F.u0))));
  return { a, b, front, ua: [A.B['uarm1' + s], A.B['uarm2' + s]] };
}
function flexOffset(fit, i, pos, amt, s, ax) {
  const { A } = fit;
  let wua = 0;
  for (let k = 0; k < 4; k++) { const b = A.skinIdx[i * 4 + k]; if (b === ax.ua[0] || b === ax.ua[1]) wua += A.skinW[i * 4 + k]; }
  if (wua <= 0) return null;
  const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], d = vsub(ax.b, ax.a), L2 = vdot(d, d);
  const t = clamp(vdot(vsub(p, ax.a), d) / L2, 0, 1);
  const r = vsub(p, vadd(ax.a, vmul(d, t)));
  const bump = Math.exp(-((t - 0.52) * (t - 0.52)) / 0.045);
  const c = Math.max(0, vdot(vnorm(r), ax.front)), bias = 0.12 + 1.35 * c * Math.sqrt(c);
  return vmul(r, amt * bump * wua * bias);
}
/** Arm girth (convex hull, relaxed pose) at the arm landmark with the flex bulge at amplitude amp (0 = relaxed). */
export function flexGirthAt(fit, s = 'L', amp = 0, atY = null) {
  const { A } = fit, k = s === 'L' ? 2 : 3, R = fit.rest;
  const ax = armAxis(fit, s);
  const { M } = skinMatrices(A, fit.heads, fit.relax);
  const pos = new Float32Array(A.nMesh * 3);
  for (let i = 0; i < A.nMesh; i++) {
    if (A.part[i] !== k) continue;
    let x = R[i * 3], y = R[i * 3 + 1], z = R[i * 3 + 2];
    if (amp) { const o = flexOffset(fit, i, R, amp, s, ax); if (o) { x += o[0]; y += o[1]; z += o[2]; } }
    let rx = 0, ry = 0, rz = 0;
    for (let j = 0; j < 4; j++) {
      const w = A.skinW[i * 4 + j]; if (!w) continue;
      const m = A.skinIdx[i * 4 + j] * 16;
      rx += w * (M[m] * x + M[m + 4] * y + M[m + 8] * z + M[m + 12]); ry += w * (M[m + 1] * x + M[m + 5] * y + M[m + 9] * z + M[m + 13]); rz += w * (M[m + 2] * x + M[m + 6] * y + M[m + 10] * z + M[m + 14]);
    }
    pos[i * 3] = rx; pos[i * 3 + 1] = ry; pos[i * 3 + 2] = rz;
  }
  const ok = (a, b, c) => A.part[a] === k && A.part[b] === k && A.part[c] === k;
  if (atY !== null) return sliceHull(pos, A.tris, ok, atY).per;
  // peak: the largest section along the upper arm (between the axilla level and the elbow)
  const { J } = skinMatrices(A, fit.heads, fit.relax);
  const y0 = J[A.B['farm1' + s]][1] + 1.5, y1 = fit.geom.landmarks.arm.y + 1.5;
  let best = 0; for (let y = y0; y <= y1; y += 0.25) best = Math.max(best, sliceHull(pos, A.tris, ok, y).per);
  return best;
}
/** Peak arm girth with the flex bulge at amplitude amp (0 = relaxed hanging arm). */
export function flexPeakGirth(fit, s = 'L', amp = fit.flexAmp) { return flexGirthAt(fit, s, amp); }
function calibrateFlex(fit) {
  // secant on the peak girth: max section along the flexed upper arm = the flexed biceps tape
  const target = fit.geom.landmarks.arm.girth;
  let a0 = 0, g0 = flexGirthAt(fit, 'L', 0);
  if (!(g0 > 0)) return 0.1;
  let a1 = 0.15, g1 = flexGirthAt(fit, 'L', a1);
  for (let k = 0; k < 4 && Math.abs(g1 - target) > 0.01; k++) {
    const a2 = clamp(a1 + (target - g1) * (a1 - a0) / ((g1 - g0) || 1e-6), 0, 0.8);
    a0 = a1; g0 = g1; a1 = a2; g1 = flexGirthAt(fit, 'L', a1);
  }
  return a1;
}

// ================================================================== renderer
const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 aJoint;
layout(location=3) in vec4 aWeight;
layout(location=4) in vec3 aCanon;
layout(location=5) in float aPart;
layout(location=6) in float aCav;
uniform mat4 uBones[30];
uniform mat4 uVP;
uniform vec3 uArmA[2], uArmB[2], uArmF[2];
uniform vec2 uFlex;         // bulge amplitude per arm (already × flexAmp)
uniform ivec4 uUA;          // uarm1L, uarm2L, uarm1R, uarm2R
uniform float uLat;         // lat flare (inches at the armpit)
layout(location=7) in vec3 aFlare;
uniform vec4 uEyeRef;        // eyeY, eyeX, eyeZ, chinY (canonical dm)
float hairMask(vec3 c){
  float ax = abs(c.x), ey = uEyeRef.x, ez = uEyeRef.z;
  float front = ey + 0.66 - 0.22 * smoothstep(0.3, 0.62, ax);          // forehead hairline, receding at the temples
  float side = ey + 0.3;                                                // above the ears
  float backL = uEyeRef.w + 0.5;                                        // nape (back of the head only)
  float sideMix = smoothstep(0.45, 0.68, ax);
  float line = mix(front, side, sideMix);
  line = mix(line, backL, smoothstep(ez - 1.2, ez - 1.6, c.z));
  return smoothstep(line - 0.02, line + 0.05, c.y);
}
out vec3 vW; out vec3 vN; out vec3 vC; out float vPart; out float vCav;
float ss(float a, float b, float x){ float t = clamp((x-a)/(b-a), 0., 1.); return t*t*(3.-2.*t); }
void main(){
  vec3 p = aPos;
  ivec4 j = ivec4(aJoint + 0.5);
  for (int s = 0; s < 2; s++) {
    float amt = uFlex[s]; if (amt <= 0.0) continue;
    int b0 = s == 0 ? uUA.x : uUA.z, b1 = s == 0 ? uUA.y : uUA.w;
    float wua = 0.0;
    for (int k = 0; k < 4; k++) { if (j[k] == b0 || j[k] == b1) wua += aWeight[k]; }
    if (wua <= 0.0) continue;
    vec3 d = uArmB[s] - uArmA[s];
    float t = clamp(dot(p - uArmA[s], d) / dot(d, d), 0., 1.);
    vec3 r = p - (uArmA[s] + d * t);
    float bump = exp(-((t - 0.52) * (t - 0.52)) / 0.045);
    float c = max(0., dot(normalize(r), uArmF[s]));
    float bias = 0.12 + 1.35 * c * sqrt(c);
    p += r * amt * bump * wua * bias;
  }
  p += aFlare * uLat;
  if (aPart > 0.5 && aPart < 1.5) p += aNrm * hairMask(aCanon) * 0.14;
  mat4 M = aWeight.x * uBones[j.x] + aWeight.y * uBones[j.y] + aWeight.z * uBones[j.z] + aWeight.w * uBones[j.w];
  vec4 w = M * vec4(p, 1.0);
  vW = w.xyz; vN = mat3(M) * aNrm; vC = aCanon; vPart = aPart; vCav = aCav;
  gl_Position = uVP * w;
}`;
const FRAG = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; in float vPart; in float vCav;
uniform vec3 uEye;
uniform vec3 uKey, uFill, uRim, uRim2;
uniform float uDef;          // muscle definition 0..1 (low body fat)
uniform float uFat;          // 0..1 softness
uniform vec4 uCanon;         // navelY, nippleY, crotchY, nippleX  (canonical dm)
uniform vec4 uCanon2;        // shoulderY, kneeY, chinY, pubisY
uniform float uGhost;        // 0 main, 1 ghost
uniform vec3 uSkin;
uniform vec4 uEyeRef;        // eyeY, eyeX, eyeZ, chinY (canonical dm)
float hairMask(vec3 c){
  float ax = abs(c.x), ey = uEyeRef.x, ez = uEyeRef.z;
  float front = ey + 0.66 - 0.22 * smoothstep(0.3, 0.62, ax);          // forehead hairline, receding at the temples
  float side = ey + 0.3;                                                // above the ears
  float backL = uEyeRef.w + 0.5;                                        // nape (back of the head only)
  float sideMix = smoothstep(0.45, 0.68, ax);
  float line = mix(front, side, sideMix);
  line = mix(line, backL, smoothstep(ez - 1.2, ez - 1.6, c.z));
  return smoothstep(line - 0.02, line + 0.05, c.y);
}
out vec4 frag;
float ss(float a, float b, float x){ float t = clamp((x-a)/(b-a), 0., 1.); return t*t*(3.-2.*t); }
float groove(float d, float w){ return exp(-d*d/(w*w)); }
// procedural definition height field in canonical (default-male, dm) space; ≤ 0 in grooves
float defField(vec3 c){
  float x = abs(c.x), y = c.y, h = 0.0;
  float nav = uCanon.x, nip = uCanon.y, pub = uCanon2.w;
  float front = ss(0.25, 0.75, c.z);                 // anterior torso only (canonical z, dm)
  // rectus abdominis: blocks between the linea alba, three tendinous intersections and the lateral border
  float absBand = ss(pub + 0.05, pub + 0.4, y) * (1.0 - ss(nip - 0.8, nip - 0.5, y));
  float inRect = 1.0 - ss(0.5, 0.68, x);
  float i1 = nav + 0.1 + 0.03 * x, i2 = nav + 0.58 + 0.05 * x, i3 = nav + 1.05 + 0.1 * x;
  float ints = groove(y - i1, 0.05) + groove(y - i2, 0.05) + 0.8 * groove(y - i3, 0.055);
  float lin = groove(x, 0.05);
  float lat = groove(x - (0.63 - 0.05 * (y - nav)), 0.07);
  // block dome: bulge in the middle of each block (cosine across x and between intersections)
  float bx = 0.5 - 0.5 * cos(clamp(x / 0.6, 0.0, 1.0) * 6.2832);
  float by = 0.5 + 0.5 * cos(clamp((y - nav + 0.14) / 0.48, -0.6, 2.4) * 6.2832);
  h += (bx * by * 0.35 - lin * 0.9 - ints * 0.65 * inRect - lat * 0.8) * absBand * front;
  // inguinal "V" lines
  float vy = mix(pub + 0.05, nav - 0.35, ss(0.25, 1.05, x));
  h -= groove(y - vy, 0.07) * ss(0.2, 0.35, x) * (1.0 - ss(1.0, 1.15, x)) * 0.8 * front;
  // lower pec border
  float pecY = nip - 0.42 + 0.22 * (x - uCanon.w) * (x - uCanon.w);
  h -= groove(y - pecY, 0.08) * ss(0.15, 0.3, x) * (1.0 - ss(1.25, 1.45, x)) * 0.6 * front;
  // serratus digitations on the lateral ribcage
  float sy = (y - (nip - 0.95)) + (x - 1.05) * 0.7;
  float ser = 0.5 + 0.5 * cos(sy * 15.0);
  h -= ser * ss(0.95, 1.12, x) * (1.0 - ss(1.4, 1.55, x)) * ss(nip - 1.15, nip - 0.85, y) * (1.0 - ss(nip - 0.25, nip, y)) * ss(-0.1, 0.4, c.z) * 0.45;
  // back: spinal erector groove (lower back) and a soft lat/scapula edge
  float back = ss(0.0, -0.45, c.z);
  h -= groove(x, 0.07) * ss(pub, nav + 0.3, y) * (1.0 - ss(nip, nip + 0.6, y)) * back * 0.8;
  return h;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vW);
  if (uGhost > 0.5) {
    float fr = pow(1.0 - max(dot(N, V), 0.0), 2.2);
    float a = 0.04 + 0.8 * fr;
    frag = vec4(vec3(0.5, 0.82, 1.0) * (0.3 + fr), a);
    return;
  }
  bool torso = vPart < 0.5;
  // shorts (canonical space): from just below the navel to mid-thigh
  float waistband = uCanon.x - 0.55 - 0.12 * smoothstep(0.0, 1.2, abs(vC.x));
  float hem = uCanon.z - 1.25 + 0.25 * ss(0.4, 1.4, abs(vC.x));
  bool legOrTorso = vPart < 0.5;
  float shorts = (legOrTorso && vC.y < waistband && vC.y > hem) ? 1.0 : 0.0;
  float band = shorts * ss(waistband - 0.16, waistband - 0.12, vC.y);
  // definition: perturb the normal with the gradient of the field (torso front only)
  if (uDef > 0.01 && torso && shorts < 0.5) {
    float e = 0.02;
    float h0 = defField(vC);
    vec3 g = vec3(defField(vC + vec3(e,0,0)) - h0, defField(vC + vec3(0,e,0)) - h0, 0.0) / e;
    g.x *= sign(vC.x + 1e-5) * sign(vC.x + 1e-5);
    float k = uDef * 0.04;
    N = normalize(N - k * (g - dot(g, N) * N));
  }
  vec3 base = uSkin;
  float rough = 0.42, specK = 0.32;
  if (shorts > 0.5) { base = mix(vec3(0.028, 0.028, 0.034), vec3(0.95, 0.30, 0.12), band); rough = 0.85; specK = 0.06; }
  if (vPart > 2.5) { base = uSkin * 0.42; rough = 0.2; specK = 0.8; }
  if (vPart > 0.5 && vPart < 1.5) {
    // short hair cap + brows on the head
    float hm = hairMask(vC);
    float ax = abs(vC.x);
    float brow = smoothstep(0.1, 0.16, ax) * (1.0 - smoothstep(0.5, 0.6, ax)) * smoothstep(uEyeRef.x + 0.13, uEyeRef.x + 0.17, vC.y + 0.06 * ax)
               * (1.0 - smoothstep(uEyeRef.x + 0.23, uEyeRef.x + 0.27, vC.y + 0.06 * ax)) * smoothstep(uEyeRef.z - 0.15, uEyeRef.z + 0.05, vC.z);
    float n = fract(sin(dot(floor(vC * 140.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 hair = vec3(0.034, 0.025, 0.02) * (0.85 + 0.3 * n);
    base = mix(base, hair, max(hm, brow * 0.85));
    rough = mix(rough, 0.7, hm); specK = mix(specK, 0.12, hm);
  }
  float ao = 1.0 - 0.55 * vCav;
  vec3 col = vec3(0.0);
  vec3 L[4]; L[0] = uKey; L[1] = uFill; L[2] = uRim; L[3] = uRim2;
  vec3 C[4]; C[0] = vec3(1.0, 0.95, 0.9) * 2.0; C[1] = vec3(0.6, 0.68, 0.85) * 0.5; C[2] = vec3(1.0, 0.86, 0.72) * 1.2; C[3] = vec3(0.6, 0.72, 1.0) * 0.85;
  for (int i = 0; i < 4; i++) {
    vec3 l = normalize(L[i]);
    float nl = dot(N, l);
    float wrap = shorts > 0.5 ? max(nl, 0.0) : max((nl + 0.35) / 1.35, 0.0);
    vec3 sss = shorts > 0.5 ? vec3(0.0) : vec3(0.3, 0.08, 0.03) * ss(0.3, -0.05, nl) * ss(-0.5, 0.0, nl);
    vec3 hv = normalize(l + V);
    float nh = max(dot(N, hv), 0.0);
    float a2 = rough * rough * rough * rough;
    float d = a2 / (3.14159 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(hv, V), 0.0), 5.0);
    float spec = d * fres * specK * max(nl, 0.0);
    col += C[i] * (base * wrap + sss * base * 2.0 + spec * (i >= 2 ? 0.5 : 1.0));
  }
  // hemisphere ambient
  float up = N.y * 0.5 + 0.5;
  col += base * mix(vec3(0.05, 0.045, 0.05), vec3(0.16, 0.15, 0.16), up) * ao;
  col *= mix(1.0, ao, 0.8);
  // rim fresnel
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.9, 0.7, 0.55) * fr * 0.18 * (shorts > 0.5 ? 0.3 : 1.0);
  col = aces(col * 0.85);
  frag = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;
const BG_VERT = `#version 300 es
layout(location=0) in vec2 aXY; out vec2 vUV;
void main(){ vUV = aXY * 0.5 + 0.5; gl_Position = vec4(aXY, 0.999, 1.0); }`;
const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 frag;
uniform vec2 uRes; uniform vec4 uFeet;   // screen-space foot centre (xy, 0..1), shadow radius x/y
void main(){
  vec2 p = vUV - vec2(0.5, 0.56);
  p.x *= uRes.x / uRes.y;
  float spot = exp(-dot(p, p) * 2.6);
  vec3 bg = mix(vec3(0.043, 0.043, 0.051), vec3(0.105, 0.098, 0.112), spot);
  vec2 q = (vUV - uFeet.xy) / uFeet.zw;
  float sh = exp(-dot(q, q) * 2.2);
  bg *= 1.0 - 0.55 * sh;
  frag = vec4(bg, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  const v = compile(gl, gl.VERTEX_SHADER, vs), f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
  gl.deleteShader(v); gl.deleteShader(f);
  const loc = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); const nm = u.name.replace(/\[0\]$/, ''); loc[nm] = gl.getUniformLocation(p, u.name); }
  p.loc = loc; return p;
}
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, target, up) {
  const z = vnorm(vsub(eye, target)), x = vnorm(vcross(up, z)), y = vcross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -vdot(x, eye), -vdot(y, eye), -vdot(z, eye), 1];
}
function mat4mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
function project(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w];
}

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === 'undefined') return; styleInjected = true;
  const st = document.createElement('style');
  st.textContent = `
.b3m{position:relative;width:100%;user-select:none;-webkit-user-select:none}
.b3m-stage{position:relative;width:100%;overflow:hidden;border-radius:var(--radius,18px);background:var(--bg,#0b0b0d);box-shadow:inset 0 0 0 1px var(--line,#2a2a33)}
.b3m-canvas,.b3m-overlay{position:absolute;inset:0;display:block;width:100%;height:100%}
.b3m-canvas{touch-action:none;cursor:grab;outline:none}.b3m-canvas:active{cursor:grabbing}
.b3m-overlay{pointer-events:none}
.b3m-hint{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);padding:5px 11px;border-radius:999px;font-size:12px;font-weight:600;color:var(--muted,#8d8d9a);background:rgba(21,21,26,.72);border:1px solid var(--line,#2a2a33);pointer-events:none;white-space:nowrap;transition:opacity .5s}
.b3m-hint.gone{opacity:0}
.b3m-label{position:absolute;left:12px;top:10px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#8d8d9a);pointer-events:none}
.b3m-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--muted,#8d8d9a);pointer-events:none}
.b3m-poses{display:flex;gap:8px;overflow-x:auto;padding:10px 2px 2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.b3m-poses::-webkit-scrollbar{display:none}
.b3m-chip{flex:0 0 auto;min-height:36px;padding:0 14px;border-radius:999px;font:inherit;font-size:13px;font-weight:650;color:var(--muted,#8d8d9a);background:var(--card,#15151a);border:1px solid var(--line,#2a2a33);transition:background .2s,color .2s,border-color .2s}
.b3m-chip.on{color:var(--text,#f3f3f6);background:var(--accent-soft,rgba(255,107,61,.14));border-color:var(--accent,#ff6b3d)}
.b3m-chip:active{transform:scale(.97)}`;
  document.head.appendChild(st);
}

export function mountBody3D(el, opts = {}) {
  injectStyle();
  let o = { pose: 'relaxed', compareShape: null, autoRotate: false, height: 360, showScale: false, showPoses: true, ...opts };
  const root = document.createElement('div');
  root.className = 'b3m';
  root.innerHTML = `<div class="b3m-stage" style="height:${Math.round(o.height)}px"><canvas class="b3m-canvas" aria-label="3D physique model. Drag to rotate, pinch to zoom, double-tap to reset."></canvas><canvas class="b3m-overlay"></canvas>
    <div class="b3m-load">Loading 3D model…</div><div class="b3m-hint">Drag to rotate · pinch to zoom</div><div class="b3m-label"></div></div>
    ${o.showPoses ? `<div class="b3m-poses" role="tablist">${POSES.map(p => `<button type="button" class="b3m-chip" role="tab" data-pose="${p}">${POSE_LABEL[p]}</button>`).join('')}</div>` : ''}`;
  el.appendChild(root);
  const stage = root.querySelector('.b3m-stage'), canvas = root.querySelector('.b3m-canvas'), overlay = root.querySelector('.b3m-overlay');
  const loadEl = root.querySelector('.b3m-load'), hintEl = root.querySelector('.b3m-hint'), labelEl = root.querySelector('.b3m-label');
  const chips = [...root.querySelectorAll('.b3m-chip')];

  let A = null, fit = null, ghostFit = null, gl = null, dead = false, lost = false;
  let progBody = null, progBg = null, vaoMain = null, vaoGhost = null, vaoBg = null, bufs = {}, nIdx = 0;
  let poseName = POSES.includes(o.pose) ? o.pose : 'relaxed';
  let poseFrom = null, poseTo = null, poseT0 = 0; const POSE_MS = 520;
  const cam = { yaw: POSE_SPECS[poseName].view.yaw, pitch: POSE_SPECS[poseName].view.pitch, zoom: 1, vy: 0, vp: 0 };
  let camAnim = null, raf = 0, lastMs = 0, frameMs = 0, userTouched = false;
  let W = 1, Hh = 1, dpr = 1, VP = null, eye = [0, 0, 0];

  function setLabel() { labelEl.textContent = o.label || ''; labelEl.style.display = o.label ? '' : 'none'; }
  setLabel();
  function syncChips() { chips.forEach(c => { const on = c.dataset.pose === poseName; c.classList.toggle('on', on); c.setAttribute('aria-selected', String(on)); }); }
  syncChips();

  const keyOf = (s, bf, m) => JSON.stringify([s || null, bf ?? null, m || null]);
  let fitKey = '', ghostKey = '';
  function refit() {
    if (!A) return;
    const k = keyOf(o.shape, o.bodyFatPct, o.muscle);
    if (k !== fitKey) {
      fit = fitBody(A, { shape: o.shape, bodyFatPct: o.bodyFatPct, muscle: o.muscle }); fitKey = k;
      if (gl && !lost) uploadFit(fit, 'main');
      poseTo = null; poseFrom = null;
    }
    const cs = o.compareShape;
    const gk = cs ? keyOf(cs, num(cs.bodyFatPct) ?? o.compareBodyFatPct ?? o.bodyFatPct, cs.muscle || o.compareMuscle || o.muscle) : '';
    if (gk !== ghostKey) {
      ghostKey = gk;
      ghostFit = cs ? fitBody(A, { shape: cs, bodyFatPct: num(cs.bodyFatPct) ?? o.compareBodyFatPct ?? o.bodyFatPct, muscle: cs.muscle || o.compareMuscle || o.muscle }) : null;
      if (ghostFit && gl && !lost) uploadFit(ghostFit, 'ghost');
    }
  }
  function ctxOf(f) { return { A, rest: f.heads, frames: f.frames, geom: f.geom, sections: f.sections }; }
  function poseState(f, name) {
    const g = poseGlobals(ctxOf(f), name);
    return { q: g.q, scale: g.scale, flex: g.flex, lat: g.lat };
  }
  function currentPose(f, t) {
    const target = poseState(f, poseName);
    if (!poseFrom || t >= 1) return target;
    const from = poseState(f, poseFrom);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const q = target.q.map((qq, i) => qSlerp(from.q[i], qq, e));
    const scale = {};
    const keys = new Set([...Object.keys(from.scale), ...Object.keys(target.scale)]);
    for (const k of keys) { const a = from.scale[k] || [1, 1, 1], b = target.scale[k] || [1, 1, 1]; scale[k] = vlerp(a, b, e); }
    return { q, scale, flex: mix(from.flex, target.flex, e), lat: mix(from.lat || 0, target.lat || 0, e) };
  }
  function footOffset(f, pose) {   // keep the lowest foot planted
    const { J } = skinMatrices(A, f.heads, pose);
    const dy = Math.min(J[A.B.footL][1] - f.heads[A.B.footL][1], J[A.B.footR][1] - f.heads[A.B.footR][1]);
    return [0, -dy, 0];
  }

  // ---------------- GL
  function initGL() {
    gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    progBody = program(gl, VERT, FRAG);
    progBg = program(gl, BG_VERT, BG_FRAG);
    vaoBg = gl.createVertexArray(); gl.bindVertexArray(vaoBg);
    bufs.bg = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.bg);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    if (A) uploadStatic();
    if (fit) uploadFit(fit, 'main');
    if (ghostFit) uploadFit(ghostFit, 'ghost');
    resize();
  }
  function uploadStatic() {
    const n = A.nMesh;
    bufs.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, A.tris, gl.STATIC_DRAW); nIdx = A.tris.length;
    bufs.joint = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.joint); gl.bufferData(gl.ARRAY_BUFFER, A.skinIdx.subarray(0, n * 4), gl.STATIC_DRAW);
    const w8 = new Uint8Array(n * 4); for (let i = 0; i < n * 4; i++) w8[i] = Math.round(A.skinW[i] * 255);
    bufs.weight = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.weight); gl.bufferData(gl.ARRAY_BUFFER, w8, gl.STATIC_DRAW);
    bufs.canon = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.canon); gl.bufferData(gl.ARRAY_BUFFER, A.base.subarray(0, n * 3), gl.STATIC_DRAW);
    // kind: 0 torso/legs (shorts + definition eligible), 1 head/neck, 2 arm, 3 eye — interpolates safely
    const kind = new Uint8Array(n); for (let i = 0; i < n; i++) { const pt = A.part[i]; kind[i] = pt === 6 ? 3 : pt === 1 ? 1 : pt === 2 || pt === 3 ? 2 : 0; }
    bufs.part = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.part); gl.bufferData(gl.ARRAY_BUFFER, kind, gl.STATIC_DRAW);
    for (const k of ['main', 'ghost']) { bufs[k + 'Pos'] = gl.createBuffer(); bufs[k + 'Nrm'] = gl.createBuffer(); bufs[k + 'Cav'] = gl.createBuffer(); bufs[k + 'Flare'] = gl.createBuffer(); }
    const mk = (k) => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const attr = (loc, buf, size, type, normalized) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, normalized, 0, 0); };
      attr(0, bufs[k + 'Pos'], 3, gl.FLOAT, false); attr(1, bufs[k + 'Nrm'], 3, gl.FLOAT, false);
      attr(2, bufs.joint, 4, gl.UNSIGNED_BYTE, false); attr(3, bufs.weight, 4, gl.UNSIGNED_BYTE, true);
      attr(4, bufs.canon, 3, gl.FLOAT, false); attr(5, bufs.part, 1, gl.UNSIGNED_BYTE, false); attr(6, bufs[k + 'Cav'], 1, gl.FLOAT, false);
      attr(7, bufs[k + 'Flare'], 3, gl.FLOAT, false);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
      gl.bindVertexArray(null);
      return vao;
    };
    vaoMain = mk('main'); vaoGhost = mk('ghost');
  }
  function uploadFit(f, k) {
    if (!bufs.idx) uploadStatic();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k + 'Pos']); gl.bufferData(gl.ARRAY_BUFFER, f.rest, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k + 'Nrm']); gl.bufferData(gl.ARRAY_BUFFER, f.restNrm, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k + 'Cav']); gl.bufferData(gl.ARRAY_BUFFER, f.cavity, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k + 'Flare']); gl.bufferData(gl.ARRAY_BUFFER, f.flare, gl.DYNAMIC_DRAW);
  }
  function freeGL() {
    if (!gl) return;
    for (const b of Object.values(bufs)) if (b) gl.deleteBuffer(b);
    for (const v of [vaoMain, vaoGhost, vaoBg]) if (v) gl.deleteVertexArray(v);
    for (const p of [progBody, progBg]) if (p) gl.deleteProgram(p);
    bufs = {}; vaoMain = vaoGhost = vaoBg = progBody = progBg = null;
  }
  function resize() {
    if (!gl || lost) return;
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round(r.width * dpr)), h = Math.max(64, Math.round(r.height * dpr));
    if (w !== W || h !== Hh) { W = w; Hh = h; canvas.width = w; canvas.height = h; overlay.width = w; overlay.height = h; }
    requestRender();
  }

  // ---------------- camera
  function cameraFor(f) {
    const H = f.geom.heightIn, aspect = W / Hh, fov = 26 * Math.PI / 180, tanV = Math.tan(fov / 2);
    const halfH = H * 0.56, halfW = H * 0.36;
    const dist = Math.max(halfH / tanV, halfW / (tanV * aspect)) / cam.zoom;
    const zt = clamp(cam.zoom - 1, 0, 1.5) / 1.5;
    const target = [0, H * mix(0.5, 0.7, zt), 0];
    const cp = Math.cos(cam.pitch);
    eye = vadd(target, [Math.sin(cam.yaw) * cp * dist, Math.sin(cam.pitch) * dist, Math.cos(cam.yaw) * cp * dist]);
    const V = lookAt(eye, target, [0, 1, 0]), P = perspective(fov, aspect, dist * 0.2, dist * 3);
    return mat4mul(P, V);
  }
  function lightDirs() {   // camera-relative studio lights
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const rot = v => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
    return { key: rot([-0.55, 0.65, 0.75]), fill: rot([0.8, 0.05, 0.55]), rim: rot([0.75, 0.35, -0.85]), rim2: rot([-0.85, 0.2, -0.6]) };
  }

  // ---------------- render
  function draw(ts) {
    raf = 0;
    if (dead || !gl || lost || !fit) return;
    const t0 = now();
    let animating = false;
    // camera inertia / auto-rotate / pose camera animation
    if (camAnim) {
      const t = clamp((ts - camAnim.t0) / camAnim.dur, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      cam.yaw = mix(camAnim.from.yaw, camAnim.to.yaw, e); cam.pitch = mix(camAnim.from.pitch, camAnim.to.pitch, e);
      if (camAnim.to.zoom) cam.zoom = mix(camAnim.from.zoom, camAnim.to.zoom, e);
      if (t >= 1) camAnim = null; else animating = true;
    } else if (!dragging) {
      if (Math.abs(cam.vy) > 1e-4 || Math.abs(cam.vp) > 1e-4) {
        const dt = Math.min(48, ts - (lastMs || ts)) / 16.7;
        cam.yaw += cam.vy * dt; cam.pitch = clamp(cam.pitch + cam.vp * dt, -0.35, 0.7);
        const k = Math.pow(0.92, dt); cam.vy *= k; cam.vp *= k; animating = true;
      } else if (o.autoRotate) { cam.yaw += 0.006 * Math.min(3, (ts - (lastMs || ts)) / 16.7); animating = true; }
    }
    lastMs = ts;
    const pt = poseFrom ? clamp((ts - poseT0) / POSE_MS, 0, 1) : 1;
    if (poseFrom && pt < 1) animating = true; else poseFrom = null;
    gl.viewport(0, 0, W, Hh);
    gl.clearColor(0.043, 0.043, 0.051, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    VP = cameraFor(fit);
    const pose = currentPose(fit, pt), off = footOffset(fit, pose);
    // background + floor shadow
    const H = fit.geom.heightIn;
    const fL = project(VP, [0, 0, 0]), fR = project(VP, [H * 0.12, 0, 0]), fZ = project(VP, [0, 0, H * 0.1]);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(progBg); gl.bindVertexArray(vaoBg);
    gl.uniform2f(progBg.loc.uRes, W, Hh);
    gl.uniform4f(progBg.loc.uFeet, fL[0] * 0.5 + 0.5, fL[1] * 0.5 + 0.5, Math.max(0.03, Math.hypot(fR[0] - fL[0], fR[1] - fL[1]) * 0.5 * 1.3), Math.max(0.012, Math.abs(fZ[1] - fL[1]) * 0.5 + 0.012));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
    gl.useProgram(progBody);
    const L = progBody.loc, ld = lightDirs();
    gl.uniformMatrix4fv(L.uVP, false, VP);
    gl.uniform3fv(L.uEye, eye);
    gl.uniform3fv(L.uKey, ld.key); gl.uniform3fv(L.uFill, ld.fill); gl.uniform3fv(L.uRim, ld.rim); gl.uniform3fv(L.uRim2, ld.rim2);
    gl.uniform3f(L.uSkin, 0.215, 0.13, 0.088);
    const c = A.base, lm = A.lm;
    gl.uniform4f(L.uEyeRef, A.eye[0], A.eye[1], A.eye[2], c[lm.chinV * 3 + 1]);
    gl.uniform4f(L.uCanon, c[lm.navelV * 3 + 1], c[lm.nippleV * 3 + 1], c[lm.crotchV * 3 + 1], Math.abs(c[lm.nippleV * 3]));
    gl.uniform4f(L.uCanon2, c[A.bones[A.B.uarm1L].head * 3 + 1], c[A.bones[A.B.shinL].head * 3 + 1], c[lm.chinV * 3 + 1], c[lm.crotchV * 3 + 1] + 0.55);
    gl.uniform4i(L.uUA, A.B.uarm1L, A.B.uarm2L, A.B.uarm1R, A.B.uarm2R);
    const drawBody = (f, vao, ghost) => {
      const p = ghost ? currentPose(f, pt) : pose;
      const { M } = skinMatrices(A, f.heads, p, ghost ? footOffset(f, p) : off);
      gl.uniformMatrix4fv(L.uBones, false, M);
      const aL = armAxis(f, 'L'), aR = armAxis(f, 'R');
      gl.uniform3fv(L.uArmA, [...aL.a, ...aR.a]); gl.uniform3fv(L.uArmB, [...aL.b, ...aR.b]); gl.uniform3fv(L.uArmF, [...aL.front, ...aR.front]);
      const fx = p.flex * f.flexAmp; gl.uniform2f(L.uFlex, fx, fx);
      gl.uniform1f(L.uLat, p.lat || 0);
      const mAvg = Object.values({ ...DEF_MUSCLE, ...(f.muscle || {}) }).reduce((t, x) => t + x, 0) / 8;
      gl.uniform1f(L.uDef, ghost ? 0 : clamp(sstep(18, 9, f.bf) * (0.55 + 0.7 * mAvg), 0, 1.2));
      gl.uniform1f(L.uGhost, ghost ? 1 : 0);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0);
    };
    drawBody(fit, vaoMain, false);
    if (ghostFit) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      drawBody(ghostFit, vaoGhost, true);
      gl.disable(gl.BLEND); gl.depthMask(true);
    }
    gl.bindVertexArray(null);
    drawOverlay();
    frameMs = now() - t0;
    if (animating) requestRender();
  }
  function drawOverlay() {
    const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!o.showScale || !fit || !VP) return;
    const H = fit.geom.heightIn;
    // ruler at the body's depth, screen-aligned, to the left of the figure
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    const base = vmul(right, -H * 0.3), top = vadd(base, [0, H, 0]);
    const b = project(VP, base), t = project(VP, top);
    const px = p => [(p[0] * 0.5 + 0.5) * W, (1 - (p[1] * 0.5 + 0.5)) * Hh];
    const B0 = px(b), T0 = px(t), x = Math.max(28 * dpr, B0[0]);
    ctx.strokeStyle = 'rgba(243,243,246,0.55)'; ctx.fillStyle = 'rgba(243,243,246,0.8)'; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(x, B0[1]); ctx.lineTo(x, T0[1]); ctx.stroke();
    ctx.font = `${10 * dpr}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= Math.floor(H); i++) {
      const y = B0[1] + (T0[1] - B0[1]) * (i / H);
      const major = i % 12 === 0, mid = i % 6 === 0;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (major ? 10 : mid ? 7 : 3.5) * dpr, y); ctx.stroke();
      if (major) ctx.fillText(`${i / 12}'`, x - 4 * dpr, y);
    }
    // head-top marker + height label
    const head = px(project(VP, [0, H, 0]));
    ctx.setLineDash([3 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(255,182,72,0.65)';
    ctx.beginPath(); ctx.moveTo(x, T0[1]); ctx.lineTo(head[0], head[1]); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,182,72,0.95)'; ctx.font = `600 ${11 * dpr}px -apple-system, system-ui, sans-serif`;
    const ft = Math.floor(H / 12), inch = Math.round((H - ft * 12) * 10) / 10;
    ctx.fillText(`${ft}′${inch}″`, x + 12 * dpr, T0[1] - 8 * dpr);
  }
  function requestRender() { if (!raf && !dead) raf = requestAnimationFrame(draw); }

  // ---------------- interaction
  const pointers = new Map(); let dragging = false, lastX = 0, lastY = 0, lastT = 0, pinch0 = 0, zoom0 = 1, lastTap = 0;
  function onDown(e) {
    canvas.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
    camAnim = null; userTouched = true; hintEl.classList.add('gone');
    if (pointers.size === 1) {
      dragging = true; lastX = e.clientX; lastY = e.clientY; lastT = now(); cam.vy = cam.vp = 0;
      const t = now(); if (t - lastTap < 320) resetView(); lastTap = t;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = cam.zoom; dragging = false;
    }
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 > 0) cam.zoom = clamp(zoom0 * d / pinch0, 0.8, 3);
      requestRender(); return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY, t = now(), dt = Math.max(1, t - lastT);
    const k = 0.0105;
    cam.yaw -= dx * k; cam.pitch = clamp(cam.pitch + dy * k * 0.6, -0.35, 0.7);
    cam.vy = -dx * k * 16.7 / dt; cam.vp = dy * k * 0.6 * 16.7 / dt;
    lastX = e.clientX; lastY = e.clientY; lastT = t;
    requestRender();
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { if (now() - lastT > 80) { cam.vy = 0; cam.vp = 0; } dragging = false; requestRender(); }
    else if (pointers.size === 1) { const [p] = [...pointers.values()]; lastX = p[0]; lastY = p[1]; dragging = true; }
  }
  function onWheel(e) { e.preventDefault(); cam.zoom = clamp(cam.zoom * Math.exp(-e.deltaY * 0.0015), 0.8, 3); requestRender(); }
  function resetView() {
    const v = POSE_SPECS[poseName].view;
    camAnim = { from: { ...cam }, to: { yaw: nearestYaw(v.yaw), pitch: v.pitch, zoom: 1 }, t0: performance.now(), dur: 450 };
    cam.vy = cam.vp = 0; requestRender();
  }
  function nearestYaw(y) { const tw = Math.PI * 2; return y + Math.round((cam.yaw - y) / tw) * tw; }
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const onLost = e => { e.preventDefault(); lost = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  const onRestored = () => { lost = false; bufs = {}; try { initGL(); requestRender(); } catch (err) { root.classList.add('b3m-failed'); } };
  canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored);
  chips.forEach(c => c.addEventListener('click', () => { setPose(c.dataset.pose); if (typeof o.onPose === 'function') o.onPose(c.dataset.pose); }));
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(stage);

  function setPose(name) {
    if (!POSES.includes(name) || name === poseName) return;
    poseFrom = poseName; poseName = name; poseT0 = performance.now(); syncChips();
    if (!userTouched || true) {
      const v = POSE_SPECS[name].view;
      camAnim = { from: { ...cam }, to: { yaw: nearestYaw(v.yaw), pitch: v.pitch }, t0: performance.now(), dur: 650 };
    }
    requestRender();
  }

  try { initGL(); } catch (err) { root.classList.add('b3m-failed'); loadEl.textContent = '3D unavailable'; }
  loadBodyAsset().then(asset => {
    if (dead) return;
    A = asset;
    if (gl && !lost) uploadStatic();
    refit();
    loadEl.style.display = 'none';
    requestRender();
  }).catch(err => { loadEl.textContent = '3D model failed to load'; console.warn('[body3d-mesh]', err); });

  return {
    canvas,
    update(next = {}) {
      o = { ...o, ...next };
      if ('label' in next) setLabel();
      if ('pose' in next && next.pose && next.pose !== poseName) setPose(next.pose);
      refit(); requestRender();
    },
    setPose,
    getPose: () => poseName,
    setView(yaw, pitch = cam.pitch) { camAnim = null; cam.yaw = yaw; cam.pitch = pitch; cam.vy = cam.vp = 0; requestRender(); },
    stats: () => ({ fitMs: fit ? fit.ms : 0, frameMs, verts: A ? A.nMesh : 0, tris: A ? A.tris.length / 3 : 0, ready: !!fit, report: fit && fit.report }),
    destroy() {
      dead = true; if (raf) cancelAnimationFrame(raf); raf = 0;
      if (ro) ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      try { freeGL(); const ext = gl && gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* ignore */ }
      gl = null; fit = ghostFit = null; root.remove();
    },
  };
}
