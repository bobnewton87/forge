// Body composition math. Pure, DOM-free (CONTRACT §13).
//
// CONTRACT-NOTE: bodyComp() also accepts an optional `waistIn` (for waistToHeight) and returns
//   extra fields: bmrMethod ('katch'|'mifflin'|'weight'), ageAssumed (true when age was missing and
//   DEFAULT_AGE was used), leanKg, heightM.
// CONTRACT-NOTE: baseline() returns extra fields:
//   weightDate, bodyFatDate, navyBodyFatPct (navy result even when a manual value wins),
//   measuredOn:{site:'YYYY-MM-DD'}, missingInfo:[{ field, label, why }] (same fields as `missing`,
//   with plain-English reasons), bodyFatEstimated (true when bodyFatSource === 'estimate'),
//   weighIns30 / weighInCount / measurementCount (data-quantity counts used for projection confidence).
// CONTRACT-NOTE (Phase 3): L/R limbs. Entries may carry armL/armR, thighL/thighR, calfL/calfR; legacy
//   `arm`/`thigh`/`calf` count as BOTH sides. Per side the most recent value wins. measurements.arm /
//   .thigh / .calf = average of the two sides (used by the model); measurements.limbs = { armL, armR,
//   thighL, thighR, calfL, calfR } (null when unknown); baseline.asymmetry = [{ site, left, right,
//   diff, note }] for any pair differing by more than 0.5 in.
// CONTRACT-NOTE (Phase 3): body fat. Priority stays manual > navy > estimate. The estimate is now the
//   Relative Fat Mass formula (Woolcott & Bergman 2018, height/waist, validated against DEXA) when a
//   waist is known, else Deurenberg's BMI formula. Extra fields: bodyFatMethod ('manual'|'navy'|'rfm'|
//   'bmi'|null), bodyFatSources:{ manual, navy, rfm, bmi } (every available value), bodyFatUncertainty
//   (± points for the chosen value), bodyFatSpread (max − min of the available sources, or null),
//   bodyFatRange:{ low, high }, bodyFatNote (plain English).
// CONTRACT-NOTE: tdee() returns extra { neatFactor, days, sessions } and sessionCalories() counts
//   GROSS kcal; tdee() subtracts the resting calories already covered by BMR+NEAT during the
//   session minutes so exercise calories are not double-counted.
import { estimateCalories } from '../data/cardio.js';
import { ds, parseDs, addDays, daysBetween } from '../util.js';

const LB_PER_KG = 2.20462;
const CM_PER_IN = 2.54;
export const DEFAULT_AGE = 35;

// BMR multiplier for NEAT (non-exercise movement) + thermic effect of food, on top of BMR.
// desk ≈ classic "sedentary" 1.2 plus ~0.1 for TEF.
export const NEAT_FACTORS = { desk: 0.3, light: 0.45, active: 0.6 };

// Approximate METs per Crunch class type (Compendium of Physical Activities ranges).
const CLASS_METS = { hiit: 8, cycle: 8.5, cardio_dance: 6.5, strength: 5, sculpt: 4.5, core: 3.8, boxing: 7.5,
  yoga: 3, pilates: 3.5, stretch: 2.5, other: 5 };
const INTENSITY_SCALE = { easy: 0.85, moderate: 1, hard: 1.1, intervals: 1.1 };

const num = x => (typeof x === 'number' ? x : x == null || x === '' ? NaN : Number(x));
const pos = x => { const n = num(x); return Number.isFinite(n) && n > 0 ? n : null; };
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const toDate = now => (now instanceof Date ? now : now ? new Date(now) : new Date());

// ---------------------------------------------------------------- Navy
// US Navy circumference method (Hodgdon & Beckett 1984), inches. Typical error ≈ ±3-4 % BF.
export function navyBodyFat({ sex = 'male', heightIn, neckIn, waistIn, hipsIn } = {}) {
  const h = pos(heightIn), n = pos(neckIn), w = pos(waistIn);
  if (!h || !n || !w) return null;
  let bf;
  if (sex === 'female') {
    const hp = pos(hipsIn);
    if (!hp || w + hp - n <= 0) return null;
    bf = 163.205 * Math.log10(w + hp - n) - 97.684 * Math.log10(h) - 78.387;
  } else {
    if (w - n <= 0) return null;
    bf = 86.010 * Math.log10(w - n) - 70.041 * Math.log10(h) + 36.76;
  }
  if (!Number.isFinite(bf) || bf < 2 || bf > 65) return null;
  return r1(bf);
}

