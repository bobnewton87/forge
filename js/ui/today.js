// Today tab (UI-TRAIN): recommendations → builder → preview → start. Goal: a workout in ≤3 taps.
// CONTRACT-NOTE: recommend() is passed the location OBJECT (same as buildWorkout).
// CONTRACT-NOTE: UI state in store.kv: 'builder' {minutes, style, targets, cardio} and
//   'draft' {session, params} (the previewed, not-yet-started workout).
// CONTRACT-NOTE: "Save for later" stores the session with status 'planned'; Today lists planned
//   sessions so they can be started later.
// CONTRACT-NOTE: "Log something I already did" creates an 'active' session with source 'manual'
//   and startedAt null; session.js shows a date field instead of the elapsed timer for it.
import { ds, fmtDay, fmtShort } from '../util.js';
import { GROUPS, GROUP_ORDER, PRESETS } from '../data/muscles.js';
import { SCULPT_GOALS } from '../data/sculpt.js';
import { expandEquipment } from '../data/equipment.js';
import { cardioOptions, CARDIO, INTENSITIES } from '../data/cardio.js';
import { getEx } from '../data/exercises.js';
import { recommend, groupStatus, weekSummary, cardioStatus, streak } from '../engine/recovery.js';
import { buildWorkout, estimateMinutes, swapBlock, addExercise } from '../engine/generator.js';
import { renderClassPicker, bindClassPicker } from './classes.js';
import {
  esc, chip, readinessColor, fmtNum, exName, targetName, unitLabel, safe, openSheet, closeSheet, toast,
  addExerciseSheet, swapSheet, cardioFormHtml, bindCardioForm, readCardioForm, cardioName, intensityName, exerciseInfoHtml,
} from './components.js';

const TIMES = [15, 20, 30, 45, 60, 75, 90];
const STYLES = [['hypertrophy', 'Hypertrophy'], ['pump', 'Pump'], ['strength', 'Strength'], ['circuit', 'Circuit']];
const STYLE_HINT = { hypertrophy: '8-12 reps, 60-120 s rest', pump: 'Supersets, short rests', strength: 'Heavier, 5-8 reps, longer rests', circuit: 'Circuit, minimal rest' };
const PRESET_CHIPS = ['push', 'pull', 'legs', 'upper', 'arms', 'full', 'v_taper'];
const FINISHER_MIN = [5, 10, 15, 20];

let lastParams = null;
let showBuilderOverride = false;  // params.targets arrived → show builder even if a draft exists
let customTime = false;

// ---------- state ----------
function builderState(ctx, profile) {
  const b = ctx.store.kv('builder') || {};
  return {
    minutes: Number(b.minutes) || profile.defaultMinutes || 45,
    style: b.style || profile.defaultStyle || 'hypertrophy',
    targets: Array.isArray(b.targets) ? b.targets.filter(t => GROUPS[t] || SCULPT_GOALS[t] || PRESETS[t]) : [],
    cardio: { on: false, modality: null, minutes: 10, intensity: 'moderate', ...(b.cardio || {}) },
  };
}
let B = null;  // in-memory builder state; persisted on change
function saveB(ctx) { ctx.store.kv('builder', B); }

