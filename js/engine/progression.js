// Performance-based double progression, PRs and exercise history. Pure, DOM-free.
//
// CONTRACT-NOTE: lastPerformance() also returns `sessionId`. suggest() also returns
//   `unit`, `step` and `daysSince` (days since last time, or null).
// CONTRACT-NOTE: for unit 'seconds', `reps` in the suggestion is the hold time in seconds
//   (sets store the hold in `r`). For 'bodyweight', `weight` is added load or null.
// CONTRACT-NOTE: personalRecords() entries for bodyweight-without-load / timed holds have
//   e1rm:null and are ranked by best reps (or seconds); `type` says which ('e1rm'|'reps'|'seconds').
// CONTRACT-NOTE: assisted moves (tag 'assisted' or id 'assisted_*') log counterweight: suggest()
//   bumps by SUBTRACTING step (floor 0) and drops by adding it; PRs pick the lowest assistance
//   at >= repMin with type 'assisted', e1rm null. Extra export isAssisted(ex).
// CONTRACT-NOTE: extra export sessionPRs(session, sessions) → PRs set in that session.
import { getEx } from '../data/exercises.js';
import { ds, daysBetween, fmtShort } from '../util.js';

const counted = s => !!(s && s.done && Number(s.r) > 0);
const num = w => (typeof w === 'number' && isFinite(w) ? w : null);
const fmtW = w => String(Math.round(w * 100) / 100);
const toDs = d => (d == null ? ds(new Date()) : typeof d === 'string' ? d : ds(d));
const startedKey = s => String(s.startedAt || '') + '|' + String(s.id || '');

function setsFor(session, exId) {
  const out = [];
  for (const b of session?.blocks || []) {
    if (b.kind !== 'lift' || b.exId !== exId) continue;
    for (const s of b.sets || []) if (counted(s)) out.push({ w: num(s.w), r: Number(s.r) });
  }
  return out;
}

function chrono(sessions) {
  return [...(sessions || [])].filter(s => s && s.date).sort((a, b) => a.date.localeCompare(b.date) || startedKey(a).localeCompare(startedKey(b)));
}

export function lastPerformance(exId, sessions, beforeDate) {
  const before = toDs(beforeDate);
  const list = chrono(sessions);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (s.date >= before) continue;
    const sets = setsFor(s, exId);
    if (sets.length) return { date: s.date, sets, sessionId: s.id || null };
  }
  return null;
}

export function e1rm(w, r) {
  w = Number(w); r = Number(r);
  if (!(w > 0) || !(r > 0)) return 0;
  return Math.round(w * (1 + Math.min(r, 12) / 30) * 10) / 10;
}

// Assisted machine moves log the counterweight: LESS weight = harder = progress.
export function isAssisted(ex) { return !!ex && ((ex.tags || []).includes('assisted') || /^assisted_/.test(ex.id || '')); }

function kindOf(ex) { return ex?.unit === 'seconds' ? 'seconds' : ex?.unit === 'bodyweight' ? 'bodyweight' : 'weighted'; }

export function formatSets(sets, unit) {
  if (!sets?.length) return '';
  if (unit === 'seconds') {
    const ws = sets.map(s => s.w).filter(w => w > 0);
    const body = sets.map(s => s.r + 's').join(', ');
    return ws.length ? `+${fmtW(Math.max(...ws))} × ${body}` : body;
  }
  const wl = s => (s.w > 0 ? fmtW(s.w) : 'BW');
  const out = [];
  let prev;
  for (const s of sets) {
    const lbl = wl(s);
    out.push(lbl === prev ? String(s.r) : `${lbl}×${s.r}`);
    prev = lbl;
  }
  return out.join(', ');
}

