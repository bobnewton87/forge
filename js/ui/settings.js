// "More" hub (route 'more') and Settings (route 'settings') (UI-SHELL).
// CONTRACT-NOTE: params.section on 'settings' (e.g. 'locations') scrolls to that section.
import { SCULPT_GOALS } from '../data/sculpt.js';
import { GROUPS, GROUP_ORDER } from '../data/muscles.js';
import { EQUIPMENT } from '../data/equipment.js';
import { esc } from './components.js';
import { ds } from '../util.js';

const CAT_ORDER = [['free', 'Free weights & benches'], ['cable', 'Cables'], ['machine', 'Machines'], ['bodyweight', 'Bodyweight stations'], ['cardio', 'Cardio'], ['other', 'Other']];
const GOALS = [['recomp', 'Recomp', 'Lose fat, build muscle'], ['lean_bulk', 'Lean bulk', 'Small surplus, max growth'], ['cut', 'Cut', 'Get lean, keep muscle']];
const STYLES = [['hypertrophy', 'Hypertrophy'], ['pump', 'Pump'], ['strength', 'Strength'], ['circuit', 'Circuit']];
const NUTRI = [['off', 'Off'], ['simple', 'Simple'], ['cycling', 'Carb cycling']];

export function title(ctx, params) { return ctx.route === 'more' ? '' : 'Settings'; }

// ---------------- More hub ----------------
function renderMore(ctx) {
  const p = ctx.store.getProfile();
  const n = (() => { try { return ctx.store.getSessions().length; } catch (e) { return 0; } })();
  const item = (nav, ic, t, s) => `<button class="list-item" data-nav="${nav}"><span class="ic">${ic}</span><div class="grow"><div class="t">${t}</div><div class="s">${s}</div></div><span class="chev">›</span></button>`;
  return `<div class="page-head"><h1>More</h1><p class="sub">${esc(p.name || 'Bob')} · ${n} workouts logged</p></div>
    <div class="list">
      ${item('library', '📚', 'Exercise library', 'Cues, videos, alternatives, your PRs')}
      ${item('measure', '📏', 'Body profile', p.body?.heightIn ? 'Height, age, measurements, body fat' : 'Add height, age and measurements')}
      ${item('nutrition', '🥗', 'Nutrition', p.nutrition?.mode && p.nutrition.mode !== 'off' ? (p.nutrition.mode === 'cycling' ? 'Carb cycling on' : 'Simple targets on') : 'Optional · off')}
      ${item('supplements', '🧪', 'Supplements & metabolism', (() => { const n = (p.supplements || []).filter(e => e && e.active !== false && !e.end).length; return n ? `${n} in your stack · labs, sleep, stress` : 'Creatine, TRT, peptides · labs, sleep'; })())}
      ${item('settings', '⚙️', 'Settings', 'Goals, sculpt focus, locations, timer')}
    </div>
    <div class="list">
      ${item('import', '🏃', 'Import from Iron Runner', 'Bring over old workouts and weigh-ins')}
    </div>
    <div class="section-title">Backup</div>
    <div class="card">
      <p class="small muted">Everything lives on this phone. Export a backup now and then, especially before switching devices.</p>
      <div class="btn-row mt"><button class="btn" data-export>⬇ Download</button><button class="btn" data-copy>Copy</button></div>
      <label class="btn btn-ghost btn-block mt">⬆ Restore from file (merge)<input type="file" accept=".json,application/json" id="bkfile" hidden></label>
    </div>
    <p class="tiny muted center mt2">Forge · made for Bob</p>`;
}

