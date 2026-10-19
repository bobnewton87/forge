// Body projection: a weekly energy-balance + lean-gain simulation. Pure, DOM-free (CONTRACT §13).
//
// CONTRACT-NOTE: project() returns these extras beyond the contract shape:
//   series[i].week (0..weeks), series[i].shape (every silhouette site filled: measured sites are
//     projected from the tape, unmeasured ones are rough population estimates, listed in
//     result.shapeEstimated), series[i].ratios { shoulderToWaist, chestToWaist, waistToHeight }
//     (null when shoulders/chest/waist were never measured), series[i].low/high also carry fatLb
//     and waist (when known).
//   weekly: also { kcalBalance, groupSetsPerWeek, liftSessionsPerWeek, perWeek:[{ weekStart, kcalIn,
//     kcalOut, balance, liftSets, groupSets, cardioMin, source:'plan'|'template'|'mixed'|'none' }] }
//   summary: { weeks, endDate, weightLb, fatLb, leanLb, bodyFatPct, waist } = end-minus-start deltas
//   energy: { intakeSource:'arg'|'nutrition'|'goal', intakeStart, tdeeStart, goal }
//   driverSource: 'plan' | 'plan+history' | 'history' | 'schedule' | 'none' (what fed the training model)
//   missing / missingInfo (from baseline, plus projection-specific items), bodyFatAssumed:boolean
// CONTRACT-NOTE: milestone entries also carry { value, target, reached:boolean, already:boolean }.
// CONTRACT-NOTE: optional profile.body.goalBodyFat (default 12), raceWeightLb / raceBodyFat
//   (default 137 lb / 6.5 % for male, from Bob's marathon days) are read if present.
import { sessionVolume } from './recovery.js';
import { dailyTargets } from './nutrition.js';
import { _sessionDetail, NEAT_FACTORS } from './bodycomp.js';
import { GROUPS, GROUP_ORDER } from '../data/muscles.js';
import { estimateCalories } from '../data/cardio.js';
import { ds, parseDs, addDays, daysBetween, clamp } from '../util.js';

// ---------------------------------------------------------------- constants (all documented in assumptions)
const LB_PER_KG = 2.20462;
const KCAL_PER_LB_FAT = 3500;     // adipose tissue, first approximation
const KCAL_PER_LB_LEAN = 1250;    // energy stored in new lean tissue (~800) + synthesis cost
const KCAL_LEAN_RELEASED = 800;   // energy released when lean tissue is lost
const DAYS_PER_MONTH = 30.44;
const DEFAULT_BF = { male: 20, female: 28 };
const ESSENTIAL_BF = { male: 5, female: 13 };
// Max lean gain, % bodyweight per month, by months of consistent training (Aragon/McDonald-style,
// on the conservative side). Interpolated linearly between anchors.
const LEAN_RATE_ANCHORS = [[0, 1.2], [12, 0.9], [24, 0.6], [36, 0.4], [60, 0.25]];
// Fraction of that max realised at a given daily energy balance (kcal/day).
const ENERGY_ANCHORS = [[-1000, 0.05], [-750, 0.15], [-500, 0.35], [-300, 0.5], [0, 0.75], [250, 1], [600, 1]];
const GOAL_OFFSET = { recomp: -300, cut: -500, lean_bulk: 250 };
const AT_DEFICIT_FRAC = 0.1, AT_PER_LB_LOST = 10, AT_CAP = 200;   // adaptive thermogenesis
const SURPLUS_NEAT_FRAC = 0.15, SURPLUS_NEAT_CAP = 150;          // spontaneous NEAT rise in a surplus
const TEMPLATE_HISTORY_DAYS = 28;

// Weekly group-set target the volume factor compares against (sum of group minimums).
const GROUP_TARGET_TOTAL = GROUP_ORDER.reduce((a, g) => a + (GROUPS[g]?.weeklySets?.min || 0), 0) || 105;
const TYPICAL_SHARE = Object.fromEntries(GROUP_ORDER.map(g => [g, (GROUPS[g]?.weeklySets?.min || 0) / GROUP_TARGET_TOTAL]));

