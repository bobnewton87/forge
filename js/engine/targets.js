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
//   makeRoomProposal(profile, target) (availability changes so the week can hold the cardio target),
//   CARDIO_STYLES/CARDIO_STYLE_NAMES/CARDIO_STYLE_WHY/MIN_SESSION_DEFAULT: profile.cardio.style
//   ('longer' default | 'balanced' | 'finishers') + profile.cardio.minSession (default 30/20/10): no
//   cardio block shorter than minSession is planned; capacity counts finishers only when ≥ minSession.
//   volumePolicyOf(profile), weeklyMinimums(profile), volumeRoomOptions(profile, short), MINIMUMS_EVIDENCE.
// CONTRACT-NOTE (STYLES, 2026-10-20): profile.customStyles = [{ id:'cs_<ts>', name, base, restCompound,
//   restIsolation, pairing, repMin?, repMax?, setsPerExercise? }] (validated by generator.normalizeCustomStyle:
//   rests 30-300 s, reps 3-30, sets 1-6, name ≤30, max 20) and optional schedule[day].style. Read via
//   resolveTargets().training.styles (built-ins + custom, for pickers) / .customStyles; written via
//   applyTargetChange({ training: { customStyles:[…] (full list), style, schedule:{ [day]:{ style } } } })
//   (style null clears a day's style; deleting a style drops its references). STYLES = built-in ids.
// CONTRACT-NOTE (weekly minimums, 2026-10-20): profile.volumePolicy = { mode:'extend'|'ask'|'fixed', maxMinutes }
//   (default extend, 90). resolveTargets().training.volumePolicy and resolveTargets().minimums
//   ({ groups:{ [g]:{min,max} }, evidence }) expose it. Minimums are the same resolved weekly group
//   targets the planner and weekPlanSummary use (recovery.groupStatus target incl. priority + sculpt extras).
//
// Evidence basis for the weekly set minimums (MINIMUMS_EVIDENCE below, shown in the Plan UI):
//  - ~10+ hard weekly sets per muscle maximizes hypertrophy for most trainees, with a graded
//    dose-response below that (Schoenfeld, Ogborn & Krieger 2017, J Sports Sci, meta-analysis).
//  - Indirect work counts fractionally (e.g. pressing gives triceps partial credit): Pelland et al.
//    2024 (SportRxiv preprint, dose-response meta-regression) found fractional counting of indirect
//    sets predicts growth best, which is how sets are credited here (exercise muscle weights).
//  - Maintaining muscle takes roughly 1/3 of the volume used to build it (Bickel, Cross & Bamman
//    2011, Med Sci Sports Exerc), so Bob's legs (maintenance priority) have intentionally lower minimums.
//  - Per-session returns diminish beyond ~8-10 sets per muscle, so the planner caps additions per
//    session (~10 big / ~8 small groups) and spreads the rest across the week. resolveTargets also returns
//   `capacity` ({ cardio, total, finishers, cardioDays, flex }) and `warnings`.
// CONTRACT-NOTE: nutrition.phases entries: { label, start:'YYYY-MM-DD', end:'YYYY-MM-DD'|null,
//   surplus:number|null, calories:number|null } sorted by start (max 12). Consumers may ignore them.
import { CARDIO, cardioOptions } from '../data/cardio.js';
import { DEFAULT_LOCATIONS, expandEquipment } from '../data/equipment.js';
import { sessionVolume, groupStatus } from './recovery.js';
import { GROUPS, REGIONS, VOLUME_UNITS, UNIT_ORDER } from '../data/muscles.js';
import { SCULPT_GOALS } from '../data/sculpt.js';
import { ds, parseDs, addDays, weekStart } from '../util.js';
import { BUILTIN_STYLES, STYLE_LIMITS, normalizeCustomStyle, styleOptions, isStyleId, resolveStyle } from './generator.js';
import { sexOf, BODY } from './sex.js';
// CONTRACT-NOTE (§20 Female mode): goals.goalBodyFatPct defaults to 22 for women (15 DXA-equivalent for men, §20b) and is clamped to the
//   female limits [14, 35] (men keep LIMITS.goalBodyFatPct [5, 30]); goalBodyFatLimits(profile) exposes them for UI steppers.
//   Weekly set targets are NOT sex-specific: no study supports different targets for women (Roberts 2020: same relative
//   hypertrophy; Nuzzo 2024: little sex influence on reps at a given %1RM; women are, if anything, less fatigable, Hunter 2014).

