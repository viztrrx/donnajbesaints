// Music → Playlists (playlist → YouTube links) in the real console against
// worker.js in workerd. Spotify, Apple Music and the YouTube Data API are
// local stand-ins that answer in the shape of the real ones (the Worker's
// SPOTIFY_WEB / APPLE_MUSIC_WEB / YOUTUBE_API point at them); the real
// services can't be reached from the test machine. Steps, with screenshots:
//   1  kj (regular user) doesn't see Playlists
//   2  ana (admin, iPhone app) pastes a Spotify playlist link: 3 songs, each
//      with a YouTube search link, and a prompt to add a YouTube key
//   3  she adds a key: the official videos are found (one song has no clear
//      video and keeps its search link); Copy all links gives a tidy list
//   4  an Apple Music playlist: a second list under "Your playlists"
//   5  on her computer (console injected into a website): both playlists
//      and their links are there; ▶ plays a video in the console
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
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js`, SPOTIFY_WEB: S + '/spotify', APPLE_MUSIC_WEB: S + '/apple', YOUTUBE_API: S + '/youtube' } });
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

async function phone() {
  const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  await ctx.addInitScript((u) => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = track(await ctx.newPage());
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

  // 1: a regular user doesn't see Playlists.
  const kj = await phone();
  let s = await signIn(kj.page, KJ, 'create');
  await tab(kj.page, 'music');
  await kj.page.waitForTimeout(600);
  check('kj (regular user) signs in; Music has no Playlists button', s.inside && await R(kj.page, (r) => r.querySelector('.gpx-src[data-src="lists"]').hidden), JSON.stringify(s));

  // ana: account, then admin, then signs in again.
  const ana = await phone();
  s = await signIn(ana.page, ANA, 'create');
  await admin('/admin/user/action', { u: ANA, action: 'setrole', role: 'admin' });
  await ana.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none', null, { timeout: 25000 }).catch(() => {});
  s = await signIn(ana.page, ANA, 'signin');
  check('ana is an admin and signed in on her phone', s.inside, JSON.stringify(s));

  // 2: paste a Spotify link (no YouTube key yet).
  await tab(ana.page, 'music');
  await ana.page.waitForTimeout(500);
  const seesIt = await waitFor(ana.page, (r) => !r.querySelector('.gpx-src[data-src="lists"]').hidden, null, 8000);
  check('ana sees Music → Playlists', seesIt);
  await R(ana.page, (r) => r.querySelector('.gpx-src[data-src="lists"]').click());
  await ana.page.waitForTimeout(600);
  await ana.page.fill(sr('#gpa-lists-url'), 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc');
  await ana.page.click(sr('#gpa-lists-go'));
  const got = await waitFor(ana.page, (r) => r.querySelectorAll('#gpa-lists-view .gpa-yl-row').length === 3 && !r.querySelector('#gpa-lists-key').hidden, null, 15000);
  let list = await rows(ana.page);
  check('Spotify link → 3 songs, each with a YouTube search link; asks for a YouTube key', got && list.every((x) => /Search YouTube/.test(x.link) && /youtube\.com\/results\?search_query=/.test(x.href)), JSON.stringify(list.map((x) => x.t + ': ' + x.link)));
  await shot(ana.page, '01-phone-spotify-no-key.png');

  // 3: add a YouTube key → official videos.
  ana.page.once('dialog', (d) => d.accept('yt-key-test'));
  await ana.page.click(sr('#gpa-lists-addkey'));
  const found = await waitFor(ana.page, (r) => [...r.querySelectorAll('#gpa-lists-view .gpa-yl-link')].filter((a) => /^YouTube/.test(a.textContent)).length === 2 && /Found 2 of 3/.test(r.querySelector('#gpa-lists-status').textContent), null, 20000);
  list = await rows(ana.page);
  check('With a key: the official videos are found (not the sped-up edit)', found && list[0].href === 'https://youtu.be/4NRXx6U8ABQ' && list[1].href === 'https://youtu.be/TUVcZfQe-Kw', JSON.stringify(list.map((x) => x.t + ': ' + x.href)));
  check('…a song with no clear official video keeps its search link', /Search YouTube/.test(list[2].link) && /search_query=Unknown%20Band/.test(list[2].href));
  await shot(ana.page, '02-phone-links-found.png');

  // 4: an Apple Music playlist.
  await ana.page.fill(sr('#gpa-lists-url'), 'https://music.apple.com/us/playlist/chill-mix/pl.u-abcdefgh123');
  await ana.page.click(sr('#gpa-lists-go'));
  const apple = await waitFor(ana.page, (r) => /Chill Mix/.test(r.querySelector('#gpa-lists-view .gpa-yl-name') ? r.querySelector('#gpa-lists-view .gpa-yl-name').textContent : '') && /Found 2 of 2/.test(r.querySelector('#gpa-lists-status').textContent), null, 20000);
  check('Apple Music link → “Chill Mix”, both songs found', apple, JSON.stringify(await rows(ana.page)));
  const saved = await waitFor(ana.page, (r) => r.querySelectorAll('#gpa-lists-saved .gpa-yl-saved li').length === 2, null, 10000);
  check('“Your playlists” lists both, organized by playlist', saved, await R(ana.page, (r) => r.querySelector('#gpa-lists-saved').textContent.replace(/\s+/g, ' ')));
  await R(ana.page, (r) => r.querySelector('#gpa-lists-saved').scrollIntoView({ block: 'center' }));
  await shot(ana.page, '03-phone-apple-and-saved.png');

  // 5: her computer.
  const pc = await computer();
  s = await signIn(pc.page, ANA, 'signin');
  check('ana signs in on her computer too (admins can use both)', s.inside, JSON.stringify(s));
  await tab(pc.page, 'music');
  await pc.page.waitForTimeout(500);
  await R(pc.page, (r) => r.querySelector('.gpx-src[data-src="lists"]').click());
  const both = await waitFor(pc.page, (r) => r.querySelectorAll('#gpa-lists-saved .gpa-yl-saved li').length === 2, null, 15000);
  check('On the computer: both playlists are there', both);
  await R(pc.page, (r) => [...r.querySelectorAll('#gpa-lists-saved .gpa-yl-open')].find((b) => /Late Night Drive/.test(b.textContent)).click());
  const opened = await waitFor(pc.page, (r) => [...r.querySelectorAll('#gpa-lists-view .gpa-yl-link')].some((a) => a.href === 'https://youtu.be/4NRXx6U8ABQ'), null, 10000);
  check('…with the same YouTube links', opened, JSON.stringify(await rows(pc.page)));
  check('No extra YouTube searches for a saved list', ytSearches === 5, String(ytSearches));
  await R(pc.page, (r) => [...r.querySelectorAll('#gpa-lists-view .gpa-yl-actions button')].find((b) => b.textContent === 'Copy all links').click());
  await pc.page.waitForTimeout(400);
  const copied = await pc.page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'ERR ' + e.message);
  check('Copy all links: the playlist name, then numbered songs with their links', /^Late Night Drive \(Spotify playlist, ana\)\n1\. Blinding Lights — The Weeknd: https:\/\/youtu\.be\/4NRXx6U8ABQ\n2\. Levitating \(feat\. DaBaby\) — Dua Lipa, DaBaby: https:\/\/youtu\.be\/TUVcZfQe-Kw\n3\. A Song Nobody Uploaded — Unknown Band: https:\/\/www\.youtube\.com\/results\?search_query=Unknown%20Band%20A%20Song%20Nobody%20Uploaded \(search\)$/.test(copied), JSON.stringify(copied));
  await R(pc.page, (r) => r.querySelector('#gpa-lists-view .gpa-yl-play').click());
  const embed = await waitFor(pc.page, (r) => { const f = r.querySelector('#gpa-lists-player iframe'); return !!f && /youtube\.com\/embed\/4NRXx6U8ABQ/.test(f.src); }, null, 5000);
  check('▶ plays the video in the console (YouTube’s own player)', embed);
  await R(pc.page, (r) => r.querySelector('#gpa-lists-view').scrollIntoView({ block: 'start' }));
  await pc.page.waitForTimeout(300);
  await shot(pc.page, '04-computer-saved-links.png');

  for (const [n, p] of [['kj', kj], ['ana phone', ana], ['ana computer', pc]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [kj, ana, pc]) await p.ctx.close();
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
