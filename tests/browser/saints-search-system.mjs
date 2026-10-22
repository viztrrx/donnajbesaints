// Everything together, in Chromium identifying as ChromeOS: the real console
// (script.js) and the real main Worker (worker.js in workerd, with the
// stand-in Eaglercraft client), framing the real Saints Search
// (viztrrx/frontend, run by Wrangler from its own wrangler.jsonc with a local
// R2), browsing through the real Scramjet + libcurl over a local Wisp server.
//
//   SAINTS_SEARCH_DIR=../frontend      viztrrx/frontend, built (pnpm build)
//   SCRAMJET_BACKEND_DIR=../scramjet-backend   for its wisp-js (npm install)
//   node tests/browser/saints-search-system.mjs [outDir]
//
// Checks: the proxy (a site through Scramjet, Back, Home), saved sessions
// (signed in through the console, a site's cookie saved, cleared by a new
// session and brought back by Resume), the AI block and its "Use Saints
// Service AI", "Continue with Google" going through, the Games tab (a game,
// Back), and Eaglercraft from the Games tab through the Worker's /eagler/
// frame with WASD and typing, in the tab and in about:blank.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer as createHttps } from 'node:https';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const FRONTEND = path.resolve(process.env.SAINTS_SEARCH_DIR || path.join(ROOT, '..', 'frontend'));
const BACKEND = path.resolve(process.env.SCRAMJET_BACKEND_DIR || path.join(ROOT, '..', 'scramjet-backend'));
const DIST = path.join(FRONTEND, 'dist');
if (!fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(path.join(BACKEND, 'node_modules/@mercuryworkshop/wisp-js'))) {
  console.log('SKIP  needs viztrrx/frontend built at ' + FRONTEND + ' and viztrrx/scramjet-backend installed at ' + BACKEND);
  process.exit(0);
}
const OUT = process.argv[2] || 'saints-search-system-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`); };
async function step(name, fn) { try { await fn(); } catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 2).join(' | ')); } }
const CHROMEOS_UA = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- A test website, reached only through the proxy ----
const SITE_PAGE = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Test site</title></head><body style="font:18px sans-serif">${body}</body></html>`;
const site = await serve((rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  rs.setHeader('Content-Type', 'text/html');
  if (u.pathname === '/set') { rs.setHeader('Set-Cookie', 'sid=signed-in-123; Path=/; Max-Age=86400'); rs.end(SITE_PAGE('<h1 id="ok">signed in</h1>')); return; }
  if (u.pathname === '/who') { rs.end(SITE_PAGE(`<h1 id="ok">who</h1><p id="who">${(rq.headers.cookie || 'nobody').replace(/[<>&]/g, '')}</p>`)); return; }
  rs.end(SITE_PAGE(`<h1 id="ok">Hello through the proxy</h1><p id="path">${u.pathname}</p>
    <a id="google" href="https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=http://127.0.0.1/cb">Continue with Google</a>
    <a id="next" href="/two">next page</a>`));
});
const SITE = `http://127.0.0.1:${site.port}`;

// ---- Wisp over TLS (self-signed; the browser is told to accept it) ----
const req = createRequire(path.join(BACKEND, 'package.json'));
const wispMod = await import(req.resolve('@mercuryworkshop/wisp-js/server'));
const { server: wisp, logging } = wispMod.server ? wispMod : wispMod.default;
logging.set_level(logging.NONE);
Object.assign(wisp.options, { allow_loopback_ips: true, allow_private_ips: true, allow_udp_streams: false });
const certDir = fs.mkdtempSync(path.join(OUT, 'tls-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certDir, 'k.pem'), '-out', path.join(certDir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const wispServer = createHttps({ key: fs.readFileSync(path.join(certDir, 'k.pem')), cert: fs.readFileSync(path.join(certDir, 'c.pem')) }, (q, r) => r.end('ok'));
wispServer.on('upgrade', (q, s, h) => wisp.routeRequest(q, s, h));
await new Promise((r) => wispServer.listen(0, '127.0.0.1', r));
const WISP = `wss://localhost:${wispServer.address().port}/wisp/`;

// ---- The main Worker (accounts, Eaglercraft) ----
// ADMIN_TOKEN: the Worker signs server sessions with a key derived from it
// (the console's sign-in token, which saved sessions are checked against).
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'system-test-admin-token-0123456789' } });

