// EX-LOWER: coverage rules for js/data/exercises-lower.js
import test from 'node:test';
import assert from 'node:assert/strict';
import LOWER from '../js/data/exercises-lower.js';

const GROUP_REGIONS = {
  biceps: ['biceps_long', 'biceps_short', 'brachialis'],
  triceps: ['triceps_long', 'triceps_lateral', 'triceps_medial'],
  forearms: ['forearms'],
  core: ['abs', 'obliques'],
  glutes: ['glutes', 'glute_med'],
  quads: ['quads', 'adductors'],
  hamstrings: ['hamstrings'],
  calves: ['calves'],
};
const PORTABLE = new Set(['dumbbell', 'band', 'flat_bench', 'adjustable_bench']);
const primaryIn = (ex, g) => GROUP_REGIONS[g].some(r => ex.muscles[r] === 1);
const IRON_RUNNER = {
  trap_dl: 'Trap Bar Deadlift', db_curl: 'Dumbbell Curl', db_hammer: 'Hammer Curl', db_goblet: 'Goblet Squat',
  db_tri_oh: 'Overhead Tricep Extension', db_skull: 'Skull Crusher', db_lunge: 'Walking Lunge', db_rdl: 'Romanian Deadlift',
  farmer: "Farmer's Walk", db_split: 'Bulgarian Split Squat', db_step: 'Step Up', db_calf: 'Calf Raise', leg_press: 'Leg Press',
  leg_curl: 'Seated Leg Curl', hang_knee: 'Hanging Knee Raise', plank: 'Plank', tri_pushdown: 'Cable Tricep Pushdown',
};

test('exlower: at least 130 exercises with unique ids', () => {
  assert.ok(LOWER.length >= 130, `only ${LOWER.length}`);
  assert.equal(new Set(LOWER.map(e => e.id)).size, LOWER.length);
});

test('exlower: Iron Runner ids present with matching names', () => {
  const byId = Object.fromEntries(LOWER.map(e => [e.id, e]));
  for (const [id, name] of Object.entries(IRON_RUNNER)) {
    assert.ok(byId[id], `missing ${id}`);
    assert.equal(byId[id].name, name, id);
  }
});

test('exlower: no back squats anywhere', () => {
  for (const e of LOWER) {
    assert.ok(!/back[\s_-]*squat/i.test(e.id) && !/back[\s_-]*squat/i.test(e.name), e.id);
    assert.ok(!/^(barbell|bb)[\s_]*squat$/i.test(e.id) && !/^barbell squat$/i.test(e.name), e.id);
  }
});

test('exlower: every group has >=3 bodyweight/band/DB+bench options', () => {
  for (const g of Object.keys(GROUP_REGIONS)) {
    const opts = LOWER.filter(e => primaryIn(e, g) && e.equipment.every(q => PORTABLE.has(q)));
    assert.ok(opts.length >= 3, `${g}: ${opts.map(e => e.id)}`);
    const noGear = LOWER.filter(e => primaryIn(e, g) && e.equipment.every(q => q === 'band'));
    assert.ok(noGear.length >= 1, `${g}: needs a bodyweight or band option`);
  }
});

test('exlower: cable and machine options exist where they should', () => {
  for (const g of ['biceps', 'triceps', 'forearms', 'core', 'glutes', 'quads']) {
    assert.ok(LOWER.some(e => primaryIn(e, g) && e.equipment.includes('cable')), `${g}: no cable option`);
  }
  const machines = { core: 'ab_machine', glutes: 'hip_thrust_machine', quads: 'leg_press', hamstrings: 'leg_curl', calves: 'calf_machine' };
  for (const [g, m] of Object.entries(machines)) {
    assert.ok(LOWER.some(e => primaryIn(e, g) && e.equipment.includes(m)), `${g}: no ${m} option`);
  }
});

test('exlower: schema sanity', () => {
  const ids = new Set(LOWER.map(e => e.id));
  for (const e of LOWER) {
    assert.match(e.id, /^[a-z0-9_]+$/);
    assert.ok(!e.equipment.includes('bodyweight'), `${e.id}: omit bodyweight`);
    for (const a of e.alt) assert.ok(ids.has(a), `${e.id}: alt ${a} not in file`);
    for (const v of Object.values(e.muscles)) assert.ok([1, 0.5, 0.25].includes(v), `${e.id}: weight ${v}`);
    assert.ok(e.cues.length >= 3 && e.cues.length <= 5, `${e.id}: cues`);
    assert.ok(e.why && e.yt.startsWith('https://www.youtube.com/results?search_query='), e.id);
    assert.ok(e.repRange[0] <= e.repRange[1], e.id);
    assert.ok(['compound', 'isolation'].includes(e.category), e.id);
    assert.ok(['each', 'total', 'bodyweight', 'seconds'].includes(e.unit), e.id);
    assert.ok([1, 2, 3].includes(e.difficulty) && [1, 2, 3].includes(e.fatigue), e.id);
  }
});
