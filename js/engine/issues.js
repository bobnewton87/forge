// "Something's hurting" (§26). Pure, DOM-free: the issue model, validation, and what an active issue
// means for exercise choice. The exercise → area stress table lives in js/data/stress.js.
//
// Forge is not a clinician. An issue only changes which exercises Forge picks; it never diagnoses,
// grades an injury or suggests treatment. Severe issues carry one plain safety line, nothing more.
//
// CONTRACT-NOTE (§26): profile.issues = [Issue]. Issue = { id:'is_<ms>', area, group?, side, severity,
//   started:'YYYY-MM-DD', note, resolvedAt:'YYYY-MM-DD'|null, checkedAt?:'YYYY-MM-DD' }.
//   area ∈ AREA_ORDER ('muscle' needs group = a muscles.GROUPS id); side 'left'|'right'|'both' (only
//   for AREAS[area].sided, else 'both'); severity 'mild'|'moderate'|'severe'. Stored on the profile
//   (one synced key, account-scoped like every profile field), written ONLY through
//   targets.applyTargetChange({ issues: patch }) → applyIssuePatch here. Exports: AREAS, AREA_ORDER,
//   SEVERITIES, SEVERITY_ORDER, SAFETY_LINE, NOT_A_CLINICIAN, CHECK_DAYS, normalizeIssue, activeIssues,
//   issueKey, issueLabel, applyIssuePatch, needsCheck, issueTier, issueEffects, issueFilter, areaOptionsFor.
import { GROUPS } from '../data/muscles.js';
import { EXERCISES, getEx } from '../data/exercises.js';
import { stressOf, muscleStress, AREAS_STRESS } from '../data/stress.js';

export const AREAS = {
  shoulder: { name: 'Shoulder', sided: true },
  elbow: { name: 'Elbow', sided: true },
  wrist: { name: 'Wrist / forearm', sided: true },
  neck: { name: 'Neck', sided: false },
  upper_back: { name: 'Upper back', sided: false },
  lower_back: { name: 'Lower back', sided: false },
  hip: { name: 'Hip', sided: true },
  knee: { name: 'Knee', sided: true },
  ankle: { name: 'Ankle / foot', sided: true },
  muscle: { name: 'A muscle', sided: true },
};
export const AREA_ORDER = ['shoulder', 'elbow', 'wrist', 'neck', 'upper_back', 'lower_back', 'hip', 'knee', 'ankle', 'muscle'];
export const SIDES = ['left', 'right', 'both'];

// exclude: the lowest stress tier that is dropped; penalty: tier → score multiplier for what stays.
export const SEVERITIES = {
  mild: { name: 'Mild', short: 'Twinge — train around it', rule: 'Forge drops the moves that load it hardest and goes easy on the ones that load it some.', exclude: 3, penalty: { 2: 0.35 } },
  moderate: { name: 'Moderate', short: 'Avoid loading it', rule: 'Forge drops every move that loads it. Moves that barely touch it stay in; skip any that still hurt.', exclude: 2, penalty: {} },
  severe: { name: 'Severe', short: 'Avoid loading it', rule: 'Forge drops every move that loads it. Moves that barely touch it stay in; skip any that still hurt.', exclude: 2, penalty: {} },
};
export const SEVERITY_ORDER = ['mild', 'moderate', 'severe'];
export const SAFETY_LINE = 'Sharp pain, swelling, numbness or pain at rest: stop and get it checked.';
export const NOT_A_CLINICIAN = 'Forge is not a clinician: logging this only changes which exercises it picks. It does not diagnose or treat anything.';
export const CHECK_DAYS = 7;   // an active issue asks "Still hurting?" after this many days

const isDs = s => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s);
const pad = n => String(n).padStart(2, '0');
const dsOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayDs = d => (isDs(d) ? d : dsOf(d instanceof Date ? d : new Date()));
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

