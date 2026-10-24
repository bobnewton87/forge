// VOLUME-COHESION (CONTRACT §18, volume audit 2026-10-21): one number, everywhere.
//
// The promise these tests pin: for the same profile and the same week, every public entry point that
// reports training volume reports the SAME per-muscle set counts and the SAME targets. Each test says
// which two screens would otherwise disagree, because that is the bug class (a number computed locally
// on one screen drifting from the shared one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, GROUPS, GROUP_ORDER, VOLUME_UNITS, UNIT_ORDER, COUNTED_UNITS, TARGETED_REGIONS, isCountedUnit, unitCredits, unitWeight } from '../js/data/muscles.js';
import { SCULPT_GOALS } from '../js/data/sculpt.js';
import { getEx } from '../js/data/exercises.js';
import * as rec from '../js/engine/recovery.js';
import * as TG from '../js/engine/targets.js';
import { planRange, weekPlanSummary, explainWeek, weekUnitTotals, simulateDone } from '../js/engine/planner.js';
import { workingSets } from '../js/engine/generator.js';
import { defaultProfile } from '../js/store.js';
import { ds, addDays, weekStart, parseDs } from '../js/util.js';

const MON = '2026-10-26';                    // a Monday
const monDate = parseDs(MON);
const NOW = new Date(2026, 9, 26, 7, 0);
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, ...patch });
const r1 = x => Math.round(x * 10) / 10;
const close = (a, b, eps = 0.051, m = '') => assert.ok(Math.abs(a - b) <= eps, `${m} ${a} vs ${b}`);

// The profiles every cross-module check runs over: defaults, raised and lowered sliders, no sculpt
// goals, every sculpt goal, and the §23 weight-loss floors.
const PROFILES = [
  ['default', prof()],
  ['no sculpt', prof({ sculptGoals: [] })],
  ['all sliders 1.5', prof({ groupPriority: Object.fromEntries(GROUP_ORDER.map(g => [g, 1.5])) })],
  ['all sliders 2', prof({ groupPriority: Object.fromEntries(GROUP_ORDER.map(g => [g, 2])) })],
  ['arms down', prof({ groupPriority: { biceps: 0.5, triceps: 0.5 } })],
  ['every sculpt goal', prof({ sculptGoals: Object.keys(SCULPT_GOALS) })],
  ['weight loss, maintenance floors', prof({ goal: 'weight_loss', volumePolicy: { floors: 'maintenance' }, body: { ...prof().body, goalWeightLb: 150 } })],
];

// Planning a week is the expensive part of this file and several tests need the same weeks, so plan
// each profile once. (It also keeps this file from starving the planner's own timing tests when
// node --test runs files in parallel.)
const planCache = new Map();
const weekFor = (name, p) => {
  if (!planCache.has(name)) planCache.set(name, planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 7 }));
  return planCache.get(name);
};

// ---------------------------------------------------------------- the import cycle
// recovery.js reads targets.unitTargets and targets.js reads recovery.sessionVolume. The cycle is
// deliberate (§18: one resolver) and only safe because neither side calls the other during module
// evaluation. Pin every entry order, including generator.js (which pulls recovery, which pulls
// targets, which pulls generator): a `const` spread of a generator export in targets.js broke this.
test('cohesion: the recovery ↔ targets cycle loads from any entry point', async () => {
  const orders = [
    ['../js/engine/recovery.js', '../js/engine/targets.js'],
    ['../js/engine/targets.js', '../js/engine/recovery.js'],
    ['../js/engine/generator.js', '../js/engine/targets.js'],
    ['../js/engine/planner.js'],
    ['../js/engine/projection.js'],
  ];
  for (const order of orders) {
    const { stdout, stderr, status } = await import('node:child_process').then(cp => cp.spawnSync(process.execPath, ['--input-type=module', '-e',
      `${order.map((m, i) => `const m${i} = await import(${JSON.stringify(m.replace('../js/', './js/'))});`).join('\n')}
       const T = await import('./js/engine/targets.js'); const R = await import('./js/engine/recovery.js');
       const { defaultProfile } = await import('./js/store.js');
       if (!Object.keys(T.unitTargets(defaultProfile())).length) throw new Error('no unit targets');
       if (!Object.keys(R.groupStatus([], { profile: defaultProfile() })).length) throw new Error('no group status');
       if (!Array.isArray(T.STYLES) || !T.STYLES.length) throw new Error('STYLES binding broken');
       console.log('ok');`],
    { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }));
    assert.equal(status, 0, `${order.join(' then ')}: ${stderr}`);
    assert.match(stdout, /ok/);
  }
});

