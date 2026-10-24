// Forward planner (ENGINE-PLAN, CONTRACT §12). Pure, DOM-free, no localStorage.
//
// How it works: walk the range day by day. History = real (non-planned) sessions +
// simulateDone() copies of planned sessions we build around (kept/custom days, planned days
// before `from`) + every day generated so far. Each day is then decided against that forecast
// with recovery.recommend / groupStatus at noon of that day, so recovery, weekly volume and
// progression all "see" the plan as if Bob followed it.
//
// CONTRACT-NOTE: extra fields on generated sessions: `plan.groups` ([groupId] the lift day
//   targets, [] otherwise), `plan.nudged` ([groupId] added by the weekly-balance logic),
//   `plan.slot` ({kind, minutes, location} the schedule slot used), `plan.score` (decision score).
//   Lift sessions keep buildWorkout's extra fields (estMinutes, style, seed, poolLimited).
// CONTRACT-NOTE: planRange skips days before today(now), days with a kept planned session, and days
//   that already have a non-planned (done/active) session with work. Planned sessions dated in
//   [today, from) are simulated as history regardless of auto, so planning "next week" builds on
//   this week's plan. Planned sessions dated before today are treated as missed (ignored).
// CONTRACT-NOTE: suggestForDay(date, opts) accepts optional `slot` ({kind, minutes, location}) to
//   override the schedule for that day (e.g. "only 30 min at home today"). It treats every planned
//   session before `date` as history and ignores sessions already on `date`. Returns null for rest.
// CONTRACT-NOTE: weekPlanSummary also returns `regions` (priority regions only, same shape as
//   groups), `liftSets` ({done, planned}), and `capacity` ({liftMinutes, setsNeeded}). Planned
//   sessions dated before today(now) count as missed (neither done nor planned).
// CONTRACT-NOTE: session ids are 's_plan_<date>_<n>', n starting at 1 and bumped past any id
//   already present in `sessions`.
// CONTRACT-NOTE (PLAN-FIX, bidirectional context): every day is decided against the planned days
//   BEFORE it (simulated history) and AFTER it (`upcoming`, passed to recovery/generator in plan
//   mode): weekly volume = done + planned before + planned after (calendar week), and a group that a
//   following planned day trains is avoided when today's hit would land inside its recovery window.
//   suggestForDay now keeps done sessions on `date` as history (only planned ones there are ignored).
//   New export contextFor(date, sessions, { now, horizon }) → { before, after, history, upcoming }.
// CONTRACT-NOTE (INTEGRATOR, §18): cardio target/prefs come from engine/targets.js (cardioPrefs):
//   minPerWeek, preferred modalities (tried first when available), hardSessionsPerWeek. After the
//   greedy walk, balanceCardio() grows easy finishers on auto lift days of each week (up to
//   targets.finisherCap(minutes)) until the week's planned cardio reaches the target; what still
//   doesn't fit shows as a shortfall warning in weekPlanSummary (cardioMinutes.capacity/shortfall).
//   Lift days use the weekday's style (schedule[day].style, optional; STYLES builder) → else
//   profile.defaultStyle as the buildWorkout style (plan.slot.style records it); rebuild passes keep the
//   day's style. Time-saver days fit more sets per minute, so the minimums need fewer extensions.
// CONTRACT-NOTE (weekly minimums): after the cardio + balance passes, balanceVolume() tops up every
//   muscle group still under its weekly minimum (done + planned this calendar week): extra sets on
//   auto-planned exercises that hit it (≤5 sets each), else a new exercise from exercisesFor() at the
//   session's location (addExercise), within per-session per-group caps (~10 big / ~8 small) and
//   recovery (no new back-to-back hits). Sessions that run past their slot are extended per
//   targets.volumePolicyOf(profile) (extend ≤ maxMinutes; 'fixed'/'ask' stay within the slot) and
//   carry plan.extended = { from, to, reason }, session.minutes = to. planRange accepts an optional
//   `volumePolicy` override (the UI's 'ask' mode plans with 'extend' to build the proposal) and
//   `topUp:false` (skip the end-of-week passes: cardio, balance, minimums/targets/max; the greedy walk
//   alone, e.g. to compare day decisions).
//   weekPlanSummary warns per group "Triceps 9/13 sets: short 4" and returns `minimums`
//   ({ met, short:[{ group, name, total, min, short }] }) and `extended` ([{ date, from, to, reason }]).
// CONTRACT-NOTE (§26, 2026-10-24): the workout set ceiling (targets.sessionSetCapOf) holds on every
//   planned day: buildWorkout already stops there, and balanceVolume never adds a set or an exercise
//   that would pass it, so a day is lengthened only as far as the sets under the ceiling need. When
//   the ceiling is what stops a muscle reaching its minimum/target the reason is 'ceiling' ("your N-set
//   workout ceiling on every lift day", only when every lift day holds within a set of it) or
//   'ceiling_some' ("… on 2 of 3 lift days"); weekPlanSummary.minimums.binding can be 'ceiling', and
//   capacity gains { setCap, liftDays, maxSets }. Active profile.issues (§26) are excluded from every
//   exercise the top-up adds or swaps in.
import { recommend, groupStatus, muscleStatus, sessionVolume, unitVolume, unitSets, PUSH_PATTERNS, PULL_PATTERNS } from './recovery.js';
import { buildWorkout, estimateMinutes, addExercise, exercisesFor, swapBlock, alternatives, isStyleId, workingSets } from './generator.js';
import { activeIssues, issueFilter } from './issues.js';
import { getEx } from '../data/exercises.js';
import { CARDIO, INTENSITIES, cardioOptions } from '../data/cardio.js';
import { classify } from '../classes/classify.js';
import { GROUPS, GROUP_ORDER, REGIONS, VOLUME_UNITS, UNIT_ORDER, COUNTED_UNITS, unitWeight, unitCredits } from '../data/muscles.js';
import { DEFAULT_LOCATIONS, expandEquipment } from '../data/equipment.js';
import { ds, parseDs, addDays, weekStart as weekStartOf, clamp, rng } from '../util.js';
import { cardioPrefs, finisherCap, cardioCapacity, weekCardioCapacity, cardioTolerance, makeRoomProposal, volumePolicyOf, unitTargets, sessionSetCapOf } from './targets.js';

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PRIORITY_GROUPS = ['triceps', 'shoulders', 'core', 'back', 'chest'];
const PRIORITY_REGIONS = Object.values(REGIONS).filter(r => (r.priority || 1) >= 1.5).map(r => r.id);
const LEG_GROUPS = new Set(['quads', 'hamstrings', 'glutes', 'calves']);
const SETS_PER_MIN = 0.33;       // rough working sets a lift session yields per minute
const CARDIO_MIN_PER_SET = 3;    // exchange rate when weighing cardio vs lifting value
const EASY_PREF = ['run', 'treadmill', 'bike', 'walk_incline', 'elliptical', 'row', 'trail_run', 'spin', 'hike', 'walk', 'swim', 'stairmaster', 'ruck', 'hiit_bodyweight'];
const HARD_PREF = ['treadmill', 'run', 'assault_bike', 'row', 'bike', 'spin', 'stairmaster', 'elliptical', 'hiit_bodyweight'];
const FINISHER_PREF = ['bike', 'walk_incline', 'elliptical', 'row', 'run', 'walk'];

// ---------------------------------------------------------------- small helpers
const r1 = x => Math.round(x * 10) / 10;
const fmt = x => String(Math.round(x * 2) / 2);
const toDs = d => (d == null ? null : typeof d === 'string' ? d : ds(d));
const toDate = d => (d instanceof Date ? d : d ? (typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) ? parseDs(d) : new Date(d)) : new Date());
const noonOf = date => { const d = parseDs(date); d.setHours(12, 0, 0, 0); return d; };
const clone = s => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));
const gName = g => GROUPS[g]?.name || g;
const isRestPlan = s => s?.plan?.kind === 'rest';
const daysApart = (a, b) => Math.round((parseDs(b) - parseDs(a)) / 864e5);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Parse a class time ('17:30' or '5:30 pm') → minutes after midnight, or null.
function clockMin(start, time) {
  if (start && /^\d{1,2}:\d\d$/.test(start)) { const [h, m] = start.split(':').map(Number); return h * 60 + m; }
  const m = /^(\d{1,2}):(\d\d)\s*([ap])\.?m?\.?$/i.exec(String(time || '').trim());
  if (!m) return null;
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'p') h += 12;
  return h * 60 + Number(m[2]);
}

const volCache = new WeakMap();
function vol(s) {
  let v = volCache.get(s);
  if (!v) { v = sessionVolume(s); volCache.set(s, v); }
  return v;
}

const targetCache = new WeakMap();
function weeklyTargets(profile) {
  const key = profile || targetCache;
  let t = targetCache.get(key);
  if (!t) {
    const now = new Date(2026, 0, 5, 12);
    const gs = groupStatus([], { now, profile });
    const ms = muscleStatus([], { now, profile });
    t = {
      groups: Object.fromEntries(Object.entries(gs).map(([g, s]) => [g, { target: s.target, priority: s.priority }])),
      regions: Object.fromEntries(PRIORITY_REGIONS.filter(r => ms[r]).map(r => [r, { target: ms[r].target, priority: ms[r].priority }])),
    };
    targetCache.set(key, t);
  }
  return t;
}

function priorityGroups(profile) {
  const extra = Object.entries(profile?.groupPriority || {}).filter(([g, p]) => GROUPS[g] && p > 1).map(([g]) => g);
  return [...new Set([...PRIORITY_GROUPS, ...extra])];
}

function locationFor(profile, id) {
  const locs = profile?.locations?.length ? profile.locations : DEFAULT_LOCATIONS;
  return locs.find(l => l.id === id) || DEFAULT_LOCATIONS.find(l => l.id === id) || locs[0] || DEFAULT_LOCATIONS[0];
}

function slotFor(schedule, date) {
  const s = schedule?.[DOW[parseDs(date).getDay()]];
  if (!s || !s.kind) return { kind: 'rest', minutes: 0, location: 'home' };
  return { kind: s.kind, minutes: Number(s.minutes) || 0, location: s.location || 'home', ...(s.style ? { style: s.style } : {}) };
}

function classesOn(classSchedule, date) {
  const day = (classSchedule?.days || []).find(d => d && d.date === date);
  return (day?.classes || []).filter(c => c && c.name);
}

// ---------------------------------------------------------------- simulateDone
export function simulateDone(session) {
  if (!session) return session;
  const s = clone(session);
  s.status = 'done';
  for (const b of s.blocks || []) {
    if (b.kind === 'lift') {
      const t = b.target || {};
      const reps = Number.isFinite(t.reps) ? t.reps : (Number(t.repMin) || 8);
      const n = Math.max((b.sets || []).length, Number(t.sets) || 0);
      const sets = [];
      for (let i = 0; i < n; i++) {
        const cur = (b.sets || [])[i] || {};
        sets.push({ w: cur.w != null ? cur.w : (t.weight ?? null), r: Number(cur.r) > 0 ? cur.r : reps, done: true });
      }
      b.sets = sets;
    } else if (b.kind === 'cardio' || b.kind === 'class') b.done = true;
  }
  // Timestamps on the copy only, so recovery math has a real time of day (default 07:00).
  if (s.date && !(s.startedAt && ds(new Date(s.startedAt)) === s.date)) {
    const cls = (s.blocks || []).find(b => b.kind === 'class');
    const startMin = (cls && clockMin(null, cls.time)) ?? 7 * 60;
    const st = parseDs(s.date); st.setMinutes(startMin);
    s.startedAt = st.toISOString();
    const dur = Number(s.minutes) || Number(s.estMinutes) || (cls?.duration) || 45;
    const en = new Date(st.getTime() + dur * 60e3);
    s.endedAt = (ds(en) === s.date ? en : new Date(parseDs(s.date).getTime() + (24 * 60 - 1) * 60e3)).toISOString();
  }
  return s;
}

// ---------------------------------------------------------------- context
// Planned days around `date`, simulated as done, plus the history a builder for that date should
// see. before: planned sessions in [today, date); after: planned sessions in (date, date+horizon];
// history: real (non-planned) sessions + before; upcoming = after (pass to recommend/buildWorkout).
export function contextFor(date, sessions = [], { now = new Date(), horizon = 7 } = {}) {
  now = toDate(now);
  date = toDs(date) || ds(now);
  const today = ds(now);
  const end = ds(addDays(parseDs(date), horizon));
  const before = [], after = [], real = [];
  for (const s of sessions || []) {
    if (!s || !s.date) continue;
    if (s.status !== 'planned') { if (s.date <= date) real.push(s); continue; }
    if (isRestPlan(s) || !(s.blocks || []).length || s.date < today) continue;
    if (s.date < date) before.push(simulateDone(s));
    else if (s.date > date && s.date <= end) after.push(simulateDone(s));
  }
  return { before, after, history: [...real, ...before], upcoming: after };
}

// ---------------------------------------------------------------- week state
function weekBounds(date) {
  const ws = weekStartOf(parseDs(date));
  return { ws: ds(ws), we: ds(addDays(ws, 6)) };
}

function isHardBlock(b) {
  if (b.kind === 'cardio') return b.intensity === 'hard' || b.intensity === 'intervals';
  if (b.kind === 'class') { const c = b.classify || {}; return (c.intensity === 'hard' || c.intensity === 'intervals') && (c.cardioMinutes || 0) >= 20; }
  return false;
}

