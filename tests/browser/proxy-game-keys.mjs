// Keyboard in games played through the Proxy tab: the real console (script.js)
// frames the real Saints Search (viztrrx/frontend's built dist/, path in
// SAINTS_SEARCH_DIST), whose Games tab opens Eaglercraft. The game frame is a
// stand-in on another origin that behaves like eaglercraft/loader/bridge.js
// (posts loading/started, takes "focus" onto its canvas) and records every
// key it receives. In the tab (fullscreen) and in the about:blank window:
//   1. WASD and typed text reach the game
//   2. after clicking the console page, clicking the game gets the keys back
//   3. the console keeps Esc for the game (Keyboard Lock) while it shows, and
//      lets go when the game is left
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'proxy-game-keys-out';
fs.mkdirSync(OUT, { recursive: true });
const DIST = process.env.SAINTS_SEARCH_DIST || path.join(ROOT, '..', 'frontend', 'dist');
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.log('SKIP  Saints Search build not found at ' + DIST + ' (set SAINTS_SEARCH_DIST to viztrrx/frontend\'s dist/)');
  process.exit(0);
}
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ---- The game: like bridge.js, on its own origin, with the headers the
// Worker sends so a cross-origin isolated page may frame it. ----
const GAME_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>game</title></head>
<body style="margin:0;background:#2a5"><div id="game_frame"><canvas width="300" height="200" style="width:100%;height:90vh;display:block"></canvas></div>
<script>
window.__keys = [];
var parentOrigin = (location.ancestorOrigins && location.ancestorOrigins.length) ? location.ancestorOrigins[0] : '*';
function post(type) { parent.postMessage({ eagler: 1, type: type }, parentOrigin); }
var c = document.querySelector('#game_frame canvas');
['keydown', 'keypress'].forEach(function (t) { c.addEventListener(t, function (e) { window.__keys.push(t + ':' + e.key); }); });
addEventListener('message', function (e) {
  if (e.source !== parent || !e.data || e.data.eagler !== 1) return;
  if (e.data.type === 'focus') { window.focus(); if (!c.hasAttribute('tabindex')) c.setAttribute('tabindex', '0'); c.focus(); }
});
post('loading');
setTimeout(function () { post('started'); }, 300);
</script></body></html>`;
const game = await serve((rq, rs) => {
  rs.setHeader('Content-Type', 'text/html');
  rs.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  rs.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  rs.end(GAME_PAGE);
});
const GAME = `http://127.0.0.1:${game.port}`;

// ---- Saints Search, served like the frontend Worker does (COOP/COEP). Its
// games list points Eaglercraft at the stand-in game. ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const fe = await serve((rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  rs.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  rs.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (p === '/games/games.json') {
    const list = JSON.parse(fs.readFileSync(path.join(DIST, 'games/games.json'), 'utf8'))
      .map((g) => (g.slug === 'eaglercraft' ? { ...g, frame: GAME + '/eagler/?autoPack=1' } : g));
    rs.setHeader('Content-Type', 'application/json');
    rs.end(JSON.stringify(list));
    return;
  }
  const file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { rs.statusCode = 404; rs.end('not found'); return; }
  rs.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(rs);
});
const FE = `http://127.0.0.1:${fe.port}`;

const env = await startEnv();
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'A school website')); });
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
// Records Keyboard Lock calls on a window (the browser's own needs fullscreen).
const spyKeyboard = (page) => page.evaluate(() => {
  window.__kb = [];
  const kb = navigator.keyboard;
  if (!kb) return;
  kb.lock = () => { window.__kb.push('lock'); return Promise.resolve(); };
  kb.unlock = () => { window.__kb.push('unlock'); };
});

async function computer() {
  const c = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  await c.addInitScript(([u, s]) => {
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); localStorage.setItem('gpa_proxy_server_url', s); } catch (e) { /* ignore */ }
  }, [env.workerUrl, FE]);
  const page = await c.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${site.port}/`);
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
  return R(page, (r) => r.querySelector('#gpa-login').style.display === 'none');
}
const tab = (page, t) => R(page, (r, x) => { const n = r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`); n.style.display = ''; n.click(); }, t);

