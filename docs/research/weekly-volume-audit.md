# Weekly set minimums: evidence audit

Date: 2026-10-19. Auditor: independent review (report only, no code changed).
Scope: `js/data/muscles.js`, `js/data/sculpt.js`, `js/engine/recovery.js` (target and credit math),
`js/engine/targets.js` (`weeklyMinimums`, `MINIMUMS_EVIDENCE`), `js/engine/planner.js` (`balanceVolume`,
`weekPlanSummary`), `js/store.js` (`defaultProfile`), exercise muscle weights in `js/data/exercises-*.js`.
Planner runs used the working tree as of this audit. `planner.js` was being edited at the same time, and two runs
gave slightly different top-ups. The structural findings held in both runs.

## Verdict

**No. The current minimums are not correct as "minimums".** The individual region numbers are mostly
reasonable. The group minimums come from adding up per-head region minimums, but group credit counts each set
once per group. The units do not match, so the shoulder and back minimums are inflated. They are also met by the
wrong muscles: front-delt pressing fills "shoulders" and trap credit from lateral raises fills "back". Meanwhile the
real priorities (side delts, rear delts, lats) can still fall short. Three priority mechanisms then stack on top of
each other: priority-elevated base numbers, sculpt extras and the sliders. The default minimums ask for about 98
working sets a week. That is 230 minutes against Bob's 150 scheduled lift minutes, and every lift day gets
extended. With sliders at 1.5 the minimums cannot be met at all.

## 1. How targets are computed today

- `REGIONS[r].weeklySets` holds per-head min/max values. `GROUPS[g].weeklySets` is the **sum** of its regions.
- `recovery.scaleTarget`: target = base × `groupPriority[g]` (default 1) + sculpt `extraWeeklySets`, split across
  regions.
- `recovery.sessionVolume`: group credit for a set = the **max** region weight inside that group (a set counts once
  per group). Region credit = each region's weight.
- Default profile (sculpt goals triceps_mass, shoulder_width, six_pack, lat_width, upper_chest; no sliders) resolves to:

| group | base min/max | resolved min/max |
|---|---|---|
| chest | 12 / 21 | 14.5 / 23.5 |
| back | 16 / 30 | 19 / 33 |
| shoulders | 20 / 36 | **24.5 / 40.5** (side-delt region 16) |
| biceps | 10 / 20 | 10 / 20 |
| triceps | 13 / 22 | 17 / 26 |
| forearms | 4 / 8 | 4 / 8 |
| core | 9 / 18 | 12 / 21 |
| glutes / quads / hams / calves | 6 / 8 / 4 / 3 | same |

With every priority slider at 1.5, the minimums become shoulders **34.5**, back **27**, triceps **23.5**, chest
**20.5** and core **16.5**. That is 122 group-sets for the priority groups alone. The planner extended the four lift
days to 235 minutes and still came up short on all five priority groups (score 92).

## 2. Evidence base (verified)

