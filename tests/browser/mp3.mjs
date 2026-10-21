// YouTube to MP3 (Music → My music, owner only) in a real browser against
// worker.js in workerd. Everything that converts is real: the official
// ffmpeg.wasm core (node_modules/@ffmpeg/core, served from a local copy
// because the sandbox can't reach the CDN; the page checks it against the
// same SHA-256 fingerprints it uses with the CDN) turns media files made
// here with the system FFmpeg (synthetic tones and test pattern, so we hold
// every right to them) into MP3s, and the system ffprobe/ffmpeg verifies the
// downloaded file independently. The YouTube Data API is a local stand-in
// (link details only); a real YouTube download is NOT RUN because YouTube
// offers no authorized way to fetch media from a link.
//   1  before: the Music tab without the converter (previous script.js)
//   2  a regular user doesn't see it; the API refuses them
//   3  the owner sees it; link checks (good, playlist, other site, backend
//      failure, Paste); a tampered FFmpeg download is refused
//   4  real conversion with real progress → verified MP3 → plays → download
//      → ffprobe; ID3 title/artist
//   5  Save to My music → listed; on a second device (iPhone app) too, and
//      it plays from the account
//   6  cancel, timeout, a file without audio, a broken file, 96 kHz 5.1
//      (→ 48 kHz stereo), too big for My music
//   7  offline: FFmpeg comes from the browser cache; saving waits for the
//      network; reload doesn't double the handlers; themes; iPhone layout
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'mp3-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const OWNER_CODE = 'owner-code-test-0123456789';
const OWNER = 'ivan';
const PIN = '246810';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 400) : ''}`); };
const notRun = (name, why) => { results.push({ name, notRun: true }); console.log(`NOT RUN  ${name}  — ${why}`); };
const has = (bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;
if (!has('ffmpeg') || !has('ffprobe')) {
  notRun('All MP3 conversion checks', 'ffmpeg/ffprobe are not installed on this machine (needed to make test media and verify the output)');
  console.log('\n0/0 checks passed (1 not run)');
  process.exit(1);
}

// ---- Test media (synthetic, made here) ----
const FX = path.join(OUT, 'media');
fs.mkdirSync(FX, { recursive: true });
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'pipe' });
const media = {
  clip: path.join(FX, 'my-test-video.mp4'),       // 3 min: test pattern + stereo tones, AAC 128 kbps
  long: path.join(FX, 'long-tones.m4a'),          // 11 min 40 s of audio (AAC 96 kbps)
  hires: path.join(FX, 'surround-96k.wav'),       // 8 s, 96 kHz, 6 channels
  silent: path.join(FX, 'no-audio.mp4'),          // video only
  broken: path.join(FX, 'broken.mp4')             // not a media file
};
if (!fs.existsSync(media.clip)) ff('-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=180', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100:duration=180', '-filter_complex', '[1:a][2:a]amerge=inputs=2[a]', '-map', '0:v', '-map', '[a]', '-t', '180', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40', '-c:a', 'aac', '-b:a', '128k', media.clip);
if (!fs.existsSync(media.long)) ff('-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=700', '-ac', '2', '-c:a', 'aac', '-b:a', '96k', media.long);
if (!fs.existsSync(media.hires)) ff('-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=96000:duration=8', '-af', 'pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0', media.hires);
if (!fs.existsSync(media.silent)) ff('-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=5', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', media.silent);
if (!fs.existsSync(media.broken)) fs.writeFileSync(media.broken, crypto.randomBytes(300000));

// ---- Local servers ----
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const CORE_DIR = path.join(ROOT, 'node_modules/@ffmpeg/core/dist/umd');
const coreHits = [];
const coreHost = await serve((rq, rs) => {
  const name = path.basename(new URL(rq.url, 'http://x').pathname);
  coreHits.push(name);
  rs.setHeader('Access-Control-Allow-Origin', '*');
  if (!['ffmpeg-core.js', 'ffmpeg-core.wasm'].includes(name)) { rs.statusCode = 404; rs.end(); return; }
  rs.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
  rs.end(fs.readFileSync(path.join(CORE_DIR, name)));
});
// The same files with one byte of the wasm changed (a tampered CDN).
const badHost = await serve((rq, rs) => {
  const name = path.basename(new URL(rq.url, 'http://x').pathname);
  rs.setHeader('Access-Control-Allow-Origin', '*');
  if (!['ffmpeg-core.js', 'ffmpeg-core.wasm'].includes(name)) { rs.statusCode = 404; rs.end(); return; }
  const b = fs.readFileSync(path.join(CORE_DIR, name));
  if (name.endsWith('.wasm')) b[b.length - 100] ^= 0xff;
  rs.end(b);
});
// YouTube Data API stand-in (videos.list).
const YT_OK = 'aBcDeFgHiJ1', YT_FAIL = 'zZzZzZzZzZ9';
const ytHost = await serve((rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  rs.setHeader('Content-Type', 'application/json');
  const id = u.searchParams.get('id');
  if (u.searchParams.get('key') !== 'yt-test-key') { rs.statusCode = 400; rs.end(JSON.stringify({ error: { errors: [{ reason: 'keyInvalid' }] } })); return; }
  if (id === YT_FAIL) { rs.statusCode = 500; rs.end('{}'); return; }
  if (id !== YT_OK) { rs.end(JSON.stringify({ items: [] })); return; }
  rs.end(JSON.stringify({ items: [{ id, snippet: { title: 'My Own Song (Official Video)', channelTitle: 'My Channel - Topic', publishedAt: '2024-05-01T00:00:00Z', liveBroadcastContent: 'none', thumbnails: {} }, contentDetails: { duration: 'PT3M' }, status: { license: 'youtube', privacyStatus: 'public' } }] }));
});
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, OWNER_CODE, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js`, YOUTUBE_API_KEY: 'yt-test-key', YOUTUBE_API: `http://127.0.0.1:${ytHost.port}/youtube/v3` } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE); });
const admin = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
// The console's server verifier for a name + PIN (script.js serverVerifier).
const verifier = (user, pin) => crypto.pbkdf2Sync(`gpa-server|${user.toLowerCase()}|${pin}`, 'gpa-server-salt|' + user.toLowerCase(), 210000, 32, 'sha256').toString('hex');
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const waitFor = (page, fnSrc, arg, ms = 15000) => page.waitForFunction(([src, a]) => (0, eval)(src)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fnSrc), arg], { timeout: ms, polling: 100 }).then(() => true, () => false);
const track = (page) => { page._errors = []; page.on('pageerror', (e) => page._errors.push(String(e))); return page; };
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const run = Date.now().toString(36).slice(-4);
const KJ = 'kj' + run;
const ffprobe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).toString());

