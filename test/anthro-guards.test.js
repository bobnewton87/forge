// ANTHRO guards (CONTRACT §21b): no combination of sex × height × weight × body fat × any subset of tape sites
// may produce a broken body. Sweeps the whole input space and asserts the tape is reproduced, the shoulder frame
// and section stay plausibly shaped, the head stays the right size, nothing is NaN, and male output is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyGeometry, perimeter } from '../js/engine/anthro.js';

const SITES = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'arm', 'forearm', 'thigh', 'calf'];
const SITE_LM = { neck: 'neck', shoulders: 'shoulder', chest: 'chest', waist: 'waist', hips: 'hip', arm: 'arm', forearm: 'forearm', thigh: 'thigh', calf: 'calf' };
const MU = v => Object.fromEntries(['chest', 'delts', 'lats', 'arms', 'abs', 'quads', 'calves', 'traps'].map(k => [k, v]));
const REF = {
  male: { h: 69, w: 164, bf: 20, base: { neck: 15, shoulders: 46, chest: 39, waist: 34.5, hips: 38, arm: 13.5, forearm: 11.5, thigh: 22, calf: 14.5 } },
  female: { h: 64, w: 140, bf: 28, base: { neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14 } },
};
// A whole body scaled to (height, weight) the way the engine's own reference body scales, so the tapes stay
// mutually consistent; `variant` then removes sites so they have to be estimated.
function bodyAt(sex, H, W, bf, mu, variant) {
  const R = REF[sex], k = Math.sqrt((W / R.w) / (H / R.h));
  const b = { sex, heightIn: H, weightLb: W, bodyFatPct: bf, muscle: MU(mu) };
  if (variant === 'min') return b;
  for (const [s, v] of Object.entries(R.base)) b[s] = Math.round(v * k * 10) / 10;
  b.waist = Math.round((b.waist + 0.3 * (bf - R.bf)) * 10) / 10;
  b.hips = Math.round((b.hips + 0.15 * (bf - R.bf)) * 10) / 10;
  if (variant === 'no-shoulders') delete b.shoulders;
  if (variant === 'chestOnly') for (const s of SITES) if (s !== 'chest') delete b[s];
  if (variant === 'shouldersOnly') for (const s of SITES) if (s !== 'shoulders') delete b[s];
  return b;
}
const VARIANTS = ['full', 'no-shoulders', 'min', 'chestOnly', 'shouldersOnly'];
function* matrix() {
  for (const sex of ['male', 'female']) {
    for (const H of [56, 60, 64, 69, 74, 80]) {
      for (const W of [90, 120, 160, 220, 300, 420]) {
        for (const bf of [5, 12, 20, 30, 40, 50, 60]) {
          for (const mu of [0, 0.5, 1]) {
            for (const v of VARIANTS) yield [`${sex} H${H} W${W} bf${bf} mu${mu} ${v}`, bodyAt(sex, H, W, bf, mu, v)];
          }
        }
      }
    }
  }
  yield ['male nothing', { sex: 'male' }];
  yield ['female nothing', { sex: 'female' }];
  yield ['no sex, nothing', {}];
}
function finiteNumbers(o, path, out) {
  if (o == null) return out;
  if (typeof o === 'number') { if (!Number.isFinite(o)) out.push(path); return out; }
  if (typeof o !== 'object') return out;
  for (const k of Object.keys(o)) finiteNumbers(o[k], path + '.' + k, out);
  return out;
}

