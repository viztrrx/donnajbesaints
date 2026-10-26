// Messages with someone who isn't on the allowed-users list, end to end
// against worker.js in workerd, with a screenshot of every step:
//   1  "dub" (not listed) tries to sign in: the chat box shows
//   2  the owner writes first (Admin → Security → Messages, phone app)
//   3  dub sees it on the sign-in screen and answers
//   4  the owner sees the answer and replies; dub sees the reply
//   5  another browser typing "dub" doesn't see the conversation
//   node tests/browser/access-chat.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'access-chat-out';
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
const DUB = 'dub' + run, STAFF = 'staff' + run;
const shot = (page, name) => page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, name) });
const sr = (sel) => `#gpa-root-host >> ${sel}`;

async function open(device) {
  const ctx = await browser.newContext(device === 'phone' ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1000, height: 820 } });
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
async function attempt(page, name, button) {
  await page.fill(sr('#gpa-login-user'), name);
  await page.fill(sr('#gpa-login-pin'), '123456');
  await page.click(sr(button === 'signin' ? '#gpa-login-btn' : '#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  return R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
}
const chatState = (page) => R(page, (r) => { const c = r.querySelector('.gpa-achat'); return { shown: !!c && !c.hidden, hint: c ? c.querySelector('.gpa-achat-hint').textContent : '', msgs: c ? [...c.querySelectorAll('.gpa-achat-msg')].map((m) => m.textContent) : [] }; });
const dismissLang = (page) => R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
const connectAdmin = (page) => R(page, (r, a) => {
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
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);

try {
  await ownerSays({ allowlist: { on: true, users: [STAFF] } });

  // 1: an unlisted name tries to sign in.
  const visitor = await open('desktop');
  const r = await attempt(visitor.page, DUB, 'signup');
  check('Unlisted name is refused', !r.inside && r.msg === 'Unable to create account', r.msg);
  let c = await chatState(visitor.page);
  check('…and the “Message the owner” box shows', c.shown && /message you here/.test(c.hint), JSON.stringify(c));
  await shot(visitor.page, '01-visitor-chat-box.png');

  // 2: the owner's phone app, Admin → Security → Messages.
  const ownerApp = await open('phone');
  // Signed in as a listed name; Admin connects with the owner's token.
  const staffIn = await attempt(ownerApp.page, STAFF, 'signup');
  check('The phone app is signed in', staffIn.inside, JSON.stringify(staffIn));
  await dismissLang(ownerApp.page);
  await connectAdmin(ownerApp.page);
  await ownerApp.page.waitForTimeout(2500);
  await R(ownerApp.page, (r) => { const t = r.querySelector('.gps-tab[data-asec="security"]'); if (t) t.click(); });
  const listed = await waitFor(ownerApp.page, (r, u) => !!r.querySelector(`#gac-access-chat .gac-achat-row[data-user="${u}"]`), DUB);
  check('Owner sees the person who tried, under Messages', listed);
  await R(ownerApp.page, (r) => r.querySelector('#gac-access-chat').closest('.gac-card').scrollIntoView({ block: 'start' }));
  await ownerApp.page.screenshot({ path: path.join(OUT, '02-owner-messages-list.png') });
  await R(ownerApp.page, (r, u) => r.querySelector(`#gac-access-chat .gac-achat-row[data-user="${u}"] [data-chat="open"]`).click(), DUB);
  await waitFor(ownerApp.page, (r) => !!r.querySelector('#gac-access-chat .gac-achat-form'));
  await ownerApp.page.fill(sr('#gac-access-chat .gac-achat-form textarea'), 'Hi! Who is this?');
  await ownerApp.page.click(sr('#gac-access-chat .gac-achat-form button[type="submit"]'));
  const ownerSent = await waitFor(ownerApp.page, (r) => [...r.querySelectorAll('#gac-access-chat .gac-achat-msg')].some((m) => /Who is this/.test(m.textContent)));
  check('Owner writes first from the phone app', ownerSent);
  await ownerApp.page.screenshot({ path: path.join(OUT, '03-owner-writes-first.png') });

  // 3: the visitor sees it (the box checks every few seconds) and answers.
  const got = await waitFor(visitor.page, (r) => [...r.querySelectorAll('.gpa-achat-msg')].some((m) => /Who is this/.test(m.textContent)), null, 20000);
  check('The person sees the owner’s message on the sign-in screen', got);
  await visitor.page.fill(sr('.gpa-achat-input'), 'It’s Dub from 3rd period');
  await visitor.page.click(sr('.gpa-achat-send'));
  await visitor.page.waitForTimeout(1200);
  c = await chatState(visitor.page);
  check('…and answers', c.msgs.length === 2 && /3rd period/.test(c.msgs[1]) && /^You/.test(c.msgs[1]), JSON.stringify(c.msgs));
  await shot(visitor.page, '04-visitor-answers.png');

  // 4: the owner's open conversation refreshes by itself; reply.
  const ans = await waitFor(ownerApp.page, (r) => [...r.querySelectorAll('#gac-access-chat .gac-achat-msg')].some((m) => /3rd period/.test(m.textContent)), null, 20000);
  check('Owner sees the answer without reloading', ans);
  await ownerApp.page.fill(sr('#gac-access-chat .gac-achat-form textarea'), 'Ok, I’ll add you.');
  await ownerApp.page.click(sr('#gac-access-chat .gac-achat-form button[type="submit"]'));
  await ownerApp.page.waitForTimeout(1200);
  await ownerApp.page.screenshot({ path: path.join(OUT, '05-owner-replies.png') });
  const reply = await waitFor(visitor.page, (r) => [...r.querySelectorAll('.gpa-achat-msg')].some((m) => /add you/.test(m.textContent)), null, 20000);
  check('The person sees the reply', reply);
  await shot(visitor.page, '06-visitor-sees-reply.png');

  // Deep link from the phone notification opens that conversation.
  const id = await R(ownerApp.page, (r) => r.querySelector('#gac-access-chat .gac-achat').dataset.id);
  await R(ownerApp.page, (r) => r.querySelector('#gac-access-chat [data-chat="back"]').click());
  await ownerApp.page.waitForTimeout(800);
  await ownerApp.page.evaluate((h) => { location.hash = h; window.dispatchEvent(new HashChangeEvent('hashchange')); }, `#tab=admin&sec=security&focus=chat&user=${DUB}&id=${encodeURIComponent(id)}`);
  const deep = await waitFor(ownerApp.page, (r, i) => { const b = r.querySelector('#gac-access-chat .gac-achat'); return !!b && b.dataset.id === i; }, id);
  check('The notification link opens that conversation', deep);
  check('No page errors (owner app)', ownerApp.page._errors.length === 0, ownerApp.page._errors.slice(0, 2).join(' | '));
  check('No page errors (sign-in screen)', visitor.page._errors.length === 0, visitor.page._errors.slice(0, 2).join(' | '));

  // 5: another browser, same name: an empty conversation of its own.
  const other = await open('desktop');
  await attempt(other.page, DUB, 'signup');
  c = await chatState(other.page);
  check('Another browser typing the same name doesn’t see the conversation', c.shown && c.msgs.length === 0, JSON.stringify(c.msgs));
  await other.ctx.close();
  await visitor.ctx.close();
  await ownerApp.ctx.close();
} finally {
  await ownerSays({ allowlist: { on: false, users: [] } }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
