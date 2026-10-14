// Class picker: Crunch Allen schedule (today + upcoming days) and a "log a different class"
// form. Picking a class creates a Session (source:'class') with a single class block.
//
// CONTRACT-NOTE: renderClassPicker is synchronous but the schedule loads async. The first
// render shows a loading placeholder; bindClassPicker() loads the schedule (cached in this
// module) and fills the container in place. date/minutes/targets are carried on the
// container's data-* attributes so bind() can use them.
// CONTRACT-NOTE: picking a class on a FUTURE day creates a 'planned' session (startedAt
// null, not set active). Same-day picks are 'active' with startedAt = now, per §6.
import { esc, chip } from './components.js';
import { loadSchedule } from '../classes/crunch.js';
import { classify, groupCredits, matchScore } from '../classes/classify.js';
import { ds, fmtDay } from '../util.js';

let cache = null;          // last loaded schedule
let cacheAt = 0;           // when cache was loaded (ms)
let loading = null;        // in-flight promise
const ui = { day: null };  // selected day (persists across re-renders)

const TYPE_STYLE = {
  hiit: ['HIIT', 'var(--bad)'], cycle: ['Cycle', 'var(--cardio)'], cardio_dance: ['Dance', 'var(--cardio)'],
  strength: ['Strength', 'var(--accent)'], sculpt: ['Sculpt', 'var(--accent)'], core: ['Core', 'var(--accent2)'],
  boxing: ['Boxing', 'var(--warn)'], yoga: ['Yoga', 'var(--good)'], pilates: ['Pilates', 'var(--accent2)'],
  stretch: ['Stretch', 'var(--good)'], other: ['Class', 'var(--muted)'],
};
const GROUP_NAME = {
  chest: 'Chest', back: 'Back', shoulders: 'Delts', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms',
  core: 'Abs', glutes: 'Glutes', quads: 'Quads', hamstrings: 'Hams', calves: 'Calves',
};

const STYLE = `<style>
.cls-wrap{display:flex;flex-direction:column;gap:10px}
.cls-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.cls-head h3{margin:0;font-size:17px;color:var(--text)}
.cls-sub{font-size:12px;color:var(--muted)}
.cls-days{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch}
.cls-days .chip{flex:0 0 auto}
.cls-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:6px}
.cls-card.cls-match{border-color:var(--good);box-shadow:0 0 0 1px var(--good) inset}
.cls-card.cls-past{opacity:.45}
.cls-row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.cls-time{font-weight:700;color:var(--text);font-size:15px;white-space:nowrap}
.cls-name{font-weight:700;color:var(--text);font-size:16px;line-height:1.2}
.cls-meta{font-size:12px;color:var(--muted)}
.cls-badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.cls-good{font-size:12px;font-weight:700;color:var(--good)}
.cls-musc{display:flex;flex-wrap:wrap;gap:4px}
.cls-musc span{font-size:11px;background:var(--card2);color:var(--text);border-radius:6px;padding:2px 6px}
.cls-musc span b{color:var(--accent)}
.cls-blurb{font-size:12px;color:var(--muted);line-height:1.35}
.cls-btn{appearance:none;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:700;font-size:15px;padding:11px 14px;min-height:44px;width:100%;cursor:pointer}
.cls-btn.cls-ghost{background:var(--card2);color:var(--text);border:1px solid var(--line)}
.cls-btn:disabled{opacity:.5}
.cls-empty{background:var(--card);border:1px dashed var(--line);border-radius:14px;padding:14px;color:var(--muted);font-size:14px}
.cls-form{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px}
.cls-form summary{font-weight:700;color:var(--text);cursor:pointer;list-style:none}
.cls-form summary::-webkit-details-marker{display:none}
.cls-inputs{display:flex;gap:8px}
.cls-inputs input{background:var(--card2);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px;font-size:16px;min-height:44px;min-width:0}
.cls-inputs input[name=name]{flex:1}
.cls-inputs input[name=min]{width:80px}
.cls-preview{font-size:12px;color:var(--muted)}
.cls-stale{font-size:12px;color:var(--warn)}
</style>`;

