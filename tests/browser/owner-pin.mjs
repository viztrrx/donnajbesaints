// The owner's own PIN reset, on the owner's iPhone app against worker.js in
// workerd: the owner name has no server sign-in and Admin is connected;
// Settings → Memory → Reconnect says "Wrong PIN."
//   1  "Forgot your PIN? Reset it" shows (owner proof on this device)
//   2  a new PIN: Memory connects (signed in on the server)
//   3  signing out and in with the new PIN works; the old one doesn't
//   node tests/browser/owner-pin.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'owner-pin-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const W = (page, fn, arg, ms = 20000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

async function phone(user) {
  const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  await ctx.addInitScript((u) => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ }
  }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(3000);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return { ctx, page };
}

try {
  await admin('/admin/config', { allowlist: { on: false } });
  const own = await phone('ivan');
  await R(own.page, (r, a) => {
    const n = r.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click();
    const f = r.querySelector('#gac-auth-fields');
    const inputs = [...f.querySelectorAll('input')];
    const tok = inputs.find((i) => i.type === 'password') || inputs[0];
    tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
    const urlIn = inputs.find((i) => i !== tok);
    if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
    r.querySelector('#gac-connect').click();
  }, { token: ADMIN, url: env.workerUrl });
  await own.page.waitForTimeout(2500);
  // Settings → Memory.
  await R(own.page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="theme"]').click());
  await own.page.waitForTimeout(400);
  await R(own.page, (r) => r.querySelector('.gps-tab[data-sec="memory"]').click());
  const gate = await W(own.page, (r) => !r.querySelector('#gmem-pin-row').hidden, null, 15000);
  check('Memory asks to reconnect with a PIN (no server sign-in)', gate, await R(own.page, (r) => r.querySelector('#gmem-gate-title').textContent));
  await own.page.fill(sr('#gmem-pin'), '999999');
  await own.page.click(sr('#gmem-pin-go'));
  await own.page.waitForTimeout(1200);
  check('A PIN that isn’t this device’s says “Wrong PIN.”', /Wrong PIN/.test(await own.page.evaluate(() => document.getElementById('gpa-root-host').shadowRoot.textContent)));
  const link = await R(own.page, (r) => !r.querySelector('#gmem-reset-row').hidden && r.querySelector('#gmem-reset-open').textContent);
  check('A reset button shows for the owner (“Set up your owner PIN” when the server has no owner account yet)', link === 'Forgot your PIN? Reset it' || link === 'Set up your owner PIN', String(link));
  await own.page.waitForTimeout(2500);
  await shot(own.page, '01-forgot-pin.png');
  await R(own.page, (r) => r.querySelector('#gmem-reset-open').click());
  check('Opening it shows the form in place of the button', await R(own.page, (r) => !r.querySelector('#gmem-reset').hidden && getComputedStyle(r.querySelector('#gmem-reset-row')).display === 'none'));
  await own.page.fill(sr('#gmem-new-pin'), '1357');
  await own.page.fill(sr('#gmem-new-pin2'), '1358');
  await own.page.click(sr('#gmem-reset-go'));
  check('Two different PINs are caught', /don’t match/.test(await R(own.page, (r) => r.querySelector('#gmem-reset-msg').textContent)));
  await own.page.fill(sr('#gmem-new-pin2'), '1357');
  await own.page.waitForTimeout(300);
  await shot(own.page, '02-new-pin.png');
  await own.page.click(sr('#gmem-reset-go'));
  const connected = await W(own.page, (r) => r.querySelector('#gmem-gate').hidden && !r.querySelector('#gmem-body').hidden, null, 15000);
  check('Reset PIN: Memory connects (signed in on the server)', connected, await R(own.page, (r) => r.querySelector('#gmem-reset-msg').textContent + ' | ' + r.querySelector('#gmem-gate-title').textContent));
  const tok = await own.page.evaluate(() => { try { return !!JSON.parse(localStorage.getItem('gpa_session_token')).token; } catch (e) { return false; } });
  check('…the device now has a server sign-in', tok);
  await own.page.waitForTimeout(800);
  await shot(own.page, '03-memory-connected.png');
  // Sign out; the old PIN is refused, the new one works.
  await R(own.page, (r) => r.querySelector('#gpa-logout-btn').click());
  await own.page.waitForTimeout(800);
  await own.page.fill(sr('#gpa-login-user'), 'ivan');
  await own.page.fill(sr('#gpa-login-pin'), '246810');
  await own.page.click(sr('#gpa-login-btn'));
  await own.page.waitForTimeout(2000);
  check('The old PIN no longer signs in', await R(own.page, (r) => r.querySelector('#gpa-login').style.display !== 'none'));
  await own.page.fill(sr('#gpa-login-pin'), '1357');
  await own.page.click(sr('#gpa-login-btn'));
  await own.page.waitForTimeout(3000);
  check('The new PIN signs in', await R(own.page, (r) => r.querySelector('#gpa-login').style.display === 'none'));
  check('No page errors', own.page._errors.length === 0, own.page._errors.slice(0, 2).join(' | '));
  await own.ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