test('§21b guards: the whole input space gives a finite, plausible body that reproduces every tape', () => {
  let n = 0;
  for (const [label, input] of matrix()) {
    n++;
    const g = bodyGeometry(input);
    assert.deepEqual(finiteNumbers(g, label, []), [], `${label}: non-finite output`);
    const H = g.heightIn;
    // every GIVEN tape is reproduced at its landmark (§16: ±1 %)
    for (const [site, lm] of Object.entries(SITE_LM)) {
      if (input[site] == null) continue;
      const L = g.landmarks[lm];
      assert.ok(Math.abs(perimeter(L.rx, L.rz, L.n) / input[site] - 1) < 0.01, `${label}: ${site} ${perimeter(L.rx, L.rz, L.n)} vs tape ${input[site]}`);
    }
    // shoulder frame: a plausible skeleton, deltoids outside it, and a bideltoid that is never a pair of wings
    const b = g.breadths;
    assert.ok(b.biacromial / H >= 0.17 && b.biacromial / H <= 0.28, `${label}: biacromial ${(b.biacromial / H).toFixed(3)} H`);
    assert.ok(b.bideltoid > b.biacromial, `${label}: bideltoid ${b.bideltoid} <= biacromial ${b.biacromial}`);
    assert.ok(b.bideltoid / H >= 0.19 && b.bideltoid / H <= 0.42, `${label}: bideltoid ${(b.bideltoid / H).toFixed(3)} H`);
    // shoulder SECTION: never a pancake and never a barrel (the old solveN fallback produced both)
    const S = g.landmarks.shoulder, asp = S.rz / S.rx;
    assert.ok(asp >= 0.25 && asp <= 0.90, `${label}: shoulder section rz/rx ${asp.toFixed(3)} (rx ${S.rx.toFixed(2)} rz ${S.rz.toFixed(2)})`);
    assert.ok(S.n >= 1.7 && S.n <= 4.2, `${label}: shoulder section n ${S.n}`);
    // the trunk never necks in above the armpits (the collapsed-shoulder bug)
    const tp = k => g.profiles.torso.find(p => p.name === k);
    assert.ok(tp('shoulder').rx >= tp('axilla').rx * 0.88, `${label}: trunk pinches from ${tp('axilla').rx.toFixed(2)} at the axilla to ${tp('shoulder').rx.toFixed(2)} at the deltoid`);
    assert.ok(tp('acromion').rx >= tp('shoulder').rx * 0.85, `${label}: trunk pinches from ${tp('shoulder').rx.toFixed(2)} to ${tp('acromion').rx.toFixed(2)} at the acromion`);
    // head: adult head circumference is 0.29–0.40 of stature at every size and body fat
    const hc = g.head.circumference / H;
    assert.ok(hc >= 0.28 && hc <= 0.40, `${label}: head circumference ${hc.toFixed(3)} H`);
    assert.ok(g.head.rx > 0 && g.head.ry > 0 && g.head.rz > 0, `${label}: head radius <= 0`);
    // every section is a real section
    for (const prof of Object.values(g.profiles)) for (const p of prof) assert.ok(p.rx > 0 && p.rz > 0, `${label}: ${p.name} rx/rz`);
    for (const [k, L] of Object.entries(g.landmarks)) {
      if (k === 'vertex') continue;
      assert.ok(L.rx > 0 && L.rz > 0 && L.y >= 0 && L.y <= H, `${label}: landmark ${k}`);
    }
  }
  assert.ok(n > 3000, `swept ${n} cases`);
});

test('§21b: an implausible shoulders tape is clamped into the deltoid soft tissue, warned, and still reproduced', () => {
  const base = { sex: 'female', heightIn: 64, neck: 13, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14, bodyFatPct: 29 };
  for (const sh of [28, 32, 36, 40, 44, 48, 52, 58]) {
    const g = bodyGeometry({ ...base, shoulders: sh });
    const L = g.landmarks.shoulder;
    assert.ok(Math.abs(perimeter(L.rx, L.rz, L.n) / sh - 1) < 0.01, `shoulders ${sh}: section ${perimeter(L.rx, L.rz, L.n)}`);
    assert.ok(L.rz / L.rx >= 0.25 && L.rz / L.rx <= 0.90, `shoulders ${sh}: aspect ${(L.rz / L.rx).toFixed(3)}`);
    const biac = g.breadths.biacromial / 64;
    assert.ok(biac >= 0.17 && biac <= 0.28, `shoulders ${sh}: biacromial ${biac.toFixed(3)} H`);
    // outside the reachable range the user is told what was adjusted
    if (sh <= 36 || sh >= 44) assert.ok(g.warnings.some(w => /Shoulders tape/.test(w)), `shoulders ${sh}: no warning (${g.warnings.join(' | ')})`);
  }
  // the clamp moves soft tissue, not bone: a wider tape at the clamp gives wider deltoids, same skeleton
  const wide = bodyGeometry({ ...base, shoulders: 50 }), wider = bodyGeometry({ ...base, shoulders: 54 });
  assert.equal(wide.breadths.biacromial.toFixed(6), wider.breadths.biacromial.toFixed(6));
  assert.ok(wider.derived.deltoidReach > wide.derived.deltoidReach);
});

test('§21b: a missing tape site is sized from the body\'s own weight, not from the median adult', () => {
  const at = w => bodyGeometry({ sex: 'female', heightIn: 64, weightLb: w, bodyFatPct: 30 + (w - 140) / 10 });
  const light = at(110), mid = at(140), heavy = at(240), huge = at(320);
  for (const k of ['chest', 'waist', 'hips', 'arm', 'thigh', 'shoulders']) {
    assert.ok(light.inputs[k] < mid.inputs[k], `${k} 110 lb (${light.inputs[k]}) >= 140 lb (${mid.inputs[k]})`);
    assert.ok(mid.inputs[k] < heavy.inputs[k], `${k} 140 lb (${mid.inputs[k]}) >= 240 lb (${heavy.inputs[k]})`);
    assert.ok(heavy.inputs[k] < huge.inputs[k], `${k} 240 lb (${heavy.inputs[k]}) >= 320 lb (${huge.inputs[k]})`);
  }
  // a 240 lb woman is estimated distinctly bigger than the 140 lb reference, everywhere
  assert.ok(heavy.inputs.chest > mid.inputs.chest * 1.2 && heavy.inputs.shoulders > mid.inputs.shoulders * 1.05);
  for (const k of ['chest', 'waist', 'hips', 'arm', 'thigh', 'shoulders']) assert.ok(heavy.estimated.includes(k) || k === 'shoulders');
});

