// Accounts UI (CONTRACT §19): Settings → Accounts section, add / switch / rename / delete sheets, the header
// account switcher, and cloud sign-in + sync wiring (startCloud is called once by main.js after the first draw).
// Switching accounts sets the active pointer and reloads, so every module starts clean on the new account.
import { accounts, store, DEFAULT_ACCOUNT } from '../store.js';
import { config } from '../config.js';
import { createCloud } from '../cloud/sync.js';
import { parseAuthFragment } from '../cloud/supabase.js';
import { PERSONAS, personaSeed } from '../data/personas.js';
import { esc } from './components.js';
import { ds } from '../util.js';

const PROVIDER_NAMES = { apple: 'Apple', google: 'Google', github: 'GitHub', azure: 'Microsoft' };
let cloudInst = null, lastCtx = null;

export function cloud() {
  if (!cloudInst) {
    cloudInst = createCloud({
      config,
      fetch: typeof fetch === 'function' ? (...a) => fetch(...a) : null,
      redirectUrl: config.redirectUrl || (location.origin + location.pathname),
      isOnline: () => navigator.onLine !== false,
      onStatus: () => paintSection(),
    });
  }
  return cloudInst;
}

// ---------- helpers ----------
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const shortName = a => String(a.name || '').replace(/^Test\s*·\s*/i, '') || 'Test';
function ago(isoStr) {
  const s = (Date.now() - Date.parse(isoStr)) / 1000;
  if (!(s >= 0)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
const icon = a => ({ cloud: '☁️', test: '🧪', local: '👤' })[accounts.kind(a)];
export function subLine(a) {
  const k = accounts.kind(a), c = a.cloud || {};
  if (k === 'test') return 'Test · never syncs';
  if (k === 'cloud') {
    const who = c.email || 'this account';   // an account linked before the email came back would read "undefined"
    if (!c.session) return `Cloud · ${who} · signed out`;
    if (c.lastError) return `Cloud · ${who} · ${c.lastError}`;
    return `Cloud · ${who} · ${c.lastSyncAt ? 'synced ' + ago(c.lastSyncAt) : 'not synced yet'}`;
  }
  if (c.userId) return 'On this device · sync setup not finished';
  return a.recovered ? 'On this device · recovered data' : 'On this device';
}
const testBadge = a => (accounts.kind(a) === 'test' ? ' <span class="test-badge">TEST</span>' : '');

function download(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileName = a => `forge-backup-${String(a.name || 'account').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account'}-${ds()}.json`;

// Switch = set the pointer, then reload so all module state resets (an active workout stays in its own account).
export function switchAccount(id, route = 'today') {
  try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (e) { /* ignore */ }
  setTimeout(() => {   // let blur → change handlers save first
    if (accounts.get(id)) accounts.switchTo(id);
    history.replaceState({ i: 0 }, '', location.pathname + location.search + '#/' + route);
    location.reload();
  }, 30);
}
const reloadTo = (route = 'today') => switchAccount(accounts.activeId(), route);

// "Tap again" guard for destructive buttons (same pattern as location delete).
function armed(btn, label = 'Tap again to confirm') {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; btn.dataset.label = btn.textContent; btn.textContent = label;
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
  return false;
}
async function busy(el, fn) {
  const bs = [...el.querySelectorAll('button')];
  bs.forEach(b => { b.disabled = true; });
  try { return await fn(); } finally { bs.forEach(b => { if (b.isConnected) b.disabled = false; }); }
}

// ---------- Settings section ----------
export function accountsSectionHTML() {
  return `<div class="section-title" id="sec-accounts">Accounts</div><div id="acct-sec">${sectionInner()}</div>`;
}
function sectionInner() {
  const list = accounts.list(), act = accounts.activeId(), a = accounts.active(), kind = accounts.kind(a), c = cloud();
  const rows = list.map(x => `<button class="list-item" data-acct="${esc(x.id)}"><span class="ic">${icon(x)}</span>
      <div class="grow"><div class="t">${esc(x.name)}${testBadge(x)}${x.id === act ? ' <span class="badge accent">Active</span>' : ''}</div><div class="s">${esc(subLine(x))}</div></div><span class="chev">›</span></button>`).join('');
  let cloudCard;
  if (!c.configured) cloudCard = `<p class="small muted" data-cloud-off>Cloud sign-in isn't set up yet. Accounts stay on this device.</p>`;
  else if (kind === 'test') cloudCard = `<p class="small muted">Test accounts never sync. Switch to a real account to sign in.</p>`;
  else if (kind === 'cloud') {
    const cl = a.cloud || {};
    cloudCard = `<p class="small">Signed in as <b>${esc(cl.email || '')}</b></p>
      <p class="small ${cl.lastError ? '' : 'muted'}" data-cloud-status style="${cl.lastError ? 'color:var(--warn)' : ''}">${cl.session ? (cl.lastError ? esc(cl.lastError) : cl.lastSyncAt ? 'Last synced ' + esc(ago(cl.lastSyncAt)) : 'Not synced yet') : 'Signed out on this device. Sign in again to sync.'}</p>
      <div class="btn-row mt">${cl.session ? '<button class="btn" data-cloud-sync>Sync now</button>' : '<button class="btn btn-primary" data-cloud-signin>Sign in again</button>'}<button class="btn btn-ghost" data-cloud-signout>Sign out</button></div>`;
  } else if (a.cloud && a.cloud.userId && a.cloud.session) {
    cloudCard = `<p class="small">Signed in as <b>${esc(a.cloud.email || '')}</b>, but sync isn't set up yet.</p><button class="btn btn-primary btn-block mt" data-cloud-finish>Finish setting up sync</button>`;
  } else {
    cloudCard = `<p class="small muted">Sign in to back up <b>${esc(a.name)}</b> and sync it across devices. Its data stays on this device too.</p><button class="btn btn-primary btn-block mt" data-cloud-signin>Sign in or create account</button>`;
  }
  return `<div class="list">${rows}
      <button class="list-item" data-acct-add><span class="ic">＋</span><div class="grow"><div class="t" style="color:var(--accent)">Add account</div><div class="s">New, copy of this one, or a test person</div></div></button></div>
    <div class="card">${cloudCard}</div>
    <p class="tiny muted" style="margin:6px 4px 0">Each account keeps its own workouts, body data and settings. Backup and restore (More) work on the active account.</p>`;
}
export function bindAccountsSection(root, ctx) {
  lastCtx = ctx;
  const sec = root.querySelector('#acct-sec');
  if (!sec) return;
  sec.querySelectorAll('[data-acct]').forEach(b => b.onclick = () => accountSheet(ctx, b.dataset.acct));
  sec.querySelector('[data-acct-add]').onclick = () => addSheet(ctx);
  sec.querySelector('[data-cloud-signin]')?.addEventListener('click', () => signInSheet(ctx, 'active'));
  sec.querySelector('[data-cloud-signout]')?.addEventListener('click', () => signOutSheet(ctx, accounts.activeId()));
  sec.querySelector('[data-cloud-finish]')?.addEventListener('click', async e => {
    e.target.disabled = true;
    try { afterAuth(ctx, await cloud().finishSetup()); } catch (err) { ctx.toast(err.message || 'Sync failed'); }
    paintSection();
  });
  sec.querySelector('[data-cloud-sync]')?.addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Syncing…';
    const r = await cloud().sync();
    ctx.toast(r.ok ? 'Synced' : (r.error || (r.offline ? "You're offline" : 'Not synced')));
    paintSection();
  });
}
function paintSection() {   // refresh the section in place (sync status changes don't go through the store)
  const sec = typeof document !== 'undefined' && document.getElementById('acct-sec');
  if (!sec || !lastCtx) return;
  sec.innerHTML = sectionInner();
  bindAccountsSection(sec.parentElement, lastCtx);
}

// ---------- Header switcher ----------
export function openSwitcher(ctx) {
  const list = accounts.list(), act = accounts.activeId();
  ctx.openSheet(`<h2>Switch account</h2><div class="list mt">${list.map(a => `<button class="list-item" data-sw-acct="${esc(a.id)}"><span class="ic">${icon(a)}</span>
      <div class="grow"><div class="t">${esc(a.name)}${testBadge(a)}</div><div class="s">${esc(subLine(a))}</div></div>${a.id === act ? '<span class="badge accent">Active</span>' : '<span class="chev">›</span>'}</button>`).join('')}</div>
    <button class="btn btn-ghost btn-block" data-sw-manage>Manage accounts</button>`, (el, close) => {
    el.querySelectorAll('[data-sw-acct]').forEach(b => b.onclick = () => { if (b.dataset.swAcct === act) close(); else switchAccount(b.dataset.swAcct); });
    el.querySelector('[data-sw-manage]').onclick = () => { close(); ctx.nav('settings', { section: 'accounts' }); };
  });
}

// ---------- Add ----------
function addSheet(ctx) {
  const c = cloud(), cur = accounts.active();
  ctx.openSheet(`<h2>Add account</h2><p class="small muted">Each account has its own workouts, body data and settings. You can switch any time.</p>
    <div class="field mt"><label>Name</label><input type="text" data-new-name maxlength="40" placeholder="e.g. Sam" autocomplete="off"></div>
    <label class="check"><input type="checkbox" data-new-test><span>Test account: shows a TEST badge and never syncs</span></label>
    <div class="sheet-actions"><button class="btn btn-primary btn-block" data-new-blank>Create new account</button>
      <button class="btn btn-block" data-new-copy>Copy of ${esc(cur.name)}</button></div>
    <div class="section-title">Test people</div>
    <div class="list">${Object.values(PERSONAS).map(p => `<button class="list-item" data-persona="${esc(p.id)}"><span class="ic">🧪</span><div class="grow"><div class="t">Test · ${esc(p.label)}</div><div class="s">${esc(p.note)}</div></div><span class="chev">›</span></button>`).join('')}</div>
    ${c.configured ? `<div class="section-title">Cloud</div><button class="btn btn-block" data-new-cloud>Sign in to an existing cloud account</button>` : ''}`, (el, close) => {
    const nameIn = el.querySelector('[data-new-name]'), testIn = el.querySelector('[data-new-test]');
    const make = opts => {
      try { const a = accounts.create(opts); switchAccount(a.id); }
      catch (e) { ctx.toast(e && /quota/i.test(e.name + e.message) ? 'Not enough storage on this device' : (e.message || 'Could not create account')); }
    };
    el.querySelector('[data-new-blank]').onclick = () => {
      const name = nameIn.value.trim();
      if (!name) { nameIn.focus(); ctx.toast('Give the account a name'); return; }
      make({ name, kind: testIn.checked ? 'test' : 'local' });
    };
    el.querySelector('[data-new-copy]').onclick = () => make({ name: nameIn.value.trim() || `Copy of ${cur.name}`, kind: testIn.checked ? 'test' : 'local', copyFrom: cur.id });
    el.querySelectorAll('[data-persona]').forEach(b => b.onclick = () => {
      const p = PERSONAS[b.dataset.persona];
      make({ name: p.name, kind: 'test', persona: p.id, seed: personaSeed(p.id, ds()) });
    });
    el.querySelector('[data-new-cloud]')?.addEventListener('click', () => { close(); setTimeout(() => signInSheet(ctx, 'new'), 300); });
  });
}

// ---------- Account detail ----------
function accountSheet(ctx, id) {
  const a = accounts.get(id);
  if (!a) return;
  const active = id === accounts.activeId(), kind = accounts.kind(a), c = cloud(), n = accounts.list().length;
  const stash = active ? accounts.stashed(id) : null;
  const cloudBtns = active && kind === 'cloud' && c.configured
    ? `${a.cloud.session ? '<button class="btn btn-block" data-a-sync>Sync now</button>' : '<button class="btn btn-primary btn-block" data-a-signin>Sign in again</button>'}
       <button class="btn btn-block" data-a-signout>Sign out</button>
       ${a.cloud.session ? '<button class="btn btn-danger btn-block" data-a-delcloud>Delete cloud account</button>' : ''}` : '';
  ctx.openSheet(`<div class="label">${kind === 'test' ? 'Test account' : kind === 'cloud' ? 'Cloud account' : 'Account on this device'}</div>
    <h2>${esc(a.name)}${testBadge(a)}</h2><p class="small muted">${esc(subLine(a))}${active ? ' · active' : ''}</p>
    ${!active && kind === 'cloud' ? '<p class="small muted mt">Switch to it to sync, sign out or delete the cloud account.</p>' : ''}
    <div class="row mt" style="gap:8px;align-items:flex-end"><div class="field grow" style="margin:0"><label>Name</label><input type="text" data-a-name maxlength="40" value="${esc(a.name)}"></div><button class="btn" data-a-rename>Rename</button></div>
    <div class="sheet-actions">
      ${!active ? '<button class="btn btn-primary btn-block" data-a-switch>Switch to this account</button>' : ''}
      ${cloudBtns}
      ${stash ? `<button class="btn btn-ghost btn-block" data-a-restore>Restore device data from before sign-in (${esc(String(stash.exportedAt || '').slice(0, 10))})</button>` : ''}
      <button class="btn btn-ghost btn-block" data-a-backup>Download a backup of this account</button>
      ${n > 1 ? '<button class="btn btn-danger btn-block" data-a-del>Delete from this device</button>' : ''}
    </div>`, (el, close) => {
    el.querySelector('[data-a-rename]').onclick = () => {
      try { accounts.rename(id, el.querySelector('[data-a-name]').value); close(); ctx.toast('Renamed'); ctx.rerender(); } catch (e) { ctx.toast(e.message); }
    };
    el.querySelector('[data-a-switch]')?.addEventListener('click', () => switchAccount(id));
    el.querySelector('[data-a-sync]')?.addEventListener('click', async e => {
      e.target.textContent = 'Syncing…';
      const r = await busy(el, () => cloud().sync());
      close(); ctx.toast(r.ok ? 'Synced' : (r.error || 'Not synced')); paintSection();
    });
    el.querySelector('[data-a-signin]')?.addEventListener('click', () => { close(); setTimeout(() => signInSheet(ctx, 'active'), 300); });
    el.querySelector('[data-a-signout]')?.addEventListener('click', () => signOutSheet(ctx, id));
    el.querySelector('[data-a-delcloud]')?.addEventListener('click', () => deleteCloudSheet(ctx, id));
    el.querySelector('[data-a-backup]').onclick = () => { download(accounts.exportOf(id), fileName(a)); ctx.toast('Backup downloaded'); };
    el.querySelector('[data-a-restore]')?.addEventListener('click', e => {
      if (!armed(e.target, 'Tap again: replaces current data')) return;
      try { store.importAll(stash, { merge: false }); accounts.dropStash(id); close(); ctx.toast('Device data restored'); } catch (err) { ctx.toast(err.message || 'Restore failed'); }
    });
    el.querySelector('[data-a-del]')?.addEventListener('click', () => deleteSheet(ctx, id));
  });
}

function deleteSheet(ctx, id) {
  const a = accounts.get(id);
  if (!a) return;
  if (accounts.list().length <= 1) { ctx.toast("Can't delete the only account"); return; }
  const isDefault = id === DEFAULT_ACCOUNT, kind = accounts.kind(a);
  ctx.openSheet(`<h2>Delete ${esc(a.name)}?</h2>
    <p class="small mt">Removes its workouts, weigh-ins, measurements and settings from this device. This can't be undone.</p>
    ${kind === 'cloud' ? '<p class="small muted mt">The cloud copy stays. Sign in again later to get it back.</p>' : ''}
    ${isDefault ? `<div class="field mt"><label>This is your original account. Type <b>${esc(a.name)}</b> to confirm.</label><input type="text" data-del-name autocomplete="off" autocapitalize="off" spellcheck="false"></div>` : ''}
    <div class="sheet-actions">
      <button class="btn btn-ghost btn-block" data-del-backup>Download a backup first</button>
      <button class="btn btn-danger btn-block" data-del-go ${isDefault ? 'disabled' : ''}>Delete ${esc(a.name)}</button>
      <button class="btn btn-ghost btn-block" data-del-no>Cancel</button>
    </div>`, (el, close) => {
    const go = el.querySelector('[data-del-go]'), nm = el.querySelector('[data-del-name]');
    const matches = () => !nm || nm.value.trim().toLowerCase() === String(a.name).trim().toLowerCase();
    if (nm) nm.addEventListener('input', () => { go.disabled = !matches(); });
    el.querySelector('[data-del-backup]').onclick = () => { download(accounts.exportOf(id), fileName(a)); ctx.toast('Backup downloaded'); };
    el.querySelector('[data-del-no]').onclick = close;
    go.onclick = () => {
      if (!matches()) return;
      const wasActive = id === accounts.activeId();
      try { accounts.remove(id); } catch (e) { ctx.toast(e.message); return; }
      if (wasActive) { reloadTo('today'); return; }
      close(); ctx.toast(`${a.name} deleted`); ctx.rerender();
    };
  });
}

// ---------- Cloud sheets ----------
function signInSheet(ctx, target = 'active') {
  const c = cloud(), a = accounts.active();
  if (!c.configured) { ctx.toast("Cloud sign-in isn't set up yet"); return; }
  ctx.openSheet(`<h2>${target === 'new' ? 'Sign in to a cloud account' : 'Back up & sync'}</h2>
    <p class="small muted">${target === 'new' ? 'Adds the account to this device and downloads its data.' : `Sign in or create an account to back up <b>${esc(a.name)}</b> and sync it across devices. Its data stays on this device too.`}</p>
    ${c.providers.map(p => `<button class="btn btn-block mt" data-oauth="${esc(p)}">Continue with ${esc(PROVIDER_NAMES[p] || p)}</button>`).join('')}
    ${c.providers.length ? '<p class="tiny muted center mt">or use email</p>' : ''}
    <div class="field mt"><label>Email</label><input type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" data-ci-email></div>
    <div class="field"><label>Password</label><input type="password" autocomplete="current-password" data-ci-pw></div>
    <p class="small" data-ci-msg role="status"></p>
    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-ci-in>Sign in</button>
      <button class="btn btn-block" data-ci-up>Create account</button>
      <button class="btn btn-ghost btn-block" data-ci-forgot>Forgot password?</button>
    </div>`, el => {
    const em = el.querySelector('[data-ci-email]'), pw = el.querySelector('[data-ci-pw]'), msg = el.querySelector('[data-ci-msg]');
    const say = (t, warn) => { msg.textContent = t; msg.style.color = warn ? 'var(--warn)' : ''; };
    const run = (label, fn) => busy(el, async () => {
      say(label);
      try { const r = await fn(); say(''); afterAuth(ctx, r, say); } catch (e) { say(e.message || 'Something went wrong', true); }
    });
    const valid = () => {
      if (!/^\S+@\S+\.\S+$/.test(em.value.trim())) { say('Enter your email', true); em.focus(); return false; }
      if (pw.value.length < 6) { say('Password needs at least 6 characters', true); pw.focus(); return false; }
      return true;
    };
    el.querySelector('[data-ci-in]').onclick = () => valid() && run('Signing in…', () => c.signIn(em.value, pw.value, { target }));
    el.querySelector('[data-ci-up]').onclick = () => valid() && run('Creating account…', () => c.signUp(em.value, pw.value, { target }));
    el.querySelector('[data-ci-forgot]').onclick = () => {
      if (!/^\S+@\S+\.\S+$/.test(em.value.trim())) { say('Enter your email first', true); em.focus(); return; }
      run('Sending…', async () => { await c.resetPassword(em.value, { target }); return { status: 'sent' }; });
    };
    el.querySelectorAll('[data-oauth]').forEach(b => b.onclick = () => {
      try { location.assign(c.oauthStart(b.dataset.oauth, { target })); } catch (e) { say(e.message, true); }
    });
  });
}

// One place that turns a sign-in / setup result into UI.
function afterAuth(ctx, r, say = null) {
  const msg = (t, warn) => (say ? say(t, warn) : ctx.toast(t));
  switch (r && r.status) {
    case 'linked':
      ctx.closeSheet();
      ctx.toast(r.how === 'upload' ? "Signed in. This device's data is backed up." : r.how === 'replace' ? 'Signed in. Your data is on this device.' : r.how === 'merge' ? 'Signed in. Data merged and synced.' : 'Signed in and synced');
      paintSection(); break;
    case 'choose': choiceSheet(ctx, r); break;
    case 'switched': reloadTo('today'); break;
    case 'exists':
      ctx.openSheet(`<h2>Already on this device</h2><p class="small mt">That cloud account is already here as <b>${esc(r.account.name)}</b>.</p>
        <div class="sheet-actions"><button class="btn btn-primary btn-block" data-ex-go>Switch to ${esc(r.account.name)}</button><button class="btn btn-ghost btn-block" data-ex-no>Cancel</button></div>`, (el, close) => {
        el.querySelector('[data-ex-go]').onclick = () => switchAccount(r.account.id);
        el.querySelector('[data-ex-no]').onclick = close;
      });
      break;
    case 'confirm': msg(`Check ${r.email} for a confirmation link, then sign in here.`); break;
    case 'sent': msg('Check your email for a link to set a new password.'); break;
    case 'confirmed': ctx.toast('Email confirmed. Sign in from Settings → Accounts.'); break;
    case 'recovery': recoverySheet(ctx, r); break;
    case 'password': ctx.closeSheet(); ctx.toast('Password updated. Sign in with it.'); break;
    case 'unconfigured': ctx.toast("Cloud sign-in isn't set up yet"); break;
    case 'error': msg(r.message || 'Sign-in failed', true); break;
    default: break;
  }
}

function choiceSheet(ctx, info) {
  const r = info.remote || {}, l = info.local || {};
  ctx.openSheet(`<h2>This device already has data</h2>
    <p class="small mt">The account <b>${esc(info.email || '')}</b> has ${plural(r.workouts || 0, 'workout')} and ${plural(r.weighIns || 0, 'weigh-in')}. This device has ${plural(l.workouts || 0, 'workout')} and ${plural(l.weighIns || 0, 'weigh-in')}.</p>
    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-ch="merge">Merge both (recommended)</button>
      <p class="tiny muted" style="margin:-4px 2px 4px">Keeps everything from both. Where both have the same workout, the newer copy wins; settings come from the account.</p>
      <button class="btn btn-block" data-ch="upload">Upload this device's data to the account</button>
      <p class="tiny muted" style="margin:-4px 2px 4px">The account's data is replaced by this device's.</p>
      <button class="btn btn-block" data-ch="replace">Replace this device's data with the account's</button>
      <p class="tiny muted" style="margin:-4px 2px 4px">This device's data is replaced. A safety copy stays on this device (Accounts → this account).</p>
      <p class="small" data-ch-msg role="status"></p>
      <button class="btn btn-ghost btn-block" data-ch-backup>Download a backup first</button>
      <button class="btn btn-ghost btn-block" data-ch-later>Not now</button>
    </div>`, (el, close) => {
    const msg = el.querySelector('[data-ch-msg]');
    el.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
      const choice = b.dataset.ch;
      if (choice !== 'merge' && !armed(b)) return;
      busy(el, async () => {
        msg.textContent = 'Syncing…';
        try { afterAuth(ctx, await cloud().link(choice)); } catch (e) { msg.textContent = e.message || 'Sync failed'; msg.style.color = 'var(--warn)'; }
      });
    });
    el.querySelector('[data-ch-backup]').onclick = () => { const a = accounts.active(); download(store.exportAll(), fileName(a)); ctx.toast('Backup downloaded'); };
    el.querySelector('[data-ch-later]').onclick = () => { close(); paintSection(); };
  });
}

