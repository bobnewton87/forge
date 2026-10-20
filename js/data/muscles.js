// Muscle taxonomy for Forge (CONTRACT §1). Pure data + helpers, DOM-free.
//
// CONTRACT-NOTE (INTEGRATOR, weekly-volume audit 2026-10-19, docs/research/weekly-volume-audit.md):
//   ENFORCEMENT UNITS are VOLUME_UNITS (the audit's rows): chest (+ upper-chest sub-floor), back = lats +
//   upper back only (traps and lower back are tracked, not counted), side delts and rear delts as
//   separate units (front delts tracked), triceps, biceps, forearms, core, quads, hamstrings, glutes,
//   calves. Each has min (evidence floor: ~10 priority / 6 normal / 3-4 maintenance, 0 where incidental
//   work covers it), target (above the floor) and max (~20; 24 for triceps and side delts). A set
//   credits a unit once: the max weight over the unit's regions (fractional credit, Pelland 2025).
//   Priority is ONE mechanism: groupPriority sliders and sculpt extras move the TARGET (clamped to
//   [min, max]); the min stays the floor. REGIONS[r].priority is kept for scoring/need only.
//   GROUPS[g].volume ({min, target, max}) is DERIVED from the units for display (sum of the group's
//   units); GROUPS[g].weeklySets keeps the legacy summed-region numbers only as the projection's
//   training-distribution shape. REGIONS[r].weeklySets ({min, target, max}) are per-head display and
//   exercise-selection shares (all > 0), not enforced.
//
// Evidence base: dose-response meta-analyses (Schoenfeld et al. 2017; Pelland et al. 2024 preprint)
// suggest hypertrophy keeps rising up to roughly 10-20 weekly sets per muscle, with diminishing
// returns beyond that. Small muscles (delts, arms, calves, abs) recover in ~48h. Large or heavily
// loaded muscles (pecs, lats, quads, hamstrings, glutes, spinal erectors) need ~72h after hard work.

const R = (id, name, group, description, recoveryHours, min, max, priority, target) =>
  ({ id, name, group, description, recoveryHours, weeklySets: { min, target: target ?? min, max }, priority });

