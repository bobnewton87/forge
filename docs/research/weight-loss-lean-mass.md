# Weight loss and intentional lean-mass loss

Evidence behind CONTRACT §23 (the `weight_loss` goal), the lean/fat partitioning in
`js/engine/projection.js`, the deficit sizing in `js/engine/nutrition.js`, and the below-floor
weekly set targets in `js/engine/targets.js`.

Written 2026-10-20. Every number below is quoted from the published abstract unless flagged
otherwise. Where a number could not be verified from an abstract, that is said in the text —
Forge never shows a figure as a study result when it is actually a Forge assumption.

---

## 0. Why the goal exists

Forge assumed every user wanted to gain muscle, or at worst keep all of it. Real goals include
making a weight class, getting to race weight, or simply being smaller, and people with those
goals knowingly accept losing some lean mass. Telling them "you will keep all your muscle" is
not kinder than telling them what it costs; it is just wrong. `cut` stays as it is — *get lean,
keep muscle*. `weight_loss` is *get smaller: fat first, lean mass allowed to follow*.

Forge does not block an adult from choosing a legal goal. It shows the costs.

---

## 0b. Scope: the partition is universal (amendment, 2026-10-20)

When §23 shipped, the improved partition in §§1-4 below was gated to the `weight_loss` goal, and
`recomp`, `cut` and `lean_bulk` kept the older, more optimistic version (the growth protein curve,
no rate penalty, no clamp). That gate was wrong on its own terms: none of the evidence below is
about a goal, it is about a deficit. The same person, eating the same amount, with the same protein
and the same training, loses the same lean mass whether they call it a cut or a weight-loss plan.

Bob's direction: **"Better model everywhere go."** The partition in §§1-4 now runs in every week
with a negative energy balance, under every goal. What remains specific to `weight_loss` is the
goal *weight* and the intake it implies (`targets.lossPlan`), the "what it costs" reporting block,
the rate scan, the below-growth set floors and the 0× priority sliders — all of which are about
what the user is *choosing*, not about what their body does with a deficit.

Consequences, for the same person and the same calories:

- At the evidence-backed rate with adequate protein the two models agree closely; below 0.7 %/week
  the new one is slightly *kinder*, because `lossRateFactor` floors at 0.5.
- A fast, low-protein diet now costs materially more lean under `cut` and `recomp` too. Worked
  example (180 lb, 25 % DXA, lifting 4×/week, 26 weeks): at −1,000 kcal/day and 0.5 g/lb the model
  now projects **7.2 lb** of lean lost against **5.9 lb** before; at −350 kcal/day and 1.1 g/lb,
  **0.3 lb** against **0.4 lb** before.
- `lean_bulk` in a surplus never enters the branch, so it is unchanged.

---

## 1. Forbes' rule: leanness decides the split

