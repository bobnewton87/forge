// Metabolic values + supplement/therapy stack → projection modifiers (SUPP, CONTRACT §17 + amendment). Pure, DOM-free.
//
// CONTRACT-NOTE: signatures
//   metabolicBaseline(profile, { age, date }) → { leanCeilingMult, leanRetentionMult, partitionShift, tdeeDelta,
//     leanDirectLbPerWeek, fatDirectLbPerWeek, factors:[{ id, label, mult, retention?, note, assumed? }], notes, assumptions,
//     levels:{ totalT, totalTSource, freeT, vitD, vitDSource, hba1c, tsh, sleepHours, stress, age, ageAssumed } }
//   modifiersAt(profile, date, { age, inDeficit, useStack = true, bodyweightLb }) → contract fields + leanDirectLbPerWeek,
//     fatDirectLbPerWeek, assumptions[], risks:[{ id, name, text }], notes[], factors[], levels{}, testosterone{}
//   contributions[i] = { id, name, evidence, text, kind:'stack'|'metabolic', assumedAverage? (a lab/level was assumed),
//     assumedDose? (dose blank → studied/common dose), dose?, rampPct? }
//   testosteroneEffect(totalT, { baselineT, weeksOn, age }) → { leanDirectLbPerWeek, leanCeilingMult, fatDirectLbPerWeek,
//     note, beyondStudied, belowStudied, levelUsed, baselineUsed, lean20Lb, cumLeanLb, cumFatLb, ceilLowT, ceilAboveNatural }
//   stackTimeline(profile, { from, weeks, age, bodyweightLb, useStack }) → per-week modifiers + cumulative direct effects.
// CONTRACT-NOTE: curves are study-bounded (plateau at the highest studied dose/level, direct effects stop or taper
//   after the studied duration). The final clamps below are wide NaN/sanity guards only.
import { SUPPLEMENTS } from '../data/supplements.js';

const LB_PER_KG = 2.20462;
const fin = x => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r2 = x => Math.round(x * 100) / 100;
const r1 = x => Math.round(x * 10) / 10;
function num(x, lo = -Infinity, hi = Infinity) {
  if (x == null || x === '' || typeof x === 'boolean') return null;
  const n = Number(x);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}
