// Subscribe app (/subscribe/) in a real browser against worker.js in workerd.
// Stripe is a local stand-in: its "checkout page" has a Pay button that marks
// the session paid, sends the Worker a signed checkout.session.completed
// webhook (like Stripe does) and returns to the success page. The real Stripe
// can't be reached from the test machine. Steps, with screenshots:
//   1  the page: $13.80 / month, a username box; taken names are refused
//   2  pay → back on the page: "You're in" and "Create your PIN": they pick
//      their own PIN there (short or mismatched PINs are refused)
//   3  they sign in to the console with that username and PIN (no code)
//      and get in; the console says "Subscribed · renews monthly"
//   4  the owner sees them in Subscribers with the payment in the ledger
//   5  canceling at checkout: "Nothing was charged", and trying again with
//      the same name isn't blocked by their own unfinished checkout
//   6  the footer (Terms, Refunds & cancellation, Privacy, contact email),
//      the renewal terms by the button, and each policy page on a phone
//   7  a member who already pays types their name: instead of Subscribe they
//      get a one-time contribution ($6 or more) → checkout → "Thank you";
//      the owner's Subscribers card shows it; the subscription is unchanged
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
    const s = { id, object: 'checkout.session', mode: p.get('mode'), url: `http://127.0.0.1:${stub.port}/pay/${id}`, client_reference_id: p.get('client_reference_id'), metadata: { user: p.get('metadata[user]'), ...(p.get('metadata[kind]') ? { kind: p.get('metadata[kind]') } : {}) },
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
      rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:24px"><h2>Stripe Checkout (test stand-in)</h2><p>${s.metadata.user} · $${(s.amount_total / 100).toFixed(2)}${s.mode === 'subscription' ? ' / month' : ' one-time'}</p>
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
  await admin('/admin/subscriptions', { action: 'add', user: 'paidpal', period: '1m', amount: 14, note: 'cash' });

  // 1: the page on a phone.
  const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  const page = track(await ctx.newPage());
  await page.goto(env.workerUrl + '/subscribe/');
  check('The subscribe page shows $13.80 / month and a username box', /\$13\.80\s*\/ month/.test(await page.textContent('.price')) && await page.isVisible('#user'));
  check('A clear note: contributions are only for subscribers, subscribe first', await page.isVisible('#contrib-note') && /Contributions are only for subscribers\. New here\? Subscribe first\./.test(await page.textContent('#contrib-note')), await page.textContent('#contrib-note'));
  await page.fill('#user', 'oldfriend');
  await page.waitForFunction(() => /free access until/.test(document.getElementById('hint').textContent), null, { timeout: 8000 }).catch(() => {});
  check('A listed name on its automatic month may pay (“free access until …, subscribing starts your paid month now”)', /has free access until \w+ \d+\. Subscribing starts your paid month now\./.test(await page.textContent('#hint')) && !(await page.isDisabled('#pay')), await page.textContent('#hint'));
  await page.fill('#user', 'paidpal');
  await page.waitForFunction(() => /already subscribed/.test(document.getElementById('hint').textContent), null, { timeout: 8000 }).catch(() => {});
  check('A name already paid for this month is refused', /already subscribed for this month/.test(await page.textContent('#hint')) && await page.isDisabled('#pay'), await page.textContent('#hint'));
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
  check('Back on the page: “You’re in”, and “Create your PIN” (the sign-up code only tucked away as an in-app fallback)', doneOk && await page.isVisible('#pin-form') && (await page.inputValue('#pin-user')) === NAME && await page.isHidden('#code') && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(signupCode), signupCode);
  const walk = (n) => page.screenshot({ path: path.join(OUT, 'walk-' + n + '.png'), fullPage: true });
  await walk('1-back-from-paying');
  await page.fill('#pin1', '12'); await page.fill('#pin2', '12'); await page.click('#pin-go');
  check('A PIN under 4 characters is refused', /at least 4 characters/.test(await page.textContent('#pin-hint')), await page.textContent('#pin-hint'));
  await page.fill('#pin1', '246810'); await page.fill('#pin2', '246811'); await page.click('#pin-go');
  check('Two PINs that don’t match are refused', /don’t match/.test(await page.textContent('#pin-hint')), await page.textContent('#pin-hint'));
  await page.screenshot({ path: path.join(OUT, '02-paid-approved.png') });
  check('A clear warning: they must remember the PIN, nobody can recover it; simple for them, hard to guess', await page.isVisible('#pin-warn') && /You must remember this PIN\./.test(await page.textContent('#pin-warn')) && /not even the owner/.test(await page.textContent('#pin-warn')) && /no 1234, 0000/.test(await page.textContent('#pin-warn')));
  for (const weak of ['1234', '0000', '9876', '2008']) {
    await page.fill('#pin1', weak); await page.fill('#pin2', weak); await page.click('#pin-go');
    check('An easy-to-guess PIN (' + weak + ') is refused', /easy to guess|first ones people try|too easy/.test(await page.textContent('#pin-hint')) && await page.isVisible('#pin-form'), await page.textContent('#pin-hint'));
  }
  await page.fill('#pin1', '246810'); await page.fill('#pin2', '246810'); await page.click('#pin-go');
  check('Without ticking “I’ll remember this PIN”, it doesn’t go through', /Tick “I’ll remember this PIN”/.test(await page.textContent('#pin-hint')) && await page.isVisible('#pin-form'), await page.textContent('#pin-hint'));
  await page.check('#pin-ok');
  await page.locator('#pin-form').screenshot({ path: path.join(OUT, '02a-pin-warning.png') });
  await walk('2-pin-filled-in');
  await page.click('#pin-go');
  const emailStep = await page.waitForFunction(() => !document.getElementById('email-form').hidden, null, { timeout: 20000 }).then(() => true, () => false);
  check('The PIN creates the account; next: “Add your school email”', emailStep && await page.isHidden('#pin-form') && await page.isHidden('#steps-ready'), (await page.textContent('#done')).replace(/\s+/g, ' ').slice(0, 160));
  await walk('3-email-step');
  check('The email box: digits only, the domain fixed as “@alseducation.onmicrosoft.com”', (await page.textContent('#sid-dom')) === '@alseducation.onmicrosoft.com' && (await page.getAttribute('#sid', 'maxlength')) === '6' && await page.isDisabled('#sid-go'));
  await page.locator('#sid').pressSequentially('22a3b9xx29');
  check('Letters are dropped as they type', (await page.inputValue('#sid')) === '223929' && /Your email: 223929@alseducation\.onmicrosoft\.com/.test(await page.textContent('#sid-hint')) && !(await page.isDisabled('#sid-go')), await page.inputValue('#sid'));
  await page.locator('#sid').pressSequentially('77');
  check('No more than 6 digits', (await page.inputValue('#sid')) === '223929', await page.inputValue('#sid'));
  await page.locator('#email-form').screenshot({ path: path.join(OUT, '02b-school-email.png') });
  await walk('4-email-typed');
  await page.click('#sid-go');
  const made = await page.waitForFunction(() => !document.getElementById('steps-ready').hidden, null, { timeout: 20000 }).then(() => true, () => false);
  check('Sent: the page confirms the email, says to check Google Docs at school (docs.google.com), and to sign in with the PIN', made && await page.isHidden('#email-form') && await page.isHidden('#keep-open') && /Sent: 223929@alseducation\.onmicrosoft\.com/.test(await page.textContent('#email-sent')) && /sign in at docs\.google\.com with that school account: the instructions for loading Saints Service will be in your Google Docs/.test(await page.textContent('#email-sent')) && /account is ready/.test(await page.textContent('#done')), (await page.textContent('#done')).replace(/\s+/g, ' ').slice(0, 200));
  await page.screenshot({ path: path.join(OUT, '02c-pin-made.png') });
  await walk('5-all-done');
  check('…the payment was confirmed by Stripe’s signed webhook', webhooksSent === 1, String(webhooksSent));

  // 3: sign in to the console with the PIN they made (no code, no Create).
  const pc = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  await pc.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const cp = track(await pc.newPage());
  await cp.goto(`http://127.0.0.1:${site.port}/`);
  await cp.evaluate((c) => { (0, eval)(c); }, code);
  await cp.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await cp.fill(sr('#gpa-login-user'), NAME);
  await cp.fill(sr('#gpa-login-pin'), '246810');
  await cp.click(sr('#gpa-login-btn'));
  await cp.waitForTimeout(3000);
  await R(cp, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  const inside = await R(cp, (r) => r.querySelector('#gpa-login').style.display === 'none');
  check('Sign in with that username and PIN: they’re in (on a device that never saw them before)', inside, await R(cp, (r) => r.querySelector('#gpa-login-msg').textContent));
  const strip = await cp.waitForFunction(() => { const s = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-substrip'); return s && !s.hidden && /Renews in \d+d \d+h/.test(s.textContent) && /renews automatically/.test(s.textContent); }, null, { timeout: 25000 }).then(() => true, () => false);
  check('The console shows “Renews in Xd Yh … renews automatically”', strip, await R(cp, (r) => r.querySelector('#gpa-substrip').textContent.replace(/\s+/g, ' ').trim()));
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
  check('The same name can’t be bought twice: no Subscribe button, only Contribute', /can’t be paid for again/.test(await page.textContent('#hint')) && await page.isHidden('#pay') && await page.isHidden('#sub-info') && await page.isVisible('#give') && (await page.textContent('#form-title')) === 'Contribute', await page.textContent('#hint'));
  const second = await fetch(env.workerUrl + '/subscribe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: NAME }) });
  check('…and the server refuses a second subscription even if asked directly', second.status === 409, String(second.status));

  // 5: cancel at checkout.
  const SECOND = 'second' + Date.now().toString(36).slice(-3);
  await page.fill('#user', SECOND);
  await page.waitForFunction(() => /is available/.test(document.getElementById('hint').textContent), null, { timeout: 8000 }).catch(() => {});
  await page.click('#pay');
  await page.waitForURL(/\/pay\/cs_test_/, { timeout: 10000 });
  await page.click('#back');
  await page.waitForURL(/canceled=1/, { timeout: 10000 });
  check('Going back from checkout: “Payment canceled · Nothing was charged”', await page.isVisible('#cancel') && /Nothing was charged/.test(await page.textContent('#cancel')));
  await page.screenshot({ path: path.join(OUT, '04-canceled.png') });
  // Trying again with the same name isn't blocked by their own unfinished checkout.
  const again = await page.evaluate(() => sessionStorage.getItem('sub_attempt'));
  await page.click('#cancel a');
  await page.waitForSelector('#user');
  await page.fill('#user', SECOND);
  await page.waitForFunction(() => /is available|paying/.test(document.getElementById('hint').textContent), null, { timeout: 8000 }).catch(() => {});
  check('Try again with the same name: still available to them (not “someone is paying”)', /is available/.test(await page.textContent('#hint')) && !!again, await page.textContent('#hint'));

  // 5: the policies Stripe's review looks for, linked from every page.
  await page.goto(env.workerUrl + '/subscribe/');
  const legal = await page.evaluate(() => ({ links: [...document.querySelectorAll('footer.legal a')].map((a) => a.getAttribute('href')), terms: document.querySelector('#subbox .terms').textContent.replace(/\s+/g, ' ') }));
  check('Footer: Terms, Refunds & cancellation, Privacy and the contact email', ['/subscribe/terms', '/subscribe/refunds', '/subscribe/privacy', 'mailto:viztrrx@gmail.com'].every((h) => legal.links.includes(h)), legal.links.join(' '));
  check('By the button: agree to the terms, $13.80 USD today and every month until you cancel, non-refundable', /agree to the Terms of Service and the Refund & Cancellation Policy/.test(legal.terms) && /\$13\.80 USD today and then every month until you cancel\. Payments are non-refundable\./.test(legal.terms), legal.terms);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: path.join(OUT, '05-subscribe-footer.png') });
  await page.click('footer.legal a[href="/subscribe/refunds"]');
  await page.waitForURL(/\/subscribe\/refunds$/, { timeout: 10000 });
  const refund = (await page.textContent('article')).replace(/\s+/g, ' ');
  check('Refund & Cancellation Policy: price, how to cancel, no refunds (billing errors only), contact', /\$13\.80 USD a month/.test(refund) && /How to cancel/.test(refund) && /All payments are final and non-refundable/.test(refund) && /Billing errors are the only exception/.test(refund) && /viztrrx@gmail\.com/.test(refund), refund.slice(0, 120));
  await page.screenshot({ path: path.join(OUT, '06-refund-policy.png'), fullPage: true });
  await page.click('a[href="/subscribe/terms"]');
  await page.waitForURL(/\/subscribe\/terms$/, { timeout: 10000 });
  check('Terms of Service open from there', /Terms of Service/.test(await page.textContent('h1')) && /Acceptable use/.test(await page.textContent('article')));
  await page.screenshot({ path: path.join(OUT, '07-terms.png') });
  await page.click('a[href="/subscribe/privacy"]');
  await page.waitForURL(/\/subscribe\/privacy$/, { timeout: 10000 });
  check('Privacy Policy opens, and says data isn’t sold', /Privacy Policy/.test(await page.textContent('h1')) && /don’t sell/.test(await page.textContent('article')));
  await page.screenshot({ path: path.join(OUT, '08-privacy.png') });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('Policy pages fit a phone screen (no sideways scrolling)', wide);
  await page.click('a.back');
  await page.waitForURL(/\/subscribe\/$/, { timeout: 10000 });
  check('“← Subscribe page” goes back', await page.isVisible('#user'));

  // 7: a member adds a one-time contribution.
  const subBefore = (await admin('/admin/subscriptions', { action: 'list' })).subscriptions.find((x) => x.user === NAME);
  await page.goto(env.workerUrl + '/subscribe/');
  await page.fill('#user', NAME);
  const giveShown = await page.waitForFunction(() => !document.getElementById('contrib').hidden, null, { timeout: 8000 }).then(() => true, () => false);
  check('A member who already pays gets “already subscribed” and the contribution box, not Subscribe', giveShown && await page.isHidden('#subbox') && /already subscribed/.test(await page.textContent('#hint')), await page.textContent('#hint'));
  check('The smallest contribution is $6: the first quick button is $6 and starts picked', (await page.textContent('#contrib [data-amt="6"]')).trim() === '$6' && await page.getAttribute('#contrib [data-amt="6"]', 'aria-pressed') === 'true' && (await page.textContent('#give')).trim() === 'Contribute $6.00', await page.textContent('#give'));
  await page.fill('#amt', '5.99');
  check('Under $6: the button turns off and says the smallest is $6', await page.isDisabled('#give') && /smallest contribution is \$6\.00/.test(await page.textContent('#amt-hint')), await page.textContent('#amt-hint'));
  await page.click('#contrib [data-amt="20"]');
  check('Tapping $20: “Contribute $20.00”', (await page.textContent('#give')).trim() === 'Contribute $20.00' && await page.getAttribute('#contrib [data-amt="20"]', 'aria-pressed') === 'true', await page.textContent('#give'));
  await page.screenshot({ path: path.join(OUT, '09-contribute.png') });
  const hooksBefore = webhooksSent;
  await page.click('#give');
  await page.waitForURL(/\/pay\/cs_test_/, { timeout: 10000 });
  check('Opens Stripe’s checkout (stand-in) for a one-time $20.00', /\$20\.00 one-time/.test(await page.textContent('body')));
  await page.click('#pay');
  await page.waitForURL(/\/subscribe\/\?thanks=cs_test_/, { timeout: 10000 });
  const thanked = await page.waitForFunction(() => !document.getElementById('thanks').hidden, null, { timeout: 20000 }).then(() => true, () => false);
  check('Back on the page: “Thank you” with the amount', thanked && (await page.textContent('#thanks-user')) === NAME && (await page.textContent('#thanks-amt')) === '$20.00', thanked ? (await page.textContent('#thanks')).replace(/\s+/g, ' ').trim() : '');
  await page.screenshot({ path: path.join(OUT, '10-thank-you.png') });
  check('…and the next contribution gets a fresh checkout (visit id renewed)', await page.evaluate(() => !sessionStorage.getItem('sub_attempt')));
  const after = await admin('/admin/subscriptions', { action: 'list' });
  const subAfter = after.subscriptions.find((x) => x.user === NAME);
  check('Owner: the $20 contribution is in the ledger once; the subscription didn’t change', webhooksSent === hooksBefore + 1 && after.ledger.filter((x) => x.user === NAME && x.action === 'contribution').map((x) => x.amount).join() === '20' && subAfter.expiresAt === subBefore.expiresAt, JSON.stringify(after.ledger.filter((x) => x.user === NAME)));

  // 7b: the owner's test contribution: from $1, only with the owner's PIN.
  await page.goto(env.workerUrl + '/subscribe/');
  await page.fill('#user', 'ivan');
  const ownerShown = await page.waitForFunction(() => !document.getElementById('owner-box').hidden, null, { timeout: 8000 }).then(() => true, () => false);
  check('The owner’s name: “Test contribution” from $1 with a PIN box (no Subscribe)', ownerShown && (await page.textContent('#form-title')) === 'Test contribution' && await page.isHidden('#subbox') && (await page.textContent('#contrib [data-amt="1"]')).trim() === '$1' && (await page.textContent('#give')).trim() === 'Contribute $1.00', await page.textContent('#hint'));
  await page.screenshot({ path: path.join(OUT, '11-owner-test-contribution.png') });
  await page.click('#give');
  check('…the PIN is required before anything is sent', /Type your PIN first/.test(await page.textContent('#amt-hint')) && /\/subscribe\/$/.test(page.url()), await page.textContent('#amt-hint'));
  await page.fill('#owner-pin', '135799');
  await page.click('#give');
  await page.waitForFunction(() => /Wrong PIN/.test(document.getElementById('amt-hint').textContent), null, { timeout: 15000 }).catch(() => {});
  check('…a PIN that isn’t the owner’s is refused by the server (no checkout)', /Wrong PIN/.test(await page.textContent('#amt-hint')) && /\/subscribe\/$/.test(page.url()), await page.textContent('#amt-hint'));
  await page.fill('#user', NAME);
  await page.waitForFunction(() => /already subscribed/.test(document.getElementById('hint').textContent), null, { timeout: 8000 }).catch(() => {});
  check('…and any other name is back to $6, with no PIN box', await page.isHidden('#owner-box') && (await page.textContent('#contrib [data-amt="6"]')).trim() === '$6' && (await page.textContent('#give')).trim() === 'Contribute $6.00' && !(await page.inputValue('#owner-pin')), await page.textContent('#give'));

  // …and on the owner's Subscribers card.
  const oc = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await oc.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const op = track(await oc.newPage());
  await op.goto(`http://127.0.0.1:${site.port}/`);
  await op.evaluate((c) => { (0, eval)(c); }, code);
  await op.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  for (const btn of ['#gpa-signup-btn', '#gpa-login-btn']) {   // a fresh test Worker, or one where the owner already signed up
    if (await R(op, (r) => r.querySelector('#gpa-login').style.display === 'none')) break;
    await op.fill(sr('#gpa-login-user'), 'ivan');
    await op.fill(sr('#gpa-login-pin'), '246810');
    await op.click(sr(btn));
    await op.waitForTimeout(2500);
  }
  await R(op, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  await R(op, (r, a) => {
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
  await op.waitForTimeout(2500);
  await R(op, (r) => r.querySelector('.gps-tab[data-asec="security"]').click());
  await op.waitForFunction(() => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-subs'); return b && !/Loading/.test(b.textContent) && b.querySelector('.gac-subs-totals'); }, null, { timeout: 15000 }).catch(() => {});
  const card = await R(op, (r, u) => {
    const row = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u);
    const t = r.querySelector('.gac-subs-totals');
    if (t) t.scrollIntoView({ block: 'start' });
    return { totals: t ? t.textContent.replace(/\s+/g, ' ') : '', row: row ? row.textContent.replace(/\s+/g, ' ') : '' };
  }, NAME);
  check('Owner’s Subscribers card: a “contributions” total, and “contributed $20” on their row', /\$20contributions/.test(card.totals.replace(/ /g, '')) && /contributed \$20/.test(card.row), JSON.stringify(card));
  await op.waitForTimeout(400);
  await op.screenshot({ path: path.join(OUT, '11-owner-contributions.png') });

  // …and the owner's New subscribers card: the email, the Google Doc link, Email instructions.
  await op.waitForFunction(() => { const b = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gac-emails'); return b && !/Loading/.test(b.textContent); }, null, { timeout: 15000 }).catch(() => {});
  const emRow = () => R(op, (r, u) => { const el = [...r.querySelectorAll('.gac-email-row')].find((x) => x.dataset.user === u); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }, NAME);
  check('Owner: “New subscribers” shows their school email, not shared yet', /223929@alseducation\.onmicrosoft\.com/.test(await emRow()) && /Not shared yet/.test(await emRow()), await emRow());
  check('…Share the Doc waits for the Google Doc link', await R(op, (r) => { const row = r.querySelector('.gac-email-row'); return !!row && !row.querySelector('a[data-em="share"]'); }));
  const DOC = 'https://docs.google.com/document/d/1TestDocForInstructions/edit';
  await op.fill(sr('#gac-emails-docurl'), DOC);
  await op.click(sr('#gac-emails-doc button[type="submit"]'));
  await op.waitForFunction(() => !!document.getElementById('gpa-root-host').shadowRoot.querySelector('.gac-email-row a[data-em="share"]'), null, { timeout: 10000 }).catch(() => {});
  const share = await R(op, (r, u) => { const el = [...r.querySelectorAll('.gac-email-row')].find((x) => x.dataset.user === u); const a = el && el.querySelector('a[data-em="share"]'); return a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), text: a.textContent } : {}; }, NAME);
  check('Share the Doc: opens your Google Doc (new tab) to share it with them; the card explains Share → paste → Send', share.href === DOC && share.target === '_blank' && share.text === 'Share the Doc' && /Share<\/b>, paste the email/.test(await R(op, (r) => r.querySelector('#gac-emails').innerHTML)), JSON.stringify(share));
  await R(op, (r) => { r.querySelector('#gac-emails-card').scrollIntoView({ block: 'start' }); });
  await op.waitForTimeout(300);
  await op.screenshot({ path: path.join(OUT, '12-owner-new-subscribers.png') });
  // Tapping it (the Doc opens in a new tab; here that's stopped) copies their email and marks it shared.
  await op.evaluate(() => window.addEventListener('click', (e) => { if (e.composedPath().some((n) => n.tagName === 'A' && n.getAttribute && n.getAttribute('data-em') === 'share')) e.preventDefault(); }, true));
  await R(op, (r, u) => [...r.querySelectorAll('.gac-email-row')].find((x) => x.dataset.user === u).querySelector('a[data-em="share"]').click(), NAME);
  await op.waitForFunction((u) => { const el = [...document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('.gac-email-row')].find((x) => x.dataset.user === u); return el && /Shared /.test(el.textContent); }, NAME, { timeout: 10000 }).catch(() => {});
  check('…and it’s marked “Shared”, by the owner', /Shared \w+ \d+/.test(await emRow()) && /shared by ivan/.test(await emRow()), await emRow());
  check('Their Subscribers row shows the email too', /223929@alseducation\.onmicrosoft\.com/.test(await R(op, (r, u) => { const el = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u); return el ? el.textContent : ''; }, NAME)));

  // The owner resets a forgotten PIN (Allowed users → Reset PIN): a one-time code.
  await R(op, (r, u) => { window.confirm = () => true; const row = r.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`); row.scrollIntoView({ block: 'center' }); row.querySelector('[data-acct="resetpin"]').click(); }, NAME.toLowerCase());
  await op.waitForFunction((u) => { const row = document.getElementById('gpa-root-host').shadowRoot.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`); return row && /PIN reset/.test(row.textContent); }, NAME.toLowerCase(), { timeout: 15000 }).catch(() => {});
  const resetRow = await R(op, (r, u) => { const row = r.querySelector(`#gac-allow-accts .gac-acct[data-user="${u}"]`); if (row) row.scrollIntoView({ block: 'center' }); return row ? { text: row.textContent.replace(/\s+/g, ' '), code: (row.querySelector('.gac-invite-code') || {}).textContent || '' } : null; }, NAME.toLowerCase());
  check('Owner: Reset PIN gives a one-time code with what to tell them; Copy code / Cancel reset', resetRow && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(resetRow.code) && /a new PIN and this code, then tap Sign in/.test(resetRow.text) && /Copy code/.test(resetRow.text) && /Cancel reset/.test(resetRow.text), resetRow && resetRow.text.slice(0, 220));
  await op.waitForTimeout(300);
  await op.locator(`#gpa-root-host >> #gac-allow-accts .gac-acct[data-user="${NAME.toLowerCase()}"]`).screenshot({ path: path.join(OUT, '13-owner-reset-pin.png') });
  // The subscriber forgot their PIN: on the sign-in screen they type a new one and the code.
  await cp.evaluate(() => window.dispatchEvent(new Event('focus')));
  await cp.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none', null, { timeout: 25000 }).catch(() => {});
  check('Their console is signed out by the reset', await R(cp, (r) => r.querySelector('#gpa-login').style.display !== 'none'));
  await cp.fill(sr('#gpa-login-user'), NAME);
  await cp.fill(sr('#gpa-login-pin'), '864213');
  await cp.click(sr('#gpa-login-btn'));
  await cp.waitForFunction(() => { const r = document.getElementById('gpa-root-host').shadowRoot; const w = r.querySelector('#gpa-login-invite-wrap'); return w && !w.hidden; }, null, { timeout: 15000 }).catch(() => {});
  const askMsg = await R(cp, (r) => ({ box: !r.querySelector('#gpa-login-invite-wrap').hidden, msg: r.querySelector('#gpa-login-msg').textContent }));
  const askLabel = await R(cp, (r) => r.querySelector('#gpa-login-invite-label').textContent);
  check('A new PIN asks for the reset code: “The owner reset the PIN… type the new PIN and the reset code”', askMsg.box && /The owner reset the PIN for/.test(askMsg.msg) && askLabel === 'Reset code (from the owner)', JSON.stringify(askMsg) + ' ' + askLabel);
  await cp.fill(sr('#gpa-login-invite'), resetRow ? resetRow.code : '');
  await cp.screenshot({ path: path.join(OUT, '14-user-enters-reset-code.png') });
  await cp.click(sr('#gpa-login-btn'));
  const backIn = await cp.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display === 'none', null, { timeout: 20000 }).then(() => true, () => false);
  check('With the code, the new PIN works: they’re back in, same account (still subscribed)', backIn && await cp.waitForFunction(() => { const s2 = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-substrip'); return s2 && !s2.hidden; }, null, { timeout: 25000 }).then(() => true, () => false), await R(cp, (r) => r.querySelector('#gpa-login-msg').textContent));
  // Forgot PIN, and the owner can't reach them: they ask from the sign-in screen; the owner approves.
  await admin('/admin/user/action', { u: NAME.toLowerCase(), action: 'revokesessions' });
  await cp.evaluate(() => window.dispatchEvent(new Event('focus')));
  await cp.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none', null, { timeout: 25000 }).catch(() => {});
  await cp.waitForTimeout(17000);   // past a status check while signed out
  check('Signed out from elsewhere, the sign-in screen isn’t covered by “Blocked by the owner”', await R(cp, (r) => !/Blocked by the owner/.test(r.textContent.replace(r.querySelector('#gpa-login').textContent, '')) && ![...r.querySelectorAll('div')].some((d) => d.style && d.style.zIndex === '2147483000' && d.style.display !== 'none')));
  await cp.fill(sr('#gpa-login-user'), NAME);
  await cp.click(sr('#gpa-login-forgot'));
  check('Sign-in has “Forgot PIN?”: student number, a new PIN (twice), a message, “Reset my PIN”', await R(cp, (r) => !r.querySelector('#gpa-forgot').hidden && r.querySelector('#gpa-login-pin').hidden && r.querySelector('#gpa-login-btn').hidden && !!r.querySelector('#gpa-forgot-sid') && !!r.querySelector('#gpa-forgot-send')));
  await cp.fill(sr('#gpa-forgot-sid'), '223929');
  await cp.fill(sr('#gpa-forgot-pin'), '975310'); await cp.fill(sr('#gpa-forgot-pin2'), '975310');
  await cp.screenshot({ path: path.join(OUT, '15-forgot-pin-form.png') });
  await cp.click(sr('#gpa-forgot-send'));
  const autoIn = await cp.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display === 'none', null, { timeout: 30000 }).then(() => true, () => false);
  check('The student number from the subscribe page (223929) matches: the new PIN works at once, they’re signed in', autoIn, await R(cp, (r) => r.querySelector('#gpa-login-msg').textContent));
  const newPinOk = await fetch(env.workerUrl + '/admin/user?u=' + NAME.toLowerCase(), { headers: { Authorization: 'Bearer ' + ADMIN } }).then((r) => r.json());
  check('…and the account is the same one (created earlier, still theirs)', newPinOk && newPinOk.account && newPinOk.account.createdAt > 0 && newPinOk.account.createdAt < Date.now() - 30e3, JSON.stringify(newPinOk && newPinOk.account && { createdAt: newPinOk.account.createdAt }));
  for (const [n, p] of [['subscribe page', page], ['console', cp], ['owner console', op]]) check(`No page errors (${n})`, p._errors.length === 0, p._errors.slice(0, 2).join(' | '));
  await ctx.close(); await pc.close(); await oc.close();
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
