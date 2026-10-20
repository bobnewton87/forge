// MESH renderer: arm landmark heights vs anthropometric norms, and the realism / integrity of every pose.
//
// Upper-arm audit (MESH-4, Bob: "default shoulder-joint-to-elbow lengths seem too long"). Measured on the fitted,
// skinned mesh (independent of the renderer's own helpers), 69 in defaults:
//   joints sit exactly on anthro's: shoulder 54.63 (0.792 H), elbow 43.47 (0.630 H), wrist 33.46 (0.485 H);
//   shoulder→elbow joint distance 11.20–11.23 in = anthro's joint-centre bone (tape acromion→olecranon 14.3 in).
//   Top of the shoulder 56.8 in = 0.823 H (bony acromion 0.818 H + ~5 mm soft tissue), elbow crease 0.62–0.635 H.
//   The genuine error was the HAND: the base mesh's bind hand is flexed ~15° toward the palm and the fingers were
//   curled, so the fingertip hung at 0.394–0.397 H instead of ≈ 0.38 H (D&C 0.377 H). The forearm + hand read
//   1.1 in short, which made the upper arm look long (acromion→elbow / elbow→fingertip 0.82–0.84 vs the norm
//   0.188 / 0.253 = 0.74). Now the wrist is put on the forearm axis with a soft finger cascade: fingertip
//   0.384–0.387 H, ratio 0.78–0.80 (the rest is the natural 13–18° elbow bend and curled fingers).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeBodyAsset, fitBody, skinMatrices, skinPositions, sliceHull, poseGlobals, poseEase, POSE_MS, POSES, POSE_SPECS } from '../js/ui/body3d-mesh.js';

const dir = new URL('../assets/body/', import.meta.url);
const meta = JSON.parse(fs.readFileSync(fileURLToPath(new URL('body.json', dir)), 'utf8'));
const bin = fs.readFileSync(fileURLToPath(new URL('body.bin', dir)));
const A = decodeBodyAsset(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const P = A.part, T = A.tris, B = A.B, REPORT = !!process.env.MESH_REPORT;

const BODIES = {
  default69: {},
  bob: { shape: { heightIn: 69, neck: 15, shoulders: 46, chest: 39, waist: 34.5, hips: 38, arm: 13.5, forearm: 11.5, thigh: 22, calf: 14.5 }, bodyFatPct: 19 },
  tallLean: { shape: { heightIn: 73, neck: 16.5, shoulders: 51, chest: 44, waist: 33, hips: 39.5, arm: 15.5, forearm: 12.5, thigh: 24, calf: 15.5 }, bodyFatPct: 11,
    muscle: { chest: 0.8, delts: 0.8, lats: 0.75, arms: 0.8, abs: 0.7, quads: 0.7, calves: 0.6, traps: 0.7 } },
  shortHeavy: { shape: { heightIn: 66, neck: 16, shoulders: 45, chest: 42, waist: 40, hips: 41, arm: 13, forearm: 11, thigh: 24, calf: 15.5 }, bodyFatPct: 29 },
};
const fits = {}; for (const [k, b] of Object.entries(BODIES)) fits[k] = fitBody(A, b);
const ctxOf = f => ({ A, rest: f.heads, frames: f.frames, geom: f.geom, sections: f.sections, joints: f.joints });
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = v => Math.hypot(v[0], v[1], v[2]);
const deg = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / len(u) / len(v)))) * 180 / Math.PI;
const pct = (a, b) => (a / b - 1) * 100;

