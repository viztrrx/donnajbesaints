// Subscribers, end to end on iPhones in the home-screen app against worker.js
// in workerd, with a screenshot of each step:
//   1  owner: Admin → Security → Subscribers, list off: the warning + "Turn it on"
//   2  owner adds renzo for 1 month with a note ($10 · Cash App)
//   3  renzo signs up and gets in
//   4  his subscription ends (End now — the same thing the end date does):
//      renzo is signed out with "Your subscription has ended…"
//   5  renzo's sign-in screen: ended message + "Ask to renew"
//   6  owner renews; renzo gets back in
//   7  a name put on Allowed users without being made a subscriber gets the
//      automatic month (1st to 1st), and Security → Recent events folds away
//   8  Free access: the owner lets someone in for free (no end date); an
//      admin does the same for a week from their own Admin panel; the owner
//      ends one
// (The exact-time cut-off, calendar months, reminders and the cron clean-up
// are covered with a simulated clock in tests/worker.test.mjs and
// tests/push.test.mjs.)
//   node tests/browser/subscribers.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'subscribers-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE); });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const RENZO = 'renzo' + run;
const MIRA = 'mira' + run;
const GIFT = 'gift' + run, GIFT2 = 'pal' + run, ADM = 'adm' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

async function phone() {
  const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  await ctx.addInitScript((u) => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ }
  }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  return { ctx, page };
}
// The console on a website, on a computer (moderators can't use the phone app).
async function computer() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${site.port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8'));
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx, page };
}
async function signUp(page, user, button = 'signup') {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr(button === 'signin' ? '#gpa-login-btn' : '#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent, req: r.querySelector('#gpa-req-text').textContent, btn: r.querySelector('#gpa-req-send').textContent }));
}
async function openSubscribers(page) {
  await R(page, (r, a) => {
    const n = r.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click();
    const f = r.querySelector('#gac-auth-fields');
    if (f && f.offsetParent) {
      const inputs = [...f.querySelectorAll('input')];
      const tok = inputs.find((i) => i.type === 'password') || inputs[0];
      tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
      const urlIn = inputs.find((i) => i !== tok);
      if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
      r.querySelector('#gac-connect').click();
    }
  }, { token: ADMIN, url: env.workerUrl });
  await page.waitForTimeout(2500);
  await R(page, (r) => r.querySelector('.gps-tab[data-asec="security"]').click());
  await page.waitForFunction(() => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-subs'); return b && !/Loading/.test(b.textContent); }, null, { timeout: 15000 });
  await R(page, (r) => r.querySelector('#gac-subs-card').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
}
const subRow = (page, user) => R(page, (r, u) => { const el = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user.toLowerCase() === u.toLowerCase()); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }, user);

try {
  await admin('/admin/config', { allowlist: { on: false, users: [] } });
  // 1: owner, list off.
  const owner = await phone();
  await signUp(owner.page, 'ivan');
  await openSubscribers(owner.page);
  check('With Allowed users off, the card warns and offers “Turn it on”', await R(owner.page, (r) => !!r.querySelector('#gac-subs-allow') && /only matter while/.test(r.querySelector('.gac-subs-warn').textContent)));
  await shot(owner.page, '01-list-off-warning.png');
  await R(owner.page, (r) => r.querySelector('#gac-subs-allow').click());
  await owner.page.waitForFunction(() => { const r = document.getElementById('gpa-root-host').shadowRoot; const b = r.querySelector('#gac-subs'); return b && !/Loading/.test(b.textContent) && !r.querySelector('#gac-subs-allow'); }, null, { timeout: 15000 }).catch(() => {});
  check('“Turn it on” switches Only allow listed users on', (await (await fetch(env.workerUrl + '/access?user=nobody' + run)).json()).allowed === false);

  // 2: add renzo for a month with a note. (The local Worker keeps data between
  // test runs, and the money ledger keeps past payments on purpose.)
  const ledgerBefore = ((await admin('/admin/subscriptions', { action: 'list' })).ledger || []).reduce((n, x) => n + x.amount, 0);
  // Same as the card: cents only when there are any ($23.80, $10).
  const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  await R(owner.page, (r) => r.querySelector('#gac-subs-card').scrollIntoView({ block: 'start' }));
  await owner.page.fill(sr('#gac-subs-name'), RENZO);
  await owner.page.selectOption(sr('#gac-subs-period'), '1m');
  await owner.page.fill(sr('#gac-subs-note'), 'Cash App');
  await owner.page.fill(sr('#gac-subs-amount'), '10');
  // He actually paid 10 days ago: the month counts from then.
  const paidOn = Date.now() - 10 * 864e5;
  await owner.page.evaluate((ts) => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-subs-start'); const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60e3); el.value = d.toISOString().slice(0, 16); }, paidOn);
  await owner.page.click(sr('#gac-subs-form button[type="submit"]'));
  await owner.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-subscr')].some((x) => x.dataset.user === u), RENZO, { timeout: 10000 }).catch(() => {});
  const row = await subRow(owner.page, RENZO);
  check('renzo is listed from 10 days ago: about 20 days left, paid $10, the note', row && /(20|21) days left/.test(row) && /Since .* ends /.test(row) && /paid \$10/.test(row) && /Cash App/.test(row) && /Renew \+1 month/.test(row) && /Change start/.test(row) && /End now/.test(row), row);
  const totals = await R(owner.page, (root) => (root.querySelector('.gac-subs-totals') || {}).textContent || '');
  check('Totals: collected goes up by $10', totals.includes(money(ledgerBefore + 10) + 'collected in all') && /active now/.test(totals), totals + ' (before: ' + money(ledgerBefore) + ')');
  await owner.page.waitForTimeout(500);
  await shot(owner.page, '02-renzo-added.png');
  const cfgAllowed = (await (await fetch(env.workerUrl + '/access?user=' + RENZO)).json()).allowed;
  check('renzo is allowed in now', cfgAllowed === true);

  // 3: renzo signs up on his phone.
  const renzo = await phone();
  let r = await signUp(renzo.page, RENZO);
  check('renzo creates his account and gets in', r.inside, JSON.stringify(r));
  await R(renzo.page, (root) => root.querySelector('.gpa-dropdown-item[data-tab="welcome"]').click());
  const strip = () => R(renzo.page, (root) => { const el = root.querySelector('#gpa-substrip'); return { shown: !el.hidden && !!el.offsetParent, left: el.querySelector('#gpa-substrip-left').textContent, note: el.querySelector('#gpa-substrip-note').textContent, cls: el.className }; });
  const seen = await renzo.page.waitForFunction(() => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-substrip'); return el && !el.hidden; }, null, { timeout: 25000 }).then(() => true, () => false);
  let st = await strip();
  check('renzo sees his own countdown under the header: about 20 days left (days and hours), when it ends, and Renew', seen && /^(19|20|21)d \d+h left$/.test(st.left) && /Your subscription ends .* Tap Renew to keep it\./.test(st.note), JSON.stringify(st));
  await renzo.page.waitForTimeout(500);
  await shot(renzo.page, '03a-renzo-countdown.png');

  // Change start: moved back so only ~2 days are left: amber, "Ask the owner to renew".
  await R(owner.page, (root, u) => [...root.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u).querySelector('[data-sub="editstart"]').click(), RENZO);
  await owner.page.evaluate(([u, ts]) => { const row = [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u); const el = row.querySelector('.gac-subs-edit input'); const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60e3); el.value = d.toISOString().slice(0, 16); }, [RENZO, (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.getTime() + 2 * 864e5; })()]);
  await owner.page.waitForTimeout(300);
  await shot(owner.page, '03b-change-start.png');
  await R(owner.page, (root, u) => [...root.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u).querySelector('.gac-subs-edit button[type="submit"]').click(), RENZO);
  await owner.page.waitForTimeout(1500);
  check('Owner: after changing the start, about 2 days left', /(1|2) days? left|Ends today/i.test(await subRow(owner.page, RENZO) || ''), await subRow(owner.page, RENZO));
  await renzo.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const amber = await renzo.page.waitForFunction(() => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-substrip'); return el && el.classList.contains('is-low') && /Tap Renew to keep it/.test(el.textContent); }, null, { timeout: 25000 }).then(() => true, () => false);
  st = await strip();
  check('renzo’s countdown turns amber: “ends … Tap Renew to keep it”', amber && /^\d+(d \d+h|h \d+m|m) left$/.test(st.left), JSON.stringify(st));
  await renzo.page.waitForTimeout(500);
  await shot(renzo.page, '03c-renzo-ending-soon.png');

  // 4: the subscription ends.
  await R(owner.page, (root, u) => { window.confirm = () => true; [...root.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u).querySelector('[data-sub="end"]').click(); }, RENZO);
  await owner.page.waitForTimeout(1500);
  check('Owner sees it as Ended with a Remove option', /Ended/.test(await subRow(owner.page, RENZO) || '') && /Remove/.test(await subRow(owner.page, RENZO) || ''));
  await shot(owner.page, '03-ended-in-admin.png');
  await renzo.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const out = await renzo.page.waitForFunction(() => { const r = document.getElementById('gpa-root-host').shadowRoot; return r.querySelector('#gpa-login').style.display !== 'none' && /Your subscription has ended/.test(r.querySelector('#gpa-login-msg').textContent); }, null, { timeout: 25000 }).then(() => true, () => false);
  check('renzo is signed out: “Your subscription has ended. Ask the owner to renew it.”', out);
  await shot(renzo.page, '04-renzo-signed-out.png');

  // 5: trying to sign back in.
  r = await signUp(renzo.page, RENZO, 'signin');
  check('Signing in again: the ended message and “Ask to renew”', !r.inside && /subscription has ended/.test(r.msg) && /ended on/.test(r.req) && r.btn === 'Ask to renew', JSON.stringify(r));
  await shot(renzo.page, '05-renzo-ask-to-renew.png');

  // 6: owner renews; renzo is back.
  await R(owner.page, (root, u) => [...root.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u).querySelector('[data-sub="renew"]').click(), RENZO);
  await owner.page.waitForTimeout(1500);
  check('Renewed: active again with a month left', /(30|31) days left/.test(await subRow(owner.page, RENZO) || ''), await subRow(owner.page, RENZO));
  await R(owner.page, (root) => root.querySelector('#gac-subs-card').scrollIntoView({ block: 'start' }));
  await owner.page.waitForTimeout(300);
  await shot(owner.page, '06-renewed.png');
  r = await signUp(renzo.page, RENZO, 'signin');
  check('renzo can sign in again', r.inside, JSON.stringify(r));

  // 7: mira is put on Allowed users but never made a subscriber: the automatic month.
  await admin('/admin/config', { allowlist: { on: true, users: [RENZO, MIRA] } });
  await R(owner.page, (root) => { root.querySelector('.gps-tab[data-asec="overview"]').click(); });
  await owner.page.waitForTimeout(800);
  await R(owner.page, (root) => root.querySelector('.gps-tab[data-asec="security"]').click());
  await owner.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-subscr')].some((x) => x.dataset.user === u), MIRA, { timeout: 15000 }).catch(() => {});
  const miraRow = await subRow(owner.page, MIRA);
  const mStart = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const firstOf = (d) => d.toLocaleDateString('en-US', { month: 'short' }) + ' 1';
  const nextMonth = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 1);
  check('mira (listed, not a subscriber) gets the automatic month: “Automatic · N days left”, 1st to 1st', miraRow && /Automatic · (\d+ days left|Ends today)/.test(miraRow) && miraRow.includes('Since ' + firstOf(mStart)) && miraRow.includes('ends ' + firstOf(nextMonth)) && /Automatic: on Allowed users/.test(miraRow), miraRow);
  check('The card explains the automatic month', await R(owner.page, (root) => /gets one automatically: from the 1st of this month to the 1st of next/.test(root.querySelector('#gac-subs').textContent)));
  check('mira is allowed in', (await (await fetch(env.workerUrl + '/access?user=' + MIRA)).json()).allowed === true);
  await R(owner.page, (root, u) => [...root.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u).scrollIntoView({ block: 'center' }), MIRA);
  await owner.page.waitForTimeout(300);
  await shot(owner.page, '07-mira-automatic.png');

  // Recent events: folded by default, opens on tap, remembered.
  const fold = () => R(owner.page, (root) => { const el = root.querySelector('#gac-sec-events'); const h = el.querySelector('.gac-fold-head'); const body = el.querySelector('.gac-fold-body'); return { exp: h.getAttribute('aria-expanded'), hidden: body.hidden, h: Math.round(el.getBoundingClientRect().height), count: (el.querySelector('.gac-fold-count') || {}).textContent || '' }; });
  await R(owner.page, (root) => root.querySelector('#gac-sec-events').scrollIntoView({ block: 'start' }));
  await owner.page.waitForTimeout(300);
  let f = await fold();
  check('Recent events starts folded: just its title and a count', f.exp === 'false' && f.hidden && f.h < 90 && /^\d+$/.test(f.count), JSON.stringify(f));
  await shot(owner.page, '08-events-folded.png');
  await owner.page.click(sr('#gac-sec-events .gac-fold-head'));
  await owner.page.waitForTimeout(400);
  const fOpen = await fold();
  check('Tapping it opens the events', fOpen.exp === 'true' && !fOpen.hidden && fOpen.h > f.h, JSON.stringify(fOpen));
  await shot(owner.page, '09-events-open.png');
  await R(owner.page, (root) => { root.querySelector('.gps-tab[data-asec="overview"]').click(); });
  await owner.page.waitForTimeout(800);
  await R(owner.page, (root) => root.querySelector('.gps-tab[data-asec="security"]').click());
  await owner.page.waitForFunction(() => !!document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-sec-events'), null, { timeout: 15000 }).catch(() => {});
  f = await fold();
  check('Open stays open when coming back', f.exp === 'true' && !f.hidden, JSON.stringify(f));
  await owner.page.click(sr('#gac-sec-events .gac-fold-head'));
  await owner.page.waitForTimeout(300);
  f = await fold();
  check('Tapping again folds it', f.exp === 'false' && f.hidden, JSON.stringify(f));

  // 8: Free access. The owner gives gift free access with no end date.
  const freeRow = (page, u) => R(page, (root, x) => { const el = [...root.querySelectorAll('.gac-free-row')].find((r) => r.dataset.user.toLowerCase() === x.toLowerCase()); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }, u);
  await owner.page.waitForFunction(() => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-free'); return b && !/Loading/.test(b.textContent); }, null, { timeout: 15000 }).catch(() => {});
  check('Security has a “Free access” card right above Subscribers', await R(owner.page, (root) => { const fc = root.querySelector('#gac-free-card'), sc = root.querySelector('#gac-subs-card'); return !!fc && !!sc && fc.nextElementSibling === sc && /Give free access/.test(fc.textContent); }));
  await R(owner.page, (root) => root.querySelector('#gac-free-card').scrollIntoView({ block: 'start' }));
  await owner.page.fill(sr('#gac-free-name'), GIFT);
  await owner.page.fill(sr('#gac-free-note'), 'Birthday');
  check('“How long” starts on “No end date”', (await owner.page.inputValue(sr('#gac-free-period'))) === 'none');
  await owner.page.waitForTimeout(200);
  await shot(owner.page, '10-free-access-form.png');
  await owner.page.click(sr('#gac-free-form button[type="submit"]'));
  await owner.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-free-row')].some((x) => x.dataset.user === u), GIFT, { timeout: 10000 }).catch(() => {});
  let fr = await freeRow(owner.page, GIFT);
  check('gift is listed: “Free · no end”, given by the owner, the note', fr && /Free · no end/.test(fr) && /given by \w+/.test(fr) && /Birthday/.test(fr) && /End free access/.test(fr), fr);
  check('gift can get in', (await (await fetch(env.workerUrl + '/access?user=' + GIFT)).json()).allowed === true);
  await owner.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-subscr')].some((x) => x.dataset.user === u), GIFT, { timeout: 10000 }).catch(() => {});
  const gsub = await subRow(owner.page, GIFT);
  check('Subscribers shows gift as “Free · no end” with only “End free access”', gsub && /Free · no end/.test(gsub) && /no end/.test(gsub) && /End free access/.test(gsub) && !/Renew/.test(gsub), gsub);
  await R(owner.page, (root) => root.querySelector('#gac-free-card').scrollIntoView({ block: 'start' }));
  await owner.page.waitForTimeout(300);
  await shot(owner.page, '11-free-access-given.png');

  // An admin gives pal a week from her own Admin panel (no owner token).
  await admin('/admin/config', { allowlist: { on: true, users: [...(await (await fetch(env.workerUrl + '/admin/config/view', { headers: { Authorization: 'Bearer ' + ADMIN } })).json()).config.allowlist.users, ADM] } }).catch(() => {});
  const adm = await phone();
  r = await signUp(adm.page, ADM);
  check('adm creates an account', r.inside, JSON.stringify(r));
  await admin('/admin/user/action', { u: ADM, action: 'setrole', role: 'admin' });
  await adm.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await adm.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none', null, { timeout: 25000 }).catch(() => {});
  r = await signUp(adm.page, ADM, 'signin');
  check('adm signs in again as an admin', r.inside, JSON.stringify(r));
  await R(adm.page, (root) => { const n = root.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click(); });
  await adm.page.waitForFunction(() => { const r2 = document.getElementById('gpa-root-host').shadowRoot; return !r2.querySelector('#gac-layout').hidden && /admin/.test(r2.querySelector('#gac-who').textContent); }, null, { timeout: 15000 }).catch(() => {});
  await R(adm.page, (root) => root.querySelector('.gps-tab[data-asec="security"]').click());
  await adm.page.waitForFunction(() => { const b2 = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-free'); return b2 && !/Loading/.test(b2.textContent); }, null, { timeout: 15000 }).catch(() => {});
  check('Made an admin, adm’s strip says “No expiry” (staff are unlimited; no Renew)', await R(adm.page, (root) => { const el = root.querySelector('#gpa-substrip'); return !!el && !el.hidden && root.querySelector('#gpa-substrip-left').textContent === 'No expiry' && root.querySelector('#gpa-substrip-renew').hidden; }));
  check('The admin sees Free access in Security (and not Subscribers, which stays the owner’s)', await R(adm.page, (root) => !!root.querySelector('#gac-free-form') && !root.querySelector('#gac-subs-card') && /The owner gets an alert/.test(root.querySelector('#gac-free').textContent)));
  await R(adm.page, (root) => root.querySelector('#gac-free-card').scrollIntoView({ block: 'start' }));
  await adm.page.fill(sr('#gac-free-name'), GIFT2);
  await adm.page.selectOption(sr('#gac-free-period'), '1w');
  await adm.page.click(sr('#gac-free-form button[type="submit"]'));
  await adm.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-free-row')].some((x) => x.dataset.user === u), GIFT2, { timeout: 10000 }).catch(() => {});
  fr = await freeRow(adm.page, GIFT2);
  const wkEnd = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  check('The admin gave pal a week: “Free until <a week from now>”, given by the admin', fr && fr.includes('Free until ' + wkEnd) && fr.includes('given by ' + ADM), fr + ' (expected ' + wkEnd + ')');
  check('pal can get in', (await (await fetch(env.workerUrl + '/access?user=' + GIFT2)).json()).allowed === true);
  await adm.page.waitForTimeout(300);
  await shot(adm.page, '12-admin-gives-free-access.png');

  // The owner ends gift's free access: gift is out.
  await R(owner.page, (root) => { root.querySelector('.gps-tab[data-asec="overview"]').click(); });
  await owner.page.waitForTimeout(800);
  await R(owner.page, (root) => root.querySelector('.gps-tab[data-asec="security"]').click());
  await owner.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-free-row')].some((x) => x.dataset.user === u), GIFT2, { timeout: 15000 }).catch(() => {});
  check('The owner sees what the admin gave', /given by /.test(await freeRow(owner.page, GIFT2) || ''), await freeRow(owner.page, GIFT2));
  await R(owner.page, (root, u) => { window.confirm = () => true; [...root.querySelectorAll('.gac-free-row')].find((x) => x.dataset.user === u).querySelector('[data-free="end"]').click(); }, GIFT);
  await owner.page.waitForFunction((u) => ![...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-free-row')].some((x) => x.dataset.user === u), GIFT, { timeout: 10000 }).catch(() => {});
  check('“End free access”: gift leaves the list and can’t get in', !(await freeRow(owner.page, GIFT)) && (await (await fetch(env.workerUrl + '/access?user=' + GIFT)).json()).allowed === false);
  // A moderator (no Security page) finds the same card in Moderation, in the console on a computer.
  await admin('/admin/user/action', { u: ADM, action: 'setrole', role: 'moderator' });
  await adm.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await adm.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none', null, { timeout: 25000 }).catch(() => {});
  await adm.ctx.close();
  await admin('/admin/user/action', { u: ADM, action: 'revokesessions' });   // the owner signs the phone out, so the computer can sign in
  const mod = await computer();
  r = await signUp(mod.page, ADM, 'signin');
  await R(mod.page, (root) => { const n = root.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click(); });
  await mod.page.waitForFunction(() => { const r2 = document.getElementById('gpa-root-host').shadowRoot; return !r2.querySelector('#gac-layout').hidden && /moderator/.test(r2.querySelector('#gac-who').textContent); }, null, { timeout: 15000 }).catch(() => {});
  await R(mod.page, (root) => root.querySelector('.gps-tab[data-asec="moderation"]').click());
  await mod.page.waitForFunction((u) => [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gps-sec[data-asec="moderation"] .gac-free-row')].some((x) => x.dataset.user === u), GIFT2, { timeout: 15000 }).catch(() => {});
  check('As a moderator: Security is hidden, and Free access is in Moderation (with pal listed)', r.inside && await R(mod.page, (root) => root.querySelector('.gps-tab[data-asec="security"]').hidden && !!root.querySelector('.gps-sec[data-asec="moderation"] #gac-free-form')) && !!(await freeRow(mod.page, GIFT2)), JSON.stringify(r));
  await R(mod.page, (root) => root.querySelector('.gps-sec[data-asec="moderation"] #gac-free-card').scrollIntoView({ block: 'start' }));
  await mod.page.waitForTimeout(300);
  await shot(mod.page, '13-moderator-free-access.png');
  check('No page errors (moderator)', mod.page._errors.length === 0, mod.page._errors.slice(0, 2).join(' | '));
  await mod.ctx.close();
  check('No page errors (admin)', adm.page._errors.length === 0, adm.page._errors.slice(0, 2).join(' | '));
  check('No page errors (owner)', owner.page._errors.length === 0, owner.page._errors.slice(0, 2).join(' | '));
  check('No page errors (renzo)', renzo.page._errors.length === 0, renzo.page._errors.slice(0, 2).join(' | '));
  await owner.ctx.close();
  await renzo.ctx.close();
} finally {
  await admin('/admin/config', { allowlist: { on: false, users: [] } }).catch(() => {});
  await admin('/admin/subscriptions', { action: 'delete', user: RENZO }).catch(() => {});
  for (const u of [MIRA, GIFT, GIFT2]) await admin('/admin/subscriptions', { action: 'delete', user: u }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
  await site.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
