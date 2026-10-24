// §26 OVERLOAD: the whole-workout working-set ceiling (every style, built-in and custom), what the
// generator does when it binds, the planner never planning past it, and the overload warning + "Trim to
// N" for workouts the user builds or edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkout, workingSets, sessionLoad, trimToCap, muscleSessionCap, capLine, addExercise, STYLE_DEFS, resolveStyle } from '../js/engine/generator.js';
import { planRange, weekPlanSummary } from '../js/engine/planner.js';
import { resolveTargets, applyTargetChange, sessionSetCapOf, needsReplan, describeChange, LIMITS, SESSION_CAP_INFO, SESSION_CAP_DEFAULT } from '../js/engine/targets.js';
import { DEFAULT_LOCATIONS } from '../js/data/equipment.js';
import { getEx } from '../js/data/exercises.js';
import { defaultProfile } from '../js/store.js';
import { parseDs } from '../js/util.js';

const NOW = new Date(2026, 9, 24, 7, 0);
const LOC = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.id, l]));
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, ...patch });
const lifts = s => s.blocks.filter(b => b.kind === 'lift');
const CUSTOM = [
  { id: 'cs_pairs', name: 'Quick pairs', base: 'hypertrophy', restCompound: 75, restIsolation: 45, pairing: 'antagonist' },
  { id: 'cs_ss', name: 'Supersets', base: 'pump', restCompound: 50, restIsolation: 30, pairing: 'superset' },
  { id: 'cs_circ', name: 'Circuit', base: 'circuit', restCompound: 40, restIsolation: 40, pairing: 'circuit' },
  { id: 'cs_long', name: 'Long rests', base: 'strength', restCompound: 180, restIsolation: 90, pairing: 'none', setsPerExercise: 5 },
];

test('ceiling: the resolver owns it (default 30, clamped 12-50, null resets) and a change re-plans', () => {
  assert.equal(SESSION_CAP_DEFAULT, 30);
  assert.deepEqual(LIMITS.sessionSetCap, [12, 50]);
  assert.equal(sessionSetCapOf({}), 30);
  assert.equal(resolveTargets(prof()).training.sessionSetCap, 30);
  for (const [v, want] of [[24, 24], [5, 12], [99, 50], ['36', 36], [NaN, 30], [null, 30]]) {
    const p = applyTargetChange(prof({ sessionSetCap: 40 }), { training: { sessionSetCap: v } });
    assert.equal(resolveTargets(p).training.sessionSetCap, Number.isNaN(v) ? 40 : want, `set ${v}`);
  }
  const a = prof(), b = applyTargetChange(a, { training: { sessionSetCap: 24 } });
  assert.ok(needsReplan(a, b), 'the ceiling changes what the planner builds');
  assert.match(describeChange(a, b), /at most 24 working sets a workout/);
});

test('ceiling: the "why" is labelled a convention and cites only the sources the audit verified', () => {
  const all = [SESSION_CAP_INFO.short, SESSION_CAP_INFO.label, SESSION_CAP_INFO.text].join(' ');
  assert.match(all, /convention/);
  assert.match(SESSION_CAP_INFO.text, /no study has found a per-workout set limit/);
  assert.ok(!/proven|measured ceiling|optimal/i.test(all.replace('not a measured limit', '')), all);
  const src = SESSION_CAP_INFO.evidence.map(e => e.source).join(' ');
  assert.match(src, /10\.1007\/s40279-025-02344-w/);         // Pelland 2025: no per-session plateau
  assert.match(src, /10\.1519\/JSC\.0000000000005665/);      // Calzavara & Barroso 2026: 58-76% more volume load spread
  assert.ok(SESSION_CAP_INFO.evidence.some(e => /58-76%/.test(e.claim)));
});

test('ceiling: a 60-minute Time-saver workout stays at or under 30 working sets and finishes early', () => {
  // Bob's case: "Hypertrophy · Time-saver", 60 min, gave 48 sets.
  for (const loc of [LOC.crunch, LOC.home]) for (const targets of [[], ['upper'], ['push'], ['back', 'biceps'], ['shoulders', 'triceps']]) for (const seed of [1, 2, 3]) {
    const s = buildWorkout({ targets, minutes: 60, location: loc, profile: prof(), now: NOW, style: 'efficient', seed });
    const n = workingSets(s), tag = `${loc.id} ${targets.join('+') || 'auto'} ${seed}`;
    assert.ok(n <= 30, `${tag}: ${n} working sets`);
    if (s.capped) {
      assert.equal(s.capped.cap, 30); assert.equal(s.capped.sets, n);
      assert.equal(s.capped.freedMin, Math.max(0, 60 - s.estMinutes), tag);
      assert.ok(s.capped.restScale >= 1 && s.capped.restScale <= STYLE_DEFS.efficient.restFlex[2] + 1e-9, `${tag}: rests ×${s.capped.restScale} past the style's allowance`);
      assert.ok(s.rationale.includes(capLine(s.capped)), `${tag}: the capped line is in the rationale`);
      assert.ok(!s.poolLimited, tag);
      assert.ok(!s.rationale.some(r => /^Added .* to fill/.test(r)), `${tag}: a capped workout never claims a group was added "to fill" the time`);
    }
  }
  const s = buildWorkout({ targets: ['upper'], minutes: 60, location: LOC.crunch, profile: prof(), now: NOW, style: 'efficient', seed: 3 });
  assert.ok(s.capped && s.capped.freedMin >= 8, `the reported case finishes well early: ${JSON.stringify(s.capped)} est ${s.estMinutes}`);
  assert.match(capLine(s.capped), /^Capped at .*finishes ~\d+′ early\. Past this, extra sets mostly add fatigue/);
});

