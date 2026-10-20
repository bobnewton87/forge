// STYLES: per-day style in the planner (schedule[day].style → else profile.defaultStyle), fewer extensions
// on time-saver weeks, and custom styles read/written through targets (validation + clamps).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../js/store.js';
import { planRange, suggestForDay, weekPlanSummary } from '../js/engine/planner.js';
import { resolveTargets, applyTargetChange, needsReplan, describeChange, STYLES } from '../js/engine/targets.js';
import { BUILTIN_STYLES } from '../js/engine/generator.js';
import { parseDs } from '../js/util.js';

const MON = '2026-10-26';
const NOW = new Date(2026, 9, 26, 7, 0);
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, ...patch });
const week = p => planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 1 });
const extMin = out => out.reduce((n, s) => n + (s.plan?.extended ? s.plan.extended.to - s.plan.extended.from : 0), 0);
const sched = (n, m) => {
  const days = { 3: ['mon', 'wed', 'fri'], 4: ['mon', 'tue', 'thu', 'fri'] }[n];
  return Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, days.includes(d) ? { kind: 'lift', minutes: m, location: 'crunch' } : { kind: 'rest', minutes: 0, location: 'home' }]));
};
const CS = { id: 'cs_100', name: 'Quick pairs', base: 'hypertrophy', restCompound: 75, restIsolation: 45, pairing: 'antagonist' };

test('planner honours the per-day style, else the default style', () => {
  const base = defaultProfile().schedule;
  const p = prof({ customStyles: [CS], schedule: { ...base, mon: { ...base.mon, style: 'efficient' }, thu: { ...base.thu, style: 'cs_100' } } });
  const out = week(p);
  const lift = out.filter(s => s.plan?.kind === 'lift');
  const by = d => lift.find(s => s.date === d);
  assert.equal(by('2026-10-26').style, 'efficient');
  assert.equal(by('2026-10-26').plan.slot.style, 'efficient');
  assert.equal(by('2026-10-29').style, 'cs_100');
  assert.equal(by('2026-10-29').styleName, 'Quick pairs');
  assert.ok(by('2026-10-29').blocks.some(b => b.group), 'custom antagonist pairs');
  for (const s of lift.filter(s => !['2026-10-26', '2026-10-29'].includes(s.date))) assert.equal(s.style, 'hypertrophy', s.date);
  // default style = a custom style; a day style that no longer exists falls back to it
  const p2 = prof({ customStyles: [CS], defaultStyle: 'cs_100', schedule: { ...base, mon: { ...base.mon, style: 'cs_gone' } } });
  for (const s of week(p2).filter(s => s.plan?.kind === 'lift')) assert.equal(s.style, 'cs_100', s.date);
  // suggestForDay with a slot override keeps the weekday's style
  const one = suggestForDay('2026-10-26', { profile: p, sessions: [], now: NOW, slot: { kind: 'lift', minutes: 30, location: 'home' } });
  assert.equal(one.style, 'efficient');
});

test('time-saver weeks fit more sets and need fewer extensions to reach the weekly minimums', () => {
  let eTot = 0, hTot = 0;
  for (const [n, m] of [[3, 30], [3, 45], [4, 30]]) {
    const h = week(prof({ schedule: sched(n, m), cardioTargetMin: 0 }));
    const pe = prof({ schedule: sched(n, m), cardioTargetMin: 0, defaultStyle: 'efficient' });
    const e = week(pe);
    assert.ok(extMin(e) < extMin(h), `${n}×${m}: efficient +${extMin(e)}′ vs hypertrophy +${extMin(h)}′`);
    eTot += extMin(e); hTot += extMin(h);
    const sum = weekPlanSummary(e, { weekStart: parseDs(MON), profile: pe, now: NOW });
    assert.ok(sum.minimums.met || e.filter(s => s.plan?.kind === 'lift').every(s => s.minutes >= 85), `${n}×${m}: minimums met`);
  }
  assert.ok(eTot <= hTot * 0.7, `extensions ${eTot}′ vs ${hTot}′`);
  const sets = out => out.reduce((n, s) => n + (s.blocks || []).filter(b => b.kind === 'lift').reduce((a, b) => a + b.target.sets, 0), 0);
  // INTEGRATOR (target band): with lengthening on, both styles plan ≈ the targets, so compare at fixed
  // slot times (no lengthening), where Time-saver fits more sets into the same minutes.
  const fixed = { volumePolicy: { mode: 'fixed', maxMinutes: 90 } };
  assert.ok(sets(week(prof({ defaultStyle: 'efficient', ...fixed }))) > sets(week(prof(fixed))), 'more sets in the same week');
});

