// Round 1 owner tools in the real console against worker.js in workerd:
//   1  Allowed users: kj (has an account) and dub (approved earlier, no
//      account yet) stay exactly as they were; adding sam makes an invite code
//   2  sam on a phone: Create asks for the invite code; wrong code refused;
//      the right one gets in
//   3  dub (approved before invites existed) creates the account with no code
//   4  Overview: the weekly report card (real numbers) and the heatmap card
//      (real "collecting" state, then a screenshot with SAMPLE data the test
//      supplies, since weeks of hourly samples can't be faked in workerd)
//   5  a subscriber with 2 days left gets the "ending" reminder once a day
//   node tests/browser/owner-tools.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'owner-tools-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const admin = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const KJ = 'kj' + run, DUB = 'dub' + run, SAM = 'sam' + run, SUBBY = 'subby' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');

async function open(kind) {
  const ctx = await browser.newContext(kind === 'phone' ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript(([u, phone]) => {
    if (phone) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });   // the home-screen app
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ }
  }, [env.workerUrl, kind === 'phone']);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  return { ctx, page };
}
const state = (page) => R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent, invite: !r.querySelector('#gpa-login-invite-wrap').hidden }));
async function create(page, user, invite) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  if (invite != null) await page.fill(sr('#gpa-login-invite'), invite);
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return state(page);
}
async function ownerAdmin(page, section) {
  await R(page, (root, a) => {
    const n = root.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click();
    const f = root.querySelector('#gac-auth-fields');
    if (f && f.offsetParent) {
      const inputs = [...f.querySelectorAll('input')];
      const tok = inputs.find((i) => i.type === 'password') || inputs[0];
      tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
      const urlIn = inputs.find((i) => i !== tok);
      if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
      root.querySelector('#gac-connect').click();
    }
  }, { token: ADMIN, url: env.workerUrl });
  await page.waitForTimeout(2500);
  await R(page, (root, s) => { const t = root.querySelector(`.gps-tab[data-asec="${s}"]`); if (t) t.click(); }, section);
  await page.waitForTimeout(1500);
}
const rowText = (page, u) => R(page, (r, u) => (r.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`) || {}).textContent || '', u);

try {
  // kj has an account; dub is approved but hasn't created it yet.
  await admin('/admin/config', { allowlist: { on: true, users: [KJ, DUB, SUBBY] } });
  await fetch(env.workerUrl + '/auth/register', { method: 'POST', body: JSON.stringify({ user: KJ, verifier: v(KJ) }) });

  // 1: owner adds sam.
  const O = await open('laptop');
  await create(O.page, 'ivan', null);
  await ownerAdmin(O.page, 'security');
  await O.page.waitForFunction((u) => !!document.getElementById('gpa-root-host').shadowRoot.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`), DUB.toLowerCase(), { timeout: 15000 });
  const dubBefore = await rowText(O.page, DUB.toLowerCase());
  check('dub (approved earlier, no account yet) has no invite code: unchanged', /The first person to create this account/.test(dubBefore) && /Make invite code/.test(dubBefore), dubBefore);
  await O.page.fill(sr('#gac-allow-users'), [KJ, DUB, SUBBY, SAM].join('\n'));
  await O.page.click(sr('#gac-allow-save'));
  const samRow = await O.page.waitForFunction((u) => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"] .gac-invite-code`); return el ? el.textContent : false; }, SAM.toLowerCase(), { timeout: 15000 }).then((h) => h.jsonValue(), () => '');
  check('Adding sam makes an invite code, shown under Allowed users', /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(samRow), samRow);
  check('…kj and dub still have no code', !/Invite code/.test(await rowText(O.page, KJ.toLowerCase())) && !/Invite code/.test(await rowText(O.page, DUB.toLowerCase())));
  await R(O.page, (r, u) => r.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`).scrollIntoView({ block: 'center' }), SAM.toLowerCase());
  await O.page.waitForTimeout(300);
  await O.page.locator(sr('#gac-allow-accts')).screenshot({ path: path.join(OUT, '01-allowed-users-invite.png') });

  // 2: sam on a phone.
  const S = await open('phone');
  let s = await create(S.page, SAM, null);
  check('sam presses Create: asked for an invite code', !s.inside && s.invite && /needs its sign-up code/.test(s.msg), JSON.stringify(s));
  await S.page.screenshot({ path: path.join(OUT, '02-invite-asked.png') });
  s = await create(S.page, SAM, 'AAAA-BBBB');
  check('Wrong code: refused', !s.inside && /isn’t right/.test(s.msg), s.msg);
  s = await create(S.page, SAM, samRow.toLowerCase());
  check('Right code: sam is in', s.inside, JSON.stringify(s));
  await S.ctx.close();
  // The code is used up.
  await R(O.page, (root) => root.querySelector('.gps-tab[data-asec="security"]').click());
  await O.page.waitForTimeout(1500);
  check('…and the owner now sees sam signed in, code gone', await O.page.waitForFunction((u) => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`); return el && /Signed in/.test(el.textContent) && !el.querySelector('.gac-invite-code'); }, SAM.toLowerCase(), { timeout: 15000 }).then(() => true, () => false));

  // 3: dub, approved before invites, needs no code.
  const D = await open('phone');
  s = await create(D.page, DUB, null);
  check('dub (approved earlier) creates the account with no code, as before', s.inside && !s.invite, JSON.stringify(s));
  await D.ctx.close();

  // 4: Overview cards.
  await R(O.page, (root) => root.querySelector('.gps-tab[data-asec="overview"]').click());
  const weekly = await O.page.waitForFunction(() => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-weekly .gac-weekly-list'); return el ? el.textContent : false; }, null, { timeout: 15000 }).then((h) => h.jsonValue(), () => '');
  check('Weekly report card shows this week’s numbers', /active/.test(weekly) && /AI request/.test(weekly), weekly);
  const collecting = await O.page.waitForFunction(() => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-heat'); return el && !/Loading/.test(el.textContent) ? el.textContent : false; }, null, { timeout: 15000 }).then((h) => h.jsonValue(), () => '');
  check('Heatmap card (real Worker, no samples yet): explains it is collecting', /Collecting/.test(collecting), collecting.slice(0, 80));
  // SAMPLE data for the picture: an after-school/evening pattern.
  await O.ctx.route('**/admin/heatmap', (route) => {
    const grid = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => {
      const weekend = d === 0 || d === 6;
      const base = h < 7 ? 0 : h < 15 ? (weekend ? 1 : 0.5) : h < 23 ? (weekend ? 3 : 2) + (h >= 18 && h <= 21 ? 3 : 0) : 1;
      return Math.round((base + ((d * 7 + h * 3) % 5) * 0.3) * 10) / 10;
    }));
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, weeks: 4, grid, peak: { day: 5, hour: 20, avg: 6.2 }, samples: 600 }) });
  });
  await R(O.page, (root) => root.querySelector('.gps-tab[data-asec="ai"]').click());
  await O.page.waitForTimeout(500);
  await R(O.page, (root) => root.querySelector('.gps-tab[data-asec="overview"]').click());
  await O.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('#gac-heat .gac-heat-cell').length === 168, null, { timeout: 15000 });
  const tip = await R(O.page, (r) => r.querySelectorAll('#gac-heat .gac-heat-row')[5].querySelectorAll('.gac-heat-cell')[20].title);
  check('Heatmap: 7 days × 24 hours, each cell says the hour and the average', tip === 'Fri 8 PM · 6.2 people online on average' || /^Fri 8 PM · [\d.]+ people online on average$/.test(tip), tip);
  await R(O.page, (r) => r.querySelector('#gac-heat-card').scrollIntoView({ block: 'start' }));
  await O.page.waitForTimeout(300);
  await O.page.locator(sr('#gac-heat-card')).screenshot({ path: path.join(OUT, '03-heatmap-SAMPLE-DATA.png') });
  await O.page.locator(sr('#gac-weekly-card')).screenshot({ path: path.join(OUT, '04-weekly-report.png') });
  check('No page errors (owner)', O.page._errors.length === 0, O.page._errors.slice(0, 2).join(' | '));
  await O.ctx.close();

  // 5: a subscriber with 2 days left.
  const startedAt = Date.now() - 28 * 864e5;
  await admin('/admin/subscriptions', { action: 'add', user: SUBBY, period: '1m', startedAt });
  const B = await open('phone');
  await create(B.page, SUBBY, null);
  const remind = await B.page.waitForFunction(() => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-sub-remind .gpa-ann-text'); return el ? el.textContent : false; }, null, { timeout: 20000 }).then((h) => h.jsonValue(), () => '');
  check('Subscriber with a few days left: “Your access ends in … days” pop-up', /^Your access ends (in \d days|tomorrow)/.test(remind), remind);
  await B.page.screenshot({ path: path.join(OUT, '05-subscriber-reminder.png') });
  await B.page.click(sr('.gpa-sub-remind .gpa-ann-ok'));
  await B.page.reload();
  await B.page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await B.page.waitForTimeout(5000);
  check('…shown once a day (not again after a reload)', await R(B.page, (r) => !r.querySelector('.gpa-sub-remind')));
  check('No page errors (subscriber)', B.page._errors.length === 0, B.page._errors.slice(0, 2).join(' | '));
  await B.ctx.close();
} finally {
  await admin('/admin/config', { allowlist: { on: false, users: [] } }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
