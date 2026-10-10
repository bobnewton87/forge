// STUB — ENGINE-A replaces this file.
import { REGIONS, GROUPS, PRESETS } from '../data/muscles.js';
import { getEx } from '../data/exercises.js';
import { ds, daysBetween, addDays } from '../util.js';
export function volumeByRegion(sessions, { from, to } = {}) {
  const out = {};
  for (const s of sessions) { if ((from && s.date < from) || (to && s.date > to)) continue;
    for (const b of s.blocks || []) { if (b.kind === 'lift') { const ex = getEx(b.exId); if (!ex) continue; const n = b.sets.filter(x => x.done && x.r > 0).length; for (const [r, w] of Object.entries(ex.muscles)) out[r] = (out[r] || 0) + n * w; }
      if (b.kind === 'class' && b.done && b.classify) for (const [r, w] of Object.entries(b.classify.muscles || {})) out[r] = (out[r] || 0) + w; } }
  return out;
}
export function muscleStatus(sessions, { now = new Date() } = {}) {
  const v = volumeByRegion(sessions, { from: ds(addDays(now, -6)), to: ds(now) });
  return Object.fromEntries(Object.values(REGIONS).map(r => [r.id, { region: r.id, group: r.group, lastTrained: null, daysSince: null, sets7d: v[r.id] || 0, target: r.weeklySets, readiness: 1, need: Math.max(0, 1 - (v[r.id] || 0) / r.weeklySets.min) }]));
}
export function groupStatus(sessions, opts = {}) {
  const m = muscleStatus(sessions, opts);
  return Object.fromEntries(Object.values(GROUPS).map(g => { const rs = g.regions.map(r => m[r]); const sets = rs.reduce((s, x) => s + x.sets7d, 0); return [g.id, { group: g.id, lastTrained: null, daysSince: null, sets7d: sets, target: g.weeklySets, readiness: 1, need: Math.max(0, 1 - sets / g.weeklySets.min), regions: Object.fromEntries(rs.map(x => [x.region, x])) }]; }));
}
export function recommend(sessions, opts = {}) {
  const g = groupStatus(sessions, opts);
  return Object.entries(PRESETS).slice(0, 4).map(([id, p], i) => ({ targetId: id, label: p.name, score: 4 - i, reasons: ['Stub recommendation'], groups: p.groups }));
}
export function cardioStatus(sessions, { now = new Date(), profile } = {}) { return { minutes7d: 0, target: profile?.cardioTargetMin || 120, daysSince: null, sessions7d: 0, suggestion: 'Stub cardio suggestion' }; }
export function weekSummary(sessions) { return { sessions: 0, liftSets: 0, cardioMinutes: 0, byGroup: {} }; }
export function streak() { return { days: 0, weeksActive: 0 }; }
