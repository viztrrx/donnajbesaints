// The AI usage meter under the console's header, in the iPhone home-screen
// app against worker.js in workerd, with a screenshot of each state:
//   1  maya has a daily limit of 10: full meter, "10 left"
//   2  after 4 AI requests: "6 left", 40%
//   3  after 8: amber, "2 left"
//   4  after 10: red, "Daily limit reached… paused until …"; the 11th is refused
//   5  dub has no limit: no meter at all
//   6  monthly limit + per-minute rate (desktop size)
//   7  rate limit only: a text strip, no bar
// AI requests are made straight to the Worker's /v1 proxy (the quota is
// counted before the request goes upstream, so it counts with no real
// OpenAI behind it); the console picks the new numbers up on its status poll.
//   node tests/browser/usage-meter.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'usage-meter-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const ask = (user) => fetch(env.workerUrl + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GPA-User': user, 'X-GPA-Key': 'sk-test-0123456789abcdefghij' }, body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] }) }).then(async (r) => ({ status: r.status, body: await r.text() }));
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const MAYA = 'maya' + run, DUB = 'dub' + run, LEO = 'leo' + run, ZED = 'zed' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const meter = (page) => R(page, (r) => {
  const el = r.querySelector('#gpa-usage');
  return { shown: !el.hidden && !!el.offsetParent, cls: el.className, label: el.querySelector('#gpa-usage-label').textContent, left: el.querySelector('#gpa-usage-left').textContent, note: el.querySelector('#gpa-usage-note').textContent, width: el.querySelector('#gpa-usage-bar i').style.width, now: el.querySelector('#gpa-usage-bar').getAttribute('aria-valuenow') };
});
// Status polls run every 15 s; a window focus asks right away.
const refresh = async (page) => { await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(400); };
const waitMeter = (page, pred, ms = 20000) => page.waitForFunction((src) => {
  const r = document.getElementById('gpa-root-host').shadowRoot; const el = r.querySelector('#gpa-usage');
  return (0, eval)(src)({ shown: !el.hidden && !!el.offsetParent, cls: el.className, left: el.querySelector('#gpa-usage-left').textContent, note: el.querySelector('#gpa-usage-note').textContent });
}, String(pred), { timeout: ms, polling: 300 }).then(() => true, () => false);

async function open(device, user) {
  const ctx = await browser.newContext(device === 'phone' ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1100, height: 720 } });
  await ctx.addInitScript((u) => {
    if (/iPhone/.test(navigator.userAgent)) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
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
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  // Close the side menu (it starts open on a phone) so the pictures show the page.
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="welcome"]').click());
  await page.waitForTimeout(600);
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

try {
  await admin('/admin/user/action', { u: MAYA, action: 'quota', quotaDaily: 10 });

  // 1-4: maya on her iPhone.
  let { ctx, page } = await open('phone', MAYA);
  check('maya (daily limit 10) sees the meter under the header', await waitMeter(page, (m) => m.shown && m.left === '10 left'));
  let m = await meter(page);
  check('…labelled “AI requests today”, 0 used', m.label === 'AI requests today' && m.width === '0%' && /^0 of 10 used · resets /.test(m.note), JSON.stringify(m));
  await shot(page, '01-limit-10-unused.png');

  for (let i = 0; i < 4; i++) await ask(MAYA);
  await refresh(page);
  check('After 4 AI requests: 6 left, bar at 40%', await waitMeter(page, (m) => m.left === '6 left'));
  m = await meter(page);
  check('…and the numbers match', m.width === '40%' && m.now === '4' && !/is-low|is-out/.test(m.cls), JSON.stringify(m));
  await shot(page, '02-four-used.png');

  // An AI request from the console itself (Ask AI): the meter moves right
  // after it, with no wait for the next status poll. The console calls the
  // live Worker, which this sandbox can't reach, so the test answers that
  // request itself and counts it on the local Worker the way the real one would.
  await ctx.route('https://donnajbe.viztrrx.workers.dev/v1/chat/completions', async (route) => {
    await ask(MAYA);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: 'Hello from the usage meter test.' } }] }) });
  });
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="ask"]').click());
  await page.waitForTimeout(400);
  await page.fill(sr('#gpa-ask-input'), 'hi there');
  await page.click(sr('#gpa-ask-btn'));
  const answered = await page.waitForFunction(() => /Hello from the usage meter test/.test(document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-pane[data-pane="ask"]').textContent), null, { timeout: 15000 }).then(() => true, () => false);
  check('Ask AI works and shows the answer', answered);
  check('…and the meter drops to 5 left by itself right after', await waitMeter(page, (m) => m.left === '5 left', 5000));
  await shot(page, '02b-after-ask-ai.png');
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="welcome"]').click());

  for (let i = 0; i < 3; i++) await ask(MAYA);
  await refresh(page);
  check('After 8: amber warning, 2 left', await waitMeter(page, (m) => m.left === '2 left' && /is-low/.test(m.cls)));
  await shot(page, '03-almost-out.png');

  for (let i = 0; i < 2; i++) await ask(MAYA);
  const refused = await ask(MAYA);
  check('The 11th AI request is refused by the Worker', refused.status === 429 && /Daily request limit reached/.test(refused.body), String(refused.status));
  await refresh(page);
  check('At the limit: red, “Daily limit reached… paused until …”', await waitMeter(page, (m) => m.left === '0 left' && /is-out/.test(m.cls) && /Daily limit reached\. AI requests are paused until /.test(m.note)));
  m = await meter(page);
  check('…bar full', m.width === '100%', JSON.stringify(m));
  await shot(page, '04-limit-reached.png');
  // The meter stays on every tab.
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="chat"]').click());
  await page.waitForTimeout(800);
  check('Still visible on another tab (Chat)', (await meter(page)).shown);
  await shot(page, '05-on-chat-tab.png');
  check('No page errors (maya)', page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
  await ctx.close();

  // 6: dub has no limits: no meter.
  ({ ctx, page } = await open('phone', DUB));
  await refresh(page);
  await page.waitForTimeout(1500);
  check('dub (no limit) has no meter', !(await meter(page)).shown);
  await shot(page, '06-no-limit.png');
  await ctx.close();

  // 7: monthly limit and a per-minute rate, desktop size.
  await admin('/admin/user/action', { u: LEO, action: 'quota', quotaMonthly: 200, rpm: 6 });
  for (let i = 0; i < 3; i++) await ask(LEO);
  ({ ctx, page } = await open('desktop', LEO));
  check('leo (200 a month, 6 a minute): “197 left” this month', await waitMeter(page, (m) => m.shown && m.left === '197 left'));
  m = await meter(page);
  check('…with the per-minute rate in the note', m.label === 'AI requests this month' && /up to 6 a minute/.test(m.note), m.note);
  await shot(page, '07-monthly-desktop.png');
  await ctx.close();

  // 8: a per-minute rate only: a text strip, no bar.
  await admin('/admin/user/action', { u: ZED, action: 'quota', rpm: 4 });
  ({ ctx, page } = await open('phone', ZED));
  check('zed (4 a minute only): text strip without a bar', await waitMeter(page, (m) => m.shown && /is-rate/.test(m.cls) && m.left === '4 a minute'));
  await shot(page, '08-rate-only.png');
  await ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
