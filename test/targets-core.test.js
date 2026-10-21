// INTEGRATOR (§18): targets resolver, validation, propagation helpers and planner honouring the cardio target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../js/store.js';
import { resolveTargets, applyTargetChange, needsReplan, describeChange, cardioCapacity, cardioWeek, suggestFinisher, finisherCap, cardioPrefs, makeRoomProposal, weekCardioCapacity } from '../js/engine/targets.js';
import { planRange, weekPlanSummary } from '../js/engine/planner.js';
import { planUpdate } from '../js/ui/targets.js';
import { parseDs } from '../js/util.js';

const MON = '2026-10-26';
const NOW = new Date(2026, 9, 26, 7, 0);   // Monday 07:00
// Most cardio tests here exercise the finisher logic, so they pin cardio.style 'finishers'
// (the default is 'longer'; see the cardio-style tests at the end).
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, cardio: { style: 'finishers' }, ...patch });
const cardioOf = list => list.reduce((n, s) => n + (s.blocks || []).reduce((a, b) => a + (b.kind === 'cardio' ? b.minutes : b.kind === 'class' ? (b.classify?.cardioMinutes || 0) : 0), 0), 0);

// ---------------------------------------------------------------- resolveTargets
test('resolveTargets: defaults for an empty profile', () => {
  const t = resolveTargets({});
  assert.equal(t.cardio.minPerWeek, 120);
  assert.equal(t.cardio.source, 'default');
  assert.deepEqual(t.cardio.modalities, []);
  assert.equal(t.cardio.hardSessionsPerWeek, 1);
  assert.equal(t.adherence, 0.85);
  assert.equal(t.training.defaultMinutes, 45);
  assert.equal(t.training.style, 'hypertrophy');
  assert.equal(t.training.daysPerWeek, 0);
  assert.equal(t.nutrition.mode, 'off');
  assert.equal(t.nutrition.proteinGPerLb, 1);
  assert.equal(t.nutrition.fatPct, 25);
  assert.deepEqual(t.nutrition.phases, []);
  assert.equal(t.goals.goal, 'recomp');
  assert.equal(t.goals.goalBodyFatPct, 15);   // §20b: default 15 % DXA-equivalent ≈ the colloquial 12 %
  assert.deepEqual(t.stack, { active: [], count: 0 });
});

test('resolveTargets: reads the store default profile and its schedule', () => {
  const p = prof();
  const t = resolveTargets(p, { now: NOW });
  assert.equal(t.cardio.minPerWeek, 120);
  assert.equal(t.cardio.source, 'profile');
  assert.equal(t.training.daysPerWeek, 6);
  assert.equal(t.training.totalMinPerWeek, 240);
  assert.ok(t.capacity.cardio >= 100 && t.capacity.cardio < 225, `capacity ${t.capacity.cardio}`);
  assert.ok(t.training.liftMinPerWeek > 0 && t.training.liftMinPerWeek < 240);
  assert.equal(t.warnings.length, 0);
  const hi = resolveTargets({ ...p, cardioTargetMin: 225 });
  assert.ok(hi.warnings.some(w => /fits about \d+ cardio min/.test(w)), hi.warnings.join('|'));
});

test('resolveTargets: legacy protein grams, stack, goal BF and adherence', () => {
  const p = prof({ nutrition: { mode: 'simple', calories: null, protein: 170, surplus: 300 }, adherence: 0.7,
    supplements: [{ id: 'creatine', start: '2026-01-01', end: null, active: true }, { id: 'x', start: '2026-01-01', end: '2026-02-01' }, { id: 'y', active: false }],
    body: { ...defaultProfile().body, goalBodyFat: 10 } });
  const t = resolveTargets(p, { now: NOW });
  assert.equal(t.nutrition.proteinGPerLb, 1);
  assert.equal(t.nutrition.surplus, 300);
  assert.equal(t.nutrition.calories, null);
  assert.equal(t.adherence, 0.7);
  assert.deepEqual(t.stack.active, ['creatine']);
  assert.equal(t.goals.goalBodyFatPct, 10);
});

