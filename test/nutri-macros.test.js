import test from 'node:test';
import assert from 'node:assert/strict';
import { macrosFor, dailyTargets } from '../js/engine/nutrition.js';

const P = (nutrition = {}, extra = {}) => ({ bodyweight: 164, goal: 'lean_bulk', nutrition: { mode: 'simple', ...nutrition }, ...extra });

test('macrosFor: protein from g/lb, fat as % of calories, carbs = remainder', () => {
  const m = macrosFor(P({ proteinGPerLb: 1.0, fatPct: 25 }), { calories: 2800, bodyweight: 164 });
  assert.equal(m.protein, 164);
  assert.equal(m.fat, Math.round(2800 * 0.25 / 9));
  assert.equal(m.carbs, Math.round((2800 - 164 * 4 - m.fat * 9) / 4));
  assert.ok(Math.abs(m.protein * 4 + m.carbs * 4 + m.fat * 9 - 2800) <= 6);
  assert.equal(m.calories, 2800);
  assert.ok(Math.abs(m.proteinPct + m.carbPct + m.fatPct - 100) <= 1);
  assert.equal(m.fatPct, 25);
  assert.equal(m.proteinGPerLb, 1);
  assert.deepEqual(m.warnings, []);
  // bodyweight drives protein
  assert.equal(macrosFor(P({ proteinGPerLb: 0.8 }), { calories: 2800, bodyweight: 200 }).protein, 160);
  // defaults: 1.0 g/lb (1.15 when cutting), 25 % fat
  const d = macrosFor(P(), { calories: 2500, bodyweight: 164 });
  assert.equal(d.protein, 164); assert.equal(d.fatPct, 25);
  assert.equal(macrosFor(P({}, { goal: 'cut' }), { calories: 2000, bodyweight: 164 }).protein, Math.round(164 * 1.15));
});

test('macrosFor warnings: fat < 20 %, carbs < 100 g, protein too low or pointlessly high, impossible split', () => {
  const lowFat = macrosFor(P({ fatPct: 15 }), { calories: 2800, bodyweight: 164 });
  assert.ok(lowFat.warnings.some(w => /Fat is only 15%/.test(w)));
  const lowCarb = macrosFor(P({ proteinGPerLb: 1.2, fatPct: 40 }), { calories: 1900, bodyweight: 164 });
  assert.ok(lowCarb.carbs < 100);
  assert.ok(lowCarb.warnings.some(w => /carbs/.test(w)));
  const lowP = macrosFor(P({ proteinGPerLb: 0.5 }), { calories: 2800, bodyweight: 164 });
  assert.ok(lowP.warnings.some(w => /Morton 2018/.test(w)));
  const highP = macrosFor(P({ proteinGPerLb: 1.6 }), { calories: 2800, bodyweight: 164 });
  assert.ok(highP.warnings.some(w => /no extra muscle benefit/.test(w)));
  const impossible = macrosFor(P({ proteinGPerLb: 1.6, fatPct: 60 }), { calories: 1200, bodyweight: 164 });
  assert.equal(impossible.carbs, 0);
  assert.ok(impossible.fat >= 0 && impossible.protein * 4 + impossible.fat * 9 <= 1200 + 9);
  assert.ok(impossible.warnings.some(w => /more than 1200 kcal/.test(w)));
  // no calories → zeros, no NaN
  const none = macrosFor(null, {});
  for (const k of ['calories', 'protein', 'carbs', 'fat', 'proteinPct', 'carbPct', 'fatPct']) assert.ok(Number.isFinite(none[k]), k);
});

test('dailyTargets uses macrosFor, a passed TDEE and profile.nutrition.surplus', () => {
  const t = dailyTargets(P({ surplus: 300, proteinGPerLb: 1, fatPct: 30 }), { bodyweight: 164, tdee: 2300 });
  assert.equal(t.calories, 2600);
  assert.equal(t.protein, 164); assert.equal(t.fatPct, 30);
  assert.equal(t.tdee, 2300);
  assert.ok(Array.isArray(t.warnings));
  // explicit calories win over surplus
  assert.equal(dailyTargets(P({ calories: 2900, surplus: 300 }), { bodyweight: 164, tdee: 2300 }).calories, 2900);
  // negative surplus works (cut-style)
  assert.equal(dailyTargets(P({ surplus: -400 }), { bodyweight: 164, tdee: 2300 }).calories, 1900);
  // cycling averages around the same target
  const cyc = d => dailyTargets(P({ mode: 'cycling', surplus: 300 }), { dayType: d, bodyweight: 164, tdee: 2300 }).calories;
  assert.ok(cyc('lift') > cyc('rest'));
  // legacy grams override still honoured when g/lb is not set
  assert.equal(dailyTargets(P({ protein: 190 }), { bodyweight: 164 }).protein, 190);
  assert.equal(dailyTargets(P({ mode: 'off' }), {}), null);
});

test('dailyTargets note follows the actual balance, not just the goal', () => {
  const recompSurplus = dailyTargets({ bodyweight: 164, goal: 'recomp', nutrition: { mode: 'simple', surplus: 400 } }, { tdee: 2300 });
  assert.match(recompSurplus.note, /Surplus of about 400/);
  assert.doesNotMatch(recompSurplus.note, /deficit/i);
  const big = dailyTargets({ bodyweight: 164, goal: 'lean_bulk', nutrition: { mode: 'simple', calories: 3300 } }, { tdee: 2300 });
  assert.match(big.note, /almost all of the extra becomes fat/);
  const maint = dailyTargets({ bodyweight: 164, goal: 'lean_bulk', nutrition: { mode: 'cycling', surplus: 0 } }, { dayType: 'rest', tdee: 2300 });
  assert.match(maint.note, /Rest day/); assert.match(maint.note, /About maintenance/);
  assert.match(dailyTargets({ bodyweight: 164, goal: 'recomp', nutrition: { mode: 'simple' } }, { tdee: 2300 }).note, /Recomp/);
  assert.match(dailyTargets({ bodyweight: 164, goal: 'recomp', nutrition: { mode: 'simple', surplus: -700 } }, { tdee: 2300 }).note, /Deficit of about 700/);
});
