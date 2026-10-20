// Minimal Supabase REST client (CONTRACT §19): GoTrue /auth/v1/* and PostgREST /rest/v1/* over plain fetch.
// No SDK, no dependency. Error messages never include tokens or request bodies, and nothing here logs.

export class CloudError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.name = 'CloudError'; this.status = status; this.code = code; }
}

const qs = o => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString(); return s ? '?' + s : '';
};

function message(data, status) {
  const m = data && typeof data === 'object' ? (data.msg || data.message || data.error_description || data.error) : '';
  if (m) return String(m).slice(0, 200);
  if (status === 401 || status === 403) return 'Not signed in, or not allowed.';
  if (status === 404) return 'Not found on the server. Was supabase/schema.sql run?';
  if (status === 429) return 'Too many tries. Wait a minute and try again.';
  if (status >= 500) return 'The server had a problem. Try again later.';
  return `Request failed (${status})`;
}

export function createClient({ url, anonKey, fetch: f }) {
  const base = String(url || '').replace(/\/+$/, '');
  const doFetch = f || (typeof fetch === 'function' ? (...a) => fetch(...a) : null);
  async function call(path, { method = 'GET', body, token } = {}) {
    if (!doFetch) throw new CloudError('No network available.', 0, 'network');
    // apikey identifies the project; Authorization is only sent with a user's token (works for legacy anon and new publishable keys).
    const headers = { apikey: anonKey, Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try { res = await doFetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new CloudError("Can't reach the server. Check your connection.", 0, 'network'); }
    let text = '';
    try { text = await res.text(); } catch (e) { /* empty body */ }
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) throw new CloudError(message(data, res.status), res.status, String((data && typeof data === 'object' && (data.error_code || data.code || data.error)) || ''));
    return data;
  }
  return {
    signUp: (email, password, redirectTo) => call('/auth/v1/signup' + qs({ redirect_to: redirectTo }), { method: 'POST', body: { email, password } }),
    signIn: (email, password) => call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }),
    refresh: refreshToken => call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } }),
    signOut: token => call('/auth/v1/logout', { method: 'POST', token }),
    recover: (email, redirectTo) => call('/auth/v1/recover' + qs({ redirect_to: redirectTo }), { method: 'POST', body: { email } }),
    getUser: token => call('/auth/v1/user', { token }),
    updateUser: (token, attrs) => call('/auth/v1/user', { method: 'PUT', token, body: attrs }),
    authorizeUrl: (provider, redirectTo) => base + '/auth/v1/authorize' + qs({ provider, redirect_to: redirectTo }),
    // forge_state rows changed after `since` (server time), oldest first.
    selectRows: (token, { since = null, offset = 0, limit = 500 } = {}) => call('/rest/v1/forge_state' + qs({
      select: 'key,value,updated_at,synced_at', synced_at: since ? 'gt.' + since : null, order: 'synced_at.asc,key.asc', offset, limit,
    }), { token }),
    rpc: (token, fn, args = {}) => call('/rest/v1/rpc/' + encodeURIComponent(fn), { method: 'POST', token, body: args }),
  };
}

// GoTrue token response → what Forge stores. null when the response has no session (e.g. sign-up awaiting email confirmation).
export function normalizeSession(d, nowMs = Date.now()) {
  if (!d || typeof d !== 'object' || !d.access_token) return null;
  const exp = Number(d.expires_at) || (Math.floor(nowMs / 1000) + (Number(d.expires_in) || 3600));
  const u = d.user && typeof d.user === 'object' ? d.user : {};
  return { session: { access_token: String(d.access_token), refresh_token: String(d.refresh_token || ''), expires_at: exp }, user: { id: u.id || null, email: u.email || '' } };
}

// Tokens (or an error) from the URL after an OAuth / email-link redirect: '#access_token=…&refresh_token=…&type=recovery'.
export function parseAuthFragment(s) {
  const p = new URLSearchParams(String(s || '').replace(/^[#?/]+/, '').replace(/[#?]/g, '&'));
  if (p.get('error') || p.get('error_description')) return { error: p.get('error_code') || p.get('error') || 'error', description: p.get('error_description') || '' };
  const at = p.get('access_token');
  if (!at) return null;
  return { access_token: at, refresh_token: p.get('refresh_token') || '', expires_at: Number(p.get('expires_at')) || null, expires_in: Number(p.get('expires_in')) || null, type: p.get('type') || '' };
}
