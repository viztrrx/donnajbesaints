// End-to-end checks for the Eaglercraft tab, in real Chromium against the
// real worker.js running in workerd. The game is the stand-in client in
// fixtures/stub-client (same page contract as EaglercraftX 1.8, no Minecraft
// code), because a real build can't be redistributed or fetched here.
//
//   MINIFLARE_DIR=/path/with/miniflare+ws [RELAY_JAR=EaglerSPRelay.jar] \
//     node tests/browser/eaglercraft.e2e.mjs [outDir]
//
// Prints one line per check and exits non-zero if any failed.
import fs from 'node:fs';
import path from 'node:path';
import { launch, openConsole, openTab, serve, HOST_PAGE } from './harness.mjs';
import { startEnv, requests } from './env.mjs';

const OUT = process.argv[2] || 'eagler-e2e-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && detail !== '' ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}
async function step(name, fn) {
  try { await fn(); } catch (e) { check(name + ' (threw)', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
}
// Established TCP sockets touching `port`, with the process holding each
// (from /proc, so it works without ss/netstat).
function socketOwners(port) {
  const inodes = new Map();
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let lines = [];
    try { lines = fs.readFileSync(f, 'utf8').trim().split('\n').slice(1); } catch (e) { continue; }
    for (const l of lines) {
      const c = l.trim().split(/\s+/);
      const lp = parseInt(c[1].split(':')[1], 16), rp = parseInt(c[2].split(':')[1], 16);
      if (c[3] === '01' && (lp === port || rp === port)) inodes.set(c[9], { local: lp, remote: rp });
    }
  }
  const out = [];
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch (e) { continue; }
    for (const fd of fds) {
      let link = '';
      try { link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch (e) { continue; }
      const m = /^socket:\[(\d+)\]$/.exec(link);
      if (m && inodes.has(m[1])) {
        let comm = '';
        try { comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch (e) { comm = '?'; }
        out.push({ ...inodes.get(m[1]), proc: comm + ' (pid ' + pid + ')' });
      }
    }
  }
  return out;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, every = 100) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch (e) { last = undefined; } await wait(every); }
  return last;
}

const env = await startEnv();
const host = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE); });
const HOST = `http://127.0.0.1:${host.port}/`;
const patch = (code) => code.split('https://donnajbe.viztrrx.workers.dev').join(env.workerUrl);
const BROWSER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'];
const browser = await launch({ args: BROWSER_ARGS });

// Everything else on the network is refused, so a direct request would fail.
async function newContext(br = browser) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return (u.hostname === '127.0.0.1' || u.hostname === 'localhost') ? route.continue() : route.abort('blockedbyclient');
  });
  return ctx;
}
const R = (page, fn, arg) => page.evaluate(([f, a]) => {
  const r = document.getElementById('gpa-root-host').shadowRoot;
  return new Function('r', 'a', 'return (' + f + ')(r, a)')(r, a);
}, [fn.toString(), arg]);
const eagFrame = (page) => page.frames().find((f) => f.url().startsWith(env.workerUrl + '/eagler/'));
const stub = (frame, expr) => frame.evaluate(new Function('return (' + expr + ')'));
async function shot(page, name) {
  const file = path.join(OUT, name + '.png');
  // Element screenshots can stall while the page is fullscreen; the whole
  // viewport is the same picture then.
  const fsNow = await page.evaluate(() => !!document.fullscreenElement).catch(() => false);
  if (fsNow) await page.screenshot({ path: file, timeout: 10000 }).catch(() => {});
  else await page.locator('#gpa-root-host').screenshot({ path: file, timeout: 10000 }).catch(() => {});
}

// Draws the client's crash screen the way ClientMain.showCrashScreen does
// (its crash image plus a report div), to exercise crash detection.
const CRASH_JS = `(() => { const r = document.getElementById('game_frame'); const i = document.createElement('img');
  i.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAATEAAABxCAAAAACYIctsAAAACXBIWXMAAC4jAAAuIwF4pT92AAAAB3RJTUUH6AMMAyAVwaqINwAADutJREFUeNrtXCt75EiWPb1bn4cckRoSIrskRGZIiuySFLfQIv2ALG7zqiGD3HhtXoka6QfIZJYoSS9Rki0ikS2iWLBFdJHJDIgIpZSpfLir3eXqTwHstFKPiBP3ce6JkH';
  const d = document.createElement('div'); d.textContent = 'java.lang.RuntimeException: Test crash\\n\\tat net.minecraft.client.Minecraft.run';
  r.append(i, d); })()`;