// ---------------------------------------------------------------- bodyComp
export function bodyComp({ weightLb, heightIn, bodyFatPct, age, sex = 'male', waistIn } = {}) {
  const w = pos(weightLb), h = pos(heightIn);
  const bfRaw = pos(bodyFatPct);
  const bf = bfRaw != null && bfRaw < 70 ? bfRaw : null;
  const a = pos(age);
  const out = { weightLb: w != null ? r1(w) : null, bodyFatPct: bf != null ? r1(bf) : null, leanLb: null, fatLb: null,
    bmi: null, ffmi: null, ffmiNormalized: null, bmr: null, bmrMethod: null, ageAssumed: false, leanKg: null, heightM: null };
  if (w == null) return out;
  const kg = w / LB_PER_KG;
  const m = h != null ? (h * CM_PER_IN) / 100 : null;
  out.heightM = m != null ? r2(m) : null;
  if (m) out.bmi = r1(kg / (m * m));
  if (bf != null) {
    const leanLb = w * (1 - bf / 100);
    out.leanLb = r1(leanLb);
    out.fatLb = r1(w - leanLb);
    out.leanKg = r1(leanLb / LB_PER_KG);
    if (m) {
      const ffmi = (leanLb / LB_PER_KG) / (m * m);
      out.ffmi = r1(ffmi);
      out.ffmiNormalized = r1(ffmi + 6.1 * (1.8 - m));
    }
    out.bmr = Math.round(370 + 21.6 * (leanLb / LB_PER_KG));        // Katch-McArdle
    out.bmrMethod = 'katch';
  } else if (m) {
    const age_ = a ?? DEFAULT_AGE;
    out.ageAssumed = a == null;
    out.bmr = Math.round(10 * kg + 6.25 * m * 100 - 5 * age_ + (sex === 'female' ? -161 : 5));   // Mifflin-St Jeor
    out.bmrMethod = 'mifflin';
  } else {
    out.bmr = Math.round(kg * (sex === 'female' ? 20 : 22));           // crude fallback (no height, no BF)
    out.bmrMethod = 'weight';
  }
  const wa = pos(waistIn);
  if (wa != null && h != null) out.waistToHeight = r2(wa / h);
  return out;
}

// ---------------------------------------------------------------- baseline
const SITES = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'arm', 'forearm', 'thigh', 'calf'];
const LIMBS = ['arm', 'thigh', 'calf'];
// Typical error (± BF points, ~1 SD) of each method vs a lab reference.
const BF_ERR = { manual: 3, navy: 3.5, rfm: 4, bmi: 5.5 };

const MISSING_INFO = {
  weight: ['Bodyweight', 'Everything starts from your weight: lean/fat split, calorie burn and the projection.'],
  height: ['Height', 'Needed for BMI, FFMI, the Navy body-fat formula and BMR.'],
  birthYear: ['Birth year', 'Age refines BMR when body fat is unknown (a default of 35 is used otherwise).'],
  neck: ['Neck', 'Needed with waist and height for the Navy body-fat estimate.'],
  waist: ['Waist (at the navel)', 'The best single tape measure of fat loss; needed for the Navy body-fat estimate.'],
  hips: ['Hips', 'Needed for the female Navy body-fat formula.'],
  shoulders: ['Shoulders (around, widest point)', 'Needed for the shoulder-to-waist (V-taper) ratio and its milestones.'],
  chest: ['Chest', 'Tracks upper-body growth and the chest-to-waist ratio.'],
  arm: ['Arms (flexed)', 'Tracks arm growth and draws the silhouette.'],
  thigh: ['Thigh', 'Draws the silhouette and tracks leg size.'],
  bodyFat: ['Body fat %', 'Without a measured or Navy body fat, a waist- or BMI-based estimate is used, which can be off by 4-6 points for muscular or very lean people.'],
};

function latest(list, key) {
  let best = null;
  for (const e of list) {
    const v = pos(e?.[key]);
    if (v != null && e.d && (!best || e.d >= best.d)) best = { d: e.d, v };
  }
  return best;
}
// Most recent of several keys (e.g. thighL or legacy thigh).
function latestOf(list, keys) {
  let best = null;
  for (const k of keys) { const l = latest(list, k); if (l && (!best || l.d > best.d)) best = l; }
  return best;
}

