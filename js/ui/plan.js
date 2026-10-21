// Plan tab (UI-PLAN): week navigator, per-day cards, day sheet actions, weekly availability,
// week summary + projection teaser.
// CONTRACT-NOTE: params.date ('YYYY-MM-DD') opens the week containing that date.
// CONTRACT-NOTE: if planner.suggestForDay returns null for a non-rest day (e.g. the engine is
//   still a stub), the day sheet falls back to generator.buildWorkout / a simple cardio block so
//   the screen keeps working. planRange has no fallback (it reports "nothing to plan").
// CONTRACT-NOTE: "Move to…" swaps two days; moved sessions become plan.auto:false. If the target
//   day was empty and the source day's schedule isn't rest, the source day gets a forced-rest
//   session so re-planning doesn't refill it.
// CONTRACT-NOTE (PLAN-FIX): quick "+10′ / +20′ cardio" on every upcoming day (card + day sheet)
//   extends the day's last cardio block, appends an easy finisher, or creates a cardio day; the day
//   becomes plan.auto:false and remembers plan.extraCardio (re-applied after a Re-suggest). The
//   coverage card has a weekly cardio-target stepper (profile.cardioTargetMin, steps of 15).
//   Re-suggest keeps the day's location/minutes (or the location picked in the sheet's Where row).
//   planRange keeps every non-auto planned session (incl. ones without a plan field), and any open
//   sheet closes on browser back (popstate) so a stale backdrop can't block taps.
import { ds, parseDs, addDays, weekStart, fmtShort, fmtDay, daysBetween } from '../util.js';
import { GROUPS, GROUP_ORDER } from '../data/muscles.js';
import { expandEquipment } from '../data/equipment.js';
import { cardioOptions, CARDIO } from '../data/cardio.js';
import { getEx } from '../data/exercises.js';
import { planRange, suggestForDay, weekPlanSummary } from '../engine/planner.js';
import { buildWorkout, swapBlock, addExercise, estimateMinutes } from '../engine/generator.js';
import { loadSchedule } from '../classes/crunch.js';
import { renderClassPicker, bindClassPicker } from './classes.js';
import { startSession, sessionGroups } from './today.js';
import { summarize, detailSheet } from './history.js';
// CONTRACT-NOTE (§24): a past day card offers "Log what I did" (retro.openRetroSheet) when it is
//   inside the retro window; already-logged lines keep opening the session detail sheet, which can
//   edit or delete them. Nothing else about past days changed.
import { openRetroSheet, canLogPast } from './retro.js';
import { setTargets, targetsSummaryHTML, bindTargetsSummary, makeRoomHTML, bindMakeRoom, extendedToast, openMinimumsInfo, openVolumeRoomSheet, openExtendSheet, openHitTargetsSheet } from './targets.js';
import { resolveTargets, volumePolicyOf, CARDIO_STYLES, CARDIO_STYLE_NAMES, starredUnits, unitTargets, maxNote, STAR_LEGEND } from '../engine/targets.js';
import { UNIT_ORDER } from '../data/muscles.js';
import { styleChipsHTML } from './styles.js';
import { resolveStyle } from '../engine/generator.js';
// CONTRACT-NOTE (STYLES): availability rows for lift / flex days have a style picker (schedule[day].style;
//   "Default" = profile.defaultStyle); day cards show a non-default style's short name.
// CONTRACT-NOTE (INTEGRATOR §18): the coverage card's cardio target reads resolveTargets and its
//   stepper calls setTargets (which re-plans upcoming auto days, debounced). Saving availability goes
//   through setTargets too (its own re-plan prompt stays). params.avail opens the availability sheet.
//   A "Your targets" strip sits under the week navigator.
// CONTRACT-NOTE (weekly minimums): Plan my week / 4 weeks toasts the extensions ("Extended Mon 45→60′ …")
//   or "All weekly minimums met ✓"; with volumePolicy 'ask' it saves the in-slot plan and offers the
//   extended one in an Apply sheet. Day cards show a "+15′" badge (tap = why); the coverage card has a
//   "Minimums" line with "Why these numbers?" and, when short, "Make room".
import {
  esc, chip, fmtNum, exName, unitLabel, safe, cardioFormHtml, bindCardioForm, readCardioForm, cardioName, intensityName,
  swapSheet, addExerciseSheet, exerciseInfoHtml,
} from './components.js';

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEK_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DOW_NAME = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KINDS = [['lift', 'Lift', '🏋️'], ['cardio', 'Cardio', '🏃'], ['class', 'Class', '🎟️'], ['flex', 'Flex', '🔀'], ['rest', 'Rest', '🌙']];
const MINUTES = [15, 20, 30, 45, 60, 75, 90];
const QUICK_CARDIO = [10, 20];
const FINISHER_PREF = ['bike', 'walk_incline', 'elliptical', 'row', 'treadmill', 'run', 'walk'];
const CARDIO_STEP = 15;
const MAX_AHEAD = 12, MAX_BACK = 52;

let weekOff = 0;          // weeks from this week
let lastDateParam = null;
let classSched = null;    // Crunch schedule (loaded lazily)
let schedLoading = null;
let busy = false;

// ---------- helpers ----------
const todayStr = () => ds();
const dowKey = date => DOW_KEYS[parseDs(date).getDay()];
const noon = date => { const d = parseDs(date); d.setHours(12, 0, 0, 0); return d; };
function weekStartFor(off) { return addDays(weekStart(new Date()), off * 7); }
function locById(profile, id) { return (profile.locations || []).find(l => l.id === id) || null; }
function daySched(profile, date) { return (profile.schedule || {})[dowKey(date)] || { kind: 'rest', minutes: 0, location: profile.currentLocation }; }
function dayLoc(profile, date, s) {
  return locById(profile, s?.location) || locById(profile, daySched(profile, date).location) || locById(profile, profile.currentLocation) || (profile.locations || [])[0] || { id: 'home', name: 'Home', icon: '🏠', equipment: ['bodyweight'] };
}
function plannedOn(sessions, date) { return sessions.filter(s => s.status === 'planned' && s.date === date); }
function mainPlanned(sessions, date) { const p = plannedOn(sessions, date); return p.find(s => s.plan?.kind !== 'rest') || p[0] || null; }
function isRestPlan(s) { return s && (s.plan?.kind === 'rest' || (!(s.blocks || []).length && s.plan)); }
function cardioMin(s) {
  return (s.blocks || []).reduce((n, b) => n + (b.kind === 'cardio' ? Number(b.minutes) || 0 : b.kind === 'class' ? Number(b.classify?.cardioMinutes) || 0 : 0), 0);
}
function kindOf(s) {
  if (!s) return null;
  if (s.plan?.kind) return s.plan.kind;
  const b = s.blocks || [];
  return b.some(x => x.kind === 'lift') ? 'lift' : b.some(x => x.kind === 'class') ? 'class' : b.length ? 'cardio' : 'rest';
}
function ensureSchedule() {
  if (classSched) return Promise.resolve(classSched);
  schedLoading = schedLoading || safe(() => loadSchedule(), Promise.resolve(null)).then(s => { classSched = s; return s; }).catch(() => null).finally(() => { schedLoading = null; });
  return schedLoading;
}
function kindLabel(k) { return (KINDS.find(x => x[0] === k) || [k, k])[1]; }
function stampAuto(s, kind, reason) {
  return { ...s, status: 'planned', startedAt: null, endedAt: null, plan: { auto: true, kind: kind || kindOf(s), generatedAt: new Date().toISOString(), reason: reason || s.plan?.reason || 'Suggested' } };
}
function stampCustom(s, kind, reason) {
  return { ...s, status: 'planned', startedAt: null, endedAt: null, plan: { auto: false, kind: kind || kindOf(s), generatedAt: new Date().toISOString(), reason: reason || 'Custom' } };
}
function toast(ctx, m) { try { ctx.toast(m); } catch (e) { /* ignore */ } }

// ---------- render ----------
export function title() { return 'Plan'; }

