// Exercise library (route 'library') and exercise detail (route 'exercise', params.id) (UI-SHELL).
import { EXERCISES, getEx } from '../data/exercises.js';
import { REGIONS, GROUPS, GROUP_ORDER } from '../data/muscles.js';
import { SCULPT_GOALS } from '../data/sculpt.js';
import { EQUIPMENT, expandEquipment, canDo } from '../data/equipment.js';
import * as gen from '../engine/generator.js';
import * as prog from '../engine/progression.js';
import { esc } from './components.js';
import { fmtShort } from '../util.js';

const F = { q: '', group: null, here: true, goal: null, fav: false };
const f1 = n => { n = Number(n) || 0; return Math.round(n) === n ? String(n) : n.toFixed(1); };
const safe = (fn, fb) => { try { const v = fn(); return v == null ? fb : v; } catch (e) { console.error(e); return fb; } };

const goalTag = g => g.emphasisTag || g.id;
function groupWeight(ex, gid) { return Math.max(0, ...(GROUPS[gid]?.regions || []).map(r => ex.muscles?.[r] || 0)); }
function mainGroup(ex) {
  const top = Object.entries(ex.muscles || {}).sort((a, b) => b[1] - a[1])[0];
  return top ? REGIONS[top[0]]?.group : null;
}
const initials = ex => (ex.name || '?').split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const eqNames = ex => (ex.equipment || []).filter(e => e !== 'bodyweight').map(e => EQUIPMENT[e]?.name || e.replace(/_/g, ' '));

function filtered(ctx) {
  const p = ctx.store.getProfile();
  const eq = expandEquipment(ctx.location()?.equipment || []);
  const favs = new Set(p.favoriteExercises || []);
  const q = F.q.trim().toLowerCase();
  const goal = F.goal && SCULPT_GOALS[F.goal];
  let list = EXERCISES.filter(ex => {
    if (F.group && groupWeight(ex, F.group) < 0.5) return false;
    if (F.here && !canDo(ex, eq)) return false;
    if (F.fav && !favs.has(ex.id)) return false;
    if (goal && !(ex.emphasis || []).includes(goalTag(goal))) return false;
    if (q) {
      const hay = `${ex.name} ${ex.id} ${(ex.equipment || []).join(' ')} ${Object.keys(ex.muscles || {}).map(r => REGIONS[r]?.name || r).join(' ')} ${ex.pattern || ''}`.toLowerCase();
      if (!q.split(/\s+/).every(t => hay.includes(t))) return false;
    }
    return true;
  });
  list.sort((a, b) => (favs.has(b.id) - favs.has(a.id)) || (F.group ? groupWeight(b, F.group) - groupWeight(a, F.group) : 0) || a.name.localeCompare(b.name));
  return { list, favs, eq };
}

function rowHtml(ex, { favs, eq, avoid }) {
  const can = canDo(ex, eq);
  const g = mainGroup(ex);
  return `<button class="list-item" data-ex="${esc(ex.id)}"><span class="ex-ic">${esc(GROUPS[g]?.emoji || initials(ex))}</span>
    <div class="grow"><div class="t ellipsis">${esc(ex.name)}${favs.has(ex.id) ? ' <span class="star">★</span>' : ''}${avoid.has(ex.id) ? ' <span class="badge bad" style="padding:1px 6px">avoid</span>' : ''}</div>
    <div class="s ellipsis">${esc(eqNames(ex).join(' · ') || 'Bodyweight')}${can ? '' : ' · <span style="color:var(--warn)">not here</span>'}</div></div><span class="chev">›</span></button>`;
}

function resultsHtml(ctx) {
  const { list, favs, eq } = filtered(ctx);
  const avoid = new Set(ctx.store.getProfile().avoidExercises || []);
  if (!list.length) return `<div class="card"><div class="empty"><div class="big">🔎</div><h3>No matches</h3><p>Try clearing a filter.</p></div></div>`;
  const shown = list.slice(0, 150);
  return `<div class="tiny muted bold" style="margin:4px 4px 8px;letter-spacing:.06em;text-transform:uppercase">${list.length} exercise${list.length === 1 ? '' : 's'}</div>
    <div class="list">${shown.map(ex => rowHtml(ex, { favs, eq, avoid })).join('')}</div>${list.length > shown.length ? `<p class="muted small center">Showing 150, refine the search to see more.</p>` : ''}`;
}

export function title(ctx, params) {
  if (params?.id) return 'Exercise';
  return 'Exercise Library';
}

