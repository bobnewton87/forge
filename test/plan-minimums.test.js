// INTEGRATOR: weekly set minimums and targets (weekly-volume audit model, docs/research/weekly-volume-audit.md).
// Enforcement units = VOLUME_UNITS (separate side/rear delts, back = lats + upper back). Minimums are evidence
// floors, always met (lengthening per volumePolicy) unless every lift day is at the cap; targets are filled with
// spare time (or with consent, fillTargets:'extend'); pull ≥ push; per-session caps.
// (Replaces the earlier summed-group-minimum tests, which encoded the inflated model the audit rejected.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../js/store.js';
import { planRange, weekPlanSummary, simulateDone } from '../js/engine/planner.js';
import { estimateMinutes } from '../js/engine/generator.js';
import { sessionVolume } from '../js/engine/recovery.js';
import { VOLUME_UNITS, GROUP_ORDER } from '../js/data/muscles.js';
import { SCULPT_GOALS } from '../js/data/sculpt.js';
import { resolveTargets, applyTargetChange, volumePolicyOf, unitTargets, volumeRoomOptions, MINIMUMS_EVIDENCE } from '../js/engine/targets.js';
import { extendedToast, setsBand } from '../js/ui/targets.js';
import { parseDs } from '../js/util.js';

const MON = '2026-10-26';
const NOW = new Date(2026, 9, 26, 7, 0);
const SMALL = new Set(['shoulders', 'biceps', 'triceps', 'forearms', 'calves', 'core']);
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, ...patch });
const week = (p, extra = {}) => planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 1, ...extra });
const summary = (out, p) => weekPlanSummary(out, { weekStart: parseDs(MON), profile: p, now: NOW });
const sched = (n, m) => {
  const days = { 3: ['mon', 'wed', 'fri'], 4: ['mon', 'tue', 'thu', 'fri'], 5: ['mon', 'tue', 'wed', 'thu', 'fri'], 6: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] }[n];
  return Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => [d, days.includes(d) ? { kind: 'lift', minutes: m, location: 'crunch' } : { kind: 'rest', minutes: 0, location: 'home' }]));
};

// The invariant: every unit with a floor is at its min, OR every lift day is at the time cap (and the
// shortfall says so). Plus: pull ≥ push (±10%), per-session caps, weekly max for topped-up units.
function checkWeek(name, p, out) {
  const sum = summary(out, p);
  const pol = volumePolicyOf(p);
  const lifts = out.filter(s => s.plan.kind === 'lift');
  const cap = s => (pol.mode === 'extend' ? Math.max(s.plan.slot.minutes, pol.maxMinutes) : s.minutes);
  for (const [u, x] of Object.entries(sum.units)) {
    if (!(x.min > 0) || x.total >= x.min - 0.25) continue;
    assert.ok(lifts.every(s => estimateMinutes(s.blocks) >= cap(s) - 5), `${name}: ${u} ${x.total}/${x.min} short while time remains (${lifts.map(s => `${estimateMinutes(s.blocks)}/${cap(s)}`).join(' ')})`);
    assert.equal(sum.minimums.binding, 'time', name);
    assert.ok(sum.warnings.some(w => w.startsWith(x.name) && /cap/.test(w)), `${name}: ${sum.warnings.join(' | ')}`);
  }
  assert.ok(sum.pushPull.ok, `${name}: push ${sum.pushPull.push} vs pull ${sum.pushPull.pull}`);
  for (const s of lifts) {
    const v = sessionVolume(simulateDone(s)).groups;
    for (const [g, x] of Object.entries(v)) assert.ok(x <= 12.01, `${name} ${s.date}: ${x} ${g} sets in one session`);
    const raised = new Set(s.plan.topUp?.raisedCap || []);
    for (const u of Object.keys(s.plan.topUp || {})) {
      const g = VOLUME_UNITS[u]?.group; if (!g || !SMALL.has(g) || !(s.plan.topUp[u] >= 0.5) || raised.has(u)) continue;
      assert.ok(v[g] <= 8.01, `${name} ${s.date}: small group ${g} at ${v[g]} after a top-up`);
    }
    if (s.plan.extended) assert.ok(s.minutes <= cap(s) && Math.abs(estimateMinutes(s.blocks) - s.minutes) <= s.minutes * 0.1, `${name} ${s.date} ${s.minutes} est ${estimateMinutes(s.blocks)}`);
  }
  // never overdo: no unit past its weekly max (fractional credit, incl. what the generator built)
  for (const [u, x] of Object.entries(sum.units)) {
    assert.ok(x.total <= x.max + 0.25, `${name}: ${u} ${x.total} > max ${x.max}`);
    assert.equal(x.status, setsBand(x.total, x), `${name}: ${u} status ${x.status} vs band`);
  }
  return sum;
}