// posed mesh, floored at the lowest body vertex (what the renderer shows)
function posed(fit, name) {
  const pose = name === 'fit' ? fit.relax : poseGlobals(ctxOf(fit), name);
  const { M, J } = skinMatrices(A, fit.heads, pose);
  const pos = skinPositions(A, fit.rest, M);
  let y0 = Infinity; for (let i = 0; i < A.nMesh; i++) if (P[i] !== 6) y0 = Math.min(y0, pos[i * 3 + 1]);
  for (let i = 0; i < A.nMesh; i++) pos[i * 3 + 1] -= y0;
  return { pos, J: J.map(j => [j[0], j[1] - y0, j[2]]), pose, y0 };
}
// orthographic side raster of one arm (z–y): the elbow crease is the deepest concavity of the anterior profile
function creaseY(pos, k, Ey) {
  const res = 0.05, z0 = -10, y0 = Ey - 4, W = 400, H = 160, g = new Uint8Array(W * H);
  for (let t = 0; t < T.length; t += 3) {
    const ids = [T[t], T[t + 1], T[t + 2]]; if (!ids.every(i => P[i] === k)) continue;
    const q = ids.map(i => [(pos[i * 3 + 2] - z0) / res, (pos[i * 3 + 1] - y0) / res]);
    const ed = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]), ar = ed(q[0], q[1], q[2][0], q[2][1]); if (Math.abs(ar) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(...q.map(p => p[1])))); y <= Math.min(H - 1, Math.ceil(Math.max(...q.map(p => p[1])))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(...q.map(p => p[0])))); x <= Math.min(W - 1, Math.ceil(Math.max(...q.map(p => p[0])))); x++) {
        const w0 = ed(q[1], q[2], x + 0.5, y + 0.5) / ar, w1 = ed(q[2], q[0], x + 0.5, y + 0.5) / ar;
        if (w0 >= -0.02 && w1 >= -0.02 && 1 - w0 - w1 >= -0.02) g[y * W + x] = 1;
      }
  }
  const front = Array.from({ length: H }, (_, y) => { for (let x = W - 1; x >= 0; x--) if (g[y * W + x]) return x; return -1; });
  const kk = Math.round(1.5 / res); let best = Infinity, cy = null;
  for (let y = kk; y < H - kk; y++) {
    if (front[y] < 0 || front[y - kk] < 0 || front[y + kk] < 0 || Math.abs(y0 + (y + 0.5) * res - Ey) > 2.5) continue;
    const d = front[y] - (front[y - kk] + front[y + kk]) / 2; if (d < best) { best = d; cy = y0 + (y + 0.5) * res; }
  }
  return cy;
}
function armHeights(fit, name) {
  const { pos, J } = posed(fit, name), H = fit.geom.heightIn, out = {};
  for (const [s, k] of [['L', 2], ['R', 3]]) {
    const S = J[B['uarm1' + s]], E = J[B['farm1' + s]], W = J[B['hand' + s]];
    let tip = Infinity, acr = -Infinity;
    const sg = s === 'L' ? 1 : -1;
    for (let i = 0; i < A.nMesh; i++) {
      if (P[i] === k) tip = Math.min(tip, pos[i * 3 + 1]);
      // top of the shoulder: highest torso/arm surface over the joint's lateral edge (acromion)
      const dx = (pos[i * 3] - S[0]) * sg;
      if ((P[i] === 0 || P[i] === k) && dx > -0.1 && dx < 0.7 && Math.abs(pos[i * 3 + 2] - S[2]) < 1.2) acr = Math.max(acr, pos[i * 3 + 1]);
    }
    out[s] = { acromion: acr, crease: creaseY(pos, k, E[1]), fingertip: tip, elbow: E[1], wrist: W[1], upper: len(sub(E, S)), flex: deg(sub(E, S), sub(W, E)) };
  }
  const avg = key => (out.L[key] + out.R[key]) / 2;
  return { H, L: out.L, R: out.R, acromion: avg('acromion'), crease: avg('crease'), fingertip: avg('fingertip'), elbow: avg('elbow'), wrist: avg('wrist') };
}

