// Shared UI components (UI-TRAIN). Used by today/session and by UI-SHELL / CLASSES screens.
// CONTRACT-NOTE: besides the 5 contract exports this module exports small helpers
// (sheet/toast/rest fallbacks, name/unit formatters, debounce). The fallbacks are only used
// when ctx.openSheet / ctx.toast / ctx.timer are missing or still the empty stubs.
import { EQUIPMENT } from '../data/equipment.js';
import { REGIONS, GROUPS, PRESETS } from '../data/muscles.js';
import { SCULPT_GOALS } from '../data/sculpt.js';
import { getEx, EXERCISES } from '../data/exercises.js';
import { expandEquipment, canDo } from '../data/equipment.js';
import { CARDIO, INTENSITIES, estimateCalories } from '../data/cardio.js';
import { exercisesFor, alternatives } from '../engine/generator.js';
import { GROUP_ORDER } from '../data/muscles.js';
// CONTRACT-NOTE (§26): addExerciseSheet / swapSheet read the active issues from ctx.store's profile: the
//   suggested lists leave out what an issue rules out (with a "N hidden" note naming the issue); search
//   still finds everything, marking those moves "⚠ loads your …" (an explicit pick is the user's call).
import { activeIssues, issueFilter, issueLabel, sideOnlyLabel } from '../engine/issues.js';
import { ds } from '../util.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function chip(label, { active = false, attrs = '', cls = '' } = {}) {
  return `<button type="button" class="chip ${active ? 'active' : ''} ${cls}" ${attrs}>${esc(label)}</button>`;
}

// readiness 0..1 (1 = recovered), need 0..1 (1 = big weekly deficit) → CSS colour var.
export function readinessColor(readiness = 1, need = 0) {
  if (readiness == null) readiness = 1;
  if (need == null) need = 0;
  if (readiness < 0.5) return 'var(--bad)';
  if (readiness < 0.8) return 'var(--warn)';
  if (need >= 0.5) return 'var(--good)';
  if (need >= 0.2) return 'var(--accent)';
  return 'var(--muted)';
}

export function readinessLabel(readiness = 1, need = 0) {
  if (readiness == null) readiness = 1;   // same null handling as readinessColor (null read as 'fully recovered')
  if (need == null) need = 0;
  if (readiness < 0.5) return 'Recovering';
  if (readiness < 0.8) return 'Almost ready';
  if (need >= 0.5) return 'Needs work';
  if (need >= 0.2) return 'Ready';
  return 'On track';
}

export function exerciseCard(ex, { compact = false, attrs = '', cls = '' } = {}) {
  if (!ex) return '';
  const eq = (ex.equipment || []).map(id => EQUIPMENT[id]?.name || id.replace(/_/g, ' '));
  const mus = Object.entries(ex.muscles || {}).sort((a, b) => b[1] - a[1]).slice(0, compact ? 2 : 4)
    .map(([r, w]) => `<span class="${w >= 0.75 ? 'ex-mus-main' : ''}">${esc(REGIONS[r]?.name || r)}</span>`);
  const emph = (ex.emphasis || []).map(t => Object.values(SCULPT_GOALS).find(g => g.emphasisTag === t || g.id === t)?.name || t);
  return `<div class="ex-card ${compact ? 'compact' : ''} ${cls}" ${attrs}>
    <div class="ex-card-name">${esc(ex.name)}</div>
    <div class="ex-card-meta">${esc(eq.length ? eq.join(' · ') : 'Bodyweight')}</div>
    <div class="ex-card-mus">${mus.join('')}</div>
    ${emph.length ? `<div class="ex-card-emph">${emph.map(e => `<span class="badge">${esc(e)}</span>`).join('')}</div>` : ''}
    ${!compact && ex.why ? `<div class="ex-card-why muted">${esc(ex.why)}</div>` : ''}
  </div>`;
}