// ---------------------------------------------------------------- one target table
test('cohesion: a group target is exactly the sum of its counted units, on every screen', () => {
  for (const [name, p] of PROFILES) {
    const U = TG.unitTargets(p), G = TG.groupTargets(p), WM = TG.weeklyMinimums(p);
    const RT = TG.resolveTargets(p);
    const gs = rec.groupStatus([], { now: NOW, profile: p });
    for (const g of GROUP_ORDER) {
      const counted = COUNTED_UNITS[g];
      assert.ok(counted.length, `${g} has no counted unit`);
      for (const k of ['min', 'target', 'max']) {
        const want = r1(counted.reduce((a, u) => a + U[u][k], 0));
        close(G[g][k], want, 0.051, `${name} ${g}.${k}: groupTargets`);
        close(WM[g][k], want, 0.051, `${name} ${g}.${k}: weeklyMinimums`);
        close(RT.minimums.groups[g][k], want, 0.051, `${name} ${g}.${k}: resolveTargets.minimums.groups`);
        close(gs[g].target[k], want, 0.051, `${name} ${g}.${k}: recovery.groupStatus`);
      }
      // No tracked-only or sub-unit ceiling is ever added into a group's max (the bug that made
      // back's max 52 and shoulders' 64, so "over the weekly max" could never fire for them).
      assert.ok(G[g].max <= counted.length * 24 + 0.01, `${name} ${g}: max ${G[g].max}`);
      for (const u of [...G[g].sub, ...G[g].tracked]) assert.ok(!counted.includes(u), `${name} ${g}: ${u} counted`);
    }
    close(G.back.max, U.back.max, 0.051, `${name} back max`);
    close(G.shoulders.max, U.delt_side.max + U.delt_rear.max, 0.051, `${name} shoulders max`);
  }
});

test('cohesion: every target stays inside [min, max] and the clamp is applied once', () => {
  for (const [name, p] of PROFILES) {
    const U = TG.unitTargets(p);
    for (const id of UNIT_ORDER) {
      const x = U[id];
      assert.ok(x.min <= x.target + 0.001 && x.target <= x.max + 0.001, `${name} ${id}: ${x.min}/${x.target}/${x.max}`);
      assert.equal(x.max, VOLUME_UNITS[id].max, `${name} ${id}: max moved with priority`);
      // The one priority mechanism: target = clamp(base × slider + sculpt extras, [min, max]).
      const want = Math.min(x.max, Math.max(x.min, x.base * x.slider + x.extra));
      close(x.target, r1(want), 0.051, `${name} ${id}: target derivation`);
      // maxNote explains the clamp once, and only when it is actually binding.
      const n = TG.maxNote(id, x);
      if (x.target > 0) {
        assert.ok(n, `${name} ${id}: no maxNote`);
        assert.equal(n.capped, x.base * x.slider + x.extra > x.max + 0.05, `${name} ${id}: capped flag`);
        if (n.capped) assert.match(n.text, new RegExp(`max of ${x.max}`), `${name} ${id}`);
      }
    }
  }
});

test('cohesion: the priority slider moves the target and nothing else', () => {
  const base = TG.unitTargets(prof({ sculptGoals: [] }));
  for (const mult of [0.5, 1.5, 2]) {
    const U = TG.unitTargets(prof({ sculptGoals: [], groupPriority: Object.fromEntries(GROUP_ORDER.map(g => [g, mult])) }));
    for (const id of UNIT_ORDER) {
      assert.equal(U[id].min, base[id].min, `${id} min moved at ×${mult}`);
      assert.equal(U[id].max, base[id].max, `${id} max moved at ×${mult}`);
      close(U[id].target, r1(Math.min(U[id].max, Math.max(U[id].min, U[id].base * mult))), 0.051, `${id} at ×${mult}`);
    }
  }
  // 0.5–2× is the range, and a normal muscle can reach its max at 2× (biceps 10 × 2 = 20).
  assert.deepEqual(TG.LIMITS.priority, [0.5, 2]);
  close(TG.unitTargets(prof({ sculptGoals: [], groupPriority: { biceps: 2 } })).biceps.target, 20);
});

