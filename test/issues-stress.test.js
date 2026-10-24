// §26 ISSUES: "log something that's hurting". The rule-based exercise → area stress map, the issue model
// (validation, list patch, 7-day re-check), the one write path through targets, and every engine that picks
// exercises respecting active issues (generator, alternatives / exercisesFor, the planner's top-up).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, getEx } from '../js/data/exercises.js';
import { GROUPS } from '../js/data/muscles.js';
import { stressOf, muscleStress, AREAS_STRESS, OVERRIDES, stressTable } from '../js/data/stress.js';
import {
  AREAS, AREA_ORDER, SEVERITIES, SAFETY_LINE, NOT_A_CLINICIAN, CHECK_DAYS, normalizeIssue, activeIssues, issueKey, issueLabel,
  applyIssuePatch, needsCheck, issueTier, issueEffects, issueFilter, areaOptionsFor,
} from '../js/engine/issues.js';
import { resolveTargets, applyTargetChange, needsReplan, describeChange } from '../js/engine/targets.js';
import { buildWorkout, alternatives, exercisesFor } from '../js/engine/generator.js';
import { planRange } from '../js/engine/planner.js';
import { DEFAULT_LOCATIONS } from '../js/data/equipment.js';
import { defaultProfile } from '../js/store.js';

const NOW = new Date(2026, 9, 24, 7, 0);
const LOC = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.id, l]));
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, ...patch });
const issue = (area, severity = 'moderate', more = {}) => ({ id: `is_${area}_${severity}`, area, side: 'both', severity, started: '2026-10-20', note: '', resolvedAt: null, ...more });
const blocks = (f, ids) => ids.filter(id => f.blocked.has(id));
const liftIds = s => s.blocks.filter(b => b.kind === 'lift').map(b => b.exId);

// ---------------------------------------------------------------- the stress map
test('stress: every exercise has a 0-3 tier for every area, derived by rule (overrides are few)', () => {
  const t = stressTable();
  assert.equal(Object.keys(t).length, EXERCISES.length);
  for (const [id, m] of Object.entries(t)) {
    assert.deepEqual(Object.keys(m).sort(), [...AREAS_STRESS].sort(), id);
    for (const v of Object.values(m)) assert.ok(Number.isInteger(v) && v >= 0 && v <= 3, `${id}: ${JSON.stringify(m)}`);
  }
  for (const a of AREAS_STRESS) assert.ok(EXERCISES.some(e => stressOf(e)[a] === 3), `${a}: nothing loads it hardest`);
  for (const a of AREAS_STRESS) assert.ok(EXERCISES.filter(e => stressOf(e)[a] === 0).length >= 90, `${a}: almost everything loads it`);
  assert.ok(Object.keys(OVERRIDES).length <= EXERCISES.length * 0.1, 'rules, not hand-annotation');
  for (const id of Object.keys(OVERRIDES)) assert.ok(getEx(id), `override for unknown exercise ${id}`);
  assert.equal(stressOf(getEx('db_skull')), stressOf(getEx('db_skull')), 'memoized');
  assert.equal(muscleStress(getEx('db_curl'), 'biceps'), 3);
  assert.equal(muscleStress(getEx('db_row'), 'biceps'), 2);
  assert.equal(muscleStress(getEx('leg_press'), 'biceps'), 0);
});

test('stress: elbow rules out skull crushers and close-grip bench, never the leg press', () => {
  for (const sev of ['mild', 'moderate', 'severe']) {
    const f = issueFilter([issue('elbow', sev)]);
    assert.deepEqual(blocks(f, ['db_skull', 'ez_skull', 'bb_close_bench', 'db_close_press', 'dip_tri', 'cable_oh_ext']), ['db_skull', 'ez_skull', 'bb_close_bench', 'db_close_press', 'dip_tri', 'cable_oh_ext'], sev);
    assert.deepEqual(blocks(f, ['leg_press', 'leg_curl', 'db_goblet', 'hack_squat', 'standing_calf_machine']), [], `${sev}: legs untouched`);
  }
  // mild keeps (but penalises) the moves that load it only moderately; moderate drops them too
  const mild = issueFilter([issue('elbow', 'mild')]), mod = issueFilter([issue('elbow', 'moderate')]);
  for (const id of ['db_curl', 'tri_pushdown', 'db_bench', 'lat_pulldown']) {
    assert.ok(!mild.blocked.has(id) && mild.penalty.get(id) < 1, `mild ${id}`);
    assert.ok(mod.blocked.has(id), `moderate ${id}`);
  }
  for (const id of ['db_lateral', 'pec_deck', 'face_pull']) assert.ok(!mod.blocked.has(id), `moderate keeps ${id} (barely loads the elbow)`);
});

