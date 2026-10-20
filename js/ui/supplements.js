// Supplements, therapies & metabolic values (route 'supplements', SUPP, CONTRACT §17 + amendment).
// CONTRACT-NOTE: reads/writes profile.supplements and profile.metabolic via store.updateProfile only.
//   Stack entry dose is stored as { value, unit } (unit = the catalogue model's unit) or null (= studied/common dose).
// CONTRACT-NOTE: the 12-week with/without comparison calls project() twice: once normally and once with
//   useStack:false (and supplements:[] as a belt-and-braces fallback for engines without that option). If the
//   two runs are identical while the stack clearly changes the modifiers, it says the engine isn't using the stack yet.
import { esc } from './components.js';
import { SUPPLEMENTS, NOT_MODELED, CATEGORIES, EVIDENCE, isUnapproved, isModeled, itemFor } from '../data/supplements.js';
import { modifiersAt, testosteroneEffect, averageTotalT, resolveDose, stackAt, T_MODEL, T_MODEL_F } from '../engine/metabolic.js';
import { tPlan, rowEntries } from '../engine/tplan.js';
import { sexOf, femaleStatus, FEMALE_LABS, FEMALE_T_RANGE } from '../engine/sex.js';
// CONTRACT-NOTE (§20 Female mode): for women the catalogue reads through itemFor(item, 'female'), labs show female
//   reference ranges, the testosterone chart is on a female scale (Huang 2014 + trans-men fit, 24-week lean change),
//   placeholders use female population averages, and the "You take Adderall" hint (Bob-specific) is not shown.
import * as BC from '../engine/bodycomp.js';
import * as PJ from '../engine/projection.js';
import { ds, fmtShort, daysBetween } from '../util.js';

export function title() { return 'Supplements & Metabolism'; }
// Updates its own regions in place (impact card, lab badges) so editing labs never tears down the form.
export const autoRerender = false;

const ui = { cat: 'supplement', showStopped: false };
const safe = (fn, fb) => { try { const v = fn(); return v == null ? fb : v; } catch (e) { console.error(e); return fb; } };
const f1 = n => { n = Number(n); if (!isFinite(n)) return '—'; const r = Math.round(n * 10) / 10; return Math.abs(r - Math.round(r)) < 0.05 ? String(Math.round(r)) : r.toFixed(1); };
const sgn = (n, dp = 1) => { n = Number(n) || 0; const a = Math.abs(n); const s = dp === 0 ? String(Math.round(a)) : (Math.round(a * 10 ** dp) / 10 ** dp).toString(); return (n > 0.0049 ? '+' : n < -0.0049 ? '−' : '±') + s; };
const mult = n => '×' + (Math.round(Number(n) * 100) / 100).toFixed(2);
const EV_CLS = { strong: 'good', moderate: 'cardio', weak: 'warn', refuted: 'bad', preclinical: 'warn', none: 'bad' };
const CAT_ICON = Object.fromEntries(CATEGORIES.map(c => [c.id, c.icon]));
const evBadge = s => `<span class="badge ${EV_CLS[s.evidence] || ''}" title="${esc(EVIDENCE[s.evidence]?.text || '')}">${esc(EVIDENCE[s.evidence]?.short || s.evidence)}</span>`;
function statusKind(s) {
  if (isUnapproved(s)) return { label: 'Unapproved', cls: 'bad' };
  if (/^prescription/i.test(s.status)) return { label: 'Rx', cls: 'accent' };
  if (s.category === 'lifestyle') return { label: 'Lifestyle', cls: '' };
  return { label: 'OTC', cls: '' };
}
const stBadge = s => { const k = statusKind(s); return `<span class="badge ${k.cls}">${esc(k.label)}</span>`; };
const doseLabel = (entry, s) => {
  if (!isModeled(s) || !s.model.dose) return '';
  const d = resolveDose(entry?.dose, s.model);
  return d ? `${+d.value.toFixed(2)} ${d.unit}${d.assumed ? ` (${s.model.dose.label.split(' (')[0]})` : ''}` : '';
};

function computeMods(I) {
  const p = I.profile;
  const bw = I.b?.weightLb || p.bodyweight || null;
  const mods = safe(() => modifiersAt(p, I.today, { bodyweightLb: bw, age: I.b?.age }), null);
  const off = safe(() => modifiersAt(p, I.today, { bodyweightLb: bw, age: I.b?.age, useStack: false }), null);
  const activeIds = new Set(safe(() => stackAt(p, I.today), []).filter(a => a.phase === 'on').map(a => a.entry.id));
  return { mods, off, activeIds };
}
function inputs(store) {
  const profile = store.getProfile();
  const bodyLog = safe(() => store.getBodyLog(), []);
  const measurements = safe(() => store.getMeasurements(), []);
  const sessions = safe(() => store.getSessions(), []);
  const foodLog = safe(() => store.getFoodLog(), []);
  const now = new Date();
  const b = safe(() => BC.baseline({ profile, bodyLog, measurements, now, foodLog }), null);
  return { profile, bodyLog, measurements, sessions, foodLog, now, b, today: ds(now) };
}

// ------------------------------------------------------------------ render
export function render(ctx) {
  const I = inputs(ctx.store);
  const p = I.profile;
  const list = Array.isArray(p.supplements) ? p.supplements : [];
  const { mods, off, activeIds } = computeMods(I);
  const sex = sexOf(p);
  const hasAdderall = sex === 'female' || list.some(e => e && e.id === 'adderall' && e.active !== false && !e.end);

  return `<div class="page-head"><h1>Stack & metabolism</h1><p class="sub">Supplements, therapies and lab values, modeled from the published studies.</p></div>
  <div class="card sp-note"><div class="sp-note-ic">ⓘ</div><div class="small">
    Forge projects <b>study averages</b>; your response can differ. Prescription items (testosterone, GLP-1s, GH, stimulants) need a prescriber and lab monitoring. Peptides and SARMs sold as research chemicals are unregulated, so what's in the vial isn't verified. Doses shown are what the trials used, for context.
  </div></div>
  ${hasAdderall ? '' : `<div class="card tight sp-hint row"><div class="grow small">You take Adderall. Add it so its appetite effect shows up in projections.</div><button class="btn btn-sm" data-quickadd="adderall">Add</button></div>`}

  <div class="section-title">Your stack <button class="link" data-jump="sp-add">+ Add</button></div>
  ${stackList(list, mods, I.today, sex)}

  <div class="section-title">What this does to your projection</div>
  <div id="sp-impact-wrap">${impactCard(I, mods, off, activeIds)}</div>

  ${sex === 'female' ? '' : `<div class="section-title" id="sp-plan">Raise your own testosterone</div>
  <div id="sp-plan-wrap">${planCard(I)}</div>`}

  <div class="section-title">Metabolic values</div>
  ${metabolicForm(p, I)}

  <div class="section-title" id="sp-add">Add to stack</div>
  <div class="hscroll sp-cats">${CATEGORIES.map(c => `<button type="button" class="chip sm ${ui.cat === c.id ? 'active' : ''}" data-cat="${c.id}">${esc(c.icon)} ${esc(c.short || c.label)}</button>`).join('')}</div>
  <div class="list mt">${Object.values(SUPPLEMENTS).filter(s => s.category === ui.cat).map(s => browseRow(itemFor(s, sex), activeIds.has(s.id))).join('')}</div>
  <div class="sp-legend">${['strong', 'moderate', 'weak', 'refuted', 'preclinical', 'none'].map(k => `<div><span class="badge ${EV_CLS[k]}">${esc(EVIDENCE[k].short)}</span><span class="tiny muted">${esc({ strong: 'meta-analyses agree', moderate: 'trials support it', weak: 'small or inconsistent', refuted: 'trials found nothing', preclinical: 'animals only', none: 'no human data' }[k])}</span></div>`).join('')}</div>

  <div class="section-title">Not modeled</div>
  <div class="card sp-nm">
    <p class="small">Forge won't project these. They carry serious health risks and there's no responsible dose–response data to model. If you're considering any of them, talk to a physician.</p>
    <ul class="sp-nm-list">${NOT_MODELED.map(n => `<li><b>${esc(n.name)}</b><span class="muted small">${esc(n.why)}</span></li>`).join('')}</ul>
  </div>
  <p class="tiny muted center mt2">Not medical advice. Effects are averages from the cited trials; individual responses vary widely.</p>`;
}

