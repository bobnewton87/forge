// "Something hurting?" (§26, UI). Log / edit / resolve an issue; the Today strip and Body card of active
// issues; the active workout's "Hurts" sheet. Every write goes through setTargets(ctx, { issues: patch })
// (targets.applyTargetChange → engine/issues.applyIssuePatch), so logging or resolving one re-plans the
// upcoming auto days like any other target change. Forge is not a clinician: the copy only ever says which
// moves it leaves out; severe adds one safety line, nothing more.
// CONTRACT-NOTE (§26): exports issueStripHTML(ctx) / bindIssueStrip(root, ctx) (Today), issueCardHTML(ctx) /
//   bindIssueCard(root, ctx) (Body), openIssueSheet(ctx, { issue, preset, onSaved }), openHurtsSheet(ctx,
//   { exId, onSaved }) (active workout), activeOf(ctx). Styles: is-* classes in css/train.css.
import {
  AREAS, AREA_ORDER, SEVERITIES, SEVERITY_ORDER, SAFETY_LINE, NOT_A_CLINICIAN, activeIssues, issueLabel, needsCheck,
  areaOptionsFor, issueFilter, issueTier, isLateral, issueLimb, sideOnlyLabel, SIDE_ONLY_INFO, applySides,
} from '../engine/issues.js';
// CONTRACT-NOTE (§26.4): sideTag(block) / sideNoteHTML(block) render a healthy-side-only block ("Right arm
//   only", half credit, the cross-education line with its two sources); withSides(ctx, session) re-applies
//   the active issues' sides after a swap or an add. The sheets explain what the side choice does.
import { GROUPS, GROUP_ORDER } from '../data/muscles.js';
import { getEx } from '../data/exercises.js';
import { setTargets } from './targets.js';
import { esc, chip, openSheet, toast, safe } from './components.js';
import { ds, fmtShort, daysBetween } from '../util.js';

const SIDES = [['left', 'Left'], ['right', 'Right'], ['both', 'Both']];

export function activeOf(ctx) { return safe(() => activeIssues(ctx.store.getProfile(), ds()), []); }

