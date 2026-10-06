// Screenshots of the existing panes, for before/after visual comparison.
//   node tests/browser/screenshots.mjs <outDir> [tab ...]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, openConsole, openTab, refuseExternal, HOST_PAGE } from './harness.mjs';

const out = process.argv[2] || 'shots';
const tabs = process.argv.slice(3).length ? process.argv.slice(3) : ['browser', 'games', 'scan', 'theme'];
fs.mkdirSync(out, { recursive: true });
const { port, close } = await serve((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(HOST_PAGE); });
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await refuseExternal(context);
const page = await openConsole(context, `http://127.0.0.1:${port}/`);
// Freeze the moving parts so before/after pixels are comparable.
await page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' });
const sidebar = (open) => page.evaluate((o) => {
  const r = document.getElementById('gpa-root-host').shadowRoot;
  const p = r.querySelector('.gpa-panel');
  if (p.classList.contains('gpa-sidebar-hidden') === o) r.querySelector('#gpa-sidebar-toggle').click();
}, open);
await sidebar(true);
await page.waitForTimeout(400);
const host = page.locator('#gpa-root-host');
await host.screenshot({ path: path.join(out, 'nav.png') });
await sidebar(false);
for (const t of tabs) {
  await openTab(page, t);
  await page.evaluate(() => { const r = document.getElementById('gpa-root-host').shadowRoot; r.querySelectorAll('.gvh-t time, .gpx-status-t').forEach((e) => { e.textContent = '·'; }); });
  await host.screenshot({ path: path.join(out, `${t}.png`) });
}
console.log('errors:', JSON.stringify(page._errors || []));
await browser.close();
await close();
