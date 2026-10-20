// "Raise your own testosterone" planner (CONTRACT §22). Pure, DOM-free, Node-testable.
//
// Bob: "a major thing I want and most men will want is to increase testosterone without direct testosterone
// injections — any of these therapies or pills that can do that we should accurately model based on the research,
// and we should recommend combinations that could be useful and attempt to determine combined interactions for
// muscle growth and fat loss."
//
// CONTRACT-NOTE: this module ranks by MODELED BODY COMPOSITION, not by the size of the testosterone rise. That is
//   deliberate: an aromatase inhibitor produces the biggest testosterone number in the catalogue and, per the
//   trials that measured it, zero muscle and (via Finkelstein 2013) a fat cost. Ranking by T would be wrong.
// CONTRACT-NOTE: every number comes back through the engines the rest of the app uses — modifiersAt() for the
//   hormones and project() for lean/fat — so a row's projection matches what Projection and Body will show once
//   the item is added. No parallel model lives here.
// CONTRACT-NOTE (§20 Female mode): these are male-axis therapies. tPlan() returns { female: true, hidden: true }
//   and no rows for a female profile, and the UI does not render the section at all.
import { SUPPLEMENTS, T_LAB_PANEL, isRx, itemFor } from '../data/supplements.js';
import * as MET from '../engine/metabolic.js';
import { sexOf } from './sex.js';

const fin = x => typeof x === 'number' && Number.isFinite(x);
const num = (x, lo = -Infinity, hi = Infinity) => {
  if (x == null || x === '' || typeof x === 'boolean') return null;
  const n = Number(x); return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const parseDate = s => {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number); const dt = new Date(y, m - 1, d);
  return Number.isFinite(dt.getTime()) ? dt : null;
};
const ds = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (s, n) => { const d = parseDate(s) || new Date(); d.setDate(d.getDate() + n); return ds(d); };

// Items that replace your testosterone rather than raising your own: listed, never ranked here.
export const EXOGENOUS_IDS = ['trt', 'oral_tu', 'nasal_t'];
// Items that are in the catalogue because they LOWER it. Shown as costs, not as levers.
export const COST_IDS = ['endurance_load', 'alcohol', 'daa'];

// Single candidates: everything that can move a man's own testosterone, plus the well-known null ones, so a man
// who came here asking about tribulus sees "0%, and here is the trial" instead of nothing.
export const SINGLE_IDS = [
  'energy_availability', 'sleep_hygiene', 'fat_loss', 'resistance_training',
  'clomiphene', 'enclomiphene', 'hcg', 'aromatase_inhibitor', 'tamoxifen', 'cabergoline',
  'kisspeptin', 'pulsatile_gnrh',
  'ashwagandha', 'tongkat_ali', 'zma', 'vitamin_d', 'fenugreek', 'boron', 'dhea', 'daa',
  'tribulus', 'maca', 'shilajit', 'forskolin',
];

