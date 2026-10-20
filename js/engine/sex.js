// Sex-specific constants and helpers (FEMALE mode, CONTRACT §20). Pure, DOM-free.
//
// ONE place that answers "is this person modeled as female?" and holds every number that differs by sex.
// Engines (bodycomp, projection, metabolic, nutrition, targets) and the UI read it from here instead of
// scattering `=== 'female'` checks. Male values are exactly the constants the engines used before female
// mode existed, so male results are unchanged. Every female number cites its study (DOI); the full write-up
// is docs/research/female-physiology.md.
//
// CONTRACT-NOTE (§20): optional profile.body fields (all optional; blank = sensible default, flagged as assumed):
//   sex: 'male' | 'female'
//   menopause: null | 'pre' | 'peri' | 'post'          (null → inferred from age: <45 pre, 45–54 peri, ≥55 post)
//   contraception: null | 'none' | 'combined' | 'progestin' | 'hormonal_iud' | 'copper_iud' | 'other'
//   hormoneTherapy: null | 'none' | 'estrogen' | 'estrogen_progestogen'    (menopausal hormone therapy, MHT)
//   pregnancy: null | 'none' | 'pregnant' | 'postpartum' | 'breastfeeding'

export const SEXES = ['male', 'female'];

// Accepts a profile ({ body: { sex } }), a body ({ sex }), a baseline ({ sex }) or a string. Anything else = male
// (the app's original default).
export function sexOf(x) {
  const s = typeof x === 'string' ? x : x && typeof x === 'object' ? (x.body && typeof x.body === 'object' && x.body.sex != null ? x.body.sex : x.sex) : null;
  return s === 'female' ? 'female' : 'male';
}
export const isFemale = x => sexOf(x) === 'female';