test('cohesion: a sculpt goal delivers all of its extra sets to muscles that have a target', () => {
  for (const [id, goal] of Object.entries(SCULPT_GOALS)) {
    if (!(goal.extraWeeklySets > 0)) continue;
    const ex = TG.sculptExtraByRegion({ sculptGoals: [id] });
    const total = Object.values(ex).reduce((a, x) => a + x, 0);
    close(total, goal.extraWeeklySets, 0.011, `${id}: extra sets delivered`);
    // Every one of them lands on a region that feeds a unit with a target (a share that landed on
    // front delts / traps / lower back used to be clamped away silently).
    for (const r of Object.keys(ex)) assert.ok(TARGETED_REGIONS.has(r), `${id}: ${r} has no target`);
    // And the goal's own group gets a leading share of them: the top group, or a close second for a
    // goal that deliberately spans two (arm_size is filed under triceps and splits arms roughly evenly).
    const byGroup = {};
    for (const [r, x] of Object.entries(ex)) byGroup[REGIONS[r].group] = (byGroup[REGIONS[r].group] || 0) + x;
    const ranked = Object.entries(byGroup).sort((a, b) => b[1] - a[1]);
    assert.ok(ranked.findIndex(([g]) => g === goal.group) <= 1, `${id}: steers ${ranked[0][0]}, not ${goal.group}`);
    assert.ok(byGroup[goal.group] >= goal.extraWeeklySets / 3, `${id}: only ${r1(byGroup[goal.group])} of ${goal.extraWeeklySets} reaches ${goal.group}`);
  }
  // Turning a goal on raises its group's target, never its minimum.
  for (const [id, goal] of Object.entries(SCULPT_GOALS)) {
    if (!(goal.extraWeeklySets > 0)) continue;
    const off = TG.groupTargets(prof({ sculptGoals: [] })), on = TG.groupTargets(prof({ sculptGoals: [id] }));
    assert.equal(on[goal.group].min, off[goal.group].min, `${id}: moved a minimum`);
    assert.ok(on[goal.group].target >= off[goal.group].target, `${id}: lowered a target`);
  }
});

// ---------------------------------------------------------------- one counter
test('cohesion: one set-counting rule — warm-ups never count, working sets count once per unit', () => {
  const ex = getEx('db_bench');
  const blk = sets => ({ kind: 'lift', exId: 'db_bench', target: { sets: sets.length }, sets });
  const logged = blk([{ w: 50, r: 10, done: true }, { w: 50, r: 10, done: true }, { w: 50, r: null, done: false }]);
  assert.equal(rec.blockSets(logged), 2, 'only sets logged with reps count');
  assert.equal(rec.blockSets(logged, { planned: true }), 3, 'a planned day counts its prescription');
  const v = rec.sessionVolume({ date: MON, status: 'done', blocks: [logged] });
  assert.equal(v.liftSets, 2);
  // A set credits each unit once, at the largest weight over the unit's regions (fractional credit).
  for (const [u, w] of Object.entries(unitCredits(ex))) close(v.units[u], 2 * w, 0.011, `unit ${u}`);
  close(v.groups.chest, 2 * Math.max(...GROUPS.chest.regions.map(r => ex.muscles[r] || 0)), 0.011, 'group credit counts a set once');
  // Region credit is per region (the per-head display share), so it does NOT equal the unit credit.
  close(v.regions.chest_upper, 2 * ex.muscles.chest_upper, 0.011);
});

