// EX-CREDIT: fractional-credit rules for both exercise libraries.
// Pelland et al. 2025 (Sports Med, doi:10.1007/s40279-025-02344-w): direct = 1, synergist = 0.5.
// Group credit for a set is the MAX over the group's regions (see planner groupCreditsOf).
import test from 'node:test';
import assert from 'node:assert/strict';
import upper from '../js/data/exercises-upper.js';
import lower from '../js/data/exercises-lower.js';
import { REGIONS } from '../js/data/muscles.js';

const ALL = [...upper, ...lower];
const TRI = ['triceps_long', 'triceps_lateral', 'triceps_medial'];
const BIC = ['biceps_long', 'biceps_short', 'brachialis'];
const PUSH_PAT = new Set(['horizontal_push', 'vertical_push', 'fly', 'lateral_raise', 'elbow_extension']);
const PULL_PAT = new Set(['horizontal_pull', 'vertical_pull', 'rear_delt', 'shrug', 'elbow_flexion']);
const w = (e, r) => e.muscles[r] || 0;
const groupMax = (e, rs) => Math.max(0, ...rs.map(r => w(e, r)));
const isDip = e => /dip/.test(e.id);
const isUpright = e => /upright/.test(e.id);

// Pressing compounds: presses, push-ups and dips (not warm-ups).
const presses = ALL.filter(e => ['horizontal_push', 'vertical_push'].includes(e.pattern) && e.category === 'compound');
// Rows / pulldowns / pull-ups: compound pulls led by lats or upper back (excludes high pulls).
const rows = ALL.filter(e => ['horizontal_pull', 'vertical_pull'].includes(e.pattern) && e.category === 'compound'
  && (w(e, 'lats') === 1 || w(e, 'upper_back') === 1));

test('all weights are 1 / 0.5 / 0.25 and all region ids are valid', () => {
  for (const e of ALL) {
    assert.ok(e.muscles && Object.keys(e.muscles).length, `${e.id} has no muscles`);
    for (const [r, v] of Object.entries(e.muscles)) {
      assert.ok(REGIONS[r], `${e.id}: unknown region ${r}`);
      assert.ok([1, 0.5, 0.25].includes(v), `${e.id}: ${r}=${v}`);
    }
  }
});

test('pressing compounds credit triceps 0.25-0.75 (group), max 1 per region', () => {
  assert.ok(presses.length >= 40, `only ${presses.length} presses`);
  for (const e of presses) {
    for (const r of TRI) assert.ok(w(e, r) <= 1, `${e.id}: ${r}`);
    const g = groupMax(e, TRI);
    if (g === 1) continue;                     // close-grip / JM / triceps dips: triceps is the prime mover
    assert.ok(g >= 0.25 && g <= 0.75, `${e.id}: triceps credit ${g}`);
    assert.equal(g, 0.5, `${e.id}: Pelland indirect triceps credit should be 0.5, got ${g}`);
    // lateral/medial heads lead in pressing; the long head never gets more than they do
    assert.ok(w(e, 'triceps_long') <= Math.min(w(e, 'triceps_lateral'), w(e, 'triceps_medial')), `${e.id}: long head > lateral/medial`);
  }
});

test('front delts: 0.5 from horizontal presses and dips, 1 from overhead presses', () => {
  for (const e of presses) {
    if (e.pattern === 'vertical_push' && !isDip(e)) assert.equal(w(e, 'delt_front'), 1, `${e.id}: overhead press`);
    else assert.equal(w(e, 'delt_front'), 0.5, `${e.id}: horizontal press / dip`);
  }
});