const maxRatio = { shortHeavy: 0.84 };   // 31° hanging elbow bend shortens elbow→fingertip
for (const name of Object.keys(BODIES)) {
  test(`${name}: acromion, elbow crease and fingertip heights within ±2% of the anthropometric norms (fit and relaxed poses)`, () => {
    const fit = fits[name], G = fit.geom;
    for (const pose of ['fit', 'relaxed']) {
      const m = armHeights(fit, pose), H = m.H;
      const rows = [['acromion', m.acromion, 0.818 * H], ['elbow crease', m.crease, 0.63 * H], ['fingertip', m.fingertip, 0.38 * H]];
      const report = rows.map(([k, g, w]) => `${k.padEnd(13)} ${g.toFixed(2)} in = ${(g / H).toFixed(3)} H  (norm ${(w / H).toFixed(3)} H)  ${pct(g, w).toFixed(2)}%`).join('\n');
      if (REPORT) console.log(`\n[${name} ${pose}] upper arm ${m.L.upper.toFixed(2)} in, elbow ${m.L.flex.toFixed(1)}°, acr→elbow/elbow→tip ${((m.acromion - m.elbow) / (m.elbow - m.fingertip)).toFixed(3)}\n${report}`);
      for (const [k, g, w] of rows) assert.ok(Math.abs(pct(g, w)) <= 2, `${name} ${pose} ${k}\n${report}`);
      for (const s of ['L', 'R']) {
        // joint-centre upper arm = anthro's bone (not lengthened by skinning); the hanging elbow is bent 10–20° for
        // typical builds (anthro bends it more when a big waist / lats push the elbow out: 21° tallLean, 31° shortHeavy)
        assert.ok(Math.abs(pct(m[s].upper, G.bones['upperArm' + s])) < 1.5, `${name} ${pose} upper arm ${s} ${m[s].upper.toFixed(2)} vs ${G.bones['upperArm' + s].toFixed(2)}`);
        const maxFlex = name === 'default69' || name === 'bob' ? 20 : 35;
        assert.ok(m[s].flex > 8 && m[s].flex < maxFlex, `${name} ${pose} elbow flexion ${s} ${m[s].flex.toFixed(1)}°`);
      }
      // proportions as the eye reads them: the upper arm (acromion→elbow) is somewhat longer than the forearm
      // (elbow→wrist) and ≈ 0.74 of elbow→fingertip (D&C 0.188 H / 0.253 H)
      const up = m.acromion - m.elbow, fore = m.elbow - m.wrist, low = m.elbow - m.fingertip;
      assert.ok(up / fore > 1.1 && up / fore < 1.45, `${name} ${pose} upper/forearm ${(up / fore).toFixed(2)}`);
      assert.ok(up / low > 0.7 && up / low < (maxRatio[name] || 0.82), `${name} ${pose} upper / (forearm + hand) ${(up / low).toFixed(3)} (norm 0.743)`);
    }
  });
}

test('relaxed pose keeps the fitted girths (contrapposto is subtle), ±3%', () => {
  for (const name of ['bob', 'tallLean']) {
    const fit = fits[name], L = fit.geom.landmarks, s = BODIES[name].shape;
    const { pos, y0 } = posed(fit, 'relaxed');
    const trunk = (a, b, c) => [a, b, c].every(i => P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5);
    const leg = sg => (a, b, c) => [a, b, c].every(i => (P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5) && fit.rest[i * 3] * sg > 0);
    const arm = k => (a, b, c) => P[a] === k && P[b] === k && P[c] === k;
    // the relaxed knee lowers the hips a little: slice each site at the same height above the floor as anthro's
    // landmark, but measured from the posed pelvis (the trunk sites ride with it)
    const drop = (() => { const r = posed(fit, 'fit'); const J0 = r.J[B.pelvis][1]; const J1 = posed(fit, 'relaxed').J[B.pelvis][1]; return J1 - J0; })();
    const rows = [
      ['chest', sliceHull(pos, T, trunk, L.chest.y + drop).per, s.chest], ['waist', sliceHull(pos, T, trunk, L.waist.y + drop).per, s.waist],
      ['hips', sliceHull(pos, T, trunk, L.hip.y + drop).per, s.hips],
      ['arm relaxed L', sliceHull(pos, T, arm(2), L.arm.y + drop).per, L.arm.relaxed.girth], ['arm relaxed R', sliceHull(pos, T, arm(3), L.arm.y + drop).per, L.arm.relaxed.girth],
      ['thigh R (standing)', sliceHull(pos, T, leg(-1), L.thigh.y + drop).per, s.thigh], ['calf R (standing)', sliceHull(pos, T, leg(-1), L.calf.y).per, s.calf],
    ];
    const report = rows.map(([k, g, w]) => `${k.padEnd(18)} ${g.toFixed(2)} / ${w.toFixed(2)}  ${pct(g, w).toFixed(2)}%`).join('\n');
    if (REPORT) console.log(`\n[${name} relaxed girths, pelvis ${drop.toFixed(2)} in, floor ${y0.toFixed(2)}]\n${report}`);
    for (const [k, g, w] of rows) assert.ok(Math.abs(pct(g, w)) <= 3, `${name} ${k}\n${report}`);
  }
});

