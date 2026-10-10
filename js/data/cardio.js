// STUB — DATA owner replaces this file.
export const CARDIO = {
  run: { id: 'run', name: 'Run', icon: '🏃', equipment: ['outdoors'], metsEasy: 8, metsHard: 11, impact: 'high', legFatigue: 0.6, notes: '', intervalIdeas: [] },
  bike: { id: 'bike', name: 'Bike', icon: '🚴', equipment: ['bike'], metsEasy: 6, metsHard: 10, impact: 'low', legFatigue: 0.4, notes: '', intervalIdeas: [] },
  row: { id: 'row', name: 'Row', icon: '🚣', equipment: ['rower'], metsEasy: 7, metsHard: 10, impact: 'low', legFatigue: 0.3, notes: '', intervalIdeas: [] },
};
export const INTENSITIES = { easy: { name: 'Easy / Zone 2', rpe: '3-4' }, moderate: { name: 'Moderate', rpe: '5-6' }, hard: { name: 'Hard', rpe: '7-8' }, intervals: { name: 'Intervals', rpe: '8-9' } };
export function cardioOptions(set) { return Object.values(CARDIO).filter(c => c.equipment.every(e => set.has(e))); }
export function estimateCalories(id, minutes, intensity, lb = 165) { const c = CARDIO[id]; if (!c) return 0; const mets = intensity === 'easy' ? c.metsEasy : c.metsHard; return Math.round(mets * 3.5 * (lb / 2.2046) / 200 * minutes); }
