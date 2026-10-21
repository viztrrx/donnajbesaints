// Admins in the phone app, in the real console against worker.js in workerd
// (Allowed users on, "phone app for the owner and admins only" on), with a
// screenshot of each step:
//   1  ana and kj create their accounts on a computer (console injected
//      into a website); the owner makes ana an admin and she signs in again
//   2  ana signs in on the iPhone home-screen app: she gets in, and the
//      Admin panel opens from her role, with no admin token
//   3  ana uploads a song in Music → My music on her phone
//   4  on the computer (still signed in there too) the song is in her My
//      music, and her Admin panel is connected there as well
//   5  kj (a regular user) is turned away from the app with a clear message;
//      the console on a website still works for him
//   6  the owner sees the "Phone app" switch in Admin → Security
//   node tests/browser/admin-app.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'admin-app-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ appGate: true, extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'A school website')); });
const admin = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const ANA = 'ana' + run, KJ = 'kj' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const waitFor = (page, fnSrc, arg, ms = 15000) => page.waitForFunction(([src, a]) => (0, eval)(src)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fnSrc), arg], { timeout: ms, polling: 100 }).then(() => true, () => false);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const SONG = path.join(ROOT, 'tests/browser/fixtures/music/The Lanterns - Window Seat.mp3');

const track = (page) => { page._errors = []; page.on('pageerror', (e) => page._errors.push(String(e))); return page; };
// A computer: the console injected into an ordinary website, the bookmarklet way.
async function computer() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = track(await ctx.newPage());
  await page.goto(`http://127.0.0.1:${site.port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx, page };
}
// An iPhone with the home-screen app.
async function phone() {
  const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  // The app's Worker is its own origin (in production the default endpoint is the same address).
  await ctx.addInitScript((u) => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = track(await ctx.newPage());
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  return { ctx, page };
}
async function signIn(page, user, button) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr(button === 'create' ? '#gpa-signup-btn' : '#gpa-login-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
}
const tab = (page, t) => R(page, (r, x) => r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`).click(), t);
const adminState = (page) => R(page, (r) => ({ navShown: r.querySelector('.gpa-dropdown-item[data-tab="admin"]').style.display !== 'none', who: r.querySelector('#gac-who').textContent, layout: !r.querySelector('#gac-layout').hidden, authShown: !r.querySelector('#gac-auth').hidden }));
const mine = (page) => R(page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-title')].map((e) => e.textContent));
async function openMine(page) {
  await tab(page, 'music');
  await page.waitForTimeout(400);
  await R(page, (r) => r.querySelector('.gpx-src[data-src="mine"]').click());
  await page.waitForTimeout(800);
}

try {
  await admin('/admin/config', { allowlist: { on: true, users: [ANA, KJ] } });

  // 1: accounts made on a computer; ana becomes an admin.
  const anaPC = await computer();
  let s = await signIn(anaPC.page, ANA, 'create');
  check('ana creates her account on a computer', s.inside, JSON.stringify(s));
  const kjPC = await computer();
  s = await signIn(kjPC.page, KJ, 'create');
  check('kj creates his account on a computer', s.inside, JSON.stringify(s));
  const role = await admin('/admin/user/action', { u: ANA, action: 'setrole', role: 'admin' });
  check('The owner makes ana an admin', role.ok !== false, JSON.stringify(role).slice(0, 120));
  // A role change signs the person out everywhere; it applies on their next sign-in.
  await anaPC.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none', null, { timeout: 25000 }).catch(() => {});
  s = await signIn(anaPC.page, ANA, 'signin');
  check('ana signs in again on the computer, now as an admin', s.inside, JSON.stringify(s));

  // 2: ana on her phone.
  const anaPh = await phone();
  s = await signIn(anaPh.page, ANA, 'signin');
  check('ana signs in on the iPhone app (admin): she gets in', s.inside, JSON.stringify(s));
  await tab(anaPh.page, 'admin');
  const connected = await waitFor(anaPh.page, (r) => !r.querySelector('#gac-layout').hidden && /admin/.test(r.querySelector('#gac-who').textContent), null, 15000);
  const st = await adminState(anaPh.page);
  check('…the Admin panel opens from her role, no admin token asked', connected && st.navShown && !st.authShown, JSON.stringify(st));
  await anaPh.page.waitForTimeout(600);
  await shot(anaPh.page, '01-phone-admin-panel.png');

  // 3: upload on the phone.
  await openMine(anaPh.page);
  await anaPh.page.setInputFiles(sr('#gpa-mine-file'), [SONG]);
  const up = await waitFor(anaPh.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-title')].some((e) => e.textContent === 'Window Seat'), null, 30000);
  check('ana uploads “Window Seat” in My music on her phone', up, JSON.stringify(await mine(anaPh.page)));
  await shot(anaPh.page, '02-phone-upload.png');

  // 4: the computer, still signed in (admins can use both at once).
  await anaPC.page.reload();
  await anaPC.page.evaluate((c) => { (0, eval)(c); }, code);
  await anaPC.page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await anaPC.page.waitForTimeout(2500);
  const stillIn = await R(anaPC.page, (r) => r.querySelector('#gpa-login').style.display === 'none');
  check('ana is still signed in on the computer (phone and computer at once)', stillIn);
  await openMine(anaPC.page);
  const there = await waitFor(anaPC.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-title')].some((e) => e.textContent === 'Window Seat'), null, 15000);
  check('…and the song from her phone is in My music on the computer', there, JSON.stringify(await mine(anaPC.page)));
  await shot(anaPC.page, '03-computer-my-music.png');
  await R(anaPC.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-main')].find((b) => /Window Seat/.test(b.textContent)).click());
  const plays = await anaPC.page.waitForFunction(() => { const a = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-np-audio'); return a && a.readyState >= 2; }, null, { timeout: 10000 }).then(() => true, () => false);
  check('…and it plays there', plays);
  await tab(anaPC.page, 'admin');
  const pcAdmin = await waitFor(anaPC.page, (r) => !r.querySelector('#gac-layout').hidden && /admin/.test(r.querySelector('#gac-who').textContent), null, 15000);
  check('Her Admin panel works on the computer too, without a token', pcAdmin, JSON.stringify(await adminState(anaPC.page)));
  await shot(anaPC.page, '04-computer-admin-panel.png');
  // The phone is still signed in after the computer was used.
  await tab(anaPh.page, 'welcome');
  await anaPh.page.waitForTimeout(16000);   // past a status check
  check('…and her phone is still signed in', await R(anaPh.page, (r) => r.querySelector('#gpa-login').style.display === 'none'));

  // 5: kj on the app.
  const kjPh = await phone();
  s = await signIn(kjPh.page, KJ, 'signin');
  check('kj (not an admin) is turned away from the app', !s.inside && /only for the owner and admins/.test(s.msg), JSON.stringify(s));
  await shot(kjPh.page, '05-phone-not-admin.png');
  check('…while his console on the website still works', await R(kjPC.page, (r) => r.querySelector('#gpa-login').style.display === 'none'));

  // 6: the owner's switch.
  const own = await computer();
  s = await signIn(own.page, 'ivan', 'create');
  await R(own.page, (r) => { const n = r.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click(); });
  await own.page.waitForTimeout(400);
  await R(own.page, (r, a) => {
    const inputs = [...r.querySelectorAll('#gac-auth-fields input')];
    const tok = inputs.find((i) => i.type === 'password') || inputs[0];
    tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
    const urlIn = inputs.find((i) => i !== tok);
    if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
    r.querySelector('#gac-connect').click();
  }, { token: ADMIN, url: env.workerUrl });
  await own.page.waitForTimeout(2000);
  await R(own.page, (r) => r.querySelector('.gps-tab[data-asec="security"]').click());
  const card = await waitFor(own.page, (r) => !!r.querySelector('#gac-app-card #gac-app-staff[aria-pressed="true"]'), null, 15000);
  check('Admin → Security has the “Phone app” switch, on', card, card ? '' : JSON.stringify(await R(own.page, (r) => ({ who: r.querySelector('#gac-who').textContent, msg: (r.querySelector('#gac-auth-msg') || {}).textContent, login: r.querySelector('#gpa-login').style.display, sec: !!r.querySelector('#gac-app-card') }))));
  if (!card) await shot(own.page, '06-debug.png');
  if (card) await own.page.locator(sr('#gac-app-card')).screenshot({ path: path.join(OUT, '06-owner-phone-app-switch.png') });

  for (const [n, p] of [['ana computer', anaPC], ['ana phone', anaPh], ['kj computer', kjPC], ['kj phone', kjPh], ['owner', own]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [anaPC, anaPh, kjPC, kjPh, own]) await p.ctx.close();
} finally {
  await admin('/admin/config', { allowlist: { on: false }, appStaffOnly: false }).catch(() => {});
  await browser.close();
  await env.close();
  await site.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