// ---------------------------------------------------------------- pose realism
const fit = fits.bob, H = fit.geom.heightIn;
const PJ = Object.fromEntries(POSES.map(p => [p, posed(fit, p)]));
const jt = (p, n) => PJ[p].J[B[n]];
const kneeFlex = (p, s) => deg(sub(jt(p, 'shin' + s), jt(p, 'thigh' + s)), sub(jt(p, 'foot' + s), jt(p, 'shin' + s)));
const elbowFlex = (p, s) => deg(sub(jt(p, 'farm1' + s), jt(p, 'uarm1' + s)), sub(jt(p, 'hand' + s), jt(p, 'farm1' + s)));
const qz = (q, v) => { const [x, y, z, w] = q; const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]; return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]]; };

test('relaxed: subtle contrapposto (pelvis 3–5°, counter-tilted shoulders, soft knee), level head, arms hanging', () => {
  const pose = PJ.relaxed.pose;
  const pelvisX = qz(pose.q[B.pelvis], [1, 0, 0]), chestX = qz(pose.q[B.chest], [1, 0, 0]), headX = qz(pose.q[B.head], [1, 0, 0]);
  const tilt = Math.asin(pelvisX[1]) * 180 / Math.PI, sh = Math.asin(chestX[1]) * 180 / Math.PI, hd = Math.asin(headX[1]) * 180 / Math.PI;
  assert.ok(Math.abs(tilt) >= 3 && Math.abs(tilt) <= 5, `pelvis tilt ${tilt.toFixed(1)}°`);
  assert.ok(Math.sign(sh) === -Math.sign(tilt) && Math.abs(sh) >= 1.5 && Math.abs(sh) <= 4, `shoulder line ${sh.toFixed(1)}° vs pelvis ${tilt.toFixed(1)}°`);
  assert.ok(Math.abs(hd) < 0.5, `head roll ${hd.toFixed(2)}°`);
  const kL = kneeFlex('relaxed', 'L'), kR = kneeFlex('relaxed', 'R');
  assert.ok(kL > 6 && kL < 25 && kR < 4, `relaxed knee ${kL.toFixed(1)}°, standing knee ${kR.toFixed(1)}°`);
  for (const s of ['L', 'R']) { const e = elbowFlex('relaxed', s); assert.ok(e > 8 && e < 20, `elbow ${s} ${e.toFixed(1)}°`); }
  // weight over the standing (right) foot: the pelvis sits right of centre, the head stays between the feet
  assert.ok(jt('relaxed', 'pelvis')[0] < -0.2, `pelvis x ${jt('relaxed', 'pelvis')[0].toFixed(2)}`);
  const hx = jt('relaxed', 'head')[0];
  assert.ok(hx < jt('relaxed', 'footL')[0] && hx > jt('relaxed', 'footR')[0], `head x ${hx.toFixed(2)}`);
});

