// ACCOUNTS (CONTRACT §19): cloud sign-in + sync against a fake Supabase (GoTrue + PostgREST) behind a mocked
// fetch. Each "device" is its own storage; _useStorage() swaps between them. No real Supabase is reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store, accounts, _useStorage, DEFAULT_ACCOUNT } from '../js/store.js';
import { createCloud, mergeSessionRows, mergeDated } from '../js/cloud/sync.js';
import { parseAuthFragment, normalizeSession } from '../js/cloud/supabase.js';

const URL0 = 'https://demo.supabase.co', KEY = 'anon-key';
const CONFIG = { supabaseUrl: URL0, supabaseAnonKey: KEY, oauthProviders: ['apple', 'google'] };
const sleep = t => new Promise(r => setTimeout(r, t));

function memLS(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m };
}
const pick = (ls, pre) => Object.fromEntries([...ls._m].filter(([k]) => k.startsWith(pre)).sort((a, b) => a[0].localeCompare(b[0])));

// ---- fake Supabase ----
function fakeSupabase({ autoconfirm = true } = {}) {
  const users = new Map(), tokens = new Map(), refresh = new Map(), data = new Map(), calls = [];
  let n = 0, last = 0;
  const srv = { users, data, calls, offline: false, failNext: 0 };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body == null ? '' : JSON.stringify(body)) });
  const serverNow = () => { last = Math.max(Date.now(), last + 1); return new Date(last).toISOString(); };
  const userById = id => [...users.values()].find(u => u.id === id);
  const issue = uid => {
    const at = 'AT' + (++n) + 'secret', rt = 'RT' + n + 'secret';
    tokens.set(at, { uid, exp: Date.now() + 3600e3 }); refresh.set(rt, uid);
    return { access_token: at, refresh_token: rt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: userById(uid).email } };
  };
  srv.expireAll = () => tokens.forEach(t => { t.exp = 0; });
  srv.revokeRefresh = () => refresh.clear();
  srv.rows = email => { const u = users.get(email); return u ? [...(data.get(u.id) || new Map()).values()] : []; };
  srv.row = (email, key) => srv.rows(email).find(r => r.key === key);
  srv.issue = email => issue(users.get(email).id);
  srv.fetch = async (url, opts = {}) => {
    const u = new URL(url), method = opts.method || 'GET', h = opts.headers || {}, body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path: u.pathname, search: u.search, headers: h, body });
    if (srv.offline) throw new TypeError('Failed to fetch');
    if (srv.failNext > 0) { srv.failNext--; return res(500, { message: 'boom' }); }
    if (h.apikey !== KEY) return res(401, { message: 'Invalid API key' });
    const bearer = (h.Authorization || '').replace(/^Bearer /, '');
    const uid = (() => { const t = tokens.get(bearer); return t && t.exp > Date.now() ? t.uid : null; })();
    const p = u.pathname, q = u.searchParams;
    if (p === '/auth/v1/signup') {
      if (users.has(body.email)) return res(422, { msg: 'User already registered' });
      const user = { id: 'u-' + (users.size + 1), email: body.email, password: body.password };
      users.set(body.email, user);
      return autoconfirm ? res(200, issue(user.id)) : res(200, { id: user.id, email: user.email });
    }
    if (p === '/auth/v1/token' && q.get('grant_type') === 'password') {
      const user = users.get(body.email);
      return user && user.password === body.password ? res(200, issue(user.id)) : res(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    if (p === '/auth/v1/token' && q.get('grant_type') === 'refresh_token') {
      const id = refresh.get(body.refresh_token);
      if (!id) return res(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' });
      refresh.delete(body.refresh_token);   // rotation
      return res(200, issue(id));
    }
    if (p === '/auth/v1/logout') { tokens.delete(bearer); return res(204, null); }
    if (p === '/auth/v1/recover') return res(200, {});
    if (p === '/auth/v1/user') {
      if (!uid) return res(401, { msg: 'invalid JWT' });
      const user = userById(uid);
      if (method === 'PUT') { if (body.password) user.password = body.password; }
      return res(200, { id: user.id, email: user.email });
    }
    if (p === '/rest/v1/forge_state' && method === 'GET') {
      if (!uid) return res(401, { message: 'JWT expired', code: 'PGRST301' });
      let rows = [...(data.get(uid) || new Map()).values()];
      const since = q.get('synced_at'); if (since) rows = rows.filter(r => r.synced_at > since.replace(/^gt\./, ''));
      rows.sort((a, b) => a.synced_at.localeCompare(b.synced_at) || a.key.localeCompare(b.key));
      const off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 1000);
      return res(200, rows.slice(off, off + lim).map(r => ({ ...r })));
    }
    if (p === '/rest/v1/rpc/forge_push') {
      if (!uid) return res(401, { message: 'JWT expired', code: 'PGRST301' });
      const m = data.get(uid) || new Map(); data.set(uid, m);
      let c = 0;
      for (const r of body.rows) {
        const cur = m.get(r.key);
        if (!cur || Date.parse(cur.updated_at) < Date.parse(r.updated_at)) { m.set(r.key, { key: r.key, value: r.value ?? null, updated_at: r.updated_at, synced_at: serverNow() }); c++; }
      }
      return res(200, c);
    }
    if (p === '/rest/v1/rpc/delete_my_account') {
      if (!uid) return res(401, { message: 'not signed in' });
      const user = userById(uid); users.delete(user.email); data.delete(uid);
      return res(204, null);
    }
    return res(404, { message: 'no route ' + p });
  };
  return srv;
}

