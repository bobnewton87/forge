// ENGINE-B tests: generator.js. Property-based so they survive the library growing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkout, estimateMinutes, alternatives, swapBlock, addExercise, exercisesFor, isBackSquat, workingSets } from '../js/engine/generator.js';
import { EXERCISES, getEx } from '../js/data/exercises.js';
import { DEFAULT_LOCATIONS, expandEquipment, canDo } from '../js/data/equipment.js';
import { SCULPT_GOALS } from '../js/data/sculpt.js';
import { recommend } from '../js/engine/recovery.js';
import { suggest } from '../js/engine/progression.js';

const NOW = new Date(2026, 9, 10, 7, 0, 0);
const LOC = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.id, l]));
const PROFILE = { sculptGoals: ['triceps_mass', 'shoulder_width', 'six_pack', 'lat_width', 'upper_chest'], groupPriority: {}, avoidExercises: [], favoriteExercises: [] };
const MINUTES = [15, 20, 30, 45, 60, 75, 90];
const TARGET_SETS = [[], ['back', 'biceps'], ['upper'], ['shoulders', 'triceps'], ['legs']];
const BIG_LIBRARY = EXERCISES.length >= 200; // full library merged → pool-limited should be rare

const lifts = s => s.blocks.filter(b => b.kind === 'lift');
const ago = n => { const d = new Date(NOW); d.setDate(d.getDate() - n); return d; };
const dstr = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function history() {
  return [
    { id: 's_h1', date: dstr(ago(6)), status: 'done', location: 'home', minutes: 45, title: 'Pull', targets: ['pull'], source: 'generated', notes: '', rationale: [],
      blocks: [
        { kind: 'lift', exId: 'db_curl', group: null, target: { sets: 3, repMin: 8, repMax: 12, rest: 60, weight: 30, reps: 10, note: null },
          sets: [{ w: 30, r: 12, done: true }, { w: 30, r: 12, done: true }, { w: 30, r: 12, done: true }] },
        { kind: 'lift', exId: 'db_row', group: null, target: { sets: 3, repMin: 8, repMax: 12, rest: 90, weight: 60, reps: 10, note: null },
          sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 9, done: true }, { w: 60, r: 9, done: true }] },
      ] },
  ];
}

// §26: a workout the set ceiling stopped (s.capped) is short ON PURPOSE: it is exempt from the ±10% fit,
// must sit at or under the ceiling, must not be flagged poolLimited, and must say so in the rationale.
const CAP = 30;
const cappedOk = (s, minutes, tag) => {
  assert.ok(workingSets(s) <= CAP, `${tag}: ${workingSets(s)} sets over the ${CAP}-set ceiling`);
  assert.ok(s.estMinutes <= minutes * 1.1, `${tag}: capped but long (${s.estMinutes})`);
  assert.equal(s.capped.cap, CAP); assert.equal(s.capped.sets, workingSets(s));
  assert.equal(s.capped.freedMin, Math.max(0, minutes - s.estMinutes));
  assert.ok(!s.poolLimited, `${tag}: capped is not pool-limited`);
  assert.ok(s.rationale.some(r => /^Capped at/.test(r)), `${tag}: cap explained`);
};
test('time fit within ±10% across minutes × locations × targets (or flagged poolLimited / capped)', () => {
  let limited = 0, total = 0;
  for (const loc of DEFAULT_LOCATIONS) for (const targets of TARGET_SETS) for (const minutes of MINUTES) {
    total++;
    const s = buildWorkout({ targets, minutes, location: loc, profile: PROFILE, sessions: [], now: NOW, seed: 11 });
    const est = estimateMinutes(s.blocks);
    assert.equal(s.estMinutes, est, 'estMinutes matches estimateMinutes(blocks)');
    const tag = `${loc.id} ${targets.join('+') || 'auto'} ${minutes}`;
    assert.ok(workingSets(s) <= CAP, `${tag}: ${workingSets(s)} working sets past the ${CAP}-set ceiling`);
    if (s.capped) cappedOk(s, minutes, tag);
    else if (s.poolLimited) {
      limited++;
      assert.ok(est < minutes * 0.9, `${tag}: poolLimited only when short (${est})`);
      assert.ok(s.rationale.some(r => /suitable exercises|Not enough/.test(r)), `${tag}: limitation explained`);
      if (BIG_LIBRARY) assert.notEqual(loc.id, 'crunch', `${tag}: crunch should never be pool-limited with full library`);
    } else {
      assert.ok(Math.abs(est - minutes) <= minutes * 0.1 + 1e-9, `${tag}: est ${est}`);
    }
  }
  if (BIG_LIBRARY) assert.ok(limited <= total * 0.15, `too many pool-limited sessions: ${limited}/${total}`);
});

