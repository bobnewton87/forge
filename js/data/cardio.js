// Cardio modalities (CONTRACT §4). Pure data + helpers, DOM-free.
//
// ---------------------------------------------------------------------------------------------
// ENERGY MODEL (see docs/research/energy-model.md for every constant, source and uncertainty)
// ---------------------------------------------------------------------------------------------
// METs come from the **2024 Adult Compendium of Physical Activities** (Herrmann SD et al., J Sport
// Health Sci 13:6-12, doi:10.1016/j.jshs.2023.10.010), which supersedes the 2011 Compendium: 912 of
// its 1,114 activities now carry *measured* (indirect-calorimetry) values and it was restricted to
// adults 19-59 so older-adult data no longer drags the values down. Each metsEasy/metsHard below
// cites the Compendium's 5-digit Specific Activity code it was taken from; values with no code are
// labelled ASSUMPTION. The Compendium rounds MET values to a last digit of 0, 3, 5 or 8, so the
// numbers here keep that convention.
//
// A standard MET is referenced to a resting metabolic rate of 3.5 mL O2/kg/min ≈ **1.0 kcal/kg/h**
// (Herrmann 2024, §2.5), so `METs × kg × hours` is kcal and scales linearly with bodyweight.
// Because 1 MET IS rest, that product is **GROSS** kcal: it already contains the calories you would
// have burned sitting still. `estimateCalories()` returns gross (it is what watches and machines
// report, and what gets logged on a block); `estimateNetCalories()` subtracts the 1 resting MET.
// The engine does better than a flat 1 MET: bodycomp.tdee() and projection.js subtract the person's
// own BMR + NEAT prorated over the session minutes, so exercise kcal are never double-counted
// against the resting burn that BMR already covers. Nothing in the engine adds gross kcal to a TDEE.
//
// NOT modelled, deliberately:
//  - **EPOC** ("afterburn"). It is real but small: 6-15 % of the *net* oxygen cost of the session,
//    and only a prolonged, hard stimulus (≥50 min at ≥70 % VO2max, or ≥6 min supramaximal) produces
//    a long one (LaForgia J, Withers RT, Gore CJ 2006, J Sports Sci 24:1247-64,
//    doi:10.1080/02640410600552064, which concludes that "the earlier research optimism regarding an
//    important role for the EPOC in weight loss is generally unfounded"). 6-15 % sits inside the
//    ±20 % error of the MET estimate itself, so adding it would be false precision.
//  - **Energy compensation.** Only ~72 % of extra activity calories show up as extra total daily
//    burn; the rest is offset by a fall in basal expenditure (Careau V et al. 2021, Curr Biol
//    31:4659-66, doi:10.1016/j.cub.2021.08.016, n = 1,754). That is a property of *changing* your
//    activity, not of a single session, so it belongs on the cardio delta, not here. See
//    bodycomp.ENERGY_COMPENSATION / compensatedKcal().
//
// Individual error: the Compendium's own authors warn it "does not reflect precise individual EE
// values" (Herrmann 2024, §4.3) — measured cost varies ~8-15 % between people at the same speed
// (Browning 2006, cited there). Treat every number here as ±20 %.
//
// CONTRACT-NOTE: added extra modality 'walk' (outdoor walk). INTENSITIES carries an extra
// `factor` field (0 = metsEasy, 1 = metsHard) used to interpolate METs. 'intervals' sits at
// 0.85 because work bouts exceed metsHard but recoveries pull the average down.
// CONTRACT-NOTE: cardioOptions accepts a Set, array, or location object. 'bodyweight' is always
// present, so hiit_bodyweight is available everywhere.
// CONTRACT-NOTE: each modality gains `mets` = { easyCode, hardCode } (2024 Compendium Specific
// Activity codes, or null where the value is an assumption), extra exports RESTING_METS,
// EPOC_FRACTION, CLASS_CARDIO, classMets(), estimateNetCalories(). CLASS_CARDIO replaces the
// easy/moderate/hard scaler that used to live in bodycomp.js, so classes and cardio now share ONE
// intensity model (CONTRACT §18: no screen or module keeps its own copy of a number).