// What this week looks like before `date`, plus what's still coming from the schedule.
function weekState(ctx, date) {
  const { ws, we } = weekBounds(date);
  const proj = {}, after = {};
  let cardioMin = 0, hard = 0, lifts = 0, classes = 0, futureCardio = 0, futureLiftDays = 0;
  const recentCardio = [];   // modalities in the last 10 days, most recent first
  const tenAgo = ds(addDays(parseDs(date), -10));
  for (const s of ctx.history) {
    if (!s.date || s.date < ws || s.date > we) continue;
    const v = vol(s);
    if (s.date < date) {
      for (const [g, w] of Object.entries(v.groups)) proj[g] = (proj[g] || 0) + w;
      cardioMin += v.cardioMin;
      if (v.liftSets > 0) lifts++;
      if ((s.blocks || []).some(b => b.kind === 'class')) classes++;
      if ((s.blocks || []).some(isHardBlock)) hard++;
    } else if (s.date > date) {                               // kept/planned sessions later this week
      futureCardio += v.cardioMin;
      for (const [g, w] of Object.entries(v.groups)) after[g] = (after[g] || 0) + w;
    }
  }
  const rc = [];
  for (const s of ctx.history) {
    if (s.date >= date || s.date < tenAgo) continue;
    for (const b of s.blocks || []) if (b.kind === 'cardio' && b.minutes >= 20) rc.push([s.date, b.modality]);
  }
  rc.sort((a, b) => b[0].localeCompare(a[0])).forEach(([, m]) => { if (!recentCardio.includes(m)) recentCardio.push(m); });
  // Future schedule slots this week (not yet planned, not kept).
  for (let d = addDays(parseDs(date), 1); ds(d) <= we; d = addDays(d, 1)) {
    const k = ds(d);
    if (ctx.keptDates.has(k) || ctx.doneDates.has(k)) continue;
    const sl = slotFor(ctx.schedule, k);
    if (sl.kind === 'cardio') futureCardio += sl.minutes;
    else if (sl.kind === 'lift') { futureLiftDays++; if (sl.minutes >= 40 && cardioPrefs(ctx.profile).minSession <= 10 && hasMachineCardio(locationFor(ctx.profile, sl.location))) futureCardio += 10; }
    else if (sl.kind === 'flex' || sl.kind === 'class') { futureLiftDays += 0.5; futureCardio += sl.minutes * 0.4; }
  }
  return { ws, we, proj, after, cardioMin, hard, lifts, classes, futureCardio, futureLiftDays, recentCardio };
}

function hasMachineCardio(loc) {
  const eq = expandEquipment(loc.equipment || []);
  return ['bike', 'treadmill', 'rower', 'elliptical', 'assault_bike', 'stairmaster'].some(e => eq.has(e));
}

function cardioTarget(profile) { return cardioPrefs(profile).minPerWeek; }
// Preferred modalities (targets.cardio.modalities) available here come first; else the default list.
function prefList(profile, opts, pref) {
  const mine = cardioPrefs(profile).modalities.filter(m => opts.has(m));
  return mine.length ? mine : pref;   // stated preferences win whenever one is available here
}
const styleOf = profile => (isStyleId(profile?.defaultStyle, profile) ? profile.defaultStyle : 'hypertrophy');
// A lift day's style: the weekday's own style (availability schedule[day].style) → else profile.defaultStyle.
const styleFor = (profile, slot) => (slot && isStyleId(slot.style, profile) ? slot.style : styleOf(profile));
// Rebuilding an already planned day keeps the style it was planned with.
const styleKept = (ctx, old) => old?.styleDef || (isStyleId(old?.style, ctx.profile) ? old.style : styleFor(ctx.profile, old?.plan?.slot));

// Prio-weighted fraction of the weekly minimums still missing (0 = all met, 1 = nothing done).
function liftDeficitFrac(ctx, st) {
  const T = weeklyTargets(ctx.profile).groups;
  let num = 0, den = 0;
  for (const [g, t] of Object.entries(T)) {
    if (!(t.target.min > 0)) continue;
    const w = t.priority * t.target.min;
    num += w * clamp((t.target.min - (st.proj[g] || 0)) / t.target.min, 0, 1);
    den += w;
  }
  return den ? num / den : 0;
}

// ---------------------------------------------------------------- session shells
function shell(ctx, date, slot, extra) {
  return {
    id: ctx.newId(date), date, status: 'planned', startedAt: null, endedAt: null,
    location: slot.location, minutes: slot.minutes, title: '', targets: [], source: 'generated',
    blocks: [], rationale: [], notes: '', ...extra,
  };
}

function planMeta(ctx, kind, slot, reason, more = {}) {
  return { auto: true, kind, generatedAt: ctx.generatedAt, reason, slot: { ...slot }, groups: [], nudged: [], ...more };
}

// ---------------------------------------------------------------- lift day
function maxGroupsFor(minutes) { return minutes <= 25 ? 2 : minutes <= 40 ? 3 : minutes <= 65 ? 4 : 5; }