function nowHHMM(now = new Date()) {
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

function muscleChips(info) {
  const gc = groupCredits(info.muscles);
  const top = Object.entries(gc).filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const parts = top.map(([g, v]) => `<span>${esc(GROUP_NAME[g] || g)} <b>${v}</b></span>`);
  if (info.cardioMinutes > 0) parts.push(`<span>Cardio <b>${info.cardioMinutes}m</b></span>`);
  if (!parts.length) parts.push('<span>Recovery / mobility</span>');
  return `<div class="cls-musc" title="Effective sets credited per muscle group">${parts.join('')}</div>`;
}

function badge(type) {
  const [label, color] = TYPE_STYLE[type] || TYPE_STYLE.other;
  return `<span class="cls-badge" style="color:${color}">${esc(label)}</span>`;
}

function classCard(c, { dayDate, idx, minutes, targets, today, now }) {
  const info = c.classify || classify(c.name, c.duration);
  const past = dayDate === today && c.start && c.start < nowHHMM(now);
  const m = matchScore({ ...c, classify: info }, { minutes, targets });
  const good = !past && m.good;
  const meta = [c.duration ? c.duration + ' min' : null, c.instructor, c.room && c.room !== 'Group Fitness' ? c.room : null]
    .filter(Boolean).map(esc).join(' · ');
  return `<div class="cls-card${good ? ' cls-match' : ''}${past ? ' cls-past' : ''}">
    <div class="cls-row"><span class="cls-time">${esc(c.time || '')}</span>${badge(info.type)}</div>
    <div class="cls-name">${esc(c.name)}</div>
    <div class="cls-meta">${meta}${info.label ? ' · ' + esc(info.label) : ''}</div>
    ${good ? `<div class="cls-good">✓ Good match${m.reasons.length ? ': ' + esc(m.reasons.join(', ')) : ''}</div>` : ''}
    ${muscleChips(info)}
    <div class="cls-blurb">${esc(info.blurb)}</div>
    ${past ? '<div class="cls-meta">Already started</div>'
      : `<button class="cls-btn${good ? '' : ' cls-ghost'}" data-cls-do="${idx}" data-cls-day="${esc(dayDate)}">Do this class</button>`}
  </div>`;
}

function otherForm() {
  return `<details class="cls-form">
    <summary>+ Log a different class</summary>
    <div class="cls-sub">Peloton, another gym, a YouTube workout… We estimate muscle and cardio credit from the name.</div>
    <form class="cls-other" autocomplete="off">
      <div class="cls-inputs">
        <input name="name" type="text" placeholder="e.g. Peloton Power Zone Ride" required maxlength="80">
        <input name="min" type="number" inputmode="numeric" min="5" max="180" value="45" aria-label="Minutes">
      </div>
      <div class="cls-preview" data-cls-preview></div>
      <button class="cls-btn" type="submit" style="margin-top:8px">Log this class</button>
    </form>
  </details>`;
}

function listHtml(sched, { date, minutes, targets }) {
  const today = ds();
  const now = new Date();
  if (!sched) return '<div class="cls-empty">Loading Crunch Allen schedule…</div>';
  const days = (sched.days || []).filter(d => d.date >= today);
  if (!days.length) {
    return `<div class="cls-empty">No upcoming Crunch classes in the saved schedule${sched.error ? ' (offline?)' : ''}.
      It refreshes daily around 5am. <a href="${esc(sched.locationUrl || 'https://www.crunch.com/locations/allen')}" target="_blank" rel="noopener" style="color:var(--accent)">Open crunch.com</a></div>`;
  }
  let sel = ui.day && days.some(d => d.date === ui.day) ? ui.day : null;
  if (!sel) sel = days.some(d => d.date === date) ? date : days[0].date;
  ui.day = sel;
  const day = days.find(d => d.date === sel);
  const tabs = days.length > 1 ? `<div class="cls-days">${days.map(d => chip(
    d.date === today ? 'Today' : fmtDay(d.date).replace(/,.*/, '') + ' ' + Number(d.date.slice(8)),
    { active: d.date === sel, attrs: `data-cls-tab="${esc(d.date)}"` })).join('')}</div>` : '';
  const upcoming = day.classes.filter(c => !(sel === today && c.start && c.start < nowHHMM(now)));
  const cards = day.classes.map((c, idx) => classCard(c, { dayDate: sel, idx, minutes, targets, today, now }));
  // Upcoming first, past (greyed) at the bottom.
  const order = day.classes.map((c, i) => i).sort((a, b) => {
    const pa = upcoming.includes(day.classes[a]) ? 0 : 1, pb = upcoming.includes(day.classes[b]) ? 0 : 1;
    return pa - pb || a - b;
  });
  const note = sel === today && !upcoming.length ? '<div class="cls-empty">No more classes today. Check the next day above.</div>' : '';
  return `${tabs}<div class="cls-sub">${esc(fmtDay(sel))} · ${day.classes.length} classes</div>${note}${order.map(i => cards[i]).join('')}`;
}

export function renderClassPicker(ctx, { date = ds(), minutes = null, targets = [] } = {}) {
  const t = Array.isArray(targets) ? targets : [];
  const stale = cache && cache.stale && cache.days?.length;
  return `${STYLE}<div class="cls-wrap cls-picker" data-date="${esc(date)}" data-minutes="${esc(minutes ?? '')}" data-targets="${esc(t.join(','))}">
    <div class="cls-head"><h3>Crunch Allen classes</h3>
      <a class="cls-sub" href="https://www.crunch.com/locations/allen" target="_blank" rel="noopener" style="color:var(--muted)">crunch.com ↗</a></div>
    ${stale ? '<div class="cls-stale">Schedule may be out of date. It refreshes daily.</div>' : ''}
    <div class="cls-list">${listHtml(cache, { date, minutes, targets: t })}</div>
    ${otherForm()}
  </div>`;
}

function readOpts(el) {
  return {
    date: el.dataset.date || ds(),
    minutes: Number(el.dataset.minutes) || null,
    targets: (el.dataset.targets || '').split(',').filter(Boolean),
  };
}

function createClassSession(ctx, { provider, name, time = null, duration, instructor = null, info, date }) {
  const today = ds();
  const future = date && date > today;
  const loc = (typeof ctx.location === 'function' && ctx.location()) || null;
  const session = {
    id: ctx.store.newSessionId(),
    date: date || today,
    status: future ? 'planned' : 'active',
    startedAt: future ? null : new Date().toISOString(),
    endedAt: null,
    location: provider === 'crunch' ? 'crunch' : (loc?.id || 'home'),
    minutes: duration,
    title: name,
    targets: [],
    source: 'class',
    blocks: [{ kind: 'class', provider, name, time, duration, instructor, classify: info, done: false }],
    rationale: [info.blurb].filter(Boolean),
    notes: '',
  };
  ctx.store.saveSession(session);
  if (!future) ctx.store.setActiveSessionId(session.id);
  if (ctx.toast) ctx.toast(future ? `Planned: ${name}` : `Started: ${name}`);
  ctx.nav('session', { id: session.id });
}

export function bindClassPicker(root, ctx) {
  const el = root?.classList?.contains('cls-picker') ? root : root?.querySelector?.('.cls-picker');
  if (!el || el.dataset.clsBound) return;
  el.dataset.clsBound = '1';
  const list = el.querySelector('.cls-list');
  const refresh = () => { if (list) list.innerHTML = listHtml(cache, readOpts(el)); };

  if (!cache || Date.now() - cacheAt > 30 * 60e3) {
    loading = loading || loadSchedule().then(s => { cache = s; cacheAt = Date.now(); return s; }).finally(() => { loading = null; });
    loading.then(() => { if (el.isConnected) refresh(); });
  }

  el.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-cls-tab]');
    if (tab) { e.preventDefault(); ui.day = tab.dataset.clsTab; refresh(); return; }
    const btn = e.target.closest('[data-cls-do]');
    if (btn && cache) {
      e.preventDefault();
      const day = cache.days.find(d => d.date === btn.dataset.clsDay);
      const c = day?.classes[Number(btn.dataset.clsDo)];
      if (!c) return;
      btn.disabled = true;
      createClassSession(ctx, {
        provider: 'crunch', name: c.name, time: c.time || null, duration: c.duration || 45,
        instructor: c.instructor || null, info: c.classify || classify(c.name, c.duration), date: day.date,
      });
    }
  });

  const form = el.querySelector('.cls-other');
  if (form) {
    const preview = form.querySelector('[data-cls-preview]');
    const upd = () => {
      const name = form.elements.name.value.trim();
      if (!name) { preview.textContent = ''; return; }
      const info = classify(name, Number(form.elements.min.value) || 45);
      const gc = groupCredits(info.muscles);
      const top = Object.entries(gc).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g, v]) => `${GROUP_NAME[g] || g} ${v}`);
      preview.textContent = `${info.label} · ${info.cardioMinutes} cardio min${top.length ? ' · ' + top.join(', ') : ''}`;
    };
    form.addEventListener('input', upd);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      if (!name) return;
      const duration = Math.max(5, Math.min(180, Number(form.elements.min.value) || 45));
      createClassSession(ctx, { provider: 'other', name, duration, info: classify(name, duration), date: ds() });
    });
  }
}