test('stress: lower back (moderate) rules out deadlifts, RDLs and bent-over rows, keeps supported work', () => {
  const f = issueFilter([issue('lower_back')]);
  for (const id of ['trap_dl', 'db_rdl', 'trap_rdl', 'db_sl_rdl', 'db_bent_row', 'bb_row', 'trap_row', 'back_extension', 'kb_swing', 'ab_rollout_bb', 'trap_rack_pull'])
    assert.ok(f.blocked.has(id), id);
  for (const id of ['machine_chest_press', 'db_chest_row', 'lat_pulldown', 'leg_ext', 'leg_curl', 'leg_press', 'db_row', 'pec_deck', 'db_lateral_seated'])
    assert.ok(!f.blocked.has(id), id);
});

test('stress: knee rules out squats, lunges and leg extensions; upper body stays', () => {
  const f = issueFilter([issue('knee', 'mild')]);   // even mild: these load it hardest
  for (const id of ['db_goblet', 'hack_squat', 'leg_press', 'db_lunge', 'db_split', 'bw_bulgarian', 'db_step', 'leg_ext', 'sissy_squat', 'jump_squat', 'box_jump'])
    assert.ok(f.blocked.has(id), id);
  assert.ok(!f.blocked.has('leg_curl') && f.penalty.get('leg_curl') < 1, 'mild: leg curls stay, penalised');
  assert.ok(issueFilter([issue('knee')]).blocked.has('leg_curl'), 'moderate: leg curls go');
  for (const id of ['db_bench', 'lat_pulldown', 'db_curl', 'db_hip_thrust', 'seated_calf_machine', 'db_rdl']) assert.ok(!issueFilter([issue('knee')]).blocked.has(id), id);
});

test('stress: wrist, shoulder, ankle, neck and a muscle issue each rule out the obvious moves', () => {
  const has = (area, ids, sev = 'moderate', more = {}) => { const f = issueFilter([issue(area, sev, more)]); for (const id of ids) assert.ok(f.blocked.has(id), `${area}: ${id}`); return f; };
  const w = has('wrist', ['pushup', 'db_wrist_curl', 'farmer', 'bb_curl', 'db_reverse_curl']);
  assert.ok(!w.blocked.has('leg_press') && !w.blocked.has('pec_deck'));
  const s = has('shoulder', ['db_shoulder', 'bb_ohp', 'dip_chest', 'db_upright_row', 'db_lateral', 'db_bench']);
  assert.ok(!s.blocked.has('db_curl') && !s.blocked.has('leg_press') && !s.blocked.has('face_pull'));
  assert.ok(issueFilter([issue('shoulder', 'mild')]).blocked.has('db_upright_row') && !issueFilter([issue('shoulder', 'mild')]).blocked.has('db_bench'));
  const a = has('ankle', ['db_calf', 'jump_squat', 'db_lunge']);
  assert.ok(!a.blocked.has('db_bench') && !a.blocked.has('leg_ext'));
  has('neck', ['db_shrug', 'trap_shrug'], 'mild');
  const m = has('muscle', ['db_curl', 'db_hammer', 'db_row', 'lat_pulldown'], 'moderate', { group: 'biceps' });
  assert.ok(!m.blocked.has('tri_pushdown') && !m.blocked.has('db_bench'), 'a sore biceps leaves triceps and chest alone');
  assert.ok(issueFilter([issue('muscle', 'mild', { group: 'biceps' })]).blocked.has('db_curl') && !issueFilter([issue('muscle', 'mild', { group: 'biceps' })]).blocked.has('db_row'));
});

