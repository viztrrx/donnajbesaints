// My music: renaming songs (name, artist, file name) and the owner's upload
// with Admin connected, on an iPhone against worker.js in workerd:
//   1  the owner, signed in AND with Admin connected (admin token saved),
//      uploads a song: it works (it used to say "Sign in to keep your own
//      music.")
//   2  after one upload the rename form opens, filled in from the file name
//   3  saving changes the song's name, artist and file name; Download uses it
//   4  anyone signed in (not staff) can upload and rename their own songs
//   node tests/browser/my-music-edit.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'my-music-edit-out';
fs.mkdirSync(OUT, { recursive: true });
const { devices } = createRequire(path.join(ROOT, 'package.json'))('playwright');
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const W = (page, fn, arg, ms = 20000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const SONG = path.join(ROOT, 'tests/browser/fixtures/music/Nova - Midnight Drive.mp3');

async function phone(user) {
  const ctx = await browser.newContext({ ...(devices['iPhone 15'] || devices['iPhone 14']) });
  await ctx.addInitScript((u) => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ }
  }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(env.workerUrl + '/console/');
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 30000 });
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(3000);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return { ctx, page };
}
const openMine = async (page) => {
  await R(page, (r) => r.querySelector('.gpa-dropdown-item[data-tab="music"]').click());
  await page.waitForTimeout(500);
  await R(page, (r) => r.querySelector('.gpx-src[data-src="mine"]').click());
  await page.waitForTimeout(1200);
};
const rowsOf = (page) => R(page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track')].map((li) => ({
  title: li.querySelector('.gpa-track-title').textContent, meta: li.querySelector('.gpa-track-meta').textContent,
  dl: (li.querySelector('.gpa-track-dl') || {}).href || '', edit: !!li.querySelector('.gpa-track-editbtn') })));

