// STUB — DATA owner replaces this file.
const IDS = ['bodyweight','dumbbell','adjustable_bench','flat_bench','trap_bar','barbell','ez_bar','kettlebell','band','pullup_bar','dip_station','cable','smith','rack','leg_press','hack_squat','leg_ext','leg_curl','lat_pulldown','seated_row_machine','chest_press_machine','shoulder_press_machine','pec_deck','rear_delt_machine','preacher_bench','ab_machine','hip_thrust_machine','abductor_machine','calf_machine','assisted_pullup','ghd','landmine','trx','medicine_ball','plyo_box','treadmill','bike','rower','elliptical','stairmaster','assault_bike','jump_rope','pool','outdoors'];
export const EQUIPMENT = Object.fromEntries(IDS.map(id => [id, { id, name: id.replace(/_/g, ' '), category: 'other' }]));
export const DEFAULT_LOCATIONS = [
  { id: 'home', name: 'Home', icon: '🏠', equipment: ['bodyweight', 'dumbbell', 'adjustable_bench', 'flat_bench', 'trap_bar', 'outdoors'] },
  { id: 'crunch', name: 'Crunch Allen', icon: '🏋️', equipment: IDS.filter(i => !['pool', 'trap_bar'].includes(i)), hasClasses: true },
  { id: 'travel', name: 'Hotel / Travel', icon: '🧳', equipment: ['bodyweight', 'dumbbell', 'flat_bench', 'treadmill', 'bike', 'outdoors'] },
  { id: 'office', name: 'No equipment', icon: '💼', equipment: ['bodyweight', 'outdoors'] },
];
export function expandEquipment(ids) { const s = new Set(ids); s.add('bodyweight'); if (s.has('adjustable_bench')) s.add('flat_bench'); return s; }
export function canDo(ex, set) { return (ex.equipment || []).every(e => e === 'bodyweight' || set.has(e)); }
