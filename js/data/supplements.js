// Supplements, therapies & research compounds catalogue (SUPP, CONTRACT §17 + §17 amendment). Pure data, DOM-free.
//
// CONTRACT-NOTE: every modeled item is level/dose-driven. `model` keeps the contract fields
//   (leanCeilingMult, leanRetentionMult, partitionShift, tdeeDelta, intakeDelta, waterLb, rampWeeks,
//   requiresLab, leanDirectLbPerWeek, fatDirectLbPerWeek) as the FULL effect at response = 1 (the
//   default/studied dose for a ~165 lb man), plus these extras read by js/engine/metabolic.js:
//     kind: 'generic' | 'testosterone' | 'tShift' | 'vitaminD' | 'none'
//     dose: { unit, default, label, studied:[lo, hi], note }   default = studied/common dose, shown as context
//     response: [[dose, fraction 0..1], ...]                     linear interpolation, PLATEAU beyond the last anchor
//     rampByDose: [[dose, weeks]]                                time to full effect depends on dose (creatine, GLP-1 escalation)
//     waterRampWeeks                                             water can arrive faster than the tissue effect
//     taperAfterWeeks / taperTauWeeks                            direct lean/fat effects are not extrapolated past the studied duration
//     intakePctOfMaint                                           GLP-1: appetite effect as a share of maintenance (bodyweight × 15 kcal)
//     tPct / tPctLowT                                            tShift: % change in serum total T (normal / low baseline)
//     ngPer100IU, maxSerum                                       vitaminD: serum rise per 100 IU/day at steady state
//     doseToLevel: [[mg/week, ng/dL]]                            testosterone: dose → mean nadir serum T (Bhasin 2001), used only without a lab
//     levelRisks: [{ min, text }]                                risks that apply at/above a dose (or serum level for testosterone)
// CONTRACT-NOTE (§22 Natural testosterone therapies): every item that moves a man's OWN testosterone also carries
//   the fields the interaction engine and the planner read (docs/research/endogenous-testosterone.md §8–§10):
//     axis: 'serm'|'ai'|'gonadotropin'|'dopamine'|'nutrient'|'lifestyle'|'herbal'|'exogenous'
//       'serm'|'ai'|'gonadotropin'|'herbal' are LH-DRIVEN: they share one final common path (Leydig output), so they
//       combine NON-ADDITIVELY (Habous 2018) and are bound by a testicular-capacity ceiling.
//       'dopamine'|'nutrient'|'lifestyle' are CAUSE-CORRECTION: they raise the baseline/set-point itself, are applied
//       first, and therefore SHRINK what an LH-driven drug can still add (its response falls with baseline).
//     ceilingNg                 the highest serum total T this route can plausibly reach (per-route plateau)
//     tCI: [lo, hi]             the trial/meta CI on the modeled T rise, as a multiple of the point estimate
//     e2Pct                     modeled % change in serum estradiol at full effect (null = not modeled)
//     e2ActionPct               modeled % change in estrogen ACTION (only aromatase inhibitors: synthesis blocked).
//                               Finkelstein 2013's fat term is driven by this, never by a SERM's serum-E2 rise.
//     shbgDelta                 modeled change in SHBG (nmol/L); free T is then computed with Vermeulen
//     bodyComp: 'measured'|'extrapolated'|'none'
//       'measured'     trials of THIS item measured body composition → credit up to bcMaxLevel (what they reached)
//       'extrapolated' no body-composition data, but a measured T rise → run through the Bhasin T→lean curve,
//                      bounded by the highest serum T this item's own trials reached, and LABELLED an extrapolation
//       'none'         trials measured body composition and found none → tLeanShare 0
//     bcMaxLevel                the serum T up to which muscle is credited (see bcNote for where the number comes from)
//     monitor: [labs], fertility, timeCourse, wada, suits, notSuits   (shown by the planner, never computed from)
// CONTRACT-NOTE (§22.8 Tolerability, added 2026-10-20): "better tolerated" is a claim people make about these
//   drugs constantly, and before this the catalogue had no way to express it, so it could only be a vibe. Every
//   item that has comparative or placebo-controlled adverse-event data now carries `model.tolerability`:
//     grade: 'good'|'moderate'|'poor'|'unknown'   'unknown' is a real answer and is used wherever nobody has measured it
//     comparedWith: string        WHAT the grade is relative to — a grade with no comparator is meaningless
//     evidence: 'rct'|'observational'|'none'      how the AE numbers were collected
//     discontinuation: { pct, n, of, note, source } | null     stopped-for-an-adverse-event rate, WITH its denominator
//     events: [{ label, pct, n, of, arm, vs?: { pct, n, of, label }, p?, source }]
//                                 every rate carries n/of so the reader can see it is 2 men out of 66, not "3%"
//     note: string                the caveats that decide how much the numbers are worth
//     sources: [string]
//   Rules, same spirit as the rest of §22: no rate without a denominator; no grade without a comparator; a
//   difference that was not statistically significant is reported as not significant; and where the only
//   comparison is retrospective and unblinded, the grade is capped at 'moderate' however good the numbers look.
// CONTRACT-NOTE: `rx: true` marks every item that needs a prescriber. The group can be excluded wholesale from a
//   build (isRx / RX_IDS) without touching the rest of the catalogue.
// CONTRACT-NOTE: category 'peptide' also holds SARMs (research compounds); the UI labels the group
//   "Peptides & research compounds". typicalUse is null for every unapproved compound; `dose.default`
//   is the dose used in the cited trial, shown as "studied dose", never as a recommendation.

const WADA = 'WADA Prohibited List (World Anti-Doping Agency), current edition.';
// CORRECTED 2026-10-20 while verifying enclomiphene's status against the FDA primary documents (§22.8). Both
// lists were downloaded and read, and the single shared "Category 2, 2023" citation was wrong for one of the
// two items that used it:
//   - Ipamorelin acetate IS in 503B Category 2, dated 29 Sep 2023 (503B list updated 21 Mar 2025). Correct in
//     substance, but it is the 503B list, not 503A, and the entry did not say so.
//   - BPC-157 is NOT in Category 2 on either list. Its nomination was WITHDRAWN; FDA's safety-risks page lists
//     it among withdrawn nominations with an immunogenicity concern and says it "lacks sufficient information
//     to know whether the drug would cause harm" — which is a weaker and different statement.
// For reference, 503A Category 2 (list updated 14 May 2026) is: cesium chloride, domperidone, germanium
// sesquioxide, ibutamoren mesylate, kisspeptin-10, and quinacrine for intrauterine administration.
const FDA_CAT2_503B = 'U.S. FDA. Bulk drug substances nominated for use in compounding under section 503B — Category 2 (substances that raise significant safety risks), entry dated 29 September 2023; list updated 21 March 2025.';
const FDA_WITHDRAWN = 'U.S. FDA. Safety risks associated with certain bulk drug substances nominated for use in compounding — table of withdrawn nominations (page current 22 April 2026).';

export const EVIDENCE = {
  strong: { label: 'Strong evidence', short: 'Strong', text: 'Several meta-analyses of randomized trials agree.' },
  moderate: { label: 'Moderate evidence', short: 'Moderate', text: 'Randomized trials support it, with caveats (size, population or consistency).' },
  weak: { label: 'Weak evidence', short: 'Weak', text: 'Small, short or industry-funded trials, or results that do not replicate.' },
  refuted: { label: 'Tested and found not to work', short: 'No effect', text: 'Randomized trials in the relevant people found no benefit, or a negative effect.' },
  preclinical: { label: 'Animal or lab research only', short: 'Preclinical', text: 'Promising in animals or cells; no human results yet.' },
  none: { label: 'No human evidence', short: 'None', text: 'Animal studies, mechanisms or anecdotes only.' },
};

export const CATEGORIES = [
  { id: 'supplement', label: 'Supplements', icon: '🧴' },
  { id: 'lifestyle', label: 'Lifestyle', icon: '🌙' },
  { id: 'prescription', label: 'Prescription', icon: '℞' },
  { id: 'peptide', label: 'Peptides & research compounds', short: 'Peptides & SARMs', icon: '🧪' },
];