test('policy, unit targets (one priority mechanism) and evidence', () => {
  assert.deepEqual(volumePolicyOf({}), { mode: 'extend', maxMinutes: 90, fillTargets: 'time' });
  const t = resolveTargets(prof());
  assert.equal(t.training.volumePolicy.fillTargets, 'time');
  const base = unitTargets(prof({ sculptGoals: [], groupPriority: {} }));
  const hi = unitTargets(prof({ sculptGoals: [], groupPriority: { triceps: 1.5, shoulders: 1.5 } }));
  for (const u of ['triceps', 'delt_side', 'delt_rear']) {
    assert.equal(hi[u].min, base[u].min, `${u}: sliders never move the floor`);
    assert.ok(hi[u].target > base[u].target && hi[u].target <= VOLUME_UNITS[u].max, u);
  }
  assert.equal(base.delt_side.min, 10); assert.equal(base.delt_rear.min, 4); assert.equal(base.triceps.min, 10);
  const sculpt = unitTargets(prof({ sculptGoals: Object.keys(SCULPT_GOALS), groupPriority: Object.fromEntries(GROUP_ORDER.map(g => [g, 1.5])) }));
  for (const [u, x] of Object.entries(sculpt)) { assert.equal(x.min, VOLUME_UNITS[u].min, u); assert.ok(x.target <= x.max, u); }
  assert.ok(MINIMUMS_EVIDENCE.some(e => /10\.1007\/s40279-025-02344-w/.test(e.source)), 'Pelland 2025 (Sports Med) cited');
  assert.ok(MINIMUMS_EVIDENCE.some(e => /Bickel/.test(e.source)) && MINIMUMS_EVIDENCE.some(e => /Baz-Valle/.test(e.source)));
  const p = applyTargetChange(prof(), { training: { volumePolicy: { mode: 'ask', maxMinutes: 500, fillTargets: 'extend' } } });
  assert.deepEqual(p.volumePolicy, { mode: 'ask', maxMinutes: 180, fillTargets: 'extend' });
  assert.ok(volumeRoomOptions(prof()).every(o => o.label && o.patch));
});

test('status bands compare with the target: under min red, toward target amber, on target green, over max orange', () => {
  const t = { min: 8, target: 14, max: 20 };
  assert.equal(setsBand(6, t), 'under'); assert.equal(setsBand(10, t), 'toward'); assert.equal(setsBand(14, t), 'ok');
  assert.equal(setsBand(19.9, t), 'ok'); assert.equal(setsBand(21, t), 'over');
  assert.equal(setsBand(0, { min: 0, target: 3, max: 6 }), 'toward');
});

test("Bob's default week: minimums met, nothing over max, delts separate, back = lats + upper back, pull ≥ push", () => {
  const p = prof();
  const out = week(p);
  const sum = checkWeek('default', p, out);
  assert.ok(!Object.values(sum.units).some(x => x.status === 'over'), 'no "over" in the default week');
  assert.ok(!sum.warnings.some(w => /over the/.test(w)));
  // the coverage score is target attainment: a fully-on-target week would score higher than this one
  assert.ok(sum.score >= 0 && sum.score <= 100);
  assert.equal(sum.minimums.met, true, sum.warnings.join(' | '));
  assert.ok(sum.units.delt_side.total >= 9.75 && sum.units.delt_rear.total >= 3.75, `side ${sum.units.delt_side.total} rear ${sum.units.delt_rear.total}`);
  assert.ok(sum.units.traps && sum.units.lower_back && sum.units.traps.min === 0, 'traps / lower back tracked, not enforced');
  assert.ok(sum.targets.total >= 10 && sum.targets.met <= sum.targets.total);
  assert.equal(sum.minimums.met, sum.minimums.short.length === 0);
  assert.deepEqual(sum.extended.map(x => x.date), out.filter(s => s.plan.extended).map(s => s.date));
});

