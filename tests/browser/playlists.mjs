// Music → Playlists (playlist → YouTube links) in the real console against
// worker.js in workerd. Spotify, Apple Music and the YouTube Data API are
// local stand-ins that answer in the shape of the real ones (the Worker's
// SPOTIFY_WEB / APPLE_MUSIC_WEB / YOUTUBE_API point at them); the real
// services can't be reached from the test machine. The YouTube key is the
// Worker's YOUTUBE_API_KEY secret only. Steps, with screenshots:
//   1  kj (regular user) has Playlists too (everyone signed in, owner's
//      call) and gets an Apple Music playlist's links
//   2  ana (admin, iPhone app) pastes a Spotify playlist link: the official
//      videos are found with the Worker's key (one song has no clear video
//      and keeps its search link); the key never reaches the browser
//   3  the same Apple Music playlist kj did: a second list under "Your
//      playlists", from the shared cache (no new YouTube searches)
//   4  the web app on her computer: both playlists and their links, with no
//      new YouTube searches; Copy all links; ▶ plays a video in the console
//   5  the console injected into a website: Playlists works there too
//   node tests/browser/playlists.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'playlists-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ---- Stand-ins for Spotify, Apple Music and YouTube ----
const SPOTIFY_EMBED = `<!doctype html><html><head><meta property="og:title" content="Late Night Drive"></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: {
  type: 'playlist', name: 'Late Night Drive', subtitle: 'ana', trackList: [
    { uri: 'spotify:track:1', title: 'Blinding Lights', subtitle: 'The Weeknd', duration: 200040 },
    { uri: 'spotify:track:2', title: 'Levitating (feat. DaBaby)', subtitle: 'Dua Lipa, DaBaby', duration: 203064 },
    { uri: 'spotify:track:3', title: 'A Song Nobody Uploaded', subtitle: 'Unknown Band', duration: 180000 }
  ] } } } } } })}</script></body></html>`;
const APPLE_PAGE = `<!doctype html><html><head><meta property="og:title" content="Chill Mix on Apple Music">
<script type="application/json" id="serialized-server-data">${JSON.stringify([{ data: { sections: [{ itemKind: 'trackLockup', items: [
  { title: 'Sunflower', artistName: 'Post Malone & Swae Lee', duration: 158040 }, { title: 'Ivy', artistName: 'Frank Ocean', duration: 249000 }] }] } }])}</script>
<script type="application/ld+json">${JSON.stringify({ '@type': 'MusicPlaylist', name: 'Chill Mix' })}</script></head><body></body></html>`;
const VIDEOS = {
  'The Weeknd - Blinding Lights': [['aaaaaaaaaa1', 'The Weeknd - Blinding Lights (Sped Up)', 'Speedy Edits'], ['4NRXx6U8ABQ', 'The Weeknd - Blinding Lights (Official Audio)', 'TheWeekndVEVO']],
  'Dua Lipa - Levitating (feat. DaBaby)': [['TUVcZfQe-Kw', 'Levitating (feat. DaBaby)', 'Dua Lipa - Topic']],
  'Unknown Band - A Song Nobody Uploaded': [['cccccccccc3', 'Totally different thing', 'Random']],
  'Post Malone - Sunflower': [['ApXoWvfEYVU', 'Post Malone, Swae Lee - Sunflower (Spider-Man: Into the Spider-Verse)', 'PostMaloneVEVO']],
  'Frank Ocean - Ivy': [['AE005nZeF-A', 'Frank Ocean - Ivy', 'Frank Ocean - Topic']]
};
let ytSearches = 0;
const stub = await serve((rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  if (u.pathname === '/spotify/embed/playlist/37i9dQZF1DXcBWIGoYBM5M') { rs.setHeader('Content-Type', 'text/html'); rs.end(SPOTIFY_EMBED); return; }
  if (u.pathname === '/apple/us/playlist/chill-mix/pl.u-abcdefgh123') { rs.setHeader('Content-Type', 'text/html'); rs.end(APPLE_PAGE); return; }
  if (u.pathname === '/youtube/search') {
    rs.setHeader('Content-Type', 'application/json');
    if (u.searchParams.get('key') !== 'yt-key-test') { rs.statusCode = 400; rs.end(JSON.stringify({ error: { errors: [{ reason: 'keyInvalid' }] } })); return; }
    ytSearches++;
    rs.end(JSON.stringify({ items: (VIDEOS[u.searchParams.get('q')] || []).map(([id, title, ch]) => ({ id: { videoId: id }, snippet: { title, channelTitle: ch } })) }));
    return;
  }
  rs.statusCode = 404; rs.end('not found');
});
const S = `http://127.0.0.1:${stub.port}`;

