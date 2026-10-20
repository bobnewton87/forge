// Max audit (2026-10-20): weekly maxes are physiological ceilings independent of priority (biceps 20, not
// the old "normal muscle" 16), and ★ means the same thing on every screen (targets.starredUnits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../js/store.js';
import { VOLUME_UNITS, UNIT_ORDER, MAX_WHY } from '../js/data/muscles.js';
import { unitTargets, starredUnits, starredGroups, applyTargetChange, LIMITS } from '../js/engine/targets.js';
import { planRange, explainWeek } from '../js/engine/planner.js';
import { parseDs } from '../js/util.js';

const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, ...patch });

test('maxes: every counted muscle can reach the evidence ceiling (20; 24 triceps/side delts; 22 back); lower back is a 10-set fatigue guard', () => {
  const want = { triceps: 24, delt_side: 24, back: 22, lower_back: 10 };
  for (const id of UNIT_ORDER) {
    assert.equal(VOLUME_UNITS[id].max, want[id] ?? 20, id);
    assert.ok(typeof MAX_WHY[id] === 'string' && MAX_WHY[id].startsWith(String(VOLUME_UNITS[id].max)), `${id}: MAX_WHY explains its max`);
  }
  // no priority mixing: a maintenance or normal muscle has the same ceiling as a priority one
  assert.equal(VOLUME_UNITS.biceps.max, VOLUME_UNITS.chest.max);
  assert.equal(VOLUME_UNITS.quads.max, VOLUME_UNITS.core.max);
  assert.ok(VOLUME_UNITS.chest_upper.max <= VOLUME_UNITS.chest.max, 'upper chest is part of chest');
});

test('sliders reach the max: range 0.5–2, biceps ×2 → target 20, clamped at the max beyond', () => {
  assert.deepEqual(LIMITS.priority, [0.5, 2]);
  const p = applyTargetChange(prof(), { training: { groupPriority: { biceps: 2, triceps: 3 } } });
  assert.equal(p.groupPriority.biceps, 2);
  assert.equal(p.groupPriority.triceps, 2, 'clamped to 2');
  const U = unitTargets(prof({ groupPriority: { biceps: 2 } }));
  assert.equal(U.biceps.target, 20);
  assert.equal(unitTargets(prof({ groupPriority: { biceps: 1.5 }, sculptGoals: ['biceps_peak', 'arm_size'] })).biceps.target, 20, 'sculpt extras capped at the max');
});

test('stars: one rule — stated priorities (unless turned down), raised sliders, sculpt goals; tracked never', () => {
  const d = starredUnits(prof());
  for (const u of ['chest', 'chest_upper', 'back', 'delt_side', 'triceps', 'core']) assert.ok(d.has(u), `default ★ ${u}`);
  for (const u of ['biceps', 'quads', 'hamstrings', 'glutes', 'calves', 'forearms', 'delt_front', 'traps', 'lower_back']) assert.ok(!d.has(u), `no default ★ ${u}`);
  assert.ok(starredUnits(prof({ groupPriority: { biceps: 1.2 } })).has('biceps'), 'raised slider stars biceps');
  assert.ok(starredUnits(prof({ sculptGoals: ['biceps_peak'] })).has('biceps'), 'sculpt goal stars biceps');
  assert.ok(!starredUnits(prof({ sculptGoals: [], groupPriority: { triceps: 0.7 } })).has('triceps'), 'turned-down priority loses its star');
  assert.ok(starredUnits(prof({ sculptGoals: ['triceps_mass'], groupPriority: { triceps: 0.7 } })).has('triceps'), 'a sculpt goal still stars it');
  const g = starredGroups(prof());
  assert.deepEqual([...g].sort(), ['back', 'chest', 'core', 'shoulders', 'triceps']);
});

test('planner: biceps ×2 is planned to ~20 (was capped at 16), nothing over its max', () => {
  const MON = '2026-10-26', NOW = new Date(2026, 9, 26, 7);
  const p = prof({ groupPriority: { biceps: 2 } });
  const out = planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 1 });
  const e = explainWeek(out, { weekStart: parseDs(MON), profile: p, now: NOW });
  assert.equal(e.biceps.target, 20);
  assert.ok(e.biceps.planned >= 19.5 && e.biceps.planned <= 20.25, `biceps planned ${e.biceps.planned}`);
  for (const [u, x] of Object.entries(e)) assert.ok(x.planned <= x.max + 0.25, `${u} ${x.planned} > max ${x.max}`);
});
