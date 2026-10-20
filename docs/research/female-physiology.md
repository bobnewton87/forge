# Female physiology in Forge (female mode, CONTRACT §20)

Bob asked for female mode to be "scientific": every female-specific number in the code comes from a study and
is cited here with its DOI. Where the evidence is weak or mixed, this file says so and names the conservative
assumption Forge uses instead. Code lives in `js/engine/sex.js` (constants and helpers) and the female branches of
`bodycomp.js`, `projection.js`, `metabolic.js`, `nutrition.js`, `targets.js`, `data/supplements.js` and
`data/sculpt.js`. Male results did not change: the male constants are the ones the engines used before, and a
golden comparison of male outputs (baseline, projection at 12/104/260 weeks with and without phases, the nutrition
lab, stack modifiers, targets, daily targets, the generator and the planner) matched exactly.

Sources were retrieved from PubMed and checked against the PubMed record for title, journal and DOI.

## 1. What changes in female mode (summary)

| Area | Male (unchanged) | Female | Basis |
|---|---|---|---|
| Body fat formulas | Navy (men), RFM, Deurenberg | Navy (women, adds hips), RFM (+12), Deurenberg | already sex-specific |
| BMR without body fat | Mifflin +5 | Mifflin −161 | Mifflin-St Jeor 1990 |
| Healthy body fat | — | 21–33 % at 20–39 (23–34, 24–36 older) | Gallagher 2000 |
| Lean-gain rate | % of bodyweight (Aragon/McDonald) | same % applied to lean ÷ 0.80 | Roberts 2020; Refalo 2025 |
| Muscle distribution | legs/glutes ≈ 44 % | legs/glutes ≈ 47 % | Janssen 2000 |
| Natural FFMI ceiling | 25 ± 1.5 | 22 ± 1.5 | Schutz 2002; Magee 2024; Harty 2019 (assumption) |
| Defended / floor body fat | 6 % / 5 % | 13 % / 10 % | Hulmi 2017; Halliday 2016; Meyer 2013 |
| Default goal body fat | 12 % | 22 % (limits 14–35) | Gallagher 2000 range (preference) |
| Tape response to fat | waist first | less waist, more hips/thighs | Kuk & Ross 2009 (direction only) |
| Milestones | abs 12/10, V-taper 1.5/1.618, FFMI 22/23, race weight | abs ~20/~16 (rule of thumb), waist:hip 0.85, waist:height 0.5, FFMI 18.5/20 | see §3 |
| Natural testosterone | ~550 ng/dL default; low T limits the ceiling | ~27 (pre) / 18 (post) default; never limits the ceiling | Kushnir 2010; Haring 2012; Roberts 2020 |
| Testosterone therapy | Bhasin 1996/2001 fit | Huang 2014 slope + trans-men cohorts | §4 |
| Creatine | ceiling ×1.12, water 1.6 lb | ceiling ×1.024, water 1.0 lb | Delpino 2022; Mihic 2000 |
| T "boosters", HPG therapies | gated models (men) | no effect | Fornalik 2026; studied in men only |
| Protein | 1.0 g/lb (1.15 cut) | same | Morton 2018 (sex explained no variance) |
| Energy availability | not checked | warning under 30 kcal/kg FFM/day | Loucks & Thuma 2003; IOC REDs 2023 |
| Iron | 8 mg/day | 18 mg/day before menopause | IOM 2001 |
| Weekly set targets | — | same | no study supports different targets |
| Cycle-phase training | — | no adjustment | McNulty 2020; Colenso-Semple 2023 |
| Pregnancy | — | projection paused, no planned deficit | Kominiarek & Rajan 2016; ACOG 2020 |

## 2. Body composition

**Healthy body-fat ranges.** Gallagher D et al. 2000, *Am J Clin Nutr* 72:694, doi:10.1093/ajcn/72.3.694 (4-compartment
model and DXA, 1,626 adults, cut-offs linked to BMI 18.5/25/30). Women 20–39: under 21 % below range, 21–33 % healthy,
33–39 % over, ≥39 % obese; 40–59: 23/34/40; 60–79: 24/36/42. *The table values are the widely reproduced ones; PubMed
had no full text to re-check the table.* Used for the Measure snapshot and the default goal (22 %).

