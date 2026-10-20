// Targets resolver (INTEGRATOR, CONTRACT §18). Pure, DOM-free: the ONE place that turns the
// profile into the user's targets, with defaults, and the ONE place that validates a change.
//
// CONTRACT-NOTE: profile fields read/written here (store.migrate keeps unknown keys):
//   cardioTargetMin (number, min/week)          ← targets.cardio.minPerWeek
//   cardio = { modalities:[ids], hardPerWeek }  ← targets.cardio.modalities / hardSessionsPerWeek
//   defaultMinutes, defaultStyle, schedule, groupPriority ← targets.training.*
//   nutrition = { mode, calories, surplus, proteinGPerLb, fatPct, phases:[…] } ← targets.nutrition
//   adherence (0.5–1, default 0.85)             ← targets.adherence (was projection-only kv state)
//   goal, sculptGoals, body.goalBodyFat         ← targets.goals (body.goalBodyFat is what the projection already reads)
// CONTRACT-NOTE: extra exports: LIMITS, CARDIO_CHIPS, cardioPrefs(profile), finisherCap(minutes),
//   cardioCapacity(profile), cardioWeek(profile, sessions, { now }), suggestFinisher(...),
//   describeChange(before, after), needsReplan(before, after), weekCardioCapacity(profile, sessions, { now, weekStart }),
//   makeRoomProposal(profile, target) (availability changes so the week can hold the cardio target). resolveTargets also returns
//   `capacity` ({ cardio, total, finishers, cardioDays, flex }) and `warnings`.
// CONTRACT-NOTE: nutrition.phases entries: { label, start:'YYYY-MM-DD', end:'YYYY-MM-DD'|null,
//   surplus:number|null, calories:number|null } sorted by start (max 12). Consumers may ignore them.
import { CARDIO, cardioOptions } from '../data/cardio.js';
import { DEFAULT_LOCATIONS, expandEquipment } from '../data/equipment.js';
import { sessionVolume } from './recovery.js';
import { ds, parseDs, addDays, weekStart } from '../util.js';

export const LIMITS = {
  cardioMin: [0, 900], cardioStep: 15, hardPerWeek: [0, 4], defaultMinutes: [10, 180],
  calories: [1200, 6000], surplus: [-1500, 1500], proteinGPerLb: [0.6, 1.4], fatPct: [15, 40],
  adherence: [0.5, 1], goalBodyFatPct: [5, 30],
};
export const CARDIO_CHIPS = [90, 150, 225, 300];
export const STYLES = ['hypertrophy', 'pump', 'strength', 'circuit'];
export const GOALS = ['recomp', 'lean_bulk', 'cut'];
export const MODES = ['off', 'simple', 'cycling'];
const DEF = { cardioMin: 120, hardPerWeek: 1, adherence: 0.85, defaultMinutes: 45, style: 'hypertrophy', proteinGPerLb: 1.0, fatPct: 25, goalBodyFatPct: 12, goal: 'recomp' };
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FINISHER_MODS = ['bike', 'walk_incline', 'elliptical', 'row', 'treadmill', 'run', 'walk', 'spin', 'stairmaster'];

const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
const fin = v => Number.isFinite(num(v));
const clamp = (x, [lo, hi]) => Math.min(hi, Math.max(lo, x));
const round5 = x => Math.round(x / 5) * 5;
const isDs = s => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s);
const toDate = d => (d instanceof Date ? d : isDs(d) ? parseDs(d) : d ? new Date(d) : new Date());

