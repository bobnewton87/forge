// Shared targets UI (INTEGRATOR, CONTRACT §18): setTargets (save + debounced re-plan + toast),
// the one targets editor sheet, and the compact "Your targets" strip. Every screen that edits a
// target calls setTargets; every screen that shows one reads engine/targets.js resolveTargets.
// No DOM access at import time, so the pure helper (planUpdate) is importable in Node tests.
// CONTRACT-NOTE: extra exports: planUpdate({ profile, sessions, classSchedule, now, days }) (pure),
//   bindTargetsSummary(root, ctx), cardioTargetHTML(ctx, { compact }) + bindCardioTarget(root, ctx)
//   (the editable weekly cardio card used on Body), openMakeRoomSheet(ctx) + makeRoomHTML(ctx) (one-tap
//   availability fix when the cardio target doesn't fit; buttons carry data-tg-room), REPLAN_DAYS, ensureTargetStyles(). Styles are injected
//   at runtime (a <style id="tg-css">) because INTEGRATOR owns no CSS file.
import { resolveTargets, applyTargetChange, needsReplan, describeChange, cardioWeek, makeRoomProposal, LIMITS, CARDIO_CHIPS, STYLES, GOALS } from '../engine/targets.js';
import { planRange } from '../engine/planner.js';
import { CARDIO } from '../data/cardio.js';
import { ds, addDays, weekStart } from '../util.js';
import { esc } from './components.js';

export const REPLAN_DAYS = 28;
const STYLE_NAMES = { hypertrophy: 'Hypertrophy', pump: 'Pump', strength: 'Strength', circuit: 'Circuit' };
const GOAL_NAMES = { recomp: 'Recomp', lean_bulk: 'Lean bulk', cut: 'Cut' };
const MODE_NAMES = { off: 'Off', simple: 'Simple', cycling: 'Carb cycling' };
const MOD_CHOICES = ['run', 'treadmill', 'bike', 'spin', 'walk_incline', 'row', 'elliptical', 'stairmaster', 'swim', 'walk'];
const safe = (fn, fb) => { try { const v = fn(); return v == null ? fb : v; } catch (e) { console.error(e); return fb; } };
const sgnK = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(Math.round(n)).toLocaleString();

// Styles live here (INTEGRATOR owns no CSS file); injected once on first render. Uses base.css variables only.
const CSS = `
.tg-strip{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:10px 12px 12px;margin:0 0 14px}
.tg-head{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.tg-edit{background:none;border:0;color:var(--accent);font-weight:700;font-size:13px;padding:6px 2px;min-height:32px;text-transform:none;letter-spacing:0}
.tg-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}
.tg-item{display:flex;gap:8px;align-items:center;text-align:left;background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:8px 10px;min-height:52px;color:var(--text);min-width:0}
.tg-item.warn{border-color:var(--warn)}
.tg-ic{font-size:18px;flex:none}
.tg-t{display:flex;flex-direction:column;min-width:0}
.tg-t b{font-size:14px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tg-t small{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tg-warn,.tg-warnp{color:var(--warn);font-size:12px;margin-top:8px;line-height:1.4}
.tg-step{display:flex;align-items:center;gap:10px;margin-top:8px}
.tg-step>button{width:56px;min-height:52px;font-size:26px;font-weight:700;border-radius:12px;background:var(--card2);border:1px solid var(--line);color:var(--text);flex:none}
.tg-step>button:disabled{opacity:.35}
.tg-step.sm{margin:0;gap:8px}.tg-step.sm>button{width:40px;min-height:40px;font-size:20px}.tg-step.sm b{min-width:72px;text-align:center}
.tg-stepv{flex:1;text-align:center;display:flex;flex-direction:column}
.tg-stepv b{font-size:30px;font-weight:850;line-height:1.05;color:var(--cardio)}
.tg-stepv span{font-size:12px;color:var(--muted);font-weight:650}
.tg-chips{margin:10px 0 12px;justify-content:center}
.tg-track{position:relative;height:10px;border-radius:5px;background:var(--card2);margin-top:4px}
.tg-track i{position:absolute;top:0;bottom:0;border-radius:5px}
.tg-track i.d,.tg-legend i.d{background:var(--cardio)}
.tg-track i.p,.tg-legend i.p{background:repeating-linear-gradient(135deg,var(--cardio) 0 4px,transparent 4px 8px);opacity:.75}
.tg-track .tick{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--text);opacity:.6;border-radius:1px}
.tg-legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;align-items:center}
.tg-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.tg-sheet h2{margin:0 0 4px}
.tg-sec{border-top:1px solid var(--line);padding:14px 0 10px;margin-top:10px}
.tg-sec.focus .tg-sec-h{color:var(--accent)}
.tg-sec-h{font-weight:800;font-size:16px;margin-bottom:6px}
.tg-line{min-height:48px;gap:10px}
.tg-seg{margin:8px 0}
.tg-nudge{display:flex;gap:10px;align-items:center}
.tg-roomline{display:flex;gap:10px;align-items:center;justify-content:space-between}
.tg-roomline .tg-room{flex:none;border-color:var(--warn);color:var(--warn)}
.tg-diff .tg-from{color:var(--muted);text-decoration:line-through}
`;
export function ensureTargetStyles() { ensureStyles(); }
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('tg-css')) return;
  const st = document.createElement('style'); st.id = 'tg-css'; st.textContent = CSS; document.head.appendChild(st);
}