async function computer(scriptCode = code, { base = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${site.port}` });
  await ctx.addInitScript(([u, b]) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); if (b) localStorage.setItem('gpa_ffmpeg_base', b); } catch (e) { /* ignore */ } }, [env.workerUrl, base]);
  const page = track(await ctx.newPage());
  await page.goto(`http://127.0.0.1:${site.port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, scriptCode);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx, page };
}
async function phone() {
  const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  await ctx.addInitScript(([u, b]) => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); localStorage.setItem('gpa_ffmpeg_base', b); } catch (e) { /* ignore */ } }, [env.workerUrl, `http://127.0.0.1:${coreHost.port}/`]);
  const page = track(await ctx.newPage());
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  return { ctx, page };
}
async function signIn(page, user, button = 'create') {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), PIN);
  await page.click(sr(button === 'create' ? '#gpa-signup-btn' : '#gpa-login-btn'));
  await page.waitForTimeout(3000);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
}
const tab = (page, t) => R(page, (r, x) => r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`).click(), t);
async function openMine(page) {
  await tab(page, 'music');
  await page.waitForTimeout(400);
  await R(page, (r) => r.querySelector('.gpx-src[data-src="mine"]').click());
  await page.waitForTimeout(900);
}
const mp3State = (page) => R(page, (r) => ({
  shown: !r.querySelector('#gpa-mp3').hidden, open: r.querySelector('#gpa-mp3').open,
  status: r.querySelector('#gpa-mp3-status').textContent, error: r.querySelector('#gpa-mp3-status').classList.contains('is-error'),
  link: r.querySelector('#gpa-mp3-link').textContent, rights: r.querySelector('#gpa-mp3-rights').hidden ? '' : r.querySelector('#gpa-mp3-rights').textContent,
  meta: r.querySelector('#gpa-mp3-meta').hidden ? '' : r.querySelector('#gpa-mp3-meta').textContent,
  // What's really on screen (an element can carry [hidden] and still be drawn).
  go: { hidden: !r.querySelector('#gpa-mp3-go').getClientRects().length, disabled: r.querySelector('#gpa-mp3-go').disabled },
  cancel: !!r.querySelector('#gpa-mp3-cancel').getClientRects().length, done: !!r.querySelector('#gpa-mp3-done').getClientRects().length,
  progress: !!r.querySelector('#gpa-mp3-prog').getClientRects().length,
  result: r.querySelector('#gpa-mp3-result').textContent, save: { disabled: r.querySelector('#gpa-mp3-save').disabled, text: r.querySelector('#gpa-mp3-save').textContent, title: r.querySelector('#gpa-mp3-save').title },
  pct: r.querySelector('#gpa-mp3-bar').getAttribute('aria-valuenow')
}));
async function pick(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), R(page, (r) => r.querySelector('#gpa-mp3-pick').click())]);
  await chooser.setFiles(file);
  await page.waitForTimeout(200);
}
const waitDone = (page, ms = 120000) => waitFor(page, (r) => !r.querySelector('#gpa-mp3-done').hidden || r.querySelector('#gpa-mp3-status').classList.contains('is-error') || /Canceled/.test(r.querySelector('#gpa-mp3-status').textContent), null, ms);
const setQuality = (page, k) => R(page, (r, v) => { const s = r.querySelector('#gpa-mp3-q'); s.value = String(v); s.dispatchEvent(new Event('change', { bubbles: true })); }, k);

try {
  // The owner's account exists (registered with the owner code, as the real
  // owner does once); Allowed users is on with one regular user.
  await admin('/admin/config', { allowlist: { on: true, users: [KJ] } });
  const reg = await fetch(env.workerUrl + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-GPA-Owner': OWNER_CODE }, body: JSON.stringify({ user: OWNER, verifier: verifier(OWNER, PIN) }) });
  if (reg.status !== 200 && reg.status !== 409) throw new Error('owner register ' + reg.status + ' ' + await reg.text());

  // ---- 1: before: the Music tab with the previous script.js (no converter) ----
  try {
    const before = execFileSync('git', ['show', 'HEAD:script.js'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
    if (before.includes('id="gpa-mp3"')) throw new Error('HEAD already has the converter');
    const old = await computer(before);
    await signIn(old.page, OWNER, 'create');
    await openMine(old.page);
    await shot(old.page, '01-music-before.png');
    check('Before: My music without the converter (previous script.js)', await R(old.page, (r) => !r.querySelector('#gpa-mp3') && !!r.querySelector('#gpa-mine-list')));
    await old.ctx.close();
  } catch (e) { notRun('Before screenshot from the previous script.js', e.message); }

  // ---- 2: a regular user ----
  const kj = await computer();
  const ks = await signIn(kj.page, KJ, 'create');
  await openMine(kj.page);
  await kj.page.waitForTimeout(500);
  check('A regular user signs in; My music has no converter', ks.inside && await R(kj.page, (r) => r.querySelector('#gpa-mp3').hidden), JSON.stringify(ks));
  const kjTok = await kj.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gpa_session_token')).token; } catch (e) { return ''; } });
  const kjApi = await fetch(env.workerUrl + '/music/mp3/check?user=' + KJ + '&url=' + encodeURIComponent('https://youtu.be/' + YT_OK), { headers: { 'X-GPA-Session': kjTok } });
  check('…and the Worker refuses them (403, owner only), even with a valid session', kjTok && kjApi.status === 403, String(kjApi.status));
  const fake = await fetch(env.workerUrl + '/music/mp3/check?user=' + OWNER + '&url=' + encodeURIComponent('https://youtu.be/' + YT_OK));
  check('…and typing the owner’s name without proof is refused too', fake.status === 403, String(fake.status));
  await kj.ctx.close();

  // ---- 3: the owner ----
  const lap = await computer();
  const s = await signIn(lap.page, OWNER, 'create');
  check('The owner signs in on a computer', s.inside, JSON.stringify(s));
  await openMine(lap.page);
  check('The owner sees “YouTube to MP3” in My music, closed', await waitFor(lap.page, (r) => !r.querySelector('#gpa-mp3').hidden, null, 8000) && !(await mp3State(lap.page)).open);
  await R(lap.page, (r) => r.querySelector('#gpa-mp3 summary').click());
  await lap.page.waitForTimeout(400);
  let st = await mp3State(lap.page);
  check('Opening it: Convert shows but is off until a file is chosen; no Cancel, no progress, no result', st.open && !st.go.hidden && st.go.disabled && !st.cancel && !st.done && !st.progress, JSON.stringify(st));
  await R(lap.page, (r) => r.querySelector('#gpa-mp3').scrollIntoView({ block: 'start' }));
  await shot(lap.page, '02-converter.png');
  // Links.
  const typeLink = async (v) => { await lap.page.fill(sr('#gpa-mp3-url'), v); await R(lap.page, (r) => r.querySelector('#gpa-mp3-url').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))); await lap.page.waitForTimeout(900); return mp3State(lap.page); };
  st = await typeLink('https://vimeo.com/123456');
  check('Another site’s link: “That isn’t a YouTube link.”', st.link === 'That isn’t a YouTube link.' && !st.meta && !st.rights, st.link);
  st = await typeLink('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  check('A playlist link is refused with a reason', /playlist link/.test(st.link), st.link);
  st = await typeLink('https://www.youtube.com/@SomeChannel');
  check('A channel link is refused with a reason', /channel link/.test(st.link), st.link);
  st = await typeLink('https://youtu.be/' + YT_FAIL);
  check('YouTube failing (stand-in answers 500): the error is shown, no details invented', /YouTube answered 500/.test(st.link) && !st.meta, st.link);
  await lap.page.evaluate((t) => navigator.clipboard.writeText(t), 'https://www.youtube.com/watch?v=' + YT_OK + '&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-paste').click());
  await waitFor(lap.page, (r) => !r.querySelector('#gpa-mp3-meta').hidden, null, 6000);
  st = await mp3State(lap.page);
  check('Paste: the link is checked; details (stand-in) shown; playlist part noted', /My Own Song \(Official Video\)/.test(st.meta) && /3:00/.test(st.meta) && /playlist part of the link is ignored/.test(st.link), st.meta + ' | ' + st.link);
  check('…with the honest rights note (YouTube Studio, no download from the link)', /doesn’t let apps download/.test(st.rights) && /YouTube Studio/.test(st.rights), st.rights);
  check('…and the title/artist are filled from it (“ - Topic” dropped)', await R(lap.page, (r) => r.querySelector('#gpa-mp3-title').value === 'My Own Song (Official Video)' && r.querySelector('#gpa-mp3-artist').value === 'My Channel'));
  check('Still no Convert without a file: a link alone never fetches media', (await mp3State(lap.page)).go.disabled);
  await R(lap.page, (r) => r.querySelector('#gpa-mp3').scrollIntoView({ block: 'start' }));
  await shot(lap.page, '03-link-details.png');

  // A tampered FFmpeg download is refused.
  await lap.page.evaluate((b) => localStorage.setItem('gpa_ffmpeg_base', b), `http://127.0.0.1:${badHost.port}/`);
  await pick(lap.page, media.clip);
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-go').click());
  await waitDone(lap.page, 120000);
  st = await mp3State(lap.page);
  check('A tampered FFmpeg (one byte changed) is refused, never run', st.error && /didn’t match its fingerprint/.test(st.status) && !st.done, st.status);

  // ---- 4: a real conversion ----
  await lap.page.evaluate((b) => localStorage.setItem('gpa_ffmpeg_base', b), `http://127.0.0.1:${coreHost.port}/`);
  await lap.page.fill(sr('#gpa-mp3-title'), 'Test Tones');
  await lap.page.fill(sr('#gpa-mp3-artist'), 'The Owner');
  await setQuality(lap.page, 192);
  await R(lap.page, (r) => {
    window.__mp3pct = [];
    new MutationObserver(() => { const v = r.querySelector('#gpa-mp3-bar').getAttribute('aria-valuenow'); if (v !== null) window.__mp3pct.push({ v: Number(v), s: r.querySelector('#gpa-mp3-status').textContent }); }).observe(r.querySelector('#gpa-mp3-bar'), { attributes: true });
  });
  let shotMid = false;
  lap.page.on('console', () => {});
  const t0 = Date.now();
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-go').click());
  // A screenshot while it works (downloading FFmpeg or converting).
  if (await waitFor(lap.page, (r) => !r.querySelector('#gpa-mp3-prog').hidden && !r.querySelector('#gpa-mp3-cancel').hidden, null, 5000)) { await shot(lap.page, '04-progress.png'); shotMid = true; }
  const busy = await mp3State(lap.page);
  check('While it works: Cancel and progress show, Convert hides, the file and quality are locked', busy.cancel && busy.progress && busy.go.hidden && await R(lap.page, (r) => r.querySelector('#gpa-mp3-pick').disabled && r.querySelector('#gpa-mp3-q').disabled), JSON.stringify(busy));
  const finished = await waitDone(lap.page, 240000);
  st = await mp3State(lap.page);
  const pcts = await lap.page.evaluate(() => window.__mp3pct);
  const dl = pcts.filter((x) => /Downloading FFmpeg/.test(x.s)).map((x) => x.v);
  const conv = pcts.filter((x) => /^Converting/.test(x.s)).map((x) => x.v);
  check('Afterwards: Convert is back (for another file), Cancel and the progress bar are gone', !st.go.hidden && !st.go.disabled && !st.cancel && !st.progress, JSON.stringify(st));
  check('A real conversion finishes with a verified MP3 (FFmpeg’s ffprobe + this browser’s decoder)', finished && st.done && !st.error && /^Verified MP3 · 3:00 · 192 kbps · 44\.1 kHz stereo · \d+\.\d MB$/.test(st.result), JSON.stringify({ ms: Date.now() - t0, status: st.status, result: st.result }));
  check('Progress is real: FFmpeg download by bytes, then FFmpeg’s own time, never going backwards', shotMid && dl.length >= 3 && dl.every((v, i) => i === 0 || v >= dl[i - 1]) && conv.length >= 2 && conv.at(-1) === 100 && conv.every((v, i) => i === 0 || v >= conv[i - 1]) && pcts.some((x) => /Converting: \d:\d\d of 3:00/.test(x.s)), JSON.stringify({ dl: dl.length, conv }));
  check('The quality note is honest about the 128 kbps source', /source audio was about 128 kbps/.test(st.status), st.status);
  // The .js already came (unchanged, fingerprint OK) from the tampered host and was cached; the .wasm comes from the good copy.
  check('Fingerprints matched: the good FFmpeg copy was used for the part the tampered one failed', coreHits.includes('ffmpeg-core.wasm'), coreHits.join(','));
  // It plays.
  const played = await R(lap.page, async (r) => { const a = r.querySelector('#gpa-mp3-preview'); a.muted = true; await a.play(); await new Promise((res) => setTimeout(res, 1500)); const t = a.currentTime; a.pause(); return { t, d: a.duration }; });
  check('The MP3 plays in the page’s player', played.t > 0.8 && Math.abs(played.d - 180) < 1.5, JSON.stringify(played));
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-done').scrollIntoView({ block: 'center' }));
  await shot(lap.page, '05-success.png');
  // Download, then check the file with the system's own ffprobe/ffmpeg.
  const [download] = await Promise.all([lap.page.waitForEvent('download'), R(lap.page, (r) => r.querySelector('#gpa-mp3-dl').click())]);
  const file = path.join(OUT, 'downloaded.mp3');
  await download.saveAs(file);
  const pr = ffprobe(file);
  const a = (pr.streams || []).find((x) => x.codec_type === 'audio') || {};
  const size = fs.statSync(file).size;
  const bytes = fs.readFileSync(file);
  check('Download: “Test Tones.mp3”, not empty', download.suggestedFilename() === 'Test Tones.mp3' && size > 1000000, download.suggestedFilename() + ' ' + size);
  check('ffprobe (system): MP3 audio, 3:00, ~192 kbps, 44.1 kHz, stereo, no video', pr.format.format_name === 'mp3' && a.codec_name === 'mp3' && Math.abs(Number(pr.format.duration) - 180) < 0.2 && Math.abs(Number(a.bit_rate) - 192000) < 4000 && a.sample_rate === '44100' && a.channels === 2 && pr.streams.length === 1, JSON.stringify({ fmt: pr.format.format_name, codec: a.codec_name, dur: pr.format.duration, br: a.bit_rate, sr: a.sample_rate, ch: a.channels, streams: pr.streams.length }));
  check('ID3 tags: title “Test Tones”, artist “The Owner”', pr.format.tags && pr.format.tags.title === 'Test Tones' && pr.format.tags.artist === 'The Owner', JSON.stringify(pr.format.tags));
  const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  check('ffmpeg (system) decodes the whole file with no errors', dec.status === 0 && !dec.stderr.trim(), dec.stderr.slice(0, 200));
  check('The file starts with an ID3 tag, then MP3 frames', bytes.slice(0, 3).toString() === 'ID3');
  fs.copyFileSync(file, path.join(OUT, '06-downloaded-Test Tones.mp3'));
  fs.writeFileSync(path.join(OUT, '06-ffprobe.json'), JSON.stringify(pr, null, 2));

  // ---- 5: Save to My music, then on another device ----
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-save').click());
  await waitFor(lap.page, (r) => /Saved to My music/.test(r.querySelector('#gpa-mp3-status').textContent) || r.querySelector('#gpa-mp3-status').classList.contains('is-error'), null, 20000);
  st = await mp3State(lap.page);
  const listed = await waitFor(lap.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-title')].some((e) => e.textContent === 'Test Tones'), null, 10000);
  check('Save to My music: saved, listed, button says so', /Saved to My music/.test(st.status) && st.save.disabled && /Saved/.test(st.save.text) && listed, st.status);
  const ownerTok = await lap.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gpa_session_token')).token; } catch (e) { return ''; } });
  const mine = await (await fetch(env.workerUrl + '/music/mine?user=' + OWNER, { headers: { 'X-GPA-Session': ownerTok } })).json();
  const saved = (mine.tracks || []).find((t) => t.title === 'Test Tones');
  check('…on the account: the same MP3 (size), title, artist, 3:00', saved && saved.artist === 'The Owner' && saved.duration === 180, JSON.stringify(saved));
  const srv = saved ? await fetch(env.workerUrl + saved.stream + (saved.stream.includes('?') ? '&' : '?') + 'user=' + OWNER + '&s=' + encodeURIComponent(ownerTok)) : null;
  const srvBytes = srv ? Buffer.from(await srv.arrayBuffer()) : Buffer.alloc(0);
  check('…the stored file is byte-for-byte the downloaded MP3', srv && srv.ok && srvBytes.equals(bytes), srv ? srv.status + ' ' + srvBytes.length + ' vs ' + bytes.length : 'no track');
  const shared = await (await fetch(env.workerUrl + '/music/library?user=' + OWNER, { headers: { 'X-GPA-Session': ownerTok } })).json();
  check('…and NOT published to the shared library', !(shared.tracks || []).some((t) => t.title === 'Test Tones'));
  await R(lap.page, (r) => r.querySelector('#gpa-mine-list').scrollIntoView({ block: 'center' }));
  await shot(lap.page, '07-my-music-saved.png');
  // Saving the same song again asks first.
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-go').click());
  await waitDone(lap.page, 120000);
  let asked = '';
  lap.page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-save').click());
  await lap.page.waitForTimeout(1500);
  const mine2 = await (await fetch(env.workerUrl + '/music/mine?user=' + OWNER, { headers: { 'X-GPA-Session': ownerTok } })).json();
  check('Saving the same song again asks first; “no” saves nothing', /already in My music/.test(asked) && mine2.tracks.filter((t) => t.title === 'Test Tones').length === 1, asked);
  // Second device: the iPhone app.
  const ph = await phone();
  const ps = await signIn(ph.page, OWNER, 'create');
  await openMine(ph.page);
  const onPhone = await waitFor(ph.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-title')].some((e) => e.textContent === 'Test Tones'), null, 10000);
  check('Second device (iPhone app): the saved MP3 is in My music', ps.inside && onPhone, JSON.stringify(ps));
  await R(ph.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track')].find((li) => li.querySelector('.gpa-track-title').textContent === 'Test Tones').querySelector('.gpa-track-main').click());
  const phonePlays = await ph.page.waitForFunction(() => { const a = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-np-audio'); return a && a.currentTime > 0.5; }, null, { timeout: 15000 }).then(() => true, () => false);
  check('…and plays from the account on the phone', phonePlays);
  await R(ph.page, (r) => { r.querySelector('#gpa-np-audio').pause(); const d = r.querySelector('#gpa-mp3'); d.open = true; r.querySelector('#gpa-mp3').scrollIntoView({ block: 'start' }); });
  await ph.page.waitForTimeout(500);
  const fits = await R(ph.page, (r) => { const b = r.querySelector('#gpa-mp3'); return b.scrollWidth <= b.clientWidth + 1 && [...b.querySelectorAll('button, select, input:not([type=file]), a')].filter((e) => e.offsetParent).every((e) => e.getBoundingClientRect().right <= b.getBoundingClientRect().right + 1); });
  check('iPhone layout: everything fits, no sideways scrolling', fits);
  await shot(ph.page, '08-iphone.png');
  // The phone converts too (FFmpeg works in the app).
  await pick(ph.page, media.hires);
  await R(ph.page, (r) => r.querySelector('#gpa-mp3-go').click());
  await waitDone(ph.page, 120000);
  st = await mp3State(ph.page);
  check('iPhone app: a 96 kHz 5.1 WAV becomes a 48 kHz stereo MP3', st.done && /· 0:08 · 192 kbps · 48 kHz stereo ·/.test(st.result), st.result || st.status);
  await R(ph.page, (r) => r.querySelector('#gpa-mp3-done').scrollIntoView({ block: 'center' }));
  await shot(ph.page, '09-iphone-converted.png');
  await ph.ctx.close();

  // ---- 6: cancel, timeout, bad files, too big ----
  const workersNow = () => lap.page.workers().length;
  const w0 = workersNow();
  await pick(lap.page, media.long);
  await setQuality(lap.page, 320);
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-go').click());
  const converting = await waitFor(lap.page, (r) => /^Converting/.test(r.querySelector('#gpa-mp3-status').textContent), null, 60000);
  const during = workersNow();
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-cancel').click());
  await lap.page.waitForTimeout(800);
  st = await mp3State(lap.page);
  const gone = async () => { for (let i = 0; i < 50 && workersNow() !== w0; i++) await lap.page.waitForTimeout(100); return workersNow() === w0; };
  check('Cancel: stops the conversion, nothing saved, Convert is back', converting && /Canceled\. Nothing was saved\./.test(st.status) && !st.error && !st.done && !st.go.hidden && !st.go.disabled && !st.cancel, st.status);
  check('…and its worker (with FFmpeg’s memory) is gone', during === w0 + 1 && await gone(), `${w0} → ${during} → ${workersNow()}`);
  await lap.page.evaluate(() => localStorage.setItem('gpa_mp3_timeout_ms', '1500'));
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-go').click());
  await waitDone(lap.page, 60000);
  st = await mp3State(lap.page);
  check('Timeout (set to 1.5 s for the test): stopped with a clear message, worker gone', st.error && /took longer than 2 seconds and was stopped/.test(st.status) && await gone(), st.status);
  await lap.page.evaluate(() => localStorage.removeItem('gpa_mp3_timeout_ms'));
  await pick(lap.page, media.silent);
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-go').click());
  await waitDone(lap.page, 60000);
  st = await mp3State(lap.page);
  check('A video without audio: “This file has no audio track…”', st.error && /no audio track/.test(st.status) && !st.done, st.status);
  await pick(lap.page, media.broken);
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-go').click());
  await waitDone(lap.page, 60000);
  st = await mp3State(lap.page);
  check('A broken file: “FFmpeg couldn’t read this file…”', st.error && /couldn’t read this file/.test(st.status) && !st.done, st.status);
  await pick(lap.page, media.long);
  await setQuality(lap.page, 320);
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-go').click());
  await waitDone(lap.page, 300000);
  st = await mp3State(lap.page);
  check('11:40 at 320 kbps (28 MB): can be downloaded, but Save says it’s over 25 MB', st.done && /· 11:40 · 320 kbps ·/.test(st.result) && st.save.disabled && /25 MB/.test(st.save.title) && /over 25 MB/.test(st.status), st.result + ' | ' + st.status);

  // ---- 7: themes, offline, reload ----
  await R(lap.page, (r) => { r.querySelector('#gpa-mp3').open = true; });
  // Themes: the section uses the theme's colors and stays readable.
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const themes = await R(lap.page, (r) => [...r.querySelectorAll('.gps-tile[data-theme]')].map((t) => t.dataset.theme).filter((t) => t !== 'custom'));
  const bad = [], okThemes = [];
  for (const th of themes) {
    await R(lap.page, (r, t) => r.querySelector(`.gps-tile[data-theme="${t}"]`).click(), th);
    await lap.page.waitForTimeout(900);   // theme colors animate
    const c = await R(lap.page, (r) => {
      // Text against what's really behind it; a gradient or tinted button uses the theme's accent.
      const opaque = (el) => { while (el) { const cs = getComputedStyle(el); if (cs.backgroundImage && cs.backgroundImage !== 'none' && el.matches('button, .gpa-btn')) return cs.getPropertyValue('--gpa-accent').trim() || 'rgb(0, 0, 0)'; const b = cs.backgroundColor; if (b && !/rgba\(.*, 0\)$/.test(b) && b !== 'transparent') return b; el = el.parentElement || (el.getRootNode() && el.getRootNode().host); } return 'rgb(0, 0, 0)'; };
      const toRgb = (c) => { const d = document.createElement('div'); d.style.color = c; r.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; };
      const pair = (el) => [getComputedStyle(el).color, toRgb(opaque(el))];
      return { sum: pair(r.querySelector('.gpa-mp3-sum')), note: pair(r.querySelector('#gpa-mp3-qnote')), go: pair(r.querySelector('#gpa-mp3-go')),
        // The same kinds of element elsewhere in My music / Search, for comparison.
        hint: pair(r.querySelector('[data-src-panel="mine"] > p.gpa-sub')), primary: pair(r.querySelector('#gpa-music-search')) };
    });
    const rs = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(ratio(...v) * 100) / 100]));
    // Title ≥ 4.5:1; the hint and the primary button at least as readable as the theme's own hints and primary buttons.
    if (rs.sum < 4.5 || rs.note < Math.min(4.5, rs.hint - 0.2) || rs.go < Math.min(4.5, rs.primary - 0.2)) bad.push(th + ' ' + JSON.stringify(rs));
    else okThemes.push(th + ' ' + JSON.stringify(rs));
    if (th === 'white' || th === 'dark' || th === 'matte' || th === 'lightblue') { await R(lap.page, (r) => r.querySelector('#gpa-mp3').scrollIntoView({ block: 'start' })); await shot(lap.page, `10-theme-${th}.png`); }
  }
  check(`Every theme (${themes.length}): title ≥4.5:1; hint and Convert as readable as the theme’s own hints and buttons`, themes.length >= 8 && !bad.length, bad.join(' | ') || themes.join(','));
  fs.writeFileSync(path.join(OUT, '10-theme-contrast.txt'), okThemes.concat(bad.map((b) => 'FAIL ' + b)).join('\n') + '\n');
  await R(lap.page, (r) => r.querySelector('.gps-tile[data-theme="dark"]').click());

  // FFmpeg is in the browser cache now: a fresh page converts with no network.
  const hitsBefore = coreHits.length;
  await lap.ctx.setOffline(true);
  await lap.page.evaluate((c) => { (0, eval)(c); }, code);   // re-inject: the old copy tears itself down
  await lap.page.waitForTimeout(1500);
  const one = await R(lap.page, (r) => document.querySelectorAll('#gpa-root-host').length === 1 && !!r.querySelector('#gpa-mp3'));
  check('Re-injecting the console replaces the old copy (one panel)', one);
  // Same device: sign in again if the new copy asks (offline, so from this device's profile).
  if (await R(lap.page, (r) => r.querySelector('#gpa-login').style.display !== 'none')) await signIn(lap.page, OWNER, 'signin');
  await R(lap.page, (r) => { const m = r.querySelector('.gpa-mini'); if (m && m.style.display !== 'none') m.click(); });   // it reopens collapsed
  await lap.page.waitForTimeout(400);
  await openMine(lap.page);
  const back = await waitFor(lap.page, (r) => !r.querySelector('#gpa-mp3').hidden, null, 8000);
  check('After the reload (offline) the owner still has the converter', back);
  await R(lap.page, (r) => { r.querySelector('#gpa-mp3').open = true; });
  let workerStarts = 0;
  lap.page.on('worker', () => { workerStarts++; });
  await pick(lap.page, media.hires);
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-go').click());
  await waitDone(lap.page, 120000);
  st = await mp3State(lap.page);
  check('Offline: converts with FFmpeg from the browser cache (no download)', st.done && coreHits.length === hitsBefore && /Verified MP3/.test(st.result), st.status + ' | ' + st.result);
  check('After the reload one click starts exactly one conversion (no doubled handlers)', workerStarts === 1, String(workerStarts));
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-save').click());
  await waitFor(lap.page, (r) => r.querySelector('#gpa-mp3-status').classList.contains('is-error') || /Saved/.test(r.querySelector('#gpa-mp3-status').textContent), null, 15000);
  st = await mp3State(lap.page);
  check('Offline: Save fails with a clear message and stays available', st.error && /Couldn’t reach the server/.test(st.status) && !st.save.disabled, st.status);
  await lap.ctx.setOffline(false);
  await lap.page.waitForTimeout(1000);
  const dialogs = [];
  lap.page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await R(lap.page, (r) => r.querySelector('#gpa-mp3-save').click());
  await waitFor(lap.page, (r) => /Saved to My music/.test(r.querySelector('#gpa-mp3-status').textContent), null, 20000);
  st = await mp3State(lap.page);
  check('Back online: Save works', /Saved to My music/.test(st.status), st.status + (dialogs.length ? ' | dialogs: ' + dialogs.join(' / ') : ''));

  // A real YouTube download needs an authorized way to get the media from a
  // link; YouTube offers none (no API, and its terms forbid it).
  notRun('Converting audio fetched from a YouTube link', 'no authorized retrieval path exists (the YouTube Data API returns details only); the tool converts the owner’s own file instead, tested above');

  for (const [n, p] of [['computer', lap.page]]) check(`No page errors (${n})`, p._errors.length === 0, p._errors.slice(0, 2).join(' | '));
  await lap.ctx.close();
} finally {
  await browser.close();
  await env.close();
  for (const s of [scriptHost, coreHost, badHost, ytHost, site]) await s.close();
}
const ran = results.filter((x) => !x.notRun);
const passed = ran.filter((x) => x.ok).length;
const skipped = results.length - ran.length;
console.log(`\n${passed}/${ran.length} checks passed${skipped ? ` (${skipped} not run)` : ''}`);
process.exit(passed === ran.length ? 0 : 1);