// Relative Fat Mass (Woolcott & Bergman 2018): 64 − 20 × height/waist (+12 for women).
export function rfmBodyFat({ sex = 'male', heightIn, waistIn } = {}) {
  const h = pos(heightIn), w = pos(waistIn);
  if (!h || !w) return null;
  const bf = 64 - 20 * (h / w) + (sex === 'female' ? 12 : 0);
  return Number.isFinite(bf) && bf >= 3 && bf <= 60 ? r1(bf) : null;
}
// Deurenberg 1991 BMI-based adult formula.
export function bmiBodyFat({ sex = 'male', weightLb, heightIn, age } = {}) {
  const w = pos(weightLb), h = pos(heightIn);
  if (!w || !h) return null;
  const bmi = (w / LB_PER_KG) / ((h * CM_PER_IN / 100) ** 2);
  const est = 1.2 * bmi + 0.23 * (pos(age) ?? DEFAULT_AGE) - 10.8 * (sex === 'male' ? 1 : 0) - 5.4;
  return Number.isFinite(est) ? r1(Math.max(4, Math.min(55, est))) : null;
}

export function baseline({ profile = {}, bodyLog = [], measurements = [], now = new Date() } = {}) {
  const today = ds(toDate(now));
  const body = profile?.body || {};
  const sex = body.sex === 'female' ? 'female' : 'male';
  const log = (Array.isArray(bodyLog) ? bodyLog : []).filter(e => e && e.d && e.d <= today && pos(e.w) != null);
  const meas = (Array.isArray(measurements) ? measurements : []).filter(e => e && e.d && e.d <= today);

  // Weight: latest weigh-in, else profile.bodyweight.
  let weightLb = null, weightDate = null;
  if (log.length) {
    const last = log.reduce((a, b) => (b.d >= a.d ? b : a));
    weightLb = Number(last.w); weightDate = last.d;
  } else if (pos(profile?.bodyweight) != null) {
    weightLb = Number(profile.bodyweight);
  }

  const heightIn = pos(body.heightIn);
  const birthYear = pos(body.birthYear);
  const age = birthYear ? toDate(now).getFullYear() - birthYear : null;

  // Latest value per site; limbs: per side (side key or legacy both-sides key), then averaged.
  const measurementsOut = {}, measuredOn = {};
  for (const s of SITES) {
    if (LIMBS.includes(s)) continue;
    const l = latest(meas, s);
    measurementsOut[s] = l ? l.v : null;
    if (l) measuredOn[s] = l.d;
  }
  const limbs = {};
  const asymmetry = [];
  for (const s of LIMBS) {
    const L = latestOf(meas, [s + 'L', s]), R = latestOf(meas, [s + 'R', s]);
    limbs[s + 'L'] = L ? L.v : null; limbs[s + 'R'] = R ? R.v : null;
    if (L && R) {
      measurementsOut[s] = r2((L.v + R.v) / 2); measuredOn[s] = L.d > R.d ? L.d : R.d;
      const diff = r2(L.v - R.v);
      if (Math.abs(diff) > 0.5) {
        const big = diff > 0 ? 'left' : 'right';
        const name = { arm: 'arm', thigh: 'thigh', calf: 'calf' }[s];
        asymmetry.push({ site: s, left: L.v, right: R.v, diff,
          note: `Your ${big} ${name} measures ${Math.abs(diff)} in bigger. Up to ~0.5 in is normal (dominant side, or tape placement). More than that is worth re-measuring; if it is real, start unilateral work with the smaller side and match its reps on the bigger side.` });
      }
    } else if (L || R) { const x = L || R; measurementsOut[s] = x.v; measuredOn[s] = x.d; }   // one side only
    else measurementsOut[s] = null;
  }
  measurementsOut.limbs = limbs;

  // Body fat: manual > navy > estimate (RFM if a waist is known, else Deurenberg BMI formula).
  const manual = latest(meas, 'bodyFat');
  const navyBodyFatPct = navyBodyFat({ sex, heightIn, neckIn: measurementsOut.neck, waistIn: measurementsOut.waist, hipsIn: measurementsOut.hips });
  const rfm = rfmBodyFat({ sex, heightIn, waistIn: measurementsOut.waist });
  const bmiEst = bmiBodyFat({ sex, weightLb, heightIn, age });
  let bodyFatPct = null, bodyFatSource = null, bodyFatDate = null, bodyFatMethod = null;
  if (manual && manual.v < 70) { bodyFatPct = manual.v; bodyFatSource = 'manual'; bodyFatMethod = 'manual'; bodyFatDate = manual.d; }
  else if (navyBodyFatPct != null) {
    bodyFatPct = navyBodyFatPct; bodyFatSource = 'navy'; bodyFatMethod = 'navy';
    bodyFatDate = [measuredOn.neck, measuredOn.waist, sex === 'female' ? measuredOn.hips : null].filter(Boolean).sort().pop() || null;
  } else if (rfm != null) {
    bodyFatPct = rfm; bodyFatSource = 'estimate'; bodyFatMethod = 'rfm'; bodyFatDate = measuredOn.waist || weightDate;
  } else if (bmiEst != null) {
    bodyFatPct = bmiEst; bodyFatSource = 'estimate'; bodyFatMethod = 'bmi'; bodyFatDate = weightDate;
  }
  const bodyFatSources = { manual: manual && manual.v < 70 ? manual.v : null, navy: navyBodyFatPct, rfm, bmi: bmiEst };
  const avail = Object.values(bodyFatSources).filter(v => v != null);
  const bodyFatSpread = avail.length >= 2 ? r1(Math.max(...avail) - Math.min(...avail)) : null;
  let bodyFatUncertainty = null, bodyFatRange = null, bodyFatNote = null;
  if (bodyFatPct != null) {
    const own = BF_ERR[bodyFatMethod];
    // If the methods disagree a lot, widen the uncertainty (at least half of the disagreement).
    bodyFatUncertainty = r1(Math.max(own, bodyFatSpread != null ? bodyFatSpread / 2 : 0));
    bodyFatRange = { low: r1(Math.max(3, bodyFatPct - bodyFatUncertainty)), high: r1(bodyFatPct + bodyFatUncertainty) };
    const label = { manual: 'the value you entered', navy: 'the US Navy tape formula', rfm: 'your waist-to-height ratio (Relative Fat Mass formula)', bmi: 'your BMI and age (Deurenberg formula)' }[bodyFatMethod];
    const others = Object.entries(bodyFatSources).filter(([k, v]) => v != null && k !== bodyFatMethod)
      .map(([k, v]) => `${{ manual: 'entered', navy: 'Navy tape', rfm: 'waist/height', bmi: 'BMI' }[k]} ${v}%`);
    bodyFatNote = `Body fat ${bodyFatPct}% from ${label}, about ±${bodyFatUncertainty} points.` +
      (others.length ? ` Other estimates: ${others.join(', ')}${bodyFatSpread != null && bodyFatSpread > 4 ? '. They disagree by more than 4 points, so treat the starting point as uncertain' : ''}.` : '') +
      (bodyFatMethod === 'manual' ? ' A DEXA scan is good to ~±2; home bioimpedance scales can be off by 4-5 and swing with hydration.' : '');
  }

  const comp = weightLb ? bodyComp({ weightLb, heightIn, bodyFatPct, age, sex, waistIn: measurementsOut.waist }) : null;
  const m = measurementsOut;
  const ratio = (a, b) => (a && b ? r2(a / b) : null);
  const ratios = {
    shoulderToWaist: ratio(m.shoulders, m.waist),
    chestToWaist: ratio(m.chest, m.waist),
    waistToHeight: ratio(m.waist, heightIn),
    armToWaist: ratio(m.arm, m.waist),
  };

  const missing = [];
  if (!weightLb) missing.push('weight');
  if (!heightIn) missing.push('height');
  if (!birthYear && bodyFatSource !== 'manual' && bodyFatSource !== 'navy') missing.push('birthYear');
  if (!m.neck) missing.push('neck');
  if (!m.waist) missing.push('waist');
  if (sex === 'female' && !m.hips) missing.push('hips');
  if (!m.shoulders) missing.push('shoulders');
  if (!m.chest) missing.push('chest');
  if (!m.arm) missing.push('arm');
  if (!m.thigh) missing.push('thigh');
  if (bodyFatSource !== 'manual' && bodyFatSource !== 'navy') missing.push('bodyFat');
  const missingInfo = missing.map(f => ({ field: f, label: MISSING_INFO[f][0], why: MISSING_INFO[f][1] }));

  return {
    date: today, weightLb: weightLb != null ? r1(weightLb) : null, weightDate, heightIn: heightIn ?? null, age, sex,
    bodyFatPct, bodyFatSource, bodyFatDate, bodyFatEstimated: bodyFatSource === 'estimate', navyBodyFatPct,
    bodyFatMethod, bodyFatSources, bodyFatUncertainty, bodyFatSpread, bodyFatRange, bodyFatNote,
    measurements: measurementsOut, measuredOn, asymmetry, comp, ratios, missing, missingInfo,
    weighIns30: log.filter(e => e.d >= ds(addDays(parseDs(today), -30))).length, weighInCount: log.length, measurementCount: meas.length,
  };
}

