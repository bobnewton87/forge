// Nutrition targets, macro math and data-driven TDEE. Pure, DOM-free (CONTRACT §8, §15).
//
// CONTRACT-NOTE: dailyTargets(profile, { dayType, bodyweight, tdee }) also returns
//   { tdee, mode, goal, dayType, proteinPct, carbPct, fatPct, proteinGPerLb, warnings }.
//   Optional opts.tdee = maintenance kcal/day from the projection model; when absent the old
//   bodyweight × 15.5 estimate is used. Average daily calories: profile.nutrition.calories if set,
//   else TDEE + profile.nutrition.surplus if set, else TDEE − the goal's usual deficit. In 'cycling'
//   mode the day types are cycled around that average (ports Iron Runner calcNutri offsets).
//   Legacy profile.nutrition.protein (grams) still overrides proteinGPerLb when set.
//   Carbs are no longer floored at 100 g (calories are never silently raised); a warning is given.
// CONTRACT-NOTE: macrosFor() also returns proteinGPerLb and carbsGPerLb. Warnings are plain
//   English strings. Protein g/lb is clamped to 0.3–2.0, fat % to 10–60.
// CONTRACT-NOTE: adaptiveTdee() returns extra { avgIntake, weightChangeLb, lbPerWeek, trendStart,
//   trendEnd, from, to, weighIns, foodDays, method:'trend'|'raw' }. The EWMA trend (α = 0.1/day,
//   time-aware for gaps) gives the trend weights. The rate of change is the least-squares slope of
//   that trend once it has ≥30 days of history (a fresh EWMA under-reads a moving weight), else the
//   least-squares slope of the raw weigh-ins in the window.
// CONTRACT-NOTE: extra exports SUPPLEMENTS, MEAL_IDEAS, KCAL_PER_LB_TREND, ewmaTrend.
// CONTRACT-NOTE (§20 Female mode): for female profiles (sex.js sexOf):
//   macrosFor(): the low-fat warning drops the testosterone claim (IOM AMDR 20–35 % applies to everyone).
//   dailyTargets(profile, { …, leanLb, exerciseKcal }): optional lean mass (lb) and average net exercise kcal/day →
//     result.energyAvailability (kcal/kg FFM/day, null without leanLb) and a warning under 30 (Loucks & Thuma 2003;
//     IOC REDs 2023). Pregnancy: no planned deficit (goal/default intake = maintenance) plus a caution; a user-set
//     intake below maintenance gets a warning. Breastfeeding/postpartum: a caution. Result gains `female` info.
//   tipsFor(profile) → { nutrition:[…], adderall:[…]|null } (female list: iron, energy availability, cycle-related
//     water weight; Adderall tips only when Adderall is in her stack); supplementsFor(profile) adds an iron note.
//   Protein targets are unchanged: sex explained none of the variance in Morton 2018 and female IAAO estimates
//   (1.41–1.71 g/kg/day) sit at or under its 1.62 g/kg plateau. Male outputs are unchanged.

import { ds, parseDs, addDays, daysBetween } from '../util.js';
import { sexOf, femaleStatus, energyAvailability, EA_LOW, EA_ADEQUATE, ironRda, PREGNANCY_KCAL } from './sex.js';