const LIST = [
  // ============================================================ SUPPLEMENTS
  {
    id: 'creatine', name: 'Creatine monohydrate', category: 'supplement', evidence: 'strong',
    status: 'OTC dietary supplement, extensively studied',
    summary: 'The one OTC supplement with a clear muscle effect. Trained alongside lifting, it adds about 1 kg (2 lb) more lean mass than placebo over typical 8–12+ week blocks. Part of that is water stored inside muscle, and about 1 in 4 people barely respond.',
    mechanism: 'Raises muscle phosphocreatine stores by ~20%, so you regenerate ATP faster between reps and sets. That buys roughly 1–2 extra reps per set, and more quality volume over months means a bit more growth. Muscle cells also pull in water as creatine stores fill.',
    effects: [
      '+1–2 lb scale weight in the first 1–3 weeks: water inside muscle, not fat.',
      '≈ +1 kg lean mass vs placebo over 8–12+ weeks with lifting (meta-analyses), part of it intracellular water.',
      'Small strength and repeated-sprint gains; most consistent in the upper body.',
      'Dose plateaus once muscle is saturated: 20 g/day only gets you there faster (about a week instead of 3–4), not further.',
    ],
    risks: [
      'Very safe at 3–5 g/day in healthy people (ISSN review of 500+ trials).',
      'Raises serum creatinine (a lab artifact, not kidney damage). Tell your doctor you take it before kidney labs.',
      'Loading doses can cause stomach upset; just take 3–5 g/day.',
      'Non-responders (~20–30%) already have high muscle creatine and see little effect.',
    ],
    typicalUse: 'Creatine monohydrate 3–5 g/day, any time of day, every day',
    sources: [
      'Kreider RB, et al. International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine. J Int Soc Sports Nutr. 2017;14:18.',
      'Delpino FM, et al. Influence of age, sex, and type of exercise on the efficacy of creatine supplementation on lean body mass: a systematic review and meta-analysis of randomized clinical trials. Nutrition. 2022;103-104:111791.',
      'Burke R, et al. The effects of creatine supplementation combined with resistance training on regional measures of muscle hypertrophy: a systematic review with meta-analysis. Nutrients. 2023;15(9):2116.',
      'Hultman E, et al. Muscle creatine loading in men. J Appl Physiol. 1996;81(1):232-237.',
      'Syrotuik DG, Bell GJ. Acute creatine monohydrate supplementation: a descriptive physiological profile of responders vs. nonresponders. J Strength Cond Res. 2004;18(3):610-617.',
      'Antonio J, et al. Common questions and misconceptions about creatine supplementation: what does the scientific evidence really show? J Int Soc Sports Nutr. 2021;18:13.',
    ],
    model: {
      kind: 'generic',
      dose: { unit: 'g/day', default: 5, label: 'common dose', studied: [2, 25], note: 'Saturation plateau: above ~3–5 g/day the end state is the same.' },
      response: [[0, 0], [1, 0.35], [2, 0.7], [3, 1]],
      rampByDose: [[1, 10], [2, 6], [3, 4], [5, 2.6], [10, 1.4], [20, 0.8]],
      waterRampWeeks: null,          // same as the saturation ramp
      leanCeilingMult: 1.12, waterLb: 1.6, rampWeeks: 4,
    },
  },
  {
    id: 'protein_powder', name: 'Protein powder (whey, casein, plant)', category: 'supplement', evidence: 'strong',
    status: 'OTC food product',
    summary: 'Protein powder is just convenient food. It helps only by getting you to your daily protein target, which matters a lot (Forge uses your protein setting in Nutrition). It has no effect beyond that.',
    mechanism: 'Supplies amino acids (especially leucine in whey) for muscle protein synthesis. Total daily protein is what counts; benefits level off around 1.6 g/kg (~0.7 g/lb), upper estimate ~2.2 g/kg (1 g/lb).',
    effects: [
      'No separate effect in the projection. Set your protein (g/lb) in Nutrition, and that is what the model uses.',
      'Useful on Adderall days: a shake goes down when solid food will not.',
    ],
    risks: ['Pick third-party tested brands (NSF Certified for Sport, Informed Sport); some products have contained heavy metals or undeclared ingredients.', 'Lactose in whey concentrate can upset some stomachs; isolate or plant blends help.'],
    typicalUse: '1–2 scoops/day as needed to reach your daily protein target',
    sources: [
      'Morton RW, et al. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. Br J Sports Med. 2018;52(6):376-384.',
      'Jäger R, et al. International Society of Sports Nutrition position stand: protein and exercise. J Int Soc Sports Nutr. 2017;14:20.',
    ],
    model: { kind: 'none', note: 'Counts toward total protein. The projection uses your protein setting.' },
  },
  {
    id: 'caffeine', name: 'Caffeine', category: 'supplement', evidence: 'strong',
    status: 'OTC; in coffee, tea, pre-workouts',
    summary: 'Reliably improves strength, endurance and focus during training. It burns a few extra calories, but the body gets used to it, so the long-run effect on fat is small.',
    mechanism: 'Blocks adenosine receptors, which lowers perceived effort and fatigue. Briefly raises metabolic rate (~3–4% for a few hours after 100 mg in lab studies), and regular users habituate.',
    effects: [
      'Performance: ~2–7% across strength, power and endurance at 3–6 mg/kg (umbrella review of 21 meta-analyses).',
      'Energy burn: modeled as +10 kcal/day per 100 mg (habituated), plateauing at 400 mg.',
      'Mild appetite blunting, which stacks with Adderall.',
    ],
    risks: [
      'Sleep: half-life ~5 h; caffeine after early afternoon cuts deep sleep even if you fall asleep fine.',
      'Stacks with Adderall: heart rate, blood pressure, jitteriness, and both suppress appetite.',
    ],
    typicalUse: '3–6 mg/kg about 45–60 min before training; most adults stay under 400 mg/day',
    sources: [
      'Guest NS, et al. International Society of Sports Nutrition position stand: caffeine and exercise performance. J Int Soc Sports Nutr. 2021;18:1.',
      'Grgic J, et al. Wake up and smell the coffee: caffeine supplementation and exercise performance—an umbrella review of 21 published meta-analyses. Br J Sports Med. 2020;54(11):681-688.',
      'Dulloo AG, et al. Normal caffeine consumption: influence on thermogenesis and daily energy expenditure in lean and postobese human volunteers. Am J Clin Nutr. 1989;49(1):44-50.',
      'U.S. FDA. Spilling the Beans: How Much Caffeine is Too Much? Consumer update (400 mg/day for healthy adults).',
    ],
    model: {
      kind: 'generic',
      dose: { unit: 'mg/day', default: 200, label: 'common intake', studied: [50, 600] },
      response: [[0, 0], [400, 1]],
      tdeeDelta: 40, rampWeeks: 0,
      levelRisks: [{ min: 400, text: 'Above ~400 mg/day: insomnia, anxiety, palpitations and higher blood pressure become common (FDA safety reference).' }],
    },
  },
  {
    id: 'beta_alanine', name: 'Beta-alanine', category: 'supplement', evidence: 'moderate',
    status: 'OTC dietary supplement',
    summary: 'Helps hard efforts lasting about 1–4 minutes (high-rep sets, intervals, rowing pieces). It doesn\'t build muscle by itself, and the effect on body composition is too small to project.',
    mechanism: 'Raises muscle carnosine (an acid buffer) by 40–60% over 4–10 weeks of daily use, delaying the burn in long sets.',
    effects: ['Small performance gain in 30 s–10 min efforts (meta-analysis effect size ~0.2).', 'No meaningful lean-mass effect: not modeled.'],
    risks: ['Harmless tingling (paresthesia) at higher single doses; split doses or sustained-release avoid it.'],
    typicalUse: '3.2–6.4 g/day in split doses, daily (timing does not matter)',
    sources: [
      'Trexler ET, et al. International Society of Sports Nutrition position stand: beta-alanine. J Int Soc Sports Nutr. 2015;12:30.',
      'Saunders B, et al. β-alanine supplementation to improve exercise capacity and performance: a systematic review and meta-analysis. Br J Sports Med. 2017;51(8):658-669.',
    ],
    model: { kind: 'none', note: 'Performance only; no body-composition effect large enough to project.' },
  },
  {
    id: 'citrulline', name: 'L-citrulline / citrulline malate', category: 'supplement', evidence: 'weak',
    status: 'OTC dietary supplement',
    summary: 'A common pre-workout "pump" ingredient. At best it adds a rep or two in high-rep sets, and results are inconsistent. No body-composition effect.',
    mechanism: 'Converted to arginine, which raises nitric oxide and blood flow. May reduce perceived fatigue.',
    effects: ['Small effect on strength-endurance in a meta-analysis (effect size ~0.2); many single trials show nothing.', 'Not modeled.'],
    risks: ['Generally well tolerated; GI upset at large doses.'],
    typicalUse: '6–8 g citrulline malate about an hour before training',
    sources: [
      'Trexler ET, et al. Acute effects of citrulline supplementation on high-intensity strength and power performance: a systematic review and meta-analysis. Sports Med. 2019;49(5):707-718.',
      'Gonzalez AM, Trexler ET. Effects of citrulline supplementation on exercise performance in humans: a review of the current literature. J Strength Cond Res. 2020;34(5):1480-1495.',
    ],
    model: { kind: 'none', note: 'Inconsistent performance effect only.' },
  },
  {
    id: 'vitamin_d', name: 'Vitamin D3', category: 'supplement', evidence: 'moderate',
    status: 'OTC dietary supplement',
    summary: 'Matters only if you are low. Correcting a real deficiency (blood level under 20 ng/mL) may help muscle function a little. If your level is already fine, extra vitamin D does nothing for muscle or fat.',
    mechanism: 'Vitamin D receptors in muscle affect calcium handling and protein synthesis. Deficiency is linked to weakness; supplementing people who aren\'t deficient shows no benefit in large trials.',
    effects: [
      'Raises blood 25(OH)D by roughly 0.7 ng/mL per 100 IU/day at steady state (~3 months).',
      'Forge removes the small low-vitamin-D penalty once your projected level passes 20 ng/mL.',
    ],
    risks: [
      'Above 4,000 IU/day (the tolerable upper intake) without monitoring; toxicity (high calcium) usually needs sustained very high doses.',
      'The 2024 Endocrine Society guideline advises against routine testing in healthy adults under 75; test if you have risk factors.',
    ],
    typicalUse: '1,000–2,000 IU/day; more only to correct a measured deficiency',
    sources: [
      'Holick MF, et al. Evaluation, treatment, and prevention of vitamin D deficiency: an Endocrine Society clinical practice guideline. J Clin Endocrinol Metab. 2011;96(7):1911-1930.',
      'Demay MB, et al. Vitamin D for the prevention of disease: an Endocrine Society clinical practice guideline. J Clin Endocrinol Metab. 2024;109(8):1907-1947.',
      'Heaney RP, et al. Human serum 25-hydroxycholecalciferol response to extended oral dosing with cholecalciferol. Am J Clin Nutr. 2003;77(1):204-210.',
      'Herrick KA, et al. Vitamin D status in the United States, 2011–2014. Am J Clin Nutr. 2019;110(1):150-157.',
      'Institute of Medicine. Dietary Reference Intakes for Calcium and Vitamin D. Washington, DC: National Academies Press; 2011.',
    ],
    model: {
      kind: 'vitaminD',
      dose: { unit: 'IU/day', default: 2000, label: 'common dose (VITAL used 2,000 IU)', studied: [400, 10000] },
      ngPer100IU: 0.7, maxSerum: 80, rampWeeks: 12,
      levelRisks: [{ min: 4001, text: 'Above the 4,000 IU/day tolerable upper intake (IOM 2011): fine short-term to correct a deficiency, but recheck your level.' },
        { min: 10001, text: 'Beyond studied doses: sustained intakes this high can cause hypercalcemia. Get blood levels checked.' }],
    },
  },
  {
    id: 'omega3', name: 'Omega-3 fish oil (EPA/DHA)', category: 'supplement', evidence: 'weak',
    status: 'OTC dietary supplement',
    summary: 'Good for heart health and triglycerides. For muscle, the positive studies are in older adults; in young, trained, well-fed lifters there\'s no measurable effect.',
    mechanism: 'Incorporates into muscle cell membranes and may improve the anabolic response to protein in older people.',
    effects: ['Older adults: ~+3% thigh muscle volume over 6 months at ~4 g/day (Smith 2015).', 'Young trained lifters: no reliable effect, so not modeled.'],
    risks: ['Fishy burps and GI upset; mild blood-thinning effect at high doses (tell your surgeon/doctor).'],
    typicalUse: '1–3 g/day combined EPA+DHA with food',
    sources: [
      'Smith GI, et al. Fish oil-derived n-3 PUFA therapy increases muscle mass and function in healthy older adults. Am J Clin Nutr. 2015;102(1):115-122.',
      'McGlory C, Calder PC, Nunes EA. The influence of omega-3 fatty acids on skeletal muscle protein turnover in health, disuse, and disease. Front Nutr. 2019;6:144.',
    ],
    model: { kind: 'none', note: 'Muscle effects shown only in older adults.' },
  },
  {
    id: 'hmb', name: 'HMB (β-hydroxy-β-methylbutyrate)', category: 'supplement', evidence: 'weak',
    status: 'OTC dietary supplement',
    summary: 'Has some benefit for untrained or older people starting out. In trained lifters, meta-analyses find no meaningful effect on strength or lean mass. One trial reporting huge gains has never been replicated.',
    mechanism: 'A leucine metabolite that may reduce muscle protein breakdown.',
    effects: ['Trained people: trivial or no effect on lean mass (meta-analyses), so not modeled.'],
    risks: ['Well tolerated; mostly a cost issue.'],
    typicalUse: '3 g/day',
    sources: [
      'Rowlands DS, Thomson JS. Effects of β-hydroxy-β-methylbutyrate supplementation during resistance training on strength, body composition, and muscle damage in trained and untrained young men: a meta-analysis. J Strength Cond Res. 2009;23(3):836-846.',
      'Sanchez-Martinez J, et al. Effects of beta-hydroxy-beta-methylbutyrate supplementation on strength and body composition in trained and competitive athletes: a meta-analysis of randomized controlled trials. J Sci Med Sport. 2018;21(7):727-735.',
    ],
    model: { kind: 'none', note: 'No meaningful effect in trained lifters.' },
  },
  {
    id: 'ashwagandha', name: 'Ashwagandha (KSM-66 / Shoden)', category: 'supplement', evidence: 'weak',
    status: 'OTC herbal supplement (quality varies)',
    summary: 'The best of a weak field. Two 2026 meta-analyses find a real but small testosterone effect (about +10–15%, pooled SMD 0.33), from small and mostly industry-linked trials in novice lifters and overweight middle-aged men. Nobody has tested it in trained men with normal testosterone.',
    mechanism: 'Adaptogenic herb; lowers cortisol and perceived stress in trials and modestly raises testosterone and DHEA.',
    effects: [
      'Meta-analysis (Zhu 2026, 23 RCTs): total T in men SMD 0.33 (95% CI 0.13–0.54), heterogeneity low (I² 21%); Fornalik 2026 pooled +57 ng/dL. Forge models +12%.',
      'Lopresti 2019 (men 40–70, 8 weeks, crossover): salivary — not serum — T 14.7% above placebo, and the rise did not persist after stopping.',
      'Wankhede 2015 (novice lifters, 8 weeks): T rose 96 vs 18 ng/dL, but the end levels (726 vs 693) did not differ significantly; strength gains were larger.',
      'If your T lab was drawn while taking it, the effect is already in your number and is not added again.',
      'Lower perceived stress (Chandrasekhar 2012).',
    ],
    risks: [
      'Rare but documented liver injury (case series from Iceland and the US DILIN network): cholestatic injury with jaundice after 2–12 weeks, resolving over 1–5 months.',
      'Can affect thyroid levels; thyrotoxicosis case reports exist. Avoid with hyperthyroidism, and discuss with your doctor if on thyroid medication.',
      'Several European regulators have acted on it: Denmark banned sales after a national risk assessment, the Dutch RIVM advises against it, and the UK FSA says no safe level has been established.',
    ],
    typicalUse: '300 mg twice daily of a standardized root extract (the studied dose)',
    sources: [
      'Wankhede S, et al. Examining the effect of Withania somnifera supplementation on muscle strength and recovery: a randomized controlled trial. J Int Soc Sports Nutr. 2015;12:43.',
      'Lopresti AL, et al. A randomized, double-blind, placebo-controlled, crossover study examining the hormonal and vitality effects of ashwagandha (Withania somnifera) in aging, overweight males. Am J Mens Health. 2019;13(2):1557988319835985.',
      'Chandrasekhar K, Kapoor J, Anishetty S. A prospective, randomized double-blind, placebo-controlled study of safety and efficacy of a high-concentration full-spectrum extract of ashwagandha root in reducing stress and anxiety in adults. Indian J Psychol Med. 2012;34(3):255-262.',
      'Zhu Y, et al. Efficacy and safety of Withania somnifera: a systematic review and meta-analysis of randomized controlled trials. Front Pharmacol. 2026;17:1799467.',
      'Fornalik M, et al. Withania somnifera supplementation and hormonal outcomes: a systematic review and meta-analysis of randomized controlled trials. Planta Med. 2026.',
      'Björnsson HK, et al. Ashwagandha-induced liver injury: a case series from Iceland and the US Drug-Induced Liver Injury Network. Liver Int. 2020;40(4):825-829.',
      'Morgado A, et al. Systematic review of the use of dietary supplements for male sexual dysfunction and testosterone. Int J Impot Res. 2023.',
    ],
    model: {
      kind: 'tShift', axis: 'herbal',
      dose: { unit: 'mg/day', default: 600, label: 'studied dose', studied: [250, 600] },
      response: [[0, 0], [300, 0.5], [600, 1]],
      tPct: 12, tPctLowT: 12, rampWeeks: 8,
      // Zhu 2026 SMD 0.33 (95% CI 0.13–0.54) → the CI spans roughly 0.4–1.6× the point estimate.
      tCI: [0.4, 1.6], ceilingNg: 800,
      e2Pct: null, e2ActionPct: 0, shbgDelta: 0,
      // Wankhede 2015 measured body composition on it (8 wk, novice lifters) and reported more arm/chest size and
      // −3.5 % body fat vs −1.5 % placebo, but end testosterone did not differ between groups, so the body-composition
      // result cannot be attributed to the hormone change. Treated as an extrapolation through the T curve, bounded by
      // the highest on-treatment mean reported (Wankhede 2015: 726 ng/dL).
      bodyComp: 'extrapolated', bcMaxLevel: 726,
      bcNote: 'No trial has shown that ashwagandha\'s testosterone rise becomes muscle: Wankhede 2015 measured body composition but its end testosterone did not differ from placebo. Forge runs the modeled rise through the testosterone→lean curve and labels it an extrapolation.',
      monitor: ['Liver panel (ALT/AST/bilirubin) if you take it for more than a few weeks', 'TSH if you have thyroid disease'],
      fertility: 'No suppression of LH or FSH reported; small trials report better sperm parameters.',
      timeCourse: 'Trials ran 8–16 weeks; the salivary rise in Lopresti 2019 did not persist after stopping.',
      wada: 'Not prohibited.',
      suits: 'Anyone curious about the only supplement with a positive meta-analysis; cheap to try and easy to stop.',
      notSuits: 'Liver disease, hyperthyroidism or thyroid medication; no trial has tested trained men with normal testosterone.',
    },
  },
  {
    id: 'tongkat_ali', name: 'Tongkat ali (Eurycoma longifolia)', category: 'supplement', evidence: 'weak',
    status: 'OTC herbal supplement (quality and contamination vary)',
    summary: 'Works only in men who start low. The meta-analysis is positive overall but heavily skewed (I² 87%, publication bias detected), and the subgroup of men with normal testosterone was not significant. Seven of nine trials used one company\'s extract.',
    mechanism: 'Proposed to increase testosterone release and free T via SHBG; also reduced cortisol in one trial.',
    effects: [
      'Leisegang 2022 meta-analysis (5 RCTs, 232 men): SMD 1.35 (95% CI 0.57–2.14), but significant only in men with total T under 300 ng/dL, with high heterogeneity and evidence of publication bias.',
      'Chinnappan 2021 (RCT, men 50–70 with T under 300, 12 weeks): about +30 ng/dL vs placebo (roughly +15%); the men stayed below 300, and free T did not differ from placebo.',
      'Forge models +15% if your level is under 350 ng/dL and nothing if it is normal, which is what the trials show.',
    ],
    risks: ['Mercury above 0.5 ppm was found in 36 of 100 Malaysian products in one survey, and some products contain none of the active compound. Choose third-party tested.', 'Insomnia and restlessness reported.'],
    typicalUse: '200–400 mg/day standardized root extract (studied range)',
    sources: [
      'Leisegang K, et al. Eurycoma longifolia (Jack) improves serum total testosterone in men: a systematic review and meta-analysis of clinical trials. Medicina (Kaunas). 2022;58(8):1047.',
      'Talbott SM, et al. Effect of Tongkat Ali on stress hormones and psychological mood state in moderately stressed subjects. J Int Soc Sports Nutr. 2013;10(1):28.',
      'Henkel RR, et al. Tongkat Ali as a potential herbal supplement for physically active male and female seniors—a pilot study. Phytother Res. 2014;28(4):544-550.',
      'Chinnappan SM, et al. Efficacy of Eurycoma longifolia (Physta) water extract plus multivitamins on quality of life and testosterone in men. Food Nutr Res. 2021;65:5647.',
      'Ang HH, Lee KL, Kiyoshi M. Eurycoma longifolia Jack enhances sexual motivation; heavy metal contamination of Malaysian herbal preparations. J Toxicol Environ Health A / Hum Exp Toxicol. 2004-2006 surveys.',
    ],
    model: {
      kind: 'tShift',
      dose: { unit: 'mg/day', default: 200, label: 'studied dose', studied: [100, 400] },
      response: [[0, 0], [100, 0.5], [200, 1]],
      tPct: 0, tPctLowT: 15, rampWeeks: 5,
      axis: 'herbal', tCI: [0.3, 1.7], ceilingNg: 400,
      e2Pct: null, e2ActionPct: 0, shbgDelta: 0,
      bodyComp: 'extrapolated', bcMaxLevel: 350,
      bcNote: 'No tongkat ali trial measured body composition. The modeled rise is run through the testosterone→lean curve and bounded at 350 ng/dL, because Chinnappan 2021\'s men stayed below 300 and the meta-analysis was only significant below 300.',
      monitor: ['Total testosterone before and after 12 weeks (it only works if you start low)'],
      fertility: 'No suppression; small trials report better sperm motility.',
      timeCourse: 'Trials ran 4–12 weeks.',
      wada: 'Not prohibited.',
      suits: 'Men with a measured total testosterone under about 300 ng/dL who want to try something before a prescription.',
      notSuits: 'Anyone in the normal range (the meta-analysis subgroup was not significant); buy only third-party-tested product (heavy metals).',
      nullNote: 'Your testosterone is in the normal range, and in that subgroup of the meta-analysis the effect was not significant, so Forge models no change.',
    },
  },
  {
    id: 'zma', name: 'ZMA / zinc / magnesium', category: 'supplement', evidence: 'weak',
    status: 'OTC dietary supplement',
    summary: 'Useful only if you are actually deficient (heavy sweaters, endurance athletes and restrictive diets are at higher risk). In men with adequate zinc it does nothing for testosterone or training. Forge applies an effect only when you enter a low serum zinc.',
    mechanism: 'Zinc is a cofactor in testosterone production; severe restriction crashes it and repletion restores it. Magnesium is involved in sleep and muscle function, but the testosterone trials are poor.',
    effects: [
      'Deficiency matters: in Prasad 1996, zinc restriction dropped young men from 1,151 to 306 ng/dL, and repleting marginally deficient older men moved them from 239 to 461 ng/dL. Tiny, uncontrolled samples.',
      'Replete men: no change. ZMA for 8 weeks in resistance-trained men did nothing to hormones, body composition or 1-rep max (Wilborn 2004), and a high-dose zinc study in exercising men with adequate intake found no T change (Koehler 2009).',
      'Magnesium: the one positive study (Cinar 2011) was not randomized or blinded; there is no RCT or meta-analysis in men. Unproven, so not modeled.',
      'Forge applies the deficiency correction only if your serum zinc lab is below 70 µg/dL.',
    ],
    risks: ['Zinc >40 mg/day long-term can cause copper deficiency.', 'Magnesium can loosen stools.', 'Some "test booster" products exceed safe upper limits for zinc, niacin or magnesium (Clemesha 2020).'],
    typicalUse: 'Standard ZMA (30 mg zinc, 450 mg magnesium, 10.5 mg B6) at night, only if intake or a lab is low',
    sources: [
      'Wilborn CD, et al. Effects of zinc magnesium aspartate (ZMA) supplementation on training adaptations and markers of anabolism and catabolism. J Int Soc Sports Nutr. 2004;1(2):12-20.',
      'Koehler K, et al. Serum testosterone and urinary excretion of steroid hormone metabolites after administration of a high-dose zinc supplement. Eur J Clin Nutr. 2009;63(1):65-70.',
      'Prasad AS, et al. Zinc status and serum testosterone levels of healthy adults. Nutrition. 1996;12(5):344-348.',
      'Te L, et al. The relationship between serum zinc level and testosterone: a systematic review. J Trace Elem Med Biol. 2023;76:127124.',
      'Cinar V, et al. Effects of magnesium supplementation on testosterone levels of athletes and sedentary subjects at rest and after exhaustion. Biol Trace Elem Res. 2011;140(1):18-23.',
      'Clemesha CG, et al. "Testosterone boosting" supplements composition and claims are not supported by the academic literature. World J Mens Health. 2020;38(1):115-122.',
    ],
    model: {
      kind: 'tEndogenous',
      dose: { unit: 'mg/day', default: 30, label: 'elemental zinc in standard ZMA', studied: [15, 45] },
      response: [[0, 0], [15, 0.6], [30, 1]],
      tPct: 30, rampWeeks: 12,
      axis: 'nutrient', tCI: [0.3, 1.7], ceilingNg: 600,
      e2Pct: null, e2ActionPct: 0, shbgDelta: 0,
      bodyComp: 'extrapolated', bcMaxLevel: 500,
      bcNote: 'Nobody has measured body composition while repleting zinc. Prasad 1996 moved marginally deficient older men from 239 to 461 ng/dL, so the credit is bounded at 500 ng/dL and labelled an extrapolation.',
      monitor: ['Serum zinc (morning, fasting) before and after', 'Serum copper if you take more than 40 mg/day for months'],
      fertility: 'Zinc deficiency impairs spermatogenesis; correcting it helps. Supplementing replete men does not.',
      timeCourse: 'Repletion takes weeks to a few months.',
      wada: 'Not prohibited.',
      suits: 'A measured serum zinc under 70 µg/dL. Endurance athletes and restrictive diets are the usual cause.',
      notSuits: 'Anyone with a normal zinc level: trials in replete men found nothing.',
      gate: { deficiencyOnly: 'zinc', deficiencyBelow: 70 },
    },
  },
  {
    id: 'daa', name: 'D-aspartic acid (DAA)', category: 'supplement', evidence: 'refuted',
    status: 'OTC dietary supplement',
    summary: 'The one "test booster" with a result worth knowing: in trained men, 6 g/day LOWERED testosterone about 12%. The famous +42% study was in untrained men recruited at a fertility clinic and was not randomized. Forge models the drop at the high dose and nothing at the low one.',
    mechanism: 'An amino acid that stimulates LH release in rodent tissue. In humans the signal does not survive training status or a control group.',
    effects: [
      'Melville 2015 (RCT, men with 2+ years of training, 14 days): 6 g/day dropped total T from 590 to 510 ng/dL and free T fell significantly vs placebo. 3 g/day did nothing.',
      'Melville 2017 (RCT, trained men, 12 weeks, 6 g/day): total and free T unchanged, no extra hypertrophy or strength; estradiol fell 16%.',
      'Willoughby 2013 (RCT, resistance-trained men, 3 g/day, 28 days): no change in T, strength or body composition.',
      'Topo 2009 (the +42% study): not randomized, untrained men at an IVF clinic, 12 days.',
    ],
    risks: ['No serious adverse events reported, but lowering testosterone is the opposite of the point.'],
    typicalUse: 'Not recommended: the trials in trained men show no benefit, and the higher dose lowered testosterone',
    sources: [
      'Melville GW, Siegler JC, Marshall PW. Three and six grams supplementation of D-aspartic acid in resistance trained men. J Int Soc Sports Nutr. 2015;12:15.',
      'Melville GW, Siegler JC, Marshall PWM. The effects of D-aspartic acid supplementation in resistance-trained men over a three month training period: a randomised controlled trial. PLoS One. 2017;12(8):e0182630.',
      'Willoughby DS, Leutholtz B. D-aspartic acid supplementation combined with 28 days of heavy resistance training has no effect on body composition, muscle strength, and serum hormones. Nutr Res. 2013;33(10):803-810.',
      'Topo E, et al. The role and molecular mechanism of D-aspartic acid in the release and synthesis of LH and testosterone in humans and rats. Reprod Biol Endocrinol. 2009;7:120.',
    ],
    model: {
      kind: 'tShift',
      dose: { unit: 'g/day', default: 3, label: 'common dose', studied: [3, 6] },
      response: [[0, 0], [3, 0], [6, 1]],
      tPct: -12.5, tPctLowT: -12.5, rampWeeks: 2,
      axis: 'herbal', tCI: [0.5, 1.5], ceilingNg: 2500,
      e2Pct: null, e2ActionPct: 0, shbgDelta: 0,
      bodyComp: 'extrapolated', bcMaxLevel: 2500,
      bcNote: 'Melville 2017 measured body composition over 12 weeks at 6 g/day and found no extra hypertrophy. The modeled testosterone drop is run through the same curve as any other change, which gives a small negative.',
      monitor: ['Total and free testosterone if you take the 6 g dose'],
      fertility: 'Not studied.', timeCourse: 'The drop appeared within 14 days (Melville 2015).',
      wada: 'Not prohibited.',
      suits: 'Nobody, on this evidence.',
      notSuits: 'Trained men: 6 g/day lowered testosterone and 3 g/day did nothing.',
      nullNote: 'At 3 g/day the randomized trials in trained men found no change in testosterone.',
    },
  },
  {
    id: 'fenugreek', name: 'Fenugreek (Testofen etc.)', category: 'supplement', evidence: 'weak',
    status: 'OTC herbal supplement',
    summary: 'Pooled analyses show a small total-testosterone effect of very low certainty, and the one trial in trained men found no change in total testosterone, 1-rep max or body fat. Forge models no effect.',
    mechanism: 'Furostanolic saponins are proposed to inhibit aromatase and 5-alpha-reductase. Several trials come from the ingredient makers.',
    effects: [
      'Isenmann 2023 meta-analysis (7 studies, 449 people): total T SMD 0.32 (95% CI 0.09–0.55); free T 0.24 (−0.04 to 0.52, ns); lean mass 0.19 (−0.10 to 0.49, ns).',
      'Yang 2026 meta-analysis: total T SMD 0.25 (0.02–0.48), GRADE very low.',
      'Wankhede 2016 (RCT, 60 trained men 18–35, 8 weeks): no difference from placebo in total T, 1-rep max or body fat; only free T differed. Manufacturer co-authored.',
    ],
    risks: ['Maple-syrup body odour; GI upset; can lower blood sugar (watch it with diabetes medication).'],
    typicalUse: '600 mg/day of a standardized extract is the studied amount, if you want to try it',
    sources: [
      'Isenmann E, et al. Effects of fenugreek supplementation on hormones and body composition: a systematic review and meta-analysis. Int J Sports Med. 2023.',
      'Wankhede S, Mohan V, Thakurdesai P. Beneficial effects of fenugreek glycoside supplementation in male subjects during resistance training: a randomized controlled pilot study. J Sport Health Sci. 2016;5(2):176-182.',
      'Mansoori A, et al. Effect of fenugreek extract supplement on testosterone levels in male: a meta-analysis of clinical trials. Phytother Res. 2020;34(7):1550-1555.',
      'Rao A, et al. Testofen, a specialised Trigonella foenum-graecum seed extract, reduces age-related symptoms of androgen decrease. Aging Male. 2016;19(2):134-142.',
    ],
    model: { kind: 'none', note: 'Pooled effect is small and very low certainty, and total T did not move in the one trial in trained men.' },
  },
  {
    id: 'boron', name: 'Boron', category: 'supplement', evidence: 'weak',
    status: 'OTC dietary supplement',
    summary: 'The claim rests on one uncontrolled week in eight men. The only randomized trial, in bodybuilders, found nothing. Not modeled.',
    mechanism: 'Proposed to lower SHBG and raise free testosterone; the human data are too thin to say.',
    effects: [
      'Naghii 2011: 8 men, 10 mg/day for a week, no control group — free T up, estradiol down; magnitudes not reported in the abstract.',
      'Ferrando & Green 1993 (RCT, 19 bodybuilders, 2.5 mg/day, 7 weeks): no change in total T, free T, lean mass or strength.',
    ],
    risks: ['Low doses are well tolerated; high intakes can cause nausea and GI upset.'],
    typicalUse: '3–10 mg/day is what the studies used; there is no good reason to expect an effect',
    sources: [
      'Naghii MR, et al. Comparative effects of daily and weekly boron supplementation on plasma steroid hormones and proinflammatory cytokines. J Trace Elem Med Biol. 2011;25(1):54-58.',
      'Ferrando AA, Green NR. The effect of boron supplementation on lean body mass, plasma testosterone levels, and strength in male bodybuilders. Int J Sport Nutr. 1993;3(2):140-149.',
    ],
    model: { kind: 'none', note: 'One uncontrolled week in 8 men; the randomized trial was null.' },
  },
  {
    id: 'tribulus', name: 'Tribulus terrestris', category: 'supplement', evidence: 'refuted',
    status: 'OTC herbal supplement',
    summary: 'Tested repeatedly and it does not raise testosterone. A systematic review concluded the marketing claims are unsubstantiated.',
    mechanism: 'Marketed as raising LH via protodioscin. Not supported in human trials.',
    effects: [
      'Qureshi 2014 systematic review (11 studies): "ineffective for increasing testosterone… marketing claims are unsubstantiated".',
      'Neychev 2005 (RCT, 21 men 20–36, 4 weeks): 454–471 ng/dL on Tribulus vs 512 on placebo, not significant.',
      'Rogerson 2007 (RCT, 22 elite rugby players, 5 weeks): no strength or lean-mass benefit.',
    ],
    risks: ['Case reports of liver and kidney injury with high-dose products.'],
    typicalUse: 'Not recommended; it does not do what it is sold for',
    sources: [
      'Qureshi A, Naughton DP, Petroczi A. A systematic review on the herbal extract Tribulus terrestris and the roots of its putative aphrodisiac and performance enhancing effect. J Diet Suppl. 2014;11(1):64-79.',
      'Neychev VK, Mitev VI. The aphrodisiac herb Tribulus terrestris does not influence the androgen production in young men. J Ethnopharmacol. 2005;101(1-3):319-323.',
      'Rogerson S, et al. The effect of five weeks of Tribulus terrestris supplementation on muscle strength and body composition during preseason training in elite rugby league players. J Strength Cond Res. 2007;21(2):348-353.',
    ],
    model: { kind: 'none', note: 'Randomized trials found no testosterone or performance effect.' },
  },
  {
    id: 'maca', name: 'Maca (Lepidium meyenii)', category: 'supplement', evidence: 'refuted',
    status: 'OTC herbal supplement / food',
    summary: 'Improves libido in trials, but does so without changing testosterone at all. Nothing to model for muscle.',
    mechanism: 'Unknown; the libido effect is independent of androgens.',
    effects: ['Gonzales 2003 (RCT, 1.5–3 g/day, 12 weeks): no change in testosterone, LH, FSH or estradiol.', 'Libido improved in the same research group\'s trials without any hormone change.'],
    risks: ['Well tolerated as a food.'],
    typicalUse: '1.5–3 g/day if you want the libido effect; it will not change your hormones',
    sources: ['Gonzales GF, et al. Effect of Lepidium meyenii (Maca), a root with aphrodisiac and fertility-enhancing properties, on serum reproductive hormone levels in adult healthy men. J Endocrinol. 2003;176(1):163-168.'],
    model: { kind: 'none', note: 'Randomized trials show no hormone change.' },
  },
  {
    id: 'shilajit', name: 'Shilajit (purified)', category: 'supplement', evidence: 'weak',
    status: 'OTC supplement; heavy-metal contamination is a real concern in Ayurvedic products',
    summary: 'One industry-funded randomized trial in men aged 45–55 reported higher total and free testosterone after 90 days. Nothing has replicated it, and no trial has measured muscle. Not modeled.',
    mechanism: 'Fulvic-acid-rich mineral pitch; mechanism for any androgen effect is unclear.',
    effects: ['Pandit 2016 (RCT, healthy men 45–55, 250 mg twice daily, 90 days): total T, free T and DHEA-S higher than placebo (p<0.05). Effect sizes are not in the abstract, and the trial was funded by the ingredient maker.', 'No body-composition data at all.'],
    risks: ['An analysis of Ayurvedic products bought online found lead, mercury or arsenic in about one in five (Saper 2008). Third-party testing matters here more than for most supplements.'],
    typicalUse: '250 mg twice daily of a purified, third-party-tested product is the studied amount',
    sources: [
      'Pandit S, et al. Clinical evaluation of purified shilajit on testosterone levels in healthy volunteers. Andrologia. 2016;48(5):570-575.',
      'Saper RB, et al. Lead, mercury, and arsenic in US- and Indian-manufactured Ayurvedic medicines sold via the Internet. JAMA. 2008;300(8):915-923.',
    ],
    model: { kind: 'none', note: 'One unreplicated industry trial; no body-composition data.' },
  },
  {
    id: 'dhea', name: 'DHEA', category: 'supplement', evidence: 'refuted',
    status: 'OTC in the US; a prohibited anabolic agent on the WADA list at all times',
    summary: 'Raises androstenedione, not testosterone, in young men, and two years of it in older men changed nothing about body composition or strength. Banned in drug-tested sport.',
    mechanism: 'An adrenal precursor hormone. Conversion to testosterone is minimal in men with working testes.',
    effects: [
      'Brown 1999 (RCT, men around 23, 150 mg/day during 8 weeks of training): total and free T unchanged, androstenedione +150%, and strength and lean-mass gains the same as placebo.',
      'Nair 2006 (RCT, 87 elderly men with low DHEA-S and low T, 2 years): no effect on body composition, strength, VO2peak or quality of life.',
      'Li 2020 meta-analysis: pooled total T in men about +21 ng/dL — within assay noise at a normal level.',
    ],
    risks: ['Acne, oily skin, hair loss; converts to estrogens as well as androgens.', 'WADA prohibited at all times as an anabolic agent; a positive test is a sanction.'],
    typicalUse: 'No evidence-based use for muscle in men with normal testes',
    sources: [
      'Brown GA, et al. Effect of oral DHEA on serum testosterone and adaptations to resistance training in young men. J Appl Physiol. 1999;87(6):2274-2283.',
      'Nair KS, et al. DHEA in elderly women and DHEA or testosterone in elderly men. N Engl J Med. 2006;355(16):1647-1659.',
      'Li Y, et al. Effects of DHEA supplementation on testosterone concentrations: a systematic review and meta-analysis. Exp Gerontol. 2020;140:111110.',
      WADA,
    ],
    model: { kind: 'none', note: 'No testosterone or body-composition effect in men with working testes.' },
  },
  {
    id: 'forskolin', name: 'Forskolin (Coleus forskohlii)', category: 'supplement', evidence: 'weak',
    status: 'OTC dietary supplement',
    summary: 'One small trial in overweight men found less body fat and higher free testosterone, but the total-testosterone change was not statistically significant and lean mass was only a trend. Never replicated. Not modeled.',
    mechanism: 'Activates adenylate cyclase, raising cyclic AMP, which in theory increases lipolysis and steroidogenesis.',
    effects: ['Godard 2005 (RCT, 30 men with BMI ≥26, 12 weeks): total T +16.8 ± 33.8% vs −1.1 ± 18.4%, not significant; free T rose significantly; body fat and fat mass fell on DXA; lean mass was a trend (p=0.097).'],
    risks: ['Can lower blood pressure and increase heart rate; interacts with blood-pressure and blood-thinning medication.'],
    typicalUse: '250 mg of a 10% extract twice daily is the studied amount',
    sources: ['Godard MP, Johnson BA, Richmond SR. Body composition and hormonal adaptations associated with forskolin consumption in overweight and obese men. Obes Res. 2005;13(8):1335-1343.'],
    model: { kind: 'none', note: 'One small trial; the total-testosterone change was not significant.' },
  },
  {
    id: 'collagen', name: 'Collagen peptides', category: 'supplement', evidence: 'weak',
    status: 'OTC dietary supplement',
    summary: 'Not a muscle builder. Collagen lacks tryptophan and is low in leucine, and whey beats it head-to-head. It may help tendons and ligaments when taken with vitamin C before activity.',
    mechanism: 'Supplies glycine, proline and hydroxyproline for connective tissue. Its incomplete amino-acid profile makes it a poor trigger for muscle protein synthesis.',
    effects: ['Whey, not collagen, raised muscle protein synthesis in a direct comparison (Oikawa 2020).', 'Don\'t count it fully toward your protein target. Not modeled.'],
    risks: ['Safe; mainly a cost issue.'],
    typicalUse: '10–15 g with ~50 mg vitamin C, 30–60 min before tendon-loading activity',
    sources: [
      'Oikawa SY, et al. Whey protein but not collagen peptides stimulate acute and longer-term muscle protein synthesis with and without resistance exercise in healthy older women: a randomized controlled trial. Am J Clin Nutr. 2020;111(3):708-718.',
      'Shaw G, et al. Vitamin C-enriched gelatin supplementation before intermittent activity augments collagen synthesis. Am J Clin Nutr. 2017;105(1):136-143.',
      'Zdzieblik D, et al. Collagen peptide supplementation in combination with resistance training improves body composition and increases muscle strength in elderly sarcopenic men: a randomised controlled trial. Br J Nutr. 2015;114(8):1237-1245.',
    ],
    model: { kind: 'none', note: 'Not a muscle builder.' },
  },
  {
    id: 'electrolytes', name: 'Electrolytes (sodium, potassium)', category: 'supplement', evidence: 'moderate',
    status: 'OTC',
    summary: 'Worth it for long or hot sessions and heavy sweaters, which is useful for your runs. They don\'t change muscle or fat, but sodium shifts scale weight by a pound or two from day to day.',
    mechanism: 'Replaces sweat sodium losses to maintain plasma volume and performance in prolonged exercise.',
    effects: ['Better hydration and performance in sessions over ~60–90 min or in heat.', 'Day-to-day water swings on the scale; no tissue effect, so not modeled.'],
    risks: ['Extra sodium matters if you have high blood pressure.'],
    typicalUse: '300–600 mg sodium per hour of long or hot exercise; more for salty sweaters',
    sources: [
      'Sawka MN, et al. American College of Sports Medicine position stand. Exercise and fluid replacement. Med Sci Sports Exerc. 2007;39(2):377-390.',
      'McCubbin AJ, et al. Sports Dietitians Australia position statement: nutrition for exercise in hot environments. Int J Sport Nutr Exerc Metab. 2020;30(1):83-98.',
    ],
    model: { kind: 'none', note: 'Hydration only.' },
  },
  {
    id: 'melatonin', name: 'Melatonin', category: 'supplement', evidence: 'moderate',
    status: 'OTC in the US (prescription in many countries); label accuracy varies',
    summary: 'Helps you fall asleep a little sooner (about 7 minutes on average) and helps reset your body clock. It only helps your projection if you actually sleep more, so update "typical sleep" below when that happens.',
    mechanism: 'A circadian timing signal, not a sedative. Most effective for shifted body clocks (late stimulant days, travel).',
    effects: ['Sleep onset ~7 min faster and total sleep ~8 min longer on average (meta-analysis).', 'No direct effect in the model; sleep hours drive it.'],
    risks: ['Products often contain far more or less than labeled (one analysis found −83% to +478%).', 'Morning grogginess at higher doses; 0.5–3 mg is usually enough.'],
    typicalUse: '0.5–3 mg 30–60 min before bed',
    sources: [
      'Ferracioli-Oda E, Qawasmi A, Bloch MH. Meta-analysis: melatonin for the treatment of primary sleep disorders. PLoS One. 2013;8(5):e63773.',
      'Erland LA, Saxena PK. Melatonin natural health products and supplements: presence of serotonin and significant variability of melatonin content. J Clin Sleep Med. 2017;13(2):275-281.',
    ],
    model: { kind: 'none', note: 'Works through your sleep hours.' },
  },

  // ============================================================ LIFESTYLE
  {
    id: 'sleep_hygiene', name: 'Sleep 7–9 h (sleep hygiene)', category: 'lifestyle', evidence: 'strong',
    status: 'Free',
    summary: 'In a dieting study, people who slept 5.5 h instead of 8.5 h lost far more muscle and less fat. Short sleep also lowers how much muscle you can build. Your "typical sleep" setting below drives this in Forge.',
    mechanism: 'Sleep loss lowers muscle protein synthesis (−18% after one night without sleep), shifts hormones (less testosterone, more cortisol) and increases hunger.',
    effects: [
      'Adding it to your stack is a reminder; the model uses "typical sleep hours" in Metabolic values.',
      'With Adderall: take it early, keep caffeine to the morning, and keep a fixed wake time.',
    ],
    risks: [],
    typicalUse: '7–9 h per night; consistent wake time, dark, cool room, no caffeine after ~noon',
    sources: [
      'Nedeltcheva AV, et al. Insufficient sleep undermines dietary efforts to reduce adiposity. Ann Intern Med. 2010;153(7):435-441.',
      'Lamon S, et al. The effect of acute sleep deprivation on skeletal muscle protein synthesis and the hormonal environment. Physiol Rep. 2021;9(1):e14660.',
      'Watson NF, et al. Recommended amount of sleep for a healthy adult: a joint consensus statement of the American Academy of Sleep Medicine and Sleep Research Society. Sleep. 2015;38(6):843-844.',
      'Knowles OE, et al. Inadequate sleep and muscle strength: implications for resistance training. J Sci Med Sport. 2018;21(9):959-968.',
      'Leproult R, Van Cauter E. Effect of 1 week of sleep restriction on testosterone levels in young healthy men. JAMA. 2011;305(21):2173-2174.',
      'Su L, et al. Effects of sleep deprivation on testosterone in males: a systematic review and meta-analysis. Sleep Med. 2021;88:267-273.',
    ],
    model: {
      kind: 'tEndogenous',
      dose: { unit: '% of nights', default: 100, label: 'as studied (every night)', studied: [0, 100] },
      response: [[0, 0], [100, 1]],
      tPct: 14, rampWeeks: 2,
      axis: 'lifestyle', tCI: [0.5, 1.5], ceilingNg: 900,
      e2Pct: null, e2ActionPct: 0, shbgDelta: 0,
      bodyComp: 'measured', bcMaxLevel: 900,
      bcNote: 'Sleep is the one lifestyle lever with a randomized body-composition result: Nedeltcheva 2010 (5.5 h vs 8.5 h in a deficit) shifted weight loss from fat to lean. Forge models that through the sleep retention and ceiling curves as well as through testosterone, so no extra cap is needed.',
      monitor: ['Nothing. Track hours; a morning testosterone lab after a month of 8 h nights tells you if it mattered.'],
      fertility: 'Short sleep lowers testosterone and sperm quality in observational data; fixing it is harmless.',
      timeCourse: 'Leproult 2011 saw the fall within one week, so recovery is fast.',
      wada: 'Not prohibited.',
      suits: 'Anyone averaging under 7 h. The biggest free lever on this list.',
      notSuits: 'Nobody — but if you already sleep 7–9 h there is nothing to recover, and Forge models zero.',
      gate: { shortSleepOnly: true, sleepBelow: 7, sleepTarget: 8, sleepFloor: 5 },
    },
  },
  {
    id: 'energy_availability', name: 'Eating enough (energy availability)', category: 'lifestyle', evidence: 'moderate',
    status: 'Free, and the biggest testosterone lever you actually control',
    summary: 'Chronic under-eating is the fastest way for a lean, hard-training man to tank his own testosterone, and it is the single most relevant item on this list for you: Adderall blunts appetite, and your training load is high. It also reverses within days to weeks of eating normally again.',
    mechanism: 'Low energy availability suppresses GnRH from the hypothalamus, so LH falls and the testes get no signal. It is a central, reversible shutdown, not testicular damage, and it raises SHBG so free T falls further than total T.',
    effects: [
      'Friedl 2000 (Ranger course, ~1,000–1,200 kcal/day deficits plus heavy load and sleep loss): testosterone fell to about 130 ng/dL, "approaching castrate", with LH suppressed and IGF-1 halved. Refeeding brought prompt recovery.',
      'Rossow 2013 (natural bodybuilder, 6-month contest prep to 4.5% body fat): 922 → 227 ng/dL, back to 991 after recovery; strength had not fully returned at 6 months.',
      'Short, mild restriction does far less: 4 days at 15 kcal/kg fat-free mass did not change T in 6 men (Koehler 2016).',
      'Lean mass: a meta-analysis found deficits around 500 kcal/day stop lean-mass gain from lifting altogether (Murphy & Koehler 2021).',
      'Forge models the recovery from YOUR entered typical deficit (Metabolic values → "typical daily deficit"). The anchors are the two measured extremes — about −10% at 500 kcal/day and roughly −65% at the Ranger/contest-prep end (1,500 kcal/day plus heavy training) — and the points between them are an interpolation, not a measurement.',
      'It also works through your calorie target in Nutrition and through the warning Forge shows when you are in a deficit.',
    ],
    risks: [],
    typicalUse: 'Keep deficits moderate (roughly 300–500 kcal/day), protein high, and eat before the Adderall dose takes hold',
    sources: [
      'Friedl KE, et al. Endocrine markers of semistarvation in healthy lean men in a multistressor environment. J Appl Physiol. 2000;88(5):1820-1830.',
      'Rossow LM, et al. Natural bodybuilding competition preparation and recovery: a 12-month case study. Int J Sports Physiol Perform. 2013;8(5):582-592.',
      'Koehler K, et al. Low energy availability in exercising men is associated with reduced leptin and insulin but not with changes in other metabolic hormones. J Sports Sci. 2016;34(20):1921-1929.',
      'Areta JL, Taylor HL, Koehler K. Low energy availability: history, definition and evidence of its endocrine, metabolic and physiological effects in prospective studies in males. Eur J Appl Physiol. 2021;121(1):1-21.',
      'Murphy C, Koehler K. Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression. Scand J Med Sci Sports. 2021;31(11):2185-2198.',
    ],
    model: {
      kind: 'tEndogenous', axis: 'lifestyle',
      dose: { unit: '% of the deficit you remove', default: 100, label: 'as studied (back to maintenance)', studied: [0, 100] },
      response: [[0, 0], [100, 1]],
      tPct: 100, rampWeeks: 4,          // full effect = undoing 100% of the modeled suppression (see deficitT below)
      // ASSUMPTION (docs §10): the suppression curve between the two measured extremes is interpolated.
      //   Friedl 2000: ~1,000–1,200 kcal/day deficit + load + sleep loss → T ≈ 130 ng/dL from a normal baseline (≈ −75%).
      //   Rossow 2013: a 6-month contest prep → 922 → 227 ng/dL (−75%), fully reversed on refeeding.
      //   Koehler 2016: 4 days at 15 kcal/kg FFM → no change (so short, mild restriction is ~0).
      //   Murphy & Koehler 2021: ~500 kcal/day stops lean-mass gain from lifting.
      deficitT: [[0, 0], [300, 0], [500, 10], [1000, 40], [1500, 65], [2000, 75]],   // kcal/day deficit → % of T suppressed
      tCI: [0.5, 1.5], ceilingNg: 1000,
      e2Pct: null, e2ActionPct: 0, shbgDelta: -5,
      shbgNote: 'Low energy availability raises SHBG, so free testosterone falls further than total; eating enough reverses that (Areta 2021).',
      bodyComp: 'measured', bcMaxLevel: 1100,
      bcNote: 'Measured: a 500 kcal/day deficit abolished lean-mass gain from lifting in a meta-analysis of 26 trials (Murphy & Koehler 2021), and the case-study and field data show the testosterone fall reversing with refeeding. Forge models both, and the calorie side already flows through the projection.',
      monitor: ['Morning total testosterone, LH and SHBG if you have been in a deficit for months', 'Body weight trend: if it is falling you are in one'],
      fertility: 'Central and fully reversible; sperm production recovers with weight and energy intake.',
      timeCourse: 'Days to weeks (Friedl 2000 saw prompt recovery on refeeding while the other stressors continued).',
      wada: 'Not prohibited.',
      suits: 'Lean, hard-training men in a long deficit — and anyone whose appetite is blunted (Adderall, stimulants, high cardio volume).',
      notSuits: 'Anyone eating at or above maintenance: there is nothing to undo, and Forge models zero.',
      gate: { deficitOnly: true },
    },
  },
  {
    id: 'fat_loss', name: 'Fat loss (if you carry a lot of it)', category: 'lifestyle', evidence: 'strong',
    status: 'Free; the first-line treatment for obesity-related low testosterone',
    summary: 'In men with obesity, losing weight reliably raises testosterone — about +83 ng/dL from a diet and +252 ng/dL after bariatric surgery, scaling with how much weight comes off. In lean men there is no evidence it does anything, so Forge applies it only when your BMI is 30 or above.',
    mechanism: 'Fat tissue aromatizes testosterone to estradiol and obesity suppresses LH; losing fat reverses both. Guidelines call this functional, reversible hypogonadism.',
    effects: [
      'Corona 2013 meta-analysis (24 studies, men with obesity): low-calorie diet +2.87 nmol/L (95% CI 1.68–4.07) ≈ +83 ng/dL; bariatric surgery +8.73 (6.51–10.95) ≈ +252 ng/dL. The amount of weight lost was the best predictor.',
      'Adding exercise to the diet added nothing on top (Mohseni-Takalloo 2022: −0.03 nmol/L, 95% CI −0.11 to 0.06).',
      'GLP-1 drugs raise testosterone the same way: roughly +72 to +150 ng/dL in obesity-related hypogonadism, and meta-regression shows the rise tracks the weight lost, not the drug.',
      'Lean men: no evidence. Late-onset hypogonadism was found in only 0.4% of lean men in a large cohort.',
    ],
    risks: ['Crash dieting works against you: a large deficit suppresses testosterone in lean men (see Eating enough).'],
    typicalUse: 'A moderate deficit with high protein and lifting, if your BMI is 30 or above',
    sources: [
      'Corona G, et al. Body weight loss reverts obesity-associated hypogonadotropic hypogonadism: a systematic review and meta-analysis. Eur J Endocrinol. 2013;168(6):829-843.',
      'Grossmann M, Matsumoto AM. A perspective on middle-aged and older men with functional hypogonadism: focus on holistic management. J Clin Endocrinol Metab. 2017;102(3):1067-1075.',
      'Mohseni-Takalloo S, et al. The effect of weight loss interventions with or without exercise on sex hormones in men: a systematic review and meta-analysis. Eur J Endocrinol. 2022;186(1):109-119.',
      'Salvio G, et al. Effects of GLP-1 receptor agonists on sex hormones in men: a systematic review and meta-analysis. Andrology. 2025;13(8):2022-2034.',
    ],
    model: {
      kind: 'tEndogenous',
      dose: { unit: '% of the studied weight loss', default: 100, label: 'as studied (~10% of body weight)', studied: [0, 100] },
      response: [[0, 0], [100, 1]],
      tPct: 28, rampWeeks: 24,
      axis: 'lifestyle', tCI: [0.58, 1.42], ceilingNg: 700,   // Corona 2013 diet CI 1.68–4.07 of 2.87 nmol/L
      e2Pct: -25, e2ActionPct: 0, shbgDelta: 6,
      e2Note: 'Losing fat removes aromatase tissue, so estradiol falls while testosterone rises. That is a different thing from blocking aromatase with a drug: the estrogen that remains is not blocked, and fat is being lost for ordinary energy-balance reasons.',
      shbgNote: 'SHBG rises with weight loss (insulin falls), so total T rises more than free T (Corona 2013).',
      bodyComp: 'measured', bcMaxLevel: 700,
      bcNote: 'Measured end to end: the fat loss itself is what the projection is already simulating. The hormone change is credited on top only up to 700 ng/dL, the top of what diet or surgery produced in Corona 2013.',
      monitor: ['Total testosterone before and after ~10% weight loss', 'HbA1c, lipids, blood pressure'],
      fertility: 'Improves with weight loss (LH and FSH recover).',
      timeCourse: 'Tracks the weight: months.',
      wada: 'Not prohibited.',
      suits: 'BMI 30 or above. First-line treatment for obesity-related low testosterone in every guideline.',
      notSuits: 'Lean men — there is no evidence it raises testosterone, and a hard deficit lowers it (see Eating enough).',
      gate: { obesityOnly: true },
    },
  },
  {
    id: 'endurance_load', name: 'High-volume endurance training', category: 'lifestyle', evidence: 'weak',
    status: 'Free, and relevant if you are still running big weeks',
    summary: 'Men with years of high-volume endurance training sit about 25–40% lower in resting testosterone than matched untrained men — the "exercise-hypogonadal male condition". Add this if you are currently training like that, and Forge will lower the testosterone it assumes for you.',
    mechanism: 'Chronic high training load appears to lower the hypothalamic set-point, often alongside low energy availability. It is mostly cross-sectional evidence, so cause and effect are not nailed down.',
    effects: [
      'Hackney 1988: 11 endurance-trained men (12 years of training, 6.6 days/week) 499 vs 725 ng/dL in sedentary controls (−31%); free T −27%.',
      'Hooper 2017: 9 runners with the condition at 265 vs 467 ng/dL (−43%), with energy availability of 27 vs 45 kcal/kg fat-free mass — so under-eating is tangled up in it.',
      'Hackney 2020 review: the condition is defined as a persistent 25–50% reduction and takes years of training to appear; in a cohort of 196 runners it plateaued about 30–35% lower.',
      'It is at least partly reversible: when training volume was cut back in an 18-week study, testosterone returned toward baseline.',
      'Forge models −25%, the conservative end. If you have a real lab drawn during this period, that number wins instead.',
    ],
    risks: ['Low testosterone from training load comes with low bone density in some runners; if this is you, it is worth a doctor\'s visit rather than a supplement.'],
    typicalUse: 'Nothing to take. If size is the goal, cutting endurance volume back is the lever',
    sources: [
      'Hackney AC, Sinning WE, Bruot BC. Reproductive hormonal profiles of endurance-trained and untrained males. Med Sci Sports Exerc. 1988;20(1):60-65.',
      'Hooper DR, et al. Endocrinological roles for testosterone in resistance exercise responses and adaptations. Eur J Appl Physiol. 2017;117(7):1349-1359.',
      'Hackney AC. Hypogonadism in exercising males: dysfunction or adaptive-regulatory adjustment? Front Endocrinol. 2020;11:11.',
      'Hackney AC, Hooper DR. Reductions in testosterone are not indicative of exercise performance decrement in male endurance athletes. Physiol Int. 2019;106(4):324-332.',
    ],
    model: {
      kind: 'tEndogenous',
      dose: { unit: '% of the studied training load', default: 100, label: 'as studied (years of near-daily endurance training)', studied: [0, 100] },
      response: [[0, 0], [100, 1]],
      tPct: -25, rampWeeks: 0,
      axis: 'lifestyle', tCI: [1.0, 1.8], ceilingNg: 1000,   // the reviews describe 25–50%; Forge models the low end
      e2Pct: null, e2ActionPct: 0, shbgDelta: 4,
      shbgNote: 'Endurance-trained men run higher SHBG, so free T falls a little more than total (Hackney 1988: free T −27% vs total −31%).',
      bodyComp: 'extrapolated', bcMaxLevel: 1100,
      bcNote: 'No trial has randomized endurance volume and measured body composition against testosterone. The modeled drop is run through the same curve as any other change and is labelled an extrapolation.',
      monitor: ['Morning total testosterone and LH', 'Vitamin D and bone density if this has been going on for years'],
      fertility: 'Usually preserved; the drop is central and partly reversible when volume falls.',
      timeCourse: 'Takes years to appear (Hackney 2020) and improves over months when volume is cut.',
      wada: 'Not prohibited.',
      suits: 'Nothing to take. Add it to see what your current running volume is costing you; the lever is cutting the volume.',
      notSuits: 'Anyone not running big weeks.',
    },
  },
  {
    id: 'alcohol', name: 'Alcohol', category: 'lifestyle', evidence: 'moderate',
    status: 'Free, and it costs you in both directions',
    summary: 'About three drinks a day for three weeks lowered testosterone roughly 7% in a randomized crossover. Chronic heavy drinking does more. Occasional drinks are not the issue; a daily habit is.',
    mechanism: 'Alcohol suppresses LH and directly impairs testicular steroidogenesis, and raises estradiol. It also costs you sleep quality and training calories.',
    effects: [
      'Sierksma 2004 (randomized crossover, 10 middle-aged men, ~40 g alcohol/day for 3 weeks): total T −6.8% (95% CI −1.0 to −12.5%).',
      'Santi 2023 meta-analysis (21 studies, 10,199 subjects): lower total T in healthy chronic drinkers, with estradiol higher. The pooled units are ambiguous in the abstract, so Forge does not extrapolate past the randomized number.',
      'Forge models −6.8% at the studied 3 drinks/day and scales linearly below that; above 3 drinks/day it plateaus, because no randomized dose higher than that exists.',
    ],
    risks: ['Blunts muscle protein synthesis after training, wrecks sleep quality, and adds calories without protein.'],
    typicalUse: 'If size is the goal, keep it occasional rather than daily',
    sources: [
      'Sierksma A, et al. Effect of moderate alcohol consumption on plasma dehydroepiandrosterone sulfate, testosterone, and estradiol levels in middle-aged men and postmenopausal women. Alcohol Clin Exp Res. 2004;28(5):780-785.',
      'Santi D, et al. Alcohol consumption and testicular function: a systematic review and meta-analysis. Andrology. 2023;11(8):1480-1492.',
    ],
    model: {
      kind: 'tEndogenous', axis: 'lifestyle',
      dose: { unit: 'drinks/day', default: 3, label: 'the randomized dose (≈40 g/day)', studied: [0, 3], note: 'One drink ≈ 14 g alcohol. Above 3 drinks/day Forge plateaus: no randomized higher dose exists.' },
      response: [[0, 0], [3, 1]],
      tPct: -6.8, rampWeeks: 3,
      tCI: [0.15, 1.84], ceilingNg: 1000,       // Sierksma 2004 95% CI −1.0 % to −12.5 % of the −6.8 % point estimate
      e2Pct: 7, e2ActionPct: 0, shbgDelta: 0,
      e2Note: 'Estradiol rose on alcohol in the same crossover (Sierksma 2004) and in the meta-analysis (Santi 2023).',
      bodyComp: 'extrapolated', bcMaxLevel: 1100,
      bcNote: 'No trial has measured body composition against alcohol-induced testosterone change. The modeled drop runs through the testosterone→lean curve and is labelled an extrapolation; the bigger costs (sleep, blunted post-workout protein synthesis, empty calories) are separate.',
      monitor: ['Nothing specific; a morning testosterone after a dry month is the cheapest experiment.'],
      fertility: 'Heavy chronic use impairs it; moderate intake has not been shown to.',
      timeCourse: 'The randomized effect appeared over 3 weeks of daily drinking.',
      wada: 'Not prohibited (removed from the WADA list in 2018).',
      suits: 'Daily drinkers. Cutting back is free and the effect reverses.',
      notSuits: 'Occasional drinking is not the issue; the trial was 3 drinks a day for 3 weeks.',
    },
  },
  {
    id: 'resistance_training', name: 'Lifting itself (resistance training)', category: 'lifestyle', evidence: 'strong',
    status: 'Free, and the thing that actually builds the muscle',
    summary: 'Lifting is the single biggest driver of muscle in this whole app — and it does NOT raise your resting testosterone. The post-workout hormone spike is real, lasts about half an hour, and does not predict how much muscle you build. Forge models the training, not a hormone effect.',
    mechanism: 'Mechanical tension drives muscle protein synthesis through local, androgen-receptor and mTOR pathways. The acute systemic hormone surge is a side effect of the effort, not the signal.',
    effects: [
      'Resting testosterone does not change with training: SMD 0.00 (95% CI −0.20 to 0.20) across trials in men 19–75 (Potter 2021 meta-analysis).',
      'The acute spike is large (SMD 0.74) and gone within 30 minutes (D\'Andrea 2020).',
      'It does not matter: training one arm in a high-hormone environment and one in a low-hormone environment produced the same growth (West 2010), and no hormone response correlated with gains in 49 trained men (Morton 2016).',
      'What did correlate was muscle androgen-receptor content, not blood hormones (Morton 2018).',
      'Forge models no testosterone effect from lifting. The lean mass it builds comes through the training side of the projection, where it belongs.',
    ],
    risks: [],
    typicalUse: 'The weekly set targets Forge already plans for you',
    sources: [
      'Potter E, et al. The effect of resistance training on resting testosterone concentrations in men: a systematic review and meta-analysis. Sports Med. 2022;52(5):1091-1105. doi:10.1007/s40279-021-01600-z',
      'D\'Andrea S, et al. Endogenous transient doping: physical exercise acutely increases testosterone levels — results from a meta-analysis. J Endocrinol Invest. 2020;43(10):1349-1371. doi:10.1007/s40618-020-01251-3',
      'West DW, et al. Elevations in ostensibly anabolic hormones with resistance exercise enhance neither training-induced muscle hypertrophy nor strength of the elbow flexors. J Appl Physiol. 2010;108(1):60-67. doi:10.1152/japplphysiol.01147.2009',
      'Morton RW, et al. Neither load nor systemic hormones determine resistance training-mediated hypertrophy or strength gains in resistance-trained young men. J Appl Physiol. 2016;121(1):129-138. doi:10.1152/japplphysiol.00154.2016',
      'Morton RW, et al. Muscle androgen receptor content but not systemic hormones is associated with resistance training-induced skeletal muscle hypertrophy in healthy, young men. Front Physiol. 2018;9:1373. doi:10.3389/fphys.2018.01373',
    ],
    model: { kind: 'none', axis: 'lifestyle', bodyComp: 'none',
      bcNote: 'Measured and null for the hormone pathway: resting testosterone does not change with training (Potter 2021, SMD 0.00). The muscle it builds is modeled by the training side of the projection, not here.',
      note: 'No testosterone effect (Potter 2021: SMD 0.00). Your training already drives the projection.' },
  },
  {
    id: 'cold_plunge', name: 'Cold plunge / ice bath after lifting', category: 'lifestyle', evidence: 'moderate',
    status: 'Free / equipment',
    summary: 'Cold-water immersion right after lifting blunts muscle growth over months, according to a 2024 meta-analysis. Fine after runs or on rest days; skip it within ~4 h after lifting if size is the goal.',
    mechanism: 'Cold blunts the post-exercise inflammatory and anabolic signaling (mTOR, satellite cells) that drives hypertrophy.',
    effects: ['Modeled as ×0.92 on the training-driven lean ceiling when used after every lifting session, scaled by how often.'],
    risks: ['Cold shock; avoid with heart conditions.'],
    typicalUse: 'If you like it: after runs or on non-lifting days',
    sources: [
      'Roberts LA, et al. Post-exercise cold water immersion attenuates acute anabolic signalling and long-term adaptations in muscle to strength training. J Physiol. 2015;593(18):4285-4301.',
      'Piñero A, et al. Throwing cold water on muscle growth: a systematic review with meta-analysis of the effects of postexercise cold water immersion on resistance training-induced hypertrophy. Eur J Sport Sci. 2024;24(2):177-189.',
    ],
    model: {
      kind: 'generic',
      dose: { unit: '% of lift sessions', default: 100, label: 'as studied (after every session)', studied: [0, 100] },
      response: [[0, 0], [100, 1]],
      leanCeilingMult: 0.92, rampWeeks: 0,
    },
  },

  // ============================================================ PRESCRIPTION
  {
    id: 'trt', name: 'Testosterone (TRT and higher doses)', category: 'prescription', rx: true, exogenousT: true, evidence: 'strong',
    status: 'Prescription only (Schedule III). Replacement is for diagnosed hypogonadism; doses above replacement are not an approved use. WADA prohibited.',
    summary: 'Testosterone\'s effect on lean mass rises with the blood level. Bhasin\'s trials show fat-free mass going up roughly in step with the log of serum T, from low levels to about 2,400 ng/dL, even without training. Lifting adds to that. Forge uses your on-therapy blood level (or estimates it from your dose) against your own natural level.',
    mechanism: 'Androgen receptor activation raises muscle protein synthesis and satellite-cell activity. Higher serum T means more lean mass, with no clear plateau inside the studied range, and fat mass falls at higher levels.',
    effects: [
      'Bhasin 1996 (600 mg/wk, 10 wk): fat-free mass +6.1 kg with lifting, +3.2 kg without, vs +1.9 kg for lifting on placebo.',
      'Bhasin 2001 (20 wk, no training): ≈ −0.3 kg at ~250 ng/dL, ~0 at ~300, +3.4 kg at ~540, +5.2 kg at ~1,350, +7.9 kg at ~2,400.',
      'Forge: direct (training-independent) lean from log(on-therapy T ÷ your natural T), mostly in the first ~20 weeks, then it levels off. The training ceiling rises modestly with log T above natural (the extra +1 kg in Bhasin 1996).',
      'Above ~2,400 ng/dL (the highest studied level) the effect plateaus; Forge does not extrapolate.',
    ],
    risks: [
      'Shuts down your own testosterone and sperm production (HPTA suppression). Infertility is common while on it; in WHO contraception trials ~200 mg/week made most men azoospermic. Recovery after stopping can take months.',
      'Raises hematocrit (thicker blood), more so at higher levels; needs regular blood counts.',
      'Monitoring: total T, hematocrit, PSA, lipids, blood pressure.',
      'TRAVERSE (2023): no rise in major cardiac events on replacement in older hypogonadal men, but more atrial fibrillation, pulmonary embolism and kidney injury.',
    ],
    typicalUse: 'Physician-prescribed replacement (e.g. weekly or biweekly injections, gels) titrated to a mid-normal level on follow-up labs',
    sources: [
      'Bhasin S, et al. The effects of supraphysiologic doses of testosterone on muscle size and strength in normal men. N Engl J Med. 1996;335(1):1-7.',
      'Bhasin S, et al. Testosterone dose-response relationships in healthy young men. Am J Physiol Endocrinol Metab. 2001;281(6):E1172-E1181.',
      'Bhasin S, et al. Testosterone replacement increases fat-free mass and muscle size in hypogonadal men. J Clin Endocrinol Metab. 1997;82(2):407-413.',
      'Bhasin S, et al. Older men are as responsive as young men to the anabolic effects of graded doses of testosterone on the skeletal muscle. J Clin Endocrinol Metab. 2005;90(2):678-688.',
      'Bhasin S, et al. Testosterone therapy in men with hypogonadism: an Endocrine Society clinical practice guideline. J Clin Endocrinol Metab. 2018;103(5):1715-1744.',
      'Lincoff AM, et al. Cardiovascular safety of testosterone-replacement therapy (TRAVERSE). N Engl J Med. 2023;389(2):107-117.',
      'World Health Organization Task Force on Methods for the Regulation of Male Fertility. Contraceptive efficacy of testosterone-induced azoospermia in normal men. Lancet. 1990;336(8721):955-959.',
      'Travison TG, et al. Harmonized reference ranges for circulating testosterone levels in men of four cohort studies in the United States and Europe. J Clin Endocrinol Metab. 2017;102(4):1161-1173.',
      'Morton RW, et al. Muscle androgen receptor content but not systemic hormones is associated with resistance training-induced skeletal muscle hypertrophy in healthy, young men. Front Physiol. 2018;9:1373.',
    ],
    model: {
      kind: 'testosterone', requiresLab: 'totalT',
      dose: { unit: 'mg/week', default: 100, label: 'studied replacement dose (Bhasin 1997)', studied: [25, 600], note: 'Testosterone enanthate/cypionate. The dose is only used to estimate your level when no on-therapy lab is entered.' },
      doseToLevel: [[0, 0], [25, 253], [50, 306], [125, 542], [300, 1345], [600, 2370]],
      rampWeeks: 20,
      // Reference values at a typical replacement (natural 550 → ~750 ng/dL), for display only; the engine uses testosteroneEffect().
      leanCeilingMult: 1.06, leanDirectLbPerWeek: 0.17, fatDirectLbPerWeek: -0.05,
      levelRisks: [
        { min: 1, text: 'Any exogenous testosterone suppresses natural production and sperm count. If fertility matters, talk to your physician about it first (hCG and other options exist).' },
        { min: 900, text: 'Upper-normal and above: hematocrit rises with level; above ~54% the dose usually gets reduced (Endocrine Society).' },
        { min: 1100, text: 'Above the normal range: HDL ("good") cholesterol falls with dose (significant at 300–600 mg/wk in Bhasin 2001); acne, oily skin, raised blood pressure and breast tenderness or gynecomastia (from conversion to estradiol) become more common.' },
        { min: 2000, text: 'Near the top of the studied range: in older men on the highest doses (Bhasin 2005), adverse events including hematocrit above 54% were more frequent.' },
      ],
    },
  },
  {
    id: 'clomiphene', name: 'Clomiphene citrate (off-label)', category: 'prescription', rx: true, evidence: 'moderate',
    status: 'Prescription only; used off-label in men (FDA-approved only for ovulation induction in women). WADA prohibited (S4 hormone and metabolic modulators).',
    summary: 'The best-evidenced way to raise your OWN testosterone. In men with low testosterone and a pituitary that still works, a meta-analysis of 10 randomized trials found +274 ng/dL versus placebo, with LH and FSH going up rather than down — so sperm production is preserved, unlike with testosterone therapy. It also works in men whose testosterone is already normal: in healthy men aged 26–33 it took the group mean from 519 to 1,390 ng/dL. What is NOT known is whether that extra testosterone, made by your own testes, builds muscle the way injected testosterone does. Nobody has measured it.',
    mechanism: 'Blocks estrogen receptors in the hypothalamus and pituitary, so the brain stops seeing the negative feedback, releases more LH and FSH, and your own testes make more testosterone. Estradiol rises along with it.',
    effects: [
      'Hohl 2025 meta-analysis (10 RCTs, 819 men with functional or secondary hypogonadism, baseline 67–303 ng/dL): total T +273.8 ng/dL (95% CI 191.9–355.7, I²=89%), LH +4.66 IU/L (3.37–5.94), FSH +4.59 IU/L (2.88–6.30), free T SMD 1.57 (0.44–2.70), DHT +7.58 ng/dL (3.42–11.73), estradiol +33.99 pg/mL (19.19–48.79). GRADE moderate. The benefit shrank with higher age (p=0.043) and higher BMI (p=0.0008).',
      'IMPORTANT ABOUT THAT +274 (corrected 2026-10-20): Hohl pooled clomiphene AND enclomiphene together as one "SERM" class — the 10 trials include Kim 2016 and both Wiehle 2014 studies. It is a class estimate, not a clomiphene-specific one, and Forge now says so. The clomiphene-SPECIFIC pooled figure is higher: Tienforti 2023 pooled the isomers separately in obesity-related androgen deficiency and got clomiphene +11.56 nmol/L ≈ +333 ng/dL (95% CI 9.68–13.43) against enclomiphene +7.50 ≈ +216. Forge keeps its curve anchored on 274 anyway, because that is the more conservative of the two and it is the one with the wider population behind it.',
      'SHBG did NOT move significantly in the pooled analysis (+3.63 nmol/L, 95% CI −0.54 to 7.81, p=0.09), although the single body-composition trial (Soares 2018) did report a rise.',
      'Equal to testosterone gel on serum levels (difference 5.41 ng/dL, 95% CI −43 to +54). Hohl 2025 did not compare SERMs with injections, so Forge makes no claim there.',
      'Fertility is the real differentiator: SERMs kept sperm concentration 70.4 million/mL higher than gel (95% CI 41.6–99.2), and the risk of falling below 15 million/mL was 90% lower (RR 0.10).',
      'IT WORKS IN MEN WITH A NORMAL TESTOSTERONE TOO — the single biggest correction in this entry. Tenover & Bremner 1991 (J Androl 12:258–63, PMID 1917692) gave 50 mg twice daily for 8 weeks to five HEALTHY men aged 26–33 (baseline 18.0 ± 1.0 nmol/L = 519 ng/dL, screened for normal testes, normal weight, non-smokers, no medication): the group mean reached 48.2 ± 1.4 nmol/L = 1,390 ng/dL, 2.7× baseline. Five healthy men aged 65–85 (baseline 499 ng/dL) reached 34.3 nmol/L = 989 ng/dL, 2.0× baseline — the young men responded significantly more.',
      'Bremner/Tenover 1987 (JCEM 65:1118–26, doi:10.1210/jcem-65-6-1118) is the larger version: 14 healthy men aged 22–35 and 14 aged 65–84, same 100 mg/day dose, only 7 days. 24-hour mean total T 4.9 → 9.8 ng/mL (490 → 980 ng/dL, +100%) in the young men and 4.1 → 5.4 ng/mL (410 → 540, +34%) in the elderly. Estradiol 37 → 54 pg/mL (young) and 37 → 47 (elderly). SHBG 24.5 → 31.3 nmol/L (young, +28%) and 31.0 → 40.0 (elderly, +29%).',
      'And free testosterone goes up with it. In those same young men, non-SHBG-bound T by the Södergard formula went 3.2 → 6.5 ng/mL, which is 65% → 66% of total: the bioavailable FRACTION did not change, so free T rose in proportion to total. Soares 2018 measured free T rising (p<0.001) in obese hypogonadal men even though SHBG rose; Guay 1995 (double-blind, placebo-controlled crossover) and Guay 2003 (n=178) both found free T up significantly on clomiphene.',
      'A raised LH does NOT rule you out. Keihani 2020 (Urology 142:119–24, doi:10.1016/j.urology.2020.04.074; 332 men, mean age 36.2) found total T rose +329 ng/dL (95% CI 307–351), 73% of men gained at least 200 ng/dL, and NEITHER baseline LH NOR FSH predicted the response: "adequate biochemical response ... can be expected in most patients with normal or slightly elevated baseline gonadotropin levels." Patel 2015 and Roque 2026 agree. Kim 2026 (n=292) did find higher LH predicted worse response, but as a gradient (OR 0.82 per mIU/mL), not a cliff.',
      'Age is the thing that actually shrinks the response — not your starting level. Tenover: young > elderly in both papers. Hohl 2025: benefit fell with age (p=0.043) and BMI (p=0.0008). Guay 2003: response fell significantly with age (p<0.05). Keihani 2020: age was the only significant univariable predictor. Both Keihani and Kim found baseline total T was NOT predictive.',
      'Dose: there is no within-trial dose ladder for clomiphene in men. 25 mg/day took 36 men from 247.6 ± 39.8 to 610.0 ± 178.6 ng/dL in 4–6 weeks (Shabsigh 2005), which is indistinguishable from the 50 mg/day trials, so the curve looks close to flat across 25–50 mg. The 1,390 ng/dL figure comes from 100 mg/day, two to four times the usual clinical dose.',
      'Body composition: only one trial has ever measured it. Soares 2018 (RCT, 78 men with obesity, BMI >30, baseline 226 ± 70 ng/dL, 50 mg/day, 12 weeks) found improved lean mass (p<0.001), fat-free mass (p=0.004) and muscle mass (p<0.001) — but by bioimpedance, not DXA, and only in obese men with low T. HDL fell (p<0.001). Nothing has been measured in a man with a normal testosterone.',
      'No glucose or weight benefit: FBG, HbA1c, insulin and BMI were all unchanged vs placebo (Hohl 2025).',
      'Forge models the testosterone rise at ANY baseline, because that is what was measured. It credits muscle as MEASURED only up to about 500 ng/dL (where Soares landed) and as an EXTRAPOLATION above that, with a range that starts at zero.',
    ],
    risks: [
      'Mood changes, blurred or flickering vision (stop and call your doctor), breast tenderness; 8% of men reported a side effect in the longest series (Krzastek 2019, 120 men followed past 3 years). See the tolerability block for the itemised rates.',
      'Estradiol rises, which is part of how it works but can cause breast tenderness or gynecomastia.',
      'HDL ("good") cholesterol fell significantly in the one trial that measured body composition (Soares 2018, p<0.001). Enclomiphene did not do this in the trial that looked (Wiehle 2013, p=0.78), and in baboons the two isomers moved cholesterol in opposite directions, so this looks like a zuclomiphene effect.',
      'In the only head-to-head, the same men reported side effects far more often on clomiphene than after switching to enclomiphene — 47% vs 13.8%, driven by low libido, low energy and mood (Saffati 2024). That study is retrospective and unblinded, but it is the only direct comparison that exists.',
      'Libido was lower on clomiphene than on testosterone therapy in a meta-analysis (−0.54, 95% CI −0.87 to −0.21).',
      'It needs testes that can respond. A clearly raised LH together with a low testosterone is primary (testicular) failure, and then it is the wrong tool — but a normal or slightly raised LH is not a reason to rule it out (Keihani 2020).',
      'Using it in a man whose testosterone is already normal has no outcome data at all. The hormone moves; whether anything else does is unmeasured, and the only long-term safety data in men are retrospective series in hypogonadal patients.',
      'Long-term safety data come from retrospective series, not trials; one 400-man series followed men for an average of about two years with 88% reaching normal levels.',
    ],
    typicalUse: 'Off-label, prescribed and monitored by a urologist or endocrinologist for secondary hypogonadism, especially when fertility matters. Your prescriber sets the dose and schedule and follows total T, estradiol, hematocrit and PSA.',
    sources: [
      'Hohl A, et al. Clomiphene or enclomiphene citrate for the treatment of male hypogonadism: a systematic review and meta-analysis of randomized controlled trials. Arch Endocrinol Metab. 2025;69(5):e250093. doi:10.20945/2359-4292-2025-0093 — NOTE: pools clomiphene and enclomiphene together as one SERM class.',
      'Tienforti D, et al. Selective modulation of estrogen receptor in obese men with androgen deficiency: a systematic review and meta-analysis. Andrology. 2023;11(6):1067-1076. doi:10.1111/andr.13373 — pools the two isomers SEPARATELY: clomiphene +333 ng/dL, enclomiphene +216.',
      'Soares AH, et al. Effects of clomiphene citrate on male obesity-associated hypogonadism: a randomized, double-blind, placebo-controlled study. Int J Obes. 2018;42(5):953-963. doi:10.1038/s41366-018-0105-2',
      'Guo DP, Zlatev DV, Li S, Baker LC, Eisenberg ML. Demographics, usage patterns, and safety of male users of clomiphene in the United States. World J Mens Health. 2020;38(2):220-225. doi:10.5534/wjmh.190028',
      'Saffati G, et al. Safety and efficacy of enclomiphene and clomiphene for hypogonadal men. Transl Androl Urol. 2024;13(9):1984-1990. doi:10.21037/tau-24-238',
      'Ramasamy R, et al. Testosterone supplementation versus clomiphene citrate for hypogonadism: an age matched comparison of satisfaction and efficacy. J Urol. 2014;192(3):875-879.',
      'Krzastek SC, et al. Long-term safety and efficacy of clomiphene citrate for the treatment of hypogonadism. J Urol. 2019;202(5):1029-1035. doi:10.1097/JU.0000000000000396 — 400 men, mean 25.5 months, to 7 years.',
      'Mulhall JP, et al. Evaluation and management of testosterone deficiency: AUA guideline. J Urol. 2018;200(2):423-432.',
      'Tenover JS, Bremner WJ. The effects of normal aging on the response of the pituitary-gonadal axis to chronic clomiphene administration in men. J Androl. 1991;12(4):258-263. PMID 1917692.',
      'Bremner WJ, Plymate SR, Tenover JS, Matsumoto AM. The effects of aging in normal men on bioavailable testosterone and luteinizing hormone secretion: response to clomiphene citrate. J Clin Endocrinol Metab. 1987;65(6):1118-1126. doi:10.1210/jcem-65-6-1118',
      'Keihani S, et al. Baseline gonadotropin levels and testosterone response in hypogonadal men treated with clomiphene citrate. Urology. 2020;142:119-124. doi:10.1016/j.urology.2020.04.074',
      'Shabsigh A, et al. Clomiphene citrate effects on testosterone/estrogen ratio in male hypogonadism. J Sex Med. 2005;2(5):716-721. doi:10.1111/j.1743-6109.2005.00075.x',
      'Guay AT, et al. Clomiphene increases free testosterone levels in men with both secondary hypogonadism and erectile dysfunction: who does and does not benefit? Int J Impot Res. 2003;15(3):156-165. doi:10.1038/sj.ijir.3900981',
      'Kim DJ, et al. Predictors of clomiphene citrate response in the treatment of men with testosterone deficiency. J Sex Med. 2026;23(7). doi:10.1093/jsxmed/qdag159',
      'Mazzola CR, et al. Predicting biochemical response to clomiphene citrate in men with hypogonadism. J Sex Med. 2014;11(9):2302-2307. doi:10.1111/jsm.12592',
      'Tajar A, et al. Characteristics of secondary, primary, and compensated hypogonadism in aging men: evidence from the European Male Ageing Study. J Clin Endocrinol Metab. 2010;95(4):1810-1818. doi:10.1210/jc.2009-1796',
      WADA,
    ],
    model: {
      kind: 'tEndogenous',
      dose: { unit: '% of the studied regimen', default: 100, label: 'as studied (prescriber-set dose)', studied: [0, 100], note: 'Forge models the trial-average response, not a dose you choose.' },
      response: [[0, 0], [100, 1]],
      // CORRECTED 2026-10-20. The old curve was [[150,183],[250,110],[300,91],[350,60],[400,30],[450,0]]: it fitted
      // the hypogonadal trials below 300 and then BENT DOWN TO ZERO at 450. The bend was an inference, not a finding,
      // and it is wrong. Two measurements in men who were NOT hypogonadal contradict it:
      //   Tenover & Bremner 1991 (PMID 1917692): healthy men 26-33, baseline 519 ng/dL → 1,390 (2.68x, +168%).
      //   Bremner 1987 (doi:10.1210/jcem-65-6-1118): healthy men 22-35, baseline 490 → 980 (+100%) in 7 days.
      // Both used 100 mg/day. Krause 1992's tamoxifen arm is the placebo-controlled eugonadal anchor: 490 → 790.
      //
      // Shape. Below 300 the old curve was arithmetically identical to "a constant +274 ng/dL" — Hohl 2025's pooled
      // effect (150x1.83 = 274, 250x1.10 = 275, 300x0.91 = 273). Forge keeps that, because the constant-absolute
      // reading is what the predictor studies support: Keihani 2020 and Kim 2026 both found baseline total T did
      // NOT predict the size of the response. A constant absolute rise automatically becomes a shrinking
      // percentage as the baseline climbs, which is the shape the task description asks for and the only one the
      // data justify. Above 550 Forge tapers the absolute rise mildly (274 → ~220 by 1,000 ng/dL) because no trial
      // has started a man that high; that taper is an ASSUMPTION.
      // Conservatism check at a eugonadal baseline: this curve gives +275 ng/dL at 490, against Krause's measured
      // +300 (tamoxifen, placebo-controlled), Bremner's +490 and Tenover's +871 on clomiphene itself.
      tPctByBaseline: [[150, 183], [200, 137], [250, 110], [300, 91], [350, 78], [400, 69], [450, 61], [500, 55], [550, 50], [650, 41], [800, 31], [1000, 22]],
      rampWeeks: 6, maxLevel: 1390,
      // Ceiling = the highest group mean ever reported on this drug: 48.2 nmol/L = 1,390 ng/dL (Tenover 1991,
      // 100 mg/day, 8 weeks, n = 5 healthy young men). At conventional doses the maxima are 610 (Shabsigh 2005,
      // 25 mg) and 612 at one year (Moskovic 2012).
      axis: 'serm', ceilingNg: 1390,
      tCI: [0.70, 1.30],              // Hohl 2025: 191.9–355.7 around 273.8
      e2Pct: 90, e2ActionPct: 90, shbgDelta: 4,
      e2Note: 'Estradiol rises a lot (+34 pg/mL pooled, 95% CI 19–49). That is part of the mechanism, not a side-show. Forge does NOT turn a SERM\'s serum-E2 rise into fat loss: Finkelstein\'s fat finding is about estrogen ACTION, and a SERM raises the hormone while blocking the receptor in some tissues. Direction unknown, so zero.',
      shbgNote: 'SHBG rises a little and early and then settles: +28% after 7 days in healthy young men (Bremner 1987, 24.5 → 31.3 nmol/L), no significant change at all after 8 weeks (Tenover 1991), +3.63 nmol/L and not significant in the pooled analysis (Hohl 2025, p=0.09). Forge models +4 nmol/L. Crucially the bioavailable FRACTION did not fall: 65% → 66% of total in Bremner 1987, so free testosterone rose in proportion to total.',
      // §22.8. Clomiphene is the one item here with a genuinely large safety denominator, and it comes out well
      // on hard endpoints and worse than enclomiphene on how men feel. Both of those are in the numbers below.
      tolerability: {
        grade: 'moderate', comparedWith: 'placebo in randomized trials; its own pre-treatment rate in a 12,318-man claims cohort; enclomiphene in one retrospective within-patient comparison',
        evidence: 'rct',
        headline: 'Hard endpoints are reassuring at scale; symptom side effects are common — 47% in the one study that compared it directly with enclomiphene.',
        discontinuation: { pct: 0, n: 0, of: 39, note: 'No withdrawals for an adverse event in the clomiphene arm of the only placebo-controlled body-composition trial; the two withdrawals in that study were both in the PLACEBO arm. Separately, 63% of men in a 12,318-man claims cohort stopped within 6 months, but that database does not record why, and the commonest reasons are likely to be pregnancy achieved or no perceived benefit rather than toxicity.', source: 'Soares 2018; Guo 2019' },
        events: [
          { label: 'Any side effect, long-term use', pct: 8, n: 10, of: 120, arm: 'men treated longer than 3 years (mean 52 months)', p: 'no significant adverse event occurred in any of the 400 patients', source: 'Krzastek 2019' },
          { label: 'Mood changes, long-term use', pct: 4.2, n: 5, of: 120, arm: '>3 years', source: 'Krzastek 2019' },
          { label: 'Blurred vision, long-term use', pct: 2.5, n: 3, of: 120, arm: '>3 years', p: 'the classic SERM warning: it is a reason to stop and call the prescriber, not to wait', source: 'Krzastek 2019' },
          { label: 'Breast tenderness, long-term use', pct: 1.7, n: 2, of: 120, arm: '>3 years', source: 'Krzastek 2019' },
          { label: 'Any adverse event (vs enclomiphene, same patients)', pct: 47, n: 31, of: 66, arm: 'clomiphene', vs: { pct: 13.8, n: 8, of: 58, label: 'enclomiphene' }, p: '0.001 (OR 0.18 in favour of enclomiphene, 95% CI 0.07–0.44)', source: 'Saffati 2024' },
          { label: 'Decreased libido', pct: 33.3, n: 22, of: 66, arm: 'clomiphene', vs: { pct: 8.6, n: 5, of: 58, label: 'enclomiphene' }, p: '0.001', source: 'Saffati 2024' },
          { label: 'Erectile dysfunction', pct: 18.2, n: 12, of: 66, arm: 'clomiphene', vs: { pct: 8.6, n: 5, of: 58, label: 'enclomiphene' }, p: '0.12 — not significant', source: 'Saffati 2024' },
          { label: 'Mood changes', pct: 9.1, n: 6, of: 66, arm: 'clomiphene', vs: { pct: 0, n: 0, of: 58, label: 'enclomiphene' }, p: '0.03', source: 'Saffati 2024' },
          { label: 'Gynecomastia', pct: 3.0, n: 2, of: 66, arm: 'clomiphene', vs: { pct: 0, n: 0, of: 58, label: 'enclomiphene' }, p: '0.49 — not significant', source: 'Saffati 2024' },
          { label: 'Somnolence', pct: 12.8, n: 5, of: 39, arm: 'clomiphene', vs: { pct: 0, n: 0, of: 39, label: 'placebo' }, p: '0.064 — borderline', source: 'Soares 2018' },
          { label: 'HDL cholesterol', pct: null, n: null, of: 39, arm: 'FELL significantly vs placebo over 12 weeks', p: '<0.001 — the clearest measured harm on this drug', source: 'Soares 2018' },
          { label: 'Hematocrit', pct: null, n: null, of: 39, arm: 'no significant change vs placebo (p=0.409); median change +0.4% over a median 18.7 months in the head-to-head cohort', source: 'Soares 2018; Saffati 2024' },
          { label: 'PSA', pct: null, n: null, of: 39, arm: 'rose from 0.62 ± 0.41 to 0.76 ± 0.48 ng/mL, significant but inside the normal range; prostate symptom score unchanged (p=0.312)', p: '0.023', source: 'Soares 2018' },
          { label: 'Thrombotic events, vision problems, liver disease, nausea', pct: null, n: null, of: 5118, arm: 'no increase in the 6 months after starting vs the 6 months before, in US insurance claims', p: 'gynecomastia, mental disorders, skin disorders and hypertension were all coded LESS often after starting, on low event counts', source: 'Guo 2019, 12,318 men (5,118 with adequate follow-up)' },
          { label: 'Venous thromboembolism and myocardial infarction', pct: null, n: null, of: null, arm: 'case reports only (an isolated cortical vein thrombosis, a thrombotic STEMI in a man in his early 30s with no risk factors); no excess in the 5,118-man claims analysis', p: 'a signal worth knowing about, not a measured rate', source: 'Choi 2020; Shahid 2025; Guo 2019' },
          { label: 'Bone mineral density', pct: null, n: null, of: null, arm: 'not measured in men on clomiphene', p: 'contrast: an aromatase inhibitor LOWERED spine BMD in a year-long randomized trial, which is why that item is graded poor and this one is not', source: 'no study' },
        ],
        note: 'Two different questions with two different answers. "Is it dangerous?" — the evidence says no: 400 men followed to 7 years with no significant adverse event, 12,318 men in claims data with no excess thrombosis, eye disease or liver disease, and no adverse-event withdrawals in the placebo-controlled trial. "Does it make men feel worse?" — often enough to matter: a third reported low libido in the head-to-head cohort, and a meta-analysis found libido lower on clomiphene than on testosterone therapy (−0.54, 95% CI −0.87 to −0.21). The HDL fall is the one measured biochemical harm. All of the symptom comparisons against enclomiphene come from a single unblinded retrospective study.',
        sources: [
          'Krzastek SC, et al. Long-term safety and efficacy of clomiphene citrate for the treatment of hypogonadism. J Urol. 2019;202(5):1029-1035. doi:10.1097/JU.0000000000000396',
          'Guo DP, Zlatev DV, Li S, Baker LC, Eisenberg ML. Demographics, usage patterns, and safety of male users of clomiphene in the United States. World J Mens Health. 2020;38(2):220-225. doi:10.5534/wjmh.190028',
          'Soares AH, et al. Effects of clomiphene citrate on male obesity-associated hypogonadism: a randomized, double-blind, placebo-controlled study. Int J Obes. 2018;42(5):953-963. doi:10.1038/s41366-018-0105-2',
          'Saffati G, et al. Transl Androl Urol. 2024;13(9):1984-1990. doi:10.21037/tau-24-238',
          'Choi J, Lee S, Lee CN. Isolated cortical vein thrombosis in an infertile male taking clomiphene citrate. Neurol Sci. 2021;42(4):1615-1616. doi:10.1007/s10072-020-04862-z',
          'Shahid Z, et al. Clomiphene-induced myocardial infarction in a young male: a case report. Sci Prog. 2025;108(3). doi:10.1177/00368504251349392',
        ],
      },
      bodyComp: 'measured', bcMaxLevel: 500, bcExtrapMaxLevel: 1390, bcMaxBaseline: 300,
      bcNote: 'MEASURED up to ≈500 ng/dL, EXTRAPOLATED above it. Soares 2018 measured body composition by bioimpedance in obese men starting at 226 ± 70 ng/dL and found lean, fat-free and muscle mass all improved; the achieved level is not in the abstract, and 500 ng/dL is inferred from that baseline plus the pooled rise in obese men (+333 ng/dL, Tienforti 2023), so the bound itself is an ASSUMPTION. Above 500 the hormone rise IS measured (Tenover 1991 reached 1,390 ng/dL in healthy young men), but no trial has measured body composition there, so Forge runs it through the testosterone→lean curve, labels it an extrapolation, and starts its range at zero. The deeper gap: that curve (Bhasin 2001) was built on testosterone given from outside with the gonadotropins switched off. Whether an endogenous rise of the same size builds the same muscle has never been tested.',
      monitor: ['Total testosterone (morning, 4–6 weeks in)', 'Estradiol (sensitive assay)', 'Hematocrit', 'PSA', 'LH/FSH', 'Vision changes: stop and call the prescriber'],
      fertility: 'Preserved or improved — the main reason to pick it over testosterone.',
      timeCourse: 'Levels move within 2 weeks; trials ran 8–30 weeks. Long-term data are retrospective.',
      wada: 'WADA prohibited at all times, S4.2 (anti-estrogenic substances / SERMs).',
      suits: 'Low testosterone (two morning draws under ~300) with a normal or slightly raised LH, especially when fertility matters. It also raises the number in men who are already normal — that part is measured — but what that buys you is not.',
      notSuits: 'A clearly raised LH together with a low testosterone (primary testicular failure: the signal is not what is missing). Anyone already on testosterone. And anyone who wants a muscle result rather than a lab result at a normal baseline, because that has never been measured on this drug.',
      levelRisks: [{ min: 1, text: 'Estradiol rises on clomiphene, so breast tenderness or gynecomastia can appear; your prescriber tracks it along with hematocrit and PSA.' }],
      // No `lowTOnly` / `noEffectAbove` any more: the eugonadal response is measured, not absent (Tenover 1991,
      // Bremner 1987). `secondaryOnly` now fades rather than cliffs — see LH_PRIMARY / LH_PRIMARY_HARD.
      gate: { secondaryOnly: true },
    },
  },
  {
    id: 'enclomiphene', name: 'Enclomiphene citrate', category: 'prescription', rx: true, evidence: 'moderate',
    status: 'Not an FDA-approved drug and never has been: the Androxal new drug application drew a Complete Response Letter on 30 November 2015 and no approval followed. It reaches people through compounding pharmacies on a prescription. FDA\'s advisory committee voted 8–4 AGAINST putting it on the 503A bulks list on 8 June 2022, citing a lack of clinical efficacy evidence — but FDA has not acted on that vote, and enclomiphene citrate is still in 503A Category 1 ("bulk drug substances under evaluation", list updated 14 May 2026), where FDA says it does not intend to act against a compounder. It is NOT on the Category 2 "significant safety risks" list. WADA prohibited (S4.2).',
    summary: 'The purified trans-isomer of clomiphene, with the estrogenic cis-isomer removed. Two phase-3 trials reached testosterone levels equal to testosterone gel while raising LH and FSH and keeping sperm counts intact. Pooled rise in obesity-related low T: +216 ng/dL. The isomer story is real and the side-effect data lean its way — but no trial has ever randomized it against clomiphene, no trial has ever enrolled a man with a normal testosterone, and no trial has ever measured muscle on it.',
    mechanism: 'Same target as clomiphene — estrogen-receptor blockade at the hypothalamus and pituitary, so LH and FSH rise and your own testes make more testosterone — but it is one of clomiphene\'s two isomers rather than the mixture. Clomiphene citrate is 62% (trans)enclomiphene and 38% (cis)zuclomiphene (Wiehle 2013). Enclomiphene is the antiestrogen that does the work; zuclomiphene is an estrogen AGONIST that contributes little to the testosterone rise and has a half-life of about 30 days against enclomiphene\'s ~10 h, so it accumulates. That accumulation is measured, not theoretical: in 15 men on clomiphene 25 mg/day for ≥6 weeks the median serum zuclomiphene was 44.0 ng/mL against 2.2 ng/mL of enclomiphene — a 20:1 ratio (Helo 2017). On chronic clomiphene almost all the circulating drug is the estrogenic isomer. Taking enclomiphene alone removes that.',
    effects: [
      'Tienforti 2023 meta-analysis (obesity-related androgen deficiency, 7 studies, 292 men): enclomiphene +7.50 nmol/L ≈ +216 ng/dL (95% CI 6.52–8.48 nmol/L = 188–245 ng/dL), heterogeneity I²=4%. The SAME meta-analysis pooled clomiphene separately in the same population: +11.56 nmol/L ≈ +333 ng/dL (9.68–13.43). That is the only isomer-matched comparison in one population, and it puts enclomiphene at about 0.65 of clomiphene.',
      'The two direct head-to-head comparisons do NOT reproduce that gap, and neither found a significant difference. Thomas 2023 (Cureus, 46 enclomiphene vs 32 clomiphene, ≥3 months, retrospective): mean rise +124.96 vs +177.30 ng/dL, p=0.491. Saffati 2024 (Transl Androl Urol, 66 men who took clomiphene and were then switched to enclomiphene): median +98 ng/dL on clomiphene, then a further +166 on enclomiphene, p=0.20 — enclomiphene numerically HIGHER. Hohl 2025 pooled both isomers together against testosterone gel and found no difference in total T (5.41 ng/dL, 95% CI −43 to +54).',
      'Wiehle 2013 (phase 2, doi:10.1111/bju.12363) is the only dose-ranging trial, and it is a real dose-response rather than a flat line. Day-42 morning total T (C0) was 420 ± 212 on 6.25 mg (n=12), 404 ± 165 on 12.5 mg (n=7) and 604 ± 160 ng/dL on 25 mg (n=12), against 500 ± 278 on transdermal testosterone (across-group p=0.07). The 24-h means were 391 / 426 / 586 vs 546 (p=0.003) and the 24-h peaks (Cmax) 516 / 554 / 764 vs 908 (p=0.024). Measured as a RISE over each arm\'s own baseline, 6.25 and 12.5 mg are indistinguishable (≈43% of the 25 mg effect) and the step up comes at 25 mg; the responder analysis agrees (morning T >300 ng/dL in 58%, 71% and 100% of men).',
      'Wiehle\'s own conclusion was that the ceiling is the testis, not the drug: going from 12.5 to 25 mg roughly doubled LH (6.7 → 13.3 IU/L) but raised the 24-h mean testosterone only 27%, "suggesting a dose-limiting effect on the testosterone-producing Leydig cells of the testes, and the inability of enclomiphene citrate to stimulate the production of supernormal levels of testosterone".',
      'It is far steadier than gel. Over 24 h at week 6, 0 of 272 samples in the 25 mg arm were below 300 ng/dL against 50 of 305 (16.4%) on gel, and the within-day range was 314 ± 65 ng/dL against 590 ± 465 (coefficient of variation 21% vs 79%). There is also a "legacy" effect: LH, FSH and testosterone were still raised 7 days after the last dose, which the drug\'s own ~10 h half-life cannot explain.',
      'Kim 2016 (two parallel phase-3 RCTs, 256 overweight men with total T ≤300 and LH <9.4 IU/L, 16 weeks): testosterone rose on both doses; LH and FSH rose on enclomiphene and fell on gel, and sperm concentration was maintained on enclomiphene (+11.7% and +15.2% in the two studies) while gel suppressed it (−56.6% and −32.8%). Pooled across the whole SERM class, sperm concentration ran 70.4 million/mL higher than on gel (95% CI 41.6–99.2) and the risk of falling below 15 million/mL was 90% lower (RR 0.10, Hohl 2025).',
      'DHT stays much lower than on gel: 20.4 ± 9.1 (12.5 mg) and 23.2 ± 20.2 (25 mg) against 51.6 ± 37.7 on gel, p<0.05 for both (Wiehle 2014).',
      'SERUM ESTRADIOL STILL RISES — this is the part of the "less estrogen" claim that does not hold. Thomas 2023 measured estradiol going 29.5 → 67 pg/mL on enclomiphene (p=0.003, n=18) against 31 → 37.6 on clomiphene (p=0.074, n=11), i.e. the opposite of the expected direction, and the testosterone:estradiol ratio fell from 13.2 to 8.7 on enclomiphene while it rose from 7.9 to 12.5 on clomiphene. Wiehle 2014 lists "mildly increased blood estradiol" as an enclomiphene adverse event. Mechanistically this has to happen: more testosterone means more substrate for aromatase, and removing zuclomiphene does nothing to aromatase. Saffati 2024\'s −5.92 pg/mL is a fall measured from an already clomiphene-raised level, not from an untreated baseline, so it does not contradict this.',
      'What the isomer removal does change is estrogen ACTION and the side effects that track it. Saffati 2024 found adverse events in 31 of 66 men (47%) on clomiphene and 8 of 58 (13.8%) on enclomiphene in the same patients (p=0.001, OR 0.18, 95% CI 0.07–0.44) — see the tolerability block for the itemised rates.',
      'Lipids point the same way. Clomiphene lowered HDL in the one trial that measured body composition (Soares 2018, p<0.001); enclomiphene did not move HDL, LDL, total cholesterol or triglycerides at any of three doses over 6 weeks (Wiehle 2013, across-group p=0.78 for HDL). In baboons given the isomers separately, zuclomiphene raised serum cholesterol 22% while enclomiphene lowered it 8%.',
      'The one consistent enclomiphene-specific signal in the other direction: IGF-1 fell on every dose, from ≈96 to 50–62 µg/L over 6 weeks, significantly more than on gel (p≤0.008 for all three doses). Levels stayed inside the reference range and nobody knows what it means.',
      'NO enclomiphene trial has ever enrolled a man with a normal testosterone. Wiehle 2013 enrolled 48 and had to exclude 4 whose baseline came back above 350. Every published entry criterion is total T ≤300–350 with LH <9.4–12. So Forge\'s eugonadal numbers are an inference — see the assumption note on the curve below.',
      'Body composition and strength: not measured in any enclomiphene trial, at any baseline, ever. Forge credits muscle only up to 604 ng/dL and treats all of it as an unproven extrapolation, with a range starting at zero.',
    ],
    risks: [
      'Not FDA-approved, so there is no approved label, no approved dose and no post-marketing safety surveillance; compounded product quality varies by pharmacy.',
      'No long-term (multi-year) safety data at all. The longest randomized exposure is 16 weeks; clomiphene by contrast has a 400-man series out to 7 years and a 12,318-man claims cohort.',
      'Serum estradiol goes UP, not down (Thomas 2023: 29.5 → 67 pg/mL). The "no estrogen" framing is wrong; what the evidence supports is fewer estrogen-mediated SIDE EFFECTS, not a lower estradiol.',
      'IGF-1 fell on every dose in phase 2, more than on testosterone gel. The significance of that is unknown, and for someone whose goal is muscle it is the one finding that should give pause.',
      'In phase 3 the two treatment discontinuations in the 25 mg arm were for a high hematocrit/hemoglobin and a high PSA — the same two things any testosterone-raising therapy is monitored for.',
      'It still needs testes that can respond and a pituitary that is not the problem: a clearly raised LH with a low testosterone is primary failure and this is the wrong tool.',
    ],
    typicalUse: 'Prescribed off-label from a compounding pharmacy for secondary hypogonadism, especially when fertility matters; the prescriber sets dosing and monitors labs. The doses studied were 6.25, 12.5 and 25 mg once daily.',
    sources: [
      'Kim ED, McCullough A, Kaminetsky J. Oral enclomiphene citrate raises testosterone and preserves sperm counts in obese hypogonadal men, unlike topical testosterone: restoration instead of replacement. BJU Int. 2016;117(4):677-685. doi:10.1111/bju.13337',
      'Wiehle RD, et al. Enclomiphene citrate stimulates testosterone production while preventing oligospermia: a randomized phase II clinical trial comparing topical testosterone. Fertil Steril. 2014;102(3):720-727. doi:10.1016/j.fertnstert.2014.06.004',
      'Wiehle RD, et al. Testosterone restoration using enclomiphene citrate in men with secondary hypogonadism: a pharmacodynamic and pharmacokinetic study. BJU Int. 2013;112(8):1188-1200. doi:10.1111/bju.12363',
      'Kaminetsky J, et al. Oral enclomiphene citrate stimulates the endogenous production of testosterone and sperm counts in men with low testosterone: comparison with testosterone gel. J Sex Med. 2013;10(6):1628-1635. doi:10.1111/jsm.12116',
      'Helo S, Mahon J, Ellen J, Wiehle R, Fontenot G, Hsu K, Feustel P, Welliver C, McCullough A. Serum levels of enclomiphene and zuclomiphene in men with hypogonadism on long-term clomiphene citrate treatment. BJU Int. 2017;119(1):171-176. doi:10.1111/bju.13625',
      'Saffati G, Kassab J, Orozco Rendon D, Hinojosa-Gonzalez DE, Kronstedt S, Lipshultz LI, Khera M. Safety and efficacy of enclomiphene and clomiphene for hypogonadal men. Transl Androl Urol. 2024;13(9):1984-1990. doi:10.21037/tau-24-238',
      'Thomas J, Suarez Arbelaez MC, Narasimman M, et al. Efficacy of clomiphene citrate versus enclomiphene citrate for male infertility treatment: a retrospective study. Cureus. 2023;15(7):e41476. doi:10.7759/cureus.41476',
      'Rodriguez KM, Pastuszak AW, Lipshultz LI. Enclomiphene citrate for the treatment of secondary male hypogonadism. Expert Opin Pharmacother. 2016;17(11):1561-1567. doi:10.1080/14656566.2016.1204294',
      'Tienforti D, et al. Selective modulation of estrogen receptor in obese men with androgen deficiency: a systematic review and meta-analysis. Andrology. 2023;11(6):1067-1076. doi:10.1111/andr.13373',
      'Hohl A, et al. Clomiphene or enclomiphene citrate for the treatment of male hypogonadism: a systematic review and meta-analysis of randomized controlled trials. Arch Endocrinol Metab. 2025;69(5):e250093. doi:10.20945/2359-4292-2025-0093',
      'U.S. FDA. Bulk drug substances nominated for use in compounding under section 503A of the FD&C Act — Category 1, updated 14 May 2026.',
      'U.S. FDA. Pharmacy Compounding Advisory Committee, summary minutes, 8 June 2022 (enclomiphene citrate: 4 yes / 8 no / 0 abstain against inclusion on the 503A Bulks List).',
      WADA,
    ],
    model: {
      kind: 'tEndogenous',
      // A REAL dose ladder, replacing the "% of the studied regimen" placeholder. Wiehle 2013 is the only
      // dose-ranging trial in men; the anchors below are the RISE over each arm's own baseline as a fraction of
      // the 25 mg arm's rise, averaged over the two ways that trial reported it:
      //   morning C0:  6.25: 265→420 = +155 (0.44 of 25 mg's +351);  12.5: 295→404 = +109 (0.31)
      //   24-h mean:   6.25: 262→391 = +129 (0.45 of 25 mg's +286);  12.5: 280→426 = +146 (0.51)
      // 6.25 and 12.5 mg come out indistinguishable (0.44/0.31 and 0.45/0.51, n = 12 and 7, across-group p = 0.07
      // for C0), so Forge models them as the same ≈0.43 rather than inventing a slope between two points that
      // were not different. The step up is at 25 mg. Above 25 mg Forge plateaus: 50 mg was given for 2 weeks in
      // one arm of the second Wiehle 2014 study and never in the 3-month programme, so there is nothing to
      // extrapolate on, and Wiehle's own reading is that the Leydig cells, not the dose, are the limit.
      // Expressed as a share of the studied regimen rather than in mg, the same as every other §22 prescription
      // item: Forge reports what the trials gave (named in `effects` above) and never offers a number a man
      // could dose himself from. 25% and 50% of the regimen are the 6.25 and 12.5 mg arms.
      dose: { unit: '% of the studied regimen', default: 100, label: 'as studied (the dose carried through phase 3)', studied: [25, 100],
        note: 'The only dose-ranging trial tested three arms. The two lower ones produced about 43% of the top arm\'s rise and were not different from each other; the step up came at the top dose. Your prescriber sets the dose.' },
      response: [[0, 0], [25, 0.43], [50, 0.43], [100, 1]],
      // CORRECTED 2026-10-20 (second correction; supersedes assumption A15). The previous comment said the whole
      // eugonadal arm was "clomiphene's measured eugonadal response scaled by 216/274". Two things were wrong
      // with that:
      //   1. It was CIRCULAR. 274 ng/dL is Hohl 2025's pooled SERM-vs-placebo effect, and that pool CONTAINS the
      //      enclomiphene trials (Kim 2016, both Wiehle 2014 studies) alongside the clomiphene ones. Scaling
      //      enclomiphene against a pool that includes enclomiphene is not a comparison.
      //   2. It misdescribed the arithmetic. These anchors are 0.787x clomiphene's at every baseline, and
      //      0.787 x 274 = 216 — which is simply Tienforti 2023's directly measured, ENCLOMIPHENE-SPECIFIC
      //      pooled effect (+7.50 nmol/L, 95% CI 6.52-8.48, I-squared 4%, in 292 men). The hypogonadal arm of this
      //      curve is therefore a MEASUREMENT of this drug, not an inference from the other one.
      // What is actually inferred is the SHAPE above ~350 ng/dL, not the size: Forge carries the constant
      // absolute rise upward because Keihani 2020 (n=332) and Kim 2026 (n=292) both found baseline total T does
      // not predict the size of the response — and both of those are CLOMIPHENE cohorts. Nobody has tested
      // whether enclomiphene behaves the same way, because nobody has given it to a eugonadal man. That is
      // assumption A15, restated: the shape is borrowed, the magnitude is this drug's own.
      // Cross-check on the ratio, since it is the thing people argue about. Tienforti pooled the two isomers
      // SEPARATELY in the same population: clomiphene +333 ng/dL, enclomiphene +216, ratio 0.65. The two direct
      // head-to-heads disagree and neither reached significance: Thomas 2023 +125 vs +177 (ratio 0.70, p=0.49)
      // and Saffati 2024 +166 vs +98 (ratio 1.69, p=0.20). Forge's 0.787 sits between 0.65 and 1.0, which is
      // where the evidence sits. The uncertainty is carried in tCI below rather than in the point estimate.
      tPctByBaseline: [[150, 144], [200, 108], [250, 86], [300, 72], [350, 62], [400, 54], [450, 48], [500, 43], [550, 39], [650, 32], [800, 24], [1000, 17]],
      rampWeeks: 6, maxLevel: 764,
      // Ceiling, RE-DERIVED 2026-10-20 and deliberately left at 764 with its provenance spelled out, because the
      // obvious "fix" is wrong. 764 ng/dL is Wiehle 2013's 25 mg day-42 24-h Cmax (764 +/- 164) — the single
      // highest group mean any enclomiphene trial has reported by any measure. The highest MORNING group mean
      // (C0, the measurement Forge's serum numbers actually are) is 604, and the highest 24-h mean is 586, so
      // capping a morning level at 764 is the generous reading.
      // Why not drop the ceiling to the morning-comparable 604? Because 604 is the highest level observed in
      // obese HYPOGONADAL men at the highest dose anyone tested — it is not a probe of the drug's ceiling.
      // Clomiphene's 1,390 is a real probe: Tenover 1991 gave it to healthy eugonadal men. Enclomiphene has
      // never been given to one. Hard-capping at 604 would therefore open a 700 ng/dL gap between two drugs
      // that are the same molecule minus an isomer which barely moves testosterone — an artefact of which
      // populations were enrolled, not a pharmacological claim. The 604-764 band is an ASSUMPTION; the
      // conservative reading is carried by bcMaxLevel (604, a hard bound on muscle credit) and by the lean
      // range starting at zero.
      axis: 'serm', ceilingNg: 764,
      // WIDENED 2026-10-20. Was [0.87, 1.13] = Tienforti's CI on the enclomiphene estimate alone, which is the
      // uncertainty of a pooled hypogonadal mean and not the uncertainty of the number Forge is showing. The low
      // end now carries Tienforti's isomer-matched reading that enclomiphene is ~0.65 of clomiphene; the high
      // end carries the two direct head-to-heads and the gel comparison, which are all consistent with the two
      // drugs being equal (Saffati had enclomiphene ahead).
      tCI: [0.80, 1.45],
      // CORRECTED 2026-10-20. Was 45, i.e. "estradiol rises half as much as on clomiphene because the estrogenic
      // isomer is gone". That reasoning conflates two different things and the data contradict it. Serum
      // estradiol rises because a SERM raises testosterone, which is the substrate aromatase works on; removing
      // zuclomiphene does nothing to aromatase. Thomas 2023 measured 29.5 -> 67 pg/mL on enclomiphene (p=0.003)
      // against 31 -> 37.6 on clomiphene (p=0.074) — if anything the wrong way round. Hohl 2025's pooled +34
      // pg/mL includes the enclomiphene trials. Wiehle 2014 lists raised estradiol as an enclomiphene adverse
      // event. So Forge now models the serum rise at 85%, just under clomiphene's 90% in proportion to the
      // slightly smaller pooled testosterone rise, instead of halving it.
      e2Pct: 85, e2ActionPct: 85, shbgDelta: 3,
      e2Note: 'Estradiol goes UP on enclomiphene, not down — about as much as on clomiphene, because what drives it is the extra testosterone being aromatised and removing the cis-isomer does nothing to aromatase. Thomas 2023 measured 29.5 → 67 pg/mL (p=0.003). What the isomer removal changes is estrogen ACTION in tissue, and the side effects that follow from it, not the number on the lab report. As with clomiphene, Forge credits no fat change from a SERM\'s serum-E2 rise.',
      e2ActionNote: 'Forge tracks estrogen ACTION separately from serum estradiol, and applies a fat effect only when action is BLOCKED (aromatase inhibitors, Finkelstein 2013). A SERM raises the hormone while blocking the receptor centrally and acting as an agonist or antagonist elsewhere depending on tissue — net direction unknown — so no fat term is applied here for either isomer. The e2ActionPct figure is carried for documentation and is not read by the fat model for SERMs.',
      shbgNote: 'SHBG rises a little, as on clomiphene; the pooled SERM change was not significant (+3.63 nmol/L, p=0.09, Hohl 2025). Forge models +3 nmol/L, and the bioavailable fraction is treated as unchanged (measured directly for clomiphene in Bremner 1987: 65% → 66% of total).',
      bodyComp: 'extrapolated', bcMaxLevel: 604,
      bcNote: 'EXTRAPOLATED TWICE OVER, and still the weakest row of the three SERMs. (1) No enclomiphene trial has ever measured body composition, at any baseline, so the 604 ng/dL bound is not "where a body-composition trial landed" — it is simply the highest morning group mean any enclomiphene trial reached (Wiehle 2013, 25 mg, day-42 C0 = 604 ± 160), and Forge refuses to run the muscle curve above a level the drug has never been shown to produce. (2) No enclomiphene trial has ever enrolled a eugonadal man, so the hormone rise shown above ~350 ng/dL is itself inferred. And the Bhasin curve the credit runs through came from testosterone given from OUTSIDE with the gonadotropins switched off, which is not what this drug does. Range starts at zero.',
      // §22.8. The reason this entry exists in its current form: Bob asked whether enclomiphene is better
      // tolerated. It is the one question in this catalogue where the answer is genuinely "yes, probably, and
      // here is the number" — but the number comes from one unblinded retrospective chart review, so the grade
      // is capped at 'moderate' and the caveats travel with it.
      tolerability: {
        grade: 'good', comparedWith: 'placebo in its own randomized trials; clomiphene in one retrospective within-patient comparison',
        evidence: 'rct',
        headline: 'Fewer side effects than clomiphene in the only direct comparison: 13.8% vs 47% of the same men (p=0.001, OR 0.18).',
        discontinuation: { pct: 2.4, n: 2, of: 85, note: 'Both in the 25 mg arm of the phase-3 programme, and both for a lab value rather than a symptom: one raised hematocrit/hemoglobin, one raised PSA. The testosterone-gel arm had one discontinuation for the same hematocrit reason.', source: 'Kim 2016 (Hohl 2025 safety table)' },
        events: [
          { label: 'Any adverse event attributed to study drug', pct: 21, n: 53, of: 256, arm: 'all arms pooled', p: 'no significant difference between enclomiphene, testosterone gel and placebo', source: 'Kim 2016, two phase-3 RCTs' },
          { label: 'Any adverse event (vs clomiphene, same patients)', pct: 13.8, n: 8, of: 58, arm: 'enclomiphene', vs: { pct: 47, n: 31, of: 66, label: 'clomiphene' }, p: '0.001 (OR 0.18, 95% CI 0.07–0.44)', source: 'Saffati 2024' },
          { label: 'Decreased libido', pct: 8.6, n: 5, of: 58, arm: 'enclomiphene', vs: { pct: 33.3, n: 22, of: 66, label: 'clomiphene' }, p: '0.001 (OR 0.18, 95% CI 0.06–0.53)', source: 'Saffati 2024' },
          { label: 'Mood changes', pct: 0, n: 0, of: 58, arm: 'enclomiphene', vs: { pct: 9.1, n: 6, of: 66, label: 'clomiphene' }, p: '0.03', source: 'Saffati 2024' },
          { label: 'Reduced energy', pct: 5.2, n: 3, of: 58, arm: 'enclomiphene', vs: { pct: 16.7, n: 11, of: 66, label: 'clomiphene' }, p: '0.044', source: 'Saffati 2024' },
          { label: 'Erectile dysfunction', pct: 8.6, n: 5, of: 58, arm: 'enclomiphene', vs: { pct: 18.2, n: 12, of: 66, label: 'clomiphene' }, p: '0.12 — not significant', source: 'Saffati 2024' },
          { label: 'Gynecomastia', pct: 0, n: 0, of: 58, arm: 'enclomiphene', vs: { pct: 3.0, n: 2, of: 66, label: 'clomiphene' }, p: '0.49 — not significant, and the numbers are far too small to separate', source: 'Saffati 2024' },
          { label: 'Hematocrit change', pct: null, n: null, of: 66, arm: 'median 0%', vs: { pct: null, n: null, of: 66, label: 'clomiphene, median +0.4%' }, p: '0.85 — no difference', source: 'Saffati 2024' },
          { label: 'Treatment-emergent adverse events', pct: null, n: null, of: 124, arm: '9–20% across all arms, same on enclomiphene as on placebo; the only enclomiphene events were one mildly raised estradiol and two headaches', p: 'no discontinuations for adverse events, no serious adverse events on enclomiphene', source: 'Wiehle 2014, phase 2b' },
          { label: 'HDL cholesterol', pct: null, n: null, of: 48, arm: 'unchanged at 6.25, 12.5 and 25 mg over 6 weeks (across-group p=0.78); LDL, total cholesterol and triglycerides also unchanged', p: 'contrast: clomiphene lowered HDL, p<0.001 (Soares 2018)', source: 'Wiehle 2013' },
          { label: 'IGF-1', pct: null, n: null, of: 48, arm: 'FELL on every dose, ≈96 → 50–62 µg/L over 6 weeks, significantly more than on testosterone gel (p≤0.008)', p: 'the one tolerability signal that runs against enclomiphene; stayed within the reference range and the meaning is unknown', source: 'Wiehle 2013' },
        ],
        note: 'Read this carefully before treating it as settled. The randomized evidence says enclomiphene is no worse than placebo (Kim 2016, Wiehle 2014) — but there has never been a randomized trial of enclomiphene against clomiphene, so the randomized evidence cannot rank them. The entire direct comparison is Saffati 2024: 66 men at one centre, retrospective, unblinded, adverse events counted from clinic notes, everyone took clomiphene FIRST and enclomiphene second with no washout, and the authors list the problems themselves — carry-over from zuclomiphene\'s ~30-day half-life, different reasons for switching, and a hypogonadal baseline for clomiphene against an already-corrected one for enclomiphene. A second-drug-in-sequence is also simply less likely to have its side effects written down. The mechanism is real and the direction is consistent (lower estradiol relative to clomiphene, no HDL fall, zuclomiphene the estrogen agonist removed), which is why the grade is "good" and not "unknown" — but one unblinded chart review is why it is capped there and not called proven.',
        sources: [
          'Saffati G, et al. Safety and efficacy of enclomiphene and clomiphene for hypogonadal men. Transl Androl Urol. 2024;13(9):1984-1990. doi:10.21037/tau-24-238',
          'Kim ED, McCullough A, Kaminetsky J. BJU Int. 2016;117(4):677-685. doi:10.1111/bju.13337 (safety table as tabulated by Hohl 2025, doi:10.20945/2359-4292-2025-0093)',
          'Wiehle RD, et al. Fertil Steril. 2014;102(3):720-727. doi:10.1016/j.fertnstert.2014.06.004',
          'Wiehle RD, et al. BJU Int. 2013;112(8):1188-1200. doi:10.1111/bju.12363',
        ],
      },
      monitor: ['Total testosterone (morning — Wiehle 2013 showed a single morning draw predicts the 24-h mean, r=0.93)', 'Estradiol (sensitive assay — it rises)', 'Hematocrit', 'PSA', 'LH/FSH', 'IGF-1 (it fell on every dose in phase 2)'],
      fertility: 'Preserved, and this is the one place enclomiphene has a clear, randomized, measured advantage over testosterone: LH and FSH rise, and sperm concentration was maintained (+11.7% and +15.2%) where gel suppressed it (−56.6% and −32.8%) in the same trials (Kim 2016).',
      timeCourse: 'Testosterone rises within 14 days and plateaus by about 4 weeks; LH, FSH and testosterone were still raised 7 days after the last dose.',
      wada: 'WADA prohibited at all times, S4.2 (anti-estrogenic substances / SERMs). Clomifene is named on the list and enclomiphene is its trans-isomer, so the class covers it; the DoD prohibited-ingredient list names enclomiphene directly.',
      suits: 'Overweight men with secondary hypogonadism (T ≤300, with a normal or only slightly raised LH) who want fertility preserved, and men who tried clomiphene and could not tolerate it — that second group is where the evidence for it is strongest.',
      notSuits: 'Anyone in the normal range: not because it would do nothing, but because no enclomiphene trial has ever studied one, so Forge is inferring the shape of the response from clomiphene. Clomiphene is the better-evidenced choice at a normal baseline and costs a fraction as much. Also: no FDA approval, no long-term safety data, and an unexplained fall in IGF-1.',
      gate: { secondaryOnly: true },
    },
  },
  {
    id: 'hcg', name: 'hCG (human chorionic gonadotropin) — an injection, but not testosterone', category: 'prescription', rx: true, evidence: 'moderate',
    status: 'Prescription only, and an injection — but NOT testosterone: it makes your own testes produce testosterone instead of replacing it. Regulated as a biologic since 2020, which took it out of ordinary compounding. WADA prohibited in males (S2 gonadotropins).',
    summary: 'Acts like LH directly on the testes, so it works even when the pituitary signal is the problem. The one placebo-controlled trial in older men with low testosterone raised T about 150% and added roughly 2 kg of lean mass in 3 months — but strength, balance and physical function did not improve at all.',
    mechanism: 'hCG binds the LH receptor on Leydig cells, driving testosterone production inside the testis. That intratesticular testosterone is also what sperm production needs, which is why it is used alongside testosterone therapy to protect fertility.',
    effects: [
      'Liu 2002 (double-blind RCT, 40 men over 60 with low T, 3 months): total and free T and estradiol up about 150%; lean body mass +2 kg (p<0.001), fat mass −1 kg; LH and FSH fell and testis volume dropped about 5 mL.',
      'Crucially, in that same trial shoulder and knee strength, physical activity, gait and balance did not improve. More lean mass on the scan did not become more function.',
      'Habous 2018 (randomized, 282 hypogonadal men wanting fertility, baseline ≈67 ng/dL, 5,000 IU twice weekly, 12 weeks): clomiphene +158, hCG +134, both together +153 ng/dL — the combination was no better than clomiphene alone (p=0.57). This is the single best piece of evidence that these drugs do not add up.',
      'Alongside testosterone therapy it preserves sperm: in Hsieh 2013 no man became azoospermic and semen parameters held steady.',
      'It works at a normal baseline too, which is the point of the hCG stimulation test: Cailleux-Bounacer 2008 found dose-dependent testosterone and estradiol rises in NORMAL men (peak at 72 h), and Panidis 2002 gave 5,000 IU to 30 fertile eugonadal men aged 23–38 and tracked the testosterone rise for a week. Those are single injections, though — nobody has run chronic hCG in a eugonadal man, so Forge\'s numbers above ~430 ng/dL are a conservative assumption, not a measurement.',
      'Forge credits muscle up to about 870 ng/dL here, inferred from Liu 2002\'s ≤15 nmol/L (433 ng/dL) entry criterion and its reported +150% rise. The exact achieved level is not in the paper, so that bound is an assumption.',
    ],
    risks: [
      'Nipple tenderness and gynecomastia (estradiol rises with it).',
      'Suppresses your own LH and FSH while you are on it, and testis volume fell in the trial.',
      'Injections, with the usual infection and site-reaction risks.',
      'Not available through ordinary compounding since it became a licensed biologic; brand-name products need a prescription.',
    ],
    typicalUse: 'Prescribed and monitored by a physician for secondary hypogonadism or to protect fertility alongside testosterone therapy; the prescriber sets dose and frequency.',
    sources: [
      'Liu PY, Wishart SM, Handelsman DJ. A double-blind, placebo-controlled, randomized clinical trial of recombinant human chorionic gonadotropin on muscle strength and physical function and activity in older men with partial age-related androgen deficiency. J Clin Endocrinol Metab. 2002;87(7):3125-3135.',
      'Habous M, et al. Clomiphene citrate and human chorionic gonadotropin are both effective in restoring testosterone in hypogonadism: a short-course randomized study. BJU Int. 2018;122(5):889-897.',
      'Hsieh TC, et al. Concomitant intramuscular human chorionic gonadotropin preserves spermatogenesis in men undergoing testosterone replacement therapy. J Urol. 2013;189(2):647-650.',
      'Rastrelli G, et al. Factors affecting spermatogenesis upon gonadotropin-replacement therapy: a meta-analytic study. Andrology. 2014;2(6):794-808.',
      WADA,
    ],
    model: {
      kind: 'tEndogenous',
      dose: { unit: '% of the studied regimen', default: 100, label: 'as studied (prescriber-set dose)', studied: [0, 100] },
      response: [[0, 0], [100, 1]],
      // CORRECTED 2026-10-20: the old curve fell off a cliff to zero at 500 ng/dL. That was the same unexamined
      // inference as clomiphene's, and it is contradicted by the fact that hCG stimulation IS the standard
      // clinical test of Leydig-cell reserve in NORMAL men, precisely because a normal testis makes more
      // testosterone when you give it more LH signal. Cailleux-Bounacer 2008 (Eur J Endocrinol 159:171-8,
      // doi:10.1530/EJE-07-0876) showed dose-dependent rises in plasma testosterone and estradiol in normal men,
      // peaking 72 h after the injection, and Panidis 2002 did the same with 5,000 IU in 30 fertile men aged
      // 23-38. So the number is NOT zero at a normal baseline.
      // BUT: those are single-injection stimulation tests. Nobody has given chronic hCG to a eugonadal man and
      // measured anything. The arm above 430 ng/dL is therefore an ASSUMPTION — a conservative taper, deliberately
      // below the near-doubling a full stimulation test produces acutely.
      tPctByBaseline: [[150, 200], [250, 160], [350, 150], [430, 140], [500, 120], [600, 95], [800, 65], [1100, 40]],
      rampWeeks: 4, maxLevel: 1100,
      // 1,100 ng/dL is an ASSUMPTION (top of the male reference range): the highest level actually observed on
      // hCG is Liu 2002's inferred ≈870, well below the 1,390 clomiphene has been measured to reach.
      axis: 'gonadotropin', ceilingNg: 1100,
      tCI: [0.6, 1.4],
      e2Pct: 150, e2ActionPct: 150, shbgDelta: 0,
      e2Note: 'Estradiol rose about 150% alongside testosterone in Liu 2002 — hCG drives the whole steroidogenic pathway, not just testosterone. Fat fell 1 kg in that trial, which is the measured number Forge uses; no separate estradiol term is applied.',
      // §22.8. Thin: no trial has tabulated hCG adverse events against a comparator in this population, so the
      // grade rests on what the trials reported happening rather than on an AE table.
      tolerability: {
        grade: 'moderate', comparedWith: 'placebo in one 40-man randomized trial; no head-to-head against a SERM on adverse events',
        evidence: 'rct',
        headline: 'No adverse-event table has ever been published for hCG in this population. What is documented is that it shrinks the testes and roughly doubles estradiol.',
        discontinuation: null,
        events: [
          { label: 'Testis volume', pct: null, n: null, of: 20, arm: 'fell about 5 mL on hCG over 3 months', p: 'a measured, expected pharmacological effect, and the reason it is not a long-term monotherapy', source: 'Liu 2002' },
          { label: 'Estradiol', pct: null, n: null, of: 20, arm: 'rose about 150%, in step with testosterone', p: 'hCG drives the whole steroidogenic pathway; nipple tenderness and gynecomastia are the usual complaints', source: 'Liu 2002' },
          { label: 'LH and FSH', pct: null, n: null, of: 20, arm: 'suppressed while on treatment', p: 'the opposite of what a SERM does, and worth knowing if the point of avoiding testosterone was to keep the axis running', source: 'Liu 2002' },
          { label: 'Injection-site reactions and infection', pct: null, n: null, of: null, arm: 'the usual injection risks; not quantified in these trials', source: 'no quantified data' },
        ],
        note: 'Liu 2002 is 40 men for 3 months, and it reported efficacy endpoints rather than a safety table; Habous 2018 reported neither. So the honest reading is "no quantified tolerability data", and the "moderate" grade is carried by the two things that ARE measured — testicular shrinkage and a 150% estradiol rise — plus the fact that it is an injection rather than a tablet.',
        sources: [
          'Liu PY, Wishart SM, Handelsman DJ. J Clin Endocrinol Metab. 2002;87(7):3125-3135.',
          'Habous M, et al. BJU Int. 2018;122(5):889-897.',
        ],
      },
      bodyComp: 'measured', bcMaxLevel: 870, bcMaxBaseline: 433,
      bcNote: 'MEASURED, and the only placebo-controlled lean-mass result in this whole class: Liu 2002, 40 men over 60, 3 months, lean +2 kg (p<0.001) and fat −1 kg (p<0.05) — with NO improvement in shoulder or knee strength, gait, balance or physical activity. The 870 ng/dL bound is inferred from the ≤433 ng/dL entry criterion and the reported +150%; the achieved mean is not published, so the bound is an assumption.',
      monitor: ['Total testosterone and estradiol', 'Hematocrit', 'Testis volume (it fell ~5 mL in the trial)', 'LH/FSH (they are suppressed while you use it)'],
      fertility: 'The reason it exists: intratesticular testosterone is what sperm production needs, so it is used alongside testosterone therapy to protect fertility.',
      timeCourse: 'Levels rise within days; Liu 2002 ran 3 months.',
      wada: 'WADA prohibited at all times in males, S2.2 (chorionic gonadotropin).',
      suits: 'Low testosterone with fertility to protect, including men already on testosterone therapy. It works even when the pituitary signal is the problem, because it replaces LH.',
      notSuits: 'Primary (testicular) failure where the testes cannot respond; anyone who would rather not inject. At a normal baseline it still raises the number — that is what a Leydig stimulation test is — but no one has run it chronically in a eugonadal man or measured what it does to him.',
      // Primary (testicular) failure blocks this: hCG replaces the LH signal, but a testis that cannot respond
      // to its own already-maximal LH will not respond to hCG either. `lowTOnly`/`noEffectAbove` removed — see
      // the curve comment above.
      gate: { secondaryOnly: true },
      levelRisks: [{ min: 1, text: 'Estradiol rises with hCG: breast tenderness and gynecomastia are the common complaints, and your own LH and FSH are suppressed while you use it.' }],
    },
  },
  {
    id: 'aromatase_inhibitor', name: 'Aromatase inhibitor (anastrozole, letrozole), off-label', category: 'prescription', rx: true, evidence: 'strong',
    status: 'Prescription only; approved for breast cancer, used off-label in men. WADA prohibited (S4.1).',
    summary: 'These reliably raise testosterone by 30–150% by blocking its conversion to estradiol. They are also the clearest case in this whole area where a big testosterone number bought nothing: two year-long randomized trials measured body composition and strength and found no change, and spine bone density fell. Forge raises your testosterone number and deliberately credits zero muscle.',
    mechanism: 'Blocks aromatase, so less testosterone becomes estradiol. Lower estradiol means less negative feedback, so LH rises and testosterone rises. The catch is that men need estradiol — it is what protects bone and, per Finkelstein 2013, what keeps fat mass down.',
    effects: [
      'Leder 2004 (RCT, men 62–74 with T under 350): daily dosing took total T from 343 ± 61 to 572 ± 139 ng/dL (+67%); a twice-weekly schedule gave +31%. No change in quality of life, erectile function or hematocrit.',
      'Burnett-Bowie 2009 (RCT, men ≥60, 12 months, anastrozole 1 mg): total T 11.2 → 18.2 nmol/L (323 → 525 ng/dL) at 3 months, bioavailable T 2.7 → 5.4 nmol/L — and body composition (CT and DXA) and strength did not change. Estradiol fell only 55.8 → 42.2 pmol/L (−24%), because the rising testosterone feeds the enzyme more substrate.',
      'A second 12-month RCT (Burnett-Bowie 2009b, n=69) found spine bone density fell on anastrozole (1.121 → 1.102 g/cm²) while it rose on placebo (1.180 → 1.189), p=0.0014. Estradiol 15 → 12 pg/mL. "Aromatase inhibition does not improve skeletal health in aging men."',
      'Loves 2013 (RCT, letrozole, 42 men with BMI >35, 6 months): estradiol 119 → 59 pmol/L, LH 3.3 → 8.8 IU/L, total T 8.6 → 21.5 nmol/L (248 → 620 ng/dL, +150%) — and "significant effects on the predefined endpoints were not observed", body composition included.',
      'Finkelstein 2013 (NEJM, 400 men, goserelin + graded testosterone ± anastrozole): the cohort × dose interaction was significant for % body fat (P=0.001), intra-abdominal fat (P=0.021) and subcutaneous fat (P=0.029), and NOT significant for lean mass (P=0.22), thigh-muscle area (P=0.20) or leg-press strength (P=0.91). Androgen runs muscle; estrogen runs fat.',
      'The catch that reconciles all of it: Finkelstein crushed estradiol to 1–3 pg/mL (the testes were switched off, so anastrozole had almost no substrate to work on). In a man with a working axis the same 1 mg only drops estradiol 20–50%, which is why the real-world AI trials found no fat effect. Forge scales the fat penalty by how much estrogen action you actually lose, so a real-world AI gives a small number with a range that includes zero.',
      'Two more failures to replicate the fat penalty: Mauras 2000 (anastrozole 1 mg, 10 weeks, young men; estradiol −48%, no change in fat-free mass, fat mass, protein synthesis or strength) and Dias 2016/2017 (RCT, 12 months, older men; the AI arm LOST abdominal subcutaneous fat and leptin).',
    ],
    risks: [
      'Spine bone-mineral density fell over a year in a randomized trial. In a man already at risk (endurance athlete, low energy availability) that is a real concern.',
      'Low estradiol in men causes joint aches, low libido and, over time, bone loss.',
      'One pulmonary embolism occurred in the anastrozole arm of a head-to-head trial (in a man with a prior clot).',
      'Because it lowers estradiol, it works against fat loss, which is usually the opposite of the goal.',
    ],
    typicalUse: 'Off-label, physician-prescribed and monitored, usually for men with low testosterone and a high estradiol ratio or for gynecomastia; dose and schedule are the prescriber\'s call, with estradiol and bone density watched.',
    sources: [
      'Leder BZ, et al. Effects of aromatase inhibition in elderly men with low or borderline-low serum testosterone levels. J Clin Endocrinol Metab. 2004;89(3):1174-1180.',
      'Burnett-Bowie SM, et al. Effects of aromatase inhibition in hypogonadal older men: a randomized, double-blind, placebo-controlled trial. Clin Endocrinol. 2009;70(1):116-123.',
      'Burnett-Bowie SM, et al. Effects of aromatase inhibition on bone mineral density and bone turnover in older men with low testosterone levels. J Clin Endocrinol Metab. 2009;94(12):4785-4792.',
      'Loves S, et al. Letrozole once a week normalizes serum testosterone in obesity-related male hypogonadism. Eur J Endocrinol. 2008;158(5):741-747.',
      'Loves S, et al. Effects of letrozole on the lipid profile, body composition and quality of life in obese men with hypogonadotropic hypogonadism: a randomized placebo-controlled trial. Eur J Endocrinol. 2013;169(5):705-714.',
      'Finkelstein JS, et al. Gonadal steroids and body composition, strength, and sexual function in men. N Engl J Med. 2013;369(11):1011-1022. doi:10.1056/NEJMoa1206168',
      'Mauras N, et al. Estrogen suppression in males: metabolic effects. J Clin Endocrinol Metab. 2000;85(7):2370-2377. doi:10.1210/jcem.85.7.6676',
      'Dias JP, et al. Testosterone vs. aromatase inhibitor in older men with low testosterone: effects on cardiometabolic parameters. Andrology. 2017;5(1):31-40. doi:10.1111/andr.12284',
      'Colleluori G, et al. Aromatase inhibitors plus weight loss improves the hormonal profile of obese hypogonadal men without causing major side effects. Front Endocrinol. 2020;11:277. doi:10.3389/fendo.2020.00277',
      WADA,
    ],
    model: {
      kind: 'tEndogenous',
      dose: { unit: '% of the studied regimen', default: 100, label: 'as studied (prescriber-set dose)', studied: [0, 100] },
      response: [[0, 0], [100, 1]],
      // Unlike the SERMs, an AI has a randomized testosterone rise in EUGONADAL males too: Mauras 2000 found +58%
      // in males aged 15–22 with normal levels, with no body-composition change. So there is no low-T gate here —
      // the number moves at any baseline, and Forge still credits zero muscle and applies the estradiol fat term.
      tPctByBaseline: [[200, 70], [320, 67], [450, 60], [600, 58], [900, 40]],
      rampWeeks: 4, maxLevel: 800, tLeanShare: 0,
      axis: 'ai', ceilingNg: 800, tCI: [0.45, 2.2],   // +31 % (twice-weekly) to +150 % (letrozole) around ≈ +67 %
      // Estradiol in men with an INTACT axis: −24 % (Burnett-Bowie 2009a), −20 % (2009b), −50 % (Loves 2013),
      // −52 % (Colleluori 2020), −48 % (Mauras 2000). Mean ≈ −35 %.
      e2Pct: -35, e2ActionPct: -35, shbgDelta: 0,
      shbgNote: 'SHBG did not change on anastrozole (Mauras 2000).',
      e2Note: 'This is the only item where Forge applies the Finkelstein 2013 fat term, because it is the only one that blocks estrogen SYNTHESIS. The penalty is scaled by how much estrogen action is lost: a real-world 20–50% drop is a fraction of Finkelstein\'s ~90%.',
      // §22.8. The only item in this group graded 'poor', and it is graded on a measured structural harm rather
      // than on how men say they feel.
      tolerability: {
        grade: 'poor', comparedWith: 'placebo over 12 months (Burnett-Bowie 2009); clomiphene over 12 weeks (Helo 2015)',
        evidence: 'rct',
        headline: 'Spine bone density FELL over a year of randomized treatment. That is a measured harm, not a symptom, and it is why this is the one item here graded poor.',
        discontinuation: { pct: 7.7, n: 1, of: 13, note: 'One man stopped for a rash in the 12-week randomized comparison with clomiphene; the clomiphene arm lost one man to follow-up rather than to an adverse event.', source: 'Helo 2015 (Hohl 2025 safety table)' },
        events: [
          { label: 'Spine bone mineral density', pct: null, n: null, of: 69, arm: 'FELL over 12 months of randomized anastrozole vs placebo', p: 'the reason Forge grades this poor; relevant to anyone with a history of endurance training or low energy availability', source: 'Burnett-Bowie 2009' },
          { label: 'Pulmonary embolism', pct: 7.7, n: 1, of: 13, arm: 'anastrozole', vs: { pct: 0, n: 0, of: 13, label: 'clomiphene' }, p: 'in a man with a prior DVT; n=13 per arm, so this is a single event and not a rate', source: 'Helo 2015' },
          { label: 'Joint aches and low libido', pct: null, n: null, of: null, arm: 'the standard aromatase-inhibitor complaints; not separately quantified in the male off-label trials', p: 'mechanistically expected — low estradiol is the mechanism and the problem', source: 'Burnett-Bowie 2009' },
          { label: 'Symptom score vs clomiphene', pct: null, n: null, of: 13, arm: 'ADAM score 38.0 ± 1.3 on anastrozole vs 40.0 ± 1.3 on clomiphene', p: '0.634 — no difference in how men felt', source: 'Helo 2015' },
        ],
        note: 'Unusually for this catalogue, the tolerability problem here is not what men report — symptom scores matched clomiphene — it is what the scan showed. Bone is the endpoint that decides this grade, and it took a 12-month randomized trial to see it. Forge already credits zero muscle for this item; "poor tolerability" is the second half of the same story.',
        sources: [
          'Burnett-Bowie SM, et al. Effects of aromatase inhibition on bone mineral density and bone turnover in older men with low testosterone levels. J Clin Endocrinol Metab. 2009;94(12):4785-4792.',
          'Helo S, et al. A randomized prospective double-blind comparison trial of clomiphene citrate and anastrozole in raising testosterone in hypogonadal infertile men. J Sex Med. 2015;12(8):1761-1769. (safety data as tabulated by Hohl 2025, doi:10.20945/2359-4292-2025-0093)',
        ],
      },
      bodyComp: 'none', bcMaxLevel: 0,
      bcNote: 'MEASURED AND NULL. Two 12-month randomized trials (Burnett-Bowie 2009 ×2) measured body composition by CT and DXA and strength and found no change; Loves 2013 found nothing on any predefined endpoint despite +150% testosterone; Mauras 2000 found no change in fat-free mass, fat mass or protein synthesis. Forge therefore raises your testosterone number and credits ZERO muscle — the clearest case in this whole area that a bigger number is not more muscle.',
      monitor: ['Estradiol (sensitive assay) — the point is not to crush it', 'Total testosterone', 'Spine bone-mineral density if used beyond a few months', 'Lipids'],
      fertility: 'LH and FSH rise, so spermatogenesis is preserved or improved; it is used off-label in male infertility.',
      timeCourse: 'Testosterone peaks at ~3 months and drifts back down by 12 (Burnett-Bowie 2009).',
      wada: 'WADA prohibited at all times, S4.1 (aromatase inhibitors).',
      suits: 'Obese men with low testosterone and a genuinely high estradiol, under a prescriber — and even then for the hormone profile, not for muscle.',
      notSuits: 'Anyone whose goal is muscle (measured: none), anyone at risk of bone loss (endurance athletes, low energy availability), and anyone with a normal estradiol.',
      leanNullNote: 'two 12-month randomized trials measured body composition and strength on it and found no change, and spine bone density fell',
      // It works by removing estrogen feedback so LH rises. If LH is already high (primary), there is no feedback
      // left to remove and no testicular reserve to recruit.
      gate: { secondaryOnly: true },
      levelRisks: [{ min: 1, text: 'Lower estradiol is the mechanism and the problem: joint aches, low libido and, over a year, spine bone loss (Burnett-Bowie 2009).' }],
    },
  },
  {
    id: 'tamoxifen', name: 'Tamoxifen (off-label in men)', category: 'prescription', rx: true, evidence: 'moderate',
    status: 'Prescription only; approved for breast cancer, used off-label in men for gynecomastia and infertility. WADA prohibited (S4.2).',
    summary: 'The only PLACEBO-CONTROLLED testosterone rise in men whose levels were already normal: 490 → 790 ng/dL (+61%) against 530 → 560 on placebo, in eugonadal infertile men. Clomiphene does more in the same population, but without a placebo arm. Nobody has ever measured muscle on tamoxifen in men, so the lean number here is an extrapolation whose range starts at zero.',
    mechanism: 'A selective estrogen receptor modulator, like clomiphene: blocks estrogen feedback at the hypothalamus and pituitary.',
    effects: [
      'Krause 1992 (randomized, placebo-controlled, 76 eugonadal infertile men): testosterone 490 → 790 ng/dL (+61%) versus 530 → 560 on placebo. LH did not differ significantly between groups.',
      'A Cochrane review of 10 trials in 738 men found anti-estrogens improved hormone levels but did not improve pregnancy rates (OR 1.26, 95% CI 0.99–1.56).',
      'Body composition: never measured on tamoxifen in men.',
    ],
    risks: [
      'Venous thromboembolism (blood clots) is the serious one, along with rare ocular effects.',
      'Hot flushes, mood changes, nausea.',
      'Using a breast-cancer drug to raise hormones in a healthy man has no outcome data behind it.',
    ],
    typicalUse: 'Off-label, physician-prescribed and monitored, usually for gynecomastia or male infertility.',
    sources: [
      'Krause W, Holland-Moritz H, Schramm P. Treatment of idiopathic oligozoospermia with tamoxifen: a randomized controlled study. Int J Androl. 1992;15(1):14-18.',
      'Vandekerckhove P, et al. Clomiphene or tamoxifen for idiopathic oligo/asthenospermia. Cochrane Database Syst Rev. 2000;(2):CD000151.',
      'Kadioglu TC, et al. Treatment of idiopathic and postvaricocelectomy oligozoospermia with oral tamoxifen citrate. Int Urol Nephrol. 2009;41(4):773-776.',
      WADA,
    ],
    model: {
      kind: 'tEndogenous',
      dose: { unit: '% of the studied regimen', default: 100, label: 'as studied (prescriber-set dose)', studied: [0, 100] },
      response: [[0, 0], [100, 1]],
      // Was a flat `tPct: 60` at every baseline. Krause 1992 measured it at ONE baseline (490 → 790 ng/dL, a
      // +300 ng/dL absolute rise, placebo arm 530 → 560). Forge now carries that as a constant +300 ng/dL —
      // the same constant-absolute shape the clomiphene and enclomiphene data support — which makes the
      // percentage shrink as the baseline rises instead of staying flat. Everything away from 490 ng/dL is an
      // extrapolation from that single anchor; tamoxifen has no dose ladder and no hypogonadal absolute figures.
      tPctByBaseline: [[150, 200], [250, 120], [350, 86], [450, 67], [490, 61], [550, 55], [650, 46], [800, 37], [1000, 28]],
      rampWeeks: 6, maxLevel: 790,
      axis: 'serm', ceilingNg: 790, tCI: [0.5, 1.5], gate: { secondaryOnly: true },
      e2Pct: 60, e2ActionPct: 0, shbgDelta: 0,
      e2Note: 'Serum estradiol rises as on any SERM, but tamoxifen also blocks the receptor in several tissues, so whether estrogen action goes up or down in fat is unknown. Forge models no fat effect either way.',
      shbgNote: 'SHBG did not change significantly in Krause 1992.',
      // §22.8. The honest answer here is 'unknown', and Forge says so rather than borrowing the oncology label.
      tolerability: {
        grade: 'unknown', comparedWith: 'nothing — no trial has tabulated adverse events for tamoxifen used this way in men',
        evidence: 'none',
        headline: 'No adverse-event data for this use. The known risks come from the breast-cancer label, in women, at doses and durations that are not comparable.',
        discontinuation: null,
        events: [
          { label: 'Venous thromboembolism', pct: null, n: null, of: null, arm: 'the established serious risk of tamoxifen, from the oncology literature in women', p: 'not quantified in any trial of men using it to raise testosterone; this is the risk that distinguishes tamoxifen from clomiphene on paper', source: 'drug label; no male off-label data' },
          { label: 'Hot flushes, mood changes, nausea, ocular effects', pct: null, n: null, of: null, arm: 'reported in the oncology population', p: 'rates in a eugonadal man taking 20–30 mg for 6 months are unknown', source: 'drug label' },
        ],
        note: 'Krause 1992 is the trial Forge\'s testosterone curve rests on and it reported hormones, not an adverse-event table. Grading this "good" because nothing bad was reported would be reading silence as safety, which is the error this field exists to prevent. The VTE risk is real enough to be on every tamoxifen label, and nobody has measured what it is in this population.',
        sources: ['Krause W, Holland-Moritz H, Schramm P. Int J Androl. 1992;15(1):14-18. doi:10.1111/j.1365-2605.1992.tb01110.x'],
      },
      bodyComp: 'extrapolated', bcMaxLevel: 790,
      bcNote: 'EXTRAPOLATED: nobody has ever measured body composition on tamoxifen in men. Krause 1992 is the only PLACEBO-CONTROLLED testosterone rise in men who were not hypogonadal (490 → 790 ng/dL vs 530 → 560 on placebo, 30 mg/day, 6 months, n=39 vs 37), so Forge runs it through the Bhasin curve and stops at 790. The lower end of the range is zero, because zero is what has actually been measured — and because that curve was built on testosterone given from outside, not made by your own testes.',
      monitor: ['Total testosterone and estradiol', 'Any leg swelling, chest pain or breathlessness: venous thromboembolism is the serious risk', 'Eye symptoms', 'Liver panel'],
      fertility: 'Used for male infertility; hormones improve but a Cochrane review found no improvement in pregnancy rates (OR 1.26, 95% CI 0.99–1.56).',
      timeCourse: 'Krause 1992 ran 6 months.',
      wada: 'WADA prohibited at all times, S4.2.',
      suits: 'Gynecomastia or male infertility, under a prescriber. It is the only item here with a randomized testosterone rise in eugonadal men.',
      notSuits: 'Using a breast-cancer drug for body composition in a healthy man, on an extrapolation and a clot risk, is a bad trade. Absolutely not with any history of thrombosis.',
    },
  },
  {
    id: 'cabergoline', name: 'Cabergoline (only for high prolactin)', category: 'prescription', rx: true, evidence: 'moderate',
    status: 'Prescription only; FDA approved for hyperprolactinemia. Irrelevant unless your prolactin is actually high.',
    summary: 'If high prolactin is what is suppressing your testosterone, treating it fixes the cause. Testosterone normalized in about 61% of men with a prolactinoma within 6 months. If your prolactin is normal, this does nothing and Forge models nothing.',
    mechanism: 'A dopamine agonist that suppresses prolactin secretion. High prolactin blocks GnRH pulses, so lowering it lets LH and testosterone recover.',
    effects: [
      'Colao 2004 (prospective, 51 men with prolactinoma, 24 months): prolactin normalized in 76–80% and tumour size shrank about 73%; testosterone normalized in 61% by 6 months, and 20 of 51 men still needed hormone replacement.',
      'Sperm volume and count normalized in everyone whose testosterone normalized.',
      'Forge applies an effect only if you enter a prolactin above 20 ng/mL together with a low testosterone.',
    ],
    risks: ['Nausea, dizziness, low blood pressure on standing; valvular heart effects at the much higher doses used in Parkinson\'s disease.', 'Side effects occurred in about 4.5% of men in the trial.'],
    typicalUse: 'Prescribed and monitored by an endocrinologist for confirmed hyperprolactinemia, after looking for the cause (medications, pituitary imaging).',
    sources: [
      'Colao A, et al. Prolactinomas in men: effect of 2 years of normalization of serum prolactin on bone density and other clinical features. J Clin Endocrinol Metab. 2004;89(4):1704-1711.',
    ],
    model: {
      kind: 'tEndogenous',
      dose: { unit: '% of the studied regimen', default: 100, label: 'as studied (prescriber-set dose)', studied: [0, 100] },
      response: [[0, 0], [100, 1]],
      // This one taper to ~zero is KEPT, and it is the one place where the shape is right rather than inferred:
      // cabergoline is cause-correction, not axis-pushing. It removes prolactin's suppression of GnRH, so it can
      // only give back what the prolactin took. A man whose testosterone is already normal has lost nothing to
      // give back, however high his prolactin is. The cliff at exactly 450 was still arbitrary, so the curve now
      // tapers smoothly to zero at 700 instead of stopping dead, and `lowTOnly`/`noEffectAbove` are gone — the
      // curve itself does that job, and the `highProlactin` gate (which IS what Colao 2004 shows) still stands.
      tPctByBaseline: [[150, 180], [250, 100], [350, 45], [450, 20], [550, 8], [700, 0]],
      rampWeeks: 12, maxLevel: 900,
      // Cause-correction, not an LH drug: it removes the thing suppressing GnRH, so it raises the set-point and
      // therefore shrinks what a SERM or hCG could still add on top.
      axis: 'dopamine', ceilingNg: 900, tCI: [0.5, 1.5],
      e2Pct: 0, e2ActionPct: 0, shbgDelta: 0,
      // §22.8. The only item in the §22 group that is FDA-approved for the thing it is being used for, which is
      // why it has a real label behind it rather than an off-label inference.
      tolerability: {
        grade: 'good', comparedWith: 'its own approved label and the 51-man prospective series; no head-to-head against anything here',
        evidence: 'observational',
        headline: 'Side effects in about 4.5% of men over 2 years, and it is the only item in this group approved for the condition it is treating.',
        discontinuation: null,
        events: [
          // Reported as "about 4.5%" with no numerator given, and 4.5% of 51 is 2.3 men, so this is not a clean
          // fraction of the cohort and Forge will not invent one. Narrative row, exactly as published.
          { label: 'Any side effect', pct: null, n: null, of: 51, arm: 'reported as about 4.5% over 24 months of treatment for prolactinoma; the paper does not give the numerator, so the underlying count is unknown', source: 'Colao 2004' },
          { label: 'Nausea, dizziness, postural hypotension', pct: null, n: null, of: null, arm: 'the common label effects, usually at the start of treatment', source: 'drug label' },
          { label: 'Cardiac valve disease', pct: null, n: null, of: null, arm: 'a known risk of ergot dopamine agonists at the much higher doses used in Parkinson\'s disease; not seen at hyperprolactinaemia doses', p: 'the reason an echocardiogram appears on the monitoring list only for the high-dose use', source: 'drug label' },
        ],
        note: 'This grade only means anything for a man who actually has a high prolactin. For everyone else the item is modeled at zero, so its tolerability is not a trade-off he is making.',
        sources: ['Colao A, et al. J Clin Endocrinol Metab. 2004;89(4):1704-1711.'],
      },
      bodyComp: 'extrapolated', bcMaxLevel: 700,
      bcNote: 'EXTRAPOLATED: Colao 2004 measured bone density, not body composition. Forge runs the restored testosterone through the Bhasin curve and stops at 700 ng/dL, roughly the normal range the responders reached. 39% of men did NOT normalize and still needed replacement.',
      monitor: ['Prolactin (repeat it before acting — one high value is not a diagnosis)', 'Total testosterone', 'Pituitary MRI if prolactin is confirmed high', 'Echocardiogram only at the much higher Parkinson\'s doses'],
      fertility: 'Sperm volume and count normalized in everyone whose testosterone normalized (Colao 2004).',
      timeCourse: 'Testosterone normalized in ~61% by 6 months.',
      wada: 'Not prohibited.',
      suits: 'A confirmed high prolactin with low testosterone. This treats the cause rather than pushing the axis.',
      notSuits: 'A normal prolactin — then there is nothing here to treat and Forge models zero. A normal testosterone with a high prolactin also gets little or nothing: this gives back what prolactin took, and if nothing was taken there is nothing to give.',
      gate: { highProlactin: true, secondaryOnly: true },
    },
  },
  {
    id: 'nasal_t', name: 'Short-acting nasal testosterone (Natesto)', category: 'prescription', rx: true, exogenousT: true, evidence: 'weak',
    status: 'Prescription only (FDA approved as testosterone replacement). This IS exogenous testosterone — it suppresses your own axis, just less than other routes. Using it specifically to protect fertility is off-label. WADA prohibited.',
    summary: 'Testosterone from outside, but dosed so briefly that LH and FSH mostly survive. In a single-arm study, 91% of men reached a normal level while FSH stayed normal in 82% and sperm counts held up — the usual trade-off between testosterone therapy and fertility, partly avoided. It is still exogenous testosterone: suppression is reduced, not eliminated.',
    mechanism: 'Three short nasal doses a day produce brief testosterone peaks instead of a steady level, which seems to leave the pituitary enough unsuppressed time to keep signalling the testes.',
    effects: [
      'Ramasamy 2020 (open-label, single-arm, 6 months, 33–44 evaluable men): 90.9% reached total T above 300 ng/dL; LH stayed normal in 72.7% and FSH in 81.8%; sperm counts above 5 million were maintained in 93.9% at 6 months.',
      'No control group, significant dropout, and no data beyond 6 months.',
      'Body composition was not measured. If you use it, enter your measured level under "total T on therapy" and Forge will model it with the testosterone curve.',
    ],
    risks: ['Nasal irritation, runny nose, headache.', 'It is still exogenous testosterone: suppression is reduced, not eliminated, and the fertility claim rests on one uncontrolled study.', 'Three-times-daily dosing is easy to miss.'],
    typicalUse: 'Prescribed and monitored like any testosterone therapy, sometimes chosen by men who want to protect fertility.',
    sources: [
      'Ramasamy R, et al. Testosterone nasal gel (Natesto) maintains semen parameters and gonadotropin levels in hypogonadal men: a single-center, open-label study. J Urol. 2020;204(3):557-563.',
      'Bhasin S, et al. Testosterone therapy in men with hypogonadism: an Endocrine Society clinical practice guideline. J Clin Endocrinol Metab. 2018;103(5):1715-1744.',
      WADA,
    ],
    model: { kind: 'exogenousT', axis: 'exogenous', suppresses: true, axisPreservedPct: 75,
      trialLevel: 500, trialLevelNote: 'Ramasamy 2020 reported the proportion above 300 ng/dL (90.9%), not a group mean. 500 ng/dL is an ASSUMPTION standing in for "mid-normal", used only when you enter no lab.',
      bodyComp: 'extrapolated', bcMaxLevel: 1100,
      bcNote: 'EXTRAPOLATED: body composition was not measured. Enter your measured level and the Bhasin testosterone curve handles it like any other exogenous testosterone.',
      monitor: ['Total testosterone (timing matters — it peaks and falls within the hour)', 'LH and FSH', 'Semen analysis if fertility matters', 'Hematocrit, PSA'],
      fertility: 'The distinguishing claim: LH stayed normal in 72.7% and FSH in 81.8%, and 93.9% kept sperm above 5 million at 6 months (Ramasamy 2020) — but that is one uncontrolled single-arm study with heavy attrition and nothing past 6 months.',
      timeCourse: 'Three doses a day; peaks within ~1 h.',
      wada: 'WADA prohibited at all times, S1 (anabolic androgenic steroids).',
      suits: 'A man who needs testosterone replacement and wants to keep sperm production, who will not miss three doses a day.',
      notSuits: 'Anyone relying on the fertility claim as if it were proven, and anyone who wants to raise their OWN production — this replaces it.',
      note: 'Exogenous testosterone: enter your measured on-therapy level and add Testosterone to your stack; the testosterone curve handles it.' },
  },
  {
    id: 'oral_tu', name: 'Oral testosterone undecanoate (Jatenzo, Tlando, Kyzatrex)', category: 'prescription', rx: true, exogenousT: true, evidence: 'moderate',
    status: 'Prescription only (Schedule III), FDA approved as testosterone replacement. This IS exogenous testosterone: it suppresses your own production and sperm count like any other route. Boxed warning for blood-pressure increases. WADA prohibited.',
    summary: 'Testosterone in a capsule. Three approved products get about 87–88% of hypogonadal men into the normal range without injections or gel transfer — but they are replacement, not restoration: your own axis shuts down, fertility suffers, and all three raise blood pressure. No trial has measured body composition on any of them.',
    mechanism: 'Testosterone undecanoate in a lipid vehicle is absorbed through the intestinal lymphatics with food, bypassing the first-pass liver metabolism that made old oral testosterone hepatotoxic. Serum levels peak and trough within the day, so dosing is twice daily with meals.',
    effects: [
      'Jatenzo (Swerdloff 2020, phase 3, 166 men vs 56 topical): 87% reached a 24-hour average in the eugonadal range; plasma Cavg 403 ± 128 ng/dL (serum-equivalent ≈489 ± 155), versus 391 ± 140 for topical testosterone.',
      'Jatenzo at 2 years (Honig 2022, 69 men completing 24 months): mean total T 617 ± 427 ng/dL, sexual-function scores improved, no clinically significant liver changes — and HDL fell 9.8 ± 0.9 mg/dL, systolic BP rose 3–6 mmHg.',
      'Tlando (Miner 2024, phase 3, 315 men, baseline 205.7 ± 71.6 ng/dL, 225 mg twice daily): 87.4% within 300–1,140 ng/dL, with no dose titration needed in most.',
      'Tlando blood pressure (White 2021, 138 men, ambulatory monitoring): 24-hour systolic +3.8 mmHg (p<0.001), hematocrit +3.2% and haemoglobin +0.9 g/dL. The men whose hematocrit rose more than 6% had the largest blood-pressure rise (mean +8.3 mmHg).',
      'Kyzatrex (phase 3, 155 men with T ≤281 ng/dL): 88% (95% CI 82–93) reached a 24-hour average of 222–800 ng/dL at day 90; boxed warning for blood pressure.',
      'Body composition was not measured in any of these trials. Forge treats it as exogenous testosterone: enter your measured level and the Bhasin curve applies, labelled an extrapolation.',
    ],
    risks: [
      'Boxed warning: it raises blood pressure, which raises cardiovascular risk. Blood pressure must be controlled before starting and monitored on it.',
      'It suppresses your own testosterone and sperm production like any exogenous testosterone. Not for a man planning fertility soon.',
      'Hematocrit rises (needs regular blood counts); HDL falls.',
      'Must be taken with food twice daily or absorption fails; levels swing within the day, so lab timing matters.',
    ],
    typicalUse: 'Physician-prescribed replacement, taken twice daily with meals and titrated on a timed blood level.',
    sources: [
      'Swerdloff RS, et al. A new oral testosterone undecanoate formulation restores testosterone to normal concentrations in hypogonadal men. J Clin Endocrinol Metab. 2020;105(8):2515-2531. doi:10.1210/clinem/dgaa238',
      'Honig S, et al. Two-year analysis of a new oral testosterone undecanoate (TU) formulation in hypogonadal men: efficacy, impact on psychosexual function, and safety. J Sex Med. 2022;19(12):1750-1758. doi:10.1016/j.jsxm.2022.09.002',
      'Miner M, et al. Safety, efficacy, and pharmacokinetics of oral testosterone undecanoate in males with hypogonadism. Andrology. 2025;13(4):882-893. doi:10.1111/andr.13747',
      'White WB, et al. Effects of a novel oral testosterone undecanoate on ambulatory blood pressure in hypogonadal men. J Cardiovasc Pharmacol Ther. 2021;26(6):630-637. doi:10.1177/10742484211027394',
      'U.S. FDA. KYZATREX (testosterone undecanoate) capsules, prescribing information. Marius Pharmaceuticals; approved July 2022.',
      WADA,
    ],
    model: { kind: 'exogenousT', axis: 'exogenous', suppresses: true, axisPreservedPct: 0,
      trialLevel: 500, trialLevelNote: 'Mid-point of the reported on-treatment means (Jatenzo Cavg ≈489 ng/dL serum-equivalent at 3–4 months, 617 at 2 years). Used only when you enter no lab.',
      bodyComp: 'extrapolated', bcMaxLevel: 1100,
      bcNote: 'EXTRAPOLATED: no oral testosterone undecanoate trial measured body composition. Enter your measured level and the Bhasin curve applies, as for any exogenous testosterone.',
      monitor: ['Blood pressure (boxed warning) before and during', 'Total testosterone, timed per the product label', 'Hematocrit', 'Lipids (HDL falls)', 'PSA'],
      fertility: 'Suppressed, like any exogenous testosterone. If fertility matters, the SERMs, hCG or nasal testosterone exist for that reason.',
      timeCourse: 'Levels are in range within days; the trials ran 3–24 months.',
      wada: 'WADA prohibited at all times, S1.',
      suits: 'A man who needs replacement, has a diagnosis, and wants to avoid needles and gel transfer to family.',
      notSuits: 'Anyone trying to raise their OWN testosterone (this replaces it), anyone with uncontrolled blood pressure, and anyone planning children.',
      note: 'Exogenous testosterone: enter your measured level and add Testosterone to your stack; the testosterone curve handles it.' },
  },
  {
    id: 'pulsatile_gnrh', name: 'Pulsatile GnRH (gonadorelin pump)', category: 'prescription', rx: true, evidence: 'moderate',
    status: 'Specialist use for congenital hypogonadotropic hypogonadism; not a therapy for otherwise healthy men. US availability is unclear (the approved products were discontinued).',
    summary: 'A pump delivering GnRH in pulses can restart the axis in men born without it. It is not a muscle-building option, and in head-to-head data it produces LOWER testosterone than hCG. Continuous rather than pulsed delivery does the opposite and shuts the axis down.',
    mechanism: 'The pituitary only responds to GnRH arriving in pulses. Pulsed delivery restores LH and FSH; steady delivery desensitizes the receptors and suppresses them, which is how prostate-cancer drugs work.',
    effects: [
      'Mao 2017 (202 men with congenital hypogonadotropic hypogonadism): pulsatile GnRH gave testosterone of 239 ng/dL versus 467 on hCG/hMG (p<0.001), but sperm appeared much sooner (median 6 vs 18 months).',
      'Wei 2020 meta-analysis (7 studies, 420 men): larger testicular volume and spermatogenesis about 5 months earlier than with gonadotropins; pregnancy rates not significantly different.',
      'No trial has tested it in men with normal pituitary function, so Forge models no effect.',
    ],
    risks: ['Wearing an infusion pump continuously; allergic and site reactions.', 'Continuous (non-pulsed) dosing suppresses testosterone instead of raising it.'],
    typicalUse: 'Endocrinologist-supervised treatment for congenital hypogonadotropic hypogonadism, usually when fertility is the goal.',
    sources: [
      'Mao JF, et al. Pulsatile gonadotropin-releasing hormone therapy is associated with earlier spermatogenesis compared to combined gonadotropin therapy in patients with congenital hypogonadotropic hypogonadism. Asian J Androl. 2017;19(6):680-685.',
      'Wei C, et al. Pulsatile gonadotropin-releasing hormone therapy versus gonadotropin therapy for congenital hypogonadotropic hypogonadism: a systematic review and meta-analysis. World J Mens Health. 2021;39(4):654-665.',
      'Pitteloud N, Dwyer A. Hormonal control of spermatogenesis in men: therapeutic aspects in hypogonadotropic hypogonadism. Ann Endocrinol. 2014;75(2):98-100.',
    ],
    model: { kind: 'none', note: 'Only studied in congenital hypogonadotropic hypogonadism, where it gives lower testosterone than hCG.' },
  },
  {
    id: 'semaglutide', name: 'Semaglutide (Wegovy / Ozempic)', category: 'prescription', rx: true, evidence: 'strong',
    status: 'Prescription only (FDA approved as Wegovy for obesity, Ozempic for type 2 diabetes). Compounded versions are not FDA approved.',
    summary: 'Strong evidence for fat loss, mainly because you eat much less. In STEP-1, the 2.4 mg dose meant ~15% body-weight loss at 68 weeks (vs 2.4% on placebo). Without lifting, about 40% of the weight lost was lean mass. It works against a bulk.',
    mechanism: 'A GLP-1 receptor agonist: slows stomach emptying and acts on brain appetite centers. In a lab study, people ate ~24% less at a buffet.',
    effects: [
      'Dose → effect from the phase-2 dose-finding trial (O\'Neil 2018) and STEP-1; the full dose is reached after ~16 weeks of escalation.',
      'Forge applies it as lower intake (only when you haven\'t set calories yourself), calibrated so a ~165 lb man levels off near the trial\'s net loss.',
      'Lean share of loss in trials (no structured lifting) was ~39%. Forge applies your training and protein protection instead.',
    ],
    risks: [
      'Nausea, vomiting, constipation (common, dose-related); gallbladder disease; rare pancreatitis.',
      'Boxed warning: thyroid C-cell tumors in rodents; contraindicated with a personal or family history of medullary thyroid cancer or MEN2.',
      'Most weight returns after stopping: STEP-1 extension participants regained about two-thirds within a year.',
      'Eating very little makes it hard to hit protein. Lift and prioritize protein to keep lean mass.',
    ],
    typicalUse: 'Weekly injection for obesity (BMI ≥30, or ≥27 with a weight-related condition) or type 2 diabetes; dose escalated by the prescriber',
    sources: [
      'Wilding JPH, et al. Once-weekly semaglutide in adults with overweight or obesity (STEP 1). N Engl J Med. 2021;384(11):989-1002.',
      'O\'Neil PM, et al. Efficacy and safety of semaglutide compared with liraglutide and placebo for weight loss in patients with obesity: a randomised, double-blind, placebo and active controlled, dose-ranging, phase 2 trial. Lancet. 2018;392(10148):637-649.',
      'Blundell J, et al. Effects of once-weekly semaglutide on appetite, energy intake, control of eating, food preference and body weight in subjects with obesity. Diabetes Obes Metab. 2017;19(9):1242-1251.',
      'Wilding JPH, et al. Weight regain and cardiometabolic effects after withdrawal of semaglutide: the STEP 1 trial extension. Diabetes Obes Metab. 2022;24(8):1553-1564.',
      'Neeland IJ, Linge J, Birkenfeld AL. Changes in lean body mass with glucagon-like peptide-1-based therapies and mitigation strategies. Diabetes Obes Metab. 2024;26 Suppl 4:16-27.',
    ],
    model: {
      kind: 'generic', glp1: true,
      dose: { unit: 'mg/week', default: 2.4, label: 'studied dose (STEP-1)', studied: [0.25, 2.4] },
      response: [[0, 0], [0.35, 0.3], [0.7, 0.5], [1.4, 0.74], [2.4, 1]],
      rampByDose: [[0.25, 1], [0.5, 4], [1, 8], [1.7, 12], [2.4, 16]],
      intakePctOfMaint: -0.163, netLossPct: 12.5, trialLossPct: 14.9, trialWeeks: 68, leanShareOfLoss: 0.39,
      intakeDelta: -400, rampWeeks: 16,
      levelRisks: [{ min: 1.7, text: 'GI side effects (nausea, vomiting, diarrhea) are most common at the higher maintenance doses.' }],
    },
  },
  {
    id: 'tirzepatide', name: 'Tirzepatide (Zepbound / Mounjaro)', category: 'prescription', rx: true, evidence: 'strong',
    status: 'Prescription only (FDA approved as Zepbound for obesity, Mounjaro for type 2 diabetes). Compounded versions are not FDA approved.',
    summary: 'The strongest approved weight-loss drug. In SURMOUNT-1, people lost ~15%, ~19.5% and ~21% of body weight at 5, 10 and 15 mg over 72 weeks. In the body-composition substudy, about a quarter of the loss was lean. It works against a bulk.',
    mechanism: 'Dual GIP and GLP-1 receptor agonist: strong appetite and intake reduction.',
    effects: [
      'Dose-driven: SURMOUNT-1 5/10/15 mg vs placebo (−3.1%). Escalation is 2.5 mg every 4 weeks.',
      'Applied as lower intake only when you haven\'t set calories yourself.',
      'Lean share of loss ~25% in the DXA substudy, without structured lifting.',
    ],
    risks: [
      'Nausea, diarrhea, vomiting, constipation (dose-related); gallbladder disease; rare pancreatitis.',
      'Same thyroid C-cell boxed warning as semaglutide.',
      'Weight regain after stopping is the norm (SURMOUNT-4).',
      'Low intake makes protein hard. Lift and prioritize protein.',
    ],
    typicalUse: 'Weekly injection for obesity or type 2 diabetes; dose escalated by the prescriber in 2.5 mg steps',
    sources: [
      'Jastreboff AM, et al. Tirzepatide once weekly for the treatment of obesity (SURMOUNT-1). N Engl J Med. 2022;387(3):205-216.',
      'Aronne LJ, et al. Continued treatment with tirzepatide for maintenance of weight reduction in adults with obesity: the SURMOUNT-4 randomized clinical trial. JAMA. 2024;331(1):38-48.',
      'Neeland IJ, Linge J, Birkenfeld AL. Changes in lean body mass with glucagon-like peptide-1-based therapies and mitigation strategies. Diabetes Obes Metab. 2024;26 Suppl 4:16-27.',
    ],
    model: {
      kind: 'generic', glp1: true,
      dose: { unit: 'mg/week', default: 15, label: 'highest studied dose (SURMOUNT-1)', studied: [2.5, 15] },
      response: [[0, 0], [5, 0.67], [10, 0.92], [15, 1]],
      rampByDose: [[2.5, 1], [5, 4], [10, 12], [15, 20]],
      intakePctOfMaint: -0.232, netLossPct: 17.8, trialLossPct: 20.9, trialWeeks: 72, leanShareOfLoss: 0.25,
      intakeDelta: -575, rampWeeks: 20,
    },
  },
  {
    id: 'adderall', name: 'Adderall / stimulant ADHD meds', category: 'prescription', rx: true, evidence: 'strong',
    status: 'Prescription only (Schedule II), for diagnosed ADHD. WADA prohibited in competition without a therapeutic use exemption.',
    summary: 'Already part of your life. Lower appetite is one of the most common side effects, and it\'s the main reason eating enough for a lean bulk feels hard. Forge models it as lower intake only when you haven\'t set calories yourself, and flags under-eating.',
    mechanism: 'Raises dopamine and norepinephrine; suppresses appetite for the hours it\'s active, with an evening rebound as it wears off.',
    effects: [
      'Modeled appetite effect (dose-driven): about −150 kcal/day at 20 mg, −200 at 40 mg, −250 at 60 mg as a steady average (partial tolerance develops for many people).',
      'If you set calories in Nutrition, Forge assumes you hit them; the drug just makes that harder.',
      'See Nutrition → "Eating on Adderall" for the meal-timing playbook.',
    ],
    risks: [
      'Raises heart rate and blood pressure; this adds up with caffeine and pre-workouts.',
      'Late doses delay sleep, and short sleep costs muscle (see Sleep).',
      'Under-eating protein on medication days is the biggest physique risk.',
    ],
    typicalUse: 'As prescribed for ADHD',
    sources: [
      'Adderall XR (mixed amphetamine salts) prescribing information. U.S. Food and Drug Administration label.',
      'Cortese S, et al. Comparative efficacy and tolerability of medications for attention-deficit hyperactivity disorder in children, adolescents, and adults: a systematic review and network meta-analysis. Lancet Psychiatry. 2018;5(9):727-738.',
      WADA,
    ],
    model: {
      kind: 'generic',
      dose: { unit: 'mg/day', default: 20, label: 'typical adult dose (label starting dose)', studied: [5, 60] },
      response: [[0, 0], [10, 0.6], [20, 1], [40, 1.33], [60, 1.67]],
      intakeDelta: -150, rampWeeks: 0,
      levelRisks: [{ min: 41, text: 'Higher doses: more insomnia, appetite loss, heart rate and blood pressure effects.' }],
    },
  },
  {
    id: 'hgh', name: 'Growth hormone (HGH / somatropin)', category: 'prescription', rx: true, evidence: 'moderate',
    status: 'Prescription only for diagnosed GH deficiency and a few specific conditions; distributing it for anti-aging or bodybuilding is illegal in the US. WADA prohibited.',
    summary: 'In healthy adults, GH increases "lean mass" by ~2 kg, but that\'s mostly retained water. Strength doesn\'t improve. Fat mass drops a little. Side effects (swelling, joint pain, carpal tunnel, higher blood sugar) are common.',
    mechanism: 'Raises IGF-1, promotes fat breakdown and causes sodium and water retention in tissues.',
    effects: [
      'Healthy young adults (Liu 2008): lean body mass +2.1 kg, no strength gain; much of it fluid.',
      'Healthy older adults (Liu 2007): lean +2.1 kg, fat −2.1 kg over ~6 months.',
      'Forge: water up to +4 lb (not counted as muscle), fat about −0.17 lb/week for the ~26 studied weeks, then no further change.',
    ],
    risks: ['Fluid retention and swelling, joint pain, carpal tunnel syndrome, gynecomastia.', 'Insulin resistance and higher blood sugar (watch HbA1c).', 'Counterfeit product is common outside prescriptions.'],
    typicalUse: 'Only for diagnosed adult GH deficiency, prescribed and monitored by an endocrinologist (dose titrated to IGF-1)',
    sources: [
      'Liu H, et al. Systematic review: the effects of growth hormone on athletic performance. Ann Intern Med. 2008;148(10):747-758.',
      'Liu H, et al. Systematic review: the safety and efficacy of growth hormone in the healthy elderly. Ann Intern Med. 2007;146(2):104-115.',
      'Molitch ME, et al. Evaluation and treatment of adult growth hormone deficiency: an Endocrine Society clinical practice guideline. J Clin Endocrinol Metab. 2011;96(6):1587-1609.',
      'Perls TT, Reisman NR, Olshansky SJ. Provision or distribution of growth hormone for "antiaging": clinical and legal issues. JAMA. 2005;294(16):2086-2090.',
    ],
    model: {
      kind: 'generic',
      dose: { unit: 'mg/day', default: 1, label: 'within the studied range (healthy-adult trials)', studied: [0.2, 3] },
      response: [[0, 0], [0.3, 0.4], [1, 1]],
      waterLb: 4.0, fatDirectLbPerWeek: -0.17, rampWeeks: 3, waterRampWeeks: 2, taperAfterWeeks: 26, taperTauWeeks: 0,
      levelRisks: [{ min: 1, text: 'At and above ~1 mg/day in healthy adults: swelling, joint pain and carpal tunnel are frequent (Liu 2007/2008), and higher doses added side effects, not benefit.' }],
    },
  },

  // ============================================================ PEPTIDES & RESEARCH COMPOUNDS
  {
    id: 'tesamorelin', name: 'Tesamorelin (Egrifta)', category: 'peptide', rx: true, evidence: 'moderate',
    status: 'Prescription only (FDA approved as Egrifta solely for HIV-associated abdominal fat). WADA prohibited.',
    summary: 'A GHRH analog that cut visceral (deep belly) fat by ~15% over 26 weeks in people with HIV lipodystrophy. Evidence in healthy lifters is lacking; the modeled effect is tiny.',
    mechanism: 'Stimulates the pituitary to release more of your own GH, raising IGF-1.',
    effects: ['Visceral fat about −15% over 26 weeks (HIV lipodystrophy trials).', 'Forge: fat about −0.03 lb/week for the 26 studied weeks.'],
    risks: ['Joint pain, swelling, injection-site reactions; higher blood sugar.'],
    typicalUse: 'Only for HIV-associated abdominal fat accumulation, as prescribed',
    sources: [
      'Falutz J, et al. Metabolic effects of a growth hormone-releasing factor in patients with HIV. N Engl J Med. 2007;357(23):2359-2370.',
      'Stanley TL, et al. Effect of tesamorelin on visceral fat and liver fat in HIV-infected patients with abdominal fat accumulation: a randomized clinical trial. JAMA. 2014;312(4):380-389.',
    ],
    model: {
      kind: 'generic',
      dose: { unit: 'mg/day', default: 2, label: 'studied dose', studied: [1, 2] },
      response: [[0, 0], [1, 0.6], [2, 1]],
      fatDirectLbPerWeek: -0.03, rampWeeks: 4, taperAfterWeeks: 26, taperTauWeeks: 0,
    },
  },
  {
    id: 'kisspeptin', name: 'Kisspeptin and kisspeptin analogs (MVT-602, TAK-448)', category: 'peptide', rx: true, evidence: 'refuted',
    // Status verified 2026-10-20 against the FDA and WADA primary documents (§22.8). Both halves confirmed, and
    // the WADA hedge removed: kisspeptin is now named outright on the list rather than merely implied by class.
    status: 'Investigational research peptides; none is approved anywhere. Kisspeptin-10 is in Category 2 of FDA\'s 503A bulk-substances list — substances that raise significant safety risks, which Category 1\'s enforcement discretion does not cover (list updated 14 May 2026). WADA prohibited at all times in males: "kisspeptin and its agonist analogues" is named explicitly under S2.2.1, testosterone-stimulating peptides (Prohibited List 2026).',
    summary: 'The most upstream switch in the whole axis, and the human trials are a cautionary tale. A single infusion raises testosterone 15–45% for a few hours, but when the long-acting analogs were given continuously, testosterone fell BELOW castrate levels within a week. There is no way to use this to raise testosterone long-term.',
    mechanism: 'Kisspeptin neurons drive the GnRH pulse generator. Pulses stimulate it; continuous exposure desensitizes the receptor, which is exactly how the analogs were being developed as prostate-cancer drugs.',
    effects: [
      'Dhillo 2005 (6 healthy men, 90-minute IV infusion): mean testosterone 718 vs 626 ng/dL on placebo, about +15%. Half-life 28 minutes.',
      'George 2011 (healthy men, 22.5-hour infusion, n=4): 479 → 692 ng/dL (+45%), with tachyphylaxis already visible at the higher bolus dose.',
      'George 2013 (5 men with type 2 diabetes and low testosterone, 11-hour infusion): 245 → 329 ng/dL (+34%).',
      'MacLean 2014 (TAK-448, phase 1): a single dose raised T only 1.3–2 fold, and 14 days of continuous infusion put men below castrate levels by day 8.',
      'Scott 2013 (TAK-448, phase 1, 60 + 30 healthy men): at the top continuous dose, testosterone fell below 50 ng/dL in 4 of 5 men by day 7.',
      'MVT-602 has published human data only in women; no male testosterone data exist. No chronic, muscle or body-composition data for any of these.',
    ],
    risks: [
      'Continuous dosing suppresses testosterone rather than raising it — the opposite of the intent.',
      'IV infusions only; no practical dosing route exists for the native peptides.',
      'Unregulated research-chemical products: contents, purity and sterility are not verified.',
    ],
    typicalUse: null,
    sources: [
      'Dhillo WS, et al. Kisspeptin-54 stimulates the hypothalamic-pituitary-gonadal axis in human males. J Clin Endocrinol Metab. 2005;90(12):6609-6615.',
      'George JT, et al. Kisspeptin-10 is a potent stimulator of LH and increases pulse frequency in men. J Clin Endocrinol Metab. 2011;96(8):E1228-E1236.',
      'George JT, et al. Kisspeptin-10 stimulation of gonadotrophin secretion in women and men with type 2 diabetes. Clin Endocrinol. 2013;79(1):100-104.',
      'MacLean DB, et al. Sustained exposure to the investigational kisspeptin analog TAK-448 down-regulates testosterone into the castration range in healthy males and in patients with prostate cancer. J Clin Endocrinol Metab. 2014;99(8):E1445-E1453.',
      'Scott G, et al. Pharmacokinetics, pharmacodynamics, safety and tolerability of TAK-448, a novel kisspeptin analogue, in healthy males. Br J Clin Pharmacol. 2013;75(2):381-391.',
      'U.S. FDA. Bulk drug substances that raise significant safety risks (Category 2), updated May 2026.',
    ],
    model: { kind: 'none', note: 'Acute infusions only; continuous dosing lowers testosterone below castrate levels.' },
  },
  {
    id: 'leydig_regen', name: 'Leydig stem-cell and gene-therapy research', category: 'peptide', evidence: 'preclinical',
    status: 'Laboratory and animal research only. Nothing is available to patients, and no human trial was verifiable.',
    summary: 'The long-term dream: repair or replace the cells that make testosterone, instead of supplementing it. In 2023 gene-edited stem Leydig cells restored testosterone, puberty and fertility in mice with a genetic receptor defect. In humans, nothing.',
    mechanism: 'Stem Leydig cells, mesenchymal stem cells or iPSC-derived Leydig-like cells are transplanted into the testis to restore steroid production, with gene editing where the defect is genetic.',
    effects: [
      'Xia 2023 (mice with an Lhcgr nonsense mutation): prime-edited stem Leydig cells regenerated Leydig cells, recovered testosterone, restarted sexual development and produced fertile offspring.',
      'Curley 2019: human fat-derived pericytes switched on steroidogenic genes in a dish but did not become Leydig cells in rats, and were undetectable a month later.',
      'No human serum-testosterone data exist. Forge models nothing.',
    ],
    risks: ['Entirely unproven in humans; anything sold on this basis today is a scam.'],
    typicalUse: null,
    sources: [
      'Xia K, et al. Restorative functions of autologous stem Leydig cell transplantation with prime editing in a mouse model of hypogonadism. Adv Sci. 2023;10(29):e2300993.',
      'Curley M, et al. Human adipose-derived pericytes display steroidogenic lineage potential in vitro but do not generate Leydig cells in vivo. Sci Rep. 2019;9:15037.',
      'Zhu WB, et al. Stem cell-based therapies for testicular aging and Leydig cell dysfunction. Reprod Biol Endocrinol. 2025;23:147.',
    ],
    model: { kind: 'none', note: 'Animal and cell research only.' },
  },
  {
    id: 'bpc157', name: 'BPC-157', category: 'peptide', evidence: 'none',
    status: 'Not FDA approved; sold as a research chemical. CORRECTED 2026-10-20: it is NOT on FDA\'s Category 2 "significant safety risks" list — its compounding nomination was withdrawn, and FDA\'s safety-risks page lists it among withdrawn nominations with an immunogenicity concern, saying it "lacks sufficient information to know whether the drug would cause harm". WADA prohibited.',
    summary: 'Popular for "healing" injuries, but every positive result comes from rats or anecdotes. There are no controlled human studies on healing, muscle or fat. Forge projects no effect.',
    mechanism: 'Proposed to promote blood-vessel growth and tendon healing in animal models. Unknown in humans.',
    effects: ['No human body-composition data, so no projected effect.'],
    risks: ['Unregulated: purity, dose and sterility of research-chemical vials aren\'t verified.', 'Injection risks (infection); unknown long-term effects, including theoretical concerns with angiogenesis and cancer.'],
    typicalUse: null,
    sources: [
      'Gwyer D, Wragg NM, Wilson SL. Gastric pentadecapeptide body protection compound BPC 157 and its role in accelerating musculoskeletal soft tissue healing. Cell Tissue Res. 2019;377(2):153-159.',
      'Seiwerth S, et al. BPC 157 and standard angiogenic growth factors. Gastrointestinal tract healing, lessons from tendon, ligament, muscle and bone healing. Curr Pharm Des. 2018;24(18):1972-1989.',
      FDA_WITHDRAWN, WADA,
    ],
    model: { kind: 'none', note: 'No human evidence.' },
  },
  {
    id: 'tb500', name: 'TB-500 (thymosin β4 fragment)', category: 'peptide', evidence: 'none',
    status: 'Not FDA approved; sold as a research chemical; WADA prohibited.',
    summary: 'Marketed for recovery and healing based on animal and cell research on thymosin β4. There are no human trials on muscle or fat. Forge projects no effect.',
    mechanism: 'Thymosin β4 regulates actin and cell migration in wound healing (lab and animal data).',
    effects: ['No human body-composition data, so no projected effect.'],
    risks: ['Unregulated: contents and purity aren\'t verified.', 'Unknown long-term safety in humans.'],
    typicalUse: null,
    sources: [
      'Goldstein AL, Hannappel E, Sosne G, Kleinman HK. Thymosin β4: a multi-functional regenerative peptide. Basic properties and clinical applications. Expert Opin Biol Ther. 2012;12(1):37-51.',
      WADA,
    ],
    model: { kind: 'none', note: 'No human evidence.' },
  },
  {
    id: 'ipamorelin_cjc', name: 'Ipamorelin / CJC-1295', category: 'peptide', evidence: 'none',
    status: 'Not FDA approved; sold as research chemicals. Ipamorelin acetate is in Category 2 of FDA\'s 503B bulk-substances list (substances that raise significant safety risks, entry dated 29 September 2023), so outsourcing facilities may not compound from it. WADA prohibited.',
    summary: 'These raise your own GH and IGF-1 (CJC-1295 for days per injection), but there are no good human studies showing more muscle or less fat. Even real GH mostly adds water in healthy adults. Forge projects no effect.',
    mechanism: 'Ipamorelin is a ghrelin-receptor GH secretagogue; CJC-1295 is a long-acting GHRH analog.',
    effects: ['CJC-1295 raised GH 2–10× and IGF-1 1.5–3× in healthy adults (Teichman 2006); body composition was not shown to change.', 'No projected effect.'],
    risks: ['Unregulated vials (purity, dose, sterility).', 'Flushing, headache, injection-site reactions, water retention and higher blood sugar (GH-axis effects).', 'CJC-1295 never completed clinical development, so long-term safety is unknown.'],
    typicalUse: null,
    sources: [
      'Teichman SL, et al. Prolonged stimulation of growth hormone (GH) and insulin-like growth factor I secretion by CJC-1295, a long-acting analog of GH-releasing hormone, in healthy adults. J Clin Endocrinol Metab. 2006;91(3):799-805.',
      'Raun K, et al. Ipamorelin, the first selective growth hormone secretagogue. Eur J Endocrinol. 1998;139(5):552-561.',
      FDA_CAT2_503B, WADA,
    ],
    model: { kind: 'none', note: 'Raises GH/IGF-1; no human body-composition data.' },
  },
  {
    id: 'mk677', name: 'MK-677 (ibutamoren)', category: 'peptide', evidence: 'weak',
    // Added 2026-10-20 (§22.8): ibutamoren mesylate is in Category 2 on BOTH the 503A and 503B lists, which the
    // entry did not say. It is one of only six substances on the 503A Category 2 list, and that is a materially
    // harder restriction than the Category 1 status enclomiphene has.
    status: 'Not FDA approved; sold as a research chemical. Ibutamoren mesylate is in Category 2 on both of FDA\'s bulk-substances lists — 503A (updated 14 May 2026) and 503B (dated 29 September 2023) — meaning FDA has identified significant safety risks and neither a pharmacy nor an outsourcing facility has a compounding route for it. WADA prohibited.',
    summary: 'An oral GH secretagogue. In trials, fat-free mass went up 1–3 kg, but mostly as water, with no strength or function benefit. It increases appetite and blood sugar and lowers insulin sensitivity.',
    mechanism: 'Ghrelin-receptor agonist: raises GH and IGF-1 around the clock and increases hunger.',
    effects: [
      'Older adults, 25 mg/day for 12 months: FFM +1.1 kg vs −0.5 kg placebo, no strength change (Nass 2008).',
      'Obese adults, 8 weeks: FFM +3 kg, fat unchanged (Svensson 1998). Reversed diet-induced protein loss in young men (Murphy 1998).',
      'Forge: water up to +3.3 lb, ~10% better lean retention in a deficit, appetite +150 kcal/day (when intake isn\'t user-set).',
    ],
    risks: ['Higher fasting glucose and lower insulin sensitivity; check HbA1c.', 'Increased appetite, swelling, joint pain, numbness.', 'A hip-fracture trial in elderly patients was stopped over heart-failure cases.', 'Unregulated products.'],
    typicalUse: null,
    sources: [
      'Nass R, et al. Effects of an oral ghrelin mimetic on body composition and clinical outcomes in healthy older adults: a randomized trial. Ann Intern Med. 2008;149(9):601-611.',
      'Svensson J, et al. Two-month treatment of obese subjects with the oral growth hormone (GH) secretagogue MK-677 increases GH secretion, fat-free mass, and energy expenditure. J Clin Endocrinol Metab. 1998;83(2):362-369.',
      'Murphy MG, et al. MK-677, an orally active growth hormone secretagogue, reverses diet-induced catabolism. J Clin Endocrinol Metab. 1998;83(2):320-325.',
      'Chapman IM, et al. Stimulation of the growth hormone (GH)-insulin-like growth factor I axis by daily oral administration of a GH secretogogue (MK-677) in healthy elderly subjects. J Clin Endocrinol Metab. 1996;81(12):4249-4257.',
      WADA,
    ],
    model: {
      kind: 'generic',
      dose: { unit: 'mg/day', default: 25, label: 'studied dose', studied: [10, 25] },
      response: [[0, 0], [10, 0.6], [25, 1]],
      waterLb: 3.3, leanRetentionMult: 0.9, intakeDelta: 150, rampWeeks: 4, waterRampWeeks: 3,
    },
  },
  {
    id: 'enobosarm', name: 'Enobosarm (ostarine, MK-2866), a SARM', category: 'peptide', evidence: 'weak',
    status: 'Not FDA approved; sold online as a research chemical (often mislabeled); FDA has warned against SARMs; WADA prohibited.',
    summary: 'In phase-2 trials in older adults and cancer patients, about 1.3 kg more lean mass than placebo over ~12 weeks at 3 mg/day. There are no long-term or young-lifter data, and a lot of what\'s sold online isn\'t what the label says.',
    mechanism: 'Selective androgen receptor modulator: androgenic signaling in muscle and bone with less effect on prostate (in theory).',
    effects: ['Dalton 2011: total lean mass ≈ +1.3 kg vs placebo at 3 mg/day for 86 days.', 'Forge: direct lean up to ~0.23 lb/week for the 12 studied weeks, then no further gain.'],
    risks: ['Suppresses natural testosterone and lowers HDL cholesterol.', 'Liver-injury case reports.', 'In a JAMA analysis, only about half of online "SARMs" contained what the label said, and many contained other drugs.'],
    typicalUse: null,
    sources: [
      'Dalton JT, et al. The selective androgen receptor modulator GTx-024 (enobosarm) improves lean body mass and physical function in healthy elderly men and postmenopausal women: results of a double-blind, placebo-controlled phase II trial. J Cachexia Sarcopenia Muscle. 2011;2(3):153-161.',
      'Dobs AS, et al. Effects of enobosarm on muscle wasting and physical function in patients with cancer: a double-blind, randomised controlled phase 2 trial. Lancet Oncol. 2013;14(4):335-345.',
      'Van Wagoner RM, et al. Chemical composition and labeling of substances marketed as selective androgen receptor modulators and sold via the Internet. JAMA. 2017;318(20):2004-2010.',
      WADA,
    ],
    model: {
      kind: 'generic',
      dose: { unit: 'mg/day', default: 3, label: 'studied dose', studied: [0.1, 3] },
      response: [[0, 0], [0.3, 0.3], [1, 0.8], [3, 1]],
      leanDirectLbPerWeek: 0.23, rampWeeks: 0, taperAfterWeeks: 12, taperTauWeeks: 0,
    },
  },
  {
    id: 'lgd4033', name: 'LGD-4033 (ligandrol), a SARM', category: 'peptide', evidence: 'weak',
    status: 'Not FDA approved; sold online as a research chemical (often mislabeled); FDA has warned against SARMs; WADA prohibited.',
    summary: 'One 3-week trial in healthy young men: +1.2 kg lean mass at 1 mg/day, with dose-related drops in testosterone and HDL. Nothing is known beyond 3 weeks, so Forge stops the effect there.',
    mechanism: 'Selective androgen receptor modulator.',
    effects: ['Basaria 2013: lean body mass +1.21 kg at 1.0 mg/day over 21 days; no fat change.', 'Forge: direct lean only for the 3 studied weeks.'],
    risks: ['Dose-dependent suppression of total testosterone, SHBG and HDL within 3 weeks.', 'Liver-injury case reports.', 'Online products are frequently mislabeled or contaminated.'],
    typicalUse: null,
    sources: [
      'Basaria S, et al. The safety, pharmacokinetics, and effects of LGD-4033, a novel nonsteroidal oral, selective androgen receptor modulator, in healthy young men. J Gerontol A Biol Sci Med Sci. 2013;68(1):87-95.',
      'Van Wagoner RM, et al. Chemical composition and labeling of substances marketed as selective androgen receptor modulators and sold via the Internet. JAMA. 2017;318(20):2004-2010.',
      WADA,
    ],
    model: {
      kind: 'generic',
      dose: { unit: 'mg/day', default: 1, label: 'highest studied dose', studied: [0.1, 1] },
      response: [[0, 0], [0.3, 0.3], [1, 1]],
      leanDirectLbPerWeek: 0.89, rampWeeks: 0, taperAfterWeeks: 3, taperTauWeeks: 0,
    },
  },
];

