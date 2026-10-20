# Cohesion audit: targets (INTEGRATOR, 2026-10-20)

Single source of truth now: `js/engine/targets.js` (`resolveTargets`, `applyTargetChange`) and `js/ui/targets.js` (`setTargets`, `openTargetsSheet`, `targetsSummaryHTML`).

| Target / assumption | Stored in | Before: shown / edited / used | Disconnect found | Now |
|---|---|---|---|---|
| Cardio min/week | `profile.cardioTargetMin` | Settings slider (0–300), Plan stepper (0–600, toast "re-plan yourself"), Body card (read-only, rolling 7 d), Today header, recovery.cardioStatus, planner | Planner planned about 110 min at any target from 120 to 300 (finishers fixed at 10/15). Three editors with three ranges and no re-plan. Body used a rolling 7 days, Plan used the calendar week. | One API (0–900). Body card (stepper + 90/150/225/300 chips, done/planned/target this week), Plan stepper, Settings slider and the sheet all call `setTargets`, which re-plans auto days. The planner's `balanceCardio` grows finishers up to `finisherCap`. When the target can't fit, a shortfall warning says how much your availability can hold. |
| Cardio modality / hard sessions | none (hard-coded: 1 quality session, fixed pref lists) | planner only | No user control | `profile.cardio = { modalities, hardPerWeek }`, edited in the sheet and honoured by the planner |
| Projection cardio what-if | `kv('projection').cdelta/cmod/cint` | Projection only | It's a delta on top of the plan, so it is never saved as a target | Hand-off: preview, then "Apply" calls `setTargets({cardio:{minPerWeek}})` |
| Today finisher minutes | `kv('builder').cardio.minutes` (default 10) | Today builder | Ignored the weekly deficit | `suggestFinisher` sizes it to the deficit. Today shows a nudge with "Add N′". |
| Schedule / availability | `profile.schedule` | Plan availability sheet | OK | Saved through `setTargets` (keeps its re-plan prompt). Capacity is shown in the sheet, strip and warnings. |
| Default minutes / style | `profile.defaultMinutes/defaultStyle` | Settings, Today builder fallback | The planner ignored `defaultStyle` | Settings and the sheet use `setTargets`. Planner lift days use the style. |
| Calories / surplus / protein / fat / mode | `profile.nutrition` | Nutrition editor, projection "Apply", Settings mode seg; defaults in projection `whatIfDefaults` | Two writers, defaults owned by the projection UI | Nutrition reads `resolveTargets().nutrition` and writes via `setTargets`. Projection still writes directly (hand-off). |
| Nutrition phases | none | none | Missing | `profile.nutrition.phases` validated by `applyTargetChange`. Engine adoption is up to LONG-HORIZON. |
| Adherence | `kv('projection').adherence` | Projection slider only | Lived only in projection UI state | `profile.adherence` (default 0.85), edited in Settings and the sheet. Hand-off for the projection. |
| Goal / goal BF | `profile.goal`, `profile.body.goalBodyFat` | Settings goal seg; projection reads goalBodyFat but nothing edits it | Goal BF was not editable | Both are in the sheet and go through `setTargets` |
| Sculpt goals / group priority | `profile.sculptGoals/groupPriority` | Settings (direct writes), generator/planner | Changes didn't re-plan | Through `setTargets`, which re-plans |
| Stack | `profile.supplements` | Supplements screen, projection `activeStack` | Duplicate "active" logic | `resolveTargets().stack` (read-only) |

Stale-cache check: Today's `B` (builder) is intentionally your last choice, so it isn't a target. Plan `weekOff`/`classSched` and Nutrition's `override`/`basisPick` are UI state. No screen caches a target value at module level.
