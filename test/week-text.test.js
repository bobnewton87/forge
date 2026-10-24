// §18.y TEXT NUMBERS: every weekly sets-vs-target number a screen prints in words is PER UNIT, from the same
// calendar week and counter as the weekly rows (planner.weekPlanSummary units = recovery.weekUnitView), and
// says which number it is. Bob saw "Shoulders: not trained yet, 0/25 sets this week" on a card while the bars
// showed Side delts and Rear delts separately (18 + 7). This file renders the real screens' text and checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, GROUP_ORDER, UNIT_ORDER } from '../js/data/muscles.js';
import { SCULPT_GOALS } from '../js/data/sculpt.js';
import { recommend, weekUnitView, leastCoveredUnit } from '../js/engine/recovery.js';
import { buildWorkout } from '../js/engine/generator.js';
import { planRange, weekPlanSummary, explainWeek, simulateDone } from '../js/engine/planner.js';
import { unitTargets, groupTargets, unitShort, fmtSets } from '../js/engine/targets.js';
import { DEFAULT_LOCATIONS } from '../js/data/equipment.js';
import { defaultProfile } from '../js/store.js';
import { ds, parseDs, addDays } from '../js/util.js';
import * as today from '../js/ui/today.js';
import * as planUi from '../js/ui/plan.js';

const MON = '2026-10-26', NOW = new Date(2026, 9, 26, 7), WED = new Date(2026, 9, 28, 9);
const LOC = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.id, l]));
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, currentLocation: 'crunch', ...patch });
const PROFILES = [
  ['default', prof()],
  ['sliders 1.5', prof({ groupPriority: Object.fromEntries(GROUP_ORDER.map(g => [g, 1.5])) })],
  ['every sculpt goal', prof({ sculptGoals: Object.keys(SCULPT_GOALS) })],
];

const text = html => String(html || '').replace(/<[^>]+>/g, ' | ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
// Every "a/b" or "a of b" number pair in a string is checked against the nearest muscle name before it
// (within 40 characters): a GROUP name that is not also a unit's name ("Shoulders", "Core") may never
// carry a number pair, and a unit's pair must end in that unit's own target, min or max.
function checkText(where, s, profile) {
  const U = unitTargets(profile);
  const unitNames = new Map(UNIT_ORDER.filter(u => U[u]).map(u => [unitShort(u), u]));
  const groupOnly = GROUP_ORDER.map(g => GROUPS[g].name).filter(n => !unitNames.has(n));
  const labels = [...unitNames.keys(), ...groupOnly].sort((a, b) => b.length - a.length);
  const re = /(\d+(?:\.\d)?)\s*(?:\/|of)\s*(\d+(?:\.\d)?)/g;
  let m;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 40), m.index);
    if (/Cardio|cardio|min\b|Targets|targets met/.test(before.slice(-20))) continue;
    let best = null, at = -1;
    for (const l of labels) { const i = before.lastIndexOf(l); if (i > at && /^[^A-Za-z]?$/.test(before[i + l.length] || '') ) { at = i; best = l; } }
    if (!best) continue;
    assert.ok(!groupOnly.includes(best), `${where}: a group name carries a weekly number: "…${before}${m[0]}…"`);
    const u = unitNames.get(best), x = U[u], b = m[2];
    assert.ok([x.target, x.min, x.max].map(fmtSets).includes(b), `${where}: "${best} ${m[0]}" is not ${best}'s own target/min/max (${x.min}/${x.target}/${x.max})`);
  }
  assert.ok(!/target sets this week|sets this week incl\. planned/.test(s), `${where}: legacy wording: ${s.slice(0, 200)}`);
}

function fakeCtx(profile, sessions) {
  const kv = {};
  let sheet = '';
  const store = { getProfile: () => profile, getSessions: () => sessions, getActiveSession: () => null, kv: (k, v) => (v === undefined ? kv[k] : (kv[k] = v)),
    getSession: id => sessions.find(s => s.id === id), saveSession() {}, subscribe() {}, getBodyLog: () => [], getMeasurements: () => [], replacePlanned() {} };
  return { kv, ctx: { store, location: () => profile.locations.find(l => l.id === 'crunch'), openSheet: h => { sheet = h; }, toast() {}, nav() {}, rerender() {} }, sheet: () => sheet };
}

test('one week view: weekUnitView IS the weekly rows (weekPlanSummary units), for any profile, week and day', () => {
  for (const [name, p] of PROFILES) {
    const plan = planRange({ from: MON, days: 14, profile: p, sessions: [], now: NOW, seed: 9 });
    // one day logged (Monday's plan, done), the rest still planned
    const done = { ...simulateDone(plan[0]), id: 'done1' };
    const sessions = [done, ...plan.slice(1)];
    for (const now of [NOW, WED, new Date(2026, 10, 3, 8)]) for (const wk of [MON, '2026-11-02']) {
      const v = weekUnitView(sessions, { profile: p, now, weekStart: wk });
      const sum = weekPlanSummary(sessions, { weekStart: parseDs(wk), profile: p, now });
      for (const u of UNIT_ORDER) for (const k of ['done', 'planned', 'total', 'min', 'target', 'max'])
        assert.equal(v.units[u][k], sum.units[u][k], `${name} ${ds(now)} wk ${wk} ${u}.${k}`);
    }
  }
});

