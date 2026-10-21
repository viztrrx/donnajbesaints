// The Saints Service home-screen web app served by the Worker at /console/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import assets from '../web/console/assets.generated.js';
import { consoleApp, CONSOLE_SCRIPT_SRC } from '../web/console/handler.js';

const base = 'https://fixture.example';
const get = (path, init) => consoleApp(new Request(base + path, init), {});
const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
};

test('console app: shell is an iOS home-screen web app', async () => {
  const r = await get('/console/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /text\/html/);
  assert.equal(r.headers.get('X-Frame-Options'), 'DENY');
  const html = await r.text();
  for (const re of [/name="apple-mobile-web-app-capable" content="yes"/, /viewport-fit=cover/,
    /rel="apple-touch-icon" href="\/console\/icon-180.png"/, /rel="manifest" href="\/console\/manifest.webmanifest"/,
    /apple-mobile-web-app-title" content="Saints Service"/]) assert.match(html, re);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline scripts');
});

test('console app: manifest, icons and service worker', async () => {
  const m = await (await get('/console/manifest.webmanifest')).json();
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/console/');
  assert.equal(m.scope, '/console/');
  for (const icon of m.icons) {
    const r = await get(icon.src);
    assert.equal(r.status, 200, icon.src);
    assert.equal(r.headers.get('Content-Type'), 'image/png');
    const bytes = new Uint8Array(await r.arrayBuffer());
    assert.deepEqual([...bytes.slice(1, 4)], [80, 78, 71], icon.src + ' is a PNG');
    const size = new DataView(bytes.buffer).getUint32(16);
    assert.equal(size + 'x' + size, icon.sizes);
  }
  assert.equal((await get('/console/icon-180.png')).status, 200);
  const sw = await get('/console/sw.js');
  assert.equal(sw.headers.get('Service-Worker-Allowed'), '/console/');
  assert.match(await sw.text(), /\/console\/script\.js/);
});

test('console app: routing edges', async () => {
  const r = await get('/console');
  assert.equal(r.status, 308);
  assert.equal(r.headers.get('Location'), '/console/');
  assert.equal((await get('/console/nope.js')).status, 404);
  assert.equal((await get('/console/', { method: 'POST', body: '{}' })).status, 405);
  assert.equal(await get('/consoles/'), null);
  assert.equal(await get('/app/'), null);
});

test('console app: script.js is the repo script, served as JavaScript', async () => {
  let asked = null;
  const r = await withFetch(async (u) => { asked = String(u); return new Response('/* c */\n(function () { window.x = 1; })();'); }, () => get('/console/script.js'));
  assert.equal(asked, CONSOLE_SCRIPT_SRC);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /text\/javascript/);
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  const pinned = await withFetch(async (u) => { asked = String(u); return new Response('(function () {})();'); },
    () => consoleApp(new Request(base + '/console/script.js'), { CONSOLE_SCRIPT_URL: 'https://example.org/fork.js' }));
  assert.equal(pinned.status, 200);
  assert.equal(asked, 'https://example.org/fork.js');
});

test('console app: a failed or wrong upstream is never served as code', async () => {
  assert.equal((await withFetch(async () => new Response('Not Found', { status: 404 }), () => get('/console/script.js'))).status, 502);
  assert.equal((await withFetch(async () => new Response('<!doctype html><p>error</p>'), () => get('/console/script.js'))).status, 502);
  assert.equal((await withFetch(async () => { throw new Error('offline'); }, () => get('/console/script.js'))).status, 502);
});

test('console app: bundle matches web/console/public (run npm run build:web)', async () => {
  const folder = new URL('../web/console/public/', import.meta.url);
  for (const file of await readdir(folder)) {
    const key = '/console/' + (file === 'index.html' ? '' : file);
    const binary = file.endsWith('.png');
    assert.equal(assets[key].body, await readFile(new URL(file, folder), binary ? 'base64' : 'utf8'), key + ' is stale');
  }
});

test('console app: the real script.js passes the shell sanity check and has app mode', async () => {
  const code = await readFile(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(code, /^[\s\S]{0,20000}\(function\s*\(\)/);
  assert.match(code, /window\.__agentConsoleApp === true/);
});
