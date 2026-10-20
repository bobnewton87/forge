// Female mode (CONTRACT §20): sex helper, BMR / body fat, lean-gain model, hormone modeling, nutrition warnings,
// default sculpt goals for new female profiles, and male results unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sexOf, femaleStatus, BODY, bodyFatCategory, ffmiBand, averageTotalTFemale, energyAvailability, ironRda } from '../js/engine/sex.js';
import { bodyComp, baseline, navyBodyFat } from '../js/engine/bodycomp.js';
import { project, MUSCLE_SHARE, FEMALE_MUSCLE_SHARE } from '../js/engine/projection.js';
import { metabolicBaseline, modifiersAt, testosteroneEffect, testosteroneFromDose, averageTotalT, T_MODEL_F } from '../js/engine/metabolic.js';
import { dailyTargets, macrosFor, tipsFor, supplementsFor, NUTRITION_TIPS, ADDERALL_TIPS, SUPPLEMENTS as NU_SUPPS } from '../js/engine/nutrition.js';
import { resolveTargets, applyTargetChange } from '../js/engine/targets.js';
import { SCULPT_GOALS, DEFAULT_SCULPT_GOALS, FEMALE_DEFAULT_SCULPT_GOALS, defaultSculptGoals, goalFor } from '../js/data/sculpt.js';
import { SUPPLEMENTS, itemFor } from '../js/data/supplements.js';
import { EXERCISES } from '../js/data/exercises.js';
import { defaultProfile, store } from '../js/store.js';
import { bobPlan, bobProfile, findBad, NOW } from './body-fixtures.js';

const KG = 2.20462;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const herProfile = (body = {}, extra = {}) => ({ goal: 'recomp', bodyweight: 140, nutrition: { mode: 'off' }, cardioTargetMin: 120,
  body: { sex: 'female', heightIn: 65, birthYear: 1990, trainingMonths: 6, activity: 'desk', ...body }, ...extra });
const herMeas = [{ d: '2026-10-15', neck: 13, waist: 29, hips: 39, shoulders: 40, chest: 35 }];
const herBase = (p = herProfile(), w = 140, meas = herMeas) => baseline({ profile: p, bodyLog: [{ d: '2026-10-15', w }], measurements: meas, now: NOW });

// ---------------------------------------------------------------- helper
test('sexOf: one helper for profiles, bodies, baselines and strings; default male', () => {
  assert.equal(sexOf({ body: { sex: 'female' } }), 'female');
  assert.equal(sexOf({ sex: 'female' }), 'female');
  assert.equal(sexOf('female'), 'female');
  for (const x of [null, undefined, {}, { body: {} }, 'x', { body: { sex: 'other' } }]) assert.equal(sexOf(x), 'male');
  const fs = femaleStatus(herProfile({ birthYear: 1966 }), { age: 60 });
  assert.equal(fs.menopause, 'post'); assert.equal(fs.menopauseAssumed, true); assert.equal(fs.cycling, false);
  const fs2 = femaleStatus(herProfile({ menopause: 'peri', contraception: 'combined', pregnancy: 'breastfeeding' }), { age: 30 });
  assert.equal(fs2.menopause, 'peri'); assert.equal(fs2.combinedHormonal, true); assert.equal(fs2.postpartum, true); assert.equal(fs2.breastfeeding, true);
});

// ---------------------------------------------------------------- BMR + body fat
test('BMR: female Mifflin-St Jeor is 166 kcal below male at the same size; Katch-McArdle (lean mass) is sex-neutral', () => {
  const f = bodyComp({ weightLb: 140, heightIn: 64, age: 30, sex: 'female' }), m = bodyComp({ weightLb: 140, heightIn: 64, age: 30, sex: 'male' });
  assert.equal(f.bmrMethod, 'mifflin'); assert.equal(m.bmr - f.bmr, 166);
  const fk = bodyComp({ weightLb: 140, heightIn: 64, bodyFatPct: 28, sex: 'female' }), mk = bodyComp({ weightLb: 140, heightIn: 64, bodyFatPct: 28, sex: 'male' });
  assert.equal(fk.bmr, mk.bmr); assert.equal(fk.bmrMethod, 'katch');
});

