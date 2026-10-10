// STUB — UI-SHELL replaces this file.
import { store } from './store.js';
import * as today from './ui/today.js';
import * as session from './ui/session.js';
import * as body from './ui/body.js';
import * as history from './ui/history.js';
import * as settings from './ui/settings.js';
import * as library from './ui/library.js';
import * as nutrition from './ui/nutrition.js';
import * as importer from './ui/importer.js';
const ROUTES = { today, session, body, history, more: settings, settings, library, nutrition, import: importer, exercise: library };
let route = 'today', params = {};
const app = document.getElementById('app');
const ctx = {
  store,
  nav(r, p = {}) { route = r; params = p; draw(); },
  rerender() { draw(); },
  toast(m) { console.log('toast', m); },
  openSheet() {}, closeSheet() {},
  timer: { start() {}, stop() {} },
  location() { const p = store.getProfile(); return p.locations.find(l => l.id === p.currentLocation) || p.locations[0]; },
};
function draw() { const m = ROUTES[route] || today; app.innerHTML = `<main id="content">${m.render(ctx, params)}</main><nav id="tabs">${['today', 'session', 'body', 'history', 'more'].map(t => `<button data-tab="${t}">${t}</button>`).join('')}</nav>`; app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => ctx.nav(b.dataset.tab)); m.bind(app.querySelector('#content'), ctx, params); }
draw();
