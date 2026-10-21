// Subscribe app (/subscribe/): a payment-only page the owner gives to people
// who want access. They pick the username they'll sign in with and pay with
// Stripe Checkout (cards, Apple Pay, Google Pay, Cash App Pay, Link — what the
// owner turns on in Stripe). When Stripe confirms the payment, the Worker adds
// the name to Allowed users as a monthly subscriber (worker.js, /subscribe/*).
//
// Worker secrets (Cloudflare, never in the code):
//   STRIPE_SECRET_KEY      a restricted key (rk_…) with Checkout Sessions:
//                          Write, Subscriptions: Read, Prices: Read
//   STRIPE_WEBHOOK_SECRET  whsec_… from the webhook endpoint
// Optional vars: STRIPE_PRICE_ID (price_… of a monthly Price made in the
// Stripe Dashboard; the page shows its amount), else SUB_PRICE_CENTS (default
// 1380 = $13.80/month, so $13.00 is left after Stripe's 2.9% + 30¢ card fee
// and 0.7% Billing fee); STRIPE_PORTAL_URL (Stripe's no-code customer portal
// link, for "Manage or cancel"); SUPPORT_EMAIL (the contact email customers
// see; default below); STRIPE_API (tests). The Terms, Refund & Cancellation
// and Privacy pages are in web/policies.js.
//
// Every call is pinned to one Stripe API version, so a change on Stripe's
// side can't change what the Worker reads. Webhook endpoints have their own
// version (set when the endpoint is made); the handlers read both the old and
// the new shapes of subscriptions and invoices.
export const STRIPE_API_VERSION = '2026-08-26.dahlia';
// Tags these Checkout Sessions in the Stripe Dashboard (8 random letters).
export const INTEGRATION_ID = 'agent-console-subscribe-qhxmtwbr';

export const SUB_PRICE_DEFAULT = 1380;
// A subscription checkout stays open 31 minutes (Stripe's minimum is 30); the
// Worker holds the name a little longer, so one name never has two open.
export const CHECKOUT_TTL_S = 31 * 60;
export const SUB_NAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;
// New subscribers' school email: 6-digit student number @ this domain.
export const SCHOOL_DOMAIN = 'alseducation.onmicrosoft.com';
export const SESSION_RE = /^cs_(?:test|live)_[A-Za-z0-9]{8,200}$/;
export const priceCents = (env) => {
  const n = Math.round(Number(env && env.SUB_PRICE_CENTS));
  return Number.isFinite(n) && n >= 100 && n <= 100000 ? n : SUB_PRICE_DEFAULT;
};
export const money = (cents) => '$' + (cents / 100).toFixed(2);
export const subscribeReady = (env) => !!(env && env.STRIPE_SECRET_KEY);
export const priceId = (env) => (/^price_[A-Za-z0-9]{4,80}$/.test(String((env && env.STRIPE_PRICE_ID) || '').trim()) ? String(env.STRIPE_PRICE_ID).trim() : '');
export const ATTEMPT_RE = /^[a-z0-9]{16,40}$/;
// One-time contributions from members who already subscribe: $6 to $500.
export const CONTRIB_MIN_CENTS = 600;
export const CONTRIB_MAX_CENTS = 50000;
// The owner can give from $1 (with their PIN) to test that payments arrive.
export const OWNER_CONTRIB_MIN_CENTS = 100;
export const contribCents = (v, min = CONTRIB_MIN_CENTS) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= CONTRIB_MAX_CENTS ? n : 0;
};
export const SUPPORT_EMAIL_DEFAULT = 'viztrrx@gmail.com';
export const supportEmail = (env) => {
  const e = String((env && env.SUPPORT_EMAIL) || '').trim();
  return /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,}$/.test(e) ? e : SUPPORT_EMAIL_DEFAULT;
};
export const portalUrl = (env) => (/^https:\/\/[^\s"'<>]{1,300}$/.test(String((env && env.STRIPE_PORTAL_URL) || '')) ? env.STRIPE_PORTAL_URL : '');

// ---- Stripe API (form-encoded) ------------------------------------------------
function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}
// opts.idempotencyKey: a retried or double-tapped request returns the same
// object instead of making a second one.
export async function stripe(env, method, path, params, opts = {}) {
  const base = (env && env.STRIPE_API) || 'https://api.stripe.com';
  let r;
  try {
    r = await fetch(base + '/v1/' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Stripe-Version': STRIPE_API_VERSION,
        ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {})
      },
      body: params ? formEncode(params) : undefined
    });
  } catch (e) { throw Object.assign(new Error('Couldn’t reach Stripe. Try again in a minute.'), { status: 502 }); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || ('Stripe answered ' + r.status)), { status: 502 });
  return d;
}

