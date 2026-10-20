// Training styles UI (STYLES): shared style picker chips, the custom-style editor sheet (live "≈ N min for
// this workout"), and the Time-saver evidence sheet. Used by Today (builder), Plan (availability), Settings
// and the targets sheet. Styles are read via resolveTargets().training.styles and saved through setTargets,
// so a change to a style the plan uses re-plans upcoming auto days.
// CONTRACT-NOTE: CSS is injected at runtime (<style id="st-css">), base.css variables only.
import { esc, safe, openSheet, toast } from './components.js';
import {
  resolveStyle, styleOptions, restyle, normalizeCustomStyle, PAIRINGS, PAIRING_NAMES, STYLE_BASES, STYLE_DEFS, STYLE_LIMITS, STYLE_EVIDENCE,
} from '../engine/generator.js';
import { setTargets } from './targets.js';

const CSS = `
.st-chips{display:flex;flex-wrap:wrap;gap:7px}
.st-chips .chip{min-height:36px;padding:0 12px;font-size:13px}
.st-chips .chip.st-new{border-style:dashed;color:var(--accent)}
.st-chips .chip .st-c{font-size:10px;color:var(--muted);margin-left:4px}
.st-hint{display:flex;gap:8px;align-items:baseline;justify-content:space-between;margin:6px 0 2px}
.st-hint .tr-link,.st-link{color:var(--accent);font-size:13px;font-weight:650;background:none;padding:2px 0;white-space:nowrap}
.st-ed h2{margin:0 0 4px}
.st-ed .st-row{display:flex;align-items:center;gap:10px;min-height:44px}
.st-ed .st-row b{min-width:58px;text-align:right}
.st-ed .st-sub{font-size:12px;color:var(--muted);margin:-2px 0 6px}
.st-ed .st-est{background:var(--card2);border:1px solid var(--line);border-radius:13px;padding:10px 12px;margin:12px 0 4px}
.st-ed .st-est b{font-size:22px}
.st-ed .st-est .good{color:var(--good)}
.st-ed .st-num{width:64px;text-align:center}
.st-ed .st-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;margin-top:6px}
.st-ed .st-pair{display:flex;flex-wrap:wrap;gap:6px}
.st-list .st-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.st-list .st-item:last-child{border-bottom:0}
.st-ev li{margin:8px 0;line-height:1.45}
.st-ev .src{display:block;font-size:12px;color:var(--muted);margin-top:2px}
`;
export function ensureStyleCss() {
  if (typeof document === 'undefined' || document.getElementById('st-css')) return;
  const st = document.createElement('style'); st.id = 'st-css'; st.textContent = CSS; document.head.appendChild(st);
}

export const styleName = (id, profile, { short = false } = {}) => { const d = resolveStyle(id, profile); return short ? d.short || d.name : d.name; };

// Picker chips: built-ins + custom styles (+ optional "Default" and "＋ Custom style").
// attr = the data attribute each chip carries (value = style id; '' = default).
export function styleChipsHTML(profile, current, { attr = 'data-style', withDefault = false, withNew = false, extraAttrs = '' } = {}) {
  ensureStyleCss();
  const opts = styleOptions(profile);
  const def = resolveStyle(profile?.defaultStyle, profile);
  const c = (v, label, active, cls = '') => `<button type="button" class="chip sm ${active ? 'active' : ''} ${cls}" ${attr}="${esc(v)}" ${extraAttrs}>${label}</button>`;
  return `<div class="st-chips">${withDefault ? c('', `Default <span class="st-c">${esc(def.short || def.name)}</span>`, !current) : ''}${opts.map(o => c(o.id, esc(o.short || o.name) + (o.custom ? ' <span class="st-c">mine</span>' : ''), current === o.id)).join('')}${withNew ? c('__new', '＋ Custom style', false, 'st-new') : ''}</div>`;
}

// ---------------------------------------------------------------- evidence sheet
export function openStyleInfo(ctx) {
  ensureStyleCss();
  const d = STYLE_DEFS.efficient;
  openSheet(ctx, `<div class="st-ev"><h2>${esc(d.name)}</h2><p class="small mt">${esc(d.notes)}</p>
    <div class="section-title">The evidence</div><ul class="small">${STYLE_EVIDENCE.map(e => `<li>${esc(e.claim)}<span class="src">${esc(e.source)}</span></li>`).join('')}</ul>
    <p class="tiny muted">Forge never pairs two moves that share a limiting muscle (biceps, triceps, grip, front delts), so the partner set doesn't pre-tire the next one.</p>
    <div class="sheet-actions"><button type="button" class="btn btn-ghost btn-block" data-ok>OK</button></div></div>`, (el, close) => { el.querySelector('[data-ok]').onclick = () => close(); });
}