// ============================================================ FEMALE MODE (§20)
// Per-item overrides for women, merged by itemFor(item, 'female'). Every number cites the study it comes from
// (docs/research/female-physiology.md). `model.femaleNote` is the text shown for testosterone-shifting items, which
// model no effect in women (all were studied in men, or found nothing in women).
const MALE_HPG = 'A male-hypogonadism therapy (it works by pushing the testes to make more testosterone). In women it is used for other things';
const FEMALE = {
  creatine: {
    summary: 'Works for women too, but less lean mass is measurable: in the meta-analysis of randomized trials, lean-mass gain was +1.46 kg in men and +0.29 kg (not significant) in women. Strength and performance benefits are documented in women, including after menopause.',
    effects: [
      'Delpino 2022 meta-analysis (35 RCTs): lean mass +1.46 kg in men (95% CI 0.47–2.46) vs +0.29 kg in women (−0.43 to 1.01, not significant).',
      'Mihic 2000: a 5-day load raised fat-free mass and body mass more in men than in women (less water storage).',
      'Postmenopausal women with lifting: lean mass +0.37 kg, only at 5 g/day or more (Naddafha 2026 meta-analysis).',
      'Forge (women): lean-ceiling effect at ~20% of the male value (the ratio of the pooled estimates) and ~1 lb of water instead of ~1.6 lb. These female values are assumptions from those studies.',
    ],
    model: { leanCeilingMult: 1.024, waterLb: 1.0 },
    sources: [
      'Smith-Ryan AE, et al. Creatine supplementation in women\'s health: a lifespan perspective. Nutrients. 2021;13(3):877. doi:10.3390/nu13030877',
      'Mihic S, et al. Acute creatine loading increases fat-free mass, but does not affect blood pressure, plasma creatinine, or CK activity in men and women. Med Sci Sports Exerc. 2000;32(2):291-296. doi:10.1097/00005768-200002000-00007',
      'Naddafha S, et al. Creatine monohydrate for lean mass, strength, and bone density in postmenopausal women: a systematic review and meta-analysis. J Int Soc Sports Nutr. 2026;23(1):2668435. doi:10.1080/15502783.2026.2668435',
    ],
  },
  trt: {
    status: 'Prescription only (Schedule III). There is no US-approved testosterone product for women: the only evidence-based use is low sexual desire after menopause, dosed to premenopausal levels (Davis 2019 consensus). Gender-affirming therapy is specialist care. WADA prohibited.',
    summary: 'In women, lean mass rises with the blood level: about +0.6 kg per +100 ng/dL over 24 weeks in the only dose-response trial (Huang 2014, up to ~210 ng/dL), with no change in fat. At male-range levels (trans men), about +3.9 kg lean and −2.6 kg fat over a year. Forge uses your on-therapy level (or estimates it from your dose) against your own natural level.',
    mechanism: 'Androgen-receptor activation raises muscle protein synthesis. Women normally have about 10–57 ng/dL (Haring 2012), so anything above that is supraphysiologic for a woman.',
    effects: [
      'Huang 2014 (71 hysterectomized women, 24 weeks, no training): testosterone enanthate 3 / 6.25 / 12.5 / 25 mg/week → nadir ≈78 / 102 / 128 / 210 ng/dL; lean mass +0.6 kg per +100 ng/dL (95% CI 0.2–1.1), only 25 mg beat placebo (+1.8 kg); no fat change at any dose; chest-press and stair-climb power rose at 25 mg.',
      'Physiological doses (Islam 2019 meta-analysis, 36 RCTs, 8,480 women): no effect on body composition or muscle; more acne and hair growth.',
      'Trans men on male-range testosterone for ~1 year: lean +3.9 kg and fat −2.6 kg (Klaver 2016 meta-analysis), muscle +10.4% (Van Caenegem 2015), thigh muscle +15% (Wiik 2020). Grip gains were the same across levels from ~288 to ~1,555 ng/dL (Scharff 2019).',
      'Forge (women): lean asymptote linear in serum T above your own level (Huang\'s slope), flat above ~600 ng/dL; fat change only above ~230 ng/dL; training ceiling unchanged (no study of testosterone × training in women); the reachable FFMI ceiling rises by the lean mass it adds.',
    ],
    risks: [
      'Above the female range: acne and more body and facial hair (hair score rose at 12.5–25 mg/week in Huang 2014; Islam 2019).',
      'Male-range levels (as in gender-affirming therapy): voice deepening and clitoral enlargement, which can be permanent; periods usually stop; hematocrit rises into the male range (Endocrine Society guideline, Hembree 2017).',
      'Contraindicated in pregnancy: it can virilize a female fetus.',
      'If prescribed: total T at baseline, after 3–6 weeks and every 6 months; stop if there is no benefit by 6 months; pellets, injections and supraphysiologic doses are not recommended for women (Davis 2019).',
    ],
    typicalUse: 'Women: only for postmenopausal low sexual desire (HSDD), transdermal, dosed to premenopausal levels (Davis 2019). Gender-affirming therapy under specialist care.',
    sources: [
      'Huang G, et al. Testosterone dose-response relationships in hysterectomized women with or without oophorectomy: effects on sexual function, body composition, muscle performance and physical function in a randomized trial. Menopause. 2014;21(6):612-623. doi:10.1097/GME.0000000000000093',
      'Huang G, et al. Testosterone dose-response relationships with cardiovascular risk markers in androgen-deficient women: a randomized, placebo-controlled trial. J Clin Endocrinol Metab. 2014;99(7):E1287-E1293. doi:10.1210/jc.2013-4160',
      'Klaver M, et al. Cross-sex hormone therapy in transgender persons affects total body weight, body fat and lean body mass: a meta-analysis. Andrologia. 2017;49(5):e12660. doi:10.1111/and.12660',
      'Van Caenegem E, et al. Body composition, bone turnover, and bone mass in trans men during testosterone treatment: 1-year follow-up data from a prospective case-controlled study (ENIGI). Eur J Endocrinol. 2015;172(2):163-171. doi:10.1530/EJE-14-0586',
      'Wiik A, et al. Muscle strength, size, and composition following 12 months of gender-affirming treatment in transgender individuals. J Clin Endocrinol Metab. 2020;105(3). doi:10.1210/clinem/dgz247',
      'Scharff M, et al. Change in grip strength in trans people and its association with lean body mass and bone density. Endocr Connect. 2019;8(7):1020-1028. doi:10.1530/EC-19-0196',
      'Islam RM, et al. Safety and efficacy of testosterone for women: a systematic review and meta-analysis of randomised controlled trial data. Lancet Diabetes Endocrinol. 2019;7(10):754-766. doi:10.1016/S2213-8587(19)30189-5',
      'Davis SR, et al. Global consensus position statement on the use of testosterone therapy for women. J Clin Endocrinol Metab. 2019;104(10):4660-4666. doi:10.1210/jc.2019-01603',
      'Wierman ME, et al. Androgen therapy in women: a reappraisal: an Endocrine Society clinical practice guideline. J Clin Endocrinol Metab. 2014;99(10):3489-3510. doi:10.1210/jc.2014-2260',
      'Hembree WC, et al. Endocrine treatment of gender-dysphoric/gender-incongruent persons: an Endocrine Society clinical practice guideline. J Clin Endocrinol Metab. 2017;102(11):3869-3903. doi:10.1210/jc.2017-01658',
      'Haring R, et al. Age-specific reference ranges for serum testosterone and androstenedione concentrations in women measured by liquid chromatography-tandem mass spectrometry. J Clin Endocrinol Metab. 2012;97(2):408-415. doi:10.1210/jc.2011-2134',
    ],
    model: {
      dose: { unit: 'mg/week', default: 3, label: 'lowest dose in the female dose-response trial (Huang 2014)', studied: [3, 25], note: 'Testosterone enanthate. Only used to estimate your level when no on-therapy lab is entered; above 25 mg/week Forge uses the men\'s dose-level data (no larger doses were studied in women).' },
      doseToLevel: [[0, 19], [3, 78], [6.25, 102], [12.5, 128], [25, 210], [50, 306], [125, 542], [300, 1345], [600, 2370]],
      // Display reference at Huang's top dose (natural ≈20 → 210 ng/dL); the engine uses testosteroneEffect({ sex:'female' }).
      leanCeilingMult: 1, leanDirectLbPerWeek: 0.04, fatDirectLbPerWeek: 0,
      levelRisks: [
        { min: 1, text: 'Testosterone isn\'t approved for women in the US; the consensus is to keep levels within the premenopausal range and use it only for postmenopausal low sexual desire (Davis 2019). Never during pregnancy.' },
        { min: 60, text: 'Above the female range (~57 ng/dL): acne and more body and facial hair become more common (Huang 2014; Islam 2019).' },
        { min: 200, text: 'At Huang 2014\'s top dose (~210 ng/dL) hemoglobin and hematocrit rose with dose (still within the female range); hair growth increased.' },
        { min: 300, text: 'Male-range level: expect voice deepening and clitoral enlargement that can be permanent, periods stopping, and hematocrit and blood pressure rising toward male values (Hembree 2017). Needs specialist monitoring.' },
      ],
    },
  },
  ashwagandha: { model: { femaleNote: 'In women the meta-analysis found no testosterone rise (+5 ng/dL, not significant, vs +57 ng/dL in men; Fornalik 2026), and a trial in perimenopausal women found none (Gopal 2021). Forge models no effect.' },
    sources: ['Fornalik M, et al. Hormonal modulation with Withania somnifera: systematic review and meta-analysis of randomized-controlled trials. Planta Med. 2026;92(8):790-805. doi:10.1055/a-2802-8363',
      'Gopal S, et al. Effect of an ashwagandha (Withania somnifera) root extract on climacteric symptoms in women during perimenopause: a randomized, double-blind, placebo-controlled study. J Obstet Gynaecol Res. 2021;47(12):4414-4425. doi:10.1111/jog.15030'] },
  tongkat_ali: { model: { femaleNote: 'No randomized trial in women: the only female data are a small mixed-sex pilot in seniors (Henkel 2014). Forge models no effect.' } },
  zma: { model: { femaleNote: 'Correcting a real zinc deficiency matters for health (the female cut-off is ~70 µg/dL, morning fasting; Hotz 2003), but the testosterone evidence is in men. Forge models no muscle effect for women.' } },
  daa: { model: { femaleNote: 'Only studied in men (and the higher dose lowered their testosterone). Forge models no effect for women.' } },
  sleep_hygiene: { model: { femaleNote: 'The testosterone part is from young men (Leproult 2011), so Forge adds none for women. Sleep still drives the muscle ceiling and how much lean you keep in a deficit (your "typical sleep" setting).' } },
  energy_availability: {
    summary: 'The most important item for women who train hard and diet: below about 30 kcal per kg of fat-free mass a day (food minus exercise), the hormone pulses that drive the menstrual cycle were disrupted within 5 days. Missed periods, stress fractures and stalled progress follow (IOC REDs consensus).',
    effects: [
      'Loucks & Thuma 2003 (randomized, 29 regularly menstruating women): LH pulsatility unaffected at 30 kcal/kg lean mass/day, disrupted below it within 5 days.',
      'Hulmi 2017 (27 female physique competitors, 4-month diet to 12.7% body fat): leptin, T3, estradiol and testosterone fell and 63% had irregular bleeding; T3 and testosterone hadn\'t fully recovered after 3–4 months.',
      'Halliday 2016 (case, drug-free figure competitor): energy availability fell during a 20-week prep, cycles became irregular in the first month and the last period came at week 11.',
      'Forge (women): Nutrition and the projection warn when planned intake minus exercise falls under 30 kcal per kg of your lean mass.',
    ],
    sources: [
      'Loucks AB, Thuma JR. Luteinizing hormone pulsatility is disrupted at a threshold of energy availability in regularly menstruating women. J Clin Endocrinol Metab. 2003;88(1):297-311. doi:10.1210/jc.2002-020369',
      'Mountjoy M, et al. 2023 International Olympic Committee\'s (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs). Br J Sports Med. 2023;57(17):1073-1097. doi:10.1136/bjsports-2023-106994',
      'Hulmi JJ, et al. The effects of intensive weight reduction on body composition and serum hormones in female fitness competitors. Front Physiol. 2017;7:689. doi:10.3389/fphys.2016.00689',
      'Halliday TM, Loenneke JP, Davy BM. Dietary intake, body composition, and menstrual cycle changes during competition preparation and recovery in a drug-free figure competitor: a case study. Nutrients. 2016;8(11):740. doi:10.3390/nu8110740',
    ],
  },
  fat_loss: { model: { femaleNote: 'The testosterone rise is a male finding. In women with obesity (often with PCOS) weight loss usually LOWERS excess androgens, which is a health benefit, not a muscle effect. Forge models no testosterone change.' } },
  endurance_load: {
    summary: 'In men, years of high-volume endurance training lower resting testosterone. In women the equivalent risk is low energy availability: missed or irregular periods from not eating enough for the training load (see Eating enough).',
    model: { femaleNote: 'The testosterone drop is a male finding. For women the relevant risk is low energy availability and menstrual disruption (IOC REDs 2023), which Forge warns about in Nutrition and the projection.' },
  },
  dhea: { summary: 'In women DHEA is a real source of testosterone, so it does raise it a little (+17.5 ng/dL in elderly women, Hu 2020), but two years of it changed nothing about body composition or strength (Nair 2006, elderly women). The Endocrine Society advises against routine use (Wierman 2014). Banned in drug-tested sport.',
    sources: ['Hu Q, et al. Impact of dehydroepiandrosterone (DHEA) supplementation on testosterone concentrations and BMI in elderly women: a meta-analysis of randomized controlled trials. Complement Ther Med. 2020;56:102620. doi:10.1016/j.ctim.2020.102620'] },
  clomiphene: { model: { femaleNote: `${MALE_HPG}: clomiphene is FDA-approved to induce ovulation. It doesn't build muscle in women; Forge models no effect.` } },
  enclomiphene: { model: { femaleNote: `${MALE_HPG}. It has no muscle or testosterone role in women; Forge models no effect.` } },
  hcg: { model: { femaleNote: `${MALE_HPG}: hCG triggers ovulation in fertility treatment. Forge models no body-composition effect.` } },
  aromatase_inhibitor: { model: { femaleNote: `${MALE_HPG}: aromatase inhibitors treat breast cancer and induce ovulation. They lower estrogen, which costs bone. Forge models no muscle effect.` } },
  tamoxifen: { model: { femaleNote: `${MALE_HPG}: tamoxifen treats and prevents breast cancer. Forge models no muscle effect.` } },
  cabergoline: { model: { femaleNote: 'In women cabergoline treats high prolactin, which restores periods and fertility. That is a health effect, not a muscle effect; Forge models none.' } },
  oral_tu: { status: 'Prescription only (Schedule III). Approved for male hypogonadism; there is no approved oral testosterone product for women and the doses are far above the female range. WADA prohibited.',
    model: { femaleNote: `${MALE_HPG.replace('(it works by pushing the testes to make more testosterone)', '(oral testosterone replacement for men)')}. Forge models no effect for women; see Testosterone for the female evidence.` } },
  alcohol: { model: { femaleNote: 'The randomized crossover (Sierksma 2004) included postmenopausal women, but the testosterone outcome Forge models is the male one. Alcohol still costs sleep, training quality and calories.' } },
  resistance_training: { effects: [
    'Resting testosterone does not change with training in either sex; women build muscle at the same relative rate as men (Roberts 2020; Refalo 2025) despite about 15× less testosterone.',
    'The acute post-workout hormone surge does not predict growth (West 2010; Morton 2016).',
    'Forge models no hormone effect. The lean mass lifting builds comes through the training side of the projection.',
  ] },
};
for (const s of LIST) if (FEMALE[s.id]) s.female = FEMALE[s.id];

