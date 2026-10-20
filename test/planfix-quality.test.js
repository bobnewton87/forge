// PLAN-FIX: generator selection quality (staple openers, superset limiters, pattern caps,
// equipment quality, favourites) + Plan quick-cardio helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkout } from '../js/engine/generator.js';
import { getEx } from '../js/data/exercises.js';
import { DEFAULT_LOCATIONS } from '../js/data/equipment.js';
import { REGIONS } from '../js/data/muscles.js';
import { withExtraCardio, suggestSlot } from '../js/ui/plan.js';
import { defaultProfile } from '../js/store.js';

const NOW = new Date(2026, 9, 19, 12);
const LOC = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.id, l]));
const PROFILE = { sculptGoals: ['triceps_mass', 'shoulder_width', 'six_pack', 'lat_width', 'upper_chest'], groupPriority: {}, avoidExercises: [], favoriteExercises: [] };
const lifts = s => s.blocks.filter(b => b.kind === 'lift');
const pg = ex => { let best = null, bw = -1; for (const [r, w] of Object.entries(ex.muscles)) if (w > bw) { best = r; bw = w; } return REGIONS[best].group; };
const STAPLE_OPENERS = {
  chest: ['db_incline', 'db_bench', 'machine_chest_press', 'machine_incline_press', 'db_incline_low', 'smith_incline', 'cable_press_standing', 'dip_chest', 'landmine_chest_press', 'pushup_deficit', 'pushup', 'pushup_decline'],
  back: ['lat_pulldown', 'pullup', 'chinup', 'pullup_neutral', 'assisted_pullup', 'cable_row', 'machine_row', 'db_row', 'trap_row', 'db_chest_row', 'inverted_row', 'door_row'],
  shoulders: ['db_shoulder', 'machine_shoulder_press', 'db_arnold', 'db_standing_press', 'smith_shoulder_press', 'db_single_press', 'kb_press', 'landmine_press', 'pike_pushup'],
};
const each = (fn) => {
  for (const loc of [LOC.home, LOC.crunch, LOC.travel]) for (const minutes of [20, 30, 45, 60])
    for (const targets of [['chest'], ['back'], ['shoulders'], ['push'], ['pull'], ['upper'], ['arms'], ['chest', 'triceps']])
      for (const seed of [1, 7]) fn(buildWorkout({ targets, minutes, location: loc, profile: PROFILE, now: NOW, seed }), { loc, minutes, targets, seed });
};

test('the first exercise for chest / back / shoulders is a staple for that equipment', () => {
  each((s, k) => {
    const seen = new Set();
    for (const b of lifts(s)) {
      const ex = getEx(b.exId); const g = pg(ex);
      if (seen.has(g)) continue; seen.add(g);
      const req = new Set(k.targets.flatMap(t => ({ push: ['chest', 'shoulders', 'triceps'], pull: ['back', 'biceps'], upper: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] })[t] || [t]));
      if (STAPLE_OPENERS[g] && req.has(g)) {
        assert.ok(STAPLE_OPENERS[g].includes(ex.id), `${k.loc.id} ${k.minutes} ${k.targets}: ${g} opens with ${ex.id}`);
      }
    }
  });
  // gym chest day opens with a real press, never reverse-grip / JM / dips
  const s = buildWorkout({ targets: ['chest'], minutes: 20, location: LOC.crunch, profile: PROFILE, now: NOW, seed: 3 });
  assert.ok(['db_incline', 'db_bench', 'machine_chest_press', 'machine_incline_press', 'db_incline_low'].includes(lifts(s)[0].exId), lifts(s)[0].exId);
});

test('supersets never pair moves that share a limiting muscle (grip, triceps, front-delt presses)', () => {
  each((s, k) => {
    const groups = {};
    for (const b of lifts(s)) if (b.group) (groups[b.group] ||= []).push(getEx(b.exId));
    for (const members of Object.values(groups)) {
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];
        const tag = `${k.loc.id} ${k.minutes} ${k.targets}: ${a.id} + ${b.id}`;
        const hang = x => x.pattern === 'carry' || /hang/.test(x.id);
        assert.ok(!(hang(a) && b.pattern === 'elbow_flexion') && !(hang(b) && a.pattern === 'elbow_flexion'), 'grip: ' + tag);
        const tri = x => Math.max(x.muscles.triceps_long || 0, x.muscles.triceps_lateral || 0, x.muscles.triceps_medial || 0);
        assert.ok(!(tri(a) >= 0.5 && tri(b) >= 0.5), 'triceps: ' + tag);
        assert.ok(!(a.category === 'compound' && b.category === 'compound' && (a.muscles.delt_front || 0) >= 0.5 && (b.muscles.delt_front || 0) >= 0.5), 'presses: ' + tag);
      }
    }
  });
});

