// Shared targets UI (INTEGRATOR, CONTRACT §18): setTargets (save + debounced re-plan + toast),
// the one targets editor sheet, and the compact "Your targets" strip. Every screen that edits a
// target calls setTargets; every screen that shows one reads engine/targets.js resolveTargets.
// No DOM access at import time, so the pure helper (planUpdate) is importable in Node tests.
// CONTRACT-NOTE: extra exports: planUpdate({ profile, sessions, classSchedule, now, days }) (pure),
//   bindTargetsSummary(root, ctx), cardioTargetHTML(ctx, { compact }) + bindCardioTarget(root, ctx)
//   (the editable weekly cardio card used on Body), openMakeRoomSheet(ctx) + makeRoomHTML(ctx) (one-tap
//   availability fix when the cardio target doesn't fit; buttons carry data-tg-room), openMinimumsInfo(ctx)
//   ("Why these numbers?"), openVolumeRoomSheet(ctx, short), openExtendSheet(ctx, { extended, onApply }),
//   extendedToast(list), REPLAN_DAYS, ensureTargetStyles(). Styles are injected
//   at runtime (a <style id="tg-css">) because INTEGRATOR owns no CSS file.
import { resolveTargets, applyTargetChange, needsReplan, describeChange, cardioWeek, makeRoomProposal, volumeRoomOptions, unitTargets, maxNote, starredUnits, STAR_LEGEND, MINIMUMS_EVIDENCE, LIMITS, CARDIO_CHIPS, STYLES, GOALS, VOLUME_MODES, CARDIO_STYLES, CARDIO_STYLE_NAMES, CARDIO_STYLE_WHY } from '../engine/targets.js';
import { planRange } from '../engine/planner.js';
import { resolveStyle } from '../engine/generator.js';
import { explainWeek } from '../engine/planner.js';
import { CARDIO } from '../data/cardio.js';
import { ds, addDays, weekStart } from '../util.js';
import { esc } from './components.js';
import { MAX_WHY } from '../data/muscles.js';