export const LIMITS = {
  cardioMin: [0, 900], cardioStep: 15, hardPerWeek: [0, 4], defaultMinutes: [10, 180],
  calories: [1200, 6000], surplus: [-1500, 1500], proteinGPerLb: [0.6, 1.4], fatPct: [15, 40],
  adherence: [0.5, 1], goalBodyFatPct: [5, 30], priority: [0.5, 2],
};
export const CARDIO_CHIPS = [90, 150, 225, 300];
export const STYLES = [...BUILTIN_STYLES];   // built-in style ids; custom ones live in profile.customStyles
export const GOALS = ['recomp', 'lean_bulk', 'cut'];
export const MODES = ['off', 'simple', 'cycling'];
export const VOLUME_MODES = ['extend', 'ask', 'fixed'];
export const FILL_MODES = ['extend', 'time', 'ask'];
// Cardio distribution (profile.cardio.style): few long sessions, a mix, or short finishers on lift days.
export const CARDIO_STYLES = ['longer', 'balanced', 'finishers'];
export const CARDIO_STYLE_NAMES = { longer: 'Long sessions', balanced: 'Balanced', finishers: 'Short finishers' };
export const MIN_SESSION_DEFAULT = { longer: 30, balanced: 20, finishers: 10 };
export const CARDIO_STYLE_WHY = 'Separate or longer cardio sessions reduce interference with lifting (Wilson et al. 2012) and suit an endurance base.';
export const MINIMUMS_EVIDENCE = [
  { claim: 'The minimum is the evidence floor: about 4 fractional sets/week is the minimum effective dose, gains rise steeply to about 10 and keep rising with diminishing returns to about 20. Floors here: ~10 for priority muscles, ~6 normal, 3-4 maintenance, 0 where other lifts already cover it.', source: 'Schoenfeld, Ogborn & Krieger 2017, J Sports Sci 35:1073; Pelland et al. 2025, Sports Med, doi:10.1007/s40279-025-02344-w' },
  { claim: 'Trained lifters do best around 12-20 sets per muscle per week. More than 20 added nothing for biceps or quads but helped triceps. Your targets sit in that range.', source: 'Baz-Valle et al. 2022, J Hum Kinet 81:199' },
  { claim: 'The weekly max is a ceiling on what a muscle can use, not a priority setting: 20 for most muscles, 24 for triceps and side delts, 22 for back (lats + upper back), 10 for lower back (fatigue guard). Biceps: 18 sets/week grew them as much as 27 (no better with more), and 12-20 matched over 20.', source: 'Heaselgrave et al. 2019, Int J Sports Physiol Perform 14:360; Baz-Valle et al. 2022; Pelland et al. 2025' },
  { claim: 'Indirect sets count half: presses give triceps 0.5 a set, rows and pulldowns give biceps 0.5. Each set counts once per muscle.', source: 'Pelland et al. 2025, Sports Med (fractional counting); Mannarino et al. 2021' },
  { claim: 'Keeping muscle takes about a third of the volume that built it, so your legs (maintenance) have low floors on purpose.', source: 'Bickel, Cross & Bamman 2011, Med Sci Sports Exerc; Spiering et al. 2021, J Strength Cond Res' },
  { claim: 'Per session, returns flatten past ~10-11 sets for one muscle, so sessions cap at 10 (big) / 8 (small) and spread the rest. Training a muscle 2x/week beats 1x unless volume is equal; small muscles can go on back-to-back days at moderate volume.', source: 'Remmert, Pelland et al. 2025 (preprint); Schoenfeld et al. 2016, Sports Med; Schoenfeld, Grgic & Krieger 2019' },
  { claim: 'Side and rear delts are enforced separately: pressing works the front delts, not the width-building side delts. Back counts lats and upper back only (traps and lower back are tracked but don\'t count).', source: 'Weekly-volume audit (docs/research/weekly-volume-audit.md)' },
];
const DEF_VOLUME = { mode: 'extend', maxMinutes: 90 };
// goalBodyFatPct: 15 % DXA-equivalent ≈ the colloquial "12 %" (§20b); a saved goal is never changed.
const DEF = { cardioMin: 120, hardPerWeek: 1, adherence: 0.85, defaultMinutes: 45, style: 'hypertrophy', proteinGPerLb: 1.0, fatPct: 25, goalBodyFatPct: BODY.male.goalBodyFat, goal: 'recomp' };
export function goalBodyFatLimits(profile) { return sexOf(profile) === 'female' ? BODY.female.goalBfLimits : LIMITS.goalBodyFatPct; }
const goalBfDefault = profile => (sexOf(profile) === 'female' ? BODY.female.goalBodyFat : DEF.goalBodyFatPct);
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
  if (!profile || typeof profile !== 'object') return { minPerWeek: DEF.cardioMin, modalities: [], hardSessionsPerWeek: DEF.hardPerWeek, style: 'longer', minSession: MIN_SESSION_DEFAULT.longer, source: 'default' };
  const hit = prefCache.get(profile);
  if (hit && hit.k === profile.cardioTargetMin && hit.c === profile.cardio) return hit.v;
  const has = fin(profile.cardioTargetMin);
  const c = profile.cardio && typeof profile.cardio === 'object' ? profile.cardio : {};
  const v = {
    minPerWeek: has ? clamp(Math.round(num(profile.cardioTargetMin)), LIMITS.cardioMin) : DEF.cardioMin,
    modalities: Array.isArray(c.modalities) ? c.modalities.filter(m => CARDIO[m]) : [],
    hardSessionsPerWeek: fin(c.hardPerWeek) ? clamp(Math.round(num(c.hardPerWeek)), LIMITS.hardPerWeek) : DEF.hardPerWeek,
    style: CARDIO_STYLES.includes(c.style) ? c.style : 'longer',
    minSession: 0,
    source: has ? 'profile' : 'default',
  };
  v.minSession = fin(c.minSession) ? clamp(Math.round(num(c.minSession)), [5, 90]) : MIN_SESSION_DEFAULT[v.style];
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
    out[k] = s && s.kind ? { kind: s.kind, minutes: Math.max(0, Number(s.minutes) || 0), location: s.location || 'home', ...(typeof s.style === 'string' && s.style ? { style: s.style } : {}) } : { kind: 'rest', minutes: 0, location: 'home' };
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
      else if (d.kind === 'lift' && canFinish(profile, d.location)) { const f = finisherCap(d.minutes); c = f >= cardioPrefs(profile).minSession ? f : 0; finishers += c; }
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
      const fc = finisherCap(plan.minutes);
      // a topped-up lift day's time belongs to the weekly set minimums: only its planned cardio counts
      const liftCap = plan.plan?.topUp ? cm : Math.max(cm, fc >= cardioPrefs(profile).minSession ? fc : 0);
      total += doneMin + (kind === 'lift' ? liftCap : kind === 'cardio' ? Math.max(cm, Number(plan.minutes) || 0) : cm);
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
  const minS = cardioPrefs(profile).minSession;
  const cap = Math.max(10, finisherCap(minutes) || (Number(minutes) >= 25 ? 10 : 0));
  if (!cap || cap < minS) return null;   // e.g. 'longer' style: no finishers shorter than minSession
  // Spread what's missing over the days left, but never less than 10 or more than the cap.
  const share = w.daysLeft > 1 ? Math.max(lacking / Math.max(1, Math.ceil(w.daysLeft / 2)), 10) : lacking;
  const m = Math.min(cap, Math.max(10, minS, round5(Math.min(lacking, share))));
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
  const cp = cardioPrefs(profile);
  const rests = DAYS.filter(d => cur[d].kind === 'rest');
  for (const d of [...rests].reverse()) {
    if (target - cap <= tol) break;
    const lo = cp.style === 'finishers' ? 20 : Math.max(20, cp.minSession);
    const m = rests.length <= 1 ? lo : Math.min(60, Math.max(lo, round5(target - cap)));
    tryMove(d, { kind: 'cardio', minutes: CHIPS.find(c => c >= m) || m, location: cur[d].location || 'home' }, '');
  }
  for (const d of DAYS) {
    if (target - cap <= tol || cp.style !== 'finishers') break;   // 'longer'/'balanced': no finisher-only fixes
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

// ---------------------------------------------------------------- weekly minimums
export function volumePolicyOf(profile) {
  const v = profile?.volumePolicy && typeof profile.volumePolicy === 'object' ? profile.volumePolicy : {};
  return { mode: VOLUME_MODES.includes(v.mode) ? v.mode : DEF_VOLUME.mode, maxMinutes: fin(v.maxMinutes) ? clamp(Math.round(num(v.maxMinutes)), [30, 180]) : DEF_VOLUME.maxMinutes,
    // Reach TARGETS (after minimums): 'extend' (default: lengthen up to maxMinutes) | 'time' (spare time
    // only) | 'ask'. A 'time' saved before 2026-10-20 without fillTargetsSetAt was never chosen by the
    // user (it was the old default), so it migrates to 'extend'.
    fillTargets: FILL_MODES.includes(v.fillTargets) && !(v.fillTargets === 'time' && !v.fillTargetsSetAt) ? v.fillTargets : 'extend',
    ...(v.fillTargetsSetAt ? { fillTargetsSetAt: v.fillTargetsSetAt } : {}) };
}
const minCache = new WeakMap();
// Resolved weekly set targets per muscle group ({min, max}), as the planner uses them.
export function weeklyMinimums(profile) {
  const key = profile && typeof profile === 'object' ? profile : minCache;
  const hit = minCache.get(key);
  const sig = JSON.stringify([profile?.groupPriority, profile?.sculptGoals]);
  if (hit && hit.sig === sig) return hit.v;
  let gs = {};
  try { gs = groupStatus([], { now: new Date(2026, 0, 5, 12), profile }); } catch (e) { gs = {}; }
  const v = Object.fromEntries(Object.entries(gs).filter(([g]) => GROUPS[g]).map(([g, x]) => [g, { min: Math.round((x.target?.min || 0) * 10) / 10, max: Math.round((x.target?.max || 0) * 10) / 10 }]));
  minCache.set(key, { sig, v });
  return v;
}
// Per enforcement unit (VOLUME_UNITS): min = evidence floor (fixed), target = base target × slider +
// sculpt extras (clamped to [min, max]), max = cap. The ONE priority mechanism: sliders and sculpt
// goals move only the target. → { [unit]: { min, target, max, base, slider, extra, name, group, tier } }
export function unitTargets(profile) {
  const key = profile && typeof profile === 'object' ? profile : unitCache;
  const sig = JSON.stringify([profile?.groupPriority, profile?.sculptGoals]);
  const hit = unitCache.get(key);
  if (hit && hit.sig === sig) return hit.v;
  const extraR = {};
  for (const id of Array.isArray(profile?.sculptGoals) ? profile.sculptGoals : []) {
    const g = SCULPT_GOALS[id]; if (!g || !(g.extraWeeklySets > 0)) continue;
    const es = Object.entries(g.regions || {}).filter(([r, w]) => REGIONS[r] && w > 0);
    const tot = es.reduce((a, [, w]) => a + w, 0); if (!tot) continue;
    for (const [r, w] of es) extraR[r] = (extraR[r] || 0) + g.extraWeeklySets * w / tot;
  }
  const v = {};
  for (const id of UNIT_ORDER) {
    const u = VOLUME_UNITS[id];
    const p = profile?.groupPriority?.[u.group];
    const slider = typeof p === 'number' && p > 0 ? p : 1;
    const extra = u.target > 0 ? Math.round(u.regions.reduce((a, r) => a + (extraR[r] || 0), 0) * 10) / 10 : 0;
    const target = Math.round(Math.min(u.max, Math.max(u.min, u.target * slider + extra)) * 10) / 10;
    v[id] = { min: u.min, target, max: u.max, base: u.target, slider, extra, name: u.name, group: u.group, tier: u.tier, big: u.big, sub: u.sub };
  }
  unitCache.set(key, { sig, v });
  return v;
}
const unitCache = new WeakMap();
// ★ = a muscle Forge is pushing above a normal dose. ONE rule for every screen: one of Bob's stated
// priorities (tier 'priority', unless its slider is turned down), a slider raised above 1×, or a sculpt
// goal adding sets. Tracked-only muscles never star. → Set of unit ids.
export function starredUnits(profile) {
  const U = unitTargets(profile), out = new Set();
  for (const [id, x] of Object.entries(U)) {
    if (x.tier === 'tracked') continue;
    if ((x.tier === 'priority' && x.slider >= 0.95) || x.slider > 1.05 || x.extra > 0) out.add(id);
  }
  return out;
}
// Group ★ (Body tab cards): any counted unit of the group is starred.
export function starredGroups(profile) {
  const s = starredUnits(profile);
  return new Set([...s].map(id => VOLUME_UNITS[id]?.group).filter(Boolean));
}
export const STAR_LEGEND = '★ = priority: one of your priorities, a raised slider or a sculpt goal';

// Ways to fit the weekly minimums when the cap/availability can't: raise the cap, add a lift day
// (flex/rest → lift), lengthen short lift days. → [{ id, label, patch }] (patch for setTargets).
export function volumeRoomOptions(profile) {
  const pol = volumePolicyOf(profile);
  const sch = normSchedule(profile?.schedule);
  const out = [];
  if (pol.mode !== 'extend') out.push({ id: 'extend', label: `Let Forge lengthen workouts (up to ${pol.maxMinutes}′)`, patch: { training: { volumePolicy: { mode: 'extend' } } } });
  if (pol.maxMinutes < 120) out.push({ id: 'cap', label: `Raise the workout cap ${pol.maxMinutes}→${pol.maxMinutes + 15}′`, patch: { training: { volumePolicy: { maxMinutes: pol.maxMinutes + 15, mode: pol.mode === 'fixed' ? 'extend' : pol.mode } } } });
  const flex = DAYS.find(d => sch[d].kind === 'flex' && sch[d].minutes >= 30);
  if (flex) out.push({ id: 'flex', label: `Make ${flex[0].toUpperCase() + flex.slice(1)} (flex) a lift day, ${sch[flex].minutes}′`, patch: { training: { schedule: { [flex]: { ...sch[flex], kind: 'lift' } } } } });
  const rests = DAYS.filter(d => sch[d].kind === 'rest');
  if (rests.length >= 2 || (!flex && rests.length)) { const d = rests[rests.length - 1]; out.push({ id: 'rest', label: `Add a 45′ lift day on ${d[0].toUpperCase() + d.slice(1)}`, patch: { training: { schedule: { [d]: { kind: 'lift', minutes: 45, location: 'home' } } } } }); }
  // Time-saver days fit ~28% more sets per minute (STYLES model: 90/60 s rests + non-competing pairs)
  const slow = DAYS.filter(d => sch[d].kind === 'lift' && sch[d].style !== 'efficient');
  if (slow.length) {
    const patch = {}; slow.forEach(d => { patch[d] = { ...sch[d], style: 'efficient' }; });
    out.push({ id: 'timesaver', label: `Switch ${slow.map(d => d[0].toUpperCase() + d.slice(1)).join(', ')} to Time-saver (~28% more sets per minute)`, patch: { training: { schedule: patch } } });
  }
  const short = DAYS.filter(d => sch[d].kind === 'lift' && sch[d].minutes < 45);
  if (short.length) {
    const patch = {}; short.forEach(d => { patch[d] = { ...sch[d], minutes: 45 }; });
    out.push({ id: 'longer', label: `Lengthen ${short.map(d => `${d[0].toUpperCase() + d.slice(1)} ${sch[d].minutes}→45′`).join(', ')}`, patch: { training: { schedule: patch } } });
  }
  return out;
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
      style: isStyleId(profile.defaultStyle, profile) ? profile.defaultStyle : DEF.style,
      styles: styleOptions(profile),                       // built-ins + custom, for every style picker
      customStyles: customStylesOf(profile),
      defaultMinutes: fin(profile.defaultMinutes) ? clamp(Math.round(num(profile.defaultMinutes)), LIMITS.defaultMinutes) : DEF.defaultMinutes,
      groupPriority: { ...(profile.groupPriority || {}) },
      volumePolicy: volumePolicyOf(profile),
    },
    minimums: { groups: weeklyMinimums(profile), units: unitTargets(profile), evidence: MINIMUMS_EVIDENCE },
    nutrition: nutritionOf(profile),
    adherence: fin(profile.adherence) ? clamp(num(profile.adherence), LIMITS.adherence) : DEF.adherence,
    stack: { active: stack, count: stack.length },
    goals: {
      goal: GOALS.includes(profile.goal) ? profile.goal : DEF.goal,
      sculptGoals: Array.isArray(profile.sculptGoals) ? [...profile.sculptGoals] : [],
      goalBodyFatPct: Number.isFinite(goalBf) && goalBf > 0 ? clamp(goalBf, goalBodyFatLimits(profile)) : goalBfDefault(profile),
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

export function customStylesOf(profile) {
  return (Array.isArray(profile?.customStyles) ? profile.customStyles : []).map(x => normalizeCustomStyle(x)).filter(Boolean).slice(0, STYLE_LIMITS.count);
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
  if ('modalities' in c || 'hardSessionsPerWeek' in c || 'style' in c || 'minSession' in c) {
    const cur = p.cardio && typeof p.cardio === 'object' ? { ...p.cardio } : {};
    if (Array.isArray(c.modalities)) cur.modalities = [...new Set(c.modalities.filter(m => CARDIO[m]))];
    if ('hardSessionsPerWeek' in c) { const v = vNum(c.hardSessionsPerWeek, LIMITS.hardPerWeek); if (v !== undefined) cur.hardPerWeek = v; }
    if ('style' in c && CARDIO_STYLES.includes(c.style)) { if (cur.style !== c.style && !('minSession' in c)) delete cur.minSession; cur.style = c.style; }
    if ('minSession' in c) { if (c.minSession === null) delete cur.minSession; else { const v = vNum(c.minSession, [5, 90], { step: 5 }); if (v !== undefined) cur.minSession = v; } }
    p.cardio = cur;
  }
  const t = patch.training || {};
  if (Array.isArray(t.customStyles)) {
    // Custom styles: validated + clamped (rests 30-300 s, reps 3-30, sets 1-6, name ≤30); unique ids.
    const seen = new Set(), list = [];
    t.customStyles.forEach((x, i) => {
      const c = normalizeCustomStyle(x, { now: Date.now() + i });
      if (!c) return;
      while (seen.has(c.id)) c.id += '_';
      seen.add(c.id); list.push(c);
    });
    p.customStyles = list.slice(0, STYLE_LIMITS.count);
    // drop references to deleted styles
    if (typeof p.defaultStyle === 'string' && p.defaultStyle.startsWith('cs_') && !isStyleId(p.defaultStyle, p)) p.defaultStyle = DEF.style;
    for (const k of DAYS) if (p.schedule?.[k]?.style && !isStyleId(p.schedule[k].style, p)) { p.schedule = { ...p.schedule, [k]: { ...p.schedule[k] } }; delete p.schedule[k].style; }
  }
  if ('defaultMinutes' in t) { const v = vNum(t.defaultMinutes, LIMITS.defaultMinutes); if (v !== undefined) p.defaultMinutes = v; }
  if ('style' in t && isStyleId(t.style, p)) p.defaultStyle = t.style;
  if (t.schedule && typeof t.schedule === 'object') {
    const kinds = ['lift', 'cardio', 'class', 'flex', 'rest'];
    const sch = { ...(p.schedule || {}) };
    for (const k of DAYS) {
      const d = t.schedule[k]; if (!d || typeof d !== 'object') continue;
      const kind = kinds.includes(d.kind) ? d.kind : (sch[k]?.kind || 'rest');
      // optional per-day training style: a valid id sets it, null/'' clears it (→ default style), absent keeps it
      const style = 'style' in d ? (isStyleId(d.style, p) ? d.style : null) : (isStyleId(sch[k]?.style, p) ? sch[k].style : null);
      sch[k] = { kind, minutes: kind === 'rest' ? 0 : (vNum(d.minutes, [0, 240]) ?? sch[k]?.minutes ?? 45), location: d.location || sch[k]?.location || 'home', ...(style ? { style } : {}) };
    }
    p.schedule = sch;
  }
  if (t.volumePolicy && typeof t.volumePolicy === 'object') {
    const cur = { ...volumePolicyOf(p) };
    if (VOLUME_MODES.includes(t.volumePolicy.mode)) cur.mode = t.volumePolicy.mode;
    if ('maxMinutes' in t.volumePolicy) { const v = vNum(t.volumePolicy.maxMinutes, [30, 180], { step: 5 }); if (v !== undefined) cur.maxMinutes = v; }
    if (FILL_MODES.includes(t.volumePolicy.fillTargets)) { cur.fillTargets = t.volumePolicy.fillTargets; cur.fillTargetsSetAt = new Date().toISOString(); }
    p.volumePolicy = cur;
  }
  if (t.groupPriority && typeof t.groupPriority === 'object') {
    const gp = {};
    for (const [g, v] of Object.entries(t.groupPriority)) { const x = vNum(v, LIMITS.priority, { round: 2 }); if (x !== undefined) gp[g] = x; }
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
  if ('goalBodyFatPct' in g) { const v = vNum(g.goalBodyFatPct, goalBodyFatLimits(p), { round: 1 }); if (v !== undefined) p.body = { ...(p.body || {}), goalBodyFat: v }; }
  return p;
}

// ---------------------------------------------------------------- change helpers
// Does the change affect what the planner would generate?
export function needsReplan(before, after) {
  const a = resolveTargets(before), b = resolveTargets(after);
  const k = t => JSON.stringify([t.cardio.minPerWeek, t.cardio.modalities, t.cardio.hardSessionsPerWeek, t.cardio.style, t.cardio.minSession, t.training.schedule, t.training.style,
    t.training.defaultMinutes, t.training.groupPriority, t.training.volumePolicy, t.goals.sculptGoals, usedStyles(t.training)]);
  return k(a) !== k(b);
}

// Custom styles the plan actually uses (default style or a weekday's style): editing others needs no re-plan.
function usedStyles(tr) {
  const ids = new Set([tr.style, ...Object.values(tr.schedule || {}).map(d => d.style)].filter(Boolean));
  return tr.customStyles.filter(c => ids.has(c.id));
}

// Short human summary of what changed (for toasts), e.g. "225 min/wk cardio".
export function describeChange(before, after) {
  const a = resolveTargets(before), b = resolveTargets(after), out = [];
  if (a.cardio.minPerWeek !== b.cardio.minPerWeek) out.push(`${b.cardio.minPerWeek} min/wk cardio`);
  if (a.cardio.hardSessionsPerWeek !== b.cardio.hardSessionsPerWeek) out.push(`${b.cardio.hardSessionsPerWeek} hard cardio/wk`);
  if (a.cardio.style !== b.cardio.style) out.push(`cardio as ${CARDIO_STYLE_NAMES[b.cardio.style].toLowerCase()}`);
  else if (a.cardio.minSession !== b.cardio.minSession) out.push(`cardio sessions ≥${b.cardio.minSession}′`);
  if (JSON.stringify(a.cardio.modalities) !== JSON.stringify(b.cardio.modalities)) out.push(b.cardio.modalities.length ? `cardio: ${b.cardio.modalities.map(m => CARDIO[m]?.name || m).join(', ')}` : 'any cardio type');
  if (JSON.stringify(a.training.schedule) !== JSON.stringify(b.training.schedule)) out.push('your availability');
  if (a.training.defaultMinutes !== b.training.defaultMinutes) out.push(`${b.training.defaultMinutes}-min default sessions`);
  if (a.training.style !== b.training.style) out.push(`${resolveStyle(b.training.style, after).name.toLowerCase()} style`);
  if (JSON.stringify(a.training.customStyles) !== JSON.stringify(b.training.customStyles)) out.push('your training styles');
  if (JSON.stringify(a.training.groupPriority) !== JSON.stringify(b.training.groupPriority)) out.push('muscle priorities');
  const va = a.training.volumePolicy, vb = b.training.volumePolicy;
  if (va.fillTargets !== vb.fillTargets) out.push(vb.fillTargets === 'extend' ? 'lengthen workouts to reach targets' : vb.fillTargets === 'ask' ? 'ask before lengthening for targets' : 'targets only in spare time');
  else if (va.mode !== vb.mode || va.maxMinutes !== vb.maxMinutes) out.push(vb.mode === 'fixed' ? 'fixed workout lengths' : `${vb.mode === 'ask' ? 'ask before lengthening' : 'lengthen workouts'} up to ${vb.maxMinutes}′`);
  if (JSON.stringify(a.nutrition) !== JSON.stringify(b.nutrition)) out.push('nutrition targets');
  if (a.adherence !== b.adherence) out.push(`${Math.round(b.adherence * 100)}% adherence`);
  if (a.goals.goal !== b.goals.goal) out.push(`goal: ${b.goals.goal.replace('_', ' ')}`);
  if (a.goals.goalBodyFatPct !== b.goals.goalBodyFatPct) out.push(`goal ${b.goals.goalBodyFatPct}% body fat`);
  if (JSON.stringify(a.goals.sculptGoals) !== JSON.stringify(b.goals.sculptGoals)) out.push('sculpt focus');
  return out.join(', ');
}

// Day key helper for UIs ('mon'…'sun') of a date string.
export function dayKey(date) { return DOW[parseDs(date).getDay()]; }
