// Body tab: recovery / volume insights, body map, cardio, strength trends, bodyweight (UI-SHELL).
import * as rec from '../engine/recovery.js';
import * as prog from '../engine/progression.js';
import { REGIONS, GROUPS, GROUP_ORDER } from '../data/muscles.js';
import { SCULPT_GOALS } from '../data/sculpt.js';
import { getEx } from '../data/exercises.js';
import { esc, readinessColor, muscleBar } from './components.js';
import { ds, fmtShort, addDays, daysBetween } from '../util.js';
import * as bodycomp from '../engine/bodycomp.js';
import { silhouetteSVG } from './silhouette.js';
import { mount3D, body3d, supports3D, estMuscle } from './projection.js';
import { targetsSummaryHTML, bindTargetsSummary, cardioTargetHTML, bindCardioTarget } from './targets.js';
// CONTRACT-NOTE (INTEGRATOR §18): the cardio card is the shared editable weekly target
// (targets.js cardioTargetHTML: stepper + 90/150/225/300 chips, done vs planned vs target this
// calendar week) and a "Your targets" strip sits at the top. Both write through setTargets.
let card3d = null;   // 3D opts for the "Your body" card (UI-LAB)

const safe = (fn, fb) => { try { const v = fn(); return v == null ? fb : v; } catch (e) { console.error(e); return fb; } };
const f1 = n => { n = Number(n) || 0; return Math.round(n) === n ? String(n) : n.toFixed(1); };
const statusLabel = (r = 1, n = 0) => r < 0.5 ? 'Recovering' : r < 0.8 ? 'Almost ready' : n >= 0.5 ? 'Needs work' : n >= 0.2 ? 'Ready' : 'On track';
const ago = d => d == null ? 'Not trained yet' : d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d}d ago`;

function goalGroups(profile) {
  const gs = new Set(), rs = new Set();
  for (const id of profile.sculptGoals || []) {
    const g = SCULPT_GOALS[id]; if (!g) continue;
    if (g.group && GROUPS[g.group]) gs.add(g.group);
    for (const r of Object.keys(g.regions || {})) { rs.add(r); if (REGIONS[r]) gs.add(REGIONS[r].group); }
  }
  return { gs, rs };
}

// ---------------- body map ----------------
const E = (r, cx, cy, rx, ry, rot = 0) => ({ r, s: `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`, m: `<ellipse cx="${120 - cx}" cy="${cy}" rx="${rx}" ry="${ry}"${rot ? ` transform="rotate(${-rot} ${120 - cx} ${cy})"` : ''}/>` });
const Rc = (r, x, y, w, h, rx = 4, mirror = true) => ({ r, s: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`, m: mirror ? `<rect x="${120 - x - w}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>` : '' });
const P = (r, pts, mirror = true) => ({ r, s: `<polygon points="${pts.map(p => p.join(',')).join(' ')}" stroke-linejoin="round"/>`, m: mirror ? `<polygon points="${pts.map(([x, y]) => (120 - x) + ',' + y).join(' ')}" stroke-linejoin="round"/>` : '' });

const FRONT = [
  E('delt_side', 30, 52, 7, 10, 15), E('delt_front', 37, 51, 6.5, 9),
  Rc('chest_upper', 43, 44, 16, 10), Rc('chest_mid', 43, 55, 16, 10), Rc('chest_lower', 44, 66, 15, 7),
  E('biceps_long', 26.5, 75, 4.2, 12, 8), E('biceps_short', 32, 76, 3.8, 11, 8), E('brachialis', 23, 89, 3, 5, 10),
  E('forearms', 20, 111, 5.5, 16, 10),
  Rc('abs', 52, 76, 16, 46, 6, false), P('obliques', [[42, 77], [50, 78], [50, 114], [44, 108], [41, 92]]),
  E('quads', 48, 155, 10, 29, -3), E('adductors', 57, 150, 3.2, 17),
  E('calves', 46.5, 207, 6, 19, -2),
];
const BACK = [
  P('traps', [[60, 31], [77, 46], [60, 62], [43, 46]], false),
  E('delt_rear', 33, 52, 8, 9.5, 12),
  Rc('upper_back', 44, 60, 15, 14, 5),
  P('lats', [[41, 64], [50, 76], [56, 104], [48, 102], [40, 82]]),
  Rc('lower_back', 54, 96, 12, 24, 5, false),
  E('triceps_long', 31.5, 77, 4, 12.5, 8), E('triceps_lateral', 25.5, 75, 4, 11, 10), E('triceps_medial', 28.5, 91, 3, 4),
  E('forearms', 20, 111, 5.5, 16, 10),
  E('glute_med', 46, 124, 7, 5.5), E('glutes', 51, 137, 9.5, 10.5),
  E('hamstrings', 49, 169, 9, 23, -2),
  E('calves', 48, 207, 7, 18, -2),
];
const SIL = `<g fill="#23232b">
  <circle cx="60" cy="17" r="11"/><rect x="54" y="26" width="12" height="10" rx="3"/>
  <path d="M38 40 Q60 34 82 40 L84 80 Q80 118 76 124 L44 124 Q40 118 36 80 Z"/>
  <path d="M40 120 L80 120 L78 140 L42 140 Z"/>
  <path d="M24 48 Q16 70 18 96 L14 128 L24 130 L32 98 L38 60 Z"/><path d="M96 48 Q104 70 102 96 L106 128 L96 130 L88 98 L82 60 Z"/>
  <path d="M40 128 Q36 170 40 186 L38 236 L52 236 L56 186 L59 134 Z"/><path d="M80 128 Q84 170 80 186 L82 236 L68 236 L64 186 L61 134 Z"/>
</g>`;

