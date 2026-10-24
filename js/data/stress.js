// Joint / area stress per exercise (§26, "something's hurting"). Pure, DOM-free.
//
// Forge is not a clinician. This table only answers "which moves load this area, and how hard?", so
// that a logged issue can steer exercise choice. It is derived by RULES from fields every exercise
// already has (pattern, muscles, equipment, category, id keywords) plus a short override list, not
// hand-annotated one exercise at a time, so a new exercise gets a sensible map without editing this.
//
// Tiers (per area): 0 = no meaningful load · 1 = incidental (holding dumbbells for lunges with a sore
// wrist) · 2 = clearly loads it · 3 = loads it hardest (skull crushers for an elbow, squats and lunges
// for a knee, deadlifts for a lower back). How a tier is used is engine/issues.js's job:
//   mild issue      → tier 3 excluded, tier 2 strongly penalised
//   moderate/severe → tier 2 and 3 excluded
// The tiers are a coaching convention (which joints a movement pattern loads), not measured joint
// forces; they are deliberately conservative where a move is commonly reported to aggravate an area
// (dips and upright rows for shoulders, preacher and reverse curls for elbows, push-ups for wrists).
//
// CONTRACT-NOTE (§26): exports AREAS_STRESS (area ids), stressOf(ex) → { [area]: 0..3 } (memoized),
//   muscleStress(ex, group) → 0..3 from the exercise's own credit to that muscle group, OVERRIDES.
import { EXERCISES } from './exercises.js';
import { REGIONS } from './muscles.js';

export const AREAS_STRESS = ['shoulder', 'elbow', 'wrist', 'neck', 'upper_back', 'lower_back', 'hip', 'knee', 'ankle'];

// Exceptions the rules get wrong, applied last (area → tier). Keep this short: if a whole family is
// wrong, fix the rule instead.
export const OVERRIDES = {
  scap_pushup: { shoulder: 2, elbow: 1, wrist: 2 },        // tiny range, but still weight on the hands
  scap_pullup: { shoulder: 2, elbow: 1, wrist: 2 },
  wall_sit: { knee: 2, hip: 1, ankle: 1, lower_back: 0 },   // isometric, no impact
  spanish_squat: { knee: 2, hip: 1, ankle: 1, lower_back: 0 },
  kb_gorilla_row: { lower_back: 3 },                       // hinge position, both hands on bells
  back_ext_glute: { lower_back: 3 },                       // a back-extension bench is a back extension
  prone_cobra: { lower_back: 2, neck: 2 },                 // unloaded prone extension
  superman: { lower_back: 2, neck: 2 },
  dead_hang_grip: { shoulder: 2, wrist: 3, elbow: 2 },
  landmine_press: { shoulder: 2 },                         // the shoulder-friendlier overhead angle
  cable_crunch: { neck: 1, lower_back: 1 },
  machine_crunch: { neck: 1, lower_back: 1 },
  reverse_nordic: { knee: 3, hip: 2, ankle: 1 },
  sissy_squat: { knee: 3, ankle: 3, hip: 1 },
  petersen_step: { knee: 3, ankle: 2, hip: 2 },
  copenhagen_plank: { hip: 3, knee: 2, shoulder: 2 },
  db_pullover: { shoulder: 3, elbow: 1 },
  cable_lying_pullover: { shoulder: 3, elbow: 1 },
  kb_pullover: { shoulder: 3, elbow: 1 },
  db_high_pull: { shoulder: 3, neck: 3, upper_back: 2, wrist: 2, elbow: 2 },
  handstand_pushup: { shoulder: 3, neck: 3, wrist: 3, elbow: 2 },
};

const has = (ex, ...eq) => eq.some(e => (ex.equipment || []).includes(e));
const credit = (ex, region) => ex.muscles?.[region] || 0;
const groupCredit = (ex, group) => {
  let w = 0;
  for (const [r, x] of Object.entries(ex.muscles || {})) if (REGIONS[r]?.group === group && x > w) w = x;
  return w;
};
// Tier from a muscle credit: prime mover 3, strong synergist 2, minor 1.
const fromCredit = w => (w >= 0.75 ? 3 : w >= 0.5 ? 2 : w > 0 ? 1 : 0);
export function muscleStress(ex, group) { return ex ? fromCredit(groupCredit(ex, group)) : 0; }