export function render(ctx, params = {}) {
  if (params.id) return renderDetail(ctx, params.id);
  const loc = ctx.location();
  const goals = Object.values(SCULPT_GOALS);
  const myGoals = new Set(ctx.store.getProfile().sculptGoals || []);
  goals.sort((a, b) => (myGoals.has(b.id) - myGoals.has(a.id)) || a.name.localeCompare(b.name));
  return `<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
      <input type="search" id="libq" placeholder="Search ${EXERCISES.length} exercises" value="${esc(F.q)}" autocomplete="off"></div>
    <div class="hscroll mt">${[[null, 'All']].concat(GROUP_ORDER.filter(g => GROUPS[g]).map(g => [g, `${GROUPS[g].emoji || ''} ${GROUPS[g].name}`])).map(([g, l]) => `<button class="chip ${F.group === g ? 'active' : ''}" data-g="${g ?? ''}">${esc(l)}</button>`).join('')}</div>
    <div class="row mt" style="gap:8px">
      <button class="chip ${F.here ? 'active' : ''}" data-here>${esc(loc.icon || '📍')} Only what I have here</button>
      <button class="chip ${F.fav ? 'active' : ''}" data-fav>★ Favourites</button>
    </div>
    <select id="libgoal" class="mt" aria-label="Filter by sculpt goal"><option value="">Any sculpt goal</option>${goals.map(g => `<option value="${esc(g.id)}" ${F.goal === g.id ? 'selected' : ''}>${myGoals.has(g.id) ? '★ ' : ''}${esc(g.name)}</option>`).join('')}</select>
    <div id="libres" class="mt">${resultsHtml(ctx)}</div>`;
}

