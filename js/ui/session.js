// Workout tab (UI-TRAIN): the per-set logger for the active session (or params.id).
// CONTRACT-NOTE: extra optional fields written by this module: Block.skipped (lift, boolean).
//   Skipped blocks are kept for the record but their undone sets never count.
// CONTRACT-NOTE: a session with startedAt null is a session being written up after the fact
//   ("log a past workout", a retro build from the date builder, §24): the header shows an editable
//   date instead of the elapsed timer, bounded by the retro window, and Finish stamps startedAt /
//   endedAt onto that session's own date so every reader attributes it to the right day and week.
// Every change is saved right away (typing is debounced 400 ms and flushed on pagehide).
import { ds, fmtShort, fmtDay } from '../util.js';
import { GROUPS, UNIT_ORDER } from '../data/muscles.js';
import { CARDIO, INTENSITIES, estimateCalories } from '../data/cardio.js';
import { getEx } from '../data/exercises.js';
import { groupStatus, sessionVolume } from '../engine/recovery.js';
import { sessionPRs, personalRecords } from '../engine/progression.js';
import { swapBlock, addExercise, alternatives } from '../engine/generator.js';
import { activeIssues, issueLabel, issueTier } from '../engine/issues.js';
// CONTRACT-NOTE (§26): the header carries the heavy-workout warning (ui/overload.js) once the workout passes
//   the ceiling or a muscle's per-session cap, with a one-tap trim that never removes a logged set. The ⋯ menu
//   has "This hurts": it logs an issue for the exercise's area (ui/issues.js openHurtsSheet) and swaps the
//   exercise for the best alternative that spares it (logged sets stay; no safe swap → the exercise is skipped).
import { openHurtsSheet } from './issues.js';
import { loadNoteHTML, trimSession } from './overload.js';
import { cardioWeek } from '../engine/targets.js';
import { retroTimes, retroFloor, canLogPast } from '../engine/retro.js';
import { weeklySetsHTML, weekSummaryFor } from './targets.js';
// CONTRACT-NOTE (INTEGRATOR §18): the finish summary shows this week's cardio vs the weekly target
//   (targets.cardioWeek) when the session had cardio or the week is behind. "Your week now" bars
//   show weekly sets vs target with the shared rows (targets.weeklySetsHTML), same as Plan and Body.
import {
  esc, fmtNum, exName, unitLabel, safe, debounce, fmtDuration, openSheet, closeSheet, toast, startRest, stopRest,
  muscleBar, addExerciseSheet, swapSheet, cardioFormHtml, bindCardioForm, readCardioForm, cardioName, exerciseInfoHtml,
  parkActiveSession,
} from './components.js';

// This screen redraws itself; a store-change re-render would clobber in-progress typing.
export const autoRerender = false;

let S = null;          // the session being edited
let CTX = null;
let tickIv = null;
let hold = null;       // running hold timer { i, k, start, dur, iv }
const saveLater = debounce(() => { if (S && CTX) CTX.store.saveSession(S); }, 400);
function saveNow() { saveLater.flush(); if (S && CTX) CTX.store.saveSession(S); }

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => saveLater.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveLater.flush(); });
}

const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const isLift = b => b && b.kind === 'lift';

function loadSession(ctx, params) {
  const store = ctx.store;
  if (params?.id) return store.getSession(params.id);
  const a = store.getActiveSession();
  return a && a.status !== 'done' ? a : null;
}
function sessionLoc(profile, s) { return (profile.locations || []).find(l => l.id === s.location) || null; }
function sessionEquipment(profile, s) {
  if (s.source === 'manual') return [...new Set((profile.locations || []).flatMap(l => l.equipment || []))];
  return sessionLoc(profile, s)?.equipment || ['bodyweight'];
}

// ---------- computed ----------
function prefill(b) {
  const t = b.target || {};
  let w = t.weight ?? null, r = t.reps ?? t.repMin ?? null;
  return (b.sets || []).map(st => {
    const sw = st.w ?? w, sr = st.r ?? r;
    w = sw; r = sr;
    return { w: sw, r: sr, ghostW: st.w == null, ghostR: st.r == null };
  });
}
function progress(s) {
  let total = 0, done = 0;
  for (const b of s.blocks || []) {
    if (isLift(b) && !b.skipped) { total += b.sets.length; done += b.sets.filter(x => x.done).length; }
    else if (b.kind === 'cardio' || b.kind === 'class') { total += 1; done += b.done ? 1 : 0; }
  }
  return { total, done };
}
function minutesLeft(s) {
  let sec = 0;
  for (const b of s.blocks || []) {
    if (isLift(b) && !b.skipped) {
      const ex = getEx(b.exId), t = b.target || {};
      const left = b.sets.filter(x => !x.done).length;
      if (!left) continue;
      const reps = ex?.unit === 'seconds' ? 1 : (t.reps || t.repMin || 10);
      const work = ex?.unit === 'seconds' ? (t.reps || t.repMin || 30) : reps * (ex?.secPerRep || 3);
      sec += left * (work * (ex?.unilateral ? 2 : 1) + (t.rest || 60));
      if (!b.sets.some(x => x.done)) sec += ex?.setupSec || 30;
    } else if (b.kind === 'cardio' && !b.done) sec += (Number(b.minutes) || 0) * 60;
    else if (b.kind === 'class' && !b.done) sec += (Number(b.duration) || 0) * 60;
  }
  return Math.round(sec / 60);
}
// Index of the block that ends this block's superset run (itself if not in a superset).
function groupEnd(s, i) {
  const g = s.blocks[i]?.group;
  if (!g) return i;
  let j = i;
  while (j + 1 < s.blocks.length && isLift(s.blocks[j + 1]) && s.blocks[j + 1].group === g && !s.blocks[j + 1].skipped) j++;
  return j;
}
function groupStart(s, i) {
  const g = s.blocks[i]?.group;
  if (!g) return i;
  let j = i;
  while (j - 1 >= 0 && isLift(s.blocks[j - 1]) && s.blocks[j - 1].group === g) j--;
  return j;
}

