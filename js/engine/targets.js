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
import { CARDIO, cardioOptions, estimateCalories } from '../data/cardio.js';
import { DEFAULT_LOCATIONS, expandEquipment } from '../data/equipment.js';
import { sessionVolume } from './recovery.js';
import { GROUPS, GROUP_ORDER, REGIONS, VOLUME_UNITS, UNIT_ORDER, MAX_WHY, COUNTED_UNITS, TARGETED_REGIONS, isCountedUnit } from '../data/muscles.js';
import { SCULPT_GOALS } from '../data/sculpt.js';
import { ds, parseDs, addDays, weekStart } from '../util.js';
import { STYLE_LIMITS, normalizeCustomStyle, styleOptions, isStyleId, resolveStyle } from './generator.js';
// Re-exported as a live binding, not a copy: recovery.js now imports this module, so targets.js can be
// pulled in while generator.js is still evaluating (generator → recovery → targets → generator) and a
// spread of generator's const here would hit its TDZ. Function imports are hoisted, so they are safe.
export { BUILTIN_STYLES as STYLES } from './generator.js';
import { sexOf, BODY } from './sex.js';
import { lossRateDeficit, KCAL_PER_LB_TREND } from './nutrition.js';
// CONTRACT-NOTE (§20 Female mode): goals.goalBodyFatPct defaults to 22 for women (15 DXA-equivalent for men, §20b) and is clamped to the
//   female limits [14, 35] (men keep LIMITS.goalBodyFatPct [5, 30]); goalBodyFatLimits(profile) exposes them for UI steppers.
//   Weekly set targets are NOT sex-specific: no study supports different targets for women (Roberts 2020: same relative
//   hypertrophy; Nuzzo 2024: little sex influence on reps at a given %1RM; women are, if anything, less fatigable, Hunter 2014).
// CONTRACT-NOTE (§23 Weight-loss goal, 2026-10-20): GOALS gains 'weight_loss' ("Lose weight: fat first, lean mass allowed
//   to follow"), distinct from 'cut' ("get lean, keep muscle"). New profile fields, all optional and all read/written here:
//     profile.body.goalWeightLb        number|null   scale-weight target the projection aims at
//     profile.body.goalWeightDate      'YYYY-MM-DD'|null   optional target date (sets the rate instead of lossRate)
//     profile.body.lossRatePctPerWeek  number|null   % of bodyweight per week (default 0.7); drives the deficit
//     profile.body.leanProtection      'protect'|'balanced'|'minimal'   preset: protein + training floors
//     profile.volumePolicy.floors      'evidence'|'maintenance'|'minimum'   weekly-set floors, below-floor ONLY under weight_loss
//   resolveTargets().goals gains goalWeightLb, goalWeightDate, lossRatePctPerWeek, leanProtection, losing and `plan`
//   (lossPlan: rate, lb/week, kcal deficit, tier, warnings). resolveTargets().minimums gains `floor`
//   ({ mode, factor, name, why, allowed, belowFloor }). Extra exports: GOAL_INFO, GOAL_ORDER, LOSS_RATES,
//   DEFAULT_LOSS_RATE, LEAN_PROTECTION, LEAN_PROTECTION_INFO, VOLUME_FLOORS, FLOOR_INFO, MAINTENANCE_FRACTION,
//   FLOOR_FACTOR, TARGET_FACTOR, FLOOR_EVIDENCE, LOSS_GOALS, KCAL_PER_LB, goalOf, isLossGoal, priorityLimits,
//   priorityLimitsFor, volumeFloorOf, leanProtectionOf, lossPlan, goalWeightLimits.
//   Existing goals are never rewritten and their resolved numbers are unchanged.

export const LIMITS = {
  cardioMin: [0, 900], cardioStep: 15, hardPerWeek: [0, 4], defaultMinutes: [10, 180],
  calories: [1200, 6000], surplus: [-1500, 1500], proteinGPerLb: [0.6, 1.4], fatPct: [15, 40],
  adherence: [0.5, 1], goalBodyFatPct: [5, 30], priority: [0.5, 2],
  // §23: under the weight-loss goal a muscle group may be driven to zero ("detrain"), so the slider
  // floor drops from 0.5× to 0×. Every other goal keeps LIMITS.priority.
  priorityLoss: [0, 2],
  goalWeightLb: [70, 600], lossRatePctPerWeek: [0.1, 2],
};
export const CARDIO_CHIPS = [90, 150, 225, 300];
// §23. 'cut' = get lean, KEEP muscle. 'weight_loss' = get smaller: fat first, lean mass allowed to follow.
export const GOALS = ['recomp', 'lean_bulk', 'cut', 'weight_loss'];
export const GOAL_INFO = {
  recomp: { name: 'Recomp', blurb: 'Lose fat, build muscle', direction: 'recomp' },
  lean_bulk: { name: 'Lean bulk', blurb: 'Small surplus, max growth', direction: 'gain' },
  cut: { name: 'Cut', blurb: 'Get lean, keep muscle', direction: 'lose',
    long: 'A cut takes fat off while defending as much muscle as a deficit allows: a moderate deficit, high protein and full lifting volume. Scale weight comes down slowly because you are protecting lean mass. Forge still models what the deficit costs — going fast or dropping protein takes lean mass off under a cut exactly as it would under any other goal.' },
  weight_loss: { name: 'Lose weight', blurb: 'Fat first, lean mass allowed to follow', direction: 'lose',
    long: 'For when the number on the scale is the goal: a weight class, a race weight, or simply being smaller. Fat still goes first (your body burns fat before muscle) and Forge projects the lean mass you lose at your chosen rate — the same way it does for every goal. What this goal adds is the choice: aim at a goal WEIGHT and a rate, and deliberately train and eat for minimum body mass instead of maximum muscle retention.' },
};
export const GOAL_ORDER = ['recomp', 'lean_bulk', 'cut', 'weight_loss'];
export const LOSS_GOALS = ['cut', 'weight_loss'];
export function goalOf(profile) { return GOALS.includes(profile?.goal) ? profile.goal : DEF.goal; }
export function isLossGoal(profile) { return goalOf(profile) === 'weight_loss'; }

