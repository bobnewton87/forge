import test from 'node:test';
import assert from 'node:assert/strict';
import { lastPerformance, suggest, e1rm, personalRecords, exerciseHistory, sessionPRs } from '../js/engine/progression.js';
import { getEx } from '../js/data/exercises.js';
import { lift, sess, at } from './enginea-helpers.js';

const now = at('2026-10-10');
const tgt = { sets: 3, repMin: 8, repMax: 12 };
const step = id => getEx(id).step;

test('lastPerformance: most recent before date, done sets with reps only', () => {
  const sessions = [
    sess('2026-10-01', [lift('db_bench', [[45, 10], [45, 9]])]),
    sess('2026-10-05', [lift('db_bench', [[50, 10], [50, 0], [50, 8, false], [50, 9]]), lift('db_bench', [[40, 12]])]),
    sess('2026-10-07', [lift('db_bench', [[55, 5, false]])]),  // nothing done → skipped
    sess('2026-10-10', [lift('db_bench', [[60, 8]])]),         // today → ignored
  ];
  const lp = lastPerformance('db_bench', sessions, '2026-10-10');
  assert.equal(lp.date, '2026-10-05');
  assert.deepEqual(lp.sets, [{ w: 50, r: 10 }, { w: 50, r: 9 }, { w: 40, r: 12 }]);
  assert.equal(lastPerformance('db_bench', sessions, '2026-10-05').date, '2026-10-01');
  assert.equal(lastPerformance('db_curl', sessions, '2026-10-10'), null);
});

test('suggest: start with no history', () => {
  const s = suggest('db_bench', tgt, [], { now });
  assert.equal(s.label, 'start'); assert.equal(s.weight, null); assert.equal(s.reps, 8);
  assert.match(s.reason, /reserve/); assert.equal(s.lastText, null);
});

test('suggest: double progression transitions', () => {
  const S = sets => [sess('2026-10-06', [lift('db_bench', sets)])];
  const add = suggest('db_bench', tgt, S([[40, 10], [40, 10], [40, 9]]), { now });
  assert.equal(add.label, 'add_reps'); assert.equal(add.weight, 40); assert.equal(add.reps, 10);
  assert.equal(add.lastText, 'Last time (Oct 6): 40×10, 10, 9');

  const bump = suggest('db_bench', tgt, S([[40, 12], [40, 12], [40, 12]]), { now });
  assert.equal(bump.label, 'bump'); assert.equal(bump.weight, 40 + step('db_bench')); assert.equal(bump.reps, 8);
  assert.match(bump.reason, /Hit 12,12,12 at 40/);

  const notAll = suggest('db_bench', tgt, S([[40, 12], [40, 12], [40, 11]]), { now });
  assert.equal(notAll.label, 'add_reps'); assert.equal(notAll.weight, 40); assert.equal(notAll.reps, 12);

  const hold = suggest('db_bench', tgt, S([[45, 8], [45, 7], [45, 7]]), { now });
  assert.equal(hold.label, 'hold'); assert.equal(hold.weight, 45); assert.equal(hold.reps, 8);

  const missing = suggest('db_bench', tgt, S([[45, 12], [45, 12], [45, 12, false]]), { now });
  assert.equal(missing.label, 'hold'); assert.match(missing.reason, /2\/3 sets/);

  const drop = suggest('db_bench', tgt, S([[50, 5], [50, 4], [50, 5]]), { now });
  assert.equal(drop.label, 'drop'); assert.equal(drop.weight, 50 - step('db_bench')); assert.equal(drop.reps, 8);

  // Mixed weights: progression keys off the top weight
  const mixed = suggest('db_bench', tgt, S([[40, 12], [45, 12], [45, 12], [45, 12]]), { now });
  assert.equal(mixed.label, 'bump'); assert.equal(mixed.weight, 45 + step('db_bench'));
  assert.equal(mixed.lastText, 'Last time (Oct 6): 40×12, 45×12, 12, 12');
});

test('suggest: long layoff holds the weight', () => {
  const s = suggest('db_bench', tgt, [sess('2026-08-01', [lift('db_bench', [[40, 12], [40, 12], [40, 12]])])], { now });
  assert.equal(s.label, 'hold'); assert.equal(s.weight, 40);
});

test('suggest: seconds unit progresses hold time', () => {
  const ex = getEx('plank');
  const [lo, hi] = ex.repRange;
  const t = { sets: 3, repMin: lo, repMax: hi };
  const mid = suggest('plank', t, [sess('2026-10-06', [lift('plank', [[null, lo], [null, lo], [null, lo]])])], { now });
  assert.equal(mid.label, 'add_reps'); assert.equal(mid.weight, null); assert.equal(mid.reps, Math.min(hi, lo + ex.step));
  assert.match(mid.lastText, new RegExp(`${lo}s`));
  const top = suggest('plank', t, [sess('2026-10-06', [lift('plank', [[null, hi], [null, hi], [null, hi]])])], { now });
  assert.equal(top.label, 'bump'); assert.equal(top.weight, null); assert.equal(top.reps, hi + ex.step);
});

