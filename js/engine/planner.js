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
//   Lift days use profile.defaultStyle as the buildWorkout style.
import { recommend, groupStatus, muscleStatus, sessionVolume } from './recovery.js';
import { buildWorkout } from './generator.js';
import { CARDIO, INTENSITIES, cardioOptions } from '../data/cardio.js';
import { classify } from '../classes/classify.js';
import { GROUPS, REGIONS } from '../data/muscles.js';
import { DEFAULT_LOCATIONS, expandEquipment } from '../data/equipment.js';
import { ds, parseDs, addDays, weekStart as weekStartOf, clamp, rng } from '../util.js';
import { cardioPrefs, finisherCap, cardioCapacity, weekCardioCapacity } from './targets.js';

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
  return { kind: s.kind, minutes: Number(s.minutes) || 0, location: s.location || 'home' };
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
    else if (sl.kind === 'lift') { futureLiftDays++; if (sl.minutes >= 40 && hasMachineCardio(locationFor(ctx.profile, sl.location))) futureCardio += 10; }
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
const styleOf = profile => (['hypertrophy', 'pump', 'strength', 'circuit'].includes(profile?.defaultStyle) ? profile.defaultStyle : 'hypertrophy');

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
    if (mod) cardio = { modality: mod, minutes: minutes >= 60 ? 15 : 10, intensity: 'easy' };
  }

  const seed = hashStr(date + '|lift|' + ctx.seed);
  const w = buildWorkout({ targets, minutes, location: loc, profile: ctx.profile, sessions: ctx.history, now, seed, cardio, upcoming, style: styleOf(ctx.profile) });
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
  let cardio = Math.min(cm, Math.max(0, cardioGap)) / CARDIO_MIN_PER_SET * 0.8;
  const leftover = (slot.minutes || x.dur) - x.dur;
  const addOn = leftover >= 10 && cardioGap - cm > 0 ? clamp(Math.floor((Math.min(leftover - 5, 20, cardioGap - cm)) / 5) * 5, 0, 20) : 0;
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
  opts.push({ kind: 'lift', v: liftFrac * minutes * SETS_PER_MIN * (st.lifts < 3 ? 1.15 : 1) * jit() });
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
      const w = buildWorkout({ targets, minutes: old.minutes, location: loc, profile: ctx.profile, sessions: hist, now, seed: old.seed, cardio, style: styleOf(ctx.profile) });
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
  if (target - have < Math.max(10, target * 0.1)) return;
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
  const tol = Math.max(10, target * 0.1);
  let left = need;
  for (const c of cands) {
    if (left < tol) break;
    let add = Math.min(c.room, round5(left));
    if (c.curMin + add < 10) add = 10 - c.curMin;
    if (add < 5 || add > c.room) continue;
    c.add = add; left -= add;
  }
  for (const c of cands) {
    if (!c.add) continue;
    const old = c.s, mins = c.curMin + c.add;
    const hi = ctx.history.findIndex(h => h.id === old.id);
    if (hi < 0) continue;
    const hist = ctx.history.filter((_, j) => j !== hi);
    const now = noonOf(old.date);
    const cardio = { modality: c.mod, minutes: mins, intensity: 'easy' };
    const w = buildWorkout({ targets: old.targets, minutes: old.minutes, location: c.loc, profile: ctx.profile, sessions: hist, now, seed: old.seed, cardio, upcoming: hist.filter(h => h.date > old.date), style: styleOf(ctx.profile) });
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
  keep = s => s.plan && !s.plan.auto, now = new Date(), seed } = {}) {
  now = toDate(now);
  profile = profile || {};
  schedule = schedule || profile.schedule || {};
  const fromDs = toDs(from) || ds(now);
  const ctx = makeCtx({ profile, sessions, schedule, classSchedule, now, seed });
  seedHistory(ctx, sessions, fromDs, keep);
  ctx.firstDate = fromDs < ctx.today ? ctx.today : fromDs;
  const out = [];
  const n = clamp(Math.round(Number(days) || 7), 1, 120);
  const start = parseDs(fromDs);
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
    if (isLast) { const { ws, we } = weekBounds(date); balanceCardio(ctx, out, ws, we, date); balanceWeek(ctx, out, ws, we); }
  }
  return out;
}