// ---------------------------------------------------------------- applyTargetChange
test('applyTargetChange: clamps, rounds and ignores invalid values without mutating the input', () => {
  const p = prof();
  const frozen = JSON.stringify(p);
  assert.equal(applyTargetChange(p, { cardio: { minPerWeek: 225 } }).cardioTargetMin, 225);
  assert.equal(applyTargetChange(p, { cardio: { minPerWeek: 1200 } }).cardioTargetMin, 900);
  assert.equal(applyTargetChange(p, { cardio: { minPerWeek: -40 } }).cardioTargetMin, 0);
  assert.equal(applyTargetChange(p, { cardio: { minPerWeek: 222 } }).cardioTargetMin, 220);
  assert.equal(applyTargetChange(p, { cardio: { minPerWeek: 'lots' } }).cardioTargetMin, 120);
  assert.equal(applyTargetChange(p, { cardio: { minPerWeek: null } }).cardioTargetMin, 120);
  const c = applyTargetChange(p, { cardio: { modalities: ['bike', 'nope', 'run', 'bike'], hardSessionsPerWeek: 9 } }).cardio;
  assert.deepEqual(c, { style: 'finishers', modalities: ['bike', 'run'], hardPerWeek: 4 });
  assert.equal(applyTargetChange(p, { adherence: 2 }).adherence, 1);
  assert.equal(applyTargetChange(p, { adherence: 0.1 }).adherence, 0.5);
  assert.equal(applyTargetChange(p, { training: { defaultMinutes: 5, style: 'yoga' } }).defaultMinutes, 10);
  assert.equal(applyTargetChange(p, { training: { style: 'yoga' } }).defaultStyle, 'hypertrophy');
  assert.equal(applyTargetChange(p, { goals: { goal: 'bulk!!', goalBodyFatPct: 2 } }).goal, 'recomp');
  assert.equal(applyTargetChange(p, { goals: { goalBodyFatPct: 2 } }).body.goalBodyFat, 5);
  assert.equal(JSON.stringify(p), frozen, 'input untouched');
});

test('applyTargetChange: nutrition calories and surplus are exclusive; phases validated', () => {
  const p = prof({ nutrition: { mode: 'simple', calories: 2800, surplus: null } });
  const a = applyTargetChange(p, { nutrition: { surplus: 300 } }).nutrition;
  assert.equal(a.surplus, 300); assert.equal(a.calories, null);
  const b = applyTargetChange(p, { nutrition: { calories: 9000, proteinGPerLb: 3, fatPct: 5 } }).nutrition;
  assert.equal(b.calories, 6000); assert.equal(b.proteinGPerLb, 1.4); assert.equal(b.fatPct, 15);
  const c = applyTargetChange(p, { nutrition: { phases: [{ label: 'Cut', start: '2027-02-01', surplus: -500 }, { start: 'bad' }, { label: 'Bulk', start: '2026-11-01', end: '2027-01-31', surplus: 2000 }] } }).nutrition.phases;
  assert.equal(c.length, 2);
  assert.equal(c[0].label, 'Bulk'); assert.equal(c[0].surplus, 1500);
  assert.equal(c[1].start, '2027-02-01'); assert.equal(c[1].end, null);
  assert.equal(applyTargetChange(p, { nutrition: { mode: 'keto' } }).nutrition.mode, 'simple');
});

test('needsReplan / describeChange separate planning changes from nutrition-only ones', () => {
  const p = prof();
  const cardio = applyTargetChange(p, { cardio: { minPerWeek: 225 } });
  assert.equal(needsReplan(p, cardio), true);
  assert.equal(describeChange(p, cardio), '225 min/wk cardio');
  const nut = applyTargetChange(p, { nutrition: { surplus: 250 } });
  assert.equal(needsReplan(p, nut), false);
  assert.match(describeChange(p, nut), /nutrition/);
  assert.equal(needsReplan(p, applyTargetChange(p, { adherence: 0.9 })), false);
  assert.equal(needsReplan(p, applyTargetChange(p, { training: { style: 'pump' } })), true);
  assert.equal(describeChange(p, p), '');
});