test('no screen text quotes a group-sum target: cards, tiles, preview, rationale, plan day sheet, warnings', () => {
  // the checker catches what Bob saw, and the old generator wording
  assert.throws(() => checkText('neg', 'Shoulders: not trained yet, 0/25 sets this week', prof()), /group name carries a weekly number/);
  assert.throws(() => checkText('neg', 'Focus: Triceps (0/19 target sets this week)', prof()), /legacy wording/);
  assert.throws(() => checkText('neg', 'Side delts: 0 of 25 done this week', prof()), /not Side delts's own target/);
  checkText('pos', 'Side delts: not trained yet · 0 of 18 done this week (priority)', prof());
  for (const [name, p] of PROFILES) {
    // sanity: shoulders' group sum is not a number any unit owns, so a leak would be caught
    const G = groupTargets(p).shoulders, U = unitTargets(p);
    assert.ok(G.target > U.delt_side.target && G.target > U.delt_rear.target, `${name}: fixture`);
    const plan = planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 5 });
    const sessions = [{ ...simulateDone(plan[0]), id: 'done1' }, ...plan.slice(1)];
    // engines: recommend (with and without the week view), the generator, the planner, the summary
    const week = weekUnitView(sessions, { profile: p, now: WED });
    for (const w of [week, null]) for (const r of recommend(sessions.filter(s => s.status !== 'planned'), { now: WED, profile: p, minutes: 45, location: LOC.crunch, week: w })) r.reasons.forEach(x => checkText(`${name} card ${r.label}`, x, p));
    for (const t of [['shoulders'], ['upper'], ['shoulders', 'triceps'], []]) {
      const s = buildWorkout({ targets: t, minutes: 45, location: LOC.crunch, profile: p, sessions, now: WED, seed: 2 });
      s.rationale.forEach(x => checkText(`${name} build ${t}`, x, p));
    }
    for (const s of plan) [...(s.rationale || []), s.plan?.reason, s.plan?.extended?.reason].filter(Boolean).forEach(x => checkText(`${name} plan ${s.date}`, x, p));
    const sum = weekPlanSummary(sessions, { weekStart: parseDs(MON), profile: p, now: WED });
    [...sum.warnings, sum.targets.line, ...sum.targets.short.map(x => x.whyText)].forEach(x => checkText(`${name} summary`, x, p));
    Object.values(explainWeek(sessions, { weekStart: parseDs(MON), profile: p, now: WED })).forEach(x => checkText(`${name} why`, x.reason, p));
    // screens: Today (cards + tiles), Today's preview of a built draft, Plan's day sheet for every planned day
    const F = fakeCtx(p, sessions);
    const t1 = text(today.render(F.ctx, {}));
    checkText(`${name} Today`, t1, p);
    assert.ok(!/Shoulders \| [^|]*\| \d/.test(t1), `${name}: the Shoulders tile quotes a number of its own`);
    assert.match(t1, /Side delts \d+(\.\d)?\/\d+/, `${name}: the Shoulders tile shows its least-covered unit`);
    const draft = buildWorkout({ targets: ['shoulders', 'triceps'], minutes: 45, location: LOC.crunch, profile: p, sessions, now: new Date(), seed: 3 });
    F.kv.draft = { session: { ...draft, date: ds(new Date()) }, params: { targets: ['shoulders', 'triceps'], minutes: 45, locationId: 'crunch', style: 'hypertrophy' } };
    const t2 = text(today.render(F.ctx, {}));
    checkText(`${name} preview`, t2, p);
    assert.match(t2, /This week, before this workout: /, `${name}: the preview names its numbers`);
    for (const s of plan.slice(1).filter(x => x.plan?.kind === 'lift')) {   // plan[0] is the logged day
      planUi.openDay(F.ctx, s.date);
      const t3 = text(F.sheet());
      checkText(`${name} day sheet ${s.date}`, t3, p);
      assert.match(t3, /Week incl\. this day: /, `${name} ${s.date}: the day sheet's week line`);
    }
  }
});

test('the numbers a card and a tile quote are the weekly rows\' numbers, labelled', () => {
  const p = prof();
  const plan = planRange({ from: MON, days: 7, profile: p, sessions: [], now: NOW, seed: 5 });
  const sessions = [{ ...simulateDone(plan[0]), id: 'done1' }, ...plan.slice(1)];
  const sum = weekPlanSummary(sessions, { weekStart: parseDs(MON), profile: p, now: WED });
  const week = weekUnitView(sessions, { profile: p, now: WED });
  for (const r of recommend(sessions.filter(s => s.status !== 'planned'), { now: WED, profile: p, minutes: 45, location: LOC.crunch, week })) {
    for (const g of r.groups) {
      const u = leastCoveredUnit(week, g); if (!u) continue;
      const line = r.reasons.find(x => x.startsWith(`${unitShort(u)}: `)); if (!line) continue;
      const x = sum.units[u];
      assert.ok(line.includes(`${fmtSets(x.done)} of ${fmtSets(x.target)} done`), `${line} vs row ${x.done}/${x.target}`);
      if (x.planned >= 0.05) assert.ok(line.includes(`${fmtSets(x.planned)} planned`), line);
    }
  }
  // the tiles carry the same numbers as data attributes
  const F = fakeCtx(p, sessions);
  const html = today.render(F.ctx, {});
  for (const m of html.matchAll(/data-unit="([a-z_]+)" data-done="([\d.]+)" data-target="([\d.]+)"/g)) {
    const [, u, d, t] = m;
    const tw = weekUnitView(sessions, { profile: p, now: new Date() }).units[u];
    assert.equal(Number(d), tw.done, `${u} done`); assert.equal(Number(t), tw.target, `${u} target`);
  }
});