function interp(anchors, x) {
  if (!Array.isArray(anchors) || !anchors.length || !fin(x)) return anchors?.[0]?.[1] ?? 0;
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (x <= x1) { const [x0, y0] = anchors[i - 1]; return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return anchors[anchors.length - 1][1];             // plateau beyond the last (highest studied) anchor
}
// Interpolate in log(x) space (for serum levels).
function interpLog(anchors, x) { return interp(anchors.map(([a, b]) => [Math.log(a), b]), Math.log(Math.max(1e-6, x))); }
function parseDate(s) {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isFinite(dt.getTime()) ? dt : null;
}
const toDs = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function weeksBetween(a, b) {
  const A = parseDate(a), B = parseDate(b);
  if (!A || !B) return null;
  return Math.round((B - A) / 864e5) / 7;
}
const fmtSign = (x, dp = 2) => { const t = Math.abs(x).toFixed(dp); return (x >= 0 ? '+' : '−') + (t.includes('.') ? t.replace(/\.?0+$/, '') : t); };

// ======================================================================== population defaults
// Average total T for men by age: ≈600 ng/dL at 30, declining ~1%/yr (MMAS reports 1–1.6%/yr) → ≈550 at 39.
export function averageTotalT(age) { const a = num(age, 0, 120) ?? 39; return Math.round(Math.max(300, 600 * Math.pow(0.99, Math.max(0, a - 30)))); }
export const AVERAGE_VITD = 27;          // ng/mL, US adult mean 2011–2014 (Herrick 2019)
export const AVERAGE_SLEEP = 7;
export const AVERAGE_STRESS = 3;

// ======================================================================== testosterone dose-response
// Fit to Bhasin 2001 (20 wk, GnRH-suppressed, no training) group means of mean nadir T vs fat-free mass change:
//   ~250 ng/dL −0.3 kg, ~300 ≈0, ~540 +3.4, ~1,350 +5.2, ~2,400 +7.9 → least squares ΔFFM ≈ 3.53 kg per ln-unit of T.
// Relative to the person's natural level (no therapy = 0), floored at ~300 where the fit crosses zero.
// Time course: saturating, cumulative(w) = A·(1 − e^(−w/τ)), with τ = 12 wk so the fit's 20-week change is reached at 20 wk
//   and most of the long-run change happens in the first ~20 wk (no extrapolation at full rate). Check vs Bhasin 1996
//   (≈550 → ≈2,400 ng/dL, 10 wk, no exercise): model ≈ +3.7 kg vs observed +3.2 kg.
// Training interaction (Bhasin 1996): exercise +1.9, T +3.2, both +6.1 kg → +1.0 kg beyond additive ≈ ×1.53 on the
//   training-driven gain at ln(2400/550) → +0.36 per ln-unit above natural (natural floored at 400, where the low-T penalty ends).
// Fat: fat mass changes inversely with dose (Bhasin 2001); approximated as −1.0 kg per ln-unit per 20 wk (small).
export const T_MODEL = {
  slopeKgPer20Wk: 3.53, zeroT: 300, tauWeeks: 12, refWeeks: 20,
  fatKgPer20Wk: -1.0, ceilPerLn: 0.36, ceilRefFloor: 400,
  studiedMin: 250, studiedMax: 2400, floorT: 50,
  // Training ceiling below the normal range (low T blunts hypertrophy; ≈0.8 at 250 ng/dL), 1.0 from ~400 up.
  lowTCeil: [[100, 0.6], [200, 0.72], [250, 0.8], [300, 0.9], [350, 0.97], [400, 1]],
  points: [[250, -0.3], [300, 0], [540, 3.4], [1350, 5.2], [2400, 7.9]],
};
// Gentle age factor on the direct T effect: Bhasin's subjects were 19–35; older men (60–75) were nearly as responsive
// in Bhasin 2005, so only −0.5%/yr past 35 (floor 0.8).
export function tAgeResponse(age) { const a = num(age, 0, 120); return a == null || a <= 35 ? 1 : Math.max(0.8, 1 - 0.005 * (a - 35)); }

export function testosteroneEffect(totalT, { baselineT = null, weeksOn = 0, age = null } = {}) {
  const M = T_MODEL;
  const raw = num(totalT, 1, 100000);
  const rawBase = num(baselineT, 1, 100000);
  const t0 = raw ?? rawBase ?? averageTotalT(age);
  const beyondStudied = t0 > M.studiedMax;
  const belowStudied = t0 < M.studiedMin;
  const T = clamp(t0, M.floorT, M.studiedMax);
  const B = clamp(rawBase ?? t0, M.floorT, M.studiedMax);
  const onTherapy = rawBase != null && Math.abs(Math.log(T / B)) > 0.005;
  const ageF = tAgeResponse(age);
  const E = x => Math.log(x / M.zeroT);                    // ln-units relative to the fit's zero
  const dLn = E(T) - E(Math.max(B, M.zeroT));
  const lean20 = M.slopeKgPer20Wk * dLn * ageF;             // kg over 20 wk
  const fat20 = M.fatKgPer20Wk * dLn;
  const sat = 1 - Math.exp(-M.refWeeks / M.tauWeeks);
  const A = lean20 / sat, Af = fat20 / sat;                 // asymptotic change (kg)
  // Therapy: time since start. Untreated low natural T: slow chronic drift (the post-20-week tail rate).
  const w = onTherapy ? Math.max(0, num(weeksOn, 0, 1e4) ?? 0) : M.refWeeks;
  const decay = Math.exp(-w / M.tauWeeks);
  const leanRateKg = (A / M.tauWeeks) * decay, fatRateKg = (Af / M.tauWeeks) * decay;
  const cum = onTherapy ? 1 - decay : 0;
  const ceilLowT = interpLog(M.lowTCeil, T);
  const ceilAboveNatural = 1 + M.ceilPerLn * Math.max(0, Math.log(T / Math.max(B, M.ceilRefFloor)));
  const leanCeilingMult = ceilLowT * ceilAboveNatural;
  const leanDirectLbPerWeek = leanRateKg * LB_PER_KG, fatDirectLbPerWeek = fatRateKg * LB_PER_KG;
  let note;
  if (onTherapy) {
    note = `Serum T ${Math.round(T)} vs natural ${Math.round(B)} ng/dL: ${fmtSign(leanDirectLbPerWeek)} lb/week lean without training at week ${r1(w)} (tapering; ≈${fmtSign(lean20 * LB_PER_KG, 1)} lb over 20 weeks per the Bhasin 2001 fit), training ceiling ×${r2(leanCeilingMult)}.`;
  } else if (T < M.zeroT) {
    note = `Natural T ${Math.round(T)} ng/dL is below ~300: training ceiling ×${r2(ceilLowT)} and a slight ongoing lean drift (${fmtSign(leanDirectLbPerWeek, 3)} lb/week).`;
  } else if (T < M.ceilRefFloor) {
    note = `Natural T ${Math.round(T)} ng/dL (low-normal): training ceiling ×${r2(ceilLowT)}.`;
  } else {
    note = `Natural T ${Math.round(T)} ng/dL: within the normal range, natural T level doesn't predict training gains (Morton 2018), so ×1.00.`;
  }
  if (beyondStudied) note += ` Entered ${Math.round(t0)} ng/dL is beyond the studied range (max ~${M.studiedMax}): Forge plateaus there and doesn't extrapolate.`;
  return {
    leanDirectLbPerWeek, fatDirectLbPerWeek, leanCeilingMult, note, beyondStudied, belowStudied,
    levelUsed: T, baselineUsed: B, onTherapy, ageFactor: ageF,
    lean20Lb: lean20 * LB_PER_KG, fat20Lb: fat20 * LB_PER_KG, asymptoteLb: A * LB_PER_KG,
    cumLeanLb: A * cum * LB_PER_KG, cumFatLb: Af * cum * LB_PER_KG, ceilLowT, ceilAboveNatural,
  };
}
// Bhasin 2001 dose → mean nadir serum T (used only when no on-therapy lab is entered).
export function testosteroneFromDose(mgPerWeek) {
  const d = num(mgPerWeek, 0, 1e5); if (d == null) return null;
  return Math.round(interp(SUPPLEMENTS.trt?.model?.doseToLevel || [[0, 0], [600, 2370]], d));
}

// ======================================================================== other level curves
export const SLEEP_CEIL = [[3, 0.78], [4, 0.82], [5, 0.88], [6, 0.95], [7, 1], [9, 1]];
// Lean loss in a deficit: Nedeltcheva 2010 (5.5 h vs 8.5 h) → ~60% more fat-free mass lost.
export const SLEEP_RETENTION = [[4, 1.8], [5, 1.7], [5.5, 1.6], [6, 1.3], [7, 1]];
export const VITD_CEIL = [[5, 0.94], [12, 0.95], [20, 1]];
export function ageCeiling(age) { const a = num(age, 0, 120); return a == null || a <= 35 ? 1 : Math.max(0.8, 1 - 0.004 * (a - 35)); }
export function stressCeiling(s) { const x = num(s, 1, 5) ?? 3; return x <= 3 ? 1 : interp([[3, 1], [4, 0.97], [5, 0.93]], x); }

// ======================================================================== baseline
function ageOf(profile, opts) {
  const a = num(opts?.age, 10, 120);
  if (a != null) return { age: a, assumed: false };
  const by = num(profile?.body?.birthYear, 1900, 2100);
  const d = parseDate(opts?.date) || new Date();
  if (by != null) return { age: d.getFullYear() - by, assumed: false };
  return { age: 39, assumed: true };
}

export function metabolicBaseline(profile, opts = {}) {
  profile = profile && typeof profile === 'object' ? profile : {};
  const m = profile.metabolic && typeof profile.metabolic === 'object' ? profile.metabolic : {};
  const { age, assumed: ageAssumed } = ageOf(profile, opts);
  const factors = [], notes = [], assumptions = [];

  // ---- testosterone (natural)
  const labT = num(m.totalT, 10, 5000), freeT = num(m.freeT, 1, 2000);
  let totalT, totalTSource;
  if (labT != null) { totalT = labT; totalTSource = 'lab'; }
  else if (freeT != null) { totalT = freeT * 5; totalTSource = 'freeT'; notes.push(`Total T estimated from free T (${freeT} pg/mL × 5 ≈ ${Math.round(totalT)} ng/dL). Assays vary, so a total T lab is better.`); }
  else { totalT = averageTotalT(age); totalTSource = 'assumed'; assumptions.push(`Total testosterone: assumed average ≈${totalT} ng/dL for a ${age}-year-old man.`); }
  if (labT != null && freeT != null && freeT < 50 && labT >= 300) notes.push('Low free T with normal total T can happen with high SHBG. Worth discussing with your doctor.');
  const te0 = testosteroneEffect(totalT, { age });
  factors.push({ id: 'testosterone', label: 'Testosterone', mult: r2(te0.leanCeilingMult), note: te0.note, assumed: totalTSource === 'assumed', level: Math.round(totalT) });

  // ---- sleep
  const sl = num(m.sleepHours, 0, 16);
  const sleepHours = sl ?? AVERAGE_SLEEP;
  if (sl == null) assumptions.push(`Sleep: assumed average ${AVERAGE_SLEEP} h.`);
  const sleepMult = interp(SLEEP_CEIL, sleepHours), sleepRet = interp(SLEEP_RETENTION, sleepHours);
  factors.push({ id: 'sleep', label: 'Sleep', mult: r2(sleepMult), retention: r2(sleepRet), assumed: sl == null,
    note: sleepHours < 6 ? `${sleepHours} h is short: lower muscle-building ceiling (×${r2(sleepMult)}), and in a deficit ~${Math.round((sleepRet - 1) * 100)}% more lean is lost (Nedeltcheva 2010: 5.5 h vs 8.5 h shifted diet weight loss from fat to lean).`
      : sleepHours < 7 ? `${sleepHours} h is a bit short: ceiling ×${r2(sleepMult)}, lean loss in a deficit ×${r2(sleepRet)}. 7–9 h is the baseline.`
      : sleepHours > 9 ? `${sleepHours} h: fine for recovery. Regularly needing >9 h can signal illness or overtraining.` : `${sleepHours} h is in the 7–9 h baseline range.` });

  // ---- age
  const ageMult = ageCeiling(age);
  factors.push({ id: 'age', label: 'Age', mult: r2(ageMult), assumed: ageAssumed,
    note: ageAssumed ? 'Age unknown (add birth year in Body profile); assuming 39.' : age <= 35 ? `${age}: no age adjustment.` : `${age}: gentle −0.4%/yr past 35 (testosterone trials used 19–35-year-olds; older lifters still gain well, Peterson 2011 meta-analysis).` });
  if (ageAssumed) assumptions.push('Age: assumed 39 (no birth year in your body profile).');

  // ---- stress
  const st = num(m.stress, 1, 5);
  const stress = st ?? AVERAGE_STRESS;
  if (st == null) assumptions.push(`Stress: assumed average ${AVERAGE_STRESS}/5.`);
  const stressMult = stressCeiling(stress);
  factors.push({ id: 'stress', label: 'Stress', mult: r2(stressMult), assumed: st == null,
    note: stress >= 4 ? `High life stress (${stress}/5) slowed strength gains and recovery in trials (Bartholomew 2008; Stults-Kolehmainen 2014): ×${r2(stressMult)}.` : `Stress ${stress}/5: no adjustment.` });

  // ---- vitamin D
  const vd = num(m.vitD, 1, 300);
  const vitD = vd ?? AVERAGE_VITD;
  if (vd == null) assumptions.push(`Vitamin D: assumed US adult average ≈${AVERAGE_VITD} ng/mL.`);
  const vitDMult = interp(VITD_CEIL, vitD);
  factors.push({ id: 'vitD', label: 'Vitamin D', mult: r2(vitDMult), assumed: vd == null, level: vitD,
    note: vitD < 20 ? `${vitD} ng/mL is deficient (<20): small penalty (×${r2(vitDMult)}). Correcting it may help muscle function a little.` : vitD < 30 ? `${vitD} ng/mL: adequate for muscle by most guidelines (some call <30 "insufficient"); no effect modeled.` : vitD > 100 ? `${vitD} ng/mL is high; levels above ~100–150 risk toxicity. Review your dose.` : `${vitD} ng/mL: sufficient.` });

  // ---- HbA1c / TSH (information; HbA1c in diabetes range = small penalty)
  const a1c = num(m.hba1c, 3, 20), tsh = num(m.tsh, 0.001, 200);
  let a1cMult = 1;
  if (a1c != null) {
    a1cMult = a1c >= 6.5 ? 0.97 : 1;
    factors.push({ id: 'hba1c', label: 'HbA1c', mult: a1cMult, level: a1c,
      note: a1c >= 6.5 ? `${a1c}% is in the diabetes range (≥6.5): see a physician; small ceiling penalty.` : a1c >= 5.7 ? `${a1c}% is prediabetes range (5.7–6.4). Lifting and fat loss improve insulin sensitivity; avoid compounds that raise glucose (MK-677, GH).` : `${a1c}%: normal.` });
  }
  if (tsh != null) {
    factors.push({ id: 'tsh', label: 'TSH', mult: 1, level: tsh,
      note: tsh > 10 ? `${tsh} mIU/L suggests an underactive thyroid: it lowers calorie burn and energy. See a physician; Forge doesn't adjust for it.` : tsh > 4.5 ? `${tsh} mIU/L is mildly high (subclinical range); recheck. Effect on calorie burn is small.` : tsh < 0.4 ? `${tsh} mIU/L is low (possible overactive thyroid, or over-replacement). See a physician.` : `${tsh} mIU/L: normal.` });
  }
  const labDate = parseDate(m.labDate), today = parseDate(opts?.date) || new Date();
  if (labDate && (today - labDate) / 864e5 > 365) notes.push('Your labs are over a year old; values may have changed.');

  const leanCeilingMult = te0.leanCeilingMult * sleepMult * ageMult * stressMult * vitDMult * a1cMult;
  return {
    leanCeilingMult: clamp(leanCeilingMult, 0.4, 1.2), leanRetentionMult: clamp(sleepRet, 0.5, 2.5), partitionShift: 0, tdeeDelta: 0,
    leanDirectLbPerWeek: te0.leanDirectLbPerWeek, fatDirectLbPerWeek: te0.fatDirectLbPerWeek,
    factors, notes, assumptions,
    levels: { totalT: Math.round(totalT), totalTSource, freeT, vitD, vitDSource: vd == null ? 'assumed' : 'lab', hba1c: a1c, tsh, sleepHours, stress, age, ageAssumed },
    _t: te0, _vitDMult: vitDMult,
  };
}

// ======================================================================== stack entries
const MASS_MG = { g: 1000, mg: 1, mcg: 0.001, 'µg': 0.001, ug: 0.001 };
const PERIOD_D = { day: 1, d: 1, daily: 1, week: 7, wk: 7, w: 7 };
function splitUnit(u) {
  const s = String(u || '').toLowerCase().replace(/\s+/g, '').replace('per', '/');
  const [amt, per] = s.split('/');
  return { amt: amt || '', per: per || null };
}
export function convertDose(value, from, to) {
  if (!fin(value)) return null;
  if (!from || !to || from === to) return value;
  const f = splitUnit(from), t = splitUnit(to);
  let v = value;
  if (f.amt !== t.amt) {
    if (MASS_MG[f.amt] && MASS_MG[t.amt]) v = v * MASS_MG[f.amt] / MASS_MG[t.amt];
    else if (f.amt === 'iu' && MASS_MG[t.amt]) v = (v / 40) * 0.001 / MASS_MG[t.amt];      // vitamin D: 40 IU = 1 mcg
    else if (MASS_MG[f.amt] && t.amt === 'iu') v = v * MASS_MG[f.amt] / 0.001 * 40;
    else if (f.amt && t.amt && f.amt !== t.amt) return null;
  }
  if (f.per && t.per && f.per !== t.per) {
    if (PERIOD_D[f.per] && PERIOD_D[t.per]) v = v * PERIOD_D[t.per] / PERIOD_D[f.per]; else return null;
  }
  return v;
}
// Normalises entry.dose ({value, unit} | number | "5 g/day" | null) to the model's unit.
export function resolveDose(entryDose, model) {
  const spec = model?.dose;
  if (!spec) return null;
  let value = null, unit = null;
  if (entryDose && typeof entryDose === 'object') { value = num(entryDose.value, 0, 1e7); unit = entryDose.unit || null; }
  else if (typeof entryDose === 'number') value = num(entryDose, 0, 1e7);
  else if (typeof entryDose === 'string') {
    const mt = entryDose.replace(',', '').match(/([\d.]+)\s*([^\d\s][^\d]*)?/);
    if (mt) { value = num(mt[1], 0, 1e7); unit = mt[2] ? mt[2].trim() : null; }
  }
  if (value != null) {
    const conv = unit ? convertDose(value, unit, spec.unit) : value;
    if (conv != null && fin(conv)) return { value: conv, unit: spec.unit, assumed: false, beyond: conv > spec.studied[1], below: conv < spec.studied[0] && conv > 0 };
  }
  return { value: spec.default, unit: spec.unit, assumed: true, beyond: false, below: false };
}
// Entries in effect on `date` (deduped by id: the earliest-started covering entry wins). `end` is the stop date
// (first day off). Stopped entries (end on/before date) are returned with phase 'stopped' for up to 4 weeks so water can wash out.
export function stackAt(profile, date) {
  const list = Array.isArray(profile?.supplements) ? profile.supplements : [];
  const out = new Map();
  for (const e of list) {
    if (!e || typeof e !== 'object' || !SUPPLEMENTS[e.id]) continue;
    if (e.active === false && !e.end) continue;
    const start = parseDate(e.start) ? e.start.slice(0, 10) : null;
    const end = parseDate(e.end) ? e.end.slice(0, 10) : null;
    if (start && date < start) continue;
    let phase = 'on', weeksOff = 0;
    if (end && date >= end) { weeksOff = weeksBetween(end, date); if (weeksOff > 4) continue; phase = 'stopped'; }   // end = stop date (first day off)
    const weeksOn = start ? Math.max(0, weeksBetween(start, phase === 'on' ? date : end)) : 52;
    const prev = out.get(e.id);
    if (prev) {
      const prevWins = prev.phase === 'on' && phase !== 'on' ? true : prev.phase !== 'on' && phase === 'on' ? false : (prev.start || '') <= (start || '');
      if (prevWins) continue;
    }
    out.set(e.id, { entry: e, item: SUPPLEMENTS[e.id], start, end, phase, weeksOn, weeksOff });
  }
  return [...out.values()];
}

// ======================================================================== modifiers
const BOUND_LABEL = { ceil: 'lean-gain ceiling', ret: 'lean retention', part: 'partitioning', tdee: 'calorie burn', intake: 'appetite', water: 'water weight', leanD: 'direct lean gain', fatD: 'direct fat change' };
const BOUNDS = { ceil: [0.4, 2.0], ret: [0.4, 2.5], part: [-0.1, 0.1], tdee: [-400, 400], intake: [-1200, 600], water: [0, 12], leanD: [-1.0, 2.0], fatD: [-1.0, 0.5] };
const ANABOLIC = new Set(['trt', 'enobosarm', 'lgd4033', 'hgh', 'mk677']);

function rampFrac(weeks, rampW) { return rampW > 0 ? clamp(weeks / rampW, 0, 1) : 1; }
function taperFrac(model, weeks) {
  const after = num(model.taperAfterWeeks, 0, 1e4);
  if (after == null || weeks <= after) return 1;
  const tau = num(model.taperTauWeeks, 0, 1e4) ?? 0;
  return tau > 0 ? Math.exp(-(weeks - after) / tau) : 0;
}

export function modifiersAt(profile, date, opts = {}) {
  profile = profile && typeof profile === 'object' ? profile : {};
  const dateStr = typeof date === 'string' && parseDate(date) ? date.slice(0, 10) : toDs(parseDate(date) || new Date());
  const { inDeficit = false, useStack = true } = opts || {};
  const base = metabolicBaseline(profile, { age: opts?.age, date: dateStr });
  const age = base.levels.age;
  const m = profile.metabolic || {};
  let ceil = base.leanCeilingMult, ret = base.leanRetentionMult, part = 0, tdee = 0, intake = 0, water = 0;
  let leanD = base.leanDirectLbPerWeek, fatD = base.fatDirectLbPerWeek;
  const contributions = [], warnings = [], risks = [], notes = [...base.notes], assumptions = [...base.assumptions];
  let tInfo = { natural: base.levels.totalT, naturalSource: base.levels.totalTSource, level: base.levels.totalT, source: 'natural', effect: base._t };

  // Metabolic factors that change the projection (or are assumed) show up as contributions too (kind:'metabolic').
  for (const f of base.factors) {
    if (Math.abs(f.mult - 1) >= 0.005 || (f.retention && Math.abs(f.retention - 1) >= 0.005) || f.assumed) {
      contributions.push({ id: 'metabolic:' + f.id, name: f.label, evidence: f.id === 'sleep' ? 'strong' : 'moderate', kind: 'metabolic', text: f.note, assumedAverage: !!f.assumed, mult: f.mult });
    }
  }
  if (inDeficit && base.levels.sleepHours < 6) warnings.push(`In a deficit with ~${base.levels.sleepHours} h sleep, more of what you lose is muscle (Nedeltcheva 2010). Sleep is the cheapest lean-mass protector.`);

  const finish = () => {
    const raw = { ceil, ret, part, tdee, intake, water, leanD, fatD };
    const b = {};
    for (const [k, [lo, hi]] of Object.entries(BOUNDS)) { const v = fin(raw[k]) ? raw[k] : (k === 'ceil' || k === 'ret' ? 1 : 0); b[k] = clamp(v, lo, hi); if (Math.abs(b[k] - v) > 1e-9) warnings.push(`Combined ${BOUND_LABEL[k]} effects go beyond anything studied; Forge caps them at ${b[k] === hi ? hi : lo}.`); }
    return {
      leanCeilingMult: Math.round(b.ceil * 1000) / 1000, leanRetentionMult: Math.round(b.ret * 1000) / 1000, partitionShift: b.part, tdeeDelta: Math.round(b.tdee), intakeDelta: Math.round(b.intake),
      waterLb: Math.round(b.water * 100) / 100, leanDirectLbPerWeek: Math.round(b.leanD * 1000) / 1000, fatDirectLbPerWeek: Math.round(b.fatD * 1000) / 1000,
      contributions, warnings: [...new Set(warnings)], risks, notes: [...new Set(notes)], assumptions: [...new Set(assumptions)], factors: base.factors, levels: base.levels,
      testosterone: { natural: tInfo.natural, naturalSource: tInfo.naturalSource, level: Math.round(tInfo.level), source: tInfo.source,
        leanCeilingMult: r2(tInfo.effect.leanCeilingMult), leanDirectLbPerWeek: r2(tInfo.effect.leanDirectLbPerWeek), beyondStudied: tInfo.effect.beyondStudied, note: tInfo.effect.note },
      stackUsed: useStack !== false,
    };
  };
  if (useStack === false) return finish();

  const active = stackAt(profile, dateStr);
  const isOn = id => active.some(a => a.entry.id === id && a.phase === 'on');
  const bw = num(opts?.bodyweightLb, 60, 600) ?? num(profile.bodyweight, 60, 600) ?? 165;
  const labDate = parseDate(m.labDate) ? m.labDate.slice(0, 10) : null;
  const doseText = d => d ? `${+d.value.toFixed(2)} ${d.unit}${d.assumed ? ` (dose not entered: ${d.unit.includes('%') ? 'default' : 'studied/common dose'} assumed)` : ''}` : '';
  const levelRisks = (a, level) => {
    for (const lr of a.item.model?.levelRisks || []) if (level >= lr.min) risks.push({ id: a.item.id, name: a.item.name, text: lr.text });
  };

  // ---- testosterone: TRT (serum level) or herbal shifts → testosteroneEffect
  const trtA = active.find(a => a.entry.id === 'trt' && a.phase === 'on');
  const shifts = active.filter(a => a.item.model?.kind === 'tShift' && a.phase === 'on');
  const te0 = base._t;
  if (trtA) {
    const model = trtA.item.model;
    const dose = resolveDose(trtA.entry.dose, model);
    let level = num(m.onTrtT, 10, 100000), source = 'lab', natural = base.levels.totalT, naturalSource = base.levels.totalTSource;
    const labOnTherapy = labDate && trtA.start && weeksBetween(trtA.start, labDate) >= 2;
    if (level == null && labOnTherapy && base.levels.totalTSource === 'lab') {
      level = base.levels.totalT; source = 'totalT-on-therapy';
      natural = averageTotalT(age); naturalSource = 'assumed';
      notes.push(`Your total T lab (${labDate}) was drawn after starting testosterone, so Forge reads it as your on-therapy level and assumes an average natural level (${natural} ng/dL).`);
      assumptions.push(`Natural testosterone: assumed average ≈${natural} ng/dL (your lab was drawn on therapy).`);
    }
    if (level == null && !dose.assumed) {
      level = testosteroneFromDose(dose.value) ?? 600; source = 'dose';
      warnings.push(`No on-therapy testosterone lab entered: level estimated from your dose (${+dose.value.toFixed(1)} mg/week ≈ ${level} ng/dL mean nadir, Bhasin 2001 dose groups). Enter your trough lab for accuracy.`);
    }
    if (level == null) {
      level = 600; source = 'assumed';
      warnings.push('No on-therapy testosterone lab or dose entered: assuming a mid-normal replacement level (≈600 ng/dL). Enter your trough lab for accuracy.');
    }
    if (naturalSource === 'assumed' && source !== 'totalT-on-therapy') warnings.push(`No natural (pre-therapy) total T entered: assuming the average for your age (≈${natural} ng/dL). Testosterone's effect is measured against your own natural level.`);
    const te = testosteroneEffect(level, { baselineT: natural, weeksOn: trtA.weeksOn, age });
    // swap the natural T factor for the on-therapy one
    const natTe = naturalSource === base.levels.totalTSource ? te0 : testosteroneEffect(natural, { age });
    ceil = ceil / te0.leanCeilingMult * te.leanCeilingMult;
    leanD = leanD - te0.leanDirectLbPerWeek + te.leanDirectLbPerWeek;
    fatD = fatD - te0.fatDirectLbPerWeek + te.fatDirectLbPerWeek;
    if (te.beyondStudied) warnings.push(`Testosterone ${Math.round(num(m.onTrtT, 0) ?? level)} ng/dL is beyond the studied range (~${T_MODEL.studiedMax}): extrapolation not modeled, so Forge plateaus there.`);
    tInfo = { natural, naturalSource, level: te.levelUsed, source, effect: te };
    contributions.push({ id: 'trt', name: trtA.item.name, evidence: trtA.item.evidence, kind: 'stack', dose, rampPct: Math.round(100 * (1 - Math.exp(-trtA.weeksOn / T_MODEL.tauWeeks))),
      assumedAverage: source === 'dose' || source === 'assumed' || naturalSource === 'assumed',
      text: `${te.note} Ceiling vs your natural level ×${r2(te.leanCeilingMult / natTe.leanCeilingMult)}; fat ${fmtSign(te.fatDirectLbPerWeek)} lb/week.${source === 'dose' ? ` Level estimated from dose ${doseText(dose)}.` : ''}` });
    levelRisks(trtA, te.levelUsed);
    if (shifts.length) notes.push('Herbal testosterone boosters (ashwagandha, tongkat ali) do nothing on testosterone therapy, because your own production is suppressed. Ignored.');
    for (const s of shifts) contributions.push({ id: s.item.id, name: s.item.name, evidence: s.item.evidence, kind: 'stack', text: 'No effect while on testosterone therapy (natural production is suppressed).' });
  } else if (shifts.length) {
    let pct = 0, weeks = 0;
    const parts = [];
    for (const s of shifts) {
      const model = s.item.model, dose = resolveDose(s.entry.dose, model);
      const labAfter = labDate && s.start && labDate >= s.start && base.levels.totalTSource === 'lab';
      if (labAfter) { contributions.push({ id: s.item.id, name: s.item.name, evidence: s.item.evidence, kind: 'stack', dose, text: `Your T lab (${labDate}) was drawn while taking it, so its effect is already in your number. Not added again.` }); continue; }
      const resp = clamp(interp(model.response, dose.value), 0, 1);
      const r = rampFrac(s.weeksOn, model.rampWeeks || 0);
      const p = (base.levels.totalT < 350 ? model.tPctLowT : model.tPct) * resp * r;
      pct += p; weeks = Math.max(weeks, s.weeksOn);
      parts.push({ s, dose, p, r });
      if (dose.beyond) warnings.push(`${s.item.name}: ${Math.round(dose.value)} ${dose.unit} is above the studied range; Forge plateaus at the studied dose.`);
    }
    if (pct > 0) {
      const level = base.levels.totalT * (1 + pct / 100);
      const te = testosteroneEffect(level, { baselineT: base.levels.totalT, weeksOn: weeks, age });
      ceil = ceil / te0.leanCeilingMult * te.leanCeilingMult;
      leanD = leanD - te0.leanDirectLbPerWeek + te.leanDirectLbPerWeek;
      fatD = fatD - te0.fatDirectLbPerWeek + te.fatDirectLbPerWeek;
      tInfo = { natural: base.levels.totalT, naturalSource: base.levels.totalTSource, level, source: 'herbal', effect: te };
      for (const { s, dose, p, r } of parts) contributions.push({ id: s.item.id, name: s.item.name, evidence: s.item.evidence, kind: 'stack', dose, rampPct: Math.round(r * 100),
        assumedAverage: base.levels.totalTSource === 'assumed', assumedDose: dose.assumed,
        text: `Total T ${fmtSign(p, 1)}% (${doseText(dose)}, ${Math.round(r * 100)}% of full effect): ≈${Math.round(base.levels.totalT)} → ${Math.round(level)} ng/dL combined. Lean ${fmtSign(te.leanDirectLbPerWeek, 3)} lb/week, ceiling ×${r2(te.leanCeilingMult / te0.leanCeilingMult)} (small, weak evidence).` });
    }
  }

  // ---- everything else
  let anabolicCount = trtA ? 1 : 0;
  for (const a of active) {
    const { item, entry } = a;
    const model = item.model || {};
    if (item.id === 'trt' || model.kind === 'tShift') continue;
    if (a.phase === 'stopped') {
      // only water washes out over ~4 weeks after stopping
      if (model.kind === 'generic' && model.waterLb) {
        const dose = resolveDose(entry.dose, model);
        const resp = clamp(interp(model.response, dose.value), 0, 1.0);
        const rampW = model.rampByDose ? interp(model.rampByDose, dose.value) : (model.rampWeeks || 0);
        const wRamp = rampFrac(a.weeksOn, model.waterRampWeeks ?? rampW);
        const left = Math.max(0, 1 - a.weeksOff / 4);
        water += model.waterLb * resp * wRamp * left;
        contributions.push({ id: item.id, name: item.name, evidence: item.evidence, kind: 'stack', text: `Stopped ${a.end}: extra water washing out (${r1(model.waterLb * resp * wRamp * left)} lb left).` });
      }
      continue;
    }
    if (ANABOLIC.has(item.id)) anabolicCount++;
    if (model.kind === 'none' || !model.kind) {
      contributions.push({ id: item.id, name: item.name, evidence: item.evidence, kind: 'stack', text: `No projected effect: ${model.note || 'not modeled'}` });
      continue;
    }
    const dose = resolveDose(entry.dose, model);
    if (model.kind === 'vitaminD') {
      const labAfter = labDate && a.start && weeksBetween(a.start, labDate) >= 8 && base.levels.vitDSource === 'lab';
      const r = rampFrac(a.weeksOn, model.rampWeeks || 12);
      const d = Math.min(dose.value, model.dose.studied[1]);
      const natural = base.levels.vitD;
      const serum = labAfter ? natural : Math.min(model.maxSerum, natural + (d / 100) * model.ngPer100IU * r);
      const newMult = interp(VITD_CEIL, serum);
      ceil = ceil / base._vitDMult * newMult;
      contributions.push({ id: item.id, name: item.name, evidence: item.evidence, kind: 'stack', dose, rampPct: Math.round(r * 100), assumedAverage: base.levels.vitDSource === 'assumed', assumedDose: dose.assumed,
        text: labAfter ? `Your vitamin D lab was drawn after 8+ weeks on it, so it already reflects the supplement.`
          : `Blood level ≈${r1(natural)} → ${r1(serum)} ng/mL (${doseText(dose)}, ${Math.round(r * 100)}% to steady state).${natural >= 20 ? ' You weren\'t deficient, so no effect on muscle.' : newMult > base._vitDMult ? ` Deficiency penalty shrinks: ceiling ×${r2(newMult / base._vitDMult)}.` : ''}` });
      if (dose.beyond) warnings.push(`Vitamin D ${Math.round(dose.value)} IU/day is above studied doses; Forge plateaus at ${model.dose.studied[1]} IU.`);
      levelRisks(a, dose.value);
      continue;
    }
    // generic dose-response
    const respRaw = interp(model.response, dose.value);
    const resp = Math.max(0, respRaw);
    const rampW = model.rampByDose ? interp(model.rampByDose, dose.value) : (model.rampWeeks || 0);
    const r = rampFrac(a.weeksOn, rampW);
    const rW = rampFrac(a.weeksOn, model.waterRampWeeks ?? rampW);
    const tp = taperFrac(model, a.weeksOn);
    const eff = [];
    if (model.leanCeilingMult) { const f = 1 + (model.leanCeilingMult - 1) * resp * r; ceil *= f; if (Math.abs(f - 1) > 0.001) eff.push(`ceiling ×${r2(f)}`); }
    if (model.leanRetentionMult) { const f = 1 + (model.leanRetentionMult - 1) * resp * r; ret *= f; if (Math.abs(f - 1) > 0.001) eff.push(`lean loss in a deficit ×${r2(f)}`); }
    if (model.partitionShift) { part += model.partitionShift * resp * r; }
    if (model.tdeeDelta) { const v = model.tdeeDelta * resp * r; tdee += v; eff.push(`burn ${fmtSign(Math.round(v), 0)} kcal/day`); }
    if (model.intakePctOfMaint) { const v = model.intakePctOfMaint * bw * 15 * resp * r; intake += v; eff.push(`appetite ${fmtSign(Math.round(v), 0)} kcal/day (if calories aren't user-set)`); }
    else if (model.intakeDelta) { const v = model.intakeDelta * resp * r; intake += v; eff.push(`appetite ${fmtSign(Math.round(v), 0)} kcal/day (if calories aren't user-set)`); }
    if (model.waterLb) { const v = model.waterLb * Math.min(1, resp) * rW; water += v; eff.push(`water +${r1(v)} lb (not muscle or fat)`); }
    if (model.leanDirectLbPerWeek) { const v = model.leanDirectLbPerWeek * Math.min(1, resp) * tp; leanD += v; eff.push(tp > 0 ? `lean ${fmtSign(v, 2)} lb/week without training` : `direct lean effect ended (only ${model.taperAfterWeeks} weeks studied)`); }
    if (model.fatDirectLbPerWeek) { const v = model.fatDirectLbPerWeek * Math.min(1, resp) * r * tp; fatD += v; eff.push(tp > 0 ? `fat ${fmtSign(v, 2)} lb/week` : `direct fat effect ended (only ${model.taperAfterWeeks} weeks studied)`); }
    let extra = '';
    if (model.glp1) extra = ` Trial: −${model.trialLossPct}% body weight at ${model.trialWeeks} wk on the full dose (net of placebo ≈ −${model.netLossPct}%); lean was ~${Math.round(model.leanShareOfLoss * 100)}% of the loss without structured lifting.`;
    if (item.id === 'creatine') extra = r < 1 ? ` Saturating: ${Math.round(r * 100)}% (full in ~${r1(rampW)} wk at this dose).` : ' Muscle stores saturated; more creatine adds nothing.';
    const started = r > 0 || rW > 0 || !(rampW > 0);
    if (!started && item.id === 'creatine') extra = '';
    contributions.push({ id: item.id, name: item.name, evidence: item.evidence, kind: 'stack', dose, rampPct: Math.round(r * 100), assumedDose: dose.assumed,
      text: started ? `${doseText(dose)}: ${eff.join(', ') || 'no change yet'}.${extra}` : `${doseText(dose)}: just started; effects build over ~${r1(rampW)} weeks.${extra}` });
    if (dose.beyond) warnings.push(`${item.name}: ${+dose.value.toFixed(2)} ${dose.unit} is above the studied range; Forge plateaus at the highest studied dose.`);
    levelRisks(a, dose.value);
  }

  // ---- interactions & conflicts
  const glp = ['semaglutide', 'tirzepatide'].filter(isOn);
  const goal = profile.goal;
  if (glp.length && goal === 'lean_bulk') warnings.push('A GLP-1 drug cuts appetite and intake, which works against your lean-bulk goal. Pick one direction (cut with the drug, or bulk without it), and keep protein and lifting high either way.');
  if (glp.length === 2) warnings.push('Semaglutide and tirzepatide are not used together. Choose one.');
  if (glp.length && isOn('adderall')) warnings.push('GLP-1 + Adderall: two appetite suppressants. Hitting protein becomes the main challenge; a large deficit risks muscle loss.');
  if (isOn('mk677')) {
    const a1c = base.levels.hba1c;
    if (a1c == null) warnings.push('MK-677 raises fasting glucose and lowers insulin sensitivity (Nass 2008). Get an HbA1c / fasting glucose baseline and recheck.');
    else if (a1c >= 5.7) warnings.push(`MK-677 with HbA1c ${a1c}%: it raises blood sugar further (Nass 2008). This combination needs a physician's eyes.`);
  }
  if (isOn('hgh') && isOn('mk677')) warnings.push('GH + MK-677: both raise blood sugar and fluid retention, and benefits don\'t stack meaningfully.');
  if (isOn('hgh') && base.levels.hba1c != null && base.levels.hba1c >= 5.7) warnings.push(`GH with HbA1c ${base.levels.hba1c}%: GH worsens insulin resistance.`);
  if (anabolicCount >= 2) warnings.push('Several anabolic agents together: their combined effect was never studied. Forge adds them, which may overstate the result, and side effects compound.');
  if (isOn('adderall')) {
    if (isOn('caffeine')) warnings.push('Adderall + caffeine: heart rate and blood pressure effects add up, and both blunt appetite. Keep caffeine to the morning.');
    if (goal === 'lean_bulk' || num(profile.nutrition?.calories, 500) != null || num(profile.nutrition?.surplus, 1) != null) warnings.push('Adderall blunts appetite: a planned surplus usually fails on medication days. Eat breakfast before the dose, drink calories midday, and make dinner big (Nutrition → Eating on Adderall).');
    if (base.levels.sleepHours < 7) warnings.push('Stimulant timing and short sleep: an earlier dose and no afternoon caffeine protect sleep, and sleep protects muscle.');
  }
  if (isOn('caffeine')) {
    const c = active.find(a => a.entry.id === 'caffeine');
    const d = resolveDose(c.entry.dose, c.item.model);
    if (d.value > 400 && base.levels.sleepHours < 7) warnings.push('High caffeine with short sleep: caffeine late in the day is a likely culprit.');
  }
  if (active.some(a => a.phase === 'on' && /^not fda approved/i.test(a.item.status))) warnings.push('Research-chemical products are unregulated: what\'s in the vial (compound, dose, purity, sterility) isn\'t verified, and the modeled effect assumes the real compound at the studied dose.');
  const trtStopped = active.find(a => a.entry.id === 'trt' && a.phase === 'stopped');
  if (trtStopped) warnings.push('After stopping testosterone, your own production stays suppressed for weeks to months, and some of the gained lean mass and water usually recedes. Forge doesn\'t model the off-period.');

  return finish();
}

// ======================================================================== timeline helper (UI)
export function stackTimeline(profile, { from, weeks = 12, age, bodyweightLb, useStack = true, inDeficit = false } = {}) {
  const start = parseDate(from) || new Date();
  const out = [];
  let lean = 0, fat = 0;
  for (let k = 0; k <= weeks; k++) {
    const d = new Date(start); d.setDate(d.getDate() + 7 * k);
    const mm = modifiersAt(profile, toDs(d), { age, bodyweightLb, useStack, inDeficit });
    if (k < weeks) { lean += mm.leanDirectLbPerWeek; fat += mm.fatDirectLbPerWeek; }
    out.push({ week: k, date: toDs(d), leanCeilingMult: mm.leanCeilingMult, leanRetentionMult: mm.leanRetentionMult, waterLb: mm.waterLb,
      leanDirectLbPerWeek: mm.leanDirectLbPerWeek, fatDirectLbPerWeek: mm.fatDirectLbPerWeek, intakeDelta: mm.intakeDelta, tdeeDelta: mm.tdeeDelta, cumLeanDirect: lean, cumFatDirect: fat });
  }
  const avgCeil = out.slice(0, weeks).reduce((a, w) => a + w.leanCeilingMult, 0) / Math.max(1, weeks);
  return { weeks: out, cumLeanDirect: lean, cumFatDirect: fat, waterEnd: out[out.length - 1].waterLb, waterStart: out[0].waterLb, avgCeiling: avgCeil };
}