const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const YT_KEY = 'yt-key-test';
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js`, SPOTIFY_WEB: S + '/spotify', APPLE_MUSIC_WEB: S + '/apple', YOUTUBE_API: S + '/youtube', YOUTUBE_API_KEY: YT_KEY } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'A school website')); });
const admin = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const ANA = 'ana' + run, KJ = 'kj' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const waitFor = (page, fnSrc, arg, ms = 15000) => page.waitForFunction(([src, a]) => (0, eval)(src)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fnSrc), arg], { timeout: ms, polling: 100 }).then(() => true, () => false);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const track = (page) => { page._errors = []; page.on('pageerror', (e) => page._errors.push(String(e))); return page; };

// Everything the browser receives from the Worker, to prove the key never gets there.
const received = [];
const watch = (page) => page.on('response', async (r) => { if (r.url().startsWith(env.workerUrl + '/music/')) { try { received.push(await r.text()); } catch (e) { /* streamed audio */ } } });
async function phone(kind) {
  const ctx = await browser.newContext(kind === 'laptop' ? { viewport: { width: 1200, height: 900 } } : { ...(devices['iPhone 15'] || devices['iPhone 14']) });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.workerUrl });
  await ctx.addInitScript((u) => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = track(await ctx.newPage());
  watch(page);
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  return { ctx, page };
}
async function computer() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${site.port}` });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = track(await ctx.newPage());
  await page.goto(`http://127.0.0.1:${site.port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx, page };
}
async function signIn(page, user, button) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr(button === 'create' ? '#gpa-signup-btn' : '#gpa-login-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
}
const tab = (page, t) => R(page, (r, x) => r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`).click(), t);
const rows = (page) => R(page, (r) => [...r.querySelectorAll('#gpa-lists-view .gpa-yl-row')].map((li) => ({ t: li.querySelector('.gpa-yl-t').textContent, link: li.querySelector('.gpa-yl-link').textContent, href: li.querySelector('.gpa-yl-link').href })));