test('front / back double biceps: upper arms just above horizontal, elbows 100–110°, fists above the elbows', () => {
  for (const p of ['front_double_biceps', 'back_double_biceps']) {
    for (const s of ['L', 'R']) {
      const S = jt(p, 'uarm1' + s), E = jt(p, 'farm1' + s), W = jt(p, 'hand' + s), u = sub(E, S);
      const elev = Math.asin(u[1] / len(u)) * 180 / Math.PI, fwd = Math.atan2(u[2], Math.abs(u[0])) * 180 / Math.PI, fl = elbowFlex(p, s);
      assert.ok(elev > 3 && elev < 20, `${p} ${s} upper-arm elevation ${elev.toFixed(1)}°`);
      assert.ok(p === 'front_double_biceps' ? fwd > 8 && fwd < 25 : fwd < -4 && fwd > -20, `${p} ${s} upper arm fwd ${fwd.toFixed(1)}°`);
      assert.ok(fl >= 100 && fl <= 112, `${p} ${s} elbow ${fl.toFixed(1)}°`);
      assert.ok(W[1] > E[1] + 7 && Math.abs(W[0]) < Math.abs(E[0]), `${p} ${s} fist above/inside the elbow`);
    }
  }
  // back double biceps: one leg stepped back onto the ball of the foot (calf shown)
  const back = ['L', 'R'].find(s => jt('back_double_biceps', 'foot' + s)[2] < jt('back_double_biceps', 'foot' + (s === 'L' ? 'R' : 'L'))[2] - 4);
  assert.ok(back, 'a foot is stepped back');
  const fq = PJ.back_double_biceps.pose.q[B['foot' + back]], toe = qz(fq, [0, 0, 1]);
  assert.ok(toe[1] < -0.25, `rear heel raised (toe pitch ${(Math.asin(-toe[1]) * 180 / Math.PI).toFixed(1)}°)`);
});

test('lat spread: wrists at the sides of the waist, elbows out and forward, scapulae protracted', () => {
  const w = fit.sections.waist;
  for (const s of ['L', 'R']) {
    const W = jt('lat_spread', 'hand' + s), E = jt('lat_spread', 'farm1' + s), S = jt('lat_spread', 'uarm1' + s);
    assert.ok(Math.abs(W[1] - w.y) < 2.5, `${s} wrist height ${W[1].toFixed(2)} vs waist ${w.y.toFixed(2)}`);
    assert.ok(Math.abs(E[0]) > Math.abs(S[0]) + 2, `${s} elbow out`);
    assert.ok(E[2] > W[2] + 1, `${s} elbow forward of the wrist`);
  }
  assert.ok((POSE_SPECS.lat_spread.clav.retract || 0) < 0, 'protracted');
});

test('side chest: front knee bent with the heel raised, rear leg straight, front forearm across the abdomen, hands joined, head toward the camera', () => {
  const p = 'side_chest', pose = PJ[p].pose;
  assert.ok(kneeFlex(p, 'L') > 15, `front knee ${kneeFlex(p, 'L').toFixed(1)}°`);
  assert.ok(kneeFlex(p, 'R') < 6, `rear knee ${kneeFlex(p, 'R').toFixed(1)}°`);
  assert.ok(qz(pose.q[B.footL], [0, 0, 1])[1] < -0.25, 'front heel raised');
  const eL = elbowFlex(p, 'L'); assert.ok(eL > 75 && eL < 115, `front elbow ${eL.toFixed(1)}°`);
  const d = len(sub(jt(p, 'handL'), jt(p, 'handR'))); assert.ok(d < 4, `wrists ${d.toFixed(2)} in apart`);
  const yawOf = q => { const f = qz(q, [0, 0, 1]); return Math.atan2(f[0], f[2]); };
  const view = POSE_SPECS.side_chest.view.yaw, chest = yawOf(pose.q[B.chest]), head = yawOf(pose.q[B.head]), hips = yawOf(pose.q[B.pelvis]);
  assert.ok(Math.abs(view - chest) * 180 / Math.PI > 30 && Math.abs(view - chest) * 180 / Math.PI < 55, `chest ${((view - chest) * 180 / Math.PI).toFixed(0)}° off the camera`);
  assert.ok(Math.abs(view - head) < Math.abs(view - chest), 'head turned further toward the camera than the chest');
  assert.ok(Math.abs(view - hips) > Math.abs(view - chest), 'hips stay more in profile than the chest');
});