// ---------------------------------------------------------------- healthy side only (§26.4)
export function sideTag(b) { return b && b.sideOnly ? sideOnlyLabel(b.sideOnly, getEx(b.exId)) : ''; }
// On the block: the side and the half-credit convention. The cross-education line is shown once per
// workout (sideExplainHTML), not repeated on every block.
export function sideNoteHTML(b) {
  if (!b || !b.sideOnly) return '';
  return `<div class="is-sidenote"><b>${esc(sideTag(b))}</b> · ${esc(SIDE_ONLY_INFO.credit)}</div>`;
}
export function sideExplainHTML(session) {
  if (!(session?.blocks || []).some(b => b && b.kind === 'lift' && b.sideOnly)) return '';
  return `<p class="tiny muted is-sideexplain">${esc(SIDE_ONLY_INFO.crossEd)} (${esc(SIDE_ONLY_INFO.cite)})</p>`;
}
// The workout with the active issues' sides applied (after a swap or an add the new block needs its side).
export function withSides(ctx, s) { return safe(() => applySides(s, activeOf(ctx)), s); }
// What the side choice does, for the sheets.
function sideHelp(st) {
  if (!isLateral(st)) return '';
  if (st.side !== 'left' && st.side !== 'right') return 'Both sides: every move that loads it follows the rule below, whichever arm or leg does it.';
  const limb = issueLimb({ ...st }) || 'arm', other = st.side === 'left' ? 'right' : 'left';
  return limb === 'leg'
    ? `${st.side[0].toUpperCase() + st.side.slice(1)} side: two-leg moves follow the rule below; seated or lying one-leg machine moves (leg press, extension, curl) stay in for the ${other} leg. Lunges, split squats and step-ups don't: the ${st.side} leg is the stance leg.`
    : `${st.side[0].toUpperCase() + st.side.slice(1)} side: two-arm moves follow the rule below; one-arm moves that leave the ${st.side} arm resting stay in, for the ${other} arm only.`;
}
const since = x => { const d = safe(() => daysBetween(x.started, ds()), 0); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const sevTag = x => SEVERITIES[x.severity]?.name.toLowerCase() || x.severity;

// What the issue takes out of the library, in words: "Leaves out 41 moves, e.g. skull crushers, dips".
function effectLine(draft) {
  const f = safe(() => issueFilter([draft]), null);
  if (!f) return '';
  const ex = [...f.blocked].map(getEx).filter(Boolean);
  // examples: the moves that load it hardest, everyday kit first (dumbbell / cable / machine / barbell), one per pattern
  const kit = e => ((e.equipment || []).some(q => /dumbbell|cable|machine|barbell|ez_bar|trap_bar|leg_press|lat_pulldown|dip_station/.test(q)) ? 0 : 1);
  const ranked = [...ex].sort((a, b) => issueTier(b, draft) - issueTier(a, draft) || kit(a) - kit(b) || a.name.length - b.name.length);
  const eg = [...new Map(ranked.map(e => [e.pattern, e])).values()].slice(0, 3).map(e => e.name);
  const soft = f.penalty.size ? ` and goes easy on ${f.penalty.size} more` : '';
  const one = f.side.size ? ` ${f.side.size} one-${[...f.side.keys()].some(id => ['squat', 'knee_extension', 'knee_flexion'].includes(getEx(id)?.pattern)) ? 'leg' : 'arm'} moves stay in for the ${[...f.side.values()][0]} side only.` : '';
  return (ex.length ? `Forge will leave out ${ex.length} moves${eg.length ? ` (e.g. ${eg.join(', ')})` : ''}${soft}.` : 'Nothing in the library loads it hard enough to leave out.') + one;
}

// ---------------------------------------------------------------- Today strip
// Low-key: a "Something hurting?" link, one chip per active issue (tap = edit / "Feels better"), and one
// "Still hurting?" card for an issue logged (or last confirmed) CHECK_DAYS or more ago.
export function issueStripHTML(ctx) {
  const list = activeOf(ctx);
  const due = list.find(x => needsCheck(x, ds()));
  return `<div class="is-strip">
    ${due ? `<div class="card tight is-check"><div class="grow"><b class="small">${esc(issueLabel(due))}: still hurting?</b>
      <div class="tiny muted">Logged ${esc(fmtShort(due.started))} (${since(due)}). Forge is still leaving out the moves that load it.</div></div>
      <div class="is-check-btns"><button type="button" class="btn btn-sm" data-is-still="${esc(due.id)}">Still hurting</button>
      <button type="button" class="btn btn-sm btn-good" data-is-better="${esc(due.id)}">Feels better</button></div></div>` : ''}
    <div class="tr-chiprow wrap is-chips">${list.map(x => chip(`🩹 ${issueLabel(x)} · ${sevTag(x)}`, { attrs: `data-is-edit="${esc(x.id)}"`, cls: `sm is-chip is-${x.severity}` })).join('')}
      <button type="button" class="tr-link is-new" data-is-new>${list.length ? '+ Something else?' : '🩹 Something hurting?'}</button></div>
  </div>`;
}
export function bindIssueStrip(root, ctx) {
  root.querySelectorAll('[data-is-new]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openIssueSheet(ctx); }));
  root.querySelectorAll('[data-is-edit]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const x = activeOf(ctx).find(i => i.id === b.dataset.isEdit); if (x) openIssueSheet(ctx, { issue: x });
  }));
  root.querySelectorAll('[data-is-still]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const x = activeOf(ctx).find(i => i.id === b.dataset.isStill); if (!x) return;
    setTargets(ctx, { issues: { check: x.id } }, { replan: false, quiet: true, reason: `${issueLabel(x)} still hurting` });
    toast(ctx, `Noted. Forge keeps working around your ${issueLabel(x).toLowerCase()}; it will ask again in a week.`);
  }));
  root.querySelectorAll('[data-is-better]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const x = activeOf(ctx).find(i => i.id === b.dataset.isBetter); if (x) resolve(ctx, x);
  }));
}
function resolve(ctx, x) {
  return setTargets(ctx, { issues: { resolve: x.id } }, { reason: `${issueLabel(x).toLowerCase()} feels better` });
}

// ---------------------------------------------------------------- Body card
export function issueCardHTML(ctx) {
  const list = activeOf(ctx);
  return `<div class="list is-list">${list.map(x => `<button type="button" class="list-item" data-is-edit="${esc(x.id)}"><span class="ic">🩹</span>
      <div class="grow"><div class="t">${esc(issueLabel(x))} <span class="badge ${x.severity === 'mild' ? 'warn' : 'bad'}">${esc(sevTag(x))}</span></div>
      <div class="s">Since ${esc(fmtShort(x.started))}${x.note ? ` · ${esc(x.note)}` : ''}${needsCheck(x, ds()) ? ' · still hurting?' : ''}</div></div><span class="chev">›</span></button>`).join('')}
    <button type="button" class="list-item" data-is-new><span class="ic">＋</span><div class="grow"><div class="t" style="color:var(--accent)">${list.length ? 'Log something else' : 'Something hurting?'}</div>
      <div class="s">Forge leaves out the moves that load it until it feels better.</div></div></button></div>`;
}
export function bindIssueCard(root, ctx) { bindIssueStrip(root, ctx); }

