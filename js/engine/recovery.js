// Recovery, volume and "what should I train today" engine. Pure, DOM-free.
//
// CONTRACT-NOTE: recommend() options carry an extra `targets` array (always a list of
//   valid group/preset ids, safe to pass straight to generator.buildWorkout). For
//   combos without a matching preset (e.g. chest+triceps) `targetId` is the joined
//   form 'chest+triceps', which regionsFor() does not resolve, so use `targets`/`groups`.
//   Options also carry `recovering` (true when a group is <50% recovered; only shown
//   when there are fewer than 3 fully-viable options) and `cardio` (suggestion|null).
// CONTRACT-NOTE: group-level sets count each set once per group, using the strongest
//   muscle credit inside that group (4 sets of DB bench = 4 chest sets, not 6). Region
//   sets use the per-region credit from exercise.muscles, as described in §6.
// CONTRACT-NOTE: lastTrained/daysSince only count a "meaningful" stimulus (>=1 effective
//   set on the day). Smaller spill-over volume still adds a little fatigue to readiness.
import { REGIONS, GROUPS, GROUP_ORDER, PRESETS } from '../data/muscles.js';
import { SCULPT_GOALS } from '../data/sculpt.js';
import { getEx } from '../data/exercises.js';
import { ds, parseDs, daysBetween, addDays, weekStart, clamp } from '../util.js';

const MEANINGFUL = 1;      // effective sets on a day that count as "trained"
const ADDON_ONLY = new Set(['forearms', 'calves']);   // never a whole session on their own
const SMALL = new Set(['biceps', 'triceps', 'forearms', 'core', 'calves']);

// ---------------------------------------------------------------- helpers

const r2 = x => Math.round(x * 100) / 100;
const fmtSets = x => { const v = Math.round(x * 2) / 2; return String(v); };
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const toDate = now => (now instanceof Date ? now : now ? new Date(now) : new Date());

function regionGroup(r) { return REGIONS[r]?.group || null; }
function regionName(r) { return cap(REGIONS[r]?.name || r.replace(/_/g, ' ')); }
function groupName(g) { return GROUPS[g]?.name || cap(g); }
function isPlural(name) { return /s$/i.test(name) && !/^(core|chest|back)$/i.test(name); }

const countedSet = s => !!(s && s.done && Number(s.r) > 0);

// Everything one session contributes. Lift sets only count when done && r>0.
export function sessionVolume(s) {
  const regions = {}, groups = {};
  let liftSets = 0, cardioMin = 0;
  for (const b of s?.blocks || []) {
    if (b.kind === 'lift') {
      const ex = getEx(b.exId);
      const n = (b.sets || []).filter(countedSet).length;
      if (!n) continue;
      liftSets += n;
      if (!ex) continue;
      const gmax = {};
      for (const [r, w] of Object.entries(ex.muscles || {})) {
        regions[r] = (regions[r] || 0) + n * w;
        const g = regionGroup(r);
        if (g) gmax[g] = Math.max(gmax[g] || 0, w);
      }
      for (const [g, w] of Object.entries(gmax)) groups[g] = (groups[g] || 0) + n * w;
    } else if (b.kind === 'class') {
      if (!b.done) continue;
      const gmax = {};
      for (const [r, w] of Object.entries(b.classify?.muscles || {})) {
        if (!(w > 0)) continue;
        regions[r] = (regions[r] || 0) + w;
        const g = regionGroup(r);
        if (g) gmax[g] = Math.max(gmax[g] || 0, w);
      }
      for (const [g, w] of Object.entries(gmax)) groups[g] = (groups[g] || 0) + w;
      const cm = b.classify && typeof b.classify.cardioMinutes === 'number' ? b.classify.cardioMinutes : (b.duration || 0);
      cardioMin += cm;
    } else if (b.kind === 'cardio') {
      if (b.done) cardioMin += Number(b.minutes) || 0;
    }
  }
  return { regions, groups, liftSets, cardioMin };
}

function hasWork(v) { return v.liftSets > 0 || v.cardioMin > 0 || Object.keys(v.regions).length > 0; }

// Best guess at when a session happened (ms). Falls back to noon on its date.
function sessionTime(s) {
  for (const k of ['endedAt', 'startedAt']) {
    if (s[k]) { const t = new Date(s[k]); if (!isNaN(t) && ds(t) === s.date) return t.getTime(); }
  }
  return parseDs(s.date).getTime() + 12 * 3600e3;
}

