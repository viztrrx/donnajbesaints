// Staff chat, on iPhones in the home-screen app against worker.js in workerd:
//   1  a moderator sees "Staff chat" right under "Chat" and posts in it
//   2  the owner (Admin connected) sees it too, with an unread badge, and replies
//   3  a regular user: no "Staff chat" in the sidebar, no staff room in the
//      room list, and asking the Worker directly gets "no such room"
//   4  "Chat" goes back to #public; staff messages never show there
//   node tests/browser/staff-chat.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'staff-chat-out';
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
const MOD = 'mod' + run, KJ = 'kj' + run;
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
const nav = (page) => R(page, (r) => [...r.querySelectorAll('.gpa-dropdown-item')].filter((b) => b.style.display !== 'none').map((b) => b.dataset.tab));
const openSidebar = (page) => R(page, (r) => { const p = r.querySelector('.gpa-panel'); if (p.classList.contains('gpa-sidebar-hidden')) r.querySelector('#gpa-sidebar-toggle').click(); });
const click = (page, tab) => R(page, (r, t) => r.querySelector(`.gpa-dropdown-item[data-tab="${t}"]`).click(), tab);
const say = async (page, text) => { await page.fill(sr('#gpa-chat-input'), text); await page.click(sr('#gpa-chat-send')); };
const logTexts = (page) => R(page, (r) => [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg .body')].map((b) => b.textContent));
const waitText = (page, text, ms = 15000) => page.waitForFunction((t) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('#gpa-chat-log .gpa-chat-msg .body')].some((b) => b.textContent === t), text, { timeout: ms }).then(() => true, () => false);

try {
  // Everyone may sign up here (the local Worker keeps settings between test runs).
  await admin('/admin/config', { allowlist: { on: false } });
  // The moderator's account: created by him, promoted by the owner.
  const mod = await phone(MOD);
  check('Moderator’s account is created', await R(mod.page, (r) => r.querySelector('#gpa-login').style.display === 'none'), await R(mod.page, (r) => r.querySelector('#gpa-login-msg').textContent));
  await admin('/admin/user/action', { u: MOD, action: 'setrole', role: 'moderator' });
  // A role change takes effect on the next sign-in.
  await R(mod.page, (r) => r.querySelector('#gpa-logout-btn').click());
  await mod.page.waitForTimeout(800);
  await mod.page.fill(sr('#gpa-login-user'), MOD);
  await mod.page.fill(sr('#gpa-login-pin'), '246810');
  await mod.page.click(sr('#gpa-login-btn'));
  const seesItem = await mod.page.waitForFunction(() => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-dropdown-item[data-tab="staffchat"]'); return b && b.style.display !== 'none'; }, null, { timeout: 20000 }).then(() => true, () => false);
  let items = await nav(mod.page);
  check('Moderator: “Staff chat” shows right under “Chat”', seesItem && items.indexOf('staffchat') === items.indexOf('chat') + 1, items.join(', '));
  await openSidebar(mod.page);
  await mod.page.waitForTimeout(500);
  await shot(mod.page, '01-moderator-sidebar.png');

  // 1: moderator posts in Staff chat.
  await click(mod.page, 'staffchat');
  await mod.page.waitForTimeout(1200);
  const hdr = await R(mod.page, (r) => ({ title: r.querySelector('.gpa-pane[data-pane="chat"] .gpx-title').textContent, room: r.querySelector('#gpa-chat-room').value, active: r.querySelector('.gpa-dropdown-item.active').dataset.tab }));
  check('Staff chat opens: titled “Staff chat”, staff room, Staff chat highlighted', hdr.title === 'Staff chat' && hdr.room === 'staff' && hdr.active === 'staffchat', JSON.stringify(hdr));
  await say(mod.page, 'heads up: new users tonight ' + run);
  check('Moderator’s message is in the staff room', await waitText(mod.page, 'heads up: new users tonight ' + run));
  await mod.page.waitForTimeout(500);
  await shot(mod.page, '02-moderator-staff-chat.png');

  // 3: a regular user.
  const kj = await phone(KJ);
  await kj.page.waitForTimeout(1500);
  items = await nav(kj.page);
  check('Regular user: no “Staff chat” in the sidebar', !items.includes('staffchat') && items.includes('chat'), items.join(', '));
  const opts = await R(kj.page, (r) => [...r.querySelectorAll('#gpa-chat-room option')].map((o) => o.value));
  check('…and no staff room in the room list', !opts.includes('staff'), opts.join(', '));
  const direct = await kj.page.evaluate(async ([u, name]) => (await fetch(u + '/chat/poll?room=staff&since=0&user=' + name)).json(), [env.workerUrl, KJ]);
  check('…and asking the Worker directly: “no such room”, no messages', direct.ok === false && direct.error === 'no such room' && !(direct.messages || []).length, JSON.stringify(direct));
  const sendTry = await kj.page.evaluate(async ([u, name]) => (await fetch(u + '/chat/send', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ user: name, text: 'hi staff', room: 'staff' }) })).json(), [env.workerUrl, KJ]);
  check('…and can’t post into it either', sendTry.ok === false, JSON.stringify(sendTry));
  await click(kj.page, 'chat');
  await kj.page.waitForTimeout(1500);
  check('…and #public never shows staff messages', !(await logTexts(kj.page)).some((t) => t.includes('heads up')));
  await openSidebar(kj.page);
  await kj.page.waitForTimeout(500);
  await shot(kj.page, '03-regular-user-sidebar.png');

  // 2: the owner, Admin connected (admin token in memory = staff).
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
  const ownerItem = await own.page.waitForFunction(() => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-dropdown-item[data-tab="staffchat"]'); return b && b.style.display !== 'none'; }, null, { timeout: 20000 }).then(() => true, () => false);
  check('Owner (Admin connected): “Staff chat” shows', ownerItem);
  const badge = await own.page.waitForFunction(() => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-staff-badge'); return b && b.style.display !== 'none' && Number(b.textContent) >= 1; }, null, { timeout: 25000 }).then(() => true, () => false);
  check('…with an unread badge for the moderator’s message', badge);
  await openSidebar(own.page);
  await own.page.waitForTimeout(500);
  await shot(own.page, '04-owner-sidebar-badge.png');
  await click(own.page, 'staffchat');
  check('Owner sees the moderator’s message', await waitText(own.page, 'heads up: new users tonight ' + run));
  check('…and the badge clears', await own.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-staff-badge').style.display === 'none', null, { timeout: 10000 }).then(() => true, () => false));
  await say(own.page, 'thanks, on it ' + run);
  check('Owner replies; the moderator gets it', await waitText(mod.page, 'thanks, on it ' + run));
  await own.page.waitForTimeout(800);
  await shot(own.page, '05-owner-staff-chat.png');

  // 4: Chat goes back to #public.
  await click(mod.page, 'chat');
  await mod.page.waitForTimeout(1500);
  const back = await R(mod.page, (r) => ({ title: r.querySelector('.gpa-pane[data-pane="chat"] .gpx-title').textContent, room: r.querySelector('#gpa-chat-room').value, active: r.querySelector('.gpa-dropdown-item.active').dataset.tab }));
  check('Moderator taps “Chat”: back to #public, titled “Chat”', back.title === 'Chat' && back.room === 'public' && back.active === 'chat', JSON.stringify(back));
  check('…without the staff messages', !(await logTexts(mod.page)).some((t) => t.includes(run) && /heads up|on it/.test(t)));

  for (const [n, p] of [['moderator', mod], ['kj', kj], ['owner', own]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [mod, kj, own]) await p.ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