const ctx = await newContext();
const page = await openConsole(ctx, HOST, { patch });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Target.setDiscoverTargets', { discover: true });
const workerTargets = async () => (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'worker').length;
// Count keys that reach the host page, to prove the game frame keeps them.
await page.evaluate(() => { window.__hostKeys = 0; window.addEventListener('keydown', () => { window.__hostKeys++; }, true); });

// ---- Interface ----------------------------------------------------------------
await step('tabs', async () => {
  const order = await R(page, (r) => [...r.querySelectorAll('.gpa-dropdown-item[data-tab]')].map((b) => b.dataset.tab));
  const i = order.indexOf('eaglercraft');
  check('Eaglercraft tab exists', i >= 0, order.join(' › '));
  check('Eaglercraft is immediately after Proxy', order[i - 1] === 'browser');
  check('Games remains right after Eaglercraft', order[i + 1] === 'games');
  const same = await R(page, (r) => {
    const a = r.querySelector('.gpa-dropdown-item[data-tab="eaglercraft"]'), b = r.querySelector('.gpa-dropdown-item[data-tab="browser"]');
    const ca = getComputedStyle(a), cb = getComputedStyle(b);
    return ['font-family', 'font-size', 'height', 'padding-left', 'border-radius', 'color', 'background-color'].every((k) => ca[k] === cb[k]) && a.className === b.className;
  });
  check('Eaglercraft nav item uses the same component and styles as Proxy', same);
  const bad = [];
  for (const t of ['welcome', 'scan', 'ask', 'chat', 'music', 'browser', 'games', 'study', 'notes', 'humanize', 'grammar', 'saved', 'theme', 'eaglercraft']) {
    await openTab(page, t);
    const ok = await R(page, (r, t) => r.querySelector(`.gpa-pane[data-pane="${t}"]`).classList.contains('active') && r.querySelectorAll('.gpa-pane.active').length === 1, t);
    if (!ok) bad.push(t);
  }
  check('Every tab still switches (14 tabs)', !bad.length, bad.join(','));
  check('No page errors so far', !(page._errors || []).length, (page._errors || []).join(' | '));
});

await step('launcher look', async () => {
  await openTab(page, 'eaglercraft');
  const look = await R(page, (r) => {
    const card = r.querySelector('.gpx-eag-launcher'), other = r.querySelector('.gpa-pane[data-pane="browser"] .gpa-card');
    const btn = r.querySelector('#gpa-eag-fs'), pbtn = r.querySelector('#gpa-proxy-go');
    const c1 = getComputedStyle(card), c2 = getComputedStyle(other), b1 = getComputedStyle(btn), b2 = getComputedStyle(pbtn);
    return {
      cardSame: ['background-color', 'border-top-color', 'border-radius', 'box-shadow', 'font-family'].every((k) => c1[k] === c2[k]),
      btnSame: ['background-color', 'color', 'border-radius', 'font-family', 'font-size', 'font-weight'].every((k) => b1[k] === b2[k]),
      font: c1.fontFamily, hero: !!r.querySelector('.gpx-hero[data-room="eaglercraft"] .gv-blocks')
    };
  });
  check('Launcher card matches existing cards (bg, border, radius, shadow, font)', look.cardSame, look.font);
  check('Enter Fullscreen matches the existing primary button', look.btnSame);
  check('Hero uses the shared room hero and scene', look.hero);
  await shot(page, '01-launcher-not-fullscreen');
});

