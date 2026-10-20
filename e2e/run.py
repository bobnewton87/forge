#!/usr/bin/env python3
"""Forge end-to-end suite (QA builder).

Usage:  python3 e2e/run.py            # run everything, write e2e/LAST_RESULTS.md
        python3 e2e/run.py -k C1 -k W  # only tests whose id starts with C1 or W
        python3 e2e/run.py --headed

Starts its own static server on a free port, drives /usr/bin/chromium (390x844, swiftshader
WebGL) with Python Playwright, and prints a PASS/FAIL table. Screenshots of failures go to
/tmp/claude-1000/forge-shots/qa-<id>.png. The suite never edits app files.

Fixtures and smoke (F*, S*) run with real WebGL; flows run in a "lite" context where WebGL is
unavailable (the app's SVG fallback), because software WebGL starves requestAnimationFrame and makes
every interaction slow. Use --full3d to run everything with WebGL. Clicks are hit-tested DOM clicks
(the note column records anything covering the tap target).

Selectors prefer data attributes (data-t / data-a / data-s / data-act ...) and visible text, so
minor markup changes don't break it. Cohesion checks (CONTRACT §18) record one row per hop so a
broken link in the chain is easy to route.
"""
import argparse
import datetime as dt
import json
import os
import re
import socket
import subprocess
import sys
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path('/tmp/claude-1000/forge-shots')
SEED = Path('/home/hanknewt/workout/seed-data.json')
RESULTS_MD = ROOT / 'e2e' / 'LAST_RESULTS.md'
CHROMIUM = '/usr/bin/chromium'
LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
LOCS = ['home', 'crunch', 'travel', 'office']
ROUTES = ['today', 'session', 'plan', 'history', 'body', 'measure', 'projection', 'supplements',
          'nutrition', 'more', 'settings', 'library', 'exercise?id=db_curl', 'import']
WEBGL_TESTS = {'F1', 'F2', 'S1', 'S2', 'S3', 'S4', 'S5'}   # run with real (swiftshader) WebGL; the rest run in lite mode
CARDIO_GOAL = 225
KCAL_GOAL = 2650
BOB_MEAS = {'weight': 164, 'neck': 15, 'waist': 34.5, 'shoulders': 46, 'chest': 39, 'armL': 13.5, 'armR': 13.75,
            'thighL': 22, 'thighR': 22.25, 'calfL': 14.5, 'calfR': 14.25}

# Console noise that is not an app bug (kept short on purpose).
BENIGN = [re.compile(p, re.I) for p in [
    r'GPU stall due to ReadPixels', r'Automatic fallback to software WebGL', r'WebGL.*performance',
    r'\[\.WebGL-.*\]', r'favicon',
]]

PICK_JS = r"""([s, n, tx]) => {
  const hitOk = el => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 'element has no size (hidden?)';
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el))
      return 'covered by <' + hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + (typeof hit.className === 'string' && hit.className.trim() ? '.' + hit.className.trim().split(/\s+/).join('.') : '') + '>';
    return '';
  };
  let all = [...document.querySelectorAll(s)];
  if (tx) all = all.filter(x => new RegExp(tx, 'i').test(x.innerText || x.textContent || ''));
  const e = all[n];
"""

# Lite mode: no WebGL, so the app uses its SVG fallback (keeps flows fast; 3D is exercised by F1/S1/S2).
NO_WEBGL_JS = r"""
(() => { const g = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/i.test(String(t)) ? null : g.call(this, t, ...a); }; })();
"""

# Toast recorder: every #toast text change is pushed to window.__toasts.
INIT_JS = r"""
window.__toasts = [];
(function hook() {
  const t = document.getElementById('toast');
  if (!t) { setTimeout(hook, 15); return; }
  new MutationObserver(() => { const s = t.textContent || ''; if (s) window.__toasts.push(s); })
    .observe(t, { childList: true, characterData: true, subtree: true });
})();
"""


class Fail(Exception):
    def __init__(self, step, expected='', actual=''):
        super().__init__(step)
        self.step, self.expected, self.actual = step, str(expected), str(actual)


RESULTS = []        # rows: dict(id, name, status, step, expected, actual, shot, secs, note)
SMOKE_DETAIL = {}   # profile -> {route: [errors]}
SMOKE_PERF = {}     # profile -> {route: ms}


def short(s, n=150):
    s = re.sub(r'\s+', ' ', str(s or '')).strip()
    return s if len(s) <= n else s[:n - 1] + '…'


