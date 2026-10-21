// The owner is now "ivan" (was viztrrx), against worker.js in workerd with
// the OWNER from wrangler.jsonc:
//   1  on the web (the console injected into a website), "ivan" signs up;
//      the server needs proof for the owner name, so: connect Admin, then
//      Settings → Memory → "Set up your owner PIN" → signed in as the owner
//   2  the same "ivan" signs in on the phone app with that PIN, at the same
//      time (the owner may use several devices)
//   3  "viztrrx" is an ordinary name now
//   node tests/browser/new-owner.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'new-owner-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'Class notes')); });
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const W = (page, fn, arg, ms = 20000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const PIN = '4826';
const signIn = async (page, user, pin, create) => {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), pin);
  await page.click(sr(create ? '#gpa-signup-btn' : '#gpa-login-btn'));
  await page.waitForTimeout(3000);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
};
const connectAdmin = (page) => R(page, (r, a) => {
  const n = r.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click();
  const f = r.querySelector('#gac-auth-fields');
  const inputs = [...f.querySelectorAll('input')];
  const tok = inputs.find((i) => i.type === 'password') || inputs[0];
  tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
  const urlIn = inputs.find((i) => i !== tok);
  if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
  r.querySelector('#gac-connect').click();
}, { token: ADMIN, url: env.workerUrl });
const role = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gpa_session_token')).role; } catch (e) { return null; } });

try {
  await admin('/admin/config', { allowlist: { on: false } });
  const health = await (await fetch(env.workerUrl + '/health')).json().catch(() => ({}));
  // 1: the web.
  const webCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await webCtx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const web = await webCtx.newPage();
  web._errors = [];
  web.on('pageerror', (e) => web._errors.push(String(e)));
  await web.goto(`http://127.0.0.1:${site.port}/`);
  await web.evaluate((c) => { (0, eval)(c); }, code);
  await web.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await signIn(web, 'ivan', PIN, true);
  check('Web: “ivan” signs up (the console opens)', await R(web, (r) => r.querySelector('#gpa-login').style.display === 'none'), health.version);
  await connectAdmin(web);
  await web.waitForTimeout(2500);
  await R(web, (r) => r.querySelector('.gpa-dropdown-item[data-tab="theme"]').click());
  await web.waitForTimeout(400);
  await R(web, (r) => r.querySelector('.gps-tab[data-sec="memory"]').click());
  const btn = await W(web, (r) => !r.querySelector('#gmem-reset-row').hidden, null, 15000);
  const label = await R(web, (r) => r.querySelector('#gmem-reset-open').textContent);
  check('Web: Settings → Memory offers to set up the owner PIN (Admin connected)', btn && /owner PIN|Reset it/.test(label), label);
  await shot(web, '01-web-setup-owner-pin.png');
  await R(web, (r) => r.querySelector('#gmem-reset-open').click());
  await web.fill(sr('#gmem-new-pin'), PIN);
  await web.fill(sr('#gmem-new-pin2'), PIN);
  await web.click(sr('#gmem-reset-go'));
  const on = await W(web, (r) => r.querySelector('#gmem-gate').hidden && !r.querySelector('#gmem-body').hidden, null, 15000);
  check('Web: “ivan” is signed in on the server', on, await R(web, (r) => r.querySelector('#gmem-reset-msg').textContent));
  check('…as the owner', (await role(web)) === 'owner', String(await role(web)));
  await web.waitForTimeout(600);
  await shot(web, '02-web-owner-connected.png');

  // 2: the phone app, same PIN, while the web stays signed in.
  const appCtx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  await appCtx.addInitScript((u) => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const app = await appCtx.newPage();
  app._errors = [];
  app.on('pageerror', (e) => app._errors.push(String(e)));
  await app.goto(env.workerUrl + '/console/');
  await app.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await signIn(app, 'ivan', PIN, true);
  const appIn = await R(app, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
  await app.waitForTimeout(1500);
  check('App: “ivan” signs in with the same PIN', appIn.inside, JSON.stringify(appIn));
  check('…as the owner, on the server', (await role(app)) === 'owner', String(await role(app)));
  // The web is still signed in (several devices are fine for the owner).
  const me = await web.evaluate(async (u) => { const t = JSON.parse(localStorage.getItem('gpa_session_token')).token; return (await fetch(u + '/auth/me', { headers: { 'X-GPA-Session': t } })).status; }, env.workerUrl);
  check('…and the web stays signed in at the same time', me === 200, String(me));
  await shot(app, '03-app-owner.png');

  // 3: viztrrx is an ordinary name now.
  const v = 'a'.repeat(64);
  const reg = await (await fetch(env.workerUrl + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'viztrrx', verifier: v }) })).json();
  check('“viztrrx” is no longer reserved: it registers as a regular account', reg.ok && reg.account && reg.account.role === 'user', JSON.stringify(reg).slice(0, 160));
  const ivan2 = await (await fetch(env.workerUrl + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'IVAN', verifier: v }) })).json();
  check('Nobody else can register “ivan”', !ivan2.ok, JSON.stringify(ivan2).slice(0, 120));

  check('No page errors (web)', web._errors.length === 0, web._errors.slice(0, 2).join(' | '));
  check('No page errors (app)', app._errors.length === 0, app._errors.slice(0, 2).join(' | '));
  await webCtx.close(); await appCtx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
  await site.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
