import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultProfile } from '../js/store.js';
import { simulateDone, planRange, suggestForDay, weekPlanSummary } from '../js/engine/planner.js';
import { groupStatus, sessionVolume } from '../js/engine/recovery.js';
import { ds, addDays, parseDs } from '../js/util.js';

const CS = JSON.parse(fs.readFileSync(new URL('../data/crunch-schedule.json', import.meta.url)));
const MON = '2026-10-19';                       // a Monday (matches the bundled class schedule week)
const NOW = new Date(2026, 9, 19, 6, 0);        // 06:00 Monday, before any class
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dow = d => DOW[parseDs(d).getDay()];
const profile = () => defaultProfile();

const week = (opts = {}) => planRange({ from: MON, days: 7, profile: opts.profile || profile(), sessions: opts.sessions || [], classSchedule: opts.classSchedule ?? null, now: NOW, ...opts });

// ---------------------------------------------------------------- simulateDone
test('simulateDone marks every set done with target reps/weight, on a copy', () => {
  const s = {
    id: 'x', date: '2026-10-20', status: 'planned', startedAt: null, endedAt: null, minutes: 45, location: 'home',
    blocks: [
      { kind: 'lift', exId: 'db_curl', group: null, target: { sets: 3, repMin: 8, repMax: 12, rest: 60, weight: 30, reps: 10, note: null }, sets: [{ w: null, r: null, done: false }, { w: null, r: null, done: false }, { w: null, r: null, done: false }] },
      { kind: 'lift', exId: 'db_lateral', group: null, target: { sets: 2, repMin: 12, repMax: 15, rest: 60, weight: null, reps: null, note: null }, sets: [{ w: null, r: null, done: false }, { w: null, r: null, done: false }] },
      { kind: 'cardio', modality: 'bike', minutes: 10, intensity: 'easy', distance: null, calories: null, done: false, note: null },
    ],
  };
  const d = simulateDone(s);
  assert.notEqual(d, s);
  assert.equal(s.blocks[0].sets[0].done, false, 'original untouched');
  assert.equal(s.startedAt, null);
  assert.equal(d.status, 'done');
  assert.deepEqual(d.blocks[0].sets, [{ w: 30, r: 10, done: true }, { w: 30, r: 10, done: true }, { w: 30, r: 10, done: true }]);
  assert.deepEqual(d.blocks[1].sets.map(x => x.r), [12, 12], 'falls back to repMin');
  assert.equal(d.blocks[2].done, true);
  assert.equal(ds(new Date(d.startedAt)), '2026-10-20');
  assert.equal(new Date(d.startedAt).getHours(), 7);
  assert.equal((new Date(d.endedAt) - new Date(d.startedAt)) / 60e3, 45);
  const v = sessionVolume(d);
  assert.equal(v.liftSets, 5);
  assert.equal(v.cardioMin, 10);
});

test('simulateDone uses the class start time and marks class done', () => {
  const s = { id: 'c', date: '2026-10-22', status: 'planned', minutes: 30, blocks: [{ kind: 'class', provider: 'crunch', name: 'Top it Off', time: '5:30 pm', duration: 30, instructor: null, classify: { type: 'sculpt', cardioMinutes: 8, intensity: 'moderate', muscles: { delt_side: 1.5 } }, done: false }] };
  const d = simulateDone(s);
  assert.equal(d.blocks[0].done, true);
  assert.equal(new Date(d.startedAt).getHours(), 17);
  assert.equal(new Date(d.startedAt).getMinutes(), 30);
});

// ---------------------------------------------------------------- planRange basics
test('a week from the default schedule plans every non-rest day and nothing on rest days', () => {
  const p = profile();
  const out = week({ profile: p });
  const dates = out.map(s => s.date);
  assert.equal(new Set(dates).size, dates.length, 'one session per day');
  for (let i = 0; i < 7; i++) {
    const d = ds(addDays(parseDs(MON), i));
    const kind = p.schedule[dow(d)].kind;
    assert.equal(dates.includes(d), kind !== 'rest', `${d} (${kind})`);
  }
  for (const s of out) {
    assert.equal(s.status, 'planned');
    assert.equal(s.plan.auto, true);
    assert.ok(['lift', 'cardio', 'class'].includes(s.plan.kind));
    assert.equal(s.plan.generatedAt, NOW.toISOString());
    assert.ok(s.plan.reason && typeof s.plan.reason === 'string');
    assert.ok(Array.isArray(s.rationale) && s.rationale.length >= 1);
    assert.match(s.id, new RegExp('^s_plan_' + s.date + '_\\d+$'));
    assert.ok(s.blocks.length > 0);
    const slot = p.schedule[dow(s.date)];
    if (slot.kind === 'lift') assert.equal(s.plan.kind, 'lift');
    if (slot.kind === 'cardio') { assert.equal(s.plan.kind, 'cardio'); assert.equal(s.blocks[0].kind, 'cardio'); }
    if (s.plan.kind === 'lift') {
      assert.ok(s.blocks.some(b => b.kind === 'lift'));
      assert.equal(s.location, slot.location);
      assert.ok(Math.abs(s.estMinutes - s.minutes) <= s.minutes * 0.2, `${s.date} est ${s.estMinutes} vs ${s.minutes}`);
    }
  }
});

