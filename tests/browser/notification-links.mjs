// Notification taps land on their exact spot, in the iPhone home-screen app
// against worker.js in workerd, with a screenshot of each landing:
//   1  "AI request failed: renzo" with the app closed → Admin asks to
//      connect (the token is memory-only) → renzo's profile, API key card
//   2  assigning renzo a key right there
//   3  with the app open (service-worker message): "Limit reached" → quota
//   4  "Access request: dub" → Security, dub's request
//   5  "Security alert: wrong PIN for kj" → Allowed users, kj's row
//   6  "Chat report" → Moderation, that report
//   7  "kj in #Study Group" → Chat, in that room
//   8  the test notification → Settings → Account → Phone notifications
//   node tests/browser/notification-links.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'notification-links-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const W = (p, body, headers) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json().catch(() => ({})));
const admin = (p, body) => W(p, body, { Authorization: 'Bearer ' + ADMIN });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const run = Date.now().toString(36).slice(-4);
const RENZO = 'renzo' + run, KJ = 'kj' + run;
let DUB = 'dub' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
await ctx.addInitScript((u) => {
  Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ }
}, env.workerUrl);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const ready = () => page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
// The spot a tap should land on is outlined for a moment (.gpa-flash).
const flashed = (sel, user) => page.waitForFunction(([s, u]) => {
  const r = document.getElementById('gpa-root-host').shadowRoot;
  const el = [...r.querySelectorAll(s)].find((x) => !u || String(x.dataset.user || x.dataset.report || '').toLowerCase() === u.toLowerCase());
  return !!el && el.classList.contains('gpa-flash');
}, [sel, user || ''], { timeout: 15000 }).then(() => true, () => false);
// A tap while the app is open: the service worker posts the link to the page.
const tapOpen = (url) => page.evaluate((u) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'agent-console-open', url: u } })), url);
const connectAdmin = () => R(page, (r, a) => {
  const f = r.querySelector('#gac-auth-fields');
  const inputs = [...f.querySelectorAll('input')];
  const tok = inputs.find((i) => i.type === 'password') || inputs[0];
  tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
  const urlIn = inputs.find((i) => i !== tok);
  if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
  r.querySelector('#gac-connect').click();
}, { token: ADMIN, url: env.workerUrl });