const manualTimers = () => { const q = []; return { q, set: fn => { q.push(fn); return q.length; }, clear: () => {}, flush: () => { while (q.length) q.shift()(); } }; };
const mkCloud = (srv, extra = {}) => createCloud({ config: CONFIG, fetch: srv.fetch, redirectUrl: 'https://app.test/forge/', debounceMs: 1, ...extra });
const session = (id, date, status = 'done', extra = {}) => ({ id, date, status, startedAt: date + 'T12:00:00.000Z', endedAt: status === 'done' ? date + 'T12:45:00.000Z' : null, location: 'home', blocks: [], ...extra });
function bobsPhone() {
  return memLS({
    fg_profile: JSON.stringify({ schema: 1, name: 'Bob', bodyweight: 164 }),
    fg_sessions: JSON.stringify([session('s_1', '2026-10-01'), session('s_2', '2026-10-03')]),
    fg_body: JSON.stringify([{ d: '2026-10-01', w: 164 }]),
    fg_kv_builder: JSON.stringify({ minutes: 45 }),
  });
}

test('unconfigured: nothing reaches the network and local accounts keep working', async () => {
  const calls = [];
  const c = createCloud({ config: { supabaseUrl: '', supabaseAnonKey: '', oauthProviders: ['apple'] }, fetch: async () => { calls.push(1); throw new Error('no'); } });
  _useStorage(bobsPhone());
  assert.equal(c.configured, false);
  assert.deepEqual(c.providers, []);
  assert.deepEqual(await c.sync(), { ok: false, skipped: 'unconfigured' });
  await assert.rejects(c.signIn('a@b.co', 'secret1'), e => e.code === 'unconfigured' && /isn't set up/.test(e.message));
  assert.throws(() => c.oauthStart('apple'), e => e.code === 'unconfigured');
  assert.deepEqual(await c.handleRedirect({ access_token: 'x' }), { status: 'unconfigured' });
  c.start(); store.saveSession(session('s_9', '2026-10-20')); c.schedulePush(); c.stop();
  assert.equal(calls.length, 0);
  const a = accounts.create({ name: 'Sam' }); accounts.switchTo(a.id);
  assert.equal(store.getSessions().length, 0);
});

test('first sign-up on Bob\'s phone uploads his data without touching his fg_ keys; tokens stay out of data and logs', async () => {
  const srv = fakeSupabase(); const ls = bobsPhone(); _useStorage(ls);
  const bob = pick(ls, 'fg_');
  const logs = []; const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.join(' '));
  let r;
  try { r = await mkCloud(srv).signUp('bob@example.com', 'hunter22'); } finally { Object.assign(console, orig); }
  assert.equal(r.status, 'linked'); assert.equal(r.how, 'upload');
  assert.deepEqual(pick(ls, 'fg_'), bob, 'linking must not rewrite the default account');
  const a = accounts.active();
  assert.equal(a.id, DEFAULT_ACCOUNT); assert.equal(accounts.kind(a), 'cloud');
  assert.equal(a.cloud.email, 'bob@example.com'); assert.ok(a.cloud.session.refresh_token); assert.ok(a.cloud.lastSyncAt);
  const keys = srv.rows('bob@example.com').map(x => x.key).sort();
  assert.deepEqual(keys, ['body', 'profile', 's:s_1', 's:s_2'], 'kv_* stays on the device; sessions are one row each');
  assert.deepEqual(srv.row('bob@example.com', 's:s_1').value.id, 's_1');
  const blob = JSON.stringify(pick(ls, 'fg_')) + JSON.stringify(store.exportAll());
  assert.ok(!/secret/.test(blob), 'no token in account data or backups');
  assert.ok(!logs.some(l => /secret/.test(l)), 'no token logged');
  const signup = srv.calls.find(x => x.path === '/auth/v1/signup');
  assert.equal(new URL(URL0 + '/x' + signup.search).searchParams.get('redirect_to'), 'https://app.test/forge/');
});

