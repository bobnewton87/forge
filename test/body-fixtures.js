// Fixture helpers for ENGINE-BODY tests (not a test file itself).
import { ds, parseDs, addDays } from '../js/util.js';

const liftB = (exId, n, reps = 10, done = false) => ({ kind: 'lift', exId, group: null,
  target: { sets: n, repMin: 8, repMax: 12, rest: 90, weight: 30, reps, note: null },
  sets: Array.from({ length: n }, () => ({ w: 30, r: done ? reps : null, done })) });
const cardioB = (minutes, intensity = 'easy', done = false) => ({ kind: 'cardio', modality: 'bike', minutes, intensity, distance: null, calories: null, done, note: null });

const DAYS = [
  ['db_bench', 'db_incline', 'db_lateral', 'tri_pushdown', 'db_skull', 'hang_knee'],
  ['lat_pulldown', 'db_row', 'db_curl', 'db_hammer', 'face_pull', 'db_lateral'],
  ['leg_press', 'db_rdl', 'db_shoulder', 'db_lateral', 'db_tri_oh', 'hang_knee'],
  ['db_incline', 'cable_row', 'db_curl', 'tri_pushdown', 'db_lateral', 'plank'],
];
let n = 0;
// Bob-like week: 4 lift days (~17 sets, 45 min) + 2 × 60 min easy bike = 120 cardio min.
export function bobPlan(startDate, weeks = 12, { status = 'planned', liftDays = 4, cardioMin = 120 } = {}) {
  const out = [];
  const start = parseDs(startDate);
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < liftDays; i++) {
      const ex = DAYS[i % 4];
      out.push({ id: 's_t' + (++n), date: ds(addDays(start, 7 * w + [0, 1, 3, 4, 5][i])), status, minutes: 45, location: 'crunch',
        title: 'Lift', targets: [], source: 'generated', rationale: [], notes: '', plan: { auto: true, kind: 'lift' },
        blocks: ex.map((id, j) => liftB(id, j < 2 ? 3 : 3, 10, status === 'done')) });
    }
    if (cardioMin > 0) for (const off of [2, 6]) out.push({ id: 's_t' + (++n), date: ds(addDays(start, 7 * w + off)), status, minutes: cardioMin / 2,
      location: 'home', title: 'Bike', targets: [], source: 'cardio', rationale: [], notes: '', plan: { auto: true, kind: 'cardio' },
      blocks: [cardioB(cardioMin / 2, 'easy', status === 'done')] });
  }
  return out;
}

export const NOW = new Date(2026, 9, 19, 9);   // Mon Oct 19 2026
export const TODAY = '2026-10-19';

export function bobProfile(extra = {}) {
  return { name: 'Bob', goal: 'recomp', bodyweight: 164, nutrition: { mode: 'off' }, cardioTargetMin: 120,
    body: { sex: 'male', heightIn: 69, birthYear: 1987, trainingMonths: 7, activity: 'desk' }, ...extra };
}
export const bobBodyLog = () => ['2026-10-05', '2026-10-08', '2026-10-10', '2026-10-12', '2026-10-14', '2026-10-15', '2026-10-17', '2026-10-18']
  .map((d, i) => ({ d, w: 164 + (i % 2 ? 0.4 : -0.2) })).concat([{ d: '2026-10-19', w: 164 }]);
export const bobMeas = () => [{ d: '2026-10-18', neck: 15, shoulders: 47, chest: 39, waist: 33.5, hips: 37.5, armL: 13.25, armR: 13.5, forearm: 11, thigh: 22, calf: 14.5, bodyFat: 22 }];

// Walk any value and collect paths of non-finite numbers.
export function findBad(v, path = '$', out = []) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(path); }
  else if (Array.isArray(v)) v.forEach((x, i) => findBad(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) findBad(x, `${path}.${k}`, out);
  return out;
}
