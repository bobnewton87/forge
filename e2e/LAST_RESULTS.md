# Forge E2E results

- Run: 2026-10-19 21:26:32 · 58s · **53 pass / 0 fail / 1 warn**
- Git: `d2cf9d1 Ignore __pycache__` + 3 uncommitted file(s)
- Command: `python3 e2e/run.py` (screenshots: `/tmp/claude-1000/forge-shots/qa-*.png`)

| ID | Check | Result | Failing step | Expected | Actual | Screenshot |
|---|---|---|---|---|---|---|
| F1 | Fixture: Bob profile + measurements via Measure UI | ✅ PASS |  |  |  |  |
| F2 | Fixture: Iron Runner import via More → Import | ✅ PASS |  |  |  |  |
| S1 | Smoke: every route, fresh profile | ✅ PASS |  |  |  |  |
| S2 | Smoke: every route, Bob + Iron Runner data | ✅ PASS |  |  |  |  |
| S3 | Perf: every screen renders (sync JS) in < 1.5 s with Bob data | ✅ PASS |  |  |  |  |
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
| C1d | Projection weekly cardio ≈225 | ⚠️ WARN | Projection cardio line | 180–270 min/wk raw or ÷ adherence (WARN = matches a plan that explains its shortfall) | 135 min/wk shown (÷ 85% adherence = 159); stat 119; 4-wk plan avg 135 × 85% = 115 | `/tmp/claude-1000/forge-shots/qa-C1d.png` |
| C1e | Settings shows 225 | ✅ PASS |  |  |  |  |
| C1f | Today reflects the 225 cardio need | ✅ PASS |  |  |  |  |
| C1i | Roomy week: auto re-plan puts ≈225 min cardio in the plan (±15%) | ✅ PASS |  |  |  |  |
| C1j | Roomy week: projection weekly cardio ≈225 | ✅ PASS |  |  |  |  |
| C1k | Make room → apply: this week ≈225 min cardio (±15%) | ✅ PASS |  |  |  |  |
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
| E1 | No console/page errors during flows | ✅ PASS |  |  |  |  |

## Notes

- **S1**: 3D canvas mounted on: none (SVG fallback)
- **S2**: 3D canvas mounted on: body, projection
- **S3**: slowest: projection 43ms, nutrition 35ms, measure 34ms, body 18ms
- **C1a**: resolveTargets cardio = 225
- **C1f**: replan toast: Plan updated for 225 min/wk cardio. This week fits ~121 cardio min; t…
- **C1k**: proposal: Make room for 225 min of cardio A typical week of your availability holds ~115 cardio min alongside lifting (this week: ~121). These changes take it to ~220. Wed cardio 30→60′ Cardio 30′ → Cardio 60′…
