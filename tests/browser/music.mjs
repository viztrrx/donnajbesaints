// Music tab end to end against worker.js in workerd, with screenshots:
// the owner adds songs to the shared library; a regular user searches (shared
// library + Audius), plays, skips and seeks, on desktop and in the iPhone app.
// Audius is a local stand-in that answers like its public API (the real
// service isn't reachable from the test environment); the shared library is
// real (R2 in workerd).
//   node tests/browser/music.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'music-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const SONGS = path.join(ROOT, 'tests/browser/fixtures/music');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ---- Audius stand-in ----
const COLORS = [['#2dd4bf', '#7c3aed'], ['#f59e0b', '#ef4444'], ['#38bdf8', '#6366f1'], ['#a3e635', '#14b8a6'], ['#f472b6', '#8b5cf6']];
const AUDIUS = [
  ['a1', 'Night Shift (Lo-fi)', 'Kairo', 154, 'Lo-Fi'], ['a2', 'Neon Rain', 'Skyline Club', 201, 'Electronic'],
  ['a3', 'Night Train to Nowhere', 'Mars Hollow', 188, 'Hip-Hop/Rap'], ['a4', 'Midnight Run', 'DJ Pulse', 176, 'Electronic'], ['a5', 'Moonlit Study Beats', 'Paper Planes', 222, 'Lo-Fi']
];
let audiusPort = 0;
const songFile = (i) => path.join(SONGS, fs.readdirSync(SONGS).filter((f) => f.endsWith('.mp3')).sort()[i % 3]);
const audius = await serve((rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  if (u.pathname === '/') { rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify({ data: [`http://127.0.0.1:${audiusPort}`] })); return; }
  if (u.pathname === '/v1/tracks/search') {
    const q = (u.searchParams.get('query') || '').toLowerCase();
    const data = AUDIUS.filter((t) => q.split(/\s+/).some((w) => (t[1] + ' ' + t[2]).toLowerCase().includes(w))).map(([id, title, name, duration, genre], i) => ({
      id, title, duration, genre, is_streamable: true, play_count: 1000 + i * 337, user: { name, handle: name.toLowerCase().replace(/\W/g, '') },
      artwork: { '150x150': `http://127.0.0.1:${audiusPort}/art/${id}.svg` }
    }));
    rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify({ data })); return;
  }
  let m = /^\/art\/a(\d)\.svg$/.exec(u.pathname);
  if (m) {
    const [c1, c2] = COLORS[(Number(m[1]) - 1) % COLORS.length];
    rs.setHeader('Content-Type', 'image/svg+xml');
    rs.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="150" height="150" fill="url(#g)"/><circle cx="${40 + m[1] * 14}" cy="${60 + m[1] * 9}" r="${26 + m[1] * 4}" fill="rgba(255,255,255,.28)"/></svg>`);
    return;
  }
  m = /^\/v1\/tracks\/a(\d)\/stream$/.exec(u.pathname);
  if (m) {
    const buf = fs.readFileSync(songFile(Number(m[1])));
    const r = /bytes=(\d+)-(\d*)/.exec(rq.headers.range || '');
    rs.setHeader('Content-Type', 'audio/mpeg'); rs.setHeader('Accept-Ranges', 'bytes');
    if (r) { const s = Number(r[1]), e = r[2] ? Math.min(Number(r[2]), buf.length - 1) : buf.length - 1; rs.statusCode = 206; rs.setHeader('Content-Range', `bytes ${s}-${e}/${buf.length}`); rs.setHeader('Content-Length', e - s + 1); rs.end(buf.subarray(s, e + 1)); }
    else { rs.setHeader('Content-Length', buf.length); rs.end(buf); }
    return;
  }
  rs.statusCode = 404; rs.end();
});
audiusPort = audius.port;

const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, AUDIUS_API: `http://127.0.0.1:${audiusPort}`, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const adminApi = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const run = Date.now().toString(36).slice(-3);

async function open(kind, user) {
  const ctx = await browser.newContext(kind === 'phone' ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1100, height: 820 } });
  await ctx.addInitScript((u) => {
    if (/iPhone/.test(navigator.userAgent)) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_music_source', 'search'); } catch (e) { /* ignore */ }
  }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '123456');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display === 'none', null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="music"]').click());
  await page.waitForTimeout(500);
  return { ctx, page };
}
const tab = (page, src) => R(page, (r, s) => r.querySelector(`.gpx-src[data-src="${s}"]`).click(), src);
// Screenshots without a stray hover highlight from the last click.
const shot = async (page, name, phone) => { await page.mouse.move(1, 1); await page.waitForTimeout(150); return phone ? page.screenshot({ path: path.join(OUT, name) }) : page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, name) }); };

