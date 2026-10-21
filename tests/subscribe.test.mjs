// Subscribe app (/subscribe/): pay with Stripe → the username is approved as
// a monthly subscriber. Stripe is a stub that answers in the shape of its API,
// and webhooks are signed the way Stripe signs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { stripeSign, stripeSignatureOk, periodEndMs, invoiceSubscription, checkoutParams, priceCents } from '../web/subscribe.js';

function makeKV() {
  const store = new Map();
  return { store, async get(k, t) { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { store.set(k, String(v)); }, async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } };
}
const ADMIN = 'admin-token-very-secret-1234';
const owner = { Authorization: 'Bearer ' + ADMIN };
const WHSEC = 'whsec_test_secret_123';
const DAY = 864e5;

function stubStripe() {
  const real = globalThis.fetch;
  const sessions = new Map();
  const idem = new Map();
  const calls = [];
  let n = 0;
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input && input.url || input);
    if (!u.startsWith('https://api.stripe.com/')) return real(input, init);
    const hd = init.headers || {};
    calls.push({ url: u, method: init.method, body: init.body ? String(init.body) : '', auth: hd.Authorization, version: hd['Stripe-Version'], idem: hd['Idempotency-Key'] });
    const path = new URL(u).pathname;
    if (path === '/v1/prices/price_monthly15' && init.method === 'GET') return Response.json({ id: 'price_monthly15', object: 'price', unit_amount: 1500, currency: 'usd', recurring: { interval: 'month' } });
    if (path === '/v1/checkout/sessions' && init.method === 'POST') {
      // Idempotency: the same key gives back the same session.
      if (hd['Idempotency-Key'] && idem.has(hd['Idempotency-Key'])) return Response.json(sessions.get(idem.get(hd['Idempotency-Key'])));
      const p = new URLSearchParams(String(init.body));
      const id = 'cs_test_' + 'a'.repeat(20) + (++n);
      const s = { id, object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/' + id, mode: p.get('mode'), client_reference_id: p.get('client_reference_id'), metadata: { user: p.get('metadata[user]'), ...(p.get('metadata[kind]') ? { kind: p.get('metadata[kind]') } : {}) },
        amount_total: Number(p.get('line_items[0][price_data][unit_amount]')), status: 'open', payment_status: 'unpaid', customer: null, subscription: null };
      sessions.set(id, s);
      if (hd['Idempotency-Key']) idem.set(hd['Idempotency-Key'], id);
      return Response.json(s);
    }
    let m = /^\/v1\/checkout\/sessions\/(cs_test_\w+)$/.exec(path);
    if (m) { const s = sessions.get(m[1]); return s ? Response.json(s) : Response.json({ error: { message: 'No such session' } }, { status: 404 }); }
    m = /^\/v1\/subscriptions\/(sub_\w+)$/.exec(path);
    if (m) return Response.json({ id: m[1], object: 'subscription', items: { data: [{ current_period_end: Math.floor((Date.now() + 30 * DAY) / 1000) }] } });
    return Response.json({ error: { message: 'unknown' } }, { status: 404 });
  };
  // Stripe completing a checkout (the buyer paid).
  const pay = (id) => { const s = sessions.get(id); Object.assign(s, { status: 'complete', payment_status: 'paid', customer: 'cus_123', subscription: 'sub_123' }); return s; };
  return { calls, sessions, pay, restore: () => { globalThis.fetch = real; } };
}
function setup(extra = {}) {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: WHSEC, ...extra };
  const call = async (path, { method = 'GET', headers = {}, body, raw } = {}) => {
    const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: raw != null ? raw : body == null ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await res.text();
    let data = {}; try { data = JSON.parse(text); } catch (e) { data = {}; }
    return { status: res.status, data, text, headers: res.headers };
  };
  const hook = async (event, { secret = WHSEC, t = Math.floor(Date.now() / 1000) } = {}) => {
    const payload = JSON.stringify(event);
    const sig = await stripeSign(secret, t, payload);
    return call('/subscribe/webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}`, 'Content-Type': 'application/json' }, raw: payload });
  };
  const cfg = async () => (await call('/admin/subscriptions', { method: 'POST', headers: owner, body: { action: 'list' } })).data;
  return { env, call, hook, cfg };
}