// ---------------------------------------------------------------- calories
function sessionMinutes(s) {
  if (s?.startedAt && s?.endedAt) {
    const m = (new Date(s.endedAt) - new Date(s.startedAt)) / 60000;
    if (Number.isFinite(m) && m > 5 && m < 240) return m;
  }
  return pos(s?.minutes);
}

// Gross kcal for one session. Done sessions count only completed work; planned sessions count everything.
// Also returns minutes through sessionCalories.detail(), used by tdee().
function sessionDetail(session, { weightLb } = {}) {
  const wt = pos(weightLb) ?? 165;
  const kg = wt / LB_PER_KG;
  const done = session?.status === 'done';
  let kcal = 0, minutes = 0, liftSets = 0, otherMin = 0;
  for (const b of session?.blocks || []) {
    if (b.kind === 'cardio') {
      if (done && !b.done) continue;
      const min = pos(b.minutes) ?? 0;
      let k = done && pos(b.calories) != null ? Number(b.calories) : estimateCalories(b.modality, min, b.intensity || 'moderate', wt);
      if (!(k > 0) && min > 0) k = 6 * kg * min / 60;                  // unknown modality → ~6 METs
      kcal += k; minutes += min; otherMin += min;
    } else if (b.kind === 'class') {
      if (done && !b.done) continue;
      const dur = pos(b.duration) ?? 45;
      const ci = b.classify || {};
      const mets = (CLASS_METS[ci.type] ?? 5) * (INTENSITY_SCALE[ci.intensity] ?? 1);
      kcal += mets * kg * dur / 60; minutes += dur; otherMin += dur;
    } else if (b.kind === 'lift') {
      const sets = Array.isArray(b.sets) ? b.sets : [];
      const n = done ? sets.filter(x => x && x.done && Number(x.r) > 0).length : (sets.length || pos(b.target?.sets) || 0);
      liftSets += n;
    }
  }
  if (liftSets > 0) {
    // Lift time: the session's time budget minus cardio/class minutes, else ~2.5 min per set.
    const total = sessionMinutes(session);
    let liftMin = total != null ? total - otherMin : liftSets * 2.5;
    if (!(liftMin > 0)) liftMin = liftSets * 2.5;
    liftMin = Math.min(liftMin, liftSets * 5);                           // don't credit long idle sessions
    const density = liftSets / liftMin;                                   // sets per minute (~0.3-0.5)
    const rate = Math.max(4, Math.min(6, 3.5 + density * 5)) * (wt / 165);
    kcal += rate * liftMin; minutes += liftMin;
  }
  return { kcal: Math.round(kcal), minutes: Math.round(minutes) };
}

