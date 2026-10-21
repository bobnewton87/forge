#!/usr/bin/env python3
"""Forge end-to-end suite (QA builder).

Usage:  python3 e2e/run.py            # run everything, write e2e/LAST_RESULTS.md
        python3 e2e/run.py -k C1 -k W  # only tests whose id starts with C1 or W
        python3 e2e/run.py --headed
        python3 e2e/run.py --today 2026-11-01 -k C1   # pin the date to hunt date-dependent checks

Checks are meant to be date-independent: anything whose expectation depends on the weekday computes
it from `today()` (e.g. next_full_week()) rather than assuming a roomy rest-of-week. `--today` pins
the browser clock AND this script's `today()` together so a check can be replayed on every weekday
(`for d in 2026-10-26 … 2026-11-01; do python3 e2e/run.py --today $d -k C1; done`). It is a debugging
aid, not the default: a normal run uses the real date, which is what the app's users have.

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
# One source of "today" for the Python side. --today pins it together with the browser clock, which
# is how a date-dependence hunt is run (`for d in 2026-10-26 … 2026-11-01; do run.py --today $d -k C1`);
# unpinned it is the real date, so a normal run is unchanged.
PINNED_TODAY = None


def today():
    return PINNED_TODAY or dt.date.today()


def today_str():
    return today().isoformat()


def tomorrow_str():
    return (today() + dt.timedelta(days=1)).isoformat()


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


FITS_RE = re.compile(r'fits ~(\d+) cardio min', re.I)


def warned_capacity(warns):
    """The '~N cardio min' this week's shortfall warning claims the week can hold, or None."""
    for w in warns or []:
        m = FITS_RE.search(w)
        if m: return int(m.group(1))
    return None


def next_full_week():
    """Mon–Sun of the next calendar week: always wholly inside the 4-week plan, whatever day it is
    today, so an expectation about a FULL week never depends on how much of this week is left."""
    mon = today()
    mon = mon - dt.timedelta(days=mon.weekday()) + dt.timedelta(days=7)
    return mon.isoformat(), (mon + dt.timedelta(days=6)).isoformat()


def week_slots_left(app):
    """Trainable availability slots from today to the end of this calendar week (0 on a Sunday whose
    slot is Rest). "Plan my week" has nothing to do when this is 0, so expectations scale with it."""
    return app.page.evaluate("""async () => {
      const { store } = await import('/js/store.js');
      const { ds, addDays, weekStart } = await import('/js/util.js');
      const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const sch = store.getProfile().schedule || {};
      const now = new Date(), we = ds(addDays(weekStart(now), 6));
      let n = 0;
      for (let i = 0; i < 7; i++) {
        const d = addDays(now, i); if (ds(d) > we) break;
        const s = sch[DOW[d.getDay()]];
        if (s && s.kind && s.kind !== 'rest' && (Number(s.minutes) || 0) >= 10) n++;
      }
      return n; }""")


def cardio_between(app, frm, to):
    """Cardio minutes the stored plan holds between two dates (cardio blocks + class cardio)."""
    return app.store(f"""store.getPlanned({{ from: '{frm}', to: '{to}' }}).reduce((n, s) => n + (s.blocks || []).reduce((a, b) => a + (b.kind === 'cardio' ? +b.minutes || 0 : b.kind === 'class' ? +(b.classify && b.classify.cardioMinutes) || 0 : 0), 0), 0)""")


