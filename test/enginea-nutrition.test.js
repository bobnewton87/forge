import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyTargets, ADDERALL_TIPS, NUTRITION_TIPS, cycleMean, REFERENCE_WEEK } from '../js/engine/nutrition.js';

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

test('cycling mode: lift > cardio > rest, both highest; averages to the target intake', () => {
  const t = d => dailyTargets(P('cycling'), { dayType: d });
  const tdee = Math.round(180 * 15.5);
  // Changed 2026-10-21: the cycling offsets are now centred on the MEAN of the offsets over the week
  // (nutrition.cycleMean / REFERENCE_WEEK) rather than on the flat 'simple' offset, which was not that
  // mean. The day-type spread is unchanged; the weekly average now equals the stated target exactly,
  // so Nutrition and the projection can no longer disagree about how much is being eaten.
  // Previously t('lift') was tdee-100 and t('rest') tdee-500 — an average ~36 kcal/day above target.
  const cm = cycleMean('recomp', REFERENCE_WEEK);
  const avg = tdee - 250;                                     // SIMPLE_DEFICIT.recomp
  assert.equal(t('lift').calories, Math.round((avg + cm - 100) / 10) * 10);
  assert.equal(t('rest').calories, Math.round((avg + cm - 500) / 10) * 10);
  assert.ok(t('both').calories > t('lift').calories && t('lift').calories > t('cardio').calories && t('cardio').calories > t('rest').calories);
  assert.ok(t('rest').carbs < t('lift').carbs);
  assert.match(t('rest').note, /Rest day/);

  // The property that matters: over REFERENCE_WEEK the cycled days average to the simple-mode target.
  const flat = dailyTargets(P('simple'), {}).calories;
  let days = 0, sum = 0;
  for (const [dayType, n] of Object.entries(REFERENCE_WEEK)) { days += n; sum += n * t(dayType).calories; }
  assert.ok(Math.abs(sum / days - flat) <= 10, `cycled avg ${sum / days} vs simple ${flat}`);
  // ...and for every goal, including a surplus.
  for (const goal of ['recomp', 'lean_bulk', 'cut', 'weight_loss']) {
    const g = d => dailyTargets(P('cycling', goal), { dayType: d }).calories;
    const f = dailyTargets(P('simple', goal), {}).calories;
    let dd = 0, ss = 0;
    for (const [dayType, n] of Object.entries(REFERENCE_WEEK)) { dd += n; ss += n * g(dayType); }
    assert.ok(Math.abs(ss / dd - f) <= 10, `${goal}: cycled avg ${ss / dd} vs simple ${f}`);
  }

  // A caller that knows the real schedule gets centring on THAT week instead.
  const allRest = { rest: 7 };
  const r = dailyTargets(P('cycling'), { dayType: 'rest', week: allRest });
  assert.equal(r.calories, Math.round(avg / 10) * 10);        // a week of rest days averages to the target
});

test('user overrides: calories and protein', () => {
  const s = dailyTargets(P('simple', 'recomp', { calories: 2500, protein: 200 }), {});
  assert.equal(s.calories, 2500); assert.equal(s.protein, 200);
  assert.ok(s.carbs >= 100);
});

test('tips exist', () => { assert.ok(ADDERALL_TIPS.length >= 6); assert.ok(NUTRITION_TIPS.length >= 6); });