test('wrong password gives a readable error; sign-up awaiting confirmation asks to check email', async () => {
  const srv = fakeSupabase(); _useStorage(bobsPhone());
  await mkCloud(srv).signUp('bob@example.com', 'hunter22');
  _useStorage(bobsPhone());
  await assert.rejects(mkCloud(srv).signIn('bob@example.com', 'wrong!!'), e => e.status === 400 && e.message === 'Invalid login credentials' && !/secret/.test(e.message));
  const srv2 = fakeSupabase({ autoconfirm: false }); _useStorage(memLS());
  const r = await mkCloud(srv2).signUp('new@example.com', 'hunter22');
  assert.deepEqual(r, { status: 'confirm', email: 'new@example.com' });
  assert.equal(accounts.pending().mode, 'active');
  assert.equal(accounts.kind(accounts.active()), 'local');
});

test('two devices: sign-in pulls, edits push, deletes travel as tombstones and never come back', async () => {
  const srv = fakeSupabase();
  const A = bobsPhone(), B = memLS();
  _useStorage(A); const ca = mkCloud(srv);
  await ca.signUp('bob@example.com', 'hunter22');
  // device B: fresh install, "Sign in to an existing cloud account" → new account → reload → finishSetup
  _useStorage(B); const cb = mkCloud(srv);
  const r1 = await cb.signIn('bob@example.com', 'hunter22', { target: 'new' });
  assert.equal(r1.status, 'switched');
  _useStorage(B);   // reload
  assert.ok(accounts.active().cloud.initial);
  const r2 = await cb.finishSetup();
  assert.equal(r2.status, 'linked'); assert.equal(r2.how, 'replace');
  assert.deepEqual(store.getSessions().map(s => s.id), ['s_1', 's_2']);
  assert.equal(store.getProfile().name, 'Bob');
  assert.deepEqual(store.getBodyLog(), [{ d: '2026-10-01', w: 164 }]);
  // B logs a workout and a weigh-in → push
  await sleep(3);
  store.saveSession(session('s_b', '2026-10-20'));
  store.logBodyweight('2026-10-20', 163);
  assert.equal((await cb.sync()).ok, true);
  // A pulls them
  _useStorage(A);
  const ra = await ca.sync();
  assert.ok(ra.ok && ra.pulled >= 2);
  assert.ok(store.getSession('s_b'));
  assert.equal(store.getBodyLog().at(-1).w, 163);
  assert.equal(store.getProfile().bodyweight, 163);
  // A deletes s_1 → tombstone row
  await sleep(3);
  store.deleteSession('s_1');
  assert.ok(store.syncIO.meta().tomb.s_1, 'local tombstone until pushed');
  await ca.sync();
  assert.equal(srv.row('bob@example.com', 's:s_1').value, null);
  assert.equal(store.syncIO.meta().tomb.s_1, undefined, 'pushed tombstones are dropped locally (the cloud row is the tombstone)');
  // B pulls: s_1 gone; B pushing its own changes doesn't resurrect it
  _useStorage(B);
  await sleep(3);
  store.saveSession(session('s_b2', '2026-10-21'));
  await cb.sync();
  assert.equal(store.getSession('s_1'), null);
  assert.equal(srv.row('bob@example.com', 's:s_1').value, null);
  _useStorage(A); await ca.sync();
  assert.equal(store.getSession('s_1'), null);
  assert.ok(store.getSession('s_b2'));
});

