// Subscribe app (/subscribe/): a payment-only page the owner gives to people
// who want access. They pick the username they'll sign in with and pay with
// Stripe Checkout (cards, Apple Pay, Google Pay, Cash App Pay, Link — what the
// owner turns on in Stripe). When Stripe confirms the payment, the Worker adds
// the name to Allowed users as a monthly subscriber (worker.js, /subscribe/*).
//
// Worker secrets (Cloudflare, never in the code):
//   STRIPE_SECRET_KEY      sk_live_… (or sk_test_… to try it)
//   STRIPE_WEBHOOK_SECRET  whsec_… from the webhook endpoint
// Optional vars: SUB_PRICE_CENTS (default 1380 = $13.80/month, so $13.00 is
// left after Stripe's 2.9% + 30¢ card fee and 0.7% Billing fee),
// STRIPE_PORTAL_URL (Stripe's no-code customer portal link, for "Manage or
// cancel"), STRIPE_API (tests).

export const SUB_PRICE_DEFAULT = 1380;
export const SUB_NAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;
export const SESSION_RE = /^cs_(?:test|live)_[A-Za-z0-9]{8,200}$/;
export const priceCents = (env) => {
  const n = Math.round(Number(env && env.SUB_PRICE_CENTS));
  return Number.isFinite(n) && n >= 100 && n <= 100000 ? n : SUB_PRICE_DEFAULT;
};
export const money = (cents) => '$' + (cents / 100).toFixed(2);
export const subscribeReady = (env) => !!(env && env.STRIPE_SECRET_KEY);

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
export async function stripe(env, method, path, params) {
  const base = (env && env.STRIPE_API) || 'https://api.stripe.com';
  let r;
  try {
    r = await fetch(base + '/v1/' + path, {
      method,
      headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: params ? formEncode(params) : undefined
    });
  } catch (e) { throw Object.assign(new Error('Couldn’t reach Stripe. Try again in a minute.'), { status: 502 }); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || ('Stripe answered ' + r.status)), { status: 502 });
  return d;
}