const JUMPS = /jump|box_jump|skater|burpee/;
const OVERHEAD_CONDITIONING = /snatch|thruster|wall_ball|devil_press|man_maker/;
const HANDS_DOWN = /burpee|bear_crawl|mountain_climber|devil_press|man_maker/;
const OVERHEAD_EXT = /_oh|oh_ext|tri_ext|katana|cross_ext/;
const SKULL = /skull|jm_press|tate|rolling_ext|lying_ext/;
const BENT_ROW = /bent_row|bb_row|trap_row|tbar|meadows|gorilla|kroc/;
const PUSHUP = /pushup|push_up/;

function rules(ex) {
  const id = ex.id, P = ex.pattern;
  const t = { shoulder: 0, elbow: 0, wrist: 0, neck: 0, upper_back: 0, lower_back: 0, hip: 0, knee: 0, ankle: 0 };
  const up = (k, v) => { if (v > t[k]) t[k] = v; };
  const hang = has(ex, 'pullup_bar') && (P === 'core_flexion' || P === 'rotation' || P === 'carry');
  const freeLoad = has(ex, 'dumbbell', 'trap_bar', 'kettlebell', 'barbell', 'ez_bar');

  // ---- upper-body patterns
  switch (P) {
    case 'vertical_push':
      up('shoulder', 3); up('elbow', 2); up('wrist', 2); up('neck', 2); up('upper_back', 1);
      if (/standing|bb_ohp|kb_press|landmine_press/.test(id)) up('lower_back', 2);
      break;
    case 'horizontal_push':
      up('shoulder', 2); up('elbow', 2); up('wrist', 2); up('upper_back', 1);
      if (PUSHUP.test(id)) { up('wrist', 3); up('neck', 1); }
      break;
    case 'fly': up('shoulder', 2); up('elbow', 1); if (has(ex, 'dumbbell')) up('wrist', 1); break;
    case 'lateral_raise': up('shoulder', 2); up('elbow', 1); up('neck', 1); if (freeLoad || has(ex, 'band')) up('wrist', 1); break;
    case 'vertical_pull':
      up('shoulder', 2); up('elbow', 2); up('wrist', 2); up('upper_back', 2); up('neck', 1);
      if (/straight_arm|prayer|pullover/.test(id)) t.elbow = 1;
      break;
    case 'horizontal_pull':
      up('shoulder', 1); up('elbow', 2); up('wrist', 2); up('upper_back', BENT_ROW.test(id) || /inverted|trx_row/.test(id) ? 3 : 2); up('neck', 1);
      if (/kroc|meadows/.test(id)) up('lower_back', 2);
      if (/cable_row|machine_row|seated/.test(id)) up('lower_back', 1);
      break;
    case 'rear_delt':
      up('shoulder', 1); up('elbow', /row/.test(id) ? 2 : 1); up('upper_back', 2); up('neck', 1); if (freeLoad) up('wrist', 1);
      break;
    case 'shrug': up('neck', 3); up('upper_back', 2); up('shoulder', 1); up('elbow', 1); up('wrist', 2); if (has(ex, 'trap_bar', 'dumbbell', 'kettlebell', 'smith')) up('lower_back', 1); break;
    case 'elbow_flexion':
      up('elbow', 2); up('wrist', /bb_curl/.test(id) ? 3 : 2);   // a straight bar locks the wrist; EZ / DB / cable don't
      if (/preacher|reverse_curl|zottman/.test(id)) up('elbow', 3);
      if (/bayesian|behind|drag/.test(id)) up('shoulder', 1);
      break;
    case 'elbow_extension':
      up('elbow', OVERHEAD_EXT.test(id) || SKULL.test(id) ? 3 : 2); up('wrist', 2);
      if (OVERHEAD_EXT.test(id)) up('shoulder', 2); else if (SKULL.test(id) || /kickback/.test(id)) up('shoulder', 1);
      break;
    case 'wrist': up('wrist', 3); up('elbow', 2); break;
    case 'carry':
      up('wrist', 3); up('elbow', 2); up('shoulder', 1); up('neck', 2); up('upper_back', 2); up('ankle', 2); up('knee', 1); up('hip', 1);
      up('lower_back', /suitcase/.test(id) ? 3 : 2);
      if (/suitcase/.test(id)) up('hip', 2);
      if (/hang|pinch/.test(id)) { t.ankle = 0; t.knee = 0; t.hip = 0; t.lower_back = 0; t.neck = 0; }
      break;
  }
  // Dips (vertical_push or horizontal_push here), close-grip presses, upright rows.
  if (/dip/.test(id)) { up('shoulder', 3); up('elbow', 3); up('wrist', 2); }
  if (/close|diamond/.test(id) && (P === 'horizontal_push' || P === 'elbow_extension')) up('elbow', 3);
  if (/upright_row/.test(id)) { up('shoulder', 3); up('neck', 2); up('elbow', 2); up('wrist', 2); }
  if (/pike|handstand/.test(id)) { up('shoulder', 3); up('wrist', 3); up('neck', 2); }
  if (/chinup|underhand/.test(id)) up('elbow', 2);

  // ---- lower-body patterns
  switch (P) {
    case 'squat':
      up('knee', 3); up('hip', 3); up('ankle', /goblet|sumo|pistol/.test(id) ? 2 : 1); up('lower_back', /pistol|hack|goblet|sumo/.test(id) ? 2 : 1);   // leg press: back supported
      if (/pistol/.test(id)) up('ankle', 3);
      if (/goblet|sumo/.test(id)) { up('wrist', 1); up('elbow', 1); up('upper_back', 1); }
      break;
    case 'lunge':
      up('knee', 3); up('hip', /step/.test(id) ? 2 : 3); up('ankle', /db_lunge|bw_lunge|reverse_lunge|cossack/.test(id) ? 3 : 2);
      up('lower_back', /db_lunge|reverse_lunge|cossack/.test(id) ? 2 : 1);
      if (has(ex, 'dumbbell', 'kettlebell')) { up('wrist', 1); up('elbow', 1); }
      break;
    case 'knee_extension': up('knee', 3); break;
    case 'knee_flexion': up('knee', 2); up('hip', /nordic|ghd/.test(id) ? 2 : 1); if (/nordic|ghd/.test(id)) up('lower_back', 1); break;
    case 'hinge': {
      const bw = !freeLoad && !has(ex, 'band', 'cable', 'ghd');
      up('lower_back', bw ? 2 : 3); up('hip', /sumo/.test(id) ? 3 : 2); up('upper_back', bw ? 0 : 2);
      up('knee', /trap_dl|sumo|rack_pull/.test(id) ? 2 : 1);
      if (freeLoad) { up('wrist', 2); up('elbow', 1); up('shoulder', 1); }
      if (/trap_dl|rack_pull/.test(id)) up('neck', 2);
      if (/_sl_|b_stance/.test(id)) up('ankle', /_sl_/.test(id) ? 2 : 1);
      if (/pull_through/.test(id)) { t.lower_back = 2; t.upper_back = 0; }
      if (/swing/.test(id)) { up('knee', 1); up('ankle', 1); up('shoulder', 1); }
      break;
    }
    case 'hip_extension':
      up('hip', 2); up('lower_back', /bb_hip|smith_hip|machine_hip/.test(id) ? 2 : 1); up('knee', /ham_bridge/.test(id) ? 2 : 1);
      break;
    case 'abduction': case 'adduction': up('hip', 3); up('knee', 1); break;
    case 'calf':
      up('ankle', /seated|leg_press_calf/.test(id) ? 2 : 3); up('knee', 1);
      if (/standing_calf_machine|smith_calf/.test(id)) up('lower_back', 2); else if (has(ex, 'dumbbell')) up('lower_back', 1);
      if (has(ex, 'dumbbell')) up('wrist', 1);
      break;
  }

  // ---- core
  switch (P) {
    case 'core_flexion':
      if (hang || has(ex, 'dip_station')) { up('shoulder', hang ? 2 : 1); up('elbow', hang ? 2 : 1); up('wrist', hang ? 2 : 0); up('hip', 2); up('lower_back', 2); }
      else if (/leg_raise|v_up|pike|reverse_crunch/.test(id)) { up('hip', 2); up('lower_back', /leg_raise|v_up/.test(id) ? 2 : 1); if (/trx_pike/.test(id)) { up('shoulder', 2); up('wrist', 2); } }
      else { up('neck', 2); up('lower_back', 1); }
      if (/side_bend/.test(id)) { t.neck = 0; up('lower_back', 2); up('wrist', 1); }
      break;
    case 'core_anti':
      if (/rollout|body_saw/.test(id)) { up('lower_back', /body_saw/.test(id) ? 2 : 3); up('shoulder', 2); up('wrist', 2); up('elbow', 1); }
      else if (/dragon_flag/.test(id)) { up('lower_back', 3); up('shoulder', 2); up('neck', 2); up('hip', 2); }
      else if (/side_plank/.test(id)) { up('shoulder', 2); up('elbow', 1); up('hip', 1); up('lower_back', 1); }
      else if (/plank/.test(id)) { up('shoulder', 1); up('elbow', 1); up('lower_back', 1); }
      else if (/hollow/.test(id)) { up('neck', 2); up('lower_back', 1); up('hip', 1); }
      else if (/dead_bug/.test(id)) { up('hip', 1); up('neck', 1); }
      else if (/pallof/.test(id)) { up('shoulder', 1); up('lower_back', 1); }
      else if (/cobra|ytw/.test(id)) { up('lower_back', 2); up('upper_back', 2); up('neck', 2); up('shoulder', 1); }
      break;
    case 'rotation':
      up('lower_back', /landmine/.test(id) ? 3 : 2); up('shoulder', hang || /landmine/.test(id) ? 2 : 1);
      if (hang) { up('elbow', 2); up('wrist', 2); up('hip', 2); }
      if (/russian/.test(id)) { up('neck', 1); up('wrist', 1); }
      break;
    case 'conditioning':
      if (JUMPS.test(id)) { up('knee', 3); up('ankle', 3); up('hip', 3); up('lower_back', 2); }
      if (HANDS_DOWN.test(id)) { up('wrist', 3); up('shoulder', 2); up('elbow', /burpee|devil|man_maker/.test(id) ? 2 : 1); }
      if (OVERHEAD_CONDITIONING.test(id)) { up('shoulder', 3); up('neck', 2); up('upper_back', 2); up('wrist', 2); up('elbow', 2); up('knee', /thruster|wall_ball/.test(id) ? 3 : 2); up('hip', /thruster|wall_ball/.test(id) ? 3 : 2); up('ankle', 2); up('lower_back', /snatch|devil|man_maker/.test(id) ? 3 : 2); }
      if (/slam/.test(id)) { up('shoulder', 2); up('lower_back', 3); up('neck', 2); up('hip', 1); up('knee', 1); up('wrist', 1); }
      if (/mountain_climber/.test(id)) { up('hip', 2); up('knee', 2); up('ankle', 2); up('lower_back', 1); }
      if (/bear_crawl/.test(id)) { up('knee', 1); up('ankle', 2); up('hip', 1); up('lower_back', 1); }
      if (/burpee/.test(id)) up('neck', 2);
      if (/trap_jump/.test(id)) { up('wrist', 2); up('lower_back', 3); up('upper_back', 2); }
      break;
  }

  // ---- muscle credit floors: a move whose prime mover IS the area's muscles loads that area.
  up('lower_back', credit(ex, 'lower_back') >= 0.5 ? 3 : credit(ex, 'lower_back') >= 0.25 ? 2 : 0);
  up('upper_back', Math.min(2, fromCredit(Math.max(credit(ex, 'upper_back'), credit(ex, 'traps')))));
  up('wrist', credit(ex, 'forearms') >= 0.75 ? 3 : credit(ex, 'forearms') >= 0.5 ? 2 : 0);
  up('neck', credit(ex, 'traps') >= 0.75 ? 2 : 0);
  up('hip', Math.max(credit(ex, 'glute_med'), credit(ex, 'adductors')) >= 0.75 ? 2 : 0);

  Object.assign(t, OVERRIDES[id] || {});
  return t;
}

const memo = new Map();
// → { shoulder, elbow, wrist, neck, upper_back, lower_back, hip, knee, ankle } each 0..3
export function stressOf(ex) {
  if (!ex || !ex.id) return Object.fromEntries(AREAS_STRESS.map(a => [a, 0]));
  let t = memo.get(ex.id);
  if (!t) { t = Object.freeze(rules(ex)); memo.set(ex.id, t); }
  return t;
}

// Every exercise's map, for tests and a debug view: { [exId]: { [area]: tier } }.
export function stressTable() { return Object.fromEntries(EXERCISES.map(e => [e.id, stressOf(e)])); }
