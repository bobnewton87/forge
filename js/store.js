// Persistence layer. The ONLY module that reads/writes localStorage (besides the Iron Runner importer).
// Data is never wiped on version changes. Schema changes go through migrate().
//
// Accounts (CONTRACT §19). Every read/write below is scoped to the ACTIVE account's key prefix:
//   default account → 'fg_'        (the original keys, used as-is: never migrated, copied or rewritten)
//   other accounts  → 'fga_<id>_'  (id is [a-z0-9]+, so no prefix contains another and none starts with 'fg_')
// The registry, the active pointer and per-account sync bookkeeping live under 'fgx_*', outside every
// account's namespace, so exportAll / importAll / _reset never see them.
import { DEFAULT_LOCATIONS } from './data/equipment.js';
import { DEFAULT_SCULPT_GOALS } from './data/sculpt.js';

const SCHEMA = 1;
export const DEFAULT_ACCOUNT = 'default';
const K_ACCOUNTS = 'fgx_accounts', K_ACTIVE = 'fgx_active', K_SYNC = 'fgx_sync_', K_STASH = 'fgx_stash_', K_PENDING = 'fgx_pending';
const ID_RE = /^[a-z0-9]{1,24}$/;
export const prefixOf = id => (id === DEFAULT_ACCOUNT ? 'fg_' : `fga_${id}_`);
// Keys that stay on the device (never synced): the in-progress pointer and UI state.
export const LOCAL_ONLY = k => k === 'active' || k.startsWith('kv_');

