// Persistence integrity (bug hunt). A stored value can be the wrong SHAPE and still be valid JSON:
// a hand-edited key, a truncated or edited backup, an old export, or a row pulled from the cloud.
// Every read must degrade to "nothing logged" rather than throw somewhere up in a screen, and a
// restore must never half-apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store, accounts, _useStorage, DEFAULT_ACCOUNT } from '../js/store.js';

function memLS(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m };
}
const session = (id, date, extra = {}) => ({ id, date, status: 'done', startedAt: null, endedAt: null, location: 'home', minutes: 30, title: id, targets: [], source: 'manual', blocks: [], rationale: [], notes: '', ...extra });

// Every way a key can be wrong, and what each reader must give back instead of throwing.
const BAD = ['null', '"a string"', '0', 'true', '{"d":1}', '[1,2,3]', '{broken', '[]', '""'];

test('a corrupt or hand-edited value degrades instead of crashing a read', () => {
  for (const bad of BAD) {
    for (const key of ['fg_sessions', 'fg_body', 'fg_meas', 'fg_food', 'fg_profile', 'fg_active']) {
      _useStorage(memLS({ [key]: bad }));
      const where = `${key} = ${bad}`;
      assert.doesNotThrow(() => store.getSessions(), where);
      assert.doesNotThrow(() => store.getSession('s_1'), where);
      assert.doesNotThrow(() => store.getPlanned({ from: '2026-01-01', to: '2026-12-31' }), where);
      assert.doesNotThrow(() => store.getActiveSession(), where);
      assert.doesNotThrow(() => store.getBodyLog(), where);
      assert.doesNotThrow(() => store.getMeasurements(), where);
      assert.doesNotThrow(() => store.getFoodLog(), where);
      assert.doesNotThrow(() => store.getProfile(), where);
      // The shapes every caller relies on.
      assert.ok(Array.isArray(store.getSessions()), where);
      assert.ok(Array.isArray(store.getBodyLog()), where);
      assert.ok(Array.isArray(store.getMeasurements()), where);
      assert.ok(Array.isArray(store.getFoodLog()), where);
      const p = store.getProfile();
      assert.ok(p && typeof p === 'object' && !Array.isArray(p), where);
      assert.equal(typeof p.schema, 'number', where);
      assert.ok(Array.isArray(p.locations), where);
      // Dated rows always have a usable date (a `food` row with no `d` used to reach fmtShort()).
      for (const e of [...store.getBodyLog(), ...store.getMeasurements(), ...store.getFoodLog()]) assert.match(e.d, /^\d{4}-\d{2}-\d{2}$/, where);
      for (const s of store.getSessions()) { assert.equal(typeof s.id, 'string', where); assert.equal(typeof s.date, 'string', where); }
    }
  }
});

test('junk entries inside a good array are dropped, the real ones are kept', () => {
  _useStorage(memLS({
    fg_sessions: JSON.stringify([session('s_1', '2026-10-01'), null, 'x', 42, { id: 's_no_date' }, { date: '2026-10-02' }, session('s_2', '2026-10-02')]),
    fg_body: JSON.stringify([{ d: '2026-10-01', w: 164 }, null, { w: 160 }, { d: 'later', w: 1 }, 7]),
  }));
  assert.deepEqual(store.getSessions().map(s => s.id), ['s_1', 's_2']);
  assert.deepEqual(store.getBodyLog(), [{ d: '2026-10-01', w: 164 }]);
  // A write after the repair keeps the good rows (it must not start from the fallback).
  store.saveSession(session('s_3', '2026-10-03'));
  assert.deepEqual(store.getSessions().map(s => s.id), ['s_1', 's_2', 's_3']);
});

test('profile reads as the defaults when fg_profile is not an object', () => {
  for (const bad of ['null', '"Bob"', '[1,2]', '3']) {
    _useStorage(memLS({ fg_profile: bad }));
    const p = store.getProfile();
    assert.equal(p.name, 'Bob');
    assert.equal(p.units, 'lb');
    assert.ok(p.schedule && p.schedule.mon, `schedule for ${bad}`);
    assert.ok(!('0' in p), `${bad} must not spread into numeric keys`);
  }
});

test('a weigh-in needs a finite weight (NaN used to be stored as JSON null)', () => {
  _useStorage(memLS());
  for (const bad of ['abc', NaN, 0, -5, null, undefined, Infinity, {}, '']) {
    assert.equal(store.logBodyweight('2026-10-01', bad), false, String(bad));
  }
  assert.deepEqual(store.getBodyLog(), [], 'nothing was stored');
  assert.equal(store.getProfile().bodyweight, null);
  assert.equal(store.logBodyweight('2026-10-01', 164), true);
  assert.deepEqual(store.getBodyLog(), [{ d: '2026-10-01', w: 164 }]);
  // A string number is fine (that is what an <input> gives us).
  assert.equal(store.logBodyweight('2026-10-02', '163.5'), true);
  assert.deepEqual(store.getBodyLog().at(-1), { d: '2026-10-02', w: 163.5 });
  // An unusable date falls back to today rather than writing a row no screen can show.
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  assert.equal(store.logBodyweight('', 162), true);
  assert.ok(store.getBodyLog().some(e => e.d === ds && e.w === 162));
});