// ---------------------------------------------------------------- cardio
const prefCache = new WeakMap();
// Light, cached cardio view for hot paths (planner): { minPerWeek, modalities, hardSessionsPerWeek, source }.
export function cardioPrefs(profile) {
  if (!profile || typeof profile !== 'object') return { minPerWeek: DEF.cardioMin, modalities: [], hardSessionsPerWeek: DEF.hardPerWeek, source: 'default' };
  const hit = prefCache.get(profile);
  if (hit && hit.k === profile.cardioTargetMin && hit.c === profile.cardio) return hit.v;
  const has = fin(profile.cardioTargetMin);
  const c = profile.cardio && typeof profile.cardio === 'object' ? profile.cardio : {};
  const v = {
    minPerWeek: has ? clamp(Math.round(num(profile.cardioTargetMin)), LIMITS.cardioMin) : DEF.cardioMin,
    modalities: Array.isArray(c.modalities) ? c.modalities.filter(m => CARDIO[m]) : [],
    hardSessionsPerWeek: fin(c.hardPerWeek) ? clamp(Math.round(num(c.hardPerWeek)), LIMITS.hardPerWeek) : DEF.hardPerWeek,
    source: has ? 'profile' : 'default',
  };
  prefCache.set(profile, { k: profile.cardioTargetMin, c: profile.cardio, v });
  return v;
}

// Longest easy cardio finisher a lift session of `minutes` can carry and still leave a real lift.
export function finisherCap(minutes) {
  const m = Number(minutes) || 0;
  return m >= 75 ? 30 : m >= 60 ? 20 : m >= 45 ? 15 : m >= 30 ? 10 : 0;
}

function locFor(profile, id) {
  const locs = profile?.locations?.length ? profile.locations : DEFAULT_LOCATIONS;
  return locs.find(l => l.id === id) || DEFAULT_LOCATIONS.find(l => l.id === id) || locs[0] || DEFAULT_LOCATIONS[0];
}
function canFinish(profile, locId) {
  const opts = new Set(cardioOptions(expandEquipment(locFor(profile, locId).equipment || [])).map(c => c.id));
  return FINISHER_MODS.some(m => opts.has(m));
}
function normSchedule(schedule) {
  const out = {};
  for (const k of DAYS) {
    const s = schedule?.[k];
    out[k] = s && s.kind ? { kind: s.kind, minutes: Math.max(0, Number(s.minutes) || 0), location: s.location || 'home' } : { kind: 'rest', minutes: 0, location: 'home' };
  }
  return out;
}

const classCap = minutes => round5(minutes * 0.6);

// Most cardio a normal week (the availability template) can hold without dropping lift days:
// cardio days in full, flex days in full, ~half a class slot, and an easy finisher on lift days.
export function cardioCapacity(profile, schedule = profile?.schedule) {
  const sch = normSchedule(schedule);
  const byDay = {};
  let cardioDays = 0, flex = 0, finishers = 0, classes = 0, total = 0;
  for (const k of DAYS) {
    const d = sch[k]; let c = 0;
    if (d.kind !== 'rest' && d.minutes >= 10) {
      total += d.minutes;
      if (d.kind === 'cardio') { c = d.minutes; cardioDays += c; }
      // A flex day at a class location usually becomes a Crunch class (~60% cardio incl. the easy
      // add-on), the same estimate as a class slot; elsewhere the planner can make it all cardio.
      else if (d.kind === 'flex') { c = locFor(profile, d.location).hasClasses ? classCap(d.minutes) : d.minutes; flex += c; }
      else if (d.kind === 'class') { c = classCap(d.minutes); classes += c; }
      else if (d.kind === 'lift' && canFinish(profile, d.location)) { c = finisherCap(d.minutes); finishers += c; }
    }
    byDay[k] = c;
  }
  return { cardio: cardioDays + flex + finishers + classes, total, cardioDays, flex, finishers, classes, byDay };
}