test('time fit for every style at crunch and home', () => {
  for (const style of ['hypertrophy', 'pump', 'strength', 'circuit']) for (const loc of [LOC.crunch, LOC.home]) for (const minutes of MINUTES) {
    const s = buildWorkout({ targets: ['upper'], minutes, location: loc, profile: PROFILE, now: NOW, style, seed: 3 });
    assert.equal(s.style, style);
    if (s.capped) cappedOk(s, minutes, `${style} ${loc.id} ${minutes}`);
    else if (!s.poolLimited) assert.ok(Math.abs(s.estMinutes - minutes) <= minutes * 0.1, `${style} ${loc.id} ${minutes}: ${s.estMinutes}`);
  }
});

test('equipment always respected, no barbell back squat, exclude + avoid honoured', () => {
  const avoid = ['db_bench'], exclude = ['db_row'];
  for (const loc of DEFAULT_LOCATIONS) for (const targets of [...TARGET_SETS, ['quads'], ['full']]) for (const minutes of [20, 45, 90]) {
    const s = buildWorkout({ targets, minutes, location: loc, profile: { ...PROFILE, avoidExercises: avoid }, now: NOW, exclude, seed: 5 });
    const eq = expandEquipment(loc.equipment);
    for (const b of lifts(s)) {
      const ex = getEx(b.exId);
      assert.ok(ex, 'known exercise ' + b.exId);
      assert.ok(canDo(ex, eq), `${loc.id}: ${b.exId} needs ${ex.equipment}`);
      assert.ok(!isBackSquat(ex), 'no back squat: ' + b.exId);
      assert.ok(!(ex.pattern === 'squat' && ex.equipment.includes('barbell') && !/front|zercher/i.test(ex.name)), 'no barbell squat ' + b.exId);
      assert.ok(!avoid.includes(b.exId) && !exclude.includes(b.exId), 'avoided/excluded ' + b.exId);
    }
  }
});

test('isBackSquat detects barbell back squats only', () => {
  assert.equal(isBackSquat({ id: 'bb_back_squat', name: 'Barbell Back Squat', pattern: 'squat', equipment: ['barbell', 'rack'] }), true);
  assert.equal(isBackSquat({ id: 'bb_squat', name: 'Barbell Squat', pattern: 'squat', equipment: ['barbell', 'rack'] }), true);
  assert.equal(isBackSquat({ id: 'bb_front_squat', name: 'Front Squat', pattern: 'squat', equipment: ['barbell', 'rack'] }), false);
  assert.equal(isBackSquat({ id: 'db_goblet', name: 'Goblet Squat', pattern: 'squat', equipment: ['dumbbell'] }), false);
});

test('empty targets → uses top recommend() option and explains why', () => {
  const sessions = history();
  const s = buildWorkout({ targets: [], minutes: 45, location: LOC.crunch, profile: PROFILE, sessions, now: NOW, seed: 1 });
  const recs = recommend(sessions, { now: NOW, profile: PROFILE, minutes: 45, location: LOC.crunch });
  assert.equal(s.targets.length, 1);
  if (recs.length) assert.equal(s.targets[0], recs[0].targetId);
  assert.match(s.rationale[0], /^Recommended/);
  assert.ok(lifts(s).length >= 1);
});

