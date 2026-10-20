// Test personas (CONTRACT §19): sample people for checking the app as someone other than Bob.
// Pure data. personaSeed() returns the seed store.accounts.create() writes into a new TEST account
// (profile patch + a short weigh-in and tape history dated relative to `today`). The account is named
// `name` (e.g. "Test · Woman, 28, beginner"); the profile gets a plain first name for greetings.
import { addDays, ds, parseDs } from '../util.js';

export const PERSONAS = {
  woman28: {
    id: 'woman28', label: 'Woman, 28, beginner', name: 'Test · Woman, 28, beginner', firstName: 'Emma',
    note: '5′4″, 140 lb, 2 months lifting, trains at the gym',
    profile: {
      goal: 'recomp',
      sculptGoals: ['glutes', 'shoulder_width', 'six_pack', 'hamstrings'],
      currentLocation: 'crunch', defaultMinutes: 45, cardioTargetMin: 90,
      body: { sex: 'female', heightIn: 64, birthYear: 1998, trainingMonths: 2, activity: 'light' },
      schedule: {
        mon: { kind: 'lift', minutes: 45, location: 'crunch' },
        tue: { kind: 'cardio', minutes: 30, location: 'crunch' },
        wed: { kind: 'lift', minutes: 45, location: 'crunch' },
        thu: { kind: 'rest', minutes: 0, location: 'home' },
        fri: { kind: 'lift', minutes: 45, location: 'crunch' },
        sat: { kind: 'flex', minutes: 45, location: 'crunch' },
        sun: { kind: 'rest', minutes: 0, location: 'home' },
      },
    },
    weights: [[-14, 140.6], [-7, 140.2], [0, 140]],
    meas: { neck: 12.5, shoulders: 40, chest: 34, waist: 28.5, hips: 39, armL: 10.5, armR: 10.75, thighL: 22, thighR: 22, calfL: 14, calfR: 14 },
  },
  man52: {
    id: 'man52', label: 'Man, 52, returning lifter', name: 'Test · Man, 52, returning lifter', firstName: 'Mark',
    note: '5′10″, 212 lb, lifted in his 30s, cutting',
    profile: {
      goal: 'cut',
      sculptGoals: ['upper_chest', 'shoulder_width', 'lat_width', 'six_pack'],
      currentLocation: 'crunch', defaultMinutes: 60, cardioTargetMin: 150,
      body: { sex: 'male', heightIn: 70, birthYear: 1974, trainingMonths: 24, activity: 'desk' },
      metabolic: { totalT: 410, freeT: null, labDate: null, onTrtT: null, vitD: 28, hba1c: 5.7, tsh: null, sleepHours: 6.5, stress: 3 },
      schedule: {
        mon: { kind: 'lift', minutes: 60, location: 'crunch' },
        tue: { kind: 'cardio', minutes: 40, location: 'home' },
        wed: { kind: 'lift', minutes: 60, location: 'crunch' },
        thu: { kind: 'cardio', minutes: 40, location: 'home' },
        fri: { kind: 'lift', minutes: 60, location: 'crunch' },
        sat: { kind: 'flex', minutes: 60, location: 'crunch' },
        sun: { kind: 'rest', minutes: 0, location: 'home' },
      },
    },
    weights: [[-21, 214.8], [-14, 213.6], [-7, 212.9], [0, 212]],
    meas: { neck: 16.5, shoulders: 50, chest: 44, waist: 40, hips: 42, armL: 14, armR: 14.25, forearm: 12, thighL: 24, thighR: 24.25, calfL: 15.5, calfR: 15.5 },
  },
};

export function personaSeed(id, today) {
  const p = PERSONAS[id];
  if (!p) throw new Error('Unknown persona ' + id);
  const body = p.weights.map(([off, w]) => ({ d: ds(addDays(parseDs(today), off)), w }));
  return {
    profile: { ...JSON.parse(JSON.stringify(p.profile)), name: p.firstName, bodyweight: body[body.length - 1].w },
    body,
    meas: [{ d: today, ...p.meas }],
  };
}