test('body fat: female Navy (hips), Gallagher healthy range, female missing-info wording, waist:hip', () => {
  const b = herBase();
  assert.equal(b.sex, 'female'); assert.equal(b.bodyFatSource, 'navy');
  // §20b: female Navy + 1.7 onto the DXA scale (Taylor 2024); the value is the DXA-scale blend.
  near(b.bodyFatSources.navy, navyBodyFat({ sex: 'female', heightIn: 65, neckIn: 13, waistIn: 29, hipsIn: 39 }) + 1.7, 0.06);
  assert.equal(b.bodyFatMethod, 'blend');
  assert.deepEqual(b.bodyFatCategory.healthy, [21, 33]);
  assert.equal(b.bodyFatCategory.label, 'Healthy range');
  assert.equal(b.ratios.waistToHip, Math.round(29 / 39 * 100) / 100);
  const noHips = herBase(herProfile(), 140, [{ d: '2026-10-15', neck: 13, waist: 29 }]);
  const hips = noHips.missingInfo.find(x => x.field === 'hips');
  assert.ok(hips && /waist-to-hip/.test(hips.why));
  assert.ok(!noHips.missingInfo.some(x => /V-taper/.test(x.why)), 'no V-taper wording for women');
  assert.equal(bodyFatCategory(40, { sex: 'female', age: 30 }).label, 'Obese range');
  assert.equal(bodyFatCategory(19, { sex: 'female', age: 30 }).label, 'Below the healthy range');
  assert.equal(bodyFatCategory(35, { sex: 'female', age: 50 }).label, 'Above the healthy range');
  assert.deepEqual(ffmiBand(18.8, 'female'), ['Very muscular', 'good']);
  assert.deepEqual(ffmiBand(18.8, 'male'), ['Average', 'muted'], 'male bands unchanged');
});

// ---------------------------------------------------------------- lean-gain model
test('lean-gain: same relative rate as men, applied to lean mass (fat does not build muscle)', () => {
  const plan = bobPlan('2026-10-19', 52);
  const p = herProfile();
  const run = (w, meas) => project({ baseline: herBase(p, w, meas), profile: p, sessions: plan, weeks: 52, now: NOW, intake: { surplus: 300 }, useStack: false });
  // Same lean mass, different fat: the training-driven ceiling is (nearly) the same.
  const lean = herBase(p, 140).comp.leanLb;
  const a = run(140), b = run(Math.round(lean / (1 - 0.40) * 10) / 10, [{ d: '2026-10-15', bodyFat: 40 }]);
  near(a.summary.leanCeilingLb, b.summary.leanCeilingLb, 0.25 * a.summary.leanCeilingLb, 'ceiling independent of fat');
  // Relative gain (per lb of starting lean) is comparable to a man's on the same plan.
  const m = project({ baseline: baseline({ profile: bobProfile(), bodyLog: [{ d: '2026-10-15', w: 164 }], measurements: [{ d: '2026-10-15', bodyFat: 20 }], now: NOW }),
    profile: bobProfile(), sessions: plan, weeks: 52, now: NOW, intake: { surplus: 300 }, useStack: false });
  const relF = a.summary.leanLb / a.series[0].leanLb, relM = m.summary.leanLb / m.series[0].leanLb;
  near(relF, relM, 0.3 * relM, 'relative lean gain female vs male');
  assert.ok(a.summary.leanLb < m.summary.leanLb, 'absolute gain smaller for the smaller woman');
  // Muscle distribution: women carry relatively more in the legs (Janssen 2000).
  const legs = S => ['glutes', 'quads', 'hamstrings', 'calves'].reduce((x, g) => x + S[g], 0);
  assert.ok(legs(FEMALE_MUSCLE_SHARE) > legs(MUSCLE_SHARE));
  near(Object.values(FEMALE_MUSCLE_SHARE).reduce((x, y) => x + y, 0), 1, 1e-9);
});