test('subscribe: Stripe pieces (signature, periods, price)', async () => {
  const payload = '{"id":"evt_1"}', t = Math.floor(Date.now() / 1000);
  const sig = await stripeSign(WHSEC, t, payload);
  assert.equal(await stripeSignatureOk(WHSEC, `t=${t},v1=${sig}`, payload), true);
  assert.equal(await stripeSignatureOk(WHSEC, `t=${t},v1=${sig}`, payload + ' '), false, 'body changed');
  assert.equal(await stripeSignatureOk('whsec_other', `t=${t},v1=${sig}`, payload), false, 'wrong secret');
  assert.equal(await stripeSignatureOk(WHSEC, `t=${t - 600},v1=${await stripeSign(WHSEC, t - 600, payload)}`, payload), false, 'too old (replay)');
  assert.equal(periodEndMs({ current_period_end: 1800000000 }), 1800000000000);
  assert.equal(periodEndMs({ items: { data: [{ current_period_end: 1800000001 }] } }), 1800000001000, 'newer API: on the item');
  assert.equal(periodEndMs({ object: 'invoice', lines: { data: [{ period: { end: 1800000002 } }] } }), 1800000002000);
  assert.deepEqual(invoiceSubscription({ parent: { subscription_details: { subscription: 'sub_9', metadata: { user: 'kj' } } } }), { id: 'sub_9', user: 'kj' });
  assert.equal(priceCents({}), 1380, '$13.80 so $13.00 is left after fees');
  assert.equal(priceCents({ SUB_PRICE_CENTS: '1500' }), 1500);
  const p = checkoutParams({}, 'https://w.test', 'kj');
  assert.equal(p.mode, 'subscription');
  assert.equal(p.line_items[0].price_data.recurring.interval, 'month');
  assert.equal(p.line_items[0].price_data.unit_amount, 1380);
  assert.equal(p.success_url, 'https://w.test/subscribe/?done={CHECKOUT_SESSION_ID}');
});

test('subscribe: pay → approved as a monthly subscriber; sign-up code; renewals; cancel', async () => {
  const st = stubStripe();
  const t = setup();
  const paid = (c) => c.subscriptions.filter((x) => !x.auto);
  try {
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['old'] } } });
    // The page.
    const page = await t.call('/subscribe/');
    assert.equal(page.status, 200);
    assert.match(page.text, /\$13\.80 <small>\/ month<\/small>/);
    assert.equal(page.headers.get('X-Frame-Options'), 'DENY');
    // Names.
    assert.equal((await t.call('/subscribe/check?user=boss')).data.ok, false, 'the owner’s name');
    // "old" is on Allowed users without a subscription: an automatic month (to the 1st), so they may pay.
    const old = (await t.call('/subscribe/check?user=old')).data;
    assert.equal(old.ok, true, 'on an automatic month: may subscribe');
    assert.match(old.note, /has free access until .+ Subscribing starts your paid month now/);
    assert.equal(old.canContribute, undefined, 'not a paying subscriber, so no contribution');
    assert.equal((await t.call('/subscribe/check?user=bad%20name')).data.ok, false);
    assert.equal((await t.call('/subscribe/check?user=newkid')).data.ok, true);
    // Checkout.
    const co = await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'NewKid' } });
    assert.equal(co.status, 200, JSON.stringify(co.data));
    assert.match(co.data.url, /^https:\/\/checkout\.stripe\.com\//);
    const created = st.calls.find((c) => c.url.endsWith('/v1/checkout/sessions'));
    assert.equal(created.auth, 'Bearer sk_test_abc');
    assert.match(created.body, /line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1380/);
    const sid = [...st.sessions.keys()][0];
    // While someone is paying for a name, nobody else can start paying for it.
    assert.equal((await t.call('/subscribe/check?user=newkid')).data.ok, false);
    // Not paid yet: not approved.
    assert.equal((await t.call('/subscribe/status?session=' + sid)).data.pending, true);
    assert.equal(paid(await t.cfg()).length, 0);
    // A forged webhook (wrong secret) changes nothing.
    const forged = await t.hook({ id: 'evt_x', type: 'checkout.session.completed', data: { object: { ...st.sessions.get(sid), status: 'complete', payment_status: 'paid', subscription: 'sub_123' } } }, { secret: 'whsec_wrong' });
    assert.equal(forged.status, 400);
    assert.equal(paid(await t.cfg()).length, 0);
    // Stripe: paid.
    const s = st.pay(sid);
    const ok = await t.hook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s } });
    assert.equal(ok.status, 200);
    let c = await t.cfg();
    assert.equal(paid(c).length, 1);
    const sub = paid(c)[0];
    assert.equal(sub.user, 'NewKid');
    assert.equal(sub.active, true);
    assert.ok(sub.expiresAt > Date.now() + 30 * DAY, 'until the paid period ends (+1 day grace)');
    assert.equal(sub.autoRenew, true);
    assert.deepEqual(c.ledger.map((x) => [x.user, x.amount]), [['NewKid', 13.8]]);
    const conf = (await t.call('/admin/config/view', { headers: owner })).data.config;
    assert.ok(conf.allowlist.users.includes('newkid'), 'on Allowed users');
    // The same webhook again (Stripe retries): no double charge in the ledger.
    await t.hook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s } });
    await t.hook({ id: 'evt_1b', type: 'checkout.session.completed', data: { object: s } });
    assert.equal((await t.cfg()).ledger.length, 1);
    // The buyer's page: approved, with a one-time sign-up code.
    const status = (await t.call('/subscribe/status?session=' + sid)).data;
    assert.equal(status.approved, true);
    assert.equal(status.user, 'NewKid');
    assert.match(status.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Creating the account needs that code (nobody else can grab the paid name).
    const v = 'f'.repeat(64);
    assert.equal((await t.call('/auth/register', { method: 'POST', body: { user: 'newkid', verifier: v } })).data.inviteRequired, true);
    const reg = await t.call('/auth/register', { method: 'POST', body: { user: 'NewKid', verifier: v, invite: status.code } });
    assert.equal(reg.status, 200, JSON.stringify(reg.data));
    // Monthly renewal (invoice.paid, subscription_cycle).
    const end2 = Math.floor((Date.now() + 61 * DAY) / 1000);
    await t.hook({ id: 'evt_2', type: 'invoice.paid', data: { object: { id: 'in_2', object: 'invoice', billing_reason: 'subscription_cycle', amount_paid: 1380, parent: { subscription_details: { subscription: 'sub_123', metadata: { user: 'NewKid' } } }, lines: { data: [{ period: { end: end2 } }] } } } });
    c = await t.cfg();
    assert.equal(paid(c)[0].expiresAt, end2 * 1000 + DAY);
    assert.deepEqual(c.ledger.map((x) => x.amount), [13.8, 13.8]);
    // The first invoice (subscription_create) is the checkout payment: not counted twice.
    await t.hook({ id: 'evt_3', type: 'invoice.paid', data: { object: { id: 'in_1', object: 'invoice', billing_reason: 'subscription_create', amount_paid: 1380, parent: { subscription_details: { subscription: 'sub_123', metadata: { user: 'NewKid' } } }, lines: { data: [{ period: { end: end2 } }] } } } });
    assert.equal((await t.cfg()).ledger.length, 2);
    // They turn off renewal: still active until the end, but no longer renewing.
    await t.hook({ id: 'evt_4', type: 'customer.subscription.updated', data: { object: { id: 'sub_123', object: 'subscription', cancel_at_period_end: true, metadata: { user: 'NewKid' } } } });
    assert.equal(paid(await t.cfg())[0].autoRenew, false);
    assert.equal(paid(await t.cfg())[0].active, true);
    // The subscription ends: access ends at the next sweep (within 5 minutes).
    await t.hook({ id: 'evt_5', type: 'customer.subscription.deleted', data: { object: { id: 'sub_123', object: 'subscription', metadata: { user: 'NewKid' } } } });
    await worker.scheduled({ cron: '*/5 * * * *' }, t.env, { waitUntil() {} });
    await new Promise((r) => setTimeout(r, 50));
    c = await t.cfg();
    assert.equal(paid(c)[0].active, false);
    assert.ok(!(await t.call('/admin/config/view', { headers: owner })).data.config.allowlist.users.includes('newkid'), 'off Allowed users');
  } finally { st.restore(); }
});