function liftDay(ctx, date, slot, st, R, why = null) {
  const loc = locationFor(ctx.profile, slot.location);
  const minutes = Math.max(10, slot.minutes || ctx.profile?.defaultMinutes || 45);
  const now = noonOf(date);
  const upcoming = ctx.history.filter(s => s.date > date);
  const recs = recommend(ctx.history, { now, profile: ctx.profile, minutes, location: loc, upcoming }) || [];
  const gs = groupStatus(ctx.history, { now, profile: ctx.profile, upcoming });
  const clear = g => (gs[g]?.aheadReadiness ?? 1) >= 0.6;   // a later planned day doesn't need it fresh

  // Variety: same weekday last week / previous lift session with identical targets gets a penalty;
  // seeded jitter breaks near-ties differently each week.
  const keyOf = arr => [...arr].sort().join(',');
  const lastWeek = ds(addDays(parseDs(date), -7));
  const baseOf = s => s.plan?.baseGroups || s.plan?.groups || [];
  const lwKeys = new Set(ctx.history.filter(s => s.date >= ds(addDays(parseDs(date), -9)) && s.date <= lastWeek && baseOf(s).length).map(s => keyOf(baseOf(s))));
  let prevKey = null, prevDate = '';
  for (const s of ctx.history) if (s.date < date && s.date >= prevDate && baseOf(s).length && vol(s).liftSets > 0) { prevKey = keyOf(baseOf(s)); prevDate = s.date; }
  const scored = recs.map(r => {
    let sc = r.score + R() * 4;
    const k = keyOf(r.groups);
    if (lwKeys.has(k)) sc -= 8;
    if (k === prevKey) sc -= 4;
    return { r, sc };
  });
  const viable = scored.filter(x => !x.r.recovering);
  const pool = viable.length ? viable : scored;
  pool.sort((a, b) => b.sc - a.sc);
  const pick = pool[0]?.r || { targets: ['upper'], groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'], label: 'Upper Body', reasons: [] };

  const targets = [...pick.targets];
  const groups = [...pick.groups];
  const nudged = [];
  const reasons = [];
  // Weekly balance: a priority group that can't catch up on the remaining lift days gets added.
  if (minutes >= 30) {
    const T = weeklyTargets(ctx.profile).groups;
    const left = st.futureLiftDays + 1;
    const cands = priorityGroups(ctx.profile)
      .filter(g => !groups.includes(g) && T[g] && (gs[g]?.readiness ?? 1) >= 0.65 && clear(g))
      .map(g => ({ g, def: T[g].target.min - (st.proj[g] || 0) - (st.after[g] || 0) }))
      .filter(x => x.def / left >= 3)
      .sort((a, b) => b.def * T[b.g].priority - a.def * T[a.g].priority);
    for (const c of cands) {
      if (groups.length >= maxGroupsFor(minutes)) break;
      groups.push(c.g); targets.push(c.g); nudged.push(c.g);
      reasons.push(`Added ${gName(c.g).toLowerCase()}: ${fmt((st.proj[c.g] || 0) + (st.after[c.g] || 0))}/${Math.round(T[c.g].target.min)} sets this week incl. planned`);
      break;   // one nudge per day keeps sessions focused
    }
    // Legs are maintenance-only, but not zero: after ~8 days without quads, add them once.
    const q = gs.quads;
    const qStale = q && (q.lastTrained ? q.daysSince >= 8 : (ctx.firstDate && daysApart(ctx.firstDate, date) >= 7));
    if (!nudged.length && minutes >= 40 && qStale && !groups.some(g => LEG_GROUPS.has(g)) && (q.readiness ?? 1) >= 0.8 && clear('quads') && groups.length < maxGroupsFor(minutes)) {
      groups.push('quads'); targets.push('quads'); nudged.push('quads');
      reasons.push(`Added quads for maintenance: ${q.lastTrained ? q.daysSince + ' days since' : 'none planned in over a week'} (legs stay low volume)`);
    }
  }

  // Short easy finisher when cardio is behind and there's time + a machine.
  let cardio = null;
  const target = cardioTarget(ctx.profile);
  if (target > 0 && minutes >= 40 && st.cardioMin + st.futureCardio < target) {
    const opts = new Set(cardioOptions(expandEquipment(loc.equipment || [])).map(c => c.id));
    const mod = prefList(ctx.profile, opts, FINISHER_PREF).find(m => opts.has(m) && (m !== 'run' && m !== 'walk' ? true : minutes >= 45));
    const fm = minutes >= 60 ? 15 : 10;
    if (mod && fm >= cardioPrefs(ctx.profile).minSession) cardio = { modality: mod, minutes: fm, intensity: 'easy' };   // never shorter than minSession
  }

  const seed = hashStr(date + '|lift|' + ctx.seed);
  const w = buildWorkout({ targets, minutes, location: loc, profile: ctx.profile, sessions: ctx.history, now, seed, cardio, upcoming, style: styleFor(ctx.profile, slot) });
  const label = pick.label + (nudged.length ? ' + ' + nudged.map(gName).join(' & ') : '');
  const recWhy = (pick.reasons || []).filter(x => !/^Cardio:/.test(x)).slice(0, 2);
  const reason = why || `${label}: best fit for recovery and this week's targets`;
  const wr = (w.rationale || []).filter(x => !(cardio && /finisher/.test(x)));
  const rationale = [`Planned ${label} (${minutes} min, ${loc.name || loc.id})${recWhy.length ? ': ' + recWhy.join('; ') : ''}`, ...reasons, ...wr];
  if (cardio) rationale.push(`Cardio is behind this week (${Math.round(st.cardioMin)}/${target} min), so a ${cardio.minutes}-min Zone 2 ${CARDIO[cardio.modality]?.name.toLowerCase() || cardio.modality} finisher`);
  return {
    ...w,
    id: ctx.newId(date), date, status: 'planned', startedAt: null, endedAt: null,
    location: loc.id, minutes, title: label + (/ · /.test(w.title || '') ? ' · ' + w.title.split(' · ').slice(1).join(' · ') : ''),
    rationale: rationale.slice(0, 7),
    plan: planMeta(ctx, 'lift', slot, reason, { groups: [...new Set([...groups])], nudged, baseGroups: [...pick.groups] }),
  };
}

// ---------------------------------------------------------------- cardio day
function cardioNote(mod, intensity, R) {
  const c = CARDIO[mod];
  if (intensity === 'easy') {
    if (mod === 'run' || mod === 'trail_run' || mod === 'treadmill') return 'Zone 2: conversational, roughly 7:15-8:00/mi for you. If you can\'t speak in sentences, back off.';
    return 'Zone 2: conversational effort (RPE 3-4), nasal breathing if you can.';
  }
  const ideas = c?.intervalIdeas || [];
  return ideas.length ? ideas[Math.floor(R() * ideas.length)] : 'Warm up 10 min, then 5 × 3 min hard / 2 min easy.';
}

// Weighted pick from the top 3 preferred modalities available here, skipping recent ones.
function pickModality(opts, pref, R, recent) {
  const avail = pref.filter(m => opts.has(m));
  if (!avail.length) return opts.has('hiit_bodyweight') ? 'hiit_bodyweight' : [...opts][0] || 'walk';
  const top = avail.filter(m => !recent.includes(m)).slice(0, 3);
  const list = top.length ? top : avail.filter(m => m !== recent[0]).slice(0, 3);
  if (!list.length) return avail[0];
  const w = [3, 2, 1].slice(0, list.length), tot = w.reduce((a, b) => a + b, 0);
  let x = R() * tot;
  for (let i = 0; i < list.length; i++) { x -= w[i]; if (x < 0) return list[i]; }
  return list[0];
}

function cardioDay(ctx, date, slot, st, R, why = null) {
  const loc = locationFor(ctx.profile, slot.location);
  const minutes = Math.max(10, slot.minutes || 30);
  const target = cardioTarget(ctx.profile);
  const opts = new Set(cardioOptions(expandEquipment(loc.equipment || [])).map(c => c.id));
  // ~1 quality session per week (tempo or intervals, alternating by week), the rest easy.
  const weekNo = Math.floor(parseDs(st.ws).getTime() / (7 * 864e5));
  let intensity = 'easy';
  if (st.hard < cardioPrefs(ctx.profile).hardSessionsPerWeek && minutes >= 25 && !(target > 0 && st.cardioMin >= target)) intensity = weekNo % 2 ? 'intervals' : 'hard';
  // Quality sessions stay on his best modality (running when possible); easy days rotate.
  const mod = pickModality(opts, prefList(ctx.profile, opts, intensity === 'easy' ? EASY_PREF : HARD_PREF), intensity === 'easy' ? R : () => 0, intensity === 'easy' ? st.recentCardio : []);
  const c = CARDIO[mod];
  const block = { kind: 'cardio', modality: mod, minutes, intensity, distance: null, calories: null, done: false, note: cardioNote(mod, intensity, R) };
  const iname = intensity === 'easy' ? 'Zone 2' : intensity === 'intervals' ? 'Intervals' : 'Tempo';
  const rationale = [];
  if (intensity === 'easy') {
    rationale.push(`Easy ${minutes} min ${c?.name.toLowerCase() || mod}: aerobic base and fat burn without denting lifting recovery`);
    if (st.hard > 0) rationale.push('This week\'s quality session is already in, so keep it truly easy (80/20)');
  } else {
    rationale.push(`This week's one quality session (${INTENSITIES[intensity]?.name || intensity}): ${block.note}`);
    rationale.push('Everything else stays easy. One hard day keeps the engine sharp without eating into lifting recovery.');
  }
  if (target > 0) rationale.push(`Cardio: ${Math.round(st.cardioMin)}/${target} min this week before today`);
  if (c?.legFatigue >= 0.55) rationale.push(`${c.name} is leg-heavy, but legs are on maintenance, so it costs little`);
  const reason = why || `${iname} ${c?.name || mod}${intensity === 'easy' ? '' : ' (weekly quality session)'}`;
  return shell(ctx, date, slot, {
    location: loc.id, minutes, title: `${iname} · ${c?.name || mod}`, source: 'cardio', blocks: [block],
    rationale, plan: planMeta(ctx, 'cardio', slot, reason, { intensity }),
  });
}

// ---------------------------------------------------------------- classes
function classCandidates(ctx, date, slot) {
  const list = classesOn(ctx.classSchedule, date);
  if (!list.length) return [];
  const today = ds(ctx.now);
  const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  const out = [];
  for (const c of list) {
    const dur = Number(c.duration) || 45;
    if (slot.minutes && dur > slot.minutes + 5) continue;
    const t = clockMin(c.start, c.time);
    if (t != null && (t < 6 * 60 || t > 20 * 60)) continue;          // reasonable hours only
    if (date === today && t != null && t < nowMin + 30) continue;     // already started / too soon
    const info = c.classify || classify(c.name, dur);
    out.push({ c, dur, t, info });
  }
  return out;
}

function groupCreditsOf(muscles) {
  const g = {};
  for (const [r, w] of Object.entries(muscles || {})) {
    const grp = REGIONS[r]?.group; if (!grp || !(w > 0)) continue;
    g[grp] = Math.max(g[grp] || 0, w);
  }
  return g;
}

function classValue(ctx, x, st, gs, cardioGap, slot) {
  const T = weeklyTargets(ctx.profile).groups;
  const gc = groupCreditsOf(x.info.muscles);
  let muscle = 0, hits = [];
  for (const [g, w] of Object.entries(gc)) {
    const t = T[g]; if (!t) continue;
    const def = Math.max(0, t.target.min - (st.proj[g] || 0));
    const v = (LEG_GROUPS.has(g) ? 0.35 : t.priority) * Math.min(w, def);   // legs: maintenance only
    muscle += v;
    if (v >= 0.9 && !LEG_GROUPS.has(g)) hits.push(g);
    if (w >= 1 && (gs[g]?.readiness ?? 1) < 0.5) muscle -= w * t.priority;
  }
  const cm = Number(x.info.cardioMinutes) || 0;
  // With 'longer'/'balanced' cardio, a class whose cardio block is itself a long session (≥ minSession)
  // is worth a bit more, since short add-ons/finishers are off the table.
  const minS = cardioPrefs(ctx.profile).minSession;
  let cardio = Math.min(cm, Math.max(0, cardioGap)) / CARDIO_MIN_PER_SET * 0.8 * (minS > 10 && cm >= minS ? 1.35 : 1);
  const leftover = (slot.minutes || x.dur) - x.dur;
  let addOn = leftover >= 10 && cardioGap - cm > 0 ? clamp(Math.floor((Math.min(leftover - 5, 20, cardioGap - cm)) / 5) * 5, 0, 20) : 0;
  if (addOn < cardioPrefs(ctx.profile).minSession) addOn = 0;   // no add-on shorter than minSession
  cardio += addOn / CARDIO_MIN_PER_SET * 0.8;
  // Variety / fun of a class: Bob likes Crunch classes, so a class at a class location gets a
  // bigger nudge when it also covers real cardio.
  let v = muscle + cardio + (cm >= 20 ? 4 : 1.5);
  if (isHardBlock({ kind: 'class', classify: x.info }) && st.hard >= 1) v -= 2;
  if (x.t != null && (x.t < 7 * 60 || x.t > 19 * 60 + 30)) v *= 0.85;  // early-bird / late slots
  return { v, hits, addOn, cm };
}

function classDay(ctx, date, slot, st, R, x, val) {
  const { c, dur, info } = x;
  const loc = locationFor(ctx.profile, slot.location);
  const locId = loc.hasClasses ? loc.id : ((ctx.profile?.locations || DEFAULT_LOCATIONS).find(l => l.hasClasses)?.id || 'crunch');
  const blocks = [{ kind: 'class', provider: 'crunch', name: c.name, time: c.time || null, duration: dur, instructor: c.instructor || null, classify: info, done: false }];
  if (val.addOn > 0) {
    const opts = new Set(cardioOptions(expandEquipment(locationFor(ctx.profile, locId).equipment || [])).map(o => o.id));
    const mod = prefList(ctx.profile, opts, FINISHER_PREF).find(m => opts.has(m)) || 'walk';
    blocks.push({ kind: 'cardio', modality: mod, minutes: val.addOn, intensity: 'easy', distance: null, calories: null, done: false, note: 'Easy Zone 2 after class' });
  }
  const target = cardioTarget(ctx.profile);
  const rationale = [`${c.name}${c.time ? ' at ' + c.time : ''} (${dur} min${c.instructor ? ', ' + c.instructor : ''}): ${info.label || info.type}${info.blurb ? '. ' + info.blurb : ''}`];
  if (val.hits.length) rationale.push(`Credits under-target muscles: ${val.hits.map(gName).join(', ')}`);
  if (val.cm >= 15 && target > 0) rationale.push(`~${val.cm} cardio min toward ${target} (${Math.round(st.cardioMin)} so far this week)`);
  if (val.addOn) rationale.push(`Plus ${val.addOn} min easy ${blocks[1].modality.replace(/_/g, ' ')} to use the rest of your ${slot.minutes} min`);
  rationale.push('Class volume is credited conservatively: lighter loads than a lift day, so it counts as fewer effective sets');
  const reason = `${c.name} fits ${slot.minutes || dur} min${val.hits.length ? ' and hits ' + val.hits.map(g => gName(g).toLowerCase()).join(', ') : ''}${val.cm >= 20 ? ' plus cardio' : ''}`;
  return shell(ctx, date, slot, {
    location: locId, minutes: dur + val.addOn, title: c.name, source: 'class', blocks, rationale,
    plan: planMeta(ctx, 'class', slot, reason, { classTime: c.time || null }),
  });
}

// ---------------------------------------------------------------- flex / class slots
function decideFlex(ctx, date, slot, st, R, allowClasses) {
  const minutes = slot.minutes || 45;
  const target = cardioTarget(ctx.profile);
  const cardioGap = target > 0 ? target - st.cardioMin - st.futureCardio : 0;
  const liftFrac = liftDeficitFrac(ctx, st);
  const jit = () => 0.92 + R() * 0.16;
  const opts = [];
  // §26: a lift day is worth at most the workout set ceiling, however long the slot.
  opts.push({ kind: 'lift', v: liftFrac * Math.min(minutes * SETS_PER_MIN, sessionSetCapOf(ctx.profile)) * (st.lifts < 3 ? 1.15 : 1) * jit() });
  // ('longer'/'balanced' styles need no boost here: without short finishers the cardio gap is larger,
  // so flex days already lean to a cardio session or a cardio-heavy class.)
  opts.push({ kind: 'cardio', v: Math.min(minutes, Math.max(0, cardioGap)) / CARDIO_MIN_PER_SET * 0.8 * jit() });
  if (allowClasses) {
    const gs = groupStatus(ctx.history, { now: noonOf(date), profile: ctx.profile });
    for (const x of classCandidates(ctx, date, slot)) {
      const val = classValue(ctx, x, st, gs, cardioGap, slot);
      opts.push({ kind: 'class', v: val.v * jit(), x, val });
    }
  }
  opts.sort((a, b) => b.v - a.v);
  // A 'class' slot means Bob wants a class: take the best fitting one whenever there is one.
  const best = slot.kind === 'class' ? (opts.find(o => o.kind === 'class') || opts[0]) : opts[0];
  return { best, opts, liftFrac, cardioGap };
}

function flexDay(ctx, date, slot, st, R) {
  const loc = locationFor(ctx.profile, slot.location);
  const allowClasses = slot.kind === 'class' || !!loc.hasClasses;
  const { best, liftFrac, cardioGap } = decideFlex(ctx, date, slot, st, R, allowClasses);
  const label = slot.kind === 'class' ? 'Class day' : 'Flex day';
  let s;
  if (best.kind === 'class') s = classDay(ctx, date, slot, st, R, best.x, best.val);
  else if (best.kind === 'cardio') s = cardioDay(ctx, date, { ...slot, kind: 'cardio' }, st, R,
    `${label}: cardio is behind (${Math.round(st.cardioMin)}/${cardioTarget(ctx.profile)} min, ~${Math.round(Math.max(0, cardioGap))} short after the rest of the week)`);
  else s = liftDay(ctx, date, slot, st, R,
    `${label}: lifting volume is the bigger gap (${Math.round(liftFrac * 100)}% of weekly minimums still open)`);
  s.plan.slot = { ...slot };
  s.plan.score = Math.round(best.v * 10) / 10;
  if (slot.kind === 'class' && best.kind !== 'class') s.rationale.unshift(classesOn(ctx.classSchedule, date).length ? 'No class fits your time today, so here\'s the best alternative' : 'No class schedule for this date yet, so here\'s the best alternative');
  return s;
}

// ---------------------------------------------------------------- core walk
function makeCtx({ profile, sessions, schedule, classSchedule, now, seed }) {
  const used = new Set((sessions || []).map(s => s && s.id).filter(Boolean));
  const ctx = {
    profile: profile || {}, schedule: schedule || profile?.schedule || {}, classSchedule: classSchedule || null,
    now, today: ds(now), seed: seed == null ? 0 : seed, generatedAt: now.toISOString(),
    history: [], keptDates: new Set(), doneDates: new Set(),
    newId(date) { let n = 1; while (used.has('s_plan_' + date + '_' + n)) n++; const id = 's_plan_' + date + '_' + n; used.add(id); return id; },
  };
  return ctx;
}

function planDay(ctx, date, slot) {
  const st = weekState(ctx, date);
  const R = rng(hashStr(date + '|' + ctx.seed));
  if (slot.kind === 'lift') return liftDay(ctx, date, slot, st, R);
  if (slot.kind === 'cardio') return cardioDay(ctx, date, slot, st, R);
  return flexDay(ctx, date, slot, st, R);     // 'flex' and 'class'
}

// Weekly totals over ctx.history for [ws, we].
function weekGroupTotals(history, ws, we) {
  const t = {};
  for (const s of history) {
    if (!s.date || s.date < ws || s.date > we) continue;
    for (const [g, w] of Object.entries(vol(s).groups)) t[g] = (t[g] || 0) + w;
  }
  return t;
}

function priorityDeficit(ctx, totals) {
  const T = weeklyTargets(ctx.profile).groups;
  let d = 0;
  for (const g of priorityGroups(ctx.profile)) if (T[g]) d += T[g].priority * Math.max(0, T[g].target.min - (totals[g] || 0));
  return d;
}

// End-of-week pass: if a priority group is still under, rebuild the last suitable auto lift
// day of the week with that group added (kept only if the week's priority deficit improves).
function balanceWeek(ctx, out, ws, we) {
  const T = weeklyTargets(ctx.profile).groups;
  const totals = weekGroupTotals(ctx.history, ws, we);
  const under = priorityGroups(ctx.profile).filter(g => T[g] && (totals[g] || 0) < T[g].target.min)
    .sort((a, b) => T[b].priority * (T[b].target.min - (totals[b] || 0)) / T[b].target.min - T[a].priority * (T[a].target.min - (totals[a] || 0)) / T[a].target.min);
  if (!under.length) return;
  const lifts = out.filter(s => s.date >= ws && s.date <= we && s.plan?.kind === 'lift' && s.minutes >= 30);
  for (const g of under) {
    for (let i = lifts.length - 1; i >= 0; i--) {
      const old = lifts[i];
      if (old.plan.groups.includes(g) || old.plan.groups.length >= maxGroupsFor(old.minutes)) continue;
      const hi = ctx.history.findIndex(h => h.id === old.id);
      if (hi < 0) continue;
      const hist = ctx.history.filter((_, j) => j !== hi);
      const now = noonOf(old.date);
      const gs = groupStatus(hist, { now, profile: ctx.profile, upcoming: hist.filter(h => h.date > old.date) });
      if ((gs[g]?.readiness ?? 1) < 0.65 || (gs[g]?.aheadReadiness ?? 1) < 0.6) continue;
      // next day shouldn't be hammering the same group
      const next = ds(addDays(parseDs(old.date), 1));
      if (hist.some(h => h.date === next && (vol(h).groups[g] || 0) >= 4)) continue;
      const loc = locationFor(ctx.profile, old.location);
      const targets = [...old.targets, g];
      const cardio = (old.blocks || []).filter(b => b.kind === 'cardio').map(b => ({ modality: b.modality, minutes: b.minutes, intensity: b.intensity }))[0] || null;
      const w = buildWorkout({ targets, minutes: old.minutes, location: loc, profile: ctx.profile, sessions: hist, now, seed: old.seed, cardio, style: styleKept(ctx, old) });
      const repl = {
        ...w, id: old.id, date: old.date, status: 'planned', startedAt: null, endedAt: null, location: old.location, minutes: old.minutes,
        rationale: [old.rationale[0], `Added ${gName(g).toLowerCase()} to close this week's gap (${fmt(totals[g] || 0)}/${Math.round(T[g].target.min)} sets)`, ...(w.rationale || [])].slice(0, 7),
        plan: { ...old.plan, groups: [...old.plan.groups, g], nudged: [...old.plan.nudged, g], reason: old.plan.reason + `; + ${gName(g).toLowerCase()} for weekly balance` },
      };
      const sim = simulateDone(repl);
      const trial = hist.slice(); trial.splice(hi, 0, sim);
      if (priorityDeficit(ctx, weekGroupTotals(trial, ws, we)) < priorityDeficit(ctx, totals) - 0.5) {
        ctx.history[hi] = sim;
        out[out.indexOf(old)] = repl;
        return;           // one rebuild per week keeps it simple
      }
    }
  }
}

// End-of-week cardio pass (§18): if the week's cardio (done + kept + planned) is under the target,
// grow easy finishers on this week's auto lift days (round-robin, 5 min at a time, up to
// finisherCap) and rebuild those days so the lifting part shrinks to fit the same minutes.
function balanceCardio(ctx, out, ws, we, last) {
  const target = cardioTarget(ctx.profile);
  if (!(target > 0)) return;
  let have = 0;
  for (const s of ctx.history) if (s.date >= ws && s.date <= we) have += vol(s).cardioMin;
  // Days of this week after the planned range: assume they hold what their slot can.
  const cap = cardioCapacity(ctx.profile, ctx.schedule).byDay;
  for (let d = addDays(parseDs(last), 1); ds(d) <= we; d = addDays(d, 1)) {
    const k = ds(d);
    if (!ctx.keptDates.has(k) && !ctx.doneDates.has(k)) have += cap[DOW[d.getDay()]] || 0;
  }
  // Within ~10% of the target is close enough (same tolerance as weekPlanSummary's warning).
  if (target - have < cardioTolerance(target)) return;
  let need = round5(target - have);
  const cands = [];
  for (const s of out) {
    if (s.date < ws || s.date > we || s.plan?.kind !== 'lift' || !(s.minutes >= 30)) continue;
    const loc = locationFor(ctx.profile, s.location);
    const opts = new Set(cardioOptions(expandEquipment(loc.equipment || [])).map(c => c.id));
    const cur = (s.blocks || []).filter(b => b.kind === 'cardio');
    const mod = cur[0]?.modality || prefList(ctx.profile, opts, FINISHER_PREF).find(m => opts.has(m) && FINISHER_PREF.includes(m));
    if (!mod) continue;
    const curMin = cur.reduce((a, b) => a + (Number(b.minutes) || 0), 0);
    const room = finisherCap(s.minutes) - curMin;
    if (room >= 5) cands.push({ s, loc, mod, curMin, add: 0, room });
  }
  // Longest sessions first (a finisher costs them the smallest share of lifting), machines before
  // outdoor run/walk; each finisher ends up 10+ min, and we stop once within tolerance.
  const outdoor = c => (/^(run|walk)$/.test(c.mod) ? 1 : 0);
  cands.sort((a, b) => b.s.minutes - a.s.minutes || outdoor(a) - outdoor(b));
  const tol = cardioTolerance(target);
  const minS = Math.max(10, cardioPrefs(ctx.profile).minSession);   // 'longer': 30 → only 75+ min lift days qualify
  let left = need;
  for (const c of cands) {
    if (left < tol) break;
    let add = Math.min(c.room, round5(left));
    if (c.curMin + add < minS) add = minS - c.curMin;
    if (add < 5 || add > c.room) continue;
    c.add = add; left -= add;
  }
  for (const c of cands) {
    if (!c.add) continue;
    const old = c.s, mins = c.curMin + c.add;
    if (old.plan?.topUp) {   // topped-up day: grow/add the finisher in place, only within its current length
      const blocks = clone(old.blocks || []);
      const cb = blocks.find(b => b.kind === 'cardio');
      if (cb) cb.minutes = mins; else blocks.push({ kind: 'cardio', modality: c.mod, minutes: mins, intensity: 'easy', distance: null, calories: null, done: false, note: 'Easy Zone 2 finisher' });
      if (estimateMinutes(blocks) > old.minutes + 1) continue;
      const repl = { ...old, blocks, estMinutes: estimateMinutes(blocks), plan: { ...old.plan, cardioFinisher: mins } };
      const hix = ctx.history.findIndex(h => h.id === old.id);
      if (hix >= 0) ctx.history[hix] = simulateDone(repl);
      out[out.indexOf(old)] = repl;
      continue;
    }
    const hi = ctx.history.findIndex(h => h.id === old.id);
    if (hi < 0) continue;
    const hist = ctx.history.filter((_, j) => j !== hi);
    const now = noonOf(old.date);
    const cardio = { modality: c.mod, minutes: mins, intensity: 'easy' };
    const w = buildWorkout({ targets: old.targets, minutes: old.minutes, location: c.loc, profile: ctx.profile, sessions: hist, now, seed: old.seed, cardio, upcoming: hist.filter(h => h.date > old.date), style: styleKept(ctx, old) });
    const why = `Weekly cardio target ${target} min: a ${mins}-min easy ${CARDIO[c.mod]?.name.toLowerCase() || c.mod} finisher (lifting gets the other ${old.minutes - mins} min)`;
    const repl = {
      ...w, id: old.id, date: old.date, status: 'planned', startedAt: null, endedAt: null, location: old.location, minutes: old.minutes, title: old.title,
      rationale: [old.rationale[0], why, ...(old.rationale || []).slice(1).filter(x => !/finisher/i.test(x))].slice(0, 7),
      plan: { ...old.plan, cardioFinisher: mins },
    };
    ctx.history[hi] = simulateDone(repl);
    out[out.indexOf(old)] = repl;
  }
}
const round5 = x => Math.round(x / 5) * 5;

// ---------------------------------------------------------------- weekly minimums top-up
// Session caps per muscle group (per-session returns flatten past ~8-10 sets). A priority group may
// go to 12 in one session, only when spreading across days can't close the gap.
const BIG_GROUPS = new Set(['chest', 'back', 'quads', 'hamstrings', 'glutes']);
const SMALL_GROUPS = new Set(['shoulders', 'biceps', 'triceps', 'forearms', 'calves', 'core']);
const sessionCap = g => (BIG_GROUPS.has(g) ? 10 : 8);
const PRIORITY_CAP = 12;
// Consecutive days (frequency meta-analyses, Schoenfeld, Ogborn & Krieger 2016/2019: similar growth
// at equated volume, so frequency is a tool to spread volume): small, fast-recovering groups may be
// trained on back-to-back days with ≤8 group-sets on each; big compound groups only with ≤4 on the
// second day. The recovery model (readiness) is checked as well.
const CONSEC_SMALL = 8, CONSEC_BIG_2ND = 4;
const MAX_SETS_PER_EX = 5;
// Credit of one set of `ex` for group g (max region weight in g), as recovery.sessionVolume counts it.
function groupW(ex, g) {
  let w = 0;
  for (const [r, x] of Object.entries(ex?.muscles || {})) if (REGIONS[r]?.group === g && x > w) w = x;
  return w;
}
function groupCredits(ex) {
  const out = {};
  for (const [r, x] of Object.entries(ex?.muscles || {})) { const g = REGIONS[r]?.group; if (g && x > (out[g] || 0)) out[g] = x; }
  return out;
}
const setsOf = b => Math.max(Number(b.target?.sets) || 0, (b.sets || []).length);
function plannedGroupVol(s, g) {
  let v = 0;
  for (const b of s.blocks || []) if (b.kind === 'lift') v += setsOf(b) * groupW(getEx(b.exId), g);
  return v;
}
function setSets(b, n) {
  b.target = { ...(b.target || {}), sets: n };
  const cur = b.sets || [];
  b.sets = n <= cur.length ? cur.slice(0, n) : [...cur, ...Array.from({ length: n - cur.length }, () => ({ w: null, r: null, done: false }))];
}
const ceilTo = est => { const t = Math.ceil(est / 5) * 5; return (t - est) / t > 0.1 ? Math.ceil(est) : t; };
// Mirrors recovery.js fatigueFrom (kept local so the planner can test "what if" volumes cheaply).
function fatigueOf(sets, hours, rh) {
  if (!(sets > 0)) return 0;
  const R = rh * clamp(0.4 + 0.6 * sets / 6, 0.4, 1.3);
  const t = clamp(hours / R, 0, 1);
  return clamp(sets / 6, 0.15, 1) * (1 - t * t * (3 - 2 * t));
}
const startMs = h => { const t = h.startedAt ? Date.parse(h.startedAt) : NaN; return Number.isFinite(t) ? t : parseDs(h.date).getTime() + 7 * 3600e3; };

const PUSH_PULL_TOL = 1.1;   // pull ≥ push within ±10% (practitioner heuristic for shoulder balance; audit §5)
const unitCap = (uid, raise) => (raise && VOLUME_UNITS[uid]?.tier === 'priority' ? PRIORITY_CAP : VOLUME_UNITS[uid]?.big ? 10 : 8);
function plannedUnitVol(s, uid) {
  let v = 0;
  for (const b of s.blocks || []) if (b.kind === 'lift') v += setsOf(b) * unitWeight(getEx(b.exId), uid);
  return v;
}
// Units credited by a session as if done (planned: every prescribed set; done: counted sets), classes
// once. §18: ONE counter for the whole app - recovery.unitVolume (the same one Body and the Why sheet
// read through recovery.unitSets).
function sessionUnits(s) { return unitVolume(s); }
// Weekly unit totals + push/pull sets over sessions in [ws, we] (planned ones from today on).
export function weekUnitTotals(sessions, ws, we, today = '') {
  return unitSets((sessions || []).filter(s => !(s && s.status === 'planned' && isRestPlan(s))),
    { from: ws, to: we, today, includePlanned: true });
}

// Tops up the week's enforcement units (VOLUME_UNITS): (1) every unit to its MIN, lengthening per
// volumePolicy (extend ≤ maxMinutes; fixed/ask stay in the slot), a priority unit may reach 12 sets in
// a session only if spreading can't do it; (2) pull ≥ push (±10%); (3) toward TARGET with spare time
// (or up to maxMinutes when volumePolicy.fillTargets === 'extend'), never past a unit's weekly max.
// Plain-English binding constraint for a target the planner couldn't reach.
export const TARGET_WHY_TEXT = {
  time: pol => `all lift days at ${pol.mode === 'extend' && pol.fillTargets === 'extend' ? pol.maxMinutes + '′' : 'their slot time'}`,
  policy: () => 'targets use spare time only',
  max: () => 'the only exercises left would push another muscle past its weekly max',
  recovery: () => 'recovery spacing between back-to-back days',
  session: () => 'per-session caps on every lift day',
  pushpull: () => 'keeping pull ≥ push',
  exercise: () => 'no suitable exercise at those locations',
  nolift: () => 'no lift day scheduled this week',
  rounds: () => 'room is left: re-plan the week to fill it',
  session_other: () => 'the exercises that would add it are at another muscle\u2019s per-session cap',
  // §26: the whole-workout working-set ceiling (x = { setCap, ceilDays, liftDays }).
  ceiling: (pol, x = {}) => `your ${x.setCap || 30}-set workout ceiling on every lift day`,
  ceiling_some: (pol, x = {}) => `your ${x.setCap || 30}-set workout ceiling on ${x.ceilDays && x.liftDays ? `${x.ceilDays} of ${x.liftDays}` : 'some'} lift days`,
};

function balanceVolume(ctx, out, ws, we, { convertFlex = true } = {}) {
  const pol = ctx.volumePolicy || volumePolicyOf(ctx.profile);
  const UT = unitTargets(ctx.profile);
  // §26: active issues rule exercises out of every top-up add and swap, like the user's avoid list.
  const avoid = new Set([...(ctx.profile?.avoidExercises || []), ...issueFilter(activeIssues(ctx.profile, ctx.today)).blocked]);
  const setCap = sessionSetCapOf(ctx.profile);
  const sculptGoals = ctx.profile?.sculptGoals || [];
  const eligible = s => s.date >= ws && s.date <= we && s.date >= ctx.today && s.plan?.auto !== false && s.plan?.kind === 'lift' && (s.blocks || []).some(b => b.kind === 'lift');
  const W = out.filter(eligible).map(s => ({ orig: s, s: clone(s), slot: Number(s.plan?.slot?.minutes) || Number(s.minutes) || 45, added: {}, changed: false, raised: new Set() }));
  const byId = new Map(W.map(w => [w.orig.id, w]));
  const extendLimit = w => (pol.mode === 'extend' ? Math.max(w.slot, pol.maxMinutes) : Math.max(w.slot, Number(w.s.minutes) || 0));
  for (const w of W) w.limit = extendLimit(w);
  const lo = ds(addDays(parseDs(ws), -3)), hi = ds(addDays(parseDs(we), 2));
  const near = ctx.history.filter(h => h.date >= lo && h.date <= hi);
  const volOf = (h, g) => { const w = byId.get(h.id); return w ? plannedGroupVol(w.s, g) : (vol(h).groups[g] || 0); };
  const dayVol = (date, g) => near.reduce((n, h) => n + (h.date === date ? volOf(h, g) : 0), 0);
  const dayPlanned = date => near.filter(h => h.date === date);
  const readinessAt = (g, date, id = null, extra = 0) => {
    const rh = GROUPS[g]?.recoveryHours || 48, T0 = noonOf(date).getTime();
    let f = 0;
    for (const h of near) {
      if (h.date >= date) continue;
      const hours = (T0 - startMs(h)) / 3600e3;
      if (hours > rh * 1.4 || hours < 0) continue;
      const sets = volOf(h, g) + (h.id === id ? extra : 0);
      if (sets > 0) f += fatigueOf(sets, hours, rh);
    }
    return 1 - clamp(f, 0, 1);
  };
  let raise = false;
  // Display-group spacing (recovery is modelled per group): small groups may go back-to-back at ≤8
  // group-sets a day, big groups only with ≤4 on the second day.
  // Display group per session: never past ~12 group-sets (Remmert/Pelland per-session ceiling); big
  // groups keep the back-to-back rule here (≤4 on the second day). Per-MUSCLE caps (8 small / 10 big,
  // 12 priority) and the small-muscle back-to-back allowance (≤8 each day) are checked per unit.
  const groupCapFor = (w, g) => {
    let cap = PRIORITY_CAP;
    const d = w.s.date, cur = plannedGroupVol(w.s, g);
    if (BIG_GROUPS.has(g)) {
      cap = raise ? PRIORITY_CAP : 10;
      const prev = dayVol(ds(addDays(parseDs(d), -1)), g), next = dayVol(ds(addDays(parseDs(d), 1)), g);
      if (prev >= 1.5) cap = Math.min(cap, CONSEC_BIG_2ND);
      if (next > CONSEC_BIG_2ND) cap = Math.min(cap, cur);
    }
    return cap;
  };
  const unitDayVol = (date, u) => near.reduce((n, h) => { if (h.date !== date) return n; const w = byId.get(h.id); return n + (w ? plannedUnitVol(w.s, u) : (sessionUnits(h).units[u] || 0)); }, 0);
  const unitCapFor = (w, u, raised) => {
    let cap = unitCap(u, raised);
    if (!VOLUME_UNITS[u]?.big) {
      const d = w.s.date;
      if (unitDayVol(ds(addDays(parseDs(d), -1)), u) >= 1.5 || unitDayVol(ds(addDays(parseDs(d), 1)), u) >= 1.5) cap = Math.min(cap, CONSEC_SMALL);
    }
    return cap;
  };
  // Why n more sets of ex can't go on day w ('' = allowed): 'session' (per-session cap / back-to-back
  // allowance), 'recovery' (readiness model), 'max' (a weekly max), 'pushpull'.
  const blockOf = (w, ex, n, uid, weekMaxCheck = true) => {
    for (const [g2, x] of Object.entries(groupCredits(ex))) {
      const add = n * x; if (!(add > 0)) continue;
      const nv = plannedGroupVol(w.s, g2) + add;
      // incidental credit (<0.5) may not push a group past its cap either (past 12 if the generator already did)
      const gcap = groupCapFor(w, g2);
      if (x >= 0.5 ? nv > gcap + 0.01 : nv > (nv - add > gcap ? PRIORITY_CAP : gcap) + 0.01) {
        const plain = BIG_GROUPS.has(g2) ? (raise ? PRIORITY_CAP : 10) : PRIORITY_CAP;
        if (nv <= plain + 0.01) return 'recovery';            // under the plain cap → the back-to-back spacing rule
        // A per-session ceiling, but say whose: the muscle being topped up, or a different one that the
        // only available exercises also load (so "per-session caps" never names a cap nothing has hit).
        return uid && uid !== '__pull' && VOLUME_UNITS[uid]?.group === g2 ? 'session' : 'session_other';
      }
      if (nv >= 4 && readinessAt(g2, w.s.date) < 0.4) return 'recovery';
      for (let k = 1; k <= 2; k++) {
        const nd = ds(addDays(parseDs(w.s.date), k));
        for (const h of dayPlanned(nd)) {
          const v = volOf(h, g2); if (!(v > 0)) continue;
          const need = (h.plan?.groups || []).includes(g2) ? 0.5 : v >= 4 ? 0.4 : 0;
          if (need && readinessAt(g2, nd, w.orig.id, add) < need) return 'recovery';
        }
      }
    }
    for (const [u2, x] of Object.entries(unitCredits(ex))) {
      if ((weekMaxCheck || u2 !== uid) && (tot.units[u2] || 0) + n * x > (UT[u2]?.max ?? 99) + 0.01) return 'max';   // any credit counts toward a max
      if (x >= 0.5 && plannedUnitVol(w.s, u2) + n * x > unitCapFor(w, u2, raise && u2 === uid) + 0.01) {
        if (unitCapFor(w, u2, raise && u2 === uid) < unitCap(u2, raise && u2 === uid)) return 'recovery';
        return u2 === uid ? 'session' : 'session_other';   // another muscle's session cap blocks this exercise
      }
    }
    // pull ≥ push: outside the minimums, never add a press/fly that tips the balance
    if (phase !== 'min' && PUSH_PATTERNS.has(ex.pattern) && tot.push + n > PUSH_PULL_TOL * tot.pull) return 'pushpull';
    return '';
  };
  const guardOK = (w, ex, n, uid, weekMaxCheck = true) => !blockOf(w, ex, n, uid, weekMaxCheck);
  const exCache = new Map();
  const choices = (w, uid) => {
    const k = w.s.location + '|' + uid;
    if (!exCache.has(k)) {
      const loc = locationFor(ctx.profile, w.s.location);
      const eq = expandEquipment(loc.equipment || []);
      const seen = new Map();
      const regs = uid === '__pull' ? ['lats', 'upper_back'] : VOLUME_UNITS[uid].regions;
      for (const r of regs) for (const e of exercisesFor(r, eq, { sculptGoals })) if (!seen.has(e.id)) seen.set(e.id, e);
      const list = [...seen.values()].filter(e => !avoid.has(e.id) && (uid === '__pull' ? PULL_PATTERNS.has(e.pattern) && unitWeight(e, 'back') >= 0.5 : unitWeight(e, uid) >= 0.5));
      exCache.set(k, list.slice(0, 24));
    }
    // Spill-aware order: credit to this unit + other under-target units, minus credit landing on units
    // already at/over target (chest fill → flat press when upper chest is met; back fill → overhand rows
    // when biceps are met; legs → leg extension/curl when glutes are met).
    return [...exCache.get(k)].sort((a, b) => spillValue(b, uid) - spillValue(a, uid) || (unitWeight(b, uid) >= 0.8) - (unitWeight(a, uid) >= 0.8));
  };
  const SPILL_PENALTY = 1.5;
  const spillValue = (ex, uid) => {
    let v = uid === '__pull' ? (PULL_PATTERNS.has(ex.pattern) ? 1 : 0) : unitWeight(ex, uid);
    for (const [u2, c] of Object.entries(unitCredits(ex))) {
      if (u2 === uid || !(UT[u2]?.target > 0)) continue;
      v += (tot.units[u2] || 0) >= UT[u2].target - 0.25 ? -SPILL_PENALTY * c : 0.5 * c;
    }
    return v;
  };
  let tot = weekUnitTotals(ctx.history, ws, we);
  const recount = () => {
    const sess = ctx.history.map(h => { const w = byId.get(h.id); return w ? { ...w.s, status: 'planned' } : h; });
    tot = weekUnitTotals(sess, ws, we);
  };
  recount();
  // incremental week totals after adding n sets of ex (same credit rules as weekUnitTotals)
  const bump = (ex, n) => {
    for (const [u, w] of Object.entries(unitCredits(ex))) tot.units[u] = (tot.units[u] || 0) + n * w;
    if (PUSH_PATTERNS.has(ex.pattern)) tot.push += n; else if (PULL_PATTERNS.has(ex.pattern)) tot.pull += n;
  };
  // Per-session ceiling: trim any group past ~12 sets in one session (diminishing per-session returns,
  // Remmert/Pelland 2025) from the highest-credit exercise, keeping ≥2 sets and every unit floor.
  for (const w of W) {
    for (let guard = 30; guard-- > 0;) {
      const over = GROUP_ORDER.find(g => plannedGroupVol(w.s, g) > PRIORITY_CAP + 0.01);
      if (!over) break;
      const idx = (w.s.blocks || []).map((b, i) => ({ b, i, ex: b.kind === 'lift' ? getEx(b.exId) : null }))
        .filter(x => x.ex && groupW(x.ex, over) > 0 && setsOf(x.b) > 2 && !Object.entries(unitCredits(x.ex)).some(([u, c]) => UT[u]?.min > 0 && (tot.units[u] || 0) - c < UT[u].min - 0.25))
        .sort((a, b) => groupW(b.ex, over) - groupW(a.ex, over) || setsOf(b.b) - setsOf(a.b))[0];
      if (!idx) break;
      w.s.blocks = w.s.blocks.map((x, j) => (j === idx.i ? clone(x) : x)); setSets(w.s.blocks[idx.i], setsOf(idx.b) - 1);
      bump(idx.ex, -1); w.changed = true; w.added.trim = (w.added.trim || 0) - 1;
    }
  }
  let phase = 'min';
  const goalOf = uid => (phase === 'target' ? UT[uid].target : UT[uid].min);
  const deficit = uid => (uid === '__pull' ? tot.push / PUSH_PULL_TOL - tot.pull : goalOf(uid) - (tot.units[uid] || 0));
  const credit = (ex, uid) => (uid === '__pull' ? (PULL_PATTERNS.has(ex.pattern) ? 1 : 0) : unitWeight(ex, uid));
  // One step for a unit: the best single change across all days (lowest volume of it first = spread,
  // non-consecutive days preferred, extra sets on an existing exercise before a new exercise).
  const why = {};   // uid → { [date]: reason } from the last failed attempt
  const step = (uid, dry = false) => {
    let best = null;
    const reasons = {};
    for (const w of W) {
      const d = w.s.date;
      const g = uid === '__pull' ? 'back' : VOLUME_UNITS[uid].group;
      const cur = uid === '__pull' ? plannedGroupVol(w.s, 'back') : plannedUnitVol(w.s, uid);
      const consec = dayVol(ds(addDays(parseDs(d), -1)), g) >= 1.5 || dayVol(ds(addDays(parseDs(d), 1)), g) >= 1.5;
      const est = estimateMinutes(w.s.blocks);
      const lim = phase === 'target' ? w.limitT : w.limit;
      const base = cur + (consec ? 3 : 0) - (lim - est) / 40;
      const blocks = (w.s.blocks || []).map((b, i) => ({ b, i, ex: b.kind === 'lift' ? getEx(b.exId) : null }))
        .filter(x => x.ex && credit(x.ex, uid) >= 0.5 && setsOf(x.b) < MAX_SETS_PER_EX).sort((a, b) => spillValue(b.ex, uid) - spillValue(a.ex, uid) || setsOf(a.b) - setsOf(b.b));
      let found = null, dayWhy = '';
      // The FIRST blocker wins: the candidates are already sorted best-first, so the reason that
      // stopped the best option is the honest reason. `timeOnly` records that some candidate was legal
      // in every other respect and only did not fit the minutes - then lengthening the day WOULD help,
      // so 'time' is the answer whatever a later, worse candidate ran into. (Before, note() treated
      // 'time' as the weakest reason and let any later cap overwrite it, so a day that was simply out
      // of minutes reported "per-session caps on every lift day".)
      let timeOnly = false, timeHit = false;
      // §26: the workout set ceiling. `ceilOnly` = some candidate was legal in every other respect and
      // only the ceiling kept it out, so raising the ceiling WOULD help (the 'time' logic, for sets).
      const daySets = workingSets(w.s);
      let ceilOnly = false;
      // 'time' never occupies dayWhy, so a real blocker on a later candidate is still recorded.
      const note = r => { if (r === 'time') { timeHit = true; return; } if (!dayWhy) dayWhy = r; };
      // The cheap minute check stays first (blockOf walks days and readiness); when it is the thing in
      // the way we confirm ONCE per day, with blockOf, that the set would otherwise have been legal.
      for (const x of blocks) {
        if (daySets + 1 > setCap) {
          if (!ceilOnly && !blockOf(w, x.ex, 1, uid, phase !== 'min' || uid === '__pull')) ceilOnly = true;
          continue;
        }
        const trial = w.s.blocks.map((b, i) => (i === x.i ? clone(b) : b));
        setSets(trial[x.i], setsOf(x.b) + 1);
        if (estimateMinutes(trial) > lim) {
          note('time');
          if (!timeOnly && !blockOf(w, x.ex, 1, uid, phase !== 'min' || uid === '__pull')) timeOnly = true;
          continue;
        }
        const r = blockOf(w, x.ex, 1, uid, phase !== 'min' || uid === '__pull');
        if (r) { note(r); continue; }
        found = { w, score: base, apply: () => { w.s.blocks = trial; bump(x.ex, 1); return credit(x.ex, uid); } };
        break;
      }
      if (!found) {
        const have = new Set((w.s.blocks || []).map(b => b.exId).filter(Boolean));
        for (const e of choices(w, uid)) {
          if (have.has(e.id)) continue;
          const r = blockOf(w, e, 2, uid, phase !== 'min' || uid === '__pull');
          if (r) { note(r); continue; }
          if (daySets + 2 > setCap) { ceilOnly = true; continue; }   // legal but for the ceiling
          const ns = addExercise(w.s, e.id, { sessions: ctx.history, now: noonOf(d) });
          const nb = ns.blocks.find(b => b.exId === e.id); if (!nb) continue;
          setSets(nb, 2);
          if (estimateMinutes(ns.blocks) > lim) { timeOnly = true; note('time'); continue; }   // legal but for the clock
          found = { w, score: base + 1.5, apply: () => { w.s = { ...w.s, blocks: ns.blocks }; bump(e, 2); return 2 * credit(e, uid); } };
          break;
        }
      }
      // Reason priority, so each one is true of this day:
      //  1. this muscle is at its own per-session ceiling → 'session' (more minutes cannot help it);
      //  2. the day is at its time limit → 'time' (that is the constraint the user can lift);
      //  3. some candidate was legal and only did not fit → 'time';
      //  4. otherwise the first real blocker (recovery / weekly max / pull ≥ push / another muscle's cap).
      // The PLAIN per-session cap, not the reduced back-to-back allowance: when spacing is what holds
      // the muscle back, blockOf already reports 'recovery' and that is the honest reason.
      const atCap = uid !== '__pull' && cur + 0.5 > unitCap(uid, raise) + 0.01;
      // §26: the day is at the workout set ceiling (nothing can be added at all), or something legal was
      // kept out only by it → 'ceiling', ahead of time: more minutes cannot help a day at its ceiling.
      const atCeil = daySets + 1 > setCap || ceilOnly;
      if (!found) reasons[d] = atCap ? 'session' : atCeil ? 'ceiling' : (est >= lim - 2 || timeOnly) ? 'time' : (dayWhy || (timeHit ? 'time' : 'exercise'));
      if (found && (!best || found.score < best.score)) best = found;
    }
    if (dry) { why[uid] = reasons; return !!best; }
    if (!best) {
      why[uid] = reasons;
      // A press blocked only by pull ≥ push: add a pull set first (if legal), then the press fits next round.
      if (uid !== '__pull' && phase === 'target' && Object.values(reasons).includes('pushpull') && step('__pull')) return true;
      return false;
    }
    const got = best.apply();
    const key = uid === '__pull' ? 'pull' : uid;
    best.w.added[key] = (best.w.added[key] || 0) + got; best.w.changed = true;
    if (uid !== '__pull' && (raise || plannedUnitVol(best.w.s, uid) > unitCap(uid, false) + 0.01)) best.w.raised.add(uid);   // priority cap (12) used
    return true;
  };
  const enforced = () => UNIT_ORDER.filter(u => UT[u] && (phase === 'target' ? UT[u].target : UT[u].min) > 0);
  const shortList = () => enforced().filter(u => deficit(u) > 0.25)
    .sort((a, b) => (UT[b].tier === 'priority') - (UT[a].tier === 'priority') || deficit(b) / Math.max(1, goalOf(b)) - deficit(a) / Math.max(1, goalOf(a)));
  const runPhase = units => { let guard = 500; for (let more = true; more && guard-- > 0;) { more = false; for (const u of units()) if (step(u)) more = true; } };
  phase = 'min'; raise = false; runPhase(shortList);
  if (shortList().length) { raise = true; runPhase(shortList); raise = false; }
  const minShort = shortList().map(u => ({ unit: u, short: r1(deficit(u)) }));
  phase = 'pull'; if (deficit('__pull') > 0.5) runPhase(() => (deficit('__pull') > 0.5 ? ['__pull'] : []));
  // Still pushing more than pulling: trim press/fly sets that sit above every floor they feed
  // (flies first, then presses; each exercise keeps ≥2 sets).
  if (deficit('__pull') > 0.5) {
    const rank = p => (p === 'fly' ? 0 : p === 'horizontal_push' ? 1 : 2);
    const cands = [];
    for (const w of W) (w.s.blocks || []).forEach((b, i) => { const ex = b.kind === 'lift' ? getEx(b.exId) : null; if (ex && PUSH_PATTERNS.has(ex.pattern)) cands.push({ w, i, ex }); });
    cands.sort((a, b) => rank(a.ex.pattern) - rank(b.ex.pattern) || setsOf(b.w.s.blocks[b.i]) - setsOf(a.w.s.blocks[a.i]));
    const floorsHold = (ex, n) => !Object.entries(unitCredits(ex)).some(([u, x]) => UT[u]?.min > 0 && (tot.units[u] || 0) - n * x < UT[u].min - 0.25);
    for (let more = true; more && deficit('__pull') > 0.5;) {
      more = false;
      for (const c of cands) {
        if (deficit('__pull') <= 0.5) break;
        const b = c.w.s.blocks[c.i]; if (!b || b.exId !== c.ex.id) continue;
        if (setsOf(b) <= 2) continue;
        if (!floorsHold(c.ex, 1)) continue;
        c.w.s.blocks = c.w.s.blocks.map((x, j) => (j === c.i ? clone(x) : x)); setSets(c.w.s.blocks[c.i], setsOf(b) - 1);
        bump(c.ex, -1);
        c.w.added.push_trim = (c.w.added.push_trim || 0) - 1; c.w.changed = more = true;
      }
      if (more || deficit('__pull') <= 0.5) continue;
      // Every press/fly is already down to its 2-set minimum: drop one whole push ISOLATION (flies
      // first, by the sort order) when every floor still holds and the day keeps 3+ lift exercises.
      // Without this the week can sit stuck above the pull >= push tolerance with nothing to trim.
      for (const c of cands) {
        const b = c.w.s.blocks[c.i];
        if (!b || b.exId !== c.ex.id || c.ex.category === 'compound') continue;
        const n = setsOf(b);
        if (!floorsHold(c.ex, n) || c.w.s.blocks.filter(y => y.kind === 'lift').length <= 2) continue;
        c.w.s.blocks = c.w.s.blocks.filter((_, j) => j !== c.i);
        bump(c.ex, -n);
        c.w.added.push_trim = (c.w.added.push_trim || 0) - n; c.w.changed = more = true;
        break;
      }
    }
  }
  // Targets: spare time inside the (possibly already lengthened) session, or up to the cap with consent.
  const fillExtend = pol.mode === 'extend' && pol.fillTargets === 'extend';
  for (const w of W) w.limitT = fillExtend ? w.limit : Math.max(w.slot, Math.min(w.limit, ceilTo(estimateMinutes(w.s.blocks))));
  phase = 'target'; runPhase(shortList);
  if (shortList().length) { raise = true; runPhase(shortList); raise = false; }   // priority muscles may reach 12 in a session
  // TARGET BAND (target ≤ planned ≤ target + 1 for every counted muscle, when legal): trim sets aimed at
  // an over-target muscle (isolations first: curls when rows already cover biceps; an isolation may be
  // dropped), else swap the contributing exercise for one that loads it less (incline → flat press when
  // upper chest is met), then refill targets with spill-aware choices. Never takes another muscle below
  // its target (or floor), past a max, or breaks pull ≥ push; swaps are recovery-neutral.
  const overT = () => UNIT_ORDER.filter(u => UT[u].target > 0 && (tot.units[u] || 0) > UT[u].target + 1);
  // Other muscles keep their level (or target); an incidental credit (<0.5) may dip up to one set below
  // target, because the refill below tops it back up with a better-aimed exercise (e.g. leg curl).
  const othersOK = (ex, n, skip) => Object.entries(unitCredits(ex)).every(([v, c]) => v === skip || !(c > 0)
    || ((tot.units[v] || 0) - n * c >= Math.min(tot.units[v] || 0, UT[v]?.target ?? 0) - (c < 0.5 ? 1 : 0.01) && (tot.units[v] || 0) - n * c >= (UT[v]?.min ?? 0) - 0.25));
  const pullOK = (ex, n) => !(PULL_PATTERNS.has(ex.pattern) && tot.pull - n < tot.push / PUSH_PULL_TOL - 0.5);
  const contributors = u => {
    const cs = [];
    for (const w of W) (w.s.blocks || []).forEach((b, i) => { const ex = b.kind === 'lift' ? getEx(b.exId) : null; const c = ex ? unitWeight(ex, u) : 0; if (c >= 0.5) cs.push({ w, i, ex, c, iso: ex.category !== 'compound' }); });
    return cs;
  };
  const trimOne = u => {
    const cs = contributors(u).sort((a, b) => (b.iso - a.iso) || b.c - a.c || setsOf(b.w.s.blocks[b.i]) - setsOf(a.w.s.blocks[a.i]));
    for (const x of cs) {
      const n = setsOf(x.w.s.blocks[x.i]);
      if (n > 2 && othersOK(x.ex, 1, u) && pullOK(x.ex, 1)) {
        x.w.s.blocks = x.w.s.blocks.map((y, j) => (j === x.i ? clone(y) : y)); setSets(x.w.s.blocks[x.i], n - 1);
        bump(x.ex, -1); x.w.added.target_trim = (x.w.added.target_trim || 0) - 1; x.w.changed = true; return true;
      }
      if (x.iso && x.c >= 0.8 && othersOK(x.ex, n, u) && pullOK(x.ex, n) && x.w.s.blocks.filter(y => y.kind === 'lift').length > 2) {
        x.w.s.blocks = x.w.s.blocks.filter((_, j) => j !== x.i);
        bump(x.ex, -n); x.w.added.target_trim = (x.w.added.target_trim || 0) - n; x.w.changed = true; return true;
      }
    }
    return false;
  };
  const swapOne = u => {
    const cs = contributors(u).sort((a, b) => b.c * setsOf(b.w.s.blocks[b.i]) - a.c * setsOf(a.w.s.blocks[a.i]));
    for (const x of cs) {
      const n = setsOf(x.w.s.blocks[x.i]);
      const loc = locationFor(ctx.profile, x.w.s.location);
      const before = unitCredits(x.ex), gb = groupCredits(x.ex);
      const alt = alternatives(x.ex.id, { equipment: expandEquipment(loc.equipment || []), exclude: (x.w.s.blocks || []).map(y => y.exId).filter(Boolean), limit: 16 })
        .filter(e => !avoid.has(e.id) && unitWeight(e, u) <= x.c - 0.4)
        .find(e => {
          const after = unitCredits(e), ga = groupCredits(e);
          if (Object.entries(ga).some(([g, c]) => c > (gb[g] || 0) + 0.01)) return false;   // recovery-neutral
          if (PUSH_PATTERNS.has(e.pattern) && !PUSH_PATTERNS.has(x.ex.pattern) && tot.push + n > PUSH_PULL_TOL * tot.pull) return false;
          if (PULL_PATTERNS.has(x.ex.pattern) && !PULL_PATTERNS.has(e.pattern) && tot.pull - n < tot.push / PUSH_PULL_TOL - 0.5) return false;
          return Object.keys({ ...before, ...after }).every(v => {
            if (v === u) return true;
            const cur = tot.units[v] || 0, nxt = cur - n * (before[v] || 0) + n * (after[v] || 0);
            return nxt <= (UT[v]?.max ?? 99) + 0.01 && (nxt >= cur - 0.01 || nxt >= (UT[v]?.target ?? 0) - 0.25) && nxt >= (UT[v]?.min ?? 0) - 0.25
              && (nxt <= cur + 0.01 || !(UT[v]?.target > 0) || nxt <= Math.max(cur, UT[v].target + 1) + 0.01);   // no new overshoot elsewhere
          });
        });
      if (!alt) continue;
      const ns = swapBlock(x.w.s, x.i, alt.id, { sessions: ctx.history, now: noonOf(x.w.s.date) });
      if (estimateMinutes(ns.blocks) > x.w.limitT + 1) continue;
      bump(x.ex, -n); bump(alt, setsOf(ns.blocks[x.i]));
      x.w.s = { ...x.w.s, blocks: ns.blocks }; x.w.added.incidental_swap = (x.w.added.incidental_swap || 0) + 1; x.w.changed = true;
      return true;
    }
    return false;
  };
  for (let round = 0; round < 4; round++) {
    const stuckT = new Set();
    let changed = false;
    for (let guard = 150; guard-- > 0;) {
      const u = overT().find(x => !stuckT.has(x)); if (!u) break;
      if (trimOne(u) || swapOne(u)) changed = true; else stuckT.add(u);
    }
    const snap = JSON.stringify(tot.units);
    if (shortList().length) runPhase(shortList);   // trims/swaps can open room (and the refill avoids spill)
    if (!changed && JSON.stringify(tot.units) === snap) break;
  }
  // Why a muscle still sits more than 1.5 sets over its target (recorded so the summary can say so).
  const overWhyOf = () => {
    const ow = {};
    for (const u of UNIT_ORDER) {
      if (!(UT[u].target > 0) || (tot.units[u] || 0) <= UT[u].target + 1.5) continue;
      const cs = contributors(u);
      const pullBound = cs.some(x => PULL_PATTERNS.has(x.ex.pattern)) && tot.pull <= tot.push / PUSH_PULL_TOL + 1;
      const shared = [...new Set(cs.flatMap(x => Object.entries(unitCredits(x.ex)).filter(([v, c]) => v !== u && c > 0 && UT[v]?.target > 0 && (tot.units[v] || 0) <= UT[v].target + 0.75).map(([v]) => v)))];
      ow[u] = pullBound ? { why: 'pushpull' } : shared.length ? { why: 'shared', with: shared.slice(0, 3) } : { why: 'floor' };
    }
    return ow;
  };
  const targetWhy = {};
  phase = 'min';
  // NEVER OVERDO: no unit past its weekly max (fractional credit, incl. done sessions). Trim the
  // exercises contributing most (isolations for that muscle first, then compounds; each keeps ≥2 sets,
  // an isolation may be dropped), then swap a compound for an alternative that loads it less, never
  // taking another unit under its min or breaking pull ≥ push.
  const keepsFloors = (ex, n = 1) => !Object.entries(unitCredits(ex)).some(([u, c]) => UT[u]?.min > 0 && (tot.units[u] || 0) - n * c < UT[u].min - 0.25)
    && !(PULL_PATTERNS.has(ex.pattern) && tot.pull - n < tot.push / PUSH_PULL_TOL - 0.5);
  const overList = () => UNIT_ORDER.filter(u => (tot.units[u] || 0) > UT[u].max + 0.05);
  const stuck = new Set();
  // one press/fly set above every floor, flies first (frees pull sets for trimming without breaking pull ≥ push)
  const trimPush = () => {
    const ps = [];
    for (const w of W) (w.s.blocks || []).forEach((b, i) => { const ex = b.kind === 'lift' ? getEx(b.exId) : null; if (ex && PUSH_PATTERNS.has(ex.pattern) && setsOf(b) > 2 && keepsFloors(ex)) ps.push({ w, i, ex }); });
    ps.sort((a, b) => (a.ex.pattern === 'fly' ? 0 : 1) - (b.ex.pattern === 'fly' ? 0 : 1) || setsOf(b.w.s.blocks[b.i]) - setsOf(a.w.s.blocks[a.i]));
    const x = ps[0]; if (!x) return false;
    x.w.s.blocks = x.w.s.blocks.map((y, j) => (j === x.i ? clone(y) : y)); setSets(x.w.s.blocks[x.i], setsOf(x.w.s.blocks[x.i]) - 1);
    bump(x.ex, -1); x.w.added.max_trim = (x.w.added.max_trim || 0) - 1; x.w.changed = true;
    return true;
  };
  for (let guard = 300; guard-- > 0;) {
    const u = overList().find(x => !stuck.has(x)); if (!u) break;
    const cands = [];
    for (const w of W) (w.s.blocks || []).forEach((b, i) => { const ex = b.kind === 'lift' ? getEx(b.exId) : null; const c = ex ? unitWeight(ex, u) : 0; if (c > 0) cands.push({ w, i, ex, c, iso: ex.category !== 'compound' }); });
    cands.sort((a, b) => (b.iso - a.iso) || b.c - a.c || setsOf(b.w.s.blocks[b.i]) - setsOf(a.w.s.blocks[a.i]));
    let done = false;
    for (const x of cands) {
      const b = x.w.s.blocks[x.i]; const n = setsOf(b);
      if (n > 2 && keepsFloors(x.ex)) {
        x.w.s.blocks = x.w.s.blocks.map((y, j) => (j === x.i ? clone(y) : y)); setSets(x.w.s.blocks[x.i], n - 1);
        bump(x.ex, -1); x.w.added.max_trim = (x.w.added.max_trim || 0) - 1; x.w.changed = done = true; break;
      }
      // drop a whole exercise aimed at this muscle (isolations first by sort order) if floors hold
      if (x.c >= 0.8 && keepsFloors(x.ex, n) && x.w.s.blocks.filter(y => y.kind === 'lift').length > 2) {
        x.w.s.blocks = x.w.s.blocks.filter((_, j) => j !== x.i);
        bump(x.ex, -n); x.w.added.max_trim = (x.w.added.max_trim || 0) - n; x.w.changed = done = true; break;
      }
    }
    if (!done) {   // swap a compound for an alternative that loads u less, keeping the other floors
      for (const x of cands.filter(c => !c.iso)) {
        const b = x.w.s.blocks[x.i]; const n = setsOf(b);
        const loc = locationFor(ctx.profile, x.w.s.location);
        const alt = alternatives(x.ex.id, { equipment: expandEquipment(loc.equipment || []), exclude: (x.w.s.blocks || []).map(y => y.exId).filter(Boolean) })
          .filter(e => unitWeight(e, u) < x.c - 0.2 && !avoid.has(e.id))
          .find(e => { const before = unitCredits(x.ex), after = unitCredits(e);
            return Object.keys({ ...before, ...after }).every(v => !(UT[v]?.min > 0) || (tot.units[v] || 0) - n * (before[v] || 0) + n * (after[v] || 0) >= UT[v].min - 0.25)
              && (tot.units[u] || 0) - n * x.c + n * unitWeight(e, u) < (tot.units[u] || 0); });
        if (!alt) continue;
        const ns = swapBlock(x.w.s, x.i, alt.id, { sessions: ctx.history, now: noonOf(x.w.s.date) });
        bump(x.ex, -n); bump(alt, setsOf(ns.blocks[x.i]));
        x.w.s = { ...x.w.s, blocks: ns.blocks }; x.w.added.max_swap = (x.w.added.max_swap || 0) + 1; x.w.changed = done = true; break;
      }
    }
    if (!done && cands.some(c => PULL_PATTERNS.has(c.ex.pattern) && setsOf(c.w.s.blocks[c.i]) > 2) && trimPush()) continue;
    if (!done) stuck.add(u);   // can't trim without breaking a floor or pull ≥ push: the summary warns
  }
  const overWhy = overWhyOf();
  // Why each target is still short (binding constraint), from one more probing attempt after every pass.
  phase = 'target';
  if (shortList().length) runPhase(shortList);   // the max pass may have freed room
  for (const u of shortList()) {
    // No lift day in the week at all: say that, instead of blaming a per-session cap that no session has.
    if (!W.length) { targetWhy[u] = 'nolift'; continue; }
    if (step(u, true)) { targetWhy[u] = 'rounds'; continue; }   // (dry run never mutates) one more set was legal
    const rs = Object.values(why[u] || {});
    const cnt = {}; rs.forEach(r => { cnt[r] = (cnt[r] || 0) + 1; });
    const caps = rs.filter(r => r === 'session' || r === 'session_other').length;
    // Every day out of minutes → time (or policy, when targets may not lengthen a day). Otherwise the
    // most common real blocker; 'time' only wins when it is the only thing in the way everywhere.
    // 'session' says "per-session caps on EVERY lift day", so it is only claimed when a per-session
    // cap really is in the way on every one of them and this muscle is at its own cap on at least one;
    // a partial story is reported as 'session_other' instead.
    let w0 = !rs.length ? 'exercise'
      : rs.every(r => r === 'time') ? (fillExtend ? 'time' : 'policy')
        : Object.entries(cnt).filter(([r]) => r !== 'time').sort((x, y) => y[1] - x[1])[0][0];
    if (w0 === 'session' && !(caps === rs.length && rs.length === W.length)) w0 = 'session_other';
    // §26: "the ceiling on every lift day" only when it is in the way on every one of them.
    if (w0 === 'ceiling' && !((cnt.ceiling || 0) === rs.length && rs.length === W.length)) w0 = 'ceiling_some';
    targetWhy[u] = w0;
  }
  phase = 'min';
  // Commit working copies.
  for (const w of W) {
    if (!w.changed) {   // still carry the week's target notes (binding reasons) for the summary
      if (Object.keys(targetWhy).length || Object.keys(overWhy).length) { const repl = { ...w.orig, plan: { ...w.orig.plan, targetWhy: { ...targetWhy }, overWhy: { ...overWhy } } }; out[out.indexOf(w.orig)] = repl; const hix = ctx.history.findIndex(h => h.id === w.orig.id); if (hix >= 0) ctx.history[hix] = simulateDone(repl); w.orig = repl; }
      continue;
    }
    const est = estimateMinutes(w.s.blocks);
    const nm = k => (k === 'pull' ? 'pulling' : (VOLUME_UNITS[k]?.name || k).toLowerCase());
    const parts = Object.entries(w.added).filter(([k, v]) => v >= 0.5 && VOLUME_UNITS[k] || (k === 'pull' && v >= 0.5)).map(([k, v]) => `${nm(k)} +${fmt(v)}`);
    if (w.added.push_trim) parts.push(`${-w.added.push_trim} fewer press/fly sets (pull ≥ push)`);
    if (w.added.trim) parts.push(`${-w.added.trim} fewer sets (max ~12 per muscle per session)`);
    if (w.added.max_trim) parts.push(`${-w.added.max_trim} fewer sets (weekly max)`);
    if (w.added.max_swap) parts.push(`${w.added.max_swap} exercise swapped to stay under a weekly max`);
    if (w.added.target_trim) parts.push(`${-w.added.target_trim} fewer sets where a muscle was over its target`);
    if (w.added.incidental_swap) parts.push(`${w.added.incidental_swap} exercise swapped for one with less incidental credit`);
    const repl = { ...w.s, estMinutes: est, plan: { ...w.s.plan, topUp: Object.fromEntries(Object.entries(w.added).map(([k, v]) => [k, r1(v)])), targetWhy: { ...targetWhy }, overWhy: { ...overWhy } } };
    if (w.raised.size) repl.plan.topUp.raisedCap = [...w.raised];
    const raisedTxt = w.raised.size ? ` (${[...w.raised].map(nm).join(', ')} up to ${PRIORITY_CAP} sets this session: priority)` : '';
    if (est > w.slot + 1) {
      const to = Math.min(w.limit, ceilTo(est));
      repl.minutes = to;
      repl.plan.extended = { from: w.slot, to, reason: `weekly set targets: ${parts.join(', ')}` };
      repl.rationale = [repl.rationale?.[0], `Extended ${w.slot}→${to} min for your weekly set targets (${parts.join(', ')})${raisedTxt}`, ...(repl.rationale || []).slice(1)].filter(Boolean).slice(0, 8);
    } else if (parts.length) {
      repl.rationale = [...(repl.rationale || []), `Extra sets toward your weekly minimums and targets: ${parts.join(', ')}${raisedTxt}`].slice(0, 8);
    }
    const hix = ctx.history.findIndex(h => h.id === w.orig.id);
    if (hix >= 0) ctx.history[hix] = simulateDone(repl);
    out[out.indexOf(w.orig)] = repl;
    w.orig = repl;
  }
  // Minimums still short and allowed to lengthen: turn a non-lift flex day into a lift day (its
  // cardio becomes a finisher when there's room), redo the cardio pass, then top up again.
  if (convertFlex && pol.mode === 'extend' && minShort.length) {
    const flex = out.find(s => s.date >= ws && s.date <= we && s.date >= ctx.today && s.plan?.auto !== false && s.plan?.slot?.kind === 'flex' && s.plan?.kind !== 'lift');
    if (flex) {
      const slot = { ...flex.plan.slot, kind: 'lift' };
      const hix = ctx.history.findIndex(h => h.id === flex.id);
      if (hix >= 0) ctx.history.splice(hix, 1);
      const st = weekState(ctx, flex.date);
      const R = rng(hashStr(flex.date + '|flex-lift|' + ctx.seed));
      const s = liftDay(ctx, flex.date, slot, st, R, `Flex day → lift: weekly minimums still short (${minShort.slice(0, 3).map(x => VOLUME_UNITS[x.unit].name.toLowerCase()).join(', ')})`);
      s.plan.slot = { ...flex.plan.slot };
      s.plan.convertedFrom = flex.plan.kind;
      s.rationale.unshift(`Was a ${flex.plan.kind} day; the weekly minimums need it, so the flex slot lifts${(s.blocks || []).some(b => b.kind === 'cardio') ? ' with an easy cardio finisher' : ''}`);
      out[out.indexOf(flex)] = s;
      ctx.history.push(simulateDone(s));
      balanceCardio(ctx, out, ws, we, ctx.rangeEnd && ctx.rangeEnd < we ? ctx.rangeEnd : we);
      return balanceVolume(ctx, out, ws, we, { convertFlex: false });
    }
  }
  return minShort;
}

function seedHistory(ctx, sessions, from, keep) {
  for (const s of sessions || []) {
    if (!s || !s.date) continue;
    if (s.status !== 'planned') {
      ctx.history.push(s);
      if (s.date >= ctx.today && hasWork(s)) ctx.doneDates.add(s.date);
      continue;
    }
    if (s.date < ctx.today) continue;                 // missed plan
    const kept = s.date < from || safeKeep(keep, s);
    if (!kept) continue;
    if (s.date >= from) ctx.keptDates.add(s.date);
    if (!isRestPlan(s)) ctx.history.push(simulateDone(s));
  }
}
function safeKeep(keep, s) { try { return !!keep(s); } catch { return false; } }
function hasWork(s) { const v = vol(s); return v.liftSets > 0 || v.cardioMin > 0 || Object.keys(v.regions).length > 0; }

// ---------------------------------------------------------------- planRange
export function planRange({ from, days = 7, profile, sessions = [], schedule, classSchedule = null,
  keep = s => s.plan && !s.plan.auto, now = new Date(), seed, volumePolicy = null, topUp = true } = {}) {
  now = toDate(now);
  profile = profile || {};
  schedule = schedule || profile.schedule || {};
  const fromDs = toDs(from) || ds(now);
  const ctx = makeCtx({ profile, sessions, schedule, classSchedule, now, seed });
  if (volumePolicy) ctx.volumePolicy = { ...volumePolicyOf(profile), ...volumePolicy };
  seedHistory(ctx, sessions, fromDs, keep);
  ctx.firstDate = fromDs < ctx.today ? ctx.today : fromDs;
  const out = [];
  const n = clamp(Math.round(Number(days) || 7), 1, 120);
  const start = parseDs(fromDs);
  ctx.rangeEnd = ds(addDays(start, n - 1));
  for (let i = 0; i < n; i++) {
    const date = ds(addDays(start, i));
    const isLast = i === n - 1 || parseDs(date).getDay() === 0;
    if (date >= ctx.today && !ctx.keptDates.has(date) && !ctx.doneDates.has(date)) {
      const slot = slotFor(schedule, date);
      if (slot.kind !== 'rest' && slot.minutes >= 10) {
        const s = planDay(ctx, date, slot);
        out.push(s);
        ctx.history.push(simulateDone(s));
      }
    }
    if (isLast) { const { ws, we } = weekBounds(date); if (topUp) { balanceCardio(ctx, out, ws, we, date); balanceWeek(ctx, out, ws, we); balanceVolume(ctx, out, ws, we); } }
  }
  return out;
}

// ---------------------------------------------------------------- suggestForDay
export function suggestForDay(date, { profile, sessions = [], schedule, classSchedule = null, now = new Date(), seed, slot } = {}) {
  now = toDate(now);
  profile = profile || {};
  schedule = schedule || profile.schedule || {};
  date = toDs(date) || ds(now);
  const day = slotFor(schedule, date);
  const sl = slot ? { kind: slot.kind || 'lift', minutes: Number(slot.minutes) || profile.defaultMinutes || 45, location: slot.location || profile.currentLocation || 'home', ...((slot.style || day.style) ? { style: slot.style || day.style } : {}) } : day;
  if (sl.kind === 'rest' || sl.minutes < 10) return null;
  const ctx = makeCtx({ profile, sessions, schedule, classSchedule, now, seed });
  // Planned days before AND after `date` are context (simulated as done); planned sessions on
  // `date` itself are what we're replacing. Done/active work on `date` still counts.
  const others = (sessions || []).filter(s => s && !(s.status === 'planned' && s.date === date));
  seedHistory(ctx, others, date, () => true);
  return planDay(ctx, date, sl);
}

// ---------------------------------------------------------------- explainWeek (debug / "Why these numbers?")
// The sliders → targets → plan chain per muscle for one week: { [unit]: { name, base, slider, extra, target,
// min, max, planned, status, reason } }. status: under (< min) | toward | ok (target…max) | over (> max).
export function explainWeek(sessions, { weekStart, profile, now = new Date() } = {}) {
  const sum = weekPlanSummary(sessions, { weekStart, profile, now });
  const out = {};
  for (const [u, x] of Object.entries(sum.units || {})) {
    const sh = (sum.targets?.short || []).find(y => y.unit === u);
    out[u] = { name: x.name, base: x.base, slider: x.slider, extra: x.extra, target: x.target, min: x.min, max: x.max, planned: x.total, status: x.status,
      reason: x.status === 'over' ? 'over the weekly max' : x.overText ? `above target: ${x.overText}` : x.status === 'ok' ? (x.target > 0 ? 'on target' : 'tracked only') : sh?.whyText || (x.status === 'under' ? 'below the minimum' : 'not yet planned') };
  }
  return out;
}

// ---------------------------------------------------------------- weekPlanSummary
// makeRoomProposal is pure and cheap, but never let a bad profile break the whole week summary.
function safeRoom(profile, target) {
  try { return makeRoomProposal(profile || {}, target); } catch (e) { return null; }
}
export function weekPlanSummary(sessions, { weekStart, profile, now = new Date() } = {}) {
  now = toDate(now);
  const ws = weekStartOf(weekStart ? toDate(weekStart) : now);
  const from = ds(ws), to = ds(addDays(ws, 6)), today = ds(now);
  const T = weeklyTargets(profile);
  const done = {}, planned = {}, rDone = {}, rPlan = {}, byDay = {};
  let cDone = 0, cPlan = 0, sDone = 0, sPlan = 0, lDone = 0, lPlan = 0, liftMinutes = 0;
  for (const s of sessions || []) {
    if (!s || !s.date || s.date < from || s.date > to) continue;
    let v, gT, rT;
    if (s.status === 'planned') {
      if (s.date < today || isRestPlan(s)) continue;
      v = vol(simulateDone(s)); gT = planned; rT = rPlan; sPlan++; cPlan += v.cardioMin; lPlan += v.liftSets;
    } else {
      v = vol(s); if (!(v.liftSets > 0 || v.cardioMin > 0 || Object.keys(v.regions).length)) continue;
      gT = done; rT = rDone; sDone++; cDone += v.cardioMin; lDone += v.liftSets;
    }
    if (v.liftSets > 0) liftMinutes += Math.max(0, (Number(s.minutes) || 45) - (s.blocks || []).filter(b => b.kind === 'cardio').reduce((a, b) => a + (Number(b.minutes) || 0), 0));
    for (const [g, w] of Object.entries(v.groups)) { gT[g] = (gT[g] || 0) + w; (byDay[s.date] ||= {})[g] = (byDay[s.date]?.[g] || 0) + w; }
    for (const r of PRIORITY_REGIONS) if (v.regions[r]) rT[r] = (rT[r] || 0) + v.regions[r];
  }
  const status = (tot, t) => (tot < t.min - 0.25 ? 'under' : tot > t.max + 0.05 ? 'over' : 'ok');
  // The one resolved target table and the one week count, used by both the group block and the unit block.
  const UT0 = unitTargets(profile || {});
  const uw0 = weekUnitTotals(sessions, from, to, today);
  const uDone0 = weekUnitTotals((sessions || []).filter(s => s && s.status !== 'planned'), from, to, today);
  const groups = {};
  // §18: a group's done/planned/total add up its COUNTED units, the same muscles its target adds up,
  // so `total / target.target` is comparable and matches Body, Today and recovery.groupStatus. (It used
  // to count each set once per group while the target summed the units: back read 24/18 here and
  // 18.8/18 everywhere else, because shrugs and RDLs counted toward "back".)
  // `groupCredit` keeps the once-per-group figure, which is what recovery/fatigue and the projection use.
  for (const [g, t] of Object.entries(T.groups)) {
    const cu = (COUNTED_UNITS[g] || []).filter(u => UT0[u]);
    const d = r1(cu.length ? cu.reduce((a, u) => a + (uDone0.units[u] || 0), 0) : (done[g] || 0));
    const tot = r1(cu.length ? cu.reduce((a, u) => a + (uw0.units[u] || 0), 0) : (done[g] || 0) + (planned[g] || 0));
    groups[g] = { done: Math.min(d, tot), planned: r1(Math.max(0, tot - d)), total: tot, target: t.target, status: status(tot, t.target),
      groupCredit: { done: r1(done[g] || 0), planned: r1(planned[g] || 0), total: r1((done[g] || 0) + (planned[g] || 0)) } };
  }
  const regions = {};
  for (const [r, t] of Object.entries(T.regions)) {
    const d = r1(rDone[r] || 0), p = r1(rPlan[r] || 0), tot = r1(d + p);
    regions[r] = { done: d, planned: p, total: tot, target: t.target, status: status(tot, t.target) };
  }
  const target = cardioTarget(profile);
  // This week's capacity from what's actually planned (a class day counts its class cardio), else availability.
  const capacity = weekCardioCapacity(profile || {}, sessions || [], { now, weekStart: ws });
  const cardioMinutes = { done: Math.round(cDone), planned: Math.round(cPlan), target, capacity, shortfall: Math.max(0, Math.round(target - cDone - cPlan)) };

  const warnings = [];
  const prio = priorityGroups(profile);
  const underPrio = prio.filter(g => groups[g]?.status === 'under');
  // Enforcement units (VOLUME_UNITS): min / target / max per the weekly-volume audit.
  const UT = UT0, uw = uw0, uDone = uDone0;
  const units = {};
  for (const u of UNIT_ORDER) {
    const t = UT[u], total = r1(uw.units[u] || 0), done = r1(Math.min(total, uDone.units[u] || 0));
    units[u] = { name: t.name, group: t.group, tier: t.tier, sub: t.sub, done, planned: r1(total - done), total, min: t.min, target: t.target, max: t.max, base: t.base, slider: t.slider, extra: t.extra,
      // bands vs TARGET: < min 'under' (red) · min…target 'toward' (amber) · target…max 'ok' (green) · > max 'over' (orange)
      status: total > t.max + 0.25 ? 'over' : total < t.min - 0.25 ? 'under' : total < t.target - 0.25 ? 'toward' : 'ok',
      pctTarget: t.target > 0 ? Math.round(Math.min(1, total / t.target) * 100) / 100 : 1 };
  }
  const pol = volumePolicyOf(profile || {});
  const liftDays = (sessions || []).filter(s => s && s.status === 'planned' && s.date >= from && s.date <= to && s.date >= today && s.plan?.kind === 'lift');
  const capLimit = s => (pol.mode === 'extend' ? Math.max(Number(s.plan?.slot?.minutes) || 0, pol.maxMinutes) : Number(s.minutes) || 0);
  const timeBound = liftDays.length > 0 && liftDays.every(s => estimateMinutes(s.blocks) >= capLimit(s) - 5);
  // §26: a lift day within a set of the workout set ceiling cannot take another exercise.
  const setCap = sessionSetCapOf(profile || {});
  const ceilDays = liftDays.filter(s => workingSets(s) >= setCap - 1).length;
  const ceilingBound = liftDays.length > 0 && ceilDays === liftDays.length;
  const short = UNIT_ORDER.filter(u => units[u].min > 0 && units[u].status === 'under' && units[u].min - units[u].total >= 0.25)
    .map(u => ({ unit: u, group: units[u].group, name: units[u].name, total: units[u].total, min: units[u].min, short: r1(units[u].min - units[u].total) }));
  const why = !short.length ? '' : ceilingBound ? ` (every lift day is at your ${setCap}-set workout ceiling: add a lift day)` : timeBound ? ` (every lift day is at your ${pol.mode === 'extend' ? pol.maxMinutes + '′ cap' : 'slot time'})` : pol.mode !== 'extend' ? ' (workouts are kept to your slot times)' : ' (recovery spacing: add a lift day)';
  for (const x of short) warnings.push(`${x.name}${x.group !== x.unit && !/^(chest|back)/.test(x.unit) ? ` (${gName(x.group).toLowerCase()})` : ''} ${fmt(x.total)}/${fmt(x.min)} sets: short ${fmt(x.short)}${why}`);
  const tUnits = UNIT_ORDER.filter(u => units[u].target > 0 && !units[u].sub);
  const tMet = tUnits.filter(u => units[u].total >= units[u].target - 0.25);
  const tShortSets = tUnits.reduce((n, u) => n + Math.max(0, units[u].target - units[u].total), 0);
  // Binding reasons recorded by the planner for targets it couldn't reach (plan.targetWhy on this week's days)
  // and for muscles left more than 1.5 sets over target (plan.overWhy).
  const tWhy = {}, oWhy = {};
  for (const s of liftDays) { Object.assign(tWhy, s.plan?.targetWhy || {}); Object.assign(oWhy, s.plan?.overWhy || {}); }
  for (const u of UNIT_ORDER) {
    const x = units[u];
    if (x.target > 0 && x.total > x.target + 1.5) {
      const o = oWhy[u] || { why: 'floor' };
      x.overWhy = o.why;
      x.overText = o.why === 'pushpull' ? 'rows/pulldowns also keep pull ≥ push' : o.why === 'shared' ? `the same exercises cover ${o.with.map(v => (VOLUME_UNITS[v]?.name || v).toLowerCase()).join(', ')}` : 'no lighter exercise keeps the other floors';
    }
  }
  // A week with no lift session at all (done or planned) cannot blame a per-session cap or the clock.
  const anyLift = (sessions || []).some(s => s && s.date >= from && s.date <= to && !isRestPlan(s)
    && (s.blocks || []).some(b => b.kind === 'lift' || b.kind === 'class'));
  const tShort = tUnits.filter(u => !tMet.includes(u)).map(u => {
    let why = anyLift ? (tWhy[u] || (ceilingBound ? 'ceiling' : timeBound ? 'time' : pol.fillTargets !== 'extend' ? 'policy' : null)) : 'nolift';
    if (why === 'time' && !timeBound) why = null;   // only claim "time" when every lift day really is at the cap
    // §26: and "the ceiling on every lift day" only when every one holds within a set of it (else say how many).
    if (why === 'ceiling' && !ceilingBound) why = ceilDays ? 'ceiling_some' : null;
    else if (why === 'ceiling_some') why = ceilingBound ? 'ceiling' : ceilDays ? why : null;
    return { unit: u, name: units[u].name, total: units[u].total, target: units[u].target, short: r1(units[u].target - units[u].total), why, whyText: why ? TARGET_WHY_TEXT[why](pol, { setCap, ceilDays, liftDays: liftDays.length }) : 'not yet planned' };
  });
  const targets = { met: tMet.length, total: tUnits.length, shortSets: r1(tShortSets), minutesToHit: Math.round(tShortSets * 2.2 / 5) * 5, short: tShort,
    line: tShort.length ? `Targets ${tMet.length}/${tUnits.length}: short on ${tShort.slice(0, 3).map(x => `${x.name.toLowerCase()} ${fmt(x.short)}`).join(', ')}${tShort[0].why ? ` (${tShort[0].whyText})` : ''}` : `Targets ${tMet.length}/${tUnits.length} ✓` };
  const pushPull = { push: uw.push, pull: uw.pull, ratio: uw.pull ? Math.round(uw.push / uw.pull * 100) / 100 : null, ok: uw.push <= uw.pull * 1.1 + 0.5 };
  if (!pushPull.ok) warnings.push(`Pushing outweighs pulling (${uw.push} press/fly vs ${uw.pull} row/pulldown sets): add rows or pulldowns`);
  // (per-head region warnings retired: side/rear delts and upper chest are units now)
  for (const u of UNIT_ORDER) if (units[u].status === 'over') warnings.push(`${units[u].name} ${fmt(units[u].total)} sets: over the ${fmt(units[u].max)}-set weekly max (diminishing returns, more recovery cost)`);
  const setsNeeded = Math.round(prio.reduce((a, g) => a + (T.groups[g]?.target.min || 0), 0));
  // §26: the most working sets this week's lift days can hold under the workout set ceiling.
  const nLiftDays = (sessions || []).filter(s => s && s.date >= from && s.date <= to && !isRestPlan(s) && (s.status !== 'planned' || s.date >= today) && (s.blocks || []).some(b => b.kind === 'lift')).length;
  if (underPrio.length >= 2) {
    warnings.push(ceilingBound
      ? `Not enough lift days to hit every priority minimum: ${liftDays.length} planned lift day${liftDays.length === 1 ? '' : 's'} at your ${setCap}-set workout ceiling yield ~${Math.round(lDone + lPlan)} working sets, while the priority groups alone want ~${setsNeeded} group-sets. Add a lift day, or raise the ceiling in Settings (past it, extra sets mostly add fatigue).`
      : `Not enough lifting time to hit every priority minimum: ~${Math.round(liftMinutes)} lift min this week yields ~${Math.round(lDone + lPlan)} working sets, while the priority groups alone want ~${setsNeeded} group-sets. Add a lift day or more minutes, or accept a slower week.`);
  }
  // Back-to-back heavy hits on the same (slow-recovering) group.
  const dates = Object.keys(byDay).sort();
  for (let i = 1; i < dates.length; i++) {
    if (parseDs(dates[i]) - parseDs(dates[i - 1]) > 864e5 * 1.5) continue;
    for (const g of Object.keys(byDay[dates[i]])) {
      if (!GROUPS[g] || (GROUPS[g].recoveryHours || 48) < 48) continue;
      if ((byDay[dates[i - 1]][g] || 0) >= 6 && byDay[dates[i]][g] >= 4) {
        const dn = d => DOW[parseDs(d).getDay()].replace(/^./, c => c.toUpperCase());
        warnings.push(`${gName(g)} on ${dn(dates[i - 1])} and ${dn(dates[i])} back-to-back`);
      }
    }
  }
  const cTot = cDone + cPlan;
  if (target > 0 && cTot < target - cardioTolerance(target)) {
    const short = Math.round(target - cTot);
    // Only point at "Make room" when the availability template really can hold more — once it has
    // been applied there is nothing left for that button to do, and the honest advice is to add a day.
    const room = capacity < target - cardioTolerance(target) ? safeRoom(profile, target) : null;
    warnings.push(`Cardio ${Math.round(cTot)}/${target} min planned (${short} short)` + (!room
      ? (sPlan ? '. Re-plan the week to rebalance auto days.' : '. Plan the week to fill it.')
      : `: this week fits ~${capacity} cardio min alongside lifting. ${room.changes.length
        ? `Use "Make room"${room.enough ? '' : ` (it reaches ~${room.after})`} or add a cardio day / more minutes to reach ${target}.`
        : `Add a cardio day or more minutes in Availability to reach ${target}.`}`));
  }

  // Score: priority-weighted TARGET attainment per unit (80%; a missed minimum or an over-max unit
  // costs extra) + cardio coverage (20%).
  let num = 0, den = 0;
  for (const u of UNIT_ORDER) {
    const x = units[u]; if (!(x.target > 0) || x.sub) continue;
    const w = x.tier === 'priority' ? 2 : x.tier === 'maintenance' ? 0.5 : 1;
    let a = Math.min(1, x.total / x.target);
    if (x.status === 'under') a *= 0.7;
    if (x.status === 'over') a *= 0.85;
    num += w * a; den += w;
  }
  const liftCov = den ? num / den : 1;
  const cardioCov = target > 0 ? Math.min(1, cTot / target) : 1;
  const score = Math.round(100 * (0.8 * liftCov + 0.2 * cardioCov));
  const extended = (sessions || []).filter(s => s && s.status === 'planned' && s.date >= from && s.date <= to && s.date >= today && s.plan?.extended)
    .map(s => ({ date: s.date, ...s.plan.extended }));
  return {
    groups, regions, cardioMinutes, sessions: { done: sDone, planned: sPlan },
    units, minimums: { met: !short.length, short, binding: short.length ? (ceilingBound ? 'ceiling' : timeBound ? 'time' : pol.mode !== 'extend' ? 'policy' : 'recovery') : null }, targets, pushPull, extended,
    liftSets: { done: lDone, planned: lPlan }, capacity: { liftMinutes: Math.round(liftMinutes), setsNeeded, setCap, liftDays: nLiftDays, maxSets: nLiftDays * setCap },
    warnings, score,
  };
}