**Forbes GB. Body fat content influences the body composition response to nutrition and
exercise. Ann N Y Acad Sci. 2000;904:359-65.** PMID 10865771 ·
doi:[10.1111/j.1749-6632.2000.tb06482.x](https://doi.org/10.1111/j.1749-6632.2000.tb06482.x)

> Overfeeding for ≥3 weeks produces weight gain that is **60-70 % lean in thin people and
> 30-40 % lean in the obese**. Underfeeding shows an *inverse curvilinear relationship between
> initial body fat content and the proportion of weight loss consisting of lean tissue*, and a
> larger energy deficit makes lean an increasing fraction of the loss. In twin pairs, lean
> accounts for about half the intrapair weight difference in thin individuals and a quarter in
> the obese.

The closed-form partition Forge uses,

```
p = 10.4 / (10.4 + fat mass in kg)
```

comes from **Forbes GB. Lean body mass-body fat interrelationships in humans. Nutr Rev.
1987;45(8):225-31.** PMID 3306482 ·
doi:[10.1111/j.1753-4887.1987.tb02684.x](https://doi.org/10.1111/j.1753-4887.1987.tb02684.x).
PubMed holds no abstract for that paper, so the 10.4 kg constant could not be re-verified from
an abstract during this review; it was already in Forge (unchanged since the original body
model) and is the form reproduced throughout the literature, including Hall's restatement below.
**Treat 10.4 as inherited, not freshly verified.**

**Hall KD. Body fat and fat-free mass inter-relationships: Forbes's theory revisited. Br J Nutr.
2007;97(6):1059-63.** PMID 17367567 ·
doi:[10.1017/S0007114507691946](https://doi.org/10.1017/S0007114507691946)

Forbes' equation is strictly valid only for infinitesimal weight changes. Hall extends it to
real-sized changes via the P-ratio and finds the magnitude of the change has a *relatively weak*
effect, with results *very similar to Forbes's original equation for modest weight changes*. For
very large losses (bariatric surgery) Forbes' original **consistently underestimates FFM loss**.
Forge applies the partition week by week to small weekly changes, which is the regime Hall says
the original equation handles well.

**What Forge encodes.** At each simulated week, `pForbes = 10.4 / (10.4 + F/2.20462)`. For the
worked example below (180 lb at 25 % DXA body fat → 45 lb = 20.4 kg of fat) that is **0.34** at
the start and rises toward **0.50** by the time fat is down to 10 kg. The curve was already in
`projection.js` for every goal; §23 does not change it, it makes it visible and adds the two
things it was missing — rate and a deficit-specific protein curve — which, per §0b, now apply
under every goal as well.

### 1b. 3,500 kcal/lb is a leanness-dependent approximation

**Hall KD. What is the required energy deficit per unit weight loss? Int J Obes (Lond).
2008;32(3):573-6.** PMID 17848938 ·
doi:[10.1038/sj.ijo.0803720](https://doi.org/10.1038/sj.ijo.0803720)

The 3,500 kcal/lb (32.2 MJ/kg) rule only approximately holds for **initial body fat above
30 kg**, and **overestimates** the deficit required per unit of loss at lower body fat, because
the lean tissue a leaner person also loses carries far less energy per pound.

**What Forge encodes.** `nutrition.lossRateDeficit()` uses 3,500 kcal/lb to *size the target*
(the single formula `targets.lossPlan()` and the Nutrition screen both call), and says so in the
assumptions. The *simulation* does proper bookkeeping instead: 1,250 kcal to build a pound of
lean, 800 kcal released when a pound is lost, 3,500 kcal/lb for fat. Adaptive thermogenesis
pulls real-world loss the other way, so Forge reports both the requested rate and the rate the
simulation actually delivers (`weightLoss.projectedLbPerWeek`) and warns when they diverge by
more than 20 %.

---

## 2. Rate of loss: the single clearest lever

**Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J. Effect of two different
weight-loss rates on body composition and strength and power-related performance in elite
athletes. Int J Sport Nutr Exerc Metab. 2011;21(2):97-104.** PMID 21558571 ·
doi:[10.1123/ijsnem.21.2.97](https://doi.org/10.1123/ijsnem.21.2.97)

24 elite athletes, **all doing 4 resistance sessions/week** on a high-protein diet, randomised to
a 0.7 %/week or a 1.4 %/week weight-loss target:

| | Slow (n = 13) | Fast (n = 11) |
|---|---|---|
| Target rate | 0.7 %/wk | 1.4 %/wk |
| **Achieved** | **0.7 ± 0.8 %/wk** | **1.0 ± 0.4 %/wk** |
| Duration | 8.5 ± 2.2 wk | 5.3 ± 0.9 wk (p < .001) |
| Intake reduction | 19 ± 2 % | 30 ± 4 % (p = .003) |
| Body mass | −5.6 ± 0.8 % | −5.5 ± 0.7 % |
| **Fat mass** | **−31 ± 3 %** | **−21 ± 4 %** |
| **Lean body mass** | **+2.1 ± 0.4 %** | **−0.2 ± 0.7 %** (between-group p < .01) |

Same weight off; a third less of it was fat in the fast group, and they gained no lean mass.

Two honest caveats Forge repeats in its own text:

- The demonstrated contrast is **0.7 vs 1.0 %/week**, not 0.7 vs 1.4, because the fast group
  never achieved its target. Forge anchors its curve on that real contrast.
- **Garthe I, Raastad T, Sundgot-Borgen J. Long-term effect of weight loss on body composition
  and performance in elite athletes. Int J Sport Nutr Exerc Metab. 2011;21(5):426-35.**
  PMID 21896944 · doi:[10.1123/ijsnem.21.5.426](https://doi.org/10.1123/ijsnem.21.5.426) — during
  the intervention, fat −31 ± 3 % (slow) vs −23 ± 4 % (fast), lean +2.0 ± 1.3 % vs +0.8 ± 1.1 %,
  and **upper-body strength +12 ± 2 % vs +6 ± 2 %**. But **at 12 months there were no significant
  between-group differences** in body composition or performance, and body mass was back to
  baseline in both groups. Rate matters for the cut; neither rate kept the weight off.

Supporting, in non-athletes: **Ashtary-Larky D et al. Rapid Weight Loss vs. Slow Weight Loss:
Which is More Effective on Body Composition and Metabolic Risk Factors? Int J Endocrinol Metab.
2017;15(3):e13249.** PMID 29201070 ·
doi:[10.5812/ijem.13249](https://doi.org/10.5812/ijem.13249) — n = 42, ≥5 % lost in 5 weeks
(rapid) vs 15 weeks (slow). Slow produced greater reductions in waist, hip, fat mass and body
fat %; rapid produced greater loss of **total body water, lean body mass, fat-free mass and
RMR**. Directional only — the abstract reports no kg values.

Counter-evidence worth knowing: **Vargas-Molina S et al. Eur J Appl Physiol.
2023;123(6):1311-21.** PMID 36802029 ·
doi:[10.1007/s00421-023-05158-8](https://doi.org/10.1007/s00421-023-05158-8) — 14 resistance-trained
women, 8 weeks, progressive vs severe restriction: fat −1.7 ± 0.4 vs −1.2 ± 0.6 kg, fat-free mass
−0.3 ± 0.1 vs −0.2 ± 0.1 kg, **no between-group differences**, very small n. And **Huovinen HT
et al. J Strength Cond Res. 2015;29(1):29-36.** PMID 25028999 ·
doi:[10.1519/JSC.0000000000000619](https://doi.org/10.1519/JSC.0000000000000619) — male
jumpers/sprinters at −750 kcal/day for 4 weeks (~0.5 kg/wk) lost 2.2 ± 1.0 kg of body mass,
1.7 ± 1.6 kg of it fat, with **FFM unchanged** and jump and sprint performance slightly improved;
notably, athletes starting at ≥10 % body fat preserved FFM.

**What Forge encodes** (`projection.lossRateFactor`): a multiplier on the lean share of the loss.

```
LOSS_RATE_REF  = 0.7   %/week  → factor 1.0
LOSS_RATE_K_UP = 2.0           → factor 1.6 at 1.0 %/week   (the Garthe contrast)
LOSS_RATE_K_DOWN = 0.7         → gentler easing below 0.7
clamped to [0.5, 3]
```

The upward slope is calibrated on Garthe's achieved 0.7 → 1.0 %/week contrast. The downward
slope is deliberately gentler: no study shows that going slower than 0.7 %/week helps as much as
going faster hurts. Above 1.0 %/week the curve extrapolates linearly and the UI says so.

The rate is read from the week the simulation actually produces (`100 × weekly mass loss ÷
bodyweight`), not from whatever rate the user asked for, so it is defined for every goal and for
an unplanned deficit. The product of Forbes, protection and rate is then clamped to a lean share
of `[0, 0.95]`: even starvation leaves some fat coming off. At a trivial deficit the rate is near
zero, the factor bottoms out at 0.5, and the lean loss shrinks with the mass loss itself — a
50 kcal/day deficit costs about 0.1 lb of lean over 26 weeks, not a step change.

---

## 3. Protein in a deficit

**Mettler S, Mitchell N, Tipton KD. Increased protein intake reduces lean body mass loss during
weight loss in athletes. Med Sci Sports Exerc. 2010;42(2):326-37.** PMID 19927027 ·
doi:[10.1249/MSS.0b013e3181b2ef8e](https://doi.org/10.1249/MSS.0b013e3181b2ef8e)

20 resistance-trained men, 2 weeks at **60 % of habitual energy intake**:

| | Control | High protein | p |
|---|---|---|---|
| Protein | 15 % kcal ≈ **1.0 g/kg/day** (~0.45 g/lb) | 35 % kcal ≈ **2.3 g/kg/day** (~1.05 g/lb) | |
| Total mass | −3.0 ± 0.4 kg | −1.5 ± 0.3 kg | 0.036 |
| **Lean body mass** | **−1.6 ± 0.3 kg** | **−0.3 ± 0.3 kg** | **0.006** |
| Fat loss | not different between groups | | |

Fatigue ratings were *higher* in the high-protein arm — worth noting, not worth hiding.

**Longland TM, Oikawa SY, Mitchell CJ, Devries MC, Phillips SM. Am J Clin Nutr.
2016;103(3):738-46.** PMID 26817506 ·
doi:[10.3945/ajcn.115.119339](https://doi.org/10.3945/ajcn.115.119339)

Young men, 4 weeks, **~40 % energy deficit** (33 ± 1 kcal/kg LBM/day), resistance training plus
HIIT **6 days/week**:

| | 1.2 g/kg/day | 2.4 g/kg/day |
|---|---|---|
| **Lean body mass** | **+0.1 ± 1.0 kg** | **+1.2 ± 1.0 kg** (p < 0.05) |
| **Fat mass** | **−3.5 ± 1.4 kg** | **−4.8 ± 1.6 kg** (p < 0.05) |

Exercise performance improved similarly in both groups.

**Helms ER, Zinn C, Rowlands DS, Brown SR. A systematic review of dietary protein during caloric
restriction in resistance trained lean athletes: a case for higher intakes. Int J Sport Nutr
Exerc Metab. 2014;24(2):127-38.** PMID 24092765 ·
doi:[10.1123/ijsnem.2013-0054](https://doi.org/10.1123/ijsnem.2013-0054) — 6 studies, 13 groups
(men ≤23 % BF, women ≤35 % BF). Body fat fell 0.5-6.6 % in all groups; **FFM fell 0.3-2.7 kg in
9 of 13**. The one lean, substantially restricted group that preserved FFM without a novel
training stimulus ate **2.5-2.6 g/kg**. Recommendation: **2.3-3.1 g/kg of FFM**, higher with
greater restriction and greater leanness. (The widely cited "0.5-1 %/week" rate guidance often
attributed to this paper is *not* in its abstract; Forge cites Garthe for rate instead.)

**What Forge encodes** (`projection.proteinRetentionFactor`), a curve distinct from the existing
*growth* protein curve, in g per lb of bodyweight → fraction of achievable lean-sparing:

```
0.30 → 0.28   0.45 → 0.52   0.60 → 0.70   0.80 → 0.88   1.00 → 0.98   1.10+ → 1.00
```

The 0.45 and 1.05 anchors are fitted to Mettler's 5.3× difference in lean loss given Forge's
0.9 cap on lifting-plus-protein protection. The plateau at 1.1 g/lb of bodyweight corresponds to
roughly 2.3-2.6 g/kg of FFM at 15 % body fat, inside Helms' recommended band.

---

## 4. Lifting in a deficit

**Murphy C, Koehler K. Energy deficiency impairs resistance training gains in lean mass but not
strength: A meta-analysis and meta-regression. Scand J Med Sci Sports. 2022;32(1):125-37.**
PMID 34623696 · doi:[10.1111/sms.14075](https://doi.org/10.1111/sms.14075)

- Lean-mass gains impaired by an energy deficit: **ES = −0.57, p = 0.02**; strength gains
  comparable: **ES = −0.31, p = 0.28**.
- Matched comparisons: lean mass **ES −0.11 (p = 0.03)** with a deficit vs **+0.20 (p < 0.001)**
  without; strength **0.84 vs 0.81**.
- **Meta-regression: a deficit of about 500 kcal/day prevented gains in lean mass**, and the
  authors recommend avoiding deficits greater than 500 kcal/day when preserving lean mass matters.

**Weinheimer EM, Sands LP, Campbell WW. Nutr Rev. 2010;68(7):375-88.** PMID 20591106 ·
doi:[10.1111/j.1753-4887.2010.00298.x](https://doi.org/10.1111/j.1753-4887.2010.00298.x) —
52 studies: **81 % of energy-restriction-only groups lost ≥15 % of their body weight as
fat-free mass, against 39 % of energy-restriction-plus-exercise groups.** (Exercise was mainly
aerobic, so this understates resistance training.)

Also **Miller T, Mull S, Aragon AA, Krieger J, Schoenfeld BJ. Int J Sport Nutr Exerc Metab.
2018;28(1):46-54.** PMID 28871849 ·
doi:[10.1123/ijsnem.2017-0221](https://doi.org/10.1123/ijsnem.2017-0221) — 40 premenopausal
women, 4 months, protein held at 3.1 g/kg/day: fat loss steepest in resistance training + diet,
and only the resistance-training group significantly increased lean mass. Directional only (the
abstract reports no kg values).

**What Forge encodes.** The existing lifting-protection term is unchanged in shape
(`0.9 × min(1, respW/0.7) × min(1, bodyFat/protectFull)`) — weekly set stimulus saturates at 70 %
of a full growth dose, because keeping muscle takes far less volume than building it. The
≥500 kcal/day finding becomes a warning, in `targets.lossPlan()` and in the projection, rather
than a model term (the energy-availability factor already suppresses gain at that depth).

---

## 5. Below-floor training: maintenance and detraining

**Bickel CS, Cross JM, Bamman MM. Exercise dosing to retain resistance training adaptations in
young and older adults. Med Sci Sports Exerc. 2011;43(7):1177-87.** PMID 21131862 ·
doi:[10.1249/MSS.0b013e318207c15d](https://doi.org/10.1249/MSS.0b013e318207c15d)

n = 70. 16 weeks of training 3 d/week, then 32 weeks of detraining, a **one-third dose** or a
**one-ninth dose**:

- **Young (20-35 y): both the 1/3 and the 1/9 dose preserved the hypertrophy**, and the 1/3 dose
  produced *additional* myofibre hypertrophy.
- **Old (60-75 y): neither dose preserved myofibre hypertrophy.**
- Detraining reversed the IIx→IIa fibre-type shift; strength gained in phase 1 was **largely
  retained throughout detraining**, with only a slight reduction by week 32.

The abstract states the dose as a fraction only; the session/set structure behind "one third" is
not in it, so Forge describes the setting as "about a third of the growth volume" and does not
claim a specific session count from this paper.

**Spiering BA, Mujika I, Sharp MA, Foulis SA. Maintaining Physical Performance: The Minimal Dose
of Exercise Needed to Preserve Endurance and Strength Over Time. J Strength Cond Res.
2021;35(5):1449-58.** PMID 33629972 ·
doi:[10.1519/JSC.0000000000003964](https://doi.org/10.1519/JSC.0000000000003964)

- **Strength and muscle size (younger): maintained up to 32 weeks on as little as 1 session/week
  and 1 set per exercise**, provided relative load is maintained.
- Older populations may need 2 sessions/week and 2-3 sets per exercise.
- **Endurance: maintained up to 15 weeks on 2 sessions/week, or with volume cut 33-66 %
  (13-26 min/session)**, provided exercising heart rate is maintained.
- Intensity is the variable you cannot cut.

**Bosquet L, Berryman N, Dupuy O, Mekary S, Arvisais D, Bherer L, Mujika I. Effect of training
cessation on muscular performance: a meta-analysis. Scand J Med Sci Sports. 2013;23(3):e140-9.**
PMID 23347054 · doi:[10.1111/sms.12047](https://doi.org/10.1111/sms.12047) — 103 studies.
Standardized mean differences with training cessation: **submaximal strength −0.62 (95 % CI
−0.80 to −0.45)**, **maximal force −0.46 (−0.54 to −0.37)**, **maximal power −0.20 (−0.28 to
−0.13)**, all p < 0.01, with a dose-response on the duration of cessation and larger effects
over 65 y.

**Mujika I, Padilla S. Muscular characteristics of detraining in humans. Med Sci Sports Exerc.
2001;33(8):1297-303.** PMID 11474330 ·
doi:[10.1097/00005768-200108000-00009](https://doi.org/10.1097/00005768-200108000-00009) —
capillary density falls within 2-3 weeks; muscle fibre cross-sectional area declines rapidly in
strength and sprint athletes; **strength performance is generally readily maintained for up to
4 weeks of inactivity**. Qualitative: **no %/week rate of CSA loss is given**, and this review
found no source that quantifies one. Forge therefore does not model a detraining decay rate; it
models *reduced planned volume*, which flows through the existing set-response curve, and states
the strength effect sizes above as the known cost.

**What Forge encodes** (`targets.js`): `profile.volumePolicy.floors`

| mode | floor factor | target factor | meaning |
|---|---|---|---|
| `evidence` (default, every other goal) | 1 | 1 | today's evidence floors |
| `maintenance` | 1/3 | 1/3 | Bickel's preserving dose |
| `minimum` | 0 | 1/3 | maintenance-sized targets, no floor; a slider at 0 means no planned sets |

and `LIMITS.priorityLoss = [0, 2]`, so under the weight-loss goal the per-group priority slider
reaches 0 instead of stopping at 0.5×. Both are inert under any other goal, even if the value is
saved in the profile.

---

## 6. Floors and safety

### Essential fat (men)

**Friedl KE, Moore RJ, Martinez-Lopez LE, Vogel JA, Askew EW, Marchitelli LJ, Hoyt RW, Gordon CC.
Lower limit of body fat in healthy active men. J Appl Physiol (1985). 1994;77(2):933-40.**
PMID 8002550 · doi:[10.1152/jappl.1994.77.2.933](https://doi.org/10.1152/jappl.1994.77.2.933)

55 young men, 8-week Army combat leadership course, energy deficit **5.0 ± 2.0 MJ/day
(~1,195 kcal/day)**, **15.7 ± 3.1 % weight loss**. DEXA body fat **14.3 % (range 6-26) →
5.8 ± 1.8 % (range 4-11)**. Men who reached **4-6 % by week 6** showed only small further fat
losses and **"sacrificed increasingly larger proportions of fat-free mass"**. Conclusion:
**4-6 % body fat, about 2.5 kg of fat, is the lower limit for healthy men.**

**Hoyt RW, Friedl KE. Curr Opin Clin Nutr Metab Care. 2006;9(6):685-90.** PMID 17053420 ·
doi:[10.1097/01.mco.0000247472.72155.7c](https://doi.org/10.1097/01.mco.0000247472.72155.7c) —
**4-5 % is the normal lower limit in physically active underfed young men**, and usable fat
energy reserves ≈ (body fat % − 5 %). Women used more fat and less fat-free mass than men to
meet the same fuel need.

Forge's existing `ESSENTIAL_BF` (5 % men, 10 % women) and `DEFENDED_BF` (6 % / 13 %) are
unchanged and already cite Friedl. §23 adds the Friedl sentence about sacrificing fat-free mass
to the warning the user sees when the projection hits the defended floor.

### Low energy availability

**Loucks AB, Thuma JR. Luteinizing hormone pulsatility is disrupted at a threshold of energy
availability in regularly menstruating women. J Clin Endocrinol Metab. 2003;88(1):297-311.**
PMID 12519869 · doi:[10.1210/jc.2002-020369](https://doi.org/10.1210/jc.2002-020369) — n = 29,
5 days, exercise at 15 kcal/kg LBM/day. **LH pulsatility was unaffected at EA = 30 kcal/kg
LBM/day (p > 0.3); below it, LH pulse frequency fell and amplitude rose (all p < 0.04).**

**Mountjoy M et al. 2023 IOC consensus statement on Relative Energy Deficiency in Sport (REDs).
Br J Sports Med. 2023;57(17):1073-97.** PMID 37752011 ·
doi:[10.1136/bjsports-2023-106994](https://doi.org/10.1136/bjsports-2023-106994), with
**Stellingwerff T et al. Br J Sports Med. 2023;57(17):1109-18.** PMID 37752002 ·
doi:[10.1136/bjsports-2023-106914](https://doi.org/10.1136/bjsports-2023-106914).

Important and easy to get wrong: **the 2023 consensus does not publish a single numeric EA
cut-off.** It moved deliberately to an indicator-based **REDs Clinical Assessment Tool v2**, a
three-step process with a four-level (green/yellow/orange/red) severity stratification, and
reports growing evidence of REDs **in male athletes**. So Forge cites:

- **30 kcal/kg FFM/day → Loucks & Thuma 2003**, explicitly scoped to women, LH endpoint, 5 days;
- **the IOC 2023 consensus as the governing framework**, including for men, with the explicit
  statement that **no male threshold has been validated**.

§23 extends the energy-availability check, previously female-only, to men under the weight-loss
goal, with that wording.

### Bone

**Villareal DT, Fontana L, Weiss EP, Racette SB, Steger-May K, Schechtman KB, Klein S, Holloszy
JO. Bone mineral density response to caloric restriction-induced weight loss or exercise-induced
weight loss: a randomized controlled trial. Arch Intern Med. 2006;166(22):2502-10.** PMID 17159017
· doi:[10.1001/archinte.166.22.2502](https://doi.org/10.1001/archinte.166.22.2502)

n = 48, 1 year. Weight loss statistically equivalent: caloric restriction −10.7 ± 6.3 %
(−8.2 ± 4.8 kg) vs exercise −8.4 ± 6.3 % (−6.7 ± 5.6 kg). **CR group: total hip BMD
−2.2 ± 3.1 %, intertrochanter −2.1 ± 3.4 %, spine −2.2 ± 3.3 % (all significant vs control).
Exercise group: no decrease at any site.** Weight change correlated with BMD change in CR
(r = 0.61, p = 0.007) but not in exercise.

This is the strongest "how you lose it matters" number in the review and is what Forge shows
under the "Minimum body mass" preset.

### Rapid weight loss in weight-class sport

**Franchini E, Brito CJ, Artioli GG. J Int Soc Sports Nutr. 2012;9(1):52.** PMID 23237303 ·
doi:[10.1186/1550-2783-9-52](https://doi.org/10.1186/1550-2783-9-52) — ~50 % prevalence of rapid
weight loss across combat disciplines; the usual methods (laxatives, diuretics, plastic suits,
saunas) harm performance and health and may increase the risk of death.
**Brito CJ et al. Int J Sport Nutr Exerc Metab. 2012;22(2):89-97.** PMID 22349031 ·
doi:[10.1123/ijsnem.22.2.89](https://doi.org/10.1123/ijsnem.22.2.89) — n = 580: 60 % used
increased energy expenditure, 50 % saunas and plastic clothing, only 26.1 % had advice from a
nutritionist.

Forge models gradual loss only. It does not model, suggest or support dehydration-based cuts.

---

## 7. Does a smaller body actually make you faster?

This matters for Bob's own case (a 2:30 marathoner) and for anyone dropping mass for endurance.

**Cureton KJ, Sparling PB, Evans BW, Johnson SM, Kong UD, Purvis JW. Effect of experimental
alterations in excess weight on aerobic capacity and distance running performance. Med Sci
Sports. 1978;10(3):194-9.** PMID 723510 (pre-DOI; PubMed holds no DOI for this paper)

Six runners at normal weight and with +5 %, +10 %, +15 % external trunk-loaded weight. **Each 5 %
of added weight cost 2.4 ml/min/kg of VO₂max (per kg of total weight), 35 s of treadmill run time
and 89 m of 12-minute run distance.** Critically, **VO₂max in L/min and VO₂max per kg of
fat-free weight were not systematically affected** — the entire effect is the cost of carrying
mass.

**Sparling PB, Cureton KJ. Med Sci Sports Exerc. 1983;15(3):218-23.** PMID 6621309 — % fat
accounted for 74 % of the mean sex difference in 12-minute run performance, VO₂max per kg FFW
20 %, running economy 2 %.

So the mechanism is mass carriage, not engine quality: **losing fat makes you faster; losing
muscle mostly does not** (it removes mass but also removes the tissue doing the work).

Counterweight, which Forge shows alongside: **Mathisen TF et al. Best practice recommendations
for body composition considerations in sport. Br J Sports Med. 2023;57(17):1148-58.**
PMID 37752006 · doi:[10.1136/bjsports-2023-106812](https://doi.org/10.1136/bjsports-2023-106812)
— across 29 studies, higher body fat was negatively associated with endurance performance and
muscle gain benefited performance, but **"no unique cut-off to signify a performance advantage
for BC was identified"**, body composition did not help talent identification, and its influence
**"should not be overstated"**.

---

## 8. What the model does NOT claim

- **No detraining decay rate.** No source quantifies muscle CSA loss per week with complete
  cessation. Forge models the *reduced planned volume* and quotes Bosquet's strength effect sizes.
- **No validated male energy-availability threshold.** The 30 kcal/kg FFM/day figure is Loucks'
  female LH result; men get the same warning with that caveat attached.
- **No numeric EA cut-off attributed to the IOC 2023 consensus.** It does not publish one.
- **No claim that slow loss is as good for you as fast loss is bad.** The downward half of
  `lossRateFactor` is a Forge assumption, flagged as such.
- **No claim the weight stays off.** Garthe's own 12-month follow-up found both groups back at
  baseline, and Forge says so in the UI.
- **The Forbes 10.4 kg constant is inherited**, not re-verified from an abstract in this review.