test('subscribe: the status page can approve on its own if the webhook is late; closed without Stripe keys', async () => {
  const st = stubStripe();
  try {
    const t = setup();
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: [] } } });
    await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'sam' } });
    const sid = [...st.sessions.keys()][0];
    st.pay(sid);
    const s = (await t.call('/subscribe/status?session=' + sid)).data;
    assert.equal(s.approved, true, 'asked Stripe directly');
    assert.equal((await t.cfg()).subscriptions[0].user, 'sam');
    // The webhook arriving afterwards changes nothing.
    await t.hook({ id: 'evt_9', type: 'checkout.session.completed', data: { object: st.sessions.get(sid) } });
    assert.equal((await t.cfg()).ledger.length, 1);
    assert.equal((await t.call('/subscribe/status?session=nope')).status, 400);
    // No Stripe keys on the Worker: the page says it's closed and checkout is refused.
    const off = setup({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
    assert.match((await off.call('/subscribe/')).text, /Subscriptions aren’t open yet/);
    assert.equal((await off.call('/subscribe/checkout', { method: 'POST', body: { user: 'sam' } })).status, 503);
  } finally { st.restore(); }
});

test('subscribe: API version pinned, sessions tagged, double taps reuse the checkout, Dashboard price, failed renewals', async () => {
  const st = stubStripe();
  try {
    const t = setup({ STRIPE_PRICE_ID: 'price_monthly15' });
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: [] } } });
    // The page shows the Dashboard Price's amount.
    assert.match((await t.call('/subscribe/')).text, /\$15\.00 <small>\/ month<\/small>/);
    // Same visit, double tap: one checkout, and the name isn't locked against its own buyer.
    const attempt = 'abcdefghijklmnop1234';
    const a = await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'tapper', attempt } });
    assert.equal((await t.call('/subscribe/check?user=tapper&attempt=' + attempt)).data.ok, true, 'their own checkout doesn’t block them');
    assert.equal((await t.call('/subscribe/check?user=tapper&attempt=zzzzzzzzzzzzzzzzzzzz')).data.ok, false, 'someone else is still blocked');
    const b = await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'tapper', attempt } });
    assert.equal(a.data.url, b.data.url, 'same checkout back');
    assert.equal(st.sessions.size, 1);
    const posts = st.calls.filter((c) => c.url.endsWith('/v1/checkout/sessions'));
    assert.equal(posts.length, 1, 'the second tap gets the open checkout back without asking Stripe again');
    assert.ok(posts[0].idem && posts[0].idem.startsWith('subscribe-'), 'Idempotency-Key');
    const exp = Number(new URLSearchParams(posts[0].body).get('expires_at'));
    assert.ok(Math.abs(exp - (Date.now() / 1000 + 31 * 60)) < 30, 'the checkout expires after 31 minutes');
    assert.ok(st.calls.every((c) => c.version === '2026-08-26.dahlia'), 'every call pinned to one API version');
    const p = new URLSearchParams(posts[0].body);
    assert.equal(p.get('line_items[0][price]'), 'price_monthly15', 'the Dashboard Price');
    assert.equal(p.get('line_items[0][price_data][unit_amount]'), null);
    assert.equal(p.get('integration_identifier'), 'agent-console-subscribe-qhxmtwbr');
    assert.equal(p.get('payment_method_types[0]'), null, 'the Dashboard decides payment methods');
    // Paid, then a renewal fails: recorded on the subscription (and the owner is told).
    const sid = [...st.sessions.keys()][0];
    await t.hook({ id: 'evt_p1', type: 'checkout.session.completed', data: { object: st.pay(sid) } });
    await t.hook({ id: 'evt_f1', type: 'invoice.payment_failed', data: { object: { id: 'in_f', object: 'invoice', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_123', metadata: { user: 'tapper' } } } } } });
    const sub = (await t.cfg()).subscriptions[0];
    assert.ok(sub.paymentFailedAt > 0);
    assert.equal(sub.history.at(-1).action, 'payment_failed');
    assert.equal(sub.active, true, 'still active while Stripe retries');
  } finally { st.restore(); }
});

test('subscribe: Terms, Refund & Cancellation and Privacy pages; contact email; renewal disclosure', async () => {
  const st = stubStripe();
  try {
    const t = setup();
    const page = (await t.call('/subscribe/')).text;
    for (const href of ['/subscribe/terms', '/subscribe/refunds', '/subscribe/privacy']) assert.ok(page.includes(`href="${href}"`), 'footer links ' + href);
    assert.match(page, /mailto:viztrrx@gmail\.com/, 'contact email');
    assert.match(page, /charged \$13\.80 USD today and then every month until you cancel\. Payments are non-refundable\./, 'auto-renewal and no-refund disclosure by the button');
    const refunds = await t.call('/subscribe/refunds');
    assert.equal(refunds.status, 200);
    assert.equal(refunds.headers.get('X-Frame-Options'), 'DENY');
    assert.match(refunds.text, /<h1>Refund &amp; Cancellation Policy<\/h1>/);
    assert.match(refunds.text, /\$13\.80 USD a month/);
    assert.match(refunds.text, /All payments are final and non-refundable/);
    assert.match(refunds.text, /Billing errors are the only exception/);
    assert.ok(!/7 days|7-day/.test(refunds.text), 'no refund window any more');
    assert.match(refunds.text, /How to cancel/);
    assert.match((await t.call('/subscribe/terms')).text, /<h1>Terms of Service<\/h1>[\s\S]*Acceptable use/);
    assert.match((await t.call('/subscribe/privacy/')).text, /<h1>Privacy Policy<\/h1>[\s\S]*don’t sell/);
    assert.equal((await t.call('/subscribe/cookies')).status, 404, 'only the three pages');
    // The Dashboard price shows on the policies too; a custom contact email.
    const priced = setup({ STRIPE_PRICE_ID: 'price_monthly15', SUPPORT_EMAIL: 'help@saints.example' });
    const r2 = (await priced.call('/subscribe/refunds')).text;
    assert.match(r2, /\$15\.00 USD a month/);
    assert.match(r2, /mailto:help@saints\.example/);
    assert.ok(!r2.includes('viztrrx@gmail.com'));
    // A portal link adds the online way to cancel.
    const portal = setup({ STRIPE_PORTAL_URL: 'https://billing.stripe.com/p/login/test_abc' });
    assert.match((await portal.call('/subscribe/refunds')).text, /billing\.stripe\.com\/p\/login\/test_abc[\s\S]*By email/);
    // Open to everyone even before subscriptions open.
    const off = setup({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
    const offTerms = await off.call('/subscribe/terms');
    assert.equal(offTerms.status, 200);
    assert.match(offTerms.text, /\$13\.80 USD a month/);
    // Stripe's checkout shows the renewal terms above its pay button.
    await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'kim' } });
    const sent = st.calls.find((c) => new URL(c.url).pathname === '/v1/checkout/sessions' && c.method === 'POST');
    assert.match(decodeURIComponent(sent.body.replace(/\+/g, ' ')), /custom_text\[submit\]\[message\]=Renews automatically every month until you cancel\..*non-refundable/);
  } finally { st.restore(); }
});