test('deleting the newest weigh-in refreshes profile.bodyweight', () => {
  _useStorage(memLS());
  store.logBodyweight('2026-10-01', 164);
  store.logBodyweight('2026-10-08', 162);
  assert.equal(store.getProfile().bodyweight, 162);
  store.deleteBodyweight('2026-10-08');
  assert.equal(store.getProfile().bodyweight, 164, 'must fall back to the weigh-in that is now newest');
  store.deleteBodyweight('2026-10-01');
  assert.equal(store.getProfile().bodyweight, null, 'no weigh-ins left → no bodyweight');
});

// ---------------- restore ----------------
const backup = data => ({ app: 'forge', schema: 1, exportedAt: '2026-10-21T00:00:00.000Z', data });

test('export → import round-trips the account byte for byte', () => {
  _useStorage(memLS());
  store.updateProfile({ name: 'Bob', bodyweight: null });
  store.logBodyweight('2026-10-01', 164);
  store.logMeasurement({ d: '2026-10-01', waist: 34.5 });
  store.logFood({ d: '2026-10-01', kcal: 2600 });
  store.saveSession(session('s_1', '2026-10-01'));
  store.kv('builder', { minutes: 45 });
  const ls = memLS();
  const snap = JSON.stringify(store.exportAll().data);
  const b = store.exportAll();
  _useStorage(ls);
  store.importAll(b, { merge: false });
  assert.equal(JSON.stringify(store.exportAll().data), snap);
});

test('a truncated or wrong-shaped backup is skipped per key, never half-applied', () => {
  // Key order matters: fg_profile comes first, so the old code wrote it and then threw on sessions.
  const ls = memLS();
  _useStorage(ls);
  store.updateProfile({ name: 'Bob' });
  store.saveSession(session('s_keep', '2026-10-01'));
  store.logBodyweight('2026-10-01', 164);

  const r = store.importAll(backup({
    fg_profile: JSON.stringify({ schema: 1, name: 'Restored' }),
    fg_sessions: '[{"id":"s_x","date":"2026-10-02"',          // truncated
    fg_body: JSON.stringify([{ d: '2026-10-02', w: 163 }]),
  }), { merge: true });

  assert.deepEqual(r.skipped, ['sessions']);
  assert.deepEqual(r.keys.sort(), ['body', 'profile']);
  assert.equal(store.getProfile().name, 'Restored', 'the good keys still land');
  assert.deepEqual(store.getSessions().map(s => s.id), ['s_keep'], 'the session the backup could not give us is left alone');
  assert.deepEqual(store.getBodyLog(), [{ d: '2026-10-02', w: 163 }]);
  // Nothing unparseable was written: every stored value reads back as JSON.
  for (const [k, v] of ls._m) if (k.startsWith('fg_')) assert.doesNotThrow(() => JSON.parse(v), k);
});

test('a backup whose sessions value is not an array is skipped, not thrown', () => {
  _useStorage(memLS());
  store.saveSession(session('s_keep', '2026-10-01'));
  for (const bad of ['{"not":"an array"}', 'null', '"x"', '12']) {
    let r;
    assert.doesNotThrow(() => { r = store.importAll(backup({ fg_sessions: bad }), { merge: true }); }, bad);
    assert.deepEqual(r.skipped, ['sessions'], bad);
    assert.deepEqual(store.getSessions().map(s => s.id), ['s_keep'], bad);
  }
});

test('merge:false with a bad key still restores the good ones and leaves no unparseable value', () => {
  const ls = memLS();
  _useStorage(ls);
  store.saveSession(session('s_old', '2026-09-01'));
  const r = store.importAll(backup({
    fg_profile: JSON.stringify({ schema: 1, name: 'Restored' }),
    fg_sessions: '[{"id":"s_x"',
  }), { merge: false });
  assert.deepEqual(r.skipped, ['sessions']);
  assert.equal(store.getProfile().name, 'Restored');
  assert.deepEqual(store.getSessions(), [], 'merge:false drops what the backup does not contain');
  assert.equal(ls._m.get('fg_sessions'), undefined, 'the unparseable value was never written');
});

test('a restore can still only write inside the active account', () => {
  const ls = memLS();
  _useStorage(ls);
  const sam = accounts.create({ name: 'Sam' });
  accounts.switchTo(sam.id);
  store.importAll(backup({ fg_profile: JSON.stringify({ schema: 1, name: 'Restored' }), fgx_accounts: '[]', ir_done: '{}', evil: '1' }), { merge: true });
  assert.equal(store.getProfile().name, 'Restored');
  assert.ok([...ls._m.keys()].every(k => k.startsWith('fga_') || k.startsWith('fgx_')), [...ls._m.keys()].join(','));
  assert.ok(accounts.list().some(a => a.id === sam.id), 'the registry survived a backup that carried fgx_accounts');
  accounts.switchTo(DEFAULT_ACCOUNT);
});

test('"Not a Forge backup" is still the only thing importAll throws for', () => {
  _useStorage(memLS());
  assert.throws(() => store.importAll(null), /Not a Forge backup/);
  assert.throws(() => store.importAll({ app: 'x', data: {} }), /Not a Forge backup/);
  assert.throws(() => store.importAll({ app: 'forge' }), /Not a Forge backup/);
  assert.throws(() => store.importAll({ app: 'forge', data: 'x' }), /Not a Forge backup/);
});