const num = x => (x == null || x === '' || typeof x === 'boolean' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
function interp(anchors, x) {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (x <= x1) { const [x0, y0] = anchors[i - 1]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  }
  return anchors[anchors.length - 1][1];
}

// ---------------------------------------------------------------- female status
export const MENOPAUSE = ['pre', 'peri', 'post'];
export const CONTRACEPTION = ['none', 'combined', 'progestin', 'hormonal_iud', 'copper_iud', 'other'];
export const HORMONE_THERAPY = ['none', 'estrogen', 'estrogen_progestogen'];
export const PREGNANCY = ['none', 'pregnant', 'postpartum', 'breastfeeding'];
export const FEMALE_LABELS = {
  menopause: { pre: 'Premenopausal', peri: 'Perimenopause', post: 'Postmenopausal' },
  contraception: { none: 'None', combined: 'Combined (pill/patch/ring)', progestin: 'Progestin-only', hormonal_iud: 'Hormonal IUD', copper_iud: 'Copper IUD', other: 'Other' },
  hormoneTherapy: { none: 'None', estrogen: 'Estrogen', estrogen_progestogen: 'Estrogen + progestogen' },
  pregnancy: { none: 'No', pregnant: 'Pregnant', postpartum: 'Postpartum', breastfeeding: 'Breastfeeding' },
};

// Ages for the inferred menopause stage when it isn't set. STRAW+10 defines the stages by cycles and FSH, not age
// (Harlow 2012, Menopause 19:387, doi:10.1097/gme.0b013e31824d8f40); these cut-offs are Forge's assumption.
const MENO_AGE = { peri: 45, post: 55 };
export function femaleStatus(profile, { age = null } = {}) {
  const b = profile && typeof profile === 'object' ? (profile.body && typeof profile.body === 'object' ? profile.body : profile) : {};
  const female = sexOf(profile) === 'female';
  let a = num(age);
  if (a == null && num(b.birthYear) != null) a = new Date().getFullYear() - num(b.birthYear);
  let menopause = MENOPAUSE.includes(b.menopause) ? b.menopause : null, menopauseAssumed = false;
  if (!menopause) { menopauseAssumed = true; menopause = a == null || a < MENO_AGE.peri ? 'pre' : a < MENO_AGE.post ? 'peri' : 'post'; }
  const contraception = CONTRACEPTION.includes(b.contraception) ? b.contraception : 'none';
  const hormoneTherapy = HORMONE_THERAPY.includes(b.hormoneTherapy) ? b.hormoneTherapy : 'none';
  const pregnancy = PREGNANCY.includes(b.pregnancy) ? b.pregnancy : 'none';
  return {
    female, menopause, menopauseAssumed, contraception, hormoneTherapy, pregnancy,
    cycling: female && menopause !== 'post' && pregnancy === 'none',      // may have menstrual cycles
    combinedHormonal: female && contraception === 'combined',
    mht: female && hormoneTherapy !== 'none',
    pregnant: female && pregnancy === 'pregnant',
    postpartum: female && (pregnancy === 'postpartum' || pregnancy === 'breastfeeding'),
    breastfeeding: female && pregnancy === 'breastfeeding',
  };
}

// ---------------------------------------------------------------- body composition constants
// Male values are the engines' original constants (do not change: male results must stay identical).
export const BODY = {
  male: {
    defaultBf: 20, essentialBf: 5, defendedBf: 6, ffmiCeiling: 25, ffmiCeilSd: 1.5, goalBodyFat: 12, goalBfLimits: [5, 30],
    ffmiScoreLo: 15, ffmiScoreHi: 24, smmFracOfLean: 0.55,
  },
  female: {
    // No measured body fat at all: the middle of Gallagher 2000's healthy range for women 20–39 (21–33 %;
    // Am J Clin Nutr 72:694, doi:10.1093/ajcn/72.3.694).
    defaultBf: 28,
    // Hard floor in the simulation (physical, not a health target): drug-free female competitors reached 8.6 % DXA
    // (Halliday 2016, Nutrients 8:740, doi:10.3390/nu8110740) and 6 of 27 went below 10 % (Hulmi 2017,
    // Front Physiol 7:689, doi:10.3389/fphys.2016.00689). Forge floors at 10.
    essentialBf: 10,
    // Below this a diet isn't sustained (intake rises to maintenance): competitors averaged 12.7 % at peak and rebounded
    // to ~20 % within months (Hulmi 2017); a 12–14 % health minimum has been suggested (Meyer 2013, Br J Sports Med
    // 47:1044, doi:10.1136/bjsports-2013-092561). Forge uses 13 (male analogue: 6).
    defendedBf: 13,
    // Natural FFMI ceiling (normalized). No female equivalent of Kouri 1995 exists. Women's median FFMI is ~3.5 below
    // men's (15.4 vs 18.9, Schutz 2002, Int J Obes 26:953, doi:10.1038/sj.ijo.0802037; athletes 17.9 vs 21.5, Magee
    // 2024, J Strength Cond Res 38:311, doi:10.1519/JSC.0000000000004621), so 25 − 3.5 ≈ 21.5; the 97.5th percentile of
    // 372 female college athletes was 23.9 (Harty 2019, J Sports Sci 37:2381, doi:10.1080/02640414.2019.1634964).
    // Forge uses 22 ± 1.5 (ASSUMPTION anchored on those studies).
    ffmiCeiling: 22, ffmiCeilSd: 1.5,
    // Default goal body fat: inside Gallagher's healthy range, on the lean side (male default 12 sits in the same place
    // in the male range 8–20). Limits keep it away from the defended floor.
    goalBodyFat: 22, goalBfLimits: [14, 35],
    // 3D muscle-score mapping: shifted down by the ~3.5-point sex gap in FFMI so 0.5 means "average trained woman".
    ffmiScoreLo: 11.5, ffmiScoreHi: 20.5,
    // Skeletal muscle as a share of lean mass. Janssen 2000 (J Appl Physiol 89:81, doi:10.1152/jappl.2000.89.1.81):
    // SM 38.4 % of body mass in men vs 30.6 % in women; at typical body fat that is ~8 % less SM per kg of FFM in
    // women, so 0.55 × 0.92 ≈ 0.51 (ASSUMPTION derived from those averages).
    smmFracOfLean: 0.51,
  },
};
export const bodyConst = sex => BODY[sexOf(sex)];

// Lean-gain rate basis for women. The training-age anchors are % of bodyweight per month for men (Aragon/McDonald
// guideline models). Women gain muscle at the same RELATIVE rate (Roberts 2020, J Strength Cond Res 34:1448,
// doi:10.1519/JSC.0000000000003521: hypertrophy ES 0.07, p = 0.31; Refalo 2025, PeerJ 13:e19042,
// doi:10.7717/peerj.19042: relative gain difference +0.69 %, 95 % HDI −1.5 to 2.9), with smaller ABSOLUTE gains
// because they start with less muscle. So the female rate is applied to lean mass, converted with the lean fraction
// of the reference man the anchors describe (20 % body fat): basis = lean / 0.80. Her own fat doesn't build muscle.
export const FEMALE_RATE_REF_LEAN_FRAC = 0.8;

// Share of trainable skeletal muscle per group. Male table = projection.js SMM_SHARE_RAW (unchanged). Women carry
// relatively more of their muscle in the legs: Janssen 2000 found women's SM 40 % lower than men's in the upper
// body and 33 % lower in the lower body. Female table = male × 0.60 (upper body incl. trunk) or × 0.67 (legs/glutes),
// renormalized by the caller.
export const SMM_SHARE_RAW_MALE = { chest: 0.08, back: 0.17, shoulders: 0.07, biceps: 0.04, triceps: 0.06, forearms: 0.04, core: 0.08,
  glutes: 0.11, quads: 0.19, hamstrings: 0.09, calves: 0.05 };
const LOWER = new Set(['glutes', 'quads', 'hamstrings', 'calves']);
export const SMM_SHARE_RAW_FEMALE = Object.fromEntries(Object.entries(SMM_SHARE_RAW_MALE).map(([g, v]) => [g, v * (LOWER.has(g) ? 0.67 : 0.60)]));

// Tape response per lb of whole-body fat change (in). Men lose more waist per kg lost and women more lower-body
// subcutaneous fat (Kuk & Ross 2009, Int J Obes 33:629, doi:10.1038/ijo.2009.48; Wirth & Steinmetz 1998,
// Obes Res 6:393, doi:10.1002/j.1550-8528.1998.tb00370.x); hip/thigh fat turns over slowly (Karpe & Pinnick 2015,
// Nat Rev Endocrinol 11:90, doi:10.1038/nrendo.2014.185). Only the DIRECTION is from studies; no study gives inches per
// lb by sex, so the magnitudes are ASSUMPTIONS (male row = the original projection constants).
export const FAT_COEF = {
  male: { waist: 0.12, hips: 0.09, chest: 0.06, shoulders: 0.05, thigh: 0.06, arm: 0.03, forearm: 0.01, calf: 0.015, neck: 0.03 },
  female: { waist: 0.10, hips: 0.11, chest: 0.05, shoulders: 0.04, thigh: 0.08, arm: 0.035, forearm: 0.01, calf: 0.015, neck: 0.025 },
};

// Body-fat categories (Gallagher 2000, BMI-linked cut-offs at BMI 18.5 / 25 / 30, white adults; table values as
// widely reproduced). Returns { label, cls, healthy:[lo, hi], source }.
const GALLAGHER = {
  female: [[20, [21, 33, 39]], [40, [23, 34, 40]], [60, [24, 36, 42]]],
  male: [[20, [8, 20, 25]], [40, [11, 22, 28]], [60, [13, 25, 30]]],
};
export function bodyFatCategory(bf, { sex = 'male', age = null } = {}) {
  const v = num(bf); if (v == null) return null;
  const a = num(age) ?? 30;
  const rows = GALLAGHER[sexOf(sex)];
  const [, [lo, hi, ob]] = rows.reduce((best, r) => (a >= r[0] ? r : best), rows[0]);
  const label = v < lo ? 'Below the healthy range' : v < hi ? 'Healthy range' : v < ob ? 'Above the healthy range' : 'Obese range';
  return { label, cls: v < lo ? 'warn' : v < hi ? 'good' : 'warn', healthy: [lo, hi], obese: ob,
    source: `Gallagher 2000: ${lo}–${hi}% is the healthy range for ${sexOf(sex) === 'female' ? 'women' : 'men'} your age` };
}

// FFMI description bands (normalized FFMI). Male = the Measure screen's original bands. Female: median 15.4 (Schutz 2002),
// female college athletes 18.8 ± 2.1 (Harty 2019), female bodybuilders 18.3 (Graybeal 2020, J Strength Cond Res
// 34:1676, doi:10.1519/JSC.0000000000002831), female Ranger graduates 20.0 (McClung 2022, Med Sci Sports Exerc 54:1527,
// doi:10.1249/MSS.0000000000002942), athlete 97.5th percentile 23.9 (Harty 2019).
export function ffmiBand(v, sex = 'male') {
  if (v == null || !Number.isFinite(Number(v))) return null;
  if (sexOf(sex) === 'female') {
    return v < 14 ? ['Below average', 'muted'] : v < 16.5 ? ['Average', 'muted'] : v < 18 ? ['Above average, athletic', 'good']
      : v < 19.5 ? ['Very muscular', 'good'] : v < 22 ? ['Elite natural range', 'accent'] : ['Rare (top of female athletes)', 'warn'];
  }
  return v < 18 ? ['Below average', 'muted'] : v < 20 ? ['Average', 'muted'] : v < 22 ? ['Above average, athletic', 'good'] : v < 23.5 ? ['Very muscular', 'good'] : v < 25 ? ['Elite natural range', 'accent'] : ['Rare without drugs', 'warn'];
}

// ---------------------------------------------------------------- hormones (female reference values)
// Natural total T for a woman, ng/dL, by age. LC-MS/MS medians: premenopausal 27, postmenopausal 18, flat after
// menopause (Kushnir 2010, Clin Chem 56:1138, doi:10.1373/clinchem.2010.143222); T falls with age mostly in the
// early reproductive years and natural menopause has no independent effect (Davison 2005, JCEM 90:3847,
// doi:10.1210/jc.2005-0212); 2.5–97.5th percentile 10–57 ng/dL (Haring 2012, JCEM 97:408, doi:10.1210/jc.2011-2134).
// Combined hormonal contraception lowers total T ~31 % (−0.49 nmol/L) and free T ~61 % (Zimmerman 2014,
// Hum Reprod Update 20:76, doi:10.1093/humupd/dmt038).
export const FEMALE_T_BY_AGE = [[20, 32], [30, 29], [40, 25], [50, 21], [55, 18]];
export const COC_T_FACTOR = 0.69, COC_FREE_T_FACTOR = 0.39, COC_SHBG_ADD = 99;
export function averageTotalTFemale(age, { contraception = null } = {}) {
  const a = num(age) ?? 39;
  const t = interp(FEMALE_T_BY_AGE, a) * (contraception === 'combined' ? COC_T_FACTOR : 1);
  return Math.round(t);
}
// Total ≈ free × 8 in women (Vermeulen equation at T ≈ 27 ng/dL, SHBG ≈ 60 nmol/L gives ~1.2 % free; men ≈ 2 %, × 5).
export const FEMALE_TOTAL_PER_FREE_T = 8;
export const FEMALE_T_RANGE = [10, 57];        // Haring 2012, 2.5–97.5th percentile

// Lab reference values used for women (UI badges + hormone-panel notes).
export const FEMALE_LABS = {
  prolactinHigh: 25,    // ng/mL, typical female upper reference (assay-dependent; men ~20)
  fshPost: 25,          // IU/L, STRAW+10 late-transition criterion
  estradiolLow: 20,     // pg/mL, below the usual early-follicular level (ASSUMPTION; premenopausal only)
  zincLow: 70,          // µg/dL, morning fasting cut-off for women (Hotz 2003, Am J Clin Nutr 78:756, doi:10.1093/ajcn/78.4.756)
  ferritinLow: 30,      // ng/mL athlete cut-off (Clénin 2015, Swiss Med Wkly, doi:10.4414/smw.2015.14196); ~25 is the
                        // physiological threshold in women (Mei 2021, Lancet Haematol 8:e572, doi:10.1016/S2352-3026(21)00168-X)
  ferritinHigh: 150,    // ng/mL, WHO 2020 ferritin guideline: >150 in healthy women suggests iron-overload risk (not PubMed-indexed)
};

// ---------------------------------------------------------------- nutrition
// Low energy availability: EA = (intake − exercise kcal) / kg fat-free mass / day. LH pulsatility was disrupted below
// 30 kcal/kg lean mass/day within 5 days (Loucks & Thuma 2003, JCEM 88:297, doi:10.1210/jc.2002-020369); ~45 is
// "adequate" (Areta 2021, Eur J Appl Physiol 121:1, doi:10.1007/s00421-020-04516-0); IOC REDs consensus 2023
// (Mountjoy, Br J Sports Med 57:1073, doi:10.1136/bjsports-2023-106994). Thresholds in men are unknown (Areta 2021),
// so Forge warns only in female mode.
export const EA_LOW = 30, EA_ADEQUATE = 45;
export function energyAvailability({ intakeKcal, exerciseKcal = 0, leanLb } = {}) {
  const i = num(intakeKcal), l = num(leanLb), e = num(exerciseKcal) ?? 0;
  if (i == null || l == null || !(l > 20)) return null;
  return Math.round((i - Math.max(0, e)) / (l / 2.20462) * 10) / 10;
}
// Iron RDA, mg/day (IOM 2001 DRI; Trumbo 2001, J Am Diet Assoc 101:294, doi:10.1016/S0002-8223(01)00078-5).
export function ironRda({ sex = 'male', menopause = 'pre', pregnant = false } = {}) {
  if (sexOf(sex) !== 'female') return 8;
  if (pregnant) return 27;
  return menopause === 'post' ? 8 : 18;
}
// Pregnancy: about +0 / +340 / +452 kcal/day by trimester, not a time for weight loss (Kominiarek & Rajan 2016,
// Med Clin North Am 100:1199, doi:10.1016/j.mcna.2016.06.004; ACOG Committee Opinion 804, Obstet Gynecol 135:e178,
// doi:10.1097/AOG.0000000000003772).
export const PREGNANCY_KCAL = [0, 340, 452];

// ---------------------------------------------------------------- plain-language summary (UI)
export const FEMALE_MODE_INFO = [
  'Body fat: the female Navy tape formula (adds hips), female Relative Fat Mass and BMI formulas, and the healthy range for women your age (21-33% at 20-39; Gallagher 2000).',
  'Calorie burn: the female Mifflin-St Jeor equation when body fat is unknown; otherwise your lean mass sets it, which already accounts for sex.',
  'Muscle gain: women build muscle at the same rate relative to their muscle as men (Roberts 2020; Refalo 2025). Forge applies the training-age curve to your lean mass, so absolute gains are smaller but the progress you feel is the same.',
  'Natural ceiling and milestones use female norms (natural FFMI limit about 22; female athlete data), and waist-to-hip replaces the male V-taper milestones.',
  'Hormones: female reference values (total testosterone about 10-57 ng/dL). Testosterone therapy is modeled from studies in women and trans men, not from men.',
  'Nutrition: same protein per lb (no sex difference in Morton 2018), a low-energy-availability warning (below 30 kcal per kg of lean mass), and iron needs (18 mg/day before menopause).',
  'Training targets stay the same: no study supports different weekly set targets for women, and menstrual-cycle phase has at most a trivial effect on performance (McNulty 2020), so Forge does not change workouts by cycle phase.',
  'Pregnancy pauses the body projection and calorie deficits. Talk to your OB or midwife about targets.',
];