function currentLoc(ctx, profile) {
  const fromCtx = safe(() => ctx.location && ctx.location(), null);
  const locs = profile.locations || [];
  return locs.find(l => l.id === profile.currentLocation) || fromCtx || locs[0] || { id: 'home', name: 'Home', icon: '🏠', equipment: ['bodyweight'] };
}
function allEquipment(profile) { return [...new Set((profile.locations || []).flatMap(l => l.equipment || []))]; }

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function daysAgo(d) {
  if (d == null) return 'Not yet';
  if (d === 0) return 'Today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

// ---------- render ----------
export function render(ctx, params = {}) {
  const store = ctx.store;
  const profile = store.getProfile();
  const sessions = store.getSessions();
  if (!B) B = builderState(ctx, profile);
  const pkey = JSON.stringify(params?.targets || null);
  if (pkey !== lastParams) {
    lastParams = pkey;
    if (Array.isArray(params?.targets) && params.targets.length) {
      B.targets = [...new Set(params.targets)];
      showBuilderOverride = true;
    }
  }
  const loc = currentLoc(ctx, profile);
  const active = store.getActiveSession();
  const draft = store.kv('draft');
  const showPreview = draft?.session && !showBuilderOverride;

  let h = `<div class="tr-today">${header(profile, sessions, showPreview)}`;
  if (active && active.status === 'active') h += resumeCard(active);
  if (showPreview) h += preview(draft, profile);
  else {
    h += recsSection(sessions, profile, loc);
    h += builderSection(sessions, profile, loc);
    h += othersSection(loc);
    h += plannedSection(sessions);
  }
  return h + '</div>';
}

function header(profile, sessions, compact = false) {
  const now = new Date();
  if (compact) return `<header class="tr-hello"><div class="tr-date">${esc(fmtDay(now))}</div></header>`;
  const wk = safe(() => weekSummary(sessions, { now }), null);
  const cs = safe(() => cardioStatus(sessions, { now, profile }), null);
  const st = safe(() => streak(sessions, { now }), null);
  const stats = [];
  if (wk) stats.push(`<div><b>${wk.sessions ?? 0}</b><span>workouts</span></div>`, `<div><b>${fmtNum(wk.liftSets ?? 0, 0)}</b><span>sets</span></div>`);
  if (cs) stats.push(`<div><b>${fmtNum(cs.minutes7d ?? wk?.cardioMinutes ?? 0, 0)}<small>/${cs.target ?? profile.cardioTargetMin}</small></b><span>cardio min</span></div>`);
  if (st && st.days) stats.push(`<div><b>${st.days}🔥</b><span>streak</span></div>`);
  return `<header class="tr-hello">
    <div class="tr-date">${esc(fmtDay(now))}</div>
    <h1>${greeting()}, ${esc(profile.name || 'Bob')}</h1>
    ${stats.length ? `<div class="tr-stats">${stats.join('')}</div><div class="tr-stats-sub muted">Last 7 days${cs?.suggestion ? ' · ' + esc(cs.suggestion) : ''}</div>` : ''}
  </header>`;
}

function resumeCard(s) {
  const lifts = (s.blocks || []).filter(b => b.kind === 'lift');
  const total = lifts.reduce((n, b) => n + (b.sets || []).length, 0);
  const done = lifts.reduce((n, b) => n + (b.sets || []).filter(x => x.done).length, 0);
  const pct = total ? Math.round(done / total * 100) : 0;
  return `<button type="button" class="tr-resume" data-t="resume">
    <div class="tr-resume-top"><span class="tr-pulse"></span>Workout in progress</div>
    <div class="tr-resume-title">${esc(s.title || 'Workout')}</div>
    <div class="tr-resume-bar"><div style="width:${pct}%"></div></div>
    <div class="tr-resume-foot"><span>${done}/${total} sets</span><span class="tr-resume-go">Resume →</span></div>
  </button>`;
}

function recsSection(sessions, profile, loc) {
  const recs = safe(() => recommend(sessions, { now: new Date(), profile, minutes: B.minutes, location: loc }), []).slice(0, 3);
  if (!recs.length) return '';
  return `<section class="tr-sec">
    <div class="section-title">What should I train?</div>
    <div class="tr-recs">${recs.map((r, i) => `<button type="button" class="tr-rec ${i === 0 && !r.recovering ? 'top' : ''} ${r.recovering ? 'recovering' : ''}" data-t="rec" data-i="${i}">
      <div class="tr-rec-head"><span class="tr-rec-label">${esc(r.label || targetName(r.targetId))}</span>${r.recovering ? '<span class="badge warn">Recovering</span>' : i === 0 ? '<span class="badge tr-best">Best pick</span>' : ''}</div>
      <ul class="tr-rec-reasons">${(r.reasons || []).slice(0, 3).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="tr-rec-go">${B.minutes} min · ${esc(loc.icon || '')} ${esc(loc.name)} <span>Build →</span></div>
    </button>`).join('')}</div>
  </section>`;
}

function builderSection(sessions, profile, loc) {
  const gs = safe(() => groupStatus(sessions, { now: new Date(), profile }), {});
  const sculpt = [...new Set([...(profile.sculptGoals || []), ...B.targets])].filter(id => SCULPT_GOALS[id]);
  const isCustom = customTime || !TIMES.includes(B.minutes);
  const eq = safe(() => expandEquipment(loc.equipment || []), new Set(['bodyweight']));
  const copts = safe(() => cardioOptions(eq), []);
  const c = B.cardio;
  if (c.on && copts.length && !copts.find(o => o.id === c.modality)) c.modality = copts[0].id;
  const groupsSel = B.targets.filter(t => GROUPS[t]);
  const presetActive = id => { const g = PRESETS[id]?.groups || []; return g.length === groupsSel.length && g.every(x => groupsSel.includes(x)); };

  const tiles = GROUP_ORDER.filter(g => GROUPS[g]).map(g => {
    const st = gs[g] || {};
    const col = readinessColor(st.readiness ?? 1, st.need ?? 0);
    const on = B.targets.includes(g);
    const tgt = st.target?.min ?? GROUPS[g].weeklySets?.min;
    return `<button type="button" class="tr-tile ${on ? 'on' : ''}" style="--rc:${col}" data-t="group" data-id="${g}" aria-pressed="${on}">
      <span class="tr-tile-dot"></span>
      <span class="tr-tile-name">${esc(GROUPS[g].name)}</span>
      <span class="tr-tile-sub">${daysAgo(st.daysSince)} · ${fmtNum(st.sets7d ?? 0, 0)}/${tgt != null ? Math.round(tgt) : '?'}</span>
    </button>`;
  }).join('');

  return `<section class="tr-sec card tr-builder">
    <div class="section-title">Build my own</div>
    <div class="tr-label">Time</div>
    <div class="tr-chiprow scroll">${TIMES.map(m => chip(`${m}`, { active: !isCustom && B.minutes === m, attrs: `data-t="time" data-m="${m}"` })).join('')}
      ${chip(isCustom ? `${B.minutes} min` : 'Custom', { active: isCustom, attrs: 'data-t="custom"' })}</div>
    ${isCustom ? `<div class="tr-inline tr-custom"><input type="number" inputmode="numeric" min="5" max="180" value="${B.minutes}" data-f="minutes"> <span class="muted">minutes total</span></div>` : ''}
    <div class="tr-label">Where</div>
    <div class="tr-chiprow scroll">${(profile.locations || []).map(l => chip(`${l.icon || ''} ${l.name}`, { active: l.id === loc.id, attrs: `data-t="loc" data-id="${esc(l.id)}"` })).join('')}</div>
    <div class="tr-label tr-label-row"><span>Muscles <span class="muted">${B.targets.length ? '' : '· none = auto pick'}</span></span>${B.targets.length ? '<button type="button" class="tr-link" data-t="clear">Clear</button>' : ''}</div>
    <div class="tr-chiprow scroll">${PRESET_CHIPS.filter(p => PRESETS[p]).map(p => chip(PRESETS[p].name, { active: presetActive(p), attrs: `data-t="preset" data-id="${p}"`, cls: 'sm' })).join('')}</div>
    <div class="tr-tiles">${tiles}</div>
    <div class="tr-legend"><span style="--rc:var(--good)">Needs work</span><span style="--rc:var(--accent)">Ready</span><span style="--rc:var(--warn)">Almost</span><span style="--rc:var(--bad)">Recovering</span></div>
    ${sculpt.length ? `<div class="tr-label">Sculpt focus</div><div class="tr-chiprow wrap">${sculpt.map(id => chip(`✦ ${SCULPT_GOALS[id].name}`, { active: B.targets.includes(id), attrs: `data-t="sculpt" data-id="${id}"`, cls: 'sm chip-sculpt' })).join('')}</div>` : ''}
    <div class="tr-label">Style <span class="muted">· ${esc(STYLE_HINT[B.style] || '')}</span></div>
    <div class="tr-seg">${STYLES.map(([id, n]) => `<button type="button" class="${B.style === id ? 'active' : ''}" data-t="style" data-id="${id}">${n}</button>`).join('')}</div>
    <div class="tr-label tr-label-row"><span>Cardio finisher</span>
      <button type="button" class="tr-switch ${c.on ? 'on' : ''}" data-t="cardio-on" aria-pressed="${c.on}" ${copts.length ? '' : 'disabled'}><span></span></button></div>
    ${c.on && copts.length ? `<div class="tr-finisher">
      <div class="tr-chiprow scroll">${copts.map(o => chip(`${o.icon || ''} ${o.name}`, { active: o.id === c.modality, attrs: `data-t="c-mod" data-id="${o.id}"`, cls: 'sm' })).join('')}</div>
      <div class="tr-chiprow">${FINISHER_MIN.map(m => chip(`${m} min`, { active: c.minutes === m, attrs: `data-t="c-min" data-m="${m}"`, cls: 'sm' })).join('')}</div>
      <div class="tr-chiprow scroll">${Object.entries(INTENSITIES).map(([id, it]) => chip(it.name, { active: c.intensity === id, attrs: `data-t="c-int" data-id="${id}"`, cls: 'sm' })).join('')}</div>
    </div>` : ''}
    <button type="button" class="btn btn-primary tr-big" data-t="build">${B.targets.length ? `Build ${B.minutes}-min ${esc(B.targets.slice(0, 3).map(targetName).join(' + '))}${B.targets.length > 3 ? '…' : ''}` : `Build ${B.minutes}-min smart workout`}</button>
  </section>`;
}

function othersSection(loc) {
  return `<section class="tr-sec">
    <div class="section-title">Something else</div>
    <div class="tr-others">
      ${loc.hasClasses ? `<button type="button" class="tr-other" data-t="class"><span class="tr-other-ic">🎟️</span><span><b>Do a class instead</b><small>Today's ${esc(loc.name)} schedule</small></span></button>` : ''}
      <button type="button" class="tr-other" data-t="cardio"><span class="tr-other-ic">🏃</span><span><b>Just cardio</b><small>Run, bike, row, stairs…</small></span></button>
      <button type="button" class="tr-other" data-t="manual"><span class="tr-other-ic">📝</span><span><b>Log something I already did</b><small>Add exercises and sets freely</small></span></button>
    </div>
  </section>`;
}

function plannedSection(sessions) {
  const planned = sessions.filter(s => s.status === 'planned').slice(-5).reverse();
  if (!planned.length) return '';
  return `<section class="tr-sec">
    <div class="section-title">Saved for later</div>
    ${planned.map(s => `<div class="card tr-planned">
      <div><b>${esc(s.title || 'Workout')}</b><div class="muted small">${esc(fmtShort(s.date))} · ${(s.blocks || []).length} items · ~${s.estMinutes || s.minutes || '?'} min</div></div>
      <div class="tr-planned-btns"><button type="button" class="btn btn-primary btn-sm" data-t="p-start" data-id="${esc(s.id)}">Start</button><button type="button" class="tr-icon" data-t="p-del" data-id="${esc(s.id)}" aria-label="Delete">✕</button></div>
    </div>`).join('')}
  </section>`;
}

function rxText(b, ex, units) {
  const t = b.target || {};
  const reps = t.repMin && t.repMax && t.repMin !== t.repMax ? `${t.repMin}–${t.repMax}` : (t.repMin || t.reps || '?');
  const w = t.weight != null && ex?.unit !== 'seconds' ? ` @ ${fmtNum(t.weight)} ${unitLabel(ex, units)}` : '';
  return `${t.sets || (b.sets || []).length} × ${reps}${ex?.unit === 'seconds' ? 's' : ''}${w}`;
}

function preview(draft, profile) {
  const s = draft.session;
  const blocks = s.blocks || [];
  const est = s.estMinutes ?? safe(() => estimateMinutes(blocks), null);
  const budget = s.minutes || draft.params?.minutes;
  const over = est && budget && est > budget * 1.1;
  const loc = (profile.locations || []).find(l => l.id === s.location);
  const units = profile.units;

  let items = '';
  let i = 0;
  while (i < blocks.length) {
    const g = blocks[i].kind === 'lift' ? blocks[i].group : null;
    if (g) {
      let j = i; while (j < blocks.length && blocks[j].kind === 'lift' && blocks[j].group === g) j++;
      if (j - i > 1) {
        items += `<div class="tr-ss"><div class="tr-ss-label">${j - i > 2 ? 'Circuit' : 'Superset'} ${esc(g)}</div>${blocks.slice(i, j).map((b, k) => planItem(b, i + k, blocks.length, units)).join('')}</div>`;
        i = j; continue;
      }
    }
    items += planItem(blocks[i], i, blocks.length, units);
    i++;
  }

  return `<section class="tr-sec tr-preview">
    <div class="tr-prev-head">
      <button type="button" class="tr-link" data-t="back">‹ Builder</button>
      <span class="muted small">${esc(loc ? `${loc.icon || ''} ${loc.name}` : s.location || '')}${draft.params?.style ? ' · ' + esc(STYLES.find(x => x[0] === draft.params.style)?.[1] || '') : ''}</span>
    </div>
    <div class="tr-prev-title">
      <h2>${esc(s.title || 'Workout')}</h2>
      ${est ? `<div class="tr-est ${over ? 'over' : ''}"><b>~${Math.round(est)}</b><span>/ ${budget || '?'} min</span></div>` : ''}
    </div>
    ${(s.rationale || []).length ? `<ul class="tr-rationale">${s.rationale.slice(0, 6).map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    <div class="tr-plan">${items || '<div class="empty muted">No exercises. Add one below.</div>'}</div>
    <div class="tr-plan-tools">
      <button type="button" class="btn btn-ghost" data-t="add">+ Add exercise</button>
      ${draft.params ? '<button type="button" class="btn btn-ghost" data-t="shuffle">🔀 Shuffle</button>' : ''}
    </div>
    <button type="button" class="btn btn-primary tr-big" data-t="start">▶ Start workout</button>
    <div class="tr-plan-tools">
      <button type="button" class="btn btn-ghost" data-t="later">Save for later</button>
      <button type="button" class="btn btn-ghost tr-danger-text" data-t="discard">Discard</button>
    </div>
  </section>`;
}

function planItem(b, i, n, units) {
  const arrows = `<div class="tr-move">
      <button type="button" data-t="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
      <button type="button" data-t="down" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></div>`;
  if (b.kind === 'cardio') {
    return `<div class="tr-pitem cardio">${arrows}<div class="tr-pmain">
      <div class="tr-pname">${esc(cardioName(b.modality))}</div>
      <div class="tr-prx">${b.minutes || '?'} min · ${esc(intensityName(b.intensity))}</div></div>
      <div class="tr-pacts"><button type="button" class="tr-icon" data-t="rm" data-i="${i}" aria-label="Remove">✕</button></div></div>`;
  }
  if (b.kind === 'class') {
    return `<div class="tr-pitem class">${arrows}<div class="tr-pmain">
      <div class="tr-pname">🎟️ ${esc(b.name)}</div><div class="tr-prx">${b.time ? esc(b.time) + ' · ' : ''}${b.duration || '?'} min</div></div>
      <div class="tr-pacts"><button type="button" class="tr-icon" data-t="rm" data-i="${i}" aria-label="Remove">✕</button></div></div>`;
  }
  const ex = getEx(b.exId);
  const t = b.target || {};
  return `<div class="tr-pitem">${arrows}<div class="tr-pmain">
      <button type="button" class="tr-pname" data-t="info" data-i="${i}">${esc(exName(b.exId))}</button>
      <div class="tr-prx">${esc(rxText(b, ex, units))}${t.rest ? ` <span class="muted">· ${t.rest}s rest</span>` : ''}</div>
      ${t.note ? `<div class="tr-pnote">${esc(t.note)}</div>` : ''}
    </div>
    <div class="tr-pacts">
      <button type="button" class="tr-icon" data-t="swap" data-i="${i}" aria-label="Swap">⇄</button>
      <button type="button" class="tr-icon" data-t="rm" data-i="${i}" aria-label="Remove">✕</button>
    </div></div>`;
}

// ---------- actions ----------
function scrollTop() {
  try { window.scrollTo(0, 0); document.getElementById('content')?.scrollTo?.(0, 0); } catch (e) { /* ignore */ }
}

function build(ctx, targets) {
  const store = ctx.store;
  const profile = store.getProfile();
  const sessions = store.getSessions();
  const loc = currentLoc(ctx, profile);
  const c = B.cardio;
  const cardio = c.on && c.modality ? { modality: c.modality, minutes: c.minutes, intensity: c.intensity } : null;
  const params = { targets: [...targets], minutes: B.minutes, locationId: loc.id, style: B.style, cardio };
  const s = runBuild(ctx, params, profile, sessions, loc);
  if (!s) return;
  store.kv('draft', { session: s, params });
  showBuilderOverride = false;
  ctx.rerender();
  scrollTop();
}

function runBuild(ctx, params, profile, sessions, loc) {
  const s = safe(() => buildWorkout({
    targets: params.targets, minutes: params.minutes, location: loc, profile, sessions, now: new Date(),
    style: params.style, cardio: params.cardio, seed: Math.floor(Math.random() * 1e9), exclude: profile.avoidExercises || [],
  }), null);
  if (!s || !Array.isArray(s.blocks)) { toast(ctx, 'Could not build a workout. Try other muscles or more time.'); return null; }
  s.minutes = s.minutes || params.minutes;
  s.location = s.location || loc.id;
  return s;
}

function updateDraft(ctx, fn) {
  const draft = ctx.store.kv('draft');
  if (!draft?.session) return;
  const s = fn(draft.session) || draft.session;
  s.estMinutes = safe(() => estimateMinutes(s.blocks || []), s.estMinutes);
  ctx.store.kv('draft', { ...draft, session: s });
  ctx.rerender();
}

function locById(profile, id) { return (profile.locations || []).find(l => l.id === id) || null; }

// Make s the active session and open the logger.
export function startSession(ctx, s) {
  const store = ctx.store;
  const active = store.getActiveSession();
  if (active && active.id !== s.id && active.status === 'active') {
    if (!confirm(`"${active.title || 'Workout'}" is still in progress. Save it for later and start this one?`)) return false;
    active.status = 'planned';
    store.saveSession(active);
  }
  const now = new Date();
  const existing = s.id ? store.getSession(s.id) : null;
  const id = !s.id || (existing && existing.status === 'done') ? store.newSessionId() : s.id;
  const out = { notes: '', rationale: [], targets: [], ...s, id, status: 'active', startedAt: now.toISOString(), endedAt: null, date: ds(now) };
  store.saveSession(out);
  store.setActiveSessionId(id);
  ctx.nav('session', { id });
  return true;
}

function openClassSheet(ctx, loc) {
  const date = ds();
  openSheet(ctx, '<div data-classes></div>', (el, close) => {
    const wctx = { ...ctx, nav: (r, p) => { close(); closeSheet(ctx); ctx.nav(r, p); } };
    const host = el.querySelector('[data-classes]') || el;
    host.innerHTML = safe(() => renderClassPicker(wctx, { date, minutes: B.minutes, targets: B.targets }), '<div class="empty muted">Class schedule unavailable.</div>');
    safe(() => bindClassPicker(host, wctx), null);
  });
}

function openCardioSheet(ctx, loc) {
  const profile = ctx.store.getProfile();
  const eq = safe(() => expandEquipment(loc.equipment || []), new Set(['bodyweight', 'outdoors']));
  let opts = safe(() => cardioOptions(eq), []);
  if (!opts.length) opts = Object.values(CARDIO);
  const last = ctx.store.kv('lastCardio') || {};
  const html = `<div class="tr-sheet-h"><h3>Just cardio</h3><div class="muted small">${esc(loc.icon || '')} ${esc(loc.name)}</div></div>
    ${cardioFormHtml({ options: opts, modality: last.modality, minutes: last.minutes || 30, intensity: last.intensity || 'easy' })}
    <div class="tr-sheet-actions">
      <button type="button" class="btn btn-ghost" data-act="log">✓ Log as done</button>
      <button type="button" class="btn btn-primary" data-act="start">▶ Start now</button>
    </div>`;
  openSheet(ctx, html, (el, close) => {
    bindCardioForm(el);
    el.querySelector('.tr-sheet-actions').onclick = e => {
      const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
      const blk = readCardioForm(el, profile.bodyweight);
      if (!blk.modality || !blk.minutes) { toast(ctx, 'Pick a type and minutes'); return; }
      ctx.store.kv('lastCardio', { modality: blk.modality, minutes: blk.minutes, intensity: blk.intensity });
      const now = new Date();
      const s = {
        id: ctx.store.newSessionId(), date: ds(now), status: 'planned', startedAt: null, endedAt: null,
        location: loc.id, minutes: blk.minutes, title: `${CARDIO[blk.modality]?.name || 'Cardio'} · ${blk.minutes} min`,
        targets: [], source: 'cardio', blocks: [blk], rationale: [], notes: '',
      };
      close();
      if (act === 'log') {
        blk.done = true;
        s.status = 'done';
        s.endedAt = now.toISOString();
        s.startedAt = new Date(now - blk.minutes * 60000).toISOString();
        ctx.store.saveSession(s);
        toast(ctx, `Logged ${s.title}`);
        ctx.rerender();
      } else startSession(ctx, s);
    };
  });
}

function openManualSheet(ctx, loc) {
  const today = ds();
  const profile = ctx.store.getProfile();
  const html = `<div class="tr-sheet-h"><h3>Log a past workout</h3><div class="muted small">Add exercises and sets freely, then finish.</div></div>
    <label class="tr-field"><span class="tr-label">Date</span><input type="date" value="${today}" max="${today}" data-m-date></label>
    <label class="tr-field"><span class="tr-label">Title (optional)</span><input type="text" placeholder="e.g. Hotel upper body" data-m-title></label>
    <div class="tr-label">Where</div>
    <div class="tr-chiprow wrap" data-m-locs>${(profile.locations || []).map(l => chip(`${l.icon || ''} ${l.name}`, { active: l.id === loc.id, attrs: `data-id="${esc(l.id)}"` })).join('')}</div>
    <div class="tr-sheet-actions"><button type="button" class="btn btn-primary tr-big" data-m-go>Start logging</button></div>`;
  openSheet(ctx, html, (el, close) => {
    let locId = loc.id;
    el.querySelector('[data-m-locs]').onclick = e => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      locId = b.dataset.id; el.querySelectorAll('[data-m-locs] [data-id]').forEach(x => x.classList.toggle('active', x === b));
    };
    el.querySelector('[data-m-go]').onclick = () => {
      const date = el.querySelector('[data-m-date]').value || today;
      const title = el.querySelector('[data-m-title]').value.trim() || 'Logged workout';
      const store = ctx.store;
      const active = store.getActiveSession();
      if (active && active.status === 'active') {
        if (!confirm(`"${active.title || 'Workout'}" is in progress. Save it for later and log this instead?`)) return;
        active.status = 'planned'; store.saveSession(active);
      }
      const s = { id: store.newSessionId(), date, status: 'active', startedAt: null, endedAt: null, location: locId, minutes: null, title, targets: [], source: 'manual', blocks: [], rationale: [], notes: '' };
      store.saveSession(s);
      store.setActiveSessionId(s.id);
      close();
      ctx.nav('session', { id: s.id });
    };
  });
}

// ---------- bind ----------
export function bind(root, ctx, params = {}) {
  const store = ctx.store;
  if (showBuilderOverride && store.kv('draft')) { /* keep draft until a new build replaces it */ }

  root.onclick = e => {
    if (!root.querySelector('.tr-today')) return;
    const el = e.target.closest('[data-t]'); if (!el || el.disabled) return;
    const t = el.dataset.t;
    const profile = store.getProfile();
    const loc = currentLoc(ctx, profile);
    const i = Number(el.dataset.i);
    const draft = store.kv('draft');
    switch (t) {
      case 'resume': { const a = store.getActiveSession(); ctx.nav('session', a ? { id: a.id } : {}); break; }
      case 'rec': {
        const recs = safe(() => recommend(store.getSessions(), { now: new Date(), profile, minutes: B.minutes, location: loc }), []);
        const r = recs[i]; if (!r) return;
        build(ctx, r.targets?.length ? r.targets : (r.groups || []));
        break;
      }
      case 'time': customTime = false; B.minutes = Number(el.dataset.m); saveB(ctx); ctx.rerender(); break;
      case 'custom': customTime = true; ctx.rerender(); setTimeout(() => root.querySelector('[data-f="minutes"]')?.focus(), 30); break;
      case 'loc': store.updateProfile({ currentLocation: el.dataset.id }); ctx.rerender(); break;
      case 'group': case 'sculpt': {
        const id = el.dataset.id;
        B.targets = B.targets.includes(id) ? B.targets.filter(x => x !== id) : [...B.targets, id];
        saveB(ctx); ctx.rerender(); break;
      }
      case 'preset': {
        const gs = PRESETS[el.dataset.id]?.groups || [];
        const sel = B.targets.filter(x => GROUPS[x]);
        const same = gs.length === sel.length && gs.every(g => sel.includes(g));
        B.targets = [...B.targets.filter(x => !GROUPS[x]), ...(same ? [] : gs)];
        saveB(ctx); ctx.rerender(); break;
      }
      case 'clear': B.targets = []; saveB(ctx); ctx.rerender(); break;
      case 'style': B.style = el.dataset.id; saveB(ctx); ctx.rerender(); break;
      case 'cardio-on': B.cardio.on = !B.cardio.on; saveB(ctx); ctx.rerender(); break;
      case 'c-mod': B.cardio.modality = el.dataset.id; saveB(ctx); ctx.rerender(); break;
      case 'c-min': B.cardio.minutes = Number(el.dataset.m); saveB(ctx); ctx.rerender(); break;
      case 'c-int': B.cardio.intensity = el.dataset.id; saveB(ctx); ctx.rerender(); break;
      case 'build': build(ctx, B.targets); break;
      case 'back': showBuilderOverride = true; ctx.rerender(); scrollTop(); break;
      case 'shuffle': {
        if (!draft?.params) return;
        const l = locById(profile, draft.params.locationId) || loc;
        const s = runBuild(ctx, draft.params, profile, store.getSessions(), l);
        if (s) { store.kv('draft', { ...draft, session: s }); ctx.rerender(); }
        break;
      }
      case 'up': case 'down': updateDraft(ctx, s => {
        const j = t === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= s.blocks.length) return s;
        [s.blocks[i], s.blocks[j]] = [s.blocks[j], s.blocks[i]];
        return s;
      }); break;
      case 'rm': updateDraft(ctx, s => { s.blocks.splice(i, 1); return s; }); break;
      case 'info': {
        const b = draft?.session?.blocks?.[i]; if (!b) return;
        openSheet(ctx, exerciseInfoHtml(getEx(b.exId)), (sh, close) => {
          sh.onclick = ev => { const lb = ev.target.closest('[data-info-lib]'); if (lb) { close(); closeSheet(ctx); ctx.nav('exercise', { id: lb.dataset.infoLib }); } };
        });
        break;
      }
      case 'swap': {
        const s = draft?.session; const b = s?.blocks?.[i]; if (!b) return;
        const l = locById(profile, s.location) || loc;
        swapSheet(ctx, {
          exId: b.exId, equipment: l.equipment || [], exclude: s.blocks.filter(x => x.kind === 'lift').map(x => x.exId),
          onPick: id => updateDraft(ctx, ss => {
            const out = safe(() => swapBlock(ss, i, id, { sessions: store.getSessions(), now: new Date() }), null);
            if (!out) return ss;
            if (out.blocks[i] && out.blocks[i].group == null && b.group) out.blocks[i].group = b.group;
            return out;
          }),
        });
        break;
      }
      case 'add': {
        const s = draft?.session; if (!s) return;
        const l = locById(profile, s.location) || loc;
        addExerciseSheet(ctx, {
          equipment: l.equipment || [], targets: s.targets || [], sculptGoals: profile.sculptGoals || [],
          exclude: (s.blocks || []).filter(x => x.kind === 'lift').map(x => x.exId),
          onPick: id => updateDraft(ctx, ss => safe(() => addExercise(ss, id, { sessions: store.getSessions(), now: new Date() }), ss)),
        });
        break;
      }
      case 'start': if (draft?.session) { if (startSession(ctx, draft.session)) store.kv('draft', null); } break;
      case 'later': {
        if (!draft?.session) return;
        const s = { ...draft.session, id: draft.session.id || store.newSessionId(), status: 'planned' };
        store.saveSession(s); store.kv('draft', null);
        toast(ctx, 'Saved for later'); ctx.rerender(); break;
      }
      case 'discard': store.kv('draft', null); showBuilderOverride = false; ctx.rerender(); break;
      case 'p-start': { const s = store.getSession(el.dataset.id); if (s) startSession(ctx, s); break; }
      case 'p-del': if (confirm('Delete this saved workout?')) { store.deleteSession(el.dataset.id); ctx.rerender(); } break;
      case 'class': openClassSheet(ctx, loc); break;
      case 'cardio': openCardioSheet(ctx, loc); break;
      case 'manual': openManualSheet(ctx, loc); break;
    }
  };

  root.onchange = e => {
    if (!root.querySelector('.tr-today')) return;
    if (e.target.matches('[data-f="minutes"]')) {
      const m = Math.round(Number(e.target.value));
      if (m >= 5 && m <= 240) { B.minutes = m; saveB(ctx); ctx.rerender(); }
    }
  };
}