test('subscribe: members who already pay can add a one-time contribution ($6–$500); it never buys a subscription', async () => {
  const st = stubStripe();
  try {
    const t = setup();
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: [] } } });
    // kj subscribes and creates their account; "nokey" pays but has no account yet.
    const join = async (user) => {
      await t.call('/subscribe/checkout', { method: 'POST', body: { user } });
      const sid = [...st.sessions.keys()].pop();
      st.pay(sid);
      return (await t.call('/subscribe/status?session=' + sid)).data;
    };
    const kj = await join('kj');
    assert.equal(kj.approved, true);
    assert.equal((await t.call('/auth/register', { method: 'POST', body: { user: 'kj', verifier: 'a'.repeat(64), invite: kj.code } })).status, 200);
    await join('nokey');
    // The page's name check: kj can contribute; nokey (no account) and strangers can't.
    const chk = (await t.call('/subscribe/check?user=kj')).data;
    assert.equal(chk.ok, false);
    assert.equal(chk.canContribute, true);
    assert.match(chk.error, /already subscribed/);
    const nk = (await t.call('/subscribe/check?user=nokey')).data;
    assert.deepEqual([nk.ok, nk.canContribute, nk.hasAccount], [false, true, false], 'already paid, no account yet: still only a contribution');
    assert.equal(chk.hasAccount, true);
    assert.equal((await t.call('/subscribe/check?user=stranger')).data.ok, true);
    // Amount and member checks.
    const give = (body) => t.call('/subscribe/contribute', { method: 'POST', body });
    assert.equal((await give({ user: 'kj', cents: 599 })).status, 400, 'under $6');
    assert.equal((await give({ user: 'kj', cents: 50001 })).status, 400, 'over $500');
    assert.equal((await give({ user: 'kj', cents: 10.5 })).status, 400, 'whole cents only');
    assert.equal((await give({ user: 'kj', cents: 'lots' })).status, 400);
    const strangerGive = await give({ user: 'stranger', cents: 1000 });
    assert.equal(strangerGive.status, 409, 'not a member');
    assert.match(strangerGive.data.error, /only for subscribers\. Subscribe first/);
    // kj gives $10: a one-time checkout, tagged as a contribution.
    const before = (await t.cfg()).subscriptions.find((x) => x.user === 'kj');
    const r = await give({ user: 'kj', cents: 1000, attempt: 'a'.repeat(20) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const call = st.calls.filter((c) => new URL(c.url).pathname === '/v1/checkout/sessions' && c.method === 'POST').pop();
    const sent = new URLSearchParams(call.body);
    assert.equal(sent.get('mode'), 'payment');
    assert.equal(sent.get('metadata[kind]'), 'contribution');
    assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '1000');
    assert.match(sent.get('success_url'), /\/subscribe\/\?thanks=\{CHECKOUT_SESSION_ID\}$/);
    assert.match(sent.get('custom_text[submit][message]'), /One-time contribution.*isn’t tax-deductible.*non-refundable/);
    assert.ok(call.idem && call.idem.startsWith('contribute-'), 'double taps reuse the checkout');
    const cid = [...st.sessions.keys()].pop();
    assert.equal((await t.call('/subscribe/status?session=' + cid)).data.pending, true, 'not paid yet');
    // Paid: the thank-you page gets the amount; the ledger gets a contribution; the subscription doesn't change.
    st.pay(cid);
    const thanks = (await t.call('/subscribe/status?session=' + cid)).data;
    assert.deepEqual([thanks.contribution, thanks.paid, thanks.amount, thanks.user, thanks.approved], [true, true, 10, 'kj', undefined]);
    await t.hook({ id: 'evt_c1', type: 'checkout.session.completed', data: { object: st.sessions.get(cid) } });
    let c = await t.cfg();
    assert.deepEqual(c.ledger.filter((x) => x.action === 'contribution').map((x) => [x.user, x.amount]), [['kj', 10]], 'counted once');
    assert.equal(c.subscriptions.length, 2);
    assert.equal(c.subscriptions.find((x) => x.user === 'kj').expiresAt, before.expiresAt, 'subscription untouched');
    // Only the webhook (page closed early): still recorded.
    await give({ user: 'kj', cents: 2500 });
    const cid2 = [...st.sessions.keys()].pop();
    await t.hook({ id: 'evt_c2', type: 'checkout.session.completed', data: { object: st.pay(cid2) } });
    c = await t.cfg();
    assert.deepEqual(c.ledger.filter((x) => x.action === 'contribution').map((x) => x.amount), [10, 25]);
    // A one-time payment never approves anyone, contribution-tagged or not.
    for (const [id, metadata] of [['cs_test_' + 'z'.repeat(20) + '1', { user: 'freebie', kind: 'contribution' }], ['cs_test_' + 'z'.repeat(20) + '2', { user: 'freebie2' }]]) {
      st.sessions.set(id, { id, object: 'checkout.session', mode: 'payment', client_reference_id: metadata.user, metadata, amount_total: 800, status: 'complete', payment_status: 'paid' });
      await t.call('/subscribe/status?session=' + id);
      await t.hook({ id: 'evt_' + id.slice(-1) + 'x', type: 'checkout.session.completed', data: { object: st.sessions.get(id) } });
    }
    c = await t.cfg();
    assert.ok(!c.subscriptions.some((x) => /^freebie/.test(x.user)), 'no subscription from a one-time payment');
    const conf = (await t.call('/admin/config/view', { headers: owner })).data.config;
    assert.ok(!conf.allowlist.users.some((u) => /^freebie/.test(u)), 'not on Allowed users');
  } finally { st.restore(); }
});

