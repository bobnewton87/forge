// Bug-hunt regressions (CONTRACT §6, §24 + UI-SHELL / UI-TRAIN). One test per bug found while
// driving the app; each name says what used to go wrong.
import test from 'node:test';
import assert from 'node:assert/strict';

import { canLogPast, retroReason, retroTimes, markLogged, RETRO_DAYS, retroFloor } from '../js/engine/retro.js';
import { ds, addDays, norm, fmtShort, fmtDay } from '../js/util.js';
import { parkActiveSession, readinessLabel, readinessColor } from '../js/ui/components.js';

const dsOf = iso => ds(new Date(iso));

// ---------------------------------------------------------------- §24 dates
test('a well-formed date that is not a real day is refused for logging', () => {
  // '2026-09-31' and '2026-10-00' pass /^\d{4}-\d{2}-\d{2}$/ but parseDs rolls them over, so the
  // session would be dated to a day no screen has a cell for — invisible the moment it is logged.
  const now = new Date(2026, 9, 21, 12, 0, 0);
  for (const d of ['2026-09-31', '2026-10-00', '2026-02-30', '2026-04-31', '2026-13-01']) {
    assert.equal(canLogPast(d, now), false, d);
    assert.equal(retroReason(d, now), 'bad-date', d);
  }
  // Real days inside the window are still fine, including the two edges.
  for (const off of [0, -1, -7, -30, -RETRO_DAYS]) {
    const d = ds(addDays(norm(now), off));
    assert.equal(canLogPast(d, now), true, d);
    assert.equal(retroReason(d, now), null, d);
  }
  assert.equal(canLogPast(ds(addDays(norm(now), -RETRO_DAYS - 1)), now), false);
  assert.equal(canLogPast(ds(addDays(norm(now), 1)), now), false);
  // A leap day is a real day.
  assert.equal(canLogPast('2028-02-29', new Date(2028, 2, 1, 12, 0, 0)), true);
  assert.equal(canLogPast('2026-02-29', new Date(2026, 2, 1, 12, 0, 0)), false);
});

test('both timestamps land on the session\'s own day, even just after midnight', () => {
  // Logging today at 00:10 put startedAt on YESTERDAY, so recovery ("days since"), the weekly audit
  // and History attributed the work to the wrong day and week.
  const now = new Date(2026, 9, 21, 0, 10, 0);
  const today = ds(now);
  for (const minutes of [10, 45, 90, 300]) {
    const t = retroTimes(today, { minutes, now });
    assert.equal(dsOf(t.startedAt), today, `startedAt for ${minutes} min`);
    assert.equal(dsOf(t.endedAt), today, `endedAt for ${minutes} min`);
    assert.ok(new Date(t.startedAt) <= new Date(t.endedAt));
  }
  // Later in the day nothing changes: the stamps still end "now".
  const noon = new Date(2026, 9, 21, 12, 0, 0);
  const t = retroTimes(today, { minutes: 45, now: noon });
  assert.equal(new Date(t.endedAt).getTime(), noon.getTime());
  assert.equal(new Date(t.startedAt).getTime(), noon.getTime() - 45 * 60000);
  // An earlier day was already clamped; keep it that way.
  for (const off of [-1, -9, -40]) {
    const d = ds(addDays(norm(now), off));
    const x = retroTimes(d, { minutes: 300, now });
    assert.equal(dsOf(x.startedAt), d, d);
    assert.equal(dsOf(x.endedAt), d, d);
  }
});

// ---------------------------------------------------------------- §6 one active session
function fakeStore(sessions = [], activeId = null) {
  const byId = new Map(sessions.map(s => [s.id, s]));
  return {
    saved: [],
    activeId,
    getActiveSession() { return this.activeId ? byId.get(this.activeId) || null : null; },
    getSession(id) { return byId.get(id) || null; },
    saveSession(s) { byId.set(s.id, s); this.saved.push(JSON.parse(JSON.stringify(s))); return s; },
    setActiveSessionId(id) { this.activeId = id || null; },
  };
}