**Essential and defended fat.** No DOI-backed source exists for Behnke's "12 % essential fat in women".
- Hulmi JJ et al. 2017, *Front Physiol* 7:689, doi:10.3389/fphys.2016.00689: 27 female fitness competitors, 4-month diet,
  DXA body fat 23.1 → 12.7 %, 6 of 27 under 10 %; lean mass held; leptin, T3, testosterone and estradiol fell; irregular
  bleeding 63 % vs 30 % in controls; body fat back to 20.1 % and most hormones recovered within 3–4 months (T3 and
  testosterone not fully).
- Halliday TM, Loenneke JP, Davy BM 2016, *Nutrients* 8:740, doi:10.3390/nu8110740: drug-free figure competitor, DXA
  15.1 → 8.6 %, energy availability fell, last period at week 11 of a 20-week prep.
- Meyer NL et al. 2013, *Br J Sports Med* 47:1044, doi:10.1136/bjsports-2013-092561 (cited by Hulmi for a suggested
  12–14 % female health minimum; weak source).
- **Forge:** defended 13 % (a diet below it isn't sustained; intake rises to maintenance), hard floor 10 % (physical, not a
  target). Male values 6 / 5 unchanged.
- Menstrual dysfunction is driven by **energy availability**, not body fat per se: Loucks AB, Thuma JR 2003, *JCEM*
  88:297, doi:10.1210/jc.2002-020369; Mountjoy M et al. 2023 IOC REDs consensus, *Br J Sports Med* 57:1073,
  doi:10.1136/bjsports-2023-106994. Frisch 1974's "critical fatness" idea is superseded.

**FFMI norms and the natural ceiling.** There is no female equivalent of Kouri 1995.
- Schutz Y, Kyle UG, Pichard C 2002, *Int J Obes* 26:953, doi:10.1038/sj.ijo.0802037: median FFMI 18–34 y, women 15.4 vs
  men 18.9.
- Magee MK et al. 2024, *J Strength Cond Res* 38:311, doi:10.1519/JSC.0000000000004621: 1,365 female athletes 17.9 ± 1.8 vs
  men 21.5 ± 1.9.
- Harty PS et al. 2019, *J Sports Sci* 37:2381, doi:10.1080/02640414.2019.1634964: 372 female college athletes (DXA),
  18.82 ± 2.08; 97.5th percentile 23.9.
- Blue MNM et al. 2019, *J Sports Sci* 37:1741, doi:10.1080/02640414.2019.1591575: 266 female athletes 16.9 ± 1.7
  (13.3–25.5).
- Graybeal AJ et al. 2020, *J Strength Cond Res* 34:1676, doi:10.1519/JSC.0000000000002831: female bodybuilders 18.3 (4C)
  vs male 25.1.
- McClung HL et al. 2022, *Med Sci Sports Exerc* 54:1527, doi:10.1249/MSS.0000000000002942: female Ranger graduates 20.0.
- **Forge (assumption):** natural ceiling 22 ± 1.5, i.e. the male ceiling minus the ~3.5-point sex gap in typical FFMI,
  which also equals the female-athlete mean + ~1.5 SD (18.8 + 1.5 × 2.1). FFMI bands and milestones use the athlete data
  (18.5 "athletic", 20 "very muscular").

**Hypertrophy rate.** Women gain the same relative amount of muscle.
- Roberts BM, Nuckols G, Krieger JW 2020, *J Strength Cond Res* 34:1448, doi:10.1519/JSC.0000000000003521: relative
  hypertrophy ES 0.07 ± 0.06 (p = 0.31, no sex difference); relative upper-body strength favours women (ES −0.60).
- Refalo MC et al. 2025, *PeerJ* 13:e19042, doi:10.7717/peerj.19042: relative gain difference +0.69 % (95 % HDI −1.50 to
  2.88), absolute gains slightly larger in men (SMD 0.19, upper body).
- Hubal MJ et al. 2005, *Med Sci Sports Exerc* 37:964 (PMID 15947721): 585 people, 12 weeks, men +2.5 points relative CSA.
- **Forge:** the training-age anchors (written for men as % bodyweight/month) are applied to lean ÷ 0.80 (the lean share of
  the reference man at 20 % fat), so a woman's rate depends on her muscle, not her fat. The 52-week check in
  `test/female.test.js` shows the female/male relative gains within 30 % and the absolute female gain smaller.

