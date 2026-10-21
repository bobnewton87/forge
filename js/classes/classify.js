// Pure, DOM-free class classifier. Also imported by scripts/scrape-crunch.mjs in Node 20.
//
// classify(name, durationMin) → ClassInfo (CONTRACT §9)
//   { type, cardioMinutes, intensity, muscles:{[regionId]: effectiveSets}, label, blurb }
//
// Philosophy: group classes are real training, but they give LESS hypertrophy stimulus
// than dedicated lifting (light loads, high reps, little progressive overload, sets rarely
// taken close to failure for a given muscle). So muscle credits are conservative
// "effective sets": roughly what a set of focused lifting taken near failure would give.
// A 45-min full-body sculpt ≈ 1.5–2.5 effective sets per major region; an abs class
// ≈ 4–6 for abs/obliques; spin ≈ ~1 for quads, which matters little for a former
// 2:30 marathoner whose legs are already conditioned.
//
// CONTRACT-NOTE: extra exported helpers (CLASS_RULES, REGION_IDS, matchScore) are optional
// additions used by tests and the class picker. classify() is the contract API.

export const REGION_IDS = [
  'chest_upper', 'chest_mid', 'chest_lower',
  'lats', 'upper_back', 'traps', 'lower_back',
  'delt_front', 'delt_side', 'delt_rear',
  'biceps_long', 'biceps_short', 'brachialis',
  'triceps_long', 'triceps_lateral', 'triceps_medial',
  'forearms', 'abs', 'obliques', 'glutes', 'glute_med',
  'quads', 'adductors', 'hamstrings', 'calves',
];

