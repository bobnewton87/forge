// Plan tab (UI-PLAN): week navigator, per-day cards, day sheet actions, weekly availability,
// week summary + projection teaser.
// CONTRACT-NOTE: params.date ('YYYY-MM-DD') opens the week containing that date.
// CONTRACT-NOTE: if planner.suggestForDay returns null for a non-rest day (e.g. the engine is
//   still a stub), the day sheet falls back to generator.buildWorkout / a simple cardio block so
//   the screen keeps working. planRange has no fallback (it reports "nothing to plan").
// CONTRACT-NOTE: "Move to…" swaps two days; moved sessions become plan.auto:false. If the target
//   day was empty and the source day's schedule isn't rest, the source day gets a forced-rest
//   session so re-planning doesn't refill it.
import { ds, parseDs, addDays, weekStart, fmtShort, fmtDay, daysBetween } from '../util.js';
import { GROUPS, GROUP_ORDER } from '../data/muscles.js';
import { expandEquipment } from '../data/equipment.js';
import { cardioOptions, CARDIO } from '../data/cardio.js';
import { getEx } from '../data/exercises.js';
import { planRange, suggestForDay, weekPlanSummary } from '../engine/planner.js';
import { buildWorkout } from '../engine/generator.js';
import { loadSchedule } from '../classes/crunch.js';
import { renderClassPicker, bindClassPicker } from './classes.js';
import { startSession, sessionGroups } from './today.js';
import { summarize, detailSheet } from './history.js';
import {
  esc, chip, fmtNum, exName, unitLabel, safe, cardioFormHtml, bindCardioForm, readCardioForm, cardioName, intensityName,
} from './components.js';

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEK_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DOW_NAME = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KINDS = [['lift', 'Lift', '🏋️'], ['cardio', 'Cardio', '🏃'], ['class', 'Class', '🎟️'], ['flex', 'Flex', '🔀'], ['rest', 'Rest', '🌙']];
const MINUTES = [15, 20, 30, 45, 60, 75, 90];
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
    <div class="pl-days">${days.map(d => dayCard(d, sessions, profile, t)).join('')}</div>`;
  h += summaryCard(sessions, profile, ws);
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
    return `<div class="pl-day past ${done.length ? 'has-done' : 'empty'}">${dateCol}<div class="pl-body">${body}</div></div>`;
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
        <span class="pl-top"><span class="pl-title">${esc(plan.title || 'Workout')}</span>${plan.plan ? `<span class="pl-tag ${plan.plan.auto ? 'auto' : 'custom'}">${plan.plan.auto ? 'Auto' : 'Custom'}</span>` : ''}</span>
        <span class="pl-meta">${mins ? `${mins} min · ` : ''}${esc(loc.icon || '')} ${esc(loc.name)}${clsB?.time ? ` · ${esc(clsB.time)}` : ''}</span>
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
  return `<div class="pl-day ${isToday ? 'today' : ''} ${cls}">${dateCol}<div class="pl-body">${doneLines}${main}</div></div>`;
}

function summaryCard(sessions, profile, ws) {
  const sum = safe(() => weekPlanSummary(sessions, { weekStart: ws, profile, now: new Date() }), null);
  const groups = sum && sum.groups && typeof sum.groups === 'object' ? sum.groups : {};
  const ids = Object.keys(groups).filter(g => GROUPS[g]);
  const head = `<div class="section-title">Week coverage <button type="button" class="link" data-a="history">History ›</button></div>`;
  if (!ids.length) {
    return `${head}<div class="card pl-sum"><div class="empty" style="padding:18px 10px"><p>Plan your week to see how it covers your muscle and cardio targets.</p></div></div>`;
  }
  const prio = g => (GROUPS[g]?.priority || 1) * ((profile.groupPriority || {})[g] || 1);
  ids.sort((a, b) => prio(b) - prio(a) || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  const rows = ids.map(g => {
    const x = groups[g] || {};
    const done = Number(x.done) || 0, planned = Number(x.planned) || 0;
    const total = Number(x.total ?? done + planned) || 0;
    const tmin = Number(x.target?.min) || 0, tmax = Number(x.target?.max) || tmin || 1;
    const scale = Math.max(tmax, total, 1);
    const st = x.status || (total < tmin ? 'under' : total > tmax ? 'over' : 'ok');
    return `<div class="pl-bar-row ${st}">
      <div class="pl-bar-top"><span>${prio(g) > 1 ? '<span class="star">★</span> ' : ''}${esc(GROUPS[g].name)}</span>
        <span class="num"><b>${fmtNum(total, 0)}</b><span class="muted">/${Math.round(tmin)}${tmax > tmin ? '–' + Math.round(tmax) : ''}</span></span></div>
      <div class="pl-track"><i class="d" style="width:${(done / scale) * 100}%"></i><i class="p" style="left:${(done / scale) * 100}%;width:${(planned / scale) * 100}%"></i>
        <span class="tick" style="left:${(tmin / scale) * 100}%"></span></div>
    </div>`;
  }).join('');
  const cm = sum.cardioMinutes && typeof sum.cardioMinutes === 'object' ? sum.cardioMinutes : { done: Number(sum.cardioMinutes) || 0, planned: 0, target: profile.cardioTargetMin || 120 };
  const ctarget = Number(cm.target) || profile.cardioTargetMin || 120;
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
    <div class="pl-legend"><span><i class="d"></i>Done</span><span><i class="p"></i>Planned</span><span><i class="t"></i>Weekly min</span></div>
    <div class="pl-bars">${rows}</div>
    <div class="pl-bar-row cardio">
      <div class="pl-bar-top"><span>🏃 Cardio</span><span class="num"><b>${fmtNum((cm.done || 0) + (cm.planned || 0), 0)}</b><span class="muted">/${ctarget} min</span></span></div>
      <div class="pl-track"><i class="d" style="width:${((cm.done || 0) / cscale) * 100}%"></i><i class="p" style="left:${((cm.done || 0) / cscale) * 100}%;width:${((cm.planned || 0) / cscale) * 100}%"></i><span class="tick" style="left:${(ctarget / cscale) * 100}%"></span></div>
    </div>
    ${capLine ? `<div class="pl-cap muted small">${esc(capLine)}</div>` : ''}
    ${warnings.length ? `<details class="pl-notes"><summary>Notes <span class="pl-notes-n">${warnings.length}</span></summary><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

