// Customer-facing policies for the subscribe page (/subscribe/terms,
// /subscribe/refunds, /subscribe/privacy): what Stripe's account review and
// card networks look for on a subscription business's website — a contact
// email, the price and how it renews, how to cancel, the refund policy,
// terms and a privacy policy. Plain static pages in the subscribe page's
// look; the price comes from the same place the subscribe page gets it.
//
// No refunds (the owner's choice), except billing errors and where the law
// requires one. The commitments here (reply within 2 business days, cancel
// within 1, fix billing errors within 3) are the owner's to keep. Update
// POLICY_EFFECTIVE when any of it changes.
import { money, priceCents, supportEmail, portalUrl, policyFooter, CONTRIB_MIN_CENTS } from './subscribe.js';

export const POLICY_EFFECTIVE = 'October 18, 2026';
export const POLICY_PAGES = { terms: 'Terms of Service', refunds: 'Refund & Cancellation Policy', privacy: 'Privacy Policy' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The ways to cancel, as list items (the portal link when it's set up).
function cancelWays(env) {
  const mail = esc(supportEmail(env));
  const portal = portalUrl(env);
  return (portal ? `<li><b>Online, any time:</b> open <a href="${esc(portal)}" target="_blank" rel="noopener">Manage or cancel your subscription</a> (the same link is on your payment page and receipts), enter the email you used at checkout, and choose <b>Cancel</b>. It takes effect right away.</li>` : '')
    + `<li><b>By email:</b> write to <a href="mailto:${mail}?subject=Cancel%20my%20subscription">${mail}</a> from the email you used at checkout, with your username, and ask to cancel. We cancel it within 1 business day and email you to confirm.</li>`;
}

function body(env, kind, price) {
  const mail = esc(supportEmail(env));
  const mailto = `<a href="mailto:${mail}">${mail}</a>`;
  if (kind === 'refunds') return `
    <div class="sum">
      <p><b>${price} USD a month</b>, charged automatically each month until you cancel.</p>
      <p><b>Cancel any time.</b> You won’t be charged again, and you keep access until the end of the month you’ve paid for.</p>
      <p><b>No refunds.</b> Payments are non-refundable, including for unused time, except for billing errors (see below).</p>
    </div>
    <h2>1. Your subscription and billing</h2>
    <p>Saints Service is a monthly subscription. When you subscribe you’re charged <b>${price} USD</b> right away, and then the same amount every month on the same day of the month (your renewal date) until you cancel. Any sales tax that applies is shown before you pay. Payments are processed by Stripe; we never see or store your full card number.</p>
    <h2>2. How to cancel</h2>
    <ul>${cancelWays(env)}</ul>
    <p>To avoid the next charge, cancel before your renewal date. If you asked us to cancel before your renewal date and a renewal still goes through, we refund it in full.</p>
    <p>After you cancel there are no more charges. Your access continues until the end of the period you’ve already paid for, then ends. You can subscribe again at any time with the same username.</p>
    <h2>3. No refunds</h2>
    <p><b>All payments are final and non-refundable.</b> This includes your first payment, renewals, and any unused part of a month after you cancel. When you cancel, you simply aren’t charged again, and you keep access until the end of the month you’ve paid for.</p>
    <p><b>Optional contributions</b> — one-time extra payments members can make on the subscribe page — are final and non-refundable too. They don’t change your subscription, and they aren’t tax-deductible because Saints Service isn’t a charity.</p>
    <p><b>Billing errors are the only exception.</b> We refund in full, whenever you tell us: duplicate charges, charges for the wrong amount, charges you didn’t authorize, and renewals charged after you asked us to cancel. We also give a refund wherever the law requires one.</p>
    <p>Billing-error refunds are sent within 3 business days to the original payment method through Stripe. Your bank may take 5–10 business days to show it.</p>
    <h2>4. If we end your access</h2>
    <p>If we suspend or close an account for breaking our <a href="/subscribe/terms">Terms of Service</a>, the subscription is canceled and the current month isn’t refunded. If we stop offering Saints Service, we’ll cancel all subscriptions so no one is charged again, and tell subscribers by email.</p>
    <h2>5. Price changes</h2>
    <p>If the price changes, we’ll email you at the address you used at checkout at least 30 days before it applies. The new price starts at your first renewal after that notice, and you can cancel before then.</p>
    <h2>6. Questions and billing disputes</h2>
    <p>Please contact us first at ${mailto}. We reply within 2 business days, and most billing problems are fixed the same day. Include your username and the email you used at checkout. If you dispute a charge with your bank instead, access may be paused while the dispute is open.</p>`;

  if (kind === 'terms') return `
    <p>These terms are an agreement between you and Saints Service (“we”, “us”), a service run by its owner in the United States. They apply to the Saints Service subscription and app. By subscribing or using Saints Service, you agree to them.</p>
    <h2>1. Who can use it</h2>
    <p>You must be at least 18, or have a parent or guardian who agrees to these terms for you. You need a payment method you’re allowed to use.</p>
    <h2>2. Your account</h2>
    <ul>
      <li>One subscription is for one person. Don’t share, sell or transfer your account or sign-up code.</li>
      <li>Keep your PIN private. You’re responsible for what happens on your account.</li>
      <li>For security, an account may be limited to one signed-in device at a time.</li>
    </ul>
    <h2>3. Subscription, billing and cancellation</h2>
    <p>The subscription costs ${price} USD a month. It renews and is charged automatically every month until you cancel. You can cancel any time; you keep access until the end of the month you’ve paid for. Payments are non-refundable except for billing errors. Members may also make optional one-time contributions (${money(CONTRIB_MIN_CENTS)} or more); a contribution doesn’t change the subscription or add features, isn’t tax-deductible, and is non-refundable. Cancellation, refunds and price changes are covered by our <a href="/subscribe/refunds">Refund &amp; Cancellation Policy</a>, which is part of these terms.</p>
    <h2>4. Acceptable use</h2>
    <p>Don’t use Saints Service to:</p>
    <ul>
      <li>break the law, or help anyone else break it;</li>
      <li>harass, threaten or bully anyone, or post hateful, sexually explicit or violent content;</li>
      <li>share other people’s private information without their permission;</li>
      <li>upload music, files or other content you don’t have the right to share;</li>
      <li>spread malware or spam, or try to get around security, limits or access controls;</li>
      <li>copy, scrape or overload the service with automated tools.</li>
    </ul>
    <h2>5. Your content</h2>
    <p>You keep ownership of the messages, music and files you add. You let us store, show and share them inside Saints Service as needed to run it (for example, music you choose to share with other members). You’re responsible for having the rights to anything you upload. We may remove content that breaks these terms. To report content that infringes your rights, email ${mailto}.</p>
    <h2>6. Changes and availability</h2>
    <p>We work to keep Saints Service running and improving, and features may change over time. Saints Service is provided “as is” and “as available”, without warranties of any kind, to the extent the law allows. We don’t promise it will always be available or error-free.</p>
    <h2>7. Suspension and termination</h2>
    <p>We may suspend or close an account that breaks these terms, or to protect members or the service. You can stop using Saints Service and cancel at any time. Refunds in these cases follow the <a href="/subscribe/refunds">Refund &amp; Cancellation Policy</a>.</p>
    <h2>8. Limitation of liability</h2>
    <p>To the extent the law allows, we aren’t liable for indirect, incidental or consequential damages, or for lost data or profits. Our total liability for any claim about Saints Service is limited to the amount you paid us in the 3 months before the claim. Some places don’t allow these limits, so they may not all apply to you.</p>
    <h2>9. Changes to these terms</h2>
    <p>We may update these terms. We’ll post the new version here with a new effective date, and for important changes we’ll email subscribers before they take effect. If you keep using Saints Service after that, the new terms apply; if you don’t agree, you can cancel.</p>
    <h2>10. Governing law</h2>
    <p>These terms are governed by the laws of the United States and of the state where Saints Service’s owner lives, without regard to conflict-of-law rules. Nothing here limits rights you have under consumer protection laws that can’t be waived.</p>
    <h2>11. Contact</h2>
    <p>Questions about these terms: ${mailto}.</p>`;

  return `
    <p>This policy explains what Saints Service (“we”, “us”) collects when you subscribe and use the app, why, and the choices you have.</p>
    <h2>1. What we collect</h2>
    <ul>
      <li><b>Account:</b> the username you choose and your sign-in sessions. Your PIN is never stored; we keep only a salted one-way hash that can check it.</li>
      <li><b>Payments:</b> handled by <a href="https://stripe.com/privacy" target="_blank" rel="noopener">Stripe</a>, which collects your payment details, email and billing details at checkout. We receive your email, the Stripe customer and subscription IDs, and the amount and date of each payment. We never receive your full card number.</li>
      <li><b>What you add:</b> messages, voice messages, music, files and other content you post.</li>
      <li><b>Proxy tab:</b> each time you launch the Proxy (in the app or in an about:blank window) and the pages of approved sites you open in it (the site and page path, without anything after a “?”). This is kept on your account for 90 days, and the owner and admins can see it.</li>
      <li><b>Technical information:</b> your IP address and device or browser type, used for security (sign-in limits, one-device sign-in and stopping abuse). We store these mostly as one-way hashes, along with your approximate country.</li>
      <li><b>On your device:</b> the app saves a sign-in token and your settings in your browser so you stay signed in. We don’t use advertising or tracking cookies.</li>
    </ul>
    <h2>2. How we use it</h2>
    <p>To run Saints Service and your account; to process your subscription; to keep the service and its members safe; to contact you about your subscription (receipts, renewals, payment problems, price or policy changes); and to meet legal obligations.</p>
    <h2>3. Who we share it with</h2>
    <p><b>We don’t sell or rent your personal information, and we don’t use it for advertising.</b> We share it only with the providers that run the service for us — Stripe (payments) and Cloudflare (hosting and storage), plus Apple, Google or your browser’s push service if you turn on notifications — or when the law requires it.</p>
    <h2>4. How long we keep it</h2>
    <p>Account information and content are kept while your account exists. Payment records are kept as long as tax and accounting rules require (usually up to 7 years). Security logs are kept for a limited time, usually 30 to 180 days.</p>
    <h2>5. Your choices</h2>
    <p>You can ask to see, correct or delete your information by emailing ${mailto}; we respond within 30 days. Deleting your account ends your access but doesn’t cancel billing by itself, so cancel your subscription too (see the <a href="/subscribe/refunds">Refund &amp; Cancellation Policy</a>). You can turn notifications off at any time.</p>
    <h2>6. Children</h2>
    <p>Saints Service isn’t meant for children under 13, and we don’t knowingly collect their information. If you think a child has given us information, email us and we’ll delete it.</p>
    <h2>7. Security</h2>
    <p>Connections are encrypted (HTTPS), PINs are stored only as hashes, and access to data is restricted. No system is perfectly secure, but we work to protect your information.</p>
    <h2>8. Changes</h2>
    <p>We’ll post any update here with a new effective date, and email subscribers about important changes.</p>
    <h2>9. Contact</h2>
    <p>Privacy questions or requests: ${mailto}.</p>`;
}

export function policyPage(env, kind, { cents } = {}) {
  const title = POLICY_PAGES[kind];
  if (!title) return '';
  const price = money(cents || priceCents(env));
  const others = Object.entries(POLICY_PAGES).filter(([k]) => k !== kind)
    .map(([k, t]) => `<a href="/subscribe/${k}">${esc(t)}</a>`).join(' · ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#14171d">
<title>${esc(title)} · Saints Service</title>
<link rel="apple-touch-icon" href="/console/icon-180.png">
<style>
  :root { --bg: #14171d; --card: #1b1f27; --border: #2c3442; --text: #eef1f6; --sub: #9aa4b5; --teal: #28b3a2; --violet: #7250cb; --link: #3ccbb6; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: radial-gradient(120% 50% at 50% 0%, #1b2530 0%, var(--bg) 60%) fixed, var(--bg); color: var(--text); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 720px; margin: 0 auto; padding: max(24px, env(safe-area-inset-top)) 16px max(32px, env(safe-area-inset-bottom)); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 22px; }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; font-weight: 700; }
  .brand img { width: 36px; height: 36px; border-radius: 9px; border: 1px solid var(--border); }
  .back { color: var(--link); font-size: 14px; text-decoration: none; white-space: nowrap; }
  article { background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 26px 22px; }
  h1 { font-size: 26px; line-height: 1.25; margin: 0 0 4px; letter-spacing: -0.01em; }
  .eff { color: var(--sub); font-size: 14px; margin: 0 0 18px; }
  h2 { font-size: 17px; margin: 26px 0 6px; }
  p, li { color: #d4d9e2; font-size: 15px; }
  ul { padding-left: 20px; margin: 8px 0; } li { margin: 6px 0; }
  b { color: var(--text); }
  a { color: var(--link); }
  .sum { border: 1px solid var(--border); border-left: 3px solid var(--teal); border-radius: 12px; padding: 4px 16px; margin: 6px 0 8px; background: rgba(40,179,162,0.06); }
  .sum p { margin: 10px 0; }
  .more { margin-top: 26px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 14px; color: var(--sub); }
  .legal { text-align: center; color: var(--sub); font-size: 12.5px; margin-top: 22px; }
  .legal nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; } .legal p { margin: 6px 0; color: var(--sub); font-size: 12.5px; }
</style></head>
<body><main>
  <div class="top"><a class="brand" href="/subscribe/"><img src="/console/icon-180.png" alt="" width="36" height="36">Saints Service</a><a class="back" href="/subscribe/">← Subscribe page</a></div>
  <article>
    <h1>${esc(title)}</h1>
    <p class="eff">Effective ${POLICY_EFFECTIVE}</p>
    ${body(env, kind, esc(price))}
    <p class="more">See also: ${others}</p>
  </article>
  ${policyFooter(env)}
</main></body></html>`;
}
