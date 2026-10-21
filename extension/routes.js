import { buildSaintsExtensionZip } from './package.js';
import { CONSOLE_SCRIPT_SRC } from '../web/console/handler.js';

// Unlike /admin/*, /extension/* also accepts explicitly approved regular
// accounts. The caller is resolved and verified by worker.js before entry.
// A download allowlist never grants administrative permissions.
export async function extensionRoute(req, url, env, { principal, kv, json, audit, ownerName, usernamePattern }) {
  if (!['/extension/access', '/extension/download'].includes(url.pathname)) {
    return json({ error: 'Not found' }, 404);
  }
  if (!kv) return json({ error: 'storage not configured' }, 503);
  if (!(env && env.ADMIN_TOKEN)) return json({ error: 'server accounts not configured' }, 503);
  if (!principal) return json({ error: 'Sign in to Saints Service first' }, 401);

  const owner = principal.role === 'owner';
  const staff = owner || principal.role === 'admin';
  const username = String(principal.user || '').trim().toLowerCase();
  const stored = await kv.get('extension:allowlist', 'json');
  const names = Array.isArray(stored)
    ? [...new Set(stored.filter((s) => typeof s === 'string'))].slice(0, 200)
    : [];
  const allowed = staff || (principal.kind === 'session' && !!username && names.includes(username));

  if (url.pathname === '/extension/access') {
    if (req.method === 'GET') {
      return json({ ok: true, allowed, role: principal.role, canManage: owner,
        ...(owner ? { users: names } : {}) });
    }
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    if (!owner) return json({ error: 'Only the owner may change the extension allowlist' }, 403);
    let body;
    try {
      const raw = await req.text();
      if (raw.length > 4096) return json({ error: 'Request too large' }, 413);
      body = JSON.parse(raw);
    } catch (_) { return json({ error: 'Invalid JSON' }, 400); }
    const user = String((body && body.user) || '').trim().toLowerCase();
    if (!usernamePattern.test(user) || user === ownerName) {
      return json({ error: 'Enter a valid username (1–40 characters)' }, 400);
    }
    if (!body || typeof body.allow !== 'boolean') {
      return json({ error: 'allow must be a boolean' }, 400);
    }
    const updated = body.allow
      ? [...new Set([...names, user])].sort()
      : names.filter((s) => s !== user);
    if (updated.length > 200) return json({ error: 'Allowlist is full' }, 400);
    await kv.put('extension:allowlist', JSON.stringify(updated));
    await audit(kv, {
      route: url.pathname, action: body.allow ? 'extension_allow' : 'extension_revoke',
      target: user, admin: principal.user || principal.actor, result: 'ok'
    });
    return json({ ok: true, allowed: true, canManage: true, users: updated });
  }

  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  if (!allowed) return json({ error: 'You do not have permission to download this extension' }, 403);
  const source = (env && env.CONSOLE_SCRIPT_URL) || CONSOLE_SCRIPT_SRC;
  let script;
  try {
    const upstream = await fetch(source, { cf: { cacheTtl: 60, cacheEverything: true }, redirect: 'follow' });
    if (!upstream.ok) throw new Error('source returned HTTP ' + upstream.status);
    script = await upstream.text();
    if (script.length > 8 * 1024 * 1024 || !script.includes('gpa-root-host')) throw new Error('invalid script');
  } catch (e) {
    return json({ error: 'Could not package the current Saints Service script.' }, 502);
  }
  const archive = buildSaintsExtensionZip(script);
  await audit(kv, {
    route: url.pathname, action: 'extension_download',
    target: username || 'owner-token', admin: principal.role, result: 'ok'
  });
  return new Response(archive, { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GPA-Session',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="saints-service-extension.zip"',
    'Content-Length': String(archive.size)
  } });
}