// ---- §23 rate of loss -------------------------------------------------------------------------
// Garthe et al. 2011 (Int J Sport Nutr Exerc Metab 21:97, doi:10.1123/ijsnem.21.2.97) randomised 24 elite athletes,
// all lifting 4×/week, to a 0.7 %/week or a 1.4 %/week weight-loss target. The slow group achieved 0.7 ± 0.8 %/week and
// LOST 31 ± 3 % of its fat while GAINING 2.1 ± 0.4 % lean mass; the fast group actually achieved 1.0 ± 0.4 %/week, lost
// only 21 ± 4 % of its fat and went −0.2 ± 0.7 % on lean mass, for the same ≈5.5 % drop in body mass. The follow-up
// (doi:10.1123/ijsnem.21.5.426) adds upper-body strength +12 ± 2 % (slow) vs +6 ± 2 % (fast) — and that by 12 months
// neither group's advantage, or weight loss, had held.
export const DEFAULT_LOSS_RATE = 0.7;
export const LOSS_RATES = [
  { id: 'gentle', pctPerWeek: 0.35, label: 'Gentle', tier: 'gentle', note: 'Slower than any of the studies. Lean mass is as safe as it gets; it just takes twice as long.' },
  { id: 'slow', pctPerWeek: 0.5, label: 'Slow', tier: 'slow', note: 'Inside the range that preserved (or added) lean mass in trained athletes.' },
  { id: 'steady', pctPerWeek: 0.7, label: 'Steady', tier: 'steady', note: 'Garthe 2011\'s slow arm: fat down 31 %, lean mass UP 2 % in lifting athletes. The best-evidenced rate.' },
  { id: 'fast', pctPerWeek: 1, label: 'Fast', tier: 'fast', note: 'What Garthe\'s "fast" group actually achieved: same weight off, but a third less of it from fat and no lean gain.' },
  { id: 'aggressive', pctPerWeek: 1.4, label: 'Aggressive', tier: 'aggressive', note: 'Beyond anything tested in trained athletes. Expect real lean loss, worse training and a hard rebound.' },
];
export const KCAL_PER_LB = KCAL_PER_LB_TREND;   // first approximation, shared with nutrition.lossRateDeficit
// Share of the week's weight loss Forge calls "fast". Tiers drive the warning text, not the model.
const rateTier = r => (r <= 0.4 ? 'gentle' : r <= 0.6 ? 'slow' : r <= 0.85 ? 'steady' : r <= 1.15 ? 'fast' : 'aggressive');

// ---- §23 lean protection ----------------------------------------------------------------------
// A PRESET, not a fudge factor: it writes protein and the weekly-set floors, and the projection then
// predicts the consequences from those real inputs. Nothing in the model reads leanProtection directly.
export const LEAN_PROTECTION = ['protect', 'balanced', 'minimal'];
export const LEAN_PROTECTION_INFO = {
  protect: { name: 'Protect muscle', proteinGPerLb: 1.1, floors: 'evidence',
    why: 'Full lifting volume and ~1.1 g/lb protein. In a 40 % deficit that was the difference between +1.2 kg and +0.1 kg of lean mass over 4 weeks (Longland 2016).' },
  balanced: { name: 'Balanced', proteinGPerLb: 0.85, floors: 'maintenance',
    why: 'Maintenance lifting (about a third of the growth volume) and ~0.85 g/lb protein. Enough to hold most muscle in young adults (Bickel 2011) with less time in the gym.' },
  minimal: { name: 'Minimum body mass', proteinGPerLb: 0.6, floors: 'minimum',
    why: 'You accept losing muscle: protein drops to ~0.6 g/lb and set floors go to zero. Expect more of every pound to come off as lean mass, strength to fade, and bone density to fall ~2 % over a year of diet-only loss (Villareal 2006).' },
};

