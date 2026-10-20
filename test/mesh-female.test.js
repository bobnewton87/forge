// MESH renderer, female body (CONTRACT §21): asset selection by sex, the female MakeHuman asset, tape fitting on the
// deformed + skinned mesh, poses, the cup / modesty / bun extras, and the DXA-equivalent body-fat calibration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeBodyAsset, loadBodyAsset, assetFiles, sexOf, effectiveMuscle, FEMALE_MUSCLE_SHIFT, fitBody, skinMatrices, skinPositions, sliceHull,
  flexPeakGirth, poseGlobals, POSES, headDims, headTargets, HEAD_REF_F, cupWeight, BF_CAL, definitionLevels, placeBun } from '../js/ui/body3d-mesh.js';

const dir = new URL('../assets/body/', import.meta.url);
const file = f => fileURLToPath(new URL(f, dir));
const read = (j, b) => { const meta = JSON.parse(fs.readFileSync(file(j), 'utf8')), bin = fs.readFileSync(file(b)); return { meta, buf: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) }; };
const F0 = read('body-female.json', 'body-female.bin'), M0 = read('body.json', 'body.bin');
const A = decodeBodyAsset(F0.meta, F0.buf), AM = decodeBodyAsset(M0.meta, M0.buf);
const P = A.part, T = A.tris;
const all3 = f => (a, b, c) => f(a) && f(b) && f(c);
const pct = (a, b) => (a / b - 1) * 100;
const MU = v => Object.fromEntries(['chest', 'delts', 'lats', 'arms', 'abs', 'quads', 'calves', 'traps'].map(k => [k, v]));

const BODIES = {
  typical: { shape: { heightIn: 64, neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14 }, bodyFatPct: 33, muscle: MU(0.26) },
  athletic: { shape: { heightIn: 66, neck: 12.5, shoulders: 40.5, chest: 34, waist: 25.5, hips: 36.5, arm: 11.5, forearm: 9.5, thigh: 21, calf: 14 }, bodyFatPct: 24, muscle: MU(0.3) },
  petiteCurvy: { shape: { heightIn: 60, neck: 13, shoulders: 39, chest: 38, waist: 30, hips: 42, arm: 12, forearm: 9.5, thigh: 24, calf: 14.5 }, bodyFatPct: 38, muscle: MU(0.2) },
};
const fits = {}; for (const [k, b] of Object.entries(BODIES)) fits[k] = fitBody(A, b);

test('asset files and sex resolution: the female pair is separate, opts.sex › shape.sex › profile.body.sex › male', () => {
  assert.deepEqual(assetFiles('female'), ['body-female.json', 'body-female.bin']);
  assert.deepEqual(assetFiles('male'), ['body.json', 'body.bin']);
  assert.deepEqual(assetFiles(), ['body.json', 'body.bin']);
  assert.equal(sexOf({ sex: 'female' }), 'female');
  assert.equal(sexOf({ sex: 'male', shape: { sex: 'female' } }), 'male');
  assert.equal(sexOf({ shape: { sex: 'female' } }), 'female');
  assert.equal(sexOf({}), 'male');   // Node store: default profile is male
});

test('loadBodyAsset fetches only the files for the requested sex and caches per sex', async () => {
  const seen = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const name = String(u).split('/').pop(); seen.push(name);
    const data = fs.readFileSync(file(name));
    return { ok: true, status: 200, json: async () => JSON.parse(data.toString('utf8')), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  };
  try {
    const base = new URL('../assets/body/', import.meta.url);
    const f = await loadBodyAsset(base, 'female');
    assert.equal(f.sex, 'female');
    assert.deepEqual(seen.sort(), ['body-female.bin', 'body-female.json']);
    assert.equal(await loadBodyAsset(base, 'female'), f);    // cached
    assert.equal(seen.length, 2);
    const m = await loadBodyAsset(base, 'male');
    assert.equal(m.sex, 'male');
    assert.deepEqual(seen.slice(2).sort(), ['body.bin', 'body.json']);
  } finally { globalThis.fetch = realFetch; }
});

