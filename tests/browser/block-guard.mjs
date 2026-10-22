// An owner who never pressed Block found a user blocked. Two ways that could
// happen from the user profile, both closed here:
//   1. Block (next to Reset PIN) fired on one tap — it now asks first, naming
//      the user; Cancel leaves them alone.
//   2. Opening user A then quickly user B: A's slower answer arrived last and
//      painted A's profile (and buttons) over B's. A late answer is now dropped.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'block-guard-admin-token-0123456789';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const W = (p, body, headers) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json().catch(() => ({})));
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const JOSUE = 'josue' + run, BORGIDO = 'borgido' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const state = async (u) => (await W('/status?user=' + u)).state;

const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
await ctx.addInitScript((u) => {
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ }
}, env.workerUrl);
const page = await ctx.newPage();
let nextDialog = 'dismiss';
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.message()); d[nextDialog](); });
const ready = () => page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
const tapOpen = (url) => page.evaluate((u) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'agent-console-open', url: u } })), url);
const heading = () => R(page, (r) => (r.querySelector('#gac-inspector h3') || {}).textContent || '');

try {
  await W('/track', { user: JOSUE, event: 'open', sid: 'j' + run });
  await W('/track', { user: BORGIDO, event: 'open', sid: 'b' + run });

  await page.goto(env.workerUrl + '/console/');
  await ready();
  await page.fill(sr('#gpa-login-user'), 'ivan');
  await page.fill(sr('#gpa-login-pin'), '135790');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  await page.goto(env.workerUrl + `/console/#tab=admin&sec=users&user=${BORGIDO}`);
  await ready();
  await page.waitForFunction(() => { const f = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-auth'); return f && !f.hidden && f.offsetParent; }, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await R(page, (r, a) => {
    const inputs = [...r.querySelectorAll('#gac-auth-fields input')];
    const tok = inputs.find((i) => i.type === 'password') || inputs[0];
    tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
    const urlIn = inputs.find((i) => i !== tok);
    if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
    r.querySelector('#gac-connect').click();
  }, { token: ADMIN, url: env.workerUrl });
  await page.waitForFunction((u) => (document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-inspector h3') || {}).textContent === u, BORGIDO, { timeout: 15000 });
  check('owner has Admin open on a profile', (await heading()) === BORGIDO);

  // 2: josue's profile answers slowly; the owner moves on to borgido first.
  await page.route('**/admin/user?u=' + JOSUE, async (route) => { await new Promise((r) => setTimeout(r, 2500)); route.continue(); });
  await tapOpen(`/console/#tab=admin&sec=users&user=${JOSUE}`);
  await page.waitForTimeout(300);
  await tapOpen(`/console/#tab=admin&sec=users&user=${BORGIDO}`);
  await page.waitForTimeout(4500);
  check('a slow, older profile does not replace the one the owner opened last', (await heading()) === BORGIDO, await heading());
  await page.unroute('**/admin/user?u=' + JOSUE);

  // 1: Block asks first; Cancel leaves them unblocked.
  const blockBtn = sr('#gac-inspector [data-mod="block"]');
  nextDialog = 'dismiss';
  await page.click(blockBtn);
  await page.waitForTimeout(1500);
  check('Block asks “are you sure”, naming the user', dialogs.some((m) => m.includes('Block') && m.includes(BORGIDO)), dialogs.slice(-1)[0]);
  check('…Cancel leaves them unblocked', (await state(BORGIDO)) === 'active');
  check('…and josue was never touched', (await state(JOSUE)) === 'active');
  nextDialog = 'accept';
  await page.click(blockBtn);
  await page.waitForTimeout(2000);
  check('OK blocks them', (await state(BORGIDO)) === 'blocked');
  nextDialog = 'accept';
  await page.click(sr('#gac-inspector [data-mod="unblock"]'));
  await page.waitForTimeout(2000);
  check('Unblock is one tap and restores them', (await state(BORGIDO)) === 'active');
} catch (e) {
  check('test ran without throwing', false, String((e && e.stack) || e));
} finally {
  try { await browser.close(); } catch (e) { /* ignore */ }
  try { await env.close(); scriptHost.close(); } catch (e) { /* ignore */ }
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