function signOutSheet(ctx, id) {
  const a = accounts.get(id);
  if (!a) return;
  ctx.openSheet(`<h2>Sign out?</h2><p class="small mt">Stops syncing <b>${esc(a.name)}</b> on this device.</p>
    <div class="sheet-actions">
      <button class="btn btn-primary btn-block" data-so-keep>Sign out, keep data on this device</button>
      <button class="btn btn-danger btn-block" data-so-remove>Sign out and remove from this device</button>
      <button class="btn btn-ghost btn-block" data-so-no>Cancel</button>
    </div>`, (el, close) => {
    el.querySelector('[data-so-no]').onclick = close;
    el.querySelector('[data-so-keep]').onclick = () => busy(el, async () => {
      await cloud().signOut(id); close(); ctx.toast('Signed out. Data stays on this device.'); paintSection();
    });
    el.querySelector('[data-so-remove]').onclick = e => {
      if (!armed(e.target, 'Tap again: removes it from this device')) return;
      busy(el, async () => { await cloud().signOut(id); removeLocal(ctx, id); });
    };
  });
}
// Remove an account's local copy; the last account is emptied instead (there is always one account).
function removeLocal(ctx, id) {
  if (accounts.list().length > 1) {
    const wasActive = id === accounts.activeId();
    accounts.remove(id);
    if (wasActive) reloadTo('today'); else { ctx.closeSheet(); ctx.rerender(); }
  } else { accounts.clearData(id); reloadTo('today'); }
}