// Cardio this specific week can hold: done days count what was done, planned days what their
// session can carry (a class day = the class's classify.cardioMinutes + its add-on, a lift day =
// its finisher cap, a cardio day = its minutes), unplanned days their availability slot.
export function weekCardioCapacity(profile, sessions = [], { now = new Date(), weekStart: wsIn } = {}) {
  now = toDate(now);
  const today = ds(now);
  const ws = weekStart(wsIn ? toDate(wsIn) : now);
  const byDay = cardioCapacity(profile).byDay;
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const date = ds(addDays(ws, i));
    const day = (sessions || []).filter(s => s && s.date === date);
    const done = day.filter(s => s.status !== 'planned');
    let doneMin = 0;
    for (const s of done) { try { doneMin += sessionVolume(s).cardioMin || 0; } catch (e) { /* ignore */ } }
    if (date < today) { total += doneMin; continue; }
    const plan = day.find(s => s.status === 'planned' && s.plan?.kind !== 'rest' && (s.blocks || []).length);
    const forcedRest = day.some(s => s.status === 'planned' && (s.plan?.kind === 'rest' || !(s.blocks || []).length));
    if (done.some(s => (s.blocks || []).length) && !plan) { total += doneMin; continue; }
    if (plan) {
      const cm = plannedCardioMin(plan);
      const kind = plan.plan?.kind || ((plan.blocks || []).some(b => b.kind === 'lift') ? 'lift' : (plan.blocks || []).some(b => b.kind === 'class') ? 'class' : 'cardio');
      total += doneMin + (kind === 'lift' ? Math.max(cm, finisherCap(plan.minutes)) : kind === 'cardio' ? Math.max(cm, Number(plan.minutes) || 0) : cm);
      continue;
    }
    total += forcedRest ? doneMin : doneMin + (byDay[DOW[parseDs(date).getDay()]] || 0);
  }
  return Math.round(total);
}

function plannedCardioMin(s) {
  return (s.blocks || []).reduce((n, b) => n + (b.kind === 'cardio' ? Number(b.minutes) || 0 : b.kind === 'class' ? Number(b.classify?.cardioMinutes) || 0 : 0), 0);
}

// This calendar week (Mon–Sun): cardio done, still planned (today onward), target and what's left.
export function cardioWeek(profile, sessions = [], { now = new Date() } = {}) {
  now = toDate(now);
  const today = ds(now), ws = ds(weekStart(now)), we = ds(addDays(weekStart(now), 6));
  const target = cardioPrefs(profile).minPerWeek;
  let done = 0, planned = 0, plannedToday = 0, doneToday = 0;
  for (const s of sessions || []) {
    if (!s || !s.date || s.date < ws || s.date > we) continue;
    if (s.status === 'planned') {
      if (s.date < today || s.plan?.kind === 'rest') continue;
      const m = plannedCardioMin(s); planned += m; if (s.date === today) plannedToday += m;
    } else {
      let m = 0; try { m = sessionVolume(s).cardioMin || 0; } catch (e) { m = 0; }
      done += m; if (s.date === today) doneToday += m;
    }
  }
  done = Math.round(done); planned = Math.round(planned);
  const daysLeft = Math.round((parseDs(we) - parseDs(today)) / 864e5) + 1;   // incl. today
  const cap = { cardio: weekCardioCapacity(profile, sessions, { now }) };
  const remaining = Math.max(0, target - done - planned);
  return { ws, we, target, done, planned, plannedToday, doneToday, total: done + planned, remaining, daysLeft,
    capacity: cap.cardio, shortfall: Math.max(0, target - cap.cardio), pct: target ? Math.min(1, (done + planned) / target) : 1 };
}

// A finisher for a session built today, sized to what this week still lacks after the planned
// days AFTER today (today's own plan is what's being replaced). null when the target is covered.
export function suggestFinisher(profile, sessions = [], { now = new Date(), minutes = 45 } = {}) {
  const w = cardioWeek(profile, sessions, { now });
  if (!w.target) return null;
  const lacking = w.target - w.done - (w.planned - w.plannedToday);
  if (lacking < 5) return null;
  const cap = Math.max(10, finisherCap(minutes) || (Number(minutes) >= 25 ? 10 : 0));
  if (!cap) return null;
  // Spread what's missing over the days left, but never less than 10 or more than the cap.
  const share = w.daysLeft > 1 ? Math.max(lacking / Math.max(1, Math.ceil(w.daysLeft / 2)), 10) : lacking;
  const m = Math.min(cap, Math.max(10, round5(Math.min(lacking, share))));
  return { minutes: m, lacking: Math.round(lacking), week: w,
    text: `Cardio ${w.done}${w.planned - w.plannedToday ? ` + ${w.planned - w.plannedToday} planned` : ''}/${w.target} min this week: a ${m}′ easy finisher today keeps you on track` };
}