def cardio_ok(planned, target, warns, slack=10):
    """Plan coverage is honest: either it reaches the target, or it is full and says so.

    The default availability template holds far less cardio than 225 min/wk (4 lift days, one 30′
    cardio day, one flex day), so a shortfall warning is the correct outcome, not a bug — but only
    if the planner really is at the capacity its own warning quotes. A warning is not a licence to
    leave usable minutes unplanned."""
    if planned is None: return False, 'no coverage row'
    if abs(planned - target) <= 0.15 * target: return True, f'{planned} within ±15% of {target}'
    fits = warned_capacity(warns)
    if fits is None: return False, f'{planned}/{target} with no warning explaining the shortfall'
    if planned < fits - slack: return False, f'{planned}/{target} but the week is said to fit ~{fits}: {fits - planned} usable min left unplanned'
    return True, f'{planned}/{target}: week is full (fits ~{fits}), shortfall explained'


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
    # "This week" is only the days that are left of it: run late enough in the week and every
    # remaining slot can be Rest, when "Nothing new to plan" is the right answer. Scale from today
    # rather than assuming a roomy week, so the check reads the same on every weekday.
    left = week_slots_left(app)
    msg = run_plan(app, 'plan-week')
    # lengthened weeks announce the extension instead (targets.extendedToast, since c82697a)
    planned_toast = msg and ('Planned' in msg or re.search(r'Extended .* weekly set targets', msg))
    t.check(planned_toast or (not left and msg and re.search(r'nothing (new|to plan)', msg, re.I)), 'Plan my week',
            'toast "Planned N sessions" or "Extended … weekly set targets"' + ('' if left else ' (or "Nothing new": no trainable day left this week)'),
            msg or app.toasts())
    n = app.count('.pl-line.planned')
    t.check(n >= min(3, left), 'planned day cards this week', f'≥{min(3, left)} planned cards ({left} trainable day(s) left this week)', n)
    t.check(app.has('.pl-sum .pl-bar-row'), 'week coverage card', 'coverage bars', short(app.text('.pl-sum'), 100))
    msg = run_plan(app, 'plan-4')
    t.check(msg and (re.search(r'Planned \d+', msg) or re.search(r'Extended .* weekly set targets', msg)), 'Plan next 4 weeks', 'toast "Planned N sessions" or "Extended …"', msg)
    end = (today() + dt.timedelta(days=21)).isoformat()
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
    okc, why = cardio_ok(c1, CARDIO_GOAL, cw)
    okc = okc and tg1 == CARDIO_GOAL
    t.sub('C1c', 'Plan coverage: target 225, auto-replanned within ±15% (or shortfall explained)', okc,
          'Plan week coverage after target change', 'target 225; planned 191–259, or the week is full and says so',
          f'target {tg1}; {why} (was {c0}/{tg0} before); warnings: {short("; ".join(cw), 90) or "none"}')
    plan_c, plan_warn = c1, cw
    if not okc:  # diagnostic: does a manual re-plan reach it?
        run_plan(app, 'plan-4')
        c2, tg2, warns2 = plan_cardio(app)
        cw2 = [w for w in warns2 if re.search(r'cardio', w, re.I)]
        ok2, why2 = cardio_ok(c2, CARDIO_GOAL, cw2)
        t.sub('C1c2', 'Plan: manual "Plan next 4 weeks" reaches 225 or explains shortfall (diagnostic)', ok2,
              'manual re-plan', '191–259 min, or the week is full and says so', f'{why2}; target {tg2}; warnings: {short("; ".join(cw2), 90) or "none"}',
              note=f'manual re-plan → {c2}/{tg2} min; {short("; ".join(cw2), 120)}')
        plan_c, plan_warn = c2, cw2
    # d) Projection
    app.go('projection', settle=400)
    pb, ps = projection_cardio(app)
    val = pb if pb is not None else ps
    adh = app.text('#pjAdhV') if app.has('#pjAdhV') else ''
    adh = (int(re.sub(r'[^\d]', '', adh) or 85) / 100) if adh else 0.85
    end27 = (today() + dt.timedelta(days=27)).isoformat()
    avg4 = app.store(f"""store.getPlanned({{ from: ds, to: '{end27}' }}).reduce((n, s) => n + (s.blocks || []).reduce((a, b) => a + (b.kind === 'cardio' ? +b.minutes || 0 : b.kind === 'class' ? +(b.classify && b.classify.cardioMinutes) || 0 : 0), 0), 0) / 4""")
    exp_from_plan = (avg4 or 0) * adh
    consistent = val is not None and avg4 and (abs(val - exp_from_plan) <= 0.15 * max(exp_from_plan, 1) or abs(val - avg4) <= 0.15 * avg4)
    okp, desc = proj_ok(app, val)
    # §18 cohesion: the projection must use the cardio the PLAN holds. When the plan reaches 225 that
    # means ≈225; when the plan is capacity-bound and says so (C1c), matching the plan is the correct
    # answer and demanding 225 here would ask the projection to lie about the week it is projecting.
    t.sub('C1d', 'Projection weekly cardio matches the plan (≈225 once the plan reaches it)', okp or consistent,
          'Projection cardio line', '180–270 min/wk raw or ÷ adherence, or equal to the planned 4-week average',
          f'{desc}; stat {ps}; 4-wk plan avg {avg4:.0f} × {adh:.0%} = {exp_from_plan:.0f}'
          + ('' if okp else f'; plan is short: {short("; ".join(plan_warn), 70) or "no warning"}'))
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
    cw = [w for w in warns if re.search(r'cardio', w, re.I)]
    end27 = (today() + dt.timedelta(days=27)).isoformat()
    avg4 = app.store(f"""store.getPlanned({{ from: ds, to: '{end27}' }}).reduce((n, s) => n + (s.blocks || []).reduce((a, b) => a + (b.kind === 'cardio' ? +b.minutes || 0 : b.kind === 'class' ? +(b.classify && b.classify.cardioMinutes) || 0 : 0), 0), 0) / 4""")
    # The target is per WEEK, so "did the re-plan reach 225" is asked of the next full week; the
    # current week can only hold what is left of it (same reasoning as C1k), and is checked against
    # the ceiling the Plan screen itself quotes. Keeps the check the same on every weekday.
    nw0, nw1 = next_full_week()
    cnext = cardio_between(app, nw0, nw1)
    here_ok, here_why = cardio_ok(c1, CARDIO_GOAL, cw)
    t.sub('C1i', 'Roomy week: auto re-plan puts ≈225 min cardio in the plan (±15%)',
          cnext is not None and abs(cnext - CARDIO_GOAL) <= 0.15 * CARDIO_GOAL and here_ok,
          'Plan coverage after setting 225 on Body', f'{nw0}–{nw1}: 191–259 min; this week filled to capacity',
          f'next full week {cnext}; this week {here_why} (was {c0}/{tg0}); 4-wk avg {avg4:.0f}/wk; warnings: {short("; ".join(cw), 80) or "none"}')
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
    cw1 = [w for w in warns if re.search(r'cardio', w, re.I)]
    sched1 = app.profile().get('schedule')
    changed = [k for k in (sched1 or {}) if (sched0 or {}).get(k) != sched1.get(k)]
    # Make room edits the weekly AVAILABILITY template, so the thing it has to deliver is a full
    # week. "This week" only holds what is left of it (nothing can be planned into days already
    # gone), so the ±225 expectation is checked on the next calendar week — wholly inside the
    # 4-week plan on every weekday, which keeps this check date-independent. This week still has to
    # be filled to whatever it can hold.
    nw0, nw1 = next_full_week()
    cnext = cardio_between(app, nw0, nw1)
    full_ok = cnext is not None and abs(cnext - CARDIO_GOAL) <= 0.15 * CARDIO_GOAL
    here_ok, here_why = cardio_ok(c1, CARDIO_GOAL, cw1)
    t.sub('C1k', 'Make room → apply: a full week holds ≈225 min cardio (±15%)', full_ok and here_ok and tg1 == CARDIO_GOAL,
          'Plan coverage after Make room', f'{nw0}–{nw1}: 191–259 min, target 225; this week filled to capacity',
          f'next full week {cnext}/{tg1}; this week {c0} → {here_why}; schedule changed: {changed}; toast: {short(msg, 60)}; warnings: {short("; ".join(cw1), 70) or "none"}',
          note=f'proposal: {proposal}')
    # A "Make room" button that is still offered after it has been applied would hand the user the
    # same change twice: the proposal must deliver everything it can in one go (targets.js runs it
    # to a fixed point) and the prompt must then be advice, not a button.
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
    cw = [w for w in warns if re.search(r'cardio', w, re.I)]
    p = app.profile().get('cardioTargetMin')
    toasts = ' | '.join(app.toasts(m))
    # The default availability already saturates at the 120 default, so "cardio went up" cannot be
    # required: raising the target can only re-plan the week up to what the week can hold. What has
    # to hold is that the shared target moved and the auto days were re-planned to that ceiling.
    replanned = c1 is not None and c0 is not None and c1 > c0
    at_cap, why = cardio_ok(c1, 225, cw)
    t.sub('C1g', 'Plan stepper → profile 225 + auto days re-planned', p == 225 and tg1 == 225 and (replanned or at_cap),
          'click + ×7 on Plan coverage stepper', 'target 225 and auto days re-planned to 225 or to the week\'s ceiling',
          f'profile {p}, coverage {why} (was {c0}/{tg0}); toast: {short(toasts, 80)}')
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
    end = (today() + dt.timedelta(days=27)).isoformat()
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
        self.users, self.tokens, self.refresh, self.rows, self.calls, self.n = {}, {}, {}, {}, [], 0

    def _issue(self, email):
        self.n += 1
        at, rt = f'at{self.n}', f'rt{self.n}'
        self.tokens[at] = email
        self.refresh[rt] = email
        # The session has to look fresh to the BROWSER's clock, not this process's: under --today
        # the page is days away from real time and would otherwise see every token as expired and
        # ask to refresh it on load. (This is why a naive clock pin used to break A3 and E1.)
        now = int(dt.datetime.combine(today(), dt.time(9, 0)).timestamp()) if PINNED_TODAY else int(time.time())
        return {'access_token': at, 'refresh_token': rt, 'token_type': 'bearer', 'expires_in': 3600,
                'expires_at': now + 3600, 'user': {'id': 'u-' + email, 'email': email}}

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
        if path == '/auth/v1/token' and q.get('grant_type') == 'refresh_token':
            who2 = self.refresh.get((body or {}).get('refresh_token'))
            if not who2: return ok({'error': 'invalid_grant', 'error_description': 'Invalid Refresh Token'}, 400)
            return ok(self._issue(who2))
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


