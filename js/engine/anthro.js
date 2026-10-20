// Anthropometric body geometry (ANTHRO, CONTRACT §16b). Pure, DOM-free, Node-testable.
// The single source of truth for body proportions used by both 3D renderers.
//
// Coordinate frame (inches): y = height above the floor; x+ = the subject's LEFT; z+ = anterior (the
// direction the subject faces). Right-handed, so a camera at +z looking at −z sees the subject's left on
// screen-right. z = 0 is the coronal plane through the shoulder (glenohumeral) and hip joint centres
// (normal standing posture puts them roughly on one plumb line).
//
// Every tape girth is reproduced by a superellipse |x/rx|^n + |z/rz|^n = 1 at its landmark, so
// perimeter(rx, rz, n) === tape (±1 %, in practice ±0.01 %). Limb landmarks describe the LEFT side
// (cx > 0); the right side is the mirror (per-side girths live in geom.sides / geom.profiles).
//
// Sources (fractions are of stature H unless stated):
//   [DC]  Drillis R, Contini R (1966) Body segment parameters, NYU Tech Rep 1166-03; as reproduced in
//         Winter DA (2009) Biomechanics and Motor Control of Human Movement, Fig. 4.1.
//   [DL]  de Leva P (1996) Adjustments to Zatsiorsky-Seluyanov's segment inertia parameters,
//         J Biomech 29:1223 (joint-centre to joint-centre segment lengths, males, stature 1741 mm).
//   [AN]  ANSUR II (Gordon et al. 2014, US Army anthropometric survey) male medians, stature ≈ 1756 mm.
//         Values marked ≈ are rounded medians/ratios derived from that survey (and the 1988 ANSUR,
//         Gordon et al. 1989, which agrees within a few %).
//   [NA]  NASA-STD-3000 Vol. I §3 (Man-Systems Integration Standards), anthropometry tables (US male
//         50th pct), used for breadth:depth sanity ranges.
//   [NY]  Nyffeler et al. (2006) JBJS 88-B:800 (acromion index: lateral acromion ≈ 0.6 cm lateral of
//         the glenohumeral centre's projection) — used for the acromion vs shoulder-joint offset.
//   [AN2F] ANSUR II public FEMALE file (n = 1,986): every female table (CONTRACT §21), see "female proportions".
//
// CONTRACT-NOTE (§21, female): sex = 'female' selects the female table set (HEIGHTS_FEMALE, SEGMENT_RATIOS_FEMALE,
//   BONE_RATIOS_FEMALE, female head / pelvis / ranges / buddy ratios / length norms / landmark offsets) and the
//   female tape sites: `chest` = BUST (fullest, over the bust point), `waist` = NATURAL waist (WHO midpoint, ≈ 1.8 in
//   above the navel; heights.navel is reported separately), `hips` = widest, `thigh` = just below the gluteal fold.
//   Extras: landmarks.underbust is the ribcage at the inframammary fold (model value, or an optional `underbust` tape;
//   derived.underbustSource / underbustY), proportions(sex) returns the tables, boneFromTape / tapeFromBone take an
//   optional sex. With sex omitted or 'male' every output is identical to the pre-female module.
//
// CONTRACT-NOTE (extras beyond §16b, all additive):
//   bodyGeometry() also accepts { weightLb, limbs:{armL,armR,thighL,thighR,calfL,calfR}, shape } (shape is
//     merged under the top-level args so `bodyGeometry({ ...seriesPoint.shape, ... })` and
//     `bodyGeometry({ shape: seriesPoint.shape, ... })` both work).
//   Output extras: heights{} (every landmark height, incl. acromion/nipple/navel/trochanter/…),
//     bones{} (joint-centre lengths, use these for rigging), head{ center, rx, ry, rz },
//     hands{L,R}/feet{L,R} (simple box dims), profiles{ torso, neck, armL, armR, legL, legR } (the
//     samples crossSectionAt interpolates), sides{L,R} (per-side limb sections), derived{} (internal
//     girths: underbust, knee, elbow, wrist, ankle, relaxed arm…), flex{ arm, forearm } (flexed ÷ relaxed).
//   `arm` and `forearm` tapes are FLEXED (the Measurements screen asks for a flexed biceps peak and a
//     clenched fist). landmarks.arm / .forearm reproduce those tapes exactly; the hanging rest-pose arm
//     (profiles.armL/R, crossSectionAt) uses the relaxed girth (landmarks.arm.relaxed). Renderers scale
//     the arm up by flex.arm in flexed poses.
//   landmarks.shoulder is the SHOULDERS tape: a horizontal loop at deltoid level around both arms
//     (includesArms:true). Its torso-only section (no arms) is landmarks.shoulder.torso.
//   Rest pose: arms hanging, palms facing the thighs (neutral forearm), feet slightly apart. Forearm and
//     wrist sections are for that neutral rotation (wider front-to-back); swap rx/rz when supinated.
//   crossSectionAt(geom, y, part): part ∈ torso | neck | head | armL | armR | legL | legR (aliases:
//     thighL/calfL/kneeL/shankL → legL, upperArmL/forearmL/elbowL → armL, same for R). y is the rest-pose
//     height; returns { y, rx, rz, n, cx, cz, girth } or null outside the part.
//
// CONTRACT-NOTE (§16c, ANTHRO-2) — per-side segment lengths:
//   Input `lengths: { upperArmL, upperArmR, forearmL, forearmR, thighL, thighR, shankL, shankR }` (inches,
//     TAPE lengths between surface landmarks, exactly what Forge's Measurements form asks for; the
//     `lenUpperArmL`-style store keys are accepted too). Also read from `shape.lengths`.
//       upperArm = acromion → bottom of the olecranon, elbow bent 90° (ANSUR "shoulder-elbow length")
//       forearm  = olecranon → ulnar styloid, elbow bent 90°
//       thigh    = top of the greater trochanter → lateral knee joint line
//       shank    = lateral knee joint line → centre of the lateral malleolus
//   Each tape is converted to a joint-centre bone: bone = tape − LANDMARK_OFFSETS[seg] × H (below).
//   Output (always present; symmetric ratio values when nothing is measured):
//     joints.{shoulder,elbow,wrist,hand,hip,knee,ankle,heel,toe}{L,R}  per side (x+ = subject's left)
//     bones.{upperArm,forearm,hand,thigh,shank}{L,R}                  joint-centre lengths per side; the
//       unsuffixed bones.upperArm/forearm/thigh/shank are now the L/R average (identical when symmetric)
//     lengths{upperArmL…shankR}  tape lengths used (measured, mirrored, or implied by the ratio skeleton)
//     lengthSource{…}            'measured' | 'mirrored' (copied from the other side) | 'ratio'
//     asymmetry[{ segment:'upperArm'|'forearm'|'thigh'|'shank'|'leg', left, right, diffIn (R − L),
//       longer:'left'|'right', note }]  for measured pairs differing by > 0.25 in
//     pelvis{ obliquityIn (hipL.y − hipR.y), tiltDeg (+ = left hip higher), kneeFlexIn{L,R} (forward
//       knee shift absorbing a leg difference beyond the obliquity limit), legScale (≠ 1 when the legs
//       had to be scaled to fit the stature) }
//     landmarkOffsets{ upperArm, forearm, thigh, shank }  (tape − bone, inches, for this stature)
//   Missing side ← the measured other side (listed in `estimated` as e.g. 'upperArmR'); missing pair ←
//   the ratio skeleton (listed in `estimated` only when at least one length was given, so the plain
//   girth-only call keeps estimated = []). Standing height is fixed: measured legs move the hip joints,
//   and the trunk + neck between the hip joints and the chin is stretched/compressed to keep the
//   stature (head unchanged). Hip height is limited to 0.49–0.585 H (ANSUR trochanterion 0.1–99.9 pct +
//   the model's hip offset); beyond that the legs are scaled to fit and a warning is added. Shoulders stay
//   level (spinal compensation). Per-side leg differences tilt the pelvis up to 0.8 in (2 cm); any excess
//   is taken up by flexing the longer knee (bone lengths stay honoured). segments{} stays the pure
//   Drillis–Contini ratio table; rig from joints/bones.
//
// Segment length sources ([AN2] = computed from the ANSUR II public male file, n = 4,082, median stature
//   1755 mm / 69.1 in; Gordon CC et al. 2014, NATICK/TR-15/007; data via Penn State OPEN Lab):
//     shoulder-elbow length   median 363 mm (14.29 in) = 0.2070 H, 0.1–99.9 pct 0.187–0.227 H
//     radiale-stylion length  median 267 mm (10.51 in) = 0.1521 H, 0.1–99.9 pct 0.136–0.174 H
//     trochanterion − tibiale height  median 431 mm (16.97 in) = 0.2456 H, 0.211–0.285 H
//     tibiale − lateral malleolus height  median 395 mm (15.55 in) = 0.2247 H, 0.201–0.253 H
//     trochanterion height 0.512 H, tibiale height 0.266 H, lateral malleolus height 0.0415 H, acromial
//     height 0.821 H.
//   Landmark → joint-centre offsets (fractions of H; tape − bone), anatomical rationale + calibration so
//   that the ratio skeleton reproduces the ANSUR II medians at median stature:
//     upperArm +0.0452: acromion's superior surface sits 0.0262 H (≈ 4.6 cm) above the glenohumeral centre
//       (HEIGHTS acromion − shoulderJoint; cf. Meskers et al. 1998 J Biomech 31:93 GH-centre regressions,
//       ≈ 4–5 cm); the lateral offset ([NY], ≈ 0.6 cm) is negligible along the tape. With the elbow at 90°
//       the under-surface of the olecranon is 0.0190 H (≈ 3.3 cm: trochlear radius ≈ 1.1 cm + ulna below
//       the trochlear notch + skin) below the elbow flexion axis. 0.2070 − 0.1618 [DL] = 0.0452.
//     forearm  +0.0130: the olecranon tip projects ≈ 2.3 cm behind the elbow joint centre along the forearm
//       (olecranon process); the ulnar styloid sits at the model's wrist level (ANSUR wrist height 0.4825 H
//       ≈ D&C wrist 0.485 H). Check: radiale-stylion 0.1521 H − radial styloid overhang (≈ 1 cm) + olecranon
//       2.3 cm → olecranon-ulnar styloid ≈ 0.159 H ≈ 11.0 in at 69.1 in.
//     thigh    +0.0006: D&C's hip joint (0.530 H) is 0.018 H above ANSUR trochanterion (0.512 H) and the
//       D&C knee centre (0.285 H, femoral epicondyle / flexion-axis level) is 0.0186 H above the tibial
//       joint line (tibiale 0.266 H, ≈ 3 cm), so the two offsets nearly cancel. (Radiographically the
//       trochanter tip is roughly level with the femoral-head centre; the residual is a D&C convention.)
//     shank    −0.0211: knee centre 0.0186 H above the joint line + ankle centre 0.0025 H below the lateral
//       malleolus prominence (D&C ankle 0.039 H vs ANSUR 0.0415 H; the talocrural axis passes just distal
//       to the malleolar tips, Inman 1976) → bone = tape + 0.0211 H.
//   Plausibility ranges (LENGTH_NORMS) = ANSUR II 0.1–99.9 pct of length/stature, slightly widened; the
//   forearm range is radiale-stylion's shifted by +0.0072 H (the olecranon/styloid offsets above).

export const LANDMARKS = ['vertex', 'chin', 'neck', 'shoulder', 'chest', 'underbust', 'waist', 'hip', 'crotch', 'thigh', 'knee', 'calf', 'ankle',
  'arm', 'elbow', 'forearm', 'wrist'];