// ---------- muscle templates (effective sets at the rule's reference duration) ----------
const FULL_SCULPT = {
  chest_mid: 2, chest_upper: 0.5, lats: 1.5, upper_back: 1.5, delt_front: 1, delt_side: 2, delt_rear: 0.5,
  biceps_long: 1, biceps_short: 1, triceps_long: 1, triceps_lateral: 1.5, triceps_medial: 0.5,
  quads: 2, glutes: 2, hamstrings: 1, abs: 2, obliques: 1,
};
const UPPER_SCULPT = {
  chest_mid: 1.5, chest_upper: 0.5, lats: 1, upper_back: 1, delt_front: 0.75, delt_side: 1.5, delt_rear: 0.75,
  biceps_long: 1, biceps_short: 1, brachialis: 0.25, triceps_long: 1, triceps_lateral: 1,
  triceps_medial: 0.5, forearms: 0.25, abs: 0.5,
};
const LOWER_SCULPT = {
  quads: 2, glutes: 3, glute_med: 2, hamstrings: 1.5, adductors: 1, calves: 0.5, abs: 2, obliques: 1,
};
const HIIT_STRENGTH = {
  chest_mid: 1.5, lats: 1, upper_back: 1, delt_front: 1, delt_side: 1, triceps_lateral: 1, triceps_long: 0.5,
  biceps_long: 0.5, biceps_short: 0.5, quads: 2, glutes: 2, hamstrings: 1, abs: 1.5, obliques: 0.5, forearms: 0.5,
};
const HIIT_CARDIO = {
  chest_mid: 1, delt_front: 0.5, triceps_lateral: 0.5, quads: 1.5, glutes: 1.5, hamstrings: 0.5,
  calves: 1, abs: 1.5, obliques: 0.5,
};
const BOOTCAMP = {
  chest_mid: 1.5, lats: 1, upper_back: 1, delt_front: 1, delt_side: 1, triceps_lateral: 1, biceps_short: 0.5,
  biceps_long: 0.5, quads: 2, glutes: 2, hamstrings: 1, calves: 0.5, abs: 1.5, obliques: 0.5,
};
const BARBELL_PUMP = {
  chest_mid: 2, chest_upper: 0.5, lats: 1, upper_back: 1.5, traps: 0.5, delt_front: 1, delt_side: 1,
  biceps_long: 0.75, biceps_short: 0.75, triceps_lateral: 1, triceps_long: 0.5, quads: 2, glutes: 2,
  hamstrings: 1, lower_back: 0.5, abs: 1,
};
const TRX = {
  chest_mid: 1.5, lats: 1.5, upper_back: 2, delt_rear: 1, delt_front: 0.5, biceps_long: 1, biceps_short: 1,
  triceps_long: 1, quads: 1.5, glutes: 1.5, hamstrings: 1, abs: 2, obliques: 1,
};
const CORE = { abs: 5, obliques: 3, lower_back: 1 };
const PILATES = { abs: 3, obliques: 1.5, glutes: 1.5, glute_med: 1, adductors: 0.5, lower_back: 0.5, delt_side: 0.5, delt_rear: 0.5 };
const BARRE = { glutes: 2, glute_med: 1.5, quads: 1.5, adductors: 1, calves: 1, abs: 1.5, delt_side: 0.5 };
const YOGA_SCULPT = {
  delt_front: 0.75, delt_side: 0.5, triceps_lateral: 0.5, chest_mid: 0.5, quads: 1, glutes: 1.5, glute_med: 0.5,
  abs: 1.5, obliques: 0.75,
};
const YOGA_FLOW = { abs: 1, delt_front: 0.5, triceps_medial: 0.25, glutes: 0.5, quads: 0.5 };
const YOGA_POWER = { abs: 1.5, obliques: 0.5, delt_front: 0.75, triceps_medial: 0.5, chest_mid: 0.25, glutes: 0.75, quads: 0.75 };
const AERIAL = { abs: 1, lats: 0.5, biceps_long: 0.5, forearms: 0.75, upper_back: 0.5 };
const CYCLE = { quads: 1, glutes: 0.5, hamstrings: 0.25, calves: 0.5 };
const BOXING = { delt_front: 1, delt_side: 0.5, triceps_lateral: 0.5, upper_back: 0.5, obliques: 1.5, abs: 1, calves: 1, quads: 0.5 };
const KICKBOX = { delt_front: 0.75, delt_side: 0.5, obliques: 1.5, abs: 1, glutes: 1, glute_med: 1, quads: 1, calves: 1 };
const DANCE = { calves: 0.5, glutes: 0.5, quads: 0.5, obliques: 0.5 };
const POUND = { delt_front: 0.75, delt_side: 0.5, triceps_lateral: 0.5, quads: 0.75, glutes: 0.75, abs: 0.5 };
const STEP_DECK = { quads: 1, glutes: 1, calves: 1, hamstrings: 0.25 };
const KETTLEBELL = { glutes: 2, hamstrings: 2, quads: 1, delt_front: 1, upper_back: 1, traps: 1, lower_back: 0.5, abs: 1, forearms: 1 };
const ROPES = { delt_front: 1.5, delt_side: 1, forearms: 1.5, biceps_long: 0.5, triceps_lateral: 0.5, abs: 1, quads: 0.5 };
const ROW = { lats: 1, upper_back: 1, biceps_long: 0.5, quads: 0.5, glutes: 0.5, hamstrings: 0.25 };
const RUN = { quads: 0.5, calves: 0.5, glutes: 0.25 };
const SWIM = { lats: 1, delt_front: 0.5, triceps_long: 0.5, upper_back: 0.5 };

function scaleT(t, f) { const o = {}; for (const k in t) o[k] = t[k] * f; return o; }