test('requested groups come first; fill-in groups follow; patterns are not stacked', () => {
  each((s, k) => {
    const ls = lifts(s).map(b => getEx(b.exId));
    const byPattern = {};
    for (const ex of ls) byPattern[ex.pattern] = (byPattern[ex.pattern] || 0) + 1;
    const cap = k.minutes >= 60 ? 4 : 3;     // tuning may add one past the soft cap of 2/3
    for (const [p, n] of Object.entries(byPattern)) assert.ok(n <= cap, `${k.loc.id} ${k.minutes} ${k.targets}: ${n}× ${p}`);
  });
  const s = buildWorkout({ targets: ['biceps'], minutes: 45, location: LOC.home, profile: PROFILE, now: NOW, seed: 2 });
  assert.equal(pg(getEx(lifts(s)[0].exId)), 'biceps', 'biceps day starts with biceps, not triceps presses');
});

test('equipment quality: no band / makeshift moves at the gym when cables and dumbbells exist', () => {
  for (const targets of [['back'], ['shoulders'], ['biceps'], ['triceps'], ['chest']]) for (const minutes of [30, 45]) {
    const s = buildWorkout({ targets, minutes, location: LOC.crunch, profile: PROFILE, now: NOW, seed: 5 });
    for (const b of lifts(s)) {
      const ex = getEx(b.exId);
      assert.ok(!ex.equipment.includes('band') && !/^towel_|_iso$|table_curl|door_row/.test(ex.id) || ex.id === 'machine_pulldown_iso', `${targets} ${minutes}: ${ex.id}`);
    }
  }
});

test('favourites open their group and avoids are never programmed', () => {
  const p = { ...PROFILE, favoriteExercises: ['machine_chest_press'], avoidExercises: ['db_incline', 'db_bench'] };
  for (const seed of [1, 2, 3]) {
    const s = buildWorkout({ targets: ['chest'], minutes: 45, location: LOC.crunch, profile: p, now: NOW, seed });
    assert.equal(lifts(s)[0].exId, 'machine_chest_press');
    assert.ok(!lifts(s).some(b => p.avoidExercises.includes(b.exId)));
  }
});

test('withExtraCardio extends the last cardio block or appends an easy finisher', () => {
  const lift = { blocks: [{ kind: 'lift', exId: 'db_curl', target: { sets: 3 }, sets: [] }], minutes: 30, estMinutes: 29 };
  const a = withExtraCardio(lift, 10, LOC.crunch);
  assert.equal(a.blocks.at(-1).kind, 'cardio');
  assert.equal(a.blocks.at(-1).minutes, 10);
  assert.equal(a.blocks.at(-1).intensity, 'easy');
  assert.equal(a.minutes, 40); assert.equal(a.estMinutes, 39);
  assert.equal(lift.blocks.length, 1, 'input untouched');
  const b = withExtraCardio(a, 20, LOC.crunch);
  assert.equal(b.blocks.filter(x => x.kind === 'cardio').length, 1);
  assert.equal(b.blocks.at(-1).minutes, 30);
  const c = withExtraCardio({ blocks: [{ kind: 'cardio', modality: 'run', minutes: 30, intensity: 'easy' }], minutes: 30, title: 'Run · 30 min' }, 10, LOC.home);
  assert.equal(c.title, 'Run · 40 min');
  const office = withExtraCardio({ blocks: [], minutes: 0 }, 10, LOC.office);
  assert.ok(office.blocks[0].modality, 'some modality even with no machines');
});

test('suggestSlot keeps a customized day\'s location/minutes, honours an explicit pick, and fixes class-at-home', () => {
  const p = defaultProfile();
  const date = '2026-10-21';   // Wednesday: cardio 30 at home by default
  assert.deepEqual(suggestSlot(p, date, null), { kind: 'cardio', minutes: 30, location: 'home' });
  const custom = { status: 'planned', date, location: 'crunch', minutes: 50, blocks: [{ kind: 'cardio', minutes: 50 }], plan: { auto: false, kind: 'cardio', extraCardio: 20 } };
  assert.deepEqual(suggestSlot(p, date, custom), { kind: 'cardio', minutes: 30, location: 'crunch' }, 'extra cardio is re-applied later, not baked in');
  assert.equal(suggestSlot(p, date, custom, 'travel').location, 'travel');
  p.schedule.wed = { kind: 'class', minutes: 45, location: 'crunch' };
  assert.equal(suggestSlot(p, date, null, 'home').kind, 'flex');
  p.schedule.sun = { kind: 'rest', minutes: 0, location: 'home' };
  assert.equal(suggestSlot(p, '2026-10-25', null).kind, 'lift', 'asking on a rest day means a workout');
});
