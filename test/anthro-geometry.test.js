import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyGeometry, perimeter, crossSectionAt, debugTable, LANDMARKS, HEIGHTS, SEGMENT_RATIOS, BONE_RATIOS } from '../js/engine/anthro.js';
import { BOB, LEAN_LITERAL, LEAN, HEAVY, TALL, ALL, SITE_LM } from './anthro-fixtures.js';

const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const G = Object.fromEntries(Object.entries(ALL).map(([k, v]) => [k, bodyGeometry(v)]));

function walkNumbers(o, path, out) {
  if (typeof o === 'number') { if (!Number.isFinite(o)) out.push(path); return out; }
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walkNumbers(v, `${path}.${k}`, out);
  return out;
}

test('every given tape girth is reproduced within ±1% at its landmark', () => {
  for (const [name, input] of Object.entries(ALL)) {
    const g = G[name];
    for (const [site, lm] of Object.entries(SITE_LM)) {
      const L = g.landmarks[lm];
      const P = perimeter(L.rx, L.rz, L.n);
      assert.ok(rel(L.girth, P) < 1e-9, `${name} ${lm} girth field = perimeter`);
      if (input[site] != null) assert.ok(rel(P, input[site]) < 0.01, `${name} ${site}: ${P} vs ${input[site]}`);
      else assert.ok(g.estimated.includes(site), `${name} ${site} should be listed as estimated`);
      // filled values are reproduced too
      assert.ok(rel(P, g.inputs[site]) < 0.01, `${name} ${site} (filled): ${P} vs ${g.inputs[site]}`);
    }
  }
});

test('landmark heights and segments match documented ratios (±2%)', () => {
  const expectH = { shoulderAcromion: ['acromion', 0.818], nipple: ['chest', 0.72], navel: ['waist', 0.60], trochanter: ['hipJoint', 0.53],
    crotch: ['crotch', 0.47], knee: ['knee', 0.285], ankle: ['ankle', 0.039], chin: ['chin', 0.87] };
  const expectS = { upperArm: 0.186, forearm: 0.146, hand: 0.108, foot: 0.152, head: 0.13, thigh: 0.245, shank: 0.246 };
  for (const [name, g] of Object.entries(G)) {
    const H = g.heightIn;
    for (const [label, [k, f]] of Object.entries(expectH)) assert.ok(rel(g.heights[k] / H, f) < 0.02, `${name} ${label} ${g.heights[k] / H}`);
    for (const [k, f] of Object.entries(expectS)) assert.ok(rel(g.segments[k] / H, f) < 0.02, `${name} segment ${k} ${g.segments[k] / H}`);
    for (const [k, f] of Object.entries(SEGMENT_RATIOS)) assert.ok(rel(g.segments[k], f * H) < 1e-9);
    // landmark y equals the documented height fraction
    for (const k of ['vertex', 'chin', 'neck', 'chest', 'underbust', 'waist', 'hip', 'crotch', 'thigh', 'knee', 'calf', 'ankle', 'elbow', 'forearm', 'wrist'])
      assert.ok(rel(g.landmarks[k].y, HEIGHTS[k] * H) < 1e-9, `${name} ${k}`);
    // joint-centre bones (de Leva) and the D&C leg segments agree with the placed joints
    assert.ok(rel(g.bones.thigh, SEGMENT_RATIOS.thigh * H) < 0.02, `${name} thigh bone ${g.bones.thigh}`);
    assert.ok(rel(g.bones.shank, SEGMENT_RATIOS.shank * H) < 0.02, `${name} shank bone ${g.bones.shank}`);
    assert.ok(rel(g.bones.forearm, SEGMENT_RATIOS.forearm * H) < 0.03, `${name} forearm bone ${g.bones.forearm}`);
    assert.ok(rel(g.joints.shoulderL.y - g.joints.elbowL.y, BONE_RATIOS.upperArm * H) < 1e-9);
    assert.ok(rel(g.bones.hand, SEGMENT_RATIOS.hand * H) < 1e-9);
  }
});

