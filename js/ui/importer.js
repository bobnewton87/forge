// Import from Iron Runner (UI-SHELL).
// CONTRACT-NOTE: Iron Runner and Forge share an origin (bobnewton87.github.io), so this module
// reads the `ir_*` localStorage keys directly (read-only). The converter is pure and exported
// for tests. Already-imported sessions (same deterministic id `s_ir_<date>`) are skipped, as are
// body-log dates that already exist in Forge, so importing twice is a no-op.
import { getEx } from '../data/exercises.js';
import { REGIONS, GROUPS } from '../data/muscles.js';
import { esc } from './components.js';

const parse = v => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return null; } };

function titleFor(blocks, lookup) {
  const g = {};
  for (const b of blocks) {
    const ex = lookup(b.exId); if (!ex) continue;
    const n = b.sets.filter(s => s.done).length;
    for (const [r, w] of Object.entries(ex.muscles || {})) { const gr = REGIONS[r]?.group; if (gr) g[gr] = (g[gr] || 0) + n * w; }
  }
  const top = Object.entries(g).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const legs = ['quads', 'hamstrings', 'glutes', 'calves'];
  const names = [];
  for (const id of top) {
    const nm = legs.includes(id) ? 'Legs' : (GROUPS[id]?.name || id);
    if (!names.includes(nm)) names.push(nm);
    if (names.length === 3) break;
  }
  return { title: names.length ? names.join(' · ') : 'Lift', targets: top.slice(0, 4) };
}

/**
 * Convert a flat Iron Runner dump ({ 'ir_s_2026-03-26': '<json>', ir_done: '<json>', ... },
 * values may be strings or already-parsed) into Forge data.
 * @returns {{ sessions: Session[], bodyLog: {d,w}[], unknown: string[], stats: object }}
 */
export function convertIronRunner(raw, { lookup = getEx } = {}) {
  raw = raw || {};
  const sessions = [];
  const unknown = new Set();
  const done = parse(raw.ir_done) || {};
  const liftDates = new Set();
  const loggedDates = new Set();
  let sets = 0;

  for (const key of Object.keys(raw).filter(k => /^ir_s_\d{4}-\d{2}-\d{2}$/.test(k)).sort()) {
    const date = key.slice(5);
    const ses = parse(raw[key]);
    if (!ses || typeof ses !== 'object') continue;
    const ids = new Set([...Object.keys(ses.perf || {}), ...Object.keys(ses.sets || {})]);
    // A logged lift day (even if every exercise is unknown) is never treated as a run day.
    if ([...ids].some(id => (ses.sets?.[id] || []).some(Boolean) || (ses.perf?.[id] || []).some(Boolean))) loggedDates.add(date);
    const blocks = [];
    for (const exId of ids) {
      const ex = lookup(exId);
      if (!ex) { unknown.add(exId); continue; }
      const rr = Array.isArray(ex.repRange) ? ex.repRange : [8, 12];
      let out = [];
      const perf = Array.isArray(ses.perf?.[exId]) ? ses.perf[exId].filter(p => p && (typeof p.r === 'number' || typeof p.w === 'number')) : [];
      if (perf.length) {
        out = perf.map(p => ({ w: typeof p.w === 'number' ? p.w : null, r: typeof p.r === 'number' && p.r > 0 ? p.r : rr[0], done: true }));
      } else if (Array.isArray(ses.sets?.[exId])) {
        const w = typeof ses.wts?.[exId] === 'number' ? ses.wts[exId] : null;
        out = ses.sets[exId].filter(Boolean).map(() => ({ w, r: rr[0], done: true }));
      }
      if (!out.length) continue;
      sets += out.length;
      const ws = out.map(s => s.w).filter(w => w != null);
      blocks.push({
        kind: 'lift', exId, group: null,
        target: { sets: out.length, repMin: rr[0], repMax: rr[1], rest: 90, weight: ws.length ? Math.max(...ws) : null, reps: null, note: null },
        sets: out,
      });
    }
    if (!blocks.length) continue;
    liftDates.add(date);
    const { title, targets } = titleFor(blocks, lookup);
    const n = blocks.reduce((s, b) => s + b.sets.length, 0);
    sessions.push({
      id: 's_ir_' + date, date, status: 'done', startedAt: null, endedAt: null,
      location: 'home', minutes: Math.round((5 + n * 2.5) / 5) * 5, title, targets,
      source: 'import', blocks, rationale: ['Imported from Iron Runner'], notes: '',
    });
  }

  let runs = 0;
  for (const date of Object.keys(done).filter(d => done[d] && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
    if (liftDates.has(date) || loggedDates.has(date)) continue;
    runs++;
    sessions.push({
      id: 's_ir_' + date, date, status: 'done', startedAt: null, endedAt: null,
      location: 'home', minutes: 30, title: 'Easy Run', targets: [], source: 'import',
      blocks: [{ kind: 'cardio', modality: 'run', minutes: 30, intensity: 'easy', distance: null, calories: null, done: true, note: 'Iron Runner run day' }],
      rationale: ['Imported from Iron Runner (run day)'], notes: '',
    });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date));

  const body = new Map();
  for (const e of parse(raw.ir_wlog) || []) if (e && e.d && Number(e.w) > 0) body.set(e.d, Number(e.w));
  const prof = parse(raw.ir_profile) || {};
  if (!body.size && Number(prof.currentWt) > 0) {
    const st = parse(raw.ir_start);
    const d = typeof st === 'string' && /^\d{4}-\d{2}-\d{2}/.test(st) ? st.slice(0, 10) : (sessions[0]?.date || null);
    if (d) body.set(d, Number(prof.currentWt));
  }
  const bodyLog = [...body].map(([d, w]) => ({ d, w })).sort((a, b) => a.d.localeCompare(b.d));

  return {
    sessions, bodyLog, unknown: [...unknown].sort(),
    stats: {
      lifts: liftDates.size, runs, sets, weights: bodyLog.length,
      from: sessions[0]?.date || null, to: sessions[sessions.length - 1]?.date || null,
    },
  };
}

