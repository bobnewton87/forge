import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, GROUPS, GROUP_ORDER, PRESETS, regionsFor } from '../js/data/muscles.js';

test('every region belongs to exactly one group, and group ids match', () => {
  const seen = new Map();
  for (const g of Object.values(GROUPS)) for (const r of g.regions) {
    assert.ok(REGIONS[r], `unknown region ${r}`);
    assert.ok(!seen.has(r), `${r} in two groups`); seen.set(r, g.id);
    assert.equal(REGIONS[r].group, g.id);
  }
  assert.equal(seen.size, Object.keys(REGIONS).length);
  assert.deepEqual([...GROUP_ORDER].sort(), Object.keys(GROUPS).sort());
});

test('region shapes are valid', () => {
  for (const r of Object.values(REGIONS)) {
    assert.ok(r.name && r.description.length > 20, r.id);
    assert.ok([0.5, 1, 1.5].includes(r.priority), r.id);
    assert.ok(r.weeklySets.min > 0 && r.weeklySets.max >= r.weeklySets.min && r.weeklySets.target >= r.weeklySets.min && r.weeklySets.target <= r.weeklySets.max, r.id);
    assert.ok([48, 72].includes(r.recoveryHours), r.id);
  }
});

test('regionsFor handles region, group, preset and unknown', () => {
  assert.deepEqual(regionsFor('delt_side'), ['delt_side']);
  assert.deepEqual(regionsFor('triceps'), ['triceps_long', 'triceps_lateral', 'triceps_medial']);
  const push = regionsFor('push');
  for (const r of ['chest_upper', 'delt_side', 'triceps_long']) assert.ok(push.includes(r));
  assert.equal(new Set(push).size, push.length);
  for (const p of Object.keys(PRESETS)) assert.ok(regionsFor(p).length > 0, p);
  assert.deepEqual(regionsFor('nope'), []);
});

// INTEGRATOR (weekly-volume audit, docs/research/weekly-volume-audit.md): minimums used to be the
// SUM of per-head region minimums with priority baked into the base numbers. Enforcement now uses
// VOLUME_UNITS (evidence floors, separate side/rear delts, back = lats + upper back) and priority lives
// in REGIONS[r].priority (scoring) and the target (sliders/sculpt), not in the floors.
test("user's priorities live in priority + targets; floors are evidence-based units", async () => {
  const { VOLUME_UNITS, UNIT_ORDER } = await import('../js/data/muscles.js');
  for (const r of ['triceps_long', 'delt_side', 'abs', 'lats', 'chest_upper']) assert.equal(REGIONS[r].priority, 1.5, r);
  for (const g of ['quads', 'hamstrings', 'glutes', 'calves']) for (const r of GROUPS[g].regions) assert.equal(REGIONS[r].priority, 0.5, r);
  assert.equal(VOLUME_UNITS.triceps.min, 10); assert.equal(VOLUME_UNITS.delt_side.min, 10); assert.equal(VOLUME_UNITS.delt_rear.min, 4);
  assert.deepEqual(VOLUME_UNITS.back.regions, ['lats', 'upper_back'], 'traps and lower back do not count toward back');
  for (const u of ['quads', 'hamstrings', 'glutes', 'calves']) assert.ok(VOLUME_UNITS[u].min <= 4, u);
  for (const id of UNIT_ORDER) { const u = VOLUME_UNITS[id]; assert.ok(u.min <= u.target && u.target <= u.max && u.max <= 24, id); }
  for (const g of Object.values(GROUPS)) {
    const us = Object.values(VOLUME_UNITS).filter(u => u.group === g.id && !u.sub);
    assert.equal(g.volume.min, us.reduce((a, u) => a + u.min, 0), g.id);
  }
});
