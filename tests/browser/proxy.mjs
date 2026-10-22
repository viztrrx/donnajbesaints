// The Proxy tab against the REAL saints-proxy-test Worker (proxy-worker/, run
// locally in workerd by wrangler), next to the main Worker, with the console
// injected on a website. Two approved fake sites are served over HTTPS from
// 127.0.0.1:443 under real-looking names (tests/browser/fixtures/proxy-sites/
// setup.sh: throwaway CA + /etc/hosts, test containers only), plus a third
// approved name that has no server. The bar has no address field: Back,
// Forward, Reload and Home (this site's main page); pages are reached through
// links, and a saved last page is reopened on launch.
//   1. tab order; launching (only while fullscreen); the connection test
//      lists the approved sites; the bar shows no address
//   2. an approved site opened from the connection test: CSS, images,
//      scripts, relative links, query + fragment, in-frame link clicks
//   3. Back / Forward follow in-page links; Home = the site's main page
//   4. redirects between approved sites (Back doesn't bounce); a redirect
//      elsewhere is refused; HTTP 404; website down; website timeout
//   5. isolation: proxied pages get no storage (opaque origin per page)
//   6. tab switching keeps the page; reload; the last page comes back
//   7. Worker down / Worker 500 / a website whose CSP forbids framing
//   8. default address = deployed Worker; old localhost:4141 migrates;
//      phone width; light/dark themes
//   9. leaving fullscreen hides it; Close; the about:blank window (its own
//      fullscreen gate, the browser moves in and back out)
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'proxy-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const req = createRequire(path.join(ROOT, 'package.json'));
const { devices } = req('playwright');
const DEPLOYED = 'https://saints-proxy-test.viztrrx.workers.dev';
const FX = 'fixture.saints-test.dev', DOCS = 'docs.saints-test.dev', DOWN = 'down.saints-test.dev';

// ---- The two fake approved sites (HTTPS on 127.0.0.1:443) ----
const FXDIR = execFileSync('sh', [path.join(ROOT, 'tests/browser/fixtures/proxy-sites/setup.sh')]).toString().trim();
const ctx = (h) => tls.createSecureContext({ key: fs.readFileSync(path.join(FXDIR, h + '.key')), cert: fs.readFileSync(path.join(FXDIR, h + '.crt')) });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const hits = [];
const html = (title, body) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/style.css"></head><body>${body}<script src="/app.js"></script></body></html>`;
const sites = https.createServer({ SNICallback: (n, cb) => cb(null, ctx(n.startsWith('docs') ? 'docs' : 'fixture')), ...(() => ({ key: fs.readFileSync(path.join(FXDIR, 'fixture.key')), cert: fs.readFileSync(path.join(FXDIR, 'fixture.crt')) }))() }, (q, r) => {
  const host = String(q.headers.host || '').split(':')[0];
  const u = new URL(q.url, 'https://' + host);
  hits.push(host + u.pathname + ' cookie=' + (q.headers.cookie || '') + ' auth=' + (q.headers.authorization || ''));
  const send = (code, type, body, extra = {}) => { r.writeHead(code, { 'content-type': type, ...extra }); r.end(q.method === 'HEAD' ? undefined : body); };
  if (u.pathname === '/style.css') return send(200, 'text/css', 'body{background:rgb(1, 2, 3);color:#fff;font:16px sans-serif}');
  if (u.pathname === '/img/dot.png') return send(200, 'image/png', PNG);
  if (u.pathname === '/app.js') return send(200, 'text/javascript', "document.getElementById('js').textContent='JS ran';var s;try{localStorage.setItem('k','1');s='storage: open'}catch(e){s='storage: blocked'}document.getElementById('store').textContent=s;");
  if (host === FX) {
    if (u.pathname === '/') return send(200, 'text/html', html('Fixture home', `<h1>Fixture home</h1><p id="js">no JS</p><p id="store">?</p><img id="dot" src="img/dot.png" width="20" height="20"><p><a id="rel" href="page2?x=1#sec">page two</a> <a id="docs" href="https://${DOCS}/welcome">docs</a> <a id="ext" href="https://www.iana.org/">iana</a></p>`));
    if (u.pathname === '/page2') return send(200, 'text/html', html('Page two', `<h1>Page two</h1><p id="q">x=${u.searchParams.get('x')}</p><p id="js">no JS</p><p id="store">?</p><p id="sec">section</p>`));
    if (u.pathname === '/go-docs') return send(302, 'text/html', '', { location: `https://${DOCS}/welcome` });
    if (u.pathname === '/go-evil') return send(302, 'text/html', '', { location: 'https://evil.example/' });
    if (u.pathname === '/slow') { setTimeout(() => send(200, 'text/html', html('Slow', '<h1>Slow</h1><p id="js"></p><p id="store"></p>')), 14000); return; }
  }
  if (host === DOCS && u.pathname === '/welcome') return send(200, 'text/html', html('Docs welcome', '<h1>Docs welcome</h1><p id="js">no JS</p><p id="store">?</p>'));
  return send(404, 'text/html', html('Not found', '<h1>404 here</h1><p id="js"></p><p id="store"></p>'));
});
await new Promise((res) => sites.listen(443, '127.0.0.1', res));

