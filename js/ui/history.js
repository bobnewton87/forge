// History tab: calendar strip + reverse-chronological session list + detail sheet (UI-SHELL).
import * as prog from '../engine/progression.js';
import { getEx } from '../data/exercises.js';
import { CARDIO, INTENSITIES } from '../data/cardio.js';
import { esc } from './components.js';
import { ds, parseDs, addDays, weekStart, fmtShort, fmtDay, daysBetween } from '../util.js';

const WEEKS = 6;
let selDay = null;   // filter list to one day (module state persists across re-renders)

const f1 = n => { n = Number(n) || 0; return Math.round(n) === n ? String(n) : n.toFixed(1); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function summarize(s) {
  const blocks = s.blocks || [];
  let sets = 0, cardioMin = 0; const classes = [], cardio = [];
  for (const b of blocks) {
    if (b.kind === 'lift') sets += (b.sets || []).filter(x => x.done && x.r > 0).length;
    else if (b.kind === 'cardio') { if (b.done !== false || s.status === 'done') { cardioMin += Number(b.minutes) || 0; cardio.push(b.modality); } }
    else if (b.kind === 'class') { classes.push(b.name); cardioMin += Number(b.classify?.cardioMinutes ?? b.duration) || 0; }
  }
  let dur = null;
  if (s.startedAt && s.endedAt) { const m = Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000); if (m > 0 && m < 600) dur = m; }
  const kinds = { lift: sets > 0, cardio: cardio.length > 0, class: classes.length > 0 };
  return { sets, cardioMin: Math.round(cardioMin), classes, cardio, dur: dur ?? (s.status === 'done' ? s.minutes : null), kinds };
}
const KIND_COL = { lift: 'var(--accent)', cardio: 'var(--cardio)', class: 'var(--accent2)' };

function locOf(ctx, id) { return (ctx.store.getProfile().locations || []).find(l => l.id === id) || { name: id || '—', icon: '📍' }; }

function setsText(sets, ex) {
  const done = (sets || []).filter(x => x.done && x.r > 0);
  if (!done.length) return '';
  try { if (prog.formatSets) return prog.formatSets(done, ex?.unit); } catch (e) { /* fall through */ }
  return done.map(x => (x.w ? f1(x.w) + '×' : '') + x.r).join(', ');
}

function sessionCard(ctx, s) {
  const sm = summarize(s); const loc = locOf(ctx, s.location); const d = parseDs(s.date);
  const meta = [
    `<span class="badge">${esc(loc.icon || '')} ${esc(loc.name)}</span>`,
    sm.dur ? `<span class="badge">⏱ ${sm.dur} min</span>` : '',
    sm.sets ? `<span class="badge accent">${sm.sets} sets</span>` : '',
    sm.cardioMin ? `<span class="badge cardio">${sm.cardioMin} min cardio</span>` : '',
    ...sm.classes.map(c => `<span class="badge warn">${esc(c)}</span>`),
    s.status !== 'done' ? `<span class="badge ${s.status === 'active' ? 'good' : ''}">${s.status === 'active' ? 'In progress' : 'Planned'}</span>` : '',
  ].join('');
  return `<button class="card tap tight sess" data-sid="${esc(s.id)}" style="width:100%;text-align:left">
    <div class="date"><div class="dw">${DOW[d.getDay()]}</div><div class="dd">${d.getDate()}</div></div>
    <div class="grow"><div class="bold ellipsis">${esc(s.title || 'Workout')}</div><div class="meta">${meta}</div></div></button>`;
}

