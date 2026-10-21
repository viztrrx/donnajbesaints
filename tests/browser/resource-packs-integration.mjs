// Check both console launch modes and nonfatal optional-pack failures through
// the actual Worker route. Uses the stand-in game; real u35 UI checked separately.
import assert from 'node:assert/strict';
import { launch, openConsole, openTab, serve, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';
const env = await startEnv({ relay: false });
const host = await serve((req, res) => res.end(HOST_PAGE));
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const page = await openConsole(ctx, `http://127.0.0.1:${host.port}/`, { patch: code => code.replaceAll('https://donnajbe.viztrrx.workers.dev', env.workerUrl) });
  await openTab(page, 'eaglercraft');
  await page.click('#gpa-eag-fs');
  await page.click('#gpa-eag-here');
  await page.waitForFunction(() => /is active/.test(document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-eag-pack').textContent));
  const frame = page.frames().find(f => f.url().startsWith(env.workerUrl + '/eagler/'));
  await frame.waitForFunction(() => window.__stub && window.__stub.started);
  assert.match(await page.locator('#gpa-eag-performance').textContent(), /preset applied/);
  assert.deepEqual(page._errors || [], []);
  await page.click('#gpa-eag-stop');
  await page.click('#gpa-eag-auto-pack');
  assert.equal(await page.locator('#gpa-eag-auto-pack').getAttribute('aria-pressed'),'false');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.click('#gpa-eag-blank')]);
  await Promise.all([popup.waitForEvent('framenavigated', { predicate: f => f.url().startsWith(env.workerUrl + '/eagler/') }), popup.locator('.gpx-empty .gpa-btn.primary').click()]);
  const pf = popup.frames().find(f => f.url().startsWith(env.workerUrl + '/eagler/'));
  await pf.waitForFunction(() => window.__stub && window.__stub.started);
  assert.match(await page.locator('#gpa-eag-performance').textContent(), /preset applied/);
  const state = await pf.evaluate(() => window.eaglerPreloadResourcePacks('resourcePacks'));
  assert.equal(state, 'available');
  assert.equal(new URL(pf.url()).searchParams.get('autoPack'),'0');
  assert.match(await page.locator('#gpa-eag-pack').textContent(), /Automatic selection is off/);
  assert.deepEqual(page._errors || [], []);
  await popup.close();
  console.log('PASS bundled pack available in both launch modes, no launcher page errors');

  // A fresh page with storage blocked must still run the game and report the
  // optional pack failure to its embedding parent.
  const failure = await ctx.newPage();
  await failure.addInitScript(() => {
    window.__packMessages = [];
    window.addEventListener('message', e => { if (['resourcepack', 'performance'].includes(e.data?.type)) window.__packMessages.push(e.data); });
    Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Test storage denied', 'SecurityError'); } });
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Test storage denied', 'SecurityError'); } });
  });
  await failure.goto(`http://127.0.0.1:${host.port}/`);
  await failure.evaluate(url => { const f = document.createElement('iframe'); f.src = url; document.body.appendChild(f); }, env.workerUrl + '/eagler/');
  await failure.waitForFunction(() => window.__packMessages.some(m => m.state === 'unavailable'));
  const ff = failure.frames().find(f => f.url().startsWith(env.workerUrl + '/eagler/'));
  await ff.waitForFunction(() => window.__stub && window.__stub.started);
  assert.equal(await failure.evaluate(() => window.__packMessages.some(m => m.type === 'performance' && m.state === 'unavailable')), true);
  console.log('PASS storage denied: client still starts and parent receives pack-unavailable message');
  const corrupt = await ctx.newPage();
  await corrupt.addInitScript(() => {
    window.__packMessages = [];
    window.addEventListener('message', e => { if (e.data?.type === 'resourcepack') window.__packMessages.push(e.data); });
    if (location.pathname.startsWith('/eagler/')) localStorage.setItem('_eaglercraftX.g', 'broken');
  });
  await corrupt.goto(`http://127.0.0.1:${host.port}/`);
  await corrupt.evaluate(url => { const f = document.createElement('iframe'); f.src = url; document.body.appendChild(f); }, env.workerUrl + '/eagler/?autoPack=1');
  await corrupt.waitForFunction(() => window.__packMessages.some(m => m.state === 'selection-failed'));
  const cf = corrupt.frames().find(f => f.url().startsWith(env.workerUrl + '/eagler/'));
  await cf.waitForFunction(() => window.__stub && window.__stub.started);
  assert.equal(await cf.evaluate(() => localStorage.getItem('_eaglercraftX.g')), 'broken');
  console.log('PASS corrupt selection settings: installed pack remains available, previous record kept, client starts');
} finally {
  await browser.close(); await env.close(); await host.close();
}