const round10 = x => Math.round(x / 10) * 10;
const fin = x => typeof x === 'number' && Number.isFinite(x);
const num = x => (x == null || x === '' ? NaN : Number(x));
const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Calories below estimated maintenance (negative = surplus). Ported from Iron Runner calcNutri
// (recomp/bulk/cut), with 'both' (lift + cardio) days fuelled a bit more than a lift day.
//
// WHAT CARB CYCLING IS AND ISN'T (docs/research/energy-model.md §5). These are day-to-day *offsets*
// around the same weekly average, so cycling changes WHEN you eat carbs, not how much you eat in a
// week. That is the honest claim and the only one Forge makes: at matched weekly calories and protein,
// the carbohydrate/fat split has little effect on body composition (CONTRACT §15; Helms ER, Aragon AA,
// Fitschen PJ 2014, J Int Soc Sports Nutr 11:20, doi:10.1186/1550-2783-11-20, whose own
// recommendation is to set calories and protein first and let carbs and fat fill the rest). The value
// is fuelling: carbs around training support the volume that actually drives the adaptation.
const CYCLE = {
  recomp: { lift: 100, cardio: 300, rest: 500, both: -100 },
  lean_bulk: { lift: -250, cardio: 0, rest: 200, both: -400 },
  cut: { lift: 300, cardio: 500, rest: 700, both: 150 },
  // §23 weight-loss goal: a deeper, rate-driven deficit (the average is replaced by lossRateDeficit when a
  // rate or goal weight is set); the day-type spread keeps carbs around training.
  weight_loss: { lift: 400, cardio: 650, rest: 900, both: 250 },
};
// Flat daily offset for 'simple' mode.
export const SIMPLE_DEFICIT = { recomp: 250, lean_bulk: -250, cut: 500, weight_loss: 600 };
const SIMPLE = SIMPLE_DEFICIT;
// The week the cycling offsets are centred on when the caller does not pass one: Forge's default
// schedule (CONTRACT Phase 2) of 4 lifting days — one of which also carries cardio — 2 cardio days and
// 1 rest day. `cycleMean()` divides by 7, so cycling mode averages EXACTLY to the target intake.
// This was a real bug before: the cycling formula subtracted CYCLE[dayType] and added back the flat
// SIMPLE offset, which is not the mean of the CYCLE values. Over this week that made a cut average
// ~86 kcal/day MORE than the stated target and a lean bulk ~136 kcal/day LESS, so Nutrition and the
// projection quietly disagreed about how much the user was actually eating.
export const REFERENCE_WEEK = { lift: 3, both: 1, cardio: 2, rest: 1 };
export function cycleMean(goal, week = REFERENCE_WEEK) {
  const c = CYCLE[goal] || CYCLE.recomp;
  let days = 0, sum = 0;
  for (const [k, n] of Object.entries(week || {})) {
    const cnt = num(n);
    if (!(cnt > 0) || c[k] == null) continue;
    days += cnt; sum += cnt * c[k];
  }
  return days > 0 ? sum / days : (SIMPLE[goal] ?? SIMPLE.recomp);
}
// §23: weight_loss defaults to a protective 1.0 g/lb. The user lowers it deliberately (Targets →
// lean protection), and the engine then predicts the extra lean loss instead of hiding it.
//
// WHY THESE NUMBERS (docs/research/energy-model.md §4). Morton RW et al. 2018, Br J Sports Med
// 52:376-84, doi:10.1136/bjsports-2017-097608 (49 RCTs, 1,863 people): gains in fat-free mass stop
// improving past a TOTAL intake of 1.62 g/kg/day = **0.73 g/lb**, with the upper bound of the
// confidence interval at ~2.2 g/kg = **1.0 g/lb**. 1.0 g/lb is that upper bound, picked so the target
// covers essentially everyone rather than the average person — not because more builds more muscle.
// Morton's figure is per kg of BODYWEIGHT (that is how total intake was expressed), which is what
// `proteinGPerLb` means everywhere in Forge.
// The cut default of 1.15 g/lb is higher because a deficit changes the question from "how much can I
// build" to "how much can I keep", and there the dose-response runs past Morton's plateau: Longland TM
// et al. 2016, Am J Clin Nutr 103:738-46, doi:10.3945/ajcn.115.119339 put trained men in a 40 %
// deficit with hard training and 2.4 g/kg/day GAINED 1.2 kg of lean against 0.1 kg at 1.2 g/kg, and
// lost more fat (−4.8 vs −3.5 kg). Helms 2014 (doi:10.1186/1550-2783-11-20) recommends 2.3-3.1 g/kg
// of LEAN mass during contest prep, which at Bob's ~23 % body fat is 0.80-1.08 g/lb of bodyweight.
export const DEFAULT_PROTEIN = { recomp: 1.0, lean_bulk: 1.0, cut: 1.15, weight_loss: 1.0 };
// Morton's break-point and CI, in both units, so no screen re-derives them.
export const PROTEIN_EVIDENCE = {
  plateauGPerKg: 1.62, plateauGPerLb: 0.73, ceilingGPerKg: 2.2, ceilingGPerLb: 1.0,
  deficitGPerKgLean: [2.3, 3.1],
  doi: '10.1136/bjsports-2017-097608', deficitDoi: '10.3945/ajcn.115.119339', leanDoi: '10.1186/1550-2783-11-20',
};
export const DEFAULT_FAT_PCT = 25;
// Dietary fat (docs/research/energy-model.md §6). TWO separate things, and Forge must not merge them:
//  - There is **no mechanism by which fat calories are uniquely fattening**. At equal calories and
//    protein the carbohydrate/fat split barely moves body composition. The one measurable asymmetry
//    runs the other way and is tiny: a high-fat mixed diet has a slightly LOWER thermic effect than a
//    high-protein one, ~5 % of intake vs ~15 % (Westerterp KR 2004, Nutr Metab (Lond) 1:5,
//    doi:10.1186/1743-7075-1-5) — worth tens of kcal a day, not a mechanism for getting fat.
//  - There IS a real floor. Men moved from a higher-fat to a lower-fat diet lose a little
//    testosterone: pooled standardised mean difference −0.38 for total T (95 % CI −0.75 to −0.01,
//    p = 0.04) and −0.37 for free T across 6 intervention studies, n = 206 (Whittaker J, Wu K 2021,
//    J Steroid Biochem Mol Biol 210:105878, doi:10.1016/j.jsbmb.2021.105878; corrigendum 2025,
//    doi:10.1016/j.jsbmb.2025.106880). The trials compared roughly 20 % vs 40 % of calories from fat,
//    all six were small, and the effect is a nudge inside the normal range, not hypogonadism.
// So the warning below is a FLOOR warning. The range is 20-35 % of calories (IOM AMDR); Helms 2014
// allows 15-30 % for physique athletes, which is why the slider goes to 15 % without complaining.
export const FAT_EVIDENCE = {
  floorPct: 20, amdr: [20, 35], athleteRange: [15, 30],
  totalTestosteroneSMD: -0.38, totalTestosteroneCI: [-0.75, -0.01], freeTestosteroneSMD: -0.37,
  doi: '10.1016/j.jsbmb.2021.105878', tefDoi: '10.1186/1743-7075-1-5', amdrSource: 'IOM DRI 2005',
  noFatteningMechanism: 'At equal calories and protein, dietary fat is not more fattening than carbohydrate. Energy balance decides fat gain; the fat/carb split decides how training feels and where hormones sit.',
};

const NOTES = {
  lift: 'Lift day: put most of your carbs in the meals before and after training.',
  cardio: 'Cardio day: carbs before longer or harder sessions; keep protein high.',
  rest: 'Rest day: lowest carbs. Lean on protein, veggies and fats.',
  both: 'Lift + cardio day: highest carbs. Eat a real meal between sessions.',
};
const GOAL_NOTES = {
  recomp: 'Recomp: small average deficit, protein every day.',
  lean_bulk: 'Lean bulk: small surplus. Aim to gain about 0.25-0.5 lb a week.',
  cut: 'Cut: moderate deficit with higher protein to keep as much muscle as a deficit allows.',
  weight_loss: 'Losing weight: fat goes first, but some lean mass comes with it. Protein and lifting decide how much.',
};