// ---- Fullscreen gate ---------------------------------------------------------------
await step('gate', async () => {
  const st = await R(page, (r) => ({ here: r.querySelector('#gpa-eag-here').disabled, blank: r.querySelector('#gpa-eag-blank').disabled, gate: r.querySelector('#gpa-eag-gate').textContent, fs: !!r.fullscreenElement }));
  check('Not fullscreen: both launch buttons are disabled', st.here && st.blank && !st.fs, st.gate);
  // Force a click past the disabled state: nothing may start.
  await R(page, (r) => { const b = r.querySelector('#gpa-eag-here'); b.disabled = false; b.click(); b.disabled = true; });
  await wait(600);
  check('Forced launch while not fullscreen starts nothing', !eagFrame(page) && await R(page, (r) => !r.querySelector('#gpa-eag-view iframe')),
    await R(page, (r) => r.querySelector('#gpa-eag-error').textContent));
  await page.click('#gpa-eag-fs');
  const fs = await until(() => R(page, (r) => r.fullscreenElement && r.fullscreenElement.classList.contains('gpa-panel')));
  check('Enter Fullscreen puts the whole console (panel) in browser fullscreen', !!fs);
  await wait(250);   // fullscreenchange fires on the next animation frame
  const after = await R(page, (r) => ({ here: r.querySelector('#gpa-eag-here').disabled, blank: r.querySelector('#gpa-eag-blank').disabled, chip: r.querySelector('#gpa-eag-fs-chip').textContent, fsBtn: r.querySelector('#gpa-console-fullscreen').title }));
  check('Fullscreen: launch buttons enabled', !after.here && !after.blank, after.chip);
  check('Existing header fullscreen button now reads "Exit fullscreen"', after.fsBtn === 'Exit fullscreen', after.fsBtn);
  await shot(page, '02-launcher-fullscreen');
});

// ---- Launch Here ---------------------------------------------------------------------
let frame;
await step('launch here', async () => {
  const workersBefore = await workerTargets();
  await page.click('#gpa-eag-here');
  frame = await until(() => eagFrame(page));
  check('Frame created from the Worker (/eagler/)', !!frame, frame && frame.url());
  const started = await until(() => stub(frame, 'window.__stub && window.__stub.started && window.__stub.world && window.__stub.worker !== "pending" && window.__stub'), 15000);
  check('Client main() ran in the frame', !!started);
  check('WebGL 2.0 context created', started && /WebGL 2/.test(started.webgl), started && started.webgl);
  check('assets.epk loaded through the Worker', started && started.assets === 200);
  check('Singleplayer integrated-server Worker started from blob: (CSP allows it)', started && started.worker === 'ok', started && started.worker);
  check('World saved to IndexedDB (first open)', started && started.world && started.world.opens === 1, started && started.world);
  const st = await until(() => R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'playing' && r.querySelector('#gpa-eag-status').textContent));
  check('Console shows Running and the playing layout', st === 'Running', st);
  check('A dedicated worker exists for the integrated server', (await workerTargets()) > workersBefore);
  const fsStill = await R(page, (r) => r.fullscreenElement && r.fullscreenElement.classList.contains('gpa-panel'));
  check('Console still fullscreen while playing', !!fsStill);
  const layout = await R(page, (r) => { const f = r.querySelector('#gpa-eag-view iframe').getBoundingClientRect(); return { w: Math.round(f.width), h: Math.round(f.height), vw: innerWidth, vh: innerHeight }; });
  check('Game viewport fills the room under the existing header', layout.w > layout.vw * 0.9 && layout.h > layout.vh * 0.75, layout);
  await shot(page, '03-playing-here');
});

await step('input', async () => {
  const canvas = frame.locator('#game_frame canvas');
  await canvas.click({ position: { x: 200, y: 200 } });
  await wait(300);
  const s1 = await stub(frame, 'window.__stub');
  check('Mouse click reaches the game', s1.mouse >= 1);
  const locked = await until(() => stub(frame, 'window.__stub.locked'), 3000);
  check('Pointer lock acquired inside the frame', !!locked);
  const hostKeys0 = await page.evaluate(() => window.__hostKeys);
  await page.keyboard.press('w');
  await page.keyboard.press('a');
  await page.keyboard.press('Space');
  await wait(200);
  const keys = await stub(frame, 'window.__stub.keys');
  check('Keyboard reaches the game (w, a, Space)', ['w', 'a', ' '].every((k) => keys.includes(k)), keys.join(','));
  check('Host page / console saw none of those keys', (await page.evaluate(() => window.__hostKeys)) === hostKeys0);
  const kb = await page.evaluate(() => !!(navigator.keyboard && navigator.keyboard.lock));
  check('Keyboard Lock API present for Esc/Ctrl+W capture (behavior not observable headless)', kb);
});