// ---------------------------------------------------------------- make room
const CHIPS = [15, 20, 30, 45, 60, 75, 90];
const DAY_NAME = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const nextChip = m => CHIPS.find(c => c > m) ?? null;
// Concrete availability changes that let the week hold `target` cardio minutes, least disruptive
// first: lengthen cardio days (≤60′ weekdays, ≤90′ weekends), flex → cardio, lengthen again, a
// short easy cardio on a rest day (≤20′ if it's the only rest day, so it stays active recovery),
// then +1 step on lift days (bigger finishers). → { target, before, after, enough, changes:[{ day,
// from, to, gain, label }], schedule } (schedule = the full new availability; unchanged days kept).
export function makeRoomProposal(profile, target = cardioPrefs(profile).minPerWeek) {
  const sch = normSchedule(profile?.schedule);
  const capOf = sc => cardioCapacity(profile, sc).cardio;
  const before = capOf(sch);
  const tol = Math.max(10, target * 0.1);
  const changes = [];
  const cur = JSON.parse(JSON.stringify(sch));
  const orig = JSON.parse(JSON.stringify(sch));
  let cap = before;
  const tryMove = (day, slot, label) => {
    const next = { ...cur, [day]: slot };
    const c = capOf(next);
    if (c <= cap) return false;
    changes.push({ day, from: orig[day], to: slot, gain: c - cap, label });
    cur[day] = slot; cap = c; return true;
  };
  const weekend = d => d === 'sat' || d === 'sun';
  const extendCardio = () => {
    let moved = true;
    while (moved && target - cap > tol) {
      moved = false;
      for (const d of DAYS) {
        if (target - cap <= tol) break;
        const x = cur[d]; if (x.kind !== 'cardio') continue;
        const n = nextChip(x.minutes); if (!n || n > (weekend(d) ? 90 : 60)) continue;
        if (tryMove(d, { ...x, minutes: n }, '')) moved = true;
      }
    }
  };
  extendCardio();
  for (const d of DAYS) { if (target - cap <= tol) break; const x = cur[d]; if (x.kind === 'flex' && x.minutes >= 20) tryMove(d, { ...x, kind: 'cardio' }, ''); }
  extendCardio();
  const rests = DAYS.filter(d => cur[d].kind === 'rest');
  for (const d of [...rests].reverse()) {
    if (target - cap <= tol) break;
    const m = rests.length <= 1 ? 20 : Math.min(45, Math.max(20, round5(target - cap)));
    tryMove(d, { kind: 'cardio', minutes: CHIPS.find(c => c >= m) || m, location: cur[d].location || 'home' }, '');
  }
  for (const d of DAYS) {
    if (target - cap <= tol) break;
    const x = cur[d]; if (x.kind !== 'lift') continue;
    const n = nextChip(x.minutes); if (!n || n > 75) continue;
    tryMove(d, { ...x, minutes: n }, '');
  }
  // Merge repeated moves on the same day into one from→to line.
  const merged = [];
  for (const c of changes) {
    const m = merged.find(x => x.day === c.day);
    if (m) { m.to = c.to; m.gain += c.gain; } else merged.push({ ...c });
  }
  for (const c of merged) {
    const f = c.from, t = c.to, D = DAY_NAME[c.day];
    c.label = f.kind === t.kind ? `${D} ${t.kind} ${f.minutes}→${t.minutes}′${t.kind === 'lift' ? ' (longer easy finisher)' : ''}`
      : f.kind === 'rest' ? `${D}: add ${t.minutes}′ easy cardio (walk / bike / easy run)`
        : `${D} ${f.kind} → cardio ${t.minutes}′`;
  }
  return { target, before, after: cap, enough: target - cap <= tol, short: Math.max(0, target - cap), changes: merged, schedule: cur };
}