// ---------------------------------------------------------------- pure re-plan
// Which auto days to regenerate: today → the end of this week, or further if auto-planned days
// already exist (up to REPLAN_DAYS). Custom (plan.auto:false) and done days are kept.
export function planUpdate({ profile, sessions = [], classSchedule = null, now = new Date(), days = REPLAN_DAYS } = {}) {
  const from = ds(now);
  const horizon = ds(addDays(now, days - 1));
  const weekEnd = ds(addDays(weekStart(now), 6));
  let to = weekEnd;
  for (const s of sessions) if (s && s.status === 'planned' && s.plan?.auto && s.date >= from && s.date <= horizon && s.date > to) to = s.date;
  // Extend to the end of that last week so a re-planned week is whole.
  const lastWeekEnd = ds(addDays(weekStart(new Date(to + 'T12:00:00')), 6));
  to = lastWeekEnd > horizon ? horizon : lastWeekEnd;
  const n = Math.round((new Date(to + 'T12:00:00') - new Date(from + 'T12:00:00')) / 864e5) + 1;
  const list = planRange({ from, days: n, profile, sessions, schedule: profile.schedule, classSchedule, now, keep: x => !(x.plan && x.plan.auto) })
    .filter(s => s && s.date >= from && s.date <= to);
  return { from, to, list };
}

// ---------------------------------------------------------------- setTargets
let timer = null, waiters = [], lastReason = '';
let classCache;
async function classSchedule() {
  if (classCache !== undefined) return classCache;
  try {
    const m = await import('../classes/crunch.js');
    classCache = await Promise.race([m.loadSchedule(), new Promise(r => setTimeout(() => r(null), 2500))]);
  } catch (e) { classCache = null; }
  return classCache;
}
function toast(ctx, m) { try { ctx.toast(m); } catch (e) { /* ignore */ } }

async function runReplan(ctx) {
  const store = ctx.store;
  const profile = store.getProfile();
  const cs = await classSchedule();
  const { from, to, list } = planUpdate({ profile, sessions: store.getSessions(), classSchedule: cs, now: new Date() });
  store.replacePlanned(from, to, list);
  const w = cardioWeek(profile, store.getSessions(), { now: new Date() });
  let msg = `Plan updated for ${lastReason || 'your targets'}`;
  if (w.target && w.capacity < w.target - 5) msg += `. This week fits ~${w.capacity} cardio min; tap "Make room" for the rest`;
  toast(ctx, msg);
}

// Saves the patch through applyTargetChange; re-plans upcoming auto days (debounced) when the
// change affects planning. Resolves after the save, or after the re-plan when one runs.
export function setTargets(ctx, patch, { replan = true, reason, quiet = false } = {}) {
  const store = ctx.store;
  const before = store.getProfile();
  const after = applyTargetChange(before, patch);
  const what = reason || describeChange(before, after);
  if (!what) return Promise.resolve();
  store.saveProfile(after);
  if (!(replan && needsReplan(before, after))) { if (!quiet) toast(ctx, `Saved: ${what}`); return Promise.resolve(); }
  lastReason = what;
  if (!quiet) toast(ctx, `Saved: ${what}. Updating your plan…`);
  clearTimeout(timer);
  return new Promise(resolve => {
    waiters.push(resolve);
    timer = setTimeout(async () => {
      const ws = waiters; waiters = [];
      try { await runReplan(ctx); } catch (e) { console.error(e); toast(ctx, 'Saved. Re-plan from the Plan tab to apply it.'); }
      ws.forEach(r => r());
    }, 600);
  });
}