export function sessionCalories(session, { weightLb } = {}) {
  return sessionDetail(session, { weightLb }).kcal;
}

// Average kcal/day over [from, to] (inclusive). Defaults to the last 28 days. Counts done sessions,
// plus planned ones dated today or later (pass a filtered list to change that).
export function tdee({ comp, activity = 'desk', sessions = [], from, to, now = new Date() } = {}) {
  const today = ds(toDate(now));
  const toS = to || today;
  const fromS = from || ds(addDays(parseDs(toS), -27));
  const days = Math.max(1, daysBetween(fromS, toS) + 1);
  const bmr = pos(comp?.bmr) ?? (pos(comp?.weightLb) ? Math.round(pos(comp.weightLb) / LB_PER_KG * 22) : 0);
  const neatFactor = NEAT_FACTORS[activity] ?? NEAT_FACTORS.desk;
  const neat = bmr * neatFactor;
  const restPerMin = (bmr + neat) / 1440;
  let ex = 0, count = 0;
  for (const s of sessions || []) {
    if (!s || !s.date || s.date < fromS || s.date > toS) continue;
    if (s.status !== 'done' && !(s.status === 'planned' && s.date >= today)) continue;
    const d = sessionDetail(s, { weightLb: comp?.weightLb });
    if (d.kcal <= 0) continue;
    ex += Math.max(0, d.kcal - restPerMin * d.minutes);
    count++;
  }
  const exercise = ex / days;
  return { bmr: Math.round(bmr), neat: Math.round(neat), exercise: Math.round(exercise), total: Math.round(bmr + neat + exercise),
    neatFactor, days, sessions: count };
}

// Internal helper for projection.js (net exercise kcal for one session at a given weight/BMR).
export function _sessionDetail(session, opts) { return sessionDetail(session, opts); }