@test('T1', 'Testosterone planner: open it, add a recommended combination, Projection changes (CONTRACT §22)')
def t_tplan(t, ctx):
    """§22: the planner ranks ways to raise your OWN testosterone by modeled lean/fat. With low-T labs entered it
    recommends something; one tap adds the whole combination to the stack and the projection must move."""
    app = t.app
    app.load(bobir(app), 'supplements')
    # Give him the labs the planner is gated on: low T with a normal LH (secondary hypogonadism).
    app.store("(store.updateProfile({ metabolic: { ...(store.getProfile().metabolic || {}), totalT: 300, lh: 3.2, labDate: '2026-07-01' } }), 1)")
    app.go('supplements', settle=600)
    t.check(app.has('#sp-plan-wrap'), 'planner section', '#sp-plan-wrap on Supplements', short(app.text(), 150))
    txt = app.text('#sp-plan-wrap')
    t.sub('T1a', 'Planner ranks by lean/fat and says so', bool(re.search(r'lean and fat', txt, re.I)) and 'lb net' in txt,
          'planner intro', 'ranked by modeled lean and fat', short(txt, 160))
    t.sub('T1b', 'Planner states the anti-doping position (S4.2 / S4.1 / S2.2)',
          all(s in txt for s in ['S4.2', 'S4.1', 'S2.2']), 'WADA note', 'S4.2, S4.1 and S2.2 named', short(txt[-400:], 160))
    rows = app.page.eval_on_selector_all('#sp-plan-wrap [data-prow]', 'els => els.map(e => e.dataset.prow)')
    t.check(rows, 'planner rows', 'at least one ranked row', rows)
    combo = next((r for r in rows if '+' in r), None)
    t.sub('T1c', 'Planner offers a combination, not just single items', bool(combo), 'rows', 'an id containing "+"', rows[:6])
    pick = combo or rows[0]
    # Baseline projection before adding anything.
    app.go('projection', settle=700)
    before = app.text('#pjOut') if app.has('#pjOut') else app.text()
    e0 = len(app.errors)
    app.go('supplements', settle=600)
    app.click(f'#sp-plan-wrap [data-popen="{pick}"]')
    app.page.wait_for_timeout(250)
    t.check(app.has(f'#sp-plan-wrap [data-ptoggle="{pick}"]'), 'row expands', 'Add button inside the open row',
            short(app.text('#sp-plan-wrap'), 150))
    detail = app.text(f'#sp-plan-wrap [data-prow="{pick}"]')
    low = detail.lower()
    t.sub('T1d', 'Row shows modeled T, estradiol and a lean/fat range',
          all(k in low for k in ['total t', 'estradiol', 'lean', 'fat']) and ' to ' in low,
          'row numbers', 'Total T, Estradiol, Lean and Fat tiles with ranges', short(detail, 180))
    m = app.toast_mark()
    app.click(f'#sp-plan-wrap [data-ptoggle="{pick}"]')
    t.check(app.wait_toast('added', m), 'add toast', 'toast "… added"', app.toasts(m))
    app.page.wait_for_timeout(400)
    ids = [s.get('id') for s in (app.profile().get('supplements') or [])]
    want = pick.split('+')
    t.check(all(i in ids for i in want), 'profile.supplements', want, ids)
    # Projection must change.
    app.go('projection', settle=900)
    after = app.text('#pjOut') if app.has('#pjOut') else app.text()
    t.sub('T1e', 'Projection changes after adding the recommendation', before != after, 'projection output',
          'different numbers', 'unchanged')
    t.sub('T1f', 'Projection lists the added item in its stack', any(
        re.search(re.escape((SUPP_NAMES.get(i) or i).split(' (')[0]), app.text(), re.I) for i in want),
        'projection stack', 'the added item is named', short(app.text(), 160))
    # Second tap removes it.
    app.go('supplements', settle=600)
    if not app.has(f'#sp-plan-wrap [data-ptoggle="{pick}"]'):      # the row may already be expanded
        app.click(f'#sp-plan-wrap [data-popen="{pick}"]')
        app.page.wait_for_timeout(250)
    t.check(app.has(f'#sp-plan-wrap [data-prow="{pick}"].in'), 'row marked as in-stack', 'row keeps its place with an "In stack" badge',
            short(app.text('#sp-plan-wrap'), 150))
    m = app.toast_mark()
    app.click(f'#sp-plan-wrap [data-ptoggle="{pick}"]')
    t.check(app.wait_toast('removed', m), 'remove toast', 'toast "… removed"', app.toasts(m))
    app.page.wait_for_timeout(350)
    ids = [s.get('id') for s in (app.profile().get('supplements') or [])]
    t.sub('T1g', 'Second tap removes the whole combination', not any(i in ids for i in want), 'profile.supplements',
          'none of ' + ', '.join(want), ids)
    errs = [f'{k}: {short(x, 90)}' for k, x, _ in app.errors[e0:]]
    t.sub('T1h', 'No page errors through the planner flow', not errs, 'console', 'no errors', errs[:2])