function stackList(list, mods, today, sex = 'male') {
  const rows = list.map((e, i) => ({ e, i, s: itemFor(SUPPLEMENTS[e?.id], sex) })).filter(x => x.s);
  const current = rows.filter(x => x.e.active !== false && !(x.e.end && x.e.end <= today));
  const stopped = rows.filter(x => !current.includes(x));
  const contrib = new Map((mods?.contributions || []).filter(c => c.kind === 'stack').map(c => [c.id, c]));
  if (!current.length && !stopped.length) {
    return `<div class="card sp-empty"><div class="big">🧪</div><p class="small muted">Nothing in your stack. Add creatine, a prescription you take, or anything you're curious about to see its modeled effect.</p></div>`;
  }
  const row = ({ e, i, s }) => {
    const c = contrib.get(s.id);
    const future = e.start && e.start > today;
    const wk = e.start && !future ? Math.floor(daysBetween(e.start, today) / 7) + 1 : null;
    const ramp = c?.rampPct;
    const meta = [future ? `Starts ${fmtShort(e.start)}` : e.start ? `Since ${fmtShort(e.start)} · week ${wk}` : 'Start date not set', doseLabel(e, s)].filter(Boolean).join(' · ');
    return `<div class="list-item sp-row" data-edit="${i}" role="button" tabindex="0">
      <span class="ic">${esc(CAT_ICON[s.category] || '•')}</span>
      <div class="grow"><div class="t">${esc(s.name)}</div><div class="s">${esc(meta)}</div>
        <div class="sp-badges">${evBadge(s)}${stBadge(s)}${isModeled(s) ? '' : '<span class="badge">No modeled effect</span>'}</div>
        ${isModeled(s) && ramp != null && !future ? `<div class="sp-ramp"><div class="bar thin"><i style="width:${Math.max(2, ramp)}%"></i></div><span class="tiny muted">${ramp >= 100 ? 'Full effect' : ramp === 0 ? 'Just started' : `${ramp}% of full effect`}</span></div>` : ''}
      </div>
      <button class="btn btn-sm btn-ghost" data-stop="${i}" aria-label="Stop ${esc(s.name)}">Stop</button>
    </div>`;
  };
  return `${current.length ? `<div class="list">${current.map(row).join('')}</div>` : '<p class="small muted sp-pad">No active items.</p>'}
    ${stopped.length ? `<details class="sp-stopped" ${ui.showStopped ? 'open' : ''}><summary class="small muted">Stopped (${stopped.length})</summary>
      <div class="list mt">${stopped.map(({ e, i, s }) => `<div class="list-item"><div class="grow"><div class="t">${esc(s.name)}</div><div class="s">${e.start ? fmtShort(e.start) : '?'} – ${e.end ? fmtShort(e.end) : 'stopped'}</div></div>
        <button class="btn btn-sm" data-restart="${i}">Restart</button><button class="btn btn-sm btn-ghost" data-remove="${i}" aria-label="Remove">✕</button></div>`).join('')}</div></details>` : ''}`;
}

function browseRow(s, inStack) {
  return `<button class="list-item sp-brow" data-detail="${s.id}">
    <div class="grow"><div class="t">${esc(s.name)}</div>
      <div class="sp-badges">${evBadge(s)}${stBadge(s)}${inStack ? '<span class="badge good">In stack</span>' : ''}</div>
      <div class="s sp-sum">${esc(s.summary)}</div></div>
    <span class="chev">›</span></button>`;
}

// ------------------------------------------------------------------ impact
function projectionPair(I) {
  if (!I.b || !I.b.weightLb || typeof PJ.project !== 'function') return { reason: 'weight' };
  const base = { baseline: I.b, profile: I.profile, sessions: I.sessions, weeks: 12, now: I.now, bodyLog: I.bodyLog, foodLog: I.foodLog };
  const withS = safe(() => PJ.project(base), null);
  const without = safe(() => PJ.project({ ...base, profile: { ...I.profile, supplements: [] }, useStack: false }), null);
  if (!withS?.summary || !without?.summary) return { reason: 'error' };
  const pick = r => ({ lean: Number(r.summary.leanLb) || 0, fat: Number(r.summary.fatLb) || 0, weight: Number(r.summary.weightLb) || 0, water: Number(r.summary.waterLb) || 0 });
  return { withS: pick(withS), without: pick(without), stack: withS.stack || null };
}
function compareBars(a, b) {
  const rows = [['Lean mass', a.lean, b.lean], ['Fat mass', a.fat, b.fat], ['Scale weight', a.weight, b.weight]];
  const max = Math.max(0.5, ...rows.flatMap(r => [Math.abs(r[1]), Math.abs(r[2])]));
  const bar = (v, cls) => {
    const w = Math.abs(v) / max * 50;
    return `<div class="sp-cb-track"><span class="sp-cb-zero"></span><i class="${cls}" style="${v >= 0 ? `left:50%;width:${w}%;border-radius:0 4px 4px 0` : `left:${50 - w}%;width:${w}%;border-radius:4px 0 0 4px`}"></i></div>`;
  };
  return `<div class="sp-cmp">${rows.map(([l, w, wo]) => `<div class="sp-cb">
      <div class="row between"><span class="small bold">${l}</span><span class="small num"><b>${sgn(w)} lb</b> <span class="muted">vs ${sgn(wo)} without</span></span></div>
      <div class="sp-cb-line"><span class="tiny muted sp-cb-k"><i class="sp-key on"></i>Stack</span>${bar(w, 'on')}</div>
      <div class="sp-cb-line"><span class="tiny muted sp-cb-k"><i class="sp-key off"></i>Without</span>${bar(wo, 'off')}</div>
    </div>`).join('')}</div>`;
}