test('ids are unique and avoid existing ids', () => {
  const existing = [{ id: 's_plan_2026-10-19_1', date: '2026-10-12', status: 'done', blocks: [] }];
  const out = week({ sessions: existing });
  const mon = out.find(s => s.date === MON);
  assert.equal(mon.id, 's_plan_2026-10-19_2');
  assert.equal(new Set(out.map(s => s.id)).size, out.length);
});

test('kept (auto:false) sessions are preserved and planned around', () => {
  const p = profile();
  // Bob customized Tuesday: a big shoulders + triceps session.
  const custom = planRange({ from: '2026-10-20', days: 1, profile: p, sessions: [], now: NOW })[0];
  const tuesday = { ...custom, id: 's_custom_tue', plan: { ...custom.plan, auto: false } };
  const restWed = { id: 's_rest_wed', date: '2026-10-21', status: 'planned', plan: { kind: 'rest', auto: false }, blocks: [] };
  const staleAuto = { ...custom, id: 's_old_auto', date: '2026-10-23', plan: { ...custom.plan, auto: true } };
  const out = week({ profile: p, sessions: [tuesday, restWed, staleAuto] });
  const dates = out.map(s => s.date);
  assert.ok(!dates.includes('2026-10-20'), 'no new session on the kept day');
  assert.ok(!dates.includes('2026-10-21'), 'forced rest respected');
  assert.ok(dates.includes('2026-10-23'), 'auto session is replaced, not kept');
  assert.ok(!out.some(s => s.id === tuesday.id || s.id === restWed.id));
  // Wednesday-after: Thursday plan sees Tuesday's work (recovery/volume) → differs from planning without it
  const tueGroups = Object.entries(sessionVolume(simulateDone(tuesday)).groups).filter(([, w]) => w >= 3).map(([g]) => g);
  assert.ok(tueGroups.length > 0);
  const gsMonNoon = groupStatus([...out.filter(s => s.date < '2026-10-22'), tuesday].map(simulateDone), { now: new Date(2026, 9, 22, 12), profile: p });
  for (const g of tueGroups) assert.ok(gsMonNoon[g].sets7d >= 3, `${g} volume from kept Tuesday is counted`);
});

test('a kept session with a custom kind on a rest day is still respected and counted', () => {
  const p = profile();
  const sun = { id: 's_sun', date: '2026-10-25', status: 'planned', minutes: 40, location: 'home', plan: { kind: 'cardio', auto: false }, blocks: [{ kind: 'cardio', modality: 'run', minutes: 40, intensity: 'easy', distance: null, calories: null, done: false, note: null }] };
  const out = week({ profile: p, sessions: [sun] });
  assert.ok(!out.some(s => s.date === '2026-10-25'));
  const sum = weekPlanSummary([...out, sun], { weekStart: parseDs(MON), profile: p, now: NOW });
  assert.ok(sum.cardioMinutes.planned >= 40 + 30);
});

test('days that already have a done session are skipped; past days are not planned', () => {
  const p = profile();
  const now = new Date(2026, 9, 21, 9);   // Wednesday morning
  const done = simulateDone(planRange({ from: '2026-10-21', days: 1, profile: p, now })[0]);
  const out = planRange({ from: MON, days: 7, profile: p, sessions: [done], now });
  assert.ok(out.every(s => s.date > '2026-10-21'), out.map(s => s.date).join(','));
});

