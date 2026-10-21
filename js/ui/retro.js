// Logging a past day — the UI half (CONTRACT §24). The sheet that Plan's past-day cards and
// History's "Log a past workout" open, plus the retro class picker and cardio form. The pure
// helpers (how far back, the timestamps, stamping a session done) live in js/engine/retro.js and
// are re-exported here so screens have one import.
import { ds, addDays, fmtDay } from '../util.js';
import { CARDIO, cardioOptions } from '../data/cardio.js';
import { expandEquipment } from '../data/equipment.js';
import { esc, safe, openSheet, closeSheet, toast, cardioFormHtml, bindCardioForm, readCardioForm, intensityName } from './components.js';
import { renderClassPicker, bindClassPicker } from './classes.js';
import { RETRO_DAYS, retroFloor, canLogPast, isPastDate, retroReason, retroTimes, markLogged } from '../engine/retro.js';

export { RETRO_DAYS, retroFloor, canLogPast, isPastDate, retroReason, retroTimes, markLogged };

// Open the per-set logger on a session that is being written up after the fact: 'active' with
// startedAt null, which is what session.js shows a date field (not a running clock) for, and what
// its Finish stamps onto the session's own date.
export function startRetroLog(ctx, { date, title = 'Logged workout', location = null, blocks = [], targets = [], source = 'manual', minutes = null, rationale = [] }) {
  const store = ctx.store;
  const active = store.getActiveSession();
  if (active && active.status === 'active') {
    if (!confirm(`"${active.title || 'Workout'}" is in progress. Save it for later and log this instead?`)) return null;
    active.status = 'planned';
    store.saveSession(active);
  }
  const profile = store.getProfile();
  const s = {
    id: store.newSessionId(), date, status: 'active', startedAt: null, endedAt: null,
    location: location || profile.currentLocation || 'home', minutes, title, targets, source, blocks,
    rationale, notes: '',
  };
  store.saveSession(s);
  store.setActiveSessionId(s.id);
  ctx.nav('session', { id: s.id });
  return s;
}


// ---------------------------------------------------------------- the sheet
function loggedOn(store, date) {
  return safe(() => store.getSessions().filter(s => s.date === date && s.status !== 'planned'), []);
}
function missedOn(store, date) {
  return safe(() => store.getSessions().filter(s => s.date === date && s.status === 'planned'), []);
}
function lineSummary(s) {
  let sets = 0, cmin = 0; const names = [];
  for (const b of s.blocks || []) {
    if (b.kind === 'lift') sets += (b.sets || []).filter(x => x.done && x.r > 0).length;
    else if (b.kind === 'cardio') { cmin += Number(b.minutes) || 0; }
    else if (b.kind === 'class') { if (b.name && b.name !== s.title) names.push(b.name); cmin += Number(b.classify?.cardioMinutes ?? b.duration) || 0; }
  }
  return [sets ? `${sets} sets` : '', cmin ? `${Math.round(cmin)} min cardio` : '', ...names].filter(Boolean).join(' · ')
    || (s.status === 'active' ? 'Still open' : 'Logged');
}

function sheetHtml(ctx, date, { pickDate = false } = {}) {
  const store = ctx.store;
  const logged = loggedOn(store, date);
  const missed = missedOn(store, date);
  const today = ds();
  const acts = [
    ['class', '🎟️', 'Log a class'],
    ['build', '🏋️', 'Build what I did'],
    ['free', '📝', 'Log exercises freely'],
    ['cardio', '🏃', 'Log cardio'],
    missed.length ? ['rest', '🌙', 'It was a rest day'] : null,
  ].filter(Boolean);
  return `<div class="pl-sheet rt-sheet">
    <div class="tiny muted bold pl-kicker">${date === today ? 'Log today' : 'Log a past day'}</div>
    <h2>${esc(fmtDay(date))}</h2>
    ${pickDate ? `<label class="tr-field"><span class="tr-label">Which day?</span>
      <input type="date" value="${esc(date)}" min="${retroFloor()}" max="${today}" data-rt-date></label>` : ''}
    <p class="muted small">What did you actually do? It is logged as <b>done on that day</b>, so it counts toward that
      week's volume and cardio — not today's.</p>
    ${logged.length ? `<div class="list mt">${logged.map(s => `<button type="button" class="list-item" data-rt-open="${esc(s.id)}">
      <span class="ic">${s.status === 'active' ? '●' : '✓'}</span><span class="grow"><span class="t">${esc(s.title || 'Workout')}</span>
      <span class="s">${esc(lineSummary(s))} · tap to edit or delete</span></span><span class="chev">›</span></button>`).join('')}</div>` : ''}
    ${missed.length && !logged.length ? `<p class="muted small">Planned but never logged: <b>${esc(missed.map(s => s.title || 'Workout').join(', '))}</b>.</p>` : ''}
    <div class="pl-acts">${acts.map(([id, ic, label]) => `<button type="button" class="pl-act" data-rt-act="${id}"><span>${ic}</span>${esc(label)}</button>`).join('')}</div>
  </div>`;
}

