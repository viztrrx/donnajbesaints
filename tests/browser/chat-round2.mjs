// Chat round 2 in the real console against worker.js in workerd: two iPhones
// in the home-screen app and the owner on a laptop (Admin connected), with a
// screenshot of each step:
//   1  @ suggestions: kj types "@ma", picks maya; maya's copy is highlighted
//   2  polls: "/poll Pizza or tacos?" → a poll card; votes move live
//   3  edit: maya fixes a typo within 2 minutes; kj sees it change + "edited"
//   4  pins: the owner pins a message; it shows above everyone's chat
//   5  voice: maya records with the (fake) microphone and sends; kj gets a
//      player, and the file streams in pieces (Range), as Safari needs
//   6  quiet hours: the owner turns them on; maya's box is off with a banner;
//      the owner can still post; turning them off opens it again
//   7  Settings → Account shows the Mention alerts card
//   node tests/browser/chat-round2.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'chat-round2-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
// A fake microphone (a test tone) so recording works headless.
const browser = await launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const MAYA = 'maya' + run, KJ = 'kj' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

async function device(user, kind) {
  const ctx = await browser.newContext(kind === 'laptop' ? { viewport: { width: 1100, height: 820 }, permissions: ['microphone'] } : { ...(devices['iPhone 15'] || devices['iPhone 14']), permissions: ['microphone'] });
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
const openChat = (page) => R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="chat"]').click());
const say = async (page, text) => { await page.fill(sr('#gpa-chat-input'), text); await page.press(sr('#gpa-chat-input'), 'Enter'); await page.waitForTimeout(400); };
const msgBy = (page, test) => R(page, (r, src) => {
  const f = (0, eval)(src);
  const m = [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find(f);
  return m ? { ts: m.dataset.ts, body: m.querySelector('.body').textContent, cls: m.className, head: m.querySelector('.head').textContent } : null;
}, String(test));
const waitFor = (page, fnSrc, arg, ms = 15000) => page.waitForFunction(([src, a]) => (0, eval)(src)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fnSrc), arg], { timeout: ms, polling: 250 }).then(() => true, () => false);
async function holdOn(page, bodyText) {
  const box = await page.locator(sr(`.gpa-chat-msg:has(.body:text-is("${bodyText}")) .body`)).first().boundingBox();
  await R(page, (r, [t, x, y]) => {
    const m = [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].find((e) => e.querySelector('.body').textContent === t);
    m.querySelector('.body').dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, composed: true, clientX: x, clientY: y }));
  }, [bodyText, box.x + 10, box.y + 5]);
  await page.waitForTimeout(650);
  await R(page, (r) => r.querySelector('#gpa-chat-log').dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, composed: true })));
  await page.waitForTimeout(400);
}

