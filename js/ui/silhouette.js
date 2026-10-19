// Stylized front-view physique silhouette (UI-BODY). Pure string builder, no DOM access.
// Proportions come from tape measurements (inches) scaled to height; body fat controls how much
// muscle separation shows. Missing measurements fall back to typical male proportions.
//
// silhouetteSVG(measurements, { bodyFatPct, heightIn, label, compare, cls, id })
//   measurements: { neck, shoulders, chest, waist, hips, arm | armL/armR, forearm, thigh, calf }
//   compare: optional { measurements, bodyFatPct } drawn as a faint dashed "now" outline behind.

const DEF = { neck: 15, shoulders: 46, chest: 39, waist: 33, hips: 37, arm: 13, forearm: 11, thigh: 22, calf: 14.5 };
const RANGE = { neck: [11, 22], shoulders: [36, 64], chest: [30, 56], waist: [24, 54], hips: [28, 56], arm: [9, 22], forearm: [8, 17], thigh: [15, 34], calf: [11, 21] };
const num = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
let uidN = 0;

export function normalizeMeasurements(m = {}, heightIn = 69) {
  m = m || {};
  const arm = num(m.arm) ?? (num(m.armL) && num(m.armR) ? (m.armL + m.armR) / 2 : num(m.armL) ?? num(m.armR));
  const raw = { ...m, arm };
  const out = {};
  const hs = heightIn / 69;   // typical girths scale a little with height
  for (const k of Object.keys(DEF)) {
    const v = num(raw[k]);
    out[k] = clamp(v ?? DEF[k] * (k === 'neck' || k === 'arm' || k === 'forearm' ? 1 : Math.sqrt(hs)), ...RANGE[k]);
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

export function silhouetteSVG(measurements = {}, { bodyFatPct = null, heightIn = 69, label = '', compare = null, cls = '', title } = {}) {
  const H = clamp(num(heightIn) || 69, 58, 82);
  const bf = clamp(num(bodyFatPct) ?? 18, 4, 40);
  const W = 230, VH = 470, pad = 12, s = (VH - pad * 2 - (label ? 18 : 0)) / H, cx = W / 2, top = pad;
  const id = 'sil' + (++uidN);
  const m = normalizeMeasurements(measurements, H);
  const g = body(m, H);
  const d = toPath(g.pts, s, cx, top);
  let ghost = '';
  if (compare) {
    const cm = normalizeMeasurements(compare.measurements || compare, H);
    const cg = body(cm, H);
    ghost = `<path d="${toPath(cg.pts, s, cx, top)}" fill="none" stroke="#f3f3f6" stroke-opacity=".8" stroke-width="1.3" stroke-dasharray="3 2.5"/>`;
  }
  const softness = clamp((bf - 10) / 18, 0, 1);  // higher BF → flatter shading
  return `<svg class="bd-sil ${cls}" viewBox="0 0 ${W} ${VH}" role="img" aria-label="${title || label || 'Physique silhouette'}">
  <defs>
    <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent2)"/><stop offset=".55" stop-color="var(--accent)"/><stop offset="1" stop-color="#c2410c"/></linearGradient>
    <linearGradient id="${id}v" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset=".22" stop-color="#000" stop-opacity="${(0.08 + softness * 0.06).toFixed(2)}"/><stop offset=".5" stop-color="#fff" stop-opacity=".1"/><stop offset=".78" stop-color="#000" stop-opacity="${(0.08 + softness * 0.06).toFixed(2)}"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient>
    <radialGradient id="${id}h" cx=".5" cy=".24" r=".32"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <clipPath id="${id}c"><path d="${d}"/></clipPath>
  </defs>
  <ellipse cx="${cx}" cy="${(top + H * s + 2).toFixed(1)}" rx="${(g.sh * s * 1.15).toFixed(1)}" ry="6" fill="#000" opacity=".35"/>
  <path d="${d}" fill="url(#${id}g)"/>
  <g clip-path="url(#${id}c)">
    <rect x="0" y="0" width="${W}" height="${VH}" fill="url(#${id}v)"/>
    <rect x="0" y="0" width="${W}" height="${VH}" fill="url(#${id}h)"/>
    <g fill="none" stroke="#3a1205" stroke-linecap="round">${details(g, bf, s, cx, top)}</g>
  </g>
  ${ghost}
  ${label ? `<text x="${cx}" y="${VH - 6}" text-anchor="middle" class="bd-sil-label">${label}</text>` : ''}
</svg>`;
}