export const REGIONS = {
  // ---- chest (12-21) ----
  chest_upper: R('chest_upper', 'Upper Chest', 'chest',
    'Clavicular head of the pec. Fills the area under the collarbones and makes the chest look full in a shirt. Biased by incline pressing and low-to-high flyes.',
    72, 4, 12, 1.5, 6),
  chest_mid: R('chest_mid', 'Mid Chest', 'chest',
    'Sternal pec fibers that run straight across. Most of your chest mass. Trained by flat pressing, dips, push-ups and flyes.',
    72, 3, 7, 1, 4),
  chest_lower: R('chest_lower', 'Lower Chest', 'chest',
    'Lower sternal and abdominal pec fibers that form the bottom edge of the chest. Biased by decline press, dips and high-to-low cable flyes.',
    72, 1, 4, 1, 2),

  // ---- back (16-30) ----
  lats: R('lats', 'Lats', 'back',
    'Latissimus dorsi, the big wings under the armpits that create back width and the V-taper. Trained by pulling the elbows down and back (pulldowns, pull-ups, pullovers, rows with elbows tucked).',
    72, 6, 14, 1.5, 9),
  upper_back: R('upper_back', 'Upper Back', 'back',
    'Rhomboids, mid/lower traps and teres major. They give back thickness and good posture. Trained by rows with elbows flared and by face pulls.',
    72, 4, 8, 1, 6),
  traps: R('traps', 'Upper Traps', 'back',
    'Upper trapezius, the slope from neck to shoulder (the "yoke"). Trained by shrugs, carries, heavy deadlifts and upright rows.',
    48, 2, 6, 1, 2),
  lower_back: R('lower_back', 'Lower Back', 'back',
    'Spinal erectors along the lower spine. They stabilise every hinge and carry. They get plenty of indirect work from trap bar deadlifts and RDLs.',
    72, 2, 6, 0.5, 2),

  // ---- shoulders (20-36) ----
  delt_front: R('delt_front', 'Front Delts', 'shoulders',
    'Anterior deltoid at the front of the shoulder. Every press works it hard, so it rarely needs much direct work.',
    48, 2, 12, 1, 2),
  delt_side: R('delt_side', 'Side Delts', 'shoulders',
    'Lateral deltoid, the outer cap that makes shoulders look wide and round. This is the single biggest lever for upper-body width. Trained by lateral raises in every variation.',
    48, 10, 24, 1.5, 14),
  delt_rear: R('delt_rear', 'Rear Delts', 'shoulders',
    'Posterior deltoid at the back of the shoulder. It completes the 3D look from the side and back and keeps shoulders healthy against all the pressing. Trained by reverse flyes, face pulls and wide rows.',
    48, 4, 12, 1, 7),

  // ---- biceps (10-20) ----
  biceps_long: R('biceps_long', 'Biceps Long Head', 'biceps',
    'Outer head of the biceps. It contributes most to the visible "peak" from the side. Biased by curls with the arm behind the body (incline curls, Bayesian cable curls) and by narrow grips.',
    48, 2, 7, 1, 4),
  biceps_short: R('biceps_short', 'Biceps Short Head', 'biceps',
    'Inner head of the biceps. It adds width and thickness from the front. Biased by curls with the arm in front of the body (preacher, spider, concentration) and by wide grips.',
    48, 2, 5, 1, 3),
  brachialis: R('brachialis', 'Brachialis', 'biceps',
    'Lies under the biceps. When it grows it pushes the biceps up and makes the arm look thicker from the side. Biased by neutral and overhand grips (hammer and reverse curls). Brachioradialis is credited here and in forearms.',
    48, 2, 5, 1, 3),

  // ---- triceps (13-22) priority ----
  triceps_long: R('triceps_long', 'Triceps Long Head', 'triceps',
    'Largest triceps head, on the inner back of the arm. It is the main driver of overall arm size. It crosses the shoulder, so it grows best with overhead extensions that stretch it.',
    48, 4, 10, 1.5, 6),
  triceps_lateral: R('triceps_lateral', 'Triceps Lateral Head', 'triceps',
    'Outer head that forms the visible "horseshoe" when lean. Biased by pushdowns, close-grip pressing and dips with the arms at your sides.',
    48, 3, 8, 1.5, 5),
  triceps_medial: R('triceps_medial', 'Triceps Medial Head', 'triceps',
    'Deep head near the elbow. It works in every extension and is rarely the limiting factor. Reverse-grip pushdowns and lockouts emphasise it a little.',
    48, 3, 6, 1.5, 4),

  // ---- forearms (4-8) ----
  forearms: R('forearms', 'Forearms', 'forearms',
    'Wrist flexors, extensors and brachioradialis. They support grip and make the lower arm look thick when sleeves are rolled up. They get indirect work from pulling, carries and hammer curls.',
    48, 2, 8, 1, 4),

  // ---- core (9-18) ----
  abs: R('abs', 'Abs', 'core',
    'Rectus abdominis, the "six-pack" muscle. Trained by loaded spinal flexion (cable crunches, hanging leg raises, ab wheel). It only shows when body fat is low.',
    48, 6, 12, 1.5, 8),
  obliques: R('obliques', 'Obliques', 'core',
    'Internal and external obliques on the sides of the waist. They rotate and side-bend the trunk and frame the abs. Trained by side bends, woodchops, Pallof presses and side planks.',
    48, 2, 4, 1, 3),

  // ---- glutes (6-12) maintenance ----
  glutes: R('glutes', 'Glutes', 'glutes',
    'Gluteus maximus, the main hip extensor. Already strong from years of running. Maintenance volume comes from trap bar deadlifts, split squats and hip thrusts.',
    72, 2, 8, 0.5, 3),
  glute_med: R('glute_med', 'Glute Medius', 'glutes',
    'Side glute. It stabilises the pelvis on one leg, which matters for running injury prevention. Trained by abductions, lateral band walks and single-leg work.',
    48, 1, 2, 0.5, 1),

  // ---- quads (8-14) maintenance ----
  quads: R('quads', 'Quads', 'quads',
    'Front of the thigh (four heads). Already strong from running. Maintained with leg press, hack squat, split squats and lunges. Never barbell back squats.',
    72, 4, 8, 0.5, 5),
  adductors: R('adductors', 'Adductors', 'quads',
    'Inner thigh. They help in squats and lunges and stabilise the hips. They get indirect work from split squats and wide-stance leg press.',
    72, 1, 2, 0.5, 1),

  // ---- hamstrings (4-8) maintenance ----
  hamstrings: R('hamstrings', 'Hamstrings', 'hamstrings',
    'Back of the thigh. They extend the hip (RDLs) and bend the knee (leg curls). Keeping them strong eccentrically protects against strains if running returns.',
    72, 3, 8, 0.5, 4),

  // ---- calves (3-6) maintenance ----
  calves: R('calves', 'Calves', 'calves',
    'Gastrocnemius (straight-knee) and soleus (bent-knee). A marathon background means they are already very well conditioned, so they need only light maintenance.',
    48, 1, 6, 0.5, 3),
};