// ---------------------------------------------------------------- recovery + spreading
test('no targeted group is hit on consecutive days while readiness is low', () => {
  const p = profile();
  const out = planRange({ from: MON, days: 21, profile: p, sessions: [], now: NOW, classSchedule: CS });
  const sims = out.map(simulateDone);
  for (const s of out.filter(x => x.plan.kind === 'lift')) {
    const before = sims.filter(x => x.date < s.date);
    const gs = groupStatus(before, { now: new Date(parseDs(s.date).getTime() + 12 * 3600e3), profile: p });
    for (const g of s.plan.groups) {
      assert.ok(gs[g].readiness >= 0.5, `${s.date} targets ${g} at readiness ${gs[g].readiness}`);
    }
    // and nothing big hammered at low readiness
    const v = sessionVolume(simulateDone(s)).groups;
    for (const [g, w] of Object.entries(v)) {
      if (w >= 4) assert.ok(gs[g].readiness >= 0.4, `${s.date}: ${w} sets of ${g} at readiness ${gs[g].readiness}`);
    }
  }
});

test('priority groups reach target.min across a typical week, or a warning explains the gap', () => {
  const p = profile();
  const out = week({ profile: p, classSchedule: CS });
  const sum = weekPlanSummary(out, { weekStart: parseDs(MON), profile: p, now: NOW });
  const under = [];
  for (const g of ['triceps', 'shoulders', 'core', 'back', 'chest']) {
    const x = sum.groups[g];
    assert.ok(x.total > 0, `${g} gets some work`);
    assert.ok(x.total >= x.target.min * 0.6, `${g} ${x.total}/${x.target.min} is not wildly under`);
    if (x.total < x.target.min) {
      under.push(g);
      assert.ok(sum.warnings.some(w => w.toLowerCase().includes(g === 'core' ? 'core' : g)), `warning for ${g}: ${sum.warnings.join(' | ')}`);
    }
  }
  if (under.length >= 2) assert.ok(sum.warnings.some(w => /lifting time/.test(w)), 'capacity explanation');
  // priority groups get more than legs
  const legs = ['quads', 'hamstrings', 'glutes'].reduce((a, g) => a + sum.groups[g].total, 0);
  const prio = ['triceps', 'shoulders', 'core'].reduce((a, g) => a + sum.groups[g].total, 0);
  assert.ok(prio > legs * 2, `priority ${prio} vs legs ${legs}`);
});

test('with generous lift time, priority groups hit their minimums', () => {
  const p = profile();
  p.schedule = {
    mon: { kind: 'lift', minutes: 75, location: 'crunch' }, tue: { kind: 'lift', minutes: 75, location: 'crunch' },
    wed: { kind: 'lift', minutes: 75, location: 'crunch' }, thu: { kind: 'lift', minutes: 75, location: 'crunch' },
    fri: { kind: 'lift', minutes: 75, location: 'crunch' }, sat: { kind: 'lift', minutes: 75, location: 'crunch' },
    sun: { kind: 'rest', minutes: 0, location: 'home' },
  };
  p.cardioTargetMin = 0;
  const out = week({ profile: p });
  const sum = weekPlanSummary(out, { weekStart: parseDs(MON), profile: p, now: NOW });
  for (const g of ['triceps', 'core', 'back', 'chest']) {
    assert.ok(sum.groups[g].total >= sum.groups[g].target.min, `${g} ${sum.groups[g].total}/${sum.groups[g].target.min}; ${sum.warnings.join(' | ')}`);
  }
  assert.ok(sum.groups.shoulders.total >= sum.groups.shoulders.target.min * 0.85);
  assert.ok(sum.score >= 80, 'score ' + sum.score);
});

// ---------------------------------------------------------------- cardio
test('cardio minutes approach cardioTargetMin, with ~1 quality session and the rest easy', () => {
  const p = profile();
  for (const from of [MON, '2026-10-26', '2026-11-02']) {
    const out = planRange({ from, days: 7, profile: p, now: NOW });
    const sum = weekPlanSummary(out, { weekStart: parseDs(from), profile: p, now: NOW });
    assert.ok(sum.cardioMinutes.planned >= p.cardioTargetMin * 0.75, `${from}: ${sum.cardioMinutes.planned}/${p.cardioTargetMin}`);
    const cardioBlocks = out.flatMap(s => s.blocks.filter(b => b.kind === 'cardio' && b.minutes >= 20));
    const hard = cardioBlocks.filter(b => b.intensity === 'hard' || b.intensity === 'intervals');
    assert.ok(hard.length >= 1 && hard.length <= 1, `${from}: ${hard.length} hard sessions`);
    assert.ok(cardioBlocks.filter(b => b.intensity === 'easy').length >= 1 || cardioBlocks.length === 1);
    const opts = out.filter(s => s.plan.kind === 'cardio');
    for (const s of opts) assert.ok(s.blocks[0].note, 'cardio has a note');
  }
});