export function muscleBar(label, sets = 0, target = { min: 10, max: 20 }) {
  const t = target || { min: 10, max: 20 };
  const max = Math.max(t.max || t.min || 1, 1);
  const pct = Math.min(100, (sets / max) * 100);
  const minPct = Math.min(100, ((t.min || 0) / max) * 100);
  const col = sets >= (t.min || 0) ? 'var(--good)' : sets >= (t.min || 0) * 0.5 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="mbar">
    <div class="mbar-top"><span>${esc(label)}</span><span class="mbar-num">${fmtNum(sets)}<span class="muted">/${t.min != null ? Math.round(t.min) : '?'}${t.max ? '–' + Math.round(t.max) : ''}</span></span></div>
    <div class="mbar-track"><div class="mbar-fill" style="width:${pct}%;background:${col}"></div><div class="mbar-min" style="left:${minPct}%"></div></div>
  </div>`;
}

// ---------- helpers ----------
export function fmtNum(n, dp = 1) {
  if (n == null || n === '' || isNaN(n)) return '–';
  const f = Math.round(Number(n) * 10 ** dp) / 10 ** dp;
  return String(f);
}
export function exName(id) { return getEx(id)?.name || String(id || '').replace(/_/g, ' '); }
export function targetName(id) {
  return GROUPS[id]?.name || PRESETS[id]?.name || SCULPT_GOALS[id]?.name || REGIONS[id]?.name || String(id).replace(/_/g, ' ');
}
export function unitLabel(ex, units = 'lb') {
  const u = units || 'lb';
  switch (ex?.unit) {
    case 'each': return `${u} each`;
    case 'total': return `${u} total`;
    case 'bodyweight': return `+${u}`;
    case 'seconds': return 'sec';
    default: return u;
  }
}
export function debounce(fn, ms = 400) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  return d;
}
export function fmtDuration(ms) {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

// Is this ctx function a real implementation (not missing / the empty stub)?
function isReal(fn) {
  if (typeof fn !== 'function') return false;
  const src = Function.prototype.toString.call(fn).replace(/\s+/g, '');
  return !/^(function)?\w*\([^)]*\)\{\}$/.test(src) && !/^\([^)]*\)=>\{\}$/.test(src);
}

let fallbackClose = null;
// Opens a bottom sheet via ctx.openSheet, or a local fallback overlay.
export function openSheet(ctx, html, bindFn = () => {}) {
  if (ctx && isReal(ctx.openSheet)) { ctx.openSheet(html, bindFn); return; }
  closeFallbackSheet();
  const wrap = document.createElement('div');
  wrap.className = 'tr-sheet-wrap';
  wrap.innerHTML = `<div class="tr-sheet" role="dialog"><div class="tr-sheet-grab"></div><div class="tr-sheet-body">${html}</div></div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('tr-noscroll');
  const close = () => { wrap.remove(); document.body.classList.remove('tr-noscroll'); if (fallbackClose === close) fallbackClose = null; };
  fallbackClose = close;
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  bindFn(wrap.querySelector('.tr-sheet-body'), close);
}
export function closeFallbackSheet() { if (fallbackClose) fallbackClose(); }
export function closeSheet(ctx) {
  closeFallbackSheet();
  if (ctx && isReal(ctx.closeSheet)) ctx.closeSheet();
}

export function toast(ctx, msg) {
  if (ctx && isReal(ctx.toast)) { ctx.toast(msg); return; }
  if (typeof document === 'undefined') return;
  let el = document.querySelector('.tr-toast');
  if (!el) { el = document.createElement('div'); el.className = 'tr-toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

let restIv = null;
export function startRest(ctx, sec) {
  const s = Number(sec) || 0;
  if (s <= 0) return;
  if (ctx?.timer && isReal(ctx.timer.start)) { ctx.timer.start(s); return; }
  // Minimal fallback banner.
  stopRest(ctx);
  const el = document.createElement('div');
  el.className = 'tr-rest';
  const end = Date.now() + s * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    el.innerHTML = `<span>Rest</span><b>${fmtDuration(left * 1000)}</b><button type="button">Skip</button>`;
    el.querySelector('button').onclick = () => stopRest(ctx);
    if (left <= 0) { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); stopRest(ctx); }
  };
  document.body.appendChild(el);
  tick();
  restIv = setInterval(tick, 500);
}
export function stopRest(ctx) {
  if (ctx?.timer && isReal(ctx.timer.stop) && !restIv) { ctx.timer.stop(); return; }
  clearInterval(restIv); restIv = null;
  document.querySelectorAll('.tr-rest').forEach(e => e.remove());
}