function deleteCloudSheet(ctx, id) {
  const a = accounts.get(id);
  if (!a || !a.cloud) return;
  ctx.openSheet(`<h2>Delete cloud account?</h2>
    <p class="small mt">Permanently deletes <b>${esc(a.cloud.email || '')}</b> and everything synced to it from the server. Other devices stop syncing. This can't be undone.</p>
    <div class="field mt"><label>Type DELETE to confirm</label><input type="text" data-dc-word autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
    <p class="small" data-dc-msg role="status"></p>
    <div class="sheet-actions"><button class="btn btn-danger btn-block" data-dc-go disabled>Delete cloud account</button><button class="btn btn-ghost btn-block" data-dc-no>Cancel</button></div>`, (el, close) => {
    const word = el.querySelector('[data-dc-word]'), go = el.querySelector('[data-dc-go]'), msg = el.querySelector('[data-dc-msg]');
    word.addEventListener('input', () => { go.disabled = word.value.trim().toUpperCase() !== 'DELETE'; });
    el.querySelector('[data-dc-no]').onclick = close;
    go.onclick = () => busy(el, async () => {
      msg.textContent = 'Deleting…';
      try { await cloud().deleteCloudAccount(id); }
      catch (e) { msg.textContent = e.message || 'Could not delete the cloud account'; msg.style.color = 'var(--warn)'; return; }
      ctx.openSheet(`<h2>Cloud account deleted</h2><p class="small mt">Remove <b>${esc(a.name)}</b>'s data from this device too?</p>
        <div class="sheet-actions"><button class="btn btn-danger btn-block" data-dl-remove>Remove from this device</button><button class="btn btn-block" data-dl-keep>Keep on this device</button></div>`, (el2, close2) => {
        el2.querySelector('[data-dl-keep]').onclick = () => { close2(); ctx.toast('Kept on this device as a local account'); paintSection(); };
        el2.querySelector('[data-dl-remove]').onclick = e => { if (armed(e.target)) removeLocal(ctx, id); };
      });
    });
  });
}