// ---------------------------------------------------------------- macros
// Protein from g per lb of bodyweight, fat as a % of calories, carbs = whatever is left.
export function macrosFor(profile, { calories, bodyweight, leanLb = null } = {}) {
  const n = profile?.nutrition || {};
  const goal = CYCLE[profile?.goal] ? profile.goal : 'recomp';
  const bw = num(bodyweight) > 0 ? num(bodyweight) : num(profile?.bodyweight) > 0 ? num(profile.bodyweight) : 0;
  const kcal = num(calories) > 0 ? num(calories) : num(n.calories) > 0 ? num(n.calories) : 0;
  const warnings = [];
  let gPerLb = num(n.proteinGPerLb) > 0 ? clampN(num(n.proteinGPerLb), 0.3, 2) : DEFAULT_PROTEIN[goal];
  let protein = bw > 0 ? Math.round(bw * gPerLb) : 0;
  if (num(n.protein) > 0 && !(num(n.proteinGPerLb) > 0)) { protein = Math.round(num(n.protein)); gPerLb = bw > 0 ? protein / bw : gPerLb; }
  const fatPctIn = num(n.fatPct) > 0 ? clampN(num(n.fatPct), 10, 60) : DEFAULT_FAT_PCT;
  let fat = Math.round(kcal * fatPctIn / 100 / 9);
  let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  if (carbs < 0) {
    warnings.push(`Protein (${protein} g) plus fat (${fatPctIn}%) already add up to more than ${Math.round(kcal)} kcal. Lower the fat % or raise calories.`);
    carbs = 0;
    fat = Math.max(0, Math.round((kcal - protein * 4) / 9));
  }
  const total = protein * 4 + carbs * 4 + fat * 9;
  const pct = x => (total > 0 ? Math.round(100 * x / total) : 0);
  const out = {
    calories: Math.round(kcal), protein, carbs, fat,
    proteinPct: pct(protein * 4), carbPct: pct(carbs * 4), fatPct: pct(fat * 9),
    proteinGPerLb: bw > 0 ? Math.round(100 * protein / bw) / 100 : Math.round(gPerLb * 100) / 100,
    carbsGPerLb: bw > 0 ? Math.round(100 * carbs / bw) / 100 : 0,
    warnings,
  };
  // Bodyweight vs lean mass. Forge expresses protein per lb of BODYWEIGHT everywhere, which is what
  // Morton 2018 measured (total g/kg of body mass). The deficit literature uses lean mass instead
  // (Helms 2014: 2.3-3.1 g/kg LBM), and the two only diverge at high body fat, where per-bodyweight
  // prescribes protein for tissue that is not metabolically asking for it. Reported so no screen has
  // to guess, and flagged only where the gap actually matters.
  const lean = num(leanLb) > 0 ? num(leanLb) : null;
  if (lean != null && protein > 0) {
    out.leanLb = Math.round(lean * 10) / 10;
    out.proteinGPerLbLean = Math.round(100 * protein / lean) / 100;
    out.proteinGPerKgLean = Math.round(100 * protein / (lean / 2.20462)) / 100;
    const bfPct = bw > 0 ? (1 - lean / bw) * 100 : 0;
    const highBf = sexOf(profile) === 'female' ? bfPct > 40 : bfPct > 30;
    if (highBf) {
      const lo = Math.round(lean / 2.20462 * PROTEIN_EVIDENCE.deficitGPerKgLean[0]);
      const hi = Math.round(lean / 2.20462 * PROTEIN_EVIDENCE.deficitGPerKgLean[1]);
      warnings.push(`At ${Math.round(bfPct)}% body fat, protein per pound of bodyweight asks for more than the research does. Per pound of LEAN mass you are at ${out.proteinGPerLbLean} g/lb (${out.proteinGPerKgLean} g/kg); the range that protects muscle in a deficit is ${lo}-${hi} g/day (2.3-3.1 g/kg of lean mass, Helms 2014). Anything above that is fine, just not doing extra work.`);
    }
  }
  if (kcal > 0) {
    // FLOOR warning only. Fat is not uniquely fattening (see FAT_EVIDENCE); the reason to keep it up
    // is hormones, satiety and fat-soluble vitamins.
    if (out.fatPct < FAT_EVIDENCE.floorPct) warnings.push(sexOf(profile) === 'female'
      ? `Fat is only ${out.fatPct}% of calories. Below ~20% for long stretches makes meals less filling and fat-soluble vitamins harder to absorb; 20-35% is the recommended range (IOM). Eating more fat does not make you gain fat — only a calorie surplus does.`
      : `Fat is only ${out.fatPct}% of calories. 20-35% is the usual range (IOM), and 15-30% is fine for a physique athlete (Helms 2014). Going below ~20% for long stretches nudges testosterone down a little (pooled effect −0.38 SD, 95% CI −0.75 to −0.01, in trials comparing ~20% vs ~40% fat; Whittaker 2021) and makes meals less filling. Note the direction: eating MORE fat does not make you gain fat — only a calorie surplus does.`);
    if (carbs < 100) warnings.push(`Only ${carbs} g of carbs a day. Under ~100 g, hard lifting and cardio usually feel flat because muscle glycogen runs low.`);
  }
  if (bw > 0 && out.proteinGPerLb < 0.7) warnings.push(goal === 'weight_loss'
    // §23: in a deficit the cost of low protein is lean mass, not slower growth. Mettler 2010 (Med Sci Sports
    // Exerc 42:326, doi:10.1249/MSS.0b013e3181b2ef8e): resistance-trained men at 60 % of habitual intake for
    // 2 weeks lost 1.6 kg of lean at 1.0 g/kg (~0.45 g/lb) vs 0.3 kg at 2.3 g/kg (~1.05 g/lb).
    ? `Protein is ${out.proteinGPerLb} g/lb. In a deficit that is the single biggest lever on how much of the weight you lose is muscle: 0.45 g/lb cost 1.6 kg of lean mass in two weeks where 1.05 g/lb cost 0.3 kg (Mettler 2010). Fine if a smaller body is the point; not if you want to keep the muscle.`
    : `Protein is ${out.proteinGPerLb} g/lb. Gains in lean mass stop improving past 1.62 g/kg ≈ 0.73 g/lb (Morton 2018, 49 trials), so below ~0.7 g/lb you are giving some of them up; ~1 g/lb is the top of that study's confidence interval and covers almost everyone.`);
  if (bw > 0 && out.proteinGPerLb > 1.3) warnings.push(goal === 'cut' || goal === 'weight_loss'
    // In a deficit the dose-response runs past Morton's plateau (Longland 2016), so the wording must
    // not claim "no benefit" — 1.3 g/lb is simply above even the deficit recommendations.
    ? `Protein is ${out.proteinGPerLb} g/lb — above even the high end for dieting (Helms 2014's 3.1 g/kg of lean mass, and the 2.4 g/kg of bodyweight that beat 1.2 g/kg in Longland 2016). It is safe, and in a deficit erring high is the right error; just know the extra is displacing carbs that fuel training.`
    : `Protein is ${out.proteinGPerLb} g/lb. Past ~1 g/lb (2.2 g/kg, the top of Morton 2018's confidence interval) more protein did not add lean mass in the trials; the extra just displaces carbs that fuel training. Safe, not needed — unless you are in a deficit, where higher protein does keep paying off.`);
  return out;
}

