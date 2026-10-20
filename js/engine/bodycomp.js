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
// CONTRACT-NOTE (§16c, ANTHRO-2): bone lengths. Entries may carry lenUpperArmL/R, lenForearmL/R, lenThighL/R,
//   lenShankL/R (inches, surface landmarks; see anthro.js). measurements.lengths = { upperArmL, upperArmR,
//   forearmL, forearmR, thighL, thighR, shankL, shankR } (latest per field, null when unknown; feeds
//   anthro bodyGeometry({ lengths })), measuredOn['lenUpperArmL'…] dates, and baseline.lengthAsymmetry =
//   [{ segment, left, right, diffIn (R − L), longer, note }] for pairs differing by more than 0.25 in
//   (kept separate from the girth `asymmetry` list).
// CONTRACT-NOTE (Phase 3): body fat. Priority stays manual > navy > estimate. The estimate is now the
//   Relative Fat Mass formula (Woolcott & Bergman 2018, height/waist, validated against DEXA) when a
//   waist is known, else Deurenberg's BMI formula. Extra fields: bodyFatMethod ('manual'|'navy'|'rfm'|
//   'bmi'|null), bodyFatSources:{ manual, navy, rfm, bmi } (every available value), bodyFatUncertainty
//   (± points for the chosen value), bodyFatSpread (max − min of the available sources, or null),
//   bodyFatRange:{ low, high }, bodyFatNote (plain English).
// CONTRACT-NOTE (§20b DXA-equivalent scale, supersedes the Phase-3 body-fat note): bodyFatPct is DXA-equivalent. A manual
//   entry's `bodyFatMethod` ('dxa'|'bia'|'calipers'|'other', blank = 'dxa') converts it; a DXA value is used as-is, otherwise
//   every available DXA-scale estimate (manual, one-site Army, Navy, RFM, Deurenberg) is blended by inverse variance.
//   bodyFatMethod: 'manual'|'onesite'|'navy'|'rfm'|'bmi'|'blend'; bodyFatSource: 'manual' if a manual value exists, else 'navy' if
//   neck+waist(+hips) give the Navy estimate, else 'estimate'. bodyFatSources = DXA-scale values { manual, onesite, navy, rfm, bmi },
//   bodyFatSourcesRaw = formula outputs as computed / entered; navyBodyFatPct stays the raw Hodgdon value. bodyFatUncertainty =
//   "likely" ±(≥3.5; ±2 for a DXA scan), bodyFatRange (likely) and bodyFatRange95 (±2×); bodyFatScale 'dxa'; bodyFatManualMethod.
//   Exports BF_DXA, BF_METHODS, oneSiteBodyFat(), toDxaScale().
// CONTRACT-NOTE: tdee() returns extra { neatFactor, days, sessions } and sessionCalories() counts
//   GROSS kcal; tdee() subtracts the resting calories already covered by BMR+NEAT during the
//   session minutes so exercise calories are not double-counted.
// CONTRACT-NOTE (§20 Female mode): baseline() reads sex through sex.js sexOf(); ratios gain waistToHip (both sexes,
//   additive), and female profiles get female-specific missingInfo wording (no V-taper, hips for waist:hip) plus
//   baseline.bodyFatCategory (Gallagher 2000 healthy range for her age) and baseline.femaleStatus (sex.femaleStatus).
//   The formulas were already sex-aware (Navy, Mifflin-St Jeor, RFM, Deurenberg); Katch-McArdle is sex-neutral
//   because it runs on lean mass.
import { estimateCalories } from '../data/cardio.js';
import { sexOf, bodyFatCategory, femaleStatus } from './sex.js';
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
const LENGTHS = ['upperArm', 'forearm', 'thigh', 'shank'];
const LENGTH_LABEL = { upperArm: 'upper arm', forearm: 'forearm', thigh: 'thigh', shank: 'lower leg' };
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
// Female wording where the male text assumes a V-taper physique (§20).
const MISSING_INFO_FEMALE = {
  hips: ['Hips', 'Needed for the female Navy body-fat formula and your waist-to-hip ratio (a WHO health marker: under 0.85 for women).'],
  shoulders: ['Shoulders (around, widest point)', 'Tracks shoulder and upper-back growth on the tape.'],
  chest: ['Chest (bust)', 'Tracks upper-body change. Breast tissue is mostly fat, so this one also moves with fat loss.'],
  arm: ['Arms (flexed)', 'Tracks arm muscle (triceps and biceps) and draws the silhouette.'],
};