function calendar(sessions) {
  const today = new Date(); const t = ds(today);
  const start = addDays(weekStart(today), -7 * (WEEKS - 1));
  const byDay = {};
  for (const s of sessions) { const k = summarize(s).kinds; const e = byDay[s.date] || (byDay[s.date] = {}); for (const x in k) if (k[x]) e[x] = true; if (!Object.values(k).some(Boolean)) e.other = true; }
  let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<div class="dh">${x}</div>`).join('');
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = addDays(start, i); const k = ds(d); const e = byDay[k];
    const dots = e ? Object.keys(KIND_COL).filter(x => e[x]).map(x => `<i style="background:${KIND_COL[x]}"></i>`).join('') || '<i style="background:var(--muted)"></i>' : '';
    cells += `<button class="d ${e ? 'has' : ''} ${k === t ? 'today' : ''} ${k === selDay ? 'sel' : ''} ${k > t ? 'future' : ''}" data-day="${k}" aria-label="${fmtDay(k)}"><span>${d.getDate()}</span><span class="dots">${dots}</span></button>`;
  }
  return `<div class="card"><div class="row between mb"><div class="card-title">${fmtShort(start)} – ${fmtShort(addDays(start, WEEKS * 7 - 1))}</div>
    <div class="legend" style="margin:0">${Object.entries(KIND_COL).map(([k, c]) => `<span><i class="dot-i" style="background:${c}"></i>${k === 'lift' ? 'Lift' : k === 'cardio' ? 'Cardio' : 'Class'}</span>`).join('')}</div></div>
    <div class="cal">${cells}</div></div>`;
}

function weekLabel(ws) {
  const cur = weekStart(new Date()); const diff = Math.round(daysBetween(ws, cur) / 7);
  if (diff === 0) return 'This week'; if (diff === 1) return 'Last week';
  return `${fmtShort(ws)} – ${fmtShort(addDays(ws, 6))}`;
}

export function render(ctx) {
  // History = done + active sessions. Planned (future) sessions live in the Plan tab (UI-PLAN).
  const all = (() => { try { return ctx.store.getSessions().filter(s => s.status !== 'planned'); } catch (e) { return []; } })();
  if (!all.length) {
    return `<div class="page-head"><h1>History</h1></div><div class="card"><div class="empty"><div class="big">📅</div><h3>No workouts yet</h3><p>Finish a workout or import your Iron Runner history.</p>
      <div class="btn-row"><button class="btn btn-primary" data-nav="today">Start one</button><button class="btn" data-nav="import">Import</button></div></div></div>`;
  }
  const list = [...all].reverse().filter(s => !selDay || s.date === selDay);
  const done = all.filter(s => s.status === 'done');
  const last30 = done.filter(s => daysBetween(s.date, new Date()) < 30);
  let html = `<div class="page-head"><h1>History</h1><p class="sub">${done.length} workouts logged · ${last30.length} in the last 30 days</p></div>${calendar(all)}`;
  if (selDay) html += `<div class="row between" style="margin:18px 4px 10px"><div class="section-title" style="margin:0">${fmtDay(selDay)}</div><button class="chip sm" data-clear>Show all ✕</button></div>`;
  if (!list.length) html += `<div class="card"><div class="empty" style="padding:18px"><p>Nothing logged on this day.</p><button class="btn btn-sm" data-nav="today">Plan a workout</button></div></div>`;
  let curW = null;
  for (const s of list) {
    if (!selDay) { const w = ds(weekStart(parseDs(s.date))); if (w !== curW) { curW = w; html += `<div class="section-title">${weekLabel(parseDs(w))}</div>`; } }
    html += sessionCard(ctx, s);
  }
  return html;
}

function blockHtml(b) {
  if (b.kind === 'lift') {
    const ex = getEx(b.exId);
    const sets = (b.sets || []);
    return `<div class="list-item" style="align-items:flex-start"><div class="grow"><div class="t">${esc(ex?.name || b.exId)}</div>
      <div class="setline">${sets.length ? sets.map(x => `<span class="${x.done && x.r > 0 ? '' : 'nd'}">${x.w ? f1(x.w) + '×' : ''}${x.r ?? '–'}${ex?.unit === 'seconds' ? 's' : ''}</span>`).join('') : '<span class="nd">no sets</span>'}</div></div></div>`;
  }
  if (b.kind === 'cardio') {
    const c = CARDIO[b.modality];
    return `<div class="list-item"><span class="ic">${esc(c?.icon || '🏃')}</span><div class="grow"><div class="t">${esc(c?.name || b.modality)} · ${b.minutes || 0} min</div>
      <div class="s">${esc(INTENSITIES[b.intensity]?.name || b.intensity || '')}${b.distance?.value ? ` · ${b.distance.value} ${esc(b.distance.unit || '')}` : ''}${b.calories ? ` · ${b.calories} kcal` : ''}${b.note ? ' · ' + esc(b.note) : ''}</div></div></div>`;
  }
  if (b.kind === 'class') {
    return `<div class="list-item"><span class="ic">🎟️</span><div class="grow"><div class="t">${esc(b.name)}</div><div class="s">${b.duration || ''} min${b.time ? ' · ' + esc(b.time) : ''}${b.instructor ? ' · ' + esc(b.instructor) : ''}${b.classify?.label ? ' · ' + esc(b.classify.label) : ''}</div></div></div>`;
  }
  return '';
}

export function repeatSession(store, s, date = ds()) {
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = store.newSessionId(); copy.date = date; copy.status = 'planned';
  copy.startedAt = null; copy.endedAt = null; copy.notes = '';
  copy.source = s.source === 'import' ? 'manual' : s.source;
  copy.rationale = [`Repeat of ${fmtDay(s.date)}`];
  for (const b of copy.blocks || []) {
    if (b.kind === 'lift') {
      const done = (b.sets || []).filter(x => x.done && x.r > 0);
      const ws = done.map(x => x.w).filter(w => w != null);
      b.target = { ...(b.target || {}), sets: Math.max(1, (b.sets || []).length || b.target?.sets || 3), weight: ws.length ? Math.max(...ws) : (b.target?.weight ?? null) };
      b.sets = Array.from({ length: b.target.sets }, () => ({ w: null, r: null, done: false }));
    } else b.done = false;
  }
  store.saveSession(copy);
  return copy;
}

export function detailSheet(ctx, id) {
  const s = ctx.store.getSession(id); if (!s) return;
  const sm = summarize(s); const loc = locOf(ctx, s.location);
  ctx.openSheet(`<div class="tiny muted bold" style="letter-spacing:.08em;text-transform:uppercase">${fmtDay(s.date)}</div><h2>${esc(s.title || 'Workout')}</h2>
    <div class="meta row wrap mt" style="gap:6px"><span class="badge">${esc(loc.icon || '')} ${esc(loc.name)}</span>${sm.dur ? `<span class="badge">⏱ ${sm.dur} min</span>` : ''}${sm.sets ? `<span class="badge accent">${sm.sets} sets</span>` : ''}${sm.cardioMin ? `<span class="badge cardio">${sm.cardioMin} min cardio</span>` : ''}${s.source === 'import' ? '<span class="badge">Imported</span>' : ''}</div>
    <div class="list mt">${(s.blocks || []).map(blockHtml).join('') || '<div class="list-item muted">No exercises</div>'}</div>
    ${s.notes ? `<div class="card flat"><div class="label">Notes</div><p class="mt" style="margin-top:4px">${esc(s.notes)}</p></div>` : ''}
    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-repeat>↻ Repeat this workout today</button>
      <div class="btn-row"><button class="btn" data-edit>Edit</button><button class="btn btn-danger" data-del>Delete</button></div>
    </div>`, (el, close) => {
    el.querySelector('[data-edit]').onclick = () => { close(); ctx.nav('session', { id: s.id }); };
    el.querySelector('[data-repeat]').onclick = () => { const c = repeatSession(ctx.store, s); close(); ctx.toast('Planned for today'); ctx.nav('session', { id: c.id }); };
    const del = el.querySelector('[data-del]');
    del.onclick = () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
      ctx.store.deleteSession(s.id); close(); ctx.toast('Workout deleted');
    };
  });
}

export function bind(root, ctx) {
  root.querySelectorAll('[data-sid]').forEach(b => b.onclick = () => detailSheet(ctx, b.dataset.sid));
  root.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { selDay = selDay === b.dataset.day ? null : b.dataset.day; ctx.rerender(); });
  root.querySelector('[data-clear]')?.addEventListener('click', () => { selDay = null; ctx.rerender(); });
  root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => ctx.nav(b.dataset.nav));
}
