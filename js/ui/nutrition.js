// Nutrition screen (route 'nutrition'). Editable targets (calories or surplus, protein g/lb, fat %,
// mode off/simple/cycling), live macro breakdown, today's targets, the "eat a lot?" lesson with
// Nutrition Lab numbers, and Adderall-aware tips.
// CONTRACT-NOTE (Phase 3, UI-LAB): writes profile.nutrition { mode, calories|null, surplus|null,
//   proteinGPerLb, fatPct } per CONTRACT §15. If the engine has no macrosFor() yet, today's target is
//   computed here from maintenance + surplus so the numbers match what Bob set.
import * as nut from '../engine/nutrition.js';
import { ENERGY_COMPENSATION } from '../engine/bodycomp.js';
import { esc } from './components.js';
import { ds } from '../util.js';
import { macroBar, nutritionContext, safe, f1 } from './projection.js';
import { resolveTargets } from '../engine/targets.js';
import { setTargets } from './targets.js';
// CONTRACT-NOTE (§20 Female mode): tips come from nutrition.tipsFor(profile) (female list; Adderall tips for women only
//   when Adderall is in the stack) and supplementsFor(profile) (iron note). Today's target passes lean mass and net
//   exercise kcal so dailyTargets can flag low energy availability; women see an energy-availability line.
// CONTRACT-NOTE (INTEGRATOR §18): targets are read via resolveTargets(profile).nutrition (same
//   defaults the projection uses) and saved via setTargets (no re-plan: nutrition doesn't change
//   the plan, but the projection reads the same profile values).

// CONTRACT §18: macros come straight from the engine. This screen used to call ui/projection.js's
// macros() wrapper, which carries a fallback that re-implements the macro split with its OWN copies of
// the protein and fat thresholds (0.7 / 1.15 / 20 % / 120 g). Those constants had already drifted from
// the engine's, so the Nutrition screen could warn with numbers the model does not use. One call site,
// one set of numbers. (ui/projection.js still has that fallback; it is unreachable while
// nutrition.macrosFor exists, and removing it belongs to that file's owner.)
function macros(profile, { calories, bodyweight, proteinGPerLb, fatPct, leanLb = null }) {
  const prof = { ...profile, nutrition: { ...(profile?.nutrition || {}), proteinGPerLb, fatPct } };
  const r = nut.macrosFor(prof, { calories, bodyweight, leanLb });
  return { ...r, warnings: r.warnings || [] };
}

let override = null;   // user-picked day type for today (module state)
let basisPick = null;  // 'cal' | 'surplus' while editing
const DAY_TYPES = [['lift', '🏋️ Lift'], ['cardio', '🫀 Cardio'], ['both', '⚡ Both'], ['rest', '😴 Rest']];
const MODES = [['off', 'Off'], ['simple', 'Simple'], ['cycling', 'Carb cycling']];
const sgnK = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(Math.round(n)).toLocaleString();
const sgn = n => (n > 0.049 ? '+' : n < -0.049 ? '−' : '±') + f1(Math.abs(n));

export function inferDayType(sessions, date = ds()) {
  let lift = false, cardio = false;
  for (const s of sessions || []) {
    if (s.date !== date) continue;
    for (const b of s.blocks || []) {
      if (b.kind === 'lift') lift = true;
      else if (b.kind === 'cardio') cardio = true;
      else if (b.kind === 'class') { if (Object.keys(b.classify?.muscles || {}).length && b.classify?.type === 'strength') lift = true; else cardio = true; }
    }
  }
  return lift && cardio ? 'both' : lift ? 'lift' : cardio ? 'cardio' : 'rest';
}

// Day-type counts for the user's week, from profile.schedule (the targets resolver's own source) with
// today's actual sessions respected. Shape: { lift, cardio, both, rest } summing to 7.
export function scheduleWeek(profile) {
  const sch = profile?.schedule && typeof profile.schedule === 'object' ? profile.schedule : null;
  if (!sch) return null;
  const out = { lift: 0, cardio: 0, both: 0, rest: 0 };
  let n = 0;
  for (const dow of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    const k = sch[dow]?.kind;
    if (k == null) continue;
    n++;
    if (k === 'lift') out.lift++;
    else if (k === 'cardio') out.cardio++;
    else if (k === 'rest') out.rest++;
    else out.both++;                                  // 'flex' / 'class' days usually carry both
  }
  return n === 7 ? out : null;
}