// Precompute per-session volumes up to and including today.
function prep(sessions, now) {
  const today = ds(now);
  const out = [];
  for (const s of sessions || []) {
    if (!s || !s.date || s.date > today) continue;
    const v = sessionVolume(s);
    if (!hasWork(v)) continue;
    out.push({ s, date: s.date, t: sessionTime(s), v });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.t - b.t);
  return out;
}

// Recovery time scales with how hard the stimulus was: 2 sets recover much faster than 8.
function fatigueFrom(sets, hours, recoveryHours) {
  if (!(sets > 0)) return 0;
  const R = recoveryHours * clamp(0.4 + 0.6 * sets / 6, 0.4, 1.3);
  const severity = clamp(sets / 6, 0.15, 1);
  const t = clamp(hours / R, 0, 1);
  const smooth = t * t * (3 - 2 * t);
  return severity * (1 - smooth);
}

function readinessFor(key, kind, entries, nowMs, recoveryHours) {
  let fatigue = 0;
  for (const e of entries) {
    const sets = e.v[kind][key];
    if (!sets) continue;
    const hours = Math.max(0, (nowMs - e.t) / 3600e3);
    if (hours > recoveryHours * 1.4) continue;
    fatigue += fatigueFrom(sets, hours, recoveryHours);
  }
  return r2(1 - clamp(fatigue, 0, 1));
}

function needScore(sets7d, target, daysSince, prioMult) {
  const deficit = target.min > 0 ? clamp((target.min - sets7d) / target.min, 0, 1) : 0;
  const over = sets7d >= target.max ? -0.2 : 0;
  const stale = daysSince == null ? 0.35 : clamp((daysSince - 3) / 4, 0, 1) * 0.4;
  const raw = Math.max(0, (0.7 * deficit + stale + over) * prioMult);
  return r2(1 - Math.exp(-1.6 * raw));     // soft saturation keeps priority ordering near the top
}

function groupPriority(profile, g) {
  const p = profile?.groupPriority?.[g];
  return typeof p === 'number' && p > 0 ? p : 1;
}

// Extra weekly sets per region from enabled sculpt goals.
function sculptExtras(profile) {
  const extra = {};
  for (const id of profile?.sculptGoals || []) {
    const g = SCULPT_GOALS[id];
    if (!g || !(g.extraWeeklySets > 0)) continue;
    const entries = Object.entries(g.regions || {}).filter(([r, w]) => REGIONS[r] && w > 0);
    const tot = entries.reduce((s, [, w]) => s + w, 0);
    if (!tot) continue;
    for (const [r, w] of entries) extra[r] = (extra[r] || 0) + g.extraWeeklySets * w / tot;
  }
  return extra;
}

function scaleTarget(base, prio, extra) {
  const min = (base?.min ?? 0) * prio + extra, max = (base?.max ?? 0) * prio + extra;
  return { min: Math.round(min * 10) / 10, max: Math.round(Math.max(max, min) * 10) / 10 };
}

// ---------------------------------------------------------------- public API

export function volumeByRegion(sessions, { from, to } = {}) {
  const out = {};
  for (const s of sessions || []) {
    if (!s || !s.date || (from && s.date < from) || (to && s.date > to)) continue;
    for (const [r, w] of Object.entries(sessionVolume(s).regions)) out[r] = (out[r] || 0) + w;
  }
  return out;
}

export function volumeByGroup(sessions, { from, to } = {}) {
  const out = {};
  for (const s of sessions || []) {
    if (!s || !s.date || (from && s.date < from) || (to && s.date > to)) continue;
    for (const [g, w] of Object.entries(sessionVolume(s).groups)) out[g] = (out[g] || 0) + w;
  }
  return out;
}