test('projection: female ceiling, milestones, scores, energy availability, no NaN', () => {
  const p = herProfile();
  const r = project({ baseline: herBase(p), profile: p, sessions: bobPlan('2026-10-19', 12), weeks: 104, now: NOW });
  assert.equal(r.ceiling.ffmiNatural, BODY.female.ffmiCeiling);
  const ids = r.milestones.map(m => m.id);
  for (const id of ['abs_upper', 'six_pack', 'goal_bf', 'whr_085', 'wht_05', 'ffmi_185', 'ffmi_20', 'near_ceiling']) assert.ok(ids.includes(id), id);
  for (const id of ['sw_1_5', 'sw_1618', 'lean_vs_race', 'ffmi_22', 'ffmi_23']) assert.ok(!ids.includes(id), `no male milestone ${id}`);
  assert.ok(r.milestones.find(m => m.id === 'goal_bf').label.includes('22%'), 'female default goal 22%');
  assert.ok(r.energyAvailability && Number.isFinite(r.energyAvailability.start) && r.energyAvailability.threshold === 30);
  assert.ok(r.series[0].ratios.waistToHip > 0);
  assert.ok(r.assumptions.some(a => /Roberts 2020/.test(a)) && r.assumptions.some(a => /Kuk & Ross 2009/.test(a)));
  assert.ok(!r.assumptions.some(a => /men gain and lose belly fat first|Massachusetts Male Aging/.test(a)), 'no male-only wording');
  // Muscle scores sit on a female scale: an average-ish woman isn't scored as underdeveloped.
  assert.ok(r.series[0].muscle.chest > 0.4, JSON.stringify(r.series[0].muscle));
  // A big deficit trips the low-energy-availability flag.
  const cut = project({ baseline: herBase(p), profile: p, sessions: bobPlan('2026-10-19', 12), weeks: 12, now: NOW, intake: { surplus: -700 } });
  assert.equal(cut.energyAvailability.low, true);
  assert.ok(cut.assumptions.some(a => /Loucks & Thuma 2003/.test(a)));
  // Every female status combination stays finite.
  for (const body of [{}, { menopause: 'post', birthYear: 1960 }, { contraception: 'combined' }, { hormoneTherapy: 'estrogen' }, { pregnancy: 'breastfeeding' }, { heightIn: null, birthYear: null }]) {
    const pp = herProfile(body), rr = project({ baseline: herBase(pp), profile: pp, sessions: bobPlan('2026-10-19', 4), weeks: 52, now: NOW, phases: 'cycles' });
    assert.deepEqual(findBad(rr), [], JSON.stringify(body));
    assert.ok(rr.series.every(pt => pt.bodyFatPct >= BODY.female.essentialBf - 0.05));
    assert.ok(rr.assumptions.every(a => typeof a === 'string' && !/NaN|undefined/.test(a)));
  }
});

test('projection: pregnancy pauses (no model, no deficit); postpartum runs with a caution', () => {
  const preg = herProfile({ pregnancy: 'pregnant' });
  const r = project({ baseline: herBase(preg), profile: preg, sessions: bobPlan('2026-10-19', 4), weeks: 12, now: NOW });
  assert.equal(r.paused, 'pregnancy'); assert.deepEqual(r.series, []); assert.match(r.assumptions[0], /paused during pregnancy/);
  const pp = herProfile({ pregnancy: 'postpartum' });
  const r2 = project({ baseline: herBase(pp), profile: pp, sessions: bobPlan('2026-10-19', 4), weeks: 12, now: NOW });
  assert.equal(r2.caution, 'postpartum'); assert.ok(r2.series.length > 2); assert.match(r2.assumptions[0], /Postpartum/);
});