test('every pose: both feet on the floor (or on the ball of the foot), no limb sunk into the torso or the other leg', () => {
  for (const p of POSES) {
    const { pos } = PJ[p];
    // planted soles: the lowest point of each foot is at the floor unless its heel is raised (then ≤ 1.2 in up)
    for (const [s, k] of [['L', 4], ['R', 5]]) {
      let lo = Infinity; for (let i = 0; i < A.nMesh; i++) if (P[i] === k && A.wFoot[i] > 0.5) lo = Math.min(lo, pos[i * 3 + 1]);
      assert.ok(lo > -0.05 && lo < 1.2, `${p} ${s} foot lowest point ${lo.toFixed(2)}`);
    }
    // penetration: arm vertices (hands, forearms) more than 0.6 in inside the torso's horizontal section, and leg
    // vertices inside the other leg's section (side chest crosses the knees closest)
    const deep = (pts, hull, tol) => {
      if (!hull || hull.length < 3) return false;
      let inside = true, dmin = Infinity;
      for (let e = 0; e < hull.length; e++) {
        const a = hull[e], b = hull[(e + 1) % hull.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
        const c = (ex * (pts[1] - a[1]) - ez * (pts[0] - a[0])) / L;   // > 0 inside for a CCW hull
        if (c < 0) { inside = false; break; } dmin = Math.min(dmin, c);
      }
      return inside && dmin > tol;
    };
    const torsoOk = (a, b, c) => P[a] === 0 && P[b] === 0 && P[c] === 0;
    let bad = 0;
    const cache = new Map();
    const hullAt = (key, ok, y) => { const kk = key + Math.round(y * 4); if (!cache.has(kk)) cache.set(kk, sliceHull(pos, T, ok, Math.round(y * 4) / 4).hull); return cache.get(kk); };
    for (let i = 0; i < A.nMesh; i++) {
      if (P[i] !== 2 && P[i] !== 3) continue;
      const y = pos[i * 3 + 1]; if (y < fit.geom.landmarks.crotch.y + 2 || y > fit.geom.landmarks.chest.y) continue;
      if (deep([pos[i * 3], pos[i * 3 + 2]], hullAt('t', torsoOk, y), 0.6)) bad++;
    }
    assert.ok(bad <= 12, `${p}: ${bad} arm vertices sunk > 0.6 in into the torso`);
    let legBad = 0;
    for (const [k, other] of [[4, 5], [5, 4]]) {
      const ok = (a, b, c) => P[a] === other && P[b] === other && P[c] === other;
      for (let i = 0; i < A.nMesh; i++) {
        if (P[i] !== k) continue; const y = pos[i * 3 + 1]; if (y < 4 || y > fit.geom.landmarks.crotch.y - 2) continue;
        if (deep([pos[i * 3], pos[i * 3 + 2]], hullAt('l' + other, ok, y), 0.3)) legBad++;
      }
    }
    assert.ok(legBad <= 6, `${p}: ${legBad} leg vertices inside the other leg`);
  }
});

test('pose transitions: ~450 ms, monotone ease with zero end velocity (no overshoot)', () => {
  assert.ok(POSE_MS >= 400 && POSE_MS <= 500, `${POSE_MS} ms`);
  let prev = 0;
  for (let k = 0; k <= 100; k++) { const e = poseEase(k / 100); assert.ok(e >= prev - 1e-12 && e >= 0 && e <= 1, `ease ${k / 100} → ${e}`); prev = e; }
  assert.ok(poseEase(0) === 0 && poseEase(1) === 1);
  assert.ok(poseEase(0.01) < 1e-4 && 1 - poseEase(0.99) < 1e-4, 'zero end velocity');
});