test('cardio modality is available at the location', async () => {
  const { cardioOptions } = await import('../js/data/cardio.js');
  const { expandEquipment } = await import('../js/data/equipment.js');
  const p = profile();
  p.schedule.wed = { kind: 'cardio', minutes: 40, location: 'office' };
  const out = week({ profile: p });
  const wed = out.find(s => s.date === '2026-10-21');
  const loc = p.locations.find(l => l.id === 'office');
  const ok = cardioOptions(expandEquipment(loc.equipment)).map(c => c.id);
  assert.ok(ok.includes(wed.blocks[0].modality), wed.blocks[0].modality);
  assert.equal(wed.blocks[0].minutes, 40);
});

test('zero cardio target: no finishers and flex leans to lifting', () => {
  const p = profile(); p.cardioTargetMin = 0;
  const out = week({ profile: p });
  assert.ok(out.filter(s => s.plan.kind === 'lift').every(s => !s.blocks.some(b => b.kind === 'cardio')));
  assert.equal(out.find(s => s.date === '2026-10-24').plan.kind, 'lift');
});

// ---------------------------------------------------------------- classes
test('flex day with a fitting class can pick it; class block carries classify info', () => {
  const p = profile();
  // a flex day where cardio is behind: class with lots of cardio should be attractive
  const out = week({ profile: p, classSchedule: CS });
  const sat = out.find(s => s.date === '2026-10-24');
  assert.ok(sat, 'saturday planned');
  assert.equal(sat.plan.kind, 'class', `picked ${sat.plan.kind}: ${sat.plan.reason}`);
  const cb = sat.blocks.find(b => b.kind === 'class');
  assert.ok(cb.classify && cb.classify.muscles && typeof cb.classify.cardioMinutes === 'number');
  assert.equal(cb.provider, 'crunch');
  assert.ok(cb.duration <= 65);
  assert.equal(sat.source, 'class');
  const satClasses = CS.days.find(d => d.date === '2026-10-24').classes.map(c => c.name);
  assert.ok(satClasses.includes(cb.name));
});

test('class slot falls back to lift/cardio when classSchedule is null or lacks the date', () => {
  const p = profile();
  p.schedule.thu = { kind: 'class', minutes: 45, location: 'crunch' };
  for (const cs of [null, { days: [{ date: '2030-01-01', classes: [] }] }]) {
    const out = week({ profile: p, classSchedule: cs });
    const thu = out.find(s => s.date === '2026-10-22');
    assert.ok(thu && ['lift', 'cardio'].includes(thu.plan.kind));
    assert.ok(thu.rationale.some(r => /class/i.test(r)));
  }
  const withCs = week({ profile: p, classSchedule: CS }).find(s => s.date === '2026-10-22');
  assert.equal(withCs.plan.kind, 'class');
});

test('class picking prefers classes that credit under-target upper-body muscles when cardio is met', () => {
  const p = profile();
  p.cardioTargetMin = 30;
  p.schedule = { ...p.schedule, wed: { kind: 'cardio', minutes: 45, location: 'home' }, thu: { kind: 'class', minutes: 30, location: 'crunch' } };
  const out = week({ profile: p, classSchedule: CS });
  const thu = out.find(s => s.date === '2026-10-22');
  assert.equal(thu.plan.kind, 'class');
  const c = thu.blocks[0];
  assert.ok(!['cycle', 'cardio_dance'].includes(c.classify.type), `picked ${c.name} although cardio is met`);
  assert.ok(thu.rationale.some(r => /under-target/.test(r) && /Triceps|Shoulders/.test(r)), thu.rationale.join(' | '));
});