// ---------------------------------------------------------------- the issue model
test('issues: validation, labels and the shape that is stored', () => {
  assert.equal(normalizeIssue({ area: 'spleen', id: 'is_1' }), null);
  assert.equal(normalizeIssue({ area: 'muscle', id: 'is_1' }), null, 'a muscle issue needs a group');
  assert.equal(normalizeIssue({ area: 'knee' }), null, 'needs an id');
  const x = normalizeIssue({ id: 'is_1', area: 'lower_back', side: 'left', severity: 'bad', note: '  sore\n after   rows ' + 'x'.repeat(300), extra: 1 });
  assert.deepEqual(Object.keys(x).sort(), ['area', 'id', 'note', 'resolvedAt', 'severity', 'side', 'started']);
  assert.equal(x.side, 'both', 'no side for an unsided area');
  assert.equal(x.severity, 'mild', 'unknown severity → mild');
  assert.ok(x.note.startsWith('sore after rows') && x.note.length === 200);
  assert.equal(issueLabel({ area: 'elbow', side: 'left' }), 'Left elbow');
  assert.equal(issueLabel({ area: 'lower_back', side: 'both' }), 'Lower back');
  assert.equal(issueLabel({ area: 'muscle', group: 'biceps', side: 'right' }), 'Biceps (right)');
  assert.deepEqual(AREA_ORDER, Object.keys(AREAS));
  for (const g of Object.keys(GROUPS)) assert.ok(normalizeIssue({ id: 'is_m', area: 'muscle', group: g }), g);
});

test('issues: add / update / resolve / check / remove are pure, and only active ones count', () => {
  let list = applyIssuePatch([], { add: { area: 'knee', side: 'right', severity: 'mild' }, date: '2026-10-10' });
  assert.equal(list.length, 1);
  const id = list[0].id;
  assert.match(id, /^is_/); assert.equal(list[0].started, '2026-10-10'); assert.equal(list[0].resolvedAt, null);
  const before = JSON.stringify(list);
  list = applyIssuePatch(list, { update: { id, severity: 'moderate', note: 'stairs hurt', area: 'nonsense' } });
  assert.equal(JSON.stringify(applyIssuePatch(JSON.parse(before), {})), before, 'no-op patch');
  assert.equal(list[0].severity, 'moderate'); assert.equal(list[0].area, 'knee', 'an invalid field is not applied');
  list = applyIssuePatch(list, { add: { area: 'elbow', started: '2026-11-30' } });
  assert.equal(activeIssues({ issues: list }, '2026-10-24').length, 1, 'a future start is not active yet');
  assert.ok(!needsCheck(list[0], '2026-10-16') && needsCheck(list[0], `2026-10-${10 + CHECK_DAYS}`), 'asks after a week');
  list = applyIssuePatch(list, { check: id, date: '2026-10-20' });
  assert.ok(!needsCheck(list[0], '2026-10-24') && needsCheck(list[0], '2026-10-27'), '"still hurting" resets the clock');
  list = applyIssuePatch(list, { resolve: id, date: '2026-10-24' });
  assert.equal(list[0].resolvedAt, '2026-10-24');
  assert.equal(activeIssues({ issues: list }, '2026-10-24').length, 0, 'resolved issues stay for the record but are not active');
  assert.equal(applyIssuePatch(list, { remove: id }).length, 1);
  assert.equal(issueKey(list[0]), `${id}|knee||right|moderate`, 'the side is part of the key: it changes exercise choice (§26.4)');
});

