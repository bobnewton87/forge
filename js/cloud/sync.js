// Cloud sign-in + offline-first sync (CONTRACT §19). DOM-free: fetch, timers, clock and the online check are
// injectable, so node tests drive it with a mocked fetch. Only the ACTIVE account syncs; test accounts never do.
//
// Conflict policy
//  • Each store key (profile, body, meas, food, …) is one cloud row. Last write wins by updated_at, the writing
//    device's clock when that key last changed (the store keeps these times in fgx_sync_<id>.keys).
//  • Sessions are one row each ('s:<id>') and merge by id using the session's own updatedAt (stamped by
//    store.saveSession). A deleted session leaves a tombstone row (value null), so the delete reaches the other
//    devices instead of the session coming back.
//  • 'active' (the in-progress pointer) and 'kv_*' (screen state) never leave the device.
//  • The server keeps an incoming row only if it is newer than the one it has (forge_push in supabase/schema.sql),
//    so two devices pushing at once can't replace a newer change with an older one.
//  • Pull = rows whose server time (synced_at) is after the last pull, minus a 2-minute overlap (applying a row
//    twice is harmless). Push = everything changed since the last successful push.
//  Known limits: device clocks decide ties between devices; if two devices edit the same key (e.g. both log a
//  weigh-in) before either syncs, the later edit wins that key. Sessions never collide this way.
import { store as defaultStore, accounts as defaultAccounts, LOCAL_ONLY } from '../store.js';
import { createClient, normalizeSession, CloudError } from './supabase.js';

const SESS = 's:';
const PAGE = 500, CHUNK = 200, OVERLAP_MS = 2 * 60000, MAX_PAGES = 400;
const DATED = new Set(['body', 'meas', 'food']);   // arrays of { d, … }: the first-sign-in merge unions them by date
export const OFFLINE = "Offline. Changes will sync when you're back online.";
const iso = t => new Date(t).toISOString();
const ms = s => { const t = Date.parse(s || ''); return isNaN(t) ? 0 : t; };
const arr = v => (Array.isArray(v) ? v : []);
const parse = raw => { if (raw == null) return null; try { return JSON.parse(raw); } catch (e) { return undefined; } };
export const sessTime = s => ms(s && (s.updatedAt || s.endedAt || s.startedAt));

const withTime = (v, id, at) => { const s = { ...v, id }; if (sessTime(s) < ms(at)) s.updatedAt = at; return s; };
// Remote session rows → local sessions. Newer copy wins; a tombstone deletes an older local copy;
// tomb = this device's not-yet-pushed deletes ({ id: ms }), which beat older remote copies.
export function mergeSessionRows(local, rows, tomb = {}) {
  const byId = new Map(arr(local).filter(s => s && s.id).map(s => [s.id, s]));
  let changed = 0;
  for (const r of rows) {
    const id = r.key.slice(SESS.length), rt = ms(r.updated_at), cur = byId.get(id);
    const val = r.value && typeof r.value === 'object' && !Array.isArray(r.value) ? r.value : null;
    if (!id) continue;
    if (cur) {
      if (rt <= sessTime(cur)) continue;
      if (val) byId.set(id, withTime(val, id, r.updated_at)); else byId.delete(id);
      changed++;
    } else if (val && !(tomb[id] && tomb[id] >= rt)) { byId.set(id, withTime(val, id, r.updated_at)); changed++; }
  }
  return { sessions: [...byId.values()], changed };
}
export function mergeDated(local, remote) {   // same date in both → the account's entry
  const by = new Map();
  for (const e of [...arr(local), ...arr(remote)]) if (e && e.d) by.set(e.d, e);
  return [...by.values()].sort((a, b) => String(a.d).localeCompare(String(b.d)));
}
const cursorOf = (rows, prev) => rows.reduce((c, r) => (r.synced_at && ms(r.synced_at) > ms(c) ? r.synced_at : c), prev || null);