test('conflicts: newer session copy wins on both devices; offline delete beats an older remote edit', async () => {
  const srv = fakeSupabase();
  const A = bobsPhone(), B = memLS();
  _useStorage(A); const ca = mkCloud(srv); await ca.signUp('bob@example.com', 'hunter22');
  _useStorage(B); const cb = mkCloud(srv); assert.equal((await cb.signIn('bob@example.com', 'hunter22')).how, 'replace');
  // both edit s_2; B edits later
  _useStorage(A); await sleep(3); store.saveSession({ ...store.getSession('s_2'), notes: 'from A' });
  _useStorage(B); await sleep(3); store.saveSession({ ...store.getSession('s_2'), notes: 'from B' });
  await cb.sync();
  _useStorage(A); await ca.sync();
  assert.equal(store.getSession('s_2').notes, 'from B');
  assert.equal(srv.row('bob@example.com', 's:s_2').value.notes, 'from B');
  // the server refuses an older write (forge_push guard): A re-pushing its stale copy can't win
  const stale = { key: 's:s_2', value: { id: 's_2', notes: 'stale' }, updated_at: '2020-01-01T00:00:00.000Z' };
  await srv.fetch(URL0 + '/rest/v1/rpc/forge_push', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + accounts.active().cloud.session.access_token }, body: JSON.stringify({ rows: [stale] }) });
  assert.equal(srv.row('bob@example.com', 's:s_2').value.notes, 'from B');
  // A edits s_2 (pushed), then B — offline, unaware — deletes it later: the delete is newer and wins everywhere
  await sleep(3); store.saveSession({ ...store.getSession('s_2'), notes: 'A again' }); await ca.sync();
  _useStorage(B); srv.offline = true; await sleep(3); store.deleteSession('s_2');
  const off = await cb.sync();
  assert.equal(off.ok, false);
  srv.offline = false;
  await cb.sync();
  assert.equal(store.getSession('s_2'), null);
  _useStorage(A); await ca.sync();
  assert.equal(store.getSession('s_2'), null);
});

test('mergeSessionRows / mergeDated rules', () => {
  const local = [{ id: 'a', updatedAt: '2026-10-20T10:00:00.000Z', v: 'L' }, { id: 'b', endedAt: '2026-10-01T10:00:00.000Z', v: 'L' }];
  const rows = [
    { key: 's:a', value: { id: 'a', v: 'R' }, updated_at: '2026-10-20T09:00:00.000Z' },   // older → keep local
    { key: 's:b', value: null, updated_at: '2026-10-02T00:00:00.000Z' },                  // tombstone newer than legacy local → delete
    { key: 's:c', value: { id: 'c', v: 'R' }, updated_at: '2026-10-20T09:00:00.000Z' },   // new → add (updatedAt filled from the row)
    { key: 's:d', value: { id: 'd' }, updated_at: '2026-10-20T09:00:00.000Z' },           // locally deleted later → stay deleted
  ];
  const r = mergeSessionRows(local, rows, { d: Date.parse('2026-10-20T11:00:00.000Z') });
  const by = Object.fromEntries(r.sessions.map(s => [s.id, s]));
  assert.equal(by.a.v, 'L'); assert.equal(by.b, undefined); assert.equal(by.c.updatedAt, '2026-10-20T09:00:00.000Z'); assert.equal(by.d, undefined);
  assert.equal(r.changed, 2);
  assert.deepEqual(mergeDated([{ d: '2026-10-01', w: 1 }, { d: '2026-10-03', w: 3 }], [{ d: '2026-10-02', w: 2 }, { d: '2026-10-03', w: 30 }]).map(e => e.w), [1, 2, 30]);
});

