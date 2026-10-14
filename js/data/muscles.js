// Muscle taxonomy for Forge (CONTRACT §1). Pure data + helpers, DOM-free.
//
// CONTRACT-NOTE: REGIONS[r].weeklySets are DIRECT (fractional-credit) set targets per region.
// GROUPS[g].weeklySets is the SUM of its regions' min/max, so group and region views stay
// consistent when an engine sums region credits into a group total. Remember that a single set
// usually credits several regions (e.g. a row = upper_back 1 + lats 0.5 + biceps 0.25), so
// group sums run higher than "hard sets of exercises for that group".
// CONTRACT-NOTE: REGIONS[r].priority already encodes Bob's priorities (1.5 priority, 0.5 legs).
// store.defaultProfile() also has groupPriority multipliers; engines should not apply both
// at full strength or the legs/priority gap will be doubled.
//
// Evidence base: dose-response meta-analyses (Schoenfeld et al. 2017; Pelland et al. 2024 preprint)
// suggest hypertrophy keeps rising up to roughly 10-20 weekly sets per muscle, with diminishing
// returns beyond that. Small muscles (delts, arms, calves, abs) recover in ~48h. Large or heavily
// loaded muscles (pecs, lats, quads, hamstrings, glutes, spinal erectors) need ~72h after hard work.

const R = (id, name, group, description, recoveryHours, min, max, priority) =>
  ({ id, name, group, description, recoveryHours, weeklySets: { min, max }, priority });

