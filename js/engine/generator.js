// Forge workout generator (ENGINE-B). Pure ES module, DOM-free.
//
// CONTRACT-NOTE: extra Session fields added by buildWorkout: `style` (string), `seed` (number),
//   `estMinutes` (number, per contract), `poolLimited` (boolean: true when the equipment/exercise
//   pool was too small to fill the time budget within ±10%). No extra Block fields.
// CONTRACT-NOTE: estimateMinutes(blocks) includes an automatic warm-up (3-6 min, scaled by lift
//   time) whenever the blocks contain lifts, because the time budget includes the warm-up.
// CONTRACT-NOTE: superset/circuit rest is encoded per block: every member except the last in a
//   group gets a short transition rest (10-15 s); the last member carries the shared round rest.
//   So "per set = work + rest" summed over blocks is the real elapsed time.
// CONTRACT-NOTE: alternatives()/exercisesFor() accept equipment as an array of ids or a Set;
//   undefined means "no equipment filter".

import { EXERCISES, getEx } from '../data/exercises.js';
import { REGIONS, GROUPS, PRESETS, regionsFor } from '../data/muscles.js';
import { SCULPT_GOALS, DEFAULT_SCULPT_GOALS } from '../data/sculpt.js';
import { DEFAULT_LOCATIONS, expandEquipment, canDo } from '../data/equipment.js';
import { suggest } from './progression.js';
import { recommend, muscleStatus, groupStatus } from './recovery.js';
import { ds, rng as makeRng, daysBetween, clamp } from '../util.js';

// ---------------------------------------------------------------- time model constants
export const TIME = {
  defaultSecPerRep: 3,
  defaultSetupSec: 30,
  transitionSec: 15,        // between superset members
  circuitTransitionSec: 10, // between circuit stations
  warmupMinMin: 3,
  warmupMaxMin: 6,
  warmupBaseMin: 2,         // warm-up = clamp(2 + liftMinutes/15, 3, 6)
  warmupPerLiftMin: 1 / 15,
};

const BIG_GROUPS = new Set(['chest', 'back', 'shoulders', 'quads', 'glutes', 'hamstrings']);
const ANTAGONIST = [
  ['horizontal_push', 'horizontal_pull'], ['vertical_push', 'vertical_pull'],
  ['horizontal_push', 'vertical_pull'], ['vertical_push', 'horizontal_pull'],
  ['elbow_flexion', 'elbow_extension'], ['knee_extension', 'knee_flexion'],
  ['fly', 'rear_delt'], ['squat', 'knee_flexion'], ['lunge', 'knee_flexion'],
  ['abduction', 'adduction'],
];
const COMPLEMENT = {
  biceps: ['triceps', 'forearms', 'back'], triceps: ['biceps', 'shoulders', 'chest'],
  chest: ['triceps', 'shoulders', 'back'], back: ['biceps', 'shoulders', 'core'],
  shoulders: ['triceps', 'back', 'core'], forearms: ['biceps', 'triceps'],
  core: ['shoulders', 'glutes', 'back'], glutes: ['hamstrings', 'core', 'quads'],
  quads: ['glutes', 'core', 'hamstrings'], hamstrings: ['glutes', 'core', 'quads'],
  calves: ['core', 'quads'],
};

const regionGroup = r => REGIONS[r]?.group || Object.values(GROUPS).find(g => g.regions.includes(r))?.id || null;

// ---------------------------------------------------------------- small helpers
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function toEqSet(equipment) {
  if (equipment == null) return null;
  if (equipment instanceof Set) return expandEquipment([...equipment]);
  return expandEquipment(equipment);
}
function primaryRegion(ex) {
  let best = null, bw = -1;
  for (const [r, w] of Object.entries(ex.muscles || {})) if (w > bw) { best = r; bw = w; }
  return best;
}
function primaryGroup(ex) { return regionGroup(primaryRegion(ex)); }
function mainRegions(ex) {
  const m = ex.muscles || {}; const top = Math.max(0, ...Object.values(m));
  return Object.keys(m).filter(r => m[r] >= Math.max(0.5, top * 0.75));
}
export function isBackSquat(ex) {
  const s = (ex.id + ' ' + (ex.name || '')).toLowerCase();
  if (/back[_ ]squat/.test(s)) return true;
  if (ex.pattern !== 'squat' || !(ex.equipment || []).includes('barbell')) return false;
  return !/front|zercher|split|bulgarian|lunge|landmine|hack|belt/.test(s);
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] || 0, y = b[k] || 0; dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
function isAntagonist(a, b) {
  return ANTAGONIST.some(([p, q]) => (a.pattern === p && b.pattern === q) || (a.pattern === q && b.pattern === p));
}
function competes(a, b) {
  const ma = new Set(mainRegions(a));
  return mainRegions(b).some(r => ma.has(r)) || primaryGroup(a) === primaryGroup(b);
}
const midReps = t => Math.round(((t.repMin ?? 8) + (t.repMax ?? 12)) / 2);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const lc = s => (s || '').charAt(0).toLowerCase() + (s || '').slice(1);
function shortWhy(w) {
  let t = String(w).split(/[.;:]\s|\.$/)[0].split(/,\s(?:which|so|and|because|while)\s/)[0].trim();
  if (t.length > 70) t = t.slice(0, 70).replace(/\s+\S*$/, '') + '…';
  return lc(t);
}
function safe(fn, fallback) { try { const v = fn(); return v == null ? fallback : v; } catch { return fallback; } }

