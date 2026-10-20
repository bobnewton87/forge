// 3D physique viewer (MODEL-3D). Raw WebGL2, no libraries: a full-screen fragment shader raymarches a
// signed-distance-field male physique built from smooth-blended muscle primitives on a posable skeleton.
//
//   mountBody3D(el, { shape, muscle, bodyFatPct, pose, compareShape, autoRotate, height, showScale })
//     → { update(opts), setPose(name), destroy() }
//   POSES, supported()
//
// Accuracy ("to scale"): segment lengths and landmark heights follow standard anthropometric ratios of
// stature (Drillis & Contini; NASA-STD-3000). The SDF is written ONCE in a small GLSL-compatible dialect
// (SDF_SRC) that is compiled to GLSL for the GPU and to JS for measurement, so the girths we verify are the
// girths we draw. buildBodyGeometry() measures the SDF's cross-section perimeters at the tape landmarks
// (convex hull, like a tape bridging hollows) and solves the primitive radii until each girth matches the
// tape (target ±1%, tested ±3% in test/body3d-geometry.test.js).
//
// CONTRACT-NOTE: extras beyond §16 (all optional):
//   - compareShape may carry its own `bodyFatPct` and `muscle`; otherwise opts.compareBodyFatPct /
//     opts.compareMuscle are used, else the main body's values. Drawn as a Fresnel ghost at the same scale.
//   - opts.showScale (default false) draws a ft/in height ruler; opts.projection 'perspective' | 'ortho'.
//   - opts.showPoses (default true) renders the pose chips; opts.onPose(name) fires on chip taps;
//     opts.label draws a small caption.
//   - shape accepts armL/armR, thighL/thighR, calfL/calfR (averaged). `arm` is the FLEXED girth (as the
//     Measurements screen asks): it is matched in the double-biceps pose; the relaxed arm is naturally smaller.
//   - the handle also exposes `canvas`, `getPose()`, `stats()` and `geometry()` (measured girths in inches).
//   - pure exports for tests: buildBodyGeometry, measureGirths, measureLandmarks, PROPORTIONS, PARAMS.

import { bodyGeometry as anthroGeometry } from '../engine/anthro.js';

const IN = 0.0254;
export const POSES = ['relaxed', 'front_double_biceps', 'lat_spread', 'side_chest', 'back_double_biceps'];
const POSE_LABEL = {
  relaxed: 'Relaxed', front_double_biceps: 'Front double bi', lat_spread: 'Lat spread',
  side_chest: 'Side chest', back_double_biceps: 'Back double bi',
};
const DEF_SHAPE = { neck: 15, shoulders: 46, chest: 39, waist: 33, hips: 37, arm: 13, forearm: 11, thigh: 22, calf: 14.5, heightIn: 69 };
const RANGE = { neck: [11, 22], shoulders: [36, 64], chest: [30, 56], waist: [24, 54], hips: [28, 56], arm: [9, 22], forearm: [8, 17], thigh: [15, 34], calf: [11, 21], heightIn: [58, 82] };
const DEF_MUSCLE = { chest: 0.4, delts: 0.4, lats: 0.4, arms: 0.4, abs: 0.4, quads: 0.5, calves: 0.5, traps: 0.4 };
const DEF_BF = 17;

// Landmark heights / segment lengths as fractions of stature (adult male).
export const PROPORTIONS = {
  vertex: 1.0, chin: 0.870, neckGirth: 0.848, acromion: 0.818, shoulderJoint: 0.791, chest: 0.720, navel: 0.600,
  trochanter: 0.530, hipJoint: 0.520, crotch: 0.470, thighGirth: 0.455, knee: 0.285, ankle: 0.039,
  upperArm: 0.186, forearm: 0.146, hand: 0.108, foot: 0.152, head: 0.130,
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const num = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
const avg2 = (a, b) => (num(a) && num(b) ? (a + b) / 2 : num(a) ?? num(b));

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

// ---------------------------------------------------------------- tiny vec3 math (rig, arrays)
const v3 = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const ortho = (v, axis) => norm(sub(v, mul(axis, dot(v, axis))));
// mat3 as 9 floats, column-major (columns X, Y, Z) -> GLSL `v * M` gives local coords.
const frame = (X, Y, Z) => [...X, ...Y, ...Z];
const col = (M, i) => [M[i * 3], M[i * 3 + 1], M[i * 3 + 2]];

// ---------------------------------------------------------------- inputs
export function normShape(shape) {
  const m = shape || {};
  const raw = {
    ...m,
    arm: num(m.arm) ?? avg2(m.armL, m.armR),
    thigh: num(m.thigh) ?? avg2(m.thighL, m.thighR),
    calf: num(m.calf) ?? avg2(m.calfL, m.calfR),
  };
  const hIn = clamp(num(raw.heightIn) ?? DEF_SHAPE.heightIn, ...RANGE.heightIn);
  const hs = Math.sqrt(hIn / 69);
  const out = { heightIn: hIn };
  for (const k of Object.keys(DEF_SHAPE)) {
    if (k === 'heightIn') continue;
    const v = num(raw[k]);
    out[k] = clamp(v ?? DEF_SHAPE[k] * (k === 'neck' || k === 'arm' || k === 'forearm' ? 1 : hs), ...RANGE[k]);
  }
  if (!num(raw.chest) && num(raw.shoulders)) out.chest = clamp(out.shoulders * 0.85, ...RANGE.chest);
  if (!num(raw.shoulders) && num(raw.chest)) out.shoulders = clamp(out.chest * 1.18, ...RANGE.shoulders);
  if (!num(raw.hips) && num(raw.waist)) out.hips = clamp(Math.max(out.waist * 1.04, 34), ...RANGE.hips);
  out.chest = Math.max(out.chest, out.waist * 0.85);
  out.shoulders = Math.max(out.shoulders, out.chest * 1.04);
  return out;
}
function normMuscle(m) {
  const out = {};
  for (const k of Object.keys(DEF_MUSCLE)) {
    const v = m && typeof m[k] === 'number' && isFinite(m[k]) ? m[k] : DEF_MUSCLE[k];
    out[k] = clamp(v, 0, 1);
  }
  return out;
}

// Ramanujan: half-width a of an ellipse with depth ratio k (b = k a) and perimeter C (inches -> meters).
const halfW = (cIn, k) => { const h = ((1 - k) / (1 + k)) ** 2; return (cIn * IN) / (Math.PI * (1 + k) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h)))); };

// Calibration factors (solved per body; these are the solution for the default body, used as a start).
const DEFAULT_F = { pk: 1.086, neck: 0.972, sh: 0.926, chest: 0.9, waist: 0.857, hips: 0.87, arm: 0.896, fa: 0.778, thigh: 1.075, calf: 0.992 };

// Derive shader parameters (meters; body faces +Z, feet at y = 0).
// Shared anthropometric geometry (js/engine/anthro.js, ANTHRO): landmark heights, joints, bone lengths,
// section aspects and the girth targets at each landmark. Falls back to PROPORTIONS if unavailable.
function anthroOf(S, M, bf) {
  try { return anthroGeometry({ ...S, bodyFatPct: bf, muscle: M }); } catch (e) { return null; }
}

function derive(shapeIn, muscleIn, bfIn, F = DEFAULT_F, Ain) {
  const S = normShape(shapeIn), M = normMuscle(muscleIn);
  const bf = clamp(num(bfIn) ?? DEF_BF, 4, 45);
  const A = Ain === undefined ? anthroOf(S, M, bf) : Ain;
  const H = S.heightIn * IN, s = H / 1.753, R = PROPORTIONS;
  const fatF = clamp((bf - 10) / 18, 0, 1.4), f1 = Math.min(fatF, 1);
  const def = 1 - sstep(9, 15.5, bf);
  const P = { H, s, def, fatF, drop: 0, chestUp: 0, latFlare: 0 };
  P.kSep = (mix(0.026, 0.0045, def) + 0.012 * f1) * s;
  P.kFat = mix(0.03, 0.09, f1) * s;
  P.fatT = (0.002 + 0.010 * fatF) * s;    // torso subcutaneous layer
  P.fatL = (0.001 + 0.005 * fatF) * s;    // limbs (male pattern: less)

  // landmark heights
  P.shY = R.shoulderJoint * H; P.clavY = (R.acromion + 0.004) * H;
  P.ribY = 0.722 * H; P.ribH = 0.098 * H; P.ribZ = -0.012 * s;
  P.wstY = R.navel * H; P.wstH = 0.078 * H;
  P.hipY = 0.522 * H; P.hipH = 0.05 * H;
  P.neckY0 = 0.81 * H; P.neckY1 = 0.89 * H; P.headY = 0.94 * H;
  P.crotchY = R.crotch * H; P.shortsTop = 0.548 * H;
  P.Lu = R.upperArm * H; P.Lf = R.forearm * H;
  P.hipJY = R.hipJoint * H; P.Lt = (R.hipJoint - R.knee) * H; P.Ls = (R.knee - R.ankle) * H;
  let kChest = 0.70, kWaist = 0.78, kHip = 0.80, shX0 = null, hipX0 = null;
  P.wstZ = 0;
  if (A) {                                   // anthro landmarks/joints/bones (inches -> meters)
    const hy = k => A.heights[k] * IN, Lm = A.landmarks, J = A.joints;
    P.shY = J.shoulderL.y * IN; P.clavY = hy('acromion') + 0.004 * H;
    P.ribY = hy('chest') + 0.002 * H; P.wstY = hy('waist');
    P.hipY = hy('crotch') + 0.05 * H + P.fatT * 1.2; P.crotchY = hy('crotch');
    P.headY = hy('chin') + 0.123 * s;
    P.Lu = A.bones.upperArm * IN; P.Lf = A.bones.forearm * IN; P.Lt = A.bones.thigh * IN; P.Ls = A.bones.shank * IN;
    P.hipJY = J.hipL.y * IN; hipX0 = Math.abs(J.hipL.x) * IN; shX0 = Math.abs(J.shoulderL.x) * IN;
    kChest = clamp(Lm.chest.rz / Lm.chest.rx, 0.6, 0.95); kWaist = clamp(Lm.waist.rz / Lm.waist.rx, 0.6, 1.0); kHip = clamp(Lm.hip.rz / Lm.hip.rx, 0.6, 0.95);
    P.wstZ = clamp(Lm.waist.cz - Lm.chest.cz, -1, 2.5) * IN * 0.6;
  }

  // torso sections: Ramanujan first guess from the tape, then scaled by the solved factors
  const chestA = halfW(S.chest, kChest), waistA = halfW(S.waist, kWaist), hipA = halfW(S.hips, kHip);
  P.ribA = (chestA * 0.84 - P.fatT * 0.6) * F.chest; P.ribB = (chestA * kChest * 0.86 - P.fatT * 0.5) * F.chest;
  P.wstA = (waistA * (0.95 - 0.10 * f1) - P.fatT) * F.waist; P.wstB = (waistA * kWaist * (0.95 - 0.14 * f1) - P.fatT) * F.waist;
  P.hipA = (hipA * 0.74 - P.fatT) * F.hips; P.hipB = (hipA * kHip * 0.74 - P.fatT) * F.hips;
  const fh = Math.sqrt(F.hips);
  P.gluteR = Math.max(0.05 * s, hipA * 0.42) * fh; P.gluteX = 0.074 * s * fh; P.gluteY = (A ? A.heights.hip * IN : 0.505 * H) + 0.006 * H; P.gluteZ = -(hipA * kHip * 0.36) * fh;
  P.hipJX = hipX0 ? hipX0 * clamp(fh, 0.88, 1.12) : Math.max(0.075 * s, hipA * 0.5 * fh);

  // shoulders: bideltoid half-width from the shoulder girth
  const shHalf = 0.2 * S.shoulders * IN * F.sh;
  P.deltR = (0.040 + 0.012 * M.delts) * s * clamp(S.shoulders / 46, 0.85, 1.25);
  P.shX = shX0 ? shX0 * F.sh : Math.max(shHalf - P.deltR * 1.32 - P.fatL, P.ribA * 0.8);

  // pecs
  P.pecT = (0.02 + 0.026 * M.chest) * s;
  P.pecRx = P.ribA * 0.56; P.pecRy = 0.04 * H;
  P.pecCx = 0.004 * s + P.pecRx; P.pecY = 0.75 * H;
  const ribFront = (x, y) => P.ribZ + P.ribB * Math.sqrt(Math.max(0.05, 1 - (x / P.ribA) ** 2 - ((y - P.ribY) / P.ribH) ** 2));
  P.pecZ = ribFront(P.pecCx, P.pecY) - P.pecT * 0.25;
  // lats / back
  P.latRx = (0.022 + 0.026 * M.lats) * s; P.latRy = 0.086 * H;
  P.latX = P.ribA * 0.80; P.latY = 0.685 * H;
  P.backT = (0.012 + 0.012 * M.lats) * s;
  P.trapT = (0.024 + 0.022 * M.traps) * s; P.trapH = (0.012 + 0.03 * M.traps) * s;
  P.erR = (0.018 + 0.006 * M.lats) * s;
  P.neckR = (S.neck * IN) / (2 * Math.PI) * 0.92 * F.neck;
  // abs: 3 pairs above the navel + lower block
  P.absHw = 0.021 * H; P.absTop = 0.69 * H; P.absRow = 0.028 * H;
  P.absAmp = (0.0022 + 0.0048 * M.abs) * s * (0.08 + 0.92 * def) * (1 - 0.6 * f1);
  P.oblR = (0.022 + 0.008 * M.abs) * s;
  P.serAmp = def * (0.5 + 0.5 * M.lats) * s;
  P.bellyAmp = clamp((bf - 13) / 15, 0, 1.3) * 0.035 * s;
  P.loveAmp = clamp((bf - 12) / 14, 0, 1.3) * 0.028 * s;
  P.chestFat = clamp((bf - 15) / 14, 0, 1.2) * 0.022 * s;

  // arms
  P.armR = (S.arm * IN) / (2 * Math.PI) * F.arm - P.fatL;
  P.bicR = P.armR * (0.86 + 0.24 * M.arms); P.triR = P.armR * (0.9 + 0.18 * M.arms);
  P.bicPk = 0.18 + 0.3 * M.arms;
  P.flexK = F.pk;
  P.faR = (S.forearm * IN) / (2 * Math.PI) * F.fa - P.fatL * 0.6; P.wristR = 0.026 * s;
  // legs
  P.thR = (S.thigh * IN) / (2 * Math.PI) * F.thigh - P.fatL * 1.4; P.kneeR = 0.046 * s;
  P.calfR = (S.calf * IN) / (2 * Math.PI) * F.calf - P.fatL * 0.6; P.ankleR = 0.031 * s;
  P.sweep = 0.75 + 0.5 * M.quads; P.vmo = 0.75 + 0.5 * M.quads; P.gastro = 0.75 + 0.5 * M.calves;
  P.hamR = P.thR * 0.55;
  return { P, S, M, bf, s, H, A, F: { ...F } };
}

