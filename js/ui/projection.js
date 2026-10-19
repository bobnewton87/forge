// Projection screen (route 'projection', UI-BODY): now vs projected physique, charts with
// low/high band, projected measurements, milestones and the model's assumptions.
// CONTRACT-NOTE: exports lineChart / bindCharts / f1 / safe helpers reused by measure.js and body.js.
// CONTRACT-NOTE: projection controls persist in store.kv('projection').
import { esc } from './components.js';
import { ds, fmtShort, parseDs, addDays, daysBetween } from '../util.js';
import { baseline } from '../engine/bodycomp.js';
import { project } from '../engine/projection.js';
import { silhouetteSVG } from './silhouette.js';

export const safe = (fn, fb) => { try { const v = fn(); return v == null ? fb : v; } catch (e) { console.error(e); return fb; } };
export const f1 = n => { n = Number(n); if (!isFinite(n)) return '—'; return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1); };
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + f1(Math.abs(n));
export function title() { return 'Projection'; }

// ---------------- charts ----------------
// data: [{ d, v, lo?, hi? }]; past: [{ d, v }] drawn as dots before today; target: horizontal guide.
export function lineChart({ id, data, past = [], W = 340, H = 150, mini = false, unit = '', target = null, targetLabel = '', color = 'var(--accent)', today = null, decimals = 1 }) {
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
      + `<text x="${L}" y="${H - 6}">${fmtShort(xs[0])}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${fmtShort(xs[xs.length - 1])}</text>`;
    if (target != null && target > lo && target < hi) axes += `<line x1="${L}" x2="${W - R}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}" stroke="var(--good)" stroke-dasharray="4 4" opacity=".7"/><text x="${W - R}" y="${(y(target) - 4).toFixed(1)}" text-anchor="end" style="fill:var(--good)">${esc(targetLabel)}</text>`;
    if (today) { const tx = x(today); axes += `<line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="2 3"/><text x="${(tx + 4).toFixed(1)}" y="${T + 8}" style="font-weight:700">Today</text>`; }
  }
  const area = !hasBand && !mini ? '' : '';
  const dots = past.map(p => `<circle cx="${x(p.d).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5" fill="var(--muted)"/>`).join('');
  const [lx, ly] = pts[pts.length - 1];
  const tipData = [...past.map(p => [x(p.d), y(p.v), p.d, p.v, null, null, 1]), ...data.map((p, i) => [pts[i][0], pts[i][1], p.d, p.v, hasBand ? p.lo : null, hasBand ? p.hi : null, 0])]
    .map(a => a.map(v => typeof v === 'number' ? +v.toFixed(decimals + 1) : v));
  return `<svg class="chart bd-chart ${mini ? 'mini' : ''}" viewBox="0 0 ${W} ${H}" data-unit="${esc(unit)}" data-pts='${esc(JSON.stringify(tipData))}' ${mini ? 'preserveAspectRatio="none"' : ''}>
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${axes}${area}
    ${band ? `<path d="${band}" fill="${color}" opacity=".16"/>` : mini ? `<path d="${line} L${lx.toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z" fill="url(#${gid})"/>` : ''}
    ${dots}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${mini ? '' : `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${color}" stroke="var(--card)" stroke-width="2"/>`}
    ${mini ? '' : `<g class="bd-tip-g" style="display:none"><line y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3"/><circle r="4.5" fill="var(--text)" stroke="var(--card)" stroke-width="2"/><rect rx="6" height="20" fill="var(--card2)" stroke="var(--line)"/><text style="fill:var(--text);font-weight:700" text-anchor="middle"></text></g>`}
  </svg>`;
}

export function bindCharts(root) {
  root.querySelectorAll('svg.bd-chart:not(.mini)').forEach(svg => {
    const pts = safe(() => JSON.parse(svg.dataset.pts || '[]'), []); const tip = svg.querySelector('.bd-tip-g'); if (!tip || !pts.length) return;
    const unit = svg.dataset.unit || '';
    const show = ev => {
      const box = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
      const xv = ((ev.clientX - box.left) / box.width) * vb.width;
      let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p;
      const [px, py, d, v, lo, hi, isPast] = best;
      const txt = `${f1(v)}${unit === '%' ? '%' : ' ' + unit}${lo != null && hi != null && Math.abs(hi - lo) > 0.15 ? ` (${f1(lo)}–${f1(hi)})` : ''} · ${fmtShort(d)}${isPast ? '' : ''}`;
      const w = Math.max(80, txt.length * 6.1 + 14);
      tip.style.display = '';
      const ln = tip.querySelector('line'); ln.setAttribute('x1', px); ln.setAttribute('x2', px);
      const c = tip.querySelector('circle'); c.setAttribute('cx', px); c.setAttribute('cy', py);
      const rx = Math.min(Math.max(px - w / 2, 2), vb.width - w - 2);
      const rect = tip.querySelector('rect'); rect.setAttribute('x', rx); rect.setAttribute('y', 0); rect.setAttribute('width', w);
      const t = tip.querySelector('text'); t.setAttribute('x', rx + w / 2); t.setAttribute('y', 14); t.textContent = txt;
    };
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  });
}

// ---------------- state ----------------
const DEF_OPTS = { weeks: 12, until: null, adherence: 0.85, intake: 'auto', goal: null, kcal: null, repeat: true, view: 'side' };
function getOpts(store) { return { ...DEF_OPTS, ...(safe(() => store.kv('projection'), null) || {}) }; }
function setOpts(store, patch) { store.kv('projection', { ...getOpts(store), ...patch }); }
const GOALS = [['recomp', 'Recomp'], ['cut', 'Cut'], ['lean_bulk', 'Lean bulk']];

function weeksOf(o) {
  if (o.until) { const n = Math.ceil(daysBetween(ds(), o.until) / 7); if (n >= 1) return Math.min(104, n); }
  return o.weeks || 12;
}

function compute(store, o) {
  const profile = store.getProfile();
  const bodyLog = safe(() => store.getBodyLog(), []);
  const measurements = safe(() => store.getMeasurements(), []);
  const sessions = safe(() => store.getSessions(), []);
  const now = new Date();
  const b = safe(() => baseline({ profile, bodyLog, measurements, now }), null);
  const nutritionOn = profile.nutrition && profile.nutrition.mode && profile.nutrition.mode !== 'off';
  let prof = profile, intake = null;
  if (o.intake === 'custom' && o.kcal > 800) intake = Number(o.kcal);
  else if (o.intake === 'goal') prof = { ...profile, goal: o.goal || profile.goal, nutrition: { ...(profile.nutrition || {}), mode: 'off' } };
  else if (o.intake === 'auto' && !nutritionOn && o.goal) prof = { ...profile, goal: o.goal };
  const weeks = weeksOf(o);
  const res = b ? safe(() => project({ baseline: b, profile: prof, sessions, weeks, now, intake, adherence: o.adherence, repeatPlan: o.repeat }), null) : null;
  const today = ds(now), end = ds(addDays(now, weeks * 7 - 1));
  const planned = sessions.filter(s => s.status === 'planned' && s.date >= today && s.date <= end && !(s.plan && s.plan.kind === 'rest' && !(s.blocks || []).length));
  return { profile, b, res, weeks, planned, bodyLog, nutritionOn, end };
}

// ---------------- render ----------------
const SITE_ROWS = [['waist', 'Waist', 'down'], ['shoulders', 'Shoulders', 'up'], ['chest', 'Chest', 'up'], ['arm', 'Arms', 'up'], ['forearm', 'Forearm', 'up'], ['neck', 'Neck', 'up'], ['hips', 'Hips', 'down'], ['thigh', 'Thigh', 'up'], ['calf', 'Calf', 'up']];

function keyNums(p, heightIn) {
  if (!p) return '';
  const sh = p.shape || p.measurements || {};
  const sw = p.ratios?.shoulderToWaist ?? (sh.shoulders && sh.waist ? sh.shoulders / sh.waist : null);
  const cell = (v, l) => `<div><b class="num">${v}</b><span>${l}</span></div>`;
  return `<div class="bd-keys">${cell(f1(p.weightLb) + '<small>lb</small>', 'weight')}${cell(f1(p.bodyFatPct) + '<small>%</small>', 'body fat')}${cell(f1(p.leanLb) + '<small>lb</small>', 'lean')}
    ${cell(sh.waist ? f1(sh.waist) + '<small>″</small>' : '—', 'waist')}${cell(sh.arm ? f1(sh.arm) + '<small>″</small>' : '—', 'arm')}${cell(sw ? Number(sw).toFixed(2) : '—', 'V-taper')}</div>`;
}

function setupCard(b, res) {
  const note = res && !(res.series || []).length && res.assumptions && res.assumptions[0];
  return `<div class="card hero center bd-setup">
    <div class="bd-setup-sil">${silhouetteSVG({}, { bodyFatPct: 18, heightIn: b?.heightIn || 69 })}</div>
    <h2>See where your training takes you</h2>
    <p class="small muted mt" style="margin-top:6px">Log your weight (plus height, waist and neck for a body-fat estimate). Forge then projects weight, body fat, lean mass and your shape from your planned workouts, cardio and intake.</p>
    ${note ? `<p class="tiny muted mt">${esc(note)}</p>` : ''}
    <button class="btn btn-primary btn-block mt" data-nav="measure">Log measurements</button>
  </div>`;
}

export function render(ctx) {
  const o = getOpts(ctx.store);
  const { profile, b, res, weeks, planned, bodyLog, nutritionOn, end } = compute(ctx.store, o);
  if (!b || !b.weightLb || !res || !(res.series || []).length) {
    return `<div class="page-head"><p class="sub">Your body in ${weeks} weeks, if the plan happens.</p></div>${setupCard(b, res)}`;
  }
  const S = res.series, s0 = S[0], sN = S[S.length - 1];
  const H = b.heightIn || 69;
  const conf = res.confidence || 'low';
  const confCls = conf === 'high' ? 'good' : conf === 'medium' ? 'accent' : 'warn';
  const shape0 = s0.shape || s0.measurements || b.measurements || {};
  const shapeN = sN.shape || sN.measurements || shape0;

  // controls
  const horizon = [4, 8, 12, 24].map(w => `<button class="chip sm ${!o.until && o.weeks === w ? 'active' : ''}" data-weeks="${w}">${w} wk</button>`).join('')
    + `<label class="chip sm bd-datechip ${o.until ? 'active' : ''}">📅 <input type="date" id="pjUntil" min="${ds(addDays(new Date(), 7))}" value="${o.until || ''}"><span>${o.until ? fmtShort(o.until) : 'Date'}</span></label>`;
  const goalNow = o.goal || profile.goal || 'recomp';
  const intakeChips = [['auto', nutritionOn ? 'Nutrition targets' : 'Goal default'], ['goal', 'What-if goal'], ['custom', 'Custom kcal']]
    .filter(([v]) => !(v === 'goal' && !nutritionOn))
    .map(([v, l]) => `<button class="chip sm ${o.intake === v ? 'active' : ''}" data-intake="${v}">${l}</button>`).join('');
  const showGoal = (o.intake === 'goal') || (o.intake === 'auto' && !nutritionOn);
  const energy = res.energy || {};
  const lastPlan = planned.length ? planned[planned.length - 1].date : null;
  const usingTxt = planned.length
    ? `Using <b>${planned.length}</b> planned session${planned.length === 1 ? '' : 's'} through <b>${fmtShort(lastPlan)}</b>${o.repeat && lastPlan < end ? ' + repeating that pattern' : ''}`
    : res.driverSource === 'history' ? 'No planned sessions yet, so it repeats your recent logged workouts'
      : res.driverSource === 'schedule' ? 'No plan yet, so it uses your weekly schedule template'
        : 'No planned or recent workouts, so no training effect is included';
  const controls = `<div class="card bd-ctrl">
    <div class="label">Horizon</div><div class="chips" style="margin-top:8px">${horizon}</div>
    <div class="row between mt"><div class="label">Adherence</div><div class="num bold" id="pjAdhV">${Math.round(o.adherence * 100)}%</div></div>
    <input type="range" min="0.6" max="1" step="0.05" value="${o.adherence}" id="pjAdh" style="--pct:${((o.adherence - 0.6) / 0.4) * 100}%">
    <div class="tiny muted" style="margin-top:-4px">Share of planned sessions you actually do.</div>
    <div class="label mt">Intake</div><div class="chips" style="margin-top:8px">${intakeChips}</div>
    ${showGoal ? `<div class="tabs mt" data-goalseg>${GOALS.map(([v, l]) => `<button class="${goalNow === v ? 'active' : ''}" data-goal="${v}">${l}</button>`).join('')}</div>` : ''}
    ${o.intake === 'custom' ? `<div class="row mt"><input type="number" inputmode="numeric" id="pjKcal" value="${o.kcal || ''}" placeholder="${energy.intakeStart || 2300}" class="grow"><span class="muted small">kcal/day</span><button class="btn btn-sm" data-kcalgo>Apply</button></div>` : ''}
    <div class="tiny muted" style="margin-top:8px">≈ ${energy.intakeStart ? energy.intakeStart.toLocaleString() : '—'} kcal in vs ${energy.tdeeStart ? energy.tdeeStart.toLocaleString() : '—'} maintenance at the start${energy.intakeSource ? ` · ${{ arg: 'custom', nutrition: 'from nutrition targets', goal: (energy.goal || '').replace('_', ' ') + ' default' }[energy.intakeSource] || ''}` : ''}</div>
    <div class="set-row" style="border:0;padding-bottom:0"><div class="grow"><div class="t">Repeat my plan</div><div class="s">Weeks after the last planned day reuse your average week</div></div><label class="switch"><input type="checkbox" id="pjRepeat" ${o.repeat ? 'checked' : ''}><span></span></label></div>
    <div class="bd-using small">${usingTxt}.</div>
  </div>`;

  // hero
  const label0 = 'Now', labelN = fmtShort(sN.date);
  const silNow = silhouetteSVG(shape0, { bodyFatPct: s0.bodyFatPct, heightIn: H });
  const silThen = silhouetteSVG(shapeN, { bodyFatPct: sN.bodyFatPct, heightIn: H, compare: o.view === 'overlay' ? { measurements: shape0 } : null });
  const sm = res.summary || {};
  const hero = `<div class="card hero bd-hero">
    <div class="row between"><div class="tabs bd-viewseg" style="flex:0 0 auto">${[['side', 'Side by side'], ['overlay', 'Overlay']].map(([v, l]) => `<button class="${o.view === v ? 'active' : ''}" data-view="${v}">${l}</button>`).join('')}</div>
      <span class="badge ${confCls}">${conf} confidence</span></div>
    ${o.view === 'overlay'
      ? `<div class="bd-overlay"><div class="bd-sil-wrap big">${silThen}</div><div class="bd-legend tiny"><span><i class="bd-sw now"></i>Now (outline)</span><span><i class="bd-sw then"></i>${esc(labelN)}</span></div>${keyNums(sN, H)}</div>`
      : `<div class="bd-pair">
          <div class="bd-col"><div class="bd-cap">${label0}</div><div class="bd-sil-wrap">${silNow}</div>${keyNums(s0, H)}</div>
          <div class="bd-arrow">→</div>
          <div class="bd-col then"><div class="bd-cap">${esc(labelN)} <span class="muted">· ${weeks} wk</span></div><div class="bd-sil-wrap">${silThen}</div>${keyNums(sN, H)}</div>
        </div>`}
    <div class="bd-deltas">
      ${[['Weight', sm.weightLb, 'lb', 'none'], ['Fat', sm.fatLb, 'lb', 'down'], ['Lean', sm.leanLb, 'lb', 'up'], ['Waist', sm.waist, '″', 'down']].filter(r => r[1] != null).map(([l, v, u, dir]) => {
        const col = !v || dir === 'none' ? 'var(--text)' : (v < 0) === (dir === 'down') ? 'var(--good)' : 'var(--warn)';
        return `<div><b class="num" style="color:${col}">${sgn(v)}<small>${u}</small></b><span>${l}</span></div>`;
      }).join('')}
    </div>
    ${res.bodyFatAssumed ? '<p class="tiny" style="color:var(--warn);margin-top:10px">Body fat was assumed (no height/neck/waist yet), so these numbers are very rough.</p>' : ''}
  </div>`;

  // charts
  const past = bodyLog.filter(e => e.d < s0.date && daysBetween(e.d, s0.date) <= 42).map(e => ({ d: e.d, v: e.w }));
  const mk = (key) => S.map(p => ({ d: p.date, v: p[key], lo: p.low?.[key], hi: p.high?.[key] }));
  const goalBf = profile.body?.goalBodyFat || 12;
  const charts = `
    <div class="card"><div class="row between"><div class="card-title">Weight</div><div class="small muted num">${f1(s0.weightLb)} → <b style="color:var(--text)">${f1(sN.weightLb)}</b> lb</div></div>
      <div class="mt">${lineChart({ id: 'pw', data: mk('weightLb'), past, unit: 'lb', today: s0.date })}</div>
      <div class="tiny muted">Shaded = realistic low–high range. Grey dots = recent weigh-ins.</div></div>
    <div class="card"><div class="row between"><div class="card-title">Body fat</div><div class="small muted num">${f1(s0.bodyFatPct)} → <b style="color:var(--text)">${f1(sN.bodyFatPct)}</b>%</div></div>
      <div class="mt">${lineChart({ id: 'pb', data: mk('bodyFatPct'), unit: '%', target: goalBf, targetLabel: `goal ${goalBf}%`, color: 'var(--accent2)', today: s0.date })}</div></div>
    <div class="card"><div class="row between"><div class="card-title">Lean mass</div><div class="small muted num">${f1(s0.leanLb)} → <b style="color:var(--text)">${f1(sN.leanLb)}</b> lb</div></div>
      <div class="mt">${lineChart({ id: 'pl', data: mk('leanLb'), unit: 'lb', color: 'var(--good)', today: s0.date })}</div></div>`;

  // measurements table
  const est = new Set(res.shapeEstimated || []);
  const rows = SITE_ROWS.filter(([k]) => shape0[k] != null && shapeN[k] != null).map(([k, l, dir]) => {
    const d = shapeN[k] - shape0[k];
    const col = Math.abs(d) < 0.05 ? 'var(--muted)' : (d < 0) === (dir === 'down') ? 'var(--good)' : 'var(--warn)';
    return `<tr class="${est.has(k) ? 'est' : ''}"><th>${l}${est.has(k) ? ' <span class="tiny muted">est.</span>' : ''}</th><td>${f1(shape0[k])}″</td><td>${f1(shapeN[k])}″</td><td style="color:${col};font-weight:750">${Math.abs(d) < 0.05 ? '—' : sgn(d)}</td></tr>`;
  }).join('');
  const sw0 = s0.ratios?.shoulderToWaist, swN = sN.ratios?.shoulderToWaist;
  const table = `<div class="card" style="padding:6px 14px">
    <table class="bd-ptable num"><thead><tr><th></th><th>Now</th><th>${esc(fmtShort(sN.date))}</th><th>Δ</th></tr></thead><tbody>${rows}
    ${sw0 && swN ? `<tr><th>Shoulder:waist</th><td>${sw0.toFixed(2)}</td><td>${swN.toFixed(2)}</td><td style="color:${swN > sw0 ? 'var(--good)' : 'var(--muted)'};font-weight:750">${swN - sw0 >= 0.005 ? '+' + (swN - sw0).toFixed(2) : '—'}</td></tr>` : ''}</tbody></table>
    ${est.size ? `<p class="tiny muted" style="margin:6px 0 8px">"est." = not measured yet; drawn from a typical build. <a href="#/measure">Measure it</a>.</p>` : ''}</div>`;

  // milestones
  const ms = res.milestones || [];
  const msHtml = ms.length ? `<div class="card bd-miles">${ms.map(m => {
    const st = m.already ? 'done' : m.date ? 'hit' : 'beyond';
    const when = m.already ? 'Already there' : m.date ? fmtShort(m.date) + (m.date.slice(0, 4) !== ds().slice(0, 4) ? ' ' + m.date.slice(0, 4) : '') : 'Beyond horizon';
    return `<div class="bd-mile ${st}"><i></i><div class="grow"><div class="row between" style="align-items:flex-start"><div class="t">${esc(m.label)}</div><div class="w">${esc(when)}</div></div>${m.note ? `<div class="tiny muted">${esc(m.note)}</div>` : ''}</div></div>`;
  }).join('')}</div>` : '';

  // weekly
  const wk = res.weekly || {};
  const weekly = `<div class="grid3">
    <div class="stat"><div class="v">${f1(wk.liftSetsPerWeek || 0)}</div><div class="l">Lift sets / wk</div></div>
    <div class="stat"><div class="v">${Math.round(wk.cardioMinPerWeek || 0)}<small>min</small></div><div class="l">Cardio / wk</div></div>
    <div class="stat"><div class="v" style="color:${(wk.kcalBalance ?? (wk.kcalIn - wk.kcalOut)) < 0 ? 'var(--good)' : 'var(--accent2)'}">${sgn(Math.round(wk.kcalBalance ?? (wk.kcalIn - wk.kcalOut) ?? 0)).replace('.0', '')}</div><div class="l">kcal / day</div></div></div>`;

  const assumptions = (res.assumptions || []).length ? `<details class="card bd-assume"><summary><span class="card-title">How this is calculated</span><span class="badge ${confCls}">${conf}</span></summary>
    <ul class="tip-list mt">${res.assumptions.map(a => `<li class="small">${esc(a)}</li>`).join('')}</ul></details>` : '';
  const missing = (res.missingInfo || []).filter(x => x.field !== 'weight');

  return `<div class="page-head"><p class="sub">Your body in ${weeks} weeks if the plan happens, cardio included.</p></div>
    ${hero}
    ${controls}
    <div class="section-title">Trends</div>${charts}
    <div class="section-title">Projected measurements</div>${table}
    <div class="section-title">Milestones</div>${msHtml}
    <div class="section-title">Average week in this projection</div>${weekly}
    ${missing.length ? `<div class="card bd-miss mt"><div class="label">Sharpen the projection</div><ul>${missing.slice(0, 5).map(x => `<li><b>${esc(x.label)}</b> <span class="muted">${esc(x.why)}</span></li>`).join('')}</ul><button class="btn btn-sm btn-ghost mt" data-nav="measure">Add measurements</button></div>` : ''}
    <div class="section-title">The fine print</div>
    ${assumptions}
    <p class="small muted bd-disclaim">These are estimates from simple, conservative models, not promises. Real bodies vary a lot. Re-measure every 2-4 weeks and the projection re-anchors to what actually happened.</p>
    <button class="card tap bd-planlink" data-nav="plan"><span style="font-size:22px">🗓️</span><div class="grow"><div class="t">Change the plan</div><div class="s">More sessions, cardio or sets → see the projection update</div></div><span class="chev">›</span></button>`;
}

export function bind(root, ctx) {
  const st = ctx.store;
  root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => ctx.nav(b.dataset.nav));
  root.querySelectorAll('[data-weeks]').forEach(b => b.onclick = () => setOpts(st, { weeks: +b.dataset.weeks, until: null }));
  const until = root.querySelector('#pjUntil');
  if (until) until.onchange = () => { if (until.value && until.value > ds()) { until.blur(); setOpts(st, { until: until.value }); } };
  const adh = root.querySelector('#pjAdh');
  if (adh) {
    adh.oninput = () => { root.querySelector('#pjAdhV').textContent = Math.round(adh.value * 100) + '%'; adh.style.setProperty('--pct', ((adh.value - 0.6) / 0.4) * 100 + '%'); };
    adh.onchange = () => { adh.blur(); setOpts(st, { adherence: +adh.value }); };
  }
  root.querySelectorAll('[data-intake]').forEach(b => b.onclick = () => setOpts(st, { intake: b.dataset.intake }));
  root.querySelectorAll('[data-goal]').forEach(b => b.onclick = () => setOpts(st, { goal: b.dataset.goal }));
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setOpts(st, { view: b.dataset.view }));
  const kc = root.querySelector('#pjKcal');
  const applyK = () => { const v = parseInt(kc.value, 10); if (!(v >= 1000 && v <= 6000)) { ctx.toast('Enter 1000–6000 kcal'); return; } kc.blur(); setOpts(st, { kcal: v }); };
  root.querySelector('[data-kcalgo]')?.addEventListener('click', applyK);
  kc?.addEventListener('keydown', e => { if (e.key === 'Enter') applyK(); });
  const rp = root.querySelector('#pjRepeat');
  if (rp) rp.onchange = () => setOpts(st, { repeat: rp.checked });
  bindCharts(root);
}