function bindMore(root, ctx) {
  root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => ctx.nav(b.dataset.nav));
  const json = () => JSON.stringify(ctx.store.exportAll(), null, 1);
  root.querySelector('[data-export]').onclick = () => {
    const blob = new Blob([json()], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `forge-backup-${ds()}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    ctx.toast('Backup downloaded');
  };
  root.querySelector('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(json()); ctx.toast('Backup copied to clipboard'); }
    catch (e) {
      ctx.openSheet(`<h2>Copy backup</h2><p class="muted small">Select all and copy.</p><textarea class="mt" style="min-height:240px" readonly>${esc(json())}</textarea>`, el => { const t = el.querySelector('textarea'); t.focus(); t.select(); });
    }
  };
  root.querySelector('#bkfile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const n = obj?.data ? Object.keys(obj.data).length : 0;
      ctx.openSheet(`<h2>Restore backup?</h2><p class="muted">${esc(f.name)} · ${n} items${obj.exportedAt ? ' · exported ' + esc(obj.exportedAt.slice(0, 10)) : ''}</p>
        <p class="small mt">Sessions are merged by id. Profile and body log are replaced with the backup's versions.</p>
        <div class="sheet-actions"><button class="btn btn-primary btn-block" data-ok>Restore</button><button class="btn btn-ghost btn-block" data-no>Cancel</button></div>`, (el, close) => {
        el.querySelector('[data-no]').onclick = close;
        el.querySelector('[data-ok]').onclick = () => {
          try { ctx.store.importAll(obj, { merge: true }); close(); ctx.toast('Backup restored'); } catch (err) { ctx.toast(err.message || 'Import failed'); }
        };
      });
    } catch (err) { ctx.toast('Not a valid backup file'); }
    e.target.value = '';
  };
}

// ---------------- Settings ----------------
const seg = (name, opts, cur) => `<div class="tabs" data-seg="${name}">${opts.map(([v, l]) => `<button class="${String(cur) === String(v) ? 'active' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
const sw = (name, on) => `<label class="switch"><input type="checkbox" data-sw="${name}" ${on ? 'checked' : ''}><span></span></label>`;

function renderSettings(ctx) {
  const p = ctx.store.getProfile();
  const goals = new Set(p.sculptGoals || []);
  const allGoals = Object.values(SCULPT_GOALS);
  const byGroup = {};
  for (const g of allGoals) (byGroup[g.group] || (byGroup[g.group] = [])).push(g);
  const groupsWithGoals = GROUP_ORDER.filter(g => byGroup[g]).concat(Object.keys(byGroup).filter(g => !GROUP_ORDER.includes(g)));
  const gp = p.groupPriority || {};
  const rt = p.restTimer || {};
  return `<div class="section-title" id="sec-goal">Goal</div>
  <div class="card">${seg('goal', GOALS.map(([v, l]) => [v, l]), p.goal)}
    <p class="small muted mt">${esc(GOALS.find(g => g[0] === p.goal)?.[2] || '')}</p></div>

  <div class="section-title" id="sec-sculpt">Sculpt focus <span class="tiny muted" style="text-transform:none;letter-spacing:0">${goals.size} on</span></div>
  <div class="card"><p class="small muted mb">Tap to toggle. ⓘ explains what's trainable and what's genetic.</p>
    ${groupsWithGoals.map(gid => `<div class="label" style="margin:12px 0 6px">${esc(GROUPS[gid]?.name || gid)}</div><div class="chips">${byGroup[gid].map(g => `<span class="row" style="gap:0"><button class="chip ${goals.has(g.id) ? 'active' : ''}" data-goal="${esc(g.id)}" style="border-radius:999px 0 0 999px;border-right:0">${goals.has(g.id) ? '✓ ' : ''}${esc(g.name)}</button><button class="chip" data-ginfo="${esc(g.id)}" aria-label="About ${esc(g.name)}" style="border-radius:0 999px 999px 0;padding:0 11px;color:var(--muted)">ⓘ</button></span>`).join('')}</div>`).join('')}
  </div>

  <div class="section-title" id="sec-priority">Muscle priority</div>
  <div class="card"><p class="small muted mb">Scales each group's weekly set target. 1.0 = standard, lower = maintenance.</p>
    ${GROUP_ORDER.filter(g => GROUPS[g]).map(g => { const v = gp[g] ?? 1; return `<div class="row" style="gap:12px;min-height:44px"><span style="width:96px;font-weight:650;font-size:15px">${esc(GROUPS[g].name)}</span>
      <input type="range" min="0.5" max="1.5" step="0.05" value="${v}" data-prio="${g}" style="--pct:${(v - 0.5) * 100}%" class="grow"><span class="num bold" style="width:44px;text-align:right" data-prio-v="${g}">×${Number(v).toFixed(2)}</span></div>`; }).join('')}
    <button class="btn btn-sm btn-ghost mt" data-prio-reset>Reset to Forge defaults</button></div>

  <div class="section-title" id="sec-locations">Locations</div>
  <div class="list">${(p.locations || []).map(l => `<button class="list-item" data-loc="${esc(l.id)}"><span class="ic">${esc(l.icon || '📍')}</span><div class="grow"><div class="t">${esc(l.name)}${l.id === p.currentLocation ? ' <span class="badge accent">current</span>' : ''}</div><div class="s">${(l.equipment || []).length} items${l.hasClasses ? ' · classes' : ''}</div></div><span class="chev">›</span></button>`).join('')}
    <button class="list-item" data-addloc><span class="ic">＋</span><div class="grow"><div class="t" style="color:var(--accent)">Add location</div></div></button></div>

  <div class="section-title" id="sec-training">Training defaults</div>
  <div class="card">
    <div class="label mb">Default session length</div>
    <div class="chips">${[15, 20, 30, 45, 60, 75, 90].map(m => `<button class="chip ${p.defaultMinutes === m ? 'active' : ''}" data-min="${m}">${m}</button>`).join('')}</div>
    <div class="label mb mt2">Default style</div>${seg('defaultStyle', STYLES, p.defaultStyle)}
    <div class="label mt2">Weekly cardio target</div>
    <div class="row mt"><input type="range" min="0" max="300" step="15" value="${p.cardioTargetMin ?? 120}" data-cardio style="--pct:${((p.cardioTargetMin ?? 120) / 300) * 100}%" class="grow"><span class="num bold" style="width:72px;text-align:right" data-cardio-v>${p.cardioTargetMin ?? 120} min</span></div>
  </div>

  <div class="section-title" id="sec-timer">Rest timer</div>
  <div class="card" style="padding-top:4px;padding-bottom:4px">
    <div class="set-row"><div class="grow"><div class="t">Auto-start rest timer</div><div class="s">Banner countdown after each set</div></div>${sw('rtEnabled', rt.enabled !== false)}</div>
    <div class="set-row"><div class="grow"><div class="t">Sound</div><div class="s">Beep when rest is over (vibrates too)</div></div>${sw('rtSound', rt.sound !== false)}</div>
    <div class="set-row"><div class="grow"><div class="t">Test it</div><div class="s">10-second rest</div></div><button class="btn btn-sm" data-rttest>Start</button></div>
  </div>

  <div class="section-title" id="sec-crunch">Crunch</div>
  <div class="card" style="padding-top:4px;padding-bottom:4px"><div class="set-row"><span class="ic" style="font-size:22px">🏋️</span><div class="grow"><div class="t">Crunch Allen</div><div class="s">510 N Watters Rd, Allen TX · class schedule source</div></div><select data-crunch style="width:auto;min-height:40px"><option value="allen" ${(p.crunch?.club || 'allen') === 'allen' ? 'selected' : ''}>Allen</option></select></div></div>

  <div class="section-title" id="sec-nutrition">Nutrition</div>
  <div class="card">${seg('nutrition', NUTRI, p.nutrition?.mode || 'off')}
    <p class="small muted mt">${p.nutrition?.mode === 'cycling' ? 'Higher carbs on lift days, lower on rest days.' : p.nutrition?.mode === 'simple' ? 'Same calorie and protein targets every day.' : 'Off. Turn on for daily calorie and macro targets.'}</p>
    <div class="row mt"><div class="grow field" style="margin:0"><label>Bodyweight (lb)</label><input type="number" inputmode="decimal" step="0.1" data-bw value="${p.bodyweight ?? ''}" placeholder="e.g. 165"></div></div></div>

  <div class="section-title">Profile</div>
  <div class="card"><div class="field" style="margin:0"><label>Name</label><input type="text" data-name value="${esc(p.name || '')}"></div></div>
  <div class="list"><button class="list-item" data-nav="measure"><span class="ic">📏</span><div class="grow"><div class="t">Body profile</div><div class="s">Height, birth year, activity, measurements</div></div><span class="chev">›</span></button></div>`;
}

function goalInfoSheet(ctx, id) {
  const g = SCULPT_GOALS[id]; if (!g) return;
  const on = (ctx.store.getProfile().sculptGoals || []).includes(id);
  ctx.openSheet(`<div class="label">${esc(GROUPS[g.group]?.name || g.group || '')}</div><h2>${esc(g.name)}</h2>
    ${g.summary ? `<p class="mt" style="font-size:16px;font-weight:600">${esc(g.summary)}</p>` : ''}
    ${g.science ? `<div class="section-title">The science</div><p class="small" style="line-height:1.55;color:#cfcfd8">${esc(g.science)}</p>` : ''}
    ${(g.tips || []).length ? `<div class="section-title">How to train it</div><ul class="tip-list">${g.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${g.extraWeeklySets ? `<p class="small muted mt">When on, adds ~${g.extraWeeklySets} weekly sets to the target regions.</p>` : ''}
    <div class="sheet-actions"><button class="btn ${on ? 'btn-ghost' : 'btn-primary'} btn-block" data-tg>${on ? 'Turn off' : 'Turn on'} ${esc(g.name)}</button></div>`, (el, close) => {
    el.querySelector('[data-tg]').onclick = () => { toggleGoal(ctx, id); close(); };
  });
}
function toggleGoal(ctx, id) {
  const p = ctx.store.getProfile(); const s = new Set(p.sculptGoals || []);
  if (s.has(id)) s.delete(id); else s.add(id);
  ctx.store.updateProfile({ sculptGoals: [...s] });
}

function locationSheet(ctx, id) {
  const p = ctx.store.getProfile();
  const isNew = !id;
  const loc = isNew ? { id: 'loc_' + Date.now().toString(36), name: '', icon: '📍', equipment: ['bodyweight'] } : (p.locations || []).find(l => l.id === id);
  if (!loc) return;
  const have = new Set(loc.equipment || []);
  const cats = CAT_ORDER.map(([c, label]) => [label, Object.values(EQUIPMENT).filter(e => (e.category || 'other') === c)]).filter(([, l]) => l.length);
  const known = new Set(CAT_ORDER.map(c => c[0]));
  const extra = Object.values(EQUIPMENT).filter(e => !known.has(e.category));
  if (extra.length) cats.push(['More', extra]);
  ctx.openSheet(`<h2>${isNew ? 'New location' : 'Edit location'}</h2>
    <div class="row mt" style="gap:10px;align-items:flex-end"><div class="field" style="width:74px;margin:0"><label>Icon</label><input type="text" data-icon value="${esc(loc.icon || '')}" maxlength="4" style="text-align:center;font-size:22px"></div>
      <div class="field grow" style="margin:0"><label>Name</label><input type="text" data-lname value="${esc(loc.name)}" placeholder="e.g. Office gym"></div></div>
    <div class="row between mt2"><div class="label">Equipment</div><span class="small muted" data-count>${have.size} selected</span></div>
    ${cats.map(([label, list]) => `<div class="label" style="margin:14px 0 8px;color:var(--text)">${esc(label)}</div><div class="grid2">${list.map(e => `<label class="check"><input type="checkbox" value="${esc(e.id)}" ${have.has(e.id) || e.id === 'bodyweight' ? 'checked' : ''} ${e.id === 'bodyweight' ? 'disabled' : ''}><span>${esc(e.name)}</span></label>`).join('')}</div>`).join('')}
    <div class="sheet-actions"><button class="btn btn-primary btn-block" data-save>Save</button>
      ${!isNew ? `<div class="btn-row"><button class="btn" data-use>Train here</button>${(p.locations || []).length > 1 ? '<button class="btn btn-danger" data-del>Delete</button>' : ''}</div>` : ''}</div>`, (el, close) => {
    const cnt = el.querySelector('[data-count]');
    el.addEventListener('change', () => { cnt.textContent = el.querySelectorAll('input[type=checkbox]:checked').length + ' selected'; });
    const collect = () => ({ ...loc, name: el.querySelector('[data-lname]').value.trim() || 'Location', icon: el.querySelector('[data-icon]').value.trim() || '📍', equipment: [...el.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value) });
    const save = (extra = {}) => {
      const cur = ctx.store.getProfile(); const l = collect();
      const locs = isNew ? [...(cur.locations || []), l] : (cur.locations || []).map(x => x.id === l.id ? l : x);
      ctx.store.updateProfile({ locations: locs, ...extra }); return l;
    };
    el.querySelector('[data-save]').onclick = () => { const l = save(); close(); ctx.toast(`${l.name} saved`); };
    el.querySelector('[data-use]')?.addEventListener('click', () => { const l = save({ currentLocation: loc.id }); close(); ctx.toast(`Training at ${l.name}`); });
    const del = el.querySelector('[data-del]');
    if (del) del.onclick = () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap again'; return; }
      const cur = ctx.store.getProfile(); const locs = cur.locations.filter(x => x.id !== loc.id);
      ctx.store.updateProfile({ locations: locs, currentLocation: cur.currentLocation === loc.id ? locs[0].id : cur.currentLocation });
      close(); ctx.toast('Location deleted');
    };
  });
}

function bindSettings(root, ctx, params) {
  root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => ctx.nav(b.dataset.nav));
  const up = patch => ctx.store.updateProfile(patch);
  root.querySelectorAll('[data-seg]').forEach(s => s.addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    const v = b.dataset.v, k = s.dataset.seg;
    if (k === 'nutrition') { const p = ctx.store.getProfile(); up({ nutrition: { ...(p.nutrition || {}), mode: v } }); }
    else up({ [k]: v });
  }));
  root.querySelectorAll('[data-goal]').forEach(b => b.onclick = () => toggleGoal(ctx, b.dataset.goal));
  root.querySelectorAll('[data-ginfo]').forEach(b => b.onclick = () => goalInfoSheet(ctx, b.dataset.ginfo));
  root.querySelectorAll('[data-prio]').forEach(r => {
    const g = r.dataset.prio; const lab = root.querySelector(`[data-prio-v="${g}"]`);
    r.addEventListener('input', () => { lab.textContent = '×' + Number(r.value).toFixed(2); r.style.setProperty('--pct', (r.value - 0.5) * 100 + '%'); });
    r.addEventListener('change', () => { const p = ctx.store.getProfile(); up({ groupPriority: { ...(p.groupPriority || {}), [g]: Number(r.value) } }); });
  });
  root.querySelector('[data-prio-reset]').onclick = async () => {
    const { defaultProfile } = await import('../store.js');
    up({ groupPriority: { ...defaultProfile().groupPriority } }); ctx.toast('Priorities reset');
  };
  root.querySelectorAll('[data-loc]').forEach(b => b.onclick = () => locationSheet(ctx, b.dataset.loc));
  root.querySelector('[data-addloc]').onclick = () => locationSheet(ctx, null);
  root.querySelectorAll('[data-min]').forEach(b => b.onclick = () => up({ defaultMinutes: Number(b.dataset.min) }));
  const cr = root.querySelector('[data-cardio]'), crv = root.querySelector('[data-cardio-v]');
  cr.addEventListener('input', () => { crv.textContent = cr.value + ' min'; cr.style.setProperty('--pct', (cr.value / 300) * 100 + '%'); });
  cr.addEventListener('change', () => up({ cardioTargetMin: Number(cr.value) }));
  root.querySelectorAll('[data-sw]').forEach(i => i.addEventListener('change', () => {
    const p = ctx.store.getProfile(); const rt = { ...(p.restTimer || {}) };
    if (i.dataset.sw === 'rtEnabled') rt.enabled = i.checked; else rt.sound = i.checked;
    up({ restTimer: rt });
  }));
  root.querySelector('[data-rttest]').onclick = () => { if (ctx.store.getProfile().restTimer?.enabled === false) ctx.toast('Rest timer is off'); else ctx.timer.start(10); };
  root.querySelector('[data-crunch]').onchange = e => up({ crunch: { ...(ctx.store.getProfile().crunch || {}), club: e.target.value } });
  const bw = root.querySelector('[data-bw]');
  bw.addEventListener('change', () => { const v = parseFloat(bw.value); if (v > 50 && v < 600) { ctx.store.logBodyweight(ds(), v); ctx.toast(`Logged ${v} lb for today`); } });
  const nm = root.querySelector('[data-name]');
  nm.addEventListener('change', () => up({ name: nm.value.trim() || 'Bob' }));
  if (params?.section) {
    const el = root.querySelector('#sec-' + params.section);
    if (el && window.scrollY < 10) setTimeout(() => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }), 60);
  }
}

export function render(ctx, params) { return ctx.route === 'settings' ? renderSettings(ctx, params) : renderMore(ctx, params); }
export function bind(root, ctx, params) { return ctx.route === 'settings' ? bindSettings(root, ctx, params) : bindMore(root, ctx, params); }