// ---------------------------------------------------------------- editor sheet
// opts: { style: custom style object to edit | style id / def to copy from, refSession: a workout to
//   estimate against (same exercises + sets), refLabel, onSaved(id) }
export function openStyleEditor(ctx, { style = null, refSession = null, refLabel = 'this workout', onSaved = null } = {}) {
  ensureStyleCss();
  const profile = ctx.store.getProfile();
  const existing = style && typeof style === 'object' && style.id && (profile.customStyles || []).some(x => x.id === style.id) ? normalizeCustomStyle(style) : null;
  const from = existing || resolveStyle(style || 'hypertrophy', profile);
  const S = {
    id: existing?.id || null,
    name: existing ? existing.name : (from.custom ? `${from.name} copy` : from.id === 'hypertrophy' ? 'My hypertrophy' : `My ${(from.short || from.name).toLowerCase()}`).slice(0, STYLE_LIMITS.name),
    base: STYLE_BASES.includes(from.base) ? from.base : 'hypertrophy',
    restCompound: from.restCompound, restIsolation: from.restIsolation, pairing: from.pairing,
    repOn: !!from.repMin, repMin: from.repMin || 8, repMax: from.repMax || 12,
    setsOn: !!from.setsPerExercise, setsPerExercise: from.setsPerExercise || 3,
  };
  const cur = () => normalizeCustomStyle({ ...S, id: S.id || 'cs_preview', repMin: S.repOn ? S.repMin : null, repMax: S.repOn ? S.repMax : null, setsPerExercise: S.setsOn ? S.setsPerExercise : null });
  const hypMin = refSession ? safe(() => restyle(refSession, 'hypertrophy', { profile }).estMinutes, null) : null;
  const estHTML = () => {
    if (!refSession) return '<span class="muted small">Build a workout first to see how long it takes in this style.</span>';
    const m = safe(() => restyle(refSession, cur(), { profile }).estMinutes, null);
    if (m == null) return '';
    const diff = hypMin ? Math.round((1 - m / hypMin) * 100) : 0;
    return `<div><b class="num" data-est>≈ ${m} min</b> <span class="small">for ${esc(refLabel)}</span></div>
      <div class="tiny muted">Same exercises${S.setsOn ? ` at ${S.setsPerExercise} sets each` : ' and sets'}. Plain Hypertrophy: ≈ ${hypMin} min${diff >= 3 ? ` · <span class="good">${diff}% faster</span>` : diff <= -3 ? ` · ${-diff}% longer` : ''}. When you build, Forge fits your time by adjusting sets.</div>`;
  };
  const range = (k, v, lo, hi, step) => `<input type="range" min="${lo}" max="${hi}" step="${step}" value="${v}" data-r="${k}" style="--pct:${((v - lo) / (hi - lo)) * 100}%" class="grow" aria-label="${k}">`;
  const [rLo, rHi] = STYLE_LIMITS.rest;
  const html = () => `<div class="st-ed"><h2>${S.id ? 'Edit style' : 'New training style'}</h2>
    <div class="field mt"><label>Name</label><input type="text" maxlength="${STYLE_LIMITS.name}" data-name value="${esc(S.name)}" placeholder="e.g. Quick hypertrophy"></div>
    <div class="label">Based on <span class="tiny muted">(rep ranges)</span></div>
    <div class="tabs mt" data-base>${STYLE_BASES.map(b => `<button type="button" class="${S.base === b ? 'active' : ''}" data-v="${b}">${esc(STYLE_DEFS[b].name)}</button>`).join('')}</div>
    <div class="label mt2">Rest between sets</div>
    <div class="st-row"><span style="width:92px">Compounds</span>${range('restCompound', S.restCompound, rLo, rHi, 5)}<b class="num" data-v="restCompound">${S.restCompound} s</b></div>
    <div class="st-row"><span style="width:92px">Isolations</span>${range('restIsolation', S.restIsolation, rLo, rHi, 5)}<b class="num" data-v="restIsolation">${S.restIsolation} s</b></div>
    <div class="st-sub">Evidence: little extra growth from resting longer than ~90 s; under 60 s costs a bit.</div>
    <div class="label mt">Pairing</div>
    <div class="st-pair mt" data-pairing>${PAIRINGS.map(p => `<button type="button" class="chip sm ${S.pairing === p ? 'active' : ''}" data-v="${p}">${esc(PAIRING_NAMES[p])}</button>`).join('')}</div>
    <div class="st-sub" style="margin-top:8px">${esc({ none: 'Every exercise on its own, full rest after each set.', accessory: 'Big lifts on their own; accessories in supersets (the Hypertrophy default).', antagonist: 'Each move paired with one that doesn\'t compete (push + pull, upper + lower). The partner\'s set counts toward rest, so the timer after the pair is shorter while each muscle still gets the rest above.', superset: 'Pairs and tri-sets of everything, rest after each round.', circuit: 'All stations back to back, rest after each round.' }[S.pairing])}</div>
    <div class="st-opt"><span>Own rep range</span><label class="switch"><input type="checkbox" data-t="repOn" ${S.repOn ? 'checked' : ''}><span></span></label></div>
    ${S.repOn ? `<div class="st-row"><input type="number" inputmode="numeric" class="st-num" min="3" max="30" data-n="repMin" value="${S.repMin}"> to <input type="number" inputmode="numeric" class="st-num" min="3" max="30" data-n="repMax" value="${S.repMax}"> reps</div>` : ''}
    <div class="st-opt"><span>Fixed sets per exercise</span><label class="switch"><input type="checkbox" data-t="setsOn" ${S.setsOn ? 'checked' : ''}><span></span></label></div>
    ${S.setsOn ? `<div class="st-row"><span class="tg-step sm"><button type="button" data-sets="-1" aria-label="Fewer sets">−</button><b class="num">${S.setsPerExercise}</b><button type="button" data-sets="1" aria-label="More sets">+</button></span><span class="muted small">sets each</span></div>` : ''}
    <div class="st-est" data-estbox>${estHTML()}</div>
    <div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-save>${S.id ? 'Save changes' : 'Save style'}</button>
    <button type="button" class="btn btn-ghost btn-block" data-cancel>Cancel</button></div></div>`;
  openSheet(ctx, html(), (el, close) => {
    const paint = () => { const y = el.scrollTop; el.innerHTML = html(); el.scrollTop = y; };
    el.addEventListener('input', e => {
      const t = e.target;
      if (t.matches('[data-name]')) { S.name = t.value; return; }
      if (t.matches('[data-r]')) {
        const k = t.dataset.r; S[k] = Number(t.value);
        t.style.setProperty('--pct', ((S[k] - rLo) / (rHi - rLo)) * 100 + '%');
        el.querySelector(`[data-v="${k}"]`).textContent = `${S[k]} s`;
        el.querySelector('[data-estbox]').innerHTML = estHTML();
      }
    });
    el.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('[data-t]')) { S[t.dataset.t] = t.checked; paint(); return; }
      if (t.matches('[data-n]')) { const v = Math.round(Number(t.value)); if (Number.isFinite(v)) S[t.dataset.n] = Math.min(30, Math.max(3, v)); el.querySelector('[data-estbox]').innerHTML = estHTML(); }
    });
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.closest('[data-base]') && b.dataset.v) {
        S.base = b.dataset.v; const d = STYLE_DEFS[S.base];
        S.restCompound = d.restCompound; S.restIsolation = d.restIsolation; S.pairing = d.pairing; paint(); return;
      }
      if (b.closest('[data-pairing]') && b.dataset.v) { S.pairing = b.dataset.v; paint(); return; }
      if (b.dataset.sets) { S.setsPerExercise = Math.min(STYLE_LIMITS.sets[1], Math.max(STYLE_LIMITS.sets[0], S.setsPerExercise + Number(b.dataset.sets))); paint(); return; }
      if ('cancel' in b.dataset) { close(); return; }
      if ('save' in b.dataset) {
        S.name = (el.querySelector('[data-name]')?.value || S.name).trim();
        const p = ctx.store.getProfile();
        const obj = { ...cur(), id: S.id || 'cs_' + Date.now() };
        const list = (p.customStyles || []).filter(x => x && x.id !== obj.id);
        if (!S.id && list.length >= STYLE_LIMITS.count) { toast(ctx, `Up to ${STYLE_LIMITS.count} custom styles`); return; }
        const next = S.id ? (p.customStyles || []).map(x => (x && x.id === obj.id ? obj : x)) : [...list, obj];
        close();
        setTargets(ctx, { training: { customStyles: next } }, { quiet: true, reason: `style "${obj.name}"` });
        toast(ctx, `${S.id ? 'Updated' : 'Saved'} style: ${normalizeCustomStyle(obj).name}`);
        if (onSaved) onSaved(obj.id);
      }
    });
  });
}

