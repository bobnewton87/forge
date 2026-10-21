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

## 7. Addendum (2026-10-20): weekly maxes and stars

Bob asked where the stars and weekly maxes come from, and whether the biceps max of 16 was too low.

**Where the maxes came from.** The §4 table set the max by priority tier: about 20 for priority muscles, **16 for
"normal" muscles** (biceps, and core even though it is a priority), 12 for rear delts, upper chest, front delts and
traps, and 6–10 for the maintenance legs and forearms. That mixes two different things. The max is meant to be the
point past which more sets stop paying off, which is a property of the muscle, not of Bob's priorities. Priority
already moves the target. §6 item 2 above already said "a hard max of about 20 (24 for triceps and side delts)"; the
table did not follow it.

**What the studies say for biceps** (all counts are weekly sets):
- Baz-Valle et al. 2022, J Hum Kinet 81:199 (doi:10.2478/hukin-2022-0017): in trained men, 12–20 sets is the
  recommended range. Going above 20 gave **no extra biceps growth** (p = 0.59) and no extra quad growth (p = 0.19),
  but did give extra triceps growth (p = 0.01).
- Heaselgrave et al. 2019, Int J Sports Physiol Perform 14:360 (doi:10.1123/ijspp.2018-0427): 9, 18 or 27 sets of
  biceps work in trained men gave muscle-thickness gains of 4.3%, **9.5%** and 5.4%. The differences were not
  significant, and 27 sets were no better than 18.
- Schoenfeld et al. 2019, Med Sci Sports Exerc 51:94 (doi:10.1249/MSS.0000000000001764): elbow flexors grew more with
  higher volume, using only pulldowns and rows. That is about 15 sets in fractional terms.
- Pelland et al. 2025, Sports Med 56:481 (doi:10.1007/s40279-025-02344-w): growth keeps rising with volume, but
  each extra set adds less, and the "lower efficiency" tier starts at about 19 fractional sets.

So 20 is the supported ceiling for biceps, and 16 cut off part of the optimal range.

**New maxes** (fractional sets; `VOLUME_UNITS[*].max`, with reasons in `MAX_WHY`, shown in "Why these numbers?"):

| muscle | old max | new max | why |
|---|---|---|---|
| Biceps | 16 | **20** | Top of the 12–20 range; more than 20 added nothing (Baz-Valle 2022), and 27 was no better than 18 (Heaselgrave 2019). |
| Core | 16 | **20** | Default ceiling. Core is a priority, so the old 16 was inconsistent even under the tier rule. |
| Rear delts | 12 | **20** | Default ceiling. |
| Upper chest (sub) | 12 | **20** | Same muscle as chest; the chest max of 20 still caps the total. |
| Quads / hamstrings / glutes / calves | 10 / 8 / 10 / 6 | **20** | Default ceiling (quads: more than 20 added nothing, Baz-Valle 2022). Maintenance is set by the target (6 / 4 / 4 / 3), and the planner keeps planned sets at most 1 above target. |
| Forearms | 8 | **20** | Curls and hammer curls credit forearms, so a cap of 8 blocked arm work. |
| Front delts (tracked) | 12 | **20** | Every press adds 0.5, so a cap of 12 blocked chest pressing (a recurring reason chest fell short). |
| Traps (tracked) | 12 | **20** | Default ceiling. |
| Triceps / side delts / back / chest | 24 / 24 / 22 / 20 | unchanged | Triceps: more than 20 sets helped (Baz-Valle 2022). Side delts: small, fast-recovering muscle (convention). Back: lats and upper back are two muscles in one count. |
| Lower back (tracked) | 10 | unchanged | Fatigue guard, not a growth limit (heuristic). |

The priority sliders now run from 0.5× to **2×**, so a normal muscle can reach its max (biceps 10 × 2 = 20). Each
slider shows the resulting target and max.

**Stars.** The screens used different rules. Plan starred the hard-coded tier `priority`. Body starred any group
touched by a sculpt goal or a slider above 1×. Biceps with a raised slider was starred on Body but not on Plan. Now
there is one rule, `targets.starredUnits` / `starredGroups`, used by Plan, Body, Settings and "Why these numbers?".
A muscle is starred when it is one of Bob's stated priorities (triceps, side delts, abs, lats/back, upper
chest/chest) and its slider hasn't been turned down, OR its slider is above 1×, OR a sculpt goal adds sets to it.
Tracked-only muscles never star.