test('subscribe: only the owner, with their PIN, can make a test contribution from $1', async () => {
  const st = stubStripe();
  try {
    const t = setup({ OWNER_CODE: 'own-code' });
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: [] } } });
    const give = (body, ip = '1.2.3.4') => t.call('/subscribe/contribute', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body });
    // The owner's name: never a subscription, but the page offers the test.
    const chk = (await t.call('/subscribe/check?user=Boss')).data;
    assert.deepEqual([chk.ok, chk.ownerTest, chk.canContribute], [false, true, undefined]);
    const sub = await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'boss' } });
    assert.ok(sub.status >= 400 && !sub.data.url, 'can’t subscribe as the owner');
    // No owner account yet: refused, whatever verifier is sent.
    assert.equal((await give({ user: 'boss', cents: 100, verifier: 'b'.repeat(64) })).status, 401);
    const V = 'c'.repeat(64);
    assert.equal((await t.call('/auth/register', { method: 'POST', headers: { 'X-GPA-Owner': 'own-code' }, body: { user: 'boss', verifier: V } })).status, 200);
    assert.equal((await give({ user: 'boss', cents: 100 })).status, 401, 'no PIN');
    const wrong = await give({ user: 'boss', cents: 100, verifier: 'd'.repeat(64) });
    assert.equal(wrong.status, 401);
    assert.match(wrong.data.error, /Wrong PIN/);
    assert.equal((await give({ user: 'boss', cents: 99, verifier: V })).status, 400, 'under $1');
    assert.equal((await give({ user: 'boss', cents: 50001, verifier: V })).status, 400, 'over $500');
    // The right PIN: a $1 checkout, tagged as a contribution from the owner.
    const r = await give({ user: 'boss', cents: 100, verifier: V });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const call = st.calls.filter((c) => new URL(c.url).pathname === '/v1/checkout/sessions' && c.method === 'POST').pop();
    const sent = new URLSearchParams(call.body);
    assert.deepEqual([sent.get('mode'), sent.get('metadata[kind]'), sent.get('metadata[user]'), sent.get('line_items[0][price_data][unit_amount]')], ['payment', 'contribution', 'boss', '100']);
    const cid = [...st.sessions.keys()].pop();
    st.pay(cid);
    const thanks = (await t.call('/subscribe/status?session=' + cid)).data;
    assert.deepEqual([thanks.contribution, thanks.paid, thanks.amount, thanks.approved], [true, true, 1, undefined]);
    const c = await t.cfg();
    assert.deepEqual(c.ledger.filter((x) => x.action === 'contribution').map((x) => [x.user, x.amount]), [['boss', 1]]);
    assert.ok(!c.subscriptions.some((x) => x.user === 'boss'), 'no subscription for the owner');
    // Everyone else still starts at $6, and $1 isn't open to members.
    assert.equal((await give({ user: 'kj', cents: 100, verifier: V })).status, 400);
    // Guessing the owner's PIN counts against the owner's account like signing
    // in does: 8 wrong (from any networks) lock it, even for the right PIN.
    for (let i = 0; i < 8; i++) await give({ user: 'boss', cents: 100, verifier: 'e'.repeat(64) }, '9.9.9.' + i);
    const lockedOut = await give({ user: 'boss', cents: 100, verifier: V }, '8.8.8.8');
    assert.equal(lockedOut.status, 423, 'locked even with the right PIN');
    assert.equal(lockedOut.data.accountLocked, true);
  } finally { st.restore(); }
});