export function openRetroSheet(ctx, date = null) {
  const today = ds();
  let d = canLogPast(date) ? date : ds(addDays(new Date(), -1));
  const pickDate = !canLogPast(date);
  const open = () => openSheet(ctx, sheetHtml(ctx, d, { pickDate }), (el, close) => {
    el.querySelector('[data-rt-date]')?.addEventListener('change', e => {
      const v = e.target.value;
      if (canLogPast(v)) { d = v; close(); setTimeout(open, 0); }
      else toast(ctx, `Pick a day between ${fmtDay(retroFloor())} and ${fmtDay(today)}`);
    });
    el.addEventListener('click', e => {
      const o = e.target.closest('[data-rt-open]');
      if (o) { close(); closeSheet(ctx); ctx.nav('session', { id: o.dataset.rtOpen }); return; }
      const a = e.target.closest('[data-rt-act]');
      if (!a) return;
      const act = a.dataset.rtAct;
      if (act === 'class') { close(); setTimeout(() => openRetroClasses(ctx, d), 0); return; }
      if (act === 'build') { close(); closeSheet(ctx); ctx.nav('today', { date: d }); return; }
      if (act === 'free') {
        close(); closeSheet(ctx);
        startRetroLog(ctx, { date: d, title: 'Logged workout' });
        return;
      }
      if (act === 'cardio') { close(); setTimeout(() => openRetroCardio(ctx, d), 0); return; }
      if (act === 'rest') {
        missedOn(ctx.store, d).forEach(s => ctx.store.deleteSession(s.id));
        close(); closeSheet(ctx);
        toast(ctx, `${fmtDay(d)} logged as a rest day`);
        safe(() => ctx.rerender(), null);
      }
    });
  });
  open();
}

// The class picker for a day in the past: it shows that day's actual schedule when we cached it,
// and otherwise falls back to the class catalogue (classes.js / classify.js).
export function openRetroClasses(ctx, date) {
  openSheet(ctx, '<div data-classes></div>', (el, close) => {
    const wctx = { ...ctx, nav: (r, p) => { close(); closeSheet(ctx); ctx.nav(r, p); } };
    const host = el.querySelector('[data-classes]') || el;
    host.innerHTML = safe(() => renderClassPicker(wctx, { date }), '<div class="empty muted">Class schedule unavailable.</div>');
    safe(() => bindClassPicker(host, wctx), null);
  });
}

export function openRetroCardio(ctx, date) {
  const store = ctx.store;
  const profile = store.getProfile();
  const loc = (profile.locations || []).find(l => l.id === profile.currentLocation) || (profile.locations || [])[0] || { id: 'home', equipment: ['bodyweight'] };
  let opts = safe(() => cardioOptions(expandEquipment(loc.equipment || [])), []);
  if (!opts.length) opts = Object.values(CARDIO);
  const last = store.kv('lastCardio') || {};
  const html = `<div class="pl-sheet rt-sheet"><div class="tiny muted bold pl-kicker">${esc(fmtDay(date))}</div><h2>Log cardio</h2>
    ${cardioFormHtml({ options: opts, modality: last.modality, minutes: last.minutes || 30, intensity: last.intensity || 'easy' })}
    <button type="button" class="btn btn-primary btn-block mt2" data-rt-save>✓ Log it on ${esc(fmtDay(date).split(',')[0])}</button></div>`;
  openSheet(ctx, html, (el, close) => {
    bindCardioForm(el);
    el.querySelector('[data-rt-save]').onclick = () => {
      const blk = readCardioForm(el, profile.bodyweight);
      if (!blk.modality || !blk.minutes) { toast(ctx, 'Pick a type and minutes'); return; }
      store.kv('lastCardio', { modality: blk.modality, minutes: blk.minutes, intensity: blk.intensity });
      const s = markLogged({
        id: store.newSessionId(), date, status: 'done', startedAt: null, endedAt: null, location: loc.id,
        minutes: blk.minutes, title: `${CARDIO[blk.modality]?.name || 'Cardio'} · ${blk.minutes} min`, targets: [],
        source: 'cardio', blocks: [blk], rationale: [`${intensityName(blk.intensity)} cardio, logged after the fact`], notes: '',
      });
      store.saveSession(s);
      close(); closeSheet(ctx);
      toast(ctx, `Logged ${s.title} on ${fmtDay(date)}`);
      safe(() => ctx.rerender(), null);
    };
  });
}
