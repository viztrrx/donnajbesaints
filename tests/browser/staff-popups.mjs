// Staff pop-ups and the Welcome page's Security card, end to end against
// worker.js in workerd, with screenshots:
//   1  an admin is signed in on a computer
//   2  someone not on the list tries to sign in: an urgent pop-up
//   3  someone launches the Proxy: a normal pop-up whose bar runs out
//   4  the admin turns off "Sites opened" pop-ups: those stop
//   5  a device gets locked: Welcome → Security shows it; Approve unlocks it
//   node tests/browser/staff-popups.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'staff-popups-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const W = (p, { body, token, s, ip } = {}) => fetch(env.workerUrl + p, {
  method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + ADMIN } : {}), ...(s ? { 'X-GPA-Session': s } : {}), ...(ip ? { 'X-Real-IP': ip } : {}) },
  body: body ? JSON.stringify(body) : undefined
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const verifier = (u, pin) => pbkdf2Sync(`gpa-server|${u.toLowerCase()}|${pin}`, 'gpa-server-salt|' + u.toLowerCase(), 210000, 32, 'sha256').toString('hex');
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const waitFor = (page, fn, arg, ms = 25000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const STAFF = 'adm' + run, KJ = 'kj' + run, PIN = '482913';
const shot = (page, name) => page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, name) });
const sr = (sel) => `#gpa-root-host >> ${sel}`;