// ---------------------------------------------------------------- capacity / week helpers
test('finisherCap and cardioCapacity follow the schedule', () => {
  assert.equal(finisherCap(20), 0); assert.equal(finisherCap(30), 10); assert.equal(finisherCap(45), 15); assert.equal(finisherCap(90), 30);
  const p = prof();
  const cap = cardioCapacity(p);
  assert.equal(cap.cardioDays, 30); assert.equal(cap.flex, 35, 'flex at Crunch usually becomes a class: ~60% cardio');
  assert.equal(cap.cardio, cap.cardioDays + cap.flex + cap.finishers + cap.classes);
  p.schedule = { ...p.schedule, sun: { kind: 'cardio', minutes: 60, location: 'home' }, wed: { kind: 'cardio', minutes: 60, location: 'home' }, sat: { kind: 'cardio', minutes: 60, location: 'crunch' } };
  assert.ok(cardioCapacity(p).cardio >= 225, String(cardioCapacity(p).cardio));
});

test('cardioWeek counts done and still-planned minutes this calendar week; suggestFinisher sizes the gap', () => {
  const p = prof({ cardioTargetMin: 225 });
  const sessions = [
    { id: 'a', date: '2026-10-26', status: 'done', startedAt: '2026-10-26T12:00:00Z', blocks: [{ kind: 'cardio', modality: 'run', minutes: 40, done: true }] },
    { id: 'b', date: '2026-10-28', status: 'planned', plan: { auto: true, kind: 'cardio' }, blocks: [{ kind: 'cardio', modality: 'run', minutes: 30 }] },
    { id: 'c', date: '2026-10-19', status: 'done', blocks: [{ kind: 'cardio', modality: 'run', minutes: 90, done: true }] },   // last week
  ];
  const now = new Date(2026, 9, 27, 9);   // Tuesday
  const w = cardioWeek(p, sessions, { now });
  assert.equal(w.done, 40); assert.equal(w.planned, 30); assert.equal(w.target, 225); assert.equal(w.remaining, 155);
  const s = suggestFinisher(p, sessions, { now, minutes: 60 });
  assert.ok(s && s.minutes >= 10 && s.minutes <= 20, JSON.stringify(s));
  assert.equal(suggestFinisher(prof({ cardioTargetMin: 60 }), sessions, { now, minutes: 60 }), null, 'covered → no nudge');
  assert.equal(suggestFinisher(prof({ cardioTargetMin: 0 }), sessions, { now, minutes: 60 }), null);
});

// ---------------------------------------------------------------- planner honours the target
test('planRange honours a 225 min/wk cardio target with the default schedule (±15% or a shortfall warning)', () => {
  const p = prof({ cardioTargetMin: 225 });
  const out = planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 1 });
  const sum = weekPlanSummary(out, { weekStart: parseDs(MON), profile: p, now: NOW });
  const planned = sum.cardioMinutes.planned;
  assert.equal(planned, cardioOf(out));
  const within = Math.abs(planned - 225) <= 225 * 0.15;
  const warned = sum.warnings.some(w => /^Cardio \d+\/225 min planned \(\d+ short\)/.test(w) && /fits ~\d+ cardio min/.test(w));
  assert.ok(within || warned, `planned ${planned}; warnings: ${sum.warnings.join(' | ')}`);
  // and it uses the room it has: more cardio than at the 120 default
  const base = planRange({ from: MON, days: 7, profile: prof(), sessions: [], now: NOW, seed: 1 });
  assert.ok(planned > cardioOf(base) + 15, `${planned} vs default ${cardioOf(base)}`);
  assert.ok(sum.cardioMinutes.capacity > 0 && sum.cardioMinutes.shortfall >= 0);
  // finishers never swallow a lift day
  for (const s of out.filter(x => x.plan.kind === 'lift')) {
    const c = s.blocks.filter(b => b.kind === 'cardio').reduce((a, b) => a + b.minutes, 0);
    assert.ok(c <= finisherCap(s.minutes), `${s.date}: ${c} min cardio in ${s.minutes}`);
    assert.ok(s.blocks.some(b => b.kind === 'lift'));
  }
});