// Exercise info sheet content: cues, why, YouTube link.
export function exerciseInfoHtml(ex) {
  if (!ex) return '<div class="empty">Exercise not found</div>';
  return `<div class="tr-info">
    <h3>${esc(ex.name)}</h3>
    ${exerciseCard(ex, { compact: false, cls: 'flat' })}
    ${(ex.cues || []).length ? `<div class="section-title">Form cues</div><ul class="tr-cues">${ex.cues.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <div class="tr-info-actions">
      ${ex.yt ? `<a class="btn btn-primary" href="${esc(ex.yt)}" target="_blank" rel="noopener">▶ Watch form</a>` : ''}
      <button type="button" class="btn btn-ghost" data-info-lib="${esc(ex.id)}">Open in library</button>
    </div>
  </div>`;
}

// A new session is about to become the active one. If a workout is genuinely in progress, ask first
// and park it as 'planned' (so it shows up under "Saved for later" on the Workout screen) instead of
// silently orphaning it: an 'active' session that nothing points at is invisible everywhere but
// History. Returns false when the user says no — the caller must then do nothing.
// `what` names the thing being started, for the prompt.
export function parkActiveSession(store, what = 'this') {
  const active = safe(() => store.getActiveSession(), null);
  if (!active || active.status !== 'active') return true;
  const q = `"${active.title || 'Workout'}" is in progress. Save it for later and start ${what} instead?`;
  if (typeof confirm === 'function' && !confirm(q)) return false;
  active.status = 'planned';
  store.saveSession(active);
  store.setActiveSessionId(null);
  return true;
}

// Run an engine call defensively — engines are rewritten concurrently.
export function safe(fn, fallback) {
  try { const v = fn(); return v == null ? fallback : v; } catch (e) { console.error('[forge]', e); return fallback; }
}

function groupOfTarget(t) {
  if (GROUPS[t]) return t;
  if (PRESETS[t]) return PRESETS[t].groups[0];
  if (SCULPT_GOALS[t]) return SCULPT_GOALS[t].group;
  if (REGIONS[t]) return REGIONS[t].group;
  return null;
}

function exPickList(list, exclude = [], IF = null, hidden = 0) {
  const note = hidden && IF ? `<p class="tiny muted is-hidden">${hidden} more hidden: ${hidden === 1 ? 'it loads' : 'they load'} your ${esc([...new Set(IF.issues.map(x => issueLabel(x).toLowerCase()))].join(' / '))}. Search to see everything.</p>` : '';
  if (!list.length) return (note || '') + '<div class="empty muted">No matching exercises for this equipment.</div>';
  return note + list.slice(0, 40).map(ex => {
    const why = IF && IF.blocked.has(ex.id) ? IF.why(ex.id) : null;
    const one = IF && IF.side.has(ex.id) ? sideOnlyLabel(IF.side.get(ex.id), ex) : '';
    return `<button type="button" class="tr-pick" data-pick="${esc(ex.id)}" ${exclude.includes(ex.id) ? 'data-dup="1"' : ''}>
      ${exerciseCard(ex, { compact: true })}${why ? `<span class="badge warn is-loads">⚠ loads your ${esc(issueLabel(why).toLowerCase())}</span>` : one ? `<span class="badge warn is-loads">${esc(one)}</span>` : ''}<span class="tr-pick-plus">${exclude.includes(ex.id) ? '✓' : '+'}</span></button>`;
  }).join('');
}
// §26: the active issues of the profile behind this sheet ([] when there's no store, e.g. a test ctx).
function issuesOf(ctx) { return safe(() => activeIssues(ctx?.store?.getProfile?.() || {}, ds()), []); }

function searchAll(q, eqSet) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return EXERCISES.filter(e => safe(() => canDo(e, eqSet), true) && words.every(w => (e.name + ' ' + (e.pattern || '') + ' ' + Object.keys(e.muscles || {}).join(' ')).toLowerCase().includes(w)));
}

// Sheet: pick an exercise to add. onPick(exId) is called and the sheet closes.
export function addExerciseSheet(ctx, { equipment = [], targets = [], sculptGoals = [], exclude = [], onPick, title = 'Add exercise' } = {}) {
  const eqSet = safe(() => expandEquipment(equipment), new Set(['bodyweight']));
  let cur = targets.map(groupOfTarget).find(Boolean) || 'chest';
  const issues = issuesOf(ctx), IF = issueFilter(issues);
  const listHtml = g => {
    const all = safe(() => exercisesFor(g, eqSet, { sculptGoals }), []);
    const ok = safe(() => exercisesFor(g, eqSet, { sculptGoals, issues }), all);
    return exPickList(ok, exclude, IF, all.length - ok.length);
  };
  const html = `<div class="tr-sheet-h"><h3>${esc(title)}</h3></div>
    <input class="tr-search" type="search" placeholder="Search exercises…" data-q>
    <div class="tr-chiprow scroll" data-groups>${GROUP_ORDER.map(g => chip(GROUPS[g]?.name || g, { active: g === cur, attrs: `data-g="${g}"` })).join('')}</div>
    <div class="tr-picklist" data-list>${listHtml(cur)}</div>`;
  openSheet(ctx, html, (el, close) => {
    const listEl = el.querySelector('[data-list]');
    const q = el.querySelector('[data-q]');
    el.querySelector('[data-groups]').onclick = e => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      cur = b.dataset.g; q.value = '';
      el.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('active', x === b));
      listEl.innerHTML = listHtml(cur);
    };
    q.oninput = () => { listEl.innerHTML = q.value.trim() ? exPickList(searchAll(q.value.trim(), eqSet), exclude, IF) : listHtml(cur); };
    listEl.onclick = e => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      close(); onPick && onPick(b.dataset.pick);
    };
  });
}

// Sheet: swap an exercise for an alternative with the same main muscles.
export function swapSheet(ctx, { exId, equipment = [], exclude = [], onPick } = {}) {
  const eqSet = safe(() => expandEquipment(equipment), new Set(['bodyweight']));
  const issues = issuesOf(ctx), IF = issueFilter(issues);
  const alts = safe(() => alternatives(exId, { equipment: [...eqSet], exclude: [exId, ...exclude], limit: 12, issues }), []);
  const hidden = IF.any ? safe(() => alternatives(exId, { equipment: [...eqSet], exclude: [exId, ...exclude], limit: 12 }).filter(e => IF.blocked.has(e.id)).length, 0) : 0;
  const html = `<div class="tr-sheet-h"><h3>Swap ${esc(exName(exId))}</h3><div class="muted small">Same muscles, your equipment${IF.any ? ', sparing what hurts' : ''}</div></div>
    <input class="tr-search" type="search" placeholder="Or search any exercise…" data-q>
    <div class="tr-picklist" data-list>${exPickList(alts, [], IF, hidden)}</div>`;
  openSheet(ctx, html, (el, close) => {
    const listEl = el.querySelector('[data-list]');
    const q = el.querySelector('[data-q]');
    q.oninput = () => { listEl.innerHTML = q.value.trim() ? exPickList(searchAll(q.value.trim(), eqSet).filter(e => e.id !== exId), [], IF) : exPickList(alts, [], IF, hidden); };
    listEl.onclick = e => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      close(); onPick && onPick(b.dataset.pick);
    };
  });
}

// Cardio form (modality, minutes, intensity, distance, calories). Use readCardioForm(el) to read.
export function cardioFormHtml({ options = null, modality = null, minutes = 30, intensity = 'easy', calories = true } = {}) {
  const opts = (options && options.length ? options : Object.values(CARDIO));
  const mod = modality && opts.find(o => o.id === modality) ? modality : opts[0]?.id;
  return `<div class="tr-cf" data-cf data-mod="${esc(mod || '')}" data-int="${esc(intensity)}">
    <div class="tr-label">Type</div>
    <div class="tr-chiprow wrap">${opts.map(o => chip(`${o.icon || ''} ${o.name}`, { active: o.id === mod, attrs: `data-cf-mod="${esc(o.id)}"` })).join('')}</div>
    <div class="tr-label">Minutes</div>
    <div class="tr-chiprow wrap">${[10, 15, 20, 30, 45, 60].map(m => chip(String(m), { active: m === minutes, attrs: `data-cf-min="${m}"` })).join('')}
      <input class="tr-num-sm" type="number" inputmode="numeric" min="1" value="${minutes}" data-cf-minutes aria-label="Minutes"></div>
    <div class="tr-label">Intensity</div>
    <div class="tr-chiprow wrap">${Object.entries(INTENSITIES).map(([id, it]) => chip(it.name, { active: id === intensity, attrs: `data-cf-int="${id}"` })).join('')}</div>
    <div class="tr-cf-grid">
      <label><span class="tr-label">Distance (optional)</span><span class="tr-inline"><input type="number" inputmode="decimal" step="any" data-cf-dist placeholder="—"><select data-cf-unit><option value="mi">mi</option><option value="km">km</option></select></span></label>
      ${calories ? '<label><span class="tr-label">Calories</span><input type="number" inputmode="numeric" data-cf-cal placeholder="auto"></label>' : ''}
    </div>
  </div>`;
}
export function bindCardioForm(el) {
  const f = el.querySelector('[data-cf]'); if (!f) return;
  f.addEventListener('click', e => {
    const m = e.target.closest('[data-cf-mod]'), mi = e.target.closest('[data-cf-min]'), it = e.target.closest('[data-cf-int]');
    if (m) { f.dataset.mod = m.dataset.cfMod; f.querySelectorAll('[data-cf-mod]').forEach(x => x.classList.toggle('active', x === m)); }
    if (mi) { f.querySelector('[data-cf-minutes]').value = mi.dataset.cfMin; f.querySelectorAll('[data-cf-min]').forEach(x => x.classList.toggle('active', x === mi)); }
    if (it) { f.dataset.int = it.dataset.cfInt; f.querySelectorAll('[data-cf-int]').forEach(x => x.classList.toggle('active', x === it)); }
  });
  f.querySelector('[data-cf-minutes]').addEventListener('input', () => f.querySelectorAll('[data-cf-min]').forEach(x => x.classList.toggle('active', x.dataset.cfMin === f.querySelector('[data-cf-minutes]').value)));
}
export function readCardioForm(el, bodyweight) {
  const f = el.querySelector('[data-cf]');
  const num = sel => { const v = parseFloat(f.querySelector(sel)?.value); return isNaN(v) ? null : v; };
  const modality = f.dataset.mod, minutes = num('[data-cf-minutes]') || 0, intensity = f.dataset.int || 'easy';
  const dist = num('[data-cf-dist]');
  let calories = num('[data-cf-cal]');
  if (calories == null && minutes) calories = safe(() => estimateCalories(modality, minutes, intensity, bodyweight || 165), null);
  return { kind: 'cardio', modality, minutes, intensity, distance: dist ? { value: dist, unit: f.querySelector('[data-cf-unit]').value } : null, calories: calories || null, done: false, note: null };
}
export function cardioName(id) { const c = CARDIO[id]; return c ? `${c.icon || ''} ${c.name}`.trim() : String(id || 'Cardio'); }
export function intensityName(id) { return INTENSITIES[id]?.name || id || ''; }
