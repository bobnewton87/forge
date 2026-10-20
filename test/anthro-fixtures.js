// Shared fixtures for ANTHRO tests (not a test file itself).
export const BOB = { heightIn: 69, neck: 15, shoulders: 46, chest: 39, waist: 34.5, hips: 38, arm: 13.5, forearm: 11.5, thigh: 22, calf: 14.5, bodyFatPct: 19 };
// "42/40/30/36" read literally as shoulders/chest/waist/hips (shoulders < 1.06 × chest is implausible → warning + clamp).
export const LEAN_LITERAL = { heightIn: 70, shoulders: 42, chest: 40, waist: 30, hips: 36, arm: 15, thigh: 23, bodyFatPct: 9 };
// Same athlete read as chest/waist/hips 42/30/36 with the shoulders tape missing (estimated).
export const LEAN = { heightIn: 70, chest: 42, waist: 30, hips: 36, arm: 15, thigh: 23, bodyFatPct: 9 };
export const HEAVY = { heightIn: 69, chest: 44, waist: 40, bodyFatPct: 28 };
export const TALL = { heightIn: 75 };
export const ALL = { BOB, LEAN_LITERAL, LEAN, HEAVY, TALL };
// tape site → landmark name
export const SITE_LM = { neck: 'neck', shoulders: 'shoulder', chest: 'chest', waist: 'waist', hips: 'hip', arm: 'arm', forearm: 'forearm', thigh: 'thigh', calf: 'calf' };
