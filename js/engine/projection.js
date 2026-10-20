// Body projection: a weekly energy-partitioning simulation of lean and fat mass. Pure, DOM-free
// (CONTRACT §13, §15, §17).
//
// Model in one paragraph: each simulated week we recompute maintenance (Katch-McArdle BMR on the
// current lean mass × activity, plus exercise calories), compare it with intake, and let the body
// adapt (extra food partly burned off by digestion + fidgeting/NEAT, a deficit partly offset by
// adaptive thermogenesis). Muscle growth has a CEILING set by training age × volume × protein ×
// cardio interference × how close you are to your genetic limit (FFMI) × supplements/therapies.
// How much of that ceiling you actually reach depends on energy availability (a deficit cuts it, a
// modest surplus maxes it out, more surplus adds nothing). Building a lb of lean tissue costs
// ~1,250 kcal; whatever energy is left over (or missing) is stored (or taken) as fat at ~3,500 kcal/lb.
//
// CONTRACT-NOTE: project() returns these extras beyond the contract shape:
//   series[i].week (0..weeks), series[i].shape (every site filled + heightIn: measured sites are
//     projected from the tape, unmeasured ones are rough population estimates listed in
//     result.shapeEstimated), series[i].muscle { chest, delts, lats, arms, abs, quads, calves, traps }
//     (0..1 development scores for the 3D model; ~0.5 = FFMI ≈ 19.5), series[i].ffmi (normalized),
//     series[i].waterLb (non-tissue scale weight vs today from the supplement stack; included in
//     weightLb, never in lean/fat; bodyFatPct = fat / (lean + fat)), series[i].limbs (L/R sides when
//     measured, moved by the same amount as the averaged site), series[i].ratios, low/high also carry
//     fatLb (+ waist when measured).
//   weekly: also { kcalBalance, groupSetsPerWeek, liftSessionsPerWeek, perWeek:[{ weekStart, kcalIn, kcalOut,
//     balance, liftSets, groupSets, cardioMin, leanGain, leanCeiling, fatChange, source }] }
//   summary: { weeks, endDate, weightLb, fatLb, leanLb, bodyFatPct, waist, waterLb, leanCeilingLb,
//     ceilingUsedPct, leanShare } = end-minus-start deltas (+ horizon totals of the lean model)
//   energy: { intakeSource:'arg'|'nutrition'|'goal', intakeMode:'calories'|'surplus'|'nutrition'|'goal',
//     intakeStart, tdeeStart, tdeeFormula, surplusStart, goal, proteinGPerLb, proteinAssumed, fatPct,
//     cardioDeltaMin, cardioModality, cardioIntensity }
//   macros: macrosFor() at week-1 intake and weight. partition: averages of every factor in the lean
//     model (see buildPartition). tdeeCalibration: { applied, adaptive, formula, offset, weight, note }.
//   startBodyFat: { value, source, method, uncertainty, spread, range, note }.
//   stack: { contributions, warnings, used:boolean } from metabolic.modifiersAt (neutral when useStack=false).
//   driverSource: 'plan' | 'plan+history' | 'history' | 'schedule' | 'plan+schedule' | 'none'
//   missing / missingInfo (from baseline, plus projection-specific items), bodyFatAssumed:boolean
// CONTRACT-NOTE: extra project() inputs: bodyLog, foodLog (for adaptiveTdee calibration) or a
//   precomputed `adaptive` result; useStack (default true; false = neutral modifiers); modifiersFn
//   (optional replacement for metabolic.modifiersAt, same signature; used by tests).
// CONTRACT-NOTE (per-muscle model): series[i].muscleLb = { [groupId]: cumulative lean gained (lb) }
//   (sums to leanLb − start leanLb); weekly.responseByGroup = { [groupId]: 0..~1.36 set response,
//   10 sets = 1.0 }; perWeek[i] also has leanDirect, fatDirect. Exported helpers: setResponse,
//   MUSCLE_SHARE, energyFactor, proteinFactor, interferenceFactor, adaptation, leanRatePctPerMonth,
//   volumeFactor (legacy). stack.direct = { lean, fat } totals from leanDirect/fatDirectLbPerWeek. `intake` may still be a plain number
//   (= calories). intake.surplus is relative to the starting maintenance estimate and then held as
//   fixed calories (like eating the same amount every day).
// CONTRACT-NOTE: nutritionLab() points carry CHANGES over the horizon for leanLb / fatLb / weightLb
//   (tissue + water), plus bodyFatPct (end value), bodyFatChange, endWeightLb, endLeanLb, endFatLb,
//   leanShare (lean ÷ tissue gained, null when not gaining), marginalLeanPerFat (vs the previous point).
//   Extra result fields: maintenance, proteinGPerLb, fatPct, cardioDeltaMin, leanCeilingLb,
//   proteinCurve:[{ gPerLb, leanLb, fatLb }] at the middle of the sweet spot, macros (at that point).
// CONTRACT-NOTE: milestone entries also carry { value, target, reached:boolean, already:boolean }.
// CONTRACT-NOTE: optional profile.body.goalBodyFat (default 12), raceWeightLb / raceBodyFat
//   (default 137 lb / 6.5 % for male, from Bob's marathon days) are read if present.
// CONTRACT-NOTE (long horizon, LONG-HORIZON builder):
//   weeks: 1..418 (8 years; simulated weekly). `series` is downsampled: weekly to week 26, every 2 weeks to 104, every 4 weeks
//     after, always including the last week, milestone weeks and phase boundaries; series[i].week is the real week.
//     `fullSeries: true` adds result.seriesFull (every week, same point shape).
//   phases: array of blocks [{ weeks, goal:'cut'|'maintain'|'lean_bulk'|'bulk'|'custom', calories?, surplus?, proteinGPerLb?,
//     fatPct?, label?, stopAtGoal? }] (+ phasesRepeat, default true), or { blocks, repeat, start:'YYYY-MM-DD' }, or a
//     PHASE_PRESETS id. Default: profile.nutrition.phases when no explicit intake calories/surplus is passed; `phases: null`
//     disables. Surplus is vs the maintenance estimate at each phase start, held for the phase; 'maintain' tracks
//     maintenance weekly; deficit blocks stop at goal body fat (→ maintenance) unless stopAtGoal === false. Sequential
//     plans continue at maintenance after the last block. nutritionLab() ignores phases (it sweeps constant intakes).
//   progressionRealism: false (default) | true (= 0.1) | 0..0.5 → training beyond the planned days fades by that fraction
//     over ~1.5 years (life happens). Result extras: phases (timeline), ceiling, horizon, series[i].phase.
//   Exported helpers: PHASE_PRESETS, ceilingFactor, testosteroneCeilingShift, FFMI_NATURAL_CEILING, MAX_WEEKS, sampleWeeks.
import { sessionVolume } from './recovery.js';
import { dailyTargets, macrosFor, adaptiveTdee } from './nutrition.js';
import { _sessionDetail, NEAT_FACTORS, tdee as formulaTdee } from './bodycomp.js';
import * as MET from './metabolic.js';
import { GROUPS, GROUP_ORDER } from '../data/muscles.js';
import { estimateCalories, CARDIO } from '../data/cardio.js';
import { ds, parseDs, addDays, daysBetween, clamp } from '../util.js';

// ---------------------------------------------------------------- constants (all documented in assumptions)
const LB_PER_KG = 2.20462;
const IN_PER_M = 39.3701;
const KCAL_PER_LB_FAT = 3500;     // adipose tissue, first approximation
const KCAL_PER_LB_LEAN = 1250;    // energy stored in new lean tissue (~800) + cost of synthesising it
const KCAL_LEAN_RELEASED = 800;   // energy released when lean tissue is lost
const DAYS_PER_MONTH = 30.44;
const DEFAULT_BF = { male: 20, female: 28 };
const ESSENTIAL_BF = { male: 5, female: 13 };
// Max lean gain, % bodyweight per month, by months of consistent training. Anchors sit at the conservative end of
// the Aragon guideline (year 1 ≈ 1-1.5 %, year 2 ≈ 0.5-1 %, year 3+ ≈ 0.25-0.5 %) and the McDonald model (≈ 20-25,
// 10-12, 5-6, then 2-3 lb of muscle per year), averaging ≈ 1.07 / 0.69 / 0.44 / 0.27 / 0.18 % in years 1-5.
// Interpolated linearly; past 10 years it keeps decaying exponentially. These are guideline models, not measured
// curves: individual rates differ by ±30-50 % (the band carries that).
const LEAN_RATE_ANCHORS = [[0, 1.25], [6, 1.1], [12, 0.85], [18, 0.68], [24, 0.55], [36, 0.33], [48, 0.21], [60, 0.15], [84, 0.1], [120, 0.065]];
const LEAN_RATE_TAIL_TAU = 72;   // months, decay beyond the last anchor
const TA_FULL_RESP = 0.5;        // weekly whole-body set response that counts as a full month of "training age"
// Genetic ceiling (normalized FFMI). Kouri et al. 1995 (Clin J Sport Med): drug-free athletes rarely exceeded ≈25;
// individual ceilings vary (±≈1.5 here). Gains slow smoothly over the last 4 FFMI points and stop at the ceiling.
export const FFMI_NATURAL_CEILING = 25;
const FFMI_CEIL_SD = 1.5, FFMI_SOFT_SPAN = 4;
// Supraphysiologic testosterone raises the reachable FFMI (Kouri: users averaged ≈3 points higher, up to ≈32).
// Conservative mapping: +0 at the top of the normal range (1,000 ng/dL), +2.0 at the highest studied level (2,400,
// Bhasin 2001), log-linear between, no extrapolation beyond.
const T_CEIL_REF = 1000, T_CEIL_MAX = 2400, T_CEIL_AT_MAX = 2.0;
// Energy balance at long horizons (Hall et al. 2011 Lancet): fat tissue costs ≈3.2 kcal/kg/day, daily movement
// scales with body weight, so maintenance rises as weight is gained and a fixed intake converges.
const GAMMA_FAT_KG = 3.2;
const RMR_AGE_PER_YEAR = 0.001;  // ≈1 %/decade beyond lean-mass changes (low end; Pontzer 2021 finds ≈0 before 60)
const AT_DECAY_WEEKS = 6;        // adaptive thermogenesis fades once out of a deficit (Martins 2020)
const T_DECLINE_PER_YEAR = 0.01, T_DECLINE_FROM_AGE = 40;   // Massachusetts Male Aging Study (~1 %/yr)
const ADH_DECAY_TAU = 78;        // weeks, adherence drift for progressionRealism and the low band
export const MAX_WEEKS = 418;   // 8 years
// Body fat the body defends: below it a fixed diet isn't sustainable (hunger, adaptive thermogenesis), so the
// projection assumes intake rises to maintenance instead of burning into essential fat or muscle.
const DEFENDED_BF = { male: 6, female: 14 };
// Band: maintenance-estimate error fades as weigh-ins re-calibrate it (~6 months), leaving a residual 35 %.
const ENERGY_ERR_TAU = 26, ENERGY_ERR_RESID = 0.35;
// Energy availability → fraction of the ceiling realised. Maintenance ≈ 70 %; a surplus saturates
// it quickly (≈ 93 % at +250, ≈ 98 % at +500); a deficit decays it (≈ 43 % at −300, ≈ 13 % at −1000).
const EF_MAINT = 0.7, EF_TAU_SURPLUS = 180, EF_TAU_DEFICIT = 600;
// Protein (g per lb bodyweight) → fraction of the ceiling. Morton 2018: plateau ≈ 1.6 g/kg
// (0.73 g/lb), upper CI ≈ 2.2 g/kg (1.0 g/lb). No benefit above 1.0 g/lb.
const PROTEIN_ANCHORS = [[0.3, 0.4], [0.4, 0.5], [0.55, 0.74], [0.7, 0.92], [0.8, 0.97], [1.0, 1.0]];
const PROTEIN_ASSUMED = 0.8;     // g/lb assumed when protein is not tracked
// Surplus: the extra food is partly burned (thermic effect ~10 % immediately, NEAT/metabolic rise
// ~42 % phased in over 2 weeks, capped). Levine 1999: on average about half of +1,000 kcal/day.
const TEF_FRAC = 0.10, SURPLUS_ADAPT_FRAC = 0.42, SURPLUS_ADAPT_CAP = 450, SURPLUS_RAMP_WEEKS = 2;
// Deficit: less food → less thermic effect; adaptive thermogenesis 10 % of the deficit (4-week
// ramp) + 10 kcal/day per lb lost, capped.
const AT_DEFICIT_FRAC = 0.1, AT_PER_LB_LOST = 10, AT_CAP = 200, AT_RAMP_WEEKS = 4;
// Cardio interference (Wilson 2012): effective minutes = minutes × impact weight × intensity weight.
// Above 150 effective min/week the lean ceiling drops 4 % per extra 100 min, capped at 20 %.
const INTERF_FREE_MIN = 150, INTERF_PER_100 = 0.04, INTERF_CAP = 0.2;
const IMPACT_W = { high: 1.6, low: 1 };
const INTENSITY_W = { easy: 0.8, moderate: 1, hard: 1.25, intervals: 1.25 };
const HIGH_IMPACT_CLASSES = new Set(['hiit', 'boxing', 'cardio_dance']);
const GOAL_OFFSET = { recomp: -300, cut: -500, lean_bulk: 250 };
const TEMPLATE_HISTORY_DAYS = 28;
const CALIB_WEIGHT = { low: 0.4, medium: 0.7, high: 0.9 };

// Weekly group-set target the volume factor compares against (sum of group minimums).
const GROUP_TARGET_TOTAL = GROUP_ORDER.reduce((a, g) => a + (GROUPS[g]?.weeklySets?.min || 0), 0) || 105;
const TYPICAL_SHARE = Object.fromEntries(GROUP_ORDER.map(g => [g, (GROUPS[g]?.weeklySets?.min || 0) / GROUP_TARGET_TOTAL]));

// Measurement response (inches). FAT: per lb of whole-body fat change (male pattern: waist first,
// limbs least). LEAN: per lb of whole-body lean change when volume is split like the default weekly
// targets; scaled by the actual share of volume.
const FAT_COEF = {
  male: { waist: 0.12, hips: 0.09, chest: 0.06, shoulders: 0.05, thigh: 0.06, arm: 0.03, forearm: 0.01, calf: 0.015, neck: 0.03 },
  female: { waist: 0.10, hips: 0.11, chest: 0.05, shoulders: 0.04, thigh: 0.08, arm: 0.035, forearm: 0.01, calf: 0.015, neck: 0.025 },
};
// Approximate share of trainable skeletal muscle per group for an adult male (legs/glutes ≈ 45 %,
// back ≈ 17 %, the rest upper body/core; after Janssen 2000-style SMM distributions). Normalized below.
const SMM_SHARE_RAW = { chest: 0.08, back: 0.17, shoulders: 0.07, biceps: 0.04, triceps: 0.06, forearms: 0.04, core: 0.08,
  glutes: 0.11, quads: 0.19, hamstrings: 0.09, calves: 0.05 };