test('suggest: no-load sets never invent a weight', () => {
  const s = suggest('db_curl', { sets: 2, repMin: 8, repMax: 12 }, [sess('2026-10-06', [lift('db_curl', [[null, 12], [null, 12]])])], { now });
  assert.equal(s.weight, null); assert.equal(s.label, 'add_reps'); assert.equal(s.reps, 13);
  assert.match(s.lastText, /BW×12, 12/);
});

test('e1rm', () => {
  assert.equal(e1rm(100, 0), 0); assert.equal(e1rm(null, 5), 0);
  assert.equal(e1rm(100, 10), Math.round(100 * (1 + 10 / 30) * 10) / 10);
  assert.equal(e1rm(100, 20), e1rm(100, 12));
});

test('personalRecords, sessionPRs and exerciseHistory', () => {
  const a = sess('2026-10-01', [lift('db_bench', [[50, 10], [50, 8]]), lift('plank', [[null, 45]])]);
  const b = sess('2026-10-05', [lift('db_bench', [[55, 8], [55, 7, false]]), lift('plank', [[null, 60]])]);
  const c = sess('2026-10-08', [lift('db_bench', [[45, 12]])]);
  const prs = personalRecords([c, a, b]);
  const best = [[50, 10], [55, 8], [45, 12]].sort((x, y) => e1rm(...y) - e1rm(...x))[0];
  assert.equal(prs.db_bench.w, best[0]); assert.equal(prs.db_bench.r, best[1]); assert.equal(prs.db_bench.e1rm, e1rm(...best));
  assert.equal(prs.plank.r, 60); assert.equal(prs.plank.e1rm, null); assert.equal(prs.plank.date, '2026-10-05');

  const sp = sessionPRs(b, [a, b, c]);
  assert.ok(sp.some(p => p.exId === 'plank'));
  assert.equal(sp.some(p => p.exId === 'db_bench'), e1rm(55, 8) > e1rm(50, 10));
  assert.deepEqual(sessionPRs(a, [a, b, c]), []);   // first time ≠ PR

  const h = exerciseHistory('db_bench', [c, a, b]);
  assert.deepEqual(h.map(x => x.date), ['2026-10-01', '2026-10-05', '2026-10-08']);
  assert.equal(h[0].volume, 50 * 10 + 50 * 8);
  assert.deepEqual(h[1].topSet, { w: 55, r: 8 });
  assert.equal(h[1].volume, 55 * 8);
});

test('assisted machine: less counterweight is progress', () => {
  const id = 'assisted_pullup';
  const ex = getEx(id);
  assert.ok(ex, 'assisted_pullup exists');
  const st = ex.step, [lo, hi] = ex.repRange;
  const t = { sets: 3, repMin: lo, repMax: hi };
  const S = (w, reps) => [sess('2026-10-06', [lift(id, reps.map(r => [w, r]))])];
  const bump = suggest(id, t, S(50, [hi, hi, hi]), { now });
  assert.equal(bump.label, 'bump'); assert.equal(bump.weight, 50 - st); assert.match(bump.reason, /assist/);
  const floor = suggest(id, t, S(st / 2, [hi, hi, hi]), { now });
  assert.equal(floor.weight, 0);
  const drop = suggest(id, t, S(50, [1, 1, 2].map(x => Math.min(x, Math.floor(lo * 0.5)) || 1)), { now });
  assert.equal(drop.label, 'drop'); assert.equal(drop.weight, 50 + st);
  const add = suggest(id, t, S(50, [lo, lo, lo]), { now });
  assert.equal(add.label, 'add_reps'); assert.equal(add.weight, 50);
  // Lowest assistance used is the working weight
  const mixed = suggest(id, t, [sess('2026-10-06', [lift(id, [[60, hi], [50, hi], [50, hi], [50, hi]])])], { now });
  assert.equal(mixed.weight, 50 - st);

  const a = sess('2026-10-01', [lift(id, [[60, hi], [40, lo - 1]])]);   // 40 below repMin doesn't count as best
  const b = sess('2026-10-05', [lift(id, [[50, lo]])]);
  const prs = personalRecords([a, b]);
  assert.equal(prs[id].type, 'assisted'); assert.equal(prs[id].e1rm, null);
  assert.equal(prs[id].w, 50); assert.equal(prs[id].date, '2026-10-05');
  assert.ok(sessionPRs(b, [a, b]).some(p => p.exId === id));
  const h = exerciseHistory(id, [a, b]);
  assert.deepEqual(h[0].topSet, { w: 60, r: hi }); assert.equal(h[0].e1rm, null);
  assert.equal(h[1].volume, lo);
});
