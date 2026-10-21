// Messages (direct messages and group chats), @everyone and the Welcome
// stats, on iPhones (and one desktop) against worker.js in workerd:
//   1  "Messages" sits under Chat with a NEW label, which goes once opened
//   2  a direct message: start it, send, the other person gets a badge,
//      opens it, replies
//   3  a group chat with @everyone: highlighted for the members
//   4  outsiders can't read a conversation; an admin can in Safety review,
//      read-only, and a regular user has no Safety review
//   5  leaving a group, Chat still works, the Welcome stats card fills in
//   node tests/browser/messages.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'messages-out';
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
const ANA = 'ana' + run, BEN = 'ben' + run, CY = 'cy' + run, ADM = 'adm' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const W = (page, fn, arg, ms = 20000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);

async function device(user, kind = 'phone') {
  const ctx = await browser.newContext(kind === 'phone' ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1280, height: 860 } });
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
const relogin = async (p, user) => {
  await R(p.page, (r) => r.querySelector('#gpa-logout-btn').click());
  await p.page.waitForTimeout(800);
  await p.page.fill(sr('#gpa-login-user'), user);
  await p.page.fill(sr('#gpa-login-pin'), '246810');
  await p.page.click(sr('#gpa-login-btn'));
  await p.page.waitForTimeout(2500);
};
const nav = (page) => R(page, (r) => [...r.querySelectorAll('.gpa-dropdown-item')].filter((b) => b.style.display !== 'none').map((b) => b.dataset.tab));
const openSidebar = (page) => R(page, (r) => { const p = r.querySelector('.gpa-panel'); if (p.classList.contains('gpa-sidebar-hidden')) r.querySelector('#gpa-sidebar-toggle').click(); });
const click = (page, tab) => R(page, (r, t) => r.querySelector(`.gpa-dropdown-item[data-tab="${t}"]`).click(), tab);
const say = async (page, text) => { await page.fill(sr('#gpa-chat-input'), text); await page.click(sr('#gpa-chat-send')); };
const hasMsg = (page, text, ms = 15000) => W(page, (r, t) => [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg .body')].some((b) => b.textContent === t), text, ms);
const token = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gpa_session_token')).token; } catch (e) { return ''; } });
const rows = (page) => R(page, (r) => [...r.querySelectorAll('#gpa-dm-list li > button')].map((b) => ({ id: b.dataset.id, text: b.textContent, unread: b.classList.contains('unread') })));
const startForm = async (page, which, { to = [], name = '' } = {}) => {
  await R(page, (r, w) => r.querySelector(w === 'group' ? '#gpa-dm-newgroup' : '#gpa-dm-new').click(), which);
  await page.waitForTimeout(300);
  if (name) await page.fill(sr('#gpa-dm-name'), name);
  for (const n of to) { await page.fill(sr('#gpa-dm-to'), n); if (which === 'group') await page.click(sr('#gpa-dm-add')); }
  await page.click(sr('#gpa-dm-go'));
};

try {
  await admin('/admin/config', { allowlist: { on: false } });
  const ana = await device(ANA), ben = await device(BEN), cy = await device(CY);
  const adm = await device(ADM, 'desktop');
  await admin('/admin/user/action', { u: ADM, action: 'setrole', role: 'admin' });
  await relogin(adm, ADM);

  // 1: the sidebar item.
  let items = await nav(ana.page);
  const pill = await R(ana.page, (r) => { const p = r.querySelector('#gpa-dm-newpill'); return { shown: !!p && !p.hidden, text: p && p.textContent }; });
  check('“Messages” is in the sidebar right after Chat, labeled NEW', items.includes('dms') && items.indexOf('dms') <= items.indexOf('chat') + 2 && pill.shown && pill.text === 'NEW', items.join(', ') + ' ' + JSON.stringify(pill));
  await openSidebar(ana.page);
  await ana.page.waitForTimeout(500);
  await shot(ana.page, '01-sidebar-new-label.png');
  await click(ana.page, 'dms');
  await ana.page.waitForTimeout(1500);
  const opened = await R(ana.page, (r) => ({ title: r.querySelector('.gpa-pane[data-pane="chat"] .gpx-title').textContent, list: !r.querySelector('#gpa-dm').hidden,
    pill: r.querySelector('#gpa-dm-newpill').hidden, logHidden: getComputedStyle(r.querySelector('#gpa-chat-log')).display === 'none',
    active: r.querySelector('.gpa-dropdown-item.active') && r.querySelector('.gpa-dropdown-item.active').dataset.tab }));
  check('Messages opens: titled “Messages”, the conversation list, no room log', opened.title === 'Messages' && opened.list && opened.logHidden && opened.active === 'dms', JSON.stringify(opened));
  check('…the NEW label goes once you’ve opened it', opened.pill === true);
  await shot(ana.page, '02-messages-empty.png');

  // 2: a direct message.
  await startForm(ana.page, 'dm', { to: [BEN] });
  const inDm = await W(ana.page, () => { const p = document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-pane[data-pane="chat"]'); return p.classList.contains('is-dm') && !p.classList.contains('dm-listing'); });
  const dmHead = await R(ana.page, (r) => r.querySelector('#gpa-dm-head .t').textContent);
  check('New message → the conversation opens, titled with their name', inDm && dmHead === BEN, dmHead);
  await say(ana.page, 'hey ben ' + run);
  check('Ana’s message shows', await hasMsg(ana.page, 'hey ben ' + run));
  await ana.page.waitForTimeout(600);
  await shot(ana.page, '03-direct-message.png');
  const badge = await W(ben.page, () => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-dm-badge'); return b.style.display !== 'none' && Number(b.textContent) >= 1; }, null, 30000);
  check('Ben gets a Messages badge without opening anything', badge);
  await openSidebar(ben.page);
  await ben.page.waitForTimeout(400);
  await shot(ben.page, '04-badge.png');
  await click(ben.page, 'dms');
  await ben.page.waitForTimeout(1500);
  const benRows = await rows(ben.page);
  const dmId = (benRows[0] && benRows[0].id) || '';
  check('Ben’s list: the conversation with Ana, unread, with the message', benRows.length === 1 && benRows[0].unread && benRows[0].text.includes(ANA) && benRows[0].text.includes('hey ben ' + run), JSON.stringify(benRows));
  await shot(ben.page, '05-list-unread.png');
  await R(ben.page, (r) => r.querySelector('#gpa-dm-list li > button').click());
  check('Ben opens it and reads it', await hasMsg(ben.page, 'hey ben ' + run));
  await say(ben.page, 'hi ana ' + run);
  check('Ben replies; Ana gets it', await hasMsg(ana.page, 'hi ana ' + run));
  const cleared = await W(ben.page, () => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-dm-badge').style.display === 'none', null, 10000);
  check('…and Ben’s badge clears', cleared);

  // 3: a group with @everyone.
  await R(ana.page, (r) => r.querySelector('#gpa-dm-back').click());
  await ana.page.waitForTimeout(800);
  await startForm(ana.page, 'group', { name: 'Study run ' + run, to: [BEN, CY] });
  const gHead = await W(ana.page, (r, n) => (r.querySelector('#gpa-dm-head .t') || {}).textContent === n, 'Study run ' + run);
  check('New group → it opens with its name and members', gHead && (await R(ana.page, (r) => r.querySelector('#gpa-dm-head .m').textContent)).includes(CY));
  check('…with a “started” notice', await W(ana.page, (r, n) => [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg.sys .body')].some((b) => b.textContent.includes('started “' + n + '”')), 'Study run ' + run));
  await say(ana.page, '@everyone test at 4 ' + run);
  await click(cy.page, 'dms');
  await cy.page.waitForTimeout(1500);
  const cyRows = await rows(cy.page);
  check('Cy has the group in Messages', cyRows.some((x) => x.text.includes('Study run ' + run)), JSON.stringify(cyRows));
  await R(cy.page, (r, n) => [...r.querySelectorAll('#gpa-dm-list li > button')].find((b) => b.textContent.includes(n)).click(), 'Study run ' + run);
  check('Cy sees the @everyone message', await hasMsg(cy.page, '@everyone test at 4 ' + run));
  const hl = await R(cy.page, (r, t) => { const m = [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find((x) => x.querySelector('.body') && x.querySelector('.body').textContent === t); return { me: m && m.classList.contains('mentions-me'), bold: !!(m && m.querySelector('.at-me')) }; }, '@everyone test at 4 ' + run);
  check('…highlighted for Cy like a mention of her', hl.me && hl.bold, JSON.stringify(hl));
  await cy.page.waitForTimeout(500);
  await shot(cy.page, '06-group-everyone.png');
  // The mention list offers @everyone.
  await cy.page.fill(sr('#gpa-chat-input'), '@ev');
  await cy.page.dispatchEvent(sr('#gpa-chat-input'), 'input');
  const sug = await R(cy.page, (r) => [...r.querySelectorAll('#gpa-chat-suggest li')].map((l) => l.textContent));
  check('Typing “@ev” suggests @everyone', sug.some((x) => /everyone$/.test(x)), sug.join(', '));
  await cy.page.fill(sr('#gpa-chat-input'), '');
  // @everyone in #public, twice: the second is sent without alerts.
  await click(ben.page, 'chat');
  await ben.page.waitForTimeout(1200);
  await say(ben.page, '@everyone public one ' + run);
  await hasMsg(ben.page, '@everyone public one ' + run);
  await say(ben.page, '@everyone public two ' + run);
  const toast = await ben.page.waitForFunction(() => /once every 10 minutes/.test(document.getElementById('gpa-root-host').shadowRoot.textContent), null, { timeout: 8000 }).then(() => true, () => false);
  check('A second @everyone within 10 minutes is sent, and says it alerted no one', toast && (await hasMsg(ben.page, '@everyone public two ' + run)));

  // 4: outsiders and safety review.
  const cyTok = await token(cy.page);
  const peek = await cy.page.evaluate(async ([u, id, s]) => (await fetch(`${u}/chat/poll?room=${id}&since=0&s=${encodeURIComponent(s)}`)).json(), [env.workerUrl, dmId, cyTok]);
  check('Cy (not in it) can’t read Ana and Ben’s conversation: “no such room”', /^dm-/.test(dmId) && peek.ok === false && peek.error === 'no such room' && !(peek.messages || []).length, dmId + ' ' + JSON.stringify(peek).slice(0, 120));
  const cyReview = await cy.page.evaluate(async ([u, s]) => (await fetch(`${u}/dm/review?s=${encodeURIComponent(s)}`)).status, [env.workerUrl, cyTok]);
  const cyBtn = await R(cy.page, (r) => r.querySelector('#gpa-dm-review').hidden);
  check('A regular user has no Safety review (button hidden, Worker says 403)', cyBtn && cyReview === 403, String(cyReview));
  await click(adm.page, 'dms');
  const admBtn = await W(adm.page, (r) => !r.querySelector('#gpa-dm-review').hidden, null, 25000);
  check('The admin sees “Safety review”', admBtn);
  await R(adm.page, (r) => r.querySelector('#gpa-dm-review').click());
  const listed = await W(adm.page, (r, a) => [...r.querySelectorAll('#gpa-dm-list li > button')].some((b) => b.textContent.includes(a[0]) && b.textContent.includes(a[1])), [ANA, BEN], 15000);
  check('…which lists every conversation, including Ana and Ben’s', listed);
  await adm.page.waitForTimeout(400);
  await shot(adm.page, '07-safety-review-list.png');
  await R(adm.page, (r, a) => [...r.querySelectorAll('#gpa-dm-list li > button')].find((b) => b.textContent.includes(a[0] + ' & ') || (b.textContent.includes(a[0]) && b.textContent.includes(a[1]) && !b.textContent.includes('Study'))).click(), [ANA, BEN]);
  check('The admin can read it', await hasMsg(adm.page, 'hey ben ' + run) && (await hasMsg(adm.page, 'hi ana ' + run)));
  const ro = await R(adm.page, (r) => ({ tag: (r.querySelector('#gpa-dm-head .review-tag') || {}).textContent, composer: getComputedStyle(r.querySelector('.gpa-pane[data-pane="chat"] .gpx-composer-dock')).display, cls: r.querySelector('.gpa-pane[data-pane="chat"]').className }));
  check('…read-only: marked “Safety review”, no message box', /Safety review/.test(ro.tag || '') && ro.composer === 'none', JSON.stringify(ro));
  await adm.page.waitForTimeout(500);
  await shot(adm.page, '08-safety-review-open.png');
  const admTok = await token(adm.page);
  const admSend = await adm.page.evaluate(async ([u, id, s]) => (await fetch(u + '/chat/send', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-GPA-Session': s }, body: JSON.stringify({ room: id, text: 'sneaky' }) })).json(), [env.workerUrl, dmId, admTok]);
  check('…and the Worker refuses a post from the admin into it', admSend.ok === false, JSON.stringify(admSend));
  const receipt = await R(ana.page, (r, a) => r.textContent.includes('Read by ' + a), ADM);
  check('Reviewing leaves no “Read by” in the conversation', !receipt);

  // 5: leave, Chat, stats.
  await cy.page.evaluate(() => { window.confirm = () => true; });
  await R(cy.page, (r) => [...r.querySelectorAll('#gpa-dm-head .tools button')].find((b) => b.textContent === 'Leave').click());
  const left = await W(cy.page, (r) => r.querySelector('.gpa-pane[data-pane="chat"]').classList.contains('dm-listing'), null, 10000);
  const cyAfter = await rows(cy.page);
  check('Cy leaves the group: back to the list, the group gone from it', left && !cyAfter.some((x) => x.text.includes('Study run ' + run)), JSON.stringify(cyAfter));
  check('…and the group says so', await hasMsg(ana.page, CY + ' left the group.', 20000) || (await W(ana.page, (r, t) => r.textContent.includes(t), CY + ' left the group.', 20000)));
  await click(cy.page, 'chat');
  await cy.page.waitForTimeout(1500);
  const chatBack = await R(cy.page, (r) => ({ title: r.querySelector('.gpa-pane[data-pane="chat"] .gpx-title').textContent, room: r.querySelector('#gpa-chat-room').value, dm: r.querySelector('.gpa-pane[data-pane="chat"]').classList.contains('is-dm'), sel: getComputedStyle(r.querySelector('#gpa-chat-room')).display }));
  check('Chat still works: #public, titled “Chat”, room picker back', chatBack.title === 'Chat' && chatBack.room === 'public' && !chatBack.dm && chatBack.sel !== 'none', JSON.stringify(chatBack));
  check('…with Ben’s @everyone highlighted for Cy', await W(cy.page, (r, t) => { const m = [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find((x) => x.querySelector('.body') && x.querySelector('.body').textContent === t); return m && m.classList.contains('mentions-me'); }, '@everyone public one ' + run, 10000));
  // The Worker works the stats out at most once a minute (and the page asks
  // at most once a minute), so an earlier visit's numbers can show first.
  let stats = false;
  for (let i = 0; i < 3 && !stats; i++) {
    await click(adm.page, 'welcome');
    stats = await W(adm.page, (r) => { const t = r.querySelector('#gpa-ps-today'); return t && /\d/.test(t.textContent) && Number(t.textContent.replace(/,/g, '')) >= 4; }, null, 15000);
    if (!stats) { await click(adm.page, 'chat'); await adm.page.waitForTimeout(50000); }
  }
  const st = await R(adm.page, (r) => ['people', 'online', 'today', 'week', 'groups'].map((k) => r.querySelector('#gpa-ps-' + k).textContent).join(' | ') + ' · ' + r.querySelector('#gpa-ps-lists').textContent);
  check('Welcome: the stats card shows members, online, messages and groups', stats && !st.includes('--'), st);
  await adm.page.evaluate(() => { const r = document.getElementById('gpa-root-host').shadowRoot; r.querySelector('#gpa-pubstats').scrollIntoView({ block: 'center' }); });
  await adm.page.waitForTimeout(500);
  await shot(adm.page, '09-welcome-stats.png');
  await click(ana.page, 'welcome');
  await W(ana.page, (r) => /\d/.test((r.querySelector('#gpa-ps-today') || {}).textContent || ''), null, 20000);
  await ana.page.evaluate(() => { const r = document.getElementById('gpa-root-host').shadowRoot; r.querySelector('#gpa-pubstats').scrollIntoView({ block: 'start' }); });
  await ana.page.waitForTimeout(500);
  await shot(ana.page, '10-welcome-stats-phone.png');
  // Dark theme on the phone: the list still reads.
  await ana.page.emulateMedia({ colorScheme: 'dark' });
  await click(ana.page, 'dms');
  await ana.page.waitForTimeout(1500);
  await shot(ana.page, '11-messages-list-dark.png');

  for (const [n, p] of [['ana', ana], ['ben', ben], ['cy', cy], ['admin', adm]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [ana, ben, cy, adm]) await p.ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