test('female asset: same topology / skeleton as the male one, female default shape, cup morphs and the fold landmark', () => {
  assert.equal(F0.meta.sex, 'female');
  assert.equal(M0.meta.sex, undefined);    // the male meta is byte-identical to the pre-female build (no sex key)
  assert.equal(A.nMesh, AM.nMesh); assert.equal(A.tris.length, AM.tris.length);
  assert.deepEqual(A.bones.map(b => b.name), AM.bones.map(b => b.name));
  assert.deepEqual(Array.from(A.skinIdx.subarray(0, 4000)), Array.from(AM.skinIdx.subarray(0, 4000)));
  assert.equal(A.morphs.length, 8); assert.deepEqual(A.cups.map(c => c.name), ['mincup', 'maxcup']);
  assert.equal(AM.cups.length, 0); assert.equal(AM.modesty, undefined); assert.equal(AM.bun, undefined);
  assert.ok(A.lm.imfV >= 0 && A.base[A.lm.imfV * 3 + 1] < A.base[A.lm.nippleV * 3 + 1]);
  assert.equal(F0.meta.source.commit, 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482');
  const size = fs.statSync(file('body-female.bin')).size + fs.statSync(file('body-female.json')).size;
  assert.ok(size <= 1.5 * 1024 * 1024, `${size} bytes`);
});

function measure(fit) {
  const { M } = skinMatrices(A, fit.heads, fit.relax), pos = skinPositions(A, fit.rest, M), L = fit.geom.landmarks;
  const TRUNK = all3(i => P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5), LOOP = all3(i => P[i] <= 3);
  const leg = sg => all3(i => (P[i] === 0 || P[i] === 1 || P[i] === 4 || P[i] === 5) && fit.rest[i * 3] * sg > 0);
  // neck tape: the narrowest section between the neck base and the jaw (the mesh's own menton)
  const neckYs = []; for (let y = fit.geom.heights.neckBase - 0.4; y <= pos[A.lm.chinV * 3 + 1] - 0.25; y += 0.1) neckYs.push(y);
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < A.nMesh; i++) if (P[i] !== 6) { lo = Math.min(lo, pos[i * 3 + 1]); hi = Math.max(hi, pos[i * 3 + 1]); }
  return {
    pos, height: hi - lo, floor: lo,
    g: {
      neck: Math.min(...neckYs.map(y => sliceHull(pos, T, TRUNK, y).per).filter(v => v > 0)),
      shoulders: sliceHull(pos, T, LOOP, L.shoulder.y).per,
      chest: sliceHull(pos, T, TRUNK, L.chest.y).per, underbust: sliceHull(pos, T, TRUNK, L.underbust.y).per,
      waist: sliceHull(pos, T, TRUNK, L.waist.y).per, hips: sliceHull(pos, T, TRUNK, L.hip.y).per,
      thighL: sliceHull(pos, T, leg(1), L.thigh.y).per, thighR: sliceHull(pos, T, leg(-1), L.thigh.y).per,
      calfL: sliceHull(pos, T, leg(1), L.calf.y).per, armFlexedL: flexPeakGirth(fit, 'L', fit.flexAmp),
    },
  };
}

for (const [name, b] of Object.entries(BODIES)) {
  test(`female ${name}: bust, underbust, natural waist, hips, thighs … reproduced on the skinned mesh; stature exact`, () => {
    const fit = fits[name], s = b.shape, { g, height, floor } = measure(fit);
    const rows = [['neck', g.neck, s.neck], ['shoulders', g.shoulders, s.shoulders], ['bust', g.chest, s.chest],
      ['underbust', g.underbust, fit.geom.landmarks.underbust.girth], ['natural waist', g.waist, s.waist], ['hips', g.hips, s.hips],
      ['thigh L', g.thighL, s.thigh], ['thigh R', g.thighR, s.thigh], ['calf L', g.calfL, s.calf], ['arm (flexed)', g.armFlexedL, s.arm]];
    const report = rows.map(([k, got, want]) => `${k} ${got.toFixed(2)}/${want.toFixed(2)} (${pct(got, want).toFixed(2)}%)`).join(', ');
    for (const [k, got, want] of rows) assert.ok(Math.abs(pct(got, want)) <= 3, `${name} ${k}: ${report}`);
    for (const k of ['bust', 'natural waist', 'hips']) { const r = rows.find(x => x[0] === k); assert.ok(Math.abs(pct(r[1], r[2])) <= 1, `${name} ${k} ±1%: ${report}`); }
    assert.ok(Math.abs(height - s.heightIn) / s.heightIn < 0.005, `height ${height}`);
    assert.ok(Math.abs(floor) < 0.05);
    assert.equal(fit.sex, 'female');
  });
}

