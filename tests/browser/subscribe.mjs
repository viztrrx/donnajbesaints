// Subscribe app (/subscribe/) in a real browser against worker.js in workerd.
// Stripe is a local stand-in: its "checkout page" has a Pay button that marks
// the session paid, sends the Worker a signed checkout.session.completed
// webhook (like Stripe does) and returns to the success page. The real Stripe
// can't be reached from the test machine. Steps, with screenshots:
//   1  the page: $13.80 / month, a username box; taken names are refused
//   2  pay → back on the page: "You're in", with a one-time sign-up code
//   3  the new subscriber creates their account in the console with that
//      code and gets in; the console says "Subscribed · renews monthly"
//   4  the owner sees them in Subscribers with the payment in the ledger
//   5  canceling at checkout: "Nothing was charged"
//   node tests/browser/subscribe.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';
import { stripeSign } from '../../web/subscribe.js';

const OUT = process.argv[2] || 'subscribe-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const WHSEC = 'whsec_browser_test_1';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ---- Stripe stand-in ----
let workerUrl = '';
const sessions = new Map();
let webhooksSent = 0;
const stub = await serve(async (rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  const body = await new Promise((r) => { let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => r(b)); });
  const json = (o, code = 200) => { rs.statusCode = code; rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify(o)); };
  if (u.pathname === '/v1/checkout/sessions' && rq.method === 'POST') {
    if (rq.headers.authorization !== 'Bearer sk_test_browser') return json({ error: { message: 'Invalid API key' } }, 401);
    const p = new URLSearchParams(body);
    const id = 'cs_test_' + Math.random().toString(36).slice(2, 14) + 'abcdefgh';
    const s = { id, object: 'checkout.session', mode: p.get('mode'), url: `http://127.0.0.1:${stub.port}/pay/${id}`, client_reference_id: p.get('client_reference_id'), metadata: { user: p.get('metadata[user]') },
      amount_total: Number(p.get('line_items[0][price_data][unit_amount]')), success_url: p.get('success_url'), cancel_url: p.get('cancel_url'), status: 'open', payment_status: 'unpaid', customer: null, subscription: null };
    sessions.set(id, s);
    return json(s);
  }
  let m = /^\/v1\/checkout\/sessions\/(cs_test_\w+)$/.exec(u.pathname);
  if (m) return sessions.has(m[1]) ? json(sessions.get(m[1])) : json({ error: { message: 'No such session' } }, 404);
  m = /^\/v1\/subscriptions\/(sub_\w+)$/.exec(u.pathname);
  if (m) return json({ id: m[1], object: 'subscription', items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } });
  m = /^\/pay\/(cs_test_\w+)$/.exec(u.pathname);
  if (m && sessions.has(m[1])) {
    const s = sessions.get(m[1]);
    if (rq.method === 'GET') {
      rs.setHeader('Content-Type', 'text/html');
      rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:24px"><h2>Stripe Checkout (test stand-in)</h2><p>${s.metadata.user} · $${(s.amount_total / 100).toFixed(2)} / month</p>
        <form method="post"><button id="pay" name="a" value="pay">Pay</button> <button id="back" name="a" value="cancel">Back</button></form></body>`);
      return;
    }
    if (/a=cancel/.test(body)) { rs.statusCode = 303; rs.setHeader('Location', s.cancel_url); rs.end(); return; }
    Object.assign(s, { status: 'complete', payment_status: 'paid', customer: 'cus_test1', subscription: 'sub_test1' });
    const payload = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2, 12), type: 'checkout.session.completed', data: { object: s } });
    const t = Math.floor(Date.now() / 1000);
    const r = await fetch(workerUrl + '/subscribe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${await stripeSign(WHSEC, t, payload)}` }, body: payload });
    if (r.ok) webhooksSent++;
    rs.statusCode = 303; rs.setHeader('Location', s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id)); rs.end();
    return;
  }
  rs.statusCode = 404; rs.end('not found');
});

const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, STRIPE_SECRET_KEY: 'sk_test_browser', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API: `http://127.0.0.1:${stub.port}` } });
workerUrl = env.workerUrl;
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE); });
const admin = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const NAME = 'NewKid' + Date.now().toString(36).slice(-3);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const track = (page) => { page._errors = []; page.on('pageerror', (e) => page._errors.push(String(e))); return page; };