// ---------------------------------------------------------------- style: reps & rest
function repRangeFor(ex, style) {
  const [lo0, hi0] = ex.repRange || [8, 12];
  if (ex.unit === 'seconds') {
    if (style === 'pump' || style === 'circuit') return [Math.max(lo0, 30), Math.max(hi0, 45)];
    return [lo0, hi0];
  }
  const comp = ex.category === 'compound';
  switch (style) {
    case 'strength':
      return comp ? [Math.max(3, Math.min(lo0, 5)), Math.max(5, Math.min(hi0, 8))] : [Math.max(6, lo0), Math.max(8, Math.min(hi0, 12))];
    case 'pump':
      return [Math.max(lo0, comp ? 10 : 12), Math.max(hi0, comp ? 15 : 20)];
    case 'circuit':
      return [Math.max(lo0, 10), Math.max(hi0, 15)];
    default: { // hypertrophy: 6-15 compounds, up to 20 for isolations
      const lo = Math.max(lo0, 6), hiCap = comp ? 15 : 20;
      return [Math.min(lo, hiCap - 2), clamp(hi0, lo + 2, hiCap)];
    }
  }
}
function soloRest(ex, style) {
  const comp = ex.category === 'compound', heavy = (ex.fatigue || 1) >= 3;
  switch (style) {
    case 'strength': return comp ? (heavy ? 180 : 150) : 75;
    case 'pump': return comp ? 60 : 45;
    case 'circuit': return 60;
    default: return comp ? (heavy ? 120 : 90) : 60;
  }
}
function roundRest(members, style, minutes) {
  const anyComp = members.some(e => e.category === 'compound');
  switch (style) {
    case 'strength': return anyComp ? 120 : 75;
    case 'pump': return members.length > 2 ? 45 : (anyComp ? 45 : 30);
    case 'circuit': return minutes <= 20 ? 60 : 75;
    default: return minutes <= 25 ? (anyComp ? 60 : 45) : (anyComp ? 75 : 60);
  }
}
const defaultSets = (ex, style, minutes) => {
  if (style === 'strength') return ex.category === 'compound' ? 4 : 3;
  if (style === 'circuit') return 3;
  return ex.category === 'compound' && minutes >= 60 ? 4 : 3;
};

// ---------------------------------------------------------------- blocks & estimation
function makeTarget(ex, style, sets, rest, sessions, now, cache) {
  const [repMin, repMax] = repRangeFor(ex, style);
  const t = { sets, repMin, repMax, rest, weight: null, reps: null, note: null };
  const key = ex.id + '|' + repMin + '|' + repMax;
  let s = cache ? cache.get(key) : null;
  if (!s) {
    s = safe(() => suggest(ex.id, { sets, repMin, repMax }, sessions || [], { now }), null);
    if (cache) cache.set(key, s || {});
  }
  if (s) {
    t.weight = s.weight ?? null;
    t.reps = Number.isFinite(s.reps) ? s.reps : repMin;
    const note = [s.lastText, s.reason].filter(Boolean).join(' · ');
    t.note = note || null;
  } else t.reps = repMin;
  return t;
}
function liftBlock(ex, style, sets, rest, group, sessions, now, cache) {
  return {
    kind: 'lift', exId: ex.id, group: group || null,
    target: makeTarget(ex, style, sets, rest, sessions, now, cache),
    sets: Array.from({ length: sets }, () => ({ w: null, r: null, done: false })),
  };
}

function liftSeconds(blocks) {
  let sec = 0;
  for (const b of blocks || []) {
    if (b.kind !== 'lift') continue;
    const ex = getEx(b.exId) || {};
    const t = b.target || {};
    const sets = t.sets ?? (b.sets || []).length;
    const reps = t.reps ?? midReps(t);
    const work = reps * (ex.secPerRep ?? TIME.defaultSecPerRep) * (ex.unilateral ? 2 : 1);
    sec += (ex.setupSec ?? TIME.defaultSetupSec) + sets * (work + (t.rest ?? 60));
  }
  return sec;
}
function estimateSeconds(blocks) {
  const lift = liftSeconds(blocks);
  const liftMin = lift / 60;
  const warm = lift > 0 ? clamp(TIME.warmupBaseMin + liftMin * TIME.warmupPerLiftMin, TIME.warmupMinMin, TIME.warmupMaxMin) : 0;
  let other = 0;
  for (const b of blocks || []) {
    if (b.kind === 'cardio') other += +b.minutes || 0;
    else if (b.kind === 'class') other += +b.duration || +b.minutes || 0;
  }
  return lift + (warm + other) * 60;
}
export function estimateMinutes(blocks) { return Math.round(estimateSeconds(blocks) / 60); }