// Stripe Checkout for one monthly subscription, the username attached. The
// Dashboard Price (STRIPE_PRICE_ID) when set, else an inline monthly price.
// No payment_method_types: the Dashboard decides which methods show.
export function checkoutParams(env, origin, user) {
  const pid = priceId(env);
  return {
    mode: 'subscription',
    client_reference_id: user,
    metadata: { user },
    subscription_data: { metadata: { user } },
    line_items: { 0: pid ? { quantity: 1, price: pid } : { quantity: 1, price_data: { currency: 'usd', unit_amount: priceCents(env), recurring: { interval: 'month' }, product_data: { name: 'Saints Service', description: 'Monthly access for ' + user } } } },
    integration_identifier: INTEGRATION_ID,
    success_url: origin + '/subscribe/?done={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/subscribe/?canceled=1',
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_S,
    allow_promotion_codes: 'false',
    // Shown above Stripe's Subscribe button: how it renews and how to cancel.
    custom_text: { submit: { message: 'Renews automatically every month until you cancel. Cancel any time; you keep access until the end of the month you paid for. Payments are non-refundable, except billing errors. Help: ' + supportEmail(env) } }
  };
}

// A one-time contribution (Checkout in payment mode) from a member who
// already subscribes. metadata.kind tells the webhook and the status check
// it's a contribution, never a subscription payment.
export function contributionParams(env, origin, user, cents) {
  return {
    mode: 'payment',
    client_reference_id: user,
    metadata: { kind: 'contribution', user },
    payment_intent_data: { metadata: { kind: 'contribution', user }, description: 'Contribution to Saints Service from ' + user },
    line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: 'Contribution to Saints Service', description: 'One-time contribution from ' + user + '. Thank you!' } } } },
    submit_type: 'pay',
    integration_identifier: INTEGRATION_ID,
    success_url: origin + '/subscribe/?thanks={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/subscribe/?canceled=1',
    custom_text: { submit: { message: 'One-time contribution. It doesn’t change your subscription, isn’t tax-deductible, and is non-refundable except for billing errors. Help: ' + supportEmail(env) } }
  };
}
export const isContribution = (sess) => !!sess && sess.mode === 'payment' && !!sess.metadata && sess.metadata.kind === 'contribution';

// The monthly amount the page shows: the Dashboard Price's (cached an hour
// in KV), or SUB_PRICE_CENTS.
export async function displayCents(env, kv) {
  const pid = priceId(env);
  if (!pid || !subscribeReady(env)) return priceCents(env);
  const ck = 'stripe:price:' + pid;
  try {
    const hit = kv && await kv.get(ck, 'json');
    if (hit && hit.cents) return hit.cents;
    const p = await stripe(env, 'GET', 'prices/' + encodeURIComponent(pid));
    const cents = Number(p.unit_amount);
    if (!(cents > 0)) return priceCents(env);
    if (kv) await kv.put(ck, JSON.stringify({ cents }), { expirationTtl: 3600 });
    return cents;
  } catch (e) { return priceCents(env); }
}

// The end of the period Stripe just billed (seconds → ms), from a
// subscription (older API: current_period_end; newer: on its items) or an
// invoice (its line's period).
export function periodEndMs(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  const s = obj.current_period_end
    || (obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].current_period_end)
    || (obj.lines && obj.lines.data && obj.lines.data[0] && obj.lines.data[0].period && obj.lines.data[0].period.end)
    || (obj.period_end && obj.object === 'invoice' ? obj.period_end : 0);
  return Number(s) > 0 ? Number(s) * 1000 : 0;
}
// The subscription an invoice belongs to (moved under parent in newer API versions).
export function invoiceSubscription(inv) {
  if (!inv) return { id: '', user: '' };
  const det = (inv.parent && inv.parent.subscription_details) || inv.subscription_details || {};
  const id = (typeof inv.subscription === 'string' && inv.subscription) || (typeof det.subscription === 'string' && det.subscription) || '';
  return { id, user: (det.metadata && det.metadata.user) || '' };
}

// ---- Webhook signature (Stripe-Signature: t=…,v1=…) ----------------------------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function stripeSign(secret, t, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + payload)));
}
export async function stripeSignatureOk(secret, header, payload, nowMs = Date.now(), toleranceSec = 300) {
  if (!secret || !header) return false;
  const parts = String(header).split(',').map((x) => x.trim().split('='));
  const t = (parts.find(([k]) => k === 't') || [])[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSec) return false;
  const want = await stripeSign(secret, t, payload);
  // Constant-time compare against each v1 signature.
  return sigs.some((s) => {
    if (typeof s !== 'string' || s.length !== want.length) return false;
    let d = 0;
    for (let i = 0; i < s.length; i++) d |= s.charCodeAt(i) ^ want.charCodeAt(i);
    return d === 0;
  });
}