test('classes at unreasonable hours or already started today are skipped', () => {
  const p = profile();
  p.schedule.mon = { kind: 'class', minutes: 60, location: 'crunch' };
  const late = { days: [{ date: MON, classes: [
    { name: 'The Ride', time: '5:00 am', start: '05:00', duration: 45, instructor: 'X' },
    { name: 'Top it Off', time: '9:00 pm', start: '21:00', duration: 30, instructor: 'Y' },
  ] }] };
  const mon = week({ profile: p, classSchedule: late }).find(s => s.date === MON);
  assert.notEqual(mon.plan.kind, 'class');
  // now = 18:00, class at 17:30 already started
  const cs2 = { days: [{ date: MON, classes: [{ name: 'Top it Off', time: '5:30 pm', start: '17:30', duration: 30 }] }] };
  const mon2 = planRange({ from: MON, days: 1, profile: p, classSchedule: cs2, now: new Date(2026, 9, 19, 18) })[0];
  assert.notEqual(mon2.plan.kind, 'class');
  const mon3 = planRange({ from: MON, days: 1, profile: p, classSchedule: cs2, now: new Date(2026, 9, 19, 9) })[0];
  assert.equal(mon3.plan.kind, 'class');
  assert.equal(mon3.blocks[0].classify.type, 'sculpt', 'classify computed when missing');
});

// ---------------------------------------------------------------- determinism + variety
const strip = out => out.map(s => ({ id: s.id, date: s.date, kind: s.plan.kind, title: s.title, blocks: s.blocks.map(b => b.exId || b.modality || b.name) }));

test('deterministic for the same inputs and seed', () => {
  const p = profile();
  const a = planRange({ from: MON, days: 14, profile: p, classSchedule: CS, now: NOW, seed: 7 });
  const b = planRange({ from: MON, days: 14, profile: profile(), classSchedule: CS, now: NOW, seed: 7 });
  assert.deepEqual(strip(a), strip(b));
  assert.deepEqual(a, b);
});

test('weeks are not exact repeats', () => {
  const p = profile();
  const out = planRange({ from: MON, days: 28, profile: p, now: NOW });
  const byWeek = [0, 1, 2, 3].map(w => out.filter(s => s.date >= ds(addDays(parseDs(MON), 7 * w)) && s.date < ds(addDays(parseDs(MON), 7 * w + 7))));
  const sig = ss => JSON.stringify(ss.map(s => s.blocks.map(b => b.exId || b.modality)));
  const sigs = byWeek.map(sig);
  for (let i = 1; i < 4; i++) assert.notEqual(sigs[i], sigs[i - 1], `week ${i} repeats week ${i - 1}`);
  // same weekday a week apart rarely has the identical exercise list
  let same = 0, n = 0;
  for (const s of out.filter(x => x.plan.kind === 'lift')) {
    const prev = out.find(x => x.date === ds(addDays(parseDs(s.date), -7)));
    if (!prev) continue;
    n++;
    if (JSON.stringify(prev.blocks.map(b => b.exId)) === JSON.stringify(s.blocks.map(b => b.exId))) same++;
  }
  assert.ok(same <= n / 4, `${same}/${n} identical repeats`);
});

test('different seeds can change the plan', () => {
  const p = profile();
  const sigs = new Set([1, 2, 3, 4, 5].map(seed => JSON.stringify(strip(planRange({ from: MON, days: 7, profile: p, now: NOW, seed })))));
  assert.ok(sigs.size >= 2);
});

// ---------------------------------------------------------------- suggestForDay
test('suggestForDay returns null on rest days and a session otherwise', () => {
  const p = profile();
  assert.equal(suggestForDay('2026-10-25', { profile: p, sessions: [], now: NOW }), null);
  const s = suggestForDay('2026-10-22', { profile: p, sessions: [], now: NOW });
  assert.equal(s.plan.kind, 'lift');
  assert.equal(s.date, '2026-10-22');
  assert.equal(s.plan.auto, true);
});

test('suggestForDay builds on planned sessions before the date and honors a slot override', () => {
  const p = profile();
  // INTEGRATOR: the weekly-minimums top-up edits earlier days after later ones were decided, so
  // compare decisions against the greedy walk itself (topUp:false).
  const plan = week({ profile: p, topUp: false });
  // PLAN-FIX: suggestForDay also sees planned days AFTER the date (planRange's forward pass can't),
  // so compare like with like: only the days up to Thursday as context.
  const thu = suggestForDay('2026-10-22', { profile: p, sessions: plan.filter(s => s.date <= '2026-10-22'), now: NOW });
  const fresh = plan.find(s => s.date === '2026-10-22');
  assert.equal(thu.plan.kind, 'lift');
  assert.deepEqual(thu.plan.groups.slice().sort(), fresh.plan.groups.slice().sort(), 'same context → same decision');
  assert.notEqual(thu.id, fresh.id, 'new id does not collide with the existing plan');
  const sunday = suggestForDay('2026-10-25', { profile: p, sessions: plan, now: NOW, slot: { kind: 'cardio', minutes: 25, location: 'travel' } });
  assert.equal(sunday.plan.kind, 'cardio');
  assert.equal(sunday.blocks[0].minutes, 25);
  assert.equal(sunday.location, 'travel');
});