**Effect on plans** (default profile, 18 test weeks): the default week is unchanged (same targets, +64–67 min).
Biceps ×2 now plans 20/20 (was held at 16). Legs ×2 plans quads 12/12 (was held at 10), and core ×1.5 plans 20/19.5
(was held at 16). Nothing goes past its max. Small overshoots above target (≤ 2.5 sets, each with a named reason) went
from 5 to 8 of 18 weeks, because rows, face pulls and presses are no longer held back by the old rear-delt and
front-delt caps.

## 8. Addendum (2026-10-21): cross-screen cohesion, set-count semantics, and an evidence re-check

Bob: *"the workout goals and the amounts that we're supposed to do, and the maximums like we have — make sure all
that's tight, and that the number of sets across all the different pages in the software is tied together"* and
*"we don't have different variables for things across different parts of the website."*

### 8.1 What "one set" means (now written down)

- **A working set counts; a warm-up never does.** Warm-ups are not stored as sets at all, so the question is
  settled by the data model, but the counting rule is now in one function, `recovery.blockSets`: a logged set
  counts when `done && r > 0`. A **planned** day counts its prescription (`target.sets`), because a plan has
  nothing logged yet.
- **"Hard sets" is the literature's unit.** The convention Forge follows is the number of sets taken to failure or
  near it — Baz-Valle, Fontes-Villalba & Santos-Concejero 2021, J Strength Cond Res 35:870,
  doi:10.1519/JSC.0000000000002776 ("the total number of sets to failure, or near to, seems to be an adequate
  method to quantify training volume"). This citation was missing from §2 and is the single best source for the
  app's set-count semantics. No paper says "exclude warm-ups" in those words; it follows from the definition.
- **Near failure, not failure.** The 2026 ACSM position stand (Currier et al., Med Sci Sports Exerc 58:851,
  doi:10.1249/MSS.0000000000003897) states that training to momentary failure "does not enhance" gains and that
  2–3 reps in reserve is sufficient effort; Robinson et al. 2024, Sports Med 54:2209, doi:10.1007/s40279-024-02069-2
  finds hypertrophy improves as sets end closer to failure while strength is flat across RIR. So the operational
  definition is **0–3 RIR**, which is what the app's rep targets already aim at.
- **Fractional credit, once per unit.** Direct 1.0, synergist 0.5 (Pelland et al. 2025, verified row by row), and a
  set credits an enforcement unit once, at the largest weight over that unit's regions.

### 8.2 The cohesion audit: what diverged

Eight places computed a volume number locally instead of reading the shared one. All eight are fixed; see §8.3.

| # | Where | What it showed | What it should have shown |
|---|---|---|---|
| D1 | Body "Weekly sets vs target" | rolling 7 days, logged only | the calendar week, logged + planned — the Plan tab's number. Mid-week the two differed by 2× (back 7.8 vs 18.8 against the same target of 18); on the Tuesday after a full week Plan said 0 while Body said 11. |
| D2 | `GROUPS[g].volume.max` → `recovery.groupStatus` → Today, Body, Settings, `targets.weeklyMinimums`, `weekPlanSummary.groups` | back max **52**, shoulders max **64** (the tracked units' ceilings were added in) | back 22, shoulders 44. With a max of 52 the group-level "over the weekly max" warning and `needScore`'s over-target penalty could never fire for back or shoulders. |
| D3 | `recovery.groupStatus().sets7d` vs its own `target` | sets counted **once per group**, target **summed the units** | the same muscles on both sides. For one lived week Today's tile read "Shoulders 30/26" while Body read "Shoulders 17/25". |
| D4 | sculpt extras at group level | summed over **all** the group's regions, including tracked ones | only over regions that feed a target (shoulders 25.5 vs the unit sum 25). |
| D5 | `today.sessionGroups` (Today's day card, Plan's day cards and day sheet) | **summed** the region weights inside a group | the shared per-group credit. A real 23-set session displayed "Triceps 16.5 · Shoulders 12 · Biceps 12" against true credits of 7.5 / 9 / 6. |
| D6 | three unit counters (`planner.sessionUnits`, `body.unitSets7d`, `recovery.sessionVolume`) + `history.summarize` | four implementations of "how many sets" | one (`recovery.sessionVolume` / `unitVolume` / `unitSets`). |
| D7 | rounding | Plan `14/15`, Body card `14.8/15`, Body detail and live session `14.8/14.5` | one formatter, `targets.fmtSets`. |
| D8 | `recovery.js` and the §23 volume floors | region and group targets ignored the floor mode | the same scaling `unitTargets` applies, so a "maintenance floors" profile can't show the full target on Today and a third of it on Plan. |

Sculpt goals also leaked extra sets: the split was normalised over **all** a goal's regions, and any share landing on
a tracked unit (front delts, traps, lower back) was clamped away. "Traps / Yoke" delivered 0.57 of its 2 promised
sets; "Capped Delts" 2.43 of 3; "Back Thickness" 2.1 of 3; "Upper Chest" 2.5 of 3. The split is now normalised over
the regions that actually feed a target, so the whole amount lands somewhere. This moved two default numbers:
**chest target 14.5 → 15** and **upper-chest sub-target 8.5 → 9**.

### 8.3 One source of truth, after the fix

```
muscles.js        VOLUME_UNITS (base min/target/max) · COUNTED_UNITS[group] · unitCredits(ex) (memoized)
   │                 GROUPS[g].volume = sum over COUNTED units only   GROUPS[g].weeklySets = untouched legacy shape
   ▼
targets.js        unitTargets(profile)   ← the ONE resolver: target = clamp(base × slider + sculpt extras, [min, max])
                  groupTargets(profile)  = sum over COUNTED_UNITS[g] of unitTargets   (weeklyMinimums is a view of it)
                  starredUnits / starredGroups · maxNote · fmtSets · volumeFactors · sculptExtraByRegion
   ▼
recovery.js       sessionVolume(s, {planned}) → { regions, groups, units, liftSets, cardioMin, push, pull }
                  blockSets · unitVolume · unitSets(sessions, {from,to,today,includePlanned})
                  groupStatus / muscleStatus: targets come from unitTargets, group sets from COUNTED units
   ▼
planner.js        weekUnitTotals → recovery.unitSets · weekPlanSummary.units · explainWeek
   ▼
UI                Plan week coverage · Body group cards + group sheet · Today tiles + day cards · Settings sliders ·
                  live session "Your week now" · "Why these numbers?"   — none of them does volume maths of its own
```

`recovery.js` now imports `targets.js` while `targets.js` imports `sessionVolume` from `recovery.js`. The cycle is
deliberate (the resolver resolves, the counter counts) and safe because neither side calls the other during module
evaluation; `test/volume-cohesion.test.js` pins five entry orders, including `generator.js`, which is what forced
`targets.STYLES` to become a re-exported live binding rather than a spread of a `const`.

### 8.4 Planner reasons: the "per-session caps" artefact was real

Bob had seen *"per-session caps on every lift day"* given as the binding reason suspiciously often. It was partly an
artefact of how a day's reason was chosen:

- `note()` treated `'time'` as the weakest reason, so any later, worse candidate that happened to hit a cap
  overwrote "this day is simply out of minutes". A week of fixed-length days reported `session` 13 times and
  `policy` 4; it now reports `policy` 23 and `session` 0.
- A 2-lift-day week whose days both ran to the 90′ cap reported `session` for chest, back and side delts. It now
  reports `time`, which is the constraint the user can actually lift.
- A week with **no lift day at all** reported `session` ("per-session caps on every lift day") for every muscle.
  There is now a `nolift` reason.
- A successful dry-run probe was labelled `session`; it is now `rounds` ("room is left: re-plan the week to fill it").

Reasons are now chosen in an order where each one is true of the day: this muscle is at its own per-session cap →
`session`; the day is at its time limit, or a candidate was legal and only did not fit → `time`; otherwise the first
real blocker. `session` is only reported for the week when a per-session cap is in the way on **every** lift day and
this muscle is at its own cap on at least one; the partial case is `session_other` ("the exercises that would add it
are at another muscle's per-session cap"). `test/volume-cohesion.test.js` checks the claim against the plan.

### 8.5 Evidence re-check (2026-10-21)

Every §2 citation was re-verified against the primary source. The numbers survive; several labels did not.

**Corrections to §2 of this document:**
- The **Pelland 2025** citation "Sports Med 56:481" is **correct** (accepted Oct 2025, e-pub Dec 2025, vol. 56 is the
  2026 print volume). The §6 instruction to stop calling it a preprint stands.
- **Baz-Valle 2022 counted volume with the TOTAL method** (every set = 1, synergists included), not fractionally. Its
  own conclusion is that "12–20 weekly sets of **direct** triceps brachii work may be optimum". In Forge's fractional
  units, Baz-Valle therefore supports ~12–20 for triceps, **not >20**. Its triceps finding also rests on a single
  study (Brigatto 2019 a/b, n=27).
- **Schoenfeld 2017** is overstated here: the 3-level comparison (<5 / 5–9 / 10+) was **a trend, P=0.074**, not a
  finding. It is the weakest leg of the 10-set floors.
- **Pelland 2025 reports no plateau**: explanation (iii) for its null frequency effect is "there is no plateau in
  hypertrophy with increasing per session volumes". The model shows shrinking returns out to ~42 sets, never a wall.
  Its frequency result is also only negligible *for hypertrophy* — it is 100% posterior positive for strength.
- **The Schoenfeld 2016 / 2019 frequency attributions are swapped** in §2: 2016 found 2×/week > 1×/week on a
  volume-equated basis; 2019 (25 studies) is the one finding no difference once volume is matched.
- **Mannarino 2021** is **10 untrained men**, 8 weeks, within-subject. It corroborates the 0.5 synergist weight;
  Pelland is the citation that carries it.
- **Bickel 2011 and Spiering 2021 are not independent**: Spiering is a narrative review whose muscle-size claim rests
  largely on Bickel, whose subjects were untrained at baseline.
- **Remmert #537 is still an unreviewed preprint** (doi:10.51224/SRXIV.537); Pelland 2025 cites it as one. Do not
  "update" it the way §6 said to update Pelland.

**New sources that belong in §2:**

| Source | What it adds |
|---|---|
| ACSM position stand 2026: Currier et al., Med Sci Sports Exerc 58:851, PMID 41843416, doi:10.1249/MSS.0000000000003897 | 137 systematic reviews. Hypertrophy: "**≥10 sets/wk (dose-response)**" — the first authoritative-body endorsement of the 10-set figure, and a far better citation for the floors than a P=0.074 trend. Narrative: the dose-response "plateaued and showed diminishing returns beyond … **~18–20 weekly sets** for hypertrophy". Failure is not required; 2–3 RIR suffices. |
| Baz-Valle, Fontes-Villalba & Santos-Concejero 2021, J Strength Cond Res 35:870, PMID 30063555, doi:10.1519/JSC.0000000000002776 | The canonical citation for counting **hard sets to or near failure** as the unit of volume. Was missing. |
| Larsen et al. 2025, Front Physiol 16:1611468, PMID 40692697, doi:10.3389/fphys.2025.1611468 | 24 trained lifters, 8 weeks, **exactly 10 weekly sets** of lateral raises → lateral deltoid +3.3–4.6%. The only direct support anywhere for the side-delt floor of 10. One volume arm, so no dose-response. |
| Robinson et al. 2024, Sports Med 54:2209, PMID 38970765, doi:10.1007/s40279-024-02069-2 | Proximity-to-failure dose-response: hypertrophy rises as sets end closer to failure; strength flat across RIR. |
| Camargo et al. 2025, Eur J Appl Physiol 125:3065, PMID 40883636, doi:10.1007/s00421-025-05959-z | Whether a saturation point exists is **unresolved**; recent trained-subject studies conflict. Declines to name a ceiling. |
| Calzavara & Barroso 2026, J Strength Cond Res, PMID 42709978, doi:10.1519/JSC.0000000000005665 | The only **peer-reviewed** per-session test: 18 trained men, 9 weekly quad sets in one session vs three. Quad thickness rose with no group × time interaction (VL P=0.215). Volume load was 58–76% higher when spread — which is the real argument for spreading, not a growth ceiling. |
| Boutagy & McKean 2026, SportRxiv #1100 (preprint) | Re-analysis of Pelland's own dataset: weekly volume at fixed frequency +0.170 per ln(sets) (95% CI 0.076–0.263); dividing a fixed weekly volume over more sessions −0.043 (95% CI −0.161 to 0.074), a null. |
| "Exploring the Upper Limits of RT Volume in Trained Athletes", J Sci Sport Exerc 2026, doi:10.1007/s42978-026-00387-7 | 27 strength-trained men, a 7-week phase at 1.5× weekly sets: no extra hypertrophy or strength. |

**Verdicts (fractional weekly sets). Nothing new justifies raising any max; the pressure is downward.**

| Number | Verdict |
|---|---|
| default max **20** | **KEEP.** The best-supported number in the file: ACSM 2026 (~18–20), Baz-Valle (12–20), Heaselgrave (18 ≈ 27), Pelland (lower-efficiency tier from ~19) all converge. |
| triceps max **24** | **KEEP, relabelled as convention.** `MAX_WHY.triceps` misstated its source and has been rewritten: Baz-Valle counted total sets and recommends 12–20 **direct**; the ">20 helped triceps" result is one study. 24 fractional is a defensible allowance for a priority, fast-recovering muscle that gets much of its volume indirectly. Dropping it to 20 and letting the target carry the priority is the defensible alternative; not taken, because it would cut Bob's current triceps ceiling with no new evidence against it. |
| side delts max **24** | **KEEP, relabelled.** `MAX_WHY.delt_side` now says plainly that Pelland's tables contain **no lateral-deltoid row at all**, so no study has ever varied side-delt volume, and cites Larsen 2025 for the floor of 10. "Same as triceps" is gone — that was convention leaning on convention. |
| back max **22** | **KEEP, relabelled as convention.** "Two muscles in one count" is a units argument, not evidence, but it is internally coherent and conservative: a row credits the unit 1.0, so 22 unit-sets is less work than 20 + 20 per muscle. |
| lower back max **10** | **KEEP.** Already a labelled heuristic on a tracked-only unit. |
| floors: back / triceps **10** | **KEEP, better cited** (ACSM 2026 "≥10 sets/wk") and **relabelled**: 10 is the bottom of the effective range, not a minimum effective dose. Pelland's MED is **4**. |
| floor: side delts **10** | **KEEP — now with a real citation** (Larsen 2025). |
| floor: rear delts **4** | **KEEP.** Matches Pelland's MED exactly; the best-justified floor in the file. |
| floors: chest 8 / upper chest 4 / core 8 | **KEEP, relabelled as convention.** No upper-chest and **no abdominal** volume dose-response literature exists; §4's source for core 8 was the app's own tip, which is circular. |
| floors: biceps 6, quads 4, hamstrings 3, glutes/calves/forearms 0 | **KEEP.** All sit in Pelland's higher-efficiency band (5–10) or at maintenance, and Kubo justifies not crediting squats to hamstrings. |
| base targets (chest 12, back 15, side delts 14, triceps 15, …) | **KEEP.** All inside Pelland's intermediate band (11–18) and under ACSM's ~18–20 flattening. Upper chest 6 and core 11 are convention. |
| per-session caps **8 / 10 / 12** and ~12 group-sets | **KEEP as convention, evidence claim downgraded.** §4 item 4 cited the Remmert preprint as support; it is unreviewed, Pelland explicitly reports no per-session plateau, a 2026 re-analysis of Pelland's own data finds session division a null, and the only peer-reviewed test found no penalty for cramming. The caps remain as a fatigue / time / set-quality heuristic — Calzavara's 58–76% higher volume load when volume is spread is the honest argument for them. The specific 8 / 10 / 12 split has no source. |
| semantics: hard sets only, direct 1.0 / synergist 0.5, credit each unit once | **KEEP.** Pelland Table 1 verified row by row; the missing citation for the hard-set convention has been added. |

**One practical consequence worth acting on later.** Because 10 is the bottom of the effective range and not a
biological floor, a week that cannot fit the floors in its scheduled minutes has a cheap, well-supported option this
app does not yet offer: cut the **non-priority** floors toward Pelland's 4–6 rather than lengthening every session.
By Pelland's own curve, moving a normal muscle from 10 to 5 costs roughly one detectable increment. That belongs in
the "Make room" options, as a volume choice beside the time choices.

### 8.6 Addendum (2026-10-21, second pass): two more shared targets, and what is still open

The same bug class, found by the nutrition audit and routed here, in `js/engine/targets.js`:

| # | Where | What it showed | Fix |
|---|---|---|---|
| D9 | `DEF.proteinGPerLb = 1.0`, flat across goals, while `js/engine/nutrition.js` defaults `{cut: 1.15}` | under a cut with no protein set, the Nutrition editor's slider read **1.00** while Today's target was computed from **1.15 g/lb** — two numbers for one target, on one screen (170 lb: 170 g vs 195 g) | `targets.defaultProteinGPerLb(profile)` resolves per goal and reads `nutrition.DEFAULT_PROTEIN` when that export lands, with a pinned copy of the same table until then. `test/volume-cohesion.test.js` compares the resolver against `nutrition.dailyTargets` for all four goals, and fails if the two tables ever drift. |
| D10 | the deficit → cardio-minutes conversion used **gross** kcal | `cardio.estimateCalories` is METs × kg × hours, which includes the resting burn you would have spent anyway. Dividing a deficit by a gross rate under-prescribes the minutes: easy cycling is 5.5 METs, so only 4.5/5.5 of the burn is new energy. Bob's 595 kcal/day gap asked for **590 min/week** when the honest figure is **720** (+22%). | `targets.netKcalPerMin(modality, intensity, weightLb)`, exported. Net = gross × (METs − 1)/METs — exact *within the same model that produced the gross number*, with the MET read back through `estimateCalories` rather than duplicated, so no second metabolic model exists to drift. |

**Deliberately not applied: Careau et al. 2021's ~0.72 exercise-compensation factor** (Curr Biol 31:4659, doi:10.1016/j.cub.2021.08.016 — people offset roughly a quarter of exercise energy with lower resting expenditure). It belongs in this calculation on the merits, but the projection applies it to the cardio delta on its side, and applying it in both places would compound it into a ~0.52 factor. One owner should hold it. The code says so at the call site so nobody adds it twice.

**Still open, in other owners' files** (reported, not edited):

- **`js/classes/classify.js` → `groupCredits(muscles)` SUMS the region credits inside a group**, which is divergence D5 all over again in the CLASSES owner's module. The class picker tells Bob what a class is worth; the week counts it once per group from the same `classify.muscles`. Measured at 45 min:

  | class | picker says | the week counts |
  |---|---|---|
  | Body Pump | back **3.5**, chest 2.5, shoulders 2, triceps 1.5, biceps 1.5 | back **1.5**, chest 2, shoulders 1, triceps 1, biceps 0.75 |
  | Total Body Conditioning | shoulders **3.5**, triceps **3**, back 3, core 3 | shoulders 2, triceps 1.5, back 1.5, core 2 |
  | Barre | glutes **3.5**, quads 2.5 | glutes 2, quads 1.5 |
  | Pilates | core **4.5**, glutes 2.5 | core 3, glutes 1.5 |
  | Zumba, Ride | (agree) | (agree — one region per group) |

  The fix is one line: take the **max** over the group's regions instead of the sum, as `recovery.sessionVolume` does. Classes whose maps touch one region per group are unaffected, which is why this went unnoticed.
- **`js/ui/retro.js` → `lineSummary()`** keeps a fourth private copy of the working-set count (`done && r > 0`). It agrees with `recovery.blockSets` today, so it is a duplication risk rather than a live bug; it should call `blockSets`.
- **`js/classes/classify.js`**: in this branch every class name falls through to the `other` rule (no muscle credit, cardio only), which is also what the failing `data/crunch-schedule.json has the contract shape` test reports. Pre-existing on master, not caused by this work.