test('ceiling: every built-in and custom style, 20-90 min, any place, never passes it', () => {
  const p = prof({ customStyles: CUSTOM });
  let capped = 0;
  for (const style of ['hypertrophy', 'efficient', 'pump', 'strength', 'circuit', ...CUSTOM.map(c => c.id)]) for (const loc of [LOC.crunch, LOC.home, LOC.travel]) for (const minutes of [20, 45, 60, 90]) {
    const s = buildWorkout({ targets: ['upper'], minutes, location: loc, profile: p, now: NOW, style, seed: 4 });
    assert.ok(workingSets(s) <= 30, `${style} ${loc.id} ${minutes}: ${workingSets(s)}`);
    if (s.capped) capped++;
    // a style with no rest allowance (custom: restFlex [1,1,1]) just finishes early
    if (s.capped && resolveStyle(style, p).custom) assert.equal(s.capped.restScale, 1, `${style}: custom rests stay as set`);
    if (!s.capped && !s.poolLimited) assert.ok(Math.abs(s.estMinutes - minutes) <= minutes * 0.1, `${style} ${loc.id} ${minutes}: ${s.estMinutes}`);
  }
  assert.ok(capped > 20, `the ceiling binds for long / dense styles (${capped})`);
  // a lower personal ceiling, and the explicit option, both hold
  const p20 = prof({ sessionSetCap: 20, customStyles: CUSTOM });
  for (const style of ['efficient', 'cs_ss', 'cs_long', 'circuit']) {
    const s = buildWorkout({ targets: [], minutes: 75, location: LOC.crunch, profile: p20, now: NOW, style, seed: 9 });
    assert.ok(workingSets(s) <= 20, `${style}: ${workingSets(s)} over a 20-set ceiling`);
  }
  assert.ok(workingSets(buildWorkout({ targets: ['upper'], minutes: 90, location: LOC.crunch, profile: prof(), now: NOW, style: 'pump', seed: 1, setCap: 14 })) <= 14);
  // a higher ceiling lets a long dense workout use more of its time
  const hi = buildWorkout({ targets: ['upper'], minutes: 75, location: LOC.crunch, profile: prof({ sessionSetCap: 50 }), now: NOW, style: 'efficient', seed: 3 });
  assert.ok(workingSets(hi) > 30 && workingSets(hi) <= 50, `ceiling 50: ${workingSets(hi)}`);
});

test('ceiling: rests lengthen within the style allowance before the workout finishes early', () => {
  const s = buildWorkout({ targets: ['upper'], minutes: 90, location: LOC.crunch, profile: prof(), now: NOW, style: 'hypertrophy', seed: 2 });
  assert.ok(s.capped, 'a 90-min hypertrophy workout hits 30 sets');
  assert.ok(s.capped.restScale > 1, `rests lengthened first (×${s.capped.restScale})`);
  assert.ok(s.capped.restScale <= STYLE_DEFS.hypertrophy.restFlex[2] + 1e-9, 'never past the relaxed allowance');
  for (const b of lifts(s).filter(x => !x.group)) {
    const ex = getEx(b.exId), base = ex.category === 'compound' ? ((ex.fatigue || 1) >= 3 ? 120 : 90) : 60;
    assert.ok(b.target.rest <= Math.round(base * STYLE_DEFS.hypertrophy.restFlex[2] / 5) * 5 + 5, `${b.exId} rest ${b.target.rest}`);
  }
});

test('ceiling: the planner never plans a day past it, over four weeks and a lower personal ceiling', () => {
  const MON = '2026-10-26', NOW2 = new Date(2026, 9, 26, 7);
  for (const [name, p] of [['default', prof()], ['time-saver', prof({ defaultStyle: 'efficient' })], ['ceiling 20', prof({ sessionSetCap: 20 })],
    ['sliders 2', prof({ groupPriority: { triceps: 2, shoulders: 2, chest: 2, back: 2 } })]]) {
    const out = planRange({ from: MON, days: name === 'default' ? 28 : 7, profile: p, sessions: [], now: NOW2, seed: 5 });
    const cap = sessionSetCapOf(p);
    for (const s of out.filter(x => (x.blocks || []).some(b => b.kind === 'lift'))) {
      assert.ok(workingSets(s) <= cap, `${name} ${s.date}: ${workingSets(s)} > ${cap}`);
      assert.ok(!sessionLoad(s, p).heavy, `${name} ${s.date}: the plan trips its own overload warning ${JSON.stringify(sessionLoad(s, p))}`);
    }
    const sum = weekPlanSummary(out, { weekStart: parseDs(MON), profile: p, now: NOW2 });
    assert.equal(sum.capacity.setCap, cap);
    assert.equal(sum.capacity.maxSets, sum.capacity.liftDays * cap);
  }
});