// Measurement response (inches). FAT: per lb of whole-body fat change. LEAN: per lb of whole-body lean
// change when volume is split like the default weekly targets; scaled by the actual share of volume.
const FAT_COEF = {
  male: { waist: 0.12, hips: 0.09, chest: 0.06, shoulders: 0.05, thigh: 0.06, arm: 0.03, forearm: 0.01, calf: 0.015, neck: 0.03 },
  female: { waist: 0.10, hips: 0.11, chest: 0.05, shoulders: 0.04, thigh: 0.08, arm: 0.035, forearm: 0.01, calf: 0.015, neck: 0.025 },
};
const LEAN_COEF = { arm: 0.12, chest: 0.2, shoulders: 0.25, thigh: 0.08, calf: 0.03, forearm: 0.05, neck: 0.03, hips: 0.03, waist: 0 };
const SITE_GROUPS = {
  arm: { biceps: 1, triceps: 1 }, forearm: { forearms: 1, biceps: 0.3 }, chest: { chest: 1, back: 0.5 },
  shoulders: { shoulders: 1, back: 0.5 }, thigh: { quads: 1, hamstrings: 1, glutes: 1 }, calf: { calves: 1 },
  neck: { back: 1 }, hips: { glutes: 1 },
};
const SITES = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'arm', 'forearm', 'thigh', 'calf'];
// Reference bodies for estimating unmeasured silhouette sites (rough population-ish values).
const REF_BODY = {
  male: { h: 69, w: 164, bf: 20, neck: 15, shoulders: 46, chest: 39, waist: 33, hips: 38, arm: 13, forearm: 11, thigh: 22, calf: 14.5 },
  female: { h: 64, w: 140, bf: 28, neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14 },
};