// ---------------------------------------------------------------- poses
// Each pose returns a flat numeric state (lerpable). Arm targets are wrist positions; the left arm is
// expressed in mirrored space (x -> -x) so it is solved and shaded exactly like the right arm.
function poseState(name, D) {
  const { P, s } = D;
  const S = v3(P.shX, P.shY, 0);
  const st = {
    rT: v3(0, 0, 0), rPole: v3(0.3, 0, -1), rOpen: 1, rTwist: 1.2,
    lT: v3(0, 0, 0), lPole: v3(0.3, 0, -1), lOpen: 1, lTwist: 1.2,
    shUp: 0, shFwd: 0, latFlare: 0, chestUp: 0,
    rAbd: 0.035, rFlex: 0, rKnee: 0.02, rPitch: 0, rYaw: 0.12,
    lAbd: 0.035, lFlex: 0, lKnee: 0.02, lPitch: 0, lYaw: 0.12,
    yaw: 0.28, pitch: 0.05,
  };
  const L = P.Lu + P.Lf;
  const fromElbow = (dirU, dirF) => { const E = add(S, mul(norm(dirU), P.Lu)); const T = add(E, mul(norm(dirF), P.Lf)); return { T, pole: sub(E, mul(add(S, T), 0.5)) }; };
  if (name === 'front_double_biceps' || name === 'back_double_biceps') {
    const a = fromElbow(v3(1, 0.2, name === 'back_double_biceps' ? -0.02 : 0.1), v3(-0.3, 1, 0.12));
    Object.assign(st, { rT: a.T, rPole: a.pole, lT: a.T, lPole: a.pole, rOpen: 0, lOpen: 0, rTwist: 0.3, lTwist: 0.3, shUp: 0.012 * s, latFlare: 0.55, chestUp: 0.6 });
    st.rAbd = st.lAbd = 0.07; st.rYaw = st.lYaw = 0.25;
    if (name === 'back_double_biceps') { st.yaw = Math.PI; st.latFlare = 0.9; st.lFlex = -0.14; st.lKnee = 0.2; st.lPitch = 0.35; }
    else st.yaw = 0;
  } else if (name === 'lat_spread') {
    const T = v3(P.wstA + P.fatT + 0.03 * s, P.wstY + 0.035 * s, -0.035 * s);
    const E = add(S, mul(norm(v3(0.95, -0.42, 0.22)), P.Lu));
    Object.assign(st, { rT: T, rPole: sub(E, mul(add(S, T), 0.5)), lT: T, lPole: sub(E, mul(add(S, T), 0.5)), rOpen: 0, lOpen: 0, rTwist: -0.4, lTwist: -0.4, shFwd: 0.018 * s, shUp: 0.006 * s, latFlare: 1, chestUp: 0.5, yaw: 0 });
    st.rAbd = st.lAbd = 0.065;
  } else if (name === 'side_chest') {
    const rT = v3(-0.03 * s, P.wstY + 0.1 * s, P.wstB + P.fatT + 0.07 * s);
    const rE = add(S, mul(norm(v3(0.25, -0.93, 0.26)), P.Lu));
    const lT = v3(0.07 * s, rT[1] - 0.02 * s, rT[2]);
    const lE = add(S, mul(norm(v3(0.32, -0.92, 0.2)), P.Lu));
    Object.assign(st, { rT, rPole: sub(rE, mul(add(S, rT), 0.5)), lT, lPole: sub(lE, mul(add(S, lT), 0.5)), rOpen: 0, lOpen: 0.25, rTwist: 0.2, lTwist: 1.0, chestUp: 1, latFlare: 0.3, shUp: 0.006 * s, yaw: 1.05, pitch: 0.06 });
    st.rFlex = 0.2; st.rKnee = 0.42; st.rPitch = 0.34; st.rAbd = 0.01; st.lAbd = 0.05;
  } else {
    let T = v3(Math.max(P.hipA + P.fatT + 0.065 * s, P.shX + 0.03 * s), P.shY - L * 0.955, 0.018 * s);
    if (D.A) {   // anthro rest pose: arms hanging, palms to the thighs (shifted with the solved shoulder width)
      const w = D.A.joints.wristL, sx = Math.abs(D.A.joints.shoulderL.x) * IN;
      T = v3(Math.abs(w.x) * IN + (P.shX - sx), w.y * IN, w.z * IN);
    }
    st.rT = T; st.lT = T.slice();
  }
  return st;
}
const lerpState = (a, b, t) => {
  const o = {};
  for (const k in b) o[k] = Array.isArray(b[k]) ? lerp3(a[k], b[k], t) : mix(a[k], b[k], t);
  return o;
};

// 2-bone IK: shoulder S, wrist target T, pole hint -> elbow + frames.
function solveArm(P, S, T, pole, open, twist) {
  const a = P.Lu, b = P.Lf;
  const dv = sub(T, S); let dist = len(dv); const dir = norm(dv);
  dist = clamp(dist, Math.abs(a - b) + 0.01, a + b - 0.002);
  const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  let perp = sub(pole, mul(dir, dot(pole, dir)));
  if (len(perp) < 1e-5) perp = v3(0, 0, -1);
  perp = norm(perp);
  const E = add(S, add(mul(dir, a * cosA), mul(perp, a * sinA)));
  const W = add(S, mul(dir, dist));
  const d = norm(sub(E, S)), fd = norm(sub(W, E));
  const c = clamp(dot(d, fd), -1, 1), th = Math.acos(c);
  const f = th > 0.04 ? ortho(fd, d) : ortho(mul(perp, -1), d);
  const Y = mul(d, -1), Z = f, X = norm(cross(Y, Z));
  const sn = Math.sin(th), cs = Math.cos(th);
  const Zf = norm(sub(mul(f, cs), mul(d, sn)));
  const Yf = mul(fd, -1), Xf = norm(cross(Yf, Zf));
  const ct = Math.cos(twist), st = Math.sin(twist);
  const Zh = norm(sub(mul(Zf, ct), mul(Xf, st))), Xh = norm(add(mul(Xf, ct), mul(Zf, st)));
  const lw = (o, M, l) => add(o, add(add(mul(M[0], l[0]), mul(M[1], l[1])), mul(M[2], l[2])));
  const U = [X, Y, Z];
  return {
    S, E, W, U: frame(X, Y, Z), F: frame(Xf, Yf, Zf), Hd: frame(Xh, Yf, Zh),
    X: [open, clamp(th / 1.9, 0, 1), 0, 0],
    pecIns: lw(S, U, [0.0, -0.085 * P.s, 0.03 * P.s]),
    latIns: lw(S, U, [-0.012 * P.s, -0.09 * P.s, -0.03 * P.s]),
  };
}
function solveLeg(P, Hp, abd, flex, knee, pitch, yaw) {
  const d = norm(v3(Math.sin(abd), -Math.cos(abd) * Math.cos(flex), Math.cos(abd) * Math.sin(flex)));
  const Y = mul(d, -1), Z = ortho(v3(0, 0, 1), Y), X = norm(cross(Y, Z));
  const K = add(Hp, mul(d, P.Lt));
  const sd = norm(sub(mul(d, Math.cos(knee)), mul(Z, Math.sin(knee))));
  const Zs = norm(add(mul(Z, Math.cos(knee)), mul(d, Math.sin(knee))));
  const Ys = mul(sd, -1), Xs = norm(cross(Ys, Zs));
  const A = add(K, mul(sd, P.Ls));
  const Zf = norm(v3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));
  const Yf = ortho(v3(0, 1, 0), Zf), Xf = norm(cross(Yf, Zf));
  return { H: Hp, K, A, T: frame(X, Y, Z), Sh: frame(Xs, Ys, Zs), F: frame(Xf, Yf, Zf) };
}
function buildRig(D, st) {
  const { P, s } = D;
  const S = v3(P.shX + st.shFwd * 0.3, P.shY + st.shUp, st.shFwd);
  const r = solveArm(P, S, st.rT, st.rPole, st.rOpen, st.rTwist);
  const l = solveArm(P, S, st.lT, st.lPole, st.lOpen, st.lTwist);
  const hip = v3(P.hipJX, P.hipJY, 0);
  const rl = solveLeg(P, hip, st.rAbd, st.rFlex, st.rKnee, st.rPitch, st.rYaw);
  const ll = solveLeg(P, hip, st.lAbd, st.lFlex, st.lKnee, st.lPitch, st.lYaw);
  // keep the lowest point of the feet on the floor
  const sole = 0.068 * s;
  const lowOf = (A, pitch) => A[1] - sole - (pitch > 0.02 ? Math.sin(pitch) * 0.16 * s : 0);
  const drop = Math.min(lowOf(rl.A, st.rPitch), lowOf(ll.A, st.lPitch));
  return { arms: [r, l], legs: [rl, ll], drop, chestUp: st.chestUp, latFlare: st.latFlare };
}