// `mets` carries the 2024 Compendium Specific Activity codes behind the two values: easyCode/hardCode
// where the Compendium measures that end directly, or midCode where it publishes ONE value for the
// modality and metsEasy/metsHard bracket it so a 'moderate' effort returns exactly that number.
const C = (id, name, icon, equipment, metsEasy, metsHard, impact, legFatigue, notes, intervalIdeas, mets = null) =>
  ({ id, name, icon, equipment, metsEasy, metsHard, impact, legFatigue, notes, intervalIdeas,
    mets: { easyCode: null, hardCode: null, midCode: null, ...(mets || {}) } });

// 1 MET = resting. Subtracting it converts gross kcal to net (Herrmann 2024 §2.5).
export const RESTING_METS = 1;
// EPOC as a fraction of the NET cost of a session (LaForgia 2006). Documented, not applied.
export const EPOC_FRACTION = { low: 0.06, high: 0.15 };

export const CARDIO = {
  // 12145 Running, self-selected pace 10.5 · 12120 Running 10 mph (6 min/mile) 14.8.
  // Running cost is ~linear in speed, so an "easy" MET is really a pace claim: 9 min/mile is 10.5
  // (12060) and 8 min/mile is 11.8 (12080). Bob's conversational 7:15-8:00/mi is therefore ~11.8-12.5
  // and his 5:40-5:55 threshold is 16.8+ (12130), so these values UNDER-read for an elite runner.
  run: C('run', 'Run', '🏃', ['outdoors'], 10.5, 14.8, 'high', 0.6,
    'Your home turf. Easy runs at conversational pace (roughly 7:15-8:00/mi) support recovery and fat loss. Hard running competes with leg recovery, so keep hard days away from heavy leg sessions. Calorie estimates assume a typical pace for the effort; at your paces they read a little low.',
    [
      'Tempo: 15 min warm-up, 3 × 10 min at half-marathon effort (~5:40-5:55/mi) w/ 2 min jog, cool-down',
      'Classic 6 × 1 km at 10K effort w/ 90 s jog',
      '10 × 400 m at 5K effort w/ 200 m jog',
      'Strides: easy 30 min + 6 × 20 s fast-but-relaxed w/ full walk-back recovery',
    ], { easyCode: '12145', hardCode: '12120' }),
  // 12140 Running, cross country 9.3 · hard interpolated toward 12350 (hilly terrain, ±100 m elevation) 16.0.
  trail_run: C('trail_run', 'Trail Run', '⛰️', ['outdoors'], 9.3, 13.5, 'high', 0.7,
    'Softer surface but more eccentric load on hills, which means more quad soreness. Run by effort, not pace.',
    [
      'Hill repeats: 8 × 60-90 s uphill hard, jog down',
      'Fartlek: 40 min with 8 × 2 min surges on the uphills',
      'Steady 45-60 min at moderate effort, power-hiking the steepest climbs',
    ], { easyCode: '12140', hardCode: null }),
  // The Compendium has no separate motorised-treadmill running code: at a given speed it is the same
  // cost as overground minus the air resistance you are not pushing through (~5 %), which is exactly
  // why 1 % incline is the standard correction. Easy = 12060 (6.7 mph) 10.5 less 5 %; hard = 12110
  // (9 mph) 13.0 less 5 %, rounded to the Compendium's convention.
  treadmill: C('treadmill', 'Treadmill Run', '🏃‍♂️', ['treadmill'], 10.0, 13.0, 'high', 0.55,
    'Set 1% incline to match outdoor effort. Easy to control pace for exact interval work.',
    [
      '5 × 5 min at ~10.5 mph (5:43/mi, marathon-PR pace) w/ 2 min at 6 mph',
      'Hill ladder: at easy pace, incline 2-4-6-8-6-4-2% for 2 min each',
      '12 × 1 min at 11.5-12 mph / 1 min walk',
      'Progression run: 30 min, +0.2 mph every 5 min',
    ], { easyCode: '12060', hardCode: '12110' }),
  // 17035 Walking, no load, 6-10 % grade, moderate-to-brisk 7.0 · 17036 no load, 11-20 % grade 8.8.
  // The "12-3-30" protocol (12 % at 3.0 mph) IS code 17036 = 8.8, so the old 5/8 pair read ~40 % low
  // at the easy end: 5.0 is code 17032, a *very slow* incline walk.
  walk_incline: C('walk_incline', 'Incline Walk', '🚶', ['treadmill'], 7.0, 8.8, 'low', 0.35,
    'The "12-3-30"-style incline walk (12% / 3 mph) measures about 8.8 METs. Low impact, low fatigue Zone 2 that barely touches leg recovery. A great post-lift finisher.',
    [
      '12% incline, 3.0 mph, 20-30 min steady',
      'Pyramid: 5-10-15-10-5% incline, 4 min each at 3.3 mph',
      '6 × 2 min at 15% / 3.5 mph w/ 2 min at 5%',
    ], { easyCode: '17035', hardCode: '17036' }),
  // 17190 Walking 2.8-3.4 mph, moderate, firm surface 3.8 · 17220 Walking 4.0-4.4 mph, very brisk 5.5.
  walk: C('walk', 'Walk', '🚶‍♂️', ['outdoors'], 3.8, 5.5, 'low', 0.15,
    'Recovery and daily steps. 3 mph is about 3.8 METs and 4 mph about 5.5. Counts toward cardio minutes and never hurts lifting recovery.',
    [
      '30-45 min brisk walk after a meal (helps blood sugar)',
      'Walk with 5 × 1 min very brisk / 2 min normal',
    ], { easyCode: '17190', hardCode: '17220' }),
  // 01220 Stationary cycling, 90-100 W, moderate-to-vigorous 6.0 · 01232 151-199 W, vigorous 10.3.
  bike: C('bike', 'Stationary Bike', '🚴', ['bike'], 6.0, 10.3, 'low', 0.4,
    'Concentric-only, so it causes almost no soreness. The best cardio to pair with lifting days. Easy ≈ 90-100 W, hard ≈ 150-200 W.',
    [
      '5 × 4 min hard (RPE 8) / 3 min easy',
      '30/30s: 2 sets of 10 × 30 s hard / 30 s easy',
      '40 min steady Zone 2 at cadence 85-95',
    ], { easyCode: '01220', hardCode: '01232' }),
  // 01270 Stationary RPM/Spin bike class 9.0 is the single measured value; 7.0/11.0 brackets it so a
  // 'moderate' class returns exactly 9.0. Hard end checked against 01305 (bike HIIT) 8.8.
  spin: C('spin', 'Spin / Indoor Cycling', '🚲', ['bike'], 7.0, 11.0, 'low', 0.5,
    'Class-style cycling with climbs and sprints. A measured spin class averages about 9 METs. Self-guided if no class fits your schedule.',
    [
      'Climbs: 4 × 5 min heavy resistance seated at 60-70 rpm, 2 min spin out',
      'Sprints: 10 × 20 s all-out out of the saddle / 40 s easy',
      'Tabata block: 8 × 20 s / 10 s, twice, 4 min between',
    ], { easyCode: null, hardCode: null, midCode: '01270' }),
  // 02071 Stationary rowing < 100 W, moderate 5.0 · 02073 150-199 W, vigorous 11.0 (02074, 200 W+, is
  // 14.0). A 'moderate' row therefore returns 8.0, close to 02072 (100-149 W) at 7.5.
  row: C('row', 'Rower', '🚣', ['rower'], 5.0, 11.0, 'low', 0.35,
    'Full body: legs about 60%, back and arms the rest. Count it as light back work, and drive with the legs, not the arms. Avoid right before heavy back sessions.',
    [
      '8 × 500 m at 2K pace w/ 1:30 easy',
      '4 × 1000 m at hard steady effort w/ 2 min rest',
      'Pyramid: 1-2-3-4-3-2-1 min hard w/ equal easy',
      '30 min steady at 20-22 spm, focus on long powerful strokes',
    ], { easyCode: '02071', hardCode: '02073' }),
  // 02048 Elliptical trainer, moderate 5.0 · 02049 Elliptical trainer, vigorous 9.0. The old hard
  // value of 8 sat below the measured vigorous figure.
  elliptical: C('elliptical', 'Elliptical', '🌀', ['elliptical'], 5.0, 9.0, 'low', 0.35,
    'Running motion with no impact. Good for running-specific aerobic work when legs are sore from lifting.',
    [
      '6 × 3 min high resistance / 2 min easy',
      '20 × 30 s fast cadence / 30 s easy',
      '30-45 min Zone 2 steady',
    ], { easyCode: '02048', hardCode: '02049' }),
  // 02065 Stair treadmill ergometer (stair-climber), general 9.3 is the only measured value; 8.0/10.5
  // brackets it so 'moderate' returns 9.25 ≈ 9.3.
  stairmaster: C('stairmaster', 'StairMaster', '🪜', ['stairmaster'], 8.0, 10.5, 'low', 0.6,
    'Very glute/quad heavy and surprisingly hard — about 9.3 METs measured. Avoid the day before heavy legs. Don\'t lean on the rails.',
    [
      '20 min steady at a level you can hold without rails',
      '10 × 1 min fast / 1 min slow',
      'Skip-a-step intervals: 5 × 2 min taking two steps at a time / 2 min normal',
    ], { easyCode: null, hardCode: null, midCode: '02065' }),
  // ASSUMPTION: the 2024 Compendium has no air/fan-bike code (02119 Airdyne is arms-only, 4.3). These
  // are anchored to the equivalent whole-body efforts it does measure: easy ≈ 02072 rowing 100-149 W
  // (7.5), hard ≈ 02074 rowing 200 W+ (14.0) / 01244 cycling 270-305 W (13.8).
  assault_bike: C('assault_bike', 'Assault / Air Bike', '🌪️', ['assault_bike'], 7.0, 13.0, 'low', 0.5,
    'Arms and legs together. The harder you push, the more resistance. Brutal for short intervals and low-skill, so it\'s safe to go all-out. Calorie estimates here are extrapolated from rowing and cycling: the Compendium has never measured an air bike.',
    [
      '10 × 15 s all-out / 45 s easy',
      'Every minute on the minute (EMOM) 12 min: 12-15 calories',
      '5 × 1 min hard / 2 min easy',
    ], { easyCode: null, hardCode: null }),
  // 02069 Jumping rope, 120 jumps/min 9.0 · 02068 Rope skipping, general 11.0. Hard end extrapolated
  // slightly above 'general' for double-unders (ASSUMPTION on the 12.0).
  jump_rope: C('jump_rope', 'Jump Rope', '🪢', ['jump_rope'], 9.0, 12.0, 'high', 0.4,
    'Calf and coordination heavy. Great travel conditioning if you pack a rope.',
    [
      '10 × 1 min skipping / 30 s rest',
      'Alternate 30 s double-unders (or fast singles) / 30 s easy bounce for 10 min',
      '3 × 3 min "rounds" w/ 1 min rest',
    ], { easyCode: '02069', hardCode: null }),
  // 18240 Swimming laps, freestyle, slow, recreational 5.8 · 18230 freestyle laps, fast, vigorous 9.8.
  swim: C('swim', 'Swim', '🏊', ['pool'], 5.8, 9.8, 'low', 0.1,
    'Zero impact and minimal leg fatigue. Shoulder-heavy, so avoid stacking it on a hard shoulder day. Calorie estimates vary hugely with technique.',
    [
      '10 × 50 m hard w/ 20 s rest',
      '4 × 200 m steady w/ 30 s rest',
      'Pyramid 50-100-150-200-150-100-50 m',
    ], { easyCode: '18240', hardCode: '18230' }),
  // 17082 Hiking, normal pace through fields and hillsides, no load 5.3 and 17080 hiking cross
  // country 6.0 bracket the easy end · 17012 backpacking/hiking with a daypack 7.8 is the hard end.
  hike: C('hike', 'Hike', '🥾', ['outdoors'], 5.5, 7.8, 'low', 0.4,
    'Long, low-intensity time on feet. Big calorie burn with little recovery cost unless very hilly.',
    [
      'Push the uphills to RPE 7, recover on flats/downs',
      '60-120 min steady at conversational effort',
    ], { easyCode: '17082', hardCode: '17012' }),
  // 17045 Walking, 10-20 lb load, 5-10 % grade, moderate 6.5 · 17060 Walking, 20+ lb load, 5-20 %
  // grade, moderate-to-brisk 10.0 (17050, 21-40 lb on a 3-10 % grade, is 7.5). Hard set to 9.0 as an
  // interpolation because a "fast flat ruck" is less costly than the Compendium's loaded-hill code.
  ruck: C('ruck', 'Ruck', '🎒', ['outdoors'], 6.5, 9.0, 'low', 0.45,
    'Walk with a weighted pack (20-35 lb). Builds traps, core and back endurance with little joint stress. Start light.',
    [
      '45 min at 15 min/mi with 20-25 lb',
      'Hill ruck: 6 × 3 min uphill brisk, easy down',
      '30 min fast ruck (sub-14 min/mi) as conditioning',
    ], { easyCode: '17045', hardCode: null }),
  // 02210 High-intensity interval exercise, moderate 7.0 · 02214 HIIT with burpees, mountain
  // climbers, squat jumps or Tabata, vigorous 11.0 — which is literally the circuit described below.
  // The old 6/9 pair under-read measured bodyweight HIIT by about 20 %.
  hiit_bodyweight: C('hiit_bodyweight', 'Bodyweight HIIT', '🔥', ['bodyweight'], 7.0, 11.0, 'high', 0.4,
    'No equipment needed: burpees, squat jumps, mountain climbers, high knees, shadow boxing. Good for hotel rooms or the office.',
    [
      'Tabata: 4 moves × 8 rounds of 20 s on / 10 s off (burpees, mountain climbers, jump squats, high knees)',
      'EMOM 15: min 1 = 10 burpees, min 2 = 20 mountain climbers, min 3 = 15 squat jumps',
      'Circuit × 4: 40 s work / 20 s rest of burpee, skater jumps, plank jacks, high knees, rest 1 min',
    ], { easyCode: '02210', hardCode: '02214' }),
};

