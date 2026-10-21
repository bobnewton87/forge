// "Raise your own testosterone" planner (CONTRACT §22). Pure, DOM-free, Node-testable.
//
// Bob: "a major thing I want and most men will want is to increase testosterone without direct testosterone
// injections — any of these therapies or pills that can do that we should accurately model based on the research,
// and we should recommend combinations that could be useful and attempt to determine combined interactions for
// muscle growth and fat loss."
//
// CONTRACT-NOTE: this module ranks by MODELED BODY COMPOSITION, not by the size of the testosterone rise. That is
//   deliberate: an aromatase inhibitor produces the biggest testosterone number in the catalogue and, per the
//   trials that measured it, zero muscle and (via Finkelstein 2013) a fat cost. Ranking by T would be wrong.
// CONTRACT-NOTE: every number comes back through the engines the rest of the app uses — modifiersAt() for the
//   hormones and project() for lean/fat — so a row's projection matches what Projection and Body will show once
//   the item is added. No parallel model lives here.
// CONTRACT-NOTE (§20 Female mode): these are male-axis therapies. tPlan() returns { female: true, hidden: true }
//   and no rows for a female profile, and the UI does not render the section at all.
import { SUPPLEMENTS, T_LAB_PANEL, isRx, itemFor, TOLERABILITY, worstTolerability, tolerabilityOf } from '../data/supplements.js';
import * as MET from '../engine/metabolic.js';
import { sexOf } from './sex.js';

const fin = x => typeof x === 'number' && Number.isFinite(x);
const num = (x, lo = -Infinity, hi = Infinity) => {
  if (x == null || x === '' || typeof x === 'boolean') return null;
  const n = Number(x); return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const parseDate = s => {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number); const dt = new Date(y, m - 1, d);
  return Number.isFinite(dt.getTime()) ? dt : null;
};
const ds = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (s, n) => { const d = parseDate(s) || new Date(); d.setDate(d.getDate() + n); return ds(d); };

// Items that replace your testosterone rather than raising your own: listed, never ranked here.
export const EXOGENOUS_IDS = ['trt', 'oral_tu', 'nasal_t'];
// Items that are in the catalogue because they LOWER it. Shown as costs, not as levers.
export const COST_IDS = ['endurance_load', 'alcohol', 'daa'];

// Single candidates: everything that can move a man's own testosterone, plus the well-known null ones, so a man
// who came here asking about tribulus sees "0%, and here is the trial" instead of nothing.
export const SINGLE_IDS = [
  'energy_availability', 'sleep_hygiene', 'fat_loss', 'resistance_training',
  'clomiphene', 'enclomiphene', 'hcg', 'aromatase_inhibitor', 'tamoxifen', 'cabergoline',
  'kisspeptin', 'pulsatile_gnrh',
  'ashwagandha', 'tongkat_ali', 'zma', 'vitamin_d', 'fenugreek', 'boron', 'dhea', 'daa',
  'tribulus', 'maca', 'shilajit', 'forskolin',
];

// Curated combinations. `when` keeps a combination off the list when it could not apply to this man at all
// (so an obese-only pairing doesn't clutter a lean man's list). Every one of these is modeled mechanistically —
// see combineEndogenous() — not by adding the singles up.
export const COMBOS = [
  { ids: ['sleep_hygiene', 'energy_availability'], name: 'Sleep 7–9 h + eat enough',
    why: 'The two central, reversible causes of a low number in a lean, hard-training man. Both raise the set-point, so they do add to each other — unlike the drugs.' },
  { ids: ['sleep_hygiene', 'energy_availability', 'ashwagandha'], name: 'Sleep + eat enough + ashwagandha',
    why: 'The best you can do without a prescription. The herb adds least, and adds it on top of a baseline the first two already raised.' },
  { ids: ['clomiphene', 'hcg'], name: 'Clomiphene + hCG',
    why: 'The combination people ask about most. Habous 2018 randomized it: clomiphene +158, hCG +134, both +153 ng/dL. The combination was no better than clomiphene alone (p=0.57).' },
  { ids: ['clomiphene', 'aromatase_inhibitor'], name: 'Clomiphene + aromatase inhibitor',
    why: 'The classic "SERM plus AI". They push the same lever (less estrogen feedback), so the testosterone effects do not add — and the AI still costs you estrogen action, which costs fat.' },
  { ids: ['hcg', 'aromatase_inhibitor'], name: 'hCG + aromatase inhibitor',
    why: 'Used to blunt the estradiol rise hCG causes. The AI adds no testosterone on top and brings its own fat and bone cost.' },
  { ids: ['enclomiphene', 'hcg'], name: 'Enclomiphene + hCG', why: 'Same shared pathway as clomiphene + hCG, with less of the estrogenic isomer.' },
  { ids: ['clomiphene', 'ashwagandha'], name: 'Clomiphene + ashwagandha', why: 'A supplement on top of a drug: the drug is far stronger and they share the same output, so the herb adds nothing measurable.' },
  { ids: ['sleep_hygiene', 'clomiphene'], name: 'Fix sleep + clomiphene',
    why: 'Lifestyle plus a drug. Fixing sleep raises the baseline first, which SHRINKS what clomiphene can add — the drug\'s response falls as the baseline rises.' },
  { ids: ['fat_loss', 'clomiphene'], name: 'Lose fat + clomiphene', why: 'First-line treatment plus the drug, for obesity-related low testosterone.', when: c => c.bmi != null && c.bmi >= 30 },
  { ids: ['fat_loss', 'aromatase_inhibitor'], name: 'Lose fat + aromatase inhibitor',
    why: 'The exact arm Colleluori 2020 randomized in severely obese hypogonadal men. It is the one population where lowering estradiol did not cost fat.', when: c => c.bmi != null && c.bmi >= 30 },
  { ids: ['cabergoline', 'clomiphene'], name: 'Treat prolactin + clomiphene', why: 'Fix the cause, then push the axis — only if prolactin is actually high.', when: c => c.prolactin != null && c.prolactin > MET.PROLACTIN_HIGH },
  { ids: ['zma', 'vitamin_d'], name: 'Correct zinc + vitamin D', why: 'Correcting real deficiencies. Does nothing if you are replete, which is most men.' },
];

