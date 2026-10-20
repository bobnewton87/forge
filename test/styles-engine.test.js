// STYLES: the style model (built-ins unchanged), Hypertrophy · Time-saver ('efficient'), custom styles
// in buildWorkout, pairing safety, and restyle().
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkout, estimateMinutes, restyle, swapBlock, addExercise, resolveStyle, normalizeCustomStyle, styleOptions,
  STYLE_DEFS, BUILTIN_STYLES, PAIRINGS, STYLE_EVIDENCE, sharesLimiter, competes, TIME,
} from '../js/engine/generator.js';
import { getEx } from '../js/data/exercises.js';
import { REGIONS } from '../js/data/muscles.js';
import { DEFAULT_LOCATIONS } from '../js/data/equipment.js';

const NOW = new Date(2026, 9, 10, 7, 0, 0);
const LOC = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.id, l]));
const PROFILE = { sculptGoals: ['triceps_mass', 'shoulder_width', 'six_pack', 'lat_width', 'upper_chest'], groupPriority: {}, avoidExercises: [], favoriteExercises: [] };
const lifts = s => s.blocks.filter(b => b.kind === 'lift');
const groupsOf = s => {
  const m = new Map();
  for (const b of lifts(s)) if (b.group) { if (!m.has(b.group)) m.set(b.group, []); m.get(b.group).push(b); }
  return [...m.values()];
};
const pg = ex => { let best = null, bw = -1; for (const [r, w] of Object.entries(ex.muscles)) if (w > bw) { best = r; bw = w; } return REGIONS[best]?.group; };

test('built-in style parameters match the legacy tables', () => {
  assert.deepEqual(BUILTIN_STYLES, ['hypertrophy', 'efficient', 'pump', 'strength', 'circuit']);
  const legacy = { hypertrophy: [90, 120, 60, 'accessory'], pump: [60, 60, 45, 'superset'], strength: [150, 180, 75, 'none'], circuit: [60, 60, 60, 'circuit'] };
  for (const [id, [c, h, i, p]] of Object.entries(legacy)) {
    const d = resolveStyle(id);
    assert.equal(d, STYLE_DEFS[id]);
    assert.deepEqual([d.restCompound, d.restHeavy, d.restIsolation, d.pairing], [c, h, i, p], id);
  }
  assert.equal(resolveStyle('yoga').id, 'hypertrophy');
  assert.equal(resolveStyle('cs_missing', { customStyles: [] }).id, 'hypertrophy');
  // round rests (legacy roundRest): hypertrophy 75/60 (≤25 min: 60/45), pump 45/30 (tri 45), strength 120/75, circuit 75 (≤20: 60)
  assert.deepEqual([STYLE_DEFS.hypertrophy.round(true, 2, 45), STYLE_DEFS.hypertrophy.round(false, 2, 45), STYLE_DEFS.hypertrophy.round(true, 2, 20), STYLE_DEFS.hypertrophy.round(false, 2, 20)], [75, 60, 60, 45]);
  assert.deepEqual([STYLE_DEFS.pump.round(true, 2), STYLE_DEFS.pump.round(false, 2), STYLE_DEFS.pump.round(false, 3)], [45, 30, 45]);
  assert.deepEqual([STYLE_DEFS.strength.round(true), STYLE_DEFS.strength.round(false)], [120, 75]);
  assert.deepEqual([STYLE_DEFS.circuit.round(true, 4, 20), STYLE_DEFS.circuit.round(true, 4, 45)], [60, 75]);
});