// ---------------------------------------------------------------- suggestForDay
export function suggestForDay(date, { profile, sessions = [], schedule, classSchedule = null, now = new Date(), seed, slot } = {}) {
  now = toDate(now);
  profile = profile || {};
  schedule = schedule || profile.schedule || {};
  date = toDs(date) || ds(now);
  const sl = slot ? { kind: slot.kind || 'lift', minutes: Number(slot.minutes) || profile.defaultMinutes || 45, location: slot.location || profile.currentLocation || 'home' } : slotFor(schedule, date);
  if (sl.kind === 'rest' || sl.minutes < 10) return null;
  const ctx = makeCtx({ profile, sessions, schedule, classSchedule, now, seed });
  // Planned days before AND after `date` are context (simulated as done); planned sessions on
  // `date` itself are what we're replacing. Done/active work on `date` still counts.
  const others = (sessions || []).filter(s => s && !(s.status === 'planned' && s.date === date));
  seedHistory(ctx, others, date, () => true);
  return planDay(ctx, date, sl);
}

// ---------------------------------------------------------------- weekPlanSummary
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
  const status = (tot, t) => (tot < t.min - 0.05 ? 'under' : tot > t.max + 0.05 ? 'over' : 'ok');
  const groups = {};
  for (const [g, t] of Object.entries(T.groups)) {
    const d = r1(done[g] || 0), p = r1(planned[g] || 0), tot = r1(d + p);
    groups[g] = { done: d, planned: p, total: tot, target: t.target, status: status(tot, t.target) };
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
  for (const g of underPrio) warnings.push(`${gName(g)} only ${fmt(groups[g].total)}/${Math.round(groups[g].target.min)} sets planned`);
  for (const [r, x] of Object.entries(regions)) {
    if (x.status !== 'under' || underPrio.includes(REGIONS[r].group) || x.target.min < 3) continue;
    if (x.total < x.target.min * 0.75) warnings.push(`${REGIONS[r].name} only ${fmt(x.total)}/${Math.round(x.target.min)} sets planned`);
  }
  const setsNeeded = Math.round(prio.reduce((a, g) => a + (T.groups[g]?.target.min || 0), 0));
  if (underPrio.length >= 2) {
    warnings.push(`Not enough lifting time to hit every priority minimum: ~${Math.round(liftMinutes)} lift min this week yields ~${Math.round(lDone + lPlan)} working sets, while the priority groups alone want ~${setsNeeded} group-sets. Add a lift day or more minutes, or accept a slower week.`);
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
  if (target > 0 && cTot < target - Math.max(10, target * 0.1)) {
    const short = Math.round(target - cTot);
    warnings.push(`Cardio ${Math.round(cTot)}/${target} min planned (${short} short)` + (capacity < target - 5
      ? `: this week fits ~${capacity} cardio min alongside lifting. Use "Make room" or add a cardio day / more minutes to reach ${target}.`
      : sPlan ? '. Re-plan the week to rebalance auto days.' : '. Plan the week to fill it.'));
  }

  // Score: priority-weighted coverage of minimums (80%) + cardio coverage (20%).
  let num = 0, den = 0;
  for (const [g, x] of Object.entries(groups)) {
    if (!(x.target.min > 0)) continue;
    const w = prio.includes(g) ? 2 : LEG_GROUPS.has(g) ? 0.5 : 1;
    num += w * Math.min(1, x.total / x.target.min); den += w;
  }
  const liftCov = den ? num / den : 1;
  const cardioCov = target > 0 ? Math.min(1, cTot / target) : 1;
  const score = Math.round(100 * (0.8 * liftCov + 0.2 * cardioCov));
  return {
    groups, regions, cardioMinutes, sessions: { done: sDone, planned: sPlan },
    liftSets: { done: lDone, planned: lPlan }, capacity: { liftMinutes: Math.round(liftMinutes), setsNeeded },
    warnings, score,
  };
}