// ---------- day sheet ----------
function rx(b, units) {
  const ex = getEx(b.exId); const t = b.target || {};
  const reps = t.repMin && t.repMax && t.repMin !== t.repMax ? `${t.repMin}–${t.repMax}` : (t.reps || t.repMin || '?');
  const w = t.weight != null && ex?.unit !== 'seconds' ? ` @ ${fmtNum(t.weight)} ${unitLabel(ex, units)}` : '';
  return `${t.sets || (b.sets || []).length || '?'} × ${reps}${ex?.unit === 'seconds' ? 's' : ''}${w}`;
}
function blocksHtml(s, units) {
  const blocks = s.blocks || [];
  if (!blocks.length) return '';
  let n = 0;
  return `<div class="list pl-blocks">${blocks.map(b => {
    if (b.kind === 'lift') return `<div class="list-item"><span class="pl-bi">${b.group ? esc(b.group) : ++n}</span><span class="grow"><span class="t">${esc(exName(b.exId))}</span><span class="s">${esc(rx(b, units))}</span></span></div>`;
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
    ${has ? blocksHtml(plan, profile.units) : rest || sch.kind === 'rest' ? '<p class="muted small mt">Rest days let muscles rebuild. You can still plan something below.</p>' : '<p class="muted small mt">Get a suggestion that fits your recovery and weekly targets, or build your own.</p>'}
    <div class="pl-acts">${actions.map(([id, ic, label, kind]) => `<button type="button" class="pl-act ${kind || ''}" data-act="${id}"><span>${ic}</span>${esc(label)}</button>`).join('')}</div>
  </div>`;
  ctx.openSheet(html, (el, close) => {
    el.querySelector('.pl-acts').onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      dayAction(ctx, date, b.dataset.act, { plan, close, el, btn: b });
    };
  });
}

