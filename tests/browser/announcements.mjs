// Owner banner and announcement popup in the home-screen app on an emulated
// iPhone, against worker.js in workerd: both are tappable, and a dismissal
// survives a reload and a fresh device (it is stored for the account).
//   node tests/browser/announcements.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'announcements-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const BANNER = 'kj and whoever "dub" is has to pay';
// The local Worker's KV persists between runs, and dismissals are remembered
// per account, so every run signs in as a new user.
const USER = 'dana' + Date.now().toString(36).slice(-5);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const ownerSays = (body) => fetch(env.workerUrl + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const iphone = devices['iPhone 15'] || devices['iPhone 14'];
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);

async function openApp() {
  const ctx = await browser.newContext({ ...iphone });
  await ctx.addInitScript((u) => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ }
  }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  const sr = (sel) => `#gpa-root-host >> ${sel}`;
  if (await page.locator(sr('#gpa-login')).isVisible()) {
    await page.fill(sr('#gpa-login-user'), USER);
    await page.fill(sr('#gpa-login-pin'), '123456');
    await page.click(sr('#gpa-signup-btn'));
    await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display === 'none');
  }
  // The language picker can sit under the popup on first sign-in.
  await page.waitForTimeout(500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return { ctx, page };
}
// Taps the element's centre like a finger and reports what was under it.
async function tapCenter(page, sel) {
  const p = await R(page, (r, s) => { const b = r.querySelector(s).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
  const hit = await R(page, (r, a) => { const e = r.elementFromPoint(a.x, a.y); return e ? (e.closest(a.s) ? 'target' : (e.className || e.tagName)) : 'nothing'; }, { ...p, s: sel });
  await page.touchscreen.tap(p.x, p.y);
  return hit;
}
const shown = (page, sel) => R(page, (r, s) => !!r.querySelector(s), sel);

try {
  const sent = await ownerSays({ broadcast: BANNER, announcement: { title: 'Heads up', text: 'Rent is due Friday.' } });
  check('Owner posts a banner and a popup', sent && !sent.error, JSON.stringify(sent).slice(0, 80));

  // ---- First open: popup, then the banner ----
  let { ctx, page } = await openApp();
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-ann-backdrop'), null, { timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, '01-popup.png') });
  check('Popup appears', true);
  check('“Got it” is tappable', (await tapCenter(page, '.gpa-ann-ok')) === 'target');
  await page.waitForTimeout(300);
  check('Popup closes', !(await shown(page, '.gpa-ann-backdrop')));

  await page.waitForFunction(() => !!document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-broadcast'), null, { timeout: 20000 });
  const geo = await R(page, (r) => ({ banner: r.querySelector('.gpa-broadcast').getBoundingClientRect().top, header: r.querySelector('.gpa-header').getBoundingClientRect().bottom, x: r.querySelector('.gpa-broadcast-x').getBoundingClientRect().height }));
  check('Banner sits below the header, not under the status bar', geo.banner >= geo.header - 1, JSON.stringify(geo));
  check('Banner close button is a 44px tap target', geo.x >= 44, geo.x + 'px');
  check('Banner shows the owner’s message', (await R(page, (r) => r.querySelector('.gpa-broadcast-text').textContent)) === BANNER);
  await page.screenshot({ path: path.join(OUT, '02-banner.png') });
  check('Banner ✕ is tappable', (await tapCenter(page, '.gpa-broadcast-x')) === 'target');
  await page.waitForTimeout(300);
  check('Banner closes', !(await shown(page, '.gpa-broadcast')));
  await page.waitForTimeout(800);   // let the dismissal reach the Worker

  // ---- Reload: neither comes back ----
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.waitForTimeout(4000);
  check('After a reload the banner stays dismissed', !(await shown(page, '.gpa-broadcast')));
  check('After a reload the popup stays dismissed', !(await shown(page, '.gpa-ann-backdrop')));
  check('No page errors', page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
  await ctx.close();

  // ---- Fresh device / another site: the account remembers ----
  ({ ctx, page } = await openApp());
  await page.waitForTimeout(5000);
  check('On a fresh device the banner stays dismissed', !(await shown(page, '.gpa-broadcast')));
  check('On a fresh device the popup stays dismissed', !(await shown(page, '.gpa-ann-backdrop')));
  await page.screenshot({ path: path.join(OUT, '03-after.png') });

  // ---- A new message from the owner does show ----
  await ownerSays({ broadcast: 'Movie night Saturday' });
  await page.waitForFunction(() => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-broadcast-text'); return b && b.textContent === 'Movie night Saturday'; }, null, { timeout: 25000 }).then(() => true, () => false)
    .then((ok) => check('A new banner from the owner still shows', ok));
  await ctx.close();
} finally {
  // The local Worker keeps its KV between runs: leave no banner or popup
  // behind for the other browser suites.
  await ownerSays({ broadcast: '', announcement: null }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
