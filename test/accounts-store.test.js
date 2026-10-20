// ACCOUNTS (CONTRACT §19): storage namespacing. The default account must keep using the original fg_* keys
// untouched while other accounts live under fga_<id>_*; registry + sync bookkeeping under fgx_*.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store, accounts, _useStorage, DEFAULT_ACCOUNT, prefixOf } from '../js/store.js';
import { PERSONAS, personaSeed } from '../js/data/personas.js';

function memLS(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m };
}
const pick = (ls, pre) => Object.fromEntries([...ls._m].filter(([k]) => k.startsWith(pre)).sort((a, b) => a[0].localeCompare(b[0])));

// Bob's phone as it is today: only fg_* keys, written by the current app.
function bobsPhone() {
  const profile = { schema: 1, name: 'Bob', units: 'lb', bodyweight: 164, goal: 'recomp', body: { sex: 'male', heightIn: 69, birthYear: 1987, trainingMonths: 7, activity: 'desk' } };
  const sessions = [
    { id: 's_1', date: '2026-10-01', status: 'done', startedAt: '2026-10-01T12:00:00.000Z', endedAt: '2026-10-01T12:45:00.000Z', location: 'home', blocks: [{ kind: 'lift', exId: 'db_curl', sets: [{ w: 30, r: 10, done: true }] }] },
    { id: 's_2', date: '2026-10-03', status: 'done', startedAt: '2026-10-03T12:00:00.000Z', endedAt: '2026-10-03T12:40:00.000Z', location: 'crunch', blocks: [] },
    { id: 's_3', date: '2026-10-20', status: 'active', startedAt: '2026-10-20T12:00:00.000Z', endedAt: null, location: 'home', blocks: [] },
  ];
  return memLS({
    fg_profile: JSON.stringify(profile), fg_sessions: JSON.stringify(sessions), fg_active: JSON.stringify('s_3'),
    fg_body: JSON.stringify([{ d: '2026-10-01', w: 164 }]), fg_meas: JSON.stringify([{ d: '2026-10-01', waist: 34.5 }]), fg_kv_builder: JSON.stringify({ minutes: 45 }),
    ir_done: '{}',   // Iron Runner keys on the same origin: never touched
  });
}

test('default account reads the existing fg_ keys and writes nothing new just by opening', () => {
  const ls = bobsPhone(); const before = pick(ls, '');
  _useStorage(ls);
  assert.equal(accounts.activeId(), DEFAULT_ACCOUNT);
  assert.deepEqual(accounts.list().map(a => [a.id, a.name, a.kind]), [[DEFAULT_ACCOUNT, 'Bob', 'local']]);
  assert.equal(store.getProfile().name, 'Bob');
  assert.equal(store.getSessions().length, 3);
  assert.equal(store.getActiveSession().id, 's_3');
  assert.deepEqual(store.kv('builder'), { minutes: 45 });
  assert.deepEqual(pick(ls, ''), before, 'reading must not write or migrate anything');
  assert.equal(prefixOf(DEFAULT_ACCOUNT), 'fg_');
});