// ---------------------------------------------------------------- log / edit sheet
// preset: { area, group?, side?, severity?, note? } (the "Hurts" action passes the exercise's area).
export function openIssueSheet(ctx, { issue = null, preset = null, onSaved = null } = {}) {
  const st = issue ? { ...issue } : { area: 'shoulder', side: 'both', severity: 'mild', started: ds(), note: '', ...(preset || {}) };
  if (st.area === 'muscle' && !GROUPS[st.group]) st.group = 'chest';
  const body = () => {
    const a = AREAS[st.area];
    return `<div class="tr-sheet-h"><h3>${issue ? `Edit: ${esc(issueLabel(issue))}` : 'Something hurting?'}</h3>
      <div class="tiny muted">${esc(NOT_A_CLINICIAN)}</div></div>
    <div class="tr-label">Where</div>
    <div class="tr-chiprow wrap">${AREA_ORDER.map(id => chip(AREAS[id].name, { active: st.area === id, attrs: `data-a="${id}"`, cls: 'sm' })).join('')}</div>
    ${st.area === 'muscle' ? `<div class="tr-label">Which muscle</div><div class="tr-chiprow wrap">${GROUP_ORDER.map(g => chip(GROUPS[g].name, { active: st.group === g, attrs: `data-g="${g}"`, cls: 'sm' })).join('')}</div>` : ''}
    ${isLateral(st) ? `<div class="tr-label">Which side hurts</div><div class="tr-chiprow">${SIDES.map(([v, l]) => chip(l, { active: st.side === v, attrs: `data-sd="${v}"`, cls: 'sm' })).join('')}</div>
      <p class="tiny muted is-sidehelp">${esc(sideHelp(st))}</p>` : ''}
    <div class="tr-label">How bad</div>
    <div class="list is-sev">${SEVERITY_ORDER.map(v => `<button type="button" class="list-item ${st.severity === v ? 'is-on' : ''}" data-sv="${v}" aria-pressed="${st.severity === v}">
      <span class="ic">${st.severity === v ? '●' : '○'}</span><div class="grow"><div class="t">${esc(SEVERITIES[v].name)} <span class="muted small">· ${esc(SEVERITIES[v].short)}</span></div>
      <div class="s">${esc(SEVERITIES[v].rule)}</div></div></button>`).join('')}</div>
    ${st.severity === 'severe' ? `<div class="is-safety">⚠︎ ${esc(SAFETY_LINE)}</div>` : ''}
    <p class="small muted" data-is-effect>${esc(effectLine({ ...st, id: st.id || 'is_preview' }))}</p>
    <label class="tr-field"><span class="tr-label">Started</span><input type="date" value="${esc(st.started || ds())}" max="${ds()}" data-f="started"></label>
    <label class="tr-field"><span class="tr-label">Note (optional)</span><input type="text" maxlength="200" placeholder="e.g. hurts at the bottom of a press" value="${esc(st.note || '')}" data-f="note"></label>
    <div class="tr-sheet-actions">${issue
      ? '<button type="button" class="btn btn-good" data-is-act="better">Feels better</button><button type="button" class="btn btn-primary" data-is-act="save">Save</button>'
      : '<button type="button" class="btn btn-primary tr-big" data-is-act="save">Log it</button>'}</div>
    ${issue ? '<button type="button" class="btn btn-ghost btn-block tr-danger-text mt" data-is-act="delete">Delete (logged by mistake)</button>' : ''}`;
  };
  openSheet(ctx, `<div data-is-sheet>${body()}</div>`, (el, close) => {
    const host = el.querySelector('[data-is-sheet]') || el;
    const read = () => { const s = host.querySelector('[data-f="started"]')?.value; const n = host.querySelector('[data-f="note"]')?.value; if (s) st.started = s; if (n != null) st.note = n; };
    const redraw = () => { read(); host.innerHTML = body(); };
    host.addEventListener('click', e => {
      const t = e.target.closest('[data-a],[data-g],[data-sd],[data-sv],[data-is-act]'); if (!t) return;
      if (t.dataset.a) { st.area = t.dataset.a; if (st.area === 'muscle' && !GROUPS[st.group]) st.group = 'chest'; if (!isLateral(st)) st.side = 'both'; return redraw(); }
      if (t.dataset.g) { st.group = t.dataset.g; if (!isLateral(st)) st.side = 'both'; return redraw(); }
      if (t.dataset.sd) { st.side = t.dataset.sd; return redraw(); }
      if (t.dataset.sv) { st.severity = t.dataset.sv; return redraw(); }
      read();
      const act = t.dataset.isAct;
      const fields = { area: st.area, side: st.side, severity: st.severity, started: st.started, note: st.note, ...(st.area === 'muscle' ? { group: st.group } : {}) };
      const label = issueLabel(fields);
      close();
      if (act === 'save' && !issue) {
        // saves now, re-plans after; a caller's message (onSaved's return) leads the re-plan toast (§26 D)
        let lead = '';
        setTargets(ctx, { issues: { add: fields } }, { reason: `${label.toLowerCase()} logged (${st.severity})`, quiet: !!onSaved, lead: () => lead });
        if (onSaved) lead = onSaved(fields) || '';
      } else if (act === 'save') setTargets(ctx, { issues: { update: { id: issue.id, ...fields } } }, { reason: `${label.toLowerCase()} updated` });
      else if (act === 'better') resolve(ctx, issue);
      else if (act === 'delete') setTargets(ctx, { issues: { remove: issue.id } }, { reason: `${label.toLowerCase()} removed` });
    });
  });
}