await step('proxy path', async () => {
  // A server socket the game opens: through the shim, the Worker, to the echo server.
  const reply = await frame.evaluate((port) => new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    ws.onmessage = (e) => { res({ data: String(e.data), url: ws.url }); ws.close(); };
    ws.onerror = () => res({ error: true, url: ws.url });
    ws.onopen = () => ws.send('ping');
  }), env.echoPort);
  check('Server WebSocket round-trips through the Worker', reply.data === 'echo:ping', reply);
  check('Socket URL was rewritten to the Worker (/eagler/ws?url=…)', reply.url.startsWith(env.workerUrl.replace('http', 'ws') + '/eagler/ws?url='), reply.url);
  // The socket was closed right after the reply, so the row may already say
  // "closed"; what matters is that it recorded the path through the Worker.
  const net = await until(() => R(page, (r) => /Game → your Worker .* · (connected|closed)/.test(r.querySelector('#gpa-eag-net-list').textContent) && r.querySelector('#gpa-eag-net-list').textContent));
  check('“How it connects” lists the server path via the Worker', !!net, net);
  // Host not on the owner's list: the Worker refuses the upgrade.
  const refused = await frame.evaluate(() => new Promise((res) => { const ws = new WebSocket('ws://127.0.0.1:9/'); ws.onerror = () => res('error'); ws.onopen = () => res('open'); setTimeout(() => res('timeout'), 5000); }));
  check('Socket to a host the owner did not allow is refused', refused === 'error');
  const fileReqs = requests.filter((q) => q.url.startsWith('/client/') || q.url.startsWith('/loader/'));
  check('Every client/loader file was fetched by the Worker, not the browser', fileReqs.length > 0 && fileReqs.every((q) => !/Chrome/.test(q.ua)), fileReqs.map((q) => q.url + ' ← ' + (q.ua || '(no UA)')).slice(0, 6).join(' ; '));
});

// ---- Fullscreen exit while playing ----------------------------------------------------
await step('fullscreen exit', async () => {
  await page.evaluate(() => document.exitFullscreen());
  await until(() => R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'paused'));
  const ui = await R(page, (r) => ({ layout: r.querySelector('.gpx-eagler').dataset.eagler, gate: r.querySelector('#gpa-eag-gate').textContent, resume: r.querySelector('#gpa-eag-here span').textContent, stage: getComputedStyle(r.querySelector('#gpa-eag-stage')).display, frameAlive: !!r.querySelector('#gpa-eag-view iframe') }));
  check('Leaving fullscreen is detected and returns to the launcher', ui.layout === 'paused' && ui.stage === 'none', ui.gate);
  check('Launcher explains fullscreen is needed to resume', /fullscreen/.test(ui.gate) && /Resume/.test(ui.resume), ui.resume);
  const s = await stub(frame, 'window.__stub');
  check('Game released the mouse and opened its pause menu', !s.locked && s.paused);
  check('Game kept alive (not torn down) while paused', ui.frameAlive);
  const k0 = (await stub(frame, 'window.__stub.keys')).length;
  await page.keyboard.press('d');
  await wait(150);
  check('Keys no longer reach the game while paused', (await stub(frame, 'window.__stub.keys')).length === k0);
  await shot(page, '04-paused-after-fullscreen-exit');
  await page.click('#gpa-eag-here');   // Enter Fullscreen to Resume
  const back = await until(() => R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'playing' && !!r.fullscreenElement));
  check('Resume re-enters fullscreen and the game', !!back);
});

await step('tab switch', async () => {
  await openTab(page, 'games');
  const p = await R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler);
  check('Switching to Games pauses Eaglercraft', p === 'paused', p);
  await page.click('[data-game="snake"]');
  await wait(300);
  const games = await R(page, (r) => !!r.querySelector('#gpa-game-fit canvas, #gpa-game-fit *'));
  check('Games still loads a game', games);
  await openTab(page, 'eaglercraft');
  await page.click('#gpa-eag-here');
  const back = await until(() => R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'playing'));
  check('Back on Eaglercraft, Resume continues the same session', !!back && (await stub(frame, 'window.__stub.world.opens')) === 1);
});