export function deleteStyle(ctx, id) {
  const p = ctx.store.getProfile();
  const cs = (p.customStyles || []).find(x => x && x.id === id);
  if (!cs) return;
  if (typeof confirm === 'function' && !confirm(`Delete the style "${cs.name}"? Days using it go back to your default style.`)) return;
  setTargets(ctx, { training: { customStyles: (p.customStyles || []).filter(x => x && x.id !== id) } }, { reason: `deleted style "${cs.name}"` });
}

// Settings list of custom styles with edit / delete, plus "＋ New style".
export function customStylesListHTML(profile) {
  ensureStyleCss();
  const opts = styleOptions(profile).filter(o => o.custom);
  return `<div class="st-list">${opts.length ? opts.map(o => `<div class="st-item"><div class="grow"><div class="t" style="font-weight:650">${esc(o.name)}</div><div class="tiny muted">${esc(o.hint)}</div></div>
      <button type="button" class="btn btn-sm" data-st-edit="${esc(o.id)}">Edit</button><button type="button" class="btn btn-sm btn-ghost" data-st-del="${esc(o.id)}" aria-label="Delete ${esc(o.name)}">✕</button></div>`).join('')
    : '<p class="small muted">No custom styles yet. Make one from any built-in, e.g. hypertrophy with shorter rests.</p>'}</div>
    <div class="row mt" style="gap:8px"><button type="button" class="btn btn-sm" data-st-new>＋ New style</button><button type="button" class="btn btn-sm btn-ghost" data-st-why>Time-saver: why it works</button></div>`;
}