// ------------------------------------------------------------------ proportions (fractions of H)
// Landmark heights.
export const HEIGHTS = {
  vertex: 1.0,          // [DC]
  chin: 0.870,          // [DC] menton; head height 0.130 H
  headCenter: 0.937,    // ≈ mid head height, slightly above (cranium is the larger part)
  neck: 0.848,          // neck tape, just below the laryngeal prominence; between [AN] cervicale ≈ 0.857 and suprasternale ≈ 0.818
  acromion: 0.818,      // [DC] shoulder (acromion) height; [AN] acromial height ≈ 0.818
  shoulderJoint: 0.7918,// glenohumeral centre = elbow + de Leva upper-arm length (0.630 + 0.1618) [DC]+[DL]
  deltoid: 0.798,       // shoulders tape: widest point of the delts, ≈ greater-tubercle level, just above the GH centre
  axilla: 0.755,        // ≈ posterior axillary fold, [AN] axilla height ≈ 0.75
  chest: 0.720,         // [DC] chest (nipple) height
  underbust: 0.685,     // ≈ inframammary fold / 10th rib
  elbow: 0.630,         // [DC]
  waist: 0.600,         // ≈ [AN] omphalion (navel) height ≈ 0.60; Forge measures waist at the navel
  forearm: 0.594,       // forearm tape: widest point ≈ 1/4 of the forearm below the elbow
  hipJoint: 0.530,      // [DC] hip (greater trochanter ≈ hip-joint-centre height)
  hip: 0.505,           // hips tape: max buttock protrusion, ≈ [AN] buttock height ≈ 0.50
  wrist: 0.485,         // [DC]
  crotch: 0.472,        // ≈ [AN] crotch height ≈ 0.473
  thigh: 0.455,         // thigh tape just below the gluteal fold (≈ [AN] gluteal-furrow height)
  fingertip: 0.377,     // [DC]
  knee: 0.285,          // [DC]
  calf: 0.205,          // calf tape at max girth ≈ 1/3 of the shank below the knee
  ankle: 0.039,         // [DC]
};
// Segment lengths.
export const SEGMENT_RATIOS = {
  upperArm: 0.186,      // [DC] acromion → elbow
  forearm: 0.146,       // [DC] elbow → wrist
  hand: 0.108,          // [DC] wrist → fingertip
  thigh: 0.245,         // [DC] hip (trochanter) → knee
  shank: 0.246,         // [DC] knee → ankle
  foot: 0.152,          // [DC] foot length
  footBreadth: 0.055,   // [DC]
  footHeight: 0.039,    // [DC] ankle height
  torso: 0.288,         // [DC] acromion → trochanter (0.818 − 0.530)
  head: 0.130,          // [DC] vertex → chin
  neck: 0.052,          // [DC] chin → acromion (0.870 − 0.818)
  handBreadth: 0.051,   // ≈ [AN] hand breadth ≈ 8.9 cm
  handThickness: 0.017, // ≈ metacarpal thickness ≈ 3 cm
};
// de Leva joint-centre lengths (used to place joints; reported as geom.bones).
export const BONE_RATIOS = { upperArm: 0.1618, forearm: 0.1545, thigh: 0.2425, shank: 0.2493 };   // [DL] 281.7, 268.9, 422.2, 434.0 mm / 1741 mm
// Head (ellipsoid semi-axes).
const HEAD = {
  rx: 0.0447,           // ≈ [AN] head breadth 15.7 cm / 1756 mm, halved
  rz: 0.0567,           // ≈ [AN] head length 19.9 cm, halved
  ry: 0.065,            // [DC] head height 0.130 H, halved
};
// Lateral joint offsets (half the distance between left and right joint centres).
const JOINT_X = {
  hip: 0.0505,          // inter-hip-joint-centre distance ≈ 17.7 cm for a 175 cm man (≈ 0.10 H; Bell 1990-type regressions)
  knee: 0.043,          // relaxed stance, knees ≈ 15 cm apart centre to centre
  ankle: 0.045,         // feet ≈ hip width
};
// Sagittal (z) placement, fractions of H. Torso centres are given for the reference (median) man; when a
// section is deeper or shallower than his, the centre moves by bias × Δdepth/2: bias +1 keeps the back
// fixed (all change in front: belly, pecs), −1 keeps the front fixed (all change behind: glutes).
// Reference surfaces (175 cm man): scapulae ≈ 4.6 in behind the GH plane, lumbar back ≈ 3.5 in (lordosis),
// buttocks ≈ 5.6 in behind / groin ≈ 3.9 in ahead of the hip joint, chest front ≈ 5.2 in.
const ZC = {   // [centre at reference depth, bias]
  chest: [0.0050, 0.8], underbust: [0.0070, 0.75], waist: [0.0150, 0.8], hip: [-0.0125, -0.5],
};
const Z = {
  crotch: -0.0072,
  shoulder: -0.002, acromion: -0.008, trap: -0.010,
  neckBase: -0.010, neck: -0.006, chin: 0.009, head: 0.006,
  knee: -0.006, ankle: -0.014,   // plumb line passes slightly ahead of the knee and ≈ 2.5 cm ahead of the ankle joint
  heelBack: 0.22,       // calcaneus extends ≈ 22 % of foot length behind the ankle joint
};

// ANSUR-derived typical girth ratios for inputs we never get on the tape (internal sections).
//   knee ≈ 0.99 × calf ≈ 0.63 × thigh; elbow ≈ 0.91 × forearm(relaxed) ≈ 0.78 × arm(relaxed);
//   wrist ≈ 0.60 × forearm ≈ 0.0995 H; ankle (min) ≈ 0.59 × calf ≈ 0.131 H (each averaged over both predictors).
// Reference body for missing tape sites (matches projection.js REF_BODY so filled values agree).
const REF = {
  male: { h: 69, w: 164, bf: 20, neck: 15, shoulders: 46, chest: 39, waist: 33, hips: 38, arm: 13, forearm: 11, thigh: 22, calf: 14.5 },
  female: { h: 64, w: 140, bf: 28, neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14 },
};
const SITES = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'arm', 'forearm', 'thigh', 'calf'];
// Plausible adult ranges (in) for sanity warnings (≈ ANSUR 0.1–99.9 pct, widened for muscular/obese).
const RANGE = { neck: [11, 22], shoulders: [34, 66], chest: [28, 60], waist: [22, 64], hips: [28, 64], arm: [8, 24], forearm: [7.5, 18],
  thigh: [14, 36], calf: [10, 22] };
// Buddy ratios (ANSUR/REF medians): fill a missing site from a measured neighbour first.
const BUDDY = { forearm: ['arm', 11 / 13], arm: ['forearm', 13 / 11], calf: ['thigh', 14.5 / 22], thigh: ['calf', 22 / 14.5],
  chest: ['shoulders', 1 / 1.18] };   // [AN] shoulder circ / chest circ ≈ 1.17–1.18
// (a missing shoulders tape is not scaled from chest: it is rebuilt from a skeletal biacromial prior, see below)

// ------------------------------------------------------------------ female proportions (CONTRACT §21)
// [AN2F] = computed from the ANSUR II public FEMALE file (Gordon CC et al. 2014, NATICK/TR-15/007; data via Penn
//   State OPEN Lab, tools.openlab.psu.edu/publicData/ANSUR_II_FEMALE_Public.csv), n = 1,986, median stature 1626 mm
//   (64.0 in), with exactly the method of the male [AN2] numbers (median of each subject's length / stature, and the
//   0.1–99.9 pct of that ratio; the same script reproduces every male [AN2] value above from the male file, n = 4,082).
// Method: every male table value v (D&C / de Leva / ANSUR conventions above) becomes v × RoR, the ratio of ratios
//   RoR = median(X / stature | female) ÷ median(X / stature | male) of the ANSUR II measurement X that defines it, so
//   the female skeleton keeps the male model's calibrated joint-centre conventions and only the sex difference in
//   proportion is imported. Heights that are differences (elbow = acromion − upper arm, …) are rebuilt from scaled
//   parts. RoR used (F/M):
//     acromial height 0.9991, cervicale+suprasternale (neck tape level) 0.9942, axilla height 1.0056, omphalion 1.0006,
//     buttock height 1.0131, trochanterion 1.0135, crotch height 0.9972, tibiale 1.0081, lateral malleolus 0.9306,
//     wrist height 1.0099, shoulder-elbow length 0.9905, radiale-stylion 0.9713, trochanterion−tibiale 1.0198,
//     tibiale−lateral malleolus 1.0234, hand length 1.0086, foot length 0.9802, foot breadth 0.9822, hand breadth
//     0.9547, head height (tragion-top of head + menton-sellion) 1.0171, head breadth 1.0317, head length 1.0251,
//     bicristal (pelvic) breadth 1.0668, biacromial 0.9490, (bideltoid − biacromial)/2 0.9423, neck base / neck
//     circumference 1.0306, wrist / forearm circumference 1.0353, wrist circ / stature 0.948, ankle / calf 0.989,
//     ankle circ / stature 1.013, shoulder circ / chest circ 0.9776; section aspects (depth / breadth): chest at the
//     bust 1.0449 (F 0.916 vs M 0.876), waist 0.9774, buttock depth / hip breadth 0.9207 (F 0.654 vs M 0.710).
//   Direct female values (soft-tissue landmarks with no male-convention equivalent):
//     bust point (ANSUR "chest height", taken at the bustpoint in women) 0.719 H;
//     natural waist = WHO midpoint between the lowest rib and the iliac crest (WHO 2008, Waist circumference and
//       waist-hip ratio, report of a WHO expert consultation): (tenth-rib height + iliocristale height) / 2 =
//       0.6299 H in [AN2F] (0.6208 H in men) → the model's 0.600 H navel × 0.6299 / 0.6016 (male omphalion) =
//       0.628 H, ≈ 1.8 in above the navel at 64 in. Women tape the waist there (also the US Navy female site).
//   Segment-length tapes ([AN2F], 0.1–99.9 pct, widened like the male ranges):
//     shoulder-elbow length   median 334 mm (13.15 in) = 0.2050 H, 0.186–0.223 H   (male 0.2070)
//     radiale-stylion length  median 240.5 mm = 0.1478 H, 0.129–0.169 H  → olecranon–ulnar styloid 0.1550 H
//     trochanterion − tibiale median 407 mm (16.02 in) = 0.2505 H, 0.217–0.286 H     (male 0.2456: women's legs are
//     tibiale − lat. malleolus median 374 mm (14.72 in) = 0.2300 H, 0.201–0.259 H   proportionally longer)
//   Landmark → joint-centre offsets: same anatomy, recomputed as tape median − the female model bone (≈ the male ones).
// Female reference girths (REF.female, shared with projection.js REF_BODY) stay a typical civilian woman (64 in,
//   140 lb, 28 % BF); the Army sample's medians (bust 37.0, omphalion waist 33.5, hips 40.1, neck 12.9, shoulders 40.4,
//   flexed biceps 12.0, flexed forearm 10.4, thigh 24.1, calf 14.6 in, 147 lb) are heavier and more muscular.
// Underbust (bra band, at the inframammary fold) is not in ANSUR II, so it is a model value unless a tape is given
//   (`underbust`): bust × (0.862 + 0.0035 × (28 − BF%)), clamped 0.78–0.95 × bust — bust/underbust ≈ 1.16 for the
//   reference woman (cup ≈ 4.8 in), smaller cups when leaner (breast volume is mostly fat). The fold sits
//   0.030 H + 0.22 × (bust − underbust) below the bust point (≈ 3 in for the reference woman).
const RoR = {
  acromion: 0.9991, neckLevel: 0.9942, axilla: 1.0056, omphalion: 1.0006, buttock: 1.0131, trochanterion: 1.0135,
  crotch: 0.9972, tibiale: 1.0081, malleolus: 0.9306, wrist: 1.0099, upperArm: 0.9905, forearm: 0.9713, thigh: 1.0198,
  shank: 1.0234, hand: 1.0086, foot: 0.9802, footBreadth: 0.9822, handBreadth: 0.9547, headHeight: 1.0171,
  headBreadth: 1.0317, headLength: 1.0251, bicristal: 1.0668, biacromial: 0.9490, deltoidReach: 0.9423,
};
const r4 = x => Math.round(x * 10000) / 10000;
const F_ELBOW = r4(0.818 * RoR.acromion - 0.188 * RoR.upperArm), F_WRIST = r4(0.485 * RoR.wrist), F_KNEE = r4(0.285 * RoR.tibiale);
export const HEIGHTS_FEMALE = {
  vertex: 1.0,
  chin: r4(1 - 0.130 * RoR.headHeight),
  headCenter: r4(1 - 0.063 * RoR.headHeight),
  neck: r4(0.848 * RoR.neckLevel),
  acromion: r4(0.818 * RoR.acromion),
  shoulderJoint: r4(F_ELBOW + 0.1618 * RoR.upperArm),
  deltoid: r4(F_ELBOW + 0.1618 * RoR.upperArm + 0.0062),
  axilla: r4(0.755 * RoR.axilla),
  chest: 0.719,         // bust point, [AN2F] chest height 0.7194 H (direct)
  underbust: 0.672,     // inframammary fold for the reference woman (per body: chest − fold drop, see above)
  elbow: F_ELBOW,
  waist: 0.628,         // natural waist (WHO site), see above
  navel: r4(0.600 * RoR.omphalion),
  forearm: r4(F_ELBOW - 0.036 * RoR.forearm),
  hipJoint: r4(0.530 * RoR.trochanterion),
  hip: r4(0.505 * RoR.buttock),
  wrist: F_WRIST,
  crotch: r4(0.472 * RoR.crotch),
  thigh: r4(0.472 * RoR.crotch - 0.017),
  fingertip: r4(F_WRIST - 0.108 * RoR.hand),
  knee: F_KNEE,
  calf: r4(F_KNEE - 0.080 * RoR.shank),
  ankle: r4(0.039 * RoR.malleolus),
};
export const SEGMENT_RATIOS_FEMALE = {
  upperArm: r4(0.186 * RoR.upperArm), forearm: r4(0.146 * RoR.forearm), hand: r4(0.108 * RoR.hand),
  thigh: r4(0.245 * RoR.thigh), shank: r4(0.246 * RoR.shank), foot: r4(0.152 * RoR.foot),
  footBreadth: r4(0.055 * RoR.footBreadth), footHeight: HEIGHTS_FEMALE.ankle,
  torso: r4(HEIGHTS_FEMALE.acromion - HEIGHTS_FEMALE.hipJoint), head: r4(0.130 * RoR.headHeight),
  neck: r4(HEIGHTS_FEMALE.chin - HEIGHTS_FEMALE.acromion),
  handBreadth: r4(0.051 * RoR.handBreadth), handThickness: r4(0.017 * RoR.handBreadth),
};
export const BONE_RATIOS_FEMALE = { upperArm: r4(0.1618 * RoR.upperArm), forearm: r4(0.1545 * RoR.forearm), thigh: r4(0.2425 * RoR.thigh), shank: r4(0.2493 * RoR.shank) };
const HEAD_FEMALE = { rx: r4(0.0447 * RoR.headBreadth), rz: r4(0.0567 * RoR.headLength), ry: r4(0.065 * RoR.headHeight) };
const JOINT_X_FEMALE = { hip: r4(0.0505 * RoR.bicristal), knee: 0.043, ankle: 0.045 };   // wider pelvis, same stance at knee/ankle (→ valgus)
// bust: the extra depth is in front (breasts), so its centre follows the front more than the male chest does
const ZC_FEMALE = { chest: [0.0050, 0.95], underbust: [0.0070, 0.75], waist: [0.0150, 0.8], hip: [-0.0125, -0.5] };
// ANSUR II female 0.1–99.9 pct (in), widened for muscular / obese like the male ranges
const RANGE_FEMALE = { neck: [9.5, 19], shoulders: [30, 58], chest: [26, 58], waist: [20, 58], hips: [28, 66], arm: [7.5, 21], forearm: [7, 16],
  thigh: [14, 38], calf: [10, 22] };