function statusCore(entries, now, profile) {
  const today = ds(now), from = ds(addDays(now, -6)), nowMs = now.getTime();
  const recent = entries.filter(e => e.date >= ds(addDays(now, -8)));
  const week = entries.filter(e => e.date >= from);
  const extras = sculptExtras(profile);

  // last meaningful day per region / group
  const dayVol = { regions: {}, groups: {} };   // key -> { date -> sets }
  for (const e of entries) for (const kind of ['regions', 'groups']) for (const [k, w] of Object.entries(e.v[kind])) {
    const m = dayVol[kind][k] || (dayVol[kind][k] = {});
    m[e.date] = (m[e.date] || 0) + w;
  }
  const lastOf = (kind, k) => {
    const m = dayVol[kind][k]; if (!m) return null;
    let best = null;
    for (const [d, w] of Object.entries(m)) if (w >= MEANINGFUL && (!best || d > best)) best = d;
    return best;
  };
  const weekSum = (kind, k) => week.reduce((s, e) => s + (e.v[kind][k] || 0), 0);

  const regions = {};
  for (const r of Object.values(REGIONS)) {
    const gp = groupPriority(profile, r.group);
    const target = scaleTarget(r.weeklySets, gp, extras[r.id] || 0);
    const lastTrained = lastOf('regions', r.id);
    const daysSince = lastTrained ? daysBetween(lastTrained, today) : null;
    const sets7d = r2(weekSum('regions', r.id));
    const prio = Math.sqrt((r.priority || 1) * gp);
    regions[r.id] = {
      region: r.id, group: r.group, lastTrained, daysSince, sets7d, target,
      readiness: readinessFor(r.id, 'regions', recent, nowMs, r.recoveryHours || 48),
      need: needScore(sets7d, target, daysSince, prio),
      priority: r2(prio),
    };
  }

  const groups = {};
  for (const gid of GROUP_ORDER.filter(g => GROUPS[g]).concat(Object.keys(GROUPS).filter(g => !GROUP_ORDER.includes(g)))) {
    const g = GROUPS[gid];
    const gp = groupPriority(profile, gid);
    const extra = g.regions.reduce((s, r) => s + (extras[r] || 0), 0);
    const base = g.weeklySets || { min: g.regions.reduce((s, r) => s + (REGIONS[r]?.weeklySets?.min || 0), 0), max: g.regions.reduce((s, r) => s + (REGIONS[r]?.weeklySets?.max || 0), 0) };
    const target = scaleTarget(base, gp, extra);
    const lastTrained = lastOf('groups', gid);
    const daysSince = lastTrained ? daysBetween(lastTrained, today) : null;
    const sets7d = r2(weekSum('groups', gid));
    const rs = Object.fromEntries(g.regions.filter(r => regions[r]).map(r => [r, regions[r]]));
    const avgRegPrio = g.regions.length ? g.regions.reduce((s, r) => s + (REGIONS[r]?.priority || 1), 0) / g.regions.length : 1;
    const prio = Math.sqrt(avgRegPrio * gp);
    const own = needScore(sets7d, target, daysSince, prio);
    const maxReg = Math.max(0, ...Object.values(rs).map(x => x.need));
    groups[gid] = {
      group: gid, lastTrained, daysSince, sets7d, target,
      readiness: readinessFor(gid, 'groups', recent, nowMs, g.recoveryHours || 48),
      need: r2(clamp(0.6 * own + 0.4 * maxReg, 0, 1)),
      priority: r2(prio),
      regions: rs,
    };
  }
  return { regions, groups };
}

export function muscleStatus(sessions, { now = new Date(), profile } = {}) {
  now = toDate(now);
  return statusCore(prep(sessions, now), now, profile).regions;
}

export function groupStatus(sessions, opts = {}) {
  const now = toDate(opts.now);
  return statusCore(prep(sessions, now), now, opts.profile).groups;
}

// ---------------------------------------------------------------- cardio

export function cardioStatus(sessions, { now = new Date(), profile } = {}) {
  now = toDate(now);
  const entries = prep(sessions, now);
  const from = ds(addDays(now, -6)), today = ds(now);
  const target = profile?.cardioTargetMin ?? 120;
  let minutes7d = 0, sessions7d = 0, last = null;
  for (const e of entries) {
    if (!(e.v.cardioMin > 0)) continue;
    if (!last || e.date > last) last = e.date;
    if (e.date >= from) { minutes7d += e.v.cardioMin; sessions7d++; }
  }
  minutes7d = Math.round(minutes7d);
  const daysSince = last ? daysBetween(last, today) : null;
  let suggestion;
  if (!target) suggestion = 'No weekly cardio target set.';
  else if (minutes7d >= target) suggestion = `Cardio target met (${minutes7d}/${target} min this week). Easy Zone 2 only if you feel like it.`;
  else {
    const gap = target - minutes7d;
    const sess = clamp(Math.round(gap / 5) * 5, 15, 45);
    const since = daysSince == null ? 'No cardio logged yet. ' : daysSince >= 3 ? `${daysSince} days since your last cardio. ` : '';
    const short = minutes7d > 0 ? `${gap} min short of ${target} this week` : `0/${target} min this week`;
    suggestion = `${since}${short}: add ${sess} min of Zone 2 (bike, incline walk or easy run)${gap > 45 ? ' or a cardio class' : ''}.`;
  }
  return { minutes7d, target, daysSince, sessions7d, behind: target > 0 && minutes7d < target, suggestion };
}