// ---------------------------------------------------------------- resolveTargets
function activeStack(profile, today) {
  return (Array.isArray(profile?.supplements) ? profile.supplements : [])
    .filter(x => x && x.id && x.active !== false && (!x.start || x.start <= today) && (!x.end || x.end >= today)).map(x => x.id);
}
function nutritionOf(profile) {
  const n = profile?.nutrition || {}, bw = Number(profile?.bodyweight) || 0;
  const pg = fin(n.proteinGPerLb) && num(n.proteinGPerLb) > 0 ? num(n.proteinGPerLb) : fin(n.protein) && num(n.protein) > 0 && bw ? Math.round(num(n.protein) / bw * 20) / 20 : DEF.proteinGPerLb;
  return {
    mode: MODES.includes(n.mode) ? n.mode : 'off',
    calories: fin(n.calories) && num(n.calories) > 0 ? Math.round(num(n.calories)) : null,
    surplus: fin(n.surplus) ? Math.round(num(n.surplus)) : null,
    proteinGPerLb: Math.round(clamp(pg, LIMITS.proteinGPerLb) * 100) / 100,
    fatPct: Math.round(clamp(fin(n.fatPct) && num(n.fatPct) > 0 ? num(n.fatPct) : DEF.fatPct, LIMITS.fatPct)),
    phases: Array.isArray(n.phases) ? n.phases.filter(p => p && isDs(p.start)) : [],
  };
}

export function resolveTargets(profile = {}, { now = new Date(), sessions } = {}) {
  profile = profile || {};
  now = toDate(now);
  const today = ds(now);
  const cardio = cardioPrefs(profile);
  const schedule = normSchedule(profile.schedule);
  const cap = cardioCapacity(profile, schedule);
  const train = DAYS.filter(k => schedule[k].kind !== 'rest' && schedule[k].minutes >= 10);
  // Lift time left once the cardio target is placed (cardio days first, then flex, then finishers).
  const liftish = train.filter(k => schedule[k].kind === 'lift' || schedule[k].kind === 'flex').reduce((n, k) => n + schedule[k].minutes, 0);
  const cardioOnLiftish = Math.max(0, Math.min(cardio.minPerWeek, cap.cardio) - cap.cardioDays - cap.classes);
  const stack = activeStack(profile, today);
  const goalBf = num(profile.body?.goalBodyFat ?? profile.goalBodyFatPct);
  const out = {
    cardio,
    training: {
      schedule, daysPerWeek: train.length, totalMinPerWeek: cap.total,
      liftMinPerWeek: Math.max(0, liftish - cardioOnLiftish),
      style: STYLES.includes(profile.defaultStyle) ? profile.defaultStyle : DEF.style,
      defaultMinutes: fin(profile.defaultMinutes) ? clamp(Math.round(num(profile.defaultMinutes)), LIMITS.defaultMinutes) : DEF.defaultMinutes,
      groupPriority: { ...(profile.groupPriority || {}) },
    },
    nutrition: nutritionOf(profile),
    adherence: fin(profile.adherence) ? clamp(num(profile.adherence), LIMITS.adherence) : DEF.adherence,
    stack: { active: stack, count: stack.length },
    goals: {
      goal: GOALS.includes(profile.goal) ? profile.goal : DEF.goal,
      sculptGoals: Array.isArray(profile.sculptGoals) ? [...profile.sculptGoals] : [],
      goalBodyFatPct: Number.isFinite(goalBf) && goalBf > 0 ? clamp(goalBf, LIMITS.goalBodyFatPct) : DEF.goalBodyFatPct,
    },
    capacity: { cardio: cap.cardio, total: cap.total, finishers: cap.finishers, cardioDays: cap.cardioDays, flex: cap.flex, classes: cap.classes },
    warnings: [],
  };
  if (cardio.minPerWeek > cap.cardio + 5) {
    out.warnings.push(`Your weekly availability fits about ${cap.cardio} cardio min alongside lifting, ${cardio.minPerWeek - cap.cardio} short of ${cardio.minPerWeek}. Add a cardio day or more minutes in Availability.`);
  }
  if (sessions) out.cardio = { ...cardio, week: cardioWeek(profile, sessions, { now }) };
  return out;
}