// Curated combinations. `when` keeps a combination off the list when it could not apply to this man at all
// (so an obese-only pairing doesn't clutter a lean man's list). Every one of these is modeled mechanistically —
// see combineEndogenous() — not by adding the singles up.
export const COMBOS = [
  { ids: ['sleep_hygiene', 'energy_availability'], name: 'Sleep 7–9 h + eat enough',
    why: 'The two central, reversible causes of a low number in a lean, hard-training man. Both raise the set-point, so they do add to each other — unlike the drugs.' },
  { ids: ['sleep_hygiene', 'energy_availability', 'ashwagandha'], name: 'Sleep + eat enough + ashwagandha',
    why: 'The best you can do without a prescription. The herb adds least, and adds it on top of a baseline the first two already raised.' },
  { ids: ['clomiphene', 'hcg'], name: 'Clomiphene + hCG',
    why: 'The combination people ask about most. Habous 2018 randomized it: clomiphene +158, hCG +134, both +153 ng/dL. The combination was no better than clomiphene alone (p=0.57).' },
  { ids: ['clomiphene', 'aromatase_inhibitor'], name: 'Clomiphene + aromatase inhibitor',
    why: 'The classic "SERM plus AI". They push the same lever (less estrogen feedback), so the testosterone effects do not add — and the AI still costs you estrogen action, which costs fat.' },
  { ids: ['hcg', 'aromatase_inhibitor'], name: 'hCG + aromatase inhibitor',
    why: 'Used to blunt the estradiol rise hCG causes. The AI adds no testosterone on top and brings its own fat and bone cost.' },
  { ids: ['enclomiphene', 'hcg'], name: 'Enclomiphene + hCG', why: 'Same shared pathway as clomiphene + hCG, with less of the estrogenic isomer.' },
  { ids: ['clomiphene', 'ashwagandha'], name: 'Clomiphene + ashwagandha', why: 'A supplement on top of a drug: the drug is far stronger and they share the same output, so the herb adds nothing measurable.' },
  { ids: ['sleep_hygiene', 'clomiphene'], name: 'Fix sleep + clomiphene',
    why: 'Lifestyle plus a drug. Fixing sleep raises the baseline first, which SHRINKS what clomiphene can add — the drug\'s response falls as the baseline rises.' },
  { ids: ['fat_loss', 'clomiphene'], name: 'Lose fat + clomiphene', why: 'First-line treatment plus the drug, for obesity-related low testosterone.', when: c => c.bmi != null && c.bmi >= 30 },
  { ids: ['fat_loss', 'aromatase_inhibitor'], name: 'Lose fat + aromatase inhibitor',
    why: 'The exact arm Colleluori 2020 randomized in severely obese hypogonadal men. It is the one population where lowering estradiol did not cost fat.', when: c => c.bmi != null && c.bmi >= 30 },
  { ids: ['cabergoline', 'clomiphene'], name: 'Treat prolactin + clomiphene', why: 'Fix the cause, then push the axis — only if prolactin is actually high.', when: c => c.prolactin != null && c.prolactin > MET.PROLACTIN_HIGH },
  { ids: ['zma', 'vitamin_d'], name: 'Correct zinc + vitamin D', why: 'Correcting real deficiencies. Does nothing if you are replete, which is most men.' },
];

// --------------------------------------------------------------------- labs
export function labStatus(profile) {
  const m = (profile && profile.metabolic) || {};
  const have = [], missing = [];
  for (const L of T_LAB_PANEL) (num(m[L.k], 0, 1e5) != null ? have : missing).push(L);
  return { have, missing, panel: T_LAB_PANEL, complete: missing.length === 0, decisive: num(m.totalT, 1, 5000) != null && num(m.lh, 0, 200) != null };
}

// --------------------------------------------------------------------- core
function entriesFor(ids, start) {
  return ids.map(id => ({ id, start, end: null, dose: null, active: true }));
}
function sameMods(a, b) {
  if (!a || !b) return false;
  for (const k of ['leanCeilingMult', 'leanRetentionMult', 'partitionShift', 'tdeeDelta', 'intakeDelta', 'waterLb', 'leanDirectLbPerWeek', 'fatDirectLbPerWeek']) {
    if (Math.abs((a[k] || 0) - (b[k] || 0)) > 1e-9) return false;
  }
  return Math.abs((a.testosterone?.level || 0) - (b.testosterone?.level || 0)) < 0.5;
}

/**
 * tPlan(profile, opts) → ranked ways to raise this man's own testosterone.
 *
 * opts: { now, age, bodyweightLb, baseline, sessions, bodyLog, foodLog, weeks = 52,
 *         projectFn (PJ.project), modifiersFn (MET.modifiersAt), maxProjections = 16 }
 */