// Regression lock: the male model is unchanged by the §21b work. These numbers were taken from the build before
// the fix (commit b4cd885) and must not move; the guards above are all inert for a plausible male body.
const MALE_GOLDEN = {
  bob: { input: { heightIn: 69, neck: 15, shoulders: 46, chest: 39, waist: 34.5, hips: 38, arm: 13.5, forearm: 11.5, thigh: 22, calf: 14.5, bodyFatPct: 19 },
    biacromial: 15.6282, bideltoid: 19.2391, deltoidReach: 2.1549, shRx: 9.6195, shRz: 4.5943, shN: 1.983, torsoShRx: 7.5695, acromionRx: 7.5015, trapRx: 5.3261, shoulderTape: 46 },
  tallLean: { input: { heightIn: 73, neck: 16.5, shoulders: 51, chest: 44, waist: 33, hips: 39.5, arm: 15.5, forearm: 12.5, thigh: 24, calf: 15.5, bodyFatPct: 11,
    muscle: { chest: 0.8, delts: 0.8, lats: 0.75, arms: 0.8, abs: 0.7, quads: 0.7, calves: 0.6, traps: 0.7 } },
    biacromial: 17.434, bideltoid: 21.289, deltoidReach: 2.2972, shRx: 10.6445, shRz: 5.1169, shN: 1.987, torsoShRx: 8.4582, acromionRx: 8.3683, trapRx: 6.1911, shoulderTape: 51 },
  shortHeavy: { input: { heightIn: 66, neck: 16, shoulders: 45, chest: 42, waist: 40, hips: 41, arm: 13, forearm: 11, thigh: 24, calf: 15.5, bodyFatPct: 29 },
    biacromial: 14.319, bideltoid: 18.1923, deltoidReach: 2.271, shRx: 9.0962, shRz: 5.0599, shN: 1.903, torsoShRx: 6.9255, acromionRx: 6.8731, trapRx: 5.0661, shoulderTape: 45 },
  lean: { input: { heightIn: 70, chest: 42, waist: 30, hips: 36, arm: 15, thigh: 23, bodyFatPct: 9 },
    biacromial: 15.9782, bideltoid: 19.1965, deltoidReach: 1.9637, shRx: 9.5982, shRz: 4.8314, shN: 1.953, torsoShRx: 7.7409, acromionRx: 7.6695, trapRx: 5.5167, shoulderTape: 46.4 },
  heavy: { input: { heightIn: 69, chest: 44, waist: 40, bodyFatPct: 28 },
    biacromial: 15.8067, bideltoid: 19.8123, deltoidReach: 2.3523, shRx: 9.9061, shRz: 5.2892, shN: 1.916, torsoShRx: 7.6587, acromionRx: 7.5872, trapRx: 5.5296, shoulderTape: 48.5 },
  tall: { input: { heightIn: 75 },
    biacromial: 16.8268, bideltoid: 20.7993, deltoidReach: 2.3661, shRx: 10.3996, shRz: 4.8056, shN: 2, torsoShRx: 8.1475, acromionRx: 8.0769, trapRx: 5.6892, shoulderTape: 49.4 },
  minimal: { input: { heightIn: 71, weightLb: 190, bodyFatPct: 22 },
    biacromial: 16.1491, bideltoid: 20, deltoidReach: 2.2851, shRx: 10, shRz: 4.9106, shN: 1.969, torsoShRx: 7.8228, acromionRx: 7.7516, trapRx: 5.5367, shoulderTape: 48.1 },
  bulk: { input: { heightIn: 71, neck: 17, shoulders: 52, chest: 46, waist: 36, hips: 40, arm: 16.5, forearm: 13, thigh: 26, calf: 16, bodyFatPct: 14,
    muscle: { chest: 0.9, delts: 0.9, lats: 0.9, arms: 0.9, abs: 0.6, quads: 0.85, calves: 0.7, traps: 0.85 } },
    biacromial: 17.4952, bideltoid: 21.5116, deltoidReach: 2.3678, shRx: 10.7558, shRz: 5.3896, shN: 1.968, torsoShRx: 8.4959, acromionRx: 8.3977, trapRx: 6.4446, shoulderTape: 52 },
};
test('§21b: male bodyGeometry output is unchanged (golden values from before the fix)', () => {
  const r = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
  for (const [name, G] of Object.entries(MALE_GOLDEN)) {
    const g = bodyGeometry(G.input), S = g.landmarks.shoulder;
    const tp = k => g.profiles.torso.find(p => p.name === k);
    const got = { biacromial: r(g.breadths.biacromial), bideltoid: r(g.breadths.bideltoid), deltoidReach: r(g.derived.deltoidReach),
      shRx: r(S.rx), shRz: r(S.rz), shN: r(S.n, 3), torsoShRx: r(S.torso.rx), acromionRx: r(tp('acromion').rx), trapRx: r(tp('trap').rx),
      shoulderTape: g.inputs.shoulders };
    for (const k of Object.keys(got)) assert.equal(got[k], G[k], `${name}.${k}`);
    assert.deepEqual(g.warnings, [], `${name} warnings: ${g.warnings.join(' | ')}`);
  }
});