export function createCloud({ config = {}, fetch, store = defaultStore, accounts = defaultAccounts, now = () => Date.now(), redirectUrl = '',
  timers = { set: (fn, t) => setTimeout(fn, t), clear: t => clearTimeout(t) }, isOnline = () => true, debounceMs = 4000, onStatus = () => {} } = {}) {
  const url = String(config.supabaseUrl || '').trim(), anon = String(config.supabaseAnonKey || '').trim();
  const configured = !!(url && anon);
  const client = configured ? createClient({ url, anonKey: anon, fetch }) : null;
  const providers = configured ? arr(config.oauthProviders).filter(p => typeof p === 'string' && /^[a-z0-9_]+$/.test(p)) : [];
  const io = store.syncIO;
  const refreshing = new Map();
  let applying = false, timer = null, inflight = null, again = false, unsub = null, pendingRemote = null;

  const need = () => { if (!configured) throw new CloudError("Cloud sign-in isn't set up yet.", 0, 'unconfigured'); };
  const status = (id, patch) => {   // sync state on the account record (skipped once it has signed out)
    try { const a = accounts.get(id); if (a && a.cloud && a.cloud.userId) accounts.updateCloud(id, patch); } catch (e) { /* account removed meanwhile */ }
    try { onStatus(); } catch (e) { /* UI hook */ }
  };

  // ---------------- tokens ----------------
  async function accessToken(id, { force = false } = {}) {
    const a = accounts.get(id), s = a && a.cloud && a.cloud.session;
    if (!s || !s.refresh_token) throw new CloudError('Signed out. Sign in again to sync.', 401, 'signed_out');
    if (!force && s.access_token && (Number(s.expires_at) || 0) * 1000 - now() > 60000) return s.access_token;
    if (!refreshing.has(id)) {
      refreshing.set(id, (async () => {
        try {
          const ns = normalizeSession(await client.refresh(s.refresh_token), now());
          if (!ns) throw new CloudError('Signed out. Sign in again to sync.', 401, 'signed_out');
          accounts.updateCloud(id, { session: ns.session });
          return ns.session.access_token;
        } catch (e) {
          if (!(e.status >= 400 && e.status < 500)) throw e;   // offline / server trouble: keep the tokens, try later
          const msg = 'Signed out. Sign in again to sync.';
          status(id, { session: null, lastError: msg });
          throw new CloudError(msg, 401, 'signed_out');
        } finally { refreshing.delete(id); }
      })());
    }
    return refreshing.get(id);
  }
  async function authed(id, fn) {   // call with a fresh access token; on 401 refresh once and retry
    try { return await fn(await accessToken(id)); }
    catch (e) { if (e.status !== 401 || e.code === 'signed_out') throw e; return fn(await accessToken(id, { force: true })); }
  }

  // ---------------- pull ----------------
  async function fetchRows(id, since = null) {
    const out = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await authed(id, t => client.selectRows(t, { since, offset: page * PAGE, limit: PAGE }));
      if (!Array.isArray(rows)) break;
      out.push(...rows.filter(r => r && typeof r.key === 'string' && r.key));
      if (rows.length < PAGE) break;
    }
    return out;
  }
  function apply(rows) {   // normal pull: LWW per key, sessions by id
    if (!rows.length) return 0;
    let n = 0;
    applying = true;
    try {
      const m = io.meta(), sessRows = [];
      for (const r of rows) {
        if (r.key.startsWith(SESS)) { sessRows.push(r); continue; }
        if (r.key === 'sessions' || LOCAL_ONLY(r.key)) continue;
        const rt = ms(r.updated_at);
        if (rt <= (m.keys[r.key] || 0)) continue;
        io.put(r.key, r.value == null ? null : JSON.stringify(r.value));
        m.keys[r.key] = rt; n++;
      }
      if (sessRows.length) {
        const res = mergeSessionRows(arr(parse(io.get('sessions'))), sessRows, m.tomb);
        if (res.changed) { io.putSessions(res.sessions); n += res.changed; }
      }
      m.cursor = cursorOf(rows, m.cursor);
      io.saveMeta();
    } finally { applying = false; }
    if (n) io.changed();
    return n;
  }
  async function pull({ full = false } = {}) {
    const id = io.accountId(), m = io.meta();
    const since = !full && m.cursor ? iso(ms(m.cursor) - OVERLAP_MS) : null;
    const rows = await fetchRows(id, since);
    if (io.accountId() !== id) return 0;   // switched away meanwhile
    return apply(rows);
  }

  // ---------------- push ----------------
  function collectPush({ full, since, forceAt = 0 }) {
    const m = io.meta(), rows = new Map(), at = t => iso(forceAt || t);
    for (const k of new Set([...io.keys(), ...Object.keys(m.keys)])) {
      if (k === 'sessions' || LOCAL_ONLY(k)) continue;
      const kt = m.keys[k] || 0;
      if (!full && kt < since) continue;
      const v = parse(io.get(k));
      if (v === undefined) continue;   // unreadable locally: leave the cloud copy alone
      rows.set(k, { key: k, value: v, updated_at: at(kt || now()) });   // null = deleted here
    }
    for (const s of arr(parse(io.get('sessions')))) {
      if (!s || !s.id) continue;
      const st = sessTime(s);
      if (!full && st < since) continue;
      rows.set(SESS + s.id, { key: SESS + s.id, value: s, updated_at: at(st) });
    }
    const tombs = [];
    for (const [id, ts] of Object.entries(m.tomb)) {
      if (!full && ts < since) continue;
      const cur = rows.get(SESS + id);
      if (cur && cur.value && sessTime(cur.value) >= ts) continue;
      rows.set(SESS + id, { key: SESS + id, value: null, updated_at: at(ts) });
      tombs.push([id, ts]);
    }
    return { rows: [...rows.values()], tombs };
  }
  async function push({ forceAt = 0 } = {}) {
    const id = io.accountId(), m = io.meta(), t0 = now();
    const { rows, tombs } = collectPush({ full: !!(m.full || forceAt), since: m.pushedAt || 0, forceAt });
    for (let i = 0; i < rows.length; i += CHUNK) {
      await authed(id, t => client.rpc(t, 'forge_push', { rows: rows.slice(i, i + CHUNK) }));
      if (io.accountId() !== id) return 0;
    }
    const m2 = io.meta();
    m2.pushedAt = t0; m2.full = false;
    for (const [sid, ts] of tombs) if (m2.tomb[sid] === ts) delete m2.tomb[sid];   // the cloud row is the tombstone now
    io.saveMeta();
    return rows.length;
  }

  // ---------------- sync loop ----------------
  async function sync({ pullFirst = true } = {}) {
    if (!configured) return { ok: false, skipped: 'unconfigured' };
    const a = accounts.active();
    if (!accounts.isLinked(a)) return { ok: false, skipped: 'not linked' };
    if (!a.cloud.session) return { ok: false, skipped: 'signed out' };
    if (!isOnline()) { status(a.id, { lastError: OFFLINE }); return { ok: false, offline: true }; }
    if (inflight) { again = true; return inflight; }
    inflight = (async () => {
      try {
        const pulled = pullFirst ? await pull() : 0;
        const pushed = await push();
        status(a.id, { lastSyncAt: iso(now()), lastError: null });
        return { ok: true, pulled, pushed };
      } catch (e) {
        status(a.id, { lastError: e.message || 'Sync failed' });
        return { ok: false, error: e.message || 'Sync failed' };
      } finally {
        inflight = null;
        if (again) { again = false; schedulePush(); }
      }
    })();
    return inflight;
  }
  function schedulePush() {   // debounced push after local writes
    if (!configured || applying || !accounts.isLinked(accounts.active())) return;
    if (timer) timers.clear(timer);
    timer = timers.set(() => { timer = null; sync({ pullFirst: false }); }, debounceMs);
  }
  function syncIfStale(maxAgeMs = 2 * 60000) {
    const a = accounts.active();
    if (!configured || !accounts.isLinked(a)) return null;
    return now() - ms(a.cloud.lastSyncAt) > maxAgeMs ? sync() : null;
  }
  function start() { if (!unsub) unsub = store.subscribe(schedulePush); }
  function stop() { if (unsub) unsub(); unsub = null; if (timer) timers.clear(timer); timer = null; }

  // ---------------- sign-in ----------------
  // Result: { status: 'linked' | 'choose' | 'exists' | 'switched' | 'confirm' | … }
  async function begin(ns, target, provider) {
    const uid = ns && ns.user && ns.user.id;
    if (!uid) throw new CloudError('Sign-in failed.', 0);
    const rec = { userId: uid, email: ns.user.email || '', provider: provider || 'email', session: ns.session, lastError: null };
    const existing = accounts.list().find(a => a.cloud && a.cloud.userId === uid);
    if (existing) {   // already on this device: refresh its tokens
      accounts.updateCloud(existing.id, rec);
      if (existing.id !== accounts.activeId()) return { status: 'exists', account: accounts.get(existing.id) };
      if (accounts.isLinked(accounts.get(existing.id))) return { status: 'linked', how: 'resume', sync: await sync() };
      return finishSetup();
    }
    if (target === 'new') {   // a new local account for this cloud user; the app reloads and finishSetup() runs on start
      const a = accounts.create({ name: rec.email || 'Cloud account', cloud: { ...rec, initial: true } });
      accounts.switchTo(a.id);
      return { status: 'switched', account: accounts.get(a.id) };
    }
    const a = accounts.active();
    if (a.kind === 'test') throw new CloudError('Test accounts never sync.', 0, 'test');
    if (a.cloud && a.cloud.userId) { accounts.updateCloud(a.id, null); accounts.clearSync(a.id); }   // was another cloud user: start over
    accounts.updateCloud(a.id, rec);   // tokens saved; syncing starts once link() finishes
    return finishSetup();
  }
  async function signIn(email, password, { target = 'active' } = {}) {
    need();
    const ns = normalizeSession(await client.signIn(String(email || '').trim(), String(password || '')), now());
    if (!ns) throw new CloudError('Sign-in failed.', 0);
    return begin(ns, target, 'email');
  }
  async function signUp(email, password, { target = 'active' } = {}) {
    need();
    const d = await client.signUp(String(email || '').trim(), String(password || ''), redirectUrl);
    const ns = normalizeSession(d, now());
    if (!ns) { accounts.pending({ mode: target, accountId: accounts.activeId(), at: now() }); return { status: 'confirm', email: String(email || '').trim() }; }
    return begin(ns, target, 'email');
  }
  async function resetPassword(email, { target = 'active' } = {}) {
    need();
    await client.recover(String(email || '').trim(), redirectUrl);
    accounts.pending({ mode: target, accountId: accounts.activeId(), at: now() });
  }
  function oauthStart(provider, { target = 'active' } = {}) {
    need();
    if (!providers.includes(provider)) throw new CloudError(`${provider} sign-in isn't turned on.`, 0, 'provider');
    accounts.pending({ mode: target, accountId: accounts.activeId(), provider, at: now() });
    return client.authorizeUrl(provider, redirectUrl);
  }
  // After an OAuth / email-link redirect. frag = parseAuthFragment(location.hash).
  async function handleRedirect(frag) {
    if (!frag) return { status: 'none' };
    if (!configured) return { status: 'unconfigured' };
    const pend = accounts.pending();
    accounts.pending(null);
    const fresh = pend && now() - (Number(pend.at) || 0) < 60 * 60000 ? pend : null;
    if (frag.error) return { status: 'error', message: frag.description || frag.error };
    const ns = normalizeSession(frag, now());
    if (!ns) return { status: 'error', message: 'Sign-in failed.' };
    const u = await client.getUser(ns.session.access_token);
    ns.user = { id: (u && u.id) || null, email: (u && u.email) || '' };
    if (!ns.user.id) return { status: 'error', message: 'Sign-in failed.' };
    if (frag.type === 'recovery') return { status: 'recovery', ns, pending: fresh };
    // e.g. a confirmation link opened in a browser that didn't start the sign-up: don't attach it to anything here
    if (!fresh) return { status: 'confirmed', email: ns.user.email };
    return begin(ns, fresh.mode === 'new' ? 'new' : 'active', fresh.provider || 'email');
  }
  async function setNewPassword(rec, password) {
    need();
    await client.updateUser(rec.ns.session.access_token, { password: String(password || '') });
    return rec.pending ? begin(rec.ns, rec.pending.mode === 'new' ? 'new' : 'active', 'email') : { status: 'password' };
  }

  // ---------------- first link ----------------
  const summarize = rows => ({
    workouts: rows.filter(r => r.key.startsWith(SESS) && r.value && r.value.status === 'done').length,
    weighIns: arr((rows.find(r => r.key === 'body') || {}).value).length,
  });
  const summarizeLocal = () => ({ workouts: arr(parse(io.get('sessions'))).filter(s => s && s.status === 'done').length, weighIns: arr(parse(io.get('body'))).length });
  async function finishSetup() {
    need();
    const id = accounts.activeId(), a = accounts.get(id);
    if (!a || !a.cloud || !a.cloud.session) throw new CloudError('Sign in first.', 401, 'signed_out');
    const remote = await fetchRows(id);
    const info = { remote: summarize(remote), local: summarizeLocal(), email: a.cloud.email };
    if (!remote.some(r => r.value != null)) return { ...(await link('upload', remote)), ...info };
    if (!accounts.hasData(id)) return { ...(await link('replace', remote)), ...info };
    pendingRemote = { id, rows: remote };
    return { status: 'choose', ...info };
  }
  // choice: 'merge' (keep both; newer wins; settings from the account) | 'upload' (this device → account)
  //         | 'replace' (account → this device; a safety copy of the device data is kept, see accounts.stash)
  async function link(choice, remote) {
    need();
    if (!['merge', 'upload', 'replace'].includes(choice)) throw new Error('Unknown choice ' + choice);
    const id = accounts.activeId(), a = accounts.get(id);
    if (!a || !a.cloud || !a.cloud.session) throw new CloudError('Sign in first.', 401, 'signed_out');
    if (a.kind === 'test') throw new CloudError('Test accounts never sync.', 0, 'test');
    if (!remote) remote = pendingRemote && pendingRemote.id === id ? pendingRemote.rows : await fetchRows(id);
    pendingRemote = null;
    // Stamp after every remote row, so the choice wins on the server even if another device's clock runs ahead.
    const t = remote.reduce((x, r) => Math.max(x, ms(r.updated_at) + 1), now());
    const m = { keys: {}, tomb: {}, pushedAt: 0, cursor: cursorOf(remote, null), full: false };
    const sessRows = remote.filter(r => r.key.startsWith(SESS));
    const keyRows = remote.filter(r => !r.key.startsWith(SESS) && r.key !== 'sessions' && !LOCAL_ONLY(r.key));
    const local = arr(parse(io.get('sessions')));
    applying = true;
    try {
      if (choice === 'replace') {
        if (io.keys().some(k => !LOCAL_ONLY(k))) accounts.stash(id);
        for (const k of io.keys()) if (!LOCAL_ONLY(k)) io.put(k, null);
        for (const r of keyRows) if (r.value != null) { io.put(r.key, JSON.stringify(r.value)); m.keys[r.key] = ms(r.updated_at); }
        const res = mergeSessionRows([], sessRows);
        if (res.sessions.length) io.putSessions(res.sessions);
        m.pushedAt = t;
      } else if (choice === 'merge') {
        for (const r of keyRows) {
          if (r.value == null) continue;   // deleted in the account: keep this device's copy
          const lv = parse(io.get(r.key));
          io.put(r.key, JSON.stringify(DATED.has(r.key) && Array.isArray(lv) && Array.isArray(r.value) ? mergeDated(lv, r.value) : r.value));
        }
        io.putSessions(mergeSessionRows(local, sessRows).sessions);
        for (const k of io.keys()) if (k !== 'sessions' && !LOCAL_ONLY(k)) m.keys[k] = t;
        m.full = true;
      } else {   // upload: the account ends up exactly like this device
        const have = new Set(local.map(s => s && s.id));
        for (const r of sessRows) { const sid = r.key.slice(SESS.length); if (r.value != null && !have.has(sid)) m.tomb[sid] = t; }
        for (const r of keyRows) if (r.value != null) m.keys[r.key] = t;   // missing here → deleted there
        for (const k of io.keys()) if (k !== 'sessions' && !LOCAL_ONLY(k)) m.keys[k] = t;
        m.full = true;
      }
      io.saveMeta(m);
      accounts.updateCloud(id, { linkedAt: iso(t), initial: false, lastError: null });
    } finally { applying = false; }
    io.changed();
    if (choice !== 'replace') await push({ forceAt: choice === 'upload' ? t : 0 });
    status(id, { lastSyncAt: iso(now()), lastError: null });
    return { status: 'linked', how: choice };
  }

  // ---------------- sign out / delete ----------------
  async function signOut(id = accounts.activeId()) {
    const a = accounts.get(id);
    if (!a || !a.cloud) return;
    if (configured && accounts.isLinked(a) && id === accounts.activeId() && isOnline()) { try { await push(); } catch (e) { /* best effort */ } }
    const tok = a.cloud.session && a.cloud.session.access_token;
    if (configured && tok) { try { await client.signOut(tok); } catch (e) { /* offline or already expired: signed out here anyway */ } }
    if (id === accounts.activeId()) { if (timer) timers.clear(timer); timer = null; }
    accounts.updateCloud(id, null);
    accounts.clearSync(id);
    try { onStatus(); } catch (e) { /* UI hook */ }
  }
  // App Store 5.1.1(v): deletes the signed-in user and all their cloud rows (delete_my_account in schema.sql).
  // The local copy stays until the caller removes it.
  async function deleteCloudAccount(id = accounts.activeId()) {
    need();
    await authed(id, t => client.rpc(t, 'delete_my_account', {}));
    if (id === accounts.activeId()) { if (timer) timers.clear(timer); timer = null; }
    accounts.updateCloud(id, null);
    accounts.clearSync(id);
    try { onStatus(); } catch (e) { /* UI hook */ }
  }

  return {
    configured, providers,
    signIn, signUp, resetPassword, oauthStart, handleRedirect, setNewPassword, finishSetup, link,
    sync, pull, push, schedulePush, syncIfStale, start, stop, signOut, deleteCloudAccount,
    get busy() { return !!inflight; },
  };
}