test('subscribe: a paid-up name can’t be bought twice; a new subscriber makes their own PIN on the page', async () => {
  const st = stubStripe();
  try {
    const t = setup();
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: [] } } });
    // Pay for "pia".
    const attempt = 'q'.repeat(20);
    await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'pia', attempt } });
    const sid = [...st.sessions.keys()].pop();
    st.pay(sid);
    const status = (await t.call('/subscribe/status?session=' + sid)).data;
    assert.equal(status.approved, true);
    assert.match(status.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/, 'kept as the in-app fallback');
    // Paid up: checkout refuses a second subscription (any visit), and says why.
    for (const a of [attempt, 'w'.repeat(20), undefined]) {
      const again = await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'PIA', attempt: a } });
      assert.equal(again.status, 409);
      assert.match(again.data.error, /already subscribed for this month, so it can’t be paid for again/);
    }
    assert.equal(st.sessions.size, 1, 'no second checkout was made');
    // The PIN page: needs a real checkout id and a verifier (never the PIN).
    const mk = (body) => t.call('/subscribe/account', { method: 'POST', body });
    const v = 'b'.repeat(64);
    assert.equal((await mk({ session: sid, verifier: '1234' })).status, 400, 'a PIN is refused; only the 64-hex verifier');
    assert.equal((await mk({ session: 'cs_test_' + 'n'.repeat(20), verifier: v })).status, 404, 'unknown checkout');
    const made = await mk({ session: sid, verifier: v });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    assert.equal(made.data.user, 'pia');
    // It's a normal account: signing in with the same verifier works; the sign-up code is used up.
    const login = await t.call('/auth/login', { method: 'POST', body: { user: 'pia', verifier: v } });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.ok(login.data.token);
    assert.equal((await t.call('/auth/login', { method: 'POST', body: { user: 'pia', verifier: 'c'.repeat(64) } })).status, 401, 'a different PIN doesn’t work');
    const twice = await mk({ session: sid, verifier: 'd'.repeat(64) });
    assert.equal(twice.status, 409, 'only once');
    assert.equal(twice.data.exists, true);
    const after = (await t.call('/subscribe/status?session=' + sid)).data;
    assert.deepEqual([after.approved, after.account, after.code], [true, true, ''], 'the page now says “sign in”');
    // A name that already had an account (re-subscribing) never gets a PIN form.
    await t.call('/admin/subscriptions', { method: 'POST', headers: owner, body: { action: 'end', user: 'pia' } });
    // Contribution and duplicate checkout ids can't be used to make accounts.
    const cid = 'cs_test_' + 'k'.repeat(20) + '9';
    await t.env.TELEMETRY.put('subpay:' + cid, JSON.stringify({ user: 'ghost', contribution: true, paid: true, amount: 8 }));
    assert.equal((await mk({ session: cid, verifier: v })).status, 404);
    // Two payments raced for one name: the second adds no time, is flagged as a duplicate to refund.
    await t.call('/admin/subscriptions', { method: 'POST', headers: owner, body: { action: 'add', user: 'ray', period: '1m', amount: 14, note: 'cash' } });
    const before = (await t.cfg()).subscriptions.find((x) => x.user === 'ray');
    const dupId = 'cs_test_' + 'd'.repeat(20) + '7';
    st.sessions.set(dupId, { id: dupId, object: 'checkout.session', mode: 'subscription', client_reference_id: 'ray', metadata: { user: 'ray' }, amount_total: 1400, status: 'complete', payment_status: 'paid', customer: 'cus_9', subscription: 'sub_dup' });
    await t.hook({ id: 'evt_dup', type: 'checkout.session.completed', data: { object: st.sessions.get(dupId) } });
    const dup = (await t.call('/subscribe/status?session=' + dupId)).data;
    assert.deepEqual([dup.duplicate, dup.code], [true, '']);
    const c = await t.cfg();
    assert.equal(c.subscriptions.find((x) => x.user === 'ray').expiresAt, before.expiresAt, 'no extra time');
    assert.deepEqual(c.ledger.filter((x) => x.user === 'ray').map((x) => [x.action, x.amount]), [['add', 14], ['duplicate', 14]]);
    assert.equal((await mk({ session: dupId, verifier: v })).status, 404, 'a duplicate can’t make an account either');
    // An expired checkout (after its 31 minutes) is replaced by a fresh one, not reused.
    const z = 'z'.repeat(20);
    await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'zed', attempt: z } });
    const hold = await t.env.TELEMETRY.get('subhold:zed', 'json');
    const same = await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'zed', attempt: z } });
    assert.equal(same.data.url, hold.url, 'while it’s open: the same checkout');
    const realNow = Date.now;
    Date.now = () => realNow() + 32 * 60e3;   // 32 minutes later
    let fresh;
    try { fresh = await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'zed', attempt: z } }); } finally { Date.now = realNow; }
    assert.equal(fresh.status, 200);
    assert.notEqual(fresh.data.url, hold.url, 'a new checkout');
  } finally { st.restore(); }
});

