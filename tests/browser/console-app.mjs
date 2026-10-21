// The Saints Service home-screen web app (/console/) on an emulated iPhone,
// against worker.js running in workerd.
//   node tests/browser/console-app.mjs [outDir]
// The Worker fetches script.js from a local file host (CONSOLE_SCRIPT_URL),
// so this checks the repo's own script.js, never GitHub.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'console-app-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const scriptHost = await serve((rq, rs) => {
  if (rq.url !== '/script.js') { rs.statusCode = 404; rs.end(); return; }
  rs.setHeader('Content-Type', 'text/plain');   // like raw.githubusercontent.com
  rs.end(fs.readFileSync(path.join(ROOT, 'script.js')));
});
const env = await startEnv({ extraEnv: { CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);

async function signIn(page) {
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  const sr = (sel) => `#gpa-root-host >> ${sel}`;
  await page.fill(sr('#gpa-login-user'), 'iphone');
  await page.fill(sr('#gpa-login-pin'), '123456');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display === 'none');
  const lang = page.locator(sr('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'));
  if (await lang.isVisible().catch(() => false)) await lang.click();
}

try {
  // ---- Opened from the Home Screen ("Open as Web App") ----
  const iphone = devices['iPhone 15'] || devices['iPhone 14'];
  const ctx = await browser.newContext({ ...iphone, serviceWorkers: 'allow' });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); });
  // The app talks to this test Worker (in production that's the default
  // address). Signing in needs a Worker that answers: it never opens without one.
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  check('Shell has the iOS home-screen tags', await page.evaluate(() =>
    !!document.querySelector('meta[name="apple-mobile-web-app-capable"][content="yes"]') &&
    !!document.querySelector('link[rel="apple-touch-icon"]') && /viewport-fit=cover/.test(document.querySelector('meta[name="viewport"]').content)));
  await signIn(page);
  check('Console starts from /console/script.js in app mode', await R(page, (r) => r.querySelector('.gpa-panel').classList.contains('gpa-app')));
  check('Loading splash is gone', await page.evaluate(() => !document.getElementById('boot')));
  const vp = page.viewportSize();
  const box = await R(page, (r) => { const b = r.querySelector('.gpa-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  check('Console fills the screen edge to edge', box.x === 0 && box.y === 0 && Math.abs(box.w - vp.width) <= 1 && Math.abs(box.h - vp.height) <= 1, JSON.stringify(box));
  check('No close or collapse button (nothing underneath)', await R(page, (r) => ['#gpa-close', '#gpa-min'].every((s) => getComputedStyle(r.querySelector(s)).display === 'none')));
  check('No rounded window corners', await R(page, (r) => getComputedStyle(r.querySelector('.gpa-panel')).borderTopLeftRadius === '0px'));
  check('Text fields are 16px (no iOS zoom on focus)', await R(page, (r) => [...r.querySelectorAll('.gpa-pane.active input, .gpa-pane.active textarea, input.gpa-input')].filter((e) => e.offsetParent).every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16)));
  check('Header buttons are 44px tap targets', await R(page, (r) => ['#gpa-sidebar-toggle', '#gpa-reload', '#gpa-console-fullscreen'].every((s) => r.querySelector(s).getBoundingClientRect().height >= 44)));
  await page.screenshot({ path: path.join(OUT, '01-welcome.png') });

  // Navigation works: sidebar as a drawer, tabs switch, no sideways scroll.
  await R(page, (r) => r.querySelector('#gpa-sidebar-toggle').click());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '02-sidebar.png') });
  let overflow = [];
  for (const tab of ['ask', 'chat', 'music', 'games', 'eaglercraft', 'study', 'saved', 'theme']) {
    await R(page, (r, t) => r.querySelector(`.gpa-dropdown-item[data-tab="${t}"]`).click(), tab);
    await page.waitForTimeout(350);
    const o = await R(page, (r) => { const m = r.querySelector('#gpa-main'); return m.scrollWidth - m.clientWidth; });
    if (o > 1) overflow.push(tab + ' +' + o);
    if (tab === 'ask' || tab === 'chat') await page.screenshot({ path: path.join(OUT, `03-${tab}.png`) });
  }
  check('Every tab opens with no sideways scroll', overflow.length === 0, overflow.join(', '));

  // Rotated to landscape it still fills the screen.
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(400);
  const land = await R(page, (r) => { const b = r.querySelector('.gpa-panel').getBoundingClientRect(); return { w: b.width, h: b.height }; });
  check('Landscape fills the screen too', Math.abs(land.w - vp.height) <= 1 && Math.abs(land.h - vp.width) <= 1, JSON.stringify(land));
  await page.setViewportSize(vp);

  // Reload button restarts the app (page reload), console comes back signed in.
  await Promise.all([page.waitForEvent('load'), R(page, (r) => r.querySelector('#gpa-reload').click())]);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  check('Reload button restarts the app', true);
  check('Still signed in after a restart', await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display === 'none', null, { timeout: 10000 }).then(() => true, () => false));

  // Offline launch: the service worker kept the shell and the script.
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = await page.evaluate(async () => { const name = (await caches.keys()).find((k) => k.startsWith('agent-console-app-')); return name ? (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname) : []; });
  check('Service worker cached the shell and the console script', cached.includes('/console/') && cached.includes('/console/script.js'), cached.join(' '));
  check('Nothing but app files is cached', cached.every((p) => p.startsWith('/console/')));
  await ctx.setOffline(true);
  await page.reload();
  check('Opens offline from the Home Screen', await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 15000 }).then(() => true, () => false));
  await page.screenshot({ path: path.join(OUT, '04-offline.png') });
  await ctx.setOffline(false);
  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();

  // ---- First visit in Safari: install instructions, then continue ----
  const safari = await browser.newContext({ ...iphone });
  const sp = await safari.newPage();
  await sp.goto(env.workerUrl + '/console/');
  const shown = await sp.locator('#install').isVisible();
  check('Safari (not installed) shows Add to Home Screen steps', shown);
  await sp.screenshot({ path: path.join(OUT, '05-install-steps.png') });
  await sp.click('#install-continue');
  check('“Continue in the browser” starts the console', await sp.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 }).then(() => true, () => false));
  await sp.reload();
  check('Install steps are not shown again', await sp.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 }).then(async () => !(await sp.locator('#install').isVisible().catch(() => false)), () => false));
  await safari.close();

  // ---- Desktop browser: no install prompt, console starts directly ----
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dp = await desk.newPage();
  await dp.goto(env.workerUrl + '/console/');
  check('Desktop browser starts the console directly', await dp.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 }).then(() => true, () => false));
  await desk.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);