const SMM_SUM = Object.values(SMM_SHARE_RAW).reduce((a, b) => a + b, 0);
export const MUSCLE_SHARE = Object.fromEntries(GROUP_ORDER.map(g => [g, (SMM_SHARE_RAW[g] || 0) / SMM_SUM]));
const LEG_GROUPS = new Set(['glutes', 'quads', 'hamstrings', 'calves']);
const SMM_FRAC_OF_LEAN = 0.55;   // skeletal muscle ≈ 55 % of lean mass in men (rest: organs, bone, water)
// Weekly fractional sets → stimulus, normalized so 10 sets = 1.0. A fast component (the first few sets
// do most of the work) + a slow one (more volume keeps helping, with diminishing returns, plateau ≈ 1.36).
// Calibrated to Schoenfeld, Ogborn & Krieger 2017 (<5, 5-9, 10+ sets/wk ≈ 5.4, 6.6, 9.8 % growth;
// ≈ 0.37 %/set) and Pelland 2024 (smaller but continued gains to 20-30+ sets; no decline modelled).
const R_FAST = 0.537, R_FAST_K = 2, R_SLOW = 0.826, R_SLOW_K = 12;
const rRaw = S => R_FAST * (1 - Math.exp(-S / R_FAST_K)) + R_SLOW * (1 - Math.exp(-S / R_SLOW_K));
const R_NORM = rRaw(10);
// Circumference response to muscle gained in the groups under each tape site: Δin = site × 0.5 ×
// (fraction of the cross-section that is muscle) × relative gain of those muscles.
const SITE_LEAN = {
  arm: { groups: { biceps: 1, triceps: 1 }, frac: 0.6 }, forearm: { groups: { forearms: 1, biceps: 0.2 }, frac: 0.55 },
  chest: { groups: { chest: 1, back: 0.6 }, frac: 0.35 }, shoulders: { groups: { shoulders: 1, back: 0.5, chest: 0.3 }, frac: 0.4 },
  thigh: { groups: { quads: 1, hamstrings: 1, glutes: 0.3 }, frac: 0.6 }, calf: { groups: { calves: 1 }, frac: 0.55 },
  neck: { groups: { back: 0.3 }, frac: 0.3 }, hips: { groups: { glutes: 1 }, frac: 0.35 }, waist: { groups: {}, frac: 0 },
};
// 3D muscle scores ← training groups.
const MUSCLE_GROUPS = {
  chest: { chest: 1 }, delts: { shoulders: 1 }, lats: { back: 1 }, arms: { biceps: 1, triceps: 1, forearms: 0.3 },
  abs: { core: 1 }, quads: { quads: 1, glutes: 0.4, hamstrings: 0.4 }, calves: { calves: 1 }, traps: { back: 0.6, shoulders: 0.3 },
};
const FFMI_SCORE_LO = 15, FFMI_SCORE_HI = 24;   // normalized FFMI mapped to 0..1 (19.5 ≈ 0.5)
const SITES = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'arm', 'forearm', 'thigh', 'calf'];
// Reference bodies for estimating unmeasured silhouette sites (rough population-ish values).
const REF_BODY = {
  male: { h: 69, w: 164, bf: 20, neck: 15, shoulders: 46, chest: 39, waist: 33, hips: 38, arm: 13, forearm: 11, thigh: 22, calf: 14.5 },
  female: { h: 64, w: 140, bf: 28, neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14 },
};
const NEUTRAL_MODS = Object.freeze({ leanCeilingMult: 1, leanRetentionMult: 1, partitionShift: 0, tdeeDelta: 0, intakeDelta: 0, waterLb: 0,
  leanDirectLbPerWeek: 0, fatDirectLbPerWeek: 0, contributions: [], warnings: [], ffmiShift: 0, hasAgeFactor: false, tLabNatural: null, tLevel: null });
// Phase defaults (kcal/day vs maintenance at the phase start).
const PHASE_OFFSET = { cut: -500, maintain: 0, lean_bulk: 250, bulk: 500, custom: 0 };
const PHASE_LABEL = { cut: 'Cut', maintain: 'Maintain', lean_bulk: 'Lean bulk', bulk: 'Bulk', custom: 'Custom' };
export const PHASE_PRESETS = [
  { id: 'cycles', label: 'Lean-bulk / mini-cut cycles', desc: '16 weeks at +300 kcal, then a 6-week mini-cut at −500, repeated.', repeat: true,
    blocks: [{ weeks: 16, goal: 'lean_bulk', surplus: 300 }, { weeks: 6, goal: 'cut', surplus: -500 }] },
  { id: 'recomp', label: 'Slow recomp', desc: '−250 kcal (re-set every 12 weeks) until goal body fat, then maintenance.', repeat: true,
    blocks: [{ weeks: 12, goal: 'cut', surplus: -250, label: 'Recomp' }] },
  { id: 'bulk_cut', label: 'Bulk then cut', desc: '26 weeks at +400, a 12-week cut at −500, then maintenance.', repeat: false,
    blocks: [{ weeks: 26, goal: 'bulk', surplus: 400 }, { weeks: 12, goal: 'cut', surplus: -500 }] },
  { id: 'maintain', label: 'Maintain', desc: 'Eat at maintenance the whole time (weight steady, slow recomp).', repeat: true,
    blocks: [{ weeks: 52, goal: 'maintain' }] },
];

