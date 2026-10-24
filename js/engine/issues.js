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
// CONTRACT-NOTE (§26.4, 2026-10-24): SIDE. A one-sided issue on a limb (shoulder / elbow / wrist / hip / knee /
//   ankle, or the muscle groups in LIMB_GROUPS) keeps the severity rules for bilateral moves, but a one-limb
//   move it would exclude or penalise (oneSideLimb(ex) matches the issue's limb) is kept as "healthy side
//   only": issueFilter().side maps exId → 'left'|'right', the generator writes block.sideOnly, and each such
//   set counts SIDE_ONLY_CREDIT (0.5) toward weekly volume. Extra exports: LIMB_GROUPS, SIDE_ONLY_CREDIT,
//   SIDE_ONLY_INFO, issueLimb, isLateral, oneSideLimb, sideOnlyLabel, effectiveTier, applySides.
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

// ---------------------------------------------------------------- side (§26.4)
// Which limb an area or a muscle group belongs to. Only these have a left and a right that a one-limb
// move can spare; neck, back, chest and core issues ignore the side.
const ARM_AREAS = new Set(['shoulder', 'elbow', 'wrist']), LEG_AREAS = new Set(['hip', 'knee', 'ankle']);
export const LIMB_GROUPS = { shoulders: 'arm', biceps: 'arm', triceps: 'arm', forearms: 'arm', quads: 'leg', hamstrings: 'leg', glutes: 'leg', calves: 'leg' };
export function isLateral(x) { return !!x && (ARM_AREAS.has(x.area) || LEG_AREAS.has(x.area) || (x.area === 'muscle' && !!LIMB_GROUPS[x.group])); }
// 'arm' | 'leg' for a one-sided issue on a limb, else null (side 'both', or an area with no sides).
export function issueLimb(x) {
  if (!x || (x.side !== 'left' && x.side !== 'right')) return null;
  return ARM_AREAS.has(x.area) ? 'arm' : LEG_AREAS.has(x.area) ? 'leg' : x.area === 'muscle' ? LIMB_GROUPS[x.group] || null : null;
}
// A one-limb move whose OTHER limb is genuinely unloaded → 'arm' | 'leg', else null. Derived from the
// exercise's own `unilateral` flag and pattern: one-arm DB / cable / machine work counts, unless the free
// hand braces or bears weight (a bench-supported row, a kickback off a bench, holding a post to lean
// away, an archer push-up); for legs only seated or lying one-leg machine-style work counts (leg press,
// leg extension, leg curl, and their band versions done seated / lying). Split squats, lunges, step-ups,
// single-leg RDLs, hip thrusts, standing calf raises and standing cable kickbacks do not: the other leg
// is the stance leg or held up under load.
const ARM_PATTERNS = new Set(['horizontal_push', 'horizontal_pull', 'vertical_push', 'vertical_pull', 'fly', 'lateral_raise', 'rear_delt', 'elbow_flexion', 'elbow_extension', 'wrist', 'carry', 'shrug']);
const BRACED = new Set(['db_row', 'kroc_row', 'db_lat_row', 'kb_row', 'kb_gorilla_row', 'meadows_row', 'door_row', 'db_kickback', 'pushup_archer', 'db_lateral_lean', 'cable_egyptian', 'wall_lateral_iso']);
export function oneSideLimb(ex) {
  if (!ex || !ex.unilateral || BRACED.has(ex.id)) return null;
  if (ARM_PATTERNS.has(ex.pattern)) return 'arm';
  const eq = ex.equipment || [];
  if (['squat', 'knee_extension', 'knee_flexion'].includes(ex.pattern) && (eq.some(q => q === 'leg_press' || q === 'leg_ext' || q === 'leg_curl') || /^band_leg_(ext|curl)$/.test(ex.id))) return 'leg';
  return null;
}
// Weekly volume credit of a healthy-side-only set: one side of the pair. A convention, not a measurement.
export const SIDE_ONLY_CREDIT = 0.5;
// Verified against the PubMed records (abstracts) of both sources, 2026-10-24.
export const SIDE_ONLY_INFO = {
  credit: 'Counts as half a set for the week: one side of the pair (a convention).',
  crossEd: 'Training the free side may help the other side hold its strength (cross-education): in small studies a casted wrist kept its strength when the free arm trained. That is strength, not muscle size, and it was tested on casts, not injuries.',
  evidence: [
    { claim: 'Wrist in a cast for 3 weeks (10 per group): when the free arm trained, the casted arm kept its strength (13.9 to 14.2 N·m); with the cast alone it fell (12.2 to 10.4 N·m).', source: 'Farthing, Krentz & Magnus 2009, J Appl Physiol 106:830, doi:10.1152/japplphysiol.91331.2008' },
    { claim: 'Across 31 randomized trials (785 people), training one limb raised the untrained limb\u2019s strength 11.9% on average, with a high risk of bias across the studies.', source: 'Manca et al. 2017, Eur J Appl Physiol 117:2335, doi:10.1007/s00421-017-3720-z' },
  ],
  cite: 'cross-education: Farthing 2009, Manca 2017',
};
// "Right arm only" for a block (or an exercise + side).
export function sideOnlyLabel(side, ex) {
  if (side !== 'left' && side !== 'right') return '';
  return `${side === 'left' ? 'Left' : 'Right'} ${oneSideLimb(ex) || 'side'} only`;
}

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
    // a side only means something where there is a left and a right (a muscle issue: limb groups only)
    side: AREAS[x.area].sided && (x.area !== 'muscle' || LIMB_GROUPS[x.group]) && SIDES.includes(x.side) ? x.side : 'both',
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