await step('csp enforcement', async () => {
  // Bypass the loader's rewrite on purpose: the native WebSocket and a
  // direct fetch to the file host must both be refused by the frame's CSP.
  const direct = await frame.evaluate(([port, fport]) => new Promise((res) => {
    const seen = [];
    document.addEventListener('securitypolicyviolation', (e) => { seen.push(e.effectiveDirective + ' ' + e.blockedURI); });
    let ws = 'pending', fe = 'pending';
    const done = () => { if (ws !== 'pending' && fe !== 'pending') setTimeout(() => res({ ws, fetch: fe, seen }), 100); };
    try { const N = WebSocket.prototype.constructor; const s = new N(`ws://127.0.0.1:${port}/`); s.onopen = () => { ws = 'open'; done(); }; s.onerror = () => { ws = 'error'; done(); }; }
    catch (e) { ws = 'threw ' + e.name; done(); }
    fetch(`http://127.0.0.1:${fport}/client/classes.js`).then(() => { fe = 'loaded'; done(); }, () => { fe = 'refused'; done(); });
  }), [env.echoPort, env.filesPort]);
  check('A socket that skips the Worker is blocked by the frame CSP', direct.ws !== 'open' && direct.seen.some((x) => /^connect-src ws:/.test(x)), direct);
  check('A direct fetch that skips the Worker is blocked by the frame CSP', direct.fetch === 'refused' && direct.seen.some((x) => /^connect-src http:/.test(x)), direct.fetch);
  const row = await until(() => R(page, (r) => /Blocked/.test(r.querySelector('#gpa-eag-net-list').textContent) && r.querySelector('#gpa-eag-net-list').innerText));
  check('The console lists the blocked attempts and the game keeps running', !!row && await R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'playing'), row);
  await page.click('#gpa-eag-stop');
  await wait(400);
});

await step('stop + cleanup + persistence', async () => {
  const before = await workerTargets();
  check('Integrated-server worker ended with the frame', before === 0, `worker targets now: ${before}`);
  check('Pointer lock released on the page', await page.evaluate(() => !document.pointerLockElement));
  // Relaunch: the saved world must still be there.
  if (!(await R(page, (r) => !!r.fullscreenElement))) await page.click('#gpa-eag-fs');
  await until(() => R(page, (r) => !r.querySelector('#gpa-eag-here').disabled));
  await page.click('#gpa-eag-here');
  frame = await until(() => eagFrame(page));
  const w = await until(() => stub(frame, 'window.__stub && window.__stub.world'), 15000);
  check('World reloads from storage on relaunch (opens = 2)', w && w.opens === 2, w);
  await until(() => R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'playing'));
  await page.click('#gpa-eag-stop');
  await wait(400);
  const ui = await R(page, (r) => ({ frames: r.querySelectorAll('#gpa-eag-view iframe').length, layout: r.querySelector('.gpx-eagler').dataset.eagler, gate: r.querySelector('#gpa-eag-gate').textContent }));
  check('Stop removes the game DOM and returns to the launcher', ui.frames === 0 && ui.layout === 'idle', ui.gate);
  check('No eaglercraft frame left in the page', !eagFrame(page));
  check('No dedicated workers left after Stop', (await workerTargets()) === 0);
});

await step('crash here', async () => {
  await until(() => R(page, (r) => !r.querySelector('#gpa-eag-here').disabled));
  await page.click('#gpa-eag-here');
  frame = await until(() => eagFrame(page));
  await until(() => R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'playing'), 15000);
  await frame.evaluate(CRASH_JS);
  const msg = await until(() => R(page, (r) => r.querySelector('#gpa-eag-error').style.display !== 'none' && r.querySelector('#gpa-eag-error').textContent));
  check('Runtime crash is detected and explained; game DOM removed', /crashed/.test(msg || '') && /RuntimeException: Test crash/.test(msg || '') && await R(page, (r) => !r.querySelector('#gpa-eag-view iframe') && r.querySelector('.gpx-eagler').dataset.eagler === 'idle'), msg);
  check('No workers left after the crash', (await workerTargets()) === 0);
});

// ---- Theme ------------------------------------------------------------------------------
await step('theme', async () => {
  const bg = () => R(page, (r) => getComputedStyle(r.querySelector('.gpx-eag-launcher')).backgroundColor + ' / ' + getComputedStyle(r.querySelector('#gpa-eag-fs')).backgroundColor);
  const before = await bg();
  await R(page, (r) => r.querySelector('.gps-tile[data-theme="arctic"]').click());
  await wait(300);
  const after = await bg();
  check('Launcher follows the app theme (Arctic)', before !== after, before + ' → ' + after);
  await R(page, (r) => { r.querySelector('#gpa-eag-net').open = true; });
  await shot(page, '05-launcher-arctic-theme');
  await R(page, (r) => r.querySelector('.gps-tile[data-theme="dark"]').click());
  await wait(200);
});