// ---------------------------------------------------------------- helpers
const fin = x => (typeof x === 'number' && Number.isFinite(x));
const pos = x => { const n = Number(x); return x != null && x !== '' && Number.isFinite(n) && n > 0 ? n : null; };
const numOr = (x, d) => { const n = Number(x); return x != null && x !== '' && Number.isFinite(n) ? n : d; };
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const sgn = x => (x >= 0 ? '+' : '');
const toDate = now => (now instanceof Date ? now : now ? new Date(now) : new Date());
function interp(anchors, x) {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (x <= x1) { const [x0, y0] = anchors[i - 1]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return anchors[anchors.length - 1][1];
}

// ---------------------------------------------------------------- model curves (exported for tests/UI)
export function leanRatePctPerMonth(months) {
  const m = Math.max(0, Number(months) || 0);
  const [mx, rx] = LEAN_RATE_ANCHORS[LEAN_RATE_ANCHORS.length - 1];
  return m <= mx ? interp(LEAN_RATE_ANCHORS, m) : rx * Math.exp(-(m - mx) / LEAN_RATE_TAIL_TAU);
}
// Fraction of the lean-gain rate left at `gap` normalized-FFMI points below the ceiling: 1 when ≥ 4 points away,
// easing smoothly (zero slope at 4) to 0 at the ceiling, so lean mass approaches it asymptotically.
export function ceilingFactor(gap) {
  const g = Number(gap);
  if (!(g > 0)) return 0;
  if (g >= FFMI_SOFT_SPAN) return 1;
  const x = 1 - g / FFMI_SOFT_SPAN;
  return 1 - x * x;
}
// FFMI points added to the reachable ceiling by a serum testosterone level (ng/dL). 0 within the normal range.
export function testosteroneCeilingShift(level) {
  const T = Number(level);
  if (!(T > T_CEIL_REF)) return 0;
  return T_CEIL_AT_MAX * Math.log(Math.min(T, T_CEIL_MAX) / T_CEIL_REF) / Math.log(T_CEIL_MAX / T_CEIL_REF);
}
// Gentle age factor on muscle-building potential (same curve as metabolic.ageCeiling: −0.4 %/yr past 35, floor 0.8).
function ageCeil(age) { return age == null || age <= 35 ? 1 : Math.max(0.8, 1 - 0.004 * (age - 35)); }
// "12 weeks", "6 months", "18 months", "3.5 years".
export function horizonLabel(weeks) {
  const w = Math.round(Number(weeks) || 0);
  if (w < 26) return `${w} week${w === 1 ? '' : 's'}`;
  const mo = w / 4.345;
  if (w < 104) return `${Math.round(mo)} months`;
  const y = Math.round(w / 52.18 * 2) / 2;
  return `${y % 1 ? y.toFixed(1) : y} years`;
}
// Weeks kept in the downsampled series: weekly to 26, every 2 weeks to 104, every 4 after, plus the last week and extras.
export function sampleWeeks(W, extra = []) {
  const set = new Set();
  for (let k = 0; k <= Math.min(W, 26); k++) set.add(k);
  for (let k = 28; k <= Math.min(W, 104); k += 2) set.add(k);
  for (let k = 108; k <= Math.min(W, 260); k += 4) set.add(k);
  for (let k = 264; k <= W; k += 8) set.add(k);
  set.add(W);
  for (const k of extra) if (Number.isInteger(k) && k >= 0 && k <= W) set.add(k);
  return [...set].sort((a, b) => a - b);
}
// Fraction of the lean ceiling realised at a daily energy balance (kcal/day, intake − maintenance).
export function energyFactor(balance) {
  const b = numOr(balance, 0);
  return b >= 0 ? EF_MAINT + (1 - EF_MAINT) * (1 - Math.exp(-b / EF_TAU_SURPLUS)) : EF_MAINT * Math.exp(b / EF_TAU_DEFICIT);
}
export function proteinFactor(gPerLb) { return interp(PROTEIN_ANCHORS, Math.max(0, numOr(gPerLb, PROTEIN_ASSUMED))); }
// Weekly fractional sets for one muscle group → stimulus (10 sets = 1.0, plateau ≈ 1.36, 0 sets = 0).
export function setResponse(sets) { const S = Math.max(0, numOr(sets, 0)); return rRaw(S) / R_NORM; }
// Legacy whole-body helper (kept for compatibility; the model now works per muscle group).
export function volumeFactor(groupSets) {
  const ratio = Math.max(0, numOr(groupSets, 0) / GROUP_TARGET_TOTAL);
  return Math.min(1.1, (1 - Math.exp(-2 * ratio)) / (1 - Math.exp(-2)));
}
// Effective cardio minutes/week → multiplier on the lean ceiling.
export function interferenceFactor(effectiveMin) {
  return 1 - clamp((numOr(effectiveMin, 0) - INTERF_FREE_MIN) / 100 * INTERF_PER_100, 0, INTERF_CAP);
}
// Kcal/day the body burns off (+) or saves (−) in response to a raw balance, `week` 0-based.
export function adaptation(rawBalance, week = 99, lbLost = 0) {
  const raw = numOr(rawBalance, 0);
  if (raw >= 0) return TEF_FRAC * raw + Math.min(SURPLUS_ADAPT_CAP, SURPLUS_ADAPT_FRAC * raw) * Math.min(1, (week + 1) / SURPLUS_RAMP_WEEKS);
  const d = -raw;
  return -(TEF_FRAC * d + Math.min(AT_CAP, AT_DEFICIT_FRAC * d * Math.min(1, (week + 1) / AT_RAMP_WEEKS) + AT_PER_LB_LOST * Math.max(0, lbLost)));
}
// Leaner people put more of a surplus into muscle (Forbes); mild.
function bfSurplusFactor(bf) { return clamp(1 + 0.01 * (18 - bf), 0.88, 1.06); }
function carbFactor(carbs) { return !(carbs >= 0) ? 1 : carbs < 100 ? 0.95 : carbs < 150 ? 0.98 : 1; }

const emptyDay = () => ({ sets: 0, groupSets: 0, groups: {}, cardioMin: 0, cardioKcal: 0, eqMin: 0, kcal: 0, minutes: 0, lift: 0, cardio: 0 });
function addInto(a, b, f = 1) {
  a.sets += b.sets * f; a.groupSets += b.groupSets * f; a.cardioMin += b.cardioMin * f; a.kcal += b.kcal * f; a.minutes += b.minutes * f;
  a.cardioKcal += (b.cardioKcal || 0) * f; a.eqMin += (b.eqMin || 0) * f;
  a.lift = Math.max(0, Math.min(1, a.lift + b.lift * f)); a.cardio = Math.max(0, Math.min(1, a.cardio + b.cardio * f));
  for (const [g, v] of Object.entries(b.groups)) a.groups[g] = (a.groups[g] || 0) + v * f;
  return a;
}
const noKinds = d => ({ ...d, lift: 0, cardio: 0 });
// Treat a planned session as done (every set done at its target reps) so recovery.sessionVolume counts it.
function asDone(s) {
  if (s.status === 'done') return s;
  return { ...s, status: 'done', blocks: (Array.isArray(s.blocks) ? s.blocks : []).map(b => {
    if (!b || typeof b !== 'object') return b;
    if (b.kind === 'lift') {
      const reps = pos(b.target?.reps) ?? pos(b.target?.repMin) ?? 10;
      const sets = Array.isArray(b.sets) && b.sets.length ? b.sets : Array.from({ length: pos(b.target?.sets) || 0 }, () => ({}));
      return { ...b, sets: sets.map(x => ({ ...x, done: true, r: pos(x?.r) ?? reps })) };
    }
    return { ...b, done: true };
  }) };
}
// Cardio kcal and interference-weighted minutes for one (done or assumed-done) session.
function cardioStats(s, weightLb) {
  let kcal = 0, eq = 0;
  for (const b of s?.blocks || []) {
    if (!b || !b.done) continue;
    if (b.kind === 'cardio') {
      const min = pos(b.minutes) ?? 0;
      if (!min) continue;
      const k = pos(b.calories) ?? estimateCalories(b.modality, min, b.intensity || 'moderate', weightLb);
      kcal += k > 0 ? k : 6 * (weightLb / LB_PER_KG) * min / 60;
      eq += min * (IMPACT_W[CARDIO[b.modality]?.impact] ?? 1) * (INTENSITY_W[b.intensity] ?? 1);
    } else if (b.kind === 'class') {
      const ci = b.classify || {};
      const min = fin(ci.cardioMinutes) ? ci.cardioMinutes : pos(b.duration) ?? 0;
      eq += min * (HIGH_IMPACT_CLASSES.has(ci.type) ? IMPACT_W.high : 1) * (INTENSITY_W[ci.intensity] ?? 1);
    }
  }
  return { kcal, eq };
}
function sessionContribution(s, weightLb) {
  const d = asDone(s);
  let v;
  try { v = sessionVolume(d); } catch (e) { v = { groups: {}, liftSets: 0, cardioMin: 0 }; }
  let det;
  try { det = _sessionDetail(d, { weightLb }); } catch (e) { det = { kcal: 0, minutes: 0 }; }
  const cs = cardioStats(d, weightLb);
  const groups = {};
  let groupSets = 0;
  for (const [g, x] of Object.entries(v.groups || {})) if (fin(x) && x > 0) { groups[g] = x; groupSets += x; }
  const cardioMin = fin(v.cardioMin) ? v.cardioMin : 0;
  return { sets: v.liftSets || 0, groupSets, groups, cardioMin, cardioKcal: cs.kcal, eqMin: cs.eq,
    kcal: fin(det.kcal) ? det.kcal : 0, minutes: fin(det.minutes) ? det.minutes : 0,
    lift: (v.liftSets || 0) > 0 || groupSets >= 3 ? 1 : 0, cardio: cardioMin >= 10 ? 1 : 0 };
}
// Fallback when there is no plan and no history: the weekly schedule template.
function scheduleDay(entry, weightLb) {
  const out = emptyDay();
  if (!entry || entry.kind === 'rest') return out;
  const min = pos(entry.minutes) ?? 0;
  if (!min) return out;
  const liftShare = entry.kind === 'lift' ? 1 : entry.kind === 'cardio' ? 0 : 0.5;
  const liftMin = min * liftShare, cardioMin = min - liftMin;
  const sets = liftMin / 2.7;                                 // ~2.7 min per working set incl. rest/setup
  out.sets = sets; out.groupSets = sets * 1.5;                // compounds credit ~1.5 groups per set
  for (const g of GROUP_ORDER) out.groups[g] = out.groupSets * TYPICAL_SHARE[g];
  out.cardioMin = cardioMin;
  out.cardioKcal = estimateCalories('bike', cardioMin, 'easy', weightLb);
  out.eqMin = cardioMin * INTENSITY_W.easy;
  out.kcal = 5 * (weightLb / 165) * liftMin + out.cardioKcal;
  out.minutes = min; out.lift = liftShare > 0 ? 1 : 0; out.cardio = cardioMin >= 10 ? 1 : 0;
  return out;
}
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function sanitizeMods(m) {
  if (!m || typeof m !== 'object') return NEUTRAL_MODS;
  const t = m.testosterone && typeof m.testosterone === 'object' ? m.testosterone : null;
  const tLevel = t && t.source && t.source !== 'natural' && pos(t.level) ? Number(t.level) : null;
  const labT = m.levels && m.levels.totalTSource === 'lab' && pos(m.levels.totalT) ? Number(m.levels.totalT) : null;
  return {
    // FFMI ceiling shift: metabolic may provide it directly; otherwise derived from an on-therapy testosterone level.
    ffmiShift: fin(Number(m.ffmiCeilingDelta)) && m.ffmiCeilingDelta !== null ? clamp(Number(m.ffmiCeilingDelta), -3, 6) : tLevel ? testosteroneCeilingShift(tLevel) : 0,
    tLevel,
    // Natural lab testosterone (not on therapy): metabolic keeps it fixed, so projection ages it (no double count).
    tLabNatural: labT && (!t || !t.source || t.source === 'natural') ? labT : null,
    hasAgeFactor: Array.isArray(m.factors) && m.factors.some(f => f && f.id === 'age'),
    // NaN/sanity guards only: study-bounded curves live in metabolic.js and must not be flattened here.
    leanCeilingMult: clamp(numOr(m.leanCeilingMult, 1), 0, 10),
    leanRetentionMult: clamp(numOr(m.leanRetentionMult, 1), 0, 5),
    partitionShift: clamp(numOr(m.partitionShift, 0), -0.5, 0.5),
    leanDirectLbPerWeek: clamp(numOr(m.leanDirectLbPerWeek, 0), -3, 3),
    fatDirectLbPerWeek: clamp(numOr(m.fatDirectLbPerWeek, 0), -3, 3),
    tdeeDelta: clamp(numOr(m.tdeeDelta, 0), -800, 800),
    intakeDelta: clamp(numOr(m.intakeDelta, 0), -1500, 1000),
    waterLb: clamp(numOr(m.waterLb, 0), -10, 15),
    contributions: Array.isArray(m.contributions) ? m.contributions.filter(c => c && typeof c === 'object') : [],
    warnings: Array.isArray(m.warnings) ? m.warnings.filter(w => typeof w === 'string' && w) : [],
  };
}
function emptyResult(missing, missingInfo) {
  return { series: [], milestones: [], weekly: { kcalIn: 0, kcalOut: 0, liftSetsPerWeek: 0, cardioMinPerWeek: 0, setsByGroup: {}, perWeek: [] },
    assumptions: ['No bodyweight logged yet, so nothing can be projected. Log a morning weigh-in to start.'],
    confidence: 'low', summary: null, energy: null, macros: null, partition: null, tdeeCalibration: null, startBodyFat: null,
    stack: { contributions: [], warnings: [], used: false },
    missing, missingInfo, shapeEstimated: [], driverSource: 'none', bodyFatAssumed: false };
}

// ---------------------------------------------------------------- preparation (shared by project + lab)
function prepare({ baseline: b, profile = {}, sessions = [], weeks = 12, now = new Date(), intake = null,
  adherence = 0.85, repeatPlan = true, cardioDeltaMin = 0, cardioModality = 'bike', cardioIntensity = 'easy',
  bodyLog = null, foodLog = null, adaptive = undefined, useStack = true, modifiersFn = null,
  phases = undefined, phasesRepeat = true, progressionRealism = false, stopAtGoal = false } = {}) {
  profile = profile && typeof profile === 'object' ? profile : {};
  const body = profile.body || {};
  const sex = (b?.sex || body.sex) === 'female' ? 'female' : 'male';
  const nowD = toDate(now);
  const today = ds(nowD);
  const W = clamp(Math.round(Number(weeks) || 12), 1, MAX_WEEKS);
  const adh = fin(Number(adherence)) && adherence !== null ? clamp(Number(adherence), 0, 1) : 0.85;
  const missing = [...(b?.missing || [])];
  const missingInfo = [...(b?.missingInfo || [])];
  if (!b || !pos(b.weightLb)) {
    if (!missing.includes('weight')) { missing.unshift('weight'); missingInfo.unshift({ field: 'weight', label: 'Bodyweight', why: 'The projection needs a starting weight.' }); }
    return { empty: true, result: emptyResult(missing, missingInfo) };
  }

  // ---------------- starting state
  const W0 = Number(b.weightLb);
  const bfAssumed = !pos(b.bodyFatPct);
  const bf0 = bfAssumed ? DEFAULT_BF[sex] : Number(b.bodyFatPct);
  const L0 = W0 * (1 - bf0 / 100), F0 = W0 - L0;
  const heightIn = pos(b.heightIn);
  const hM = (heightIn || REF_BODY[sex].h) / IN_PER_M;
  const ffmiOf = L => (L / LB_PER_KG) / (hM * hM) + 6.1 * (1.8 - hM);
  const months0 = Number.isFinite(Number(body.trainingMonths)) && Number(body.trainingMonths) >= 0 ? Number(body.trainingMonths) : 6;
  const neatFactor = NEAT_FACTORS[body.activity] ?? NEAT_FACTORS.desk;
  const goal = GOAL_OFFSET[profile.goal] != null ? profile.goal : 'recomp';
  const nut = profile.nutrition && typeof profile.nutrition === 'object' ? profile.nutrition : {};
  const nutritionOn = !!(nut.mode && nut.mode !== 'off');
  const goalBf = pos(body.goalBodyFat) || 12;
  const age = pos(b.age) ?? (pos(body.birthYear) ? nowD.getFullYear() - Number(body.birthYear) : null);

  // ---------------- intake spec
  const spec = typeof intake === 'number' || typeof intake === 'string' ? { calories: intake } : intake && typeof intake === 'object' ? intake : {};
  const specCal = pos(spec.calories);
  const specSurplus = spec.surplus != null && spec.surplus !== '' && fin(Number(spec.surplus)) ? clamp(Number(spec.surplus), -2000, 2500) : null;
  let proteinGPerLb = pos(spec.proteinGPerLb) ?? pos(nut.proteinGPerLb) ?? null;
  let proteinAssumed = false;
  if (proteinGPerLb == null) {
    if (nutritionOn && pos(nut.protein)) proteinGPerLb = Number(nut.protein) / W0;
    else if (nutritionOn) proteinGPerLb = goal === 'cut' ? 1.15 : 1.0;
    else { proteinGPerLb = PROTEIN_ASSUMED; proteinAssumed = true; }
  }
  proteinGPerLb = clamp(proteinGPerLb, 0.3, 2);
  const fatPct = clamp(pos(spec.fatPct) ?? pos(nut.fatPct) ?? 25, 10, 60);
  const macroProfile = { ...profile, nutrition: { ...nut, proteinGPerLb, fatPct, protein: null } };

  // ---------------- cardio delta
  const cdMin = clamp(numOr(cardioDeltaMin, 0), -2000, 2000);
  const cdMod = CARDIO[cardioModality] ? cardioModality : 'bike';
  const cdInt = INTENSITY_W[cardioIntensity] ? cardioIntensity : 'easy';

  // ---------------- training drivers, per day
  const endDate = ds(addDays(parseDs(today), 7 * Math.max(W, 12) - 1));
  const daily = new Map();                       // date → expected contribution (planned × adherence + done)
  const dailyRaw = new Map();                    // date → unscaled (for nutrition day types)
  let lastPlanned = null, plannedCount = 0;
  const all = Array.isArray(sessions) ? sessions.filter(s => s && typeof s.date === 'string') : [];
  for (const s of all) {
    if (s.date < today || s.date > endDate) continue;
    const isPlan = s.status === 'planned' || s.status === 'active';
    if (!isPlan && s.status !== 'done') continue;
    if (isPlan && s.plan?.kind === 'rest' && !(s.blocks || []).length) { if (!lastPlanned || s.date > lastPlanned) lastPlanned = s.date; continue; }
    const c = sessionContribution(s, W0);
    if (!daily.has(s.date)) { daily.set(s.date, emptyDay()); dailyRaw.set(s.date, emptyDay()); }
    addInto(daily.get(s.date), c, isPlan ? adh : 1);
    addInto(dailyRaw.get(s.date), c, 1);
    if (isPlan) plannedCount++;
    if (!lastPlanned || s.date > lastPlanned) lastPlanned = s.date;
  }
  // Recent history (done sessions, last 28 days before today).
  const histFrom = ds(addDays(parseDs(today), -TEMPLATE_HISTORY_DAYS));
  const hist = all.filter(s => s.status === 'done' && s.date >= histFrom && s.date < today);
  const doneEver = all.filter(s => s.status === 'done' && s.date < today).map(s => s.date).sort();
  const histDays = hist.length ? clamp(daysBetween(doneEver.find(d => d >= histFrom) || histFrom, today), 7, TEMPLATE_HISTORY_DAYS) : 0;
  const histTotal = emptyDay();
  const histDayKinds = new Map();
  for (const s of hist) {
    const c = sessionContribution(s, W0);
    addInto(histTotal, noKinds(c), 1);
    const k = histDayKinds.get(s.date) || { lift: 0, cardio: 0 };
    k.lift = Math.max(k.lift, c.lift); k.cardio = Math.max(k.cardio, c.cardio); histDayKinds.set(s.date, k);
  }
  // Per-day template = days-weighted average of the planned span and recent history.
  const planDays = lastPlanned ? daysBetween(today, lastPlanned) + 1 : 0;
  const template = emptyDay();
  let tplLiftFrac = 0, tplCardioFrac = 0, tplBothFrac = 0;
  let driverSource = 'none';
  const totDays = planDays + histDays;
  if (totDays > 0) {
    const planTotal = emptyDay(); let pl = 0, pc = 0, pb = 0;
    for (const [d, c] of daily) { if (d <= lastPlanned) addInto(planTotal, noKinds(c)); }
    for (const [d, c] of dailyRaw) { if (d <= lastPlanned) { pl += c.lift; pc += c.cardio; pb += c.lift && c.cardio ? 1 : 0; } }
    let hl = 0, hc = 0, hb = 0;
    for (const k of histDayKinds.values()) { hl += k.lift; hc += k.cardio; hb += k.lift && k.cardio ? 1 : 0; }
    addInto(template, noKinds(planTotal), 1 / totDays);
    addInto(template, noKinds(histTotal), 1 / totDays);
    tplLiftFrac = (pl + hl) / totDays; tplCardioFrac = (pc + hc) / totDays; tplBothFrac = (pb + hb) / totDays;
    driverSource = planDays && histDays ? 'plan+history' : planDays ? 'plan' : 'history';
    if (planDays && !plannedCount && !histDays) driverSource = 'none';
  }
  const templateEmpty = template.groupSets <= 0 && template.cardioMin <= 0;
  let scheduleTemplate = null;
  if (templateEmpty && profile.schedule && typeof profile.schedule === 'object') {
    const t = emptyDay(); let l = 0, c = 0, both = 0;
    for (const dow of DOW) {
      const d = scheduleDay(profile.schedule[dow], W0);
      addInto(t, noKinds(d), adh / 7);
      l += d.lift; c += d.cardio; both += d.lift && d.cardio ? 1 : 0;
    }
    if (t.groupSets > 0 || t.cardioMin > 0) {
      scheduleTemplate = t; tplLiftFrac = l / 7; tplCardioFrac = c / 7; tplBothFrac = both / 7;
      driverSource = plannedCount ? 'plan+schedule' : 'schedule';
    }
  }
  const tpl = scheduleTemplate || template;
  const useTemplateBeyond = repeatPlan || (!plannedCount && !!scheduleTemplate);

  // Weekly drivers (+ the cardio delta).
  const cdKcalPerMin = estimateCalories(cdMod, 60, cdInt, W0) / 60;
  const cdEqPerMin = (IMPACT_W[CARDIO[cdMod]?.impact] ?? 1) * INTENSITY_W[cdInt];
  let maxDaily = null;
  for (const d of daily.keys()) if (!maxDaily || d > maxDaily) maxDaily = d;
  const realism = progressionRealism === true ? 0.1 : clamp(numOr(progressionRealism, 0), 0, 0.5);
  const weekDrivers = [];
  const start0 = parseDs(today);
  const Wd = Math.max(W, 12);   // ≥ 12 weeks so maintenance (averaged over the first 12) doesn't depend on the horizon
  for (let k = 0; k < Wd; k++) {
    const wk = emptyDay();
    let lD = 0, cD = 0, bD = 0, planD = 0, tplD = 0;
    const wkStart = ds(addDays(start0, 7 * k));
    if ((!lastPlanned || wkStart > lastPlanned) && useTemplateBeyond && (!maxDaily || wkStart > maxDaily)) {
      // Fast path for long horizons: a whole template week (nothing logged or planned).
      addInto(wk, noKinds(tpl), 7);
      lD = 7 * tplLiftFrac; cD = 7 * tplCardioFrac; bD = 7 * tplBothFrac; tplD = 7;
    } else for (let i = 0; i < 7; i++) {
      const d = i ? ds(addDays(start0, 7 * k + i)) : wkStart;
      const beyond = !lastPlanned || d > lastPlanned;
      if (beyond && useTemplateBeyond) {
        addInto(wk, noKinds(tpl));
        lD += tplLiftFrac; cD += tplCardioFrac; bD += tplBothFrac; tplD++;
        if (daily.has(d)) addInto(wk, noKinds(daily.get(d)));   // done today beyond plan
      } else {
        const c = daily.get(d), raw = dailyRaw.get(d);
        if (c) addInto(wk, noKinds(c));
        if (raw) { lD += raw.lift; cD += raw.cardio; bD += raw.lift && raw.cardio ? 1 : 0; }
        if (!beyond) planD++;
      }
    }
    if (realism && tplD === 7) {
      // progressionRealism: repeated template weeks fade slowly (missed weeks, travel, life), ~63 % of the way by 1.5 years.
      const f = 1 - realism * (1 - Math.exp(-k / ADH_DECAY_TAU));
      for (const key of ['sets', 'groupSets', 'cardioMin', 'cardioKcal', 'eqMin', 'kcal', 'minutes']) wk[key] *= f;
      for (const g of Object.keys(wk.groups)) wk.groups[g] *= f;
    }
    if (cdMin) {
      const delta = Math.max(cdMin, -wk.cardioMin);
      const perMin = delta < 0 && wk.cardioMin > 0 && wk.cardioKcal > 0 ? wk.cardioKcal / wk.cardioMin : cdKcalPerMin;
      const eqPerMin = delta < 0 && wk.cardioMin > 0 ? wk.eqMin / wk.cardioMin : cdEqPerMin;
      wk.cardioMin += delta; wk.minutes = Math.max(0, wk.minutes + delta);
      wk.kcal = Math.max(0, wk.kcal + perMin * delta); wk.cardioKcal = Math.max(0, wk.cardioKcal + perMin * delta);
      wk.eqMin = Math.max(0, wk.eqMin + eqPerMin * delta);
    }
    wk.liftDays = lD; wk.cardioDays = cD; wk.bothDays = bD;
    wk.source = planD && tplD ? 'mixed' : planD ? 'plan' : tplD && (tpl.groupSets > 0 || tpl.cardioMin > 0) ? 'template' : wk.groupSets > 0 || wk.cardioMin > 0 ? 'plan' : 'none';
    weekDrivers.push(wk);
  }

  // Volume share by group across the horizon (for measurement and muscle-score distribution).
  const horizonGroups = {};
  let horizonGroupSets = 0;
  for (const wk of weekDrivers.slice(0, W)) for (const [g, v] of Object.entries(wk.groups)) { horizonGroups[g] = (horizonGroups[g] || 0) + v; horizonGroupSets += v; }
  const smm0 = L0 * SMM_FRAC_OF_LEAN;    // starting skeletal muscle (lb), for relative per-group growth

  // ---------------- energy helpers
  const bmrOf = L => 370 + 21.6 * (L / LB_PER_KG);                     // Katch-McArdle on current lean mass
  const restPerMinOf = L => bmrOf(L) * (1 + neatFactor) / 1440;
  const exNetPerDay = (wk, Wt, L) => Math.max(0, wk.kcal * (Wt / W0) - restPerMinOf(L) * wk.minutes) / 7;
  const avgEx = weekDrivers.slice(0, 12).reduce((a, wk) => a + exNetPerDay(wk, W0, L0), 0) / 12;
  const tdeeFormula = bmrOf(L0) * (1 + neatFactor) + avgEx;

  // ---------------- TDEE calibration from logged food + weight trend
  let calib = { applied: false, adaptive: null, formula: null, offset: 0, weight: 0, note: 'No food log with matching weigh-ins (needs 10+ days of both), so maintenance comes from the formula.' };
  let at = adaptive;
  if (at === undefined && (Array.isArray(bodyLog) || Array.isArray(foodLog))) {
    try { at = adaptiveTdee({ bodyLog: bodyLog || [], foodLog: foodLog || [], to: today }); } catch (e) { at = null; }
  }
  if (at && pos(at.tdee)) {
    let exPast = 0;
    try {
      const doneIn = all.filter(s => s.status === 'done' && (!at.from || s.date >= at.from) && (!at.to || s.date <= at.to));
      const t = formulaTdee({ comp: { bmr: bmrOf(L0), weightLb: W0 }, activity: body.activity || 'desk', sessions: doneIn, from: at.from, to: at.to || today, now: nowD });
      exPast = fin(t.exercise) ? t.exercise : 0;
    } catch (e) { exPast = 0; }
    const formulaPast = bmrOf(L0) * (1 + neatFactor) + exPast;
    const w = CALIB_WEIGHT[at.confidence] ?? 0.4;
    const offset = clamp(w * (Number(at.tdee) - formulaPast), -600, 600);
    calib = { applied: true, adaptive: Math.round(Number(at.tdee)), formula: Math.round(formulaPast), offset: Math.round(offset), weight: w, confidence: at.confidence || 'low',
      note: `Your logs say you burn about ${Math.round(Number(at.tdee))} kcal/day; the formula said ${Math.round(formulaPast)}. Maintenance is shifted ${sgn(offset)}${Math.round(offset)} kcal/day (${Math.round(w * 100)}% trust in the logs, ${at.confidence || 'low'} confidence).` };
  }
  const tdeeStart = tdeeFormula + calib.offset;

  // ---------------- stack (supplements/therapies + metabolic values)
  const stackUsed = useStack !== false;
  const modCache = new Map();
  // Age is recomputed for every simulated date and handed to modifiersAt (it ages T, the age factor, …).
  const ageOn = dateStr => (age == null ? undefined : age + daysBetween(today, dateStr) / 365.25);
  const modsAt = (dateStr, inDeficit) => {
    if (!stackUsed) return NEUTRAL_MODS;
    const key = dateStr + (inDeficit ? 'd' : 's');
    if (!modCache.has(key)) {
      let m;
      const fn = typeof modifiersFn === 'function' ? modifiersFn : MET.modifiersAt;
      try { m = fn(profile, dateStr, { age: ageOn(dateStr), inDeficit: !!inDeficit }); } catch (e) { m = null; }
      modCache.set(key, sanitizeMods(m));
    }
    return modCache.get(key);
  };
  const water0 = modsAt(today, false).waterLb;
  // Long horizons: modifiers move slowly after the first months, so weeks past 26 reuse one evaluation per 4 weeks.
  const repWeek = k => (k < 26 ? k : Math.min(W - 1, 26 + 4 * Math.floor((k - 26) / 4) + 2));
  const modsWeek = (k, inDeficit) => modsAt(midDates[repWeek(k)], inDeficit);
  const waterWeek = (k, inDeficit) => modsAt(k < 26 ? endDates[k] : endDates[repWeek(k)], inDeficit).waterLb;
  // Per-week calendar: mid-week date (modifiers), end date (water), age at mid-week, extra RMR decline with age.
  const midDates = [], endDates = [], ageMid = [], rmrAge = [];
  for (let k = 0; k < W; k++) {
    midDates.push(ds(addDays(start0, 7 * k + 3))); endDates.push(ds(addDays(start0, 7 * (k + 1))));
    const yrs = (7 * k + 3.5) / 365.25;
    ageMid.push(age == null ? null : age + yrs);
    rmrAge.push(age == null ? 0 : bmrOf(L0) * RMR_AGE_PER_YEAR * yrs);
  }
  // Lean-potential multiplier from aging over the horizon: metabolic's age factor already moves with the per-week age
  // when present; otherwise the same gentle curve is applied relative to today. A natural testosterone LAB stays fixed
  // in metabolic, so it is aged here (~1 %/yr past 40); assumed-average T already declines with age in metabolic.
  const ageCache = new Map();
  const teFn = typeof MET.testosteroneEffect === 'function' ? MET.testosteroneEffect : null;
  const leanAgeFactor = (k, mods) => {
    if (age == null) return 1;
    const key = k + '|' + (mods.hasAgeFactor ? 1 : 0) + '|' + (mods.tLabNatural || 0);
    if (ageCache.has(key)) return ageCache.get(key);
    const a = ageMid[k];
    let f = mods.hasAgeFactor ? 1 : ageCeil(a) / ageCeil(age);
    if (mods.tLabNatural && teFn) {
      const yrs = Math.max(0, a - Math.max(T_DECLINE_FROM_AGE, age));
      if (yrs > 0) {
        try {
          const t0 = teFn(mods.tLabNatural, { age: a }).leanCeilingMult, t1 = teFn(mods.tLabNatural * Math.pow(1 - T_DECLINE_PER_YEAR, yrs), { age: a }).leanCeilingMult;
          if (fin(t0) && fin(t1) && t0 > 0) f *= clamp(t1 / t0, 0.5, 1);
        } catch (e) { /* metabolic mid-edit: skip */ }
      }
    }
    ageCache.set(key, f);
    return f;
  };
  // Genetic ceiling (normalized FFMI) and the lean mass it corresponds to at this height.
  const ffmiCeil = pos(body.ffmiCeiling) && Number(body.ffmiCeiling) >= 18 && Number(body.ffmiCeiling) <= 30 ? Number(body.ffmiCeiling) : FFMI_NATURAL_CEILING;
  const leanAtFfmi = C => (C - 6.1 * (1.8 - hM)) * hM * hM * LB_PER_KG;
  const PA0 = neatFactor * bmrOf(L0);                        // daily-movement burn, scales with body weight (Hall 2011)
  const gammaFatLb = GAMMA_FAT_KG / LB_PER_KG;

  // ---------------- intake
  const intakeMode = specCal ? 'calories' : specSurplus != null ? 'surplus' : nutritionOn ? 'nutrition' : 'goal';
  const intakeSource = intakeMode === 'calories' || intakeMode === 'surplus' ? 'arg' : intakeMode;
  const userSet = intakeMode === 'calories' || intakeMode === 'surplus' || (intakeMode === 'nutrition' && (pos(nut.calories) || (nut.surplus != null && nut.surplus !== '' && fin(Number(nut.surplus)))));
  const goalIntake = tdeeStart + GOAL_OFFSET[goal];
  const fixedIntake = intakeMode === 'calories' ? specCal : intakeMode === 'surplus' ? Math.max(800, tdeeStart + specSurplus) : null;

  // ---------------- nutrition phases (explicit arg, else the saved plan unless an explicit intake was passed)
  let phaseSrc = phases;
  // Saved plan: nutrition.phasePlan ({ preset, repeat, blocks, start }) or the shared dated list nutrition.phases (targets.js).
  if (phaseSrc === undefined) phaseSrc = !specCal && specSurplus == null ? (nut.phasePlan || (Array.isArray(nut.phases) && nut.phases.length ? nut.phases : null)) : null;
  const phasePlan = buildPhasePlan(phaseSrc, phasesRepeat, W, today);
  // Set responses per week (the expensive part of the lean model), reused by every simulation of this context.
  const weekResp = weekDrivers.slice(0, W).map(wk => {
    const R = GROUP_ORDER.map(g => setResponse(wk.groups[g] || 0));
    return { R, respW: GROUP_ORDER.reduce((a, g, i) => a + MUSCLE_SHARE[g] * R[i], 0) };
  });

  return {
    empty: false, b, profile, body, sex, today, nowD, W, adh, W0, bfAssumed, bf0, L0, F0, heightIn, hM, ffmiOf, months0, neatFactor, goal,
    nut, nutritionOn, goalBf, age, missing, missingInfo, proteinGPerLb, proteinAssumed, fatPct, macroProfile, cdMin, cdMod, cdInt,
    all, hist, histDays, plannedCount, lastPlanned, driverSource, useTemplateBeyond, weekDrivers, horizonGroups, horizonGroupSets,
    smm0, bmrOf, exNetPerDay, avgEx, tdeeFormula, calib, tdeeStart, stackUsed, modsAt, water0,
    intakeMode, intakeSource, userSet, goalIntake, fixedIntake, specSurplus,
    midDates, endDates, ageMid, rmrAge, leanAgeFactor, ffmiCeil, leanAtFfmi, PA0, gammaFatLb, phasePlan, realism, modsWeek, waterWeek,
    weekResp, stopAtGoal: !!stopAtGoal,
  };
}

// targets.js format: [{ label, start, end|null, surplus|null, calories|null }] → per-week plan (gaps = maintenance).
function datedPhasePlan(list, W, today) {
  const goalOf = x => (pos(x.calories) ? 'custom' : !fin(Number(x.surplus)) || x.surplus === null || Number(x.surplus) === 0 ? 'maintain' : Number(x.surplus) < 0 ? 'cut' : Number(x.surplus) >= 400 ? 'bulk' : 'lean_bulk');
  const items = list.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.start)).slice(0, 24).sort((a, b) => a.start.localeCompare(b.start)).map(x => {
    const goal = goalOf(x);
    const s0 = Math.floor(daysBetween(today, x.start) / 7);
    const e0 = typeof x.end === 'string' && x.end > x.start ? Math.ceil(daysBetween(today, x.end) / 7) : MAX_WEEKS + 1;
    const calories = pos(x.calories) ? clamp(Number(x.calories), 800, 6000) : null;
    const surplus = goal === 'maintain' || calories ? 0 : clamp(Number(x.surplus), -2000, 2500);
    return { weeks: Math.max(1, e0 - s0), goal, calories, surplus, mode: goal === 'maintain' ? 'track' : 'fixed', proteinGPerLb: null, fatPct: null,
      label: typeof x.label === 'string' && x.label.trim() ? x.label.trim().slice(0, 40) : PHASE_LABEL[goal], stopAtGoal: true, s0, e0 };
  });
  if (!items.length) return null;
  const blocks = [...items, { weeks: MAX_WEEKS, goal: 'maintain', calories: null, surplus: 0, mode: 'track', proteinGPerLb: null, fatPct: null, label: 'Maintain', stopAtGoal: false, after: true }];
  const gap = blocks.length - 1;
  const at = [], instances = [];
  for (let k = 0; k < W; k++) {
    let bi = gap, st = null;
    for (let i = items.length - 1; i >= 0; i--) if (items[i].s0 <= k && k < items[i].e0) { bi = i; st = items[i].s0; break; }
    if (st == null) { const prev = at[k - 1]; st = prev && prev.bi === gap ? prev.start : k; }
    at.push({ bi, start: st });
    const last = instances[instances.length - 1];
    if (!last || last.start !== st || last.bi !== bi) instances.push({ bi, start: st, startWeek: Math.max(0, st), endWeek: k + 1 });
    else last.endWeek = k + 1;
  }
  return { blocks, repeat: false, offset: 0, cycle: null, at, instances, preset: null, start: items[0].start, dated: true };
}

