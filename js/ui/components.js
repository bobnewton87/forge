// STUB — UI-TRAIN replaces this file.
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function chip(label, { active = false, attrs = '', cls = '' } = {}) { return `<button class="chip ${active ? 'active' : ''} ${cls}" ${attrs}>${esc(label)}</button>`; }
export function readinessColor(readiness = 1, need = 0) { return readiness < 0.5 ? 'var(--bad)' : need > 0.5 ? 'var(--good)' : 'var(--muted)'; }
export function exerciseCard(ex) { return `<div class="card"><b>${esc(ex.name)}</b></div>`; }
export function muscleBar(label, sets, target) { return `<div>${esc(label)} ${Math.round(sets)}/${target.min}</div>`; }