// A valid issue, or null. Unknown fields are dropped; the note is trimmed to 200 characters.
export function normalizeIssue(x) {
  if (!x || typeof x !== 'object' || !AREAS[x.area]) return null;
  if (x.area === 'muscle' && !GROUPS[x.group]) return null;
  const out = {
    id: typeof x.id === 'string' && /^is_[A-Za-z0-9_]{1,40}$/.test(x.id) ? x.id : null,
    area: x.area,
    side: AREAS[x.area].sided && SIDES.includes(x.side) ? x.side : 'both',
    severity: SEVERITIES[x.severity] ? x.severity : 'mild',
    started: isDs(x.started) ? x.started : null,
    note: String(x.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    resolvedAt: isDs(x.resolvedAt) ? x.resolvedAt : null,
  };
  if (x.area === 'muscle') out.group = x.group;
  if (isDs(x.checkedAt)) out.checkedAt = x.checkedAt;
  return out.id ? out : null;
}

// Active (unresolved) issues, oldest first. A start date in the future is not active yet.
export function activeIssues(profile, today = new Date()) {
  const t = todayDs(today);
  return (Array.isArray(profile?.issues) ? profile.issues : []).map(normalizeIssue)
    .filter(x => x && !x.resolvedAt && (!x.started || x.started <= t))
    .sort((a, b) => (a.started || '').localeCompare(b.started || '') || a.id.localeCompare(b.id));
}

// What changes the plan (the planner re-plans when this changes): area, muscle, severity.
export function issueKey(x) { return `${x.id}|${x.area}|${x.group || ''}|${x.severity}`; }

// "Left elbow", "Lower back", "Biceps (right)".
export function issueLabel(x) {
  if (!x) return '';
  const side = x.side && x.side !== 'both' && AREAS[x.area]?.sided ? x.side : '';
  if (x.area === 'muscle') return `${GROUPS[x.group]?.name || 'Muscle'}${side ? ` (${side})` : ''}`;
  const name = AREAS[x.area]?.name || x.area;
  return side ? `${side[0].toUpperCase() + side.slice(1)} ${name.toLowerCase()}` : name;
}

// Pure list update. patch: { add: Issue } | { update: { id, ...fields } } | { resolve: id } |
// { check: id } (answered "still hurting") | { remove: id }; optional patch.date ('YYYY-MM-DD', default
// today) stamps started / resolvedAt / checkedAt. An update applies its valid fields and ignores the rest;
// an invalid add or an unknown id leaves the list unchanged.
export function applyIssuePatch(list, patch = {}) {
  const cur = (Array.isArray(list) ? list : []).map(normalizeIssue).filter(Boolean);
  const date = isDs(patch.date) ? patch.date : todayDs(new Date());
  if (patch.add) {
    const used = new Set(cur.map(x => x.id));
    let id = typeof patch.add.id === 'string' && /^is_[A-Za-z0-9_]{1,40}$/.test(patch.add.id) ? patch.add.id : 'is_' + Date.now();
    while (used.has(id)) id += '_';
    const x = normalizeIssue({ ...patch.add, id, started: isDs(patch.add.started) ? patch.add.started : date, resolvedAt: null });
    return x ? [...cur, x] : cur;
  }
  const at = id => cur.findIndex(x => x.id === id);
  if (patch.update && at(patch.update.id) >= 0) {
    // field by field, like applyTargetChange: a valid value is applied, an invalid one ignored
    const i = at(patch.update.id), u = patch.update, next = { ...cur[i] };
    const ok = {
      area: v => AREAS[v] && (v !== 'muscle' || GROUPS[u.group] || GROUPS[next.group]), group: v => GROUPS[v], side: v => SIDES.includes(v),
      severity: v => SEVERITIES[v], started: isDs, note: v => typeof v === 'string', resolvedAt: v => v === null || isDs(v), checkedAt: isDs,
    };
    for (const [k, v] of Object.entries(u)) if (ok[k] && ok[k](v)) next[k] = v;
    const x = normalizeIssue(next);
    if (x) cur[i] = x;
    return cur;
  }
  if (patch.resolve && at(patch.resolve) >= 0) { cur[at(patch.resolve)] = { ...cur[at(patch.resolve)], resolvedAt: date }; return cur; }
  if (patch.check && at(patch.check) >= 0) { cur[at(patch.check)] = { ...cur[at(patch.check)], checkedAt: date }; return cur; }
  if (patch.remove && at(patch.remove) >= 0) return cur.filter(x => x.id !== patch.remove);
  return cur;
}

// Ask "Still hurting?" once CHECK_DAYS have passed since it started or was last confirmed.
export function needsCheck(issue, today = new Date()) {
  if (!issue || issue.resolvedAt) return false;
  const since = issue.checkedAt && (!issue.started || issue.checkedAt > issue.started) ? issue.checkedAt : issue.started;
  return !!since && dayDiff(since, todayDs(today)) >= CHECK_DAYS;
}

// How hard `ex` loads the issue's area (0..3).
export function issueTier(ex, issue) {
  if (!ex || !issue) return 0;
  return issue.area === 'muscle' ? muscleStress(ex, issue.group) : (stressOf(ex)[issue.area] || 0);
}

// What the active issues do to one exercise: { blocked: Issue|null, penalty: 0..1, by: Issue|null }.
export function issueEffects(ex, issues = []) {
  let blocked = null, penalty = 1, by = null;
  for (const x of issues) {
    const tier = issueTier(ex, x), sev = SEVERITIES[x.severity] || SEVERITIES.mild;
    if (tier >= sev.exclude) { if (!blocked || SEVERITY_ORDER.indexOf(x.severity) > SEVERITY_ORDER.indexOf(blocked.severity)) blocked = x; continue; }
    const p = sev.penalty[tier];
    if (p && p < penalty) { penalty = p; by = x; }
  }
  return { blocked, penalty, by };
}

// The whole library at once (memoized per issue set): { blocked:Set<exId>, penalty:Map<exId,mult>,
// why(exId) → Issue|null, any:boolean }. Every engine and UI that picks exercises reads this.
const filterCache = new Map();
export function issueFilter(issues = []) {
  const list = (issues || []).filter(Boolean);
  const key = list.map(issueKey).join(',');
  if (filterCache.has(key)) return filterCache.get(key);
  const blocked = new Set(), penalty = new Map(), why = new Map();
  if (list.length) for (const e of EXERCISES) {
    const r = issueEffects(e, list);
    if (r.blocked) { blocked.add(e.id); why.set(e.id, r.blocked); } else if (r.penalty < 1) { penalty.set(e.id, r.penalty); why.set(e.id, r.by); }
  }
  const out = { blocked, penalty, why: id => why.get(id) || null, any: list.length > 0, issues: list };
  if (filterCache.size > 32) filterCache.clear();
  filterCache.set(key, out);
  return out;
}

// For the "Hurts" action: the areas this exercise loads, hardest first ([{ area, group?, tier }]),
// ending with its prime-mover muscle group as a 'muscle' option.
export function areaOptionsFor(exId) {
  const ex = getEx(exId); if (!ex) return [];
  const st = stressOf(ex);
  const out = AREAS_STRESS.filter(a => st[a] > 0).map(a => ({ area: a, tier: st[a] })).sort((a, b) => b.tier - a.tier);
  let pg = null, pw = 0;
  for (const g of Object.keys(GROUPS)) { const w = muscleStress(ex, g); if (w > pw) { pw = w; pg = g; } }
  if (pg) out.push({ area: 'muscle', group: pg, tier: pw });
  return out;
}
