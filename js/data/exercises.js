// Merges the exercise library. Owned by lead — builders edit exercises-upper.js / exercises-lower.js.
import upper from './exercises-upper.js';
import lower from './exercises-lower.js';

export const EXERCISES = [...upper, ...lower];
export const EX_BY_ID = Object.fromEntries(EXERCISES.map(e => [e.id, e]));
export function getEx(id) { return EX_BY_ID[id] || null; }