// ---- The real proxy Worker (local workerd) ----
// Its wrangler.jsonc date (2026-10-19) is newer than this repo's local
// workerd supports, so only the local run uses an older one.
const { unstable_dev } = await import(pathToFileURL(req.resolve('wrangler')).href);
const pw = await unstable_dev(path.join(ROOT, 'proxy-worker/index.js'), { config: path.join(ROOT, 'proxy-worker/wrangler.jsonc'), ip: '127.0.0.1', port: 0, local: true, compatibilityDate: '2026-10-01', logLevel: 'none', vars: { TARGET_ORIGINS: `https://${FX}, https://${DOCS}, https://${DOWN}` }, experimental: { disableExperimentalWarning: true } });
const PROXY = `http://${pw.address}:${pw.port}`;
const S = (h, p = '/') => `${PROXY}/site/${h}${p}`;
const broken = await serve((rq, rs) => {
  if (rq.url.startsWith('/health')) { rs.setHeader('Content-Type', 'application/json'); rs.setHeader('Access-Control-Allow-Origin', '*'); rs.statusCode = 500; rs.end('{"status":"misconfigured"}'); return; }
  rs.setHeader('Content-Type', 'text/html'); rs.end('<p>broken worker</p>');
});
const deadPort = await (async () => { const s = await serve((q, r) => r.end('')); const p = s.port; await s.close(); return p; })();

const ADMIN = 'proxy-test-admin-token-0123456789';
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN } });
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

async function computer({ server, pathName = '/', phone = false } = {}) {
  const c = await browser.newContext(phone ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1200, height: 860 } });
  await c.addInitScript(([u, s]) => {
    try {
      localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1');
      if (s === null) localStorage.removeItem('gpa_proxy_server_url'); else localStorage.setItem('gpa_proxy_server_url', s);
    } catch (e) { /* ignore */ }
  }, [env.workerUrl, server === undefined ? null : server]);
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
const state = (page) => R(page, (r) => ({ src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), status: r.querySelector('#gpa-proxy-status').textContent, error: r.querySelector('#gpa-proxy-error').style.display === 'none' ? '' : r.querySelector('#gpa-proxy-error').textContent, proxy: r.querySelector('.gpa-pane[data-pane="browser"] .gpx-room').dataset.proxy || '', back: !r.querySelector('#gpa-proxy-back').disabled, fwd: !r.querySelector('#gpa-proxy-forward').disabled }));
const frameFor = (page, prefix) => page.frames().find((x) => x.url().startsWith(prefix));
const frameText = async (page, prefix) => { const f = frameFor(page, prefix); return f ? (await f.textContent('body').catch(() => '')).replace(/\s+/g, ' ').trim() : ''; };
const SETTLE = /Loaded|Connected ·|Website|HTTP|Redirect|failed|Not supported|timed out/;
async function settle(page, re = SETTLE) {
  await page.waitForTimeout(300);
  await waitFor(page, (r, x) => new RegExp(x).test(r.querySelector('#gpa-proxy-status').textContent) || r.querySelector('#gpa-proxy-error').style.display !== 'none', re.source, 25000);
  await page.waitForTimeout(700);   // the /status/ check lands just after the load
  return state(page);
}
// The proxy only launches while the console is fullscreen (like Eaglercraft).
async function launchHere(page) {
  if (!(await R(page, (r) => !!r.fullscreenElement))) await page.click(sr('#gpa-proxy-fs'));
  await waitFor(page, (r) => !r.querySelector('#gpa-proxy-launch-here').disabled, null, 5000);
  await page.click(sr('#gpa-proxy-launch-here'));
}
// There's no address field: a page is reached by reopening the proxy with it
// saved as the last page (the same path a returning visitor takes).
async function openVia(page, addr, re) {
  if (await R(page, (r) => r.querySelector('#gpa-proxy-stage').style.display !== 'none')) await page.click(sr('#gpa-proxy-close'));
  await page.evaluate((x) => localStorage.setItem('gpa_proxy_last_destination', x), addr);
  await launchHere(page);
  return settle(page, re);
}
// A link clicked inside the proxied page; the page reports where it went.
async function clickIn(page, prefix, sel, expectSrcPrefix) {
  await frameFor(page, prefix).click(sel);
  await page.waitForTimeout(1200);
  return state(page).then((st) => ({ ...st, frame: (frameFor(page, expectSrcPrefix) || { url: () => '' }).url() }));
}
const btn = (page, id) => page.click(sr('#' + id));
// The address field on top: hidden on the proxy's start page; elsewhere empty,
// with what was typed as its placeholder. The proxy's own address never shows.
const addr = (page, proxyHost) => R(page, (r, h) => { const i = r.querySelector('#gpa-proxy-url'); const stage = r.querySelector('#gpa-proxy-stage'); return { hidden: r.querySelector('#gpa-proxy-addr').hidden, value: i.value, ph: i.placeholder, proxyShown: (stage.innerText + ' ' + i.value + ' ' + i.placeholder + ' ' + r.querySelector('#gpa-proxy-status').textContent).includes(h) }; }, proxyHost);
async function typeTop(page, text) {
  await page.fill(sr('#gpa-proxy-url'), text);
  await page.press(sr('#gpa-proxy-url'), 'Enter');
  return settle(page);
}
async function typeInFrame(page, text) {
  const f = frameFor(page, PROXY + '/preview') || frameFor(page, PROXY + '/go');
  await f.fill('input[name="q"]', text);
  await f.press('input[name="q"]', 'Enter');
  await page.waitForTimeout(1500);
  return settle(page);
}