test('female head matches ANSUR II female medians (scaled weakly with stature) and the neck transition is kept', () => {
  const fit = fits.typical, { pos } = measure(fit), hd = headDims(A, pos), HT = headTargets(64, 'female');
  assert.equal(HT.breadth, HEAD_REF_F.breadth);
  for (const k of ['breadth', 'length', 'bizygomatic', 'height']) assert.ok(Math.abs(pct(hd[k], HT[k])) <= 3, `${k} ${hd[k].toFixed(2)} vs ${HT[k].toFixed(2)}`);
  assert.ok(headTargets(64, 'female').breadth < headTargets(64, 'male').breadth);
  assert.ok(fit.report.smooth.roughAfter < fit.report.smooth.roughBefore);
});

test('every pose works on the female mesh: finite, grounded, upright', () => {
  for (const fit of Object.values(fits)) {
    for (const name of POSES) {
      const pose = poseGlobals({ A, rest: fit.heads, frames: fit.frames, geom: fit.geom, sections: fit.sections, joints: fit.joints }, name);
      const { M } = skinMatrices(A, fit.heads, pose), pos = skinPositions(A, fit.rest, M);
      let ymin = Infinity, ymax = -Infinity;
      for (let i = 0; i < A.nMesh; i++) { assert.ok(Number.isFinite(pos[i * 3]) && Number.isFinite(pos[i * 3 + 1]) && Number.isFinite(pos[i * 3 + 2])); if (P[i] === 4 || P[i] === 5) ymin = Math.min(ymin, pos[i * 3 + 1]); ymax = Math.max(ymax, pos[i * 3 + 1]); }
      assert.ok(ymin > -1.5 && ymin < 1.5, `${name} floor ${ymin}`);
      assert.ok(ymax > fit.geom.heightIn * 0.85, `${name} top ${ymax}`);
    }
  }
});

test('cup size follows bust / underbust (min cup for small ratios), stations still hit both tapes', () => {
  const P0 = Float32Array.from(A.base);
  const w = [1.05, 1.15, 1.25, 1.4].map(r => cupWeight(A, P0, r));
  for (let i = 1; i < w.length; i++) assert.ok(w[i] >= w[i - 1], `monotone ${w}`);
  assert.equal(w[0], -1); assert.equal(w[3], 1);
  assert.equal(cupWeight(AM, Float32Array.from(AM.base), 1.2), 0);   // male: no cups
  const big = fitBody(A, { shape: { ...BODIES.typical.shape, chest: 40, underbust: 31 }, bodyFatPct: 36, muscle: MU(0.26) });
  assert.ok(big.cup > fits.typical.cup, `cup ${big.cup} vs ${fits.typical.cup}`);
  const { g } = measure(big);
  assert.ok(Math.abs(pct(g.chest, 40)) <= 1 && Math.abs(pct(g.underbust, 31)) <= 3, `bust ${g.chest} underbust ${g.underbust}`);
});

