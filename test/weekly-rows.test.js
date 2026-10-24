// One weekly sets vs target component on every screen (Bob 2026-10-24): "any screen where they're showing
// weekly sets versus target, I want it all to be the same". The bar's full width is the TARGET, faded =
// planned (done included), solid = done, green once done reaches the target; three numbers; no ticks,
// no stars, no band colours. These tests pin the row maths and keep the four screens on the one component.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultProfile } from '../js/store.js';
import { planRange, weekPlanSummary } from '../js/engine/planner.js';
import { weekRow, weeklySetsHTML, weekSummaryFor } from '../js/ui/targets.js';
import { parseDs } from '../js/util.js';

const MON = '2026-10-26';
const NOW = new Date(2026, 9, 28, 7, 0);   // Wednesday: some of the week done, some still planned
const width = (html, cls) => Number((html.match(new RegExp(`<i class="${cls}" style="width:([\\d.]+)%`)) || [])[1]);
const attr = (html, a) => (html.match(new RegExp(`data-${a}="([^"]*)"`)) || [])[1];

test('the full bar is the target: done and planned are fractions of it', () => {
  const h = weekRow('Triceps', { done: 6, total: 12, target: 15, max: 24 });
  assert.equal(width(h, 'd'), 40);
  assert.equal(width(h, 'p'), 80);
  assert.match(h, /<b class="d">6<\/b> done · <span class="p">12<\/span> planned · <span class="t">15<\/span> target/);
  assert.ok(!/\bhit\b/.test(h.split('>')[0]), 'not green before done reaches the target');
});

test('green only when DONE reaches the target, not when the plan does', () => {
  const planOnly = weekRow('Biceps', { done: 4, total: 11, target: 10, max: 20 });
  assert.ok(!/class="wk-row hit/.test(planOnly), 'a plan that covers the target is not a hit yet');
  assert.equal(width(planOnly, 'p'), 100, 'planned past the target fills the bar and stops');
  const hit = weekRow('Biceps', { done: 10, total: 10, target: 10, max: 20 });
  assert.match(hit, /class="wk-row hit/);
  assert.match(hit, /✓ 10<\/b> done/);
  assert.match(weekRow('Biceps', { done: 9.96, total: 9.96, target: 10 }), /class="wk-row hit/, '9.96 prints as 10, so it reads as hit');
});

test('no ticks, no stars, no band colours; past the weekly max adds one warning line', () => {
  const h = weekRow('Side delts', { done: 3, total: 26, target: 14, max: 24 });
  for (const bad of ['tick', 'tk ', '★', 'under', 'toward', 'tgb']) assert.ok(!h.includes(bad), `no "${bad}"`);
  assert.match(h, /wk-warn">Planned past the 24-set weekly max/);
  assert.ok(!weekRow('Side delts', { done: 3, total: 24, target: 14, max: 24 }).includes('wk-warn'), 'at the max is fine');
});

test('cardio uses the same row in minutes and never warns about a set max', () => {
  const h = weekRow('🏃 Cardio', { done: 40, total: 120, target: 150, max: 1 }, { unit: 'min', cls: 'cardio' });
  assert.match(h, /40′<\/b> done · <span class="p">120′<\/span> planned · <span class="t">150′<\/span> target/);
  assert.ok(!h.includes('wk-warn'));
});

test('weeklySetsHTML prints exactly the planner summary numbers, one row per muscle with a target', () => {
  const p = { ...defaultProfile(), bodyweight: 170 };
  const sessions = planRange({ from: MON, days: 7, profile: p, sessions: [], now: new Date(2026, 9, 26, 7, 0), seed: 1 })
    .map(s => (s.date < '2026-10-28' && s.plan?.kind === 'lift' ? { ...s, status: 'done', blocks: s.blocks.map(b => b.kind === 'lift' ? { ...b, sets: (b.sets || []).map(x => ({ ...x, done: true, r: x.r || 10 })) } : b) } : s));
  const sum = weekPlanSummary(sessions, { weekStart: parseDs(MON), profile: p, now: NOW });
  assert.deepEqual(weekSummaryFor(sessions, p, { now: NOW }), sum, 'the helper is the planner summary for this week');
  const html = weeklySetsHTML(sum, p);
  const rows = html.split(/class="wk-row(?=[ "])/).slice(1);   // not the wk-rows container
  const want = Object.entries(sum.units).filter(([, x]) => x.min > 0 || x.target > 0);
  assert.equal(rows.length, want.length);
  for (const [u, x] of want) {
    const row = rows.find(r => r.includes(`data-unit="${u}"`));
    assert.ok(row, `row for ${u}`);
    assert.equal(Number(attr(row, 'done')), Math.round(x.done * 10) / 10, `${u} done`);
    assert.equal(Number(attr(row, 'total')), Math.round(x.total * 10) / 10, `${u} planned`);
    assert.equal(Number(attr(row, 'target')), Math.round((x.target || x.min) * 10) / 10, `${u} target`);
  }
  assert.ok(want.some(([, x]) => x.done > 0), 'the fixture has logged work');
  const only = weeklySetsHTML(sum, p, { only: ['triceps', 'biceps'] });
  assert.equal(only.split(/class="wk-row(?=[ "])/).length - 1, 2, 'the workout summary can show just the muscles it trained');
  assert.ok(!only.includes('Tracked, not counted'));
});

test('every weekly sets vs target screen uses the one component', () => {
  const src = f => readFileSync(new URL(`../js/ui/${f}`, import.meta.url), 'utf8');
  for (const f of ['plan.js', 'body.js', 'session.js']) {
    const s = src(f);
    assert.ok(/weeklySetsHTML\(/.test(s), `${f} renders weeklySetsHTML`);
    for (const old of ['targetBar(', 'pl-bar-row', 'pl-track', 'class="tick', 'STAR_LEGEND', '★']) assert.ok(!s.includes(old), `${f} still has ${old}`);
  }
});