test('first sign-in with data on both sides: merge (default) keeps everything; upload and replace do what they say', async () => {
  const srv = fakeSupabase();
  _useStorage(bobsPhone()); await mkCloud(srv).signUp('bob@example.com', 'hunter22');   // cloud: s_1, s_2, body 10-01, name Bob
  const device = () => memLS({
    fg_profile: JSON.stringify({ schema: 1, name: 'iPad Bob' }),
    fg_sessions: JSON.stringify([session('s_ipad', '2026-10-05')]),
    fg_body: JSON.stringify([{ d: '2026-10-05', w: 165 }]),
  });
  // merge
  let C = device(); _useStorage(C); let cc = mkCloud(srv);
  let r = await cc.signIn('bob@example.com', 'hunter22');
  assert.equal(r.status, 'choose');
  assert.deepEqual(r.remote, { workouts: 2, weighIns: 1 }); assert.deepEqual(r.local, { workouts: 1, weighIns: 1 });
  assert.equal(accounts.kind(accounts.active()), 'local', 'not syncing until a choice is made');
  r = await cc.link('merge');
  assert.equal(r.how, 'merge');
  assert.deepEqual(store.getSessions().map(s => s.id), ['s_1', 's_2', 's_ipad']);
  assert.deepEqual(store.getBodyLog().map(e => e.d), ['2026-10-01', '2026-10-05']);
  assert.equal(store.getProfile().name, 'Bob', 'settings come from the account');
  assert.deepEqual(srv.rows('bob@example.com').filter(x => x.key.startsWith('s:') && x.value).map(x => x.key).sort(), ['s:s_1', 's:s_2', 's:s_ipad']);
  // upload: the account becomes exactly this device
  C = device(); _useStorage(C); cc = mkCloud(srv);
  assert.equal((await cc.signIn('bob@example.com', 'hunter22')).status, 'choose');
  await cc.link('upload');
  const live = srv.rows('bob@example.com').filter(x => x.value != null).map(x => x.key).sort();
  assert.deepEqual(live, ['body', 'profile', 's:s_ipad']);
  assert.equal(srv.row('bob@example.com', 'profile').value.name, 'iPad Bob');
  // replace: this device becomes the account; a safety copy is kept
  C = memLS({ fg_profile: JSON.stringify({ schema: 1, name: 'Phone 3' }), fg_sessions: JSON.stringify([session('s_p3', '2026-10-07')]) });
  _useStorage(C); cc = mkCloud(srv);
  assert.equal((await cc.signIn('bob@example.com', 'hunter22')).status, 'choose');
  await cc.link('replace');
  assert.deepEqual(store.getSessions().map(s => s.id), ['s_ipad']);
  assert.equal(store.getProfile().name, 'iPad Bob');
  const stash = accounts.stashed(DEFAULT_ACCOUNT);
  assert.ok(stash && JSON.parse(stash.data.fg_sessions)[0].id === 's_p3', 'pre-replace copy kept on the device');
});

test('tokens refresh before expiry and after a 401; a dead refresh token signs out but keeps data', async () => {
  const srv = fakeSupabase(); const ls = bobsPhone(); _useStorage(ls);
  const c = mkCloud(srv);
  await c.signUp('bob@example.com', 'hunter22');
  const t1 = accounts.active().cloud.session;
  // near expiry → refresh first
  accounts.updateCloud(DEFAULT_ACCOUNT, { session: { ...t1, expires_at: Math.floor(Date.now() / 1000) + 10 } });
  srv.calls.length = 0;
  assert.equal((await c.sync()).ok, true);
  assert.equal(srv.calls[0].path, '/auth/v1/token'); assert.ok(/refresh_token/.test(srv.calls[0].search));
  const t2 = accounts.active().cloud.session;
  assert.notEqual(t2.access_token, t1.access_token); assert.notEqual(t2.refresh_token, t1.refresh_token);
  // server-side expiry → 401 → refresh → retry
  srv.expireAll(); srv.calls.length = 0;
  assert.equal((await c.sync()).ok, true);
  assert.ok(srv.calls.some(x => x.path === '/auth/v1/token'));
  assert.notEqual(accounts.active().cloud.session.access_token, t2.access_token);
  // refresh token revoked → signed out, data kept, sync reports it
  srv.expireAll(); srv.revokeRefresh();
  const r = await c.sync();
  assert.equal(r.ok, false);
  const a = accounts.active();
  assert.equal(a.cloud.session, null); assert.match(a.cloud.lastError, /Sign in again/);
  assert.equal(store.getSessions().length, 2);
  // signing in again resumes the same link without asking
  const again = await c.signIn('bob@example.com', 'hunter22');
  assert.equal(again.status, 'linked'); assert.equal(again.how, 'resume');
});