const BUDDY_FEMALE = { forearm: ['arm', 9.5 / 11.5], arm: ['forearm', 11.5 / 9.5], calf: ['thigh', 14 / 22], thigh: ['calf', 22 / 14],
  chest: ['shoulders', 1 / r4(1.18 * 0.9776)] };   // shoulder circ / bust ≈ 1.15 ([AN2F] median 1.091 vs male 1.116, × the male 1.18)
const LANDMARK_OFFSETS_FEMALE = { upperArm: 0.0447, forearm: 0.0129, thigh: 0.0006, shank: -0.0210 };
const LENGTH_NORMS_FEMALE = {
  upperArm: { median: 0.2050, range: [0.184, 0.225] },
  forearm: { median: 0.1550, range: [0.135, 0.178] },
  thigh: { median: 0.2505, range: [0.215, 0.288] },
  shank: { median: 0.2300, range: [0.199, 0.261] },
};

// Per-sex table set used by bodyGeometry(). The male set is the original tables (so male output is unchanged).
// fy / fyArm move a male height fraction used inside the model (taper samples between landmarks, joint helpers)
// onto the female skeleton by piecewise-linear interpolation between corresponding landmarks.
const plMapFrac = knots => x => {
  let k = 0; while (k < knots.length - 2 && x > knots[k + 1][0]) k++;
  const [x0, y0] = knots[k], [x1, y1] = knots[k + 1];
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
};
const SEX_TABLES = {
  male: { sex: 'male', HT: null, SR: null, HEAD: null, JX: null, ZC: null, RANGE: null, BUDDY: null, LO: null, LN: null, hipRange: null,
    fy: x => x, fyArm: x => x,
    k: { chestAsp: 1, waistAsp: 1, hipAsp: 1, biac: 0.229, biacRef: 69.1, cMin: 0.100, cMax: 0.1275, delt: 1, hipJointLerp: 0.3,
      neckBase: 1, wristFore: 0.60, wristH: 0.0995, ankleCalf: 0.59, ankleH: 0.131 } },
  female: { sex: 'female', HT: HEIGHTS_FEMALE, SR: SEGMENT_RATIOS_FEMALE, HEAD: HEAD_FEMALE, JX: JOINT_X_FEMALE, ZC: ZC_FEMALE, RANGE: RANGE_FEMALE,
    BUDDY: BUDDY_FEMALE, LO: LANDMARK_OFFSETS_FEMALE, LN: LENGTH_NORMS_FEMALE, hipRange: [0.493, 0.585],
    fy: null, fyArm: null,
    // hipJointLerp: the female hip stays wide up to the hip joint (gynoid fat over the trochanters), then curves in
    k: { chestAsp: 1.0449, waistAsp: 0.9774, hipAsp: 0.9207, biac: r4(0.229 * RoR.biacromial), biacRef: 64.0, cMin: r4(0.100 * RoR.biacromial),
      cMax: r4(0.1275 * RoR.biacromial), delt: RoR.deltoidReach, hipJointLerp: 0.15, neckBase: 1.0306,
      wristFore: r4(0.60 * 1.0353), wristH: r4(0.0995 * 0.948), ankleCalf: r4(0.59 * 0.989), ankleH: r4(0.131 * 1.013) } },
};
function sexTables(sex) {
  const T = SEX_TABLES[sex === 'female' ? 'female' : 'male'];
  if (!T.HT) Object.assign(T, { HT: HEIGHTS, SR: SEGMENT_RATIOS, HEAD, JX: JOINT_X, ZC, RANGE, BUDDY, LO: LANDMARK_OFFSETS, LN: LENGTH_NORMS, hipRange: HIP_RANGE });
  if (!T.fy) {
    const M = HEIGHTS, F = T.HT;
    T.fy = plMapFrac([[0, 0], ...['ankle', 'calf', 'knee', 'thigh', 'crotch', 'hip', 'hipJoint'].map(k => [M[k], F[k]]), [M.waist, F.navel],
      ...['chest', 'axilla', 'shoulderJoint', 'acromion', 'neck', 'chin', 'headCenter'].map(k => [M[k], F[k]]), [1, 1]]);
    T.fyArm = plMapFrac(['fingertip', 'wrist', 'forearm', 'elbow', 'shoulderJoint', 'acromion'].map(k => [M[k], F[k]]));
  }
  return T;
}
/** Proportion tables for a sex (fractions of stature): { heights, segments, bones, lengthNorms, landmarkOffsets }. */
export function proportions(sex = 'male') {
  const T = sexTables(sex);
  return { sex: T.sex, heights: T.HT, segments: T.SR, bones: T.sex === 'female' ? BONE_RATIOS_FEMALE : BONE_RATIOS, lengthNorms: T.LN, landmarkOffsets: T.LO };
}

