// §26.4 SIDE: a one-sided limb issue keeps a one-limb move for the healthy side ("Right arm only") instead
// of dropping it, only where the other limb is genuinely unloaded; such a set counts half for the week.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, getEx } from '../js/data/exercises.js';
import {
  issueFilter, issueEffects, oneSideLimb, issueLimb, isLateral, normalizeIssue, applySides, sideOnlyLabel, effectiveTier,
  SIDE_ONLY_CREDIT, SIDE_ONLY_INFO,
} from '../js/engine/issues.js';
import { buildWorkout, estimateMinutes, swapBlock, groupAvailability } from '../js/engine/generator.js';
import { sessionVolume, weekUnitView } from '../js/engine/recovery.js';
import { planRange, weekPlanSummary } from '../js/engine/planner.js';
import { applyTargetChange, needsReplan } from '../js/engine/targets.js';
import { DEFAULT_LOCATIONS } from '../js/data/equipment.js';
import { defaultProfile } from '../js/store.js';
import { parseDs } from '../js/util.js';

const NOW = new Date(2026, 9, 24, 7);
const LOC = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.id, l]));
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, ...patch });
const issue = (area, side, severity = 'moderate', more = {}) => ({ id: `is_${area}_${side}_${severity}`, area, side, severity, started: '2026-10-20', note: '', resolvedAt: null, ...more });
const lifts = s => s.blocks.filter(b => b.kind === 'lift');

test('side: which moves qualify comes from the data (unilateral + pattern), not a hand list of 300', () => {
  const arm = EXERCISES.filter(e => oneSideLimb(e) === 'arm').map(e => e.id), leg = EXERCISES.filter(e => oneSideLimb(e) === 'leg').map(e => e.id);
  for (const id of ['cable_single_pushdown', 'db_tri_oh_single', 'cable_lateral', 'cable_row_single', 'machine_row_single', 'db_single_press', 'cable_bayesian_curl']) assert.ok(arm.includes(id), id);
  for (const id of ['sl_leg_ext', 'sl_leg_curl', 'sl_leg_press']) assert.ok(leg.includes(id), id);
  // the other leg is the stance leg, or the free hand braces / bears weight
  for (const id of ['db_split', 'bw_bulgarian', 'db_lunge', 'db_reverse_lunge', 'db_step', 'bw_step_up', 'db_sl_rdl', 'kb_sl_rdl', 'sl_hip_thrust', 'db_sl_calf', 'cable_kickback_glute', 'petersen_step', 'trx_pistol', 'cossack_squat',
    'db_row', 'kroc_row', 'db_kickback', 'pushup_archer', 'db_lateral_lean', 'tri_pushdown', 'leg_ext', 'side_plank', 'cable_pallof'])
    assert.equal(oneSideLimb(getEx(id)), null, id);
  for (const id of [...arm, ...leg]) assert.ok(getEx(id).unilateral, `${id}: only exercises the data marks unilateral`);
});

test('side: a moderate LEFT elbow keeps a single-arm cable pushdown for the right arm and drops the bilateral pushdown', () => {
  const f = issueFilter([issue('elbow', 'left')]);
  assert.equal(f.side.get('cable_single_pushdown'), 'right');
  assert.ok(!f.blocked.has('cable_single_pushdown'));
  assert.ok(f.blocked.has('tri_pushdown') && f.blocked.has('cable_rope_pushdown'), 'two-arm pushdowns still go');
  assert.ok(f.blocked.has('db_kickback'), 'a kickback braced on a bench loads the left arm too');
  assert.equal(sideOnlyLabel('right', getEx('cable_single_pushdown')), 'Right arm only');
  // a built triceps day: every triceps move is right-arm only, and no two-arm pushdown appears
  for (const loc of [LOC.crunch, LOC.home]) for (const seed of [1, 2, 3]) {
    const s = buildWorkout({ targets: ['triceps'], minutes: 30, location: loc, profile: prof({ issues: [issue('elbow', 'left')] }), now: NOW, seed });
    for (const b of lifts(s)) {
      assert.ok(!f.blocked.has(b.exId), `${loc.id}: ${b.exId} loads the left elbow`);
      if (f.side.has(b.exId)) assert.equal(b.sideOnly, 'right', `${b.exId} should be right-arm only`);
    }
    if (loc.id === 'crunch') assert.ok(lifts(s).some(b => b.sideOnly === 'right'), `${loc.id} ${seed}: uses the right arm`);
    if (lifts(s).some(b => b.sideOnly)) assert.ok(s.rationale.some(r => /right-arm only.*counts half for the week.*convention/.test(r)), s.rationale.join(' | '));
  }
});