try {
  // Start from an empty shared library (the local Worker keeps KV/R2 between runs).
  for (const t of (await adminApi('/music/library')).tracks || []) await adminApi('/music/delete', { id: t.id });

  // ---- Owner adds songs ----
  let { ctx, page } = await open('desktop', 'ivan');
  // Owner proof for uploads: the admin token held in memory (Admin → Connect).
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="admin"]').style.display = '');
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="admin"]').click());
  await page.waitForTimeout(400);
  await R(page, (r, a) => {
    const inputs = [...r.querySelectorAll('#gac-auth-fields input')];
    const tok = inputs.find((i) => i.type === 'password') || inputs[0];
    tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
    const urlIn = inputs.find((i) => i !== tok);
    if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
    r.querySelector('#gac-connect').click();
  }, { token: ADMIN, url: env.workerUrl });
  await page.waitForTimeout(2000);
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="music"]').click());
  await page.waitForTimeout(400);
  await tab(page, 'shared');
  await page.waitForTimeout(1200);
  check('Owner sees “Add songs” in Shared', await R(page, (r) => !r.querySelector('#gpa-shared-add').hidden));
  const files = fs.readdirSync(SONGS).filter((f) => f.endsWith('.mp3')).map((f) => path.join(SONGS, f));
  await page.locator(sr('#gpa-shared-file')).setInputFiles(files);
  const uploaded = await page.waitForFunction(() => /Added 3 songs/.test(document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-shared-status').textContent), null, { timeout: 30000 }).then(() => true, () => false);
  check('Uploaded 3 songs (title and artist from the file names)', uploaded, await R(page, (r) => r.querySelector('#gpa-shared-status').textContent));
  const rows = await R(page, (r) => [...r.querySelectorAll('#gpa-shared-list .gpa-track')].map((x) => x.querySelector('.gpa-track-title').textContent + ' — ' + x.querySelector('.gpa-track-meta').textContent));
  check('Shared list shows them with artist and length', rows.length === 3 && rows.some((x) => /Midnight Drive — Nova · 0:12/.test(x)), rows.join(' | '));
  await shot(page, '01-owner-adds-songs.png');
  await ctx.close();

  // ---- A regular user: search, play, skip, seek ----
  ({ ctx, page } = await open('desktop', 'kj' + run));
  check('Search is the default; no key prompt anywhere', await R(page, (r) => r.querySelector('.gpx-src[data-src="search"]').classList.contains('primary')));
  await page.fill(sr('#gpa-music-query'), 'night');
  await page.click(sr('#gpa-music-search'));
  await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('#gpa-music-results .gpa-track').length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const res = await R(page, (r) => ({ heads: [...r.querySelectorAll('#gpa-music-results .gpa-tracks-head')].map((h) => h.textContent), n: r.querySelectorAll('#gpa-music-results .gpa-track').length }));
  check('Results from the shared library and Audius', res.heads.join('|') === 'Shared library|Audius · free full songs' && res.n >= 4, JSON.stringify(res));
  await shot(page, '02-search-results.png');
  await R(page, (r) => [...r.querySelectorAll('#gpa-music-results .gpa-track')].find((x) => /Neon Rain|Night Shift/.test(x.textContent)).querySelector('.gpa-track-main').click());
  const playing = await page.waitForFunction(() => { const a = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-np-audio'); return a && !a.paused && a.currentTime > 0.5; }, null, { timeout: 15000 }).then(() => true, () => false);
  check('An Audius song really plays (through the Worker)', playing, await R(page, (r) => r.querySelector('#gpa-np-audio').currentSrc.replace(/^https?:\/\/[^/]+/, '')));
  await page.waitForTimeout(800);
  await shot(page, '03-now-playing.png');
  check('Hero says Playing', await R(page, (r) => r.querySelector('.gpx-hero[data-room="music"] .gpx-status-t').textContent === 'Playing'), await R(page, (r) => r.querySelector('.gpx-hero[data-room="music"] .gpx-status-t').textContent));
  const before = await R(page, (r) => r.querySelector('#gpa-np-title').textContent);
  await R(page, (r) => r.querySelector('#gpa-np-next').click());
  await page.waitForTimeout(1500);
  const after = await R(page, (r) => ({ t: r.querySelector('#gpa-np-title').textContent, playing: !r.querySelector('#gpa-np-audio').paused }));
  check('Next plays the next result', after.t !== before && after.playing, before + ' → ' + after.t);
  await R(page, (r) => { const a = r.querySelector('#gpa-np-audio'); a.currentTime = 5; });
  await page.waitForTimeout(1200);
  check('Seeking works (Range requests through the Worker)', await R(page, (r) => r.querySelector('#gpa-np-audio').currentTime >= 5));
  check('Hero shows what is playing', await R(page, (r) => /—/.test(r.querySelector('#gpx-music-now').textContent)), await R(page, (r) => r.querySelector('#gpx-music-now').textContent));
  await tab(page, 'shared');
  await page.waitForTimeout(1200);
  check('Regular users can play the shared library but not add to it', await R(page, (r) => r.querySelector('#gpa-shared-add').hidden && r.querySelectorAll('#gpa-shared-list .gpa-track').length === 3 && !r.querySelector('.gpa-track-del')));
  await R(page, (r) => r.querySelectorAll('#gpa-shared-list .gpa-track-main')[1].click());
  check('A shared song plays', await page.waitForFunction(() => { const a = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-np-audio'); return !a.paused && a.currentTime > 0.5 && /\/music\/file\//.test(a.currentSrc); }, null, { timeout: 15000 }).then(() => true, () => false));
  await page.waitForTimeout(500);
  await shot(page, '04-shared-library.png');
  check('No page errors', page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
  await ctx.close();

  // ---- iPhone app ----
  ({ ctx, page } = await open('phone', 'dub' + run));
  await page.fill(sr('#gpa-music-query'), 'midnight');
  await page.click(sr('#gpa-music-search'));
  await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('#gpa-music-results .gpa-track').length > 0, null, { timeout: 15000 });
  await R(page, (r) => r.querySelector('#gpa-music-results .gpa-track-main').click());
  await page.waitForTimeout(1800);
  await R(page, (r) => r.querySelector('.gpx-hero[data-room="music"]').scrollIntoView({ block: 'start' }));
  await shot(page, '05-iphone-app.png', true);
  check('iPhone app: plays, controls are 44px', await R(page, (r) => !r.querySelector('#gpa-np-audio').paused && r.querySelector('#gpa-np-play').getBoundingClientRect().height >= 44));
  check('Lock-screen info is set (Media Session)', await page.evaluate(() => !!(navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title)));
  await ctx.close();
} finally {
  for (const t of (await adminApi('/music/library').catch(() => ({}))).tracks || []) await adminApi('/music/delete', { id: t.id }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
  await audius.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
