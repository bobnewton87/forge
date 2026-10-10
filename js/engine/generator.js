// STUB — ENGINE-B replaces this file.
import { EXERCISES, getEx } from '../data/exercises.js';
import { regionsFor } from '../data/muscles.js';
import { expandEquipment, canDo } from '../data/equipment.js';
import { suggest } from './progression.js';
import { ds } from '../util.js';
export function exercisesFor(targetId, equipmentSet) { const rs = new Set(regionsFor(targetId)); return EXERCISES.filter(e => canDo(e, equipmentSet) && Object.keys(e.muscles).some(r => rs.has(r))); }
function liftBlock(ex, sessions, now) { const t = { sets: 3, repMin: ex.repRange[0], repMax: ex.repRange[1], rest: 60, weight: null, reps: null, note: null }; const s = suggest(ex.id, t, sessions, { now }); t.weight = s.weight; t.reps = s.reps; return { kind: 'lift', exId: ex.id, group: null, target: t, sets: Array.from({ length: 3 }, () => ({ w: null, r: null, done: false })) }; }
export function buildWorkout({ targets = [], minutes = 45, location, profile, sessions = [], now = new Date(), cardio = null } = {}) {
  const eq = expandEquipment(location?.equipment || ['bodyweight']);
  const tg = targets.length ? targets : ['upper'];
  const picks = [...new Set(tg.flatMap(t => exercisesFor(t, eq)))].slice(0, Math.max(2, Math.round(minutes / 9)));
  const blocks = picks.map(ex => liftBlock(ex, sessions, now));
  if (cardio) blocks.push({ kind: 'cardio', modality: cardio.modality, minutes: cardio.minutes, intensity: cardio.intensity, distance: null, calories: null, done: false, note: null });
  return { id: 's_' + Date.now(), date: ds(now), status: 'planned', startedAt: null, endedAt: null, location: location?.id || 'home', minutes, title: tg.join(' + '), targets: tg, source: 'generated', blocks, rationale: ['Stub generator'], notes: '', estMinutes: estimateMinutes(blocks) };
}
export function estimateMinutes(blocks) { return Math.round(blocks.reduce((m, b) => m + (b.kind === 'lift' ? b.target.sets * (b.target.rest + 35) / 60 + 1 : (b.minutes || b.duration || 0)), 5)); }
export function alternatives(exId, { equipment, exclude = [], limit = 8 } = {}) { const ex = getEx(exId); if (!ex) return []; const eq = expandEquipment(equipment || []); const main = Object.entries(ex.muscles).sort((a, b) => b[1] - a[1])[0][0]; return EXERCISES.filter(e => e.id !== exId && !exclude.includes(e.id) && canDo(e, eq) && (e.muscles[main] || 0) >= 0.5).slice(0, limit); }
export function swapBlock(session, i, newExId, { sessions = [], now = new Date() } = {}) { const s = structuredClone(session); s.blocks[i] = liftBlock(getEx(newExId), sessions, now); return s; }
export function addExercise(session, exId, { sessions = [], now = new Date() } = {}) { const s = structuredClone(session); s.blocks.push(liftBlock(getEx(exId), sessions, now)); return s; }