| Source | Finding used here |
|---|---|
| Schoenfeld, Ogborn & Krieger 2017, J Sports Sci 35:1073. PMID 27433992, doi:10.1080/02640414.2016.1210197 | Graded dose-response: about +0.37% gain per extra weekly set. 10+ sets per muscle beat <5 and 5–9 (trend, P=0.074). |
| Baz-Valle et al. 2022, J Hum Kinet 81:199. PMID 35291645, doi:10.2478/hukin-2022-0017 | Trained men (≥1 y): 12–20 sets/muscle/week is the recommended range. No benefit of >20 for quads or biceps. >20 was better for triceps. |
| Pelland et al. 2025, Sports Med 56:481. PMID 41343037, doi:10.1007/s40279-025-02344-w (SportRxiv preprint #460, v2, checked for the tables) | "Fractional" counting fits best: direct = 1, synergist = 0.5. Table 1A lists bench/incline/shoulder/machine presses as **indirect for triceps** and pulldowns/rows as **indirect for biceps**. Presses are indirect for front delts and squats are indirect only for rectus femoris (none for hamstrings). Efficiency tiers for fractional weekly sets: minimum effective dose 4; higher efficiency 5–10; intermediate 11–18; lower 19–29 (about 10.75 extra sets per detectable increment); lowest 30–42. Frequency has a negligible effect on hypertrophy once volume is accounted for. |
| Remmert, Pelland et al. 2025, SportRxiv preprint #537 (not peer reviewed) | Per-session point of undetectable superiority ≈ **11 fractional sets per muscle per session** for hypertrophy. |
| Bickel, Cross & Bamman 2011, Med Sci Sports Exerc 43:1177. PMID 21131862, doi:10.1249/MSS.0b013e318207c15d | One-third (even one-ninth) of the build dose kept the gained muscle size in young adults for 32 weeks. |
| Spiering et al. 2021, J Strength Cond Res 35:1449. PMID 33629972, doi:10.1519/JSC.0000000000003964 | Young adults kept size and strength with 1 session/week and 1 set per exercise, as long as intensity stays high. |
| Schoenfeld et al. 2016, Sports Med 46:1689. PMID 27102172, doi:10.1007/s40279-016-0543-8; Schoenfeld, Grgic & Krieger 2019, J Sports Sci 37:1286. PMID 30558493, doi:10.1080/02640414.2018.1555906 | 2x/week beats 1x when volume is not matched. When volume is matched, frequency does not matter, so it is a tool for spreading volume. |
| Mannarino et al. 2021, J Strength Cond Res 35:2677. PMID 31268995, doi:10.1519/JSC.0000000000003234 | Elbow-flexor thickness: curls +11.1% vs DB rows +5.2%. A row is worth about **half** a curl for biceps. |
| Gentil et al. 2013, Appl Physiol Nutr Metab 38:341. PMID 23537028, doi:10.1139/apnm-2012-0176 | In untrained men, pulldown + bench alone grew the elbow flexors about as much as adding curls (6.5% vs 7.0%). Compounds give real arm stimulus. |
| Kubo et al. 2019, Eur J Appl Physiol 119:1933. PMID 31230110, doi:10.1007/s00421-019-04181-y | Squats grew quads, adductors and glute max, but **not hamstrings or rectus femoris**. |

## 3. Findings

### 3.1 Per-region summing double-counts (the main error)
The studies count sets **per muscle**, such as "sets for the elbow extensors". Forge counts group credit correctly,
once per set. It then compares that credit to a **sum of head minimums**, so each head is treated as if it needed its
own sets. Whether that is harmless depends on the group:
- **Triceps / biceps / chest:** every exercise trains all heads, so summing heads is meaningless. The totals (13, 10,
  12) happen to land in a plausible range.
- **Shoulders (24.5):** this is above the 12–20 "optimal" range even as a minimum. It can also be met by front-delt
  pressing, because an Arnold or DB shoulder press counts 1.0 for "shoulders". In the current run the Friday top-up
  added "shoulders +4" as **Arnold presses**, and the week ended with side delts at **12 of 16** and rear delts at
  **2.8 of 6**. Front delts reached 17.5 against a max of 6, yet the group showed "ok".
- **Back (19):** traps and lower back are included, so Lu raises (traps 0.5) and RDLs (lower back 0.25–0.5) count
  as back sets. Of the 20 back credits in the run, only 15 came from rows or pulldowns.
- Region-level flags are noise for heads that every exercise trains. For example, triceps lateral/medial showed
  16 sets against a max of 7.9 ("over") from ordinary pushdowns.

### 3.2 Fractional credit
- Front delts get 0.5 from pressing, which matches Pelland. Overhead pressing counts as direct for front delts (1.0),
  which also matches.
- **Triceps get 0.25 from pressing; Pelland uses 0.5.** Under-credited by half.
- **Biceps get 0.25 from rows and pulldowns; Pelland uses 0.5**, which matches Mannarino's ~0.5. Under-credited by half.
- Quads get 1.0 from squats, leg press and lunges, and hamstrings get 0 from them. Both match Pelland Table 1A and
  Kubo 2019.
- Glutes get 1.0 from RDLs and split squats, which is generous. It doesn't matter at maintenance.
- Traps get 0.5 from Lu raises, upright rows and Y-raises, and that credit inflates "back" (see 3.1).
- Side delts get 0.5 from overhead presses. No study measures this. It is acceptable as a convention.

Under-crediting triceps and biceps pushes the planner to add direct arm sets the evidence says are already partly
covered. Over-crediting traps and front delts lets the wrong work satisfy the back and shoulder minimums.

### 3.3 Stacking
The priority regions already have raised base numbers (side delts 12, triceps 13, lats 8). The code's own
CONTRACT-NOTE says not to double-apply priority. Sculpt extras still add +2 to +4 per goal on top, and the sliders
then multiply the already-raised base. At slider 1.5:
- shoulders 34.5 / 58.5
- triceps 23.5 / 37
- back 27 / 48
- chest 20.5 / 34

Minimums of 23–35 sets per muscle sit in Pelland's "lower" to "lowest efficiency" tiers (about 11–12.5 extra sets
per detectable gain). Asking for that across five muscles at once is not reasonable for a natural lifter training
4 days at 30–45 minutes, with cardio and a calorie-deficit or recomp goal. Reasonable upper bounds:
- about **20 fractional sets/week** per priority muscle
- **up to 24** for fast-recovering triceps and side delts (Baz-Valle: >20 helped triceps)
- about **16** for normal muscles
- about **8** at maintenance