// ---------------------------------------------------------------- recommend

const COMBOS = [
  { id: 'chest+triceps', label: 'Chest & Triceps', groups: ['chest', 'triceps'] },
  { id: 'back+biceps', label: 'Back & Biceps', groups: ['back', 'biceps'] },
  { id: 'shoulders+triceps', label: 'Shoulders & Triceps', groups: ['shoulders', 'triceps'] },
  { id: 'shoulders+arms', label: 'Shoulders & Arms', groups: ['shoulders', 'biceps', 'triceps'] },
  { id: 'chest+back', label: 'Chest & Back', groups: ['chest', 'back'] },
  { id: 'shoulders+core', label: 'Shoulders & Abs', groups: ['shoulders', 'core'] },
  { id: 'arms', label: 'Arms', groups: ['biceps', 'triceps'], preset: true },
  { id: 'push', label: 'Push', groups: ['chest', 'shoulders', 'triceps'], preset: true },
  { id: 'pull', label: 'Pull', groups: ['back', 'biceps'], preset: true },
  { id: 'upper', label: 'Upper Body', groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'], preset: true },
  { id: 'legs+core', label: 'Legs & Core', groups: ['quads', 'hamstrings', 'glutes', 'core'] },
  { id: 'legs', label: 'Legs', groups: ['quads', 'hamstrings', 'glutes', 'calves'], preset: true },
  { id: 'full', label: 'Full Body', groups: ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'core'], preset: true },
  { id: 'v_taper', label: 'V-Taper', groups: ['back', 'shoulders', 'core'], preset: true },
];

function candidates() {
  const out = [];
  const seen = new Set();
  const add = c => {
    const groups = c.groups.filter(g => GROUPS[g]);
    if (!groups.length) return;
    const key = [...groups].sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...c, groups });
  };
  for (const g of GROUP_ORDER) if (GROUPS[g] && !ADDON_ONLY.has(g)) add({ id: g, label: groupName(g), groups: [g], single: true });
  for (const c of COMBOS) {
    if (c.preset && PRESETS[c.id]) add({ id: c.id, label: PRESETS[c.id].name || c.label, groups: PRESETS[c.id].groups, preset: true });
    else add({ ...c, preset: false });
  }
  return out;
}

function maxGroupsFor(minutes) { return minutes <= 25 ? 2 : minutes <= 40 ? 3 : minutes <= 65 ? 4 : 6; }

function daysText(d, sets = 0) { return d == null ? (sets > 0 ? 'no direct work yet' : 'not trained yet') : d === 0 ? 'trained today' : d === 1 ? '1 day since' : `${d} days since`; }

function groupReason(gid, st) {
  const name = groupName(gid);
  const behind = st.target.min - st.sets7d;
  // Name a specific region when it lags clearly behind the rest of its group.
  let focus = null;
  for (const r of Object.values(st.regions)) {
    if (r.target.min >= 2 && r.need >= st.need + 0.15 && (!focus || r.need > focus.need)) focus = r;
  }
  if (focus) return `${regionName(focus.region)}: ${daysText(focus.daysSince, focus.sets7d)}, ${fmtSets(focus.sets7d)}/${Math.round(focus.target.min)} sets this week`;
  if (st.priority >= 1.1 && behind >= 2) return `${name} ${isPlural(name) ? 'are' : 'is'} a priority and ${fmtSets(behind)} sets behind`;
  return `${name}: ${daysText(st.daysSince, st.sets7d)}, ${fmtSets(st.sets7d)}/${Math.round(st.target.min)} sets this week`;
}