// Note from the ACTUAL average balance (the goal alone can be contradicted by calories/surplus).
function balanceNote(goal, bal) {
  const b = Math.round(bal / 10) * 10;
  if (b < -100) {
    // §23: the weight-loss goal is about the scale, so name what the deficit costs instead of promising muscle.
    if (goal === 'weight_loss') return `Deficit of about ${-b} kcal/day. Most of that comes off as fat, but some of it is lean mass${b <= -500 ? '; past ~500 kcal/day lifters stopped gaining lean mass altogether (Murphy & Koehler 2022)' : ''}. Protein and lifting decide the split.`;
    if (goal === 'cut') return GOAL_NOTES.cut;
    if (b >= -350) return GOAL_NOTES.recomp;
    // §23 (universal): a big deficit costs lean mass under every goal, so say so rather than promising muscle.
    return `Deficit of about ${-b} kcal/day: expect steady fat loss, and some lean mass with it${b <= -500 ? ' (past ~500 kcal/day lifters stopped gaining lean mass altogether; Murphy & Koehler 2022)' : ''}. Protein and lifting decide the split.`;
  }
  if (b > 100) {
    if (b <= 500) return `Surplus of about ${b} kcal/day: a lean bulk. Aim to gain about 0.25-0.5% of bodyweight a week.`;
    return `Surplus of about ${b} kcal/day. Past ~+500, almost all of the extra becomes fat rather than muscle; check the nutrition lab.`;
  }
  return 'About maintenance: weight should hold steady. With lifting and enough protein you can still slowly recomp.';
}

// §23: the daily deficit implied by the user's loss rate (or goal weight + date). Mirrors
// engine/targets.lossPlan() exactly, with the same lossRateDeficit() formula, but without importing
// targets.js (which would pull the whole exercise library into the nutrition module).
function lossDeficitOf(profile, bw) {
  const b = profile?.body && typeof profile.body === 'object' ? profile.body : {};
  let pct = num(b.lossRatePctPerWeek) > 0 ? clampN(num(b.lossRatePctPerWeek), 0.1, 2) : null;
  const goalW = num(b.goalWeightLb) > 0 ? num(b.goalWeightLb) : null;
  const date = typeof b.goalWeightDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.goalWeightDate) ? b.goalWeightDate : null;
  const today = ds();
  if (date && date > today && goalW != null && bw > goalW) {
    const wks = Math.max(1, Math.round((parseDs(date) - parseDs(today)) / 6048e5));
    pct = clampN((bw - goalW) / wks / bw * 100, 0.1, 2);
  }
  if (pct == null) pct = DEFAULT_LOSS_RATE_PCT;
  return lossRateDeficit(bw, pct);
}
export const DEFAULT_LOSS_RATE_PCT = 0.7;   // Garthe 2011's slow arm (doi:10.1123/ijsnem.21.2.97)