// ---------------------------------------------------------------- applyTargetChange
function vNum(v, lim, { round = 0, step = 0 } = {}) {
  if (!fin(v)) return undefined;
  let x = clamp(num(v), lim);
  if (step) x = Math.round(x / step) * step;
  else x = round ? Math.round(x * 10 ** round) / 10 ** round : Math.round(x);
  return clamp(x, lim);
}
function cleanPhases(list) {
  if (!Array.isArray(list)) return undefined;
  return list.filter(p => p && isDs(p.start)).slice(0, 12).map(p => ({
    label: String(p.label || '').slice(0, 40),
    start: p.start, end: isDs(p.end) && p.end > p.start ? p.end : null,
    surplus: fin(p.surplus) ? vNum(p.surplus, LIMITS.surplus) : null,
    calories: fin(p.calories) ? vNum(p.calories, LIMITS.calories) : null,
  })).sort((a, b) => a.start.localeCompare(b.start));
}

// Pure: merge a target patch into a copy of the profile, validating and clamping every value.
// Patch areas mirror resolveTargets: { cardio:{minPerWeek, modalities, hardSessionsPerWeek},
// training:{defaultMinutes, style, schedule, groupPriority}, nutrition:{…}, adherence, goals:{goal, sculptGoals, goalBodyFatPct} }.
// Invalid values (NaN, unknown ids) are ignored; out-of-range numbers are clamped.
export function applyTargetChange(profile, patch = {}) {
  const p = JSON.parse(JSON.stringify(profile || {}));
  patch = patch || {};
  const c = patch.cardio || {};
  if ('minPerWeek' in c) { const v = vNum(c.minPerWeek, LIMITS.cardioMin, { step: 5 }); if (v !== undefined) p.cardioTargetMin = v; }
  if ('modalities' in c || 'hardSessionsPerWeek' in c) {
    const cur = p.cardio && typeof p.cardio === 'object' ? { ...p.cardio } : {};
    if (Array.isArray(c.modalities)) cur.modalities = [...new Set(c.modalities.filter(m => CARDIO[m]))];
    if ('hardSessionsPerWeek' in c) { const v = vNum(c.hardSessionsPerWeek, LIMITS.hardPerWeek); if (v !== undefined) cur.hardPerWeek = v; }
    p.cardio = cur;
  }
  const t = patch.training || {};
  if ('defaultMinutes' in t) { const v = vNum(t.defaultMinutes, LIMITS.defaultMinutes); if (v !== undefined) p.defaultMinutes = v; }
  if ('style' in t && STYLES.includes(t.style)) p.defaultStyle = t.style;
  if (t.schedule && typeof t.schedule === 'object') {
    const kinds = ['lift', 'cardio', 'class', 'flex', 'rest'];
    const sch = { ...(p.schedule || {}) };
    for (const k of DAYS) {
      const d = t.schedule[k]; if (!d || typeof d !== 'object') continue;
      const kind = kinds.includes(d.kind) ? d.kind : (sch[k]?.kind || 'rest');
      sch[k] = { kind, minutes: kind === 'rest' ? 0 : (vNum(d.minutes, [0, 240]) ?? sch[k]?.minutes ?? 45), location: d.location || sch[k]?.location || 'home' };
    }
    p.schedule = sch;
  }
  if (t.groupPriority && typeof t.groupPriority === 'object') {
    const gp = {};
    for (const [g, v] of Object.entries(t.groupPriority)) { const x = vNum(v, [0.5, 1.5], { round: 2 }); if (x !== undefined) gp[g] = x; }
    p.groupPriority = gp;
  }
  const n = patch.nutrition;
  if (n && typeof n === 'object') {
    const cur = { ...(p.nutrition || {}) };
    if ('mode' in n && MODES.includes(n.mode)) cur.mode = n.mode;
    if ('calories' in n) {
      if (n.calories === null) cur.calories = null;
      else { const v = vNum(n.calories, LIMITS.calories, { step: 10 }); if (v !== undefined) { cur.calories = v; if (!('surplus' in n)) cur.surplus = null; } }
    }
    if ('surplus' in n) {
      if (n.surplus === null) cur.surplus = null;
      else { const v = vNum(n.surplus, LIMITS.surplus, { step: 5 }); if (v !== undefined) { cur.surplus = v; if (!('calories' in n)) cur.calories = null; } }
    }
    if ('proteinGPerLb' in n) { const v = vNum(n.proteinGPerLb, LIMITS.proteinGPerLb, { round: 2 }); if (v !== undefined) cur.proteinGPerLb = v; }
    if ('fatPct' in n) { const v = vNum(n.fatPct, LIMITS.fatPct); if (v !== undefined) cur.fatPct = v; }
    if ('phases' in n) { const v = cleanPhases(n.phases); if (v !== undefined) cur.phases = v; }
    p.nutrition = cur;
  }
  if ('adherence' in patch) { const v = vNum(patch.adherence, LIMITS.adherence, { round: 2 }); if (v !== undefined) p.adherence = v; }
  const g = patch.goals || {};
  if ('goal' in g && GOALS.includes(g.goal)) p.goal = g.goal;
  if (Array.isArray(g.sculptGoals)) p.sculptGoals = [...new Set(g.sculptGoals.filter(x => typeof x === 'string'))];
  if ('goalBodyFatPct' in g) { const v = vNum(g.goalBodyFatPct, LIMITS.goalBodyFatPct, { round: 1 }); if (v !== undefined) p.body = { ...(p.body || {}), goalBodyFat: v }; }
  return p;
}

