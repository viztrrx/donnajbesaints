// Subscribers, end to end on iPhones in the home-screen app against worker.js
// in workerd, with a screenshot of each step:
//   1  owner: Admin → Security → Subscribers, list off: the warning + "Turn it on"
//   2  owner adds renzo for 1 month with a note ($10 · Cash App)
//   3  renzo signs up and gets in
//   4  his subscription ends (End now — the same thing the end date does):
//      renzo is signed out with "Your subscription has ended…"
//   5  renzo's sign-in screen: ended message + "Ask to renew"
//   6  owner renews; renzo gets back in
// (The exact-time cut-off, calendar months, reminders and the cron clean-up
// are covered with a simulated clock in tests/worker.test.mjs and
// tests/push.test.mjs.)
//   node tests/browser/subscribers.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'subscribers-out';
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
const run = Date.now().toString(36).slice(-4);
const RENZO = 'renzo' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

async function phone() {
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
  return { ctx, page };
}
async function signUp(page, user, button = 'signup') {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr(button === 'signin' ? '#gpa-login-btn' : '#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent, req: r.querySelector('#gpa-req-text').textContent, btn: r.querySelector('#gpa-req-send').textContent }));
}
async function openSubscribers(page) {
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
  await R(page, (r) => r.querySelector('.gps-tab[data-asec="security"]').click());
  await page.waitForFunction(() => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-subs'); return b && !/Loading/.test(b.textContent); }, null, { timeout: 15000 });
  await R(page, (r) => r.querySelector('#gac-subs-card').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
}
const subRow = (page, user) => R(page, (r, u) => { const el = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user.toLowerCase() === u.toLowerCase()); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }, user);

try {
  await admin('/admin/config', { allowlist: { on: false, users: [] } });
  // 1: owner, list off.
  const owner = await phone();
  await signUp(owner.page, 'viztrrx');
  await openSubscribers(owner.page);
  check('With Allowed users off, the card warns and offers “Turn it on”', await R(owner.page, (r) => !!r.querySelector('#gac-subs-allow') && /only matter while/.test(r.querySelector('.gac-subs-warn').textContent)));
  await shot(owner.page, '01-list-off-warning.png');
  await R(owner.page, (r) => r.querySelector('#gac-subs-allow').click());
  await owner.page.waitForFunction(() => { const r = document.getElementById('gpa-root-host').shadowRoot; const b = r.querySelector('#gac-subs'); return b && !/Loading/.test(b.textContent) && !r.querySelector('#gac-subs-allow'); }, null, { timeout: 15000 }).catch(() => {});
  check('“Turn it on” switches Only allow listed users on', (await (await fetch(env.workerUrl + '/access?user=nobody' + run)).json()).allowed === false);

  // 2: add renzo for a month with a note.
  await R(owner.page, (r) => r.querySelector('#gac-subs-card').scrollIntoView({ block: 'start' }));
  await owner.page.fill(sr('#gac-subs-name'), RENZO);
  await owner.page.selectOption(sr('#gac-subs-period'), '1m');
  await owner.page.fill(sr('#gac-subs-note'), '$10 · Cash App');
  await owner.page.click(sr('#gac-subs-form button[type="submit"]'));
  await owner.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-subscr')].some((x) => x.dataset.user === u), RENZO, { timeout: 10000 }).catch(() => {});
  const row = await subRow(owner.page, RENZO);
  check('renzo is listed: 1 month, days left, start/end dates, the note', row && /(30|31) days left/.test(row) && /Since .* ends /.test(row) && /\$10 · Cash App/.test(row) && /Renew \+1 month/.test(row) && /End now/.test(row), row);
  await owner.page.waitForTimeout(500);
  await shot(owner.page, '02-renzo-added.png');
  const cfgAllowed = (await (await fetch(env.workerUrl + '/access?user=' + RENZO)).json()).allowed;
  check('renzo is allowed in now', cfgAllowed === true);

  // 3: renzo signs up on his phone.
  const renzo = await phone();
  let r = await signUp(renzo.page, RENZO);
  check('renzo creates his account and gets in', r.inside, JSON.stringify(r));
  await renzo.page.waitForTimeout(400);

  // 4: the subscription ends.
  await R(owner.page, (root, u) => { window.confirm = () => true; [...root.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u).querySelector('[data-sub="end"]').click(); }, RENZO);
  await owner.page.waitForTimeout(1500);
  check('Owner sees it as Ended with a Remove option', /Ended/.test(await subRow(owner.page, RENZO) || '') && /Remove/.test(await subRow(owner.page, RENZO) || ''));
  await shot(owner.page, '03-ended-in-admin.png');
  await renzo.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const out = await renzo.page.waitForFunction(() => { const r = document.getElementById('gpa-root-host').shadowRoot; return r.querySelector('#gpa-login').style.display !== 'none' && /Your subscription has ended/.test(r.querySelector('#gpa-login-msg').textContent); }, null, { timeout: 25000 }).then(() => true, () => false);
  check('renzo is signed out: “Your subscription has ended. Ask the owner to renew it.”', out);
  await shot(renzo.page, '04-renzo-signed-out.png');

  // 5: trying to sign back in.
  r = await signUp(renzo.page, RENZO, 'signin');
  check('Signing in again: the ended message and “Ask to renew”', !r.inside && /subscription has ended/.test(r.msg) && /ended on/.test(r.req) && r.btn === 'Ask to renew', JSON.stringify(r));
  await shot(renzo.page, '05-renzo-ask-to-renew.png');

  // 6: owner renews; renzo is back.
  await R(owner.page, (root, u) => [...root.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u).querySelector('[data-sub="renew"]').click(), RENZO);
  await owner.page.waitForTimeout(1500);
  check('Renewed: active again with a month left', /(30|31) days left/.test(await subRow(owner.page, RENZO) || ''), await subRow(owner.page, RENZO));
  await shot(owner.page, '06-renewed.png');
  r = await signUp(renzo.page, RENZO, 'signin');
  check('renzo can sign in again', r.inside, JSON.stringify(r));
  check('No page errors (owner)', owner.page._errors.length === 0, owner.page._errors.slice(0, 2).join(' | '));
  check('No page errors (renzo)', renzo.page._errors.length === 0, renzo.page._errors.slice(0, 2).join(' | '));
  await owner.ctx.close();
  await renzo.ctx.close();
} finally {
  await admin('/admin/config', { allowlist: { on: false, users: [] } }).catch(() => {});
  await admin('/admin/subscriptions', { action: 'delete', user: RENZO }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