test('planRange hits 225 and 300 when availability has room', () => {
  for (const target of [225, 300]) {
    const p = prof({ cardioTargetMin: target });
    p.schedule = { ...p.schedule, sun: { kind: 'cardio', minutes: 60, location: 'home' }, wed: { kind: 'cardio', minutes: 60, location: 'home' }, sat: { kind: 'flex', minutes: 90, location: 'crunch' } };
    const cap = cardioCapacity(p).cardio;
    const out = planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 2 });
    const sum = weekPlanSummary(out, { weekStart: parseDs(MON), profile: p, now: NOW });
    const planned = sum.cardioMinutes.planned;
    if (cap >= target) assert.ok(Math.abs(planned - target) <= target * 0.15, `${target}: planned ${planned} (cap ${cap})`);
    else assert.ok(sum.warnings.some(w => /short/.test(w)), `${target}: ${planned}/${cap} ${sum.warnings.join('|')}`);
  }
});

test('cardio prefs: preferred modalities first, hard sessions per week respected', () => {
  const p = prof({ cardioTargetMin: 150, cardio: { modalities: ['bike'], hardPerWeek: 0 } });
  assert.deepEqual(cardioPrefs(p).modalities, ['bike']);
  const out = planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 4 });
  const blocks = out.flatMap(s => s.blocks.filter(b => b.kind === 'cardio'));
  assert.ok(blocks.every(b => b.intensity === 'easy'), 'no hard sessions');
  const crunch = out.filter(s => s.location === 'crunch').flatMap(s => s.blocks.filter(b => b.kind === 'cardio'));
  assert.ok(crunch.every(b => b.modality === 'bike'), crunch.map(b => b.modality).join(','));
});

// ---------------------------------------------------------------- setTargets' pure part
test('planUpdate re-plans auto days only, keeping custom and done days', () => {
  const p = prof({ cardioTargetMin: 225 });
  const custom = { id: 'keep', date: '2026-10-27', status: 'planned', location: 'home', minutes: 30, plan: { auto: false, kind: 'cardio' }, blocks: [{ kind: 'cardio', modality: 'run', minutes: 30, intensity: 'easy' }] };
  const done = { id: 'd', date: '2026-10-26', status: 'done', startedAt: '2026-10-26T12:00:00Z', blocks: [{ kind: 'cardio', modality: 'run', minutes: 50, done: true }] };
  const oldAuto = planRange({ from: MON, days: 14, profile: prof(), sessions: [done, custom], now: NOW, seed: 9 });
  const { from, to, list } = planUpdate({ profile: p, sessions: [done, custom, ...oldAuto], now: NOW });
  assert.equal(from, MON);
  assert.equal(to, '2026-11-08', 'extends through the last auto-planned week');
  assert.ok(!list.some(s => s.date === '2026-10-27' || s.date === '2026-10-26'), 'custom + done days untouched');
  assert.ok(list.every(s => s.plan.auto && s.date >= from && s.date <= to));
  const week = list.filter(s => s.date <= '2026-11-01');
  assert.ok(cardioOf(week) + 30 + 50 > cardioOf(oldAuto.filter(s => s.date <= '2026-11-01')) + 30 + 50, 'more cardio than before');
  const none = planUpdate({ profile: p, sessions: [], now: NOW });
  assert.equal(none.to, '2026-11-01', 'no plan yet → this week');
});