test('cohesion: the same week yields identical per-unit sets through every entry point', () => {
  for (const [name, p] of PROFILES) {
    const plan = weekFor(name, p);
    const sum = weekPlanSummary(plan, { weekStart: monDate, profile: p, now: NOW });
    const exp = explainWeek(plan, { weekStart: monDate, profile: p, now: NOW });
    const wut = weekUnitTotals(plan, MON, ds(addDays(monDate, 6)), MON);
    // What Body counts: the shared counter over this calendar week, logged + still planned.
    const body = rec.unitSets(plan, { from: MON, to: ds(addDays(monDate, 6)), today: MON, includePlanned: true }).units;
    // What Today / the live session show per group, via recovery.groupStatus in plan mode.
    const gs = rec.groupStatus(plan.filter(s => s.status !== 'planned'), { now: NOW, profile: p, upcoming: plan.filter(s => s.status === 'planned') });
    const G = TG.groupTargets(p);
    for (const u of UNIT_ORDER) {
      const want = r1(wut.units[u] || 0);
      close(sum.units[u].total, want, 0.051, `${name} ${u}: Plan week coverage`);
      close(body[u] || 0, want, 0.051, `${name} ${u}: Body weekly sets`);
      if (exp[u]) close(exp[u].planned, want, 0.051, `${name} ${u}: Why-these-numbers sheet`);
    }
    for (const g of GROUP_ORDER) {
      const want = r1(COUNTED_UNITS[g].reduce((a, u) => a + (wut.units[u] || 0), 0));
      close(gs[g].sets7d, want, 0.051, `${name} ${g}: groupStatus sets this week`);
      close(gs[g].target.target, G[g].target, 0.051, `${name} ${g}: groupStatus target`);
      close(sum.groups[g].total, want, 0.051, `${name} ${g}: weekPlanSummary.groups total`);
      close(sum.groups[g].target.target, G[g].target, 0.051, `${name} ${g}: weekPlanSummary.groups target`);
      // The ONE thing that must hold for the bar to mean anything: the sets and the target count the
      // same muscles, so sets/target is comparable.
      assert.deepEqual(Object.keys(gs[g].units), COUNTED_UNITS[g], `${name} ${g}: units behind the bar`);
    }
  }
});

test('cohesion: "sets this week" means the same window on Body as on Plan, mid-week', () => {
  const p = prof();
  const plan = weekFor('default', p);
  // Wednesday: Mon + Tue logged, Thu + Fri still planned.
  const wed = new Date(2026, 9, 28, 18);
  const mixed = plan.map(s => (s.date <= ds(addDays(monDate, 1)) ? { ...simulateDone(s), status: 'done' } : s));
  const sum = weekPlanSummary(mixed, { weekStart: monDate, profile: p, now: wed });
  const body = rec.unitSets(mixed, { from: ds(weekStart(wed)), to: ds(addDays(weekStart(wed), 6)), today: ds(wed), includePlanned: true }).units;
  const last7 = rec.unitSets(mixed, { from: ds(addDays(wed, -6)), to: ds(wed) }).units;
  let differed = 0;
  for (const u of UNIT_ORDER) {
    close(body[u] || 0, sum.units[u].total, 0.051, `${u}: Body vs Plan mid-week`);
    if (Math.abs((last7[u] || 0) - sum.units[u].total) > 0.05) differed++;
  }
  // The rolling-7-day figure genuinely differs from the week figure, which is why it is shown as its
  // own clearly-labelled line rather than against the weekly target.
  assert.ok(differed >= 3, 'fixture: the two windows should differ here');
  for (const u of UNIT_ORDER) close(last7[u] || 0, r1(sum.units[u].done), 0.051, `${u}: last-7-days = logged work here`);
});

test('cohesion: one rounding rule for every set number', () => {
  assert.equal(TG.fmtSets(15), '15');
  assert.equal(TG.fmtSets(14.5), '14.5');
  assert.equal(TG.fmtSets(14.75), '14.8');
  assert.equal(TG.fmtSets(14.04), '14');
  assert.equal(TG.fmtSets(0), '0');
  assert.equal(TG.fmtSets(null), '0');
  // The same value never reads as two different numbers: no screen may round 14.5 to 15 or 14.
  for (const v of [8, 10.5, 14.5, 14.75, 18, 19.2, 24]) assert.equal(TG.fmtSets(v), TG.fmtSets(r1(v)));
});