try {
  await admin('/admin/config', { allowlist: { on: false } });
  // 1: the owner, signed in, with Admin connected (the admin token is saved
  // on the device and sent with music requests).
  const own = await phone('ivan');
  await R(own.page, (r, a) => {
    const n = r.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click();
    const f = r.querySelector('#gac-auth-fields');
    const inputs = [...f.querySelectorAll('input')];
    const tok = inputs.find((i) => i.type === 'password') || inputs[0];
    tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
    const urlIn = inputs.find((i) => i !== tok);
    if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
    r.querySelector('#gac-connect').click();
  }, { token: ADMIN, url: env.workerUrl });
  await own.page.waitForTimeout(2500);
  const sent = [];
  own.page.on('request', (rq) => { if (rq.url().includes('/music/mine/upload')) sent.push(rq.headers()); });
  await openMine(own.page);
  await own.page.setInputFiles(sr('#gpa-mine-file'), SONG);
  const added = await W(own.page, (r) => /Added 1 song/.test(r.querySelector('#gpa-mine-status').textContent), null, 20000);
  const status = await R(own.page, (r) => r.querySelector('#gpa-mine-status').textContent);
  check('The owner’s upload goes out with the admin token (Admin connected)', sent.length === 1 && /^Bearer /.test(sent[0].authorization || ''), JSON.stringify(sent.map((h) => ({ admin: !!h.authorization, session: !!h['x-gpa-session'], ownerCode: !!h['x-gpa-owner'] }))));
  check('Owner’s upload works (no “Sign in to keep your own music”)', added && !/Sign in/.test(status), status);
  // 2: the rename form opens for the new song, filled in from the file name.
  const form = await R(own.page, (r) => { const f = r.querySelector('#gpa-mine-list .gpa-track-edit'); if (!f) return null; const v = (n) => f.querySelector(`input[name="${n}"]`).value; return { title: v('title'), artist: v('artist'), file: v('file'), note: f.querySelector('.row span').textContent }; });
  check('After one upload, the rename form opens filled in from the file name', form && form.title === 'Midnight Drive' && form.artist === 'Nova' && form.file === 'Nova - Midnight Drive.mp3' && /Check the song name/.test(form.note), JSON.stringify(form));
  await own.page.waitForTimeout(400);
  await shot(own.page, '01-rename-form-after-upload.png');
  // 3: save new names.
  await own.page.fill(sr('#gpa-mine-list .gpa-track-edit input[name="title"]'), 'Midnight Drive (Live)');
  await own.page.fill(sr('#gpa-mine-list .gpa-track-edit input[name="artist"]'), 'Nova & Friends');
  await own.page.fill(sr('#gpa-mine-list .gpa-track-edit input[name="file"]'), 'midnight drive live');
  await own.page.click(sr('#gpa-mine-list .gpa-track-edit button[type="submit"]'));
  const saved = await W(own.page, (r) => { const t = r.querySelector('#gpa-mine-list .gpa-track-title'); return t && t.textContent === 'Midnight Drive (Live)' && !r.querySelector('#gpa-mine-list .gpa-track-edit'); }, null, 10000);
  let rows = await rowsOf(own.page);
  check('Saving changes the song’s name and artist in the list', saved && rows[0].meta.startsWith('Nova & Friends'), JSON.stringify(rows));
  check('…and Download saves it as “midnight drive live.mp3”', /dl=midnight%20drive%20live\.mp3/.test(rows[0].dl), rows[0].dl);
  const dl = await own.page.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, cd: r.headers.get('content-disposition'), type: r.headers.get('content-type') }; }, rows[0].dl);
  check('…the Worker sends the file with that name', dl.status === 200 && /filename="midnight drive live\.mp3"/.test(dl.cd || ''), JSON.stringify(dl));
  await own.page.waitForTimeout(300);
  await shot(own.page, '02-renamed.png');
  // A blank name is refused on the page.
  await R(own.page, (r) => r.querySelector('#gpa-mine-list .gpa-track-editbtn').click());
  await own.page.fill(sr('#gpa-mine-list .gpa-track-edit input[name="title"]'), '   ');
  await own.page.click(sr('#gpa-mine-list .gpa-track-edit button[type="submit"]'));
  const err = await R(own.page, (r) => r.querySelector('#gpa-mine-list .gpa-track-edit .row span').textContent);
  check('A song can’t be saved without a name', /needs a name/.test(err), err);
  await R(own.page, (r) => [...r.querySelectorAll('#gpa-mine-list .gpa-track-edit button')].find((b) => b.textContent === 'Cancel').click());
  // The name follows in the player.
  await R(own.page, (r) => r.querySelector('#gpa-mine-list .gpa-track-main').click());
  const np = await W(own.page, (r) => (r.querySelector('#gpa-np-title') || {}).textContent === 'Midnight Drive (Live)', null, 8000);
  check('Playing it shows the new name', np);

  // 4: a regular person (no staff role).
  const kj = await phone('kj' + run);
  await openMine(kj.page);
  await kj.page.setInputFiles(sr('#gpa-mine-file'), path.join(ROOT, 'tests/browser/fixtures/music/Quiet Kid - Late Bus Home.mp3'));
  await W(kj.page, (r) => !!r.querySelector('#gpa-mine-list .gpa-track-edit'), null, 20000);
  await kj.page.fill(sr('#gpa-mine-list .gpa-track-edit input[name="artist"]'), 'Quiet Kid feat. KJ');
  await kj.page.click(sr('#gpa-mine-list .gpa-track-edit button[type="submit"]'));
  await kj.page.waitForTimeout(1500);
  rows = await rowsOf(kj.page);
  check('A regular user uploads and renames their own song', rows.length === 1 && rows[0].title === 'Late Bus Home' && rows[0].meta.startsWith('Quiet Kid feat. KJ') && rows[0].edit, JSON.stringify(rows));
  await kj.page.waitForTimeout(300);
  await shot(kj.page, '03-regular-user.png');

  for (const [n, p] of [['owner', own], ['kj', kj]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
  for (const p of [own, kj]) await p.ctx.close();
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
