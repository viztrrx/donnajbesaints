// The subscription countdown and the Renew box, end to end in the console on a
// website against worker.js in workerd, with a stand-in for Telnyx:
//   1. a listed person sees "Xd Yh left" under the header at every panel size
//   2. Renew: the subscribe link, "Text me the link" (a real text request to
//      the Telnyx stand-in), and who takes cash (the owner and admins)
//   3. texting CASH to the number: a signed webhook → the reply says who to pay
//   4. an admin sees "No expiry"; the owner's Cash & texting card
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'renew-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// Telnyx stand-in: records every text the Worker sends.
const texts = [];
const telnyx = await serve((rq, rs) => {
  let b = '';
  rq.on('data', (c) => { b += c; });
  rq.on('end', () => {
    rs.setHeader('Content-Type', 'application/json');
    if (rq.url !== '/v2/messages' || rq.headers.authorization !== 'Bearer KEY_browser') { rs.statusCode = 401; rs.end(JSON.stringify({ errors: [{ detail: 'Authentication failed' }] })); return; }
    const m = JSON.parse(b); texts.push(m);
    rs.end(JSON.stringify({ data: { id: 'msg_' + texts.length } }));
  });
});
const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const PUB = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('base64');
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, TELNYX_API: `http://127.0.0.1:${telnyx.port}/v2`, TELNYX_API_KEY: 'KEY_browser', TELNYX_FROM: '+12395550100', TELNYX_PUBLIC_KEY: PUB } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'A school website')); });
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const admin = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const KJ = 'kj' + run, ANA = 'ana' + run;

