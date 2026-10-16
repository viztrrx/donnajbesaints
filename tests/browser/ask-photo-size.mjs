// Ask AI with a full-size phone photo: the console shrinks it before sending,
// so one question can't carry tens of MB to the Worker (which once ran out of
// memory and failed everyone's chat polls with it). A 4032×3024 photo with
// lots of detail is made in the browser, attached, and the request that
// leaves the console is measured.
//   node tests/browser/ask-photo-size.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'ask-photo-size-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef', CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const MB = (n) => Math.round(n / 1048576 * 10) / 10 + ' MB';

try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  // The console calls the live Worker's AI route, which this sandbox can't
  // reach: answer it here and keep what was sent.
  const sent = [];
  await ctx.route('https://donnajbe.viztrrx.workers.dev/v1/chat/completions', async (route) => {
    sent.push(route.request().postData() || '');
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: 'That looks like a test photo.' } }] }) });
  });
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.fill(sr('#gpa-login-user'), 'photo' + Date.now().toString(36).slice(-4));
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="ask"]').click());

  // A 4032×3024 photo full of detail (noise compresses badly, like a real
  // busy photo), as a JPEG file, put on the attach input.
  const original = await R(page, async (r) => {
    const c = document.createElement('canvas'); c.width = 4032; c.height = 3024;
    const g = c.getContext('2d'); const img = g.createImageData(4032, 3024);
    let s = 7; for (let i = 0; i < img.data.length; i += 4) { s = (s * 1103515245 + 12345) >>> 0; img.data[i] = s & 255; img.data[i + 1] = (s >> 8) & 255; img.data[i + 2] = (i / 4) % 4032 / 16; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'IMG_0001.jpg', { type: 'image/jpeg' }));
    const input = r.querySelector('#gpa-ask-file'); input.files = dt.files; input.dispatchEvent(new Event('change'));
    return blob.size;
  });
  await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelectorAll('#gpa-ask-images img').length === 1, null, { timeout: 15000 });
  await page.fill(sr('#gpa-ask-input'), 'what is in this photo?');
  await page.click(sr('#gpa-ask-btn'));
  const answered = await page.waitForFunction(() => /That looks like a test photo/.test(document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-pane[data-pane="ask"]').textContent), null, { timeout: 20000 }).then(() => true, () => false);
  check('Ask AI with a full-size phone photo works', answered);
  const body = sent.find((b) => b.includes('image_url')) || '';
  const dataUrl = (JSON.parse(body || '{}').messages || []).flatMap((m) => Array.isArray(m.content) ? m.content : []).find((p) => p.type === 'image_url')?.image_url.url || '';
  const dims = dataUrl ? await page.evaluate((u) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = u; }), dataUrl) : null;
  console.log(`  original photo ${MB(original)} (${MB(original * 4 / 3)} as sent before) → request ${MB(body.length)}, image ${dims && dims.join('×')}`);
  check('The photo was a realistic full-size one (over 5 MB)', original > 5 * 1048576, MB(original));
  check('The request that left the console is under 1.5 MB', body.length > 0 && body.length < 1.5 * 1048576, MB(body.length));
  check('…with the photo shrunk to 1600 px on the long side, same shape', dims && dims[0] === 1600 && dims[1] === 1200, JSON.stringify(dims));
  check('…as a JPEG', dataUrl.startsWith('data:image/jpeg;base64,'));
  check('No page errors', page._errors.length === 0, page._errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: path.join(OUT, '01-photo-question.png') });
  await ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
