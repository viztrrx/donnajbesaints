// Computed-style + layout snapshot of every element in the existing panes,
// header and nav: a pixel-free way to prove a change left them untouched.
//   node tests/browser/style-snapshot.mjs out.json
import fs from 'node:fs';
import { serve, launch, openConsole, openTab, refuseExternal, HOST_PAGE } from './harness.mjs';

const PROPS = ['display', 'position', 'color', 'background-color', 'background-image', 'font-family', 'font-size', 'font-weight', 'line-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom', 'border-top-width', 'border-top-color',
  'border-radius', 'box-shadow', 'opacity', 'transform', 'gap', 'width', 'height'];
const TABS = ['welcome', 'scan', 'ask', 'chat', 'music', 'browser', 'games', 'study', 'notes', 'humanize', 'grammar', 'saved', 'theme'];
const { port, close } = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE); });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await refuseExternal(ctx);
const page = await openConsole(ctx, `http://127.0.0.1:${port}/`);
await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
const out = {};
for (const t of TABS) {
  await openTab(page, t);
  out[t] = await page.evaluate(([props, t]) => {
    const r = document.getElementById('gpa-root-host').shadowRoot;
    const pane = r.querySelector(`.gpa-pane[data-pane="${t}"]`);
    const rows = [];
    const volatile = (el) => el.closest('.gvh, .gpx-status, time, .gpa-welcome-clock, #gpa-welcome-time, .gpa-chat-log');
    [r.querySelector('.gpa-header'), ...pane.querySelectorAll('*'), pane].forEach((el, i) => {
      if (!el || volatile(el)) return;
      const cs = getComputedStyle(el), b = el.getBoundingClientRect();
      rows.push(el.tagName + (el.id ? '#' + el.id : '') + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim().replace(/\s+/g, '.')
        + ' | ' + props.map((p) => cs.getPropertyValue(p)).join(' ; ') + ' | ' + [b.x, b.y, b.width, b.height].map((v) => Math.round(v)).join(','));
    });
    return rows;
  }, [PROPS, t]);
}
fs.writeFileSync(process.argv[2] || 'styles.json', JSON.stringify(out, null, 1));
await browser.close();
await close();
console.log('elements:', Object.values(out).reduce((a, b) => a + b.length, 0));
