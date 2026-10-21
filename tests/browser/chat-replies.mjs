// Chat: replies, unsend (2 minutes) and grouping, against worker.js in
// workerd with the CHAT_ROOMS Durable Object. Two iPhones in the home-screen
// app and one laptop, with a screenshot of each step:
//   1  maya sends three in a row: one picture and name, three lines
//   2  kj replies to the second one (press and hold → Reply): a banner above
//      the box, then his message with a small quote; tapping it jumps there
//   3  laptop: the ↩ button on hover starts a reply too
//   4  kj sends a typo and unsends it: everyone sees "kj unsent a message",
//      and a reply that quoted it loses the text
//   5  Unsend is only offered on your own messages; the Worker refuses the rest
//   node tests/browser/chat-replies.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'chat-replies-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef', CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const MAYA = 'maya' + run, KJ = 'kj' + run, SAM = 'sam' + run;
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
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="chat"]').click());
  return { ctx, page };
}
const send = async (page, text) => { await page.fill(sr('#gpa-chat-input'), text); await page.click(sr('#gpa-chat-send')); await page.waitForTimeout(350); };
const msgSel = (text) => `.gpa-chat-msg:has(.body:text-is("${text}"))`;
const has = (page, text, ms = 12000) => page.waitForFunction((t) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('#gpa-chat-log .gpa-chat-msg .body')].some((b) => b.textContent === t), text, { timeout: ms, polling: 250 }).then(() => true, () => false);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
// People's messages only (system notices, e.g. trivia left by another test, have no avatar).
const rowsOf = (page) => R(page, (r) => [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg:not(.sys)')].map((m) => ({
  u: m.dataset.u, body: m.querySelector('.body').textContent, cont: m.classList.contains('cont'),
  avatarShown: getComputedStyle(m.querySelector('.avatar')).visibility !== 'hidden', nameShown: !!m.querySelector('.who').offsetParent,
  quote: m.querySelector('.gpa-chat-quote') ? m.querySelector('.gpa-chat-quote').textContent : null, unsent: m.classList.contains('unsent')
})));
async function holdOn(page, text) {
  const box = await page.locator(sr(msgSel(text) + ' .body')).boundingBox();
  await R(page, (r, [t, x, y]) => {
    const m = [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find((e) => e.querySelector('.body').textContent === t);
    m.querySelector('.body').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, composed: true, clientX: x, clientY: y }));
  }, [text, box.x + 10, box.y + 5]);
  await page.waitForTimeout(650);
  await R(page, (r) => r.querySelector('#gpa-chat-log').dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, composed: true })));
  await page.waitForTimeout(350);
  return R(page, (r) => { const p = r.querySelector('.gpa-tapback-picker'); return p ? [...p.querySelectorAll('.tb-actions button')].map((b) => b.textContent) : null; });
}