export function suggest(exId, { sets, repMin, repMax } = {}, sessions, { now = new Date() } = {}) {
  const ex = getEx(exId);
  const kind = kindOf(ex);
  const unit = ex?.unit || 'each';
  repMin = Number(repMin) || ex?.repRange?.[0] || 8;
  repMax = Number(repMax) || ex?.repRange?.[1] || Math.max(repMin, 12);
  if (repMax < repMin) repMax = repMin;
  const nSets = Number(sets) || 3;
  const step = Number(ex?.step) > 0 ? Number(ex.step) : kind === 'seconds' ? 5 : 5;
  const today = toDs(now);
  const last = lastPerformance(exId, sessions, today);
  const base = { unit, step, last };

  if (!last) {
    const reason = isAssisted(ex)
      ? `First time: pick the assistance that lets you get ${repMin}-${repMax} reps with 2-3 in reserve. Less assistance = progress.`
      : kind === 'seconds'
      ? `First time: hold ${repMin}-${repMax}s with clean form, stopping before it breaks down.`
      : kind === 'bodyweight'
        ? `First time: aim for ${repMin}-${repMax} clean reps, stopping 2-3 reps short of failure.`
        : `First time: find a weight you can lift ${repMin}-${repMax} times with 2-3 reps left in reserve.`;
    return { ...base, weight: null, reps: repMin, label: 'start', reason, lastText: null, daysSince: null };
  }

  const daysSince = daysBetween(last.date, today);
  const lastText = `Last time (${fmtShort(last.date)}${isAssisted(ex) ? ', assist' : ''}): ${formatSets(last.sets, unit)}`;
  const topW = Math.max(0, ...last.sets.map(s => s.w || 0));
  const atTop = last.sets.filter(s => (s.w || 0) === topW);
  const best = [...atTop].map(s => s.r).sort((a, b) => b - a).slice(0, nSets);
  const repsTxt = best.join(',');
  const avg = atTop.reduce((s, x) => s + x.r, 0) / atTop.length;
  const minR = Math.min(...best);
  const fullSets = best.length >= nSets;
  const allTop = fullSets && best.every(r => r >= repMax);
  const weight = topW > 0 ? topW : null;
  const atW = weight != null ? ` at ${fmtW(weight)}` : '';
  const out = (label, w, reps, reason) => ({ ...base, weight: w, reps, label, reason, lastText, daysSince });

  // Assisted: work from the LOWEST assistance used; bump = less assistance, drop = more.
  function suggestAssisted() {
    const aW = Math.min(...last.sets.map(s => s.w || 0));
    const at = last.sets.filter(s => (s.w || 0) === aW);
    const bst = at.map(s => s.r).sort((a, b) => b - a).slice(0, nSets);
    const full = bst.length >= nSets, lo = Math.min(...bst);
    const avgA = at.reduce((t, x) => t + x.r, 0) / at.length;
    const wTxt = aW > 0 ? `${fmtW(aW)} assist` : 'no assist';
    const rd = x => Math.round(x * 100) / 100;
    if (full && bst.every(r => r >= repMax)) {
      if (aW <= 0) return out('add_reps', 0, repMax + 1, `Hit ${bst.join(',')} unassisted → go for ${repMax + 1}+ or move to the free version.`);
      const nw = Math.max(0, rd(aW - step));
      return out('bump', nw, repMin, `Hit ${bst.join(',')} with ${wTxt} → ${nw > 0 ? `drop assist to ${fmtW(nw)}` : 'try it unassisted'} and aim for ${repMin}+`);
    }
    if (avgA < 0.75 * repMin) {
      const nw = rd(aW + step);
      return out('drop', nw, repMin, `Averaged ${Math.round(avgA)} reps with ${wTxt} → add assist (${fmtW(nw)}) and own the ${repMin}-${repMax} range.`);
    }
    if (!full || lo < repMin) return out('hold', aW, repMin, `${!full ? `Only ${bst.length}/${nSets} sets` : `Got ${bst.join(',')}`} with ${wTxt} → keep it, hit ${repMin}+ on all ${nSets} sets.`);
    const t = Math.min(repMax, lo + 1);
    return out('add_reps', aW, t, `Got ${bst.join(',')} with ${wTxt} → keep it, aim for ${t}+ on every set.`);
  }

  // Long layoff: repeat what you did and rebuild rather than chasing progress.
  if (daysSince > 28) {
    return out('hold', weight, repMin, `${Math.round(daysSince / 7)} weeks since last time: repeat ${weight != null ? fmtW(weight) : 'it'} and aim for ${repMin}${kind === 'seconds' ? 's' : ''} to ease back in.`);
  }

  if (isAssisted(ex)) return suggestAssisted();

  if (kind === 'seconds') {
    if (allTop) return out('bump', weight, repMax + step, `Held ${repMax}s+ on every set → go ${repMax + step}s, or try a harder variation.`);
    if (avg < 0.75 * repMin) return out('drop', weight, repMin, `Averaged ${Math.round(avg)}s (goal ${repMin}-${repMax}s) → aim for ${repMin}s with perfect form.`);
    const tgt = Math.min(repMax, Math.max(repMin, minR + step));
    return out('add_reps', weight, tgt, `Held ${best.map(r => r + 's').join(', ')} → aim for ${tgt}s on every set.`);
  }

  if (allTop) {
    if (weight == null) {
      return out('add_reps', null, repMax + 1, `Hit ${repsTxt} → go for ${repMax + 1}+, or add load (hold a DB) / slow the tempo.`);
    }
    const nw = Math.round(((weight || 0) + step) * 100) / 100;
    return out('bump', nw, repMin, `Hit ${repsTxt}${atW} → go ${fmtW(nw)} and aim for ${repMin}+`);
  }

  if (avg < 0.75 * repMin) {
    if (weight == null) return out('drop', null, repMin, `Averaged ${Math.round(avg)} reps (goal ${repMin}-${repMax}) → aim for ${repMin}; use an easier variation if needed.`);
    const nw = Math.round((weight - step) * 100) / 100;
    const dw = nw > 0 ? nw : (kind === 'bodyweight' ? null : weight);
    return out('drop', dw, repMin, `Averaged ${Math.round(avg)} reps${atW} (goal ${repMin}-${repMax}) → ${dw != null ? `drop to ${fmtW(dw)}` : 'go bodyweight'} and own the range.`);
  }

  if (!fullSets || minR < repMin) {
    const why = !fullSets ? `Only ${best.length}/${nSets} sets${atW}` : `Got ${repsTxt}${atW}`;
    return out('hold', weight, repMin, `${why} → stay${weight != null ? ` at ${fmtW(weight)}` : ''}, hit ${repMin}+ on all ${nSets} sets.`);
  }

  const tgt = Math.min(repMax, minR + 1);
  return out('add_reps', weight, tgt, `Got ${repsTxt}${atW} → ${weight != null ? `keep ${fmtW(weight)}, ` : ''}aim for ${tgt}+ on every set.`);
}