// ============================================================ §22.9 the width of "normal", and scenarios
// Bob: "enclomiphene works for non hypogonadal males if there is some specific issue that is causing low T,
// it's game changing for a lot of people. I want the game changing results to be the default with the caveats."
//
// He is describing FUNCTIONAL SECONDARY HYPOGONADISM, which is a real clinical entity, not a loophole:
// Grossmann & Matsumoto 2017 (J Clin Endocrinol Metab 102:1067-75, doi:10.1210/jc.2016-3580) — "such men do not
// demonstrate anatomical hypothalamic-pituitary-testicular axis pathology but have functional hypogonadism that
// is POTENTIALLY REVERSIBLE". And it is exactly the population where the only body-composition result on a SERM
// was measured (Soares 2018: obese men, T 226 +/- 70, lean/fat-free/muscle mass all up).
//
// The harmonized reference range makes the point by itself. Travison 2017 (J Clin Endocrinol Metab 102:1161-73,
// doi:10.1210/jc.2016-2935) pooled 9,054 men across four US/European cohorts, cross-calibrated to the CDC
// reference method: in HEALTHY NON-OBESE men 19-39 the 2.5th/5th/50th/95th/97.5th percentiles are
// 264 / 303 / 531 / 852 / 916 ng/dL. End to end that is a 3.5-fold range, and a man at 350 is inside it while
// sitting at the 10th percentile and possibly far below his own set point.
//
// So Forge no longer leads with one invented point estimate. It leads with a BAND of scenarios. Each is
// labelled as a scenario and none of them is a claim about the man reading it; the assumed baseline is
// unchanged (`averageTotalT`), and his own level still drives every row below the band.
export const T_REFERENCE_RANGE = Object.freeze([264, 916]);
export const T_REFERENCE_PCTILE = Object.freeze([[2.5, 264], [5, 303], [50, 531], [95, 852], [97.5, 916]]);
export const T_REFERENCE_SOURCE = 'Travison 2017, 9,054 men, four cohorts, CDC-calibrated (doi:10.1210/jc.2016-2935); healthy non-obese men 19–39.';

// The therapies the band is computed for. Enclomiphene leads because it is the one Bob asked about, and the
// combination is included because it is the one people ask about most.
export const SCENARIO_IDS = Object.freeze(['enclomiphene', 'clomiphene', 'clomiphene+hcg']);

// Four baselines. LH is set normal in every one, because that is what makes the scenario SECONDARY/functional —
// the case these drugs treat. A raised LH is a different man and the planner fades the effect out for him.
export const SCENARIOS = Object.freeze([
  { key: 'suppressed', totalT: 300, lh: 3.2, label: 'Suppressed axis', short: '≈300 ng/dL', pctile: '≈5th percentile',
    headline: 'This is the population the muscle result was actually measured in.',
    body: 'Functional secondary hypogonadism: the axis is being held down by something — fat mass, sleep debt, under-eating, years of endurance volume, alcohol, opioids, a high prolactin — rather than by a testis or pituitary that cannot work. It is potentially reversible (Grossmann & Matsumoto 2017), and it is the population Soares 2018 randomized when it measured lean, fat-free and muscle mass going up on clomiphene. 300 ng/dL is at the bottom of the harmonized range (the 5th percentile is 303) and at the threshold the AUA and the Endocrine Society use to call testosterone low — note that it is still technically INSIDE the range, whose 2.5th percentile is 264.' },
  { key: 'lowNormal', totalT: 400, lh: 3.6, label: 'Low-normal', short: '≈400 ng/dL', pctile: '≈15th percentile',
    headline: 'Inside "normal" on the lab report, and still a long way below the middle of it.',
    body: 'This is the man the reference range hides. 400 ng/dL is not flagged by any laboratory, is well above the 264 cut-off, and is 131 ng/dL below the median healthy young man. If a reversible cause is doing that to him, he has the same thing wrong with him as the man at 300 — just less of it. Nobody has weighed a man starting here on a SERM.' },
  { key: 'average', totalT: 550, lh: 4.0, label: 'Population average', short: '≈550 ng/dL', pctile: '≈50th percentile',
    headline: 'The middle of the range — and the baseline Forge assumes when you have entered no lab.',
    body: 'Travison’s median for a healthy non-obese man aged 19–39 is 531 ng/dL. The hormone response here is measured (Tenover & Bremner 1991 took five healthy men from 519 to 1,390 ng/dL on clomiphene; Bremner 1987 took 490 to 980). What has never been measured is what that buys in muscle, because nobody has run a body-composition trial on a man who was not hypogonadal.' },
  { key: 'highNormal', totalT: 750, lh: 4.2, label: 'High-normal', short: '≈750 ng/dL', pctile: '≈85th percentile',
    headline: 'Little headroom, and the least reason to do anything.',
    body: 'A man already near the top of the range has the smallest modeled rise (the measured SERM effect is a roughly constant number of ng/dL, so it is a shrinking percentage as the baseline climbs) and the furthest distance from any trial population. This row is here to show the gradient, not as an option.' },
]);

