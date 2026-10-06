// Shared Playwright harness for the browser checks in this folder.
// Serves a blank page on 127.0.0.1, injects script.js the way the bookmarklet
// does, and signs in with a fresh local profile. Requests to any other host
// are refused unless a test routes them, so runs are repeatable offline.
//   Needs Playwright: npx playwright (or a global install) + Chromium.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) { /* try next */ }
  }
  throw new Error('Playwright is not installed (npm i -g playwright).');
}
export const { chromium } = loadPlaywright();
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, close: () => new Promise((r) => srv.close(r)) }));
  });
}

export const HOST_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Host page</title></head>'
  + '<body style="font:16px serif;margin:40px"><h1>Some ordinary page</h1><p>The console gets injected here.</p></body></html>';

export async function launch(opts = {}) {
  return chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    ...opts
  });
}

// Opens the host page and injects script.js (optionally rewritten by `patch`).
export async function openConsole(context, hostUrl, { patch, user = 'tester', pin = '123456' } = {}) {
  const page = await context.newPage();
  page.on('pageerror', (e) => { (page._errors || (page._errors = [])).push(String(e && e.stack || e)); });
  await page.goto(hostUrl);
  let code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  if (patch) code = patch(code);
  await page.evaluate((c) => { (0, eval)(c); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  const sr = (sel) => `#gpa-root-host >> ${sel}`;
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), pin);
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForFunction(() => {
    const r = document.getElementById('gpa-root-host').shadowRoot;
    return r.querySelector('#gpa-login').style.display === 'none';
  });
  const lang = page.locator(sr('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'));
  if (await lang.isVisible().catch(() => false)) await lang.click();
  return page;
}

export async function openTab(page, tab) {
  await page.evaluate((t) => {
    const r = document.getElementById('gpa-root-host').shadowRoot;
    r.querySelector(`.gpa-dropdown-item[data-tab="${t}"]`).click();
  }, tab);
  await page.waitForTimeout(450);   // pane-in animation
}

export function refuseExternal(context, allow = []) {
  return context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || allow.some((a) => u.host === a)) return route.continue();
    return route.abort('blockedbyclient');
  });
}