export const INTENSITIES = {
  easy: { name: 'Easy / Zone 2', rpe: '3-4', factor: 0, description: 'Conversational. You could talk in full sentences. Builds aerobic base with minimal recovery cost.' },
  moderate: { name: 'Moderate / Steady', rpe: '5-6', factor: 0.5, description: 'Comfortably hard. Short sentences only. Marathon-pace feel.' },
  hard: { name: 'Hard / Tempo', rpe: '7-8', factor: 1, description: 'Sustained hard effort (threshold). A few words at a time.' },
  intervals: { name: 'Intervals', rpe: '8-9', factor: 0.85, description: 'Hard repeats with recoveries. High stimulus, higher recovery cost.' },
};

// Class types (Crunch and similar), on the SAME easy/hard + INTENSITIES.factor model as CARDIO, so
// there is one intensity model in the app rather than a separate ±10 % scaler (CONTRACT §18).
// 2024 Adult Compendium codes; where a type spans several codes the pair brackets the measured ones.
export const CLASS_CARDIO = {
  // 02210 HIIT moderate 7.0 · 02214 HIIT burpees/Tabata vigorous 11.0
  hiit: { metsEasy: 7.0, metsHard: 11.0, easyCode: '02210', hardCode: '02214' },
  // 01270 RPM/Spin bike class 9.0 is the measured value; 7.0/11.0 brackets it so a 'moderate' class
  // returns exactly 9.0 (checked against 01305 bike HIIT 8.8 and 01232 151-199 W 10.3).
  cycle: { metsEasy: 7.0, metsHard: 11.0, easyCode: null, hardCode: null, midCode: '01270' },
  // 02310 Zumba, group class 6.5 · 02006 high-impact aerobic dance, vigorous 8.0
  cardio_dance: { metsEasy: 6.5, metsHard: 8.0, easyCode: '02310', hardCode: '02006' },
  // 02061 Health club classes, gym and weights combined 5.0 · 02050 free weights/machines, vigorous 6.0
  strength: { metsEasy: 5.0, metsHard: 6.0, easyCode: '02061', hardCode: '02050' },
  // 02022 Calisthenics, moderate 3.8 · 02035 Circuit training, moderate 5.0
  sculpt: { metsEasy: 3.8, metsHard: 5.0, easyCode: '02022', hardCode: '02035' },
  // 02024 Calisthenics, light (curl-ups, crunches, plank) 2.8 · 02022 moderate 3.8
  core: { metsEasy: 2.8, metsHard: 3.8, easyCode: '02024', hardCode: '02022' },
  // ASSUMPTION. The only boxing-style measurement in 2024 Conditioning is 02280 (VR boxing/flow,
  // vigorous) at 7.9, which is not a bag/pad class; 6.0/8.0 brackets it.
  boxing: { metsEasy: 6.0, metsHard: 8.0, easyCode: null, hardCode: null, midCode: null },
  // 02175 Yoga, general 2.3 · 02160 Power yoga 4.0 (02155 hot yoga 3.0 sits between)
  yoga: { metsEasy: 2.3, metsHard: 4.0, easyCode: '02175', hardCode: '02160' },
  // 02103 Pilates, traditional mat 1.8 · 02105 Pilates, general 2.8. The old flat 3.5 over-read this.
  pilates: { metsEasy: 1.8, metsHard: 2.8, easyCode: '02103', hardCode: '02105' },
  // 02101 Stretching, mild 2.3 · hard end interpolated toward 02030 (calisthenics light/moderate,
  // floor up-and-down) 3.5 (ASSUMPTION).
  stretch: { metsEasy: 2.3, metsHard: 3.0, easyCode: '02101', hardCode: null },
  // Unknown class type: 02035 Circuit training, moderate 5.0 · 02050 free weights, vigorous 6.0
  // (02060 Health club exercise, general, is 5.5 and sits between them).
  other: { metsEasy: 5.0, metsHard: 6.0, easyCode: '02035', hardCode: '02050' },
};