// In Node (tests) there is no localStorage — fall back to an in-memory map.
function memStorage() {
  const mem = new Map();
  return {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    key: i => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
}
let LS = (typeof localStorage !== 'undefined') ? localStorage : memStorage();

let ACTIVE = DEFAULT_ACCOUNT;   // active account id (cached; switching reloads the page in the app)
let P = 'fg_';                  // its key prefix
let TRACK = false;              // active account is linked to the cloud → keep sync bookkeeping
let metaCache = null, listCache = null;

function allKeys() { const out = []; for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k) out.push(k); } return out; }
function keysUnder(prefix) { return allKeys().filter(k => k.startsWith(prefix)); }
function readJSON(k, fallback) { try { const v = LS.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }

function get(k, fallback = null) {
  try { const v = LS.getItem(P + k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function set(k, v) { LS.setItem(P + k, JSON.stringify(v)); touchKey(k); notify(); }

// ---- sync bookkeeping (only while the active account is linked to the cloud; see js/cloud/sync.js) ----
// fgx_sync_<id> = { keys: { key: modifiedMs }, tomb: { sessionId: deletedMs }, pushedAt, cursor, full }
const META0 = () => ({ keys: {}, tomb: {}, pushedAt: 0, cursor: null, full: false });
function meta() { if (!metaCache) { const m = readJSON(K_SYNC + ACTIVE, null); metaCache = { ...META0(), ...(m && typeof m === 'object' ? m : {}) }; } return metaCache; }
function saveMeta() { try { LS.setItem(K_SYNC + ACTIVE, JSON.stringify(meta())); } catch (e) { /* quota: bookkeeping only, next full sync repairs it */ } }
// Stamps never go backwards: an edit is always newer than the copy it replaced, even if that copy came from a
// device whose clock runs ahead (otherwise the server would refuse the edit as older).
const msOf = s => { const t = Date.parse((s && (s.updatedAt || s.endedAt || s.startedAt)) || ''); return isNaN(t) ? 0 : t; };
const after = (...ts) => Math.max(Date.now(), ...ts.map(t => t + 1));
function touchKey(k) { if (!TRACK || k === 'sessions' || LOCAL_ONLY(k)) return; const m = meta(); m.keys[k] = after(m.keys[k] || 0); saveMeta(); }
function tombstone(gone) { if (!TRACK || !gone.length) return; const m = meta(); gone.forEach(s => { m.tomb[s.id] = after(msOf(s)); }); saveMeta(); }
function untomb(ids) { if (!TRACK) return; const m = meta(); let ch = false; ids.forEach(id => { if (m.tomb[id]) { delete m.tomb[id]; ch = true; } }); if (ch) saveMeta(); }
// Backup keys are canonical 'fg_*' whatever the account, so a backup restores into any account.
function relKey(k) { if (k.startsWith('fg_')) return k.slice(3) || null; const m = /^fga_[a-z0-9]{1,24}_(.+)$/.exec(k); return m ? m[1] : null; }

const subs = new Set();
function notify() { subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

export function defaultProfile() {
  return {
    schema: SCHEMA,
    name: 'Bob',
    units: 'lb',
    bodyweight: null,
    goal: 'recomp',                 // 'recomp' | 'lean_bulk' | 'cut'
    sculptGoals: [...DEFAULT_SCULPT_GOALS],
    // User-adjustable multipliers on weekly targets (missing = 1). Bob's baseline priorities
    // (triceps, side delts, abs up; legs maintenance) already live in REGIONS[r].priority/weeklySets.
    groupPriority: {},
    locations: DEFAULT_LOCATIONS.map(l => ({ ...l, equipment: [...l.equipment] })),
    currentLocation: 'home',
    defaultMinutes: 45,
    defaultStyle: 'hypertrophy',
    cardioTargetMin: 120,           // weekly cardio minutes target
    avoidExercises: [],             // exercise ids never to program
    favoriteExercises: [],
    nutrition: { mode: 'off', calories: null, protein: null },  // 'off' | 'simple' | 'cycling'
    crunch: { club: 'allen' },
    restTimer: { enabled: true, sound: true },
    // Body profile for body-comp math + projections (see CONTRACT §11).
    body: { sex: 'male', heightIn: null, birthYear: null, trainingMonths: 7, activity: 'desk' },
    // Supplement / therapy stack (CONTRACT §17): [{ id, start:'YYYY-MM-DD', end:null|'YYYY-MM-DD', dose:null|string, active:true }]
    supplements: [],
    // Optional metabolic values (CONTRACT §17). Units: totalT/onTrtT ng/dL, freeT pg/mL, vitD ng/mL, hba1c %, sleepHours h, stress 1-5.
    metabolic: { totalT: null, freeT: null, labDate: null, onTrtT: null, vitD: null, hba1c: null, tsh: null, sleepHours: 7, stress: 3 },
    // Weekly availability template for the planner. kind: 'lift'|'cardio'|'class'|'flex'|'rest'.
    schedule: {
      mon: { kind: 'lift', minutes: 45, location: 'crunch' },
      tue: { kind: 'lift', minutes: 30, location: 'home' },
      wed: { kind: 'cardio', minutes: 30, location: 'home' },
      thu: { kind: 'lift', minutes: 45, location: 'crunch' },
      fri: { kind: 'lift', minutes: 30, location: 'home' },
      sat: { kind: 'flex', minutes: 60, location: 'crunch' },
      sun: { kind: 'rest', minutes: 0, location: 'home' },
    },
  };
}

function migrate(p) {
  const d = defaultProfile();
  if (!p) return d;
  // Shallow-merge so new fields get defaults without clobbering user choices.
  const out = { ...d, ...p, nutrition: { ...d.nutrition, ...(p.nutrition || {}) }, restTimer: { ...d.restTimer, ...(p.restTimer || {}) },
    body: { ...d.body, ...(p.body || {}) }, schedule: { ...d.schedule, ...(p.schedule || {}) },
    metabolic: { ...d.metabolic, ...(p.metabolic || {}) }, supplements: Array.isArray(p.supplements) ? p.supplements : [] };
  out.schema = SCHEMA;
  return out;
}

function sortSessions(arr) {
  return arr.sort((a, b) => a.date.localeCompare(b.date) || String(a.startedAt || '').localeCompare(String(b.startedAt || '')) || a.id.localeCompare(b.id));
}

export const store = {
  getProfile() { return migrate(get('profile')); },
  saveProfile(p) { set('profile', migrate(p)); },
  updateProfile(patch) { const p = this.getProfile(); this.saveProfile({ ...p, ...patch }); return this.getProfile(); },

  getSessions() { return sortSessions(get('sessions', [])); },
  getSession(id) { return get('sessions', []).find(s => s.id === id) || null; },
  saveSession(s) {
    const all = get('sessions', []);
    const i = all.findIndex(x => x.id === s.id);
    s.updatedAt = new Date(after(msOf(s), i >= 0 ? msOf(all[i]) : 0)).toISOString();   // per-session merge clock for cloud sync (CONTRACT §19)
    untomb([s.id]);
    if (i >= 0) all[i] = s; else all.push(s);
    set('sessions', sortSessions(all));
    return s;
  },
  deleteSession(id) {
    const all = get('sessions', []);
    tombstone(all.filter(s => s.id === id));
    set('sessions', all.filter(s => s.id !== id));
    if (get('active') === id) set('active', null);
  },
  newSessionId() { return 's_' + Date.now() + Math.random().toString(36).slice(2, 5); },

  getActiveSession() { const id = get('active'); return id ? this.getSession(id) : null; },
  setActiveSessionId(id) { set('active', id || null); },

  getBodyLog() { return get('body', []); },
  logBodyweight(date, lb) {
    const l = this.getBodyLog().filter(e => e.d !== date);
    l.push({ d: date, w: Number(lb) });
    l.sort((a, b) => a.d.localeCompare(b.d));
    set('body', l);
    const p = this.getProfile(); p.bodyweight = l[l.length - 1].w; set('profile', p);
  },
  deleteBodyweight(date) { set('body', this.getBodyLog().filter(e => e.d !== date)); },

  // Tape measurements (inches) + optional manual body fat. One entry per date; logging merges fields.
  // Entry: { d:'YYYY-MM-DD', neck, shoulders, chest, waist, hips, armL, armR, forearm, thighL, thighR, calfL, calfR, bodyFat }
  // (legacy entries may have single `thigh` / `calf` — treat as both sides)
  getMeasurements() { return get('meas', []); },
  logMeasurement(entry) {
    if (!entry || !entry.d) throw new Error('measurement needs d');
    const l = this.getMeasurements();
    const i = l.findIndex(e => e.d === entry.d);
    const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== '' && v != null && !(typeof v === 'number' && isNaN(v))));
    if (i >= 0) l[i] = { ...l[i], ...clean }; else l.push(clean);
    l.sort((a, b) => a.d.localeCompare(b.d));
    set('meas', l);
  },
  deleteMeasurement(date) { set('meas', this.getMeasurements().filter(e => e.d !== date)); },

  // Optional daily food log for adaptive TDEE. Entry: { d, kcal, protein, carbs, fat } (grams). Merges by date.
  getFoodLog() { return get('food', []); },
  logFood(entry) {
    if (!entry || !entry.d) throw new Error('food entry needs d');
    const l = this.getFoodLog().filter(e => e.d !== entry.d);
    const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== '' && v != null && !(typeof v === 'number' && isNaN(v))));
    l.push(clean); l.sort((a, b) => a.d.localeCompare(b.d)); set('food', l);
  },
  deleteFood(date) { set('food', this.getFoodLog().filter(e => e.d !== date)); },

  // Planned sessions are ordinary sessions with status 'planned' and a date (possibly future).
  getPlanned({ from, to } = {}) {
    return this.getSessions().filter(s => s.status === 'planned' && (!from || s.date >= from) && (!to || s.date <= to));
  },
  // Replace the planned sessions in [from, to] that match `pred` (default: auto-generated only) with `sessions`.
  replacePlanned(from, to, sessions, pred = s => s.plan && s.plan.auto) {
    const before = get('sessions', []);
    const all = before.filter(s => !(s.status === 'planned' && s.date >= from && s.date <= to && pred(s)));
    const prev = new Map(before.map(s => [s.id, s]));
    sessions.forEach(s => {
      s.updatedAt = new Date(after(prev.has(s.id) ? msOf(prev.get(s.id)) : 0)).toISOString();
      const i = all.findIndex(x => x.id === s.id); if (i >= 0) all[i] = s; else all.push(s);
    });
    if (TRACK) { const keep = new Set(all.map(s => s.id)); tombstone(before.filter(s => !keep.has(s.id))); untomb(sessions.map(s => s.id)); }
    set('sessions', sortSessions(all));
  },

  // Generic small key/value for UI state (e.g. last chosen targets). Namespaced under <prefix>kv_.
  kv(key, value) { if (value === undefined) return get('kv_' + key); set('kv_' + key, value); },

  // Backup of the ACTIVE account only. Keys are written as canonical 'fg_*' names (unchanged for the default account).
  exportAll() {
    const out = { app: 'forge', schema: SCHEMA, exportedAt: new Date().toISOString(), data: {} };
    for (const k of keysUnder(P)) out.data['fg_' + k.slice(P.length)] = LS.getItem(k);
    return out;
  },
  // Restores into the ACTIVE account. Accepts 'fg_*' (and 'fga_<id>_*') keys; anything else is ignored,
  // so a backup can never write into another account's namespace.
  importAll(obj, { merge = true } = {}) {
    if (!obj || obj.app !== 'forge' || !obj.data) throw new Error('Not a Forge backup');
    const entries = Object.entries(obj.data).map(([k, v]) => [relKey(k), v]).filter(([k, v]) => k && typeof v === 'string');
    const oldKeys = keysUnder(P).map(k => k.slice(P.length)), oldSessions = TRACK ? get('sessions', []) : [];
    if (!merge) keysUnder(P).forEach(k => LS.removeItem(k));
    for (const [k, v] of entries) {
      if (merge && k === 'sessions') {
        const incoming = JSON.parse(v); const cur = get('sessions', []);
        const byId = new Map(cur.map(s => [s.id, s])); incoming.forEach(s => byId.set(s.id, s));
        LS.setItem(P + k, JSON.stringify(sortSessions([...byId.values()])));
      } else LS.setItem(P + k, v);
    }
    if (TRACK) {   // a restore is pushed in full; with merge:false, whatever it dropped is deleted in the cloud too
      const m = meta(), now = new Set(entries.map(([k]) => k));
      for (const k of merge ? now : new Set([...now, ...oldKeys])) if (k !== 'sessions' && !LOCAL_ONLY(k)) m.keys[k] = after(m.keys[k] || 0);
      if (!merge) { const ids = new Set(get('sessions', []).map(s => s.id)); oldSessions.filter(s => !ids.has(s.id)).forEach(s => { m.tomb[s.id] = after(msOf(s)); }); }
      m.full = true; saveMeta();
    }
    notify();
  },

  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  // Test helper: clears the ACTIVE account only.
  _reset() { keysUnder(P).forEach(k => LS.removeItem(k)); },

  // Raw access for the cloud sync engine (js/cloud/sync.js), scoped to the active account. No bookkeeping, no notify.
  syncIO: {
    accountId: () => ACTIVE,
    keys: () => keysUnder(P).map(k => k.slice(P.length)),
    get: k => LS.getItem(P + k),
    put(k, raw) { if (raw == null) LS.removeItem(P + k); else LS.setItem(P + k, raw); },
    putSessions(arr) { LS.setItem(P + 'sessions', JSON.stringify(sortSessions(arr))); },
    meta: () => meta(),              // live object; call saveMeta() after changing it
    saveMeta(m) { if (m) metaCache = { ...META0(), ...m }; saveMeta(); },
    changed: () => notify(),         // one notify after applying a batch of remote rows
  },
};

// ---------------- Accounts (CONTRACT §19) ----------------
// Record: { id, name, kind:'local'|'test', createdAt, persona?, recovered?,
//           cloud?: { userId, email, provider, session:{access_token, refresh_token, expires_at}, linkedAt, initial, lastSyncAt, lastError } }
// A record with cloud.userId + cloud.linkedAt is a cloud account. Test accounts never get a cloud link.
const cleanName = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
const linked = a => !!(a && a.kind !== 'test' && a.cloud && a.cloud.userId && a.cloud.linkedAt);
function regRead() {
  const v = readJSON(K_ACCOUNTS, null);
  return Array.isArray(v) ? v.filter(a => a && typeof a === 'object' && (a.id === DEFAULT_ACCOUNT || ID_RE.test(String(a.id)))) : null;
}
function regWrite(list) { LS.setItem(K_ACCOUNTS, JSON.stringify(list)); listCache = null; }
function defaultName() { const p = readJSON('fg_profile', null); return cleanName(p && p.name) || 'Me'; }
const clone = o => JSON.parse(JSON.stringify(o));

function loadActive() {
  listCache = null; metaCache = null;
  try {
    let id = LS.getItem(K_ACTIVE);
    const list = accounts.list();
    if (!id || !list.some(a => a.id === id)) id = list.some(a => a.id === DEFAULT_ACCOUNT) ? DEFAULT_ACCOUNT : list[0].id;
    ACTIVE = id; P = prefixOf(id); TRACK = linked(list.find(a => a.id === id));
  } catch (e) { ACTIVE = DEFAULT_ACCOUNT; P = 'fg_'; TRACK = false; }   // storage blocked: behave exactly as before accounts
}

export const accounts = {
  // Never hides data: the default account is listed while any 'fg_' key exists (or when nothing else does),
  // and 'fga_<id>_' keys with no registry record come back as "Recovered account".
  list() {
    if (listCache) return clone(listCache);
    const reg = regRead() || [];
    const out = [], seen = new Set();
    for (const a of reg) if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
    const keys = allKeys();
    if (!seen.has(DEFAULT_ACCOUNT) && (!out.length || keys.some(k => k.startsWith('fg_')))) { seen.add(DEFAULT_ACCOUNT); out.unshift({ id: DEFAULT_ACCOUNT, name: defaultName(), kind: 'local', createdAt: null }); }
    for (const k of keys) {
      const m = /^fga_([a-z0-9]{1,24})_/.exec(k);
      if (m && !seen.has(m[1])) { seen.add(m[1]); out.push({ id: m[1], name: 'Recovered account', kind: 'local', createdAt: null, recovered: true }); }
    }
    listCache = out;
    return clone(out);
  },
  get(id) { return this.list().find(a => a.id === id) || null; },
  activeId: () => ACTIVE,
  active() { return this.get(ACTIVE) || { id: ACTIVE, name: defaultName(), kind: 'local', createdAt: null }; },
  kind: a => (a && a.kind === 'test' ? 'test' : linked(a) ? 'cloud' : 'local'),
  isLinked: a => linked(a),

  // New account. Does NOT switch to it. seed = { profile: patch, body, meas, food } for blank/persona accounts;
  // copyFrom = account id to deep-copy every key from.
  create({ name, kind = 'local', copyFrom = null, seed = null, persona = null, cloud = null } = {}) {
    const list = this.list();
    let id;
    do { id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).replace(/[^a-z0-9]/g, '').slice(0, 16); }
    while (id === DEFAULT_ACCOUNT || list.some(a => a.id === id) || keysUnder(prefixOf(id)).length);
    const p = prefixOf(id);
    const acct = { id, name: cleanName(name) || 'New account', kind: kind === 'test' ? 'test' : 'local', createdAt: new Date().toISOString() };
    if (persona) acct.persona = persona;
    if (cloud && acct.kind !== 'test') acct.cloud = cloud;
    try {
      if (copyFrom != null) {
        if (!list.some(a => a.id === copyFrom)) throw new Error('No such account');
        const src = prefixOf(copyFrom);
        for (const k of keysUnder(src)) LS.setItem(p + k.slice(src.length), LS.getItem(k));
      } else {
        const sd = seed || {};
        LS.setItem(p + 'profile', JSON.stringify(migrate({ ...defaultProfile(), ...(sd.profile || {}), name: cleanName(sd.profile && sd.profile.name) || acct.name })));
        for (const k of ['body', 'meas', 'food']) if (Array.isArray(sd[k]) && sd[k].length) LS.setItem(p + k, JSON.stringify(sd[k]));
      }
      regWrite([...list, acct]);
    } catch (e) {   // e.g. storage full: leave nothing half-made behind
      keysUnder(p).forEach(k => LS.removeItem(k)); listCache = null;
      throw e;
    }
    return clone(acct);
  },
  rename(id, name) { const nm = cleanName(name); if (!nm) throw new Error('Name needed'); this._edit(id, a => ({ ...a, name: nm })); },
  // Merge `patch` into the record's cloud field; null removes the cloud link (the data stays).
  updateCloud(id, patch) {
    this._edit(id, a => {
      if (patch === null) { const { cloud, ...rest } = a; return { ...rest, kind: rest.kind === 'test' ? 'test' : 'local' }; }
      if (a.kind === 'test') throw new Error('Test accounts never sync');
      return { ...a, cloud: { ...(a.cloud || {}), ...patch } };
    });
  },
  _edit(id, fn) {
    const list = this.list(); const i = list.findIndex(a => a.id === id);
    if (i < 0) throw new Error('No such account');
    list[i] = fn(list[i]); regWrite(list);
    if (id === ACTIVE) { const was = TRACK; TRACK = linked(list[i]); if (was !== TRACK) metaCache = null; }
  },
  // Deletes the account and only its keys. The last account can't be deleted. If it was active, the
  // first remaining account becomes active (the app reloads after this).
  remove(id) {
    const list = this.list();
    if (!list.some(a => a.id === id)) return false;
    if (list.length <= 1) throw new Error("Can't delete the only account");
    const rest = list.filter(a => a.id !== id);
    regWrite(rest);
    keysUnder(prefixOf(id)).forEach(k => LS.removeItem(k));
    [K_SYNC, K_STASH].forEach(k => LS.removeItem(k + id));
    if (ACTIVE === id) { LS.setItem(K_ACTIVE, rest[0].id); loadActive(); }
    else listCache = null;
    return true;
  },
  // Removes an account's data but keeps the account (used when the last account signs out and drops its data).
  clearData(id) {
    keysUnder(prefixOf(id)).forEach(k => LS.removeItem(k));
    LS.removeItem(K_SYNC + id);
    if (id === ACTIVE) { metaCache = null; notify(); }
  },
  clearSync(id) { LS.removeItem(K_SYNC + id); if (id === ACTIVE) metaCache = null; },
  switchTo(id) {
    if (!this.get(id)) throw new Error('No such account');
    LS.setItem(K_ACTIVE, id); loadActive();
  },
  // Rough "has this account got anything worth keeping" check (workouts, weigh-ins, measurements, food).
  hasData(id = ACTIVE) {
    const p = prefixOf(id);
    const arr = k => { const v = readJSON(p + k, []); return Array.isArray(v) ? v : []; };
    return arr('sessions').some(s => s && (s.status !== 'planned' || (s.plan && s.plan.auto === false))) || ['body', 'meas', 'food'].some(k => arr(k).length > 0);
  },
  // Pending cloud sign-in intent across an OAuth / email-link redirect.
  pending(v) { if (v === undefined) return readJSON(K_PENDING, null); if (v === null) LS.removeItem(K_PENDING); else LS.setItem(K_PENDING, JSON.stringify(v)); },
  // Backup object (same format as store.exportAll) for any account, active or not.
  exportOf(id) {
    const p = prefixOf(id), data = {};
    for (const k of keysUnder(p)) data['fg_' + k.slice(p.length)] = LS.getItem(k);
    return { app: 'forge', schema: SCHEMA, exportedAt: new Date().toISOString(), data };
  },
  // One safety copy of an account's data, taken before "Replace this device's data". Returns false if storage is full.
  stash(id) { try { LS.setItem(K_STASH + id, JSON.stringify(this.exportOf(id))); return true; } catch (e) { return false; } },
  stashed(id) { return readJSON(K_STASH + id, null); },
  dropStash(id) { LS.removeItem(K_STASH + id); },
};

// Test hook: swap the storage backend (node tests use their own Map-backed storage) and re-read the active account.
export function _useStorage(ls) { LS = ls || memStorage(); loadActive(); }

loadActive();