// ---------------------------------------------------------------- target resolution
function resolveTargets(targets) {
  // → { regionW: {region: weight}, sculpt: [goalId], labels: [string], groups: [groupId] }
  const regionW = {}, sculpt = [], labels = [];
  const add = (r, w) => { if (REGIONS[r] || regionGroup(r)) regionW[r] = Math.max(regionW[r] || 0, w); };
  for (const t of targets) {
    if (SCULPT_GOALS[t]) {
      const g = SCULPT_GOALS[t]; sculpt.push(t);
      for (const [r, w] of Object.entries(g.regions || {})) add(r, Math.max(0.5, w));
      for (const r of (GROUPS[g.group]?.regions || [])) add(r, 0.35);
      if (GROUPS[g.group]) labels.push(GROUPS[g.group].name);
      continue;
    }
    const rs = safe(() => regionsFor(t), []);
    if (!rs.length) continue;
    for (const r of rs) add(r, 1);
    labels.push(PRESETS[t]?.name || GROUPS[t]?.name || REGIONS[t]?.name || cap1(t.replace(/_/g, ' ')));
  }
  const groups = [...new Set(Object.keys(regionW).map(regionGroup).filter(Boolean))];
  return { regionW, sculpt, labels: [...new Set(labels)], groups };
}

// ---------------------------------------------------------------- planner
function recentExercises(sessions, now) {
  const out = new Set();
  for (const s of sessions || []) {
    if (!s || !s.date) continue;
    const d = safe(() => daysBetween(s.date, now), 999);
    if (d < 0 || d > 21) continue;
    for (const b of s.blocks || []) if (b.kind === 'lift' && (b.sets || []).some(x => x.done)) out.add(b.exId);
  }
  return out;
}

// An exercise belongs in the pool when its prime mover is a requested region, or most of its
// credit lands on requested regions (keeps trap-bar deadlifts and carries off a lat day).
function onTarget(ex, rw) {
  const pr = primaryRegion(ex);
  if (pr && rw[pr]) return true;
  let on = 0, all = 0;
  for (const [r, w] of Object.entries(ex.muscles || {})) { all += w; if (rw[r]) on += w; }
  return all > 0 && on / all >= 0.5 && Object.entries(ex.muscles).some(([r, w]) => w >= 0.5 && rw[r]);
}

