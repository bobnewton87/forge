// Optional nutrition targets (off by default). Pure, DOM-free.
//
// CONTRACT-NOTE: dailyTargets() also returns { tdee, mode, goal, dayType }.
//   profile.nutrition.calories (optional) = desired AVERAGE daily calories. In 'simple' mode
//   it is used as-is; in 'cycling' mode days are cycled around it. profile.nutrition.protein
//   (optional) overrides the protein estimate in grams.
// CONTRACT-NOTE: extra exports SUPPLEMENTS and MEAL_IDEAS (ported from Iron Runner).

const round10 = x => Math.round(x / 10) * 10;

// Calories below estimated maintenance (negative = surplus). Ported from Iron Runner calcNutri
// (recomp/bulk/cut), with 'both' (lift + cardio) days fuelled a bit more than a lift day.
const CYCLE = {
  recomp: { lift: 100, cardio: 300, rest: 500, both: -100 },
  lean_bulk: { lift: -250, cardio: 0, rest: 200, both: -400 },
  cut: { lift: 300, cardio: 500, rest: 700, both: 150 },
};
// Flat daily offset for 'simple' mode (roughly the weekly average of the cycle).
const SIMPLE = { recomp: 250, lean_bulk: -250, cut: 500 };

const NOTES = {
  lift: 'Lift day: put most of your carbs in the meals before and after training.',
  cardio: 'Cardio day: carbs before longer or harder sessions; keep protein high.',
  rest: 'Rest day: lowest carbs. Lean on protein, veggies and fats.',
  both: 'Lift + cardio day: highest carbs. Eat a real meal between sessions.',
};
const GOAL_NOTES = {
  recomp: 'Recomp: small average deficit, protein every day.',
  lean_bulk: 'Lean bulk: small surplus. Aim to gain about 0.25-0.5 lb a week.',
  cut: 'Cut: moderate deficit with higher protein to keep muscle.',
};

export function dailyTargets(profile, { dayType = 'lift', bodyweight } = {}) {
  const n = profile?.nutrition || {};
  const mode = n.mode || 'off';
  if (mode === 'off') return null;
  const bw = Number(bodyweight) || Number(profile?.bodyweight) || 0;
  if (!(bw > 0)) return null;
  const goal = CYCLE[profile?.goal] ? profile.goal : 'recomp';
  if (!CYCLE[goal][dayType]) dayType = 'lift';

  let tdee = Math.round(bw * 15.5);
  if (Number(n.calories) > 0) tdee = Number(n.calories) + SIMPLE[goal];   // user-set average target

  const protein = Number(n.protein) > 0 ? Math.round(Number(n.protein)) : Math.round(bw * (goal === 'cut' ? 1.15 : 1.0));
  const fat = Math.round(bw * (goal === 'cut' ? 0.35 : 0.4));
  let calories = mode === 'simple' ? tdee - SIMPLE[goal] : tdee - CYCLE[goal][dayType];
  let carbs = Math.round((calories - protein * 4 - fat * 9) / 4);
  if (carbs < 100) { carbs = 100; calories = protein * 4 + fat * 9 + carbs * 4; }
  calories = round10(calories);

  const note = mode === 'simple' ? GOAL_NOTES[goal] : `${NOTES[dayType]} ${GOAL_NOTES[goal]}`;
  return { calories, protein, carbs, fat, note, tdee, mode, goal, dayType: mode === 'simple' ? null : dayType };
}

export const ADDERALL_TIPS = [
  'Eat a real breakfast BEFORE your dose kicks in (about 20-30 min after taking it). It is your easiest meal of the day.',
  'Drink your calories at midday: a shake (whey + banana + milk) goes down when solid food will not.',
  'Set phone reminders every 3 hours. You will not feel hungry, so eat by the clock.',
  'Plan for the evening rebound: appetite comes back as it wears off, so make dinner your biggest, most protein-dense meal.',
  'Use calorie-dense, easy foods during peak suppression: Greek yogurt, nut butter, cheese, trail mix, whole milk.',
  'If a meal is impossible, get a protein shake in at minimum. Protein matters most.',
  'Caffeine stacks with the appetite suppression. Keep coffee to the morning on days eating is hard.',
  'Train later in the day if you can. Lifting under peak suppression with no food in you makes sessions worse.',
  'Stay hydrated (dry mouth and stimulants increase needs). Keep a bottle on your desk.',
  'On days off the medication, eat more to make up for weekday deficits instead of treating it as a cheat day.',
];

export const NUTRITION_TIPS = [
  'Protein first: about 1 g per lb of bodyweight every day (a bit more when cutting), split over 4-5 meals of 30-50 g.',
  'Creatine monohydrate, 5 g every day. Timing does not matter, consistency does.',
  'Getting ripped AND bigger is slow: expect the scale to move little while the mirror, waist and lifts improve.',
  'Judge progress over 2-4 weeks: morning bodyweight average, waist measurement and the progression log.',
  'If the weekly average weight and waist have not changed in 4 weeks and you want to lean out, cut about 200 kcal a day (from rest days first).',
  'Carbs are training fuel: put most of them around lifts and harder cardio.',
  'Your marathon background means high cardio burn. On big cardio weeks, eat more or your lifts will stall.',
  'Sleep 7-8+ hours. It does more for recovery and fat loss than any supplement.',
  'Alcohol blunts muscle protein synthesis and sleep. Keep it occasional.',
  'Hit 80% consistency on protein and calories and you will make great progress. You do not need perfection.',
];

export const SUPPLEMENTS = [
  { name: 'Whey protein', dose: '1-2 scoops/day', note: 'The easiest way to hit protein, especially while appetite is suppressed.' },
  { name: 'Creatine monohydrate', dose: '5 g/day', note: 'The best-studied supplement for strength and muscle. Take it every day, any time.' },
  { name: 'Vitamin D3', dose: '1000-4000 IU/day', note: 'Take with a meal containing fat. A blood test tells you your actual dose.' },
  { name: 'Fish oil', dose: '1-3 g EPA+DHA/day', note: 'Useful if you rarely eat fatty fish.' },
  { name: 'Magnesium glycinate', dose: '200-400 mg before bed', note: 'May help sleep quality and cramps.' },
];

export const MEAL_IDEAS = {
  breakfast: ['3 eggs + toast + Greek yogurt (~450 kcal, 40 g P)', 'Oats with milk + 1 scoop whey + banana (~450 kcal, 40 g P)'],
  shake: ['Whey + banana + 8 oz milk (~350 kcal, 33 g P)', 'Whey + berries + 1 tbsp peanut butter + milk (~380 kcal, 35 g P)'],
  lunch: ['4-5 oz chicken + rice + veggies (~450 kcal, 40 g P)', 'Tuna or turkey sandwich + fruit (~420 kcal, 32 g P)'],
  preWorkout: ['Banana or rice cake + peanut butter (~120 kcal)'],
  dinner: ['6 oz sirloin + potato + broccoli (~550 kcal, 50 g P)', '5 oz salmon + rice + veggies (~550 kcal, 36 g P)'],
  bedtime: ['Cottage cheese + berries (~200 kcal, 21 g P)', 'Casein shake (~120 kcal, 24 g P)'],
};