test('creating / switching / writing in other accounts leaves every fg_ key byte-identical', () => {
  const ls = bobsPhone(); _useStorage(ls);
  const bob = pick(ls, 'fg_'), ir = pick(ls, 'ir_');
  const t = accounts.create({ name: PERSONAS.woman28.name, kind: 'test', persona: 'woman28', seed: personaSeed('woman28', '2026-10-20') });
  assert.ok(/^[a-z0-9]+$/.test(t.id));
  assert.ok(!prefixOf(t.id).startsWith('fg_'));
  accounts.switchTo(t.id);
  assert.equal(accounts.activeId(), t.id);
  // Bob's data is invisible here
  assert.equal(store.getSessions().length, 0);
  assert.equal(store.getActiveSession(), null);
  assert.equal(store.kv('builder'), null);
  assert.equal(store.getProfile().body.sex, 'female');
  // write everything a user can write
  store.saveSession({ id: 's_t1', date: '2026-10-20', status: 'done', blocks: [] });
  store.setActiveSessionId('s_t1');
  store.logBodyweight('2026-10-20', 139.5);
  store.logMeasurement({ d: '2026-10-20', hips: 38.5 });
  store.logFood({ d: '2026-10-20', kcal: 1900 });
  store.kv('builder', { minutes: 30 });
  store.updateProfile({ name: 'Maya' });
  store.replacePlanned('2026-10-21', '2026-10-27', [{ id: 's_p1', date: '2026-10-22', status: 'planned', plan: { auto: true }, blocks: [] }]);
  assert.deepEqual(pick(ls, 'fg_'), bob, 'fg_ keys unchanged while another account is active');
  // every key the test account wrote is under its prefix
  for (const k of ls._m.keys()) assert.ok(k.startsWith('fg_') || k.startsWith('fga_' + t.id + '_') || k.startsWith('fgx_') || k.startsWith('ir_'), 'stray key ' + k);
  accounts.switchTo(DEFAULT_ACCOUNT);
  assert.deepEqual(pick(ls, 'fg_'), bob);
  assert.deepEqual(pick(ls, 'ir_'), ir);
  assert.equal(store.getSessions().length, 3);
  assert.ok(!store.getSessions().some(s => s.id === 's_t1' || s.id === 's_p1'));
  assert.equal(store.getActiveSession().id, 's_3', 'the in-progress workout stays with its account');
  assert.equal(store.getProfile().name, 'Bob');
  // and back again: the test account kept its own state, including its active session
  accounts.switchTo(t.id);
  assert.equal(store.getActiveSession().id, 's_t1');
  assert.equal(store.getProfile().name, 'Maya');
});

test('export of one account contains none of another account; import stays in the active account', () => {
  const ls = bobsPhone(); _useStorage(ls);
  const bobExport = store.exportAll();
  assert.deepEqual(Object.keys(bobExport.data).sort(), ['fg_active', 'fg_body', 'fg_kv_builder', 'fg_meas', 'fg_profile', 'fg_sessions'], 'default export format unchanged');
  const t = accounts.create({ name: 'Sam', kind: 'local' });
  accounts.switchTo(t.id);
  store.saveSession({ id: 's_sam', date: '2026-10-20', status: 'done', blocks: [] });
  const samExport = store.exportAll();
  const samBlob = JSON.stringify(samExport);
  assert.ok(Object.keys(samExport.data).every(k => k.startsWith('fg_')), 'backups use canonical fg_ names');
  assert.ok(!samBlob.includes('s_1') && !samBlob.includes('s_2') && !samBlob.includes('"Bob"'), 'no Bob data in Sam export');
  assert.ok(samBlob.includes('s_sam'));
  accounts.switchTo(DEFAULT_ACCOUNT);
  const bobBlob = JSON.stringify(store.exportAll());
  assert.ok(!bobBlob.includes('s_sam') && !bobBlob.includes('Sam'), 'no Sam data in Bob export');
  // restoring Bob's backup into Sam's account must not touch fg_ keys
  const bob = pick(ls, 'fg_');
  accounts.switchTo(t.id);
  store.importAll(bobExport, { merge: true });
  assert.deepEqual(pick(ls, 'fg_'), bob);
  assert.equal(store.getSessions().length, 4);   // Bob's 3 merged with Sam's 1, inside Sam's account
  // foreign / unknown keys in a backup are ignored
  store.importAll({ app: 'forge', data: { ir_done: '"x"', fgx_active: '"default"', other: '1' } });
  assert.equal(ls.getItem('ir_done'), '{}');
  assert.equal(accounts.activeId(), t.id);
});

