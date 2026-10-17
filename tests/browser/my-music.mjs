// My music and weekday streaks in the real console against worker.js in
// workerd, with a screenshot of each step:
//   1  kj (laptop) opens Music → My music and uploads two songs from his
//      computer; they're listed with "Mine"
//   2  kj plays one and taps 💬: maya (iPhone) gets a song card in chat,
//      taps ▶ Play and it streams in her console
//   3  kj deletes a song; maya's My music is her own
//   4  Welcome → the streak box says "Weekday streak" (on a weekend it
//      explains it's paused)
//   5  kj signs back in later on his phone: his song is still there
//   node tests/browser/my-music.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'my-music-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const admin = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const MAYA = 'maya' + run, KJ = 'kj' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const waitFor = (page, fnSrc, arg, ms = 15000) => page.waitForFunction(([src, a]) => (0, eval)(src)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fnSrc), arg], { timeout: ms, polling: 100 }).then(() => true, () => false);
const FIX = path.join(ROOT, 'tests/browser/fixtures/music');

async function device(user, kind, button = 'create') {
  const ctx = await browser.newContext(kind === 'laptop' ? { viewport: { width: 1200, height: 860 } } : { ...(devices['iPhone 15'] || devices['iPhone 14']) });
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
  await page.click(sr(button === 'create' ? '#gpa-signup-btn' : '#gpa-login-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return { ctx, page };
}
const tab = (page, t) => R(page, (r, x) => r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`).click(), t);
const titles = (page) => R(page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-title')].map((e) => e.textContent));
async function openMine(page) {
  await tab(page, 'music');
  await page.waitForTimeout(400);
  await R(page, (r) => r.querySelector('.gpx-src[data-src="mine"]').click());
  await page.waitForTimeout(800);
}

try {
  // Approved-users mode, as the real console runs: accounts work on any device.
  await admin('/admin/config', { allowlist: { on: true, users: [KJ, MAYA] } });
  const kj = await device(KJ, 'laptop'), maya = await device(MAYA);
  await tab(maya.page, 'chat');
  await tab(kj.page, 'chat');
  await kj.page.waitForTimeout(800);

  // 1: upload from the computer.
  await openMine(kj.page);
  check('My music is a Music source, empty at first', await waitFor(kj.page, (r) => /No songs yet/.test(r.querySelector('#gpa-mine-status').textContent)), await R(kj.page, (r) => r.querySelector('#gpa-mine-status').textContent));
  await kj.page.setInputFiles(sr('#gpa-mine-file'), [path.join(FIX, 'Nova - Midnight Drive.mp3'), path.join(FIX, 'Quiet Kid - Late Bus Home.mp3')]);
  const listed = await waitFor(kj.page, (r) => r.querySelectorAll('#gpa-mine-list .gpa-track').length === 2, null, 30000);
  check('kj uploads two songs from his computer; both are listed', listed, JSON.stringify(await titles(kj.page)));
  check('…marked “Mine”, with usage shown', await R(kj.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-src')].every((b) => b.textContent === 'Mine') && /2 of 50 songs/.test(r.querySelector('#gpa-mine-usage').textContent)), await R(kj.page, (r) => r.querySelector('#gpa-mine-usage').textContent));
  await shot(kj.page, '01-my-music-uploaded.png');

  // 2: share to chat; maya streams it.
  await R(kj.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-main')].find((b) => /Midnight Drive/.test(b.textContent)).click());
  await kj.page.waitForTimeout(800);
  check('Now playing shows it as “Mine”', await R(kj.page, (r) => r.querySelector('#gpa-np-src').textContent === 'Mine'));
  await shot(kj.page, '02-now-playing-mine.png');
  await kj.page.click(sr('#gpa-np-share'));
  const card = await waitFor(maya.page, (r) => [...r.querySelectorAll('.gpa-chat-track')].some((c) => /Midnight Drive/.test(c.textContent) && /Uploaded song/.test(c.textContent)), null, 15000);
  check('kj taps 💬: maya gets a song card (“Uploaded song”)', card);
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '03-maya-song-card.png');
  await R(maya.page, (r) => [...r.querySelectorAll('.gpa-chat-track')].pop().querySelector('.tr-play').click());
  const src = await maya.page.waitForFunction(() => { const a = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-np-audio'); return a && /\/music\/file\/[0-9a-f-]{36}/.test(a.src) && a.src; }, null, { timeout: 8000 }).then((h) => h.jsonValue(), () => '');
  check('maya taps ▶ Play: it streams from kj’s upload', !!src, src.replace(/[?&]s=[^&]+/, '&s=…'));
  if (src) {
    const st = await maya.page.evaluate(async (u) => { const r = await fetch(u, { headers: { Range: 'bytes=0-1023' } }); return { status: r.status, type: r.headers.get('Content-Type'), len: (await r.arrayBuffer()).byteLength }; }, src);
    check('…the audio is served to her (206, audio/mpeg)', st.status === 206 && /audio\/mpeg/.test(st.type) && st.len === 1024, JSON.stringify(st));
    const played = await maya.page.waitForFunction(() => { const a = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-np-audio'); return a && (a.readyState >= 2 || a.currentTime > 0); }, null, { timeout: 8000 }).then(() => true, () => false);
    check('…and her player loads it', played, await R(maya.page, (r) => { const a = r.querySelector('#gpa-np-audio'); return `readyState ${a.readyState}, error ${a.error && a.error.code}`; }));
  }

  // 3: maya's own list is separate; kj deletes one.
  await openMine(maya.page);
  check('maya’s My music is her own (empty)', await waitFor(maya.page, (r) => /No songs yet/.test(r.querySelector('#gpa-mine-status').textContent)));
  kj.page.once('dialog', (d) => d.accept());
  await R(kj.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track')].find((li) => /Late Bus Home/.test(li.textContent)).querySelector('.gpa-track-del').click());
  check('kj deletes “Late Bus Home”; one song left', await waitFor(kj.page, (r) => r.querySelectorAll('#gpa-mine-list .gpa-track').length === 1 && /1 of 50 songs/.test(r.querySelector('#gpa-mine-usage').textContent)), JSON.stringify(await titles(kj.page)));

  // 4: streak wording on Welcome.
  await tab(kj.page, 'welcome');
  const day = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const weekend = day === 'Sat' || day === 'Sun';
  const streak = await waitFor(kj.page, (r, we) => {
    const box = r.querySelector('#gpa-welcome-streak-box');
    const lbl = box.querySelector('.gpa-snapshot-label').textContent;
    return !box.hidden && (we ? /Weekday streak · (starts Monday|safe this weekend)/.test(lbl) : lbl === 'Weekday streak' && /🔥 1/.test(r.querySelector('#gpa-welcome-streak').textContent));
  }, weekend, 15000);
  check(`Welcome shows the weekday streak (${weekend ? 'weekend: paused' : 'weekday: 🔥 1'})`, streak, await R(kj.page, (r) => r.querySelector('#gpa-welcome-streak-box').textContent.replace(/\s+/g, ' ').trim()));
  await R(kj.page, (r) => r.querySelector('#gpa-welcome-streak-box').scrollIntoView({ block: 'center' }));
  await kj.page.waitForTimeout(300);
  await shot(kj.page, '04-weekday-streak.png');

  for (const [n, p] of [['kj', kj], ['maya', maya]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  await maya.ctx.close();

  // 5: later, kj signs in on his phone: his music is there.
  // kj signs out on the laptop (one device at a time), then signs in on his phone.
  await R(kj.page, (r) => r.querySelector('#gpa-logout-btn').click());
  await kj.page.waitForTimeout(1500);
  await kj.ctx.close();
  const kj2 = await device(KJ, 'phone', 'signin');
  if (await R(kj2.page, (r) => { const m = r.querySelector('#gpa-login-move'); return !!m && !m.hidden; })) {
    await kj2.page.click(sr('#gpa-login-move-yes'));
    await kj2.page.waitForTimeout(3000);
  }
  await openMine(kj2.page);
  const kept = await waitFor(kj2.page, (r) => r.querySelectorAll('#gpa-mine-list .gpa-track').length === 1, null, 15000);
  check('kj signs back in later on his phone: his song is still there', kept, JSON.stringify(await titles(kj2.page)));
  await shot(kj2.page, '05-my-music-signed-back-in.png');
  check('No page errors (kj’s phone)', kj2.page._errors.length === 0, kj2.page._errors.slice(0, 2).join(' | '));
  await kj2.ctx.close();

} finally {
  // Later suites share the local state: leave Allowed users off again.
  await admin('/admin/config', { allowlist: { on: false } }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