test('sign out keeps local data (or not), revokes the session, drops sync bookkeeping', async () => {
  const srv = fakeSupabase(); const ls = bobsPhone(); _useStorage(ls);
  const c = mkCloud(srv);
  await c.signUp('bob@example.com', 'hunter22');
  const tok = accounts.active().cloud.session.access_token;
  assert.ok(ls.getItem('fgx_sync_default'));
  await c.signOut();
  const logout = srv.calls.find(x => x.path === '/auth/v1/logout');
  assert.equal(logout.headers.Authorization, 'Bearer ' + tok);
  const a = accounts.active();
  assert.equal(a.cloud, undefined); assert.equal(accounts.kind(a), 'local');
  assert.equal(ls.getItem('fgx_sync_default'), null);
  assert.equal(store.getSessions().length, 2, 'data stays on the device');
  assert.deepEqual(await c.sync(), { ok: false, skipped: 'not linked' });
  // offline sign-out still signs out locally
  await c.signIn('bob@example.com', 'hunter22').then(r => r.status === 'choose' ? c.link('merge') : r);
  srv.offline = true;
  await c.signOut();
  srv.offline = false;
  assert.equal(accounts.active().cloud, undefined);
});

test('debounced push after writes; offline writes wait and go up when back online', async () => {
  const srv = fakeSupabase(); _useStorage(bobsPhone());
  const timers = manualTimers(); let online = true;
  const c = mkCloud(srv, { timers, isOnline: () => online });
  await c.signUp('bob@example.com', 'hunter22');
  c.start();
  await sleep(3);
  store.saveSession(session('s_new', '2026-10-20'));
  store.logBodyweight('2026-10-20', 162);
  assert.ok(timers.q.length >= 1, 'a push is scheduled');
  srv.calls.length = 0;
  timers.flush(); await sleep(20);
  assert.ok(srv.calls.every(x => x.path !== '/rest/v1/forge_state'), 'write-triggered sync only pushes');
  assert.ok(srv.row('bob@example.com', 's:s_new'));
  assert.equal(srv.row('bob@example.com', 'body').value.at(-1).w, 162);
  online = false;
  await sleep(3); store.saveSession(session('s_off', '2026-10-21'));
  timers.flush(); await sleep(10);
  assert.equal(srv.row('bob@example.com', 's:s_off'), undefined);
  assert.match(accounts.active().cloud.lastError, /Offline/);
  online = true;
  assert.equal((await c.sync()).ok, true);
  assert.ok(srv.row('bob@example.com', 's:s_off'));
  assert.equal(accounts.active().cloud.lastError, null);
  c.stop();
});

test('test accounts never sync; server errors are reported, not thrown', async () => {
  const srv = fakeSupabase(); _useStorage(bobsPhone());
  const t = accounts.create({ name: 'Test', kind: 'test' }); accounts.switchTo(t.id);
  const c = mkCloud(srv);
  await assert.rejects(c.signUp('t@example.com', 'hunter22'), e => e.code === 'test');
  assert.equal(srv.rows('t@example.com').length, 0);
  assert.deepEqual(await c.sync(), { ok: false, skipped: 'not linked' });
  accounts.switchTo(DEFAULT_ACCOUNT);
  await c.signUp('bob@example.com', 'hunter22');
  srv.failNext = 1;
  const r = await c.sync();
  assert.equal(r.ok, false); assert.match(r.error, /boom/);
  assert.match(accounts.active().cloud.lastError, /boom/);
  assert.equal((await c.sync()).ok, true);
});

