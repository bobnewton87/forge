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
// CONTRACT-NOTE: category 'peptide' also holds SARMs (research compounds); the UI labels the group
//   "Peptides & research compounds". typicalUse is null for every unapproved compound; `dose.default`
//   is the dose used in the cited trial, shown as "studied dose", never as a recommendation.

const WADA = 'WADA Prohibited List (World Anti-Doping Agency), current edition.';
const FDA_CAT2 = 'U.S. FDA. Certain bulk drug substances for use in compounding that may present significant safety risks (Category 2 list), 2023.';

export const EVIDENCE = {
  strong: { label: 'Strong evidence', short: 'Strong', text: 'Several meta-analyses of randomized trials agree.' },
  moderate: { label: 'Moderate evidence', short: 'Moderate', text: 'Randomized trials support it, with caveats (size, population or consistency).' },
  weak: { label: 'Weak evidence', short: 'Weak', text: 'Small, short or industry-funded trials, or results that do not replicate.' },
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
    summary: 'A few small randomized trials found slightly larger strength gains and ~15% higher testosterone at 600 mg/day, plus lower stress. They\'re small, mostly industry-funded trials. Forge models the testosterone bump, which is small.',
    mechanism: 'Adaptogenic herb; lowers cortisol and perceived stress in trials and modestly raises testosterone and DHEA.',
    effects: [
      'Total T up ~15% vs placebo at 600 mg/day (Lopresti 2019, 16 weeks; Wankhede 2015, 8 weeks). Forge feeds that into the testosterone model.',
      'If your T lab was drawn while taking it, the effect is already in your number and is not added again.',
      'Lower perceived stress (Chandrasekhar 2012).',
    ],
    risks: [
      'Rare but documented liver injury (case series from Iceland and the US DILIN network).',
      'Can affect thyroid levels; avoid with hyperthyroidism, and discuss with your doctor if on thyroid medication.',
    ],
    typicalUse: '300 mg twice daily of a standardized root extract (the studied dose)',
    sources: [
      'Wankhede S, et al. Examining the effect of Withania somnifera supplementation on muscle strength and recovery: a randomized controlled trial. J Int Soc Sports Nutr. 2015;12:43.',
      'Lopresti AL, et al. A randomized, double-blind, placebo-controlled, crossover study examining the hormonal and vitality effects of ashwagandha (Withania somnifera) in aging, overweight males. Am J Mens Health. 2019;13(2):1557988319835985.',
      'Chandrasekhar K, Kapoor J, Anishetty S. A prospective, randomized double-blind, placebo-controlled study of safety and efficacy of a high-concentration full-spectrum extract of ashwagandha root in reducing stress and anxiety in adults. Indian J Psychol Med. 2012;34(3):255-262.',
      'Björnsson HK, et al. Ashwagandha-induced liver injury: a case series from Iceland and the US Drug-Induced Liver Injury Network. Liver Int. 2020;40(4):825-829.',
    ],
    model: {
      kind: 'tShift',
      dose: { unit: 'mg/day', default: 600, label: 'studied dose', studied: [250, 600] },
      response: [[0, 0], [300, 0.5], [600, 1]],
      tPct: 15, tPctLowT: 15, rampWeeks: 8,
    },
  },
  {
    id: 'tongkat_ali', name: 'Tongkat ali (Eurycoma longifolia)', category: 'supplement', evidence: 'weak',
    status: 'OTC herbal supplement (quality and contamination vary)',
    summary: 'A meta-analysis found it raises testosterone, mostly in men who started low. In men with normal levels the effect is small. The trials are small and products vary a lot.',
    mechanism: 'Proposed to increase testosterone release and free T via SHBG; also reduced cortisol in one trial.',
    effects: ['Modeled as +15% total T if your level is under 350 ng/dL, +5% otherwise, at 200–400 mg/day.', 'Feeds into the testosterone model (small).'],
    risks: ['Supplement quality varies; some products have been found contaminated with heavy metals. Choose third-party tested.', 'Insomnia and restlessness reported.'],
    typicalUse: '200–400 mg/day standardized root extract (studied range)',
    sources: [
      'Leisegang K, et al. Eurycoma longifolia (Jack) improves serum total testosterone in men: a systematic review and meta-analysis of clinical trials. Medicina (Kaunas). 2022;58(8):1047.',
      'Talbott SM, et al. Effect of Tongkat Ali on stress hormones and psychological mood state in moderately stressed subjects. J Int Soc Sports Nutr. 2013;10(1):28.',
      'Henkel RR, et al. Tongkat Ali as a potential herbal supplement for physically active male and female seniors—a pilot study. Phytother Res. 2014;28(4):544-550.',
    ],
    model: {
      kind: 'tShift',
      dose: { unit: 'mg/day', default: 200, label: 'studied dose', studied: [100, 400] },
      response: [[0, 0], [100, 0.5], [200, 1]],
      tPct: 5, tPctLowT: 15, rampWeeks: 5,
    },
  },
  {
    id: 'zma', name: 'ZMA / zinc / magnesium', category: 'supplement', evidence: 'weak',
    status: 'OTC dietary supplement',
    summary: 'Useful only if you\'re actually deficient (heavy sweaters, endurance athletes and restrictive diets are at higher risk). In men with adequate zinc, it doesn\'t raise testosterone or improve training.',
    mechanism: 'Zinc and magnesium are cofactors for hormone production and sleep; correcting a deficiency helps, and extra beyond that doesn\'t.',
    effects: ['No effect on training adaptations or testosterone in trials of men who weren\'t deficient, so not modeled.', 'Magnesium may help sleep quality in people who are low.'],
    risks: ['Zinc >40 mg/day long-term can cause copper deficiency.', 'Magnesium can loosen stools.'],
    typicalUse: 'Standard ZMA (30 mg zinc, 450 mg magnesium, 10.5 mg B6) at night, only if intake is low',
    sources: [
      'Wilborn CD, et al. Effects of zinc magnesium aspartate (ZMA) supplementation on training adaptations and markers of anabolism and catabolism. J Int Soc Sports Nutr. 2004;1(2):12-20.',
      'Koehler K, et al. Serum testosterone and urinary excretion of steroid hormone metabolites after administration of a high-dose zinc supplement. Eur J Clin Nutr. 2009;63(1):65-70.',
    ],
    model: { kind: 'none', note: 'Only matters if deficient.' },
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
    ],
    model: { kind: 'none', note: 'Driven by your sleep-hours setting.' },
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
    id: 'trt', name: 'Testosterone (TRT and higher doses)', category: 'prescription', evidence: 'strong',
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
    id: 'semaglutide', name: 'Semaglutide (Wegovy / Ozempic)', category: 'prescription', evidence: 'strong',
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
    id: 'tirzepatide', name: 'Tirzepatide (Zepbound / Mounjaro)', category: 'prescription', evidence: 'strong',
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
    id: 'adderall', name: 'Adderall / stimulant ADHD meds', category: 'prescription', evidence: 'strong',
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
    id: 'hgh', name: 'Growth hormone (HGH / somatropin)', category: 'prescription', evidence: 'moderate',
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
    id: 'tesamorelin', name: 'Tesamorelin (Egrifta)', category: 'peptide', evidence: 'moderate',
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
    id: 'bpc157', name: 'BPC-157', category: 'peptide', evidence: 'none',
    status: 'Not FDA approved; sold as a research chemical; FDA lists it among compounding substances with significant safety risks; WADA prohibited.',
    summary: 'Popular for "healing" injuries, but every positive result comes from rats or anecdotes. There are no controlled human studies on healing, muscle or fat. Forge projects no effect.',
    mechanism: 'Proposed to promote blood-vessel growth and tendon healing in animal models. Unknown in humans.',
    effects: ['No human body-composition data, so no projected effect.'],
    risks: ['Unregulated: purity, dose and sterility of research-chemical vials aren\'t verified.', 'Injection risks (infection); unknown long-term effects, including theoretical concerns with angiogenesis and cancer.'],
    typicalUse: null,
    sources: [
      'Gwyer D, Wragg NM, Wilson SL. Gastric pentadecapeptide body protection compound BPC 157 and its role in accelerating musculoskeletal soft tissue healing. Cell Tissue Res. 2019;377(2):153-159.',
      'Seiwerth S, et al. BPC 157 and standard angiogenic growth factors. Gastrointestinal tract healing, lessons from tendon, ligament, muscle and bone healing. Curr Pharm Des. 2018;24(18):1972-1989.',
      FDA_CAT2, WADA,
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
    status: 'Not FDA approved; sold as research chemicals; FDA lists both among compounding substances with significant safety risks; WADA prohibited.',
    summary: 'These raise your own GH and IGF-1 (CJC-1295 for days per injection), but there are no good human studies showing more muscle or less fat. Even real GH mostly adds water in healthy adults. Forge projects no effect.',
    mechanism: 'Ipamorelin is a ghrelin-receptor GH secretagogue; CJC-1295 is a long-acting GHRH analog.',
    effects: ['CJC-1295 raised GH 2–10× and IGF-1 1.5–3× in healthy adults (Teichman 2006); body composition was not shown to change.', 'No projected effect.'],
    risks: ['Unregulated vials (purity, dose, sterility).', 'Flushing, headache, injection-site reactions, water retention and higher blood sugar (GH-axis effects).', 'CJC-1295 never completed clinical development, so long-term safety is unknown.'],
    typicalUse: null,
    sources: [
      'Teichman SL, et al. Prolonged stimulation of growth hormone (GH) and insulin-like growth factor I secretion by CJC-1295, a long-acting analog of GH-releasing hormone, in healthy adults. J Clin Endocrinol Metab. 2006;91(3):799-805.',
      'Raun K, et al. Ipamorelin, the first selective growth hormone secretagogue. Eur J Endocrinol. 1998;139(5):552-561.',
      FDA_CAT2, WADA,
    ],
    model: { kind: 'none', note: 'Raises GH/IGF-1; no human body-composition data.' },
  },
  {
    id: 'mk677', name: 'MK-677 (ibutamoren)', category: 'peptide', evidence: 'weak',
    status: 'Not FDA approved; sold as a research chemical; WADA prohibited.',
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

export const SUPPLEMENTS = Object.fromEntries(LIST.map(s => [s.id, s]));

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