test('matrix: sliders × groups, arms/shoulders, chest/back, all sculpt goals (default schedule)', () => {
  const cases = [['default', {}], ...GROUP_ORDER.map(g => [`${g} 1.5`, { groupPriority: { [g]: 1.5 } }]),
    ['arms+shoulders', { groupPriority: { triceps: 1.5, biceps: 1.5, shoulders: 1.5 } }],
    ['chest+back', { groupPriority: { chest: 1.5, back: 1.5 } }],
    ['all sculpt', { sculptGoals: Object.keys(SCULPT_GOALS) }]];
  for (const [name, patch] of cases) for (const seed of [1, 42]) { const p = prof(patch); checkWeek(`${name} s${seed}`, p, week(p, { seed })); }
});

test('matrix: 3/4/5/6 lift days × 30/45/60 min', () => {
  for (const n of [3, 4, 5, 6]) for (const m of [30, 45, 60]) for (const seed of [1, 42]) {
    const p = prof({ schedule: sched(n, m) });
    checkWeek(`${n}x${m} s${seed}`, p, week(p, { seed }));
  }
  const p = prof({ schedule: sched(3, 30), groupPriority: { triceps: 1.5, biceps: 1.5, shoulders: 1.5 } });
  checkWeek('3x30 arms', p, week(p));
});

test("targets: spare time by default; 'extend' fills further with consent", () => {
  const p = prof();
  const t = summary(week(p), p);
  const pe = prof({ volumePolicy: { mode: 'extend', maxMinutes: 90, fillTargets: 'extend' } });
  const oe = week(pe);
  const e = checkWeek('fill extend', pe, oe);
  assert.ok(e.targets.met >= t.targets.met, `${e.targets.met} vs ${t.targets.met}`);
  assert.ok(oe.reduce((n, s) => n + s.minutes, 0) >= week(p).reduce((n, s) => n + s.minutes, 0));
  if (t.targets.met < t.targets.total) assert.ok(t.targets.minutesToHit > 0);
});

test("'fixed' policy never extends; it warns when minimums don't fit", () => {
  const p = prof({ volumePolicy: { mode: 'fixed', maxMinutes: 90 }, schedule: sched(3, 30) });
  const out = week(p);
  assert.ok(out.every(s => !s.plan.extended && s.minutes === s.plan.slot.minutes), out.map(s => `${s.date}:${s.minutes}`).join(' '));
  for (const s of out.filter(x => x.plan.kind === 'lift')) assert.ok(estimateMinutes(s.blocks) <= s.minutes + 2, `${s.date} est ${estimateMinutes(s.blocks)} > ${s.minutes}`);
  const sum = summary(out, p);
  if (!sum.minimums.met) assert.ok(sum.warnings.some(w => /sets: short [\d.]+/.test(w)), sum.warnings.join(' | '));
  const ask = prof({ volumePolicy: { mode: 'ask', maxMinutes: 90 }, schedule: sched(3, 30) });
  assert.ok(week(ask).every(s => !s.plan.extended));
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

test('a 4-week plan stays under 1.5 s', () => {
  const p = prof();
  let best = Infinity, out = [];
  for (let i = 0; i < 2; i++) { const t0 = performance.now(); out = planRange({ from: MON, days: 28, profile: p, sessions: [], now: NOW, seed: 3 }); best = Math.min(best, performance.now() - t0); }
  assert.ok(out.length >= 20);
  assert.ok(best < 1500, `${Math.round(best)} ms`);
});

test('extendedToast summarizes extensions', () => {
  assert.equal(extendedToast([]), null);
  const s = (date, from, to) => ({ date, plan: { extended: { from, to, reason: 'weekly minimums: triceps +4' } } });
  assert.equal(extendedToast([s('2026-10-29', 45, 55), s('2026-10-26', 45, 60)]), 'Extended Mon 45→60′ and Thu 45→55′ to hit weekly minimums');
});
