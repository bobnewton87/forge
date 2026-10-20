// Measurements screen (route 'measure', UI-BODY): body profile, tape-measure log, current
// body-comp snapshot and history.
// CONTRACT-NOTE: params.edit === true opens the body-profile editor even when it is complete.
// CONTRACT-NOTE: deleting a history row removes that date's tape entry AND its weigh-in.
// CONTRACT-NOTE (Phase 3, UI-LAB): thigh/calf are logged per side (thighL/thighR/calfL/calfR); legacy
//   single `thigh`/`calf` values count as both sides for placeholders, asymmetry and history.
//   The snapshot mounts the 3D body (fallback SVG). Optional food log + adaptiveTdee status.
// CONTRACT-NOTE (§16c, ANTHRO-2): optional "Bone lengths" section logs lenUpperArmL/R, lenForearmL/R,
//   lenThighL/R, lenShankL/R (inches, bony landmarks, 4–40 in) via store.logMeasurement; placeholders show
//   the last values; the snapshot lists L/R length differences (> 0.25 in flagged, from
//   baseline.lengthAsymmetry); the 3D snapshot receives them as shape.lengths (projection.js shapeOf).
import { esc } from './components.js';
import { ds, fmtShort, addDays } from '../util.js';
import * as BC from '../engine/bodycomp.js';
import * as NU from '../engine/nutrition.js';
import { silhouetteSVG } from './silhouette.js';
import { lineChart, bindCharts, f1, safe, mount3D, body3d, supports3D, estMuscle, maintenanceEstimate, shapeOf } from './projection.js';
const baseline = a => BC.baseline(a);

export function title() { return 'Measurements'; }

const SITES = [
  { k: 'neck', label: 'Neck', tip: 'Just below the Adam\'s apple, tape level and snug. Look straight ahead, don\'t flare your neck.', req: true },
  { k: 'shoulders', label: 'Shoulders', tip: 'Around the widest point of the delts, arms relaxed at your sides. A partner makes this much easier.' },
  { k: 'chest', label: 'Chest', tip: 'Around the nipple line, under the armpits, after a normal exhale. Don\'t puff up.' },
  { k: 'waist', label: 'Waist', tip: 'At the navel, belly relaxed (don\'t suck in), after a normal exhale. Best first thing after waking.', req: true },
  { k: 'hips', label: 'Hips', tip: 'Around the widest part of the glutes, feet together.' },
  { k: 'armL', label: 'Arm L (flexed)', tip: 'Flex the biceps hard, arm out level with the shoulder. Tape around the peak, which is the biggest point.', pair: 'Arms (flexed)' },
  { k: 'armR', label: 'Arm R (flexed)', tip: 'Same as the left: flexed, arm level, around the peak.' },
  { k: 'thighL', label: 'Thigh L', tip: 'Standing relaxed, just below the glute fold (the top of the thigh), weight on both feet. Same spot on both legs.', legacy: 'thigh', pair: 'Thighs' },
  { k: 'thighR', label: 'Thigh R', tip: 'Same as the left: just below the glute fold, standing relaxed with weight on both feet.', legacy: 'thigh' },
  { k: 'calfL', label: 'Calf L', tip: 'Widest point of the calf, standing with weight on both feet.', legacy: 'calf', pair: 'Calves' },
  { k: 'calfR', label: 'Calf R', tip: 'Same as the left: widest point, standing with weight on both feet.', legacy: 'calf' },
  { k: 'forearm', label: 'Forearm', tip: 'Widest point just below the elbow, fist clenched, arm straight.' },
];
// Bone lengths (§16c): tape between bony landmarks, both sides. Optional; they sharpen the 3D model's proportions.
const LEN_HOW = ' Use a flexible (sewing) tape held straight from point to point (not wrapped around the muscle), or mark both points with a washable pen and have a partner measure. Measure twice and average; do both sides the same way.';
const LENGTHS = [
  { seg: 'UpperArm', name: 'Upper arm', short: 'U-arm', pair: 'Upper arm · shoulder → elbow',
    tip: 'Stand tall, upper arm hanging straight down, elbow bent 90° (forearm level, thumb up). From the acromion (the bony outer tip on top of the shoulder: follow the ridge of the shoulder blade outward until it ends) straight down the back of the arm to the bottom of the elbow point (olecranon).' },
  { seg: 'Forearm', name: 'Forearm', short: 'F-arm', pair: 'Forearm · elbow → wrist',
    tip: 'Keep the elbow bent 90°, forearm level, thumb up. From the point of the elbow (olecranon) along the pinky side of the forearm to the bony bump on the pinky side of the wrist (ulnar styloid).' },
  { seg: 'Thigh', name: 'Thigh length', short: 'Th-len', pair: 'Thigh · hip → knee',
    tip: 'Stand tall, weight on both feet. From the greater trochanter (the bony knob on the side of the hip, about a hand below the top of the hip bone; it rolls under your fingers when you turn the foot in and out) straight down the outside of the leg to the outer knee joint line (the soft gap between thigh bone and shin bone; easiest to find with the knee slightly bent, then stand straight).' },
  { seg: 'Shank', name: 'Lower leg', short: 'Sh-len', pair: 'Lower leg · knee → ankle',
    tip: 'Standing, from the same outer knee joint line straight down the outside of the shin to the centre of the outer ankle bone (lateral malleolus). Keep the tape straight; don\'t follow the calf curve.' },
];
const LEN_SITES = LENGTHS.flatMap(L => ['L', 'R'].map(S => ({ k: `len${L.seg}${S}`, label: `${L.name} ${S}`, short: `${L.short} ${S}`,
  tip: (S === 'L' ? L.tip : `Same as the left: ${L.tip.charAt(0).toLowerCase()}${L.tip.slice(1)}`) + LEN_HOW, pair: S === 'L' ? L.pair : null })));
