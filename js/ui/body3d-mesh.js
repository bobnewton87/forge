// 3D physique viewer, MESH variant (CONTRACT §16 + §16b). Raw WebGL2, no libraries, no build step.
//
// A real human base mesh (MakeHuman hm08, CC0; see assets/body/LICENSE-ASSETS.md) is deformed to the
// user's tape measurements:
//   1. MakeHuman macro targets (muscle × weight grid) give the body its muscular / fat character, per region
//      (muscle scores) and from body-fat %.
//   2. The mesh is posed into anthro.js' rest pose (arms hanging, semi-pronated) with linear-blend skinning.
//   3. In that pose every landmark height is remapped (monotone cubic) onto anthro's heights, the arm joints
//      are moved onto anthro's joints, and horizontal cross-sections are scaled about their centres so the
//      convex-hull perimeter (what a tape reads) hits anthro's section at every profile station (all tape
//      sites incl. the shoulders loop around both arms), with smooth interpolation in between.
//   4. Head proportions: vertex→menton and menton→suprasternale are remapped (step 3 anchors) and a head-region
//      scale, faded in across the upper neck, sets head breadth / bizygomatic breadth / length to ANSUR II
//      adult-male medians scaled weakly with stature (headTargets(); head size grows ∝ H^0.3, not ∝ H).
//   5. Smoothness: the fit displacement (fitted − posed source) is Taubin-smoothed (fingers/toes held), then one smooth
//      station-correction pass restores every girth; region weights are smooth everywhere (head scale by the diffused
//      head-bone weight, leg-section scale faded over the foot by the foot-bone weight, no hard L/R flips).
//   6. The fitted pose is un-skinned back to the bind pose, so every other pose is plain skinning. Normals are
//      recomputed on the fitted bind mesh (welded across duplicate seam vertices) and skinned on the GPU.
//   Per-side skeleton (CONTRACT §16c): anthro's per-side joints/bones/profile heights drive per-side arm maps, one
//   vertical map per leg (pelvic obliquity: per-side hip heights) blended by each vertex's left/right share, and
//   per-side stations; sideJoints() re-lays limb chains when only per-side bones are given.
//
//   mountBody3D(el, { shape, muscle, bodyFatPct, pose, compareShape, autoRotate, height, showScale, showPoses, onPose })
//     → { update(opts), setPose(name), destroy() }
//   POSES, supported()
//
// CONTRACT-NOTE (§21, female body): the asset follows the sex (opts.sex › shape.sex › stored profile.body.sex › male):
//   'female' lazily fetches assets/body/body-female.{json,bin} (MakeHuman young female, same topology / skeleton /
//   skin weights; male users never download it), fits it to anthro's female geometry (bust / underbust / natural
//   waist / hips / thighs …, ANSUR II female head targets HEAD_REF_F), picks a cup-size morph from bust ÷ underbust,
//   smooths the nipples / crease before the fit (modesty), and renders a sports top + shorts and a hair bun (renderer-
//   only geometry after the body vertices). "Now" and "projected" (blink / ghost) share the asset; update({ sex })
//   switches it. Muscle scores stay on the engine's absolute FFMI scale (effectiveMuscle shifts them for the female
//   mesh). Body fat is DXA-equivalent for both sexes (BF_CAL: average-look anchor, heuristic definition thresholds).
//   Extra exports: sexOf, assetFiles, effectiveMuscle, FEMALE_MUSCLE_SHIFT, HEAD_REF_F, cupWeight, placeBun, BF_CAL,
//   definitionLevels; handle extras stats().sex / .cup, getSex().
// CONTRACT-NOTE (extras, all optional):
//   - compareShape may carry its own bodyFatPct / muscle (else the main body's are used). It is drawn as a
//     translucent Fresnel ghost (depth-tested against the main body, so you see where "now" sticks out).
//   - showScale (default false) draws a height ruler; showPoses (default true) renders pose chips;
//     onPose(name) is called when a chip is tapped; label (string) draws a corner caption.
//   - Handle extras: canvas, getPose(), stats() → { fitMs, frameMs, verts, tris }, setView(yawRad, pitchRad, zoom?, focus?)
//     (focus = camera target height as a fraction of stature, e.g. 0.92 for a head close-up; null = auto).
//   - update() keeps the user's yaw / pitch / zoom (only a pose change animates the camera), and the camera frames
//     by stature only, so swapping shape (e.g. "now" ↔ "projected" blink) keeps floor, scale and framing fixed.
//     The last 4 fitted bodies are cached by (shape, bodyFatPct, muscle), so switching back and forth never refits.
//   - Pure helpers for tests/tools: decodeBodyAsset, fitBody, poseGlobals, skinMatrices, skinPositions,
//     sliceHull, flexGirthAt, POSE_SPECS, FIT_POSE, POSE_MS, poseEase, HEAD_REF, headTargets, headDims, sideJoints,
//     taubinField, fieldRoughness.
//     fit.src = posed source before fitting (for smoothness metrics), fit.joints = per-side joints used.
//   - Flexed poses (front/back double biceps, side chest) bulge the upper arm to the flexed biceps tape
//     (anthro: arm/forearm tapes are flexed; the hanging rest arm uses the relaxed girth).
//   - Poses (MESH-4): the fit runs in POSE_SPECS.rest (FIT_POSE, anthro's rest joints, no weight shift); 'relaxed' is
//     that body with a subtle contrapposto (weight on the right leg, pelvis 4°, counter-tilted shoulders, level head,
//     soft left knee), so it keeps the fitted girths. Hands: the bind hand's ~15° palmar flexion is removed (wrist on
//     the forearm axis) and the relaxed fingers curl in a soft cascade, which puts the fingertip at ≈ 0.38 H (it hung
//     at 0.395 H and made the upper arm read long). Legs of authored poses are two-bone IK to foot placements (toe-out,
//     heel raise pivoting on the toe pads, knee aim); the pelvis drops just enough that both feet reach (pose.root).
//     Transitions: POSE_MS (450 ms) with poseEase (smootherstep, no overshoot); the lowest ankle stays at its fitted
//     height. Pure extras for tests: FIT_POSE, POSE_MS, poseEase.
import { bodyGeometry } from '../engine/anthro.js';
import { store } from '../store.js';

export const POSES = ['relaxed', 'front_double_biceps', 'lat_spread', 'side_chest', 'back_double_biceps'];
const POSE_LABEL = {
  relaxed: 'Relaxed', front_double_biceps: 'Front double bi', lat_spread: 'Lat spread',
  side_chest: 'Side chest', back_double_biceps: 'Back double bi',
};
const IN = 3.937007874;     // inches per MakeHuman decimetre
const DEF_SHAPE = { neck: 15, shoulders: 46, chest: 39, waist: 33, hips: 38, arm: 13, forearm: 11, thigh: 22, calf: 14.5, heightIn: 69 };
// typical woman (anthro REF.female = projection REF_BODY.female): chest = bust, waist = natural waist
const DEF_SHAPE_F = { neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14, heightIn: 64 };
const DEF_MUSCLE = { chest: 0.4, delts: 0.4, lats: 0.4, arms: 0.4, abs: 0.4, quads: 0.5, calves: 0.5, traps: 0.4 };
const DEF_BF = 24, DEF_BF_F = 34;   // (only when no body fat is known; DXA-equivalent, see BF_CAL)
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

// ================================================================== sex (CONTRACT §21)
/** 'female' | 'male' from opts.sex, else shape.sex, else the stored profile (profile.body.sex), else 'male'. */
export function sexOf(o = {}) {
  let v = o && (o.sex ?? o.shape?.sex);
  if (v == null) { try { v = store.getProfile()?.body?.sex; } catch (e) { v = null; } }
  return v === 'female' ? 'female' : 'male';
}
/** Asset file names per sex: the female mesh is a separate, lazily fetched pair (male users never download it). */
export function assetFiles(sex = 'male') { return sex === 'female' ? ['body-female.json', 'body-female.bin'] : ['body.json', 'body.bin']; }
// Muscle scores are on the engine's absolute normalized-FFMI scale (projection.js: FFMI 15 → 0, 24 → 1) for both
// sexes. MakeHuman's muscle axis is sex-relative, so for the female mesh the score is shifted by the sex difference
// in median FFMI (≈ 3.5 kg/m²: ≈ 18.9 men vs 15.4 women, Schutz, Kyle & Pichard 2002, Int J Obes 26:953) → the
// same FFMI percentile gets the same MakeHuman muscle parameter (a typical 140 lb / 28 % woman ≈ 0.6 of the axis).
export const FEMALE_MUSCLE_SHIFT = 3.5 / 9;
export function effectiveMuscle(muscle, sex = 'male') {
  const mu = { ...DEF_MUSCLE, ...(muscle || {}) };
  if (sex !== 'female') return mu;
  const out = {};
  for (const [k, v] of Object.entries(mu)) out[k] = num(v) == null ? v : clamp(v + FEMALE_MUSCLE_SHIFT, 0, 1);
  return out;
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
  const cups = (L.cups || []).map(m => {   // female cup-size morphs (min / max cup)
    const idx = new Uint16Array(view(m.index)), dq = view(m.delta), s = L[m.delta].scale, d = new Float32Array(dq.length);
    for (let i = 0; i < dq.length; i++) d[i] = dq[i] * s;
    return { name: m.name, idx, d };
  });
  const bones = meta.bones;
  const B = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const asset = { meta, sex: meta.sex === 'female' ? 'female' : 'male', N, nMesh, base, tris: new Uint16Array(view('index')), skinIdx, skinW, part: new Uint8Array(view('part')), morphs, cups, bones, B, lm: meta.landmarks, aux: meta.aux };
  prepareAsset(asset);
  return asset;
}
const assetPromises = new Map();
/** Fetch + decode the body asset for a sex (cached per sex; the female pair is only fetched when asked for). */
export function loadBodyAsset(baseUrl, sex = 'male') {
  const sx = sex === 'female' ? 'female' : 'male', key = sx + '|' + (baseUrl ? String(baseUrl) : '');
  if (!assetPromises.has(key)) {
    const base = baseUrl || new URL('../../assets/body/', import.meta.url), [fj, fb] = assetFiles(sx);
    assetPromises.set(key, Promise.all([
      fetch(new URL(fj, base)).then(r => { if (!r.ok) throw new Error(fj + ' ' + r.status); return r.json(); }),
      fetch(new URL(fb, base)).then(r => { if (!r.ok) throw new Error(fb + ' ' + r.status); return r.arrayBuffer(); }),
    ]).then(([m, b]) => decodeBodyAsset(m, b)).catch(e => { assetPromises.delete(key); throw e; }));
  }
  return assetPromises.get(key);
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
  buildTopology(A);
  A.canonNormals = computeNormals(base, A.tris, nMesh, null, A.weld);
  if (A.cups && A.cups.length) {   // female: torso-only triangles for the cup-size girths (arms are apart in the bind pose)
    const t = [], pt = A.part;
    for (let k = 0; k < A.tris.length; k += 3) if (pt[A.tris[k]] === 0 && pt[A.tris[k + 1]] === 0 && pt[A.tris[k + 2]] === 0) t.push(A.tris[k], A.tris[k + 1], A.tris[k + 2]);
    A.cupTris = Uint16Array.from(t);
  }
  if (A.sex === 'female') {
    // modesty smoothing region (CONTRACT §21): the base mesh's nipples and the vulva crease would show through the
    // painted-on sports top and shorts, so they are smoothed away (Taubin, before the fit, so every girth still
    // matches the tape). Weights fall off smoothly: ≈ 1.6 in around each bust point, and the front of the crotch.
    const w = new Float32Array(nMesh), nip = A.lm.nippleV, cr = A.lm.crotchV;
    const np = [Math.abs(base[nip * 3]), base[nip * 3 + 1], base[nip * 3 + 2]], cy = base[cr * 3 + 1], cz = base[cr * 3 + 2];
    for (let i = 0; i < nMesh; i++) {
      if (A.part[i] === 6) continue;
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      const dn = Math.hypot(Math.abs(x) - np[0], y - np[1], z - np[2]);
      const wn = 1 - sstep(0.4, 0.7, dn);
      const wc = (1 - sstep(0.35, 0.6, Math.abs(x))) * sstep(cy - 0.45, cy - 0.2, y) * (1 - sstep(cy + 0.9, cy + 1.3, y)) * sstep(cz - 0.5, cz - 0.1, z);
      w[i] = Math.max(wn, wc);
    }
    A.modesty = w;
    A.modestyList = Int32Array.from({ length: nMesh }, (_, i) => i).filter(i => w[i] > 0);
  }
  // head-bone share of each vertex (skin weights, diffused a little): the head-proportion scale follows the skull
  // and jaw instead of a height band, so the jaw underside / nape carry the head↔neck transition (no lump below
  // the ear, no shelf under the chin)
  {
    const wh = new Float32Array(nMesh), hb = B.head;
    for (let i = 0; i < nMesh; i++) for (let k = 0; k < 4; k++) if (skinIdx[i * 4 + k] === hb) wh[i] += skinW[i * 4 + k];
    A.wHead = smoothScalar(A, wh, 6, 0.5);
    // foot-bone share: the leg sections' scale fades out over the foot by this weight (not by height: the foot is
    // nearly horizontal, so a height fade sheared the toes against the sole)
    const wf = new Float32Array(nMesh), fb = new Set([B.footL, B.footR]);
    for (let i = 0; i < nMesh; i++) for (let k = 0; k < 4; k++) if (fb.has(skinIdx[i * 4 + k])) wf[i] += skinW[i * 4 + k];
    A.wFoot = smoothScalar(A, wf, 4, 0.5);
  }
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
  if (A.sex === 'female') A.bun = bunTemplate(A);
  // head anthropometry helpers (canonical dm): the ears (excluded from head breadth/circumference, as ANSUR
  // measures above them) and the suprasternal notch (deepest point of the front midline between chest and chin)
  const earMask = new Uint8Array(nMesh), [eyY, , eyZ] = A.eye;
  for (let i = 0; i < nMesh; i++) {
    if (A.part[i] !== 1) continue;
    const y = base[i * 3 + 1], z = base[i * 3 + 2];
    if (y > eyY - 0.65 && y < eyY + 0.13 && z > eyZ - 1.1 && z < eyZ - 0.58 && Math.abs(base[i * 3]) > 0.7) earMask[i] = 1;
  }
  A.earMask = earMask;
  let notch = -1, nz = Infinity;
  for (let i = 0; i < nMesh; i++) {
    const y = base[i * 3 + 1], z = base[i * 3 + 2];
    if (A.part[i] > 1 || Math.abs(base[i * 3]) > 0.015 || z <= 0 || y <= yNip || y >= yChin - 0.3) continue;
    if (z < nz) { nz = z; notch = i; }
  }
  A.notchV = notch;
  if (A.sex === 'female') A.strap = strapPath(A);
}

