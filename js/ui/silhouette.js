// Stylized front-view physique silhouette (UI-BODY). Pure string builder, no DOM access.
// Proportions come from tape measurements (inches) scaled to height; body fat controls how much
// muscle separation shows. Missing measurements fall back to typical male / female proportions.
//
// silhouetteSVG(measurements, { bodyFatPct, heightIn, label, compare, cls, id, sex })
//   measurements: { neck, shoulders, chest, waist, hips, arm | armL/armR, forearm, thigh, calf }
//   compare: optional { measurements, bodyFatPct } drawn as a faint dashed "now" outline behind.
//   sex (CONTRACT §21): 'male' | 'female'; default measurements.sex, else the stored profile.body.sex, else male.
//   Female: chest = bust, waist = natural waist; narrower shoulders, bust and under-bust curve, natural waist above
//   the navel, wider hips (heights from anthro's ANSUR II female table), a hair bun, softer definition (abs show
//   ≈ 7 points of body fat higher than in men).
import { store } from '../store.js';

const DEF = { neck: 15, shoulders: 46, chest: 39, waist: 33, hips: 37, arm: 13, forearm: 11, thigh: 22, calf: 14.5 };
const RANGE = { neck: [11, 22], shoulders: [36, 64], chest: [30, 56], waist: [24, 54], hips: [28, 56], arm: [9, 22], forearm: [8, 17], thigh: [15, 34], calf: [11, 21] };
const DEF_F = { neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, arm: 11.5, forearm: 9.5, thigh: 22, calf: 14 };
const RANGE_F = { neck: [9.5, 19], shoulders: [30, 58], chest: [26, 58], waist: [20, 58], hips: [28, 66], arm: [7.5, 21], forearm: [7, 16], thigh: [14, 38], calf: [10, 22] };
function sexFor(measurements, sex) {
  let v = sex ?? measurements?.sex;
  if (v == null) { try { v = store.getProfile()?.body?.sex; } catch (e) { v = null; } }
  return v === 'female' ? 'female' : 'male';
}
const num = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
let uidN = 0;

// CONTRACT §21b: sites the user has not measured are sized from height AND (when known) body weight, exactly as
// anthro.fillGirths does — girth² ∝ cross-section ∝ weight / height. Without the weight a 300 lb profile with no
// tape drew the median outline. Returns null (keep the old height-only defaults) when no weight is known.
function weightScale(weightLb, heightIn, refW, refH) {
  const w = num(weightLb);
  return w ? Math.sqrt((w / refW) / (heightIn / refH)) : null;
}
export function normalizeMeasurements(m = {}, heightIn = 69, sex = 'male', weightLb = null) {
  m = m || {};
  const arm = num(m.arm) ?? (num(m.armL) && num(m.armR) ? (m.armL + m.armR) / 2 : num(m.armL) ?? num(m.armR));
  const raw = { ...m, arm };
  const W = num(weightLb) ?? num(m.weightLb);
  const out = {};
  if (sex === 'female') {
    const hs = heightIn / 64, ws = weightScale(W, heightIn, 140, 64);
    for (const k of Object.keys(DEF_F)) {
      const v = num(raw[k]);
      out[k] = clamp(v ?? DEF_F[k] * (ws ?? (k === 'neck' || k === 'arm' || k === 'forearm' ? 1 : Math.sqrt(hs))), ...RANGE_F[k]);
    }
    if (!num(raw.chest) && num(raw.shoulders)) out.chest = clamp(out.shoulders * 0.87, ...RANGE_F.chest);
    if (!num(raw.shoulders) && num(raw.chest)) out.shoulders = clamp(out.chest * 1.15, ...RANGE_F.shoulders);
    if (!num(raw.hips) && num(raw.waist)) out.hips = clamp(Math.max(out.waist * 1.3, 34), ...RANGE_F.hips);
    out.shoulders = Math.max(out.shoulders, out.chest * 0.98);
    return out;
  }
  const hs = heightIn / 69, ws = weightScale(W, heightIn, 164, 69);   // typical girths scale with height and weight
  for (const k of Object.keys(DEF)) {
    const v = num(raw[k]);
    out[k] = clamp(v ?? DEF[k] * (ws ?? (k === 'neck' || k === 'arm' || k === 'forearm' ? 1 : Math.sqrt(hs))), ...RANGE[k]);
  }
  // keep the frame coherent when only some sites are known
  if (!num(raw.chest) && num(raw.shoulders)) out.chest = clamp(out.shoulders * 0.85, ...RANGE.chest);
  if (!num(raw.shoulders) && num(raw.chest)) out.shoulders = clamp(out.chest * 1.18, ...RANGE.shoulders);
  if (!num(raw.hips) && num(raw.waist)) out.hips = clamp(Math.max(out.waist * 1.04, 34), ...RANGE.hips);
  out.chest = Math.max(out.chest, out.waist * 0.92);
  out.shoulders = Math.max(out.shoulders, out.chest * 1.04);
  return out;
}

