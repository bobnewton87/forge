// Persistence layer. The ONLY module that reads/writes localStorage (besides the Iron Runner importer).
// Data is never wiped on version changes. Schema changes go through migrate().
import { DEFAULT_LOCATIONS } from './data/equipment.js';
import { DEFAULT_SCULPT_GOALS } from './data/sculpt.js';

const P = 'fg_';
const SCHEMA = 1;

// In Node (tests) there is no localStorage — fall back to an in-memory map.
const mem = new Map();
const LS = (typeof localStorage !== 'undefined') ? localStorage : {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  key: i => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

function get(k, fallback = null) {
  try { const v = LS.getItem(P + k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function set(k, v) { LS.setItem(P + k, JSON.stringify(v)); notify(); }

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
    body: { ...d.body, ...(p.body || {}) }, schedule: { ...d.schedule, ...(p.schedule || {}) } };
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
    if (i >= 0) all[i] = s; else all.push(s);
    set('sessions', sortSessions(all));
    return s;
  },
  deleteSession(id) {
    set('sessions', get('sessions', []).filter(s => s.id !== id));
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
  // Entry: { d:'YYYY-MM-DD', neck, shoulders, chest, waist, hips, armL, armR, forearm, thigh, calf, bodyFat }
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

  // Planned sessions are ordinary sessions with status 'planned' and a date (possibly future).
  getPlanned({ from, to } = {}) {
    return this.getSessions().filter(s => s.status === 'planned' && (!from || s.date >= from) && (!to || s.date <= to));
  },
  // Replace the planned sessions in [from, to] that match `pred` (default: auto-generated only) with `sessions`.
  replacePlanned(from, to, sessions, pred = s => s.plan && s.plan.auto) {
    const all = get('sessions', []).filter(s => !(s.status === 'planned' && s.date >= from && s.date <= to && pred(s)));
    sessions.forEach(s => { const i = all.findIndex(x => x.id === s.id); if (i >= 0) all[i] = s; else all.push(s); });
    set('sessions', sortSessions(all));
  },

  // Generic small key/value for UI state (e.g. last chosen targets). Namespaced under fg_kv_.
  kv(key, value) { if (value === undefined) return get('kv_' + key); set('kv_' + key, value); },

  exportAll() {
    const out = { app: 'forge', schema: SCHEMA, exportedAt: new Date().toISOString(), data: {} };
    for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k && k.startsWith(P)) out.data[k] = LS.getItem(k); }
    return out;
  },
  importAll(obj, { merge = true } = {}) {
    if (!obj || obj.app !== 'forge' || !obj.data) throw new Error('Not a Forge backup');
    if (!merge) { const ks = []; for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k && k.startsWith(P)) ks.push(k); } ks.forEach(k => LS.removeItem(k)); }
    for (const [k, v] of Object.entries(obj.data)) {
      if (merge && k === P + 'sessions') {
        const incoming = JSON.parse(v); const cur = get('sessions', []);
        const byId = new Map(cur.map(s => [s.id, s])); incoming.forEach(s => byId.set(s.id, s));
        LS.setItem(k, JSON.stringify(sortSessions([...byId.values()])));
      } else LS.setItem(k, v);
    }
    notify();
  },

  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  // Test helper
  _reset() { const ks = []; for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k && k.startsWith(P)) ks.push(k); } ks.forEach(k => LS.removeItem(k)); },
};