// ---------------------------------------------------------------- sports-top strap centre-line (CONTRACT §21c)
// The strap is a tube of constant radius around a centre-line that follows the canonical surface, so it reads as
// a band of constant width wherever it crosses, whatever the surface is doing there. (It used to be the slab
// |canonical x − const| < w, which is as wide as the surface is flat in x: over a broad, flattened shoulder that
// smeared into a wedge, and compensating the width with a screen-space derivative made the edge sawtooth.)
// Anchors are landmark-relative and snapped to real vertices, so the path follows a rebuilt asset.
function strapPath(A) {
  const { base, part, nMesh, lm, B, bones } = A;
  const at = i => [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]];
  // nearest surface vertex on the left half, with per-axis weights so a seed placed off the body slides onto it
  // along the intended direction (in front of the chest → straight back; above the shoulder → straight down).
  const LIFT = 0.07;   // dm the centre-line floats above the surface
  const snapIdx = (s, w = [1, 1, 1], torsoOnly = false) => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < nMesh; i++) {
      const p = part[i];
      if (torsoOnly ? p !== 0 : p > 1) continue;
      const x = base[i * 3]; if (x < 0.04) continue;
      const d = w[0] * (x - s[0]) ** 2 + w[1] * (base[i * 3 + 1] - s[1]) ** 2 + w[2] * (base[i * 3 + 2] - s[2]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const snap = (s, w = [1, 1, 1], torsoOnly = true) => { const i = snapIdx(s, w, torsoOnly); return i < 0 ? s.slice() : at(i); };
  const nip = at(lm.nippleV), notch = at(A.notchV), sj = at(bones[B.uarm1L].head);
  const xs = 0.55 * sj[0];                       // the strap crosses the trapezius midway out from the neck
  const FRONT = [8, 8, 1], TOP = [25, 1, 10], BACK = [8, 8, 1];
  const nodes = [
    snap([0.86 * nip[0], nip[1] + 0.40, nip[2] + 0.8], FRONT),                        // front: top of the cup
    snap([mix(0.86 * nip[0], xs, 0.6), mix(nip[1] + 0.40, notch[1], 0.55), nip[2] + 0.8], FRONT),  // front: mid chest
    snap([xs, notch[1] - 0.05, nip[2] + 0.8], FRONT),                                 // front: over the clavicle
    snap([xs, notch[1] + 3.0, -0.15], TOP),                                           // top of the trapezius
    snap([0.95 * xs, notch[1] - 0.40, -3.0], BACK),                                   // back: below the shoulder
    snap([0.58 * xs, notch[1] - 1.10, -3.0], BACK),                                   // back: racer-back sweep
    snap([0.17, notch[1] - 1.80, -3.0], BACK),                                        // back: onto the spine
  ];
  // Catmull-Rom through the anchors, re-snapped so the polyline hugs the surface instead of chording across it.
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t, o = [];
    for (let k = 0; k < 3; k++) o[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    return o;
  };
  const out = [];
  const SUB = 3;   // ≈ 0.13 dm between points, so the chords never sag far enough inside to pinch the band
  for (let i = 0; i < nodes.length - 1; i++) {
    const p0 = nodes[Math.max(0, i - 1)], p1 = nodes[i], p2 = nodes[i + 1], p3 = nodes[Math.min(nodes.length - 1, i + 2)];
    for (let k = 0; k < SUB; k++) out.push(cr(p0, p1, p2, p3, k / SUB));
  }
  out.push(nodes[nodes.length - 1]);
  const pts = out.map((q, i) => (i === 0 || i === out.length - 1 ? q : snap(q, [1, 1, 1], false)));
  // Snapping quantises the line onto the vertex grid (spacing ≈ the strap width), which shows as a wobbly edge.
  // Laplacian passes take that out, but they also pull the line inside a convex shoulder — so re-snap afterwards
  // and finish with one light pass: smooth, and back within a couple of hundredths of a dm of the surface.
  const smooth = (w) => {
    const prev = pts.map(q => q.slice());
    for (let i = 1; i < pts.length - 1; i++) for (let k = 0; k < 3; k++) pts[i][k] = (1 - 2 * w) * prev[i][k] + w * (prev[i - 1][k] + prev[i + 1][k]);
  };
  smooth(0.25); smooth(0.25);
  for (let i = 1; i < pts.length - 1; i++) pts[i] = snap(pts[i], [1, 1, 1], false);
  smooth(0.12);
  // Float the line OFF the surface by a fixed lift along the canonical normal. The band is then
  // 2·sqrt(r² − d²) wide, with d the surface-to-line distance: where a chord sags toward the surface the band
  // gets a little wider instead of pinching shut, which is what a line lying exactly on the surface would do.
  const N = A.canonNormals;
  for (let i = 0; i < pts.length; i++) {
    const j = snapIdx(pts[i]);
    if (j >= 0) for (let k = 0; k < 3; k++) pts[i][k] += LIFT * N[j * 3 + k];
  }
  return { pts, radius: 0.135, lift: LIFT };      // ≈ 0.45 in half-width on the surface (a ≈ 0.9 in strap)
}
const STRAP_BUF = new WeakMap();
function strapBuf(sp) {   // flat Float32Array for the uStrapP uniform array (cached per asset)
  let b = STRAP_BUF.get(sp);
  if (!b) { b = new Float32Array(20 * 3); for (let i = 0; i < Math.min(20, sp.pts.length); i++) b.set(sp.pts[i], i * 3); STRAP_BUF.set(sp, b); }
  return b;
}

// ================================================================== head anthropometry
// ANSUR II adult-male medians at 69 in stature. Head size scales much less than proportionally with stature:
// horizontal dimensions ∝ H^0.3, head height (vertex→menton, partly facial) ∝ H^0.5. The neck (menton →
// suprasternale) follows anthro's segment ratio (0.052 H: chin 0.870 H − suprasternale ≈ acromion 0.818 H).
export const HEAD_REF = { statureIn: 69, breadth: 6.1, length: 7.8, circumference: 22.6, bizygomatic: 5.6, height: 9.1, expH: 0.3, expV: 0.5, neck: 0.052 };
// ANSUR II adult-FEMALE medians (n = 1,986, stature 1626 mm = 64.0 in): head breadth 147 mm, head length 190 mm,
// head circumference 560 mm, bizygomatic breadth 134 mm; head height = the male 9.1 in × the female/male ratio of
// (tragion–top of head + menton–sellion) medians (240 / 254 mm); neck (menton → suprasternale) 0.052 H as for men
// (female chin − suprasternale from [AN2F] = 0.049 H, identical to the male value from the same formula).
export const HEAD_REF_F = { statureIn: 64.0, breadth: 5.79, length: 7.48, circumference: 22.05, bizygomatic: 5.28, height: 8.6, expH: 0.3, expV: 0.5, neck: 0.052 };
export function headTargets(H, sex = 'male') {
  const R = sex === 'female' ? HEAD_REF_F : HEAD_REF, kh = Math.pow(H / R.statureIn, R.expH), kv = Math.pow(H / R.statureIn, R.expV);
  return { breadth: R.breadth * kh, length: R.length * kh, circumference: R.circumference * kh, bizygomatic: R.bizygomatic * kh, height: R.height * kv, neck: R.neck * H };
}
/**
 * Head dimensions of a posed mesh (inches; upright head): breadth / length / circumference from horizontal
 * slices of the cranium (glabella level up, ears excluded), bizygomatic breadth from the slices between the
 * eyes and the cheekbones (front 40% of the head only), height = vertex − menton, neck = menton − suprasternale.
 */
export function headDims(A, pos) {
  const { nMesh, part, tris, earMask: ear } = A;
  let top = -Infinity, ey = 0, ne = 0;
  for (let i = 0; i < nMesh; i++) {
    if (part[i] === 6) { ey += pos[i * 3 + 1]; ne++; } else if (pos[i * 3 + 1] > top) top = pos[i * 3 + 1];
  }
  ey /= ne || 1;
  const chin = pos[A.lm.chinV * 3 + 1], height = top - chin;
  const ok = (a, b, c) => part[a] === 1 && part[b] === 1 && part[c] === 1 && !ear[a] && !ear[b] && !ear[c];
  const yG = ey + 0.054 * height;   // ≈ glabella (brow ridge) level
  let breadth = 0, circumference = 0, zmin = Infinity, zmax = -Infinity;
  for (let y = yG; y <= top - 0.3; y += 0.1) {
    const h = sliceHull(pos, tris, ok, y); if (h.n < 6) continue;
    breadth = Math.max(breadth, h.maxx - h.minx); circumference = Math.max(circumference, h.per);
    zmin = Math.min(zmin, h.minz); zmax = Math.max(zmax, h.maxz);
  }
  const zF = zmin + 0.6 * (zmax - zmin);
  let bizygomatic = 0;
  for (let y = ey - 0.18 * height; y <= ey; y += 0.1) { const h = sliceHull(pos, tris, ok, y, p => p[1] >= zF); if (h.n >= 2) bizygomatic = Math.max(bizygomatic, h.maxx - h.minx); }
  const notch = pos[A.notchV * 3 + 1];
  return { top, chin, height, eyeY: ey, glabellaY: yG, breadth, length: zmax - zmin, circumference, bizygomatic, notch, neck: chin - notch, cz: (zmin + zmax) / 2 };
}
// Female hair bun: a small ellipsoid appended after the body vertices (drawn in the same call, skinned 100 % to the
// head bone, shaded as hair). It is extra geometry for the renderer only: every fit / girth / pose computation works
// on the first nMesh vertices, so the bun never touches the body surface the tapes are fitted to.
function bunTemplate(A) {
  const ST = 10, SL = 20, unit = [], tris = [];
  for (let i = 0; i <= ST; i++) { const th = Math.PI * i / ST; for (let j = 0; j < SL; j++) { const ph = 2 * Math.PI * j / SL; unit.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)); } }
  for (let i = 0; i < ST; i++) for (let j = 0; j < SL; j++) {
    const a = i * SL + j, b = i * SL + (j + 1) % SL, c = (i + 1) * SL + j, d = (i + 1) * SL + (j + 1) % SL;
    tris.push(A.nMesh + a, A.nMesh + b, A.nMesh + c, A.nMesh + b, A.nMesh + d, A.nMesh + c);
  }
  const [ey, , ez] = A.eye;
  return { n: unit.length / 3, unit: Float32Array.from(unit), tris: Uint16Array.from(tris), canon: [0, ey + 0.9, ez - 1.2] };
}
/** Bun placement on a fitted bind-pose mesh (inches): at the back of the crown, sized from the cranium. */
export function placeBun(A, rest) {
  if (!A.bun) return null;
  let top = -Infinity;
  for (let i = 0; i < A.nMesh; i++) if (A.part[i] === 1 && A.wHead[i] > 0.6 && rest[i * 3 + 1] > top) top = rest[i * 3 + 1];
  let zMin = Infinity, zMax = -Infinity, zb = Infinity;
  const yb = top - 2.0;
  for (let i = 0; i < A.nMesh; i++) {
    if (A.part[i] !== 1 || A.wHead[i] < 0.6) continue;
    const y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    if (y > top - 3.2 && y < top - 0.8) { zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); }
    if (Math.abs(y - yb) < 0.8 && Math.abs(rest[i * 3]) < 1.0) zb = Math.min(zb, z);   // back of the skull (sparse mesh there)
  }
  const len = zMax - zMin, R = 0.19 * len, C = [0, yb, (isFinite(zb) ? zb : zMin) - 0.42 * R];
  const rx = 1.15 * R, ry = 0.95 * R, rz = 0.85 * R, n = A.bun.n, u = A.bun.unit;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    pos[k * 3] = C[0] + rx * u[k * 3]; pos[k * 3 + 1] = C[1] + ry * u[k * 3 + 1]; pos[k * 3 + 2] = C[2] + rz * u[k * 3 + 2];
    const nx = u[k * 3] / rx, ny = u[k * 3 + 1] / ry, nz = u[k * 3 + 2] / rz, l = Math.hypot(nx, ny, nz) || 1;
    nrm[k * 3] = nx / l; nrm[k * 3 + 1] = ny / l; nrm[k * 3 + 2] = nz / l;
  }
  return { pos, nrm, center: C, radius: R };
}
// Smooth vertex normals (area-weighted face normals). With `weld` (vertex → representative of its position group)
// duplicated seam vertices share one averaged normal, so UV/part seams never show as lighting seams.
function computeNormals(pos, tris, n, out, weld) {
  const N = out || new Float32Array(n * 3); N.fill(0);
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k] * 3, b = tris[k + 1] * 3, c = tris[k + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [tris[k], tris[k + 1], tris[k + 2]]) { const i = (weld ? weld[v] : v) * 3; N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
  }
  for (let i = 0; i < n; i++) {
    if (weld && weld[i] !== i) continue;
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l;
  }
  if (weld) for (let i = 0; i < n; i++) { const r = weld[i]; if (r !== i) { N[i * 3] = N[r * 3]; N[i * 3 + 1] = N[r * 3 + 1]; N[i * 3 + 2] = N[r * 3 + 2]; } }
  return N;
}
// Mesh topology: weld map (duplicate positions → one representative) and a CSR vertex adjacency over the welded mesh.
function buildTopology(A) {
  const { nMesh: n, base, tris } = A;
  const weld = new Int32Array(n), seen = new Map();
  let dupGroups = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.round(base[i * 3] * 1e4) + ',' + Math.round(base[i * 3 + 1] * 1e4) + ',' + Math.round(base[i * 3 + 2] * 1e4);
    const r = seen.get(k);
    if (r === undefined) { seen.set(k, i); weld[i] = i; } else { weld[i] = r; dupGroups++; }
  }
  const sets = new Array(n);
  for (let k = 0; k < tris.length; k += 3) for (let e = 0; e < 3; e++) {
    const a = weld[tris[k + e]], b = weld[tris[k + (e + 1) % 3]];
    if (a === b) continue;
    (sets[a] ||= new Set()).add(b); (sets[b] ||= new Set()).add(a);
  }
  const off = new Int32Array(n + 1); for (let i = 0; i < n; i++) off[i + 1] = off[i] + (sets[weld[i]] ? sets[weld[i]].size : 0);
  const idx = new Int32Array(off[n]);
  for (let i = 0; i < n; i++) { let o = off[i]; if (sets[weld[i]]) for (const j of sets[weld[i]]) idx[o++] = j; }
  A.weld = weld; A.dupGroups = dupGroups; A.adj = { off, idx };
  // displacement-smoothing freedom: fingers, thumbs and feet (toes) are fine intentional detail that only moves
  // rigidly in the fit, so they are held (umbrella smoothing on their tiny, irregular triangles would fold them)
  const free = new Float32Array(n), B = A.B, held = new Set(['fing1L', 'fing2L', 'thumbL', 'fing1R', 'fing2R', 'thumbR', 'footL', 'footR'].map(k => B[k]));
  for (let i = 0; i < n; i++) { let h = 0; for (let k = 0; k < 4; k++) if (held.has(A.skinIdx[i * 4 + k])) h += A.skinW[i * 4 + k]; free[i] = A.part[i] === 6 ? 0 : 1 - sstep(0.15, 0.6, h); }
  A.smoothFree = free;
}
/** Mean umbrella-Laplacian magnitude of a per-vertex 3-vector field (inches for a displacement field). */
export function fieldRoughness(A, d) {
  const { off, idx } = A.adj; let s = 0, c = 0;
  for (let i = 0; i < A.nMesh; i++) {
    const o0 = off[i], o1 = off[i + 1]; if (o1 === o0 || A.part[i] === 6) continue;
    let x = 0, y = 0, z = 0; for (let o = o0; o < o1; o++) { const j = idx[o] * 3; x += d[j]; y += d[j + 1]; z += d[j + 2]; }
    const k = 1 / (o1 - o0); s += Math.hypot(x * k - d[i * 3], y * k - d[i * 3 + 1], z * k - d[i * 3 + 2]); c++;
  }
  return s / (c || 1);
}
// a few Jacobi passes of umbrella smoothing of a per-vertex scalar
function smoothScalar(A, f, iters, lam) {
  const { off, idx } = A.adj, n = f.length; let a = Float32Array.from(f), b = new Float32Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      const o0 = off[i], o1 = off[i + 1]; if (o1 === o0) { b[i] = a[i]; continue; }
      let s = 0; for (let o = o0; o < o1; o++) s += a[idx[o]];
      b[i] = a[i] + lam * (s / (o1 - o0) - a[i]);
    }
    [a, b] = [b, a];
  }
  return a;
}
/**
 * Taubin (λ|μ) smoothing of a per-vertex 3-vector field, in place: removes high-frequency roughness without the
 * shrinkage of plain Laplacian smoothing. Used on the fit DISPLACEMENT (fitted − source), never on the base shape,
 * so the mesh's own detail is kept and only creases introduced by region-wise deformation are ironed out.
 * `pin` (optional, 0..1 per vertex) holds vertices back (1 = free).
 */
export function taubinField(A, d, iters = 8, lam = 0.6, mu = -0.63, pin = null) {
  const { off, idx } = A.adj, n = A.nMesh, tmp = new Float32Array(n * 3);
  for (let it = 0; it < iters * 2; it++) {
    const k = it & 1 ? mu : lam;
    for (let i = 0; i < n; i++) {
      const o0 = off[i], o1 = off[i + 1];
      if (o1 === o0) { tmp[i * 3] = d[i * 3]; tmp[i * 3 + 1] = d[i * 3 + 1]; tmp[i * 3 + 2] = d[i * 3 + 2]; continue; }
      let sx = 0, sy = 0, sz = 0; for (let o = o0; o < o1; o++) { const j = idx[o] * 3; sx += d[j]; sy += d[j + 1]; sz += d[j + 2]; }
      const inv = 1 / (o1 - o0), w = k * (pin ? pin[i] : 1);
      tmp[i * 3] = d[i * 3] + w * (sx * inv - d[i * 3]); tmp[i * 3 + 1] = d[i * 3 + 1] + w * (sy * inv - d[i * 3 + 1]); tmp[i * 3 + 2] = d[i * 3 + 2] + w * (sz * inv - d[i * 3 + 2]);
    }
    d.set(tmp);
  }
  return d;
}
// taubinField restricted to a vertex list (weights w, 0 = fixed): same result as taubinField(A, d, …, w) for a field
// that is only smoothed inside the list, at a fraction of the cost
function regionTaubin(A, d, list, w, iters, lam, mu) {
  const { off, idx } = A.adj, n = list.length, tmp = new Float32Array(n * 3);
  for (let it = 0; it < iters * 2; it++) {
    const k = it & 1 ? mu : lam;
    for (let q = 0; q < n; q++) {
      const i = list[q], o0 = off[i], o1 = off[i + 1];
      if (o1 === o0) { tmp[q * 3] = d[i * 3]; tmp[q * 3 + 1] = d[i * 3 + 1]; tmp[q * 3 + 2] = d[i * 3 + 2]; continue; }
      let sx = 0, sy = 0, sz = 0; for (let o = o0; o < o1; o++) { const j = idx[o] * 3; sx += d[j]; sy += d[j + 1]; sz += d[j + 2]; }
      const inv = 1 / (o1 - o0), ww = k * w[i];
      tmp[q * 3] = d[i * 3] + ww * (sx * inv - d[i * 3]); tmp[q * 3 + 1] = d[i * 3 + 1] + ww * (sy * inv - d[i * 3 + 1]); tmp[q * 3 + 2] = d[i * 3 + 2] + ww * (sz * inv - d[i * 3 + 2]);
    }
    for (let q = 0; q < n; q++) { const i = list[q]; d[i * 3] = tmp[q * 3]; d[i * 3 + 1] = tmp[q * 3 + 1]; d[i * 3 + 2] = tmp[q * 3 + 2]; }
  }
  return d;
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

// ---------------------------------------------------------------- baked ambient occlusion
// Hemisphere AO, baked per fit on the fitted body in the fit pose. A per-vertex curvature ("cavity") term is local
// and noisy — it was what put grey mottling on the chest — and it cannot see that the chin is over the neck or the
// arm beside the flank. This bakes real occlusion: the surface is rasterized into a coarse solid-voxel occupancy
// grid, then every vertex shoots a cosine-weighted ray bundle into its hemisphere and marches the grid. That is
// what darkens the armpits, under the chin and the pecs, the inner thighs, the waistband and every joint.
const AO_DIRS = (() => {              // 28 cosine-weighted hemisphere directions about +Z (Fibonacci disc → cosine)
  const K = 24, d = new Float32Array(K * 3);
  for (let i = 0; i < K; i++) {
    const r = Math.sqrt((i + 0.5) / K), th = i * 2.399963229728653;
    const x = r * Math.cos(th), y = r * Math.sin(th);
    d[i * 3] = x; d[i * 3 + 1] = y; d[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  }
  return d;
})();
/** Per-vertex ambient occlusion (1 = open sky, 0 = fully enclosed) for a mesh in inches. Pure; used by fitBody. */
export function bakeAO(pos, nrm, tris, n, opts = {}) {
  const cell = opts.cell || 0.72, maxD = opts.maxDist || 7.5, minD = opts.minDist || 0.95, step = cell * 0.85;
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  const pad = cell * 2;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  const inv = 1 / cell;
  const nx = Math.max(1, Math.ceil((x1 - x0) * inv)), ny = Math.max(1, Math.ceil((y1 - y0) * inv)), nz = Math.max(1, Math.ceil((z1 - z0) * inv));
  const occ = new Uint8Array(nx * ny * nz);
  const mark = (x, y, z) => {
    const ix = (x - x0) * inv | 0, iy = (y - y0) * inv | 0, iz = (z - z0) * inv | 0;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return;
    occ[(iz * ny + iy) * nx + ix] = 1;
  };
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    const e = Math.max(Math.abs(bx - ax) + Math.abs(by - ay) + Math.abs(bz - az),
                       Math.abs(cx - bx) + Math.abs(cy - by) + Math.abs(cz - bz),
                       Math.abs(ax - cx) + Math.abs(ay - cy) + Math.abs(az - cz));
    const m = e < cell ? 1 : Math.min(4, 1 + (e * inv | 0));
    for (let u = 0; u <= m; u++) for (let v = 0; v + u <= m; v++) {
      const wb = u / m, wc = v / m, wa = 1 - wb - wc;
      mark(ax * wa + bx * wb + cx * wc, ay * wa + by * wb + cy * wc, az * wa + bz * wb + cz * wc);
    }
  }
  const steps = Math.max(1, Math.ceil((maxD - minD) / step)), K = AO_DIRS.length / 3, ao = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const vx = nrm[i * 3], vy = nrm[i * 3 + 1], vz = nrm[i * 3 + 2];
    const sgn = vz >= 0 ? 1 : -1, ia = -1 / (sgn + vz), ib = vx * vy * ia;          // Duff et al. branchless ONB
    const t0x = 1 + sgn * vx * vx * ia, t0y = sgn * ib, t0z = -sgn * vx;
    const t1x = ib, t1y = sgn + vy * vy * ia, t1z = -vy;
    const px = pos[i * 3] + vx * cell * 0.7, py = pos[i * 3 + 1] + vy * cell * 0.7, pz = pos[i * 3 + 2] + vz * cell * 0.7;
    // rotate the bundle about the normal by a per-vertex angle: a shared direction set resonates with the voxel
    // grid and prints square patches across flat areas (it did, on the clavicles)
    const ph = (Math.sin(i * 12.9898 + px * 4.1) * 43758.5453) % 1 * 6.2831853;
    const cr = Math.cos(ph), sr = Math.sin(ph);
    let vis = 0;
    for (let k = 0; k < K; k++) {
      const d0 = AO_DIRS[k * 3], d1 = AO_DIRS[k * 3 + 1], dz = AO_DIRS[k * 3 + 2];
      const dx = d0 * cr - d1 * sr, dy = d0 * sr + d1 * cr;
      const rx = t0x * dx + t1x * dy + vx * dz, ry = t0y * dx + t1y * dy + vy * dz, rz = t0z * dx + t1z * dy + vz * dz;
      let occl = 0;
      for (let s = 0; s < steps; s++) {
        const d = minD + s * step;
        const ix = (px + rx * d - x0) * inv | 0, iy = (py + ry * d - y0) * inv | 0, iz = (pz + rz * d - z0) * inv | 0;
        if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) break;
        if (occ[(iz * ny + iy) * nx + ix]) { const f = 1 - d / maxD; occl = f * f; break; }
      }
      vis += 1 - occl;
    }
    ao[i] = vis / K;
  }
  // two Laplacian passes: the ray bundle is small, so the raw field has sampling grain the eye reads as dirt
  const sm = new Float32Array(n), cnt = new Float32Array(n);
  for (let pass = 0; pass < 3; pass++) {
    sm.fill(0); cnt.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      sm[a] += ao[b] + ao[c]; sm[b] += ao[a] + ao[c]; sm[c] += ao[a] + ao[b];
      cnt[a] += 2; cnt[b] += 2; cnt[c] += 2;
    }
    for (let i = 0; i < n; i++) if (cnt[i]) ao[i] = 0.38 * ao[i] + 0.62 * sm[i] / cnt[i];
  }
  return ao;
}