// ---------------------------------------------------------------- hormones
test('female testosterone defaults come from female population data, not male', () => {
  assert.equal(averageTotalT(36, 'female'), averageTotalTFemale(36));
  near(averageTotalT(36, 'female'), 27, 2, 'premenopausal ≈27 (Kushnir 2010)');
  assert.equal(averageTotalT(65, 'female'), 18, 'postmenopausal 18');
  assert.ok(averageTotalT(30, 'female', { contraception: 'combined' }) < averageTotalT(30, 'female'), 'combined pill lowers T (Zimmerman 2014)');
  assert.equal(averageTotalT(39), Math.round(600 * Math.pow(0.99, 9)), 'male default unchanged');
  const b = metabolicBaseline(herProfile(), { date: '2026-10-20' });
  assert.equal(b.levels.sex, 'female'); assert.ok(b.levels.totalT < 60);
  assert.equal(b.factors.find(f => f.id === 'testosterone').mult, 1, 'natural female T is not a "low T" penalty');
  assert.match(b.assumptions.join(' '), /woman/);
  assert.ok(!/adult male|for a \d+-year-old man/.test(JSON.stringify(b)), 'no male wording');
});

test('female testosterone dose-response matches Huang 2014 and trans-men cohorts', () => {
  // Huang 2014: +0.6 kg lean per +100 ng/dL at 24 weeks, no fat change up to ~210 ng/dL.
  const h = testosteroneEffect(210, { baselineT: 19, weeksOn: 24, sex: 'female' });
  near(h.cumLeanLb / KG, 0.6 * (210 - 19) / 100, 0.02, 'Huang slope');
  assert.ok(Math.abs(h.cumFatLb) < 1e-9, 'no fat change at 210');
  assert.equal(h.leanCeilingMult, 1);
  // Trans men at male-range T for a year: lean +3.9 kg (3.2-4.5), fat −2.6 kg (Klaver 2016).
  const t = testosteroneEffect(550, { baselineT: 20, weeksOn: 52, sex: 'female' });
  assert.ok(t.cumLeanLb / KG >= 3.2 && t.cumLeanLb / KG <= 4.5, String(t.cumLeanLb / KG));
  near(t.cumFatLb / KG, -2.6, 0.15, 'fat');
  // Held flat above ~600; beyond studied past ~1,555.
  const a = testosteroneEffect(700, { baselineT: 20, weeksOn: 24, sex: 'female' }), c = testosteroneEffect(1500, { baselineT: 20, weeksOn: 24, sex: 'female' });
  near(a.lean20Lb, c.lean20Lb, 1e-9, 'plateau');
  assert.equal(testosteroneEffect(3000, { baselineT: 20, sex: 'female' }).beyondStudied, true);
  // Natural levels (no therapy) never add or remove lean.
  for (const lvl of [5, 27, 90]) { const e = testosteroneEffect(lvl, { sex: 'female' }); assert.equal(e.leanDirectLbPerWeek, 0); assert.equal(e.leanCeilingMult, 1); }
  // Dose → level: Huang 2014 groups, then the men's exogenous mapping above 25 mg/week.
  assert.equal(testosteroneFromDose(25, 'female'), 210); assert.equal(testosteroneFromDose(3, 'female'), 78);
  assert.equal(testosteroneFromDose(125, 'female'), 542);
  assert.equal(testosteroneFromDose(100), testosteroneFromDose(100, 'male'), 'male mapping unchanged');
  assert.equal(T_MODEL_F.leanKgPer100, 0.6);
});