export function recommend(sessions, { now = new Date(), profile, minutes, location } = {}) {
  now = toDate(now);
  minutes = Number(minutes) || profile?.defaultMinutes || 45;
  const entries = prep(sessions, now);
  const { groups: gs } = statusCore(entries, now, profile);
  const cardio = cardioStatus(sessions, { now, profile });

  const value = g => {
    const st = gs[g]; if (!st) return 0;
    const rf = st.readiness >= 0.5 ? 0.6 + 0.4 * st.readiness : st.readiness * 0.5;
    return st.need * rf;
  };
  const size = g => (SMALL.has(g) ? 0.6 : 1);
  const ideal = clamp(minutes / 20, 0.8, 4.5);
  const maxG = maxGroupsFor(minutes);

  const scored = [];
  for (const c of candidates()) {
    if (c.groups.length > maxG) continue;
    const load = c.groups.reduce((s, g) => s + size(g), 0);
    const wsum = c.groups.reduce((s, g) => s + size(g) * value(g), 0);
    const mean = wsum / load;
    const fit = Math.exp(-0.5 * ((load - ideal) / (0.45 * ideal + 0.4)) ** 2);
    const breadth = Math.min(1, c.groups.reduce((s, g) => s + value(g), 0) / ideal);
    const recovering = c.groups.some(g => (gs[g]?.readiness ?? 1) < 0.5);
    let score = (0.75 * mean * fit + 0.25 * breadth * fit) * 100;
    if (recovering) score *= 0.3;
    scored.push({ c, score, recovering });
  }
  scored.sort((a, b) => (a.recovering - b.recovering) || b.score - a.score);

  const viable = scored.filter(x => !x.recovering);
  let pick = viable.slice(0, 5);
  if (pick.length < 3) pick = pick.concat(scored.filter(x => x.recovering).slice(0, 3 - pick.length));

  const cardioReason = cardio.behind
    ? `Cardio: ${cardio.minutes7d}/${cardio.target} min this week. Add a ${clamp(Math.round((cardio.target - cardio.minutes7d) / 5) * 5, 10, 30)}-min Zone 2 finisher or do a cardio day.`
    : null;

  return pick.map(({ c, score, recovering }) => {
    const ordered = [...c.groups].sort((a, b) => (ADDON_ONLY.has(a) - ADDON_ONLY.has(b)) || value(b) - value(a));
    const reasons = ordered.slice(0, 3).map(g => groupReason(g, gs[g]));
    for (const g of c.groups) {
      const rd = gs[g]?.readiness ?? 1;
      if (rd < 0.8) reasons.push(`${groupName(g)} only ${Math.round(rd * 100)}% recovered${rd < 0.5 ? ' (better tomorrow)' : ''}`);
    }
    if (cardioReason) reasons.push(cardioReason);
    const targetId = c.single || c.preset ? c.id : c.groups.join('+');
    const targets = c.single || c.preset ? [c.id] : [...c.groups];
    return {
      targetId, label: c.label, score: Math.round(score * 10) / 10, reasons,
      groups: [...c.groups], targets, recovering, cardio: cardio.behind ? cardio.suggestion : null,
      location: location?.id || location || null,
    };
  });
}

// ---------------------------------------------------------------- summaries

export function weekSummary(sessions, { now = new Date() } = {}) {
  now = toDate(now);
  const from = ds(weekStart(now));
  let n = 0, liftSets = 0, cardioMinutes = 0;
  const byGroup = {};
  for (const e of prep(sessions, now)) {
    if (e.date < from) continue;
    n++; liftSets += e.v.liftSets; cardioMinutes += e.v.cardioMin;
    for (const [g, w] of Object.entries(e.v.groups)) byGroup[g] = r2((byGroup[g] || 0) + w);
  }
  return { sessions: n, liftSets, cardioMinutes: Math.round(cardioMinutes), byGroup, from };
}

export function streak(sessions, { now = new Date() } = {}) {
  now = toDate(now);
  const days = new Set(prep(sessions, now).map(e => e.date));
  let d = 0, cur = now;
  if (!days.has(ds(cur))) cur = addDays(cur, -1);     // today not logged yet doesn't break it
  while (days.has(ds(cur))) { d++; cur = addDays(cur, -1); }
  const weeks = new Set([...days].map(x => ds(weekStart(parseDs(x)))));
  let w = 0, wk = weekStart(now);
  if (!weeks.has(ds(wk))) wk = addDays(wk, -7);
  while (weeks.has(ds(wk))) { w++; wk = addDays(wk, -7); }
  return { days: d, weeksActive: w };
}