// ---------------------------------------------------------------- the plan delivers it
test('planner: the week aims at targets, bounds overshoot and names every reason', () => {
  for (const [name, p] of PROFILES) {
    const plan = weekFor(name, p);
    const sum = weekPlanSummary(plan, { weekStart: monDate, profile: p, now: NOW });
    const REASONS = new Set(['time', 'max', 'recovery', 'session', 'session_other', 'pushpull', 'exercise', 'policy', 'nolift', 'rounds', 'ceiling', 'ceiling_some']);
    // §26: no planned day passes the workout set ceiling (default 30)
    for (const s of plan.filter(x => x.plan?.kind === 'lift')) assert.ok(workingSets(s) <= TG.sessionSetCapOf(p), `${name} ${s.date}: ${workingSets(s)} working sets`);
    for (const [u, x] of Object.entries(sum.units)) {
      assert.ok(x.total <= x.max + 0.25, `${name} ${u}: ${x.total} over the max of ${x.max}`);
      if (x.target > 0 && x.total > x.target + 1.5) assert.ok(x.overWhy && x.overText, `${name} ${u}: ${x.total}/${x.target} over target without a named reason`);
      if (x.target > 0 && !x.sub && x.total < x.target - 0.25) {
        const sh = sum.targets.short.find(y => y.unit === u);
        assert.ok(sh && REASONS.has(sh.why), `${name} ${u}: ${x.total}/${x.target} short, reason ${sh && sh.why}`);
        assert.ok(sh.whyText, `${name} ${u}: no plain-English reason`);
      }
    }
    assert.ok(sum.pushPull.ok, `${name}: push ${sum.pushPull.push} vs pull ${sum.pushPull.pull}`);
    // The plan aims at the targets, not merely the floors, unless (§26) every lift day is already at the
    // workout set ceiling, in which case the shortfall must name the ceiling (all sliders at 2× asks for
    // more weekly sets than four 30-set workouts hold).
    const counted = UNIT_ORDER.filter(u => sum.units[u].target > 0 && !sum.units[u].sub);
    const hit = counted.filter(u => sum.units[u].total >= sum.units[u].target - 0.25);
    const liftDays = plan.filter(s => s.plan?.kind === 'lift');
    const ceilBound = liftDays.length && liftDays.every(s => workingSets(s) >= TG.sessionSetCapOf(p) - 1);
    assert.ok(hit.length >= counted.length * 0.6 || ceilBound, `${name}: only ${hit.length}/${counted.length} targets reached`);
    if (hit.length < counted.length * 0.6) assert.ok(sum.targets.short.some(x => x.why === 'ceiling' && /workout ceiling on every lift day/.test(x.whyText)), `${name}: ceiling-bound week without saying so`);
  }
});