let a, b, c, d, e, f2;
try {
  // 1: the tab, in its place; launching; the connection test; no address shown.
  a = await computer({ server: PROXY });
  check('signs in', await signIn(a.page, 'px' + run));
  const order = await R(a.page, (r) => [...r.querySelectorAll('.gpa-dropdown-item[data-tab]')].map((x) => x.dataset.tab));
  const i = order.indexOf('browser');
  check('One Proxy tab, still followed by Eaglercraft then Games', order.filter((x) => x === 'browser').length === 1 && order[i + 1] === 'eaglercraft' && order[i + 2] === 'games', order.join(','));
  await tab(a.page, 'browser');
  await a.page.waitForTimeout(800);
  const pre = await R(a.page, (r) => ({ src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), stage: r.querySelector('#gpa-proxy-stage').style.display, here: !r.querySelector('#gpa-proxy-launch-here').offsetParent || r.querySelector('#gpa-proxy-launch-here').disabled, fs: !!r.querySelector('#gpa-proxy-fs').offsetParent, blank: r.querySelector('#gpa-proxy-launch-blank').disabled, sub: r.querySelector('#gpa-proxy-fs-chip').textContent }));
  check('Opening Proxy loads nothing; not fullscreen: “In this tab” offers Enter Fullscreen (no launch), “In a new window” can launch', !pre.src && pre.stage === 'none' && pre.here && pre.fs && !pre.blank && /Needs fullscreen/.test(pre.sub), JSON.stringify(pre));
  await R(a.page, (r) => { const x = r.querySelector('#gpa-proxy-launch-here'); x.disabled = false; x.click(); x.disabled = true; });
  await a.page.waitForTimeout(400);
  check('A forced launch while not fullscreen opens nothing', !(await R(a.page, (r) => r.querySelector('#gpa-proxy-frame').getAttribute('src'))) && /Enter fullscreen first/.test(await R(a.page, (r) => r.querySelector('#gpa-proxy-launch-error').textContent)));
  await launchHere(a.page);
  check('Launch Here: the console is fullscreen and the browser replaces the launcher', await R(a.page, (r) => !!r.fullscreenElement && r.querySelector('#gpa-proxy-stage').style.display === '' && !r.querySelector('.gpx-proxy-launcher').offsetParent));
  let st = await settle(a.page);
  check('Launching shows the Worker’s connection test: “Connected · connection test”', st.src === PROXY + '/preview' && /Connected · connection test/.test(st.status) && st.proxy === 'connected' && !st.error, JSON.stringify(st));
  const pv = await frameText(a.page, PROXY + '/preview');
  check('…which lists the approved sites', pv.includes(FX) && pv.includes(DOCS), pv.slice(0, 160));
  const PH = new URL(PROXY).host;
  const bar = await R(a.page, (r) => { const b2 = r.querySelector('#gpa-proxy-stage .gpx-browser-bar'); return { addrHidden: r.querySelector('#gpa-proxy-addr').hidden, buttons: [...b2.querySelectorAll('button')].map((x) => x.id), text: b2.textContent.trim() }; });
  check('On the proxy’s start page the bar shows no address field: Back, Forward, Reload, Home (and Close)', bar.addrHidden && bar.buttons.join(',') === 'gpa-proxy-back,gpa-proxy-forward,gpa-proxy-reload,gpa-proxy-home,gpa-proxy-close' && !bar.text, JSON.stringify(bar));
  check('…and the start page itself has the search box', await frameFor(a.page, PROXY + '/preview').$('form[action="/go"] input[name="q"]').then((x) => !!x));
  check('Back and Forward start disabled', !st.back && !st.fwd, JSON.stringify(st));
  const attrs = await R(a.page, (r) => { const fr = r.querySelector('#gpa-proxy-frame'); return { sandbox: fr.getAttribute('sandbox'), allow: fr.getAttribute('allow'), ref: fr.getAttribute('referrerpolicy') }; });
  check('The frame is sandboxed: no allow-same-origin (isolation), no top-navigation, no camera/mic/location, no referrer', !/allow-same-origin/.test(attrs.sandbox) && !/allow-top-navigation/.test(attrs.sandbox) && /allow-scripts/.test(attrs.sandbox) && !/camera|microphone|geolocation/.test(attrs.allow) && attrs.ref === 'no-referrer', JSON.stringify(attrs));
  await a.page.screenshot({ path: path.join(OUT, '01-connected.png') });

  // 2: an approved site, opened from the connection test, through the Worker.
  hits.length = 0;
  st = await typeInFrame(a.page, FX);
  check(`Typing “${FX}” into the start page and pressing Enter opens it through the proxy: “Loaded”, Back enabled`, st.src === S(FX) && st.status === 'Loaded' && st.back && !st.fwd && !st.error, JSON.stringify(st));
  let top = await addr(a.page, PH);
  check('…then the address field appears on top: empty, with what was typed as its placeholder; the proxy’s address shows nowhere', !top.hidden && top.value === '' && top.ph === FX && !top.proxyShown, JSON.stringify(top));
  const fr = frameFor(a.page, S(FX));
  await fr.waitForFunction(() => document.getElementById('js') && document.getElementById('js').textContent === 'JS ran', null, { timeout: 10000 }).catch(() => {});
  const page1 = await fr.evaluate(() => ({ h1: document.querySelector('h1').textContent, bg: getComputedStyle(document.body).backgroundColor, img: document.getElementById('dot').naturalWidth, imgSrc: document.getElementById('dot').src, js: document.getElementById('js').textContent, store: document.getElementById('store').textContent, rel: document.getElementById('rel').href, docs: document.getElementById('docs').href, ext: document.getElementById('ext').href, origin: (() => { try { return String(window.origin); } catch (x) { return 'err'; } })() }));
  check('The page’s own CSS loaded through the proxy (background rgb(1, 2, 3))', page1.bg === 'rgb(1, 2, 3)', page1.bg);
  check('…its image (a relative src) loaded through /site/', page1.img === 1 && page1.imgSrc === S(FX, '/img/dot.png'), page1.imgSrc);
  check('…its script ran (“JS ran”)', page1.js === 'JS ran');
  check('…and every resource came through the Worker, with no cookies or credentials sent', ['/', '/style.css', '/img/dot.png', '/app.js'].every((p) => hits.some((h) => h.startsWith(FX + p + ' '))) && hits.every((h) => / cookie= auth=$/.test(h)), hits.join(' | '));
  check('Links: relative (with query + fragment) → /site/<same host>; the other approved site → its /site/; other websites left alone', page1.rel === S(FX, '/page2?x=1#sec') && page1.docs === S(DOCS, '/welcome') && page1.ext === 'https://www.iana.org/', JSON.stringify({ rel: page1.rel, docs: page1.docs, ext: page1.ext }));
  check('Isolation: the proxied page runs in its own opaque origin and gets no storage', page1.origin === 'null' && page1.store === 'storage: blocked', JSON.stringify({ origin: page1.origin, store: page1.store }));
  await a.page.screenshot({ path: path.join(OUT, '02-approved-site.png') });

  // 3: Back / Forward follow links clicked inside the page; Home is the site's main page.
  st = await clickIn(a.page, S(FX), '#rel', S(FX, '/page2'));
  const p2 = frameFor(a.page, S(FX, '/page2'));
  check('Clicking a link inside the page works (page two, query x=1 kept)', !!p2 && /Page two/.test(await p2.textContent('h1')) && (await p2.textContent('#q')) === 'x=1', p2 ? p2.url() : 'no frame');
  check('…the tab follows it: Back enabled, Forward not; the field keeps what was typed', st.back && !st.fwd && st.status === 'Loaded' && (await addr(a.page, PH)).ph === FX, JSON.stringify(st));
  check('The last page is saved for next time (the page clicked to)', await a.page.evaluate(() => localStorage.getItem('gpa_proxy_last_destination')) === `https://${FX}/page2?x=1#sec`);
  await btn(a.page, 'gpa-proxy-back');
  st = await settle(a.page);
  check('Back: the previous page (the site’s home), Forward now enabled', st.src === S(FX) && /Fixture home/.test(await frameText(a.page, S(FX))) && st.back && st.fwd, JSON.stringify(st));
  await btn(a.page, 'gpa-proxy-back');
  st = await settle(a.page);
  check('Back again: the start page, Back disabled, the address field hidden again', st.src === PROXY + '/preview' && !st.back && st.fwd && (await addr(a.page, PH)).hidden, JSON.stringify(st));
  await btn(a.page, 'gpa-proxy-forward');
  st = await settle(a.page);
  await btn(a.page, 'gpa-proxy-forward');
  st = await settle(a.page);
  check('Forward twice: back on page two, Forward disabled', st.src === S(FX, '/page2?x=1#sec') && /Page two/.test(await frameText(a.page, S(FX, '/page2'))) && st.back && !st.fwd, JSON.stringify(st));
  await btn(a.page, 'gpa-proxy-home');
  st = await settle(a.page);
  check('Home: the main page of the site that’s showing', st.src === S(FX) && /Fixture home/.test(await frameText(a.page, S(FX))) && st.back && !st.fwd, JSON.stringify(st));
  st = await clickIn(a.page, S(FX), '#docs', S(DOCS, '/welcome'));
  check('A link to the second approved site opens it', /Docs welcome/.test(await frameText(a.page, S(DOCS))) && st.status === 'Loaded', JSON.stringify(st));
  // 3b: the address field on top, like a browser's: through the proxy, never directly.
  st = await typeTop(a.page, `${FX}/page2?x=7`);
  top = await addr(a.page, PH);
  check('Typing a different site on top opens it through the proxy; what was typed stays as the placeholder', st.src === S(FX, '/page2?x=7') && st.status === 'Loaded' && top.value === '' && top.ph === `${FX}/page2?x=7` && !top.proxyShown && !a.page.frames().some((x) => x.url().startsWith('https://' + FX)), JSON.stringify({ st, top }));
  st = await typeTop(a.page, 'docs');
  check('A bare name (“docs”) opens the approved site it names', st.src === S(DOCS) && (await addr(a.page, PH)).ph === 'docs', JSON.stringify(st));
  await a.page.fill(sr('#gpa-proxy-url'), 'google.com');
  await a.page.press(sr('#gpa-proxy-url'), 'Enter');
  await a.page.waitForTimeout(400);
  st = await state(a.page); top = await addr(a.page, PH);
  check('A site that isn’t approved is explained; the page and the typed text stay', st.src === S(DOCS) && /isn’t supported/.test(st.error) && top.value === 'google.com', JSON.stringify({ st, top }));
  await a.page.fill(sr('#gpa-proxy-url'), '');
  await btn(a.page, 'gpa-proxy-back');
  st = await settle(a.page);
  check('Back brings back that page’s typed text too', st.src === S(FX, '/page2?x=7') && (await addr(a.page, PH)).ph === `${FX}/page2?x=7`, JSON.stringify(st));
  await a.page.screenshot({ path: path.join(OUT, '03-back-forward.png') });

  // 4a: something that isn't an approved site, typed into the start page.
  st = await openVia(a.page, '');
  st = await typeInFrame(a.page, 'best restaurants near me');
  check('Typed into the start page but not an approved site: explained in the page and above it; the field stays hidden', /isn’t supported/.test(st.error) && /an approved site/.test(await frameText(a.page, PROXY + '/go')) && (await addr(a.page, PH)).hidden, JSON.stringify(st));

  // 4: redirects and errors (pages reopened as the last page).
  st = await openVia(a.page, `https://${FX}/go-docs`);
  await a.page.waitForTimeout(800);
  st = await state(a.page);
  check('A redirect to another approved site is followed (through the proxy); Back doesn’t bounce into it', !st.error && !!frameFor(a.page, S(DOCS, '/welcome')) && !st.back, JSON.stringify(st) + ' frames: ' + a.page.frames().map((x) => x.url()).join(' '));
  st = await openVia(a.page, `https://${FX}/go-evil`);
  check('A redirect to an unapproved site is refused: “Redirect not permitted”', /Redirect not permitted/.test(st.status) && /isn’t approved/.test(st.error) && /Redirect not permitted/.test(await frameText(a.page, S(FX, '/go-evil'))), JSON.stringify(st));
  st = await openVia(a.page, `https://${FX}/missing`);
  check('HTTP errors are named: “HTTP 404 … (page not found)”', st.src === S(FX, '/missing') && /HTTP 404/.test(st.status) && /page not found/.test(st.error), JSON.stringify(st));
  await a.page.screenshot({ path: path.join(OUT, '04-http-404.png') });
  st = await openVia(a.page, `https://${DOWN}/`);
  check('An approved site that’s down: “Website unavailable” (and the Worker is fine)', /Website unavailable/.test(st.status) && /proxy Worker is fine/.test(st.error), JSON.stringify(st));
  st = await openVia(a.page, `http://${DOCS}/welcome`);
  check('http:// on an approved site is upgraded to https', st.src === S(DOCS, '/welcome'), JSON.stringify(st));
  st = await openVia(a.page, 'https://google.com/');
  check('A saved page that isn’t approved falls back to the connection test', st.src === PROXY + '/preview', JSON.stringify(st));

  // 6: tab switching keeps the page; reload.
  st = await openVia(a.page, `https://${FX}/`);
  await R(a.page, (r) => { r.querySelector('#gpa-proxy-frame').__mark = 'same'; });
  let navs = 0;
  const onNav = (x) => { if (x.url().startsWith(PROXY)) navs++; };
  a.page.on('framenavigated', onNav);
  await tab(a.page, 'chat'); await a.page.waitForTimeout(600);
  await tab(a.page, 'music'); await a.page.waitForTimeout(400);
  await tab(a.page, 'browser'); await a.page.waitForTimeout(800);
  st = await state(a.page);
  check('Away to Chat and Music and back: the same frame, same page, not reloaded', (await R(a.page, (r) => r.querySelector('#gpa-proxy-frame').__mark)) === 'same' && st.src === S(FX) && navs === 0 && /Loaded/.test(st.status), JSON.stringify({ navs, ...st }));
  await btn(a.page, 'gpa-proxy-reload');
  await waitFor(a.page, (r) => /Loaded/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  check('Reload loads the same page again', navs >= 1 && (await state(a.page)).src === S(FX), String(navs));
  a.page.off('framenavigated', onNav);

  // 8b: themes.
  for (const th of ['white', 'dark']) {
    await tab(a.page, 'theme');
    await R(a.page, (r, t) => { const x = r.querySelector(`.gps-tile[data-theme="${t}"]`); if (x) x.click(); }, th);
    await a.page.waitForTimeout(900);
    await tab(a.page, 'browser');
    await a.page.waitForTimeout(500);
    const look = await R(a.page, (r) => ({ bar: getComputedStyle(r.querySelector('.gpx-browser-bar')).backgroundColor, shown: !!r.querySelector('#gpa-proxy-frame').offsetParent }));
    check(`Theme “${th}”: the Proxy tab uses the theme (bar ${look.bar})`, look.shown && !!look.bar, JSON.stringify(look));
    await a.page.screenshot({ path: path.join(OUT, `08-theme-${th}.png`) });
  }

  // 9: leaving fullscreen hides the proxy; fullscreen brings the same page back; Close unloads.
  await a.page.evaluate(() => document.exitFullscreen());
  await a.page.waitForTimeout(500);
  let hid = await R(a.page, (r) => ({ stage: r.querySelector('#gpa-proxy-stage').style.display, src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), btn: r.querySelector('#gpa-proxy-launch-here').textContent, gate: r.querySelector('#gpa-proxy-gate').textContent }));
  check('Leaving fullscreen hides the proxy (page kept) and offers Resume', hid.stage === 'none' && hid.src === S(FX) && /Resume/.test(hid.btn) && /needs fullscreen to come back/.test(hid.gate), JSON.stringify(hid));
  await btn(a.page, 'gpa-proxy-launch-here');
  await a.page.waitForTimeout(500);
  hid = await R(a.page, (r) => ({ fs: !!r.fullscreenElement, stage: r.querySelector('#gpa-proxy-stage').style.display, src: r.querySelector('#gpa-proxy-frame').getAttribute('src') }));
  check('…Resume goes fullscreen and shows the same page again', hid.fs && hid.stage === '' && hid.src === S(FX), JSON.stringify(hid));
  await btn(a.page, 'gpa-proxy-close');
  await a.page.waitForTimeout(400);
  hid = await R(a.page, (r) => ({ stage: r.querySelector('#gpa-proxy-stage').style.display, src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), status: r.querySelector('#gpa-proxy-status').textContent, gate: r.querySelector('#gpa-proxy-gate').textContent, back: r.querySelector('#gpa-proxy-back').disabled }));
  check('Close unloads the page, clears Back/Forward and shows the launcher', hid.stage === 'none' && hid.src === 'about:blank' && hid.status === 'Not connected' && hid.back && /proxy was closed/.test(hid.gate), JSON.stringify(hid));

  // 9b: about:blank — no fullscreen needed: the browser moves into the window
  // and opens right away, and moves back out on close.
  await a.page.evaluate(() => document.exitFullscreen().catch(() => {}));
  await a.page.waitForTimeout(400);
  await a.page.evaluate((x) => localStorage.setItem('gpa_proxy_last_destination', x), `https://${FX}/`);
  check('Not fullscreen: “Launch” in a new window is available', await R(a.page, (r) => !r.fullscreenElement && !r.querySelector('#gpa-proxy-launch-blank').disabled && !!r.querySelector('#gpa-proxy-launch-blank').offsetParent));
  const [pop] = await Promise.all([a.ctx.waitForEvent('page', { timeout: 8000 }), btn(a.page, 'gpa-proxy-launch-blank')]);
  const P = (fn) => pop.evaluate((f) => (0, eval)(f)(document.body.firstElementChild.shadowRoot), String(fn));
  await pop.waitForFunction(() => /Loaded/.test(document.body.firstElementChild.shadowRoot.querySelector('#gpa-proxy-status').textContent), null, { timeout: 20000 }).catch(() => {});
  let pw1 = await P((r) => ({ url: location.href, fs: !!r.fullscreenElement, cover: !!r.querySelector('.gpx-eag-cover'), hasBar: !!r.querySelector('#gpa-proxy-home'), status: r.querySelector('#gpa-proxy-status').textContent, dot: r.querySelector('.gpx-room').dataset.proxy }));
  check('Launch in about:blank (console not fullscreen): the window opens the proxy right away, no fullscreen needed (the last page)', pw1.url === 'about:blank' && !pw1.fs && !pw1.cover && pw1.hasBar && pw1.status === 'Loaded' && pw1.dot === 'connected' && pop.frames().some((x) => x.url() === S(FX)), JSON.stringify(pw1));
  const mainNow = await R(a.page, (r) => ({ inTab: !!r.querySelector('#gpa-proxy-stage'), gate: r.querySelector('#gpa-proxy-gate').textContent, btn: r.querySelector('#gpa-proxy-launch-blank').textContent, here: !!r.querySelector('#gpa-proxy-launch-here').offsetParent }));
  check('…the console says it’s in the about:blank window (Show window), and can’t also launch here', !mainNow.inTab && /about:blank window/.test(mainNow.gate) && /Show window/.test(mainNow.btn) && !mainNow.here, JSON.stringify(mainNow));
  await pop.frames().find((x) => x.url() === S(FX)).click('#rel');
  await pop.waitForTimeout(1200);
  pw1 = await P((r) => ({ back: !r.querySelector('#gpa-proxy-back').disabled }));
  check('…links inside the page are followed there too (Back enabled)', pw1.back && pop.frames().some((x) => x.url().startsWith(S(FX, '/page2'))), JSON.stringify(pw1));
  await pop.click('#gpa-proxy-back');
  await pop.waitForTimeout(1500);
  check('…and Back works in the window', pop.frames().some((x) => x.url() === S(FX)) && /Loaded/.test(await P((r) => r.querySelector('#gpa-proxy-status').textContent)));
  await pop.screenshot({ path: path.join(OUT, '09-about-blank.png') });
  await pop.close();
  await a.page.waitForTimeout(1500);
  hid = await R(a.page, (r) => ({ back: !!r.querySelector('#gpa-proxy-stage'), stage: (r.querySelector('#gpa-proxy-stage') || {}).style?.display, src: (r.querySelector('#gpa-proxy-frame') || { getAttribute: () => 'gone' }).getAttribute('src'), gate: r.querySelector('#gpa-proxy-gate').textContent }));
  check('Closing the window brings the browser back to the tab, unloaded', hid.back && hid.stage === 'none' && hid.src === 'about:blank' && /about:blank window was closed/.test(hid.gate), JSON.stringify(hid));
  st = await openVia(a.page, `https://${FX}/`);
  check('…and it still works here afterwards', st.status === 'Loaded' && st.src === S(FX), JSON.stringify(st));
  // 10: the owner sees this user's Proxy launches and visited sites on their profile.
  const prof = await (await fetch(`${env.workerUrl}/admin/user?u=px${run}`, { headers: { Authorization: 'Bearer ' + ADMIN } })).json();
  const pl = prof.proxy || { recent: [] };
  const urls = pl.recent.filter((x) => x.ev === 'visit').map((x) => x.url);
  check('Admin: the user’s launches are logged, in the tab and in about:blank', pl.launches >= 10 && pl.recent.some((x) => x.ev === 'launch' && x.mode === 'blank') && pl.recent.some((x) => x.ev === 'launch' && x.mode === 'here'), JSON.stringify({ launches: pl.launches }));
  check('…and the sites visited, without query strings', [`https://${FX}/`, `https://${FX}/page2`, `https://${DOCS}/welcome`].every((x) => urls.includes(x)) && urls.every((x) => !x.includes('?') && !x.includes(PH)), urls.slice(0, 8).join(' '));
  await tab(a.page, 'admin');
  await a.page.waitForTimeout(500);
  await R(a.page, (r, x) => {
    const f = r.querySelector('#gac-auth-fields');
    const inputs = [...f.querySelectorAll('input')];
    const tok = inputs.find((i) => i.type === 'password') || inputs[0];
    tok.value = x.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
    const urlIn = inputs.find((i) => i !== tok);
    if (urlIn) { urlIn.value = x.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
    r.querySelector('#gac-connect').click();
  }, { token: ADMIN, url: env.workerUrl });
  await a.page.waitForTimeout(2500);
  await R(a.page, (r) => { const t = r.querySelector('.gps-tab[data-asec="users"]'); if (t) t.click(); });
  await waitFor(a.page, (r, u) => !!r.querySelector(`[data-open-user="${u}"]`), 'px' + run, 15000);
  await R(a.page, (r, u) => r.querySelector(`[data-open-user="${u}"]`).click(), 'px' + run);
  await waitFor(a.page, (r) => !!r.querySelector('#gac-insp-proxy'), null, 15000);
  const card = await R(a.page, (r) => { const c2 = r.querySelector('#gac-insp-proxy'); c2.scrollIntoView({ block: 'start' }); return c2.textContent; });
  check('Admin → Users → the user’s profile shows a Proxy activity card with launches and sites', /Proxy activity/.test(card) && /launches/.test(card) && /in an about:blank window/.test(card) && card.includes(`https://${FX}/page2`), card.slice(0, 200));
  const liveLine = await R(a.page, (r) => r.querySelector('#gac-insp-proxy-live').textContent);
  check('…with the live status: using the Proxy now, where, and the site they’re on', /Using the Proxy now/.test(liveLine) && /in the Proxy tab/.test(liveLine) && liveLine.includes(`https://${FX}/`) && !liveLine.includes(PH), liveLine);
  await a.page.waitForTimeout(300);
  await a.page.screenshot({ path: path.join(OUT, '10-admin-proxy-activity.png') });
  await waitFor(a.page, (r, u) => !!r.querySelector(`#gac-proxy-day-list .gac-proxy-user[data-user="${u}"]`), 'px' + run, 15000);
  const dayView = await R(a.page, (r, u) => { const el = r.querySelector(`#gac-proxy-day-list .gac-proxy-user[data-user="${u}"]`); el.open = true; el.scrollIntoView({ block: 'start' }); return { sum: r.querySelector('#gac-proxy-day-sum').textContent, row: el.querySelector('summary').textContent, items: el.querySelectorAll('.gac-timeline li').length }; }, 'px' + run);
  check('Admin → Users → Proxy activity by user: today, this user (live, with counts) and their timeline', /^Today: /.test(dayView.sum) && /using it now/.test(dayView.sum) && /Live on https:\/\/fixture/.test(dayView.row) && /launches/.test(dayView.row) && dayView.items >= 10, JSON.stringify(dayView));
  await a.page.waitForTimeout(300);
  await a.page.screenshot({ path: path.join(OUT, '11-admin-proxy-by-user.png') });
  // Closing the proxy clears the live status.
  await tab(a.page, 'browser');
  await btn(a.page, 'gpa-proxy-close');
  await a.page.waitForTimeout(1500);
  const after = await (await fetch(`${env.workerUrl}/admin/user?u=px${run}`, { headers: { Authorization: 'Bearer ' + ADMIN } })).json();
  check('Closing the proxy clears the live status', after.proxyLive === null, JSON.stringify(after.proxyLive));
  check('No page errors (computer)', a.page._errors.length === 0, a.page._errors.slice(0, 2).join(' | '));

  // 6b: a new visit restores the last page on the SECOND approved site.
  f2 = await computer({ server: PROXY });
  await f2.page.evaluate((d2) => localStorage.setItem('gpa_proxy_last_destination', d2), `https://${DOCS}/welcome`);
  await signIn(f2.page, 'pr' + run);
  await tab(f2.page, 'browser');
  await launchHere(f2.page);
  await waitFor(f2.page, (r) => /Loaded/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  st = await state(f2.page);
  check('Next visit: the last page (on the second approved site) comes back', st.src === S(DOCS, '/welcome'), JSON.stringify(st));

  // 4b: a site that's too slow: the Worker gives up at 12 s → “Website timed out”.
  await openVia(f2.page, `https://${FX}/slow`, /timed out|Loaded|failed/);
  await waitFor(f2.page, (r) => /timed out/.test(r.querySelector('#gpa-proxy-status').textContent), null, 30000);
  st = await state(f2.page);
  check('A site that’s too slow: “Website timed out”', /Website timed out/.test(st.status) && /took too long/.test(st.error), JSON.stringify(st));

  // 7: the Worker down, answering errors, and a website whose CSP forbids framing.
  b = await computer({ server: `http://127.0.0.1:${deadPort}` });
  await signIn(b.page, 'pd' + run);
  await tab(b.page, 'browser');
  await launchHere(b.page);
  await waitFor(b.page, (r) => r.querySelector('#gpa-proxy-error').style.display !== 'none', null, 20000);
  st = await state(b.page);
  check('Worker down: “Can’t reach the proxy Worker”, Load failed, Retry + Open in a new tab', /Can’t reach the proxy Worker/.test(st.error) && /Load failed/.test(st.status) && st.proxy === 'error' && /Retry/.test(st.error) && /Open in a new tab/.test(st.error), JSON.stringify(st));
  await b.page.screenshot({ path: path.join(OUT, '06-worker-down.png') });
  await R(b.page, (r) => { r.querySelector('.gpx-browser .gpx-details').open = true; });
  await b.page.fill(sr('#gpa-proxy-server'), 'not a url');
  await b.page.dispatchEvent(sr('#gpa-proxy-server'), 'change');
  check('Settings: a bad Worker address is refused with a hint', /Use the Worker’s address only/.test(await R(b.page, (r) => r.querySelector('#gpa-proxy-server-hint').textContent)));
  await b.page.fill(sr('#gpa-proxy-server'), PROXY);
  await b.page.dispatchEvent(sr('#gpa-proxy-server'), 'change');
  await waitFor(b.page, (r) => /Connected/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  st = await state(b.page);
  check('…a good address reconnects (connection test, error gone)', st.src === PROXY + '/preview' && !st.error, JSON.stringify(st));
  c = await computer({ server: `http://127.0.0.1:${broken.port}` });
  await signIn(c.page, 'pb' + run);
  await tab(c.page, 'browser');
  await launchHere(c.page);
  await waitFor(c.page, (r) => r.querySelector('#gpa-proxy-error').style.display !== 'none', null, 20000);
  st = await state(c.page);
  check('Worker answering errors: “answered with an error (HTTP 500)” + Retry', /answered with an error \(HTTP 500\)/.test(st.error) && /Proxy error/.test(st.status) && /Retry/.test(st.error), JSON.stringify(st));
  d = await computer({ server: PROXY, pathName: '/strict' });
  await signIn(d.page, 'ps' + run);
  await tab(d.page, 'browser');
  await launchHere(d.page);
  await waitFor(d.page, (r) => /Blocked/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  st = await state(d.page);
  check('A website that forbids framing: “Blocked by this website” + Open in a new tab', /Blocked by this website/.test(st.status) && /security settings/.test(st.error) && /Open in a new tab/.test(st.error) && st.proxy === 'error', JSON.stringify(st));
  const [popup] = await Promise.all([d.ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), R(d.page, (r) => [...r.querySelectorAll('#gpa-proxy-error button')].find((x) => /new tab/.test(x.textContent)).click())]);
  if (popup) await popup.waitForLoadState('domcontentloaded').catch(() => {});
  check('…“Open in a new tab” opens the Worker’s page in a new tab', !!popup && popup.url() === PROXY + '/preview', popup ? popup.url() : 'no popup');
  await d.page.screenshot({ path: path.join(OUT, '07-blocked-by-website.png') });

  // 8: the default is the deployed Worker; old localhost:4141 moves; phone width.
  e = await computer({ server: 'https://localhost:4141', phone: true });
  await signIn(e.page, 'pl' + run);
  await tab(e.page, 'browser');
  await launchHere(e.page);
  await e.page.waitForTimeout(800);
  const def = await R(e.page, (r) => ({ src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), setting: r.querySelector('#gpa-proxy-server').value }));
  check('Default: the deployed Worker (' + DEPLOYED + '/preview); an old saved localhost:4141 moves to it', def.src === DEPLOYED + '/preview' && def.setting === DEPLOYED, JSON.stringify(def));
  const fit = await R(e.page, (r) => { const bar = r.querySelector('.gpx-browser-bar'), p = r.querySelector('.gpa-panel'); return { fits: bar.scrollWidth <= bar.clientWidth + 1, inside: bar.getBoundingClientRect().right <= p.getBoundingClientRect().right + 1, nav: ['back', 'forward', 'reload', 'home'].every((x) => !!r.querySelector('#gpa-proxy-' + x).offsetParent) }; });
  check('Phone width: the bar fits, with Back, Forward, Reload and Home', fit.fits && fit.inside && fit.nav, JSON.stringify(fit));
  for (const [n, p] of [['worker down', b], ['worker error', c], ['strict website', d], ['phone', e], ['restore', f2]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
  await broken.close();
  await pw.stop();
  sites.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