function otherSessions(sessions, date) { return sessions.filter(s => !(s.status === 'planned' && s.date === date)); }

async function suggestDay(ctx, date) {
  const store = ctx.store;
  const profile = store.getProfile();
  const sessions = otherSessions(store.getSessions(), date);
  const classSchedule = await ensureSchedule();
  const sch = daySched(profile, date);
  // On a scheduled rest day the user is explicitly asking for a workout: override the slot.
  const slot = sch.kind === 'rest' ? { kind: 'lift', minutes: profile.defaultMinutes || 45, location: sch.location || profile.currentLocation } : undefined;
  let s = safe(() => suggestForDay(date, { profile, sessions, schedule: profile.schedule, classSchedule, now: new Date(), seed: Math.floor(Math.random() * 1e9), slot }), null);
  if (!s) s = fallbackSuggest(date, profile, sessions);
  if (!s) return null;
  if (!s.id) s.id = store.newSessionId();
  s.date = date;
  return stampAuto(s, s.plan?.kind, s.plan?.reason);
}

function fallbackSuggest(date, profile, sessions) {
  const sch = daySched(profile, date);
  const loc = dayLoc(profile, date, null);
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
    const res = safe(() => planRange({ from, days, profile, sessions: store.getSessions(), schedule: profile.schedule, classSchedule, now: new Date() }), []);
    const list = (Array.isArray(res) ? res : []).filter(s => s && s.date >= from && s.date <= to)
      .map(s => stampAuto({ ...s, id: s.id || store.newSessionId() }, s.plan?.kind, s.plan?.reason));
    store.replacePlanned(from, to, list);
    toast(ctx, list.length ? `Planned ${list.length} session${list.length === 1 ? '' : 's'}` : 'Nothing new to plan (custom and rest days are kept)');
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
        <div class="pl-av-row scroll">${(profile.locations || []).map(l => chip(`${l.icon || ''} ${l.name}`, { active: d.location === l.id, attrs: `data-loc="${esc(l.id)}"`, cls: 'sm' })).join('')}</div>`}
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
        ctx.store.updateProfile({ schedule: sched });
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
      const kb = e.target.closest('[data-kind]'), mb = e.target.closest('[data-min]'), lb = e.target.closest('[data-loc]');
      if (kb) { d.kind = kb.dataset.kind; if (d.kind !== 'rest' && !Number(d.minutes)) d.minutes = profile.defaultMinutes || 45; if (d.kind === 'rest') d.minutes = 0; if (d.kind === 'class' && !locById(profile, d.location)?.hasClasses) { const c = (profile.locations || []).find(l => l.hasClasses); if (c) d.location = c.id; } }
      else if (mb) d.minutes = Number(mb.dataset.min);
      else if (lb) d.location = lb.dataset.loc;
      else return;
      paint();
    };
  });
}

// ---------- bind ----------
export function bind(root, ctx) {
  ensureSchedule();
  const pl = root.querySelector('.pl'); if (!pl) return;
  pl.onclick = e => {
    const sid = e.target.closest('[data-sid]');
    if (sid) {
      const s = ctx.store.getSession(sid.dataset.sid);
      if (s && s.status === 'active') ctx.nav('session', { id: s.id }); else safe(() => detailSheet(ctx, sid.dataset.sid), null);
      return;
    }
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
      case 'projection': ctx.nav('projection'); break;
      case 'history': ctx.nav('history'); break;
    }
  };
}