const tips = (title, list, icon) => list?.length ? `<div class="section-title">${icon} ${esc(title)}</div><div class="card"><ul class="tip-list">${list.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
const warnList = w => (w || []).length ? `<ul class="bd-warn">${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

function targetCalories(n, nc) {
  if (Number(n.calories) > 0) return Number(n.calories);
  if (!nc) return null;
  if (n.surplus != null && isFinite(n.surplus)) return Math.round(nc.maint + Number(n.surplus));
  return nc.intake;
}

function whyCard(nc) {
  const P = nc?.lab?.points || [];
  const near = s => P.reduce((b, p) => Math.abs(p.surplus - s) < Math.abs(b.surplus - s) ? p : b, P[0]);
  const rows = P.length >= 3 ? [[0, 'Maintain'], [300, 'Lean bulk'], [600, 'Bulk'], [1000, '"Eat a lot"']].map(([s, l]) => [l, near(s)]) : [];
  const a = rows[1]?.[1], z = rows[3]?.[1];
  return `<div class="card bd-why">
    <div class="card-title">Why "eat a lot" isn't the fastest way to add muscle</div>
    <p class="small" style="color:#cfcfd8;margin-top:6px;line-height:1.5">Your body can only build muscle so fast. Training age, weekly volume and protein set that ceiling. A modest surplus gets you close to it. Calories past that point can't turn into muscle, so they're stored as fat, which you'd later have to diet off (and dieting costs some muscle).</p>
    ${rows.length ? `<table class="num"><thead><tr><th>${nc.weeks} weeks at</th><th>kcal/day</th><th>Lean</th><th>Fat</th></tr></thead><tbody>
      ${rows.map(([l, p]) => `<tr><td>${esc(l)}</td><td>${sgnK(p.surplus)}</td><td style="color:var(--good);font-weight:750">${sgn(p.lean)}</td><td style="color:var(--accent2);font-weight:750">${sgn(p.fat)}</td></tr>`).join('')}</tbody></table>
      ${a && z ? `<p class="bd-take">From a lean bulk (${sgnK(a.surplus)}) to "eat a lot" (${sgnK(z.surplus)}) adds <b style="color:var(--good)">${sgn(z.lean - a.lean)} lb muscle</b> but <b style="color:var(--accent2)">${sgn(z.fat - a.fat)} lb fat</b>.</p>` : ''}` : ''}
    <p class="small muted" style="margin-top:8px">Fastest lean gain: about +200 to +500 kcal/day, ~1 g protein per lb, hard training with enough volume, and sleep.</p>
    <button class="btn btn-block mt" data-lab>🧪 Open the Nutrition Lab</button>
  </div>`;
}

// §23. The weight-loss counterpart of whyCard: the deficit this goal implies, where it came from, and
// what the protein number is buying. All values come from resolveTargets().goals.plan, so Nutrition shows
// exactly the deficit the projection simulates.
function lossCard(T, nc, p) {
  const g = T.goals, pl = g.plan || {};
  const maint = nc?.maint ?? null;
  const prot = { protect: 'Protecting muscle', balanced: 'Maintenance lifting', minimal: 'Minimum body mass' }[g.leanProtection] || g.leanProtection;
  return `<div class="card bd-why" id="nLoss">
    <div class="row between"><div class="card-title">Your deficit, and what it costs</div><span class="badge">${esc(prot)}</span></div>
    <p class="small" style="color:#cfcfd8;margin-top:6px;line-height:1.5">Your goal is the number on the scale, so Forge sizes the deficit from the rate you picked rather than a fixed figure${g.goalWeightLb ? `, and stops when you reach ${g.goalWeightLb} lb` : ''}. Fat comes off first, but some lean mass comes with it: the leaner you get the more of it is lean (Forbes), and the faster you go the worse the split (Garthe 2011).</p>
    <table class="num" style="margin-top:10px"><tbody>
      <tr><td>Rate</td><td><b>${pl.pctPerWeek ?? '—'}%</b> of bodyweight/week${pl.lbPerWeek ? ` <span class="muted">(${f1(pl.lbPerWeek)} lb)</span>` : ''}</td></tr>
      <tr><td>Deficit</td><td><b>${pl.deficitKcal ? `−${pl.deficitKcal}` : '—'}</b> kcal/day${maint ? ` <span class="muted">from ~${maint.toLocaleString()} maintenance</span>` : ''}</td></tr>
      ${g.goalWeightLb ? `<tr><td>Goal weight</td><td><b>${g.goalWeightLb} lb</b>${pl.toLoseLb ? ` <span class="muted">(${f1(pl.toLoseLb)} lb to go${pl.weeks ? `, ~${pl.weeks} weeks` : ''})</span>` : ''}</td></tr>` : ''}
      <tr><td>Protein</td><td><b>${T.nutrition.proteinGPerLb.toFixed(2)}</b> g/lb <span class="muted">${T.nutrition.proteinGPerLb < 0.7 ? 'deliberately low: more of the loss will be lean mass' : 'enough to hold most of your muscle in a deficit'}</span></td></tr>
    </tbody></table>
    ${(pl.warnings || []).length ? warnList(pl.warnings) : ''}
    <p class="small muted" style="margin-top:8px">Mettler 2010: trained men dieting hard lost 1.6 kg of lean at ~0.45 g/lb of protein against 0.3 kg at ~1.05 g/lb. Longland 2016: at a 40 % deficit with hard training, 2.4 g/kg GAINED 1.2 kg of lean where 1.2 g/kg gained 0.1 kg. Protein is the cheapest lever you have.</p>
    <button class="btn btn-block mt" data-wlproj>See the lean-vs-fat split in the projection</button>
  </div>`;
}

// Three claims Forge is often expected to make and the evidence it actually has. Every number comes
// from the engine's own constants (nut.FAT_EVIDENCE, nut.PROTEIN_EVIDENCE, bodycomp.ENERGY_COMPENSATION), so
// this card cannot drift away from the model.
function evidenceCard() {
  const F = nut.FAT_EVIDENCE, P = nut.PROTEIN_EVIDENCE, comp = Math.round(ENERGY_COMPENSATION * 100);
  const rows = [
    ['“More fat makes you more fat”',
      `Not as stated. At the same calories and protein, dietary fat is no more fattening than carbohydrate — a surplus is what adds fat. There IS a floor: men who drop from ~40% to ~20% of calories from fat lose a little testosterone (${F.totalTestosteroneSMD} SD, 95% CI ${F.totalTestosteroneCI[0]} to ${F.totalTestosteroneCI[1]}; Whittaker 2021), which is why Forge warns under ${F.floorPct}% and not over it. ${F.amdr[0]}-${F.amdr[1]}% is the recommended range.`],
    ['“More protein is better, up to a point”',
      `Right, and the point is lower than most people think: lean-mass gains stopped improving past ${P.plateauGPerKg} g/kg ≈ ${P.plateauGPerLb} g/lb across 49 trials (Morton 2018). Forge targets ~${P.ceilingGPerLb} g/lb — the top of that study's confidence interval — so you are covered rather than average. In a deficit it keeps paying past that: ${P.deficitGPerKgLean[0]}-${P.deficitGPerKgLean[1]} g/kg of lean mass protects muscle (Helms 2014).`],
    ['“More cardio burns fat faster”',
      `True but not linearly, and Forge's own math shows the bend. Two things shrink it: the calorie figure on a watch or machine includes the calories you would have burned at rest (Forge subtracts those), and about ${comp}% of the calories from ADDED activity get cancelled out by your resting burn falling (Careau 2021, n = 1,754). Appetite does the rest. Cardio is a real lever; food is the bigger one.`],
  ];
  return `<div class="card bd-why">${rows.map(([q, a]) => `<div style="margin-bottom:12px"><div class="t" style="font-weight:750">${esc(q)}</div><p class="small" style="color:#cfcfd8;margin-top:4px;line-height:1.5">${esc(a)}</p></div>`).join('')}
    <p class="tiny muted">Full constants, sources and uncertainties: docs/research/energy-model.md</p></div>`;
}

export function render(ctx) {
  const p = ctx.store.getProfile();
  const n = p.nutrition || {};
  const mode = n.mode || 'off';
  const nc = safe(() => nutritionContext(ctx.store), null);
  const T = resolveTargets(p);
  const d = T.nutrition;
  const pg = d.proteinGPerLb, fatPct = d.fatPct;
  const basis = basisPick || (Number(n.calories) > 0 ? 'cal' : 'surplus');
  const cal = targetCalories(n, nc);
  const surplus = nc && cal ? cal - nc.maint : (n.surplus ?? 0);
  const bw = Number(p.bodyweight) || nc?.weight || null;
  const m = cal && bw ? macros(p, { calories: cal, bodyweight: bw, proteinGPerLb: pg, fatPct, leanLb: nc?.leanLb ?? null }) : null;
  const pct = (v, a, b) => ((v - a) / (b - a)) * 100;

  const editor = `<div class="card" id="nEdit">
    <div class="row between"><div class="card-title">Your targets</div>${nc ? `<span class="tiny muted">maintenance ≈ ${nc.maint.toLocaleString()}</span>` : ''}</div>
    <div class="tabs bd-nseg mt" data-basis>${[['cal', 'Calories / day'], ['surplus', 'vs maintenance']].map(([v, l]) => `<button class="${basis === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="bd-ninput"><input type="number" inputmode="numeric" id="nVal" value="${basis === 'cal' ? (cal ?? '') : Math.round(surplus)}" placeholder="${basis === 'cal' ? '2800' : '+300'}" ${basis === 'surplus' ? 'step="25"' : 'step="10"'}><span class="muted small" style="white-space:nowrap">${basis === 'cal' ? 'kcal/day' : 'kcal vs maint.'}</span></div>
    <div class="tiny muted" id="nValHint" style="margin-top:6px">${nc && cal ? (basis === 'cal' ? `${sgnK(surplus)} vs maintenance` : `≈ ${cal.toLocaleString()} kcal/day today. Follows your maintenance as your weight and training change.`) : bw ? '' : 'Log your bodyweight to get targets.'}</div>
    <div class="row between mt"><div class="label">Protein</div><div class="num bold" id="nPgV">${pg.toFixed(2)} g/lb</div></div>
    <input type="range" class="bd-range" id="nPg" min="0.6" max="1.4" step="0.05" value="${pg}" style="--pct:${pct(pg, 0.6, 1.4)}%" aria-label="Protein grams per pound">
    <div class="row between"><div class="label">Fat</div><div class="num bold" id="nFatV">${fatPct}% of kcal</div></div>
    <input type="range" class="bd-range" id="nFat" min="15" max="40" step="1" value="${fatPct}" style="--pct:${pct(fatPct, 15, 40)}%" aria-label="Fat percent of calories">
    <div class="tiny muted" style="margin:-2px 0 8px">Carbs fill the rest.</div>
    <div id="nMacros">${m ? macroBar(m) + warnList(m.warnings) : ''}</div>
    <button class="btn btn-primary btn-block mt" data-save>${mode === 'off' ? 'Save and turn on targets' : 'Save targets'}</button>
  </div>`;

  let today = '';
  if (mode !== 'off') {
    const sessions = safe(() => ctx.store.getSessions(), []);
    const inferred = inferDayType(sessions);
    const dayType = override || inferred;
    // The real week, so carb cycling centres its offsets on the days this user actually trains and
    // therefore averages to exactly the intake shown in the editor (nutrition.cycleMean).
    const week = safe(() => scheduleWeek(p), null);
    let t = safe(() => nut.dailyTargets(p, { dayType, bodyweight: bw, tdee: nc?.maint, leanLb: nc?.leanLb, exerciseKcal: nc?.exerciseKcal, week }), null);
    if (t && nc && (Number(n.calories) > 0 || (n.surplus != null && isFinite(n.surplus)))) {
      const avgS = (Number(n.calories) > 0 ? Number(n.calories) : nc.maint + Number(n.surplus)) - nc.maint;
      const lbl = avgS <= -400 ? 'Cut' : avgS < -100 ? 'Recomp' : avgS <= 100 ? 'Maintenance' : avgS <= 500 ? 'Lean bulk' : 'Big surplus';
      t = { ...t, note: `${lbl}: ${sgnK(avgS)} kcal/day vs your ~${nc.maint.toLocaleString()} maintenance on average.${mode === 'cycling' && t.note ? ' ' + t.note.split('.')[0] + '.' : ''}` };
    }
    today = `${mode === 'cycling' ? `<div class="tabs mb" data-day>${DAY_TYPES.map(([v, l]) => `<button class="${dayType === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
      <p class="tiny muted mb" style="margin-left:4px">${override ? 'Manual pick' : 'Detected from today\'s workouts'}${override ? ' · <a href="#" data-auto>use detected</a>' : ''}</p>` : ''}
    ${t ? `<div class="card hero"><div class="label">Today's target</div>
        <div style="font-size:44px;font-weight:850;letter-spacing:-.03em;line-height:1.1" class="num">${Math.round(t.calories).toLocaleString()}<span class="muted" style="font-size:16px;font-weight:650"> kcal</span></div>
        <div class="mt">${macroBar(t)}</div>
        ${t.note ? `<p class="small mt" style="color:#cfcfd8">${esc(t.note)}</p>` : ''}
        ${t.energyAvailability != null ? `<p class="tiny mt ${t.energyAvailability < 30 ? '' : 'muted'}" style="${t.energyAvailability < 30 ? 'color:var(--warn)' : ''}" data-ea>Energy availability ≈ ${Math.round(t.energyAvailability)} kcal per kg lean mass a day (food minus exercise; under 30 is low, ~45 adequate).</p>` : ''}
        ${t.female && (t.warnings || []).length ? warnList(t.warnings) : ''}</div>`
      : `<div class="card"><h3>Add your bodyweight</h3><p class="muted small mt">Targets are based on bodyweight.</p><div class="row mt"><input type="number" inputmode="decimal" step="0.1" id="nbw" placeholder="lb" class="grow"><button class="btn btn-primary" data-bw>Save</button></div></div>`}`;
  }

  return `<div class="page-head"><p class="sub">${mode === 'off' ? 'Optional. Training works without it, but food decides how much of your gain is muscle.' : mode === 'cycling' ? 'Carb cycling: more carbs on lift days, fewer on rest days.' : 'Simple: the same targets every day.'}</p></div>
    <div class="tabs bd-nseg mb" data-modes>${MODES.map(([v, l]) => `<button class="${mode === v ? 'active' : ''}" data-mode="${v}">${l}</button>`).join('')}</div>
    ${mode !== 'off' ? `<div class="section-title">Today</div>${today}` : ''}
    <div class="section-title">Targets</div>
    ${editor}
    ${T.goals.losing ? `<div class="section-title">Losing weight, honestly</div>${lossCard(T, nc, p)}` : `<div class="section-title">Bulking, honestly</div>${whyCard(nc)}`}
    <div class="section-title">What the research actually says</div>${evidenceCard(p)}
    ${(() => { const T = typeof nut.tipsFor === 'function' ? nut.tipsFor(p) : { nutrition: nut.NUTRITION_TIPS, adderall: nut.ADDERALL_TIPS }; return tips('Eating on Adderall', T.adderall, '💊') + tips('Nutrition basics', T.nutrition, '📌'); })()}
    ${(() => { const SL = typeof nut.supplementsFor === 'function' ? nut.supplementsFor(p) : nut.SUPPLEMENTS; return Array.isArray(SL) && SL.length ? `<div class="section-title">💊 Supplements worth it</div><div class="list">${SL.map(s => `<div class="list-item" style="align-items:flex-start"><div class="grow"><div class="t">${esc(s.name)} <span class="muted small" style="font-weight:600">· ${esc(s.dose || '')}</span></div><div class="s">${esc(s.note || '')}</div></div></div>`).join('')}</div>` : ''; })()}`;
}

export function bind(root, ctx) {
  const st = ctx.store;
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    const m = b.dataset.mode;
    setTargets(ctx, { nutrition: { mode: m } }, { replan: false, reason: m === 'off' ? 'nutrition off' : m === 'cycling' ? 'carb cycling on' : 'simple targets on' });
  });
  root.querySelector('[data-day]')?.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { override = b.dataset.v; ctx.rerender(); } });
  root.querySelector('[data-auto]')?.addEventListener('click', e => { e.preventDefault(); override = null; ctx.rerender(); });
  root.querySelector('[data-bw]')?.addEventListener('click', () => {
    const v = parseFloat(root.querySelector('#nbw').value);
    if (v > 50 && v < 600) st.logBodyweight(ds(), v); else ctx.toast('Enter a weight in lb');
  });
  root.querySelector('[data-lab]')?.addEventListener('click', () => ctx.nav('projection', { focus: 'lab' }));
  root.querySelector('[data-wlproj]')?.addEventListener('click', () => ctx.nav('projection'));

  const ed = root.querySelector('#nEdit'); if (!ed) return;
  const nc = safe(() => nutritionContext(st), null);
  const valEl = ed.querySelector('#nVal'), pgEl = ed.querySelector('#nPg'), fatEl = ed.querySelector('#nFat');
  const basis = () => ed.querySelector('[data-basis] .active')?.dataset.v || 'surplus';
  const calNow = () => { const v = parseFloat(valEl.value); if (!isFinite(v)) return null; return basis() === 'cal' ? v : nc ? nc.maint + v : null; };
  const live = () => {
    const p = st.getProfile(), cal = calNow(), bw = Number(p.bodyweight) || nc?.weight;
    pgEl.style.setProperty('--pct', ((pgEl.value - 0.6) / 0.8) * 100 + '%'); fatEl.style.setProperty('--pct', ((fatEl.value - 15) / 25) * 100 + '%');
    ed.querySelector('#nPgV').textContent = (+pgEl.value).toFixed(2) + ' g/lb';
    ed.querySelector('#nFatV').textContent = fatEl.value + '% of kcal';
    if (nc && cal) ed.querySelector('#nValHint').textContent = basis() === 'cal' ? `${sgnK(cal - nc.maint)} vs maintenance` : `≈ ${Math.round(cal).toLocaleString()} kcal/day today. Follows your maintenance as your weight and training change.`;
    if (cal > 800 && bw) { const m = macros(p, { calories: cal, bodyweight: bw, proteinGPerLb: +pgEl.value, fatPct: +fatEl.value, leanLb: nc?.leanLb ?? null }); ed.querySelector('#nMacros').innerHTML = macroBar(m) + warnList(m.warnings); }
  };
  valEl.addEventListener('input', live); pgEl.addEventListener('input', live); fatEl.addEventListener('input', live);
  pgEl.onchange = () => pgEl.blur(); fatEl.onchange = () => fatEl.blur();
  ed.querySelectorAll('[data-basis] [data-v]').forEach(b => b.onclick = () => {
    const cal = calNow(); basisPick = b.dataset.v;
    ed.querySelectorAll('[data-basis] [data-v]').forEach(x => x.classList.toggle('active', x === b));
    if (cal && nc) valEl.value = basisPick === 'cal' ? Math.round(cal / 10) * 10 : Math.round((cal - nc.maint) / 25) * 25;
    valEl.nextElementSibling.textContent = basisPick === 'cal' ? 'kcal/day' : 'kcal vs maint.';
    live();
  });
  ed.querySelector('[data-save]').onclick = () => {
    const v = parseFloat(valEl.value), b = basis();
    if (b === 'cal' && !(v >= 1200 && v <= 6000)) { ctx.toast('Enter 1,200–6,000 kcal'); return; }
    if (b === 'surplus' && !(v >= -1500 && v <= 1500)) { ctx.toast('Enter −1,500 to +1,500 kcal'); return; }
    if (document.activeElement) document.activeElement.blur();
    const p = st.getProfile(), n = p.nutrition || {};
    basisPick = null;
    setTargets(ctx, { nutrition: { mode: n.mode && n.mode !== 'off' ? n.mode : 'simple', calories: b === 'cal' ? Math.round(v) : null, surplus: b === 'surplus' ? Math.round(v) : null, proteinGPerLb: +(+pgEl.value).toFixed(2), fatPct: +fatEl.value } }, { replan: false, reason: 'nutrition targets' });
  };
}