// ---------------------------------------------------------------- the SDF (single source of truth)
// Dialect rules (valid GLSL ES 3.0 AND transpilable to JS): vector math only through add/sub/mul/dv/
// mulVM/rot*/absX/mirX/abs3/max3 helpers, no swizzle writes, no vec2, typed declarations with
// initialisers, `#ifndef GHOST` blocks for detail the ghost pass skips. P_name = derived parameter.
const SDF_SRC = String.raw`
float ss(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
float hmax(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return max(a, b) + h * h * k * 0.25; }
float sdEll(vec3 p, vec3 r){ float k0 = length(dv(p, r)); float k1 = length(dv(p, mul(r, r))); return k0 * (k0 - 1.0) / max(k1, 0.000001); }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = sub(p, a); vec3 ba = sub(b, a); float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(sub(pa, mul(ba, h))) - r; }
float sdRC(vec3 p, vec3 a, vec3 b, float r1, float r2){ vec3 pa = sub(p, a); vec3 ba = sub(b, a); float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(sub(pa, mul(ba, h))) - mix(r1, r2, h); }
float sdRBox(vec3 p, vec3 b, float r){ vec3 q = sub(abs3(p), b); return length(max3(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float bump(vec3 p, vec3 r, float edge){ float n = length(dv(p, r)); return ss(1.0, 1.0 - edge, n) * (1.0 - 0.4 * n * n); }

// ---- head + neck (q mirrored to the right side)
float headSdf(vec3 q){
  float s = P_s;
  vec3 h = sub(q, vec3(0.0, P_headY, 0.0));
  float d = sdEll(sub(h, vec3(0.0, 0.006 * s, -0.01 * s)), vec3(0.075 * s, 0.098 * s, 0.096 * s));          // cranium
  d = smin(d, sdEll(sub(h, vec3(0.0, -0.056 * s, 0.028 * s)), vec3(0.059 * s, 0.07 * s, 0.066 * s)), 0.035 * s); // face
  d = smin(d, sdEll(sub(h, vec3(0.0, -0.093 * s, 0.046 * s)), vec3(0.041 * s, 0.03 * s, 0.044 * s)), 0.03 * s);  // chin
  d = smin(d, sdEll(sub(h, vec3(0.042 * s, -0.076 * s, 0.002 * s)), vec3(0.024 * s, 0.031 * s, 0.045 * s)), 0.03 * s); // jaw angle
#ifndef GHOST
  d = smin(d, sdCap(h, vec3(0.0, -0.02 * s, 0.09 * s), vec3(0.0, -0.05 * s, 0.1 * s), 0.0078 * s), 0.02 * s);   // nose
  d = smin(d, sdCap(h, vec3(0.008 * s, -0.004 * s, 0.087 * s), vec3(0.044 * s, 0.0, 0.074 * s), 0.006 * s), 0.02 * s); // brow ridge
  d = smax(d, -sdEll(sub(h, vec3(0.029 * s, -0.021 * s, 0.098 * s)), vec3(0.021 * s, 0.011 * s, 0.014 * s)), 0.02 * s); // eye socket
  d = smin(d, sdEll(sub(h, vec3(0.029 * s, -0.022 * s, 0.077 * s)), vec3(0.0125 * s, 0.0085 * s, 0.0115 * s)), 0.006 * s);  // eye + lids
  d = smin(d, sdEll(sub(h, vec3(0.043 * s, -0.04 * s, 0.055 * s)), vec3(0.02 * s, 0.012 * s, 0.02 * s)), 0.03 * s);   // cheekbone
  d = smin(d, sdEll(sub(h, vec3(0.0, -0.083 * s, 0.089 * s)), vec3(0.02 * s, 0.007 * s, 0.009 * s)), 0.008 * s);       // lips
  d = smax(d, -sdEll(sub(h, vec3(0.0, -0.0835 * s, 0.098 * s)), vec3(0.016 * s, 0.0012 * s, 0.005 * s)), 0.004 * s);   // mouth line
  d = smin(d, sdEll(sub(h, vec3(0.074 * s, -0.03 * s, -0.006 * s)), vec3(0.01 * s, 0.03 * s, 0.018 * s)), 0.008 * s);  // ear
#endif
  float n = sdRC(q, vec3(0.0, P_neckY0, -0.012 * s), vec3(0.0, P_neckY1, -0.004 * s), P_neckR * 1.04, P_neckR * 0.96);
  n = smin(n, sdCap(q, vec3(0.04 * s, P_headY - 0.062 * s, -0.012 * s), vec3(0.013 * s, P_neckY0 + 0.025 * s, 0.05 * s), 0.0115 * s), P_kSep * 1.4 + 0.004 * s); // SCM
  n = smin(n, sdEll(sub(q, vec3(0.0, 0.862 * P_H, P_neckR * 0.8)), vec3(0.011 * s, 0.015 * s, 0.01 * s)), 0.012 * s); // larynx
  return smin(d, n, 0.03 * s);
}

// ---- torso (q mirrored; side selects the arm-linked insertions)
float torsoSdf(vec3 q, int side){
  float s = P_s;
  float lift = P_chestUp * 0.012 * s;
  float d = sdEll(sub(q, vec3(0.0, P_ribY + lift, P_ribZ + lift * 0.6)), vec3(P_ribA * (1.0 + 0.03 * P_chestUp), P_ribH, P_ribB * (1.0 + 0.05 * P_chestUp)));
  d = smin(d, sdEll(sub(q, vec3(0.0, P_shY, -0.018 * s)), vec3(P_shX, 0.036 * s, P_ribB * 0.66)), 0.07 * s);      // shoulder yoke
  d = smin(d, sdEll(sub(q, vec3(0.0, P_wstY, P_wstZ)), vec3(P_wstA, P_wstH, P_wstB)), 0.10 * s);                     // abdomen
  d = smin(d, sdEll(sub(q, vec3(0.0, P_hipY, -0.008 * s)), vec3(P_hipA, P_hipH, P_hipB)), 0.07 * s);              // pelvis
  d = smin(d, sdCap(q, vec3(0.025 * s, P_clavY - 0.014 * s, P_ribZ + P_ribB * 0.62), vec3(P_shX * 0.98, P_shY + 0.014 * s, 0.012 * s), 0.013 * s), 0.04 * s); // clavicle
  d = smin(d, sdEll(sub(q, vec3(P_shX - 0.03 * s, P_shY - 0.045 * s, 0.035 * s)), vec3(0.04 * s, 0.05 * s, 0.04 * s)), 0.04 * s); // anterior shoulder
  vec3 c = sub(q, vec3(P_gluteX, P_gluteY, P_gluteZ));
  d = smin(d, sdEll(c, vec3(P_gluteR * 0.86, P_gluteR, P_gluteR * 0.8)), 0.03 * s + P_kSep);                     // glutes

  // surface muscles as displacement (they hug the body; definition = edge sharpness)
  float ed = mix(0.95, 0.42, P_def);
  float kh = mix(0.012, 0.0025, P_def) * s;
  float lf = P_latFlare;
  // pecs: domed plate, lower border curving up into the armpit, fading up into the clavicle
  c = rotXY(sub(q, vec3(P_pecCx, P_pecY + lift, 0.0)), 0.26);
  float pu = clamp(c.x / P_pecRx, -1.2, 1.4);
  float pp = max(pu, 0.0);
  float ew = mix(0.07, 0.05, P_def) * s;
  float yb = c.y + P_pecRy * (1.0 - 0.22 * pu * pu - 0.35 * pp * pp);
  float pv = yb / (2.3 * P_pecRy);
  float pl = ss(0.0, ew, yb) * (1.0 - 0.9 * ss(0.25, 1.0, pv));
  float px = ss(1.35, 0.4, abs(pu)) * mix(ss(0.0, 0.016 * s, q.x), 1.0, ss(0.35, 0.8, pv)) * (1.0 - 0.3 * pu * pu);
  float hp = pl * px * ss(-0.02 * s, 0.03 * s, q.z) * P_pecT * (0.85 + 0.25 * ss(-0.3, 0.8, pu));
  float H = hp;
  // lats: thickest at the outer edge (V-taper)
  c = rotXY(sub(q, vec3(P_latX + lf * 0.012 * s, P_latY + 0.01 * s, -0.05 * s)), -0.42 - lf * 0.06);
  float hl = bump(c, vec3(0.08 * s + lf * 0.01 * s, P_latRy * 1.15, 0.11 * s), 1.0) * ss(0.02 * s, 0.13 * s, q.x) * (P_latRx + lf * 0.014 * s);
  H = hmax(H, hl, kh);
  // teres major + infraspinatus over the scapula
  c = rotXY(sub(q, vec3(0.12 * s, 1.27 * s, -0.075 * s)), 0.6);
  H = hmax(H, bump(c, vec3(0.065 * s, 0.04 * s, 0.09 * s), 1.0) * (0.004 * s + P_backT * 0.4), kh * 2.0);
  c = rotXY(sub(q, vec3(0.08 * s, 1.31 * s, -0.11 * s)), 0.45);
  H = hmax(H, bump(c, vec3(0.085 * s, 0.075 * s, 0.09 * s), 1.0) * P_backT * 0.75, kh * 2.0);
  // upper traps: neck -> acromion slope
  c = rotXY(sub(q, vec3(0.055 * s, 1.462 * s, -0.035 * s)), -0.45);
  H = hmax(H, bump(c, vec3(0.105 * s, 0.05 * s, 0.075 * s), 1.0) * (P_trapT * 0.8 + P_trapH * 0.4), kh * 2.0);
  // mid/lower trap diamond
  vec3 dq = sub(q, vec3(0.0, 1.34 * s, -0.12 * s));
  float dn = pow(pow(abs(dq.x) / (0.095 * s), 1.4) + pow(abs(dq.y) / (0.175 * s), 1.4), 1.0 / 1.4);   // smooth diamond (no creases)
  H = hmax(H, ss(1.0, 0.0, dn) * ss(-0.03 * s, -0.08 * s, q.z) * P_trapT * 0.5, kh * 4.0 + 0.006 * s);
  // erectors (spinal groove between them)
  c = sub(q, vec3(0.03 * s, 1.03 * s, -0.11 * s));
  H = hmax(H, bump(c, vec3(0.026 * s, 0.17 * s, 0.07 * s), ed) * P_erR * 0.6, kh);
  // external obliques
  c = rotXY(sub(q, vec3(P_wstA * 0.86, P_wstY + 0.01 * s, 0.035 * s)), 0.15);
  H = hmax(H, bump(c, vec3(0.045 * s, 0.085 * s, 0.08 * s), ed) * P_oblR * 0.35, kh);
  d -= H;
  // axillary folds: pec + lat bridge to the humerus
  d = smin(d, sdCap(q, vec3(P_ribA * 0.72, P_pecY + 0.005 * s, P_pecZ - 0.012 * s), uPecIns[side], 0.022 * s), 0.03 * s);
  d = smin(d, sdCap(q, vec3(P_latX + 0.01 * s + lf * 0.02 * s, P_latY + 0.09 * s, -0.04 * s), uLatIns[side], 0.023 * s), 0.025 * s);

#ifndef GHOST
  // serratus fingers (lean only)
  if (P_serAmp > 0.01 * s) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec3 sc = rotXY(rotYZ(sub(q, vec3(P_ribA * 0.97 - fi * 0.004 * s, 1.205 * s - fi * 0.03 * s, 0.01 * s - fi * 0.002 * s)), -0.45), 0.4);
      d -= bump(sc, mul(vec3(0.012, 0.011, 0.03), s * (0.8 + 0.3 * P_serAmp / s)), 0.5) * 0.0045 * s * P_def;
    }
  }
  // rectus abdominis: rounded domed segments, linea alba, 3 tendinous intersections, lower block
  if (q.z > 0.0 && q.x < P_absHw * 3.0 && q.y > P_absTop - P_absRow * 6.0 && q.y < P_absTop + P_absRow * 0.8) {
    float yy = (P_absTop - q.y) / P_absRow;
    float yc = clamp(yy, 0.0, 5.5);
    float xr = P_absHw * 2.0 * (1.05 - 0.011 * yc * yc);
    float xn = q.x / xr;
    float yw = yy + 0.2 * xn * xn - 0.06 * xn;
    float lx = (q.x - xr * 0.515) / (xr * 0.5);
    float ly = fract(yw) * 2.0 - 1.0;
    if (yw >= 3.0) { ly = (yw - 4.35) / 1.35; }
    float gw = mix(0.55, 0.24, P_def);
    float e = pow(pow(abs(lx), 2.5) + pow(abs(ly), 2.2), 1.0 / 2.35);
    float ab = ss(1.05, 1.0 - gw, e) * (1.0 - 0.3 * e * e);
    ab *= ss(-0.45, 0.15, yw) * (1.0 - 0.75 * ss(3.6, 5.8, yw));
    d -= P_absAmp * ab;
    d += 0.0055 * s * (1.0 - ss(0.0, 0.009 * s, length(vec3(q.x, q.y - (P_absTop - P_absRow * 3.25), 0.0))));   // navel
  }
  // inguinal "V" lines toward the pubis (visible when lean)
  if (q.z > 0.02 * s && P_def > 0.05) {
    float vl = sdCap(vec3(q.x, q.y, 0.0), vec3(P_wstA * 0.8, 0.578 * P_H, 0.0), vec3(0.035 * s, 0.5 * P_H, 0.0), 0.0);
    d += (1.0 - ss(0.0, 0.012 * s, vl)) * 0.0035 * s * P_def;
  }
#endif

  // fat volumes: lower belly, love handles, lower chest
  if (P_bellyAmp > 0.0001) {
    c = sub(q, vec3(0.0, P_wstY - 0.05 * s, P_wstB * 0.25));
    d = smin(d, sdEll(c, vec3(P_wstA * 0.82, 0.11 * s, P_wstB * 0.78 + P_bellyAmp)), P_kFat);
  }
  if (P_loveAmp > 0.0001) {
    c = sub(q, vec3(P_wstA * 0.86, P_wstY - 0.07 * s, -0.012 * s));
    d = smin(d, sdEll(c, vec3(0.04 * s + P_loveAmp, 0.06 * s, 0.075 * s)), P_kFat);
  }
  if (P_chestFat > 0.0001) {
    c = sub(q, vec3(P_pecCx * 1.05, P_pecY - 0.065 * s, P_pecZ + 0.005 * s));
    d = smin(d, sdEll(c, vec3(P_pecRx * 0.8, 0.05 * s, P_pecT * 0.6 + P_chestFat)), P_kFat);
  }
  return d - P_fatT;
}

// ---- arm (right-arm space; i = 0 right, 1 left mirrored)
float armSdf(vec3 p, int i){
  float s = P_s;
  float bic = uAX[i].y;
  vec3 u = mulVM(sub(p, uAS[i]), uAU[i]);          // upper-arm local: x lateral, y up the bone, z anterior
  float Lu = P_Lu;
  float R = P_armR;
  float d = sdRC(u, vec3(0.0, -0.02 * s, 0.0), vec3(0.0, -Lu, 0.0), 0.024 * s, 0.021 * s);
  float k = P_kSep;
  float dr = P_deltR;
  vec3 c = rotXY(sub(u, vec3(dr * 0.5, -0.042 * s, 0.0)), -0.12);
  float m = sdEll(c, vec3(dr * 0.8, dr * 1.45, dr * 0.98));                                       // side delt
  c = rotXZ(sub(u, vec3(dr * 0.2, -0.04 * s, dr * 0.62)), 0.45);
  m = smin(m, sdEll(c, vec3(dr * 0.6, dr * 1.3, dr * 0.62)), k);                                  // front delt
  c = rotXZ(sub(u, vec3(dr * 0.18, -0.04 * s, -dr * 0.6)), -0.45);
  m = smin(m, sdEll(c, vec3(dr * 0.6, dr * 1.25, dr * 0.6)), k);                                  // rear delt
  float pk = 1.0 + P_bicPk * bic;
  float fk = mix(1.0, P_flexK, bic);              // flexed arm: muscle bellies bunch (girth = relaxed x flex)
  float B = P_bicR * fk;
  float T = P_triR * fk;
  R = R * fk;
  float by = -Lu * (0.57 - 0.07 * bic);
  m = smin(m, sdEll(sub(u, vec3(B * 0.12, by, B * 0.36 * pk)), vec3(B * 0.5, Lu * (0.31 - 0.06 * bic), B * 0.6 * pk)), k);           // biceps long head
  m = smin(m, sdEll(sub(u, vec3(-B * 0.22, by + 0.01 * s, B * 0.3 * pk)), vec3(B * 0.46, Lu * (0.28 - 0.05 * bic), B * 0.55 * pk)), k * 0.8); // short head
  m = smin(m, sdEll(sub(u, vec3(R * 0.5, -Lu * 0.7, 0.0)), vec3(R * 0.42, Lu * 0.17, R * 0.5)), k);                                   // brachialis
  m = smin(m, sdEll(sub(u, vec3(T * 0.36, -Lu * 0.43, -T * 0.32)), vec3(T * 0.52, Lu * 0.27, T * 0.56)), k);                          // triceps lateral
  m = smin(m, sdEll(sub(u, vec3(-T * 0.2, -Lu * 0.5, -T * 0.36)), vec3(T * 0.55, Lu * 0.35, T * 0.6)), k * 0.8);                      // triceps long
  m = smin(m, sdEll(sub(u, vec3(0.0, -Lu * 0.8, -T * 0.36)), vec3(T * 0.48, Lu * 0.17, T * 0.4)), k * 1.4);                           // tendon plate
  d = smin(d, m, k * 1.4);
  d = smin(d, sdEll(sub(u, vec3(0.0, -Lu - 0.004 * s, -0.012 * s)), vec3(0.03 * s, 0.03 * s, 0.026 * s)), 0.02 * s);                 // elbow

  vec3 f = mulVM(sub(p, uAE[i]), uAF[i]);          // forearm: x lateral, y up toward the elbow, z flexor side
  float Lf = P_Lf;
  float F = P_faR;
  float fa = sdRC(f, vec3(0.0, -0.01 * s, -0.004 * s), vec3(0.0, -Lf * 0.5, 0.0), F * 0.86, F * 0.72);
  fa = smin(fa, sdRC(f, vec3(0.0, -Lf * 0.5, 0.0), vec3(0.0, -Lf, 0.0), F * 0.72, P_wristR), 0.02 * s);
  float fm = sdEll(sub(f, vec3(F * 0.42, -Lf * 0.22, F * 0.18)), vec3(F * 0.56, Lf * 0.3, F * 0.56));        // brachioradialis
  fm = smin(fm, sdEll(sub(f, vec3(-F * 0.25, -Lf * 0.28, F * 0.3)), vec3(F * 0.58, Lf * 0.32, F * 0.52)), k); // flexors
  fm = smin(fm, sdEll(sub(f, vec3(F * 0.18, -Lf * 0.3, -F * 0.32)), vec3(F * 0.46, Lf * 0.32, F * 0.42)), k); // extensors
  fa = smin(fa, fm, k * 1.5);
  d = smin(d, fa, 0.022 * s) - P_fatL;

  vec3 h = mulVM(sub(p, uAW[i]), uAH[i]);          // hand: x thumb side, y up the forearm, z palm
  float opn = uAX[i].x;
  float fist = sdEll(sub(h, vec3(0.0, -0.048 * s, 0.012 * s)), vec3(0.043 * s, 0.047 * s, 0.037 * s));
  fist = smin(fist, sdCap(h, vec3(-0.028 * s, -0.082 * s, 0.03 * s), vec3(0.028 * s, -0.082 * s, 0.03 * s), 0.013 * s), 0.012 * s); // knuckle row
  fist = smin(fist, sdCap(h, vec3(0.03 * s, -0.025 * s, 0.026 * s), vec3(0.01 * s, -0.062 * s, 0.043 * s), 0.0105 * s), 0.01 * s);
  float palm = sdRBox(sub(h, vec3(0.0, -0.05 * s, 0.0)), vec3(0.031 * s, 0.037 * s, 0.006 * s), 0.0095 * s);
#ifndef GHOST
  palm = smin(palm, sdCap(h, vec3(0.022 * s, -0.093 * s, 0.002 * s), vec3(0.022 * s, -0.166 * s, 0.026 * s), 0.0096 * s), 0.006 * s); // index
  palm = smin(palm, sdCap(h, vec3(0.0075 * s, -0.096 * s, 0.002 * s), vec3(0.0075 * s, -0.178 * s, 0.03 * s), 0.0098 * s), 0.006 * s); // middle
  palm = smin(palm, sdCap(h, vec3(-0.0075 * s, -0.094 * s, 0.002 * s), vec3(-0.008 * s, -0.17 * s, 0.028 * s), 0.0093 * s), 0.006 * s); // ring
  palm = smin(palm, sdCap(h, vec3(-0.022 * s, -0.089 * s, 0.002 * s), vec3(-0.024 * s, -0.149 * s, 0.022 * s), 0.0083 * s), 0.006 * s); // little
  palm = smin(palm, sdCap(h, vec3(0.028 * s, -0.03 * s, 0.01 * s), vec3(0.036 * s, -0.08 * s, 0.03 * s), 0.0105 * s), 0.012 * s);   // thumb
#endif
#ifdef GHOST
  palm = smin(palm, sdRBox(sub(h, vec3(0.0, -0.13 * s, 0.01 * s)), vec3(0.03 * s, 0.04 * s, 0.006 * s), 0.008 * s), 0.01 * s);
#endif
  d = smin(d, mix(fist, palm, opn), 0.016 * s);
  return d;
}

// ---- leg (mirrored; side picks the leg's uniforms)
float legSdf(vec3 q, int i){
  float s = P_s;
  vec3 t = mulVM(sub(q, uLH[i]), uLT[i]);          // thigh local: x lateral, y up, z anterior
  float Lt = P_Lt;
  float R = P_thR;
  float d = sdRC(t, vec3(0.0, 0.01 * s, -0.01 * s), vec3(0.0, -Lt * 0.55, 0.0), R * 0.84, R * 0.66);
  d = smin(d, sdRC(t, vec3(0.0, -Lt * 0.55, 0.0), vec3(0.0, -Lt, 0.0), R * 0.66, P_kneeR * 0.88), 0.03 * s);
  float k = P_kSep;
  float m = sdEll(sub(t, vec3(R * 0.44, -Lt * 0.46, -R * 0.02)), vec3(R * 0.5 * P_sweep, Lt * 0.42, R * 0.66));     // vastus lateralis
  m = smin(m, sdEll(sub(t, vec3(R * 0.04, -Lt * 0.4, R * 0.44)), vec3(R * 0.46, Lt * 0.44, R * 0.5)), k);          // rectus femoris
  m = smin(m, sdEll(sub(t, vec3(-R * 0.33, -Lt * 0.77, R * 0.17)), vec3(R * 0.29 * P_vmo, Lt * 0.15, R * 0.31)), k * 1.6); // VMO teardrop
  m = smin(m, sdEll(sub(t, vec3(-R * 0.34, -Lt * 0.22, -R * 0.04)), vec3(R * 0.5, Lt * 0.32, R * 0.64)), k * 1.3);  // adductors
  m = smin(m, sdEll(sub(t, vec3(R * 0.02, -Lt * 0.46, -R * 0.4)), vec3(R * 0.62, Lt * 0.42, P_hamR)), k);          // hamstrings
  d = smin(d, m, k * 1.4);
  d = smin(d, sdEll(sub(t, vec3(0.0, -Lt + 0.006 * s, P_kneeR * 0.7)), vec3(0.022 * s, 0.025 * s, 0.013 * s)), 0.014 * s); // patella

  vec3 l = mulVM(sub(q, uLK[i]), uLS[i]);
  float Ls = P_Ls;
  float C = P_calfR;
  float sh = sdRC(l, vec3(0.0, -0.01 * s, -0.004 * s), vec3(0.0, -Ls * 0.62, -0.006 * s), P_kneeR * 0.88, C * 0.6);
  sh = smin(sh, sdRC(l, vec3(0.0, -Ls * 0.62, -0.006 * s), vec3(0.0, -Ls, 0.0), C * 0.6, P_ankleR), 0.03 * s);
  float g = P_gastro;
  float cm = sdEll(sub(l, vec3(-C * 0.32, -Ls * 0.32, -C * 0.4)), vec3(C * 0.56, Ls * 0.25, C * 0.6 * g));          // medial gastrocnemius
  cm = smin(cm, sdEll(sub(l, vec3(C * 0.34, -Ls * 0.28, -C * 0.36)), vec3(C * 0.5, Ls * 0.21, C * 0.54 * g)), k * 0.8); // lateral head
  cm = smin(cm, sdEll(sub(l, vec3(0.0, -Ls * 0.5, -C * 0.2)), vec3(C * 0.64, Ls * 0.28, C * 0.56)), k * 1.3);      // soleus
  cm = smin(cm, sdEll(sub(l, vec3(C * 0.3, -Ls * 0.36, C * 0.32)), vec3(C * 0.34, Ls * 0.32, C * 0.34)), k);       // tibialis anterior
  cm = smin(cm, sdCap(l, vec3(0.0, -Ls * 0.66, -C * 0.34), vec3(0.0, -Ls + 0.02 * s, -C * 0.32), 0.012 * s), k * 2.0); // achilles
  sh = smin(sh, cm, k * 1.4);
  sh = smin(sh, sdEll(sub(l, vec3(0.023 * s, -Ls + 0.004 * s, -0.006 * s)), vec3(0.011 * s, 0.015 * s, 0.013 * s)), 0.01 * s);  // lateral malleolus
  sh = smin(sh, sdEll(sub(l, vec3(-0.021 * s, -Ls + 0.012 * s, 0.0)), vec3(0.011 * s, 0.015 * s, 0.013 * s)), 0.01 * s);        // medial malleolus
  d = smin(d, sh, 0.03 * s) - P_fatL;

  vec3 f = mulVM(sub(q, uLA[i]), uLF[i]);          // foot: origin ankle, z toward the toes, x lateral
  float ft = sdEll(sub(f, vec3(0.0, -0.036 * s, -0.03 * s)), vec3(0.03 * s, 0.034 * s, 0.036 * s));                     // heel
  ft = smin(ft, sdEll(sub(f, vec3(0.004 * s, -0.034 * s, 0.045 * s)), vec3(0.036 * s, 0.033 * s, 0.075 * s)), 0.03 * s); // midfoot / instep
  ft = smin(ft, sdEll(sub(f, vec3(0.002 * s, -0.05 * s, 0.12 * s)), vec3(0.047 * s, 0.021 * s, 0.05 * s)), 0.025 * s);   // ball of the foot
  vec3 tq = rotXZ(sub(f, vec3(-0.002 * s, -0.057 * s, 0.17 * s)), 0.22);
  ft = smin(ft, sdRBox(tq, vec3(0.035 * s, 0.006 * s, 0.022 * s), 0.009 * s), 0.016 * s);                               // toes block
  ft = smax(ft, -sdEll(sub(f, vec3(-0.042 * s, -0.07 * s, 0.05 * s)), vec3(0.018 * s, 0.014 * s, 0.05 * s)), 0.01 * s);  // medial arch
  ft = smax(ft, -(f.y + 0.068 * s), 0.008 * s);                                                                         // flat sole
  d = smin(d, ft, 0.03 * s);
  return d;
}

// ---- composition (bounding volumes skip far parts)
float trunkSdf(vec3 p){
  float s = P_s;
  vec3 q = absX(p);
  int side = p.x >= 0.0 ? 0 : 1;
  float d = 1000.0;
  float bt = sdCap(q, vec3(0.0, 0.84 * s, -0.01 * s), vec3(0.0, 1.45 * s, -0.01 * s), P_shX + 0.13 * s);
  if (bt < 0.06 * s) { d = torsoSdf(q, side); } else { d = bt; }
  float bh = length(sub(q, vec3(0.0, 1.6 * s, 0.0))) - 0.18 * s;
  if (bh < d + 0.04 * s) { d = smin(d, headSdf(q), 0.025 * s); } else { d = min(d, bh); }
  return d;
}
float legsAdd(vec3 p, float d0){
  float s = P_s;
  float d = d0;
  vec3 q = absX(p);
  int side = p.x >= 0.0 ? 0 : 1;
  float bl = sdCap(q, uLH[side], uLA[side], P_thR + 0.05 * s);
  bl = min(bl, length(sub(sub(q, uLA[side]), vec3(0.0, -0.04 * s, 0.07 * s))) - 0.15 * s);
  if (bl < d + 0.05 * s) { d = smin(d, legSdf(q, side), mix(0.016 * s, 0.045 * s, ss(P_crotchY - 0.02 * s, P_hipJY, p.y))); } else { d = min(d, bl); }
  return d;
}
float armsAdd(vec3 p, float d0){
  float s = P_s;
  float d = d0;
  for (int i = 0; i < 2; i++) {
    vec3 a = i == 0 ? p : mirX(p);
    float ba = min(sdCap(a, uAS[i], uAE[i], P_deltR + P_armR + 0.035 * s), sdCap(a, uAE[i], uAW[i], P_faR + 0.03 * s));
    ba = min(ba, length(sub(a, uAW[i])) - 0.2 * s);
    if (ba < d + 0.06 * s) {
      float kk = mix(0.05 * s, 0.012 * s, ss(0.06 * s, 0.16 * s, length(sub(a, uAS[i]))));
      d = smin(d, armSdf(a, i), kk);
    } else { d = min(d, ba); }
  }
  return d;
}
float map(vec3 p0){
  vec3 p = vec3(p0.x, p0.y + P_drop, p0.z);
  float d = trunkSdf(p);
  d = legsAdd(p, d);
  return armsAdd(p, d);
}
`;