// ---------- rules (first match wins; specific before general) ----------
// cardio: fraction of class minutes that count as effective cardio minutes.
// ref: duration (min) the muscle template is calibrated for.
export const CLASS_RULES = [
  { id: 'stretch', re: /\b(stretch|recover|restor|mobility|foam ?roll|meditat|breath|myofascial|release|yin)\b/,
    type: 'stretch', intensity: 'easy', cardio: 0, ref: 45, muscles: {}, label: 'Stretch / recovery',
    blurb: 'Recovery work: improves mobility and lowers soreness. Zero hypertrophy credit; great on a rest day or after a hard lift.' },
  { id: 'aerial', re: /\b(aerial|anti-?gravity)\b/,
    type: 'yoga', intensity: 'moderate', cardio: 0.1, ref: 50, muscles: AERIAL, label: 'Aerial yoga',
    blurb: 'Fun grip and core work with some decompression. Light stimulus; treat as active recovery, not a training day.' },
  { id: 'yoga_sculpt', re: /(yoga.*(sculpt|strength|weights|burn|hiit))|((sculpt|strength).*yoga)|yogalates/,
    type: 'yoga', intensity: 'moderate', cardio: 0.2, ref: 60, muscles: YOGA_SCULPT, label: 'Yoga + light weights',
    blurb: 'Vinyasa flow with light weights, heavy on glutes, thighs and core. Good mobility plus a little core volume; too light to grow upper body.' },
  { id: 'yoga_power', re: /\b(power|hot|ashtanga|rocket|bikram|core flow|vinyasa)\b.*\byoga\b|\byoga\b.*\b(power|hot|vinyasa)\b|\bvinyasa\b/,
    type: 'yoga', intensity: 'moderate', cardio: 0.15, ref: 60, muscles: YOGA_POWER, label: 'Power / vinyasa yoga',
    blurb: 'Lots of chaturangas and planks: decent core and shoulder endurance, good hip mobility. Minimal size stimulus; best as a recovery-day session.' },
  { id: 'yoga', re: /\byoga\b|\bflow\b/,
    type: 'yoga', intensity: 'easy', cardio: 0.05, ref: 60, muscles: YOGA_FLOW, label: 'Yoga',
    blurb: 'Mobility and stress relief. Helps you recover and move better under load, but gives almost no muscle-building stimulus.' },
  { id: 'barre', re: /\bbarre\b/,
    type: 'pilates', intensity: 'moderate', cardio: 0.15, ref: 45, muscles: BARRE, label: 'Barre',
    blurb: 'High-rep isometrics for glutes, thighs and core. Legs are already a strength for you, so this is low-value for your goals.' },
  { id: 'pilates', re: /pilates|\bp3\b|reformer|\bmat\b/,
    type: 'pilates', intensity: 'moderate', cardio: 0.1, ref: 45, muscles: PILATES, label: 'Pilates',
    blurb: 'Strong deep-core and glute work with control. A solid way to get abs volume, plus posture and trunk stability for heavy lifts.' },
  { id: 'full_burnout', re: /top to bottom|total body|full body|head to toe|whole body|top ?& ?bottom/,
    type: 'sculpt', intensity: 'moderate', cardio: 0.3, ref: 45, muscles: FULL_SCULPT, label: 'Full-body sculpt',
    blurb: 'Bands for lower body, dumbbells for upper, then a combined burnout. Reasonable full-body volume, but not heavy enough to replace a lift day.' },
  { id: 'lower_bootcamp', re: /(belly|butt|booty|bottom|thigh|glute|leg|lower)[^]*\b(boot ?camp|camp|blast|burn)\b|\b(booty|butt|glutes?|legs?|lower body|thighs?)\b/,
    type: 'sculpt', intensity: 'moderate', cardio: 0.35, ref: 30, muscles: LOWER_SCULPT, label: 'Lower body + core',
    blurb: 'Glutes, thighs and core with bands and weights. Your legs only need maintenance, so take it for the abs work and the burn.' },
  { id: 'upper', re: /\btop it off\b|upper body|\barms?\b|\bguns\b|\bchest\b|\bshoulders?\b|\bback\b.*\bbis?\b|\bbis\b|\btris\b/,
    type: 'sculpt', intensity: 'moderate', cardio: 0.25, ref: 30, muscles: UPPER_SCULPT, label: 'Upper-body sculpt',
    blurb: 'Arms, shoulders, chest and back with dumbbells and isometrics: the best class for your priorities. Lighter than real lifting, so use it as a pump day or top-up.' },
  { id: 'hiit_strength', re: /strong-?er|superset hiit|strong hiit|strength hiit|hiit strength|power hiit|hiit lift/,
    type: 'hiit', intensity: 'intervals', cardio: 0.7, ref: 45, muscles: HIIT_STRENGTH, label: 'Strength HIIT',
    blurb: 'Strength-based HIIT with power moves and real loading. One of the better classes for adding muscle; also brutal conditioning, so space it from heavy leg days.' },
  { id: 'ropes', re: /\bropes?\b/,
    type: 'hiit', intensity: 'intervals', cardio: 0.75, ref: 45, muscles: ROPES, label: 'Battle ropes',
    blurb: 'Rope intervals hammer shoulders, grip and conditioning with low joint impact. Mostly conditioning with a bit of delt endurance.' },
  { id: 'hiit', re: /hiit|tabata|metcon|insanity|interval|circuit|\bcirc\b|extreme|sprint|plyo|athletic|agility|burpee|\bsweat\b|shred|\bhiitzone\b/,
    type: 'hiit', intensity: 'intervals', cardio: 0.8, ref: 45, muscles: HIIT_CARDIO, label: 'HIIT',
    blurb: 'Hard intervals plus bodyweight and turf drills. Great fat-loss and VO2 work for getting ripped; modest muscle stimulus, heavy leg fatigue.' },
  { id: 'kickbox', re: /kick ?box|muay|\bkick\b|cardio kick/,
    type: 'boxing', intensity: 'intervals', cardio: 0.75, ref: 45, muscles: KICKBOX, label: 'Kickboxing',
    blurb: 'Punching and kicking intervals: great calorie burn and oblique work, plus hip mobility. Conditioning, not size.' },
  { id: 'boxing', re: /fight club|\bbox(ing)?\b|\bfight\b|punch|\bjab\b|knockout|\bspar|rumble|\bmma\b/,
    type: 'boxing', intensity: 'intervals', cardio: 0.75, ref: 45, muscles: BOXING, label: 'Boxing / fight',
    blurb: 'Bag work and combos: shoulder endurance, rotational core and a big calorie burn. Good conditioning for getting lean; little hypertrophy.' },
  { id: 'cycle', re: /\bride\b|\bspin\b|cycl|power zone|peloton ride|\bbike\b|rpm|\brhythm ride\b|let the beat drop/,
    type: 'cycle', intensity: 'intervals', cardio: 0.9, ref: 45, muscles: CYCLE, label: 'Indoor cycling',
    blurb: 'Climbs and sprints on the bike: excellent low-impact cardio for staying lean without beating up your legs like running does. Essentially no upper-body work.' },
  { id: 'core', re: /\b(abs?|ab-?solution|absolution|core|six[- ]?pack|6[- ]?pack|abdominal|plank|crunch time|belly blast)\b/,
    type: 'core', intensity: 'moderate', cardio: 0.15, ref: 30, muscles: CORE, label: 'Abs / core',
    blurb: 'Concentrated abs and obliques work. It counts toward your 6+ abs sets/week; visible abs still come from staying lean.' },
  { id: 'barbell', re: /barbell|\bpump\b|\blift\b|bodypump|\bbar\b|weights|iron/,
    type: 'strength', intensity: 'moderate', cardio: 0.2, ref: 45, muscles: BARBELL_PUMP, label: 'Barbell strength',
    blurb: 'High-rep barbell work for the whole body: decent volume, though loads are light. It usually includes back squats, so swap those for goblet or split squats (your rule).' },
  { id: 'kettlebell', re: /kettle ?bell|\bkb\b|\bswing\b/,
    type: 'strength', intensity: 'moderate', cardio: 0.4, ref: 45, muscles: KETTLEBELL, label: 'Kettlebell',
    blurb: 'Swings and cleans for the posterior chain, grip and conditioning. Good athletic work; light on the upper-body muscles you are trying to grow.' },
  { id: 'trx', re: /\btrx\b|suspension|bodyweb|\brings?\b/,
    type: 'strength', intensity: 'moderate', cardio: 0.3, ref: 45, muscles: TRX, label: 'TRX / suspension',
    blurb: 'Bodyweight rows, push-ups and pistols on straps. Good back and core work, and handy practice for hotel workouts.' },
  { id: 'bootcamp', re: /boot ?camp|camp crunch|\bcamp\b|\bboot\b|\bdrill\b|conditioning|\bbattle\b/,
    type: 'hiit', intensity: 'intervals', cardio: 0.6, ref: 45, muscles: BOOTCAMP, label: 'Bootcamp',
    blurb: 'Strength stations mixed with cardio bursts. Solid full-body work that builds fitness and burns fat; moderate muscle credit across the board.' },
  { id: 'cardio_sculpt', re: /cardio (sculpt|strength|tone|pump)|(sculpt|strength) ?(&|and|\+) ?cardio/,
    type: 'hiit', intensity: 'intervals', cardio: 0.5, ref: 45, muscles: scaleT(FULL_SCULPT, 0.7), label: 'Cardio sculpt',
    blurb: 'Weights mixed with cardio bursts: half conditioning, half light full-body sculpting. Good for leaning out; moderate muscle credit.' },
  { id: 'sculpt', re: /sculpt|chisel|tone|toning|strength|muscle|define|body ?shap|bootylicious|\bburn\b|burnout|conditioning/,
    type: 'sculpt', intensity: 'moderate', cardio: 0.25, ref: 45, muscles: FULL_SCULPT, label: 'Body sculpt',
    blurb: 'Dumbbells and calisthenics for the whole body. Some real volume for chest, delts, arms and core, but loads are light, so it works best as a pump or deload day.' },
  { id: 'step_deck', re: /\bstep\b|\bdeck\b|transform it: cardio|\btransform\b/,
    type: 'hiit', intensity: 'intervals', cardio: 0.8, ref: 30, muscles: STEP_DECK, label: 'Step / deck cardio',
    blurb: 'Step-deck cardio intervals. A solid calorie burn and conditioning, with only a little leg work.' },
  { id: 'pound', re: /\bpound\b|drumstick|ripstix/,
    type: 'cardio_dance', intensity: 'moderate', cardio: 0.7, ref: 45, muscles: POUND, label: 'Pound (drumstick cardio)',
    blurb: 'Drumming-style cardio in squats and lunges: fun conditioning with light shoulder and leg endurance work.' },
  { id: 'dance', re: /zumba|danc|pound|hip ?hop|burlesque|strip|groove|sh'?bam|jazz|salsa|latin|hula|drums|twerk|cardio party|disco|\bbeat\b/,
    type: 'cardio_dance', intensity: 'moderate', cardio: 0.75, ref: 60, muscles: DANCE, label: 'Dance cardio',
    blurb: 'Fun, steady cardio that keeps you moving: a good low-stress calorie burn for staying lean, with no real muscle-building stimulus.' },
  { id: 'row', re: /\brow(ing)?\b|erg/,
    type: 'hiit', intensity: 'intervals', cardio: 0.85, ref: 45, muscles: ROW, label: 'Rowing',
    blurb: 'Full-body, low-impact rowing intervals. Strong conditioning with a little back work.' },
  { id: 'tread', re: /tread|\brun\b|running|\bmile\b/,
    type: 'hiit', intensity: 'intervals', cardio: 0.9, ref: 45, muscles: RUN, label: 'Treadmill intervals',
    blurb: 'Run intervals: your home turf. Excellent cardio, but keep volume modest so it does not cut into recovery from lifting.' },
  { id: 'aqua', re: /aqua|swim|pool|water/,
    type: 'other', intensity: 'moderate', cardio: 0.7, ref: 45, muscles: SWIM, label: 'Aqua / swim',
    blurb: 'Low-impact pool cardio. Easy on the joints; light upper-body endurance.' },
  { id: 'cardio', re: /cardio|aerobic|fat ?burn|calorie|sweat/,
    type: 'hiit', intensity: 'moderate', cardio: 0.75, ref: 45, muscles: HIIT_CARDIO, label: 'Cardio',
    blurb: 'General cardio conditioning: good for staying lean, light muscle credit.' },
];