test('subscribe: after the PIN, a new subscriber adds their school email (6 digits); the owner and admins see it and send the instructions', async () => {
  const st = stubStripe();
  try {
    const t = setup();
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: [] } } });
    // The page: a must-remember warning, the checkbox, and the email box with the fixed domain.
    const page = (await t.call('/subscribe/')).text;
    assert.match(page, /You must remember this PIN\./);
    assert.match(page, /Nobody can look it up, not even the owner\. If you forget it, you’ll be locked out until you ask the owner to reset it\./);
    assert.match(page, /no 1234, 0000, 1111, 1212, your birthday/);
    assert.match(page, /id="pin-ok"/);
    assert.match(page, /<input id="sid" inputmode="numeric" pattern="\[0-9\]\{6\}" maxlength="6"/);
    assert.match(page, /<span id="sid-dom">@alseducation\.onmicrosoft\.com<\/span>/);
    // Pay for "sam".
    await t.call('/subscribe/checkout', { method: 'POST', body: { user: 'sam', attempt: 's'.repeat(20) } });
    const sid = [...st.sessions.keys()].pop();
    st.pay(sid);
    assert.equal((await t.call('/subscribe/status?session=' + sid)).data.approved, true);
    const em = (studentId, session = sid) => t.call('/subscribe/email', { method: 'POST', body: { session, studentId } });
    // Before the PIN: not yet.
    assert.equal((await em('223929')).status, 409);
    assert.equal((await t.call('/subscribe/account', { method: 'POST', body: { session: sid, verifier: 'e'.repeat(64) } })).status, 200);
    // Only exactly 6 digits.
    for (const bad of ['22392', '2239290', '22a929', '223929@alseducation.onmicrosoft.com', ' ', '', 223929.5]) {
      const r = await em(bad);
      assert.equal(r.status, 400, String(bad));
      assert.match(r.data.error, /6 digits/);
    }
    assert.equal((await em('223929', 'cs_test_' + 'u'.repeat(20))).status, 404, 'unknown checkout');
    const ok = await em('223929');
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.email, '223929@alseducation.onmicrosoft.com');
    assert.equal((await t.call('/subscribe/status?session=' + sid)).data.email, '223929@alseducation.onmicrosoft.com', 'the page knows it was sent');
    assert.equal((await t.cfg()).subscriptions.find((x) => x.user === 'sam').email, '223929@alseducation.onmicrosoft.com', 'shown on the Subscribers row');
    // The owner's list.
    const adm = (body, headers = owner) => t.call('/admin/sub-emails', { method: 'POST', headers, body });
    let l = await adm({ action: 'list' });
    assert.equal(l.status, 200);
    assert.deepEqual(l.data.emails.map((x) => [x.user, x.email, !!x.sentAt]), [['sam', '223929@alseducation.onmicrosoft.com', false]]);
    assert.equal(l.data.doc, '');
    // A typo can be fixed (it replaces the entry), up to 3 sends in all.
    assert.equal((await em('223930')).status, 200);
    assert.deepEqual((await adm({ action: 'list' })).data.emails.map((x) => x.email), ['223930@alseducation.onmicrosoft.com']);
    assert.equal((await em('223931')).status, 200);
    assert.equal((await em('223932')).status, 409, 'no endless changes');
    // Who can see it: the owner and admins; not moderators, users, or nobody.
    const v = (u) => (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['ana', 'mo', 'joe'] } } });
    for (const u of ['ana', 'mo', 'joe']) await t.call('/auth/register', { method: 'POST', body: { user: u, verifier: v(u) } });
    await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'ana', action: 'setrole', role: 'admin' } });
    await t.call('/admin/user/action', { method: 'POST', headers: owner, body: { u: 'mo', action: 'setrole', role: 'moderator' } });
    const tok = async (u) => (await t.call('/auth/login', { method: 'POST', body: { user: u, verifier: v(u), takeover: true } })).data.token;
    assert.equal((await adm({ action: 'list' }, { 'X-GPA-Session': await tok('ana') })).status, 200, 'admin');
    assert.equal((await adm({ action: 'list' }, { 'X-GPA-Session': await tok('mo') })).status, 403, 'moderator');
    assert.equal((await adm({ action: 'list' }, { 'X-GPA-Session': (await t.call('/auth/login', { method: 'POST', body: { user: 'joe', verifier: v('joe'), takeover: true } })).data.token })).status, 403, 'user');
    assert.equal((await adm({ action: 'list' }, {})).status, 401);
    // The Google Doc link: only docs.google.com.
    for (const bad of ['http://docs.google.com/document/d/x', 'https://evil.example/document', 'javascript:alert(1)', 'not a link']) assert.equal((await adm({ action: 'setdoc', doc: bad })).status, 400, bad);
    const doc = 'https://docs.google.com/document/d/1AbCdEf/edit';
    assert.equal((await adm({ action: 'setdoc', doc })).data.doc, doc);
    // Marked as sent, with who sent it.
    const sent = await adm({ action: 'sent', user: 'SAM' }, { 'X-GPA-Session': await tok('ana') });
    assert.equal(sent.status, 200);
    assert.deepEqual([!!sent.data.emails[0].sentAt, sent.data.emails[0].sentBy], [true, 'ana']);
    assert.equal((await adm({ action: 'sent', user: 'nobody' })).status, 404);
    assert.deepEqual((await adm({ action: 'remove', user: 'sam' })).data.emails, []);
  } finally { st.restore(); }
});