test('built-ins keep their arrangement: strength straight, pump paired, circuit ≤2 rounds, hypertrophy compounds solo', () => {
  const st = buildWorkout({ targets: ['upper'], minutes: 60, location: LOC.crunch, profile: PROFILE, now: NOW, style: 'strength', seed: 4 });
  assert.equal(lifts(st).filter(b => b.group).length, 0);
  const pu = buildWorkout({ targets: ['upper'], minutes: 45, location: LOC.crunch, profile: PROFILE, now: NOW, style: 'pump', seed: 4 });
  assert.ok(lifts(pu).filter(b => b.group).length >= lifts(pu).length - 1);
  const ci = buildWorkout({ targets: ['full'], minutes: 30, location: LOC.home, profile: PROFILE, now: NOW, style: 'circuit', seed: 4 });
  assert.ok(new Set(lifts(ci).map(b => b.group)).size <= 2);
  const hy = buildWorkout({ targets: ['chest', 'back'], minutes: 60, location: LOC.crunch, profile: PROFILE, now: NOW, style: 'hypertrophy', seed: 4 });
  for (const b of lifts(hy)) if (getEx(b.exId).category === 'compound' && ['chest', 'back'].includes(pg(getEx(b.exId)))) assert.equal(b.group, null, b.exId);
  for (const s of [st, pu, ci, hy]) { assert.equal(s.styleDef, undefined); assert.equal(s.styleName, undefined); }
  // style object path = id path
  const a = buildWorkout({ targets: ['upper'], minutes: 45, location: LOC.home, profile: PROFILE, now: NOW, style: 'pump', seed: 9 });
  const b = buildWorkout({ targets: ['upper'], minutes: 45, location: LOC.home, profile: PROFILE, now: NOW, style: STYLE_DEFS.pump, seed: 9 });
  assert.deepEqual({ ...a, id: 0 }, { ...b, id: 0 });
});

// "Same exercises and sets": build plain hypertrophy, then restyle the same blocks both ways (nominal rests).
const CASES = [];
for (const loc of DEFAULT_LOCATIONS) for (const targets of [['upper'], ['push'], ['pull'], ['full'], ['legs'], ['back', 'biceps'], ['chest', 'triceps'], ['shoulders', 'triceps']]) for (const minutes of [30, 45, 60, 75]) CASES.push({ loc, targets, minutes });

test('Time-saver takes ~25-35% less time than Hypertrophy for the same exercises and sets', () => {
  const sv = [];
  for (const { loc, targets, minutes } of CASES) {
    const h = buildWorkout({ targets, minutes, location: loc, profile: PROFILE, now: NOW, seed: 5 });
    const hn = restyle(h, 'hypertrophy'), e = restyle(h, 'efficient');
    // same exercises, same set counts
    const key = s => lifts(s).map(b => `${b.exId}:${b.target.sets}`).sort().join(',');
    assert.equal(key(e), key(h)); assert.equal(key(hn), key(h));
    assert.equal(e.estMinutes, estimateMinutes(e.blocks));
    assert.ok(e.estMinutes <= hn.estMinutes, `${loc.id} ${targets} ${minutes}: efficient ${e.estMinutes} > hypertrophy ${hn.estMinutes}`);
    sv.push(1 - e.estMinutes / hn.estMinutes);
  }
  const mean = sv.reduce((a, b) => a + b, 0) / sv.length;
  assert.ok(mean >= 0.25 && mean <= 0.35, `mean saving ${(mean * 100).toFixed(1)}%`);
  // whole-body / upper sessions (lots of non-competing partners) all save at least 25%
  for (const { loc, targets, minutes } of CASES.filter(c => ['upper', 'full'].includes(c.targets[0]))) {
    const h = buildWorkout({ targets, minutes, location: loc, profile: PROFILE, now: NOW, seed: 5 });
    const s = 1 - restyle(h, 'efficient').estMinutes / restyle(h, 'hypertrophy').estMinutes;
    assert.ok(s >= 0.25, `${loc.id} ${targets} ${minutes}: ${(s * 100).toFixed(0)}%`);
  }
});