test('rows and pulldowns credit biceps >= 0.25 per head, >= 0.5 summed, 0.5 group', () => {
  assert.ok(rows.length >= 40, `only ${rows.length} rows/pulldowns`);
  for (const e of rows) {
    for (const r of BIC) assert.ok(w(e, r) >= 0.25 && w(e, r) <= 1, `${e.id}: ${r}=${w(e, r)}`);
    const sum = BIC.reduce((a, r) => a + w(e, r), 0);
    assert.ok(sum >= 0.5, `${e.id}: biceps sum ${sum}`);
    assert.equal(groupMax(e, BIC), 0.5, `${e.id}: biceps group credit`);
  }
  // chin-ups / underhand grips bias the biceps heads; overhand / neutral bias brachialis
  for (const id of ['chinup', 'lat_pulldown_underhand']) {
    const e = ALL.find(x => x.id === id);
    assert.ok(w(e, 'biceps_short') >= w(e, 'brachialis') && w(e, 'biceps_long') >= w(e, 'brachialis'), id);
  }
  for (const id of ['pullup', 'pullup_neutral', 'db_row', 'bb_row']) {
    const e = ALL.find(x => x.id === id);
    assert.ok(w(e, 'brachialis') >= w(e, 'biceps_short') && w(e, 'brachialis') >= w(e, 'biceps_long'), id);
  }
});

test('lateral raises credit traps <= 0.25 (upright rows may keep more)', () => {
  const raises = ALL.filter(e => e.pattern === 'lateral_raise' && !isUpright(e));
  assert.ok(raises.length >= 15);
  for (const e of raises) assert.ok(w(e, 'traps') <= 0.25, `${e.id}: traps ${w(e, 'traps')}`);
});

test('hinges do not credit lats/upper back beyond 0.25', () => {
  for (const e of ALL.filter(x => x.pattern === 'hinge')) {
    assert.ok(w(e, 'lats') <= 0.25 && w(e, 'upper_back') <= 0.25, `${e.id}: lats ${w(e, 'lats')} upper_back ${w(e, 'upper_back')}`);
  }
});

test('obvious mis-credits: flyes/raises never credit arms, curls never credit delts/chest', () => {
  for (const e of ALL) {
    if (['fly', 'lateral_raise'].includes(e.pattern)) for (const r of [...TRI, ...BIC]) assert.equal(w(e, r), 0, `${e.id}: ${r}`);
    if (e.pattern === 'elbow_flexion') for (const r of ['delt_front', 'delt_side', 'delt_rear', 'chest_upper', 'chest_mid', 'chest_lower', ...TRI]) assert.equal(w(e, r), 0, `${e.id}: ${r}`);
    if (e.pattern === 'elbow_extension') for (const r of [...BIC, 'delt_side', 'delt_rear']) assert.equal(w(e, r), 0, `${e.id}: ${r}`);
  }
});

test('push/pull tags: push and pull patterns get exactly one; everything else gets neither', () => {
  for (const e of ALL) {
    const push = e.tags.includes('push'), pull = e.tags.includes('pull');
    assert.ok(!(push && pull), `${e.id}: both push and pull`);
    if (PUSH_PAT.has(e.pattern)) assert.ok(push, `${e.id} (${e.pattern}) should be push`);
    else if (PULL_PAT.has(e.pattern)) assert.ok(pull, `${e.id} (${e.pattern}) should be pull`);
    else assert.ok(!push && !pull, `${e.id} (${e.pattern}) should be neutral`);
  }
  // spot checks named in the brief
  const tag = id => ALL.find(x => x.id === id).tags;
  for (const id of ['db_bench', 'db_shoulder', 'dip_tri', 'db_fly', 'db_lateral', 'tri_pushdown', 'db_tri_oh']) assert.ok(tag(id).includes('push'), id);
  for (const id of ['db_row', 'lat_pulldown', 'pullup', 'face_pull', 'db_rear_fly', 'db_curl', 'trap_shrug']) assert.ok(tag(id).includes('pull'), id);
  for (const id of ['plank', 'trap_dl', 'farmer', 'db_rdl', 'db_wrist_curl']) assert.ok(!tag(id).includes('push') && !tag(id).includes('pull'), id);
});