const FALLBACK = {
  id: 'other', type: 'other', intensity: 'moderate', cardio: 0.5, ref: 45, muscles: {}, label: 'Class',
  blurb: 'Unrecognized class: credited as moderate cardio only. Log a lift afterwards if it had real strength work.',
};

// Add-on muscle credits when the name signals an extra focus (e.g. "Ride + Abs").
const MODIFIERS = [
  { re: /\b(abs?|core)\b/, skip: ['core', 'pilates'], add: { abs: 1.5, obliques: 0.75 } },
  { re: /\b(glutes?|booty|butt)\b/, skip: ['lower_bootcamp', 'barre'], add: { glutes: 1, glute_med: 0.5 } },
  { re: /\barms?\b|\bguns\b/, skip: ['upper'], add: { biceps_long: 0.75, biceps_short: 0.75, triceps_long: 0.75, triceps_lateral: 0.75 } },
  { re: /\bupper\b/, skip: ['upper'], add: { chest_mid: 0.75, delt_side: 0.75, lats: 0.5 } },
];

function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function round1(x) { return Math.round(x * 4) / 4; } // quarter-set precision

export function findRule(name) {
  const n = normName(name);
  if (!n) return FALLBACK;
  return CLASS_RULES.find(r => r.re.test(n)) || FALLBACK;
}