// ---------------------------------------------------------------- make room + consistent capacity
test('makeRoomProposal: concrete availability changes that fit 225 on the default schedule', () => {
  const p = prof({ cardioTargetMin: 225 });
  const r = makeRoomProposal(p);
  assert.ok(r.before < 225 && r.enough, JSON.stringify(r.changes));
  assert.ok(r.after >= 225 - 22.5 && r.after === cardioCapacity(p, r.schedule).cardio);
  assert.ok(r.changes.some(c => c.day === 'wed' && /Wed cardio 30→\d+′/.test(c.label)), r.changes.map(c => c.label).join(' | '));
  assert.ok(r.changes.some(c => c.day === 'sat' && /flex → cardio/.test(c.label)));
  assert.ok(r.changes.every(c => c.gain > 0 && c.label && c.from && c.to));
  assert.deepEqual(r.schedule.mon, p.schedule.mon, 'untouched days kept');
  assert.ok(Object.values(r.schedule).every(d => d.kind !== 'cardio' || d.minutes <= 90));
  // applying it lets the planner actually hit the target
  const q = { ...p, schedule: r.schedule };
  const out = planRange({ from: MON, days: 7, profile: q, sessions: [], now: NOW, seed: 5 });
  const sum = weekPlanSummary(out, { weekStart: parseDs(MON), profile: q, now: NOW });
  assert.ok(Math.abs(sum.cardioMinutes.planned - 225) <= 225 * 0.15, `planned ${sum.cardioMinutes.planned}`);
  // A target the week genuinely cannot hold is reported honestly rather than half-applied.
  const hi = makeRoomProposal(prof({ cardioTargetMin: 600 }));
  assert.equal(hi.enough, false); assert.ok(hi.short > 0 && hi.changes.length >= 3);
  assert.equal(makeRoomProposal(prof({ cardioTargetMin: 90 })).changes.length, 0);
});

// One "Apply" must deliver everything the proposal can ever deliver: re-running it on the schedule
// it just proposed has to find nothing new, otherwise Plan keeps re-offering the same button and a
// second click silently gives more than the first (the C1k/C1l defect).
test('makeRoomProposal reaches a fixed point: applying it twice changes nothing', () => {
  for (const style of ['longer', 'balanced', 'finishers']) {
    for (const target of [90, 150, 225, 300, 600]) {
      const p = { ...defaultProfile(), bodyweight: 170, cardio: { style }, cardioTargetMin: target };
      const r = makeRoomProposal(p);
      const again = makeRoomProposal({ ...p, schedule: r.schedule });
      assert.equal(again.changes.length, 0, `${style} @${target}: ${r.after} then +${again.after - r.after} (${again.changes.map(c => c.label).join(', ')})`);
      assert.equal(again.before, r.after, `${style} @${target}: proposal's "after" must be the new capacity`);
      assert.equal(r.after, cardioCapacity(p, r.schedule).cardio);
      assert.ok(r.enough === (r.after >= target - Math.max(10, target * 0.1)), `${style} @${target}: enough must mean "within tolerance"`);
    }
  }
  // The default schedule + the default 'longer' style can hold 225 with the lift days untouched.
  const p = { ...defaultProfile(), bodyweight: 170, cardioTargetMin: 225 };
  const r = makeRoomProposal(p);
  assert.ok(r.enough && r.after >= 225, `${r.after}/${225}`);
  assert.deepEqual(['mon', 'tue', 'thu', 'fri'].map(d => r.schedule[d]), ['mon', 'tue', 'thu', 'fri'].map(d => p.schedule[d]), 'lift days keep their lifting');
  const q = { ...p, schedule: r.schedule };
  const sum = weekPlanSummary(planRange({ from: MON, days: 7, profile: q, sessions: [], now: NOW, seed: 5 }), { weekStart: parseDs(MON), profile: q, now: NOW });
  assert.ok(Math.abs(sum.cardioMinutes.planned - 225) <= 225 * 0.15, `planned ${sum.cardioMinutes.planned}`);
  assert.ok(!sum.warnings.some(w => /^Cardio \d+\/225/.test(w)), sum.warnings.join(' | '));
});