function bodyMapSvg(shapes, ms) {
  const parts = shapes.map(sh => {
    const st = ms[sh.r]; const col = st ? readinessColor(st.readiness, st.need) : 'var(--line)';
    return `<g class="rg" data-region="${sh.r}" fill="${col}"><title>${esc(REGIONS[sh.r]?.name || sh.r)}</title>${sh.s}${sh.m}</g>`;
  }).join('');
  return `<svg viewBox="0 0 120 244" role="img">${SIL}${parts}</svg>`;
}

// ---------------- charts ----------------
function sparkline(vals) {
  if (!vals || vals.length < 2) return '<svg class="spark" viewBox="0 0 84 30"></svg>';
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => [2 + (i * 80) / (vals.length - 1), 26 - ((v - lo) / span) * 22]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const up = vals[vals.length - 1] >= vals[0];
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 84 30"><path d="${d}" fill="none" stroke="${up ? 'var(--good)' : 'var(--muted)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lx}" cy="${ly}" r="3" fill="${up ? 'var(--good)' : 'var(--muted)'}" stroke="var(--card)" stroke-width="1.5"/></svg>`;
}

function weightChart(log) {
  const W = 340, H = 150, L = 34, R = 10, T = 12, B = 22;
  const data = log.slice(-60);
  if (data.length < 2) return '';
  const ws = data.map(e => e.w);
  let lo = Math.floor(Math.min(...ws) - 1), hi = Math.ceil(Math.max(...ws) + 1);
  const t0 = new Date(data[0].d).getTime(), t1 = new Date(data[data.length - 1].d).getTime() || t0 + 1;
  const x = d => L + ((new Date(d).getTime() - t0) / ((t1 - t0) || 1)) * (W - L - R);
  const y = w => T + (1 - (w - lo) / ((hi - lo) || 1)) * (H - T - B);
  const pts = data.map(e => [x(e.d), y(e.w)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${H - B} L${pts[0][0].toFixed(1)} ${H - B} Z`;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const grid = ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${t}</text>`).join('');
  const xl = `<text x="${L}" y="${H - 6}">${fmtShort(data[0].d)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${fmtShort(data[data.length - 1].d)}</text>`;
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="chart" id="wchart" viewBox="0 0 ${W} ${H}" data-pts='${esc(JSON.stringify(data.map((e, i) => [pts[i][0], pts[i][1], e.d, e.w])))}'>
    <defs><linearGradient id="wg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xl}<path d="${area}" fill="url(#wg)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>
    <g id="wtip" style="display:none"><line y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3"/><circle r="4.5" fill="var(--text)" stroke="var(--card)" stroke-width="2"/><rect rx="6" height="20" width="86" fill="var(--card2)" stroke="var(--line)"/><text fill="var(--text)" style="fill:var(--text);font-weight:700"></text></g>
  </svg>`;
}

function ring(pct, color, label) {
  const r = 26, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct));
  return `<div class="ring"><svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="#2a2a33" stroke-width="7"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c * p} ${c}"/></svg><div class="rv">${label}</div></div>`;
}

// ---------------- "Your body" card (UI-BODY) ----------------
function yourBodyCard(store, profile, log) {
  const meas = safe(() => store.getMeasurements(), []);
  const b = safe(() => bodycomp.baseline({ profile, bodyLog: log, measurements: meas, now: new Date() }), null);
  const m = b?.measurements || {};
  const has = b && b.weightLb;
  const stat = (v, u, l) => `<div><b>${v ?? '—'}${v != null ? `<small>${u}</small>` : ''}</b><span>${l}</span></div>`;
  const H = b?.heightIn || 69;
  card3d = has ? { shape: { ...(b.shape || m), heightIn: H }, muscle: b.muscle || estMuscle({ leanLb: b.comp?.leanLb }, H), bodyFatPct: b.bodyFatPct ?? null } : null;
  return `<div class="card bd-card">
    <div class="bd-card-sil bd-card-3d" id="bdCard3d" aria-hidden="true">${silhouetteSVG(m, { bodyFatPct: b?.bodyFatPct, heightIn: H })}</div>
    <div class="grow"><div class="row between"><div class="card-title">Your body</div>${has && b.bodyFatSource ? `<span class="tiny muted">${b.bodyFatSource === 'navy' ? 'tape BF' : b.bodyFatSource === 'manual' ? 'measured BF' : 'est. BF'}</span>` : ''}</div>
      ${has ? `<div class="bd-stats">${stat(f1(b.weightLb), 'lb', 'weight')}${stat(b.bodyFatPct != null ? f1(b.bodyFatPct) : null, '%', 'body fat')}${stat(m.waist != null ? f1(m.waist) : null, '″', 'waist')}</div>`
        : `<p class="small muted" style="margin-top:4px">Add weight, height and a few tape measurements to see body fat and a projection of where your training is taking you.</p>`}
      <div class="btn-row"><button class="btn" data-bdnav="measure">📏 ${has ? 'Log' : 'Measure'}</button><button class="btn ${has ? 'btn-primary' : ''}" data-bdnav="projection">🔮 Projection</button><button class="btn btn-ghost" data-bdnav="supplements">💊 Supplements &amp; metabolism</button></div>
    </div></div>`;
}

// ---------------- render ----------------
export function render(ctx) {
  const store = ctx.store;
  const profile = store.getProfile();
  const sessions = safe(() => store.getSessions(), []);
  const now = new Date();
  const gsAll = safe(() => rec.groupStatus(sessions, { now, profile }), {});
  const ms = safe(() => rec.muscleStatus(sessions, { now, profile }), {});
  const cardio = safe(() => rec.cardioStatus(sessions, { now, profile }), { minutes7d: 0, target: profile.cardioTargetMin || 120, daysSince: null, sessions7d: 0, suggestion: '' });
  const week = safe(() => rec.weekSummary(sessions, { now }), { sessions: 0, liftSets: 0, cardioMinutes: 0, byGroup: {} });
  const stk = safe(() => rec.streak(sessions, { now }), { days: 0, weeksActive: 0 });
  const { gs: goalG, rs: goalR } = goalGroups(profile);

  const groups = GROUP_ORDER.filter(g => GROUPS[g] && gsAll[g]).map(g => ({ id: g, ...gsAll[g] }));
  const next = groups.filter(g => (g.readiness ?? 1) >= 0.8 && (g.need ?? 0) >= 0.35).sort((a, b) => b.need - a.need).slice(0, 3);
  const doneSessions = sessions.filter(s => s.status === 'done');

  // Week summary
  const hero = `<div class="card hero">
    <div class="row between"><div><div class="label">This week</div><h2 class="mt" style="margin-top:2px">${week.sessions ? `${week.sessions} session${week.sessions === 1 ? '' : 's'}` : 'Fresh week'}</h2></div>
      <div class="center"><div style="font-size:30px;font-weight:850;line-height:1">${stk.days || 0}<span style="font-size:18px">🔥</span></div><div class="tiny muted bold">DAY STREAK</div></div></div>
    <div class="grid3 mt">
      <div class="stat"><div class="v">${Math.round(week.liftSets || 0)}</div><div class="l">Lift sets</div></div>
      <div class="stat"><div class="v">${Math.round(week.cardioMinutes || 0)}<small>min</small></div><div class="l">Cardio</div></div>
      <div class="stat"><div class="v">${stk.weeksActive || 0}<small>wk</small></div><div class="l">Active weeks</div></div>
    </div>
    ${next.length ? `<div class="mt2"><div class="label">Ready & behind on volume</div><div class="chips mt">${next.map(g => `<button class="chip" data-group="${g.id}"><span class="dot-i" style="background:${readinessColor(g.readiness, g.need)}"></span>${esc(GROUPS[g.id].name)}</button>`).join('')}</div></div>` : ''}
  </div>`;

  const legend = `<div class="legend">${[['var(--good)', 'Needs work'], ['var(--accent)', 'Ready'], ['var(--warn)', 'Almost ready'], ['var(--bad)', 'Recovering'], ['var(--muted)', 'On track']].map(([c, l]) => `<span><i class="dot-i" style="background:${c}"></i>${l}</span>`).join('')}</div>`;
  const map = `<div class="card"><div class="bodymap"><figure>${bodyMapSvg(FRONT, ms)}<figcaption>Front</figcaption></figure><figure>${bodyMapSvg(BACK, ms)}<figcaption>Back</figcaption></figure></div>${legend}<p class="tiny muted center mt">Tap a muscle for details</p></div>`;

  const gcards = groups.map(g => {
    const G = GROUPS[g.id]; const t = g.target || G.weeklySets || { min: 10, max: 20 };
    const col = readinessColor(g.readiness, g.need);
    const max = Math.max(t.max || t.min || 1, g.sets7d || 0, 1);
    const isGoal = goalG.has(g.id); const prio = (profile.groupPriority?.[g.id] || 1) > 1.05;
    return `<button class="card tap gcard ${isGoal ? 'goal' : ''}" data-group="${g.id}">
      <div class="row"><span style="font-size:20px">${esc(G.emoji || '')}</span><div class="grow"><div class="gname">${esc(G.name)} ${isGoal || prio ? '<span class="star">★</span>' : ''}</div>
        <div class="gmeta"><span style="color:${col};font-weight:700">${statusLabel(g.readiness, g.need)}</span> · ${ago(g.daysSince)}</div></div>
        <div class="gsets">${f1(g.sets7d || 0)}<span class="muted" style="font-weight:600">/${Math.round(t.min)}</span></div></div>
      <div class="bar"><i style="width:${Math.min(100, ((g.sets7d || 0) / max) * 100)}%;background:${col}"></i><span class="tick" style="left:${(t.min / max) * 100}%"></span></div>
    </button>`;
  }).join('');

  // Cardio: the shared weekly target card (editable), plus the rolling 7-day line underneath.
  const cardioCard = safe(() => cardioTargetHTML(ctx), '') + `<p class="tiny muted" style="margin:-4px 4px 12px">Last 7 days: ${cardio.minutes7d || 0} min in ${cardio.sessions7d || 0} session${cardio.sessions7d === 1 ? '' : 's'} · last ${ago(cardio.daysSince).toLowerCase()}</p>`;

  // Strength trends
  const prs = safe(() => prog.personalRecords(doneSessions), {});
  const top = Object.entries(prs).filter(([id, p]) => p && p.e1rm > 0 && getEx(id)).sort((a, b) => b[1].e1rm - a[1].e1rm).slice(0, 6);
  const trends = top.length ? `<div class="list">${top.map(([id, p]) => {
    const h = safe(() => prog.exerciseHistory(id, doneSessions), []).filter(x => x.e1rm > 0).slice(-10);
    const vals = h.map(x => x.e1rm);
    const delta = vals.length > 1 ? Math.round(vals[vals.length - 1] - vals[0]) : 0;
    return `<button class="list-item" data-ex="${esc(id)}"><div class="grow"><div class="t ellipsis">${esc(getEx(id).name)}</div>
      <div class="s num">Best ${p.w ? f1(p.w) + '×' : ''}${p.r} · e1RM ${Math.round(p.e1rm)}${delta ? ` · <span style="color:${delta > 0 ? 'var(--good)' : 'var(--muted)'}">${delta > 0 ? '+' : ''}${delta}</span>` : ''}</div></div>${sparkline(vals)}</button>`;
  }).join('')}</div>` : `<div class="card"><div class="empty" style="padding:14px"><p>Log a few weighted sets and your top lifts will chart here.</p></div></div>`;

  // Bodyweight
  const log = safe(() => store.getBodyLog(), []);
  const lastW = log[log.length - 1];
  const prevW = log.length > 1 ? log.filter(e => daysBetween(e.d, lastW.d) >= 7).pop() || log[0] : null;
  const dW = lastW && prevW ? +(lastW.w - prevW.w).toFixed(1) : null;
  const bw = `<div class="card">
    <div class="row between"><div><div class="card-title">⚖️ Bodyweight</div>
      ${lastW ? `<div class="num" style="font-size:26px;font-weight:850;margin-top:2px">${f1(lastW.w)}<span class="muted small" style="font-weight:600"> lb · ${fmtShort(lastW.d)}</span></div>${dW != null ? `<div class="small" style="color:var(--muted)">${dW > 0 ? '+' : ''}${dW} lb since ${fmtShort(prevW.d)}</div>` : ''}` : '<p class="small muted">No weigh-ins yet.</p>'}</div>
      ${log.length ? `<button class="btn btn-sm btn-ghost" data-wall>All</button>` : ''}</div>
    ${weightChart(log) ? `<div class="mt">${weightChart(log)}</div>` : ''}
    <div class="row mt"><input type="number" inputmode="decimal" step="0.1" id="wIn" placeholder="${lastW ? f1(lastW.w) : 'Weight'} lb" class="grow"><button class="btn btn-primary" data-wlog>Log today</button></div>
  </div>`;

  return `<div class="page-head"><h1>Body</h1><p class="sub">Volume, recovery and progress across every muscle.</p></div>
    ${safe(() => targetsSummaryHTML(ctx), '')}
    ${yourBodyCard(store, profile, log)}
    ${hero}
    <div class="section-title">Muscle map</div>${map}
    <div class="section-title">Weekly sets vs target <span class="tiny muted" style="text-transform:none;letter-spacing:0">★ = goal / priority</span></div>${gcards}
    <div class="section-title">Cardio</div>${cardioCard}
    <div class="section-title">Strength trends</div>${trends}
    <div class="section-title">Bodyweight</div>${bw}`;
}

// ---------------- sheets ----------------
function groupSheet(ctx, gid, focusRegion) {
  const profile = ctx.store.getProfile();
  const sessions = safe(() => ctx.store.getSessions(), []);
  const now = new Date();
  const gst = safe(() => rec.groupStatus(sessions, { now, profile }), {})[gid] || {};
  const G = GROUPS[gid]; if (!G) return;
  const { rs: goalR } = goalGroups(profile);
  const regions = G.regions.map(r => ({ id: r, st: gst.regions?.[r] || {} }));
  const since = ds(addDays(now, -42));
  const recent = [];
  const seen = new Set();
  for (const s of [...sessions].reverse()) {
    if (s.date < since || s.status === 'planned') continue;
    for (const b of s.blocks || []) {
      if (b.kind !== 'lift' || seen.has(b.exId)) continue;
      const ex = getEx(b.exId); if (!ex) continue;
      const hit = G.regions.reduce((m, r) => Math.max(m, ex.muscles?.[r] || 0), 0);
      const done = (b.sets || []).filter(x => x.done && x.r > 0);
      if (hit < 0.5 || !done.length) continue;
      seen.add(b.exId);
      recent.push({ ex, date: s.date, txt: safe(() => prog.formatSets ? prog.formatSets(done, ex.unit) : null, null) || done.map(x => (x.w ? f1(x.w) + '×' : '') + x.r).join(', ') });
    }
    if (recent.length >= 6) break;
  }
  const col = readinessColor(gst.readiness, gst.need);
  ctx.openSheet(`<div class="row"><span style="font-size:30px">${esc(G.emoji || '')}</span><div class="grow"><h2>${esc(G.name)}</h2>
      <div class="small"><span style="color:${col};font-weight:700">${statusLabel(gst.readiness, gst.need)}</span> <span class="muted">· ${ago(gst.daysSince)} · ${f1(gst.sets7d || 0)} sets this week</span></div></div></div>
    <div class="section-title">Regions</div>
    <div class="card flat">${regions.map(({ id, st }) => `<div ${focusRegion === id ? 'style="outline:1px solid var(--accent);outline-offset:6px;border-radius:6px"' : ''}>${muscleBar((REGIONS[id]?.name || id) + (goalR.has(id) ? ' ★' : ''), st.sets7d || 0, st.target || REGIONS[id]?.weeklySets)}
      <div class="tiny muted" style="margin:-2px 0 10px">${ago(st.daysSince)} · readiness ${Math.round((st.readiness ?? 1) * 100)}%</div></div>`).join('')}</div>
    ${focusRegion && REGIONS[focusRegion]?.description ? `<p class="small muted">${esc(REGIONS[focusRegion].description)}</p>` : ''}
    <div class="section-title">Recent exercises</div>
    ${recent.length ? `<div class="list">${recent.map(r => `<button class="list-item" data-ex="${esc(r.ex.id)}"><div class="grow"><div class="t ellipsis">${esc(r.ex.name)}</div><div class="s num">${fmtShort(r.date)} · ${esc(r.txt)}</div></div><span class="chev">›</span></button>`).join('')}</div>` : '<p class="muted small">Nothing in the last 6 weeks.</p>'}
    <div class="sheet-actions"><button class="btn btn-primary btn-block" data-train>Train ${esc(G.name.toLowerCase())} now</button></div>`, (el, close) => {
    el.querySelector('[data-train]').onclick = () => { close(); ctx.nav('today', { targets: [gid] }); };
    el.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => { close(); ctx.nav('exercise', { id: b.dataset.ex }); });
  });
}

function weightsSheet(ctx) {
  const log = [...safe(() => ctx.store.getBodyLog(), [])].reverse();
  ctx.openSheet(`<h2>Weigh-ins</h2><p class="muted small">${log.length} entries</p>
    <div class="list mt">${log.map(e => `<div class="list-item"><div class="grow"><div class="t num">${f1(e.w)} lb</div><div class="s">${fmtShort(e.d)}, ${e.d.slice(0, 4)}</div></div><button class="btn btn-sm btn-ghost" data-del="${e.d}">Delete</button></div>`).join('')}</div>`, (el, close) => {
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (b.dataset.armed) { ctx.store.deleteBodyweight(b.dataset.del); b.closest('.list-item').remove(); ctx.toast('Deleted'); }
      else { b.dataset.armed = '1'; b.textContent = 'Confirm'; b.classList.add('btn-danger'); }
    });
  });
}

