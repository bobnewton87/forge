// Forge bootstrap + hash router (UI-SHELL).
// URLs look like  #/today  or  #/exercise?id=db_curl  or  #/today?targets=["back"]
// (non-string params are JSON-encoded), so refresh and the iOS back gesture keep your place.
//
// Screen modules export render(ctx, params) → html and bind(root, ctx, params).
// Optional extras a screen may export:
//   title(ctx, params) → string   header title for sub-pages
//   autoRerender = false          opt out of re-render on store changes
import { store, accounts } from './store.js';
import { createShell, createTimer } from './ui/shell.js';
import { esc } from './ui/components.js';

// Cloud sign-in redirect (CONTRACT §19): take OAuth / email-link tokens off the address bar before the router
// reads the hash. ui/accounts.js picks them up after the first draw.
let authReturn = '';
if (/(^|[#&?/])(access_token|error_description)=/.test(location.hash + '&' + location.search)) {
  authReturn = location.hash + '&' + location.search.slice(1);
  history.replaceState(null, '', location.pathname + '#/settings?section=accounts');
}

const SCREEN_FILES = {
  today: './ui/today.js', session: './ui/session.js', body: './ui/body.js', history: './ui/history.js', plan: './ui/plan.js', measure: './ui/measure.js', projection: './ui/projection.js', supplements: './ui/supplements.js',
  more: './ui/settings.js', settings: './ui/settings.js', library: './ui/library.js', exercise: './ui/library.js',
  nutrition: './ui/nutrition.js', import: './ui/importer.js',
};
const TAB_OF = { today: 'today', session: 'session', body: 'body', history: 'plan', plan: 'plan', measure: 'body', projection: 'body', supplements: 'body', more: 'more', settings: 'more', library: 'more', exercise: 'more', nutrition: 'more', import: 'more' };
const PARENT = { history: 'plan', measure: 'body', projection: 'body', supplements: 'body', settings: 'more', library: 'more', nutrition: 'more', import: 'more', exercise: 'library' };
const TITLES = { history: 'History', measure: 'Measurements', projection: 'Projection', supplements: 'Supplements & Metabolism', settings: 'Settings', library: 'Exercise Library', exercise: 'Exercise', nutrition: 'Nutrition', import: 'Import' };

const modules = {};
async function loadModules() {
  const files = [...new Set(Object.values(SCREEN_FILES))];
  const res = await Promise.allSettled(files.map(f => import(f)));
  res.forEach((r, i) => { modules[files[i]] = r.status === 'fulfilled' ? r.value : { __error: r.reason }; if (r.status === 'rejected') console.error('Failed to load', files[i], r.reason); });
}

// ---------- hash <-> route ----------
function encodeParams(p = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) { if (v === undefined || v === null) continue; q.set(k, typeof v === 'string' ? v : JSON.stringify(v)); }
  const s = q.toString(); return s ? '?' + s : '';
}
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [r, qs = ''] = h.split('?');
  const params = {};
  for (const [k, v] of new URLSearchParams(qs)) {
    if (/^[[{]/.test(v) || v === 'true' || v === 'false') { try { params[k] = JSON.parse(v); continue; } catch (e) { /* keep string */ } }
    params[k] = v;
  }
  return { route: SCREEN_FILES[r] ? r : 'today', params };
}

const app = document.getElementById('app');
let current = { route: 'today', params: {} };
const depth = () => (history.state && history.state.i) || 0;   // in-app history depth

const shell = createShell(app, {
  onTab: t => ctx.nav(t),
  onBack: () => ctx.back(),
  onLocation: openLocationSheet,
  onAccount: () => import('./ui/accounts.js').then(m => m.openSwitcher(ctx)),
});
const timer = createTimer(shell.timerEl, () => store.getProfile());

const ctx = {
  store,
  nav(route, params = {}, { replace = false } = {}) {
    const hash = '#/' + route + encodeParams(params);
    if (location.hash === hash) { draw({ scroll: true }); return; }
    if (replace) { history.replaceState({ i: depth() }, '', hash); draw({ scroll: true }); return; }
    history.pushState({ i: depth() + 1 }, '', hash);
    draw({ scroll: true });
  },
  rerender() { draw({ scroll: false }); },
  toast: m => shell.toast(m),
  openSheet: (html, bindFn) => shell.openSheet(html, bindFn),
  closeSheet: () => shell.closeSheet(),
  timer: { start: s => timer.start(s), stop: () => timer.stop() },
  location() {
    const p = store.getProfile(); const locs = p.locations || [];
    return locs.find(l => l.id === p.currentLocation) || locs[0] || { id: 'home', name: 'Home', icon: '🏠', equipment: ['bodyweight'] };
  },
  // Extras (not in CONTRACT, safe to ignore):
  get route() { return current.route; },
  get params() { return current.params; },
  back() { if (depth() > 0) history.back(); else ctx.nav(PARENT[current.route] || 'today', {}, { replace: true }); },
};
window.addEventListener('popstate', () => draw({ scroll: true }));

function openLocationSheet() {
  const p = store.getProfile(); const cur = ctx.location();
  ctx.openSheet(`<h2>Where are you training?</h2><p class="muted small">Workouts are built from the equipment at this location.</p>
    <div class="list mt">${(p.locations || []).map(l => `<button class="list-item" data-loc="${esc(l.id)}">
      <span class="ic">${esc(l.icon || '📍')}</span><span class="grow"><div class="t">${esc(l.name)}</div><div class="s">${(l.equipment || []).length} equipment items${l.hasClasses ? ' · classes' : ''}</div></span>
      ${l.id === cur.id ? '<span class="badge accent">Here</span>' : ''}</button>`).join('')}</div>
    <button class="btn btn-ghost btn-block" data-edit>Edit locations & equipment</button>`, (el, close) => {
    el.querySelectorAll('[data-loc]').forEach(b => b.onclick = () => {
      store.updateProfile({ currentLocation: b.dataset.loc }); close();
      ctx.toast(`${ctx.location().icon || ''} Training at ${ctx.location().name}`);
    });
    el.querySelector('[data-edit]').onclick = () => { close(); ctx.nav('settings', { section: 'locations' }); };
  });
}

function errorCard(title, e) {
  return `<div class="card err"><h3>${esc(title)}</h3><p class="muted small">This screen hit an error. The rest of the app still works.</p><pre>${esc(e && (e.stack || e.message) || e)}</pre></div>`;
}

let drawing = false;
function draw({ scroll = false } = {}) {
  if (drawing) return; drawing = true;
  try {
    current = parseHash();
    const { route, params } = current;
    const mod = modules[SCREEN_FILES[route]];
    let title = TITLES[route] || '';
    try { if (mod && typeof mod.title === 'function') title = mod.title(ctx, params) || title; } catch (e) { /* ignore */ }
    shell.setHeader({ title, back: !!PARENT[route], location: ctx.location(), account: accountChip() });
    shell.setTabs(TAB_OF[route], { activeSession: hasActive() });
    const y = window.scrollY;
    const root = shell.content;
    if (!mod || mod.__error) root.innerHTML = errorCard('Could not load ' + route, mod && mod.__error);
    else {
      try { root.innerHTML = mod.render(ctx, params) || ''; } catch (e) { console.error(e); root.innerHTML = errorCard('Render error', e); }
      try { mod.bind && mod.bind(root, ctx, params); } catch (e) { console.error(e); }
    }
    root.dataset.route = route;
    if (scroll) window.scrollTo(0, 0); else window.scrollTo(0, y);
  } finally { drawing = false; }
}
// Header account chip: shown when there is more than one account, TEST badge on test accounts (CONTRACT §19).
function accountChip() {
  try { const a = accounts.active(); return { name: a.name, test: accounts.kind(a) === 'test', multi: accounts.list().length > 1 }; } catch (e) { return null; }
}
function hasActive() { try { const s = store.getActiveSession(); return !!(s && s.status !== 'done'); } catch (e) { return false; } }

// ---------- re-render on store changes without clobbering focused inputs ----------
let pending = false, raf = 0;
const editing = () => { const a = document.activeElement; return a && shell.content.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio' && a.type !== 'button'; };
function scheduleRerender() {
  shell.setTabs(TAB_OF[current.route], { activeSession: hasActive() });
  const mod = modules[SCREEN_FILES[current.route]];
  if (mod && mod.autoRerender === false) return;
  if (editing()) { pending = true; return; }
  cancelAnimationFrame(raf); raf = requestAnimationFrame(() => draw({ scroll: false }));
}
store.subscribe(scheduleRerender);
document.addEventListener('focusout', () => setTimeout(() => { if (pending && !editing()) { pending = false; draw({ scroll: false }); } }, 50));

(async function boot() {
  await loadModules();
  history.replaceState(history.state || { i: 0 }, '', location.hash || '#/today');
  draw({ scroll: true });
  // Cloud sync starts after the first paint and never blocks it (it does nothing while js/config.js is blank).
  setTimeout(() => import('./ui/accounts.js').then(m => m.startCloud(ctx, { authReturn })).catch(e => console.error(e)), 0);
})();