test('landmark heights are monotonic', () => {
  const torsoLeg = ['vertex', 'chin', 'neck', 'shoulder', 'chest', 'underbust', 'waist', 'hip', 'crotch', 'thigh', 'knee', 'calf', 'ankle'];
  const arm = ['shoulder', 'arm', 'elbow', 'forearm', 'wrist'];
  for (const [name, g] of Object.entries(G)) {
    for (const chain of [torsoLeg, arm])
      for (let i = 1; i < chain.length; i++) assert.ok(g.landmarks[chain[i - 1]].y > g.landmarks[chain[i]].y, `${name} ${chain[i - 1]} > ${chain[i]}`);
    for (const prof of Object.values(g.profiles)) for (let i = 1; i < prof.length; i++) assert.ok(prof[i].y > prof[i - 1].y, `${name} profile order`);
    const j = g.joints;
    assert.ok(j.head.y > j.neck.y && j.neck.y > j.shoulderL.y && j.shoulderL.y > j.elbowL.y && j.elbowL.y > j.wristL.y && j.wristL.y > j.handL.y);
    assert.ok(j.hipL.y > j.kneeL.y && j.kneeL.y > j.ankleL.y && j.ankleL.y > 0);
    assert.deepEqual(Object.keys(g.landmarks).sort(), [...LANDMARKS].sort());
  }
});

test('Bob: breadths and depths are plausible vs ANSUR II male ranges', () => {
  const b = G.BOB.breadths;
  assert.ok(b.biacromial >= 15.5 && b.biacromial <= 16.5, `biacromial ${b.biacromial}`);
  assert.ok(b.bideltoid >= 18.5 && b.bideltoid <= 20, `bideltoid ${b.bideltoid}`);   // ANSUR: shoulder circ / bideltoid ≈ 2.40
  assert.ok(b.thigh >= 6.5 && b.thigh <= 7.5, `thigh Ø ${b.thigh}`);
  assert.ok(b.chest >= 12 && b.chest <= 14, `chest breadth ${b.chest}`);
  assert.ok(b.chestDepth >= 8.5 && b.chestDepth <= 10.5, `chest depth ${b.chestDepth}`);
  assert.ok(b.waist >= 11 && b.waist <= 13, `waist breadth ${b.waist}`);
  assert.ok(b.hip >= 12.5 && b.hip <= 14.5, `hip breadth ${b.hip}`);
  assert.ok(b.neck >= 4.3 && b.neck <= 5.2, `neck breadth ${b.neck}`);
  // ordering a physique must have
  assert.ok(b.bideltoid > b.biacromial && b.biacromial > b.chest && b.hip > b.waist);
});

test('all fixtures: skeletal breadths stay in the adult range; shape responds to fat and muscle', () => {
  for (const [name, g] of Object.entries(G)) {
    const H = g.heightIn;
    assert.ok(g.breadths.biacromial / H >= 0.199 && g.breadths.biacromial / H <= 0.256, `${name} biacromial/H ${g.breadths.biacromial / H}`);
    assert.ok(g.breadths.chestDepth < g.breadths.chest, `${name} chest deeper than wide`);
  }
  // fatter → rounder, deeper waist
  const k = g => g.landmarks.waist.rz / g.landmarks.waist.rx;
  assert.ok(k(G.HEAVY) > k(G.BOB) && k(G.BOB) > k(G.LEAN));
  // lats widen the underbust at the same tapes; delts widen the deltoid reach (biacromial drops at fixed tape)
  const lo = bodyGeometry({ ...BOB, muscle: { lats: 0.2, delts: 0.2 } }), hi = bodyGeometry({ ...BOB, muscle: { lats: 0.9, delts: 0.9 } });
  assert.ok(hi.landmarks.underbust.rx > lo.landmarks.underbust.rx);
  assert.ok(hi.derived.deltoidReach > lo.derived.deltoidReach);
  assert.ok(rel(perimeter(hi.landmarks.shoulder.rx, hi.landmarks.shoulder.rz, hi.landmarks.shoulder.n), 46) < 0.01);
  // tall man scales up
  assert.ok(G.TALL.segments.thigh > G.BOB.segments.thigh && G.TALL.breadths.biacromial > G.BOB.breadths.biacromial);
});

test('no NaN or Infinity anywhere, including odd inputs', () => {
  const odd = [{}, { heightIn: 'abc' }, { heightIn: 62, arm: 30, thigh: 18 }, { heightIn: 80, waist: 60, chest: 40, bodyFatPct: 45 },
    { heightIn: 69, shoulders: 30, chest: 50 }, { heightIn: 69, shoulders: 70, chest: 36 }, { shape: { ...BOB }, muscle: { chest: 2, lats: -1 } }, { ...BOB, sex: 'female' }];
  for (const [name, g] of Object.entries(G)) assert.deepEqual(walkNumbers(g, name, []), []);
  for (const o of odd) {
    const g = bodyGeometry(o);
    assert.deepEqual(walkNumbers(g, JSON.stringify(o), []), []);
    for (const [site, lm] of Object.entries(SITE_LM)) {
      const L = g.landmarks[lm];
      assert.ok(rel(perimeter(L.rx, L.rz, L.n), g.inputs[site]) < 0.01, `${JSON.stringify(o)} ${site}`);
    }
  }
});