// ---------- geometry ----------
function body(m, H) {
  const f = y => y * H;                      // fraction of height → inches from the top
  const sh = m.shoulders / 2.5 / 2;          // half shoulder width incl. delts
  const ch = m.chest / 2.95 / 2;             // half torso width at the armpits
  const wa = m.waist / 2.8 / 2;
  const hp = m.hips / 3.0 / 2;
  const nk = m.neck / 3.3 / 2;
  const armW = m.arm / 2.75, faW = m.forearm / 2.9, thW = m.thigh / 3.15, caW = m.calf / 3.1;
  const lat = Math.max(ch + 0.25, Math.min(sh - 1.4, ch + (sh - ch) * 0.35));

  // ---- arm: axis + half widths, angled slightly out (A-pose) ----
  const sj = { x: sh - armW * 0.5, y: f(0.193) };
  const elbow = { x: sj.x + 2.5 + armW * 0.12, y: f(0.385) };
  const wrist = { x: elbow.x + 2.3, y: f(0.485) };
  const tip = { x: wrist.x + 1.0, y: f(0.57) };
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const ax = [  // [point, outerHalf, innerHalf]
    [lerp(sj, elbow, 0.0), armW * 0.55, armW * 0.40],
    [lerp(sj, elbow, 0.2), armW * 0.62, armW * 0.46],     // delt cap
    [lerp(sj, elbow, 0.5), armW * 0.48, armW * 0.54],     // biceps bulges inward
    [lerp(sj, elbow, 0.8), armW * 0.40, armW * 0.40],
    [elbow, armW * 0.39, armW * 0.33],
    [lerp(elbow, wrist, 0.22), faW * 0.55, faW * 0.47],
    [lerp(elbow, wrist, 0.6), faW * 0.42, faW * 0.37],
    [wrist, faW * 0.32, faW * 0.29],
    [lerp(wrist, tip, 0.3), 0.78, 0.66],
    [lerp(wrist, tip, 0.72), 0.6, 0.5],
  ];
  const nrm = (i) => {
    const a = ax[Math.max(0, i - 1)][0], b = ax[Math.min(ax.length - 1, i + 1)][0];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: dy / l, y: -dx / l };   // outward (right) normal
  };
  const outer = ax.map(([p, ho], i) => { const n = nrm(i); return { x: p.x + n.x * ho, y: p.y + n.y * ho }; });
  const inner = ax.map(([p, , hi], i) => { const n = nrm(i); return { x: p.x - n.x * hi, y: p.y - n.y * hi }; });

  // ---- leg axis ----
  const hipJ = { x: Math.max(2.6, hp * 0.52), y: f(0.49) };
  const knee = { x: hipJ.x + 0.25, y: f(0.715) };
  const ankle = { x: knee.x + 0.35, y: f(0.955) };

  // torso side (armpit → hips); the inner arm edge is cut where it meets it so the outline never loops
  const torso = [{ x: ch, y: f(0.262) }, { x: lat, y: f(0.29) }, { x: (lat + wa) / 2 + 0.05, y: f(0.345) },
    { x: wa, y: f(0.405) }, { x: (wa + hp) / 2 + 0.1, y: f(0.445) }, { x: hp, y: f(0.48) }];
  const torsoX = y => {
    if (y <= torso[0].y) return ch;
    for (let i = 1; i < torso.length; i++) if (y <= torso[i].y) { const a = torso[i - 1], b = torso[i]; return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y); }
    return hp;
  };
  const armpit = [];
  { const up = inner.slice(1).reverse(); let cut = null;
    for (let i = 0; i < up.length; i++) {
      const p = up[i];
      if (p.x > torsoX(p.y) + 0.25 && p.y > f(0.235)) { armpit.push(p); continue; }
      const prev = up[i - 1] || p; const yc = Math.max(f(0.245), (prev.y + p.y) / 2 - 0.3);
      cut = { x: torsoX(yc) + 0.05, y: yc, c: true }; break;
    }
    armpit.push(cut || { x: ch + 0.15, y: f(0.245), c: true }); }
  const pts = [
    // head (top center → right side → jaw)
    { x: 0, y: 0.1, c: false }, { x: 2.6, y: 0.6 }, { x: 3.25, y: 2.6 }, { x: 3.15, y: 5.0 },
    { x: 2.8, y: 6.9 }, { x: 2.35, y: 8.2 }, { x: Math.max(1.9, nk * 0.92), y: 9.3 },
    // neck → traps → delt cap
    { x: nk, y: f(0.146) }, { x: nk + 1.0, y: f(0.159) }, { x: sh - 2.5, y: f(0.17) },
    { x: sh - 0.8, y: f(0.179) }, { x: sh + 0.05, y: f(0.2) },
    // outer arm (skip first: delt cap covers it)
    ...outer.slice(1),
    { x: tip.x + 0.15, y: tip.y + 0.1 },
    ...armpit,
    ...torso.filter(p => p.y > armpit[armpit.length - 1].y + 0.4),
    // outer leg
    { x: Math.min(hp + 0.4, Math.max(hp, hipJ.x + thW * 0.5)), y: f(0.52) },
    { x: hipJ.x + thW * 0.47, y: f(0.585) }, { x: knee.x + thW * 0.33, y: f(0.665) },
    { x: knee.x + caW * 0.4, y: f(0.715) }, { x: knee.x + caW * 0.5, y: f(0.775) },
    { x: ankle.x + caW * 0.34, y: f(0.87) }, { x: ankle.x + 0.62, y: f(0.952) },
    // foot
    { x: ankle.x + 1.05, y: f(0.982) }, { x: ankle.x + 1.15, y: H - 0.25 }, { x: ankle.x + 0.7, y: H, c: true }, { x: ankle.x - 0.65, y: H, c: true },
    { x: ankle.x - 0.85, y: f(0.968) },
    // inner leg back up
    { x: ankle.x - 0.62, y: f(0.94) }, { x: ankle.x - caW * 0.3, y: f(0.86) }, { x: knee.x - caW * 0.52, y: f(0.77) },
    { x: knee.x - caW * 0.4, y: f(0.72) }, { x: knee.x - thW * 0.33, y: f(0.66) },
    { x: hipJ.x - thW * 0.45, y: f(0.565) }, { x: 0.18, y: f(0.505), c: true },
  ];
  return { pts, sh, ch, wa, hp, nk, lat, sj, elbow, wrist, armW, faW, thW, caW, hipJ, knee, ankle, inner, outer, f };
}

