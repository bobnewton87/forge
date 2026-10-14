import test from 'node:test';
import assert from 'node:assert/strict';
import { SCULPT_GOALS, DEFAULT_SCULPT_GOALS } from '../js/data/sculpt.js';
import { REGIONS, GROUPS } from '../js/data/muscles.js';

const REQUIRED = ['biceps_peak', 'biceps_width', 'arm_thickness', 'triceps_mass', 'triceps_horseshoe', 'shoulder_width',
  'capped_delts', 'rear_delts', 'lat_width', 'back_thickness', 'upper_chest', 'chest_fullness', 'traps_yoke', 'forearms',
  'six_pack', 'obliques_vline', 'v_taper', 'glutes', 'calves', 'quad_sweep', 'hamstrings'];

test('all required sculpt goals exist with valid shape', () => {
  for (const id of REQUIRED) assert.ok(SCULPT_GOALS[id], id);
  for (const [id, g] of Object.entries(SCULPT_GOALS)) {
    assert.equal(g.id, id); assert.equal(g.emphasisTag, id);
    assert.ok(GROUPS[g.group], `${id} group`);
    for (const [r, w] of Object.entries(g.regions)) { assert.ok(REGIONS[r], `${id}: ${r}`); assert.ok(w > 0 && w <= 1); }
    assert.ok(g.summary.length > 20 && g.science.length > 200, id);
    assert.ok(g.tips.length >= 3, id);
    assert.ok(g.extraWeeklySets > 0 && g.extraWeeklySets <= 6, id);
  }
  for (const id of DEFAULT_SCULPT_GOALS) assert.ok(SCULPT_GOALS[id], id);
});

test('science is evidence-honest about genetics and myths', () => {
  assert.match(SCULPT_GOALS.biceps_peak.science, /genetic/i);
  assert.match(SCULPT_GOALS.chest_fullness.science, /inner chest/i);
  assert.match(SCULPT_GOALS.six_pack.science, /spot-reduce/i);
  assert.match(SCULPT_GOALS.triceps_mass.science, /Maeo/);
});