test('Time-saver: hypertrophy reps, ~90/60 s per muscle, rest after the pair, fits the time budget', () => {
  const d = resolveStyle('efficient');
  assert.equal(d.base, 'hypertrophy'); assert.equal(d.pairing, 'antagonist');
  assert.deepEqual([d.restCompound, d.restIsolation], [90, 60]);
  assert.equal(STYLE_EVIDENCE.length, 3);
  for (const minutes of [30, 45, 60, 75, 90]) for (const loc of [LOC.crunch, LOC.home]) {
    const e = buildWorkout({ targets: ['upper'], minutes, location: loc, profile: PROFILE, now: NOW, style: 'efficient', seed: 3 });
    const h = buildWorkout({ targets: ['upper'], minutes, location: loc, profile: PROFILE, now: NOW, style: 'hypertrophy', seed: 3 });
    assert.equal(e.style, 'efficient');
    if (!e.poolLimited) assert.ok(Math.abs(e.estMinutes - minutes) <= minutes * 0.1, `${loc.id} ${minutes}: ${e.estMinutes}`);
    const sets = s => lifts(s).reduce((n, b) => n + b.target.sets, 0);
    assert.ok(sets(e) >= sets(h), `${minutes}: time-saver fits at least as many sets (${sets(e)} vs ${sets(h)})`);
    for (const b of lifts(e)) {   // hypertrophy rep ranges
      const ex = getEx(b.exId);
      if (ex.unit === 'seconds') continue;
      assert.ok(b.target.repMin >= 6 && b.target.repMax <= 20, `${b.exId} ${b.target.repMin}-${b.target.repMax}`);
    }
    for (const g of groupsOf(e)) {
      g.slice(0, -1).forEach(b => assert.equal(b.target.rest, TIME.transitionSec));
      const last = g[g.length - 1];
      assert.ok(last.target.rest >= 30, 'pair rest floor');
      // each muscle's real rest between its own sets ≈ the style rest (≥ ~85% of it)
      const anyComp = g.some(b => getEx(b.exId).category === 'compound');
      const R = anyComp ? 90 : 60;
      const work = b => (b.target.reps ?? b.target.repMin) * (getEx(b.exId).secPerRep ?? 3) * (getEx(b.exId).unilateral ? 2 : 1);
      for (const b of g) {
        const others = g.filter(x => x !== b).reduce((n, x) => n + work(x), 0);
        const eff = last.target.rest + (g.length - 1) * TIME.transitionSec + others;
        assert.ok(eff >= R * 0.75, `${minutes} ${b.exId}: ${eff}s effective rest`);
      }
    }
    // solo sets: compound ≈90, isolation ≈60 (time fitter may flex ±10%)
    for (const b of lifts(e).filter(x => !x.group)) {
      const R = getEx(b.exId).category === 'compound' ? 90 : 60;
      assert.ok(b.target.rest >= R * 0.85 && b.target.rest <= R * 1.25, `${b.exId} rest ${b.target.rest}`);
    }
  }
});

test('no paired moves share a limiting muscle; antagonist pairs never compete', () => {
  const custom = { id: 'cs_1', name: 'Pairs', base: 'hypertrophy', restCompound: 75, restIsolation: 45, pairing: 'antagonist' };
  let pairs = 0;
  for (const style of ['efficient', 'hypertrophy', 'pump', custom]) for (const loc of DEFAULT_LOCATIONS) for (const targets of [['upper'], ['full'], ['arms'], ['shoulders', 'triceps'], ['back', 'biceps'], ['push'], []]) for (const minutes of [20, 30, 45, 60]) {
    const s = buildWorkout({ targets, minutes, location: loc, profile: PROFILE, now: NOW, style, seed: 7 });
    const anta = resolveStyle(style).pairing === 'antagonist' && minutes > 25;
    for (const g of groupsOf(s)) {
      if (resolveStyle(style).pairing === 'circuit') continue;
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = getEx(g[i].exId), b = getEx(g[j].exId);
        assert.ok(!sharesLimiter(a, b), `${resolveStyle(style).id} ${targets} ${minutes}: ${a.id} + ${b.id} share a limiter`);
        if (anta) assert.ok(!competes(a, b), `${a.id} + ${b.id} compete`);
        pairs++;
      }
    }
  }
  assert.ok(pairs > 200);
});