### 3.4 Minimum vs target
The app has only `min` (enforced) and `max`, so every minimum turns into a requirement the planner must meet,
including by extending sessions. The evidence supports a low **floor**. The minimum effective dose is about 4
fractional sets. Gains rise steeply up to about 10 and keep rising with diminishing returns to about 20. A higher
**target** belongs above that floor.

## 4. Recommended defaults

Units are fractional weekly sets, assuming synergist credit is raised to 0.5 for triceps from pressing and biceps
from rows and pulldowns. Minimums are enforced only for the muscles listed. Group totals are derived, not summed
from heads.

| group | current min | rec. min (floor) | rec. target | rec. max | rationale + citation |
|---|---|---|---|---|---|
| Chest (upper-chest bias) | 14.5 | 8 (≥4 incline) | 12 (≥6 incline) | 20 | Only the upper portion is a priority. 8–12 sets that are mostly incline give the upper pec a priority-level dose and keep pulling ≥ pushing. Schoenfeld 2017; Baz-Valle 2022. |
| Back: lats + upper back only | 19 | 10 | 14–16 | 22 | Lats are a priority. Leave traps and lower back out of the minimum. Baz-Valle 2022; Pelland 2025. |
| Side delts (enforced on their own) | 16 (region) / 24.5 group | 10 | 14 | 20 (24 if time allows) | Main lever for width. Pressing gives little side-delt work. Recovers fast. Pelland tiers. |
| Rear delts (enforced on their own) | 6 (region, not enforced) | 4 | 6–8 | 12 | Balance against pressing. Normal volume. Schoenfeld 2017. |
| Front delts | 2 (region) | 0 | none (comes from pressing) | 12 | Pressing already gives ≥6–8 fractional sets. Pelland lists presses as indirect for front delts. |
| Triceps | 17 | 10 | 14–16 | 22–24 | Priority. Pressing at 0.5 supplies 5–7 sets. Baz-Valle found >20 better for triceps. Pelland 2025. |
| Biceps | 10 | 6 | 10 | 16 | Normal priority. Rows at 0.5 supply about 6–7 sets. Mannarino 2021; Pelland 2025. |
| Forearms | 4 | 0 | 4 | 8 | Not a goal. Pulling, curls and carries cover it. Not evidence-based to enforce. |
| Core (abs) | 12 | 8 | 10–12 | 16 | Priority, but visible abs depend mostly on body fat. The app's own six_pack tip says 6–10 sets. |
| Quads | 8 | 4 | 6 | 10 | Maintenance at about one-third of a build dose. Bickel 2011; Spiering 2021. |
| Hamstrings | 4 | 3 | 4 | 8 | Maintenance and injury resilience. Squats don't count (Kubo 2019). |
| Glutes | 6 | 0 (covered by hinges and split squats) | 4 | 10 | Maintenance comes incidentally from RDLs and split squats. Bickel 2011. |
| Calves | 3 | 0 | 3 | 6 | Running background, and running continues. Maintenance only if wanted. Spiering 2021. |

The sum of the floors is about 55–60 working sets/week. At the planner's own pace of about 2.2 min/set, that fits
in Bob's 150 scheduled lift minutes. The targets come to about 70 sets (about 160 minutes).

**How the planner should treat them:**
1. **Min:** guaranteed within the scheduled minutes. If it can't fit, warn and offer "Make room". Don't extend
   automatically.
2. **Target:** filled with spare time, priority-weighted.
3. **Extend past the slot:** only when the user asks or a policy allows it, and only toward the target, never past
   the max.
4. **Per session:** keep a cap of 10 sets for big muscles and 8 for small ones. The ~11-set per-session estimate
   (Remmert 2025 preprint) supports this.