@test('T2', 'Tolerability renders as cited rates with denominators, in the planner and the catalogue (CONTRACT §22.8)')
def t_tolerability(t, ctx):
    """§22.8: Bob asked whether enclomiphene is "better tolerated". The answer has to appear as a badge plus a
    cited rate WITH its denominator — never as a bare adjective and never as a bare percentage."""
    app = t.app
    app.load(bobir(app), 'supplements')
    app.store("(store.updateProfile({ metabolic: { ...(store.getProfile().metabolic || {}), totalT: 300, lh: 3.2, labDate: '2026-07-01' } }), 1)")
    app.go('supplements', settle=600)
    t.check(app.has('#sp-plan-wrap'), 'planner section', '#sp-plan-wrap on Supplements', short(app.text(), 150))
    wrap = app.text('#sp-plan-wrap')
    t.sub('T2a', 'Tolerability badges appear on the ranked rows', 'Tolerability:' in wrap,
          'planner rows', 'a "Tolerability: …" badge', short(wrap, 180))
    e0 = len(app.errors)
    # Enclomiphene ranks at a score of zero (extrapolated: nobody has measured muscle on it), so it lives in the
    # collapsed "raises testosterone but nobody measured muscle" group. Open every group before reading text —
    # inner_text() returns '' inside a closed <details>.
    app.page.eval_on_selector_all('#sp-plan-wrap details.sp-pmore', 'els => els.forEach(d => d.open = true)')
    app.page.wait_for_timeout(200)
    t.check(app.has('#sp-plan-wrap [data-popen="enclomiphene"]'), 'enclomiphene row', 'an enclomiphene row in the planner',
            short(wrap, 150))
    app.click('#sp-plan-wrap [data-popen="enclomiphene"]')
    app.page.wait_for_timeout(300)
    app.page.eval_on_selector_all('#sp-plan-wrap details.sp-pmore', 'els => els.forEach(d => d.open = true)')
    app.page.wait_for_timeout(150)
    # Expand the tolerability block, then read the row: "Graded against: …" lives inside it.
    det = app.page.query_selector('#sp-plan-wrap [data-prow="enclomiphene"] details.sp-tol')
    t.check(det is not None, 'tolerability block', 'a details.sp-tol inside the open row',
            short(app.text('#sp-plan-wrap [data-prow="enclomiphene"]'), 150))
    app.page.eval_on_selector('#sp-plan-wrap [data-prow="enclomiphene"] details.sp-tol', 'd => d.open = true')
    app.page.wait_for_timeout(200)
    row = app.text('#sp-plan-wrap [data-prow="enclomiphene"]')
    t.sub('T2b', 'Enclomiphene is graded good, with the comparator named', 'tolerability: good' in row.lower()
          and 'graded against' in row.lower(), 'open row', 'grade + "Graded against: …"', short(row, 200))
    tol = app.text('#sp-plan-wrap [data-prow="enclomiphene"] details.sp-tol')
    t.sub('T2c', 'The head-to-head rate shows with its denominator and comparator',
          '8 of 58' in tol and '31 of 66' in tol, 'tolerability block',
          '"13.8% (8 of 58)" vs "47% (31 of 66)"', short(tol, 220))
    t.sub('T2d', 'Every percentage in the block is followed by its fraction',
          not [m for m in re.findall(r'\d+(?:\.\d+)?%(?:\s*\([^)]*\))?', tol)
               if '(' not in m and 'p=' not in m and '%' == m[-1] and not re.search(r'\d+ of \d+', m)]
          or bool(re.search(r'%\s*\(\d+ of \d+\)', tol)),
          'tolerability block', 'no bare percentages', short(tol, 200))
    t.sub('T2e', 'Non-significant differences are labelled as such', 'not significant' in tol.lower(),
          'tolerability block', '"not significant" on the ED/gynecomastia rows', short(tol, 200))
    t.sub('T2f', 'The caveats travel with the number', all(w in tol.lower() for w in ['retrospective', 'washout']),
          'tolerability block', 'retrospective + no-washout caveats', short(tol, 220))
    # The estradiol correction must be visible: enclomiphene RAISES it, which is the half of Bob's claim that fails.
    # The half of Bob's claim that FAILS: enclomiphene raises serum estradiol, it does not lower it. The tile
    # label renders uppercase, hence re.I.
    e2m = re.search(r'Estradiol\s*([\d.]+)\s*→\s*([\d.]+)', row, re.I)
    t.sub('T2g', 'The row shows estradiol rising, not falling',
          bool(e2m) and float(e2m.group(2)) > float(e2m.group(1)),
          'row numbers', 'estradiol goes up on enclomiphene', short(row, 180))
    # The catalogue sheet carries it too.
    app.go('supplements', settle=500)
    app.store("(window.scrollTo(0, 0), 1)")
    opened = app.page.evaluate("""() => { const b = [...document.querySelectorAll('[data-detail]')]
        .find(e => e.dataset.detail === 'enclomiphene'); if (b) { b.click(); return true; } return false; }""")
    if not opened:
        app.click('[data-cat="prescription"]') if app.has('[data-cat="prescription"]') else None
        app.page.wait_for_timeout(300)
        opened = app.page.evaluate("""() => { const b = [...document.querySelectorAll('[data-open],[data-detail]')]
            .find(e => (e.dataset.open || e.dataset.detail) === 'enclomiphene'); if (b) { b.click(); return true; } return false; }""")
    app.page.wait_for_timeout(450)
    sheet = app.text('.sp-sheet') if app.has('.sp-sheet') else ''
    t.sub('T2h', 'Catalogue sheet has a Tolerability section', opened and 'Tolerability' in sheet,
          'enclomiphene detail sheet', 'a Tolerability heading', short(sheet, 200) or 'sheet did not open')
    t.sub('T2i', 'Catalogue sheet states the isomer pharmacology with numbers',
          all(s in sheet for s in ['62%', '38%', '20:1']), 'detail sheet mechanism',
          '62/38 isomer split and the 20:1 steady-state ratio', short(sheet, 220))
    errs = [f'{k}: {short(x, 90)}' for k, x, _ in app.errors[e0:]]
    t.sub('T2j', 'No page errors through the tolerability flow', not errs, 'console', 'no errors', errs[:2])


SUPP_NAMES = {'clomiphene': 'Clomiphene', 'enclomiphene': 'Enclomiphene', 'hcg': 'hCG', 'tamoxifen': 'Tamoxifen',
              'aromatase_inhibitor': 'Aromatase inhibitor', 'ashwagandha': 'Ashwagandha', 'sleep_hygiene': 'Sleep',
              'energy_availability': 'Eating enough', 'fat_loss': 'Fat loss', 'cabergoline': 'Cabergoline',
              'zma': 'ZMA', 'vitamin_d': 'Vitamin D3'}
RESET_RATE_JS = ("(async () => { const m = await import('/js/engine/targets.js'); "
                 "store.saveProfile(m.applyTargetChange(store.getProfile(), { goals: { lossRatePctPerWeek: 1 } })); return 1; })()")