// ---------------------------------------------------- §22.9 reversible causes ("what may be holding yours down")
// A SERM and fixing the cause attack the same problem from opposite ends: the cause fix raises the set-point, the
// SERM overrides the feedback the cause is acting through. So the planner has to name the causes, say whether it
// can SEE each one in this man's data, and point at the catalogue item that models it.
//   status 'yes'     Forge can see it in what you entered
//   status 'no'      what you entered rules it out
//   status 'unknown' no data entered — which for most men is most of this list
const SUPPRESSORS = [
  { key: 'obesity', label: 'Carrying a lot of fat', fix: 'fat_loss',
    detect: c => c.bmi == null ? 'unknown' : c.bmi >= MET.OBESE_BMI ? 'yes' : 'no',
    text: 'The commonest reversible cause, and the one with the clearest reversal: adipose aromatase converts testosterone to estradiol, which feeds back on the hypothalamus. Weight loss raises it back, and the effect scales with how much is lost. Soares 2018 — the one trial that weighed anybody on a SERM — enrolled exactly these men.',
    said: { yes: 'Your BMI is in the obese range, so Forge models this as actively costing you testosterone.', no: 'Your BMI is below 30, so Forge models no cost from this.', unknown: 'Add your height and weight and Forge will model it.' } },
  { key: 'sleep', label: 'Sleep debt', fix: 'sleep_hygiene',
    detect: c => c.sleepHours == null ? 'unknown' : c.sleepHours < 7 ? 'yes' : 'no',
    text: 'One week of 5 hours a night cut daytime testosterone 10–15% in healthy young men (Leproult 2011). It reverses in days, it is free, and it is the first thing to fix before considering a drug.',
    said: { yes: 'You sleep under 7 hours, so Forge models a cost and a recovery from fixing it.', no: 'You already sleep 7 hours or more, so there is no restriction here to undo.', unknown: 'Enter your typical sleep and Forge will model it.' } },
  { key: 'energy', label: 'Under-eating / low energy availability', fix: 'energy_availability',
    detect: c => c.deficitKcal == null ? 'unknown' : c.deficitKcal >= 500 ? 'yes' : 'no',
    text: 'The fastest way for a lean, hard-training man to lower his own testosterone, and it reverses within days to weeks. The suppression curve Forge uses is an interpolation between a measured null at mild restriction (Koehler 2016) and the Friedl 2000 / Rossow 2013 extremes, so the middle of it is an assumption.',
    said: { yes: 'The deficit you entered is large enough that Forge models it suppressing your level.', no: 'The deficit you entered is small enough that the controlled studies found no testosterone change.', unknown: 'Forge models NO energy-availability cost because you have not entered a typical deficit. For a lean man on an appetite-suppressing medication with a high training load, that is the assumption most likely to be wrong.' } },
  { key: 'endurance', label: 'Years of endurance volume', fix: 'endurance_load',
    detect: c => c.enduranceMin == null ? 'unknown' : c.enduranceMin >= 240 ? 'yes' : c.enduranceMin >= 150 ? 'maybe' : 'no',
    text: 'The "exercise-hypogonadal male" picture: a persistent 25–50% lower resting testosterone that takes years of near-daily endurance training to appear and partly reverses when volume is cut (Hackney 2020). In a cohort of 196 runners it plateaued about 30–35% lower. It is central and comes with higher SHBG, so free testosterone falls a little further than total.',
    said: { yes: 'Your weekly cardio target is high enough that this is worth taking seriously.', maybe: 'Your cardio volume is moderate. This condition takes years of near-daily endurance training, so it is a question for a lab rather than a conclusion.', no: 'Your cardio volume is low enough that Forge models no cost.', unknown: 'Add it from the catalogue to see what your running volume might be costing.' } },
  { key: 'alcohol', label: 'A daily drinking habit', fix: 'alcohol',
    detect: c => (c.inStack && c.inStack.has('alcohol') ? 'yes' : 'unknown'),
    text: 'About three drinks a day for three weeks lowered testosterone roughly 7% in a randomized crossover. Occasional drinks are not the issue; a daily habit is.',
    said: { yes: 'It is in your stack, so its cost is modeled.', unknown: 'Add it from the catalogue if this is a daily habit and Forge will model the cost.' } },
  { key: 'prolactin', label: 'A raised prolactin', fix: 'cabergoline',
    detect: c => c.prolactin == null ? 'unknown' : c.prolactin > MET.PROLACTIN_HIGH ? 'yes' : 'no',
    text: 'A specific, treatable cause: a prolactin-secreting pituitary adenoma suppresses GnRH, and treating it with a dopamine agonist restores the axis. It is rare, it is the one cause here with a drug that fixes the cause itself, and it is invisible without the lab.',
    said: { yes: 'Your prolactin is above the reference range, so this is worth a doctor’s attention on its own account.', no: 'Your prolactin is normal, so there is nothing here to treat.', unknown: 'Prolactin is on the panel. Cabergoline does nothing unless this is high.' } },
  { key: 'opioids', label: 'Opioid medication', fix: null,
    detect: () => 'unknown',
    text: 'One of the best-documented causes and one of the most missed. Opioids suppress the axis by inhibiting GnRH synthesis and secretion; the prevalence of androgen deficiency on chronic opioid therapy runs between 20% and 80% depending on the drug, the dose, the duration and how low testosterone was defined (Kafel 2025, Andrology 13:2010-21, doi:10.1111/andr.70013). Forge does NOT model this — there is no catalogue item for it — so if it applies to you, every number here is too optimistic about your baseline.',
    said: { unknown: 'Not modeled by Forge. If you take opioids regularly, say so to whoever orders the panel.' } },
  { key: 'shbg', label: 'High SHBG hiding a low free testosterone', fix: null,
    detect: c => c.shbg == null ? 'unknown' : c.shbg > 57 ? 'yes' : 'no',
    text: 'Total testosterone can read mid-normal while the fraction that is actually available is low, because SHBG is holding it. SHBG rises with age, with under-eating and in endurance-trained men. This is the one case where a "normal" total genuinely misleads, and the fix is to measure free testosterone (equilibrium dialysis, or calculated from total T and SHBG) rather than to treat the total.',
    said: { yes: 'Your SHBG is above the usual adult male range, so your free testosterone matters more than your total.', no: 'Your SHBG is inside the usual range.', unknown: 'SHBG is on the panel, and Forge is assuming a mid-range value until you enter it.' } },
];

