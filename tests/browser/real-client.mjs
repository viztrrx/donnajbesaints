// Checks the Eaglercraft tab against a REAL EaglercraftX 1.8 JavaScript build
// that you supply. Nothing here is a stand-in: point it at your own build
// folder (the one CompileLatestClient produced, holding classes.js,
// assets.epk and lang/).
//
//   npm install    # once: Wrangler, which runs worker.js locally
//   EAGLER_CLIENT_DIR=/path/to/your/build node tests/browser/real-client.mjs [outDir]
//
// It serves that folder as EAGLER_CLIENT through worker.js in workerd, opens
// the console, enters fullscreen, launches the game in the tab and waits for
// the client to start and draw. It saves screenshots so you can see the
// title screen. Playing (singleplayer, servers, Shared Worlds) is still up
// to you; this only proves the build loads through the existing integration.
import fs from 'node:fs';
import path from 'node:path';
import { launch, openConsole, openTab, serve, HOST_PAGE } from './harness.mjs';

const dir = process.env.EAGLER_CLIENT_DIR ? path.resolve(process.env.EAGLER_CLIENT_DIR) : '';
const OUT = process.argv[2] || 'eagler-real-client-out';
const need = ['classes.js', 'assets.epk'];
if (!dir) { console.error('Set EAGLER_CLIENT_DIR to your EaglercraftX 1.8 build folder (it must contain ' + need.join(' and ') + ').'); process.exit(2); }
const STUB_CLIENT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'fixtures/stub-client');
if (dir === STUB_CLIENT_DIR && process.env.ALLOW_STUB !== '1') { console.error('That is the stand-in test client, not a real build.'); process.exit(2); }
const missing = need.filter((f) => !fs.existsSync(path.join(dir, f)));
if (missing.length) { console.error(`${dir} is missing ${missing.join(', ')}. Use the build OUTPUT folder, not the source repository.`); process.exit(2); }
if (!fs.existsSync(path.join(dir, 'lang'))) console.warn('Note: no lang/ folder. English works without it; other languages need it.');
fs.mkdirSync(OUT, { recursive: true });
// Loaded only now, so a wrong folder is reported before Wrangler starts.
const { startEnv } = await import('./env.mjs');

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, every = 250) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } await wait(every); } return null; }
const R = (page, fn) => page.evaluate((f) => new Function('r', 'return (' + f + ')(r)')(document.getElementById('gpa-root-host').shadowRoot), fn.toString());

const env = await startEnv({ relay: false, clientDir: dir });
const host = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE); });
const browser = await launch();
try {
  const status = await (await fetch(env.workerUrl + '/eagler/status')).json();
  check('/eagler/status: client configured and reachable', status.clientConfigured && status.clientReachable, status.client);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route('**/*', (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
  const page = await openConsole(ctx, `http://127.0.0.1:${host.port}/`, { patch: (c) => c.split('https://donnajbe.viztrrx.workers.dev').join(env.workerUrl) });
  const frameLog = [];
  page.on('console', (m) => { if (m.text().includes('[')) frameLog.push(m.text()); });
  await openTab(page, 'eaglercraft');
  await page.click('#gpa-eag-fs');
  await until(() => R(page, (r) => !r.querySelector('#gpa-eag-here').disabled), 5000);
  await page.click('#gpa-eag-here');
  const started = await until(() => R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'playing' || (r.querySelector('#gpa-eag-error').style.display !== 'none' && 'error')), 60000);
  const err = await R(page, (r) => r.querySelector('#gpa-eag-error').style.display !== 'none' ? r.querySelector('#gpa-eag-error').textContent : '');
  check('The real client loaded and main() started (tab shows Running)', started === true, err);
  const frame = page.frames().find((f) => f.url().startsWith(env.workerUrl + '/eagler/'));
  // Give it time to load assets.epk and reach the title screen.
  await wait(Number(process.env.WAIT_MS || 30000));
  const state = frame ? await frame.evaluate(() => ({
    canvas: !!document.querySelector('#game_frame canvas'),
    crash: !!document.querySelector('#crashReason, #game_frame img[src^="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAATEAAABx"]'),
    opts: typeof window.eaglercraftXOpts === 'object'
  })) : null;
  check('Game canvas present, no crash screen after load', state && state.canvas && !state.crash, state);
  check('Still running (no error reported to the console)', await R(page, (r) => r.querySelector('.gpx-eagler').dataset.eagler === 'playing'));
  await page.screenshot({ path: path.join(OUT, 'real-client-title.png') });
  fs.writeFileSync(path.join(OUT, 'frame-console.txt'), frameLog.join('\n'));
  console.log(`Screenshot: ${path.join(OUT, 'real-client-title.png')} — look for the Minecraft title screen.`);
} finally {
  await browser.close(); await env.close(); await host.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed (client folder: ${dir}${dir === STUB_CLIENT_DIR ? ' — the STAND-IN, not a real build' : ''})`);
process.exit(failed ? 1 : 0);