const UNAMES = ['uAS', 'uAE', 'uAW', 'uAU', 'uAF', 'uAH', 'uAX', 'uPecIns', 'uLatIns', 'uLH', 'uLK', 'uLA', 'uLT', 'uLS', 'uLF'];

// GLSL-side helpers the dialect relies on (the JS side has the same names in JL below).
const GLSL_HELPERS = `
vec3 add(vec3 a, vec3 b){ return a + b; }
vec3 sub(vec3 a, vec3 b){ return a - b; }
vec3 mul(vec3 a, float b){ return a * b; }
vec3 mul(vec3 a, vec3 b){ return a * b; }
vec3 dv(vec3 a, vec3 b){ return a / b; }
vec3 abs3(vec3 a){ return abs(a); }
vec3 max3(vec3 a, float b){ return max(a, b); }
vec3 mulVM(vec3 v, mat3 m){ return v * m; }
vec3 rotXY(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }
vec3 rotXZ(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.z, v.y, s * v.x + c * v.z); }
vec3 rotYZ(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
vec3 absX(vec3 v){ return vec3(abs(v.x), v.y, v.z); }
vec3 mirX(vec3 v){ return vec3(-v.x, v.y, v.z); }
`;

// ---- JS runtime for the dialect
class V3 { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }
const JL = {
  vec3: (x, y, z) => (y === undefined ? new V3(x, x, x) : new V3(x, y, z)),
  add: (a, b) => new V3(a.x + b.x, a.y + b.y, a.z + b.z),
  sub: (a, b) => new V3(a.x - b.x, a.y - b.y, a.z - b.z),
  mul: (a, b) => (typeof b === 'number' ? new V3(a.x * b, a.y * b, a.z * b) : new V3(a.x * b.x, a.y * b.y, a.z * b.z)),
  dv: (a, b) => new V3(a.x / b.x, a.y / b.y, a.z / b.z),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  length: v => (typeof v === 'number' ? Math.abs(v) : Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)),
  abs: Math.abs, min: (a, b) => (a < b ? a : b), max: (a, b) => (a > b ? a : b), sqrt: Math.sqrt, pow: Math.pow,
  cos: Math.cos, sin: Math.sin, floor: Math.floor, fract: x => x - Math.floor(x),
  clamp: (x, a, b) => (x < a ? a : x > b ? b : x),
  mix: (a, b, t) => (typeof a === 'number' ? a + (b - a) * t : new V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)),
  step: (e, x) => (x < e ? 0 : 1),
  abs3: v => new V3(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)),
  max3: (v, f) => new V3(Math.max(v.x, f), Math.max(v.y, f), Math.max(v.z, f)),
  mulVM: (v, m) => new V3(v.x * m[0] + v.y * m[1] + v.z * m[2], v.x * m[3] + v.y * m[4] + v.z * m[5], v.x * m[6] + v.y * m[7] + v.z * m[8]),
  rotXY: (v, a) => { const c = Math.cos(a), s = Math.sin(a); return new V3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); },
  rotXZ: (v, a) => { const c = Math.cos(a), s = Math.sin(a); return new V3(c * v.x - s * v.z, v.y, s * v.x + c * v.z); },
  rotYZ: (v, a) => { const c = Math.cos(a), s = Math.sin(a); return new V3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); },
  absX: v => new V3(Math.abs(v.x), v.y, v.z),
  mirX: v => new V3(-v.x, v.y, v.z),
  float: x => x,
};
// Transpile the dialect to JS (main-body variant: GHOST-only blocks dropped, non-ghost kept).
function sdfToJS(src) {
  let out = '', skip = 0;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#ifdef GHOST')) { skip++; continue; }
    if (t.startsWith('#ifndef GHOST')) { skip += 0; out += '\n'; continue; }
    if (t.startsWith('#endif')) { if (skip) skip--; continue; }
    if (t.startsWith('#')) continue;
    if (!skip) out += line + '\n';
  }
  out = out.replace(/\b(?:float|vec3|int|void|bool)\s+(\w+)\s*\(([^)]*)\)\s*\{/g,
    (m, name, params) => `function ${name}(${params.split(',').map(x => x.trim().split(/\s+/).pop()).filter(Boolean).join(', ')}) {`);
  out = out.replace(/\b(?:float|vec3|int|bool|mat3)\s+(?=[A-Za-z_]\w*\s*[=;,])/g, 'let ');
  out = out.replace(/\bP_(\w+)/g, '$P.$1');
  return out;
}
let SDFJS = null;
function sdfJS() {
  if (SDFJS) return SDFJS;
  const body = `"use strict"; const {${Object.keys(JL).join(', ')}} = L; let $P = null; let ${UNAMES.join(', ')};
${sdfToJS(SDF_SRC)}
return { setCtx(P, U) { $P = P; ${UNAMES.map(n => `${n} = U.${n};`).join(' ')} }, map, trunkSdf, legsAdd, armsAdd, torsoSdf, headSdf, armSdf, legSdf };`;
  SDFJS = new Function('L', body)(JL);
  return SDFJS;
}