5. **Frequency:** at least 2 sessions/week for each priority muscle (Schoenfeld 2016). Beyond that, frequency is
   only a way to spread volume (Schoenfeld 2019; Pelland 2025).
6. **One priority mechanism:** sculpt goals choose exercises and may move a muscle's tier (normal to priority). The
   slider scales only the target, clamped between min and max. Sculpt goals should not add to the minimums.

## 5. Bob's default week (planRange Mon 2026-10-19, 7 days, defaultProfile, seed 42)

Schedule: Mon lift 45 (Crunch), Tue lift 30 (home), Wed cardio 30, Thu lift 45 (Crunch), Fri lift 30 (home), Sat flex 60, Sun rest.

| day | plan | minutes (slot → planned) | main group credits |
|---|---|---|---|
| Mon | back / shoulders / biceps / triceps | 45 → 55 | back 6.5, shoulders 6.8, triceps 6.5, biceps 5.3 |
| Tue | chest / shoulders / core + legs and triceps top-up | 30 → 55 | chest 8, shoulders 9, core 5, quads 4, glutes 6 |
| Wed | run 30 min intervals | 30 | n/a |
| Thu | back / biceps / triceps / forearms + top-up | 45 → 60 | back 8.5, triceps 7, forearms 5.5, biceps 4.8 |
| Fri | chest / quads / core + shoulders, back and calves top-up | 30 → 60 | chest 7, core 7, shoulders 5.5, quads 4 |
| Sat | treadmill 60 min easy | 60 | n/a |

Weekly totals (app credit): chest 15.5, back 20, shoulders 24.3, biceps 10.8, triceps 19.5, forearms 7.3, core 12,
glutes 10, quads 8, hamstrings 4, calves 4. That is **98 working sets, all minimums "met", score 98**. Cardio is
110 of 120 minutes.

**Judgement:**
- **Volume and time:** too much volume for the time available. Lift days are extended from 150 to 230 minutes
  (+53%), and sessions run 22–26 sets.
- **Per-session volume:** fine. The largest is 9 shoulder sets in one session, under the ≤10 cap.
- **Frequency:** fine. Every priority group is trained at least 2x/week.
- **Push:pull:** about **2:1 push to pull**. There are 29 press/fly sets against 15 rows/pulldowns, and rear delts
  get **2.8 sets** (region minimum 6, never warned). That is backwards for a lifter whose priorities are lats and
  side delts. No RCT sets a push:pull ratio for hypertrophy. Pull ≥ push is a practitioner heuristic for shoulder
  balance.
- **Side delts:** under (12 of 16) while the shoulder group shows "ok", because pressing filled the group.
- **Back-to-back shoulders:** Monday then Tuesday (6.8 then 9 sets). The app warns about it.
- **Legs:** maintenance is reasonable (quads 8, hamstrings 4, glutes 10, calves 4; 16 leg-exercise sets). That is
  still about 2x what Bickel and Spiering suggest is needed, and the top-up passes stuff leg sets into upper-body
  days.

Net: the week is close to a sensible program in which muscles get trained 2x. It is pushed out of shape by the
inflated shoulder and back minimums, the under-credited arms and the stacked priority extras.

## 6. Top three changes

1. **Fix the units.** Stop summing region minimums into group minimums. Enforce floors where the studies measure:
   chest, lats/upper back, side delts, rear delts, triceps, biceps, abs, quads and hamstrings. Leave traps and lower
   back out of "back", and front delts out of the side-delt check. Use the table above.
2. **Split min and target and use one priority mechanism.** The min is the evidence floor (10 priority / 6 normal /
   3–4 maintenance) and fits in the scheduled time. The target (14–16 / 10 / 4–6) is filled with spare time. There is
   a hard max of about 20 (24 for triceps and side delts). Sculpt extras and sliders should move the target, not the
   minimum. Sessions extend only with consent.
3. **Fix fractional credit to Pelland's convention.** Give triceps 0.5 from presses and biceps 0.5 from rows and
   pulldowns (currently 0.25 each). Cap trap credit from lateral and Lu raises at 0.25. Add a pull ≥ push guard. Also
   update `MINIMUMS_EVIDENCE` in `targets.js`, which cites Pelland as a SportRxiv preprint: it is now published in
   Sports Med 2025 (doi:10.1007/s40279-025-02344-w).