test('session shape, title and rationale', () => {
  const s = buildWorkout({ targets: ['back', 'biceps'], minutes: 45, location: LOC.crunch, profile: PROFILE, now: NOW, seed: 2 });
  assert.equal(s.status, 'planned'); assert.equal(s.source, 'generated'); assert.equal(s.date, '2026-10-10');
  assert.equal(s.location, 'crunch'); assert.equal(s.minutes, 45); assert.deepEqual(s.targets, ['back', 'biceps']);
  assert.match(s.title, /Back/); assert.match(s.title, /Biceps/);
  assert.ok(s.rationale.length >= 2 && s.rationale.length <= 6, 'rationale 2-6 strings');
  assert.ok(s.rationale.every(r => typeof r === 'string' && r.length));
  for (const b of lifts(s)) {
    const t = b.target;
    assert.ok(t.sets >= 1 && t.sets === b.sets.length);
    assert.ok(t.repMin <= t.repMax && t.rest >= 10);
    assert.ok(b.sets.every(x => x.w === null && x.r === null && x.done === false));
    assert.ok(b.group === null || /^[A-Z]$/.test(b.group));
  }
  // group letters: each letter used by ≥2 adjacent blocks
  const ls = lifts(s);
  for (const L of new Set(ls.map(b => b.group).filter(Boolean))) {
    const idx = ls.map((b, i) => b.group === L ? i : -1).filter(i => i >= 0);
    assert.ok(idx.length >= 2, 'superset has ≥2 members');
    assert.equal(idx[idx.length - 1] - idx[0], idx.length - 1, 'superset members adjacent');
  }
});

test('compounds come before isolations among straight-set blocks', () => {
  const s = buildWorkout({ targets: ['upper'], minutes: 60, location: LOC.crunch, profile: PROFILE, now: NOW, style: 'strength', seed: 4 });
  const cats = lifts(s).map(b => getEx(b.exId).category);
  const firstIso = cats.indexOf('isolation');
  if (firstIso >= 0) assert.ok(!cats.slice(firstIso).includes('compound'), cats.join(','));
});

test('supersets present for ≤25-minute sessions', () => {
  for (const loc of [LOC.home, LOC.crunch, LOC.travel]) for (const minutes of [15, 20, 25]) for (const targets of [['upper'], ['back', 'biceps'], ['chest']]) {
    const s = buildWorkout({ targets, minutes, location: loc, profile: PROFILE, now: NOW, seed: 9 });
    if (lifts(s).length >= 2) assert.ok(lifts(s).some(b => b.group), `${loc.id} ${targets} ${minutes}: no superset`);
  }
});

test('circuit style groups stations with minimal transition rest', () => {
  const s = buildWorkout({ targets: ['full'], minutes: 20, location: LOC.travel, profile: PROFILE, now: NOW, style: 'circuit', seed: 2 });
  const ls = lifts(s);
  if (ls.length >= 2) {
    assert.ok(ls.every(b => b.group), 'all circuit blocks grouped');
    assert.ok(ls.some(b => b.target.rest <= 15));
  }
});

test('deterministic for the same seed; seed is recorded', () => {
  const opts = { targets: ['shoulders', 'triceps'], minutes: 45, location: LOC.crunch, profile: PROFILE, sessions: history(), now: NOW, seed: 42 };
  const a = buildWorkout(opts), b = buildWorkout(opts);
  assert.deepEqual(a, b);
  assert.equal(a.seed, 42);
  const c = buildWorkout({ ...opts, seed: undefined }), d = buildWorkout({ ...opts, seed: undefined });
  assert.deepEqual(c, d, 'default seed derived from date/targets');
});