test('crossSectionAt is continuous and agrees with the landmarks', () => {
  for (const [name, g] of Object.entries(G)) {
    for (const part of ['torso', 'neck', 'head', 'armL', 'armR', 'legL', 'legR']) {
      let prev = null, count = 0;
      for (let y = 0; y <= g.heightIn; y += 0.02) {
        const c = crossSectionAt(g, y, part);
        if (!c) { prev = null; continue; }
        count++;
        for (const k of ['rx', 'rz', 'n', 'cx', 'cz', 'girth']) assert.ok(Number.isFinite(c[k]), `${name} ${part} ${k} @${y}`);
        const nearPole = part === 'head' && Math.abs(y - g.head.center.y) > g.head.ry - 0.4;   // ellipsoid tips have vertical tangents
        if (prev && !nearPole) {
          assert.ok(Math.abs(c.rx - prev.rx) < 0.12 && Math.abs(c.rz - prev.rz) < 0.12, `${name} ${part} jump @${y.toFixed(2)}: rx ${prev.rx}→${c.rx}`);
          assert.ok(Math.abs(c.cx - prev.cx) < 0.05 && Math.abs(c.cz - prev.cz) < 0.05, `${name} ${part} centre jump @${y.toFixed(2)}`);
        }
        prev = c;
      }
      assert.ok(count > 10, `${name} ${part} has samples`);
    }
    // landmarks are hit exactly
    for (const [lm, part] of [['chest', 'torso'], ['waist', 'torso'], ['hip', 'torso'], ['underbust', 'torso'], ['neck', 'neck'], ['thigh', 'legL'], ['knee', 'legL'], ['calf', 'legL'], ['elbow', 'armL'], ['wrist', 'armL']]) {
      const L = g.landmarks[lm], c = crossSectionAt(g, L.y, part);
      assert.ok(rel(c.girth, L.girth) < 1e-6 && Math.abs(c.cx - L.cx) < 1e-9, `${name} ${lm}`);
    }
    // rest-pose arm = relaxed girth (the tape is flexed)
    const a = crossSectionAt(g, g.landmarks.arm.y, 'armL');
    assert.ok(rel(a.girth, g.landmarks.arm.relaxed.girth) < 1e-6 && a.girth < g.landmarks.arm.girth);
    // right side mirrors the left
    const l = crossSectionAt(g, g.landmarks.calf.y, 'legL'), r = crossSectionAt(g, g.landmarks.calf.y, 'calfR');
    assert.ok(Math.abs(l.cx + r.cx) < 1e-9 && rel(l.girth, r.girth) < 1e-9);
    assert.equal(crossSectionAt(g, g.heightIn + 1, 'torso'), null);
    assert.equal(crossSectionAt(g, 1, 'torso'), null);
  }
});

test('joints: limbs hang clear of the torso and the skeleton is symmetric', () => {
  for (const [name, g] of Object.entries(G)) {
    const j = g.joints;
    for (const k of ['shoulder', 'elbow', 'wrist', 'hand', 'hip', 'knee', 'ankle', 'heel', 'toe']) {
      assert.ok(j[k + 'L'].x > 0 && Math.abs(j[k + 'L'].x + j[k + 'R'].x) < 1e-9 && j[k + 'L'].y === j[k + 'R'].y, `${name} ${k}`);
    }
    // elbow and wrist sections stay outside the torso / hips (≤ 0.5 in soft-tissue contact)
    for (const lm of ['elbow', 'wrist']) {
      const L = g.landmarks[lm], t = crossSectionAt(g, L.y, 'torso');
      if (t) assert.ok(L.cx - L.rx >= t.rx - 0.5, `${name} ${lm} inside torso: ${L.cx - L.rx} vs ${t.rx}`);
    }
    // the hip joint sits inside the hip section, the shoulder joint inside the deltoid loop
    assert.ok(j.hipL.x < g.landmarks.hip.rx && j.shoulderL.x < g.landmarks.shoulder.rx);
    assert.ok(j.shoulderL.x < g.breadths.biacromial / 2 && g.breadths.biacromial / 2 - j.shoulderL.x < 0.6);
    // foot: heel behind the ankle, toes ahead, length matches
    assert.ok(j.heelL.z < j.ankleL.z && j.toeL.z > j.ankleL.z);
    assert.ok(rel(Math.hypot(j.toeL.x - j.heelL.x, j.toeL.z - j.heelL.z), g.segments.foot) < 0.02);
  }
});