test('overload: workouts Forge builds never trip the warning; edited ones do, with the numbers', () => {
  for (const style of ['hypertrophy', 'efficient', 'pump', 'circuit']) for (const loc of [LOC.home, LOC.crunch, LOC.travel]) for (const targets of [['chest'], ['biceps'], ['arms'], ['legs'], ['core'], []]) for (const minutes of [30, 60, 90]) {
    const s = buildWorkout({ targets, minutes, location: loc, profile: prof(), now: NOW, style, seed: 6 });
    const L = sessionLoad(s, prof());
    assert.ok(!L.heavy, `${style} ${loc.id} ${targets} ${minutes}: ${JSON.stringify(L)}`);
  }
  // Bob piles exercises onto a generated workout
  let s = buildWorkout({ targets: ['upper'], minutes: 60, location: LOC.crunch, profile: prof(), now: NOW, style: 'efficient', seed: 3 });
  for (const id of ['cable_curl', 'db_hammer', 'cable_lateral', 'tri_pushdown', 'pec_deck']) s = addExercise(s, id, { sessions: [], now: NOW });
  const L = sessionLoad(s, prof());
  assert.ok(L.over && L.sets > 30 && L.excess === L.sets - 30, JSON.stringify(L));
  assert.equal(L.cap, 30);
  // a personal ceiling moves the warning with it
  assert.equal(sessionLoad(s, prof({ sessionSetCap: 50 })).over, false);
  // per-muscle: direct sets past the per-session cap (starred muscles get the priority allowance of 12)
  const tri = { minutes: 45, blocks: ['tri_pushdown', 'cable_oh_ext', 'db_skull', 'cable_rope_pushdown'].map(exId => ({ kind: 'lift', exId, target: { sets: 4 }, sets: Array.from({ length: 4 }, () => ({ w: null, r: null, done: false })) })) };
  const lt = sessionLoad(tri, prof());
  assert.equal(lt.over, false);
  assert.deepEqual(lt.muscles.map(m => [m.group, m.sets, m.cap]), [['triceps', 16, muscleSessionCap('triceps', 45, true)]]);
  assert.equal(muscleSessionCap('triceps', 45, true), 12);
  assert.equal(muscleSessionCap('biceps', 45, false), 8);
  assert.equal(muscleSessionCap('chest', 80, false), 12);
});

test('trim: "Trim to 30" removes sets from the least-needed exercises first and never touches logged sets', () => {
  const big = buildWorkout({ targets: ['upper'], minutes: 75, location: LOC.crunch, profile: prof(), now: NOW, style: 'efficient', seed: 3, setCap: 99 });
  assert.ok(workingSets(big) >= 45, `fixture: an overloaded workout (${workingSets(big)})`);
  // two sets of the first exercise are already logged
  big.blocks[0].sets[0] = { w: 50, r: 10, done: true }; big.blocks[0].sets[1] = { w: 50, r: 9, done: true };
  const { session: t, removed } = trimToCap(big, 30, { profile: prof(), sessions: [], now: NOW });
  assert.ok(workingSets(t) <= 30 && workingSets(t) >= 27, `trimmed to ${workingSets(t)}`);
  assert.ok(removed.length && removed.every(r => r.to < r.from), JSON.stringify(removed));
  assert.equal(t.blocks[0].sets.filter(x => x.done).length, 2, 'logged sets kept');
  assert.ok(lifts(t).length >= 4, 'still a real workout');
  assert.ok(lifts(t).every(b => b.target.sets === b.sets.length && b.sets.length >= 2), 'rows and targets agree, ≥2 sets each');
  // no orphaned superset letter, and the estimate is refreshed
  const groups = {}; lifts(t).forEach(b => { if (b.group) groups[b.group] = (groups[b.group] || 0) + 1; });
  assert.ok(Object.values(groups).every(n => n >= 2), JSON.stringify(groups));
  assert.ok(t.estMinutes < big.estMinutes);
  // the input is not mutated, and an already-light workout comes back unchanged
  assert.ok(workingSets(big) >= 45);
  const light = buildWorkout({ targets: ['upper'], minutes: 45, location: LOC.crunch, profile: prof(), now: NOW, seed: 1 });
  assert.deepEqual(trimToCap(light, 30, { profile: prof() }).removed, []);
  // muscles only (cap null): a muscle past its per-session cap comes back under it
  const bi = { minutes: 45, targets: ['biceps'], blocks: ['cable_curl', 'db_hammer', 'db_incline_curl', 'ez_curl'].map(exId => ({ kind: 'lift', exId, group: null, target: { sets: 4, rest: 60 }, sets: Array.from({ length: 4 }, () => ({ w: null, r: null, done: false })) })) };
  const tb = trimToCap(bi, null, { profile: prof(), muscles: true }).session;
  assert.ok(!sessionLoad(tb, prof()).muscles.length, JSON.stringify(sessionLoad(tb, prof())));
});
