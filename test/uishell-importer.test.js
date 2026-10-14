// UI-SHELL: Iron Runner → Forge converter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { convertIronRunner, applyImport } from '../js/ui/importer.js';

const SEED = '/home/hanknewt/workout/seed-data.json';
const seed = existsSync(SEED) ? JSON.parse(readFileSync(SEED, 'utf8')) : null;

// Deterministic exercise lookup so the test doesn't depend on the evolving library.
const FAKE = {
  trap_dl: { id: 'trap_dl', repRange: [5, 8], muscles: { glutes: 1, hamstrings: 0.75 } },
  db_bench: { id: 'db_bench', repRange: [8, 12], muscles: { chest_mid: 1 } },
  db_row: { id: 'db_row', repRange: [8, 12], muscles: { lats: 1 } },
  db_curl: { id: 'db_curl', repRange: [10, 15], muscles: { biceps_long: 1 } },
  db_shoulder: { id: 'db_shoulder', repRange: [8, 12], muscles: { delt_front: 1 } },
  db_lunge: { id: 'db_lunge', repRange: [8, 12], muscles: { quads: 1 } },
  db_decline: { id: 'db_decline', repRange: [8, 12], muscles: { chest_lower: 1 } },
};
for (const id of ['db_goblet', 'db_incline', 'trap_row', 'db_lateral', 'db_tri_oh', 'db_hammer']) FAKE[id] = { id, repRange: [8, 12], muscles: { abs: 1 } };
const lookup = id => FAKE[id] || null;

test('seed file converts: lifts, run days, weights', { skip: !seed }, () => {
  const c = convertIronRunner(seed, { lookup });
  const lifts = c.sessions.filter(s => s.blocks[0].kind === 'lift');
  const runs = c.sessions.filter(s => s.blocks[0].kind === 'cardio');
  assert.equal(lifts.length, 6);
  assert.deepEqual(runs.map(s => s.date), ['2026-04-05']);
  assert.equal(runs[0].blocks[0].modality, 'run');
  assert.equal(runs[0].blocks[0].minutes, 30);
  assert.equal(runs[0].blocks[0].intensity, 'easy');
  assert.deepEqual(c.bodyLog, [{ d: '2026-03-26', w: 164 }]);
  for (const s of c.sessions) {
    assert.equal(s.id, 's_ir_' + s.date);
    assert.equal(s.status, 'done'); assert.equal(s.source, 'import'); assert.equal(s.location, 'home');
  }
  // sorted ascending
  assert.deepEqual(c.sessions.map(s => s.date), [...c.sessions.map(s => s.date)].sort());

  const first = c.sessions.find(s => s.date === '2026-03-26');
  const dl = first.blocks.find(b => b.exId === 'trap_dl');
  assert.equal(dl.sets.length, 3);
  assert.deepEqual(dl.sets[0], { w: 135, r: 5, done: true });   // legacy → repRange[0]
  const curl = first.blocks.find(b => b.exId === 'db_curl');
  assert.deepEqual(curl.sets.map(x => x.r), [10, 10]);
  // missing weight in legacy data → null weight, still counted
  const last = c.sessions.find(s => s.date === '2026-04-06');
  assert.equal(last.blocks.find(b => b.exId === 'trap_dl').sets[0].w, null);
  assert.ok(first.title.length > 0);
});

test('a logged day with only unknown ids is not turned into a run', () => {
  const c = convertIronRunner({ 'ir_s_2026-01-01': '{"sets":{"zzz":[true]}}', ir_done: '{"2026-01-01":true}' }, { lookup });
  assert.equal(c.sessions.length, 0);
});

test('unknown ids are skipped and reported', () => {
  const c = convertIronRunner({ 'ir_s_2026-01-01': JSON.stringify({ sets: { mystery: [true], db_row: [true, false, true] }, wts: { db_row: 40 } }) }, { lookup });
  assert.deepEqual(c.unknown, ['mystery']);
  assert.equal(c.sessions.length, 1);
  assert.equal(c.sessions[0].blocks.length, 1);
  assert.equal(c.sessions[0].blocks[0].sets.length, 2);  // false sets dropped
});

test('new perf format wins over legacy and keeps per-set w/r', () => {
  const c = convertIronRunner({
    'ir_s_2026-02-02': { perf: { db_bench: [{ w: 50, r: 10 }, null, { w: 50, r: 9 }] }, sets: { db_bench: [true, true, true] }, wts: { db_bench: 45 } },
    ir_done: { '2026-02-02': true, '2026-02-03': true },
  }, { lookup });
  const b = c.sessions[0].blocks[0];
  assert.deepEqual(b.sets, [{ w: 50, r: 10, done: true }, { w: 50, r: 9, done: true }]);
  assert.equal(b.target.weight, 50);
  assert.equal(c.stats.runs, 1);
});

test('empty/garbage input does not throw; currentWt fallback', () => {
  assert.equal(convertIronRunner(null).sessions.length, 0);
  assert.equal(convertIronRunner({ ir_done: 'not json', 'ir_s_2026-01-01': '{bad' }).sessions.length, 0);
  const c = convertIronRunner({ ir_profile: '{"currentWt":170}', ir_start: '"2026-03-01T05:00:00.000Z"' });
  assert.deepEqual(c.bodyLog, [{ d: '2026-03-01', w: 170 }]);
});

test('applyImport is idempotent', { skip: !seed }, async () => {
  const { store } = await import('../js/store.js');
  store._reset();
  const c = convertIronRunner(seed, { lookup });
  const r1 = applyImport(store, c);
  assert.equal(r1.added, 7); assert.equal(r1.weights, 1);
  const r2 = applyImport(store, c);
  assert.equal(r2.added, 0); assert.equal(r2.skipped, 7); assert.equal(r2.weights, 0);
  assert.equal(store.getSessions().length, 7);
  store._reset();
});

test('real exercise library: converter runs without throwing', { skip: !seed }, () => {
  const c = convertIronRunner(seed);
  assert.ok(Array.isArray(c.sessions));
});