test('planner: "per-session caps" is only claimed when a muscle really is at its cap', () => {
  // A week with no lift day cannot blame a per-session cap or the clock.
  const none = prof({ schedule: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
    .map(d => [d, d === 'wed' ? { kind: 'cardio', minutes: 30, location: 'home' } : { kind: 'rest', minutes: 0, location: 'home' }])) });
  const sum = weekPlanSummary(weekFor('no lift day', none), { weekStart: monDate, profile: none, now: NOW });
  assert.ok(sum.targets.short.length, 'fixture: nothing can be planned');
  for (const x of sum.targets.short) {
    assert.equal(x.why, 'nolift', `${x.unit}: ${x.why}`);
    assert.match(x.whyText, /no lift day/);
  }
  // Two lift days that both run to the 90-minute cap are TIME-bound, not cap-bound. (§26: with the
  // default 30-set workout ceiling these days stop at the ceiling around an hour, so this fixture raises
  // the ceiling to 50 to keep testing the time story; the ceiling story is the next fixture.)
  const two = prof({ sessionSetCap: 50, schedule: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
    .map(d => [d, d === 'mon' || d === 'thu' ? { kind: 'lift', minutes: 30, location: 'crunch' } : { kind: 'rest', minutes: 0, location: 'home' }])) });
  const plan2 = weekFor('two short lift days', two);
  const sum2 = weekPlanSummary(plan2, { weekStart: monDate, profile: two, now: NOW });
  assert.ok(sum2.targets.short.length >= 3, 'fixture: two short days cannot reach every target');
  const lifts = plan2.filter(s => s.plan?.kind === 'lift');
  assert.ok(lifts.length === 2 && lifts.every(s => (s.estMinutes || 0) >= 75), `fixture: both days lengthened toward the cap (${lifts.map(s => s.estMinutes)})`);
  const unitIn = (s, u) => (s.blocks || []).reduce((a, b) => a + (b.kind === 'lift' ? (Number(b.target?.sets) || 0) * unitWeight(getEx(b.exId), u) : 0), 0);
  for (const x of sum2.targets.short) {
    if (x.why !== 'session') continue;
    // The claim must be checkable: this muscle sits at its own per-session cap on at least one lift
    // day, and no lift day is simply sitting on spare minutes (which would make "time" the honest
    // reason instead). 'session_other' is the reason for the partial case.
    // planner.unitCap: 10 for a big (compound) muscle, 8 otherwise; a priority muscle may reach 12
    // only when spreading across days could not do it, so the PLAIN cap is what must be met.
    const cap = VOLUME_UNITS[x.unit].big ? 10 : 8;
    assert.ok(lifts.some(s => unitIn(s, x.unit) >= cap - 0.6),
      `${x.unit} claims a per-session cap but no day holds near ${cap} (${lifts.map(s => r1(unitIn(s, x.unit))).join('/')})`);
  }
  for (const x of sum2.targets.short) assert.ok(!/ceiling/.test(x.why || ''), `${x.unit}: ceiling claimed under a 50-set ceiling (${lifts.map(workingSets)})`);
  for (const x of sum2.targets.short) assert.ok(x.whyText && x.whyText.length > 8, `${x.unit}: ${x.whyText}`);

  // §26: the same two days under the default 30-set ceiling stop at the CEILING, well short of 90′, and
  // the reason must say so (never "time" or "per-session caps"), and be checkable against the plan.
  const two30 = prof({ schedule: two.schedule });
  const plan3 = weekFor('two short lift days, 30-set ceiling', two30);
  const sum3 = weekPlanSummary(plan3, { weekStart: monDate, profile: two30, now: NOW });
  const lifts3 = plan3.filter(s => s.plan?.kind === 'lift');
  assert.ok(lifts3.length === 2 && lifts3.every(s => workingSets(s) <= 30 && workingSets(s) >= 29), `fixture: both days at the ceiling (${lifts3.map(workingSets)})`);
  assert.ok(lifts3.every(s => (s.estMinutes || 0) < 85), `fixture: the ceiling binds before the 90′ cap (${lifts3.map(s => s.estMinutes)})`);
  assert.ok(sum3.targets.short.length >= 3, 'fixture: two days at 30 sets cannot reach every target');
  for (const x of sum3.targets.short) {
    assert.notEqual(x.why, 'time', `${x.unit}: "time" while every day has minutes left`);
    if (x.why === 'session') assert.ok(lifts3.some(s => unitIn(s, x.unit) >= (VOLUME_UNITS[x.unit].big ? 10 : 8) - 0.6), `${x.unit}: per-session cap claimed`);
  }
  assert.ok(sum3.targets.short.some(x => x.why === 'ceiling'), `the ceiling is named (${sum3.targets.short.map(x => x.why)})`);
  for (const x of sum3.targets.short.filter(y => y.why === 'ceiling')) assert.match(x.whyText, /30-set workout ceiling on every lift day/);
  assert.ok(sum3.capacity.setCap === 30 && sum3.capacity.maxSets === 60, JSON.stringify(sum3.capacity));
  // Whatever the reason, every short target has plain-English text that names something true.
  for (const x of sum3.targets.short) assert.ok(x.whyText && x.whyText.length > 8, `${x.unit}: ${x.whyText}`);
});