// ---------------------------------------------------------------- weekPlanSummary
test('weekPlanSummary splits done vs planned and flags back-to-back + cardio', () => {
  const p = profile();
  const now = new Date(2026, 9, 21, 20);          // Wednesday evening
  const plan = planRange({ from: MON, days: 7, profile: p, now: NOW });
  const sessions = plan.map(s => (s.date <= '2026-10-21' ? simulateDone(s) : s));
  const sum = weekPlanSummary(sessions, { weekStart: parseDs(MON), profile: p, now });
  assert.equal(sum.sessions.done, plan.filter(s => s.date <= '2026-10-21').length);
  assert.equal(sum.sessions.planned, plan.length - sum.sessions.done);
  for (const [g, x] of Object.entries(sum.groups)) {
    assert.ok(Math.abs(x.total - (x.done + x.planned)) < 0.11, g);
    assert.ok(['under', 'ok', 'over'].includes(x.status));
    assert.ok(x.target.min > 0);
  }
  assert.ok(sum.score >= 0 && sum.score <= 100);
  assert.ok(sum.regions.delt_side && sum.regions.abs && sum.regions.lats && sum.regions.chest_upper);
  assert.equal(sum.cardioMinutes.target, 120);

  // back-to-back: same heavy shoulder session two days running
  const shoulder = planRange({ from: MON, days: 1, profile: p, now: NOW })[0];
  const twice = [shoulder, { ...shoulder, id: 'b', date: '2026-10-20' }];
  const s2 = weekPlanSummary(twice, { weekStart: MON, profile: p, now: NOW });
  assert.ok(s2.warnings.some(w => /back-to-back/.test(w) && /Mon and Tue/.test(w)), s2.warnings.join(' | '));
  assert.ok(s2.warnings.some(w => /^Cardio/.test(w)));
});

test('weekPlanSummary on an empty week', () => {
  const sum = weekPlanSummary([], { weekStart: parseDs(MON), profile: profile(), now: NOW });
  assert.equal(sum.sessions.done, 0);
  assert.equal(sum.cardioMinutes.planned, 0);
  assert.ok(sum.score <= 5);
  assert.ok(sum.warnings.length > 0);
});

test('weekPlanSummary ignores missed past planned sessions and forced rest', () => {
  const p = profile();
  const plan = planRange({ from: MON, days: 7, profile: p, now: NOW });
  const later = new Date(2026, 9, 23, 12);
  const sum = weekPlanSummary(plan, { weekStart: parseDs(MON), profile: p, now: later });
  assert.equal(sum.sessions.planned, plan.filter(s => s.date >= '2026-10-23').length);
  const rest = { id: 'r', date: '2026-10-24', status: 'planned', plan: { kind: 'rest', auto: false }, blocks: [] };
  assert.equal(weekPlanSummary([rest], { weekStart: parseDs(MON), profile: p, now: NOW }).sessions.planned, 0);
});

// ---------------------------------------------------------------- performance
test('28-day plan runs fast, even with months of history', () => {
  const p = profile();
  // Build ~16 weeks of realistic history by planning and "doing" it.
  const histStart = new Date(2026, 5, 29, 6);        // Monday 2026-06-29
  let history = [];
  for (let w = 0; w < 16; w++) {
    const from = ds(addDays(histStart, 7 * w));
    const wk = planRange({ from, days: 7, profile: p, sessions: history, now: parseDs(from) });
    history = history.concat(wk.map(s => ({ ...simulateDone(s), id: s.id + '_h' })));
  }
  assert.ok(history.length > 80);
  const t0 = performance.now();
  const out = planRange({ from: MON, days: 28, profile: p, sessions: history, classSchedule: CS, now: NOW });
  const ms = performance.now() - t0;
  console.log(`# 28-day plan with ${history.length} history sessions: ${Math.round(ms)} ms`);
  assert.equal(out.length, 24);
  assert.ok(ms < 1500, `${ms} ms`);
  const t1 = performance.now();
  planRange({ from: MON, days: 28, profile: p, sessions: [], now: NOW });
  const ms2 = performance.now() - t1;
  console.log(`# 28-day plan, empty history: ${Math.round(ms2)} ms`);
  assert.ok(ms2 < 1500);
});