test('targets: custom styles validated + clamped, listed with the built-ins, references cleaned', () => {
  assert.deepEqual(STYLES, BUILTIN_STYLES);
  const p0 = prof();
  const p = applyTargetChange(p0, { training: { customStyles: [
    { id: 'cs_1', name: 'x'.repeat(50), base: 'pump', restCompound: 10, restIsolation: 999, pairing: 'bogus', repMin: 40, repMax: 1, setsPerExercise: 9 },
    { name: '  Two  ', base: 'yoga', restCompound: 92, restIsolation: '61', pairing: 'antagonist', setsPerExercise: 0 },
    'junk',
  ] } });
  const [a, b] = p.customStyles;
  assert.equal(p.customStyles.length, 2);
  assert.equal(a.name.length, 30);
  assert.deepEqual([a.restCompound, a.restIsolation, a.pairing, a.repMin, a.repMax, a.setsPerExercise], [30, 300, 'superset', 3, 30, 6]);
  assert.match(b.id, /^cs_\d+/); assert.equal(b.name, 'Two'); assert.equal(b.base, 'hypertrophy');
  assert.deepEqual([b.restCompound, b.restIsolation, b.setsPerExercise, b.repMin], [90, 60, 1, undefined]);
  const t = resolveTargets(p).training;
  assert.deepEqual(t.styles.map(s => s.id), [...BUILTIN_STYLES, 'cs_1', b.id]);
  assert.equal(t.customStyles.length, 2);
  // defaultStyle + per-day style accept custom ids that exist, reject others
  let q = applyTargetChange(p, { training: { style: 'cs_1', schedule: { mon: { kind: 'lift', minutes: 45, location: 'crunch', style: b.id }, tue: { kind: 'lift', minutes: 30, location: 'home', style: 'cs_nope' } } } });
  assert.equal(q.defaultStyle, 'cs_1');
  assert.equal(q.schedule.mon.style, b.id);
  assert.equal(q.schedule.tue.style, undefined);
  assert.equal(resolveTargets(q).training.schedule.mon.style, b.id);
  assert.equal(applyTargetChange(q, { training: { style: 'cs_nope' } }).defaultStyle, 'cs_1');
  // absent style keeps the day's style; null clears it
  assert.equal(applyTargetChange(q, { training: { schedule: { mon: { kind: 'lift', minutes: 60 } } } }).schedule.mon.style, b.id);
  assert.equal(applyTargetChange(q, { training: { schedule: { mon: { kind: 'lift', minutes: 60, style: null } } } }).schedule.mon.style, undefined);
  // deleting a style drops references to it
  const r = applyTargetChange(q, { training: { customStyles: [a] } });
  assert.equal(r.defaultStyle, 'cs_1');
  assert.equal(r.schedule.mon.style, undefined);
  assert.equal(applyTargetChange(r, { training: { customStyles: [] } }).defaultStyle, 'hypertrophy');
  // planning-relevant: style changes re-plan; describeChange names them
  assert.equal(needsReplan(q, applyTargetChange(q, { training: { customStyles: [{ ...a, restCompound: 120 }, b] } })), true);
  assert.equal(needsReplan(p0, applyTargetChange(p0, { training: { style: 'efficient' } })), true);
  assert.match(describeChange(p0, applyTargetChange(p0, { training: { style: 'efficient' } })), /time-saver style/);
  assert.match(describeChange(p0, p), /your training styles/);
});
