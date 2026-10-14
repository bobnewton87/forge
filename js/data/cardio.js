// Cardio modalities (CONTRACT §4). Pure data + helpers, DOM-free.
//
// METs are ballpark values from the Compendium of Physical Activities, chosen for a fit
// ~165 lb male. metsEasy ≈ conversational / Zone 2. metsHard ≈ sustained hard effort (tempo).
// Calories = METs × kg × hours (gross, includes resting burn). Estimates are typically ±20%.
//
// CONTRACT-NOTE: added extra modality 'walk' (outdoor walk). INTENSITIES carries an extra
// `factor` field (0 = metsEasy, 1 = metsHard) used to interpolate METs. 'intervals' sits at
// 0.85 because work bouts exceed metsHard but recoveries pull the average down.
// CONTRACT-NOTE: cardioOptions accepts a Set, array, or location object. 'bodyweight' is always
// present, so hiit_bodyweight is available everywhere.

const C = (id, name, icon, equipment, metsEasy, metsHard, impact, legFatigue, notes, intervalIdeas) =>
  ({ id, name, icon, equipment, metsEasy, metsHard, impact, legFatigue, notes, intervalIdeas });

export const CARDIO = {
  run: C('run', 'Run', '🏃', ['outdoors'], 10, 14, 'high', 0.6,
    'Your home turf. Easy runs at conversational pace (roughly 7:15-8:00/mi) support recovery and fat loss. Hard running competes with leg recovery, so keep hard days away from heavy leg sessions.',
    [
      'Tempo: 15 min warm-up, 3 × 10 min at half-marathon effort (~5:40-5:55/mi) w/ 2 min jog, cool-down',
      'Classic 6 × 1 km at 10K effort w/ 90 s jog',
      '10 × 400 m at 5K effort w/ 200 m jog',
      'Strides: easy 30 min + 6 × 20 s fast-but-relaxed w/ full walk-back recovery',
    ]),
  trail_run: C('trail_run', 'Trail Run', '⛰️', ['outdoors'], 10, 13.5, 'high', 0.7,
    'Softer surface but more eccentric load on hills, which means more quad soreness. Run by effort, not pace.',
    [
      'Hill repeats: 8 × 60-90 s uphill hard, jog down',
      'Fartlek: 40 min with 8 × 2 min surges on the uphills',
      'Steady 45-60 min at moderate effort, power-hiking the steepest climbs',
    ]),
  treadmill: C('treadmill', 'Treadmill Run', '🏃‍♂️', ['treadmill'], 9.5, 13.5, 'high', 0.55,
    'Set 1% incline to match outdoor effort. Easy to control pace for exact interval work.',
    [
      '5 × 5 min at ~10.5 mph (5:43/mi, marathon-PR pace) w/ 2 min at 6 mph',
      'Hill ladder: at easy pace, incline 2-4-6-8-6-4-2% for 2 min each',
      '12 × 1 min at 11.5-12 mph / 1 min walk',
      'Progression run: 30 min, +0.2 mph every 5 min',
    ]),
  walk_incline: C('walk_incline', 'Incline Walk', '🚶', ['treadmill'], 5, 8, 'low', 0.35,
    'The "12-3-30"-style incline walk (12% / 3 mph). Low impact, low fatigue Zone 2 that barely touches leg recovery. A great post-lift finisher.',
    [
      '12% incline, 3.0 mph, 20-30 min steady',
      'Pyramid: 5-10-15-10-5% incline, 4 min each at 3.3 mph',
      '6 × 2 min at 15% / 3.5 mph w/ 2 min at 5%',
    ]),
  walk: C('walk', 'Walk', '🚶‍♂️', ['outdoors'], 3.5, 5, 'low', 0.15,
    'Recovery and daily steps. Brisk walking at 3.5-4 mph is about 4-5 METs. Counts toward cardio minutes and never hurts lifting recovery.',
    [
      '30-45 min brisk walk after a meal (helps blood sugar)',
      'Walk with 5 × 1 min very brisk / 2 min normal',
    ]),
  bike: C('bike', 'Stationary Bike', '🚴', ['bike'], 5.5, 10, 'low', 0.4,
    'Concentric-only, so it causes almost no soreness. The best cardio to pair with lifting days.',
    [
      '5 × 4 min hard (RPE 8) / 3 min easy',
      '30/30s: 2 sets of 10 × 30 s hard / 30 s easy',
      '40 min steady Zone 2 at cadence 85-95',
    ]),
  spin: C('spin', 'Spin / Indoor Cycling', '🚲', ['bike'], 7, 11, 'low', 0.5,
    'Class-style cycling with climbs and sprints. Self-guided if no class fits your schedule.',
    [
      'Climbs: 4 × 5 min heavy resistance seated at 60-70 rpm, 2 min spin out',
      'Sprints: 10 × 20 s all-out out of the saddle / 40 s easy',
      'Tabata block: 8 × 20 s / 10 s, twice, 4 min between',
    ]),
  row: C('row', 'Rower', '🚣', ['rower'], 6, 10, 'low', 0.35,
    'Full body: legs about 60%, back and arms the rest. Count it as light back work, and drive with the legs, not the arms. Avoid right before heavy back sessions.',
    [
      '8 × 500 m at 2K pace w/ 1:30 easy',
      '4 × 1000 m at hard steady effort w/ 2 min rest',
      'Pyramid: 1-2-3-4-3-2-1 min hard w/ equal easy',
      '30 min steady at 20-22 spm, focus on long powerful strokes',
    ]),
  elliptical: C('elliptical', 'Elliptical', '🌀', ['elliptical'], 5, 8, 'low', 0.35,
    'Running motion with no impact. Good for running-specific aerobic work when legs are sore from lifting.',
    [
      '6 × 3 min high resistance / 2 min easy',
      '20 × 30 s fast cadence / 30 s easy',
      '30-45 min Zone 2 steady',
    ]),
  stairmaster: C('stairmaster', 'StairMaster', '🪜', ['stairmaster'], 8, 10.5, 'low', 0.6,
    'Very glute/quad heavy and surprisingly hard. Avoid the day before heavy legs. Don\'t lean on the rails.',
    [
      '20 min steady at a level you can hold without rails',
      '10 × 1 min fast / 1 min slow',
      'Skip-a-step intervals: 5 × 2 min taking two steps at a time / 2 min normal',
    ]),
  assault_bike: C('assault_bike', 'Assault / Air Bike', '🌪️', ['assault_bike'], 7, 13, 'low', 0.5,
    'Arms and legs together. The harder you push, the more resistance. Brutal for short intervals and low-skill, so it\'s safe to go all-out.',
    [
      '10 × 15 s all-out / 45 s easy',
      'Every minute on the minute (EMOM) 12 min: 12-15 calories',
      '5 × 1 min hard / 2 min easy',
    ]),
  jump_rope: C('jump_rope', 'Jump Rope', '🪢', ['jump_rope'], 9, 12, 'high', 0.4,
    'Calf and coordination heavy. Great travel conditioning if you pack a rope.',
    [
      '10 × 1 min skipping / 30 s rest',
      'Alternate 30 s double-unders (or fast singles) / 30 s easy bounce for 10 min',
      '3 × 3 min "rounds" w/ 1 min rest',
    ]),
  swim: C('swim', 'Swim', '🏊', ['pool'], 6, 10, 'low', 0.1,
    'Zero impact and minimal leg fatigue. Shoulder-heavy, so avoid stacking it on a hard shoulder day. Calorie estimates vary hugely with technique.',
    [
      '10 × 50 m hard w/ 20 s rest',
      '4 × 200 m steady w/ 30 s rest',
      'Pyramid 50-100-150-200-150-100-50 m',
    ]),
  hike: C('hike', 'Hike', '🥾', ['outdoors'], 5.5, 7.5, 'low', 0.4,
    'Long, low-intensity time on feet. Big calorie burn with little recovery cost unless very hilly.',
    [
      'Push the uphills to RPE 7, recover on flats/downs',
      '60-120 min steady at conversational effort',
    ]),
  ruck: C('ruck', 'Ruck', '🎒', ['outdoors'], 6, 8.5, 'low', 0.45,
    'Walk with a weighted pack (20-35 lb). Builds traps, core and back endurance with little joint stress. Start light.',
    [
      '45 min at 15 min/mi with 20-25 lb',
      'Hill ruck: 6 × 3 min uphill brisk, easy down',
      '30 min fast ruck (sub-14 min/mi) as conditioning',
    ]),
  hiit_bodyweight: C('hiit_bodyweight', 'Bodyweight HIIT', '🔥', ['bodyweight'], 6, 9, 'high', 0.4,
    'No equipment needed: burpees, squat jumps, mountain climbers, high knees, shadow boxing. Good for hotel rooms or the office.',
    [
      'Tabata: 4 moves × 8 rounds of 20 s on / 10 s off (burpees, mountain climbers, jump squats, high knees)',
      'EMOM 15: min 1 = 10 burpees, min 2 = 20 mountain climbers, min 3 = 15 squat jumps',
      'Circuit × 4: 40 s work / 20 s rest of burpee, skater jumps, plank jacks, high knees, rest 1 min',
    ]),
};