// ---------------------------------------------------------------- capacity warning + "Make room"
// Warning line for this week when the cardio target doesn't fit, with a Make room button when
// the availability template can be changed to hold it. '' when it fits.
export function makeRoomHTML(ctx, { cls = 'tg-warnp' } = {}) {
  const p = ctx.store.getProfile();
  const w = cardioWeek(p, safe(() => ctx.store.getSessions(), []), { now: new Date() });
  if (!w.target || w.capacity >= w.target - 5) return '';
  const prop = safe(() => makeRoomProposal(p), null);
  const can = prop && prop.changes.length;
  return `<div class="${cls} tg-roomline"><span>⚠︎ This week fits ~${w.capacity} cardio min alongside lifting, ${w.target - w.capacity} short of ${w.target}.${can ? '' : ' Add a cardio day or more minutes in Availability.'}</span>${can ? '<button type="button" class="btn btn-sm tg-room" data-tg-room>Make room</button>' : ''}</div>`;
}
export function bindMakeRoom(root, ctx) {
  root.querySelectorAll('[data-tg-room]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openMakeRoomSheet(ctx); }));
}
const slotTxt = d => (d.kind === 'rest' ? 'Rest' : `${d.kind[0].toUpperCase() + d.kind.slice(1)} ${d.minutes}′`);
export function openMakeRoomSheet(ctx) {
  ensureStyles();
  const p = ctx.store.getProfile();
  const prop = makeRoomProposal(p);
  if (!prop.changes.length) { toast(ctx, 'No availability change found. Add a cardio day in Availability.'); return; }
  const html = `<div class="tg-sheet"><h2>Make room for ${prop.target} min of cardio</h2>
    <p class="muted small">A typical week of your availability holds ~${prop.before} cardio min alongside lifting (this week: ~${safe(() => cardioWeek(p, ctx.store.getSessions(), { now: new Date() }).capacity, prop.before)}). These changes take it to ~${prop.after}${prop.enough ? '' : `, still ${prop.short} short. Add another day for the rest`}.</p>
    <div class="list mt">${prop.changes.map(c => `<div class="list-item tg-diff"><div class="grow"><div class="t">${esc(c.label)}</div>
      <div class="s"><span class="tg-from">${esc(slotTxt(c.from))}</span> → <b>${esc(slotTxt(c.to))}</b> · +${c.gain} cardio min</div></div></div>`).join('')}</div>
    <p class="tiny muted mt">Lift days keep their lifting; flex days turned to cardio give up a possible lift or class. Custom planned days stay as they are.</p>
    <div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-room-apply>Apply and re-plan</button>
    <button type="button" class="btn btn-ghost btn-block" data-room-cancel>Cancel</button></div></div>`;
  ctx.openSheet(html, (el, close) => {
    el.querySelector('[data-room-cancel]').onclick = () => close();
    el.querySelector('[data-room-apply]').onclick = () => {
      close();
      setTargets(ctx, { training: { schedule: prop.schedule } }, { replan: true, reason: `room for ${prop.target} min/wk cardio` });
    };
  });
}

// ---------------------------------------------------------------- summary strip
export function targetsSummaryHTML(ctx, { title = 'Your targets' } = {}) {
  ensureStyles();
  const p = ctx.store.getProfile();
  const sessions = safe(() => ctx.store.getSessions(), []);
  const t = resolveTargets(p, { sessions });
  const w = t.cardio.week;
  const n = t.nutrition;
  const kcal = n.mode === 'off' ? 'Nutrition off' : n.calories ? `${n.calories.toLocaleString()} kcal` : n.surplus != null ? `${sgnK(n.surplus)} kcal` : 'Goal default kcal';
  const item = (focus, ic, main, sub, warn = false) => `<button type="button" class="tg-item${warn ? ' warn' : ''}" data-tgt="${focus}"><span class="tg-ic">${ic}</span><span class="tg-t"><b>${esc(main)}</b><small>${esc(sub)}</small></span></button>`;
  const room = safe(() => makeRoomHTML(ctx, { cls: 'tg-warn' }), '');
  const short = !!room;
  return `<div class="tg-strip" role="group" aria-label="${esc(title)}">
    <div class="tg-head"><span>${esc(title)}</span><button type="button" class="tg-edit" data-tgt="cardio">Edit</button></div>
    <div class="tg-row">
      ${item('cardio', '🏃', `${t.cardio.minPerWeek}′ cardio/wk`, w ? `${w.done} done · ${w.planned} planned` : 'weekly target', short)}
      ${item('training', '🏋️', `${t.training.daysPerWeek} days · ${Math.round(t.training.totalMinPerWeek / 60 * 10) / 10}h`, `${t.training.defaultMinutes}′ default · ${STYLE_NAMES[t.training.style]}`)}
      ${item('nutrition', '🍽️', kcal, n.mode === 'off' ? 'tap to set targets' : `${n.proteinGPerLb} g/lb protein · ${n.fatPct}% fat`)}
      ${item('adherence', '🎯', `${Math.round(t.adherence * 100)}% adherence`, `${GOAL_NAMES[t.goals.goal]} → ${t.goals.goalBodyFatPct}% BF`)}
    </div>
    ${room}
  </div>`;
}
export function bindTargetsSummary(root, ctx) {
  root.querySelectorAll('.tg-strip [data-tgt]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openTargetsSheet(ctx, { focus: b.dataset.tgt }); }));
  root.querySelectorAll('.tg-strip').forEach(st => bindMakeRoom(st, ctx));
}

// ---------------------------------------------------------------- cardio card (Body)
export function cardioTargetHTML(ctx) {
  ensureStyles();
  const p = ctx.store.getProfile();
  const sessions = safe(() => ctx.store.getSessions(), []);
  const t = resolveTargets(p, { sessions });
  const w = t.cardio.week;
  const target = t.cardio.minPerWeek;
  const scale = Math.max(target, w.total, 1);
  const left = Math.max(0, target - w.done);
  return `<div class="card tg-cardio" data-tg-cardio>
    <div class="row between"><div class="card-title">🫀 Weekly cardio target</div><button type="button" class="link small" data-tg-plan>Plan ›</button></div>
    <div class="tg-step" role="group" aria-label="Weekly cardio target">
      <button type="button" data-tg-ct="-15" aria-label="Lower cardio target" ${target <= LIMITS.cardioMin[0] ? 'disabled' : ''}>−</button>
      <div class="tg-stepv"><b class="num" data-tg-ctv>${target}</b><span>min / week</span></div>
      <button type="button" data-tg-ct="15" aria-label="Raise cardio target" ${target >= LIMITS.cardioMin[1] ? 'disabled' : ''}>+</button></div>
    <div class="chips tg-chips">${CARDIO_CHIPS.map(v => `<button type="button" class="chip sm ${v === target ? 'active' : ''}" data-tg-cset="${v}">${v}</button>`).join('')}</div>
    <div class="tg-track" aria-hidden="true"><i class="d" style="width:${(w.done / scale) * 100}%"></i><i class="p" style="left:${(w.done / scale) * 100}%;width:${(w.planned / scale) * 100}%"></i><span class="tick" style="left:${(target / scale) * 100}%"></span></div>
    <div class="tg-legend small"><span><i class="d"></i>${w.done} done</span><span><i class="p"></i>${w.planned} planned</span><span class="muted">target ${target} · this week</span></div>
    <p class="small muted" style="margin:8px 0 0">${target === 0 ? 'No cardio target: the planner leans toward lifting.' : w.total >= target ? 'This week\'s plan covers your target.' : `${left} min to go this week${w.planned ? `, ${Math.max(0, target - w.total)} not planned yet` : ''}.`}</p>
    ${safe(() => makeRoomHTML(ctx), '')}
  </div>`;
}
export function bindCardioTarget(root, ctx) {
  const card = root.querySelector('[data-tg-cardio]'); if (!card) return;
  const set = v => setTargets(ctx, { cardio: { minPerWeek: v } });
  card.querySelectorAll('[data-tg-ct]').forEach(b => b.onclick = () => { const cur = resolveTargets(ctx.store.getProfile()).cardio.minPerWeek; set(cur + Number(b.dataset.tgCt)); });
  card.querySelectorAll('[data-tg-cset]').forEach(b => b.onclick = () => set(Number(b.dataset.tgCset)));
  card.querySelector('[data-tg-plan]')?.addEventListener('click', () => ctx.nav('plan'));
  bindMakeRoom(card, ctx);
}

// ---------------------------------------------------------------- the shared editor sheet
function sheetHTML(ctx, focus) {
  const p = ctx.store.getProfile();
  const t = resolveTargets(p, { sessions: safe(() => ctx.store.getSessions(), []) });
  const c = t.cardio, n = t.nutrition, w = c.week;
  const sec = (id, title, body) => `<section class="tg-sec ${focus === id ? 'focus' : ''}" id="tg-${id}"><div class="tg-sec-h">${title}</div>${body}</section>`;
  const seg = (attr, opts, cur) => `<div class="tabs tg-seg">${opts.map(([v, l]) => `<button type="button" class="${String(v) === String(cur) ? 'active' : ''}" data-${attr}="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
  const step = (attr, label, val, unit) => `<div class="row between tg-line"><span>${label}</span><span class="tg-step sm"><button type="button" data-${attr}="-1" aria-label="Less">−</button><b class="num">${val}${unit}</b><button type="button" data-${attr}="1" aria-label="More">+</button></span></div>`;
  const cardio = sec('cardio', '🏃 Cardio', `
    <div class="tg-step"><button type="button" data-s-ct="-15" aria-label="Lower cardio target">−</button><div class="tg-stepv"><b class="num">${c.minPerWeek}</b><span>min / week</span></div><button type="button" data-s-ct="15" aria-label="Raise cardio target">+</button></div>
    <div class="chips tg-chips">${CARDIO_CHIPS.map(v => `<button type="button" class="chip sm ${v === c.minPerWeek ? 'active' : ''}" data-s-cset="${v}">${v}</button>`).join('')}</div>
    <p class="tiny muted">This week: ${w.done} done + ${w.planned} planned. Your availability fits ~${t.capacity.cardio} min (cardio days ${t.capacity.cardioDays}, flex ${t.capacity.flex}, finishers ${t.capacity.finishers}).</p>
    ${step('s-hard', 'Hard sessions / week', c.hardSessionsPerWeek, '')}
    <div class="label mt">Preferred cardio <span class="muted tiny">(none = planner picks)</span></div>
    <div class="chips">${MOD_CHOICES.filter(m => CARDIO[m]).map(m => `<button type="button" class="chip sm ${c.modalities.includes(m) ? 'active' : ''}" data-s-mod="${m}">${esc((CARDIO[m].icon || '') + ' ' + CARDIO[m].name)}</button>`).join('')}</div>`);
  const training = sec('training', '🏋️ Training', `
    <p class="tiny muted">${t.training.daysPerWeek} days · ${t.training.totalMinPerWeek} min/week available · ~${t.training.liftMinPerWeek} lift min after cardio.</p>
    <div class="label">Default session length</div>
    <div class="chips">${[15, 20, 30, 45, 60, 75, 90].map(m => `<button type="button" class="chip sm ${t.training.defaultMinutes === m ? 'active' : ''}" data-s-min="${m}">${m}</button>`).join('')}</div>
    <div class="label mt">Default style</div>${seg('s-style', STYLES.map(s => [s, STYLE_NAMES[s]]), t.training.style)}
    <button type="button" class="btn btn-ghost btn-block mt" data-s-avail>🗓 Weekly availability (Plan)</button>`);
  const nutrition = sec('nutrition', '🍽️ Nutrition', `
    ${seg('s-mode', Object.entries(MODE_NAMES), n.mode)}
    ${step('s-sur', 'Calories vs maintenance', n.calories ? `${n.calories.toLocaleString()}` : sgnK(n.surplus ?? 0), n.calories ? ' kcal' : '')}
    ${step('s-pg', 'Protein', n.proteinGPerLb.toFixed(2), ' g/lb')}
    ${step('s-fat', 'Fat', n.fatPct, '%')}
    <button type="button" class="btn btn-ghost btn-block mt" data-s-nut>Full nutrition screen ›</button>`);
  const adherence = sec('adherence', '🎯 Adherence & goal', `
    <div class="row between tg-line"><span>Adherence <span class="tiny muted">share of planned sessions you do</span></span><b class="num" data-s-adhv>${Math.round(t.adherence * 100)}%</b></div>
    <input type="range" class="bd-range" min="0.5" max="1" step="0.05" value="${t.adherence}" data-s-adh style="--pct:${((t.adherence - 0.5) / 0.5) * 100}%" aria-label="Adherence">
    <div class="label mt">Goal</div>${seg('s-goal', GOALS.map(g => [g, GOAL_NAMES[g]]), t.goals.goal)}
    ${step('s-bf', 'Goal body fat', t.goals.goalBodyFatPct, '%')}`);
  const order = { cardio: [cardio, training, nutrition, adherence], training: [training, cardio, nutrition, adherence], nutrition: [nutrition, cardio, training, adherence], adherence: [adherence, cardio, training, nutrition] }[focus] || [cardio, training, nutrition, adherence];
  return `<div class="tg-sheet"><h2>Your targets</h2><p class="muted small">One set of targets for Plan, Today, Body, Nutrition and the projection. Changes save right away; auto-planned days re-plan, custom days stay.</p>${order.join('')}</div>`;
}

export function openTargetsSheet(ctx, { focus = 'cardio' } = {}) {
  ensureStyles();
  ctx.openSheet(sheetHTML(ctx, focus), (el, close) => {
    const paint = () => { const y = el.scrollTop; el.innerHTML = sheetHTML(ctx, focus); el.scrollTop = y; };
    const T = () => resolveTargets(ctx.store.getProfile());
    const set = (patch, opts) => { setTargets(ctx, patch, opts); paint(); };
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      const d = b.dataset; const t = T();
      if (d.sCt) set({ cardio: { minPerWeek: t.cardio.minPerWeek + Number(d.sCt) } });
      else if (d.sCset) set({ cardio: { minPerWeek: Number(d.sCset) } });
      else if (d.sHard) set({ cardio: { hardSessionsPerWeek: t.cardio.hardSessionsPerWeek + Number(d.sHard) } });
      else if (d.sMod) { const m = new Set(t.cardio.modalities); m.has(d.sMod) ? m.delete(d.sMod) : m.add(d.sMod); set({ cardio: { modalities: [...m] } }); }
      else if (d.sMin) set({ training: { defaultMinutes: Number(d.sMin) } }, { replan: false });
      else if (d.sStyle) set({ training: { style: d.sStyle } });
      else if (d.sMode) set({ nutrition: { mode: d.sMode } }, { replan: false });
      else if (d.sSur) {
        const n = t.nutrition;
        if (n.calories) set({ nutrition: { calories: n.calories + Number(d.sSur) * 50 } }, { replan: false });
        else set({ nutrition: { surplus: (n.surplus ?? 0) + Number(d.sSur) * 50, mode: n.mode === 'off' ? 'simple' : n.mode } }, { replan: false });
      }
      else if (d.sPg) set({ nutrition: { proteinGPerLb: Math.round((t.nutrition.proteinGPerLb + Number(d.sPg) * 0.05) * 100) / 100 } }, { replan: false });
      else if (d.sFat) set({ nutrition: { fatPct: t.nutrition.fatPct + Number(d.sFat) } }, { replan: false });
      else if (d.sGoal) set({ goals: { goal: d.sGoal } }, { replan: false });
      else if (d.sBf) set({ goals: { goalBodyFatPct: t.goals.goalBodyFatPct + Number(d.sBf) * 0.5 } }, { replan: false });
      else if ('sAvail' in d) { close(); ctx.nav('plan', { avail: true }); }
      else if ('sNut' in d) { close(); ctx.nav('nutrition'); }
    });
    el.addEventListener('input', e => {
      const r = e.target.closest('[data-s-adh]'); if (!r) return;
      el.querySelector('[data-s-adhv]').textContent = Math.round(r.value * 100) + '%';
      r.style.setProperty('--pct', ((r.value - 0.5) / 0.5) * 100 + '%');
    });
    el.addEventListener('change', e => { const r = e.target.closest('[data-s-adh]'); if (r) set({ adherence: Number(r.value) }, { replan: false }); });
    const f = el.querySelector('.tg-sec.focus'); if (f && f !== el.querySelector('.tg-sec')) f.scrollIntoView({ block: 'start' });
  });
}