// ---------------------------------------------------------------- active workout: "Hurts"
// The areas this exercise loads (hardest first) as one-tap picks, severity, side; "Log & swap" logs the
// issue and hands back the issue fields so the workout can swap the exercise for one that spares it.
export function openHurtsSheet(ctx, { exId, onSaved } = {}) {
  const ex = getEx(exId);
  const opts = areaOptionsFor(exId).slice(0, 5);
  const st = { pick: 0, severity: 'mild', side: 'both' };
  const cur = () => opts[st.pick] || { area: 'muscle', group: 'chest' };
  const body = () => {
    const o = cur(), sided = isLateral(o);
    const fields = { id: 'is_preview', area: o.area, ...(o.group ? { group: o.group } : {}), side: st.side, severity: st.severity };
    return `<div class="tr-sheet-h"><h3>${esc(ex?.name || 'This exercise')} hurts</h3>
      <div class="tiny muted">${esc(NOT_A_CLINICIAN)}</div></div>
    <div class="tr-label">Where</div>
    <div class="tr-chiprow wrap">${opts.map((x, i) => chip(x.area === 'muscle' ? GROUPS[x.group]?.name || 'Muscle' : AREAS[x.area].name, { active: st.pick === i, attrs: `data-pick="${i}"`, cls: 'sm' })).join('')}
      <button type="button" class="tr-link" data-more>Somewhere else…</button></div>
    ${sided ? `<div class="tr-label">Which side hurts</div><div class="tr-chiprow">${SIDES.map(([v, l]) => chip(l, { active: st.side === v, attrs: `data-sd="${v}"`, cls: 'sm' })).join('')}</div>
      <p class="tiny muted is-sidehelp">${esc(sideHelp({ ...o, side: st.side }))}</p>` : ''}
    <div class="tr-label">How bad</div>
    <div class="tr-chiprow">${SEVERITY_ORDER.map(v => chip(SEVERITIES[v].name, { active: st.severity === v, attrs: `data-sv="${v}"`, cls: 'sm' })).join('')}</div>
    <p class="small muted mt">${esc(SEVERITIES[st.severity].short)}: ${esc(SEVERITIES[st.severity].rule)}</p>
    ${st.severity === 'severe' ? `<div class="is-safety">⚠︎ ${esc(SAFETY_LINE)}</div>` : ''}
    <p class="small muted">${esc(effectLine(fields))}</p>
    <div class="tr-sheet-actions"><button type="button" class="btn btn-primary tr-big" data-go>Log it &amp; swap this exercise</button></div>`;
  };
  openSheet(ctx, `<div data-is-sheet>${body()}</div>`, (el, close) => {
    const host = el.querySelector('[data-is-sheet]') || el;
    host.addEventListener('click', e => {
      const t = e.target.closest('[data-pick],[data-sd],[data-sv],[data-go],[data-more]'); if (!t) return;
      if (t.dataset.pick != null) { st.pick = Number(t.dataset.pick); if (!isLateral(cur())) st.side = 'both'; host.innerHTML = body(); return; }
      if (t.dataset.sd) { st.side = t.dataset.sd; host.innerHTML = body(); return; }
      if (t.dataset.sv) { st.severity = t.dataset.sv; host.innerHTML = body(); return; }
      if (t.dataset.more != null) { close(); openIssueSheet(ctx, { preset: { area: cur().area, group: cur().group, severity: st.severity, side: st.side, note: ex ? `During ${ex.name}` : '' }, onSaved }); return; }
      const o = cur();
      const fields = { area: o.area, ...(o.group ? { group: o.group } : {}), side: st.side, severity: st.severity, started: ds(), note: ex ? `During ${ex.name}` : '' };
      close();
      // the swap's own toast shows at once and then leads the re-plan toast, instead of being overwritten (§26 D)
      let lead = '';
      setTargets(ctx, { issues: { add: fields } }, { reason: `${issueLabel(fields).toLowerCase()} logged (${st.severity})`, quiet: true, lead: () => lead });
      if (onSaved) lead = onSaved(fields) || '';
    });
  });
}
