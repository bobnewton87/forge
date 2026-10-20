// Nutrition screen (route 'nutrition'). Editable targets (calories or surplus, protein g/lb, fat %,
// mode off/simple/cycling), live macro breakdown, today's targets, the "eat a lot?" lesson with
// Nutrition Lab numbers, and Adderall-aware tips.
// CONTRACT-NOTE (Phase 3, UI-LAB): writes profile.nutrition { mode, calories|null, surplus|null,
//   proteinGPerLb, fatPct } per CONTRACT §15. If the engine has no macrosFor() yet, today's target is
//   computed here from maintenance + surplus so the numbers match what Bob set.
import * as nut from '../engine/nutrition.js';
import { esc } from './components.js';
import { ds } from '../util.js';
import { macros, macroBar, nutritionContext, safe, f1, whatIfDefaults } from './projection.js';

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

export function render(ctx) {
  const p = ctx.store.getProfile();
  const n = p.nutrition || {};
  const mode = n.mode || 'off';
  const nc = safe(() => nutritionContext(ctx.store), null);
  const d = whatIfDefaults(p);
  const pg = d.pg, fatPct = d.fatPct;
  const basis = basisPick || (Number(n.calories) > 0 ? 'cal' : 'surplus');
  const cal = targetCalories(n, nc);
  const surplus = nc && cal ? cal - nc.maint : (n.surplus ?? 0);
  const bw = Number(p.bodyweight) || nc?.weight || null;
  const m = cal && bw ? macros(p, { calories: cal, bodyweight: bw, proteinGPerLb: pg, fatPct }) : null;
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
    let t = safe(() => nut.dailyTargets(p, { dayType, bodyweight: bw, tdee: nc?.maint }), null);
    if (typeof nut.macrosFor !== 'function' && mode === 'simple' && m) t = { ...m, note: t?.note || '' };
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
        ${t.note ? `<p class="small mt" style="color:#cfcfd8">${esc(t.note)}</p>` : ''}</div>`
      : `<div class="card"><h3>Add your bodyweight</h3><p class="muted small mt">Targets are based on bodyweight.</p><div class="row mt"><input type="number" inputmode="decimal" step="0.1" id="nbw" placeholder="lb" class="grow"><button class="btn btn-primary" data-bw>Save</button></div></div>`}`;
  }

  return `<div class="page-head"><p class="sub">${mode === 'off' ? 'Optional. Training works without it, but food decides how much of your gain is muscle.' : mode === 'cycling' ? 'Carb cycling: more carbs on lift days, fewer on rest days.' : 'Simple: the same targets every day.'}</p></div>
    <div class="tabs bd-nseg mb" data-modes>${MODES.map(([v, l]) => `<button class="${mode === v ? 'active' : ''}" data-mode="${v}">${l}</button>`).join('')}</div>
    ${mode !== 'off' ? `<div class="section-title">Today</div>${today}` : ''}
    <div class="section-title">Targets</div>
    ${editor}
    <div class="section-title">Bulking, honestly</div>
    ${whyCard(nc)}
    ${tips('Eating on Adderall', nut.ADDERALL_TIPS, '💊')}
    ${tips('Nutrition basics', nut.NUTRITION_TIPS, '📌')}
    ${Array.isArray(nut.SUPPLEMENTS) && nut.SUPPLEMENTS.length ? `<div class="section-title">💊 Supplements worth it</div><div class="list">${nut.SUPPLEMENTS.map(s => `<div class="list-item" style="align-items:flex-start"><div class="grow"><div class="t">${esc(s.name)} <span class="muted small" style="font-weight:600">· ${esc(s.dose || '')}</span></div><div class="s">${esc(s.note || '')}</div></div></div>`).join('')}</div>` : ''}`;
}

export function bind(root, ctx) {
  const st = ctx.store;
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    const p = st.getProfile();
    st.updateProfile({ nutrition: { ...(p.nutrition || {}), mode: b.dataset.mode } });
    ctx.toast(b.dataset.mode === 'off' ? 'Nutrition off' : b.dataset.mode === 'cycling' ? 'Carb cycling on' : 'Simple targets on');
  });
  root.querySelector('[data-day]')?.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { override = b.dataset.v; ctx.rerender(); } });
  root.querySelector('[data-auto]')?.addEventListener('click', e => { e.preventDefault(); override = null; ctx.rerender(); });
  root.querySelector('[data-bw]')?.addEventListener('click', () => {
    const v = parseFloat(root.querySelector('#nbw').value);
    if (v > 50 && v < 600) st.logBodyweight(ds(), v); else ctx.toast('Enter a weight in lb');
  });
  root.querySelector('[data-lab]')?.addEventListener('click', () => ctx.nav('projection', { focus: 'lab' }));

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
    if (cal > 800 && bw) { const m = macros(p, { calories: cal, bodyweight: bw, proteinGPerLb: +pgEl.value, fatPct: +fatEl.value }); ed.querySelector('#nMacros').innerHTML = macroBar(m) + warnList(m.warnings); }
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
    st.updateProfile({ nutrition: { ...n, mode: n.mode && n.mode !== 'off' ? n.mode : 'simple', calories: b === 'cal' ? Math.round(v) : null, surplus: b === 'surplus' ? Math.round(v) : null, proteinGPerLb: +(+pgEl.value).toFixed(2), fatPct: +fatEl.value } });
    ctx.toast('Targets saved');
  };
}