export function bind(root, ctx) {
  root.querySelectorAll('[data-bdnav]').forEach(b => b.onclick = () => ctx.nav(b.dataset.bdnav));
  safe(() => { bindTargetsSummary(root, ctx); bindCardioTarget(root, ctx); return true; }, null);
  const host3d = root.querySelector('#bdCard3d');
  if (host3d && card3d) {
    const o3 = card3d;
    body3d().then(() => { if (host3d.isConnected && supports3D()) mount3D('body', root, host3d, { ...o3, height: 170, autoRotate: false, showPoses: false }); });
  }
  root.querySelectorAll('[data-group]').forEach(b => b.onclick = () => groupSheet(ctx, b.dataset.group));
  root.querySelectorAll('.bodymap [data-region]').forEach(g => g.addEventListener('click', () => {
    const r = g.dataset.region; groupSheet(ctx, REGIONS[r]?.group, r);
  }));
  root.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => ctx.nav('exercise', { id: b.dataset.ex }));
  const wIn = root.querySelector('#wIn');
  const logW = () => {
    const v = parseFloat(wIn.value);
    if (!(v > 50 && v < 600)) { ctx.toast('Enter a weight in lb'); return; }
    wIn.blur(); ctx.store.logBodyweight(ds(), v); ctx.toast(`Logged ${f1(v)} lb`);
  };
  root.querySelector('[data-wlog]').onclick = logW;
  wIn.addEventListener('keydown', e => { if (e.key === 'Enter') logW(); });
  root.querySelector('[data-wall]')?.addEventListener('click', () => weightsSheet(ctx));

  // Weight chart tooltip (tap / hover → nearest point)
  const svg = root.querySelector('#wchart');
  if (svg) {
    const pts = JSON.parse(svg.dataset.pts || '[]'); const tip = svg.querySelector('#wtip');
    const show = ev => {
      const box = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
      const x = ((ev.clientX - box.left) / box.width) * vb.width;
      let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
      const [px, py, d, w] = best;
      tip.style.display = '';
      tip.querySelector('line').setAttribute('x1', px); tip.querySelector('line').setAttribute('x2', px);
      const c = tip.querySelector('circle'); c.setAttribute('cx', px); c.setAttribute('cy', py);
      const rx = Math.min(Math.max(px - 43, 30), vb.width - 92);
      const rect = tip.querySelector('rect'); rect.setAttribute('x', rx); rect.setAttribute('y', 0);
      const t = tip.querySelector('text'); t.setAttribute('x', rx + 43); t.setAttribute('y', 14); t.setAttribute('text-anchor', 'middle'); t.textContent = `${f1(w)} lb · ${fmtShort(d)}`;
    };
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
  }
}
