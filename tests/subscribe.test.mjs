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
  const calls = [];
  let n = 0;
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input && input.url || input);
    if (!u.startsWith('https://api.stripe.com/')) return real(input, init);
    calls.push({ url: u, method: init.method, body: init.body ? String(init.body) : '' , auth: (init.headers || {}).Authorization });
    const path = new URL(u).pathname;
    if (path === '/v1/checkout/sessions' && init.method === 'POST') {
      const p = new URLSearchParams(String(init.body));
      const id = 'cs_test_' + 'a'.repeat(20) + (++n);
      const s = { id, object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/' + id, mode: p.get('mode'), client_reference_id: p.get('client_reference_id'), metadata: { user: p.get('metadata[user]') },
        amount_total: Number(p.get('line_items[0][price_data][unit_amount]')), status: 'open', payment_status: 'unpaid', customer: null, subscription: null };
      sessions.set(id, s);
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
  try {
    await t.call('/admin/config', { method: 'POST', headers: owner, body: { allowlist: { on: true, users: ['old'] } } });
    // The page.
    const page = await t.call('/subscribe/');
    assert.equal(page.status, 200);
    assert.match(page.text, /\$13\.80 <small>\/ month<\/small>/);
    assert.equal(page.headers.get('X-Frame-Options'), 'DENY');
    // Names.
    assert.equal((await t.call('/subscribe/check?user=boss')).data.ok, false, 'the owner’s name');
    assert.equal((await t.call('/subscribe/check?user=old')).data.ok, false, 'already approved');
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
    assert.equal((await t.cfg()).subscriptions.length, 0);
    // A forged webhook (wrong secret) changes nothing.
    const forged = await t.hook({ id: 'evt_x', type: 'checkout.session.completed', data: { object: { ...st.sessions.get(sid), status: 'complete', payment_status: 'paid', subscription: 'sub_123' } } }, { secret: 'whsec_wrong' });
    assert.equal(forged.status, 400);
    assert.equal((await t.cfg()).subscriptions.length, 0);
    // Stripe: paid.
    const s = st.pay(sid);
    const ok = await t.hook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s } });
    assert.equal(ok.status, 200);
    let c = await t.cfg();
    assert.equal(c.subscriptions.length, 1);
    const sub = c.subscriptions[0];
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
    assert.equal(c.subscriptions[0].expiresAt, end2 * 1000 + DAY);
    assert.deepEqual(c.ledger.map((x) => x.amount), [13.8, 13.8]);
    // The first invoice (subscription_create) is the checkout payment: not counted twice.
    await t.hook({ id: 'evt_3', type: 'invoice.paid', data: { object: { id: 'in_1', object: 'invoice', billing_reason: 'subscription_create', amount_paid: 1380, parent: { subscription_details: { subscription: 'sub_123', metadata: { user: 'NewKid' } } }, lines: { data: [{ period: { end: end2 } }] } } } });
    assert.equal((await t.cfg()).ledger.length, 2);
    // They turn off renewal: still active until the end, but no longer renewing.
    await t.hook({ id: 'evt_4', type: 'customer.subscription.updated', data: { object: { id: 'sub_123', object: 'subscription', cancel_at_period_end: true, metadata: { user: 'NewKid' } } } });
    assert.equal((await t.cfg()).subscriptions[0].autoRenew, false);
    assert.equal((await t.cfg()).subscriptions[0].active, true);
    // The subscription ends: access ends at the next sweep (within 5 minutes).
    await t.hook({ id: 'evt_5', type: 'customer.subscription.deleted', data: { object: { id: 'sub_123', object: 'subscription', metadata: { user: 'NewKid' } } } });
    await worker.scheduled({ cron: '*/5 * * * *' }, t.env, { waitUntil() {} });
    await new Promise((r) => setTimeout(r, 50));
    c = await t.cfg();
    assert.equal(c.subscriptions[0].active, false);
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