export const REGIONS = {
  // ---- chest (12-21) ----
  chest_upper: R('chest_upper', 'Upper Chest', 'chest',
    'Clavicular head of the pec. Fills the area under the collarbones and makes the chest look full in a shirt. Biased by incline pressing and low-to-high flyes.',
    72, 6, 10, 1.5),
  chest_mid: R('chest_mid', 'Mid Chest', 'chest',
    'Sternal pec fibers that run straight across. Most of your chest mass. Trained by flat pressing, dips, push-ups and flyes.',
    72, 4, 7, 1),
  chest_lower: R('chest_lower', 'Lower Chest', 'chest',
    'Lower sternal and abdominal pec fibers that form the bottom edge of the chest. Biased by decline press, dips and high-to-low cable flyes.',
    72, 2, 4, 1),

  // ---- back (16-30) ----
  lats: R('lats', 'Lats', 'back',
    'Latissimus dorsi, the big wings under the armpits that create back width and the V-taper. Trained by pulling the elbows down and back (pulldowns, pull-ups, pullovers, rows with elbows tucked).',
    72, 8, 14, 1.5),
  upper_back: R('upper_back', 'Upper Back', 'back',
    'Rhomboids, mid/lower traps and teres major. They give back thickness and good posture. Trained by rows with elbows flared and by face pulls.',
    72, 4, 8, 1),
  traps: R('traps', 'Upper Traps', 'back',
    'Upper trapezius, the slope from neck to shoulder (the "yoke"). Trained by shrugs, carries, heavy deadlifts and upright rows.',
    48, 2, 4, 1),
  lower_back: R('lower_back', 'Lower Back', 'back',
    'Spinal erectors along the lower spine. They stabilise every hinge and carry. They get plenty of indirect work from trap bar deadlifts and RDLs.',
    72, 2, 4, 0.5),

  // ---- shoulders (20-36) ----
  delt_front: R('delt_front', 'Front Delts', 'shoulders',
    'Anterior deltoid at the front of the shoulder. Every press works it hard, so it rarely needs much direct work.',
    48, 2, 6, 1),
  delt_side: R('delt_side', 'Side Delts', 'shoulders',
    'Lateral deltoid, the outer cap that makes shoulders look wide and round. This is the single biggest lever for upper-body width. Trained by lateral raises in every variation.',
    48, 12, 20, 1.5),
  delt_rear: R('delt_rear', 'Rear Delts', 'shoulders',
    'Posterior deltoid at the back of the shoulder. It completes the 3D look from the side and back and keeps shoulders healthy against all the pressing. Trained by reverse flyes, face pulls and wide rows.',
    48, 6, 10, 1),

  // ---- biceps (10-20) ----
  biceps_long: R('biceps_long', 'Biceps Long Head', 'biceps',
    'Outer head of the biceps. It contributes most to the visible "peak" from the side. Biased by curls with the arm behind the body (incline curls, Bayesian cable curls) and by narrow grips.',
    48, 4, 8, 1),
  biceps_short: R('biceps_short', 'Biceps Short Head', 'biceps',
    'Inner head of the biceps. It adds width and thickness from the front. Biased by curls with the arm in front of the body (preacher, spider, concentration) and by wide grips.',
    48, 3, 6, 1),
  brachialis: R('brachialis', 'Brachialis', 'biceps',
    'Lies under the biceps. When it grows it pushes the biceps up and makes the arm look thicker from the side. Biased by neutral and overhand grips (hammer and reverse curls). Brachioradialis is credited here and in forearms.',
    48, 3, 6, 1),

  // ---- triceps (13-22) priority ----
  triceps_long: R('triceps_long', 'Triceps Long Head', 'triceps',
    'Largest triceps head, on the inner back of the arm. It is the main driver of overall arm size. It crosses the shoulder, so it grows best with overhead extensions that stretch it.',
    48, 6, 10, 1.5),
  triceps_lateral: R('triceps_lateral', 'Triceps Lateral Head', 'triceps',
    'Outer head that forms the visible "horseshoe" when lean. Biased by pushdowns, close-grip pressing and dips with the arms at your sides.',
    48, 4, 7, 1.5),
  triceps_medial: R('triceps_medial', 'Triceps Medial Head', 'triceps',
    'Deep head near the elbow. It works in every extension and is rarely the limiting factor. Reverse-grip pushdowns and lockouts emphasise it a little.',
    48, 3, 5, 1.5),

  // ---- forearms (4-8) ----
  forearms: R('forearms', 'Forearms', 'forearms',
    'Wrist flexors, extensors and brachioradialis. They support grip and make the lower arm look thick when sleeves are rolled up. They get indirect work from pulling, carries and hammer curls.',
    48, 4, 8, 1),

  // ---- core (9-18) ----
  abs: R('abs', 'Abs', 'core',
    'Rectus abdominis, the "six-pack" muscle. Trained by loaded spinal flexion (cable crunches, hanging leg raises, ab wheel). It only shows when body fat is low.',
    48, 6, 12, 1.5),
  obliques: R('obliques', 'Obliques', 'core',
    'Internal and external obliques on the sides of the waist. They rotate and side-bend the trunk and frame the abs. Trained by side bends, woodchops, Pallof presses and side planks.',
    48, 3, 6, 1),

  // ---- glutes (6-12) maintenance ----
  glutes: R('glutes', 'Glutes', 'glutes',
    'Gluteus maximus, the main hip extensor. Already strong from years of running. Maintenance volume comes from trap bar deadlifts, split squats and hip thrusts.',
    72, 4, 8, 0.5),
  glute_med: R('glute_med', 'Glute Medius', 'glutes',
    'Side glute. It stabilises the pelvis on one leg, which matters for running injury prevention. Trained by abductions, lateral band walks and single-leg work.',
    48, 2, 4, 0.5),

  // ---- quads (8-14) maintenance ----
  quads: R('quads', 'Quads', 'quads',
    'Front of the thigh (four heads). Already strong from running. Maintained with leg press, hack squat, split squats and lunges. Never barbell back squats.',
    72, 6, 10, 0.5),
  adductors: R('adductors', 'Adductors', 'quads',
    'Inner thigh. They help in squats and lunges and stabilise the hips. They get indirect work from split squats and wide-stance leg press.',
    72, 2, 4, 0.5),

  // ---- hamstrings (4-8) maintenance ----
  hamstrings: R('hamstrings', 'Hamstrings', 'hamstrings',
    'Back of the thigh. They extend the hip (RDLs) and bend the knee (leg curls). Keeping them strong eccentrically protects against strains if running returns.',
    72, 4, 8, 0.5),

  // ---- calves (3-6) maintenance ----
  calves: R('calves', 'Calves', 'calves',
    'Gastrocnemius (straight-knee) and soleus (bent-knee). A marathon background means they are already very well conditioned, so they need only light maintenance.',
    48, 3, 6, 0.5),
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

export const GROUPS = Object.fromEntries(GROUP_DEFS.map(([id, name, emoji, regions]) => {
  const rs = regions.map(r => REGIONS[r]);
  return [id, {
    id, name, emoji, regions,
    weeklySets: {
      min: rs.reduce((a, r) => a + r.weeklySets.min, 0),
      max: rs.reduce((a, r) => a + r.weeklySets.max, 0),
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