// ---------------------------------------------------------------- daily targets
export function dailyTargets(profile, { dayType = 'lift', bodyweight, tdee: tdeeIn, leanLb = null, exerciseKcal = null, week = null } = {}) {
  const n = profile?.nutrition || {};
  const mode = n.mode || 'off';
  if (mode === 'off') return null;
  const bw = Number(bodyweight) || Number(profile?.bodyweight) || 0;
  if (!(bw > 0)) return null;
  const goal = CYCLE[profile?.goal] ? profile.goal : 'recomp';
  if (CYCLE[goal][dayType] == null) dayType = 'lift';

  const tdee = Number(tdeeIn) > 0 ? Math.round(Number(tdeeIn)) : Math.round(bw * 15.5);
  const female = sexOf(profile) === 'female';
  const fs = female ? femaleStatus(profile) : null;
  const userCal = Number(n.calories) > 0, userSur = n.surplus != null && n.surplus !== '' && fin(Number(n.surplus));
  let avg;
  if (userCal) avg = Number(n.calories);
  else if (userSur) avg = tdee + Number(n.surplus);
  // §23: the weight-loss goal sizes its deficit from the chosen rate (% of bodyweight per week) or the goal
  // weight + date, so Nutrition and the projection always quote the same number.
  else if (goal === 'weight_loss' && !fs?.pregnant) avg = tdee - (lossDeficitOf(profile, bw) ?? SIMPLE.weight_loss);
  else avg = fs?.pregnant ? tdee : tdee - SIMPLE[goal];      // pregnancy: no planned deficit (§20)
  // Cycling: day-type offsets around `avg`, centred on the mean of the offsets over the week so the
  // weekly average IS `avg` (see REFERENCE_WEEK / cycleMean). Callers that know the real schedule pass
  // `week` ({ lift, cardio, both, rest } day counts) and the centring uses their week instead.
  const cm = cycleMean(goal, week || REFERENCE_WEEK);
  let calories = mode === 'simple' ? avg : avg + cm - CYCLE[goal][dayType];
  if (fs?.pregnant && !userCal && !userSur) calories = mode === 'simple' ? tdee : Math.max(tdee - 150, calories);
  calories = round10(Math.max(1000, calories));

  const m = macrosFor(profile, { calories, bodyweight: bw, leanLb });
  const balNote = balanceNote(goal, avg - tdee);
  const note = mode === 'simple' ? balNote : `${NOTES[dayType]} ${balNote}`;
  const out = { calories, protein: m.protein, carbs: m.carbs, fat: m.fat, note, tdee, mode, goal,
    dayType: mode === 'simple' ? null : dayType,
    proteinPct: m.proteinPct, carbPct: m.carbPct, fatPct: m.fatPct, proteinGPerLb: m.proteinGPerLb, warnings: m.warnings,
    avgCalories: round10(avg), cycleMean: mode === 'simple' ? null : Math.round(cm),
    proteinGPerLbLean: m.proteinGPerLbLean ?? null, proteinGPerKgLean: m.proteinGPerKgLean ?? null };
  // §23: energy availability is checked for BOTH sexes under the weight-loss goal. 30 kcal/kg FFM/day is the
  // threshold at which LH pulsatility was disrupted in women within 5 days (Loucks & Thuma 2003, J Clin
  // Endocrinol Metab 88:297, doi:10.1210/jc.2002-020369); no equivalent number has been established in men, but
  // the IOC's 2023 REDs consensus (doi:10.1136/bjsports-2023-106994) documents the same syndrome in male athletes.
  if (goal === 'weight_loss' && !female) {
    const ea = energyAvailability({ intakeKcal: avg, exerciseKcal: Number(exerciseKcal) > 0 ? Number(exerciseKcal) : 0, leanLb });
    if (ea != null) {
      out.energyAvailability = ea;
      if (ea < EA_LOW) out.warnings = [...out.warnings, `Energy availability ≈${ea} kcal per kg of lean mass a day (food ${Math.round(avg)} minus exercise ≈${Math.round(Number(exerciseKcal) || 0)} kcal). ~45 is adequate and ~30 is where measurable harm starts; the 30 figure was established in women (Loucks & Thuma 2003) and no male threshold has been validated, but low energy availability costs bone, hormones, recovery and training quality in men too (IOC REDs consensus 2023). Eat more around training or ease the deficit.`];
    }
  }
  if (!female) return out;
  // ---- female mode (§20)
  const warnings = [...m.warnings];
  const ea = energyAvailability({ intakeKcal: avg, exerciseKcal: Number(exerciseKcal) > 0 ? Number(exerciseKcal) : 0, leanLb });
  if (ea != null && ea < EA_LOW && !fs.pregnant) warnings.push(`Energy availability ≈${ea} kcal per kg of lean mass a day (food ${Math.round(avg)} minus exercise ≈${Math.round(Number(exerciseKcal) || 0)} kcal). ${fs.menopause === 'post' ? 'Low energy availability costs bone, recovery and training quality at any age (IOC REDs 2023); ~45 is adequate.' : 'Below ~30 the hormone pulses that run the menstrual cycle were disrupted within 5 days (Loucks & Thuma 2003); ~45 is adequate.'} Eat more on training days or ease the deficit${fs.menopause === 'post' ? '' : ', and see a doctor if your periods change (IOC REDs 2023)'}.`);
  if (fs.pregnant) {
    warnings.push(`Pregnancy: Forge doesn't plan a deficit. Needs rise about +${PREGNANCY_KCAL[1]} kcal/day in the 2nd trimester and +${PREGNANCY_KCAL[2]} in the 3rd, and pregnancy isn't a time for weight loss (Kominiarek & Rajan 2016; ACOG 2020). Your OB or midwife sets your targets.`);
    if ((userCal || userSur) && avg < tdee - 50) warnings.push(`Your set intake (${Math.round(avg)} kcal) is below estimated maintenance (${Math.round(tdee)}). Talk to your provider before eating in a deficit while pregnant.`);
  } else if (fs.postpartum) {
    warnings.push(fs.breastfeeding ? 'Breastfeeding costs roughly 500 kcal/day; a slow loss of about 0.5-1 kg a month after the first month doesn\'t affect milk supply (Kominiarek & Rajan 2016). Check bigger deficits with your provider.'
      : 'Postpartum: weight, fluid and hormones change fast for months. Check with your provider before a calorie deficit or hard training.');
  }
  return { ...out, warnings, energyAvailability: ea, female: { status: fs, ironMgPerDay: ironRda({ sex: 'female', menopause: fs.menopause, pregnant: fs.pregnant }), eaLow: EA_LOW, eaAdequate: EA_ADEQUATE } };
}