export const SUPPLEMENTS = Object.fromEntries(LIST.map(s => [s.id, s]));

// The catalogue entry as it applies to `sex` (female overrides merged; `sources` appended). Male = the entry itself.
export function itemFor(s, sex) {
  if (!s || sex !== 'female' || !s.female) return s;
  const f = s.female;
  return { ...s, ...f, female: undefined, model: f.model ? { ...s.model, ...f.model } : s.model,
    effects: f.effects || s.effects, risks: f.risks || s.risks, sources: f.sources ? [...s.sources, ...f.sources] : s.sources };
}

export const NOT_MODELED = [
  { name: 'Other anabolic steroids (trenbolone, nandrolone, oral "stacks")', why: 'No dose–response trials in healthy lifters to model from, and liver, heart and lipid risks are serious. (Testosterone itself is modeled from Bhasin\'s trials.) If you\'re considering them, talk to a physician.' },
  { name: 'Clenbuterol', why: 'Not approved for humans in the US. At the doses people use it causes heart-rhythm problems, cardiac damage and deaths, and there\'s no responsible model.' },
  { name: 'DNP (2,4-dinitrophenol)', why: 'An industrial chemical that causes fatal overheating; deaths occur even at doses users thought were "safe". Never take it.' },
  { name: 'Insulin (for bodybuilding)', why: 'Severe hypoglycemia can kill within hours. It\'s only safe as diagnosed diabetes care.' },
  { name: 'Thyroid hormone for fat loss', why: 'In people with normal thyroid function, it burns muscle along with fat and risks atrial fibrillation and bone loss. Treat only diagnosed hypothyroidism.' },
  { name: 'Diuretics for "drying out"', why: 'Water loss isn\'t fat loss, and electrolyte shifts can cause dangerous heart rhythms. Forge only models water from creatine and GH-axis compounds.' },
  { name: 'Ephedrine / ECA stacks', why: 'Banned in US dietary supplements since 2004 after heart attacks, strokes and deaths. The fat-loss effect is small next to the risk.' },
];

