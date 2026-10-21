// One sign-in per name, end to end against worker.js in workerd, with a
// screenshot of every step. The owner lists "kj"; the real kj signs up on
// device A. Then an impostor who only knows the name tries everything:
//   1  kj creates the account on device A and gets in
//   2  impostor, device B: Create with kj's name → "already taken"
//   3  impostor: Sign in with a guessed PIN → "Wrong PIN"
//   4  impostor skips the sign-in screen (fakes a local profile) → the
//      Worker refuses the bare name and the console signs them out
//   5  someone with the right PIN on device C while A is in use → refused
//   6  owner, Admin → Security → Allowed users: kj "Signed in", Sign out
//   7  device A is signed out with the reason
//   8  device C can sign in now
//   node tests/browser/one-session.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'one-session-out';
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
const KJ = 'kj' + run;
const PIN = '482913';
const shot = (page, name) => page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, name) });
const sr = (sel) => `#gpa-root-host >> ${sel}`;

// Each device is its own browser (its own User-Agent): two windows of the
// same browser on the same machine count as the same computer (that case is
// tests/browser/same-computer.mjs).
let deviceNo = 0;
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 TestDevice' + (++deviceNo) });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' }).catch(() => {});
  return { ctx, page };
}
const state = (page) => R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
async function attempt(page, name, pin, button) {
  await page.fill(sr('#gpa-login-user'), name);
  await page.fill(sr('#gpa-login-pin'), pin);
  await page.click(sr(button === 'signin' ? '#gpa-login-btn' : '#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  return state(page);
}
const dismissLang = (page) => R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
const signedOutWith = (page, re, timeout = 25000) => page.waitForFunction((src) => {
  const r = document.getElementById('gpa-root-host').shadowRoot;
  return r.querySelector('#gpa-login').style.display !== 'none' && new RegExp(src).test(r.querySelector('#gpa-login-msg').textContent);
}, re.source, { timeout }).then(() => true, () => false);

try {
  await ownerSays({ allowlist: { on: true, users: [KJ] } });

  // 1: the real kj.
  const A = await open();
  let r = await attempt(A.page, KJ, PIN, 'signup');
  check('kj creates the account on device A and gets in', r.inside, JSON.stringify(r));
  await dismissLang(A.page);
  await A.page.waitForTimeout(400);
  await shot(A.page, '01-kj-device-A.png');

  // 2-3: an impostor who only knows the name.
  const B = await open();
  r = await attempt(B.page, KJ, '000000', 'signup');
  check('Impostor: Create with kj’s name is refused', !r.inside && /already taken/.test(r.msg), r.msg);
  await shot(B.page, '02-impostor-create-refused.png');
  r = await attempt(B.page, KJ, '111111', 'signin');
  check('Impostor: Sign in with a guessed PIN is refused', !r.inside && r.msg === 'Wrong PIN.', r.msg);
  await shot(B.page, '03-impostor-wrong-pin.png');
  check('…and nothing was saved on the impostor’s device', await B.page.evaluate((n) => !localStorage.getItem('gpa_profile_' + n), KJ.toLowerCase()));

  // 4: skipping the sign-in screen entirely (a hand-made local profile).
  await B.page.evaluate((n) => {
    localStorage.setItem('gpa_profile_' + n, JSON.stringify({ user: n, pinHash: { v: 2, salt: 'x', hash: 'x', iter: 1 }, data: {}, updatedAt: Date.now() }));
    localStorage.setItem('gpa_session_user', n);
  }, KJ.toLowerCase());
  await B.page.reload();
  await B.page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  // The console never opens: a saved sign-in only comes back after the Worker
  // accepts the session, and this one has none.
  const kicked = await signedOutWith(B.page, /[Ss]ign in again with your PIN/);
  const neverIn = await B.page.evaluate(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none');
  check('Impostor who skips the sign-in screen never gets in (the Worker has to accept the session first)', kicked && neverIn, (await state(B.page)).msg);
  await shot(B.page, '04-impostor-bypass-signed-out.png');
  await B.ctx.close();

  // 5: right PIN, second device, while A is in use.
  const C = await open();
  r = await attempt(C.page, KJ, PIN, 'signin');
  check('Right PIN on a second device is refused while device A is in use', !r.inside && /already signed in on another device/.test(r.msg), r.msg);
  await shot(C.page, '05-second-device-refused.png');
  r = await state(A.page);
  check('Device A is untouched', r.inside, JSON.stringify(r));

  // 6: the owner's view.
  const O = await open();
  await attempt(O.page, 'ivan', '135790', 'signup');
  await dismissLang(O.page);
  const connect = () => R(O.page, (root, a) => {
    const n = root.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click();
    const f = root.querySelector('#gac-auth-fields');
    if (f && f.offsetParent) {
      const inputs = [...f.querySelectorAll('input')];
      const tok = inputs.find((i) => i.type === 'password') || inputs[0];
      tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
      const urlIn = inputs.find((i) => i !== tok);
      if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
      root.querySelector('#gac-connect').click();
    }
  }, { token: ADMIN, url: env.workerUrl });
  await O.page.waitForTimeout(500);
  await connect();
  await O.page.waitForTimeout(2500);
  await R(O.page, (root) => { const t = root.querySelector('.gps-tab[data-asec="security"]'); if (t) t.click(); });
  const row = await O.page.waitForFunction((u) => {
    const el = document.getElementById('gpa-root-host').shadowRoot.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`);
    return el ? el.textContent : false;
  }, KJ.toLowerCase(), { timeout: 15000 }).then((h) => h.jsonValue(), () => '');
  check('Owner sees kj as “Signed in” in Admin → Security → Allowed users', /Signed in/.test(row) && /Sign out/.test(row), row);
  await R(O.page, (root, u) => root.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`).scrollIntoView({ block: 'center' }), KJ.toLowerCase());
  await O.page.waitForTimeout(300);
  await shot(O.page, '06-owner-allowed-users.png');
  const secLog = await R(O.page, (root) => root.querySelector('#gac-body-security, [data-body="security"]')?.textContent || root.textContent);
  check('Security log counts the refused second sign-in and the wrong PIN', /Second sign-ins refused/.test(secLog) && /Failed sign-ins/.test(secLog));
  await R(O.page, (root, u) => root.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"] button[data-acct="revokesessions"]`).click(), KJ.toLowerCase());
  await O.page.waitForTimeout(1500);
  const after = await R(O.page, (root, u) => (root.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`) || {}).textContent || '', KJ.toLowerCase());
  check('After Sign out the owner sees “Signed out”', /Signed out/.test(after), after);
  await shot(O.page, '06b-owner-after-sign-out.png');
  check('No page errors in the owner’s console', O.page._errors.length === 0, O.page._errors.slice(0, 2).join(' | '));
  await O.ctx.close();

  // 7: device A learns about it on its next status check.
  const aOut = await signedOutWith(A.page, /ended by the owner/);
  check('Device A is signed out with the reason', aOut, (await state(A.page)).msg);
  await shot(A.page, '07-device-A-signed-out.png');
  check('No page errors on device A', A.page._errors.length === 0, A.page._errors.slice(0, 2).join(' | '));

  // 8: now device C can have the name.
  r = await attempt(C.page, KJ, PIN, 'signin');
  check('Device C can sign in now', r.inside, JSON.stringify(r));
  await dismissLang(C.page);
  await C.page.waitForTimeout(400);
  await shot(C.page, '08-device-C-in.png');
  check('No page errors on device C', C.page._errors.length === 0, C.page._errors.slice(0, 2).join(' | '));
  await A.ctx.close();
  await C.ctx.close();
} finally {
  await ownerSays({ allowlist: { on: false, users: [] } }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