const GROUP_DEFS = [
  ['chest', 'Chest', '🫁', ['chest_upper', 'chest_mid', 'chest_lower']],
  ['back', 'Back', '🦅', ['lats', 'upper_back', 'traps', 'lower_back']],
  ['shoulders', 'Shoulders', '🥥', ['delt_front', 'delt_side', 'delt_rear']],
  ['biceps', 'Biceps', '💪', ['biceps_long', 'biceps_short', 'brachialis']],
  ['triceps', 'Triceps', '🔱', ['triceps_long', 'triceps_lateral', 'triceps_medial']],
  ['forearms', 'Forearms', '✊', ['forearms']],
  ['core', 'Core', '🧱', ['abs', 'obliques']],
  ['glutes', 'Glutes', '🍑', ['glutes', 'glute_med']],
  ['quads', 'Quads', '🦵', ['quads', 'adductors']],
  ['hamstrings', 'Hamstrings', '🦿', ['hamstrings']],
  ['calves', 'Calves', '🦶', ['calves']],
];

// Enforcement units (the audit's table). big = heavy compound muscles (stricter spacing, 10/session cap).
const U = (id, name, group, regions, min, target, max, tier, extra = {}) => ({ id, name, group, regions, min, target, max, tier, big: false, sub: false, ...extra });
export const VOLUME_UNITS = {
  chest: U('chest', 'Chest', 'chest', ['chest_upper', 'chest_mid', 'chest_lower'], 8, 12, 20, 'priority', { big: true }),
  chest_upper: U('chest_upper', 'Upper chest (incline)', 'chest', ['chest_upper'], 4, 6, 12, 'priority', { big: true, sub: true }),
  back: U('back', 'Back (lats + upper back)', 'back', ['lats', 'upper_back'], 10, 15, 22, 'priority', { big: true }),
  delt_side: U('delt_side', 'Side delts', 'shoulders', ['delt_side'], 10, 14, 24, 'priority'),
  delt_rear: U('delt_rear', 'Rear delts', 'shoulders', ['delt_rear'], 4, 7, 12, 'normal'),
  triceps: U('triceps', 'Triceps', 'triceps', ['triceps_long', 'triceps_lateral', 'triceps_medial'], 10, 15, 24, 'priority'),
  biceps: U('biceps', 'Biceps', 'biceps', ['biceps_long', 'biceps_short', 'brachialis'], 6, 10, 16, 'normal'),
  core: U('core', 'Abs & core', 'core', ['abs', 'obliques'], 8, 11, 16, 'priority'),
  quads: U('quads', 'Quads', 'quads', ['quads', 'adductors'], 4, 6, 10, 'maintenance', { big: true }),
  hamstrings: U('hamstrings', 'Hamstrings', 'hamstrings', ['hamstrings'], 3, 4, 8, 'maintenance', { big: true }),
  glutes: U('glutes', 'Glutes', 'glutes', ['glutes', 'glute_med'], 0, 4, 10, 'maintenance', { big: true }),
  calves: U('calves', 'Calves', 'calves', ['calves'], 0, 3, 6, 'maintenance'),
  forearms: U('forearms', 'Forearms', 'forearms', ['forearms'], 0, 4, 8, 'none'),
  delt_front: U('delt_front', 'Front delts', 'shoulders', ['delt_front'], 0, 0, 12, 'tracked'),
  traps: U('traps', 'Upper traps', 'back', ['traps'], 0, 0, 12, 'tracked'),
  lower_back: U('lower_back', 'Lower back', 'back', ['lower_back'], 0, 0, 10, 'tracked'),
};
export const UNIT_ORDER = ['chest', 'chest_upper', 'back', 'delt_side', 'delt_rear', 'triceps', 'biceps', 'core', 'quads', 'hamstrings', 'glutes', 'calves', 'forearms', 'delt_front', 'traps', 'lower_back'];
// Credit of one set of an exercise for a unit: the max weight over the unit's regions.
export function unitWeight(ex, unitId) {
  const u = VOLUME_UNITS[unitId]; if (!u || !ex) return 0;
  let w = 0; for (const r of u.regions) { const x = ex.muscles?.[r] || 0; if (x > w) w = x; }
  return w;
}
export function unitCredits(ex) {
  const out = {};
  for (const id of UNIT_ORDER) { const w = unitWeight(ex, id); if (w > 0) out[id] = w; }
  return out;
}
const LEGACY_GROUP_SETS = { chest: { min: 12, max: 21 }, back: { min: 16, max: 30 }, shoulders: { min: 20, max: 36 }, biceps: { min: 10, max: 20 },
  triceps: { min: 13, max: 22 }, forearms: { min: 4, max: 8 }, core: { min: 9, max: 18 }, glutes: { min: 6, max: 12 }, quads: { min: 8, max: 14 },
  hamstrings: { min: 4, max: 8 }, calves: { min: 3, max: 6 } };