// Female outline (front view). Breadths from girth ÷ (girth / breadth) ratios of the [AN2F] medians (bust ≈ 3.15,
// ribcage ≈ 2.85, natural waist ≈ 2.9, hips ≈ 2.85); heights from anthro's ANSUR II female table (natural waist
// 0.628 H, hips 0.512 H, bust point 0.719 H, under-bust ≈ 0.672 H), mapped onto this drawing's stylized frame.
function bodyF(m, H) {
  const f = y => y * H;
  const sh = m.shoulders / 2.55 / 2;          // half shoulder width incl. delts (narrower frame, less deltoid)
  const bust = m.chest / 3.15 / 2;            // half width across the bust
  const rib = m.chest * 0.87 / 2.85 / 2;      // under-bust (ribcage) half width; under-bust ≈ 0.87 × bust (anthro)
  const wa = m.waist / 2.9 / 2;
  const hp = m.hips / 2.85 / 2;
  const nk = m.neck / 3.3 / 2;
  const armW = m.arm / 2.8, faW = m.forearm / 2.95, thW = m.thigh / 3.0, caW = m.calf / 3.1;
  const ch = Math.max(rib + 0.2, bust - 0.15);  // torso half width at the armpits

  const sj = { x: sh - armW * 0.55, y: f(0.196) };
  const elbow = { x: sj.x + 2.1 + armW * 0.12, y: f(0.384) };
  const wrist = { x: elbow.x + 2.6, y: f(0.481) };             // larger carrying angle
  const tip = { x: wrist.x + 1.0, y: f(0.566) };
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const ax = [
    [lerp(sj, elbow, 0.0), armW * 0.55, armW * 0.42],
    [lerp(sj, elbow, 0.2), armW * 0.58, armW * 0.46],
    [lerp(sj, elbow, 0.5), armW * 0.5, armW * 0.5],
    [lerp(sj, elbow, 0.8), armW * 0.42, armW * 0.4],
    [elbow, armW * 0.38, armW * 0.33],
    [lerp(elbow, wrist, 0.22), faW * 0.52, faW * 0.46],
    [lerp(elbow, wrist, 0.6), faW * 0.42, faW * 0.37],
    [wrist, faW * 0.31, faW * 0.28],
    [lerp(wrist, tip, 0.3), 0.72, 0.6],
    [lerp(wrist, tip, 0.72), 0.55, 0.46],
  ];
  const nrm = (i) => {
    const a = ax[Math.max(0, i - 1)][0], b = ax[Math.min(ax.length - 1, i + 1)][0];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: dy / l, y: -dx / l };
  };
  const outer = ax.map(([p, ho], i) => { const n = nrm(i); return { x: p.x + n.x * ho, y: p.y + n.y * ho }; });
  const inner = ax.map(([p, , hi], i) => { const n = nrm(i); return { x: p.x - n.x * hi, y: p.y - n.y * hi }; });

  const hipJ = { x: Math.max(2.5, hp * 0.53), y: f(0.483) };
  const knee = { x: hipJ.x - 0.1, y: f(0.713) };                // knees closer together (valgus)
  const ankle = { x: knee.x + 0.3, y: f(0.958) };

  // torso side: armpit → bust → under-bust → natural waist → high hip → hips
  const torso = [{ x: ch, y: f(0.262) }, { x: bust, y: f(0.285) }, { x: (bust + rib) / 2 - 0.05, y: f(0.318) },
    { x: rib, y: f(0.336) }, { x: wa, y: f(0.372) }, { x: wa * 0.35 + hp * 0.65, y: f(0.43) }, { x: hp, y: f(0.488) }];
  const torsoX = y => {
    if (y <= torso[0].y) return ch;
    for (let i = 1; i < torso.length; i++) if (y <= torso[i].y) { const a = torso[i - 1], b = torso[i]; return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y); }
    return hp;
  };
  const armpit = [];
  { const up = inner.slice(1).reverse(); let cut = null;
    for (let i = 0; i < up.length; i++) {
      const p = up[i];
      if (p.x > torsoX(p.y) + 0.25 && p.y > f(0.235)) { armpit.push(p); continue; }
      const prev = up[i - 1] || p; const yc = Math.max(f(0.245), (prev.y + p.y) / 2 - 0.3);
      cut = { x: torsoX(yc) + 0.05, y: yc, c: true }; break;
    }
    armpit.push(cut || { x: ch + 0.15, y: f(0.245), c: true }); }
  const k = 0.94;   // head ≈ 0.94 × the male drawing's (ANSUR II head height 8.6 vs 9.1 in), a little narrower
  const pts = [
    { x: 0, y: 0.1 * k, c: false }, { x: 2.45, y: 0.6 * k }, { x: 3.05, y: 2.6 * k }, { x: 2.95, y: 5.0 * k },
    { x: 2.55, y: 6.9 * k }, { x: 2.0, y: 8.2 * k }, { x: Math.max(1.65, nk * 0.92), y: 9.3 * k },
    { x: nk, y: f(0.148) }, { x: nk + 0.9, y: f(0.162) }, { x: sh - 2.2, y: f(0.175) },
    { x: sh - 0.7, y: f(0.186) }, { x: sh + 0.02, y: f(0.205) },
    ...outer.slice(1),
    { x: tip.x + 0.15, y: tip.y + 0.1 },
    ...armpit,
    ...torso.filter(p => p.y > armpit[armpit.length - 1].y + 0.4),
    { x: Math.min(hp + 0.3, Math.max(hp, hipJ.x + thW * 0.5)), y: f(0.52) },
    { x: hipJ.x + thW * 0.5, y: f(0.575) }, { x: knee.x + thW * 0.36, y: f(0.66) },
    { x: knee.x + caW * 0.38, y: f(0.713) }, { x: knee.x + caW * 0.48, y: f(0.775) },
    { x: ankle.x + caW * 0.32, y: f(0.87) }, { x: ankle.x + 0.55, y: f(0.952) },
    { x: ankle.x + 0.95, y: f(0.982) }, { x: ankle.x + 1.05, y: H - 0.25 }, { x: ankle.x + 0.62, y: H, c: true }, { x: ankle.x - 0.6, y: H, c: true },
    { x: ankle.x - 0.78, y: f(0.968) },
    { x: ankle.x - 0.56, y: f(0.94) }, { x: ankle.x - caW * 0.3, y: f(0.86) }, { x: knee.x - caW * 0.5, y: f(0.77) },
    { x: knee.x - caW * 0.38, y: f(0.72) }, { x: knee.x - thW * 0.3, y: f(0.66) },
    { x: hipJ.x - thW * 0.42, y: f(0.56) }, { x: 0.15, y: f(0.505), c: true },
  ];
  return { pts, sh, ch, wa, hp, nk, lat: ch, bust, rib, sj, elbow, wrist, armW, faW, thW, caW, hipJ, knee, ankle, inner, outer, f, female: true,
    bun: { x: 0, y: -0.15, r: 1.45 } };
}