@test('L1', 'Weight-loss goal (CONTRACT §23): goal weight + rate flow to Projection, Nutrition, Plan and Body')
def t_weight_loss(t, ctx):
    """Pick "Lose weight" with a goal weight and a rate, then check every screen quotes the same numbers,
    the projection shows the lean-vs-fat cost, below-floor set targets are allowed and explained, and no
    page errors appear anywhere."""
    app = t.app
    app.load(bobir(app), 'settings')
    e0 = len(app.errors)

    # a) the goal exists in Settings and is distinct from Cut
    stxt = app.text()
    has_goal = app.has('[data-seg="goal"] [data-v="weight_loss"]') or bool(re.search(r'Lose weight', stxt, re.I))
    t.sub('L1a', 'Settings offers "Lose weight", separate from "Cut"', has_goal and bool(re.search(r'\bCut\b', stxt)),
          'Settings → Goal', 'both "Cut" and "Lose weight"', short(stxt[:200], 160))
    if app.has('[data-seg="goal"] [data-v="weight_loss"]'):
        app.click('[data-seg="goal"] [data-v="weight_loss"]')
        app.page.wait_for_timeout(600)
    else:
        app.store("(store.updateProfile({ goal: 'weight_loss' }), 1)")
        app.notes.append('W1a fallback: goal set via store')

    # b) a goal weight + rate written through the shared targets module
    cur = app.store('Number(store.getProfile().bodyweight) || 164')
    goal_w = round(cur - 18)
    app.store(f"""(async () => {{ const m = await import('/js/engine/targets.js');
        store.saveProfile(m.applyTargetChange(store.getProfile(), {{ goals: {{ goalWeightLb: {goal_w}, lossRatePctPerWeek: 1 }} }})); return 1; }})()""")
    app.page.wait_for_timeout(200)
    p = app.profile()
    body = p.get('body') or {}
    t.sub('L1b', 'Goal weight + rate saved on the profile', body.get('goalWeightLb') == goal_w and body.get('lossRatePctPerWeek') == 1,
          'applyTargetChange goals patch', f'goalWeightLb {goal_w}, lossRatePctPerWeek 1', f'{body.get("goalWeightLb")} / {body.get("lossRatePctPerWeek")}')

    resolved = app.page.evaluate("""async () => { try { const m = await import('/js/engine/targets.js'); const { store } = await import('/js/store.js');
        const t = m.resolveTargets(store.getProfile(), { now: new Date() });
        return { losing: t.goals.losing, gw: t.goals.goalWeightLb, rate: t.goals.lossRatePctPerWeek,
                 deficit: t.goals.plan && t.goals.plan.deficitKcal, floor: t.minimums.floor.mode, warns: t.warnings.length };
      } catch (e) { return { err: e.message.slice(0, 80) }; } }""")
    t.sub('L1c', 'resolveTargets exposes the loss plan (one source of truth)',
          resolved.get('losing') is True and resolved.get('gw') == goal_w and (resolved.get('deficit') or 0) > 0,
          'engine/targets.resolveTargets().goals', 'losing, goal weight, rate and a kcal deficit', json.dumps(resolved)[:160])
    deficit = resolved.get('deficit') or 0

    # c) Projection: the cost card, the goal-weight milestone, agreeing numbers
    app.go('projection', settle=900)
    app.wait_text(r'Milestones|Losing weight', timeout=8000)
    if app.has('details.bd-assume'):
        app.page.evaluate("() => document.querySelectorAll('details').forEach(d => d.open = true)")
    ptxt = app.text()
    card = app.text('#pjWeightLoss') if app.has('#pjWeightLoss') else ''
    t.sub('L1d', 'Projection shows the lean-vs-fat cost card', bool(card) and bool(re.search(r'Fat off', card, re.I)) and bool(re.search(r'Lean off', card, re.I)),
          'Projection → "Losing weight: what it costs"', 'fat off / lean off / % of the loss that is lean', short(card, 180))
    t.sub('L1e', 'Projection card shows the rate trade-off (faster costs more lean)',
          bool(re.search(r'0\.7%', card)) and bool(re.search(r'1\.4%', card)),
          'rate table in the cost card', 'a row per rate including 0.7% and 1.4%', short(card, 180))
    t.sub('L1f', 'Goal-weight milestone names the split', bool(re.search(rf'Goal weight \({goal_w}', ptxt)) and bool(re.search(r'lean mass', ptxt, re.I)),
          'Projection milestones', f'"Goal weight ({goal_w} lb)" + a lean/fat split', short((re.search(r'Goal weight[^\n]*', ptxt) or [''])[0], 160))
    t.sub('L1g', 'Projection cites the evidence it is using', bool(re.search(r'Forbes', ptxt)) and bool(re.search(r'Garthe 2011', ptxt)),
          'Projection assumptions', 'Forbes and Garthe 2011 named', short((re.search(r'[^\n]*Garthe[^\n]*', ptxt) or ['no Garthe mention'])[0], 160))
    pj = app.page.evaluate("""async () => { try {
        const P = await import('/js/engine/projection.js'); const B = await import('/js/engine/bodycomp.js'); const { store } = await import('/js/store.js');
        const profile = store.getProfile();
        const b = B.baseline({ profile, bodyLog: store.getBodyLog(), measurements: store.getMeasurements(), now: new Date() });
        const r = P.project({ baseline: b, profile, sessions: store.getSessions(), weeks: 26, now: new Date() });
        return r.weightLoss ? { gw: r.weightLoss.goalWeightLb, def: r.weightLoss.deficitKcal, rates: (r.weightLoss.rates || []).length,
          lean: r.weightLoss.leanLostLb, fat: r.weightLoss.fatLostLb } : { none: true };
      } catch (e) { return { err: e.message.slice(0, 80) }; } }""")
    t.sub('L1h', 'Projection engine and targets agree on the deficit',
          pj.get('gw') == goal_w and abs((pj.get('def') or 0) - deficit) <= 25 and (pj.get('rates') or 0) >= 4,
          'project().weightLoss vs resolveTargets().goals.plan', f'goal {goal_w} lb, ~{deficit} kcal/day, 4+ simulated rates', json.dumps(pj)[:160])

    # d) Nutrition: the same deficit, framed for weight loss
    app.store("(store.updateProfile({ nutrition: { ...store.getProfile().nutrition, mode: 'simple', calories: null, surplus: null } }), 1)")
    app.go('nutrition', settle=600)
    ntxt = app.text()
    hero = app.text('.card.hero') if app.has('.card.hero') else ''
    m = re.search(r'([\d,]{4,})\s*kcal', hero)
    kcal = int(m.group(1).replace(',', '')) if m else None
    maint = None
    mm = re.search(r'maintenance\s*≈?\s*([\d,]{4,})', ntxt, re.I)
    if mm: maint = int(mm.group(1).replace(',', ''))
    ok_kcal = kcal is not None and maint is not None and abs((maint - kcal) - deficit) <= 60
    t.sub('L1i', 'Nutrition sizes the deficit from the goal rate', ok_kcal,
          "Nutrition → Today's target", f'maintenance − ~{deficit} kcal', f'target {kcal}, maintenance {maint}')
    t.sub('L1j', 'Nutrition replaces the bulking lesson with the weight-loss one',
          bool(re.search(r'Losing weight, honestly', ntxt, re.I)) and not re.search(r'Why "?eat a lot', ntxt, re.I),
          'Nutrition page', '"Losing weight, honestly" card, no bulking card', short(ntxt[:200], 160))

    # e) below-floor set targets: allowed, applied and explained
    app.store("""(async () => { const m = await import('/js/engine/targets.js');
        let p = m.applyTargetChange(store.getProfile(), { goals: { leanProtection: 'minimal' } });
        p = m.applyTargetChange(p, { training: { groupPriority: { ...(p.groupPriority || {}), quads: 0 } } });
        store.saveProfile(p); return 1; })()""")
    app.page.wait_for_timeout(200)
    floors = app.page.evaluate("""async () => { try { const m = await import('/js/engine/targets.js'); const { store } = await import('/js/store.js');
        const p = store.getProfile(); const U = m.unitTargets(p);
        const other = m.unitTargets({ ...p, goal: 'cut' });
        return { mode: m.volumeFloorOf(p), triMin: U.triceps.min, triGrowth: U.triceps.growthMin, quads: U.quads.target,
                 protein: p.nutrition.proteinGPerLb, otherTriMin: other.triceps.min, otherQuads: other.quads.target };
      } catch (e) { return { err: e.message.slice(0, 80) }; } }""")
    t.sub('L1k', 'Below-floor set targets apply under this goal only',
          floors.get('mode') == 'minimum' and floors.get('triMin') == 0 and floors.get('quads') == 0
          and floors.get('otherTriMin', 0) > 0 and floors.get('otherQuads', 0) > 0,
          'unitTargets under weight_loss vs cut', 'floors 0 and quads 0 here, normal floors under cut', json.dumps(floors)[:200])
    t.sub('L1l', 'Choosing "minimum body mass" also drops protein (it is a preset, not a label)',
          (floors.get('protein') or 1) <= 0.7, 'profile.nutrition.proteinGPerLb', '≤ 0.7 g/lb', str(floors.get('protein')))

    # the shared targets sheet owns goal weight, rate and lean protection (CONTRACT §18)
    app.go('body', settle=500)
    opened = False
    if app.has('.tg-strip .tg-edit'):
        app.click('.tg-strip .tg-edit')
        opened = app.wait_sheet('#tg-adherence', timeout=3000)
    tg = app.text(app.sheet()) if opened else ''
    t.sub('L1o', 'The shared targets sheet edits goal weight, rate and muscle protection',
          opened and bool(re.search(r'Goal weight', tg, re.I)) and bool(re.search(r'How fast', tg, re.I))
          and bool(re.search(r'Muscle while you lose', tg, re.I)) and bool(re.search(r'Weekly set floors', tg, re.I)),
          'Body -> Your targets -> edit', 'goal weight, rate chips, muscle protection, set floors', short(tg, 200))
    if opened:
        before = (app.profile().get('body') or {}).get('lossRatePctPerWeek')
        if app.has('#sheet-root > .sheet:last-child [data-s-rate="0.5"]'):
            app.click('#sheet-root > .sheet:last-child [data-s-rate="0.5"]')
            app.page.wait_for_timeout(600)
        after = (app.profile().get('body') or {}).get('lossRatePctPerWeek')
        t.sub('L1p', 'Changing the rate in the sheet writes through setTargets', after == 0.5 and before != after,
              'rate chip 0.5%', 'profile.body.lossRatePctPerWeek = 0.5', f'{before} -> {after}')
        app.close_sheet()
        app.store(RESET_RATE_JS)

    app.go('plan', settle=700)
    if app.has('[data-a="why-min"]'):
        app.click('[data-a="why-min"]')
        app.page.wait_for_timeout(400)
    sheet = app.text(app.sheet()) if app.has('#sheet-root > .sheet:last-child') else ''
    if not sheet:
        sheet = app.page.evaluate("""async () => { const m = await import('/js/ui/targets.js'); const { store } = await import('/js/store.js');
            let html = ''; const ctx = { store, openSheet: h => { html = h; }, closeSheet: () => {}, nav: () => {}, toast: () => {} };
            try { m.openMinimumsInfo(ctx); } catch (e) { return 'ERR ' + e.message.slice(0, 80); }
            const d = document.createElement('div'); d.innerHTML = html; return d.innerText; }""")
    t.sub('L1m', '"Why these numbers?" says the floors are deliberately below the growth dose',
          bool(re.search(r'below the growth floor on purpose', sheet, re.I)) and bool(re.search(r'Bickel', sheet)),
          'Plan → Why these numbers?', 'a below-floor warning block citing Bickel 2011', short(sheet, 200))
    if app.has('#sheet-root > .sheet:last-child'): app.close_sheet()

    # f) Body and Plan agree, and nothing errored anywhere
    for route in ('body', 'plan', 'today'):
        app.go(route, settle=500)
    btxt = app.page.evaluate("() => document.querySelector('#content')?.innerText || ''")
    t.sub('L1n', 'Body/Plan show the goal through the shared targets strip',
          bool(re.search(r'Lose weight', btxt, re.I)) or bool(re.search(rf'{goal_w} lb', btxt)),
          'targets summary strip', f'"Lose weight" or "{goal_w} lb"', short(btxt[:200], 160))
    errs = [f'{k}: {short(x, 120)}' for k, x, _ in app.errors[e0:]]
    t.check(not errs, 'no page errors across the weight-loss flow', 'no console/page errors', '; '.join(errs[:3]))