const groupUnits = g => Object.values(VOLUME_UNITS).filter(u => u.group === g && !u.sub);

export const GROUPS = Object.fromEntries(GROUP_DEFS.map(([id, name, emoji, regions]) => {
  const rs = regions.map(r => REGIONS[r]);
  const us = groupUnits(id);
  return [id, {
    id, name, emoji, regions,
    // LEGACY summed-region numbers, kept only as the projection's training-distribution shape
    // (js/engine/projection.js TYPICAL_SHARE). Not a minimum; nothing enforces them.
    weeklySets: { ...LEGACY_GROUP_SETS[id] },
    // Display volume = the sum of the group's units (enforcement is per unit, see VOLUME_UNITS).
    volume: {
      min: us.reduce((a, u) => a + u.min, 0),
      target: us.reduce((a, u) => a + u.target, 0),
      max: us.reduce((a, u) => a + u.max, 0),
    },
    recoveryHours: Math.max(...rs.map(r => r.recoveryHours)),
    priority: Math.max(...rs.map(r => r.priority)),
  }];
}));

export const GROUP_ORDER = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];

export const PRESETS = {
  push: { name: 'Push', groups: ['chest', 'shoulders', 'triceps'] },
  pull: { name: 'Pull', groups: ['back', 'biceps', 'forearms'] },
  legs: { name: 'Legs', groups: ['quads', 'hamstrings', 'glutes', 'calves'] },
  upper: { name: 'Upper', groups: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
  lower: { name: 'Lower', groups: ['quads', 'hamstrings', 'glutes', 'calves', 'core'] },
  arms: { name: 'Arms', groups: ['biceps', 'triceps', 'forearms'] },
  full: { name: 'Full Body', groups: ['chest', 'back', 'shoulders', 'triceps', 'biceps', 'quads', 'hamstrings', 'core'] },
  v_taper: { name: 'V-Taper', groups: ['back', 'shoulders', 'core'] },
  core: { name: 'Core', groups: ['core'] },
  shoulders_arms: { name: 'Shoulders & Arms', groups: ['shoulders', 'triceps', 'biceps'] },
  chest_back: { name: 'Chest & Back', groups: ['chest', 'back'] },
};

// targetId may be a region, group or preset id → [regionId] (deduped, stable order).
export function regionsFor(targetId) {
  if (REGIONS[targetId]) return [targetId];
  if (GROUPS[targetId]) return [...GROUPS[targetId].regions];
  if (PRESETS[targetId]) return [...new Set(PRESETS[targetId].groups.flatMap(g => GROUPS[g].regions))];
  return [];
}