function renderDetail(ctx, id) {
  const ex = getEx(id);
  if (!ex) return `<div class="card"><div class="empty"><div class="big">🤷</div><h3>Exercise not found</h3><p>${esc(id)}</p><button class="btn" data-nav="library">Open library</button></div></div>`;
  const p = ctx.store.getProfile();
  const fav = (p.favoriteExercises || []).includes(id), avoid = (p.avoidExercises || []).includes(id);
  const sessions = safe(() => ctx.store.getSessions().filter(s => s.status === 'done'), []);
  const hist = safe(() => prog.exerciseHistory(id, sessions), []);
  const pr = safe(() => prog.personalRecords(sessions)[id], null);
  const eq = expandEquipment(ctx.location()?.equipment || []);
  const alts = safe(() => gen.alternatives(id, { equipment: [...eq], exclude: p.avoidExercises || [], limit: 6 }), []);
  const altsAny = alts.length < 3 ? safe(() => gen.alternatives(id, { equipment: Object.keys(EQUIPMENT), limit: 6 }), []).filter(a => !alts.some(b => b.id === a.id)).slice(0, 6 - alts.length) : [];
  const muscles = Object.entries(ex.muscles || {}).sort((a, b) => b[1] - a[1]);
  const emph = (ex.emphasis || []).map(t => Object.values(SCULPT_GOALS).find(g => goalTag(g) === t || g.id === t)).filter(Boolean);
  const yt = ex.yt || `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.name + ' form')}`;
  const can = canDo(ex, eq);
  const unitTxt = { each: 'weight per hand', total: 'total load', bodyweight: 'bodyweight', seconds: 'timed hold' }[ex.unit] || '';
  const last = hist.slice(-6).reverse();
  return `<div class="page-head"><h1>${esc(ex.name)}</h1>
      <div class="row wrap mt" style="gap:6px"><span class="badge">${esc(ex.category || '')}</span>${ex.repRange ? `<span class="badge">${ex.repRange[0]}–${ex.repRange[1]} ${ex.unit === 'seconds' ? 'sec' : 'reps'}</span>` : ''}${unitTxt ? `<span class="badge">${unitTxt}</span>` : ''}${ex.unilateral ? '<span class="badge">per side</span>' : ''}<span class="badge ${can ? 'good' : 'warn'}">${can ? '✓ Doable here' : 'Not at ' + esc(ctx.location().name)}</span></div></div>
    ${ex.why ? `<div class="card hero"><p style="font-size:17px;font-weight:600;line-height:1.45">${esc(ex.why)}</p>${emph.length ? `<div class="chips mt">${emph.map(g => `<span class="badge accent">✦ ${esc(g.name)}</span>`).join('')}</div>` : ''}</div>` : ''}
    <div class="btn-row"><button class="btn ${fav ? 'btn-primary' : ''}" data-tfav>${fav ? '★ Favourite' : '☆ Favourite'}</button><button class="btn ${avoid ? 'btn-danger' : ''}" data-tavoid>${avoid ? '⛔ Avoided' : 'Avoid'}</button></div>
    <a class="btn btn-ghost btn-block mt" href="${esc(yt)}" target="_blank" rel="noopener">▶ Watch form videos on YouTube</a>
    ${(ex.cues || []).length ? `<div class="section-title">Form cues</div><div class="card"><ol class="cue-list">${ex.cues.map(c => `<li>${esc(c)}</li>`).join('')}</ol></div>` : ''}
    <div class="section-title">Muscles worked</div><div class="card">${muscles.map(([r, w]) => `<div class="wbar"><span class="ellipsis">${esc(REGIONS[r]?.name || r)}</span><div class="bar"><i style="width:${Math.min(1, w) * 100}%;background:${w >= 0.75 ? 'var(--accent)' : w >= 0.5 ? 'var(--accent2)' : 'var(--muted)'}"></i></div><span class="muted num" style="text-align:right">${w}</span></div>`).join('')}
      <p class="tiny muted mt">Set credit per working set (1 = prime mover).</p></div>
    <div class="section-title">Equipment</div><div class="chips">${(eqNames(ex).length ? eqNames(ex) : ['Bodyweight only']).map(n => `<span class="badge" style="padding:6px 12px;font-size:13px">${esc(n)}</span>`).join('')}</div>
    <div class="section-title">Your history</div>
    ${hist.length ? `<div class="card">${pr ? `<div class="row between"><div><div class="label">Personal best</div><div style="font-size:22px;font-weight:850" class="num">${pr.w ? f1(pr.w) + ' × ' : ''}${pr.r}${ex.unit === 'seconds' ? 's' : ''}</div><div class="small muted">${fmtShort(pr.date)}${pr.e1rm ? ` · e1RM ${Math.round(pr.e1rm)}` : ''}</div></div><div class="center"><div style="font-size:22px;font-weight:850">${hist.length}</div><div class="tiny muted bold">SESSIONS</div></div></div><div class="divider"></div>` : ''}
      ${last.map(h => `<div class="row between small" style="padding:5px 0"><span class="muted">${fmtShort(h.date)}</span><span class="num">${esc(h.sets?.length ? h.sets.map(s => (s.w ? f1(s.w) + '×' : '') + s.r).join(', ') : (h.topSet?.w ? f1(h.topSet.w) + '×' : '') + (h.topSet?.r ?? ''))}</span></div>`).join('')}</div>`
      : `<div class="card"><p class="muted small">You haven't logged this yet. Start light: pick a weight that leaves 2–3 reps in reserve.</p></div>`}
    ${alts.length || altsAny.length ? `<div class="section-title">Alternatives</div><div class="list">${alts.concat(altsAny).map(a => `<button class="list-item" data-ex="${esc(a.id)}"><div class="grow"><div class="t ellipsis">${esc(a.name)}</div><div class="s ellipsis">${esc(eqNames(a).join(' · ') || 'Bodyweight')}${canDo(a, eq) ? '' : ' · <span style="color:var(--warn)">not here</span>'}</div></div><span class="chev">›</span></button>`).join('')}</div>` : ''}`;
}

function toggleList(ctx, key, id, other) {
  const p = ctx.store.getProfile();
  const cur = new Set(p[key] || []);
  const on = !cur.has(id);
  if (on) cur.add(id); else cur.delete(id);
  const patch = { [key]: [...cur] };
  if (on && other) patch[other] = (p[other] || []).filter(x => x !== id);   // can't be both favourite and avoided
  ctx.store.updateProfile(patch);
  return on;
}

export function bind(root, ctx, params = {}) {
  root.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => ctx.nav('exercise', { id: b.dataset.ex }));
  root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => ctx.nav(b.dataset.nav));
  if (params.id) {
    root.querySelector('[data-tfav]')?.addEventListener('click', () => ctx.toast(toggleList(ctx, 'favoriteExercises', params.id, 'avoidExercises') ? 'Added to favourites' : 'Removed from favourites'));
    root.querySelector('[data-tavoid]')?.addEventListener('click', () => ctx.toast(toggleList(ctx, 'avoidExercises', params.id, 'favoriteExercises') ? "Won't be programmed" : 'Can be programmed again'));
    return;
  }
  const res = root.querySelector('#libres');
  const refresh = () => { res.innerHTML = resultsHtml(ctx); res.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => ctx.nav('exercise', { id: b.dataset.ex })); };
  const q = root.querySelector('#libq');
  q.addEventListener('input', () => { F.q = q.value; refresh(); });
  root.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { F.group = b.dataset.g || null; ctx.rerender(); });
  root.querySelector('[data-here]').onclick = () => { F.here = !F.here; ctx.rerender(); };
  root.querySelector('[data-fav]').onclick = () => { F.fav = !F.fav; ctx.rerender(); };
  root.querySelector('#libgoal').onchange = e => { F.goal = e.target.value || null; e.target.blur(); ctx.rerender(); };
}