// ---- about:blank -------------------------------------------------------------------------
await step('about:blank', async () => {
  await openTab(page, 'eaglercraft');
  if (!(await R(page, (r) => !!r.fullscreenElement))) await page.click('#gpa-eag-fs');
  await until(() => R(page, (r) => !r.querySelector('#gpa-eag-blank').disabled));
  const reqBefore = requests.length;
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#gpa-eag-blank')]);
  await wait(500);
  check('A new window opens at about:blank', popup.url() === 'about:blank', popup.url());
  const gate = await popup.evaluate(() => { const h = document.body.firstElementChild; const r = h && h.shadowRoot; return r && r.querySelector('.gpx-empty-title') && r.querySelector('.gpx-empty-title').textContent; });
  check('The window shows its own fullscreen gate first', /requires fullscreen/.test(gate || ''), gate);
  check('No game frame before fullscreen in the window', !popup.frames().some((f) => f.url().startsWith(env.workerUrl)));
  const look = await popup.evaluate(() => { const r = document.body.firstElementChild.shadowRoot; const b = r.querySelector('.gpx-empty .gpa-btn.primary'); const cs = getComputedStyle(b); return { bg: cs.backgroundColor, font: cs.fontFamily }; });
  const mainBtn = await R(page, (r) => getComputedStyle(r.querySelector('#gpa-eag-here')).backgroundColor);
  check('The window uses the console theme (primary button color matches)', look.bg === mainBtn, look);
  await popup.screenshot({ path: path.join(OUT, '06-about-blank-gate.png') });
  const main = await R(page, (r) => r.querySelector('#gpa-eag-gate').textContent);
  check('Console shows the about:blank session', /about:blank window/.test(main), main);
  await popup.locator('.gpx-empty .gpa-btn.primary').click();
  const pf = await until(() => popup.frames().find((f) => f.url().startsWith(env.workerUrl + '/eagler/')), 8000);
  check('After fullscreen in the window, the game frame loads from the Worker', !!pf, pf && pf.url());
  const s = await until(() => pf && stub(pf, 'window.__stub && window.__stub.world && window.__stub.worker !== "pending" && window.__stub'), 15000);
  check('Game runs in the about:blank window (WebGL 2, worker, storage)', s && /WebGL 2/.test(s.webgl) && s.worker === 'ok' && s.world, s && { webgl: s.webgl, worker: s.worker, world: s.world });
  const newReqs = requests.slice(reqBefore);
  check('about:blank resources also came through the Worker', newReqs.length > 0 && newReqs.every((q) => !/Chrome/.test(q.ua)), newReqs.map((q) => q.url).join(', '));
  await popup.bringToFront();
  await pf.locator('#game_frame canvas').click({ position: { x: 100, y: 100 } });
  await popup.keyboard.press('s');
  await wait(200);
  const s2 = await stub(pf, 'window.__stub');
  check('Mouse and keyboard work in the about:blank window', s2.mouse >= 1 && s2.keys.includes('s'));
  check('Pointer lock in the about:blank window', await until(() => stub(pf, 'window.__stub.locked'), 3000));
  await popup.screenshot({ path: path.join(OUT, '07-about-blank-playing.png') });
  // Leave fullscreen in the window: it pauses there.
  await popup.evaluate(() => document.exitFullscreen());
  const paused = await until(() => popup.evaluate(() => { const t = document.body.firstElementChild.shadowRoot.querySelector('.gpx-empty-title'); return t && t.textContent === 'Paused'; }));
  check('Leaving fullscreen in the window pauses it there', !!paused);
  check('…and the game in it released the mouse (its pause menu)', await until(() => stub(pf, '!window.__stub.locked && window.__stub.paused'), 3000));
  await popup.close();
  const after = await until(() => R(page, (r) => !r.querySelector('#gpa-eag-end').offsetParent && r.querySelector('#gpa-eag-gate').textContent.includes('closed') && r.querySelector('#gpa-eag-gate').textContent));
  check('Closing the window is detected; the console is back to the launcher', !!after, after);
  check('Main console still works after the window closed', await R(page, (r) => { r.querySelector('.gpa-dropdown-item[data-tab="scan"]').click(); return r.querySelector('.gpa-pane[data-pane="scan"]').classList.contains('active'); }));
  await openTab(page, 'eaglercraft');
});

