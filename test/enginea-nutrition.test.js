import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyTargets, ADDERALL_TIPS, NUTRITION_TIPS } from '../js/engine/nutrition.js';

const P = (mode, goal = 'recomp', extra = {}) => ({ bodyweight: 180, goal, nutrition: { mode, calories: null, protein: null, ...extra } });

test('off mode and missing bodyweight return null', () => {
  assert.equal(dailyTargets(P('off'), { dayType: 'lift' }), null);
  assert.equal(dailyTargets({ nutrition: { mode: 'simple' } }, { dayType: 'lift' }), null);
  assert.equal(dailyTargets(null, {}), null);
});

test('bodyweight arg overrides profile', () => {
  assert.equal(dailyTargets(P('simple'), { bodyweight: 200 }).protein, 200);
});

test('simple mode: same every day, macros add up', () => {
  const a = dailyTargets(P('simple'), { dayType: 'lift' }), b = dailyTargets(P('simple'), { dayType: 'rest' });
  assert.deepEqual([a.calories, a.carbs], [b.calories, b.carbs]);
  assert.equal(a.protein, 180);
  assert.ok(Math.abs(a.protein * 4 + a.carbs * 4 + a.fat * 9 - a.calories) <= 10);
  assert.ok(a.calories < a.tdee);
  assert.ok(dailyTargets(P('simple', 'lean_bulk'), {}).calories > a.tdee);
  const cut = dailyTargets(P('simple', 'cut'), {});
  assert.ok(cut.calories < a.calories); assert.ok(cut.protein >= 198 && cut.protein <= 216);
});

test('cycling mode: lift > cardio > rest, both highest; ports calcNutri offsets', () => {
  const t = d => dailyTargets(P('cycling'), { dayType: d });
  const tdee = Math.round(180 * 15.5);
  assert.equal(t('lift').calories, Math.round((tdee - 100) / 10) * 10);
  assert.equal(t('rest').calories, Math.round((tdee - 500) / 10) * 10);
  assert.ok(t('both').calories > t('lift').calories && t('lift').calories > t('cardio').calories && t('cardio').calories > t('rest').calories);
  assert.ok(t('rest').carbs < t('lift').carbs);
  assert.match(t('rest').note, /Rest day/);
});

test('user overrides: calories and protein', () => {
  const s = dailyTargets(P('simple', 'recomp', { calories: 2500, protein: 200 }), {});
  assert.equal(s.calories, 2500); assert.equal(s.protein, 200);
  assert.ok(s.carbs >= 100);
});

test('tips exist', () => { assert.ok(ADDERALL_TIPS.length >= 6); assert.ok(NUTRITION_TIPS.length >= 6); });
