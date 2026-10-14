// Nutrition screen (UI-SHELL). Optional; off by default.
import * as nut from '../engine/nutrition.js';
import { esc } from './components.js';
import { ds } from '../util.js';

let override = null;   // user-picked day type for today (module state)
const DAY_TYPES = [['lift', '🏋️ Lift'], ['cardio', '🫀 Cardio'], ['both', '⚡ Both'], ['rest', '😴 Rest']];

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

export function render(ctx) {
  const p = ctx.store.getProfile();
  const mode = p.nutrition?.mode || 'off';
  if (mode === 'off') {
    return `<div class="page-head"><p class="sub">Optional. Training works without it.</p></div>
      <div class="card hero"><div style="font-size:34px">🥗</div><h2 class="mt">Want daily targets?</h2>
        <p class="muted mt">Forge can give you calorie and macro targets for your goal (${esc(p.goal || 'recomp').replace('_', ' ')}). <b style="color:var(--text)">Simple</b> keeps them the same every day. <b style="color:var(--text)">Carb cycling</b> puts more carbs on lift days and fewer on rest days, like Iron Runner did.</p>
        <div class="btn-row mt2"><button class="btn" data-mode="simple">Simple</button><button class="btn btn-primary" data-mode="cycling">Carb cycling</button></div></div>
      ${tips('Eating on Adderall', nut.ADDERALL_TIPS, '💊')}`;
  }
  const sessions = (() => { try { return ctx.store.getSessions(); } catch (e) { return []; } })();
  const inferred = inferDayType(sessions);
  const dayType = override || inferred;
  const t = (() => { try { return nut.dailyTargets(p, { dayType, bodyweight: p.bodyweight }); } catch (e) { console.error(e); return null; } })();
  const macro = (label, g, kcal, color) => `<div class="stat"><div class="row between"><div class="v">${g}<small>g</small></div><span class="dot-i" style="background:${color}"></span></div><div class="l">${label} · ${kcal} kcal</div></div>`;
  const total = t ? t.protein * 4 + t.carbs * 4 + t.fat * 9 : 1;
  const seg = t ? [[t.protein * 4, 'var(--accent)'], [t.carbs * 4, 'var(--accent2)'], [t.fat * 9, 'var(--cardio)']] : [];
  return `<div class="page-head"><p class="sub">${mode === 'cycling' ? 'Carb cycling' : 'Simple targets'} · ${esc((p.goal || 'recomp').replace('_', ' '))}</p></div>
    ${mode === 'cycling' ? `<div class="tabs mb" data-day>${DAY_TYPES.map(([v, l]) => `<button class="${dayType === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
      <p class="tiny muted mb" style="margin-left:4px">${override ? 'Manual pick' : 'Detected from today\'s workouts'}${override ? ' · <a href="#" data-auto>use detected</a>' : ''}</p>` : ''}
    ${t ? `<div class="card hero"><div class="label">Today's target</div>
        <div style="font-size:44px;font-weight:850;letter-spacing:-.03em;line-height:1.1" class="num">${t.calories.toLocaleString()}<span class="muted" style="font-size:16px;font-weight:650"> kcal</span></div>
        <div class="row mt" style="gap:2px;height:10px;border-radius:5px;overflow:hidden">${seg.map(([v, c]) => `<div style="flex:${v};background:${c};height:100%"></div>`).join('')}</div>
        <div class="grid3 mt">${macro('Protein', t.protein, t.protein * 4, 'var(--accent)')}${macro('Carbs', t.carbs, t.carbs * 4, 'var(--accent2)')}${macro('Fat', t.fat, t.fat * 9, 'var(--cardio)')}</div>
        ${t.note ? `<p class="small mt" style="color:#cfcfd8">${esc(t.note)}</p>` : ''}</div>`
      : `<div class="card"><h3>Add your bodyweight</h3><p class="muted small mt">Targets are based on bodyweight.</p><div class="row mt"><input type="number" inputmode="decimal" step="0.1" id="nbw" placeholder="lb" class="grow"><button class="btn btn-primary" data-bw>Save</button></div></div>`}
    <div class="btn-row"><button class="btn btn-sm btn-ghost" data-mode="${mode === 'cycling' ? 'simple' : 'cycling'}">Switch to ${mode === 'cycling' ? 'simple' : 'carb cycling'}</button><button class="btn btn-sm btn-ghost" data-mode="off">Turn off</button></div>
    ${tips('Eating on Adderall', nut.ADDERALL_TIPS, '💊')}
    ${tips('Nutrition basics', nut.NUTRITION_TIPS, '📌')}
    ${Array.isArray(nut.SUPPLEMENTS) && nut.SUPPLEMENTS.length ? `<div class="section-title">💊 Supplements worth it</div><div class="list">${nut.SUPPLEMENTS.map(s => `<div class="list-item" style="align-items:flex-start"><div class="grow"><div class="t">${esc(s.name)} <span class="muted small" style="font-weight:600">· ${esc(s.dose || '')}</span></div><div class="s">${esc(s.note || '')}</div></div></div>`).join('')}</div>` : ''}`;
}

export function bind(root, ctx) {
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    const p = ctx.store.getProfile();
    ctx.store.updateProfile({ nutrition: { ...(p.nutrition || {}), mode: b.dataset.mode } });
    ctx.toast(b.dataset.mode === 'off' ? 'Nutrition off' : 'Nutrition targets on');
  });
  root.querySelector('[data-day]')?.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { override = b.dataset.v; ctx.rerender(); } });
  root.querySelector('[data-auto]')?.addEventListener('click', e => { e.preventDefault(); override = null; ctx.rerender(); });
  root.querySelector('[data-bw]')?.addEventListener('click', () => {
    const v = parseFloat(root.querySelector('#nbw').value);
    if (v > 50 && v < 600) ctx.store.logBodyweight(ds(), v); else ctx.toast('Enter a weight in lb');
  });
}