try {
  await admin('/admin/config', { allowlist: { on: true, users: ['oldfriend'] } });

  // 1: the page on a phone.
  const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  const page = track(await ctx.newPage());
  await page.goto(env.workerUrl + '/subscribe/');
  check('The subscribe page shows $13.80 / month and a username box', /\$13\.80\s*\/ month/.test(await page.textContent('.price')) && await page.isVisible('#user'));
  await page.fill('#user', 'oldfriend');
  await page.waitForFunction(() => /already has access/.test(document.getElementById('hint').textContent), null, { timeout: 8000 }).catch(() => {});
  check('A name that already has access is refused', /already has access/.test(await page.textContent('#hint')) && await page.isDisabled('#pay'), await page.textContent('#hint'));
  await page.fill('#user', NAME);
  await page.waitForFunction(() => /is available/.test(document.getElementById('hint').textContent), null, { timeout: 8000 }).catch(() => {});
  check('A free name is available; Continue turns on', /is available/.test(await page.textContent('#hint')) && !(await page.isDisabled('#pay')), await page.textContent('#hint'));
  await page.screenshot({ path: path.join(OUT, '01-subscribe-page.png') });

  // 2: pay.
  await page.click('#pay');
  await page.waitForURL(/\/pay\/cs_test_/, { timeout: 10000 });
  check('Continue opens Stripe’s checkout (stand-in) for $13.80/month', /\$13\.80 \/ month/.test(await page.textContent('body')));
  await page.click('#pay');
  await page.waitForURL(/\/subscribe\/\?done=cs_test_/, { timeout: 10000 });
  const doneOk = await page.waitForFunction(() => !document.getElementById('done').hidden, null, { timeout: 20000 }).then(() => true, () => false);
  const signupCode = doneOk ? (await page.textContent('#code')).trim() : '';
  check('Back on the page: “You’re in”, with a one-time sign-up code', doneOk && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(signupCode), signupCode);
  check('…the payment was confirmed by Stripe’s signed webhook', webhooksSent === 1, String(webhooksSent));
  await page.screenshot({ path: path.join(OUT, '02-paid-approved.png') });

  // 3: create the account in the console with the code.
  const pc = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  await pc.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const cp = track(await pc.newPage());
  await cp.goto(`http://127.0.0.1:${site.port}/`);
  await cp.evaluate((c) => { (0, eval)(c); }, code);
  await cp.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await cp.fill(sr('#gpa-login-user'), NAME);
  await cp.fill(sr('#gpa-login-pin'), '246810');
  await cp.click(sr('#gpa-signup-btn'));
  await cp.waitForTimeout(2500);
  const asks = await R(cp, (r) => ({ box: !r.querySelector('#gpa-login-invite-wrap').hidden, msg: r.querySelector('#gpa-login-msg').textContent }));
  check('The console asks for the sign-up code', asks.box && /sign-up code/.test(asks.msg), JSON.stringify(asks));
  await cp.fill(sr('#gpa-login-invite'), signupCode);
  await cp.click(sr('#gpa-signup-btn'));
  await cp.waitForTimeout(2500);
  await R(cp, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  const inside = await R(cp, (r) => r.querySelector('#gpa-login').style.display === 'none');
  check('With the code, their account is created and they’re in', inside, await R(cp, (r) => r.querySelector('#gpa-login-msg').textContent));
  const strip = await cp.waitForFunction(() => { const s = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-substrip'); return s && !s.hidden && /renews monthly/.test(s.textContent); }, null, { timeout: 25000 }).then(() => true, () => false);
  check('The console shows “Subscribed · renews monthly”', strip, await R(cp, (r) => r.querySelector('#gpa-substrip').textContent.replace(/\s+/g, ' ').trim()));
  await cp.screenshot({ path: path.join(OUT, '03-console-subscribed.png') });

  // 4: the owner's view.
  const subs = await admin('/admin/subscriptions', { action: 'list' });
  const me = (subs.subscriptions || []).find((x) => x.user === NAME);
  check('Owner: in Subscribers (renews monthly) with $13.80 in the ledger', me && me.active && me.autoRenew && subs.ledger.some((x) => x.user === NAME && x.amount === 13.8), JSON.stringify(me && { user: me.user, note: me.note, daysLeft: me.daysLeft }));
  const cfgView = await admin('/admin/config/view');
  check('…and on Allowed users', cfgView.config.allowlist.users.includes(NAME.toLowerCase()));
  // Paying again for the same name is refused.
  await page.goto(env.workerUrl + '/subscribe/');
  await page.fill('#user', NAME);
  await page.waitForFunction(() => /already subscribed/.test(document.getElementById('hint').textContent), null, { timeout: 8000 }).catch(() => {});
  check('The same name can’t be bought twice', /already subscribed/.test(await page.textContent('#hint')), await page.textContent('#hint'));

  // 5: cancel at checkout.
  await page.fill('#user', 'second' + Date.now().toString(36).slice(-3));
  await page.waitForFunction(() => /is available/.test(document.getElementById('hint').textContent), null, { timeout: 8000 }).catch(() => {});
  await page.click('#pay');
  await page.waitForURL(/\/pay\/cs_test_/, { timeout: 10000 });
  await page.click('#back');
  await page.waitForURL(/canceled=1/, { timeout: 10000 });
  check('Going back from checkout: “Payment canceled · Nothing was charged”', await page.isVisible('#cancel') && /Nothing was charged/.test(await page.textContent('#cancel')));
  await page.screenshot({ path: path.join(OUT, '04-canceled.png') });

  for (const [n, p] of [['subscribe page', page], ['console', cp]]) check(`No page errors (${n})`, p._errors.length === 0, p._errors.slice(0, 2).join(' | '));
  await ctx.close(); await pc.close();
} finally {
  await admin('/admin/config', { allowlist: { on: false } }).catch(() => {});
  await browser.close();
  await env.close();
  await site.close();
  await stub.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
