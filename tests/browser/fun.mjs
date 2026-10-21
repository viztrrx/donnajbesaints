// Round 3 ("fun") in the real console against worker.js in workerd: two
// iPhones in the home-screen app and the owner on a laptop (Admin
// connected), with a screenshot of each step:
//   1  chat effects: "congrats" → confetti on the other phone; "happy
//      birthday" → balloons; switched off in Settings → none
//   2  flair: the owner gives kj ⭐ VIP in Admin → Users; it shows next to
//      kj's name in chat
//   3  daily trivia: the owner taps "Ask a question now"; the first correct
//      answer wins and is announced
//   4  game leaderboards: maya plays Reaction Test; her best goes on the
//      leaderboard and the new record is announced in chat
//   5  now playing: maya shares a song from Music; kj taps ▶ Play and it plays
//   6  streak: Welcome → Your activity shows the weekday streak
//   node tests/browser/fun.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'fun-out';
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

async function device(user, kind) {
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
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return { ctx, page };
}
const tab = (page, t) => R(page, (r, x) => r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`).click(), t);
const say = async (page, text) => { await page.fill(sr('#gpa-chat-input'), text); await page.press(sr('#gpa-chat-input'), 'Enter'); await page.waitForTimeout(300); };
const hasMsg = (page, re, ms = 15000) => waitFor(page, (r, src) => [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg .body')].some((b) => new RegExp(src).test(b.textContent)), re.source, ms);

try {
  await admin('/admin/config', { allowlist: { on: false }, fun: { trivia: true, shoutouts: true } });
  // A song in the shared library (the owner's upload).
  for (const t of (await admin('/music/library')).tracks || []) await admin('/music/delete', { id: t.id });
  const songPath = path.join(ROOT, 'tests/browser/fixtures/music/Nova - Midnight Drive.mp3');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(songPath)], { type: 'audio/mpeg' }), 'Nova - Midnight Drive.mp3');
  const up = await fetch(env.workerUrl + '/music/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN }, body: form }).then((r) => r.json());
  check('A song is in the shared library', up.ok !== false && (up.track || up.tracks || up.ok), JSON.stringify(up).slice(0, 120));

  const maya = await device(MAYA), kj = await device(KJ);
  await tab(maya.page, 'chat'); await tab(kj.page, 'chat');
  await maya.page.waitForTimeout(1500);

  // 1: chat effects.
  await say(maya.page, `congrats ${KJ}!! 🎉`);
  const confetti = await waitFor(kj.page, (r) => !!r.querySelector('.gpa-fx'), null, 8000);
  check('maya says “congrats”: confetti on kj’s screen', confetti);
  if (confetti) { await kj.page.waitForTimeout(500); await shot(kj.page, '01-confetti.png'); }
  await kj.page.waitForFunction(() => !document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-fx'), null, { timeout: 8000 }).catch(() => {});
  await say(kj.page, `happy birthday ${MAYA}`);
  const balloons = await waitFor(maya.page, (r) => !!r.querySelector('.gpa-fx'), null, 8000);
  check('kj says “happy birthday”: balloons on maya’s screen', balloons);
  if (balloons) { await maya.page.waitForTimeout(1300); await shot(maya.page, '02-balloons.png'); }
  // kj turns effects off in Settings.
  await maya.page.waitForFunction(() => !document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-fx'), null, { timeout: 8000 }).catch(() => {});
  await kj.page.evaluate(() => localStorage.setItem('gpa_chat_effects', 'off'));
  await say(maya.page, 'gg ' + run);
  const none = !(await waitFor(kj.page, (r) => !!r.querySelector('.gpa-fx'), null, 4000));
  check('With effects off (Settings), nothing plays', none);
  await kj.page.evaluate(() => localStorage.removeItem('gpa_chat_effects'));

  // 2: flair, from Admin → Users → kj.
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
  await R(own.page, (r) => r.querySelector('.gps-tab[data-asec="users"]').click());
  await own.page.waitForTimeout(1500);
  await R(own.page, (r, u) => { const row = [...r.querySelectorAll('[data-user], .gac-user')].find((x) => (x.dataset.user || '').toLowerCase() === u || x.textContent.includes(u)); if (row) row.click(); }, KJ.toLowerCase());
  const flairCard = await waitFor(own.page, (r) => !!r.querySelector('#gac-insp-flair [data-flair="⭐"]'), null, 15000);
  check('Admin → Users → kj has a Flair card', flairCard);
  if (flairCard) {
    await own.page.click(sr('#gac-insp-flair [data-flair="⭐"]'));
    await waitFor(own.page, (r) => /now <b>|now ⭐/.test(r.querySelector('#gac-insp-flair').innerHTML), null, 10000);
    await own.page.locator(sr('#gac-insp-flair')).screenshot({ path: path.join(OUT, '03-admin-flair.png') });
  }
  await maya.page.reload();
  await maya.page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await tab(maya.page, 'chat');
  const star = await waitFor(maya.page, (r, u) => [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].some((m) => m.dataset.u === u && m.querySelector('.head .flair') && m.querySelector('.head .flair').textContent.includes('⭐')), KJ, 15000);
  check('maya sees ⭐ next to kj’s name', star, star ? '' : JSON.stringify(await (await fetch(env.workerUrl + '/chat/extras?user=x')).json()) + ' ' + JSON.stringify(await R(maya.page, (r, u) => [...r.querySelectorAll('#gpa-chat-log .gpa-chat-msg')].filter((m) => m.dataset.u === u).map((m) => m.querySelector('.head') && m.querySelector('.head').innerHTML).slice(0, 2), KJ)));
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '04-flair-in-chat.png');

  // 3: trivia, asked now by the owner.
  const asked = await admin('/admin/trivia', { action: 'now' });
  check('Owner: “Ask a question now” posts today’s trivia', asked.ok && asked.q, JSON.stringify(asked));
  check('…everyone sees it as a notice', await hasMsg(maya.page, /🧠 Trivia: /));
  await say(kj.page, 'hmm no idea');
  await say(maya.page, String(asked.a && asked.a[0]));
  const won = await hasMsg(kj.page, new RegExp(`^🎉 ${MAYA} got it! The answer was `));
  check('maya answers first: “🎉 maya got it!”', won);
  await kj.page.waitForTimeout(500);
  await shot(kj.page, '05-trivia.png');

  // 4: Reaction Test → leaderboard + record notice.
  await tab(maya.page, 'games');
  await maya.page.waitForTimeout(500);
  await R(maya.page, (r) => r.querySelector('.game-btn[data-game="reaction"]').click());
  await maya.page.waitForTimeout(500);
  await maya.page.click(sr('.reaction-box'));
  await maya.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('.reaction-box').classList.contains('ready'), null, { timeout: 10000, polling: 20 });
  await maya.page.waitForTimeout(160);
  await maya.page.click(sr('.reaction-box'));
  await maya.page.waitForTimeout(1500);
  await R(maya.page, (r) => { r.querySelector('#gpa-lb').open = true; });
  const lb = await waitFor(maya.page, (r, u) => [...r.querySelectorAll('#gpa-lb-body li.me')].some((li) => li.textContent.includes(u)), MAYA, 10000);
  check('maya’s reaction time is on the leaderboard, highlighted', lb, await R(maya.page, (r) => r.querySelector('#gpa-lb-body').textContent));
  await R(maya.page, (r) => r.querySelector('#gpa-lb').scrollIntoView({ block: 'center' }));
  await maya.page.waitForTimeout(300);
  await shot(maya.page, '06-leaderboard.png');
  check('…and “🏆 maya set a new record in Reaction Test” appears in chat', await hasMsg(kj.page, new RegExp(`^🏆 ${MAYA} set a new record in Reaction Test: \\d+ ms$`)));

  // 5: share a song.
  await tab(maya.page, 'music');
  await maya.page.waitForTimeout(500);
  await R(maya.page, (r) => r.querySelector('.gpx-src[data-src="shared"]').click());
  await maya.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('#gpa-shared-list .gpa-track').length > 0, null, { timeout: 15000 });
  await R(maya.page, (r) => r.querySelector('#gpa-shared-list .gpa-track-main').click());
  await maya.page.waitForTimeout(800);
  await maya.page.click(sr('#gpa-np-share'));
  const card = await waitFor(kj.page, (r) => [...r.querySelectorAll('.gpa-chat-track')].some((c) => /Midnight Drive/.test(c.textContent)), null, 15000);
  check('maya shares “Midnight Drive”: kj gets a song card', card);
  await kj.page.waitForTimeout(300);
  await shot(kj.page, '07-song-card.png');
  await R(kj.page, (r) => [...r.querySelectorAll('.gpa-chat-track')].pop().querySelector('.tr-play').click());
  const playing = await kj.page.waitForFunction(() => { const a = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-np-audio'); return a && /\/music\/file\//.test(a.src); }, null, { timeout: 8000 }).then(() => true, () => false);
  check('kj taps ▶ Play: it plays in his console', playing);

  // 6: streak on Welcome.
  await tab(kj.page, 'welcome');
  const streak = await waitFor(kj.page, (r) => !r.querySelector('#gpa-welcome-streak-box').hidden && /🔥 \d+/.test(r.querySelector('#gpa-welcome-streak').textContent), null, 15000);
  check('Welcome → Your activity shows the weekday streak box', streak, await R(kj.page, (r) => r.querySelector('#gpa-welcome-streak').textContent));

  // Admin → Moderation → Fun features.
  await R(own.page, (r) => r.querySelector('.gps-tab[data-asec="moderation"]').click());
  check('Admin → Moderation has Fun features (trivia, record posts)', await waitFor(own.page, (r) => !!r.querySelector('#gac-fun-card [data-fun="trivia"]') && !!r.querySelector('#gac-fun-card [data-fun="shoutouts"]'), null, 15000));
  await own.page.locator(sr('#gac-fun-card')).screenshot({ path: path.join(OUT, '08-admin-fun.png') });
  // …and the Playlists limit (owner): 10 new songs per person a day by default.
  const limitCard = await waitFor(own.page, (r) => !!r.querySelector('#gac-lists-card #gac-lists-songs'), null, 10000);
  check('Admin → Moderation has “Playlists limit”, 10 new songs per person a day by default', limitCard && (await R(own.page, (r) => r.querySelector('#gac-lists-songs').value)) === '10', String(limitCard));
  await own.page.fill(sr('#gac-lists-songs'), '15');
  await own.page.click(sr('#gac-lists-save'));
  await own.page.waitForTimeout(1200);
  const rep = await admin('/admin/reports');
  check('…Save changes it to 15 for everyone', rep.listsDailySongs === 15, String(rep.listsDailySongs));
  await own.page.locator(sr('#gac-lists-card')).screenshot({ path: path.join(OUT, '09-admin-playlists-limit.png') });
  await admin('/admin/config', { listsDailySongs: 10 });

  for (const [n, p] of [['maya', maya], ['kj', kj], ['owner', own]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [maya, kj, own]) await p.ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