test('side: a LEFT knee keeps a single-leg extension for the right leg, never a split squat', () => {
  const f = issueFilter([issue('knee', 'left')]);
  assert.equal(f.side.get('sl_leg_ext'), 'right');
  assert.equal(f.side.get('sl_leg_curl'), 'right');
  assert.equal(f.side.get('sl_leg_press'), 'right');
  for (const id of ['db_split', 'bw_bulgarian', 'db_lunge', 'db_step', 'leg_ext', 'leg_press', 'db_goblet']) { assert.ok(f.blocked.has(id), id); assert.ok(!f.side.has(id), id); }
  assert.equal(sideOnlyLabel('right', getEx('sl_leg_ext')), 'Right leg only');
  const s = buildWorkout({ targets: ['quads'], minutes: 30, location: LOC.crunch, profile: prof({ issues: [issue('knee', 'left')] }), now: NOW, seed: 1 });
  assert.ok(lifts(s).some(b => b.exId === 'sl_leg_ext' && b.sideOnly === 'right' || b.exId === 'sl_leg_press' && b.sideOnly === 'right'), lifts(s).map(b => b.exId + ':' + b.sideOnly).join(','));
  for (const b of lifts(s)) assert.ok(!f.blocked.has(b.exId), b.exId);
});

test('side: "both", unsided areas, conflicts and mild issues', () => {
  assert.ok(issueFilter([issue('elbow', 'both')]).blocked.has('cable_single_pushdown'), 'both sides hurt: no healthy side');
  assert.equal(issueFilter([issue('elbow', 'both')]).side.size, 0);
  // a left elbow + a right shoulder leave no healthy side for a one-arm press
  const two = issueEffects(getEx('db_single_press'), [issue('elbow', 'left'), issue('shoulder', 'right')]);
  assert.ok(two.blocked && !two.side, 'conflicting sides block it');
  // an issue on the other limb does nothing special (single-arm curl and a left knee: not loaded anyway)
  assert.equal(issueFilter([issue('knee', 'left')]).side.has('cable_bayesian_curl'), false);
  // mild: a one-arm move it would only penalise becomes healthy-side only, at no penalty
  const m = issueFilter([issue('elbow', 'left', 'mild')]);
  assert.equal(m.side.get('cable_single_pushdown'), 'right'); assert.ok(!m.penalty.has('cable_single_pushdown'));
  assert.ok(m.penalty.has('tri_pushdown') && !m.blocked.has('tri_pushdown'), 'two-arm moves keep the mild rules');
  // side means nothing on the neck, the back or the chest
  assert.equal(normalizeIssue({ id: 'is_n', area: 'lower_back', side: 'left' }).side, 'both');
  assert.equal(normalizeIssue({ id: 'is_c', area: 'muscle', group: 'chest', side: 'left' }).side, 'both');
  assert.equal(normalizeIssue({ id: 'is_b', area: 'muscle', group: 'biceps', side: 'left' }).side, 'left');
  assert.ok(isLateral({ area: 'muscle', group: 'calves' }) && !isLateral({ area: 'muscle', group: 'core' }));
  assert.equal(issueLimb(issue('hip', 'right')), 'leg'); assert.equal(issueLimb(issue('wrist', 'both')), null);
  // a one-sided muscle issue works the same way
  assert.equal(issueFilter([issue('muscle', 'left', 'moderate', { group: 'biceps' })]).side.get('cable_bayesian_curl'), 'right');
  // the effective load on the sore side of a healthy-side-only move is nothing
  assert.equal(effectiveTier(getEx('cable_single_pushdown'), issue('elbow', 'left')), 0);
  assert.ok(effectiveTier(getEx('tri_pushdown'), issue('elbow', 'left')) >= 2);
  // the side is part of what re-plans
  const p0 = prof({ issues: [issue('elbow', 'left')] });
  assert.ok(needsReplan(p0, applyTargetChange(p0, { issues: { update: { id: p0.issues[0].id, side: 'both' } } })));
});

