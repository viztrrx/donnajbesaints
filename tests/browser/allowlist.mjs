// Allowed users, in the real console against worker.js in workerd: the owner
// lists names; an unlisted name sees "Unable to create account" on the
// sign-in screen, a listed one gets in, and someone removed from the list
// while signed in is sent back to the sign-in screen.
//   node tests/browser/allowlist.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'allowlist-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const ownerSays = (body) => fetch(env.workerUrl + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const LISTED = 'kj' + run, OTHER = 'rando' + run;

async function openConsole() {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  return { ctx, page };
}
async function signUp(page, name) {
  const sr = (sel) => `#gpa-root-host >> ${sel}`;
  await page.fill(sr('#gpa-login-user'), name);
  await page.fill(sr('#gpa-login-pin'), '123456');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  return R(page, (r) => ({ open: r.querySelector('#gpa-login').style.display !== 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
}

try {
  await ownerSays({ allowlist: { on: true, users: [LISTED] } });

  let { ctx, page } = await openConsole();
  const denied = await signUp(page, OTHER);
  check('Unlisted name: “Unable to create account”', denied.open && denied.msg === 'Unable to create account', JSON.stringify(denied));
  check('…and no profile was created', await page.evaluate((n) => !Object.keys(localStorage).some((k) => k.toLowerCase().includes('gpa_profile_' + n)), OTHER));
  await page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, '01-denied.png') });
  await ctx.close();

  ({ ctx, page } = await openConsole());
  const ok = await signUp(page, LISTED);
  check('Listed name gets in', !ok.open, JSON.stringify(ok));
  await page.waitForTimeout(500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });

  // Owner removes them while they are signed in: next status poll signs them out.
  await ownerSays({ allowlist: { on: true, users: [] } });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const out = await page.waitForFunction(() => {
    const r = document.getElementById('gpa-root-host').shadowRoot;
    return r.querySelector('#gpa-login').style.display !== 'none' && r.querySelector('#gpa-login-msg').textContent === 'Unable to create account';
  }, null, { timeout: 25000 }).then(() => true, () => false);
  check('Removed while signed in: sent back to sign-in with the message', out);
  await page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, '02-removed.png') });
  check('No page errors', page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
  await ctx.close();

  // List off: anyone can sign up again.
  await ownerSays({ allowlist: { on: false, users: [] } });
  ({ ctx, page } = await openConsole());
  const open = await signUp(page, 'free' + run);
  check('With the list off, anyone can create an account', !open.open, JSON.stringify(open));
  await ctx.close();
} finally {
  await ownerSays({ allowlist: { on: false, users: [] } }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