await step('crash in about:blank', async () => {
  if (!(await R(page, (r) => !!r.fullscreenElement))) await page.click('#gpa-eag-fs');
  await until(() => R(page, (r) => !r.querySelector('#gpa-eag-blank').disabled));
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#gpa-eag-blank')]);
  await wait(400);
  await popup.locator('.gpx-empty .gpa-btn.primary').click();
  const pf = await until(() => popup.frames().find((f) => f.url().startsWith(env.workerUrl + '/eagler/')), 8000);
  await until(() => pf && stub(pf, 'window.__stub && window.__stub.started'), 15000);
  await wait(300);
  await pf.evaluate(CRASH_JS);
  const shown = await until(() => popup.evaluate(() => { const r = document.body.firstElementChild.shadowRoot; const t = r.querySelector('.gpx-empty-title'); return t && /couldn’t keep running/.test(t.textContent) && r.querySelector('.gpx-empty-desc').textContent; }));
  check('Crash in the about:blank window: the error stays in that window', !!shown && /Test crash/.test(shown) && !popup.isClosed(), shown);
  check('…the game frame is gone from it', !popup.frames().some((f) => f.url().startsWith(env.workerUrl)));
  check('…and the console shows it too, back on the launcher', await R(page, (r) => /crashed/.test(r.querySelector('#gpa-eag-error').textContent) && r.querySelector('.gpx-eagler').dataset.eagler === 'idle'));
  await popup.screenshot({ path: path.join(OUT, '09-about-blank-crash.png') });
  await popup.locator('.gpx-empty .gpa-btn').click();
  await until(() => popup.isClosed(), 3000);
  check('“Close this window” closes it', popup.isClosed());
});

await step('popup blocked', async () => {
  if (!(await R(page, (r) => !!r.fullscreenElement))) await page.click('#gpa-eag-fs');
  await until(() => R(page, (r) => !r.querySelector('#gpa-eag-blank').disabled));
  await page.evaluate(() => { window.__open = window.open; window.open = () => null; });
  await page.click('#gpa-eag-blank');
  const msg = await until(() => R(page, (r) => r.querySelector('#gpa-eag-error').textContent));
  check('A blocked pop-up gets a clear error', /blocked the about:blank window/.test(msg || ''), msg);
  await page.evaluate(() => { window.open = window.__open; });
});

check('No uncaught page errors in the console page', !(page._errors || []).length, (page._errors || []).join(' | '));
await ctx.close();

// ---- Errors: no WebGL 2, client missing, Worker unreachable -------------------------------
await step('no webgl', async () => {
  const c = await newContext();
  await c.addInitScript(() => {
    if (location.pathname.startsWith('/eagler')) {
      const g = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (t, o) { return t === 'webgl2' ? null : g.call(this, t, o); };
    }
  });
  const p = await openConsole(c, HOST, { patch });
  await openTab(p, 'eaglercraft');
  await p.click('#gpa-eag-fs');
  await until(() => R(p, (r) => !r.querySelector('#gpa-eag-here').disabled));
  await p.click('#gpa-eag-here');
  const msg = await until(() => R(p, (r) => r.querySelector('#gpa-eag-error').style.display !== 'none' && r.querySelector('#gpa-eag-error').textContent), 10000);
  check('No WebGL 2.0: clear error, back to launcher', /WebGL 2\.0/.test(msg || '') && await R(p, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'idle'), msg);
  await c.close();
});

const env2 = await startEnv({ relay: false, extraEnv: { EAGLER_CLIENT: '' } });
await step('client not configured', async () => {
  const c = await newContext();
  const p = await openConsole(c, HOST, { patch: (code) => code.split('https://donnajbe.viztrrx.workers.dev').join(env2.workerUrl) });
  await openTab(p, 'eaglercraft');
  await p.click('#gpa-eag-fs');
  await until(() => R(p, (r) => !r.querySelector('#gpa-eag-here').disabled));
  await p.click('#gpa-eag-here');
  const msg = await until(() => R(p, (r) => r.querySelector('#gpa-eag-error').textContent));
  check('Worker without EAGLER_CLIENT: clear error, nothing loaded', /EAGLER_CLIENT/.test(msg || '') && !(await R(p, (r) => !!r.querySelector('#gpa-eag-view iframe'))), msg);
  await c.close();
});
await env2.close();