/** Write converted data into the store, skipping what already exists. */
export function applyImport(store, conv, { overwrite = false } = {}) {
  const have = new Set(store.getSessions().map(s => s.id));
  let added = 0, skipped = 0;
  for (const s of conv.sessions) {
    if (have.has(s.id) && !overwrite) { skipped++; continue; }
    store.saveSession(s); added++;
  }
  const dates = new Set(store.getBodyLog().map(e => e.d));
  let wAdded = 0;
  for (const e of conv.bodyLog) if (!dates.has(e.d)) { store.logBodyweight(e.d, e.w); wAdded++; }
  return { added, skipped, weights: wAdded };
}

function readLocal() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('ir_') && k !== 'ir_plans') out[k] = localStorage.getItem(k); }
  } catch (e) { /* no storage */ }
  return out;
}

// ---------- UI ----------
let pasted = null;   // raw object from paste/upload (module state survives re-renders)

export function title() { return 'Import'; }

function previewHtml(ctx, raw, srcLabel) {
  const conv = convertIronRunner(raw);
  const have = new Set(ctx.store.getSessions().map(s => s.id));
  const already = conv.sessions.filter(s => have.has(s.id)).length;
  const fresh = conv.sessions.length - already;
  const st = conv.stats;
  if (!conv.sessions.length && !conv.bodyLog.length) return `<div class="card"><div class="empty"><div class="big">🔍</div><h3>No Iron Runner data found</h3><p>${esc(srcLabel)} has no workout days or weigh-ins.</p></div></div>`;
  return `<div class="card hero">
    <div class="card-title">Found in ${esc(srcLabel)}</div>
    <div class="grid2 mt">
      <div class="stat"><div class="v">${st.lifts}</div><div class="l">Lift sessions</div></div>
      <div class="stat"><div class="v">${st.runs}</div><div class="l">Run days</div></div>
      <div class="stat"><div class="v">${st.sets}</div><div class="l">Working sets</div></div>
      <div class="stat"><div class="v">${st.weights}</div><div class="l">Weigh-ins</div></div>
    </div>
    ${st.from ? `<p class="muted small mt">${esc(st.from)} → ${esc(st.to)}</p>` : ''}
    ${already ? `<p class="small mt"><span class="badge good">✓ ${already} already imported</span> they'll be skipped.</p>` : ''}
    ${conv.unknown.length ? `<p class="small muted mt">Skipping unknown exercises: ${conv.unknown.map(esc).join(', ')}</p>` : ''}
    <button class="btn btn-primary btn-block mt2" data-go ${fresh || conv.bodyLog.length ? '' : 'disabled'}>${fresh ? `Import ${fresh} session${fresh === 1 ? '' : 's'}` : 'Nothing new to import'}</button>
  </div>`;
}

export function render(ctx) {
  const local = readLocal();
  const hasLocal = Object.keys(local).some(k => k.startsWith('ir_s_') || k === 'ir_done' || k === 'ir_wlog');
  return `<div class="page-head"><h1>Bring your history</h1><p class="sub">Copy your Iron Runner workouts, run days and weigh-ins into Forge so progression starts from real numbers.</p></div>
    <div class="section-title">On this device</div>
    ${hasLocal ? previewHtml(ctx, local, 'Iron Runner on this device') : `<div class="card"><p class="muted">No Iron Runner data on this origin. If Iron Runner lives at another address (or you're testing locally), paste or upload its data below.</p></div>`}
    <div class="section-title">Paste or upload</div>
    <div class="card">
      <p class="small muted mb">Use an Iron Runner export: a JSON object of <code>ir_*</code> keys.</p>
      <textarea id="irpaste" placeholder='{"ir_done":"{…}","ir_s_2026-03-26":"{…}"}'></textarea>
      <div class="btn-row mt"><button class="btn" data-parse>Preview paste</button><label class="btn btn-ghost">Upload file<input type="file" accept=".json,application/json" id="irfile" hidden></label></div>
    </div>
    <div id="irprev">${pasted ? previewHtml(ctx, pasted, 'pasted data') : ''}</div>
    <p class="muted small center mt2">Importing never changes Iron Runner, and running it twice won't duplicate anything.</p>`;
}

export function bind(root, ctx) {
  const go = raw => {
    const res = applyImport(ctx.store, convertIronRunner(raw));
    ctx.toast(`Imported ${res.added} session${res.added === 1 ? '' : 's'}${res.weights ? ` + ${res.weights} weigh-ins` : ''}`);
    ctx.rerender();
  };
  const prev = root.querySelector('#irprev');
  root.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => go(prev.contains(b) ? pasted : readLocal()); });
  const load = text => {
    let obj = parse(text);
    if (obj && obj.data && typeof obj.data === 'object' && !Object.keys(obj).some(k => k.startsWith('ir_'))) obj = obj.data;
    if (!obj || typeof obj !== 'object') { ctx.toast('That is not valid JSON'); return; }
    pasted = obj; ctx.rerender();
  };
  root.querySelector('[data-parse]').onclick = () => load(root.querySelector('#irpaste').value.trim());
  root.querySelector('#irfile').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(load); };
}
