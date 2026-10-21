# Forge energy & nutrition model — constants, sources, uncertainties

Audit date: **2026-10-21**. Scope: `js/data/cardio.js`, `js/engine/bodycomp.js`, `js/engine/nutrition.js`,
`js/ui/nutrition.js`, `js/ui/measure.js`. Tests: `test/energy-model.test.js` (+ amended
`test/enginea-nutrition.test.js`, `test/nutri-macros.test.js`).

Rule applied throughout: **every number is either traceable to a DOI or labelled ASSUMPTION.** Where
the evidence does not support a claim the app was making, the claim changed — not the evidence.

Sibling docs: `body-fat-dxa-scale.md` (the DXA scale), `weight-loss-lean-mass.md` (§23 partitioning),
`endogenous-testosterone.md` (hormones, incl. the Whittaker low-fat meta-analysis).

---

## 1. The spine of the model

```
BMR                     ← lean mass if body fat is known, else weight/height/age
  × (1 + NEAT factor)   ← non-exercise movement + the thermic effect of food
  + net exercise kcal   ← METs × kg × h, MINUS the resting burn during those minutes
  = TDEE (maintenance)
```

Then `intake − TDEE = energy balance`, which `projection.js` partitions into lean and fat.

Two invariants the audit checked and now tests:

1. **Exercise calories are net, never gross.** A MET value already contains 1 MET of rest, so adding
   `METs × kg × h` to a TDEE that already has BMR + NEAT in it counts the resting burn twice. Both
   `bodycomp.tdee()` and `projection.js` subtract `(BMR + NEAT)/1440 × session minutes`, and
   `projection.js` adjusts `wk.minutes` as well as `wk.kcal` when the cardio delta moves, so the
   delta is netted too. **No double-counting was found anywhere in the engine.** For Bob a 1-hour
   easy run is ~90 kcal of resting burn — left in, that is ~0.6 lb/month of phantom fat loss.
2. **Each number has one home.** Fixed this round: class METs (were a second, inconsistent intensity
   model in `bodycomp.js`), the adaptive-TDEE window (Measurements asked for 42 days, the projection
   used 28), the lean-mass BMR formula (now exported instead of retyped), the Nutrition screen's
   macro call (was going through a UI wrapper with its own copies of the protein/fat thresholds).

---

## 2. Cardio METs — the 2024 Adult Compendium