// ---------- render ----------
export function render(ctx, params = {}) {
  CTX = ctx;
  saveLater.flush();
  S = loadSession(ctx, params);
  if (!S) return emptyState(ctx);
  S.blocks = S.blocks || [];
  return `<div class="tr-session">${renderInner(ctx)}</div>`;
}

function emptyState(ctx) {
  const planned = ctx.store.getSessions().filter(s => s.status === 'planned' && s.date <= ds(new Date()) && !(s.plan && s.plan.auto && s.date < ds(new Date())) && (s.blocks || []).length).slice(-3).reverse();
  return `<div class="tr-session"><div class="empty tr-empty">
    <div class="tr-empty-ic">🏋️</div>
    <h2>No workout in progress</h2>
    <p class="muted">Build one on Today in a couple of taps.</p>
    <button type="button" class="btn btn-primary tr-big" data-s="today">Go to Today</button>
  </div>
  ${planned.length ? `<div class="section-title">Saved for later</div>${planned.map(s => `<div class="card tr-planned"><div><b>${esc(s.title || 'Workout')}</b><div class="muted small">${esc(fmtShort(s.date))} · ${(s.blocks || []).length} items</div></div><button type="button" class="btn btn-primary btn-sm" data-s="p-start" data-id="${esc(s.id)}">Start</button></div>`).join('')}` : ''}
  </div>`;
}

function renderInner(ctx) {
  const profile = ctx.store.getProfile();
  const s = S;
  let blocks = '';
  let i = 0;
  while (i < s.blocks.length) {
    const b = s.blocks[i];
    if (isLift(b) && b.group) {
      const j = (() => { let j = i; while (j + 1 < s.blocks.length && isLift(s.blocks[j + 1]) && s.blocks[j + 1].group === b.group) j++; return j; })();
      if (j > i) {
        blocks += `<div class="tr-ss tr-ss-live"><div class="tr-ss-label">${j - i > 1 ? 'Circuit' : S.style === 'efficient' || S.styleDef?.pairing === 'antagonist' ? 'Pair' : 'Superset'} ${esc(b.group)} <span class="muted">· rest after the last one</span></div>`;
        for (let k = i; k <= j; k++) blocks += renderBlock(k, profile);
        blocks += '</div>';
        i = j + 1; continue;
      }
    }
    blocks += renderBlock(i, profile);
    i++;
  }
  const done = s.status === 'done';
  const retro = !s.startedAt && s.date < ds();      // §24: written up after the fact
  return `${renderHeader(profile)}
    <div class="tr-blocks">${blocks || `<div class="empty muted tr-noblocks">${s.source === 'manual' ? 'Add what you did, set by set.' : 'No exercises yet.'}</div>`}</div>
    <div class="tr-plan-tools">
      <button type="button" class="btn btn-ghost" data-s="add-ex">+ Add exercise</button>
      <button type="button" class="btn btn-ghost" data-s="add-cardio">+ Add cardio</button>
    </div>
    <label class="tr-field"><span class="tr-label">Notes</span><textarea rows="2" data-f="notes" placeholder="How did it feel? Anything to remember?">${esc(s.notes || '')}</textarea></label>
    ${done
      ? '<button type="button" class="btn btn-primary tr-big" data-s="close">Done editing</button>'
      : `<button type="button" class="btn btn-primary tr-big tr-finish" data-s="finish">${retro ? `✓ Save it on ${esc(fmtDay(s.date).split(',')[0])}` : 'Finish workout'}</button>`}
    <button type="button" class="btn btn-ghost tr-danger-text tr-discard" data-s="discard">${done ? 'Delete workout' : 'Discard workout'}</button>`;
}

function renderHeader(profile) {
  const s = S;
  const loc = sessionLoc(profile, s);
  const p = progress(s);
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  // startedAt null = not running yet. That is either §24 (writing up a day that has happened) or a
  // session planned for a later day, which is being done NOW — so the date field offers today rather
  // than a future date its own max forbids. An older date is kept as-is: it is a real log date.
  const manual = !s.startedAt;
  const logDate = s.date > ds() ? ds() : s.date;
  const left = minutesLeft(s);
  return `<header class="tr-shead" data-head>
    <div class="tr-shead-row">
      <div class="tr-shead-title"><h1>${esc(s.title || 'Workout')}</h1>
        <div class="muted small">${loc ? esc(`${loc.icon || ''} ${loc.name}`) : ''}${s.status === 'done' ? ' · Completed' : manual && s.date < ds() ? ` · Logging ${esc(fmtDay(s.date))}` : ''}</div></div>
      ${manual
        ? `<input type="date" class="tr-date-in" value="${esc(logDate)}" min="${retroFloor()}" max="${ds()}" data-f="date" aria-label="Date">`
        : `<div class="tr-clock"><b data-elapsed>${fmtDuration((s.endedAt ? new Date(s.endedAt) : Date.now()) - new Date(s.startedAt))}</b><span>elapsed</span></div>`}
    </div>
    <div class="tr-sprog"><div style="width:${pct}%"></div></div>
    <div class="tr-shead-foot muted small"><span data-prog>${p.done}/${p.total} done</span>${s.status !== 'done' && !manual ? `<span data-left>${left ? `~${left} min left` : 'All done 💪'}</span>` : ''}</div>
    ${s.status !== 'done' ? safe(() => loadNoteHTML(s, profile, { attr: 'data-s' }), '') : ''}
  </header>`;
}