// female definition lines (right half; mirrored): clavicles, a soft under-bust curve (no pec border), abs and
// obliques only when lean for a woman (thresholds ≈ 7 points of body fat above the male ones)
function detailsF(g, bf, s, cx, top) {
  const X = x => (cx + x * s).toFixed(1), Y = y => (top + y * s).toFixed(1), Xm = x => (cx - x * s).toFixed(1);
  const { f, sh, wa, nk, rib } = g;
  const def = clamp((27 - bf) / 10, 0, 1), abs = clamp((21.5 - bf) / 4, 0, 1), sep = clamp((22 - bf) / 5, 0, 1);
  const out = [];
  const line = (pts, op, w = 1.3) => {
    if (op <= 0.02) return;
    const mk = XX => pts.length === 3
      ? `M${XX(pts[0][0])} ${Y(pts[0][1])} Q${XX(pts[1][0])} ${Y(pts[1][1])} ${XX(pts[2][0])} ${Y(pts[2][1])}`
      : pts.map(([x, y], i) => (i ? 'L' : 'M') + XX(x) + ' ' + Y(y)).join(' ');
    out.push(`<path d="${mk(X)} ${mk(Xm)}" stroke-opacity="${op.toFixed(2)}" stroke-width="${w}"/>`);
  };
  line([[nk + 0.3, f(0.171)], [sh * 0.45, f(0.173)], [sh - 2.3, f(0.18)]], 0.16 + def * 0.1, 1.0);
  line([[0.5, f(0.322)], [rib * 0.55, f(0.334)], [rib - 0.4, f(0.31)]], 0.22 + def * 0.1, 1.3);   // under-bust curve
  const o2 = g.outer[2];
  line([[sh - 2.8, f(0.181)], [sh - 2.3, f(0.235)], [o2.x - 0.9, o2.y - 0.6]], 0.1 + sep * 0.3, 1.2);
  const absW = Math.min(2.2, wa * 0.4), a0 = f(0.345), a1 = f(0.455);
  line([[0, a0], [0, a1]], 0.08 + abs * 0.35, 1.2);
  [0.37, 0.4].forEach((yy, i) => line([[0.15, f(yy) + 0.15], [absW * 0.5, f(yy) - 0.1], [absW, f(yy) + 0.1 - i * 0.05]], abs * (0.4 - i * 0.07), 1.2));
  line([[wa - 0.3, f(0.425)], [wa * 0.5, f(0.45)], [0.85, f(0.5)]], clamp((19.5 - bf) / 3.5, 0, 1) * 0.4, 1.3);
  const k = g.knee, hj = g.hipJ;
  line([[hj.x + 0.6, f(0.55)], [k.x + 0.2, f(0.63)], [k.x - g.thW * 0.15, f(0.69)]], 0.08 + def * 0.18, 1.1);
  return out.join('');
}

