// Equipment & locations (CONTRACT §3). Pure data + helpers, DOM-free.
//
// CONTRACT-NOTE: Crunch Allen includes 'trap_bar'. Most big-box Crunch clubs keep a hex/trap
// bar on the platform or near the deadlift area. If Allen doesn't, the user can toggle it off
// in Settings. 'ghd' here means any back-extension / hyperextension bench (Crunch usually has a
// 45° hyper and sometimes a true GHD). 'pool' and 'outdoors' are excluded at Crunch.
// CONTRACT-NOTE: expandEquipment keeps implications literal and minimal: bodyweight is always
// present and adjustable_bench → flat_bench. Nothing else is inferred (a rack does not imply a
// barbell, etc.).

const E = (id, name, category) => ({ id, name, category });

export const EQUIPMENT = {
  // free weights & benches
  bodyweight: E('bodyweight', 'Bodyweight', 'bodyweight'),
  dumbbell: E('dumbbell', 'Dumbbells', 'free'),
  adjustable_bench: E('adjustable_bench', 'Adjustable Bench (incline/decline)', 'free'),
  flat_bench: E('flat_bench', 'Flat Bench', 'free'),
  trap_bar: E('trap_bar', 'Trap / Hex Bar', 'free'),
  barbell: E('barbell', 'Barbell & Plates', 'free'),
  ez_bar: E('ez_bar', 'EZ Curl Bar', 'free'),
  kettlebell: E('kettlebell', 'Kettlebells', 'free'),
  landmine: E('landmine', 'Landmine', 'free'),
  medicine_ball: E('medicine_ball', 'Medicine Ball', 'free'),
  preacher_bench: E('preacher_bench', 'Preacher Curl Bench', 'free'),
  // bodyweight stations & accessories
  band: E('band', 'Resistance Bands', 'other'),
  trx: E('trx', 'TRX / Suspension Trainer', 'bodyweight'),
  pullup_bar: E('pullup_bar', 'Pull-up Bar', 'bodyweight'),
  dip_station: E('dip_station', 'Dip Station', 'bodyweight'),
  ghd: E('ghd', 'GHD / Back Extension Bench', 'bodyweight'),
  plyo_box: E('plyo_box', 'Plyo Box', 'other'),
  // cable & racks
  cable: E('cable', 'Cable Station', 'cable'),
  smith: E('smith', 'Smith Machine', 'machine'),
  rack: E('rack', 'Squat Rack / Power Rack', 'free'),
  // machines
  leg_press: E('leg_press', 'Leg Press', 'machine'),
  hack_squat: E('hack_squat', 'Hack Squat', 'machine'),
  leg_ext: E('leg_ext', 'Leg Extension', 'machine'),
  leg_curl: E('leg_curl', 'Leg Curl (seated or lying)', 'machine'),
  lat_pulldown: E('lat_pulldown', 'Lat Pulldown', 'machine'),
  seated_row_machine: E('seated_row_machine', 'Seated Row Machine', 'machine'),
  chest_press_machine: E('chest_press_machine', 'Chest Press Machine', 'machine'),
  shoulder_press_machine: E('shoulder_press_machine', 'Shoulder Press Machine', 'machine'),
  pec_deck: E('pec_deck', 'Pec Deck / Fly Machine', 'machine'),
  rear_delt_machine: E('rear_delt_machine', 'Rear Delt Machine (reverse pec deck)', 'machine'),
  ab_machine: E('ab_machine', 'Ab Crunch Machine', 'machine'),
  hip_thrust_machine: E('hip_thrust_machine', 'Hip Thrust / Glute Drive Machine', 'machine'),
  abductor_machine: E('abductor_machine', 'Hip Abductor / Adductor Machine', 'machine'),
  calf_machine: E('calf_machine', 'Calf Raise Machine', 'machine'),
  assisted_pullup: E('assisted_pullup', 'Assisted Pull-up / Dip Machine', 'machine'),
  // cardio
  treadmill: E('treadmill', 'Treadmill', 'cardio'),
  bike: E('bike', 'Stationary / Spin Bike', 'cardio'),
  rower: E('rower', 'Rowing Machine', 'cardio'),
  elliptical: E('elliptical', 'Elliptical', 'cardio'),
  stairmaster: E('stairmaster', 'StairMaster / Stair Climber', 'cardio'),
  assault_bike: E('assault_bike', 'Air / Assault Bike', 'cardio'),
  jump_rope: E('jump_rope', 'Jump Rope', 'cardio'),
  pool: E('pool', 'Pool', 'cardio'),
  outdoors: E('outdoors', 'Outdoors (run / walk / hike)', 'cardio'),
};

const CRUNCH = Object.keys(EQUIPMENT).filter(id => !['pool', 'outdoors'].includes(id));

export const DEFAULT_LOCATIONS = [
  { id: 'home', name: 'Home', icon: '🏠', equipment: ['bodyweight', 'dumbbell', 'adjustable_bench', 'flat_bench', 'trap_bar', 'outdoors'] },
  { id: 'crunch', name: 'Crunch Allen', icon: '🏋️', equipment: CRUNCH, hasClasses: true },
  { id: 'travel', name: 'Hotel / Travel', icon: '🧳', equipment: ['bodyweight', 'dumbbell', 'flat_bench', 'treadmill', 'bike', 'outdoors'] },
  { id: 'office', name: 'No equipment', icon: '💼', equipment: ['bodyweight', 'outdoors'] },
];

const IMPLIES = { adjustable_bench: ['flat_bench'] };

// ids: array | Set | location object ({equipment}) → Set including implied ids.
export function expandEquipment(ids) {
  const src = ids && !Array.isArray(ids) && !(ids instanceof Set) && ids.equipment ? ids.equipment : (ids || []);
  const s = new Set(src);
  s.add('bodyweight');
  for (const id of [...s]) for (const imp of IMPLIES[id] || []) s.add(imp);
  return s;
}

// flat_bench requirement is satisfied by an adjustable bench even on an unexpanded Set.
const IMPLIES_REVERSE = Object.entries(IMPLIES).reduce((acc, [src, imps]) => {
  for (const i of imps) (acc[i] ||= []).push(src);
  return acc;
}, {});

// exercise.equipment = array of REQUIRED ids (AND). bodyweight is always available.
// Accepts a Set (ideally already expanded) or an array/location (expanded here).
export function canDo(exercise, equipmentSet) {
  const req = Array.isArray(exercise) ? exercise : (exercise && exercise.equipment) || [];
  const have = equipmentSet instanceof Set ? equipmentSet : expandEquipment(equipmentSet);
  return req.every(e => e === 'bodyweight' || have.has(e) ||
    (IMPLIES_REVERSE[e] || []).some(src => have.has(src)));
}
