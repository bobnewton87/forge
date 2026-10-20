# One body-fat scale: DXA-equivalent (CONTRACT §20b)

Bob said the 3D model looked fatter than him. PubMed research found that the body-fat number wasn't biased high. The real
problem was mixed reference scales: the Navy tape formula, RFM, Deurenberg, smart scales, calipers and the old milestone
numbers each sit on a different scale. Since 2026-10-20 every body-fat number in Forge is **DXA-equivalent**, for both
sexes. That covers the estimate, the milestones, the goal, the defended floor, the FFMI ceiling and the number the 3D model
receives. The FEMALE-3D builder recalibrates the renderer to the DXA scale. Code lives in `js/engine/bodycomp.js`
(`BF_DXA`, `oneSiteBodyFat`, `toDxaScale`, `baseline`), `js/engine/sex.js` (`BODY`, `leanModelBf`, `ffmiBand`) and
`js/engine/projection.js`.

## 1. Estimates and their offsets onto the DXA scale

| Method | Equation / source | Offset to DXA | ~1 SD (weight) | Evidence |
|---|---|---|---|---|
| **One-site Army (primary)**, men | %BF = −27.05 + 2.06·abdomen(in, navel) − 0.12·weight(lb) | 0 (−1.0 at age ≥ 40) | 3.4 | Taylor KM et al. 2024, *Obes Sci Pract* 10:e747, doi:10.1002/osp4.747. 1,259 men on GE Lunar iDXA, externally validated (753); RMSE 3.35, bias −0.39 overall, +1.02 at 40+. Independent check: Florez 2024, *Br J Nutr* 132:1143, doi:10.1017/S0007114524002216 (vs DXA ±0.1) |
| One-site Army, women | %BF = −8.06 + 1.25·abdomen(in) − 0.004·weight(lb) | 0 | 4.1 | Taylor 2024: 643 women (320 validation), RMSE 4.11, bias +0.08 (+0.25 at 40+) |
| Navy (Hodgdon), men | existing formula | **+3** | 5 | The Hodgdon-type Army/DoD equations read low vs DXA: −4.8 overall and −3.2 at 40+ (Taylor 2024); −6.0 in young recruits (Foulis SA et al. 2023, *Front Physiol* 14:1183836, doi:10.3389/fphys.2023.1183836). +3 is the conservative end. (Potter AW et al. 2022, doi:10.3389/fphys.2022.868627, often quoted here, tested an abdominal-circumference equation, not Hodgdon: −2.5 in fit Marines) |
| Navy, women | existing formula (adds hips) | **+1.7** | 5 | Taylor 2024 overall bias −1.69 (643 women; +1.5 at 40+); Foulis 2023 −6.0 in young recruits. +1.7 is Taylor's overall value |
| RFM | 64 − 20·height/waist (+12 women) | **−0.5 men / −0.9 women** | 4.2 / 4.9 | Fit to NHANES DXA; validation bias +0.5 men, +0.9 women (Woolcott OO, Bergman RN 2018, *Sci Rep* 8:10980, doi:10.1038/s41598-018-29362-1). Its waist is at the iliac crest, and it's less accurate in lean people |
| Deurenberg (BMI, age, sex) | existing formula | **0** | 6 | Fit to densitometry (Deurenberg P et al. 1991, *Br J Nutr* 65:105, doi:10.1079/bjn19910073). No sex-specific DXA bias was found; BMI equations read 1.8–3.2 *high* vs a 4-compartment model (Nickerson BS et al. 2018, *J Strength Cond Res* 32:121, doi:10.1519/JSC.0000000000001774). **The suggested +2 for men was not supported**, so the offset is 0 and the weight low |

**Blend.** Every available DXA-scale estimate is averaged by inverse variance (weights 1/SD²). With Bob's tape, the
one-site Army equation carries ~41 %, RFM ~27 %, Navy ~19 % and Deurenberg ~13 %.

**Uncertainty.** The tape formulas all share the same waist measurement, so blending them doesn't really shrink the error.
The "likely" range (~1 SD) is therefore at least **±3.5** points, widened to half the disagreement between methods when
that is larger. The 95 % range is ±2× that, so **about ±7**. A DXA entry is ±2 (between-scanner and repeat variation).

## 2. Manual entries

Measure → "Body fat (optional)" now asks what it was **measured with**. It's stored on the entry as `bodyFatMethod`, and a
blank method counts as a DXA scan.

| Method | Offset to DXA (men / women) | SD | Evidence |
|---|---|---|---|
| DXA scan | 0 / 0, used as-is (not blended) | 2 | the reference |
| Smart scale (BIA) | **+3.5 / +4.0** | 5 | 8-point BIA vs DXA in 1,250 adults: −3.59 men, −4.25 women (Balampanos 2026, *Healthcare*, doi:10.3390/healthcare14121807); consumer scales vary widely |
| Calipers | **+3.0 / +3.5** | 4.5 | Skinfold equations read low: Jackson-Pollock 7-site −4.8 vs 4C (Nickerson 2018); female judokas needed ~+2.7 to match DXA (Pineau JC et al. 2015, *J Sports Med Phys Fitness*, PMID 25678207). In very lean men skinfolds can read high (Friedl 1994) |
| Other | 0 / 0 | 5 | unknown method, low weight |

Every one of these biases is proportional (larger when lean, smaller or reversed when fat), so a fixed offset is a
simplification.

## 3. BF-dependent constants, now on the DXA scale