function recoverySheet(ctx, rec) {
  ctx.openSheet(`<h2>Set a new password</h2><p class="small muted">For ${esc(rec.ns.user.email || 'your account')}.</p>
    <div class="field mt"><label>New password</label><input type="password" autocomplete="new-password" data-np></div>
    <p class="small" data-np-msg role="status"></p>
    <div class="sheet-actions"><button class="btn btn-primary btn-block" data-np-go>Save password</button></div>`, el => {
    const pw = el.querySelector('[data-np]'), msg = el.querySelector('[data-np-msg]');
    el.querySelector('[data-np-go]').onclick = () => {
      if (pw.value.length < 6) { msg.textContent = 'At least 6 characters'; return; }
      busy(el, async () => { try { afterAuth(ctx, await cloud().setNewPassword(rec, pw.value)); } catch (e) { msg.textContent = e.message || 'Could not save'; } });
    };
  });
}

// ---------- boot (main.js) ----------
// authReturn: the URL fragment/query main.js took off the address bar after an OAuth / email-link redirect.
export async function startCloud(ctx, { authReturn = '' } = {}) {
  lastCtx = ctx;
  const c = cloud();
  if (!c.configured) { if (authReturn) ctx.toast("Cloud sign-in isn't set up yet"); return; }
  c.start();
  window.addEventListener('online', () => { c.sync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) c.syncIfStale(); });
  try {
    const frag = authReturn ? parseAuthFragment(authReturn) : null;
    if (frag) { afterAuth(ctx, await c.handleRedirect(frag)); return; }
    const a = accounts.active();
    if (a.cloud && a.cloud.initial && a.cloud.session && !accounts.isLinked(a)) { ctx.toast('Getting your data…'); afterAuth(ctx, await c.finishSetup()); }
    else if (accounts.isLinked(a)) await c.sync();
  } catch (e) { ctx.toast(e.message || 'Sync failed'); }
  paintSection();
}