test('custom styles: rests, pairing, reps and sets are respected by buildWorkout', () => {
  const straight = { id: 'cs_a', name: 'Long rests', base: 'hypertrophy', restCompound: 120, restIsolation: 45, pairing: 'none' };
  const profile = { ...PROFILE, customStyles: [straight] };
  for (const minutes of [20, 45, 60]) {
    const s = buildWorkout({ targets: ['upper'], minutes, location: LOC.crunch, profile, now: NOW, style: 'cs_a', seed: 2 });
    assert.equal(s.style, 'cs_a'); assert.equal(s.styleName, 'Long rests'); assert.deepEqual(s.styleDef, normalizeCustomStyle(straight));
    assert.equal(lifts(s).filter(b => b.group).length, 0, 'straight sets only, even short');
    for (const b of lifts(s)) assert.equal(b.target.rest, getEx(b.exId).category === 'compound' ? 120 : 45, b.exId);
    if (!s.poolLimited) assert.ok(Math.abs(s.estMinutes - minutes) <= minutes * 0.1, `${minutes}: ${s.estMinutes}`);
  }
  const ss = buildWorkout({ targets: ['upper'], minutes: 45, location: LOC.crunch, profile: PROFILE, now: NOW, seed: 2,
    style: { name: 'Fast', base: 'pump', restCompound: 50, restIsolation: 35, pairing: 'superset', repMin: 6, repMax: 10, setsPerExercise: 3 } });
  assert.ok(groupsOf(ss).length >= 2);
  for (const g of groupsOf(ss)) {
    g.slice(0, -1).forEach(b => assert.equal(b.target.rest, TIME.transitionSec));
    const last = g[g.length - 1]; assert.equal(last.target.rest, g.some(b => getEx(b.exId).category === 'compound') ? 50 : 35);
  }
  for (const b of lifts(ss)) {
    assert.equal(b.target.sets, 3, 'fixed sets per exercise');
    if (getEx(b.exId).unit !== 'seconds') assert.deepEqual([b.target.repMin, b.target.repMax], [6, 10]);
  }
  const ci = buildWorkout({ targets: ['full'], minutes: 30, location: LOC.home, profile: PROFILE, now: NOW, seed: 2, style: { name: 'C', base: 'circuit', restCompound: 90, restIsolation: 90, pairing: 'circuit' } });
  assert.ok(new Set(lifts(ci).map(b => b.group)).size <= 2);
  assert.ok(lifts(ci).some(b => b.target.rest === TIME.circuitTransitionSec));
  // the session carries its style: swap / add keep the custom rests without the profile
  const s = buildWorkout({ targets: ['chest'], minutes: 45, location: LOC.crunch, profile, now: NOW, style: 'cs_a', seed: 2 });
  const added = addExercise(s, 'db_curl', { now: NOW });
  assert.equal(added.blocks.find(b => b.exId === 'db_curl').target.rest, 45);
  const i = s.blocks.findIndex(b => b.kind === 'lift' && getEx(b.exId).category === 'isolation');
  if (i >= 0) {
    const sw = swapBlock(s, i, 'db_bench', { now: NOW });
    assert.equal(sw.blocks[i].target.rest, 120);
  }
});

test('restyle keeps exercises, set counts and non-lift blocks; options list built-ins + custom', () => {
  const h = buildWorkout({ targets: ['upper'], minutes: 60, location: LOC.crunch, profile: PROFILE, now: NOW, seed: 1, cardio: { modality: 'bike', minutes: 10 } });
  const r = restyle(h, { id: 'cs_z', name: 'Z', base: 'strength', restCompound: 180, restIsolation: 90, pairing: 'none' });
  assert.equal(r.style, 'cs_z'); assert.equal(r.styleName, 'Z');
  assert.equal(r.blocks.at(-1).kind, 'cardio');
  assert.equal(lifts(r).length, lifts(h).length);
  assert.ok(r.estMinutes > h.estMinutes, 'longer rests take longer');
  const opts = styleOptions({ customStyles: [{ id: 'cs_q', name: 'Q', base: 'pump', restCompound: 40, restIsolation: 30, pairing: 'superset' }] });
  assert.deepEqual(opts.map(o => o.id), [...BUILTIN_STYLES, 'cs_q']);
  assert.ok(opts.find(o => o.id === 'cs_q').custom && /40\/30 s/.test(opts.find(o => o.id === 'cs_q').hint));
  assert.ok(PAIRINGS.includes('antagonist'));
});
