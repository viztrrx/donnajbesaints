// "Push reload to all clients": the owner bumps a reload counter from the
// admin panel (System), and every open console notices on its next status
// poll and re-fetches + restarts itself.
//   1. a signed-in client establishes its reload baseline
//   2. POST /admin/config { bumpReload:true } raises the counter
//   3. within a poll the client calls reloadInterface(), which fetches the
//      script from gpa_script_src and re-evals it (we point that at a local
//      marker so no GitHub fetch is needed in the test)
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ADMIN = 'reload-test-admin-token-0123456789';
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN } });

// A marker "console script": passes reloadInterface's gpa-root-host sanity
// check and records that it ran. Served with CORS so the cross-origin fetch
// from the host page succeeds.
const MARKER = `/* gpa-root-host */ try { window.__RELOADED__ = (window.__RELOADED__||0) + 1; } catch(e){}`;
const marker = await serve((rq, rs) => {
  rs.setHeader('Content-Type', 'application/javascript');
  rs.setHeader('Access-Control-Allow-Origin', '*');
  rs.end(MARKER);
});
const MARKER_URL = `http://127.0.0.1:${marker.port}/script.js`;

const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE); });
// A locked-down host page (like a filtered school site): it will load the
// console as a <script> from the marker origin, but its CSP connect-src blocks
// fetch() to it — so reloadInterface's fetch path fails and it must fall back
// to a <script> tag.
const STRICT = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline' 'unsafe-eval' MARKER_ORIGIN; connect-src 'self' WORKER_ORIGIN">
<title>Strict school page</title></head><body>A strict school page</body></html>`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const browser = await launch();
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);

const strict = await serve((rq, rs) => {
  rs.setHeader('Content-Type', 'text/html');
  rs.end(STRICT.replace('MARKER_ORIGIN', `http://127.0.0.1:${marker.port}`).replace('WORKER_ORIGIN', new URL(env.workerUrl).origin));
});

async function computer(hostPort = site.port) {
  const c = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  await c.addInitScript(([u, s]) => {
    try {
      localStorage.setItem('gpa_admin_tele_endpoint', u);
      localStorage.setItem('gpa_openai_key_skip', '1');
      localStorage.setItem('gpa_script_src', s);   // where reloadInterface refetches from
    } catch (e) { /* ignore */ }
  }, [env.workerUrl, MARKER_URL]);
  const page = await c.newPage();
  await page.goto(`http://127.0.0.1:${hostPort}/`);
  await page.evaluate((cd) => { (0, eval)(cd); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx: c, page };
}
async function signIn(page, user) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => r.querySelector('#gpa-login').style.display === 'none');
}
const bump = () => fetch(env.workerUrl + '/admin/config', {
  method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'text/plain' }, body: JSON.stringify({ bumpReload: true })
}).then((r) => r.json());

let a;
try {
  a = await computer();
  check('signs in', await signIn(a.page, 'rl' + Date.now().toString(36).slice(-4)));

  // Let it poll /status at least once so reloadBaseline is set.
  await a.page.waitForTimeout(3000);
  const before = await a.page.evaluate(() => window.__RELOADED__ || 0);
  check('no reload before the owner pushes one', before === 0, 'reloaded=' + before);

  const r = await bump();
  check('POST /admin/config { bumpReload } raises reloadVersion', r && r.ok && r.config && typeof r.config.reloadVersion === 'number' && r.config.reloadVersion >= 1, JSON.stringify(r && r.config && { reloadVersion: r.config.reloadVersion }));

  // The client polls every 15s; give it margin, then check it re-ran the script.
  const reloaded = await a.page.waitForFunction(() => (window.__RELOADED__ || 0) >= 1, null, { timeout: 25000 }).then(() => true, () => false);
  check('the open client refetched and restarted itself after the push', reloaded, 'reloaded=' + (await a.page.evaluate(() => window.__RELOADED__ || 0)));

  // A client on a locked-down page (CSP connect-src blocks fetch()) must still
  // reload — via the <script>-tag fallback — when the owner pushes one.
  const b = await computer(strict.port);
  check('signs in on a strict-CSP page', await signIn(b.page, 'cs' + Date.now().toString(36).slice(-4)));
  await b.page.waitForTimeout(3000);
  check('no reload on the strict page before a push', (await b.page.evaluate(() => window.__RELOADED__ || 0)) === 0);
  await bump();
  const reloadedStrict = await b.page.waitForFunction(() => (window.__RELOADED__ || 0) >= 1, null, { timeout: 25000 }).then(() => true, () => false);
  check('the strict-CSP client reloads via the <script>-tag fallback after the push', reloadedStrict, 'reloaded=' + (await b.page.evaluate(() => window.__RELOADED__ || 0)));
} catch (e) {
  check('test ran without throwing', false, String((e && e.stack) || e));
} finally {
  try { await browser.close(); } catch (e) { /* ignore */ }
  try { await env.close(); } catch (e) { /* ignore */ }
  try { site.close(); strict.close(); marker.close(); } catch (e) { /* ignore */ }
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
