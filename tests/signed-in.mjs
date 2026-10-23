// The Worker only accepts a username that comes with a PIN-checked session,
// as the console sends on every request once signed in. Tests written as
// "user: 'ana'" go through signedIn(worker): the first time a name shows up
// (body.user, ?user=, or X-GPA-User) it is registered and signed in on the
// server, and that request and every later one for the name carries its
// X-GPA-Session. Requests that already prove who they are (a session, an
// admin token, the owner code) are left alone, and so are requests marked
// X-Test-Bare, which check what a name with no session gets.
import { createHash } from 'node:crypto';

const verifierFor = (user) => createHash('sha256').update('test-pin|' + user.toLowerCase()).digest('hex');

export function signedIn(worker) {
  const tokens = new WeakMap();   // env -> Map(name -> token)
  async function tokenFor(env, ctx, user) {
    let map = tokens.get(env);
    if (!map) tokens.set(env, (map = new Map()));
    const key = user.toLowerCase();
    if (map.has(key)) return map.get(key);
    // The owner's name always has to bring its own proof (token or code).
    if (key === String(env.OWNER || '').toLowerCase()) return '';
    const post = (path) => worker.fetch(new Request('https://worker.test' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '10.9.9.9' },
      body: JSON.stringify({ user, verifier: verifierFor(user), site: 'tests', device: '0'.repeat(32) })
    }), env, ctx).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
    let r = await post('/auth/login');
    if (r.status === 404) r = await post('/auth/register');
    const token = r.status === 200 && r.data.token ? r.data.token : '';
    map.set(key, token);
    return token;
  }
  return {
    ...worker,
    async fetch(req, env, ctx) {
      // X-Test-Bare: send it exactly as an old client would (name only).
      if (req.headers.get('X-Test-Bare')) {
        const headers = new Headers(req.headers); headers.delete('X-Test-Bare');
        return worker.fetch(new Request(req, { headers }), env, ctx);
      }
      const h = req.headers;
      if (!env || !env.ADMIN_TOKEN || h.get('X-GPA-Session') || h.get('Authorization') || h.get('X-GPA-Owner')) return worker.fetch(req, env, ctx);
      const url = new URL(req.url);
      let body = null;
      if (req.method === 'POST' && /multipart\/form-data/.test(h.get('Content-Type') || '')) {
        try { const f = await req.clone().formData(); body = { user: f.get('user') }; } catch (e) { body = null; }
      } else if (req.method === 'POST') {
        try { body = JSON.parse(await req.clone().text()); } catch (e) { body = null; }
      }
      const user = String((body && typeof body.user === 'string' && body.user) || url.searchParams.get('user') || h.get('X-GPA-User') || '').trim();
      if (!user || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/access') || url.pathname.startsWith('/subscribe') || url.searchParams.get('s') || (body && body.session)) return worker.fetch(req, env, ctx);
      const token = await tokenFor(env, ctx || { waitUntil() {} }, user);
      if (!token) return worker.fetch(req, env, ctx);
      const headers = new Headers(h);
      headers.set('X-GPA-Session', token);
      return worker.fetch(new Request(req, { headers }), env, ctx);
    }
  };
}