// Normalizes a phase spec into a per-week schedule. Returns null when there are no usable blocks.
export function buildPhasePlan(src, repeatDefault = true, W = 52, today = ds()) {
  if (src == null || src === false) return null;
  let blocksIn = null, repeat = repeatDefault !== false, start = null, preset = null;
  if (typeof src === 'string') { const p = PHASE_PRESETS.find(x => x.id === src); if (!p) return null; blocksIn = p.blocks; repeat = p.repeat; preset = p.id; }
  else if (Array.isArray(src) && src.length && src.every(x => x && typeof x.start === 'string' && x.weeks == null)) return datedPhasePlan(src, W, today);
  else if (Array.isArray(src)) blocksIn = src;
  else if (typeof src === 'object') {
    const p = src.preset ? PHASE_PRESETS.find(x => x.id === src.preset) : null;
    blocksIn = Array.isArray(src.blocks) && src.blocks.length ? src.blocks : p ? p.blocks : null;
    repeat = src.repeat != null ? src.repeat !== false : p ? p.repeat : repeat;
    start = typeof src.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.start) ? src.start : null;
    preset = p ? p.id : null;
  }
  if (!Array.isArray(blocksIn)) return null;
  const blocks = blocksIn.filter(x => x && typeof x === 'object').slice(0, 12).map(x => {
    const goal = PHASE_OFFSET[x.goal] != null ? x.goal : 'custom';
    const calories = pos(x.calories) ? clamp(Number(x.calories), 800, 6000) : null;
    const hasSur = x.surplus != null && x.surplus !== '' && fin(Number(x.surplus));
    const surplus = hasSur ? clamp(Number(x.surplus), -2000, 2500) : PHASE_OFFSET[goal];
    const mode = calories == null && (goal === 'maintain' ? !hasSur || surplus === 0 : goal === 'custom' && !hasSur) ? 'track' : 'fixed';
    return { weeks: clamp(Math.round(numOr(x.weeks, 12)), 1, MAX_WEEKS), goal, calories, surplus: mode === 'track' ? 0 : surplus, mode,
      proteinGPerLb: pos(x.proteinGPerLb) ? clamp(Number(x.proteinGPerLb), 0.3, 2) : null, fatPct: pos(x.fatPct) ? clamp(Number(x.fatPct), 10, 60) : null,
      label: typeof x.label === 'string' && x.label.trim() ? x.label.trim().slice(0, 40) : PHASE_LABEL[goal],
      stopAtGoal: x.stopAtGoal !== false };
  });
  if (!blocks.length) return null;
  const cycle = blocks.reduce((a, x) => a + x.weeks, 0);
  const offset = start && start < today ? Math.max(0, Math.floor(daysBetween(start, today) / 7)) : 0;
  const all = repeat ? blocks : [...blocks, { weeks: MAX_WEEKS, goal: 'maintain', calories: null, surplus: 0, mode: 'track', proteinGPerLb: null, fatPct: null, label: 'Maintain (after plan)', stopAtGoal: false, after: true }];
  const at = [], instances = [];
  for (let k = 0; k < W; k++) {
    const t = k + offset;
    let bi, s0;
    if (!repeat && t >= cycle) { bi = blocks.length; s0 = cycle - offset; }
    else {
      const tc = repeat ? t % cycle : t;
      let acc = 0; bi = 0;
      while (bi < blocks.length - 1 && tc >= acc + blocks[bi].weeks) { acc += blocks[bi].weeks; bi++; }
      s0 = k - (tc - acc);
    }
    at.push({ bi, start: s0 });
    const last = instances[instances.length - 1];
    if (!last || last.start !== s0) instances.push({ bi, start: s0, startWeek: Math.max(0, s0), endWeek: k + 1 });
    else last.endWeek = k + 1;
  }
  return { blocks: all, repeat, offset, cycle, at, instances, preset, start };
}

// Average daily intake for a week from nutrition targets (cycling day types).
function nutritionIntake(ctx, wk, Wt, maint) {
  const both = clamp(wk.bothDays, 0, 7), liftOnly = clamp(wk.liftDays - both, 0, 7), cardioOnly = clamp(wk.cardioDays - both, 0, 7 - liftOnly - both);
  const rest = Math.max(0, 7 - both - liftOnly - cardioOnly);
  let total = 0;
  for (const [type, n] of [['both', both], ['lift', liftOnly], ['cardio', cardioOnly], ['rest', rest]]) {
    if (!n) continue;
    const t = dailyTargets(ctx.profile, { dayType: type, bodyweight: Wt, tdee: maint });
    if (!t || !fin(t.calories)) return null;
    total += t.calories * n;
  }
  return total / 7;
}