test('in-app cloud account deletion calls delete_my_account and keeps the local copy until removed', async () => {
  const srv = fakeSupabase(); _useStorage(bobsPhone());
  const c = mkCloud(srv);
  await c.signUp('bob@example.com', 'hunter22');
  assert.ok(srv.rows('bob@example.com').length > 0);
  await c.deleteCloudAccount();
  assert.ok(srv.calls.some(x => x.path === '/rest/v1/rpc/delete_my_account' && x.method === 'POST'));
  assert.equal(srv.users.has('bob@example.com'), false);
  assert.equal(srv.rows('bob@example.com').length, 0);
  assert.equal(accounts.kind(accounts.active()), 'local');
  assert.equal(store.getSessions().length, 2);
});

test('OAuth: authorize URL, fragment pickup links the pending account, errors and stray links are handled', async () => {
  const srv = fakeSupabase(); _useStorage(bobsPhone());
  await mkCloud(srv).signUp('bob@example.com', 'hunter22');   // account exists in the cloud (as if made via Apple)
  _useStorage(memLS());
  const c = mkCloud(srv);
  const href = c.oauthStart('apple');
  const u = new URL(href);
  assert.equal(u.origin + u.pathname, URL0 + '/auth/v1/authorize');
  assert.equal(u.searchParams.get('provider'), 'apple'); assert.equal(u.searchParams.get('redirect_to'), 'https://app.test/forge/');
  assert.throws(() => c.oauthStart('github'), /isn't turned on/);
  assert.equal(accounts.pending().provider, 'apple');
  // provider sends the browser back with tokens in the fragment
  const t = srv.issue('bob@example.com');
  const frag = parseAuthFragment(`#access_token=${t.access_token}&expires_at=${t.expires_at}&expires_in=3600&refresh_token=${t.refresh_token}&token_type=bearer`);
  const r = await c.handleRedirect(frag);
  assert.equal(r.status, 'linked'); assert.equal(r.how, 'replace');
  assert.equal(accounts.active().cloud.provider, 'apple');
  assert.equal(store.getSessions().length, 2);
  assert.equal(accounts.pending(), null);
  // error fragment
  assert.deepEqual(parseAuthFragment('#error=access_denied&error_code=403&error_description=User+cancelled'), { error: '403', description: 'User cancelled' });
  assert.equal((await c.handleRedirect(parseAuthFragment('?error=access_denied&error_description=User+cancelled'))).message, 'User cancelled');
  // a confirmation link with no pending sign-in on this device is not attached to anything
  const t2 = srv.issue('bob@example.com');
  _useStorage(memLS());
  const r2 = await mkCloud(srv).handleRedirect(parseAuthFragment(`#access_token=${t2.access_token}&refresh_token=${t2.refresh_token}&expires_in=3600&type=signup`));
  assert.equal(r2.status, 'confirmed');
  assert.equal(accounts.active().cloud, undefined);
  // password recovery link → set a new password
  const t3 = srv.issue('bob@example.com');
  const rec = await mkCloud(srv).handleRedirect(parseAuthFragment(`#access_token=${t3.access_token}&refresh_token=${t3.refresh_token}&expires_in=3600&type=recovery`));
  assert.equal(rec.status, 'recovery');
  assert.equal((await mkCloud(srv).setNewPassword(rec, 'newpass9')).status, 'password');
  assert.equal(srv.users.get('bob@example.com').password, 'newpass9');
  assert.equal(normalizeSession({ id: 'u1' }), null);
});

test('the same cloud user is never linked to two accounts on one device', async () => {
  const srv = fakeSupabase(); _useStorage(bobsPhone());
  const c = mkCloud(srv);
  await c.signUp('bob@example.com', 'hunter22');
  const other = accounts.create({ name: 'Other' }); accounts.switchTo(other.id);
  const r = await c.signIn('bob@example.com', 'hunter22');
  assert.equal(r.status, 'exists'); assert.equal(r.account.id, DEFAULT_ACCOUNT);
  assert.equal(accounts.get(other.id).cloud, undefined);
});

test('a restore in a cloud account goes up in full; merge:false deletes what the backup dropped', async () => {
  const srv = fakeSupabase(); _useStorage(bobsPhone());
  const c = mkCloud(srv);
  await c.signUp('bob@example.com', 'hunter22');
  await sleep(3);
  store.importAll({ app: 'forge', data: { fg_profile: JSON.stringify({ schema: 1, name: 'Restored' }), fg_sessions: JSON.stringify([session('s_x', '2026-09-01')]) } }, { merge: false });
  assert.equal((await c.sync()).ok, true);
  const live = Object.fromEntries(srv.rows('bob@example.com').map(r => [r.key, r.value]));
  assert.equal(live.profile.name, 'Restored');
  assert.ok(live['s:s_x']);
  assert.equal(live['s:s_1'], null); assert.equal(live['s:s_2'], null);
  assert.equal(live.body, null, 'a key the backup did not have is deleted in the cloud too');
});

test('clock skew: an edit made after pulling a row from a device whose clock runs ahead still wins', async () => {
  const srv = fakeSupabase(); _useStorage(bobsPhone());
  const c = mkCloud(srv);
  await c.signUp('bob@example.com', 'hunter22');
  const future = new Date(Date.now() + 3600e3).toISOString();   // another device, clock one hour fast
  const tok = srv.issue('bob@example.com').access_token;
  await srv.fetch(URL0 + '/rest/v1/rpc/forge_push', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + tok }, body: JSON.stringify({ rows: [
    { key: 'profile', value: { schema: 1, name: 'Fast clock' }, updated_at: future },
    { key: 's:s_1', value: { ...session('s_1', '2026-10-01'), notes: 'fast', updatedAt: future }, updated_at: future },
  ] }) });
  await c.sync();
  assert.equal(store.getProfile().name, 'Fast clock');
  assert.equal(store.getSession('s_1').notes, 'fast');
  store.updateProfile({ name: 'Bob' });
  store.saveSession({ ...store.getSession('s_1'), notes: 'edited here' });
  await c.sync();
  assert.equal(srv.row('bob@example.com', 'profile').value.name, 'Bob');
  assert.equal(srv.row('bob@example.com', 's:s_1').value.notes, 'edited here');
  store.deleteSession('s_1');
  await c.sync();
  assert.equal(srv.row('bob@example.com', 's:s_1').value, null, 'and so does a delete');
});