test('stack in women: TRT uses the female curve and raises the reachable ceiling; male boosters/therapies do nothing', () => {
  const trt = herProfile({}, { supplements: [{ id: 'trt', start: '2026-10-13', dose: { value: 100, unit: 'mg/week' }, active: true }] });
  const m = modifiersAt(trt, '2026-10-20', {});
  assert.ok(m.leanDirectLbPerWeek > 0.3 && m.leanDirectLbPerWeek < 1, String(m.leanDirectLbPerWeek));
  assert.ok(m.ffmiCeilingDelta > 0.5, String(m.ffmiCeilingDelta));
  assert.ok(m.risks.some(r => /voice deepening/.test(r.text)), 'virilization risks at male-range levels');
  assert.ok(m.warnings.some(w => /Huang 2014/.test(w)));
  const boosters = herProfile({}, { supplements: ['ashwagandha', 'tongkat_ali', 'clomiphene', 'hcg', 'fat_loss'].map(id => ({ id, start: '2026-06-01', active: true })) });
  const mb = modifiersAt(boosters, '2026-10-20', {});
  assert.equal(mb.testosterone.source, 'natural'); assert.equal(mb.leanDirectLbPerWeek, 0); assert.equal(mb.ffmiCeilingDelta, 0);
  assert.match(mb.contributions.find(c => c.id === 'ashwagandha').text, /Fornalik 2026/);
  assert.match(mb.contributions.find(c => c.id === 'clomiphene').text, /ovulation/);
  // Creatine: smaller modeled lean effect and water in women (Delpino 2022; Mihic 2000).
  const cr = id => ({ id, start: '2026-06-01', active: true });
  const f = modifiersAt(herProfile({}, { supplements: [cr('creatine')] }), '2026-10-20', {}), fb = modifiersAt(herProfile(), '2026-10-20', {});
  near(f.leanCeilingMult / fb.leanCeilingMult, 1.024, 0.001); assert.equal(f.waterLb, 1);
  assert.equal(itemFor(SUPPLEMENTS.creatine, 'male'), SUPPLEMENTS.creatine, 'male catalogue untouched');
  assert.match(itemFor(SUPPLEMENTS.trt, 'female').summary, /Huang 2014/);
  // Deficit: female low-energy-availability warning instead of the male testosterone one.
  const d = modifiersAt(herProfile(), '2026-10-20', { inDeficit: true });
  assert.ok(d.warnings.some(w => /Loucks & Thuma/.test(w))); assert.ok(!d.warnings.some(w => /Ranger/.test(w)));
});

// ---------------------------------------------------------------- nutrition
test('nutrition: energy-availability warning under 30 kcal/kg FFM, pregnancy never plans a deficit, female wording', () => {
  near(energyAvailability({ intakeKcal: 1500, exerciseKcal: 400, leanLb: 100 }), 1100 / (100 / KG), 0.1);
  const p = herProfile({}, { goal: 'cut', nutrition: { mode: 'simple' } });
  const low = dailyTargets(p, { bodyweight: 140, tdee: 2000, leanLb: 100, exerciseKcal: 400 });
  assert.ok(low.energyAvailability < 30 && low.warnings.some(w => /Energy availability/.test(w)));
  const ok = dailyTargets({ ...p, goal: 'recomp' }, { bodyweight: 140, tdee: 2400, leanLb: 100, exerciseKcal: 200 });
  assert.ok(ok.energyAvailability >= 30 && !ok.warnings.some(w => /Energy availability/.test(w)));
  assert.equal(ok.female.ironMgPerDay, 18);
  const preg = dailyTargets(herProfile({ pregnancy: 'pregnant' }, { goal: 'cut', nutrition: { mode: 'simple' } }), { bodyweight: 150, tdee: 2200 });
  assert.equal(preg.calories, 2200); assert.ok(preg.warnings.some(w => /Pregnancy/.test(w)));
  const fat = macrosFor(herProfile({}, { nutrition: { fatPct: 15 } }), { calories: 1800, bodyweight: 140 });
  assert.ok(fat.warnings.some(w => /Fat is only/.test(w)) && !fat.warnings.some(w => /testosterone/.test(w)));
  assert.equal(ironRda({ sex: 'female', menopause: 'post' }), 8); assert.equal(ironRda({ sex: 'male' }), 8);
  const T = tipsFor(herProfile());
  assert.ok(T.nutrition.some(t => /Iron/.test(t))); assert.equal(T.adderall, null);
  assert.ok(!T.nutrition.some(t => /marathon/i.test(t)));
  assert.ok(supplementsFor(herProfile()).some(s => /Iron/.test(s.name)));
  const male = tipsFor(bobProfile());
  assert.equal(male.nutrition, NUTRITION_TIPS); assert.equal(male.adderall, ADDERALL_TIPS); assert.equal(supplementsFor(bobProfile()), NU_SUPPS);
});