function renderBlock(i, profile) {
  const b = S.blocks[i];
  if (b.kind === 'cardio') return renderCardio(i, b);
  if (b.kind === 'class') return renderClass(i, b);
  if (!isLift(b)) return '';
  const ex = getEx(b.exId);
  const t = b.target || {};
  const units = profile.units || 'lb';
  const ul = unitLabel(ex, units);
  const doneN = b.sets.filter(x => x.done).length;
  const allDone = b.sets.length && doneN === b.sets.length;
  const secs = ex?.unit === 'seconds';
  if (b.skipped) {
    return `<div class="card tr-blk skipped" data-blk="${i}"><div class="tr-blk-head">
      <span class="tr-blk-name">${esc(exName(b.exId))}</span><span class="muted small">Skipped${doneN ? ` · ${doneN} sets kept` : ''}</span>
      <button type="button" class="tr-link" data-s="unskip" data-i="${i}">Undo</button></div></div>`;
  }
  const pos = b.group ? `${b.group}${i - groupStart(S, i) + 1}` : '';
  const reps = secs ? `${t.repMin || t.reps || '?'}${t.repMax && t.repMax !== t.repMin ? '–' + t.repMax : ''}s`
    : `${t.repMin ?? '?'}${t.repMax && t.repMax !== t.repMin ? '–' + t.repMax : ''}`;
  // The real number of rows, not target.sets: "+ Set" / "− Set" change the former, never the latter.
  const rx = `${b.sets.length || t.sets || 0} × ${reps}${t.weight != null ? ` @ ${fmtNum(t.weight)} ${ul}` : ''}`;
  const pf = prefill(b);
  const stepW = ex?.step || 2.5;
  const weighted = !secs && ex?.unit !== 'bodyweight';
  const rows = b.sets.map((st, k) => {
    const v = pf[k];
    const running = hold && hold.i === i && hold.k === k;
    return `<div class="tr-set ${st.done ? 'done' : ''}" data-i="${i}" data-k="${k}">
      <span class="tr-set-n">${k + 1}</span>
      <div class="tr-step">
        ${weighted ? `<button type="button" class="tr-stp" data-s="wdec" data-i="${i}" data-k="${k}" aria-label="Less weight">−</button>` : ''}
        <input class="tr-in tr-w ${v.ghostW ? 'ghost' : ''}" type="number" inputmode="decimal" step="any" min="0" value="${v.w ?? ''}" placeholder="${weighted ? ul.split(' ')[0] : '+' + units}" data-f="w" data-i="${i}" data-k="${k}" aria-label="Weight set ${k + 1}">
        ${weighted ? `<button type="button" class="tr-stp" data-s="winc" data-i="${i}" data-k="${k}" aria-label="More weight">+</button>` : ''}
      </div>
      <span class="tr-x">×</span>
      <div class="tr-step">
        <input class="tr-in tr-r ${v.ghostR ? 'ghost' : ''}" type="number" inputmode="numeric" min="0" value="${v.r ?? ''}" placeholder="${secs ? 'sec' : 'reps'}" data-f="r" data-i="${i}" data-k="${k}" aria-label="${secs ? 'Seconds' : 'Reps'} set ${k + 1}">
        ${secs ? `<button type="button" class="tr-stp tr-hold ${running ? 'running' : ''}" data-s="hold" data-i="${i}" data-k="${k}" aria-label="Hold timer">${running ? fmtDuration(Math.max(0, hold.dur * 1000 - (Date.now() - hold.start))) : '⏱'}</button>` : ''}
      </div>
      <button type="button" class="tr-check ${st.done ? 'done' : ''}" data-s="check" data-i="${i}" data-k="${k}" aria-label="Set ${k + 1} done">✓</button>
    </div>`;
  }).join('');
  return `<div class="card tr-blk ${allDone ? 'complete' : ''}" data-blk="${i}">
    <div class="tr-blk-head">
      ${pos ? `<span class="tr-ss-badge">${esc(pos)}</span>` : ''}
      <button type="button" class="tr-blk-name" data-s="info" data-i="${i}">${esc(exName(b.exId))} <span class="tr-info-i">ⓘ</span></button>
      <button type="button" class="tr-icon" data-s="swap" data-i="${i}" aria-label="Swap exercise">⇄</button>
      <button type="button" class="tr-icon" data-s="menu" data-i="${i}" aria-label="More">⋯</button>
    </div>
    <div class="tr-rx"><b>${esc(rx)}</b>${t.rest ? `<span class="muted"> · rest ${t.rest}s</span>` : ''}<span class="tr-unit muted">${esc(secs ? 'seconds' : ul)}</span></div>
    ${t.note ? `<div class="tr-note">${esc(t.note)}</div>` : ''}
    <div class="tr-sets">${rows}</div>
    <div class="tr-blk-foot">
      <button type="button" class="tr-link" data-s="add-set" data-i="${i}">+ Set</button>
      ${b.sets.length > 1 ? `<button type="button" class="tr-link" data-s="rm-set" data-i="${i}">− Set</button>` : ''}
      <span class="tr-blk-count muted small">${doneN}/${b.sets.length}</span>
    </div>
  </div>`;
}