test('sculpt goal target biases selection toward its emphasisTag', () => {
  for (const goalId of ['lat_width', 'shoulder_width', 'triceps_mass']) {
    const goal = SCULPT_GOALS[goalId]; if (!goal) continue;
    const eq = expandEquipment(LOC.crunch.equipment);
    const tagged = EXERCISES.filter(e => canDo(e, eq) && (e.emphasis || []).includes(goal.emphasisTag));
    if (!tagged.length) continue;
    const s = buildWorkout({ targets: [goalId], minutes: 45, location: LOC.crunch, profile: { ...PROFILE, sculptGoals: [] }, now: NOW, seed: 6 });
    assert.ok(lifts(s).some(b => (getEx(b.exId).emphasis || []).includes(goal.emphasisTag)), goalId + ' tag present');
    assert.ok(s.title.includes(goal.name), 'title mentions goal: ' + s.title);
    // exercisesFor ranks a tagged exercise first among candidates for the goal
    const ranked = exercisesFor(goalId, eq, { sculptGoals: [goalId] });
    assert.ok(ranked.length > 0);
    assert.ok((ranked[0].emphasis || []).includes(goal.emphasisTag) || tagged.every(t => !ranked.includes(t)), goalId + ' ranking');
  }
});

test('progression fills target weight/reps/note from suggest()', () => {
  const sessions = history();
  const s = buildWorkout({ targets: ['biceps'], minutes: 30, location: LOC.home, profile: PROFILE, sessions, now: NOW, seed: 1 });
  for (const b of lifts(s)) {
    const sg = suggest(b.exId, { sets: b.target.sets, repMin: b.target.repMin, repMax: b.target.repMax }, sessions, { now: NOW });
    assert.equal(b.target.weight, sg.weight ?? null, b.exId);
    if (sg.reason || sg.lastText) assert.ok(b.target.note && b.target.note.length > 0);
  }
});

test('cardio finisher is appended and counted in the budget', () => {
  const s = buildWorkout({ targets: ['upper'], minutes: 60, location: LOC.crunch, profile: PROFILE, now: NOW, seed: 1, cardio: { modality: 'row', minutes: 15, intensity: 'intervals' } });
  const last = s.blocks[s.blocks.length - 1];
  assert.equal(last.kind, 'cardio'); assert.equal(last.minutes, 15); assert.equal(last.done, false);
  if (!s.poolLimited) assert.ok(Math.abs(s.estMinutes - 60) <= 6);
  const allCardio = buildWorkout({ targets: ['upper'], minutes: 30, location: LOC.crunch, profile: PROFILE, now: NOW, cardio: { modality: 'bike', minutes: 30, intensity: 'easy' } });
  assert.equal(lifts(allCardio).length, 0);
});

test('estimateMinutes: supersets save time vs straight sets; includes warm-up', () => {
  const ex = getEx('db_curl');
  const blk = (rest, group) => ({ kind: 'lift', exId: 'db_curl', group, target: { sets: 3, repMin: 10, repMax: 10, rest, weight: null, reps: 10, note: null }, sets: [] });
  const straight = estimateMinutes([blk(60, null), { ...blk(60, null), exId: 'db_skull' }]);
  const sup = estimateMinutes([blk(15, 'A'), { ...blk(60, 'A'), exId: 'db_skull' }]);
  assert.ok(sup < straight);
  assert.ok(estimateMinutes([blk(60, null)]) >= 3 + (3 * (10 * (ex.secPerRep || 3) + 60)) / 60 - 1, 'warm-up included');
  assert.equal(estimateMinutes([{ kind: 'cardio', modality: 'run', minutes: 25, intensity: 'easy' }]), 25);
  assert.equal(estimateMinutes([]), 0);
});

