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
// CONTRACT-NOTE (PLAN-FIX): buildWorkout accepts optional `upcoming` (planned sessions after `now`,
//   simulated as done) and forwards it to recovery so need/weekly volume include the plan.
//   Selection rules: first exercise per group = best available staple (favourites first);
//   equipment-quality bias (band/KB/TRX/makeshift/bodyweight are fallbacks when DBs or cables
//   exist); no supersets that share a limiting muscle (triceps, biceps, grip); ≤2 of a pattern
//   (3 at 60+ min); fill-in (complement) groups prefer isolations and go after the requested work.
// CONTRACT-NOTE: alternatives()/exercisesFor() accept equipment as an array of ids or a Set;
//   undefined means "no equipment filter".
// CONTRACT-NOTE (STYLES, 2026-10-20): `style` is a built-in id ('hypertrophy' | 'efficient' (Hypertrophy ·
//   Time-saver) | 'pump' | 'strength' | 'circuit'), a custom id 'cs_…' from profile.customStyles, or a
//   custom-style object. STYLE_DEFS / resolveStyle(styleOrObj, profile) hold every style parameter (rep
//   base, restCompound/restHeavy/restIsolation, pairing, sets, time-fit flex). Sessions built with a
//   custom style also carry `styleDef` (the validated custom style) + `styleName`, so swapBlock /
//   addExercise / restyle work without the profile. Extra exports: STYLE_DEFS, BUILTIN_STYLES, PAIRINGS,
//   PAIRING_NAMES, STYLE_BASES, STYLE_LIMITS, STYLE_EVIDENCE, normalizeCustomStyle, resolveStyle,
//   styleOptions, isStyleId, restyle(session, style, { profile, sessions, now }) (same exercises/sets
//   re-arranged + re-rested for another style), sharesLimiter, competes.

// CONTRACT-NOTE (§26, 2026-10-24): WORKOUT SET CEILING. Every style (built-in and custom) stops at
//   targets.sessionSetCapOf(profile) working sets (default 30, 12-50; buildWorkout also takes an explicit
//   `setCap`). When the ceiling stops the fitter, it lengthens rests within the style's own restFlex
//   allowance and then lets the workout finish early; complement groups are not added. The session then
//   carries `capped = { sets, cap, freedMin, restScale }` (freedMin = budget − estimate, ≥ 0) and a
//   rationale line, and is exempt from the ±10% time fit (it is short on purpose; poolLimited stays
//   false). Extra exports: workingSets(session), sessionLoad(session, profile) (overload check for a
//   workout the user built or edited: { sets, cap, over, muscles:[{ group, name, sets, cap }] }),
//   trimToCap(session, cap, { profile, sessions, now }) (removes sets from the least-needed exercises,
//   with the same need ordering the fitter uses to drop an exercise), muscleSessionCap(group, minutes, starred).
// CONTRACT-NOTE (§26): ISSUES. Active profile.issues (engine/issues.js) exclude exercises from the pool
//   (mild: the area's hardest-loading tier; moderate/severe: every move that loads it) and penalise what a
//   mild issue still allows. A requested group whose every exercise here is excluded is dropped with a
//   rationale line saying so; if nothing requested is left, its complement groups are trained instead,
//   also said in the rationale. alternatives() / exercisesFor() accept `issues` (an active-issue list).
import { EXERCISES, getEx } from '../data/exercises.js';
import { REGIONS, GROUPS, PRESETS, regionsFor } from '../data/muscles.js';
import { SCULPT_GOALS, DEFAULT_SCULPT_GOALS, defaultSculptGoals } from '../data/sculpt.js';
import { DEFAULT_LOCATIONS, expandEquipment, canDo } from '../data/equipment.js';
import { suggest } from './progression.js';
import { recommend, muscleStatus, groupStatus } from './recovery.js';
import { ds, rng as makeRng, daysBetween, clamp } from '../util.js';
// generator → targets → generator is the same deliberate cycle recovery already closes; only called at run time.
import { sessionSetCapOf, starredGroups } from './targets.js';
import { activeIssues, issueFilter, issueLabel, oneSideLimb, SIDE_ONLY_CREDIT, SAFETY_LINE } from './issues.js';
// CONTRACT-NOTE (§26.4): a move an active one-sided limb issue keeps healthy-side only carries
//   block.sideOnly = 'left'|'right' (one side's work: no ×2 unilateral time, half weekly credit, half its
//   value to the fitter). groupAvailability(group, { equipment, issues, exclude }) → { status:'ok'|'limited'|
//   'side'|'out'|'none', total, free, side, blocked, sideOf, by } is the one place that says what an issue
//   leaves of a muscle group here; buildWorkout and recovery.recommend (Today's cards) both read it.

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

// Coach's openers: the first exercise for a group is its best staple for the equipment at hand
// (PLAN-FIX). Ordered best-first; filtered at load to exercises whose prime mover is that group.
const STAPLE_IDS = {
  chest: ['db_incline', 'db_bench', 'machine_chest_press', 'machine_incline_press', 'db_incline_low', 'smith_incline', 'cable_press_standing', 'dip_chest', 'landmine_chest_press', 'pushup_deficit', 'pushup', 'pushup_decline', 'band_chest_press', 'trx_chest_press', 'db_floor_press', 'kb_floor_press'],
  back: ['lat_pulldown', 'pullup', 'chinup', 'pullup_neutral', 'assisted_pullup', 'cable_row', 'machine_row', 'db_row', 'trap_row', 'db_chest_row', 'kneeling_cable_pulldown', 'band_lat_pulldown', 'db_bent_row', 'inverted_row', 'trx_row', 'door_row', 'towel_row'],
  shoulders: ['db_shoulder', 'machine_shoulder_press', 'db_arnold', 'db_standing_press', 'smith_shoulder_press', 'db_single_press', 'kb_press', 'landmine_press', 'pike_pushup', 'band_overhead_press'],
  biceps: ['db_incline_curl', 'db_curl', 'cable_curl', 'ez_curl', 'db_hammer', 'cable_bayesian_curl', 'db_alt_curl', 'db_preacher_curl', 'band_curl', 'trx_curl', 'towel_curl', 'table_curl'],
  triceps: ['tri_pushdown', 'cable_rope_pushdown', 'cable_oh_ext', 'db_tri_oh', 'db_skull', 'ez_skull', 'dip_tri', 'assisted_dip_tri', 'db_tri_oh_seated', 'band_pushdown', 'band_oh_ext', 'close_grip_pushup', 'diamond_pushup', 'bench_dip_tri', 'bw_tri_ext'],
  core: ['cable_crunch', 'hang_knee', 'captain_knee', 'machine_crunch', 'decline_crunch', 'db_weighted_crunch', 'reverse_crunch', 'plank', 'dead_bug', 'crunch'],
  quads: ['leg_press', 'hack_squat', 'db_goblet', 'db_split', 'heel_elev_goblet', 'db_lunge', 'kb_goblet', 'bw_bulgarian', 'bw_split_squat', 'bw_lunge'],
  hamstrings: ['db_rdl', 'trap_rdl', 'leg_curl', 'lying_leg_curl', 'db_sl_rdl', 'kb_sl_rdl', 'sliding_leg_curl', 'ham_bridge_bench', 'bw_sl_rdl'],
  glutes: ['trap_dl', 'db_hip_thrust', 'machine_hip_thrust', 'smith_hip_thrust', 'cable_pull_through', 'sl_hip_thrust', 'glute_bridge'],
  calves: ['standing_calf_machine', 'leg_press_calf', 'db_calf', 'db_sl_calf', 'smith_calf', 'seated_calf_machine', 'bw_calf_raise'],
  forearms: ['db_wrist_curl', 'farmer', 'cable_wrist_curl', 'db_rev_wrist_curl', 'band_wrist_curl', 'towel_wring'],
};
// Improvised moves that only make sense when nothing better is around.
const BENCH_ONLY = new Set(['flat_bench', 'adjustable_bench', 'plyo_box']);   // "bodyweight + a bench"
const MAKESHIFT = new Set(['towel_curl', 'towel_row', 'towel_fly', 'towel_wring', 'wall_lateral_iso', 'table_curl', 'door_row', 'ab_rollout_towel']);
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
const STAPLES = Object.fromEntries(Object.entries(STAPLE_IDS).map(([g, ids]) => [g, ids.filter(id => { const e = getEx(id); return e && primaryGroup(e) === g; })]));

// Equipment quality: at a location with dumbbells / cables, band, kettlebell, TRX, makeshift and
// plain-bodyweight variants are fallbacks, not first choices (core work excepted).
function eqQuality(ex, eq) {
  if (!eq) return 1;
  const e = ex.equipment || [];
  const hasDb = eq.has('dumbbell'), hasCable = eq.has('cable');
  let q = 1;
  if (MAKESHIFT.has(ex.id) && (hasDb || hasCable)) q *= 0.45;
  if (e.includes('band') && (hasDb || hasCable)) q *= hasCable ? 0.5 : 0.75;
  if (e.includes('kettlebell') && hasDb) q *= 0.75;
  if (e.includes('trx') && (hasDb || hasCable)) q *= 0.7;
  if (e.every(x => BENCH_ONLY.has(x)) && hasDb && primaryGroup(ex) !== 'core') q *= 0.7;
  return q;
}