// ---- §23 weekly-set floors --------------------------------------------------------------------
// Bickel, Cross & Bamman 2011 (Med Sci Sports Exerc 43:1177, doi:10.1249/MSS.0b013e318207c15d): after 16 weeks of
// training 3×/week, a ONE-THIRD dose for 32 weeks preserved myofibre hypertrophy in 20–35-year-olds (and added more),
// and even a one-ninth dose preserved it; in 60–75-year-olds neither dose did. Spiering et al. 2021 (J Strength Cond
// Res 35:1449, doi:10.1519/JSC.0000000000003964): strength and size held for up to 32 weeks on 1 session/week and 1 set
// per exercise, PROVIDED the relative load stays high. So 'maintenance' = 1/3 of the growth floor; 'minimum' = 0, which
// is a deliberate choice to detrain (Bosquet 2013, doi:10.1111/sms.12047: training cessation costs SMD −0.46 maximal
// force, −0.62 submaximal strength, worse the longer it lasts).
export const VOLUME_FLOORS = ['evidence', 'maintenance', 'minimum'];
export const MAINTENANCE_FRACTION = 1 / 3;
// FLOOR_FACTOR scales the hard minimum the planner must hold; TARGET_FACTOR scales the base target the
// sliders then multiply. 'minimum' keeps the maintenance-sized target but removes the floor, so a slider
// at 0 really does drop a muscle group to no planned sets.
export const FLOOR_FACTOR = { evidence: 1, maintenance: MAINTENANCE_FRACTION, minimum: 0 };
export const TARGET_FACTOR = { evidence: 1, maintenance: MAINTENANCE_FRACTION, minimum: MAINTENANCE_FRACTION };
export const FLOOR_INFO = {
  evidence: { name: 'Growth floors', short: 'Grow', why: 'The normal evidence floors: enough weekly sets per muscle to keep building.' },
  maintenance: { name: 'Maintenance', short: 'Maintain', why: 'Every target and floor drops to about a third of the growth volume. That dose preserved muscle size for 32 weeks in 20-35 year olds (Bickel 2011) and is deliberately below what builds it: expect to hold what you have, not to grow. Raise a single muscle\'s slider to put it back.' },
  minimum: { name: 'Minimum / detrain', short: 'Detrain', why: 'Maintenance-sized targets with NO floor, so any muscle whose slider you drag to 0 gets no planned sets at all. You will lose size there, and strength will follow more slowly (Bosquet 2013; strength is readily held for about 4 weeks of nothing, Mujika & Padilla 2001). Choose this only if a smaller body matters more to you than the muscle.' },
};
export const FLOOR_EVIDENCE = [
  { claim: 'Keeping muscle takes about a third of the volume that built it: after 16 weeks of training, a one-third dose held myofibre size for 32 weeks in 20-35 year olds (and even a one-ninth dose held it). In 60-75 year olds neither dose was enough.', source: 'Bickel, Cross & Bamman 2011, Med Sci Sports Exerc 43:1177, doi:10.1249/MSS.0b013e318207c15d' },
  { claim: 'Strength and muscle size held for up to 32 weeks on as little as 1 session a week and 1 set per exercise, as long as the load stayed heavy. Intensity is what you cannot cut.', source: 'Spiering et al. 2021, J Strength Cond Res 35:1449, doi:10.1519/JSC.0000000000003964' },
  { claim: 'Stopping altogether costs strength: pooled across 103 studies, training cessation moved submaximal strength −0.62 SD, maximal force −0.46 SD and maximal power −0.20 SD, and the longer the layoff the worse it got. Short layoffs are cheap: strength is readily held for about 4 weeks.', source: 'Bosquet et al. 2013, Scand J Med Sci Sports 23:e140, doi:10.1111/sms.12047; Mujika & Padilla 2001, Med Sci Sports Exerc 33:1297, doi:10.1097/00005768-200108000-00009' },
  { claim: 'Lifting while dieting is what keeps the weight you lose from being muscle: 81 % of diet-only groups lost 15 % or more of their weight as fat-free mass, against 39 % of diet-plus-exercise groups.', source: 'Weinheimer, Sands & Campbell 2010, Nutr Rev 68:375, doi:10.1111/j.1753-4887.2010.00298.x' },
  { claim: 'A deficit bigger than about 500 kcal/day stopped lifters gaining lean mass altogether, although strength gains largely survived.', source: 'Murphy & Koehler 2022, Scand J Med Sci Sports 32:125, doi:10.1111/sms.14075' },
];
export const MODES = ['off', 'simple', 'cycling'];
export const VOLUME_MODES = ['extend', 'ask', 'fixed'];
export const FILL_MODES = ['extend', 'time', 'ask'];
// Cardio distribution (profile.cardio.style): few long sessions, a mix, or short finishers on lift days.
export const CARDIO_STYLES = ['longer', 'balanced', 'finishers'];
export const CARDIO_STYLE_NAMES = { longer: 'Long sessions', balanced: 'Balanced', finishers: 'Short finishers' };
export const MIN_SESSION_DEFAULT = { longer: 30, balanced: 20, finishers: 10 };
export const CARDIO_STYLE_WHY = 'Separate or longer cardio sessions reduce interference with lifting (Wilson et al. 2012) and suit an endurance base.';
export const MINIMUMS_EVIDENCE = [
  { claim: 'About 4 fractional sets a week is the minimum effective dose; growth rises steeply to about 10 and keeps rising with shrinking returns past that. A priority muscle\u2019s floor of ~10 is the bottom of the effective range, not the smallest dose that does anything: ~6 normal, 3-4 maintenance, 0 where other lifts already cover it.', source: 'ACSM position stand 2026 (Currier et al., Med Sci Sports Exerc 58:851, doi:10.1249/MSS.0000000000003897): \u226510 sets/wk; Pelland et al. 2025, Sports Med 56:481, doi:10.1007/s40279-025-02344-w (minimum effective dose 4); Schoenfeld, Ogborn & Krieger 2017, J Sports Sci 35:1073 (+0.37%/set; the 10+ vs <5 comparison was a trend, P=0.074)' },
  { claim: 'Trained lifters do best around 12-20 sets per muscle per week, and the dose-response flattens around 18-20. Every target here sits in or below that range.', source: 'Baz-Valle et al. 2022, J Hum Kinet 81:199, doi:10.2478/hukin-2022-0017 (12-20; note it counted every set as 1, so in the fractional sets Forge uses its range means 12-20 DIRECT sets); ACSM position stand 2026 (~18-20 weekly sets)' },
  { claim: 'The weekly max is a ceiling on what a muscle can use, not a priority setting: 20 for most muscles, 24 for triceps and side delts, 22 for back (lats + upper back), 10 for lower back (fatigue guard). Biceps: 18 sets/week grew them as much as 27. The 20 is the best-evidenced number here; 24 and 22 are practitioner allowances, not measured ceilings.', source: 'Heaselgrave et al. 2019, Int J Sports Physiol Perform 14:360, doi:10.1123/ijspp.2018-0427 (9/18/27 sets: +4.3/+9.5/+5.4%, n.s., 6 weeks); Baz-Valle et al. 2022; Pelland et al. 2025 (lower-efficiency tier starts ~19 fractional sets, with no measured plateau)' },
  { claim: 'Only hard working sets count, taken to failure or within about 3 reps of it; warm-ups are not hard sets, so they never count. Indirect sets count half: presses give triceps 0.5 a set, rows and pulldowns give biceps 0.5, and each set counts once per muscle.', source: 'Baz-Valle, Fontes-Villalba & Santos-Concejero 2021, J Strength Cond Res 35:870, doi:10.1519/JSC.0000000000002776 (counting hard sets to or near failure); Pelland et al. 2025, Sports Med (direct 1.0 / synergist 0.5); ACSM 2026 and Robinson et al. 2024, Sports Med 54:2209, doi:10.1007/s40279-024-02069-2 (near-failure, 2-3 reps in reserve, is enough); Mannarino et al. 2021 (a row is worth about half a curl for biceps; n=10, untrained)' },
  { claim: 'Keeping muscle takes about a third of the volume that built it, so your legs (maintenance) have low floors on purpose.', source: 'Bickel, Cross & Bamman 2011, Med Sci Sports Exerc; Spiering et al. 2021, J Strength Cond Res' },
  { claim: 'Sessions cap at 10 sets for a big muscle and 8 for a small one and spread the rest. This is a fatigue, time and set-quality rule, not a measured hypertrophy ceiling: no peer-reviewed study has found a per-session limit, and spreading the same weekly volume mainly buys better reps per set. Training a muscle 2x/week beats 1x unless weekly volume is equal; small muscles can go on back-to-back days at moderate volume.', source: 'Remmert, Pelland et al. 2025, SportRxiv 537 (still a preprint, ~11 sets/session); Calzavara & Barroso 2026, J Strength Cond Res, doi:10.1519/JSC.0000000000005665 (9 quad sets in one session vs three: no difference in growth, 58-76% more volume load when spread); Schoenfeld et al. 2016, Sports Med 46:1689 (2x > 1x when volume is equated); Schoenfeld, Grgic & Krieger 2019, J Sports Sci 37:1286 (no frequency effect once volume is matched)' },
  { claim: 'Side and rear delts are enforced separately: pressing works the front delts, not the width-building side delts. Back counts lats and upper back only (traps and lower back are tracked but don\'t count). The side-delt floor of 10 is the one dose directly tested in trained lifters; the 24 max above it is convention.', source: 'Larsen et al. 2025, Front Physiol 16:1611468, doi:10.3389/fphys.2025.1611468 (10 weekly sets of lateral raises grew the lateral delt 3.3-4.6% in 8 weeks); Pelland et al. 2025 (its dose-response tables contain no lateral- or rear-deltoid row at all); weekly-volume audit (docs/research/weekly-volume-audit.md)' },
];
const DEF_VOLUME = { mode: 'extend', maxMinutes: 90 };
// goalBodyFatPct: 15 % DXA-equivalent ≈ the colloquial "12 %" (§20b); a saved goal is never changed.
const DEF = { cardioMin: 120, hardPerWeek: 1, adherence: 0.85, defaultMinutes: 45, style: 'hypertrophy', proteinGPerLb: 1.0, fatPct: 25, goalBodyFatPct: BODY.male.goalBodyFat, goal: 'recomp' };
export function goalBodyFatLimits(profile) { return sexOf(profile) === 'female' ? BODY.female.goalBfLimits : LIMITS.goalBodyFatPct; }
const goalBfDefault = profile => (sexOf(profile) === 'female' ? BODY.female.goalBodyFat : DEF.goalBodyFatPct);
export function goalWeightLimits() { return LIMITS.goalWeightLb; }
// §23: only the weight-loss goal unlocks sliders below 0.5× (down to 0 = detrain this muscle).
export function priorityLimits(profile) { return isLossGoal(profile) ? LIMITS.priorityLoss : LIMITS.priority; }
export function priorityLimitsFor(goal) { return goal === 'weight_loss' ? LIMITS.priorityLoss : LIMITS.priority; }
// §23: the resolved weekly-set floor mode. A saved below-floor choice is kept in the profile but only takes
// effect under the weight-loss goal, so switching back to recomp/cut/lean_bulk restores the evidence floors.
export function volumeFloorOf(profile) {
  const v = profile?.volumePolicy?.floors;
  return isLossGoal(profile) && VOLUME_FLOORS.includes(v) ? v : 'evidence';
}
export function leanProtectionOf(profile) {
  const v = profile?.body?.leanProtection;
  return LEAN_PROTECTION.includes(v) ? v : 'protect';
}