test('starting something new parks the workout in progress instead of orphaning it', () => {
  // Picking a class (or starting a saved workout) took over the active pointer and left the old
  // session status 'active' with nothing pointing at it: invisible everywhere but History.
  const live = { id: 's_live', date: '2026-10-21', status: 'active', title: 'Live lift', blocks: [] };
  const store = fakeStore([live], 's_live');
  assert.equal(parkActiveSession(store, '"Circuit HIIT"'), true);
  assert.equal(store.getSession('s_live').status, 'planned', 'parked as planned, so it shows under "Saved for later"');
  assert.equal(store.activeId, null);
  assert.equal(store.saved.length, 1);
});

test('parking is a no-op when nothing is in progress', () => {
  const planned = { id: 's_p', date: '2026-10-21', status: 'planned', title: 'Later', blocks: [] };
  for (const [store, label] of [[fakeStore([], null), 'no active session'], [fakeStore([planned], 's_p'), 'a parked session']]) {
    assert.equal(parkActiveSession(store), true, label);
    assert.equal(store.saved.length, 0, label);
  }
  // A store that throws on read must not take the caller down with it.
  assert.equal(parkActiveSession({ getActiveSession() { throw new Error('corrupt'); } }), true);
});

// ---------------------------------------------------------------- display helpers
test('date formatters degrade to a dash instead of throwing on junk', () => {
  // A food/body row with no `d` reached fmtShort() and took the whole screen down.
  for (const v of [undefined, null, '', 'not a date', 0, {}, [], NaN, new Date(NaN), '2026', '20261021']) {
    assert.equal(fmtShort(v), '—', JSON.stringify(v));
    assert.equal(fmtDay(v), '—', JSON.stringify(v));
  }
  assert.equal(fmtShort('2026-10-21'), 'Oct 21');
  assert.equal(fmtDay('2026-10-21'), 'Wed, Oct 21');
  assert.equal(fmtShort(new Date(2026, 9, 21)), 'Oct 21');
  assert.equal(fmtDay('2026-10-21T18:00:00.000Z'), 'Wed, Oct 21', 'an ISO timestamp reads as its calendar day');
});

test('readinessLabel reads null the same way readinessColor does', () => {
  assert.equal(readinessLabel(null, null), readinessLabel(1, 0));
  assert.equal(readinessLabel(null, null), 'On track');
  assert.equal(readinessColor(null, null), readinessColor(1, 0));
  assert.equal(readinessLabel(0.3, 0), 'Recovering');
});

// ---------------------------------------------------------------- service worker
test('the service worker precaches every stylesheet index.html loads', async () => {
  const fs = await import('node:fs');
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const core = /const CORE = \[([^\]]*)\]/.exec(sw);
  assert.ok(core, 'CORE list');
  const cached = core[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '').replace(/^\.\//, ''));
  for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) {
    assert.ok(cached.includes(m[1]), `${m[1]} must be in the service worker's CORE list (a cold offline launch had no accounts.css)`);
  }
  // The cache name is bumped by hand on release; just check it is still there.
  assert.match(sw, /const CACHE = 'forge-v\d+'/);
  // A cache miss must answer with a real Response, never undefined.
  assert.match(sw, /new Response\(/);
});

// ---------------------------------------------------------------- markLogged stays put
test('markLogged still stamps the session done on its own day', () => {
  const now = new Date(2026, 9, 21, 7, 30, 0);
  const s = markLogged({
    id: 's_1', date: '2026-10-20', status: 'active', startedAt: null, endedAt: null, location: 'crunch',
    minutes: 45, title: 'Circuit HIIT', targets: [], source: 'class',
    blocks: [{ kind: 'class', name: 'Circuit HIIT', time: '5:30 am', duration: 45, done: false }], rationale: [], notes: '',
  }, { now });
  assert.equal(s.status, 'done');
  assert.equal(dsOf(s.startedAt), '2026-10-20');
  assert.equal(dsOf(s.endedAt), '2026-10-20');
  assert.equal(s.blocks[0].done, true);
  assert.ok(!('plan' in s));
  assert.equal(retroFloor(now), ds(addDays(norm(now), -RETRO_DAYS)));
});