// equipmentSet: Set | array | location object → [modality objects] available there.
export function cardioOptions(equipmentSet) {
  const src = new Set(equipmentSet instanceof Set ? equipmentSet
    : Array.isArray(equipmentSet) ? equipmentSet : (equipmentSet && equipmentSet.equipment) || []);
  src.add('bodyweight');
  return Object.values(CARDIO).filter(c => c.equipment.every(e => src.has(e)));
}

// Interpolate between metsEasy and metsHard by the intensity's factor. ONE formula, used for both
// cardio modalities (metsFor) and classes (classMets).
function interp(easy, hard, intensity) {
  const f = (INTENSITIES[intensity] || INTENSITIES.moderate).factor;
  return easy + (hard - easy) * f;
}

export function metsFor(modalityId, intensity = 'moderate') {
  const c = CARDIO[modalityId];
  if (!c) return 0;
  return interp(c.metsEasy, c.metsHard, intensity);
}

// METs for a class type at a given intensity (same model as metsFor). Unknown type → 'other'.
export function classMets(type, intensity = 'moderate') {
  const c = CLASS_CARDIO[type] || CLASS_CARDIO.other;
  return interp(c.metsEasy, c.metsHard, intensity);
}

// GROSS kcal: METs × kg × hours (1 MET ≈ 1 kcal/kg/h; Herrmann 2024). Includes the resting burn you
// would have had anyway, which is what a watch or a cardio machine reports and what gets logged on a
// block. Returns a whole number of kcal (0 for unknown modality). Typical error ±20 %.
export function estimateCalories(modalityId, minutes, intensity = 'moderate', bodyweightLb = 165) {
  const mets = metsFor(modalityId, intensity);
  const lb = Number(bodyweightLb) > 0 ? Number(bodyweightLb) : 165;
  const min = Number(minutes) > 0 ? Number(minutes) : 0;
  return Math.round(mets * (lb / 2.20462) * (min / 60));
}

// NET kcal: the same estimate with the 1 resting MET removed, i.e. the calories the session ADDED
// over doing nothing. Use this anywhere a number is added to a daily total or compared with a
// calorie target. bodycomp.tdee() and projection.js instead subtract the person's own BMR + NEAT
// prorated over the session minutes, which is finer (their resting rate is rarely exactly 1 MET) —
// this helper is for display and for callers that do not have a BMR to hand. Never negative.
export function estimateNetCalories(modalityId, minutes, intensity = 'moderate', bodyweightLb = 165) {
  const mets = metsFor(modalityId, intensity);
  if (!(mets > 0)) return 0;
  const lb = Number(bodyweightLb) > 0 ? Number(bodyweightLb) : 165;
  const min = Number(minutes) > 0 ? Number(minutes) : 0;
  return Math.round(Math.max(0, mets - RESTING_METS) * (lb / 2.20462) * (min / 60));
}