// Helpers (pure)
export function getSupplement(id) { return SUPPLEMENTS[id] || null; }
export function isUnapproved(s) { return !!(s && /^not fda approved/i.test(s.status || '')); }
export function isModeled(s) { return !!(s && s.model && s.model.kind && s.model.kind !== 'none'); }

// ===================================================================== §22 helpers
// Needs a prescriber. A build that must not surface prescription items can exclude RX_IDS wholesale.
export function isRx(s) { const x = typeof s === 'string' ? SUPPLEMENTS[s] : s; return !!(x && (x.rx === true || x.category === 'prescription')); }
export const RX_IDS = Object.freeze(Object.values(SUPPLEMENTS).filter(isRx).map(s => s.id));
// Exogenous testosterone by any route: it replaces your own production and suppresses the axis.
export function isExogenousT(s) { const x = typeof s === 'string' ? SUPPLEMENTS[s] : s; return !!(x && (x.exogenousT === true || x.model?.kind === 'testosterone' || x.model?.kind === 'exogenousT')); }
// Every item that changes a man's OWN testosterone (or is in the catalogue specifically because it doesn't).
export const T_AXIS_IDS = Object.freeze(Object.values(SUPPLEMENTS)
  .filter(s => ['tEndogenous', 'tShift', 'exogenousT'].includes(s.model?.kind)
    || ['fenugreek', 'boron', 'tribulus', 'maca', 'shilajit', 'dhea', 'forskolin', 'vitamin_d', 'resistance_training', 'kisspeptin', 'pulsatile_gnrh'].includes(s.id))
  .map(s => s.id));