test('_reset clears only the active account', () => {
  const ls = bobsPhone(); _useStorage(ls);
  const bob = pick(ls, 'fg_');
  const t = accounts.create({ name: 'Sam' });
  accounts.switchTo(t.id);
  store.saveSession({ id: 's_sam', date: '2026-10-20', status: 'done', blocks: [] });
  store._reset();
  assert.equal(Object.keys(pick(ls, prefixOf(t.id))).length, 0);
  assert.deepEqual(pick(ls, 'fg_'), bob);
  assert.ok(accounts.get(t.id), 'the account itself remains');
  // _reset on the default account leaves other accounts and the registry alone
  store.saveSession({ id: 's_sam2', date: '2026-10-20', status: 'done', blocks: [] });
  const sam = pick(ls, prefixOf(t.id)), reg = pick(ls, 'fgx_');
  accounts.switchTo(DEFAULT_ACCOUNT);
  store._reset();
  assert.equal(Object.keys(pick(ls, 'fg_')).length, 0);
  assert.deepEqual(pick(ls, prefixOf(t.id)), sam);
  assert.equal(pick(ls, 'fgx_').fgx_accounts, reg.fgx_accounts);
});

test('deleting an account removes only its keys; the last account cannot be deleted', () => {
  const ls = bobsPhone(); _useStorage(ls);
  const bob = pick(ls, 'fg_');
  const a = accounts.create({ name: 'A', kind: 'test' }), b = accounts.create({ name: 'B' });
  accounts.switchTo(a.id); store.saveSession({ id: 's_a', date: '2026-10-20', status: 'done', blocks: [] }); accounts.stash(a.id);
  accounts.switchTo(b.id); store.saveSession({ id: 's_b', date: '2026-10-20', status: 'done', blocks: [] });
  const bKeys = pick(ls, prefixOf(b.id));
  assert.ok(ls.getItem('fgx_stash_' + a.id));
  assert.equal(accounts.remove(a.id), true);
  assert.equal(Object.keys(pick(ls, prefixOf(a.id))).length, 0);
  assert.equal(ls.getItem('fgx_stash_' + a.id), null);
  assert.deepEqual(pick(ls, prefixOf(b.id)), bKeys);
  assert.deepEqual(pick(ls, 'fg_'), bob);
  assert.deepEqual(accounts.list().map(x => x.id), [DEFAULT_ACCOUNT, b.id]);
  // deleting the active account falls back to another one
  assert.equal(accounts.activeId(), b.id);
  accounts.remove(b.id);
  assert.equal(accounts.activeId(), DEFAULT_ACCOUNT);
  assert.deepEqual(pick(ls, 'fg_'), bob);
  assert.throws(() => accounts.remove(DEFAULT_ACCOUNT), /only account/);
  assert.deepEqual(pick(ls, 'fg_'), bob);
});

test('deleting the default account removes only fg_ keys and it stays gone', () => {
  const ls = bobsPhone(); _useStorage(ls);
  const s = accounts.create({ name: 'Sam' });
  accounts.switchTo(s.id); store.saveSession({ id: 's_sam', date: '2026-10-20', status: 'done', blocks: [] });
  const sam = pick(ls, prefixOf(s.id));
  accounts.remove(DEFAULT_ACCOUNT);
  assert.equal(Object.keys(pick(ls, 'fg_')).length, 0);
  assert.equal(ls.getItem('ir_done'), '{}');
  assert.deepEqual(pick(ls, prefixOf(s.id)), sam);
  assert.deepEqual(accounts.list().map(x => x.id), [s.id]);
  _useStorage(ls);   // "reload"
  assert.equal(accounts.activeId(), s.id);
  assert.equal(store.getSessions()[0].id, 's_sam');
});

test('copy of an account is a deep copy; changing the copy leaves the original alone', () => {
  const ls = bobsPhone(); _useStorage(ls);
  const bob = pick(ls, 'fg_');
  const c = accounts.create({ name: 'Copy of Bob', kind: 'test', copyFrom: DEFAULT_ACCOUNT });
  const copied = pick(ls, prefixOf(c.id));
  assert.equal(Object.keys(copied).length, Object.keys(bob).length);
  for (const [k, v] of Object.entries(bob)) assert.equal(copied[prefixOf(c.id) + k.slice(3)], v);
  accounts.switchTo(c.id);
  assert.equal(accounts.kind(accounts.active()), 'test');
  store.deleteSession('s_1');
  store.updateProfile({ name: 'Bob (copy)' });
  accounts.switchTo(DEFAULT_ACCOUNT);
  assert.deepEqual(pick(ls, 'fg_'), bob);
  assert.equal(store.getSession('s_1').id, 's_1');
});

