// The AI usage meter at every panel size preset (Settings → Panel → Compact,
// Normal, Large, XL, Full page), with the console injected into an ordinary
// page the way the bookmarklet does it, against worker.js in workerd. At each
// size: the meter is on screen under the header, inside the panel, nothing in
// it is cut off, and it keeps its numbers. A screenshot per size.
//   node tests/browser/usage-meter-sizes.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'usage-meter-sizes-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN } });
const hostSite = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE); });
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const ask = (user) => fetch(env.workerUrl + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GPA-User': user, 'X-GPA-Key': 'sk-test-0123456789abcdefghij' }, body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] }) });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const USER = 'nia' + Date.now().toString(36).slice(-4);
const sr = (sel) => `#gpa-root-host >> ${sel}`;

try {
  await admin('/admin/user/action', { u: USER, action: 'quota', quotaDaily: 20 });
  for (let i = 0; i < 16; i++) await ask(USER);   // 16 of 20 (80%): amber

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${hostSite.port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8'));
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await page.fill(sr('#gpa-login-user'), USER);
  await page.fill(sr('#gpa-login-pin'), '135790');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  check('Not the home-screen app: the size presets are available here (Compact, Normal, Large, XL, Centered, Full page)', await R(page, (r) => !r.querySelector('.gpa-panel').classList.contains('gpa-app') && r.querySelectorAll('.size-btn').length === 6 && !!r.querySelector('.size-btn[data-size="center"]')));
  const ready = await page.waitForFunction(() => { const el = document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-usage'); return el && !el.hidden && el.querySelector('#gpa-usage-left').textContent === '4 left'; }, null, { timeout: 25000 }).then(() => true, () => false);
  check('Meter shows on the injected console: 4 left of 20', ready);

  for (const size of ['compact', 'normal', 'large', 'xl', 'full']) {
    await R(page, (r, s) => r.querySelector(`.size-btn[data-size="${s}"]`).click(), size);
    await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="welcome"]').click());
    await page.waitForTimeout(700);
    const g = await R(page, (r) => {
      const panel = r.querySelector('.gpa-panel'), header = r.querySelector('.gpa-header'), el = r.querySelector('#gpa-usage');
      const pb = panel.getBoundingClientRect(), hb = header.getBoundingClientRect(), mb = el.getBoundingClientRect();
      const parts = ['#gpa-usage-label', '#gpa-usage-bar', '#gpa-usage-left', '#gpa-usage-note'].map((s) => el.querySelector(s));
      const inside = (b) => b.left >= pb.left - 0.5 && b.right <= pb.right + 0.5 && b.top >= pb.top - 0.5 && b.bottom <= pb.bottom + 0.5;
      const top = r.elementFromPoint ? r.elementFromPoint(mb.left + mb.width / 2, mb.top + mb.height / 2) : null;
      return {
        panelW: Math.round(pb.width), panelH: Math.round(pb.height),
        shown: !el.hidden && !!el.offsetParent && mb.height > 0,
        underHeader: Math.abs(mb.top - hb.bottom) < 2,
        inside: inside(mb) && parts.every((p) => inside(p.getBoundingClientRect())),
        clipped: parts.filter((p) => p.scrollWidth > p.clientWidth + 1 || p.getBoundingClientRect().width < 1).map((p) => p.id),
        rowFits: el.querySelector('.gpa-usage-row').scrollWidth <= el.querySelector('.gpa-usage-row').clientWidth + 1,
        barW: Math.round(parts[1].getBoundingClientRect().width),
        onTop: !!top && el.contains(top),
        left: parts[2].textContent, cls: el.className,
        // The header title stays on one line (shortened with … if needed).
        titleH: Math.round(r.querySelector('.gpa-title').getBoundingClientRect().height),
        titleFull: r.querySelector('.gpa-title').scrollWidth <= r.querySelector('.gpa-title').clientWidth + 1,
        headerH: Math.round(hb.height)
      };
    });
    check(`${size} (${g.panelW}×${g.panelH}): meter on screen right under the header`, g.shown && g.underHeader && g.onTop, JSON.stringify(g));
    check(`${size}: fits inside the panel, nothing cut off, bar ${g.barW}px wide`, g.inside && g.rowFits && !g.clipped.length && g.barW >= 40, JSON.stringify(g));
    check(`${size}: header title on one line, full name showing (header ${g.headerH}px tall)`, g.titleH <= 22 && g.headerH <= 52 && g.titleFull, JSON.stringify({ titleH: g.titleH, headerH: g.headerH, fullName: g.titleFull }));
    check(`${size}: still says 4 left (amber)`, g.left === '4 left' && /is-low/.test(g.cls), g.left + ' ' + g.cls);
    await page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, `size-${size}.png`) });
  }
  // Collapsed to the title bar: the meter hides with the rest of the panel and comes back.
  await R(page, (r) => r.querySelector('.size-btn[data-size="normal"]').click());
  await R(page, (r) => r.querySelector('#gpa-min').click());
  await page.waitForTimeout(700);
  check('Collapsed: the meter hides with the panel body', await R(page, (r) => !r.querySelector('#gpa-usage').offsetParent || r.querySelector('#gpa-usage').getBoundingClientRect().height === 0));
  await R(page, (r) => r.querySelector('#gpa-min').click());
  await page.waitForTimeout(700);
  check('Expanded again: the meter is back', await R(page, (r) => !!r.querySelector('#gpa-usage').offsetParent && r.querySelector('#gpa-usage').getBoundingClientRect().height > 0));
  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  await env.close();
  await hostSite.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