**Source.** Herrmann SD, Willis EA, Ainsworth BE et al. *2024 Adult Compendium of Physical
Activities: a third update of the energy costs of human activities.* J Sport Health Sci 2024;13:6-12.
doi:[10.1016/j.jshs.2023.10.010](https://doi.org/10.1016/j.jshs.2023.10.010). Values from
pacompendium.com; each MET in `cardio.js` cites its 5-digit Specific Activity code in a comment and
in the `mets` field, and `test/energy-model.test.js` asserts the value against a transcribed table.

Why 2024 and not 2011: 912 of 1,114 activities now carry *measured* (indirect-calorimetry) values
against 561 of 821 in 2011, 303 activities were added and 176 values revised, and data from adults
≥60 was moved into a separate Older Adult Compendium instead of dragging the adult values down.

**Units.** A standard MET is referenced to 3.5 mL O₂/kg/min ≈ **1.0 kcal/kg/h** (§2.5 of the paper),
so `METs × kg × hours` is kcal and scales linearly with bodyweight. Verified by test. The Compendium
rounds MET values to a last digit of 0, 3, 5 or 8; Forge keeps that convention.

**Uncertainty: ±20 %.** The authors are explicit that the Compendium "does not reflect precise
individual EE values" (§4.3) — measured cost differs ~8-15 % between people at the same treadmill
speed. This is the dominant error in the whole energy model and it is larger than every refinement
below, which is why EPOC is not modelled.

### What changed

| Modality | Old easy/hard | New easy/hard | Compendium code(s) | Why |
|---|---|---|---|---|
| `run` | 10 / 14 | **10.5 / 14.8** | 12145 self-selected 10.5 · 12120 10 mph 14.8 | code-anchored |
| `trail_run` | 10 / 13.5 | **9.3 / 13.5** | 12140 cross country 9.3 · hard = ASSUMPTION toward 12350 (16.0) | easy was high |
| `treadmill` | 9.5 / 13.5 | **10.0 / 13.0** | 12060 (10.5) and 12110 (13.0) less ~5 % for no air resistance | that 5 % is why 1 % incline is standard |
| `walk_incline` | 5 / 8 | **7.0 / 8.8** | 17035 6-10 % grade 7.0 · 17036 11-20 % grade 8.8 | **the big one.** "12-3-30" *is* code 17036 = 8.8; the old easy value of 5 is code 17032, a *very slow* incline walk. Under-read by ~40 % |
| `walk` | 3.5 / 5 | **3.8 / 5.5** | 17190 2.8-3.4 mph 3.8 · 17220 4.0-4.4 mph 5.5 | the old note claimed "4-5 METs" for 3.5-4 mph; measured is 4.8-5.5 |
| `bike` | 5.5 / 10 | **6.0 / 10.3** | 01220 90-100 W 6.0 · 01232 151-199 W 10.3 | code-anchored, now states the watts |
| `spin` | 7 / 11 | **7.0 / 11.0** (unchanged) | 01270 spin class **9.0** as `midCode` | already well calibrated: `moderate` returns exactly 9.0 |
| `row` | 6 / 10 | **5.0 / 11.0** | 02071 <100 W 5.0 · 02073 150-199 W 11.0 | `moderate` now returns 8.0 ≈ 02072 (7.5) |
| `elliptical` | 5 / 8 | **5.0 / 9.0** | 02048 moderate 5.0 · 02049 vigorous 9.0 | hard end was below the measured vigorous value |
| `stairmaster` | 8 / 10.5 | **8.0 / 10.5** (unchanged) | 02065 **9.3** as `midCode` | already well calibrated |
| `assault_bike` | 7 / 13 | **7.0 / 13.0** (unchanged) | **ASSUMPTION** — no air-bike code exists (02119 Airdyne is arms-only, 4.3) | anchored to 02072/02074 rowing and 01244 cycling; said out loud in the user-facing note |
| `jump_rope` | 9 / 12 | **9.0 / 12.0** (unchanged) | 02069 120 jumps/min 9.0 · hard = ASSUMPTION above 02068 (11.0) | fine |
| `swim` | 6 / 10 | **5.8 / 9.8** | 18240 slow recreational 5.8 · 18230 fast vigorous 9.8 | code-anchored |
| `hike` | 5.5 / 7.5 | **5.5 / 7.8** | 17082 (5.3)/17080 (6.0) bracket easy · 17012 daypack 7.8 | fine |
| `ruck` | 6 / 8.5 | **6.5 / 9.0** | 17045 10-20 lb on 5-10 % grade 6.5 · hard ASSUMPTION between 17050 (7.5) and 17060 (10.0) | easy was low |
| `hiit_bodyweight` | 6 / 9 | **7.0 / 11.0** | 02210 HIIT moderate 7.0 · 02214 HIIT burpees/Tabata vigorous 11.0 | **under-read by ~20 %.** 02214 describes literally the circuit in the app's own interval ideas |

### Class METs — one intensity model instead of two

`bodycomp.js` had `CLASS_METS` (a flat MET per class type) × `INTENSITY_SCALE` = `{easy 0.85,
moderate 1, hard 1.1, intervals 1.1}`. That is a 1.29× easy→hard range, while cardio modalities use
`metsEasy → metsHard` interpolation that spans 1.5-1.8×. The Compendium supports the wider spread:
elliptical moderate→vigorous is 5.0→9.0 (×1.8), HIIT moderate→vigorous 7.0→11.0 (×1.57). A "hard"
class was therefore scored as if it were barely harder than a moderate one.

Classes now live in `cardio.js` as `CLASS_CARDIO` (easy/hard pairs + codes) and go through
`classMets(type, intensity)`, which uses the same `INTENSITIES[k].factor` interpolation as cardio.
`INTENSITY_SCALE` is gone. Values: hiit 7.0/11.0 (02210/02214), cycle 7.0/11.0 (midCode 01270 = 9.0),
cardio_dance 6.5/8.0 (02310 Zumba/02006), strength 5.0/6.0 (02061/02050), sculpt 3.8/5.0
(02022/02035), core 2.8/3.8 (02024/02022), boxing 6.0/8.0 (ASSUMPTION; the only 2024 boxing-style
measurement is 02280 VR boxing at 7.9, which is not a bag class), yoga 2.3/4.0 (02175/02160),
pilates 1.8/2.8 (02103/02105 — the old flat 3.5 **over-read** Pilates), stretch 2.3/3.0 (02101),
other 5.0/6.0 (02035/02050).

### Lifting kcal — the loosest number in the model

`sessionDetail()` uses 4-6 kcal/min at 165 lb (≈3.2-4.8 METs), interpolated by set density. The
Compendium brackets resistance training at 02054 "multi-exercise weight training, 8-15 reps" **3.5**
and 02050 "free weights, machines or bodybuilding, vigorous" **6.0** — so the app sits in the lower
half of a band that is itself nearly 2× wide. **Left unchanged and flagged**: a hypertrophy session
with 2-3 min rests genuinely belongs near 02054, and the evidence does not pick a point inside the
band. This is where a measured TDEE earns its keep.

### EPOC — documented, deliberately not modelled

LaForgia J, Withers RT, Gore CJ. *Effects of exercise intensity and duration on the excess
post-exercise oxygen consumption.* J Sports Sci 2006;24:1247-64.
doi:[10.1080/02640410600552064](https://doi.org/10.1080/02640410600552064).

EPOC is **6-15 % of the net oxygen cost** of the session. A long EPOC needs ≥50 min at ≥70 % VO₂max or
≥6 min supramaximal — "exercise stimuli … unlikely to be tolerated by non-athletic individuals" — and
the review concludes that "the earlier research optimism regarding an important role for the EPOC in
weight loss is generally unfounded." 6-15 % sits inside the ±20 % error of the MET estimate itself, so
adding it would be false precision in the direction that flatters the user. Exported as
`EPOC_FRACTION` for documentation only.

---

## 3. Energy compensation — why "more cardio" is not linear

Careau V, Halsey LG, Pontzer H et al. *Energy compensation and adiposity in humans.* Curr Biol
2021;31:4659-4666. doi:[10.1016/j.cub.2021.08.016](https://doi.org/10.1016/j.cub.2021.08.016).

The largest assembled dataset of adult total and basal energy expenditure (n = 1,754, doubly labelled
water): **energy compensation averages 28 %** through reduced basal expenditure, so only ~72 % of the
extra calories burned in added activity become extra calories burned that day. Compensation is
*larger* in people with more body fat.

Modelled as `bodycomp.ENERGY_COMPENSATION = 0.28` and `compensatedKcal(deltaKcal)`.

**Where it applies, and where it must not.** Compensation is a property of *changing* habitual
activity. The training a person already does is already inside their measured BMR, their weight trend
and their body composition — so applying 0.72 to it would double-discount. Therefore:

- `tdee()` does **not** apply it (it estimates current burn at current habits). Deliberate; tested.
- `adaptiveTdee()` does **not** need it — a measured burn already contains whatever this person
  compensates.
- It belongs on the projection's **cardio delta** (`cardioDeltaMin`), which asks exactly the
  counterfactual question compensation answers. `projection.js` is owned by another agent this round;
  the recommendation is in §9.

**Bob's numbers** (164 lb, 23 % BF, desk activity, easy running):

| Easy running | Gross kcal/wk | Net of rest | TDEE effect | After 28 % compensation | Fat loss, lb/month |
|---|---|---|---|---|---|
| 60 min | 781 | 707 | +99/day | +71/day | 0.61 (vs 0.85 uncompensated) |
| 120 min | 1,562 | 1,413 | +198/day | +143/day | 1.22 (vs 1.70) |
| 240 min | 3,124 | 2,827 | +397/day | +286/day | 2.45 (vs 3.40) |
| 300 min | 3,905 | 3,533 | +496/day | +357/day | 3.06 (vs 4.25) |

So **"more cardio burns fat faster" does hold in Forge's own math across the realistic range** — it is
monotone and, inside `tdee()`, linear in minutes. The bend comes from two deductions, not from the
MET model: the resting burn the watch already counted (~10 % here) and compensation (28 %). Together
they turn a nominal 3,905 kcal/week into ~2,500 kcal/week of real deficit — about **72 % of the
headline number**. Appetite is the third and least quantified term (§8).

---

## 4. Protein

**Morton RW, Murphy KT, McKellar SR et al.** *A systematic review, meta-analysis and meta-regression
of the effect of protein supplementation on resistance training-induced gains in muscle mass and
strength in healthy adults.* Br J Sports Med 2018;52:376-84.
doi:[10.1136/bjsports-2017-097608](https://doi.org/10.1136/bjsports-2017-097608). 49 RCTs, n = 1,863.

> "Protein supplementation beyond total protein intakes of **1.62 g/kg/day** resulted in no further
> RET-induced gains in FFM."

Break-point **1.62 g/kg/day = 0.73 g/lb**; the paper's upper confidence bound is ~2.2 g/kg = **1.0
g/lb**. Note also: the effect *shrinks with age* (−0.01 kg per year) and is *larger in
resistance-trained* people (+0.75 kg) — both relevant to a 39-year-old trained lifter.

| Constant | Value | Status |
|---|---|---|
| `DEFAULT_PROTEIN.recomp` / `.lean_bulk` / `.weight_loss` | 1.0 g/lb | **Validated.** The top of Morton's CI, chosen so the target covers nearly everyone rather than the average person — *not* because more builds more |
| `DEFAULT_PROTEIN.cut` | 1.15 g/lb | **Validated**, see deficit evidence below |
| low-protein warning threshold | 0.7 g/lb | **Validated** ≈ Morton's 0.73 g/lb break point; wording now quotes both units |
| high-protein warning threshold | 1.3 g/lb | **Validated**; above even the deficit recommendations |
| unit | g per lb of **bodyweight** | **Validated** — Morton measured *total* intake per kg of body mass |

### Bodyweight vs lean mass

Morton is per kg of **bodyweight**. The deficit literature is per kg of **lean mass**: Helms ER,
Aragon AA, Fitschen PJ. *Evidence-based recommendations for natural bodybuilding contest preparation.*
J Int Soc Sports Nutr 2014;11:20. doi:[10.1186/1550-2783-11-20](https://doi.org/10.1186/1550-2783-11-20)
— "**2.3-3.1 g/kg of lean body mass** per day", 15-30 % of calories from fat, 0.5-1 %/wk of bodyweight.

At Bob's 23 % body fat the two units barely differ: 2.3-3.1 g/kg LBM = 132-178 g/day = **0.80-1.08
g/lb of bodyweight**, which brackets the app's 1.0-1.15. At 38 % body fat they diverge badly and
per-bodyweight prescribes protein for tissue that is not asking for it.

**Change made.** `macrosFor()` now accepts `leanLb` and returns `proteinGPerLbLean` /
`proteinGPerKgLean`; `dailyTargets()` passes lean mass through (the Nutrition screen already had it
from `nutritionContext`). A note appears **only above 30 % body fat for men / 40 % for women**, giving
the lean-based gram range. Bob sees nothing extra; a heavier user gets the correction.

### The deficit exception, and a claim that was wrong

Longland TM, Oikawa SY, Mitchell CJ, Devries MC, Phillips SM. *Higher compared with lower dietary
protein during an energy deficit combined with intense exercise promotes greater lean mass gain and
fat mass loss.* Am J Clin Nutr 2016;103:738-46.
doi:[10.3945/ajcn.115.119339](https://doi.org/10.3945/ajcn.115.119339). 40 % deficit, 4 weeks, 20/group:
**2.4 g/kg gained +1.2 kg lean and lost 4.8 kg fat; 1.2 g/kg gained +0.1 kg lean and lost 3.5 kg.**

The app's high-protein warning read *"Above ~1 g/lb there is no extra muscle benefit."* That is true
for a surplus and **false in a deficit** — 2.4 g/kg is 1.09 g/lb. The warning is now goal-aware:
growth goals get Morton's ceiling with its actual number; `cut` / `weight_loss` get a version that
says erring high is the right error, citing Longland and Helms. The low-protein warning under
`weight_loss` already cited Mettler 2010 correctly (1.6 kg vs 0.3 kg of lean lost in 2 weeks) and was
left alone.

### Screen vs engine

Checked as instructed. `NUTRITION_TIPS[0]` ("about 1 g per lb, a bit more when cutting") matches
`DEFAULT_PROTEIN`. Today's-target protein comes from `dailyTargets` → `macrosFor`, i.e. the engine.
**One mismatch found that is not in my files** — see §9, item 2.

---

## 5. Carb cycling

**Coherence bug, fixed.** Cycling computed `avg + SIMPLE[goal] − CYCLE[goal][dayType]`, where
`SIMPLE[goal]` is the flat-mode offset — but that is *not* the mean of the `CYCLE` offsets over a
week, so the cycled week did not average to the stated target:

| Goal | Error over a 3 lift / 1 both / 2 cardio / 1 rest week |
|---|---|
| recomp | **+36 kcal/day** above target |
| cut | **+86 kcal/day** above target |
| weight_loss | **+57 kcal/day** above target |
| lean_bulk | **−136 kcal/day** below target |

So Nutrition and the projection quietly disagreed about how much the user was eating — worst on a
lean bulk, where the surplus was a third smaller than advertised. Fixed by centring the offsets on
their own mean: `cycleMean(goal, week)`, defaulting to `REFERENCE_WEEK = { lift: 3, both: 1, cardio: 2,
rest: 1 }` (Forge's Phase-2 schedule). `dailyTargets(..., { week })` accepts the real week, and
`ui/nutrition.js` passes it from `profile.schedule`. The day-type *spread* is unchanged. Tested for
every goal; `dailyTargets` now also returns `avgCalories` and `cycleMean`.

**Claims.** Forge's only claim for cycling is now the supportable one: it changes *when* carbs are
eaten, not how many. At matched weekly calories and protein the carbohydrate/fat split has little
effect on body composition (CONTRACT §15; Helms 2014 sets calories and protein first and lets carbs
and fat fill the rest). The value is fuelling the training that drives the adaptation. No claim of a
metabolic or partitioning advantage is made anywhere.

**Bob, cycling, at 2,347 kcal maintenance:** average 2,100 · both 2,380 · lift 2,180 · cardio 1,980 ·
rest 1,780 — and those seven days now average to exactly 2,100.

---

## 6. Dietary fat — the honest answer

Two separate things, which Forge must not merge:

**(a) There is no mechanism by which fat calories are uniquely fattening.** At equal calories and
protein the carb/fat split barely moves body composition. The only measurable asymmetry runs the
*other* way and is tiny: a high-fat mixed diet has a slightly **lower** thermic effect than a
high-protein one. Westerterp KR. *Diet induced thermogenesis.* Nutr Metab (Lond) 2004;1:5.
doi:[10.1186/1743-7075-1-5](https://doi.org/10.1186/1743-7075-1-5) — a mixed diet at energy balance
costs **5-15 % of daily energy expenditure** to process, higher with protein and alcohol, "lower at a
high fat consumption". At Bob's intake the protein-vs-fat difference is worth tens of kcal a day.

**(b) There is a real floor, and it is about hormones, not fat gain.** Whittaker J, Wu K. *Low-fat
diets and testosterone in men: systematic review and meta-analysis of intervention studies.* J Steroid
Biochem Mol Biol 2021;210:105878.
doi:[10.1016/j.jsbmb.2021.105878](https://doi.org/10.1016/j.jsbmb.2021.105878) (corrigendum 2025,
doi:[10.1016/j.jsbmb.2025.106880](https://doi.org/10.1016/j.jsbmb.2025.106880)). 6 intervention
studies, n = 206: total testosterone **SMD −0.38** (95 % CI −0.75 to −0.01, p = 0.04), free
testosterone −0.37 (−0.63 to −0.11), urinary T −0.38, DHT −0.30; no significant change in LH or SHBG.
European/North-American subgroup −0.52.

Caveats that belong with the number: the trials compared roughly **20 % vs 40 %** of calories from
fat, all six were small, the upper confidence bound nearly touches zero, and the effect is a nudge
*inside* the normal range — not hypogonadism. Already recorded in
`docs/research/endogenous-testosterone.md` (line 226) as weak-to-moderate evidence; this doc
cross-references rather than duplicating it.

**Verdict on the app's <20 % warning: keep it, as a floor.** 20-35 % is the IOM AMDR; Helms 2014
allows 15-30 % for physique athletes, which is why the slider reaches 15 % without complaint.

**Changes made.** The warning now quotes the actual effect size, cites Whittaker, and ends with the
direction stated explicitly: *"eating MORE fat does not make you gain fat — only a calorie surplus
does."* There is **no high-fat warning anywhere**, and a test asserts there never is (at 45 % and 60 %
of calories from fat the warning list is empty) — because there is no evidence for one. `FAT_EVIDENCE`
exports the constants so no screen re-derives them, and a new "What the research actually says" card
on the Nutrition screen answers all three of Bob's framings from those same constants.

---

## 7. BMR, NEAT and TEF

### The equations

| Equation | Formula | Used when | Source |
|---|---|---|---|
| **Cunningham 1991** | 370 + 21.6 × FFM kg | body fat known (the normal case) | Cunningham JJ, Am J Clin Nutr 1991;54:963-9, doi:[10.1093/ajcn/54.6.963](https://doi.org/10.1093/ajcn/54.6.963) |
| **Mifflin-St Jeor** | 10 kg + 6.25 cm − 5 age + 5/−161 | height known, body fat not | Frankenfield D et al., J Am Diet Assoc 2005;105:775-89, doi:[10.1016/j.jada.2005.02.005](https://doi.org/10.1016/j.jada.2005.02.005) |
| rule of thumb | 22 kg (men) / 20 kg (women) | weight only | ASSUMPTION |

**Attribution fixed.** The app called `370 + 21.6 × FFM` "Katch-McArdle". The primary source is
**Cunningham 1991**, a synthetic review of a decade of body-composition/REE studies: fat-free mass
explains 65-90 % of the variance in REE and fat mass adds nothing independent in non-obese people —
which is exactly why this is the right equation once body fat is known. `bmrMethod: 'katch'` is kept
for API compatibility (CONTRACT §13 names it); a new `bmrEquation` field carries the correct name.
(`projection.js` line ~649 and its user-facing assumptions text repeat the wrong name — §9, item 1.)

**Is the lean-mass equation the right choice now that Forge has a DXA-equivalent body-fat number?
Yes, and the app already does it.** Frankenfield 2005 found Mifflin-St Jeor the most reliable of the
*bodyweight* equations (within 10 % of measured in more individuals than Harris-Benedict, Owen or
WHO/FAO/UNU, narrowest error range) — but that review did not test FFM-based equations at all. In lean
muscular people the FFM equations are the ones that survive: Tinsley GM, Graybeal AJ, Moore ML.
*Resting metabolic rate in muscular physique athletes.* Appl Physiol Nutr Metab 2018;44:397-406.
doi:[10.1139/apnm-2018-0412](https://doi.org/10.1139/apnm-2018-0412) — in 27 physique athletes "nearly
all existing BW- and FFM-based prediction equations … did not exhibit acceptable validity and
typically **underestimated** RMR", with Cunningham among the few judged acceptable. Their own fits:
REE = 284 + 25.9 × FFM kg, and 10 + 24.8 × BW kg.

**Known bias, now surfaced instead of hidden.** For Bob (126.3 lb lean, 57.3 kg):

| Equation | Bob's BMR |
|---|---|
| **Cunningham 1991 (what Forge uses)** | **1,607** |
| Mifflin-St Jeor | 1,650 |
| Cunningham 1980 (500 + 22 × FFM) | 1,761 |
| Tinsley 2018 FFM fit | 1,768 |
| Tinsley 2018 BW fit | 1,855 |

Forge sits at the **bottom** of the published range — the direction Tinsley warns about — so Bob's
true maintenance is plausibly **150-250 kcal/day higher** than Forge says. `bodyComp()` now returns
`bmrRange { low: 1607, high: 1855 }` and a `bmrNote` naming the bias, rather than one confident
number. **The constant was not changed**: picking a different equation shifts every downstream number
for every user and is a product decision, and `adaptiveTdee()` already exists as the correct fix.
Recommendation for the lead in §9, item 5.

### NEAT factors — validated, unchanged

`NEAT_FACTORS = { desk: 0.3, light: 0.45, active: 0.6 }`, applied as BMR × (1 + factor) **before**
exercise, which `tdee()` adds separately. So `1 + factor` is a *non-exercise* PAL: 1.30 / 1.45 / 1.60.
These land inside the IOM/DRI PAL bands (Institute of Medicine, *Dietary Reference Intakes for
Energy*, 2005: sedentary 1.0-1.39, low active 1.4-1.59, active 1.6-1.89) read as activity apart from
training — which is why they sit at the bottom of each band. Validated; tested.

### Thermic effect of food

Folded into the NEAT factor rather than modelled per macro, which the original comment ("1.2 plus
~0.1 for TEF") already reasoned correctly. Westerterp 2004 gives 5-15 % of daily expenditure for a
mixed diet at balance, ~10 % typical; exported as `TEF_FRACTION`. Per-macro modelling would move
Bob's number by roughly ±40 kcal/day — inside the BMR uncertainty above, so it would be false
precision. `projection.js` separately applies ~10 % TEF to a *surplus*, which is the right place for it.

---

## 8. Adaptive TDEE — the only real measurement

`adaptiveTdee()`: `avg intake − (trend-weight slope × 3,500 kcal/lb)`. This beats every formula
because it contains what the formulas miss — this person's actual NEAT, their own energy
compensation, the 8-15 % individual variation in the cost of their cardio, and any adaptive
thermogenesis.

| Parameter | Value | Status |
|---|---|---|
| window | **28 days** (`ADAPTIVE_WINDOW_DAYS`) | **Validated.** Long enough that ±2-3 lb of daily water/glycogen/gut-fill noise averages below the ~1 lb/week signal a 500 kcal/day error produces; short enough to track a real change. **Was inconsistent**: Measurements asked for 42 days, the projection used 28, so the two screens could show different "measured TDEE" for the same logs. Now one constant |
| minimum days | 10 of each (`ADAPTIVE_MIN_DAYS`) | Validated — returns `null` rather than a bad answer |
| confidence ladder | high ≥21 food days + ≥14 weigh-ins + 60 % coverage | Validated; reported, not hidden |
| EWMA α | 0.1/day, time-aware for gaps, seeded on the first ≤3 weigh-ins | ASSUMPTION (MacroFactor-style); reasonable — ~7-day half-life |
| trend-vs-raw switch | trend slope only after 30 days of history | Validated by construction: a fresh EWMA lags a moving weight. Tested both paths |
| `KCAL_PER_LB_TREND` | 3,500 | **First approximation, biased** — see below |
| believability guard | reject <1,000 or >7,000 kcal | Validated; returns `tdee: null` with an explanation |

**Reconciliation is correct.** Tested against synthetic data: eat 2,400 and lose exactly 0.5 lb/week →
recovers 2,650 kcal/day (= 2,400 + 0.5/7 × 3,500) to within 6 kcal, for losing, gaining and stable
weight, and it stays within 120 kcal when ±1.6 lb of alternating water noise is layered on.

**Known biases, now written into the source comment in size order:**

1. **Under-reported intake** — food logs run low and the whole error lands in the TDEE estimate. A
   measured TDEE *below* the formula usually means short logs, not a low burn.
2. **3,500 kcal/lb assumes pure fat.** Real loss carries lean mass and water, which release far less
   per pound (the projection books lean at ~800 kcal/lb). So this **overstates** the deficit and
   therefore TDEE while losing, and understates it while gaining. Worst in the first two weeks of a
   diet, when most of the scale move is glycogen and water — which is the other reason the window is
   28 days. Already noted at `lossRateDeficit()` with Hall 2008 (doi:10.1038/sj.ijo.0803720).
3. EWMA lag, handled by the 30-day switch.

---

## 9. Calorie floors, low energy availability, and Bob's own risk

| Constant | Value | Status |
|---|---|---|
| hard calorie floor | `Math.max(1000, …)` in `dailyTargets` | ASSUMPTION, sex-neutral. Below the usual clinical minima (~1,200 women / ~1,500 men) but it is a *floor on an arithmetic result*, not a recommendation; the §23 deficit warnings fire long before it |
| low energy availability | **30 kcal/kg FFM/day** | **Validated, and the app's caveat is correct** |
| adequate energy availability | 45 kcal/kg FFM/day | Validated (same trial's control arm) |

Loucks AB, Thuma JR. *Luteinizing hormone pulsatility is disrupted at a threshold of energy
availability in regularly menstruating women.* J Clin Endocrinol Metab 2003;88:297-311.
doi:[10.1210/jc.2002-020369](https://doi.org/10.1210/jc.2002-020369). **29 regularly menstruating,
habitually sedentary young women**, 5 days, energy availability set to 45 or 10/20/30 kcal/kg LBM/day.
LH pulsatility was unaffected at 30 and disrupted below it.

So: the 30 figure *is* from women, in a 5-day sedentary-subject trial, and **Forge's existing caveat
is accurate** — it already says the threshold was established in women, that no male threshold has
been validated, and that the IOC's 2023 REDs consensus (doi:10.1136/bjsports-2023-106994) documents
the syndrome in male athletes. Both the male (`goal === 'weight_loss'`) and female paths carry it.
No change needed; validated.

**Bob's own risk factors stack.** Former 2:30 marathoner (high habitual exercise expenditure, so
energy availability falls fast when intake dips) **plus** Adderall-driven appetite suppression (he
under-eats without noticing rather than by choice). That combination is why the Adderall tips are
"eat by the clock" rather than "eat to appetite", and why the model's bias directions matter: Forge's
BMR sits at the *bottom* of the published range (§7) and its cardio compensation discount is *not* yet
applied to the projection's cardio delta (§3). Both of those make Forge's maintenance estimate
conservative, which for most users is harmless and for Bob points the wrong way — he is the user most
likely to be told to eat less than he should. The honest mitigation is the measured burn: 10+ days of
food logs and weigh-ins replaces every estimate above.

---

## 10. Recommended changes in files owned by other agents

Routed rather than edited, per the brief.

1. **`projection.js` ~line 649** — `const bmrOf = L => 370 + 21.6 * (L / LB_PER_KG); // Katch-McArdle`.
   Two issues: the formula is duplicated (now exported as `bodycomp.bmrFromLean(leanLb)` — import it)
   and the attribution is wrong (**Cunningham 1991**, doi:10.1093/ajcn/54.6.963). Same wrong name
   appears in the user-facing assumptions string at ~line 1323 ("BMR by Katch-McArdle (370 + 21.6 ×
   lean kg)").

2. **`targets.js` ~line 175** — `DEF.proteinGPerLb = 1.0` is flat across goals, while the engine uses
   `DEFAULT_PROTEIN = { recomp: 1.0, lean_bulk: 1.0, cut: 1.15, weight_loss: 1.0 }`. Under a `cut`
   with no protein set, the Nutrition editor's slider shows **1.00 g/lb** while Today's target is
   computed at **1.15 g/lb** — two numbers for the same target on one screen (CONTRACT §18).
   `nutrition.js` now exports `DEFAULT_PROTEIN`; `nutritionOf()` should fall back to
   `DEFAULT_PROTEIN[goalOf(profile)] ?? 1.0`.

3. **`projection.js` — apply energy compensation to the cardio delta.** `cdKcalPerMin` (~line 593) and
   the `wk.kcal += perMin * delta` step (~line 634) pass 100 % of the added cardio burn into energy
   balance. Multiply the *delta* contribution by `1 − bodycomp.ENERGY_COMPENSATION` = **0.72**
   (Careau 2021, doi:10.1016/j.cub.2021.08.016, n = 1,754). Apply it to the delta only, never to the
   baseline plan, and keep it symmetric for negative deltas. Effect on Bob: the what-if slider for
   +240 min/week of easy running drops from ~3.4 to ~2.5 lb/month of projected fat loss. Note the
   paper's secondary finding — compensation is *larger* at higher body fat — so a body-fat-dependent
   version (e.g. 0.20 lean → 0.35 at 30 %+) is defensible later; 0.28 flat is the validated headline.

4. **`projection.js` — the "more cardio" interference threshold.** The existing model (reduce the lean
   ceiling above ~150-200 min/week, more for running) is consistent with CONTRACT §15 and was not
   re-audited here. Unchanged recommendation, flagged only so item 3 is not read as covering it.

5. **For the lead, not an agent: whether to move off Cunningham 1991.** §7 shows Forge's BMR is the
   lowest of five published equations for Bob, and Tinsley 2018 found equations "typically
   underestimated RMR" in lean muscular people. Switching to Cunningham 1980 (500 + 22 × FFM) or
   Tinsley's own fit (284 + 25.9 × FFM) would raise Bob's maintenance by ~150-160 kcal/day and shift
   every user's numbers. Not done unilaterally. `bmrRange`/`bmrNote` make the uncertainty visible now.

6. **`ui/session.js` ~lines 245 and 558, `ui/components.js` ~line 281** — these display and persist
   `estimateCalories()`, i.e. **gross** kcal, as "calories" for a block. That is defensible (it is what
   a watch shows, and `tdee()` nets it later), but the displayed figure overstates what the session
   added by ~10-15 % — ~56 kcal on a 45-min session at Bob's size. `cardio.js` now exports
   `estimateNetCalories()` for display use. The stored `b.calories` must stay gross: `sessionDetail()`
   and `projection.js` both assume it is.

7. **`ui/projection.js` ~lines 117-133** — `macros()`'s fallback re-implements the macro split with its
   own copies of the thresholds (0.7 / 1.15 / 20 % / 120 g carbs), which have already drifted from the
   engine's (1.3 and 100 g). It is unreachable while `nutrition.macrosFor` exists. `ui/nutrition.js`
   no longer goes through it; deleting the fallback belongs to that file's owner.

8. **`targets.js` ~line 225** — `estimateCalories('bike', 60, 'easy', W) / 60` converts a deficit into
   cardio minutes using **gross** kcal, so it under-prescribes the minutes needed by ~17 %. Switch to
   `estimateNetCalories`, and consider the 0.72 compensation factor too.

---

## 11. Summary of what the user sees differently

- Incline walking, bodyweight HIIT, vigorous elliptical and hard rowing now report 10-40 % more
  calories; Pilates and stretch classes report less; "hard" classes are now meaningfully harder than
  moderate ones.
- Carb-cycling days now average to exactly the stated intake.
- The high-protein warning no longer tells a dieter that extra protein is pointless.
- The low-fat warning quotes the real effect size and explicitly denies the fat→fat-gain mechanism.
- A new "What the research actually says" card answers Bob's three framings with the engine's own
  constants.
- Measurements and the projection now agree on the measured-TDEE window.
- Body composition reports a BMR *range* and the direction of its known bias.
