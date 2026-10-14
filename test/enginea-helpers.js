// Fixture helpers for ENGINE-A tests (not a test file itself).
export const lift = (exId, sets) => ({ kind: 'lift', exId, group: null, target: { sets: sets.length, repMin: 8, repMax: 12, rest: 60, weight: null, reps: null, note: null }, sets: sets.map(([w, r, done = true]) => ({ w, r, done })) });
export const cardio = (minutes, done = true) => ({ kind: 'cardio', modality: 'bike', minutes, intensity: 'easy', distance: null, calories: null, done, note: null });
export const klass = (muscles, cardioMinutes, done = true) => ({ kind: 'class', provider: 'crunch', name: 'Test Class', time: null, duration: 45, instructor: null, classify: { type: 'hiit', cardioMinutes, intensity: 'hard', muscles, label: 'HIIT', blurb: '' }, done });
let n = 0;
export const sess = (date, blocks, extra = {}) => ({ id: 's_' + (++n), date, status: 'done', startedAt: null, endedAt: null, location: 'home', minutes: 45, title: '', targets: [], source: 'manual', blocks, rationale: [], notes: '', ...extra });
export const at = (date, h = 12) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d, h); };