// ---------------------------------------------------------------- simulation
// opts: { fixedIntake? (constant intake: the lab; disables phases), proteinGPerLb?, fatPct?, energyShift (kcal/day the
//   true maintenance is below the estimate), leanMult (lean-rate multiplier), ceilShift (FFMI points vs the ceiling),
//   adhDecay (fraction of training lost asymptotically, τ = 78 weeks) }
function simulate(ctx, opts = {}) {
  const { W, W0, L0, F0, sex, goal, goalBf, months0, weekDrivers, bmrOf, exNetPerDay, calib, ffmiOf, today, PA0, gammaFatLb } = ctx;
  const labFixed = opts.fixedIntake != null;
  const fixedIntake = labFixed ? opts.fixedIntake : ctx.fixedIntake;
  const proteinBase = opts.proteinGPerLb ?? ctx.proteinGPerLb, fatBase = opts.fatPct ?? ctx.fatPct;
  const energyShift = opts.energyShift || 0, leanMult = opts.leanMult ?? 1, ceilShift = opts.ceilShift || 0, adhDecay = opts.adhDecay || 0;
  const lite = !!opts.lite;   // lab runs: only lean/fat/water per week (less garbage)
  const plan = !labFixed && ctx.phasePlan ? ctx.phasePlan : null;
  const userSet = plan || fixedIntake != null ? true : ctx.userSet;
  const profCache = new Map();
  const profFor = (p, f) => {
    if (p === ctx.proteinGPerLb && f === ctx.fatPct) return ctx.macroProfile;
    const key = p + '|' + f;
    if (!profCache.has(key)) profCache.set(key, { ...ctx.macroProfile, nutrition: { ...ctx.macroProfile.nutrition, proteinGPerLb: p, fatPct: f } });
    return profCache.get(key);
  };
  const essential = ESSENTIAL_BF[sex] / 100;
  const atDecay = Math.exp(-1 / AT_DECAY_WEEKS);
  let L = L0, F = F0, prevBal = (fixedIntake ?? ctx.goalIntake) - ctx.tdeeStart;
  let tAge = months0, AT = 0, EIref = null, Wref = W0, phaseIntake = null, inst = null;
  const G = Object.fromEntries(GROUP_ORDER.map(g => [g, 0]));   // cumulative lean gained per group
  const pts = [{ L, F, water: 0, G: { ...G }, ph: plan ? plan.at[0].bi : -1, Ceff: ctx.ffmiCeil + ceilShift }];
  const wkOut = [];
  const R = {}, gG = {};
  for (let k = 0; k < W; k++) {
    const wk = weekDrivers[k];
    const sAdh = adhDecay ? 1 - adhDecay * (1 - Math.exp(-k / ADH_DECAY_TAU)) : 1;
    const Wt = L + F;
    const mods = ctx.modsWeek(k, prevBal < 0);
    const eShift = energyShift ? energyShift * (ENERGY_ERR_RESID + (1 - ENERGY_ERR_RESID) * Math.exp(-k / ENERGY_ERR_TAU)) : 0;
    // Maintenance at today's body: Katch-McArdle on lean + fat tissue's own cost + daily movement scaled by weight
    // + exercise (scaled by weight) + calibration + stack − age drift. Equals the old BMR × (1 + NEAT) at week 0.
    const M = bmrOf(L) + gammaFatLb * (F - F0) + PA0 * (Wt / W0) + exNetPerDay(wk, Wt, L) * sAdh + calib.offset + mods.tdeeDelta - ctx.rmrAge[k];
    const bfNow = 100 * F / Wt;

    // ---- intake for this week
    let track = false, defended = false, inK = 0, wIn = k, dRef = EIref, protein = proteinBase, fat = fatBase, ph = -1;
    if (plan) {
      const a = plan.at[k], blk = plan.blocks[a.bi];
      ph = a.bi;
      if (inst !== a.start) {   // a new phase: re-estimate maintenance, set this phase's intake
        inst = a.start; EIref = M; Wref = Wt;
        phaseIntake = blk.calories ?? (blk.mode === 'fixed' ? Math.max(800, M + blk.surplus) : null);
      }
      dRef = EIref; wIn = k - a.start;
      protein = blk.proteinGPerLb ?? proteinBase; fat = blk.fatPct ?? fatBase;
      const deficitPhase = phaseIntake != null && phaseIntake < EIref - 1;
      if (blk.mode === 'track' || (blk.stopAtGoal && deficitPhase && bfNow <= goalBf)) track = true;
      else inK = phaseIntake;
    } else {
      if (k === 0) EIref = M;
      dRef = EIref;
      // A goal-driven diet (or a user-set deficit with stopAtGoal) moves to maintenance once at the goal body fat.
      const atGoal = bfNow <= goalBf && (userSet ? ctx.stopAtGoal && !labFixed && fixedIntake != null && fixedIntake < EIref : goal !== 'lean_bulk');
      if (atGoal) track = true;
      else if (fixedIntake != null) inK = fixedIntake;
      else if (ctx.intakeMode === 'nutrition') {
        inK = (nutritionIntake(ctx, wk, Wt, M - mods.tdeeDelta) ?? ctx.goalIntake) + (userSet ? 0 : mods.intakeDelta);
        dRef = M;   // targets are recalculated weekly, so the surplus is always vs current maintenance
      } else inK = ctx.goalIntake + mods.intakeDelta;
    }

    // Below the defended body fat a diet isn't sustained: intake rises to maintenance.
    if (!track && bfNow <= DEFENDED_BF[sex] && inK < M) { track = true; defended = true; }

    // ---- energy: the body pushes back on an imbalance
    let raw, adapt, bal;
    if (track) {
      // Eating at maintenance = weight-stable by definition (you adjust to the scale), so no estimate error accrues;
      // leftover adaptive thermogenesis fades and intake simply matches the burn.
      AT *= atDecay;
      inK = Math.max(800, M - AT);
      raw = inK - M;
      adapt = -AT;
      bal = 0;
    } else {
      inK = Math.max(800, inK);
      raw = inK - M + eShift;                                        // energy availability signal
      const dEI = inK - dRef + eShift;                               // intake change vs (true) maintenance when this phase began
      // Overfeeding: TEF on the imbalance + extra movement/metabolic rise of 42 % of the intake change (Levine 1999,
      // capped). It persists while overfed, as in Hall 2011's adaptive term, so weight converges instead of drifting.
      let N = dEI > 0 ? Math.min(SURPLUS_ADAPT_CAP, SURPLUS_ADAPT_FRAC * dEI) * Math.min(1, (wIn + 1) / SURPLUS_RAMP_WEEKS) : 0;
      N = Math.min(N, Math.max(0, (1 - TEF_FRAC) * raw));
      if (raw < 0) {
        // Adaptive thermogenesis in a deficit: 10 % of it (4-week ramp) + 10 kcal/day per lb lost this phase, capped,
        // and never more than the deficit itself.
        const target = Math.min(AT_CAP, AT_DEFICIT_FRAC * (-raw) * Math.min(1, (wIn + 1) / AT_RAMP_WEEKS) + AT_PER_LB_LOST * Math.max(0, Wref - Wt));
        AT = Math.min(target, -(1 - TEF_FRAC) * raw);
      } else AT *= atDecay;
      adapt = TEF_FRAC * raw + N - AT;
      bal = raw - adapt;                                             // kcal/day actually stored/lost
    }
    const out = M + adapt - eShift;

    // ---- lean model per muscle group
    let respW = 0;
    if (sAdh === 1) { const wr = ctx.weekResp[k]; respW = wr.respW; GROUP_ORDER.forEach((g, i) => { R[g] = wr.R[i]; }); }
    else for (const g of GROUP_ORDER) { R[g] = setResponse((wk.groups[g] || 0) * sAdh); respW += MUSCLE_SHARE[g] * R[g]; }
    // Training age advances with consistent training (a missed/empty week doesn't use up "newbie gains").
    const adv = (7 / DAYS_PER_MONTH) * Math.min(1, respW / TA_FULL_RESP);
    const months = tAge + adv / 2;
    tAge += adv;
    const pkcal = Wt * protein * 4, fkcal = inK * fat / 100;
    const cf = carbFactor(Math.max(0, (inK - pkcal - fkcal) / 4));
    const pf = proteinFactor(protein);
    const itf = interferenceFactor(wk.eqMin * sAdh);
    const itfUpper = 1 - (1 - itf) * 0.5;
    const Ceff = ctx.ffmiCeil + ceilShift + mods.ffmiShift;
    const ff = ceilingFactor(Ceff - ffmiOf(L));
    const bff = raw > 0 ? bfSurplusFactor(bfNow) : 1;
    // Rate basis scales with lean mass (not fat), equal to today's bodyweight at the start.
    const wholeRate = W0 * (L / L0) * leanRatePctPerMonth(months) / 100 * (7 / DAYS_PER_MONTH);
    const ageF = ctx.leanAgeFactor(k, mods);
    const common = pf * cf * ff * bff * mods.leanCeilingMult * leanMult * ageF;
    let fE = energyFactor(raw);
    if (raw < 0) {
      // Newer lifters and people with more fat to lose recomp better; veterans and very lean people worse.
      let rec = months < 12 ? 1.15 : months >= 36 ? 0.7 : 1;
      rec *= bfNow >= 20 ? 1.1 : bfNow < 12 ? 0.75 : 1;
      fE = Math.min(EF_MAINT, fE * rec);
    }
    let ceiling = 0, gainTrain = 0;
    for (const g of GROUP_ORDER) {
      const cap = Math.max(0, wholeRate * MUSCLE_SHARE[g] * R[g] * common * (LEG_GROUPS.has(g) ? itf : itfUpper));
      ceiling += cap;
      gG[g] = cap * fE;
      gainTrain += gG[g];
    }
    // Training-independent lean accrual (e.g. supraphysiologic testosterone), spread by muscle share; it also
    // slows near the (raised) ceiling.
    const leanDirect = mods.leanDirectLbPerWeek * leanMult * (mods.leanDirectLbPerWeek > 0 ? ff : 1);
    for (const g of GROUP_ORDER) gG[g] += leanDirect * MUSCLE_SHARE[g];
    let gain = gainTrain + leanDirect;
    // Lean loss in a deficit: Forbes partition, mostly prevented by lifting + protein.
    let loss = 0;
    if (bal < 0) {
      const massLoss = (-bal * 7) / KCAL_PER_LB_FAT;
      const pForbes = 10.4 / (10.4 + F / LB_PER_KG);
      // Keeping muscle needs far less volume than building it: protection saturates at ~70% of the stimulus.
      const protect = 0.9 * Math.min(1, respW / 0.7) * Math.min(1, bfNow / 10) * pf;
      loss = massLoss * pForbes * (1 - protect) * mods.leanRetentionMult;
    }
    // Energy: lean built costs ~1,250 kcal/lb, lean lost releases ~800; the rest of the balance is fat.
    let dF = (bal * 7 - gain * KCAL_PER_LB_LEAN + loss * KCAL_LEAN_RELEASED) / KCAL_PER_LB_FAT;
    // Stack partition shift: move part of a surplus's stored mass between fat and lean (energy-neutral).
    if (mods.partitionShift && bal > 0 && dF > 0 && gain > 0) {
      const E = bal * 7, Ms = gain + dF;
      const p2 = clamp(gain / Ms + mods.partitionShift, 0, 0.95);
      const M2 = E / (p2 * KCAL_PER_LB_LEAN + (1 - p2) * KCAL_PER_LB_FAT);
      const g2 = p2 * M2, f = gain > 0 ? g2 / gain : 1;
      for (const g of GROUP_ORDER) gG[g] *= f;
      gain = g2; dF = (1 - p2) * M2;
    }
    // Hard guard: never past the (effective) ceiling; energy that can't become muscle is stored as fat.
    const Lcap = ctx.leanAtFfmi(Ceff);
    if (gain > 0 && L + gain - loss > Lcap) {
      const g2 = Math.max(0, Lcap - L + loss), f = g2 / gain;
      for (const g of GROUP_ORDER) gG[g] *= f;
      dF += (gain - g2) * KCAL_PER_LB_LEAN / KCAL_PER_LB_FAT;
      gain = g2;
    }
    // Direct fat change from the stack (e.g. high testosterone): burned, not funding anything else.
    const fatDirect = mods.fatDirectLbPerWeek;
    dF += fatDirect;
    for (const g of GROUP_ORDER) G[g] += gG[g] - loss * MUSCLE_SHARE[g];
    L = L + gain - loss;
    F = F + dF;
    const minF = (L + F) * essential;
    if (F < minF) F = minF;
    const water = ctx.waterWeek(k, bal < 0) - ctx.water0;
    pts.push(lite ? { L, F, water } : { L, F, water, G: { ...G }, ph, track, Ceff, defended });
    prevBal = bal;
    wkOut.push({ kcalIn: inK, kcalOut: out, balance: bal, raw: raw - (track ? 0 : eShift), adapt, defended, gain, loss, ceiling, fatChange: dF,
      leanDirect, fatDirect, gainByGroup: lite ? null : { ...gG }, months, maint: M, track, ph,
      f: { vf: respW, pf, cf, itf, ff, bff, fE, stack: mods.leanCeilingMult, age: ageF },
      macros: k === 0 ? macrosFor(profFor(protein, fat), { calories: inK, bodyweight: Wt }) : null });
  }
  return { pts, wkOut };
}

// Averages of the lean-model factors over a run (what limited muscle gain).
function buildPartition(run) {
  const n = run.wkOut.length || 1;
  const avg = f => run.wkOut.reduce((a, w) => a + f(w), 0) / n;
  const ceiling = run.wkOut.reduce((a, w) => a + w.ceiling, 0);
  const gain = run.wkOut.reduce((a, w) => a + w.gain, 0);
  const loss = run.wkOut.reduce((a, w) => a + w.loss, 0);
  const fat = run.wkOut.reduce((a, w) => a + w.fatChange, 0);
  const tissue = gain - loss + fat;
  return {
    leanCeilingLb: r2(ceiling), leanGainLb: r2(gain), leanLossLb: r2(loss), ceilingUsedPct: ceiling > 0 ? Math.round(100 * gain / ceiling) : 0,
    leanShare: tissue > 0.2 ? r2(clamp((gain - loss) / tissue, -1, 1)) : null,
    volumeFactor: r2(avg(w => w.f.vf)), volumeResponse: r2(avg(w => w.f.vf)), proteinFactor: r2(avg(w => w.f.pf)), carbFactor: r2(avg(w => w.f.cf)),
    interferenceFactor: r2(avg(w => w.f.itf)), ffmiFactor: r2(avg(w => w.f.ff)), bodyFatFactor: r2(avg(w => w.f.bff)),
    energyFactor: r2(avg(w => w.f.fE)), stackFactor: r2(avg(w => w.f.stack)),
    adaptationKcal: Math.round(avg(w => w.adapt)), rawBalance: Math.round(avg(w => w.raw)), storedBalance: Math.round(avg(w => w.balance)),
  };
}