function groupMeanMin(r) {
  const rs = GROUPS[regionGroup(r)]?.regions || [r];
  const v = rs.map(x => REGIONS[x]?.weeklySets?.min || 0).filter(x => x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 1;
}

function makeCtx(opts) {
  const { minutes, style, profile, sessions, now, eq, exclude, rw, activeGoals, targetGoals, seed } = opts;
  const avoid = new Set([...(exclude || []), ...((profile && profile.avoidExercises) || [])]);
  const recent = recentExercises(sessions, now);
  const favs = new Set((profile && profile.favoriteExercises) || []);
  const mstat = safe(() => muscleStatus(sessions || [], { now, profile }), {});
  const activeTags = new Set(activeGoals.map(g => SCULPT_GOALS[g]?.emphasisTag || g));
  const targetTags = new Set(targetGoals.map(g => SCULPT_GOALS[g]?.emphasisTag || g));

  // region weights: requested × need × priority × sculpt boost × readiness
  const weights = {};
  for (const [r, base] of Object.entries(rw)) {
    const st = mstat[r] || {};
    const need = Number.isFinite(st.need) ? st.need : 0.6;
    const pr = REGIONS[r]?.priority ?? 1;
    let boost = 1;
    for (const gid of activeGoals) boost += 0.25 * (SCULPT_GOALS[gid]?.regions?.[r] || 0); // need already includes sculpt extras
    for (const gid of targetGoals) boost += 0.8 * (SCULPT_GOALS[gid]?.regions?.[r] || 0);
    const ready = Number.isFinite(st.readiness) && st.readiness < 0.5 ? 0.6 : 1;
    // REGIONS.priority weights need; groupPriority/sculpt extras are already inside need's targets
    // within a group, regions get their natural share (lats > lower back) via weekly set targets
    const share = REGIONS[r]?.weeklySets?.min ? REGIONS[r].weeklySets.min / groupMeanMin(r) : 1;
    weights[r] = base * share * (0.35 + need * pr) * boost * ready;
  }
  const pool = EXERCISES.filter(ex =>
    ex && ex.muscles && !avoid.has(ex.id) && !isBackSquat(ex) && (!eq || canDo(ex, eq)) &&
    (ex.pattern !== 'conditioning' || style === 'circuit') &&
    onTarget(ex, rw));
  return { minutes, style, profile, sessions, now, eq, weights, pool, recent, favs, activeTags, targetTags,
    rand: makeRng(seed), cache: new Map(), mstat };
}

function groupCap(g, minutes) {
  const base = BIG_GROUPS.has(g) ? 10 : 8;
  return minutes >= 75 ? Math.round(base * 1.2) : base;
}

function credits(items) {
  const reg = {}, grp = {};
  for (const it of items) {
    const perGroup = {};
    for (const [r, w] of Object.entries(it.ex.muscles)) {
      reg[r] = (reg[r] || 0) + w * it.sets;
      const g = regionGroup(r); if (g) perGroup[g] = Math.max(perGroup[g] || 0, w);
    }
    for (const [g, w] of Object.entries(perGroup)) grp[g] = (grp[g] || 0) + w * it.sets;
  }
  return { reg, grp };
}

function desiredSets(ctx, budgetSec) {
  const perSet = { hypertrophy: 115, pump: 80, strength: 170, circuit: 65 }[ctx.style] || 115;
  const total = Math.max(4, budgetSec / perSet);
  const sumW = Object.values(ctx.weights).reduce((s, x) => s + x, 0) || 1;
  const d = {};
  for (const [r, w] of Object.entries(ctx.weights)) d[r] = total * w / sumW;
  return d;
}

function scoreEx(ex, items, ctx, desired, { novelty = false, relaxed = false } = {}) {
  const { reg, grp } = credits(items);
  let serve = 0;
  for (const [r, w] of Object.entries(ex.muscles)) {
    const want = desired[r]; if (!want) continue;
    serve += w * Math.max(want - (reg[r] || 0), 0.08 * want);
  }
  if (serve <= 0) return -Infinity;
  let m = 1;
  // penalise moves whose volume mostly lands outside the requested muscles (RDL on a back day)
  let on = 0, all = 0;
  for (const [r, w] of Object.entries(ex.muscles)) { all += w; if (desired[r]) on += w; }
  m *= 0.4 + 0.6 * (all ? on / all : 0);
  if ((ex.difficulty || 1) >= 3) m *= 0.75;
  if (ex.pattern === 'carry' && !desired.forearms) m *= 0.6;
  const tags = ex.emphasis || [];
  for (const t of tags) { if (ctx.targetTags.has(t)) m *= 1.6; else if (ctx.activeTags.has(t)) m *= 1.2; }
  const isRecent = ctx.recent.has(ex.id);
  if (ctx.recent.size) m *= novelty ? (isRecent ? 0.75 : 1.4) : (isRecent ? 1.35 : 1);
  if (ctx.favs.has(ex.id)) m *= 1.3;
  const eqs = ex.equipment || [];
  if (eqs.includes('barbell')) m *= 0.55; else if (eqs.includes('smith')) m *= 0.85;
  const pr = primaryRegion(ex);
  if (!relaxed) {
    if (items.some(it => it.ex.pattern === ex.pattern && primaryRegion(it.ex) === pr)) m *= 0.3;
    else if (items.some(it => it.ex.pattern === ex.pattern)) m *= 0.75;
  }
  if ((ex.fatigue || 1) >= 3) {
    const n3 = items.filter(it => (it.ex.fatigue || 1) >= 3).length;
    if (n3 >= 1) m *= ctx.minutes <= 30 ? 0.2 : 0.5;
    if (ctx.minutes <= 20) m *= 0.7;
  }
  if (ctx.style === 'strength' && ex.category === 'compound') m *= 1.3;
  if (ctx.style === 'circuit' || ctx.minutes <= 25) m *= 1 - Math.min(0.5, (ex.setupSec ?? 30) / 300);
  if (ctx.minutes <= 25 && ex.unilateral) m *= 0.8;
  // compounds early: modest preference while the plan is still small
  if (ex.category === 'compound' && items.length < 3) m *= 1.15;
  const g = primaryGroup(ex);
  if (!relaxed && g && (grp[g] || 0) + 2 > groupCap(g, ctx.minutes)) return -Infinity; // group full: let a complement fill time
  m *= 0.9 + 0.2 * ctx.rand();
  return serve * m;
}

function orderItems(items) {
  const idx = new Map(items.map((it, i) => [it, i]));
  return [...items].sort((a, b) => {
    const ca = a.ex.category === 'compound' ? 0 : 1, cb = b.ex.category === 'compound' ? 0 : 1;
    if (ca !== cb) return ca - cb;
    if (ca === 0 && (b.ex.fatigue || 1) !== (a.ex.fatigue || 1)) return (b.ex.fatigue || 1) - (a.ex.fatigue || 1);
    return idx.get(a) - idx.get(b);
  });
}

function pairUp(list, allowTri) {
  const units = [], rest = [...list];
  while (rest.length) {
    const a = rest.shift();
    let bi = -1, bs = -1;
    rest.forEach((b, i) => {
      if (competes(a.ex, b.ex)) return;
      if ((a.ex.fatigue || 1) >= 3 && (b.ex.fatigue || 1) >= 3) return;
      const s = (isAntagonist(a.ex, b.ex) ? 3 : 1) + (a.ex.category === b.ex.category ? 0.5 : 0) - i * 0.01;
      if (s > bs) { bs = s; bi = i; }
    });
    if (bi < 0 && allowTri) {
      // single-muscle short session: pair with the least-overlapping move (compound + isolation set)
      rest.forEach((b, i) => {
        if ((a.ex.fatigue || 1) >= 3 && (b.ex.fatigue || 1) >= 3) return;
        const s = 1 - cosine(a.ex.muscles, b.ex.muscles) + (a.ex.category !== b.ex.category ? 0.3 : 0) - i * 0.01;
        if (s > bs) { bs = s; bi = i; }
      });
    }
    if (bi >= 0) units.push([a, ...rest.splice(bi, 1)]); else units.push([a]);
  }
  if (allowTri) {
    // fold a leftover solo into a compatible pair → tri-set (no standalone straggler)
    for (let i = units.length - 1; i >= 0; i--) {
      if (units[i].length !== 1 || units.length < 2) continue;
      const solo = units[i][0];
      const host = units.find(u => u.length === 2 && u.every(x => !competes(x.ex, solo.ex))) ||
        [...units].reverse().find(u => u.length === 2 && u.every(x => (x.ex.fatigue || 1) + (solo.ex.fatigue || 1) < 6));
      if (host) { host.push(solo); units.splice(i, 1); }
    }
  }
  return units;
}

function arrange(items, ctx) {
  const ordered = orderItems(items);
  if (ordered.length <= 1) return ordered.map(x => [x]);
  if (ctx.style === 'circuit') {
    if (ordered.length <= 6) return [ordered];
    const h = Math.ceil(ordered.length / 2);
    return [ordered.slice(0, h), ordered.slice(h)];
  }
  if (ctx.minutes <= 25 || ctx.style === 'pump') return pairUp(ordered, true);
  if (ctx.style === 'strength') return ordered.map(x => [x]);
  const comps = ordered.filter(x => x.ex.category === 'compound');
  const isos = ordered.filter(x => x.ex.category !== 'compound');
  return [...comps.map(x => [x]), ...pairUp(isos, false)];
}

function materialize(plan, ctx) {
  const units = arrange(plan.items, ctx);
  const blocks = [];
  let letter = 0;
  for (const u of units) {
    const sets = Math.max(...u.map(x => x.sets));
    u.forEach(x => { x.sets = sets; });
    const group = u.length > 1 ? String.fromCharCode(65 + letter++) : null;
    const shared = u.length > 1 ? roundRest(u.map(x => x.ex), ctx.style, ctx.minutes) : soloRest(u[0].ex, ctx.style);
    const rest = Math.max(20, Math.round(shared * plan.restScale / 5) * 5);
    const trans = ctx.style === 'circuit' ? TIME.circuitTransitionSec : TIME.transitionSec;
    u.forEach((x, j) => blocks.push(liftBlock(x.ex, ctx.style, sets, (u.length > 1 && j < u.length - 1) ? trans : rest,
      group, ctx.sessions, ctx.now, ctx.cache)));
  }
  return { blocks, units };
}

function exRange(minutes, style) {
  let r = minutes <= 25 ? [2, 4] : minutes <= 35 ? [3, 6] : minutes <= 52 ? [4, 7] : minutes <= 67 ? [5, 8] : [7, 10];
  if (style === 'circuit') r = [r[0] + 1, r[1] + 2];
  if (style === 'strength') r = [Math.max(2, r[0] - 1), Math.max(3, r[1] - 2)];
  return r;
}

function planSession(ctx, budgetMin, otherMin) {
  const budgetSec = Math.max(0, budgetMin - otherMin) * 60;
  const total = budgetMin * 60;
  const desired = desiredSets(ctx, budgetSec);
  const [lo, hi] = exRange(budgetMin, ctx.style);
  const plan = { items: [], restScale: 1 };
  const est = () => estimateSeconds(materialize(plan, ctx).blocks) + otherMin * 60;
  const noveltySlot = ctx.recent.size ? 1 + Math.floor(ctx.rand() * Math.max(1, hi - 1)) : -1;
  let novelPick = null;

  const pickNext = (relaxed) => {
    const used = new Set(plan.items.map(x => x.ex.id));
    const novelty = plan.items.length === noveltySlot && !novelPick;
    let best = null, bs = -Infinity;
    for (const ex of ctx.pool) {
      if (used.has(ex.id)) continue;
      const s = scoreEx(ex, plan.items, ctx, desired, { novelty, relaxed });
      if (s > bs) { bs = s; best = ex; }
    }
    if (best && novelty && !ctx.recent.has(best.id)) novelPick = best;
    return best;
  };

  // 1. greedy fill with default sets
  while (plan.items.length < hi) {
    const ex = pickNext(false); if (!ex) break;
    plan.items.push({ ex, sets: defaultSets(ex, ctx.style, budgetMin) });
    if (plan.items.length >= lo && est() >= total * 0.92) break;
  }

  // 2. tune sets / exercises / rest to land on budget
  const tune = (relaxed) => {
    const maxSets = relaxed ? 6 : (ctx.style === 'strength' ? 6 : ctx.style === 'circuit' ? 4 : 5);
    const minSets = 2;
    const hiEx = relaxed ? hi + 4 : hi;
    const restLo = 0.75, restHi = relaxed ? 1.5 : 1.3;
    for (let iter = 0; iter < 80; iter++) {
      const cur = est(); const diff = Math.abs(cur - total) / total;
      if (diff <= 0.03) return;
      const moves = [];
      const units = arrange(plan.items, ctx);
      const { grp } = credits(plan.items);
      const unitNeed = u => u.reduce((s, x) => s + Object.entries(x.ex.muscles).reduce((a, [r, w]) => a + w * (desired[r] || 0), 0), 0);
      const maxNeed = Math.max(1e-6, ...units.map(unitNeed));
      if (cur < total) {
        for (const u of units) {
          if (u.some(x => x.sets >= maxSets)) continue;
          if (!relaxed && u.some(x => { const g = primaryGroup(x.ex); return g && (grp[g] || 0) + 1 > groupCap(g, ctx.minutes); })) continue;
          moves.push({ pen: 0.01 * (1 - unitNeed(u) / maxNeed) + 0.004 * u[0].sets, apply: () => u.forEach(x => x.sets++), undo: () => u.forEach(x => x.sets--) });
        }
        if (plan.items.length < hiEx) {
          const ex = pickNext(relaxed);
          if (ex) {
            const it = { ex, sets: ctx.style === 'circuit' ? (plan.items[0]?.sets || 3) : Math.max(minSets, defaultSets(ex, ctx.style, budgetMin) - 1) };
            moves.push({ pen: plan.items.length < lo ? 0 : 0.012, apply: () => plan.items.push(it), undo: () => plan.items.pop() });
          }
        }
        if (plan.restScale < restHi - 1e-9) moves.push({ pen: 0.02, apply: () => { plan.restScale += 0.1; }, undo: () => { plan.restScale -= 0.1; } });
      } else {
        for (const u of units) {
          if (u.some(x => x.sets <= minSets)) continue;
          moves.push({ pen: 0.002 + 0.01 * (unitNeed(u) / maxNeed), apply: () => u.forEach(x => x.sets--), undo: () => u.forEach(x => x.sets++) });
        }
        if (plan.items.length > Math.max(1, lo)) {
          let wi = 0, ws = Infinity;
          plan.items.forEach((x, i) => { const n = unitNeed([x]) * (x.ex.category === 'compound' ? 1.3 : 1); if (n < ws) { ws = n; wi = i; } });
          const removed = plan.items[wi];
          moves.push({ pen: 0.02, apply: () => plan.items.splice(wi, 1), undo: () => plan.items.splice(wi, 0, removed) });
        } else if (plan.items.length > 1 && cur > total * 1.1) {
          const removed = plan.items[plan.items.length - 1];
          moves.push({ pen: 0.05, apply: () => plan.items.pop(), undo: () => plan.items.push(removed) });
        }
        if (plan.restScale > restLo + 1e-9) moves.push({ pen: 0.015, apply: () => { plan.restScale -= 0.1; }, undo: () => { plan.restScale += 0.1; } });
      }
      let best = null, bc = diff;
      const snap = plan.items.map(x => x.sets);
      for (const mv of moves) {
        const before = plan.items.map(x => [x, x.sets]);
        mv.apply();
        const c = Math.abs(est() - total) / total + mv.pen;
        mv.undo();
        before.forEach(([x, s]) => { x.sets = s; }); // materialize equalizes sets; restore exactly
        if (c < bc) { bc = c; best = mv; }
      }
      plan.items.forEach((x, i) => { if (snap[i] != null) x.sets = snap[i]; });
      if (!best) return;
      best.apply();
    }
  };
  tune(false);
  return { plan, est, tune, novelPick, desired };
}

// ---------------------------------------------------------------- buildWorkout
export function buildWorkout({
  targets = [], minutes = 45, location, profile, sessions = [], now = new Date(),
  style = 'hypertrophy', cardio = null, seed, exclude = [],
} = {}) {
  sessions = sessions || [];
  profile = profile || {};
  location = location || DEFAULT_LOCATIONS[0];
  minutes = clamp(Math.round(+minutes || 45), 5, 180);
  if (!['hypertrophy', 'pump', 'strength', 'circuit'].includes(style)) style = 'hypertrophy';
  const eq = expandEquipment(location.equipment || ['bodyweight']);
  const activeGoals = (profile.sculptGoals || DEFAULT_SCULPT_GOALS).filter(g => SCULPT_GOALS[g]);
  const rationale = [];

  // --- resolve targets (or ask recovery for a recommendation)
  let tgts = (targets || []).filter(Boolean);
  let res = resolveTargets(tgts);
  let autoLabel = null;
  if (!Object.keys(res.regionW).length) {
    const recs = safe(() => recommend(sessions, { now, profile, minutes, location }), []);
    // Combo recs have targetId like 'chest+triceps'; rec.targets is always a list of valid ids.
    const recTargets = r => (Array.isArray(r?.targets) && r.targets.length ? r.targets : [r?.targetId]).filter(Boolean);
    const top = recs.find(r => r && resolveTargets(recTargets(r)).groups.length) || null;
    tgts = top ? recTargets(top) : ['full'];
    res = resolveTargets(tgts);
    autoLabel = top?.label || null;
    const why = (top?.reasons || []).slice(0, 2);
    rationale.push(`Recommended today: ${top?.label || res.labels.join(' & ') || 'Full body'}${why.length ? ' (' + why.join('; ') + ')' : ''}`);
  }
  if (seed == null) seed = hashStr(ds(now) + '|' + tgts.join(',') + '|' + (location.id || '') + '|' + minutes + '|' + style);
  seed = Number(seed) >>> 0;

  // --- cardio finisher
  let cardioBlock = null;
  if (cardio && cardio.modality) {
    const cm = clamp(Math.round(+cardio.minutes || 10), 1, minutes);
    cardioBlock = { kind: 'cardio', modality: cardio.modality, minutes: cm, intensity: cardio.intensity || 'moderate',
      distance: null, calories: null, done: false, note: null };
  }
  const otherMin = cardioBlock ? cardioBlock.minutes : 0;
  const liftRoom = minutes - otherMin;

  let blocks = [], poolLimited = false, planInfo = null, ctx = null;
  const addedGroups = [];
  if (liftRoom >= 8) {
    const targetGoals = res.sculpt;
    const mk = (rw) => makeCtx({ minutes, style, profile, sessions, now, eq, exclude, rw, activeGoals: [...new Set([...activeGoals, ...targetGoals])], targetGoals, seed });
    let rw = { ...res.regionW };
    ctx = mk(rw);
    planInfo = planSession(ctx, minutes, otherMin);
    // Under budget even after tuning? Add a complementary group rather than junk volume.
    for (let k = 0; k < 3 && planInfo.est() < minutes * 60 * 0.9; k++) {
      const gs = safe(() => groupStatus(sessions, { now, profile }), {});
      const cands = [...new Set(res.groups.flatMap(g => COMPLEMENT[g] || []))]
        .filter(g => GROUPS[g] && !res.groups.includes(g) && !addedGroups.includes(g))
        .map(g => [g, (gs[g]?.need ?? 0.5) * (1 - 0.25 * Math.min(...res.groups.map(x => { const i = (COMPLEMENT[x] || []).indexOf(g); return i < 0 ? 3 : i; })))])
        .sort((a, b) => b[1] - a[1]).map(x => x[0]);
      if (!cands.length) break;
      const g = cands[0]; addedGroups.push(g);
      for (const r of GROUPS[g].regions) rw[r] = Math.max(rw[r] || 0, 0.45);
      ctx = mk(rw);
      planInfo = planSession(ctx, minutes, otherMin);
    }
    if (planInfo.est() < minutes * 60 * 0.9) planInfo.tune(true);
    blocks = materialize(planInfo.plan, ctx).blocks;
    // final pass: run progression with the real set counts
    blocks = blocks.map(b => {
      const ex = getEx(b.exId);
      return { ...b, target: makeTarget(ex, style, b.target.sets, b.target.rest, sessions, now, null) };
    });
  }
  if (cardioBlock) blocks.push(cardioBlock);
  let estSec = estimateSeconds(blocks);
  if (estSec < minutes * 60 * 0.9) poolLimited = true;

  // --- rationale
  const lifts = blocks.filter(b => b.kind === 'lift');
  const exs = lifts.map(b => getEx(b.exId)).filter(Boolean);
  if (!autoLabel && res.groups.length) {
    const gs = safe(() => groupStatus(sessions, { now, profile }), {});
    const bits = res.groups.filter(g => gs[g]).sort((a, b) => (gs[b].need ?? 0) - (gs[a].need ?? 0)).slice(0, 2).map(g => {
      const s = gs[g]; const tgt = s.target?.min ?? s.target;
      const sets = Number.isFinite(s.sets7d) ? Math.round(s.sets7d * 10) / 10 : null;
      const parts = [];
      if (sets != null && tgt) parts.push(`${sets}/${tgt} sets this week`);
      if (Number.isFinite(s.daysSince)) parts.push(`${s.daysSince}d since last`);
      return GROUPS[g].name + (parts.length ? ` (${parts.join(', ')})` : '');
    });
    if (bits.length) rationale.push('Focus: ' + bits.join('; '));
  }
  if (addedGroups.length) rationale.push(`Added ${addedGroups.map(g => GROUPS[g].name.toLowerCase()).join(' & ')} to fill ${minutes} min without junk volume`);
  if (lifts.length) {
    const nSets = lifts.reduce((s, b) => s + b.target.sets, 0);
    const grouped = new Set(lifts.filter(b => b.group).map(b => b.group)).size;
    const how = style === 'circuit' ? 'circuit, minimal rest'
      : grouped ? `${grouped} superset${grouped > 1 ? 's' : ''} to fit more work` : 'straight sets';
    rationale.push(`${minutes} min: ${exs.length} exercises, ${nSets} working sets, ${how}`);
  }
  // key exercises tied to sculpt goals
  const goalForTag = tag => Object.values(SCULPT_GOALS).find(g => (g.emphasisTag || g.id) === tag);
  const keyBits = [];
  const allTags = new Set([...(ctx ? ctx.targetTags : []), ...(ctx ? ctx.activeTags : [])]);
  for (const ex of exs) {
    const tag = (ex.emphasis || []).find(t => ctx && ctx.targetTags.has(t)) || (ex.emphasis || []).find(t => allTags.has(t));
    if (!tag) continue;
    const g = goalForTag(tag);
    if (!g || !(res.sculpt.includes(g.id) || res.groups.includes(g.group))) continue;
    if (keyBits.some(k => k.g === g.id)) continue;
    const why = ex.why ? ` (${shortWhy(ex.why)})` : '';
    keyBits.push({ g: g.id, text: `${ex.name} for ${g.name.toLowerCase()}${why}` });
    if (keyBits.length >= 2) break;
  }
  keyBits.forEach(k => rationale.push(k.text));
  if (planInfo?.novelPick && exs.some(e => e.id === planInfo.novelPick.id)) rationale.push(`New this time: ${planInfo.novelPick.name} for variety`);
  if (cardioBlock) rationale.push(`${cardioBlock.minutes} min ${cardioBlock.modality.replace(/_/g, ' ')} finisher (${cardioBlock.intensity})`);
  if (poolLimited) {
    rationale.unshift(lifts.length
      ? `Only ${ctx ? ctx.pool.length : exs.length} suitable exercises for this equipment, so this plan runs ~${Math.round(estSec / 60)} of ${minutes} min. Add a muscle group or equipment to fill it.`
      : `Not enough time or equipment for lifting here; ~${Math.round(estSec / 60)} of ${minutes} min planned.`);
  }
  while (rationale.length < 2) rationale.push(style === 'hypertrophy' ? 'Hypertrophy: 2-3 reps in reserve, add reps before weight' : `Style: ${style}`);

  // --- title
  const base = autoLabel || res.labels.slice(0, 3).join(' & ') || 'Workout';
  let suffix = res.sculpt.map(g => SCULPT_GOALS[g].name)[0] || null;
  if (!suffix && keyBits.length) {
    const g = SCULPT_GOALS[keyBits[0].g];
    if (g && res.groups.includes(g.group)) suffix = g.name;
  }
  let title = base + (suffix && !base.includes(suffix) ? ' · ' + suffix : '');
  if (style === 'circuit') title += ' Circuit'; else if (style === 'pump') title += ' Pump';
  if (!lifts.length && cardioBlock) title = cap1(cardioBlock.modality.replace(/_/g, ' '));

  return {
    id: 's_' + now.getTime(), date: ds(now), status: 'planned', startedAt: null, endedAt: null,
    location: location.id || 'home', minutes, title, targets: tgts, source: 'generated',
    blocks, rationale: rationale.slice(0, 6), notes: '',
    estMinutes: Math.round(estSec / 60), style, seed, poolLimited,
  };
}

// ---------------------------------------------------------------- alternatives / swap / add
export function alternatives(exId, { equipment, exclude = [], limit = 8 } = {}) {
  const ex = getEx(exId); if (!ex) return [];
  const eq = toEqSet(equipment);
  const ex2 = new Set(exclude || []);
  const mains = mainRegions(ex);
  const listed = new Set(ex.alt || []);
  const scored = [];
  for (const e of EXERCISES) {
    if (e.id === exId || ex2.has(e.id) || isBackSquat(e) || (eq && !canDo(e, eq))) continue;
    const sharesMain = mains.some(r => (e.muscles?.[r] || 0) >= 0.5);
    const sim = cosine(ex.muscles || {}, e.muscles || {});
    if (!sharesMain && sim < 0.4) continue;
    const score = (sharesMain ? 2 : 0) + (e.pattern === ex.pattern ? 1 : 0) + sim * 1.5 +
      (e.category === ex.category ? 0.2 : 0) + (listed.has(e.id) ? 0.5 : 0) - ((e.equipment || []).includes('barbell') ? 0.2 : 0);
    scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].id.localeCompare(b[1].id));
  return scored.slice(0, limit).map(x => x[1]);
}