| Constant | Before | After | Why |
|---|---|---|---|
| Male essential / defended body fat | 5 / 6 % | 5 / 6 % (unchanged) | Already DXA-consistent: DXA lower limit 4–6 % in lean men (Friedl KE et al. 1994, *J Appl Physiol* 77:933, doi:10.1152/jappl.1994.77.2.933); a drug-free bodybuilder at 5.1 % DXA on stage (Pardue A et al. 2017, *Int J Sport Nutr Exerc Metab*, doi:10.1123/ijsnem.2017-0064) |
| Female essential / defended | 10 / 13 % | unchanged | Set from DXA data (Hulmi 2017; Halliday 2016) |
| Body-fat categories | Gallagher 2000 | unchanged | Gallagher used a 4-compartment model plus DXA (doi:10.1093/ajcn/72.3.694) |
| Default body fat when nothing is known | 20 / 28 % | unchanged | Gallagher healthy-range anchors (DXA/4C) |
| Male natural FFMI ceiling | 25 | **24.2** | Kouri HE et al. 1995, *Clin J Sport Med* 5:223, doi:10.1097/00042752-199510000-00003, used skinfold body fat (≈3 points low vs DXA in lean men), so 25 × 0.87/0.90 ≈ 24.2. This is an estimate. For comparison, *not drug-tested* college football players averaged DXA FFMI 23.7 (Trexler ET et al. 2017, *J Strength Cond Res*, doi:10.1519/JSC.0000000000001737). Kouri normalized with 6.3 × (1.8 − h); Forge keeps 6.1, a < 0.01 difference at Bob's height |
| Testosterone ceiling raise | +0 → +2.0 FFMI (1,000 → 2,400 ng/dL) | unchanged, on top of 24.2 | Relative shift |
| Male FFMI bands (Measure) | 18 / 20 / 22 / 23.5 / 25 | **17.4 / 19.3 / 21.3 / 22.7 / 24.2** | × 0.967, same conversion |
| Male FFMI milestones | 22 / 23 | **21.3 / 22.2** (ids `ffmi_22`/`ffmi_23` kept) | same conversion |
| 3D muscle score (projection) | FFMI 15 → 0, 24 → 1 | **14.2 → 0, 23.2 → 1** | −0.8 so the same body keeps the same score: Bob's tape-only score 0.55 → 0.52 |
| `estMuscle()` (ui/projection.js) | FFMI 16 → 0, 25 → 1 | **15.2 → 0, 24.2 → 1** (women 12.5 → 21.5) | same |
| Male abs milestones | 12 / 10 % | **15 / 13 %** | No study measured where abs show. The colloquial 10–14 % comes from calipers and smart scales (~3 points below DXA) |
| Female abs milestones | 20 / 16 % | **22 / 18 %** | rule of thumb, DXA scale (female caliper/BIA offsets +3.5–4) |
| Default male goal | 12 % | **15 %** | 15 % DXA-equivalent ≈ the colloquial "12 %". **A saved goal is never changed**; a saved male goal ≤ 13 % gets a note in the goal milestone with its DXA-equivalent (+3) and a pointer to Targets |
| Race-weight default | 137 lb at 6.5 % | **137 lb at 9.5 %** | Bob's remembered marathon ~6.5 % is a colloquial (caliper-scale) number; +3 on the DXA scale |
| Lean-model thresholds (`sex.leanModelBf`) | surplus pivot 18, recomp 20/12, lean-loss protection full above 10 % | **21, 23/15, 13** (men); female = defended floor + the same distances (28, 30/22, 20) | These were colloquial. Now on the DXA scale, expressed as distance above the defended floor so women get matching values (assumption) |
| Forbes partition constant | 10.4 kg | unchanged | It came from potassium-40 lean mass, not DXA (Forbes GB 1987, *Nutr Rev* 45:225, doi:10.1111/j.1753-4887.1987.tb02684.x; Hall KD 2007, *Br J Nutr* 97:1059, doi:10.1017/S0007114507691946), and no DXA recalibration exists. A 1–3 point fat shift moves p by ~0.02 |

## 4. What changed for Bob

Bob's e2e fixture (69 in, 164 lb, waist 34.5, neck 15, born 1987, tape only):

| | Before | After |
|---|---|---|
| Body fat | 18.9 % (raw Navy, ±3.5) | **23.3 % DXA-equivalent** (blend: Army 24.3, Navy 21.9, RFM 23.5, Deurenberg 21.8); likely 19.8–26.8, 95 % 16.3–30.3 |
| Lean / fat mass | 133.0 / 31.0 lb | 125.8 / 38.2 lb |
| FFMI (normalized) | 19.9 | 18.9 |
| BMR (Katch-McArdle) / maintenance | 1,673 / 2,339 kcal | 1,602 / 2,249 kcal |
| Natural ceiling | FFMI 25 (167.3 lb lean) | FFMI 24.2 (161.9 lb lean) |
| 3D muscle score | 0.55 | 0.52 |
| 12-week recomp (default plan) | lean +1.4, fat −5.7 lb | lean +1.4, fat −5.8 lb |
| 52-week | lean +5.4, fat −13.4, ends 11.3 % | lean +5.2, fat −15.7, ends 14.7 % (cut stops at the 15 % goal) |
| Goal / abs milestones | 12 % / 12 % / 10 % | 15 % / 15 % / 13 % |
| Race-weight lean benchmark | 129.1 lb | 125.0 lb |

With a manual 22 % entry and no method (the unit-test fixture), it counts as DXA: body fat stays 22 %, now ±2 instead of
±3. The constants above still change the projection (52-week fat −17.7 → −13.7 lb because the default goal is now 15 %).