**Muscle distribution.** Janssen I et al. 2000, *J Appl Physiol* 89:81, doi:10.1152/jappl.2000.89.1.81 (MRI, 468 adults):
skeletal muscle 33.0 vs 21.0 kg (38.4 vs 30.6 % of body mass); the sex difference is larger in the upper body (40 %) than
the lower body (33 %). Forge: female group shares = male × 0.60 (upper body incl. trunk) or × 0.67 (legs), renormalized;
skeletal muscle ≈ 51 % of lean mass in women vs 55 % in men (derived from the same averages; assumption).

**Where fat comes off.** Kuk JL, Ross R 2009, *Int J Obes* 33:629, doi:10.1038/ijo.2009.48: for the same weight loss men lose
more waist; women lose relatively more lower-body subcutaneous fat. Wirth A, Steinmetz B 1998, *Obes Res* 6:393,
doi:10.1002/j.1550-8528.1998.tb00370.x: waist-to-hip unchanged in both sexes. Karpe F, Pinnick KE 2015, *Nat Rev
Endocrinol* 11:90, doi:10.1038/nrendo.2014.185: gluteofemoral fat turns over slowly. **Only the direction is
evidence-based**; the inches-per-lb coefficients (waist 0.10, hips 0.11, thighs 0.08 in per lb of fat for women vs
0.12 / 0.09 / 0.06 for men) are assumptions. Spot reduction doesn't work in women either: Kostek MA et al. 2007, *Med Sci
Sports Exerc* 39:1177, doi:10.1249/mss.0b0138058a5cb (MRI, 59 women); Ramírez-Campillo R et al. 2013, *J Strength Cond Res*
27:2219, doi:10.1519/JSC.0b013e31827e8681.

**Menopause.** Greendale GA et al. 2019, *JCI Insight* 4:e124865, doi:10.1172/jci.insight.124865 (SWAN, DXA): fat gain doubles
and lean mass starts to fall at the start of the transition, levelling ~2 years after the final period. Thomas E et al.
2021, *Aging Clin Exp Res* 33:2941, doi:10.1007/s40520-021-01853-8: postmenopausal women gain lean mass with training (SMD
0.44), not age-dependent. **Forge adds no separate menopause drift** (the SWAN rates couldn't be verified from the
abstract); it shows the information and lets intake, training and age drive the projection. Stage definitions: STRAW+10,
Harlow SD et al. 2012, *Menopause* 19:387, doi:10.1097/gme.0b013e31824d8f40 (FSH > 25 IU/L late transition). When the stage
isn't set Forge infers it from age (<45 pre, 45–54 peri, ≥55 post; assumption, flagged).

## 3. Milestones

- **Visible abs.** No peer-reviewed study measured where abs show, for either sex. Female milestones use a labelled rule of
  thumb (ab outline ~20 %, defined ~16 %) and say that female physique competitors average ~13 % on stage (Hulmi 2017) at
  the cost of regular periods.
- **Waist-to-hip < 0.85** (WHO expert consultation 2008, published 2011; no DOI; overview: Nishida C et al. 2010, *Eur J Clin
  Nutr* 64:2, doi:10.1038/ejcn.2009.139) replaces the male shoulder:waist golden ratio.
- **Waist-to-height < 0.5** works for both sexes: Ashwell M, Gunn P, Gibson S 2012, *Obes Rev* 13:275,
  doi:10.1111/j.1467-789X.2011.00952.x.