export function render(ctx, params = {}) {
  const store = ctx.store;
  const profile = store.getProfile();
  const sessions = safe(() => store.getSessions(), []);
  const pd = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;
  if (pd !== lastDateParam) {
    lastDateParam = pd;
    if (pd) weekOff = Math.max(-MAX_BACK, Math.min(MAX_AHEAD, Math.round(daysBetween(weekStart(new Date()), weekStart(parseDs(pd))) / 7)));
  }
  const ws = weekStartFor(weekOff);
  const t = todayStr();
  const days = Array.from({ length: 7 }, (_, i) => ds(addDays(ws, i)));
  const weekEnd = days[6];
  const canPlanWeek = weekEnd >= t;
  const lbl = weekOff === 0 ? 'This week' : weekOff === 1 ? 'Next week' : weekOff === -1 ? 'Last week' : weekOff > 0 ? `In ${weekOff} weeks` : `${-weekOff} weeks ago`;

  let h = `<div class="pl">
    <div class="page-head pl-head"><div><h1>Plan</h1><p class="sub">Suggestions for each day. Customize any of them.</p></div>
      <button type="button" class="btn btn-sm btn-ghost pl-avail-btn" data-a="avail">🗓 Availability</button></div>
    <div class="pl-nav">
      <button type="button" class="pl-arrow" data-a="prev" ${weekOff <= -MAX_BACK ? 'disabled' : ''} aria-label="Previous week">‹</button>
      <button type="button" class="pl-nav-mid" data-a="thisweek"><b>${esc(lbl)}</b><span>${esc(fmtShort(days[0]))} – ${esc(fmtShort(weekEnd))}</span></button>
      <button type="button" class="pl-arrow" data-a="next" ${weekOff >= MAX_AHEAD ? 'disabled' : ''} aria-label="Next week">›</button>
    </div>
    <div class="pl-actions ${canPlanWeek ? '' : 'one'}">
      ${canPlanWeek ? `<button type="button" class="btn btn-primary" data-a="plan-week">✦ Plan ${weekOff === 0 ? 'my week' : 'this week'}</button>` : ''}
      <button type="button" class="btn" data-a="plan-4">Plan next 4 weeks</button>
    </div>
    ${clearRowHTML(ctx, sessions, days)}
    ${safe(() => targetsSummaryHTML(ctx), '')}
    <div class="pl-days">${days.map(d => dayCard(d, sessions, profile, t)).join('')}</div>`;
  h += summaryCard(sessions, profile, ws, weekOff === 0 ? safe(() => makeRoomHTML(ctx, { cls: 'tg-warnp small' }), '') : '');
  h += `<button type="button" class="card tap pl-teaser" data-a="projection">
      <span class="pl-teaser-ic">📈</span><span class="grow"><b>See where this plan takes you →</b><small>Projected weight, body fat and measurements if you follow it</small></span></button>
    <button type="button" class="list-item pl-hist" data-a="history"><span class="ic">📅</span><span class="grow"><span class="t">Full history</span><span class="s">Every logged workout</span></span><span class="chev">›</span></button>
  </div>`;
  return h;
}

