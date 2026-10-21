// Saints Service home-screen web app, served by the Worker at /console/.
// The page is a small shell (web/console/public) that loads the same
// script.js the bookmarklet injects, in app mode. script.js is fetched from
// the repository's main branch and served same-origin with a JavaScript type,
// so the app always runs the current console and the service worker can keep
// a copy for offline launches.
import assets from './assets.generated.js';

export const CONSOLE_SCRIPT_SRC = 'https://raw.githubusercontent.com/viztrrx/work-service/main/script.js';
const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;
const baseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY'
};
const plain = (text, status) => new Response(text, { status, headers: { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function consoleApp(req, env) {
  const url = new URL(req.url), path = url.pathname;
  if (path !== '/console' && !path.startsWith('/console/')) return null;
  if (path === '/console') return new Response(null, { status: 308, headers: { ...baseHeaders, Location: '/console/' } });
  if (!['GET', 'HEAD'].includes(req.method)) return plain('Method not allowed', 405);

  if (path === '/console/script.js') {
    // Owners can pin a different build (e.g. a fork) with CONSOLE_SCRIPT_URL.
    const src = (env && env.CONSOLE_SCRIPT_URL) || CONSOLE_SCRIPT_SRC;
    let upstream;
    try {
      upstream = await fetch(src, { cf: { cacheTtl: 60, cacheEverything: true }, redirect: 'follow' });
    } catch (e) {
      return plain('The console script could not be fetched.', 502);
    }
    if (!upstream.ok) return plain('The console script could not be fetched (' + upstream.status + ').', 502);
    const code = await upstream.text();
    // A 404 page or HTML error must never be served as the app's code.
    if (code.length > MAX_SCRIPT_BYTES || !/^[\s\S]{0,20000}\(function\s*\(\)/.test(code)) return plain('The console script looks wrong.', 502);
    return new Response(req.method === 'HEAD' ? null : code, { headers: {
      ...baseHeaders, 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache'
    } });
  }

  const asset = assets[path];
  if (!asset) return plain('Not found', 404);
  const headers = { ...baseHeaders, 'Content-Type': asset.type, 'Cache-Control': 'no-cache' };
  if (path === '/console/sw.js') headers['Service-Worker-Allowed'] = '/console/';
  const body = asset.base64 ? Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0)) : asset.body;
  return new Response(req.method === 'HEAD' ? null : body, { headers });
}