const LABEL = { ...Object.fromEntries(SITES.map(s => [s.k, s.label])), ...Object.fromEntries(LEN_SITES.map(s => [s.k, s.label])), thigh: 'Thigh (both)', calf: 'Calf (both)', arm: 'Arm' };
// Latest value per site, with legacy single thigh/calf filling both sides.
function latestSites(meas) {
  const last = {};
  for (const e of meas) {
    for (const s of SITES) {
      if (e[s.k] != null) last[s.k] = e[s.k];
      else if (s.legacy && e[s.legacy] != null) last[s.k] = e[s.legacy];
    }
    for (const s of LEN_SITES) if (e[s.k] != null) last[s.k] = e[s.k];
    if (e.bodyFat != null) last.bodyFat = e.bodyFat;
  }
  return last;
}
const ACT = [['desk', 'Desk', 'Mostly sitting'], ['light', 'Light', 'On your feet some'], ['active', 'Active', 'On your feet most of the day']];
const SRC = { manual: 'scale / DEXA', navy: 'Navy tape formula', estimate: 'BMI estimate (rough)' };
let editProfile = false;
let cur3d = null;

export function ffmiScale(v) {
  if (v == null) return null;
  return v < 18 ? ['Below average', 'muted'] : v < 20 ? ['Average', 'muted'] : v < 22 ? ['Above average, athletic', 'good'] : v < 23.5 ? ['Very muscular', 'good'] : v < 25 ? ['Elite natural range', 'accent'] : ['Rare without drugs', 'warn'];
}