async function computer() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${site.port}` });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${site.port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx, page };
}
async function signIn(page, user, button = '#gpa-signup-btn') {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr(button));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => r.querySelector('#gpa-login').style.display === 'none');
}
const strip = (page) => R(page, (r) => { const s = r.querySelector('#gpa-substrip'); return { shown: !!s && !s.hidden && !!s.offsetParent, left: r.querySelector('#gpa-substrip-left').textContent, note: r.querySelector('#gpa-substrip-note').textContent, renew: !r.querySelector('#gpa-substrip-renew').hidden }; });

let kj, ana, owner;
try {
  await admin('/admin/config', { allowlist: { on: true, users: [KJ, ANA] } });

  // 1: kj is on Allowed users: an automatic month, counting down.
  kj = await computer();
  check('kj signs in', await signIn(kj.page, KJ));
  await waitFor(kj.page, (r) => { const s = r.querySelector('#gpa-substrip'); return s && !s.hidden; }, null, 20000);
  let st = await strip(kj.page);
  check('Under the header: “Subscription … Xd Yh left” and a Renew button', st.shown && /^\d+d \d+h left$/.test(st.left) && st.renew, JSON.stringify(st));
  check('…and when it ends (date and time)', /ends \w+ \d+ at \d+:\d\d/.test(st.note), st.note);
  await kj.page.screenshot({ path: path.join(OUT, '01-countdown.png') });
  for (const size of ['compact', 'normal', 'large', 'xl', 'full', 'center']) {
    await R(kj.page, (r, s) => r.querySelector(`.size-btn[data-size="${s}"]`).click(), size);
    await kj.page.waitForTimeout(500);
    const g = await R(kj.page, (r) => {
      const p = r.querySelector('.gpa-panel').getBoundingClientRect(), el = r.querySelector('#gpa-substrip'), b = el.getBoundingClientRect();
      const row = el.querySelector('.gpa-usage-row');
      return { shown: !el.hidden && b.height > 0, inside: b.left >= p.left - 1 && b.right <= p.right + 1 && b.top >= p.top - 1, fits: row.scrollWidth <= row.clientWidth + 1, left: r.querySelector('#gpa-substrip-left').textContent };
    });
    check(`${size}: the countdown shows, inside the panel, nothing cut off (${g.left})`, g.shown && g.inside && g.fits, JSON.stringify(g));
    if (size === 'compact') await kj.page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, '02-countdown-compact.png') });
  }

  // 2: Renew.
  await R(kj.page, (r) => r.querySelector('#gpa-substrip-renew').click());
  const opened = await waitFor(kj.page, (r) => !r.querySelector('#gpa-renew').hidden && !/Loading/.test(r.querySelector('#gpa-renew-cash').textContent), null, 10000);
  const box = await R(kj.page, (r) => ({ href: r.querySelector('#gpa-renew-open').href, sms: !r.querySelector('#gpa-renew-sms').hidden, cash: r.querySelector('#gpa-renew-cash').textContent }));
  check('Renew opens: the subscribe link', opened && box.href === env.workerUrl + '/subscribe/', box.href);
  check('…“Text me the link” (texting is on)', box.sms);
  check('…and paying cash: who to give it to (the owner, automatically) and the number to text CASH to', /in person to ivan \(owner\)/.test(box.cash) && /text CASH to \(239\) 555-0100/.test(box.cash), box.cash);
  await kj.page.fill(sr('#gpa-renew-phone'), '(239) 555-0123');
  await kj.page.click(sr('#gpa-renew-send'));
  await waitFor(kj.page, (r) => /Sent to|Couldn|isn’t/.test(r.querySelector('#gpa-renew-msg').textContent), null, 10000);
  const sentMsg = await R(kj.page, (r) => r.querySelector('#gpa-renew-msg').textContent);
  check('Text me the link: “Sent to (239) 555-0123”, and Telnyx got exactly one text with the link', /Sent to \(239\) 555-0123/.test(sentMsg) && texts.length === 1 && texts[0].to === '+12395550123' && texts[0].from === '+12395550100' && texts[0].text.includes(env.workerUrl + '/subscribe/') && /Reply CASH/.test(texts[0].text), sentMsg + ' ' + JSON.stringify(texts[0]));
  await kj.page.screenshot({ path: path.join(OUT, '03-renew-box.png') });

  // 3: kj texts CASH to the number (Telnyx forwards it, signed).
  const t = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ data: { id: 'ev_' + run, event_type: 'message.received', payload: { from: { phone_number: '+12395550123' }, to: [{ phone_number: '+12395550100' }], text: 'paying cash' } } });
  const sig = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(t + '|' + body))).toString('base64');
  const hook = await fetch(env.workerUrl + '/sms/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json', 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': String(t) }, body });
  check('Texting CASH: the reply says who to give the cash to', hook.status === 200 && texts.length === 2 && /paying cash\? Give the monthly price in person to ivan \(owner\)\. They mark you as paid\./.test(texts[1].text), JSON.stringify(texts[1]));
  const forged = await fetch(env.workerUrl + '/sms/inbound', { method: 'POST', headers: { 'Content-Type': 'application/json', 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': String(t) }, body: body.replace('paying cash', 'CASH CASH') });
  check('A webhook that isn’t really from Telnyx is refused (no reply sent)', forged.status === 401 && texts.length === 2);

  // 4: ana is an admin: no expiry. She's added to the cash list automatically.
  ana = await computer();
  await signIn(ana.page, ANA);
  await admin('/admin/user/action', { u: ANA.toLowerCase(), action: 'setrole', role: 'admin' });
  await admin('/admin/user/action', { u: ANA.toLowerCase(), action: 'revokesessions' });
  await ana.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await ana.page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none', null, { timeout: 25000 }).catch(() => {});
  await signIn(ana.page, ANA, '#gpa-login-btn');
  await waitFor(ana.page, (r) => /No expiry/.test(r.querySelector('#gpa-substrip-left').textContent), null, 20000);
  st = await strip(ana.page);
  check('An admin sees “No expiry” (and no Renew button)', st.shown && st.left === 'No expiry' && !st.renew && /doesn’t expire/.test(st.note), JSON.stringify(st));
  await ana.page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, '04-admin-no-expiry.png') });
  const info = await (await fetch(env.workerUrl + '/sms/info')).json();
  check('The cash list is now the owner and the admin, automatically', info.cash.join('|') === 'ivan (owner)|' + ANA, info.cash.join(', '));

  // The owner's Cash & texting card.
  owner = await computer();
  for (const btn of ['#gpa-signup-btn', '#gpa-login-btn']) {
    if (await R(owner.page, (r) => r.querySelector('#gpa-login').style.display === 'none')) break;
    await signIn(owner.page, 'ivan', btn);
  }
  await R(owner.page, (r, a) => {
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
  await owner.page.waitForTimeout(2500);
  await R(owner.page, (r) => r.querySelector('.gps-tab[data-asec="security"]').click());
  const cardOk = await waitFor(owner.page, (r) => { const b = r.querySelector('#gac-sms'); return b && /Texting is/.test(b.textContent); }, null, 15000);
  const cardText = await R(owner.page, (r) => r.querySelector('#gac-sms').textContent.replace(/\s+/g, ' '));
  check('Owner: Security → Cash & texting: texting on from (239) 555-0100, the automatic list, and who texted CASH', cardOk && /Texting is on from \(239\) 555-0100/.test(cardText) && cardText.includes('ivan (owner), ' + ANA) && cardText.includes(KJ) && /\(239\) 555-0123/.test(cardText), cardText.slice(0, 300));
  await R(owner.page, (r) => r.querySelector('#gac-sms-card').scrollIntoView({ block: 'start' }));
  await owner.page.waitForTimeout(300);
  await owner.page.locator(sr('#gac-sms-card')).screenshot({ path: path.join(OUT, '05-owner-cash-texting.png') });
  await owner.page.fill(sr('#gac-cash-names'), 'Mr. Lopez\n' + ANA);
  await R(owner.page, (r) => r.querySelector('#gac-cash-save').click());
  await owner.page.waitForTimeout(1500);
  const info2 = await (await fetch(env.workerUrl + '/sms/info')).json();
  check('…the owner sets their own list: people paying cash are told those names', info2.cash.join('|') === 'Mr. Lopez|' + ANA, info2.cash.join(', '));

  for (const [n, p] of [['kj', kj], ['ana', ana], ['owner', owner]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
  await telnyx.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