// ---------------------------------------------------------------- helpers
const fin = x => (typeof x === 'number' && Number.isFinite(x));
const pos = x => { const n = Number(x); return x != null && x !== '' && Number.isFinite(n) && n > 0 ? n : null; };
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const toDate = now => (now instanceof Date ? now : now ? new Date(now) : new Date());
function interp(anchors, x) {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (x <= x1) { const [x0, y0] = anchors[i - 1]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return anchors[anchors.length - 1][1];
}
export function leanRatePctPerMonth(months) { return interp(LEAN_RATE_ANCHORS, Math.max(0, months || 0)); }
export function energyFactor(balance) { return interp(ENERGY_ANCHORS, balance); }
export function volumeFactor(groupSets) {
  const ratio = Math.max(0, groupSets / GROUP_TARGET_TOTAL);
  return Math.min(1.1, (1 - Math.exp(-2 * ratio)) / (1 - Math.exp(-2)));
}
const emptyDay = () => ({ sets: 0, groupSets: 0, groups: {}, cardioMin: 0, kcal: 0, minutes: 0, lift: 0, cardio: 0 });
function addInto(a, b, f = 1) {
  a.sets += b.sets * f; a.groupSets += b.groupSets * f; a.cardioMin += b.cardioMin * f; a.kcal += b.kcal * f; a.minutes += b.minutes * f;
  a.lift = Math.max(0, Math.min(1, a.lift + b.lift * f)); a.cardio = Math.max(0, Math.min(1, a.cardio + b.cardio * f));
  for (const [g, v] of Object.entries(b.groups)) a.groups[g] = (a.groups[g] || 0) + v * f;
  return a;
}
// Treat a planned session as done (every set done at its target reps) so recovery.sessionVolume counts it.
function asDone(s) {
  if (s.status === 'done') return s;
  return { ...s, status: 'done', blocks: (s.blocks || []).map(b => {
    if (b.kind === 'lift') {
      const reps = pos(b.target?.reps) ?? pos(b.target?.repMin) ?? 10;
      const sets = Array.isArray(b.sets) && b.sets.length ? b.sets : Array.from({ length: pos(b.target?.sets) || 0 }, () => ({}));
      return { ...b, sets: sets.map(x => ({ ...x, done: true, r: pos(x?.r) ?? reps })) };
    }
    return { ...b, done: true };
  }) };
}
function sessionContribution(s, weightLb) {
  const d = asDone(s);
  let v;
  try { v = sessionVolume(d); } catch (e) { v = { groups: {}, liftSets: 0, cardioMin: 0 }; }
  const det = _sessionDetail(d, { weightLb });
  const groups = {};
  let groupSets = 0;
  for (const [g, x] of Object.entries(v.groups || {})) if (fin(x) && x > 0) { groups[g] = x; groupSets += x; }
  return { sets: v.liftSets || 0, groupSets, groups, cardioMin: v.cardioMin || 0, kcal: det.kcal || 0, minutes: det.minutes || 0,
    lift: (v.liftSets || 0) > 0 || groupSets >= 3 ? 1 : 0, cardio: (v.cardioMin || 0) >= 10 ? 1 : 0 };
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
  out.kcal = 5 * (weightLb / 165) * liftMin + estimateCalories('bike', cardioMin, 'easy', weightLb);
  out.minutes = min; out.lift = liftShare > 0 ? 1 : 0; out.cardio = cardioMin >= 10 ? 1 : 0;
  return out;
}
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ---------------------------------------------------------------- main
export function project({ baseline: b, profile = {}, sessions = [], weeks = 12, now = new Date(), intake = null,
  adherence = 0.85, repeatPlan = true } = {}) {
  profile = profile || {};
  const body = profile.body || {};
  const sex = (b?.sex || body.sex) === 'female' ? 'female' : 'male';
  const nowD = toDate(now);
  const today = ds(nowD);
  const W = clamp(Math.round(Number(weeks) || 12), 1, 104);
  const adh = fin(Number(adherence)) && adherence !== null ? clamp(Number(adherence), 0, 1) : 0.85;
  const missing = [...(b?.missing || [])];
  const missingInfo = [...(b?.missingInfo || [])];
  const assumptions = [];

  if (!b || !pos(b.weightLb)) {
    if (!missing.includes('weight')) { missing.unshift('weight'); missingInfo.unshift({ field: 'weight', label: 'Bodyweight', why: 'The projection needs a starting weight.' }); }
    return { series: [], milestones: [], weekly: { kcalIn: 0, kcalOut: 0, liftSetsPerWeek: 0, cardioMinPerWeek: 0, setsByGroup: {}, perWeek: [] },
      assumptions: ['No bodyweight logged yet, so nothing can be projected. Log a morning weigh-in to start.'],
      confidence: 'low', summary: null, energy: null, missing, missingInfo, shapeEstimated: [], driverSource: 'none', bodyFatAssumed: false };
  }

  // ---------------- starting state
  const W0 = Number(b.weightLb);
  const bfAssumed = !pos(b.bodyFatPct);
  const bf0 = bfAssumed ? DEFAULT_BF[sex] : Number(b.bodyFatPct);
  const L0 = W0 * (1 - bf0 / 100), F0 = W0 - L0;
  const heightIn = pos(b.heightIn);
  const months0 = Number.isFinite(Number(body.trainingMonths)) && Number(body.trainingMonths) >= 0 ? Number(body.trainingMonths) : 6;
  const neatFactor = NEAT_FACTORS[body.activity] ?? NEAT_FACTORS.desk;
  const goal = GOAL_OFFSET[profile.goal] != null ? profile.goal : 'recomp';
  const nutritionOn = !!(profile.nutrition && profile.nutrition.mode && profile.nutrition.mode !== 'off');
  const proteinFactor = nutritionOn ? 1 : 0.9;
  const goalBf = pos(body.goalBodyFat) || 12;

  // ---------------- training drivers, per day
  const endDate = ds(addDays(parseDs(today), 7 * W - 1));
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
    addInto(histTotal, { ...c, lift: 0, cardio: 0 }, 1);
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
    for (const [d, c] of daily) { if (d <= lastPlanned) addInto(planTotal, { ...c, lift: 0, cardio: 0 }); }
    for (const [d, c] of dailyRaw) { if (d <= lastPlanned) { pl += c.lift; pc += c.cardio; pb += c.lift && c.cardio ? 1 : 0; } }
    let hl = 0, hc = 0, hb = 0;
    for (const k of histDayKinds.values()) { hl += k.lift; hc += k.cardio; hb += k.lift && k.cardio ? 1 : 0; }
    addInto(template, { ...planTotal, lift: 0, cardio: 0 }, 1 / totDays);
    addInto(template, { ...histTotal, lift: 0, cardio: 0 }, 1 / totDays);
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
      addInto(t, { ...d, lift: 0, cardio: 0 }, adh / 7);
      l += d.lift; c += d.cardio; both += d.lift && d.cardio ? 1 : 0;
    }
    if (t.groupSets > 0 || t.cardioMin > 0) {
      scheduleTemplate = t; tplLiftFrac = l / 7; tplCardioFrac = c / 7; tplBothFrac = both / 7;
      driverSource = plannedCount ? 'plan+schedule' : 'schedule';
    }
  }
  const tpl = scheduleTemplate || template;
  const useTemplateBeyond = repeatPlan || (!plannedCount && !!scheduleTemplate);

  // Weekly drivers.
  const weekDrivers = [];
  for (let k = 0; k < W; k++) {
    const wk = emptyDay();
    let lD = 0, cD = 0, bD = 0, planD = 0, tplD = 0;
    for (let i = 0; i < 7; i++) {
      const d = ds(addDays(parseDs(today), 7 * k + i));
      const beyond = !lastPlanned || d > lastPlanned;
      if (beyond && useTemplateBeyond) {
        addInto(wk, { ...tpl, lift: 0, cardio: 0 });
        lD += tplLiftFrac; cD += tplCardioFrac; bD += tplBothFrac; tplD++;
        if (daily.has(d)) addInto(wk, { ...daily.get(d), lift: 0, cardio: 0 });   // done today beyond plan
      } else {
        const c = daily.get(d), raw = dailyRaw.get(d);
        if (c) addInto(wk, { ...c, lift: 0, cardio: 0 });
        if (raw) { lD += raw.lift; cD += raw.cardio; bD += raw.lift && raw.cardio ? 1 : 0; }
        if (!beyond) planD++;
      }
    }
    wk.liftDays = lD; wk.cardioDays = cD; wk.bothDays = bD;
    wk.source = planD && tplD ? 'mixed' : planD ? 'plan' : tplD && (tpl.groupSets > 0 || tpl.cardioMin > 0) ? 'template' : wk.groupSets > 0 || wk.cardioMin > 0 ? 'plan' : 'none';
    weekDrivers.push(wk);
  }

  // Volume share by group across the horizon (for measurement distribution).
  const horizonGroups = {};
  let horizonGroupSets = 0;
  for (const wk of weekDrivers) for (const [g, v] of Object.entries(wk.groups)) { horizonGroups[g] = (horizonGroups[g] || 0) + v; horizonGroupSets += v; }
  const siteSens = {};
  for (const [site, map] of Object.entries(SITE_GROUPS)) {
    if (horizonGroupSets <= 0) { siteSens[site] = 1; continue; }
    let share = 0, typ = 0;
    for (const [g, f] of Object.entries(map)) { share += f * (horizonGroups[g] || 0) / horizonGroupSets; typ += f * (TYPICAL_SHARE[g] || 0); }
    siteSens[site] = typ > 0 ? clamp(share / typ, 0.3, 2) : 1;
  }

  // ---------------- energy helpers
  const bmrOf = L => 370 + 21.6 * (L / LB_PER_KG);                     // Katch-McArdle on current lean mass
  const restPerMinOf = L => bmrOf(L) * (1 + neatFactor) / 1440;
  const exNetPerDay = (wk, Wt, L) => Math.max(0, wk.kcal * (Wt / W0) - restPerMinOf(L) * wk.minutes) / 7;
  const maintenance = (wk, Wt, L) => bmrOf(L) * (1 + neatFactor) + exNetPerDay(wk, Wt, L);
  const avgEx = weekDrivers.reduce((a, wk) => a + exNetPerDay(wk, W0, L0), 0) / W;
  const tdeeStart = bmrOf(L0) * (1 + neatFactor) + avgEx;
  const nutritionIntake = (wk, Wt) => {
    if (!nutritionOn) return null;
    const both = clamp(wk.bothDays, 0, 7), liftOnly = clamp(wk.liftDays - both, 0, 7), cardioOnly = clamp(wk.cardioDays - both, 0, 7 - liftOnly - both);
    const rest = Math.max(0, 7 - both - liftOnly - cardioOnly);
    let total = 0;
    for (const [type, n] of [['both', both], ['lift', liftOnly], ['cardio', cardioOnly], ['rest', rest]]) {
      if (!n) continue;
      const t = dailyTargets(profile, { dayType: type, bodyweight: Wt });
      if (!t || !fin(t.calories)) return null;
      total += t.calories * n;
    }
    return total / 7;
  };
  let intakeSource = 'goal';
  if (pos(intake)) intakeSource = 'arg';
  else if (nutritionIntake(weekDrivers[0], W0) != null) intakeSource = 'nutrition';
  const goalIntake = tdeeStart + GOAL_OFFSET[goal];
  const intakeFor = (wk, Wt) => intakeSource === 'arg' ? Number(intake) : intakeSource === 'nutrition' ? (nutritionIntake(wk, Wt) ?? goalIntake) : goalIntake;
  const intakeStart = intakeFor(weekDrivers[0], W0);

  // ---------------- simulation
  function sim({ energyShift = 0, leanMult = 1 } = {}) {
    let L = L0, F = F0;
    const pts = [{ L, F }];
    const wkOut = [];
    for (let k = 0; k < W; k++) {
      const wk = weekDrivers[k];
      const Wt = L + F;
      const maint = maintenance(wk, Wt, L);
      // Once at the goal body fat, a goal-driven diet (not an explicit intake) moves to maintenance.
      const atGoal = intakeSource !== 'arg' && goal !== 'lean_bulk' && 100 * F / Wt <= goalBf;
      const inK = atGoal ? maint : intakeFor(wk, Wt);
      const rawBal = inK - maint;
      const ramp = Math.min(1, (k + 1) / 4);
      let at = 0;
      if (rawBal < 0) at = Math.min(AT_CAP, AT_DEFICIT_FRAC * -rawBal * ramp + AT_PER_LB_LOST * Math.max(0, W0 - Wt));
      else at = -Math.min(SURPLUS_NEAT_CAP, SURPLUS_NEAT_FRAC * rawBal * ramp);
      const out = maint - at;
      const bal = inK - out + energyShift;                             // kcal/day
      const months = months0 + (7 * k + 3.5) / DAYS_PER_MONTH;
      const bfNow = 100 * F / Wt;
      let fE = energyFactor(bal);
      if (bal < 0) {
        let rec = months < 12 ? 1.15 : months >= 36 ? 0.7 : 1;
        rec *= bfNow >= 20 ? 1.1 : bfNow < 12 ? 0.75 : 1;
        fE = Math.min(energyFactor(0), fE * rec);
      }
      const vf = volumeFactor(wk.groupSets);
      const interference = 1 - clamp((wk.cardioMin - 180) / 600, 0, 0.15);
      const gain = Math.max(0, Wt * leanRatePctPerMonth(months) / 100 * (7 / DAYS_PER_MONTH) * vf * fE * interference * proteinFactor * leanMult);
      // Lean loss in a deficit: Forbes partition, mostly prevented by resistance training.
      let loss = 0;
      if (bal < 0) {
        const massLoss = (-bal * 7) / KCAL_PER_LB_FAT;
        const pForbes = 10.4 / (10.4 + F / LB_PER_KG);
        // Training protects lean mass, less so when very lean (<10% BF).
        const protect = 0.85 * Math.min(1, wk.groupSets / GROUP_TARGET_TOTAL) * Math.min(1, bfNow / 10);
        loss = massLoss * pForbes * (1 - protect);
      }
      L = L + gain - loss;
      F = F + (bal * 7 - gain * KCAL_PER_LB_LEAN + loss * KCAL_LEAN_RELEASED) / KCAL_PER_LB_FAT;
      const minF = (L + F) * ESSENTIAL_BF[sex] / 100;
      if (F < minF) F = minF;
      pts.push({ L, F });
      wkOut.push({ kcalIn: inK, kcalOut: out, balance: bal - energyShift, gain, loss });
    }
    return { pts, wkOut };
  }

  // ---------------- confidence (also sets band widths)
  const confidence = confidenceFor({ b, sessions: all, today });
  const sigmaE = 150 + (confidence === 'low' ? 100 : confidence === 'medium' ? 50 : 0);
  const [lmLo, lmHi] = confidence === 'low' ? [0.4, 1.6] : confidence === 'medium' ? [0.5, 1.5] : [0.6, 1.4];
  const likely = sim();
  const scen = [sim({ energyShift: -sigmaE, leanMult: lmHi }), sim({ energyShift: -sigmaE, leanMult: lmLo }),
    sim({ energyShift: sigmaE, leanMult: lmHi }), sim({ energyShift: sigmaE, leanMult: lmLo })];

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
  const shapeAt = (L, F) => {
    const dF = F - F0, dL = L - L0, out = {};
    for (const s of SITES) out[s] = r1(Math.max(1, shape0[s] + fc[s] * dF + (LEAN_COEF[s] || 0) * dL * (siteSens[s] ?? 1)));
    return out;
  };
  const known = SITES.filter(s => pos(m0[s]));

  // ---------------- series
  const start = parseDs(today);
  const series = likely.pts.map((p, k) => {
    const Wt = p.L + p.F;
    const shape = shapeAt(p.L, p.F);
    const measurements = {};
    for (const s of known) measurements[s] = shape[s];
    const band = (pick) => {
      const vals = [pick(p), ...scen.map(sc => pick(sc.pts[k]))];
      return [Math.min(...vals), Math.max(...vals)];
    };
    const [wLo, wHi] = band(q => q.L + q.F);
    const [bLo, bHi] = band(q => 100 * q.F / (q.L + q.F));
    const [lLo, lHi] = band(q => q.L);
    const [fLo, fHi] = band(q => q.F);
    const low = { weightLb: r1(wLo), bodyFatPct: r1(bLo), leanLb: r1(lLo), fatLb: r1(fLo) };
    const high = { weightLb: r1(wHi), bodyFatPct: r1(bHi), leanLb: r1(lHi), fatLb: r1(fHi) };
    if (known.includes('waist')) {
      const [wa, wb] = band(q => shapeAt(q.L, q.F).waist);
      low.waist = r1(wa); high.waist = r1(wb);
    }
    const ratio = (a, c) => (pos(m0[a]) && pos(m0[c]) ? r2(shape[a] / shape[c]) : null);
    return {
      week: k, date: ds(addDays(start, 7 * k)),
      weightLb: r1(Wt), bodyFatPct: r1(100 * p.F / Wt), leanLb: r1(p.L), fatLb: r1(p.F),
      measurements, shape,
      ratios: { shoulderToWaist: ratio('shoulders', 'waist'), chestToWaist: ratio('chest', 'waist'),
        waistToHeight: pos(m0.waist) && heightIn ? r2(shape.waist / heightIn) : null },
      low, high,
    };
  });

  // ---------------- milestones
  const milestones = [];
  const endPt = series[series.length - 1];
  const bfMilestone = (id, label, thr, note) => {
    const already = series[0].bodyFatPct <= thr;
    const hit = series.find(p => p.bodyFatPct <= thr);
    milestones.push({ id, label, date: hit ? hit.date : null, target: thr, value: endPt.bodyFatPct, reached: !!hit, already,
      note: already ? `Already at or below ~${thr}% body fat (estimated ${series[0].bodyFatPct}%). ${note}`
        : hit ? `Projected around ${hit.date} (week ${hit.week}). ${note}`
          : `Not reached within ${W} weeks at this pace (projected ${endPt.bodyFatPct}% at the end). ${note}` });
  };
  const absNote = 'Where abs show depends on where you store fat; most men see them somewhere between 10 and 14%.';
  bfMilestone('abs_upper', 'Upper abs visible (~12% BF)', 12, absNote);
  bfMilestone('six_pack', 'Full six-pack (~10% BF)', 10, absNote);
  {
    const already = series[0].bodyFatPct <= goalBf;
    const hit = series.find(p => p.bodyFatPct <= goalBf);
    const atGoal = endPt.leanLb / (1 - goalBf / 100);
    milestones.push({ id: 'goal_bf', label: `Goal body fat (${goalBf}%)`, date: hit ? hit.date : null, target: goalBf, value: endPt.bodyFatPct,
      reached: !!hit, already,
      note: `With your projected lean mass (${r1(endPt.leanLb)} lb), ${goalBf}% body fat is about ${r1(atGoal)} lb on the scale.` +
        (hit ? '' : ` Not reached within ${W} weeks at this pace.`) });
  }
  if (pos(m0.shoulders) && pos(m0.waist)) {
    for (const [id, thr, label] of [['sw_1_5', 1.5, 'Shoulder:waist 1.5 (clear V-taper)'], ['sw_1618', 1.618, 'Shoulder:waist 1.618 (the "golden" Adonis ratio)']]) {
      const already = series[0].ratios.shoulderToWaist >= thr;
      const hit = series.find(p => p.ratios.shoulderToWaist >= thr);
      milestones.push({ id, label, date: hit ? hit.date : null, target: thr, value: endPt.ratios.shoulderToWaist, reached: !!hit, already,
        note: already ? `Already there (${series[0].ratios.shoulderToWaist}).` : hit ? `Projected around ${hit.date}. Rough: it comes from a smaller waist and wider shoulders together.`
          : `Not within ${W} weeks (projected ${endPt.ratios.shoulderToWaist} at the end). Rough estimate from tape measures.` });
    }
  }
  for (const [id, gainLb] of [['lean_5', 5], ['lean_10', 10]]) {
    const thr = L0 + gainLb;
    const hit = series.find(p => p.leanLb >= r1(thr));
    milestones.push({ id, label: `Lean mass +${gainLb} lb`, date: hit ? hit.date : null, target: r1(thr), value: endPt.leanLb, reached: !!hit, already: false,
      note: hit ? `Projected around ${hit.date}. Lean mass includes muscle plus its water; the scale will not show it cleanly.`
        : `Not within ${W} weeks (projected ${endPt.leanLb - L0 >= 0 ? '+' : ''}${r1(endPt.leanLb - L0)} lb lean at the end).` });
  }
  const raceW = pos(body.raceWeightLb) ?? (sex === 'male' ? 137 : null);
  const raceBf = pos(body.raceBodyFat) ?? 6.5;
  if (raceW) {
    const raceLean = r1(raceW * (1 - raceBf / 100));
    const already = series[0].leanLb >= raceLean + 1;
    const hit = series.find(p => p.leanLb >= raceLean + 1);
    milestones.push({ id: 'lean_vs_race', label: `More lean mass than race weight (${raceW} lb at ~${raceBf}% = ${raceLean} lb lean)`,
      date: hit ? hit.date : null, target: r1(raceLean + 1), value: endPt.leanLb, reached: !!hit, already,
      note: already ? `Already about ${r1(series[0].leanLb - raceLean)} lb more lean mass than at marathon race weight. At the same ${raceBf}% you would weigh about ${r1(series[0].leanLb / (1 - raceBf / 100))} lb.`
        : `Marathon-era lean mass is a useful benchmark: beating it by 1+ lb means the lifting has added real muscle.` });
  }

  // ---------------- weekly + summary
  const avg = f => likely.wkOut.reduce((a, w, i) => a + f(w, weekDrivers[i]), 0) / W;
  const setsByGroup = {};
  for (const g of GROUP_ORDER) if (horizonGroups[g]) setsByGroup[g] = r1(horizonGroups[g] / W);
  const weekly = {
    kcalIn: Math.round(avg(w => w.kcalIn)), kcalOut: Math.round(avg(w => w.kcalOut)), kcalBalance: Math.round(avg(w => w.balance)),
    liftSetsPerWeek: r1(avg((w, d) => d.sets)), groupSetsPerWeek: r1(avg((w, d) => d.groupSets)),
    cardioMinPerWeek: Math.round(avg((w, d) => d.cardioMin)), liftSessionsPerWeek: r1(avg((w, d) => d.liftDays * (d.source === 'plan' ? adh : 1))),
    setsByGroup,
    perWeek: likely.wkOut.map((w, i) => ({ weekStart: ds(addDays(start, 7 * i)), kcalIn: Math.round(w.kcalIn), kcalOut: Math.round(w.kcalOut),
      balance: Math.round(w.balance), liftSets: r1(weekDrivers[i].sets), groupSets: r1(weekDrivers[i].groupSets),
      cardioMin: Math.round(weekDrivers[i].cardioMin), leanGain: r2(w.gain - w.loss), source: weekDrivers[i].source })),
  };
  const summary = {
    weeks: W, endDate: endPt.date,
    weightLb: r1(endPt.weightLb - series[0].weightLb), fatLb: r1(endPt.fatLb - series[0].fatLb), leanLb: r1(endPt.leanLb - series[0].leanLb),
    bodyFatPct: r1(endPt.bodyFatPct - series[0].bodyFatPct),
    waist: shape0.waist != null ? r1(endPt.shape.waist - series[0].shape.waist) : null,
  };

  // ---------------- assumptions (plain English, every number that matters)
  const bfSrcText = bfAssumed ? `No body fat available, so a typical ${DEFAULT_BF[sex]}% was ASSUMED. Add height plus neck and waist (or a body-fat reading) to fix this; every number below depends on it.`
    : b.bodyFatSource === 'manual' ? `Starting body fat ${bf0}% is the value you entered.`
      : b.bodyFatSource === 'navy' ? `Starting body fat ${bf0}% comes from the US Navy tape formula (neck, waist, height), which is usually within ±3-4 points.`
        : `Starting body fat ${bf0}% is a rough BMI-based estimate (Deurenberg formula). For a muscular or ex-endurance athlete it can be off by 5+ points; tape measurements will improve it.`;
  assumptions.push(`These are estimates, not predictions. Individual response varies widely (genetics, sleep, stress, how accurately intake is tracked), so treat the shaded low-high band as the realistic range and re-check against real weigh-ins and tape measurements every 2-4 weeks.`);
  assumptions.push(`Start: ${r1(W0)} lb${b.weightDate ? ` (weigh-in ${b.weightDate})` : ' (profile weight)'}. ${bfSrcText} That makes ${r1(L0)} lb lean and ${r1(F0)} lb fat.`);
  assumptions.push(`Calorie burn: BMR by Katch-McArdle (370 + 21.6 × lean kg) ≈ ${Math.round(bmrOf(L0))} kcal/day, × ${r2(1 + neatFactor)} for daily movement and digestion ("${body.activity || 'desk'}" activity), plus exercise calories. Recomputed every week as your weight and lean mass change.`);
  assumptions.push(`Exercise calories: lifting ≈ 4-6 kcal/min (denser sessions burn more), scaled by bodyweight; cardio from MET values for each machine and intensity; Crunch classes from MET values by class type (e.g. HIIT ≈ 8, cycle ≈ 8.5, sculpt ≈ 4.5). Resting calories during the session are subtracted so nothing is counted twice. Average ≈ ${Math.round(avgEx)} kcal/day.`);
  const intakeText = intakeSource === 'arg' ? `You set intake to ${Math.round(Number(intake))} kcal/day.`
    : intakeSource === 'nutrition' ? `Intake follows your nutrition targets (${profile.nutrition.mode} mode, goal ${goal}), averaging about ${Math.round(intakeStart)} kcal/day in week 1 and recalculated as your weight changes.`
      : `Intake: nutrition tracking is off, so the ${goal} default is assumed: maintenance ${GOAL_OFFSET[goal] >= 0 ? '+' : ''}${GOAL_OFFSET[goal]} kcal = about ${Math.round(goalIntake)} kcal/day, held constant (so the deficit shrinks as you get lighter, like eating the same amount in real life).`;
  assumptions.push(`${intakeText} Starting maintenance is estimated at ${Math.round(tdeeStart)} kcal/day.${intakeSource !== 'arg' && goal !== 'lean_bulk' ? ` Once you reach your ${goalBf}% goal, intake is assumed to rise to maintenance (you would stop dieting).` : ''}`);
  assumptions.push(`Fat change uses ~3,500 kcal per lb of fat. Building a lb of lean tissue costs ~${KCAL_PER_LB_LEAN} kcal, taken out of the energy balance. Water and glycogen swings (often 2-4 lb day to day) are not modelled, so the line is your trend weight, not any single morning.`);
  assumptions.push(`Adaptive thermogenesis: in a deficit, burn drops by an extra ~10% of the deficit (phased in over 4 weeks) plus ~10 kcal/day per lb lost, capped at ${AT_CAP} kcal/day. In a surplus, ~15% of the surplus is burned off by extra movement (capped at ${SURPLUS_NEAT_CAP}).`);
  assumptions.push(`Lean gain ceiling by training age (you start at ${r1(months0)} months, rising as the projection runs): ~${LEAN_RATE_ANCHORS.map(([m, r]) => `${r}% at ${m} mo`).join(', ')} of bodyweight per month at best. This is the conservative end of Aragon/McDonald-style guidelines.`);
  assumptions.push(`That ceiling is scaled by: training volume (${r1(weekly.groupSetsPerWeek)} effective muscle-group sets/week vs a ${GROUP_TARGET_TOTAL}-set target, with diminishing returns), energy balance (maintenance ≈ 75% of the ceiling, ~300 kcal deficit ≈ 50%, ~500 deficit ≈ 35%, a 750+ deficit near zero, a 250+ surplus = 100%; newer lifters and people above 20% body fat recomp a bit better), heavy cardio (over 180 min/week trims it up to 15%) and protein (${nutritionOn ? 'assumed adequate because nutrition targets are on' : 'nutrition tracking is off, so it is cut 10% in case protein falls short; ~0.8-1 g per lb daily keeps the full rate'}).`);
  assumptions.push(`In a deficit some lean mass can be lost (Forbes partitioning, higher when leaner); lifting near your weekly set targets prevents ~85% of that.`);
  const drvText = {
    plan: `Training comes from your planned sessions (${plannedCount} in range, through ${lastPlanned}).`,
    'plan+history': `Training comes from your planned sessions (${plannedCount} in range, through ${lastPlanned}) and your last ${histDays} days of logged workouts.`,
    history: `No planned sessions in range, so training repeats your last ${histDays} days of logged workouts.`,
    schedule: `No plan or recent logs, so training is estimated from your weekly schedule template (about 2.7 min per working set).`,
    'plan+schedule': `Training comes from your planned sessions, then your weekly schedule template.`,
    none: `No planned sessions, recent workouts or schedule were found, so no training effect is included (expect little or no muscle gain in this projection).`,
  }[driverSource] || '';
  assumptions.push(`${drvText} Planned sessions count at ${Math.round(adh * 100)}% (adherence)${useTemplateBeyond && lastPlanned ? `, and weeks after ${lastPlanned} repeat the average planned/recent week` : useTemplateBeyond ? '' : ', and nothing is assumed after the last planned day'}. Average: ${r1(weekly.liftSetsPerWeek)} lift sets and ${weekly.cardioMinPerWeek} cardio min per week.`);
  assumptions.push(`Tape measurements are rough: waist ≈ ${fc.waist} in per lb of fat (≈0.6-1.0 in per 5-8 lb), hips ${fc.hips}, chest ${fc.chest}, thighs ${fc.thigh}, arms ${fc.arm}. Lean gain adds size where your volume goes: per lb of lean (at the default split) arms +${LEAN_COEF.arm} in, chest +${LEAN_COEF.chest}, shoulders +${LEAN_COEF.shoulders}, thighs +${LEAN_COEF.thigh}, adjusted by your planned share of sets for those muscles.`);
  if (shapeEstimated.length) assumptions.push(`Silhouette: ${shapeEstimated.join(', ')} ${shapeEstimated.length === 1 ? 'was' : 'were'} not measured, so ${shapeEstimated.length === 1 ? 'it is' : 'they are'} drawn from a typical ${sex} build scaled to your ${heightIn ? 'height and ' : ''}weight. Measure them to make the picture yours.`);
  if (!heightIn) assumptions.push('Height is missing, so BMI, FFMI and the Navy body-fat estimate are unavailable and the silhouette uses an average height.');
  assumptions.push(`Band: low/high combine ±${sigmaE} kcal/day of intake/burn error with ${Math.round(lmLo * 100)}-${Math.round(lmHi * 100)}% of the expected muscle response. It is wider when there is less real data (confidence: ${confidence}).`);

  const outMissing = [...missing], outMissingInfo = [...missingInfo];
  if (!plannedCount && !hist.length && !outMissing.includes('sessions')) {
    outMissing.push('sessions');
    outMissingInfo.push({ field: 'sessions', label: 'Planned or logged workouts', why: 'Muscle gain and calorie burn in the projection come from your planned and recent workouts.' });
  }

  return {
    series, milestones, assumptions, weekly, confidence, summary,
    energy: { intakeSource, intakeStart: Math.round(intakeStart), tdeeStart: Math.round(tdeeStart), goal },
    driverSource, bodyFatAssumed: bfAssumed, shapeEstimated, missing: outMissing, missingInfo: outMissingInfo,
  };
}

// Confidence from the amount and recency of real data.
function confidenceFor({ b, sessions, today }) {
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
  return score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';
}
