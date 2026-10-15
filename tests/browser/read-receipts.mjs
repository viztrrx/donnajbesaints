// Chat read receipts (iMessage style), three people on iPhones in the
// home-screen app, against worker.js in workerd with the CHAT_ROOMS Durable
// Object. A screenshot of each step:
//   1  maya sends a message: "Delivered" under it
//   2  kj opens Chat and sees it: maya's turns to "Read by kj 3:42 PM"
//   3  dub sees it too: "Read by kj and dub …"
//   4  kj replies: the receipt goes away (as in iMessage, a reply says it all)
//   5  a message nobody has on screen stays "Delivered" (Chat closed = no read)
//   node tests/browser/read-receipts.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'read-receipts-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef', CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const MAYA = 'maya' + run, KJ = 'kj' + run, DUB = 'dub' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;

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
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return { ctx, page };
}
const openChat = (page) => R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="chat"]').click());
const openWelcome = (page) => R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="welcome"]').click());
const say = async (page, text) => { await page.fill(sr('#gpa-chat-input'), text); await page.click(sr('#gpa-chat-send')); };
const receipt = (page) => R(page, (r) => {
  const el = r.querySelector('#gpa-chat-log .gpa-chat-receipt');
  if (!el) return null;
  const msg = el.closest('.gpa-chat-msg');
  const b = el.getBoundingClientRect(), c = msg.querySelector('.col').getBoundingClientRect();
  return { text: el.textContent.replace(/\s+/g, ' ').trim(), underMine: msg.classList.contains('mine'), isLast: msg === [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].pop(), rightAligned: Math.abs(b.right - c.right) < 2 && getComputedStyle(el).textAlign === 'right', visible: b.height > 0 };
});
const waitReceipt = (page, re, ms = 20000) => page.waitForFunction((src) => {
  const el = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-chat-log .gpa-chat-receipt');
  return !!el && new RegExp(src).test(el.textContent);
}, re.source, { timeout: ms, polling: 250 }).then(() => true, () => false);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

try {
  const maya = await phone(MAYA), kj = await phone(KJ), dub = await phone(DUB);
  await openChat(maya.page);
  await maya.page.waitForTimeout(800);

  // 1: maya sends.
  await say(maya.page, 'are you guys coming to practice? ' + run);
  check('maya’s message shows “Delivered”', await waitReceipt(maya.page, /^Delivered$/));
  let rc = await receipt(maya.page);
  check('…small and right-aligned under her own newest message', rc && rc.underMine && rc.isLast && rc.rightAligned && rc.visible, JSON.stringify(rc));
  await maya.page.waitForTimeout(500);
  await shot(maya.page, '01-delivered.png');

  // 2: kj opens Chat and has it on screen.
  await openChat(kj.page);
  check('kj opens Chat: maya’s turns to “Read by kj” with the time', await waitReceipt(maya.page, new RegExp('^Read by ' + KJ + ' \\d{1,2}:\\d{2}\\s?[AP]M$')));
  rc = await receipt(maya.page);
  await maya.page.waitForTimeout(400);
  await shot(maya.page, '02-read-by-kj.png');
  check('kj sees no receipt under maya’s message (it isn’t his)', (await receipt(kj.page)) === null);

  // 3: dub reads too.
  await openChat(dub.page);
  check('dub reads it too: “Read by kj and dub”', await waitReceipt(maya.page, new RegExp('^Read by ' + KJ + ' and ' + DUB + ' ')));
  await maya.page.waitForTimeout(400);
  await shot(maya.page, '03-read-by-two.png');

  // 4: kj replies; the receipt goes away, and kj now has "Delivered"…
  await say(kj.page, 'yeah omw ' + run);
  const gone = await maya.page.waitForFunction(() => !document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-chat-log .gpa-chat-receipt'), null, { timeout: 15000 }).then(() => true, () => false);
  check('kj replies: the receipt under maya’s message goes away', gone);
  check('…and kj’s reply is read by the others who have Chat open', await waitReceipt(kj.page, /^Read by /));
  await maya.page.waitForTimeout(400);
  await shot(maya.page, '04-after-reply.png');
  await kj.page.waitForTimeout(400);
  await shot(kj.page, '04b-kj-sees-read.png');

  // 5: nobody else has Chat on screen: stays "Delivered".
  await openWelcome(kj.page);
  await openWelcome(dub.page);
  await kj.page.waitForTimeout(800);
  await say(maya.page, 'ok see you there ' + run);
  check('With Chat closed on the other phones: “Delivered”', await waitReceipt(maya.page, /^Delivered$/));
  await maya.page.waitForTimeout(4000);
  check('…and it stays “Delivered” (closed Chat doesn’t count as read)', (await receipt(maya.page)).text === 'Delivered');
  await shot(maya.page, '05-still-delivered.png');
  // kj comes back to Chat: now it's read.
  await openChat(kj.page);
  check('kj opens Chat again: “Read by kj”', await waitReceipt(maya.page, new RegExp('^Read by ' + KJ + ' ')));

  for (const [n, p] of [['maya', maya], ['kj', kj], ['dub', dub]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [maya, kj, dub]) await p.ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