function dayCard(date, sessions, profile, t) {
  const d = parseDs(date);
  const isToday = date === t, past = date < t;
  const done = sessions.filter(s => s.date === date && (s.status === 'done' || s.status === 'active'));
  const plan = mainPlanned(sessions, date);
  const sch = daySched(profile, date);
  const dateCol = `<div class="pl-date"><span class="dw">${isToday ? 'Today' : DOW_SHORT[d.getDay()]}</span><span class="dd">${d.getDate()}</span></div>`;

  const doneLines = done.map(s => {
    const sm = safe(() => summarize(s), { sets: 0, cardioMin: 0, classes: [] });
    const bits = [sm.sets ? `${sm.sets} sets` : '', sm.cardioMin ? `${sm.cardioMin} min cardio` : '', sm.dur ? `${sm.dur} min` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="pl-line done" data-sid="${esc(s.id)}">
      <span class="pl-check ${s.status === 'active' ? 'live' : ''}">${s.status === 'active' ? '●' : '✓'}</span>
      <span class="grow"><span class="pl-title">${esc(s.title || 'Workout')}</span><span class="pl-meta">${s.status === 'active' ? 'In progress' : esc(bits || 'Done')}</span></span><span class="chev">›</span></button>`;
  }).join('');

  if (past) {
    let body = doneLines;
    if (!body) {
      const missed = plan && !isRestPlan(plan);
      body = `<div class="pl-line quiet"><span class="grow"><span class="pl-title muted">${missed ? 'Skipped' : 'Rest'}</span>${missed ? `<span class="pl-meta">Planned: ${esc(plan.title || 'Workout')}</span>` : ''}</span></div>`;
    }
    // §24: it already happened, so it can still be logged (or added to) within the retro window.
    const canLog = safe(() => canLogPast(date), false);
    if (canLog) {
      body += `<button type="button" class="pl-line open" data-retro="${date}"><span class="grow">
        <span class="pl-title">${done.length ? 'Log something else' : 'Log what I did'}</span>
        <span class="pl-meta">${done.length ? 'Another class, workout or cardio on this day' : 'A class, a workout, cardio — or leave it as rest'}</span></span><span class="pl-plus">＋</span></button>`;
    }
    return `<div class="pl-day past ${done.length ? 'has-done' : 'empty'}${canLog ? ' can-log' : ''}">${dateCol}<div class="pl-body">${body}</div></div>`;
  }

  let main;
  let cls = '';
  if (plan && !isRestPlan(plan)) {
    const loc = dayLoc(profile, date, plan);
    const groups = sessionGroups(plan).slice(0, 4);
    const cmin = cardioMin(plan);
    const k = kindOf(plan);
    const clsB = (plan.blocks || []).find(b => b.kind === 'class');
    const mins = Math.round(plan.estMinutes || plan.minutes || 0);
    main = `<button type="button" class="pl-line planned" data-day="${date}">
      <span class="grow">
        <span class="pl-top"><span class="pl-title">${esc(plan.title || 'Workout')}</span>${plan.plan?.extended ? `<span class="pl-ext" data-ext="${date}" role="button" aria-label="Why longer">+${plan.plan.extended.to - plan.plan.extended.from}′</span>` : ''}${plan.plan ? `<span class="pl-tag ${plan.plan.auto ? 'auto' : 'custom'}">${plan.plan.auto ? 'Auto' : 'Custom'}</span>` : ''}</span>
        <span class="pl-meta">${mins ? `${mins} min · ` : ''}${esc(loc.icon || '')} ${esc(loc.name)}${clsB?.time ? ` · ${esc(clsB.time)}` : ''}${k === 'lift' && plan.style && plan.style !== 'hypertrophy' ? ` · ${esc(resolveStyle(plan.styleDef || plan.style, profile).short)}` : ''}</span>
        <span class="pl-chips">${groups.map(g => `<span class="pl-mchip">${esc(g.name)}</span>`).join('')}${k === 'class' || clsB ? '<span class="badge warn">🎟️ Class</span>' : ''}${cmin && k !== 'class' ? `<span class="badge cardio">${k === 'cardio' ? '🏃 ' : '+'}${cmin} min cardio</span>` : ''}</span>
      </span><span class="chev">›</span></button>`;
    cls = `kind-${k}`;
  } else if (done.length) {
    main = '';
    cls = 'has-done';
  } else if (isRestPlan(plan) || sch.kind === 'rest') {
    main = `<button type="button" class="pl-line rest" data-day="${date}"><span class="pl-rest-ic">🌙</span><span class="grow"><span class="pl-title">Rest day</span><span class="pl-meta">${plan ? 'You chose rest' : 'Recover and grow'}</span></span></button>`;
    cls = 'rest';
  } else {
    const loc = dayLoc(profile, date, null);
    main = `<button type="button" class="pl-line open" data-day="${date}"><span class="grow"><span class="pl-title muted">Not planned yet</span>
      <span class="pl-meta">${esc(kindLabel(sch.kind))} · ${sch.minutes || '?'} min · ${esc(loc.icon || '')} ${esc(loc.name)}</span></span><span class="pl-plus">＋</span></button>`;
    cls = 'open';
  }
  const quick = `<div class="pl-quick" role="group" aria-label="Add cardio"><span class="pl-qlabel">🏃 Cardio</span>${QUICK_CARDIO.map(m => `<button type="button" class="pl-qc" data-qc="${m}" data-date="${date}" aria-label="Add ${m} minutes of cardio">+${m}′</button>`).join('')}</div>`;
  return `<div class="pl-day ${isToday ? 'today' : ''} ${cls}">${dateCol}<div class="pl-body">${doneLines}${main}${quick}</div></div>`;
}

// ---------- quick cardio ----------
function firstFinisher(loc) {
  const opts = safe(() => cardioOptions(expandEquipment(loc.equipment || [])), []);
  return FINISHER_PREF.find(m => opts.some(o => o.id === m)) || (opts[0] && opts[0].id) || 'walk';
}
// Add `mins` of cardio to a session (pure): extend the last cardio block or append an easy one.
export function withExtraCardio(s, mins, loc) {
  const out = JSON.parse(JSON.stringify(s));
  out.blocks = out.blocks || [];
  const last = [...out.blocks].reverse().find(b => b.kind === 'cardio');
  if (last) last.minutes = (Number(last.minutes) || 0) + mins;
  else out.blocks.push({ kind: 'cardio', modality: firstFinisher(loc), minutes: mins, intensity: 'easy', distance: null, calories: null, done: false, note: 'Easy Zone 2' });
  out.minutes = (Number(out.minutes) || 0) + mins;
  if (out.estMinutes != null) out.estMinutes = Math.round(Number(out.estMinutes) || 0) + mins;
  const onlyCardio = out.blocks.every(b => b.kind === 'cardio');
  if (onlyCardio && out.blocks.length === 1) { const b = out.blocks[0]; out.title = `${CARDIO[b.modality]?.name || 'Cardio'} · ${b.minutes} min`; }
  return out;
}
function addCardio(ctx, date, mins) {
  const store = ctx.store;
  const profile = store.getProfile();
  const plan = mainPlanned(store.getSessions(), date);
  const loc = dayLoc(profile, date, plan);
  let out;
  if (plan && !isRestPlan(plan)) {
    out = withExtraCardio(plan, mins, loc);
    out.plan = { ...(plan.plan || {}), auto: false, kind: kindOf(plan), generatedAt: new Date().toISOString(), reason: plan.plan?.reason || 'Custom', extraCardio: (Number(plan.plan?.extraCardio) || 0) + mins };
  } else {
    out = stampCustom(cardioSession(store.newSessionId(), date, loc, { modality: firstFinisher(loc), minutes: mins, intensity: 'easy' }, 'Easy Zone 2 cardio'), 'cardio');
    out.plan.extraCardio = mins;
  }
  putDay(store, date, out);
  const sum = safe(() => weekPlanSummary(store.getSessions(), { weekStart: weekStart(parseDs(date)), profile, now: new Date() }), null);
  const cm = sum?.cardioMinutes;
  toast(ctx, `+${mins} min cardio on ${fmtDay(date).split(',')[0]}${cm ? ` · week ${Math.round((cm.done || 0) + (cm.planned || 0))}/${cm.target} min` : ''}`);
  return out;
}

function summaryCard(sessions, profile, ws, roomLine = '') {
  const sum = safe(() => weekPlanSummary(sessions, { weekStart: ws, profile, now: new Date() }), null);
  const units = sum && sum.units && typeof sum.units === 'object' ? sum.units : {};
  const ids = UNIT_ORDER.filter(u => units[u] && (units[u].min > 0 || units[u].target > 0));
  const head = `<div class="section-title">Week coverage <button type="button" class="link" data-a="history">History ›</button></div>`;
  if (!ids.length) {
    return `${head}<div class="card pl-sum"><div class="empty" style="padding:18px 10px"><p>Plan your week to see how it covers your muscle and cardio targets.</p></div></div>`;
  }
  // One row per enforcement unit (weekly-volume audit): bar = done + planned, solid tick = minimum
  // (evidence floor), dashed tick = your target. Tracked-only muscles go in a muted line.
  const stars = safe(() => starredUnits(profile), new Set());
  const U = safe(() => unitTargets(profile), {});
  const rows = ids.map(u => {
    const x = units[u];
    const done = Number(x.done) || 0, planned = Number(x.planned) || 0, total = Number(x.total) || 0;
    const scale = Math.max(x.max, total, 1);
    const st = x.status || 'ok';   // under (red) · toward (amber) · ok (green) · over (orange), vs target
    return `<div class="pl-bar-row ${st}${x.sub ? ' pl-sub' : ''}" title="${esc(`${x.name}: ${fmtNum(total, 1)} sets · min ${x.min} · target ${x.target} · max ${x.max}`)}">
      <div class="pl-bar-top"><span>${stars.has(u) ? '<span class="star">★</span> ' : ''}${esc(x.name)}</span>
        <span class="num"><b>${fmtNum(total, 0)}</b><span class="muted"> / ${fmtNum(x.target, 0)} target</span></span></div>
      <div class="pl-track"><i class="d" style="width:${(done / scale) * 100}%"></i><i class="p" style="left:${(done / scale) * 100}%;width:${(planned / scale) * 100}%"></i>
        ${x.min > 0 ? `<span class="tick" style="left:${(x.min / scale) * 100}%"></span>` : ''}<span class="tick tgt" style="left:${(x.target / scale) * 100}%"></span><span class="tick max" style="left:${(x.max / scale) * 100 - 0.5}%"></span></div>
      ${(() => { const n = U[u] && maxNote(u, U[u]); return n && n.atMax ? `<details class="pl-maxd"><summary class="tiny muted">Target at the max of ${x.max}${n.capped ? ` (your settings ask ${fmtNum(n.asked, 1)})` : ''} · why ⓘ</summary><div class="tiny muted">${esc(n.text)}</div></details>` : ''; })()}
    </div>`;
  }).join('');
  const tracked = UNIT_ORDER.filter(u => units[u] && !(units[u].min > 0 || units[u].target > 0)).map(u => `${units[u].name} ${fmtNum(units[u].total, 0)}`).join(' · ');
  const tgt = resolveTargets(profile).cardio.minPerWeek;
  const cm = sum.cardioMinutes && typeof sum.cardioMinutes === 'object' ? sum.cardioMinutes : { done: Number(sum.cardioMinutes) || 0, planned: 0, target: tgt };
  const ctarget = Number.isFinite(Number(cm.target)) ? Number(cm.target) : tgt;
  const cscale = Math.max(ctarget, (cm.done || 0) + (cm.planned || 0), 1);
  const score = Math.round(Number(sum.score));
  const sc = isNaN(score) ? null : score;
  const scol = sc == null ? 'var(--muted)' : sc >= 80 ? 'var(--good)' : sc >= 55 ? 'var(--warn)' : 'var(--bad)';
  const C = 2 * Math.PI * 24;
  const ring = sc == null ? '' : `<div class="ring pl-ring"><svg viewBox="0 0 56 56" width="56" height="56"><circle cx="28" cy="28" r="24" fill="none" stroke="var(--card2)" stroke-width="6"/>
    <circle cx="28" cy="28" r="24" fill="none" stroke="${scol}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * Math.max(0, Math.min(100, sc)) / 100).toFixed(1)} ${C.toFixed(1)}"/></svg><span class="rv">${sc}</span></div>`;
  const ss = sum.sessions || {};
  const warnings = (sum.warnings || []).slice(0, 8);
  const ls = sum.liftSets || {}, cap = sum.capacity || {};
  const lsTot = (Number(ls.done) || 0) + (Number(ls.planned) || 0);
  const capLine = cap.setsNeeded ? `${fmtNum(lsTot, 0)} working sets${cap.liftMinutes ? ` in ~${cap.liftMinutes} lift min` : ''} · priority minimums want ~${fmtNum(cap.setsNeeded, 0)}` : '';
  return `${head}<div class="card pl-sum">
    <div class="pl-sum-head">${ring}<div class="grow"><div class="card-title">${sc == null ? 'This week' : sc >= 80 ? 'Well covered' : sc >= 55 ? 'Mostly covered' : 'Gaps to fill'}</div>
      <div class="muted small">${Number(ss.done) || 0} done · ${Number(ss.planned) || 0} planned${sc != null ? ' · coverage score' : ''}</div></div></div>
    <div class="pl-legend"><span><i class="d"></i>Done</span><span><i class="p"></i>Planned</span><span><i class="t tgt"></i>Target</span><span><i class="t"></i>Min</span><span class="muted">bar end = max</span></div>
    <div class="tiny muted" style="margin:-2px 0 6px">${esc(STAR_LEGEND)}</div>
    <div class="pl-bars">${rows}</div>
    ${tracked ? `<div class="tiny muted" style="margin-top:6px">Tracked, not counted: ${esc(tracked)}</div>` : ''}
    <div class="pl-bar-row cardio">
      <div class="pl-bar-top"><span>🏃 Cardio</span><span class="num"><b>${fmtNum((cm.done || 0) + (cm.planned || 0), 0)}</b><span class="muted">/${ctarget} min</span></span></div>
      <div class="pl-track"><i class="d" style="width:${((cm.done || 0) / cscale) * 100}%"></i><i class="p" style="left:${((cm.done || 0) / cscale) * 100}%;width:${((cm.planned || 0) / cscale) * 100}%"></i><span class="tick" style="left:${(ctarget / cscale) * 100}%"></span></div>
    </div>
    <div class="pl-ctarget"><span class="muted small">Weekly cardio target</span>
      <span class="pl-step" role="group" aria-label="Weekly cardio target"><button type="button" data-a="ct-dec" aria-label="Lower cardio target" ${ctarget <= 0 ? 'disabled' : ''}>−</button><b>${ctarget}′</b><button type="button" data-a="ct-inc" aria-label="Raise cardio target" ${ctarget >= 900 ? 'disabled' : ''}>+</button></span></div>
    ${cardioStyleSeg(profile)}
    ${roomLine}
    ${minsLine(sum, profile)}
    ${capLine ? `<div class="pl-cap muted small">${esc(capLine)}</div>` : ''}
    ${warnings.length ? `<details class="pl-notes"><summary>Notes <span class="pl-notes-n">${warnings.length}</span></summary><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

function cardioStyleSeg(profile) {
  const st = resolveTargets(profile).cardio.style;
  return `<div class="pl-cstyle"><span class="muted small">Cardio as</span><div class="tabs tg-seg">${CARDIO_STYLES.map(v => `<button type="button" class="${v === st ? 'active' : ''}" data-a="cstyle" data-v="${v}">${esc(CARDIO_STYLE_NAMES[v])}</button>`).join('')}</div></div>`;
}
function minsLine(sum, profile) {
  const m = sum.minimums;
  if (!m) return '';
  const ext = (sum.extended || []).reduce((n, x) => n + (x.to - x.from), 0);
  const t = sum.targets, pp = sum.pushPull;
  const pol = volumePolicyOf(profile || {});
  const tShort = t && t.met < t.total;
  const hit = tShort && pol.fillTargets !== 'extend' && t.minutesToHit > 0;            // 'time' / 'ask': offer to lengthen
  const room = tShort && pol.fillTargets === 'extend';                                 // already lengthening: offer cap / day / Time-saver
  return `<div class="pl-mins"><span>Minimums</span>${m.met ? '<span class="ok">✓</span>' : `<span class="bad">✗ ${m.short.length} short</span><span class="muted small">${esc(m.short.slice(0, 3).map(x => `${x.name} ${fmtNum(x.total, 0)}/${fmtNum(x.min, 0)}`).join(', '))}</span>`}
    ${pp ? `<span class="muted small">· push:pull ${pp.push}:${pp.pull}</span>` : ''}${ext ? `<span class="muted small">· +${ext}′ added</span>` : ''}</div>
    ${t ? `<div class="pl-mins"><span class="${tShort ? 'bad' : 'ok'}">${esc(t.line || `Targets ${t.met}/${t.total}`)}</span></div>` : ''}
    <div class="pl-mins">${hit ? `<button type="button" data-a="hit-targets">Hit targets: +${t.minutesToHit} min/wk</button>` : ''}${room ? '<button type="button" data-a="vol-room">Reach targets: options</button>' : ''}<button type="button" data-a="why-min">Why these numbers?</button>${m.met || room ? '' : '<button type="button" data-a="vol-room">Make room</button>'}</div>`;
}

// ---------- day sheet ----------
function rx(b, units) {
  const ex = getEx(b.exId); const t = b.target || {};
  const reps = t.repMin && t.repMax && t.repMin !== t.repMax ? `${t.repMin}–${t.repMax}` : (t.reps || t.repMin || '?');
  const w = t.weight != null && ex?.unit !== 'seconds' ? ` @ ${fmtNum(t.weight)} ${unitLabel(ex, units)}` : '';
  return `${t.sets || (b.sets || []).length || '?'} × ${reps}${ex?.unit === 'seconds' ? 's' : ''}${w}`;
}
function blocksHtml(s, units, { edit = false } = {}) {
  const blocks = s.blocks || [];
  if (!blocks.length) return '';
  let n = 0;
  return `<div class="list pl-blocks">${blocks.map((b, i) => {
    if (b.kind === 'lift') {
      // Tap the name for what the exercise is (cues, why, video); edit buttons change just this exercise.
      const name = `<button type="button" class="grow pl-exname" data-exinfo="${esc(b.exId)}"><span class="t">${esc(exName(b.exId))} <span class="pl-i">ⓘ</span></span><span class="s">${esc(rx(b, units))}</span></button>`;
      const btns = edit ? `<span class="pl-exbtns"><button type="button" data-exsets="${i}" data-d="-1" aria-label="One less set">−</button><button type="button" data-exsets="${i}" data-d="1" aria-label="One more set">+</button><button type="button" data-exswap="${i}" aria-label="Swap exercise">⇄</button><button type="button" data-exrm="${i}" aria-label="Remove exercise">✕</button></span>` : '';
      return `<div class="list-item pl-exrow"><span class="pl-bi">${b.group ? esc(b.group) : ++n}</span>${name}${btns}</div>`;
    }
    if (b.kind === 'cardio') return `<div class="list-item"><span class="ic">${esc(CARDIO[b.modality]?.icon || '🏃')}</span><span class="grow"><span class="t">${esc(CARDIO[b.modality]?.name || b.modality || 'Cardio')}</span><span class="s">${b.minutes || '?'} min · ${esc(intensityName(b.intensity))}</span></span></div>`;
    if (b.kind === 'class') return `<div class="list-item"><span class="ic">🎟️</span><span class="grow"><span class="t">${esc(b.name)}</span><span class="s">${[b.time, b.duration ? b.duration + ' min' : '', b.instructor, b.classify?.label].filter(Boolean).map(esc).join(' · ')}</span></span></div>`;
    return '';
  }).join('')}</div>`;
}

function openDay(ctx, date) {
  const store = ctx.store;
  const profile = store.getProfile();
  const sessions = store.getSessions();
  const t = todayStr();
  const plan = mainPlanned(sessions, date);
  const rest = isRestPlan(plan);
  const sch = daySched(profile, date);
  const loc = dayLoc(profile, date, plan);
  const has = plan && !rest;
  const groups = has ? sessionGroups(plan).slice(0, 6) : [];
  const cmin = has ? cardioMin(plan) : 0;
  const rationale = has ? [plan.plan?.reason, ...(plan.rationale || [])].filter((x, i, a) => x && a.indexOf(x) === i && x !== 'Custom').slice(0, 5) : [];
  const actions = [
    date === t && has ? ['start', '▶', 'Start now', 'primary'] : null,
    [has ? 'resuggest' : 'suggest', '✦', has ? 'Re-suggest' : 'Suggest a workout'],
    ['custom', '🛠', has ? 'Customize' : 'Build my own'],
    loc.hasClasses || (profile.locations || []).some(l => l.hasClasses) ? ['class', '🎟️', 'Pick a class'] : null,
    ['cardio', '🏃', 'Make it cardio'],
    rest && sch.kind === 'rest' && !plan ? null : rest ? null : ['rest', '🌙', 'Rest day'],
    has ? ['move', '⇄', 'Move to…'] : null,
    plan ? ['delete', '✕', rest ? 'Clear rest day' : 'Delete', 'danger'] : null,
  ].filter(Boolean);

  const html = `<div class="pl-sheet">
    <div class="tiny muted bold pl-kicker">${esc(fmtDay(date))}${date === t ? ' · Today' : ''}</div>
    <h2>${has ? esc(plan.title || 'Workout') : rest || sch.kind === 'rest' ? 'Rest day' : 'Nothing planned'}</h2>
    <div class="row wrap pl-sheet-meta">
      ${has ? `<span class="badge">${esc(loc.icon || '')} ${esc(loc.name)}</span><span class="badge">⏱ ${Math.round(plan.estMinutes || plan.minutes || 0) || '?'} min</span>` : `<span class="badge">Schedule: ${esc(kindLabel(sch.kind))}${sch.kind !== 'rest' ? ` · ${sch.minutes || '?'} min · ${esc(loc.icon || '')} ${esc(loc.name)}` : ''}</span>`}
      ${has && plan.plan ? `<span class="pl-tag ${plan.plan.auto ? 'auto' : 'custom'}">${plan.plan.auto ? 'Auto' : 'Custom'}</span>` : ''}
      ${cmin ? `<span class="badge cardio">${cmin} min cardio</span>` : ''}
    </div>
    ${groups.length ? `<div class="pl-chips mt">${groups.map(g => `<span class="pl-mchip">${esc(g.name)} <b>${fmtNum(g.sets, 0)}</b></span>`).join('')}</div>` : ''}
    ${rationale.length ? `<ul class="pl-why">${rationale.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${has ? blocksHtml(plan, profile.units, { edit: date >= t }) + (date >= t ? `<button type="button" class="btn btn-sm btn-ghost btn-block pl-exadd" data-exadd>+ Add exercise</button><p class="tiny muted center">Tap a name for form cues &amp; video · ⇄ swap just that exercise</p>` : '') : rest || sch.kind === 'rest' ? '<p class="muted small mt">Rest days let muscles rebuild. You can still plan something below.</p>' : '<p class="muted small mt">Get a suggestion that fits your recovery and weekly targets, or build your own.</p>'}
    ${date >= t ? `<div class="pl-where"><div class="tiny muted bold">Where${has ? ' · tap to re-suggest there' : ''}</div>
      <div class="pl-where-row">${(profile.locations || []).map(l => chip(`${l.icon || ''} ${l.name}`, { active: l.id === loc.id, attrs: `data-sloc="${esc(l.id)}"`, cls: 'sm' })).join('')}</div></div>
    <div class="pl-sheet-quick"><span class="tiny muted bold">Cardio</span>${QUICK_CARDIO.map(m => `<button type="button" class="pl-qc" data-act="qc" data-m="${m}">+${m}′</button>`).join('')}${cmin ? `<span class="muted small">${cmin} min now</span>` : ''}</div>` : ''}
    <div class="pl-acts">${actions.map(([id, ic, label, kind]) => `<button type="button" class="pl-act ${kind || ''}" data-act="${id}"><span>${ic}</span>${esc(label)}</button>`).join('')}</div>
  </div>`;
  ctx.openSheet(html, (el, close) => {
    el.querySelector('.pl-blocks')?.addEventListener('click', e => blockEdit(ctx, date, plan, loc, e));
    el.querySelector('[data-exadd]')?.addEventListener('click', () => {
      const lifts = (plan.blocks || []).filter(b => b.kind === 'lift').map(b => b.exId);
      addExerciseSheet(ctx, { equipment: loc.equipment || [], targets: plan.targets || [], sculptGoals: profile.sculptGoals || [], exclude: lifts,
        onPick: id => { const s2 = safe(() => addExercise(plan, id, editCtx(ctx, date)), null); if (s2) saveEdited(ctx, date, s2, `Added ${exName(id)}`); else openDay(ctx, date); } });
    });
    el.querySelector('.pl-acts').onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      dayAction(ctx, date, b.dataset.act, { plan, close, el, btn: b });
    };
    el.querySelector('.pl-sheet-quick')?.addEventListener('click', e => {
      const b = e.target.closest('[data-act="qc"]'); if (!b) return;
      addCardio(ctx, date, Number(b.dataset.m)); openDay(ctx, date);
    });
    el.querySelector('.pl-where-row')?.addEventListener('click', async e => {
      const b = e.target.closest('[data-sloc]'); if (!b || b.disabled) return;
      if (b.classList.contains('active') && has) return;
      el.querySelectorAll('[data-sloc]').forEach(x => { x.disabled = true; x.classList.toggle('active', x === b); });
      const s = await suggestDay(ctx, date, { location: b.dataset.sloc });
      if (!s) { toast(ctx, 'No suggestion for that location. Try Build my own.'); openDay(ctx, date); return; }
      putDay(ctx.store, date, s);
      toast(ctx, `${fmtDay(date).split(',')[0]} at ${locById(ctx.store.getProfile(), b.dataset.sloc)?.name || b.dataset.sloc}: ${s.title || 'Workout'}`);
      openDay(ctx, date);
    });
  });
}

function otherSessions(sessions, date) { return sessions.filter(s => !(s.status === 'planned' && s.date === date)); }

// Slot for a (re-)suggestion: the schedule's kind, but the day's current location/minutes win
// (they may have been customized), and an explicit location pick wins over both.
export function suggestSlot(profile, date, plan, location = null) {
  const sch = daySched(profile, date);
  const has = plan && !isRestPlan(plan);
  let kind = sch.kind === 'rest' ? 'lift' : sch.kind;
  const locId = location || (has && plan.location) || sch.location || profile.currentLocation || 'home';
  const extra = has ? Number(plan.plan?.extraCardio) || 0 : 0;
  let minutes = (has && Number(plan.minutes) - extra) || Number(sch.minutes) || profile.defaultMinutes || 45;
  if (has && plan.plan?.kind === 'class') minutes = Number(plan.plan?.slot?.minutes) || Number(sch.minutes) || minutes;
  const l = locById(profile, locId);
  if (kind === 'class' && l && !l.hasClasses) kind = 'flex';
  return { kind, minutes: Math.max(10, minutes), location: locId };
}

async function suggestDay(ctx, date, { location = null } = {}) {
  const store = ctx.store;
  const profile = store.getProfile();
  const all = store.getSessions();
  const prev = mainPlanned(all, date);
  const sessions = otherSessions(all, date);
  const classSchedule = await ensureSchedule();
  const slot = suggestSlot(profile, date, prev, location);
  let s = safe(() => suggestForDay(date, { profile, sessions, schedule: profile.schedule, classSchedule, now: new Date(), seed: Math.floor(Math.random() * 1e9), slot }), null);
  if (!s) s = fallbackSuggest(date, profile, sessions, slot);
  if (!s) return null;
  if (!s.id) s.id = store.newSessionId();
  s.date = date;
  const extra = Number(prev?.plan?.extraCardio) || 0;
  if (extra > 0) {
    // the user asked for more cardio on this day: keep it (and keep the day theirs)
    const out = withExtraCardio(s, extra, locById(profile, slot.location) || dayLoc(profile, date, null));
    return { ...stampCustom(out, s.plan?.kind, s.plan?.reason), plan: { ...(s.plan || {}), auto: false, kind: s.plan?.kind || kindOf(s), generatedAt: new Date().toISOString(), extraCardio: extra } };
  }
  return { ...stampAuto(s, s.plan?.kind, s.plan?.reason), plan: { ...(s.plan || {}), auto: true, kind: s.plan?.kind || kindOf(s), generatedAt: new Date().toISOString(), reason: s.plan?.reason || 'Suggested' } };
}

function fallbackSuggest(date, profile, sessions, slot = null) {
  const sch = slot || daySched(profile, date);
  const loc = (slot && locById(profile, slot.location)) || dayLoc(profile, date, null);
  const minutes = Number(sch.minutes) || profile.defaultMinutes || 45;
  if (sch.kind === 'cardio') return cardioSession(null, date, loc, { modality: firstCardio(loc), minutes, intensity: 'easy' }, 'Easy Zone 2 cardio');
  const s = safe(() => buildWorkout({ targets: [], minutes, location: loc, profile, sessions: sessions.filter(x => x.status === 'done'), now: noon(date), seed: Math.floor(Math.random() * 1e9), exclude: profile.avoidExercises || [] }), null);
  if (!s || !Array.isArray(s.blocks)) return null;
  s.location = s.location || loc.id; s.minutes = s.minutes || minutes;
  s.plan = { kind: 'lift', reason: 'Suggested from your recovery and weekly targets' };
  return s;
}
function firstCardio(loc) {
  const opts = safe(() => cardioOptions(expandEquipment(loc.equipment || [])), []);
  return (opts[0] && opts[0].id) || 'run';
}
function cardioSession(id, date, loc, blk, reason) {
  const b = { kind: 'cardio', distance: null, calories: null, done: false, note: null, ...blk };
  return {
    id, date, status: 'planned', startedAt: null, endedAt: null, location: loc.id, minutes: b.minutes,
    title: `${CARDIO[b.modality]?.name || 'Cardio'} · ${b.minutes} min`, targets: [], source: 'cardio', blocks: [b],
    rationale: reason ? [reason] : [], notes: '', plan: { kind: 'cardio', reason },
  };
}

function putDay(store, date, s) { store.replacePlanned(date, date, s ? [s] : [], () => true); }

async function dayAction(ctx, date, act, { plan, close, btn }) {
  const store = ctx.store;
  const profile = store.getProfile();
  switch (act) {
    case 'start': close(); if (plan) startSession(ctx, plan); break;
    case 'suggest': case 'resuggest': {
      btn.disabled = true; btn.lastChild.textContent = 'Thinking…';
      const s = await suggestDay(ctx, date);
      if (!s) { toast(ctx, 'No suggestion for this day. Try Build my own.'); btn.disabled = false; return; }
      putDay(store, date, s);
      toast(ctx, `${fmtDay(date)}: ${s.title || 'Workout'}`);
      openDay(ctx, date);
      break;
    }
    case 'custom': close(); ctx.nav('today', { date }); break;
    case 'class': classSheet(ctx, date, plan); break;
    case 'cardio': cardioSheet(ctx, date, plan); break;
    case 'rest': {
      const sch = daySched(profile, date);
      putDay(store, date, sch.kind === 'rest' ? null : { id: store.newSessionId(), date, status: 'planned', startedAt: null, endedAt: null, location: sch.location || profile.currentLocation, minutes: 0, title: 'Rest day', targets: [], source: 'manual', blocks: [], rationale: [], notes: '', plan: { auto: false, kind: 'rest', generatedAt: new Date().toISOString(), reason: 'Rest day' } });
      close(); toast(ctx, `${fmtDay(date)} is a rest day`);
      break;
    }
    case 'move': moveSheet(ctx, date, plan); break;
    case 'delete': {
      if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.lastChild.textContent = 'Tap again to delete'; return; }
      putDay(store, date, null); close(); toast(ctx, 'Removed from plan');
      break;
    }
  }
}

function classSheet(ctx, date, plan) {
  const store = ctx.store;
  const profile = store.getProfile();
  const minutes = plan?.minutes || daySched(profile, date).minutes || 45;
  // Wrap ctx so the picker's session becomes a custom planned session for this day.
  const wstore = Object.create(store);
  wstore.saveSession = s => {
    const out = stampCustom({ ...s }, 'class', s.blocks?.[0]?.name ? `Class: ${s.blocks[0].name}` : 'Picked a class');
    putDay(store, out.date, out);
    return out;
  };
  wstore.setActiveSessionId = () => {};
  const wctx = { ...ctx, store: wstore, toast: m => toast(ctx, String(m).replace(/^Started:/, 'Planned:')), nav: () => { ctx.closeSheet(); } };
  ctx.openSheet('<div data-classes></div>', el => {
    const host = el.querySelector('[data-classes]') || el;
    host.innerHTML = safe(() => renderClassPicker(wctx, { date, minutes, targets: plan?.targets || [] }), '<div class="empty muted">Class schedule unavailable.</div>');
    safe(() => bindClassPicker(host, wctx), null);
  });
}

function cardioSheet(ctx, date, plan) {
  const store = ctx.store;
  const profile = store.getProfile();
  const loc = dayLoc(profile, date, plan);
  let opts = safe(() => cardioOptions(expandEquipment(loc.equipment || [])), []);
  if (!opts.length) opts = Object.values(CARDIO);
  const sch = daySched(profile, date);
  const last = store.kv('lastCardio') || {};
  const html = `<div class="pl-sheet"><div class="tiny muted bold pl-kicker">${esc(fmtDay(date))}</div><h2>Make it cardio</h2>
    <div class="muted small">${esc(loc.icon || '')} ${esc(loc.name)}</div>
    ${cardioFormHtml({ options: opts, modality: last.modality, minutes: Number(sch.minutes) || last.minutes || 30, intensity: 'easy', calories: false })}
    <button type="button" class="btn btn-primary btn-block mt2" data-save>Save to plan</button></div>`;
  ctx.openSheet(html, (el, close) => {
    bindCardioForm(el);
    el.querySelector('[data-save]').onclick = () => {
      const blk = readCardioForm(el, profile.bodyweight);
      if (!blk.modality || !blk.minutes) { toast(ctx, 'Pick a type and minutes'); return; }
      const s = stampCustom(cardioSession(store.newSessionId(), date, loc, blk, `${intensityName(blk.intensity)} ${CARDIO[blk.modality]?.name || 'cardio'}`), 'cardio');
      putDay(store, date, s);
      close(); toast(ctx, `${fmtDay(date)}: ${s.title}`);
    };
  });
}

function moveSheet(ctx, date, plan) {
  const store = ctx.store;
  const sessions = store.getSessions();
  const profile = store.getProfile();
  const t = todayStr();
  const ws = weekStart(parseDs(date));
  const days = Array.from({ length: 7 }, (_, i) => ds(addDays(ws, i))).filter(d => d !== date && d >= t);
  const html = `<div class="pl-sheet"><div class="tiny muted bold pl-kicker">Move ${esc(plan?.title || 'workout')}</div><h2>Swap with which day?</h2>
    <div class="list mt">${days.map(d => {
      const p = mainPlanned(sessions, d); const r = isRestPlan(p) || (!p && daySched(profile, d).kind === 'rest');
      return `<button type="button" class="list-item" data-to="${d}"><span class="ic">${p && !isRestPlan(p) ? '🏋️' : r ? '🌙' : '·'}</span><span class="grow"><span class="t">${esc(fmtDay(d))}${d === t ? ' · Today' : ''}</span>
        <span class="s">${p && !isRestPlan(p) ? esc(p.title || 'Workout') : r ? 'Rest day' : 'Not planned'}</span></span><span class="chev">⇄</span></button>`;
    }).join('') || '<div class="list-item muted">No other days left this week.</div>'}</div></div>`;
  ctx.openSheet(html, (el, close) => {
    el.querySelectorAll('[data-to]').forEach(b => b.onclick = () => {
      const to = b.dataset.to;
      const all = store.getSessions();
      const a = plannedOn(all, date), z = plannedOn(all, to);
      const moved = [...a.map(s => ({ ...stampCustom(s, kindOf(s), s.plan?.reason || 'Moved'), date: to })), ...z.map(s => ({ ...stampCustom(s, kindOf(s), s.plan?.reason || 'Moved'), date }))];
      if (!z.length && daySched(profile, date).kind !== 'rest') {
        moved.push({ id: store.newSessionId(), date, status: 'planned', startedAt: null, endedAt: null, location: profile.currentLocation, minutes: 0, title: 'Rest day', targets: [], source: 'manual', blocks: [], rationale: [], notes: '', plan: { auto: false, kind: 'rest', generatedAt: new Date().toISOString(), reason: 'Rest day (moved)' } });
      }
      const from = date < to ? date : to, until = date < to ? to : date;
      store.replacePlanned(from, until, moved, s => s.date === date || s.date === to);
      close(); toast(ctx, `Moved to ${fmtDay(to)}`);
    });
  });
}

// ---------- planning ----------
async function runPlan(ctx, from, to, label) {
  if (busy) return;
  busy = true;
  toast(ctx, `Planning ${label}…`);
  try {
    const store = ctx.store;
    const profile = store.getProfile();
    const classSchedule = await ensureSchedule();
    await new Promise(r => setTimeout(r, 30));
    const days = daysBetween(from, to) + 1;
    // Anything the user touched (or saved without a plan tag) is kept and planned around.
    const pol = volumePolicyOf(profile);
    const run = vp => {
      const res = safe(() => planRange({ from, days, profile, sessions: store.getSessions(), schedule: profile.schedule, classSchedule, now: new Date(), keep: x => !(x.plan && x.plan.auto), volumePolicy: vp }), []);
      // keep the planner's plan fields (extended, topUp, …) and just stamp it auto
      return (Array.isArray(res) ? res : []).filter(s => s && s.date >= from && s.date <= to)
        .map(s => { const st = stampAuto({ ...s, id: s.id || store.newSessionId() }, s.plan?.kind, s.plan?.reason); st.plan = { ...(s.plan || {}), ...st.plan }; return st; });
    };
    const list = run(pol.mode === 'ask' ? { mode: 'fixed' } : null);
    store.replacePlanned(from, to, list);
    const wk = safe(() => weekPlanSummary(store.getSessions(), { weekStart: parseDs(from), profile, now: new Date() }), null);
    const shortN = wk?.minimums?.short?.length || 0;
    const ext = extendedToast(list);
    if (!list.length) toast(ctx, 'Nothing new to plan (custom and rest days are kept)');
    else if (ext) toast(ctx, ext);
    else toast(ctx, shortN ? `Planned ${list.length} session${list.length === 1 ? '' : 's'} · ${shortN} weekly minimum${shortN === 1 ? '' : 's'} short (see Week coverage)` : `Planned ${list.length} session${list.length === 1 ? '' : 's'} · All weekly minimums met ✓`);
    if (pol.mode === 'ask' && shortN) {
      const longer = run({ mode: 'extend' });
      if (longer.some(s => s.plan?.extended)) openExtendSheet(ctx, { extended: longer, onApply: () => { store.replacePlanned(from, to, longer); toast(ctx, extendedToast(longer) || 'Plan updated'); } });
    } else if (pol.fillTargets === 'ask' && wk?.targets && wk.targets.met < wk.targets.total) {
      // Reach targets: ask me → show the lengthened plan as a proposal
      const longer = run({ mode: 'extend', fillTargets: 'extend' });
      if (longer.some(s => s.plan?.extended)) openExtendSheet(ctx, { extended: longer, title: 'Lengthen workouts to reach your targets?', onApply: () => { store.replacePlanned(from, to, longer); toast(ctx, extendedToast(longer) || 'Plan updated'); } });
    }
  } finally { busy = false; }
}

// ---------- availability ----------
function availHtml(sched, profile) {
  return `<div class="pl-sheet pl-avail"><h2>Weekly availability</h2>
    <p class="muted small">What a normal week looks like. The planner fills each day to match. <b>Flex</b> lets it choose lift, cardio or a class.</p>
    ${WEEK_KEYS.map(k => {
      const d = sched[k] || { kind: 'rest', minutes: 0, location: 'home' };
      return `<div class="pl-av-day ${d.kind === 'rest' ? 'is-rest' : ''}" data-k="${k}">
        <div class="pl-av-name">${DOW_NAME[k]}</div>
        <div class="pl-seg">${KINDS.map(([id, n, ic]) => `<button type="button" class="${d.kind === id ? 'active' : ''}" data-kind="${id}"><span>${ic}</span>${n}</button>`).join('')}</div>
        ${d.kind === 'rest' ? '' : `<div class="pl-av-row scroll">${MINUTES.map(m => chip(`${m}′`, { active: Number(d.minutes) === m, attrs: `data-min="${m}"`, cls: 'sm' })).join('')}</div>
        <div class="pl-av-row scroll">${(profile.locations || []).map(l => chip(`${l.icon || ''} ${l.name}`, { active: d.location === l.id, attrs: `data-loc="${esc(l.id)}"`, cls: 'sm' })).join('')}</div>
        ${d.kind === 'lift' || d.kind === 'flex' ? `<div class="pl-av-style"><span class="tiny muted">Style</span>${styleChipsHTML(profile, d.style || '', { attr: 'data-dstyle', withDefault: true })}</div>` : ''}`}
      </div>`;
    }).join('')}
    <div class="pl-av-total muted small" data-total></div>
    <button type="button" class="btn btn-primary btn-block mt" data-save>Save availability</button></div>`;
}
function availTotals(sched) {
  const ds_ = WEEK_KEYS.map(k => sched[k] || {});
  const train = ds_.filter(d => d.kind !== 'rest');
  const mins = train.reduce((n, d) => n + (Number(d.minutes) || 0), 0);
  return `${train.length} training days · ${Math.floor(mins / 60)}h ${mins % 60}m per week`;
}
function openAvailability(ctx) {
  const profile = ctx.store.getProfile();
  const sched = JSON.parse(JSON.stringify(profile.schedule || {}));
  ctx.openSheet(availHtml(sched, profile), (el, close) => {
    const paint = () => { const y = el.scrollTop; el.innerHTML = availHtml(sched, profile); el.querySelector('[data-total]').textContent = availTotals(sched); el.scrollTop = y; };
    el.querySelector('[data-total]').textContent = availTotals(sched);
    el.onclick = e => {
      const day = e.target.closest('[data-k]');
      if (e.target.closest('[data-save]')) {
        setTargets(ctx, { training: { schedule: sched } }, { replan: false, quiet: true });
        el.innerHTML = `<div class="pl-sheet center"><div class="pl-big-ic">✅</div><h2>Availability saved</h2>
          <p class="muted small mt">Re-plan so upcoming auto-planned days match it? Custom days stay as they are.</p>
          <div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-replan="week">Re-plan this week</button>
          <button type="button" class="btn btn-block" data-replan="4">Re-plan next 4 weeks</button>
          <button type="button" class="btn btn-ghost btn-block" data-replan="no">Not now</button></div></div>`;
        el.onclick = ev => {
          const r = ev.target.closest('[data-replan]'); if (!r) return;
          close();
          const t = todayStr();
          if (r.dataset.replan === 'week') runPlan(ctx, t, ds(addDays(weekStart(new Date()), 6)), 'this week');
          else if (r.dataset.replan === '4') runPlan(ctx, t, ds(addDays(weekStart(new Date()), 27)), 'the next 4 weeks');
        };
        return;
      }
      if (!day) return;
      const d = sched[day.dataset.k] = { kind: 'rest', minutes: 0, location: profile.currentLocation, ...(sched[day.dataset.k] || {}) };
      const kb = e.target.closest('[data-kind]'), mb = e.target.closest('[data-min]'), lb = e.target.closest('[data-loc]'), sb = e.target.closest('[data-dstyle]');
      if (kb) { d.kind = kb.dataset.kind; if (d.kind !== 'rest' && !Number(d.minutes)) d.minutes = profile.defaultMinutes || 45; if (d.kind === 'rest') d.minutes = 0; if (d.kind === 'class' && !locById(profile, d.location)?.hasClasses) { const c = (profile.locations || []).find(l => l.hasClasses); if (c) d.location = c.id; } }
      else if (mb) d.minutes = Number(mb.dataset.min);
      else if (lb) d.location = lb.dataset.loc;
      else if (sb) d.style = sb.dataset.dstyle || null;   // '' = default style
      else return;
      paint();
    };
  });
}

// ---------- bind ----------
let popBound = false;
export function bind(root, ctx) {
  ensureSchedule();
  if (!popBound && typeof window !== 'undefined') {
    // Browser/iOS back while a sheet is open: close it, so its backdrop can't swallow taps.
    popBound = true;
    window.addEventListener('popstate', () => { try { ctx.closeSheet(); } catch (e) { /* ignore */ } });
  }
  const pl = root.querySelector('.pl'); if (!pl) return;
  safe(() => { bindTargetsSummary(root, ctx); bindMakeRoom(root.querySelector('.pl-sum') || root, ctx); return true; }, null);
  if (ctx.params && ctx.params.avail) { ctx.nav('plan', {}, { replace: true }); setTimeout(() => openAvailability(ctx), 0); }
  pl.onclick = e => {
    const ex = e.target.closest('[data-ext]');
    if (ex) {
      const s = mainPlanned(ctx.store.getSessions(), ex.dataset.ext); const x = s?.plan?.extended;
      if (x) ctx.openSheet(`<div class="pl-sheet"><h2>Why ${x.to} minutes?</h2><p class="small mt">Your slot was ${x.from}′. Forge added ${x.to - x.from}′ so this week reaches its weekly set targets: <b>${esc(x.reason.replace(/^weekly (set targets|minimums): /, ''))}</b> sets.</p>
        <p class="tiny muted mt">Change this in Settings → Training defaults (lengthen / ask / keep times, longest workout).</p>
        <div class="sheet-actions"><button type="button" class="btn btn-block" data-why>Why these numbers?</button><button type="button" class="btn btn-ghost btn-block" data-ok>OK</button></div></div>`, (el, close) => {
        el.querySelector('[data-ok]').onclick = () => close();
        el.querySelector('[data-why]').onclick = () => { close(); setTimeout(() => openMinimumsInfo(ctx), 50); };
      });
      return;
    }
    const qc = e.target.closest('[data-qc]');
    if (qc) { addCardio(ctx, qc.dataset.date, Number(qc.dataset.qc)); return; }
    const sid = e.target.closest('[data-sid]');
    if (sid) {
      const s = ctx.store.getSession(sid.dataset.sid);
      if (s && s.status === 'active') ctx.nav('session', { id: s.id }); else safe(() => detailSheet(ctx, sid.dataset.sid), null);
      return;
    }
    const retro = e.target.closest('[data-retro]');     // §24: past day → log what happened
    if (retro) { openRetroSheet(ctx, retro.dataset.retro); return; }
    const day = e.target.closest('[data-day]');
    if (day) { openDay(ctx, day.dataset.day); return; }
    const a = e.target.closest('[data-a]'); if (!a || a.disabled) return;
    const t = todayStr();
    const ws = weekStartFor(weekOff);
    switch (a.dataset.a) {
      case 'prev': weekOff = Math.max(-MAX_BACK, weekOff - 1); ctx.rerender(); break;
      case 'next': weekOff = Math.min(MAX_AHEAD, weekOff + 1); ctx.rerender(); break;
      case 'thisweek': if (weekOff) { weekOff = 0; ctx.rerender(); } break;
      case 'plan-week': {
        const from = ds(ws) < t ? t : ds(ws), to = ds(addDays(ws, 6));
        if (to >= from) runPlan(ctx, from, to, weekOff === 0 ? 'your week' : 'that week');
        break;
      }
      case 'plan-4': runPlan(ctx, t, ds(addDays(weekStart(new Date()), 27)), 'the next 4 weeks'); break;
      case 'avail': openAvailability(ctx); break;
      case 'ct-inc': case 'ct-dec': {
        const cur = resolveTargets(ctx.store.getProfile()).cardio.minPerWeek;
        setTargets(ctx, { cardio: { minPerWeek: cur + (a.dataset.a === 'ct-inc' ? CARDIO_STEP : -CARDIO_STEP) } });
        break;
      }
      case 'why-min': openMinimumsInfo(ctx); break;
      case 'cstyle': setTargets(ctx, { cardio: { style: a.dataset.v } }); break;
      case 'hit-targets': {
        const sum = safe(() => weekPlanSummary(ctx.store.getSessions(), { weekStart: ws, profile: ctx.store.getProfile(), now: new Date() }), null);
        openHitTargetsSheet(ctx, sum); break;
      }
      case 'vol-room': {
        const sum = safe(() => weekPlanSummary(ctx.store.getSessions(), { weekStart: ws, profile: ctx.store.getProfile(), now: new Date() }), null);
        openVolumeRoomSheet(ctx, sum?.minimums?.short || [], sum?.targets?.line || ''); break;
      }
      case 'projection': ctx.nav('projection'); break;
      case 'history': ctx.nav('history'); break;
      case 'clear-week': openClearWeek(ctx, Array.from({ length: 7 }, (_, i) => ds(addDays(ws, i)))); break;
      case 'undo-clear': undoClear(ctx); break;
    }
  };
}

// ---------------------------------------------------------------- clear a week
// Removes the week's planned sessions (and, only if explicitly ticked, its completed workouts). An active
// workout is never removed. The removed sessions are kept for 15 minutes so the clear can be undone.
const UNDO_KEY = 'planUndo', UNDO_MS = 15 * 60 * 1000;
function weekSessions(sessions, days) {
  const inWeek = s => s.date >= days[0] && s.date <= days[6];
  return { planned: sessions.filter(s => inWeek(s) && s.status === 'planned'), done: sessions.filter(s => inWeek(s) && s.status === 'done') };
}
function pendingUndo(store, days) {
  const u = safe(() => store.kv(UNDO_KEY), null);
  return u && u.week === days[0] && Date.now() - u.at < UNDO_MS && (u.sessions || []).length ? u : null;
}
function clearRowHTML(ctx, sessions, days) {
  const u = pendingUndo(ctx.store, days);
  if (u) return `<div class="pl-clear"><span class="muted small">Cleared ${u.sessions.length} workout${u.sessions.length === 1 ? '' : 's'} from this week.</span><button type="button" class="btn btn-sm btn-ghost" data-a="undo-clear">↶ Undo</button></div>`;
  const { planned, done } = weekSessions(sessions, days);
  if (!planned.length && !done.length) return '';
  return `<div class="pl-clear"><button type="button" class="btn btn-sm btn-ghost pl-clear-btn" data-a="clear-week">🗑 Clear this week…</button></div>`;
}
function openClearWeek(ctx, days) {
  const store = ctx.store;
  const { planned, done } = weekSessions(store.getSessions(), days);
  const custom = planned.filter(s => s.plan && s.plan.auto === false).length;
  const html = `<div class="sheet-body pl-clear-sheet">
    <h2>Clear ${esc(fmtShort(days[0]))} – ${esc(fmtShort(days[6]))}?</h2>
    <p class="muted">${planned.length ? `Removes <b>${planned.length}</b> planned workout${planned.length === 1 ? '' : 's'}${custom ? ` (including ${custom} you customized)` : ''}. You can re-plan the week afterwards.` : 'There are no planned workouts left this week.'}</p>
    ${done.length ? `<label class="pl-clear-done"><input type="checkbox" data-cl="done" ${planned.length ? '' : 'checked'}><span>Also delete <b>${done.length}</b> completed workout${done.length === 1 ? '' : 's'} (removes ${done.length === 1 ? 'it' : 'them'} from History, progress and recovery tracking)</span></label>` : ''}
    <p class="tiny muted">You can undo this for 15 minutes.</p>
    <div class="row gap"><button type="button" class="btn btn-ghost grow" data-cl="cancel">Cancel</button><button type="button" class="btn grow pl-danger" data-cl="go">Clear</button></div>
  </div>`;
  ctx.openSheet(html, (el, close) => {
    el.querySelector('[data-cl="cancel"]').onclick = close;
    el.querySelector('[data-cl="go"]').onclick = () => {
      const alsoDone = !!el.querySelector('[data-cl="done"]')?.checked;
      const removed = [...planned, ...(alsoDone ? done : [])];
      if (!removed.length) { close(); return; }
      store.kv(UNDO_KEY, { at: Date.now(), week: days[0], sessions: removed });
      if (planned.length) store.replacePlanned(days[0], days[6], [], () => true);
      if (alsoDone) done.forEach(s => store.deleteSession(s.id));
      close();
      toast(ctx, `Cleared ${removed.length} workout${removed.length === 1 ? '' : 's'}. Undo is on the Plan screen for 15 min.`);
      ctx.rerender();
    };
  });
}
function undoClear(ctx) {
  const store = ctx.store;
  const u = safe(() => store.kv(UNDO_KEY), null);
  if (!u || !(u.sessions || []).length) return;
  u.sessions.forEach(s => store.saveSession(s));
  store.kv(UNDO_KEY, null);
  toast(ctx, `Restored ${u.sessions.length} workout${u.sessions.length === 1 ? '' : 's'}`);
  ctx.rerender();
}

// ---------------------------------------------------------------- per-exercise edits in a planned day
// Change one exercise (swap / remove / sets ±) or add one, without regenerating the day. Edited days become
// custom (plan.auto = false) so re-planning keeps them.
function editCtx(ctx, date) {
  const now = parseDs(date); now.setHours(12, 0, 0, 0);
  return { sessions: otherSessions(ctx.store.getSessions(), date), now };
}
function saveEdited(ctx, date, s, msg) {
  const est = safe(() => estimateMinutes(s.blocks || []), null);
  const out = { ...s, estMinutes: est ?? s.estMinutes, minutes: Math.max(Number(s.minutes) || 0, est || 0) || s.minutes,
    plan: { ...(s.plan || {}), auto: false, edited: true, reason: s.plan?.reason && s.plan.reason !== 'Custom' ? s.plan.reason : 'Edited' } };
  putDay(ctx.store, date, out);
  toast(ctx, msg);
  openDay(ctx, date);
}
function showExInfo(ctx, date, exId) {
  const ex = getEx(exId);
  ctx.openSheet(`${exerciseInfoHtml(ex)}<button type="button" class="btn btn-ghost btn-block mt" data-back>‹ Back to ${esc(fmtDay(date).split(',')[0])}</button>`, (el, close) => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-back]')) { openDay(ctx, date); return; }
      const lb = e.target.closest('[data-info-lib]'); if (lb) { close(); ctx.nav('exercise', { id: lb.dataset.infoLib }); }
    });
  });
}
function blockEdit(ctx, date, plan, loc, e) {
  const info = e.target.closest('[data-exinfo]');
  if (info) { showExInfo(ctx, date, info.dataset.exinfo); return; }
  const blocks = plan.blocks || [];
  const sw = e.target.closest('[data-exswap]');
  if (sw) {
    const i = Number(sw.dataset.exswap), b = blocks[i]; if (!b) return;
    const others = blocks.filter((x, j) => j !== i && x.kind === 'lift').map(x => x.exId);
    swapSheet(ctx, { exId: b.exId, equipment: loc.equipment || [], exclude: others,
      onPick: id => { const s2 = safe(() => swapBlock(plan, i, id, editCtx(ctx, date)), null); if (s2) saveEdited(ctx, date, s2, `Swapped in ${exName(id)}`); else openDay(ctx, date); } });
    return;
  }
  const rm = e.target.closest('[data-exrm]');
  if (rm) {
    const i = Number(rm.dataset.exrm), b = blocks[i]; if (!b) return;
    const next = blocks.filter((x, j) => j !== i);
    // A superset letter left with one member is no longer a superset.
    const counts = {}; next.forEach(x => { if (x.group) counts[x.group] = (counts[x.group] || 0) + 1; });
    const cleaned = next.map(x => (x.group && counts[x.group] < 2 ? { ...x, group: null } : x));
    saveEdited(ctx, date, { ...plan, blocks: cleaned }, `Removed ${exName(b.exId)}`);
    return;
  }
  const st = e.target.closest('[data-exsets]');
  if (st) {
    const i = Number(st.dataset.exsets), b = blocks[i]; if (!b || b.kind !== 'lift') return;
    const n = Math.max(1, Math.min(8, (Number(b.target?.sets) || (b.sets || []).length || 3) + Number(st.dataset.d)));
    const sets = Array.from({ length: n }, (_, k) => (b.sets || [])[k] || { w: null, r: null, done: false });
    const nb = { ...b, target: { ...(b.target || {}), sets: n }, sets };
    saveEdited(ctx, date, { ...plan, blocks: blocks.map((x, j) => (j === i ? nb : x)) }, `${exName(b.exId)}: ${n} sets`);
  }
}