// ---- The page ---------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The links every subscribe and policy page shows at the bottom.
export function policyFooter(env) {
  const mail = esc(supportEmail(env));
  return `<footer class="legal">
    <nav><a href="/subscribe/terms">Terms</a><span>·</span><a href="/subscribe/refunds">Refunds &amp; cancellation</a><span>·</span><a href="/subscribe/privacy">Privacy</a></nav>
    <p>Questions or help: <a href="mailto:${mail}">${mail}</a></p>
    <p>© 2026 Saints Service · United States · Payments processed securely by Stripe</p>
  </footer>`;
}
export function subscribePage(env, { ready, cents }) {
  const price = money(cents || priceCents(env));
  const portal = portalUrl(env);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#14171d"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Subscribe"><meta name="robots" content="noindex">
<title>Subscribe · Saints Service</title>
<link rel="apple-touch-icon" href="/console/icon-180.png">
<style>
  :root {
    /* The planet icon's colors: its dark sky, and the ring from teal to violet. */
    --bg: #14171d; --card: #1b1f27; --field: #222833; --border: #2c3442; --text: #eef1f6; --sub: #9aa4b5;
    --teal: #28b3a2; --violet: #7250cb; --planet: #6f97b7;
    --accent: linear-gradient(100deg, var(--teal), var(--violet)); --accent-fg: #fff; --ok: #3ccbb6; --bad: #f87171;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: radial-gradient(120% 70% at 50% 0%, #1b2530 0%, var(--bg) 60%) fixed, var(--bg); color: var(--text); font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  main { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom)); }
  .card { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--border); box-shadow: 0 0 0 1px rgba(114,80,203,0.08), 0 30px 80px -40px #000; border-radius: 22px; padding: 28px 24px; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .logo { width: 48px; height: 48px; border-radius: 12px; display: block; border: 1px solid var(--border); box-shadow: 0 0 18px -6px rgba(40,179,162,0.6); }
  .brand b { display: block; font-size: 17px; } .brand span { font-size: 13px; color: var(--sub); }
  h1 { font-size: 24px; margin: 4px 0 6px; letter-spacing: -0.01em; }
  .price { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; margin: 10px 0 2px; }
  .price small { font-size: 15px; font-weight: 500; color: var(--sub); }
  ul { padding: 0; margin: 14px 0 20px; list-style: none; color: var(--sub); font-size: 14px; }
  ul li { padding-left: 22px; position: relative; margin: 6px 0; } ul li::before { content: "✓"; position: absolute; left: 0; color: var(--teal); font-weight: 700; }
  ol li { margin: 6px 0; }
  label { display: block; font-size: 13px; color: var(--sub); margin-bottom: 6px; }
  input { width: 100%; font: inherit; font-size: 16px; color: var(--text); background: var(--field); border: 1px solid var(--border); border-radius: 12px; padding: 13px 14px; outline: none; }
  input:focus { border-color: var(--violet); box-shadow: 0 0 0 3px rgba(114,80,203,0.25); }
  .hint { font-size: 13px; min-height: 20px; margin: 6px 2px 14px; color: var(--sub); }
  .hint.ok { color: var(--ok); } .hint.bad { color: var(--bad); }
  button, .btn { display: block; width: 100%; font: inherit; font-weight: 600; font-size: 16px; padding: 14px; border-radius: 12px; border: 0; background: var(--accent); color: var(--accent-fg); cursor: pointer; text-align: center; text-decoration: none; box-shadow: 0 10px 24px -12px rgba(114,80,203,0.8); }
  button[disabled] { opacity: .5; cursor: default; }
  .small { font-size: 12.5px; color: var(--sub); margin-top: 14px; text-align: center; }
  .small a { color: var(--ok); }
  .code { font: 600 26px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-align: center; padding: 14px; border-radius: 12px; background: var(--field); border: 1px dashed var(--violet); color: #fff; margin: 10px 0; user-select: all; }
  ol { padding-left: 20px; color: var(--sub); font-size: 14px; } ol b { color: var(--text); }
  .spin { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--border); border-top-color: var(--teal); border-right-color: var(--violet); animation: s 0.9s linear infinite; margin: 18px auto; }
  @keyframes s { to { transform: rotate(360deg); } }
  .cur { font-size: 13px; color: var(--sub); margin: 0 0 4px; }
  .terms { font-size: 12.5px; color: var(--sub); margin: 12px 2px 0; line-height: 1.5; }
  .terms a, .legal a { color: var(--ok); }
  .wrap { width: 100%; max-width: 420px; }
  .contrib { border: 1px solid var(--border); border-radius: 16px; padding: 16px; margin: 4px 0 6px; background: rgba(114,80,203,0.07); }
  .contrib-t { margin: 0 0 12px; font-size: 14.5px; color: var(--sub); } .contrib-t b { color: var(--text); }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .chips button { width: auto; flex: 1 1 0; min-width: 0; padding: 10px 0; background: var(--field); border: 1px solid var(--border); box-shadow: none; color: var(--text); }
  .chips button[aria-pressed="true"] { border-color: var(--violet); background: rgba(114,80,203,0.25); }
  .amt { position: relative; } .amt span { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--sub); }
  .amt input { padding-left: 28px; }
  .note { font-size: 13px; color: var(--sub); margin: 16px 0 0; padding-top: 14px; border-top: 1px solid var(--border); text-align: center; line-height: 1.5; }
  .note b { color: var(--text); }
  .pin-h { font-size: 18px; margin: 18px 0 4px; }
  #pin-form label { margin-top: 10px; }
  .warn { border: 1px solid rgba(248,113,113,0.55); background: rgba(248,113,113,0.09); border-radius: 14px; padding: 12px 14px; margin: 10px 0 4px; font-size: 13.5px; color: var(--text); line-height: 1.5; }
  .warn b { display: block; color: #fca5a5; margin-bottom: 4px; font-size: 14.5px; }
  .warn ul { margin: 6px 0 0; color: var(--sub); font-size: 13px; } .warn ul li::before { content: "•"; color: #fca5a5; }
  .check { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; color: var(--text); margin: 14px 0 6px !important; cursor: pointer; }
  .check input { -webkit-appearance: none; appearance: none; position: relative; width: 22px; height: 22px; flex: 0 0 22px; margin: 0; padding: 0; border-radius: 7px; border: 1.5px solid var(--border); background: var(--field); cursor: pointer; transition: background .15s, border-color .15s, box-shadow .15s; }
  .check input:hover { border-color: var(--violet); }
  .check input:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(114,80,203,0.35); }
  .check input:checked { border-color: transparent; background: var(--accent); box-shadow: 0 6px 16px -8px rgba(114,80,203,0.9); }
  .check input:checked::after { content: ""; position: absolute; left: 7px; top: 3px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2.4px 2.4px 0; transform: rotate(45deg); }
  @media (prefers-reduced-motion: reduce) { .check input { transition: none; } }
  .email-box { display: flex; align-items: center; background: var(--field); border: 1px solid var(--border); border-radius: 12px; padding: 0 14px; }
  .email-box:focus-within { border-color: var(--violet); box-shadow: 0 0 0 3px rgba(114,80,203,0.25); }
  .email-box input { width: 7.2ch; flex: 0 0 auto; border: 0; background: none; box-shadow: none !important; padding: 13px 0; letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }
  .email-box span { color: var(--sub); font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  #email-form h2, #pin-form h2 { margin-bottom: 4px; }
  #pin-user { color: var(--sub); }
  details.alt { margin-top: 16px; font-size: 13px; color: var(--sub); } details.alt summary { cursor: pointer; color: var(--ok); }
  .legal { text-align: center; color: var(--sub); font-size: 12.5px; margin-top: 18px; }
  .legal nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; }
  .legal p { margin: 6px 0; }
  [hidden] { display: none !important; }
</style></head>
<body><main><div class="wrap"><div class="card">
  <div class="brand"><img class="logo" src="/console/icon-180.png" alt="" width="48" height="48"><div><b>Saints Service</b><span>Subscription</span></div></div>

  <section id="closed" ${ready ? 'hidden' : ''}>
    <h1>Subscriptions aren’t open yet</h1>
    <p class="hint">Check back soon, or ask the owner.</p>
  </section>

  <section id="form" ${ready ? '' : 'hidden'}>
    <h1 id="form-title">Subscribe</h1>
    <div id="sub-info">
    <div class="price">${esc(price)} <small>/ month</small></div>
    <p class="cur">US dollars · billed monthly until you cancel</p>
    <ul><li>Full access to Saints Service</li><li>Your username is approved as soon as your payment goes through</li><li>Cancel any time · access lasts to the end of the month you paid for</li></ul>
    </div>
    <label for="user">Username you’ll sign in with</label>
    <input id="user" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40" placeholder="e.g. jsmith" inputmode="text">
    <div id="hint" class="hint" role="status" aria-live="polite">Letters, numbers, dot, dash or underscore.</div>
    <div id="contrib" class="contrib" hidden>
      <p class="contrib-t"><b>You’re already a member.</b> Want to support Saints Service? Add a one-time contribution of ${esc(money(CONTRIB_MIN_CENTS))} or more.</p>
      <div class="chips" role="group" aria-label="Amount">${[CONTRIB_MIN_CENTS / 100, 10, 20, 50].map((d) => `<button type="button" data-amt="${d}" aria-pressed="${d * 100 === CONTRIB_MIN_CENTS}">$${d}</button>`).join('')}</div>
      <label for="amt">Amount (USD)</label>
      <div class="amt"><span>$</span><input id="amt" type="number" inputmode="decimal" min="${CONTRIB_MIN_CENTS / 100}" max="${CONTRIB_MAX_CENTS / 100}" step="0.01" value="${CONTRIB_MIN_CENTS / 100}"></div>
      <div id="amt-hint" class="hint">From ${esc(money(CONTRIB_MIN_CENTS))} to ${esc(money(CONTRIB_MAX_CENTS))}.</div>
      <div id="owner-box" hidden>
        <label for="owner-pin">Your PIN (owner)</label>
        <input id="owner-pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="64">
        <div class="hint">Only you can give less than ${esc(money(CONTRIB_MIN_CENTS))}: your PIN proves it’s you. It’s a real charge, so it shows up in Stripe like any payment.</div>
      </div>
      <button id="give" type="button">Contribute ${esc(money(CONTRIB_MIN_CENTS))}</button>
      <p class="terms">A one-time payment that doesn’t change your subscription. Contributions are non-refundable (see the <a href="/subscribe/refunds">Refund &amp; Cancellation Policy</a>) and aren’t tax-deductible, since Saints Service isn’t a charity.</p>
    </div>
    <div id="subbox">
    <button id="pay" type="button" disabled>Continue to payment</button>
    <p class="terms">By continuing, you agree to the <a href="/subscribe/terms">Terms of Service</a> and the <a href="/subscribe/refunds">Refund &amp; Cancellation Policy</a>. You’ll be charged ${esc(price)} USD today and then every month until you cancel. Payments are non-refundable. You can cancel any time${portal ? ` <a href="${esc(portal)}" target="_blank" rel="noopener">online</a> or` : ''} by emailing <a href="mailto:${esc(supportEmail(env))}">${esc(supportEmail(env))}</a>.</p>
    <p class="small">You’ll choose how to pay (card, Apple Pay, Google Pay, Cash App Pay…) on Stripe’s secure page.${portal ? ` · <a href="${esc(portal)}" target="_blank" rel="noopener">Manage or cancel a subscription</a>` : ''}</p>
    <p class="note" id="contrib-note"><b>Contributions are only for subscribers.</b> New here? Subscribe first. Already subscribed? Type your username above to contribute. Each username can only be subscribed once at a time.</p>
    </div>
  </section>

  <section id="wait" hidden>
    <h1>Confirming your payment…</h1>
    <div class="spin" aria-hidden="true"></div>
    <p class="hint" id="wait-msg">This takes a few seconds.</p>
  </section>

  <section id="done" hidden>
    <h1>You’re in, <span id="done-user"></span>!</h1>
    <p class="hint ok">Payment received. Your username is approved.</p>
    <form id="pin-form" hidden>
      <h2 class="pin-h">Create your PIN</h2>
      <p class="hint">You choose it, and you’ll use it with your username to sign in. Use at least 4 characters, and don’t share it.</p>
      <div class="warn" role="note" id="pin-warn"><b>You must remember this PIN.</b>It’s the only way to sign in. Nobody can look it up, not even the owner. If you forget it, you’ll be locked out until you ask the owner to reset it.
        <ul><li>Make it simple enough that <b style="display:inline;color:inherit">you</b> will always remember it, and only you would know it.</li><li>Not easy to guess: no 1234, 0000, 1111, 1212, your birthday, your username or your student number.</li></ul></div>
      <label for="pin-user">Username</label>
      <input id="pin-user" autocomplete="username" readonly>
      <label for="pin1">PIN</label>
      <input id="pin1" type="password" autocomplete="new-password" maxlength="64">
      <label for="pin2">Type your PIN again</label>
      <input id="pin2" type="password" autocomplete="new-password" maxlength="64">
      <label class="check" for="pin-ok"><input type="checkbox" id="pin-ok"> I’ll remember this PIN. I understand it can’t be recovered.</label>
      <div id="pin-hint" class="hint" role="status" aria-live="polite"></div>
      <button id="pin-go" type="submit">Create my account</button>
      <details class="alt" id="pin-alt"><summary>Rather create your account in the app?</summary>
        <p class="hint">In Saints Service, tap the <b>planet icon</b> at the top of the sign-in card (create account), type your username and a PIN, and enter this one-time sign-up code when it asks:</p>
        <div class="code" id="code"></div>
      </details>
    </form>
    <form id="email-form" hidden novalidate>
      <h2 class="pin-h">Add your school email</h2>
      <p class="hint">Type only the 6 numbers of your school email. The owner shares the instructions for getting Saints Service with that school account, as a Google Doc.</p>
      <label for="sid">School email</label>
      <div class="email-box"><input id="sid" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" spellcheck="false" placeholder="000000" aria-describedby="sid-dom"><span id="sid-dom">@${SCHOOL_DOMAIN}</span></div>
      <div id="sid-hint" class="hint" role="status" aria-live="polite"></div>
      <button id="sid-go" type="submit" disabled>Send my email</button>
    </form>
    <p class="hint ok" id="email-sent" hidden></p>
    <ol id="steps-ready" hidden>
      <li>Open Saints Service the way the owner showed you.</li>
      <li>Type your username <b class="u"></b> and the PIN you just made, then tap <b>Sign in</b>.</li>
    </ol>
    <ol id="steps-back" hidden>
      <li>Open Saints Service and sign in as <b class="u"></b> with your PIN, as before.</li>
    </ol>
    <p class="small">Your subscription renews monthly until you cancel. Stripe emails you a receipt.<span id="keep-open" hidden> Keep this page open until you’ve finished these steps.</span>${portal ? ` · <a href="${esc(portal)}" target="_blank" rel="noopener">Manage or cancel</a>` : ` To cancel, email <a href="mailto:${esc(supportEmail(env))}">${esc(supportEmail(env))}</a>.`}</p>
  </section>

  <section id="dup" hidden>
    <h1>Already subscribed</h1>
    <p class="hint">“<span id="dup-user"></span>” was already paid up, so this payment was a duplicate. It will be refunded in full; the owner has been told. Questions: <a href="mailto:${esc(supportEmail(env))}">${esc(supportEmail(env))}</a>.</p>
    <a class="btn" href="/subscribe/">OK</a>
  </section>

  <section id="thanks" hidden>
    <h1>Thank you, <span id="thanks-user"></span>!</h1>
    <p class="hint ok">Your contribution of <b id="thanks-amt"></b> went through. It really helps keep Saints Service going.</p>
    <p class="small">Stripe emails you a receipt. Your subscription stays the same.</p>
    <a class="btn" href="/subscribe/">Done</a>
  </section>

  <section id="cancel" hidden>
    <h1>Payment canceled</h1>
    <p class="hint">Nothing was charged.</p>
    <a class="btn" href="/subscribe/">Try again</a>
  </section>
</div>
${policyFooter(env)}
</div></main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var show = function (id) { ['closed', 'form', 'wait', 'done', 'dup', 'thanks', 'cancel'].forEach(function (x) { $(x).hidden = x !== id; }); };
  var q = new URLSearchParams(location.search);
  var hint = $('hint'), input = $('user'), pay = $('pay'), timer = null, okName = '';
  var contrib = $('contrib'), subbox = $('subbox'), amt = $('amt'), give = $('give'), giveName = '';
  var MIN = ${CONTRIB_MIN_CENTS}, MAX = ${CONTRIB_MAX_CENTS}, ownerMode = false;
  var firstChip = contrib ? contrib.querySelector('[data-amt]') : null;
  // The owner's test contribution: from $1, with their PIN. Anyone else: from $${CONTRIB_MIN_CENTS / 100}.
  function setOwnerMode(on) {
    ownerMode = on; MIN = on ? ${OWNER_CONTRIB_MIN_CENTS} : ${CONTRIB_MIN_CENTS};
    $('owner-box').hidden = !on; if (!on) $('owner-pin').value = '';
    var d = String(MIN / 100);
    firstChip.setAttribute('data-amt', d); firstChip.textContent = '$' + d;
    amt.min = d; amt.value = d;
    contrib.querySelector('.contrib-t').innerHTML = on ? '<b>Owner test.</b> Make a real contribution from $1 to check that payments reach your Stripe account.' : '<b>You’re already a member.</b> Want to support Saints Service? Add a one-time contribution of $' + d + ' or more.';
  }
  // One id per visit: tapping twice, or coming back from checkout, reuses the
  // same checkout instead of locking the name.
  var attempt = '';
  try { attempt = sessionStorage.getItem('sub_attempt') || ''; } catch (e) { attempt = ''; }
  if (!/^[a-z0-9]{16,40}$/.test(attempt)) {
    var b = new Uint8Array(12); crypto.getRandomValues(b);
    attempt = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(36)).slice(-2); }).join('').replace(/[^a-z0-9]/g, 'a').slice(0, 24);
    try { sessionStorage.setItem('sub_attempt', attempt); } catch (e) { /* private mode */ }
  }
  function setHint(text, cls) { hint.textContent = text; hint.className = 'hint' + (cls ? ' ' + cls : ''); }
  function check() {
    var u = input.value.trim().replace(/^@/, '');
    okName = ''; pay.disabled = true; giveName = ''; contrib.hidden = true; if (ownerMode) setOwnerMode(false); subbox.hidden = false; $('sub-info').hidden = false; $('form-title').textContent = 'Subscribe';
    if (!u) { setHint('Letters, numbers, dot, dash or underscore.'); return; }
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(u)) { setHint('Use only letters, numbers, dot, dash or underscore.', 'bad'); return; }
    setHint('Checking…');
    fetch('/subscribe/check?user=' + encodeURIComponent(u) + '&attempt=' + attempt, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (input.value.trim().replace(/^@/, '') !== u) return;
      if (d.ok) { okName = u; pay.disabled = false; setHint(d.note || ('“' + u + '” is available.'), 'ok'); }
      else if (d.ownerTest) {
        giveName = u; setOwnerMode(true); contrib.hidden = false; subbox.hidden = true; $('sub-info').hidden = true; $('form-title').textContent = 'Test contribution';
        setHint('That’s the owner’s name. You can make a test contribution from $1 with your PIN.', 'ok');
        syncAmt();
      }
      else if (d.canContribute) {
        // Already paid up: no second subscription, only a contribution.
        giveName = u; contrib.hidden = false; subbox.hidden = true; $('sub-info').hidden = true; $('form-title').textContent = 'Contribute';
        setHint('“' + u + '” is already subscribed for this month, so it can’t be paid for again. You can add a one-time contribution below.' + (d.hasAccount ? '' : ' (No PIN yet? Finish on your payment confirmation page, or ask the owner.)'), 'ok');
        syncAmt();
      }
      else setHint(d.error || 'That name can’t be used.', 'bad');
    }).catch(function () { setHint('Couldn’t check right now. Try again.', 'bad'); });
  }
  if (input) {
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(check, 350); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !pay.disabled) pay.click(); });
    pay.addEventListener('click', function () {
      if (!okName) return;
      pay.disabled = true; pay.textContent = 'Opening secure checkout…';
      fetch('/subscribe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: okName, attempt: attempt }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (d.url) { location.href = d.url; return; }
          setHint(d.error || 'Couldn’t start the payment. Try again.', 'bad'); pay.disabled = false; pay.textContent = 'Continue to payment';
        }).catch(function () { setHint('Couldn’t reach the server. Try again.', 'bad'); pay.disabled = false; pay.textContent = 'Continue to payment'; });
    });
  }
  // Contributions: the amount box and its preset buttons.
  function cents() { var v = Math.round(parseFloat(amt.value) * 100); return isFinite(v) ? v : 0; }
  function syncAmt() {
    var c = cents(), ok = c >= MIN && c <= MAX, ah = $('amt-hint');
    give.disabled = !ok;
    give.textContent = ok ? 'Contribute $' + (c / 100).toFixed(2) : 'Contribute';
    ah.textContent = ok ? 'From $' + (MIN / 100).toFixed(2) + ' to $' + (MAX / 100).toFixed(2) + '.' : c < MIN ? 'The smallest contribution is $' + (MIN / 100).toFixed(2) + '.' : 'The largest contribution is $' + (MAX / 100).toFixed(2) + '.';
    ah.className = 'hint' + (ok ? '' : ' bad');
    Array.prototype.forEach.call(contrib.querySelectorAll('[data-amt]'), function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-amt')) * 100 === c)); });
  }
  if (contrib) {
    Array.prototype.forEach.call(contrib.querySelectorAll('[data-amt]'), function (b) { b.addEventListener('click', function () { amt.value = b.getAttribute('data-amt'); syncAmt(); }); });
    amt.addEventListener('input', syncAmt);
    give.addEventListener('click', function () {
      var c = cents();
      if (!giveName || c < MIN || c > MAX) return;
      var pin = ownerMode ? $('owner-pin').value : '';
      if (ownerMode && !pin) { $('amt-hint').textContent = 'Type your PIN first.'; $('amt-hint').className = 'hint bad'; $('owner-pin').focus(); return; }
      give.disabled = true; give.textContent = 'Opening secure checkout…';
      (ownerMode ? verifierFor(giveName, pin) : Promise.resolve(''))
        .then(function (v) { return fetch('/subscribe/contribute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v ? { user: giveName, cents: c, attempt: attempt, verifier: v } : { user: giveName, cents: c, attempt: attempt }) }); })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (d.url) { location.href = d.url; return; }
          syncAmt(); $('amt-hint').textContent = d.error || 'Couldn’t start the payment. Try again.'; $('amt-hint').className = 'hint bad';
        }).catch(function () { $('amt-hint').textContent = 'Couldn’t reach the server. Try again.'; $('amt-hint').className = 'hint bad'; give.disabled = false; give.textContent = 'Contribute $' + (c / 100).toFixed(2); });
    });
  }
  if (q.get('canceled')) { show('cancel'); return; }
  var thanks = q.get('thanks');
  if (thanks) {
    show('wait');
    var ttries = 0;
    (function pollThanks() {
      fetch('/subscribe/status?session=' + encodeURIComponent(thanks), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.contribution && d.paid) {
          // A new visit id, so giving the same amount again opens a new checkout.
          try { sessionStorage.removeItem('sub_attempt'); } catch (e) { /* private mode */ }
          $('thanks-user').textContent = d.user; $('thanks-amt').textContent = '$' + Number(d.amount).toFixed(2); show('thanks'); return;
        }
        if (d.error && !d.pending) { $('wait-msg').textContent = d.error; return; }
        if (++ttries > 40) { $('wait-msg').textContent = 'Still waiting for the payment to be confirmed. Keep this page open, or come back to it later: it will update.'; ttries = 0; }
        setTimeout(pollThanks, 3000);
      }).catch(function () { setTimeout(pollThanks, 4000); });
    })();
    return;
  }
  var session = q.get('done'), pinUser = '';
  // The new subscriber's own PIN: the same verifier the console derives
  // (PBKDF2-SHA256, salted by the username), so only it is sent, never the PIN.
  function verifierFor(user, pin) {
    var u = String(user).toLowerCase(), enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode('gpa-server|' + u + '|' + pin), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('gpa-server-salt|' + u), iterations: 210000 }, k, 256);
    }).then(function (bits) { return Array.prototype.map.call(new Uint8Array(bits), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); });
  }
  // PINs anyone could guess are refused (the server never sees the PIN, so this is checked here).
  var COMMON = ['1234', '12345', '123456', '1234567', '12345678', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1212', '6969', '4321', '1122', '1313', '2000', '2001', '2580', '1004', '7777777', 'abcd', 'qwerty', 'password', 'pass', 'pin'];
  function weakPin(p, user) {
    var low = String(p).toLowerCase();
    if (COMMON.indexOf(low) >= 0) return 'That PIN is one of the first ones people try. Pick something only you would know.';
    if (/^(.)\\1+$/.test(low)) return 'All the same character is too easy to guess. Pick something only you would know.';
    if (/^\\d+$/.test(low)) {
      var up = true, down = true;
      for (var i = 1; i < low.length; i++) { var d = low.charCodeAt(i) - low.charCodeAt(i - 1); if (d !== 1) up = false; if (d !== -1) down = false; }
      if (up || down) return 'Counting up or down (like 1234 or 9876) is too easy to guess.';
      if (/^(19|20)\\d\\d$/.test(low)) return 'A year is easy to guess. Pick something only you would know.';
    }
    if (user && low === String(user).toLowerCase()) return 'Don’t use your username as your PIN.';
    return '';
  }
  var pinForm = $('pin-form');
  if ($('pin-ok')) $('pin-ok').addEventListener('change', function () { if (this.checked && /^Tick/.test($('pin-hint').textContent)) { $('pin-hint').textContent = ''; $('pin-hint').className = 'hint'; } });
  if (pinForm) pinForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var p1 = $('pin1').value, p2 = $('pin2').value, ph = $('pin-hint'), go = $('pin-go');
    var say = function (t, cls) { ph.textContent = t; ph.className = 'hint' + (cls ? ' ' + cls : ''); };
    if (p1.length < 4) { say('Use a PIN of at least 4 characters.', 'bad'); return; }
    if (p1 !== p2) { say('The two PINs don’t match. Type them again.', 'bad'); return; }
    var weak = weakPin(p1, pinUser);
    if (weak) { say(weak, 'bad'); return; }
    if (!$('pin-ok').checked) { say('Tick “I’ll remember this PIN” first: it can’t be recovered if you forget it.', 'bad'); return; }
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) { say('This browser can’t set your PIN here. Open “Rather create your account in the app?” below.', 'bad'); $('pin-alt').open = true; return; }
    go.disabled = true; go.textContent = 'Securing your PIN…'; say('');
    verifierFor(pinUser, p1).then(function (v) {
      return fetch('/subscribe/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: session, verifier: v }) }).then(function (r) { return r.json(); });
    }).then(function (d) {
      if (d.ok) {
        $('pin1').value = ''; $('pin2').value = '';
        pinForm.hidden = true;
        setDone('Your account is ready. One last step: add your school email.');
        showEmail();
        return;
      }
      if (d.exists) { pinForm.hidden = true; $('steps-back').hidden = false; }
      say(d.error || 'Couldn’t create your account. Try again.', 'bad');
      go.disabled = false; go.textContent = 'Create my account';
    }).catch(function () { say('Couldn’t reach the server. Try again.', 'bad'); go.disabled = false; go.textContent = 'Create my account'; });
  });
  function setDone(t) { var h = document.querySelector('#done .hint.ok'); if (h) h.textContent = t; }
  // The school email: only the 6 digits are typed; the domain is fixed.
  var DOMAIN = '${SCHOOL_DOMAIN}';
  var emailForm = $('email-form'), sid = $('sid'), sidGo = $('sid-go'), sidHint = $('sid-hint');
  function showEmail() { emailForm.hidden = false; $('keep-open').hidden = false; $('steps-ready').hidden = true; setTimeout(function () { try { sid.focus(); } catch (e) {} }, 50); }
  function syncSid() {
    var v = sid.value.replace(/\\D/g, '').slice(0, 6);
    if (v !== sid.value) sid.value = v;
    sidGo.disabled = v.length !== 6;
    sidHint.className = 'hint';
    sidHint.textContent = v.length === 6 ? 'Your email: ' + v + '@' + DOMAIN : v.length ? (6 - v.length) + ' more digit' + (v.length === 5 ? '' : 's') + '.' : 'Numbers only, exactly 6.';
  }
  if (sid) { sid.addEventListener('input', syncSid); syncSid(); }
  if (emailForm) emailForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = sid.value;
    if (!/^\\d{6}$/.test(v)) { sidHint.textContent = 'Type exactly 6 numbers.'; sidHint.className = 'hint bad'; return; }
    sidGo.disabled = true; sidGo.textContent = 'Sending…';
    fetch('/subscribe/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: session, studentId: v }) }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        emailForm.hidden = true; $('keep-open').hidden = true; $('steps-ready').hidden = false;
        var sent = $('email-sent'); sent.textContent = 'Sent: ' + d.email + '. Next time you’re at school, sign in at docs.google.com with that school account: the instructions for loading Saints Service will be in your Google Docs (shared with you).'; sent.hidden = false;
        setDone('Your account is ready. Sign in with your username and the PIN you just made.');
        return;
      }
      sidHint.textContent = d.error || 'Couldn’t send it. Try again.'; sidHint.className = 'hint bad';
      sidGo.disabled = false; sidGo.textContent = 'Send my email';
    }).catch(function () { sidHint.textContent = 'Couldn’t reach the server. Try again.'; sidHint.className = 'hint bad'; sidGo.disabled = false; sidGo.textContent = 'Send my email'; });
  });
  if (session) {
    show('wait');
    var tries = 0;
    (function poll() {
      fetch('/subscribe/status?session=' + encodeURIComponent(session), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.duplicate) { $('dup-user').textContent = d.user; show('dup'); return; }
        if (d.approved) {
          $('done-user').textContent = d.user;
          Array.prototype.forEach.call(document.querySelectorAll('.u'), function (b) { b.textContent = d.user; });
          if (d.code) { $('code').textContent = d.code; $('pin-user').value = d.user; pinUser = d.user; $('pin-form').hidden = false; $('keep-open').hidden = false; }
          else if (d.account && !d.email) showEmail();
          else if (d.account) $('steps-ready').hidden = false;
          else $('steps-back').hidden = false;
          show('done'); return;
        }
        if (d.error && !d.pending) { $('wait-msg').textContent = d.error; return; }
        if (++tries > 40) { $('wait-msg').textContent = 'Still waiting for the payment to be confirmed. Keep this page open, or come back to it later: it will update.'; tries = 0; }
        setTimeout(poll, 3000);
      }).catch(function () { setTimeout(poll, 4000); });
    })();
  }
})();
</script></body></html>`;
}