// ---------------------------------------------------------------- sculpt goals + profile defaults
test('new female profiles get female starting sculpt goals; existing goals are never changed', () => {
  assert.deepEqual(defaultProfile().sculptGoals, DEFAULT_SCULPT_GOALS, 'default (Bob) unchanged');
  const f = defaultProfile({ sex: 'female' });
  assert.equal(f.body.sex, 'female'); assert.deepEqual(f.sculptGoals, FEMALE_DEFAULT_SCULPT_GOALS);
  for (const id of FEMALE_DEFAULT_SCULPT_GOALS) assert.ok(SCULPT_GOALS[id], id);
  assert.deepEqual(defaultSculptGoals({ body: { sex: 'female' } }), FEMALE_DEFAULT_SCULPT_GOALS);
  // Saving an existing profile that switches to female keeps its goals.
  store.saveProfile({ ...defaultProfile(), sculptGoals: ['biceps_peak'], body: { ...defaultProfile().body, sex: 'female' } });
  assert.deepEqual(store.getProfile().sculptGoals, ['biceps_peak']);
  // A female profile with no goals key at all gets the female starting set.
  const { sculptGoals, ...noGoals } = defaultProfile({ sex: 'female' });
  store.saveProfile(noGoals);
  assert.deepEqual(store.getProfile().sculptGoals, FEMALE_DEFAULT_SCULPT_GOALS);
});

test('glute_shelf goal: evidence-honest and mapped to real exercises; female wording drops male/Bob text', () => {
  const g = SCULPT_GOALS.glute_shelf;
  assert.equal(g.group, 'glutes'); assert.match(g.science, /Attarieh/); assert.match(g.science, /EMG/);
  const tagged = EXERCISES.filter(e => (e.emphasis || []).includes('glute_shelf'));
  assert.ok(tagged.length >= 5 && tagged.some(e => e.pattern === 'abduction'));
  for (const id of ['six_pack', 'glutes', 'calves']) {
    const fg = goalFor(id, 'female');
    assert.ok(!/most men|Adderall|marathon|running background/i.test(fg.science + fg.tips.join(' ')), id);
  }
  assert.equal(goalFor('six_pack', 'male'), SCULPT_GOALS.six_pack, 'male text unchanged');
});

test('targets: female goal body fat defaults to 22 % and is clamped to 14–35 %; male unchanged', () => {
  assert.equal(resolveTargets(herProfile()).goals.goalBodyFatPct, 22);
  assert.equal(resolveTargets(defaultProfile()).goals.goalBodyFatPct, 15);
  assert.equal(applyTargetChange(herProfile(), { goals: { goalBodyFatPct: 8 } }).body.goalBodyFat, 14);
  assert.equal(applyTargetChange(herProfile(), { goals: { goalBodyFatPct: 33 } }).body.goalBodyFat, 33);
  assert.equal(applyTargetChange(defaultProfile(), { goals: { goalBodyFatPct: 8 } }).body.goalBodyFat, 8);
});

test('male results carry no female-only fields', () => {
  const b = baseline({ profile: bobProfile(), bodyLog: [{ d: '2026-10-15', w: 164 }], measurements: [{ d: '2026-10-15', neck: 15, waist: 33.5 }], now: NOW });
  assert.equal(b.bodyFatCategory, undefined); assert.equal(b.femaleStatus, undefined);
  const r = project({ baseline: b, profile: bobProfile(), sessions: bobPlan('2026-10-19', 4), weeks: 12, now: NOW });
  assert.equal(r.energyAvailability, undefined); assert.equal(r.paused, undefined);
  assert.equal(r.ceiling.ffmiNatural, 24.2);
  assert.equal('ffmiCeilingDelta' in modifiersAt(bobProfile(), '2026-10-20', {}), false);
});