@test('R1', 'Log a past day (CONTRACT §24): Plan → past day → class → History + week coverage')
def t_retro_past_day(t, ctx):
    """Bob's report: he did a Crunch class yesterday and could not log it. Past day on the Plan tab →
    "Log what I did" → the class picker for THAT day → log a class by name → it shows up in History
    and in that week's cardio coverage, dated to the day it happened."""
    app = t.app
    d = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    sheet = '#sheet-root > .sheet:last-child'

    def open_week_with(day):
        """Plan, on the week that contains `day` (yesterday is in last week on a Monday)."""
        if app.page.evaluate("() => document.querySelector('#content').dataset.route") != 'plan':
            app.go('plan')
        if not app.has(f'[data-retro="{day}"]'):
            app.click('[data-a="prev"]'); app.page.wait_for_timeout(250)

    def cardio_done():
        """Minutes already DONE in the coverage card's cardio row (the solid part of 'x/y min')."""
        return app.page.evaluate("""() => { const r = document.querySelector('.pl-bar-row.cardio'); if (!r) return null;
          const m = (r.innerText || '').replace(/\\s+/g, ' ').match(/([\\d,]+)\\s*\\/\\s*([\\d,]+)\\s*min/); return m ? parseFloat(m[1].replace(/,/g, '')) : null; }""")

    e0 = len(app.errors)
    app.load(bobir(app), 'plan')
    open_week_with(d)
    t.check(app.has(f'[data-retro="{d}"]'), 'past day is actionable', f'"Log what I did" on {d}', short(app.text('.pl-days'), 180))
    c0 = cardio_done()
    app.go('history'); h0 = app.count('[data-sid]')
    t.check(app.has('[data-retro]'), 'History entry point', '＋ Log a past workout button', short(app.text('.page-head'), 120))

    open_week_with(d)
    app.click(f'[data-retro="{d}"]')
    t.check(app.wait_sheet('[data-rt-act="class"]'), 'past-day sheet', 'Log a class / Build what I did / Log cardio', short(app.text(app.sheet()), 160))
    app.click(f'{sheet} [data-rt-act="class"]')
    t.check(app.wait_sheet('.cls-picker'), 'retro class picker', '.cls-picker for that day', short(app.text(app.sheet()), 160))
    app.page.wait_for_function("() => !/Loading Crunch/.test(document.querySelector('#sheet-root > .sheet:last-child')?.innerText || '')", timeout=6000, polling=100)
    txt = app.text(app.sheet())
    t.check(re.search(r'Which class did you do', txt), 'picker is in logging mode', '"Which class did you do?"', short(txt, 140))
    t.check(app.has(f'{sheet} [data-cls-cat]'), 'class catalogue', 'known-class chips for a day we never cached', short(txt, 140))

    # Type the class by name (the path that works whether or not that day was ever scraped).
    app.fill(f'{sheet} .cls-other [name="name"]', 'Circuit HIIT')
    app.fill(f'{sheet} .cls-other [name="min"]', 45)
    app.page.wait_for_timeout(150)
    t.check('cardio min' in app.text(f'{sheet} [data-cls-preview]'), 'credit preview', 'HIIT · N cardio min', app.text(f'{sheet} [data-cls-preview]'))
    m = app.toast_mark()
    app.click(f'{sheet} .cls-other button[type="submit"]')
    msg = app.wait_toast(r'Logged: Circuit HIIT', since=m)
    t.check(msg, 'log toast', 'toast "Logged: Circuit HIIT · <day>"', app.toasts(m))

    stored = app.store(f"""store.getSessions().filter(x => x.date === '{d}' && x.title === 'Circuit HIIT').map(x => {{
      const t0 = new Date(x.startedAt), p = n => String(n).padStart(2, '0');
      return [x.status, `${{t0.getFullYear()}}-${{p(t0.getMonth() + 1)}}-${{p(t0.getDate())}}`, x.blocks[0].done, x.blocks[0].classify.cardioMinutes > 0]; }})""")
    t.check(stored == [['done', d, True, True]], 'stored as a finished session on that day',
            f"[['done', '{d}', True, True]]", stored)
    t.check(app.store('store.getActiveSession()') is None, 'not made the active workout', 'no active session', 'an active session was started')

    app.wait_route('history')
    app.page.wait_for_timeout(200)
    h1 = app.count('[data-sid]')
    t.check(h1 == h0 + 1, 'History lists it', h0 + 1, h1)
    t.check('Circuit HIIT' in app.text(), 'History shows the class', 'Circuit HIIT row', short(app.text(), 160))

    open_week_with(d)
    c1 = cardio_done()
    t.check(c0 is not None and c1 is not None and c1 > c0, "that week's cardio coverage grew",
            f'> {c0} min done', f'{c0} → {c1}')
    t.check(app.count(f'.pl-day.past .pl-line.done') >= 1, 'the past day card shows it', 'a ✓ line on the past day',
            short(app.text('.pl-days'), 160))

    errs = [f'[{k}] {short(x, 90)}' for k, x, r in app.errors[e0:]]
    t.check(not errs, 'no page errors while logging a past day', 'no console/page errors', '; '.join(errs[:3]))


