// The Proxy tab against a FAKE Scramjet frontend, with the console injected on
// a website and the real main Worker for logging/monitor. The real Scramjet
// frontend (viztrrx/frontend) needs a browser service worker, WASM and the
// Wisp backend, none of which run here; this stands in for it with a page that
// posts the same {saintsProxy:1,type:"nav",url} messages the frontend sends.
//   1. launcher (In this tab needs fullscreen; In a new window launches now)
//   2. launch here (fullscreen) frames the frontend; status Connected
//   3. the frontend reports a site -> status Browsing; it is logged
//   4. Admin: /admin/proxy + Proxy monitor show the user live on that site
//   5. about:blank launches without fullscreen and frames the frontend
//   6. a host page that forbids framing -> "Blocked by this website"
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'proxy-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const req = createRequire(path.join(ROOT, 'package.json'));
const { devices } = req('playwright');

// ---- A stand-in for the Scramjet frontend: when embedded it posts the site
// its "frame" is on to the parent console, exactly like public/index.js. ----
const FE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Scramjet (fake)</title></head>
<body><h1>Scramjet</h1>
<button id="go-tiktok">tiktok</button><button id="go-wiki">wiki</button><button id="home">home</button>
<script>
function post(url){ try { if (parent && parent !== window) parent.postMessage({ saintsProxy: 1, type: "nav", url: url }, "*"); } catch (e) {} }
post("");
document.getElementById("go-tiktok").onclick = function(){ post("https://www.tiktok.com/@someone?x=1"); };
document.getElementById("go-wiki").onclick = function(){ post("https://en.wikipedia.org/wiki/Proxy"); };
document.getElementById("home").onclick = function(){ post(""); };
</script></body></html>`;
const fe = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(FE_PAGE); });
const FE = `http://127.0.0.1:${fe.port}`;

const ADMIN = 'proxy-test-admin-token-0123456789';
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN } });
// The host page the console is injected on; /strict forbids framing anything.
const site = await serve((rq, rs) => {
  rs.setHeader('Content-Type', 'text/html');
  if (rq.url.startsWith('/strict')) rs.setHeader('Content-Security-Policy', "frame-src 'self'");
  rs.end(HOST_PAGE.replace('Some ordinary page', rq.url.startsWith('/strict') ? 'A strict website' : 'A school website'));
});
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);