test('issues: written only through targets.applyTargetChange; a new or resolved issue re-plans, a check does not', () => {
  const p0 = prof();
  const p1 = applyTargetChange(p0, { issues: { add: { area: 'elbow', side: 'left', severity: 'moderate' }, date: '2026-10-20' } });
  assert.equal(resolveTargets(p1, { now: NOW }).issues.length, 1);
  assert.ok(needsReplan(p0, p1));
  assert.match(describeChange(p0, p1), /left elbow logged \(moderate\)/);
  const id = p1.issues[0].id;
  const p2 = applyTargetChange(p1, { issues: { check: id } });
  assert.ok(!needsReplan(p1, p2), 'answering "still hurting" changes nothing the planner reads');
  const p3 = applyTargetChange(p1, { issues: { update: { id, severity: 'mild' } } });
  assert.ok(needsReplan(p1, p3)); assert.match(describeChange(p1, p3), /now mild/);
  const p4 = applyTargetChange(p1, { issues: { resolve: id } });
  assert.ok(needsReplan(p1, p4)); assert.match(describeChange(p1, p4), /feels better/);
  assert.equal(resolveTargets(p4, { now: NOW }).issues.length, 0);
  assert.equal(JSON.stringify(p0.issues), JSON.stringify(defaultProfile().issues), 'the input profile is untouched');
});

test('issues: honesty copy: not a clinician, one safety line on severe, no treatment advice', () => {
  assert.match(NOT_A_CLINICIAN, /not a clinician/); assert.match(NOT_A_CLINICIAN, /does not diagnose or treat/);
  assert.equal(SAFETY_LINE, 'Sharp pain, swelling, numbness or pain at rest: stop and get it checked.');
  assert.match(SEVERITIES.mild.short, /train around it/); assert.match(SEVERITIES.moderate.short, /Avoid loading it/);
  const copy = JSON.stringify(SEVERITIES) + NOT_A_CLINICIAN + SAFETY_LINE;
  assert.ok(!/ice|stretch|rehab|physio|ibuprofen|heal|strain|tendin/i.test(copy), 'no diagnosis or treatment words');
  assert.ok(SEVERITIES.severe.exclude <= SEVERITIES.moderate.exclude && SEVERITIES.moderate.exclude < SEVERITIES.mild.exclude);
});

test('issues: areaOptionsFor offers the areas an exercise loads, hardest first, plus its main muscle', () => {
  const o = areaOptionsFor('db_skull');
  assert.equal(o[0].area, 'elbow'); assert.equal(o[0].tier, 3);
  assert.deepEqual(o[o.length - 1], { area: 'muscle', group: 'triceps', tier: 3 });
  assert.equal(areaOptionsFor('leg_ext')[0].area, 'knee');
  assert.deepEqual(areaOptionsFor('nope'), []);
});

// ---------------------------------------------------------------- engines respect issues
test('generator: a moderate knee issue keeps every knee-loading move out of a legs day and says why', () => {
  const p = prof({ issues: [issue('knee', 'moderate', { side: 'right' })] });
  for (const loc of [LOC.crunch, LOC.home]) for (const minutes of [30, 45, 60]) for (const seed of [1, 2]) {
    const s = buildWorkout({ targets: ['legs'], minutes, location: loc, profile: p, now: NOW, seed });
    // §26.4: a one-leg machine move may stay for the LEFT leg only (the right knee is the sore one)
    for (const b of s.blocks.filter(x => x.kind === 'lift')) assert.ok(issueTier(getEx(b.exId), p.issues[0]) < 2 || b.sideOnly === 'left', `${loc.id} ${minutes}: ${b.exId} loads the right knee`);
    assert.ok(s.rationale.some(r => /right knee \(moderate\)/.test(r)), s.rationale.join(' | '));
    assert.ok(liftIds(s).length >= 2, 'still a workout (hinges, hip thrusts, calves)');
  }
  // mild: the hardest moves are out, the moderate ones survive only at a penalty
  const pm = prof({ issues: [issue('elbow', 'mild')] });
  const s = buildWorkout({ targets: ['triceps'], minutes: 30, location: LOC.crunch, profile: pm, now: NOW, seed: 3 });
  for (const id of liftIds(s)) assert.ok(issueTier(getEx(id), pm.issues[0]) < 3, id);
});

