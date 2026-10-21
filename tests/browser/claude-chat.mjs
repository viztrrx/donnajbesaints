// Admin → Claude in the console, against worker.js in workerd:
//   1  not set up yet: the setup card, the composer disabled
//   2  a chat with a finished reply (pushed commit, files, usage) and a
//      follow-up still working, with the model and effort pickers
//   3  the same at phone width
// The worker has no GitHub token here, so the chat data is served by the
// test (page.route) for steps 2 and 3; the routes themselves are covered by
// tests/claude.test.mjs.
//   node tests/browser/claude-chat.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'claude-chat-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const shot = (page, name) => page.locator('#gpa-root-host').screenshot({ path: path.join(OUT, name) });

async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' }).catch(() => {});
  return { ctx, page };
}
async function ownerClaude(page) {
  await R(page, (root, a) => {
    const n = root.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click();
    const f = root.querySelector('#gac-auth-fields');
    if (f && f.offsetParent) {
      const inputs = [...f.querySelectorAll('input')];
      const tok = inputs.find((i) => i.type === 'password') || inputs[0];
      tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
      const urlIn = inputs.find((i) => i !== tok);
      if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
      root.querySelector('#gac-connect').click();
    }
  }, { token: ADMIN, url: env.workerUrl });
  await page.waitForTimeout(2500);
  // The admin token is enough here; nobody signs in, so move the sign-in
  // screen out of the way for the screenshots.
  await R(page, (root) => { const l = root.querySelector('#gpa-login'); if (l) l.style.display = 'none'; });
  await R(page, (root) => root.querySelector('.gps-tab[data-asec="claude"]').click());
  await page.waitForTimeout(1500);
}

const now = Date.now();
const day = (i) => new Date(now - i * 86400000).toISOString().slice(0, 10);
const usageDay = (i, n) => ({ day: day(i), n, input: n * 9000, output: n * 2100, cacheRead: n * 40000, cacheWrite: n * 3000, cost: n * 0.38, ms: n * 95000, byModel: n ? { 'claude-opus-5-5': { n, input: 0, output: 0, cost: 0 } } : {}, byUser: {} });
const CONV = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: 'Make the music tab’s play button bigger', by: 'ivan', created: now - 600000, updated: now - 20000, model: 'claude-opus-5-5', effort: 'high',
  messages: [
    { id: 'u1aaaaaaaaaaaa', role: 'user', by: 'ivan', text: 'Make the music tab’s play button bigger', ts: now - 600000 },
    { id: 'r1aaaaaaaaaaaa', role: 'assistant', status: 'done', model: 'claude-opus-5-5', effort: 'high', ts: now - 600000, runUrl: 'https://github.com/viztrrx/work-service/actions/runs/1',
      text: 'I made the play button in **My music** bigger.\n\n- `.gpa-mu-play` is now 44px (was 32px)\n- The icon scales with it\n\nCheck it on your phone too; the now-playing bar uses the same button.',
      commit: '3f2a9c1d0e8b7a6f5e4d3c2b1a0f9e8d7c6b5a49', files: ['script.js'], usage: { input: 9000, output: 2100, cacheRead: 40000, cacheWrite: 3000, cost: 0.38, ms: 95000, turns: 12 } },
    { id: 'u2aaaaaaaaaaaa', role: 'user', by: 'ivan', text: 'Now make it the accent color', ts: now - 60000 },
    { id: 'r2aaaaaaaaaaaa', role: 'assistant', status: 'running', model: 'claude-sonnet-5-5', effort: 'medium', ts: now - 60000, started: now - 45000, runUrl: 'https://github.com/viztrrx/work-service/actions/runs/2' }
  ]
};
const LIST = {
  ok: true, me: 'ivan', isOwner: true, ready: { github: true, callback: true }, repo: 'viztrrx/work-service',
  models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Most capable for code. Uses your plan’s limits fastest.' }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'Fast and strong. The everyday pick.' }, { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'Quickest and lightest on your limits, for small changes.' }],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaults: { model: 'claude-opus-5-5', effort: 'high' },
  convs: [{ id: CONV.id, title: CONV.title, by: 'ivan', updated: now - 20000, status: 'running', count: 4 }, { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'Explain how the admin console is organized', by: 'ivan', updated: now - 86400000, status: 'done', count: 2 }, { id: 'cccccccccccccccccccccccc', title: 'Rename the Proxy tab', by: 'ally', updated: now - 2 * 86400000, status: 'error', count: 2 }],
  usage: { days: [usageDay(0, 3), usageDay(1, 5), usageDay(2, 1), usageDay(3, 0), usageDay(4, 4), usageDay(5, 2), usageDay(6, 6)], limit: null, sentToday: 3 }
};

// 1  Not set up: the real worker, no GITHUB_TOKEN.
{
  const { ctx, page } = await open({ width: 1200, height: 900 });
  await ownerClaude(page);
  const s = await R(page, (r) => ({ setup: /Set up Claude/.test(r.querySelector('#gac-body-claude').textContent), disabled: r.querySelector('#gcl-text').disabled, tab: !r.querySelector('.gps-tab[data-asec="claude"]').hidden }));
  check('owner sees the Claude tab', s.tab);
  check('not set up: setup card shows and the composer is disabled', s.setup && s.disabled);
  await shot(page, '1-setup.png');
  check('no page errors (setup)', !page._errors.length, page._errors.join(' | '));
  await ctx.close();
}

// 2-3  A chat in progress, desktop and phone.
for (const [name, viewport] of [['2-chat.png', { width: 1200, height: 900 }], ['3-chat-phone.png', { width: 390, height: 844 }]]) {
  const { ctx, page } = await open(viewport);
  await ctx.route('**/admin/claude/convs', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(LIST) }));
  await ctx.route('**/admin/claude/conv?**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, conv: CONV }) }));
  await ownerClaude(page);
  await R(page, (r) => r.querySelector('[data-gcl-open]').click());
  await page.waitForTimeout(1200);
  const s = await R(page, (r) => ({
    replyHtml: r.querySelector('.gcl-reply') ? r.querySelector('.gcl-reply').innerHTML : '',
    working: !!r.querySelector('.gcl-spin'),
    pushed: /Pushed to main/.test(r.querySelector('.gcl-tools').textContent),
    models: [...r.querySelectorAll('#gcl-model option')].map((o) => o.textContent),
    disabled: r.querySelector('#gcl-text').disabled,
    wide: r.querySelector('.gcl').scrollWidth <= r.querySelector('.gcl').clientWidth + 1
  }));
  check(`${name}: markdown reply renders (bold, list, code)`, /<b>My music<\/b>/.test(s.replyHtml) && /<li>/.test(s.replyHtml) && /<code>/.test(s.replyHtml));
  check(`${name}: finished reply shows the pushed commit`, s.pushed);
  check(`${name}: the follow-up shows as working and the composer waits`, s.working && s.disabled);
  check(`${name}: model picker lists the models`, s.models.join(',') === 'Opus 5.5,Sonnet 5.5,Haiku 5.5');
  check(`${name}: no sideways overflow`, s.wide);
  await shot(page, name);
  check(`no page errors (${name})`, !page._errors.length, page._errors.join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots in ${OUT}/`);
process.exit(failed.length ? 1 : 0);