test('weekCardioCapacity counts a planned class day by its class cardio, matching planned minutes', () => {
  const p = prof({ cardioTargetMin: 225 });
  const out = planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 1 });
  const cls = { id: 'cls', date: '2026-10-31', status: 'planned', location: 'crunch', minutes: 55, plan: { auto: true, kind: 'class' },
    blocks: [{ kind: 'class', name: 'HIIT', duration: 45, classify: { cardioMinutes: 31, muscles: {} } }, { kind: 'cardio', modality: 'bike', minutes: 10, intensity: 'easy' }] };
  const week = [...out.filter(s => s.date !== '2026-10-31'), cls];
  const sum = weekPlanSummary(week, { weekStart: parseDs(MON), profile: p, now: NOW });
  const capWeek = weekCardioCapacity(p, week, { now: NOW });
  assert.equal(sum.cardioMinutes.capacity, capWeek);
  const satShare = capWeek - weekCardioCapacity(p, week.filter(s => s.id !== 'cls'), { now: NOW });
  assert.equal(satShare, 41 - cardioCapacity(p).byDay.sat, 'class day = 31 class + 10 add-on, not the template');
  assert.ok(sum.cardioMinutes.planned <= capWeek, `${sum.cardioMinutes.planned} planned ≤ ${capWeek} capacity`);
  assert.equal(cardioWeek(p, week, { now: NOW }).capacity, capWeek);
});

// ---------------------------------------------------------------- cardio style (longer / balanced / finishers)
test("cardio style: 'longer' (default) never plans a cardio block under minSession and keeps a long session", () => {
  const p0 = { ...defaultProfile(), bodyweight: 170 };
  assert.equal(cardioPrefs(p0).style, 'longer');
  assert.equal(cardioPrefs(p0).minSession, 30);
  for (const target of [120, 225]) {
    const p = { ...p0, cardioTargetMin: target };
    const out = planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 1 });
    const blocks = out.flatMap(s => s.blocks.filter(b => b.kind === 'cardio'));
    assert.ok(blocks.every(b => b.minutes >= 30), `${target}: ${blocks.map(b => b.minutes).join(',')}`);
    const longest = Math.max(...out.map(s => cardioOf([s])));
    assert.ok(longest >= 45, `${target}: longest cardio session ${longest}`);
    assert.ok(blocks.filter(b => b.intensity === 'hard' || b.intensity === 'intervals').length <= 1);
    const sum = weekPlanSummary(out, { weekStart: parseDs(MON), profile: p, now: NOW });
    if (sum.cardioMinutes.planned < target - Math.max(10, target * 0.1)) assert.ok(sum.warnings.some(w => /^Cardio/.test(w) && /fits ~\d+/.test(w)), sum.warnings.join(' | '));
  }
  // Make room under 'longer' lengthens/adds cardio days, never lift-day finishers
  const r = makeRoomProposal({ ...p0, cardioTargetMin: 225 });
  assert.ok(r.changes.length && r.changes.every(c => c.to.kind === 'cardio'), r.changes.map(c => c.label).join(' | '));
  assert.ok(r.changes.filter(c => c.from.kind === 'rest').every(c => c.to.minutes >= 30));
});

test("cardio style: 'balanced' finishers are ≥20 min; 'finishers' keeps short finishers; validation", () => {
  const b = { ...defaultProfile(), bodyweight: 170, cardioTargetMin: 225, cardio: { style: 'balanced' } };
  const out = planRange({ from: MON, days: 7, profile: b, sessions: [], now: NOW, seed: 1 });
  assert.ok(out.flatMap(s => s.blocks.filter(x => x.kind === 'cardio')).every(x => x.minutes >= 20));
  const f = prof({ cardioTargetMin: 225 });
  const fo = planRange({ from: MON, days: 7, profile: f, sessions: [], now: NOW, seed: 1 });
  assert.ok(fo.some(s => s.plan.kind === 'lift' && s.blocks.some(x => x.kind === 'cardio' && x.minutes < 20)), 'finishers style still uses short finishers');
  const p = applyTargetChange(defaultProfile(), { cardio: { style: 'balanced' } });
  assert.equal(p.cardio.style, 'balanced'); assert.equal(cardioPrefs(p).minSession, 20);
  assert.equal(cardioPrefs(applyTargetChange(p, { cardio: { minSession: 3 } })).minSession, 5);
  assert.equal(applyTargetChange(p, { cardio: { style: 'sprint' } }).cardio.style, 'balanced');
  assert.equal(needsReplan(defaultProfile(), p), true);
  assert.equal(suggestFinisher({ ...defaultProfile(), cardioTargetMin: 225 }, [], { now: NOW, minutes: 45 }), null, "'longer': no 15-min finisher nudge");
});
