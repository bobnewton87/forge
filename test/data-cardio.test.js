import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDIO, INTENSITIES, cardioOptions, estimateCalories } from '../js/data/cardio.js';
import { EQUIPMENT, DEFAULT_LOCATIONS, expandEquipment } from '../js/data/equipment.js';

const REQUIRED = ['run', 'trail_run', 'treadmill', 'walk_incline', 'bike', 'spin', 'row', 'elliptical', 'stairmaster',
  'assault_bike', 'jump_rope', 'swim', 'hike', 'ruck', 'hiit_bodyweight'];

test('modalities are complete and valid', () => {
  for (const id of REQUIRED) assert.ok(CARDIO[id], id);
  for (const [id, c] of Object.entries(CARDIO)) {
    assert.equal(c.id, id);
    for (const q of c.equipment) assert.ok(EQUIPMENT[q], `${id}: ${q}`);
    assert.ok(c.metsEasy > 2 && c.metsHard > c.metsEasy && c.metsHard < 18, id);
    assert.ok(['low', 'high'].includes(c.impact) && c.legFatigue >= 0 && c.legFatigue <= 1, id);
    assert.ok(c.intervalIdeas.length >= 2 && c.intervalIdeas.length <= 4, id);
  }
  for (const k of ['easy', 'moderate', 'hard', 'intervals']) assert.ok(INTENSITIES[k].name && INTENSITIES[k].rpe);
});

test('every location has cardio options and equipment is respected', () => {
  for (const l of DEFAULT_LOCATIONS) assert.ok(cardioOptions(expandEquipment(l.equipment)).length > 0, l.id);
  const office = cardioOptions(new Set(['outdoors'])).map(c => c.id);
  assert.ok(office.includes('run') && office.includes('hiit_bodyweight') && !office.includes('row'));
  const crunch = cardioOptions(DEFAULT_LOCATIONS[1]).map(c => c.id);
  assert.ok(crunch.includes('row') && crunch.includes('spin') && !crunch.includes('swim') && !crunch.includes('run'));
  const s = new Set(['rower']); cardioOptions(s); assert.equal(s.size, 1, 'input not mutated');
});

test('estimateCalories is sane', () => {
  const easyRun = estimateCalories('run', 30, 'easy', 165);
  assert.ok(easyRun >= 300 && easyRun <= 400, String(easyRun));
  assert.ok(estimateCalories('run', 30, 'hard', 165) > easyRun);
  assert.ok(estimateCalories('run', 60, 'easy', 165) > easyRun * 1.9);
  assert.ok(estimateCalories('walk', 30, 'easy', 165) < 150);
  assert.ok(estimateCalories('run', 30, 'easy', 200) > easyRun);
  assert.equal(estimateCalories('nope', 30, 'easy', 165), 0);
  assert.ok(estimateCalories('bike', 30, 'bogus', 165) > 0);
});