function profileCard(p, open) {
  const b = p.body || {};
  const ft = b.heightIn ? Math.floor(b.heightIn / 12) : '', inch = b.heightIn ? +(b.heightIn - ft * 12).toFixed(1) : '';
  const missing = !b.heightIn || !b.birthYear;
  if (!open && !missing) {
    return `<div class="card tight bd-profrow"><div class="grow"><div class="label">Body profile</div>
      <div class="small">${ft}′${inch}″ · born ${b.birthYear} · ${esc(b.sex || 'male')} · ${b.trainingMonths ?? 0} mo lifting · ${esc(b.activity || 'desk')}</div></div>
      <button class="btn btn-sm btn-ghost" data-editprof>Edit</button></div>`;
  }
  return `<div class="card ${missing ? 'bd-attn' : ''}" id="bd-prof">
    <div class="card-title">Body profile ${missing ? '<span class="badge warn">needed</span>' : ''}</div>
    <p class="small muted" style="margin-top:4px">Height and age feed BMI, FFMI, the Navy body-fat formula and your calorie burn.</p>
    <div class="grid2 mt">
      <div class="field"><label>Height (ft)</label><input type="number" inputmode="numeric" id="pFt" value="${ft}" placeholder="5"></div>
      <div class="field"><label>Height (in)</label><input type="number" inputmode="decimal" step="0.5" id="pIn" value="${inch}" placeholder="9"></div>
      <div class="field"><label>Birth year</label><input type="number" inputmode="numeric" id="pBy" value="${b.birthYear ?? ''}" placeholder="1987"></div>
      <div class="field"><label>Months lifting</label><input type="number" inputmode="numeric" id="pTm" value="${b.trainingMonths ?? ''}" placeholder="7"></div>
    </div>
    <div class="label">Sex</div>
    <div class="tabs mt" style="margin-top:6px" data-pseg="sex">${[['male', 'Male'], ['female', 'Female']].map(([v, l]) => `<button class="${(b.sex || 'male') === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="label mt">Daily activity (outside workouts)</div>
    <div class="tabs" style="margin-top:6px" data-pseg="activity">${ACT.map(([v, l]) => `<button class="${(b.activity || 'desk') === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
    <p class="tiny muted" style="margin-top:6px" id="pActHint">${esc(ACT.find(a => a[0] === (b.activity || 'desk'))[2])}</p>
    <button class="btn btn-primary btn-block mt" data-saveprof>Save profile</button>
  </div>`;
}

function formCard(meas, log) {
  const last = latestSites(meas);
  const lastW = log.length ? log[log.length - 1].w : null;
  const field = (k, label, tip, ph, req, unit = 'in') => `<div class="field bd-field">
      <label for="m-${k}">${esc(label)}${req ? ' <span class="bd-req" title="Needed for the body-fat estimate">•</span>' : ''}
        <button type="button" class="bd-i" data-tip="${k}" aria-label="How to measure ${esc(label)}">ⓘ</button></label>
      <div class="bd-inp"><input type="number" inputmode="decimal" step="0.1" id="m-${k}" data-m="${k}" placeholder="${ph != null ? +(+ph).toFixed(2) : '—'}"><span>${unit}</span></div>
      <div class="bd-tip tiny" data-tipbox="${k}" hidden>${esc(tip)}</div></div>`;
  return `<div class="card" id="bd-log">
    <div class="row between"><div class="card-title">New entry</div><input type="date" id="mDate" value="${ds()}" max="${ds()}" class="bd-date"></div>
    <p class="small muted" style="margin-top:6px">Fill in what you have. <span class="bd-req">•</span> Weight, waist and neck are enough for a body-fat estimate. Placeholders show your last values.</p>
    <div class="grid2 mt">
      ${field('weight', 'Weight', 'Morning, after the bathroom, before eating or drinking. Same scale each time.', lastW, true, 'lb')}
      ${SITES.map(s => (s.pair ? `<div class="bd-pairhead">${esc(s.pair)} · left / right</div>` : '') + field(s.k, s.label, s.tip, last[s.k], s.req)).join('')}
      <div class="bd-pairhead bd-lenhead">Bone lengths (optional, improves the 3D model)<div class="tiny muted" style="text-transform:none;letter-spacing:0;font-weight:400;margin-top:2px">Bony landmark to bony landmark, left and right. Measure once; redo only if unsure.</div></div>
      ${LEN_SITES.map(s => (s.pair ? `<div class="bd-pairhead">${esc(s.pair)} · left / right</div>` : '') + field(s.k, s.label, s.tip, last[s.k], false)).join('')}
      ${field('bodyFat', 'Body fat (optional)', 'Only if you have a reading from a smart scale, calipers or a DEXA scan. DEXA is the most accurate; smart scales swing with hydration. Leave blank to use the tape formula.', last.bodyFat, false, '%')}
    </div>
    <button class="btn btn-primary btn-block" data-savem>Save measurements</button>
  </div>`;
}

function asymNotes(meas, b) {
  const last = latestSites(meas), out = [];
  for (const [l, r, name] of [['armL', 'armR', 'arm'], ['thighL', 'thighR', 'thigh'], ['calfL', 'calfR', 'calf']]) {
    const a = last[l], b = last[r]; if (a == null || b == null) continue;
    const d = b - a, pct = Math.abs(d) / ((a + b) / 2) * 100;
    if (Math.abs(d) < 0.05) out.push(`<li><b>${name[0].toUpperCase() + name.slice(1)}s:</b> L ${+a.toFixed(2)} · R ${+b.toFixed(2)}. Even.</li>`);
    else out.push(`<li><b>${d > 0 ? 'Right' : 'Left'} ${name}</b> is ${+Math.abs(d).toFixed(2)}″ bigger (${pct.toFixed(1)}%). ${pct < 3 ? 'Under ~3% is normal.' : 'Worth evening out: start unilateral sets with the smaller side and match its reps on the other.'}</li>`);
  }
  // Bone lengths: flagged differences come from the engine (baseline.lengthAsymmetry, > 0.25 in).
  const flagged = Object.fromEntries((b?.lengthAsymmetry || []).map(a => [a.segment, a]));
  for (const L of LENGTHS) {
    const seg = L.seg[0].toLowerCase() + L.seg.slice(1), a = last[`len${L.seg}L`], r = last[`len${L.seg}R`];
    if (a == null || r == null) continue;
    const f = flagged[seg], nm = L.name.replace(' length', '').toLowerCase();
    if (f) out.push(`<li><b>${f.longer === 'right' ? 'Right' : 'Left'} ${esc(nm)} ${+Math.abs(f.diffIn).toFixed(2)} in longer</b> than ${f.longer === 'right' ? 'left' : 'right'}. ${Math.abs(f.diffIn) <= 0.4 ? 'Up to ~0.4 in is common and within tape error; re-measure twice to confirm.' : 'Re-measure both sides twice; if it holds, the 3D model shows it.'}</li>`);
    else out.push(`<li><b>${esc(L.name.replace(' length', ''))} length:</b> L ${+a.toFixed(2)} · R ${+r.toFixed(2)}. Even (within tape error).</li>`);
  }
  return out.length ? `<div class="bd-asym"><div class="label">Left vs right</div><ul style="margin-top:4px">${out.join('')}</ul></div>` : '';
}

function snapshot(b, meas = []) {
  if (!b || !b.weightLb) return `<div class="card"><div class="empty" style="padding:16px"><div class="big">📏</div><h3>No snapshot yet</h3><p>Log your weight (plus waist and neck) above to see body fat, lean mass and your ratios.</p></div></div>`;
  const c = b.comp || {}, m = b.measurements || {}, r = b.ratios || {};
  const ff = ffmiScale(c.ffmiNormalized ?? c.ffmi);
  const sw = r.shoulderToWaist;
  const swPct = sw ? Math.min(100, ((sw - 1.2) / (1.75 - 1.2)) * 100) : 0;
  const goldPct = ((1.618 - 1.2) / (1.75 - 1.2)) * 100;
  const wh = r.waistToHeight;
  const tile = (v, unit, l, sub = '') => `<div class="stat"><div class="v">${v ?? '—'}${v != null && unit ? `<small>${unit}</small>` : ''}</div><div class="l">${l}</div>${sub ? `<div class="tiny muted" style="margin-top:2px">${sub}</div>` : ''}</div>`;
  const miss = (b.missingInfo || []).filter(x => x.field !== 'weight');
  return `<div class="card hero bd-snap">
    <div class="row bd-snaprow" style="align-items:flex-start;gap:12px">
      <div class="bd-snap-sil" id="msFig">${silhouetteSVG(m, { bodyFatPct: b.bodyFatPct, heightIn: b.heightIn || 69 })}</div>
      <div class="grow">
        <div class="label">Current · ${fmtShort(b.weightDate || b.date)}</div>
        <div class="bd-big num">${f1(b.weightLb)}<small> lb</small></div>
        <div class="bd-big num" style="color:var(--accent2)">${b.bodyFatPct != null ? f1(b.bodyFatPct) + '<small>% fat</small>' : '<small>body fat ?</small>'}</div>
        <div class="tiny muted">${b.bodyFatSource ? 'from ' + esc(SRC[b.bodyFatSource] || b.bodyFatSource) : 'add waist + neck + height'}${b.bodyFatSource === 'manual' && b.navyBodyFatPct ? ` · tape says ${f1(b.navyBodyFatPct)}%` : ''}</div>
        <div class="grid2 mt" style="gap:8px">
          ${tile(c.leanLb != null ? f1(c.leanLb) : null, 'lb', 'Lean mass')}
          ${tile(c.fatLb != null ? f1(c.fatLb) : null, 'lb', 'Fat mass')}
        </div>
      </div>
    </div>
    <div class="grid2 mt">
      ${tile(c.ffmiNormalized != null ? f1(c.ffmiNormalized) : c.ffmi != null ? f1(c.ffmi) : null, '', 'FFMI', ff ? `<span style="color:var(--${ff[1] === 'muted' ? 'muted' : ff[1]})">${ff[0]}</span>` : 'needs height + BF')}
      ${tile(c.bmi != null ? f1(c.bmi) : null, '', 'BMI', c.bmi != null ? 'Overstates fat in muscular people' : 'needs height')}
    </div>
    <div class="bd-ratio mt">
      <div class="row between"><div class="label">Shoulder : waist</div><div class="num bold">${sw ? sw.toFixed(2) : '—'} <span class="muted small" style="font-weight:600">/ 1.618 ideal</span></div></div>
      <div class="bar mt" style="margin-top:8px"><i style="width:${swPct}%;background:linear-gradient(90deg,var(--accent2),var(--accent))"></i><span class="tick" style="left:${goldPct}%"></span></div>
      <div class="tiny muted" style="margin-top:6px">${sw ? (sw >= 1.618 ? 'At the "Adonis" golden ratio. 👑' : sw >= 1.5 ? 'Clear V-taper. Wider delts + a smaller waist close the gap.' : 'Side delts and lats widen the top; dropping fat shrinks the waist.') : 'Measure shoulders and waist to see your V-taper.'}</div>
    </div>
    <div class="row between mt"><div class="label">Waist : height</div><div class="num bold">${wh ? wh.toFixed(2) : '—'} <span class="small" style="font-weight:600;color:${wh == null ? 'var(--muted)' : wh < 0.45 ? 'var(--good)' : wh < 0.5 ? 'var(--accent2)' : 'var(--warn)'}">${wh == null ? '' : wh < 0.45 ? 'lean' : wh < 0.5 ? 'healthy' : 'above 0.5'}</span></div></div>
    ${asymNotes(meas, b)}
    ${miss.length ? `<div class="bd-miss mt"><div class="label">Missing for better accuracy</div><ul>${miss.map(x => `<li><b>${esc(x.label)}</b> <span class="muted">${esc(x.why)}</span></li>`).join('')}</ul></div>` : ''}
  </div>`;
}

function avgLR(e, k) {
  const l = e[k + 'L'], r = e[k + 'R'];
  return l != null && r != null ? (l + r) / 2 : l ?? r ?? e[k] ?? null;
}
function history(meas, log) {
  const series = [['weight', 'Weight', 'lb', log.map(e => ({ d: e.d, v: e.w }))],
    ...['waist', 'neck', 'shoulders', 'chest', 'arm', 'thigh', 'hips', 'forearm', 'calf', 'bodyFat'].map(k => [k, ({ arm: 'Arms (avg)', thigh: 'Thighs (avg)', calf: 'Calves (avg)', bodyFat: 'Body fat' })[k] || LABEL[k], k === 'bodyFat' ? '%' : 'in',
      meas.map(e => ({ d: e.d, v: ['arm', 'thigh', 'calf'].includes(k) ? avgLR(e, k) : e[k] })).filter(x => x.v != null)])];
  const has = series.filter(s => s[3].length);
  if (!has.length) return '<p class="small muted">Nothing logged yet. Measure every 2-4 weeks, same time of day, same conditions.</p>';
  const charts = has.map(([k, label, unit, pts]) => {
    const first = pts[0].v, lastv = pts[pts.length - 1].v, d = +(lastv - first).toFixed(1);
    const goodDown = k === 'waist' || k === 'bodyFat' || k === 'hips';
    const col = !d ? 'var(--muted)' : k === 'weight' ? 'var(--muted)' : (d < 0) === goodDown ? 'var(--good)' : 'var(--warn)';
    return `<div class="bd-sparkcard"><div class="row between"><div class="tiny muted bold">${esc(label)}</div><div class="tiny num" style="color:${col}">${pts.length > 1 ? (d > 0 ? '+' : '') + f1(d) : ''}</div></div>
      <div class="num bold">${f1(lastv)}<small class="muted"> ${unit}</small></div>
      ${pts.length > 1 ? lineChart({ id: 'h-' + k, data: pts.map(p => ({ d: p.d, v: p.v })), W: 160, H: 50, mini: true, unit }) : '<div class="tiny muted" style="height:34px;padding-top:10px">1 entry</div>'}</div>`;
  }).join('');
  const dates = [...new Set([...meas.map(e => e.d), ...log.map(e => e.d)])].sort().reverse();
  const wBy = Object.fromEntries(log.map(e => [e.d, e.w]));
  const mBy = Object.fromEntries(meas.map(e => [e.d, e]));
  const cols = ['neck', 'shoulders', 'chest', 'waist', 'hips', 'armL', 'armR', 'thighL', 'thighR', 'thigh', 'calfL', 'calfR', 'calf', 'forearm', 'bodyFat', ...LEN_SITES.map(s => s.k)];
  const used = cols.filter(c => meas.some(e => e[c] != null));
  const lenShort = Object.fromEntries(LEN_SITES.map(s => [s.k, s.short]));
  const head = ['Wt', ...used.map(c => ({ armL: 'Arm L', armR: 'Arm R', thighL: 'Thigh L', thighR: 'Thigh R', calfL: 'Calf L', calfR: 'Calf R', thigh: 'Thigh', calf: 'Calf', bodyFat: 'BF%', ...lenShort }[c] || LABEL[c]))];
  const rows = dates.map(d => `<tr><th>${fmtShort(d)}<div class="tiny muted">${d.slice(0, 4)}</div></th><td>${wBy[d] != null ? f1(wBy[d]) : ''}</td>${used.map(c => `<td>${mBy[d]?.[c] != null ? f1(mBy[d][c]) : ''}</td>`).join('')}<td><button class="bd-del" data-del="${d}" aria-label="Delete ${d}">✕</button></td></tr>`).join('');
  return `<div class="bd-sparks">${charts}</div>
    <div class="section-title">All entries</div>
    <div class="card bd-tablewrap" style="padding:0"><table class="bd-table num"><thead><tr><th>Date</th>${head.map(h => `<th>${esc(h)}</th>`).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------------- food log + adaptive TDEE ----------------
function tdeeStatus(store, p, b, log, food) {
  const now = new Date(), from = ds(addDays(now, -42)), to = ds(now);
  const formula = safe(() => maintenanceEstimate(store)?.formula, null) ?? safe(() => BC.tdee({ comp: b?.comp, activity: p.body?.activity || 'desk', sessions: store.getSessions(), from: ds(addDays(now, -14)), to, now })?.total, null);
  const r = typeof NU.adaptiveTdee === 'function' ? safe(() => NU.adaptiveTdee({ bodyLog: log, foodLog: food, from, to }), null) : null;
  if (r && r.tdee) {
    return `<div class="bd-tdee">Your measured TDEE: <b class="num">${Math.round(r.tdee).toLocaleString()} kcal</b>${formula ? ` <span class="muted">(formula said ${Math.round(formula).toLocaleString()})</span>` : ''}
      <div class="tiny muted" style="margin-top:4px">${r.confidence ? `${esc(r.confidence)} confidence` : ''}${r.note ? `${r.confidence ? ' · ' : ''}${esc(r.note)}` : r.days ? ` · ${r.days} days` : ''}</div></div>`;
  }
  const fd = new Set(food.filter(e => e.d >= from && e.d <= to && e.kcal > 0).map(e => e.d));
  const wd = new Set(log.filter(e => e.d >= from && e.d <= to).map(e => e.d));
  const n = Math.min(fd.size, wd.size);
  return `<div class="bd-tdee">Need <b>10+ days</b> of weigh-ins and food logs to calibrate your real burn rate. <b class="num">${Math.min(n, 10)}/10</b> so far${formula ? ` · formula estimate ${Math.round(formula).toLocaleString()} kcal` : ''}.
    <div class="bar"><i style="width:${Math.min(100, n * 10)}%;background:var(--cardio)"></i></div>
    <div class="tiny muted" style="margin-top:6px">${fd.size} food day${fd.size === 1 ? '' : 's'} and ${wd.size} weigh-in${wd.size === 1 ? '' : 's'} in the last 6 weeks. Rough logs are fine; consistency beats precision.</div></div>`;
}
function foodCard(store, p, b, log) {
  const food = safe(() => store.getFoodLog(), []);
  const rows = [...food].reverse().slice(0, 10).map(e => `<tr><th>${fmtShort(e.d)}</th><td>${e.kcal != null ? Math.round(e.kcal).toLocaleString() : ''}</td><td>${e.protein ?? ''}</td><td>${e.carbs ?? ''}</td><td>${e.fat ?? ''}</td><td><button class="bd-del" data-fdel="${e.d}" aria-label="Delete food ${e.d}">✕</button></td></tr>`).join('');
  const inp = (id, label, ph, unit) => `<div class="field bd-field"><label for="${id}">${label}</label><div class="bd-inp"><input type="number" inputmode="numeric" id="${id}" placeholder="${ph}"><span>${unit}</span></div></div>`;
  return `<div class="card bd-food" id="bd-food">
    <div class="row between"><div class="card-title">Daily intake</div><input type="date" id="fDate" value="${ds()}" max="${ds()}" class="bd-date"></div>
    <p class="small muted" style="margin-top:6px">Log a day's totals from any tracker. With your weigh-ins, Forge works out what you really burn instead of guessing.</p>
    <div class="grid2 mt">${inp('fKcal', 'Calories', '2600', 'kcal')}${inp('fP', 'Protein', '165', 'g')}${inp('fC', 'Carbs (opt.)', '—', 'g')}${inp('fF', 'Fat (opt.)', '—', 'g')}</div>
    <button class="btn btn-primary btn-block" data-savefood>Save day</button>
    ${tdeeStatus(store, p, b, log, food)}
    ${rows ? `<div class="bd-tablewrap mt"><table class="bd-table num"><thead><tr><th>Date</th><th>kcal</th><th>P</th><th>C</th><th>F</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
  </div>`;
}

export function render(ctx, params = {}) {
  const store = ctx.store;
  const p = store.getProfile();
  const meas = safe(() => store.getMeasurements(), []);
  const log = safe(() => store.getBodyLog(), []);
  const b = safe(() => baseline({ profile: p, bodyLog: log, measurements: meas, now: new Date() }), null);
  const open = editProfile || params.edit === true;
  const H = b?.heightIn || 69;
  cur3d = b && b.weightLb ? { shape: shapeOf({ shape: b.shape, measurements: b.measurements }, H), muscle: b.muscle || estMuscle({ leanLb: b.comp?.leanLb }, H), bodyFatPct: b.bodyFatPct ?? null } : null;
  return `<div class="page-head"><p class="sub">Where you're starting, measured properly.</p></div>
    ${profileCard(p, open)}
    <div class="section-title">Snapshot <button class="link" data-nav="projection">Projection ›</button></div>
    ${snapshot(b, meas)}
    <div class="section-title">Log measurements</div>
    ${formCard(meas, log)}
    <div class="section-title">History</div>
    ${history(meas, log)}
    <div class="section-title">Food log <span class="tiny muted" style="text-transform:none;letter-spacing:0">optional</span></div>
    ${foodCard(store, p, b, log)}`;
}

export function bind(root, ctx) {
  const store = ctx.store;
  root.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => ctx.nav(b.dataset.nav));
  root.querySelector('[data-editprof]')?.addEventListener('click', () => { editProfile = true; ctx.rerender(); });

  // profile
  const prof = root.querySelector('#bd-prof');
  if (prof) {
    const segVal = {};
    prof.querySelectorAll('[data-pseg]').forEach(seg => seg.querySelectorAll('button').forEach(btn => btn.onclick = () => {
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === btn));
      segVal[seg.dataset.pseg] = btn.dataset.v;
      if (seg.dataset.pseg === 'activity') prof.querySelector('#pActHint').textContent = ACT.find(a => a[0] === btn.dataset.v)[2];
    }));
    prof.querySelector('[data-saveprof]').onclick = () => {
      const ft = parseFloat(prof.querySelector('#pFt').value), inch = parseFloat(prof.querySelector('#pIn').value) || 0;
      const by = parseInt(prof.querySelector('#pBy').value, 10), tm = parseFloat(prof.querySelector('#pTm').value);
      const yr = new Date().getFullYear();
      const cur = store.getProfile().body || {};
      const body = { ...cur, ...segVal };
      if (ft > 0) {
        const h = ft * 12 + inch;
        if (h < 48 || h > 90) { ctx.toast('Height looks off'); return; }
        body.heightIn = Math.round(h * 2) / 2;
      }
      if (by) { if (by < yr - 100 || by > yr - 12) { ctx.toast('Birth year looks off'); return; } body.birthYear = by; }
      if (tm >= 0 && tm < 600) body.trainingMonths = tm;
      editProfile = false;
      store.updateProfile({ body });
      ctx.toast('Profile saved');
    };
  }

  // tips
  root.querySelectorAll('[data-tip]').forEach(btn => btn.onclick = e => {
    e.preventDefault();
    const box = root.querySelector(`[data-tipbox="${btn.dataset.tip}"]`); if (box) box.hidden = !box.hidden;
  });

  // save measurements
  root.querySelector('[data-savem]')?.addEventListener('click', () => {
    const d = root.querySelector('#mDate').value || ds();
    if (d > ds()) { ctx.toast('Date is in the future'); return; }
    const vals = {};
    let bad = null;
    root.querySelectorAll('[data-m]').forEach(inp => {
      const v = parseFloat(inp.value); if (!(v > 0)) return;
      const k = inp.dataset.m;
      const [lo, hi] = k === 'weight' ? [70, 600] : k === 'bodyFat' ? [2, 60] : k.startsWith('len') ? [4, 40] : [5, 80];
      if (v < lo || v > hi) bad = bad || k; else vals[k] = v;
    });
    if (bad) { ctx.toast(`${bad === 'weight' ? 'Weight' : LABEL[bad] || 'Body fat'} looks off`); return; }
    if (!Object.keys(vals).length) { ctx.toast('Enter at least one value'); return; }
    if (document.activeElement) document.activeElement.blur();
    const { weight, ...rest } = vals;
    const n = Object.keys(vals).length;
    if (weight) store.logBodyweight(d, weight);
    if (Object.keys(rest).length) store.logMeasurement({ d, ...rest });
    ctx.toast(`Saved ${n} value${n === 1 ? '' : 's'} for ${fmtShort(d)}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // delete rows
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Delete?'; b.classList.add('armed'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '✕'; b.classList.remove('armed'); } }, 3000); return; }
    const d = b.dataset.del;
    store.deleteMeasurement(d); store.deleteBodyweight(d);
    ctx.toast(`Deleted ${fmtShort(d)}`);
  });
  // food log
  root.querySelector('[data-savefood]')?.addEventListener('click', () => {
    const d = root.querySelector('#fDate').value || ds();
    if (d > ds()) { ctx.toast('Date is in the future'); return; }
    const g = id => { const v = parseFloat(root.querySelector(id).value); return v >= 0 ? v : null; };
    const kcal = g('#fKcal'), protein = g('#fP'), carbs = g('#fC'), fat = g('#fF');
    if (!(kcal >= 500 && kcal <= 10000)) { ctx.toast('Enter calories (500–10,000)'); return; }
    if (protein != null && protein > 600) { ctx.toast('Protein looks off'); return; }
    if (document.activeElement) document.activeElement.blur();
    const e = { d, kcal: Math.round(kcal) }; if (protein != null) e.protein = Math.round(protein); if (carbs != null) e.carbs = Math.round(carbs); if (fat != null) e.fat = Math.round(fat);
    store.logFood(e);
    ctx.toast(`Saved ${Math.round(kcal).toLocaleString()} kcal for ${fmtShort(d)}`);
  });
  root.querySelectorAll('[data-fdel]').forEach(b => b.onclick = () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Delete?'; b.classList.add('armed'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '✕'; b.classList.remove('armed'); } }, 3000); return; }
    store.deleteFood(b.dataset.fdel); ctx.toast(`Deleted food log for ${fmtShort(b.dataset.fdel)}`);
  });

  // 3D snapshot of the current body
  const fig = root.querySelector('#msFig');
  if (fig && cur3d) {
    body3d().then(() => {
      if (!fig.isConnected || !supports3D()) return;
      fig.closest('.bd-snap')?.classList.add('has3d');
      mount3D('measure', root, fig, { ...cur3d, height: 320, showPoses: true, label: 'Now' });
    });
  }
  bindCharts(root);
}