// Things about THIS man that make a below-average baseline plausible. Computed from his profile, never asserted
// as a diagnosis: the honest output is "plausible, and a lab would settle it".
function riskFlags(profile, ctx) {
  const out = [];
  const stack = ctx.inStack || new Set();
  if (ctx.enduranceMin != null && ctx.enduranceMin >= 150) {
    out.push({ key: 'endurance', label: 'A big endurance-running background',
      text: `Your weekly cardio target is ${Math.round(ctx.enduranceMin)} minutes. The exercise-hypogonadal picture takes years of near-daily endurance training to develop, and in the cohorts that have been measured it sits 25–35% below untrained men (Hackney 2020). That is enough on its own to move a man from the middle of the range into the low-normal band.` });
  }
  if (STIMULANT_IDS.some(id => stack.has(id))) {
    out.push({ key: 'stimulant', label: 'An appetite-suppressing stimulant',
      text: 'A prescribed stimulant blunts appetite, and the consequence Forge cares about here is not the drug itself — no trial has measured stimulant medication against testosterone — but what it does to how much you eat. Chronic under-eating is a measured suppressor of the axis, and it is the mechanism that connects this to your testosterone.' });
  }
  if (ctx.deficitKcal == null && out.length) {
    out.push({ key: 'lea', label: 'Low energy availability you have not quantified',
      text: 'The two above combine into the one cause Forge currently models at ZERO for you, because you have not entered a typical daily deficit. A lean, hard-training man whose appetite is chemically blunted is the textbook low-energy-availability case, and it is reversible within days to weeks. Entering a deficit in Metabolic values is the cheapest way to see what Forge thinks it is costing.' });
  }
  if (out.length) {
    out.push({ key: 'verdict', label: 'What this does and does not mean', verdict: true,
      text: `Taken together these make a baseline BELOW the ${Math.round(T_REFERENCE_PCTILE[2][1])} ng/dL median plausible for you specifically. They do not make it a fact. Forge is still assuming the population average for your age and will keep doing so until you enter a lab — one morning draw, fasted, 7–10 am, repeated on a separate day, settles it and replaces every assumed number on this page.` });
  }
  return out;
}
// Stimulants with an appetite effect that Forge models elsewhere (nutrition, projection).
const STIMULANT_IDS = ['adderall'];

// --------------------------------------------------------------------- labs
export function labStatus(profile) {
  const m = (profile && profile.metabolic) || {};
  const have = [], missing = [];
  for (const L of T_LAB_PANEL) (num(m[L.k], 0, 1e5) != null ? have : missing).push(L);
  return { have, missing, panel: T_LAB_PANEL, complete: missing.length === 0, decisive: num(m.totalT, 1, 5000) != null && num(m.lh, 0, 200) != null };
}

// ------------------------------------------------------------- §22.8 tolerability
// Bob asked whether enclomiphene is "better tolerated". Before this the planner had no field in which that
// question could be answered with a number, so the catalogue could only answer it in prose and the ranking
// could not see it at all. A row now carries:
//   grade / label      the worst grade among its items (a combination is as tolerable as its least tolerable part)
//   comparedWith       what that grade is relative to — a grade without a comparator is meaningless
//   headline, note     the one-line finding and the caveats that decide what it is worth
//   events[]           every rate with its denominator, and the comparator arm's rate where one exists
//   rank               used ONLY as a late tiebreak below, never to override measured lean/fat
// Items with no tolerability block contribute nothing (most of the catalogue: sleep, food, herbs).
function tolerabilityFor(items) {
  const t = worstTolerability(items);
  if (!t) return null;
  const meta = TOLERABILITY[t.grade] || TOLERABILITY.unknown;
  // Which of this row's items carry data at all, so the UI can say "graded on clomiphene" for a combination.
  const from = items.filter(i => tolerabilityOf(i)).map(i => i.name.split(' (')[0]);
  return { grade: t.grade, label: meta.label, short: meta.short, rank: meta.rank, explain: meta.text,
    comparedWith: t.comparedWith || null, headline: t.headline || null, note: t.note || null,
    evidence: t.evidence || 'none', discontinuation: t.discontinuation || null,
    events: Array.isArray(t.events) ? t.events : [], sources: Array.isArray(t.sources) ? t.sources : [], from };
}

// --------------------------------------------------------------------- core
function entriesFor(ids, start) {
  return ids.map(id => ({ id, start, end: null, dose: null, active: true }));
}
function sameMods(a, b) {
  if (!a || !b) return false;
  for (const k of ['leanCeilingMult', 'leanRetentionMult', 'partitionShift', 'tdeeDelta', 'intakeDelta', 'waterLb', 'leanDirectLbPerWeek', 'fatDirectLbPerWeek']) {
    if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-9) return false;
  }
  return Math.abs((a.testosterone?.level || 0) - (b.testosterone?.level || 0)) < 0.5;
}