// ---------------------------------------------------------------- measurement (Node-testable)
function rigJS(rig) {
  const a = rig.arms, g = rig.legs;
  const V = v => new V3(v[0], v[1], v[2]);
  return {
    uAS: [V(a[0].S), V(a[1].S)], uAE: [V(a[0].E), V(a[1].E)], uAW: [V(a[0].W), V(a[1].W)],
    uAU: [a[0].U, a[1].U], uAF: [a[0].F, a[1].F], uAH: [a[0].Hd, a[1].Hd],
    uAX: [{ x: a[0].X[0], y: a[0].X[1] }, { x: a[1].X[0], y: a[1].X[1] }],
    uPecIns: [V(a[0].pecIns), V(a[1].pecIns)], uLatIns: [V(a[0].latIns), V(a[1].latIns)],
    uLH: [V(g[0].H), V(g[1].H)], uLK: [V(g[0].K), V(g[1].K)], uLA: [V(g[0].A), V(g[1].A)],
    uLT: [g[0].T, g[1].T], uLS: [g[0].Sh, g[1].Sh], uLF: [g[0].F, g[1].F],
  };
}
function hullPerimeter(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let per = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return per;
}
// Cross-section of fn in the plane through o spanned by ax/az: sphere-trace inward along N rays from R0,
// take the outermost surface point per ray, and return the convex-hull perimeter (a tape bridges hollows).
function section(fn, o, ax, az, R0, N = 64) {
  const pts = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    const dx = ax[0] * ca + az[0] * sa, dy = ax[1] * ca + az[1] * sa, dz = ax[2] * ca + az[2] * sa;
    let r = R0;
    for (let it = 0; it < 120; it++) {
      const d = fn(new V3(o[0] + dx * r, o[1] + dy * r, o[2] + dz * r));
      if (d < 1e-4) {
        const x = r * ca, z = r * sa; pts.push([x, z]);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        break;
      }
      r -= Math.max(d * 0.85, 4e-5);
      if (r <= 0) break;
    }
  }
  return { girth: pts.length > 2 ? hullPerimeter(pts) / IN : 0, width: (maxX - minX) / IN, depth: (maxZ - minZ) / IN };
}
const maxBy = (arr, f) => arr.reduce((b, x) => (f(x) > f(b) ? x : b));
export const GIRTH_KEYS = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'arm', 'armRelaxed', 'forearm', 'thigh', 'calf'];

// Measure every tape landmark on the SAME SDF the shader draws. Returns inches + where it was measured.
export function measureGirths(D, { fine = true } = {}) {
  const J = sdfJS();
  const { P } = D, H = P.H, R = PROPORTIONS;
  const steps = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * (n === 1 ? 0.5 : i / (n - 1)));
  const out = {}, at = {}, widths = {};
  const rel = buildRig(D, poseState('relaxed', D));
  J.setCtx({ ...P, drop: 0, chestUp: rel.chestUp, latFlare: rel.latFlare }, rigJS(rel));
  const horiz = (y, fn, R0) => section(fn, [0, y, -0.01 * P.s], [1, 0, 0], [0, 0, 1], R0);
  const full = p => J.armsAdd(p, J.legsAdd(p, J.trunkSdf(p)));
  const lower = p => J.legsAdd(p, J.trunkSdf(p));
  const pick = (key, ys, fn, R0) => {
    const r = maxBy(ys.map(y => ({ y, ...horiz(y, fn, R0) })), x => x.girth);
    out[key] = r.girth; at[key] = r.y / IN; widths[key] = { width: r.width, depth: r.depth };
  };
  const A = D.A, Lm = A ? A.landmarks : null;
  const yA = (k, frac) => (Lm ? Lm[k].y * IN : frac * H);
  pick('neck', [yA('neck', R.neckGirth)], J.trunkSdf, 0.2 * P.s);
  pick('shoulders', Lm ? [Lm.shoulder.y * IN] : steps(0.765 * H, 0.81 * H, fine ? 5 : 3), full, 0.6 * P.s);
  pick('chest', [yA('chest', R.chest)], J.trunkSdf, 0.45 * P.s);
  pick('waist', [yA('waist', R.navel)], J.trunkSdf, 0.45 * P.s);
  pick('hips', Lm ? [Lm.hip.y * IN] : steps(0.48 * H, 0.54 * H, fine ? 7 : 4), lower, 0.5 * P.s);
  // limbs: perpendicular to the bone, where its axis crosses the landmark height
  const limb = (key, fn, o0, M, ts, R0) => {
    const dir = mul(col(M, 1), -1), ax = col(M, 0), az = col(M, 2);
    const r = maxBy(ts.map(t => ({ t, ...section(fn, add(o0, mul(dir, t)), ax, az, R0) })), x => x.girth);
    out[key] = r.girth; at[key] = (o0[1] + dir[1] * r.t) / IN; widths[key] = { width: r.width, depth: r.depth };
  };
  const tAt = (o0, M, y) => { const dy = -col(M, 1)[1]; return Math.abs(dy) > 1e-3 ? (y - o0[1]) / dy : 0; };
  const ra = rel.arms[0], rl = rel.legs[0];
  limb('forearm', p => J.armSdf(p, 0), ra.E, ra.F, Lm ? [tAt(ra.E, ra.F, Lm.forearm.y * IN)] : steps(0.12 * P.Lf, 0.4 * P.Lf, fine ? 5 : 3), 0.14 * P.s);
  limb('thigh', p => J.legSdf(p, 0), rl.H, rl.T, [Lm ? tAt(rl.H, rl.T, Lm.thigh.y * IN) : P.hipJY - R.thighGirth * H], 0.2 * P.s);
  limb('calf', p => J.legSdf(p, 0), rl.K, rl.Sh, Lm ? [tAt(rl.K, rl.Sh, Lm.calf.y * IN)] : steps(0.2 * P.Ls, 0.48 * P.Ls, fine ? 6 : 3), 0.15 * P.s);
  limb('armRelaxed', p => J.armSdf(p, 0), ra.S, ra.U, [Lm ? tAt(ra.S, ra.U, Lm.arm.y * IN) : 0.5 * P.Lu], 0.16 * P.s);
  // arm: flexed (double-biceps pose) at the peak, as the Measurements screen asks
  const fl = buildRig(D, poseState('front_double_biceps', D));
  J.setCtx({ ...P, drop: 0, chestUp: fl.chestUp, latFlare: fl.latFlare }, rigJS(fl));
  const fa = fl.arms[0];
  limb('arm', p => J.armSdf(p, 0), fa.S, fa.U, steps(0.4 * P.Lu, 0.64 * P.Lu, fine ? 5 : 3), 0.16 * P.s);   // peak region, clear of the folded forearm
  return { girths: out, at, widths };
}

// Vertical landmarks measured on the SDF (relaxed pose), in inches.
export function measureLandmarks(D) {
  const J = sdfJS();
  const { P } = D;
  const rel = buildRig(D, poseState('relaxed', D));
  J.setCtx({ ...P, drop: 0 }, rigJS(rel));
  const full = p => J.armsAdd(p, J.legsAdd(p, J.trunkSdf(p)));
  const ray = (fn, o, dir, maxT) => {           // first hit along a ray
    let t = 0;
    for (let i = 0; i < 400 && t < maxT; i++) {
      const d = fn(new V3(o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t));
      if (d < 1e-4) return t;
      t += Math.max(d * 0.9, 1e-4);
    }
    return null;
  };
  const top = 2.2 * P.s;
  const vertex = top - ray(full, [0, top, -0.01 * P.s], [0, -1, 0], top);
  const acromion = top - ray(full, [P.shX, top, 0], [0, -1, 0], top);
  const crotch = 0.3 * P.H + ray(J.trunkSdf, [0, 0.3 * P.H, -0.005 * P.s], [0, 1, 0], P.H);   // torso floor (thighs may touch below it)
  const ankle = rel.legs[0].A;
  const fx = ankle[0] + 0.002 * P.s, fy = 0.012 * P.s;
  const heel = ray(full, [fx, fy, ankle[2] - 0.3], [0, 0, 1], 0.6);
  const toe = ray(full, [fx, fy, ankle[2] + 0.4], [0, 0, -1], 0.6);
  const sole = ray(full, [ankle[0], -0.2, ankle[2] + 0.04 * P.s], [0, 1, 0], 1);
  const footLen = (0.4 - toe) - (heel - 0.3);
  const a = rel.arms[0];
  return {
    heightIn: D.S.heightIn, vertex: vertex / IN, acromion: acromion / IN, crotch: crotch / IN,
    sole: (sole - 0.2) / IN, foot: footLen / IN,
    chin: (P.headY - 0.123 * P.s) / IN, shoulderJoint: P.shY / IN, knee: rel.legs[0].K[1] / IN, ankle: ankle[1] / IN,
    hipJoint: P.hipJY / IN, upperArm: len(sub(a.E, a.S)) / IN, forearm: len(sub(a.W, a.E)) / IN, hand: 0.1898 * P.s / IN,
  };
}