// Per-group peak muscle credit of an exercise.
function groupLoad(ex) {
  const out = {};
  for (const [r, w] of Object.entries(ex.muscles || {})) { const g = regionGroup(r); if (g) out[g] = Math.max(out[g] || 0, w); }
  return out;
}
// Grip demand 0..1: hangs/carries max it out; curls, pulls, shrugs and hinges all need some.
function gripLoad(ex) {
  let g = ex.muscles?.forearms || 0;
  if (ex.pattern === 'carry' || /hang/.test(ex.id)) g = Math.max(g, 1);
  if (['elbow_flexion', 'vertical_pull', 'horizontal_pull', 'shrug'].includes(ex.pattern)) g = Math.max(g, 0.35);
  if (ex.pattern === 'hinge' && (ex.fatigue || 1) >= 2) g = Math.max(g, 0.35);
  return g;
}
// Two moves share a limiting muscle (triceps, biceps, grip): don't superset them, or the
// second one is pre-fatigued (e.g. dead hang + curls, close-grip press + dips).
export function sharesLimiter(a, b) {
  const la = groupLoad(a), lb = groupLoad(b);
  const isPull = e => e.pattern === 'horizontal_pull' || e.pattern === 'vertical_pull';
  for (const g of ['triceps', 'biceps']) {
    const x = la[g] || 0, y = lb[g] || 0;
    // Rows/pulldowns credit the elbow flexors (0.5, fractional counting) but a row + curl superset is fine.
    if (g === 'biceps' && (isPull(a) || isPull(b))) continue;
    if (Math.min(x, y) >= 0.5) return true;
    // a triceps isolation after any press still pre-fatigues the press (rows + curls are fine)
    if (g === 'triceps' && Math.max(x, y) >= 0.75 && Math.min(x, y) >= 0.25) return true;
  }
  // two presses both loading the front delts (incline press + shoulder press)
  if (Math.min(a.muscles?.delt_front || 0, b.muscles?.delt_front || 0) >= 0.5 && a.category === 'compound' && b.category === 'compound') return true;
  const ga = gripLoad(a), gb = gripLoad(b);
  return Math.max(ga, gb) >= 0.75 && Math.min(ga, gb) >= 0.25;
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
export function competes(a, b) {
  const ma = new Set(mainRegions(a));
  return mainRegions(b).some(r => ma.has(r)) || primaryGroup(a) === primaryGroup(b) || sharesLimiter(a, b);
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

// ---------------------------------------------------------------- style model
// One place for everything a training style controls: rep scheme (`base`), rests, pairing, sets.
// pairing: 'none' straight sets | 'accessory' main compounds straight, accessories in supersets |
//   'antagonist' every move paired with a non-competing partner (push+pull, upper+lower, compound +
//   unrelated isolation; never two that share a limiting muscle) and, because the partner's set is
//   part of each muscle's rest, the timer after the pair is the style rest minus the partner's work
//   (floor 30 s), so each muscle still gets ≈restCompound / restIsolation between its own sets |
//   'superset' pairs / tri-sets of everything | 'circuit' one or two circuits.
// restFlex: [lo, hi, hiRelaxed] multipliers the time fitter may apply to rests (custom styles: fixed).
export const PAIRINGS = ['none', 'accessory', 'antagonist', 'superset', 'circuit'];
export const PAIRING_NAMES = { none: 'Straight sets', accessory: 'Pair accessories', antagonist: 'Antagonist pairs', superset: 'Supersets', circuit: 'Circuit' };
export const STYLE_BASES = ['hypertrophy', 'pump', 'strength', 'circuit'];   // rep schemes
export const STYLE_LIMITS = { rest: [30, 300], reps: [3, 30], sets: [1, 6], name: 30, count: 20 };
const PAIR_REST_FLOOR = 30;
export const STYLE_EVIDENCE = [
  { claim: 'A little more growth with rests longer than 60 s, but no clear extra benefit beyond about 90 s.', source: 'Singer et al. 2024, Front Sports Act Living 6:1429789 (Bayesian meta-analysis), doi:10.3389/fspor.2024.1429789' },
  { claim: 'In trained men, 3-min rests beat 1-min rests for strength and thigh growth: rests shouldn\'t get very short, so each muscle still gets 60-90 s here.', source: 'Schoenfeld et al. 2016, J Strength Cond Res 30:1805, doi:10.1519/JSC.0000000000001272' },
  { claim: 'Supersets / paired sets roughly halve session time for the same volume, and look better suited to hypertrophy than to max strength (long-term data still limited).', source: 'Iversen et al. 2021, Sports Med 51:2079 ("No time to lift?", narrative review), doi:10.1007/s40279-021-01490-1' },
];
const B_HYP = { base: 'hypertrophy', perSet: 115, maxSets: 5, restFlex: [0.75, 1.3, 1.5], shortPairs: true, builtin: true };
export const STYLE_DEFS = {
  hypertrophy: { ...B_HYP, id: 'hypertrophy', name: 'Hypertrophy', short: 'Hypertrophy', restCompound: 90, restHeavy: 120, restIsolation: 60, pairing: 'accessory',
    round: (anyComp, n, minutes) => (minutes <= 25 ? (anyComp ? 60 : 45) : (anyComp ? 75 : 60)),
    hint: '8-12 reps, 60-120 s rest', notes: 'Straight sets on the big lifts, accessories in supersets. The default.' },
  efficient: { ...B_HYP, id: 'efficient', name: 'Hypertrophy · Time-saver', short: 'Time-saver', restCompound: 90, restHeavy: 90, restIsolation: 60, pairing: 'antagonist',
    perSet: 75, restFlex: [0.9, 1.1, 1.2], exShift: [0, 1],
    hint: 'Hypertrophy reps, paired sets, ~90/60 s rest per muscle', notes: 'Same reps and sets as Hypertrophy, but every move is paired with one that doesn\'t compete (push + pull, upper + lower) and you rest after the pair. Each muscle still gets ~90 s (compounds) / ~60 s (isolations) between its own sets, so the same workout takes about 30% less time.' },
  pump: { base: 'pump', builtin: true, id: 'pump', name: 'Pump', short: 'Pump', restCompound: 60, restHeavy: 60, restIsolation: 45, pairing: 'superset', perSet: 80, maxSets: 5, restFlex: [0.75, 1.3, 1.5], shortPairs: true,
    round: (anyComp, n) => (n > 2 ? 45 : (anyComp ? 45 : 30)), titleSuffix: ' Pump', hint: 'Supersets, short rests', notes: 'Higher reps, supersets and tri-sets, short rests.' },
  strength: { base: 'strength', builtin: true, id: 'strength', name: 'Strength', short: 'Strength', restCompound: 150, restHeavy: 180, restIsolation: 75, pairing: 'none', perSet: 170, maxSets: 6, restFlex: [0.75, 1.3, 1.5], shortPairs: true,
    round: anyComp => (anyComp ? 120 : 75), compoundBias: 1.3, exShift: [-1, -2], hint: 'Heavier, 5-8 reps, longer rests', notes: 'Heavier compounds, 3-8 reps, long rests.' },
  circuit: { base: 'circuit', builtin: true, id: 'circuit', name: 'Circuit', short: 'Circuit', restCompound: 60, restHeavy: 60, restIsolation: 60, pairing: 'circuit', perSet: 65, maxSets: 4, restFlex: [0.75, 1.3, 1.5], shortPairs: true,
    round: (anyComp, n, minutes) => (minutes <= 20 ? 60 : 75), exShift: [1, 2], titleSuffix: ' Circuit', hint: 'Circuit, minimal rest', notes: 'Stations back to back, rest after each round.' },
};
export const BUILTIN_STYLES = ['hypertrophy', 'efficient', 'pump', 'strength', 'circuit'];

const r5 = x => Math.round(x / 5) * 5;
const numOr = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
// Validate / clamp a custom style → { id, name, base, restCompound, restIsolation, pairing, repMin?, repMax?, setsPerExercise? }.
// Rests 30-300 s (steps of 5), reps 3-30, sets 1-6, name ≤30 chars. Returns null for non-objects.
export function normalizeCustomStyle(cs, { now = Date.now() } = {}) {
  if (!cs || typeof cs !== 'object') return null;
  const L = STYLE_LIMITS;
  const baseDef = STYLE_DEFS[cs.base] || STYLE_DEFS.hypertrophy;
  const id = typeof cs.id === 'string' && /^cs_[A-Za-z0-9_]{1,40}$/.test(cs.id) ? cs.id : 'cs_' + now;
  const name = String(cs.name ?? '').replace(/\s+/g, ' ').trim().slice(0, L.name) || 'My style';
  const rest = (v, d) => clamp(r5(numOr(v, d)), L.rest[0], L.rest[1]);
  const out = {
    id, name, base: STYLE_BASES.includes(cs.base) ? cs.base : baseDef.base,
    restCompound: rest(cs.restCompound, baseDef.restCompound),
    restIsolation: rest(cs.restIsolation, baseDef.restIsolation),
    pairing: PAIRINGS.includes(cs.pairing) ? cs.pairing : baseDef.pairing,
  };
  let lo = numOr(cs.repMin, NaN), hi = numOr(cs.repMax, NaN);
  if (Number.isFinite(lo) || Number.isFinite(hi)) {
    if (!Number.isFinite(lo)) lo = hi; if (!Number.isFinite(hi)) hi = lo;
    lo = clamp(Math.round(lo), L.reps[0], L.reps[1]); hi = clamp(Math.round(hi), L.reps[0], L.reps[1]);
    if (lo > hi) [lo, hi] = [hi, lo];
    out.repMin = lo; out.repMax = hi;
  }
  const sp = numOr(cs.setsPerExercise, NaN);
  if (Number.isFinite(sp)) out.setsPerExercise = clamp(Math.round(sp), L.sets[0], L.sets[1]);
  return out;
}
function customDef(cs) {
  const c = normalizeCustomStyle(cs);
  const base = STYLE_DEFS[c.base];
  const avgR = (c.restCompound + c.restIsolation) / 2;
  const perSet = c.pairing === 'none' ? 35 + avgR : c.pairing === 'antagonist' ? (85 + Math.max(PAIR_REST_FLOOR, avgR - 50)) / 2
    : c.pairing === 'circuit' ? 45 + avgR / 4 : (85 + avgR) / 2;
  return { ...c, custom: true, builtin: false, short: c.name, restHeavy: c.restCompound, perSet: Math.round(perSet),
    maxSets: c.setsPerExercise || base.maxSets, restFlex: [1, 1, 1], shortPairs: c.pairing !== 'none',
    exShift: c.pairing === 'circuit' ? [1, 2] : c.pairing === 'antagonist' ? [0, 1] : base.base === 'strength' ? [-1, -2] : [0, 0],
    compoundBias: base.base === 'strength' ? 1.3 : 1, cfg: c,
    hint: `${c.repMin ? `${c.repMin}-${c.repMax}` : { hypertrophy: '8-12', pump: '12-20', strength: '3-8', circuit: '10-15' }[base.base]} reps · ${c.restCompound}/${c.restIsolation} s rest · ${PAIRING_NAMES[c.pairing].toLowerCase()}${c.setsPerExercise ? ` · ${c.setsPerExercise} sets` : ''}`,
    notes: `Your style, based on ${base.name}.` };
}
// Style id | custom-style object | session.styleDef → full definition (unknown → hypertrophy).
export function resolveStyle(style, profile) {
  if (style && typeof style === 'object') return style.builtin || style.custom ? style : customDef(style);
  if (STYLE_DEFS[style]) return STYLE_DEFS[style];
  if (typeof style === 'string' && style.startsWith('cs_')) {
    const cs = (Array.isArray(profile?.customStyles) ? profile.customStyles : []).find(x => x && x.id === style);
    if (cs) return customDef(cs);
  }
  return STYLE_DEFS.hypertrophy;
}
// Built-ins + the profile's custom styles, for pickers: [{ id, name, short, hint, custom }].
export function styleOptions(profile) {
  const cs = (Array.isArray(profile?.customStyles) ? profile.customStyles : []).map(normalizeCustomStyle).filter(Boolean);
  return [...BUILTIN_STYLES.map(id => STYLE_DEFS[id]), ...cs.map(customDef)].map(d => ({ id: d.id, name: d.name, short: d.short, hint: d.hint, custom: !!d.custom, pairing: d.pairing }));
}
export function isStyleId(id, profile) {
  return !!STYLE_DEFS[id] || (typeof id === 'string' && (Array.isArray(profile?.customStyles) ? profile.customStyles : []).some(x => x && x.id === id));
}

// ---------------------------------------------------------------- style: reps & rest
function repRangeFor(ex, def) {
  const [lo0, hi0] = ex.repRange || [8, 12];
  const style = def.base;
  if (ex.unit === 'seconds') {
    if (style === 'pump' || style === 'circuit') return [Math.max(lo0, 30), Math.max(hi0, 45)];
    return [lo0, hi0];
  }
  if (def.repMin && def.repMax) return [def.repMin, def.repMax];
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
function soloRest(ex, def) {
  const comp = ex.category === 'compound', heavy = (ex.fatigue || 1) >= 3;
  return comp ? (heavy ? def.restHeavy ?? def.restCompound : def.restCompound) : def.restIsolation;
}
// Rest after a superset / pair / circuit round (before restScale).
function roundRest(members, def, minutes) {
  const anyComp = members.some(e => e.category === 'compound');
  if (def.round) return def.round(anyComp, members.length, minutes);
  return anyComp ? def.restCompound : def.restIsolation;
}
// Work seconds of one set at mid-range reps (for the antagonist pair-rest netting).
function workSec(ex, def) {
  const [lo, hi] = repRangeFor(ex, def);
  return Math.round((lo + hi) / 2) * (ex.secPerRep ?? TIME.defaultSecPerRep) * (ex.unilateral ? 2 : 1);
}
// Antagonist pairs: each muscle should get ≈R between its own sets, and the partner's set + the
// transition already count, so the timer after the pair is R minus those (≥ PAIR_REST_FLOOR).
function pairRest(members, def, minutes, scale) {
  const R = roundRest(members, def, minutes) * scale;
  if (def.pairing !== 'antagonist' || members.length < 2) return Math.max(20, r5(R));
  const w = members.map(e => workSec(e, def));
  const others = w.reduce((a, b) => a + b, 0) - Math.max(...w);
  return Math.max(PAIR_REST_FLOOR, r5(R - (members.length - 1) * TIME.transitionSec - others));
}
const defaultSets = (ex, def, minutes) => {
  if (def.setsPerExercise) return def.setsPerExercise;
  if (def.base === 'strength') return ex.category === 'compound' ? 4 : 3;
  if (def.base === 'circuit') return 3;
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
    const work = reps * (ex.secPerRep ?? TIME.defaultSecPerRep) * (ex.unilateral && !b.sideOnly ? 2 : 1);   // one side only: one side's work
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
  const { minutes, style, def, profile, sessions, now, eq, exclude, rw, activeGoals, targetGoals, seed, reqGroups, upcoming, issues, setCap } = opts;
  const IF = issues || issueFilter([]);
  const avoid = new Set([...(exclude || []), ...((profile && profile.avoidExercises) || []), ...IF.blocked]);
  const recent = recentExercises(sessions, now);
  const favs = new Set((profile && profile.favoriteExercises) || []);
  const mstat = safe(() => muscleStatus(sessions || [], { now, profile, upcoming }), {});
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
  const rwGroups = new Set(Object.keys(rw).map(regionGroup));
  const reqSet = new Set(reqGroups && reqGroups.length ? reqGroups : rwGroups);
  // A move whose prime mover is outside every requested/fill-in group only belongs when at least
  // half its credit lands on the REQUESTED muscles (chin-ups on a biceps day: yes; chest dips or
  // floor presses on a shoulder day: no).
  const crossOk = ex => {
    if (rwGroups.has(primaryGroup(ex))) return true;
    let on = 0, all = 0;
    for (const [r, w] of Object.entries(ex.muscles)) { all += w; if (rw[r] && reqSet.has(regionGroup(r))) on += w; }
    return all > 0 && on / all >= 0.5;
  };
  const pool = EXERCISES.filter(ex =>
    ex && ex.muscles && !avoid.has(ex.id) && !isBackSquat(ex) && (!eq || canDo(ex, eq)) &&
    (ex.pattern !== 'conditioning' || def.pairing === 'circuit') &&
    onTarget(ex, rw) && crossOk(ex));
  const req = reqSet;
  const reqRegions = new Set(Object.keys(rw).filter(r => req.has(regionGroup(r))));
  // Staple openers available here, per group (favourites of that group lead the list).
  const poolIds = new Set(pool.map(e => e.id));
  const staples = {};
  for (const g of new Set(pool.map(primaryGroup))) {
    if (!g) continue;
    const favFirst = pool.filter(e => favs.has(e.id) && primaryGroup(e) === g).map(e => e.id);
    // the user's favourites for a group ARE its openers when there are any
    staples[g] = favFirst.length ? favFirst : (STAPLES[g] || []).filter(id => poolIds.has(id));
  }
  // §26: a mild issue keeps the moves that load its area only moderately, at a strong penalty.
  // §26.4: a healthy-side-only move is worth half a set for the week, so half its value here too.
  const quality = new Map(pool.map(e => [e.id, eqQuality(e, eq) * (IF.penalty.get(e.id) ?? 1) * (IF.side.has(e.id) ? SIDE_ONLY_CREDIT : 1)]));
  return { minutes, style, def, profile, sessions, now, eq, weights, pool, recent, favs, activeTags, targetTags,
    rand: makeRng(seed), cache: new Map(), mstat, req, reqRegions, staples, quality, side: IF.side,
    setCap: Number.isFinite(setCap) && setCap > 0 ? setCap : Infinity, capHit: false,
    starred: safe(() => starredGroups(profile || {}), new Set()) };
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

// How much an item serves what the session still wants (desired sets per region). The fitter's own
// "least needed" measure, shared by its drop-an-exercise move and trimToCap (§26).
function itemNeed(it, desired) { return Object.entries(it.ex.muscles).reduce((a, [r, w]) => a + w * (desired[r] || 0), 0); }
// Index of the item to drop first: the least needed, a pattern duplicate (2nd press) before a lone fly,
// compounds protected a little (they serve more). -1 when there is nothing to drop.
function leastNeededIndex(items, desired, ok = () => true) {
  let wi = -1, ws = Infinity;
  items.forEach((x, i) => {
    if (!ok(x, i)) return;
    const dup = items.some((y, j) => j < i && y.ex.pattern === x.ex.pattern);
    const n = itemNeed(x, desired) * (x.ex.category === 'compound' ? 1.3 : 1) * (dup ? 0.5 : 1);
    if (n < ws) { ws = n; wi = i; }
  });
  return wi;
}

function desiredSets(ctx, budgetSec) {
  const perSet = ctx.def.perSet || 115;
  // §26: never aim past the workout set ceiling, whatever the minutes.
  const total = Math.min(ctx.setCap || Infinity, Math.max(4, budgetSec / perSet));
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
  m *= ctx.quality.get(ex.id) ?? 1;
  const pg = primaryGroup(ex);
  // Prefer moves that load the requested muscles hard; fill-in (complement) groups get isolations.
  let maxReq = 0;
  for (const [r, w] of Object.entries(ex.muscles)) if (ctx.reqRegions.has(r)) maxReq = Math.max(maxReq, w);
  m *= 0.6 + 0.4 * maxReq;
  if (!ctx.req.has(pg)) {
    if (ex.category === 'compound') m *= 0.55;
    // a move whose prime mover isn't a requested or fill-in group (chest dips on a shoulder day)
    if (!Object.keys(ctx.weights).some(r => regionGroup(r) === pg)) m *= 0.35;
  }
  // First exercise for a group = its best staple for this equipment.
  const opener = pg && !items.some(it => primaryGroup(it.ex) === pg);
  if (opener) {
    const used = new Set(items.map(it => it.ex.id));
    const st = (ctx.staples[pg] || []).filter(id => !used.has(id));
    if (st.length) {
      const rank = st.indexOf(ex.id);
      if (rank < 0) return -Infinity;
      m *= 1.4 / (1 + 0.35 * rank);
    }
  }
  const pr = primaryRegion(ex);
  if (!relaxed) {
    if (items.some(it => it.ex.pattern === ex.pattern && primaryRegion(it.ex) === pr)) m *= 0.3;
    else if (items.some(it => it.ex.pattern === ex.pattern)) m *= ctx.minutes <= 25 ? 0.35 : 0.75;
    // Short sessions: after a compound for a group, its next move should be an isolation
    // (press + fly superset beats two presses).
    if (ctx.minutes <= 25 && ex.category === 'compound' && items.some(it => it.ex.category === 'compound' && primaryGroup(it.ex) === pg)) m *= 0.7;
    // Cap redundant patterns: at most 2 of one pattern (3 in long sessions).
    if (items.filter(it => it.ex.pattern === ex.pattern).length >= (ctx.minutes >= 60 ? 3 : 2)) m *= 0.15;
    // One triceps-heavy compound (JM / close-grip / dips / neutral press) per session is plenty.
    const triPress = e => e.category === 'compound' && (groupLoad(e).triceps || 0) >= 0.5;
    if (triPress(ex) && items.some(it => triPress(it.ex))) m *= 0.3;
  }
  if ((ex.fatigue || 1) >= 3) {
    const n3 = items.filter(it => (it.ex.fatigue || 1) >= 3).length;
    if (n3 >= 1) m *= ctx.minutes <= 30 ? 0.2 : 0.5;
    if (ctx.minutes <= 20) m *= 0.7;
  }
  if (ctx.def.compoundBias > 1 && ex.category === 'compound') m *= ctx.def.compoundBias;
  if (ctx.def.pairing === 'circuit' || ctx.minutes <= 25) m *= 1 - Math.min(0.5, (ex.setupSec ?? 30) / 300);
  if (ctx.minutes <= 25 && ex.unilateral) m *= 0.8;
  // compounds early: modest preference while the plan is still small
  if (ex.category === 'compound' && items.length < 3) m *= 1.15;
  const g = pg;
  if (!relaxed && g && (grp[g] || 0) + 2 > groupCap(g, ctx.minutes)) return -Infinity; // group full: let a complement fill time
  m *= 0.9 + 0.2 * ctx.rand();
  return serve * m;
}

// Requested groups first (compounds, then isolations), then fill-in groups (compounds, isolations).
function orderItems(items, ctx) {
  const idx = new Map(items.map((it, i) => [it, i]));
  const reqOf = it => (ctx && ctx.req && !ctx.req.has(primaryGroup(it.ex)) ? 1 : 0);
  const out = [...items].sort((a, b) => {
    const ca = a.ex.category === 'compound' ? 0 : 1, cb = b.ex.category === 'compound' ? 0 : 1;
    if (reqOf(a) !== reqOf(b)) return reqOf(a) - reqOf(b);
    if (ca !== cb) return ca - cb;
    if (ca === 0 && (b.ex.fatigue || 1) !== (a.ex.fatigue || 1)) return (b.ex.fatigue || 1) - (a.ex.fatigue || 1);
    return idx.get(a) - idx.get(b);
  });
  // Each group's opener (the first move picked for it, which scoreEx forces to be a staple) stays first
  // among that group's moves of the same category: a higher-fatigue compound picked later for the group
  // (a rack pull after the row that opened back) no longer jumps ahead of it on fatigue alone.
  if (ctx && ctx.staples) {
    const opener = new Map();
    for (const it of items) { const g = primaryGroup(it.ex); if (g && !opener.has(g)) opener.set(g, it); }
    for (const [g, op] of opener) {
      const first = out.findIndex(it => primaryGroup(it.ex) === g && it.ex.category === op.ex.category);
      const at = out.indexOf(op);
      if (first >= 0 && at > first) { out.splice(at, 1); out.splice(first, 0, op); }
    }
  }
  return out;
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
        if (sharesLimiter(a.ex, b.ex) || a.ex.pattern === b.ex.pattern) return;
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
        [...units].reverse().find(u => u.length === 2 && u.every(x => (x.ex.fatigue || 1) + (solo.ex.fatigue || 1) < 6 && !sharesLimiter(x.ex, solo.ex) && primaryGroup(x.ex) !== primaryGroup(solo.ex)));
      if (host) { host.push(solo); units.splice(i, 1); }
    }
  }
  return units;
}

function arrange(items, ctx) {
  const ordered = orderItems(items, ctx);
  if (ordered.length <= 1) return ordered.map(x => [x]);
  const pairing = ctx.def.pairing;
  if (pairing === 'circuit') {
    if (ordered.length <= 6) return [ordered];
    const h = Math.ceil(ordered.length / 2);
    return [ordered.slice(0, h), ordered.slice(h)];
  }
  if ((ctx.minutes <= 25 && ctx.def.shortPairs) || pairing === 'superset') return pairUp(ordered, true);
  if (pairing === 'none') return ordered.map(x => [x]);
  // Antagonist pairs: every move gets a non-competing partner (compounds first, so push + pull,
  // upper + lower, then compound + unrelated isolation); a move with no safe partner stays solo.
  if (pairing === 'antagonist') return pairUp(ordered, false);
  // Straight-set compounds for the requested groups lead; fill-in compounds join the
  // isolation supersets after the requested work (no triceps presses before a biceps day).
  const isReq = x => !ctx.req || ctx.req.has(primaryGroup(x.ex));
  const comps = ordered.filter(x => x.ex.category === 'compound' && isReq(x));
  const isos = ordered.filter(x => !(x.ex.category === 'compound' && isReq(x)));
  isos.sort((a, b) => (isReq(b) - isReq(a)) || ((a.ex.category === 'compound' ? 0 : 1) - (b.ex.category === 'compound' ? 0 : 1)));
  return [...comps.map(x => [x]), ...pairUp(isos, false)];
}

function materialize(plan, ctx, { equalize = true } = {}) {
  const units = arrange(plan.items, ctx);
  const blocks = [];
  let letter = 0;
  for (const u of units) {
    const sets = Math.max(...u.map(x => x.sets));
    if (equalize) u.forEach(x => { x.sets = sets; });
    const group = u.length > 1 ? String.fromCharCode(65 + letter++) : null;
    const rest = u.length > 1 ? pairRest(u.map(x => x.ex), ctx.def, ctx.minutes, plan.restScale) : Math.max(20, r5(soloRest(u[0].ex, ctx.def) * plan.restScale));
    const trans = ctx.def.pairing === 'circuit' ? TIME.circuitTransitionSec : TIME.transitionSec;
    u.forEach((x, j) => {
      const b = liftBlock(x.ex, ctx.def, equalize ? sets : x.sets, (u.length > 1 && j < u.length - 1) ? trans : rest, group, ctx.sessions, ctx.now, ctx.cache);
      const side = x.side || ctx.side?.get(x.ex.id);   // §26.4 healthy side only
      if (side) b.sideOnly = side;
      blocks.push(b);
    });
  }
  return { blocks, units };
}

function exRange(minutes, def) {
  const r = minutes <= 25 ? [2, 4] : minutes <= 35 ? [3, 6] : minutes <= 52 ? [4, 7] : minutes <= 67 ? [5, 8] : [7, 10];
  const [a, b] = def.exShift || [0, 0];
  return [Math.max(2, r[0] + a), Math.max(3, r[1] + b)];
}

function planSession(ctx, budgetMin, otherMin) {
  const budgetSec = Math.max(0, budgetMin - otherMin) * 60;
  const total = budgetMin * 60;
  const desired = desiredSets(ctx, budgetSec);
  const [lo, hi] = exRange(budgetMin, ctx.def);
  const plan = { items: [], restScale: 1 };
  const cap = ctx.setCap || Infinity;
  // §26: per-muscle cap for this workout (the same rule sessionLoad warns with): direct sets, i.e. sets
  // of moves whose prime mover is that muscle, after pairs are equalized.
  const mcap = g => muscleSessionCap(g, ctx.minutes, ctx.starred?.has(g));
  // One materialize gives every number: elapsed seconds, working sets and the muscles past their cap.
  const evalPlan = () => {
    const m = materialize(plan, ctx);
    const direct = {};
    for (const b of m.blocks) { const g = primaryGroup(getEx(b.exId)); if (g) direct[g] = (direct[g] || 0) + b.target.sets; }
    return { sec: estimateSeconds(m.blocks) + otherMin * 60, sets: m.blocks.reduce((n, b) => n + b.target.sets, 0),
      over: Object.keys(direct).filter(g => direct[g] > mcap(g)), direct };
  };
  const est = () => evalPlan().sec;
  const noveltySlot = ctx.recent.size ? 1 + Math.floor(ctx.rand() * Math.max(1, hi - 1)) : -1;
  let novelPick = null;

  const pickNext = (relaxed, skip = null) => {
    const used = new Set([...plan.items.map(x => x.ex.id), ...(skip || [])]);
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

  // 1. greedy fill with default sets (§26: never past the workout set ceiling or a muscle's cap)
  const skip = new Set();
  for (let guard = 0; plan.items.length < hi && guard < 60; guard++) {
    const ex = pickNext(false, skip); if (!ex) break;
    const snap = plan.items.map(x => x.sets);   // materialize equalizes pairs in place: restore on undo
    plan.items.push({ ex, sets: defaultSets(ex, ctx.def, budgetMin) });
    const e = evalPlan();
    if (e.over.length && e.sets <= cap) {   // would push a muscle past its per-session cap: try the next move
      plan.items.pop(); plan.items.forEach((x, i) => { x.sets = snap[i]; }); skip.add(ex.id); continue;
    }
    if (e.sets > cap) {
      plan.items.pop(); plan.items.forEach((x, i) => { x.sets = snap[i]; });
      if (e.sec < total * 1.03) ctx.capHit = true;
      break;
    }
    if (plan.items.length >= lo && e.sec >= total * 0.92) break;
    if (e.sets >= cap) { if (e.sec < total * 0.92) ctx.capHit = true; break; }
  }

  // 2. tune sets / exercises / rest to land on budget
  const tune = (relaxed) => {
    const fixed = ctx.def.setsPerExercise || 0;   // a custom style's fixed sets per exercise
    const maxSets = fixed || (relaxed ? 6 : ctx.def.maxSets || 5);
    const minSets = fixed || 2;
    const hiEx = relaxed ? hi + 4 : hi;
    const [restLo, restHi0, restHiR] = ctx.def.restFlex || [0.75, 1.3, 1.5];
    const restHi = relaxed ? restHiR : restHi0;
    for (let iter = 0; iter < 80; iter++) {
      const cur = est(); const diff = Math.abs(cur - total) / total;
      if (diff <= 0.03) return;
      const moves = [];
      const units = arrange(plan.items, ctx);
      const { grp } = credits(plan.items);
      const unitNeed = u => u.reduce((s, x) => s + itemNeed(x, desired), 0);
      const maxNeed = Math.max(1e-6, ...units.map(unitNeed));
      if (cur < total) {
        for (const u of units) {
          if (u.some(x => x.sets >= maxSets)) continue;
          if (!relaxed && u.some(x => { const g = primaryGroup(x.ex); return g && (grp[g] || 0) + 1 > groupCap(g, ctx.minutes); })) continue;
          moves.push({ adds: true, pen: 0.01 * (1 - unitNeed(u) / maxNeed) + 0.004 * u[0].sets, apply: () => u.forEach(x => x.sets++), undo: () => u.forEach(x => x.sets--) });
        }
        if (plan.items.length < hiEx) {
          const ex = pickNext(relaxed);
          if (ex) {
            const it = { ex, sets: ctx.def.pairing === 'circuit' ? (plan.items[0]?.sets || 3) : Math.max(minSets, defaultSets(ex, ctx.def, budgetMin) - (fixed ? 0 : 1)) };
            moves.push({ adds: true, pen: plan.items.length < lo ? 0 : 0.012, apply: () => plan.items.push(it), undo: () => plan.items.pop() });
          }
        }
        // §26: once the ceiling blocks every add, this is the only move left: longer rests, within the
        // style's own restFlex allowance (custom styles have none), and then the workout finishes early.
        if (plan.restScale < restHi - 1e-9) moves.push({ pen: 0.02, apply: () => { plan.restScale += 0.1; }, undo: () => { plan.restScale -= 0.1; } });
      } else {
        for (const u of units) {
          if (u.some(x => x.sets <= minSets)) continue;
          moves.push({ pen: 0.002 + 0.01 * (unitNeed(u) / maxNeed), apply: () => u.forEach(x => x.sets--), undo: () => u.forEach(x => x.sets++) });
        }
        if (plan.items.length > Math.max(1, lo)) {
          const wi = leastNeededIndex(plan.items, desired);
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
      const before0 = evalPlan();
      for (const mv of moves) {
        const before = plan.items.map(x => [x, x.sets]);
        mv.apply();
        const e = evalPlan();
        const c = Math.abs(e.sec - total) / total + mv.pen;
        mv.undo();
        before.forEach(([x, s]) => { x.sets = s; }); // materialize equalizes sets; restore exactly
        // §26: a move that would pass the ceiling is never taken; note that the ceiling is what stopped it.
        if (mv.adds && e.sets > cap) { if (c < diff) ctx.capHit = true; continue; }
        // nor one that pushes a muscle past its per-session cap (pairs equalize set counts, so this is
        // checked on the materialized plan, not on the item that was added)
        if (mv.adds && e.over.some(g => !before0.over.includes(g) || e.direct[g] > before0.direct[g])) continue;
        if (c < bc) { bc = c; best = mv; }
      }
      plan.items.forEach((x, i) => { if (snap[i] != null) x.sets = snap[i]; });
      if (!best) return;
      best.apply();
    }
  };
  tune(false);
  // Hard guarantee: pairs equalize set counts, so a plan can land a set or two past the ceiling; take
  // them off the least-needed units (fewest sets first), then drop the least-needed exercise.
  const enforceCap = () => {
    for (let guard = 80; guard-- > 0;) {
      const e = evalPlan();
      const g0 = e.over[0];
      if (e.sets <= cap && !g0) return;
      const minSets = ctx.def.setsPerExercise || 2;
      if (e.sets <= cap) {   // a muscle past its cap: its least-needed units lose a set, else its least-needed move goes
        const units = arrange(plan.items, ctx).filter(u => u.some(x => primaryGroup(x.ex) === g0) && u.every(x => x.sets > minSets));
        if (units.length) {
          const u = units.reduce((a, b) => (a.reduce((s, x) => s + itemNeed(x, desired), 0) <= b.reduce((s, x) => s + itemNeed(x, desired), 0) ? a : b));
          u.forEach(x => { x.sets--; });
          continue;
        }
        const wi = leastNeededIndex(plan.items, desired, x => primaryGroup(x.ex) === g0);
        if (wi < 0 || plan.items.length <= 1) return;
        plan.items.splice(wi, 1);
        continue;
      }
      ctx.capHit = true;
      const units = arrange(plan.items, ctx).filter(u => u.every(x => x.sets > minSets));
      if (units.length) {
        const u = units.reduce((a, b) => (a.reduce((s, x) => s + itemNeed(x, desired), 0) <= b.reduce((s, x) => s + itemNeed(x, desired), 0) ? a : b));
        u.forEach(x => { x.sets--; });
        continue;
      }
      const wi = leastNeededIndex(plan.items, desired);
      if (wi < 0 || plan.items.length <= 1) return;
      plan.items.splice(wi, 1);
    }
  };
  enforceCap();
  return { plan, est, evalPlan, tune: r => { tune(r); enforceCap(); }, novelPick, desired, ctx };
}

// ---------------------------------------------------------------- §26 workout ceiling: shared helpers
// The one line every screen shows for a capped workout (rationale, Today preview, Plan day sheet).
export function capLine(c) {
  if (!c) return '';
  const n = c.sets < c.cap ? `your ${c.cap}-set ceiling (${c.sets} working sets)` : `${c.cap} working sets`;
  return `Capped at ${n}: ${c.freedMin >= 2 ? `finishes ~${c.freedMin}′ early` : 'rests run a little longer instead of adding sets'}. Past this, extra sets mostly add fatigue (a convention; change it in Settings)`;
}
// Working sets in a session: prescribed sets of every lift block that isn't skipped (the rows the logger
// shows, so "+ Set" counts). Warm-ups are never stored as sets, so they never count.
export function workingSets(session) {
  let n = 0;
  for (const b of session?.blocks || []) if (b && b.kind === 'lift' && !b.skipped) n += (b.sets || []).length || Number(b.target?.sets) || 0;
  return n;
}
// Per-muscle cap for ONE workout, on DIRECT sets (sets of moves whose prime mover is that muscle): the
// generator's own cap for that length (8 small / 10 big, ×1.2 at 75+ min), raised to the planner's
// priority allowance of 12 for a starred muscle (planner.PRIORITY_CAP). The fitter never builds past it
// and sessionLoad warns past it: one rule. Like the ceiling, a fatigue / set-quality convention, not a
// measured limit.
export function muscleSessionCap(group, minutes = 45, starred = false) {
  return Math.max(groupCap(group, minutes), starred ? 12 : 0);
}
// Is this workout heavier than the user's ceiling, or does one muscle's direct work pass its per-session
// cap? → { sets, cap, over, excess, muscles:[{ group, name, sets, cap }], heavy }   (advice only, never blocks)
export function sessionLoad(session, profile, { starred = null } = {}) {
  const cap = sessionSetCapOf(profile || {});
  const sets = workingSets(session);
  const minutes = Number(session?.minutes) || Number(session?.estMinutes) || 45;
  const star = starred instanceof Set ? starred : safe(() => starredGroups(profile || {}), new Set());
  const per = {};
  for (const b of session?.blocks || []) {
    if (!b || b.kind !== 'lift' || b.skipped) continue;
    const n = (b.sets || []).length || Number(b.target?.sets) || 0;
    const g = primaryGroup(getEx(b.exId) || {});
    if (g) per[g] = (per[g] || 0) + n;
  }
  const muscles = Object.entries(per).map(([g, v]) => ({ group: g, name: GROUPS[g]?.name || g, sets: v, cap: muscleSessionCap(g, minutes, star.has(g)) }))
    .filter(x => x.sets > x.cap + 0.01).sort((a, b) => (b.sets - b.cap) - (a.sets - a.cap));
  return { sets, cap, over: sets > cap, excess: Math.max(0, sets - cap), muscles, heavy: sets > cap || muscles.length > 0 };
}
// Trim a workout to `cap` working sets (§26 "Trim to 30"), least-needed exercises first, using the
// fitter's own need measure (desired sets per region from recovery need × priority × sculpt goals, and
// its drop-an-exercise ordering: a pattern duplicate before a lone fly, compounds protected a little):
//   1. sets above an exercise's default for the style (3, or 4 for a compound in a 60+ min workout)
//      come off the least-needed exercises first;
//   2. then whole least-needed exercises go while the excess covers them (the workout keeps 2+);
//   3. then single sets, down to 2 per exercise.
// Then any muscle still past its per-session cap (muscleSessionCap, direct sets) loses sets from its
// least-needed moves, then its least-needed move (muscles:true). cap null = muscles only. Logged sets are never removed;
// a superset left with one member is a straight set again, with its own rest.
// Pure → { session, removed:[{ exId, from, to }] } (to 0 = dropped).
export function trimToCap(session, cap, { profile = {}, sessions = [], now = new Date(), muscles = false, starred = null } = {}) {
  const s = cloneSession(session || {});
  s.blocks = s.blocks || [];
  cap = cap === null ? Infinity : Math.round(+cap || sessionSetCapOf(profile));
  const removed = [];
  const lifts = () => s.blocks.map((b, i) => ({ b, i, ex: b && b.kind === 'lift' && !b.skipped ? getEx(b.exId) : null })).filter(x => x.ex);
  const count = b => (b.sets || []).length || Number(b.target?.sets) || 0;
  const doneOf = b => (b.sets || []).filter(x => x && x.done).length;
  const minutes = Number(s.minutes) || Number(s.estMinutes) || 45;
  const def = resolveStyle(s.styleDef || s.style || 'hypertrophy', profile);
  const load0 = sessionLoad(s, profile, { starred });
  if (load0.sets <= cap && !(muscles && load0.muscles.length)) return { session: s, removed };
  // desired sets per region, weighted exactly as buildWorkout weights them
  const tg = resolveTargets(s.targets || []);
  let rw = tg.regionW;
  if (!Object.keys(rw).length) { rw = {}; for (const x of lifts()) for (const r of mainRegions(x.ex)) rw[r] = 1; }
  const goal = Number.isFinite(cap) ? cap : Math.min(load0.sets, sessionSetCapOf(profile));
  const ctx0 = safe(() => makeCtx({ minutes, style: def.id, def, profile, sessions, now, eq: null, exclude: [], rw, activeGoals: profile.sculptGoals || [], targetGoals: tg.sculpt, seed: 1, reqGroups: tg.groups, upcoming: null, setCap: goal }), null);
  const desired = ctx0 ? desiredSets(ctx0, goal * (def.perSet || 115)) : Object.fromEntries(Object.keys(rw).map(r => [r, 1]));
  const rec = (b, from, to) => { const r = removed.find(x => x.exId === b.exId); if (r) r.to = to; else removed.push({ exId: b.exId, from, to }); };
  const shave = b => {   // one unlogged set off the end
    const k = [...b.sets].map((x, j) => [x, j]).reverse().find(([x]) => !x.done)?.[1];
    if (k == null) return false;
    const from = count(b);
    b.sets.splice(k, 1); b.target = { ...(b.target || {}), sets: b.sets.length }; rec(b, from, b.sets.length); return true;
  };
  const items = () => lifts().map(x => ({ ex: x.ex, sets: count(x.b), x }));
  const least = list => list.reduce((a, c) => (itemNeed(a, desired) <= itemNeed(c, desired) ? a : c));
  for (let guard = 300; guard-- > 0 && workingSets(s) > cap;) {
    const excess = workingSets(s) - cap, I = items();
    const above = I.filter(it => it.sets > Math.max(defaultSets(it.ex, def, minutes), doneOf(it.x.b)));
    if (above.length) { if (shave(least(above).x.b)) continue; }
    const wi = I.length > 2 ? leastNeededIndex(I, desired, it => !doneOf(it.x.b) && it.sets <= excess) : -1;
    if (wi >= 0) { rec(I[wi].x.b, I[wi].sets, 0); s.blocks.splice(I[wi].x.i, 1); continue; }
    const pool = I.filter(it => it.sets > Math.max(2, doneOf(it.x.b)));
    if (!pool.length || !shave(least(pool).x.b)) break;
  }
  if (muscles) {
    for (let guard = 120; guard-- > 0;) {
      const over = sessionLoad(s, profile, { starred }).muscles[0]; if (!over) break;
      const pool = items().filter(it => primaryGroup(it.ex) === over.group && it.sets > Math.max(2, doneOf(it.x.b)));
      if (pool.length && shave(least(pool).x.b)) continue;
      const I = items();
      const wi = I.length > 2 ? leastNeededIndex(I, desired, it => !doneOf(it.x.b) && primaryGroup(it.ex) === over.group) : -1;
      if (wi < 0) break;
      rec(I[wi].x.b, I[wi].sets, 0); s.blocks.splice(I[wi].x.i, 1);
    }
  }
  // superset bookkeeping: a group left with one member is a straight set again, with its own rest
  const by = {};
  s.blocks.forEach((b, i) => { if (b.kind === 'lift' && b.group) (by[b.group] ||= []).push(i); });
  for (const idx of Object.values(by)) {
    if (idx.length === 1) { const b = s.blocks[idx[0]]; const ex = getEx(b.exId); b.group = null; if (ex) b.target = { ...b.target, rest: soloRest(ex, def) }; }
  }
  s.estMinutes = estimateMinutes(s.blocks);
  return { session: s, removed };
}

// What the active issues leave of one muscle group at this equipment (its moves = the moves whose prime
// mover is that group, as the fitter picks them: no back squats, no conditioning, nothing avoided).
//   ok      some move trains it on both sides and most moves are untouched
//   limited some move trains it on both sides, but half or more of its moves are out or one-side only
//   side    every move left is healthy-side only (sideOf names the side)
//   out     nothing left
//   none    no move for it here at all, issues or not
export function groupAvailability(group, { equipment = null, issues = [], exclude = [] } = {}) {
  const eq = toEqSet(equipment);
  const IF = issueFilter(issues || []);
  const avoid = new Set(exclude || []);
  const moves = EXERCISES.filter(e => e && e.muscles && primaryGroup(e) === group && !avoid.has(e.id) && !isBackSquat(e) && (!eq || canDo(e, eq)) && e.pattern !== 'conditioning');
  const free = moves.filter(e => !IF.blocked.has(e.id) && !IF.side.has(e.id));
  const side = moves.filter(e => IF.side.has(e.id));
  const blocked = moves.filter(e => IF.blocked.has(e.id));
  const status = !moves.length ? 'none' : free.length ? (blocked.length + side.length >= moves.length * 0.5 && IF.any ? 'limited' : 'ok') : side.length ? 'side' : 'out';
  const tally = new Map(); for (const e of [...blocked, ...side]) { const x = IF.why(e.id); if (x) tally.set(x, (tally.get(x) || 0) + 1); }
  const by = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { group, status, total: moves.length, free: free.map(e => e.id), side: side.map(e => e.id), blocked: blocked.map(e => e.id),
    sideOf: side.length ? IF.side.get(side[0].id) : null, limb: side.length ? oneSideLimb(side[0]) : null, by };
}
// The sentence a card and a workout both use for a group an issue changes (null when it changes nothing).
export function availabilityLine(a) {
  if (!a || !a.by) return null;
  const who = `${issueLabel(a.by)} (${a.by.severity})`, g = (GROUPS[a.group]?.name || a.group).toLowerCase();
  if (a.status === 'out') return `${who}: no ${g} move here spares it, so ${g} ${g.endsWith('s') ? 'are' : 'is'} left out`;
  if (a.status === 'side') return `${who}: ${g} work is ${a.sideOf}-${a.limb} only`;
  if (a.status === 'limited') return `${who}: fewer ${g} options (${a.free.length} of ${a.total} moves train both sides)`;
  return null;
}

// ---------------------------------------------------------------- buildWorkout
export function buildWorkout({
  targets = [], minutes = 45, location, profile, sessions = [], now = new Date(),
  style = 'hypertrophy', cardio = null, seed, exclude = [], upcoming = null, setCap = null,
} = {}) {
  sessions = sessions || [];
  profile = profile || {};
  location = location || DEFAULT_LOCATIONS[0];
  minutes = clamp(Math.round(+minutes || 45), 5, 180);
  const def = resolveStyle(style, profile);
  style = def.id;
  const eq = expandEquipment(location.equipment || ['bodyweight']);
  const activeGoals = (profile.sculptGoals || defaultSculptGoals(profile)).filter(g => SCULPT_GOALS[g]);   // §20: female default when unset
  const rationale = [];
  // §26: the workout set ceiling (explicit setCap wins, else the profile's) and active issues.
  const cap = Number.isFinite(+setCap) && +setCap > 0 ? Math.round(+setCap) : sessionSetCapOf(profile);
  const issues = activeIssues(profile, now);
  const IF = issueFilter(issues);

  // --- resolve targets (or ask recovery for a recommendation)
  let tgts = (targets || []).filter(Boolean);
  let res = resolveTargets(tgts);
  let autoLabel = null;
  if (!Object.keys(res.regionW).length) {
    const recs = safe(() => recommend(sessions, { now, profile, minutes, location, upcoming }), []);
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

  // --- §26: a requested group with nothing left here once the issues' exclusions apply is dropped,
  //     and the rationale says so (never an empty result without a reason). If nothing requested is
  //     left, its complement groups stand in, and that is said too.
  const issueLines = [];
  const avoid0 = [...(exclude || []), ...(profile.avoidExercises || [])];
  const avail = g => groupAvailability(g, { equipment: eq, issues, exclude: avoid0 });
  // a group an issue leaves nothing for here is never added as a fill-in either
  const spared = g => !IF.any || !['out'].includes(avail(g).status);
  if (IF.any) {
    const A = Object.fromEntries(res.groups.map(g => [g, avail(g)]));
    const dead = res.groups.filter(g => A[g].status === 'out');
    for (const g of dead) {
      const x = A[g].by || issues[0];
      issueLines.push(`${GROUPS[g].name}: every ${GROUPS[g].name.toLowerCase()} exercise here loads your ${issueLabel(x).toLowerCase()} (${x.severity}), so it is left out today`);
      for (const r of Object.keys(res.regionW)) if (regionGroup(r) === g) delete res.regionW[r];
    }
    // the same sentence Today's card shows for a group that is now one side only (availabilityLine)
    for (const g of res.groups.filter(g => A[g].status === 'side')) issueLines.push(availabilityLine(A[g]));
    if (dead.length) {
      res.groups = res.groups.filter(g => !dead.includes(g));
      if (!Object.keys(res.regionW).length) {
        const sub = [...new Set(dead.flatMap(g => COMPLEMENT[g] || []))].filter(g => GROUPS[g] && !dead.includes(g) && spared(g) && avail(g).status !== 'none').slice(0, 2);
        for (const g of sub) for (const r of GROUPS[g].regions) res.regionW[r] = 1;
        res.groups = [...sub];
        res.labels = sub.map(g => GROUPS[g].name);
        issueLines.push(sub.length ? `So this works ${sub.map(g => GROUPS[g].name.toLowerCase()).join(' & ')} instead, which ${sub.length > 1 ? 'spare' : 'spares'} it`
          : 'Nothing here trains that without loading it. Pick another muscle group, or tap the issue on Today when it feels better.');
      }
    }
    const n = IF.blocked.size;
    if (n) issueLines.push(`Working around ${issues.map(x => `your ${issueLabel(x).toLowerCase()} (${x.severity})`).join(' and ')}: ${n} moves that load ${issues.length > 1 ? 'them' : 'it'} are out${IF.penalty.size ? ', a few more only if nothing else fits' : ''}`);
    if (issues.some(x => x.severity === 'severe')) issueLines.push(`⚠︎ ${SAFETY_LINE}`);   // what severe adds over moderate
  }

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
  if (liftRoom >= 8 && Object.keys(res.regionW).length) {
    const targetGoals = res.sculpt;
    const reqGroups = [...res.groups];
    const mk = (rw) => makeCtx({ minutes, style, def, profile, sessions, now, eq, exclude, rw, activeGoals: [...new Set([...activeGoals, ...targetGoals])], targetGoals, seed, reqGroups, upcoming, issues: IF, setCap: cap });
    let rw = { ...res.regionW };
    ctx = mk(rw);
    planInfo = planSession(ctx, minutes, otherMin);
    // Under budget even after tuning? Add a complementary group rather than junk volume, unless the
    // workout set ceiling is what stopped it (§26): then more groups would only mean more sets.
    for (let k = 0; k < 3 && planInfo.est() < minutes * 60 * 0.9 && !ctx.capHit; k++) {
      const gs = safe(() => groupStatus(sessions, { now, profile, upcoming }), {});
      const cands = [...new Set(res.groups.flatMap(g => COMPLEMENT[g] || []))]
        .filter(g => GROUPS[g] && !res.groups.includes(g) && !addedGroups.includes(g) && spared(g))
        .map(g => [g, (gs[g]?.need ?? 0.5) * (1 - 0.25 * Math.min(...res.groups.map(x => { const i = (COMPLEMENT[x] || []).indexOf(g); return i < 0 ? 3 : i; })))])
        .sort((a, b) => b[1] - a[1]).map(x => x[0]);
      if (!cands.length) break;
      const g = cands[0]; addedGroups.push(g);
      for (const r of GROUPS[g].regions) rw[r] = Math.max(rw[r] || 0, 0.45);
      const prev = { ctx, planInfo };
      ctx = mk(rw);
      planInfo = planSession(ctx, minutes, otherMin);
      // The complement build ran into the ceiling with no more time used: keep the focused one.
      if (ctx.capHit && planInfo.est() <= prev.planInfo.est()) { ({ ctx, planInfo } = prev); addedGroups.pop(); break; }
    }
    if (planInfo.est() < minutes * 60 * 0.9) planInfo.tune(true);
    blocks = materialize(planInfo.plan, ctx).blocks;
    // final pass: run progression with the real set counts
    blocks = blocks.map(b => {
      const ex = getEx(b.exId);
      return { ...b, target: makeTarget(ex, def, b.target.sets, b.target.rest, sessions, now, null) };
    });
  }
  if (cardioBlock) blocks.push(cardioBlock);
  let estSec = estimateSeconds(blocks);
  // §26: short because the ceiling stopped it (capped) is not the same as short for lack of exercises.
  const nSetsAll = blocks.reduce((n, b) => n + (b.kind === 'lift' ? b.target.sets : 0), 0);
  const freedMin = Math.max(0, minutes - Math.round(estSec / 60));
  const capped = ctx && ctx.capHit && nSetsAll >= cap - 3 && (freedMin >= 1 || planInfo.plan.restScale > 1.001)
    ? { sets: nSetsAll, cap, freedMin, restScale: Math.round(planInfo.plan.restScale * 100) / 100 } : null;
  if (!capped && estSec < minutes * 60 * 0.9) poolLimited = true;

  // --- rationale
  const lifts = blocks.filter(b => b.kind === 'lift');
  const exs = lifts.map(b => getEx(b.exId)).filter(Boolean);
  if (!autoLabel && res.groups.length) {
    // §18.y: no weekly set numbers in a stored rationale (they go stale, and a group sum is not what the
    // weekly rows show). The live per-unit numbers are drawn where the workout is shown (Today's preview,
    // Plan's day sheet) from recovery.weekUnitView.
    const gs = safe(() => groupStatus(sessions, { now, profile, upcoming }), {});
    const bits = res.groups.filter(g => gs[g]).sort((a, b) => (gs[b].need ?? 0) - (gs[a].need ?? 0)).slice(0, 2).map(g => {
      const s = gs[g];
      return GROUPS[g].name + (Number.isFinite(s.daysSince) ? ` (${s.daysSince}d since last)` : ' (not trained yet)');
    });
    if (bits.length) rationale.push('Focus: ' + bits.join('; ') + ', the furthest behind this week');
  }
  issueLines.forEach(x => rationale.push(x));
  if (addedGroups.length) rationale.push(`Added ${addedGroups.map(g => GROUPS[g].name.toLowerCase()).join(' & ')} ${capped ? 'alongside, rather than more sets of the same muscles' : `to fill ${minutes} min without junk volume`}`);
  if (lifts.length) {
    const nSets = lifts.reduce((s, b) => s + b.target.sets, 0);
    const grouped = new Set(lifts.filter(b => b.group).map(b => b.group)).size;
    let how = def.pairing === 'circuit' ? 'circuit, minimal rest'
      : grouped ? (def.pairing === 'antagonist' ? `${grouped} paired set${grouped > 1 ? 's' : ''} (non-competing moves, rest after the pair)` : `${grouped} superset${grouped > 1 ? 's' : ''} to fit more work`) : 'straight sets';
    if (!def.round) how += ` · ~${def.restCompound}/${def.restIsolation} s rest per muscle`;
    rationale.push(`${minutes} min: ${exs.length} exercises, ${nSets} working sets, ${how}`);
    if (capped) rationale.push(capLine(capped));
    // §26.4: say which moves are one side only, and what that does to the weekly count
    const so = lifts.filter(b => b.sideOnly);
    if (so.length) {
      const by = issueFilter(issues).why(so[0].exId);
      rationale.push(`${so.length === 1 ? `${getEx(so[0].exId)?.name || 'One move'} is` : `${so.length} moves are`} ${so[0].sideOnly}-${oneSideLimb(getEx(so[0].exId)) || 'side'} only${by ? ` (your ${issueLabel(by).toLowerCase()})` : ''}: each set counts half for the week, one side of the pair (a convention)`);
    }
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
  if (poolLimited && !(issueLines.length && !lifts.length)) {
    rationale.unshift(lifts.length
      ? `Only ${ctx ? ctx.pool.length : exs.length} suitable exercises for this equipment, so this plan runs ~${Math.round(estSec / 60)} of ${minutes} min. Add a muscle group or equipment to fill it.`
      : `Not enough time or equipment for lifting here; ~${Math.round(estSec / 60)} of ${minutes} min planned.`);
  }
  while (rationale.length < 2) rationale.push(style === 'hypertrophy' ? 'Hypertrophy: 2-3 reps in reserve, add reps before weight' : def.builtin && def.round ? `Style: ${style}` : `Style: ${def.name}`);

  // --- title
  const base = autoLabel || res.labels.slice(0, 3).join(' & ') || 'Workout';
  let suffix = res.sculpt.map(g => SCULPT_GOALS[g].name)[0] || null;
  if (!suffix && keyBits.length) {
    const g = SCULPT_GOALS[keyBits[0].g];
    if (g && res.groups.includes(g.group)) suffix = g.name;
  }
  let title = base + (suffix && !base.includes(suffix) ? ' · ' + suffix : '');
  if (def.titleSuffix) title += def.titleSuffix;
  if (!lifts.length && cardioBlock) title = cap1(cardioBlock.modality.replace(/_/g, ' '));

  return {
    id: 's_' + now.getTime(), date: ds(now), status: 'planned', startedAt: null, endedAt: null,
    location: location.id || 'home', minutes, title, targets: tgts, source: 'generated',
    blocks, rationale: rationale.slice(0, 6 + Math.min(2, issueLines.length) + (capped ? 1 : 0) + (lifts.some(b => b.sideOnly) ? 1 : 0)), notes: '',
    estMinutes: Math.round(estSec / 60), style, seed, poolLimited, capped,
    ...(def.custom ? { styleDef: def.cfg, styleName: def.name } : {}),
  };
}

// ---------------------------------------------------------------- alternatives / swap / add
export function alternatives(exId, { equipment, exclude = [], limit = 8, issues = null } = {}) {
  const ex = getEx(exId); if (!ex) return [];
  const eq = toEqSet(equipment);
  const IF = issueFilter(issues || []);   // §26: never offer a move an active issue rules out
  const ex2 = new Set([...(exclude || []), ...IF.blocked]);
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
    scored.push([score * (IF.penalty.get(e.id) ?? 1), e]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].id.localeCompare(b[1].id));
  return scored.slice(0, limit).map(x => x[1]);
}

// Same exercises and set counts, re-arranged and re-rested for another style (its pairing, rests at
// nominal length, rep ranges). Used for "≈ N min in this style" previews and the time-saving check.
export function restyle(session, style, { profile, sessions = [], now = new Date() } = {}) {
  const s = cloneSession(session || {});
  const def = resolveStyle(style, profile);
  const all = s.blocks || [];
  // (a style with fixed sets per exercise uses those)
  const items = all.filter(b => b.kind === 'lift' && getEx(b.exId)).map(b => ({ ex: getEx(b.exId), sets: def.setsPerExercise || (b.target?.sets ?? (b.sets || []).length ?? 3), ...(b.sideOnly ? { side: b.sideOnly } : {}) }));
  const ctx = { def, minutes: s.minutes || 45, req: null, sessions, now, cache: new Map() };
  const lifts = items.length ? materialize({ items, restScale: 1 }, ctx, { equalize: false }).blocks : [];
  s.blocks = [...lifts, ...all.filter(b => b.kind !== 'lift')];
  s.style = def.id;
  if (def.custom) { s.styleDef = def.cfg; s.styleName = def.name; } else { delete s.styleDef; delete s.styleName; }
  s.estMinutes = estimateMinutes(s.blocks);
  return s;
}

function cloneSession(s) { return typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)); }

export function swapBlock(session, blockIndex, newExId, { sessions = [], now = new Date() } = {}) {
  const s = cloneSession(session);
  const ex = getEx(newExId);
  const old = s.blocks?.[blockIndex];
  if (!ex || !old) return s;
  const style = resolveStyle(s.styleDef || s.style || 'hypertrophy');
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
  const style = resolveStyle(s.styleDef || s.style || 'hypertrophy');
  s.blocks = s.blocks || [];
  const sets = style.setsPerExercise || (style.base === 'strength' && ex.category === 'compound' ? 4 : 3);
  const b = liftBlock(ex, style, sets, soloRest(ex, style), null, sessions, now, null);
  // insert before any trailing cardio/class finisher
  let at = s.blocks.length;
  while (at > 0 && s.blocks[at - 1].kind !== 'lift') at--;
  if (!s.blocks.some(x => x.kind === 'lift')) at = 0;
  s.blocks.splice(at, 0, b);
  s.estMinutes = estimateMinutes(s.blocks);
  return s;
}

export function exercisesFor(targetId, equipmentSet, { sculptGoals = [], issues = null } = {}) {
  const res = resolveTargets([targetId]);
  const rw = res.regionW;
  if (!Object.keys(rw).length) return [];
  const eq = toEqSet(equipmentSet);
  const IF = issueFilter(issues || []);   // §26
  const tags = new Set([...(sculptGoals || []), ...res.sculpt].map(g => SCULPT_GOALS[g]?.emphasisTag || g));
  const scored = [];
  for (const e of EXERCISES) {
    if (isBackSquat(e) || (eq && !canDo(e, eq)) || IF.blocked.has(e.id)) continue;
    let s = 0, hit = false;
    for (const [r, w] of Object.entries(e.muscles || {})) {
      if (!rw[r]) continue; s += w * rw[r]; if (w >= 0.5) hit = true;
    }
    if (!hit) continue;
    s *= 1 + 0.4 * (e.emphasis || []).filter(t => tags.has(t)).length;
    if ((e.equipment || []).includes('barbell')) s *= 0.8;
    scored.push([s * (IF.penalty.get(e.id) ?? 1), e]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].id.localeCompare(b[1].id));
  return scored.map(x => x[1]);
}
