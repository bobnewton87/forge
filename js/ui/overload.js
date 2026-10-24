// Workout set ceiling + overload (§26, UI). The one line a capped workout shows wherever it is previewed
// or started, and the "Heavy workout" warning with a one-tap trim for a workout the user built or edited.
// Advice only: nothing here ever blocks a workout. The numbers come from generator.sessionLoad /
// trimToCap and the user's ceiling from targets (via the profile), so every screen says the same thing.
// CONTRACT-NOTE (§26): loadNoteHTML(session, profile, { attr, editable }) renders '' | the heavy warning
//   (button `${attr}="trim"`) | the per-muscle warning (`${attr}="trim-m"`) | the capped line; the host
//   screen binds the button and calls trimSession(session, profile, { sessions, now, muscles }).
import { sessionLoad, trimToCap, capLine } from '../engine/generator.js';
import { SESSION_CAP_INFO } from '../engine/targets.js';
import { esc, safe, exName } from './components.js';

export function loadNoteHTML(s, profile, { attr = 'data-t', editable = true } = {}) {
  const L = safe(() => sessionLoad(s, profile), null);
  if (!L) return '';
  if (L.over) {
    return `<div class="ol-warn" role="status"><div class="grow"><b>Heavy workout: ${L.sets} working sets, your ceiling is ${L.cap}.</b>
      <div class="tiny">${esc(SESSION_CAP_INFO.short)} The ceiling is ${esc(SESSION_CAP_INFO.label)}; change it in Settings.</div></div>
      ${editable ? `<button type="button" class="btn btn-sm" ${attr}="trim">Trim to ${L.cap}</button>` : ''}</div>`;
  }
  if (L.muscles.length) {
    const m = L.muscles[0], more = L.muscles.length > 1 ? ` (and ${L.muscles.slice(1).map(x => x.name.toLowerCase()).join(', ')})` : '';
    return `<div class="ol-warn" role="status"><div class="grow"><b>${esc(m.name)}: ${m.sets} sets in one workout${esc(more)}.</b>
      <div class="tiny">Forge plans at most ${m.cap} for one muscle in one session (counting moves where it is the main mover): past that, extra sets mostly add fatigue. A convention, not a measured limit.</div></div>
      ${editable ? `<button type="button" class="btn btn-sm" ${attr}="trim-m">Trim ${esc(m.name.toLowerCase())} to ${m.cap}</button>` : ''}</div>`;
  }
  if (s?.capped && L.sets <= L.cap) {
    // recomputed from the workout as it is now (the user may have moved or swapped things since it was built)
    const est = Number(s.estMinutes) || 0, freed = Math.max(0, (Number(s.minutes) || 0) - est);
    return `<div class="ol-cap">${esc(capLine({ ...s.capped, sets: L.sets, freedMin: freed }))}</div>`;
  }
  return '';
}

// The rationale minus the capped line, for screens that show loadNoteHTML above it (no line twice).
export function rationaleWithoutCap(list = []) { return (list || []).filter(r => !/^Capped at /.test(r)); }

// → { session, msg } — the trimmed workout and a toast summarising what went.
export function trimSession(s, profile, { sessions = [], now = new Date(), muscles = false } = {}) {
  const L = sessionLoad(s, profile);
  const r = trimToCap(s, muscles ? null : L.cap, { profile, sessions, now, muscles });
  const dropped = r.removed.filter(x => x.to === 0).map(x => exName(x.exId));
  const fewer = r.removed.filter(x => x.to > 0).reduce((n, x) => n + x.from - x.to, 0);
  const after = sessionLoad(r.session, profile).sets;
  const bits = [dropped.length ? `dropped ${dropped.slice(0, 3).join(', ')}${dropped.length > 3 ? ` +${dropped.length - 3}` : ''}` : '', fewer ? `${fewer} fewer set${fewer === 1 ? '' : 's'} elsewhere` : ''].filter(Boolean);
  return { session: r.session, msg: r.removed.length ? `Trimmed to ${after} working sets: ${bits.join('; ')}` : 'Nothing to trim without touching logged sets' };
}