try {
  // Data the notifications are about.
  await W('/track', { user: RENZO, event: 'open', sid: 'r' + run });
  await W('/track', { user: KJ, event: 'open', sid: 'k' + run });
  const room = await admin('/admin/rooms', { action: 'create', name: 'Study Group ' + run });
  const sent = await W('/chat/send', { user: KJ, text: 'see you at 3', room: 'public' });
  const poll = await W('/chat/poll?room=public&since=0');
  const msg = (poll.messages || []).filter((m) => m.u === KJ).pop();
  const reporter = await W('/auth/register', { user: 'rep' + run, verifier: 'c'.repeat(64) });
  await W('/chat/report', { room: 'public', ts: msg && msg.ts, reason: 'spam' }, { 'X-GPA-Session': reporter.token });
  const reports = await admin('/admin/reports');
  const report = (reports.reports || []).find((r) => r.msgUser === KJ);

  // Owner signs in to the app once.
  await page.goto(env.workerUrl + '/console/');
  await ready();
  await page.fill(sr('#gpa-login-user'), 'ivan');
  await page.fill(sr('#gpa-login-pin'), '135790');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });

  // 1: app closed, then the "AI request failed: renzo" tap opens it.
  await page.goto(env.workerUrl + `/console/#tab=admin&sec=users&user=${RENZO}&focus=key`);
  await ready();
  const asks = await page.waitForFunction(() => { const r = document.getElementById('gpa-root-host').shadowRoot; const f = r.querySelector('#gac-auth'); return f && !f.hidden && f.offsetParent; }, null, { timeout: 15000 }).then(() => true, () => false);
  check('Cold start: Admin asks to connect first (token is memory-only)', asks);
  await page.waitForTimeout(800);   // let the side menu finish closing
  await shot(page, '01a-connect-first.png');
  check('…and the link was cleared from the address bar', await page.evaluate(() => !location.hash));
  await connectAdmin();
  check('After connecting: renzo’s profile, API key card highlighted', await flashed('#gac-insp-key'));
  const prof = await R(page, (r) => (r.querySelector('#gac-inspector h3') || {}).textContent || '');
  check('…it is renzo’s profile', prof === RENZO, prof);
  await page.waitForTimeout(1200);   // smooth scroll settles; the outline lasts 4 s
  await shot(page, '01b-renzo-api-key.png');

  // 2: assign a key from there.
  await R(page, (r) => { const i = r.querySelector('#gac-key-input'); i.value = 'sk-test-renzo-key-0123456789abcdef'; });
  await R(page, (r) => r.querySelector('#gac-insp-key [data-key="assign"]').click());
  await page.waitForTimeout(1500);
  const u = await admin('/admin/user?u=' + RENZO);
  check('Assign key from the profile works (Worker has it)', u.assignedKey === true, JSON.stringify({ assignedKey: u.assignedKey }));
  const card = await R(page, (r) => r.querySelector('#gac-insp-key').textContent);
  check('…and the card now says a key is assigned', /is assigned to/.test(card) && /Remove key/.test(card), card);
  await R(page, (r) => r.querySelector('#gac-insp-key').scrollIntoView({ block: 'center' }));
  await shot(page, '02-key-assigned.png');

  // 3-8: taps while the app is open.
  await tapOpen(`/console/#tab=admin&sec=users&user=${KJ}&focus=quota`);
  check('“Limit reached: kj” → kj’s quota card', await flashed('#gac-insp-quota'));
  check('…on kj’s profile', (await R(page, (r) => r.querySelector('#gac-inspector h3').textContent)) === KJ);
  await page.waitForTimeout(1200);   // smooth scroll settles; the outline lasts 4 s
  await shot(page, '03-kj-quota.png');

  await admin('/admin/config', { allowlist: { on: true, users: [KJ, RENZO] } });
  // One network may send 5 requests an hour, and the local Worker's KV
  // persists between test runs, so a refusal here is the limit, not a bug.
  const asked = await W('/access/request', { user: DUB, message: 'can I get in?' });
  if (!asked.ok) {
    const existing = ((await admin('/admin/access-requests')).requests || [])[0];
    console.log('NOTE  access request refused (' + (asked.error || '?') + '); using ' + (existing ? 'the existing request from ' + existing.user : 'no request'));
    if (existing) DUB = existing.user;
  }
  await tapOpen(`/console/#tab=admin&sec=security&focus=requests&user=${DUB}`);
  check('“Access request: dub” → Security, dub’s request', await flashed('.gac-req', DUB));
  await page.waitForTimeout(1200);   // smooth scroll settles; the outline lasts 4 s
  await shot(page, '04-access-request.png');

  await W('/auth/register', { user: KJ, verifier: 'a'.repeat(64) });
  await tapOpen(`/console/#tab=admin&sec=security&focus=allow&user=${KJ}`);
  check('“Wrong PIN for kj” → Allowed users, kj’s row', await flashed('#gac-allow-accts .gac-acct', KJ));
  await page.waitForTimeout(1200);
  const lit = await R(page, (r) => [...r.querySelectorAll('.gpa-flash')].map((x) => x.dataset.user || x.id || x.className));
  check('…and only kj’s row is outlined (the earlier tap let go)', lit.length === 1 && lit[0].toLowerCase() === KJ.toLowerCase(), JSON.stringify(lit));
  await page.waitForTimeout(1200);   // smooth scroll settles; the outline lasts 4 s
  await shot(page, '05-allowed-user-row.png');
  await admin('/admin/config', { allowlist: { on: false, users: [] } });

  if (report) {
    await tapOpen(`/console/#tab=admin&sec=moderation&report=${encodeURIComponent(report.id)}`);
    check('“Chat report” → Moderation, that report', await flashed('.gac-report', report.id));
    await page.waitForTimeout(700);
    await shot(page, '06-report.png');
  } else check('“Chat report” → Moderation, that report', false, 'could not create a report: ' + JSON.stringify(sent));

  // Join the private room on this device, then tap its chat notification.
  await page.evaluate(([id, code, name]) => { const k = 'gpa_chat_rooms'; let j = {}; try { j = JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { j = {}; } j[id] = { name, code }; localStorage.setItem(k, JSON.stringify(j)); }, [room.id, room.code, 'Study Group ' + run]);
  await page.reload();
  await ready();
  await page.waitForTimeout(1500);
  await tapOpen(`/console/#tab=chat&room=${encodeURIComponent(room.id)}`);
  await page.waitForTimeout(1500);
  const chat = await R(page, (r) => ({ tab: r.querySelector('.gpa-dropdown-item[data-tab="chat"]').classList.contains('active'), room: r.querySelector('#gpa-chat-room').value }));
  check('“kj in #Study Group” → Chat, in that room', chat.tab && chat.room === room.id, JSON.stringify(chat));
  await shot(page, '07-chat-room.png');

  await tapOpen('/console/#tab=theme&sec=account&focus=push');
  check('Test notification → Settings → Phone notifications', await page.waitForFunction(() => { const r = document.getElementById('gpa-root-host').shadowRoot; const c = r.querySelector('#gpa-push-card'); return c && c.classList.contains('gpa-flash'); }, null, { timeout: 15000 }).then(() => true, () => false));
  await page.waitForTimeout(1200);   // smooth scroll settles; the outline lasts 4 s
  await shot(page, '08-settings-push.png');

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await admin('/admin/config', { allowlist: { on: false, users: [] } }).catch(() => {});
  await admin('/admin/assignkey', { user: RENZO, key: '' }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