// ================================================================== morphing (macro muscle × weight grid)
function muscleParam(score) { return clamp(0.35 + 0.65 * score, 0, 1); }
// ---------------------------------------------------------------- visual body-fat calibration
// bodyFatPct is DXA-equivalent (the app's scale; ≈ 3–5 points above Navy-tape / caliper numbers for the same body).
//  - avg: the body fat that renders as MakeHuman's AVERAGE weight = the population-median DXA body fat of young adults
//    (≈ 25 % men, ≈ 36 % women; NHANES 1999–2004 DXA, Kelly, Wilson & Heymsfield 2009, PLoS One 4:e7038 — value from
//    the project's research summary, rounded). The weight morph's character is kept modest (±0.35 of the axis over
//    ±14 points) because the tape girths already carry the fat volume; it only shifts where the volume sits.
//  - definition (HEURISTIC: no validated visual-body-fat data exists; coaching rules of thumb converted to DXA):
//    men: an upper-ab outline starts below ≈ 18 %, full abs by ≈ 12.5 %; delt / arm / chest separation from ≈ 23 %,
//    scaled by muscle score. Women ≈ +8 points on each threshold (essential and sex-specific fat; coaching charts put
//    visible female abs ≈ 6–8 points above the male level). Every term is a smoothstep: no hard cutoffs.
//  - muscle-shape sculpt (bulk, not lines) stays at full strength through the separation range and softens only above
//    it (to −40 % at avg + 10).
export const BF_CAL = {
  male: { avg: 25, absStart: 18, absFull: 12.5, sepStart: 23, sepFull: 14 },
  female: { avg: 36, absStart: 26, absFull: 20.5, sepStart: 31, sepFull: 22 },
};
function weightParam(bf, sex = 'male') { const c = BF_CAL[sex === 'female' ? 'female' : 'male']; return clamp(0.5 + (bf - c.avg) / 40, 0.12, 0.88); }
/** Definition levels for the shader: { upper, full, sep } (0..≈1.2), from body fat (DXA) and the mean muscle score. */
export function definitionLevels(bf, muscleMean = 0.4, sex = 'male') {
  const c = BF_CAL[sex === 'female' ? 'female' : 'male'], m = clamp(num(muscleMean) ?? 0.4, 0, 1);
  const k = (0.45 + 0.8 * m) * (sex === 'female' ? 0.8 : 1);   // trained bodies show more; female lines a little softer
  return {
    upper: k * sstep(c.absStart, c.absStart - 4, bf),          // linea alba, upper intersections, lateral border
    full: k * sstep(c.absStart - 2.5, c.absFull, bf),           // all blocks, lower intersection, V lines, serratus
    sep: (0.3 + 0.9 * m) * sstep(c.sepStart, c.sepFull, bf),    // delt / arm / chest separation (crease depth)
  };
}
// Female cup size: pick the cup morph weight w ∈ [−1, 1] (−1 = min cup, +1 = max cup) whose bust / ribcage girth
// ratio (convex hulls of the torso at the bust point and 1 in below the inframammary fold, on the morphed bind mesh)
// best matches anthro's bust / underbust; the stations then fit both girths exactly, so the cup only decides how
// much of the bust is breast vs ribcage.
function cupGirths(A, P, w) {
  const c = w < 0 ? A.cups[0] : A.cups[1], k = Math.abs(w), Q = k ? Float32Array.from(P) : P;
  if (k) for (let j = 0; j < c.idx.length; j++) { const i = c.idx[j]; Q[i * 3] += k * c.d[j * 3]; Q[i * 3 + 1] += k * c.d[j * 3 + 1]; Q[i * 3 + 2] += k * c.d[j * 3 + 2]; }
  return { bust: sliceHull(Q, A.cupTris, () => true, Q[A.lm.nippleV * 3 + 1]).per, Q };
}
export function cupWeight(A, P, ratio) {
  if (!A.cups || A.cups.length < 2 || !(ratio > 0) || A.lm.imfV == null) return 0;
  const rib = sliceHull(P, A.cupTris, () => true, P[A.lm.imfV * 3 + 1] - 0.254).per;
  if (!(rib > 0)) return 0;
  const r = [-1, 0, 1].map(w => cupGirths(A, P, w).bust / rib);
  if (ratio <= r[0]) return -1;
  if (ratio >= r[2]) return 1;
  return ratio < r[1] ? -1 + (ratio - r[0]) / ((r[1] - r[0]) || 1e-9) : (ratio - r[1]) / ((r[2] - r[1]) || 1e-9);
}
function morphPositions(A, bf, muscle, cupRatio = null) {
  const P = Float32Array.from(A.base), sex = A.sex || 'male';
  const mu = { ...DEF_MUSCLE, ...(muscle || {}) };
  const reg = A.regions.map(r => muscleParam(clamp(num(mu[r]) ?? 0.4, 0, 1)));
  const mDef = muscleParam(A.regions.reduce((t, r) => t + clamp(num(mu[r]) ?? 0.4, 0, 1), 0) / A.regions.length);
  const w = weightParam(bf, sex);
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
  // female: cup size from the bust / underbust ratio (before the sculpt, on the macro-morphed mesh)
  let cup = 0;
  if (A.cups && A.cups.length === 2 && cupRatio) {
    cup = cupWeight(A, P, cupRatio);
    if (cup) { const c = cup < 0 ? A.cups[0] : A.cups[1], k = Math.abs(cup); for (let j = 0; j < c.idx.length; j++) { const i = c.idx[j]; P[i * 3] += k * c.d[j * 3]; P[i * 3 + 1] += k * c.d[j * 3 + 1]; P[i * 3 + 2] += k * c.d[j * 3 + 2]; } }
  }
  P.cup = cup;
  // region sculpt, scaled by each score (≈ flat at 0.3, full at 1) and softened by fat
  // (female: the pec sculpt is mostly hidden under breast tissue, so it is kept small; see BF_CAL for the fat softening)
  const cal = BF_CAL[sex], R = A.sculptRegions.length, fat = 1 - 0.4 * sstep(cal.sepStart, cal.avg + 10, bf);
  const amp = A.sculptRegions.map(r => clamp(0.1 + 1.15 * clamp(num(mu[r]) ?? 0.4, 0, 1), 0, 1.25) * fat * (sex === 'female' && r === 'chest' ? 0.3 : 1));
  for (let i = 0; i < nMesh; i++) for (let r = 0; r < R; r++) {
    const k = amp[r]; if (!k) continue;
    const o = (i * R + r) * 3; P[i * 3] += k * A.sculpt[o]; P[i * 3 + 1] += k * A.sculpt[o + 1]; P[i * 3 + 2] += k * A.sculpt[o + 2];
  }
  if (A.modesty) regionTaubin(A, P, A.modestyList, A.modesty, 60, 0.6, -0.55);   // female: smooth nipples / crease last (see prepareAsset)
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
// side mirrors x unless given. u = upper arm (shoulder→elbow), f = forearm (elbow→wrist), palm = palm normal,
// wrist = hand flexion toward the palm (rad) from the forearm axis, curl = finger curl (0 open … 1 fist).
// Torso (degrees unless noted): pelvis { yaw (rad), tilt (+ = subject's left hip up), pitch (+ = anterior tilt) },
// spine { twist (rad, chest yaw), side (+ = left shoulder up), lean (rad, − = chest lifted / extended) },
// head { yaw (rad), roll, pitch } (default: level, facing with the chest). clav / clavL / clavR { elev (deg),
// retract (rad, − = protracted) }. shift = [lateral, forward] root shift in inches (weight over the standing leg).
// feet { L, R }: { at: [outward, forward] ankle offset from the rest stance (inches at 69 in, scaled with stature),
// out (deg toe-out, the knee follows), heel (deg heel raise, pivoting on the toe pads), knee (deg extra knee aim
// inward + / outward −) }. Legs are solved with two-bone IK to those ankle targets; the pelvis drops just enough
// that both feet reach, so no pose floats or sinks. Poses without `feet` keep anthro's rest legs.
// 'rest' is the FIT pose (not a user pose): anthro's rest joints, no weight shift. Every girth / length / height is
// fitted in it; 'relaxed' is the same arms and body with a subtle contrapposto, so it keeps the fitted girths.
const RELAXED_ARMS = { palm: [-0.94, 0, -0.34], wrist: 0.03, curl: [0.07, 0.28] };   // semi-pronated (thumbs forward), wrist ~neutral, fingers softly curled
export const POSE_SPECS = {
  rest: { view: { yaw: 0.32, pitch: 0.06 }, flex: 0, ...RELAXED_ARMS },
  // weight on the right leg: the left hip drops ~4°, the left knee softens with the foot a little forward and out,
  // the shoulder line counter-tilts, the head stays level, a slight lumbar curve (pelvis tipped forward 3°)
  relaxed: {
    view: { yaw: 0.32, pitch: 0.06 }, flex: 0, ...RELAXED_ARMS,
    pelvis: { tilt: -4, pitch: 3 }, spine: { side: 2.5, lean: -0.02 }, shift: [-0.6, 0],
    feet: { L: { at: [0.5, 1.4], out: 10, knee: 4 }, R: { at: [-0.4, -0.2], out: 4 } },
  },
  // upper arms just above horizontal and a little forward of the frontal plane, elbows ~105°, fists supinated
  // toward the head with the wrists slightly flexed; chest up, lats slightly flared; feet ~shoulder width, the left
  // foot a touch forward and turned out, legs straight (quads set)
  front_double_biceps: {
    view: { yaw: 0.0, pitch: 0.04 }, flex: 1, curl: 1, lat: 0.7, wrist: 0.32,
    arm: { u: [0.945, 0.15, 0.29], f: [-0.5, 0.86, 0.08], palm: [-0.8, 0.05, -0.6] },
    clav: { elev: 6, retract: 0.04 }, spine: { lean: -0.06 },
    feet: { L: { at: [2.2, 1.6], out: 16 }, R: { at: [1.8, -0.4], out: 10 } },
  },
  // fists on the top of the hips / lower waist (knuckles on the obliques), elbows driven forward and out, scapulae
  // protracted so the lats flare wide, chest lifted
  lat_spread: {
    view: { yaw: 0.0, pitch: 0.04 }, flex: 0.3, curl: 1, lat: 1.8, wrist: 0.15,
    ik: { target: 'waist', pole: [0.55, -0.1, 0.83] }, palm: [-0.7, 0.3, 0.65], hand: [0.3, -0.75, -0.6],
    clav: { elev: 5, retract: -0.26 }, spine: { lean: -0.07 }, chestScale: [1.03, 1, 1.02],
    feet: { L: { at: [2.0, 1.2], out: 14 }, R: { at: [1.8, -0.4], out: 10 } },
  },
  // left side to the camera (the camera sits ~80° to the left): hips nearly in profile, chest turned ~45° toward the
  // camera and lifted, near (left) shoulder raised and forward; the front arm bent ~90° across the abdomen with the
  // fist clenched, the rear hand gripping the front wrist; head turned to the camera; front (left) leg bent, knee
  // forward and in, heel raised; rear leg straight, foot turned out
  side_chest: {
    view: { yaw: 1.42, pitch: 0.05 }, flex: 0.85, curl: 1, lat: 0.4,
    pelvis: { yaw: 0.16 }, spine: { twist: 0.76, lean: -0.11 }, head: { yaw: 1.12 },
    clavL: { elev: 9, retract: -0.18 }, clavR: { elev: 3, retract: 0.12 },
    armL: { ik: { target: 'clasp', offset: [0.3, 2.6, 1.6], pole: [0.75, -0.5, -0.45] }, palm: [-0.35, 0.85, -0.4], wrist: 0.2 },
    armR: { ik: { target: 'wristL', offset: [-0.3, -0.8, -0.3], pole: [-0.85, -0.45, -0.25] }, palm: [0.25, 0.6, 0.75], wrist: 0.1 },
    chestScale: [1.0, 1, 1.05],
    feet: { L: { at: [-0.5, 3.4], out: 0, heel: 22, knee: 5 }, R: { at: [0.6, -0.6], out: 26 } },
  },
  // the front double biceps from behind: elbows slightly back, scapulae retracted, the left leg stepped back onto the
  // ball of the foot (calf shown), right leg straight
  back_double_biceps: {
    view: { yaw: Math.PI, pitch: 0.06 }, flex: 1, curl: 1, lat: 1.0, wrist: 0.32,
    arm: { u: [0.95, 0.19, -0.16], f: [-0.5, 0.86, -0.08], palm: [-0.78, 0.05, -0.62] },
    clav: { elev: 10, retract: 0.22 }, spine: { lean: -0.05 },
    feet: { L: { at: [0.6, -7.5], out: 6, heel: 22 }, R: { at: [1.4, 0.6], out: 12 } },
  },
};
export const FIT_POSE = 'rest';

export const POSE_MS = 450;
/** Pose-transition ease: smootherstep (zero velocity and acceleration at both ends, monotone, no overshoot). */
export function poseEase(t) { t = clamp(t, 0, 1); return t * t * t * (t * (6 * t - 15) + 10); }

function twoBoneIK(S, T, Lu, Lf, pole) {
  let d = vsub(T, S); let L = vlen(d);
  L = clamp(L, Math.abs(Lu - Lf) + 1e-3, Lu + Lf - 1e-3);
  const dn = vnorm(d);
  const a = (Lu * Lu - Lf * Lf + L * L) / (2 * L), h = Math.sqrt(Math.max(0, Lu * Lu - a * a));
  const pn = vnorm(vsub(pole, vmul(dn, vdot(pole, dn))));
  const E = vadd(vadd(S, vmul(dn, a)), vmul(pn, h));
  return { u: vnorm(vsub(E, S)), f: vnorm(vsub(vadd(S, vmul(dn, L)), E)), pn, dn };
}

/**
 * Global bone rotations for a pose. ctx = { A, rest (bind heads), frames, geom, sections, joints }.
 * Returns { q: [quat per bone], scale: {boneIdx: [sx,sy,sz]}, root: [x,y,z] (root shift, inches), flex, lat }.
 */
export function poseGlobals(ctx, name) {
  const { A, frames } = ctx;
  const nb = A.bones.length, B = A.B, q = new Array(nb).fill(null).map(QI), scale = {};
  const spec = POSE_SPECS[name] || POSE_SPECS.relaxed;
  const heads = ctx.rest, G = ctx.joints || ctx.geom.joints, kH = (ctx.geom.heightIn || 69) / 69;
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1], D = Math.PI / 180;
  // torso chain: yaw · lateral bend · pitch per bone, blended pelvis → chest; the head is level unless told otherwise
  const pel = spec.pelvis || {}, sp = spec.spine || {}, hs = spec.head || {};
  const pYaw = pel.yaw || 0, twist = sp.twist ?? pYaw, lean = sp.lean || 0;
  const tilt = (pel.tilt || 0) * D, pitch = (pel.pitch || 0) * D, side = (sp.side || 0) * D;
  const hYaw = hs.yaw ?? twist * 1.08, hRoll = (hs.roll || 0) * D, hPitch = (hs.pitch || 0) * D;
  const tq = (yaw, roll, pit) => qMul(qAxis(Y, yaw), qMul(qAxis(Z, roll), qAxis(X, pit)));
  const qPel = tq(pYaw, tilt, pitch);
  q[B.pelvis] = qPel;
  q[B.spine1] = tq(mix(pYaw, twist, 0.3), mix(tilt, side, 0.3), mix(pitch, lean, 0.3));
  q[B.spine2] = tq(mix(pYaw, twist, 0.65), mix(tilt, side, 0.75), mix(pitch, lean, 0.7));
  q[B.chest] = tq(twist, side, lean);
  q[B.neck] = tq(mix(twist, hYaw, 0.4), mix(side, hRoll, 0.6), mix(lean, hPitch, 0.6));
  q[B.head] = tq(hYaw, hRoll, hPitch);
  if (spec.chestScale) scale[B.chest] = spec.chestScale;
  for (const s of SIDES) {
    const sg = s === 'L' ? 1 : -1, c = spec['clav' + s] || spec.clav || {};
    q[B['clav' + s]] = qMul(q[B.chest], qMul(qAxis(Y, sg * (c.retract || 0)), qAxis(Z, sg * (c.elev || 0) * D)));
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
    if (spec.arm) return s === 'L' ? spec.arm : { ...spec.arm, u: mirrorX(spec.arm.u), f: mirrorX(spec.arm.f), palm: mirrorX(spec.arm.palm) };
    if (spec.ik) return { ik: spec.ik, palm: s === 'L' ? spec.palm : mirrorX(spec.palm), hand: spec.hand && (s === 'L' ? spec.hand : mirrorX(spec.hand)) };
    return null;
  };
  let wristL = null;
  for (const s of SIDES) {
    const F = frames[s], sg = s === 'L' ? 1 : -1;
    let u, f, palm;
    const as = armSpec(s);
    const S = posedHead(B['uarm1' + s]);
    const Lu = boneLen(heads, A, 'uarm1' + s, 'farm1' + s), Lf = boneLen(heads, A, 'farm1' + s, 'hand' + s);
    if (!as) { // relaxed / rest: aim at anthro's rest joints (arms hang plumb whatever the torso does)
      const gS = G['shoulder' + s], gE = G['elbow' + s], gW = G['wrist' + s];
      u = vnorm([gE.x - gS.x, gE.y - gS.y, gE.z - gS.z]); f = vnorm([gW.x - gE.x, gW.y - gE.y, gW.z - gE.z]);
      const pm = spec.palm || [-1, 0, 0.12];
      palm = s === 'L' ? pm : mirrorX(pm);
    } else if (as.ik) {
      let T;
      const sec = ctx.sections || {};
      const w = sec.waist || { w: 6, d: 4.5, cz: 0, y: ctx.geom.landmarks.waist.y };
      const off = as.ik.offset || [0, 0, 0];
      if (as.ik.target === 'waist') {          // wrist at the side of the waist, a little behind: fist on the obliques
        T = bodyDir([sg * (w.w + 1.1), w.y - 0.9, w.cz - 0.12 * w.d]);
      } else if (as.ik.target === 'clasp') {   // in front of the abdomen, turned with the chest
        const C = [1.0 + off[0], w.y + 3.2 + off[1], w.cz + w.d + 2.2 + off[2]];
        T = qRot(qAxis(Y, twist * 0.85), C);
      } else if (as.ik.target === 'wristL' && wristL) {   // grip the other wrist
        T = vadd(wristL, bodyDir(off));
      } else T = vadd(S, [0, -Lu - Lf, 0]);
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
    const qTw = qMul(qConj(qSw), qU);
    const tw = 2 * Math.atan2(vdot([qTw[0], qTw[1], qTw[2]], F.u0), qTw[3]);
    q[B['uarm1' + s]] = qMul(qAxis(u, tw * 0.5), qSw);
    q[B['uarm2' + s]] = qU;
    let qF = qFrames(F.f0, F.h0, f, h);
    const pr = twistAngle(f, qRot(qF, F.p0), palm);
    q[B['farm1' + s]] = qMul(qAxis(f, pr * 0.5), qF);
    qF = qMul(qAxis(f, pr), qF);
    q[B['farm2' + s]] = qF;
    // wrist: the bind hand is flexed ~15° toward the palm; put it on the forearm axis, then flex it by `wrist`
    // (or aim it along an explicit body-space `hand` direction, e.g. fists set against the obliques)
    const wr = (as && as.wrist != null) ? as.wrist : (spec.wrist ?? 0);
    const pN0 = qRot(qF, F.p0), pPerp = vnorm(vsub(pN0, vmul(f, vdot(pN0, f))));
    const hdT = as && as.hand ? bodyDir(vnorm(as.hand)) : vnorm(vadd(vmul(f, Math.cos(wr)), vmul(pPerp, Math.sin(wr))));
    const qH = qMul(qFromTo(qRot(qF, F.hd0), hdT), qF);
    q[B['hand' + s]] = qH;
    // fingers: curl about the knuckle axis toward the palm
    // (a number: 0 open … 1 fist; or [knuckle, finger] angles in rad for a relaxed cascade)
    const cv = (as && as.curl != null) ? as.curl : (spec.curl ?? 0.2);
    const curl = Array.isArray(cv) ? (cv[0] + cv[1]) / 2.8 : cv, c1a = Array.isArray(cv) ? cv[0] : curl * 1.35, c2a = Array.isArray(cv) ? cv[1] : curl * 1.45;
    const kAx = qRot(qH, F.k0), pN = qRot(qH, F.p0), hd = qRot(qH, F.hd0);
    const sgn = Math.sign(vdot(vcross(kAx, hd), pN)) || 1;   // rotating hd toward the palm
    const c1 = qMul(qAxis(kAx, sgn * c1a), qH);
    q[B['fing1' + s]] = c1;
    q[B['fing2' + s]] = qMul(qAxis(kAx, sgn * c2a), c1);
    // thumb (one rigid bone): in a fist it is tucked against the curled index/middle fingers instead of sticking out
    q[B['thumb' + s]] = qMul(qAxis(pN, -sg * curl * 0.5), qMul(qAxis(hd, -sg * curl * 0.6), qMul(qAxis(kAx, -sgn * curl * 0.2), qH)));
    if (s === 'L') { // remember the posed left wrist for two-handed poses
      wristL = vadd(vadd(S, qRot(q[B['uarm2' + s]], vsub(heads[B['farm1' + s]], heads[B['uarm1' + s]]))), qRot(qF, vsub(heads[B['hand' + s]], heads[B['farm1' + s]])));
      ctx._wristL = wristL;
    }
  }
  // legs
  let root = [0, 0, 0];
  const restLeg = s => {
    const gH = G['hip' + s], gK = G['knee' + s], gA = G['ankle' + s];
    return { t: vnorm([gK.x - gH.x, gK.y - gH.y, gK.z - gH.z]), s: vnorm([gA.x - gK.x, gA.y - gK.y, gA.z - gK.z]) };
  };
  if (!spec.feet) {
    for (const s of SIDES) {
      const F = frames[s], { t, s: sh } = restLeg(s);
      q[B['thigh' + s]] = qMul(qPel, qFromTo(F.t0, t));
      q[B['shin' + s]] = qMul(qPel, qFromTo(F.s0, sh));
      q[B['foot' + s]] = qPel;
    }
  } else {
    const shift = spec.shift ? [spec.shift[0] * kH, 0, (spec.shift[1] || 0) * kH] : [0, 0, 0];
    const qPy = qAxis(Y, pYaw), pc = heads[B.pelvis];
    const sol = {};
    for (const s of SIDES) {
      const sg = s === 'L' ? 1 : -1, fs = spec.feet[s] || {};
      const Lt = boneLen(heads, A, 'thigh' + s, 'shin' + s), Ls = boneLen(heads, A, 'shin' + s, 'foot' + s);
      const { t, s: sh } = restLeg(s);
      const ank0 = vadd(heads[B['thigh' + s]], vadd(vmul(t, Lt), vmul(sh, Ls)));   // rest ankle (world)
      const at = fs.at || [0, 0], yawF = pYaw + sg * (fs.out || 0) * D, heel = (fs.heel || 0) * D;
      const rel = vsub(ank0, [pc[0], ank0[1], pc[2]]);
      let T = vadd(vadd([pc[0], ank0[1], pc[2]], qRot(qPy, rel)), qRot(qPy, [sg * at[0] * kH, 0, at[1] * kH]));
      if (heel) {   // heel raise pivoting on the toe pads (≈ 85 % of the way ankle → toe tip)
        const gA = G['ankle' + s], gT = G['toe' + s] || { x: gA.x, y: 0, z: gA.z + 0.55 * 0.152 * kH * 69 };
        const dv = qRot(qAxis(Y, yawF - (pYaw || 0)), [gT.x - gA.x, 0, gT.z - gA.z]);
        const d = 0.85 * Math.hypot(dv[0], dv[2]), hgt = ank0[1], fwd = vnorm(qRot(qPy, [dv[0], 0, dv[2]]));
        T = vadd(T, vadd([0, hgt * (Math.cos(heel) - 1) + d * Math.sin(heel), 0], vmul(fwd, d * (1 - Math.cos(heel)) + hgt * Math.sin(heel))));
      }
      sol[s] = { T, Lt, Ls, yawF, heel, knee: (fs.knee || 0) * D, sg };
    }
    // drop the pelvis just enough that both feet reach their targets (a straight leg stays straight)
    let drop = 0;
    for (const s of SIDES) {
      const S = sol[s], hip = vadd(posedHead(B['thigh' + s]), shift), L = (S.Lt + S.Ls) * 0.9995;
      const dx = S.T[0] - hip[0], dz = S.T[2] - hip[2];
      drop = Math.max(drop, hip[1] - (S.T[1] + Math.sqrt(Math.max(0, L * L - dx * dx - dz * dz))));
    }
    root = [shift[0], -drop, shift[2]];
    for (const s of SIDES) {
      const S = sol[s], F = frames[s];
      const hip = vadd(posedHead(B['thigh' + s]), root);
      const ka = S.yawF - S.sg * S.knee, pole = [Math.sin(ka), 0, Math.cos(ka)];
      const ik = twoBoneIK(hip, S.T, S.Lt, S.Ls, pole);
      const hinge = vnorm(vcross(ik.pn, ik.dn));
      q[B['thigh' + s]] = qFrames(F.t0, X, ik.u, hinge);
      q[B['shin' + s]] = qFrames(F.s0, X, ik.f, hinge);
      const qy = qAxis(Y, S.yawF);
      q[B['foot' + s]] = qMul(qAxis(qRot(qy, X), S.heel), qy);
    }
  }
  return { q, scale, root, flex: spec.flex || 0, lat: spec.lat || 0 };
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
    if (p < 0) J[b] = pose.root ? vadd(vadd(heads[b], rootOffset), pose.root) : vadd(heads[b], rootOffset);
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
function unskinPositions(A, posed, M, n = A.nMesh, dirs = false) {
  const o = new Float32Array(n * 3), { skinIdx, skinW } = A, b = new Float64Array(12);
  for (let i = 0; i < n; i++) {
    b.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = skinW[i * 4 + k]; if (!w) continue;
      const m = skinIdx[i * 4 + k] * 16;
      for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) b[c * 3 + r] += w * M[m + c * 4 + r];
    }
    const px = posed[i * 3] - (dirs ? 0 : b[9]), py = posed[i * 3 + 1] - (dirs ? 0 : b[10]), pz = posed[i * 3 + 2] - (dirs ? 0 : b[11]);
    const a = b[0], d = b[3], g = b[6], bb = b[1], e = b[4], h = b[7], c = b[2], f = b[5], k2 = b[8];
    const det = a * (e * k2 - f * h) - d * (bb * k2 - c * h) + g * (bb * f - c * e) || 1e-9;
    // inverse of [[a d g],[bb e h],[c f k2]]
    o[i * 3] = ((e * k2 - f * h) * px + (g * f - d * k2) * py + (d * h - g * e) * pz) / det;
    o[i * 3 + 1] = ((h * c - bb * k2) * px + (a * k2 - g * c) * py + (g * bb - a * h) * pz) / det;
    o[i * 3 + 2] = ((bb * f - e * c) * px + (d * c - a * f) * py + (a * e - d * bb) * pz) / det;
    if (dirs) { const l = Math.hypot(o[i * 3], o[i * 3 + 1], o[i * 3 + 2]) || 1; o[i * 3] /= l; o[i * 3 + 1] /= l; o[i * 3 + 2] /= l; }
  }
  return o;
}