// ---------------------------------------------------------------- adaptive TDEE
// ~3,500 kcal per lb of trend-weight change: a mix of fat (~3,500/lb) and lean/water (much less),
// the same first approximation MacroFactor-style apps use.
export const KCAL_PER_LB_TREND = 3500;
const ALPHA = 0.1;
// THE window every screen calibrates over. Measurements used to ask for 42 days while the projection
// used this default of 28, so the two screens could show different "measured TDEE" numbers for the
// same logs (CONTRACT §18). 28 days is long enough that day-to-day water, glycogen and gut-fill noise
// (±2-3 lb) averages down below the signal a 500 kcal/day error would produce (~1 lb/week), and short
// enough that it tracks a real change in burn rather than last season's.
export const ADAPTIVE_WINDOW_DAYS = 28;
// Minimum logged days of each kind inside the window, and the confidence ladder.
export const ADAPTIVE_MIN_DAYS = 10;

// §23 (weight-loss goal). THE one formula that turns "lose r % of bodyweight per week" into a daily calorie
// deficit, used by engine/targets.lossPlan() (which every screen reads) and therefore by the projection too.
// 3,500 kcal/lb is a first approximation: Hall 2008 (Int J Obes 32:573, doi:10.1038/sj.ijo.0803720) showed it
// only holds above ~30 kg of fat mass and OVER-states the deficit a leaner person needs, because the lean
// tissue they also lose releases far less energy per pound. The projection's week-by-week bookkeeping handles
// that properly (lean costs ~1,250 kcal/lb to build and releases ~800 when lost); this helper is for sizing
// the target, and adaptive thermogenesis pulls real-world loss back the other way.
export function lossRateDeficit(weightLb, pctPerWeek) {
  const w = num(weightLb), r = num(pctPerWeek);
  if (!(w > 0) || !(r > 0)) return null;
  return Math.round(w * r / 100 * KCAL_PER_LB_TREND / 7);
}

// Time-aware EWMA over weigh-ins sorted by date. Returns [{ d, w, trend, t }] (t = day index).
export function ewmaTrend(bodyLog, { alpha = ALPHA } = {}) {
  const pts = (Array.isArray(bodyLog) ? bodyLog : [])
    .filter(e => e && typeof e.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.d) && num(e.w) > 0)
    .map(e => ({ d: e.d, w: num(e.w) }))
    .sort((a, b) => a.d.localeCompare(b.d));
  // one value per day (average duplicates)
  const byDay = [];
  for (const p of pts) {
    const last = byDay[byDay.length - 1];
    if (last && last.d === p.d) { last.sum += p.w; last.n++; last.w = last.sum / last.n; }
    else byDay.push({ d: p.d, w: p.w, sum: p.w, n: 1 });
  }
  if (!byDay.length) return [];
  const d0 = byDay[0].d;
  // seed with the mean of the first few weigh-ins so one odd morning does not anchor the trend
  const seedN = Math.min(3, byDay.length);
  let trend = byDay.slice(0, seedN).reduce((a, p) => a + p.w, 0) / seedN;
  let prevT = 0;
  return byDay.map((p, i) => {
    const t = daysBetween(d0, p.d);
    if (i > 0) { const a = 1 - Math.pow(1 - alpha, Math.max(1, t - prevT)); trend += a * (p.w - trend); }
    prevT = t;
    return { d: p.d, w: p.w, trend, t };
  });
}

function slope(points, key) {
  const n = points.length;
  if (n < 2) return 0;
  const mt = points.reduce((a, p) => a + p.t, 0) / n, my = points.reduce((a, p) => a + p[key], 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of points) { sxy += (p.t - mt) * (p[key] - my); sxx += (p.t - mt) ** 2; }
  return sxx > 0 ? sxy / sxx : 0;
}

