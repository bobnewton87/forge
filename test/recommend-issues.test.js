// §26 B: Today's "What should I train?" cards respect active issues: a card whose muscles an issue leaves
// nothing for is dropped, a card whose muscles it limits is down-ranked, its reasons say what the issue
// changes, and every card agrees with what Build actually produces from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getEx } from '../js/data/exercises.js';
import { REGIONS } from '../js/data/muscles.js';
import { recommend, weekUnitView } from '../js/engine/recovery.js';
import { buildWorkout, groupAvailability, availabilityLine } from '../js/engine/generator.js';
import { issueFilter } from '../js/engine/issues.js';
import { DEFAULT_LOCATIONS } from '../js/data/equipment.js';
import { defaultProfile } from '../js/store.js';

const NOW = new Date(2026, 9, 24, 8);
const LOC = Object.fromEntries(DEFAULT_LOCATIONS.map(l => [l.id, l]));
const prof = (patch = {}) => ({ ...defaultProfile(), bodyweight: 170, ...patch });
const issue = (area, side, severity = 'moderate', more = {}) => ({ id: `is_${area}_${side}_${severity}`, area, side, severity, started: '2026-10-20', note: '', resolvedAt: null, ...more });
const pg = ex => { let b = null, w = -1; for (const [r, x] of Object.entries(ex.muscles || {})) if (x > w) { w = x; b = r; } return REGIONS[b]?.group; };

const CASES = [
  ['left elbow, moderate', [issue('elbow', 'left')]],
  ['left elbow, mild', [issue('elbow', 'left', 'mild')]],
  ['both elbows, severe', [issue('elbow', 'both', 'severe')]],
  ['right shoulder, moderate', [issue('shoulder', 'right')]],
  ['left knee, moderate', [issue('knee', 'left')]],
  ['lower back, moderate', [issue('lower_back', 'both')]],
  ['biceps (left), moderate', [issue('muscle', 'left', 'moderate', { group: 'biceps' })]],
  ['triceps (both), severe', [issue('muscle', 'both', 'severe', { group: 'triceps' })]],
];

test('cards: a card whose every muscle is ruled out is dropped; a limited one is down-ranked; reasons say what changes', () => {
  // triceps out entirely (both elbows, severe): no card is triceps-only, and arms cards say triceps is out
  const p = prof({ issues: [issue('muscle', 'both', 'severe', { group: 'triceps' })] });
  const recs = recommend([], { now: NOW, profile: p, minutes: 45, location: LOC.crunch, week: weekUnitView([], { profile: p, now: NOW }) });
  assert.ok(recs.length >= 3);
  assert.ok(!recs.some(r => r.groups.length === 1 && r.groups[0] === 'triceps'), 'triceps alone is never suggested');
  for (const r of recs.filter(x => x.groups.includes('triceps'))) {
    assert.ok(r.reasons[0].startsWith('Triceps (severe): no triceps move here spares it'), r.reasons.join(' | '));
    assert.ok(r.issueNotes.some(n => n.group === 'triceps' && n.status === 'out'));
  }
  // the same profile without the issue ranks a triceps card higher than with it
  const base = recommend([], { now: NOW, profile: prof(), minutes: 45, location: LOC.crunch });
  const rank = (list, pred) => { const i = list.findIndex(pred); return i < 0 ? 99 : i; };
  assert.ok(rank(recs, r => r.groups.includes('triceps')) >= rank(base, r => r.groups.includes('triceps')), 'down-ranked or dropped');
  // a one-sided elbow: the arm cards lead with the one-side line
  const pe = prof({ issues: [issue('elbow', 'left')] });
  const re = recommend([], { now: NOW, profile: pe, minutes: 45, location: LOC.crunch });
  const armCard = re.find(r => r.groups.includes('triceps'));
  if (armCard) assert.ok(armCard.reasons.includes('Left elbow (moderate): triceps work is right-arm only'), armCard.reasons.join(' | '));
  // no issue: nothing changes, no notes
  assert.ok(base.every(r => !r.issueNotes));
});

test('cards agree with Build: every claim a card makes about an issue holds in the workout built from it', () => {
  let checked = 0;
  for (const [name, issues] of CASES) for (const loc of [LOC.crunch, LOC.home]) for (const minutes of [30, 45, 60]) {
    const p = prof({ issues });
    const f = issueFilter(issues);
    const recs = recommend([], { now: NOW, profile: p, minutes, location: loc, week: weekUnitView([], { profile: p, now: NOW }) });
    for (const r of recs) {
      const s = buildWorkout({ targets: r.targets, minutes, location: loc, profile: p, sessions: [], now: NOW, seed: 7, exclude: p.avoidExercises });
      const lifts = s.blocks.filter(b => b.kind === 'lift');
      const tag = `${name} ${loc.id} ${minutes} ${r.label}`;
      // nothing an issue rules out, and every one-limb move carries its healthy side
      for (const b of lifts) {
        assert.ok(!f.blocked.has(b.exId), `${tag}: ${b.exId} is ruled out`);
        if (f.side.has(b.exId)) assert.equal(b.sideOnly, f.side.get(b.exId), `${tag}: ${b.exId} side`);
      }
      for (const n of r.issueNotes || []) {
        checked++;
        const mine = lifts.filter(b => pg(getEx(b.exId)) === n.group);
        // the card's line is the same sentence the workout uses
        assert.equal(n.line, availabilityLine(groupAvailability(n.group, { equipment: loc.equipment, issues, exclude: p.avoidExercises })), tag);
        if (n.status === 'out') {
          assert.equal(mine.length, 0, `${tag}: card says ${n.group} is out, the workout has ${mine.map(b => b.exId)}`);
          assert.ok(s.rationale.some(x => x.includes(`every ${n.group} exercise here loads your`)), `${tag}: the workout says ${n.group} is left out (${s.rationale.join(' | ')})`);
        }
        if (n.status === 'side') {
          for (const b of mine) assert.equal(b.sideOnly, n.side, `${tag}: card says ${n.group} is ${n.side}-${n.limb} only, ${b.exId} is ${b.sideOnly || 'both'}`);
          assert.ok(s.rationale.includes(n.line), `${tag}: the workout repeats "${n.line}" (${s.rationale.join(' | ')})`);
        }
      }
    }
  }
  assert.ok(checked > 20, `the cases exercise the claims (${checked})`);
});