// ------------------------------------------------------------------ helpers
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const pos = x => { const v = Number(x); return x != null && x !== '' && Number.isFinite(v) && v > 0 ? v : null; };
const fin = x => typeof x === 'number' && Number.isFinite(x);
const r3 = x => Math.round(x * 1000) / 1000;
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ superellipse
function quarterArc(a, b, n, N) {
  const e = 2 / n;
  let L = 0, px = a, pz = 0;
  for (let i = 1; i <= N; i++) {
    const t = (Math.PI / 2) * (i / N);
    const x = i === N ? 0 : a * Math.pow(Math.max(0, Math.cos(t)), e), z = b * Math.pow(Math.max(0, Math.sin(t)), e);
    L += Math.hypot(x - px, z - pz); px = x; pz = z;
  }
  return L;
}
// Numeric superellipse perimeter: polyline (N and 2N chords per quadrant) + Richardson extrapolation.
// Relative error < 1e-5 for 1.3 ≤ n ≤ 8 and aspect 0.25–4 (checked against a 400k-chord reference in
// test/anthro-math.test.js).
export function perimeter(rx, rz, n = 2) {
  const a = Math.abs(Number(rx)) || 0, b = Math.abs(Number(rz)) || 0;
  const nn = fin(Number(n)) && Number(n) > 0.5 ? Number(n) : 2;
  if (a === 0 || b === 0) return 4 * Math.max(a, b);   // degenerate: a segment traversed both ways
  // Perimeter is linear in size at a fixed shape: cache the unit shape (aspect, n).
  const k = b / a, key = k + '|' + nn;
  let u = PERIM_CACHE.get(key);
  if (u === undefined) {
    const N = nn <= 4 ? 40 : Math.min(2000, Math.ceil(40 * nn / 4)), q1 = quarterArc(1, k, nn, N), q2 = quarterArc(1, k, nn, 2 * N);
    u = 4 * (q2 + (q2 - q1) / 3);
    if (PERIM_CACHE.size > 4000) PERIM_CACHE.clear();
    PERIM_CACHE.set(key, u);
  }
  return a * u;
}
const PERIM_CACHE = new Map();
// Section with depth:width aspect (rz/rx) and exponent n whose perimeter equals girth. Perimeter scales
// linearly with size at a fixed shape, so this is exact up to the perimeter's numeric accuracy.
export function solveSection(girth, aspect = 1, n = 2) {
  const G = Math.max(0, Number(girth) || 0), k = pos(aspect) || 1, nn = pos(n) || 2;
  const unit = perimeter(1, k, nn);
  const rx = G / unit, rz = rx * k;
  return { rx, rz, n: nn, girth: perimeter(rx, rz, nn) };
}
function sePoint(a, b, n, t) {
  const c = Math.abs(Math.cos(t)) < 1e-12 ? 0 : Math.cos(t), s = Math.abs(Math.sin(t)) < 1e-12 ? 0 : Math.sin(t), e = 2 / n;
  return [a * Math.sign(c) * Math.pow(Math.abs(c), e), b * Math.sign(s) * Math.pow(Math.abs(s), e)];
}
// Solve n so perimeter(rx, rz, n) = girth (perimeter grows with n). Returns null if unreachable.
function solveN(rx, rz, girth, lo = 1.3, hi = 10) {
  if (perimeter(rx, rz, lo) > girth || perimeter(rx, rz, hi) < girth) return null;
  for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (perimeter(rx, rz, m) < girth) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------------ convex hull (the shoulders tape)
function hull(points) {
  const p = points.slice().sort((A, B) => A[0] - B[0] || A[1] - B[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
// Tape loop around the upper torso (superellipse Tx,Tz,Tn centred at 0) and both arms (ellipses ax,az at ±c).
function shoulderLoop(c, Tx, Tz, Tn, ax, az) {
  const K = 96, pts = [];
  for (let k = 0; k < K; k++) {
    const t = (2 * Math.PI * k) / K;
    pts.push(sePoint(Tx, Tz, Tn, t));
    const [x, z] = sePoint(ax, az, 2, t);
    pts.push([c + x, z], [-c + x, z]);
  }
  const h = hull(pts);
  let P = 0, W = 0, D = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    P += Math.hypot(b[0] - a[0], b[1] - a[1]);
    W = Math.max(W, Math.abs(a[0])); D = Math.max(D, Math.abs(a[1]));
  }
  return { perimeter: P * (1 + 1 / (K * K) * 1.6), halfWidth: W, halfDepth: D };   // tiny chord-sag correction
}

// ------------------------------------------------------------------ monotone cubic (Fritsch–Carlson)
const SLOPES = new WeakMap();
function pchipSlopes(xs, ys) {
  const n = xs.length, m = new Array(n).fill(0);
  if (n < 2) return m;
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  // End slopes: keep the sign of the secant and don't overshoot (one-sided, shape preserving).
  if (n > 2) {
    for (const [i, j, k] of [[0, 0, 1], [n - 1, n - 2, n - 3]]) {
      const hh0 = h[j], hh1 = h[i === 0 ? 1 : n - 3], d0 = d[j], d1 = d[i === 0 ? 1 : n - 3];
      let s = ((2 * hh0 + hh1) * d0 - hh0 * d1) / (hh0 + hh1);
      if (Math.sign(s) !== Math.sign(d0)) s = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0;
      m[i] = s; void k;
    }
  }
  return m;
}
const KEYS = ['rx', 'rz', 'n', 'cx', 'cz'];
function profileSlopes(prof) {
  let s = SLOPES.get(prof);
  if (!s) {
    const ys = prof.map(p => p.y);
    s = { ys, m: Object.fromEntries(KEYS.map(k => [k, pchipSlopes(ys, prof.map(p => p[k]))])) };
    SLOPES.set(prof, s);
  }
  return s;
}
function interpProfile(prof, y) {
  if (!prof || !prof.length) return null;
  const { ys, m } = profileSlopes(prof);
  const n = ys.length;
  if (y < ys[0] - 1e-9 || y > ys[n - 1] + 1e-9) return null;
  if (n === 1) return { ...prof[0] };
  let i = 0;
  while (i < n - 2 && y > ys[i + 1]) i++;
  const h = ys[i + 1] - ys[i], t = clamp((y - ys[i]) / h, 0, 1);
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  const out = { y };
  for (const k of KEYS) out[k] = h00 * prof[i][k] + h10 * h * m[k][i] + h01 * prof[i + 1][k] + h11 * h * m[k][i + 1];
  return out;
}

// ------------------------------------------------------------------ missing measurements
function fillGirths(a, sex, H, bf, estimated) {
  const ref = REF[sex], BUD = sexTables(sex).BUDDY;
  const given = {};
  for (const s of SITES) { const v = pos(a[s]); if (v) given[s] = v; }
  const W = pos(a.weightLb);
  let scale;
  if (W) scale = Math.sqrt((W / ref.w) / (H / ref.h));   // girth² ∝ cross-section ∝ weight / height
  else {
    const rs = ['neck', 'shoulders', 'chest', 'arm', 'forearm', 'thigh', 'calf'].filter(s => given[s]).map(s => given[s] / ref[s]).sort((x, y) => x - y);
    const mid = rs.length >> 1;
    scale = !rs.length ? Math.sqrt(H / ref.h) : rs.length % 2 ? rs[mid] : 0.5 * (rs[mid - 1] + rs[mid]);
  }
  const g = { ...given };
  for (const s of SITES) {
    if (g[s]) continue;
    const b = BUD[s];
    let v;
    if (b && given[b[0]]) v = given[b[0]] * b[1];
    else {
      v = ref[s] * scale;
      if (s === 'waist') v += 0.3 * (bf - ref.bf);   // same fat response as projection.js
      if (s === 'hips') v += 0.15 * (bf - ref.bf);
    }
    g[s] = Math.round(v * 10) / 10;
    estimated.push(s);
  }
  return { g, given };
}

function sanity(g, given, H, bf, warnings, sex = 'male') {
  const F = sex === 'female', RG = sexTables(sex).RANGE;
  for (const s of SITES) {
    const [lo, hi] = RG[s];
    if (given[s] && (given[s] < lo || given[s] > hi)) warnings.push(`${s} ${given[s]} in is outside the usual adult range (${lo}–${hi} in). Check the tape and units.`);
  }
  // Only compare pairs where at least one value came from the tape (estimates follow typical ratios anyway).
  const any = (...k) => k.some(x => given[x]);
  if (any('waist', 'chest') && g.waist > g.chest * 1.12) warnings.push(`Waist (${g.waist}) is much larger than chest (${g.chest}). Possible, but double-check both tapes.`);
  if (any('waist', 'chest') && g.chest > g.waist * 1.55) warnings.push(`Chest (${g.chest}) is over 1.55× waist (${g.waist}); that is extreme even for bodybuilders. Check the tapes.`);
  if (any('arm', 'thigh') && g.arm > g.thigh) warnings.push(`Arm (${g.arm}) is bigger than thigh (${g.thigh}). That is very unusual; check the thigh is measured at the top, just below the glute fold.`);
  if (any('calf', 'thigh') && g.calf > g.thigh) warnings.push(`Calf (${g.calf}) is bigger than thigh (${g.thigh}). Check the thigh site.`);
  if (any('forearm', 'arm') && g.forearm > g.arm) warnings.push(`Forearm (${g.forearm}) is bigger than the flexed arm (${g.arm}). Check both tapes.`);
  if (!F && given.shoulders && g.shoulders < g.chest * 1.06) warnings.push(`Shoulders (${g.shoulders}) should be about 1.12–1.25× chest (${g.chest}): the shoulder tape goes around both delts with the arms down, outside the arms.`);
  if (!F && given.shoulders && g.shoulders > g.chest * 1.45) warnings.push(`Shoulders (${g.shoulders}) are over 1.45× chest (${g.chest}). Check the shoulder tape is horizontal.`);
  if (!F && any('hips', 'waist') && g.hips < g.waist * 0.8) warnings.push(`Hips (${g.hips}) are much smaller than waist (${g.waist}). Check the hip tape goes around the widest part of the glutes.`);
  if (!F && any('hips', 'waist') && g.hips > g.waist * 1.45) warnings.push(`Hips (${g.hips}) are over 1.45× waist (${g.waist}). Check both tapes.`);
  // women ([AN2F]): shoulders ≈ 1.0–1.2 × bust (median 1.09); hips (widest) ≈ 1.1–1.6 × natural waist
  if (F && given.shoulders && g.shoulders < g.chest * 0.95) warnings.push(`Shoulders (${g.shoulders}) are smaller than the bust (${g.chest}). The shoulder tape goes around both delts with the arms down (typically 1.0–1.2× the bust); check it.`);
  if (F && given.shoulders && g.shoulders > g.chest * 1.4) warnings.push(`Shoulders (${g.shoulders}) are over 1.4× bust (${g.chest}). Check the shoulder tape is horizontal and the bust tape goes over the fullest part.`);
  if (F && any('hips', 'waist') && g.hips < g.waist * 0.85) warnings.push(`Hips (${g.hips}) are much smaller than waist (${g.waist}). Check the hip tape goes around the widest part of the hips and glutes.`);
  if (F && any('hips', 'waist') && g.hips > g.waist * 1.75) warnings.push(`Hips (${g.hips}) are over 1.75× waist (${g.waist}). Check both tapes (waist at the narrowest point, hips at the widest).`);
  if (any('neck', 'chest') && g.neck > g.chest * 0.5) warnings.push(`Neck (${g.neck}) is over half the chest (${g.chest}). Check the neck tape.`);
  if (any('thigh', 'hips') && g.thigh > g.hips * 0.75) warnings.push(`Thigh (${g.thigh}) is over 0.75× hips (${g.hips}). Check both tapes.`);
  if (H < 55 || H > 86) warnings.push(`Height ${H} in is outside 55–86 in. Check units (inches).`);
  if (bf < 3 || bf > 55) warnings.push(`Body fat ${bf}% is outside 3–55%.`);
}

// ------------------------------------------------------------------ segment lengths (§16c)
export const LENGTH_FIELDS = ['upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'thighL', 'thighR', 'shankL', 'shankR'];
export const LENGTH_SEGMENTS = ['upperArm', 'forearm', 'thigh', 'shank'];
// tape − joint-centre bone, as a fraction of stature (see the header for the derivation).
export const LANDMARK_OFFSETS = { upperArm: 0.0452, forearm: 0.0130, thigh: 0.0006, shank: -0.0211 };
// Tape length / stature: ANSUR II male median and plausible range (≈ 0.1–99.9 pct, widened slightly).
export const LENGTH_NORMS = {
  upperArm: { median: 0.2070, range: [0.185, 0.229] },
  forearm: { median: 0.1593, range: [0.142, 0.182] },
  thigh: { median: 0.2456, range: [0.209, 0.287] },
  shank: { median: 0.2247, range: [0.199, 0.255] },
};
const SEG_TEXT = {
  upperArm: ['upper arm', 'acromion (bony outer tip of the shoulder) to the point of the elbow, elbow bent 90°'],
  forearm: ['forearm', 'point of the elbow to the bony bump on the pinky side of the wrist, elbow bent 90°'],
  thigh: ['thigh', 'bony knob on the side of the hip (greater trochanter) to the outer knee joint line'],
  shank: ['lower leg', 'outer knee joint line to the centre of the outer ankle bone'],
};
const MAX_OBLIQUITY = 0.8;   // in at 69.1 in stature (≈ 2 cm): clinically significant leg-length difference
const HIP_RANGE = [0.49, 0.585];   // hip-joint height / stature
export function boneFromTape(segment, tapeIn, heightIn, sex = 'male') { return Number(tapeIn) - (sexTables(sex).LO[segment] || 0) * Number(heightIn); }
export function tapeFromBone(segment, boneIn, heightIn, sex = 'male') { return Number(boneIn) + (sexTables(sex).LO[segment] || 0) * Number(heightIn); }
const fmtIn = x => String(+(Math.round(x * 100) / 100).toFixed(2));

function resolveLengths(raw, H, warnings, estimated, sex = 'male') {
  const LN = sexTables(sex).LN;
  const src = raw && typeof raw === 'object' ? raw : {};
  const given = {};
  for (const k of LENGTH_FIELDS) {
    const v = pos(src[k] ?? src['len' + k[0].toUpperCase() + k.slice(1)]);
    if (v == null) continue;
    if (v < 4 || v > 40) { warnings.push(`${k} length ${v} in was ignored (outside 4–40 in). Check the units (inches).`); continue; }
    given[k] = v;
  }
  const any = Object.keys(given).length > 0;
  const tape = {}, source = {};
  for (const seg of LENGTH_SEGMENTS) {
    const [lo, hi] = LN[seg].range.map(f => f * H);
    for (const S of ['L', 'R']) {
      const k = seg + S, o = seg + (S === 'L' ? 'R' : 'L');
      let v = given[k], s = 'measured';
      if (v == null && given[o] != null) { v = given[o]; s = 'mirrored'; }
      if (v == null) { tape[k] = null; source[k] = 'ratio'; if (any) estimated.push(k); continue; }
      if (s === 'mirrored') estimated.push(k);
      if (v < lo || v > hi) {
        if (s === 'measured') warnings.push(`${S === 'L' ? 'Left' : 'Right'} ${SEG_TEXT[seg][0]} length ${fmtIn(v)} in is ${v < lo ? 'short' : 'long'} for a ${fmtIn(H)} in stature (typical ${lo.toFixed(1)}–${hi.toFixed(1)} in, ANSUR II); the model uses ${fmtIn(clamp(v, lo, hi))} in. Check the landmarks: ${SEG_TEXT[seg][1]}.`);
        v = clamp(v, lo, hi);
      }
      tape[k] = v; source[k] = s;
    }
  }
  return { given, any, tape, source };
}

function lengthAsymmetry(LEN) {
  const out = [], g = LEN.given, both = seg => g[seg + 'L'] != null && g[seg + 'R'] != null;
  const push = (segment, left, right, label) => {
    const d = right - left;
    if (Math.abs(d) <= 0.25) return;
    const longer = d > 0 ? 'right' : 'left', other = d > 0 ? 'left' : 'right';
    const tail = segment === 'leg' || segment === 'thigh' || segment === 'shank'
      ? ' Up to ~0.4 in (1 cm) is common and within tape error, so re-measure both sides twice. A real leg-length difference over ~0.8 in (2 cm) is worth a professional check; the model tilts the pelvis to match.'
      : ' Up to ~0.4 in (1 cm) is common (and within tape error); re-measure both sides twice.';
    out.push({ segment, left, right, diffIn: Math.round(d * 100) / 100, longer,
      note: `${longer[0].toUpperCase() + longer.slice(1)} ${label} ${fmtIn(Math.abs(d))} in longer than ${other}.${tail}` });
  };
  for (const seg of LENGTH_SEGMENTS) if (both(seg)) push(seg, g[seg + 'L'], g[seg + 'R'], SEG_TEXT[seg][0]);
  if (both('thigh') && both('shank')) push('leg', g.thighL + g.shankL, g.thighR + g.shankR, 'leg (thigh + lower leg)');
  return out;
}

// ------------------------------------------------------------------ main
export function bodyGeometry(input = {}) {
  const a = { ...((input && input.shape) || {}), ...(input || {}) };
  const warnings = [], estimated = [];
  const sex = a.sex === 'female' ? 'female' : 'male', FEM = sex === 'female';
  // per-sex proportion tables (female: ANSUR II female, see "female proportions" above)
  const TB = sexTables(sex), HT = TB.HT, SR = TB.SR, K = TB.k, fy = TB.fy, fyA = TB.fyArm, JX = TB.JX;
  let H = pos(a.heightIn);
  if (!H) { H = REF[sex].h; estimated.push('heightIn'); }
  const s = H / 69.1;   // skeletal scale vs the ANSUR median stature (1756 mm)
  let bf = Number(a.bodyFatPct);
  if (!(a.bodyFatPct != null && a.bodyFatPct !== '' && Number.isFinite(bf))) { bf = REF[sex].bf; estimated.push('bodyFatPct'); }
  const bfRaw = bf;
  bf = clamp(bf, 3, 55);
  const mu = {};
  for (const k of ['chest', 'delts', 'lats', 'arms', 'abs', 'quads', 'calves', 'traps']) {
    const v = Number(a.muscle?.[k]);
    mu[k] = Number.isFinite(v) ? clamp(v, 0, 1) : 0.5;
  }
  const { g, given } = fillGirths(a, sex, H, bf, estimated);
  sanity(g, given, H, bfRaw, warnings, sex);

  // ---- segment lengths (§16c): per-side leg chain from the floor up, stature kept fixed.
  const LEN = resolveLengths(a.lengths || input?.shape?.lengths, H, warnings, estimated, sex);
  const ankleY0 = HT.ankle * H, kneeY0 = HT.knee * H, hipY0 = HT.hipJoint * H, chinY = HT.chin * H;
  const LX = { hip: JX.hip * H, knee: JX.knee * H, ankle: JX.ankle * H }, LZ = { hip: 0, knee: Z.knee * H, ankle: Z.ankle * H };
  const vdrop = (B, dx, dz) => Math.sqrt(Math.max(1e-6, B * B - dx * dx - dz * dz));
  const defLegBone = { shank: Math.hypot(LX.knee - LX.ankle, kneeY0 - ankleY0, LZ.knee - LZ.ankle), thigh: Math.hypot(LX.hip - LX.knee, hipY0 - kneeY0, LZ.hip - LZ.knee) };
  const legGiven = ['thighL', 'thighR', 'shankL', 'shankR'].some(k => LEN.tape[k] != null);
  const legBone = {};
  for (const k of ['thighL', 'thighR', 'shankL', 'shankR']) { const sg = k.slice(0, -1); legBone[k] = LEN.tape[k] != null ? boneFromTape(sg, LEN.tape[k], H, sex) : defLegBone[sg]; }
  const chainY = (S, kz = 0) => {
    const kneeZ = LZ.knee + kz, ky = ankleY0 + vdrop(legBone['shank' + S], LX.knee - LX.ankle, kneeZ - LZ.ankle);
    return { knee: ky, hip: ky + vdrop(legBone['thigh' + S], LX.hip - LX.knee, LZ.hip - kneeZ), kneeZ, kneeFlex: kz };
  };
  const legS = { L: { knee: kneeY0, hip: hipY0, kneeZ: LZ.knee, kneeFlex: 0 }, R: { knee: kneeY0, hip: hipY0, kneeZ: LZ.knee, kneeFlex: 0 } };
  const pelvis = { obliquityIn: 0, tiltDeg: 0, kneeFlexIn: { L: 0, R: 0 }, legScale: 1 };
  if (legGiven) {
    const solve = () => { legS.L = chainY('L'); legS.R = chainY('R'); };
    solve();
    // Standing height is measured: the hip joints must leave room for a plausible trunk + neck + head.
    const hip0 = (legS.L.hip + legS.R.hip) / 2, lo = TB.hipRange[0] * H, hi = TB.hipRange[1] * H;
    if (hip0 < lo || hip0 > hi) {
      const target = clamp(hip0, lo, hi);
      for (let i = 0; i < 4; i++) {
        const f = (target - ankleY0) / ((legS.L.hip + legS.R.hip) / 2 - ankleY0);
        for (const k of Object.keys(legBone)) legBone[k] *= f;
        pelvis.legScale *= f;
        solve();
      }
      warnings.push(`The leg lengths put the hip joints at ${fmtIn(hip0)} in, ${hip0 > hi ? 'too high' : 'too low'} for a standing height of ${fmtIn(H)} in (plausible ${lo.toFixed(1)}–${hi.toFixed(1)} in). The legs were scaled by ${Math.round(pelvis.legScale * 100)}% to fit; re-check the leg lengths and your height.`);
    }
    // Per-side difference → pelvic obliquity, limited; the longer knee flexes slightly for any excess.
    const maxOb = MAX_OBLIQUITY * s, diff = legS.L.hip - legS.R.hip;
    if (Math.abs(diff) > maxOb) {
      const S = diff > 0 ? 'L' : 'R', O = S === 'L' ? 'R' : 'L', target = legS[O].hip + maxOb;
      let lo2 = 0, hi2 = 0.9 * Math.min(legBone['thigh' + S], legBone['shank' + S]);
      for (let i = 0; i < 40; i++) { const m = (lo2 + hi2) / 2; if (chainY(S, m).hip > target) lo2 = m; else hi2 = m; }
      legS[S] = chainY(S, (lo2 + hi2) / 2);
      warnings.push(`Your ${S === 'L' ? 'left' : 'right'} leg measures ${fmtIn(Math.abs(diff))} in longer (joint centres). Over ~0.8 in (2 cm) is uncommon: the model tilts the pelvis by ${fmtIn(maxOb)} in and bends the longer knee slightly for the rest. Re-measure both legs; a real difference this large is worth a professional check.`);
    }
    pelvis.obliquityIn = legS.L.hip - legS.R.hip;
    pelvis.tiltDeg = Math.atan2(pelvis.obliquityIn, 2 * LX.hip) * 180 / Math.PI;
    pelvis.kneeFlexIn = { L: legS.L.kneeFlex, R: legS.R.kneeFlex };
  }
  const hipAvgY = (legS.L.hip + legS.R.hip) / 2, dHip = hipAvgY - hipY0;
  const torsoMap = legGiven && Math.abs(dHip) > 1e-9;
  const kT = (chinY - hipAvgY) / (chinY - hipY0);
  // Trunk + neck between the hip joints and the chin stretch/compress; the pelvis below translates.
  const tMap = y => (!torsoMap || y >= chinY ? y : y >= hipY0 ? chinY - (chinY - y) * kT : y + dHip);
  const hy = k => tMap(HT[k] * H);
  const LJ = {};
  for (const S of ['L', 'R']) LJ[S] = { id: !legGiven, hip: { x: LX.hip, y: legS[S].hip, z: 0 }, knee: { x: LX.knee, y: legS[S].knee, z: legS[S].kneeZ }, ankle: { x: LX.ankle, y: ankleY0, z: LZ.ankle } };
  LJ.avg = { id: !legGiven, hip: { x: LX.hip, y: hipAvgY, z: 0 }, knee: { x: LX.knee, y: (legS.L.knee + legS.R.knee) / 2, z: (legS.L.kneeZ + legS.R.kneeZ) / 2 }, ankle: LJ.L.ankle };
  // Default (ratio-model) leg height → this side's height (linear within each segment).
  const legMap = J => y0 => (J.id ? y0 : y0 >= hipY0 ? y0 + (J.hip.y - hipY0) : y0 >= kneeY0 ? lerp(J.knee.y, J.hip.y, (y0 - kneeY0) / (hipY0 - kneeY0))
    : y0 >= ankleY0 ? lerp(J.ankle.y, J.knee.y, (y0 - ankleY0) / (kneeY0 - ankleY0)) : y0);

  // ---- arms: flexed tape → relaxed hanging girth. ANSUR: relaxed upper-arm ≈ 0.93 × flexed biceps;
  // the gap grows with arm muscularity. Clenched-fist forearm ≈ 1.03 × relaxed.
  const flexArm = 1 / clamp(0.935 - 0.04 * (mu.arms - 0.5) + 0.002 * (bf - 20), 0.86, 0.97);
  const flexFore = 1.03;
  const limbs = a.limbs && typeof a.limbs === 'object' ? a.limbs : {};
  const side = (site, S) => { const v = pos(limbs[site + S]); return v || g[site]; };

  // ---- torso sections (tape sites). Aspect = depth/breadth (rz/rx); n = superellipse exponent.
  // [AN]/[NA] chest depth/breadth ≈ 0.75, waist (omphalion) ≈ 0.72–0.80 rising with fat, buttock depth /
  // hip breadth ≈ 0.70. The tape bridges the spinal groove and the flat back/front, so the torso is a
  // rounded rectangle (n > 2); n is set so breadths land on ANSUR medians for median girths.
  const aspect = {
    neck: 0.93,                                                                        // [AN] neck depth ≈ breadth
    chest: clamp(K.chestAsp * (0.75 + 0.003 * (bf - 15) + 0.05 * (mu.chest - 0.5) - 0.03 * (mu.lats - 0.5)), 0.62, 0.95),
    underbust: clamp(0.76 + 0.004 * (bf - 15) - 0.08 * (mu.lats - 0.5), 0.62, 0.98),
    // [AN] waist depth/breadth ≈ 0.73 at the survey's typical ≈ 22 % BF; lean ≈ 0.65, obese ≥ 0.85 (belly grows forward).
    waist: clamp(K.waistAsp * (0.66 + 0.006 * (bf - 10) + 0.0003 * Math.max(0, bf - 20) ** 2 - 0.02 * (mu.abs - 0.5)), 0.6, 1.0),
    hip: clamp(K.hipAsp * (0.70 + 0.003 * (bf - 15) + 0.06 * (mu.quads - 0.5)), 0.6, 0.9),         // glutes (quads score as proxy) → deeper
    thigh: clamp(0.95 + 0.04 * (mu.quads - 0.5), 0.88, 1.05),
    knee: 0.95, calf: clamp(1.02 + 0.06 * (mu.calves - 0.5), 0.95, 1.1), ankle: 0.95,
    arm: clamp(1.08 + 0.08 * (mu.arms - 0.5), 1.0, 1.2),          // upper arm deeper front-to-back (biceps/triceps)
    armFlex: clamp(1.14 + 0.08 * (mu.arms - 0.5), 1.05, 1.25),   // flexed peak
    elbow: 0.85,                                                  // epicondyles are side-to-side
    forearm: 1.06,                                                // neutral (palms in): radius/ulna front-to-back
    wrist: 1.45,                                                  // neutral wrist: [AN] wrist breadth/depth ≈ 1.45
  };
  const N = {
    neck: 2.0, chest: 3.2, underbust: 3.0, waist: clamp(2.6 - 0.015 * (bf - 10), 2.2, 2.75), hip: 2.8, crotch: 2.5,
    thigh: 2.0, knee: 2.2, calf: 2.0, ankle: 2.2, arm: 2.0, elbow: 2.2, forearm: 2.0, wrist: 2.3,
  };
  // Underbust (lower chest, lats): between chest and waist; wider lats keep it closer to chest.
  // Female: the chest tape is the BUST (fullest, over the bust point) and the underbust is the ribcage at the
  // inframammary fold (bra band): a model value from the bust and body fat, or an optional `underbust` tape.
  const ubTape = FEM ? pos(a.underbust) : null;
  const underbustG = FEM ? clamp(ubTape || g.chest * clamp(0.862 + 0.0035 * (28 - bf), 0.78, 0.95), g.chest * 0.7, g.chest - 0.25)
    : g.waist + (g.chest - g.waist) * clamp(0.62 + 0.16 * (mu.lats - 0.5), 0.5, 0.75);
  if (FEM && ubTape && ubTape >= g.chest - 0.25) warnings.push(`Underbust (${ubTape}) should be smaller than the bust (${g.chest}): measure it snug under the breasts, the bust over the fullest part.`);
  // inframammary fold height (female): 0.030 H + 0.22 × (bust − underbust) below the bust point
  const ubY = FEM ? tMap(HT.chest * H - (0.030 * H + 0.22 * (g.chest - underbustG))) : null;
  const sec = {
    neck: solveSection(g.neck, aspect.neck, N.neck),
    chest: solveSection(g.chest, aspect.chest, N.chest),
    underbust: solveSection(underbustG, aspect.underbust, N.underbust),
    waist: solveSection(g.waist, aspect.waist, N.waist),
    hip: solveSection(g.hips, aspect.hip, N.hip),
  };

  // ---- shoulders tape: convex loop around the upper torso and both arms at deltoid level.
  // Lateral reach of the deltoid beyond the acromion: [AN] (bideltoid − biacromial)/2 ≈ (49.0 − 39.7)/2 cm
  // ≈ 1.83 in for the median man; more with bigger delts and more fat. The acromion's lateral tip sits
  // ≈ 0.35 in lateral of the GH centre [NY], so the arm's lateral reach from the GH centre = offset + 0.35.
  const delOffset = 1.83 * s * K.delt * clamp(1 + 0.35 * (mu.delts - 0.5) + 0.012 * (bf - 20), 0.75, 1.35);
  const acrGH = 0.35 * s;
  const ax = delOffset + acrGH, az = ax * clamp(1.05 + 0.08 * (mu.delts - 0.5), 0.95, 1.15);
  // (female: the loop passes above the breasts, so the torso depth there is the ribcage's, ≈ 0.9 × underbust depth;
  //  this reproduces [AN2F] median biacromial / shoulder circumference with the same relative error as the male loop)
  const Tz = FEM ? sec.underbust.rz * 0.9 : sec.chest.rz * 0.93, Tn = 2.8;
  const loopAt = c => shoulderLoop(c, c + 0.3 * acrGH, Tz, Tn, ax, az);
  // Skeletal plausibility: biacromial ≈ 0.20–0.255 H ([AN] 1st–99th pct ≈ 36–44.5 cm at 175 cm).
  const cMin = K.cMin * H - acrGH, cMax = K.cMax * H - acrGH;
  let c;
  if (!given.shoulders) {
    // No shoulders tape: biacromial from stature ([AN] median 39.7–40.9 cm at 175.6 cm ≈ 0.229 H; it grows less
    // than proportionally with height, exponent ≈ 0.75), wider with traps/delts development; tape = the loop.
    const biac = K.biac * K.biacRef * Math.pow(H / K.biacRef, 0.75) * (1 + 0.03 * (mu.delts - 0.5) + 0.02 * (mu.traps - 0.5));
    c = biac / 2 - acrGH;
    g.shoulders = Math.round(loopAt(c).perimeter * 10) / 10;
  } else {
    let lo = cMin * 0.6, hi = cMax * 1.25;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (loopAt(m).perimeter < g.shoulders) lo = m; else hi = m; }
    c = (lo + hi) / 2;
  }
  if (c < cMin || c > cMax) {
    warnings.push(`Shoulders tape (${g.shoulders}) implies a ${c < cMin ? 'narrower' : 'wider'} shoulder frame (biacromial ${(2 * (c + acrGH)).toFixed(1)} in) than adults of this height; the skeleton was clamped to ${c < cMin ? 'the narrowest' : 'the widest'} plausible frame and the tape is still matched.`);
    c = clamp(c, cMin, cMax);
  }
  const loop = loopAt(c);
  const bideltoid = 2 * loop.halfWidth, biacromial = 2 * (c + acrGH);
  let shoulderSec;
  {
    const rx = loop.halfWidth, rz = loop.halfDepth;
    const n = solveN(rx, rz, g.shoulders);
    if (n != null) shoulderSec = { rx, rz, n, girth: perimeter(rx, rz, n) };
    else {
      // Tape is not reachable with this width/depth (clamped frame): keep the width, solve the depth at n=2.5.
      let lo2 = 0.05, hi2 = rx * 2;
      for (let i = 0; i < 50; i++) { const m = (lo2 + hi2) / 2; if (perimeter(rx, m, 2.5) < g.shoulders) lo2 = m; else hi2 = m; }
      const rz2 = (lo2 + hi2) / 2;
      shoulderSec = perimeter(rx, rz2, 2.5) > g.shoulders * 1.005 || rz2 < 0.06
        ? solveSection(g.shoulders, 0.5, 2.5) : { rx, rz: rz2, n: 2.5, girth: perimeter(rx, rz2, 2.5) };
    }
  }
  const torsoShoulder = { rx: c + 0.3 * acrGH, rz: Tz, n: Tn };
  torsoShoulder.girth = perimeter(torsoShoulder.rx, torsoShoulder.rz, Tn);

  // ---- sagittal centres
  // Reference depth per site: the reference body's tape scaled to this height, at reference fat/muscle.
  const refR = REF[sex], hs = H / refR.h;
  const refRz = {
    chest: solveSection(refR.chest * hs, K.chestAsp * 0.75, N.chest).rz,
    underbust: solveSection((FEM ? refR.chest * 0.862 : refR.waist + (refR.chest - refR.waist) * 0.62) * hs, 0.76 + 0.004 * (refR.bf - 15), N.underbust).rz,
    waist: solveSection(refR.waist * hs, K.waistAsp * (0.66 + 0.006 * (refR.bf - 10)), N.waist).rz,
    hip: solveSection(refR.hips * hs, K.hipAsp * (0.70 + 0.003 * (refR.bf - 15)), N.hip).rz,
  };
  const czOf = Object.fromEntries(Object.entries(TB.ZC).map(([k, [c0, bias]]) => [k, c0 * H + bias * (sec[k].rz - refRz[k])]));

  // ---- legs (per side). Joint line: hip → knee → ankle (LJ.L / LJ.R / LJ.avg above).
  // Interior samples between tape sites (girth as a fraction of the nearest tape). Knee, ankle, wrist and
  // elbow use the ANSUR ratios above; mid-thigh ≈ 0.88 × upper thigh ([AN] mid-thigh vs thigh circumference);
  // the remaining taper points (lower thigh, upper/lower calf, shin, lower upper-arm, lower forearm) follow a
  // typical adult male limb taper and only shape the curve between measured sites (approximate).
  const legSamples = (thighG, calfG, legJ) => {
    const mapY = legMap(legJ);
    const legLine = y => {
      const [A, B] = y >= legJ.knee.y ? [legJ.hip, legJ.knee] : [legJ.knee, legJ.ankle];
      const t = (A.y - y) / (A.y - B.y);
      return { x: lerp(A.x, B.x, t), z: lerp(A.z, B.z, t) };
    };
    const kneeG = 0.5 * (0.99 * calfG + 0.63 * thighG), ankleG = 0.5 * (K.ankleCalf * calfG + K.ankleH * H);
    const qd = 0.03 * (mu.quads - 0.5), cv = 0.03 * (mu.calves - 0.5);
    const rows = [   // [name, y/H, girth, aspect, n]
      ['legTop', fy(0.505), thighG * 1.07, aspect.thigh, 2.0],
      ['thigh', HT.thigh, thighG, aspect.thigh, N.thigh],
      ['midThigh', fy(0.400), thighG * (0.885 + qd), aspect.thigh, 2.0],      // ≈ [AN] mid-thigh / upper-thigh ≈ 0.88
      ['lowerThigh', fy(0.345), thighG * (0.765 + qd), 0.97, 2.0],
      ['aboveKnee', fy(0.312), Math.max(kneeG * 1.02, thighG * 0.66), 0.95, 2.1],
      ['knee', HT.knee, kneeG, aspect.knee, N.knee],
      ['upperCalf', fy(0.250), calfG * (0.93 - cv), aspect.calf, 2.0],
      ['calf', HT.calf, calfG, aspect.calf, N.calf],
      ['lowerCalf', fy(0.150), calfG * (0.84 + cv), 1.0, 2.0],
      ['shin', fy(0.100), calfG * 0.70, 0.98, 2.1],
      ['ankle', HT.ankle, ankleG, aspect.ankle, N.ankle],
    ];
    const out = rows.map(([name, f, G, k, n]) => {
      const y = mapY(f * H), ss = solveSection(G, k, n), L = legLine(Math.min(y, legJ.hip.y));
      return { name, y, rx: ss.rx, rz: ss.rz, n, cx: L.x, cz: L.z, girth: ss.girth };
    });
    // The upper thighs press together and are flattened medially (adductors), so their soft-tissue centre
    // sits medial of the femur line and the outer contour stays inside the hip breadth ([AN]: two round
    // upper thighs side by side would be ≈ 15 % wider than hip breadth). Shift the top medially, fading out
    // by mid-thigh; the overlap of the two thigh sections stands in for the flattened inner faces.
    const byName = Object.fromEntries(out.map(p => [p.name, p]));
    // The calf muscles sit behind the tibia, so the lower-leg soft tissue is centred posterior of the
    // knee–ankle line (the shin is close to the bone).
    for (const [nm, f] of [['upperCalf', 0.2], ['calf', 0.25], ['lowerCalf', 0.18], ['shin', 0.1]]) byName[nm].cz -= f * byName[nm].rz;
    const shiftThigh = Math.max(0, byName.thigh.cx + byName.thigh.rx - sec.hip.rx * 0.98);
    byName.thigh.cx -= shiftThigh;
    byName.midThigh.cx -= shiftThigh * 0.4;
    const top = byName.legTop;
    top.cx -= shiftThigh;
    const roomTop = sec.hip.rx * 0.97 - top.cx;
    if (top.rx > roomTop) { const f = Math.max(roomTop, byName.thigh.rx) / top.rx; top.rx *= f; top.rz *= f; top.girth = perimeter(top.rx, top.rz, top.n); }
    return out.sort((p, q) => p.y - q.y);
  };
  const legL = legSamples(side('thigh', 'L'), side('calf', 'L'), LJ.L);
  const legR = legSamples(side('thigh', 'R'), side('calf', 'R'), LJ.R);
  const legAvg = legSamples(g.thigh, g.calf, LJ.avg);

  // ---- torso profile (cx = 0)
  const neckZ = Z.neck * H;
  const slope = (20 + 8 * (mu.traps - 0.5)) * Math.PI / 180;   // neck-to-acromion shoulder line ≈ 20° (traps raise it)
  const acrX = biacromial / 2;
  const neckBaseY = Math.min(hy('acromion') + Math.tan(slope) * (acrX - sec.neck.rx), hy('neck') - 0.002 * H);
  // Crotch: bottom of the trunk; the thighs (legL/legR) carry the outer contour below the hips.
  const crotchSec = { rx: sec.hip.rx * 0.95, rz: sec.hip.rz * 0.85, n: N.crotch };
  crotchSec.girth = perimeter(crotchSec.rx, crotchSec.rz, crotchSec.n);
  const T = (name, y, S, cz) => ({ name, y, rx: S.rx, rz: S.rz, n: S.n, cx: 0, cz, girth: S.girth ?? perimeter(S.rx, S.rz, S.n) });
  const trapT = 0.42 + 0.25 * mu.traps;
  const torso = [
    T('crotch', hy('crotch'), crotchSec, Z.crotch * H),
    T('hip', hy('hip'), sec.hip, czOf.hip),
    T('hipJoint', hy('hipJoint'), { rx: lerp(sec.hip.rx, sec.waist.rx, K.hipJointLerp), rz: lerp(sec.hip.rz, sec.waist.rz, K.hipJointLerp), n: lerp(N.hip, N.waist, K.hipJointLerp) }, lerp(czOf.hip, czOf.waist, K.hipJointLerp)),
    T('waist', hy('waist'), sec.waist, czOf.waist),
    T('underbust', FEM ? ubY : hy('underbust'), sec.underbust, czOf.underbust),
    T('chest', hy('chest'), sec.chest, czOf.chest),
    T('axilla', hy('axilla'), { rx: sec.chest.rx * 1.01, rz: sec.chest.rz * 0.98, n: N.chest }, lerp(czOf.chest, Z.shoulder * H, 0.4)),
    T('shoulder', hy('deltoid'), torsoShoulder, Z.shoulder * H),
    T('acromion', hy('acromion'), { rx: acrX * 0.96, rz: sec.chest.rz * 0.70, n: 2.6 }, Z.acromion * H),
    T('trap', lerp(hy('acromion'), neckBaseY, 0.55), { rx: lerp(sec.neck.rx * 1.1, acrX * 0.96, trapT), rz: lerp(sec.neck.rz * 1.15, sec.chest.rz * 0.7, 0.45), n: 2.3 }, Z.trap * H),
    T('neckBase', neckBaseY, { rx: sec.neck.rx * 1.12 * K.neckBase, rz: sec.neck.rz * 1.12 * K.neckBase, n: 2.1 }, Z.neckBase * H),
  ];

  // ---- neck & head
  const chinSec = { rx: sec.neck.rx * 1.0, rz: 0.046 * H, n: 2.2 };
  const neck = [
    // starts inside the trapezius (overlaps the torso top) so the two parts blend
    T('neckBase', lerp(hy('acromion'), neckBaseY, 0.55), { rx: sec.neck.rx * 1.18 * K.neckBase, rz: sec.neck.rz * 1.15 * K.neckBase, n: 2.1 }, Z.neckBase * H),
    T('neck', hy('neck'), sec.neck, neckZ),
    T('chin', hy('chin'), chinSec, Z.chin * H),
  ];
  const HD = TB.HEAD;
  const head = { center: { x: 0, y: hy('headCenter'), z: Z.head * H }, rx: HD.rx * H, ry: HD.ry * H, rz: HD.rz * H,
    circumference: perimeter(HD.rx * H, HD.rz * H, 2) };
  // keep the ellipsoid inside vertex..chin
  head.ry = Math.min(head.ry, H - head.center.y, head.center.y - hy('chin') + 0.02 * H);

  const torsoAt = y => interpProfile(torso, y);

  // ---- arms (per side). Shoulder joint from the loop; elbow/wrist abducted just enough to clear the torso.
  // Per-side elbow/wrist heights come from the (measured or ratio) bone lengths; J.map moves a default
  // rest-pose arm height onto this side's segments.
  const shoulderY = hy('shoulderJoint');
  const sh0 = HT.shoulderJoint * H, el0 = HT.elbow * H, wr0 = HT.wrist * H;
  const mkJ = (up, fo, foreLen, id) => {
    const ey = id ? el0 : shoulderY - up, wy = id ? wr0 : ey - fo;
    return { id, up, fo, foreLen, sy: shoulderY, ey, wy, wz: Math.sin(8 * Math.PI / 180) * foreLen,   // relaxed elbow ≈ 8° flexed
      map: y0 => (id ? y0 : y0 >= sh0 ? tMap(y0) : y0 >= el0 ? lerp(shoulderY, ey, (sh0 - y0) / (sh0 - el0))
        : y0 >= wr0 ? lerp(ey, wy, (el0 - y0) / (el0 - wr0)) : wy - (wr0 - y0)) };
  };
  const armSamples = (armFlexG, foreFlexG, J) => {
    const elbowY = J.ey, wristY = J.wy, axY = J.map(HT.axilla * H);
    const armG = armFlexG / flexArm, foreG = foreFlexG / flexFore;
    const elbowG = 0.5 * (0.91 * foreG + 0.78 * armG), wristG = 0.5 * (K.wristFore * foreG + K.wristH * H);
    const rows = [   // [name, y, girth|section, aspect, n]
      ['armTop', hy('acromion') + 0.006 * H, null, null, 2.0],   // deltoid cap closes just above the acromion
      ['deltoid', hy('deltoid'), null, null, 2.0],
      ['axilla', axY, armG * (1.03 + 0.03 * (mu.delts - 0.5)), aspect.arm, 2.0],
      ['arm', J.map(fyA(0.725) * H), armG, aspect.arm, N.arm],
      ['lowerArm', J.map(fyA(0.672) * H), armG * 0.88, aspect.arm * 0.97, 2.0],
      ['elbow', elbowY, elbowG, aspect.elbow, N.elbow],
      ['forearm', J.map(HT.forearm * H), foreG, aspect.forearm, N.forearm],
      ['lowerForearm', J.map(fyA(0.535) * H), foreG * 0.78, 1.2, 2.1],
      ['wrist', wristY, wristG, aspect.wrist, N.wrist],
    ];
    const out = rows.map(([name, y, G, k, n]) => {
      let S;
      if (name === 'deltoid') S = { rx: ax, rz: az, n: 2, girth: perimeter(ax, az, 2) };
      else if (name === 'armTop') S = { rx: ax * 0.55, rz: az * 0.6, n: 2, girth: perimeter(ax * 0.55, az * 0.6, 2) };
      else S = solveSection(G, k, n);
      return { name, y, rx: S.rx, rz: S.rz, n: S.n, cx: 0, cz: 0, girth: S.girth };
    });
    // Clearance: upper-arm centre ≥ torso half-width + arm half-width − 0.25 in of soft contact.
    // ([AN] forearm-forearm breadth ≈ 54.6 cm puts the median elbow centre ≈ 9.1 in from the midline.)
    const contact = 0.45 * s;
    let ex = c + 0.3 * s;
    for (const p of out) {
      if (p.y > axY + 1e-9 || p.y < elbowY) continue;
      const t = (shoulderY - p.y) / (shoulderY - elbowY);
      if (t < 0.3) continue;
      const tor = torsoAt(p.y);
      if (!tor) continue;
      ex = Math.max(ex, c + (tor.rx + p.rx - contact - c) / t);
    }
    ex = Math.min(ex, c + Math.tan(25 * Math.PI / 180) * (shoulderY - elbowY));
    // Forearm + hand clear the hips/thighs.
    const handY = wristY - 0.5 * SR.hand * H, handHalf = 0.5 * SR.handThickness * H;
    let wx = -Infinity;
    const lateralAt = y => {
      const tor = y >= hy('crotch') ? torsoAt(y) : null;
      const leg = interpProfile(legAvg, y);
      return Math.max(tor ? tor.rx : 0, leg ? leg.cx + leg.rx : 0);
    };
    for (const p of out) {
      if (p.y >= elbowY) continue;
      const t = (elbowY - p.y) / (elbowY - wristY);
      wx = Math.max(wx, ex + (lateralAt(p.y) + p.rx - 0.25 * s - ex) / t);
    }
    {
      const t = (elbowY - handY) / (elbowY - wristY);
      wx = Math.max(wx, ex + (lateralAt(handY) + handHalf + 0.1 * s - ex) / t);
    }
    // Relaxed hands hang beside the thighs: the forearm may angle inward (≤ 12°) or outward (≤ 20°).
    wx = clamp(wx, ex - Math.tan(12 * Math.PI / 180) * (elbowY - wristY), ex + Math.tan(20 * Math.PI / 180) * (elbowY - wristY));
    const ez = 0, wz = J.wz;
    const lineAt = y => {
      if (y >= shoulderY) return { x: c, z: 0 };
      if (y >= elbowY) { const t = (shoulderY - y) / (shoulderY - elbowY); return { x: lerp(c, ex, t), z: lerp(0, ez, t) }; }
      const t = (elbowY - y) / (elbowY - wristY); return { x: lerp(ex, wx, t), z: lerp(ez, wz, t) };
    };
    for (const p of out) { const L = lineAt(p.y); p.cx = L.x; p.cz = L.z; }
    out.sort((p, q) => p.y - q.y);
    return { samples: out, ex, wx, ez, wz, armG, foreG, elbowG, wristG, J };
  };
  // Measured bones are honoured in 3D: the vertical drop is re-solved for the abduction the clearance
  // logic produces (converges in 2–3 passes; the drop barely moves ex/wx).
  const armSide = (S, armFlexG) => {
    const kU = 'upperArm' + S, kF = 'forearm' + S, gU = LEN.tape[kU] != null, gF = LEN.tape[kF] != null;
    const id = !torsoMap && !gU && !gF;
    const BU = gU ? boneFromTape('upperArm', LEN.tape[kU], H, sex) : null, BF = gF ? boneFromTape('forearm', LEN.tape[kF], H, sex) : null;
    let up = sh0 - el0, fo = el0 - wr0;
    const fl = gF ? BF : SR.forearm * H;
    let A = armSamples(armFlexG, g.forearm, mkJ(up, fo, fl, id));
    for (let i = 0; i < 3 && (gU || gF); i++) {
      if (gU) up = vdrop(BU, A.ex - c, A.ez);
      if (gF) fo = vdrop(BF, A.wx - A.ex, A.wz - A.ez);
      A = armSamples(armFlexG, g.forearm, mkJ(up, fo, fl, id));
    }
    return A;
  };
  const armLs = armSide('L', side('arm', 'L'));
  const armRs = armSide('R', side('arm', 'R'));
  const JL = armLs.J, JR = armRs.J;
  const armAvg = armSamples(g.arm, g.forearm, mkJ((JL.up + JR.up) / 2, (JL.fo + JR.fo) / 2, (JL.foreLen + JR.foreLen) / 2, JL.id && JR.id));

  // ---- joints
  const fingerY = hy('fingertip');
  const mk = (x, y, z) => ({ x, y, z });
  const joints = {
    head: mk(0, fy(0.915) * H, 0),                    // atlanto-occipital ≈ just below the tragion
    neck: mk(0, tMap(fy(0.833) * H), Z.neckBase * H),     // C7/T1, base of the neck
    chest: mk(0, hy('chest'), czOf.chest - 0.3 * sec.chest.rz),   // mid-thorax, slightly posterior (near the spine's curve)
    pelvis: mk(0, hy('hipJoint'), 0),
  };
  for (const [S, sg, A] of [['L', 1, armLs], ['R', -1, armRs]]) {
    const elbowY = A.J.ey, wristY = A.J.wy, legJ = LJ[S];
    joints['shoulder' + S] = mk(sg * c, shoulderY, 0);
    joints['elbow' + S] = mk(sg * A.ex, elbowY, A.ez);
    joints['wrist' + S] = mk(sg * A.wx, wristY, A.wz);
    const dx = A.wx - A.ex, dz = A.wz - A.ez, dy = elbowY - wristY, len = Math.hypot(dx, dy, dz);
    const hl = SR.hand * H;
    joints['hand' + S] = mk(sg * (A.wx + dx / len * hl), wristY - dy / len * hl, A.wz + dz / len * hl);   // fingertip
    joints['hip' + S] = mk(sg * legJ.hip.x, legJ.hip.y, 0);
    joints['knee' + S] = mk(sg * legJ.knee.x, legJ.knee.y, legJ.knee.z);
    joints['ankle' + S] = mk(sg * legJ.ankle.x, legJ.ankle.y, legJ.ankle.z);
    const fl = SR.foot * H;
    joints['heel' + S] = mk(sg * legJ.ankle.x, 0, legJ.ankle.z - Z.heelBack * fl);
    joints['toe' + S] = mk(sg * (legJ.ankle.x + Math.sin(7 * Math.PI / 180) * fl * 0.78), 0, legJ.ankle.z - Z.heelBack * fl + fl * Math.cos(7 * Math.PI / 180));
  }
  void fingerY;
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  const bones = { foot: SR.foot * H, spine: dist(joints.pelvis, joints.neck), neck: dist(joints.neck, joints.head) };
  for (const S of ['L', 'R']) {
    bones['upperArm' + S] = dist(joints['shoulder' + S], joints['elbow' + S]);
    bones['forearm' + S] = dist(joints['elbow' + S], joints['wrist' + S]);
    bones['hand' + S] = dist(joints['wrist' + S], joints['hand' + S]);
    bones['thigh' + S] = dist(joints['hip' + S], joints['knee' + S]);
    bones['shank' + S] = dist(joints['knee' + S], joints['ankle' + S]);
  }
  for (const k of ['upperArm', 'forearm', 'hand', 'thigh', 'shank']) bones[k] = (bones[k + 'L'] + bones[k + 'R']) / 2;
  // Tape lengths used (measured / mirrored) or implied by the ratio skeleton.
  const lengths = {};
  for (const k of LENGTH_FIELDS) {
    const scaled = pelvis.legScale !== 1 && /^(thigh|shank)/.test(k);
    lengths[k] = LEN.tape[k] != null && !scaled ? LEN.tape[k] : tapeFromBone(k.slice(0, -1), bones[k], H, sex);
  }
  const landmarkOffsets = Object.fromEntries(LENGTH_SEGMENTS.map(k => [k, TB.LO[k] * H]));
  const segments = Object.fromEntries(Object.entries(SR).map(([k, f]) => [k, f * H]));

  // ---- landmarks (limbs: left side, averaged tape)
  const fromP = (p, extra) => ({ y: p.y, rx: p.rx, rz: p.rz, n: p.n, cx: p.cx, cz: p.cz, girth: perimeter(p.rx, p.rz, p.n), ...(extra || {}) });
  const tp = name => torso.find(p => p.name === name);
  const lg = name => legAvg.find(p => p.name === name);
  const am = name => armAvg.samples.find(p => p.name === name);
  const armTape = solveSection(g.arm, aspect.armFlex, N.arm);
  const foreTape = solveSection(g.forearm, aspect.forearm * 0.98, N.forearm);
  const landmarks = {
    vertex: { y: H, rx: 0, rz: 0, n: 2, cx: 0, cz: head.center.z, girth: 0 },
    chin: fromP(neck.find(p => p.name === 'chin')),
    neck: fromP(neck.find(p => p.name === 'neck')),
    shoulder: { y: hy('deltoid'), rx: shoulderSec.rx, rz: shoulderSec.rz, n: shoulderSec.n, cx: 0, cz: Z.shoulder * H,
      girth: perimeter(shoulderSec.rx, shoulderSec.rz, shoulderSec.n), includesArms: true,
      torso: { rx: torsoShoulder.rx, rz: torsoShoulder.rz, n: torsoShoulder.n, cx: 0, cz: Z.shoulder * H, girth: torsoShoulder.girth } },
    chest: fromP(tp('chest')),
    underbust: fromP(tp('underbust')),
    waist: fromP(tp('waist')),
    hip: fromP(tp('hip')),
    crotch: fromP(tp('crotch')),
    thigh: fromP(lg('thigh')),
    knee: fromP(lg('knee')),
    calf: fromP(lg('calf')),
    ankle: fromP(lg('ankle')),
    arm: { ...fromP(am('arm')), rx: armTape.rx, rz: armTape.rz, n: armTape.n, girth: armTape.girth, flexed: true,
      relaxed: { rx: am('arm').rx, rz: am('arm').rz, n: am('arm').n, girth: am('arm').girth } },
    elbow: fromP(am('elbow')),
    forearm: { ...fromP(am('forearm')), rx: foreTape.rx, rz: foreTape.rz, n: foreTape.n, girth: foreTape.girth, flexed: true,
      relaxed: { rx: am('forearm').rx, rz: am('forearm').rz, n: am('forearm').n, girth: am('forearm').girth } },
    wrist: fromP(am('wrist')),
  };

  const sideOut = (A, Lg) => ({
    arm: { flexedGirth: A.armG * flexArm, relaxedGirth: A.armG }, forearmGirth: A.foreG * flexFore,
    thigh: fromP(Lg.find(p => p.name === 'thigh')), calf: fromP(Lg.find(p => p.name === 'calf')), knee: fromP(Lg.find(p => p.name === 'knee')),
  });
  const mirror = prof => prof.map(p => ({ ...p, cx: -p.cx }));

  const heights = Object.fromEntries(Object.entries(HT).map(([k, f]) => [k, tMap(f * H)]));
  for (const k of ['elbow', 'forearm', 'wrist', 'fingertip']) heights[k] = armAvg.J.map(HT[k] * H);   // L/R average
  for (const k of ['thigh', 'knee', 'calf', 'ankle']) heights[k] = legMap(LJ.avg)(HT[k] * H);
  // (female: the waist tape is the natural waist, ≈ 1.8 in above the navel; bust point = nipple; fold = underbust)
  heights.nipple = heights.chest; heights.navel = FEM ? tMap(HT.navel * H) : heights.waist; heights.trochanter = heights.hipJoint; heights.neckBase = neckBaseY;
  if (FEM) heights.underbust = ubY;

  const geom = {
    heightIn: H, units: 'in', sex,
    bodyFatPct: bf, muscle: mu,
    inputs: g,
    landmarks,
    segments, bones, joints, heights, head,
    breadths: {
      biacromial: biacromial, bideltoid, chest: 2 * sec.chest.rx, waist: 2 * sec.waist.rx, hip: 2 * sec.hip.rx,
      neck: 2 * sec.neck.rx, thigh: 2 * lg('thigh').rx, calf: 2 * lg('calf').rx, arm: 2 * am('arm').rx,
      chestDepth: 2 * sec.chest.rz, waistDepth: 2 * sec.waist.rz, hipDepth: 2 * sec.hip.rz, shoulderLoopDepth: 2 * shoulderSec.rz,
    },
    derived: {
      underbust: underbustG, knee: legAvg.find(p => p.name === 'knee').girth, ankle: legAvg.find(p => p.name === 'ankle').girth,
      elbow: armAvg.elbowG, wrist: armAvg.wristG, armRelaxed: armAvg.armG, forearmRelaxed: armAvg.foreG,
      deltoidReach: ax, shoulderSlopeDeg: slope * 180 / Math.PI,
      ...(FEM ? { underbustSource: ubTape ? 'tape' : 'model', underbustY: ubY } : {}),
    },
    flex: { arm: flexArm, forearm: flexFore },
    hands: {}, feet: {},
    profiles: { torso, neck, armL: armLs.samples, armR: mirror(armRs.samples), legL, legR: mirror(legR) },
    sides: { L: sideOut(armLs, legL), R: sideOut(armRs, legR) },
    lengths, lengthSource: { ...LEN.source }, asymmetry: lengthAsymmetry(LEN), pelvis, landmarkOffsets,
    estimated, warnings,
  };
  for (const [S, sg] of [['L', 1], ['R', -1]]) {
    geom.hands[S] = { wrist: joints['wrist' + S], tip: joints['hand' + S], length: segments.hand, breadth: segments.handBreadth, thickness: segments.handThickness, palm: 'medial' };
    geom.feet[S] = { ankle: joints['ankle' + S], heel: joints['heel' + S], toe: joints['toe' + S], length: segments.foot, breadth: segments.footBreadth, height: segments.footHeight };
    void sg;
  }
  return geom;
}

const PART_ALIAS = {
  torso: 'torso', neck: 'neck', head: 'head',
  armL: 'armL', upperArmL: 'armL', forearmL: 'armL', elbowL: 'armL', armR: 'armR', upperArmR: 'armR', forearmR: 'armR', elbowR: 'armR',
  legL: 'legL', thighL: 'legL', calfL: 'legL', kneeL: 'legL', shankL: 'legL', legR: 'legR', thighR: 'legR', calfR: 'legR', kneeR: 'legR', shankR: 'legR',
  arm: 'armL', leg: 'legL', thigh: 'legL', calf: 'legL', forearm: 'armL',
};
// Smooth (monotone cubic) cross-section at height y for a body part. null outside the part.
export function crossSectionAt(geom, y, part = 'torso') {
  if (!geom || !fin(Number(y))) return null;
  const key = PART_ALIAS[part] || part;
  if (key === 'head') {
    const h = geom.head, k = 1 - ((y - h.center.y) / h.ry) ** 2;
    if (k < 0) return null;
    const rx = h.rx * Math.sqrt(k), rz = h.rz * Math.sqrt(k);
    return { y, rx, rz, n: 2, cx: 0, cz: h.center.z, girth: perimeter(rx, rz, 2) };
  }
  const prof = geom.profiles?.[key];
  const p = interpProfile(prof, Number(y));
  if (!p) return null;
  p.girth = perimeter(p.rx, p.rz, p.n);
  return p;
}

// Human-readable table of landmarks (y, rx, rz, n, girth vs tape) for review.
export function debugTable(geom) {
  const pad = (v, w) => String(v).padStart(w);
  const f = (v, d = 2) => (fin(v) ? v.toFixed(d) : '-');
  const tape = { neck: 'neck', shoulder: 'shoulders', chest: 'chest', waist: 'waist', hip: 'hips', arm: 'arm', forearm: 'forearm', thigh: 'thigh', calf: 'calf' };
  const lines = [`H=${geom.heightIn} in  BF=${f(geom.bodyFatPct, 1)}%  estimated=[${geom.estimated.join(', ')}]`,
    `${'landmark'.padEnd(10)}${pad('y', 7)}${pad('y/H', 7)}${pad('rx', 7)}${pad('rz', 7)}${pad('n', 6)}${pad('cx', 7)}${pad('cz', 7)}${pad('girth', 8)}${pad('tape', 7)}`];
  for (const name of LANDMARKS) {
    const L = geom.landmarks[name];
    const t = tape[name] ? geom.inputs[tape[name]] : null, est = tape[name] && geom.estimated.includes(tape[name]);
    lines.push(`${name.padEnd(10)}${pad(f(L.y, 1), 7)}${pad(f(L.y / geom.heightIn, 3), 7)}${pad(f(L.rx), 7)}${pad(f(L.rz), 7)}${pad(f(L.n, 2), 6)}${pad(f(L.cx), 7)}${pad(f(L.cz), 7)}${pad(f(L.girth), 8)}${pad(t != null ? (est ? '~' : '') + f(t, 1) : '', 7)}`);
  }
  const b = geom.breadths;
  lines.push(`breadths: biacromial ${f(b.biacromial)}  bideltoid ${f(b.bideltoid)}  chest ${f(b.chest)}×${f(b.chestDepth)}  waist ${f(b.waist)}×${f(b.waistDepth)}  hip ${f(b.hip)}×${f(b.hipDepth)}  thigh Ø ${f(b.thigh)}`);
  const sg = geom.segments, bn = geom.bones;
  lines.push(`segments: upperArm ${f(sg.upperArm)} forearm ${f(sg.forearm)} hand ${f(sg.hand)} thigh ${f(sg.thigh)} shank ${f(sg.shank)} foot ${f(sg.foot)} head ${f(sg.head)}`);
  lines.push(`bones(joint-centre): upperArm ${f(bn.upperArm)} forearm ${f(bn.forearm)} thigh ${f(bn.thigh)} shank ${f(bn.shank)}`);
  const j = geom.joints;
  if (geom.lengthSource && Object.values(geom.lengthSource).some(v => v !== 'ratio'))
    lines.push(`bones L/R: upperArm ${f(bn.upperArmL)}/${f(bn.upperArmR)} forearm ${f(bn.forearmL)}/${f(bn.forearmR)} thigh ${f(bn.thighL)}/${f(bn.thighR)} shank ${f(bn.shankL)}/${f(bn.shankR)}  pelvis tilt ${f(geom.pelvis.tiltDeg, 2)}°`);
  lines.push(`joints L: shoulder (${f(j.shoulderL.x)}, ${f(j.shoulderL.y)}) elbow (${f(j.elbowL.x)}, ${f(j.elbowL.y)}) wrist (${f(j.wristL.x)}, ${f(j.wristL.y)}) hip (${f(j.hipL.x)}, ${f(j.hipL.y)}) knee (${f(j.kneeL.x)}, ${f(j.kneeL.y)}) ankle (${f(j.ankleL.x)}, ${f(j.ankleL.y)})`);
  if (geom.warnings.length) lines.push('warnings: ' + geom.warnings.join(' | '));
  return lines.join('\n');
}

export const _internal = { shoulderLoop, interpProfile, pchipSlopes, solveN, REF, r3 };