// ================================================================== fitting
function geometryFor(shape, bodyFatPct, muscle, sex = 'male') {
  // §21b: only the stature falls back to a default. Every missing tape site is left to anthro, which estimates it
  // from THIS body's height and weight and records it in geom.estimated. Filling them here from a fixed median
  // tape drew an average-sized body for anyone who had not taped themselves, so a 300 lb user with only a weight
  // logged came out average and narrow, and anthro could not tell a measured site from a defaulted one.
  const sh = { ...(shape || {}) };
  if (!num(sh.heightIn)) sh.heightIn = (sex === 'female' ? DEF_SHAPE_F : DEF_SHAPE).heightIn;
  const avg = (a, b) => (num(a) && num(b) ? (a + b) / 2 : num(a) ?? num(b));
  const limbs = {};
  for (const k of ['armL', 'armR', 'thighL', 'thighR', 'calfL', 'calfR']) if (num(sh[k])) limbs[k] = sh[k];
  for (const k of ['arm', 'thigh', 'calf']) if (!num(shape?.[k])) { const a = avg(sh[k + 'L'], sh[k + 'R']); if (a) sh[k] = a; }
  if (sex !== 'female') return bodyGeometry({ ...sh, limbs, bodyFatPct: num(bodyFatPct) ?? DEF_BF, muscle: { ...DEF_MUSCLE, ...(muscle || {}) }, sex: 'male' });
  return bodyGeometry({ ...sh, limbs, bodyFatPct: num(bodyFatPct) ?? DEF_BF_F, muscle: { ...DEF_MUSCLE, ...(muscle || {}) }, sex: 'female' });
}

/**
 * Per-side joints (CONTRACT §16c). anthro returns per-side joints and joint-centre bone lengths
 * (geom.bones.upperArmL/R, forearmL/R, thighL/R, shankL/R). When per-side bones are present but the joints do not
 * honour them (older anthro), each limb chain is re-laid along anthro's own directions with those lengths: arms
 * from the shoulder down, legs from the ankle up (stature and floor contact are measured, so a longer leg raises its
 * hip: pelvis tilt). Where joints already match the bones this is a no-op.
 */
export function sideJoints(geom) {
  const J = {}; for (const [k, v] of Object.entries(geom.joints)) J[k] = { ...v };
  const bn = geom.bones || {};
  const P = j => [j.x, j.y, j.z], O = p => ({ x: p[0], y: p[1], z: p[2] });
  const relay = (from, to, len) => {
    const a = P(J[from]), b = P(J[to]), d = vsub(b, a), L = vlen(d) || 1, nb = vadd(a, vmul(d, len / L));
    J[to] = O(nb); return vsub(nb, b);
  };
  const shift = (k, d) => { if (J[k]) J[k] = O(vadd(P(J[k]), d)); };
  for (const s of SIDES) {
    const has = k => num(bn[k + s]) && bn[k + s] > 0;
    if (has('upperArm')) { const d = relay('shoulder' + s, 'elbow' + s, bn['upperArm' + s]); shift('wrist' + s, d); shift('hand' + s, d); }
    if (has('forearm')) shift('hand' + s, relay('elbow' + s, 'wrist' + s, bn['forearm' + s]));
    if (has('shank')) shift('hip' + s, relay('ankle' + s, 'knee' + s, bn['shank' + s]));
    if (has('thigh')) relay('knee' + s, 'hip' + s, bn['thigh' + s]);
  }
  return J;
}
// piecewise-linear map through matching knots (ascending xs), linear extrapolation beyond the ends
function plMap(xs, ys) {
  return x => {
    const n = xs.length; let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const t = (x - xs[k]) / ((xs[k + 1] - xs[k]) || 1e-9);
    return ys[k] + (ys[k + 1] - ys[k]) * t;
  };
}
/** Limb profile samples with heights moved onto the per-side joints (identity when anthro already did so). */
function limbProfile(geom, J, part) {
  const prof = geom.profiles[part], s = part.slice(-1), G0 = geom.joints;
  const at = name => (prof.find(p => p.name === name) || {}).y;
  const arm = part.startsWith('arm');
  const from = arm ? [at('wrist'), at('elbow'), G0['shoulder' + s].y] : [at('ankle'), at('knee'), G0['hip' + s].y];
  const to = arm ? [J['wrist' + s].y, J['elbow' + s].y, J['shoulder' + s].y] : [J['ankle' + s].y, J['knee' + s].y, J['hip' + s].y];
  if (from.some(v => !num(v)) || from.every((v, i) => Math.abs(v - to[i]) < 0.02)) return prof;
  const f = plMap(from, to);
  return prof.map(p => ({ ...p, y: f(p.y) }));
}

/**
 * Fit the base mesh to a body. Returns the bind-pose (rest) positions in inches, the bind skeleton, the
 * fitted relaxed-pose positions, and a report of every station.
 */