// ---------------------------------------------------------------- main
export function project(args = {}) {
  const ctx = prepare(args || {});
  if (ctx.empty) return ctx.result;
  const { b, profile, body, sex, today, W, adh, W0, bfAssumed, bf0, L0, F0, heightIn, months0, neatFactor, goal, nutritionOn, goalBf,
    weekDrivers, horizonGroups, smm0, ffmiOf, calib, tdeeStart, intakeSource, intakeMode, plannedCount, lastPlanned,
    histDays, hist, driverSource, useTemplateBeyond, age } = ctx;
  const missing = ctx.missing, missingInfo = ctx.missingInfo;
  const assumptions = [];

  // ---------------- confidence (also sets band widths)
  const confidence = confidenceFor({ b, sessions: ctx.all, today, calib });
  // Band ingredients: maintenance-estimate error (±10/8/6 % of TDEE by data quality, shrunk by food-log calibration),
  // lean-rate uncertainty (±50/40/30 %), the genetic ceiling (±1.5 FFMI) and adherence drifting down over the years.
  // Each is simulated on its own and combined as a root-sum-square of the deviations (independent errors), so the band
  // widens with the horizon without stacking every worst case at once.
  const tdeePct = (confidence === 'low' ? 0.10 : confidence === 'medium' ? 0.08 : 0.06) * (calib.applied ? 1 - 0.5 * calib.weight : 1);
  const sigmaE = Math.max(100, Math.round(tdeeStart * tdeePct));
  const lmSpread = confidence === 'low' ? 0.5 : confidence === 'medium' ? 0.4 : 0.3;
  const [lmLo, lmHi] = [1 - lmSpread, 1 + lmSpread];
  const likely = simulate(ctx);
  const scen = [simulate(ctx, { energyShift: sigmaE }), simulate(ctx, { energyShift: -sigmaE }),
    simulate(ctx, { leanMult: lmHi, ceilShift: FFMI_CEIL_SD }), simulate(ctx, { leanMult: lmLo, ceilShift: -FFMI_CEIL_SD, adhDecay: 0.2 })];

  // ---------------- measurements
  const m0 = b.measurements || {};
  const ref = REF_BODY[sex];
  const hEst = heightIn || ref.h;
  const scale = Math.sqrt((W0 / ref.w) / (hEst / ref.h));
  const shape0 = {}, shapeEstimated = [];
  for (const s of SITES) {
    if (pos(m0[s])) { shape0[s] = Number(m0[s]); continue; }
    let v = ref[s] * scale;
    if (s === 'waist') v += 0.3 * (bf0 - ref.bf);
    if (s === 'hips') v += 0.15 * (bf0 - ref.bf);
    shape0[s] = r1(v); shapeEstimated.push(s);
  }
  const fc = FAT_COEF[sex];
  // Relative gain of the muscles under a weighted set of groups (vs their starting mass).
  const relGain = (G, groups) => {
    let num = 0, den = 0;
    for (const [g, w] of Object.entries(groups)) { num += w * (G?.[g] || 0); den += w * MUSCLE_SHARE[g] * smm0; }
    return den > 0 ? num / den : 0;
  };
  const shapeAt = (L, F, G) => {
    const dF = F - F0, out = {};
    for (const s of SITES) {
      const sl = SITE_LEAN[s];
      const lean = sl.frac ? shape0[s] * 0.5 * sl.frac * relGain(G, sl.groups) : 0;
      out[s] = r1(Math.max(1, shape0[s] + fc[s] * dF + lean));
    }
    out.heightIn = hEst;
    return out;
  };
  const known = SITES.filter(s => pos(m0[s]));
  const limbs0 = m0.limbs && typeof m0.limbs === 'object' ? m0.limbs : {};
  const ffmi0 = ffmiOf(L0);
  // Score = normalized FFMI the whole body would have if every muscle grew like this region did.
  const ffmiRaw0 = (L0 / LB_PER_KG) / (ctx.hM * ctx.hM);
  const muscleAt = G => {
    const out = {};
    for (const [k, groups] of Object.entries(MUSCLE_GROUPS)) {
      const eff = ffmi0 + ffmiRaw0 * SMM_FRAC_OF_LEAN * relGain(G, groups);
      out[k] = r2(clamp((eff - FFMI_SCORE_LO) / (FFMI_SCORE_HI - FFMI_SCORE_LO), 0.02, 0.98));
    }
    return out;
  };

  // ---------------- series (weekly internally; downsampled for output)
  const start = parseDs(today);
  const blocks = ctx.phasePlan ? ctx.phasePlan.blocks : null;
  const leanHiCap = k => ctx.leanAtFfmi((likely.pts[k].Ceff ?? ctx.ffmiCeil) + FFMI_CEIL_SD);
  const rss = (k, pick) => {
    const v = pick(likely.pts[k]);
    let lo = 0, hi = 0;
    for (const sc of scen) { const d = pick(sc.pts[k]) - v; if (d < 0) lo += d * d; else hi += d * d; }
    return [v - Math.sqrt(lo), v + Math.sqrt(hi)];
  };
  const pointAt = k => {
    const p = likely.pts[k];
    const T = p.L + p.F, Wt = T + p.water;
    const shape = shapeAt(p.L, p.F, p.G);
    const measurements = {};
    for (const s of known) measurements[s] = shape[s];
    const [wLo, wHi] = rss(k, q => q.L + q.F + q.water);
    const [bLo, bHi] = rss(k, q => 100 * q.F / (q.L + q.F));
    const [lLo, lHi] = rss(k, q => q.L);
    const [fLo, fHi] = rss(k, q => q.F);
    // Plausibility: fat never below essential fat, lean never past the ceiling + its uncertainty.
    const ess = ESSENTIAL_BF[sex];
    const lHiC = Math.min(lHi, Math.max(p.L, leanHiCap(k)));
    const fLoC = Math.max(fLo, Math.min(p.F, (lLo + fLo) * ess / (100 - ess)));
    const low = { weightLb: r1(wLo), bodyFatPct: r1(Math.max(Math.min(100 * p.F / T, ess), bLo)), leanLb: r1(lLo), fatLb: r1(fLoC) };
    const high = { weightLb: r1(wHi), bodyFatPct: r1(bHi), leanLb: r1(lHiC), fatLb: r1(fHi) };
    if (known.includes('waist')) {
      const [wa, wb] = rss(k, q => shapeAt(q.L, q.F, q.G).waist);
      low.waist = r1(wa); high.waist = r1(wb);
    }
    const ratio = (a, c) => (pos(m0[a]) && pos(m0[c]) ? r2(shape[a] / shape[c]) : null);
    const limbs = {};
    for (const s of ['arm', 'thigh', 'calf']) for (const side of ['L', 'R']) {
      const v = pos(limbs0[s + side]);
      if (v != null) limbs[s + side] = r2(v + (shape[s] - shape0[s]));
    }
    const bodyFatPct = r1(100 * p.F / T);
    const pt = {
      week: k, date: ds(addDays(start, 7 * k)),
      weightLb: r1(Wt), bodyFatPct, leanLb: r1(p.L), fatLb: r1(p.F), waterLb: r1(p.water),
      measurements, shape, limbs, muscle: muscleAt(p.G), muscleLb: Object.fromEntries(GROUP_ORDER.map(g => [g, r2(p.G[g])])), ffmi: heightIn ? r1(ffmiOf(p.L)) : null,
      ratios: { shoulderToWaist: ratio('shoulders', 'waist'), chestToWaist: ratio('chest', 'waist'),
        waistToHeight: pos(m0.waist) && heightIn ? r2(shape.waist / heightIn) : null },
      low, high,
    };
    if (blocks) { const bi = p.ph >= 0 ? p.ph : likely.pts[Math.min(k + 1, W)].ph; pt.phase = { index: bi, goal: blocks[bi]?.goal, label: blocks[bi]?.label, atMaintenance: !!likely.pts[Math.min(k + 1, W)]?.track }; }
    return pt;
  };
  // Light weekly track for milestone dates (same rounding as the series).
  const weeklyLite = likely.pts.map((p, k) => {
    const T = p.L + p.F;
    const sh = shapeAt(p.L, p.F, p.G);
    return { week: k, date: ds(addDays(start, 7 * k)), bodyFatPct: r1(100 * p.F / T), leanLb: r1(p.L), ffmi: r1(ffmiOf(p.L)),
      ratios: { shoulderToWaist: pos(m0.shoulders) && pos(m0.waist) ? r2(sh.shoulders / sh.waist) : null } };
  });

  // ---------------- milestones
  const milestones = buildMilestones({ series: weeklyLite, W, goalBf, L0, body, sex, m0, heightIn, ffmiCeil: ctx.ffmiCeil });
  const phaseWeeks = ctx.phasePlan ? ctx.phasePlan.instances.flatMap(x => [x.startWeek, x.startWeek - 1]) : [];
  const keep = sampleWeeks(W, [...milestones.map(m => m.week).filter(k => k != null), ...phaseWeeks]);
  const series = keep.map(pointAt);
  const seriesFull = args.fullSeries ? likely.pts.map((_, k) => pointAt(k)) : undefined;

  // ---------------- weekly + summary
  const avg = f => likely.wkOut.reduce((a, w, i) => a + f(w, weekDrivers[i]), 0) / W;
  const setsByGroup = {};
  for (const g of GROUP_ORDER) if (horizonGroups[g]) setsByGroup[g] = r1(horizonGroups[g] / W);
  const weekly = {
    kcalIn: Math.round(avg(w => w.kcalIn)), kcalOut: Math.round(avg(w => w.kcalOut)), kcalBalance: Math.round(avg(w => w.balance)),
    liftSetsPerWeek: r1(avg((w, d) => d.sets)), groupSetsPerWeek: r1(avg((w, d) => d.groupSets)),
    cardioMinPerWeek: Math.round(avg((w, d) => d.cardioMin)), liftSessionsPerWeek: r1(avg((w, d) => d.liftDays * (d.source === 'plan' ? adh : 1))),
    setsByGroup,
    responseByGroup: Object.fromEntries(GROUP_ORDER.map(g => [g, r2(avg((w, d) => setResponse(d.groups[g] || 0)))])),
    perWeek: likely.wkOut.map((w, i) => ({ weekStart: ds(addDays(start, 7 * i)), kcalIn: Math.round(w.kcalIn), kcalOut: Math.round(w.kcalOut),
      balance: Math.round(w.balance), liftSets: r1(weekDrivers[i].sets), groupSets: r1(weekDrivers[i].groupSets),
      cardioMin: Math.round(weekDrivers[i].cardioMin), leanGain: r2(w.gain - w.loss), leanCeiling: r2(w.ceiling), fatChange: r2(w.fatChange),
      leanDirect: r2(w.leanDirect), fatDirect: r2(w.fatDirect),
      source: weekDrivers[i].source })),
  };
  const endPt = series[series.length - 1];
  const partition = buildPartition(likely);
  const summary = {
    weeks: W, endDate: endPt.date,
    weightLb: r1(endPt.weightLb - series[0].weightLb), fatLb: r1(endPt.fatLb - series[0].fatLb), leanLb: r1(endPt.leanLb - series[0].leanLb),
    bodyFatPct: r1(endPt.bodyFatPct - series[0].bodyFatPct),
    waist: shape0.waist != null ? r1(endPt.shape.waist - series[0].shape.waist) : null,
    waterLb: endPt.waterLb, leanCeilingLb: r1(partition.leanCeilingLb), ceilingUsedPct: partition.ceilingUsedPct, leanShare: partition.leanShare,
  };
  const w0 = likely.wkOut[0];
  const macros = w0 ? w0.macros : null;
  const intakeStart = w0 ? w0.kcalIn : tdeeStart;

  // ---------------- stack
  const stackContrib = new Map(), stackWarn = new Set();
  if (ctx.stackUsed) {
    for (let k = 0; k <= W; k += Math.max(1, Math.floor(W / 6))) {
      const m = ctx.modsAt(ds(addDays(start, 7 * k + 3)), (likely.wkOut[Math.min(k, W - 1)]?.balance ?? 0) < 0);
      for (const c of m.contributions) if (!stackContrib.has(c.id ?? c.name)) stackContrib.set(c.id ?? c.name, c);
      for (const w of m.warnings) stackWarn.add(w);
    }
  }
  let ageNote = null;
  if (ctx.stackUsed) {
    try {
      const mb = typeof MET.metabolicBaseline === 'function' ? MET.metabolicBaseline(profile, { age: ctx.age }) : null;
      const af = (mb?.factors || []).find(f => f && /age/i.test(String(f.id || f.label || '')));
      if (af && fin(Number(af.mult))) ageNote = `your age factor (${ctx.age ?? 'unknown'} y) from the metabolic profile is ×${r2(Number(af.mult))}${af.note ? ` (${af.note})` : ''}.`;
    } catch (e) { ageNote = null; }
  }
  const stack = { contributions: [...stackContrib.values()], warnings: [...stackWarn], used: ctx.stackUsed,
    direct: { lean: r2(likely.wkOut.reduce((a, w) => a + w.leanDirect, 0)), fat: r2(likely.wkOut.reduce((a, w) => a + w.fatDirect, 0)) }, ageNote };

  // ---------------- phases timeline + ceiling summary (for the UI)
  const phaseInfo = ctx.phasePlan ? ctx.phasePlan.instances.map(x => {
    const blk = ctx.phasePlan.blocks[x.bi];
    const wks = likely.wkOut.slice(x.startWeek, x.endWeek);
    const kcal = wks.length ? wks.reduce((a, w) => a + w.kcalIn, 0) / wks.length : null;
    const maintWeeks = wks.filter(w => w.track).length;
    return { index: x.bi, goal: blk.goal, label: blk.label, mode: blk.mode, startWeek: x.startWeek, endWeek: x.endWeek,
      start: ds(addDays(start, 7 * x.startWeek)), end: ds(addDays(start, 7 * x.endWeek)), surplus: blk.mode === 'track' ? 0 : blk.calories ? null : blk.surplus,
      calories: blk.calories, avgKcal: kcal != null ? Math.round(kcal) : null, maintenanceWeeks: maintWeeks, after: !!blk.after };
  }) : [];
  const endCeff = likely.pts[W].Ceff ?? ctx.ffmiCeil;
  const ceilInfo = { ffmiNatural: r1(ctx.ffmiCeil), ffmiEffective: r1(endCeff), tShift: r2(endCeff - ctx.ffmiCeil), sd: FFMI_CEIL_SD,
    leanAtCeilingLb: r1(ctx.leanAtFfmi(endCeff)), ffmiStart: r1(ctx.ffmiOf(L0)), ffmiEnd: r1(ctx.ffmiOf(likely.pts[W].L)),
    potentialUsedPct: Math.round(100 * clamp((likely.pts[W].L - L0) / Math.max(0.1, ctx.leanAtFfmi(endCeff) - L0), 0, 1)), heightAssumed: !heightIn };

  // ---------------- assumptions (plain English)
  const sb = b.bodyFatRange ? { value: bf0, source: b.bodyFatSource, method: b.bodyFatMethod ?? null, uncertainty: b.bodyFatUncertainty ?? null,
    spread: b.bodyFatSpread ?? null, range: b.bodyFatRange, note: b.bodyFatNote ?? null } : { value: bf0, source: bfAssumed ? null : b.bodyFatSource ?? null,
    method: null, uncertainty: bfAssumed ? 6 : null, spread: null, range: bfAssumed ? { low: bf0 - 6, high: bf0 + 6 } : null, note: null };
  const bfSrcText = bfAssumed ? `No body fat available, so a typical ${DEFAULT_BF[sex]}% was ASSUMED. Add height plus neck and waist (or a body-fat reading) to fix this; every number below depends on it.`
    : b.bodyFatSource === 'manual' ? `Starting body fat ${bf0}% is the value you entered.`
      : b.bodyFatSource === 'navy' ? `Starting body fat ${bf0}% comes from the US Navy tape formula (neck, waist, height), which is usually within ±3-4 points.`
        : b.bodyFatMethod === 'rfm' ? `Starting body fat ${bf0}% is estimated from your waist-to-height ratio (Relative Fat Mass formula), roughly ±4 points. A neck measurement adds the Navy formula.`
          : `Starting body fat ${bf0}% is a rough BMI-based estimate (Deurenberg formula). For a muscular or ex-endurance athlete it can be off by 5+ points; tape measurements will improve it.`;
  const spreadText = sb.spread != null && sb.spread > 3 ? ` Your different body-fat estimates disagree by ${sb.spread} points, so the true start could be anywhere in ${sb.range.low}-${sb.range.high}%.` : '';
  assumptions.push(`These are estimates, not predictions. People respond very differently (genetics, sleep, stress, how accurately food is tracked), so treat the shaded low-high band as the realistic range and re-check against real weigh-ins and tape measurements every 2-4 weeks.`);
  assumptions.push(`Start: ${r1(W0)} lb${b.weightDate ? ` (weigh-in ${b.weightDate})` : ' (profile weight)'}. ${bfSrcText}${spreadText} That makes ${r1(L0)} lb lean and ${r1(F0)} lb fat. Fat and lean are tracked separately every week; body fat % is simply fat ÷ (fat + lean).`);
  assumptions.push(`Calorie burn: BMR by Katch-McArdle (370 + 21.6 × lean kg) ≈ ${Math.round(ctx.bmrOf(L0))} kcal/day, × ${r2(1 + neatFactor)} for daily movement and digestion ("${body.activity || 'desk'}" activity), plus exercise ≈ ${Math.round(ctx.avgEx)} kcal/day (lifting ≈ 4-6 kcal/min, cardio and classes from MET values, resting burn subtracted so nothing is counted twice). Recomputed every week as your weight and lean mass change.`);
  assumptions.push(calib.applied ? `Maintenance is calibrated with your own data: ${calib.note}` : `Maintenance comes from the formula alone (≈ ${Math.round(tdeeStart)} kcal/day). Log food and weigh in for 10+ days and the app will calibrate it from your real weight trend (formulas are often off by 10-15%).`);
  const intakeText = intakeMode === 'calories' ? `You set intake to ${Math.round(ctx.fixedIntake)} kcal/day.`
    : intakeMode === 'surplus' ? `You set intake to maintenance ${sgn(ctx.specSurplus)}${Math.round(ctx.specSurplus)} kcal = ${Math.round(ctx.fixedIntake)} kcal/day, held constant.`
      : intakeMode === 'nutrition' ? `Intake follows your nutrition targets (${profile.nutrition.mode} mode, goal ${goal}), averaging about ${Math.round(intakeStart)} kcal/day in week 1 and recalculated as your weight changes.`
        : `Intake: nutrition tracking is off, so the ${goal} default is assumed: maintenance ${sgn(GOAL_OFFSET[goal])}${GOAL_OFFSET[goal]} kcal = about ${Math.round(ctx.goalIntake)} kcal/day, held constant (so the deficit shrinks as you get lighter, like eating the same amount in real life).`;
  if (phaseInfo.length) {
    const pp = ctx.phasePlan;
    const desc = pp.blocks.filter(x => !x.after).map(x => `${x.weeks} wk ${x.label.toLowerCase()}${x.mode === 'track' ? ' (at maintenance)' : x.calories ? ` at ${Math.round(x.calories)} kcal` : ` at ${sgn(x.surplus)}${Math.round(x.surplus)} kcal`}`).join(' → ');
    assumptions.push(`Nutrition phases: ${desc}${pp.repeat ? ', repeated' : ', then maintenance'}${pp.offset ? ` (you are ${pp.offset} weeks into the plan)` : ''}. Each phase re-estimates maintenance when it starts and eats that much above/below it, held steady for the phase (like eating the same amount every day). "Maintain" tracks maintenance week by week. Cuts stop at your ${goalBf}% goal and switch to maintenance. The nutrition lab still sweeps constant intakes.`);
  } else assumptions.push(`${intakeText}${!ctx.userSet && goal !== 'lean_bulk' ? ` Once you reach your ${goalBf}% goal, intake is assumed to rise to maintenance (you would stop dieting).` : ''}`);
  assumptions.push(`The body pushes back on any imbalance. Eating more: ~10% of the extra calories is burned digesting it and up to ~42% more by extra fidgeting, movement and metabolic rate (phased in over ${SURPLUS_RAMP_WEEKS} weeks, capped at ${SURPLUS_ADAPT_CAP} kcal/day). In Levine's 1999 overfeeding study about half of a +1,000 kcal/day surplus was burned off on average, but it ranged from almost none to most of it between people. Eating less: digestion burns less, plus adaptive thermogenesis of ~10% of the cut and ~10 kcal/day per lb lost (capped at ${AT_CAP} kcal/day); it fades over ~${AT_DECAY_WEEKS} weeks once you are back at maintenance (Martins 2020 found it largely disappears after weight stabilizes).`);
  assumptions.push(`Weight levels off at a fixed intake (Hall et al. 2011, Lancet): a heavier body burns more (fat tissue ≈ ${GAMMA_FAT_KG} kcal/kg/day, lean ≈ 22, and everyday movement costs more at a higher weight), so eating the same amount every day moves you toward a new steady weight, about half-way in the first year and nearly all the way within ~3 years, instead of gaining or losing forever. Rule of thumb from Hall: each 10 kcal/day changes steady-state weight by about 1 lb.${age != null ? ` Resting burn also drifts down ~1%/decade with age beyond what lean mass explains (low end of published estimates; Pontzer 2021 finds little change before 60).` : ''}`);
  const respTxt = weekly.groupSetsPerWeek > 0 ? GROUP_ORDER.map(g => `${GROUPS[g]?.name || g} ${weekly.setsByGroup[g] ?? 0} sets → ${Math.round(100 * weekly.responseByGroup[g])}%`).join(', ') : '';
  assumptions.push(`Muscle has a speed limit. The whole-body limit comes from training age (you start at ${r1(months0)} months): about ${LEAN_RATE_ANCHORS.filter(([m]) => [0, 12, 24, 36, 60].includes(m)).map(([m, r]) => `${r}%`).join(' → ')} of bodyweight/month at 0, 1, 2, 3 and 5 years of consistent training, still shrinking after that (the conservative end of the Aragon and McDonald guideline models, which are rules of thumb with ±30-50% individual spread). Training age only advances in weeks you actually train. It is split across muscle groups by their share of your muscle (legs and glutes ≈ 45%, back ≈ 17%, arms ≈ 14%, chest ≈ 8%, shoulders ≈ 7%, core ≈ 8%), so each group can only grow as fast as its own training allows.`);
  assumptions.push(`Sets per muscle drive growth: each group's weekly sets (indirect work counted fractionally, e.g. triceps get partial credit from pressing; Pelland 2024 found this fits the research best) go through a curve where 10 sets/week = 100%, the first few sets do the most, 20 sets ≈ 121%, 30 ≈ 130%, and it levels off around 135% (Schoenfeld, Ogborn & Krieger 2017; Pelland 2024; no drop-off at high volume is modelled). 0 sets = no training growth for that muscle. Your plan: ${respTxt || 'no lifting found'}.`);
  assumptions.push(`Each group's growth is then scaled by protein (${r2(ctx.proteinGPerLb)} g/lb${ctx.proteinAssumed ? ', ASSUMED because protein is not tracked' : ''}: ${Math.round(partition.proteinFactor * 100)}%), cardio interference (${Math.round(partition.interferenceFactor * 100)}% on legs, half that effect on the upper body), closeness to your natural limit (FFMI: ${Math.round(partition.ffmiFactor * 100)}%)${ctx.stackUsed && Math.abs(partition.stackFactor - 1) > 0.005 ? `, your supplement/therapy stack (${Math.round(partition.stackFactor * 100)}%)` : ''} and energy availability (below). Over ${W} weeks that ceiling is about ${r1(partition.leanCeilingLb)} lb of lean mass.`);
  assumptions.push(`How much of that ceiling you reach depends on food: about 70% at maintenance, ~93% at +250 kcal/day, ~98% at +500, and no more beyond that; a 300 kcal deficit gives ~45% and a 1,000 kcal deficit ~13% (newer lifters and people above 20% body fat recomp a bit better; very lean or veteran lifters worse). Leaner people put a bit more of a surplus into muscle (Forbes). This plan reaches ${partition.ceilingUsedPct}% of the ceiling. Calories beyond what muscle can use are stored as fat: that is why a huge surplus adds fat much faster than muscle (Iraki 2019; Garthe 2013 found the same in elite athletes).`);
  assumptions.push(`Energy bookkeeping: building 1 lb of lean tissue costs ~${KCAL_PER_LB_LEAN} kcal (what it stores plus the cost of making it); fat is ~${KCAL_PER_LB_FAT} kcal/lb. Whatever is left after muscle is fat gained (or, in a deficit, fat burned). Water and glycogen swings (often 2-4 lb day to day, and a few lb when carbs change a lot) are not modelled, so the line is your trend weight.`);
  assumptions.push(`Macros: protein matters up to ~1 g/lb (Morton 2018 meta-analysis: benefits plateau around 0.7 g/lb, upper estimate 1 g/lb), below ~0.7 g/lb muscle gain drops. At equal calories and protein the carb/fat split barely changes body composition; it is only modelled as a small training-quality penalty when carbs fall under ~100-150 g/day. Week 1 here: ${macros ? `${macros.protein} g protein, ${macros.carbs} g carbs, ${macros.fat} g fat (${macros.fatPct}% fat)` : 'n/a'}.`);
  assumptions.push(`In a deficit some lean mass can be lost (Forbes: more when leaner); lifting with enough protein prevents most (~90%) of that, and keeping muscle takes much less volume than building it. Cardio burns calories by machine, intensity and bodyweight; it only trims muscle gain modestly above ~150 effective min/week, about twice as much for running as for cycling (Wilson 2012 concurrent-training meta-analysis).${ctx.cdMin ? ` You added ${sgn(ctx.cdMin)}${Math.round(ctx.cdMin)} min/week of ${ctx.cdInt} ${CARDIO[ctx.cdMod]?.name || ctx.cdMod}.` : ''}`);
  const drvText = {
    plan: `Training comes from your planned sessions (${plannedCount} in range, through ${lastPlanned}).`,
    'plan+history': `Training comes from your planned sessions (${plannedCount} in range, through ${lastPlanned}) and your last ${histDays} days of logged workouts.`,
    history: `No planned sessions in range, so training repeats your last ${histDays} days of logged workouts.`,
    schedule: `No plan or recent logs, so training is estimated from your weekly schedule template (about 2.7 min per working set).`,
    'plan+schedule': `Training comes from your planned sessions, then your weekly schedule template.`,
    none: `No planned sessions, recent workouts or schedule were found, so no training effect is included (expect little or no muscle gain in this projection).`,
  }[driverSource] || '';
  assumptions.push(`${drvText} Planned sessions count at ${Math.round(adh * 100)}% (adherence)${useTemplateBeyond && lastPlanned ? `, and weeks after ${lastPlanned} repeat the average planned/recent week` : useTemplateBeyond ? '' : ', and nothing is assumed after the last planned day'}. Average: ${r1(weekly.liftSetsPerWeek)} lift sets and ${weekly.cardioMinPerWeek} cardio min per week.`);
  assumptions.push(`Tape measurements are rough: waist ≈ ${fc.waist} in per lb of fat (≈0.6-1.0 in per 5-8 lb; men gain and lose belly fat first, limbs least), hips ${fc.hips}, chest ${fc.chest}, thighs ${fc.thigh}, arms ${fc.arm}. Muscle adds size only where it grows: each tape site follows the muscles under it (arms = biceps + triceps, shoulders = delts + upper back, thighs = quads + hamstrings…), so more triceps sets show up on the arm tape. Left and right limbs are averaged for the model.`);
  if (shapeEstimated.length) assumptions.push(`Silhouette: ${shapeEstimated.join(', ')} ${shapeEstimated.length === 1 ? 'was' : 'were'} not measured, so ${shapeEstimated.length === 1 ? 'it is' : 'they are'} drawn from a typical ${sex} build scaled to your ${heightIn ? 'height and ' : ''}weight. Measure them to make the picture yours.`);
  if (!heightIn) assumptions.push('Height is missing, so BMI, FFMI and the Navy body-fat estimate are unavailable and the silhouette uses an average height.');
  if (ctx.stackUsed && (stack.contributions.length || stack.warnings.length)) {
    const parts = stack.contributions.map(c => {
      const t = String(c.text || c.name || c.id || '');
      const flagged = c.assumedAverage || c.assumed || (Array.isArray(c.flags) && c.flags.some(f => /assumed/i.test(String(f))));
      return t.length > 3 ? t + (flagged && !/assumed average/i.test(t) ? ' (assumed average)' : '') : '';
    }).filter(Boolean);
    assumptions.push(`Supplements, therapies and metabolic values: ${parts.length ? parts.join(' ') : 'included.'}${stack.warnings.length ? ` Warnings: ${stack.warnings.join(' ')}` : ''}${series.some(p => Math.abs(p.waterLb) >= 0.1) ? ' Water weight from the stack is added to the scale weight only, never counted as muscle or fat.' : ''}`);
    if (stack.direct.lean || stack.direct.fat || Math.abs(partition.stackFactor - 1) > 0.005) {
      assumptions.push(`How the stack combines with training: it can raise the training-driven ceiling (×${r2(partition.stackFactor)} on average) and add lean mass that does not need training (${r2(stack.direct.lean)} lb total here), as in Bhasin 1996 (10 weeks: exercise alone +1.9 kg fat-free mass, testosterone alone +3.2 kg, both +6.1 kg). Those effects are treated as roughly additive. No study has varied testosterone level and set volume at the same time, so additivity is an assumption. Bhasin's subjects were 19-35; ${stack.ageNote || 'age effects come from your metabolic profile.'} Lean built this way still costs ~${KCAL_PER_LB_LEAN} kcal/lb, so at a fixed intake it comes out of fat.`);
    }
  } else if (!ctx.stackUsed) assumptions.push('Supplements, therapies and metabolic values are switched off for this projection (neutral defaults), for comparison.');
  assumptions.push(`Genetic ceiling: muscle gain slows as you approach a natural limit of about FFMI ${r1(ctx.ffmiCeil)} (fat-free mass index normalized to 1.8 m; Kouri et al. 1995 found drug-free athletes rarely exceed ~25, and individual limits vary by about ±1.5). Gains start easing ~4 points below it and stop at it. You start at FFMI ${r1(ctx.ffmiOf(L0))}${heightIn ? '' : ' (height missing, so an average height is assumed)'}, so the ceiling is about ${r1(ctx.leanAtFfmi(ctx.ffmiCeil))} lb of lean mass.${ceilInfo.tShift > 0.05 ? ` Your testosterone level raises the reachable ceiling by about ${r1(ceilInfo.tShift)} FFMI (Kouri's steroid users averaged ~3 points above non-users; Forge maps 1,000 → 2,400 ng/dL to +0 → +2.0 and does not extrapolate; this mapping is an estimate, not a measured dose-response).` : ''}`);
  if (age != null) assumptions.push(`Age: you are ${Math.round(age)} now and ${r1(age + W / 52.18)} at the end; age is recomputed every week. Muscle-building potential eases ~0.4%/yr past 35 (gentle; older lifters still gain well, Peterson 2011)${ctx.stackUsed ? ', and testosterone follows your metabolic profile (an assumed average declines ~1%/yr with age; a lab value is aged ~1%/yr past 40 per the Massachusetts Male Aging Study, which only matters if it falls into the low range)' : ''}.`);
  if (ctx.realism) assumptions.push(`Long-term realism is on: weeks after the planned days fade toward ${Math.round((1 - ctx.realism) * 100)}% of the planned training over ~1.5 years (missed weeks, travel, life).`);
  assumptions.push(`Band: low/high combine, as independent errors, ±${sigmaE} kcal/day of maintenance-estimate error${calib.applied ? ' (narrowed by your food-log calibration)' : ''}, ${Math.round(lmLo * 100)}-${Math.round(lmHi * 100)}% of the expected muscle response, a genetic ceiling ±${FFMI_CEIL_SD} FFMI, and (low side) training adherence slipping ~20% over the years. It widens with the horizon and is wider when there is less real data (confidence: ${confidence}). Re-measuring narrows it: the projection re-anchors to your real numbers.`);

  const outMissing = [...missing], outMissingInfo = [...missingInfo];
  if (!plannedCount && !hist.length && !outMissing.includes('sessions')) {
    outMissing.push('sessions');
    outMissingInfo.push({ field: 'sessions', label: 'Planned or logged workouts', why: 'Muscle gain and calorie burn in the projection come from your planned and recent workouts.' });
  }

  return {
    series, ...(seriesFull ? { seriesFull } : {}), milestones, assumptions, weekly, confidence, summary,
    phases: phaseInfo, ceiling: ceilInfo,
    horizon: { weeks: W, years: r2(W / 52.18), label: horizonLabel(W), sampled: series.length < W + 1 },
    energy: { intakeSource, intakeMode, intakeStart: Math.round(intakeStart), tdeeStart: Math.round(tdeeStart), tdeeFormula: Math.round(ctx.tdeeFormula),
      surplusStart: Math.round(intakeStart - tdeeStart), goal, proteinGPerLb: r2(ctx.proteinGPerLb), proteinAssumed: ctx.proteinAssumed, fatPct: ctx.fatPct,
      cardioDeltaMin: ctx.cdMin, cardioModality: ctx.cdMod, cardioIntensity: ctx.cdInt },
    macros, partition, tdeeCalibration: calib, startBodyFat: sb, stack,
    driverSource, bodyFatAssumed: bfAssumed, shapeEstimated, missing: outMissing, missingInfo: outMissingInfo,
  };
}

// `series` here is the full weekly track (week, date, bodyFatPct, leanLb, ffmi, ratios). Each milestone carries `week`.
function buildMilestones({ series, W, goalBf, L0, body, sex, m0, heightIn = null, ffmiCeil = FFMI_NATURAL_CEILING }) {
  const milestones = [];
  const endPt = series[series.length - 1];
  const span = W >= 78 ? `${r1(W / 52)} years` : `${W} weeks`;
  const when = hit => `Projected around ${hit.date} (${hit.week >= 78 ? `year ${r1(hit.week / 52)}` : `week ${hit.week}`}).`;
  const add = (m, hit) => milestones.push({ ...m, date: hit ? hit.date : null, week: hit ? hit.week : null, reached: !!hit });
  const bfMilestone = (id, label, thr, note) => {
    const already = series[0].bodyFatPct <= thr;
    const hit = series.find(p => p.bodyFatPct <= thr);
    add({ id, label, target: thr, value: endPt.bodyFatPct, already,
      note: already ? `Already at or below ~${thr}% body fat (estimated ${series[0].bodyFatPct}%). ${note}`
        : hit ? `${when(hit)} ${note}`
          : `Not reached within ${span} at this pace (projected ${endPt.bodyFatPct}% at the end). ${note}` }, hit);
  };
  const absNote = 'Where abs show depends on where you store fat; most men see them somewhere between 10 and 14%.';
  bfMilestone('abs_upper', 'Upper abs visible (~12% BF)', 12, absNote);
  bfMilestone('six_pack', 'Full six-pack (~10% BF)', 10, absNote);
  {
    const already = series[0].bodyFatPct <= goalBf;
    const hit = series.find(p => p.bodyFatPct <= goalBf);
    const atGoal = endPt.leanLb / (1 - goalBf / 100);
    add({ id: 'goal_bf', label: `Goal body fat (${goalBf}%)`, target: goalBf, value: endPt.bodyFatPct, already,
      note: `With your projected lean mass (${r1(endPt.leanLb)} lb), ${goalBf}% body fat is about ${r1(atGoal)} lb on the scale.` +
        (hit ? '' : ` Not reached within ${span} at this pace.`) }, hit);
  }
  if (pos(m0.shoulders) && pos(m0.waist)) {
    for (const [id, thr, label] of [['sw_1_5', 1.5, 'Shoulder:waist 1.5 (clear V-taper)'], ['sw_1618', 1.618, 'Shoulder:waist 1.618 (the "golden" Adonis ratio)']]) {
      const already = series[0].ratios.shoulderToWaist >= thr;
      const hit = series.find(p => p.ratios.shoulderToWaist >= thr);
      add({ id, label, target: thr, value: endPt.ratios.shoulderToWaist, already,
        note: already ? `Already there (${series[0].ratios.shoulderToWaist}).` : hit ? `${when(hit)} Rough: it comes from a smaller waist and wider shoulders together.`
          : `Not within ${span} (projected ${endPt.ratios.shoulderToWaist} at the end). Rough estimate from tape measures.` }, hit);
    }
  }
  const leanSteps = W >= 52 ? [5, 10, 15, 20] : [5, 10];
  for (const gainLb of leanSteps) {
    const thr = L0 + gainLb;
    const hit = series.find(p => p.leanLb >= r1(thr));
    add({ id: `lean_${gainLb}`, label: `Lean mass +${gainLb} lb`, target: r1(thr), value: endPt.leanLb, already: false,
      note: hit ? `${when(hit)} Lean mass includes muscle plus its water; the scale will not show it cleanly.`
        : `Not within ${span} (projected ${endPt.leanLb - L0 >= 0 ? '+' : ''}${r1(endPt.leanLb - L0)} lb lean at the end).` }, hit);
  }
  if (heightIn) {
    const near = r1(ffmiCeil - 1);
    for (const [id, thr, label, note] of [
      ['ffmi_22', 22, 'FFMI 22 (clearly muscular)', 'FFMI = lean kg ÷ height² (normalized to 1.8 m). Untrained men average ~18-19.'],
      ['ffmi_23', 23, 'FFMI 23 (very muscular, still natural)', 'Above ~23 takes years of consistent training and good genetics.'],
      ['near_ceiling', near, `Within 1 FFMI of your natural ceiling (~${r1(ffmiCeil)})`, `Kouri 1995: drug-free athletes rarely exceed ~25; individual ceilings vary by ±1.5. Gains slow a lot in this zone.`]]) {
      if (id !== 'near_ceiling' && thr >= ffmiCeil) continue;
      const already = series[0].ffmi >= thr;
      const hit = series.find(p => p.ffmi >= thr);
      add({ id, label, target: thr, value: endPt.ffmi, already,
        note: already ? `Already there (FFMI ${series[0].ffmi}). ${note}` : hit ? `${when(hit)} ${note}` : `Not within ${span} (projected FFMI ${endPt.ffmi} at the end). ${note}` }, hit);
    }
  }
  const raceW = pos(body.raceWeightLb) ?? (sex === 'male' ? 137 : null);
  const raceBf = pos(body.raceBodyFat) ?? 6.5;
  if (raceW) {
    const raceLean = r1(raceW * (1 - raceBf / 100));
    const already = series[0].leanLb >= raceLean + 1;
    const hit = series.find(p => p.leanLb >= raceLean + 1);
    add({ id: 'lean_vs_race', label: `More lean mass than race weight (${raceW} lb at ~${raceBf}% = ${raceLean} lb lean)`,
      target: r1(raceLean + 1), value: endPt.leanLb, already,
      note: already ? `Already about ${r1(series[0].leanLb - raceLean)} lb more lean mass than at marathon race weight. At the same ${raceBf}% you would weigh about ${r1(series[0].leanLb / (1 - raceBf / 100))} lb.`
        : `Marathon-era lean mass is a useful benchmark: beating it by 1+ lb means the lifting has added real muscle.` }, hit);
  }
  return milestones;
}

// Confidence from the amount and recency of real data.
function confidenceFor({ b, sessions, today, calib }) {
  let score = 0;
  const from30 = ds(addDays(parseDs(today), -30)), from60 = ds(addDays(parseDs(today), -60)), from28 = ds(addDays(parseDs(today), -28));
  const weighIns = fin(b?.weighIns30) ? b.weighIns30 : (b?.weightDate && b.weightDate >= from30 ? 1 : 0);
  score += weighIns >= 8 ? 2 : weighIns >= 1 ? 1 : 0;
  if (b?.bodyFatSource === 'manual' || b?.bodyFatSource === 'navy') score += (b.bodyFatDate && b.bodyFatDate >= from60) ? 2 : 1;
  if (b?.heightIn) score += 1;
  const mo = b?.measuredOn || {};
  const recentSites = Object.values(mo).filter(d => d >= from60).length;
  score += recentSites >= 4 ? 1 : 0;
  const logged = sessions.filter(s => s.status === 'done' && s.date >= from28 && s.date <= today).length;
  score += logged >= 8 ? 2 : logged >= 3 ? 1 : 0;
  if (calib?.applied) score += calib.confidence === 'high' ? 3 : calib.confidence === 'medium' ? 2 : 1;
  return score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';
}

// ---------------------------------------------------------------- nutrition lab
// Sweep daily calories (vs maintenance) and show where extra food stops building muscle.
export function nutritionLab({ baseline, profile, sessions, weeks = 12, now = new Date(), calorieRange = [-750, 1000], step = 125,
  proteinGPerLb, fatPct, cardioDeltaMin = 0, cardioModality = 'bike', cardioIntensity = 'easy', adherence = 0.85, repeatPlan = true,
  bodyLog = null, foodLog = null, adaptive = undefined, useStack = true, modifiersFn = null } = {}) {
  const intake = {};
  if (pos(proteinGPerLb)) intake.proteinGPerLb = Number(proteinGPerLb);
  if (pos(fatPct)) intake.fatPct = Number(fatPct);
  const ctx = prepare({ baseline, profile, sessions, weeks, now, intake, adherence, repeatPlan, cardioDeltaMin, cardioModality, cardioIntensity, bodyLog, foodLog, adaptive, useStack, modifiersFn });
  const empty = { points: [], sweetSpot: { from: null, to: null, note: 'Log a bodyweight first: the lab needs a starting point.' },
    explanation: ['No bodyweight logged yet, so the nutrition lab cannot run. Log a morning weigh-in to start.'],
    maintenance: null, proteinGPerLb: null, fatPct: null, cardioDeltaMin: 0, leanCeilingLb: null, proteinCurve: [], macros: null };
  if (ctx.empty) return empty;

  let lo = numOr(Array.isArray(calorieRange) ? calorieRange[0] : null, -750), hi = numOr(Array.isArray(calorieRange) ? calorieRange[1] : null, 1000);
  if (lo > hi) [lo, hi] = [hi, lo];
  lo = clamp(lo, -2000, 2500); hi = clamp(hi, -2000, 2500);
  let st = clamp(numOr(step, 125), 25, 1000);
  while ((hi - lo) / st > 60) st *= 2;
  const levels = [];
  for (let s = lo; s <= hi + 1e-9; s += st) levels.push(Math.round(s));
  if (!levels.length) levels.push(0);

  const runCache = new Map();
  const runAt = (surplus, extra = {}) => {
    const key = surplus + '|' + (extra.proteinGPerLb ?? '');
    if (runCache.has(key)) return runCache.get(key);
    const v = runAtRaw(surplus, extra);
    runCache.set(key, v);
    return v;
  };
  const runAtRaw = (surplus, extra = {}) => {
    const fixedIntake = Math.max(800, ctx.tdeeStart + surplus);
    const r = simulate(ctx, { fixedIntake, lite: true, ...extra });
    const p0 = r.pts[0], pN = r.pts[r.pts.length - 1];
    const T = pN.L + pN.F;
    return { surplus, calories: Math.round(fixedIntake), run: r,
      leanLb: r2(pN.L - p0.L), fatLb: r2(pN.F - p0.F), weightLb: r2(T + pN.water - (p0.L + p0.F)),
      bodyFatPct: r1(100 * pN.F / T), bodyFatChange: r1(100 * pN.F / T - 100 * p0.F / (p0.L + p0.F)),
      endWeightLb: r1(T + pN.water), endLeanLb: r1(pN.L), endFatLb: r1(pN.F) };
  };
  const rows = levels.map(s => runAt(s));
  const points = rows.map((p, i) => {
    const tissue = p.leanLb + p.fatLb;
    const prev = rows[i - 1];
    const dF = prev ? p.fatLb - prev.fatLb : null, dL = prev ? p.leanLb - prev.leanLb : null;
    return { surplus: p.surplus, calories: p.calories, leanLb: r1(p.leanLb), fatLb: r1(p.fatLb), weightLb: r1(p.weightLb), bodyFatPct: p.bodyFatPct,
      bodyFatChange: p.bodyFatChange, endWeightLb: p.endWeightLb, endLeanLb: p.endLeanLb, endFatLb: p.endFatLb,
      leanShare: tissue > 0.2 ? r2(clamp(p.leanLb / tissue, -1, 1)) : null,
      marginalLeanPerFat: prev && dF > 0.05 ? r2(dL / dF) : null };
  });

  // Sweet spot: from = where lean gain reaches 90% of the best in the sweep (below it, more food
  // still buys real muscle); to = 97% (see below). Both measured on the sweep's lean range.
  const maxLean = Math.max(...rows.map(p => p.leanLb));
  const minLean = Math.min(...rows.map(p => p.leanLb));
  const thr = minLean + 0.9 * (maxLean - minLean);
  const interpX = (i, key, target) => {
    const a = rows[i - 1], c = rows[i];
    const den = c[key] - a[key];
    return den !== 0 ? a.surplus + (c.surplus - a.surplus) * clamp((target - a[key]) / den, 0, 1) : c.surplus;
  };
  let from = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].leanLb >= thr - 1e-9) { from = i === 0 ? rows[0].surplus : interpX(i, 'leanLb', thr); break; }
  }
  // to = where lean gain reaches 97% of the best: past it, more food adds under ~3% more muscle.
  const thr97 = minLean + 0.97 * (maxLean - minLean);
  let to = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].leanLb >= thr97 - 1e-9) { to = i === 0 ? rows[0].surplus : interpX(i, 'leanLb', thr97); break; }
  }
  if (to == null) to = rows[rows.length - 1].surplus;
  if (from == null) from = rows[0].surplus;
  const r25 = x => Math.round(x / 25) * 25;
  from = r25(Math.max(from, lo)); to = r25(Math.min(Math.max(to, from), hi));
  if (from > to) [from, to] = [to, from];
  const mid = r25((from + to) / 2);
  const midRow = runAt(mid);
  const at = s => rows.reduce((best, p) => (Math.abs(p.surplus - s) < Math.abs(best.surplus - s) ? p : best), rows[0]);
  const maint = Math.round(ctx.tdeeStart);
  const range = (a, c, unit = '') => (a === c ? `${a}${unit}` : `${a}-${c}${unit}`);
  const sRange = from === to ? `maintenance ${sgn(from)}${from}` : `maintenance ${sgn(from)}${from} to ${sgn(to)}${to}`;
  const lFrom = r1(runAt(from).leanLb), lTo = from === to ? lFrom : r1(runAt(to).leanLb);
  const sweetSpot = { from, to, note: `Eat about ${range(maint + from, maint + to)} kcal/day (${sRange}). ${from === to ? 'Here' : 'In this range'} you get ~${range(Math.min(lFrom, lTo), Math.max(lFrom, lTo), ' lb')} of lean mass over ${horizonLabel(ctx.W)}; past it, nearly all the extra food becomes fat.` };

  // Protein curve at the middle of the sweet spot.
  const proteinCurve = [0.5, 0.6, 0.7, 0.8, 1.0, 1.2].map(g => {
    const r = runAt(mid, { proteinGPerLb: g });
    return { gPerLb: g, leanLb: r1(r.leanLb), fatLb: r1(r.fatLb) };
  });

  // Explanation (plain English, numbers from this sweep).
  const z = at(0), big = at(hi), sp = midRow;
  const s500 = at(Math.min(500, hi));
  const p05 = proteinCurve[0], p10 = proteinCurve.find(p => p.gPerLb === 1.0);
  const part = buildPartition(midRow.run);
  const explanation = [];
  explanation.push(`Muscle growth has a speed limit set by your training, not your plate. With ${r1(ctx.months0)} months of lifting and your planned volume, the most lean mass you can expect in ${horizonLabel(ctx.W)} is about ${r1(part.leanCeilingLb)} lb. Food decides how much of that limit you reach, and everything beyond it is stored as fat.`);
  if (ctx.W >= 52) explanation.push(`Over ${horizonLabel(ctx.W)} a constant intake converges: maintenance rises as you gain (and falls as you lose), so weight levels off at a new steady state instead of changing forever (Hall 2011). A fixed +300 today ends up close to maintenance once you are heavier, so the long-run outcome of a surplus is not just the 1-year result multiplied. Each point here is today's maintenance plus that amount, eaten every day for the whole horizon; Forge's nutrition phases are the more realistic way to plan years.`);
  explanation.push(`At maintenance (~${maint} kcal/day) you would gain ~${r1(z.leanLb)} lb of lean and ${z.fatLb <= 0 ? 'lose' : 'gain'} ~${r1(Math.abs(z.fatLb))} lb of fat (a slow recomp). In the sweet spot (${from === to ? `${sgn(from)}${from}` : `${sgn(from)}${from} to ${sgn(to)}${to}`} kcal/day) you would gain ~${r1(sp.leanLb)} lb of lean and ~${r1(sp.fatLb)} lb of fat.`);
  if (hi >= 750 && s500.surplus < big.surplus) explanation.push(`Going from ${sgn(s500.surplus)}${s500.surplus} to ${sgn(big.surplus)}${big.surplus} kcal/day adds only ${r1(Math.max(0, big.leanLb - s500.leanLb))} lb more lean but ${r1(big.fatLb - s500.fatLb)} lb more fat. "Eat a lot" builds muscle only up to the speed limit; after that it is mostly fat you will later have to diet off.`);
  explanation.push(`The body burns off part of any surplus (digestion, fidgeting, more movement): roughly half of a big one on average in Levine's 1999 overfeeding study, with huge differences between people. So the scale moves less than the calories suggest, but most of what is stored past the sweet spot is fat. A practical target is gaining about 0.25-0.5% of bodyweight a week (${r1(ctx.W0 * 0.0025)}-${r1(ctx.W0 * 0.005)} lb), in line with Iraki 2019's off-season bodybuilding review.`);
  if (p05 && p10) explanation.push(`Protein is the one macro that clearly matters: at 0.5 g/lb you would gain ~${p05.leanLb} lb of lean vs ~${p10.leanLb} lb at 1.0 g/lb (same calories). Benefits level off around 0.7-1.0 g/lb (Morton 2018), so ~1 g/lb (${Math.round(ctx.W0)} g/day for you) is plenty; more is safe but adds nothing.`);
  explanation.push(`Carbs vs fat barely matters for body composition when calories and protein are equal. Carbs fuel hard training, so keep them at 150 g+ on lifting days; keep fat at 20%+ of calories for hormones. With Adderall blunting appetite, calorie-dense foods and shakes make a surplus far easier than eating more volume.`);
  explanation.push(`Cardio: it burns calories, so at the same intake more cardio means less fat. It only trims muscle gain modestly once you pass ~150 min/week, and running costs more than cycling (Wilson 2012). If you add cardio but want the same muscle gain, eat back roughly what it burns.${ctx.cdMin ? ` This sweep includes ${sgn(ctx.cdMin)}${Math.round(ctx.cdMin)} min/week of extra ${ctx.cdInt} ${CARDIO[ctx.cdMod]?.name || ctx.cdMod}.` : ''}`);
  if (ctx.calib.applied) explanation.push(`Maintenance here is calibrated from your food log and weight trend (${ctx.calib.note})`);
  else explanation.push(`Maintenance (~${maint} kcal/day) is a formula estimate that can be off by 10-15%. Log food and weigh in daily for 2+ weeks and the lab will calibrate it to your real burn.`);
  if (ctx.stackUsed) {
    const m = ctx.modsAt(ctx.today, false);
    if (m.warnings.length) explanation.push(`Stack warnings: ${m.warnings.join(' ')}`);
  }

  return { points, sweetSpot, explanation, maintenance: maint, proteinGPerLb: r2(ctx.proteinGPerLb), fatPct: ctx.fatPct, cardioDeltaMin: ctx.cdMin,
    leanCeilingLb: r1(part.leanCeilingLb), proteinCurve, macros: midRow.run.wkOut[0]?.macros ?? null };
}