function impactCard(I, mods, off, activeIds) {
  if (!mods) return '<div class="card"><p class="small muted">Couldn\'t compute modifiers.</p></div>';
  const stackItems = mods.contributions.filter(c => c.kind === 'stack');
  const metaItems = mods.contributions.filter(c => c.kind === 'metabolic');
  const tiles = [];
  tiles.push(['Muscle-gain ceiling', mult(mods.leanCeilingMult), `${mult(off?.leanCeilingMult ?? 1)} without stack · vs average ${mods.levels?.sex === 'female' ? 'female ' : ''}lifter`]);
  tiles.push(['Lean loss in a deficit', mult(mods.leanRetentionMult), mods.leanRetentionMult > 1.005 ? 'more muscle lost when cutting' : mods.leanRetentionMult < 0.995 ? 'better muscle protection' : 'baseline protection']);
  if (Math.abs(mods.leanDirectLbPerWeek) >= 0.005) tiles.push(['Lean without training', `${sgn(mods.leanDirectLbPerWeek, 2)} lb/wk`, 'right now; tapers over time']);
  if (Math.abs(mods.fatDirectLbPerWeek) >= 0.005) tiles.push(['Direct fat change', `${sgn(mods.fatDirectLbPerWeek, 2)} lb/wk`, 'independent of calories']);
  if (mods.waterLb >= 0.05) tiles.push(['Water weight', `+${f1(mods.waterLb)} lb`, 'on the scale, not muscle or fat']);
  if (mods.intakeDelta) tiles.push(['Appetite', `${sgn(mods.intakeDelta, 0)} kcal/day`, 'applied when calories aren\'t set']);
  if (mods.tdeeDelta) tiles.push(['Calorie burn', `${sgn(mods.tdeeDelta, 0)} kcal/day`, 'added to maintenance']);
  const tt = mods.testosterone;
  if (tt && (tt.source === 'endogenous' || tt.source === 'measured') && Math.abs(tt.level - tt.natural) >= 5) {
    tiles.push([tt.level > tt.natural ? 'Your own testosterone' : 'Testosterone cost',
      `≈${Math.round(tt.level).toLocaleString()} ng/dL`,
      `${tt.source === 'measured' ? 'your measured lab' : 'modeled'}, from ${Math.round(tt.natural).toLocaleString()}${tt.naturalSource === 'assumed' ? ' (assumed)' : ''}${tt.leanLevel != null && Math.abs(tt.leanLevel - tt.level) > 5 ? ` · muscle credited to ≈${Math.round(tt.leanLevel).toLocaleString()}` : ''}`]);
  }

  const pair = activeIds.size ? projectionPair(I) : null;
  let cmp = '';
  if (pair?.withS) {
    const same = ['lean', 'fat', 'weight'].every(k => Math.abs(pair.withS[k] - pair.without[k]) < 0.05);
    const modsDiffer = Math.abs(mods.leanCeilingMult - (off?.leanCeilingMult ?? 1)) > 0.01 || Math.abs(mods.leanDirectLbPerWeek) > 0.01 || mods.waterLb > 0.05 || mods.intakeDelta || mods.tdeeDelta;
    cmp = same && modsDiffer && !pair.stack
      ? '<p class="small muted mt">The projection engine isn\'t applying the stack yet, so only the modifiers are shown.</p>'
      : `<div class="sp-sub">Next 12 weeks, same plan and calories</div>${compareBars(pair.withS, pair.without)}
         ${pair.withS.water >= 0.1 ? `<p class="tiny muted">Scale weight includes ${sgn(pair.withS.water)} lb of water from the stack.</p>` : ''}
         ${same ? '<p class="tiny muted">At your current settings the stack doesn\'t change the 12-week outcome (e.g. appetite effects only apply when calories aren\'t set).</p>' : ''}`;
  } else if (pair?.reason === 'weight') cmp = '<p class="small muted mt">Log your bodyweight to see a 12-week with/without comparison.</p>';

  const t = mods.testosterone;
  const tMoved = t && t.source !== 'natural' && Math.abs(t.level - t.natural) >= 5;
  const tShow = activeIds.has('trt') || tMoved || (I.profile.metabolic?.totalT != null);
  const tLevel = activeIds.has('trt') || tMoved ? t?.level : null;
  const fem = mods.levels?.sex === 'female';
  const tBlock = tShow && t ? `<div class="sp-sub">Testosterone dose–response (${fem ? 'Huang 2014 in women + trans-men cohorts' : 'Bhasin 1996/2001 fit'})</div>
    <div class="sp-chart" data-tchart='${esc(JSON.stringify({ natural: t.natural, level: tLevel, age: mods.levels?.age, sex: fem ? 'female' : 'male' }))}'>${tChart({ natural: t.natural, level: tLevel, age: mods.levels?.age, sex: fem ? 'female' : 'male' })}<div class="sp-readout small muted">Drag across the chart to read values.</div></div>
    <p class="tiny muted">${fem ? `Lean change over 24 weeks without training, vs serum total T, relative to your natural ${Math.round(t.natural)} ng/dL${t.naturalSource === 'assumed' ? ' (assumed average)' : ''}. Women's natural range is about ${FEMALE_T_RANGE[0]}–${FEMALE_T_RANGE[1]} ng/dL; the effect is held flat above ~${T_MODEL_F.leanPlateau} and Forge doesn't extrapolate past ~${T_MODEL_F.studiedMax.toLocaleString()}.` : `Lean change over 20 weeks without training, vs serum total T, relative to your natural ${Math.round(t.natural)} ng/dL${t.naturalSource === 'assumed' ? ' (assumed average)' : ''}. Flat past ~${T_MODEL.studiedMax.toLocaleString()}: beyond the studied range Forge doesn't extrapolate. `}</p>` : '';

  return `<div class="card sp-impact">
    <div class="sp-tiles">${tiles.map(([l, v, s]) => `<div class="stat"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="tiny muted">${esc(s)}</div></div>`).join('')}</div>
    ${cmp}
    ${tBlock}
    ${stackItems.length ? `<div class="sp-sub">What each item does</div><ul class="sp-contrib">${stackItems.map(c => {
      const s = SUPPLEMENTS[c.id];
      return `<li><div class="row between"><b class="small">${esc(c.name)}</b>${s ? evBadge(s) : ''}</div><div class="small muted">${esc(c.text)}${c.assumedAverage ? ' <span class="sp-assumed">assumed average</span>' : ''}</div></li>`;
    }).join('')}</ul>` : '<p class="small muted mt">Your stack is empty, so the projection uses your metabolic values only.</p>'}
    ${mods.warnings.length ? `<div class="sp-sub">Interactions & flags</div><ul class="sp-warn">${mods.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${mods.risks.length ? `<div class="sp-sub">Reported risks at your dose/level</div><ul class="sp-risk">${[...new Map(mods.risks.map(r => [r.text, r])).values()].map(r => `<li><b>${esc(SUPPLEMENTS[r.id]?.name.split(' (')[0] || r.name)}:</b> ${esc(r.text)}</li>`).join('')}</ul>` : ''}
    <details class="sp-factors"><summary class="small">Metabolic factors (${metaItems.length})</summary>
      <ul class="sp-contrib">${(mods.factors || []).map(f => `<li><div class="row between"><b class="small">${esc(f.label)}</b><span class="small num">${mult(f.mult)}${f.retention && Math.abs(f.retention - 1) > 0.004 ? ` · loss ${mult(f.retention)}` : ''}</span></div><div class="small muted">${esc(f.note)}${f.assumed ? ' <span class="sp-assumed">assumed</span>' : ''}</div></li>`).join('')}</ul>
      ${mods.notes.length ? `<ul class="sp-notes">${mods.notes.map(n => `<li class="small muted">${esc(n)}</li>`).join('')}</ul>` : ''}
    </details>
  </div>`;
}

// ------------------------------------------------------------------ §22 "Raise your own testosterone" planner
// CONTRACT-NOTE: the numbers come from js/engine/tplan.js, which runs every candidate through the same
//   modifiersAt() and project() the Projection screen uses, so adding a row here changes Projection by exactly
//   what the row said it would. §20: the whole section is absent for a female profile.
const PLAN_MAX = 8;
const planUi = { showZero: false, showCost: false, open: null };
const bcBadge = r => r.bodyComp === 'measured'
  ? '<span class="badge good" title="Trials of this item measured body composition.">Measured</span>'
  : r.bodyComp === 'extrapolated'
    ? '<span class="badge warn" title="No body-composition data. The lean number is extrapolated through the testosterone→lean curve.">Extrapolated</span>'
    : '<span class="badge bad" title="Trials measured body composition on it and found none.">No muscle effect</span>';
const rng = (lo, hi, dp = 1) => `${sgn(lo, dp)} to ${sgn(hi, dp)}`;

function planRow(r) {
  const open = planUi.open === r.id;
  const tMoved = Math.abs(r.t.to - r.t.from) >= 2;
  const e2Moved = r.e2.from != null && r.e2.to != null && Math.abs(r.e2.to - r.e2.from) >= 0.5;
  const nums = [];
  nums.push(`<div class="sp-pn"><span class="k">Total T</span><b>${tMoved ? `${r.t.from} → ${r.t.to}` : `${r.t.from} (no change)`}</b>${tMoved && r.t.hi !== r.t.lo ? `<span class="tiny muted">range ${r.t.lo}–${r.t.hi} ng/dL</span>` : '<span class="tiny muted">ng/dL</span>'}</div>`);
  if (r.freeT.to != null) nums.push(`<div class="sp-pn"><span class="k">Free T</span><b>${f1(r.freeT.from)} → ${f1(r.freeT.to)}</b><span class="tiny muted">pg/mL (Vermeulen)</span></div>`);
  if (r.e2.from != null) nums.push(`<div class="sp-pn"><span class="k">Estradiol</span><b>${e2Moved ? `${f1(r.e2.from)} → ${f1(r.e2.to)}` : `${f1(r.e2.from)} (no change)`}</b><span class="tiny muted">pg/mL${r.e2.assumed ? ' · assumed' : ''}</span></div>`);
  nums.push(`<div class="sp-pn ${r.lean.lb > 0.05 ? 'good' : ''}"><span class="k">Lean</span><b>${sgn(r.lean.lb)} lb</b><span class="tiny muted">${rng(r.lean.lo, r.lean.hi)} over ${Math.round(r.weeks / 4.345)} mo</span></div>`);
  nums.push(`<div class="sp-pn ${r.fat.lb < -0.05 ? 'good' : r.fat.lb > 0.05 ? 'bad' : ''}"><span class="k">Fat</span><b>${sgn(r.fat.lb)} lb</b><span class="tiny muted">${rng(r.fat.lo, r.fat.hi)}</span></div>`);
  return `<div class="sp-prow ${open ? 'open' : ''}${r.inStack ? ' in' : ''}" data-prow="${esc(r.id)}">
    <button class="sp-phead" data-popen="${esc(r.id)}" aria-expanded="${open}">
      <div class="grow"><div class="t">${esc(r.name)}</div>
        <div class="sp-badges">${r.rx ? '<span class="badge accent">℞ prescriber</span>' : ''}${r.combo ? '<span class="badge">Combination</span>' : ''}<span class="badge ${EV_CLS[r.evidence] || ''}">${esc(EVIDENCE[r.evidence]?.short || r.evidence)}</span>${bcBadge(r)}${r.inStack ? '<span class="badge good">In stack</span>' : ''}</div>
      </div>
      <div class="sp-pscore"><b class="${r.score > 0.05 ? 'good' : r.score < -0.05 ? 'bad' : 'muted'}">${sgn(r.score)}</b><span class="tiny muted">lb net</span></div>
      <span class="chev">${open ? '⌄' : '›'}</span>
    </button>
    <div class="sp-pnums">${nums.join('')}</div>
    ${open ? `<div class="sp-pdetail">
      ${r.rationale ? `<p class="small">${esc(r.rationale)}</p>` : ''}
      ${r.why.map(w => `<p class="small muted">${esc(w)}</p>`).join('')}
      ${r.bcNote.map(n => `<p class="tiny muted">${esc(n)}</p>`).join('')}
      ${r.warnings.map(w => `<p class="small sp-pwarn">${esc(w)}</p>`).join('')}
      ${r.suits.length ? `<p class="small"><b>Suits:</b> ${esc(r.suits.join(' '))}</p>` : ''}
      ${r.notSuits.length ? `<p class="small"><b>Not for:</b> ${esc(r.notSuits.join(' '))}</p>` : ''}
      ${r.fertility.length ? `<p class="small"><b>Fertility:</b> ${esc(r.fertility.join(' '))}</p>` : ''}
      ${r.monitor.length ? `<p class="small"><b>Labs to watch:</b> ${esc(r.monitor.join(' · '))}</p>` : ''}
      ${r.wada.length ? `<p class="tiny muted"><b>Anti-doping:</b> ${esc(r.wada.join(' '))}</p>` : ''}
      ${r.rx ? '<p class="tiny muted">Prescription item: needs a physician, a diagnosis and lab monitoring. Forge reports what the trials measured; it does not tell you to take anything.</p>' : ''}
      ${r.projected ? '' : '<p class="tiny muted">Lean and fat here are from the stack model rather than your full projection (log a bodyweight to get the full one).</p>'}
      <div class="sp-pact"><button class="btn btn-sm ${r.inStack ? '' : 'btn-primary'}" data-ptoggle="${esc(r.id)}">${r.inStack ? 'Remove from stack' : r.combo ? 'Add both to stack' : 'Add to stack'}</button>
        ${r.ids.map(id => `<button class="btn btn-sm btn-ghost" data-detail="${esc(id)}">${esc(SUPPLEMENTS[id]?.name.split(' (')[0] || id)} details</button>`).join('')}</div>
    </div>` : ''}
  </div>`;
}

function planCard(I) {
  const plan = safe(() => tPlan(I.profile, { now: I.now, age: I.b?.age, bodyweightLb: I.b?.weightLb || I.profile.bodyweight,
    baseline: I.b, sessions: I.sessions, bodyLog: I.bodyLog, foodLog: I.foodLog, weeks: 52,
    projectFn: typeof PJ.project === 'function' ? PJ.project : null }), null);
  if (!plan || plan.hidden) return '';
  const act = (plan.actions || []).find(a => a.kind === 'labs');
  const worth = plan.rows.filter(r => r.applies && !r.cost && r.score > 0.05);
  const negative = plan.rows.filter(r => r.applies && !r.cost && r.score <= 0.05);
  const zero = plan.rows.filter(r => !r.applies && !r.cost);
  const cost = plan.rows.filter(r => r.cost);
  const shown = worth.slice(0, PLAN_MAX);
  return `<div class="card sp-plan">
    <p class="small">Every published way to raise your <b>own</b> testosterone, ranked by what Forge models it doing to your <b>lean and fat mass over 12 months</b> — not by how much it moves the number. Those are different lists.</p>
    ${act ? `<div class="sp-plabs"><div class="t">① ${esc(act.title)}</div><p class="small">${esc(act.body)}</p>
      <ul class="sp-plablist">${act.labs.map(l => `<li><b>${esc(l.label)}</b><span class="tiny muted">${esc(l.why)}</span></li>`).join('')}</ul></div>` : ''}
    ${plan.notes.map(n => `<p class="tiny muted">${esc(n)}</p>`).join('')}
    ${shown.length ? `<div class="sp-sub">Worth considering for you</div><div class="sp-plist">${shown.map(planRow).join('')}</div>`
      : `<p class="small muted mt">On the values Forge has for you, <b>nothing here is modeled to add lean mass</b>. That is the honest answer, not a gap: almost every therapy in this area was tested in men who were hypogonadal, obese, or both. Open the list below to see each one's number and the reason it is zero.</p>`}
    ${negative.length ? `<details class="sp-pmore"><summary class="small">Changes something, but not in your favour (${negative.length})</summary><div class="sp-plist">${negative.map(planRow).join('')}</div></details>` : ''}
    ${zero.length ? `<details class="sp-pmore" ${planUi.showZero ? 'open' : ''} data-pzero><summary class="small">Modeled at ~0 for you, with the reason (${zero.length})</summary><div class="sp-plist">${zero.map(planRow).join('')}</div></details>` : ''}
    ${cost.length ? `<details class="sp-pmore" ${planUi.showCost ? 'open' : ''} data-pcost><summary class="small">What might be costing you (${cost.length})</summary><div class="sp-plist">${cost.map(planRow).join('')}</div></details>` : ''}
    <details class="sp-pmore"><summary class="small">Replacing testosterone instead (not "your own")</summary>
      <p class="small muted">These put testosterone in from outside and suppress your own production: ${plan.exogenous.map(e => esc(e.name.split(' (')[0])).join(', ')}. Nasal testosterone is the partial exception — in one uncontrolled study LH stayed normal in 73% of men and sperm counts held up. They are in the catalogue below with their own evidence.</p></details>
    ${plan.assumptions.length ? `<details class="sp-pmore"><summary class="small">What Forge assumed about you (${plan.assumptions.length})</summary><ul class="sp-notes">${plan.assumptions.map(a => `<li class="small muted">${esc(a)}</li>`).join('')}</ul></details>` : ''}
    <p class="tiny muted mt"><b>Anti-doping:</b> ${esc(plan.wada)}</p>
    <p class="tiny muted">Not medical advice. Prescription items need a prescriber; the numbers are study averages with the ranges shown, and your response can differ.</p>
  </div>`;
}

// Testosterone curve: x = serum total T (log scale), y = 20-week direct lean change (lb) vs the natural level.
const TC = { W: 340, H: 186, L: 34, R: 12, T: 24, B: 30, lo: 200, hi: 3000 };
// Female chart (§20): log axis from below the female range to beyond the trans-men levels.
const TCF = { lo: 8, hi: 2000, ticks: [20, 60, 200, 600, 1500], max: () => T_MODEL_F.studiedMax };
const tcOf = sex => (sex === 'female' ? { ...TC, lo: TCF.lo, hi: TCF.hi } : TC);
function tScale(natural, age, sex = 'male') {
  const C = tcOf(sex);
  const xs = [], N = 60;
  for (let i = 0; i <= N; i++) xs.push(Math.exp(Math.log(C.lo) + (Math.log(C.hi) - Math.log(C.lo)) * i / N));
  const pts = xs.map(t => ({ t, y: testosteroneEffect(t, { baselineT: natural, weeksOn: 0, age, sex }).lean20Lb }));
  let yMin = Math.min(0, ...pts.map(p => p.y)), yMax = Math.max(1, ...pts.map(p => p.y));
  const step = yMax - yMin > 16 ? 5 : yMax - yMin > 6 ? 2 : 1;
  yMin = Math.floor(yMin / step) * step; yMax = Math.ceil(yMax / step) * step;
  const X = t => C.L + (Math.log(t) - Math.log(C.lo)) / (Math.log(C.hi) - Math.log(C.lo)) * (C.W - C.L - C.R);
  const Y = y => C.T + (yMax - y) / (yMax - yMin) * (C.H - C.T - C.B);
  return { pts, X, Y, yMin, yMax, step };
}
export function tChart({ natural, level = null, age = null, sex = 'male' }) {
  const fem = sex === 'female';
  const C = tcOf(sex), maxT = fem ? T_MODEL_F.studiedMax : T_MODEL.studiedMax;
  const nat = Number(natural) || averageTotalT(age, sex);
  const { pts, X, Y, yMin, yMax, step } = tScale(nat, age, sex);
  const studied = pts.filter(p => p.t <= maxT), beyond = pts.filter(p => p.t >= maxT);
  const path = arr => arr.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const grid = [];
  for (let y = yMin; y <= yMax + 1e-9; y += step) grid.push(`<line x1="${C.L}" x2="${C.W - C.R}" y1="${Y(y).toFixed(1)}" y2="${Y(y).toFixed(1)}" class="${y === 0 ? 'sp-g0' : 'sp-g'}"/><text x="${C.L - 6}" y="${(Y(y) + 3.5).toFixed(1)}" text-anchor="end">${y > 0 ? '+' : ''}${y}</text>`);
  const xt = (fem ? TCF.ticks : [250, 500, 1000, 2400]).map(t => `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${C.H - C.B}" y2="${C.H - C.B + 4}" class="sp-g"/><text x="${X(t).toFixed(1)}" y="${C.H - C.B + 15}" text-anchor="middle">${t.toLocaleString()}</text>`);
  const dot = (t, cls, label, above) => {
    const e = testosteroneEffect(t, { baselineT: nat, weeksOn: 0, age, sex });
    const x = X(Math.min(C.hi, Math.max(C.lo, e.levelUsed))), y = Y(e.lean20Lb);
    const anchor = x > C.W - 90 ? 'end' : x < C.L + 60 ? 'start' : 'middle';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" class="sp-dot ${cls}"/><text x="${x.toFixed(1)}" y="${(above ? y - 11 : y + 19).toFixed(1)}" text-anchor="${anchor}" class="sp-lbl">${esc(label)}</text>`;
  };
  const onE = level ? testosteroneEffect(level, { baselineT: nat, weeksOn: 0, age, sex }) : null;
  const wk = fem ? 24 : 20;
  return `<svg viewBox="0 0 ${C.W} ${C.H}" class="sp-tsvg" role="img" aria-label="Testosterone level versus ${wk}-week lean change">
    ${grid.join('')}${xt.join('')}
    <text x="${C.W - C.R}" y="${C.H - 3}" text-anchor="end" class="sp-ax">serum total T, ng/dL (log)</text>
    <text x="4" y="10" class="sp-ax">lean, lb / ${wk} wk</text>
    ${fem ? `<rect x="${X(FEMALE_T_RANGE[0]).toFixed(1)}" y="${C.T}" width="${(X(FEMALE_T_RANGE[1]) - X(FEMALE_T_RANGE[0])).toFixed(1)}" height="${C.H - C.T - C.B}" class="sp-beyond" style="opacity:.35"><title>female range</title></rect>` : ''}
    <rect x="${X(maxT).toFixed(1)}" y="${C.T}" width="${(C.W - C.R - X(maxT)).toFixed(1)}" height="${C.H - C.T - C.B}" class="sp-beyond"/>
    <path d="${path(studied)}" class="sp-line"/><path d="${path(beyond)}" class="sp-line sp-line-flat"/>
    ${dot(nat, 'nat', `natural ${Math.round(nat)}`, !onE || onE.lean20Lb < 0)}
    ${onE && Math.abs(onE.levelUsed - nat) > 5 ? dot(level, 'on', `you ${Math.round(onE.levelUsed)}: ${sgn(onE.lean20Lb)} lb`, true) : ''}
    <line class="sp-cross" x1="0" x2="0" y1="${C.T}" y2="${C.H - C.B}" visibility="hidden"/>
    <circle class="sp-cross-dot" r="4.5" cx="0" cy="0" visibility="hidden"/>
  </svg>`;
}
function bindTChart(host) {
  const svg = host.querySelector('svg'), tip = host.querySelector('.sp-readout');
  if (!svg || !tip) return;
  let cfg; try { cfg = JSON.parse(host.dataset.tchart); } catch (e) { return; }
  const sex = cfg.sex === 'female' ? 'female' : 'male', C = tcOf(sex);
  const nat = Number(cfg.natural) || averageTotalT(cfg.age, sex);
  const { X, Y } = tScale(nat, cfg.age, sex);
  const line = svg.querySelector('.sp-cross'), cd = svg.querySelector('.sp-cross-dot');
  const show = ev => {
    const r = svg.getBoundingClientRect();
    const vx = (ev.clientX - r.left) / r.width * C.W;
    const frac = Math.min(1, Math.max(0, (vx - C.L) / (C.W - C.L - C.R)));
    const t = Math.exp(Math.log(C.lo) + frac * (Math.log(C.hi) - Math.log(C.lo)));
    const e = testosteroneEffect(t, { baselineT: nat, weeksOn: 0, age: cfg.age, sex });
    const x = X(t), y = Y(e.lean20Lb);
    line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('visibility', 'visible');
    cd.setAttribute('cx', x); cd.setAttribute('cy', y); cd.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b class="sp-rv">${Math.round(t).toLocaleString()} ng/dL</b> → ${sgn(e.lean20Lb)} lb lean in ${sex === 'female' ? 24 : 20} wk without training · training ceiling ${mult(e.leanCeilingMult)}${e.beyondStudied ? ' · beyond studied range (plateau)' : ''}`;
  };
  const hide = () => { line.setAttribute('visibility', 'hidden'); cd.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

// ------------------------------------------------------------------ metabolic form
const LABS = [
  { k: 'totalT', label: 'Total testosterone (natural)', unit: 'ng/dL', step: '1', ref: 'Normal ≈264–916 (men 19–39); under 300 is low. Morning draw, off therapy.',
    status: v => v < 300 ? ['Low', 'bad'] : v < 400 ? ['Low-normal', 'warn'] : v <= 916 ? ['Normal', 'good'] : ['High', 'warn'] },
  { k: 'freeT', label: 'Free testosterone', unit: 'pg/mL', step: '0.1', ref: 'Roughly 50–210 (calculated or dialysis). Assays vary a lot.',
    status: v => v < 50 ? ['Low', 'warn'] : v <= 210 ? ['Normal', 'good'] : ['High', 'warn'] },
  { k: 'onTrtT', label: 'Total T measured on therapy', unit: 'ng/dL', step: '1', ref: 'If you\'re on testosterone (trough draw) or on anything that raises your own T. A measured lab always beats the model.',
    status: v => v > T_MODEL.studiedMax ? ['Beyond studied', 'warn'] : v > 1100 ? ['Above normal', 'warn'] : v >= 400 ? ['Normal range', 'good'] : ['Low', 'warn'] },
  { k: 'vitD', label: 'Vitamin D, 25(OH)D', unit: 'ng/mL', step: '0.1', ref: '<20 deficient · 20–30 adequate · 30–100 sufficient.',
    status: v => v < 20 ? ['Deficient', 'bad'] : v < 30 ? ['Adequate', ''] : v <= 100 ? ['Sufficient', 'good'] : ['High', 'warn'] },
  { k: 'hba1c', label: 'HbA1c', unit: '%', step: '0.1', ref: '<5.7 normal · 5.7–6.4 prediabetes · ≥6.5 diabetes range.',
    status: v => v < 5.7 ? ['Normal', 'good'] : v < 6.5 ? ['Prediabetes', 'warn'] : ['Diabetes range', 'bad'] },
  { k: 'tsh', label: 'TSH', unit: 'mIU/L', step: '0.01', ref: 'Typical ≈0.4–4.5. High = underactive thyroid (lower calorie burn).',
    status: v => v < 0.4 ? ['Low', 'warn'] : v <= 4.5 ? ['Normal', 'good'] : ['High', 'warn'] },
];
// Optional panel: these don't change the projection on their own, but they decide whether the
// endogenous-testosterone therapies apply to you at all (see docs/research/endogenous-testosterone.md).
const PANEL = [
  { k: 'lh', label: 'LH', unit: 'IU/L', step: '0.1', ref: 'Typical ≈1.7–8.6. Low T with normal/low LH = secondary (the kind clomiphene and hCG treat). Low T with high LH = testicular.',
    status: v => v > 9.4 ? ['High', 'warn'] : v < 1.5 ? ['Low', 'warn'] : ['Normal', 'good'] },
  { k: 'fsh', label: 'FSH', unit: 'IU/L', step: '0.1', ref: 'Typical ≈1.5–12.4. Drawn with LH; both are suppressed by testosterone therapy.',
    status: v => v > 12.4 ? ['High', 'warn'] : v < 1.5 ? ['Low', 'warn'] : ['Normal', 'good'] },
  { k: 'shbg', label: 'SHBG', unit: 'nmol/L', step: '0.1', ref: 'Typical ≈10–57. High SHBG binds testosterone, so free T can be low with a normal total.',
    status: v => v > 57 ? ['High', 'warn'] : v < 10 ? ['Low', 'warn'] : ['Normal', 'good'] },
  { k: 'estradiol', label: 'Estradiol (sensitive assay)', unit: 'pg/mL', step: '0.1', ref: 'Typical ≈10–40. Men need some: too low costs bone and libido, too high causes breast tenderness.',
    status: v => v < 10 ? ['Low', 'warn'] : v <= 40 ? ['Normal', 'good'] : ['High', 'warn'] },
  { k: 'prolactin', label: 'Prolactin', unit: 'ng/mL', step: '0.1', ref: 'Typical under ~20. High prolactin suppresses LH and is a treatable cause of low T.',
    status: v => v > 20 ? ['High', 'bad'] : ['Normal', 'good'] },
  { k: 'zinc', label: 'Serum zinc', unit: 'µg/dL', step: '1', ref: 'Under ~70 is deficient (morning, fasting). Only a real deficiency moves testosterone.',
    status: v => v < 70 ? ['Low', 'warn'] : ['Normal', 'good'] },
  { k: 'ferritin', label: 'Ferritin', unit: 'ng/mL', step: '1', ref: 'Typical ≈30–300. Low is common in endurance athletes; very high can mean iron overload, a cause of low T.',
    status: v => v < 30 ? ['Low', 'warn'] : v <= 300 ? ['Normal', 'good'] : ['High', 'warn'] },
];
// Female reference values (§20): Haring 2012 (T 10–57 ng/dL, free T 0.7–7.3 pg/mL), Stanczyk 2022 (postmenopausal SHBG
// 43–68), Zimmerman 2014 (combined pill: SHBG +99, free T −61 %), STRAW+10 (FSH > 25), Clénin 2015 / Mei 2021 (ferritin).
const F = FEMALE_LABS;
const LABS_F = {
  totalT: { label: 'Total testosterone (natural)', ref: `Women ≈${FEMALE_T_RANGE[0]}–${FEMALE_T_RANGE[1]} ng/dL (LC-MS/MS, Haring 2012); lower on the combined pill. Doesn't change the projection.`,
    status: v => v < FEMALE_T_RANGE[0] ? ['Below female range', 'warn'] : v <= FEMALE_T_RANGE[1] ? ['Female range', 'good'] : ['Above female range', 'warn'] },
  freeT: { ref: 'Women ≈0.7–7.3 pg/mL (calculated; Haring 2012). Assays vary a lot.', status: v => v < 0.7 ? ['Low', 'warn'] : v <= 7.3 ? ['Female range', 'good'] : ['High', 'warn'] },
  onTrtT: { ref: 'Only if you take testosterone (trough draw). A measured lab always beats the model.',
    status: v => v > T_MODEL_F.studiedMax ? ['Beyond studied', 'warn'] : v > 300 ? ['Male range', 'warn'] : v > FEMALE_T_RANGE[1] ? ['Above female range', 'warn'] : ['Female range', 'good'] },
  tsh: { ref: 'Typical ≈0.4–4.5. Underactive thyroid is more common in women and lowers calorie burn.' },
};
const PANEL_F = {
  lh: { ref: 'Varies across the cycle (surges mid-cycle) and is high after menopause. Draw on day 2–5 of a cycle with FSH.', status: v => v > 15 ? ['High (outside mid-cycle)', 'warn'] : ['Typical', 'good'] },
  fsh: { ref: `Over ~${F.fshPost} with irregular or absent periods fits the late menopause transition (STRAW+10).`, status: v => v > F.fshPost ? ['Menopausal range', 'warn'] : ['Premenopausal range', 'good'] },
  shbg: { ref: 'Postmenopausal women average ≈43–68 (Stanczyk 2022); the combined pill adds ~100 (Zimmerman 2014).', status: v => v > 200 ? ['Very high', 'warn'] : v < 20 ? ['Low', 'warn'] : ['Typical', 'good'] },
  estradiol: { ref: 'Before menopause it swings ~30–400 across the cycle; after menopause typically ~10–20. Low with missed periods can mean under-fuelling (IOC REDs).', status: v => v < F.estradiolLow ? ['Low (if premenopausal)', 'warn'] : ['Typical', 'good'] },
  prolactin: { ref: `Typical under ~${F.prolactinHigh} for women (assay-dependent). High prolactin can disturb periods.`, status: v => v > F.prolactinHigh ? ['High', 'bad'] : ['Normal', 'good'] },
  zinc: { ref: `Under ~${F.zincLow} is deficient for women (morning, fasting; Hotz 2003).`, status: v => v < F.zincLow ? ['Low', 'warn'] : ['Normal', 'good'] },
  ferritin: { ref: `Under ~${F.ferritinLow} is low (common in menstruating women and female athletes); above ~${F.ferritinHigh} is high for a woman (WHO 2020).`, status: v => v < F.ferritinLow ? ['Low', 'warn'] : v <= F.ferritinHigh ? ['Normal', 'good'] : ['High', 'warn'] },
};
const labsFor = (list, over, sex) => (sex === 'female' ? list.map(L => ({ ...L, ...(over[L.k] || {}) })) : list);

function labRow(L, v, placeholder) {
  return `<div class="sp-lab"><div class="grow"><div class="t">${esc(L.label)} <span data-badge="${L.k}">${labBadge(L, v)}</span></div><div class="s">${esc(L.ref)}</div></div>
    <label class="sp-inwrap"><input type="number" inputmode="decimal" step="${L.step}" min="0" data-met="${L.k}" value="${v ?? ''}" placeholder="${esc(placeholder || '—')}" class="sp-in"><span class="sp-unit">${esc(L.unit)}</span></label></div>`;
}
function labBadge(L, v) {
  const st = v != null && v !== '' && isFinite(Number(v)) ? L.status(Number(v)) : null;
  return st ? `<span class="badge ${st[1]}">${esc(st[0])}</span>` : '';
}
const sleepNoteFor = sleep => sleep < 6 ? 'Short: lowers the muscle ceiling and, in a deficit, more of what you lose is muscle.' : sleep < 7 ? 'A bit short of the 7–9 h baseline.' : sleep <= 9 ? 'In the 7–9 h baseline range.' : 'Plenty.';
const stressNoteFor = stress => stress >= 4 ? 'High stress modestly slows strength gains and recovery.' : 'No adjustment at 1–3.';
function metabolicForm(p, I) {
  const m = p.metabolic || {};
  const age = I.b?.age ?? (p.body?.birthYear ? new Date().getFullYear() - p.body.birthYear : null);
  const sex = sexOf(p);
  const placeholders = { totalT: `avg ≈${averageTotalT(age, sex, { contraception: sex === 'female' ? femaleStatus(p, { age }).contraception : null })}`, vitD: 'avg ≈27' };
  const sleep = m.sleepHours ?? 7, stress = m.stress ?? 3;
  const sleepNote = sleepNoteFor(sleep);
  return `<div class="card sp-form">
    <p class="small muted">Blank values use population averages for your age (flagged as "assumed average"). Testosterone and vitamin D are modeled by level.</p>
    <div class="sp-lab"><div class="grow"><div class="t">Lab date</div><div class="s">When these were drawn</div></div>
      <input type="date" data-met="labDate" value="${esc(m.labDate || '')}" class="sp-in sp-date"></div>
    ${labsFor(LABS, LABS_F, sex).map(L => labRow(L, m[L.k], placeholders[L.k])).join('')}
    <details class="sp-panel"><summary class="small">${sex === 'female' ? 'Hormone panel (optional) — female reference values' : 'Hormone panel (optional) — decides which therapies could even apply to you'}</summary>
      <p class="tiny muted">${sex === 'female' ? 'Morning, fasted, and repeated before anyone acts on them. LH, FSH and estradiol depend on the day of your cycle. These don\'t change the projection; Forge adds notes (menopause stage, iron, under-fuelling).' : 'Morning, fasted, and repeated before anyone acts on them. These don\'t change the projection by themselves; they tell Forge whether the endogenous-testosterone items apply.'}</p>
      ${labsFor(PANEL, PANEL_F, sex).map(L => labRow(L, m[L.k])).join('')}
    </details>
    <div class="sp-lab sp-col"><div class="row between"><div class="t">Typical sleep</div><div class="num bold"><span data-sleepv>${f1(sleep)}</span> h</div></div>
      <input type="range" min="4" max="10" step="0.25" value="${sleep}" data-met="sleepHours" style="--pct:${(sleep - 4) / 6 * 100}%">
      <div class="s" data-sleepn>${esc(sleepNote)}</div></div>
    <div class="sp-lab sp-col"><div class="row between"><div class="t">Life stress</div><div class="s">1 calm · 5 maxed out</div></div>
      <div class="tabs" data-stress>${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${Number(stress) === n ? 'active' : ''}" data-v="${n}">${n}</button>`).join('')}</div>
      <div class="s" data-stressn>${stressNoteFor(stress)}</div></div>
  </div>`;
}

// ------------------------------------------------------------------ detail / edit sheet
function detailSheet(s, entry, today, sex = 'male') {
  s = itemFor(s, sex);
  const modeled = isModeled(s);
  const md = s.model || {};
  const d = modeled && md.dose ? resolveDose(entry?.dose, md) : null;
  const studied = md.dose ? `${md.dose.default} ${md.dose.unit}` : '';
  const unapproved = isUnapproved(s);
  return `<div class="sp-sheet">
    <div class="sp-badges">${evBadge(s)}${stBadge(s)}<span class="badge">${esc(CATEGORIES.find(c => c.id === s.category)?.label || s.category)}</span></div>
    <h2>${esc(s.name)}</h2>
    <p class="small muted">${esc(s.status)}</p>
    <p class="mt">${esc(s.summary)}</p>
    <h3 class="sp-h">How it works</h3><p class="small">${esc(s.mechanism)}</p>
    <h3 class="sp-h">What the evidence shows</h3><ul class="tip-list">${s.effects.map(x => `<li class="small">${esc(x)}</li>`).join('')}</ul>
    ${s.id === 'trt' ? `<div class="sp-chart mt" data-tchart='${esc(JSON.stringify({ natural: null, level: null, age: null, sex }))}'>${tChart({ natural: null, sex })}<div class="sp-readout small muted">Drag across the chart to read values.</div></div><p class="tiny muted">Lean change over ${sex === 'female' ? 24 : 20} weeks without training vs serum T, for an average 39-year-old ${sex === 'female' ? 'woman' : 'man'} (natural ≈${averageTotalT(39, sex)}). Your own curve is on the projection card once T is in your stack or labs.</p>` : ''}
    ${s.risks.length ? `<h3 class="sp-h">Risks</h3><ul class="tip-list sp-risks">${s.risks.map(x => `<li class="small">${esc(x)}</li>`).join('')}${(md.levelRisks || []).map(r => `<li class="small"><span class="muted">At ≥${r.min.toLocaleString()} ${esc(s.id === 'trt' ? 'ng/dL' : md.dose?.unit || '')}:</span> ${esc(r.text)}</li>`).join('')}</ul>` : ''}
    ${s.typicalUse ? `<h3 class="sp-h">Typical use</h3><p class="small">${esc(s.typicalUse)}</p>` : modeled && md.dose ? `<h3 class="sp-h">Studied dose</h3><p class="small">${esc(studied)} in the cited trials. Shown for context, not as a recommendation; it's what the model uses when you leave the dose blank.</p>` : ''}
    <div class="sp-addform">
      <div class="grid2">
        <div class="field"><label>Start date</label><input type="date" data-f="start" value="${esc(entry?.start || today)}"></div>
        ${modeled && md.dose ? `<div class="field"><label>Dose (${esc(md.dose.unit)})</label><input type="number" inputmode="decimal" step="any" min="0" data-f="dose" value="${entry?.dose && d && !d.assumed ? +d.value.toFixed(3) : ''}" placeholder="${esc(String(md.dose.default))}"></div>` : '<div></div>'}
      </div>
      ${modeled && md.dose ? `<p class="tiny muted">Blank = ${esc(studied)}, the ${esc(md.dose.label)}. Studied range ${md.dose.studied[0]}–${md.dose.studied[1]} ${esc(md.dose.unit)}; above that Forge plateaus.${md.dose.note ? ' ' + esc(md.dose.note) : ''}${unapproved ? ' Unregulated products may not contain what the label says.' : ''}</p>` : ''}
      ${!modeled ? `<p class="tiny muted">${esc(md.note || 'No modeled effect')}. You can still track it.</p>` : ''}
      <div class="sheet-actions">
        ${entry ? `<button class="btn btn-primary btn-block" data-save>Save changes</button>
          <div class="btn-row"><button class="btn" data-stopit>Stop today</button><button class="btn btn-danger" data-del>Remove</button></div>`
          : `<button class="btn btn-primary btn-block" data-add>Add to stack</button>`}
        <button class="btn btn-ghost btn-block" data-close>Close</button>
      </div>
    </div>
    <h3 class="sp-h">Sources</h3><ol class="sp-src">${s.sources.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
  </div>`;
}

function openDetail(ctx, id, index = null) {
  const s = SUPPLEMENTS[id]; if (!s) return;
  const p = ctx.store.getProfile();
  const list = Array.isArray(p.supplements) ? [...p.supplements] : [];
  let idx = index;
  if (idx == null) { const i = list.findIndex(e => e && e.id === id && e.active !== false && !e.end); idx = i >= 0 ? i : null; }
  const entry = idx != null ? list[idx] : null;
  const today = ds();
  ctx.openSheet(detailSheet(s, entry, today, sexOf(p)), (el, close) => {
    el.querySelectorAll('[data-tchart]').forEach(bindTChart);
    const read = () => {
      const start = el.querySelector('[data-f=start]')?.value || today;
      const dv = el.querySelector('[data-f=dose]')?.value;
      const n = dv === '' || dv == null ? null : Number(dv);
      const dose = n != null && isFinite(n) && n >= 0 ? { value: n, unit: s.model.dose.unit } : null;
      return { start, dose };
    };
    const save = fn => { const pp = ctx.store.getProfile(); const l = Array.isArray(pp.supplements) ? [...pp.supplements] : []; fn(l); ctx.store.updateProfile({ supplements: l }); setTimeout(() => ctx.rerender(), 0); };
    el.querySelector('[data-close]')?.addEventListener('click', close);
    el.querySelector('[data-add]')?.addEventListener('click', () => {
      const { start, dose } = read();
      save(l => l.push({ id, start, end: null, dose, active: true }));
      close(); ctx.toast(`${s.name.split(' (')[0]} added`);
    });
    el.querySelector('[data-save]')?.addEventListener('click', () => {
      const { start, dose } = read();
      save(l => { if (l[idx]) l[idx] = { ...l[idx], start, dose }; });
      close(); ctx.toast('Saved');
    });
    el.querySelector('[data-stopit]')?.addEventListener('click', () => { save(l => { if (l[idx]) l[idx] = { ...l[idx], end: today, active: false }; }); close(); ctx.toast(`${s.name.split(' (')[0]} stopped`); });
    el.querySelector('[data-del]')?.addEventListener('click', () => { save(l => l.splice(idx, 1)); close(); ctx.toast('Removed'); });
  });
}

// ------------------------------------------------------------------ bind
export function bind(root, ctx) {
  const store = ctx.store;
  const upd = fn => { const p = store.getProfile(); const l = Array.isArray(p.supplements) ? [...p.supplements] : []; fn(l, p); store.updateProfile({ supplements: l }); ctx.rerender(); };
  const refresh = () => {
    const I = inputs(store);
    const { mods, off, activeIds } = computeMods(I);
    const wrap = root.querySelector('#sp-impact-wrap');
    if (wrap) { wrap.innerHTML = impactCard(I, mods, off, activeIds); wrap.querySelectorAll('[data-tchart]').forEach(bindTChart); }
    refreshPlan();
    const m = I.profile.metabolic || {};
    const sx = sexOf(I.profile);
    for (const L of [...labsFor(LABS, LABS_F, sx), ...labsFor(PANEL, PANEL_F, sx)]) { const el = root.querySelector(`[data-badge="${L.k}"]`); if (el) el.innerHTML = labBadge(L, m[L.k]); }
    const sn = root.querySelector('[data-sleepn]'); if (sn) sn.textContent = sleepNoteFor(m.sleepHours ?? 7);
    const tn = root.querySelector('[data-stressn]'); if (tn) tn.textContent = stressNoteFor(m.stress ?? 3);
    root.querySelectorAll('[data-stress] button').forEach(b => b.classList.toggle('active', Number(b.dataset.v) === Number(m.stress ?? 3)));
  };
  const setMet = (k, v) => {
    const p = store.getProfile();
    if ((p.metabolic || {})[k] === v) return;
    store.updateProfile({ metabolic: { ...(p.metabolic || {}), [k]: v } });
    refresh();
  };
  const timers = {};

  // ---- §22 planner: one tap adds a row (single item or whole combination), a second tap removes it
  function bindPlan() {
    const wrap = root.querySelector('#sp-plan-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('[data-popen]').forEach(b => b.addEventListener('click', () => {
      planUi.open = planUi.open === b.dataset.popen ? null : b.dataset.popen;
      refreshPlan();
    }));
    wrap.querySelectorAll('[data-ptoggle]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      const ids = b.dataset.ptoggle.split('+').filter(id => SUPPLEMENTS[id]);
      if (!ids.length) return;
      const today = ds();
      const p = store.getProfile();
      const list = Array.isArray(p.supplements) ? [...p.supplements] : [];
      const activeOf = id => list.findIndex(e => e && e.id === id && e.active !== false && (!e.end || e.end > today));
      const allIn = ids.every(id => activeOf(id) >= 0);
      if (allIn) {
        for (const id of ids) { const i = activeOf(id); if (i >= 0) list.splice(i, 1); }
        store.updateProfile({ supplements: list });
        ctx.toast(`${ids.length > 1 ? 'Combination' : SUPPLEMENTS[ids[0]].name.split(' (')[0]} removed`);
      } else {
        for (const e of rowEntries(ids.filter(id => activeOf(id) < 0), today)) list.push(e);
        store.updateProfile({ supplements: list });
        ctx.toast(`${ids.length > 1 ? 'Combination added' : SUPPLEMENTS[ids[0]].name.split(' (')[0] + ' added'} — projection updated`);
      }
      ctx.rerender();
    }));
    wrap.querySelectorAll('[data-pzero]').forEach(d => d.addEventListener('toggle', e => { planUi.showZero = e.target.open; }));
    wrap.querySelectorAll('[data-pcost]').forEach(d => d.addEventListener('toggle', e => { planUi.showCost = e.target.open; }));
    wrap.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); openDetail(ctx, b.dataset.detail); }));
  }
  function refreshPlan() {
    const wrap = root.querySelector('#sp-plan-wrap');
    if (!wrap) return;
    wrap.innerHTML = planCard(inputs(store));
    bindPlan();
  }
  bindPlan();

  root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { ui.cat = b.dataset.cat; ctx.rerender(); }));
  root.querySelectorAll('.list [data-detail], .sp-row [data-detail]').forEach(b => b.addEventListener('click', () => openDetail(ctx, b.dataset.detail)));
  root.querySelectorAll('[data-edit]').forEach(r => {
    const open = () => { const p = store.getProfile(); const e = p.supplements?.[Number(r.dataset.edit)]; if (e) openDetail(ctx, e.id, Number(r.dataset.edit)); };
    r.addEventListener('click', open);
    r.addEventListener('keydown', ev => { if (ev.key === 'Enter') open(); });
  });
  root.querySelectorAll('[data-stop]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const i = Number(b.dataset.stop); const name = SUPPLEMENTS[store.getProfile().supplements?.[i]?.id]?.name || 'Item';
    upd(l => { if (l[i]) l[i] = { ...l[i], end: ds(), active: false }; });
    ctx.toast(`${name.split(' (')[0]} stopped`);
  }));
  root.querySelectorAll('[data-restart]').forEach(b => b.addEventListener('click', () => {
    const i = Number(b.dataset.restart);
    upd(l => { const e = l[i]; if (e) l.push({ id: e.id, start: ds(), end: null, dose: e.dose ?? null, active: true }); });
  }));
  root.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { const i = Number(b.dataset.remove); upd(l => l.splice(i, 1)); }));
  root.querySelector('.sp-stopped')?.addEventListener('toggle', e => { ui.showStopped = e.target.open; });
  root.querySelectorAll('[data-quickadd]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.quickadd;
    upd(l => l.push({ id, start: ds(), end: null, dose: null, active: true }));
    ctx.toast(`${SUPPLEMENTS[id].name.split(' (')[0]} added. Tap it to set your dose.`);
  }));
  root.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
    const t = root.querySelector('#' + b.dataset.jump); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  }));

  // metabolic inputs
  root.querySelectorAll('input[data-met]').forEach(inp => {
    const k = inp.dataset.met;
    if (inp.type === 'range') {
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        inp.style.setProperty('--pct', ((v - 4) / 6 * 100) + '%');
        const lab = root.querySelector('[data-sleepv]'); if (lab) lab.textContent = f1(v);
      });
      inp.addEventListener('change', () => setMet(k, Number(inp.value)));
      return;
    }
    const commit = () => {
      clearTimeout(timers[k]);
      if (inp.type === 'date') { setMet(k, inp.value || null); return; }
      const raw = inp.value.trim();
      const n = raw === '' ? null : Number(raw);
      setMet(k, n != null && isFinite(n) && n >= 0 ? n : null);
    };
    inp.addEventListener('change', commit);
    if (inp.type !== 'date') inp.addEventListener('input', () => { clearTimeout(timers[k]); timers[k] = setTimeout(commit, 700); });
  });
  root.querySelectorAll('[data-stress] button').forEach(b => b.addEventListener('click', () => setMet('stress', Number(b.dataset.v))));
  root.querySelectorAll('.sp-impact [data-tchart]').forEach(bindTChart);
}
