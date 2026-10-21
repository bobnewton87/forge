# The growth model: every constant, its source, and how much to trust it

Date: 2026-10-21. Scope: `js/engine/projection.js` (the lean/fat partitioning simulation), `js/ui/projection.js`.
Audit method: each response curve was traced back to a primary source or meta-analysis, the numbers were
extracted from the paper (not from memory or secondary summaries), and the curve was either confirmed, changed,
or explicitly relabelled as an assumption. Literature searched through PubMed and full texts.

Bob's ask: *"academically sound so that we can project out"*, and *"if you do more arms or biceps, it's going to
make the biceps specifically bigger. And if you neglect quads, it's going to not make those bigger, maintain, or
whatever it is. It shouldn't just be a wholesale ballooning to perfection."*

The projection **is** the product, so it has to be specific, honest and defensible. Where the evidence is thin
this document says so in those words rather than dressing a guess as a finding.

---

## 0. How to read the model in one paragraph

Each simulated week: recompute maintenance from current lean mass; compare with intake; let the body push back
(TEF + NEAT on a surplus, adaptive thermogenesis on a deficit). Muscle growth has a **ceiling**, computed
**per muscle group**, equal to

```
cap[g] = wholeRate × share[g] × setResponse(sets[g]) × ceilingFactor(ceiling − ffmiEq[g])
         × proteinFactor × carbFactor × bfSurplusFactor × ageFactor × stackFactor × interferenceFactor
gain[g] = cap[g] × energyFactor(balance)
```

`wholeRate` is the training-age rate table applied to lean mass. Everything to its right is a dimensionless
multiplier in [0, ~1.4]. In a deficit, lean is also **lost**, per group, in proportion to
`share[g] × (1 − systemicProtection × maintenanceProtection(sets[g]))`. Building a pound of lean costs
~1,250 kcal; whatever energy is left over (or missing) moves fat at ~3,500 kcal/lb.

---

## 1. `setResponse` — weekly sets → growth stimulus  **CHANGED**

