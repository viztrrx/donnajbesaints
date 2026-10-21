// Allowed users + access requests, end to end against worker.js in workerd,
// with a screenshot of every step:
//   1  "JOSUE" (listed as "josue") creates an account and gets in
//   2  "jOsue" signs in on another device: same person, gets in
//   3  "dub" (not listed): "Unable to create account" + Request access
//   4  dub writes a note and sends the request
//   5  dub comes back later: still waiting
//   6  the owner's phone app: Admin → Security → Access requests
//   7  the owner approves; dub is added to Allowed users
//   8  dub tries again and gets in
//   node tests/browser/access-requests.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'access-requests-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const ownerSays = (body) => fetch(env.workerUrl + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-3);
const JOSUE = 'josue' + run, DUB = 'dub' + run;
const shot = (page, name) => page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, name) });

async function open(device) {
  // 'other': a second computer (a different browser); the same browser on
  // the same machine counts as the same computer and would be offered a move.
  const ctx = await browser.newContext(device === 'phone' ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1000, height: 760 }, ...(device === 'other' ? { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 OtherComputer' } : {}) });
  await ctx.addInitScript((u) => {
    if (/iPhone/.test(navigator.userAgent)) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ }
  }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' }).catch(() => {});
  return { ctx, page };
}
const sr = (sel) => `#gpa-root-host >> ${sel}`;
async function attempt(page, name, button) {
  await page.fill(sr('#gpa-login-user'), name);
  await page.fill(sr('#gpa-login-pin'), '123456');
  await page.click(sr(button === 'signin' ? '#gpa-login-btn' : '#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  return R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent, request: !r.querySelector('#gpa-login-request').hidden, reqText: r.querySelector('#gpa-req-text').textContent, btn: r.querySelector('#gpa-req-send').textContent }));
}
const dismissLang = (page) => R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });

const adminApi = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
try {
  // The local Worker's KV persists between runs: start with no old requests.
  for (const q of (await adminApi('/admin/access-requests')).requests || []) await adminApi('/admin/access-requests/decide', { user: q.user, action: 'clear' });
  await ownerSays({ allowlist: { on: true, users: [JOSUE] } });

  // 1-2: any capitalization of a listed name.
  let { ctx, page } = await open('desktop');
  const caps = JOSUE.toUpperCase();
  let r = await attempt(page, caps, 'signup');
  check(`“${caps}” (listed as “${JOSUE}”) creates an account`, r.inside, JSON.stringify(r));
  await dismissLang(page);
  await page.waitForTimeout(400);
  await shot(page, '01-JOSUE-gets-in.png');
  // One sign-in per name: a second device is refused while the first is in
  // use, and gets in once the first signs out.
  const first = { ctx, page };
  ({ ctx, page } = await open('other'));
  const mixed = 'jOsue' + run;
  r = await attempt(page, mixed, 'signup');
  check(`A second device is refused while “${caps}” is signed in`, !r.inside && /already signed in on another device/.test(r.msg), JSON.stringify(r));
  await shot(page, '01b-second-device-refused.png');
  await R(first.page, (root) => root.querySelector('#gpa-logout-btn').click());
  await first.page.waitForTimeout(1000);
  await first.ctx.close();
  r = await attempt(page, mixed, 'signin');
  check(`“${mixed}” gets in too, once the first device signed out`, r.inside, JSON.stringify(r));
  await ctx.close();

  // 3-5: an unlisted name.
  ({ ctx, page } = await open('desktop'));
  r = await attempt(page, DUB, 'signup');
  check('Unlisted name: “Unable to create account”', !r.inside && r.msg === 'Unable to create account', r.msg);
  check('…with a Request access option', r.request && r.btn === 'Send request', r.reqText);
  await shot(page, '02-unlisted-unable-to-create-account.png');
  await page.fill(sr('#gpa-req-msg'), 'Hey, it’s Dub from 3rd period. Can I get in?');
  await shot(page, '03-writing-a-request.png');
  await page.click(sr('#gpa-req-send'));
  await page.waitForTimeout(1500);
  const sent = await R(page, (r) => ({ msg: r.querySelector('#gpa-login-msg').textContent, btn: r.querySelector('#gpa-req-send').textContent, text: r.querySelector('#gpa-req-text').textContent }));
  check('Request sent', sent.msg === 'Request sent to the owner.' && sent.btn === 'Request sent', JSON.stringify(sent));
  await shot(page, '04-request-sent.png');
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  r = await attempt(page, DUB, 'signup');
  check('Trying again later shows it is still waiting', !r.inside && /was sent/.test(r.reqText) && r.btn === 'Request sent', r.reqText);
  await shot(page, '05-still-waiting.png');
  await ctx.close();

  // 6-7: the owner's phone app, Admin → Security.
  ({ ctx, page } = await open('phone'));
  await attempt(page, 'ivan', 'signup');
  await dismissLang(page);
  await R(page, (r) => { const n = r.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click(); });
  await page.waitForTimeout(500);
  await R(page, (r, a) => {
    const f = r.querySelector('#gac-auth-fields');
    const inputs = [...f.querySelectorAll('input')];
    const tok = inputs.find((i) => i.type === 'password') || inputs[0];
    tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
    const urlIn = inputs.find((i) => /url|worker/i.test(i.placeholder + i.id + (i.getAttribute('aria-label') || '')) && i !== tok);
    if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
    r.querySelector('#gac-connect').click();
  }, { token: ADMIN, url: env.workerUrl });
  await page.waitForTimeout(2500);
  await page.goto(env.workerUrl + '/console/#tab=admin&sec=security');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  // The admin token lives in memory only, so reconnect after the reload.
  await R(page, (r, a) => {
    const n = r.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click();
    const f = r.querySelector('#gac-auth-fields');
    if (f && f.offsetParent) {
      const inputs = [...f.querySelectorAll('input')];
      const tok = inputs.find((i) => i.type === 'password') || inputs[0];
      tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
      const urlIn = inputs.find((i) => i !== tok);
      if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
      r.querySelector('#gac-connect').click();
    }
  }, { token: ADMIN, url: env.workerUrl });
  await page.waitForTimeout(2500);
  await R(page, (r) => { const t = r.querySelector('.gps-tab[data-asec="security"]'); if (t) t.click(); });
  const listed = await page.waitForFunction((u) => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector(`.gac-req[data-user="${u}"]`); return !!el; }, DUB, { timeout: 15000 }).then(() => true, () => false);
  check('Owner sees the request in Admin → Security (phone app)', listed);
  await page.waitForTimeout(800);
  await R(page, (r) => { const el = r.querySelector('#gac-access-req'); if (el) el.closest('.gac-card').scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '06-owner-phone-access-requests.png') });
  const detail = await R(page, (r, u) => r.querySelector(`.gac-req[data-user="${u}"]`).textContent, DUB);
  check('…with the note, status and buttons', /3rd period/.test(detail) && /pending/i.test(detail) && /Approve/.test(detail), detail.slice(0, 120));
  await R(page, (r, u) => r.querySelector(`.gac-req[data-user="${u}"] [data-act="approve"]`).click(), DUB);
  const approved = await page.waitForFunction((u) => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-allow-users'); return el && el.value.split('\n').includes(u); }, DUB, { timeout: 15000 }).then(() => true, () => false);
  check('Approve adds the name to Allowed users', approved);
  await page.waitForTimeout(800);
  await page.waitForTimeout(800);
  await R(page, (r) => { const el = r.querySelector('#gac-access-req'); if (el) el.closest('.gac-card').scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '07-owner-approved.png') });
  check('No page errors in the owner app', page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
  await ctx.close();

  // 8: dub gets in (with capitals, even).
  ({ ctx, page } = await open('desktop'));
  r = await attempt(page, DUB.toUpperCase(), 'signup');
  check('After approval, the same person gets in', r.inside, JSON.stringify(r));
  await dismissLang(page);
  await page.waitForTimeout(400);
  await shot(page, '08-approved-user-gets-in.png');
  await ctx.close();
} finally {
  await ownerSays({ allowlist: { on: false, users: [] } }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