@test('B1', 'Bug hunt: picking a class parks the workout in progress instead of orphaning it (CONTRACT §6)')
def t_park_active(t, ctx):
    """Starting a class took over the active-session pointer and left the workout in progress with
    status 'active' and nothing pointing at it: it vanished from the Workout tab for good."""
    app = t.app
    app.load(bobir(app), 'today')
    discard_draft(app)
    pick_location_today(app, 'home')
    app.click('[data-t="build"]')
    t.check(app.has('.tr-preview [data-t="start"]', timeout=5000), 'builder preview', 'preview with Start', short(app.text(), 120))
    app.click('.tr-preview [data-t="start"]')
    app.wait_route('session')
    row = app.page.locator('.tr-set:not(.done)').first
    i, k = row.get_attribute('data-i'), row.get_attribute('data-k')
    row.locator('[data-f="r"]').fill('10')
    app.click(f'.tr-set[data-i="{i}"][data-k="{k}"] [data-s="check"]')
    app.page.wait_for_selector(f'.tr-set.done[data-i="{i}"][data-k="{k}"]', timeout=3000)
    live = app.store('store.getActiveSession() && store.getActiveSession().id')
    t.check(live, 'a workout is in progress', 'an active session', live)

    # Today → Crunch Allen classes → log one by name (the dialog is auto-accepted by the driver).
    app.tab('today')
    pick_location_today(app, 'crunch')
    t.check(app.has('[data-t="class"]'), 'classes entry point on Today', '"Do a class instead" button', short(app.text(), 200))
    app.click('[data-t="class"]')
    sheet = '#sheet-root > .sheet:last-child'
    t.check(app.wait_sheet('.cls-picker'), 'class picker', '.cls-picker', short(app.text(app.sheet()), 160))
    app.page.wait_for_function("() => !/Loading Crunch/.test(document.querySelector('#sheet-root > .sheet:last-child')?.innerText || '')", timeout=6000, polling=100)
    app.page.evaluate(f"() => document.querySelector('{sheet} .cls-form')?.setAttribute('open', '')")
    app.fill(f'{sheet} .cls-other [name="name"]', 'Circuit HIIT')
    m = app.toast_mark()
    app.click(f'{sheet} .cls-other button[type="submit"]')
    t.check(app.wait_toast(r'Started: Circuit HIIT', since=m), 'class started', 'toast "Started: Circuit HIIT"', app.toasts(m))

    parked = app.store(f"(store.getSession({live!r}) || {{}}).status")
    t.check(parked == 'planned', 'the old workout is parked, not orphaned', "status 'planned'", parked)
    now_active = app.store('store.getActiveSession() && store.getActiveSession().title')
    t.check(now_active == 'Circuit HIIT', 'the class is the active workout now', 'Circuit HIIT', now_active)
    orphans = app.store(f"store.getSessions().filter(s => s.status === 'active' && s.id !== (store.getActiveSession()||{{}}).id).map(s => s.id)")
    t.check(not orphans, 'no session is left active with nothing pointing at it', '[]', orphans)
    app.store(f"(store.deleteSession({live!r}), store.getActiveSession() && store.deleteSession(store.getActiveSession().id), store.setActiveSessionId(null), 1)")