// Opens Eaglercraft from Saints Search's Games tab in `win` (the console page
// or the about:blank window) and checks the keyboard reaches the game.
async function playAndType(win, label, keysWin) {
  const ss = () => win.frames().find((x) => x.url().startsWith(FE));
  await win.waitForFunction((fe) => [...document.querySelectorAll('iframe')].length >= 0 && true, FE);
  let frame = null;
  for (let i = 0; i < 40 && !frame; i++) { frame = ss(); if (!frame) await win.waitForTimeout(250); }
  check(label + ': Saints Search is in the proxy', !!frame);
  if (!frame) return;
  await frame.waitForSelector('#sj-games-open', { timeout: 15000 });
  await frame.click('#sj-games-open');
  await frame.waitForSelector('.ss-game[data-slug="eaglercraft"]', { timeout: 15000 });
  await frame.click('.ss-game[data-slug="eaglercraft"]');
  let gameFrame = null;
  for (let i = 0; i < 40 && !gameFrame; i++) { gameFrame = win.frames().find((x) => x.url().startsWith(GAME)); if (!gameFrame) await win.waitForTimeout(250); }
  check(label + ': Eaglercraft opens in Saints Search', !!gameFrame);
  if (!gameFrame) return;
  await win.waitForTimeout(1200);   // "started" → focus
  const focused = await gameFrame.evaluate(() => document.activeElement && document.activeElement.tagName);
  check(label + ': the game’s canvas has the keyboard once it starts', focused === 'CANVAS', 'activeElement=' + focused);
  await win.keyboard.press('w'); await win.keyboard.press('a'); await win.keyboard.press('s'); await win.keyboard.press('d');
  await win.keyboard.type('hello');
  let keys = await gameFrame.evaluate(() => window.__keys.slice());
  const downs = keys.filter((k) => k.startsWith('keydown:')).map((k) => k.slice(8)).join('');
  check(label + ': W, A, S, D reach the game without clicking it first', /^wasd/.test(downs), downs);
  check(label + ': typed text reaches the game (chat, sign text, names)', keys.filter((k) => k.startsWith('keypress:')).map((k) => k.slice(9)).join('').endsWith('hello'), keys.join(' '));
  const kb = await keysWin.evaluate(() => (window.__kb || []).slice());
  check(label + ': the console keeps Esc and shortcuts for the game (Keyboard Lock)', kb.includes('lock'), JSON.stringify(kb));
  // Focus elsewhere (the console page / window body), then back into the game.
  await win.mouse.click(5, win.viewportSize() ? win.viewportSize().height - 5 : 600);
  await gameFrame.click('canvas');
  await gameFrame.evaluate(() => { window.__keys = []; });
  await win.keyboard.press('w');
  await win.keyboard.type('ok');
  keys = await gameFrame.evaluate(() => window.__keys.slice());
  check(label + ': after clicking elsewhere, clicking the game gives it the keys again', keys.includes('keydown:w') && keys.filter((k) => k.startsWith('keypress:')).map((k) => k.slice(9)).join('') === 'wok', keys.join(' '));
  // Leaving the game hands the keys back to the browser.
  await frame.click('#sj-back');
  await win.waitForTimeout(500);
  const kb2 = await keysWin.evaluate(() => (window.__kb || []).slice());
  check(label + ': leaving the game releases the Keyboard Lock', kb2[kb2.length - 1] === 'unlock', JSON.stringify(kb2));
}

let a, b;
try {
  // In this tab (fullscreen).
  a = await computer();
  check('signs in', await signIn(a.page, 'gk' + run));
  await tab(a.page, 'browser');
  await a.page.waitForTimeout(600);
  check('the proxy frame allows gamepads, fullscreen and autoplay', await R(a.page, (r) => /gamepad/.test(r.querySelector('#gpa-proxy-frame').getAttribute('allow')) && /fullscreen/.test(r.querySelector('#gpa-proxy-frame').getAttribute('allow'))));
  if (!(await R(a.page, (r) => !!r.fullscreenElement))) await a.page.click(sr('#gpa-proxy-fs'));
  await waitFor(a.page, (r) => { const btn = r.querySelector('#gpa-proxy-launch-here'); return btn && btn.offsetParent && !btn.disabled; }, null, 6000);
  await spyKeyboard(a.page);
  await a.page.click(sr('#gpa-proxy-launch-here'));
  await playAndType(a.page, 'In this tab', a.page);
  await a.page.screenshot({ path: path.join(OUT, '01-here.png') });
  check('No page errors (in this tab)', a.page._errors.length === 0, a.page._errors.slice(0, 2).join(' | '));

  // In an about:blank window.
  b = await computer();
  await signIn(b.page, 'gb' + run);
  await tab(b.page, 'browser');
  await b.page.waitForTimeout(600);
  const [pop] = await Promise.all([b.ctx.waitForEvent('page', { timeout: 8000 }), b.page.click(sr('#gpa-proxy-launch-blank'))]);
  await pop.waitForTimeout(500);
  await spyKeyboard(pop);
  await playAndType(pop, 'In about:blank', pop);
  await pop.screenshot({ path: path.join(OUT, '02-blank.png') });
  check('No page errors (about:blank)', b.page._errors.length === 0, b.page._errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
  await fe.close();
  await game.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