// ---------------------------------------------------------------- change helpers
// Does the change affect what the planner would generate?
export function needsReplan(before, after) {
  const a = resolveTargets(before), b = resolveTargets(after);
  const k = t => JSON.stringify([t.cardio.minPerWeek, t.cardio.modalities, t.cardio.hardSessionsPerWeek, t.training.schedule, t.training.style,
    t.training.defaultMinutes, t.training.groupPriority, t.goals.sculptGoals]);
  return k(a) !== k(b);
}

// Short human summary of what changed (for toasts), e.g. "225 min/wk cardio".
export function describeChange(before, after) {
  const a = resolveTargets(before), b = resolveTargets(after), out = [];
  if (a.cardio.minPerWeek !== b.cardio.minPerWeek) out.push(`${b.cardio.minPerWeek} min/wk cardio`);
  if (a.cardio.hardSessionsPerWeek !== b.cardio.hardSessionsPerWeek) out.push(`${b.cardio.hardSessionsPerWeek} hard cardio/wk`);
  if (JSON.stringify(a.cardio.modalities) !== JSON.stringify(b.cardio.modalities)) out.push(b.cardio.modalities.length ? `cardio: ${b.cardio.modalities.map(m => CARDIO[m]?.name || m).join(', ')}` : 'any cardio type');
  if (JSON.stringify(a.training.schedule) !== JSON.stringify(b.training.schedule)) out.push('your availability');
  if (a.training.defaultMinutes !== b.training.defaultMinutes) out.push(`${b.training.defaultMinutes}-min default sessions`);
  if (a.training.style !== b.training.style) out.push(`${b.training.style} style`);
  if (JSON.stringify(a.training.groupPriority) !== JSON.stringify(b.training.groupPriority)) out.push('muscle priorities');
  if (JSON.stringify(a.nutrition) !== JSON.stringify(b.nutrition)) out.push('nutrition targets');
  if (a.adherence !== b.adherence) out.push(`${Math.round(b.adherence * 100)}% adherence`);
  if (a.goals.goal !== b.goals.goal) out.push(`goal: ${b.goals.goal.replace('_', ' ')}`);
  if (a.goals.goalBodyFatPct !== b.goals.goalBodyFatPct) out.push(`goal ${b.goals.goalBodyFatPct}% body fat`);
  if (JSON.stringify(a.goals.sculptGoals) !== JSON.stringify(b.goals.sculptGoals)) out.push('sculpt focus');
  return out.join(', ');
}

// Day key helper for UIs ('mon'…'sun') of a date string.
export function dayKey(date) { return DOW[parseDs(date).getDay()]; }