await step('worker unreachable', async () => {
  const c = await newContext();
  const p = await openConsole(c, HOST, { patch: (code) => code.split('https://donnajbe.viztrrx.workers.dev').join('http://127.0.0.1:9') });
  await openTab(p, 'eaglercraft');
  await p.click('#gpa-eag-fs');
  await until(() => R(p, (r) => !r.querySelector('#gpa-eag-here').disabled));
  await p.click('#gpa-eag-here');
  const msg = await until(() => R(p, (r) => r.querySelector('#gpa-eag-error').style.display !== 'none' && r.querySelector('#gpa-eag-error').textContent), 25000, 250);
  check('Worker unreachable: frame load times out with a clear error', /didn’t load from your Worker/.test(msg || ''), msg);
  check('Console keeps working after the failure', await R(p, (r) => { r.querySelector('.gpa-dropdown-item[data-tab="games"]').click(); return r.querySelector('.gpa-pane[data-pane="games"]').classList.contains('active'); }));
  await c.close();
});

// ---- Shared World across two separate browsers ---------------------------------------------
if (env.relayProc) {
  await step('shared world', async () => {
    const b2 = await launch({ args: BROWSER_ARGS });
    const devices = [];
    for (const [i, br] of [[0, browser], [1, b2]]) {
      const c = await newContext(br);
      const p = await openConsole(c, HOST, { patch, user: 'player' + (i + 1) });
      await openTab(p, 'eaglercraft');
      await p.click('#gpa-eag-fs');
      await until(() => R(p, (r) => !r.querySelector('#gpa-eag-here').disabled));
      await p.click('#gpa-eag-here');
      const f = await until(() => eagFrame(p));
      await until(() => stub(f, 'window.__stub && window.__stub.started'), 15000);
      devices.push({ c, p, f });
    }
    const relayUrl = `ws://127.0.0.1:${env.relayPort}/`;
    const code = await devices[0].f.evaluate((u) => window.__stub.hostWorld(u), relayUrl);
    check('Player A opened a Shared World through the Worker → relay (join code)', /^[a-z0-9]{5}$/.test(code || ''), code);
    const got = await devices[1].f.evaluate(([u, c]) => Promise.race([window.__stub.joinWorld(u, c), new Promise((res) => setTimeout(() => res('join timeout'), 20000))]), [relayUrl, code]);
    fs.writeFileSync(path.join(OUT, 'relay.log'), env.relayProc.log);
    if (got !== 'welcome from host') console.log('host log', await stub(devices[0].f, 'window.__stub.share'), 'join log', await stub(devices[1].f, 'window.__stub.share'));
    check('Player B joined with the code; data channel carries game data both ways', got === 'welcome from host' && (await stub(devices[0].f, 'window.__stub.share.hostGot')) === 'hello from joiner', got);
    const netA = await until(() => R(devices[0].p, (r) => /Shared World player/.test(r.querySelector('#gpa-eag-net-list').textContent) && /Directly/.test(r.querySelector('#gpa-eag-net-list').textContent) && r.querySelector('#gpa-eag-net-list').innerText), 8000);
    const netB = await until(() => R(devices[1].p, (r) => /Shared World player/.test(r.querySelector('#gpa-eag-net-list').textContent) && r.querySelector('#gpa-eag-net-list').innerText), 8000);
    check('A’s console: relay via Worker, player link direct (not via Worker)', !!netA && /Shared World relay/.test(netA), netA);
    check('B’s console shows the same honest path', !!netB && /Shared World relay/.test(netB), netB);
    fs.writeFileSync(path.join(OUT, 'shared-world-net.txt'), `A:\n${netA}\n\nB:\n${netB}\n`);
    // Who is actually connected to the relay's port: workerd, never Chromium.
    const owners = socketOwners(env.relayPort);
    fs.writeFileSync(path.join(OUT, 'relay-sockets.txt'), owners.map((o) => `${o.local} -> ${o.remote}  ${o.proc}`).join('\n') + '\n');
    const procs = [...new Set(owners.map((o) => o.proc))];
    check('Only workerd and the relay hold relay-port sockets (no browser→relay socket)', owners.length > 0 && procs.every((n) => /workerd|java/.test(n)), procs.join(', '));
    await R(devices[0].p, (r) => { r.querySelector('#gpa-eag-net').open = true; });
    await devices[0].p.screenshot({ path: path.join(OUT, '08-shared-world-host.png'), timeout: 10000 }).catch(() => {});
    for (const d of devices) await d.c.close();
    await b2.close();
  });
} else {
  check('Shared World test skipped (set RELAY_JAR)', true, 'skipped');
}

await browser.close();
await env.close();
await host.close();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