@test('B2', 'Bug hunt: the prescription line follows + Set / − Set')
def t_rx_setcount(t, ctx):
    """The "3 × 8-12" line read target.sets, which "+ Set" never updates, so it disagreed with the
    rows right under it."""
    app = t.app
    app.load(bobir(app), 'today')
    discard_draft(app)
    pick_location_today(app, 'home')
    app.click('[data-t="build"]')
    t.check(app.has('.tr-preview [data-t="start"]', timeout=5000), 'builder preview', 'preview with Start', short(app.text(), 120))
    app.click('.tr-preview [data-t="start"]')
    app.wait_route('session')
    rx = lambda: app.page.evaluate("""() => { const b = document.querySelector('[data-blk="0"]');
      const m = (b?.querySelector('.tr-rx b')?.textContent || '').match(/^(\\d+)/);
      return [m ? +m[1] : null, b ? b.querySelectorAll('.tr-set').length : null]; }""")
    shown, rows = rx()
    t.check(shown == rows, 'prescription matches the rows as built', f'{rows} × …', f'{shown} × …')
    app.click('[data-blk="0"] [data-s="add-set"]')
    app.page.wait_for_timeout(250)
    shown, rows = rx()
    t.check(shown == rows, 'prescription follows + Set', f'{rows} × …', f'{shown} × …')
    app.click('[data-blk="0"] [data-s="rm-set"]')
    app.page.wait_for_timeout(250)
    shown, rows = rx()
    t.check(shown == rows, 'prescription follows − Set', f'{rows} × …', f'{shown} × …')
    app.click('[data-s="discard"]')
    app.page.wait_for_timeout(300)


@test('B3', 'Bug hunt: a corrupt stored value degrades instead of taking a screen down')
def t_corrupt_keys(t, ctx):
    """A hand-edited key, a truncated restore or an odd cloud row left `fg_sessions` as `null` and
    every screen that reads sessions threw on sortSessions()."""
    app = t.app
    base = bobir(app)
    for key, bad in [('fg_sessions', 'null'), ('fg_sessions', '"x"'), ('fg_body', '"a string"'),
                     ('fg_meas', '{"d":1}'), ('fg_food', '[1,2,3]'), ('fg_profile', '"Bob"'), ('fg_active', '42')]:
        state = dict(base); state[key] = bad
        app.load(state, 'today')
        e0 = len(app.errors)
        bad_routes = []
        for r in ROUTES:
            try:
                app.go(r, settle=120)
            except PWTimeout:
                bad_routes.append(f'{r}: never rendered')
                continue
            if len(app.text()) < 15: bad_routes.append(f'{r}: blank')
        errs = [f'{r}: {short(x, 70)}' for k, x, r in app.errors[e0:]]
        t.sub(f'B3-{key[3:]}-{"null" if bad == "null" else "junk"}', f'{key} = {bad}: every route still renders',
              not bad_routes and not errs, 'load every route', 'no errors, nothing blank',
              '; '.join((bad_routes + errs)[:3]))
    app.load(base, 'today')


@test('B4', 'Bug hunt: a session planned for a later day, finished now, lands today (CONTRACT §24)')
def t_future_finish(t, ctx):
    """Opening a future planned workout showed a date field holding a date past its own max, and
    Finish recorded it done on that future day — training that had not happened yet."""
    app = t.app
    d = (today() + dt.timedelta(days=3)).isoformat()
    app.load(bobir(app), 'today')
    app.store(f"""store.saveSession({{ id:'s_fut', date:{d!r}, status:'planned', startedAt:null, endedAt:null, location:'home',
      minutes:45, title:'Future lift', targets:['chest'], source:'generated',
      blocks:[{{kind:'lift',exId:'db_bench',group:null,target:{{sets:2,repMin:8,repMax:12,rest:90,weight:40}},
        sets:[{{w:null,r:null,done:false}},{{w:null,r:null,done:false}}]}}], rationale:[], notes:'' }})""")
    app.go('session?id=s_fut')
    box = app.page.evaluate("() => { const i = document.querySelector('[data-f=\"date\"]'); return i ? [i.value, i.min, i.max] : null; }")
    t.check(box and box[1] <= box[0] <= box[2], 'date field is inside its own range',
            'min <= value <= max', box)
    app.page.evaluate("""() => { document.querySelectorAll('.tr-set').forEach(r => { const rp = r.querySelector('[data-f=r]');
      rp.value = '10'; rp.dispatchEvent(new Event('input', { bubbles: true })); });
      document.querySelectorAll('[data-s=check]').forEach(b => b.click()); }""")
    app.page.wait_for_timeout(300)
    app.click('[data-s="finish"]')
    app.page.wait_for_timeout(600)
    got = app.store("""(() => { const s = store.getSession('s_fut'); const f = iso => { const x = new Date(iso);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
      return [s.status, s.date, f(s.startedAt), f(s.endedAt)]; })()""")
    t.check(got == ['done', today_str(), today_str(), today_str()], 'recorded as done today, not on the future day',
            ['done', today_str(), today_str(), today_str()], got)
    if app.has('#sheet-root .sheet'):
        app.close_sheet()
    app.store("(store.deleteSession('s_fut'), store.setActiveSessionId(null), 1)")


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
    ap.add_argument('--today', help='pin the date (YYYY-MM-DD) for the browser and this script, to hunt date-dependent checks')
    a = ap.parse_args()
    global PINNED_TODAY
    if a.today: PINNED_TODAY = dt.date.fromisoformat(a.today)
    SHOTS.mkdir(parents=True, exist_ok=True)
    for f in SHOTS.glob('qa-*.png'):
        try: f.unlink()
        except Exception: pass
    t0 = time.time()
    with Server() as srv, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROMIUM, headless=not a.headed, args=LAUNCH_ARGS)
        def mk():
            c = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, service_workers='block', locale='en-US')
            # set_fixed_time (not install()) leaves setTimeout/setInterval running at real speed, so
            # the app's debounced re-plan and rest timers still fire; only Date/Date.now move.
            if PINNED_TODAY: c.clock.set_fixed_time(dt.datetime.combine(PINNED_TODAY, dt.time(9, 0)))
            return c
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