// MacroFactor-style: average intake − (trend weight change × ~3,500 kcal/lb) / days. This is the
// ONLY measurement of real expenditure Forge has, and it beats every formula because it contains
// whatever the formulas miss: this person's actual NEAT, their energy compensation (Careau 2021), the
// 8-15 % individual variation in the cost of their own cardio, and any adaptive thermogenesis.
// Needs ≥ADAPTIVE_MIN_DAYS days of both weigh-ins and food logs inside the window (default: the last
// ADAPTIVE_WINDOW_DAYS days that have data).
//
// KNOWN BIASES, in order of size:
//  1. Under-reported intake. Food logs run low, and the error lands entirely in the TDEE estimate, so
//     a measured TDEE below the formula usually means the logs are short, not that the burn is low.
//  2. 3,500 kcal/lb is pure fat. Real loss carries lean mass and water, which release far less per
//     pound (the projection books lean at ~800 kcal/lb), so this OVERSTATES the deficit and therefore
//     overstates TDEE while losing — and understates it while gaining. Worst in the first 2 weeks of a
//     diet, when most of the scale move is glycogen and water, which is why the window is 28 days.
//  3. A fresh EWMA lags a moving weight, handled below by only trusting the trend slope after 30 days.
// Confidence is reported, not hidden: 'high' needs 21+ food days, 14+ weigh-ins and 60 % coverage.
export function adaptiveTdee({ bodyLog = [], foodLog = [], from, to } = {}) {
  const food = (Array.isArray(foodLog) ? foodLog : []).filter(e => e && typeof e.d === 'string' && num(e.kcal) > 0);
  const trendAll = ewmaTrend(bodyLog);
  if (!food.length || !trendAll.length) return null;
  const lastData = [food.reduce((a, e) => (e.d > a ? e.d : a), ''), trendAll[trendAll.length - 1].d].sort()[0];
  const toS = typeof to === 'string' ? to : to instanceof Date ? ds(to) : lastData;
  const fromS = typeof from === 'string' ? from : from instanceof Date ? ds(from) : ds(addDays(parseDs(toS), -(ADAPTIVE_WINDOW_DAYS - 1)));
  if (fromS > toS) return null;
  const inWin = e => e.d >= fromS && e.d <= toS;
  const foodW = food.filter(inWin);
  const foodDays = new Set(foodW.map(e => e.d)).size;
  const trendW = trendAll.filter(inWin);
  if (foodDays < ADAPTIVE_MIN_DAYS || trendW.length < ADAPTIVE_MIN_DAYS) return null;
  const span = daysBetween(trendW[0].d, trendW[trendW.length - 1].d);
  if (span < 9) return null;

  // Daily intake average (one value per day).
  const perDay = new Map();
  for (const e of foodW) perDay.set(e.d, (perDay.get(e.d) || 0) + num(e.kcal));
  const avgIntake = [...perDay.values()].reduce((a, b) => a + b, 0) / perDay.size;

  // Rate of change: least-squares slope of the EWMA trend when it has had ≥30 days of history to
  // settle before the window (a fresh EWMA under-reads a moving weight for its first few weeks);
  // otherwise the least-squares slope of the raw weigh-ins in the window (unbiased, just noisier).
  const settled = trendW.filter(p => p.t >= 30);
  const useTrend = settled.length >= ADAPTIVE_MIN_DAYS && daysBetween(settled[0].d, settled[settled.length - 1].d) >= 9;
  const lbPerDay = useTrend ? slope(settled, 'trend') : slope(trendW, 'w');
  const days = daysBetween(fromS, toS) + 1;
  const tdee = avgIntake - lbPerDay * KCAL_PER_LB_TREND;
  if (!fin(tdee) || tdee < 1000 || tdee > 7000) {
    return { tdee: null, days, confidence: 'low', note: 'Logged intake and weight change do not add up to a believable burn (check for missing food days or a scale change).',
      avgIntake: Math.round(avgIntake), lbPerWeek: Math.round(lbPerDay * 70) / 10, weighIns: trendW.length, foodDays, from: fromS, to: toS };
  }
  const coverage = Math.min(foodDays, trendW.length) / days;
  const confidence = foodDays >= 21 && trendW.length >= 14 && coverage >= 0.6 ? 'high' : foodDays >= 14 && trendW.length >= 10 ? 'medium' : 'low';
  const lbPerWeek = Math.round(lbPerDay * 70) / 10;
  return {
    tdee: Math.round(tdee), days, confidence,
    note: `From ${foodDays} days of food logs and ${trendW.length} weigh-ins (${fromS} to ${toS}): you ate ~${Math.round(avgIntake)} kcal/day and your trend weight moved ${lbPerWeek >= 0 ? '+' : ''}${lbPerWeek} lb/week, so you burn about ${Math.round(tdee)} kcal/day.`,
    avgIntake: Math.round(avgIntake), weightChangeLb: Math.round(lbPerDay * (days - 1) * 10) / 10, lbPerWeek,
    trendStart: Math.round(trendW[0].trend * 10) / 10, trendEnd: Math.round(trendW[trendW.length - 1].trend * 10) / 10,
    from: fromS, to: toS, weighIns: trendW.length, foodDays, method: useTrend ? 'trend' : 'raw',
  };
}

export const ADDERALL_TIPS = [
  'Eat a real breakfast BEFORE your dose kicks in (about 20-30 min after taking it). It is your easiest meal of the day.',
  'Drink your calories at midday: a shake (whey + banana + milk) goes down when solid food will not.',
  'Set phone reminders every 3 hours. You will not feel hungry, so eat by the clock.',
  'Plan for the evening rebound: appetite comes back as it wears off, so make dinner your biggest, most protein-dense meal.',
  'Use calorie-dense, easy foods during peak suppression: Greek yogurt, nut butter, cheese, trail mix, whole milk.',
  'If a meal is impossible, get a protein shake in at minimum. Protein matters most.',
  'Caffeine stacks with the appetite suppression. Keep coffee to the morning on days eating is hard.',
  'Train later in the day if you can. Lifting under peak suppression with no food in you makes sessions worse.',
  'Stay hydrated (dry mouth and stimulants increase needs). Keep a bottle on your desk.',
  'On days off the medication, eat more to make up for weekday deficits instead of treating it as a cheat day.',
];

// Each claim here is one the engine can stand behind; the numbers come from the same constants the
// model uses (PROTEIN_EVIDENCE, FAT_EVIDENCE, bodycomp.ENERGY_COMPENSATION), not from folklore.
export const NUTRITION_TIPS = [
  'Protein first: about 1 g per lb of bodyweight every day (a bit more when cutting), split over 4-5 meals of 30-50 g. Lean mass stops improving past about 0.73 g/lb in the research (Morton 2018); 1 g/lb is the top of that range, so you are covered rather than guessing.',
  'Dietary fat does not make you fat — a calorie surplus does. At the same calories and protein, swapping carbs for fat barely moves body composition. What fat does do is support testosterone and keep meals satisfying, so keep it at 20-35% of calories and do not drop below ~20% for long stretches.',
  'Creatine monohydrate, 5 g every day. Timing does not matter, consistency does.',
  'Getting ripped AND bigger is slow: expect the scale to move little while the mirror, waist and lifts improve.',
  'Judge progress over 2-4 weeks: morning bodyweight average, waist measurement and the progression log.',
  'If the weekly average weight and waist have not changed in 4 weeks and you want to lean out, cut about 200 kcal a day (from rest days first).',
  'Carbs are training fuel: put most of them around lifts and harder cardio.',
  'Adding cardio burns less than the number on the watch. Roughly a quarter of the calories from extra activity get cancelled out by your resting burn dropping (28% on average across 1,754 adults; Careau 2021), and the watch figure already includes the calories you would have burned sitting still. Cardio still works for fat loss — just count about three-quarters of it, and expect food to decide most of the outcome.',
  'Your marathon background means high cardio burn. On big cardio weeks, eat more or your lifts will stall.',
  'Sleep 7-8+ hours. It does more for recovery and fat loss than any supplement.',
  'Alcohol blunts muscle protein synthesis and sleep. Keep it occasional.',
  'Hit 80% consistency on protein and calories and you will make great progress. You do not need perfection.',
];