function renderCardio(i, b) {
  const mods = Object.values(CARDIO);
  const est = safe(() => estimateCalories(b.modality, Number(b.minutes) || 0, b.intensity, CTX?.store.getProfile().bodyweight || 165), null);
  return `<div class="card tr-blk tr-cardio ${b.done ? 'complete' : ''}" data-blk="${i}">
    <div class="tr-blk-head">
      <span class="tr-blk-name">${esc(cardioName(b.modality))}</span>
      <button type="button" class="tr-icon" data-s="rm-block" data-i="${i}" aria-label="Remove">✕</button>
      <button type="button" class="tr-check ${b.done ? 'done' : ''}" data-s="toggle" data-i="${i}" aria-label="Done">✓</button>
    </div>
    <div class="tr-cgrid">
      <label><span class="tr-label">Type</span><select data-f="c-mod" data-i="${i}">${mods.map(m => `<option value="${esc(m.id)}" ${m.id === b.modality ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label><span class="tr-label">Minutes</span><input class="tr-in" type="number" inputmode="numeric" min="0" value="${b.minutes ?? ''}" data-f="c-min" data-i="${i}"></label>
      <label><span class="tr-label">Intensity</span><select data-f="c-int" data-i="${i}">${Object.entries(INTENSITIES).map(([id, it]) => `<option value="${id}" ${id === b.intensity ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}</select></label>
      <label><span class="tr-label">Distance</span><span class="tr-inline"><input class="tr-in" type="number" inputmode="decimal" step="any" value="${b.distance?.value ?? ''}" placeholder="—" data-f="c-dist" data-i="${i}"><select data-f="c-unit" data-i="${i}"><option ${b.distance?.unit !== 'km' ? 'selected' : ''}>mi</option><option ${b.distance?.unit === 'km' ? 'selected' : ''}>km</option></select></span></label>
      <label><span class="tr-label">Calories</span><input class="tr-in" type="number" inputmode="numeric" value="${b.calories ?? ''}" placeholder="${est ? '~' + est : '—'}" data-f="c-cal" data-i="${i}"></label>
    </div>
  </div>`;
}

function renderClass(i, b) {
  const c = b.classify || {};
  return `<div class="card tr-blk tr-class ${b.done ? 'complete' : ''}" data-blk="${i}">
    <div class="tr-blk-head">
      <span class="tr-blk-name">🎟️ ${esc(b.name || 'Class')}</span>
      <button type="button" class="tr-check ${b.done ? 'done' : ''}" data-s="toggle" data-i="${i}" aria-label="Done">✓</button>
    </div>
    <div class="muted small">${[b.time, b.duration ? b.duration + ' min' : '', b.instructor].filter(Boolean).map(esc).join(' · ')}</div>
    ${c.label ? `<div class="tr-class-type"><span class="badge">${esc(c.label)}</span> ${c.intensity ? `<span class="muted small">${esc(INTENSITIES[c.intensity]?.name || c.intensity)}</span>` : ''}</div>` : ''}
    ${c.blurb ? `<div class="tr-note">${esc(c.blurb)}</div>` : ''}
    <div class="tr-blk-foot"><button type="button" class="tr-link" data-s="rm-block" data-i="${i}">Remove</button></div>
  </div>`;
}

// ---------- partial redraws ----------
function redrawBlock(root, i) {
  const el = root.querySelector(`[data-blk="${i}"]`);
  if (!el) return redrawAll(root);
  el.outerHTML = renderBlock(i, CTX.store.getProfile());
  redrawHeader(root);
}
function redrawHeader(root) {
  const h = root.querySelector('[data-head]');
  if (h) h.outerHTML = renderHeader(CTX.store.getProfile());
}
function redrawAll(root) {
  const host = root.querySelector('.tr-session');
  if (!host) return CTX.rerender();
  const sc = document.scrollingElement?.scrollTop, rs = root.scrollTop;
  host.innerHTML = renderInner(CTX);
  if (sc != null) document.scrollingElement.scrollTop = sc;
  root.scrollTop = rs;
}

// ---------- actions ----------
function commitSet(root, i, k) {
  const row = root.querySelector(`.tr-set[data-i="${i}"][data-k="${k}"]`);
  const st = S.blocks[i].sets[k];
  if (!row) return st;
  st.w = num(row.querySelector('[data-f="w"]').value);
  st.r = num(row.querySelector('[data-f="r"]').value);
  return st;
}

function afterSetDone(i) {
  const b = S.blocks[i];
  const end = groupEnd(S, i);
  if (end === i) {
    // End of a pair / superset / circuit round (or a solo set): the shared rest. If the round's later
    // members are skipped, this block carries only the short transition, so use the round's longest rest.
    let rest = b.target?.rest || 60;
    if (b.group) for (let j = groupStart(S, i); j < S.blocks.length && isLift(S.blocks[j]) && S.blocks[j].group === b.group; j++) rest = Math.max(rest, S.blocks[j].target?.rest || 0);
    startRest(CTX, rest); return;
  }
  // superset: go straight to the next exercise
  const next = S.blocks[i + 1];
  if (next && isLift(next)) toast(CTX, `Superset → ${exName(next.exId)}`);
  const el = document.querySelector(`[data-blk="${i + 1}"]`);
  if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function toggleSet(root, i, k, forceDone) {
  const b = S.blocks[i];
  const st = b.sets[k];
  if (st.done && !forceDone) { st.done = false; saveNow(); redrawBlock(root, i); return; }
  commitSet(root, i, k);
  if (!(st.r > 0)) { toast(CTX, 'Enter reps first'); root.querySelector(`.tr-set[data-i="${i}"][data-k="${k}"] [data-f="r"]`)?.focus(); return; }
  st.done = true;
  saveNow();
  redrawBlock(root, i);
  afterSetDone(i);
}

function startHold(root, i, k) {
  if (hold) {
    const same = hold.i === i && hold.k === k;
    const elapsed = Math.round((Date.now() - hold.start) / 1000);
    const h = hold; clearInterval(h.iv); hold = null;
    if (same) { const st = S.blocks[i].sets[k]; st.r = Math.max(1, elapsed); commitW(root, i, k); st.done = true; saveNow(); redrawBlock(root, i); afterSetDone(i); return; }
    redrawBlock(root, h.i);
  }
  const row = root.querySelector(`.tr-set[data-i="${i}"][data-k="${k}"]`);
  const dur = num(row?.querySelector('[data-f="r"]').value) || S.blocks[i].target?.reps || S.blocks[i].target?.repMin || 30;
  hold = { i, k, start: Date.now(), dur };
  hold.iv = setInterval(() => {
    const btn = document.querySelector(`.tr-set[data-i="${i}"][data-k="${k}"] .tr-hold`);
    const left = hold.dur * 1000 - (Date.now() - hold.start);
    if (!btn) { clearInterval(hold.iv); hold = null; return; }
    btn.textContent = fmtDuration(Math.max(0, left));
    btn.classList.add('running');
    if (left <= 0) {
      clearInterval(hold.iv); hold = null;
      if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
      const st = S.blocks[i].sets[k]; commitW(root, i, k); st.r = dur; st.done = true; saveNow(); redrawBlock(root, i); afterSetDone(i);
    }
  }, 250);
  redrawBlock(root, i);
}
function commitW(root, i, k) {
  const row = root.querySelector(`.tr-set[data-i="${i}"][data-k="${k}"]`);
  if (row) S.blocks[i].sets[k].w = num(row.querySelector('[data-f="w"]').value);
}

function blockMenu(root, i) {
  const b = S.blocks[i];
  const html = `<div class="tr-sheet-h"><h3>${esc(exName(b.exId))}</h3></div>
    <div class="tr-menu">
      <button type="button" data-m="info">ⓘ Form cues & video</button>
      <button type="button" data-m="swap">⇄ Swap exercise</button>
      <button type="button" data-m="hurts">🩹 This hurts</button>
      ${i > 0 ? '<button type="button" data-m="up">▲ Move up</button>' : ''}
      ${i < S.blocks.length - 1 ? '<button type="button" data-m="down">▼ Move down</button>' : ''}
      <button type="button" data-m="skip">⏭ Skip exercise</button>
      <button type="button" data-m="remove" class="tr-danger-text">✕ Remove from workout</button>
    </div>`;
  openSheet(CTX, html, (el, close) => {
    el.onclick = e => {
      const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return;
      close();
      if (m === 'info') return showInfo(b.exId);
      if (m === 'swap') return doSwap(root, i);
      if (m === 'hurts') return openHurtsSheet(CTX, { exId: b.exId, onSaved: () => swapForSafe(root, i) });
      if (m === 'up' || m === 'down') { const j = m === 'up' ? i - 1 : i + 1; [S.blocks[i], S.blocks[j]] = [S.blocks[j], S.blocks[i]]; }
      if (m === 'skip') b.skipped = true;
      if (m === 'remove') { if (b.sets.some(x => x.done) && !confirm('Remove this exercise and its logged sets?')) return; S.blocks.splice(i, 1); }
      saveNow(); redrawAll(root);
    };
  });
}

function showInfo(exId) {
  openSheet(CTX, exerciseInfoHtml(getEx(exId)), (el, close) => {
    el.onclick = e => { const b = e.target.closest('[data-info-lib]'); if (b) { close(); closeSheet(CTX); CTX.nav('exercise', { id: b.dataset.infoLib }); } };
  });
}

function doSwap(root, i) {
  const profile = CTX.store.getProfile();
  const b = S.blocks[i];
  swapSheet(CTX, {
    exId: b.exId, equipment: sessionEquipment(profile, S), exclude: S.blocks.filter(isLift).map(x => x.exId),
    onPick: id => { if (!applySwap(i, id)) return; saveNow(); redrawAll(root); toast(CTX, `Swapped to ${exName(id)}`); },
  });
}
// Swap block i for exercise id. Logged sets stay with the old exercise; the new one gets the remaining sets
// right after it.
function applySwap(i, id) {
  const b = S.blocks[i];
  const opts = { sessions: CTX.store.getSessions().filter(x => x.id !== S.id), now: new Date() };
  const doneSets = b.sets.filter(x => x.done);
  if (doneSets.length) {
    const tmp = safe(() => addExercise(S, id, opts), null);
    if (!tmp) return false;
    const nb = tmp.blocks[tmp.blocks.length - 1];
    const remaining = Math.max(1, b.sets.length - doneSets.length);
    nb.sets = Array.from({ length: remaining }, () => ({ w: null, r: null, done: false }));
    nb.target = { ...nb.target, sets: remaining };
    nb.group = b.group ?? null;
    b.sets = doneSets; b.target = { ...b.target, sets: doneSets.length };
    S.blocks.splice(i + 1, 0, nb);
  } else {
    const out = safe(() => swapBlock(S, i, id, opts), null);
    if (!out) return false;
    if (out.blocks[i] && out.blocks[i].group == null && b.group) out.blocks[i].group = b.group;
    Object.assign(S, out);
  }
  return true;
}
// §26 "This hurts": the issue is already saved (setTargets writes the profile at once), so the best
// alternative that spares every active issue goes in; with none at this location the exercise is skipped.
function swapForSafe(root, i) {
  const b = S && S.blocks[i]; if (!b || !isLift(b)) return;
  const profile = CTX.store.getProfile();
  const issues = safe(() => activeIssues(profile, ds()), []);
  const logged = issues[issues.length - 1];   // the one just logged (newest)
  // the alternatives that spare every active issue, the ones that load the just-logged area least first
  const alts = safe(() => alternatives(b.exId, { equipment: sessionEquipment(profile, S), exclude: S.blocks.filter(isLift).map(x => x.exId), limit: 8, issues }), [])
    .map((e, k) => ({ e, k, t: logged ? issueTier(e, logged) : 0 })).sort((x, y) => x.t - y.t || x.k - y.k).map(x => x.e);
  const what = logged ? `your ${issueLabel(logged).toLowerCase()}` : 'it';
  if (alts.length && applySwap(i, alts[0].id)) toast(CTX, `Logged. Swapped to ${alts[0].name}, which spares ${what}`);
  else { b.skipped = true; toast(CTX, `Logged. Nothing here spares ${what}, so this one is skipped (⇄ to pick your own)`); }
  saveNow(); redrawAll(root);
}

function finish(root) {
  const store = CTX.store;
  saveLater.flush();
  const p = progress(S);
  if (p.done === 0 && !confirm('Nothing is checked off yet. Finish anyway?')) return;
  if (hold) { clearInterval(hold.iv); hold = null; }
  const now = new Date();
  S.status = 'done';
  S.endedAt = now.toISOString();
  if (!S.startedAt) {
    // A session planned for a later day that is being finished now happened TODAY: leaving it on its
    // own date would record training that has not happened yet (and plan it away at the same time).
    if (S.date > ds(now)) S.date = ds(now);
    // Written up after the fact (§24): plausible timestamps on its OWN date, so recovery
    // ("days since"), the weekly volume audit and History put it on that day, not today.
    const mins = Math.max(10, Math.round(Number(S.minutes) || Number(S.estMinutes) || 45));
    const t = retroTimes(S.date, { time: (S.blocks || []).find(b => b.kind === 'class')?.time || null, minutes: mins, now });
    S.startedAt = t.startedAt;
    S.endedAt = t.endedAt;
  }
  store.saveSession(S);
  if (store.getActiveSession()?.id === S.id || !store.getActiveSession()) store.setActiveSessionId(null);
  stopRest(CTX);
  const done = S;
  S = null;
  CTX.nav('today');
  showSummary(done);
}

export function summaryHtml(s, sessions, profile) {
  const vol = safe(() => sessionVolume(s), { groups: {}, liftSets: 0, cardioMin: 0 });
  let load = 0;
  for (const b of s.blocks || []) if (isLift(b)) for (const x of b.sets) if (x.done && x.r > 0 && x.w > 0) load += x.w * x.r * (getEx(b.exId)?.unit === 'each' ? 2 : 1);
  let prs = safe(() => sessionPRs(s, sessions), null);
  if (!prs) {
    const before = safe(() => personalRecords(sessions.filter(x => x.id !== s.id && x.status === 'done')), {});
    const after = safe(() => personalRecords([s]), {});
    prs = Object.entries(after).filter(([id, r]) => before[id] && (r.e1rm || 0) > (before[id].e1rm || 0)).map(([exId, r]) => ({ exId, ...r, previous: before[exId] }));
  }
  const dur = s.startedAt && s.endedAt ? new Date(s.endedAt) - new Date(s.startedAt) : 0;
  const groups = Object.entries(vol.groups || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  // The muscles this workout trained, in the shared weekly rows (this calendar week, logged + planned).
  const trained = UNIT_ORDER.filter(u => (vol.units?.[u] || 0) > 0);
  const weekRows = trained.length ? safe(() => weeklySetsHTML(weekSummaryFor(sessions, profile), profile, { only: trained }), '') : '';
  return `<div class="tr-summary">
    <div class="tr-sum-hero"><div class="tr-sum-ic">🔥</div><h2>Workout done</h2><div class="muted">${esc(s.title || '')}</div></div>
    <div class="tr-sum-stats">
      ${dur ? `<div><b>${Math.max(1, Math.round(dur / 60000))}</b><span>minutes</span></div>` : ''}
      <div><b>${vol.liftSets || 0}</b><span>sets</span></div>
      ${load ? `<div><b>${Math.round(load).toLocaleString()}</b><span>${esc(profile.units || 'lb')} lifted</span></div>` : ''}
      ${vol.cardioMin ? `<div><b>${Math.round(vol.cardioMin)}</b><span>cardio min</span></div>` : ''}
    </div>
    ${prs.length ? `<div class="section-title">🏆 New PRs</div><div class="tr-prs">${prs.map(r => `<div class="tr-pr"><b>${esc(exName(r.exId))}</b><span>${fmtNum(r.w)}×${r.r}${r.previous ? ` <span class="muted">(was ${fmtNum(r.previous.w)}×${r.previous.r})</span>` : ''}</span></div>`).join('')}</div>` : ''}
    ${groups.length ? `<div class="section-title">This session</div><div class="tr-sum-groups">${groups.map(([g, v]) => `<span class="badge">${esc(GROUPS[g]?.name || g)} <b>${fmtNum(v)}</b></span>`).join('')}</div>` : ''}
    ${weekRows ? `<div class="section-title">Your week now</div>${weekRows}
    <p class="tiny muted">The same rows as Plan › Week coverage and Body.</p>` : ''}
    ${cardioWeekLine(s, sessions, profile, vol)}
    <button type="button" class="btn btn-primary tr-big" data-sum-close>Nice</button>
  </div>`;
}

function cardioWeekLine(s, sessions, profile, vol) {
  const w = safe(() => cardioWeek(profile, sessions, { now: new Date() }), null);
  if (!w || !w.target || !(vol.cardioMin > 0 || w.done < w.target)) return '';
  const left = Math.max(0, w.target - w.done);
  return `<div class="section-title">Cardio this week</div>${muscleBar('🫀 Cardio (min)', w.done, { min: w.target, max: 0 })}
    <p class="small muted" style="margin-top:-2px">${left ? `${left} min to go for your ${w.target}-min target${w.planned ? ` (${w.planned} planned)` : ''}.` : `Weekly target of ${w.target} min done.`}</p>`;
}

function showSummary(s) {
  const ctx = CTX;
  const sessions = ctx.store.getSessions();
  const html = summaryHtml(s, sessions, ctx.store.getProfile());
  // Open after the nav render so a shell that closes sheets on nav doesn't eat it.
  setTimeout(() => openSheet(ctx, html, (el, close) => {
    el.querySelector('[data-sum-close]').onclick = () => { close(); closeSheet(ctx); };
  }), 60);
}

// ---------- bind ----------
export function bind(root, ctx, params = {}) {
  CTX = ctx;
  clearInterval(tickIv);
  if (S && S.startedAt && !S.endedAt) {
    tickIv = setInterval(() => {
      const el = document.querySelector('.tr-session [data-elapsed]');
      if (!el || !S || !S.startedAt) { clearInterval(tickIv); return; }
      el.textContent = fmtDuration(Date.now() - new Date(S.startedAt));
    }, 1000);
  }

  root.onclick = e => {
    if (!root.querySelector('.tr-session')) return;
    const el = e.target.closest('[data-s]'); if (!el || el.disabled) return;
    const a = el.dataset.s, i = Number(el.dataset.i), k = Number(el.dataset.k);
    const store = ctx.store;
    if (a === 'today') return ctx.nav('today');
    if (a === 'p-start') {
      const s = store.getSession(el.dataset.id); if (!s) return;
      if (!parkActiveSession(store, `"${s.title || 'Workout'}"`)) return;
      const now = new Date();
      Object.assign(s, { status: 'active', startedAt: now.toISOString(), endedAt: null, date: ds(now) });
      store.saveSession(s); store.setActiveSessionId(s.id); return ctx.nav('session', { id: s.id });
    }
    if (!S) return;
    const b = S.blocks[i];
    switch (a) {
      case 'check': toggleSet(root, i, k); break;
      case 'wdec': case 'winc': {
        const inp = root.querySelector(`.tr-set[data-i="${i}"][data-k="${k}"] [data-f="w"]`);
        const step = getEx(b.exId)?.step || 2.5;
        const v = Math.max(0, (num(inp.value) || 0) + (a === 'winc' ? step : -step));
        inp.value = Math.round(v * 100) / 100; inp.classList.remove('ghost');
        b.sets[k].w = num(inp.value);
        // carry the new weight to later untouched sets
        for (let q = k + 1; q < b.sets.length; q++) {
          if (b.sets[q].done || b.sets[q].w != null) break;
          const qi = root.querySelector(`.tr-set[data-i="${i}"][data-k="${q}"] [data-f="w"]`); if (qi) qi.value = inp.value;
        }
        saveLater(); break;
      }
      case 'hold': startHold(root, i, k); break;
      case 'add-set': {
        const last = b.sets[b.sets.length - 1];
        b.sets.push({ w: last?.w ?? null, r: null, done: false });
        saveNow(); redrawBlock(root, i); break;
      }
      case 'rm-set': {
        const idx = [...b.sets].reverse().findIndex(x => !x.done);
        if (idx < 0) { if (!confirm('Remove the last logged set?')) return; b.sets.pop(); }
        else b.sets.splice(b.sets.length - 1 - idx, 1);
        saveNow(); redrawBlock(root, i); break;
      }
      case 'info': showInfo(b.exId); break;
      case 'swap': doSwap(root, i); break;
      case 'menu': blockMenu(root, i); break;
      case 'unskip': b.skipped = false; saveNow(); redrawAll(root); break;
      case 'toggle': b.done = !b.done; if (b.kind === 'cardio' && b.done && b.calories == null) b.calories = safe(() => estimateCalories(b.modality, Number(b.minutes) || 0, b.intensity, store.getProfile().bodyweight || 165), null); saveNow(); redrawBlock(root, i); break;
      case 'rm-block': if (confirm('Remove this from the workout?')) { S.blocks.splice(i, 1); saveNow(); redrawAll(root); } break;
      case 'add-ex': {
        const profile = store.getProfile();
        addExerciseSheet(ctx, {
          equipment: sessionEquipment(profile, S), targets: S.targets || [], sculptGoals: profile.sculptGoals || [],
          exclude: S.blocks.filter(isLift).map(x => x.exId),
          onPick: id => {
            const out = safe(() => addExercise(S, id, { sessions: store.getSessions().filter(x => x.id !== S.id), now: new Date() }), null);
            if (!out) return;
            Object.assign(S, out); saveNow(); redrawAll(root);
            setTimeout(() => document.querySelector(`[data-blk="${S.blocks.length - 1}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 50);
          },
        });
        break;
      }
      case 'add-cardio': {
        const profile = store.getProfile();
        openSheet(ctx, `<div class="tr-sheet-h"><h3>Add cardio</h3></div>${cardioFormHtml({ minutes: 10, intensity: 'moderate' })}
          <div class="tr-sheet-actions"><button type="button" class="btn btn-primary tr-big" data-go>Add</button></div>`, (el, close) => {
          bindCardioForm(el);
          el.querySelector('[data-go]').onclick = () => {
            const blk = readCardioForm(el, profile.bodyweight);
            if (!blk.modality) return;
            S.blocks.push(blk); saveNow(); close(); redrawAll(root);
          };
        });
        break;
      }
      case 'trim': case 'trim-m': {   // §26: never removes a logged set
        const r = safe(() => trimSession(S, store.getProfile(), { sessions: store.getSessions().filter(x => x.id !== S.id), now: new Date(), muscles: a === 'trim-m' }), null);
        if (!r) break;
        Object.assign(S, { blocks: r.session.blocks, estMinutes: r.session.estMinutes });
        saveNow(); redrawAll(root); toast(ctx, r.msg); break;
      }
      case 'finish': finish(root); break;
      case 'close': saveNow(); ctx.nav('history'); break;
      case 'discard': {
        if (!confirm(S.status === 'done' ? 'Delete this workout permanently?' : 'Discard this workout? Logged sets will be lost.')) return;
        saveLater.flush();
        store.deleteSession(S.id);
        if (store.getActiveSession()?.id === S.id) store.setActiveSessionId(null);
        stopRest(ctx);
        S = null;
        ctx.nav('today');
        break;
      }
    }
  };

  root.oninput = e => {
    if (!S || !root.querySelector('.tr-session')) return;
    const t = e.target, f = t.dataset.f; if (!f) return;
    const i = Number(t.dataset.i), k = Number(t.dataset.k);
    const b = S.blocks[i];
    switch (f) {
      case 'w': case 'r': b.sets[k][f] = num(t.value); t.classList.remove('ghost'); break;
      case 'notes': S.notes = t.value; break;
      case 'c-min': b.minutes = num(t.value); break;
      case 'c-cal': b.calories = num(t.value); break;
      case 'c-dist': {
        const v = num(t.value);
        b.distance = v ? { value: v, unit: root.querySelector(`[data-f="c-unit"][data-i="${i}"]`)?.value || 'mi' } : null;
        break;
      }
      default: return;
    }
    saveLater();
  };

  root.onchange = e => {
    if (!S || !root.querySelector('.tr-session')) return;
    const t = e.target, f = t.dataset.f; if (!f) return;
    const i = Number(t.dataset.i);
    const b = S.blocks[i];
    switch (f) {
      case 'c-mod': b.modality = t.value; saveNow(); redrawBlock(root, i); break;
      case 'c-int': b.intensity = t.value; saveNow(); break;
      case 'c-unit': if (b.distance) { b.distance.unit = t.value; saveNow(); } break;
      case 'date':   // §24: a logged-after-the-fact session can be re-dated inside the retro window
        if (t.value && canLogPast(t.value)) { S.date = t.value; saveNow(); redrawHeader(root); }
        else if (t.value) { toast(CTX, 'Pick a day inside the last 60 days'); t.value = S.date; }
        break;
      case 'w': case 'r': saveNow(); break;
    }
  };

  // Enter on reps → mark the set done (fast logging from the keypad).
  root.onkeydown = e => {
    if (e.key !== 'Enter' || !S) return;
    const t = e.target;
    if (t.dataset?.f === 'r') { e.preventDefault(); t.blur(); toggleSet(root, Number(t.dataset.i), Number(t.dataset.k), true); }
  };
}
