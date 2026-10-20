// INTEGRATOR: weekly set minimums: top-up pass, workout extension policy, warnings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../js/store.js';
import { planRange, weekPlanSummary, simulateDone } from '../js/engine/planner.js';
import { estimateMinutes } from '../js/engine/generator.js';
import { sessionVolume } from '../js/engine/recovery.js';
import { resolveTargets, applyTargetChange, volumePolicyOf, weeklyMinimums, volumeRoomOptions, MINIMUMS_EVIDENCE } from '../js/engine/targets.js';
import { extendedToast } from '../js/ui/targets.js';
import { parseDs } from '../js/util.js';

const MON = '2026-10-26';
const NOW = new Date(2026, 9, 26, 7, 0);
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, ...patch });
const week = (p, extra = {}) => planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 1, ...extra });
const summary = (out, p) => weekPlanSummary(out, { weekStart: parseDs(MON), profile: p, now: NOW });

test('policy + minimums resolve with defaults and validate', () => {
  assert.deepEqual(volumePolicyOf({}), { mode: 'extend', maxMinutes: 90 });
  const t = resolveTargets(prof());
  assert.deepEqual(t.training.volumePolicy, { mode: 'extend', maxMinutes: 90 });
  assert.ok(t.minimums.groups.triceps.min >= 12 && t.minimums.groups.calves.min < t.minimums.groups.triceps.min, 'legs maintenance minimums are lower');
  assert.ok(MINIMUMS_EVIDENCE.some(e => /Schoenfeld/.test(e.source)) && MINIMUMS_EVIDENCE.some(e => /Pelland/.test(e.source)) && MINIMUMS_EVIDENCE.some(e => /Bickel/.test(e.source)));
  const p = applyTargetChange(prof(), { training: { volumePolicy: { mode: 'ask', maxMinutes: 500 } } });
  assert.deepEqual(p.volumePolicy, { mode: 'ask', maxMinutes: 180 });
  assert.equal(applyTargetChange(prof(), { training: { volumePolicy: { mode: 'yolo' } } }).volumePolicy.mode, 'extend');
  assert.ok(volumeRoomOptions(prof()).some(o => o.id === 'cap') && volumeRoomOptions(prof()).every(o => o.label && o.patch));
});

test('default schedule: every group reaches its minimum, or sessions are extended ≤ cap and the rest is warned', () => {
  const p = prof();
  const base = summary(week(p, { topUp: false }), p);
  const out = week(p);
  const sum = summary(out, p);
  const mins = weeklyMinimums(p);
  const ext = out.filter(s => s.plan.extended);
  for (const s of ext) {
    assert.ok(s.minutes <= 90 && s.minutes > s.plan.extended.from, `${s.date} ${s.plan.extended.from}→${s.minutes}`);
    assert.equal(s.plan.extended.to, s.minutes);
    assert.match(s.plan.extended.reason, /^weekly minimums: /);
  }
  for (const [g, m] of Object.entries(mins)) {
    const x = sum.groups[g];
    if (x.total >= m.min - 0.25) continue;
    assert.ok(sum.warnings.some(w => w.startsWith(`${x.target && g[0].toUpperCase() + g.slice(1)}`) && /sets: short/.test(w)) || sum.warnings.some(w => w.toLowerCase().startsWith(g) && /short/.test(w)), `${g} ${x.total}/${m.min}: ${sum.warnings.join(' | ')}`);
  }
  // it actually closed gaps compared with the plain walk
  const gap = s => Object.values(s.groups).reduce((n, x) => n + Math.max(0, x.target.min - x.total), 0);
  assert.ok(gap(sum) < gap(base), `gap ${gap(sum)} vs ${gap(base)}`);
  assert.equal(sum.minimums.met, sum.minimums.short.length === 0);
  assert.deepEqual(sum.extended.map(x => x.date), ext.map(s => s.date));
});

test('extended sessions: estimateMinutes within ±10% of session.minutes, ≤5 sets per exercise, per-session caps', () => {
  const p = prof();
  const out = week(p);
  for (const s of out.filter(x => x.plan.topUp)) {
    const est = estimateMinutes(s.blocks);
    if (s.plan.extended) assert.ok(Math.abs(est - s.minutes) <= s.minutes * 0.1, `${s.date}: est ${est} vs ${s.minutes}`);
    for (const b of s.blocks.filter(x => x.kind === 'lift')) assert.ok(Math.max(b.target?.sets || 0, b.sets.length) <= 5, `${b.exId} ${b.target?.sets}`);
    const v = sessionVolume(simulateDone(s)).groups;
    for (const g of Object.keys(s.plan.topUp)) assert.ok(v[g] <= (['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes'].includes(g) ? 10 : 8) + 0.01, `${s.date} ${g} ${v[g]}`);
  }
});

test("'fixed' policy never extends and warns per group", () => {
  const p = prof({ volumePolicy: { mode: 'fixed', maxMinutes: 90 } });
  const out = week(p);
  assert.ok(out.every(s => !s.plan.extended && s.minutes === s.plan.slot.minutes), out.map(s => `${s.date}:${s.minutes}`).join(' '));
  for (const s of out.filter(x => x.plan.kind === 'lift')) assert.ok(estimateMinutes(s.blocks) <= s.minutes + 2, `${s.date} est ${estimateMinutes(s.blocks)} > ${s.minutes}`);
  const sum = summary(out, p);
  assert.equal(sum.minimums.met, false);
  assert.ok(sum.warnings.some(w => /^\w+ [\d.]+\/[\d.]+ sets: short [\d.]+$/.test(w)), sum.warnings.join(' | '));
  // 'ask' plans like fixed by default; the extend override builds the proposal
  const ask = prof({ volumePolicy: { mode: 'ask', maxMinutes: 90 } });
  assert.ok(week(ask).every(s => !s.plan.extended));
  assert.ok(week(ask, { volumePolicy: { mode: 'extend' } }).some(s => s.plan.extended));
});

test('custom days are untouched and never extended', () => {
  const p = prof();
  const custom = { id: 'mine', date: '2026-10-27', status: 'planned', location: 'home', minutes: 30, title: 'My arms', plan: { auto: false, kind: 'lift' },
    blocks: [{ kind: 'lift', exId: 'db_curl', target: { sets: 3, repMin: 8, repMax: 12, rest: 60 }, sets: [{}, {}, {}].map(() => ({ w: null, r: null, done: false })) }] };
  const frozen = JSON.stringify(custom);
  const out = planRange({ from: MON, days: 7, profile: p, sessions: [custom], now: NOW, seed: 1 });
  assert.ok(!out.some(s => s.date === '2026-10-27'), 'no generated session on the custom day');
  assert.equal(JSON.stringify(custom), frozen, 'custom session object not mutated');
});

test('a 4-week plan with the top-up stays under 1.5 s', () => {
  const p = prof();
  const t0 = performance.now();
  const out = planRange({ from: MON, days: 28, profile: p, sessions: [], now: NOW, seed: 3 });
  const ms = performance.now() - t0;
  assert.ok(out.length >= 20);
  assert.ok(ms < 1500, `${Math.round(ms)} ms`);
});

test('extendedToast summarizes extensions', () => {
  assert.equal(extendedToast([]), null);
  const s = (date, from, to) => ({ date, plan: { extended: { from, to, reason: 'weekly minimums: triceps +4' } } });
  assert.equal(extendedToast([s('2026-10-29', 45, 55), s('2026-10-26', 45, 60)]), 'Extended Mon 45→60′ and Thu 45→55′ to hit weekly minimums');
});
