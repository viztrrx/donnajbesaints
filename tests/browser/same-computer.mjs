// One sign-in per name, same computer, two websites (Allowed users on), with
// the console injected the way the bookmarklet does it, against worker.js in
// workerd. Two local sites on different ports are two different websites to
// the browser (separate storage), in the same browser on the same computer.
//   1  kj signs in on site A
//   2  on site B: the warning "already signed in on this computer on A…"
//   3  Cancel: nothing changes, A stays signed in
//   4  Sign in here: B is in, A is signed out and told where
//   5  another computer (another browser) is still refused outright
//   node tests/browser/same-computer.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'same-computer-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN } });
const siteA = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'Site A')); });
const siteB = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'Site B')); });
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const KJ = 'kj' + Date.now().toString(36).slice(-4);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const shot = (page, name) => page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, name) });
const state = (page) => R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent, prompt: r.querySelector('#gpa-login-move').hidden ? null : r.querySelector('#gpa-login-move-text').textContent }));

async function inject(ctx, port) {
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return page;
}
async function signIn(page, button) {
  await page.fill(sr('#gpa-login-user'), KJ);
  await page.fill(sr('#gpa-login-pin'), '135790');
  await page.click(sr(button === 'create' ? '#gpa-signup-btn' : '#gpa-login-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return state(page);
}

try {
  await admin('/admin/config', { allowlist: { on: true, users: [KJ] } });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);

  // 1: site A.
  const a = await inject(ctx, siteA.port);
  let s = await signIn(a, 'create');
  check('kj signs in on site A', s.inside, JSON.stringify(s));

  // 2: site B, same browser and computer.
  const b = await inject(ctx, siteB.port);
  s = await signIn(b, 'signin');
  check('Site B warns: already signed in on this computer on site A', !s.inside && s.prompt && s.prompt.includes(`on 127.0.0.1:${siteA.port}`) && /signing in here will sign you out of/.test(s.prompt), JSON.stringify(s));
  await shot(b, '01-warning-on-site-b.png');

  // 3: Cancel.
  await b.click(sr('#gpa-login-move-no'));
  await b.waitForTimeout(400);
  s = await state(b);
  check('Cancel: nothing changes', !s.inside && !s.prompt && /Nothing changed/.test(s.msg), JSON.stringify(s));
  await a.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.waitForTimeout(2000);
  check('…and site A is still signed in', (await state(a)).inside);

  // 4: Sign in here.
  s = await signIn(b, 'signin');
  check('Signing in again shows the warning again', !!s.prompt);
  await b.click(sr('#gpa-login-move-yes'));
  await b.waitForTimeout(3000);
  await R(b, (r) => { const x = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (x && x.offsetParent) x.click(); });
  s = await state(b);
  check('“Sign in here”: kj is in on site B', s.inside, JSON.stringify(s));
  await b.waitForTimeout(400);
  await shot(b, '02-signed-in-on-site-b.png');
  await a.evaluate(() => window.dispatchEvent(new Event('focus')));
  const out = await a.waitForFunction((p) => { const r = document.getElementById('gpa-root-host').shadowRoot; return r.querySelector('#gpa-login').style.display !== 'none' && r.querySelector('#gpa-login-msg').textContent.includes('signed in on 127.0.0.1:' + p + ' on this computer'); }, siteB.port, { timeout: 25000 }).then(() => true, () => false);
  check('Site A is signed out and told where kj signed in', out, (await state(a)).msg);
  await shot(a, '03-site-a-signed-out.png');

  // 5: another computer (another browser).
  const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 760 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 OtherComputer' });
  await ctx2.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ } }, env.workerUrl);
  const c2 = await inject(ctx2, siteA.port);
  s = await signIn(c2, 'signin');
  check('Another computer: refused, no takeover offered', !s.inside && !s.prompt && /already signed in on another device/.test(s.msg), JSON.stringify(s));
  await shot(c2, '04-other-computer-refused.png');
  check('Site B is still signed in', (await state(b)).inside);

  for (const [n, p] of [['A', a], ['B', b], ['other', c2]]) check(`No page errors (${n})`, p._errors.length === 0, p._errors.slice(0, 2).join(' | '));
  await ctx.close(); await ctx2.close();
} finally {
  await admin('/admin/config', { allowlist: { on: false } }).catch(() => {});
  await browser.close();
  await env.close();
  await siteA.close(); await siteB.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