/**
 * tPlan(profile, opts) → ranked ways to raise this man's own testosterone.
 *
 * opts: { now, age, bodyweightLb, baseline, sessions, bodyLog, foodLog, weeks = 52,
 *         projectFn (PJ.project), modifiersFn (MET.modifiersAt), maxProjections = 16 }
 */
export function tPlan(profile, opts = {}) {
  profile = profile && typeof profile === 'object' ? profile : {};
  const sex = sexOf(profile);
  const now = parseDate(opts.now) || new Date();
  const today = ds(now);
  const weeks = num(opts.weeks, 4, 520) ?? 52;
  const modsFn = typeof opts.modifiersFn === 'function' ? opts.modifiersFn : MET.modifiersAt;
  const projectFn = typeof opts.projectFn === 'function' ? opts.projectFn : null;
  const labs = labStatus(profile);

  if (sex === 'female') {
    // §20: male-axis therapies. Never recommended to women, never ranked, never rendered.
    return { female: true, hidden: true, rows: [], labs, assumptions: [], notes: [], wada: WADA_NOTE,
      why: 'These are therapies for the male hypothalamic–pituitary–testicular axis. None of them has been shown to build muscle in women, and raising a woman\'s own testosterone within the female range did not change lean mass (Huang 2014). Forge does not recommend them to women.' };
  }

  const bw = num(opts.bodyweightLb, 60, 600) ?? num(profile.bodyweight, 60, 600) ?? null;
  const age = num(opts.age, 10, 120) ?? null;
  const modOpts = { age, bodyweightLb: bw, inDeficit: false };
  const base = modsFn(profile, today, modOpts);
  const lv = base.levels || {};
  const ctxFacts = { bmi: MET.bmiOf(profile, bw), prolactin: num(lv.prolactin, 0, 5000), lh: num(lv.lh, 0, 200),
    totalT: num(lv.totalT, 1, 5000), tAssumed: lv.totalTSource === 'assumed', sleepHours: num(lv.sleepHours, 0, 16),
    deficitKcal: num(lv.deficitKcal, 0, 4000), estradiol: num(lv.estradiol, 0, 1000),
    // §22.9: the two extra facts the reversible-cause list and the risk flags read.
    shbg: num((profile.metabolic || {}).shbg, 1, 300), enduranceMin: num(profile.cardioTargetMin, 0, 2000) };

  const inStack = new Set((Array.isArray(profile.supplements) ? profile.supplements : [])
    .filter(e => e && e.active !== false && (!e.end || e.end > today)).map(e => e.id));
  ctxFacts.inStack = inStack;
  const onExogenous = EXOGENOUS_IDS.some(id => inStack.has(id));

  // Reference projection: what happens if he changes nothing.
  const canProject = !!(projectFn && opts.baseline && opts.baseline.weightLb);
  const projArgs = { baseline: opts.baseline, profile, sessions: opts.sessions, weeks, now, bodyLog: opts.bodyLog, foodLog: opts.foodLog };
  let ref = null;
  if (canProject) { try { ref = projectFn(projArgs); } catch (e) { ref = null; } }
  const refSum = ref && ref.summary ? { lean: Number(ref.summary.leanLb) || 0, fat: Number(ref.summary.fatLb) || 0 } : null;
  const midDate = addDays(today, Math.round(weeks * 7 / 2));
  const refMid = modsFn(profile, midDate, modOpts);

  let projections = 0;
  const maxProj = num(opts.maxProjections, 0, 60) ?? 16;

  const buildRow = cand => {
    const ids = cand.ids;
    const items = ids.map(id => SUPPLEMENTS[id]).filter(Boolean);
    if (items.length !== ids.length) return null;
    const already = ids.every(id => inStack.has(id));
    const addIds = ids.filter(id => !inStack.has(id));
    const list = Array.isArray(profile.supplements) ? profile.supplements : [];
    // Not in the stack: what adding it would do. Already in the stack: what it is currently contributing, which is
    // the same comparison run the other way round, so the row keeps its place and the button becomes "Remove".
    const p2 = already
      ? { ...profile, supplements: list.filter(x => !(x && ids.includes(x.id) && x.active !== false && (!x.end || x.end > today))) }
      : { ...profile, supplements: [...list, ...entriesFor(addIds, today)] };
    const mid = already ? refMid : modsFn(p2, midDate, modOpts);
    const end = modsFn(already ? profile : p2, addDays(today, weeks * 7), modOpts);
    const t = end.testosterone || {};
    const t0 = num(t.natural, 1, 1e5) ?? ctxFacts.totalT ?? 550;

    // Does anything move at all? If not, say so and skip the expensive projection.
    const moves = already ? !sameMods(modsFn(p2, midDate, modOpts), refMid) : !sameMods(mid, refMid);
    const sign = already ? -1 : 1;             // for an in-stack row, p2 is "without it", so flip the comparison
    let lean = 0, fat = 0, projected = false;
    if (moves && canProject && projections < maxProj) {
      try {
        const r = projectFn({ ...projArgs, profile: p2 });
        if (r && r.summary && refSum) {
          lean = sign * ((Number(r.summary.leanLb) || 0) - refSum.lean);
          fat = sign * ((Number(r.summary.fatLb) || 0) - refSum.fat);
          projected = true; projections++;
        }
      } catch (e) { projected = false; }
    }
    if (moves && !projected) {
      // Fallback when no body baseline exists yet: the direct lean/fat the stack adds over the horizon, plus the
      // change in the training-driven ceiling applied to a nominal 1 lb/month of natural gain. Clearly rougher.
      const tl = MET.stackTimeline(p2, { from: today, weeks, age, bodyweightLb: bw });
      const tlRef = MET.stackTimeline(profile, { from: today, weeks, age, bodyweightLb: bw });
      lean = sign * ((tl.cumLeanDirect - tlRef.cumLeanDirect) + (tl.avgCeiling - tlRef.avgCeiling) * (weeks / 4.345));
      fat = sign * (tl.cumFatDirect - tlRef.cumFatDirect);
    }

    // Range: scale the lean/fat point estimate by the log-level ratio at the two ends of the T confidence interval.
    const ln = x => Math.log(Math.max(1, x) / Math.max(1, t0));
    const dLn = ln(t.level ?? t0);
    const scale = v => Math.abs(dLn) < 1e-6 ? [v, v]
      : [v * (ln(t.levelLo ?? t.level ?? t0) / dLn), v * (ln(t.levelHi ?? t.level ?? t0) / dLn)];
    let [leanLo, leanHi] = scale(lean);
    let [fatLo, fatHi] = scale(fat);
    if (t.extrapolated) {
      leanLo = Math.min(0, lean);   // zero is what has actually been measured for these items
      fatHi = Math.max(0, fat);     // ...and the same honesty in the fat direction
    }
    if (leanLo > leanHi) [leanLo, leanHi] = [leanHi, leanLo];
    if (fatLo > fatHi) [fatLo, fatHi] = [fatHi, fatLo];

    // Evidence grade and body-composition class describe the items that are actually DOING something in this
    // man — a combination whose only working part is a herb must not inherit sleep's "strong".
    const contribIds = new Set((mid.contributions || []).filter(c => ids.includes(c.id) && c.role && c.role !== 'zero').map(c => c.id));
    const actingIds = contribIds.size ? [...contribIds] : ids;
    const acting = actingIds.map(id => SUPPLEMENTS[id]).filter(Boolean);
    const bc = acting.map(i => i.model?.bodyComp).filter(Boolean);
    const evidenceOrder = { strong: 4, moderate: 3, weak: 2, preclinical: 1, refuted: 1, none: 0 };
    const evidence = acting.map(i => i.evidence).sort((a, b) => (evidenceOrder[a] ?? 0) - (evidenceOrder[b] ?? 0))[0];
    const why = [];
    for (const c of (mid.contributions || [])) if (ids.includes(c.id) && c.text) why.push(c.text);
    if (onExogenous) why.unshift('You are on exogenous testosterone, which suppresses your own production. Nothing that works through your own axis does anything while you are on it.');

    return {
      id: ids.join('+'), ids, name: cand.name || items.map(i => i.name.split(' (')[0]).join(' + '),
      combo: ids.length > 1, rationale: cand.why || null, inStack: already, partlyInStack: !already && addIds.length < ids.length,
      // An item can be classed 'measured' in the catalogue and still be EXTRAPOLATED for this particular man:
      // clomiphene's body composition was measured in obese men who ended near 500 ng/dL, so a eugonadal man
      // taken to 800 is past the evidence even though the item's class says 'measured'. The per-man flag from
      // combineEndogenous wins, both for the badge and for the ranking score below.
      rx: items.some(isRx), evidence,
      bodyComp: t.extrapolated ? 'extrapolated' : bc.includes('measured') ? 'measured' : bc.includes('extrapolated') ? 'extrapolated' : 'none',
      extrapolated: !!t.extrapolated, cost: ids.some(id => COST_IDS.includes(id)),
      applies: moves || already,
      t: { from: Math.round(t0), to: Math.round(t.level ?? t0), lo: Math.round(t.levelLo ?? t.level ?? t0), hi: Math.round(t.levelHi ?? t.level ?? t0),
        credited: Math.round(t.leanLevel ?? t.level ?? t0),
        // The starting number is a population average until he enters a lab. Every figure on the row is
        // downstream of it, so the row has to say so (estradiol already did; total T did not).
        assumed: num((profile.metabolic || {}).totalT, 1, 5000) == null },
      freeT: { from: t.freeTBase != null ? r1(t.freeTBase) : null, to: t.freeT != null ? r1(t.freeT) : null },
      e2: { from: t.estradiolBase != null ? r1(t.estradiolBase) : null, to: t.estradiol != null ? r1(t.estradiol) : null, assumed: !!t.estradiolAssumed, actionDrop: t.e2ActionDrop || 0 },
      shbg: t.shbg != null ? r1(t.shbg) : null,
      lean: { lb: r2(lean), lo: r2(leanLo), hi: r2(leanHi) },
      fat: { lb: r2(fat), lo: r2(fatLo), hi: r2(fatHi) },
      // §22.9 THE NUMBER THE ROW LEADS WITH. It is the modeled CENTRAL estimate of net lean-minus-fat with its
      // range, and it is deliberately NOT `score` below. `score` is a RANKING rule that pins an unmeasured item
      // to the conservative end of its own range; putting it in the headline made a row announce "±0 lb net"
      // directly above its own body saying "+4.4 lb lean", which is incoherent and read as "this does nothing".
      // Ranking may be conservative; the displayed number must be the estimate. The honesty lives in the range
      // (which still starts at zero for an unmeasured item), the Extrapolated badge and the notes.
      net: { lb: r2(lean - fat), lo: r2(leanLo - fatHi), hi: r2(leanHi - fatLo) },
      projected, weeks,
      // Ranking score. An item whose body-composition effect has never been MEASURED is ranked on the
      // conservative end of its own range (which is zero), not on the mid-point of an extrapolation
      // through the T->lean curve. Otherwise a drug with a published T rise and no body-composition
      // trial outranks everything that has actually been measured. The mid-point still shows on the row.
      score: r2(bc.includes('measured') && !t.extrapolated ? lean - fat : leanLo - fatHi),
      // §22.8 tolerability. The row's grade is the WORST among the items actually doing something in this man —
      // a combination is only as tolerable as its least tolerable part — and it travels with the comparator it
      // was graded against, because a tolerability grade without one means nothing. `items`, not `acting`: an
      // item gated to zero on testosterone still has to be swallowed, so its side effects still count.
      tolerability: tolerabilityFor(items),
      why, monitor: [...new Set(items.flatMap(i => i.model?.monitor || []))],
      suits: items.map(i => i.model?.suits).filter(Boolean), notSuits: items.map(i => i.model?.notSuits).filter(Boolean),
      wada: [...new Set(items.map(i => i.model?.wada).filter(w => w && !/^not prohibited/i.test(w)))],
      fertility: items.map(i => i.model?.fertility).filter(Boolean),
      bcNote: items.map(i => i.model?.bcNote).filter(Boolean),
      warnings: (mid.warnings || []).filter(w => items.some(i => w.includes(i.name.split(' (')[0]))),
    };
  };

  // `only` builds a named subset of the candidates. Used by the scenario band below, which needs the same row
  // builder (so a scenario's numbers come through project() exactly like the man's own) without paying for 33 rows.
  const want = Array.isArray(opts.only) && opts.only.length ? new Set(opts.only) : null;
  const rows = [];
  for (const id of SINGLE_IDS) { if (want && !want.has(id)) continue; const r = buildRow({ ids: [id] }); if (r) rows.push(r); }
  for (const c of COMBOS) {
    if (want && !want.has(c.ids.join('+'))) continue;
    if (!want && typeof c.when === 'function' && !c.when(ctxFacts)) continue;
    const r = buildRow(c); if (r) rows.push(r);
  }
  // Rank by what it does to his body, not by the size of the testosterone number.
  // Ranking is still lean − fat first and evidence second; nothing about tolerability can promote a row over one
  // that is modeled to build more muscle on better evidence. But when two rows are otherwise tied — which is
  // exactly what happens to clomiphene and enclomiphene for a man with a normal testosterone, where both score
  // zero on 'moderate' evidence — the better-tolerated one goes first instead of whichever is earlier in the
  // alphabet. That is the question Bob actually asked, and the tiebreak is where it belongs.
  const evOrder = { strong: 4, moderate: 3, weak: 2, preclinical: 1, refuted: 1, none: 0 };
  rows.sort((a, b) => (b.score - a.score)
    || ((evOrder[b.evidence] ?? 0) - (evOrder[a.evidence] ?? 0))
    || ((b.tolerability?.rank ?? 0) - (a.tolerability?.rank ?? 0))
    || (Number(a.rx) - Number(b.rx))
    || a.name.localeCompare(b.name));

  const tAssumed = num((profile.metabolic || {}).totalT, 1, 5000) == null;
  const tAssumedLevel = Math.round(rows.length ? rows[0].t.from : (ctxFacts.totalT ?? 550));
  // ---- what to do first
  const actions = [];
  if (!labs.decisive) {
    actions.push({ id: 'labs', kind: 'labs', title: 'Get the panel before anything else',
      body: 'Everything below is gated on numbers you have not entered, so most of it reads as zero — which is honest, not useful. One morning draw changes that. Ask for it fasted, between 7 and 10 am, and repeat the testosterone on a separate day before acting on it: it is pulsatile and a single low reading means little.',
      labs: labs.missing.map(L => ({ k: L.k, label: L.label, why: L.why })) });
  }
  const assumptions = [...(base.assumptions || [])];
  if (ctxFacts.estradiol == null) assumptions.push(`Estradiol: assumed ${MET.ASSUMED_E2} pg/mL (mid adult male reference). It decides whether an aromatase inhibitor makes any sense at all.`);
  if (num((profile.metabolic || {}).shbg, 1, 300) == null) assumptions.push(`SHBG: assumed ${MET.ASSUMED_SHBG} nmol/L (mid adult male reference), used to compute free testosterone.`);
  if (ctxFacts.deficitKcal == null) assumptions.push('Typical daily calorie deficit: not entered, so Forge models no energy-availability cost. For a lean man on an appetite-suppressing medication with a high training load, that is the assumption most likely to be wrong.');

  // §22.9 scenario band. Computed by scenarioBand() below, which costs four more sub-plans and therefore runs
  // OFF the synchronous route render (the UI calls it from an idle callback and patches the card in place). It is
  // opt-in here so tests can ask for it inline.
  const scenarios = opts.band === true && !want ? scenarioBand(profile, opts) : null;
  // Reversible causes, and whether Forge can see each one in this man's data.
  const causes = want ? [] : SUPPRESSORS.map(sp => {
    const status = sp.detect(ctxFacts) || 'unknown';
    return { key: sp.key, label: sp.label, status, text: sp.text, said: sp.said[status] || sp.said.unknown || null,
      fix: sp.fix, fixName: sp.fix ? (SUPPLEMENTS[sp.fix]?.name.split(' (')[0] || null) : null, modeled: !!sp.fix };
  });
  const flags = want ? [] : riskFlags(profile, ctxFacts);

  const notes = [];
  if (onExogenous) notes.push('You have exogenous testosterone in your stack. It suppresses your own production, so every option here is modeled at zero until you come off it.');
  notes.push('Ranked by modeled 12-month lean and fat change, not by how much the testosterone number moves. Those are different lists: the aromatase inhibitor produces the biggest number here and, in the trials that measured it, no muscle at all.');

  return {
    tAssumed, tAssumedLevel,
    // §22.9: the band replaces "one assumed number" as the planner's opening statement; causes and flags say
    // what could put this man in a lower column than the one Forge is assuming for him.
    scenarios, causes, flags, referenceRange: T_REFERENCE_RANGE, referencePctile: T_REFERENCE_PCTILE,
    referenceSource: T_REFERENCE_SOURCE,
    female: false, hidden: false, labs, actions, rows, notes, assumptions, wada: WADA_NOTE,
    exogenous: EXOGENOUS_IDS.map(id => ({ id, name: SUPPLEMENTS[id]?.name })),
    facts: ctxFacts, weeks, projected: canProject, projections,
  };
}