function toPath(half, s, cx, top) {
  // right half + mirrored left half → closed smooth path
  const R = half;
  const L = half.slice(1, -1).reverse().map(p => ({ ...p, x: -p.x }));
  const ring = [...R, ...L];
  const P = ring.map(p => ({ x: cx + p.x * s, y: top + p.y * s, c: p.c }));
  const n = P.length, t = 1;
  let d = `M${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const c1 = p1.c ? p1 : { x: p1.x + (p2.x - p0.x) / 6 * t, y: p1.y + (p2.y - p0.y) / 6 * t };
    const c2 = p2.c ? p2 : { x: p2.x - (p3.x - p1.x) / 6 * t, y: p2.y - (p3.y - p1.y) / 6 * t };
    d += `C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d + 'Z';
}

// muscle-separation lines (right half; mirrored)
function details(g, bf, s, cx, top) {
  const X = x => (cx + x * s).toFixed(1), Y = y => (top + y * s).toFixed(1), Xm = x => (cx - x * s).toFixed(1);
  const { f, ch, sh, wa, nk } = g;
  const def = clamp((20 - bf) / 10, 0, 1);         // general definition 20% → 10%
  const abs = clamp((14.5 - bf) / 4, 0, 1);         // abs fade in ≤14%, clear ≤11%
  const vcut = clamp((12.5 - bf) / 3.5, 0, 1);
  const sep = clamp((15 - bf) / 5, 0, 1);
  const out = [];
  const line = (pts, op, w = 1.3) => {
    if (op <= 0.02) return;
    const mk = XX => pts.length === 3
      ? `M${XX(pts[0][0])} ${Y(pts[0][1])} Q${XX(pts[1][0])} ${Y(pts[1][1])} ${XX(pts[2][0])} ${Y(pts[2][1])}`
      : pts.map(([x, y], i) => (i ? 'L' : 'M') + XX(x) + ' ' + Y(y)).join(' ');
    const R = mk(X), Lm = mk(Xm);
    out.push(`<path d="${R} ${Lm}" stroke-opacity="${op.toFixed(2)}" stroke-width="${w}"/>`);
  };
  const absW = Math.min(2.5, wa * 0.42), pecY = f(0.29);
  // clavicles + pec lower border + sternum
  line([[nk + 0.3, f(0.168)], [sh * 0.45, f(0.17)], [sh - 2.6, f(0.176)]], 0.18 + def * 0.12, 1.1);
  line([[0.2, pecY + 0.4], [ch * 0.7, pecY + 0.3], [ch - 0.25, f(0.25)]], 0.3 + def * 0.35, 1.6);
  line([[0, f(0.205)], [0, pecY - 0.6]], 0.12 + def * 0.2, 1.1);
  // delt / arm separation (front delt border, delt insertion, biceps)
  const o2 = g.outer[2], i2 = g.inner[2], o4 = g.outer[4];
  line([[sh - 3.1, f(0.176)], [sh - 2.5, f(0.232)], [o2.x - 0.9, o2.y - 0.6]], 0.18 + sep * 0.45, 1.4);
  line([[(i2.x + o2.x) / 2 - 0.3, i2.y + 0.2], [(i2.x + o2.x) / 2 - 0.1, i2.y + 1.6], [(g.inner[4].x + o4.x) / 2, o4.y - 1.2]], sep * 0.28, 1.1);
  // abs: linea alba, tendinous intersections, semilunar lines
  const a0 = pecY + 1.1, a1 = f(0.455);
  line([[0, a0], [0, a1]], 0.1 + abs * 0.45, 1.3);
  [0.33, 0.365, 0.4].forEach((yy, i) => line([[0.15, f(yy) + 0.15], [absW * 0.5, f(yy) - 0.1], [absW, f(yy) + 0.1 - i * 0.05]], abs * (0.55 - i * 0.07), 1.3));
  line([[absW + 0.3, a0 + 0.3], [absW + 0.15, f(0.39)], [absW - 0.5, a1]], abs * 0.45, 1.2);
  // obliques / Adonis belt
  line([[wa - 0.35, f(0.425)], [wa * 0.5, f(0.448)], [0.85, f(0.5)]], vcut * 0.55, 1.4);
  // serratus hints (very lean)
  const sv = clamp((11 - bf) / 3, 0, 1);
  [0.305, 0.325].forEach(yy => line([[ch - 1.4, f(yy)], [ch - 0.5, f(yy) - 0.35]], sv * 0.4, 1.1));
  // quad split (teardrop)
  const k = g.knee, hj = g.hipJ;
  line([[hj.x + 0.6, f(0.55)], [k.x + 0.2, f(0.63)], [k.x - g.thW * 0.15, f(0.69)]], 0.12 + def * 0.25, 1.2);
  return out.join('');
}