test('generator: a requested muscle with nothing left is named in the rationale, never silently empty', () => {
  const p = prof({ issues: [issue('muscle', 'moderate', { group: 'biceps' })] });
  const s = buildWorkout({ targets: ['biceps'], minutes: 30, location: LOC.crunch, profile: p, now: NOW, seed: 1 });
  assert.ok(s.rationale.some(r => /^Biceps: every biceps exercise here loads your biceps \(moderate\), so it is left out today/.test(r)), s.rationale.join(' | '));
  assert.ok(s.rationale.some(r => /^So this works .* instead/.test(r)), 'says what it does instead');
  assert.ok(liftIds(s).length >= 2, 'and does it');
  for (const id of liftIds(s)) assert.ok(muscleStress(getEx(id), 'biceps') < 2, id);
  // part of a request blocked: the rest is trained and the blocked part named
  const s2 = buildWorkout({ targets: ['biceps', 'triceps'], minutes: 45, location: LOC.crunch, profile: p, now: NOW, seed: 1 });
  assert.ok(s2.rationale.some(r => /^Biceps: every biceps exercise/.test(r)));
  assert.ok(s2.blocks.some(b => b.kind === 'lift' && getEx(b.exId).muscles.triceps_long));
  // everything blocked: an explanation, not a silent empty workout
  const all = prof({ issues: [issue('muscle', 'severe', { group: 'biceps' }), issue('elbow', 'severe'), issue('wrist', 'severe'), issue('shoulder', 'severe'), issue('upper_back', 'severe')] });
  const s3 = buildWorkout({ targets: ['biceps'], minutes: 30, location: LOC.home, profile: all, now: NOW, seed: 1 });
  if (!liftIds(s3).length) assert.ok(s3.rationale.some(r => /Nothing here trains that without loading it/.test(r)), s3.rationale.join(' | '));
  else assert.ok(s3.rationale.some(r => /So this works/.test(r)), s3.rationale.join(' | '));
});

test('alternatives / exercisesFor never offer a move an active issue rules out', () => {
  const iss = [issue('elbow', 'moderate')];
  const f = issueFilter(iss);
  const alts = alternatives('db_skull', { equipment: LOC.crunch.equipment, limit: 30, issues: iss });
  assert.ok(alts.every(e => !f.blocked.has(e.id)), alts.map(e => e.id).join(','));
  const plain = alternatives('db_skull', { equipment: LOC.crunch.equipment, limit: 30 });
  assert.ok(plain.some(e => f.blocked.has(e.id)), 'fixture: without the issue they would be offered');
  const legs = exercisesFor('quads', LOC.crunch.equipment, { issues: [issue('knee')] });
  assert.ok(legs.every(e => issueTier(e, issue('knee')) < 2), legs.map(e => e.id).join(','));
  assert.ok(exercisesFor('chest', LOC.crunch.equipment, { issues: [issue('elbow', 'mild')] }).every(e => !issueFilter([issue('elbow', 'mild')]).blocked.has(e.id)));
});

test('planner: a planned week (top-ups included) never programs a move an active issue rules out', () => {
  for (const iss of [issue('lower_back', 'moderate'), issue('elbow', 'severe'), issue('knee', 'mild')]) {
    const p = prof({ issues: [iss] });
    const f = issueFilter([iss]);
    const out = planRange({ from: '2026-10-26', days: 7, profile: p, sessions: [], now: new Date(2026, 9, 26, 7), seed: 3 });
    for (const s of out) for (const id of liftIds(s)) assert.ok(!f.blocked.has(id), `${iss.area} ${s.date}: ${id}`);
    assert.ok(out.some(s => liftIds(s).length), 'still plans lifting');
  }
  // the effects helper agrees with the filter
  const e = issueEffects(getEx('db_curl'), [issue('elbow', 'mild'), issue('elbow', 'severe', { id: 'is_e2' })]);
  assert.equal(e.blocked.severity, 'severe');
});

test('§26: severe differs from moderate by the safety line, shown on the workout itself', () => {
  const mk = sev => buildWorkout({ targets: ['triceps'], minutes: 45, location: LOC.crunch, profile: prof({ issues: [issue('elbow', sev, { side: 'left' })] }), now: NOW, seed: 3 });
  assert.ok(mk('severe').rationale.some(r => r.includes(SAFETY_LINE)), 'severe workout carries the safety line');
  assert.ok(!mk('moderate').rationale.some(r => r.includes(SAFETY_LINE)), 'moderate does not');
  assert.match(SEVERITIES.severe.rule, /get it checked/);
});
