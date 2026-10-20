import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveTdee, ewmaTrend } from '../js/engine/nutrition.js';
import { ds, parseDs, addDays } from '../js/util.js';

// Deterministic noise (mulberry32).
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Synthetic person with a known TDEE: eats `intake` ± noise, weight follows (intake − tdee)/3500 per day
// plus daily water noise (±1.5 lb), with some missed weigh-ins and food logs.
function synth({ tdee = 2600, intake = 2900, days = 42, startW = 164, seed = 7, start = '2026-08-01', skip = 0.15 } = {}) {
  const r = rng(seed);
  const bodyLog = [], foodLog = [];
  let w = startW;
  for (let i = 0; i < days; i++) {
    const d = ds(addDays(parseDs(start), i));
    const eat = intake + (r() - 0.5) * 600;
    w += (eat - tdee) / 3500;
    if (r() > skip) bodyLog.push({ d, w: Math.round((w + (r() - 0.5) * 3) * 10) / 10 });
    if (r() > skip) foodLog.push({ d, kcal: Math.round(eat) });
  }
  return { bodyLog, foodLog, end: ds(addDays(parseDs(start), days - 1)) };
}

test('adaptiveTdee recovers a known TDEE within ±10 % (surplus, deficit, maintenance)', () => {
  for (const [tdee, intake] of [[2600, 2900], [2600, 2100], [2400, 2400], [3000, 3600]]) {
    for (const seed of [1, 2, 3, 4]) {
      const { bodyLog, foodLog } = synth({ tdee, intake, seed });
      const a = adaptiveTdee({ bodyLog, foodLog });
      assert.ok(a && a.tdee, `no result for ${tdee}/${intake}/${seed}`);
      assert.ok(Math.abs(a.tdee - tdee) / tdee <= 0.10, `tdee ${tdee} intake ${intake} seed ${seed}: got ${a.tdee}`);
      assert.ok(['low', 'medium', 'high'].includes(a.confidence));
      assert.equal(typeof a.note, 'string');
      assert.ok(a.days >= 10 && a.foodDays >= 10);
    }
  }
});

test('adaptiveTdee works over a short (12-day) window and an explicit from/to', () => {
  const { bodyLog, foodLog } = synth({ tdee: 2500, intake: 2800, days: 60, seed: 11, skip: 0 });
  const a = adaptiveTdee({ bodyLog, foodLog, from: '2026-09-10', to: '2026-09-28' });
  assert.equal(a.from, '2026-09-10'); assert.equal(a.to, '2026-09-28');
  assert.ok(Math.abs(a.tdee - 2500) / 2500 <= 0.10, String(a.tdee));
  assert.equal(a.method, 'trend');          // the EWMA had ≥30 days to settle
  const s = synth({ tdee: 2500, intake: 2800, days: 14, seed: 5, skip: 0 });
  const b = adaptiveTdee(s);
  assert.ok(b && Math.abs(b.tdee - 2500) / 2500 <= 0.12, String(b?.tdee));
  assert.equal(b.method, 'raw');
});

test('adaptiveTdee needs ≥10 days of both logs and rejects nonsense', () => {
  const { bodyLog, foodLog } = synth({ days: 9, skip: 0 });
  assert.equal(adaptiveTdee({ bodyLog, foodLog }), null);
  const full = synth({ days: 30, skip: 0 });
  assert.equal(adaptiveTdee({ bodyLog: full.bodyLog, foodLog: full.foodLog.slice(0, 8) }), null);
  assert.equal(adaptiveTdee({ bodyLog: full.bodyLog.slice(0, 5), foodLog: full.foodLog }), null);
  assert.equal(adaptiveTdee({}), null);
  assert.equal(adaptiveTdee({ bodyLog: [{ d: 'x', w: 'y' }], foodLog: [{ d: '2026-01-01', kcal: 'z' }] }), null);
  // food log that cannot explain the weight change (e.g. half the days unlogged as 300 kcal)
  const bad = adaptiveTdee({ bodyLog: full.bodyLog, foodLog: full.foodLog.map(e => ({ ...e, kcal: 300 })) });
  assert.ok(bad === null || bad.tdee === null);
});

test('ewmaTrend smooths noise and handles gaps/duplicates', () => {
  const log = [{ d: '2026-10-01', w: 164 }, { d: '2026-10-01', w: 166 }, { d: '2026-10-02', w: 170 }, { d: '2026-10-10', w: 165 }];
  const t = ewmaTrend(log);
  assert.equal(t.length, 3);
  assert.equal(t[0].w, 165);                               // duplicate day averaged
  assert.ok(t[1].trend < 170 && t[1].trend > 165);         // one heavy day barely moves the trend
  assert.ok(t[2].t === 9);
  assert.deepEqual(ewmaTrend(null), []);
});