| | value |
|---|---|
| Was | `0.537(1−e^(−S/2)) + 0.826(1−e^(−S/12))`, normalized at 10 sets; **plateau 1.36** |
| Now | `√S`, normalized at 10 sets, exact to 20 sets, then C¹-smooth to an **asymptote of 2.45** |
| Source | Pelland, Remmert, Robinson, Hinson & Zourdos 2025, *Sports Med* 56:481-505, [doi:10.1007/s40279-025-02344-w](https://doi.org/10.1007/s40279-025-02344-w) |

Pelland 2025 meta-regressed 67 studies / 2,058 participants over several candidate functional forms (linear,
linear-log, quadratic, square root, reciprocal) and reports that **the square-root model was the best fit** for
weekly set volume → hypertrophy. Marginal slope **+0.24 % muscle size per set** (95 % CrI 0.15–0.33) at the mean
of **12.25 fractional sets/week**; 100 % posterior probability the slope exceeds zero. In their words, the
analysis *"supports the notion of diminishing returns but not an inverted-U"*. Their volume efficiency tiers for
hypertrophy (their Table 3, smallest detectable effect 2.05 %):

| fractional weekly sets | tier | extra sets needed for one more detectable increment |
|---|---|---|
| 4 | minimum effective dose | — |
| 5–10 | higher efficiency | ~6 |
| 11–18 | intermediate | ~8.5 |
| 19–29 | lower | ~10.75 |
| 30–42 | lowest | ~12.5 |
| 43+ | unclear | insufficient data, *"or potentially less hypertrophy"* |

**Units match.** Pelland found their *fractional* quantification (indirect sets counted as a fraction of a set)
beat both *total* and *direct* (2×log BF = 9.48 and 10.29 respectively). Forge already counts this way:
`recovery.sessionVolume` credits each group by the exercise's own muscle weight, so a dumbbell bench gives chest
1.0 and triceps 0.5 per set. This is the single most important validation in the audit — the x-axis of the
published curve and the x-axis of Forge's input are the same axis.

**Corroboration.**
- Schoenfeld, Ogborn & Krieger 2017, *J Sports Sci* 35:1073-1082, [doi:10.1080/02640414.2016.1210197](https://doi.org/10.1080/02640414.2016.1210197) — ≈ **0.37 % growth per added set** in a continuous meta-regression, graded dose-response, 34 treatment groups. Pelland explicitly compares: *"comparable to the marginal linear slope in the present meta-analysis"*.
- Currier et al. 2023, *Br J Sports Med* 57:1211-1220, [doi:10.1136/bjsports-2023-106807](https://doi.org/10.1136/bjsports-2023-106807) — Bayesian network meta-analysis, 119 hypertrophy trials, n = 3,364. **Multiset** characterised the top-ranked prescriptions for hypertrophy; above that, 95 % of between-prescription credible intervals contained zero. Supports "the first sets do most of the work, after which differences are hard to resolve".
- Baz-Valle et al. 2022, *J Hum Kinet* 81:199-210, [doi:10.2478/hukin-2022-0017](https://doi.org/10.2478/hukin-2022-0017) — 12–20 vs 20+ weekly sets: no difference for quadriceps (p = 0.19) or biceps (p = 0.59); **20+ was better for triceps** (p = 0.01). Six studies, so the high end is noisy — not negative.

**Does it decline?** No. Pelland is explicit, and nothing in the human applied literature shows an inverted-U.
They do caution that the wide credible intervals above ~25 sets remain *"compatible with multiple functional
forms (e.g. functional plateau, inverted-U)"*. Forge therefore keeps the curve monotone (no decline) but caps it:
it tracks √S exactly through 20 sets, bends away above the knee, and asymptotes at 2.45× the 10-set response —
which is the behaviour of a functional plateau past the data.

**ASSUMPTION:** the knee (20 sets) and the asymptote (√60/√10) are not measured. They are chosen so the curve is
within 2 % of pure √ at 25–30 sets, 5 % at 40, and bounded thereafter.

**What changed in practice.** The old curve gave 20 sets only 1.21× the 10-set response; √ gives 1.41×. At 30
sets: 1.29 → 1.70. Emphasis now shows up in the projection roughly as √(ratio of sets), which is both the
published shape and the thing Bob wants to see.

| sets | old | new | pure √(S/10) |
|---|---|---|---|
| 1 | 0.28 | 0.32 | 0.32 |
| 4 | 0.70 | 0.63 | 0.63 |
| 10 | 1.00 | 1.00 | 1.00 |
| 15 | 1.13 | 1.22 | 1.22 |
| 20 | 1.21 | 1.41 | 1.41 |
| 30 | 1.29 | 1.70 | 1.73 |
| 60 | 1.36 | 2.13 | 2.45 |
| ∞ | 1.36 | 2.45 | ∞ |

---

## 2. `maintenanceProtection` — weekly sets → lean-sparing in a deficit  **NEW**

| | value |
|---|---|
| Was | nothing per-group; a single whole-body term `min(1, respW / 0.7)` |
| Now | `1 − e^(−S/1.2)` per group: 0 at no sets, 0.57 at 1, 0.81 at 2, 0.92 at 3, 0.96 at 4 |
| Source | Bickel, Cross & Bamman 2011, *Med Sci Sports Exerc* 43:1177-1187, [doi:10.1249/MSS.0b013e318207c15d](https://doi.org/10.1249/MSS.0b013e318207c15d); Spiering, Mujika, Sharp & Foulis 2021, *J Strength Cond Res* 35:1449-1458, [doi:10.1519/JSC.0000000000003964](https://doi.org/10.1519/JSC.0000000000003964) |

Bickel 2011 randomised 70 adults, after 16 weeks of resistance training 3 d/wk, to detraining or one of two
maintenance doses (**one third** or **one ninth** of phase-1 volume) for 32 weeks. *"Both maintenance
prescriptions preserved phase 1 muscle hypertrophy in the young"* (20–35 y) — and the one-third dose *"led to
additional myofiber hypertrophy"*. In the old group (60–75 y) neither dose was enough. Detraining reversed the
fibre-type shift.

Spiering 2021: *"Strength and muscle size (at least in younger populations) can be maintained for up to 32 weeks
with as little as 1 session of strength training per week and 1 set per exercise, as long as exercise intensity
(relative load) is maintained"*; older populations may need 2 sessions and 2–3 sets.

One such session gives a group roughly 2–3 fractional weekly sets in Forge's accounting, hence τ = 1.2.

**This is the curve that makes neglect real.** Growth saturates at 20+ sets; protection saturates at 3. A muscle
at maintenance volume **holds**; a muscle at zero volume gives up its full anatomical share of a deficit's lean
loss. Before this change, zero-volume calves inherited the full protection of Bob's shoulder work.

**ASSUMPTION:** the shape between 0 and 3 sets is interpolation — both sources tested single doses, not a
dose-response. Bob is 39, between Bickel's two age groups; the model uses the young figure, which is the
optimistic end, and the doc says so.

---

## 3. `leanRatePctPerMonth` — training age → max lean gain  **UNCHANGED, RELABELLED**

| | value |
|---|---|
| Value | anchors (months, %BW/month): 0→1.25, 6→1.10, 12→0.85, 18→0.68, 24→0.55, 36→0.33, 48→0.21, 60→0.15, 84→0.10, 120→0.065, then exponential decay with τ = 72 months |
| Source | **ASSUMPTION / HEURISTIC.** Alan Aragon's rate guideline and Lyle McDonald's model — coaching grey literature, not peer-reviewed curves. |

This is **the weakest constant in the model** and the only one with no peer-reviewed source. No meta-analysis
of lean gain *by training age* exists to fit to. Two things keep it honest:

1. **It is a ceiling, not a prediction.** The user-visible number is the ceiling multiplied by energy ×
   protein × volume × cardio × age × FFMI factors. For Bob that product is ~48 % of the ceiling.
2. **The realised rate is checked against trial magnitudes.** 6–12-week resistance-training studies produce lean
   gains of order 1–2 kg in novices, i.e. roughly 0.5–1 %BW/month, and far less once trained.
   `test/growth-curves.test.js` asserts Forge's *realised* novice rate lands in 0.45–1.2 %BW/month and that a
   5-year lifter's is less than 40 % of it. Note that Morton 2018's often-quoted +0.30 kg FFM is the **effect of
   protein supplementation**, not total gain, so it cannot be used to pin a rate — an error this audit corrected
   in the source comment.
3. The ±30–50 % confidence band (`lmSpread`) exists mainly to carry this uncertainty, and real measurements
   (food log + weight trend → `adaptiveTdee`) override it as data arrives.

---

## 4. `ceilingFactor` and the FFMI ceiling  **BINDING CHANGED**

| | value |
|---|---|
| Ceiling | normalized FFMI 24.2 (DXA scale) for men; `FFMI_CEIL_SD` ±1.5 |
| Shape | `1 − (1 − gap/4)²` over the last 4 FFMI points; zero slope at 4, zero value at the ceiling |
| Was | applied **globally**: `ceilingFactor(ceiling − ffmiOf(totalLean))`, plus a hard guard that rescaled **every group by the same factor `f`** |
| Now | applied **per muscle group** at `ffmiEq[g] = ffmiOf(L0 + G[g]/share[g])`, with a per-group hard cap |
| Source | Kouri, Pope, Katz & Oliva 1995, *Clin J Sport Med* 5:223-228, PMID 7496846 |

Kouri 1995: across 157 athletes the drug-free normalized-FFMI distribution effectively stopped at ≈25, with
steroid users averaging ≈3 points higher. That 25 is from **skinfold** body fat, which reads ~3 points low versus
DXA in lean men, so on Forge's single DXA-equivalent scale (§20b) the ceiling is ≈24.2. **The skinfold→DXA
conversion is Forge's estimate**, not Kouri's.

**The change Bob asked for.** `for (const g of GROUP_ORDER) gG[g] *= f` was wholesale behaviour: one global
factor scaled every muscle. Now each group eases off against **its own** distance from the limit, where
`ffmiEq[g]` is the whole-body FFMI you would have if every muscle were as developed as that group is — the same
extrapolation `muscleAt()` already shows the user. An arm near its own limit stops growing; a neglected quad
keeps all its room; a big back cannot hold the calves back.

Both changes are **strict generalizations**: with equal volume everywhere, `G[g]/share[g]` is identical for every
group and the per-group formula reduces exactly to the old global one.

The per-group hard cap is `share[g] × L0 + G[g] ≤ share[g] × Lcap`. Because the shares sum to 1 this still
guarantees total lean ≤ `Lcap`, so the old global guard became redundant and was removed. A consequence worth
stating: since the shares are fixed anatomical fractions, the per-group allowance is the **same percentage** of
every group's own mass (for Bob, ~51 % from his current baseline). That is the honest arithmetic of a whole-body
FFMI limit plus fixed shares, and it is reported to the user as "room left" per group.

**ASSUMPTION:** nothing measures the *shape* of the approach to the limit. The only hard constraint is that lean
mass must approach it asymptotically and never cross it, which the tests enforce out to 8 years.

---

## 5. `energyFactor` — energy balance → fraction of the ceiling realised  **UNCHANGED, SOURCED**

| | value |
|---|---|
| Value | `b ≥ 0: 0.7 + 0.3(1 − e^(−b/180))`; `b < 0: 0.7 e^(b/600)`. ≈ 0.70 at maintenance, 0.93 at +250, 0.98 at +500, 0.43 at −300, 0.13 at −1000 |
| Source | Garthe, Raastad, Refsnes & Sundgot-Borgen 2013, *Eur J Sport Sci* 13:295-303, [doi:10.1080/17461391.2011.643923](https://doi.org/10.1080/17461391.2011.643923); deficit end Murphy & Koehler 2022, [doi:10.1111/sms.14075](https://doi.org/10.1111/sms.14075) |

Garthe 2013 is a direct test of the fast-saturation claim. 39 elite athletes, all adding **4 strength sessions a
week** for 8–12 weeks, randomised to counselled surplus (3,585 ± 601 kcal/day) or ad libitum (2,964 ± 884) — a
**~620 kcal/day difference**. Result: bodyweight +3.9 % vs +1.5 %, fat mass **+15 % vs +3 %**, and *"gain in LBM
was not different between groups"*. The authors conclude *"excess energy intake in a weight-gain protocol should
be considered carefully due to undesirable increases in body fat."*

That is exactly the lesson the nutrition lab exists to show, and the curve reproduces it: between +250 and +870
kcal/day, `energyFactor` moves 0.93 → 0.995 (6 %), so in Forge's simulation the extra 620 kcal/day lands almost
entirely in `dF`. The test asserts the end-to-end version in pounds (fat gain > 4× the lean difference).

**ASSUMPTION:** `EF_MAINT = 0.7` — the fraction of the ceiling you reach eating at maintenance — and the two
time constants (180, 600) are calibration to those endpoints, not fitted to a dose-response dataset.

---

## 6. `proteinFactor` / `proteinRetentionFactor` — protein dose-response  **UNCHANGED, SOURCED**

| | value |
|---|---|
| `proteinFactor` (growth) | 0.40 at 0.3 g/lb → 0.92 at 0.7 → **1.0 at 1.0 g/lb**, flat above |
| `proteinRetentionFactor` (deficit) | 0.28 at 0.3 → 0.70 at 0.6 → 0.98 at 1.0 → **1.0 at 1.1 g/lb** |
| Source (growth) | Morton et al. 2018, *Br J Sports Med* 52:376-384, [doi:10.1136/bjsports-2017-097608](https://doi.org/10.1136/bjsports-2017-097608) |
| Source (deficit) | Mettler, Mitchell & Tipton 2010, [doi:10.1249/MSS.0b013e3181b2ef8e](https://doi.org/10.1249/MSS.0b013e3181b2ef8e); Longland et al. 2016, [doi:10.3945/ajcn.115.119339](https://doi.org/10.3945/ajcn.115.119339); Helms et al. 2014, [doi:10.1123/ijsnem.2013-0054](https://doi.org/10.1123/ijsnem.2013-0054) |

Morton 2018, 49 RCTs / 1,863 participants, two-phase break-point analysis: *"Protein supplementation beyond
total protein intakes of 1.62 g/kg/day resulted in no further RET-induced gains in FFM"* (95 % CI 1.03–2.20
g/kg). In g/lb that is a break point at **0.74** with an upper CI of **1.00**. Forge's curve reaches ≈0.94 at
the point estimate and 1.0 at the upper CI, and pays nothing above — i.e. it sits between the break point and
the conservative upper bound, which is the right side to err on for a ceiling. Morton also found the effect is
**smaller with age** (−0.01 kg/year) and **larger in resistance-trained people** (+0.75 kg), neither of which
Forge models separately; the second means Bob is at the favourable end.

**Having two curves is correct, and the audit confirms they are each in the right context.** Sparing muscle in a
deficit demonstrably needs more protein than growing it in a surplus: Mettler 2010 found 5.3× more lean loss at
1.0 g/kg than at 2.3 g/kg over two weeks at 60 % of habitual intake, and Longland 2016 found +1.2 kg lean at
2.4 g/kg versus +0.1 kg at 1.2 g/kg in a 40 % deficit. So `proteinRetentionFactor` is correctly **below**
`proteinFactor` at every intake from 0.5 to 0.9 g/lb and plateaus later (1.1 vs 1.0 g/lb). A test asserts this
ordering, so the two can never be swapped by accident.

**ASSUMPTION:** everything below 0.55 g/lb on the growth curve is extrapolation. Morton's control arms averaged
~1.2 g/kg, so there is no trial data on trainees eating 0.3–0.5 g/lb; the 0.40 floor is a judgement call.

---

## 7. `carbFactor` — carbohydrate independent of energy  **SHRUNK**

| | value |
|---|---|
| Was | 0.95 below 100 g/day, 0.98 below 150 g |
| Now | **0.98 below 50 g/day, 0.99 below 100 g, 1.00 otherwise** |
| Source | Vargas-Molina, Gómez-Urquiza, García-Romero & Benítez-Porres 2022, *Int J Environ Res Public Health* 19:12629, [doi:10.3390/ijerph191912629](https://doi.org/10.3390/ijerph191912629) |

Asked directly: *is there real evidence carbohydrate independent of energy affects hypertrophy?* **The evidence
is thin, so the effect was shrunk.**

Vargas-Molina 2022 systematically reviewed and meta-analysed ketogenic diets — the extreme low-carbohydrate case,
< 50 g/day — in resistance-trained participants (5 studies, 111 participants, 87 male). *"We found no significant
differences between groups in the FFM variables"*, concluding ketogenic diets *"can be an alternative for
increasing muscle mass as long as energy surplus is generated"*. If even ketosis does not measurably cost
fat-free mass at matched conditions, a carbohydrate term on the hypertrophy ceiling has no direct support.

What remains is **indirect**: glycogen-depleted sessions lose reps, so less volume actually gets done. That is a
training-quality effect, not a macronutrient effect on protein synthesis. It is modelled as a 1–2 % haircut and
**labelled as an assumption in the code**. The carbohydrate advice ("150 g+ on lifting days") stays in the lab's
explanation text, where it belongs, instead of pretending to be a model term.

---

## 8. `interferenceFactor` — concurrent-training interference  **SHRUNK SUBSTANTIALLY**

| | value |
|---|---|
| Was | free to 150 effective min/week, then −4 % per 100 min, capped at −20 %; running weighted 1.6× |
| Now | free to **250** effective min/week, then **−2.5 %** per 100 min, capped at **−12 %**; running weighted **1.25×** |
| Sources | Schumann et al. 2022, *Sports Med* 52:601-612, [doi:10.1007/s40279-021-01587-7](https://doi.org/10.1007/s40279-021-01587-7); Wilson et al. 2012, *J Strength Cond Res* 26:2293-2307, [doi:10.1519/JSC.0b013e31823a3e2d](https://doi.org/10.1519/JSC.0b013e31823a3e2d) |

**Schumann 2022 is the decisive update.** 43 trials that ran an *identical* resistance programme with and without
aerobic training: **muscle hypertrophy SMD −0.01 (95 % CI −0.16 to 0.18, p = 0.919)** and maximal strength −0.06
(ns). Only **explosive** strength was attenuated (−0.28), worst when both modes were done in the same session.
Crucially, *"these results appeared to be independent of the type of aerobic training"* — cycling vs running did
not moderate anything (p > 0.05), nor did frequency, training status or age.

**Wilson 2012** is where Forge's old numbers came from: hypertrophy ES 1.23 (lifting alone) vs 0.85 (concurrent)
— a 31 % relative decrement — with decrements significant for **running but not cycling**, and correlated with
endurance **duration** (r −0.29 to −0.75) and frequency (r −0.26 to −0.35).

**How Forge reconciles them.** The duration correlation is the part both analyses can live with, and Schumann's
trials sit at low aerobic volumes (typically 2–3 × 20–40 min/week), so the honest model is *no* interference
through the range Schumann covers and a small residual only at endurance-athlete volumes. Two further reasons to
keep it small:

- **Double counting.** Cardio's energy cost is already modelled: it lowers the weekly balance, which lowers
  `energyFactor`, which lowers growth. A large interference term charges the same cardio twice.
- **Extrapolation.** A former 2:30 marathoner's weekly volume is outside every trial in both meta-analyses. A
  model that is wrong there should be wrong *small*.

**Kept with labels:** running still costs 1.25× cycling (Wilson found it, Schumann did not — the weight is
deliberately halfway, **ASSUMPTION**), and interference applies at full strength to leg groups and at half
strength to upper body (**ASSUMPTION**: mechanistically interference is local to the loaded muscle, and running
and cycling load the legs; no meta-analysis tests the split).

**Effect on Bob.** 102 easy bike min/week → 82 effective min → factor 1.00 (unchanged, it was already free). A
300 min/week running block: old model 0.868, new model 0.969. A 600 min/week block: old 0.80 (capped), new 0.88.

---

## 9. `bfSurplusFactor` — p-ratio by body fat  **UNCHANGED, RELABELLED**

| | value |
|---|---|
| Value | `clamp(1 + 0.01 × (21 − bf%), 0.88, 1.06)` — applied only in a surplus |
| Source | **direction** from Forbes 1987, *Nutr Rev* 45:225, [doi:10.1111/j.1753-4887.1987.tb02684.x](https://doi.org/10.1111/j.1753-4887.1987.tb02684.x) and Forbes 2000, *Ann N Y Acad Sci* 904:359, [doi:10.1111/j.1749-6632.2000.tb06482.x](https://doi.org/10.1111/j.1749-6632.2000.tb06482.x), restated for macroscopic changes by Hall 2007, *Br J Nutr* 97:1059, [doi:10.1017/S0007114507691946](https://doi.org/10.1017/S0007114507691946) |

Forbes' rule is **quantitative for loss** — and Forge uses it exactly there, as `p = 10.4/(10.4 + fat kg)` in the
deficit partition — but only **directional for gain**. The ±1 %-per-body-fat-point slope, the 21 % pivot and the
[0.88, 1.06] clamp are therefore **ASSUMPTION**, deliberately mild: ±6 % across the whole realistic range. The
code comment now says so. One structural note: raising the *ceiling* for leaner people is how p-ratio enters
this architecture (the ceiling is what lean gain is drawn from and the residual energy becomes fat), which is a
modelling choice, not a claim that leaner people have a higher muscle-building capacity.

---

## 10. `adaptation` — TEF and adaptive thermogenesis  **UNCHANGED, SOURCED**

| | value |
|---|---|
| Surplus | TEF 10 % + NEAT/metabolic rise 42 % of the intake change, 2-week ramp, capped at 450 kcal/day |
| Deficit | TEF 10 % + 10 % of the deficit (4-week ramp) + 10 kcal/day per lb lost, capped at 200 kcal/day, never more than the deficit |
| Sources | Levine, Eberhardt & Jensen 1999, *Science* 283:212-214, [doi:10.1126/science.283.5399.212](https://doi.org/10.1126/science.283.5399.212); Martins 2020 (AT decay, τ = 6 weeks); Hall et al. 2011 *Lancet* (γ_fat = 3.2 kcal/kg/day, weight-scaled movement) |

Levine 1999 overfed 16 non-obese volunteers by **1,000 kcal/day for 8 weeks**: total daily energy expenditure rose
**≈531 kcal/day**, two thirds of it non-exercise activity thermogenesis. Forge's `TEF_FRAC + SURPLUS_ADAPT_FRAC
= 0.52` reproduces that mean (the test asserts 450–600 kcal/day at +1,000). The between-person SD was **±257
kcal/day**, and NEAT response explained a **ten-fold** spread in fat storage (r = 0.77, p < 0.001) — which is
why the projection band is wide and why the lab's explanation says so in plain English.

**ASSUMPTION:** the 2-week ramp and the 450 kcal cap are shape choices; Levine measured one dose, not a curve.

---

## 11. Other constants carrying a number

| Constant | Value | Status |
|---|---|---|
| `KCAL_PER_LB_FAT` | 3500 | Standard first approximation (Wishnofsky). Known to be wrong at long horizons, which is why `GAMMA_FAT_KG` and weight-scaled movement are modelled (Hall 2011). |
| `KCAL_PER_LB_LEAN` / `KCAL_LEAN_RELEASED` | 1250 / 800 | Energy stored in new lean tissue (~800 kcal/lb, mostly water + protein) plus the cost of synthesising it. ASSUMPTION on the synthesis overhead. |
| `SMM_FRAC_OF_LEAN` | 0.55 | Skeletal muscle as a fraction of lean mass in men; Janssen-style. ASSUMPTION at this precision. |
| `MUSCLE_SHARE` | normalized from `SMM_SHARE_RAW_MALE` (legs/glutes ≈ 45 %, back ≈ 17 %) | After Janssen 2000-style SMM distributions. **Fixed anatomical shares** — see §13 for what that does and does not wash out. |
| `SITE_LEAN` girth coefficients | `Δin = site × 0.5 × frac × relativeGain` | The 0.5 is **exact geometry**, not a fudge: for a cylinder, area ∝ circumference², so a relative area increase `x` gives `ΔC/C = x/2`. `frac` (the muscle fraction of each cross-section: arm 0.60, thigh 0.60, chest 0.35, calf 0.55) is an ASSUMPTION. |
| `FFMI_SOFT_SPAN` = 4, `FFMI_CEIL_SD` = 1.5 | — | ASSUMPTION (§4). |
| `TA_FULL_RESP` = 0.5 | weekly whole-body response counting as a full month of training age | ASSUMPTION. Its effect: a missed or empty week does not consume "newbie gains". |
| `LOSS_BAND_PCT` = [0.5, 1.0] %BW/week | the lab's recommended band under a fat-loss goal | Top anchored on Garthe 2011 ([doi:10.1123/ijsnem.21.2.97](https://doi.org/10.1123/ijsnem.21.2.97)): 0.7 %/week kept lean, 1.0 %/week lost it. Floor is ASSUMPTION. |
| `lossRateFactor` | 1.0 at 0.7 %/week, ×1.6 at 1.0 %/week, clamp [0.5, 3] | Garthe 2011, as documented in §23. Unchanged by this audit; test added. |
| `ADH_DECAY_TAU` = 78 weeks, `ENERGY_ERR_TAU` = 26, `ENERGY_ERR_RESID` = 0.35 | band and realism | ASSUMPTION (they describe behaviour, not physiology). |

---

## 12. Per-muscle specificity: what the model now does

Verified end to end, with numbers from `project()` (see `test/muscle-specificity.test.js`):

- **Zero sets → zero growth,** under every goal. `setResponse(0) = 0`, so `cap[g] = 0` exactly.
- **Zero sets in a deficit → loses its anatomical share.** `maintenanceProtection(0) = 0`, so an untrained group
  takes its full `share[g]` of the loss while trained groups are spared. Because the loss is distributed by
  `share[g]`, every untrained group loses the same *percentage* — which is the right behaviour.
- **Maintenance volume holds.** 3 fractional sets/week turns a 12-month −5.4 % calf into roughly flat.
- **2× the sets diverges ~√2×,** which is the published shape, and the divergence compounds with time.
- **Emphasis reaches the tape and the 3D body.** Arms-only for a year at maintenance calories: arm girth up,
  thigh and calf flat. Legs-only: thigh up, arm flat.

### 13. `share[g]` is fixed — does that wash out specificity?

Asked explicitly in the audit, and the answer is **no, because the user-visible output is percentage growth.**

A group's absolute gain is `∝ share[g] × setResponse(sets[g])`, so a small muscle hammered hard gains few
pounds. But its **relative** gain is `gain[g] / (share[g] × smm0) ∝ setResponse(sets[g])` — the share cancels.
So:

- Relative growth depends **only** on that group's own sets (times whole-body factors). Specificity is clean.
- The **girth model already uses relative gain** (`relGain()` divides by `share[g] × smm0`), and so does
  `muscleAt()` for the 3D scores. The tape and the 3D body were always driven by the specific, share-free
  quantity.
- The **chart was the problem.** It showed absolute pounds, where a hammered bicep (+0.30 lb) looks like nothing
  beside an untrained-but-large back. **Fix: the projection now emits `musclePct` per group and `muscleBaseLb`,
  and the UI's new "Which muscles grow" card shows percent** — which is what Bob would notice in the mirror and
  on a tape. `muscleLb` is retained for compatibility and shown as the denominator.

What a fixed share *does* mean, honestly: Forge cannot model a user changing their anatomical proportions beyond
what proportional per-group growth implies, and the per-group ceiling allowance is the same percentage for every
group (§4). Both are consequences of one anatomical share table, and both are stated in the code.

---

## 14. Open issues this audit found but did not fix

1. **Unit vs group granularity (planner handoff).** The planner and `targets.js` plan and cap volume per
   **VOLUME_UNIT** (16 units: side delts, rear delts, front delts, chest, upper chest, back, traps, lower back,
   …), each with its own min/target/max. The projection models growth per **GROUP** (11 groups), and a group's
   set count is the *max over its regions*, not the sum of its units' counts. For single-unit groups the two
   agree exactly; for multi-unit groups the projection reads lower. Measured on a real 28-day planner output:

   | group | planner unit-sum (wk 1) | projection group-sets (wk 1) |
   |---|---|---|
   | chest | 18.0 | 12.0 |
   | shoulders | 33.25 | 26.8 |
   | back | 24.0 | 21.8 |
   | triceps / biceps / core / quads / hamstrings / calves | exact match | exact match |

   Consequences: (a) the sets-per-group number the Projection screen shows is not the number the Plan screen
   shows, which looks like an inconsistency to the user; (b) the projection cannot resolve emphasis *within* a
   group, so "more side delts, same rear delts" is invisible and the 3D `delts` score moves with the whole
   shoulder group. **Recommended fix** (needs `js/data/muscles.js`, owned elsewhere): give each VOLUME_UNIT an
   SMM share and move the growth model from 11 groups to 16 units, keeping the group rollup for display only.

2. **`TYPICAL_SHARE` uses legacy group minimums.** `GROUP_TARGET_TOTAL` and `TYPICAL_SHARE` are derived from
   `GROUPS[g].weeklySets.min` (the legacy table: shoulders 20, back 16, …), which the volume audit already found
   to be in the wrong units. They now feed only (a) the deprecated `volumeFactor()` and (b) `scheduleDay()`, the
   fallback that invents a template from `profile.schedule` when there is no plan and no history. So a user whose
   only driver is a bare weekly schedule gets volume distributed by legacy proportions rather than by their
   resolved per-unit targets — a §18 cohesion gap. **Recommended fix:** have `scheduleDay()` distribute by
   `targets.weeklyMinimums(profile)` instead (needs `js/engine/targets.js`, owned elsewhere).

3. **The partition shift still rescales every group by one factor.** `mods.partitionShift` (a supplement/therapy
   effect that moves stored mass between fat and lean) multiplies every `gG[g]` by the same `f`. That is
   *proportional*, so it preserves the per-muscle distribution and is not "wholesale ballooning"; a global
   energy-partition effect genuinely has no per-muscle structure. Left as is, and documented here so the next
   reader does not mistake it for the bug that was fixed.

4. **Age.** Bickel 2011's maintenance result and Morton 2018's protein effect both weaken with age, and Bob is
   39. `ageCeil()` applies a gentle −0.4 %/year past 35 to the growth ceiling, but the *maintenance* curve uses
   the young figure. That is the optimistic end; a 40+ adjustment would need data Bickel's two-age-group design
   cannot supply.
