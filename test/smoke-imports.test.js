// Lead-owned: every DOM-free module must import cleanly in Node and expose the contract.
import test from 'node:test';
import assert from 'node:assert/strict';
test('data + engine modules import with contract exports', async () => {
  const m = await import('../js/data/muscles.js'); assert.ok(m.REGIONS && m.GROUPS && m.PRESETS && m.regionsFor);
  const s = await import('../js/data/sculpt.js'); assert.ok(s.SCULPT_GOALS && s.DEFAULT_SCULPT_GOALS);
  const e = await import('../js/data/equipment.js'); assert.ok(e.EQUIPMENT && e.DEFAULT_LOCATIONS && e.expandEquipment && e.canDo);
  const c = await import('../js/data/cardio.js'); assert.ok(c.CARDIO && c.INTENSITIES && c.cardioOptions && c.estimateCalories);
  const x = await import('../js/data/exercises.js'); assert.ok(x.EXERCISES.length > 0);
  const r = await import('../js/engine/recovery.js'); for (const f of ['volumeByRegion', 'muscleStatus', 'groupStatus', 'recommend', 'cardioStatus', 'weekSummary', 'streak']) assert.equal(typeof r[f], 'function', f);
  const p = await import('../js/engine/progression.js'); for (const f of ['lastPerformance', 'suggest', 'e1rm', 'personalRecords', 'exerciseHistory']) assert.equal(typeof p[f], 'function', f);
  const n = await import('../js/engine/nutrition.js'); assert.equal(typeof n.dailyTargets, 'function');
  const g = await import('../js/engine/generator.js'); for (const f of ['buildWorkout', 'estimateMinutes', 'alternatives', 'swapBlock', 'addExercise', 'exercisesFor']) assert.equal(typeof g[f], 'function', f);
  const k = await import('../js/classes/classify.js'); assert.equal(typeof k.classify, 'function');
  const st = await import('../js/store.js'); assert.ok(st.store.getProfile().locations.length >= 3);
});
test('exercise ids are unique and reference valid regions/equipment', async () => {
  const { EXERCISES } = await import('../js/data/exercises.js');
  const { REGIONS } = await import('../js/data/muscles.js');
  const { EQUIPMENT } = await import('../js/data/equipment.js');
  const seen = new Set();
  for (const ex of EXERCISES) {
    assert.ok(!seen.has(ex.id), 'duplicate id ' + ex.id); seen.add(ex.id);
    for (const r of Object.keys(ex.muscles)) assert.ok(REGIONS[r], `${ex.id}: bad region ${r}`);
    for (const q of ex.equipment) assert.ok(EQUIPMENT[q], `${ex.id}: bad equipment ${q}`);
  }
});