// ---- Saints Search, run by Wrangler from its own config: its config.js
// points at the local Wisp, Eaglercraft at the local main Worker, and
// /sessions checks sign-ins with the local main Worker. ----
const STAGE = fs.mkdtempSync(path.join(OUT, 'frontend-'));
fs.cpSync(FRONTEND, STAGE, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.wrangler)([\\/]|$)/.test(p.slice(FRONTEND.length)) });
fs.symlinkSync(path.join(FRONTEND, 'node_modules'), path.join(STAGE, 'node_modules'));
fs.writeFileSync(path.join(STAGE, 'dist/config.js'), `let _CONFIG = { wispUrl: ${JSON.stringify(WISP)} };\n`);
const gamesFile = path.join(STAGE, 'dist/games/games.json');
fs.writeFileSync(gamesFile, JSON.stringify(JSON.parse(fs.readFileSync(gamesFile, 'utf8')).map((g) => (g.slug === 'eaglercraft' ? { ...g, frame: env.workerUrl + '/eagler/?autoPack=1' } : g))));
const fePort = 18787 + Math.floor(Math.random() * 1000);
const fe = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(fePort), '--ip', '127.0.0.1', '--var', 'AUTH_BASE:' + env.workerUrl], { cwd: STAGE, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
fe.log = '';
fe.stdout.on('data', (d) => { fe.log += d; });
fe.stderr.on('data', (d) => { fe.log += d; });
const FE = `http://127.0.0.1:${fePort}`;
for (let i = 0; i < 120; i++) { try { if ((await fetch(FE + '/')).ok) break; } catch (e) { /* starting */ } await sleep(1000); }

const hostSite = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'A school website')); });
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const browser = await launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);

async function computer() {
  const c = await browser.newContext({ viewport: { width: 1280, height: 860 }, userAgent: CHROMEOS_UA, ignoreHTTPSErrors: true });
  await c.addInitScript(([u, s]) => {
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); localStorage.setItem('gpa_proxy_server_url', s); } catch (e) { /* ignore */ }
  }, [env.workerUrl, FE]);
  const page = await c.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${hostSite.port}/`);
  await page.evaluate((cd) => { (0, eval)(cd); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx: c, page };
}
async function signIn(page, user) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  // The server sign-in (a token from the Worker) finishes after the local one.
  await page.waitForFunction(() => !!localStorage.getItem('gpa_session_token'), null, { timeout: 20000 }).catch(() => {});
  return R(page, (r) => r.querySelector('#gpa-login').style.display === 'none');
}
const tab = (page, t) => R(page, (r, x) => { const n = r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`); n.style.display = ''; n.click(); }, t);
async function frameOf(win, prefix, tries = 60) {
  for (let i = 0; i < tries; i++) { const f = win.frames().find((x) => x.url().startsWith(prefix)); if (f) return f; await win.waitForTimeout(250); }
  return null;
}
// The proxied site's frame inside Saints Search.
const siteFrame = (win) => frameOf(win, FE + '/scramjet/');
async function go(ss, text) { await ss.fill('#sj-address', text); await ss.press('#sj-address', 'Enter'); }
async function siteText(win, sel, want, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const f of win.frames().filter((x) => x.url().startsWith(FE + '/scramjet/'))) {
      try { const t = await f.innerText(sel, { timeout: 500 }); if (!want || want.test(t)) return t; } catch (e) { /* not there yet */ }
    }
    await win.waitForTimeout(300);
  }
  return '';
}

async function playEaglercraft(win, ss, label) {
  await ss.click('#sj-home-btn');
  await ss.click('#sj-games-open');
  await ss.waitForSelector('.ss-game[data-slug="eaglercraft"]', { timeout: 15000 });
  await ss.click('.ss-game[data-slug="eaglercraft"]');
  const game = await frameOf(win, env.workerUrl + '/eagler/');
  check(label + ': Eaglercraft opens from the Games tab (the Worker’s /eagler/ frame)', !!game);
  if (!game) return;
  const started = await game.waitForFunction(() => window.__stub && window.__stub.frames > 5, null, { timeout: 30000 }).then(() => true, () => false);
  const cover = await ss.isHidden('#sj-loading');
  check(label + ': the game starts and draws (WebGL 2), and Saints Search uncovers it', started && cover, JSON.stringify(await game.evaluate(() => window.__stub && { webgl: window.__stub.webgl, frames: window.__stub.frames, errors: window.__stub.errors }).catch(() => null)));
  await game.click('canvas');
  const locked = await game.evaluate(() => !!document.pointerLockElement).catch(() => false);
  check(label + ': clicking the game locks the mouse cursor (mouse look)', locked);
  for (const k of ['w', 'a', 's', 'd', ' ']) await win.keyboard.press(k === ' ' ? 'Space' : k);
  await win.keyboard.type('hi');
  const keys = await game.evaluate(() => window.__stub.keys.slice());
  check(label + ': W, A, S, D, Space and typed text reach the game', keys.join(',').includes('w,a,s,d, ,h,i'), keys.join(','));
}