export function classify(name, durationMin = 45) {
  const dur = Number(durationMin) > 0 ? Number(durationMin) : 45;
  const n = normName(name);
  const rule = findRule(n);
  const scale = Math.max(0.5, Math.min(1.5, dur / rule.ref));
  const raw = { ...rule.muscles };
  for (const m of MODIFIERS) {
    if (m.skip.includes(rule.id) || !m.re.test(n)) continue;
    // Modifiers apply to the main class type; skip for pure recovery work.
    if (rule.type === 'stretch') continue;
    for (const [k, v] of Object.entries(m.add)) raw[k] = (raw[k] || 0) + v;
  }
  const muscles = {};
  for (const [k, v] of Object.entries(raw)) {
    // Per-session ceiling: beyond ~6 sets for one muscle in a class, extra work is junk volume.
    const s = round1(Math.min(6, v * scale));
    if (s > 0) muscles[k] = s;
  }
  // Long easy classes don't become harder; very short HIIT has less warm-up overhead.
  let cardioMinutes = Math.round(dur * rule.cardio);
  if (rule.type === 'hiit' && dur <= 30) cardioMinutes = Math.round(dur * Math.min(0.9, rule.cardio + 0.05));
  return {
    type: rule.type,
    cardioMinutes,
    intensity: rule.intensity,
    muscles,
    label: rule.label,
    blurb: rule.blurb,
  };
}