// Best single set. Weighted: by e1rm. No load / timed: by reps or seconds.
// Assisted: lowest assistance among sets reaching repMin (then more reps).
function bestSet(sets, ex) {
  const unit = ex?.unit || 'each';
  const assisted = isAssisted(ex);
  const repMin = ex?.repRange?.[0] || 1;
  let best = null;
  for (const s of sets) {
    let e = 0, score;
    if (assisted) score = (s.r >= repMin ? 1e6 : 0) - (s.w || 0) * 1000 + s.r;
    else { e = unit === 'seconds' ? 0 : e1rm(s.w, s.r); score = e > 0 ? 1e6 + e : s.r; }
    if (!best || score > best.score) best = { w: s.w, r: s.r, e1rm: e > 0 ? e : null, score };
  }
  return best;
}

function recordFrom(exId, sets) {
  const ex = getEx(exId);
  const unit = ex?.unit || 'each';
  const b = bestSet(sets, ex);
  if (!b) return null;
  const type = isAssisted(ex) ? 'assisted' : b.e1rm ? 'e1rm' : unit === 'seconds' ? 'seconds' : 'reps';
  return { w: b.w, r: b.r, e1rm: b.e1rm, type, score: b.score };
}

function recordsScored(sessions) {
  const out = {};
  for (const s of chrono(sessions)) {
    const ids = new Set((s.blocks || []).filter(b => b.kind === 'lift').map(b => b.exId));
    for (const id of ids) {
      const rec = recordFrom(id, setsFor(s, id));
      if (!rec) continue;
      if (!out[id] || rec.score > out[id].score) out[id] = { ...rec, date: s.date };
    }
  }
  return out;
}

const strip = r => { const { score, ...rest } = r; return rest; };

export function personalRecords(sessions) {
  return Object.fromEntries(Object.entries(recordsScored(sessions)).map(([k, r]) => [k, strip(r)]));
}

// PRs set in `session` compared with every other session dated before it (or same day, earlier).
export function sessionPRs(session, sessions) {
  const prior = chrono((sessions || []).filter(s => s && s.id !== session.id && s.date <= session.date && (s.date < session.date || startedKey(s) < startedKey(session))));
  const prev = recordsScored(prior);
  const now = recordsScored([session]);
  const out = [];
  for (const [id, rec] of Object.entries(now)) {
    const p = prev[id];
    if (!p) continue;   // first time doing it isn't a "PR"
    if (rec.score > p.score) out.push({ exId: id, ...strip(rec), previous: strip(p) });
  }
  return out;
}

export function exerciseHistory(exId, sessions) {
  const ex = getEx(exId);
  const assisted = isAssisted(ex);
  const out = [];
  for (const s of chrono(sessions)) {
    const sets = setsFor(s, exId);
    if (!sets.length) continue;
    const b = bestSet(sets, ex);
    const volume = sets.reduce((t, x) => t + (!assisted && x.w > 0 ? x.w * x.r : x.r), 0);
    out.push({ date: s.date, sessionId: s.id || null, topSet: { w: b.w, r: b.r }, e1rm: b.e1rm, volume: Math.round(volume * 10) / 10, sets });
  }
  return out;
}
