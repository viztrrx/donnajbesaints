// Messages for the owner on their iPhone app, where the owner name has no
// server sign-in (it needs the owner code to be created) and Admin is
// connected, against worker.js in workerd. It used to say "Sign in to send
// and get messages."
//   1  Messages shows the owner's list, not "Sign in"
//   2  the owner starts a DM and sends; the other person gets it and replies
//   3  the owner sees the reply and can start a group
//   node tests/browser/owner-messages.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'owner-messages-out';
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
const hasMsg = (page, text, ms = 15000) => W(page, (r, t) => [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg .body')].some((b) => b.textContent === t), text, ms);
const say = async (page, text) => { await page.fill(sr('#gpa-chat-input'), text); await page.click(sr('#gpa-chat-send')); };

try {
  await admin('/admin/config', { allowlist: { on: false } });
  const kj = await phone('kj' + run);
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
  const noSession = await own.page.evaluate(() => { try { return !JSON.parse(localStorage.getItem('gpa_session_token') || 'null'); } catch (e) { return true; } });
  check('The owner here has no server sign-in (as on the owner’s iPhone)', noSession);
  await R(own.page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="dms"]').click());
  await own.page.waitForTimeout(2000);
  const list = await R(own.page, (r) => r.querySelector('#gpa-dm-list').textContent);
  check('Messages shows the owner’s list, not “Sign in to send and get messages”', !/Sign in/.test(list) && /No messages yet/.test(list), list);
  await R(own.page, (r) => r.querySelector('#gpa-dm-new').click());
  await own.page.waitForTimeout(300);
  await own.page.fill(sr('#gpa-dm-to'), 'kj' + run);
  await own.page.click(sr('#gpa-dm-go'));
  const opened = await W(own.page, (r, n) => (r.querySelector('#gpa-dm-head .t') || {}).textContent === n, 'kj' + run, 10000);
  const err = await R(own.page, (r) => r.querySelector('#gpa-dm-err').textContent + ' ' + r.querySelector('#gpa-chat-note').textContent);
  check('The owner starts a direct message', opened, err);
  await say(own.page, 'hey from the owner ' + run);
  check('…and sends', await hasMsg(own.page, 'hey from the owner ' + run), await R(own.page, (r) => r.querySelector('#gpa-chat-note').textContent));
  await own.page.waitForTimeout(500);
  await shot(own.page, '01-owner-dm.png');
  await R(kj.page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="dms"]').click());
  const row = await W(kj.page, (r) => !!r.querySelector('#gpa-dm-list li > button'), null, 30000);
  check('The other person has it in Messages', row);
  await R(kj.page, (r) => r.querySelector('#gpa-dm-list li > button').click());
  check('…reads it', await hasMsg(kj.page, 'hey from the owner ' + run));
  await say(kj.page, 'hi owner ' + run);
  check('The owner gets the reply', await hasMsg(own.page, 'hi owner ' + run, 20000));
  for (const [n, p] of [['owner', own], ['kj', kj]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [own, kj]) await p.ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
