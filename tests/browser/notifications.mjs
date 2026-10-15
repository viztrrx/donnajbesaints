// Owner notification settings in the home-screen app (emulated iPhone)
// against worker.js in workerd. Headless Chromium has no push service, so the
// browser's PushManager is replaced by a fake that returns a well-formed
// subscription; delivery and encryption are covered by tests/push.test.mjs.
//   node tests/browser/notifications.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'notifications-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const USER = 'own' + Date.now().toString(36).slice(-5);

try {
  const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  await ctx.grantPermissions(['notifications'], { origin: env.workerUrl });
  await ctx.addInitScript((u) => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ }
    // Fake push service subscription with real-format keys.
    if (window.PushManager) {
      let current = null;
      const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      PushManager.prototype.getSubscription = async function () { return current; };
      PushManager.prototype.subscribe = async function (opts) {
        window.__subscribeKeyLen = opts && opts.applicationServerKey ? opts.applicationServerKey.byteLength || opts.applicationServerKey.length : 0;
        const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
        const p256dh = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
        const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
        const json = { endpoint: 'https://web.push.apple.com/QFakeDevice' + Math.random().toString(36).slice(2), keys: { p256dh, auth } };
        current = { toJSON: () => json, unsubscribe: async () => { current = null; return true; } };
        return current;
      };
    }
  }, env.workerUrl);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  const sr = (sel) => `#gpa-root-host >> ${sel}`;
  await page.fill(sr('#gpa-login-user'), USER);
  await page.fill(sr('#gpa-login-pin'), '123456');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display === 'none');
  await page.waitForTimeout(500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });

  // Settings → Account.
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="theme"]').click());
  await page.waitForTimeout(400);
  await R(page, (r) => r.querySelector('.gps-tab[data-sec="account"]').click());
  await page.waitForTimeout(300);
  const card = await R(page, (r) => { const c = r.querySelector('#gpa-push-card'); return { shown: !!c && c.offsetParent !== null, btn: r.querySelector('#gpa-push-toggle').textContent, disabled: r.querySelector('#gpa-push-toggle').disabled }; });
  check('Notifications card in Settings → Account', card.shown && card.btn === 'Turn on' && !card.disabled, JSON.stringify(card));
  await page.locator(sr('#gpa-push-card')).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '01-off.png') });

  // Not proven owner yet: the Worker refuses, the app asks for the token.
  await R(page, (r) => r.querySelector('#gpa-push-toggle').click());
  await page.waitForFunction(() => !document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-push-token-row').hidden, null, { timeout: 15000 }).catch(() => {});
  const asked = await R(page, (r) => ({ row: !r.querySelector('#gpa-push-token-row').hidden, msg: r.querySelector('#gpa-push-msg').textContent }));
  check('Non-owner is refused and asked for the admin token', asked.row && /Only the owner/.test(asked.msg), asked.msg);
  check('Subscribed with the Worker’s 65-byte VAPID key', (await page.evaluate(() => window.__subscribeKeyLen)) === 65);

  await page.fill(sr('#gpa-push-token'), ADMIN);
  await R(page, (r) => r.querySelector('#gpa-push-toggle').click());
  await page.waitForFunction(() => !document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-push-cats').hidden, null, { timeout: 15000 }).catch(() => {});
  const on = await R(page, (r) => ({
    btn: r.querySelector('#gpa-push-toggle').textContent,
    cats: [...r.querySelectorAll('#gpa-push-cats .gpa-push-cat')].map((c) => c.querySelector('span').textContent + ':' + c.querySelector('.gps-switch').getAttribute('aria-pressed')),
    token: r.querySelector('#gpa-push-token').value
  }));
  check('With the admin token, notifications turn on', on.btn === 'Turn off', on.btn);
  check('All 15 alert types listed, grouped, on except Who’s online', on.cats.length === 15 && on.cats.filter((c) => c.endsWith(':false')).length === 1 && on.cats.some((c) => /online.*:false$/.test(c)), on.cats.join(', '));
  check('Switches are grouped (Chat, People, AI, System)', (await R(page, (r) => [...r.querySelectorAll('.gpa-push-group')].map((g) => g.textContent).join(','))) === 'Chat,People,AI,System');
  check('Admin token cleared from the field (not kept)', on.token === '');
  check('Token never written to storage', !(await page.evaluate((t) => Object.values(localStorage).some((v) => v.includes(t)), ADMIN)));
  await page.screenshot({ path: path.join(OUT, '02-on.png') });

  // Turn one kind off: saved on the Worker.
  await R(page, (r) => [...r.querySelectorAll('#gpa-push-cats .gpa-push-cat')].find((c) => /^Sign-ins/.test(c.textContent)).querySelector('.gps-switch').click());
  await page.waitForTimeout(800);
  const dev = await page.evaluate(() => JSON.parse(localStorage.getItem('gpa_push_device')));
  const st = await fetch(env.workerUrl + '/push/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dev) }).then((r) => r.json());
  check('Switching off Sign-ins is saved on the Worker', st.subscription && st.subscription.categories.signin === false && st.subscription.categories.chat === true, JSON.stringify(st.subscription && st.subscription.categories));

  // Turn on "Who's online" and quiet hours 10 PM to 7 AM.
  await R(page, (r) => [...r.querySelectorAll('#gpa-push-cats .gpa-push-cat')].find((c) => /online/.test(c.textContent)).querySelector('.gps-switch').click());
  await page.waitForTimeout(600);
  await R(page, (r) => r.querySelector('#gpa-push-quiet-sw').click());
  await page.waitForTimeout(600);
  const qs = await fetch(env.workerUrl + '/push/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dev) }).then((r) => r.json());
  check('Who’s online and quiet hours (10 PM–7 AM) saved', qs.subscription.categories.presence === true && qs.subscription.quiet && qs.subscription.quiet.start === 22 && qs.subscription.quiet.end === 7, JSON.stringify(qs.subscription.quiet));
  await page.locator(sr('#gpa-push-quiet')).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '03-quiet.png') });

  // Reopen the app: the card remembers this device.
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  check('After a restart the device is still on', await R(page, (r) => r.querySelector('#gpa-push-toggle').textContent === 'Turn off'));
  check('…with its quiet hours shown', await R(page, (r) => !r.querySelector('#gpa-push-quiet-times').hidden && r.querySelector('#gpa-push-quiet-start').value === '22'));

  // A notification tap opens /console/#tab=chat on the Chat tab.
  await page.goto(env.workerUrl + '/console/#tab=chat');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  check('Notification link opens the Chat tab', await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="chat"]').classList.contains('active')));

  // Turn off removes the subscription on the Worker.
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="theme"]').click());
  await page.waitForTimeout(300);
  await R(page, (r) => r.querySelector('.gps-tab[data-sec="account"]').click());
  await R(page, (r) => r.querySelector('#gpa-push-toggle').click());
  await page.waitForTimeout(1000);
  const after = await fetch(env.workerUrl + '/push/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dev) });
  check('Turn off removes this device on the Worker', after.status === 404);
  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
