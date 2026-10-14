// EX-UPPER: coverage rules for js/data/exercises-upper.js
import test from 'node:test';
import assert from 'node:assert/strict';
import upper from '../js/data/exercises-upper.js';
import { REGIONS } from '../js/data/muscles.js';
import { EQUIPMENT } from '../js/data/equipment.js';

const MY_REGIONS = ['chest_upper', 'chest_mid', 'chest_lower', 'lats', 'upper_back', 'traps', 'lower_back', 'delt_front', 'delt_side', 'delt_rear'];
const LIGHT_KIT = new Set(['band', 'dumbbell', 'flat_bench', 'adjustable_bench']);
const MACHINES = new Set(['lat_pulldown', 'seated_row_machine', 'chest_press_machine', 'shoulder_press_machine', 'pec_deck', 'rear_delt_machine', 'assisted_pullup', 'ghd', 'smith']);
const IRON_RUNNER = { db_bench: 'Dumbbell Bench Press', db_incline: 'Incline Dumbbell Press', db_decline: 'Decline Dumbbell Press', db_row: 'Dumbbell Row', db_shoulder: 'Seated Shoulder Press', trap_row: 'Trap Bar Row', db_lateral: 'Lateral Raise', trap_shrug: 'Trap Bar Shrug', db_fly: 'Dumbbell Fly', face_pull: 'Cable Face Pull', cable_row: 'Seated Cable Row', lat_pulldown: 'Lat Pulldown' };
const LOWER_OWNED = ['trap_dl', 'db_curl', 'db_hammer', 'db_goblet', 'db_tri_oh', 'db_skull', 'db_lunge', 'db_rdl', 'farmer', 'db_split', 'db_step', 'db_calf', 'leg_press', 'leg_curl', 'hang_knee', 'plank', 'tri_pushdown'];
const PATTERNS = new Set(['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull', 'hinge', 'squat', 'lunge', 'elbow_flexion', 'elbow_extension', 'lateral_raise', 'rear_delt', 'fly', 'shrug', 'core_flexion', 'core_anti', 'rotation', 'calf', 'hip_extension', 'knee_flexion', 'knee_extension', 'abduction', 'adduction', 'carry', 'wrist', 'conditioning']);

const hits = (ex, r) => (ex.muscles[r] || 0) >= 0.5;

test('library size >= 130 with unique ids', () => {
  assert.ok(upper.length >= 130, `only ${upper.length}`);
  assert.equal(new Set(upper.map(e => e.id)).size, upper.length);
});

test('Iron Runner ids present with matching names; none of EX-LOWER ids', () => {
  const byId = Object.fromEntries(upper.map(e => [e.id, e]));
  for (const [id, name] of Object.entries(IRON_RUNNER)) {
    assert.ok(byId[id], `missing ${id}`);
    assert.equal(byId[id].name, name, id);
  }
  for (const id of LOWER_OWNED) assert.ok(!byId[id], `owned by EX-LOWER: ${id}`);
});

test('schema: fields, weights, enums, alts', () => {
  const ids = new Set(upper.map(e => e.id));
  for (const e of upper) {
    assert.match(e.id, /^[a-z0-9_]+$/);
    assert.ok(e.name && e.why && e.yt.startsWith('https://www.youtube.com/results?search_query='), e.id);
    assert.ok(['compound', 'isolation'].includes(e.category), e.id);
    assert.ok(PATTERNS.has(e.pattern), `${e.id} pattern ${e.pattern}`);
    assert.ok(['each', 'total', 'bodyweight', 'seconds'].includes(e.unit), e.id);
    assert.ok(e.cues.length >= 3 && e.cues.length <= 5, `${e.id} cues`);
    assert.ok(Array.isArray(e.repRange) && e.repRange[0] <= e.repRange[1], e.id);
    assert.ok([1, 2, 3].includes(e.difficulty) && [1, 2, 3].includes(e.fatigue), e.id);
    assert.ok(typeof e.step === 'number' && e.secPerRep > 0 && e.setupSec >= 0, e.id);
    assert.ok(!e.equipment.includes('bodyweight'), `${e.id} lists bodyweight`);
    for (const q of e.equipment) assert.ok(EQUIPMENT[q], `${e.id} equipment ${q}`);
    for (const [r, w] of Object.entries(e.muscles)) {
      assert.ok(REGIONS[r], `${e.id} region ${r}`);
      assert.ok([1, 0.5, 0.25].includes(w), `${e.id} weight ${r}=${w}`);
    }
    if (!e.tags.includes('warmup')) assert.ok(Object.values(e.muscles).includes(1), `${e.id} has no prime mover`);
    for (const a of e.alt) assert.ok(ids.has(a) && a !== e.id, `${e.id} bad alt ${a}`);
  }
});

test('every region has >=3 bodyweight/band/dumbbell+bench options, a cable and a machine option', () => {
  for (const r of MY_REGIONS) {
    const opts = upper.filter(e => hits(e, r));
    const light = opts.filter(e => e.equipment.every(q => LIGHT_KIT.has(q)));
    assert.ok(light.length >= 3, `${r}: only ${light.length} light-kit options`);
    assert.ok(opts.some(e => e.equipment.includes('cable')), `${r}: no cable option`);
    assert.ok(opts.some(e => e.equipment.some(q => MACHINES.has(q))), `${r}: no machine option`);
  }
});

test('every group has no-equipment and band options', () => {
  const groups = { chest: ['chest_upper', 'chest_mid', 'chest_lower'], back: ['lats', 'upper_back', 'traps', 'lower_back'], shoulders: ['delt_front', 'delt_side', 'delt_rear'] };
  for (const [g, rs] of Object.entries(groups)) {
    const opts = upper.filter(e => rs.some(r => e.muscles[r] === 1));
    assert.ok(opts.filter(e => e.equipment.length === 0).length >= 3, `${g}: bodyweight`);
    assert.ok(opts.filter(e => e.equipment.length === 1 && e.equipment[0] === 'band').length >= 3, `${g}: band`);
  }
});

test('covers every equipment family for upper body', () => {
  const used = new Set(upper.flatMap(e => e.equipment));
  for (const q of ['dumbbell', 'cable', 'barbell', 'smith', 'trap_bar', 'kettlebell', 'landmine', 'band', 'trx', 'pullup_bar', 'dip_station', 'lat_pulldown', 'seated_row_machine', 'chest_press_machine', 'shoulder_press_machine', 'pec_deck', 'rear_delt_machine', 'assisted_pullup']) {
    assert.ok(used.has(q), `no exercise uses ${q}`);
  }
});

test('sculpt emphasis coverage', () => {
  const count = t => upper.filter(e => e.emphasis.includes(t)).length;
  for (const t of ['lat_width', 'back_thickness', 'upper_chest', 'chest_fullness', 'shoulder_width', 'capped_delts', 'rear_delts', 'traps_yoke', 'v_taper']) {
    assert.ok(count(t) >= 4, `${t}: ${count(t)}`);
  }
});