test('alternatives: same main muscles, equipment + exclude respected, ranked', () => {
  const home = LOC.home.equipment;
  const alts = alternatives('db_curl', { equipment: home, exclude: ['db_hammer'], limit: 5 });
  assert.ok(alts.length <= 5);
  const eq = expandEquipment(home);
  for (const a of alts) {
    assert.notEqual(a.id, 'db_curl'); assert.notEqual(a.id, 'db_hammer');
    assert.ok(canDo(a, eq));
    assert.ok(!isBackSquat(a));
  }
  if (alts.length) assert.ok(['biceps_long', 'biceps_short', 'brachialis'].some(r => (alts[0].muscles[r] || 0) >= 0.5));
  assert.deepEqual(alternatives('nope_not_real'), []);
});

test('swapBlock and addExercise return new sessions without mutating', () => {
  const sessions = history();
  const s = buildWorkout({ targets: ['upper'], minutes: 20, location: LOC.home, profile: PROFILE, sessions, now: NOW, seed: 8 });
  const snap = JSON.stringify(s);
  const i = s.blocks.findIndex(b => b.kind === 'lift');
  const old = s.blocks[i];
  const newId = old.exId === 'db_curl' ? 'db_skull' : 'db_curl';
  const sw = swapBlock(s, i, newId, { sessions, now: NOW });
  assert.equal(JSON.stringify(s), snap, 'swap did not mutate');
  assert.notEqual(sw, s);
  assert.equal(sw.blocks[i].exId, newId);
  assert.equal(sw.blocks[i].group, old.group, 'group letter preserved');
  assert.equal(sw.blocks[i].target.sets, old.target.sets);
  assert.equal(sw.blocks[i].sets.length, old.target.sets);
  const sg = suggest(newId, sw.blocks[i].target, sessions, { now: NOW });
  assert.equal(sw.blocks[i].target.weight, sg.weight ?? null, 'progression re-run');
  assert.equal(sw.estMinutes, estimateMinutes(sw.blocks));

  const ad = addExercise(s, 'db_lateral', { sessions, now: NOW });
  assert.equal(JSON.stringify(s), snap, 'add did not mutate');
  assert.equal(ad.blocks.length, s.blocks.length + 1);
  assert.ok(ad.blocks.some(b => b.exId === 'db_lateral' && b.group === null));
  assert.ok(ad.estMinutes >= s.estMinutes);

  const withCardio = buildWorkout({ targets: ['upper'], minutes: 45, location: LOC.crunch, now: NOW, seed: 1, cardio: { modality: 'bike', minutes: 10, intensity: 'easy' } });
  const ad2 = addExercise(withCardio, 'db_curl', { now: NOW });
  assert.equal(ad2.blocks[ad2.blocks.length - 1].kind, 'cardio', 'added lift goes before finisher');
});

test('exercisesFor: relevant, equipment-filtered, accepts Set or array', () => {
  const eq = expandEquipment(LOC.office.equipment);
  const list = exercisesFor('triceps', eq, {});
  for (const e of list) {
    assert.ok(canDo(e, eq));
    assert.ok(['triceps_long', 'triceps_lateral', 'triceps_medial'].some(r => (e.muscles[r] || 0) >= 0.5));
  }
  const viaArray = exercisesFor('triceps', LOC.office.equipment, {});
  assert.deepEqual(viaArray.map(e => e.id), list.map(e => e.id));
  assert.ok(exercisesFor('biceps', expandEquipment(LOC.home.equipment)).some(e => e.id === 'db_curl'));
  assert.deepEqual(exercisesFor('not_a_target', eq), []);
});

test('prefers recently-done exercises (consistency for progression)', () => {
  const sessions = history();
  let hits = 0, n = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const s = buildWorkout({ targets: ['biceps'], minutes: 30, location: LOC.home, profile: PROFILE, sessions, now: NOW, seed });
    n++; if (lifts(s).some(b => b.exId === 'db_curl')) hits++;
  }
  assert.ok(hits >= n / 2, `db_curl kept in ${hits}/${n}`);
});