export function fitBody(A, opts = {}) {
  const t0 = now();
  const sex = A.sex === 'female' ? 'female' : 'male', FEM = sex === 'female';
  const bf = num(opts.bodyFatPct) ?? (FEM ? DEF_BF_F : DEF_BF);
  const muEff = FEM ? effectiveMuscle(opts.muscle, sex) : opts.muscle;   // (male: the scores as given)
  const geom = opts.geom || geometryFor(opts.shape, bf, muEff, sex);
  const H = geom.heightIn, LM = geom.landmarks, GJ = sideJoints(geom);
  const prof = { armL: limbProfile(geom, GJ, 'armL'), armR: limbProfile(geom, GJ, 'armR'), legL: limbProfile(geom, GJ, 'legL'), legR: limbProfile(geom, GJ, 'legR') };
  const { nMesh, N, B, bones, part, grp, seg, tris } = A;
  const nb = bones.length;

  // 1. morph, convert to inches, floor at 0
  const P = morphPositions(A, bf, muEff, FEM ? geom.landmarks.chest.girth / geom.landmarks.underbust.girth : null);
  let minY = Infinity;
  for (let i = 0; i < nMesh; i++) if (part[i] !== 6 && P[i * 3 + 1] < minY) minY = P[i * 3 + 1];
  for (let i = 0; i < N; i++) { P[i * 3] *= IN; P[i * 3 + 1] = (P[i * 3 + 1] - minY) * IN; P[i * 3 + 2] *= IN; }
  const sk0 = restSkeleton(A, P);
  const frames = restFrames(A, sk0);

  // 2. pose the unfitted mesh into anthro's rest pose
  const ctx0 = { A, rest: sk0.heads, frames, geom, joints: GJ };
  const relax = poseGlobals(ctx0, FIT_POSE);
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
  // head height and neck length from adult-male anthropometry (head size scales weakly with stature)
  const HT = headTargets(H, sex), chinT = H - HT.height, notchT = chinT - HT.neck;

  // 3a. vertical remap anchors (mesh height → anthro height), all in the rest pose
  // One map per leg (per-side ankle / calf / knee / thigh / hip heights, CONTRACT §16c); they share every anchor
  // from the hip up, so they agree on the trunk, and each vertex blends them by its left/right share (sideL).
  const yCr = qy(A.lm.crotchV);
  const lmY = (s, name, fb) => { const p = prof['leg' + s].find(q => q.name === name); return p ? p.y : fb; };
  const anchorsFor = s => { const yKnee = Jq[B['shin' + s]][1], yAnk = Jq[B['foot' + s]][1]; return [
    [0, 0],
    [yAnk, GJ['ankle' + s].y],
    [yKnee + A.lm.calfT * (yAnk - yKnee), lmY(s, 'calf', LM.calf.y)],
    [yKnee, GJ['knee' + s].y],
    [yCr - 0.017 * Hm, lmY(s, 'thigh', LM.thigh.y)],
    [yCr, LM.crotch.y],
    [qy(A.lm.buttV), LM.hip.y],
    [Jq[B['thigh' + s]][1], GJ['hip' + s].y],
    [qy(A.lm.navelV), geom.heights.navel ?? LM.waist.y],   // (female: the waist tape is the natural waist, above the navel)
    ...(A.lm.imfV != null ? [[qy(A.lm.imfV), LM.underbust.y]] : []),   // female: inframammary fold → anthro's underbust
    [qy(A.lm.nippleV), LM.chest.y],
    [Jq[B.uarm1L][1], GJ.shoulderL.y],
    [qy(A.notchV), notchT],
    [Jq[B.neck][1], geom.heights.neckBase],
    [qy(A.lm.chinV), chinT],
    // the head itself maps linearly (uniform vertical scale about the chin), keeping the base mesh's facial
    // proportions (eyes ≈ mid head height); without these the cubic stretches the face and squashes the cranium
    ...[0.12, 0.35, 0.6, 0.85].map(f => [mix(qy(A.lm.chinV), Hm, f), mix(chinT, H, f)]),
    [Hm, H],
  ].sort((a, b) => a[0] - b[0]); };
  const ymaps = {}, ax = [], ay = [];
  for (const s of SIDES) {
    const xs = [], ys = [];
    for (const [m, t] of anchorsFor(s)) if (!xs.length || (m > xs[xs.length - 1] + 0.05 && t > ys[ys.length - 1] + 0.05)) { xs.push(m); ys.push(t); }
    ymaps[s] = pchip(xs, ys);
    if (s === 'L') { ax.push(...xs); ay.push(...ys); }
  }
  const Y = (y, wl = 0.5) => { const l = pchipEval(ymaps.L, y, true), r = pchipEval(ymaps.R, y, true); return r + (l - r) * wl; };
  // left share of every vertex: left limbs 1, right limbs 0, trunk/head by a smooth ramp across the midline
  const sideL = new Float32Array(nMesh);
  for (let i = 0; i < nMesh; i++) { const o = i * 6; sideL[i] = clamp(grp[o + 2] + grp[o + 4] + (grp[o] + grp[o + 1]) * sstep(-0.8, 0.8, P[i * 3]), 0, 1); }
  const boneSide = b => { const g = bones[b].group; return g === 2 || g === 4 ? 1 : g === 3 || g === 5 ? 0 : sstep(-0.8, 0.8, sk0.heads[b][0]); };
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
  const trunkMap = (x, y, z, wl) => [x * hs, Y(y, wl), (z - z0) * hs];
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
    let px = x * hs, py = Y(y, sideL[i]), pz = (z - z0) * hs;
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
    if (sgb < 0) return trunkMap(j[0], j[1], j[2], boneSide(b));
    const s = bones[b].name.endsWith('L') ? 'L' : 'R';
    return armMap(s, j[0], j[1], j[2], sgb === 0 ? 1 : 0, sgb === 1 ? 1 : 0, sgb === 2 ? 1 : 0);
  });

  // 4. stations: horizontal sections scaled about their centres to anthro's sections
  const yCr1 = LM.crotch.y;
  const wbuf = new Float64Array(5), ebuf = new Float64Array(4);
  const stackW = (i, x, y, out = new Float64Array(5)) => {     // weights of [trunk, armL, armR, legL, legR]
    const o6 = i * 6, g4 = grp[o6 + 4], g5 = grp[o6 + 5];
    const up = sstep(yCr1 - 0.6, yCr1 + 1.2, y);
    // torso-weighted vertices always follow the trunk (scaled about the midline): sending the perineum to the two leg
    // stacks scaled it about two different centres and folded the crotch
    const torso = grp[o6] + grp[o6 + 1];
    out[0] = torso + (g4 + g5) * up; out[1] = grp[o6 + 2]; out[2] = grp[o6 + 3];
    out[3] = g4 * (1 - up); out[4] = g5 * (1 - up);
    return out;
  };
  const notArm = (a, b, c) => (part[a] < 2 || part[a] === 4 || part[a] === 5) && (part[b] < 2 || part[b] === 4 || part[b] === 5) && (part[c] < 2 || part[c] === 4 || part[c] === 5);
  const isPart = k => (a, b, c) => part[a] === k && part[b] === k && part[c] === k;
  const legSide = (sg) => (a, b, c) => (part[a] < 2 || part[a] > 3) && (part[b] < 2 || part[b] > 3) && (part[c] < 2 || part[c] > 3) && part[a] !== 6 &&
    P[a * 3] * sg > 0 && P[b * 3] * sg > 0 && P[c * 3] * sg > 0;   // side from the bind pose (legs apart)
  const stacks = [
    // upper-torso sections at deltoid/acromion/trap level are torso-only model values (not tapes) and the mesh's
    // part split there is ambiguous; the shoulders tape (loop around both arms) is enforced separately below.
    // The neck tape is the top trunk station: the scale holds above it and the head gets its own scale (5b), blended
    // by the head-bone weight, so the jaw is never squeezed by a neck-sized "chin" section.
    { name: 'trunk', ok: notArm, src: [...geom.profiles.torso.filter(s => !TRUNK_SKIP.has(s.name)), ...geom.profiles.neck.filter(s => s.name === 'neck')] },
    { name: 'armL', ok: isPart(2), src: prof.armL.filter(s => !ARM_SKIP.has(s.name)), tail: 'hand' },
    { name: 'armR', ok: isPart(3), src: prof.armR.filter(s => !ARM_SKIP.has(s.name)), tail: 'hand' },
    { name: 'legL', ok: legSide(1), src: prof.legL.filter(s => s.name !== 'legTop'), tail: 'foot' },
    { name: 'legR', ok: legSide(-1), src: prof.legR.filter(s => s.name !== 'legTop'), tail: 'foot' },
  ];
  const touched = new Uint8Array(nMesh), bins = triBins(V1, tris);
  // the neck tape settles on the narrowest neck section between the neck base and the jaw
  let neckY = LM.neck.y;
  {
    let best = Infinity;
    for (let y = geom.heights.neckBase - 0.4; y <= chinT - 0.25; y += 0.1) {
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
    if (st.tail === 'hand' && y < st.ylo) { const f = sstep(st.ylo - 3.0, st.ylo, y); kx = mix(1, kx, f); kz = mix(1, kz, f); }
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
        const e = evalStack(stacks[s], y, ebuf), cx = e[2], cz = e[3];
        let kx = e[0], kz = e[1];
        if (s >= 3) { const f = 1 - A.wFoot[i]; kx = 1 + (kx - 1) * f; kz = 1 + (kz - 1) * f; }
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
  // §21b: the trunk's share of the spread holds all the way up over the acromion and fades only across the
  // trapezius into the neck base (the neck itself is a station and is restored in 5d). It used to fade out
  // 1.6 in BELOW the neck base, i.e. right at the acromion, while the arms translated out in full — the shear
  // between them tore the top of the shoulder and smeared the sports-top strap into a wide dark wedge.
  const gSp = y => sstep(chY + 0.3 * (shY - chY), shY, y) * (1 - sstep(nbY - 0.5, nbY + 0.6, y));
  const xSh = { L: J2[B.uarm1L][0], R: J2[B.uarm1R][0] };
  const spreadPt = (i, x, y, sigma) => {
    const a = grp[i * 6 + 2] + grp[i * 6 + 3];
    const s = grp[i * 6 + 2] >= grp[i * 6 + 3] ? 'L' : 'R';
    return mix(x * (1 + sigma * gSp(y)), x + sigma * xSh[s], a);
  };
  const V3 = new Float32Array(V2);
  const Gsh = LM.shoulder.girth;
  // §21b: how far the girdle may be spread, and a bracketed (monotone) solve instead of a secant that could
  // wander, stop early or sit on a clamp. A MEASURED shoulders tape is honoured over a wide band; an ESTIMATED
  // one is only a model value, so the mesh's own station-fitted shoulders are trusted and the spread is kept
  // small — chasing a fabricated number used to squash very large bodies into collapsed, narrow shoulders.
  const shMeasured = !(geom.estimated || []).includes('shoulders');
  const SIG_LO = shMeasured ? -0.20 : -0.15, SIG_HI = shMeasured ? 0.32 : 0.22;
  // bisect sigma so the loop reads the target (monotone: wider girdle → longer hull), saturating at the band
  const solveSpread = (src, out, cross, list, target, lo, hi) => {
    const at = s => { for (const i of list) out[i * 3] = spreadPt(i, src[i * 3], src[i * 3 + 1], s); return hull2(crossPoints(out, cross)).per; };
    let a = lo, b = hi;
    const pa = at(a), pb = at(b);
    if (!(target > 0) || !(pa > 0) || !(pb > 0) || !(pb > pa)) { const s = clamp(0, lo, hi); return { sigma: s, per: at(s) }; }
    if (target <= pa) return { sigma: a, per: at(a) };
    if (target >= pb) return { sigma: b, per: at(b) };
    for (let k = 0; k < 18; k++) { const m = (a + b) / 2; if (at(m) < target) a = m; else b = m; }
    const s = (a + b) / 2;
    return { sigma: s, per: at(s) };
  };
  const sigma = solveSpread(V2, V3, shCross, shList, Gsh, SIG_LO, SIG_HI).sigma;
  for (let i = 0; i < nMesh; i++) V3[i * 3] = spreadPt(i, V2[i * 3], V2[i * 3 + 1], sigma);
  let J3 = J2.map((j, b) => {
    const g = bones[b].group;
    if (g === 2) return [j[0] + sigma * xSh.L, j[1], j[2]];
    if (g === 3) return [j[0] + sigma * xSh.R, j[1], j[2]];
    if (g === 0) return [j[0] * (1 + sigma * gSp(j[1])), j[1], j[2]];
    return j;
  });

  // 5b. head proportions: a head scale (x about the midline, z about the cranium centre) so breadth, bizygomatic
  // breadth and length hit headTargets(). Its weight is the (diffused) head-bone skin weight, not a height band: the
  // skull and jaw take it fully, the neck not at all, and the change happens across the jaw underside and the nape
  // where the surface is nearly horizontal, so no lump appears below the ears and no shelf under the chin.
  const applyHead = (V, J) => {
    const hd = headDims(A, V);
    const f = { fB: HT.breadth / hd.breadth, fZ: HT.bizygomatic / hd.bizygomatic, fL: HT.length / hd.length, before: hd };
    if (![f.fB, f.fZ, f.fL].every(v => v > 0.5 && v < 2)) return f;
    const yz = hd.eyeY, yg = hd.glabellaY, cz = hd.cz;
    const map = (x, y, z, w) => {
      const fx = mix(f.fZ, f.fB, sstep(yz, yg, y));
      return [x * mix(1, fx, w), y, cz + (z - cz) * mix(1, f.fL, w)];
    };
    for (let i = 0; i < nMesh; i++) {
      const w = A.wHead[i] * (1 - grp[i * 6 + 2] - grp[i * 6 + 3]); if (!(w > 1e-4)) continue;
      const p = map(V[i * 3], V[i * 3 + 1], V[i * 3 + 2], w); V[i * 3] = p[0]; V[i * 3 + 2] = p[2];
    }
    if (J) J[B.head] = map(J[B.head][0], J[B.head][1], J[B.head][2], 1);
    return f;
  };
  const head = applyHead(V3, J3);

  // 5c. smooth the deformation field: Taubin-smooth the displacement (fitted − source, both in the rest pose) so
  // region seams (head/neck, neck/traps, shoulder/arm, torso/hip, crotch, elbows, knees) cannot crease the surface;
  // the base mesh's own detail lives in the source and is untouched.
  const Dsp = new Float32Array(nMesh * 3);
  for (let i = 0; i < nMesh * 3; i++) Dsp[i] = V3[i] - Q[i];
  const rough0 = fieldRoughness(A, Dsp);
  taubinField(A, Dsp, 10, 0.6, -0.63, A.smoothFree);
  for (let i = 0; i < nMesh * 3; i++) V3[i] = Q[i] + Dsp[i];

  // 5d. constrained: a final smooth station correction (per-stack scale profiles, as in step 4) restores every
  // girth exactly after smoothing; the head scale is re-trimmed the same way.
  for (let pass = 0; pass < 1; pass++) {
    const bins3 = triBins(V3, tris);
    for (const st of stacks) {
      for (const s of st.stations) {
        s.cross = crossings(V3, tris, st.ok, s.y, bins3);
        const m = hull2(crossPoints(V3, s.cross));
        const f = m.per > 0 && m.n >= 6 ? s.G / m.per : 1;
        s.kx = f; s.kz = f; s.cx = st.name === 'trunk' ? 0 : (m.minx + m.maxx) / 2; s.cz = (m.minz + m.maxz) / 2;
        s.err = m.per > 0 ? m.per / s.G - 1 : 0;
      }
    }
    buildProfiles();
    const Vc = new Float32Array(V3); deform(Vc, V3);
  }
  for (const st of stacks) for (const s of st.stations) { const m = hull2(crossPoints(V3, s.cross)); s.err = m.per > 0 ? m.per / s.G - 1 : 0; }
  // 5e. the Taubin smoothing (5c) and the station correction (5d) each relax part of the girdle spread, which left
  // the shoulders tape 1–3 % short on every body (§21b). Re-slice the finished surface and spread the remainder,
  // inside the same band. The ramp is zero at the chest tape and has faded out by the neck base, so no other
  // station moves by more than a few hundredths of a percent.
  let sigma2 = 0, shCross2 = shCross;
  {
    const bins4 = triBins(V3, tris);
    shCross2 = crossings(V3, tris, (a, b, c) => part[a] < 4 && part[b] < 4 && part[c] < 4, shY, bins4);
    const list2 = [...new Set([...shCross2.a, ...shCross2.b])];
    const Vs = Float32Array.from(V3);
    sigma2 = solveSpread(Vs, V3, shCross2, list2, Gsh, Math.min(0, SIG_LO - sigma), Math.max(0, SIG_HI - sigma)).sigma;
    if (sigma2) {
      for (let i = 0; i < nMesh; i++) V3[i * 3] = spreadPt(i, Vs[i * 3], Vs[i * 3 + 1], sigma2);
      J3 = J3.map((j, b) => {
        const g = bones[b].group;
        if (g === 2) return [j[0] + sigma2 * xSh.L, j[1], j[2]];
        if (g === 3) return [j[0] + sigma2 * xSh.R, j[1], j[2]];
        if (g === 0) return [j[0] * (1 + sigma2 * gSp(j[1])), j[1], j[2]];
        return j;
      });
    } else for (let i = 0; i < nMesh; i++) V3[i * 3] = Vs[i * 3];
  }
  head.after = applyHead(V3, null);
  const rough1 = (() => { const d = new Float32Array(nMesh * 3); for (let i = 0; i < nMesh * 3; i++) d[i] = V3[i] - Q[i]; return fieldRoughness(A, d); })();

  // 6. back to the bind pose: bind skeleton with fitted lengths and bind orientations, then inverse skinning
  const heads1 = new Array(nb);
  for (let b = 0; b < nb; b++) {
    const p = bones[b].parent;
    if (p < 0) { heads1[b] = J3[b]; continue; }
    heads1[b] = vadd(heads1[p], qRot(qConj(relax.q[p]), vsub(J3[b], J3[p])));
  }
  const { M: M1 } = skinMatrices(A, heads1, relax);
  const rest = unskinPositions(A, V3, M1);
  // normals: recomputed on the fitted bind mesh (smooth, area-weighted, welded across duplicate seam vertices) and
  // skinned with the bones on the GPU. (Normals of the relaxed mesh carried back through the inverse blend matrices
  // were tried: exact for the relaxed pose but they sharpened the neck/trapezius junction; see test/mesh-smooth.)
  const restNrm = computeNormals(rest, tris, nMesh, null, A.weld);
  const flare = new Float32Array(nMesh * 3), RS = A.sculptRegions.length, li = A.sculptRegions.indexOf('lats');
  for (let i = 0; i < nMesh; i++) { const o = (i * RS + li) * 3; flare[i * 3] = A.sculpt[o] / 0.2; flare[i * 3 + 1] = A.sculpt[o + 1] / 0.2; flare[i * 3 + 2] = A.sculpt[o + 2] / 0.2; }
  const cavity = computeCavity(rest, restNrm, tris, nMesh);
  // baked AO on the FITTED, POSED body (V3 = the fit pose): contact darkening under the chin, in the armpits,
  // under the pecs / breasts, at the waistband and between the thighs. Skinned poses reuse it (bind-pose bake).
  const aoNrm = computeNormals(V3, tris, nMesh, null, A.weld);
  const ao = bakeAO(V3, aoNrm, tris, nMesh);

  // flexed-arm bulge amplitude so the flexed biceps section reaches the flexed tape (anthro flex.arm)
  const fit = {
    A, sex, cup: P.cup || 0, geom, bf, muscle: opts.muscle, muscleEff: muEff, rest, restNrm, cavity, ao, flare, heads: heads1, frames, relaxed: V3, relax,
    sections: {}, neckY, src: Q, joints: GJ,
    report: { head, stations: [], shoulders: { girth: hull2(crossPoints(V3, shCross2)).per, target: Gsh, sigma: sigma + sigma2, measured: shMeasured }, iters, worst, hs, anchors: ax.map((m, i) => [m, ay[i]]), smooth: { roughBefore: rough0, roughAfter: rough1 } },
  };
  for (const st of stacks) for (const s of st.stations) {
    if (s.fixed) continue;
    fit.report.stations.push({ stack: st.name, name: s.name, y: s.y, target: s.G, err: s.err, kx: s.kx, kz: s.kz, w0: s.w0, d0: s.d0, P0: s.P0, rx: s.rx, rz: s.rz, cx: s.cx, cz: s.cz });
    if (st.name === 'trunk') fit.sections[s.name] = { y: s.y, w: s.rx, d: s.rz, cx: s.cx, cz: s.cz };
  }
  fit.flexAmp = calibrateFlex(fit);
  if (A.bun) fit.bun = placeBun(A, rest);
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
// ---------------------------------------------------------------- studio lighting (theme-aware)
// One three-point rig plus a kicker, in linear radiance. The old rig had a saturated orange back light at 1.2 ×
// white, which outlined the whole figure in orange; the rim is now cool and quiet and the key carries the image.
const srgbToLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const vmix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
/** Studio rig for a backdrop of linear luminance `lum` (0 = near-black, 1 = white). */
export function studio(lum = 0.013) {
  const t = clamp(Math.pow(clamp(lum, 0, 1), 1 / 2.2), 0, 1);          // 0 dark theme … 1 light theme
  const I = [mix(3.15, 2.70, t), mix(0.55, 1.05, t), mix(0.95, 0.38, t), mix(0.42, 0.22, t)];
  const hue = [[1.0, 0.965, 0.925], [0.56, 0.65, 0.82], [0.78, 0.85, 1.0], [1.0, 0.95, 0.90]];
  const lights = new Float32Array(12);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) lights[i * 3 + k] = hue[i][k] * I[i];
  return {
    lights, t,
    sky: new Float32Array(vmix([0.062, 0.068, 0.084], [0.40, 0.42, 0.46], t)),
    gnd: new Float32Array(vmix([0.024, 0.023, 0.026], [0.26, 0.25, 0.235], t)),
    exposure: mix(1.26, 1.12, t),
    rim: mix(0.055, 0.012, t),
    glow: new Float32Array(vmix([0.018, 0.019, 0.025], [0.003, 0.003, 0.004], t)),
    floorMix: mix(1.05, 0.52, t),
    // default floor tone (readTheme() re-derives it from the stage's own background once the DOM is measurable)
    floor: new Float32Array(vmix([0.062, 0.068, 0.084], [0.40, 0.42, 0.46], t)),
  };
}
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
layout(location=8) in float aArmW;   // smooth arm share of the skin weights (§21c fabric edges)
layout(location=9) in float aAO;     // baked hemisphere AO (bakeAO(), fit pose)
uniform vec4 uEyeRef;        // eyeY, eyeX, eyeZ, chinY (canonical dm)
float hairLine(vec3 c, float ey, float ez, float chin){   // male hairline (canonical dm), shared by lift + mask
  float ax = abs(c.x);
  // a curved forehead line with a shallow widow's peak and temples that recede, instead of a straight bar
  float front = ey + 0.60 - 0.055 * exp(-ax * ax / 0.012) - 0.20 * smoothstep(0.16, 0.56, ax);
  float side = ey + 0.26, backL = chin + 0.46;
  float line = mix(front, side, smoothstep(0.42, 0.66, ax));
  return mix(line, backL, smoothstep(ez - 1.2, ez - 1.65, c.z));
}
float hairLift(vec3 c){   // hair-cap thickness: same hairline as the fragment mask, ramped over ~1 in (no ledge)
  return smoothstep(hairLine(c, uEyeRef.x, uEyeRef.z, uEyeRef.w) - 0.06, hairLine(c, uEyeRef.x, uEyeRef.z, uEyeRef.w) + 0.28, c.y);
}
uniform float uFem;          // 1 = female mesh (CONTRACT §21)
float hairLineF(vec3 c){     // female hairline: rounded forehead (no temple recession), temples to mid-ear, low nape
  float ax = abs(c.x), ey = uEyeRef.x, ez = uEyeRef.z;
  float front = ey + 0.6 - 0.05 * smoothstep(0.2, 0.6, ax);
  float side = ey - 0.08;
  float backL = uEyeRef.w + 0.3;
  float line = mix(front, side, smoothstep(0.42, 0.66, ax));
  return mix(line, backL, smoothstep(ez - 1.0, ez - 1.5, c.z));
}
out vec3 vW; out vec3 vN; out vec3 vC; out float vPart; out float vCav; out float vArm; out float vAO;
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
  // hair volume: the cap was a constant offset, which reads as a moulded plastic helmet. The thickness now grows
  // quadratically away from the hairline and is fuller over the occiput, so the silhouette gets a shaped mass.
  float occ = ss(uEyeRef.z - 0.25, uEyeRef.z - 1.35, aCanon.z);
  if (uFem > 0.5) {   // female hair cap (the bun is real geometry appended to the mesh, see hairBun())
    if (aPart > 0.5 && aPart < 1.5 && aCav > -0.5) {
      float line = hairLineF(aCanon), t = smoothstep(line - 0.02, line + 0.28, aCanon.y);
      p += aNrm * t * (0.085 + 0.085 * t) * (1.0 + 0.55 * occ);
    }
  } else if (aPart > 0.5 && aPart < 1.5) {
    float t = hairLift(aCanon);
    p += aNrm * t * (0.062 + 0.055 * t) * (1.0 + 0.6 * occ);
  }
  mat4 M = aWeight.x * uBones[j.x] + aWeight.y * uBones[j.y] + aWeight.z * uBones[j.z] + aWeight.w * uBones[j.w];
  vec4 w = M * vec4(p, 1.0);
  vW = w.xyz; vN = mat3(M) * aNrm; vC = aCanon; vPart = aPart; vCav = max(aCav, 0.0); vArm = aArmW; vAO = aAO;
  gl_Position = uVP * w;
}`;
const FRAG = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; in float vPart; in float vCav; in float vArm; in float vAO;
uniform vec3 uEye;
uniform vec3 uKey, uFill, uRim, uRim2;
uniform vec3 uLC[4];         // light radiance: key, fill, rim, kicker (theme-dependent, studio())
uniform vec3 uSky, uGnd;     // hemisphere irradiance (up / down), linear
uniform vec3 uTone;          // exposure, rim-fresnel strength, backdrop luminance (0 dark .. 1 light)
uniform vec2 uShadowPass;    // x: 1 = render the floor height map instead of shading, y: 1 / maxHeight
uniform float uDef;          // 1 main body, 0 ghost
uniform vec3 uDefMix;        // definitionLevels(): upper abs, full abs, delt/arm/chest separation (0..≈1.2)
uniform float uFat;          // 0..1 softness
uniform vec4 uCanon;         // navelY, nippleY, crotchY, nippleX  (canonical dm)
uniform vec4 uCanon2;        // shoulderY, kneeY, chinY, pubisY
uniform float uGhost;        // 0 main, 1 ghost
uniform vec3 uSkin;
uniform vec4 uEyeRef;        // eyeY, eyeX, eyeZ, chinY (canonical dm)
float hairLine(vec3 c, float ey, float ez, float chin){   // male hairline (canonical dm) — twin of the vertex one
  float ax = abs(c.x);
  float front = ey + 0.60 - 0.055 * exp(-ax * ax / 0.012) - 0.20 * smoothstep(0.16, 0.56, ax);
  float side = ey + 0.26, backL = chin + 0.46;
  float line = mix(front, side, smoothstep(0.42, 0.66, ax));
  return mix(line, backL, smoothstep(ez - 1.2, ez - 1.65, c.z));
}
float hairMask(vec3 c){
  float line = hairLine(c, uEyeRef.x, uEyeRef.z, uEyeRef.w);
  return smoothstep(line - 0.075, line + 0.075, c.y);
}
uniform float uFem;          // 1 = female mesh
uniform vec4 uBra;           // female sports top: inframammary-fold y, bust-point y, bust-point x, suprasternal-notch y (canonical dm)
uniform vec3 uStrapP[20];    // sports-top strap centre-line on the canonical surface, left half (x >= 0), dm
uniform float uStrapR;       // strap half-width, canonical dm
uniform int uStrapN;         // points in use
float hairMaskF(vec3 c){
  float ax = abs(c.x), ey = uEyeRef.x, ez = uEyeRef.z;
  float front = ey + 0.6 - 0.05 * smoothstep(0.2, 0.6, ax);
  float side = ey - 0.08;
  float backL = uEyeRef.w + 0.3;
  float line = mix(front, side, smoothstep(0.42, 0.66, ax));
  line = mix(line, backL, smoothstep(ez - 1.0, ez - 1.5, c.z));
  // ears stay skin (the hair is swept back behind them)
  float ear = smoothstep(0.66, 0.74, ax) * smoothstep(ez - 1.15, ez - 1.05, c.z) * (1.0 - smoothstep(ez - 0.62, ez - 0.52, c.z))
            * smoothstep(ey - 0.7, ey - 0.6, c.y) * (1.0 - smoothstep(ey + 0.12, ey + 0.2, c.y));
  return smoothstep(line - 0.065, line + 0.065, c.y) * (1.0 - ear);
}
// CONTRACT §21c — every fabric edge is a signed field rendered with one pixel of analytic antialiasing: the soft
// width comes from the field's own screen-space gradient, so a diagonal edge (the armpit, the shorts hem) is as
// clean as a horizontal one. A hard step, or a step softened by fwidth of some other quantity, stair-stepped.
float edge(float f){ return smoothstep(-1.0, 1.0, f / max(fwidth(f), 1e-6)); }
// Distance (canonical dm) to the sports-top strap centre-line, a polyline that lies on the canonical surface.
float strapDist(vec3 q){
  float d = 1e9;
  for (int i = 0; i < 19; i++) {
    if (i + 1 >= uStrapN) break;
    vec3 a = uStrapP[i], ab = uStrapP[i + 1] - a, r = q - a;
    d = min(d, length(r - ab * clamp(dot(r, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0)));
  }
  return d;
}
// Sports top as a material region in canonical space (no geometry): a band under the bust, a scoop neckline rising
// to the cup tops, side panels up to the armpits, a low back with a racer-back converging to the spine, and straps
// over the shoulders (a constant-width tube around uStrapP, not a slab in canonical x). Returns 0..1.
float braMask(vec3 c, float armw){
  float ax = abs(c.x), y = c.y, imf = uBra.x, nip = uBra.y, nx = uBra.z, notch = uBra.w;
  float bottom = imf - 0.22;   // §21c: the hem sits ≈ 0.9 in below the fold (it was 1.2 in, which rode onto the belly)
  float fb = smoothstep(-0.1, 0.55, c.z);                                       // 1 front … 0 back
  // the cup line rises from the sternum and levels off just INSIDE the strap, so the strap rises out of a flat
  // cup line instead of crossing a still-climbing edge (which left a notch exactly where a seam should be smooth)
  float scoop = nip + 0.40 + 0.40 * smoothstep(0.05, nx * 0.78, ax);
  float topF = mix(scoop, nip + 0.40, smoothstep(nx * 1.05, nx * 1.4, ax));
  float topB = nip + 0.12 + 0.28 * smoothstep(nx * 1.2, nx * 1.5, ax);
  float top = mix(topB, topF, fb);
  // signed fields in canonical dm (positive inside), joined with a POLYNOMIAL SMOOTH MAX so the seam where the
  // straps meet the cup tops is a rounded join like a sewn garment; a hard max() left a visible notch there.
  float fPanel = min(y - bottom, top - y);
  float fStrap = uStrapR - strapDist(vec3(ax, y, c.z));
  float k = 0.13;
  float h = clamp(0.5 + 0.5 * (fStrap - fPanel) / k, 0.0, 1.0);
  float f = mix(fPanel, fStrap, h) + k * h * (1.0 - h);
  // the whole top stops at the deltoid: an iso-contour of the arm skin weight, which is smooth across the armpit
  return edge(f) * edge(0.26 - armw);
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
  float absBand = ss(pub + 0.02, pub + 0.5, y) * (1.0 - ss(nip - 1.0, nip - 0.42, y));
  // the rectus fades out laterally instead of being cut off: a hard edge here made the abs read as a panel
  // glued onto the belly, especially on the narrower female torso
  float inRect = 1.0 - ss(0.34, 0.74, x);
  float sideFade = 1.0 - ss(0.52, 1.00, x);
  float i1 = nav + 0.1 + 0.03 * x, i2 = nav + 0.58 + 0.05 * x, i3 = nav + 1.05 + 0.1 * x;
  float ints = groove(y - i1, 0.05) + groove(y - i2, 0.05) + 0.8 * groove(y - i3, 0.055);
  float lin = groove(x, 0.05);
  float lat = groove(x - (0.63 - 0.05 * (y - nav)), 0.105);
  // block dome: bulge in the middle of each block (cosine across x and between intersections)
  float bx = 0.5 - 0.5 * cos(clamp(x / 0.6, 0.0, 1.0) * 6.2832);
  float by = 0.5 + 0.5 * cos(clamp((y - nav + 0.14) / 0.48, -0.6, 2.4) * 6.2832);
  float up = uDefMix.x, full = uDefMix.y, sep = uDefMix.z;
  ints = groove(y - i1, 0.05) * full + groove(y - i2, 0.05) * mix(up, full, 0.5) + 0.8 * groove(y - i3, 0.055) * up;
  // the dome was strong enough that the blocks read as tiles stamped onto the belly; the grooves carry it now
  h += (bx * by * 0.19 * full * sideFade - lin * 1.08 * up - ints * 0.95 * inRect - lat * 0.42 * up) * absBand * front;
  // inguinal "V" lines
  float vy = mix(pub + 0.05, nav - 0.35, ss(0.25, 1.05, x));
  h -= groove(y - vy, 0.07) * ss(0.2, 0.35, x) * (1.0 - ss(1.0, 1.15, x)) * 0.8 * front * full;
  // lower pec border (male only: on the female body it would sit on the breast)
  if (uFem < 0.5) {
    float pecY = nip - 0.42 + 0.22 * (x - uCanon.w) * (x - uCanon.w);
    h -= groove(y - pecY, 0.08) * ss(0.15, 0.3, x) * (1.0 - ss(1.25, 1.45, x)) * 0.6 * front * sep;
  }
  // serratus digitations on the lateral ribcage
  float sy = (y - (nip - 0.95)) + (x - 1.05) * 0.7;
  float ser = 0.5 + 0.5 * cos(sy * 15.0);
  h -= ser * ss(0.95, 1.12, x) * (1.0 - ss(1.4, 1.55, x)) * ss(nip - 1.15, nip - 0.85, y) * (1.0 - ss(nip - 0.25, nip, y)) * ss(-0.1, 0.4, c.z) * 0.45 * full;
  // back: spinal erector groove (lower back) and a soft lat/scapula edge
  float back = ss(0.0, -0.45, c.z);
  h -= groove(x, 0.07) * ss(pub, nav + 0.3, y) * (1.0 - ss(nip, nip + 0.6, y)) * back * 0.8 * up;
  return h;
}
// ---------------------------------------------------------------- BRDF (energy-conserving, Filament conventions)
const float PI = 3.14159265;
float D_GGX(float NoH, float a){ float a2 = a*a; float d = (NoH*a2 - NoH)*NoH + 1.0; return a2/(PI*d*d + 1e-7); }
float V_GGX(float NoV, float NoL, float a){     // height-correlated Smith visibility (includes the 1/(4 NoL NoV))
  float a2 = a*a;
  float gv = NoL*sqrt(NoV*NoV*(1.0-a2)+a2), gl = NoV*sqrt(NoL*NoL*(1.0-a2)+a2);
  return 0.5/max(gv+gl, 1e-5);
}
vec3 F_S(vec3 f0, float u){ return f0 + (1.0-f0)*pow(clamp(1.0-u, 0.0, 1.0), 5.0); }
// Karis' analytic split-sum approximation: enough for a single hemisphere "environment"
vec2 envBRDF(float r, float NoV){
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022), c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 q = r*c0 + c1;
  float a = min(q.x*q.x, exp2(-9.28*NoV))*q.x + q.y;
  return vec2(-1.04, 1.04)*a + q.zw;
}
// Subsurface approximation: per-channel wrapped diffuse, energy-normalised. Red wraps furthest past the terminator,
// which is the whole visual signature of skin; a pre-integrated LUT buys very little more on a body this size.
vec3 wrapDiff(float nl, vec3 w){ return max((vec3(nl) + w)/((1.0+w)*(1.0+w)), vec3(0.0)); }
// Ashikhmin/Estevez-style cloth sheen: a broad retro-reflective lobe at grazing angles (what says "fabric").
float sheenD(float NoH, float r){ float a = 1.0/max(r, 0.07); float c = NoH*NoH; return (2.0 + a)*pow(max(1.0-c, 0.0), a*0.5)/(2.0*PI); }
// Kajiya-Kay anisotropic strand highlight about a shifted tangent
float strandSpec(vec3 T, vec3 N, vec3 H, float shift, float e){
  vec3 Ts = normalize(T + N*shift);
  float d = dot(Ts, H);
  return pow(sqrt(max(1.0 - d*d, 0.0)), e);
}
// Bump mapping on an unparameterised surface (Mikkelsen): the height gradient comes from the fragment's own
// screen-space derivatives, so no tangent frame or UV set is needed — the base mesh has neither.
vec3 bumpN(vec3 N, vec3 p, float h){
  vec3 dpx = dFdx(p), dpy = dFdy(p);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * N - g);
}
float hash31(vec3 p){ p = fract(p*0.3183099 + vec3(0.11, 0.37, 0.71)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }
void main(){
  // floor height pass: write the surface's height above the floor; the pass MIN-blends, so each texel ends up
  // holding the LOWEST surface over that column, which is what a contact shadow needs.
  if (uShadowPass.x > 0.5) {
    float hh = max(vW.y, 0.0);
    // .r = height / maxHeight, .g = 1 − occlusion. Both are MIN-blended, so each texel ends up describing the
    // LOWEST surface over its column. Storing occlusion (not just height) is what makes mip filtering correct:
    // the penumbra is a mip lookup, and averaging heights through a nonlinear falloff loses most of the shadow.
    float oc = exp(-hh * 0.95) * 0.86 + exp(-hh * 0.034) * 0.55;
    frag = vec4(clamp(hh * uShadowPass.y, 0.0, 1.0), 1.0 - oc, 0.0, 1.0);
    return;
  }
  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vW);
  if (uGhost > 0.5) {
    float fr = pow(1.0 - max(dot(N, V), 0.0), 2.2);
    float a = 0.04 + 0.8 * fr;
    frag = vec4(vec3(0.5, 0.82, 1.0) * (0.3 + fr), a);
    return;
  }
  bool torso = vPart < 0.5;
  bool head = vPart > 0.5 && vPart < 1.5;
  // shorts (canonical space): from just below the navel to mid-thigh. Both edges are diagonal (they follow |x|),
  // so each is antialiased by its own gradient (§21c); the arm edge keeps the hands bare without a jagged seam.
  float waistband = uCanon.x - 0.55 - 0.12 * smoothstep(0.0, 1.2, abs(vC.x));
  float hem = uCanon.z - 1.25 + 0.25 * ss(0.4, 1.4, abs(vC.x));
  float shorts = edge(vC.y - hem) * edge(waistband - vC.y) * edge(0.20 - vArm) * edge(0.52 - vPart);
  float band = shorts * edge(vC.y - (waistband - 0.15));
  // female: sports top (torso, plus the neck part only where the straps cross the trapezius). The whole mask is
  // evaluated under the uniform uFem branch so every fwidth() inside it sits in uniform control flow.
  float cloth = shorts, bra = 0.0, braBand = 0.0;
  if (uFem > 0.5) {
    bra = braMask(vC, vArm) * edge(uBra.w + 0.6 - vC.y);
    braBand = bra * edge((uBra.x - 0.15) - vC.y);
    cloth = max(shorts, bra);
  }
  // definition: perturb the normal with the gradient of the field (torso front only)
  if (uDef > 0.01 && max(uDefMix.x, max(uDefMix.y, uDefMix.z)) > 0.005 && torso && cloth < 0.5) {
    float e = 0.02;
    float h0 = defField(vC);
    vec3 g = vec3(defField(vC + vec3(e,0,0)) - h0, defField(vC + vec3(0,e,0)) - h0, 0.0) / e;
    float k = uDef * 0.050;
    N = normalize(N - k * (g - dot(g, N) * N));
  }

  // ---------------------------------------------------------------- material
  vec3 base = uSkin;
  float rough = 0.46, f0s = 0.028, sheen = 0.0, aniso = 0.0, occK = 1.0;
  vec3 T = vec3(0.0, 1.0, 0.0);
  // skin region variation (CONTRACT: shading only). Face a shade warmer and glossier than the trunk; hands, feet
  // and knees redder and rougher; the back flatter. Uniform albedo is most of why a body reads as a mannequin.
  float ax = abs(vC.x);
  // canonical dm: wrist ≈ 2.5, fingertip ≈ 1.2, ankle ≈ −6.9, sole ≈ −8.2 (the base mesh is fixed, so these are
  // absolute, exactly like the hairline / waistband constants above)
  float handFoot = clamp(ss(2.55, 1.55, vC.y) * step(1.5, vPart) * step(vPart, 2.5) + ss(-6.85, -7.8, vC.y), 0.0, 1.0);
  base *= mix(vec3(1.0), vec3(1.10, 0.925, 0.885), handFoot * 0.8);
  if (head) base *= vec3(1.045, 0.985, 0.97);
  rough = mix(rough, 0.41, float(head));
  rough = mix(rough, 0.63, handFoot);
  // surface micro-relief. Perfectly smooth skin is the single clearest "mannequin" tell; this is a two-octave
  // bump at ~0.3 in and ~0.12 in, plus a matching roughness break-up. Luminance-preserving chroma variation
  // replaces the uniform albedo (luminance noise is exactly what read as dirty smudges before).
  // each octave fades out once a pixel covers more than about half its feature, otherwise the relief turns to
  // specular glitter wherever the surface runs away from the camera (the flanks, the outside of a thigh)
  float fw = max(fwidth(vC.x), max(fwidth(vC.y), fwidth(vC.z)));
  float o1 = 1.0 - smoothstep(0.018, 0.048, fw), o2 = 1.0 - smoothstep(0.007, 0.019, fw);
  float grain = 0.5 + (vnoise(vC * 15.0) - 0.5) * 0.58 * o1 + (vnoise(vC * 38.0) - 0.5) * 0.42 * o2;
  rough += (grain - 0.5) * 0.10;
  float zone = vnoise(vC * 2.4);
  base *= mix(vec3(0.978, 1.002, 1.022), vec3(1.028, 0.997, 0.966), zone);
  float skinBump = 1.0;

  // ---- clothing (CONTRACT §21c). Fabric: much rougher than skin, a sheen lobe, and a fine weave in the roughness.
  float fab = max(shorts, bra);
  if (fab > 0.001) {
    float wf = 1.0 - smoothstep(0.0022, 0.0075, max(fwidth(vC.y), fwidth(vC.x)));   // fade before it aliases
    float weave = (sin(vC.y * 150.0) * sin((vC.x + vC.z) * 132.0)) * 0.5 + 0.5;
    vec3 fabC = vec3(0.0265, 0.0275, 0.0335) * (0.88 + 0.24 * weave * wf);
    vec3 bandC = vec3(0.098, 0.034, 0.017);                        // muted ember elastic (was a saturated flat fill)
    vec3 cC = mix(fabC, bandC, max(band, braBand));
    float cR = 0.76 + 0.10 * (1.0 - weave) * wf;
    base = mix(base, cC, fab); rough = mix(rough, cR, fab);
    f0s = mix(f0s, 0.042, fab); sheen = fab; occK = mix(occK, 0.75, fab);
  }

  // ---- eyes: a shaded eyeball (sclera / iris / limbal ring / pupil) with a corneal highlight. They were a flat
  // dark patch of skin tone, which is why they read as painted-on decals.
  float eyeM = step(2.5, vPart);
  if (eyeM > 0.5) {
    vec3 ec = vec3(sign(vC.x + 1e-6) * uEyeRef.y, uEyeRef.x, uEyeRef.z);
    vec3 d = normalize(vC - ec);
    vec3 fwd = normalize(vec3(sign(vC.x + 1e-6) * 0.12, -0.03, 1.0));
    float ang = acos(clamp(dot(d, fwd), -1.0, 1.0));
    float iris = 1.0 - smoothstep(0.455, 0.515, ang);
    float pupil = 1.0 - smoothstep(0.145, 0.185, ang);
    float limbal = smoothstep(0.33, 0.50, ang) * iris;
    float fibre = 0.78 + 0.44 * vnoise(d * 34.0);
    vec3 sclera = vec3(0.50, 0.465, 0.45) * (1.0 - 0.28 * smoothstep(0.55, 1.1, ang));
    vec3 irisC = vec3(0.085, 0.048, 0.024) * fibre * (0.55 + 0.9 * smoothstep(0.50, 0.17, ang));
    base = mix(sclera, irisC, iris);
    base = mix(base, vec3(0.008), pupil);
    base *= 1.0 - 0.6 * limbal;
    rough = mix(0.21, 0.055, max(iris, pupil));      // wet sclera, hard cornea
    f0s = 0.045; sheen = 0.0; occK = 0.55;
  }

  // ---- hair: a shaped, Kajiya-Kay shaded mass with strand breakup, not a flat dark cap.
  float hm = 0.0, brow = 0.0;
  if (head) {   // the appended female bun is part 1 with a canonical coord above the hairline, so it is hair too
    hm = uFem > 0.5 ? hairMaskF(vC) : hairMask(vC);
    // brows: a soft arch with a Gaussian cross-section that thins toward the tail. A pair of smoothstep bands
    // gave a flat rectangle with crisp corners, which was the single most "painted on" thing about the face.
    float u = clamp((ax - 0.12) / 0.40, 0.0, 1.0);
    float arch = 1.0 - (2.0 * u - 1.0) * (2.0 * u - 1.0);
    float yb = uEyeRef.x + (uFem > 0.5 ? 0.185 : 0.165) + (uFem > 0.5 ? 0.055 : 0.038) * arch;
    float th = (uFem > 0.5 ? 0.036 : 0.050) * (1.0 - 0.5 * u * u);
    float dy = (vC.y + 0.03 * ax - yb) / th;
    brow = exp(-dy * dy) * smoothstep(0.10, 0.19, ax) * (1.0 - smoothstep(0.44, 0.60, ax))
         * smoothstep(uEyeRef.z - 0.22, uEyeRef.z + 0.02, vC.z) * (uFem > 0.5 ? 0.80 : 1.0);
    // brows are hair, so they get a fine strand break-up and feathered ends, not a solid painted block
    brow *= 0.68 + 0.50 * vnoise(vec3(vC.x * 170.0, vC.y * 72.0, vC.z * 30.0));
    brow = clamp(brow, 0.0, 1.0) * 0.92;
    // a wispy, slightly ragged hairline: a razor-straight contour is most of why the cap read as a swim cap
    hm = clamp(hm + (vnoise(vec3(vC.x * 72.0, vC.y * 40.0, vC.z * 72.0)) - 0.5) * 2.4 * hm * (1.0 - hm)
                  + (vnoise(vec3(vC.x * 24.0, vC.y * 15.0, vC.z * 24.0)) - 0.5) * 1.1 * hm * (1.0 - hm), 0.0, 1.0);
    float h = max(hm, brow);
    if (h > 0.002) {
      float strand = vnoise(vec3(vC.x * 105.0, vC.y * 17.0, vC.z * 95.0)) * 0.72 + vnoise(vC * 125.0) * 0.28;
      vec3 hairC = vec3(0.0315, 0.0196, 0.0124) * (0.72 + 0.56 * strand);
      base = mix(base, hairC, h);
      rough = mix(rough, mix(0.46, 0.34, hm), h); f0s = mix(f0s, 0.046, h);
      aniso = hm * (1.0 - clamp(brow, 0.0, 1.0));   // the strand lobe belongs to the cap; brows stay matte
      // flow: down and back over the skull; brows run outward along x
      vec3 flow = mix(normalize(vec3(0.0, -1.0, -0.5)), normalize(vec3(sign(vC.x + 1e-6), 0.12, 0.25)), clamp(brow * (1.0 - hm), 0.0, 1.0));
      vec3 tb = cross(flow, N);
      T = normalize(cross(N, tb) + vec3(1e-5));
      occK = mix(occK, 1.12, h);
    }
  }
  rough = clamp(rough, 0.045, 1.0);
  float skinM0 = (1.0 - fab) * (1.0 - eyeM) * (1.0 - clamp(hm + brow, 0.0, 1.0));
  if (skinM0 > 0.01) N = normalize(mix(N, bumpN(N, vW, grain * 0.019), skinM0));
  // specular antialiasing: widen the lobe where the shaded normal varies fast across a pixel
  rough = clamp(rough + 1.5 * max(length(dFdx(N)), length(dFdy(N))), rough, 1.0);
  float a = rough * rough;
  vec3 f0 = vec3(f0s);
  float skinM = skinM0;

  // ---------------------------------------------------------------- occlusion
  // baked hemisphere AO carries the contact darkening (chin, armpits, under the pecs, waistband, inner thighs);
  // the curvature "cavity" term is kept only as a shallow crease modulation — at its old weight its sampling noise
  // was the grey mottling on the chest.
  float crease = 1.0 - 0.26 * vCav * (head ? 1.0 : 0.72 + 0.4 * uDefMix.z);
  float ao = clamp(pow(clamp(vAO, 0.0, 1.0), 1.15) * occK, 0.0, 1.0) * crease;
  float NoV = clamp(dot(N, V), 1e-4, 1.0);
  float specOcc = clamp(pow(NoV + ao, exp2(-16.0*rough - 1.0)) - 1.0 + ao, 0.0, 1.0);

  // ---------------------------------------------------------------- direct lighting
  vec3 Ldir[4]; Ldir[0] = uKey; Ldir[1] = uFill; Ldir[2] = uRim; Ldir[3] = uRim2;
  vec3 scatter = mix(vec3(0.015), vec3(0.34, 0.165, 0.098), skinM);
  float fres = pow(1.0 - NoV, 3.0);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 l = normalize(Ldir[i]);
    float nl = dot(N, l);
    vec3 H = normalize(l + V);
    float NoH = clamp(dot(N, H), 0.0, 1.0), LoH = clamp(dot(l, H), 0.0, 1.0);
    float NoL = max(nl, 0.0);
    // diffuse: wrapped (subsurface) for the key/fill, hard for the back lights so they stay on the silhouette
    vec3 diff = i < 2 ? wrapDiff(nl, scatter) : vec3(NoL * (0.2 + 0.8 * fres));
    vec3 S = F_S(f0, LoH) * (D_GGX(NoH, a) * V_GGX(NoV, NoL, a)) * NoL;
    if (aniso > 0.002) {   // two shifted strand lobes: a tight white primary and a broad tinted secondary
      float p1 = strandSpec(T, N, H, 0.09, 120.0), p2 = strandSpec(T, N, H, -0.13, 11.0);
      vec3 hs = vec3(0.017) * p1 + base * 0.55 * p2 * (0.35 + 0.9 * vnoise(vec3(vC.x*150.0, vC.y*22.0, vC.z*120.0)));
      S = mix(S, hs * NoL, aniso);
    }
    if (sheen > 0.002) S += vec3(sheenD(NoH, 0.42)) * 0.085 * NoL * sheen * (0.35 + 0.65 * fres);
    col += uLC[i] * (base * diff * (1.0/PI) * mix(1.0, ao, 0.3) + S * mix(1.0, specOcc, 0.5));
  }
  // ---------------------------------------------------------------- image-based-ish ambient (hemisphere)
  vec3 amb = mix(uGnd, uSky, N.y * 0.5 + 0.5);
  col += base * amb * ao;
  // multiple scattering in creases: occluded skin reddens instead of going grey (chin, armpits, inner thighs)
  col += base * base * vec3(0.52, 0.12, 0.05) * (1.0 - ao) * skinM;
  vec3 R = reflect(-V, N);
  vec2 eb = envBRDF(rough, NoV);
  col += mix(uGnd, uSky, R.y * 0.5 + 0.5) * (f0 * eb.x + eb.y) * specOcc;
  // a faint neutral edge light so the silhouette separates from the backdrop; the old one was a saturated orange
  col += mix(vec3(0.62, 0.68, 0.80), vec3(0.95), uTone.z) * fres * uTone.y * mix(0.45, 1.0, skinM) * ao;
  // asperity scattering ("peach fuzz"): a warm, very low grazing-angle haze that keeps skin off a clean dielectric edge
  col += vec3(0.055, 0.040, 0.034) * pow(1.0 - NoV, 4.5) * skinM * ao;

  col = aces(col * uTone.x);
  col = pow(col, vec3(1.0 / 2.2));
  // 8-bit dither: a smooth body against a dark backdrop bands badly without it
  col += (hash31(vec3(gl_FragCoord.xy, 0.5)) - 0.5) / 255.0;
  frag = vec4(col, 1.0);
}`;
const BG_VERT = `#version 300 es
layout(location=0) in vec2 aXY; out vec2 vUV;
void main(){ vUV = aXY * 0.5 + 0.5; gl_Position = vec4(aXY, 0.999, 1.0); }`;
// Backdrop + studio floor. The figure used to hang in a void with a fake elliptical smudge behind it. Now the
// full-screen pass ray-casts the floor plane (y = 0) and shades it, and the shadow comes from a top-down height
// map of the body (MIN-blended), so it has the body's real outline, hardens at the feet and softens upward.
const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 frag;
uniform vec2 uRes;
uniform vec3 uBg, uGlow, uFloor;
uniform mat4 uInvVP;
uniform vec3 uEye;
uniform vec4 uGround;        // map half-extent (in), maxHeight (in), floor visibility, light-pool radius (× R)
uniform sampler2D uSh;
const vec2 DISC[12] = vec2[12](
  vec2(0.0, 0.0), vec2(0.52, 0.10), vec2(0.18, 0.52), vec2(-0.38, 0.40), vec2(-0.54, -0.12), vec2(-0.20, -0.52),
  vec2(0.40, -0.40), vec2(0.90, -0.22), vec2(0.30, 0.92), vec2(-0.82, 0.48), vec2(-0.48, -0.86), vec2(0.86, 0.46));