function latest(list, key) {
  let best = null;
  for (const e of list) {
    const v = pos(e?.[key]);
    if (v != null && e.d && (!best || e.d >= best.d)) best = { d: e.d, v };
  }
  return best;
}
// Most recent entry carrying `key` → { d, v, e } (e = the whole measurement entry).
function latestEntry(list, key) {
  let best = null;
  for (const e of list) {
    const v = pos(e?.[key]);
    if (v != null && e.d && (!best || e.d >= best.d)) best = { d: e.d, v, e };
  }
  return best;
}
// Most recent of several keys (e.g. thighL or legacy thigh).
function latestOf(list, keys) {
  let best = null;
  for (const k of keys) { const l = latest(list, k); if (l && (!best || l.d > best.d)) best = l; }
  return best;
}

// ---------------------------------------------------------------- DXA-equivalent scale (§20b)
// ONE canonical body-fat scale for both sexes: DXA-equivalent. Formulas built on other references are shifted onto it,
// then blended (docs/research/body-fat-dxa-scale.md). Sources (PubMed):
//  - One-site Army equations (abdomen at the navel + weight), referenced to DXA, 1,259 men / 643 women, externally
//    validated: Taylor KM et al. 2024, Obes Sci Pract 10:e747, doi:10.1002/osp4.747 (men RMSE 3.35, bias −0.39, +1.02 at
//    40+; women RMSE 4.11, bias +0.08). Independent check vs DXA: Florez 2024, Br J Nutr 132:1143, doi:10.1017/S0007114524002216.
//  - Navy/Army (Hodgdon-type) circumference equations read LOW vs DXA: men −4.8 overall and −3.2 at 40+, women −1.7 overall
//    and +1.5 at 40+ (Taylor 2024); −6.0 in both sexes in young recruits (Foulis SA et al. 2023, Front Physiol 14:1183836,
//    doi:10.3389/fphys.2023.1183836) → +3 men (the conservative end), +1.7 women (Taylor's overall bias), wide error.
//    (Potter AW et al. 2022, doi:10.3389/fphys.2022.868627, tested an abdominal-circumference equation, not Hodgdon: −2.5 men.)
//  - RFM was fit to NHANES DXA: validation bias +0.5 (men), +0.9 (women) (Woolcott & Bergman 2018, Sci Rep 8:10980,
//    doi:10.1038/s41598-018-29362-1) → −0.5 / −0.9. (Its waist was taken at the iliac crest, and it is less accurate in lean people.)
//  - Deurenberg was fit to densitometry (Br J Nutr 1991, doi:10.1079/bjn19910073); no DXA validation by sex was found, and
//    BMI equations read 1.8–3.2 HIGH vs a 4-compartment model (Nickerson 2018, J Strength Cond Res, doi:10.1519/JSC.0000000000001774)
//    → offset 0, low weight.
//  - Manual readings: skinfold equations read low vs DXA/4C (Jackson-Pollock 7-site −4.8 vs 4C, Nickerson 2018; female judokas
//    ~+2.7 needed, Pineau 2015, PMID 25678207) → +3 men / +3.5 women; 8-point BIA read −3.6 (men) / −4.3 (women) vs DXA in 1,250
//    adults (Balampanos 2026, Healthcare, doi:10.3390/healthcare14121807) → +3.5 / +4. Both biases are proportional (larger when
//    lean), so a fixed offset is a simplification.
export const BF_DXA = {
  onesite: { male: { a: -27.05, b: 2.06, c: -0.12 }, female: { a: -8.06, b: 1.25, c: -0.004 } },
  onesiteAgeBias: { male: { from: 40, add: -1.0 }, female: null },     // Taylor 2024: men 40+ read +1.02 high
  offset: { navy: { male: 3.0, female: 1.7 }, rfm: { male: -0.5, female: -0.9 }, bmi: { male: 0, female: 0 }, onesite: { male: 0, female: 0 } },
  // ~1 SD error of each DXA-scale estimate (inverse-variance weights): one-site RMSE (Taylor 2024), RFM spread
  // (Woolcott 2018), Navy SD of differences 3.7–4.8 plus offset uncertainty, Deurenberg SEE 4.1 plus reference mismatch.
  se: { onesite: { male: 3.4, female: 4.1 }, rfm: { male: 4.2, female: 4.9 }, navy: { male: 5, female: 5 }, bmi: { male: 6, female: 6 } },
  manual: {
    dxa: { label: 'DXA scan', offset: { male: 0, female: 0 }, se: 2 },
    bia: { label: 'smart-scale (BIA)', offset: { male: 3.5, female: 4.0 }, se: 5 },
    calipers: { label: 'caliper', offset: { male: 3.0, female: 3.5 }, se: 4.5 },
    other: { label: 'body-fat', offset: { male: 0, female: 0 }, se: 5 },
  },
  likelyFloor: 3.5,
};
export const BF_METHODS = ['dxa', 'bia', 'calipers', 'other'];
const manualMethodOf = m => (BF_METHODS.includes(m) ? m : 'dxa');          // unspecified → DXA
// Abdomen (in, at the navel) + weight (lb). `age` applies Taylor's 40+ bias correction for men.
export function oneSiteBodyFat({ sex = 'male', waistIn, weightLb, age = null } = {}) {
  const s = sex === 'female' ? 'female' : 'male', q = BF_DXA.onesite[s], ab = BF_DXA.onesiteAgeBias[s];
  const w = pos(waistIn), wt = pos(weightLb);
  if (!q || !w || !wt) return null;
  const bf = q.a + q.b * w + q.c * wt + (ab && pos(age) != null && pos(age) >= ab.from ? ab.add : 0);
  return Number.isFinite(bf) && bf >= 3 && bf <= 60 ? r1(bf) : null;
}
// Converts a formula output or manual reading to the DXA scale. kind: 'onesite' | 'navy' | 'rfm' | 'bmi' | 'manual'.
export function toDxaScale(kind, value, sex = 'male', manualMethod = 'dxa') {
  const v = num(value); if (!Number.isFinite(v)) return null;
  const s = sex === 'female' ? 'female' : 'male';
  const off = kind === 'manual' ? BF_DXA.manual[manualMethodOf(manualMethod)].offset[s] : (BF_DXA.offset[kind]?.[s] ?? 0);
  return Math.max(2, v + off);
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
  const sex = sexOf(body);
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
  // Bone lengths (surface landmarks), latest per field.
  const lengths = {}, lengthAsymmetry = [];
  for (const seg of LENGTHS) {
    for (const S of ['L', 'R']) {
      const key = 'len' + seg[0].toUpperCase() + seg.slice(1) + S, l = latest(meas, key);
      lengths[seg + S] = l ? l.v : null;
      if (l) measuredOn[key] = l.d;
    }
    const L = lengths[seg + 'L'], R = lengths[seg + 'R'];
    if (L != null && R != null && Math.abs(R - L) > 0.25 + 1e-9) {
      const diff = r2(R - L), longer = diff > 0 ? 'right' : 'left';
      lengthAsymmetry.push({ segment: seg, left: L, right: R, diffIn: diff, longer,
        note: `${longer === 'right' ? 'Right' : 'Left'} ${LENGTH_LABEL[seg]} ${Math.abs(diff)} in longer than ${longer === 'right' ? 'left' : 'right'}. Up to ~0.4 in (1 cm) is common and within tape error on bony landmarks; re-measure both sides twice and average.` });
    }
  }
  measurementsOut.lengths = lengths;

  // Body fat on ONE scale, DXA-equivalent (§20b). Every formula/measurement is converted to the DXA scale, then:
  // a DXA scan (or a manual value with no method) is used as-is; otherwise every available DXA-scale estimate is blended
  // by inverse variance (one-site Army, Navy, RFM, Deurenberg, and a converted smart-scale/caliper reading).
  const manualE = latestEntry(meas, 'bodyFat');
  const manualRaw = manualE && manualE.v < 70 ? manualE.v : null;
  const manualMethod = manualRaw != null ? manualMethodOf(manualE.e.bodyFatMethod) : null;
  const navyBodyFatPct = navyBodyFat({ sex, heightIn, neckIn: measurementsOut.neck, waistIn: measurementsOut.waist, hipsIn: measurementsOut.hips });
  const rfm = rfmBodyFat({ sex, heightIn, waistIn: measurementsOut.waist });
  const bmiEst = bmiBodyFat({ sex, weightLb, heightIn, age });
  const oneSite = oneSiteBodyFat({ sex, waistIn: measurementsOut.waist, weightLb, age });
  const bodyFatSourcesRaw = { manual: manualRaw, onesite: oneSite, navy: navyBodyFatPct, rfm, bmi: bmiEst };
  const dx = (k, v) => (v == null ? null : r1(toDxaScale(k, v, sex, manualMethod)));
  const bodyFatSources = { manual: dx('manual', manualRaw), onesite: dx('onesite', oneSite), navy: dx('navy', navyBodyFatPct), rfm: dx('rfm', rfm), bmi: dx('bmi', bmiEst) };
  const seOf = k => (k === 'manual' ? BF_DXA.manual[manualMethod].se : BF_DXA.se[k][sex]);
  const avail = Object.entries(bodyFatSources).filter(([, v]) => v != null);
  let bodyFatPct = null, bodyFatSource = null, bodyFatDate = null, bodyFatMethod = null, blendSE = null;
  const tapeDate = [measuredOn.neck, measuredOn.waist, sex === 'female' ? measuredOn.hips : null].filter(Boolean).sort().pop() || null;
  if (manualRaw != null && manualMethod === 'dxa') {
    bodyFatPct = bodyFatSources.manual; bodyFatMethod = 'manual'; blendSE = BF_DXA.manual.dxa.se;
  } else if (avail.length) {
    let w = 0, wx = 0;
    for (const [k, v] of avail) { const wi = 1 / seOf(k) ** 2; w += wi; wx += wi * v; }
    bodyFatPct = r1(wx / w); blendSE = 1 / Math.sqrt(w);
    bodyFatMethod = avail.length === 1 ? avail[0][0] : 'blend';
  }
  if (bodyFatPct != null) {
    bodyFatSource = manualRaw != null ? 'manual' : navyBodyFatPct != null ? 'navy' : 'estimate';
    bodyFatDate = manualRaw != null ? manualE.d : navyBodyFatPct != null ? tapeDate : (measuredOn.waist || weightDate);
  }
  const vals = avail.map(([, v]) => v);
  const bodyFatSpread = vals.length >= 2 ? r1(Math.max(...vals) - Math.min(...vals)) : null;
  let bodyFatUncertainty = null, bodyFatRange = null, bodyFatRange95 = null, bodyFatNote = null;
  if (bodyFatPct != null) {
    // "Likely" (~1 SD) range: at least ±3.5 for tape/scale estimates (they share the same waist tape, so blending them
    // doesn't really shrink the error), ±2 for a DXA scan; widened to half the disagreement between methods. 95 % ≈ 2×.
    const floor = bodyFatMethod === 'manual' && manualMethod === 'dxa' ? BF_DXA.manual.dxa.se : BF_DXA.likelyFloor;
    bodyFatUncertainty = r1(Math.max(floor, blendSE, bodyFatMethod === 'manual' && manualMethod === 'dxa' || bodyFatSpread == null ? 0 : bodyFatSpread / 2));
    bodyFatRange = { low: r1(Math.max(3, bodyFatPct - bodyFatUncertainty)), high: r1(bodyFatPct + bodyFatUncertainty) };
    bodyFatRange95 = { low: r1(Math.max(3, bodyFatPct - 2 * bodyFatUncertainty)), high: r1(bodyFatPct + 2 * bodyFatUncertainty) };
    const NAME = { manual: `your ${BF_DXA.manual[manualMethod || 'dxa'].label}`, onesite: 'the one-site Army waist formula', navy: 'the US Navy tape formula', rfm: 'waist-to-height (Relative Fat Mass)', bmi: 'BMI and age (Deurenberg)' };
    const SHORT = { manual: 'entered', onesite: 'Army waist', navy: 'Navy tape', rfm: 'waist/height', bmi: 'BMI' };
    const label = bodyFatMethod === 'blend' ? `a blend of ${avail.map(([k]) => NAME[k]).join(', ')}` : NAME[bodyFatMethod];
    const others = avail.filter(([k]) => bodyFatMethod === 'blend' || k !== bodyFatMethod).map(([k, v]) => `${SHORT[k]} ${v}%`);
    bodyFatNote = `Body fat ${bodyFatPct}% (DXA-equivalent) from ${label}: likely ±${bodyFatUncertainty} points, about ±${r1(2 * bodyFatUncertainty)} at 95%.` +
      (others.length ? ` ${bodyFatMethod === 'blend' ? 'Each on the DXA scale' : 'Other estimates on the DXA scale'}: ${others.join(', ')}${bodyFatSpread != null && bodyFatSpread > 4 ? '. They disagree by more than 4 points, so treat the starting point as uncertain' : ''}.` : '') +
      ' Every method is converted to the DXA scale so tape, smart-scale and scan numbers compare directly.' +
      (manualRaw != null && manualMethod !== 'dxa' ? ` Your ${BF_DXA.manual[manualMethod].label} reading of ${manualRaw}% counts as ${bodyFatSources.manual}% on the DXA scale.` : '');
  }

  const comp = weightLb ? bodyComp({ weightLb, heightIn, bodyFatPct, age, sex, waistIn: measurementsOut.waist }) : null;
  const m = measurementsOut;
  const ratio = (a, b) => (a && b ? r2(a / b) : null);
  const ratios = {
    shoulderToWaist: ratio(m.shoulders, m.waist),
    chestToWaist: ratio(m.chest, m.waist),
    waistToHeight: ratio(m.waist, heightIn),
    armToWaist: ratio(m.arm, m.waist),
    waistToHip: ratio(m.waist, m.hips),
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
  const info = f => (sex === 'female' && MISSING_INFO_FEMALE[f]) || MISSING_INFO[f];
  const missingInfo = missing.map(f => ({ field: f, label: info(f)[0], why: info(f)[1] }));
  const femaleExtra = sex === 'female' ? { bodyFatCategory: bodyFatCategory(bodyFatPct, { sex, age }), femaleStatus: femaleStatus(profile, { age }) } : {};

  return {
    date: today, weightLb: weightLb != null ? r1(weightLb) : null, weightDate, heightIn: heightIn ?? null, age, sex,
    bodyFatPct, bodyFatSource, bodyFatDate, bodyFatEstimated: bodyFatSource === 'estimate', navyBodyFatPct,
    bodyFatMethod, bodyFatSources, bodyFatSourcesRaw, bodyFatUncertainty, bodyFatSpread, bodyFatRange, bodyFatRange95, bodyFatNote,
    bodyFatScale: 'dxa', bodyFatManualMethod: manualMethod,
    measurements: measurementsOut, measuredOn, asymmetry, lengthAsymmetry, comp, ratios, missing, missingInfo,
    weighIns30: log.filter(e => e.d >= ds(addDays(parseDs(today), -30))).length, weighInCount: log.length, measurementCount: meas.length,
    ...femaleExtra,
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
