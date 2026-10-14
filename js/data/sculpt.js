// Sculpt goals (CONTRACT §2). Aesthetic targets that bias exercise selection and volume.
// Pure data, DOM-free.
//
// CONTRACT-NOTE: `regions` weights (0-1) say how to split `extraWeeklySets` across regions
// (suggested: extra × weight / sum(weights)). `emphasisTag` always equals the goal id.
//
// Honesty policy: we describe the research consensus. Studies are named only where the
// finding is well established: Maeo et al. 2023 (overhead triceps extensions → more long-head
// growth), Maeo et al. 2021 (seated vs lying leg curls), Pedrosa et al. 2022 (lengthened
// partials on knee extension), Kassiano et al. 2023 (lengthened-partial calf raises),
// Vispute et al. 2011 (ab training doesn't burn belly fat). Schoenfeld et al. 2017 is the
// classic weekly-volume dose-response meta-analysis.

const G = (id, name, group, regions, summary, science, tips, extraWeeklySets) =>
  ({ id, name, group, regions, emphasisTag: id, summary, science, tips, extraWeeklySets });

export const SCULPT_GOALS = {
  // ======================= ARMS =======================
  biceps_peak: G('biceps_peak', 'Biceps Peak', 'biceps',
    { biceps_long: 1, biceps_short: 0.3 },
    'A taller-looking biceps when flexed. Bias the long head with curls done with the arm behind your body, and get lean.',
    'The shape of your peak is mostly genetic. It depends on where the biceps tendon attaches and how long the muscle belly is relative to the tendon. No exercise changes that. Someone with a short belly and long tendon will always have a "higher" peak than someone with a long, full belly, and vice versa. What you CAN change is size, and a bigger biceps always looks more peaked. The long head sits on the outside of the arm and contributes most to the peak from the side. It crosses the shoulder, so it is stretched most when the elbow is behind the torso (incline curls, Bayesian/behind-the-body cable curls). A growing body of research suggests training a muscle at long lengths drives as much or more growth than training it in the shortened position. Long-head bias is real but modest: every curl trains both heads. Low body fat matters too. Arm vascularity and separation become visible around 10-12% body fat.',
    [
      'Lead each arm day with a stretch-position curl: incline DB curl (bench at 45-60°) or Bayesian cable curl (face away from the cable, arm drifting back).',
      'Use a slightly narrower-than-shoulder grip on barbell/EZ curls. Narrow grips bias the long head a little.',
      'Use 8-15 reps with a controlled 2-3 s lowering and a full stretch at the bottom. Don\'t cut the bottom third short.',
      'Lengthened partials (bottom-half reps) after failure on incline curls are a good intensity finisher.',
      'Hit biceps 2-3x per week. 10-14 direct sets per week is plenty with indirect work from rows and pulldowns.',
      'Squeeze hard and supinate (turn the pinky up) at the top. Supination is a main biceps function.',
    ],
    3),

  biceps_width: G('biceps_width', 'Biceps Width', 'biceps',
    { biceps_short: 1, brachialis: 0.6 },
    'A fuller, wider biceps from the front. Bias the short head with arm-in-front curls and build the brachialis underneath.',
    'From the front, arm width comes mostly from the short head of the biceps plus the brachialis pushing out from underneath. The short head does not cross the shoulder the same way the long head does. It is emphasised a little when the arm is in front of the body (preacher, spider, concentration curls) and with a wider grip. These are biases, not isolation. Every curl trains both heads, and total biceps volume matters more than the exact variation. Wider-grip and preacher curls also load the elbow flexors hard in the stretched position, which seems to favour growth.',
    [
      'Include one arm-in-front curl per week: preacher curl (machine, EZ or DB), spider curl on an incline bench, or concentration curl.',
      'Use a grip slightly wider than shoulders on EZ/barbell curls.',
      'Pair with hammer or reverse curls for brachialis. It adds thickness that reads as width.',
      'Preacher curls: lower fully, 3 s down. The bottom is where most of the work happens. Don\'t bounce out of it.',
      'Rep range 8-15. Use cable preacher or machine variants for constant tension.',
    ],
    3),

  arm_thickness: G('arm_thickness', 'Arm Thickness', 'biceps',
    { brachialis: 1, forearms: 0.7, biceps_long: 0.2 },
    'Thicker-looking arms from the side via brachialis and brachioradialis. Neutral and overhand grips.',
    'The brachialis lies under the biceps. When it grows it pushes the biceps outward, so the upper arm looks thicker from the side and the gap between biceps and triceps fills in. The brachioradialis (top of the forearm) connects upper arm and forearm visually. Both muscles work hardest when the forearm is neutral (thumbs up) or pronated (palms down), because the biceps is at a mechanical disadvantage there. This is one of the most reliably trainable "look" changes because it depends far less on genetics than peak shape does.',
    [
      'Hammer curls (DB, rope cable, or cross-body) 2x per week, 8-15 reps.',
      'Add reverse curls (EZ bar or cable, palms down) for brachioradialis, 10-15 reps, strict.',
      'Use slow negatives. These muscles respond well to time under tension and hard lowering.',
      'Neutral-grip pull-ups/pulldowns and rows with a neutral handle add useful indirect work.',
      'Count hammer curls as biceps volume too. They still train the biceps, just less.',
    ],
    3),

  triceps_mass: G('triceps_mass', 'Triceps Mass', 'triceps',
    { triceps_long: 1, triceps_lateral: 0.4, triceps_medial: 0.3 },
    'Bigger arms overall. The triceps is about two-thirds of upper-arm mass, and the long head grows best with overhead work.',
    'If you want bigger arms, the triceps is the main lever because it makes up roughly 60-70% of upper-arm muscle. The long head is the biggest of the three heads and the only one that crosses the shoulder. It is only fully stretched when the arm is overhead. Maeo et al. (2023) compared overhead and arms-down (pushdown-position) cable extensions over 12 weeks. The overhead version produced about 1.4x more long-head growth and more total triceps growth, even though the same weights were moved. That is one of the cleanest real-world demonstrations that training a muscle at long lengths drives growth. Pressing (close-grip bench, dips) is great for strength and lateral-head volume but trains the long head less, because the arm is not overhead.',
    [
      'Make an overhead extension your first triceps movement: cable overhead extension (rope or bar), DB overhead extension (one or two hands), or EZ overhead extension.',
      'Get a deep stretch at the bottom: elbows high and pointed forward, hands behind the head. Control the lowering for 2-3 s.',
      'Skull crushers to the forehead or behind the head (elbows angled back) also stretch the long head well.',
      'Train triceps 2-3x per week, 12-20 sets per week counting close-grip pressing and dips at partial credit.',
      'Rep range: 8-12 on heavy overhead work, 12-20 on cable work. Lengthened partials at the end of a set are effective.',
      'Elbows hurt? Switch from straight bar to rope/EZ/DB, use higher reps (15-25), and warm up with light pushdowns.',
    ],
    4),

  triceps_horseshoe: G('triceps_horseshoe', 'Triceps Horseshoe', 'triceps',
    { triceps_lateral: 1, triceps_medial: 0.5, triceps_long: 0.3 },
    'The visible horseshoe on the back of the arm. Lateral-head work plus low body fat.',
    'The "horseshoe" is the lateral head (outer) and long head (inner) bordering a flat tendon. Its visibility depends mostly on body fat and on how long your triceps tendon is, which is genetic. A longer tendon makes the horseshoe more dramatic. The lateral head is biased by movements with the arm at the side (pushdowns, kickbacks, close-grip pressing, dips). Overhead work still matters because a bigger long head forms the inside of the horseshoe. Most people see a sharp horseshoe only below about 12% body fat.',
    [
      'Do pushdowns (bar, V-bar or rope) after your overhead work, 10-20 reps. Lock out fully and pause briefly at the bottom.',
      'Close-grip bench or dips at 6-10 reps add heavy lateral-head volume and strength.',
      'Cable or DB kickbacks with the upper arm slightly behind the torso keep tension through the lockout.',
      'Reverse-grip (underhand) pushdowns shift emphasis slightly to the medial head.',
      'Mix overhead and arms-down movements every week rather than choosing one.',
    ],
    2),

  forearms: G('forearms', 'Forearms', 'forearms',
    { forearms: 1, brachialis: 0.3 },
    'Thicker forearms and grip. Direct wrist work plus heavy carries and holds.',
    'Forearm size is partly genetic, because muscle-belly length varies a lot. Some people have long, full forearms and others have bellies that end high up near the elbow. Even so, forearms respond like any other muscle to direct, progressive, high-rep work. Heavy pulling and carries build grip but often not much size on their own. Direct wrist curls, reverse wrist curls and reverse/hammer curls through a full range of motion do more. Forearms recover quickly and tolerate high frequency.',
    [
      'Wrist curls (palms up) and reverse wrist curls (palms down), 15-25 reps, full range. Let the bar roll to your fingertips on wrist curls.',
      'Reverse curls and hammer curls cover the brachioradialis, the thickest part near the elbow.',
      'Farmer carries and trap bar holds (heavy, 30-60 s) for grip and overall forearm density.',
      'Train them 2-3x per week at the end of a session. Short sets, little fatigue.',
      'Skip straps on lighter back work so grip gets trained, and use straps on top sets so the back isn\'t limited.',
    ],
    3),

  arm_size: G('arm_size', 'Bigger Arms (Overall)', 'triceps',
    { triceps_long: 1, triceps_lateral: 0.5, biceps_long: 0.6, biceps_short: 0.5, brachialis: 0.6 },
    'Maximum arm circumference: a triceps-first, stretch-focused arm program with real volume.',
    'Arm size is the sum of triceps (largest), biceps and brachialis. The most effective approach is boring: enough weekly direct volume (about 10-20 sets each for biceps and triceps, counting fractional credit from compounds), trained 2-3x per week, close to failure, with stretch-position exercises prioritised. Arms grow slowly in already-trained people. A realistic rate is fractions of an inch per year once past the beginner phase. Arm measurement also depends heavily on body fat, so cutting may shrink tape-measure numbers even while muscle is maintained.',
    [
      'Put arms first in the session at least once a week so they get your best effort.',
      'Use supersets of biceps and triceps (e.g. incline curl + overhead extension) to save time without losing quality.',
      'Each week include one overhead triceps, one pushdown/press, one stretch-position curl and one hammer/reverse curl.',
      'Take most sets to 1-2 reps from failure. Arms tolerate high effort and recover in about 48 h.',
    ],
    4),

  // ======================= SHOULDERS =======================
  shoulder_width: G('shoulder_width', 'Shoulder Width', 'shoulders',
    { delt_side: 1 },
    'Wider shoulders via the side delts. This is the biggest single lever for a V-taper.',
    'Clavicle (collarbone) length and frame width are genetic and fixed. The lateral delt sits on the outside of that frame, so growing it is the main way to add visible width. Side delts get little work from pressing, so they need lots of direct lateral-raise volume, and they recover fast enough to train often. They respond well to moderate-to-high reps. Raises with more tension at the bottom (cable raises from behind the body, lying/incline raises) load the muscle at longer lengths, and research on lengthened training suggests that is beneficial. Upright rows with a wide grip are a heavier option if your shoulders tolerate them.',
    [
      'Do lateral raises 3-4x per week, 12-20+ hard sets total. They are small, recover in about 48 h, and are a good superset filler.',
      'Cable lateral raises (cable behind the body, start from across the hip) give tension at the bottom where DBs give almost none.',
      'Lean-away or lying incline DB raises also shift tension toward the stretched range.',
      'Use 12-25 reps with controlled tempo. Lead with the elbow and raise to roughly shoulder height. Slight forward lean is fine.',
      'Light weight, near failure. Swinging heavy DBs mostly trains traps. Partial reps at the bottom after failure are effective.',
      'Machine lateral raises or wide-grip upright rows (to lower chest) are good heavier variations.',
    ],
    4),

  capped_delts: G('capped_delts', 'Capped Delts', 'shoulders',
    { delt_side: 1, delt_rear: 0.7, delt_front: 0.4 },
    'Round "3D" shoulders that look capped: all three heads, with side and rear prioritised.',
    'The "capped" look comes from a well-developed delt that is clearly separated from the arm and chest. That requires size in all three heads plus low body fat (separation lines usually appear around 10-12%). Most lifters overdevelop front delts through pressing and underdevelop side and rear delts. Fix that by adding direct work for the side and rear and keeping front-delt isolation minimal. Delt insertion and shape are genetic, but every delt looks rounder when bigger and leaner.',
    [
      'Follow the shoulder_width plan for side delts and add 6-10 sets per week of rear-delt work.',
      'Front delts: your pressing (incline, overhead) is usually enough. Add front raises only if they lag.',
      'Overhead press (DB or machine) 1-2x per week builds overall delt mass and strength.',
      'Use a giant set to finish: lateral raise → rear-delt fly → partial lateral raises, 15-20 reps each.',
    ],
    3),

  rear_delts: G('rear_delts', 'Rear Delts', 'shoulders',
    { delt_rear: 1, upper_back: 0.3 },
    'Fuller shoulders from the side and back, and healthier shoulders for all that pressing.',
    'Rear delts are small and get some work from rows, but they are underdeveloped in almost everyone who presses more than they pull. They make the shoulder look thick from the side and add detail to the upper back. They respond best to high reps with strict form, where the arm moves out to the side and back (not just pulling the elbows behind you, which turns it into a row for the mid back). Shoulder health is a real secondary benefit: balanced rear delts and external rotators help keep the shoulder centred.',
    [
      'Reverse pec deck, cable reverse flyes (cross the cables, arms at shoulder height) or chest-supported DB reverse flyes, 15-25 reps.',
      'Face pulls with external rotation at the end, 12-20 reps.',
      'Keep shoulder blades fairly still and sweep the arms wide. Think "push your hands to the walls".',
      'Train them 2-4x per week. Rear delts recover fast and are easy to add at the end of any session.',
    ],
    3),

  traps_yoke: G('traps_yoke', 'Traps / Yoke', 'back',
    { traps: 1, upper_back: 0.4 },
    'A thicker neck-to-shoulder slope. Shrugs, carries and heavy pulls.',
    'Upper traps respond well to heavy loads and are already worked by trap bar deadlifts and carries. Bigger traps make the upper body look powerful, but they can visually narrow the shoulders if they outgrow the side delts. If width is the goal, keep trap volume moderate and push side delts harder. Trap shape (high or low insertion) is genetic.',
    [
      'Trap bar or DB shrugs, 10-20 reps, with a 1-2 s hold at the top. Move straight up, without rolling the shoulders.',
      'Use heavy farmer carries for 30-60 s. They build traps, grip and core together.',
      'Cable or DB Y-raises and face pulls train the mid/lower traps for posture.',
      'Moderate volume (4-8 sets/wk direct) is plenty because deadlifts and rows add a lot of indirect work.',
    ],
    2),

  // ======================= BACK =======================
  lat_width: G('lat_width', 'Lat Width', 'back',
    { lats: 1, upper_back: 0.2 },
    'Wider back and a stronger V-taper. Vertical pulling and lat-focused rows, emphasising the stretch.',
    'Where the lats attach and how low they insert are genetic. Some people have "low lats" that sweep down toward the waist, and others have high, shorter lats. The muscle itself is very trainable and grows with plenty of vertical and lat-biased pulling. Grip width matters less than many think: research and EMG suggest wide and close grips train the lats similarly, so pick the grip that lets you feel the lats and use a full range. The bottom (stretched) position of pulldowns and pullovers is where the lats are most stretched. Don\'t cut it short.',
    [
      'Do pull-ups, assisted pull-ups or pulldowns 2x per week, 6-12 reps. Use a full hang or stretch at the top every rep.',
      'Single-arm cable pulldowns or kneeling single-arm rows let you reach long and pull the elbow to the hip.',
      'Cable or DB pullovers (straight-arm pulldowns) isolate the lats with no biceps limit, 12-20 reps.',
      'Lat-biased rows: elbows tucked, pull toward the hip, not the chest (e.g. DB row with the bench at an incline, or a low cable row with a neutral grip).',
      'At home without a bar: DB pullovers, single-arm DB rows with a long stretch, and band pulldowns if bands are available.',
      'Aim for 10-16 sets per week counting rows at partial credit. Straps are fine so grip doesn\'t limit lat work.',
    ],
    3),

  back_thickness: G('back_thickness', 'Back Thickness', 'back',
    { upper_back: 1, traps: 0.4, lats: 0.4, lower_back: 0.2 },
    'Dense mid-back and detail, seen from the side and in back poses. Heavy rows with full scapular retraction.',
    'Thickness comes from the rhomboids, mid traps, teres major, lats and erectors stacked on top of each other. Horizontal rows with the elbows somewhat flared and a full squeeze of the shoulder blades target the mid back. Deadlifts (trap bar for you) add erector and trap density. This is highly trainable and less genetically constrained than lat shape.',
    [
      'Chest-supported rows (DB on an incline bench, T-bar, machine) remove the lower back from the equation so you can push the upper back hard.',
      'Seated cable rows with a wide grip and a 1 s squeeze. Let the shoulder blades protract (reach) at the front for a full stretch.',
      'Trap bar deadlifts 1x per week for overall posterior density.',
      'Rep range: 6-12 heavy on rows, 12-15 on machines.',
    ],
    3),

  // ======================= CHEST =======================
  upper_chest: G('upper_chest', 'Upper Chest', 'chest',
    { chest_upper: 1, delt_front: 0.2 },
    'Full upper pecs under the collarbones, which makes a shirt "sit" better. Incline pressing and low-to-high flyes.',
    'The pec has a separate clavicular (upper) head with its own fibre direction, and it can be preferentially trained, unlike "inner chest". Incline pressing at about 30-45° shifts work toward the clavicular head. Training studies and EMG point the same way, and very steep inclines turn it into a shoulder press. Flat pressing still trains the upper chest, just less. Overall pec size and shape (insertions, gap between pecs) are genetic.',
    [
      'Make your first chest exercise an incline press 2x per week: DB incline at 30°, incline smith, or incline machine. 6-12 reps.',
      'Don\'t go steeper than about 45°. Front delts take over.',
      'Low-to-high cable flyes or incline DB flyes, 12-15 reps, with a deep stretch at the bottom.',
      'Reverse-grip (underhand) DB or smith bench press is an alternative upper-chest bias if incline bothers your shoulders.',
      'Aim for 6-10 upper-chest sets per week within 12-20 total chest sets.',
    ],
    3),

  chest_fullness: G('chest_fullness', 'Chest Fullness', 'chest',
    { chest_mid: 1, chest_upper: 0.5, chest_lower: 0.4 },
    'A thicker, fuller chest overall. Pressing plus stretched flyes. There is no such thing as an isolated "inner chest".',
    'You cannot isolate the "inner chest". The pec fibres run from the sternum to the arm, so the whole muscle contracts together, and the inner line simply becomes fuller as the whole pec grows. Squeezing your hands together doesn\'t target it any more. The gap between the pecs is set by where they attach to the sternum, which is genetic. What works is overall pec growth: heavy pressing for load, plus flyes or deep DB presses that load the pec in its stretched position, which appears especially effective for hypertrophy.',
    [
      'Combine a press (DB bench, machine press, dips) with a fly (cable fly, pec deck, DB fly) each chest session.',
      'Go deep on DB presses and flyes, with elbows a little below the bench line and a controlled stretch. Skip barbell bounce.',
      'Use deficit push-ups (hands on DBs or plates) when you only have bodyweight. They give a much better stretch than floor push-ups.',
      'Train chest 2x per week with 12-20 total sets.',
    ],
    3),

  lower_chest: G('lower_chest', 'Lower Chest Line', 'chest',
    { chest_lower: 1, chest_mid: 0.4 },
    'A sharper bottom edge to the chest. Dips, decline pressing and high-to-low flyes, plus getting lean.',
    'The lower (sternal/costal) fibres are trained by pressing or flying with the arms moving downward. A sharp lower pec line is mostly a body-fat issue: fat collects at the bottom of the chest first, so a soft lower chest usually means fat, not missing muscle. Most people need little dedicated lower-chest work because flat pressing covers it.',
    [
      'Dips (lean forward) or decline DB press, 6-12 reps.',
      'High-to-low cable flyes, 12-15 reps.',
      'Keep it to 2-5 sets per week. Upper chest is a better use of volume for most physiques.',
    ],
    2),

  // ======================= CORE =======================
  six_pack: G('six_pack', 'Six-Pack', 'core',
    { abs: 1, obliques: 0.3 },
    'Visible abs: about 80% body fat (diet) and 20% building thicker abs with loaded, progressive ab training.',
    'You cannot spot-reduce belly fat. Vispute et al. (2011) found six weeks of ab exercises did not reduce abdominal fat, and broader research agrees. Abs show when overall body fat is low, around 10-12% for most men. You may need to go lower if you store fat around the waist. Training still matters: thicker, hypertrophied abs "pop" at a higher body fat. Abs are a skeletal muscle like any other and grow best with loaded flexion in moderate rep ranges, not hundreds of crunches. The number of visible segments (4, 6, 8 pack) and whether they are symmetrical are set by your tendinous intersections, which are genetic.',
    [
      'Do 6-10 sets per week of loaded ab work, 2-3x per week: cable crunches, weighted decline crunches, hanging leg raises, ab wheel rollouts, machine crunch.',
      'Progress like any lift: add load or reps, 8-15 reps, roughly 1-2 reps from failure.',
      'Make it real spinal flexion. Curl ribcage toward pelvis instead of just bending at the hips. On leg raises, roll the pelvis up at the top.',
      'Long-length work (stability-ball or decline crunches starting from a stretch, ab wheel) loads the abs at long lengths.',
      'Diet sets visibility: a moderate deficit and high protein (about 0.8-1 g per lb). Adderall suppresses appetite, so plan protein-dense meals deliberately.',
      'Planks are good for bracing but poor for hypertrophy once you can hold 60 s. Load them or progress to ab wheel.',
    ],
    3),

  obliques_vline: G('obliques_vline', 'Obliques / V-Line', 'core',
    { obliques: 1, abs: 0.3 },
    'Defined obliques and the lower-ab "V" (Apollo\'s belt). Mostly low body fat, plus rotation and side-bend work.',
    'The "V-line" (inguinal ligament area) is not a muscle you can grow directly. It shows when the lower abdomen is very lean and the obliques and lower abs are developed. Oblique training is worthwhile, but heavy weighted side bends add waist thickness in some people, which can work against a V-taper. Moderate loads and anti-rotation work keep the obliques defined without widening the waist much. Like abs, visibility is primarily a body-fat question.',
    [
      'Cable woodchops (high-to-low and low-to-high), Pallof presses and side planks 1-2x per week.',
      'Hanging knee raises with a twist, or bicycle crunches done slowly.',
      'Keep side bends moderate (12-20 reps) if you worry about waist width.',
      '3-6 sets per week is enough. The lean-out does the rest.',
    ],
    2),

  // ======================= COMPOSITE =======================
  v_taper: G('v_taper', 'V-Taper', 'back',
    { delt_side: 1, lats: 1, upper_back: 0.2, abs: 0.2 },
    'Wide shoulders, wide lats and a tight waist: the classic athletic silhouette.',
    'The V-taper is a ratio: shoulder (and lat) width over waist width. Bone structure (clavicle width, pelvis/rib cage size) is genetic. You can build the two muscles that add width, side delts and lats, and keep the waist small by staying lean and avoiding excessive heavy oblique work. Of all the levers, body fat is the biggest for the waist, and side delts are the biggest for the top.',
    [
      'Prioritise side delts (12-20 sets/wk) and lats (10-16 sets/wk) above everything else.',
      'Train vertical pulling and lateral raises in the same session. They don\'t compete and the session is fast.',
      'Practise stomach vacuums if you like. They train the transverse abdominis and help you hold the waist in, but they don\'t "shrink" the waist structurally.',
      'Keep heavy weighted side bends and very heavy squats/deadlifts moderate. Hypertrophy of the waist area works against the ratio.',
    ],
    4),

  // ======================= LEGS (maintenance by default) =======================
  glutes: G('glutes', 'Glutes', 'glutes',
    { glutes: 1, glute_med: 0.5 },
    'Stronger, fuller glutes. Hip thrusts, deep split squats and hinges.',
    'Glutes respond to both stretch-focused movements (deep split squats, RDLs, deep leg press) and shortened-position work (hip thrusts). Research comparing these patterns suggests similar overall glute growth, so use what you can load and recover from. Your running background means glutes are already strong. For aesthetics, maintenance-plus is usually enough.',
    [
      'Hip thrusts (machine, barbell, or DB at home) 8-15 reps, 1 s squeeze at the top.',
      'Bulgarian split squats with a slight forward lean bias the glutes.',
      'Trap bar deadlifts and RDLs cover hip extension in the stretched position.',
      'Cable or machine abduction for glute med. It also supports running mechanics.',
    ],
    2),

  calves: G('calves', 'Calves', 'calves',
    { calves: 1 },
    'Bigger calves. Very heavily genetic, but stretch-position training gives you the best chance.',
    'Calf size is one of the most genetic body parts because muscle-belly length (high vs low calves) varies a lot. Yours already handled marathon training. Running builds endurance far more than size, though. Kassiano et al. (2023) found calf raises done in the bottom (stretched) half produced more gastrocnemius growth than full-range or top-half raises. A deep pause at the bottom is the key cue. Straight-knee raises train the gastrocnemius and bent-knee raises train the soleus.',
    [
      'Standing or leg-press calf raises: 2 s pause in the deepest stretch, no bouncing, 10-20 reps.',
      'After failure, add bottom-half partials.',
      'Seated (bent-knee) raises for soleus, 15-25 reps.',
      'Train them 2-3x per week. Calves recover quickly. If running again, account for that fatigue.',
    ],
    3),

  quad_sweep: G('quad_sweep', 'Quad Sweep', 'quads',
    { quads: 1, adductors: 0.2 },
    'Outer-thigh sweep and teardrop. Deep knee-dominant work and lengthened partials. No back squats needed.',
    'The "sweep" is the vastus lateralis and the "teardrop" is the vastus medialis. You cannot fully isolate either. Deep knee-flexion work grows all the vasti. Pedrosa et al. (2022) found lengthened partials on the leg extension (working in the bent-knee range) produced more quad growth than shortened-range reps, especially toward the knee. Rectus femoris also crosses the hip, so leg extensions are the best way to train it. Hack squats, leg press, and split squats build the quads without barbell back squats.',
    [
      'Hack squat or leg press with a narrow-ish stance and deep range, 8-12 reps.',
      'Leg extensions: get full depth at the bottom, and use bottom-half partials after failure. Leaning back (hip extended) stretches the rectus femoris more.',
      'Heels-elevated goblet squats or cyclist squats at home.',
      'Maintenance (6-10 sets/wk) holds your current size. Raise it only if quads become a goal.',
    ],
    3),

  hamstrings: G('hamstrings', 'Hamstrings', 'hamstrings',
    { hamstrings: 1, glutes: 0.2 },
    'Fuller hamstrings and injury resilience. Seated curls and RDLs.',
    'Hamstrings both extend the hip and flex the knee, so they need both kinds of exercise. Maeo et al. (2021) found seated leg curls, where the hip is flexed so the hamstrings are lengthened, produced notably more hamstring growth than lying leg curls. RDLs and trap bar deadlifts cover hip extension. Hamstring strength is also strongly linked to staying healthy if running returns.',
    [
      'Prefer seated leg curls over lying ones when both are available, 10-15 reps.',
      'DB or trap bar RDLs, 8-12 reps, hips back, deep stretch with a neutral spine.',
      'At home: single-leg RDLs, sliding/towel leg curls, or Nordic curls (eccentric) anchored under a couch.',
      'Maintenance 4-8 sets/wk.',
    ],
    2),
};

export const DEFAULT_SCULPT_GOALS = ['triceps_mass', 'shoulder_width', 'six_pack', 'lat_width', 'upper_chest'];