export function tPlan(profile, opts = {}) {
  profile = profile && typeof profile === 'object' ? profile : {};
  const sex = sexOf(profile);
  const now = parseDate(opts.now) || new Date();
  const today = ds(now);
  const weeks = num(opts.weeks, 4, 520) ?? 52;
  const modsFn = typeof opts.modifiersFn === 'function' ? opts.modifiersFn : MET.modifiersAt;
  const projectFn = typeof opts.projectFn === 'function' ? opts.projectFn : null;
  const labs = labStatus(profile);

  if (sex === 'female') {
    // §20: male-axis therapies. Never recommended to women, never ranked, never rendered.
    return { female: true, hidden: true, rows: [], labs, assumptions: [], notes: [], wada: WADA_NOTE,
      why: 'These are therapies for the male hypothalamic–pituitary–testicular axis. None of them has been shown to build muscle in women, and raising a woman\'s own testosterone within the female range did not change lean mass (Huang 2014). Forge does not recommend them to women.' };
  }

  const bw = num(opts.bodyweightLb, 60, 600) ?? num(profile.bodyweight, 60, 600) ?? null;
  const age = num(opts.age, 10, 120) ?? null;
  const modOpts = { age, bodyweightLb: bw, inDeficit: false };
  const base = modsFn(profile, today, modOpts);
  const lv = base.levels || {};
  const ctxFacts = { bmi: MET.bmiOf(profile, bw), prolactin: num(lv.prolactin, 0, 5000), lh: num(lv.lh, 0, 200),
    totalT: num(lv.totalT, 1, 5000), tAssumed: lv.totalTSource === 'assumed', sleepHours: num(lv.sleepHours, 0, 16),
    deficitKcal: num(lv.deficitKcal, 0, 4000), estradiol: num(lv.estradiol, 0, 1000) };

  const inStack = new Set((Array.isArray(profile.supplements) ? profile.supplements : [])
    .filter(e => e && e.active !== false && (!e.end || e.end > today)).map(e => e.id));
  const onExogenous = EXOGENOUS_IDS.some(id => inStack.has(id));

  // Reference projection: what happens if he changes nothing.
  const canProject = !!(projectFn && opts.baseline && opts.baseline.weightLb);
  const projArgs = { baseline: opts.baseline, profile, sessions: opts.sessions, weeks, now, bodyLog: opts.bodyLog, foodLog: opts.foodLog };
  let ref = null;
  if (canProject) { try { ref = projectFn(projArgs); } catch (e) { ref = null; } }
  const refSum = ref && ref.summary ? { lean: Number(ref.summary.leanLb) || 0, fat: Number(ref.summary.fatLb) || 0 } : null;
  const midDate = addDays(today, Math.round(weeks * 7 / 2));
  const refMid = modsFn(profile, midDate, modOpts);

  let projections = 0;
  const maxProj = num(opts.maxProjections, 0, 60) ?? 16;

  const buildRow = cand => {
    const ids = cand.ids;
    const items = ids.map(id => SUPPLEMENTS[id]).filter(Boolean);
    if (items.length !== ids.length) return null;
    const already = ids.every(id => inStack.has(id));
    const addIds = ids.filter(id => !inStack.has(id));
    const list = Array.isArray(profile.supplements) ? profile.supplements : [];
    // Not in the stack: what adding it would do. Already in the stack: what it is currently contributing, which is
    // the same comparison run the other way round, so the row keeps its place and the button becomes "Remove".
    const p2 = already
      ? { ...profile, supplements: list.filter(x => !(x && ids.includes(x.id) && x.active !== false && (!x.end || x.end > today))) }
      : { ...profile, supplements: [...list, ...entriesFor(addIds, today)] };
    const mid = already ? refMid : modsFn(p2, midDate, modOpts);
    const end = modsFn(already ? profile : p2, addDays(today, weeks * 7), modOpts);
    const t = end.testosterone || {};
    const t0 = num(t.natural, 1, 1e5) ?? ctxFacts.totalT ?? 550;

    // Does anything move at all? If not, say so and skip the expensive projection.
    const moves = already ? !sameMods(modsFn(p2, midDate, modOpts), refMid) : !sameMods(mid, refMid);
    const sign = already ? -1 : 1;             // for an in-stack row, p2 is "without it", so flip the comparison
    let lean = 0, fat = 0, projected = false;
    if (moves && canProject && projections < maxProj) {
      try {
        const r = projectFn({ ...projArgs, profile: p2 });
        if (r && r.summary && refSum) {
          lean = sign * ((Number(r.summary.leanLb) || 0) - refSum.lean);
          fat = sign * ((Number(r.summary.fatLb) || 0) - refSum.fat);
          projected = true; projections++;
        }
      } catch (e) { projected = false; }
    }
    if (moves && !projected) {
      // Fallback when no body baseline exists yet: the direct lean/fat the stack adds over the horizon, plus the
      // change in the training-driven ceiling applied to a nominal 1 lb/month of natural gain. Clearly rougher.
      const tl = MET.stackTimeline(p2, { from: today, weeks, age, bodyweightLb: bw });
      const tlRef = MET.stackTimeline(profile, { from: today, weeks, age, bodyweightLb: bw });
      lean = sign * ((tl.cumLeanDirect - tlRef.cumLeanDirect) + (tl.avgCeiling - tlRef.avgCeiling) * (weeks / 4.345));
      fat = sign * (tl.cumFatDirect - tlRef.cumFatDirect);
    }

    // Range: scale the lean/fat point estimate by the log-level ratio at the two ends of the T confidence interval.
    const ln = x => Math.log(Math.max(1, x) / Math.max(1, t0));
    const dLn = ln(t.level ?? t0);
    const scale = v => Math.abs(dLn) < 1e-6 ? [v, v]
      : [v * (ln(t.levelLo ?? t.level ?? t0) / dLn), v * (ln(t.levelHi ?? t.level ?? t0) / dLn)];
    let [leanLo, leanHi] = scale(lean);
    let [fatLo, fatHi] = scale(fat);
    if (t.extrapolated) {
      leanLo = Math.min(0, lean);   // zero is what has actually been measured for these items
      fatHi = Math.max(0, fat);     // ...and the same honesty in the fat direction
    }
    if (leanLo > leanHi) [leanLo, leanHi] = [leanHi, leanLo];
    if (fatLo > fatHi) [fatLo, fatHi] = [fatHi, fatLo];

    // Evidence grade and body-composition class describe the items that are actually DOING something in this
    // man — a combination whose only working part is a herb must not inherit sleep's "strong".
    const contribIds = new Set((mid.contributions || []).filter(c => ids.includes(c.id) && c.role && c.role !== 'zero').map(c => c.id));
    const actingIds = contribIds.size ? [...contribIds] : ids;
    const acting = actingIds.map(id => SUPPLEMENTS[id]).filter(Boolean);
    const bc = acting.map(i => i.model?.bodyComp).filter(Boolean);
    const evidenceOrder = { strong: 4, moderate: 3, weak: 2, preclinical: 1, refuted: 1, none: 0 };
    const evidence = acting.map(i => i.evidence).sort((a, b) => (evidenceOrder[a] ?? 0) - (evidenceOrder[b] ?? 0))[0];
    const why = [];
    for (const c of (mid.contributions || [])) if (ids.includes(c.id) && c.text) why.push(c.text);
    if (onExogenous) why.unshift('You are on exogenous testosterone, which suppresses your own production. Nothing that works through your own axis does anything while you are on it.');

    return {
      id: ids.join('+'), ids, name: cand.name || items.map(i => i.name.split(' (')[0]).join(' + '),
      combo: ids.length > 1, rationale: cand.why || null, inStack: already, partlyInStack: !already && addIds.length < ids.length,
      // An item can be classed 'measured' in the catalogue and still be EXTRAPOLATED for this particular man:
      // clomiphene's body composition was measured in obese men who ended near 500 ng/dL, so a eugonadal man
      // taken to 800 is past the evidence even though the item's class says 'measured'. The per-man flag from
      // combineEndogenous wins, both for the badge and for the ranking score below.
      rx: items.some(isRx), evidence,
      bodyComp: t.extrapolated ? 'extrapolated' : bc.includes('measured') ? 'measured' : bc.includes('extrapolated') ? 'extrapolated' : 'none',
      extrapolated: !!t.extrapolated, cost: ids.some(id => COST_IDS.includes(id)),
      applies: moves || already,
      t: { from: Math.round(t0), to: Math.round(t.level ?? t0), lo: Math.round(t.levelLo ?? t.level ?? t0), hi: Math.round(t.levelHi ?? t.level ?? t0),
        credited: Math.round(t.leanLevel ?? t.level ?? t0) },
      freeT: { from: t.freeTBase != null ? r1(t.freeTBase) : null, to: t.freeT != null ? r1(t.freeT) : null },
      e2: { from: t.estradiolBase != null ? r1(t.estradiolBase) : null, to: t.estradiol != null ? r1(t.estradiol) : null, assumed: !!t.estradiolAssumed, actionDrop: t.e2ActionDrop || 0 },
      shbg: t.shbg != null ? r1(t.shbg) : null,
      lean: { lb: r2(lean), lo: r2(leanLo), hi: r2(leanHi) },
      fat: { lb: r2(fat), lo: r2(fatLo), hi: r2(fatHi) },
      projected, weeks,
      // Ranking score. An item whose body-composition effect has never been MEASURED is ranked on the
      // conservative end of its own range (which is zero), not on the mid-point of an extrapolation
      // through the T->lean curve. Otherwise a drug with a published T rise and no body-composition
      // trial outranks everything that has actually been measured. The mid-point still shows on the row.
      score: r2(bc.includes('measured') && !t.extrapolated ? lean - fat : leanLo - fatHi),
      why, monitor: [...new Set(items.flatMap(i => i.model?.monitor || []))],
      suits: items.map(i => i.model?.suits).filter(Boolean), notSuits: items.map(i => i.model?.notSuits).filter(Boolean),
      wada: [...new Set(items.map(i => i.model?.wada).filter(w => w && !/^not prohibited/i.test(w)))],
      fertility: items.map(i => i.model?.fertility).filter(Boolean),
      bcNote: items.map(i => i.model?.bcNote).filter(Boolean),
      warnings: (mid.warnings || []).filter(w => items.some(i => w.includes(i.name.split(' (')[0]))),
    };
  };

  const rows = [];
  for (const id of SINGLE_IDS) { const r = buildRow({ ids: [id] }); if (r) rows.push(r); }
  for (const c of COMBOS) {
    if (typeof c.when === 'function' && !c.when(ctxFacts)) continue;
    const r = buildRow(c); if (r) rows.push(r);
  }
  // Rank by what it does to his body, not by the size of the testosterone number.
  const evOrder = { strong: 4, moderate: 3, weak: 2, preclinical: 1, refuted: 1, none: 0 };
  rows.sort((a, b) => (b.score - a.score)
    || ((evOrder[b.evidence] ?? 0) - (evOrder[a.evidence] ?? 0))
    || (Number(a.rx) - Number(b.rx))
    || a.name.localeCompare(b.name));

  // ---- what to do first
  const actions = [];
  if (!labs.decisive) {
    actions.push({ id: 'labs', kind: 'labs', title: 'Get the panel before anything else',
      body: 'Everything below is gated on numbers you have not entered, so most of it reads as zero — which is honest, not useful. One morning draw changes that. Ask for it fasted, between 7 and 10 am, and repeat the testosterone on a separate day before acting on it: it is pulsatile and a single low reading means little.',
      labs: labs.missing.map(L => ({ k: L.k, label: L.label, why: L.why })) });
  }
  const assumptions = [...(base.assumptions || [])];
  if (ctxFacts.estradiol == null) assumptions.push(`Estradiol: assumed ${MET.ASSUMED_E2} pg/mL (mid adult male reference). It decides whether an aromatase inhibitor makes any sense at all.`);
  if (num((profile.metabolic || {}).shbg, 1, 300) == null) assumptions.push(`SHBG: assumed ${MET.ASSUMED_SHBG} nmol/L (mid adult male reference), used to compute free testosterone.`);
  if (ctxFacts.deficitKcal == null) assumptions.push('Typical daily calorie deficit: not entered, so Forge models no energy-availability cost. For a lean man on an appetite-suppressing medication with a high training load, that is the assumption most likely to be wrong.');

  const notes = [];
  if (onExogenous) notes.push('You have exogenous testosterone in your stack. It suppresses your own production, so every option here is modeled at zero until you come off it.');
  notes.push('Ranked by modeled 12-month lean and fat change, not by how much the testosterone number moves. Those are different lists: the aromatase inhibitor produces the biggest number here and, in the trials that measured it, no muscle at all.');

  return {
    female: false, hidden: false, labs, actions, rows, notes, assumptions, wada: WADA_NOTE,
    exogenous: EXOGENOUS_IDS.map(id => ({ id, name: SUPPLEMENTS[id]?.name })),
    facts: ctxFacts, weeks, projected: canProject, projections,
  };
}

export const WADA_NOTE = 'If you ever race in a drug-tested event: SERMs and other anti-estrogens (clomiphene, enclomiphene, tamoxifen) are WADA-prohibited at all times under S4.2, aromatase inhibitors under S4.1, hCG in males under S2.2, and testosterone by any route under S1. Ashwagandha, tongkat ali, cabergoline, sleep and food are not prohibited.';

// Convenience for the UI: the stack entries a row (or a bare list of ids) would add.
export function rowEntries(row, today) { return entriesFor(Array.isArray(row) ? row : (row?.ids || []), today); }
