// "More" hub (route 'more') and Settings (route 'settings') (UI-SHELL).
// CONTRACT-NOTE: params.section on 'settings' (e.g. 'locations') scrolls to that section.
import { SCULPT_GOALS, goalFor } from '../data/sculpt.js';
import { sexFieldsHTML, readFemaleFields, showFemaleFields, bindSexInfo, maybeOfferFemaleGoals } from './female.js';
// CONTRACT-NOTE (§20 Female mode): Settings → Profile has the sex selector (+ female fields and "what changes" info);
//   it writes profile.body via store.updateProfile and offers the female starting sculpt goals (never silently).
//   Sculpt-goal info sheets read goalFor(goal, sex) so women don't see male/Bob-specific wording.
import { GROUPS, GROUP_ORDER, VOLUME_UNITS, UNIT_ORDER } from '../data/muscles.js';
import { EQUIPMENT } from '../data/equipment.js';
import { esc } from './components.js';
import { ds } from '../util.js';
import { setTargets, openTargetsSheet, ensureTargetStyles } from './targets.js';
import { styleChipsHTML, customStylesListHTML, openStyleEditor, openStyleInfo, deleteStyle } from './styles.js';
import { buildWorkout } from '../engine/generator.js';
import { resolveTargets, unitTargets, maxNote, starredGroups, PRIORITY_LEGEND, LIMITS, CARDIO_STYLES, CARDIO_STYLE_NAMES, CARDIO_STYLE_WHY, GOAL_INFO, GOAL_ORDER, priorityLimits, SESSION_CAP_INFO, SESSION_CAP_DEFAULT } from '../engine/targets.js';
// CONTRACT-NOTE (§26): Training defaults → "Most working sets in one workout" (12-50, default 30) reads
//   resolveTargets().training.sessionSetCap and writes setTargets({ training: { sessionSetCap } }) (re-plans);
//   its note says plainly that the ceiling is a convention, with the two sources behind it.
import { accountsSectionHTML, bindAccountsSection } from './accounts.js';
// CONTRACT-NOTE (INTEGRATOR §18): goal, sculpt focus, muscle priority, default length/style, the
//   weekly cardio target and adherence all read resolveTargets and write through setTargets (planning
//   changes re-plan upcoming auto days). The cardio slider spans 0–600 (the API allows up to 900).
//   Volume policy (lengthen / ask / keep times + longest workout) is edited here too.
// CONTRACT-NOTE (STYLES): default style chips list built-ins + custom styles; "My training styles" (#sec-styles)
//   edits / deletes custom styles (ui/styles.js editor).
// CONTRACT-NOTE (§19): the Accounts section (#sec-accounts, last) comes from ui/accounts.js.

const CAT_ORDER = [['free', 'Free weights & benches'], ['cable', 'Cables'], ['machine', 'Machines'], ['bodyweight', 'Bodyweight stations'], ['cardio', 'Cardio'], ['other', 'Other']];
// §23: the goal list (including 'weight_loss') comes from the engine so every screen shows the same names.
const GOALS = GOAL_ORDER.map(id => [id, GOAL_INFO[id].name, GOAL_INFO[id].blurb]);
const NUTRI = [['off', 'Off'], ['simple', 'Simple'], ['cycling', 'Carb cycling']];

export function title(ctx, params) { return ctx.route === 'more' ? '' : 'Settings'; }

// ---------------- More hub ----------------