export const REPLAN_DAYS = 28;
const styleShort = (id, p) => { const d = resolveStyle(id, p); return d.short || d.name; };
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
.tg-mins{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tg-units{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.tg-xtab{overflow-x:auto;margin-top:8px}.tg-xtab table{width:100%;border-collapse:collapse;font-size:12px}
.tg-xtab th{text-align:left;color:var(--muted);font-weight:650;padding:4px 6px;border-bottom:1px solid var(--line)}
.tg-xtab td{padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.tg-xtab tr.toward td b{color:var(--warn)}.tg-xtab tr.under td b{color:var(--bad)}.tg-xtab tr.over td b{color:var(--accent2)}.tg-xtab tr.ok td b{color:var(--good)}
.tgb{margin:8px 0 10px}.tgb-top{display:flex;justify-content:space-between;font-size:13px;font-weight:650;margin-bottom:4px}
.tgb-track{position:relative;height:8px;border-radius:4px;background:var(--card2)}
.tgb-track i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--good)}
.tgb.under .tgb-track i{background:var(--bad)}.tgb.toward .tgb-track i{background:var(--warn)}.tgb.over .tgb-track i{background:var(--accent2)}
.tgb.under .tgb-top b{color:var(--bad)}.tgb.toward .tgb-top b{color:var(--warn)}.tgb.over .tgb-top b{color:var(--accent2)}
.tgb-track .tk{position:absolute;top:-3px;bottom:-3px;width:2px;border-radius:1px}
.tgb-track .tk.min{background:var(--text);opacity:.55}.tgb-track .tk.tgt{border-left:2px dashed var(--accent2);width:0}.tgb-track .tk.max{background:var(--muted);opacity:.5;width:3px}
.pl-bar-row.toward .pl-track i.d{background:var(--warn)}.pl-bar-row.toward .pl-bar-top .num b{color:var(--warn)}
.pl-bar-row.under .pl-track i.d{background:var(--bad)}.pl-bar-row.under .pl-bar-top .num b{color:var(--bad)}
.pl-bar-row.over .pl-track i.d{background:var(--accent2)}
.pl-track .tick.max{background:var(--muted);opacity:.5;width:3px}
.tg-unit{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.pl-track .tick.tgt,.pl-legend i.t.tgt{background:none;border-left:2px dashed var(--accent2);width:0}
.pl-legend i.t.tgt{display:inline-block;height:10px}
.pl-sub .pl-bar-top span:first-child{padding-left:14px;font-size:12px;color:var(--muted)}
.pl-below-tgt .pl-track i.d{background:var(--warn)}
.pl-cstyle{display:flex;align-items:center;gap:8px;margin-top:10px}.pl-cstyle .tabs{flex:1;margin:0}
.pl-ext{background:var(--card2);border:1px solid var(--accent);color:var(--accent);font-weight:750;border-radius:999px;padding:1px 7px;font-size:11px;margin-left:6px;cursor:pointer}
.pl-mins{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:13px}
.pl-mins .ok{color:var(--good);font-weight:750}.pl-mins .bad{color:var(--warn);font-weight:750}
.pl-mins button{background:none;border:0;color:var(--accent);font-weight:700;font-size:13px;padding:6px 2px;min-height:32px}
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
  const ext = extendedToast(list); if (ext) msg += `. ${ext}`;
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

// ---------------------------------------------------------------- weekly sets vs TARGET
// Band of a weekly set count: < min 'under' (red) · min…target 'toward' (amber) · target…max 'ok'
// (green) · > max 'over' (orange). t = { min, target, max } (target falls back to min).
export function setsBand(sets, t = {}) {
  const min = Number(t.min) || 0, target = Number(t.target ?? t.min) || 0, max = Number(t.max) || Math.max(target, min) || 0;
  if (max && sets > max + 0.25) return 'over';
  if (sets < min - 0.25) return 'under';
  if (sets < target - 0.25) return 'toward';
  return 'ok';
}
export const BAND_LABEL = { under: 'below minimum', toward: 'toward target', ok: 'on target', over: 'over max' };
// Bar comparing weekly sets with the target: fill coloured by band, solid tick = minimum, dashed tick =
// target, end marker = max (in the tooltip too). Text reads "14 / 15 target".
export function targetBar(label, sets, t = {}, { sub = '' } = {}) {
  ensureStyles();
  const min = Number(t.min) || 0, target = Number(t.target ?? t.min) || 0, max = Number(t.max) || Math.max(target, min, 1);
  const band = setsBand(sets, t), scale = Math.max(max, sets, 1);
  const pct = v => Math.min(100, (v / scale) * 100);
  const f = v => (Math.round(v * 10) / 10).toString();
  return `<div class="tgb ${band}" title="${esc(`${label}: ${f(sets)} sets · min ${f(min)} · target ${f(target)} · max ${f(max)} (${BAND_LABEL[band]})`)}">
    <div class="tgb-top"><span>${esc(label)}</span><span class="num"><b>${f(sets)}</b><span class="muted"> / ${f(target)} target</span></span></div>
    <div class="tgb-track"><i style="width:${pct(sets)}%"></i>${min > 0 ? `<span class="tk min" style="left:${pct(min)}%"></span>` : ''}<span class="tk tgt" style="left:${pct(target)}%"></span><span class="tk max" style="left:${pct(max)}%"></span></div>
    ${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>`;
}

// ---------------------------------------------------------------- weekly minimums sheets
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = date => DOWS[new Date(date + 'T12:00:00').getDay()];
// "Extended Mon 45→60′ and Thu 45→55′ to reach your weekly set targets" (null when nothing was extended).
export function extendedToast(list) {
  const ext = (list || []).filter(s => s?.plan?.extended).sort((a, b) => a.date.localeCompare(b.date));
  if (!ext.length) return null;
  const parts = ext.slice(0, 3).map(s => `${dayName(s.date)} ${s.plan.extended.from}→${s.plan.extended.to}′`);
  const more = ext.length > 3 ? ` +${ext.length - 3} more` : '';
  return `Extended ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]}${more} to reach your weekly set targets`;
}
const FLOOR_WHY = {
  priority: 'priority muscle, where gains rise steeply up to ~10 sets (Schoenfeld 2017; Pelland 2025)',
  normal: 'normal muscle, above the ~4-set minimum effective dose (Pelland 2025)',
  maintenance: 'maintenance, about a third of a build dose (Bickel 2011; Spiering 2021)',
  none: 'covered by other lifts (pulling, curls, carries)', tracked: 'tracked only, not counted toward any minimum',
};
export function openMinimumsInfo(ctx) {
  ensureStyles();
  const p = ctx.store.getProfile();
  const t = resolveTargets(p);
  const U = unitTargets(p);
  const rows = Object.entries(U).filter(([, x]) => x.min > 0 || x.target > 0);
  const stars = starredUnits(p);
  const starWhy = x => [x.tier === 'priority' && x.slider >= 0.95 && 'one of your priorities', x.slider > 1.05 && `slider ×${x.slider}`, x.extra > 0 && `sculpt goals +${x.extra}`].filter(Boolean).join(', ');
  // This week's sliders → targets → plan chain (planner.explainWeek), so Bob can check it himself.
  const ex = safe(() => explainWeek(ctx.store.getSessions(), { weekStart: weekStart(new Date()), profile: p, now: new Date() }), null);
  const f = v => (Math.round(v * 10) / 10).toString();
  const table = ex ? `<div class="label mt">This week: sliders → targets → plan</div>
    <div class="tg-xtab"><table><thead><tr><th>Muscle</th><th>Base × slider + extra</th><th>Target</th><th>Planned</th><th>Status</th></tr></thead><tbody>
    ${Object.entries(ex).filter(([, x]) => x.target > 0).map(([, x]) => `<tr class="${x.status}"><td>${esc(x.name)}</td><td>${f(x.base)} × ${f(x.slider)}${x.extra ? ` + ${f(x.extra)}` : ''}</td><td><b>${f(x.target)}</b><div class="tiny muted">min ${f(x.min)} · max ${f(x.max)}</div></td><td><b>${f(x.planned)}</b></td><td class="tiny">${esc(x.reason)}</td></tr>`).join('')}
    </tbody></table></div>` : '';
  const tracked = Object.entries(U).filter(([, x]) => !(x.min > 0 || x.target > 0)).map(([, x]) => x.name).join(', ');
  const deriv = x => `${x.base}${x.slider !== 1 ? ` × ${x.slider} (slider)` : ''}${x.extra ? ` + ${x.extra} (sculpt goals)` : ''}${x.base * x.slider + x.extra > x.max + 0.05 ? `, capped at ${x.max}` : ''}`;
  ctx.openSheet(`<div class="tg-sheet"><h2>Why these numbers?</h2>
    <p class="muted small">Weekly sets are compared with your <b>target</b>. Each muscle also has a <b>minimum</b> (the evidence floor, always planned) and a <b>max</b> Forge never plans past. The max is a ceiling on what the body can use and is the same whatever your priorities: 20 sets a week for most muscles (the top of the 12-20 range; more than 20 added nothing for biceps or quads, Baz-Valle et al. 2022), 24 for triceps (more than 20 helped them) and side delts, 22 for back (two muscles), 10 for lower back (fatigue guard). Priorities, sliders and sculpt goals move only the target, so a muscle you prioritize can sit at its max while its slider keeps rising: past the max, studies found extra sets add fatigue, not growth. ${esc(STAR_LEGEND)}.</p>
    ${table}
    <div class="label mt">Each muscle</div>
    <div class="tg-units">${rows.map(([id, x]) => `<div class="tg-unit"><div class="row between"><b>${stars.has(id) ? '<span class="star">★</span> ' : ''}${esc(x.name)}</b><span class="num small">target <b>${x.target}</b> · min ${x.min} · max ${x.max}</span></div>
      <div class="tiny muted">Floor ${x.min}: ${esc(FLOOR_WHY[x.tier] || FLOOR_WHY.normal)}. Target = ${esc(deriv(x))}. Max ${esc(MAX_WHY[id] || String(x.max))}.${stars.has(id) ? ` ★ ${esc(starWhy(x))}.` : ''}${(() => { const n = maxNote(id, x); return n && n.atMax ? ` <b>${n.capped ? `Your settings ask ${f(n.asked)}, but the target stops at the max.` : 'At the max: raising the slider adds no sets.'}</b>` : ''; })()}</div></div>`).join('')}</div>
    ${tracked ? `<p class="tiny muted">${esc(tracked)}: tracked, not counted (pressing covers front delts; traps and lower back don't count toward back).</p>` : ''}
    <div class="label mt">The evidence</div>
    <ul class="tip-list mt">${MINIMUMS_EVIDENCE.map(e => `<li>${esc(e.claim)} <span class="tiny muted">(${esc(e.source)})</span></li>`).join('')}</ul>
    <p class="tiny muted mt">Minimums: Forge lengthens workouts up to ${t.training.volumePolicy.maxMinutes}′ when your slot times can't fit them${t.training.volumePolicy.mode === 'fixed' ? ' (you chose fixed lengths, so it only warns)' : t.training.volumePolicy.mode === 'ask' ? ' (it asks first)' : ''}. Targets: ${t.training.volumePolicy.fillTargets === 'extend' ? 'workouts may also lengthen to reach them' : 'only spare time is used'}. Change it in Settings → Training defaults.</p>
    <div class="sheet-actions"><button type="button" class="btn btn-block" data-close>Got it</button></div></div>`, (el, close) => { el.querySelector('[data-close]').onclick = () => close(); });
}
// "Hit targets: +N min/wk": consent to lengthen workouts (up to the cap) for targets, not just minimums.
export function openHitTargetsSheet(ctx, sum) {
  ensureStyles();
  const t = sum?.targets; if (!t) return;
  const pol = resolveTargets(ctx.store.getProfile()).training.volumePolicy;
  ctx.openSheet(`<div class="tg-sheet"><h2>Hit your targets?</h2>
    <p class="muted small">Your minimums are covered. Reaching every target needs about <b>+${t.minutesToHit} min a week</b> (${t.shortSets} more sets), spread over your lift days, never past ${pol.maxMinutes}′ a workout.</p>
    <div class="tg-mins">${t.short.map(x => `<span class="badge">${esc(x.name)} <b>${Math.round(x.total * 10) / 10}/${x.target}</b></span>`).join('')}</div>
    <div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-apply>Lengthen workouts for targets</button>
    <button type="button" class="btn btn-ghost btn-block" data-cancel>Keep spare-time only</button></div></div>`, (el, close) => {
    el.querySelector('[data-cancel]').onclick = () => close();
    el.querySelector('[data-apply]').onclick = () => { close(); setTargets(ctx, { training: { volumePolicy: { fillTargets: 'extend', mode: 'extend' } } }, { reason: 'workouts lengthened to reach targets' }); };
  });
}
// Short after the cap: options to raise the cap, add a lift day, or lengthen days.
export function openVolumeRoomSheet(ctx, short = [], targetsLine = '') {
  ensureStyles();
  const opts = volumeRoomOptions(ctx.store.getProfile());
  ctx.openSheet(`<div class="tg-sheet"><h2>${short.length ? 'Make room for your minimums' : 'Reach your targets'}</h2>
    <p class="muted small">${short.length ? esc(short.map(x => `${x.name} ${Math.round(x.total * 10) / 10}/${x.min} sets: short ${x.short}`).join(' · ')) : esc(targetsLine || 'Every weekly minimum is covered.')}</p>
    <div class="list mt">${opts.map(o => `<button type="button" class="list-item" data-opt="${o.id}"><div class="grow"><div class="t">${esc(o.label)}</div></div><span class="chev">›</span></button>`).join('') || '<p class="muted small">No automatic option: add a lift day in Availability.</p>'}</div>
    <div class="sheet-actions"><button type="button" class="btn btn-ghost btn-block" data-cancel>Cancel</button></div></div>`, (el, close) => {
    el.querySelector('[data-cancel]').onclick = () => close();
    el.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
      const o = opts.find(x => x.id === b.dataset.opt); close();
      if (o) setTargets(ctx, o.patch, { replan: true, reason: o.label.toLowerCase() });
    });
  });
}
// 'ask' policy: show the proposed extensions; Apply saves the extended plan.
export function openExtendSheet(ctx, { extended = [], onApply, title = 'Lengthen workouts to hit your minimums?' } = {}) {
  ensureStyles();
  const ext = extended.filter(s => s?.plan?.extended).sort((a, b) => a.date.localeCompare(b.date));
  ctx.openSheet(`<div class="tg-sheet"><h2>${esc(title)}</h2>
    <p class="muted small">Your slot times can't fit this week's weekly set minimums. Forge proposes:</p>
    <div class="list mt">${ext.map(s => `<div class="list-item tg-diff"><div class="grow"><div class="t">${dayName(s.date)} ${esc(s.title || 'Lift')}</div>
      <div class="s"><span class="tg-from">${s.plan.extended.from}′</span> → <b>${s.plan.extended.to}′</b> · ${esc(s.plan.extended.reason)}</div></div></div>`).join('')}</div>
    <div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-apply>Apply</button>
    <button type="button" class="btn btn-ghost btn-block" data-cancel>Keep my times (show what's short)</button></div></div>`, (el, close) => {
    el.querySelector('[data-cancel]').onclick = () => close();
    el.querySelector('[data-apply]').onclick = () => { close(); try { onApply && onApply(); } catch (e) { console.error(e); } };
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
      ${item('training', '🏋️', `${t.training.daysPerWeek} days · ${Math.round(t.training.totalMinPerWeek / 60 * 10) / 10}h`, `${t.training.defaultMinutes}′ default · ${styleShort(t.training.style, p)}`)}
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
    <div class="tabs tg-seg" role="group" aria-label="Cardio style">${CARDIO_STYLES.map(v => `<button type="button" class="${v === t.cardio.style ? 'active' : ''}" data-tg-cstyle="${v}">${esc(CARDIO_STYLE_NAMES[v])}</button>`).join('')}</div>
    <p class="tiny muted" style="margin:-2px 0 10px">${esc(CARDIO_STYLE_WHY)}</p>
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
  card.querySelectorAll('[data-tg-cstyle]').forEach(b => b.onclick = () => setTargets(ctx, { cardio: { style: b.dataset.tgCstyle } }));
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
    <div class="label mt">How to spread it</div>${seg('s-cstyle', CARDIO_STYLES.map(v => [v, CARDIO_STYLE_NAMES[v]]), c.style)}
    <p class="tiny muted">${esc(CARDIO_STYLE_WHY)} No cardio block shorter than ${c.minSession}′.</p>
    ${step('s-hard', 'Hard sessions / week', c.hardSessionsPerWeek, '')}
    <div class="label mt">Preferred cardio <span class="muted tiny">(none = planner picks)</span></div>
    <div class="chips">${MOD_CHOICES.filter(m => CARDIO[m]).map(m => `<button type="button" class="chip sm ${c.modalities.includes(m) ? 'active' : ''}" data-s-mod="${m}">${esc((CARDIO[m].icon || '') + ' ' + CARDIO[m].name)}</button>`).join('')}</div>`);
  const training = sec('training', '🏋️ Training', `
    <p class="tiny muted">${t.training.daysPerWeek} days · ${t.training.totalMinPerWeek} min/week available · ~${t.training.liftMinPerWeek} lift min after cardio.</p>
    <div class="label">Default session length</div>
    <div class="chips">${[15, 20, 30, 45, 60, 75, 90].map(m => `<button type="button" class="chip sm ${t.training.defaultMinutes === m ? 'active' : ''}" data-s-min="${m}">${m}</button>`).join('')}</div>
    <div class="label mt">Default style</div><div class="chips">${t.training.styles.map(o => `<button type="button" class="chip sm ${o.id === t.training.style ? 'active' : ''}" data-s-style="${esc(o.id)}">${esc(o.short || o.name)}</button>`).join('')}</div>
    <div class="label mt">When the week's set minimums don't fit</div>${seg('s-vmode', [['extend', 'Lengthen'], ['ask', 'Ask me'], ['fixed', 'Keep times']], t.training.volumePolicy.mode)}
    ${step('s-vmax', 'Longest workout', t.training.volumePolicy.maxMinutes, '′')}
    <div class="label mt">Reach targets</div>${seg('s-vfill', [['extend', 'Lengthen workouts'], ['time', 'Spare time only'], ['ask', 'Ask me']], t.training.volumePolicy.fillTargets)}
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
      else if (d.sCstyle) set({ cardio: { style: d.sCstyle } });
      else if (d.sHard) set({ cardio: { hardSessionsPerWeek: t.cardio.hardSessionsPerWeek + Number(d.sHard) } });
      else if (d.sMod) { const m = new Set(t.cardio.modalities); m.has(d.sMod) ? m.delete(d.sMod) : m.add(d.sMod); set({ cardio: { modalities: [...m] } }); }
      else if (d.sMin) set({ training: { defaultMinutes: Number(d.sMin) } }, { replan: false });
      else if (d.sStyle) set({ training: { style: d.sStyle } });
      else if (d.sVfill) set({ training: { volumePolicy: { fillTargets: d.sVfill } } });
      else if (d.sVmode) set({ training: { volumePolicy: { mode: d.sVmode } } });
      else if (d.sVmax) set({ training: { volumePolicy: { maxMinutes: t.training.volumePolicy.maxMinutes + Number(d.sVmax) * 15 } } });
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