async function computer({ server = FE, pathName = '/', phone = false } = {}) {
  const c = await browser.newContext(phone ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1200, height: 860 } });
  await c.addInitScript(([u, s]) => {
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); localStorage.setItem('gpa_proxy_server_url', s); } catch (e) { /* ignore */ }
  }, [env.workerUrl, server]);
  const page = await c.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${site.port}${pathName}`);
  await page.evaluate((cd) => { (0, eval)(cd); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx: c, page };
}
async function signIn(page, user) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => r.querySelector('#gpa-login').style.display === 'none');
}
const tab = (page, t) => R(page, (r, x) => { const n = r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`); n.style.display = ''; n.click(); }, t);
const stat = (page) => R(page, (r) => ({ src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), status: r.querySelector('#gpa-proxy-status').textContent, error: r.querySelector('#gpa-proxy-error').style.display === 'none' ? '' : r.querySelector('#gpa-proxy-error').textContent, stage: r.querySelector('#gpa-proxy-stage').style.display }));
const feFrame = (page) => page.frames().find((x) => x.url().startsWith(FE));
async function launchHere(page) {
  if (!(await R(page, (r) => !!r.fullscreenElement))) await page.click(sr('#gpa-proxy-fs'));
  await waitFor(page, (r) => { const b = r.querySelector('#gpa-proxy-launch-here'); return b && b.offsetParent && !b.disabled; }, null, 6000);
  await page.click(sr('#gpa-proxy-launch-here'));
  await waitFor(page, (r) => /Connected|Browsing/.test(r.querySelector('#gpa-proxy-status').textContent), null, 15000);
}
async function connectAdmin(page) {
  await tab(page, 'admin');
  await page.waitForTimeout(500);
  await R(page, (r, x) => {
    const f = r.querySelector('#gac-auth-fields');
    const inputs = [...f.querySelectorAll('input')];
    const tok = inputs.find((i) => i.type === 'password') || inputs[0];
    tok.value = x.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
    const urlIn = inputs.find((i) => i !== tok);
    if (urlIn) { urlIn.value = x.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
    r.querySelector('#gac-connect').click();
  }, { token: ADMIN, url: env.workerUrl });
  await page.waitForTimeout(2500);
}

let a, b, d;
try {
  // 1: launcher.
  a = await computer();
  check('signs in', await signIn(a.page, 'px' + run));
  await tab(a.page, 'browser');
  await a.page.waitForTimeout(600);
  const pre = await R(a.page, (r) => ({ src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), stage: r.querySelector('#gpa-proxy-stage').style.display, fs: !!r.querySelector('#gpa-proxy-fs').offsetParent, here: !r.querySelector('#gpa-proxy-launch-here').offsetParent, blank: r.querySelector('#gpa-proxy-launch-blank').disabled, lede: r.querySelector('.gpx-pl-lede').textContent }));
  check('Opening Proxy loads nothing; In this tab offers Enter Fullscreen, In a new window can launch; the lede names Scramjet', !pre.src && pre.stage === 'none' && pre.fs && pre.here && !pre.blank && /Scramjet/.test(pre.lede), JSON.stringify(pre));

  // 2: launch here (fullscreen) frames the frontend.
  await launchHere(a.page);
  let st = await stat(a.page);
  check('Launch Here (fullscreen): the console frames the Scramjet frontend and shows Connected', st.src === FE + '/' && st.stage === '' && /Connected|Browsing/.test(st.status) && !st.error, JSON.stringify(st));
  check('…the frame is not sandboxed to an opaque origin (Scramjet needs its own origin + service worker)', await R(a.page, (r) => { const f = r.querySelector('#gpa-proxy-frame'); return !f.getAttribute('sandbox') && /cross-origin-isolated/.test(f.getAttribute('allow') || ''); }));

  // 3: the frontend reports a site -> Browsing + logged.
  await feFrame(a.page).click('#go-tiktok');
  await waitFor(a.page, (r) => /Browsing/.test(r.querySelector('#gpa-proxy-status').textContent), null, 8000);
  check('A site opened in the proxy is reported: status becomes Browsing', /Browsing/.test((await stat(a.page)).status));
  await feFrame(a.page).click('#go-wiki');
  await a.page.waitForTimeout(600);
  await feFrame(a.page).click('#home');
  await a.page.waitForTimeout(600);
  check('Back to the start page: status returns to Connected', /Connected/.test((await stat(a.page)).status));
  await feFrame(a.page).click('#go-tiktok');
  await a.page.waitForTimeout(800);

  // 4: Admin sees it live and logged.
  const prof = await (await fetch(`${env.workerUrl}/admin/proxy`, { headers: { Authorization: 'Bearer ' + ADMIN } })).json();
  const me = (prof.users || []).find((u) => u.user.toLowerCase() === 'px' + run);
  check('Admin /admin/proxy: the user is live on the Proxy, on the reported site, in the tab', !!me && !!me.live && me.live.mode === 'here' && me.live.site === 'https://www.tiktok.com/@someone' && me.visits >= 2, JSON.stringify(me && { live: me.live, visits: me.visits }));
  const urls = me ? me.entries.filter((x) => x.ev === 'visit').map((x) => x.url) : [];
  check('…the sites visited are logged without query strings', urls.includes('https://www.tiktok.com/@someone') && urls.includes('https://en.wikipedia.org/wiki/Proxy') && urls.every((x) => !x.includes('?')), urls.join(' '));
  await connectAdmin(a.page);
  await R(a.page, (r) => { const t = r.querySelector('.gps-tab[data-asec="proxy"]'); if (t) t.click(); });
  const U = 'px' + run;
  await waitFor(a.page, (r, u) => !!r.querySelector(`#gac-pm-live [data-pm-user="${u}"]`), U, 15000);
  const liveRow = await R(a.page, (r, u) => r.querySelector(`#gac-pm-live [data-pm-user="${u}"]`).textContent.replace(/\s+/g, ' '), U);
  check('Admin → Proxy monitor → Live now: the user, the site they proxied and are on now', liveRow.includes(U) && /Proxied tiktok\.com\/@someone · on it now/.test(liveRow), liveRow);
  await R(a.page, (r, u) => r.querySelector(`#gac-pm-users [data-pm-user="${u}"]`).click(), U);
  await a.page.waitForTimeout(300);
  const hist = await R(a.page, (r) => r.querySelector('#gac-pm-detail').textContent.replace(/\s+/g, ' '));
  check('…pressing their name shows today’s history (launches and the sites proxied)', hist.includes(U) && /Proxied tiktok\.com\/@someone/.test(hist) && /Proxied en\.wikipedia\.org/.test(hist) && /Launched/.test(hist), hist.slice(0, 160));
  await a.page.screenshot({ path: path.join(OUT, '01-proxy-monitor.png') });
  check('No page errors (main computer)', a.page._errors.length === 0, a.page._errors.slice(0, 2).join(' | '));

  // 5: about:blank launches without fullscreen and frames the frontend.
  b = await computer();
  await signIn(b.page, 'pb' + run);
  await tab(b.page, 'browser');
  await b.page.waitForTimeout(400);
  check('Not fullscreen: In a new window can still launch', await R(b.page, (r) => !r.fullscreenElement && !r.querySelector('#gpa-proxy-launch-blank').disabled));
  const [pop] = await Promise.all([b.ctx.waitForEvent('page', { timeout: 8000 }), b.page.click(sr('#gpa-proxy-launch-blank'))]);
  await pop.waitForLoadState('domcontentloaded').catch(() => {});
  await b.page.waitForTimeout(800);
  const inWin = pop.frames().find((x) => x.url().startsWith(FE));
  check('Launch in about:blank (not fullscreen): the window opens and frames the Scramjet frontend', pop.url() === 'about:blank' && !!inWin, pop.url() + ' frames ' + pop.frames().map((x) => x.url()).join(','));
  const mainNow = await R(b.page, (r) => ({ gate: r.querySelector('#gpa-proxy-gate').textContent, btn: r.querySelector('#gpa-proxy-launch-blank').textContent }));
  check('…the console says it’s in the about:blank window', /about:blank window/.test(mainNow.gate) && /Show window/.test(mainNow.btn), JSON.stringify(mainNow));
  if (inWin) { await inWin.click('#go-wiki'); await b.page.waitForTimeout(800); }
  const blankProf = await (await fetch(`${env.workerUrl}/admin/proxy`, { headers: { Authorization: 'Bearer ' + ADMIN } })).json();
  const bme = (blankProf.users || []).find((u) => u.user.toLowerCase() === 'pb' + run);
  check('…a site opened in the window is logged as an about:blank launch', !!bme && bme.live && bme.live.mode === 'blank' && bme.live.site === 'https://en.wikipedia.org/wiki/Proxy' && bme.entries.some((x) => x.ev === 'launch' && x.mode === 'blank'), JSON.stringify(bme && { live: bme.live }));
  await pop.close();
  await b.page.waitForTimeout(1200);
  check('Closing the window returns the tab to the launcher', await R(b.page, (r) => r.querySelector('#gpa-proxy-stage').style.display === 'none' && /was closed/.test(r.querySelector('#gpa-proxy-gate').textContent)));
  check('No page errors (about:blank computer)', b.page._errors.length === 0, b.page._errors.slice(0, 2).join(' | '));

  // 6: a host page that forbids framing.
  d = await computer({ pathName: '/strict' });
  await signIn(d.page, 'pd' + run);
  await tab(d.page, 'browser');
  if (!(await R(d.page, (r) => !!r.fullscreenElement))) await d.page.click(sr('#gpa-proxy-fs'));
  await waitFor(d.page, (r) => { const bb = r.querySelector('#gpa-proxy-launch-here'); return bb && bb.offsetParent && !bb.disabled; }, null, 6000);
  await d.page.click(sr('#gpa-proxy-launch-here'));
  await waitFor(d.page, (r) => r.querySelector('#gpa-proxy-error').style.display !== 'none', null, 10000);
  st = await stat(d.page);
  check('A website that forbids framing: “Blocked by this website” + Open in a new tab', /Blocked by this website/.test(st.status) && /security settings/.test(st.error) && /Open in a new tab/.test(st.error), JSON.stringify(st));
  await d.page.screenshot({ path: path.join(OUT, '02-blocked.png') });
  check('No page errors (strict computer)', d.page._errors.length === 0, d.page._errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
  await fe.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
