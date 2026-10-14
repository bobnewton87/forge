import test from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT, DEFAULT_LOCATIONS, expandEquipment, canDo } from '../js/data/equipment.js';

test('equipment and locations are valid', () => {
  for (const e of Object.values(EQUIPMENT)) assert.ok(['free', 'machine', 'cable', 'bodyweight', 'cardio', 'other'].includes(e.category), e.id);
  assert.deepEqual(DEFAULT_LOCATIONS.map(l => l.id), ['home', 'crunch', 'travel', 'office']);
  for (const l of DEFAULT_LOCATIONS) for (const q of l.equipment) assert.ok(EQUIPMENT[q], `${l.id}: ${q}`);
  const crunch = DEFAULT_LOCATIONS.find(l => l.id === 'crunch');
  assert.ok(crunch.hasClasses && !crunch.equipment.includes('pool'));
  for (const q of ['cable', 'smith', 'leg_press', 'lat_pulldown', 'treadmill', 'rower']) assert.ok(crunch.equipment.includes(q));
});

test('expandEquipment adds implied ids and does not mutate input', () => {
  const input = ['dumbbell', 'adjustable_bench'];
  const s = expandEquipment(input);
  assert.ok(s.has('bodyweight') && s.has('flat_bench') && s.has('dumbbell'));
  assert.equal(input.length, 2);
  assert.ok(!expandEquipment(['rack']).has('barbell'));
  assert.ok(expandEquipment(new Set()).has('bodyweight'));
  assert.ok(expandEquipment({ equipment: ['cable'] }).has('cable'));
});

test('canDo honours AND semantics and implied equipment', () => {
  const home = expandEquipment(DEFAULT_LOCATIONS[0].equipment);
  assert.ok(canDo({ equipment: ['dumbbell', 'adjustable_bench'] }, home));
  assert.ok(canDo({ equipment: ['dumbbell', 'flat_bench'] }, new Set(['dumbbell', 'adjustable_bench'])));
  assert.ok(canDo({ equipment: [] }, new Set()));
  assert.ok(canDo({ equipment: ['bodyweight'] }, new Set()));
  assert.ok(!canDo({ equipment: ['cable'] }, home));
  assert.ok(!canDo({ equipment: ['dumbbell', 'cable'] }, home));
  assert.ok(canDo({ equipment: ['dumbbell'] }, ['dumbbell']));
});
