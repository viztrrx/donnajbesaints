// Pop-up notifications on a Chromebook (Chrome on ChromeOS), with Saints
// Service injected into two ordinary websites the way the bookmarklet does
// it, against worker.js in workerd. Chrome's real Notification API is used;
// each one shown is also recorded so the test can count and click them.
//   1  turning it on: a bell strip in Chat, Chrome asks, a test pop-up;
//      blocked shows how to unblock in Chrome
//   2  a direct message from someone else: ONE pop-up, though Saints Service
//      is open on two websites; clicking it opens the conversation
//   3  an @mention in #public: one pop-up; an ordinary chat message: none,
//      until "every chat message" is picked
//   4  a group message and @everyone
//   5  nothing pops up for what's already on screen
//   node tests/browser/chromebook-notify.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'chromebook-notify-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const CROS = 'Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN } });
const siteA = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'Class notes')); });
const siteB = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'Homework site')); });
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const W = (page, fn, arg, ms = 20000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const ANA = 'ana' + run, BEN = 'ben' + run, CY = 'cy' + run;
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

// Records every notification the page creates, and still creates the real one.
const SPY = () => {
  const Real = window.Notification;
  if (typeof Real !== 'function') return;
  window.__notes = [];
  class Spy extends Real {
    constructor(title, opts) { super(title, opts); window.__notes.push({ title, body: opts && opts.body, tag: opts && opts.tag, icon: opts && opts.icon, at: Date.now() }); window.__lastNote = this; }
  }
  Object.defineProperty(Spy, 'permission', { get: () => Real.permission });
  Spy.requestPermission = (...a) => Real.requestPermission(...a);
  window.Notification = Spy;
};
async function chromebook(user, { grant }) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, userAgent: CROS });
  if (grant) for (const s of [siteA, siteB]) await ctx.grantPermissions(['notifications'], { origin: `http://127.0.0.1:${s.port}` });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  await ctx.addInitScript(SPY);
  return ctx;
}
async function inject(ctx, port, user, create) {
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr(create ? '#gpa-signup-btn' : '#gpa-login-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return page;
}
const notes = (page) => page.evaluate(() => window.__notes || []);
const allNotes = async (pages) => (await Promise.all(pages.map(notes))).flat();
const click = (page, tab) => R(page, (r, t) => r.querySelector(`.gpa-dropdown-item[data-tab="${t}"]`).click(), tab);
// A message from someone else, straight to the Worker (as their phone would).
const login = async (u) => (await (await fetch(env.workerUrl + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, verifier: VER[u] }) })).json()).token;
const VER = {};
async function register(u) {
  VER[u] = (u + '0'.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, 'a');
  await fetch(env.workerUrl + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, verifier: VER[u] }) });
  return login(u);
}
const post = (s, p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-GPA-Session': s }, body: JSON.stringify(body) }).then((r) => r.json());
const waitNotes = async (pages, pred, ms) => { const end = Date.now() + ms; let n = []; while (Date.now() < end) { n = (await allNotes(pages)).filter(pred); if (n.length) { await new Promise((r) => setTimeout(r, 3000)); return (await allNotes(pages)).filter(pred); } await new Promise((r) => setTimeout(r, 1000)); } return n; };

try {
  await admin('/admin/config', { allowlist: { on: false } });
  const ben = await register(BEN);
  const cy = await register(CY);

  // 1: turning it on (Chrome hasn't been asked yet on this website).
  const ctx0 = await chromebook(ANA, { grant: false });
  const a0 = await inject(ctx0, siteA.port, ANA, true);
  await click(a0, 'chat');
  await a0.waitForTimeout(800);
  const chip = await R(a0, (r) => { const c = r.querySelector('#gpa-dn-chip'); return { shown: !c.hidden && !!c.offsetParent, text: c.textContent.trim() }; });
  check('Chat shows a bell strip to turn on pop-ups (no surprise prompt)', chip.shown && /Get a pop-up on this computer/.test(chip.text), JSON.stringify(chip));
  await shot(a0, '01-bell-strip.png');
  // Turn on asks Chrome. Its prompt can't be clicked in an automated test,
  // so it is dismissed: the page says to try again and choose Allow.
  await R(a0, (r) => r.querySelector('#gpa-dn-chip-on').click());
  await a0.waitForTimeout(1500);
  const dismissed = await a0.evaluate(() => document.getElementById('gpa-root-host').shadowRoot.textContent);
  check('Turn on asks Chrome; a dismissed prompt says to try again and choose Allow', /choose Allow/.test(dismissed));
  // Allowed in Chrome (its prompt, or Site settings): the card turns on by
  // itself, without a reload, and the strip goes away.
  await ctx0.grantPermissions(['notifications'], { origin: `http://127.0.0.1:${siteA.port}` });
  await R(a0, (r) => r.querySelector('.gpa-dropdown-item[data-tab="theme"]').click());
  await a0.waitForTimeout(400);
  await R(a0, (r) => { const t = r.querySelector('.gps-tab[data-sec="account"]'); if (t) t.click(); });
  const live = await W(a0, (r) => r.querySelector('#gpa-dn-toggle').textContent === 'Turn off' && !r.querySelector('#gpa-dn-opts').hidden, null, 8000);
  check('Once Chrome allows it, Settings shows it on (no reload needed) and the strip is gone', live && await R(a0, (r) => r.querySelector('#gpa-dn-chip').hidden));
  await R(a0, (r) => r.querySelector('#gpa-dn-test').click());
  await a0.waitForTimeout(800);
  const on = await R(a0, (r) => ({ msg: r.querySelector('#gpa-dn-msg').textContent, hint: r.querySelector('#gpa-dn-hint').textContent }));
  const test0 = await notes(a0);
  check('Send a test → a real Chrome notification', test0.some((n) => /test/.test(n.body || '')) && /Test sent/.test(on.msg) && /Do Not Disturb/.test(on.msg), JSON.stringify(on) + ' ' + JSON.stringify(test0));
  check('…with the Saints Service icon', test0.length && /\/console\/icon-192\.png$/.test(test0[0].icon || ''), test0[0] && test0[0].icon);
  await R(a0, (r) => r.querySelector('#gpa-desk-notify').scrollIntoView({ block: 'center' }));
  await a0.waitForTimeout(300);
  await shot(a0, '02-settings-on.png');
  await ctx0.close();

  // 2: two websites open on the same Chromebook (Chrome already allows both).
  const ctx = await chromebook(ANA, { grant: true });
  const a = await inject(ctx, siteA.port, ANA, true);
  const b = await inject(ctx, siteB.port, ANA, true);
  const pages = [a, b];
  const st = (p) => R(p, (r) => ({ in: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent, move: !r.querySelector('#gpa-login-move').hidden }));
  check('Saints Service is open and signed in on both websites', (await st(a)).in && (await st(b)).in, JSON.stringify([await st(a), await st(b)]));
  // Ben starts a DM and writes (the Messages list is checked every 20 s).
  const dm = (await post(ben, '/dm/start', { to: ANA })).conv;
  await a.waitForTimeout(22000);   // both pages have taken their first look at the list
  await post(ben, '/chat/send', { room: dm.id, text: 'are you coming to practice? ' + run });
  const dmNotes = await waitNotes(pages, (n) => (n.body || '').includes('are you coming to practice? ' + run), 45000);
  check('A direct message: a pop-up titled with who sent it', dmNotes.length >= 1 && dmNotes[0].title === BEN, JSON.stringify(dmNotes));
  check('…only ONE, though Saints Service is open on two websites', dmNotes.length === 1, String(dmNotes.length));
  // Clicking it opens the conversation (on the page that showed it).
  const shower = (await notes(a)).some((n) => (n.body || '').includes(run) && n.title === BEN) ? a : b;
  await shower.evaluate(() => { const n = window.__lastNote; if (n && n.onclick) n.onclick(new Event('click')); });
  const opened = await W(shower, (r, id) => { const p = r.querySelector('.gpa-pane[data-pane="chat"]'); return p.classList.contains('is-dm') && !p.classList.contains('dm-listing') && (r.querySelector('#gpa-dm-head .t') || {}).textContent === id; }, BEN, 10000);
  check('Clicking it opens that conversation', opened);
  await shower.waitForTimeout(1500);
  await shot(shower, '03-clicked-opens-dm.png');
  // 5: with it on screen, another message pops nothing up on that page.
  const before = (await allNotes(pages)).length;
  await post(ben, '/chat/send', { room: dm.id, text: 'already reading this ' + run });
  await shower.waitForTimeout(25000);
  const onScreen = (await allNotes(pages)).filter((n) => (n.body || '').includes('already reading this'));
  check('Nothing pops up for a conversation that’s on screen (other website may show it)', !(await notes(shower)).some((n) => (n.body || '').includes('already reading this')) && onScreen.length <= 1, JSON.stringify(onScreen) + ' before ' + before);

  // 3: an @mention in #public (each page checks #public every 15 s in the background).
  await click(a, 'welcome'); await click(b, 'welcome');
  await post(ben, '/chat/send', { room: 'public', user: BEN, text: `@${ANA} look at the new schedule ${run}` });
  const men = await waitNotes(pages, (n) => (n.body || '').includes('look at the new schedule'), 45000);
  check('An @mention in #public: one pop-up, “mentioned you in #public”', men.length === 1 && men[0].title === `${BEN} mentioned you in #public`, JSON.stringify(men));
  await post(ben, '/chat/send', { room: 'public', user: BEN, text: 'just chatting ' + run });
  await a.waitForTimeout(25000);
  check('An ordinary chat message: no pop-up (Messages, mentions and @everyone by default)', !(await allNotes(pages)).some((n) => (n.body || '').includes('just chatting')));
  // "Every chat message" on site A.
  await R(a, (r) => r.querySelector('.gpa-dropdown-item[data-tab="theme"]').click());
  await a.waitForTimeout(300);
  await R(a, (r) => { const t = r.querySelector('.gps-tab[data-sec="account"]'); if (t) t.click(); const s = r.querySelector('#gpa-dn-level'); s.value = 'all'; s.dispatchEvent(new Event('change')); });
  await post(ben, '/chat/send', { room: 'public', user: BEN, text: 'anyone up for lunch ' + run });
  const all = await waitNotes(pages, (n) => (n.body || '').includes('anyone up for lunch'), 45000);
  check('With “every chat message”: one pop-up for it', all.length === 1 && all[0].title === `${BEN} in #public`, JSON.stringify(all));

  // 4: a group and @everyone.
  const g = (await post(cy, '/dm/group', { name: 'Bio lab ' + run, members: [ANA, BEN] })).conv;
  await a.waitForTimeout(22000);
  await post(cy, '/chat/send', { room: g.id, text: '@everyone lab report due friday ' + run });
  const ev = await waitNotes(pages, (n) => (n.body || '').includes('lab report due friday'), 45000);
  check('A group message with @everyone: one pop-up, “cy… in Bio lab”', ev.length === 1 && ev[0].title === `${CY} in Bio lab ${run}`, JSON.stringify(ev));
  await shot(a, '04-after-notifications.png');

  // The Mention alerts card (push, for when no tab is open) points to the app from a website.
  await R(b, (r) => r.querySelector('.gpa-dropdown-item[data-tab="theme"]').click());
  await b.waitForTimeout(300);
  await R(b, (r) => { const t = r.querySelector('.gps-tab[data-sec="account"]'); if (t) t.click(); });
  await b.waitForTimeout(300);
  const mp = await R(b, (r) => ({ open: !r.querySelector('#gpa-mpush-open').hidden, hint: r.querySelector('#gpa-mpush-hint').textContent }));
  check('On a website, Mention alerts offers “Open the Saints Service app” (alerts with no tab open)', mp.open && /even when no Saints Service tab is open|turned on in the Saints Service app/.test(mp.hint), JSON.stringify(mp));
  await R(b, (r) => r.querySelector('#gpa-desk-notify').scrollIntoView({ block: 'start' }));
  await b.waitForTimeout(300);
  await shot(b, '05-settings-two-kinds.png');

  for (const [n, p] of [['site A', a], ['site B', b]]) check(`No page errors (${n})`, p._errors.length === 0, p._errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  await env.close();
  await siteA.close(); await siteB.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