# ---------------------------------------------------------------- server
class Server:
    def __enter__(self):
        s = socket.socket(); s.bind(('127.0.0.1', 0)); self.port = s.getsockname()[1]; s.close()
        self.proc = subprocess.Popen([sys.executable, '-m', 'http.server', str(self.port), '--bind', '127.0.0.1',
                                      '--directory', str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                socket.create_connection(('127.0.0.1', self.port), timeout=0.2).close(); break
            except OSError:
                time.sleep(0.05)
        self.base = f'http://127.0.0.1:{self.port}'
        return self

    def __exit__(self, *a):
        # stop by PID only
        try:
            self.proc.terminate(); self.proc.wait(timeout=3)
        except Exception:
            try: os.kill(self.proc.pid, 9)
            except Exception: pass


# ---------------------------------------------------------------- app driver
class App:
    def __init__(self, page, base, lite=False):
        self.page, self.base, self.n, self.lite = page, base, 0, lite
        self.errors = []      # (kind, text, route)
        self.notes = []
        page.on('console', self._console)
        page.on('pageerror', lambda e: self.errors.append(('pageerror', f'{e}', self.route_now())))
        page.on('response', self._response)
        page.on('dialog', lambda d: d.accept())
        page.add_init_script(INIT_JS)
        if lite: page.add_init_script(NO_WEBGL_JS)
        page.set_default_timeout(6000)

    def _console(self, msg):
        if msg.type != 'error': return
        txt = msg.text
        if any(b.search(txt) for b in BENIGN): return
        if 'Failed to load resource' in txt:  # the response hook records the URL
            return
        self.errors.append(('console', txt, self.route_now()))

    def _response(self, r):
        if r.status >= 400 and 'favicon' not in r.url:
            self.errors.append(('http', f'{r.status} {r.url.replace(self.base, "")}', self.route_now()))

    def route_now(self):
        try: return self.page.url.split('#/')[-1] if '#/' in self.page.url else ''
        except Exception: return ''

    # -- loading / navigation
    def load(self, state=None, route='today'):
        """Replace localStorage with `state` (dict of key -> raw string), then boot the app at route."""
        if not self.page.url.startswith(self.base):
            self.page.goto(self.base + '/manifest.json', wait_until='domcontentloaded')
        if state is not None:
            self.page.evaluate("s => { localStorage.clear(); sessionStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }", state)
        self.n += 1
        self.page.goto(f'{self.base}/?n={self.n}#/{route}', wait_until='domcontentloaded', timeout=20000)
        self.wait_route(route.split('?')[0])

    def wait_route(self, name, timeout=15000):
        self.page.wait_for_function("r => document.querySelector('#content')?.dataset.route === r", arg=name, timeout=timeout, polling=50)

    def go(self, route, settle=150):
        """Hash navigation through the app's own router (pushState + popstate). Returns the synchronous
        render+bind time in ms (the router draws inside the popstate handler)."""
        ms = self.page.evaluate("""h => { const t0 = performance.now(); history.pushState({ i: ((history.state && history.state.i) || 0) + 1 }, '', h);
                               dispatchEvent(new PopStateEvent('popstate', { state: history.state })); return performance.now() - t0; }""", '#/' + route)
        self.wait_route(route.split('?')[0])
        if settle: self.page.wait_for_timeout(settle)
        return ms

    def wait_text(self, pattern, sel='#content', timeout=4000):
        """Poll until innerText of sel matches regex; returns the matching snippet or ''."""
        try:
            self.page.wait_for_function("([p, s]) => new RegExp(p, 'i').test(document.querySelector(s)?.innerText || '')",
                                        arg=[pattern, sel], timeout=timeout, polling=100)
        except PWTimeout:
            return ''
        t = self.text(sel); m = re.search(pattern, t, re.I)
        return t[max(0, m.start() - 40): m.end() + 20] if m else ''


    def tab(self, name):
        self.click(f'#tabs [data-tab="{name}"]')
        self.wait_route(name)
        self.page.wait_for_timeout(120)

    # -- DOM helpers
    def loc(self, sel):
        return self.page.locator(sel)

    def has(self, sel, timeout=0):
        if timeout:
            try: self.page.wait_for_selector(sel, timeout=timeout, state='attached'); return True
            except PWTimeout: return False
        return self.page.locator(sel).count() > 0

    def count(self, sel):
        return self.page.locator(sel).count()

    def click(self, sel, timeout=4000, nth=0, text=None):
        """Hit-tested DOM click: wait until the element exists and is enabled, give a covering overlay
        (closing sheet, toast) up to 1.5 s to clear, then click. Records the covering element if it never
        clears. Avoids Playwright's rAF-based 'stable' wait, which starves under software WebGL.
        `text` (regex) picks the nth element whose text matches."""
        arg = [sel, nth, text]
        try:
            self.page.wait_for_function(PICK_JS + "return !!e && !e.disabled; }", arg=arg, timeout=timeout, polling=50)
        except PWTimeout:
            n = self.page.locator(sel).count()
            raise Fail(f'click {sel}' + (f' /{text}/' if text else ''), 'element present and enabled', 'not found' if n <= nth else 'disabled / no text match')
        try:
            self.page.wait_for_function(PICK_JS + "return hitOk(e) === ''; }", arg=arg, timeout=1500, polling=60)
        except PWTimeout:
            pass
        why = self.page.evaluate(PICK_JS + "const w = hitOk(e); e.click(); return w; }", arg)
        if why:
            self.notes.append(f'tap on {sel}: {why}')

    def fill(self, sel, value):
        self.page.locator(sel).first.fill(str(value))

    def set_range(self, sel, value):
        self.page.locator(sel).first.evaluate("""(el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
                                                  el.dispatchEvent(new Event('change', { bubbles: true })); }""", str(value))

    def text(self, sel='#content'):
        try: return self.page.locator(sel).first.inner_text(timeout=2000)
        except Exception: return ''

    def sheet(self):
        return '#sheet-root > .sheet:last-child .sheet-body'

    def wait_sheet(self, inner='', timeout=4000):
        sel = f'#sheet-root > .sheet:last-child .sheet-body {inner}'.strip()
        try:
            self.page.wait_for_selector(sel, timeout=timeout)
            return True
        except PWTimeout:
            return False

    def close_sheet(self):
        self.page.evaluate("() => document.querySelector('#sheet-root > .sheet-backdrop')?.click()")
        self.page.wait_for_timeout(320)

    def toast_mark(self):
        return self.page.evaluate('() => (window.__toasts || []).length')

    def wait_toast(self, pattern, since=0, timeout=6000):
        try:
            self.page.wait_for_function("([p, i]) => (window.__toasts || []).slice(i).some(t => new RegExp(p, 'i').test(t))",
                                        arg=[pattern, since], timeout=timeout, polling=80)
            return self.toasts(since)[-1]
        except PWTimeout:
            return None

    def toasts(self, since=0):
        return self.page.evaluate('i => (window.__toasts || []).slice(i)', since)

    def store(self, expr):
        """Evaluate an expression with `store` (and `ds` = today's date string) in page context."""
        return self.page.evaluate("""async (e) => { const { store } = await import('/js/store.js');
            const d = new Date(); const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return (new Function('store', 'ds', 'return (' + e + ')'))(store, ds); }""", expr)

    def profile(self):
        return self.store('store.getProfile()')

    def snapshot(self):
        return self.page.evaluate("() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; }")

    def shot(self, name):
        SHOTS.mkdir(parents=True, exist_ok=True)
        p = SHOTS / f'qa-{name}.png'
        try:
            self.page.screenshot(path=str(p), full_page=True, timeout=10000)
        except Exception:
            try: self.page.screenshot(path=str(p), timeout=5000)
            except Exception: return ''
        return str(p)

    def stat_value(self, label):
        """Number shown next to a stat label (e.g. 'Lift sets') on the current screen."""
        return self.page.evaluate("""lab => {
          const root = document.querySelector('#content');
          for (const el of root.querySelectorAll('*')) {
            if (el.children.length || (el.textContent || '').trim().toLowerCase() !== lab.toLowerCase()) continue;
            const box = el.parentElement; const t = (box.innerText || '').replace(new RegExp(lab, 'i'), '');
            const m = t.match(/-?[\\d,]+(\\.\\d+)?/); if (m) return parseFloat(m[0].replace(/,/g, ''));
          }
          return null; }""", label)


# ---------------------------------------------------------------- test runner
class T:
    def __init__(self, app, tid, name):
        self.app, self.id, self.name = app, tid, name
        self.subs = 0

    def check(self, cond, step, expected='', actual=''):
        if not cond: raise Fail(step, expected, actual)

    def sub(self, sid, name, cond, step='', expected='', actual='', note=''):
        """Record a soft sub-check row (does not abort the test)."""
        self.subs += 1
        status = 'WARN' if cond == 'warn' else ('PASS' if cond else 'FAIL')
        shot = self.app.shot(sid) if status != 'PASS' else ''
        RESULTS.append(dict(id=sid, name=name, status=status, step=step if status != 'PASS' else '', expected=str(expected),
                            actual=str(actual), shot=shot, secs=None, note=note, page=page_context(self.app) if status == 'FAIL' else ''))
        return status == 'PASS'


TESTS = []


def test(tid, name):
    def deco(fn):
        TESTS.append((tid, name, fn)); return fn
    return deco


def page_context(app):
    """What the user would see at the failure: route, open sheet, toasts, #content text."""
    try:
        route = app.page.evaluate("() => location.hash")
        sheet = app.text('#sheet-root > .sheet:last-child .sheet-body') if app.has('#sheet-root > .sheet:last-child') else ''
        toasts = app.toasts(max(0, app.toast_mark() - 3))
        return f'route {route} | sheet: {short(sheet, 200) or "none"} | last toasts: {toasts} | content: {short(app.text(), 600)}'
    except Exception as e:
        return f'(no page context: {e})'


def run_test(app, tid, name, fn, ctx):
    t = T(app, tid, name)
    app.notes = []
    e0 = len(app.errors)
    t0 = time.time()
    row = dict(id=tid, name=name, status='PASS', step='', expected='', actual='', shot='', secs=0, note='')
    try:
        if app.page.url.startswith(app.base):
            app.page.evaluate('() => document.querySelector("#sheet-root > .sheet-backdrop")?.click()')
        fn(t, ctx)
    except Fail as f:
        row.update(status='FAIL', step=f.step, expected=f.expected, actual=f.actual, shot=app.shot(tid), page=page_context(app))
    except Exception as ex:  # selector timeouts etc.
        msg = str(ex).split('\n')[0]
        row.update(status='FAIL', step='exception', expected='no exception', actual=short(msg, 200), shot=app.shot(tid), page=page_context(app))
        if os.environ.get('QA_TRACE'): traceback.print_exc()
    row['secs'] = round(time.time() - t0, 1)
    errs = app.errors[e0:]
    notes = list(app.notes)
    if errs: notes.append(f'{len(errs)} console/page error(s): ' + short(errs[0][1], 90))
    row['note'] = '; '.join(notes)
    if t.subs == 0 or row['status'] == 'FAIL':
        RESULTS.append(row)
    else:  # sub rows already recorded; keep timing on the last one
        RESULTS[-1]['secs'] = row['secs']
        if notes: RESULTS[-1]['note'] = (RESULTS[-1]['note'] + '; ' if RESULTS[-1]['note'] else '') + row['note']


# ---------------------------------------------------------------- shared flows
def today_str():
    return dt.date.today().isoformat()


def tomorrow_str():
    return (dt.date.today() + dt.timedelta(days=1)).isoformat()


def discard_draft(app):
    if app.has('.tr-preview [data-t="discard"]'):
        app.click('.tr-preview [data-t="discard"]')
        app.page.wait_for_timeout(100)


def pick_location_today(app, loc):
    sel = f'[data-t="loc"][data-id="{loc}"]'
    if not app.has(sel):
        raise Fail(f'location chip {loc}', 'chip on Today builder', 'missing')
    app.click(sel)
    app.page.wait_for_selector(f'{sel}.active', timeout=3000)


def log_workout(t, loc, sets=2):
    """Today → pick location → Build → Start → check `sets` sets → Finish → summary sheet. Returns summary text."""
    app = t.app
    if app.page.evaluate("() => document.querySelector('#content').dataset.route") != 'today':
        app.tab('today')
    discard_draft(app)
    pick_location_today(app, loc)
    t.check(app.has('[data-t="build"]'), f'{loc}: builder', 'Build button', 'missing')
    app.click('[data-t="build"]')
    t.check(app.has('.tr-preview [data-t="start"]', timeout=5000), f'{loc}: preview after Build', 'preview with Start', short(app.text(), 120))
    n_items = app.count('.tr-preview .tr-pitem')
    t.check(n_items >= 1, f'{loc}: preview items', '≥1 exercise', n_items)
    app.click('.tr-preview [data-t="start"]')
    app.wait_route('session')
    app.page.wait_for_timeout(150)
    done = 0
    for _ in range(sets):
        row = app.page.locator('.tr-set:not(.done)').first
        if row.count() == 0: break
        i, k = row.get_attribute('data-i'), row.get_attribute('data-k')
        r = row.locator('[data-f="r"]')
        if r.count() and not (r.input_value() or '').strip(): r.fill('10')
        w = row.locator('[data-f="w"]')
        if w.count() and not (w.input_value() or '').strip() and row.locator('[data-s="winc"]').count(): w.fill('20')
        app.click(f'.tr-set[data-i="{i}"][data-k="{k}"] [data-s="check"]')
        app.page.wait_for_selector(f'.tr-set.done[data-i="{i}"][data-k="{k}"]', timeout=3000)
        done += 1
    if done == 0 and app.has('[data-s="toggle"]'):
        app.click('[data-s="toggle"]'); done = 1
    t.check(done >= 1, f'{loc}: log sets', f'{sets} sets checked', done)
    app.click('[data-s="finish"]')
    app.wait_route('today')
    ok = app.wait_sheet('.tr-summary', timeout=4000)
    txt = app.text(app.sheet()) if ok else ''
    t.check(ok and re.search(r'workout done', txt, re.I), f'{loc}: summary sheet', 'summary "Workout done"', short(txt or app.text(), 120))
    m = re.search(r'(\d+)\s*\n?\s*sets', txt, re.I)
    t.check(m and int(m.group(1)) >= done, f'{loc}: summary set count', f'≥{done} sets', m.group(1) if m else short(txt, 80))
    app.click('[data-sum-close]')
    app.page.wait_for_timeout(300)
    return txt


def plan_cardio(app):
    """(total, target, warnings[]) from Plan's week-coverage cardio row."""
    return app.page.evaluate("""() => {
      const row = document.querySelector('.pl-bar-row.cardio') || [...document.querySelectorAll('#content *')].find(e => /cardio/i.test(e.textContent || '') && /\\/\\s*\\d+\\s*min/.test(e.textContent || '') && e.children.length < 6);
      const warn = [...document.querySelectorAll('.pl-notes li, .pl-sum li, .pl-warn, [class*=warn] li')].map(e => e.textContent.trim());
      if (!row) return [null, null, warn];
      const t = row.textContent.replace(/\\s+/g, ' ');
      const m = t.match(/([\\d,]+)\\s*\\/\\s*([\\d,]+)\\s*min/);
      return m ? [parseFloat(m[1].replace(/,/g, '')), parseFloat(m[2].replace(/,/g, '')), warn] : [null, null, warn];
    }""")


def run_plan(app, which='plan-4'):
    m = app.toast_mark()
    app.click(f'[data-a="{which}"]')
    msg = app.wait_toast(r'Planned \d+|Extended .* weekly set targets|Nothing new|nothing to plan', since=m, timeout=15000)
    app.page.wait_for_timeout(200)
    return msg


def adherence(app):
    t = app.text('#pjAdhV') if app.has('#pjAdhV') else ''
    if t and re.search(r'\d', t): return int(re.sub(r'[^\d]', '', t)) / 100
    a = app.store('(store.kv("projection") || {}).adherence || store.getProfile().adherence || 0.85')
    return float(a or 0.85)


def proj_ok(app, val):
    """Projection weekly cardio 'reflects 225': raw value, or value ÷ adherence, within 180–270."""
    if val is None: return False, 'no value'
    adh = adherence(app)
    raw_ok = 180 <= val <= 270
    adj = val / adh if adh else val
    return (raw_ok or 180 <= adj <= 270), f'{val} min/wk shown (÷ {adh:.0%} adherence = {adj:.0f})'


def projection_cardio(app):
    """Weekly cardio the projection is using: (#pjCardioBase number, 'Cardio / wk' stat)."""
    base = app.page.evaluate("""() => { const el = document.querySelector('#pjCardioBase') || [...document.querySelectorAll('#content *')].find(e => !e.children.length && /min\\/wk/.test(e.textContent || ''));
      if (!el) return null; const m = el.textContent.match(/([\\d,]+)\\s*min\\/wk/); return m ? parseFloat(m[1].replace(/,/g, '')) : null; }""")
    stat = app.stat_value('Cardio / wk')
    return base, stat


# ---------------------------------------------------------------- fixtures
STATE = {}


@test('F1', 'Fixture: Bob profile + measurements via Measure UI')
def t_bob_profile(t, ctx):
    app = t.app
    app.load({}, 'measure')
    t.check(app.has('#bd-prof #pFt'), 'profile form on fresh Measure', '#bd-prof form', short(app.text(), 120))
    app.fill('#pFt', 5); app.fill('#pIn', 9); app.fill('#pBy', 1987)
    m = app.toast_mark()
    app.click('[data-saveprof]')
    t.check(app.wait_toast('Profile saved', m), 'save profile', 'toast "Profile saved"', app.toasts(m))
    app.page.wait_for_timeout(200)
    for k, v in BOB_MEAS.items():
        t.check(app.has(f'[data-m="{k}"]'), f'measurement field {k}', f'[data-m="{k}"]', 'missing')
        app.fill(f'[data-m="{k}"]', v)
    m = app.toast_mark()
    app.click('[data-savem]')
    msg = app.wait_toast(r'Saved \d+ value', m)
    t.check(msg, 'save measurements', 'toast "Saved 11 values"', app.toasts(m))
    p = app.profile()
    t.check((p.get('body') or {}).get('heightIn') == 69 and (p.get('body') or {}).get('birthYear') == 1987, 'profile stored',
            'heightIn 69, birthYear 1987', p.get('body'))
    meas = app.store('store.getMeasurements()')
    last = meas[-1] if meas else {}
    bad = {k: last.get(k) for k, v in BOB_MEAS.items() if k != 'weight' and last.get(k) != v}
    t.check(not bad, 'measurements stored', 'all 10 tape sites', bad)
    t.check(p.get('bodyweight') == 164, 'bodyweight stored', 164, p.get('bodyweight'))
    STATE['bob'] = app.snapshot()


def ensure_bob(app):
    if 'bob' not in STATE:  # fixture failed: build it through the store so later tests still run
        app.load({}, 'today')
        app.store("(store.updateProfile({ body: { ...store.getProfile().body, heightIn: 69, birthYear: 1987 } }), store.logBodyweight(ds, 164), store.logMeasurement({ d: ds, neck: 15, waist: 34.5, shoulders: 46, chest: 39, armL: 13.5, armR: 13.75, thighL: 22, thighR: 22.25, calfL: 14.5, calfR: 14.25 }), 1)")
        STATE['bob'] = app.snapshot()
    return STATE['bob']


@test('F2', 'Fixture: Iron Runner import via More → Import')
def t_import(t, ctx):
    app = t.app
    seed = json.loads(SEED.read_text())
    state = dict(ensure_bob(app)); state.update(seed)
    app.load(state, 'more')
    t.check(app.has('[data-nav="import"]'), 'More hub link', 'Import from Iron Runner', short(app.text(), 120))
    app.click('[data-nav="import"]')
    app.wait_route('import')
    t.check(app.has('[data-go]:not([disabled])', timeout=3000), 'import preview', 'enabled Import button', short(app.text(), 160))
    label = app.text('[data-go]')
    m = app.toast_mark()
    app.click('[data-go]')
    msg = app.wait_toast(r'Imported \d+ session', m)
    t.check(msg, 'import toast', 'toast "Imported N sessions"', app.toasts(m))
    n = app.store("store.getSessions().filter(s => s.id.startsWith('s_ir_')).length")
    t.check(n >= 6, 'sessions imported', '≥6 s_ir_* sessions', f'{n} ({label})')
    app.go('history')
    rows = app.count('[data-sid]')
    t.check(rows >= 6, 'History lists imported sessions', '≥6 rows', rows)
    # drop the raw ir_* keys so later tests run on Forge data only
    STATE['bobir'] = {k: v for k, v in app.snapshot().items() if not k.startswith('ir_')}


def bobir(app):
    return STATE.get('bobir') or ensure_bob(app)


# ---------------------------------------------------------------- smoke
def smoke(t, state, label):
    app = t.app
    app.load(state, 'today')
    app.page.wait_for_timeout(250)
    bad = {}
    perf = SMOKE_PERF.setdefault(label, {})
    for r in ROUTES:
        e0 = len(app.errors)
        try:
            perf[r] = round(app.go(r, settle=350))
        except Exception as ex:
            bad[r] = [f'route did not render: {short(str(ex), 80)}']
            continue
        errs = [f'{k}: {short(x, 140)}' for k, x, _ in app.errors[e0:]]
        if app.has('#content .card.err'):
            errs.append('error card: ' + short(app.text('#content .card.err'), 140))
        if len(app.text().strip()) < 20:
            errs.append('blank screen')
        if errs: bad[r] = errs
    SMOKE_DETAIL[label] = bad
    if not app.lite:
        has3d = []
        for r in ('body', 'projection'):
            app.go(r, settle=600)
            if app.has('#content canvas'): has3d.append(r)
        app.notes.append(f'3D canvas mounted on: {", ".join(has3d) or "none (SVG fallback)"}')
    t.check(not bad, f'{len(bad)} route(s) with errors', 'all 14 routes clean',
            '; '.join(f'{r}: {v[0]}' for r, v in bad.items()))


@test('S1', 'Smoke: every route, fresh profile')
def t_smoke_fresh(t, ctx):
    smoke(t, {}, 'fresh')


@test('S2', 'Smoke: every route, Bob + Iron Runner data')
def t_smoke_bob(t, ctx):
    smoke(t, bobir(t.app), 'bob')


@test('S3', 'Perf: every screen renders (sync JS) in < 1.5 s with Bob data')
def t_perf(t, ctx):
    perf = SMOKE_PERF.get('bob') or SMOKE_PERF.get('fresh') or {}
    t.check(perf, 'render timings', 'smoke ran', 'no timings')
    slow = {r: ms for r, ms in sorted(perf.items(), key=lambda x: -x[1]) if ms > 1500}
    top = ', '.join(f'{r} {ms}ms' for r, ms in sorted(perf.items(), key=lambda x: -x[1])[:4])
    t.check(not slow, 'slow screens', 'all < 1500 ms render+bind', f'slow: {slow}; top: {top}')
    t.app.notes.append('slowest: ' + top)


@test('S4', 'Smoke: a female profile mounts the female 3D body on Body + Projection (CONTRACT §21), no page errors')
def t_female_3d(t, ctx):
    app = t.app
    app.load({}, 'today')
    app.store("(store.updateProfile({ body: { ...store.getProfile().body, sex: 'female', heightIn: 64, birthYear: 1992 } }), "
              "store.logBodyweight(ds, 140), store.logMeasurement({ d: ds, neck: 13, shoulders: 40, chest: 35, waist: 29, hips: 39, "
              "armL: 11.5, armR: 11.5, forearm: 9.5, thighL: 22, thighR: 22, calfL: 14, calfR: 14 }), 1)")
    reqs = []
    on_req = lambda r: reqs.append(r.url)
    app.page.on('request', on_req)
    e0 = len(app.errors)
    try:
        for r in ('body', 'projection'):
            app.go(r, settle=300)
            t.check(app.has('#content canvas', timeout=8000), f'{r}: 3D canvas mounted', 'canvas', 'none (SVG fallback)')
            try:
                app.page.wait_for_function("() => { const l = document.querySelector('#content .b3m .b3m-load'); return !!l && l.style.display === 'none'; }",
                                           timeout=30000, polling=200)
            except PWTimeout:
                raise Fail(f'{r}: female 3D model ready', 'model loaded and fitted', short(app.text('#content .b3m'), 80))
    finally:
        app.page.remove_listener('request', on_req)
    errs = app.errors[e0:]
    t.check(not errs, 'no page / console / http errors', 'none', '; '.join(short(e[1], 100) for e in errs[:2]))
    t.check(any(u.split('?')[0].endswith('/assets/body/body-female.bin') for u in reqs), 'female asset fetched', 'body-female.bin', [u.split('/')[-1] for u in reqs if '/assets/body/' in u])
    t.check(not any(u.split('?')[0].endswith('/assets/body/body.bin') for u in reqs), 'male asset not fetched for a female profile', 'no body.bin',
            [u.split('/')[-1] for u in reqs if '/assets/body/' in u])


@test('S5', 'Smoke: obese female + obese male profiles (with and without a tape) mount the 3D, sized to their weight (CONTRACT §21b)')
def t_obese_3d(t, ctx):
    """§21b: before the fix a 240/300 lb profile with no tape measurements rendered an average-sized body, and the
    shoulder girdle collapsed on very large bodies. Checks each profile mounts with no page errors and that the
    fitted geometry is as big as the body is."""
    app = t.app
    tape_f = ("neck: 15.5, shoulders: 49, chest: 47, waist: 44, hips: 52, armL: 15, armR: 15, forearm: 11.5, "
              "thighL: 28, thighR: 28, calfL: 17.5, calfR: 17.5")
    tape_m = ("neck: 18.5, shoulders: 56, chest: 52, waist: 52, hips: 50, armL: 17, armR: 17, forearm: 13.5, "
              "thighL: 29, thighR: 29, calfL: 18, calfR: 18")
    cases = [('obese female, taped', 'female', 64, 240, tape_f), ('obese female, no tape', 'female', 64, 240, None),
             ('obese male, taped', 'male', 70, 300, tape_m), ('obese male, no tape', 'male', 70, 300, None)]
    geoms = {}
    for i, (label, sex, h, w, tape) in enumerate(cases):
        app.load({}, 'today')
        meas = f"store.logMeasurement({{ d: ds, {tape} }}), " if tape else ""
        app.store(f"(store.updateProfile({{ body: {{ ...store.getProfile().body, sex: '{sex}', heightIn: {h}, birthYear: 1985 }} }}), "
                  f"store.logBodyweight(ds, {w}), {meas}1)")
        e0 = len(app.errors)
        app.go('body', settle=300)
        ok_canvas = app.has('#content canvas', timeout=8000)
        ready = True
        try:
            app.page.wait_for_function("() => { const l = document.querySelector('#content .b3m .b3m-load'); return !!l && l.style.display === 'none'; }",
                                       timeout=40000, polling=200)
        except PWTimeout:
            ready = False
        errs = app.errors[e0:]
        t.sub(f'S5{chr(97 + i)}', f'3D mounts for a {label} profile, no page errors', ok_canvas and ready and not errs,
              'body route', 'canvas mounted, model fitted, no errors',
              f'canvas={ok_canvas} ready={ready} errors=' + ('; '.join(short(e[1], 80) for e in errs[:2]) or 'none'))
        geoms[label] = app.page.evaluate(
            """() => Promise.all([import('/js/engine/anthro.js'), import('/js/engine/bodycomp.js'), import('/js/store.js'), import('/js/ui/projection.js')])
                 .then(([anthro, bc, s, proj]) => {
                   const b = bc.baseline({ profile: s.store.getProfile(), bodyLog: s.store.getBodyLog(), measurements: s.store.getMeasurements() });
                   const g = anthro.bodyGeometry({ ...proj.shapeOf({ measurements: b.measurements, weightLb: b.weightLb }, b.heightIn),
                                                   bodyFatPct: b.bodyFatPct, sex: b.sex });
                   return { waist: g.breadths.waist, chest: g.breadths.chest, biacromial: g.breadths.biacromial, bideltoid: g.breadths.bideltoid,
                            shoulders: g.inputs.shoulders, h: g.heightIn };
                 })""")
    # the untaped bodies must be sized from their weight, i.e. close to the taped ones, not to the median adult
    for sex, lo, hi in [('female', 'obese female, taped', 'obese female, no tape'), ('male', 'obese male, taped', 'obese male, no tape')]:
        a, b = geoms[lo], geoms[hi]
        close = a and b and abs(b['waist'] / a['waist'] - 1) < 0.25 and abs(b['chest'] / a['chest'] - 1) < 0.20
        t.sub('S5' + ('e' if sex == 'female' else 'f'), f'untaped obese {sex} is sized from weight, not the median adult', close,
              'waist / chest breadth', f"within 25 % of the taped body ({a['waist']:.1f} / {a['chest']:.1f} in)",
              f"{b['waist']:.1f} / {b['chest']:.1f} in" if b else 'no geometry')
        wide = b and b['bideltoid'] > b['biacromial'] * 1.06 and 0.19 < b['bideltoid'] / b['h'] < 0.42
        t.sub('S5' + ('g' if sex == 'female' else 'h'), f'untaped obese {sex} keeps a plausible shoulder girdle', wide,
              'bideltoid', '1.06-1.5x biacromial, 0.19-0.42 H', f"{b['bideltoid']:.1f} in vs biacromial {b['biacromial']:.1f} in" if b else 'none')


# ---------------------------------------------------------------- core flows
def _workout_test(loc):
    def fn(t, ctx):
        app = t.app
        if loc == 'home' or not ctx.get('chain'):
            app.load(bobir(app), 'today'); ctx['chain'] = True
        before = app.store(f"store.getSessions().filter(s => s.status === 'done' && s.location === '{loc}').length")
        log_workout(t, loc)
        after = app.store(f"store.getSessions().filter(s => s.status === 'done' && s.location === '{loc}').length")
        t.check(after == before + 1, 'session saved as done', f'{before + 1} done @{loc}', after)
        act = app.store('store.getActiveSession()')
        t.check(not act or act.get('status') == 'done', 'active session cleared', 'no active session', act and act.get('status'))
    return fn


for _i, _loc in enumerate(LOCS, 1):
    test(f'W{_i}', f'Workout @{_loc}: build → start → log → finish → summary')(_workout_test(_loc))


@test('P1', 'Plan my week + next 4 weeks')
def t_plan(t, ctx):
    app = t.app
    app.load(bobir(app), 'plan')
    msg = run_plan(app, 'plan-week')
    # lengthened weeks announce the extension instead (targets.extendedToast, since c82697a)
    t.check(msg and ('Planned' in msg or re.search(r'Extended .* weekly set targets', msg)), 'Plan my week', 'toast "Planned N sessions" or "Extended … weekly set targets"', msg or app.toasts())
    n = app.count('.pl-line.planned')
    t.check(n >= 3, 'planned day cards this week', '≥3 planned cards', n)
    t.check(app.has('.pl-sum .pl-bar-row'), 'week coverage card', 'coverage bars', short(app.text('.pl-sum'), 100))
    msg = run_plan(app, 'plan-4')
    t.check(msg and (re.search(r'Planned \d+', msg) or re.search(r'Extended .* weekly set targets', msg)), 'Plan next 4 weeks', 'toast "Planned N sessions" or "Extended …"', msg)
    end = (dt.date.today() + dt.timedelta(days=21)).isoformat()
    n4 = app.store(f"store.getPlanned({{ from: ds, to: '{end}' }}).length")
    t.check(n4 >= 12, 'sessions planned over 3+ weeks', '≥12 planned', n4)
    app.click('[data-a="next"]'); app.page.wait_for_timeout(150)
    t.check(app.count('.pl-line.planned') >= 3, 'next week shows plan', '≥3 planned cards', app.count('.pl-line.planned'))


@test('P2', 'Customize a day via the date builder → saved as Custom')
def t_custom_day(t, ctx):
    app = t.app
    d = tomorrow_str()
    app.load(bobir(app), 'plan')
    if not app.has(f'[data-day="{d}"]'):
        app.click('[data-a="next"]'); app.page.wait_for_timeout(150)
    app.click(f'[data-day="{d}"]')
    t.check(app.wait_sheet('[data-act="custom"]'), 'day sheet', 'Customize / Build my own action', short(app.text(app.sheet()), 120))
    app.click('#sheet-root > .sheet:last-child [data-act="custom"]')
    app.wait_route('today')
    t.check(app.has('.pl-planning', timeout=2000), 'date builder (planning mode)', '.pl-planning', short(app.text(), 120))
    app.click('[data-t="build"]')
    t.check(app.has('[data-t="save-plan"]', timeout=5000), 'preview with Save to plan', 'Save to plan', short(app.text(), 120))
    app.click('[data-t="save-plan"]')
    app.wait_route('plan')
    app.page.wait_for_timeout(150)
    tag = app.text(f'.pl-day:has([data-day="{d}"]) .pl-tag')
    t.check('custom' in tag.lower(), 'day card tag', 'Custom', tag or short(app.text(f'.pl-day:has([data-day="{d}"])'), 100))
    s = app.store(f"store.getPlanned({{ from: '{d}', to: '{d}' }}).map(s => s.plan && s.plan.auto)")
    t.check(s == [False], 'stored as plan.auto:false', '[false]', s)


@test('K1', 'Class picker opens (Today @Crunch + Plan day sheet)')
def t_classes(t, ctx):
    app = t.app
    app.load(bobir(app), 'today')
    pick_location_today(app, 'crunch')
    t.check(app.has('[data-t="class"]'), 'Do a class instead', 'button at Crunch', 'missing')
    app.click('[data-t="class"]')
    t.check(app.wait_sheet('.cls-picker'), 'class sheet', '.cls-picker in sheet', short(app.text(app.sheet()), 100))
    app.page.wait_for_function("() => !/Loading Crunch/.test(document.querySelector('#sheet-root > .sheet:last-child')?.innerText || '')", timeout=5000, polling=100)
    txt = app.text(app.sheet())
    t.check(re.search(r'\d+ classes|No more classes|No upcoming', txt), 'schedule loaded', 'class list', short(txt, 120))
    app.close_sheet()
    app.go('plan')
    app.click(f'[data-day="{tomorrow_str()}"]') if app.has(f'[data-day="{tomorrow_str()}"]') else app.click('[data-day]')
    t.check(app.wait_sheet('[data-act="class"]'), 'Plan day sheet: Pick a class', 'action', short(app.text(app.sheet()), 100))
    app.click('#sheet-root > .sheet:last-child [data-act="class"]')
    t.check(app.wait_sheet('.cls-picker'), 'Plan class picker', '.cls-picker', short(app.text(app.sheet()), 100))
    app.close_sheet()


@test('K2', 'Cardio quick log (Today → Just cardio → Log as done)')
def t_cardio_log(t, ctx):
    app = t.app
    app.load(bobir(app), 'today')
    before = app.store("store.getSessions().filter(s => s.status === 'done' && s.date === ds).reduce((n, s) => n + s.blocks.filter(b => b.kind === 'cardio').reduce((a, b) => a + (+b.minutes || 0), 0), 0)")
    app.click('[data-t="cardio"]')
    t.check(app.wait_sheet('[data-cf]'), 'cardio sheet', 'cardio form', short(app.text(app.sheet()), 100))
    app.click('#sheet-root > .sheet:last-child [data-cf-min="20"]')
    m = app.toast_mark()
    app.click('#sheet-root > .sheet:last-child [data-act="log"]')
    t.check(app.wait_toast('Logged', m), 'log toast', 'toast "Logged …"', app.toasts(m))
    after = app.store("store.getSessions().filter(s => s.status === 'done' && s.date === ds).reduce((n, s) => n + s.blocks.filter(b => b.kind === 'cardio').reduce((a, b) => a + (+b.minutes || 0), 0), 0)")
    t.check(after == before + 20, 'cardio minutes stored', before + 20, after)
    app.page.wait_for_timeout(200)
    hdr = app.text('.tr-stats')
    t.check(re.search(r'\b%d\b' % after, hdr) or str(after) in hdr, 'Today header cardio minutes', f'{after} cardio min shown', short(hdr, 100))


@test('J1', 'Projection controls respond (kcal preset, cardio step, horizon)')
def t_projection(t, ctx):
    app = t.app
    app.load(bobir(app), 'projection')
    kc = '#pjKcalV'
    t.check(app.has(kc, timeout=3000), 'what-if calories', '#pjKcalV', short(app.text(), 160))
    out0 = app.page.inner_html('#pjOut') if app.has('#pjOut') else ''
    k0 = app.text(kc)
    app.click('[data-preset="600"]')
    app.page.wait_for_timeout(500)
    k1 = app.text(kc)
    t.check(k1 != k0, 'calorie preset updates kcal', f'≠ {k0}', k1)
    out1 = app.page.inner_html('#pjOut') if app.has('#pjOut') else ''
    t.check(out1 != out0, 'outputs recompute after kcal change', '#pjOut changes', 'unchanged')
    app.click('[data-cstep="15"]'); app.page.wait_for_timeout(400)
    t.check('+15' in app.text('#pjCdV'), 'extra cardio stepper', '+15', app.text('#pjCdV'))
    hz = '#pjHV, #pjBadge, .bd-scrubhead'
    h0 = app.text('#pjHV') or app.text('#pjBadge')
    chip = app.page.evaluate("() => { const c = [...document.querySelectorAll('[data-hw], [data-weeks]')].filter(b => !b.classList.contains('active')); return c.length ? (c[c.length > 2 ? 2 : 0].dataset.hw ? '[data-hw=\"' + c[c.length > 2 ? 2 : 0].dataset.hw + '\"]' : '[data-weeks=\"' + c[c.length > 2 ? 2 : 0].dataset.weeks + '\"]') : null; }")
    if chip:
        app.click(chip)
    elif app.has('input[aria-label*="horizon" i]'):
        app.set_range('input[aria-label*="horizon" i]', 20)
    else:
        raise Fail('horizon control', 'horizon chips or slider', 'none found')
    app.page.wait_for_timeout(600)
    h1 = app.text('#pjHV') or app.text('#pjBadge')
    t.check(h1 and h1 != h0, 'horizon control changes the horizon', f'≠ {h0}', f'{h1} (via {chip or "slider"})')
    app.click('[data-reset]'); app.page.wait_for_timeout(300)


@test('N1', 'Nutrition targets save (2,650 kcal, simple mode)')
def t_nutrition(t, ctx):
    app = t.app
    app.load(bobir(app), 'more')
    app.click('[data-nav="nutrition"]'); app.wait_route('nutrition')
    app.click('[data-mode="simple"]'); app.page.wait_for_timeout(200)
    app.click('[data-basis] [data-v="cal"]')
    app.fill('#nVal', KCAL_GOAL)
    m = app.toast_mark()
    app.click('#nEdit [data-save]')
    t.check(app.wait_toast('saved', m), 'save toast', 'toast "Targets saved"', app.toasts(m))
    n = app.profile().get('nutrition') or {}
    t.check(n.get('calories') == KCAL_GOAL and n.get('mode') == 'simple', 'profile.nutrition', f'calories {KCAL_GOAL}, simple', n)
    app.page.wait_for_timeout(200)
    v = app.page.input_value('#nVal')
    t.check(str(KCAL_GOAL) in v.replace(',', ''), 'editor shows saved value', KCAL_GOAL, v)
    STATE['nutri'] = app.snapshot()


@test('U1', 'Supplements: add creatine, then remove')
def t_supps(t, ctx):
    app = t.app
    app.load(bobir(app), 'supplements')
    add_creatine(t)
    rows = app.text('.sp-row')
    t.check('Creatine' in rows, 'stack shows creatine', 'Creatine row', short(rows, 100))
    app.click('.sp-row', text='Creatine')
    t.check(app.wait_sheet('[data-del]'), 'edit sheet', 'Remove button', short(app.text(app.sheet()), 100))
    m = app.toast_mark()
    app.click('#sheet-root > .sheet:last-child [data-del]')
    t.check(app.wait_toast('Removed', m), 'remove toast', 'toast "Removed"', app.toasts(m))
    app.page.wait_for_timeout(250)
    sup = app.profile().get('supplements')
    t.check(not sup, 'stack empty', '[]', sup)


def add_creatine(t):
    app = t.app
    if not app.has('[data-detail="creatine"]'):
        cat = app.page.locator('[data-cat]', has_text=re.compile('supp', re.I))
        if cat.count(): cat.first.click(); app.page.wait_for_timeout(150)
    t.check(app.has('[data-detail="creatine"]'), 'creatine in browse list', '[data-detail=creatine]', short(app.text('.sp-cats'), 100))
    app.click('[data-detail="creatine"]')
    t.check(app.wait_sheet('[data-add]'), 'detail sheet', 'Add to stack', short(app.text(app.sheet()), 100))
    m = app.toast_mark()
    app.click('#sheet-root > .sheet:last-child [data-add]')
    t.check(app.wait_toast('added', m), 'add toast', 'toast "… added"', app.toasts(m))
    app.page.wait_for_timeout(300)
    ids = [s.get('id') for s in (app.profile().get('supplements') or [])]
    t.check('creatine' in ids, 'profile.supplements', 'creatine', ids)


# ---------------------------------------------------------------- cohesion (§18)
def find_and_set_cardio_target(app, value):
    """Set the weekly cardio target from the CURRENT screen's UI (chip, stepper, input, or tap-to-edit sheet).
    Returns (ok, how). Generic on purpose: works with any markup that labels things 'cardio'."""
    page = app.page

    def stored():
        try: return (app.profile() or {}).get('cardioTargetMin')
        except Exception: return None

    def done(how):
        page.wait_for_timeout(350)
        return (True, how) if stored() == value else None

    def try_scope(scope, label):
        # a) a chip/button whose text is exactly the value, inside something about cardio
        idx = page.evaluate(r"""([sc, v]) => { const all = [...document.querySelectorAll(sc + ' button, ' + sc + ' [role=button]')];
            return all.findIndex(b => b.offsetParent && (b.textContent || '').trim().replace(/[′']|\s*min$/g, '') === String(v)
              && /cardio/i.test((b.closest('.card, section, [class*=cardio], [data-tg-cardio], .sheet-body') || b.parentElement).textContent || '')); }""", [scope, value])
        if idx is not None and idx >= 0:
            app.click(f'{scope} button, {scope} [role=button]', nth=idx)
            r = done(f'{label}: chip "{value}"')
            if r: return r
        # b) stepper buttons labelled for the cardio target
        for _ in range(45):
            cur = stored() or 0
            if cur == value: return True, f'{label}: stepper'
            want = 'raise|more|increase|\\+' if cur < value else 'lower|less|decrease|−|-'
            n = page.evaluate("""([sc, w]) => { const re = new RegExp(w, 'i'); const all = [...document.querySelectorAll(sc + ' button[aria-label]')];
                return all.findIndex(b => b.offsetParent && !b.disabled && /cardio/i.test(b.getAttribute('aria-label')) && re.test(b.getAttribute('aria-label'))); }""", [scope, want])
            if n is None or n < 0: break
            app.click(f'{scope} button[aria-label]', nth=n); page.wait_for_timeout(90)
        if stored() == value: return True, f'{label}: stepper'
        # c) an input labelled cardio
        n = page.evaluate("""sc => { const ins = [...document.querySelectorAll(sc + ' input')];
            return ins.findIndex(i => i.offsetParent && ['number', 'range', 'text'].includes(i.type) && /cardio/i.test([i.name, i.id, i.getAttribute('aria-label'), ...Object.keys(i.dataset)].join(' '))); }""", scope)
        if n is not None and n >= 0:
            el = page.locator(f'{scope} input').nth(n)
            if (el.get_attribute('type') or '') == 'range':
                el.evaluate("""(e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }""", str(value))
            else:
                el.fill(str(value)); el.dispatch_event('change')
            save = page.locator(f'{scope} button', has_text=re.compile(r'^\s*(save|apply|done|update|set)\b', re.I))
            if save.count(): save.first.click(timeout=2500, force=True)
            r = done(f'{label}: input')
            if r: return r
        return None

    r = try_scope('#content', 'Body inline')
    if r: return r
    openers = ['[data-tgt="cardio"]', '[data-focus="cardio"]', '[data-target="cardio"]', '[data-targets="cardio"]', '[data-edit="cardio"]']
    for sel in openers:
        if not app.has(f'#content {sel}'): continue
        app.click(f'#content {sel}')
        if not app.wait_sheet('', timeout=1500): continue
        r = try_scope('#sheet-root > .sheet:last-child .sheet-body', f'sheet via {sel}')
        if app.has('#sheet-root > .sheet:last-child'): app.close_sheet()
        if r: return r
    if app.has('#sheet-root > .sheet:last-child'): app.close_sheet()
    return False, 'no working cardio-target editor on Body (tried value chip, aria-labelled stepper, cardio input, [data-tgt=cardio] sheet)'


T225 = re.compile(r'/\s*225\b|\b225\s*(min|′)', re.I)


def near_225(text):
    m = T225.search(text or '')
    return text[max(0, m.start() - 40): m.end() + 20] if m else ''


@test('C1', 'Cohesion: 225 min cardio set on Body flows to Plan, Projection, Settings, Today')
def t_c1(t, ctx):
    app = t.app
    app.load(bobir(app), 'plan')
    run_plan(app, 'plan-4')
    c0, tg0, _ = plan_cardio(app)
    # a) set on Body
    app.tab('body')
    mark = app.toast_mark()
    ok, how = find_and_set_cardio_target(app, CARDIO_GOAL)
    p = app.profile()
    resolved = app.page.evaluate("""async () => { try { const m = await import('/js/engine/targets.js'); const { store } = await import('/js/store.js');
        return m.resolveTargets(store.getProfile(), { now: new Date(), sessions: store.getSessions() }).cardio.minPerWeek; } catch (e) { return 'n/a: ' + e.message.slice(0, 60); } }""")
    t.sub('C1a', 'Body: edit weekly cardio target → 225', ok, 'set cardio target on Body', f'profile.cardioTargetMin = {CARDIO_GOAL}',
          f'{p.get("cardioTargetMin")} ({how})', note=f'resolveTargets cardio = {resolved}')
    if not ok:
        app.store(f'store.updateProfile({{ cardioTargetMin: {CARDIO_GOAL} }})')
        app.notes.append('C1a fallback: target written via store.updateProfile')
    replan_toast = app.wait_toast(r'plan updated|updated .*plan|re-?plan|planned \\d+', since=0, timeout=8000)
    app.notes.append(f'replan toast: {short(replan_toast, 70) if replan_toast else "none within 8 s"}')
    if app.page.evaluate("() => document.querySelector('#content').dataset.route") != 'body':
        app.go('body')
    app.wait_text(T225.pattern, timeout=5000)
    btxt = app.text()
    t.sub('C1b', 'Body cardio card shows 225 target', bool(near_225(btxt)), 'Body cardio card', '"225 min/week"',
          short(near_225(btxt) or (re.search(r'[^\n]*cardio[^\n]*', btxt, re.I) or [''])[0], 80))
    # c) Plan coverage, without pressing Plan again (auto days should re-plan per §18)
    app.tab('plan')
    c1, tg1, warns = plan_cardio(app)
    cw = [w for w in warns if re.search(r'cardio', w, re.I)]
    within = c1 is not None and abs(c1 - CARDIO_GOAL) <= 0.15 * CARDIO_GOAL
    replanned = c1 is not None and c0 is not None and c1 > c0
    okc = tg1 == CARDIO_GOAL and (within or (replanned and cw))
    t.sub('C1c', 'Plan coverage: target 225, auto-replanned within ±15% (or shortfall explained)', okc,
          'Plan week coverage after target change', f'target 225; planned 191–259 or re-planned + cardio warning',
          f'target {tg1}; cardio {c1} (was {c0}/{tg0} before); warnings: {short("; ".join(cw), 90) or "none"}')
    plan_c, plan_warn = c1, cw
    if not okc:  # diagnostic: does a manual re-plan reach it?
        run_plan(app, 'plan-4')
        c2, tg2, warns2 = plan_cardio(app)
        cw2 = [w for w in warns2 if re.search(r'cardio', w, re.I)]
        within2 = c2 is not None and abs(c2 - CARDIO_GOAL) <= 0.15 * CARDIO_GOAL
        t.sub('C1c2', 'Plan: manual "Plan next 4 weeks" reaches 225 or explains shortfall (diagnostic)', within2 or bool(cw2 and c2 and c2 > (c0 or 0)),
              'manual re-plan', '191–259 min or shortfall warning', f'{c2}/{tg2}; warnings: {short("; ".join(cw2), 90) or "none"}',
              note=f'manual re-plan → {c2}/{tg2} min; {short("; ".join(cw2), 120)}')
        plan_c, plan_warn = c2, cw2
    # d) Projection
    app.go('projection', settle=400)
    pb, ps = projection_cardio(app)
    val = pb if pb is not None else ps
    adh = app.text('#pjAdhV') if app.has('#pjAdhV') else ''
    adh = (int(re.sub(r'[^\d]', '', adh) or 85) / 100) if adh else 0.85
    end27 = (dt.date.today() + dt.timedelta(days=27)).isoformat()
    avg4 = app.store(f"""store.getPlanned({{ from: ds, to: '{end27}' }}).reduce((n, s) => n + (s.blocks || []).reduce((a, b) => a + (b.kind === 'cardio' ? +b.minutes || 0 : b.kind === 'class' ? +(b.classify && b.classify.cardioMinutes) || 0 : 0), 0), 0) / 4""")
    exp_from_plan = (avg4 or 0) * adh
    consistent = val is not None and avg4 and (abs(val - exp_from_plan) <= 0.15 * max(exp_from_plan, 1) or abs(val - avg4) <= 0.15 * avg4)
    okp, desc = proj_ok(app, val)
    st = True if okp else ('warn' if consistent and plan_warn else False)
    t.sub('C1d', 'Projection weekly cardio ≈225', st, 'Projection cardio line',
          '180–270 min/wk raw or ÷ adherence (WARN = matches a plan that explains its shortfall)',
          f'{desc}; stat {ps}; 4-wk plan avg {avg4:.0f} × {adh:.0%} = {exp_from_plan:.0f}')
    # e) Settings
    app.go('settings', settle=200)
    sv = app.text('[data-cardio-v]') if app.has('[data-cardio-v]') else ''
    vals = app.page.evaluate("() => [...document.querySelectorAll('#content input')].map(i => i.value)")
    t.sub('C1e', 'Settings shows 225', '225' in sv or '225' in vals, 'Settings weekly cardio target', '225 min',
          sv or f'inputs: {vals[:6]}')
    # f) Today
    app.tab('today')
    tt = app.text()
    t.sub('C1f', 'Today reflects the 225 cardio need', bool(re.search(r'/\s*225\b|225 min', tt)), 'Today header / recommendations',
          '"x/225" cardio', short(app.text('.tr-stats') or tt[:120], 100))


@test('C1i', 'Cohesion: with room in the week, 225 on Body → plan ≈225 and projection ≈225')
def t_c1i(t, ctx):
    app = t.app
    app.load(bobir(app), 'plan')
    roomy = {'mon': ('lift', 60, 'crunch'), 'tue': ('cardio', 60, 'home'), 'wed': ('lift', 60, 'crunch'), 'thu': ('cardio', 60, 'home'),
             'fri': ('lift', 45, 'home'), 'sat': ('flex', 90, 'crunch'), 'sun': ('cardio', 45, 'home')}
    sched = {k: {'kind': a, 'minutes': b, 'location': c} for k, (a, b, c) in roomy.items()}
    app.store(f'store.updateProfile({{ schedule: {json.dumps(sched)} }})')
    app.load(None, 'plan')
    run_plan(app, 'plan-4')
    c0, tg0, _ = plan_cardio(app)
    app.tab('body')
    m = app.toast_mark()
    ok, how = find_and_set_cardio_target(app, CARDIO_GOAL)
    t.check(ok, 'set 225 on Body', 'Body cardio editor works', how)
    app.wait_toast(r'plan updated|updated .*plan|re-?plan|planned \\d+', since=m, timeout=8000)
    app.tab('plan')
    c1, tg1, warns = plan_cardio(app)
    end27 = (dt.date.today() + dt.timedelta(days=27)).isoformat()
    avg4 = app.store(f"""store.getPlanned({{ from: ds, to: '{end27}' }}).reduce((n, s) => n + (s.blocks || []).reduce((a, b) => a + (b.kind === 'cardio' ? +b.minutes || 0 : b.kind === 'class' ? +(b.classify && b.classify.cardioMinutes) || 0 : 0), 0), 0) / 4""")
    t.sub('C1i', 'Roomy week: auto re-plan puts ≈225 min cardio in the plan (±15%)', c1 is not None and abs(c1 - CARDIO_GOAL) <= 0.15 * CARDIO_GOAL,
          'Plan coverage after setting 225 on Body', '191–259 min this week',
          f'this week {c1}/{tg1} (was {c0}/{tg0}); 4-wk avg {avg4:.0f}/wk; warnings: {short("; ".join(w for w in warns if re.search("cardio", w, re.I)), 80) or "none"}')
    app.go('projection', settle=400)
    pb, ps = projection_cardio(app)
    val = pb if pb is not None else ps
    okp, desc = proj_ok(app, val)
    t.sub('C1j', 'Roomy week: projection weekly cardio ≈225', okp, 'Projection cardio line',
          '180–270 min/wk (raw or ÷ adherence)', f'{desc}; stat {ps}; 4-wk plan avg {avg4:.0f}')


@test('C1k', 'Cohesion: default schedule @225 → Make room → apply → plan ≈225')
def t_c1k(t, ctx):
    app = t.app
    app.load(bobir(app), 'plan')
    run_plan(app, 'plan-4')
    app.tab('body')
    m = app.toast_mark()
    ok, how = find_and_set_cardio_target(app, CARDIO_GOAL)
    t.check(ok, 'set 225 on Body', 'Body cardio editor works', how)
    app.wait_toast(r'plan updated|updated .*plan|re-?plan|planned \d+', since=m, timeout=8000)
    app.tab('plan')
    c0, tg0, _ = plan_cardio(app)
    sched0 = app.profile().get('schedule')
    t.check(app.has('[data-tg-room]', timeout=2000) or app.has('#content button', ) and app.page.locator('#content button', has_text=re.compile('make room', re.I)).count(),
            'Make room button on Plan', 'shown when 225 doesn\'t fit', f'coverage {c0}/{tg0}; ' + short(app.text('.pl-sum'), 120))
    if app.has('[data-tg-room]'): app.click('[data-tg-room]')
    else: app.click('#content button', text='make room')
    t.check(app.wait_sheet('[data-room-apply]'), 'Make room sheet', 'Apply and re-plan', short(app.text('#sheet-root'), 150))
    proposal = short(app.text('#sheet-root > .sheet:last-child .sheet-body'), 200)
    m = app.toast_mark()
    app.click('#sheet-root > .sheet:last-child [data-room-apply]')
    msg = app.wait_toast(r'plan updated|updated .*plan|re-?plan|planned \d+', since=m, timeout=10000)
    app.page.wait_for_timeout(300)
    if app.page.evaluate("() => document.querySelector('#content').dataset.route") != 'plan': app.tab('plan')
    else: app.go('plan')
    c1, tg1, warns = plan_cardio(app)
    sched1 = app.profile().get('schedule')
    changed = [k for k in (sched1 or {}) if (sched0 or {}).get(k) != sched1.get(k)]
    t.sub('C1k', 'Make room → apply: this week ≈225 min cardio (±15%)', c1 is not None and tg1 == CARDIO_GOAL and abs(c1 - CARDIO_GOAL) <= 0.15 * CARDIO_GOAL,
          'Plan coverage after Make room', '191–259 min, target 225',
          f'{c0} → {c1}/{tg1}; schedule changed: {changed}; toast: {short(msg, 60)}; warnings: {short("; ".join(w for w in warns if re.search("cardio", w, re.I)), 80) or "none"}',
          note=f'proposal: {proposal}')
    t.sub('C1l', 'Make room clears the shortfall prompt', not app.has('[data-tg-room]'), 'Plan after apply', 'no Make room button',
          'still shown: ' + short(app.text('.tg-roomline'), 100))
    app.go('projection', settle=300)
    pb, ps = projection_cardio(app)
    val = pb if pb is not None else ps
    okp, desc = proj_ok(app, val)
    t.sub('C1m', 'After Make room: projection weekly cardio ≈225', okp, 'Projection cardio line',
          '180–270 min/wk (raw or ÷ adherence)', f'{desc}; stat {ps}')


@test('C1g', 'Cohesion: Plan cardio stepper writes the shared target and re-plans')
def t_c1g(t, ctx):
    app = t.app
    app.load(bobir(app), 'plan')
    run_plan(app, 'plan-4')
    c0, tg0, _ = plan_cardio(app)
    t.check(app.has('[data-a="ct-inc"]'), 'Plan cardio stepper', '[data-a=ct-inc]', 'missing')
    m = app.toast_mark()
    for _ in range(7): app.click('[data-a="ct-inc"]'); app.page.wait_for_timeout(120)   # 120 → 225
    rt = app.wait_toast(r'plan updated|planned \d+', since=m, timeout=10000)   # re-plan is debounced + async
    app.page.wait_for_timeout(300)
    if not rt: app.notes.append('no "Plan updated" toast within 10 s')
    c1, tg1, warns = plan_cardio(app)
    p = app.profile().get('cardioTargetMin')
    toasts = ' | '.join(app.toasts(m))
    replanned = c1 is not None and c0 is not None and c1 > c0
    t.sub('C1g', 'Plan stepper → profile 225 + auto days re-planned', p == 225 and tg1 == 225 and replanned,
          'click + ×7 on Plan coverage stepper', 'target 225 and planned cardio increases without manual re-plan',
          f'profile {p}, coverage {c1}/{tg1} (was {c0}/{tg0}); toast: {short(toasts, 80)}')
    app.tab('body')
    app.wait_text(T225.pattern, timeout=5000)
    bt = app.text()
    t.sub('C1h', 'Body shows the target set on Plan', bool(near_225(bt)), 'Body cardio card', '225 min/week',
          short(near_225(bt) or (re.search(r'[^\n]*cardio[^\n]*', bt, re.I) or [''])[0], 80))


@test('C2', 'Cohesion: Nutrition calories → projection default intake')
def t_c2(t, ctx):
    app = t.app
    st = STATE.get('nutri')
    if not st:
        app.load(bobir(app), 'nutrition')
        app.store(f"store.updateProfile({{ nutrition: {{ ...store.getProfile().nutrition, mode: 'simple', calories: {KCAL_GOAL}, surplus: null }} }})")
        app.notes.append('N1 failed: target set via store')
        st = app.snapshot()
    app.load(st, 'nutrition')
    hero = app.text('.card.hero')
    m = re.search(r'([\d,]{4,})\s*kcal', hero)
    tv = int(m.group(1).replace(',', '')) if m else None
    t.sub('C2a', "Nutrition 'Today's target' = saved 2,650", tv is not None and abs(tv - KCAL_GOAL) <= 10, 'Nutrition Today card',
          KCAL_GOAL, tv if tv is not None else short(hero, 80))
    app.go('projection', settle=400)
    k = app.text('#pjKcalV') if app.has('#pjKcalV') else ''
    kv = int(re.sub(r'[^\d]', '', k) or 0) or None
    t.sub('C2b', 'Projection default intake = 2,650', kv is not None and abs(kv - KCAL_GOAL) <= 25, 'Projection what-if calories (default)',
          f'{KCAL_GOAL} kcal', k or short(app.text(), 100))
    note = app.text('#pjApplyNote') if app.has('#pjApplyNote') else ''
    t.sub('C2c', 'Projection names current targets', '2,650' in note or '2650' in note, 'Projection apply note', 'mentions 2,650 kcal', note)


@test('C3', 'Cohesion: creatine in Supplements → projection stack effect + water weight')
def t_c3(t, ctx):
    app = t.app
    app.load(bobir(app), 'supplements')
    add_creatine(t)
    imp = app.text('#sp-impact-wrap') if app.has('#sp-impact-wrap') else app.text()
    t.sub('C3a', 'Supplements impact shows water weight', bool(re.search(r'water', imp, re.I)), 'impact card', 'water-weight tile',
          short(imp, 120))
    app.go('projection', settle=500)
    pt = app.text()
    grp = app.text('#pjStackGrp') if app.has('#pjStackGrp') else ''
    t.sub('C3b', 'Projection lists the stack (creatine)', 'Creatine' in (grp or pt), 'projection stack group', 'Creatine + with/without toggle',
          short(grp or 'no stack group', 120))
    t.sub('C3c', 'Projection shows creatine water weight', bool(re.search(r'water', pt, re.I)), 'projection text', '"… lb of water …"',
          short(re.search(r'[^\n]*water[^\n]*', pt, re.I).group(0) if re.search(r'water', pt, re.I) else 'no water mention', 120))
    # stack toggle changes the outcome
    if app.has('[data-stack="0"]'):
        before = app.page.inner_html('#pjOut') if app.has('#pjOut') else ''
        app.click('[data-stack="0"]'); app.page.wait_for_timeout(500)
        after = app.page.inner_html('#pjOut') if app.has('#pjOut') else ''
        t.sub('C3d', 'With/without stack toggle changes the projection', before != after, 'toggle Without', 'outputs change', 'unchanged')
        app.click('[data-stack="1"]')


@test('C4', 'Cohesion: availability change in Plan → re-plan respects it')
def t_c4(t, ctx):
    app = t.app
    app.load(bobir(app), 'plan')
    run_plan(app, 'plan-4')
    app.click('[data-a="avail"]')
    t.check(app.wait_sheet('[data-k="wed"]'), 'availability sheet', 'weekday rows', short(app.text(app.sheet()), 100))
    S = '#sheet-root > .sheet:last-child'
    for sel in [f'{S} [data-k="wed"] [data-kind="rest"]', f'{S} [data-k="tue"] [data-kind="cardio"]',
                f'{S} [data-k="sun"] [data-kind="lift"]', f'{S} [data-k="sun"] [data-loc="office"]', f'{S} [data-k="sun"] [data-min="30"]']:
        app.click(sel); app.page.wait_for_timeout(80)
    app.click(f'{S} [data-save]')
    t.check(app.wait_sheet('[data-replan="4"]'), 're-plan prompt', 'Re-plan next 4 weeks', short(app.text(app.sheet()), 100))
    m = app.toast_mark()
    app.click(f'{S} [data-replan="4"]')
    app.wait_toast(r'Planned \d+|Nothing new', m, timeout=15000)
    app.page.wait_for_timeout(300)
    sch = app.profile().get('schedule', {})
    t.check(sch.get('wed', {}).get('kind') == 'rest' and sch.get('sun', {}).get('location') == 'office', 'availability saved',
            'wed rest, sun lift@office', {k: sch.get(k) for k in ('tue', 'wed', 'sun')})
    end = (dt.date.today() + dt.timedelta(days=27)).isoformat()
    rows = app.store(f"""store.getPlanned({{ from: ds, to: '{end}' }}).map(s => ({{ d: s.date, dow: new Date(s.date + 'T12:00').getDay(),
        kind: s.plan && s.plan.kind, auto: s.plan && s.plan.auto, loc: s.location, n: (s.blocks || []).length }}))""")
    wed = [r for r in rows if r['dow'] == 3 and r['kind'] != 'rest' and r['auto']]
    t.sub('C4a', 'Re-plan leaves Wednesdays as rest', not wed, 'planned sessions on Wednesdays', 'none (auto)', [r['d'] for r in wed])
    sun = [r for r in rows if r['dow'] == 0]
    sun_ok = sun and all(r['loc'] == 'office' and r['kind'] == 'lift' for r in sun)
    t.sub('C4b', 'Sundays planned: lift @No equipment', bool(sun_ok), 'planned Sundays', 'lift @office every Sunday',
          [(r['d'], r['kind'], r['loc']) for r in sun] or 'none planned')
    tue = [r for r in rows if r['dow'] == 2]
    tue_ok = tue and all(r['kind'] == 'cardio' for r in tue)
    t.sub('C4c', 'Tuesdays planned as cardio', bool(tue_ok), 'planned Tuesdays', 'cardio', [(r['d'], r['kind']) for r in tue] or 'none')


@test('C5', 'Cohesion: location switching always shows suggestions (Today, pill, Plan sheet, date builder)')
def t_c5(t, ctx):
    app = t.app
    app.load(bobir(app), 'today')
    discard_draft(app)
    miss = {}
    for loc in LOCS:
        pick_location_today(app, loc)
        n = app.count('[data-t="rec"]')
        if n < 1 or not app.has('[data-t="build"]'): miss[loc] = n
    t.sub('C5a', 'Today: recommendations at every location', not miss, 'Today location chips', '≥1 rec at home/crunch/travel/office',
          f'missing at {miss}' if miss else 'ok')
    # header pill
    app.click('#locpill')
    ok = app.wait_sheet('[data-loc="travel"]')
    if ok:
        app.click('#sheet-root > .sheet:last-child [data-loc="travel"]'); app.page.wait_for_timeout(400)
    active = app.page.get_attribute('[data-t="loc"].active', 'data-id') if app.has('[data-t="loc"].active') else None
    t.sub('C5b', 'Header location pill → Today follows', ok and active == 'travel' and app.count('[data-t="rec"]') >= 1,
          'pill → Hotel/Travel', 'builder at travel + recs', f'sheet {ok}, active chip {active}, recs {app.count("[data-t=rec]")}')
    # Plan day sheet
    d = tomorrow_str()
    app.go('plan')
    if not app.has(f'[data-day="{d}"]'):
        app.click('[data-a="next"]'); app.page.wait_for_timeout(150)
    app.click(f'[data-day="{d}"]')
    t.check(app.wait_sheet('[data-sloc]'), 'Plan day sheet Where row', '[data-sloc] chips', short(app.text(app.sheet()), 100))
    pmiss = {}
    for loc in LOCS:
        m = app.toast_mark()
        if app.has(f'#sheet-root > .sheet:last-child [data-sloc="{loc}"].active') and app.count('#sheet-root > .sheet:last-child .pl-blocks .list-item'):
            continue
        app.click(f'#sheet-root > .sheet:last-child [data-sloc="{loc}"]')
        msg = app.wait_toast(r':|No suggestion', m, timeout=8000)
        app.page.wait_for_timeout(250)
        n = app.count('#sheet-root > .sheet:last-child .pl-blocks .list-item')
        if not msg or 'No suggestion' in (msg or '') or n < 1: pmiss[loc] = msg or f'{n} blocks'
    t.sub('C5c', 'Plan day sheet: a suggestion at every location', not pmiss, 'tap each Where chip', 'suggested workout each time',
          f'failed at {pmiss}' if pmiss else 'ok')
    app.close_sheet()
    # date builder
    app.go(f'today?date={d}')
    t.check(app.has('.pl-planning', timeout=2000), 'date builder', '.pl-planning', short(app.text(), 80))
    dmiss = {}
    for loc in LOCS:
        sel = f'[data-t="loc"][data-id="{loc}"]'
        if not app.has(sel): dmiss[loc] = 'no chip'; continue
        app.click(sel); app.page.wait_for_timeout(200)
        n = app.count('[data-t="rec"]')
        if n < 1: dmiss[loc] = n
    t.sub('C5d', 'Date builder: recommendations at every location', not dmiss, 'date builder chips', '≥1 rec each', f'missing at {dmiss}' if dmiss else 'ok')


@test('C6', 'Cohesion: logging a workout updates Body, History, recovery and Plan')
def t_c6(t, ctx):
    app = t.app
    app.load(bobir(app), 'body')
    l0 = app.stat_value('Lift sets')
    app.go('history'); h0 = app.count('[data-sid]')
    app.tab('today')
    tiles0 = app.page.evaluate("() => [...document.querySelectorAll('[data-t=group]')].filter(b => /Today/.test(b.innerText)).length")
    log_workout(t, 'home', sets=3)
    app.tab('body')
    l1 = app.stat_value('Lift sets')
    t.sub('C6a', 'Body "Lift sets" increases', l0 is not None and l1 is not None and l1 >= l0 + 3, 'Body week stats', f'≥ {(l0 or 0) + 3}', f'{l0} → {l1}')
    app.go('history'); h1 = app.count('[data-sid]')
    top = app.text('[data-sid]')
    t.sub('C6b', 'History lists the new session', h1 == h0 + 1, 'History rows', h0 + 1, f'{h0} → {h1}; first: {short(top, 60)}')
    app.tab('today')
    tiles1 = app.page.evaluate("() => [...document.querySelectorAll('[data-t=group]')].filter(b => /Today/.test(b.innerText)).length")
    t.sub('C6c', 'Recovery tiles mark trained groups "Today"', tiles1 > tiles0, 'Today muscle tiles', 'more tiles say "Today"', f'{tiles0} → {tiles1}')
    app.tab('plan')
    t.sub('C6d', 'Plan shows today\'s done workout', app.count('.pl-day.today .pl-line.done') >= 1, 'Plan today card', 'done line ✓',
          short(app.text('.pl-day.today'), 80))


@test('C7', 'Cohesion: Settings cardio target → Body, Plan, Today follow (reverse direction)')
def t_c7(t, ctx):
    app = t.app
    app.load(bobir(app), 'settings')
    t.check(app.has('[data-cardio], input[aria-label*="cardio" i]'), 'Settings cardio control', 'slider/input', short(app.text(), 120))
    sel = '[data-cardio]' if app.has('[data-cardio]') else 'input[aria-label*="cardio" i]'
    m = app.toast_mark()
    app.set_range(sel, 150)
    app.page.wait_for_timeout(400)
    p = app.profile().get('cardioTargetMin')
    t.sub('C7a', 'Settings writes the shared target (150)', p == 150, 'move Settings slider to 150', 'profile.cardioTargetMin 150', p)
    app.wait_toast(r'plan updated|saved|cardio', since=m, timeout=3000)
    app.tab('body')
    snip = app.wait_text(r'/\s*150\b|\b150\s*(min|′)', timeout=3000)
    t.sub('C7b', 'Body shows 150', bool(snip), 'Body cardio card / targets strip', '150 min/week', snip or short(app.text(), 100))
    app.tab('plan')
    c, tg, _ = plan_cardio(app)
    t.sub('C7c', 'Plan coverage target 150', tg == 150, 'Plan coverage cardio row', '/150 min', f'{c}/{tg}')
    app.tab('today')
    snip = app.wait_text(r'/\s*150\b|150 min', timeout=2000)
    t.sub('C7d', 'Today shows 150', bool(snip), 'Today header', 'x/150', snip or short(app.text('.tr-stats'), 80))


@test('C8', 'Cohesion: Projection what-if is a preview until Apply; Apply updates Nutrition')
def t_c8(t, ctx):
    app = t.app
    app.load(STATE.get('nutri') or bobir(app), 'projection')
    n0 = app.profile().get('nutrition') or {}
    t.check(app.has('[data-preset]'), 'calorie presets', '[data-preset]', short(app.text(), 120))
    app.click('[data-preset="600"]'); app.page.wait_for_timeout(400)
    k = app.text('#pjKcalV')
    n1 = app.profile().get('nutrition') or {}
    t.sub('C8a', 'What-if slider does not change saved targets', (n1.get('calories'), n1.get('surplus')) == (n0.get('calories'), n0.get('surplus')),
          'tap "Bulk" preset (+600) without Apply', f'nutrition unchanged {n0.get("calories")}/{n0.get("surplus")}', f'{n1.get("calories")}/{n1.get("surplus")} (what-if shows {k})')
    if not app.has('[data-apply]'):
        raise Fail('Apply button', '[data-apply]', 'missing')
    m = app.toast_mark()
    app.click('[data-apply]')
    app.wait_toast(r'target|saved|applied', since=m, timeout=4000)
    app.page.wait_for_timeout(300)
    n2 = app.profile().get('nutrition') or {}
    app.go('nutrition', settle=300)
    hero = app.text('.card.hero')
    mm = re.search(r'([\d,]{4,})\s*kcal', hero)
    shown = int(mm.group(1).replace(',', '')) if mm else None
    want = int(re.sub(r'[^\d]', '', k) or 0)
    t.sub('C8b', 'Apply → Nutrition shows the applied intake', shown is not None and want and abs(shown - want) <= 30, 'Nutrition Today card after Apply',
          f'≈{want} kcal', f'{shown} kcal; profile.nutrition {dict((x, n2.get(x)) for x in ("mode", "calories", "surplus"))}')


# ---------------------------------------------------------------- accounts (CONTRACT §19)
def acct_mark(app):
    """Switching accounts reloads the page: mark the current document so we can wait for the new one."""
    app.page.evaluate('() => { window.__acctOld = 1; }')


def acct_wait_reload(app, route='today', timeout=15000):
    app.page.wait_for_function("r => !window.__acctOld && document.querySelector('#content')?.dataset.route === r",
                               arg=route, timeout=timeout, polling=80)
    app.page.wait_for_timeout(200)


def fg_keys(app):
    return {k: v for k, v in app.snapshot().items() if k.startswith('fg_')}


def other_keys(app):
    return sorted(k for k in app.snapshot() if k.startswith('fga_'))


@test('A1', 'Accounts: test persona is isolated from Bob (TEST badge, own workout, Bob intact after switching back)')
def t_accounts(t, ctx):
    app = t.app
    app.load(bobir(app), 'settings?section=accounts')
    bob = fg_keys(app)
    bob_done = app.store("store.getSessions().filter(s => s.status === 'done').map(s => s.id)")
    bob_w = app.store('store.getBodyLog().length')
    t.check(len(bob_done) >= 1, 'Bob fixture has workouts', '≥1 done session', len(bob_done))
    t.check(app.has('#sec-accounts'), 'Settings → Accounts section', '#sec-accounts', short(app.text(), 120))
    t.sub('A1a', 'Cloud not configured: section says so, local accounts still offered', app.has('[data-cloud-off]') and app.has('[data-acct-add]'),
          'Accounts section', 'data-cloud-off note + Add account', short(app.text('#acct-sec'), 160))
    t.sub('A1b', 'One account: no account chip or TEST badge in the header', not app.has('#acctchip') and not app.has('#hdr .test-badge'),
          'header', 'no chip', short(app.text('#hdr'), 80))
    app.click('[data-acct-add]')
    t.check(app.wait_sheet('[data-persona="woman28"]'), 'Add sheet lists test people', 'Woman, 28 persona', short(app.text(app.sheet()), 160))
    acct_mark(app)
    app.click('#sheet-root > .sheet:last-child [data-persona="woman28"]')
    acct_wait_reload(app, 'today')
    t.sub('A1c', 'Test account shows a TEST badge in the header', app.has('#hdr .test-badge') and app.has('#hdr.is-test'),
          'header after switching', 'TEST badge + amber rule', short(app.text('#hdr'), 80))
    p = app.profile()
    t.check((p.get('body') or {}).get('sex') == 'female' and (p.get('body') or {}).get('heightIn') == 64, 'persona profile',
            'female, 64 in', p.get('body'))
    n_sess = app.store('store.getSessions().length')
    t.sub('A1d', "Bob's data isn't visible in the test account", n_sess == 0 and app.store('store.getBodyLog().length') == 3,
          'store in test account', '0 sessions, 3 persona weigh-ins', f'{n_sess} sessions')
    app.go('history')
    t.sub('A1e', 'History is empty in the test account', app.count('[data-sid]') == 0, 'History rows', 0, app.count('[data-sid]'))
    app.go('measure')
    t.sub('A1f', 'TEST badge on sub-pages too', app.has('#hdr .test-badge'), 'Measurements header', 'TEST badge', short(app.text('#hdr'), 80))
    app.tab('today')
    log_workout(t, 'home')
    test_done = app.store("store.getSessions().filter(s => s.status === 'done').map(s => s.id)")
    t.check(len(test_done) == 1, 'workout saved in the test account', '1 done session', test_done)
    m = app.toast_mark()
    app.go('settings?section=accounts')
    app.close_sheet()
    # switch back through the header chip
    app.click('#acctchip')
    t.check(app.wait_sheet('[data-sw-acct="default"]'), 'header chip opens the switcher', 'switch sheet with Bob', short(app.text(app.sheet()), 120))
    acct_mark(app)
    app.click('#sheet-root > .sheet:last-child [data-sw-acct="default"]')
    acct_wait_reload(app, 'today')
    t.sub('A1g', 'Back on Bob: no TEST badge, account chip shows his name', not app.has('#hdr .test-badge') and 'Bob' in app.text('#acctchip'),
          'header', 'chip "Bob", no badge', short(app.text('#hdr'), 80))
    now_done = app.store("store.getSessions().filter(s => s.status === 'done').map(s => s.id)")
    t.sub('A1h', "Bob's workouts and weigh-ins intact; the test workout isn't there",
          sorted(now_done) == sorted(bob_done) and test_done[0] not in now_done and app.store('store.getBodyLog().length') == bob_w,
          "Bob's sessions", f'{len(bob_done)} done, no {test_done[0]}', f'{len(now_done)} done')
    after = fg_keys(app)
    changed = sorted(k for k in set(bob) | set(after) if bob.get(k) != after.get(k))
    t.sub('A1i', "Bob's fg_* keys byte-identical after the round trip", not changed, 'localStorage fg_*', 'no key changed', changed)
    # delete the test account from Settings
    app.go('settings?section=accounts')
    test_id = app.page.evaluate("() => [...document.querySelectorAll('[data-acct]')].map(b => b.dataset.acct).find(id => id !== 'default')")
    app.click(f'[data-acct="{test_id}"]')
    t.check(app.wait_sheet('[data-a-del]'), 'account sheet has Delete', 'Delete button', short(app.text(app.sheet()), 120))
    app.click('#sheet-root > .sheet:last-child [data-a-del]')
    t.check(app.wait_sheet('[data-del-go]'), 'delete confirm sheet', 'Delete button', short(app.text(app.sheet()), 120))
    m = app.toast_mark()
    app.click('#sheet-root > .sheet:last-child [data-del-go]')
    t.check(app.wait_toast('deleted', m), 'delete toast', 'toast "… deleted"', app.toasts(m))
    left = other_keys(app)
    t.sub('A1j', 'Deleting the test account removes only its keys', not left and fg_keys(app) == after and app.count('[data-acct]') == 1,
          'localStorage', 'no fga_* keys, fg_* unchanged, 1 account', f'{len(left)} fga_ keys left')


@test('A2', 'Accounts: blank account by name; deleting Bob\'s original account needs his name typed')
def t_accounts2(t, ctx):
    app = t.app
    app.load(bobir(app), 'settings?section=accounts')
    bob = fg_keys(app)
    app.click('[data-acct-add]')
    t.check(app.wait_sheet('[data-new-name]'), 'add sheet', 'name field', short(app.text(app.sheet()), 120))
    app.fill('#sheet-root > .sheet:last-child [data-new-name]', 'Sam')
    acct_mark(app)
    app.click('#sheet-root > .sheet:last-child [data-new-blank]')
    acct_wait_reload(app, 'today')
    p = app.profile()
    t.sub('A2a', 'Blank account uses the typed name, no TEST badge, chip shows it',
          p.get('name') == 'Sam' and 'Sam' in app.text('#acctchip') and not app.has('#hdr .test-badge') and app.store('store.getSessions().length') == 0,
          'new account', 'name Sam, 0 sessions', f"{p.get('name')}; chip {short(app.text('#acctchip'), 30)}")
    app.go('more')
    t.sub('A2b', 'More hub shows the new account', 'Sam · 0 workouts' in app.text(), 'More subtitle', 'Sam · 0 workouts logged', short(app.text('.page-head'), 80))
    app.go('settings?section=accounts')
    app.click('[data-acct="default"]')
    t.check(app.wait_sheet('[data-a-del]'), "Bob's account sheet", 'Delete button', short(app.text(app.sheet()), 120))
    app.click('#sheet-root > .sheet:last-child [data-a-del]')
    t.check(app.wait_sheet('[data-del-name]'), 'typed-name confirm for the original account', 'name field', short(app.text(app.sheet()), 160))
    go = '#sheet-root > .sheet:last-child [data-del-go]'
    dis0 = app.page.locator(go).is_disabled()
    app.page.locator('#sheet-root > .sheet:last-child [data-del-name]').fill('bo')
    dis1 = app.page.locator(go).is_disabled()
    app.page.locator('#sheet-root > .sheet:last-child [data-del-name]').fill('Bob')
    dis2 = app.page.locator(go).is_disabled()
    t.sub('A2c', 'Delete stays disabled until the name is typed', dis0 and dis1 and not dis2, 'Delete button', 'disabled, disabled, enabled', f'{dis0}, {dis1}, {dis2}')
    app.click('#sheet-root > .sheet:last-child [data-del-no]')
    app.page.wait_for_timeout(300)
    t.sub('A2d', "Cancel leaves Bob's account alone", fg_keys(app) == bob and app.count('[data-acct]') == 2, 'localStorage', 'fg_* unchanged', '')


class FakeSupabase:
    """Just enough GoTrue + PostgREST for the cloud UI (no real Supabase is reachable from the test box).
    Mirrors supabase/schema.sql: rows keyed (user, key), forge_push keeps only newer rows."""
    BASE = 'https://fake-forge.supabase.test'

    def __init__(self):
        self.users, self.tokens, self.rows, self.calls, self.n = {}, {}, {}, [], 0

    def _issue(self, email):
        self.n += 1
        at, rt = f'at{self.n}', f'rt{self.n}'
        self.tokens[at] = email
        return {'access_token': at, 'refresh_token': rt, 'token_type': 'bearer', 'expires_in': 3600,
                'expires_at': int(time.time()) + 3600, 'user': {'id': 'u-' + email, 'email': email}}

    def handle(self, route, request):
        u = request.url.replace(self.BASE, '')
        path, _, qs = u.partition('?')
        q = dict(x.split('=', 1) for x in qs.split('&') if '=' in x)
        cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json'}
        if request.method == 'OPTIONS':
            return route.fulfill(status=204, headers=cors, body='')
        body = json.loads(request.post_data) if request.post_data else None
        self.calls.append((request.method, path))
        who = self.tokens.get((request.headers.get('authorization') or '').replace('Bearer ', ''))
        def ok(data, status=200):
            route.fulfill(status=status, headers=cors, body='' if data is None else json.dumps(data))
        if path == '/auth/v1/signup':
            self.users[body['email']] = body['password']
            return ok(self._issue(body['email']))
        if path == '/auth/v1/token' and q.get('grant_type') == 'password':
            if self.users.get(body['email']) != body['password']:
                return ok({'error': 'invalid_grant', 'error_description': 'Invalid login credentials'}, 400)
            return ok(self._issue(body['email']))
        if path == '/auth/v1/logout':
            return ok(None, 204)
        if path == '/rest/v1/forge_state':
            if not who: return ok({'message': 'JWT expired'}, 401)
            rows = sorted(self.rows.get(who, {}).values(), key=lambda r: (r['synced_at'], r['key']))
            return ok(rows[int(q.get('offset', 0)): int(q.get('offset', 0)) + int(q.get('limit', 1000))])
        if path == '/rest/v1/rpc/forge_push':
            if not who: return ok({'message': 'JWT expired'}, 401)
            mine = self.rows.setdefault(who, {})
            for r in body['rows']:
                cur = mine.get(r['key'])
                if not cur or cur['updated_at'] < r['updated_at']:
                    mine[r['key']] = {'key': r['key'], 'value': r.get('value'), 'updated_at': r['updated_at'],
                                      'synced_at': dt.datetime.now(dt.timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')}
            return ok(len(body['rows']))
        return ok({'message': 'no route ' + path}, 404)

    def row(self, email, key):
        r = self.rows.get(email, {}).get(key)
        return r and r['value']


@test('A3', 'Cloud UI against a fake Supabase: sign up uploads Bob\'s data, writes push, sign out keeps data, sign-in again offers merge')
def t_accounts_cloud(t, ctx):
    app = t.app
    fake = FakeSupabase()
    cfg = ("export const config = { supabaseUrl: '%s', supabaseAnonKey: 'anon-test', oauthProviders: ['apple'], redirectUrl: '' };\n"
           "export default config;\n") % FakeSupabase.BASE
    cfg_route = lambda route, req: route.fulfill(status=200, headers={'content-type': 'text/javascript'}, body=cfg)
    app.page.route('**/js/config.js*', cfg_route)
    app.page.route(FakeSupabase.BASE + '/**', fake.handle)
    try:
        app.load(bobir(app), 'settings?section=accounts')
        bob = fg_keys(app)
        n_bob = app.store('store.getSessions().length')
        t.check(app.has('[data-cloud-signin]', timeout=3000), 'configured cloud offers sign-in', 'Sign in button', short(app.text('#acct-sec'), 160))
        app.click('[data-cloud-signin]')
        t.check(app.wait_sheet('[data-ci-email]'), 'sign-in sheet', 'email field', short(app.text(app.sheet()), 120))
        t.sub('A3a', 'Provider buttons only for configured providers', app.count('#sheet-root > .sheet:last-child [data-oauth]') == 1 and 'Apple' in app.text(app.sheet()),
              'sign-in sheet', 'one "Continue with Apple"', short(app.text(app.sheet()), 120))
        app.fill('#sheet-root > .sheet:last-child [data-ci-email]', 'bob@example.com')
        app.fill('#sheet-root > .sheet:last-child [data-ci-pw]', 'hunter22')
        m = app.toast_mark()
        app.click('#sheet-root > .sheet:last-child [data-ci-up]')
        t.check(app.wait_toast('backed up', m, timeout=8000), 'sign-up toast', "toast \"Signed in. This device's data is backed up.\"", app.toasts(m))
        app.page.wait_for_timeout(300)
        sec = app.text('#acct-sec')
        t.sub('A3b', 'Accounts shows the signed-in email and sync state', 'bob@example.com' in sec and re.search(r'synced', sec, re.I),
              'Accounts section', 'Signed in as bob@example.com · Last synced', short(sec, 160))
        n_rows = sum(1 for k in fake.rows.get('bob@example.com', {}) if k.startswith('s:'))
        t.sub('A3c', "Bob's sessions uploaded, one row each; fg_* keys untouched", n_rows == n_bob and fg_keys(app) == bob,
              'fake server rows', f'{n_bob} s:* rows', f'{n_rows} rows')
        # a weigh-in pushes after the debounce
        app.fill('[data-bw]', '161.5')
        app.page.locator('[data-bw]').dispatch_event('change')
        deadline = time.time() + 10
        while time.time() < deadline and not ((fake.row('bob@example.com', 'body') or [{}])[-1].get('w') == 161.5):
            app.page.wait_for_timeout(250)
        t.sub('A3d', 'A new weigh-in reaches the cloud (debounced push)', (fake.row('bob@example.com', 'body') or [{}])[-1].get('w') == 161.5,
              'fake server body row', 'last w 161.5', (fake.row('bob@example.com', 'body') or [{}])[-1])
        # sign out, keep data
        app.click('[data-cloud-signout]')
        t.check(app.wait_sheet('[data-so-keep]'), 'sign-out sheet', 'keep-data option', short(app.text(app.sheet()), 120))
        m = app.toast_mark()
        app.click('#sheet-root > .sheet:last-child [data-so-keep]')
        t.check(app.wait_toast('Signed out', m), 'sign-out toast', 'toast "Signed out…"', app.toasts(m))
        t.sub('A3e', 'Sign out keeps the data and revokes the session', ('POST', '/auth/v1/logout') in fake.calls and app.store('store.getSessions().length') == n_bob
              and app.has('[data-cloud-signin]'), 'after sign-out', 'logout called, sessions kept, sign-in offered again', '')
        # sign in again: both sides have data → choice sheet, merge
        app.click('[data-cloud-signin]')
        app.wait_sheet('[data-ci-email]')
        app.fill('#sheet-root > .sheet:last-child [data-ci-email]', 'bob@example.com')
        app.fill('#sheet-root > .sheet:last-child [data-ci-pw]', 'hunter22')
        app.click('#sheet-root > .sheet:last-child [data-ci-in]')
        t.sub('A3f', 'Signing in with data on both sides asks: merge / upload / replace', app.wait_sheet('[data-ch="merge"]', timeout=6000)
              and app.has('[data-ch="upload"]') and app.has('[data-ch="replace"]'), 'choice sheet', '3 choices', short(app.text(app.sheet()), 160))
        m = app.toast_mark()
        app.click('#sheet-root > .sheet:last-child [data-ch="merge"]')
        t.sub('A3g', 'Merge links the account again', bool(app.wait_toast('merged', m, timeout=8000)) and app.store('store.getSessions().length') == n_bob,
              'after merge', 'toast "…merged…", same sessions', app.toasts(m))
    finally:
        app.page.unroute('**/js/config.js*', cfg_route)
        app.page.unroute(FakeSupabase.BASE + '/**', fake.handle)
@test('X1', 'Female mode: choose Female in Measure, then Body/Measure/Nutrition/Projection/Supplements/Settings')
def t_female(t, ctx):
    """CONTRACT §20: a fresh profile set to female through the Measure profile card, smoke-tested on every screen that
    shows body comp, nutrition, hormones or milestones: no page errors, female text present, male-only text absent."""
    app = t.app
    app.load({}, 'measure')
    t.check(app.has('#bd-prof [data-pseg="sex"] [data-v="female"]'), 'sex selector on Measure', 'Female button', short(app.text(), 120))
    app.fill('#pFt', 5); app.fill('#pIn', 5); app.fill('#pBy', 1990)
    app.click('#bd-prof [data-pseg="sex"] [data-v="female"]')
    vis = app.page.evaluate("() => { const f = document.querySelector('#bd-prof [data-femalefields]'); return !!f && !f.hidden; }")
    t.check(vis, 'female fields appear', 'menopause/pregnancy/contraception selects visible', vis)
    app.page.select_option('#msx-meno', 'pre')
    m = app.toast_mark()
    app.click('[data-saveprof]')
    t.check(app.wait_toast('Profile saved', m), 'save profile', 'toast "Profile saved"', app.toasts(m))
    offered = app.wait_sheet('[data-fg-yes]', timeout=3000)
    t.sub('X1a', 'Female: switching sex offers (not forces) female sculpt goals', offered, 'goal sheet', 'sheet with "Use these goals"', short(app.text(app.sheet()), 120) if offered else 'no sheet')
    if offered:
        app.click('#sheet-root > .sheet:last-child [data-fg-yes]')
        app.page.wait_for_timeout(500)
    p = app.profile()
    body = p.get('body') or {}
    t.check(body.get('sex') == 'female' and body.get('menopause') == 'pre' and body.get('heightIn') == 65, 'profile stored', 'sex female, menopause pre, 65 in', body)
    t.sub('X1b', 'Female: sculpt goals switched only after consent', 'glute_shelf' in (p.get('sculptGoals') or []), 'profile.sculptGoals', 'female starting goals', p.get('sculptGoals'))
    app.store("(store.logBodyweight(ds, 140), store.logMeasurement({ d: ds, neck: 13, waist: 29, hips: 39, shoulders: 40, chest: 35, armL: 11, armR: 11.25, thighL: 22, thighR: 22 }), store.updateProfile({ nutrition: { ...store.getProfile().nutrition, mode: 'simple' } }), 1)")
    checks = [
        ('X1c', 'body', [], ['Adonis']),
        ('X1d', 'measure', [r'Waist : hip', r'healthy \d+–\d+% for women'], [r'Adonis', r'golden']),
        ('X1e', 'nutrition', [r'Iron', r'Energy availability'], [r'Eating on Adderall', r'marathon']),
        ('X1f', 'projection', [r'waist:hip', r'Waist:hip under 0\.85'], [r'V-taper', r'Adonis', r'race weight']),
        ('X1g', 'supplements', [r'Women ≈10–57'], [r'You take Adderall', r'men 19–39']),
        ('X1h', 'settings', [r'Sex', r'Menopause'], []),
    ]
    for sid, route, want, avoid in checks:
        e0 = len(app.errors)
        try:
            app.go(route, settle=450)
        except Exception as ex:
            t.sub(sid, f'Female: {route} renders', False, 'navigate', 'route renders', short(str(ex), 120)); continue
        if route == 'projection':
            app.wait_text(r'Milestones', timeout=4000)
            if app.has('details.bd-assume'): app.page.evaluate("() => document.querySelectorAll('details').forEach(d => d.open = true)")
        txt = app.text()
        errs = [f'{k}: {short(x, 100)}' for k, x, _ in app.errors[e0:]]
        miss = [w for w in want if not re.search(w, txt, re.I)]
        bad = [a for a in avoid if re.search(a, txt, re.I)]
        t.sub(sid, f'Female: {route} — no errors, female text, no male-only text', not errs and not miss and not bad, route,
              'no page errors; has ' + ', '.join(want or ['(render)']) + (('; none of ' + ', '.join(avoid)) if avoid else ''),
              f'errors={errs[:2]} missing={miss} male-only={bad}')
    # Testosterone detail sheet uses the female studies
    app.go('supplements', settle=300)
    app.click('[data-cat="prescription"]'); app.page.wait_for_timeout(250)
    app.click('[data-detail="trt"]')
    ok = app.wait_sheet('.sp-tsvg', timeout=3000)
    st = app.text(app.sheet()) if ok else ''
    t.sub('X1i', 'Female: testosterone sheet cites the female dose-response (Huang 2014), 24-week chart', ok and 'Huang 2014' in st and '24 weeks' in st,
          'TRT detail', 'Huang 2014 + 24-week chart', short(st, 160))
    app.close_sheet()
    # Pregnancy pauses the projection
    app.store("(store.updateProfile({ body: { ...store.getProfile().body, pregnancy: 'pregnant' } }), 1)")
    e0 = len(app.errors)
    app.go('projection', settle=450)
    txt = app.text()
    t.sub('X1j', 'Female: pregnancy pauses the projection', bool(re.search(r'Projection paused', txt)) and not app.errors[e0:], 'projection',
          '"Projection paused" card, no errors', short(txt, 160))
    app.store("(store.updateProfile({ body: { ...store.getProfile().body, pregnancy: null } }), 1)")


@test('E1', 'No console/page errors during flows')
def t_errors(t, ctx):
    app = t.app
    errs = list(app.errors)
    uniq = {}
    for k, x, r in errs:
        key = (k, short(x, 100))
        uniq.setdefault(key, r)
    t.check(not uniq, f'{len(uniq)} unique error(s) across the run', 'none',
            ' | '.join(f'[{r or "?"}] {k}: {x}' for (k, x), r in list(uniq.items())[:4]))


# ---------------------------------------------------------------- reporting
def git_info():
    try:
        head = subprocess.run(['git', '-C', str(ROOT), 'log', '-1', '--format=%h %s'], capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(['git', '-C', str(ROOT), 'status', '--short'], capture_output=True, text=True).stdout.strip().splitlines()
        return head, len(dirty)
    except Exception:
        return '?', 0


def report(total_secs, write=True):
    rows = RESULTS
    npass = sum(r['status'] == 'PASS' for r in rows)
    nfail = sum(r['status'] == 'FAIL' for r in rows)
    nwarn = sum(r['status'] == 'WARN' for r in rows)
    w = max(len(r['id']) for r in rows) if rows else 3
    print()
    print(f'{"ID":<{w}}  {"RESULT":<6}  CHECK')
    for r in rows:
        print(f'{r["id"]:<{w}}  {r["status"]:<6}  {r["name"]}')
        if r['status'] != 'PASS':
            print(f'{"":<{w}}          step: {short(r["step"], 110)}')
            print(f'{"":<{w}}          expected: {short(r["expected"], 110)}')
            print(f'{"":<{w}}          actual:   {short(r["actual"], 200)}')
            if r['shot']: print(f'{"":<{w}}          shot: {r["shot"]}')
        if r.get('note'): print(f'{"":<{w}}          note: {short(r["note"], 160)}')
    print(f'\n{npass} passed, {nfail} failed, {nwarn} warn · {total_secs:.0f}s')

    head, dirty = git_info()
    md = [f'# Forge E2E results', '',
          f'- Run: {dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")} · {total_secs:.0f}s · **{npass} pass / {nfail} fail / {nwarn} warn**',
          f'- Git: `{head}` + {dirty} uncommitted file(s)',
          f'- Command: `python3 e2e/run.py` (screenshots: `{SHOTS}/qa-*.png`)', '',
          '| ID | Check | Result | Failing step | Expected | Actual | Screenshot |', '|---|---|---|---|---|---|---|']
    esc = lambda s: short(s, 220).replace('|', '\\|')
    for r in rows:
        md.append(f'| {r["id"]} | {esc(r["name"])} | {"✅ PASS" if r["status"] == "PASS" else ("⚠️ WARN" if r["status"] == "WARN" else "❌ FAIL")} | '
                  f'{esc(r["step"])} | {esc(r["expected"]) if r["status"] != "PASS" else ""} | {esc(r["actual"]) if r["status"] != "PASS" else ""} | '
                  f'{("`" + r["shot"] + "`") if r["shot"] else ""} |')
    ctxs = [r for r in rows if r.get('page')]
    if ctxs:
        md += ['', '## Failure context (what the page showed)', ''] + [f'- **{r["id"]}**: {short(r["page"], 900).replace("|", "¦")}' for r in ctxs]
    notes = [r for r in rows if r.get('note')]
    if notes:
        md += ['', '## Notes', ''] + [f'- **{r["id"]}**: {esc(r["note"])}' for r in notes]
    if any(SMOKE_DETAIL.values()):
        md += ['', '## Smoke detail (route → errors)', '']
        for prof, bad in SMOKE_DETAIL.items():
            for route, errs in bad.items():
                md.append(f'- `{prof}` **{route}**: ' + '; '.join(esc(e) for e in errs[:3]))
    if write:
        RESULTS_MD.write_text('\n'.join(md) + '\n')
        print(f'wrote {RESULTS_MD}')
    else:
        print('partial run (-k): LAST_RESULTS.md not updated')
    return nfail


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-k', action='append', default=[], help='run only test ids starting with this (repeatable)')
    ap.add_argument('--headed', action='store_true')
    ap.add_argument('--full3d', action='store_true', help='run every test with WebGL on (slower)')
    a = ap.parse_args()
    SHOTS.mkdir(parents=True, exist_ok=True)
    for f in SHOTS.glob('qa-*.png'):
        try: f.unlink()
        except Exception: pass
    t0 = time.time()
    with Server() as srv, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROMIUM, headless=not a.headed, args=LAUNCH_ARGS)
        mk = lambda: browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, service_workers='block', locale='en-US')
        c3d, clite = mk(), (mk() if not a.full3d else None)
        app3d = App(c3d.new_page(), srv.base)
        applite = App(clite.new_page(), srv.base, lite=True) if clite else app3d
        ctx = {}
        sel = [x for x in TESTS if not a.k or any(x[0].startswith(k) for k in a.k)]
        # fixtures always run first when something depends on them
        if a.k and not any(x[0].startswith('F') for x in sel):
            sel = [x for x in TESTS if x[0] in ('F1', 'F2')] + sel
        for tid, name, fn in sel:
            ts, n0 = time.time(), len(RESULTS)
            app = app3d if tid in WEBGL_TESTS else applite
            if tid == 'E1':  # merge error logs from both pages
                applite.errors = app3d.errors + (applite.errors if applite is not app3d else [])
            run_test(app, tid, name, fn, ctx)
            st = [r['status'] for r in RESULTS[n0:]]
            agg = 'FAIL' if 'FAIL' in st else 'WARN' if 'WARN' in st else 'PASS'
            fails = ','.join(r['id'] for r in RESULTS[n0:] if r['status'] != 'PASS')
            print(f'  {tid:<4} {agg:<5} {time.time() - ts:5.1f}s  {name}' + (f'  [{fails}]' if fails and len(st) > 1 else ''), flush=True)
        c3d.close()
        if clite: clite.close()
        browser.close()
    nfail = report(time.time() - t0, write=not a.k)
    sys.exit(1 if nfail else 0)


if __name__ == '__main__':
    main()