test('signing a signed-out cloud account in as a different user starts over: nothing crosses between users', async () => {
  const srv = fakeSupabase(); _useStorage(bobsPhone());
  const timers = manualTimers();
  const c = mkCloud(srv, { timers });
  await c.signUp('bob@example.com', 'hunter22');
  await c.signOut();
  // pretend sign-out kept the link but lost the session (expired), then someone else signs in
  await c.signIn('bob@example.com', 'hunter22');
  accounts.updateCloud(DEFAULT_ACCOUNT, { session: null });
  _useStorage(memLS({ fg_body: JSON.stringify([{ d: '2026-10-02', w: 130 }]) })); await mkCloud(srv).signUp('eve@example.com', 'hunter22');   // eve has her own cloud data
  _useStorage(bobsPhone());
  // re-link bob's phone to bob, then expire the session and sign in as eve
  const c2 = mkCloud(srv, { timers });
  await c2.signIn('bob@example.com', 'hunter22').then(r => (r.status === 'choose' ? c2.link('merge') : r));
  accounts.updateCloud(DEFAULT_ACCOUNT, { session: null });
  c2.start();
  const r = await c2.signIn('eve@example.com', 'hunter22');
  assert.equal(r.status, 'choose');
  assert.equal(accounts.kind(accounts.active()), 'local', 'not linked to anyone until the choice');
  store.saveSession(session('s_local', '2026-10-20'));
  timers.flush(); await sleep(10);
  assert.equal(srv.row('eve@example.com', 's:s_local'), undefined, "nothing pushed into eve's account before the choice");
  assert.equal(srv.row('eve@example.com', 's:s_1'), undefined);
  assert.deepEqual(srv.row('eve@example.com', 'body').value, [{ d: '2026-10-02', w: 130 }]);
  c2.stop();
});