export const INTENSITIES = {
  easy: { name: 'Easy / Zone 2', rpe: '3-4', factor: 0, description: 'Conversational. You could talk in full sentences. Builds aerobic base with minimal recovery cost.' },
  moderate: { name: 'Moderate / Steady', rpe: '5-6', factor: 0.5, description: 'Comfortably hard. Short sentences only. Marathon-pace feel.' },
  hard: { name: 'Hard / Tempo', rpe: '7-8', factor: 1, description: 'Sustained hard effort (threshold). A few words at a time.' },
  intervals: { name: 'Intervals', rpe: '8-9', factor: 0.85, description: 'Hard repeats with recoveries. High stimulus, higher recovery cost.' },
};

// equipmentSet: Set | array | location object → [modality objects] available there.
export function cardioOptions(equipmentSet) {
  const src = new Set(equipmentSet instanceof Set ? equipmentSet
    : Array.isArray(equipmentSet) ? equipmentSet : (equipmentSet && equipmentSet.equipment) || []);
  src.add('bodyweight');
  return Object.values(CARDIO).filter(c => c.equipment.every(e => src.has(e)));
}

export function metsFor(modalityId, intensity = 'moderate') {
  const c = CARDIO[modalityId];
  if (!c) return 0;
  const f = (INTENSITIES[intensity] || INTENSITIES.moderate).factor;
  return c.metsEasy + (c.metsHard - c.metsEasy) * f;
}

// METs × kg × hours. Returns a whole number of kcal (0 for unknown modality).
export function estimateCalories(modalityId, minutes, intensity = 'moderate', bodyweightLb = 165) {
  const mets = metsFor(modalityId, intensity);
  const lb = Number(bodyweightLb) > 0 ? Number(bodyweightLb) : 165;
  const min = Number(minutes) > 0 ? Number(minutes) : 0;
  return Math.round(mets * (lb / 2.20462) * (min / 60));
}