test('planner: a retroactively logged past day moves this week the same way everywhere', () => {
  const p = prof();
  const plan = weekFor('default', p);
  const wed = new Date(2026, 9, 28, 18);
  const before = rec.unitSets(plan, { from: MON, to: ds(addDays(monDate, 6)), today: ds(wed), includePlanned: true }).units;
  // CONTRACT §24: a day logged after the fact (Tuesday, logged on Wednesday) is an ordinary done
  // session dated in the past. Every weekly count must pick it up, and recency must see it.
  const retro = { id: 'retro1', date: ds(addDays(monDate, 1)), status: 'done', minutes: 30, location: 'home',
    startedAt: `${ds(addDays(monDate, 1))}T18:00:00.000Z`, endedAt: `${ds(addDays(monDate, 1))}T18:30:00.000Z`,
    blocks: [{ kind: 'lift', exId: 'db_lateral', target: { sets: 4 }, sets: Array.from({ length: 4 }, () => ({ w: 20, r: 15, done: true })) }],
    plan: { kind: 'lift', auto: false }, retro: true };
  const after = rec.unitSets([...plan, retro], { from: MON, to: ds(addDays(monDate, 6)), today: ds(wed), includePlanned: true }).units;
  const credit = 4 * unitWeight(getEx('db_lateral'), 'delt_side');
  close(after.delt_side - (before.delt_side || 0), credit, 0.051, 'the retro day adds its side-delt sets');
  const sum = weekPlanSummary([...plan, retro], { weekStart: monDate, profile: p, now: wed });
  close(sum.units.delt_side.total, r1(after.delt_side), 0.051, 'Plan sees the retro day');
  assert.ok(sum.units.delt_side.done >= credit - 0.051, 'and counts it as done, not planned');
  const gs = rec.groupStatus([retro], { now: wed, profile: p });
  assert.equal(gs.shoulders.lastTrained, retro.date, 'recency sees the retro day');
  assert.ok(gs.shoulders.readiness < 1, 'and so does readiness');
  const recs = rec.recommend([retro], { now: wed, profile: p, minutes: 45 });
  assert.ok(recs.length, 'and "what should I train" still answers');
  // The reason strings quote the shared numbers.
  const shoulderRec = recs.find(r => r.groups.includes('shoulders'));
  if (shoulderRec) assert.ok(shoulderRec.reasons.some(x => /sets this week/.test(x)), shoulderRec.reasons.join(' | '));
});

// ---------------------------------------------------------------- the handoff to the projection
test('cohesion: the planner hands the projection the sets it planned', () => {
  const p = prof();
  const plan = weekFor('default', p);
  const done = plan.map(s => ({ ...simulateDone(s), status: 'done' }));
  // The projection reads recovery.sessionVolume(...).groups per day. Those group credits must add up
  // to the same week the Plan tab shows, group by group.
  const perGroup = {};
  for (const s of done) for (const [g, w] of Object.entries(rec.sessionVolume(s).groups)) perGroup[g] = (perGroup[g] || 0) + w;
  const sum = weekPlanSummary(done, { weekStart: monDate, profile: p, now: new Date(2026, 10, 1, 23) });
  // weekPlanSummary.groups.groupCredit is the once-per-group figure the projection consumes; .total is
  // the unit-derived one every screen shows. Both must be reachable and correct.
  for (const g of GROUP_ORDER) close(sum.groups[g].groupCredit.total, r1(perGroup[g] || 0), 0.051, `${g}: planner group credit`);
  // And the per-unit totals the planner enforces are reachable from the same sessions, so a consumer
  // that wants per-muscle numbers (what the growth model needs) does not have to re-derive them.
  const units = rec.unitSets(done, { from: MON, to: ds(addDays(monDate, 6)) }).units;
  for (const u of UNIT_ORDER) close(sum.units[u].total, r1(units[u] || 0), 0.051, `${u}: planner unit credit`);
});

// ---------------------------------------------------------------- other shared targets
// Same bug class as the set counts: a target that two modules each default on their own.
test('cohesion: the protein default is per goal and identical in targets and nutrition', async () => {
  const NU = await import('../js/engine/nutrition.js');
  for (const goal of TG.GOALS) {
    const p = prof({ goal, bodyweight: 170, nutrition: { mode: 'simple' } });
    const resolved = TG.resolveTargets(p).nutrition.proteinGPerLb;
    const dt = NU.dailyTargets(p, { dayType: 'lift', bodyweight: 170 });
    assert.ok(dt && dt.protein > 0, `${goal}: nutrition gave no protein target`);
    // What the editor's slider shows must be what the day's target is computed from.
    close(resolved, Math.round(dt.protein / 170 * 100) / 100, 0.011, `${goal}: targets vs nutrition protein`);
    close(resolved, TG.defaultProteinGPerLb(p), 0.011, `${goal}: defaultProteinGPerLb`);
  }
  // A cut defends muscle with more protein than a recomp; that difference must survive the resolver.
  assert.ok(TG.defaultProteinGPerLb(prof({ goal: 'cut' })) > TG.defaultProteinGPerLb(prof({ goal: 'recomp' })), 'a cut should default higher');
  // An explicit setting always wins over either default.
  close(TG.resolveTargets(prof({ goal: 'cut', bodyweight: 170, nutrition: { mode: 'simple', proteinGPerLb: 1.3 } })).nutrition.proteinGPerLb, 1.3, 0.011);
  // CONTRACT-NOTE: nutrition.js owns the table; the copy in targets.js (PROTEIN_FALLBACK) exists only
  // until that export lands. If nutrition.js exports it, the two must agree exactly.
  if (NU.DEFAULT_PROTEIN) for (const goal of TG.GOALS) close(TG.defaultProteinGPerLb(prof({ goal })), NU.DEFAULT_PROTEIN[goal], 0.001, `${goal}: fallback table drifted from nutrition.DEFAULT_PROTEIN`);
});