try {
  await admin('/admin/config', { allowlist: { on: false }, chatQuiet: { on: false, start: 23, end: 6 } });
  const maya = await device(MAYA), kj = await device(KJ);
  await openChat(maya.page); await openChat(kj.page);
  await say(maya.page, 'hi all ' + run);
  await kj.page.waitForTimeout(3500);

  // 1: @ suggestions.
  await kj.page.fill(sr('#gpa-chat-input'), '');
  // Enough of the name to be unique (other test runs leave other "maya…" in the room).
  await kj.page.type(sr('#gpa-chat-input'), 'yo @' + MAYA.slice(0, 6), { delay: 40 });
  const sug = await waitFor(kj.page, (r, u) => !r.querySelector('#gpa-chat-suggest').hidden && r.querySelector('#gpa-chat-suggest').textContent.includes(u), MAYA, 6000);
  check('kj types “@maya…”: maya is suggested', sug);
  await kj.page.waitForTimeout(200);
  await shot(kj.page, '01-mention-suggest.png');
  await kj.page.press(sr('#gpa-chat-input'), 'Enter');
  const filled = await kj.page.inputValue(sr('#gpa-chat-input'));
  check('Enter picks the name (instead of sending)', filled === `yo @${MAYA} `, filled);
  await kj.page.type(sr('#gpa-chat-input'), 'you coming tonight?');
  await kj.page.press(sr('#gpa-chat-input'), 'Enter');
  const hl = await waitFor(maya.page, (r, t) => [...r.querySelectorAll('.gpa-chat-msg.mentions-me .at-me')].some((b) => b.textContent === t), '@' + MAYA);
  check('On maya’s phone the message is highlighted, with “@maya” in bold', hl);
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '02-mention-highlight.png');

  // 2: polls.
  await say(kj.page, '/poll Pizza or tacos tonight?');
  const pollUp = await waitFor(maya.page, (r) => !!r.querySelector('.gpa-chat-msg.has-poll .gpa-chat-poll'));
  const opts = await R(maya.page, (r) => [...r.querySelectorAll('.gpa-chat-msg.has-poll button.po .pl')].map((x) => x.textContent));
  check('“/poll Pizza or tacos tonight?” makes a poll with Pizza / Tacos tonight', pollUp && JSON.stringify(opts) === JSON.stringify(['Pizza', 'Tacos tonight']), JSON.stringify(opts));
  await maya.page.click(sr('.gpa-chat-msg.has-poll button.po[data-option="1"]'));
  await kj.page.click(sr('.gpa-chat-msg.has-poll button.po[data-option="0"]'));
  const counted = await waitFor(maya.page, (r) => { const b = [...r.querySelectorAll('.gpa-chat-msg.has-poll button.po .pn')].map((x) => x.textContent); return b.join(',') === '1,1'; });
  check('Votes show live on both phones (1 · 1)', counted && await waitFor(kj.page, (r) => [...r.querySelectorAll('.gpa-chat-msg.has-poll button.po .pn')].map((x) => x.textContent).join(',') === '1,1'));
  check('…maya’s own choice is marked', await R(maya.page, (r) => r.querySelector('.gpa-chat-msg.has-poll button.po[data-option="1"]').classList.contains('mine')));
  await maya.page.waitForTimeout(400);
  await shot(maya.page, '03-poll.png');

  // 3: edit.
  await say(maya.page, 'practise at 4 ' + run);
  await waitFor(kj.page, (r, t) => [...r.querySelectorAll('.gpa-chat-msg .body')].some((b) => b.textContent === t), 'practise at 4 ' + run);
  await holdOn(maya.page, 'practise at 4 ' + run);
  const acts = await R(maya.page, (r) => [...r.querySelectorAll('.gpa-tapback-picker .tb-actions button')].map((b) => b.textContent));
  check('Her own new message offers Edit', acts.includes('Edit'), JSON.stringify(acts));
  await maya.page.click(sr('.gpa-tapback-picker [data-act="edit"]'));
  check('…the box takes the text with an “Editing message” banner', await R(maya.page, (r) => !r.querySelector('#gpa-chat-editing').hidden) && (await maya.page.inputValue(sr('#gpa-chat-input'))) === 'practise at 4 ' + run);
  await maya.page.fill(sr('#gpa-chat-input'), 'practice at 4:30 ' + run);
  await maya.page.waitForTimeout(150);
  await shot(maya.page, '04-editing.png');
  await maya.page.press(sr('#gpa-chat-input'), 'Enter');
  const edited = await waitFor(kj.page, (r, t) => [...r.querySelectorAll('.gpa-chat-msg')].some((m) => m.querySelector('.body').textContent === t && m.querySelector('.head .edited')), 'practice at 4:30 ' + run);
  check('kj sees the new text, marked “edited”', edited);
  await kj.page.waitForTimeout(300);
  await shot(kj.page, '05-edited.png');

  // 4: pins (the owner, Admin connected = staff).
  const own = await device('ivan', 'laptop');
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
  await openChat(own.page);
  await waitFor(own.page, (r, t) => [...r.querySelectorAll('.gpa-chat-msg .body')].some((b) => b.textContent === t), 'practice at 4:30 ' + run);
  await own.page.dblclick(sr(`.gpa-chat-msg:has(.body:text-is("practice at 4:30 ${run}")) .body`));
  await own.page.waitForTimeout(400);
  const ownActs = await R(own.page, (r) => [...r.querySelectorAll('.gpa-tapback-picker .tb-actions button')].map((b) => b.textContent));
  check('The owner (staff) gets “📌 Pin” in the message bar', ownActs.includes('📌 Pin'), JSON.stringify(ownActs));
  await own.page.click(sr('.gpa-tapback-picker [data-act="pin"]'));
  const pinned = await waitFor(maya.page, (r, t) => !r.querySelector('#gpa-chat-pins').hidden && r.querySelector('#gpa-chat-pins').textContent.includes(t), 'practice at 4:30 ' + run);
  check('Everyone sees it pinned above the chat', pinned);
  check('…regular people get no unpin button', await R(maya.page, (r) => !r.querySelector('#gpa-chat-pins [data-pin-off]')));
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '06-pinned.png');
  await holdOn(kj.page, 'yo @' + MAYA + ' you coming tonight?');
  check('kj (not staff) has no Pin in the bar', !(await R(kj.page, (r) => [...r.querySelectorAll('.gpa-tapback-picker .tb-actions button')].some((b) => /Pin/.test(b.textContent)))));
  await R(kj.page, (r) => { const p = r.querySelector('.gpa-tapback-picker'); if (p) p.remove(); });

  // 5: voice.
  await maya.page.click(sr('#gpa-chat-mic'));
  const recording = await waitFor(maya.page, (r) => !r.querySelector('#gpa-chat-rec').hidden, null, 5000);
  check('maya taps the mic: recording bar with a timer', recording);
  await maya.page.waitForTimeout(2300);
  await shot(maya.page, '07-recording.png');
  await maya.page.click(sr('#gpa-chat-rec-send'));
  const voiceOnKj = await waitFor(kj.page, (r, u) => [...r.querySelectorAll('.gpa-chat-msg.has-voice')].some((m) => m.dataset.u === u && m.querySelector('audio')), MAYA, 20000);
  check('kj gets a voice message with a player', voiceOnKj, await R(maya.page, (r) => r.querySelector('#gpa-chat-note').textContent));
  const src = await R(kj.page, (r) => { const a = [...r.querySelectorAll('.gpa-chat-msg.has-voice audio')].pop(); return a ? a.src : ''; });
  const range = src ? await kj.page.evaluate(async (u) => { const res = await fetch(u, { headers: { Range: 'bytes=0-15' } }); return { status: res.status, type: res.headers.get('Content-Type'), range: res.headers.get('Content-Range') }; }, src) : null;
  check('…the recording streams in pieces (206 Range), as Safari needs', range && range.status === 206 && /^audio\//.test(range.type) && /^bytes 0-15\//.test(range.range), JSON.stringify(range));
  await kj.page.waitForTimeout(300);
  await shot(kj.page, '08-voice-message.png');

  // 6: quiet hours, set to the hour we're in now (New York time).
  const nyHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  await admin('/admin/config', { chatQuiet: { on: true, start: nyHour, end: (nyHour + 2) % 24 } });
  const locked = await waitFor(maya.page, (r) => !r.querySelector('#gpa-chat-quiet').hidden && r.querySelector('#gpa-chat-input').disabled, null, 15000);
  check('Quiet hours on: maya sees the banner and her box is off', locked, await R(maya.page, (r) => r.querySelector('#gpa-chat-quiet').textContent));
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '09-quiet-hours.png');
  const ownerBanner = await waitFor(own.page, (r) => /you can still post as staff/.test(r.querySelector('#gpa-chat-quiet').textContent) && !r.querySelector('#gpa-chat-input').disabled, null, 15000);
  check('…the owner sees “you can still post as staff”', ownerBanner);
  await say(own.page, 'quiet hours test ' + run);
  check('…and the owner’s message goes through', await waitFor(maya.page, (r, t) => [...r.querySelectorAll('.gpa-chat-msg .body')].some((b) => b.textContent === t), 'quiet hours test ' + run));
  const refused = await maya.page.evaluate(async ([u, who]) => (await fetch(u + '/chat/send', { method: 'POST', body: JSON.stringify({ user: who, text: 'sneaky', room: 'public' }) })).json(), [env.workerUrl, MAYA]);
  check('…while the Worker refuses maya’s', refused.ok === false && /quiet hours/.test(refused.error), JSON.stringify(refused));
  await admin('/admin/config', { chatQuiet: { on: false, start: nyHour, end: (nyHour + 2) % 24 } });
  check('Turned off: maya’s box works again', await waitFor(maya.page, (r) => r.querySelector('#gpa-chat-quiet').hidden && !r.querySelector('#gpa-chat-input').disabled, null, 15000));

  // Admin → Moderation shows the quiet-hours card.
  await R(own.page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="admin"]').click());
  await own.page.waitForTimeout(800);
  await R(own.page, (r) => { const t = r.querySelector('.gps-tab[data-asec="moderation"]'); if (t) t.click(); });
  check('Admin → Moderation has the “Chat quiet hours” card', await waitFor(own.page, (r) => !!r.querySelector('#gac-quiet-card #gac-quiet-start option'), null, 15000));
  await own.page.locator(sr('#gac-quiet-card')).screenshot({ path: path.join(OUT, '10-admin-quiet-hours.png') });

  // 7: Settings → Account → Mention alerts.
  await R(maya.page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="theme"]').click());
  await maya.page.waitForTimeout(600);
  await R(maya.page, (r) => { const t = [...r.querySelectorAll('[data-sec="account"], .gps-tab[data-sec="account"], button')].find((b) => b.dataset && b.dataset.sec === 'account'); if (t) t.click(); });
  await maya.page.waitForTimeout(600);
  const card = await R(maya.page, (r) => { const c = r.querySelector('#gpa-mention-push'); return c ? { text: c.textContent.replace(/\s+/g, ' '), btn: c.querySelector('#gpa-mpush-toggle').textContent } : null; });
  check('Settings → Account has “Mention alerts” with Turn on', card && /Mention alerts/.test(card.text) && card.btn === 'Turn on', JSON.stringify(card));
  await R(maya.page, (r) => r.querySelector('#gpa-mention-push').scrollIntoView({ block: 'center' }));
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '11-mention-alerts-setting.png');

  for (const [n, p] of [['maya', maya], ['kj', kj], ['owner', own]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [maya, kj, own]) await p.ctx.close();
} finally {
  await admin('/admin/config', { chatQuiet: { on: false, start: 23, end: 6 } }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