// Known classes, for logging one on a day whose schedule we never cached (CONTRACT §24). Names and
// typical durations as they appear on the Crunch Allen timetable, plus generic ones for other gyms;
// classify() still does the crediting, so a name that is not here works too — this is just the
// pick-list. `type` is only for grouping the list in the UI.
export const CLASS_CATALOGUE = [
  { name: 'Circuit HIIT', duration: 45, type: 'hiit' },
  { name: 'CircHIIT (HIITZone)', duration: 45, type: 'hiit' },
  { name: 'ExtremeHIIT (HIITZone)', duration: 45, type: 'hiit' },
  { name: 'Superset HIIT (HIITZone)', duration: 45, type: 'hiit' },
  { name: 'Strong-er HIIT (HIITZone)', duration: 45, type: 'hiit' },
  { name: 'Barbell 45', duration: 45, type: 'strength' },
  { name: 'Chisel', duration: 30, type: 'sculpt' },
  { name: 'Top it Off', duration: 30, type: 'sculpt' },
  { name: 'Top to Bottom Burnout', duration: 30, type: 'sculpt' },
  { name: 'Belly, Butt, & Thighs Bootcamp', duration: 30, type: 'sculpt' },
  { name: 'Transform it: Cardio', duration: 30, type: 'hiit' },
  { name: 'Transform it: Core', duration: 30, type: 'core' },
  { name: 'The Ride', duration: 45, type: 'cycle' },
  { name: 'The Ride: Let the Beat Drop', duration: 45, type: 'cycle' },
  { name: 'P3 Pilates', duration: 45, type: 'pilates' },
  { name: 'Yoga Body Sculpt', duration: 60, type: 'yoga' },
  { name: 'ZUMBA', duration: 60, type: 'cardio_dance' },
  { name: 'Bootcamp', duration: 45, type: 'hiit' },
  { name: 'Kettlebell', duration: 45, type: 'strength' },
  { name: 'TRX', duration: 45, type: 'strength' },
  { name: 'Boxing', duration: 45, type: 'boxing' },
  { name: 'Abs & Core', duration: 30, type: 'core' },
  { name: 'Stretch & Recover', duration: 30, type: 'stretch' },
];