test('per-side limbs and estimated / warnings bookkeeping', () => {
  const g = bodyGeometry({ ...BOB, limbs: { thighL: 22.5, thighR: 21.5, calfL: 14.6, calfR: 14.4, armL: 13.7, armR: 13.3 } });
  assert.ok(rel(crossSectionAt(g, g.landmarks.thigh.y, 'thighL').girth, 22.5) < 0.01);
  assert.ok(rel(crossSectionAt(g, g.landmarks.thigh.y, 'thighR').girth, 21.5) < 0.01);
  assert.ok(rel(g.sides.L.calf.girth, 14.6) < 0.01 && rel(g.sides.R.calf.girth, 14.4) < 0.01);
  assert.ok(rel(g.sides.L.arm.flexedGirth, 13.7) < 1e-9);
  assert.ok(rel(g.landmarks.thigh.girth, 22) < 0.01);   // landmark keeps the averaged tape
  assert.deepEqual(G.BOB.estimated, []);
  assert.deepEqual(G.BOB.warnings, []);
  assert.ok(G.TALL.estimated.includes('bodyFatPct') && G.TALL.estimated.includes('chest'));
  assert.ok(G.LEAN_LITERAL.warnings.some(w => /Shoulders/.test(w)));
  assert.ok(bodyGeometry({ ...BOB, arm: 23 }).warnings.some(w => /Arm/.test(w)));
  assert.ok(bodyGeometry({ ...BOB, waist: 46 }).warnings.some(w => /Waist/.test(w)));
  // weight drives estimates when given
  const light = bodyGeometry({ heightIn: 69, weightLb: 140 }), heavy = bodyGeometry({ heightIn: 69, weightLb: 220 });
  assert.ok(heavy.inputs.chest > light.inputs.chest && heavy.inputs.thigh > light.inputs.thigh);
  // projection-style call
  const p = bodyGeometry({ shape: { ...BOB, heightIn: 69 }, muscle: { chest: 0.4, delts: 0.45, lats: 0.4, arms: 0.4, abs: 0.4, quads: 0.6, calves: 0.5, traps: 0.4 }, bodyFatPct: 19 });
  assert.ok(rel(p.landmarks.chest.girth, 39) < 0.01);
});

test('debugTable lists every landmark', () => {
  const t = debugTable(G.BOB);
  for (const k of LANDMARKS) assert.ok(t.includes(k));
  assert.ok(/biacromial/.test(t));
});

test('fuzz: random plausible and implausible bodies always reproduce their tapes, finite output', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const span = (lo, hi) => Math.round((lo + (hi - lo) * rnd()) * 10) / 10;
  for (let i = 0; i < 150; i++) {
    const o = { heightIn: span(58, 84), bodyFatPct: span(4, 45) };
    const ranges = { neck: [12, 20], shoulders: [38, 62], chest: [32, 56], waist: [26, 56], hips: [30, 54], arm: [10, 21], forearm: [9, 16], thigh: [16, 32], calf: [11, 19] };
    for (const [k, [lo, hi]] of Object.entries(ranges)) if (rnd() < 0.75) o[k] = span(lo, hi);
    if (rnd() < 0.5) o.muscle = Object.fromEntries(['chest', 'delts', 'lats', 'arms', 'abs', 'quads', 'calves', 'traps'].map(k => [k, rnd()]));
    if (rnd() < 0.3) o.weightLb = span(110, 300);
    const g = bodyGeometry(o);
    assert.deepEqual(walkNumbers(g, `fuzz${i}`, []), [], JSON.stringify(o));
    for (const [site, lm] of Object.entries(SITE_LM)) {
      const L = g.landmarks[lm];
      assert.ok(rel(perimeter(L.rx, L.rz, L.n), g.inputs[site]) < 0.01, `fuzz ${JSON.stringify(o)} ${site}`);
      if (o[site] != null) assert.equal(g.inputs[site], o[site]);
    }
    for (const prof of Object.values(g.profiles)) for (const p of prof) assert.ok(p.rx > 0 && p.rz > 0, `fuzz${i} ${p.name}`);
  }
});