- **No race-weight milestone** for women unless she enters both a benchmark weight and body fat (Bob's 137 lb is male-only).

## 4. Hormones

**Natural testosterone in women** (LC-MS/MS):
- Haring R et al. 2012, *JCEM* 97:408, doi:10.1210/jc.2011-2134: 985 women 20–80, total T 0.35–1.97 nmol/L (≈10–57 ng/dL),
  calculated free T ≈0.7–7.3 pg/mL; declines with age.
- Kushnir MM et al. 2010, *Clin Chem* 56:1138, doi:10.1373/clinchem.2010.143222: median 27 ng/dL premenopausal, 18 ng/dL
  postmenopausal (flat after menopause).
- Davison SL et al. 2005, *JCEM* 90:3847, doi:10.1210/jc.2005-0212: natural menopause has no independent effect; the decline
  happens in the early reproductive years.
- Stanczyk FZ et al. 2022, *J Steroid Biochem Mol Biol* 223:106080, doi:10.1016/j.jsbmb.2022.106080: postmenopausal total T
  19.9–26.2 ng/dL, free T 3.7–4.6 pg/mL, SHBG 43–68 nmol/L.
- Combined oral contraceptives: Zimmerman Y et al. 2014, *Hum Reprod Update* 20:76, doi:10.1093/humupd/dmt038: total T
  −0.49 nmol/L (≈ −31 %), free T −61 %, SHBG +99 nmol/L.
- **Forge:** default total T by age (32 at 20 → 18 at 55+, interpolated through Kushnir's medians), ×0.69 on combined
  hormonal contraception; free T → total ×8 (Vermeulen at T 27 ng/dL, SHBG 60 nmol/L ≈ 1.2 % free).
- **Natural female testosterone never changes the muscle ceiling.** Women build muscle at the same relative rate as men with
  ~15× less testosterone (Roberts 2020), and raising T within the female range didn't significantly change lean mass in the
  only dose-response trial (Huang 2014). The male low-T penalty curve is not applied to women.

**Testosterone therapy in women (dose-response, as the studies show, no cap at the normal range):**
- Huang G et al. 2014, *Menopause* 21:612, doi:10.1097/GME.0000000000000093, and *JCEM* 99:E1287, doi:10.1210/jc.2013-4160:
  71 hysterectomized women, testosterone enanthate 0/3/6.25/12.5/25 mg/week for 24 weeks → nadir 19/78/102/128/210 ng/dL.
  Lean mass +0.6 kg per +100 ng/dL (95 % CI 0.2–1.1); only 25 mg beat placebo (+1.8 kg); no fat-mass change at any dose;
  hemoglobin/hematocrit rose within the female range; hair score rose at 12.5–25 mg; no clitoromegaly.
- Klaver M et al. 2017 (online 2016), *Andrologia* 49:e12660, doi:10.1111/and.12660 (meta-analysis, 354 trans men, ~1 year
  of male-range testosterone): lean +3.9 kg (3.2–4.5), fat −2.6 kg (−3.9 to −1.4).
- Van Caenegem E et al. 2015, *Eur J Endocrinol* 172:163, doi:10.1530/EJE-14-0586: muscle +10.4 %, fat −9.7 % in a year.
- Wiik A et al. 2020, *JCEM* 105(3), doi:10.1210/clinem/dgz247: thigh muscle +15 % in 12 months.
- Scharff M et al. 2019, *Endocr Connect* 8:1020, doi:10.1530/EC-19-0196: grip +6.1 kg; gains did not differ across achieved-T
  tertiles spanning ~288–1,555 ng/dL.
- Islam RM et al. 2019, *Lancet Diabetes Endocrinol* 7:754, doi:10.1016/S2213-8587(19)30189-5 (36 RCTs, physiological doses):
  no body-composition effect; more acne and hair growth.
- Davis SR et al. 2019 Global Consensus, *JCEM* 104:4660, doi:10.1210/jc.2019-01603; Wierman ME et al. 2014, *JCEM* 99:3489,
  doi:10.1210/jc.2014-2260; Hembree WC et al. 2017, *JCEM* 102:3869, doi:10.1210/jc.2017-01658 (masculinizing effects,
  monitoring).
- **Forge model** (`metabolic.T_MODEL_F`): lean asymptote = 0.6 kg per +100 ng/dL above her own level, same saturating time
  course as the male model (τ = 12 wk, 24-week value at 24 weeks), held flat above ~600 ng/dL (no female lean-vs-level data
  past typical male-range levels; Scharff's flat strength response), plateau plus a warning above 1,555 ng/dL. Fat: none up to
  ~230 ng/dL (Huang), rising to −2.6 kg/yr at ~550 (Klaver). Training ceiling ×1 (no study of T × training in women).
  Checks: 19 → 210 ng/dL gives +1.15 kg at 24 weeks (Huang's slope; their 25 mg group observed +1.8 kg, so the slope is the
  conservative choice); 20 → 550 ng/dL gives +3.6 kg lean and −2.6 kg fat at 52 weeks (Klaver: +3.9, −2.6). The reachable
  FFMI ceiling rises by exactly the asymptotic lean mass (`modifiersAt().ffmiCeilingDelta`), so the studied gain isn't cut off
  at the natural female ceiling. Dose → level: Huang's groups up to 25 mg/week, then the men's GnRH-suppressed (exogenous-only)
  Bhasin 2001 mapping, which agrees at 25 mg (210 vs 253 ng/dL).
- Female risks shown by level: any dose (not approved for women in the US; keep within the premenopausal range; never in
  pregnancy), >60 ng/dL (acne, hair), ≥200 (Huang's top dose: hematocrit up), ≥300 (male range: voice deepening and clitoral
  enlargement that can be permanent, periods stop, hematocrit toward male values).

**Endogenous-testosterone "boosters" and male HPG therapies in women:** no effect modeled.
- Ashwagandha: Fornalik M et al. 2026, *Planta Med* 92:790, doi:10.1055/a-2802-8363: men +57 ng/dL, women +5.1 ng/dL (not
  significant); Gopal S et al. 2021, *J Obstet Gynaecol Res* 47:4414, doi:10.1111/jog.15030: no testosterone change in
  perimenopausal women.
- Tongkat ali: no female RCT (one mixed-sex pilot in seniors).
- Clomiphene, enclomiphene, hCG, aromatase inhibitors, tamoxifen: male-hypogonadism therapies that work through the testes; in
  women they are fertility or breast-cancer drugs. Cabergoline treats high prolactin (restores periods). DHEA raises T a little
  in women (+17.5 ng/dL, Hu Q et al. 2020, *Complement Ther Med* 56:102620, doi:10.1016/j.ctim.2020.102620) but changed nothing
  in body composition (Nair KS et al. 2006, *NEJM* 355:1647, doi:10.1056/NEJMoa054629).
- Sleep restriction → T (Leproult 2011) and obesity weight loss → T are male findings; Forge keeps the sleep effect on the
  muscle ceiling (Nedeltcheva 2010 included women) but adds no T change for women.

**Menopausal hormone therapy:** Javed AA et al. 2019, *JAMA Netw Open* 2:e1910154, doi:10.1001/jamanetworkopen.2019.10154 (12
RCTs: −0.06 kg less lean lost, not significant); Greising SM et al. 2009, *J Gerontol A* 64:1071, doi:10.1093/gerona/glp082 (~5 %
more strength); Salpeter SR et al. 2006, *Diabetes Obes Metab* 8:538, doi:10.1111/j.1463-1326.2005.00545.x (abdominal fat
−6.8 %). Forge shows this as information and models no lean or fat change (the abdominal-fat effect isn't a whole-body fat-mass
number).

**Female lab cut-offs** (Supplements screen, hormone-panel notes): FSH > 25 IU/L (STRAW+10); prolactin > ~25 ng/mL (typical
female lab limit, assay-dependent; Melmed S et al. 2011, *JCEM* 96:273, doi:10.1210/jc.2010-1692, has no numeric cut-off in the
abstract); estradiol < 20 pg/mL flagged only before menopause (assumption); zinc < 70 µg/dL morning fasting (Hotz C et al. 2003,
*Am J Clin Nutr* 78:756, doi:10.1093/ajcn/78.4.756; value from the paper's tables, not re-checked); ferritin < 30 (Clénin G et
al. 2015, *Swiss Med Wkly*, doi:10.4414/smw.2015.14196; ~25 is the physiological threshold in women, Mei Z et al. 2021, *Lancet
Haematol* 8:e572, doi:10.1016/S2352-3026(21)00168-X) and > 150 high (WHO 2020 ferritin guideline, ISBN 9789240000124, not
PubMed-indexed).

## 5. Supplements

**Creatine.** Delpino FM et al. 2022, *Nutrition* 103–104:111791, doi:10.1016/j.nut.2022.111791 (35 RCTs): lean mass +1.46 kg
in men (0.47–2.46) vs +0.29 kg in women (−0.43 to 1.01, not significant). Mihic S et al. 2000, *Med Sci Sports Exerc* 32:291,
doi:10.1097/00005768-200002000-00007: loading raised fat-free and body mass more in men. Smith-Ryan AE et al. 2021, *Nutrients*
13:877, doi:10.3390/nu13030877. Naddafha S et al. 2026, *J Int Soc Sports Nutr* 23:2668435,
doi:10.1080/15502783.2026.2668435 (postmenopausal, +0.37 kg at ≥5 g/day). **Forge (assumption from those):** female
lean-ceiling effect at 20 % of the male value (1.024 vs 1.12) and ~1 lb of water instead of 1.6.

All other catalogue models are unchanged for women: GLP-1 trials, MK-677 (Nass 2008) and enobosarm (Dalton 2011) included
women.

## 6. Nutrition

- **Protein:** Morton RW et al. 2018, *Br J Sports Med* 52:376, doi:10.1136/bjsports-2017-097608: plateau 1.62 g/kg/day; sex
  (14 all-female groups) explained no variance. Female IAAO estimates sit at or below that: Wooding DJ et al. 2017, *Med Sci
  Sports Exerc*, doi:10.1249/MSS.0000000000001366 (RDA 1.71 g/kg, n = 6); Malowany JM et al. 2019, *Med Sci Sports Exerc*,
  doi:10.1249/MSS.0000000000001832 (1.49–1.53 g/kg). **No change.**
- **Low energy availability:** EA = (intake − exercise kcal) / kg FFM / day. Loucks & Thuma 2003 (above): LH pulsatility
  unaffected at 30, disrupted below it within 5 days. Areta JL et al. 2021, *Eur J Appl Physiol* 121:1,
  doi:10.1007/s00421-020-04516-0: ≤30 low, 45 adequate; thresholds unknown in men. IOC REDs 2023 (above). **Forge:** women
  get a warning under 30 kcal/kg FFM/day in Nutrition (from average intake and the projection's net exercise kcal) and in the
  projection (per simulated week). Men: not added, because the threshold is unknown in men and male outputs must not change.
- **Calorie floors:** NHLBI 1998 (*Am J Clin Nutr* 68:899, doi:10.1093/ajcn/68.4.899) suggests 1,000–1,200 kcal/day diets for
  most women and 1,200–1,500 for men (text, not abstract); AHA/ACC/TOS 2013 (Jensen MD et al., *J Am Coll Cardiol*,
  doi:10.1016/j.jacc.2013.11.004) 1,200–1,500 women. These are weight-loss prescriptions, not safety floors. Forge keeps its
  existing floors (generated targets ≥ 1,000 kcal; user-entered ≥ 1,200) and relies on the energy-availability check, which is
  the better-evidenced safety signal for people who train.
- **Fat:** IOM AMDR 20–35 % applies to everyone. The female warning drops the male "can lower testosterone" claim.
- **Iron:** RDA 18 mg/day women 19–50, 8 mg men and after menopause, 27 mg in pregnancy (IOM 2001; Trumbo P et al. 2001, *J Am
  Diet Assoc* 101:294, doi:10.1016/S0002-8223(01)00078-5). Iron deficiency in 15–35 % of female athlete cohorts vs 5–11 % of
  male (Sim M et al. 2019, *Eur J Appl Physiol*, doi:10.1007/s00421-019-04157-y; Pedlar CR et al. 2018, *Eur J Sport Sci*,
  doi:10.1080/17461391.2017.1416178). Female tips and the supplement list carry an iron note (test first).
- **Cycle:** luteal-phase RMR is slightly higher (Benton MJ et al. 2020, *PLoS One*, doi:10.1371/journal.pone.0236025; SMD 0.33,
  no pooled kcal value), so no adjustment; scale weight swings with water, so the projection notes the trend.
- **Pregnancy/postpartum:** Kominiarek MA, Rajan P 2016, *Med Clin North Am* 100:1199, doi:10.1016/j.mcna.2016.06.004 (+0/+340/+452
  kcal by trimester; pregnancy is not a time for weight loss; lactation ~+500 kcal gross; 0.5–1 kg/month loss after the first
  month is compatible with breastfeeding). ACOG Committee Opinion 804 (2020), *Obstet Gynecol* 135:e178,
  doi:10.1097/AOG.0000000000003772. **Forge:** pregnancy pauses the projection and never plans a deficit; postpartum and
  breastfeeding run with a caution.

## 7. Training

- **Volume, recovery, fatigability:** Hunter SK 2014, *Acta Physiol*, doi:10.1111/apha.12234 and Hunter SK 2016, *Med Sci Sports
  Exerc*, doi:10.1249/MSS.0000000000000928 (women usually less fatigable in isometric and some dynamic tasks); Nuzzo JL et al.
  2024, *Sports Med*, doi:10.1007/s40279-023-01937-7 (little sex influence on reps at a given %1RM); Roberts 2020 (same relative
  hypertrophy). No study supports different weekly set targets for women. **Targets unchanged.**
- **Menstrual cycle:** McNulty KL et al. 2020, *Sports Med* 50:1813, doi:10.1007/s40279-020-01319-3 (early follicular vs other
  phases ES −0.06, trivial; evidence "low"; no general guidelines possible); Colenso-Semple LM et al. 2023, *Front Sports Act
  Living*, doi:10.3389/fspor.2023.1054542 (premature to conclude phase affects strength or hypertrophy); Thompson B et al. 2020,
  *Sports Med*, doi:10.1007/s40279-019-01219-1 (conflicting, small). **No cycle-based adjustments**; the info text says so.
- **Oral contraceptives:** Elliott-Sale KJ et al. 2020, *Sports Med*, doi:10.1007/s40279-020-01317-5 (trivial performance
  effect); Dalgaard LB et al. 2019, *Front Physiol*, doi:10.3389/fphys.2019.00824 (quad CSA +11 % vs +8 % on the pill, p = 0.06);
  Riechman SE, Lee CW 2022, *J Strength Cond Res*, doi:10.1519/JSC.0000000000004059 (observational: less lean gain on the pill).
  Mixed, so **not modeled**.
- **Cardio calories:** METs × kg × hours is the Compendium standard for everyone (Herrmann SD et al. 2024, *J Sport Health Sci*,
  doi:10.1016/j.jshs.2023.10.010). It scales by bodyweight, and `bodycomp.tdee()` subtracts the person's own (sex-specific)
  resting burn during exercise, which covers the main sex difference (women's lower RMR per kg; Byrne NM et al. 2005, *J Appl
  Physiol*, doi:10.1152/japplphysiol.00023.2004; Kozey S et al. 2010, *J Phys Act Health*, doi:10.1123/jpah.7.4.508). **No
  change.**

**Sculpt goals.** New `glute_shelf` (upper glutes / glute med): Attarieh 2026, *J Strength Cond Res*,
doi:10.1519/JSC.0000000000005701 (MRI: cable abduction grew the upper glute max +10 % and glute med/min +4 %; hip extension
grew mostly the lower glute max); Plotkin DL et al. 2023, *Front Physiol* 14:1279170, doi:10.3389/fphys.2023.1279170 (hip thrust
≈ squat for glute max; glute med/min barely grew); Selkowitz DM et al. 2013, *J Orthop Sports Phys Ther*, doi:10.2519/jospt.2013.4116
(EMG only). Female wording for `glutes` cites Krause Neto et al. 2025, *Front Physiol*, doi:10.3389/fphys.2025.1542334; Barbalho M
et al. 2020, *Int J Sports Med* 41:306, doi:10.1055/a-1082-1126; Kubo K et al. 2019, *Eur J Appl Physiol*,
doi:10.1007/s00421-019-04181-y; Kassiano W et al. 2023, *J Strength Cond Res*, doi:10.1519/JSC.0000000000004415. Light vs heavy loads
grow muscle alike near failure (Schoenfeld BJ et al. 2017, *J Strength Cond Res*, doi:10.1519/JSC.0000000000002200; in women,
Stefanaki et al. 2019, *J Sports Sci*, doi:10.1080/02640414.2018.1559536). **Default goals for new female profiles**
(`FEMALE_DEFAULT_SCULPT_GOALS`): glutes, glute_shelf, hamstrings, shoulder_width, back_thickness. That is a preference default,
not a physiological claim. An existing profile's goals are never changed silently: switching to female offers the set.

## 8. Weak or open points

- Female natural FFMI ceiling (22) and the female muscle-score scale are anchored assumptions, not measured limits.
- Female tape coefficients: direction from studies, magnitudes assumed.
- Female abs milestones: rule of thumb (no study for either sex).
- Creatine in women: the female lean estimate is not significant; the 20 % scaling is an assumption.
- Testosterone above ~600 ng/dL in women: held flat (no lean-vs-level data); T × training interaction in women unstudied.
- Menopause transition: no separate drift modeled (SWAN rates not verifiable from the abstract).
- Bob-specific defaults that every new user still inherits (not female-specific, flagged for the accounts work): leg
  muscles at "maintenance" priority tier, the name "Bob", the race-weight default, Adderall tips for men.
