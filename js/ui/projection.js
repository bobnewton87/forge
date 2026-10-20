// Projection screen v2 (route 'projection', UI-LAB): 3D/SVG now-vs-projected physique with a week
// scrubber, live what-if controls (calories, macros, cardio, adherence, horizon), the Nutrition Lab
// (calories → lean vs fat), trend charts, projected measurements, milestones and the fine print.
// CONTRACT-NOTE: exports lineChart / bindCharts / f1 / safe helpers reused by measure.js and body.js,
//   plus mount3D / destroy3D (one live WebGL instance per key, auto-destroyed when its host leaves the
//   DOM), macros() (macrosFor with a local fallback), whatIfDefaults(), labData() and estMuscle().
// CONTRACT-NOTE: projection controls persist in store.kv('projection'). This screen sets
//   autoRerender = false and updates its own result regions in place, so dragging a slider never
//   tears down the 3D canvas.
// CONTRACT-NOTE: what-if calories are an ABSOLUTE kcal/day (passed as intake.calories), so adding
//   cardio at the same intake shows its real effect. "vs maintenance" uses result.energy.tdeeStart.
// CONTRACT-NOTE: engine features are feature-detected; with the Phase-2 engine the lab is computed
//   by calling project() per calorie level and extra cardio is simulated with synthetic planned sessions.
// CONTRACT-NOTE (long horizon): horizon slider 4 wk → 8 yr (o.weeks), nutrition phases preview in o.ph
//   (null = follow the saved plan, 'single' = one constant intake, or { preset, repeat, blocks }). Defaults for
//   adherence, macros, cardio modality and phases come from targets.resolveTargets (CONTRACT §18) when loaded.
//   Apply writes through targets.setTargets (nutrition incl. the dated phases list; cardio target with re-plan;
//   adherence). The full repeating phase plan is also kept in profile.nutrition.phasePlan (setTargets only stores
//   the dated list), which the engine prefers when present.
// CONTRACT-NOTE (§20 Female mode): estMuscle(p, heightIn, sex) uses the female FFMI scale; opts3D/mount3D options carry
//   `sex` (from the baseline) so a renderer can draw the female body; a paused projection (pregnancy) shows its own
//   card; women see waist:hip (WHO 0.85) in the key numbers and table instead of the V-taper; energy availability
//   below 30 kcal/kg lean mass is flagged on the end card.
import { esc } from './components.js';
import { BODY, sexOf } from '../engine/sex.js';
import { ds, fmtShort, parseDs, addDays, daysBetween } from '../util.js';
import * as BC from '../engine/bodycomp.js';
import * as PJ from '../engine/projection.js';
import * as NU from '../engine/nutrition.js';
import { CARDIO, INTENSITIES, estimateCalories } from '../data/cardio.js';
import { silhouetteSVG } from './silhouette.js';

// Shared targets (CONTRACT §18), loaded lazily so this screen works before/without them.
let TG = null, TGU = null;
import('../engine/targets.js').then(m => { TG = m; }).catch(() => {});
import('./targets.js').then(m => { TGU = m; }).catch(() => {});
const targetsOf = (profile, sessions) => (TG && typeof TG.resolveTargets === 'function' ? safe(() => TG.resolveTargets(profile, { sessions }), null) : null);

export const safe = (fn, fb) => { try { const v = fn(); return v == null ? fb : v; } catch (e) { console.error(e); return fb; } };
export const f1 = n => { n = Number(n); if (!isFinite(n)) return '—'; return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1); };
const sgn = n => (n > 0.049 ? '+' : n < -0.049 ? '−' : '±') + f1(Math.abs(n));
const sgnK = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(Math.round(n)).toLocaleString();
const kfmt = n => Math.round(n).toLocaleString();
const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function title() { return 'Projection'; }
export const autoRerender = false;

// ---------------- 3D lifecycle (shared by projection, measure, body) ----------------
let B3 = null;
let SUPP = null;
import('../data/supplements.js').then(m => { SUPP = m.SUPPLEMENTS || null; }).catch(() => {});
export function activeStack(profile) { const t = ds(); return (Array.isArray(profile?.supplements) ? profile.supplements : []).filter(x => x && x.active !== false && (!x.start || x.start <= t) && (!x.end || x.end >= t)); }
export function suppName(id) { return SUPP?.[id]?.name || String(id || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()); }
const b3p = import('./body3d.js').then(m => (B3 = m)).catch(e => { console.warn('3D module unavailable', e); return null; });
export function body3d() { return b3p; }
export function supports3D() { return !!(B3 && typeof B3.mountBody3D === 'function' && safe(() => B3.supported(), false)); }
const live = new Map(), tokens = new Map();
export function destroy3D(key) {
  tokens.delete(key);
  const L = live.get(key); if (!L) return;
  live.delete(key); L.obs.disconnect();
  try { L.handle.destroy(); } catch (e) { console.error(e); }
}
export function live3D(key) { return live.get(key)?.handle || null; }
// Mounts mountBody3D into host (replacing its SVG fallback) once the module is loaded. Resolves to the handle or null.
export function mount3D(key, root, host, opts) {
  destroy3D(key);
  if (!host) return Promise.resolve(null);
  const tok = {}; tokens.set(key, tok);
  return b3p.then(m => {
    if (tokens.get(key) !== tok || !host.isConnected) return null;
    if (!supports3D()) return null;
    const fallback = host.innerHTML;
    let handle;
    try { host.innerHTML = ''; host.classList.add('bd-3d-on'); handle = m.mountBody3D(host, opts); }
    catch (e) { console.error(e); host.innerHTML = fallback; host.classList.remove('bd-3d-on'); return null; }
    if (!handle) { host.innerHTML = fallback; host.classList.remove('bd-3d-on'); return null; }
    const obs = new MutationObserver(() => { if (!host.isConnected) destroy3D(key); });
    obs.observe(root || document.body, { childList: true, subtree: true });
    live.set(key, { handle, obs, host });
    return handle;
  });
}
// Rough 0..1 development scores when the engine doesn't provide series[i].muscle (from FFMI).
export function estMuscle(p, heightIn = 69, sex = 'male') {
  const lean = Number(p?.leanLb) || 0; if (!lean) return null;
  const m = heightIn * 0.0254, ffmi = lean / 2.20462 / (m * m);
  // DXA scale (§20b): FFMI 15.2 → 0, 24.2 → 1 for men (was 16 → 25 on the skinfold scale; −0.8 so the same body keeps the same
  // score); women 12.5 → 21.5 (female DXA-scale data, 3.5 below the original male anchor).
  const lo = sex === 'female' ? 12.5 : 15.2;
  const v = clampN((ffmi - lo) / 9, 0, 1);
  return { chest: v, delts: v, lats: v, arms: v, abs: v, quads: v + 0.08 > 1 ? 1 : v + 0.08, calves: v, traps: v };
}
// §16c: measured bone lengths { upperArmL, … } (finite, > 0 only) from a series point's shape, a baseline's
// measurements, or a bare object; null when none. shapeOf() always forwards them so both 3D renderers get them.
export function lengthsOf(src) {
  const l = src?.shape?.lengths || src?.measurements?.lengths || src?.lengths || null;
  if (!l || typeof l !== 'object') return null;
  const out = Object.fromEntries(Object.entries(l).filter(([, v]) => typeof v === 'number' && isFinite(v) && v > 0));
  return Object.keys(out).length ? out : null;
}
export function shapeOf(p, heightIn) {
  const sh = { ...(p?.shape || p?.measurements || {}), heightIn: (p?.shape?.heightIn) || heightIn };
  // CONTRACT §21b: body weight sizes the tape sites the user has not measured (anthro fillGirths). Without it a
  // 300 lb profile with no tape rendered as an average body. Series points carry weightLb directly.
  const w = Number(p?.weightLb ?? p?.shape?.weightLb ?? p?.measurements?.weightLb);
  if (Number.isFinite(w) && w > 0) sh.weightLb = w; else delete sh.weightLb;
  const len = lengthsOf(p);
  if (len) sh.lengths = len; else delete sh.lengths;
  return sh;
}
export function opts3D(p, heightIn, extra = {}) {
  return { shape: shapeOf(p, heightIn), muscle: p?.muscle || estMuscle(p, heightIn, extra.sex), bodyFatPct: p?.bodyFatPct ?? null, ...extra };
}

// ---------------- macros (engine macrosFor with fallback) ----------------
export function macros(profile, { calories, bodyweight, proteinGPerLb, fatPct }) {
  const prof = { ...profile, nutrition: { ...(profile?.nutrition || {}), proteinGPerLb, fatPct } };
  if (typeof NU.macrosFor === 'function') {
    const r = safe(() => NU.macrosFor(prof, { calories, bodyweight }), null);
    if (r && isFinite(r.protein)) return { ...r, warnings: r.warnings || [] };
  }
  const bw = Number(bodyweight) || 165, cal = Number(calories) || 0;
  const protein = Math.round(bw * proteinGPerLb), fat = Math.round(cal * fatPct / 100 / 9);
  const carbs = Math.max(0, Math.round((cal - protein * 4 - fat * 9) / 4));
  const tot = protein * 4 + carbs * 4 + fat * 9 || 1;
  const warnings = [];
  if (proteinGPerLb < 0.7) warnings.push('Protein under ~0.7 g/lb measurably slows muscle gain.');
  if (proteinGPerLb > 1.15) warnings.push('Above ~1 g/lb there is no extra muscle benefit (Morton 2018). Fine if you like it, but those calories could be carbs.');
  if (fatPct < 20) warnings.push('Fat under ~20% of calories can lower testosterone and feels rough. 20–35% is the sweet spot.');
  if (carbs < 120) warnings.push('Carbs are very low. That makes hard lifting and cardio feel worse.');
  return { calories: cal, protein, carbs, fat, proteinPct: Math.round(protein * 400 / tot), carbPct: Math.round(carbs * 400 / tot), fatPct: Math.round(fat * 900 / tot), warnings };
}
export function macroBar(m) {
  const p = m.protein * 4, c = m.carbs * 4, f = m.fat * 9, t = p + c + f || 1;
  const pct = v => Math.round(v * 100 / t);
  return `<div class="bd-mbar" role="img" aria-label="Protein ${pct(p)}%, carbs ${pct(c)}%, fat ${pct(f)}%"><i style="flex:${p};background:var(--accent)"></i><i style="flex:${c};background:var(--accent2)"></i><i style="flex:${f};background:var(--cardio)"></i></div>
    <div class="bd-mleg">${[['Protein', m.protein, pct(p), 'var(--accent)'], ['Carbs', m.carbs, pct(c), 'var(--accent2)'], ['Fat', m.fat, pct(f), 'var(--cardio)']].map(([l, g, pc, col]) =>
      `<div><span class="bd-dot" style="background:${col}"></span><b class="num">${g}<small>g</small></b><span>${l} · ${pc}%</span></div>`).join('')}</div>`;
}