// Girth targets at anthro's landmarks (= the tape where given). The relaxed-pose forearm is compared with
// anthro's relaxed forearm; the arm is matched flexed (double-biceps pose) like the tape.
export function anthroTargets(A) {
  const L = A.landmarks;
  return { neck: L.neck.girth, shoulders: L.shoulder.girth, chest: L.chest.girth, waist: L.waist.girth, hips: L.hip.girth,
    arm: L.arm.girth, armRelaxed: (L.arm.relaxed || { girth: L.arm.girth / 1.07 }).girth, forearm: (L.forearm.relaxed || L.forearm).girth,
    thigh: L.thigh.girth, calf: L.calf.girth };
}
function solveLinear(A, b) {        // Gaussian elimination with partial pivoting; null if singular
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const GAIN = { neck: 1.15, shoulders: 1.7, chest: 1.35, waist: 1.25, hips: 1.35, arm: 1.3, armRelaxed: 1.15, forearm: 1.2, thigh: 1.1, calf: 1.1 };
const FKEY = { neck: 'neck', shoulders: 'sh', chest: 'chest', waist: 'waist', hips: 'hips', arm: 'pk', armRelaxed: 'arm', forearm: 'fa', thigh: 'thigh', calf: 'calf' };

// Solve the primitive radii so every SDF girth matches the tape. targets default to the (normalized) shape.
export function buildBodyGeometry(shape, muscle, bodyFatPct, { iterations = 9, startF = null, targets = null, tol = 0.005 } = {}) {
  const S = normShape(shape);
  const bf = clamp(num(bodyFatPct) ?? DEF_BF, 4, 45);
  const A = anthroOf(S, normMuscle(muscle), bf);
  const T = { ...S, armRelaxed: S.arm / 1.07, forearm: S.forearm / 1.03, ...(A ? anthroTargets(A) : {}), ...(targets || {}) };
  const F = { ...DEFAULT_F, ...(startF || {}) };
  let D = derive(shape, muscle, bodyFatPct, F, A);
  let m = measureGirths(D);
  // Broyden's method on the 9 coupled factors (girths interact through smooth blends).
  const K = GIRTH_KEYS, n = K.length;
  const fv = () => K.map(k => F[FKEY[k]]);
  const gv = () => K.map(k => m.girths[k]);
  const tv = K.map(k => T[k]);
  let x = fv(), g = gv();
  let J = K.map((k, i) => K.map((_, j) => (i === j ? g[i] / (GAIN[k] * x[i]) : 0)));
  let it = 0;
  const worstOf = gg => Math.max(...K.map((k, i) => Math.abs(gg[i] / tv[i] - 1)));
  let best = { D, m, w: worstOf(g), F: { ...F } };
  const diagJ = (xx, gg) => K.map((k, i) => K.map((_, j) => (i === j ? gg[i] / (GAIN[k] * xx[i]) : 0)));
  let damp = 1;
  for (; it < iterations; it++) {
    if (worstOf(g) < tol) break;
    let dx = solveLinear(J, tv.map((t, i) => t - g[i]));
    if (!dx) dx = K.map((k, i) => x[i] * (Math.pow(tv[i] / g[i], GAIN[k]) - 1));
    const xn = x.map((xi, i) => clamp(xi + dx[i] * damp, Math.max(0.3, xi * 0.85), Math.min(2.5, xi * 1.18)));
    K.forEach((k, i) => { F[FKEY[k]] = xn[i]; });
    D = derive(shape, muscle, bodyFatPct, F, A);
    m = measureGirths(D);
    const gn = gv();
    const s = xn.map((v, i) => v - x[i]), y = gn.map((v, i) => v - g[i]);
    const ss2 = s.reduce((a, v) => a + v * v, 0);
    const w = worstOf(gn);
    if (w < best.w) best = { D, m, w, F: { ...F } };
    if (w > worstOf(g) * 1.15) {
      // got worse: back off to the best point, restart from a diagonal model with a shorter step
      x = K.map(k => best.F[FKEY[k]]); g = K.map(k => best.m.girths[k]);
      K.forEach((k, i) => { F[FKEY[k]] = x[i]; });
      J = diagJ(x, g); damp = Math.max(0.3, damp * 0.6);
      continue;
    }
    if (ss2 > 1e-7) {
      const Js = J.map(row => row.reduce((a, v, j) => a + v * s[j], 0));
      J = J.map((row, i) => row.map((v, j) => v + ((y[i] - Js[i]) * s[j]) / ss2));
    }
    x = xn; g = gn;
  }
  ({ D, m } = best);
  D.measured = m;
  D.iterations = it;
  D.fitError = best.w;
  D.targets = Object.fromEntries(GIRTH_KEYS.map(k => [k, T[k]]));
  return D;
}

// PARAMS = every P_ name the shaders read (auto-extracted so the GLSL and the JS can never drift).
const FRAG_MAIN = String.raw`
vec3 calcNormal(vec3 p, float t){
  float e = max(0.0009, 0.0006 * t);
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}
vec2 boxHit(vec3 ro, vec3 rd){
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv, t1 = (uBoxMax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
float march(vec3 ro, vec3 rd, out float tHit){
  vec2 b = boxHit(ro, rd);
  tHit = -1.0;
  if (b.x > b.y || b.y < 0.0) return 1e9;
  float t = max(b.x, 0.0);
  float best = 1e9;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    best = min(best, d / max(t - b.x + 1.0, 1.0));
    float eps = mix(0.00055 * t, 0.0016, uOrtho);
    if (d < eps) { tHit = t; return best; }
    t += d * 0.8;
    if (t > b.y) break;
  }
  return best;
}
#ifndef GHOST
float calcAO(vec3 p, vec3 n){
  float occ = 0.0, w = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.004 + 0.016 * float(i * i) * 0.25;
    float d = map(p + n * h);
    occ += (h - d) * w;
    w *= 0.62;
  }
  return clamp(1.0 - 9.0 * occ, 0.0, 1.0);
}
float softShadow(vec3 ro, vec3 rd){
  float res = 1.0, t = 0.02;
  for (int i = 0; i < 22; i++) {
    float h = map(ro + rd * t);
    res = min(res, 9.0 * h / t);
    t += clamp(h, 0.012, 0.12);
    if (res < 0.02 || t > 1.2) break;
  }
  return clamp(res, 0.0, 1.0);
}
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 background(vec3 ro, vec3 rd, vec2 uv){
  vec3 bg = vec3(0.0034, 0.0034, 0.0042);
  float r = length(uv * vec2(0.9, 0.75) - vec2(0.0, 0.12));
  vec3 col = bg + vec3(0.03, 0.022, 0.018) * exp(-r * r * 2.6);
  if (rd.y < -0.001) {          // floor: soft key pool + contact occlusion under the feet
    float t = -ro.y / rd.y;
    vec3 fp = ro + rd * t;
    float rr = length(fp.xz * vec2(1.0, 1.3));
    float pool = exp(-rr * rr * 3.5);
    float occ = 0.0;
    if (rr < 0.9) {
      for (int i = 1; i <= 3; i++) {
        float h = 0.03 * float(i * i);
        occ += max(0.0, h - map(fp + vec3(0.0, h, 0.0))) / h;
      }
      occ = clamp(occ / 2.2, 0.0, 1.0);
    }
    col += vec3(0.05, 0.04, 0.034) * pool * (1.0 - occ * 0.95);
    col *= 1.0 - 0.6 * occ * pool;
  }
  return col;
}
#endif
void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamRot * vec3(uv * uTan, 1.0));
  if (uOrtho > 0.5) { ro = uCamPos + uCamRot * vec3(uv * uOrthoH, 0.0); rd = uCamRot * vec3(0.0, 0.0, 1.0); }
  float t;
  float best = march(ro, rd, t);
#ifdef GHOST
  if (t < 0.0) { oCol = vec4(0.0, 1.0, 0.0, 0.0); return; }
  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p, t);
  float fr = pow(1.0 - abs(dot(n, -rd)), 2.6);
  oCol = vec4(0.85 * fr, clamp((t - uDepthNear) / uDepthRange, 0.0, 0.99), 0.0, 1.0);
#else
  vec3 col;
  float depth = 1.0;
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, t);
    vec3 v = -rd;
    float s = P_s;
    vec3 pb = vec3(p.x, p.y + P_drop, p.z);
    // materials: skin / trunks / hair
    float ax = abs(pb.x);
    float legLine = P_crotchY + clamp(ax / max(P_hipA, 0.05), 0.0, 1.3) * 0.085 * s;
    float trunks = ss(P_shortsTop + 0.002, P_shortsTop - 0.002, pb.y) * ss(legLine - 0.002, legLine + 0.002, pb.y);
    trunks *= step(length(pb.xz), 0.4 * s);
    for (int i = 0; i < 2; i++) {      // hands/forearms over the trunks band stay skin
      vec3 a = i == 0 ? pb : mirX(pb);
      if (trunks > 0.0 && sdCap(a, uAS[i], uAW[i], 0.12 * s) < 0.0) trunks *= ss(0.002 * s, 0.008 * s, armSdf(a, i));
    }
    float hair = ss(1.668 * s, 1.678 * s, pb.y + 0.25 * max(0.0, -pb.z + 0.02 * s) - 0.12 * max(0.0, pb.z - 0.05 * s)) * step(1.55 * s, pb.y) * step(ax, 0.1 * s);
    vec3 skin = vec3(0.36, 0.165, 0.09);
    vec3 alb = mix(skin, vec3(0.018, 0.018, 0.022), trunks);
    alb = mix(alb, vec3(0.03, 0.022, 0.018), hair);
    float rough = mix(0.36, 0.7, max(trunks, hair));
    // camera-relative studio lights (the model turns under them)
    vec3 kL = normalize(uCamRot * vec3(0.55, 0.62, -0.58));
    vec3 fL = normalize(uCamRot * vec3(-0.8, 0.15, -0.45));
    vec3 r1 = normalize(uCamRot * vec3(0.85, 0.35, 0.75));
    vec3 r2 = normalize(uCamRot * vec3(-0.9, 0.25, 0.6));
    float ao = calcAO(p, n);
    float sh = softShadow(p + n * 0.003, kL);
    float ndl = dot(n, kL);
    float skinM = 1.0 - max(trunks, hair);
    float wrap = clamp((ndl + 0.22) / 1.22, 0.0, 1.0);
    vec3 col0 = alb * wrap * mix(0.07, 1.0, sh) * vec3(1.0, 0.93, 0.84) * 2.9;
    col0 += alb * vec3(1.0, 0.35, 0.18) * 0.5 * skinM * ss(-0.35, 0.05, ndl) * (1.0 - ss(0.05, 0.5, ndl)) * mix(0.4, 1.0, sh);
    col0 += alb * clamp((dot(n, fL) + 0.15) / 1.15, 0.0, 1.0) * vec3(0.5, 0.58, 0.72) * 0.32 * ao;
    col0 += alb * (0.55 + 0.45 * n.y) * vec3(0.3, 0.3, 0.36) * 0.2 * ao;
    vec3 hv = normalize(kL + v);
    float nh = max(dot(n, hv), 0.0);
    float fres = 0.028 + 0.972 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    float sp = pow(nh, mix(70.0, 14.0, rough)) * 0.55 + pow(nh, 12.0) * 0.08;
    col0 += vec3(1.0, 0.9, 0.8) * sp * (0.3 + fres) * (1.0 - rough * 0.6) * sh * 1.1;
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.4);
    col0 += vec3(1.0, 0.6, 0.36) * rim * max(dot(n, r1), 0.0) * 1.2 * mix(0.4, 1.0, ao);
    col0 += vec3(0.42, 0.6, 1.0) * rim * max(dot(n, r2), 0.0) * 0.85 * mix(0.4, 1.0, ao);
    col0 *= mix(0.35, 1.0, ao);
    col0 *= mix(1.0, ss(0.0, 1.0, ao), 0.35 * P_def);
    col = col0;
    depth = clamp((t - uDepthNear) / uDepthRange, 0.0, 0.99);
  } else {
    col = background(ro, rd, uv);
    col *= mix(0.55, 1.0, ss(0.0, 0.03, best));
  }
  col = aces(col * 1.05);
  col = pow(col, vec3(1.0 / 2.2));
  float vig = 1.0 - 0.35 * dot(uv * 0.55, uv * 0.55);
  col *= vig;
  oCol = vec4(col, depth);
#endif
}`;

export const PARAMS = [...new Set([...(SDF_SRC + FRAG_MAIN).matchAll(/\bP_(\w+)/g)].map(m => m[1]))];
const PIDX = Object.fromEntries(PARAMS.map((n, i) => [n, i]));
const NP4 = Math.ceil(PARAMS.length / 4);

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

function fragSource(ghost) {
  const defs = PARAMS.map((n, i) => `#define P_${n} uP[${i >> 2}].${'xyzw'[i & 3]}`).join('\n');
  return `#version 300 es
precision highp float;
precision highp int;
${ghost ? '#define GHOST 1' : ''}
#define STEPS ${ghost ? 60 : 96}
out vec4 oCol;
uniform vec2 uRes;
uniform vec3 uCamPos; uniform mat3 uCamRot; uniform float uTan;
uniform float uOrtho; uniform float uOrthoH;
uniform vec3 uBoxMin; uniform vec3 uBoxMax;
uniform float uDepthNear; uniform float uDepthRange;
uniform vec4 uP[${NP4}];
uniform vec3 uAS[2]; uniform vec3 uAE[2]; uniform vec3 uAW[2];
uniform mat3 uAU[2]; uniform mat3 uAF[2]; uniform mat3 uAH[2]; uniform vec4 uAX[2];
uniform vec3 uPecIns[2]; uniform vec3 uLatIns[2];
uniform vec3 uLH[2]; uniform vec3 uLK[2]; uniform vec3 uLA[2];
uniform mat3 uLT[2]; uniform mat3 uLS[2]; uniform mat3 uLF[2];
${defs}
${GLSL_HELPERS}
${SDF_SRC}
${FRAG_MAIN}`;
}

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 oCol;
uniform sampler2D uMain; uniform sampler2D uGhost;
uniform vec2 uScale; uniform vec2 uScaleG; uniform vec2 uMaxUv; uniform vec2 uMaxUvG;
uniform float uHasGhost; uniform vec3 uGhostCol; uniform float uDepthRange;
void main(){
  vec4 m = texture(uMain, min(vUv * uScale, uMaxUv));
  vec3 col = m.rgb;
  if (uHasGhost > 0.5) {
    vec4 g = texture(uGhost, min(vUv * uScaleG, uMaxUvG));
    float front = smoothstep(0.008, 0.025, (m.a - g.g) * uDepthRange);   // metres in front of the main body
    col += uGhostCol * g.r * g.a * mix(0.1, 1.0, front);
  }
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  oCol = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- GL helpers
function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh); gl.deleteShader(sh);
    throw new Error('body3d shader: ' + log);
  }
  return sh;
}
function program(gl, vs, fsSrc) {
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const pr = gl.createProgram();
  gl.attachShader(pr, vs); gl.attachShader(pr, fs);
  gl.bindAttribLocation(pr, 0, 'aPos');
  gl.linkProgram(pr);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('body3d link: ' + gl.getProgramInfoLog(pr));
  const loc = {}; const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(pr, i); const nm = u.name.replace(/\[0\]$/, ''); loc[nm] = gl.getUniformLocation(pr, nm); }
  return { pr, loc };
}
function makeTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h };
}

