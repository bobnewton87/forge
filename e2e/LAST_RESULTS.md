# Forge E2E results

- Run: 2026-10-24 15:53:31 · 153s · **182 pass / 0 fail / 0 warn**
- Git: `0577bca CONTRACT §18.y and §26.4-26.7: side, cards, text numbers, toast` + 3 uncommitted file(s)
- Command: `python3 e2e/run.py` (screenshots: `/tmp/claude-1000/forge-shots/qa-*.png`)

| ID | Check | Result | Failing step | Expected | Actual | Screenshot |
|---|---|---|---|---|---|---|
| F1 | Fixture: Bob profile + measurements via Measure UI | ✅ PASS |  |  |  |  |
| F2 | Fixture: Iron Runner import via More → Import | ✅ PASS |  |  |  |  |
| S1 | Smoke: every route, fresh profile | ✅ PASS |  |  |  |  |
| S2 | Smoke: every route, Bob + Iron Runner data | ✅ PASS |  |  |  |  |
| S3 | Perf: every screen renders (sync JS) in < 1.5 s with Bob data | ✅ PASS |  |  |  |  |
| S4 | Smoke: a female profile mounts the female 3D body on Body + Projection (CONTRACT §21), no page errors | ✅ PASS |  |  |  |  |
| S5a | 3D mounts for a obese female, taped profile, no page errors | ✅ PASS |  |  |  |  |
| S5b | 3D mounts for a obese female, no tape profile, no page errors | ✅ PASS |  |  |  |  |
| S5c | 3D mounts for a obese male, taped profile, no page errors | ✅ PASS |  |  |  |  |
| S5d | 3D mounts for a obese male, no tape profile, no page errors | ✅ PASS |  |  |  |  |
| S5e | untaped obese female is sized from weight, not the median adult | ✅ PASS |  |  |  |  |
| S5g | untaped obese female keeps a plausible shoulder girdle | ✅ PASS |  |  |  |  |
| S5f | untaped obese male is sized from weight, not the median adult | ✅ PASS |  |  |  |  |
| S5h | untaped obese male keeps a plausible shoulder girdle | ✅ PASS |  |  |  |  |
| W1 | Workout @home: build → start → log → finish → summary | ✅ PASS |  |  |  |  |
| W2 | Workout @crunch: build → start → log → finish → summary | ✅ PASS |  |  |  |  |
| W3 | Workout @travel: build → start → log → finish → summary | ✅ PASS |  |  |  |  |
| W4 | Workout @office: build → start → log → finish → summary | ✅ PASS |  |  |  |  |
| P1 | Plan my week + next 4 weeks | ✅ PASS |  |  |  |  |
| P2 | Customize a day via the date builder → saved as Custom | ✅ PASS |  |  |  |  |
| K1 | Class picker opens (Today @Crunch + Plan day sheet) | ✅ PASS |  |  |  |  |
| K2 | Cardio quick log (Today → Just cardio → Log as done) | ✅ PASS |  |  |  |  |
| J1 | Projection controls respond (kcal preset, cardio step, horizon) | ✅ PASS |  |  |  |  |
| N1 | Nutrition targets save (2,650 kcal, simple mode) | ✅ PASS |  |  |  |  |
| U1 | Supplements: add creatine, then remove | ✅ PASS |  |  |  |  |
| C1a | Body: edit weekly cardio target → 225 | ✅ PASS |  |  |  |  |
| C1b | Body cardio card shows 225 target | ✅ PASS |  |  |  |  |
| C1c | Plan coverage: target 225, auto-replanned within ±15% (or shortfall explained) | ✅ PASS |  |  |  |  |
| C1d | Projection weekly cardio matches the plan (≈225 once the plan reaches it) | ✅ PASS |  |  |  |  |
| C1e | Settings shows 225 | ✅ PASS |  |  |  |  |
| C1f | Today reflects the 225 cardio need | ✅ PASS |  |  |  |  |
| C1i | Roomy week: auto re-plan puts ≈225 min cardio in the plan (±15%) | ✅ PASS |  |  |  |  |
| C1j | Roomy week: projection weekly cardio ≈225 | ✅ PASS |  |  |  |  |
| C1k | Make room → apply: a full week holds ≈225 min cardio (±15%) | ✅ PASS |  |  |  |  |
| C1l | Make room clears the shortfall prompt | ✅ PASS |  |  |  |  |
| C1m | After Make room: projection weekly cardio ≈225 | ✅ PASS |  |  |  |  |
| C1g | Plan stepper → profile 225 + auto days re-planned | ✅ PASS |  |  |  |  |
| C1h | Body shows the target set on Plan | ✅ PASS |  |  |  |  |
| C2a | Nutrition 'Today's target' = saved 2,650 | ✅ PASS |  |  |  |  |
| C2b | Projection default intake = 2,650 | ✅ PASS |  |  |  |  |
| C2c | Projection names current targets | ✅ PASS |  |  |  |  |
| C3a | Supplements impact shows water weight | ✅ PASS |  |  |  |  |
| C3b | Projection lists the stack (creatine) | ✅ PASS |  |  |  |  |
| C3c | Projection shows creatine water weight | ✅ PASS |  |  |  |  |
| C3d | With/without stack toggle changes the projection | ✅ PASS |  |  |  |  |
| C4a | Re-plan leaves Wednesdays as rest | ✅ PASS |  |  |  |  |
| C4b | Sundays planned: lift @No equipment | ✅ PASS |  |  |  |  |
| C4c | Tuesdays planned as cardio | ✅ PASS |  |  |  |  |
| C5a | Today: recommendations at every location | ✅ PASS |  |  |  |  |
| C5b | Header location pill → Today follows | ✅ PASS |  |  |  |  |
| C5c | Plan day sheet: a suggestion at every location | ✅ PASS |  |  |  |  |
| C5d | Date builder: recommendations at every location | ✅ PASS |  |  |  |  |
| C6a | Body "Lift sets" increases | ✅ PASS |  |  |  |  |
| C6b | History lists the new session | ✅ PASS |  |  |  |  |
| C6c | Recovery tiles mark trained groups "Today" | ✅ PASS |  |  |  |  |
| C6d | Plan shows today's done workout | ✅ PASS |  |  |  |  |
| C7a | Settings writes the shared target (150) | ✅ PASS |  |  |  |  |
| C7b | Body shows 150 | ✅ PASS |  |  |  |  |
| C7c | Plan coverage target 150 | ✅ PASS |  |  |  |  |
| C7d | Today shows 150 | ✅ PASS |  |  |  |  |
| C8a | What-if slider does not change saved targets | ✅ PASS |  |  |  |  |
| C8b | Apply → Nutrition shows the applied intake | ✅ PASS |  |  |  |  |
| A1a | Cloud not configured: section says so, local accounts still offered | ✅ PASS |  |  |  |  |
| A1b | One account: no account chip or TEST badge in the header | ✅ PASS |  |  |  |  |
| A1c | Test account shows a TEST badge in the header | ✅ PASS |  |  |  |  |
| A1d | Bob's data isn't visible in the test account | ✅ PASS |  |  |  |  |
| A1e | History is empty in the test account | ✅ PASS |  |  |  |  |
| A1f | TEST badge on sub-pages too | ✅ PASS |  |  |  |  |
| A1g | Back on Bob: no TEST badge, account chip shows his name | ✅ PASS |  |  |  |  |
| A1h | Bob's workouts and weigh-ins intact; the test workout isn't there | ✅ PASS |  |  |  |  |
| A1i | Bob's fg_* keys byte-identical after the round trip | ✅ PASS |  |  |  |  |
| A1j | Deleting the test account removes only its keys | ✅ PASS |  |  |  |  |
| A2a | Blank account uses the typed name, no TEST badge, chip shows it | ✅ PASS |  |  |  |  |
| A2b | More hub shows the new account | ✅ PASS |  |  |  |  |
| A2c | Delete stays disabled until the name is typed | ✅ PASS |  |  |  |  |
| A2d | Cancel leaves Bob's account alone | ✅ PASS |  |  |  |  |
| A3a | Provider buttons only for configured providers | ✅ PASS |  |  |  |  |
| A3b | Accounts shows the signed-in email and sync state | ✅ PASS |  |  |  |  |
| A3c | Bob's sessions uploaded, one row each; fg_* keys untouched | ✅ PASS |  |  |  |  |
| A3d | A new weigh-in reaches the cloud (debounced push) | ✅ PASS |  |  |  |  |
| A3e | Sign out keeps the data and revokes the session | ✅ PASS |  |  |  |  |
| A3f | Signing in with data on both sides asks: merge / upload / replace | ✅ PASS |  |  |  |  |
| A3g | Merge links the account again | ✅ PASS |  |  |  |  |
| X1a | Female: switching sex offers (not forces) female sculpt goals | ✅ PASS |  |  |  |  |
| X1b | Female: sculpt goals switched only after consent | ✅ PASS |  |  |  |  |
| X1c | Female: body — no errors, female text, no male-only text | ✅ PASS |  |  |  |  |
| X1d | Female: measure — no errors, female text, no male-only text | ✅ PASS |  |  |  |  |
| X1e | Female: nutrition — no errors, female text, no male-only text | ✅ PASS |  |  |  |  |
| X1f | Female: projection — no errors, female text, no male-only text | ✅ PASS |  |  |  |  |
| X1g | Female: supplements — no errors, female text, no male-only text | ✅ PASS |  |  |  |  |
| X1h | Female: settings — no errors, female text, no male-only text | ✅ PASS |  |  |  |  |
| X1i | Female: testosterone sheet cites the female dose-response (Huang 2014), 24-week chart | ✅ PASS |  |  |  |  |
| X1j | Female: pregnancy pauses the projection | ✅ PASS |  |  |  |  |
| T1a | Planner ranks by lean/fat and says so | ✅ PASS |  |  |  |  |
| T1b | Planner states the anti-doping position (S4.2 / S4.1 / S2.2) | ✅ PASS |  |  |  |  |
| T1c | Planner offers a combination, not just single items | ✅ PASS |  |  |  |  |
| T1d | Row shows modeled T, estradiol and a lean/fat range | ✅ PASS |  |  |  |  |
| T1e | Projection changes after adding the recommendation | ✅ PASS |  |  |  |  |
| T1f | Projection lists the added item in its stack | ✅ PASS |  |  |  |  |
| T1g | Second tap removes the whole combination | ✅ PASS |  |  |  |  |
| T1h | No page errors through the planner flow | ✅ PASS |  |  |  |  |
| T2a | Tolerability badges appear on the ranked rows | ✅ PASS |  |  |  |  |
| T2b | Enclomiphene is graded good, with the comparator named | ✅ PASS |  |  |  |  |
| T2c | The head-to-head rate shows with its denominator and comparator | ✅ PASS |  |  |  |  |
| T2d | Every percentage in the block is followed by its fraction | ✅ PASS |  |  |  |  |
| T2e | Non-significant differences are labelled as such | ✅ PASS |  |  |  |  |
| T2f | The caveats travel with the number | ✅ PASS |  |  |  |  |
| T2g | The row shows estradiol rising, not falling | ✅ PASS |  |  |  |  |
| T2h | Catalogue sheet has a Tolerability section | ✅ PASS |  |  |  |  |
| T2i | Catalogue sheet states the isomer pharmacology with numbers | ✅ PASS |  |  |  |  |
| T2j | No page errors through the tolerability flow | ✅ PASS |  |  |  |  |
| L1a | Settings offers "Lose weight", separate from "Cut" | ✅ PASS |  |  |  |  |
| L1b | Goal weight + rate saved on the profile | ✅ PASS |  |  |  |  |
| L1c | resolveTargets exposes the loss plan (one source of truth) | ✅ PASS |  |  |  |  |
| L1d | Projection shows the lean-vs-fat cost card | ✅ PASS |  |  |  |  |
| L1e | Projection card shows the rate trade-off (faster costs more lean) | ✅ PASS |  |  |  |  |
| L1f | Goal-weight milestone names the split | ✅ PASS |  |  |  |  |
| L1g | Projection cites the evidence it is using | ✅ PASS |  |  |  |  |
| L1h | Projection engine and targets agree on the deficit | ✅ PASS |  |  |  |  |
| L1i | Nutrition sizes the deficit from the goal rate | ✅ PASS |  |  |  |  |
| L1j | Nutrition replaces the bulking lesson with the weight-loss one | ✅ PASS |  |  |  |  |
| L1k | Below-floor set targets apply under this goal only | ✅ PASS |  |  |  |  |
| L1l | Choosing "minimum body mass" also drops protein (it is a preset, not a label) | ✅ PASS |  |  |  |  |
| L1o | The shared targets sheet edits goal weight, rate and muscle protection | ✅ PASS |  |  |  |  |
| L1p | Changing the rate in the sheet writes through setTargets | ✅ PASS |  |  |  |  |
| L1m | "Why these numbers?" says the floors are deliberately below the growth dose | ✅ PASS |  |  |  |  |
| L1n | Body/Plan show the goal through the shared targets strip | ✅ PASS |  |  |  |  |
| R1 | Log a past day (CONTRACT §24): Plan → past day → class → History + week coverage | ✅ PASS |  |  |  |  |
| B1 | Bug hunt: picking a class parks the workout in progress instead of orphaning it (CONTRACT §6) | ✅ PASS |  |  |  |  |
| B2 | Bug hunt: the prescription line follows + Set / − Set | ✅ PASS |  |  |  |  |
| B3-sessions-null | fg_sessions = null: every route still renders | ✅ PASS |  |  |  |  |
| B3-sessions-junk | fg_sessions = "x": every route still renders | ✅ PASS |  |  |  |  |
| B3-body-junk | fg_body = "a string": every route still renders | ✅ PASS |  |  |  |  |
| B3-meas-junk | fg_meas = {"d":1}: every route still renders | ✅ PASS |  |  |  |  |
| B3-food-junk | fg_food = [1,2,3]: every route still renders | ✅ PASS |  |  |  |  |
| B3-profile-junk | fg_profile = "Bob": every route still renders | ✅ PASS |  |  |  |  |
| B3-active-junk | fg_active = 42: every route still renders | ✅ PASS |  |  |  |  |
| B4 | Bug hunt: a session planned for a later day, finished now, lands today (CONTRACT §24) | ✅ PASS |  |  |  |  |
| N2a | Exercise kcal are net: the resting burn during the session is subtracted | ✅ PASS |  |  |  |  |
| N2b | estimateNetCalories removes exactly the one resting MET | ✅ PASS |  |  |  |  |
| N2c | Every cardio modality but the air bike cites a 2024 Compendium code | ✅ PASS |  |  |  |  |
| N2d | 2024 Compendium corrections are in place (incline walk 8.8, bodyweight HIIT 11.0) | ✅ PASS |  |  |  |  |
| N2e | BMR is attributed to Cunningham 1991 and reports its uncertainty range | ✅ PASS |  |  |  |  |
| N2f | Carb cycling is zero-sum: the week averages to the simple-mode target | ✅ PASS |  |  |  |  |
| N2g | Energy compensation is modelled at Careau 2021's 28 % | ✅ PASS |  |  |  |  |
| N2h | Nutrition answers the dietary-fat question honestly | ✅ PASS |  |  |  |  |
| N2i | Any "fat makes you fat" phrasing is immediately rebutted, never asserted | ✅ PASS |  |  |  |  |
| N2j | Nutrition states the protein plateau with its real number | ✅ PASS |  |  |  |  |
| N2k | Nutrition tempers the cardio claim with compensation | ✅ PASS |  |  |  |  |
| T3a | Supplements route still renders inside the budget with the band | ✅ PASS |  |  |  |  |
| T3b | Scenario band renders four baselines across the reference range | ✅ PASS |  |  |  |  |
| T3c | Band shows the measured hypogonadal result and the width of "normal" | ✅ PASS |  |  |  |  |
| T3d | Band marks exactly one column as closest to him, and it is the average | ✅ PASS |  |  |  |  |
| T3e | No row headlines ±0 while its own body shows positive lean | ✅ PASS |  |  |  |  |
| T3f | Headlines carry a central estimate and a range | ✅ PASS |  |  |  |  |
| T3g | Reversible causes are named with a status and a link to the fix | ✅ PASS |  |  |  |  |
| T3h | Risk factors say "plausible", not "low", and keep the assumed baseline | ✅ PASS |  |  |  |  |
| T3i | LH is explained as an instruction, not as testis size | ✅ PASS |  |  |  |  |
| T3j | A primary (high LH, low T) profile gets no column flagged as his | ✅ PASS |  |  |  |  |
| T3k | Catalogue entry carries mechanism, muscle evidence, interactions and what is unknown | ✅ PASS |  |  |  |  |
| T3l | And the honesty is still there: extrapolated, zero floor, exogenous-curve caveat | ✅ PASS |  |  |  |  |
| V1a | Plan week coverage shows the shared target | ✅ PASS |  |  |  |  |
| V1b | Why-these-numbers planned sets = Plan week coverage | ✅ PASS |  |  |  |  |
| V1c | Body shows the SAME planned sets as Plan | ✅ PASS |  |  |  |  |
| V1d | Body shows the SAME target as Plan | ✅ PASS |  |  |  |  |
| V1e | both screens print the row identically (one component, one rounding rule) | ✅ PASS |  |  |  |  |
| V1f | Body group sheet prints the same row as Plan | ✅ PASS |  |  |  |  |
| M1a | Projection shows a per-muscle growth card | ✅ PASS |  |  |  |  |
| M1b | Growth is shown as a PERCENT of each muscle, not absolute pounds | ✅ PASS |  |  |  |  |
| M1c | The card names the per-muscle ceiling ("room left") | ✅ PASS |  |  |  |  |
| M1d | Arms-only grows arms and leaves quads alone; legs-only the reverse | ✅ PASS |  |  |  |  |
| M1e | And it reaches the projected tape measurements | ✅ PASS |  |  |  |  |
| M1f | Under a muscle-gain goal the lab band is the surplus sweet spot | ✅ PASS |  |  |  |  |
| M1g | Under a fat-loss goal the band becomes a rate band, not a sweet spot | ✅ PASS |  |  |  |  |
| M1h | And it shows the deficit trade-off: rate against lean retention | ✅ PASS |  |  |  |  |
| M1i | No page errors through the per-muscle / lab flow | ✅ PASS |  |  |  |  |
| T4a | Clomiphene + AI does not outrank clomiphene alone | ✅ PASS |  |  |  |  |
| T4b | The AI on its own is still modeled as a net cost | ✅ PASS |  |  |  |  |
| T4c | The combination says one of its items adds testosterone and no muscle | ✅ PASS |  |  |  |  |
| T4d | And explains that the lean mass is credited to the SERM, not to the larger rise | ✅ PASS |  |  |  |  |
| T4e | The estradiol fat cost is still shown | ✅ PASS |  |  |  |  |
| E1 | No console/page errors during flows | ✅ PASS |  |  |  |  |

## Notes

- **S1**: 3D canvas mounted on: none (SVG fallback)
- **S2**: 3D canvas mounted on: body, projection
- **S3**: slowest: supplements 223ms, projection 26ms, measure 20ms, nutrition 13ms
- **C1a**: resolveTargets cardio = 225
- **C1f**: replan toast: Plan updated for 225 min/wk cardio. Extended Sat 60→65′, Tue 30→55′ a…
- **C1k**: proposal: Make room for 225 min of cardio A typical week of your availability holds ~65 cardio min alongside lifting (this week: ~0). These changes take it to ~225. Wed cardio 30→60′ Cardio 30′ → Cardio 60′ · …