try {
  await admin('/admin/config', { allowlist: { on: true, users: [ANA, KJ] } });

  // 1: a regular user has Playlists too.
  const kj = await phone();
  let s = await signIn(kj.page, KJ, 'create');
  await tab(kj.page, 'music');
  await kj.page.waitForTimeout(600);
  check('kj (regular user) signs in; Music has the Playlists button', s.inside && await R(kj.page, (r) => !r.querySelector('.gpx-src[data-src="lists"]').hidden), JSON.stringify(s));
  await R(kj.page, (r) => r.querySelector('.gpx-src[data-src="lists"]').click());
  await kj.page.waitForTimeout(600);
  check('…the card says new songs are limited per person a day', /new songs are limited per person a day/.test(await R(kj.page, (r) => r.querySelector('[data-src-panel="lists"] .gpa-sub').textContent)));
  const quota = (p) => R(p, (r) => { const q = r.querySelector('#gpa-lists-quota'); return q && !q.hidden ? q.textContent : ''; });
  check('…and shows “New songs left today: 10 of 10.”', (await quota(kj.page)) === 'New songs left today: 10 of 10.', await quota(kj.page));
  await kj.page.fill(sr('#gpa-lists-url'), 'https://music.apple.com/us/playlist/chill-mix/pl.u-abcdefgh123');
  await kj.page.click(sr('#gpa-lists-go'));
  const kjApple = await waitFor(kj.page, (r) => /Chill Mix/.test(r.querySelector('#gpa-lists-view .gpa-yl-name') ? r.querySelector('#gpa-lists-view .gpa-yl-name').textContent : '') && /Found 2 of 2/.test(r.querySelector('#gpa-lists-status').textContent), null, 20000);
  check('kj pastes an Apple Music link → “Chill Mix”, both songs found (2 YouTube searches)', kjApple && ytSearches === 2, JSON.stringify(await rows(kj.page)) + ' searches ' + ytSearches);
  check('…the count goes down by the 2 new songs: “8 of 10”', (await quota(kj.page)) === 'New songs left today: 8 of 10.', await quota(kj.page));
  await shot(kj.page, '00-regular-user-playlists.png');

  // ana: account, then admin, then signs in again.
  const ana = await phone();
  s = await signIn(ana.page, ANA, 'create');
  await admin('/admin/user/action', { u: ANA, action: 'setrole', role: 'admin' });
  await ana.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none', null, { timeout: 25000 }).catch(() => {});
  s = await signIn(ana.page, ANA, 'signin');
  check('ana is an admin and signed in on her phone', s.inside, JSON.stringify(s));

  // 2: paste a Spotify link; the Worker's key finds the videos.
  await tab(ana.page, 'music');
  await ana.page.waitForTimeout(500);
  const seesIt = await waitFor(ana.page, (r) => !r.querySelector('.gpx-src[data-src="lists"]').hidden, null, 8000);
  check('ana sees Music → Playlists in the app', seesIt);
  await R(ana.page, (r) => r.querySelector('.gpx-src[data-src="lists"]').click());
  await ana.page.waitForTimeout(600);
  await ana.page.fill(sr('#gpa-lists-url'), 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc');
  await ana.page.click(sr('#gpa-lists-go'));
  const found = await waitFor(ana.page, (r) => r.querySelectorAll('#gpa-lists-view .gpa-yl-row').length === 3 && /Found 2 of 3/.test(r.querySelector('#gpa-lists-status').textContent), null, 20000);
  let list = await rows(ana.page);
  check('Spotify link → the official videos, found with the Worker’s key (no key asked for)', found && list[0].href === 'https://youtu.be/4NRXx6U8ABQ' && list[1].href === 'https://youtu.be/TUVcZfQe-Kw' && await R(ana.page, (r) => r.querySelector('#gpa-lists-key').hidden), JSON.stringify(list.map((x) => x.t + ': ' + x.href)));
  check('…a song with no clear official video keeps its search link', /Search YouTube/.test(list[2].link) && /search_query=Unknown%20Band/.test(list[2].href));
  check('…3 YouTube searches, one per song', ytSearches === 5, String(ytSearches - 2));
  check('Admins have the same daily limit: “New songs left today: 7 of 10.”', (await quota(ana.page)) === 'New songs left today: 7 of 10.', await quota(ana.page));
  await shot(ana.page, '01-app-links-found.png');

  // 3: an Apple Music playlist.
  await ana.page.fill(sr('#gpa-lists-url'), 'https://music.apple.com/us/playlist/chill-mix/pl.u-abcdefgh123');
  await ana.page.click(sr('#gpa-lists-go'));
  const apple = await waitFor(ana.page, (r) => /Chill Mix/.test(r.querySelector('#gpa-lists-view .gpa-yl-name') ? r.querySelector('#gpa-lists-view .gpa-yl-name').textContent : '') && /Found 2 of 2/.test(r.querySelector('#gpa-lists-status').textContent), null, 20000);
  check('Apple Music link → “Chill Mix”, both songs found, from the cache (kj looked them up): no new searches', apple && ytSearches === 5, JSON.stringify(await rows(ana.page)) + ' searches ' + ytSearches);
  check('…songs already looked up don’t count: still 7 of 10', (await quota(ana.page)) === 'New songs left today: 7 of 10.', await quota(ana.page));
  const saved = await waitFor(ana.page, (r) => r.querySelectorAll('#gpa-lists-saved .gpa-yl-saved li').length === 2, null, 10000);
  check('“Your playlists” lists both, organized by playlist', saved, await R(ana.page, (r) => r.querySelector('#gpa-lists-saved').textContent.replace(/\s+/g, ' ')));
  await R(ana.page, (r) => r.querySelector('#gpa-lists-saved').scrollIntoView({ block: 'center' }));
  await shot(ana.page, '02-app-apple-and-saved.png');

  // 4: the web app on her computer.
  const pcApp = await phone('laptop');
  s = await signIn(pcApp.page, ANA, 'signin');
  check('ana opens the web app on her computer too (admins can use both)', s.inside, JSON.stringify(s));
  await tab(pcApp.page, 'music');
  await pcApp.page.waitForTimeout(500);
  await R(pcApp.page, (r) => r.querySelector('.gpx-src[data-src="lists"]').click());
  const both = await waitFor(pcApp.page, (r) => r.querySelectorAll('#gpa-lists-saved .gpa-yl-saved li').length === 2, null, 15000);
  check('Both playlists are there', both);
  await R(pcApp.page, (r) => [...r.querySelectorAll('#gpa-lists-saved .gpa-yl-open')].find((b) => /Late Night Drive/.test(b.textContent)).click());
  const opened = await waitFor(pcApp.page, (r) => [...r.querySelectorAll('#gpa-lists-view .gpa-yl-link')].some((a) => a.href === 'https://youtu.be/4NRXx6U8ABQ'), null, 10000);
  check('…with the same YouTube links', opened, JSON.stringify(await rows(pcApp.page)));
  check('The key was only used when it had to be: 5 searches for 5 songs, none for saved lists', ytSearches === 5, String(ytSearches));
  await R(pcApp.page, (r) => [...r.querySelectorAll('#gpa-lists-view .gpa-yl-actions button')].find((b) => b.textContent === 'Copy all links').click());
  await pcApp.page.waitForTimeout(400);
  const copied = await pcApp.page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'ERR ' + e.message);
  check('Copy all links: the playlist name, then numbered songs with their links', /^Late Night Drive \(Spotify playlist, ana\)\n1\. Blinding Lights — The Weeknd: https:\/\/youtu\.be\/4NRXx6U8ABQ\n2\. Levitating \(feat\. DaBaby\) — Dua Lipa, DaBaby: https:\/\/youtu\.be\/TUVcZfQe-Kw\n3\. A Song Nobody Uploaded — Unknown Band: https:\/\/www\.youtube\.com\/results\?search_query=Unknown%20Band%20A%20Song%20Nobody%20Uploaded \(search\)$/.test(copied), JSON.stringify(copied));
  await R(pcApp.page, (r) => r.querySelector('#gpa-lists-view .gpa-yl-play').click());
  const embed = await waitFor(pcApp.page, (r) => { const f = r.querySelector('#gpa-lists-player iframe'); return !!f && /youtube\.com\/embed\/4NRXx6U8ABQ/.test(f.src); }, null, 5000);
  check('▶ plays the video in the console (YouTube’s own player)', embed);
  await R(pcApp.page, (r) => r.querySelector('#gpa-lists-view').scrollIntoView({ block: 'start' }));
  await pcApp.page.waitForTimeout(300);
  await shot(pcApp.page, '03-web-app-on-computer.png');
  check('The YouTube key never reached the browser', received.length > 5 && !received.some((t) => t.includes(YT_KEY)), received.length + ' responses checked');

  // 5: the console injected into a website: Playlists works there too.
  const pc = await computer();
  s = await signIn(pc.page, ANA, 'signin');
  await tab(pc.page, 'music');
  await pc.page.waitForTimeout(800);
  check('In the console on a website, ana has the Playlists button', s.inside && await R(pc.page, (r) => !r.querySelector('.gpx-src[data-src="lists"]').hidden), JSON.stringify(s));
  // With ana's own sign-in from that website (her real session token).
  const fromSite = await pc.page.evaluate(async ([u, k, who]) => {
    const tok = (JSON.parse(localStorage.getItem(k) || '{}') || {}).token || '';
    const r = await fetch(u + '/music/lists?user=' + encodeURIComponent(who), { headers: { 'X-GPA-Session': tok } });
    return { signedIn: !!tok, status: r.status, body: await r.json() };
  }, [env.workerUrl, 'gpa_session_token', ANA]);
  check('…and the Worker answers her Playlists requests from a website: both lists', fromSite.signedIn && fromSite.status === 200 && fromSite.body.lists.length === 2, JSON.stringify(fromSite).slice(0, 200));
  await R(pc.page, (r) => r.querySelector('.gpx-src[data-src="lists"]').click());
  await waitFor(pc.page, (r) => r.querySelectorAll('#gpa-lists-saved .gpa-yl-saved li').length === 2, null, 10000);
  await shot(pc.page, '04-website-console-playlists.png');

  for (const [n, p] of [['kj', kj], ['ana phone', ana], ['ana web app on computer', pcApp], ['ana website console', pc]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [kj, ana, pcApp, pc]) await p.ctx.close();
} finally {
  await admin('/admin/config', { allowlist: { on: false } }).catch(() => {});
  await browser.close();
  await env.close();
  await site.close();
  await stub.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