// §23. One place that turns "lose weight to X by Y" into a rate and a calorie deficit, so Nutrition,
// Projection, Plan and Body all quote the same numbers. weightLb = current scale weight.
//   → { goalWeightLb, goalWeightDate, pctPerWeek, lbPerWeek, deficitKcal, toLoseLb, weeks, endDate,
//       tier, source:'date'|'rate'|'default', warnings:[string] }
export function lossPlan(profile, { weightLb = null, now = new Date() } = {}) {
  const body = profile?.body && typeof profile.body === 'object' ? profile.body : {};
  const W = fin(weightLb) && num(weightLb) > 0 ? num(weightLb) : fin(profile?.bodyweight) && num(profile.bodyweight) > 0 ? num(profile.bodyweight) : null;
  const goalW = fin(body.goalWeightLb) && num(body.goalWeightLb) > 0 ? clamp(num(body.goalWeightLb), LIMITS.goalWeightLb) : null;
  const date = isDs(body.goalWeightDate) ? body.goalWeightDate : null;
  const today = ds(toDate(now));
  let pct = fin(body.lossRatePctPerWeek) && num(body.lossRatePctPerWeek) > 0 ? clamp(num(body.lossRatePctPerWeek), LIMITS.lossRatePctPerWeek) : null;
  let source = pct != null ? 'rate' : 'default';
  const toLose = goalW != null && W != null ? Math.max(0, W - goalW) : null;
  // A target date wins: it pins the rate the user actually asked for (and we tell them the cost).
  if (date && date > today && toLose != null && toLose > 0 && W) {
    const wks = Math.max(1, Math.round((parseDs(date) - parseDs(today)) / 6048e5));
    pct = clamp((toLose / wks) / W * 100, LIMITS.lossRatePctPerWeek);
    source = 'date';
  }
  if (pct == null) pct = DEFAULT_LOSS_RATE;
  const lbPerWeek = W != null ? Math.round(W * pct / 100 * 100) / 100 : null;
  const deficitKcal = lossRateDeficit(W, pct);
  const weeks = toLose != null && lbPerWeek > 0 ? Math.ceil(toLose / lbPerWeek) : null;
  const tier = rateTier(pct);
  const warnings = [];
  if (tier === 'fast') warnings.push(`${Math.round(pct * 100) / 100} % of bodyweight a week is faster than the rate that protected lean mass in trained athletes (0.7 %/week). Garthe 2011's faster group lost the same weight but a third less of it was fat, and they gained no lean mass.`);
  if (tier === 'aggressive') warnings.push(`${Math.round(pct * 100) / 100} % of bodyweight a week is beyond anything tested in trained athletes. Expect real lean-mass loss, worse training quality, and a hard rebound: in Garthe's 12-month follow-up both rate groups were back at their starting weight.`);
  if (deficitKcal != null && deficitKcal > 500) warnings.push(`A ${deficitKcal} kcal/day deficit is past the ~500 kcal/day point where lifters stopped gaining lean mass at all (Murphy & Koehler 2022). Strength holds up better than size.`);
  // §23: cardio is the other half of a deficit. Minutes/week of easy Zone-2 work that would cover the whole
  // gap, so the user can move more instead of eating less (and so the Plan screen can say how much).
  let cardioMinPerWeek = null;
  if (deficitKcal != null && W != null) {
    const perMin = estimateCalories('bike', 60, 'easy', W) / 60;
    if (perMin > 0) cardioMinPerWeek = Math.round(deficitKcal * 7 / perMin / 5) * 5;
  }
  return { goalWeightLb: goalW, goalWeightDate: date, pctPerWeek: Math.round(pct * 100) / 100, lbPerWeek, deficitKcal, cardioMinPerWeek,
    toLoseLb: toLose != null ? Math.round(toLose * 10) / 10 : null, weeks,
    endDate: weeks != null ? ds(addDays(toDate(now), 7 * weeks)) : null, tier, source, warnings };
}
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
// "Close enough" for a weekly cardio target, shared by every screen and by the planner so Plan's
// capacity banner, the Make-room proposal and weekPlanSummary's shortfall warning never disagree
// about whether the target fits (§18: one source of truth).
export function cardioTolerance(target) { return Math.max(10, (Number(target) || 0) * 0.1); }
// Concrete availability changes that let the week hold `target` cardio minutes, least disruptive
// first: lengthen cardio days (≤60′ weekdays, ≤90′ weekends), flex → cardio, easy cardio on a rest
// day (sized to what is still missing, same day caps), then +1 step on lift days (bigger finishers,
// 'finishers' style only). After any accepted change it restarts at the gentlest step and it runs
// to a FIXED POINT: whatever this proposal can ever deliver, one "Apply" delivers, and re-running it
// on the proposed schedule finds nothing more (so the Plan banner can stop offering the button).
// → { target, before, after, enough, short, changes:[{ day, from, to, gain, label }], schedule }
// (schedule = the full new availability; unchanged days kept).
export function makeRoomProposal(profile, target = cardioPrefs(profile).minPerWeek) {
  const sch = normSchedule(profile?.schedule);
  const capOf = sc => cardioCapacity(profile, sc).cardio;
  const before = capOf(sch);
  const tol = cardioTolerance(target);
  const changes = [];
  const cur = JSON.parse(JSON.stringify(sch));
  const orig = JSON.parse(JSON.stringify(sch));
  let cap = before;
  const done = () => target - cap <= tol;
  const tryMove = (day, slot) => {
    const next = { ...cur, [day]: slot };
    const c = capOf(next);
    if (c <= cap) return false;
    changes.push({ day, from: orig[day], to: slot, gain: c - cap, label: '' });
    cur[day] = slot; cap = c; return true;
  };
  const weekend = d => d === 'sat' || d === 'sun';
  const dayCap = d => (weekend(d) ? 90 : 60);
  const cp = cardioPrefs(profile);
  const easyMin = cp.style === 'finishers' ? 20 : Math.max(20, cp.minSession);
  // 1. lengthen a cardio day by one chip
  const extendCardio = () => {
    for (const d of DAYS) {
      if (done()) return false;
      const x = cur[d]; if (x.kind !== 'cardio') continue;
      const n = nextChip(x.minutes); if (!n || n > dayCap(d)) continue;
      if (tryMove(d, { ...x, minutes: n })) return true;
    }
    return false;
  };
  // 2. a flex day becomes a cardio day (it gives up a possible lift or class)
  const flexToCardio = () => {
    for (const d of DAYS) {
      if (done()) return false;
      const x = cur[d]; if (x.kind !== 'flex' || x.minutes < 20) continue;
      if (tryMove(d, { ...x, kind: 'cardio' })) return true;
    }
    return false;
  };
  // 3. a rest day becomes easy cardio, sized to what is still missing (never past the day cap, so a
  //    small gap still gets a short active-recovery session and only a big one gets a long day)
  const restToCardio = () => {
    for (const d of [...DAYS].reverse()) {
      if (done()) return false;
      if (cur[d].kind !== 'rest') continue;
      const m = Math.min(dayCap(d), Math.max(easyMin, round5(target - cap)));
      if (tryMove(d, { kind: 'cardio', minutes: CHIPS.find(c => c >= m) || m, location: cur[d].location || 'home' })) return true;
    }
    return false;
  };
  // 4. 'longer'/'balanced': no finisher-only fixes. 'finishers': a longer lift day carries a longer one.
  const liftFinishers = () => {
    if (cp.style !== 'finishers') return false;
    for (const d of DAYS) {
      if (done()) return false;
      const x = cur[d]; if (x.kind !== 'lift') continue;
      const n = nextChip(x.minutes); if (!n || n > 75) continue;
      if (tryMove(d, { ...x, minutes: n })) return true;
    }
    return false;
  };
  const steps = [extendCardio, flexToCardio, restToCardio, liftFinishers];
  // Capacity rises strictly on every accepted move and is bounded, so this terminates; the guard is
  // only belt-and-braces. Restarting at `steps[0]` after each move keeps least-disruptive-first.
  for (let i = 0; i < 200 && !done(); i++) if (!steps.some(step => step())) break;
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
    // §23: the saved weekly-set floor mode. Kept here so an unrelated volumePolicy edit can't wipe it;
    // whether it is honoured is volumeFloorOf()'s job (weight-loss goal only).
    ...(VOLUME_FLOORS.includes(v.floors) ? { floors: v.floors } : {}),
    ...(v.fillTargetsSetAt ? { fillTargetsSetAt: v.fillTargetsSetAt } : {}) };
}
// Resolved weekly set numbers per muscle GROUP: the sum over the group's COUNTED units of
// unitTargets(). ONE derivation (CONTRACT §18): a group's sets and its target always add up the same
// muscles, so Body's group card, Today's muscle tiles, recovery.groupStatus and Plan's group coverage
// cannot drift. Tracked-only units (front delts, traps, lower back) and sub-units (upper chest) are
// excluded from the sums and listed separately. → { [group]: { min, target, max, units, sub, tracked, starred } }
const groupCache = new WeakMap();
export function groupTargets(profile) {
  const key = profile && typeof profile === 'object' ? profile : groupCache;
  const floor = volumeFloorOf(profile);
  const sig = JSON.stringify([profile?.groupPriority, profile?.sculptGoals, floor, priorityLimits(profile)[0]]);
  const hit = groupCache.get(key);
  if (hit && hit.sig === sig) return hit.v;
  const U = unitTargets(profile);
  const stars = starredUnits(profile);
  const r1 = x => Math.round(x * 10) / 10;
  const v = {};
  for (const g of GROUP_ORDER) {
    if (!GROUPS[g]) continue;
    const counted = COUNTED_UNITS[g] || [];
    const sum = k => r1(counted.reduce((a, u) => a + (U[u]?.[k] || 0), 0));
    v[g] = { min: sum('min'), target: sum('target'), max: sum('max'), units: [...counted],
      sub: UNIT_ORDER.filter(u => VOLUME_UNITS[u].group === g && VOLUME_UNITS[u].sub),
      tracked: UNIT_ORDER.filter(u => VOLUME_UNITS[u].group === g && VOLUME_UNITS[u].tier === 'tracked'),
      starred: counted.some(u => stars.has(u)) };
  }
  groupCache.set(key, { sig, v });
  return v;
}
// Legacy name kept for callers that only want { min, max } per group. Same numbers as groupTargets.
export function weeklyMinimums(profile) {
  return Object.fromEntries(Object.entries(groupTargets(profile)).map(([g, x]) => [g, { min: x.min, target: x.target, max: x.max }]));
}
// The §23 floor factors, resolved once, so recovery.js scales region/group numbers exactly as
// unitTargets scales the enforced ones (they used to diverge: Today showed the full target while
// Plan showed a third of it).
export function volumeFactors(profile) {
  const floor = volumeFloorOf(profile);
  return { floor, floorFactor: FLOOR_FACTOR[floor], targetFactor: TARGET_FACTOR[floor], allowZero: priorityLimits(profile)[0] === 0 };
}
// ONE set-count formatter for every screen (Bob: "one screen rounding 14.5 to 15 and another to 14
// looks like a bug"). Fractional credit means halves are real, so a half shows and a whole does not.
export function fmtSets(x) {
  const v = Math.round((Number(x) || 0) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
// A sculpt goal's extraWeeklySets split over its regions. The split is normalised over the regions
// that actually feed a unit WITH A TARGET, so the whole amount the user asked for lands somewhere:
// before this, "Traps / Yoke" lost 1.43 of its 2 sets to the tracked traps unit (target 0, clamped
// away) and "Capped Delts"/"Upper Chest" lost their front-delt share the same way.
// → { [regionId]: extraSets }
export function sculptExtraByRegion(profile) {
  const out = {};
  for (const id of Array.isArray(profile?.sculptGoals) ? profile.sculptGoals : []) {
    const g = SCULPT_GOALS[id]; if (!g || !(g.extraWeeklySets > 0)) continue;
    const all = Object.entries(g.regions || {}).filter(([r, w]) => REGIONS[r] && w > 0);
    const es = all.filter(([r]) => TARGETED_REGIONS.has(r));
    const use = es.length ? es : all;                 // a goal with no targeted region keeps its old split
    const tot = use.reduce((a, [, w]) => a + w, 0); if (!tot) continue;
    for (const [r, w] of use) out[r] = (out[r] || 0) + g.extraWeeklySets * w / tot;
  }
  return out;
}

// Per enforcement unit (VOLUME_UNITS): min = evidence floor (fixed), target = base target × slider +
// sculpt extras (clamped to [min, max]), max = cap. The ONE priority mechanism: sliders and sculpt
// goals move only the target. → { [unit]: { min, target, max, base, slider, extra, name, group, tier } }
export function unitTargets(profile) {
  const key = profile && typeof profile === 'object' ? profile : unitCache;
  const floor = volumeFloorOf(profile);
  const lim = priorityLimits(profile);
  const sig = JSON.stringify([profile?.groupPriority, profile?.sculptGoals, floor, lim[0]]);
  const hit = unitCache.get(key);
  if (hit && hit.sig === sig) return hit.v;
  const extraR = sculptExtraByRegion(profile);
  const v = {};
  const ff = FLOOR_FACTOR[floor], tf = TARGET_FACTOR[floor];
  const allowZero = lim[0] === 0;
  for (const id of UNIT_ORDER) {
    const u = VOLUME_UNITS[id];
    const p = profile?.groupPriority?.[u.group];
    // §23: a weight-loss profile may park a slider at 0 (detrain). Every other goal keeps the old rule
    // (a stored 0 or a negative means "not set" → 1×), so their resolved numbers are unchanged.
    const slider = allowZero
      ? (typeof p === 'number' && Number.isFinite(p) && p >= 0 ? clamp(p, lim) : 1)
      : (typeof p === 'number' && p > 0 ? p : 1);
    const extra = u.target > 0 ? Math.round(u.regions.reduce((a, r) => a + (extraR[r] || 0), 0) * 10) / 10 : 0;
    // §23: below-floor modes scale both the floor and the base target. 'evidence' keeps both exactly as before.
    const min = ff === 1 ? u.min : Math.round(u.min * ff * 10) / 10;
    const base = tf === 1 ? u.target : Math.round(u.target * tf * 10) / 10;
    const target = Math.round(Math.min(u.max, Math.max(min, base * slider + extra)) * 10) / 10;
    v[id] = { min, target, max: u.max, base, slider, extra, name: u.name, group: u.group, tier: u.tier, big: u.big, sub: u.sub,
      ...(ff === 1 && tf === 1 ? {} : { growthMin: u.min, growthBase: u.target, floorMode: floor }) };
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
// Why a target stops at the max even when sliders or sculpt goals ask for more (Bob 2026-10-20: "if the
// max number of sets doesn't go up we need an info on why"). id = unit id, x = its unitTargets() row.
// → null for muscles without a target, else { asked, capped, atMax, tag, text }.
export function maxNote(id, x) {
  if (!x || !(x.target > 0)) return null;
  const asked = Math.round((x.base * x.slider + x.extra) * 10) / 10;
  const capped = asked > x.max + 0.05, atMax = capped || x.target >= x.max - 0.05;
  const by = [x.slider !== 1 && `slider ×${x.slider}`, x.extra > 0 && `sculpt goals +${x.extra}`].filter(Boolean).join(' and ');
  const name = x.name.replace(/ \(.*\)$/, '');
  const head = capped ? `Your ${by || 'settings'} ${by.includes(' and ') ? 'ask' : 'asks'} for ${asked} sets a week of ${name.toLowerCase()}, but the target stops at the max of ${x.max}.`
    : atMax ? `Your ${name.toLowerCase()} target is at the max of ${x.max}, so raising the slider further adds no sets.`
      : `Raising the slider moves the target up to the max of ${x.max}, no further.`;
  const why = String(MAX_WHY[id] || '').replace(/^\d+:\s*/, '');
  const body = `The max doesn't rise with priority because it's a ceiling on what the muscle can use, the same for everyone; priority moves only the target.${why ? ` Why ${x.max}: ${why}.` : ''} Sets past it add fatigue and time, not muscle.`;
  return { asked, capped, atMax, tag: capped ? `capped, asks ${asked}` : atMax ? 'at max' : '', text: `${head} ${body}` };
}

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
  const goal = goalOf(profile);
  const losing = goal === 'weight_loss';
  const floorMode = volumeFloorOf(profile);
  const plan = losing ? lossPlan(profile, { now }) : null;
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
    minimums: { groups: weeklyMinimums(profile), units: unitTargets(profile), evidence: MINIMUMS_EVIDENCE,
      // §23: which weekly-set floors are in force, and whether the goal even allows going below them.
      floor: { mode: floorMode, factor: FLOOR_FACTOR[floorMode], name: FLOOR_INFO[floorMode].name, why: FLOOR_INFO[floorMode].why,
        allowed: losing, belowFloor: floorMode !== 'evidence', evidence: FLOOR_EVIDENCE } },
    nutrition: nutritionOf(profile),
    adherence: fin(profile.adherence) ? clamp(num(profile.adherence), LIMITS.adherence) : DEF.adherence,
    stack: { active: stack, count: stack.length },
    goals: {
      goal,
      sculptGoals: Array.isArray(profile.sculptGoals) ? [...profile.sculptGoals] : [],
      goalBodyFatPct: Number.isFinite(goalBf) && goalBf > 0 ? clamp(goalBf, goalBodyFatLimits(profile)) : goalBfDefault(profile),
      // §23 (weight-loss goal). These are resolved for every goal so screens can read them without branching;
      // `losing` says whether the weight-loss model is actually in force.
      losing,
      goalWeightLb: plan ? plan.goalWeightLb : (fin(profile.body?.goalWeightLb) && num(profile.body.goalWeightLb) > 0 ? clamp(num(profile.body.goalWeightLb), LIMITS.goalWeightLb) : null),
      goalWeightDate: isDs(profile.body?.goalWeightDate) ? profile.body.goalWeightDate : null,
      lossRatePctPerWeek: plan ? plan.pctPerWeek : (fin(profile.body?.lossRatePctPerWeek) && num(profile.body.lossRatePctPerWeek) > 0 ? clamp(num(profile.body.lossRatePctPerWeek), LIMITS.lossRatePctPerWeek) : null),
      leanProtection: leanProtectionOf(profile),
      plan,
    },
    capacity: { cardio: cap.cardio, total: cap.total, finishers: cap.finishers, cardioDays: cap.cardioDays, flex: cap.flex, classes: cap.classes },
    warnings: [],
  };
  if (cardio.minPerWeek > cap.cardio + 5) {
    out.warnings.push(`Your weekly availability fits about ${cap.cardio} cardio min alongside lifting, ${cardio.minPerWeek - cap.cardio} short of ${cardio.minPerWeek}. Add a cardio day or more minutes in Availability.`);
  }
  if (plan) {
    for (const w of plan.warnings) out.warnings.push(w);
    if (floorMode !== 'evidence') out.warnings.push(`Weekly set floors are on "${FLOOR_INFO[floorMode].name}", deliberately below the volume that builds muscle. ${FLOOR_INFO[floorMode].why}`);
    if (out.nutrition.proteinGPerLb < 0.7) out.warnings.push(`Protein is ${out.nutrition.proteinGPerLb} g/lb. In a deficit that costs lean mass: 1.0 g/kg (≈0.45 g/lb) lost 1.6 kg of lean in two weeks against 0.3 kg at 2.3 g/kg (≈1.05 g/lb) in the same athletes (Mettler 2010). That is the trade you are making.`);
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
  // §23: the goal decides the priority-slider floor, so resolve it BEFORE the groupPriority clamp below.
  const goalAfter = GOALS.includes(patch.goals?.goal) ? patch.goals.goal : goalOf(p);
  const prioLim = priorityLimitsFor(goalAfter);
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
    // §23: the weekly-set floor mode. Stored for any goal (so it survives a round trip) but only
    // honoured by volumeFloorOf() under the weight-loss goal.
    if (VOLUME_FLOORS.includes(t.volumePolicy.floors)) cur.floors = t.volumePolicy.floors;
    p.volumePolicy = cur;
  }
  if (t.groupPriority && typeof t.groupPriority === 'object') {
    const gp = {};
    for (const [g, v] of Object.entries(t.groupPriority)) { const x = vNum(v, prioLim, { round: 2 }); if (x !== undefined) gp[g] = x; }
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
  // ---- §23 weight-loss goal fields (all on profile.body; null clears) ----
  const setBody = (k, v) => { p.body = { ...(p.body || {}), [k]: v }; };
  if ('goalWeightLb' in g) {
    if (g.goalWeightLb === null || g.goalWeightLb === '') setBody('goalWeightLb', null);
    else { const v = vNum(g.goalWeightLb, LIMITS.goalWeightLb, { round: 1 }); if (v !== undefined) setBody('goalWeightLb', v); }
  }
  if ('goalWeightDate' in g) setBody('goalWeightDate', isDs(g.goalWeightDate) ? g.goalWeightDate : null);
  if ('lossRatePctPerWeek' in g) {
    if (g.lossRatePctPerWeek === null || g.lossRatePctPerWeek === '') setBody('lossRatePctPerWeek', null);
    else { const v = vNum(g.lossRatePctPerWeek, LIMITS.lossRatePctPerWeek, { round: 2 }); if (v !== undefined) { setBody('lossRatePctPerWeek', v); setBody('goalWeightDate', null); } }
  }
  // leanProtection is a PRESET: it writes the protein target and the weekly-set floors, which is what the
  // model actually reads. The user can still override either afterwards (that just leaves the preset stale).
  if ('leanProtection' in g && LEAN_PROTECTION.includes(g.leanProtection)) {
    setBody('leanProtection', g.leanProtection);
    const pre = LEAN_PROTECTION_INFO[g.leanProtection];
    if (g.applyPreset !== false) {
      p.nutrition = { ...(p.nutrition || {}), proteinGPerLb: clamp(pre.proteinGPerLb, LIMITS.proteinGPerLb) };
      p.volumePolicy = { ...volumePolicyOf(p), floors: pre.floors };
      if (pre.floors === 'minimum') {
        // Detrain mode only means anything if the sliders can reach 0; leave raised ones alone.
        const gp = { ...(p.groupPriority || {}) };
        for (const k of Object.keys(gp)) if (gp[k] < 0.5) gp[k] = clamp(gp[k], prioLim);
        p.groupPriority = gp;
      }
    }
  }
  return p;
}

// ---------------------------------------------------------------- change helpers
// Does the change affect what the planner would generate?
export function needsReplan(before, after) {
  const a = resolveTargets(before), b = resolveTargets(after);
  const k = t => JSON.stringify([t.cardio.minPerWeek, t.cardio.modalities, t.cardio.hardSessionsPerWeek, t.cardio.style, t.cardio.minSession, t.training.schedule, t.training.style,
    t.training.defaultMinutes, t.training.groupPriority, t.training.volumePolicy, t.goals.sculptGoals, usedStyles(t.training),
    t.minimums.floor.mode]);   // §23: the weekly-set floors change what the planner builds
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
  if (a.goals.goal !== b.goals.goal) out.push(`goal: ${GOAL_INFO[b.goals.goal]?.name.toLowerCase() || b.goals.goal.replace('_', ' ')}`);
  if (a.goals.goalBodyFatPct !== b.goals.goalBodyFatPct) out.push(`goal ${b.goals.goalBodyFatPct}% body fat`);
  if (a.goals.goalWeightLb !== b.goals.goalWeightLb) out.push(b.goals.goalWeightLb ? `goal weight ${b.goals.goalWeightLb} lb` : 'no goal weight');
  if (a.goals.goalWeightDate !== b.goals.goalWeightDate) out.push(b.goals.goalWeightDate ? `goal date ${b.goals.goalWeightDate}` : 'no goal date');
  if (a.goals.lossRatePctPerWeek !== b.goals.lossRatePctPerWeek && b.goals.lossRatePctPerWeek) out.push(`${b.goals.lossRatePctPerWeek}%/week loss${b.goals.plan?.lbPerWeek ? ` (${b.goals.plan.lbPerWeek} lb/wk)` : ''}`);
  if (a.goals.leanProtection !== b.goals.leanProtection) out.push(LEAN_PROTECTION_INFO[b.goals.leanProtection].name.toLowerCase());
  if (a.minimums.floor.mode !== b.minimums.floor.mode) out.push(`${FLOOR_INFO[b.minimums.floor.mode].name.toLowerCase()} set floors`);
  if (JSON.stringify(a.goals.sculptGoals) !== JSON.stringify(b.goals.sculptGoals)) out.push('sculpt focus');
  return out.join(', ');
}

// Day key helper for UIs ('mon'…'sun') of a date string.
export function dayKey(date) { return DOW[parseDs(date).getDay()]; }