function cloneSession(s) { return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)); }

export function swapBlock(session, blockIndex, newExId, { sessions = [], now = new Date() } = {}) {
  const s = cloneSession(session);
  const ex = getEx(newExId);
  const old = s.blocks?.[blockIndex];
  if (!ex || !old) return s;
  const style = s.style || 'hypertrophy';
  const sets = old.kind === 'lift' ? (old.target?.sets ?? old.sets?.length ?? 3) : defaultSets(ex, style, s.minutes || 45);
  let rest;
  if (old.kind === 'lift' && old.target?.rest != null) {
    const oldEx = getEx(old.exId);
    // keep superset transition rests; otherwise adapt rest to the new exercise's category
    rest = old.group || !oldEx || oldEx.category === ex.category ? old.target.rest : soloRest(ex, style);
  } else rest = soloRest(ex, style);
  s.blocks[blockIndex] = liftBlock(ex, style, sets, rest, old.kind === 'lift' ? old.group : null, sessions, now, null);
  s.estMinutes = estimateMinutes(s.blocks);
  return s;
}

export function addExercise(session, exId, { sessions = [], now = new Date() } = {}) {
  const s = cloneSession(session);
  const ex = getEx(exId);
  if (!ex) return s;
  const style = s.style || 'hypertrophy';
  s.blocks = s.blocks || [];
  const b = liftBlock(ex, style, style === 'strength' && ex.category === 'compound' ? 4 : 3, soloRest(ex, style), null, sessions, now, null);
  // insert before any trailing cardio/class finisher
  let at = s.blocks.length;
  while (at > 0 && s.blocks[at - 1].kind !== 'lift') at--;
  if (!s.blocks.some(x => x.kind === 'lift')) at = 0;
  s.blocks.splice(at, 0, b);
  s.estMinutes = estimateMinutes(s.blocks);
  return s;
}

export function exercisesFor(targetId, equipmentSet, { sculptGoals = [] } = {}) {
  const res = resolveTargets([targetId]);
  const rw = res.regionW;
  if (!Object.keys(rw).length) return [];
  const eq = toEqSet(equipmentSet);
  const tags = new Set([...(sculptGoals || []), ...res.sculpt].map(g => SCULPT_GOALS[g]?.emphasisTag || g));
  const scored = [];
  for (const e of EXERCISES) {
    if (isBackSquat(e) || (eq && !canDo(e, eq))) continue;
    let s = 0, hit = false;
    for (const [r, w] of Object.entries(e.muscles || {})) {
      if (!rw[r]) continue; s += w * rw[r]; if (w >= 0.5) hit = true;
    }
    if (!hit) continue;
    s *= 1 + 0.4 * (e.emphasis || []).filter(t => tags.has(t)).length;
    if ((e.equipment || []).includes('barbell')) s *= 0.8;
    scored.push([s, e]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].id.localeCompare(b[1].id));
  return scored.map(x => x[1]);
}
