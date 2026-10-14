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
    assert.ok(r.weeklySets.min > 0 && r.weeklySets.max >= r.weeklySets.min, r.id);
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

test("user's priorities are baked in", () => {
  assert.ok(GROUPS.triceps.weeklySets.min >= 12);
  assert.ok(REGIONS.delt_side.weeklySets.min >= 12);
  assert.ok(REGIONS.abs.weeklySets.min >= 6);
  for (const r of ['triceps_long', 'delt_side', 'abs', 'lats', 'chest_upper']) assert.equal(REGIONS[r].priority, 1.5, r);
  for (const g of ['quads', 'hamstrings', 'glutes', 'calves']) for (const r of GROUPS[g].regions) assert.equal(REGIONS[r].priority, 0.5, r);
  for (const g of Object.values(GROUPS)) {
    assert.equal(g.weeklySets.min, g.regions.reduce((a, r) => a + REGIONS[r].weeklySets.min, 0));
  }
});