// Female-mode tips (§20). Iron: RDA 18 mg/day for women 19-50 vs 8 for men and after menopause (IOM 2001); iron
// deficiency in 15-35 % of female athlete cohorts vs 5-11 % of male (Sim 2019, Eur J Appl Physiol,
// doi:10.1007/s00421-019-04157-y). Cycle: luteal-phase resting burn is slightly higher (Benton 2020, PLoS One,
// doi:10.1371/journal.pone.0236025; no pooled kcal figure), and water retention moves the scale, so trend weight matters.
export const FEMALE_NUTRITION_TIPS = [
  'Protein first: about 1 g per lb of bodyweight a day (a bit more when cutting), split over 4-5 meals. Women need the same protein per kg as men (Morton 2018).',
  'Dietary fat does not make you fat — a calorie surplus does. At the same calories and protein, the carb/fat split barely moves body composition. Keep fat at 20-35% of calories for hormones, satiety and vitamin absorption.',
  'Adding cardio burns less than the number on the watch: about a quarter of the calories from extra activity are cancelled out by your resting burn dropping (Careau 2021), and the watch total already includes the calories you would have burned at rest.',
  'Iron: 18 mg a day before menopause (8 after). Red meat, beans and lentils, spinach plus vitamin C help. Low ferritin is common in women who train; a blood test tells you if you need a supplement.',
  'Don\'t under-fuel training: food minus exercise should stay above ~30 kcal per kg of lean mass a day. Missed or irregular periods are a warning sign, not a sign of progress.',
  'Scale weight can swing 1-3 lb across your cycle from water. Compare trend weight and waist over 2-4 weeks, or the same cycle phase month to month.',
  'Creatine monohydrate, 3-5 g a day, is safe and helps strength in women too, though the measurable lean-mass gain is smaller than in men.',
  'Calcium (1,000 mg a day, 1,200 after 50) and vitamin D support bone, which matters more for women, especially in a deficit.',
  'Judge progress over 2-4 weeks: morning bodyweight average, waist and hips, and the progression log.',
  'Carbs are training fuel: put most of them around lifts and harder cardio.',
  'Sleep 7-9 hours. It does more for recovery and fat loss than any supplement.',
  'Hit 80% consistency on protein and calories and you will make great progress. You do not need perfection.',
];
export function tipsFor(profile) {
  const female = sexOf(profile) === 'female';
  if (!female) return { nutrition: NUTRITION_TIPS, adderall: ADDERALL_TIPS };
  const onAdderall = (Array.isArray(profile?.supplements) ? profile.supplements : []).some(e => e && e.id === 'adderall' && e.active !== false && !e.end);
  return { nutrition: FEMALE_NUTRITION_TIPS, adderall: onAdderall ? ADDERALL_TIPS : null };
}
export function supplementsFor(profile) {
  if (sexOf(profile) !== 'female') return SUPPLEMENTS;
  const fs = femaleStatus(profile);
  return [...SUPPLEMENTS, { name: 'Iron (only if low)', dose: `RDA ${ironRda({ sex: 'female', menopause: fs.menopause, pregnant: fs.pregnant })} mg/day from food`, note: 'Supplement only if a blood test shows low ferritin (under ~30 ng/mL); extra iron when stores are full has no benefit and can upset your stomach.' }];
}

export const SUPPLEMENTS = [
  { name: 'Whey protein', dose: '1-2 scoops/day', note: 'The easiest way to hit protein, especially while appetite is suppressed.' },
  { name: 'Creatine monohydrate', dose: '5 g/day', note: 'The best-studied supplement for strength and muscle. Take it every day, any time.' },
  { name: 'Vitamin D3', dose: '1000-4000 IU/day', note: 'Take with a meal containing fat. A blood test tells you your actual dose.' },
  { name: 'Fish oil', dose: '1-3 g EPA+DHA/day', note: 'Useful if you rarely eat fatty fish.' },
  { name: 'Magnesium glycinate', dose: '200-400 mg before bed', note: 'May help sleep quality and cramps.' },
];

export const MEAL_IDEAS = {
  breakfast: ['3 eggs + toast + Greek yogurt (~450 kcal, 40 g P)', 'Oats with milk + 1 scoop whey + banana (~450 kcal, 40 g P)'],
  shake: ['Whey + banana + 8 oz milk (~350 kcal, 33 g P)', 'Whey + berries + 1 tbsp peanut butter + milk (~380 kcal, 35 g P)'],
  lunch: ['4-5 oz chicken + rice + veggies (~450 kcal, 40 g P)', 'Tuna or turkey sandwich + fruit (~420 kcal, 32 g P)'],
  preWorkout: ['Banana or rice cake + peanut butter (~120 kcal)'],
  dinner: ['6 oz sirloin + potato + broccoli (~550 kcal, 50 g P)', '5 oz salmon + rice + veggies (~550 kcal, 36 g P)'],
  bedtime: ['Cottage cheese + berries (~200 kcal, 21 g P)', 'Casein shake (~120 kcal, 24 g P)'],
};