// Group lookup for regions (kept local so this module stays dependency-free).
export const REGION_GROUP = {
  chest_upper: 'chest', chest_mid: 'chest', chest_lower: 'chest',
  lats: 'back', upper_back: 'back', traps: 'back', lower_back: 'back',
  delt_front: 'shoulders', delt_side: 'shoulders', delt_rear: 'shoulders',
  biceps_long: 'biceps', biceps_short: 'biceps', brachialis: 'biceps',
  triceps_long: 'triceps', triceps_lateral: 'triceps', triceps_medial: 'triceps',
  forearms: 'forearms', abs: 'core', obliques: 'core', glutes: 'glutes', glute_med: 'glutes',
  quads: 'quads', adductors: 'quads', hamstrings: 'hamstrings', calves: 'calves',
};

// Sum region credits into groups: { chest: 2.5, core: 3, ... }
export function groupCredits(muscles) {
  const out = {};
  for (const [r, v] of Object.entries(muscles || {})) {
    const g = REGION_GROUP[r];
    if (g) out[g] = Math.round(((out[g] || 0) + v) * 4) / 4;
  }
  return out;
}

// How well a class fits a request. targets: group/region/preset ids (unknown ids ignored).
// Returns { score 0..1, good:boolean, reasons:[string] }.
const PRESET_GROUPS = {
  push: ['chest', 'shoulders', 'triceps'], pull: ['back', 'biceps'], legs: ['quads', 'hamstrings', 'glutes', 'calves'],
  upper: ['chest', 'back', 'shoulders', 'biceps', 'triceps'], lower: ['quads', 'hamstrings', 'glutes', 'calves'],
  arms: ['biceps', 'triceps', 'forearms'], full: ['chest', 'back', 'shoulders', 'quads', 'glutes', 'core'],
  v_taper: ['back', 'shoulders'], core: ['core'],
  shoulders_arms: ['shoulders', 'biceps', 'triceps'], chest_back: ['chest', 'back'],
};
const GROUP_IDS = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];
const SCULPT_GROUP = {
  six_pack: 'core', obliques_vline: 'core', lat_width: 'back', back_thickness: 'back', traps_yoke: 'back',
  upper_chest: 'chest', chest_fullness: 'chest', capped_delts: 'shoulders', rear_delts: 'shoulders',
  arm_thickness: 'biceps', quad_sweep: 'quads',
};
export function matchScore(cls, { minutes, targets } = {}) {
  const info = cls.classify || classify(cls.name, cls.duration);
  const reasons = [];
  let score = 0.5;
  const dur = cls.duration || 45;
  if (minutes) {
    const fits = dur <= minutes + 5;
    if (fits) { score += 0.2; reasons.push(`fits your ${minutes} min`); } else { score -= 0.4; reasons.push(`${dur} min is longer than your ${minutes}`); }
  }
  const want = new Set();
  for (const t of targets || []) {
    if (t === 'cardio') { want.add('cardio'); continue; }
    if (PRESET_GROUPS[t]) PRESET_GROUPS[t].forEach(g => want.add(g));
    else if (REGION_GROUP[t]) want.add(REGION_GROUP[t]);
    else if (SCULPT_GROUP[t]) want.add(SCULPT_GROUP[t]);
    else { const g = GROUP_IDS.find(g => t.startsWith(g.replace(/s$/, ''))); if (g) want.add(g); }
  }
  if (want.size) {
    const gc = groupCredits(info.muscles);
    const hits = [...want].filter(g => g === 'cardio' ? info.cardioMinutes >= 20 : (gc[g] || 0) >= 1.5);
    if (hits.length) { score += 0.3 * hits.length / want.size; reasons.push('hits ' + hits.join(', ')); }
    else score -= 0.2;
  }
  score = Math.max(0, Math.min(1, score));
  return { score, good: score >= 0.7, reasons };
}
