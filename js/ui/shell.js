// App chrome (UI-SHELL): header with location pill, bottom tab bar, bottom sheet,
// toast and the rest-timer banner. main.js wires these into ctx.
import { esc } from './components.js';

const ICONS = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 1-3s-3 1-3 6a6 6 0 0 0 12 0c0-6-4-9-6-12z"/></svg>',
  session: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/></svg>',
  body: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
};
const TABS = [['today', 'Today'], ['session', 'Workout'], ['plan', 'Plan'], ['body', 'Body'], ['more', 'More']];

export function createShell(app, { onTab, onBack, onLocation }) {
  app.innerHTML = `
    <header class="app-header" id="hdr"></header>
    <div class="timer-banner" id="timer" hidden></div>
    <main id="content"></main>
    <nav class="tabbar" id="tabs">${TABS.map(([id, label]) => `<button class="tab" data-tab="${id}" aria-label="${label}">${ICONS[id]}<span>${label}</span></button>`).join('')}</nav>
    <div id="sheet-root"></div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  const hdr = app.querySelector('#hdr');
  const tabs = app.querySelector('#tabs');
  const content = app.querySelector('#content');
  tabs.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) onTab(b.dataset.tab); });
  window.addEventListener('scroll', () => hdr.classList.toggle('scrolled', window.scrollY > 4), { passive: true });

  function setHeader({ title, back, location }) {
    const pill = location ? `<button class="loc-pill" id="locpill" aria-label="Change location"><span>${esc(location.icon || '📍')}</span><span class="nm">${esc(location.name)}</span><span class="caret">▼</span></button>` : '';
    hdr.innerHTML = back
      ? `<button class="hdr-back" id="hdrback" aria-label="Back">${ICONS.back}</button><div class="hdr-title">${esc(title || '')}</div>${pill}`
      : `<div class="brand"><span class="brand-mark">F</span>FORGE</div><div class="hdr-spacer"></div>${pill}`;
    hdr.querySelector('#hdrback')?.addEventListener('click', onBack);
    hdr.querySelector('#locpill')?.addEventListener('click', onLocation);
  }
  function setTabs(active, { activeSession } = {}) {
    tabs.querySelectorAll('.tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === active);
      const want = b.dataset.tab === 'session' && activeSession;
      const dot = b.querySelector('.dot');
      if (want && !dot) b.insertAdjacentHTML('beforeend', '<i class="dot"></i>');
      if (!want && dot) dot.remove();
    });
  }

  // ---- Sheet ----
  const sheetRoot = app.querySelector('#sheet-root');
  let sheetState = null;
  function closeSheet() {
    if (!sheetState) return;
    const { bd, sh } = sheetState; sheetState = null;
    bd.classList.remove('open'); sh.classList.remove('open');
    document.body.classList.remove('sheet-lock');
    setTimeout(() => { bd.remove(); sh.remove(); }, 280);
  }
  function openSheet(html, bindFn) {
    if (sheetState) { const { bd, sh } = sheetState; bd.remove(); sh.remove(); sheetState = null; }
    const bd = document.createElement('div'); bd.className = 'sheet-backdrop';
    const sh = document.createElement('div'); sh.className = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    sh.innerHTML = `<div class="sheet-handle"></div><div class="sheet-body">${html}</div>`;
    sheetRoot.append(bd, sh);
    document.body.classList.add('sheet-lock');
    sheetState = { bd, sh };
    requestAnimationFrame(() => { bd.classList.add('open'); sh.classList.add('open'); });
    bd.addEventListener('click', closeSheet);
    // Swipe down on the handle area / when scrolled to top closes the sheet.
    let y0 = null, dy = 0; const body = sh.querySelector('.sheet-body');
    sh.addEventListener('touchstart', e => { if (body.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
    sh.addEventListener('touchmove', e => {
      if (y0 == null) return; dy = e.touches[0].clientY - y0;
      if (dy > 0) { sh.style.transition = 'none'; sh.style.transform = `translate(-50%, ${dy}px)`; }
    }, { passive: true });
    sh.addEventListener('touchend', () => {
      if (y0 == null) return; sh.style.transition = ''; sh.style.transform = '';
      if (dy > 110) closeSheet(); y0 = null;
    });
    const inner = sh.querySelector('.sheet-body');
    try { bindFn && bindFn(inner, closeSheet); } catch (e) { console.error(e); }
    return inner;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  // ---- Toast ----
  const toastEl = app.querySelector('#toast'); let toastT;
  function toast(msg) {
    toastEl.textContent = String(msg ?? '');
    toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  return { content, setHeader, setTabs, openSheet, closeSheet, toast, sheetOpen: () => !!sheetState, timerEl: app.querySelector('#timer') };
}

// ---- Rest timer ----
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio */ }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlockAudio, { capture: true });
  window.addEventListener('touchend', unlockAudio, { capture: true });
}
function beep() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  [0, 0.22, 0.44].forEach((d, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
    o.connect(g).connect(audioCtx.destination); o.start(t0 + d); o.stop(t0 + d + 0.2);
  });
}

export function createTimer(el, getProfile) {
  let endAt = 0, total = 0, tick = null, hideT = null;
  const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function paint() {
    const left = (endAt - Date.now()) / 1000;
    if (left <= 0) return finish();
    el.querySelector('.t-time').textContent = fmt(left);
    el.querySelector('.t-bar').style.width = (100 * left / total) + '%';
  }
  function finish() {
    clearInterval(tick); tick = null;
    const rt = getProfile().restTimer || {};
    if (rt.sound !== false) beep();
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ }
    el.classList.add('done');
    el.innerHTML = `<div class="t-main"><div class="t-label">Rest done</div><div class="t-time">Go! 💪</div></div><button class="btn btn-sm btn-ghost" data-t="x">Dismiss</button>`;
    el.querySelector('[data-t=x]').onclick = stop;
    hideT = setTimeout(stop, 6000);
  }
  function render() {
    el.classList.remove('done');
    el.innerHTML = `<div class="t-main"><div class="t-label">Rest</div><div class="t-time">${fmt(total)}</div></div>
      <button class="btn btn-sm" data-t="m15" aria-label="Minus 15 seconds">−15</button>
      <button class="btn btn-sm" data-t="p15" aria-label="Add 15 seconds">+15s</button>
      <button class="btn btn-sm btn-primary" data-t="skip">Skip</button><div class="t-bar"></div>`;
    el.querySelector('[data-t=p15]').onclick = () => { endAt += 15000; total += 15; paint(); };
    el.querySelector('[data-t=m15]').onclick = () => { endAt -= 15000; paint(); };
    el.querySelector('[data-t=skip]').onclick = stop;
  }
  function start(sec) {
    const rt = getProfile().restTimer || {};
    if (rt.enabled === false) return;
    sec = Number(sec) || 0; if (sec <= 0) return;
    unlockAudio();
    clearTimeout(hideT); clearInterval(tick);
    total = sec; endAt = Date.now() + sec * 1000;
    render(); el.hidden = false; paint();
    tick = setInterval(paint, 250);
  }
  function stop() { clearInterval(tick); clearTimeout(hideT); tick = null; el.hidden = true; el.innerHTML = ''; }
  document.addEventListener('visibilitychange', () => { if (tick && !document.hidden) paint(); });
  return { start, stop, running: () => !!tick };
}