// Sampling a wide penumbra with 12 taps of the full-res map printed twelve ghost copies of the footprint, so a
// wide search reads a mip level instead: the mip chain is the blur, and the taps only have to cover its shape.
const float LOD[3] = float[3](0.0, 1.6, 4.2);
const float RAD[3] = float[3](0.0040, 0.0140, 0.075);
const float WT[3] = float[3](1.0, 1.0, 0.92);
vec2 shAt(vec2 uv, float lod){ vec2 t = textureLod(uSh, clamp(uv, 0.003, 0.997), lod).rg; return vec2(t.x * uGround.y, 1.0 - t.y); }
void main(){
  vec2 p = vUV - vec2(0.5, 0.46);
  p.x *= uRes.x / uRes.y;
  vec3 col = uBg + uGlow * exp(-dot(p, p) * 2.6);
  if (uGround.z > 0.001 && uEye.y > 0.0) {
    vec4 fw = uInvVP * vec4(vUV * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize(fw.xyz / fw.w - uEye);
    if (dir.y < -1e-4) {
      vec3 P = uEye + dir * (-uEye.y / dir.y);
      float R = uGround.x, vis = uGround.z;
      float r = length(P.xz) / R;
      if (r < 1.25) {
        vec2 suv = vec2(0.5 + P.x / (2.0 * R), 0.5 - P.z / (2.0 * R));
        // Three scales taken straight off the mip chain, combined with max(): a tight dark core where a surface
        // is right on the floor, a mid penumbra, and a broad ambient shadow under the whole body. A single
        // variable-radius lookup cannot do this — away from the feet the blocker is far, the search radius goes
        // wide, and the contact shadow washes out to nothing.
        float sh = 0.0;
        for (int k = 0; k < 3; k++) {
          float lod = LOD[k], rd = RAD[k], a = 0.0;
          for (int i = 0; i < 4; i++) a += shAt(suv + DISC[i + 1] * rd, lod).y;
          sh = max(sh, a * 0.25 * WT[k]);
        }
        sh = clamp(sh, 0.0, 1.0) * vis;
        // the floor is BLENDED in, not added: on a light theme the floor tone is darker than the backdrop, and an
        // additive pool blew straight to white there. A Gaussian pool has no disc edge to catch the eye.
        float pool = exp(-r * r / (uGround.w * uGround.w)) * vis;
        col = mix(col, uFloor, pool) * (1.0 - 0.95 * sh);
      }
    }
  }
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  frag = vec4(col, 1.0);
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
function invert4(m) {
  const a00=m[0],a01=m[1],a02=m[2],a03=m[3],a10=m[4],a11=m[5],a12=m[6],a13=m[7];
  const a20=m[8],a21=m[9],a22=m[10],a23=m[11],a30=m[12],a31=m[13],a32=m[14],a33=m[15];
  const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10, b03=a01*a12-a02*a11;
  const b04=a01*a13-a03*a11, b05=a02*a13-a03*a12, b06=a20*a31-a21*a30, b07=a20*a32-a22*a30;
  const b08=a20*a33-a23*a30, b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
  let det = b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
  if (!det) return null; det = 1/det;
  return [(a11*b11-a12*b10+a13*b09)*det, (a02*b10-a01*b11-a03*b09)*det, (a31*b05-a32*b04+a33*b03)*det, (a22*b04-a21*b05-a23*b03)*det,
          (a12*b08-a10*b11-a13*b07)*det, (a00*b11-a02*b08+a03*b07)*det, (a32*b02-a30*b05-a33*b01)*det, (a20*b05-a22*b02+a23*b01)*det,
          (a10*b10-a11*b08+a13*b06)*det, (a01*b08-a00*b10-a03*b06)*det, (a30*b04-a31*b02+a33*b00)*det, (a21*b02-a20*b04-a23*b00)*det,
          (a11*b07-a10*b09-a12*b06)*det, (a00*b09-a01*b07+a02*b06)*det, (a31*b01-a30*b03-a32*b00)*det, (a20*b03-a21*b01+a22*b00)*det];
}
/** Top-down orthographic clip matrix over a 2R × 2R floor patch, y mapped into [-1, 1] over [y0, y1]. */
function orthoTop(R, y0, y1) {
  const sy = 2 / (y1 - y0);
  return [1 / R, 0, 0, 0,  0, 0, sy, 0,  0, -1 / R, 0, 0,  0, 0, -(1 + 2 * y0 * sy / 2), 1];
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
  let shTex = null, shFB = null;
  const SH_RES = 256;
  let poseName = POSES.includes(o.pose) ? o.pose : 'relaxed';
  let poseFrom = null, poseTo = null, poseT0 = 0;
  const cam = { yaw: POSE_SPECS[poseName].view.yaw, pitch: POSE_SPECS[poseName].view.pitch, zoom: 1, vy: 0, vp: 0 };
  let camAnim = null, raf = 0, lastMs = 0, frameMs = 0, userTouched = false;
  let W = 1, Hh = 1, dpr = 1, VP = null, eye = [0, 0, 0];
  // theme: the rig and the backdrop follow the stage's own background colour, so the viewer sits correctly in a
  // light theme as well as the dark one (the app is dark today; nothing here assumes it).
  let ST = studio(0.013), bgLin = [0.043, 0.043, 0.051];
  function readTheme() {
    let rgb = null;
    try {
      const m = (typeof getComputedStyle === 'function' ? getComputedStyle(stage).backgroundColor : '') || '';
      const g = m.match(/rgba?\(([^)]+)\)/);
      if (g) { const q = g[1].split(',').map(parseFloat); if (q.length >= 3 && !(q[3] <= 0.05)) rgb = [srgbToLin(q[0]), srgbToLin(q[1]), srgbToLin(q[2])]; }
    } catch (e) { /* jsdom / detached node */ }
    if (rgb) bgLin = rgb;
    ST = studio(0.2126 * bgLin[0] + 0.7152 * bgLin[1] + 0.0722 * bgLin[2]);
    ST.floor = new Float32Array([0, 1, 2].map(i => bgLin[i] + (ST.sky[i] - bgLin[i]) * ST.floorMix));
  }

  function setLabel() { labelEl.textContent = o.label || ''; labelEl.style.display = o.label ? '' : 'none'; }
  setLabel();
  function syncChips() { chips.forEach(c => { const on = c.dataset.pose === poseName; c.classList.toggle('on', on); c.setAttribute('aria-selected', String(on)); }); }
  syncChips();

  const keyOf = (s, bf, m) => JSON.stringify([s || null, bf ?? null, m || null]);
  let fitKey = '', ghostKey = '';
  // small LRU of fitted bodies, so blinking between "now" and "projected" via update() never refits
  const fitCache = new Map(), FIT_CACHE = 4;
  function cachedFit(k, args) {
    let f = fitCache.get(k);
    if (f) fitCache.delete(k); else f = fitBody(A, args);
    fitCache.set(k, f);
    while (fitCache.size > FIT_CACHE) fitCache.delete(fitCache.keys().next().value);
    return f;
  }
  function refit() {
    if (!A) return;
    const k = keyOf(o.shape, o.bodyFatPct, o.muscle);
    if (k !== fitKey) {
      fit = cachedFit(k, { shape: o.shape, bodyFatPct: o.bodyFatPct, muscle: o.muscle }); fitKey = k;
      if (gl && !lost) uploadFit(fit, 'main');
      poseTo = null; poseFrom = null;
    }
    const cs = o.compareShape;
    const gk = cs ? keyOf(cs, num(cs.bodyFatPct) ?? o.compareBodyFatPct ?? o.bodyFatPct, cs.muscle || o.compareMuscle || o.muscle) : '';
    if (gk !== ghostKey) {
      ghostKey = gk;
      ghostFit = cs ? cachedFit(gk, { shape: cs, bodyFatPct: num(cs.bodyFatPct) ?? o.compareBodyFatPct ?? o.bodyFatPct, muscle: cs.muscle || o.compareMuscle || o.muscle }) : null;
      if (ghostFit && gl && !lost) uploadFit(ghostFit, 'ghost');
    }
  }
  function ctxOf(f) { return { A, rest: f.heads, frames: f.frames, geom: f.geom, sections: f.sections, joints: f.joints }; }
  function poseState(f, name) {
    const g = poseGlobals(ctxOf(f), name);
    return { q: g.q, scale: g.scale, root: g.root || [0, 0, 0], flex: g.flex, lat: g.lat };
  }
  function currentPose(f, t) {
    const target = poseState(f, poseName);
    if (!poseFrom || t >= 1) return target;
    const from = poseState(f, poseFrom);
    const e = poseEase(t);
    const q = target.q.map((qq, i) => qSlerp(from.q[i], qq, e));
    const scale = {};
    const keys = new Set([...Object.keys(from.scale), ...Object.keys(target.scale)]);
    for (const k of keys) { const a = from.scale[k] || [1, 1, 1], b = target.scale[k] || [1, 1, 1]; scale[k] = vlerp(a, b, e); }
    return { q, scale, root: vlerp(from.root, target.root, e), flex: mix(from.flex, target.flex, e), lat: mix(from.lat || 0, target.lat || 0, e) };
  }
  function footOffset(f, pose) {   // keep the lowest ankle at its fitted (rest-pose) height: feet stay on the floor
    const { J } = skinMatrices(A, f.heads, pose);
    if (!f.restAnkle) { const r = skinMatrices(A, f.heads, f.relax).J; f.restAnkle = [r[A.B.footL][1], r[A.B.footR][1]]; }
    const dy = Math.min(J[A.B.footL][1] - f.restAnkle[0], J[A.B.footR][1] - f.restAnkle[1]);
    return [0, -dy, 0];
  }

  // ---------------- GL
  function initGL() {
    gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    progBody = program(gl, VERT, FRAG);
    progBg = program(gl, BG_VERT, BG_FRAG);
    // floor height map (top-down, MIN-blended): RGBA8 is enough — 1/255 of the body height is ≈ 0.27 in, well
    // under the blur radius — and it needs no float-render extension, so it works everywhere WebGL2 does.
    shTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, shTex);
    gl.texStorage2D(gl.TEXTURE_2D, 9, gl.RGBA8, SH_RES, SH_RES);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    shFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, shFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    const n = A.nMesh, nb = A.bun ? A.bun.n : 0;   // nb: female hair-bun vertices appended after the body
    const cat = (T, a, b) => { const o = new T(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
    const tris = nb ? cat(Uint16Array, A.tris, A.bun.tris) : A.tris;
    bufs.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tris, gl.STATIC_DRAW); nIdx = tris.length;
    bufs.joint = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.joint);
    gl.bufferData(gl.ARRAY_BUFFER, nb ? cat(Uint8Array, A.skinIdx.subarray(0, n * 4), new Uint8Array(nb * 4).fill(A.B.head)) : A.skinIdx.subarray(0, n * 4), gl.STATIC_DRAW);
    const w8 = new Uint8Array((n + nb) * 4); for (let i = 0; i < n * 4; i++) w8[i] = Math.round(A.skinW[i] * 255);
    for (let k = 0; k < nb; k++) w8[(n + k) * 4] = 255;
    bufs.weight = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.weight); gl.bufferData(gl.ARRAY_BUFFER, w8, gl.STATIC_DRAW);
    // the bun's canonical coord is its template point nudged by the unit sphere, so the hair strand noise varies
    // over it (one shared coord made it a flat blob); it stays well above the hairline, so hairMaskF is still 1
    const bunCanon = new Float32Array(nb * 3);
    for (let k = 0; k < nb; k++) for (let j = 0; j < 3; j++) bunCanon[k * 3 + j] = A.bun.canon[j] + A.bun.unit[k * 3 + j] * 0.13;
    const canon = nb ? cat(Float32Array, A.base.subarray(0, n * 3), bunCanon) : A.base.subarray(0, n * 3);
    bufs.canon = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.canon); gl.bufferData(gl.ARRAY_BUFFER, canon, gl.STATIC_DRAW);
    // kind: 0 torso/legs (shorts + definition eligible), 1 head/neck, 2 arm, 3 eye — interpolates safely
    const kind = new Uint8Array(n + nb).fill(1); for (let i = 0; i < n; i++) { const pt = A.part[i]; kind[i] = pt === 6 ? 3 : pt === 1 ? 1 : pt === 2 || pt === 3 ? 2 : 0; }
    bufs.part = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.part); gl.bufferData(gl.ARRAY_BUFFER, kind, gl.STATIC_DRAW);
    // §21c: the smooth arm share of each vertex's skin weights. `kind` is a per-vertex integer, so thresholding it
    // traced the polygonal boundary of a vertex set and the armpit edge of the top came out as a sawtooth; the
    // skin weights vary smoothly across the shoulder, so an iso-contour of them is a smooth curve.
    const armW = new Uint8Array(n + nb);
    for (let i = 0; i < n; i++) armW[i] = Math.round(255 * clamp(A.grp[i * 6 + 2] + A.grp[i * 6 + 3], 0, 1));
    bufs.armw = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufs.armw); gl.bufferData(gl.ARRAY_BUFFER, armW, gl.STATIC_DRAW);
    for (const k of ['main', 'ghost']) { bufs[k + 'Pos'] = gl.createBuffer(); bufs[k + 'Nrm'] = gl.createBuffer(); bufs[k + 'Cav'] = gl.createBuffer(); bufs[k + 'Flare'] = gl.createBuffer(); bufs[k + 'Ao'] = gl.createBuffer(); }
    const mk = (k) => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const attr = (loc, buf, size, type, normalized) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, normalized, 0, 0); };
      attr(0, bufs[k + 'Pos'], 3, gl.FLOAT, false); attr(1, bufs[k + 'Nrm'], 3, gl.FLOAT, false);
      attr(2, bufs.joint, 4, gl.UNSIGNED_BYTE, false); attr(3, bufs.weight, 4, gl.UNSIGNED_BYTE, true);
      attr(4, bufs.canon, 3, gl.FLOAT, false); attr(5, bufs.part, 1, gl.UNSIGNED_BYTE, false); attr(6, bufs[k + 'Cav'], 1, gl.FLOAT, false);
      attr(7, bufs[k + 'Flare'], 3, gl.FLOAT, false); attr(8, bufs.armw, 1, gl.UNSIGNED_BYTE, true);
      attr(9, bufs[k + 'Ao'], 1, gl.FLOAT, false);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
      gl.bindVertexArray(null);
      return vao;
    };
    vaoMain = mk('main'); vaoGhost = mk('ghost');
  }
  function uploadFit(f, k) {
    if (!bufs.idx) uploadStatic();
    const b = f.bun, cat = (a, c) => { if (!b) return a; const o = new Float32Array(a.length + c.length); o.set(a); o.set(c, a.length); return o; };
    const nb = b ? b.pos.length / 3 : 0;   // female hair bun (cavity −1 marks it: no hair-cap lift, no AO)
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k + 'Pos']); gl.bufferData(gl.ARRAY_BUFFER, cat(f.rest, b && b.pos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k + 'Nrm']); gl.bufferData(gl.ARRAY_BUFFER, cat(f.restNrm, b && b.nrm), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k + 'Cav']); gl.bufferData(gl.ARRAY_BUFFER, cat(f.cavity, new Float32Array(nb).fill(-1)), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k + 'Flare']); gl.bufferData(gl.ARRAY_BUFFER, cat(f.flare, new Float32Array(nb * 3)), gl.DYNAMIC_DRAW);
    // the bun sits against the skull, so it is baked at a fixed, fairly occluded value rather than left open
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k + 'Ao']); gl.bufferData(gl.ARRAY_BUFFER, cat(f.ao, new Float32Array(nb).fill(0.72)), gl.DYNAMIC_DRAW);
  }
  function freeGL() {
    if (!gl) return;
    for (const b of Object.values(bufs)) if (b) gl.deleteBuffer(b);
    for (const v of [vaoMain, vaoGhost, vaoBg]) if (v) gl.deleteVertexArray(v);
    for (const p of [progBody, progBg]) if (p) gl.deleteProgram(p);
    if (shTex) gl.deleteTexture(shTex); if (shFB) gl.deleteFramebuffer(shFB);
    bufs = {}; vaoMain = vaoGhost = vaoBg = progBody = progBg = shTex = shFB = null;
  }
  function resize() {
    if (!gl || lost) return;
    const r = stage.getBoundingClientRect();
    readTheme();
    // 4× MSAA is on (antialias: true), so the silhouette is covered; the floor keeps the cap at 2 on phones and
    // supersamples a 1× desktop display to 1.5, where the extra pixels are free.
    dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2);
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
    const target = [0, H * (cam.focus ?? mix(0.5, 0.7, zt)), 0];
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
      const t = clamp((ts - camAnim.t0) / camAnim.dur, 0, 1), e = poseEase(t);
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
    VP = cameraFor(fit);
    const pose = currentPose(fit, pt), off = footOffset(fit, pose);
    const H = fit.geom.heightIn;
    // ---- body program: per-frame uniforms, shared by the floor-height pass and the shaded pass
    gl.useProgram(progBody);
    const L = progBody.loc, ld = lightDirs();
    gl.uniform3fv(L.uEye, eye);
    gl.uniform3fv(L.uKey, ld.key); gl.uniform3fv(L.uFill, ld.fill); gl.uniform3fv(L.uRim, ld.rim); gl.uniform3fv(L.uRim2, ld.rim2);
    gl.uniform3fv(L.uLC, ST.lights); gl.uniform3fv(L.uSky, ST.sky); gl.uniform3fv(L.uGnd, ST.gnd);
    gl.uniform3f(L.uTone, ST.exposure, ST.rim, ST.t);
    gl.uniform3f(L.uSkin, 0.425, 0.272, 0.206);   // linear diffuse albedo (energy-conserving BRDF: albedo / π)
    const c = A.base, lm = A.lm;
    gl.uniform4f(L.uEyeRef, A.eye[0], A.eye[1], A.eye[2], c[lm.chinV * 3 + 1]);
    gl.uniform4f(L.uCanon, c[lm.navelV * 3 + 1], c[lm.nippleV * 3 + 1], c[lm.crotchV * 3 + 1], Math.abs(c[lm.nippleV * 3]));
    gl.uniform4f(L.uCanon2, c[A.bones[A.B.uarm1L].head * 3 + 1], c[A.bones[A.B.shinL].head * 3 + 1], c[lm.chinV * 3 + 1], c[lm.crotchV * 3 + 1] + 0.55);
    gl.uniform4i(L.uUA, A.B.uarm1L, A.B.uarm2L, A.B.uarm1R, A.B.uarm2R);
    const fem = A.sex === 'female';
    gl.uniform1f(L.uFem, fem ? 1 : 0);
    if (fem) {
      gl.uniform4f(L.uBra, c[lm.imfV * 3 + 1], c[lm.nippleV * 3 + 1], Math.abs(c[lm.nippleV * 3]), c[A.notchV * 3 + 1]);
      const sp = A.strap;   // §21c: strap centre-line on the canonical surface (constant-width tube)
      gl.uniform3fv(L.uStrapP, strapBuf(sp));
      gl.uniform1f(L.uStrapR, sp.radius);
      gl.uniform1i(L.uStrapN, Math.min(20, sp.pts.length));
    }
    const drawBody = (f, vao, ghost) => {
      const p = ghost ? currentPose(f, pt) : pose;
      const { M } = skinMatrices(A, f.heads, p, ghost ? footOffset(f, p) : off);
      gl.uniformMatrix4fv(L.uBones, false, M);
      const aL = armAxis(f, 'L'), aR = armAxis(f, 'R');
      gl.uniform3fv(L.uArmA, [...aL.a, ...aR.a]); gl.uniform3fv(L.uArmB, [...aL.b, ...aR.b]); gl.uniform3fv(L.uArmF, [...aL.front, ...aR.front]);
      const fx = p.flex * f.flexAmp; gl.uniform2f(L.uFlex, fx, fx);
      gl.uniform1f(L.uLat, p.lat || 0);
      const mAvg = Object.values({ ...DEF_MUSCLE, ...(f.muscleEff || {}) }).reduce((t, x) => t + (num(x) ?? 0.4), 0) / 8;
      const dl = definitionLevels(f.bf, mAvg, f.sex);   // BF_CAL heuristic (DXA-equivalent body fat)
      gl.uniform1f(L.uDef, ghost ? 0 : 1);
      gl.uniform3f(L.uDefMix, dl.upper, dl.full, dl.sep);
      gl.uniform1f(L.uGhost, ghost ? 1 : 0);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0);
    };

    // ---- 1. floor height map: the body from straight above, MIN-blended, so each texel holds the height of the
    //         lowest surface over its column. That is what gives the contact shadow the figure's real outline.
    const SR = H * 0.46, maxH = H * 1.05;
    gl.bindFramebuffer(gl.FRAMEBUFFER, shFB);
    gl.viewport(0, 0, SH_RES, SH_RES);
    gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MIN); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniformMatrix4fv(L.uVP, false, orthoTop(SR, -0.05 * H, 1.25 * H));
    gl.uniform2f(L.uShadowPass, 1, 1 / maxH);
    drawBody(fit, vaoMain, false);
    gl.disable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
    gl.uniform2f(L.uShadowPass, 0, 1 / maxH);
    gl.uniformMatrix4fv(L.uVP, false, VP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, shTex); gl.generateMipmap(gl.TEXTURE_2D);   // the mip chain IS the penumbra blur

    gl.viewport(0, 0, W, Hh);
    gl.clearColor(Math.pow(bgLin[0], 1 / 2.2), Math.pow(bgLin[1], 1 / 2.2), Math.pow(bgLin[2], 1 / 2.2), 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---- 2. backdrop + studio floor (ray-cast against y = 0, shadowed by the height map)
    gl.useProgram(progBg); gl.bindVertexArray(vaoBg);
    gl.uniform2f(progBg.loc.uRes, W, Hh);
    gl.uniform3fv(progBg.loc.uBg, bgLin);
    gl.uniform3fv(progBg.loc.uGlow, ST.glow);
    gl.uniform3fv(progBg.loc.uFloor, ST.floor);
    gl.uniform3fv(progBg.loc.uEye, eye);
    gl.uniformMatrix4fv(progBg.loc.uInvVP, false, invert4(VP) || VP);
    gl.uniform4f(progBg.loc.uGround, SR, maxH, clamp(eye[1] / (0.10 * H), 0, 1), 0.85);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shTex);
    gl.uniform1i(progBg.loc.uSh, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- 3. the body
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
    gl.useProgram(progBody);
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
      camAnim = { from: { ...cam }, to: { yaw: nearestYaw(v.yaw), pitch: v.pitch }, t0: performance.now(), dur: POSE_MS + 150 };
    }
    requestRender();
  }

  try { initGL(); } catch (err) { root.classList.add('b3m-failed'); loadEl.textContent = '3D unavailable'; }
  // the asset follows the sex (opts.sex › shape.sex › profile.body.sex); "now" and "projected" share it
  let sex = sexOf(o);
  function loadAsset(sx) {
    loadBodyAsset(null, sx).then(asset => {
      if (dead || sx !== sex) return;
      if (A && A !== asset) {   // sex switched while mounted: new canonical mesh → fresh static buffers and fits
        fitCache.clear(); fit = ghostFit = null; fitKey = ghostKey = '';
        if (gl && !lost) { freeGL(); A = asset; initGL(); }
      }
      A = asset;
      if (gl && !lost && !bufs.idx) uploadStatic();
      refit();
      loadEl.style.display = 'none';
      requestRender();
    }).catch(err => { loadEl.textContent = '3D model failed to load'; console.warn('[body3d-mesh]', err); });
  }
  loadAsset(sex);

  return {
    canvas,
    update(next = {}) {
      o = { ...o, ...next };
      if ('label' in next) setLabel();
      if ('pose' in next && next.pose && next.pose !== poseName) setPose(next.pose);
      if ('sex' in next || (next.shape && 'sex' in next.shape)) {
        const sx = sexOf(o);
        if (sx !== sex) { sex = sx; loadEl.style.display = ''; loadAsset(sx); return; }
      }
      refit(); requestRender();
    },
    setPose,
    getPose: () => poseName,
    setView(yaw, pitch = cam.pitch, zoom = cam.zoom, focus = null) {
      camAnim = null; cam.yaw = yaw; cam.pitch = pitch; cam.zoom = clamp(zoom, 0.8, 6); cam.focus = focus; cam.vy = cam.vp = 0; requestRender();
    },
    stats: () => ({ fitMs: fit ? fit.ms : 0, frameMs, verts: A ? A.nMesh : 0, tris: A ? A.tris.length / 3 : 0, ready: !!fit, report: fit && fit.report,
      sex: A ? A.sex : sex, cup: fit ? fit.cup : 0 }),
    getSex: () => sex,
    destroy() {
      dead = true; if (raf) cancelAnimationFrame(raf); raf = 0;
      if (ro) ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      try { freeGL(); const ext = gl && gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* ignore */ }
      gl = null; fit = ghostFit = null; fitCache.clear(); root.remove();
    },
  };
}