export const LH_DRIVEN_AXES = Object.freeze(['serm', 'ai', 'gonadotropin', 'herbal']);
export const CAUSE_AXES = Object.freeze(['dopamine', 'nutrient', 'lifestyle']);

// ===================================================================== §22.8 tolerability
// Bob: "I hear enclomiphene is better tolerated and has less of the estrogen effects." Before this the catalogue
// could only answer that with prose. Now a grade is a cited number with a denominator and a named comparator, or
// it is 'unknown' — which for most of this catalogue is the true answer.
export const TOLERABILITY = Object.freeze({
  good: { label: 'Well tolerated', short: 'Tolerability: good', rank: 3,
    text: 'Adverse events were no more common than placebo (or clearly less common than the comparator), with few or no withdrawals.' },
  moderate: { label: 'Mixed tolerability', short: 'Tolerability: moderate', rank: 2,
    text: 'Side effects are common enough to matter but are usually mild and reversible, and rarely stop treatment.' },
  poor: { label: 'Poorly tolerated', short: 'Tolerability: poor', rank: 1,
    text: 'A measured harm, not just a nuisance: the trials found something that got worse on the drug.' },
  unknown: { label: 'Tolerability not measured', short: 'Tolerability: unmeasured', rank: 0,
    text: 'Nobody has collected comparative adverse-event data on this. Forge will not grade what has not been measured.' },
});
export function tolerabilityOf(s) {
  const x = typeof s === 'string' ? SUPPLEMENTS[s] : s;
  return (x && x.model && x.model.tolerability) || null;
}
// Rate as "x% (n of N)" — a percentage without its denominator is how 2 men out of 66 becomes "3% of patients".
export function fmtRate(ev) {
  if (!ev) return '';
  const pct = typeof ev.pct === 'number' ? `${ev.pct}%` : '';
  const frac = typeof ev.n === 'number' && typeof ev.of === 'number' ? `${ev.n} of ${ev.of}` : '';
  return pct && frac ? `${pct} (${frac})` : pct || frac;
}
// The grade for a whole row: the WORST graded item in it, because a combination is only as tolerable as its
// least tolerable part. 'unknown' never outranks a measured grade but does win over nothing at all.
export function worstTolerability(items) {
  const got = (items || []).map(tolerabilityOf).filter(Boolean);
  if (!got.length) return null;
  const graded = got.filter(t => t.grade && t.grade !== 'unknown');
  if (!graded.length) return got[0];
  return graded.reduce((a, b) => ((TOLERABILITY[b.grade]?.rank ?? 9) < (TOLERABILITY[a.grade]?.rank ?? 9) ? b : a));
}
// The panel that decides which of these therapies could apply at all (docs/research/endogenous-testosterone.md §5).
export const T_LAB_PANEL = Object.freeze([
  { k: 'totalT', label: 'Total testosterone', why: 'The number everything is gated on. Morning (7–10 am), fasted, and repeated on a separate day — it is pulsatile.' },
  { k: 'freeT', label: 'Free testosterone', why: 'Equilibrium dialysis, or calculated from total T and SHBG. Normal total with low free points at high SHBG.' },
  { k: 'lh', label: 'LH', why: 'The single most decisive one. Low T with a normal or low LH is secondary (what clomiphene, enclomiphene and hCG treat); low T with a high LH is testicular and those drugs will not work.' },
  { k: 'fsh', label: 'FSH', why: 'Drawn with LH; together they stage the axis and track fertility.' },
  { k: 'estradiol', label: 'Estradiol (sensitive assay)', why: 'Men need it: it is what keeps fat down (Finkelstein 2013) and bone intact. It decides whether an aromatase inhibitor makes any sense.' },
  { k: 'shbg', label: 'SHBG', why: 'Converts total T into free T, and rises with under-eating and age.' },
  { k: 'prolactin', label: 'Prolactin', why: 'A treatable cause of low testosterone. Cabergoline does nothing unless this is high.' },
  { k: 'vitD', label: '25(OH) vitamin D', why: 'Correcting a real deficiency helps muscle function a little; supplementing a replete man does nothing.' },
  { k: 'ferritin', label: 'Ferritin', why: 'Commonly low in endurance athletes (hurts training); very high can mean iron overload, a recognised cause of low testosterone.' },
  { k: 'zinc', label: 'Serum zinc', why: 'Only a measured deficiency (<70 µg/dL) moves testosterone.' },
]);