// ---------------- charts ----------------
// data: [{ d, v, lo?, hi? }]; past: [{ d, v }] drawn as dots before today; target: horizontal guide.
// Long horizons: x ticks switch to "6 mo / 1 yr / 2 yr…", and `phases` ([{ start, end, goal, label }]) draw tinted bands.
export const PHASE_COL = { cut: 'var(--good)', lean_bulk: 'var(--accent2)', bulk: 'var(--accent)', maintain: 'var(--muted)', custom: 'var(--cardio)' };
function relTicks(d0, d1) {
  const span = daysBetween(d0, d1);
  if (span <= 200) return null;
  const stepMo = span <= 800 ? 6 : 12, out = [];
  for (let m = stepMo; m * 30.44 <= span - 20; m += stepMo) out.push({ d: ds(addDays(parseDs(d0), Math.round(m * 30.44))), label: m % 12 ? `${m} mo` : `${m / 12} yr` });
  return out;
}
function phaseBands(phases, x, T, H, B, L, R, W) {
  if (!Array.isArray(phases) || !phases.length) return '';
  return phases.map(ph => {
    const a = Math.max(L, x(ph.start)), b = Math.min(W - R, x(ph.end));
    if (!(b > a + 0.5)) return '';
    const col = PHASE_COL[ph.goal] || 'var(--muted)';
    return `<rect x="${a.toFixed(1)}" y="${T}" width="${(b - a).toFixed(1)}" height="${H - T - B}" fill="${col}" opacity="${ph.goal === 'maintain' ? 0.04 : 0.08}"/><rect x="${a.toFixed(1)}" y="${H - B - 3}" width="${Math.max(0.5, b - a - 0.6).toFixed(1)}" height="3" fill="${col}" opacity=".7"/>`;
  }).join('');
}
export function lineChart({ id, data, past = [], W = 340, H = 150, mini = false, unit = '', target = null, targetLabel = '', color = 'var(--accent)', today = null, decimals = 1, phases = null }) {
  data = (data || []).filter(p => p && isFinite(p.v));
  if (data.length < 2) return '';
  const L = mini ? 2 : 34, R = mini ? 4 : 10, T = mini ? 4 : 12, B = mini ? 4 : 22;
  const all = [...data.map(p => p.v), ...data.map(p => p.lo).filter(isFinite), ...data.map(p => p.hi).filter(isFinite), ...past.map(p => p.v)];
  if (target != null && !mini) all.push(target);
  let lo = Math.min(...all), hi = Math.max(...all);
  const padv = (hi - lo) * 0.08 || 0.5; lo -= padv; hi += padv;
  if (!mini) { const st = hi - lo > 12 ? 5 : hi - lo > 5 ? 2 : hi - lo > 2 ? 1 : 0.5; lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st; }
  const xs = [...past.map(p => p.d), ...data.map(p => p.d)];
  const t0 = parseDs(xs[0]).getTime(), t1 = parseDs(xs[xs.length - 1]).getTime();
  const x = d => L + ((parseDs(d).getTime() - t0) / ((t1 - t0) || 1)) * (W - L - R);
  const y = v => T + (1 - (v - lo) / ((hi - lo) || 1)) * (H - T - B);
  const pts = data.map(p => [x(p.d), y(p.v)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const hasBand = data.every(p => isFinite(p.lo) && isFinite(p.hi));
  const band = hasBand ? data.map((p, i) => (i ? 'L' : 'M') + x(p.d).toFixed(1) + ' ' + y(p.hi).toFixed(1)).join(' ') + ' ' + [...data].reverse().map(p => 'L' + x(p.d).toFixed(1) + ' ' + y(p.lo).toFixed(1)).join(' ') + 'Z' : '';
  const gid = 'g' + id;
  let axes = '';
  if (!mini) {
    const ticks = [lo, (lo + hi) / 2, hi];
    axes = ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="var(--line)"/><text x="${L - 6}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${f1(t)}</text>`).join('')
      + xLabels(xs[0], xs[xs.length - 1], x, L, W, R, H);
    if (target != null && target > lo && target < hi) axes += `<line x1="${L}" x2="${W - R}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}" stroke="var(--good)" stroke-dasharray="4 4" opacity=".7"/><text x="${W - R}" y="${(y(target) - 4).toFixed(1)}" text-anchor="end" style="fill:var(--good)">${esc(targetLabel)}</text>`;
    if (today) { const tx = x(today); axes += `<line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="2 3"/><text x="${(tx + 4).toFixed(1)}" y="${T + 8}" style="font-weight:700">Today</text>`; }
  }
  const dots = past.map(p => `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5" fill="var(--muted)"/>`).join('');
  const [lx, ly] = pts[pts.length - 1];
  const tipData = [...past.map(p => [x(p.d), y(p.v), p.d, p.v, null, null, 1]), ...data.map((p, i) => [pts[i][0], pts[i][1], p.d, p.v, hasBand ? p.lo : null, hasBand ? p.hi : null, 0])]
    .map(a => a.map(v => typeof v === 'number' ? +v.toFixed(decimals + 1) : v));
  return `<svg class="chart bd-chart ${mini ? 'mini' : ''}" viewBox="0 0 ${W} ${H}" data-unit="${esc(unit)}" data-pts='${esc(JSON.stringify(tipData))}' ${mini ? 'preserveAspectRatio="none"' : ''}>
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${mini ? '' : phaseBands(phases, x, T, H, B, L, R, W)}
    ${axes}
    ${band ? `<path d="${band}" fill="${color}" opacity=".16"/>` : mini ? `<path d="${line} L${lx.toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z" fill="url(#${gid})"/>` : ''}
    ${dots}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${mini ? '' : `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${color}" stroke="var(--card)" stroke-width="2"/>`}
    ${mini ? '' : tipG(T, H - B)}
  </svg>`;
}
// First/last dates, or relative ticks (6 mo, 1 yr…) for long spans.
function xLabels(d0, d1, x, L, W, R, H) {
  const t = relTicks(d0, d1);
  if (!t) return `<text x="${L}" y="${H - 6}">${fmtShort(d0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${fmtShort(d1)}</text>`;
  return `<text x="${L}" y="${H - 6}">Now</text>` + t.map(k => `<line x1="${x(k.d).toFixed(1)}" x2="${x(k.d).toFixed(1)}" y1="${H - 22}" y2="${H - 18}" stroke="var(--muted)"/><text x="${x(k.d).toFixed(1)}" y="${H - 6}" text-anchor="middle">${k.label}</text>`).join('')
    + `<text x="${W - R}" y="${H - 6}" text-anchor="end" style="opacity:${x(t[t.length - 1].d) > W - R - 40 ? 0 : 1}">${fmtShort(d1).replace(/ \d{4}$/, '')}${d1.slice(0, 4) !== d0.slice(0, 4) ? ' ’' + d1.slice(2, 4) : ''}</text>`;
}
const tipG = (y1, y2) => `<g class="bd-tip-g" style="display:none"><line y1="${y1}" y2="${y2}" stroke="var(--muted)" stroke-dasharray="3 3"/><circle r="4.5" fill="var(--text)" stroke="var(--card)" stroke-width="2"/><rect rx="6" height="20" fill="var(--card2)" stroke="var(--line)"/><text style="fill:var(--text);font-weight:700" text-anchor="middle"></text></g>`;

// Generic nearest-x tooltip. Each point: [x, y, text].
function showTip(svg, tip, best) {
  const vb = svg.viewBox.baseVal; const [px, py, txt] = best;
  const w = Math.max(80, String(txt).length * 6.1 + 14);
  tip.style.display = '';
  const ln = tip.querySelector('line'); ln.setAttribute('x1', px); ln.setAttribute('x2', px);
  const c = tip.querySelector('circle'); c.setAttribute('cx', px); c.setAttribute('cy', py);
  const rx = Math.min(Math.max(px - w / 2, 2), vb.width - w - 2);
  const rect = tip.querySelector('rect'); rect.setAttribute('x', rx); rect.setAttribute('y', 0); rect.setAttribute('width', w);
  const t = tip.querySelector('text'); t.setAttribute('x', rx + w / 2); t.setAttribute('y', 14); t.textContent = txt;
}
const nearest = (svg, ev, pts) => {
  const box = svg.getBoundingClientRect(); const xv = ((ev.clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
  let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p; return best;
};

export function bindCharts(root) {
  root.querySelectorAll('svg.bd-chart:not(.mini):not([data-bound])').forEach(svg => {
    svg.dataset.bound = '1';
    const pts = safe(() => JSON.parse(svg.dataset.pts || '[]'), []); const tip = svg.querySelector('.bd-tip-g'); if (!tip || !pts.length) return;
    const unit = svg.dataset.unit || '';
    const show = ev => {
      const best = nearest(svg, ev, pts);
      if (svg.dataset.kind === 'text') { showTip(svg, tip, best); return; }
      const [px, py, d, v, lo, hi] = best;
      showTip(svg, tip, [px, py, `${f1(v)}${unit === '%' ? '%' : ' ' + unit}${lo != null && hi != null && Math.abs(hi - lo) > 0.15 ? ` (${f1(lo)}–${f1(hi)})` : ''} · ${fmtShort(d)}`]);
    };
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  });
}

// Stacked lean + fat = weight, from zero (honest split), direct-labelled.
function compChart(S, W = 340, H = 150, phases = null) {
  const L = 34, R = 10, T = 26, B = 22;
  const top = Math.ceil(Math.max(...S.map(p => p.weightLb)) / 20) * 20;
  const t0 = parseDs(S[0].date).getTime(), t1 = parseDs(S[S.length - 1].date).getTime();
  const x = d => L + ((parseDs(d).getTime() - t0) / ((t1 - t0) || 1)) * (W - L - R);
  const y = v => T + (1 - v / top) * (H - T - B);
  const P = (arr) => arr.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const leanTop = S.map(p => [x(p.date), y(p.leanLb)]), wTop = S.map(p => [x(p.date), y(p.weightLb)]);
  const base = `L${x(S[S.length - 1].date).toFixed(1)} ${y(0)} L${x(S[0].date).toFixed(1)} ${y(0)}Z`;
  const fatArea = P(wTop) + ' ' + [...leanTop].reverse().map(p => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + 'Z';
  const ticks = [0, top / 2, top];
  const s0 = S[0], sN = S[S.length - 1];
  const tip = S.map(p => [+x(p.date).toFixed(1), +y(p.weightLb).toFixed(1), `${fmtShort(p.date)}: lean ${f1(p.leanLb)} + fat ${f1(p.fatLb ?? p.weightLb - p.leanLb)} lb`]);
  const midY = (a, b) => ((y(a) + y(b)) / 2 + 4).toFixed(1);
  return `<svg class="chart bd-chart" data-kind="text" viewBox="0 0 ${W} ${H}" data-pts='${esc(JSON.stringify(tip))}'>
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="var(--line)"/><text x="${L - 6}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${f1(t)}</text>`).join('')}
    <path d="${P(leanTop)} ${base}" fill="var(--good)" opacity=".55"/>
    <path d="${fatArea}" fill="var(--accent2)" opacity=".75"/>
    <path d="${P(leanTop)}" fill="none" stroke="var(--card)" stroke-width="2"/>
    <text x="${L + 8}" y="${midY(0, s0.leanLb)}" style="fill:var(--text);font-weight:750">Lean ${f1(s0.leanLb)} → ${f1(sN.leanLb)} lb</text>
    <text x="${L + 2}" y="${T - 8}" style="fill:var(--accent2);font-weight:750">Fat ${f1(s0.fatLb ?? s0.weightLb - s0.leanLb)} → ${f1(sN.fatLb ?? sN.weightLb - sN.leanLb)} lb</text>
    ${xLabels(s0.date, sN.date, x, L, W, R, H)}
    ${phaseBands(phases, x, T, H, B, L, R, W)}
    ${tipG(T, H - B)}
  </svg>`;
}

// ---------------- state ----------------
const DEF_OPTS = { weeks: 12, until: null, adherence: null, repeat: true, kcal: null, pg: null, fatPct: null, cdelta: 0, cmod: null, cint: 'easy', view: 'proj', scrub: null, pose: 'relaxed', useStack: true, ph: null, stackOff: [] };
function getOpts(store) { return { ...DEF_OPTS, ...(safe(() => store.kv('projection'), null) || {}) }; }
function setOpts(store, patch) { const o = { ...getOpts(store), ...patch }; store.kv('projection', o); return o; }
const PRESETS = [['Cut', -500], ['Recomp', -250], ['Maintain', 0], ['Lean bulk', 300], ['Bulk', 600], ['Dirty bulk', 1000]];

const MAXW = PJ.MAX_WEEKS || 104;
function weeksOf(o) {
  if (o.until) { const n = Math.ceil(daysBetween(ds(), o.until) / 7); if (n >= 1) return Math.min(MAXW, n); }
  return clampN(Math.round(o.weeks || 12), 1, MAXW);
}
// Horizon slider: positions 0..48 = 4..52 weeks (weekly), then quarterly (13-week) steps up to MAXW (8 years).
const H_FINE = 48;
const hMax = () => (MAXW > 52 ? H_FINE + Math.ceil((MAXW - 52) / 13) : Math.max(0, Math.min(H_FINE, MAXW - 4)));
const weeksAtPos = p => (p <= H_FINE ? 4 + p : Math.min(MAXW, 52 + 13 * (p - H_FINE)));
const posOfWeeks = w => (w <= 52 ? clampN(w - 4, 0, H_FINE) : clampN(H_FINE + Math.round((w - 52) / 13), 0, hMax()));
export function horizonText(w) {
  w = Math.round(w);
  if (w < 26) return `${w} week${w === 1 ? '' : 's'}`;
  if (w < 104) return `${Math.round(w / 4.345)} months`;
  const y = Math.round(w / 52.18 * 4) / 4;
  return `${Number.isInteger(y) ? y : y.toFixed(2).replace(/0$/, '')} years`;
}
const H_CHIPS = [[12, '12 wk'], [26, '6 mo'], [52, '1 yr'], [104, '2 yr'], [260, '5 yr'], [418, '8 yr']];
// "Week 9" early on, "Month 14" / "Year 3.5" later (for the scrubber and the end card).
const whenText = wk => (wk < 26 ? `Week ${wk}` : wk < 104 ? `Month ${Math.round(wk / 4.345)}` : `Year ${Math.round(wk / 52.18 * 10) / 10}`);
export function whatIfDefaults(profile) {
  const t = targetsOf(profile);
  if (t?.nutrition) return { pg: clampN(Number(t.nutrition.proteinGPerLb) || 1, 0.6, 1.4), fatPct: clampN(Number(t.nutrition.fatPct) || 25, 15, 40) };
  const n = profile.nutrition || {}, bw = Number(profile.bodyweight) || 0;
  const pg = Number(n.proteinGPerLb) > 0 ? Number(n.proteinGPerLb) : Number(n.protein) > 0 && bw ? Math.round(n.protein / bw * 20) / 20 : 1.0;
  return { pg: clampN(pg, 0.6, 1.4), fatPct: clampN(Number(n.fatPct) > 0 ? Number(n.fatPct) : 25, 15, 40) };
}
const newEngine = () => typeof PJ.nutritionLab === 'function';

function inputs(store) {
  const profile = store.getProfile();
  const bodyLog = safe(() => store.getBodyLog(), []);
  const measurements = safe(() => store.getMeasurements(), []);
  const sessions = safe(() => store.getSessions(), []);
  const foodLog = safe(() => store.getFoodLog(), []);
  const now = new Date();
  const b = safe(() => BC.baseline({ profile, bodyLog, measurements, now, foodLog }), null);
  return { profile, bodyLog, measurements, sessions, foodLog, now, b, targets: targetsOf(profile, sessions) };
}
// Phase-2 engine fallback: extra weekly cardio as its energy cost per day (no interference modelled).
function cardioKcalDay(I, o) {
  if (!o.cdelta) return 0;
  return Math.sign(o.cdelta) * estimateCalories(o.cmod, Math.abs(o.cdelta), o.cint, I.b?.weightLb || 165) / 7;
}
// Saved plan (profile.nutrition.phasePlan, else the shared dated list) and the preview selection.
function savedPlan(profile) {
  const n = profile?.nutrition || {};
  if (n.phasePlan && (n.phasePlan.preset || (n.phasePlan.blocks || []).length)) return n.phasePlan;
  return Array.isArray(n.phases) && n.phases.length ? n.phases : null;
}
function planOf(I, o) {
  if (o.ph === 'single') return null;
  if (o.ph && typeof o.ph === 'object') return o.ph;
  return savedPlan(I.profile);
}
// Planned cardio min/week over the next 4 weeks (unscaled by adherence), for "target X · planned Y".
function plannedCardio(I) {
  const t0 = ds(I.now), t1 = ds(addDays(I.now, 27));
  let min = 0;
  for (const s of I.sessions || []) {
    if (!s || s.status !== 'planned' || s.date < t0 || s.date > t1) continue;
    for (const b of s.blocks || []) min += b?.kind === 'cardio' ? Number(b.minutes) || 0 : b?.kind === 'class' ? Number(b.classify?.cardioMinutes) || 0 : 0;
  }
  return Math.round(min / 4);
}
const adhOf = (I, o) => o.adherence ?? I.targets?.adherence ?? 0.85;
const cmodOf = (I, o) => o.cmod ?? (I.targets?.cardio?.modalities || []).find(m => CARDIO[m]) ?? 'bike';
// Per-item stack toggles (preview only; the saved stack is unchanged): drop switched-off items from the profile view.
export function profFor(I, o) {
  const off = Array.isArray(o?.stackOff) ? o.stackOff : [];
  if (!off.length) return I.profile;
  return { ...I.profile, supplements: (I.profile.supplements || []).filter(x => !off.includes(x?.id)) };
}
function runProject(I, o, weeks, kcal, pg, fatPct, plan = null) {
  if (!I.b) return null;
  const base = { baseline: I.b, profile: profFor(I, o), sessions: I.sessions, weeks, now: I.now, adherence: adhOf(I, o), repeatPlan: o.repeat, useStack: o.useStack !== false };
  if (newEngine()) {
    const intake = { proteinGPerLb: pg, fatPct }; if (kcal != null && !plan) intake.calories = kcal;
    return safe(() => PJ.project({ ...base, bodyLog: I.bodyLog, foodLog: I.foodLog, intake, cardioDeltaMin: o.cdelta || 0, cardioModality: cmodOf(I, o), cardioIntensity: o.cint,
      phases: plan || null, stopAtGoal: true }), null);
  }
  const r = safe(() => PJ.project({ ...base, intake: kcal == null ? null : kcal - cardioKcalDay(I, o) }), null);
  if (r?.energy && o.cdelta) r.energy = { ...r.energy, tdeeStart: Math.round(r.energy.tdeeStart + cardioKcalDay(I, o)), intakeStart: kcal == null ? r.energy.intakeStart : kcal };
  if (r?.weekly && o.cdelta) r.weekly = { ...r.weekly, cardioMinPerWeek: (r.weekly.cardioMinPerWeek || 0) + o.cdelta };
  return r;
}

// Normalises a lab result to deltas (lb gained over the horizon) and fills sweetSpot/explanation if missing.
let labCache = { key: null, v: null };
export function labData(I, o, weeks, maint, pg, fatPct) {
  if (!I.b || !I.b.weightLb) return null;
  const key = JSON.stringify([weeks, adhOf(I, o), o.repeat, cmodOf(I, o), o.useStack !== false, JSON.stringify(o.stackOff || []), JSON.stringify(I.profile.supplements || []), JSON.stringify(I.profile.metabolic || {}), pg, fatPct, o.cdelta, o.cmod, o.cint, I.b.weightLb, I.b.bodyFatPct, I.sessions.length, Math.round(maint || 0), newEngine()]);
  if (labCache.key === key) return labCache.v;
  const bf0 = I.b.bodyFatPct ?? 20, lean0 = I.b.comp?.leanLb ?? I.b.weightLb * (1 - bf0 / 100), fat0 = I.b.weightLb - lean0;
  let raw = null;
  if (newEngine()) {
    raw = safe(() => PJ.nutritionLab({ baseline: I.b, profile: profFor(I, o), sessions: I.sessions, bodyLog: I.bodyLog, foodLog: I.foodLog, weeks, now: I.now, calorieRange: [-750, 1000], step: 125,
      proteinGPerLb: pg, fatPct, cardioDeltaMin: o.cdelta || 0, cardioModality: cmodOf(I, o), cardioIntensity: o.cint, adherence: adhOf(I, o), repeatPlan: o.repeat, useStack: o.useStack !== false }), null);
  }
  if (!raw || !(raw.points || []).length) {
    if (!maint) return null;
    const points = [];
    for (let s = -750; s <= 1000; s += 125) {
      const r = runProject(I, o, weeks, maint + s, pg, fatPct); const e = r?.series?.[r.series.length - 1]; if (!e) continue;
      points.push({ surplus: s, calories: Math.round(maint + s), leanLb: e.leanLb, fatLb: e.fatLb ?? e.weightLb - e.leanLb, weightLb: e.weightLb, bodyFatPct: e.bodyFatPct });
    }
    raw = { points, sweetSpot: null, explanation: null, local: true };
  }
  // Absolute end values vs deltas: lean mass > 40 lb can only be an absolute value.
  const abs = raw.points.some(p => Math.abs(p.leanLb) > 40);
  const pts = raw.points.map(p => {
    const lean = abs ? p.leanLb - lean0 : p.leanLb, fat = abs ? (p.fatLb ?? (p.weightLb - p.leanLb)) - fat0 : p.fatLb;
    return { surplus: p.surplus ?? (p.calories - maint), calories: p.calories ?? Math.round(maint + p.surplus), lean, fat, bf: p.bodyFatPct, share: p.leanShare };
  }).filter(p => isFinite(p.lean) && isFinite(p.fat)).sort((a, b) => a.surplus - b.surplus);
  let sweet = raw.sweetSpot && isFinite(raw.sweetSpot.from) ? raw.sweetSpot : null;
  if (!sweet && pts.length > 2) {
    const maxL = Math.max(...pts.map(p => p.lean));
    const from = pts.find(p => p.lean >= maxL * 0.8 && p.surplus >= 0) || pts.find(p => p.lean >= maxL * 0.8);
    const to = pts.find(p => p.lean >= maxL * 0.97) || pts[pts.length - 1];
    if (from && to) sweet = { from: from.surplus, to: Math.max(to.surplus, from.surplus + 125), note: 'Most of the possible muscle, without paying for it in fat.' };
  }
  const explanation = (raw.explanation && raw.explanation.length) ? raw.explanation : [
    'Muscle can only be built so fast. Your training age, weekly volume and protein set a ceiling on lean gain.',
    'A modest surplus gets you close to that ceiling. Every calorie beyond it can\'t become muscle, so it is stored as fat.',
    'In a deficit you lose fat, and as a newer lifter you can still add some muscle (recomp), just more slowly.',
    'Some of what you lose is lean tissue, whatever your goal is called. How much depends on how lean you already are, how fast the weight comes off and how much protein you eat.',
  ];
  const v = { points: pts, sweet, explanation, local: !!raw.local, lean0, fat0 };
  labCache = { key, v };
  return v;
}

function compute(store, o) {
  const I = inputs(store);
  const weeks = weeksOf(o);
  const d = whatIfDefaults(I.profile);
  const pg = o.pg ?? d.pg, fatPct = o.fatPct ?? d.fatPct;
  const plan = planOf(I, o);
  let res = null, kcal = o.kcal;
  if (I.b && I.b.weightLb) {
    if (plan) {
      res = runProject(I, o, weeks, null, pg, fatPct, plan);
      if (kcal == null) kcal = res?.energy?.intakeStart ? Math.round(res.energy.intakeStart / 25) * 25 : null;
    } else {
      if (kcal == null) {
        const r0 = runProject(I, o, weeks, null, pg, fatPct);
        kcal = r0?.energy?.intakeStart ? Math.round(r0.energy.intakeStart / 25) * 25 : null;
        res = kcal == null ? r0 : null;
      }
      if (!res) res = runProject(I, o, weeks, kcal, pg, fatPct);
    }
  }
  const maint = res?.energy?.tdeeStart || (I.b?.weightLb ? Math.round(I.b.weightLb * 15.5) : null);
  if (kcal == null && maint) kcal = maint;
  const today = ds(I.now), end = ds(addDays(I.now, weeks * 7 - 1));
  const planned = I.sessions.filter(s => s.status === 'planned' && s.date >= today && s.date <= end && !(s.plan && s.plan.kind === 'rest' && !(s.blocks || []).length));
  const nutritionOn = I.profile.nutrition && I.profile.nutrition.mode && I.profile.nutrition.mode !== 'off';
  const goalBf = Number(I.targets?.goals?.goalBodyFatPct) || Number(I.profile.body?.goalBodyFat) || (I.b?.sex === 'female' ? BODY.female.goalBodyFat : BODY.male.goalBodyFat);
  return { ...I, res, weeks, planned, nutritionOn, end, kcal, maint, pg, fatPct, plan, adherence: adhOf(I, o), cmod: cmodOf(I, o), goalBf };
}

// Maintenance, current intake and a 12-week lab for other screens (nutrition). Ignores what-if kcal/macros/cardio.
export function nutritionContext(store, { weeks = 12, pg = null, fatPct = null } = {}) {
  const o = { ...getOpts(store), kcal: null, pg, fatPct, cdelta: 0, until: null, weeks, ph: null };
  const D = compute(store, o);
  if (!D.res || !D.b?.weightLb) return null;
  return { maint: D.maint, intake: D.kcal, weight: D.b.weightLb, pg: D.pg, fatPct: D.fatPct, weeks, lab: safe(() => labData(D, o, weeks, D.maint, D.pg, D.fatPct), null),
    // §20: for the energy-availability check on Nutrition (lean mass from the baseline, net exercise kcal/day from the projection).
    leanLb: D.b.comp?.leanLb ?? (D.b.bodyFatPct != null ? D.b.weightLb * (1 - D.b.bodyFatPct / 100) : null), exerciseKcal: D.res?.energy?.exerciseKcal ?? null, sex: D.b.sex || 'male' };
}

// Formula maintenance (kcal/day) with the current plan, for the food-log status on Measurements.
export function maintenanceEstimate(store) {
  const D = compute(store, { ...getOpts(store), kcal: null, cdelta: 0, until: null, ph: null, weeks: 12 });
  const e = D.res?.energy; if (!e) return null;
  return { formula: e.tdeeFormula ?? e.tdeeStart, calibrated: e.tdeeStart, calibration: D.res.tdeeCalibration || null };
}

// ---------------- render pieces ----------------
const SITE_ROWS = [['waist', 'Waist', 'down'], ['shoulders', 'Shoulders', 'up'], ['chest', 'Chest', 'up'], ['arm', 'Arms', 'up', 'armL', 'armR'], ['forearm', 'Forearm', 'up'], ['neck', 'Neck', 'up'], ['hips', 'Hips', 'down'], ['thigh', 'Thighs', 'up', 'thighL', 'thighR'], ['calf', 'Calves', 'up', 'calfL', 'calfR']];

function keyNums(p, p0, H, sex = 'male') {
  if (!p) return '';
  const sh = p.shape || p.measurements || {}, sh0 = p0.shape || p0.measurements || {};
  const sw = s => s.ratios?.shoulderToWaist ?? ((s.shape || s.measurements || {}).shoulders && (s.shape || s.measurements || {}).waist ? (s.shape || s.measurements).shoulders / (s.shape || s.measurements).waist : null);
  const same = p === p0;
  const cell = (v, v0, u, l, dir, dec = 1) => {
    const ok = v != null && isFinite(v);
    const dl = ok && v0 != null && !same ? v - v0 : null;
    const col = dl == null || Math.abs(dl) < 0.05 ? 'var(--muted)' : dir === 'none' ? 'var(--muted)' : (dl < 0) === (dir === 'down') ? 'var(--good)' : 'var(--warn)';
    return `<div><b class="num">${ok ? (dec === 2 ? v.toFixed(2) : f1(v)) + `<small>${u}</small>` : '—'}</b><span>${l}</span>${!same ? `<em class="num" style="color:${col}">${dl == null || Math.abs(dl) < (dec === 2 ? 0.005 : 0.05) ? '—' : dec === 2 ? (dl > 0 ? '+' : '−') + Math.abs(dl).toFixed(2) : sgn(dl)}</em>` : ''}</div>`;
  };
  const fat = q => q.fatLb ?? (q.weightLb - q.leanLb);
  const whr = s => s.ratios?.waistToHip ?? ((s.shape || s.measurements || {}).waist && (s.shape || s.measurements || {}).hips ? (s.shape || s.measurements).waist / (s.shape || s.measurements).hips : null);
  return `<div class="bd-keys ${same ? '' : 'delta'}">${cell(p.weightLb, p0.weightLb, 'lb', 'weight', 'none')}${cell(p.bodyFatPct, p0.bodyFatPct, '%', 'body fat', 'down')}${cell(p.leanLb, p0.leanLb, 'lb', 'lean', 'up')}
    ${cell(fat(p), fat(p0), 'lb', 'fat', 'down')}${cell(sh.waist, sh0.waist, '″', 'waist', 'down')}${sex === 'female' ? cell(whr(p), whr(p0), '', 'waist:hip', 'down', 2) : cell(sw(p), sw(p0), '', 'V-taper', 'up', 2)}</div>`;
}

function setupCard(b, res) {
  const note = res && !(res.series || []).length && res.assumptions && res.assumptions[0];
  if (res?.paused === 'pregnancy') {
    return `<div class="card hero center bd-setup" data-paused="pregnancy">
    <h2>Projection paused</h2>
    <p class="small muted mt" style="margin-top:6px">${esc(note || 'Projection paused during pregnancy.')}</p>
    <button class="btn btn-block mt" data-nav="measure">Body profile</button>
  </div>`;
  }
  return `<div class="card hero center bd-setup">
    <div class="bd-setup-sil">${silhouetteSVG({}, { bodyFatPct: 18, heightIn: b?.heightIn || 69 })}</div>
    <h2>See where your training takes you</h2>
    <p class="small muted mt" style="margin-top:6px">Log your weight (plus height, waist and neck for a body-fat estimate). Forge then projects weight, body fat, lean mass and your shape from your planned workouts, cardio and intake.</p>
    ${note ? `<p class="tiny muted mt">${esc(note)}</p>` : ''}
    <button class="btn btn-primary btn-block mt" data-nav="measure">Log measurements</button>
  </div>`;
}

function scrubIdx(o, S) { const n = S.length - 1; return o.view === 'now' ? 0 : clampN(o.scrub == null ? n : o.scrub, 0, n); }

function heroSvg(S, i, H, sex = 'male') {
  const p0 = S[0], p = S[i];
  if (i === 0) return `<div class="bd-sil-wrap big">${silhouetteSVG(shapeOf(p0, H), { bodyFatPct: p0.bodyFatPct, heightIn: H, sex })}</div>`;
  return `<div class="bd-pair"><div class="bd-col"><div class="bd-cap">Now</div><div class="bd-sil-wrap">${silhouetteSVG(shapeOf(p0, H), { bodyFatPct: p0.bodyFatPct, heightIn: H, sex })}</div></div><div class="bd-arrow">→</div>
    <div class="bd-col then"><div class="bd-cap">${esc(whenText(p.week ?? i))}</div><div class="bd-sil-wrap">${silhouetteSVG(shapeOf(p, H), { bodyFatPct: p.bodyFatPct, heightIn: H, sex, compare: { measurements: shapeOf(p0, H) } })}</div></div></div>`;
}
function heroInfo(D, o) {
  const S = D.res.series, i = scrubIdx(o, S), p = S[i], H = D.b.heightIn || 69;
  const wk = p.week ?? i;
  const lbl = i === 0 ? 'Now' : `${whenText(wk)} · ${fmtShort(p.date)}${p.date.slice(0, 4) !== S[0].date.slice(0, 4) ? ' ' + p.date.slice(0, 4) : ''}`;
  const ph = p.phase && i ? `<span class="bd-phtag" style="color:${PHASE_COL[p.phase.goal] || 'var(--muted)'}">${esc(p.phase.atMaintenance ? 'Maintenance' : p.phase.label || '')}</span>` : '';
  return `<div class="row between bd-scrubhead"><div class="bd-cap">${esc(lbl)}${i ? ' <span class="muted">vs now</span>' : ''} ${ph}</div><div class="tiny muted">${esc(horizonText(D.weeks))}</div></div>
    ${keyNums(p, S[0], H, D.b?.sex)}`;
}

function horizonGroup(D, o) {
  const w = D.weeks, p = posOfWeeks(w), mx = hMax();
  return `<div class="bd-grp bd-hgrp">
      <div class="row between"><div class="label">How far ahead</div><div class="num bold" id="pjHV">${esc(horizonText(w))}</div></div>
      <input type="range" class="bd-range" id="pjH" min="0" max="${mx}" step="1" value="${p}" style="--pct:${(p / (mx || 1)) * 100}%" aria-label="Projection horizon" aria-valuetext="${esc(horizonText(w))}">
      <div class="bd-hscale tiny muted"><span>4 wk</span><span style="left:${(48 / mx) * 100}%">1 yr</span><span>${MAXW >= 418 ? '8 yr' : horizonText(MAXW)}</span></div>
      <div class="chips bd-hchips">${H_CHIPS.filter(([v]) => v <= MAXW).map(([v, l]) => `<button class="chip sm ${w === v ? 'active' : ''}" data-hw="${v}">${l}</button>`).join('')}</div>
    </div>`;
}
function controls(D, o) {
  const m = macros(D.profile, { calories: D.kcal, bodyweight: D.b.weightLb, proteinGPerLb: D.pg, fatPct: D.fatPct });
  const lo = Math.round((D.maint - 1000) / 50) * 50, hi = Math.round((D.maint + 1500) / 50) * 50;
  const pctOf = (v, a, b) => ((v - a) / (b - a)) * 100;
  const mods = Object.values(CARDIO).map(c => `<option value="${c.id}" ${D.cmod === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const ints = Object.entries(INTENSITIES).map(([k, v]) => `<option value="${k}" ${o.cint === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  const strip = TGU && typeof TGU.targetsSummaryHTML === 'function' && D.ctx ? safe(() => TGU.targetsSummaryHTML(D.ctx), '') : '';
  const tgtC = D.targets?.cardio?.minPerWeek;
  const planC = plannedCardio(D), baseC = tgtC ?? planC;
  return `<div class="card bd-ctrl" id="pjCtrl">
    ${strip ? `<div class="bd-tgstrip">${strip}</div>` : ''}
    <div class="row between"><div class="card-title">What if… <span class="badge">preview</span></div><button class="link small" data-reset>Reset to my targets</button></div>
    <p class="tiny muted" style="margin-top:2px">Sliders only change this projection. Nothing is saved until you tap Apply.</p>
    ${horizonGroup(D, o)}

    <div class="bd-grp ${D.plan ? 'bd-dim' : ''}" id="pjKcalGrp">
      <div class="row between"><div class="label">Calories${D.plan ? ' <span class="tiny muted">(phases set them)</span>' : ''}</div><div class="tiny muted" id="pjMaint">maintenance ≈ ${kfmt(D.maint)}</div></div>
      <div class="bd-kcal"><b class="num" id="pjKcalV">${kfmt(D.kcal)}</b><span> kcal/day${D.plan ? ' to start' : ''}</span><em class="num" id="pjKcalD">${sgnK(D.kcal - D.maint)} vs maintenance</em></div>
      <input type="range" class="bd-range" id="pjKcal" min="${lo}" max="${hi}" step="25" value="${D.kcal}" style="--pct:${pctOf(D.kcal, lo, hi)}%" aria-label="Calories per day">
      <div class="chips bd-presets" id="pjPresets">${PRESETS.map(([l, off]) => `<button class="chip sm" data-preset="${off}"><b>${l}</b> <span>${off > 0 ? '+' : off < 0 ? '−' : ''}${off ? Math.abs(off) : '±0'}</span></button>`).join('')}</div>
      ${D.plan ? '<div class="tiny muted" style="margin-top:6px">Moving the slider switches to one constant intake.</div>' : D.weeks > 52 ? '<div class="tiny muted" style="margin-top:6px">One intake held for years: weight drifts toward a new steady state. Phases below are the realistic way to plan this far ahead.</div>' : ''}
    </div>

    <div class="bd-grp">
      <div class="row between"><div class="label">Protein</div><div class="num bold" id="pjPgV">${D.pg.toFixed(2)} g/lb</div></div>
      <input type="range" class="bd-range" id="pjPg" min="0.6" max="1.4" step="0.05" value="${D.pg}" style="--pct:${pctOf(D.pg, 0.6, 1.4)}%" aria-label="Protein grams per pound">
      <div class="row between"><div class="label">Fat</div><div class="num bold" id="pjFatV">${D.fatPct}% of kcal</div></div>
      <input type="range" class="bd-range" id="pjFat" min="15" max="40" step="1" value="${D.fatPct}" style="--pct:${pctOf(D.fatPct, 15, 40)}%" aria-label="Fat percent of calories">
      <div class="tiny muted" style="margin:-2px 0 8px">Carbs fill the rest.</div>
      <div id="pjMacros">${macroBar(m)}${warnList(m.warnings)}</div>
    </div>

    <div class="bd-grp">
      <div class="row between"><div class="label">Cardio <span class="tiny muted">what-if</span></div><div class="tiny muted" id="pjCardioBase">${tgtC != null ? `target ${tgtC} · ` : ''}planned ${planC} min/wk</div></div>
      <div class="bd-step"><button class="btn bd-stepb" data-cstep="-15" aria-label="15 fewer minutes">−</button>
        <div class="bd-stepv"><b class="num" id="pjCdV">${sgnK(o.cdelta)}</b><span>min / week on top of the plan</span></div>
        <button class="btn bd-stepb" data-cstep="15" aria-label="15 more minutes">+</button></div>
      <div class="chips bd-cquick">${[30, 60, 120].map(v => `<button class="chip sm" data-cadd="${v}">+${v}</button>`).join('')}<button class="chip sm" data-cadd="0">Reset</button></div>
      <div class="grid2" style="margin-top:10px"><select id="pjCmod" aria-label="Cardio type">${mods}</select><select id="pjCint" aria-label="Cardio intensity">${ints}</select></div>
      <div class="tiny muted" id="pjCburn" style="margin-top:6px">${cardioBurn(D, o)}</div>
      <button class="btn btn-sm btn-ghost btn-block" id="pjCApply" style="margin-top:8px;${o.cdelta ? '' : 'display:none'}">Make ${Math.max(0, baseC + (o.cdelta || 0))} min/wk my cardio target</button>
    </div>

    ${stackGroup(D, o)}
    <div class="bd-grp">
      <div class="row between"><div class="label">Adherence</div><div class="num bold" id="pjAdhV">${Math.round(D.adherence * 100)}%</div></div>
      <input type="range" class="bd-range" min="0.6" max="1" step="0.05" value="${D.adherence}" id="pjAdh" style="--pct:${((D.adherence - 0.6) / 0.4) * 100}%" aria-label="Adherence">
      <div class="tiny muted" style="margin-top:-4px">Share of planned sessions you actually do${D.targets ? ` (your target: ${Math.round(D.targets.adherence * 100)}%)` : ''}.</div>
      <div class="set-row" style="border:0;padding-bottom:0"><div class="grow"><div class="t">Repeat my plan</div><div class="s">Weeks after the last planned day reuse your average week</div></div><label class="switch"><input type="checkbox" id="pjRepeat" ${o.repeat ? 'checked' : ''}><span></span></label></div>
    </div>
    <button class="btn btn-primary btn-block" data-apply>Apply to my targets</button>
    <div class="tiny muted center" id="pjApplyNote" style="margin-top:6px">${applyNote(D)}</div>
  </div>`;
}

// ---------------- Nutrition phases ----------------
const GOAL_OPTS = [['lean_bulk', 'Lean bulk'], ['bulk', 'Bulk'], ['cut', 'Cut'], ['maintain', 'Maintain'], ['custom', 'Custom kcal']];
const presetOf = id => (PJ.PHASE_PRESETS || []).find(p => p.id === id) || null;
function planBlocks(plan) {
  if (!plan) return null;
  if (Array.isArray(plan)) return null;   // dated list (shown as the timeline only)
  return (plan.blocks && plan.blocks.length ? plan.blocks : presetOf(plan.preset)?.blocks) || null;
}
function phaseSel(D, o) {
  if (o.ph === 'single' || !D.plan) return 'single';
  if (o.ph && typeof o.ph === 'object') return o.ph.preset || 'custom';
  return 'saved';
}
function timelineStrip(phases, weeks) {
  if (!phases.length) return '';
  return `<div class="bd-tl" role="img" aria-label="Nutrition phase timeline">${phases.map(ph => {
    const w = (Math.min(ph.endWeek, weeks) - ph.startWeek) / weeks * 100;
    if (w <= 0) return '';
    const kc = ph.mode === 'track' ? '±0' : ph.calories ? kfmt(ph.calories) : sgnK(ph.surplus);
    return `<i style="flex:${w};background:${PHASE_COL[ph.goal] || 'var(--muted)'}" title="${esc(ph.label)} ${esc(fmtShort(ph.start))}–${esc(fmtShort(ph.end))}">${w > 9 ? `<span>${esc(kc)}</span>` : ''}</i>`;
  }).join('')}</div>
    <div class="bd-tlax tiny muted"><span>Now</span><span>${esc(horizonText(weeks))}</span></div>`;
}
function phasesCard(D, o) {
  const sel = phaseSel(D, o);
  const res = D.res, phases = res.phases || [];
  const blocks = sel === 'custom' || (sel !== 'single' && sel !== 'saved') ? planBlocks(D.plan) : null;
  const saved = savedPlan(D.profile);
  const chips = [['single', 'One intake'], ...(saved ? [['saved', 'My saved plan']] : []), ...(PJ.PHASE_PRESETS || []).map(p => [p.id, p.label]), ['custom', 'Custom']];
  const desc = sel === 'single' ? 'One constant intake (the calorie slider above) for the whole horizon.' : sel === 'saved' ? 'The phases saved in your nutrition targets.' : sel === 'custom' ? 'Your own blocks, below.' : presetOf(sel)?.desc || '';
  const editor = sel !== 'single' && sel !== 'saved' && blocks ? `<div class="bd-blocks" id="pjBlocks">${blocks.map((b, i) => `
      <div class="bd-block" data-bi="${i}"><span class="bd-bdot" style="background:${PHASE_COL[b.goal] || 'var(--muted)'}"></span>
        <select data-bf="goal" aria-label="Phase ${i + 1} goal">${GOAL_OPTS.map(([v, l]) => `<option value="${v}" ${b.goal === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="bd-bnum"><input type="number" inputmode="numeric" min="1" max="${MAXW}" data-bf="weeks" value="${b.weeks}" aria-label="Weeks"><span>wk</span></label>
        ${b.goal === 'maintain' ? '<span class="bd-bnum muted tiny">±0</span>' : b.goal === 'custom'
          ? `<label class="bd-bnum"><input type="number" inputmode="numeric" step="50" min="1000" max="6000" data-bf="calories" value="${b.calories ?? Math.round(D.maint)}" aria-label="kcal per day"><span>kcal</span></label>`
          : `<label class="bd-bnum"><input type="number" inputmode="numeric" step="25" min="-1500" max="1500" data-bf="surplus" value="${b.surplus ?? 0}" aria-label="kcal vs maintenance"><span>±kcal</span></label>`}
        <button class="bd-bdel" data-bdel="${i}" aria-label="Remove phase" ${blocks.length < 2 ? 'disabled' : ''}>✕</button></div>`).join('')}
      <div class="row between" style="margin-top:8px"><button class="btn btn-sm btn-ghost" data-badd>+ Add phase</button>
        <label class="row tiny" style="gap:6px">Repeat <span class="switch sm"><input type="checkbox" id="pjBRep" ${D.plan?.repeat !== false ? 'checked' : ''}><span></span></span></label></div></div>` : '';
  const first = phases[0];
  return `<div class="card bd-phcard" id="pjPhases">
    <div class="row between"><div class="card-title">🗓️ Nutrition phases</div>${sel !== 'single' ? '<span class="badge">preview</span>' : ''}</div>
    <div class="chips bd-phchips">${chips.map(([v, l]) => `<button class="chip sm ${sel === v ? 'active' : ''}" data-ph="${v}">${esc(l)}</button>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">${esc(desc)}</p>
    ${phases.length ? timelineStrip(phases, D.weeks) : ''}
    ${phases.length ? `<div class="bd-tlleg tiny">${[...new Set(phases.map(p => p.goal))].map(g => `<span><i class="bd-sw" style="background:${PHASE_COL[g]}"></i>${esc((GOAL_OPTS.find(x => x[0] === g) || [g, g])[1])}</span>`).join('')}</div>` : ''}
    ${editor}
    ${phases.length ? `<p class="tiny muted" style="margin-top:8px">Each phase eats its amount above/below the maintenance estimate at its start. Cuts stop at your ${D.goalBf}% goal and switch to maintenance.${phases.some(p => p.maintenanceWeeks > 0) ? ` Here that happens for ${phases.reduce((a, p) => a + p.maintenanceWeeks, 0)} weeks.` : ''}</p>` : ''}
    ${first && sel !== 'single' ? `<button class="btn btn-sm btn-primary btn-block" data-phapply style="margin-top:10px">Apply first phase to my targets (${esc(first.label)}, ${first.mode === 'track' ? 'maintenance' : first.calories ? kfmt(first.calories) + ' kcal' : sgnK(first.surplus) + ' kcal'})</button>
      <div class="tiny muted center" style="margin-top:4px">Saves the whole phase plan too, so Nutrition and Plan see it.</div>` : ''}
  </div>`;
}

// Stack toggle chips under the 3D model: tap to switch an item off/on for this preview and see its effect.
// Each chip shows that item's own effect at the horizon (with vs without it, same intake and plan).
function stackChips(D, o) {
  const items = activeStack(D.profile);
  if (!items.length) return '';
  const off = new Set(o.stackOff || []), useAll = o.useStack !== false;
  const d = stackDeltaCache.key === stackDeltaKey(D, o) ? stackDeltaCache.v : null;
  return `<div class="bd-stackchips">
      <div class="row between"><span class="tiny muted bold">YOUR STACK · tap to compare</span><button class="link tiny" data-stall="${off.size || !useAll ? 'on' : 'off'}">${off.size || !useAll ? 'All on' : 'All off'}</button></div>
      <div class="chips">${items.map(x => {
        const on = useAll && !off.has(x.id), e = d?.[x.id];
        const eff = e ? `${e.lean >= 0.05 ? '+' : ''}${f1(e.lean)} lb lean${Math.abs(e.fat) >= 0.1 ? ` · ${e.fat > 0 ? '+' : ''}${f1(e.fat)} fat` : ''}` : '…';
        const short = suppName(x.id).replace(/\s*\(.*\)\s*$/, '');
        return `<button class="bd-schip ${on ? 'active' : ''}" data-stoggle="${esc(x.id)}" aria-pressed="${on}"><span class="bd-sname">${on ? '●' : '○'} ${esc(short)}</span><span class="bd-sdelta" data-sdelta="${esc(x.id)}">${esc(eff)}</span></button>`;
      }).join('')}</div>
    </div>`;
}
const stackDeltaCache = { key: null, v: null };
const stackDeltaKey = (D, o) => JSON.stringify([D.weeks, D.kcal, D.pg, D.fatPct, !!D.plan, o.cdelta || 0, o.cmod, o.cint, adhOf(D, o), o.repeat, o.useStack !== false, o.stackOff || [], D.profile.supplements || [], D.profile.metabolic || {}, D.b?.weightLb, D.sessions?.length]);
// Effect of each item = projection with the item − projection without it (relative to the current on/off set).
export function stackDeltas(D, o) {
  const key = stackDeltaKey(D, o);
  if (stackDeltaCache.key === key) return stackDeltaCache.v;
  const items = activeStack(D.profile), base = new Set(o.useStack === false ? items.map(x => x.id) : (o.stackOff || []));
  const endOf = r => { const S = r?.series || []; return S[S.length - 1] || null; };
  const run = offSet => endOf(runProject(D, { ...o, useStack: true, stackOff: [...offSet] }, D.weeks, D.plan ? null : D.kcal, D.pg, D.fatPct, D.plan || null));
  const v = {};
  for (const x of items) {
    const withSet = new Set(base); withSet.delete(x.id);
    const withoutSet = new Set(base); withoutSet.add(x.id);
    const a = run(withSet), b = run(withoutSet);
    if (a && b) v[x.id] = { lean: (a.leanLb ?? 0) - (b.leanLb ?? 0), fat: (a.fatLb ?? 0) - (b.fatLb ?? 0), bf: (a.bodyFatPct ?? 0) - (b.bodyFatPct ?? 0) };
  }
  stackDeltaCache.key = key; stackDeltaCache.v = v;
  return v;
}

function stackLine(D, o) {
  const items = activeStack(D.profile);
  const contrib = (D.res.stack?.contributions || []).slice(0, 3);
  if (o.useStack === false) return `Projection ignores your stack (${items.map(x => esc(suppName(x.id))).join(', ')}).`;
  return `<b>${items.map(x => esc(suppName(x.id))).join(', ')}</b>${contrib.length ? ': ' + contrib.map(c => esc(c.text || c.name)).join(' · ') : D.res.stack ? '' : '. The projection engine will factor these in once it supports supplements.'}`
    + ((D.res.stack?.warnings || []).length ? `<ul class="bd-warn">${D.res.stack.warnings.slice(0, 2).map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '');
}
function stackGroup(D, o) {
  const items = activeStack(D.profile);
  if (!items.length) return '';
  return `<div class="bd-grp" id="pjStackGrp">
      <div class="row between"><div class="label">Supplements &amp; therapies</div><button class="link small" data-nav="supplements">Edit ›</button></div>
      <div class="tabs bd-stackseg" style="margin-top:8px">${[['1', 'With my stack'], ['0', 'Without']].map(([v, l]) => `<button class="${(o.useStack !== false ? '1' : '0') === v ? 'active' : ''}" data-stack="${v}">${l}</button>`).join('')}</div>
      <div class="small bd-stackline" id="pjStackLine">${stackLine(D, o)}</div>
    </div>`;
}
const warnList = w => (w || []).length ? `<ul class="bd-warn">${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
function cardioBurn(D, o) {
  if (!o.cdelta) return `Add minutes to see what more ${esc(CARDIO[o.cmod]?.name.toLowerCase() || 'cardio')} does at the same calories.`;
  const k = estimateCalories(o.cmod, Math.abs(o.cdelta), o.cint, D.b.weightLb);
  return `${o.cdelta > 0 ? 'Burns' : 'Saves'} ≈ ${kfmt(k)} kcal/week (${kfmt(k / 7)}/day) at the same intake.`;
}
function applyNote(D) {
  const n = D.profile.nutrition || {};
  const sp = n.phasePlan?.preset ? presetOf(n.phasePlan.preset)?.label : n.phasePlan?.blocks?.length ? 'custom phases' : (n.phases || []).length ? `${n.phases.length} dated phases` : null;
  if (sp && n.mode && n.mode !== 'off') return `Saved: ${sp}${n.proteinGPerLb ? `, ${n.proteinGPerLb} g/lb protein` : ''}${n.fatPct ? `, ${n.fatPct}% fat` : ''}.`;
  if (!n.mode || n.mode === 'off') return 'Turns on simple nutrition targets.';
  const cur = n.calories ? `${kfmt(n.calories)} kcal` : n.surplus != null ? `${sgnK(n.surplus)} kcal vs maintenance` : 'goal default';
  return `Current targets: ${cur}${n.proteinGPerLb ? `, ${n.proteinGPerLb} g/lb protein` : ''}${n.fatPct ? `, ${n.fatPct}% fat` : ''}.`;
}

// ---------------- Nutrition Lab ----------------
function nearestPt(pts, s) { let b = pts[0]; for (const p of pts) if (Math.abs(p.surplus - s) < Math.abs(b.surplus - s)) b = p; return b; }
function labChart(lab, selSurplus, weeks) {
  const P = lab.points; if (P.length < 3) return '';
  const W = 340, H = 210, L = 34, R = 66, T = 18, B = 34;
  const xs = P.map(p => p.surplus), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ys = [...P.map(p => p.lean), ...P.map(p => p.fat), 0];
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const rawSt = (hi - lo) / 4 || 1, mag = Math.pow(10, Math.floor(Math.log10(rawSt)));
  const st = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= rawSt) || 10 * mag;
  lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st; if (hi === lo) hi = lo + st;
  const x = s => L + ((s - x0) / ((x1 - x0) || 1)) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = k => P.map((p, i) => (i ? 'L' : 'M') + x(p.surplus).toFixed(1) + ' ' + y(p[k]).toFixed(1)).join(' ');
  const area = k => path(k) + ` L${x(x1).toFixed(1)} ${y(0).toFixed(1)} L${x(x0).toFixed(1)} ${y(0).toFixed(1)}Z`;
  const ticks = []; for (let v = lo; v <= hi + 1e-9; v += st) ticks.push(Math.round(v * 100) / 100);
  const xt = [-500, 0, 500, 1000].filter(v => v >= x0 && v <= x1);
  const sw = lab.sweet;
  const hasSel = selSurplus != null && isFinite(selSurplus);
  const sel = hasSel ? clampN(selSurplus, x0, x1) : 0, sp = nearestPt(P, sel);
  const last = P[P.length - 1];
  let ly1 = y(last.fat), ly2 = y(last.lean); if (Math.abs(ly1 - ly2) < 14) { if (ly1 < ly2) { ly1 -= 7; ly2 += 7; } else { ly1 += 7; ly2 -= 7; } }
  const tip = P.map(p => {
    const gain = p.lean + p.fat; const sh = p.share != null ? p.share : p.lean > 0 && p.fat > 0 ? p.lean / gain : null; const q = sh != null && p.lean > 0 ? ` · ${Math.round(sh * 100)}% lean` : '';
    return [+x(p.surplus).toFixed(1), +y(Math.max(p.lean, p.fat)).toFixed(1), `${sgnK(p.surplus)}: muscle ${sgn(p.lean)}, fat ${sgn(p.fat)} lb${q}`, p.calories];
  });
  return `<svg class="chart bd-chart bd-lab" data-kind="text" viewBox="0 0 ${W} ${H}" data-pts='${esc(JSON.stringify(tip))}' role="img" aria-label="Lean and fat gained over ${esc(String(weeks))} by daily calories">
    ${sw ? `<rect x="${x(Math.max(sw.from, x0)).toFixed(1)}" y="${T}" width="${(x(Math.min(sw.to, x1)) - x(Math.max(sw.from, x0))).toFixed(1)}" height="${H - T - B}" fill="var(--good)" opacity=".09"/>
      <text x="${((x(Math.max(sw.from, x0)) + x(Math.min(sw.to, x1))) / 2).toFixed(1)}" y="${T - 5}" text-anchor="middle" style="fill:var(--good);font-weight:750">sweet spot</text>` : ''}
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${t === 0 ? 'var(--muted)' : 'var(--line)'}" ${t === 0 ? 'opacity=".6"' : ''}/><text x="${L - 6}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${t > 0 ? '+' : ''}${f1(t)}</text>`).join('')}
    ${xt.map(v => `<text x="${x(v).toFixed(1)}" y="${H - B + 14}" text-anchor="middle">${v > 0 ? '+' : ''}${v}</text>`).join('')}
    <text x="${((L + W - R) / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" style="font-weight:650">kcal/day vs maintenance</text>
    <path d="${area('fat')}" fill="var(--accent2)" opacity=".12"/>
    <path d="${area('lean')}" fill="var(--good)" opacity=".14"/>
    <path d="${path('fat')}" fill="none" stroke="var(--accent2)" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="${path('lean')}" fill="none" stroke="var(--good)" stroke-width="2.5" stroke-linejoin="round"/>
    ${P.map(p => `<circle cx="${x(p.surplus).toFixed(1)}" cy="${y(p.fat).toFixed(1)}" r="2.6" fill="var(--accent2)"/><circle cx="${x(p.surplus).toFixed(1)}" cy="${y(p.lean).toFixed(1)}" r="2.6" fill="var(--good)"/>`).join('')}
    ${hasSel ? `<line x1="${x(sel).toFixed(1)}" x2="${x(sel).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="4 3"/>
    <circle cx="${x(sel).toFixed(1)}" cy="${y(sp.lean).toFixed(1)}" r="5" fill="var(--good)" stroke="var(--card)" stroke-width="2"/>
    <circle cx="${x(sel).toFixed(1)}" cy="${y(sp.fat).toFixed(1)}" r="5" fill="var(--accent2)" stroke="var(--card)" stroke-width="2"/>
    <text x="${x(sel).toFixed(1)}" y="${H - B - 4}" text-anchor="${x(sel) > W - R - 30 ? 'end' : x(sel) < L + 30 ? 'start' : 'middle'}" style="fill:var(--accent);font-weight:800">You</text>` : ''}
    <text x="${(W - R + 6).toFixed(1)}" y="${(ly1 + 4).toFixed(1)}" style="fill:var(--text);font-weight:750">Fat ${sgn(last.fat)}</text>
    <text x="${(W - R + 6).toFixed(1)}" y="${(ly2 + 4).toFixed(1)}" style="fill:var(--text);font-weight:750">Lean ${sgn(last.lean)}</text>
    ${tipG(T, H - B)}
  </svg>`;
}
function takeaway(lab, weeks) {
  const P = lab.points; if (P.length < 3) return '';
  const x1 = P[P.length - 1].surplus;
  const a = nearestPt(P, x1 >= 1000 ? 500 : Math.max(0, x1 / 2)), b = nearestPt(P, x1 >= 1000 ? 1000 : x1);
  if (a === b) return '';
  const dl = b.lean - a.lean, df = b.fat - a.fat;
  return `Going from <b>${sgnK(a.surplus)}</b> to <b>${sgnK(b.surplus)}</b> kcal/day adds <b style="color:var(--good)">${sgn(dl)} lb muscle</b> but <b style="color:var(--accent2)">${sgn(df)} lb fat</b> over ${esc(String(weeks))}.`;
}
function labCard(D, o) {
  const lab = labData(D, o, D.weeks, D.maint, D.pg, D.fatPct);
  if (!lab || lab.points.length < 3) return '';
  const sel = D.plan ? null : D.kcal - D.maint;
  const sm = D.res.summary || {};
  const S = D.res.series, s0 = S[0], sN = S[S.length - 1];
  const dLean = sm.leanLb ?? (sN.leanLb - s0.leanLb), dFat = sm.fatLb ?? ((sN.fatLb ?? sN.weightLb - sN.leanLb) - (s0.fatLb ?? s0.weightLb - s0.leanLb));
  const share = dLean > 0 && dFat > 0 ? Math.round(dLean / (dLean + dFat) * 100) : null;
  const sw = lab.sweet;
  const inSweet = sw && sel != null && sel >= sw.from - 30 && sel <= sw.to + 30;
  const verdict = !sw || sel == null ? '' : inSweet ? `<span class="badge good">in the sweet spot</span>` : sel > sw.to ? `<span class="badge warn">past the sweet spot</span>` : sel < 0 ? `<span class="badge accent">deficit</span>` : `<span class="badge">below the sweet spot</span>`;
  return `<div class="card bd-labcard" id="pjLab">
    <div class="row between"><div class="card-title">🧪 Nutrition Lab</div>${verdict}</div>
    <p class="small muted" style="margin-top:4px">What ${esc(horizonText(D.weeks))} of each constant calorie level would add, with your plan, protein and cardio. Tap the chart to try a level.${D.plan ? ' (Your phase plan is shown above; the lab compares single intakes.)' : ''}${D.weeks > 52 ? ' Over years a constant intake converges, so these level off.' : ''}</p>
    <div class="bd-labyou"><div><b class="num" style="color:var(--good)">${sgn(dLean)}</b><span>lb lean</span></div><div><b class="num" style="color:var(--accent2)">${sgn(dFat)}</b><span>lb fat</span></div>${dLean > 0 && dFat <= 0 ? `<div><b class="num" style="color:var(--good)">Recomp</b><span>fat down, lean up</span></div>` : `<div><b class="num">${share != null ? share + '%' : '—'}</b><span>of gain is lean</span></div>`}</div>
    <div class="mt">${labChart(lab, sel, horizonText(D.weeks))}</div>
    <div class="bd-legend tiny" style="justify-content:flex-start;margin-top:2px"><span><i class="bd-sw" style="background:var(--good)"></i>Lean</span><span><i class="bd-sw" style="background:var(--accent2)"></i>Fat</span>${sw ? `<span><i class="bd-sw" style="background:var(--good);opacity:.3"></i>Sweet spot ${sgnK(sw.from)} to ${sgnK(sw.to)}</span>` : ''}</div>
    ${takeaway(lab, horizonText(D.weeks)) ? `<p class="bd-take">${takeaway(lab, horizonText(D.weeks))}</p>` : ''}
    ${sw?.note ? `<p class="small" style="color:#cfcfd8;margin-top:8px">${esc(sw.note)}</p>` : ''}
    <ul class="tip-list bd-explain">${lab.explanation.slice(0, 2).map(t => `<li class="small">${esc(t)}</li>`).join('')}</ul>
    ${lab.explanation.length > 2 ? `<details class="bd-more"><summary class="small">More on how food, protein and cardio change this (${lab.explanation.length - 2})</summary><ul class="tip-list bd-explain">${lab.explanation.slice(2).map(t => `<li class="small">${esc(t)}</li>`).join('')}</ul></details>` : ''}
    ${lab.local ? '<p class="tiny muted" style="margin-top:6px">Computed by re-running the projection at each calorie level.</p>' : ''}
    <div class="bd-lablinks"><button class="btn btn-sm btn-ghost" data-nav="nutrition">Nutrition targets ›</button><button class="btn btn-sm btn-ghost" data-nav="supplements">Supplements &amp; metabolism ›</button></div>
  </div>`;
}

// Everything below the controls, re-rendered in place on every what-if change.
function outputs(D, o) {
  const { res, b, profile, bodyLog, weeks } = D;
  const S = res.series, s0 = S[0], sN = S[S.length - 1];
  const conf = res.confidence || 'low', confCls = conf === 'high' ? 'good' : conf === 'medium' ? 'accent' : 'warn';
  const shape0 = s0.shape || s0.measurements || b.measurements || {}, shapeN = sN.shape || sN.measurements || shape0;
  const past = bodyLog.filter(e => e.d < s0.date && daysBetween(e.d, s0.date) <= 42).map(e => ({ d: e.d, v: e.w }));
  const mk = key => S.map(p => ({ d: p.date, v: p[key], lo: p.low?.[key], hi: p.high?.[key] }));
  const goalBf = D.goalBf || profile.body?.goalBodyFat || BODY.male.goalBodyFat;
  const phs = (res.phases || []).filter(ph => ph.endWeek > ph.startWeek);
  const ceil = res.ceiling;
  const wl = res.weightLoss || null;   // §23
  const charts = `
    <div class="card"><div class="row between"><div class="card-title">Weight</div><div class="small muted num">${f1(s0.weightLb)} → <b style="color:var(--text)">${f1(sN.weightLb)}</b> lb</div></div>
      <div class="mt">${lineChart({ id: 'pw', data: mk('weightLb'), past, unit: 'lb', today: s0.date, phases: phs, ...(wl?.goalWeightLb ? { target: wl.goalWeightLb, targetLabel: `goal ${f1(wl.goalWeightLb)} lb` } : {}) })}</div>
      ${waterNote(S) ? `<div class="small bd-water">💧 ${waterNote(S)}</div>` : ''}
      <div class="tiny muted">Shaded = realistic low–high range. Grey dots = recent weigh-ins.</div></div>
    <div class="card"><div class="row between"><div class="card-title">Body fat <span class="tiny muted" title="Every method is converted to the DXA scan scale so all numbers compare directly">DXA-equivalent</span></div><div class="small muted num">${f1(s0.bodyFatPct)} → <b style="color:var(--text)">${f1(sN.bodyFatPct)}</b>%</div></div>
      <div class="mt">${lineChart({ id: 'pb', data: mk('bodyFatPct'), unit: '%', target: goalBf, targetLabel: `goal ${goalBf}%`, color: 'var(--accent2)', today: s0.date, phases: phs })}</div>
      <div class="label" style="margin-top:10px">What your weight is made of</div>
      <div class="mt" style="margin-top:4px">${compChart(S, 340, 150, phs)}</div>
      <div class="tiny muted">Body fat % = fat ÷ total weight. Lean and fat are tracked separately; water and glycogen swings are not modelled.</div></div>
    <div class="card"><div class="row between"><div class="card-title">Lean mass</div><div class="small muted num">${f1(s0.leanLb)} → <b style="color:var(--text)">${f1(sN.leanLb)}</b> lb</div></div>
      <div class="mt">${lineChart({ id: 'pl', data: mk('leanLb'), unit: 'lb', color: 'var(--good)', today: s0.date, phases: phs })}</div>
      ${ceil && s0.ffmi != null ? `<div class="small" style="margin-top:6px">FFMI <b class="num">${f1(s0.ffmi)} → ${f1(sN.ffmi)}</b> <span class="muted">· natural ceiling ≈ ${f1(ceil.ffmiNatural)}${ceil.tShift > 0.05 ? ` (≈ ${f1(ceil.ffmiEffective)} with your testosterone)` : ''} ±${f1(ceil.sd)} · ${ceil.potentialUsedPct}% of your remaining potential used</span></div>` : ''}
      ${phs.length ? `<div class="bd-tlleg tiny" style="margin-top:6px">${[...new Set(phs.map(p => p.goal))].map(g => `<span><i class="bd-sw" style="background:${PHASE_COL[g]};opacity:.8"></i>${esc((GOAL_OPTS.find(x => x[0] === g) || [g, g])[1])}</span>`).join('')}<span class="muted">tinted = phases</span></div>` : ''}</div>`;

  // measurements table (L/R shown where measured)
  const est = new Set(res.shapeEstimated || []);
  const lastM = {};
  for (const e of D.measurements || []) for (const [k, v] of Object.entries(e)) if (v != null && k !== 'd') lastM[k] = v;
  if (lastM.thigh != null) { lastM.thighL ??= lastM.thigh; lastM.thighR ??= lastM.thigh; }
  if (lastM.calf != null) { lastM.calfL ??= lastM.calf; lastM.calfR ??= lastM.calf; }
  const rows = SITE_ROWS.filter(([k]) => shape0[k] != null && shapeN[k] != null).map(([k, l, dir, kl, kr]) => {
    const d = shapeN[k] - shape0[k];
    const col = Math.abs(d) < 0.05 ? 'var(--muted)' : (d < 0) === (dir === 'down') ? 'var(--good)' : 'var(--warn)';
    const lN = sN.limbs?.[kl], rN = sN.limbs?.[kr];
    const lr = kl && lastM[kl] != null && lastM[kr] != null ? `<div class="tiny muted">L/R ${f1(lastM[kl])} / ${f1(lastM[kr])}${lN != null && rN != null ? ` → ${f1(lN)} / ${f1(rN)}` : ''}</div>` : '';
    return `<tr class="${est.has(k) ? 'est' : ''}"><th>${l}${est.has(k) ? ' <span class="tiny muted">est.</span>' : ''}${lr}</th><td>${f1(shape0[k])}″</td><td>${f1(shapeN[k])}″</td><td style="color:${col};font-weight:750">${Math.abs(d) < 0.05 ? '—' : sgn(d)}</td></tr>`;
  }).join('');
  const sw0 = s0.ratios?.shoulderToWaist, swN = sN.ratios?.shoulderToWaist;
  const table = `<div class="card" style="padding:6px 14px">
    <table class="bd-ptable num"><thead><tr><th></th><th>Now</th><th>${esc(fmtShort(sN.date))}</th><th>Δ</th></tr></thead><tbody>${rows}
    ${sw0 && swN ? `<tr><th>Shoulder:waist</th><td>${sw0.toFixed(2)}</td><td>${swN.toFixed(2)}</td><td style="color:${swN > sw0 ? 'var(--good)' : 'var(--muted)'};font-weight:750">${swN - sw0 >= 0.005 ? '+' + (swN - sw0).toFixed(2) : '—'}</td></tr>` : ''}
    ${s0.ratios?.waistToHip && sN.ratios?.waistToHip ? `<tr><th>Waist:hip</th><td>${s0.ratios.waistToHip.toFixed(2)}</td><td>${sN.ratios.waistToHip.toFixed(2)}</td><td style="color:${sN.ratios.waistToHip < s0.ratios.waistToHip ? 'var(--good)' : 'var(--muted)'};font-weight:750">${Math.abs(sN.ratios.waistToHip - s0.ratios.waistToHip) >= 0.005 ? (sN.ratios.waistToHip > s0.ratios.waistToHip ? '+' : '−') + Math.abs(sN.ratios.waistToHip - s0.ratios.waistToHip).toFixed(2) : '—'}</td></tr>` : ''}</tbody></table>
    <p class="tiny muted" style="margin:6px 0 8px">Limbs are projected from the average of left and right.${est.size ? ` "est." = not measured yet; drawn from a typical build. <a href="#/measure">Measure it</a>.` : ''}</p></div>`;

  const ms = res.milestones || [];
  const msHtml = ms.length ? `<div class="section-title">Milestones</div><div class="card bd-miles">${ms.map(m => {
    const st = m.already ? 'done' : m.date ? 'hit' : 'beyond';
    const when = m.already ? 'Already there' : m.date ? fmtShort(m.date) + (m.date.slice(0, 4) !== ds().slice(0, 4) ? ' ' + m.date.slice(0, 4) : '') : 'Beyond horizon';
    return `<div class="bd-mile ${st}"><i></i><div class="grow"><div class="row between" style="align-items:flex-start"><div class="t">${esc(m.label)}</div><div class="w">${esc(when)}</div></div>${m.note ? `<div class="tiny muted">${esc(m.note)}</div>` : ''}</div></div>`;
  }).join('')}</div>` : '';

  const wk = res.weekly || {};
  const bal = wk.kcalBalance ?? ((wk.kcalIn || 0) - (wk.kcalOut || 0));
  const weekly = `<div class="grid3">
    <div class="stat"><div class="v">${f1(wk.liftSetsPerWeek || 0)}</div><div class="l">Lift sets / wk</div></div>
    <div class="stat"><div class="v">${Math.round(wk.cardioMinPerWeek || 0)}<small>min</small></div><div class="l">Cardio / wk</div></div>
    <div class="stat"><div class="v" style="color:${bal < 0 ? 'var(--good)' : 'var(--accent2)'}">${sgnK(bal)}</div><div class="l">kcal / day avg</div></div></div>`;

  const assumptions = (res.assumptions || []).length ? `<details class="card bd-assume"><summary><span class="card-title">How this is calculated</span><span class="badge ${confCls}">${conf}</span></summary>
    <ul class="tip-list mt">${res.assumptions.map(a => `<li class="small">${esc(a)}</li>`).join('')}</ul></details>` : '';
  const missing = (res.missingInfo || []).filter(x => x.field !== 'weight');
  const sm = res.summary || {};
  const deltas = `<div class="bd-deltas">${[['Weight', sm.weightLb, 'lb', 'none'], ['Fat', sm.fatLb, 'lb', 'down'], ['Lean', sm.leanLb, 'lb', 'up'], ['Waist', sm.waist, '″', 'down']].filter(r => r[1] != null).map(([l, v, u, dir]) => {
    const col = !v || dir === 'none' ? 'var(--text)' : (v < 0) === (dir === 'down') ? 'var(--good)' : 'var(--warn)';
    return `<div><b class="num" style="color:${col}">${sgn(v)}<small>${u}</small></b><span>${l}</span></div>`;
  }).join('')}</div>`;

  return `<div class="card bd-endcard"><div class="row between"><div class="label">In ${esc(horizonText(weeks))} · ${esc(fmtShort(sN.date))}${sN.date.slice(0, 4) !== s0.date.slice(0, 4) ? ' ' + sN.date.slice(0, 4) : ''}</div><span class="badge ${confCls}">${conf} confidence</span></div>${deltas}
      ${waterNote(S) ? `<p class="tiny muted" style="margin-top:10px">💧 ${waterNote(S)}</p>` : ''}
      ${res.bodyFatAssumed ? '<p class="tiny" style="color:var(--warn);margin-top:10px">Body fat was assumed (no height/neck/waist yet), so these numbers are very rough.</p>' : ''}
      ${res.energyAvailability?.low ? `<p class="tiny" style="color:var(--warn);margin-top:10px" data-ea-warn>Energy availability drops to ≈${f1(res.energyAvailability.min)} kcal per kg of lean mass a day (food minus exercise). ${sexOf(D.b?.sex) === 'female' ? 'Under ~30 the hormones that run your cycle are disrupted (Loucks &amp; Thuma 2003; IOC REDs 2023)' : 'That is below ~30, where reproductive and metabolic hormones (testosterone included) start to suffer. The ~30 threshold comes from Loucks &amp; Thuma 2003 in women; no equivalent number has been established in men, so treat it as a flag, not a line (IOC REDs 2023)'}: eat more around training or ease the deficit.</p>` : ''}
      ${res.caution === 'postpartum' ? '<p class="tiny" style="color:var(--warn);margin-top:10px">Postpartum: this projection is very rough. Check with your provider before a deficit or hard training.</p>' : ''}</div>
    ${wl ? weightLossCard(wl, D) : deficitCostCard(res)}
    ${labCard(D, o)}
    <div class="section-title">Trends</div>${charts}
    <div class="section-title">Projected measurements</div>${table}
    ${msHtml}
    <div class="section-title">Average week in this projection</div>${weekly}
    ${missing.length ? `<div class="card bd-miss mt"><div class="label">Sharpen the projection</div><ul>${missing.slice(0, 5).map(x => `<li><b>${esc(x.label)}</b> <span class="muted">${esc(x.why)}</span></li>`).join('')}</ul><button class="btn btn-sm btn-ghost mt" data-nav="measure">Add measurements</button></div>` : ''}
    <div class="section-title">The fine print</div>
    ${assumptions}
    <p class="small muted bd-disclaim">These are estimates from simple, conservative models, not promises. Real bodies vary a lot. Re-measure every 2-4 weeks and the projection re-anchors to what actually happened.</p>
    <button class="card tap bd-planlink" data-nav="plan"><span style="font-size:22px">🗓️</span><div class="grow"><div class="t">Change the plan</div><div class="s">More sessions, cardio or sets → see the projection update</div></div><span class="chev">›</span></button>`;
}

// §23. The honest trade-off card for the weight-loss goal: what this rate costs in lean mass, what the
// other rates would cost, and every warning the engine raised. Numbers come straight from res.weightLoss
// (one lite simulation per rate), so the card and the projection can never disagree.
// §23 (universal): under any goal, a deficit costs some lean mass. The weight-loss goal gets the full
// "what it costs" card; every other goal gets these three numbers so the cost is never invisible.
function deficitCostCard(res) {
  const p = res.partition;
  if (!p || p.leanLossFrac == null || !(p.leanLossLb > 0.05)) return '';
  const share = Math.round(p.leanLossFrac * 100);
  const fatOff = res.summary && res.summary.fatLb != null && res.series?.length
    ? Math.max(0, res.series[0].fatLb - res.series[res.series.length - 1].fatLb) : null;
  return `<div class="card bd-why" id="pjDeficitCost">
    <div class="card-title">What this deficit costs in lean mass</div>
    <p class="small" style="color:#cfcfd8;margin-top:6px;line-height:1.5">Fat goes first, but never all of it, whatever the goal is called. How much of each pound comes off as lean mass depends on how lean you already are (Forbes' rule), how fast you go (Garthe 2011), and your protein and lifting (Mettler 2010).</p>
    <div class="bd-deltas" style="margin-top:10px">
      ${fatOff != null ? `<div><b class="num" style="color:var(--accent2)">\u2212${f1(fatOff)}<small>lb</small></b><span>Fat off</span></div>` : ''}
      <div><b class="num" style="color:var(--warn)">\u2212${f1(p.leanLossLb)}<small>lb</small></b><span>Lean off</span></div>
      <div><b class="num">${share}%</b><span>of the loss is lean</span></div>
    </div>
    <p class="tiny muted" style="margin-top:8px">At about ${f1(p.lossRatePctPerWeek)}% of bodyweight a week. Going slower, or eating more protein, moves this number down.</p>
  </div>`;
}

function weightLossCard(wl, D) {
  const rows = (wl.rates || []).map(r => {
    const me = Math.abs(r.pctPerWeek - (wl.ratePctPerWeek ?? -1)) < 0.01;
    const when = r.reached ? `wk ${r.week}` : '—';
    return `<tr class="${me ? 'est' : ''}"><td>${me ? '<b>' : ''}${r.pctPerWeek}%<div class="tiny muted">${f1(r.lbPerWeek)} lb/wk</div>${me ? '</b>' : ''}</td>
      <td>${r.calories.toLocaleString()}<div class="tiny muted">−${r.deficitKcal}</div></td>
      <td style="color:var(--accent2);font-weight:750">${sgn(r.fatLb)}</td>
      <td style="color:${r.leanLb < -0.05 ? 'var(--warn)' : 'var(--good)'};font-weight:750">${sgn(r.leanLb)}</td>
      <td>${when}</td></tr>`;
  }).join('');
  const share = wl.leanShareOfLoss != null ? Math.round(wl.leanShareOfLoss * 100) : null;
  const prot = { protect: 'Protecting muscle', balanced: 'Maintenance', minimal: 'Minimum body mass' }[wl.leanProtection] || wl.leanProtection;
  return `<div class="card bd-why" id="pjWeightLoss">
    <div class="row between"><div class="card-title">Losing weight: what it costs</div><span class="badge">${esc(prot)}</span></div>
    <p class="small" style="color:#cfcfd8;margin-top:6px;line-height:1.5">Fat goes first, but never all of it. How much of each pound comes off as lean mass depends on how lean you already are (Forbes' rule), how fast you go (Garthe 2011), and your protein and lifting (Mettler 2010).</p>
    <div class="bd-deltas" style="margin-top:10px">
      <div><b class="num" style="color:var(--accent2)">−${f1(wl.fatLostLb)}<small>lb</small></b><span>Fat off</span></div>
      <div><b class="num" style="color:${wl.leanLostLb > 0.05 ? 'var(--warn)' : 'var(--good)'}">${wl.leanLostLb > 0.05 ? '−' + f1(wl.leanLostLb) : '±0'}<small>lb</small></b><span>Lean off</span></div>
      <div><b class="num">${share != null ? share + '%' : '—'}</b><span>of the loss is lean</span></div>
    </div>
    ${wl.goalWeightLb ? `<p class="small" style="margin-top:8px">Goal weight <b class="num">${f1(wl.goalWeightLb)} lb</b>: ${wl.reached ? `projected around <b>${esc(fmtShort(wl.date))}</b> (week ${wl.week}), at about <b>${f1(wl.atGoal.bodyFatPct)}%</b> body fat` : `<b style="color:var(--warn)">not reached</b> in this horizon (projected ${f1(wl.atGoal.weightLb)} lb)`}.</p>` : ''}
    ${wl.lbPerWeek && wl.projectedLbPerWeek ? `<p class="tiny muted">You asked for ${f1(wl.lbPerWeek)} lb/week; once the body adapts the model projects about <b>${f1(wl.projectedLbPerWeek)} lb/week</b>.</p>` : ''}
    ${rows ? `<table class="num" style="margin-top:10px"><thead><tr><th>Rate</th><th>kcal/day</th><th>Fat</th><th>Lean</th><th>At goal</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="tiny muted">Each row is a full simulation at that rate, read at the week your goal weight is reached (or at the end of the horizon). Your current choice is in bold.</p>` : ''}
    ${(wl.warnings || []).length ? `<ul class="bd-warn" style="margin-top:10px">${wl.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <button class="btn btn-sm btn-ghost btn-block mt" data-wl-targets>Change goal weight, rate or muscle protection</button>
  </div>`;
}

function waterNote(S) {
  const w0 = Number(S[0]?.waterLb) || 0, wN = Number(S[S.length - 1]?.waterLb) || 0;
  if (!(wN > 0.05) && !(Math.abs(wN - w0) > 0.05)) return '';
  const src = cur?.D?.res?.stack?.contributions?.filter(c => /water/i.test(c.text || '')).map(c => c.name).join(', ');
  return `Weight includes ${sgn(wN - w0 || wN)} lb of water${src ? ` from ${esc(src)}` : ' from your stack'}, not fat or muscle.`;
}

let cur = null;   // { D, o } for the live screen

const scrubLabels = S => `<span>Now</span><span>Drag through time</span><span>${esc(whenText(S[S.length - 1].week ?? S.length - 1))}</span>`;
const subText = D => `Your body in ${esc(horizonText(D.weeks))} if the plan happens. Change the inputs and watch it move.`;
export function render(ctx) {
  const o = getOpts(ctx.store);
  const D = compute(ctx.store, o);
  D.ctx = ctx;
  cur = null;
  if (!D.b || !D.b.weightLb || !D.res || !(D.res.series || []).length) {
    return `<div class="page-head"><p class="sub">Your body in ${esc(horizonText(D.weeks))}, if the plan happens.</p></div>${setupCard(D.b, D.res)}`;
  }
  cur = { D, o };
  const S = D.res.series, i = scrubIdx(o, S), H = D.b.heightIn || 69;
  const hero = `<div class="card hero bd-hero">
    <div class="row between"><div class="tabs bd-viewseg" style="flex:0 0 auto">${[['now', 'Now'], ['proj', 'Projected']].map(([v, l]) => `<button class="${(i === 0 ? 'now' : 'proj') === v ? 'active' : ''}" data-view="${v}">${l}</button>`).join('')}</div>
      <span class="badge" id="pjBadge">${esc(horizonText(D.weeks))}</span></div>
    <div class="bd-stage" id="pjStage" data-h="${H}">${heroSvg(S, i, H, D.b?.sex)}</div>
    <div class="bd-scrub"><input type="range" class="bd-range" id="pjScrub" min="0" max="${S.length - 1}" step="1" value="${i}" style="--pct:${(i / (S.length - 1)) * 100}%" aria-label="Point in time">
      <div class="row between tiny muted" id="pjScrubLbl">${scrubLabels(S)}</div></div>
    <div id="pjStackChips">${stackChips(D, o)}</div>
    <div id="pjHeroInfo">${heroInfo(D, o)}</div>
  </div>`;
  return `<div class="page-head"><p class="sub" id="pjSub">${subText(D)}</p></div>
    ${hero}
    ${controls(D, o)}
    <div id="pjPh">${phasesCard(D, o)}</div>
    <div id="pjOut">${outputs(D, o)}</div>`;
}

// Dated list for targets.js (max 12 entries) from a phase spec, starting today.
function datedPhases(spec) {
  if (!spec || typeof PJ.buildPhasePlan !== 'function') return [];
  const plan = safe(() => PJ.buildPhasePlan(spec, true, MAXW, ds()), null);
  if (!plan) return [];
  return plan.instances.filter(x => !plan.blocks[x.bi].after).slice(0, 12).map(x => {
    const b = plan.blocks[x.bi];
    return { label: b.label, start: ds(addDays(parseDs(ds()), 7 * x.startWeek)), end: ds(addDays(parseDs(ds()), 7 * x.endWeek)),
      surplus: b.calories ? null : b.mode === 'track' ? 0 : b.surplus, calories: b.calories || null };
  });
}

export function bind(root, ctx, params = {}) {
  const st = ctx.store;
  root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => ctx.nav(b.dataset.nav));
  if (!cur) { destroy3D('proj'); return; }
  let o = cur.o;
  const D0 = cur.D;
  const H = D0.b.heightIn || 69;
  const $ = s => root.querySelector(s);
  const save = patch => { o = setOpts(st, patch); cur.o = o; };
  if (TGU && typeof TGU.bindTargetsSummary === 'function') safe(() => TGU.bindTargetsSummary(root, ctx), null);

  // ---- hero: 3D or SVG ----
  const stage = $('#pjStage');
  const viewPt = () => { const S = cur.D.res.series; const i = scrubIdx(o, S); return { S, i, p: S[i] }; };
  const optsFor = () => {
    const { S, i, p } = viewPt();
    // Blink-compare (Bob's choice): one solid body at a time, no ghost outline. Framing is pinned to the union of
    // the now and end-of-horizon bodies so flipping Now ↔ Projected (or scrubbing) shows true size change.
    const n = S.length - 1;
    return opts3D(p, H, { sex: cur.D.b?.sex || 'male', compareShape: null, compareMode: 'none', frameShape: [shapeOf(S[0], H), shapeOf(S[n], H)],
      label: i > 0 ? `${whenText(p.week ?? i)} · ${f1(p.bodyFatPct)}% BF` : `Now · ${f1(p.bodyFatPct)}% BF`, ghostLabel: '' });
  };
  let handle = null, lastUp = 0, upT = 0;
  const push3D = () => {
    if (!handle) return;
    const now = performance.now(); clearTimeout(upT);
    const go = () => { lastUp = performance.now(); if (handle) safe(() => handle.update(optsFor()), null); };
    if (now - lastUp > 60) go(); else upT = setTimeout(go, 60);
  };
  const pose0 = (B3?.POSES || []).includes(o.pose) ? o.pose : 'relaxed';
  mount3D('proj', root, stage, { ...optsFor(), pose: pose0, height: 380, showPoses: true, onPose: name => save({ pose: name }) }).then(h => {
    handle = h; if (!h) return;
    stage.classList.add('bd-stage3d');
    push3D();
  });
  const showView = () => {
    const { S, i } = viewPt();
    root.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === (i === 0 ? 'now' : 'proj')));
    $('#pjHeroInfo').innerHTML = heroInfo(cur.D, o);
    if (handle) push3D(); else stage.innerHTML = heroSvg(S, i, H, cur.D.b?.sex);
  };
  const scrub = $('#pjScrub');
  const syncScrub = () => {
    const S = cur.D.res.series, i = scrubIdx(o, S);
    scrub.max = S.length - 1; scrub.value = i; scrub.style.setProperty('--pct', (i / (S.length - 1)) * 100 + '%');
    $('#pjScrubLbl').innerHTML = scrubLabels(S);
  };
  scrub.oninput = () => {
    const S = cur.D.res.series, v = +scrub.value;
    scrub.style.setProperty('--pct', (v / (S.length - 1)) * 100 + '%');
    o = { ...o, scrub: v, view: v === 0 ? 'now' : 'proj' }; cur.o = o; showView();
  };
  scrub.onchange = () => { scrub.blur(); save({ scrub: o.scrub, view: o.view }); };
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    const S = cur.D.res.series; const v = b.dataset.view === 'now' ? 0 : (o.scrub && o.scrub > 0 ? Math.min(o.scrub, S.length - 1) : S.length - 1);
    save({ view: b.dataset.view, scrub: v }); scrub.value = v; scrub.style.setProperty('--pct', (v / (S.length - 1)) * 100 + '%'); showView();
  });

  // ---- live recompute (throttled; long horizons take ~100-200 ms) ----
  let t = 0, busy = false, again = false;
  const refresh = () => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const D = compute(st, o); if (!D.res || !(D.res.series || []).length) return;
      D.ctx = ctx;
      cur.D = D;
      const set = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
      set('#pjMaint', `maintenance ≈ ${kfmt(D.maint)}`);
      set('#pjKcalD', `${sgnK(D.kcal - D.maint)} vs maintenance`);
      if (!kcDragging) { set('#pjKcalV', kfmt(D.kcal)); }
      $('#pjKcalGrp')?.classList.toggle('bd-dim', !!D.plan);
      set('#pjStackLine', activeStack(D.profile).length ? stackLine(D, o) : '');
      set('#pjStackChips', stackChips(D, o)); bindChips(); fillDeltas();
      const planC = plannedCardio(D), tgtC = D.targets?.cardio?.minPerWeek;
      set('#pjCardioBase', `${tgtC != null ? `target ${tgtC} · ` : ''}planned ${planC} min/wk`);
      const ca = $('#pjCApply'); if (ca) { ca.style.display = o.cdelta ? '' : 'none'; ca.textContent = `Make ${Math.max(0, (tgtC ?? planC) + (o.cdelta || 0))} min/wk my cardio target`; }
      set('#pjBadge', esc(horizonText(D.weeks)));
      set('#pjSub', subText(D));
      set('#pjHV', esc(horizonText(D.weeks)));
      markPresets(D);
      const y = window.scrollY;
      set('#pjPh', phasesCard(D, o));
      set('#pjOut', outputs(D, o));
      window.scrollTo(0, y);
      bindPh(); bindOut(); syncScrub(); showView();
    } finally {
      busy = false;
      if (again) { again = false; schedule(); }
    }
  };
  const schedule = (ms = 150) => { clearTimeout(t); t = setTimeout(refresh, ms); };
  const markPresets = D => root.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('active', !D.plan && Math.abs(D.kcal - (D.maint + +b.dataset.preset)) < 13));
  markPresets(D0);
  const liveMacros = () => {
    const D = cur.D;
    const m = macros(D.profile, { calories: o.kcal ?? D.kcal, bodyweight: D.b.weightLb, proteinGPerLb: o.pg ?? D.pg, fatPct: o.fatPct ?? D.fatPct });
    $('#pjMacros').innerHTML = macroBar(m) + warnList(m.warnings);
  };

  // horizon slider + chips
  const hs = $('#pjH');
  const setH = (w, ms) => {
    w = clampN(Math.round(w), 4, MAXW);
    const p = posOfWeeks(w);
    hs.value = p; hs.style.setProperty('--pct', (p / (+hs.max || 1)) * 100 + '%'); hs.setAttribute('aria-valuetext', horizonText(w));
    $('#pjHV').textContent = horizonText(w);
    root.querySelectorAll('[data-hw]').forEach(b => b.classList.toggle('active', +b.dataset.hw === w));
    if (w !== o.weeks || o.until) { save({ weeks: w, until: null, scrub: null }); schedule(ms); }
  };
  hs.oninput = () => setH(weeksAtPos(+hs.value), 350);
  hs.onchange = () => { hs.blur(); setH(weeksAtPos(+hs.value), 30); };
  root.querySelectorAll('[data-hw]').forEach(b => b.onclick = () => setH(+b.dataset.hw, 30));

  // calories (a single intake; moving it leaves the phase preview)
  const kc = $('#pjKcal');
  let kcDragging = false;
  const setKcal = v => {
    v = clampN(Math.round(v / 25) * 25, +kc.min, +kc.max);
    kc.value = v; kc.style.setProperty('--pct', ((v - kc.min) / (kc.max - kc.min)) * 100 + '%');
    $('#pjKcalV').textContent = kfmt(v); $('#pjKcalD').textContent = `${sgnK(v - cur.D.maint)} vs maintenance`;
    save({ kcal: v, ...(cur.D.plan ? { ph: 'single' } : {}) }); liveMacros(); schedule(cur.D.weeks > 52 ? 300 : 150);
  };
  kc.oninput = () => { kcDragging = true; setKcal(+kc.value); };
  kc.onchange = () => { kcDragging = false; kc.blur(); };
  root.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => setKcal(cur.D.maint + +b.dataset.preset));
  const rng = (sel, key, fmt, lo, hi) => {
    const el = $(sel);
    el.oninput = () => { const v = +el.value; el.style.setProperty('--pct', ((v - lo) / (hi - lo)) * 100 + '%'); $(sel + 'V').textContent = fmt(v); save({ [key]: v }); liveMacros(); schedule(cur.D.weeks > 52 ? 300 : 150); };
    el.onchange = () => el.blur();
  };
  rng('#pjPg', 'pg', v => v.toFixed(2) + ' g/lb', 0.6, 1.4);
  rng('#pjFat', 'fatPct', v => v + '% of kcal', 15, 40);
  const adh = $('#pjAdh');
  adh.oninput = () => { $('#pjAdhV').textContent = Math.round(adh.value * 100) + '%'; adh.style.setProperty('--pct', ((adh.value - 0.6) / 0.4) * 100 + '%'); save({ adherence: +adh.value }); schedule(); };
  adh.onchange = () => adh.blur();
  const setCd = v => {
    v = clampN(v, -300, 600); save({ cdelta: v });
    $('#pjCdV').textContent = sgnK(v); $('#pjCburn').textContent = cardioBurn(cur.D, o).replace(/<[^>]+>/g, ''); schedule();
  };
  root.querySelectorAll('[data-cstep]').forEach(b => b.onclick = () => setCd((o.cdelta || 0) + +b.dataset.cstep));
  root.querySelectorAll('[data-cadd]').forEach(b => b.onclick = () => setCd(+b.dataset.cadd === 0 ? 0 : (o.cdelta || 0) + +b.dataset.cadd));
  $('#pjCmod').onchange = e => { save({ cmod: e.target.value }); e.target.blur(); setCd(o.cdelta || 0); };
  $('#pjCint').onchange = e => { save({ cint: e.target.value }); e.target.blur(); setCd(o.cdelta || 0); };
  $('#pjRepeat').onchange = e => { save({ repeat: e.target.checked }); schedule(); };
  root.querySelectorAll('[data-stack]').forEach(b => b.onclick = () => {
    root.querySelectorAll('[data-stack]').forEach(x => x.classList.toggle('active', x === b));
    save({ useStack: b.dataset.stack === '1', stackOff: [] }); schedule();
  });
  // Per-item stack chips under the 3D model (preview only).
  function bindChips() {
    const box = $('#pjStackChips'); if (!box) return;
    box.onclick = e => {
      const all = e.target.closest('[data-stall]');
      if (all) { save(all.dataset.stall === 'on' ? { useStack: true, stackOff: [] } : { useStack: true, stackOff: activeStack(cur.D.profile).map(x => x.id) }); schedule(0); return; }
      const c = e.target.closest('[data-stoggle]'); if (!c) return;
      const id = c.dataset.stoggle;
      const offNow = o.useStack === false ? activeStack(cur.D.profile).map(x => x.id) : [...(o.stackOff || [])];
      const next = offNow.includes(id) ? offNow.filter(x => x !== id) : [...offNow, id];
      c.classList.toggle('active'); 
      save({ useStack: true, stackOff: next }); schedule(0);
    };
  }
  let deltaT = 0;
  function fillDeltas() {
    clearTimeout(deltaT);
    deltaT = setTimeout(() => {
      const D = cur?.D; if (!D || !activeStack(D.profile).length) return;
      const v = safe(() => stackDeltas(D, o), null); if (!v) return;
      const box = $('#pjStackChips'); if (box) { box.innerHTML = stackChips(D, o); bindChips(); }
    }, 60);
  }
  bindChips(); fillDeltas();
  // Cardio what-if → the real target (re-plans upcoming auto days, then the projection uses the new plan).
  $('#pjCApply').onclick = () => {
    const D = cur.D, baseC = D.targets?.cardio?.minPerWeek ?? plannedCardio(D), target = Math.max(0, Math.round((baseC + (o.cdelta || 0)) / 5) * 5);
    const done = () => { save({ cdelta: 0 }); $('#pjCdV').textContent = sgnK(0); $('#pjCburn').textContent = cardioBurn(cur.D, o).replace(/<[^>]+>/g, ''); refresh(); };
    if (TGU && typeof TGU.setTargets === 'function') Promise.resolve(TGU.setTargets(ctx, { cardio: { minPerWeek: target } }, { replan: true })).then(done, done);
    else { st.updateProfile({ cardioTargetMin: target }); ctx.toast(`Cardio target: ${target} min/week`); done(); }
  };
  $('[data-reset]').onclick = () => { save({ kcal: null, pg: null, fatPct: null, cdelta: 0, adherence: null, ph: null, cmod: null }); ctx.rerender(); ctx.toast('Back to your targets'); };

  // Apply: nutrition (incl. phases) + adherence through the shared targets module.
  const applyTargets = ({ withAdherence = true } = {}) => {
    const D = cur.D, p = st.getProfile(), n = p.nutrition || {};
    const spec = D.plan && !Array.isArray(D.plan) ? D.plan : null;
    const first = (D.res.phases || [])[0];
    const surplus = D.plan && first ? (first.mode === 'track' ? 0 : first.calories ? Math.round((first.calories - D.maint) / 25) * 25 : first.surplus) : Math.round((D.kcal - D.maint) / 25) * 25;
    const dated = D.plan ? (spec ? datedPhases(spec) : (Array.isArray(D.plan) ? D.plan : [])) : [];
    const nutrition = { mode: n.mode && n.mode !== 'off' ? n.mode : 'simple', surplus, proteinGPerLb: +D.pg.toFixed(2), fatPct: D.fatPct, phases: dated };
    const patch = { nutrition, ...(withAdherence && o.adherence != null ? { adherence: o.adherence } : {}) };
    const meta = () => {
      // The repeating plan itself (targets.js keeps only the dated list).
      const cur2 = st.getProfile(); const n2 = { ...(cur2.nutrition || {}) };
      if (spec) n2.phasePlan = { preset: spec.preset || null, repeat: spec.repeat !== false, blocks: (planBlocks(spec) || []).map(b => ({ ...b })), start: ds() };
      else if (!D.plan) n2.phasePlan = null;
      st.updateProfile({ nutrition: n2 });
    };
    const after = () => { save({ kcal: null, pg: null, fatPct: null, adherence: withAdherence ? null : o.adherence, ph: null }); $('#pjApplyNote').innerHTML = applyNote({ profile: st.getProfile() }); refresh(); };
    if (TGU && typeof TGU.setTargets === 'function') {
      const pr = TGU.setTargets(ctx, patch, { replan: false, reason: D.plan ? `${dated.length ? dated[0].label : 'phase plan'} (${sgnK(surplus)} kcal), ${D.pg.toFixed(2)} g/lb protein, ${D.fatPct}% fat` : undefined });
      meta(); Promise.resolve(pr).then(after, after);
    } else {
      st.updateProfile({ nutrition: { ...n, ...nutrition, calories: null }, ...(patch.adherence != null ? { adherence: patch.adherence } : {}) });
      meta(); after();
      ctx.toast(`Targets set: ${sgnK(surplus)} kcal vs maintenance, ${D.pg.toFixed(2)} g/lb protein, ${D.fatPct}% fat`);
    }
  };
  $('[data-apply]').onclick = () => applyTargets();
  // §23: the weight-loss card's shortcut into the one shared targets editor (CONTRACT §18).
  const wlBtn = root.querySelector('[data-wl-targets]');
  if (wlBtn) wlBtn.onclick = () => { if (TGU && typeof TGU.openTargetsSheet === 'function') TGU.openTargetsSheet(ctx, { focus: 'adherence' }); else ctx.nav('settings', { section: 'goal' }); };

  // ---- phases card ----
  const readBlocks = () => [...root.querySelectorAll('#pjBlocks .bd-block')].map(el => {
    const g = el.querySelector('[data-bf="goal"]').value, num = k => { const x = el.querySelector(`[data-bf="${k}"]`); return x && x.value !== '' ? Number(x.value) : null; };
    const b = { weeks: clampN(Math.round(num('weeks') || 8), 1, MAXW), goal: g };
    if (g === 'custom') b.calories = clampN(num('calories') ?? Math.round(cur.D.maint), 1000, 6000);
    else if (g !== 'maintain') b.surplus = clampN(num('surplus') ?? ({ cut: -500, bulk: 500, lean_bulk: 300 }[g] || 0), -1500, 1500);
    return b;
  });
  const setPlan = ph => { save({ ph, scrub: null }); schedule(20); };
  const bindPh = () => {
    const box = $('#pjPh');
    box.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => {
      const v = b.dataset.ph;
      if (v === 'single') return setPlan('single');
      if (v === 'saved') return setPlan(null);
      if (v === 'custom') {
        const blocks = planBlocks(cur.D.plan) || [{ weeks: 16, goal: 'lean_bulk', surplus: 300 }, { weeks: 6, goal: 'cut', surplus: -500 }];
        return setPlan({ preset: null, repeat: cur.D.plan?.repeat !== false, blocks: blocks.map(x => ({ ...x })) });
      }
      const pr = presetOf(v); if (pr) setPlan({ preset: pr.id, repeat: pr.repeat, blocks: pr.blocks.map(x => ({ ...x })) });
    });
    box.querySelectorAll('#pjBlocks select, #pjBlocks input[type=number]').forEach(el => el.onchange = () => setPlan({ preset: null, repeat: $('#pjBRep')?.checked !== false, blocks: readBlocks() }));
    box.querySelectorAll('[data-bdel]').forEach(b => b.onclick = () => { const bl = readBlocks(); bl.splice(+b.dataset.bdel, 1); if (bl.length) setPlan({ preset: null, repeat: $('#pjBRep')?.checked !== false, blocks: bl }); });
    const add = box.querySelector('[data-badd]'); if (add) add.onclick = () => setPlan({ preset: null, repeat: $('#pjBRep')?.checked !== false, blocks: [...readBlocks(), { weeks: 8, goal: 'maintain' }].slice(0, 12) });
    const rep = box.querySelector('#pjBRep'); if (rep) rep.onchange = () => setPlan({ preset: null, repeat: rep.checked, blocks: readBlocks() });
    const ap = box.querySelector('[data-phapply]'); if (ap) ap.onclick = () => applyTargets({ withAdherence: false });
  };
  bindPh();

  // ---- output regions (charts, lab taps) ----
  const bindOut = () => {
    const out = $('#pjOut');
    out.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => ctx.nav(b.dataset.nav));
    bindCharts(out);
    const lab = out.querySelector('svg.bd-lab');
    if (lab) lab.addEventListener('click', ev => {
      const pts = safe(() => JSON.parse(lab.dataset.pts || '[]'), []); if (!pts.length) return;
      const best = nearest(lab, ev, pts); if (best[3]) setKcal(best[3]);
    });
  };
  bindOut();
  if (params.focus === 'lab') setTimeout(() => $('#pjLab')?.scrollIntoView({ block: 'start' }), 50);
}