let a, b;
try {
  a = await computer();
  check('ChromeOS: the console signs in (real Worker)', await signIn(a.page, 'sys' + run));
  await tab(a.page, 'browser');
  await a.page.waitForTimeout(600);
  if (!(await R(a.page, (r) => !!r.fullscreenElement))) await a.page.click(sr('#gpa-proxy-fs'));
  await waitFor(a.page, (r) => { const btn = r.querySelector('#gpa-proxy-launch-here'); return btn && btn.offsetParent && !btn.disabled; }, null, 6000);
  await a.page.click(sr('#gpa-proxy-launch-here'));
  const ss = await frameOf(a.page, FE + '/');
  check('Proxy tab: Saints Search loads inside the console', !!ss);
  await ss.waitForSelector('#sj-address', { timeout: 30000 });

  await step('toolbar', async () => {
    const ui = await ss.evaluate(() => ({ home: !!document.getElementById('sj-home-btn').offsetParent, address: document.getElementById('sj-address').value, tabs: document.querySelectorAll('.sb-tab').length }));
    check('Saints Search shows its Chrome-style toolbar (tabs, Home, address saints://home)', ui.home && ui.address === 'saints://home' && ui.tabs === 1, JSON.stringify(ui));
  });

  await step('sessions account', async () => {
    const ok = await ss.waitForFunction((u) => (document.getElementById('sj-sess-who') || {}).textContent === u, 'sys' + run, { timeout: 15000 }).then(() => true, () => false);
    check('Saved sessions: Saints Search knows who is signed in to the console', ok, await ss.innerText('#sj-sessions').catch(() => ''));
  });

  await step('proxy browsing', async () => {
    await go(ss, SITE + '/one');
    const text = await siteText(a.page, '#ok', /Hello/);
    check('Proxy: a website opens through Scramjet and the Wisp backend, below the toolbar', /Hello through the proxy/.test(text), text);
    check('…the address bar shows the real address', (await ss.inputValue('#sj-address')) === SITE + '/one');
    await ss.click('#sj-home-btn');
    check('…Home goes back to saints://home', (await ss.inputValue('#sj-address')) === 'saints://home' && await ss.isVisible('#sj-home'));
  });

  await step('saved sessions', async () => {
    await ss.click('#sj-sess-new');
    await ss.waitForSelector('.ss-sess.is-active', { timeout: 15000 });
    await go(ss, SITE + '/set');
    await siteText(a.page, '#ok', /signed in/);
    await ss.click('#sj-home-btn');
    await ss.waitForTimeout(1500);
    await go(ss, SITE + '/who');
    let who = await siteText(a.page, '#who', /./);
    check('Saved sessions: a site’s sign-in cookie works through the proxy', /sid=signed-in-123/.test(who), who);
    await ss.click('#sj-home-btn');
    await ss.waitForTimeout(1500);   // the active session saves on the way home
    const name1 = await ss.innerText('.ss-sess.is-active .ss-sess-name');
    await ss.click('#sj-sess-new');
    await ss.waitForFunction((n) => { const el = document.querySelector('.ss-sess.is-active .ss-sess-name'); return el && el.textContent !== n; }, name1, { timeout: 15000 });
    await go(ss, SITE + '/who');
    who = await siteText(a.page, '#who', /./);
    check('…a New session starts signed out', /nobody/.test(who), who);
    await ss.click('#sj-home-btn');
    await ss.click(`.ss-sess:has-text("${name1}") button:has-text("Resume")`);
    await ss.waitForFunction((n) => { const el = document.querySelector('.ss-sess.is-active .ss-sess-name'); return el && el.textContent === n; }, name1, { timeout: 15000 });
    await go(ss, SITE + '/who');
    who = await siteText(a.page, '#who', /./);
    check('…Resume brings the sign-in back', /sid=signed-in-123/.test(who), who);
    await ss.click('#sj-home-btn');
  });

  await step('google sign-in', async () => {
    await go(ss, SITE + '/one');
    await siteText(a.page, '#ok', /Hello/);
    const sf = await siteFrame(a.page);
    await sf.click('#google');
    // No internet here, so Google itself can't load; what matters is that
    // Saints Search lets the sign-in through instead of blocking it.
    const went = await ss.waitForFunction(() => /^https:\/\/accounts\.google\.com\//.test(document.getElementById('sj-address').value), null, { timeout: 15000 }).then(() => true, () => false);
    check('Google sign-in: "Continue with Google" goes on to Google, with no blocking notice', went && await ss.isHidden('#sj-block'), await ss.inputValue('#sj-address'));
    await ss.click('#sj-home-btn');
  });

  await step('games', async () => {
    await ss.click('#sj-games-open');
    await ss.waitForSelector('.ss-game[data-slug="2048"]', { timeout: 15000 });
    check('Games tab: saints://games lists the games', (await ss.inputValue('#sj-address')) === 'saints://games' && (await ss.locator('.ss-game').count()) >= 40, String(await ss.locator('.ss-game').count()));
    await ss.click('.ss-game[data-slug="2048"]');
    const g = await frameOf(a.page, FE + '/games/public/2048/');
    const cells = g ? await g.waitForFunction(() => document.querySelectorAll('.grid-cell').length, null, { timeout: 15000 }).then((h) => h.jsonValue(), () => 0) : 0;
    check('…a game plays in the page area (2048)', cells === 16, 'cells=' + cells);
    await a.page.keyboard.press('ArrowLeft');
    await ss.click('#sj-back');
    check('…Back returns to saints://games', (await ss.inputValue('#sj-address')) === 'saints://games');
  });

  await step('eaglercraft here', async () => {
    await playEaglercraft(a.page, ss, 'Eaglercraft (in the tab)');
    await a.page.screenshot({ path: path.join(OUT, '01-eaglercraft-here.png') });
    await ss.click('#sj-back');
  });

  await step('ai block', async () => {
    await ss.click('#sj-home-btn');
    await go(ss, 'chatgpt.com');
    const shown = await ss.waitForSelector('#sj-block:not([hidden])', { timeout: 10000 }).then(() => true, () => false);
    check('AI block: ChatGPT shows "This AI is unsafe and inaccurate…"', shown && /unsafe and inaccurate/.test(await ss.innerText('#sj-block')));
    await ss.click('#sj-block-console');
    const ask = await waitFor(a.page, (r) => { const p = r.querySelector('.gpa-pane[data-pane="ask"]'); return p && p.classList.contains('active'); }, null, 8000);
    check('…"Use Saints Service AI" closes the proxy and opens Ask AI', ask && await R(a.page, (r) => r.querySelector('#gpa-proxy-stage').style.display === 'none'));
  });
  check('No page errors (console, in the tab)', a.page._errors.length === 0, a.page._errors.slice(0, 2).join(' | '));

  // about:blank
  b = await computer();
  await signIn(b.page, 'sysb' + run);
  await tab(b.page, 'browser');
  await b.page.waitForTimeout(600);
  const [pop] = await Promise.all([b.ctx.waitForEvent('page', { timeout: 8000 }), b.page.click(sr('#gpa-proxy-launch-blank'))]);
  const ssb = await frameOf(pop, FE + '/');
  check('about:blank: Saints Search loads in the window', !!ssb);
  if (ssb) {
    await ssb.waitForSelector('#sj-address', { timeout: 30000 });
    await step('about:blank browse', async () => {
      await go(ssb, SITE + '/one');
      const text = await siteText(pop, '#ok', /Hello/);
      check('about:blank: a website opens through the proxy', /Hello/.test(text), text);
    });
    await step('eaglercraft blank', async () => {
      await playEaglercraft(pop, ssb, 'Eaglercraft (about:blank)');
      await pop.screenshot({ path: path.join(OUT, '02-eaglercraft-blank.png') });
    });
  }
  check('No page errors (console, about:blank)', b.page._errors.length === 0, b.page._errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  try { process.kill(-fe.pid, 'SIGTERM'); } catch (e) { /* gone */ }
  await env.close();
  await site.close();
  await hostSite.close();
  wispServer.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