test('cohesion: a deficit is converted to cardio minutes with NET calories', async () => {
  const { estimateCalories } = await import('../js/data/cardio.js');
  const W = 170;
  // Net is exactly (METs - 1) / METs of the gross figure: resting is 1 MET by definition.
  for (const [mod, int] of [['bike', 'easy'], ['run', 'hard'], ['walk', 'easy']]) {
    const gross = estimateCalories(mod, 60, int, W);
    const mets = gross / (W / 2.20462);
    close(TG.netKcalPerMin(mod, int, W), gross / 60 * (mets - 1) / mets, 0.011, `${mod}/${int}`);
    assert.ok(TG.netKcalPerMin(mod, int, W) < gross / 60, `${mod}/${int}: net must be below gross`);
  }
  assert.equal(TG.netKcalPerMin('not-a-modality', 'easy', W), 0, 'unknown modality costs nothing');
  assert.equal(TG.netKcalPerMin('bike', 'easy', 0), TG.netKcalPerMin('bike', 'easy', 165), 'a missing weight falls back, it does not divide by zero');
  // The prescription must cover the deficit when the minutes are actually done.
  const p = prof({ goal: 'weight_loss', bodyweight: W, body: { ...prof().body, goalWeightLb: 150 } });
  const plan = TG.resolveTargets(p).goals.plan;
  assert.ok(plan && plan.deficitKcal > 0 && plan.cardioMinPerWeek > 0, 'fixture: a loss plan with a deficit');
  const covered = plan.cardioMinPerWeek * TG.netKcalPerMin('bike', 'easy', W) / 7;
  close(covered, plan.deficitKcal, Math.max(12, plan.deficitKcal * 0.03), 'minutes x net kcal/min should cover the daily deficit');
  // Gross would have under-prescribed: the honest figure is meaningfully more minutes.
  const grossMin = Math.round(plan.deficitKcal * 7 / (estimateCalories('bike', 60, 'easy', W) / 60) / 5) * 5;
  assert.ok(plan.cardioMinPerWeek > grossMin * 1.1, `net should ask clearly more than gross (${plan.cardioMinPerWeek} vs ${grossMin})`);
});

// ---------------------------------------------------------------- data invariants
test('data: counted units, tracked units and sub-units are consistent', () => {
  for (const g of GROUP_ORDER) {
    assert.deepEqual(COUNTED_UNITS[g], UNIT_ORDER.filter(u => VOLUME_UNITS[u].group === g && isCountedUnit(u)), g);
    assert.deepEqual(GROUPS[g].units, COUNTED_UNITS[g], `${g}: GROUPS.units`);
    for (const u of COUNTED_UNITS[g]) assert.ok(VOLUME_UNITS[u].target > 0 || VOLUME_UNITS[u].min > 0, `${g}: ${u} counted with no numbers`);
  }
  // Every unit's regions belong to its own group, so a group's counted regions are well defined.
  for (const u of UNIT_ORDER) for (const r of VOLUME_UNITS[u].regions) assert.equal(REGIONS[r].group, VOLUME_UNITS[u].group, `${u}/${r}`);
  // Tracked-only units have no target, so nothing can be "short" on them.
  for (const u of UNIT_ORDER) if (VOLUME_UNITS[u].tier === 'tracked') assert.equal(VOLUME_UNITS[u].target, 0, u);
  // The legacy summed-region numbers stay untouched: js/engine/projection.js uses them as its
  // training-distribution shape, and changing them would silently move every long-horizon forecast.
  assert.equal(GROUPS.chest.weeklySets.min, 12);
  assert.equal(GROUPS.shoulders.weeklySets.min, 20);
  assert.equal(GROUP_ORDER.reduce((a, g) => a + GROUPS[g].weeklySets.min, 0), 105);
});