// Stripe Checkout for one monthly subscription, the username attached.
export function checkoutParams(env, origin, user) {
  return {
    mode: 'subscription',
    client_reference_id: user,
    metadata: { user },
    subscription_data: { metadata: { user } },
    line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: priceCents(env), recurring: { interval: 'month' }, product_data: { name: 'Agent Console subscription', description: 'Monthly access for ' + user } } } },
    success_url: origin + '/subscribe/?done={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/subscribe/?canceled=1',
    allow_promotion_codes: 'false'
  };
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
export function subscribePage(env, { ready }) {
  const price = money(priceCents(env));
  const portal = /^https:\/\/[^\s"'<>]{1,300}$/.test(String((env && env.STRIPE_PORTAL_URL) || '')) ? env.STRIPE_PORTAL_URL : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#111111"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Subscribe"><meta name="robots" content="noindex">
<title>Subscribe · Agent Console</title>
<link rel="apple-touch-icon" href="/console/icon-180.png">
<style>
  :root { --bg: #111; --card: #1b1b1b; --field: #232323; --border: #2e2e2e; --text: #ededed; --sub: #9a9a9a; --accent: #d9d9d9; --accent-fg: #111; --ok: #4ade80; --bad: #f87171; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  main { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom)); }
  .card { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--border); border-radius: 22px; padding: 28px 24px; box-shadow: 0 30px 80px -40px #000; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .logo { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(145deg, #3a3a3a, #1e1e1e); border: 1px solid var(--border); display: grid; place-items: center; font-weight: 700; }
  .brand b { display: block; font-size: 17px; } .brand span { font-size: 13px; color: var(--sub); }
  h1 { font-size: 24px; margin: 4px 0 6px; letter-spacing: -0.01em; }
  .price { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; margin: 10px 0 2px; }
  .price small { font-size: 15px; font-weight: 500; color: var(--sub); }
  ul { padding: 0; margin: 14px 0 20px; list-style: none; color: var(--sub); font-size: 14px; }
  ul li { padding-left: 22px; position: relative; margin: 6px 0; } ul li::before { content: "✓"; position: absolute; left: 0; color: var(--ok); }
  ol li { margin: 6px 0; }
  label { display: block; font-size: 13px; color: var(--sub); margin-bottom: 6px; }
  input { width: 100%; font: inherit; font-size: 16px; color: var(--text); background: var(--field); border: 1px solid var(--border); border-radius: 12px; padding: 13px 14px; outline: none; }
  input:focus { border-color: #555; }
  .hint { font-size: 13px; min-height: 20px; margin: 6px 2px 14px; color: var(--sub); }
  .hint.ok { color: var(--ok); } .hint.bad { color: var(--bad); }
  button, .btn { display: block; width: 100%; font: inherit; font-weight: 600; font-size: 16px; padding: 14px; border-radius: 12px; border: 0; background: var(--accent); color: var(--accent-fg); cursor: pointer; text-align: center; text-decoration: none; }
  button[disabled] { opacity: .5; cursor: default; }
  .small { font-size: 12.5px; color: var(--sub); margin-top: 14px; text-align: center; }
  .small a { color: var(--text); }
  .code { font: 600 26px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-align: center; padding: 14px; border-radius: 12px; background: var(--field); border: 1px dashed #555; margin: 10px 0; user-select: all; }
  ol { padding-left: 20px; color: var(--sub); font-size: 14px; } ol b { color: var(--text); }
  .spin { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--border); border-top-color: var(--accent); animation: s 0.9s linear infinite; margin: 18px auto; }
  @keyframes s { to { transform: rotate(360deg); } }
  [hidden] { display: none !important; }
</style></head>
<body><main><div class="card">
  <div class="brand"><div class="logo">A</div><div><b>Agent Console</b><span>Subscription</span></div></div>

  <section id="closed" ${ready ? 'hidden' : ''}>
    <h1>Subscriptions aren’t open yet</h1>
    <p class="hint">Check back soon, or ask the owner.</p>
  </section>

  <section id="form" ${ready ? '' : 'hidden'}>
    <h1>Subscribe</h1>
    <div class="price">${esc(price)} <small>/ month</small></div>
    <ul><li>Full access to the Agent Console</li><li>Your username is approved as soon as your payment goes through</li><li>Renews monthly · cancel any time</li></ul>
    <label for="user">Username you’ll sign in with</label>
    <input id="user" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40" placeholder="e.g. jsmith" inputmode="text">
    <div id="hint" class="hint" role="status" aria-live="polite">Letters, numbers, dot, dash or underscore.</div>
    <button id="pay" type="button" disabled>Continue to payment</button>
    <p class="small">You’ll choose how to pay (card, Apple Pay, Google Pay, Cash App Pay…) on Stripe’s secure page.${portal ? ` · <a href="${esc(portal)}" target="_blank" rel="noopener">Manage or cancel a subscription</a>` : ''}</p>
  </section>

  <section id="wait" hidden>
    <h1>Confirming your payment…</h1>
    <div class="spin" aria-hidden="true"></div>
    <p class="hint" id="wait-msg">This takes a few seconds.</p>
  </section>

  <section id="done" hidden>
    <h1>You’re in, <span id="done-user"></span>!</h1>
    <p class="hint ok">Payment received. Your username is approved.</p>
    <div id="done-code" hidden>
      <p class="hint">Your sign-up code (you’ll need it once, when you create your account):</p>
      <div class="code" id="code"></div>
    </div>
    <ol id="steps-new" hidden>
      <li>Open the Agent Console the way the owner showed you.</li>
      <li>Tap <b>＋</b> (create account) and type your username <b class="u"></b> and a PIN.</li>
      <li>When it asks, enter the sign-up code above.</li>
    </ol>
    <ol id="steps-back" hidden>
      <li>Open the Agent Console and sign in as <b class="u"></b> with your PIN, as before.</li>
    </ol>
    <p class="small">Your subscription renews monthly. Keep this page or a screenshot of your code until you’ve signed in.${portal ? ` · <a href="${esc(portal)}" target="_blank" rel="noopener">Manage or cancel</a>` : ''}</p>
  </section>

  <section id="cancel" hidden>
    <h1>Payment canceled</h1>
    <p class="hint">Nothing was charged.</p>
    <a class="btn" href="/subscribe/">Try again</a>
  </section>
</div></main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var show = function (id) { ['closed', 'form', 'wait', 'done', 'cancel'].forEach(function (x) { $(x).hidden = x !== id; }); };
  var q = new URLSearchParams(location.search);
  var hint = $('hint'), input = $('user'), pay = $('pay'), timer = null, okName = '';
  function setHint(text, cls) { hint.textContent = text; hint.className = 'hint' + (cls ? ' ' + cls : ''); }
  function check() {
    var u = input.value.trim().replace(/^@/, '');
    okName = ''; pay.disabled = true;
    if (!u) { setHint('Letters, numbers, dot, dash or underscore.'); return; }
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(u)) { setHint('Use only letters, numbers, dot, dash or underscore.', 'bad'); return; }
    setHint('Checking…');
    fetch('/subscribe/check?user=' + encodeURIComponent(u), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (input.value.trim().replace(/^@/, '') !== u) return;
      if (d.ok) { okName = u; pay.disabled = false; setHint(d.note || ('“' + u + '” is available.'), 'ok'); }
      else setHint(d.error || 'That name can’t be used.', 'bad');
    }).catch(function () { setHint('Couldn’t check right now. Try again.', 'bad'); });
  }
  if (input) {
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(check, 350); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !pay.disabled) pay.click(); });
    pay.addEventListener('click', function () {
      if (!okName) return;
      pay.disabled = true; pay.textContent = 'Opening secure checkout…';
      fetch('/subscribe/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: okName }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (d.url) { location.href = d.url; return; }
          setHint(d.error || 'Couldn’t start the payment. Try again.', 'bad'); pay.disabled = false; pay.textContent = 'Continue to payment';
        }).catch(function () { setHint('Couldn’t reach the server. Try again.', 'bad'); pay.disabled = false; pay.textContent = 'Continue to payment'; });
    });
  }
  if (q.get('canceled')) { show('cancel'); return; }
  var session = q.get('done');
  if (session) {
    show('wait');
    var tries = 0;
    (function poll() {
      fetch('/subscribe/status?session=' + encodeURIComponent(session), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.approved) {
          $('done-user').textContent = d.user;
          Array.prototype.forEach.call(document.querySelectorAll('.u'), function (b) { b.textContent = d.user; });
          if (d.code) { $('code').textContent = d.code; $('done-code').hidden = false; $('steps-new').hidden = false; }
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