// §23: the slider floor drops from 0.5x to 0x under the weight-loss goal (priorityLimits).
const PR = LIMITS.priority;
const prioPct = (v, lim = PR) => ((Number(v) - lim[0]) / (lim[1] - lim[0])) * 100;
// "→ 15 sets/wk (max 20)" for a group's counted muscles at the profile's slider.
function prioLine(p, g) {
  const U = unitTargets(p);
  const us = UNIT_ORDER.filter(id => VOLUME_UNITS[id].group === g && VOLUME_UNITS[id].tier !== 'tracked' && !VOLUME_UNITS[id].sub && U[id]);
  const f = x => Math.round(x * 10) / 10;
  const tag = id => { const n = maxNote(id, U[id]); return n && n.tag ? ` · ${n.tag}` : ''; };
  if (us.length === 1) { const x = U[us[0]]; return `→ ${f(x.target)} sets/wk (max ${x.max})${tag(us[0])} ⓘ`; }
  return '→ ' + us.map(id => `${VOLUME_UNITS[id].name.replace(/ \(.*\)$/, '').toLowerCase()} ${f(U[id].target)}/${U[id].max}${tag(id)}`).join(' · ') + ' (target/max) ⓘ';
}
// Tap-to-open note under each slider: why the max doesn't rise with the slider (maxNote).
function prioNote(p, g) {
  const U = unitTargets(p);
  const ns = UNIT_ORDER.filter(id => VOLUME_UNITS[id].group === g && !VOLUME_UNITS[id].sub).map(id => [id, maxNote(id, U[id])]).filter(([, n]) => n);
  return { capped: ns.some(([, n]) => n.capped), text: ns.map(([id, n]) => (ns.length > 1 ? `${VOLUME_UNITS[id].name.replace(/ \(.*\)$/, '')}: ` : '') + n.text).join(' ') };
}

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
  const T = resolveTargets(p);
  const PL = priorityLimits(p);   // §23: [0, 2] under the weight-loss goal, [0.5, 2] otherwise
  const starG = starredGroups(p);
  ensureTargetStyles();   // the shared priority tag (.wk-prio)
  const cmax = Math.max(600, T.cardio.minPerWeek);
  // §23: the weight-loss goal gets its own line here plus a shortcut into the shared targets sheet, which
  // owns goal weight, rate and lean protection (one editor, CONTRACT §18).
  const lp = T.goals.plan;
  return `<div class="section-title" id="sec-goal">Goal</div>
  <div class="card">${seg('goal', GOALS.map(([v, l]) => [v, l]), T.goals.goal)}
    <p class="small muted mt">${esc(GOALS.find(g => g[0] === T.goals.goal)?.[2] || '')}</p>
    ${T.goals.losing ? `<p class="small mt" id="st-wl">${T.goals.goalWeightLb ? `Goal weight <b class="num">${T.goals.goalWeightLb} lb</b>` : 'No goal weight set'} · <b class="num">${T.goals.lossRatePctPerWeek}%</b> of bodyweight a week${lp?.lbPerWeek ? ` (${lp.lbPerWeek} lb/wk, about ${lp.deficitKcal} kcal/day under maintenance)` : ''} · muscle: ${esc(T.goals.leanProtection === 'minimal' ? 'not protected' : T.goals.leanProtection === 'balanced' ? 'maintenance' : 'protected')}</p>
      ${(lp?.warnings || []).map(w => `<p class="tiny" style="color:var(--warn)">${esc(w)}</p>`).join('')}
      <button class="btn btn-sm btn-ghost btn-block mt" data-wl-edit>Goal weight, rate &amp; muscle protection ›</button>` : ''}</div>

  <div class="section-title" id="sec-sculpt">Sculpt focus <span class="tiny muted" style="text-transform:none;letter-spacing:0">${goals.size} on</span></div>
  <div class="card"><p class="small muted mb">Tap to toggle. ⓘ explains what's trainable and what's genetic.</p>
    ${groupsWithGoals.map(gid => `<div class="label" style="margin:12px 0 6px">${esc(GROUPS[gid]?.name || gid)}</div><div class="chips">${byGroup[gid].map(g => `<span class="row" style="gap:0"><button class="chip ${goals.has(g.id) ? 'active' : ''}" data-goal="${esc(g.id)}" style="border-radius:999px 0 0 999px;border-right:0">${goals.has(g.id) ? '✓ ' : ''}${esc(g.name)}</button><button class="chip" data-ginfo="${esc(g.id)}" aria-label="About ${esc(g.name)}" style="border-radius:0 999px 999px 0;padding:0 11px;color:var(--muted)">ⓘ</button></span>`).join('')}</div>`).join('')}
  </div>

  <div class="section-title" id="sec-priority">Muscle priority</div>
  <div class="card"><p class="small muted mb">Scales each group's weekly set target. 1.0 = standard, lower = maintenance. Sliders move the target, not the max: tap a line to see why each max is where it is. ${esc(PRIORITY_LEGEND)}.${PL[0] === 0 ? ' <b style="color:var(--warn)">Your goal is losing weight, so sliders go all the way to 0× (no planned sets for that muscle). Below 0.5× you are training under the volume that keeps muscle.</b>' : ''}</p>
    ${GROUP_ORDER.filter(g => GROUPS[g]).map(g => { const v = gp[g] ?? 1; return `<div style="min-height:44px"><div class="row" style="gap:12px"><span style="width:96px;font-weight:650;font-size:15px">${esc(GROUPS[g].name)}${starG.has(g) ? '<br><span class="wk-prio">priority</span>' : ''}</span>
      <input type="range" min="${PL[0]}" max="${PL[1]}" step="0.05" value="${v}" data-prio="${g}" style="--pct:${prioPct(v, PL)}%" class="grow" aria-label="${esc(GROUPS[g].name)} priority"><span class="num bold" style="width:44px;text-align:right" data-prio-v="${g}">×${Number(v).toFixed(2)}</span></div>
      ${(() => { const n = prioNote(p, g); return `<details class="st-maxd" data-prio-d="${g}"${n.capped ? ' open' : ''}><summary class="tiny muted" data-prio-t="${g}">${esc(prioLine(p, g))}</summary><div class="tiny muted" data-prio-n="${g}">${esc(n.text)}</div></details>`; })()}</div>`; }).join('')}
    <button class="btn btn-sm btn-ghost mt" data-prio-reset>Reset to Forge defaults</button></div>

  <div class="section-title" id="sec-locations">Locations</div>
  <div class="list">${(p.locations || []).map(l => `<button class="list-item" data-loc="${esc(l.id)}"><span class="ic">${esc(l.icon || '📍')}</span><div class="grow"><div class="t">${esc(l.name)}${l.id === p.currentLocation ? ' <span class="badge accent">current</span>' : ''}</div><div class="s">${(l.equipment || []).length} items${l.hasClasses ? ' · classes' : ''}</div></div><span class="chev">›</span></button>`).join('')}
    <button class="list-item" data-addloc><span class="ic">＋</span><div class="grow"><div class="t" style="color:var(--accent)">Add location</div></div></button></div>

  <div class="section-title" id="sec-training">Training defaults</div>
  <div class="card">
    <div class="label mb">Default session length</div>
    <div class="chips">${[15, 20, 30, 45, 60, 75, 90].map(m => `<button class="chip ${T.training.defaultMinutes === m ? 'active' : ''}" data-min="${m}">${m}</button>`).join('')}</div>
    <div class="label mt2">Most working sets in one workout <span class="tiny muted" style="text-transform:none;letter-spacing:0">${esc(SESSION_CAP_INFO.label)}</span></div>
    <div class="row mt"><input type="range" min="${LIMITS.sessionSetCap[0]}" max="${LIMITS.sessionSetCap[1]}" step="1" value="${T.training.sessionSetCap}" data-setcap style="--pct:${((T.training.sessionSetCap - LIMITS.sessionSetCap[0]) / (LIMITS.sessionSetCap[1] - LIMITS.sessionSetCap[0])) * 100}%" class="grow" aria-label="Most working sets in one workout"><span class="num bold" style="width:72px;text-align:right" data-setcap-v>${T.training.sessionSetCap} sets</span></div>
    <details class="st-maxd"><summary class="tiny muted">Whatever the time, a workout stops here and finishes early. ${esc(SESSION_CAP_INFO.short)} Why? ⓘ</summary>
      <p class="tiny muted">${esc(SESSION_CAP_INFO.text)}${T.training.sessionSetCap !== SESSION_CAP_DEFAULT ? ` Forge's default is ${SESSION_CAP_DEFAULT}.` : ''}</p>
      <ul class="tiny muted" style="margin:4px 0 0 16px">${SESSION_CAP_INFO.evidence.map(e => `<li>${esc(e.claim)} <i>${esc(e.source)}</i></li>`).join('')}</ul></details>
    <div class="label mb mt2">Default style</div>${styleChipsHTML(p, T.training.style, { attr: 'data-dstyle' })}
    <div class="label mb mt2" id="sec-styles">My training styles</div>${customStylesListHTML(p)}
    <div class="label mt2">Weekly cardio target</div>
    <div class="row mt"><input type="range" min="0" max="${cmax}" step="15" value="${T.cardio.minPerWeek}" data-cardio data-max="${cmax}" style="--pct:${(T.cardio.minPerWeek / cmax) * 100}%" class="grow" aria-label="Weekly cardio target"><span class="num bold" style="width:72px;text-align:right" data-cardio-v>${T.cardio.minPerWeek} min</span></div>
    ${T.warnings.length ? `<p class="tiny" style="color:var(--warn);margin-top:6px">${esc(T.warnings[0])}</p>` : `<p class="tiny muted" style="margin-top:6px">Your availability fits ~${T.capacity.cardio} cardio min/week. Same target as Body and Plan.</p>`}
    <div class="label mb mt2">Cardio as</div>${seg('cardioStyle', CARDIO_STYLES.map(v => [v, CARDIO_STYLE_NAMES[v]]), T.cardio.style)}
    <p class="tiny muted" style="margin-top:6px">${esc(CARDIO_STYLE_WHY)} No cardio block shorter than ${T.cardio.minSession}′.</p>
    <div class="label mt2">Adherence <span class="tiny muted" style="text-transform:none;letter-spacing:0">share of planned sessions you actually do (used by the projection)</span></div>
    <div class="row mt"><input type="range" min="${LIMITS.adherence[0]}" max="${LIMITS.adherence[1]}" step="0.05" value="${T.adherence}" data-adh style="--pct:${((T.adherence - LIMITS.adherence[0]) / (LIMITS.adherence[1] - LIMITS.adherence[0])) * 100}%" class="grow" aria-label="Adherence"><span class="num bold" style="width:72px;text-align:right" data-adh-v>${Math.round(T.adherence * 100)}%</span></div>
    <div class="label mt2">When the week's set minimums don't fit your slot times</div>
    ${seg('volumeMode', [['extend', 'Lengthen'], ['ask', 'Ask me'], ['fixed', 'Keep times']], T.training.volumePolicy.mode)}
    <div class="label mb mt">Reach targets</div>
    ${seg('volumeFill', [['extend', 'Lengthen workouts'], ['time', 'Spare time only'], ['ask', 'Ask me']], T.training.volumePolicy.fillTargets)}
    <div class="label mb mt">Longest workout</div>
    <div class="chips">${[60, 75, 90, 105, 120].map(m => `<button class="chip ${T.training.volumePolicy.maxMinutes === m ? 'active' : ''}" data-vmax="${m}">${m}′</button>`).join('')}</div>
    <p class="tiny muted" style="margin-top:6px">Plan my week always fits every muscle's weekly minimum (lengthening up to this cap if needed), then fills toward your targets.</p>
    <button class="btn btn-sm btn-ghost mt" data-tg-all>All targets in one place ›</button>
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

  <div class="section-title" id="sec-profile">Profile</div>
  <div class="card"><div class="field" style="margin:0"><label>Name</label><input type="text" data-name value="${esc(p.name || '')}"></div></div>
  <div class="card" id="st-sex">${sexFieldsHTML(p.body || {}, { prefix: 'ssx', segAttr: 'data-sexseg' })}
    <button class="btn btn-sm mt" data-savesex>Save</button></div>
  <div class="list"><button class="list-item" data-nav="measure"><span class="ic">📏</span><div class="grow"><div class="t">Body profile</div><div class="s">Height, birth year, activity, measurements</div></div><span class="chev">›</span></button></div>
  ${accountsSectionHTML()}`;
}

function goalInfoSheet(ctx, id) {
  const g = goalFor(id, ctx.store.getProfile().body?.sex); if (!g) return;
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
  setTargets(ctx, { goals: { sculptGoals: [...s] } });
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
    if (k === 'nutrition') setTargets(ctx, { nutrition: { mode: v } }, { replan: false });
    else if (k === 'goal') setTargets(ctx, { goals: { goal: v } }, { replan: false });
    else if (k === 'defaultStyle') setTargets(ctx, { training: { style: v } });
    else if (k === 'volumeMode') setTargets(ctx, { training: { volumePolicy: { mode: v } } });
    else if (k === 'volumeFill') setTargets(ctx, { training: { volumePolicy: { fillTargets: v } } });
    else if (k === 'cardioStyle') setTargets(ctx, { cardio: { style: v } });
    else up({ [k]: v });
  }));
  root.querySelectorAll('[data-goal]').forEach(b => b.onclick = () => toggleGoal(ctx, b.dataset.goal));
  root.querySelectorAll('[data-ginfo]').forEach(b => b.onclick = () => goalInfoSheet(ctx, b.dataset.ginfo));
  root.querySelectorAll('[data-prio]').forEach(r => {
    const g = r.dataset.prio; const lab = root.querySelector(`[data-prio-v="${g}"]`);
    const tl = root.querySelector(`[data-prio-t="${g}"]`), tn = root.querySelector(`[data-prio-n="${g}"]`), td = root.querySelector(`[data-prio-d="${g}"]`);
    r.addEventListener('input', () => {
      const lim = priorityLimits(ctx.store.getProfile());
      lab.textContent = '×' + Number(r.value).toFixed(2); r.style.setProperty('--pct', prioPct(r.value, lim) + '%');
      const p = ctx.store.getProfile(), q = { ...p, groupPriority: { ...(p.groupPriority || {}), [g]: Number(r.value) } };
      if (tl) tl.textContent = prioLine(q, g);
      const n = prioNote(q, g); if (tn) tn.textContent = n.text; if (td && n.capped) td.open = true;   // the moment a slider hits the cap, say why
    });
    r.addEventListener('change', () => { const p = ctx.store.getProfile(); setTargets(ctx, { training: { groupPriority: { ...(p.groupPriority || {}), [g]: Number(r.value) } } }); });
  });
  root.querySelector('[data-prio-reset]').onclick = async () => {
    const { defaultProfile } = await import('../store.js');
    setTargets(ctx, { training: { groupPriority: { ...defaultProfile().groupPriority } } }, { reason: 'default muscle priorities' });
  };
  const wlBtn = root.querySelector('[data-wl-edit]');
  if (wlBtn) wlBtn.onclick = () => openTargetsSheet(ctx, { focus: 'adherence' });
  root.querySelectorAll('[data-loc]').forEach(b => b.onclick = () => locationSheet(ctx, b.dataset.loc));
  root.querySelector('[data-addloc]').onclick = () => locationSheet(ctx, null);
  root.querySelectorAll('[data-vmax]').forEach(b => b.onclick = () => setTargets(ctx, { training: { volumePolicy: { maxMinutes: Number(b.dataset.vmax) } } }));
  root.querySelectorAll('[data-min]').forEach(b => b.onclick = () => setTargets(ctx, { training: { defaultMinutes: Number(b.dataset.min) } }, { replan: false }));
  const cr = root.querySelector('[data-cardio]'), crv = root.querySelector('[data-cardio-v]');
  cr.addEventListener('input', () => { crv.textContent = cr.value + ' min'; cr.style.setProperty('--pct', (cr.value / Number(cr.dataset.max || 600)) * 100 + '%'); });
  cr.addEventListener('change', () => { cr.blur(); setTargets(ctx, { cardio: { minPerWeek: Number(cr.value) } }); });
  const sc = root.querySelector('[data-setcap]'), scv = root.querySelector('[data-setcap-v]');
  if (sc) {
    const [lo, hi] = LIMITS.sessionSetCap;
    sc.addEventListener('input', () => { scv.textContent = sc.value + ' sets'; sc.style.setProperty('--pct', ((sc.value - lo) / (hi - lo)) * 100 + '%'); });
    sc.addEventListener('change', () => { sc.blur(); setTargets(ctx, { training: { sessionSetCap: Number(sc.value) } }); });
  }
  const ad = root.querySelector('[data-adh]'), adv = root.querySelector('[data-adh-v]');
  ad.addEventListener('input', () => { adv.textContent = Math.round(ad.value * 100) + '%'; ad.style.setProperty('--pct', ((ad.value - LIMITS.adherence[0]) / (LIMITS.adherence[1] - LIMITS.adherence[0])) * 100 + '%'); });
  ad.addEventListener('change', () => { ad.blur(); setTargets(ctx, { adherence: Number(ad.value) }, { replan: false }); });
  root.querySelectorAll('[data-dstyle]').forEach(b => b.onclick = () => setTargets(ctx, { training: { style: b.dataset.dstyle } }));
  const sampleRef = () => {   // the style editor's "≈ N min" uses a 45-min upper workout here
    const p = ctx.store.getProfile();
    const loc = (p.locations || []).find(l => l.id === p.currentLocation) || (p.locations || [])[0];
    try { return buildWorkout({ targets: ['upper'], minutes: 45, location: loc, profile: p, sessions: ctx.store.getSessions(), style: 'hypertrophy', seed: 1 }); } catch (e) { return null; }
  };
  root.querySelector('[data-st-new]')?.addEventListener('click', () => openStyleEditor(ctx, { style: 'efficient', refSession: sampleRef(), refLabel: 'a 45-min upper workout' }));
  root.querySelectorAll('[data-st-edit]').forEach(b => b.onclick = () => { const cs = (ctx.store.getProfile().customStyles || []).find(x => x && x.id === b.dataset.stEdit); if (cs) openStyleEditor(ctx, { style: cs, refSession: sampleRef(), refLabel: 'a 45-min upper workout' }); });
  root.querySelectorAll('[data-st-del]').forEach(b => b.onclick = () => deleteStyle(ctx, b.dataset.stDel));
  root.querySelector('[data-st-why]')?.addEventListener('click', () => openStyleInfo(ctx));
  root.querySelector('[data-tg-all]')?.addEventListener('click', () => import('./targets.js').then(m => m.openTargetsSheet(ctx, { focus: 'cardio' })));
  root.querySelectorAll('[data-sw]').forEach(i => i.addEventListener('change', () => {
    const p = ctx.store.getProfile(); const rt = { ...(p.restTimer || {}) };
    if (i.dataset.sw === 'rtEnabled') rt.enabled = i.checked; else rt.sound = i.checked;
    up({ restTimer: rt });
  }));
  root.querySelector('[data-rttest]').onclick = () => { if (ctx.store.getProfile().restTimer?.enabled === false) ctx.toast('Rest timer is off'); else ctx.timer.start(10); };
  root.querySelector('[data-crunch]').onchange = e => up({ crunch: { ...(ctx.store.getProfile().crunch || {}), club: e.target.value } });
  const bw = root.querySelector('[data-bw]');
  bw.addEventListener('change', () => { const v = parseFloat(bw.value); if (v > 50 && v < 600) { ctx.store.logBodyweight(ds(), v); ctx.toast(`Logged ${v} lb for today`); } });
  // sex + female fields (§20)
  const sx = root.querySelector('#st-sex');
  if (sx) {
    let pick = null;
    sx.querySelectorAll('[data-sexseg] button').forEach(b => b.addEventListener('click', () => {
      sx.querySelectorAll('[data-sexseg] button').forEach(x => x.classList.toggle('active', x === b));
      pick = b.dataset.v; showFemaleFields(sx, pick);
    }));
    bindSexInfo(sx, ctx);
    sx.querySelector('[data-savesex]').addEventListener('click', () => {
      const before = ctx.store.getProfile();
      const body = { ...(before.body || {}), sex: pick || before.body?.sex || 'male' };
      if (body.sex === 'female') Object.assign(body, readFemaleFields(sx));
      ctx.store.updateProfile({ body });
      ctx.toast(body.sex === 'female' ? 'Saved: female mode on' : 'Saved');
      maybeOfferFemaleGoals(ctx, before);
    });
  }
  const nm = root.querySelector('[data-name]');
  nm.addEventListener('change', () => up({ name: nm.value.trim() || 'Bob' }));
  bindAccountsSection(root, ctx);
  if (params?.section) {
    const el = root.querySelector('#sec-' + params.section);
    if (el && window.scrollY < 10) setTimeout(() => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }), 60);
  }
}

export function render(ctx, params) { return ctx.route === 'settings' ? renderSettings(ctx, params) : renderMore(ctx, params); }
export function bind(root, ctx, params) { return ctx.route === 'settings' ? bindSettings(root, ctx, params) : bindMore(root, ctx, params); }
