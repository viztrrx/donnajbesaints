// Welcome → AI models, end to end against worker.js in workerd:
//   1  an admin opens Welcome and sees the AI models card (limits read-only)
//   2  they open a user, give them a base and an upgraded model, turn
//      auto-upgrade on and allow no big models; it's saved on the server
//   3  the user's console gets those models from /status
//   4  "Back to defaults" clears them
//   node tests/browser/ai-models.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'ai-models-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const W = (p, { body, token, s, ip } = {}) => fetch(env.workerUrl + p, {
  method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + ADMIN } : {}), ...(s ? { 'X-GPA-Session': s } : {}), ...(ip ? { 'X-Real-IP': ip } : {}) },
  body: body ? JSON.stringify(body) : undefined
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const verifier = (u, pin) => pbkdf2Sync(`gpa-server|${u.toLowerCase()}|${pin}`, 'gpa-server-salt|' + u.toLowerCase(), 210000, 32, 'sha256').toString('hex');
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const waitFor = (page, fn, arg, ms = 20000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const STAFF = 'adm' + run, KJ = 'kj' + run, PIN = '482913';
const sr = (sel) => `#gpa-root-host >> ${sel}`;

try {
  await W('/admin/config', { token: true, body: { allowlist: { on: true, users: [STAFF, KJ] } } });
  await W('/auth/register', { body: { user: STAFF, verifier: verifier(STAFF, PIN) }, ip: '10.2.1.1' });
  const kj = (await W('/auth/register', { body: { user: KJ, verifier: verifier(KJ, PIN) }, ip: '10.2.1.2' })).data.token;
  await W('/admin/user/action', { token: true, body: { u: STAFF, action: 'setrole', role: 'admin' } });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.fill(sr('#gpa-login-user'), STAFF);
  await page.fill(sr('#gpa-login-pin'), PIN);
  await page.click(sr('#gpa-login-btn'));
  check('The admin is signed in', await waitFor(page, (r) => r.querySelector('#gpa-login').style.display === 'none'));
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  await R(page, (r) => { const n = r.querySelector('.gpa-dropdown-item[data-tab="welcome"]'); if (n) n.click(); });

  // 1
  const card = await waitFor(page, (r) => { const c = r.querySelector('#gpa-wmod'); return c && !c.hidden && !!c.querySelector('#gpa-wmod-name'); });
  check('Welcome → AI models shows for the admin', card);
  const ro = await R(page, (r) => ({ disabled: r.querySelector('#gpa-wmod-lh').disabled, save: !!r.querySelector('[data-wm="limits"]'), names: [...r.querySelectorAll('#gpa-wmod-names option')].map((o) => o.value) }));
  check('…limits are read-only for an admin (the owner sets them)', ro.disabled && !ro.save, JSON.stringify(ro).slice(0, 120));
  check('…and the user can be picked', ro.names.includes(KJ));

  // 2
  await page.fill(sr('#gpa-wmod-name'), KJ);
  await page.click(sr('[data-wm="load"]'));
  check('Opening the user shows their settings', await waitFor(page, (r) => { const f = r.querySelector('#gpa-wmod-form'); return f && !f.hidden && !!f.querySelector('select[data-f="base"]'); }));
  const opts = await R(page, (r) => [...r.querySelectorAll('#gpa-wmod-form select[data-f="smart"] option')].map((o) => o.textContent));
  check('The model list has the newer and the big (★) models', opts.some((t) => /★ gpt-6-astra/.test(t)) && opts.some((t) => /gpt-5-mini/.test(t)) && opts.some((t) => /★ gpt-5\.6-luna/.test(t)), opts.length + ' options');
  await page.selectOption(sr('#gpa-wmod-form select[data-f="base"]'), 'gpt-4o-mini');
  await page.selectOption(sr('#gpa-wmod-form select[data-f="smart"]'), 'gpt-6-astra');
  await page.selectOption(sr('#gpa-wmod-form select[data-f="auto"]'), 'on');
  await page.fill(sr('#gpa-wmod-form input[data-f="prem"]'), '0');
  await page.screenshot({ path: path.join(OUT, '01-set-models.png') });
  await page.click(sr('[data-wm="save"]'));
  const listed = await waitFor(page, (r, u) => !!r.querySelector(`#gpa-wmod .gpa-wsec-item[data-user="${u}"]`), KJ);
  check('Saved: they’re listed under “People with their own models”', listed);
  const srv = (await W('/admin/models?user=' + KJ, { token: true })).data.user.settings;
  check('…and on the server', srv.base === 'gpt-4o-mini' && srv.smart === 'gpt-6-astra' && srv.autoUpgrade === 'on' && srv.premiumDay === 0, JSON.stringify(srv));
  await R(page, (r) => r.querySelector('#gpa-wmod').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.join(OUT, '02-saved.png') });

  // 3
  const st = (await W('/status?user=' + KJ, { s: kj })).data.models;
  check('The user’s console gets the models from /status', st && st.base === 'gpt-4o-mini' && st.smart === 'gpt-6-astra' && st.autoUpgrade === 'on', JSON.stringify(st));

  // 4
  await page.click(sr('[data-wm="reset"]'));
  const cleared = await waitFor(page, (r, u) => !r.querySelector(`#gpa-wmod .gpa-wsec-item[data-user="${u}"]`), KJ);
  check('“Back to defaults” clears them', cleared && (await W('/status?user=' + KJ, { s: kj })).data.models === null);
  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  await W('/admin/config', { token: true, body: { allowlist: { on: false, users: [] } } }).catch(() => {});
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