try {
  await W('/admin/config', { token: true, body: { allowlist: { on: true, users: [STAFF, KJ] } } });
  // Accounts made on the server first; the staff one gets the admin role.
  await W('/auth/register', { body: { user: STAFF, verifier: verifier(STAFF, PIN) }, ip: '10.1.1.1' });
  const kj = (await W('/auth/register', { body: { user: KJ, verifier: verifier(KJ, PIN) }, ip: '10.1.1.2' })).data.token;
  await W('/admin/user/action', { token: true, body: { u: STAFF, action: 'setrole', role: 'admin' } });

  // 1: the admin signs in on a Chromebook-sized screen.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.addStyleTag({ content: '.gpa-spop{animation:none!important}' }).catch(() => {});
  await page.fill(sr('#gpa-login-user'), STAFF);
  await page.fill(sr('#gpa-login-pin'), PIN);
  await page.click(sr('#gpa-login-btn'));
  const inside = await waitFor(page, (r) => r.querySelector('#gpa-login').style.display === 'none', null, 20000);
  check('The admin is signed in', inside);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  await page.waitForTimeout(2500);   // the first check sets where the feed starts

  // 2: someone not on the list.
  await W('/auth/login', { body: { user: 'stranger' + run, verifier: 'b'.repeat(64) }, ip: '9.9.9.' + (run.charCodeAt(0) % 200) });
  const urgent = await waitFor(page, (r) => [...r.querySelectorAll('.gpa-spop.is-urgent')].some((el) => /not on your allowed-users list/.test(el.textContent)));
  check('An urgent pop-up for the unauthorized sign-in', urgent);
  const look = await R(page, (r) => { const el = r.querySelector('.gpa-spop.is-urgent'); return el ? { tag: el.querySelector('.gpa-spop-tag').textContent, bar: !!el.querySelector('.gpa-spop-bar'), ms: el.style.getPropertyValue('--spop-ms') } : null; });
  check('…marked Urgent, with the timer bar, on screen longer', look && /^Urgent/.test(look.tag) && look.bar && look.ms === '14000ms', JSON.stringify(look));
  await shot(page, '01-urgent-popup.png');

  // 3: KJ launches the Proxy.
  await W('/proxy/log', { s: kj, body: { user: KJ, event: 'launch', mode: 'here' } });
  const normal = await waitFor(page, (r, u) => [...r.querySelectorAll('.gpa-spop:not(.is-urgent)')].some((el) => el.textContent.includes(u + ' launched the Proxy')), KJ);
  check('A normal pop-up for the Proxy launch', normal);
  await shot(page, '02-proxy-popup.png');
  const gone = await waitFor(page, (r, u) => ![...r.querySelectorAll('.gpa-spop')].some((el) => el.textContent.includes(u + ' launched the Proxy')), KJ, 12000);
  check('…which dismisses itself when its bar runs out', gone);

  // 4: Settings → Account → Staff pop-ups: turn off "Sites opened".
  const card = await waitFor(page, (r) => { const c = r.querySelector('#gpa-spop-card'); return c && !c.hidden && c.querySelectorAll('.gpa-push-cat').length > 5; });
  check('Staff pop-ups settings show for the admin', card);
  const labels = await R(page, (r) => [...r.querySelectorAll('#gpa-spop-cats .gpa-push-cat span')].map((x) => x.textContent));
  check('…with the Proxy kinds, without owner-only ones', labels.includes('Sites opened and searches in the Proxy') && !labels.includes('Actions by your admins'), labels.join(' | '));
  await R(page, (r) => [...r.querySelectorAll('#gpa-spop-cats .gps-switch')].find((b) => b.getAttribute('aria-label') === 'Sites opened and searches in the Proxy').click());
  const saved = await waitFor(page, (r) => [...r.querySelectorAll('#gpa-spop-cats .gps-switch')].find((b) => b.getAttribute('aria-label') === 'Sites opened and searches in the Proxy').getAttribute('aria-pressed') === 'false');
  check('Turning off “Sites opened” is saved', saved);
  await page.evaluate(() => { location.hash = '#tab=theme&sec=account'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  await page.waitForTimeout(800);
  await R(page, (r) => { const c = r.querySelector('#gpa-spop-card'); if (c) c.scrollIntoView({ block: 'start' }); });
  await shot(page, '03-settings.png');
  await W('/proxy/log', { s: kj, body: { user: KJ, event: 'visit', url: 'https://example.com/' } });
  await page.waitForTimeout(18000);
  const quiet = await R(page, () => true) && !(await R(page, (r) => [...r.querySelectorAll('.gpa-spop')].some((el) => /opened example\.com/.test(el.textContent))));
  check('No pop-up for a site opened now', quiet);
  const phone = (await W('/push/me/prefs', { s: (await W('/auth/login', { body: { user: KJ, verifier: verifier(KJ, PIN), takeover: true }, ip: '10.1.1.2' })).data.token, body: {} })).data;
  check('Phone notification settings are separate (untouched)', phone.ok !== false);

  // 5: a device gets locked; Welcome → Security.
  const dev = 'e'.repeat(32);
  for (const n of ['x1', 'x2', 'x3']) await W('/access?user=' + n + run + '&device=' + dev, { ip: '8.8.8.' + n.length });
  await R(page, (r) => { const n = r.querySelector('.gpa-dropdown-item[data-tab="welcome"]'); if (n) n.click(); });
  const shown = await waitFor(page, (r) => { const c = r.querySelector('#gpa-wsec'); return c && !c.hidden && /Locked device/.test(c.textContent); });
  check('Welcome → Security shows the locked device', shown);
  const evs = await R(page, (r) => r.querySelector('#gpa-wsec').textContent);
  check('…and the recent security events', /Recent security events/.test(evs) && /Device locked/.test(evs), evs.slice(0, 160));
  await R(page, (r) => r.querySelector('#gpa-wsec').scrollIntoView({ block: 'start' }));
  await shot(page, '04-welcome-security.png');
  await R(page, (r) => r.querySelector('#gpa-wsec [data-kind="lock"] [data-act="unlock"]').click());
  const unlocked = await waitFor(page, (r) => !r.querySelector('#gpa-wsec [data-kind="lock"]'));
  check('Approve (unlock) clears it', unlocked);
  await shot(page, '05-welcome-unlocked.png');
  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  await W('/admin/config', { token: true, body: { allowlist: { on: false, users: [] } } }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
