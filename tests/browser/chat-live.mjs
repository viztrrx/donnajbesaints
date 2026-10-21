// Chat: who's typing, who's here, and reactions (tapbacks), against worker.js
// in workerd with the CHAT_ROOMS Durable Object. Three iPhones in the
// home-screen app and one laptop, with a screenshot of each step:
//   1  who's here: "kj is here · 1 online" (dub has the console open elsewhere)
//   2  kj types: maya sees "kj is typing…"; two at once: "kj and dub are typing…"
//   3  sending (or emptying the box) ends it
//   4  the full list: In this chat / Online / Typing…
//   5  reactions: press and hold (phone), double-tap (phone), double-click
//      (laptop); everyone sees them; tapping your own takes it off
//   6  someone who leaves shows "Last seen … ago"
//   node tests/browser/chat-live.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'chat-live-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef', CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const MAYA = 'maya' + run, KJ = 'kj' + run, DUB = 'dub' + run, SAM = 'sam' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;

async function device(user, kind) {
  const ctx = await browser.newContext(kind === 'laptop' ? { viewport: { width: 1100, height: 800 } } : { ...(devices['iPhone 15'] || devices['iPhone 14']) });
  await ctx.addInitScript(([u, phone]) => {
    if (phone) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ }
  }, [env.workerUrl, kind !== 'laptop']);
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
const openTab = (page, tab) => R(page, (r, t) => r.querySelector(`.gpa-dropdown-item[data-tab="${t}"]`).click(), tab);
const typeIn = (page, text) => page.fill(sr('#gpa-chat-input'), text);
const send = async (page, text) => { await page.fill(sr('#gpa-chat-input'), text); await page.click(sr('#gpa-chat-send')); };
const waitText = (page, sel, re, ms = 15000) => page.waitForFunction(([s, src]) => {
  const el = document.getElementById('gpa-root-host').shadowRoot.querySelector(s);
  return !!el && !el.hidden && new RegExp(src).test(el.textContent);
}, [sel, re.source], { timeout: ms, polling: 200 }).then(() => true, () => false);
const typingText = (page) => R(page, (r) => { const el = r.querySelector('#gpa-chat-typing'); return el.hidden ? '' : el.querySelector('.gpa-chat-typing-text').textContent; });
const peopleSum = (page) => R(page, (r) => { const el = r.querySelector('.gpa-chat-people-sum'); return el ? el.textContent : ''; });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const msgSel = (text) => `.gpa-chat-msg:has(.body:text-is("${text}"))`;
const pills = (page, text) => R(page, (r, t) => {
  const m = [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find((x) => x.querySelector('.body').textContent === t);
  return m ? [...m.querySelectorAll('.gpa-tapback')].map((b) => b.textContent + (b.classList.contains('mine') ? '*' : '')).join(' ') : null;
}, text);
const waitPills = (page, text, want, ms = 15000) => page.waitForFunction(([t, w]) => {
  const r = document.getElementById('gpa-root-host').shadowRoot;
  const m = [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find((x) => x.querySelector('.body').textContent === t);
  return !!m && [...m.querySelectorAll('.gpa-tapback')].map((b) => b.textContent + (b.classList.contains('mine') ? '*' : '')).join(' ') === w;
}, [text, want], { timeout: ms, polling: 250 }).then(() => true, () => false);

try {
  const maya = await device(MAYA), kj = await device(KJ), dub = await device(DUB);
  await openTab(maya.page, 'chat');
  await openTab(kj.page, 'chat');
  await openTab(dub.page, 'chat');
  await dub.page.waitForTimeout(1500);
  await openTab(dub.page, 'welcome');   // console open, chat not on screen

  // 1: who's here.
  // "· N online": people from an earlier test can still count as online for 45 s.
  check('maya sees “kj is here · N online”', await waitText(maya.page, '.gpa-chat-people-sum', new RegExp(`^${KJ} is here· \\d+ online$`), 20000), await peopleSum(maya.page));
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '01-whos-here.png');

  // 2: typing.
  await typeIn(kj.page, 'omw, be there in 5');
  check('kj types: maya sees “kj is typing…” within a few seconds', await waitText(maya.page, '#gpa-chat-typing .gpa-chat-typing-text', new RegExp(`^${KJ} is typing…$`), 6000), await typingText(maya.page));
  check('kj doesn’t see himself typing', (await typingText(kj.page)) === '');
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '02-kj-is-typing.png');
  await openTab(dub.page, 'chat');
  await typeIn(dub.page, 'same');
  check('dub too: “kj and dub are typing…”', await waitText(maya.page, '#gpa-chat-typing .gpa-chat-typing-text', new RegExp(`^${KJ} and ${DUB} are typing…$`), 8000), await typingText(maya.page));
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '03-two-typing.png');

  // 3: sending ends it; so does emptying the box.
  await kj.page.click(sr('#gpa-chat-send'));
  check('kj sends: his message shows and only dub is still typing', await waitText(maya.page, '#gpa-chat-typing .gpa-chat-typing-text', new RegExp(`^${DUB} is typing…$`), 8000)
    && await waitText(maya.page, '#gpa-chat-log', /omw, be there in 5/, 8000), await typingText(maya.page));
  await typeIn(dub.page, '');
  const gone = await maya.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-chat-typing').hidden, null, { timeout: 8000, polling: 200 }).then(() => true, () => false);
  check('dub empties the box: nobody is typing', gone);

  // 4: the full list.
  await typeIn(kj.page, 'brb');
  await waitText(maya.page, '#gpa-chat-typing .gpa-chat-typing-text', new RegExp(`^${KJ} is typing…$`), 8000);
  await openTab(dub.page, 'welcome');
  await maya.page.waitForTimeout(11000);   // "In this chat" lasts 10 s after the chat leaves the screen
  await typeIn(kj.page, 'brb!');
  await maya.page.waitForTimeout(3500);
  await maya.page.click(sr('.gpa-chat-people-toggle'));
  await maya.page.waitForTimeout(200);
  const rows = await R(maya.page, (r) => [...r.querySelectorAll('#gpa-chat-people-list li')].map((li) => li.querySelector('.nm').textContent + ': ' + li.querySelector('.st').textContent));
  check('The list says who’s typing, who’s in this chat and who’s just online', rows.includes(`${KJ}: Typing…`) && rows.includes(`${DUB}: Online`), JSON.stringify(rows));
  await shot(maya.page, '04-people-list.png');
  await maya.page.click(sr('.gpa-chat-people-toggle'));
  await typeIn(kj.page, '');

  // 5: reactions.
  await send(maya.page, 'practice moved to 4pm ' + run);
  const MSG = 'practice moved to 4pm ' + run;
  await waitText(kj.page, '#gpa-chat-log', new RegExp(MSG), 10000);
  // kj: press and hold on the phone.
  const box = await kj.page.locator(sr(msgSel(MSG) + ' .body')).boundingBox();
  await R(kj.page, (r, [t, x, y]) => {
    const m = [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find((e) => e.querySelector('.body').textContent === t);
    m.querySelector('.body').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, composed: true, clientX: x, clientY: y }));
  }, [MSG, box.x + 10, box.y + 5]);
  await kj.page.waitForTimeout(650);
  await R(kj.page, (r) => r.querySelector('#gpa-chat-log').dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, composed: true })));
  const picker = await R(kj.page, (r) => { const p = r.querySelector('.gpa-tapback-picker'); return p ? [...p.querySelectorAll('button')].map((b) => b.textContent).join(' ') : null; });
  check('kj presses and holds: the bar opens (❤️ 👍 👎 😂 ‼️ ❓, Reply, Copy; no Unsend on someone else’s)', picker === '❤️ 👍 👎 😂 ‼️ ❓ ↩ Reply Copy', picker);
  await kj.page.waitForTimeout(250);
  await shot(kj.page, '05-tapback-bar.png');
  await kj.page.waitForTimeout(400);
  await kj.page.click(sr('.gpa-tapback-picker button[data-emoji="❤️"]'));
  check('kj ❤️s it: shows at once on his phone, marked as his', await waitPills(kj.page, MSG, '❤️1*', 3000), await pills(kj.page, MSG));
  check('…and maya sees ❤️ 1 on her message', await waitPills(maya.page, MSG, '❤️1'), await pills(maya.page, MSG));
  // dub: double-tap on the phone.
  await openTab(dub.page, 'chat');
  await waitText(dub.page, '#gpa-chat-log', new RegExp(MSG), 10000);
  // Let the log finish its first redraws; a double-tap split across two
  // redraws lands on two different message elements.
  await dub.page.waitForTimeout(600);
  const dbox = await dub.page.locator(sr(msgSel(MSG) + ' .body')).boundingBox();
  await dub.page.touchscreen.tap(dbox.x + 12, dbox.y + 6);
  await dub.page.waitForTimeout(90);
  await dub.page.touchscreen.tap(dbox.x + 12, dbox.y + 6);
  const dubPicker = await dub.page.waitForFunction(() => !!document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-tapback-picker'), null, { timeout: 3000 }).then(() => true, () => false);
  check('dub double-taps: the tapback bar opens', dubPicker);
  check('…and the second tap didn’t pick anything by itself', (await pills(dub.page, MSG)) === '❤️1', await pills(dub.page, MSG));
  await dub.page.waitForTimeout(400);
  if (dubPicker) await dub.page.click(sr('.gpa-tapback-picker button[data-emoji="😂"]'));
  // sam on a laptop: double-click.
  const sam = await device(SAM, 'laptop');
  await openTab(sam.page, 'chat');
  await waitText(sam.page, '#gpa-chat-log', new RegExp(MSG), 10000);
  await sam.page.dblclick(sr(msgSel(MSG) + ' .body'));
  check('sam double-clicks on the laptop: the tapback bar opens', await R(sam.page, (r) => !!r.querySelector('.gpa-tapback-picker')));
  await sam.page.waitForTimeout(400);
  await sam.page.click(sr('.gpa-tapback-picker button[data-emoji="❤️"]'));
  check('maya sees ❤️ 2 and 😂 1', await waitPills(maya.page, MSG, '❤️2 😂1'), await pills(maya.page, MSG));
  const tip = await R(maya.page, (r, t) => {
    const m = [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find((x) => x.querySelector('.body').textContent === t);
    return m.querySelector('.gpa-tapback[data-emoji="❤️"]').title;
  }, MSG);
  check('…and hovering shows who', tip === `Love: ${KJ}, ${SAM}`, tip);
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '06-reactions.png');
  // The laptop's hover button opens the bar too.
  await sam.page.hover(sr(msgSel(MSG)));
  await sam.page.waitForTimeout(200);
  await sam.page.locator(sr('#gpa-chat-log')).screenshot({ path: path.join(OUT, '07-laptop-reactions.png') });
  check('Laptop: a ☺ react button shows on hover', await sam.page.locator(sr(msgSel(MSG) + ' .gpa-chat-react-btn')).isVisible());
  // kj takes his ❤️ off by tapping it.
  await kj.page.click(sr(msgSel(MSG) + ' .gpa-tapback[data-emoji="❤️"]'));
  check('kj taps his ❤️ again: it comes off, for everyone', await waitPills(maya.page, MSG, '❤️1 😂1'), await pills(maya.page, MSG));
  check('kj’s pills: ❤️ 1 (sam’s) and 😂 1, neither his', await waitPills(kj.page, MSG, '❤️1 😂1', 5000), await pills(kj.page, MSG));

  // 6: dub leaves: online, then last seen.
  await dub.ctx.close();
  await maya.page.click(sr('.gpa-chat-people-toggle'));
  const lastSeen = await maya.page.waitForFunction((u) => {
    const r = document.getElementById('gpa-root-host').shadowRoot;
    return [...r.querySelectorAll('#gpa-chat-people-list li')].some((li) => li.querySelector('.nm').textContent === u && /^Last seen (just now|1 min ago)$/.test(li.querySelector('.st').textContent));
  }, DUB, { timeout: 70000, polling: 1000 }).then(() => true, () => false);
  check('dub closes the app: after a bit he shows “Last seen …”', lastSeen, JSON.stringify(await R(maya.page, (r) => [...r.querySelectorAll('#gpa-chat-people-list li')].map((li) => li.textContent))));
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '08-last-seen.png');

  for (const [n, p] of [['maya', maya], ['kj', kj], ['sam', sam]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  check('No page errors (dub)', dub.page._errors.length === 0, dub.page._errors.slice(0, 2).join(' | '));
  for (const p of [maya, kj, sam]) await p.ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