const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrapPI = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// solved geometry cache (shape+muscle+bf -> calibrated D), shared by all viewers
const GEO_CACHE = new Map();
const geoKey = (shape, muscle, bf) => JSON.stringify([normShape(shape), normMuscle(muscle), clamp(num(bf) ?? DEF_BF, 4, 45)]);
function cachedGeometry(shape, muscle, bf) { return GEO_CACHE.get(geoKey(shape, muscle, bf)) || null; }
function solveGeometry(shape, muscle, bf, startF) {
  const key = geoKey(shape, muscle, bf);
  let D = GEO_CACHE.get(key);
  if (!D) {
    D = buildBodyGeometry(shape, muscle, bf, { startF, iterations: 5, tol: 0.005 });
    GEO_CACHE.set(key, D);
    if (GEO_CACHE.size > 40) GEO_CACHE.delete(GEO_CACHE.keys().next().value);
  }
  return D;
}
// ---------------------------------------------------------------- mount
export function mountBody3D(el, opts = {}) {
  let o = { pose: 'relaxed', compareShape: null, autoRotate: false, height: 360, showPoses: true, showScale: false, projection: 'perspective', ...opts };
  const root = document.createElement('div');
  root.className = 'b3d';
  root.innerHTML = `<div class="b3d-stage" style="height:${Math.round(o.height)}px"><canvas class="b3d-canvas" aria-label="3D physique model. Drag to rotate."></canvas><canvas class="b3d-ruler" aria-hidden="true"></canvas>
    <div class="b3d-hint">Drag to rotate · pinch to zoom</div><div class="b3d-label"></div></div>
    ${o.showPoses ? `<div class="b3d-poses" role="tablist">${POSES.map(p => `<button type="button" class="b3d-chip" data-pose="${p}">${POSE_LABEL[p]}</button>`).join('')}</div>` : ''}`;
  el.appendChild(root);
  const stage = root.querySelector('.b3d-stage');
  const canvas = root.querySelector('.b3d-canvas');
  const rulerCv = root.querySelector('.b3d-ruler');
  const hintEl = root.querySelector('.b3d-hint');
  const labelEl = root.querySelector('.b3d-label');
  const chips = [...root.querySelectorAll('.b3d-chip')];

  let gl = null, vs = null, progMain = null, progGhost = null, progComp = null, vbo = null, vao = null;
  let tMain = null, tGhost = null;
  let W = 1, Hh = 1;                  // full drawing-buffer size (css * dpr cap)
  let scale = 0.6;                    // adaptive render scale
  let dead = false, lost = false;
  let D = null, DG = null;            // derived params for main / ghost
  let poseName = POSES.includes(o.pose) ? o.pose : 'relaxed';
  let poseFrom = null, poseT0 = 0, posing = false;
  const POSE_MS = 420;
  const cam = { yaw: 0.28, pitch: 0.05, zoom: 1, vy: 0, vp: 0 };
  let camAnim = null;                 // { from, to, t0, dur }
  let raf = 0, lastFrame = 0, emaDt = 0, lastScaleChange = 0, refineTimer = 0, refined = false;
  let frames = 0, fpsT0 = performance.now(), fps = 0, lastRenderMs = 0;
  let visible = true, interacting = false, fixedScale = 0;

  function setLabel() { labelEl.textContent = o.label || ''; labelEl.style.display = o.label ? '' : 'none'; }
  setLabel();
  function syncChips() { chips.forEach(c => { const on = c.dataset.pose === poseName; c.classList.toggle('on', on); c.setAttribute('aria-selected', on); }); }
  syncChips();

  // Geometry: render immediately with the last solved factors, then solve the tape fit off the
  // interaction path (debounced) and re-render. Solved bodies are cached.
  let lastF = { ...DEFAULT_F }, calTimer = 0;
  const ghostArgs = () => { const cs = o.compareShape; return [cs, cs.muscle || o.compareMuscle || o.muscle, num(cs.bodyFatPct) ?? num(o.compareBodyFatPct) ?? o.bodyFatPct]; };
  function deriveAll() {
    D = cachedGeometry(o.shape, o.muscle, o.bodyFatPct) || derive(o.shape, o.muscle, o.bodyFatPct, lastF);
    DG = o.compareShape ? (cachedGeometry(...ghostArgs()) || derive(...ghostArgs(), lastF)) : null;
    clearTimeout(calTimer);
    if (!D.measured || (DG && !DG.measured)) calTimer = setTimeout(calibrate, D.measured ? 60 : 140);
  }
  function calibrate() {
    if (dead) return;
    try {
      D = solveGeometry(o.shape, o.muscle, o.bodyFatPct, lastF);
      lastF = { ...D.F };
      if (o.compareShape) DG = solveGeometry(...ghostArgs(), lastF);
    } catch (err) { console.warn('body3d: tape calibration unavailable', err); }
    requestRender();
  }
  deriveAll();
  const stateNow = (Dx, now) => {
    const target = poseState(poseName, Dx);
    if (!posing || !poseFrom) return target;
    const t = clamp((now - poseT0) / POSE_MS, 0, 1);
    const e = easeIO(t);
    const st = lerpState(poseFrom, target, e);
    // arc the hands forward mid-transition so they swing around the torso instead of through it
    const arc = Math.sin(Math.PI * e) * 0.1 * Dx.s;
    st.rT = add(st.rT, v3(0.02 * Dx.s * Math.sin(Math.PI * e), 0, arc)); st.lT = add(st.lT, v3(0.02 * Dx.s * Math.sin(Math.PI * e), 0, arc));
    return st;
  };
  {
    const st = poseState(poseName, D);
    cam.yaw = st.yaw; cam.pitch = st.pitch;
  }
  let curState = poseState(poseName, D);

  // ---------------- GL init
  function initGL() {
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    vs = compile(gl, gl.VERTEX_SHADER, VERT);
    progMain = program(gl, vs, fragSource(false));
    progComp = program(gl, vs, COMPOSITE);
    progGhost = null;
    vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    tMain = tGhost = null;
    resize(true);
  }
  function ensureGhost() {
    if (!progGhost && gl && !lost) progGhost = program(gl, vs, fragSource(true));
  }
  function freeTargets() {
    for (const t of [tMain, tGhost]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    tMain = tGhost = null;
  }
  function resize(force) {
    if (!gl || lost) return;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round(r.width * dpr)), h = Math.max(64, Math.round(r.height * dpr));
    if (!force && w === W && h === Hh && tMain) return;
    W = w; Hh = h;
    canvas.width = w; canvas.height = h;
    freeTargets();
    tMain = makeTarget(gl, w, h);
    tGhost = makeTarget(gl, w, h);
    requestRender();
  }

  // ---------------- uniforms
  function setBody(prog, Dx, rig) {
    const L = prog.loc;
    const P = { ...Dx.P, drop: rig.drop, chestUp: rig.chestUp, latFlare: rig.latFlare };
    const arr = new Float32Array(NP4 * 4);
    for (const n of PARAMS) arr[PIDX[n]] = P[n];
    gl.uniform4fv(L.uP, arr);
    const a = rig.arms, g = rig.legs;
    gl.uniform3fv(L.uAS, [...a[0].S, ...a[1].S]);
    gl.uniform3fv(L.uAE, [...a[0].E, ...a[1].E]);
    gl.uniform3fv(L.uAW, [...a[0].W, ...a[1].W]);
    gl.uniformMatrix3fv(L.uAU, false, [...a[0].U, ...a[1].U]);
    gl.uniformMatrix3fv(L.uAF, false, [...a[0].F, ...a[1].F]);
    gl.uniformMatrix3fv(L.uAH, false, [...a[0].Hd, ...a[1].Hd]);
    gl.uniform4fv(L.uAX, [...a[0].X, ...a[1].X]);
    gl.uniform3fv(L.uPecIns, [...a[0].pecIns, ...a[1].pecIns]);
    gl.uniform3fv(L.uLatIns, [...a[0].latIns, ...a[1].latIns]);
    gl.uniform3fv(L.uLH, [...g[0].H, ...g[1].H]);
    gl.uniform3fv(L.uLK, [...g[0].K, ...g[1].K]);
    gl.uniform3fv(L.uLA, [...g[0].A, ...g[1].A]);
    gl.uniformMatrix3fv(L.uLT, false, [...g[0].T, ...g[1].T]);
    gl.uniformMatrix3fv(L.uLS, false, [...g[0].Sh, ...g[1].Sh]);
    gl.uniformMatrix3fv(L.uLF, false, [...g[0].F, ...g[1].F]);
  }
  function boxFor(rigs, s) {
    const mn = [-0.3 * s, -0.01, -0.3 * s], mx = [0.3 * s, 1.8 * s, 0.32 * s];
    for (const rig of rigs) {
      for (let i = 0; i < 2; i++) {
        const a = rig.arms[i];
        for (const pt of [a.S, a.E, a.W]) {
          const w = [i === 0 ? pt[0] : -pt[0], pt[1] - rig.drop, pt[2]];
          for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k] - 0.13 * s); mx[k] = Math.max(mx[k], w[k] + 0.13 * s); }
        }
      }
      for (const lg of rig.legs) for (const pt of [lg.K, lg.A]) {
        for (const sg of [1, -1]) {
          const w = [pt[0] * sg, pt[1] - rig.drop, pt[2]];
          for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k] - 0.16 * s); mx[k] = Math.max(mx[k], w[k] + 0.16 * s); }
        }
      }
    }
    mn[1] = Math.max(mn[1], -0.01); mx[1] = Math.max(mx[1], 1.8 * s);
    return { mn, mx };
  }
  function camera(s, aspect) {
    s = Math.max(s, DG ? DG.s : 0);
    const tanV = Math.tan((28 * Math.PI / 180) / 2);
    const halfH = 1.04 * s, halfW = 0.66 * s;
    const dist = Math.max(halfH / tanV, halfW / (tanV * aspect)) / cam.zoom;
    const target = v3(0, 0.87 * s + Math.min(1, cam.zoom - 1) * 0.42 * s + (cam.ty || 0) * s, 0);
    const cp = Math.cos(cam.pitch);
    const pos = add(target, v3(Math.sin(cam.yaw) * cp * dist, Math.sin(cam.pitch) * dist, Math.cos(cam.yaw) * cp * dist));
    const fwd = norm(sub(target, pos));
    const right = norm(cross(fwd, v3(0, 1, 0)));
    const up = cross(right, fwd);
    return { pos, rot: [...right, ...up, ...fwd], tanV, dist, target, right, up, fwd, ortho: o.projection === 'ortho', orthoH: dist * tanV };
  }

  // ---------------- render
  function render(now) {
    if (!gl || lost || !tMain) return;
    const t0 = performance.now();
    curState = stateNow(D, now);
    const rig = buildRig(D, curState);
    const rigG = DG ? buildRig(DG, stateNow(DG, now)) : null;
    const vw = Math.max(32, Math.round(W * scale)), vh = Math.max(32, Math.round(Hh * scale));
    const c = camera(D.s, W / Hh);
    const box = boxFor(rigG ? [rig, rigG] : [rig], Math.max(D.s, DG ? DG.s : 0));
    const near = c.dist - 0.9 * D.s, range = 1.8 * D.s;
    const common = (pr) => {
      const L = pr.loc;
      gl.uniform2f(L.uRes, vw, vh);
      gl.uniform3fv(L.uCamPos, c.pos);
      gl.uniformMatrix3fv(L.uCamRot, false, c.rot);
      gl.uniform1f(L.uTan, c.tanV);
      gl.uniform1f(L.uOrtho, c.ortho ? 1 : 0); gl.uniform1f(L.uOrthoH, c.orthoH);
      gl.uniform3fv(L.uBoxMin, box.mn); gl.uniform3fv(L.uBoxMax, box.mx);
      gl.uniform1f(L.uDepthNear, near); gl.uniform1f(L.uDepthRange, range);
    };
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    // main body
    gl.bindFramebuffer(gl.FRAMEBUFFER, tMain.fb);
    gl.viewport(0, 0, vw, vh);
    gl.useProgram(progMain.pr);
    common(progMain); setBody(progMain, D, rig);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // ghost
    let gw = 0, gh = 0;
    if (rigG) {
      ensureGhost();
      gw = Math.max(32, Math.round(vw * 0.75)); gh = Math.max(32, Math.round(vh * 0.75));
      gl.bindFramebuffer(gl.FRAMEBUFFER, tGhost.fb);
      gl.viewport(0, 0, gw, gh);
      gl.useProgram(progGhost.pr);
      common(progGhost); gl.uniform2f(progGhost.loc.uRes, gw, gh);
      setBody(progGhost, DG, rigG);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // composite to canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, Hh);
    gl.useProgram(progComp.pr);
    const L = progComp.loc;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tMain.tex); gl.uniform1i(L.uMain, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tGhost.tex); gl.uniform1i(L.uGhost, 1);
    gl.uniform2f(L.uScale, vw / W, vh / Hh);
    gl.uniform2f(L.uMaxUv, (vw - 0.5) / W, (vh - 0.5) / Hh);
    gl.uniform2f(L.uScaleG, gw / W, gh / Hh);
    gl.uniform2f(L.uMaxUvG, (gw - 0.5) / W, (gh - 0.5) / Hh);
    gl.uniform1f(L.uHasGhost, rigG ? 1 : 0);
    gl.uniform3f(L.uGhostCol, 0.55, 0.78, 1.0);
    gl.uniform1f(L.uDepthRange, range);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    lastCam = c;
    drawRuler(c, rig);
    lastRenderMs = performance.now() - t0;
    frames++;
    if (now - fpsT0 > 1000) { fps = frames * 1000 / (now - fpsT0); frames = 0; fpsT0 = now; }
  }

  // world point -> css px inside the stage (same projection as the shader)
  let lastCam = null;
  function project(c, pt) {
    const r = stage.getBoundingClientRect();
    const v = sub(pt, c.pos);
    const xc = dot(v, c.right), yc = dot(v, c.up), zc = dot(v, c.fwd);
    const ux = c.ortho ? xc / c.orthoH : xc / (zc * c.tanV), uy = c.ortho ? yc / c.orthoH : yc / (zc * c.tanV);
    return [(ux * r.height + r.width) / 2, r.height - (uy * r.height + r.height) / 2];
  }
  // ft/in height ruler beside the body (same world scale for now/projected bodies)
  function drawRuler(c, rig) {
    const show = !!o.showScale;
    rulerCv.style.display = show ? '' : 'none';
    if (!show) return;
    const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (rulerCv.width !== w || rulerCv.height !== h) { rulerCv.width = w; rulerCv.height = h; }
    const g = rulerCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    const heightIn = D.S.heightIn;
    const maxIn = Math.ceil(Math.max(heightIn, DG ? DG.S.heightIn : 0) / 6) * 6 + 6;
    const x0 = 22;
    const yAt = inch => project(c, [0, inch * IN, 0])[1];
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(141,141,154,.55)';
    g.fillStyle = 'rgba(141,141,154,.85)';
    g.font = '600 10px -apple-system, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.beginPath(); g.moveTo(x0 + 0.5, yAt(0)); g.lineTo(x0 + 0.5, yAt(maxIn)); g.stroke();
    for (let i = 0; i <= maxIn; i++) {
      const y = Math.round(yAt(i)) + 0.5;
      const L = i % 12 === 0 ? 10 : i % 6 === 0 ? 7 : 3.5;
      g.beginPath(); g.moveTo(x0 - L, y); g.lineTo(x0 + 0.5, y); g.stroke();
      if (i % 12 === 0 && i > 0) { g.textAlign = 'left'; g.fillText(`${i / 12}'`, x0 + 4, y); }
    }
    // stature marker
    const yH = Math.round(yAt(heightIn)) + 0.5, xb = project(c, [0, heightIn * IN, 0])[0];
    g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,182,72,.55)';
    g.beginPath(); g.moveTo(x0, yH); g.lineTo(Math.max(x0 + 40, xb - 30), yH); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,182,72,.95)'; g.textAlign = 'left';
    g.fillText(`${Math.floor(heightIn / 12)}'${Math.round(heightIn % 12)}"`, x0 + 4, yH - 8);
  }

  function animating(now) {
    return posing || !!camAnim || interacting || Math.abs(cam.vy) > 0.0004 || Math.abs(cam.vp) > 0.0004 || (o.autoRotate && visible && !document.hidden);
  }
  function frame(now) {
    raf = 0;
    if (dead || lost) return;
    const fresh = !lastFrame;               // first frame after idle: no pacing information
    const dt = fresh ? 16.7 : now - lastFrame;
    lastFrame = now;
    // step animations
    if (posing && now - poseT0 >= POSE_MS) { posing = false; poseFrom = null; }
    if (camAnim) {
      const t = clamp((now - camAnim.t0) / camAnim.dur, 0, 1), e = easeIO(t);
      cam.yaw = camAnim.from.yaw + camAnim.dy * e;
      cam.pitch = mix(camAnim.from.pitch, camAnim.to.pitch, e);
      cam.zoom = mix(camAnim.from.zoom, camAnim.to.zoom, e);
      if (t >= 1) camAnim = null;
    }
    if (!interacting) {
      const k = Math.min(dt, 50);
      cam.yaw += cam.vy * k; cam.pitch = clamp(cam.pitch + cam.vp * k, -0.22, 0.42);
      const decay = Math.pow(0.0035, k / 1000);
      cam.vy *= decay; cam.vp *= decay;
    }
    if (o.autoRotate && !interacting && !camAnim && visible && !document.hidden) cam.yaw += dt * 0.00035;
    // adaptive resolution from frame pacing (only meaningful while continuously animating)
    const cont = animating(now);
    if (fixedScale) scale = fixedScale;
    else if (!fresh && cont && !document.hidden) {
      const d = Math.min(dt, 150);
      emaDt = emaDt ? emaDt * 0.75 + d * 0.25 : d;
      if (now - lastScaleChange > 300) {
        if (emaDt > 36 && scale > 0.4) { scale = Math.max(0.4, scale - (emaDt > 70 ? 0.2 : 0.1)); lastScaleChange = now; emaDt = 0; }
        else if (emaDt < 21 && scale < 1.0) { scale = Math.min(1.0, scale + 0.05); lastScaleChange = now; }
      }
    }
    refined = false;
    render(now);
    if (cont) schedule();
    else {
      lastFrame = 0;
      clearTimeout(refineTimer);
      if (scale < 0.85 && !fixedScale) refineTimer = setTimeout(refine, 160);
    }
  }
  function refine() {
    if (dead || lost || raf || refined) return;
    const keep = scale;
    scale = Math.min(1, Math.max(scale, 0.85));
    render(performance.now());
    scale = keep; refined = true;
  }
  function schedule() { if (!raf && !dead) raf = requestAnimationFrame(frame); }
  function requestRender() { clearTimeout(refineTimer); schedule(); }

  // ---------------- interaction
  const ptrs = new Map();
  let lastTap = 0, tapStart = null, pinch0 = 0, zoom0 = 1, lastMoveT = 0;
  function hideHint() { if (hintEl) hintEl.classList.add('gone'); }
  const onDown = e => {
    canvas.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    interacting = true; camAnim = null; cam.vy = cam.vp = 0;
    if (ptrs.size === 1) tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = cam.zoom; tapStart = null; }
    lastMoveT = performance.now();
    hideHint(); requestRender();
  };
  const onMove = e => {
    const pr = ptrs.get(e.pointerId); if (!pr) return;
    const now = performance.now();
    const dx = e.clientX - pr.x, dy = e.clientY - pr.y;
    pr.x = e.clientX; pr.y = e.clientY;
    if (ptrs.size === 1) {
      const dtm = Math.max(8, now - lastMoveT);
      const ry = dx * 0.0105, rp = dy * 0.004;
      cam.yaw -= ry; cam.pitch = clamp(cam.pitch + rp, -0.22, 0.42);
      cam.vy = mix(cam.vy, -ry / dtm, 0.6); cam.vp = mix(cam.vp, rp / dtm, 0.6);
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) cam.zoom = clamp(zoom0 * dd / pinch0, 0.8, 2.6);
    }
    if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 10) tapStart = null;
    lastMoveT = now;
    requestRender();
  };
  const onUp = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    const now = performance.now();
    if (ptrs.size === 0) {
      interacting = false;
      if (now - lastMoveT > 80) { cam.vy = 0; cam.vp = 0; }
      if (tapStart && now - tapStart.t < 300) {
        if (now - lastTap < 320) { resetView(); lastTap = 0; } else lastTap = now;
      }
      tapStart = null;
    } else if (ptrs.size === 1) { pinch0 = 0; }
    requestRender();
  };
  const onWheel = e => {
    e.preventDefault();
    cam.zoom = clamp(cam.zoom * Math.exp(-e.deltaY * 0.0015), 0.8, 2.6);
    camAnim = null; hideHint(); requestRender();
  };
  const onDbl = e => { e.preventDefault(); resetView(); };
  function turnTo(target, dur = 650) {
    const from = { yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom };
    const dy = wrapPI(target.yaw - cam.yaw);
    cam.vy = cam.vp = 0;
    camAnim = { from, to: target, dy, t0: performance.now(), dur };
    requestRender();
  }
  function resetView() { const st = poseState(poseName, D); turnTo({ yaw: st.yaw, pitch: st.pitch, zoom: 1 }); }
  function setPose(name) {
    if (!POSES.includes(name) || dead) return;
    const now = performance.now();
    poseFrom = stateNow(D, now);
    poseName = name; poseT0 = now; posing = true;
    syncChips();
    const st = poseState(name, D);
    turnTo({ yaw: st.yaw, pitch: st.pitch, zoom: cam.zoom }, 700);
  }
  const onChip = e => {
    const b = e.target.closest('.b3d-chip'); if (!b) return;
    setPose(b.dataset.pose); hideHint();
    if (typeof o.onPose === 'function') o.onPose(b.dataset.pose);
  };
  const onLost = e => { e.preventDefault(); lost = true; if (raf) cancelAnimationFrame(raf); raf = 0; };
  const onRestored = () => { lost = false; try { initGL(); requestRender(); } catch (err) { console.error(err); } };
  const onVis = () => { if (!document.hidden) requestRender(); };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  document.addEventListener('visibilitychange', onVis);
  root.addEventListener('click', onChip);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize(false)) : null;
  if (ro) ro.observe(stage); else window.addEventListener('resize', resize);
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => { visible = es.some(x => x.isIntersecting); if (visible) requestRender(); }) : null;
  if (io) io.observe(stage);

  try { initGL(); } catch (err) {
    console.error(err);
    root.classList.add('b3d-failed');
  }
  requestRender();

  return {
    canvas,
    update(next = {}) {
      if (dead) return;
      const shapeChanged = 'shape' in next || 'muscle' in next || 'bodyFatPct' in next || 'compareShape' in next || 'compareMuscle' in next || 'compareBodyFatPct' in next;
      o = { ...o, ...next };
      if ('height' in next) { stage.style.height = Math.round(o.height) + 'px'; resize(false); }
      if ('label' in next) setLabel();
      if (shapeChanged) deriveAll();
      if ('showScale' in next || 'projection' in next) requestRender();
      if ('pose' in next && next.pose !== poseName) setPose(next.pose);
      requestRender();
    },
    setPose,
    getPose: () => poseName,
    // test hooks (demo harness / screenshots)
    _view(v = {}) { hideHint(); camAnim = null; cam.vy = cam.vp = 0; Object.assign(cam, v); requestRender(); },
    _scale(v, lock = false) { scale = clamp(v, 0.25, 1); if (lock) { fixedScale = scale; } requestRender(); },
    geometry: () => (D ? { girths: D.measured ? D.measured.girths : null, targets: D.targets || null, heightIn: D.S.heightIn, solved: !!D.measured } : null),
    stats: () => ({ fps: Math.round(fps * 10) / 10, scale, lastRenderMs: Math.round(lastRenderMs * 10) / 10, emaDt: Math.round(emaDt * 10) / 10, width: W, height: Hh }),
    destroy() {
      if (dead) return;
      dead = true;
      if (raf) cancelAnimationFrame(raf); raf = 0;
      clearTimeout(refineTimer); clearTimeout(calTimer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', onVis);
      root.removeEventListener('click', onChip);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      if (io) io.disconnect();
      if (gl && !gl.isContextLost()) {
        freeTargets();
        for (const p of [progMain, progGhost, progComp]) if (p) gl.deleteProgram(p.pr);
        if (vs) gl.deleteShader(vs);
        if (vbo) gl.deleteBuffer(vbo);
        if (vao) gl.deleteVertexArray(vao);
        const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      }
      gl = null;
      root.remove();
    },
  };
}
// test hooks
export const _sdfJS = () => sdfJS();
export function _setRelaxed(D) { const rel = buildRig(D, poseState('relaxed', D)); sdfJS().setCtx({ ...D.P, drop: 0 }, rigJS(rel)); return rel; }
export const _derive = derive;