try {
  const maya = await device(MAYA), kj = await device(KJ);
  await kj.page.waitForTimeout(800);

  // 1: three in a row.
  const A = 'yo ' + run, B = 'practice is at 4 today ' + run, C = 'bring water ' + run;
  await send(maya.page, A); await send(maya.page, B); await send(maya.page, C);
  await has(kj.page, C);
  let rows = (await rowsOf(kj.page)).filter((x) => [A, B, C].includes(x.body));
  check('Three in a row from maya: picture and name once, then two grouped lines',
    rows.length === 3 && rows[0].avatarShown && rows[0].nameShown && !rows[0].cont && rows[1].cont && rows[2].cont && !rows[1].avatarShown && !rows[2].nameShown, JSON.stringify(rows));
  await send(kj.page, 'ok ' + run);
  await send(maya.page, 'cool ' + run);
  await has(kj.page, 'cool ' + run);
  rows = await rowsOf(kj.page);
  check('…someone else in between starts a new group (picture shows again)', rows.at(-1).avatarShown && !rows.at(-1).cont && rows.at(-2).avatarShown, JSON.stringify(rows.slice(-2)));
  await kj.page.waitForTimeout(300);
  await shot(kj.page, '01-grouped.png');

  // 2: kj replies to B.
  const actions = await holdOn(kj.page, B);
  check('Press and hold on maya’s message: Reply and Copy, no Unsend (not his)', JSON.stringify(actions) === JSON.stringify(['↩ Reply', 'Copy']), JSON.stringify(actions));
  await kj.page.click(sr('.gpa-tapback-picker [data-act="reply"]'));
  const banner = await R(kj.page, (r) => { const b = r.querySelector('#gpa-chat-replying'); return b.hidden ? null : b.textContent; });
  check('A “Replying to maya” banner shows above the box', banner && banner.startsWith('Replying to ' + MAYA) && banner.includes(B), banner);
  await kj.page.fill(sr('#gpa-chat-input'), 'wait 4 or 4:30?');
  await kj.page.waitForTimeout(200);
  await shot(kj.page, '02-replying-banner.png');
  await kj.page.click(sr('#gpa-chat-send'));
  check('maya sees kj’s reply with a quote of her message', await has(maya.page, 'wait 4 or 4:30?'));
  rows = await rowsOf(maya.page);
  const rep = rows.find((x) => x.body === 'wait 4 or 4:30?');
  check('…the quote says who and what', rep && rep.quote === `↩ You${B}`, JSON.stringify(rep));
  check('…and the banner on kj’s phone is gone after sending', await R(kj.page, (r) => r.querySelector('#gpa-chat-replying').hidden));
  await maya.page.click(sr(msgSel('wait 4 or 4:30?') + ' .gpa-chat-quote'));
  const flashed = await maya.page.waitForFunction((t) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gpa-chat-msg.gpa-chat-flash .body')].some((b) => b.textContent === t), B, { timeout: 2000 }).then(() => true, () => false);
  check('Tapping the quote jumps to the original and highlights it', flashed);
  await maya.page.waitForTimeout(150);
  await shot(maya.page, '03-reply-and-jump.png');
  // Escape / ✕ cancels a reply.
  await holdOn(maya.page, 'wait 4 or 4:30?');
  await maya.page.click(sr('.gpa-tapback-picker [data-act="reply"]'));
  await maya.page.click(sr('#gpa-chat-replying .r-x'));
  check('✕ cancels a reply', await R(maya.page, (r) => r.querySelector('#gpa-chat-replying').hidden));

  // 3: laptop hover ↩.
  const sam = await device(SAM, 'laptop');
  await has(sam.page, C);
  await sam.page.hover(sr(msgSel(C)));
  await sam.page.waitForTimeout(150);
  check('Laptop: a grouped line shows ↩ and ☺ on hover', await sam.page.locator(sr(msgSel(C) + ' .gpa-chat-reply-btn')).isVisible() && await sam.page.locator(sr(msgSel(C) + ' .gpa-chat-react-btn')).isVisible());
  await sam.page.locator(sr('#gpa-chat-log')).screenshot({ path: path.join(OUT, '04-laptop-hover.png') });
  await sam.page.click(sr(msgSel(C) + ' .gpa-chat-reply-btn'));
  check('…and ↩ starts a reply', await R(sam.page, (r, u) => !r.querySelector('#gpa-chat-replying').hidden && r.querySelector('#gpa-chat-replying').textContent.startsWith('Replying to ' + u), MAYA));
  await sam.page.keyboard.press('Escape');

  // 4: unsend.
  const TYPO = 'omg i lvoe this song ' + run;
  await send(kj.page, TYPO);
  await has(maya.page, TYPO);
  // maya quotes it before it's unsent.
  await holdOn(maya.page, TYPO);
  await maya.page.click(sr('.gpa-tapback-picker [data-act="reply"]'));
  await send(maya.page, 'lmao ' + run);
  await has(kj.page, 'lmao ' + run);
  const kjActions = await holdOn(kj.page, TYPO);
  check('On his own new message kj gets Edit and Unsend', JSON.stringify(kjActions) === JSON.stringify(['↩ Reply', 'Copy', 'Edit', 'Unsend']), JSON.stringify(kjActions));
  await kj.page.waitForTimeout(150);
  await shot(kj.page, '05-unsend-option.png');
  await kj.page.click(sr('.gpa-tapback-picker [data-act="unsend"]'));
  check('kj’s phone: “You unsent a message”', await kj.page.waitForFunction(() => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gpa-chat-msg.unsent .body')].some((b) => b.textContent === 'You unsent a message'), null, { timeout: 5000 }).then(() => true, () => false));
  const gone = await maya.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gpa-chat-msg.unsent .body')].some((b) => b.textContent === u + ' unsent a message'), KJ, { timeout: 12000 }).then(() => true, () => false);
  check('maya’s phone: “kj unsent a message”, within a few seconds', gone);
  rows = await rowsOf(maya.page);
  check('…the text is gone from her screen, and her reply’s quote says “Unsent message”',
    !rows.some((x) => x.body === TYPO) && (rows.find((x) => x.body === 'lmao ' + run) || {}).quote === '↩ ' + KJ + 'Unsent message', JSON.stringify(rows.slice(-3)));
  await maya.page.waitForTimeout(200);
  await shot(maya.page, '06-unsent.png');
  // A fresh screen (sam's laptop reloads) gets the placeholder, not the text.
  await sam.page.reload();
  await sam.page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await R(sam.page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="chat"]').click());
  const fresh = await sam.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gpa-chat-msg.unsent .body')].some((b) => b.textContent === u + ' unsent a message'), KJ, { timeout: 12000 }).then(() => true, () => false);
  const samText = await R(sam.page, (r) => r.querySelector('#gpa-chat-log').textContent);
  check('Someone opening the chat later sees only “kj unsent a message”', fresh && !samText.includes('lvoe') && samText.includes('lmao'), samText.slice(-160));

  // 5: the Worker refuses unsending someone else's message.
  const ts = await R(maya.page, (r, t) => Number([...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find((m) => m.querySelector('.body').textContent === t).dataset.ts), 'wait 4 or 4:30?');
  const forged = await maya.page.evaluate(async ([u, who, ts]) => (await fetch(u + '/chat/unsend', { method: 'POST', body: JSON.stringify({ user: who, ts, room: 'public' }) })).json(), [env.workerUrl, MAYA, ts]);
  check('Unsending someone else’s message is refused by the Worker', forged.ok === false, JSON.stringify(forged));

  for (const [n, p] of [['maya', maya], ['kj', kj], ['sam', sam]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [maya, kj, sam]) await p.ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