test('modesty: the nipples / crease are smoothed before the fit (nothing shows through the painted-on top)', () => {
  const fit = fits.typical, { off, idx } = A.adj;
  const prot = (Q, i) => { let x = 0, y = 0, z = 0; for (let o = off[i]; o < off[i + 1]; o++) { const j = idx[o]; x += Q[j * 3]; y += Q[j * 3 + 1]; z += Q[j * 3 + 2]; } const k = off[i + 1] - off[i]; return Math.hypot(Q[i * 3] - x / k, Q[i * 3 + 1] - y / k, Q[i * 3 + 2] - z / k); };
  const n = A.lm.nippleV;
  assert.ok(prot(fit.rest, n) < 0.03, `nipple protrusion ${prot(fit.rest, n).toFixed(3)} in`);   // base mesh ≈ 0.08 in
  assert.ok(A.modesty[n] > 0.9 && A.modesty[A.lm.navelV] === 0);
});

test('hair bun: renderer-only geometry behind the crown, outside the body arrays', () => {
  const fit = fits.typical, b = fit.bun;
  assert.ok(b && b.pos.length === A.bun.n * 3 && b.nrm.length === b.pos.length);
  assert.equal(fit.rest.length, A.nMesh * 3);   // the fitted body arrays are unchanged in size
  for (const f of Object.values(fits)) {   // every stature: behind the crown (the back of the skull is sparsely meshed)
    const H = f.geom.heightIn, c = f.bun.center;
    assert.ok(c[1] > H - 3.5 && c[1] < H, `bun y ${c[1]} (H ${H})`);
    assert.ok(c[2] < f.geom.head.center.z - 2, `bun z ${c[2]} (H ${H})`);
    assert.ok(f.bun.radius > 0.9 && f.bun.radius < 1.8);
  }
  assert.equal(placeBun(AM, fit.rest), null);
});

test('muscle scores: absolute FFMI scale, shifted onto the sex-relative MakeHuman axis for the female mesh', () => {
  const e = effectiveMuscle({ arms: 0.2, chest: 0.9 }, 'female');
  assert.ok(Math.abs(e.arms - (0.2 + FEMALE_MUSCLE_SHIFT)) < 1e-12 && e.chest === 1);
  assert.equal(effectiveMuscle({ arms: 0.2 }, 'male').arms, 0.2);
  assert.ok(Math.abs(FEMALE_MUSCLE_SHIFT - 3.5 / 9) < 1e-12);
});

test('body-fat calibration (DXA-equivalent, heuristic): smooth, monotone, sex-shifted, muscle-scaled', () => {
  assert.equal(BF_CAL.male.avg, 25); assert.equal(BF_CAL.female.avg, 36);
  for (const k of ['absStart', 'absFull', 'sepStart', 'sepFull']) assert.equal(BF_CAL.female[k] - BF_CAL.male[k], 8);
  for (const sex of ['male', 'female']) {
    let prev = null;
    for (let bf = 6; bf <= 45; bf += 0.25) {
      const d = definitionLevels(bf, 0.5, sex);
      if (prev) {
        for (const k of ['upper', 'full', 'sep']) {
          assert.ok(d[k] <= prev[k] + 1e-12, `${sex} ${k} not monotone at ${bf}`);
          assert.ok(Math.abs(d[k] - prev[k]) < 0.13, `${sex} ${k} jumps at ${bf}: ${prev[k]} → ${d[k]}`);   // no hard cutoffs
        }
      }
      prev = d;
    }
  }
  const c = BF_CAL.male;
  assert.equal(definitionLevels(c.absStart + 0.5, 0.5).upper, 0);   // no ab outline above ≈ 18 % (men)
  assert.ok(definitionLevels(c.absFull, 0.5).full > 0.9 * definitionLevels(8, 0.5).full);   // full abs by ≈ 12.5 %
  assert.equal(definitionLevels(c.sepStart + 0.5, 0.5).sep, 0);
  assert.ok(definitionLevels(18, 0.9).sep > definitionLevels(18, 0.2).sep);   // separation scales with muscle
  assert.equal(definitionLevels(24, 0.5, 'female').full, 0);                    // a woman at 24 % shows no full six-pack
  assert.ok(definitionLevels(24, 0.5, 'female').upper > 0);                     // … but an upper-ab outline
  assert.ok(definitionLevels(14, 0.5, 'male').full > definitionLevels(22, 0.5, 'female').full);
});