test('blank account: typed name, otherwise default profile; personas set sex/height/weight/measurements', () => {
  _useStorage(bobsPhone());
  const n = accounts.create({ name: '  Sam  ' });
  accounts.switchTo(n.id);
  const p = store.getProfile();
  assert.equal(p.name, 'Sam'); assert.equal(accounts.active().name, 'Sam');
  assert.equal(p.goal, 'recomp'); assert.ok(p.locations.length >= 3);
  assert.equal(store.getSessions().length, 0); assert.equal(store.getBodyLog().length, 0);
  const w = accounts.create({ name: PERSONAS.woman28.name, kind: 'test', persona: 'woman28', seed: personaSeed('woman28', '2026-10-20') });
  accounts.switchTo(w.id);
  const wp = store.getProfile();
  assert.equal(wp.body.sex, 'female'); assert.equal(wp.body.heightIn, 64); assert.equal(wp.body.trainingMonths, 2); assert.equal(wp.body.birthYear, 1998);
  assert.equal(wp.bodyweight, 140); assert.equal(store.getBodyLog().at(-1).w, 140);
  const m = store.getMeasurements().at(-1);
  assert.equal(m.d, '2026-10-20'); assert.ok(m.hips > 0 && m.waist > 0);
  assert.equal(accounts.kind(accounts.active()), 'test');
  const man = accounts.create({ name: PERSONAS.man52.name, kind: 'test', persona: 'man52', seed: personaSeed('man52', '2026-10-20') });
  accounts.switchTo(man.id);
  assert.equal(store.getProfile().body.sex, 'male'); assert.equal(store.getProfile().body.birthYear, 1974);
  assert.ok(store.getProfile().bodyweight > 200);
});

test('a lost registry never hides data: orphaned accounts come back as "Recovered account"', () => {
  const ls = bobsPhone(); _useStorage(ls);
  const s = accounts.create({ name: 'Sam' });
  accounts.switchTo(s.id); store.saveSession({ id: 's_sam', date: '2026-10-20', status: 'done', blocks: [] });
  ls.removeItem('fgx_accounts');
  ls.setItem('fgx_active', 'nonsense!!');
  _useStorage(ls);
  assert.equal(accounts.activeId(), DEFAULT_ACCOUNT, 'unknown pointer falls back to the default account');
  const list = accounts.list();
  assert.deepEqual(list.map(a => a.id), [DEFAULT_ACCOUNT, s.id]);
  assert.equal(list[1].name, 'Recovered account');
  accounts.switchTo(s.id);
  assert.equal(store.getSessions()[0].id, 's_sam');
});

test('rename, test accounts never get a cloud link, and local accounts keep no sync bookkeeping', () => {
  const ls = bobsPhone(); _useStorage(ls);
  const t = accounts.create({ name: 'T', kind: 'test', cloud: { userId: 'u1', linkedAt: 'x' } });
  assert.equal(accounts.get(t.id).cloud, undefined);
  assert.throws(() => accounts.updateCloud(t.id, { userId: 'u1' }), /never sync/);
  accounts.rename(t.id, 'Test person');
  assert.equal(accounts.get(t.id).name, 'Test person');
  assert.throws(() => accounts.rename(t.id, '   '), /Name/);
  accounts.switchTo(DEFAULT_ACCOUNT);
  const s = { id: 's_new', date: '2026-10-20', status: 'done', blocks: [] };
  store.saveSession(s);
  assert.ok(s.updatedAt && !isNaN(Date.parse(s.updatedAt)), 'saveSession stamps updatedAt');
  store.deleteSession('s_new');
  assert.equal([...ls._m.keys()].filter(k => k.startsWith('fgx_sync_')).length, 0, 'no bookkeeping until linked');
});
