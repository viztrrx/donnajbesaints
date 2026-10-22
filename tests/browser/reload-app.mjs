// "Push reload to all clients" from the web app (/console/), with the owner
// signed in by PIN only — no admin token typed, as on the owner's phone.
//   1. the button sends the push using the signed-in session and says so
//   2. every open copy restarts, the owner's own included
//   3. it restarts once, not in a loop
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const OWNER = 'own' + Date.now().toString(36).slice(-5);
const ADMIN = 'reload-app-admin-token-0123456789';
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, OWNER, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const browser = await launch();
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const admin = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => { if (process.env.DBG && m.type() !== 'log') console.log('CONSOLE', m.type(), m.text()); });
  page.on('requestfailed', (q) => { if (process.env.DBG) console.log('REQFAIL', q.url(), q.failure() && q.failure().errorText); });   // "Make every open copy re-fetch…?" → OK
  // Count page loads: a pushed reload in the app is location.reload().
  await page.exposeFunction('__loaded', () => { page._loads = (page._loads || 0) + 1; });
  await ctx.addInitScript(() => { window.addEventListener('DOMContentLoaded', () => { try { window.__loaded(); } catch (e) { /* ignore */ } }); });
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  return { ctx, page };
}
async function signIn(page, user) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => r.querySelector('#gpa-login').style.display === 'none');
}

let o, u;
try {
  o = await open();
  // The owner's name is claimed once with proof (here the admin token, held
  // in memory only)…
  const setTok = (page, t) => R(page, (r, a) => {
    r.querySelector('#gpa-tele-endpoint').value = a.url;
    const i = r.querySelector('#gpa-tele-token'); i.value = a.t; i.dispatchEvent(new Event('change'));
  }, { t, url: env.workerUrl });
  await setTok(o.page, ADMIN);
  check('the owner signs in by PIN', await signIn(o.page, OWNER));
  // …then forgotten, as after any reload: only the PIN session is left.
  await setTok(o.page, '');
  check('…with no admin token left on the device', await R(o.page, (r) => !r.querySelector('#gpa-tele-token').value));
  u = await open();
  check('another user signs in', await signIn(u.page, 'rlu' + Date.now().toString(36).slice(-4)));
  await o.page.waitForTimeout(3000);
  const before = (await admin('/admin/config', {})).config.reloadVersion || 0;
  const loadsO = o.page._loads, loadsU = u.page._loads;

  // Open Admin → System and press the real button.
  await R(o.page, (r) => { const n = r.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click(); });
  await o.page.waitForTimeout(2000);
  await R(o.page, (r) => { const t = r.querySelector('.gps-tab[data-asec="system"]'); if (t) t.click(); });
  await o.page.waitForTimeout(1500);
  await R(o.page, (r) => r.querySelector('#gpa-adm-force-reload').click());
  // Read the toast right away: this copy restarts itself soon after.
  const toast = await o.page.waitForFunction(() => { const h = document.getElementById('gpa-root-host'); return !!h && [...h.shadowRoot.querySelectorAll('*')].some((n) => /Reload pushed/.test(n.textContent || '') && n.children.length === 0); }, null, { timeout: 5000 }).then(() => true, () => false);
  await o.page.waitForTimeout(1000);
  const after = (await admin('/admin/config', {})).config.reloadVersion || 0;
  check('pressing Push reload raises the counter using the owner’s session', after === before + 1, before + ' → ' + after);
  check('…and says so where the owner can see it', toast);

  const reloaded = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) { if (u.page._loads > loadsU) return true; await new Promise((r) => setTimeout(r, 500)); }
    return false;
  })();
  check('the other open copy restarts', reloaded, loadsU + ' → ' + u.page._loads);
  const ownReloaded = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) { if (o.page._loads > loadsO) return true; await new Promise((r) => setTimeout(r, 500)); }
    return false;
  })();
  check('the owner’s own copy restarts too', ownReloaded, loadsO + ' → ' + o.page._loads);

  // Restarts once, then stays put (no reload loop on the next polls).
  await u.page.waitForTimeout(4000);
  const settled = u.page._loads;
  await u.page.waitForTimeout(20000);
  check('…once — it does not keep reloading on later polls', u.page._loads === settled, settled + ' → ' + u.page._loads);
} catch (e) {
  check('test ran without throwing', false, String((e && e.stack) || e));
} finally {
  try { await browser.close(); } catch (e) { /* ignore */ }
  try { await env.close(); scriptHost.close(); } catch (e) { /* ignore */ }
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