export function silhouetteSVG(measurements = {}, { bodyFatPct = null, heightIn = 69, label = '', compare = null, cls = '', title, sex = null, weightLb = null } = {}) {
  const F = sexFor(measurements, sex) === 'female';
  const H = clamp(num(heightIn) || (F ? 64 : 69), F ? 54 : 58, 82);
  const bf = clamp(num(bodyFatPct) ?? (F ? 27 : 18), 4, F ? 50 : 40);
  const W = 230, VH = 470, pad = 12, s = (VH - pad * 2 - (label ? 18 : 0)) / H, cx = W / 2, top = pad + (F ? 2.4 : 0);
  const id = 'sil' + (++uidN);
  const m = normalizeMeasurements(measurements, H, F ? 'female' : 'male', weightLb);
  const g = F ? bodyF(m, H) : body(m, H);
  const d = toPath(g.pts, s, cx, top);
  let ghost = '';
  if (compare) {
    const cm = normalizeMeasurements(compare.measurements || compare, H, F ? 'female' : 'male', compare.weightLb ?? weightLb);
    const cg = F ? bodyF(cm, H) : body(cm, H);
    ghost = `<path d="${toPath(cg.pts, s, cx, top)}" fill="none" stroke="#f3f3f6" stroke-opacity=".8" stroke-width="1.3" stroke-dasharray="3 2.5"/>`;
  }
  const bun = g.bun ? `<circle cx="${cx}" cy="${(top + g.bun.y * s).toFixed(1)}" r="${(g.bun.r * s).toFixed(1)}" fill="var(--accent2)"/>` : '';
  const softness = clamp((bf - 10) / 18, 0, 1);  // higher BF → flatter shading
  return `<svg class="bd-sil ${cls}" viewBox="0 0 ${W} ${VH}" role="img" aria-label="${title || label || 'Physique silhouette'}">
  <defs>
    <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent2)"/><stop offset=".55" stop-color="var(--accent)"/><stop offset="1" stop-color="#c2410c"/></linearGradient>
    <linearGradient id="${id}v" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset=".22" stop-color="#000" stop-opacity="${(0.08 + softness * 0.06).toFixed(2)}"/><stop offset=".5" stop-color="#fff" stop-opacity=".1"/><stop offset=".78" stop-color="#000" stop-opacity="${(0.08 + softness * 0.06).toFixed(2)}"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient>
    <radialGradient id="${id}h" cx=".5" cy=".24" r=".32"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <clipPath id="${id}c"><path d="${d}"/></clipPath>
  </defs>
  <ellipse cx="${cx}" cy="${(top + H * s + 2).toFixed(1)}" rx="${(g.sh * s * 1.15).toFixed(1)}" ry="6" fill="#000" opacity=".35"/>
  ${bun}<path d="${d}" fill="url(#${id}g)"/>
  <g clip-path="url(#${id}c)">
    <rect x="0" y="0" width="${W}" height="${VH}" fill="url(#${id}v)"/>
    <rect x="0" y="0" width="${W}" height="${VH}" fill="url(#${id}h)"/>
    <g fill="none" stroke="#3a1205" stroke-linecap="round">${F ? detailsF(g, bf, s, cx, top) : details(g, bf, s, cx, top)}</g>
  </g>
  ${ghost}
  ${label ? `<text x="${cx}" y="${VH - 6}" text-anchor="middle" class="bd-sil-label">${label}</text>` : ''}
</svg>`;
}