test('side: a healthy-side-only set counts half for the week and takes one side\'s time; the set still counts as a working set', () => {
  const blk = side => ({ kind: 'lift', exId: 'cable_single_pushdown', target: { sets: 4, reps: 12, rest: 60 }, sets: Array.from({ length: 4 }, () => ({ w: 20, r: 12, done: true })), ...(side ? { sideOnly: side } : {}) });
  const both = sessionVolume({ blocks: [blk(null)] }), one = sessionVolume({ blocks: [blk('right')] });
  assert.equal(SIDE_ONLY_CREDIT, 0.5);
  assert.equal(one.units.triceps, both.units.triceps * 0.5);
  assert.equal(one.liftSets, both.liftSets, 'still 4 working sets');
  assert.ok(estimateMinutes([blk('right')]) < estimateMinutes([blk(null)]), 'one side only: no ×2 unilateral time');
  // and the weekly rows (weekPlanSummary / weekUnitView) count it the same way
  const day = { id: 's1', date: '2026-10-26', status: 'done', blocks: [blk('right')], startedAt: '2026-10-26T12:00:00.000Z' };
  const v = weekUnitView([day], { profile: prof(), now: new Date(2026, 9, 27, 9) });
  assert.equal(v.units.triceps.done, 2);
  assert.equal(weekPlanSummary([day], { weekStart: parseDs('2026-10-26'), profile: prof(), now: new Date(2026, 9, 27, 9) }).units.triceps.done, 2);
});

test('side: applySides marks a swapped or added one-arm move, and clears it when the issue resolves', () => {
  const iss = [issue('elbow', 'left')];
  const s0 = buildWorkout({ targets: ['chest'], minutes: 30, location: LOC.crunch, profile: prof(), now: NOW, seed: 1 });
  const sw = swapBlock(s0, 0, 'cable_single_pushdown', { sessions: [], now: NOW });
  assert.equal(sw.blocks[0].sideOnly, undefined, 'swapBlock alone knows nothing of issues');
  const marked = applySides(sw, iss);
  assert.equal(marked.blocks[0].sideOnly, 'right');
  assert.equal(applySides(marked, []).blocks[0].sideOnly, undefined, 'resolved: back to both arms');
  assert.equal(applySides(s0, []), s0, 'nothing to change: the same object');
});

test('side: availability says "right-arm only" when that is all a group has left, and the planner never tops up with half-credit moves', () => {
  const a = groupAvailability('triceps', { equipment: LOC.crunch.equipment, issues: [issue('elbow', 'left')] });
  assert.equal(a.status, 'side'); assert.equal(a.sideOf, 'right'); assert.equal(a.limb, 'arm');
  assert.equal(a.free.length, 0); assert.ok(a.side.includes('cable_single_pushdown'));
  const p = prof({ issues: [issue('elbow', 'left')] });
  const f = issueFilter(p.issues);
  const out = planRange({ from: '2026-10-26', days: 7, profile: p, sessions: [], now: new Date(2026, 9, 26, 7), seed: 4 });
  for (const s of out) for (const b of (s.blocks || []).filter(x => x.kind === 'lift')) {
    assert.ok(!f.blocked.has(b.exId), `${s.date}: ${b.exId}`);
    if (b.sideOnly) assert.equal(b.sideOnly, 'right', `${s.date}: ${b.exId}`);
    if (f.side.has(b.exId)) assert.equal(b.sideOnly, 'right', `${s.date}: ${b.exId} must carry its side`);
  }
});

test('side: the cross-education line carries the two verified sources and its limits', () => {
  assert.match(SIDE_ONLY_INFO.credit, /half a set.*convention/);
  assert.match(SIDE_ONLY_INFO.crossEd, /may help/); assert.match(SIDE_ONLY_INFO.crossEd, /strength, not muscle size/); assert.match(SIDE_ONLY_INFO.crossEd, /casts, not injuries/);
  const src = SIDE_ONLY_INFO.evidence.map(e => e.source).join(' ');
  assert.match(src, /10\.1152\/japplphysiol\.91331\.2008/);   // Farthing, Krentz & Magnus 2009
  assert.match(src, /10\.1007\/s00421-017-3720-z/);           // Manca et al. 2017
  assert.ok(SIDE_ONLY_INFO.evidence.some(e => /high risk of bias/.test(e.claim)));
});