// What changes the plan (the planner re-plans when this changes): area, muscle, side, severity.
export function issueKey(x) { return `${x.id}|${x.area}|${x.group || ''}|${x.side || 'both'}|${x.severity}`; }

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

// What the active issues do to one exercise: { blocked: Issue|null, penalty: 0..1, by: Issue|null,
// side: 'left'|'right'|null, sideBy: [Issue] }. A one-limb move that a one-sided limb issue would exclude
// or penalise is kept for the healthy side instead (`side`); two issues that leave no healthy side block it.
export function issueEffects(ex, issues = []) {
  let blocked = null, penalty = 1, by = null, side = null;
  const sideBy = [], limb = oneSideLimb(ex);
  const block = x => { if (!blocked || SEVERITY_ORDER.indexOf(x.severity) > SEVERITY_ORDER.indexOf(blocked.severity)) blocked = x; };
  for (const x of issues) {
    const tier = issueTier(ex, x), sev = SEVERITIES[x.severity] || SEVERITIES.mild;
    const hit = tier >= sev.exclude ? 'block' : sev.penalty[tier] ? 'penalty' : null;
    if (!hit) continue;
    if (limb && issueLimb(x) === limb) {
      const healthy = x.side === 'left' ? 'right' : 'left';
      if (side && side !== healthy) block(x); else { side = healthy; sideBy.push(x); }
      continue;
    }
    if (hit === 'block') { block(x); continue; }
    const p = sev.penalty[tier];
    if (p < penalty) { penalty = p; by = x; }
  }
  if (blocked) side = null;
  return { blocked, penalty, by, side, sideBy };
}
// How hard `ex` loads the issue's area FOR THE SORE SIDE: 0 when it is kept healthy-side only.
export function effectiveTier(ex, issue) {
  const r = issueEffects(ex, [issue]);
  return r.side ? 0 : issueTier(ex, issue);
}

// The whole library at once (memoized per issue set): { blocked:Set<exId>, penalty:Map<exId,mult>,
// side:Map<exId,'left'|'right'>, why(exId) → Issue|null, any:boolean }. Every engine and UI that picks
// exercises reads this.
const filterCache = new Map();
export function issueFilter(issues = []) {
  const list = (issues || []).filter(Boolean);
  const key = list.map(issueKey).join(',');
  if (filterCache.has(key)) return filterCache.get(key);
  const blocked = new Set(), penalty = new Map(), side = new Map(), why = new Map();
  if (list.length) for (const e of EXERCISES) {
    const r = issueEffects(e, list);
    if (r.blocked) { blocked.add(e.id); why.set(e.id, r.blocked); continue; }
    if (r.side) { side.set(e.id, r.side); why.set(e.id, r.sideBy[0]); }
    if (r.penalty < 1) { penalty.set(e.id, r.penalty); if (!why.has(e.id)) why.set(e.id, r.by); }
  }
  const out = { blocked, penalty, side, why: id => why.get(id) || null, any: list.length > 0, issues: list };
  if (filterCache.size > 32) filterCache.clear();
  filterCache.set(key, out);
  return out;
}

// Set block.sideOnly on every lift block the active issues keep healthy-side only, and clear it where no
// issue asks for it any more. Pure → a new session. Moves the issues block outright are left as they are
// (an explicit pick is the user's call).
export function applySides(session, issues = []) {
  if (!session || !Array.isArray(session.blocks)) return session;
  const f = issueFilter(issues);
  let changed = false;
  const blocks = session.blocks.map(b => {
    if (!b || b.kind !== 'lift') return b;
    const want = f.side.get(b.exId) || null;
    if ((b.sideOnly || null) === want) return b;
    changed = true;
    const nb = { ...b };
    if (want) nb.sideOnly = want; else delete nb.sideOnly;
    return nb;
  });
  return changed ? { ...session, blocks } : session;
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