/**
 * scenarioBand(profile, opts) → [{ ...SCENARIOS[i], rows, belowRange, yours }]
 *
 * §22.9. Instead of leading with one invented point estimate, lead with what the model says across the width of
 * "normal". Each scenario re-runs the SAME row builder against a synthetic profile whose only change is the
 * baseline (plus a normal LH, which is what makes it the secondary/FUNCTIONAL case these drugs treat), so a
 * scenario's lean and fat come through project() exactly like the man's own rows do — no parallel model.
 *
 * The assumed baseline for HIM is untouched (`averageTotalT`): every column is labelled as a scenario, and
 * `yours` marks whichever column is nearest his own level so the band never reads as a prediction about him.
 *
 * COST: four sub-plans, each with its own reference projection — about as much work again as tPlan() itself.
 * That is why the UI computes it after the first paint rather than inside it (CONTRACT §22.9).
 */
export function scenarioBand(profile, opts = {}) {
  profile = profile && typeof profile === 'object' ? profile : {};
  if (sexOf(profile) === 'female') return null;
  const now = parseDate(opts.now) || new Date();
  const today = ds(now);
  const inStack = new Set((Array.isArray(profile.supplements) ? profile.supplements : [])
    .filter(e => e && e.active !== false && (!e.end || e.end > today)).map(e => e.id));
  // On exogenous testosterone the whole own-axis question is moot and every column would read zero.
  if (EXOGENOUS_IDS.some(id => inStack.has(id))) return null;
  const labBefore = addDays(today, -120);
  // His own level: the entered lab if there is one, otherwise the same population average tPlan() assumes.
  const own = num((profile.metabolic || {}).totalT, 1, 5000) ?? MET.averageTotalT(num(opts.age, 10, 120) ?? 39);
  // Every column in the band is a SECONDARY (functional) case, because that is the only kind these drugs treat.
  // A man whose own LH is clearly raised alongside a low testosterone is not in that premise at all: the signal
  // is already maximal and is not being acted on, so none of these columns is about him and the band must not
  // flag one as "closest to you". His own rows below already model this correctly at zero; without this the band
  // would be the one place on the page that contradicts them.
  const ownLh = num((profile.metabolic || {}).lh, 0, 200);
  const outsidePremise = ownLh != null && ownLh > MET.LH_PRIMARY && own < MET.LOW_T;
  const whyNot = outsidePremise
    ? `Your own LH (${ownLh} IU/L) is clearly raised while your testosterone is low. Every column below is a SECONDARY case — the pituitary signal is not being sent — and that is the only kind these drugs treat. Your pattern is the other kind: the signal is already being shouted and is not being acted on. So none of these columns is about you, and Forge has not marked one as yours. (That is about how your testes respond to the signal, not how they look or feel — see the LH note on the lab panel.) The band is still here because it is the honest picture of who these drugs help.`
    : null;
  return SCENARIOS.map(sc => {
    // labDate is set 120 days back so the engine does not treat the synthetic lab as "drawn while on therapy"
    // (which would suppress the item's modeled effect) — see the labAfter branch in modifiersAt.
    const synth = { ...profile, metabolic: { ...(profile.metabolic || {}), totalT: sc.totalT, lh: sc.lh, labDate: labBefore, onTrtT: null } };
    let sub = null;
    try { sub = tPlan(synth, { ...opts, band: false, only: SCENARIO_IDS, maxProjections: 6 }); } catch (e) { sub = null; }
    const rows = (sub?.rows || []).filter(r => SCENARIO_IDS.includes(r.id))
      .sort((a, b) => SCENARIO_IDS.indexOf(a.id) - SCENARIO_IDS.indexOf(b.id))
      .map(r => ({ id: r.id, name: r.name, net: r.net, lean: r.lean, fat: r.fat, t: r.t, bodyComp: r.bodyComp,
        extrapolated: r.extrapolated, evidence: r.evidence, rx: r.rx,
        tolerability: r.tolerability ? { grade: r.tolerability.grade, short: r.tolerability.short } : null }));
    return { ...sc, rows,
      // At or under the harmonized 5th percentile (303 ng/dL) — i.e. the bottom of the range, and at or below
      // the ~300 ng/dL threshold the AUA and Endocrine Society use to define low testosterone. NOT "outside the
      // range": the harmonized 2.5th percentile is 264, so 300 is still technically inside it, which is exactly
      // the confusion this band exists to clear up.
      lowEnd: sc.totalT <= T_REFERENCE_PCTILE[1][1],
      belowRange: sc.totalT < T_REFERENCE_RANGE[0],
      notApplicable: outsidePremise, whyNot,
      yours: !outsidePremise && own != null && SCENARIOS.every(o => Math.abs(o.totalT - own) >= Math.abs(sc.totalT - own)) };
  });
}

export const WADA_NOTE = 'If you ever race in a drug-tested event: SERMs and other anti-estrogens (clomiphene, enclomiphene, tamoxifen) are WADA-prohibited at all times under S4.2, aromatase inhibitors under S4.1, hCG in males under S2.2, and testosterone by any route under S1. Ashwagandha, tongkat ali, cabergoline, sleep and food are not prohibited.';

// Convenience for the UI: the stack entries a row (or a bare list of ids) would add.
export function rowEntries(row, today) { return entriesFor(Array.isArray(row) ? row : (row?.ids || []), today); }
