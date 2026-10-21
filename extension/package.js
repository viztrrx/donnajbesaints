// Server-side packaging of the existing Saints Service script as an installable
// Chrome Manifest V3 extension. The executable script is placed inside the ZIP
// at download time; the installed extension never loads remote JavaScript.
const manifest = {
  manifest_version: 3,
  name: 'Saints Service',
  version: '1.0.0',
  description: 'Open the Saints Service interface on the current page when you choose.',
  permissions: ['activeTab', 'scripting'],
  action: { default_popup: 'popup.html', default_title: 'Saints Service' }
};
const popupHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saints Service</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;width:310px;padding:18px;background:#101318;color:#edf2f7;font:14px/1.5 system-ui,-apple-system,sans-serif}
header{display:flex;gap:11px;align-items:center;margin-bottom:14px}.logo{display:grid;place-items:center;width:43px;height:43px;background:linear-gradient(145deg,#0f766e,#164e63);border:1px solid #36c8b5;border-radius:12px;font-weight:800;font-size:19px}
h1{margin:0;font-size:17px;letter-spacing:-.02em}p{margin:4px 0 15px;color:#b5c3ce;font-size:12px}
button{width:100%;border:1px solid #46cdbc;border-radius:11px;background:#128779;color:#fff;font:inherit;font-weight:650;padding:11px;cursor:pointer}
button:hover{background:#159b8b}button:disabled{opacity:.65;cursor:wait}#status{min-height:18px;margin:12px 0 0;font-size:12px;color:#b5c3ce}#status.error{color:#ff9d9d}
small{display:block;margin-top:14px;color:#788995;line-height:1.5}
</style></head><body>
<header><div class="logo" aria-hidden="true">S</div><div><h1>Saints Service</h1><p style="margin:2px 0 0">Your interface, anywhere you browse</p></div></header>
<p>Open or hide the floating Saints Service panel on the active page.</p>
<button id="toggle" type="button">Open / hide Saints Service</button>
<p id="status" role="status" aria-live="polite"></p>
<small>Chrome protects its own pages, the Web Store, and some restricted sites. The extension cannot run there. This extension never opens automatically.</small>
<script src="popup.js"></script></body></html>`;
const popupJs = `'use strict';
const button = document.getElementById('toggle');
const status = document.getElementById('status');
button.addEventListener('click', async () => {
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Opening the interface…';
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !Number.isInteger(tab.id) || !/^https?:\\/\\//i.test(tab.url || '')) {
      throw new Error('Switch to an ordinary http:// or https:// website first.');
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: ['script.js'],
      world: 'ISOLATED'
    });
    status.textContent = 'Done. Use the floating panel on the page.';
  } catch (error) {
    status.classList.add('error');
    status.textContent = error && error.message ? error.message : 'Chrome did not allow the extension on this page.';
  } finally {
    button.disabled = false;
  }
});`;
const installText = `Saints Service — Chrome Extension

Install:
1. Download the ZIP from Saints Service > Admin Command Center > Extension & Access,
   or from Settings > Account if the owner explicitly allowed your username.
2. Extract the ZIP to a folder you will keep.
3. On desktop Chrome, open chrome://extensions and turn on Developer mode.
4. Select "Load unpacked" and choose that extracted folder.
5. Pin Saints Service in the extensions toolbar.
6. Open an ordinary website, click the extension icon and choose "Open / hide Saints Service".
7. Sign in to Saints Service using your own existing account.

No site access is requested until you click the extension. Chrome's own pages,
the Chrome Web Store and certain restricted websites cannot be injected.
Your existing settings and session may be specific to each website origin.
To update, download a new ZIP, extract to the same folder (or replace it),
then click Reload under chrome://extensions.

The code is bundled with the ZIP at download time, not downloaded and executed
from a remote address by the installed extension. The extension does not grant
admin permissions; Worker account permissions still apply. Download access
controls cannot prevent somebody from redistributing a ZIP already obtained.
`;

// Simple ZIP writer (stored entries, no dependencies or unsupported Node APIs).
// All CRCs and directory offsets follow PKZIP APPNOTE. Entries are UTF-8.
const encoder = new TextEncoder();
let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, i) => {
      let n = i;
      for (let j = 0; j < 8; j++) n = n & 1 ? (0xedb88320 ^ (n >>> 1)) : n >>> 1;
      return n >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function put16(view, offset, value) { view.setUint16(offset, value, true); }
function put32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function zip(files) {
  const localParts = [], centralParts = [];
  let offset = 0, centralSize = 0;
  for (const [filename, text] of files) {
    const name = encoder.encode(filename), body = encoder.encode(text);
    const sum = crc32(body), utf8Flag = 0x0800;
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    put32(l, 0, 0x04034b50); put16(l, 4, 20); put16(l, 6, utf8Flag);
    put16(l, 8, 0); put16(l, 10, 0); put16(l, 12, 0);
    put32(l, 14, sum); put32(l, 18, body.length); put32(l, 22, body.length);
    put16(l, 26, name.length); put16(l, 28, 0); local.set(name, 30);
    const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
    put32(c, 0, 0x02014b50); put16(c, 4, 20); put16(c, 6, 20);
    put16(c, 8, utf8Flag); put16(c, 10, 0); put16(c, 12, 0); put16(c, 14, 0);
    put32(c, 16, sum); put32(c, 20, body.length); put32(c, 24, body.length);
    put16(c, 28, name.length); put16(c, 30, 0); put16(c, 32, 0);
    put16(c, 34, 0); put16(c, 36, 0); put32(c, 38, 0);
    put32(c, 42, offset); central.set(name, 46);
    localParts.push(local, body); centralParts.push(central);
    offset += local.length + body.length;
    centralSize += central.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  put32(e, 0, 0x06054b50); put16(e, 4, 0); put16(e, 6, 0);
  put16(e, 8, files.length); put16(e, 10, files.length);
  put32(e, 12, centralSize); put32(e, 16, offset); put16(e, 20, 0);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
export function buildSaintsExtensionZip(script) {
  if (typeof script !== 'string' || script.length < 10000 || !script.includes('gpa-root-host')) {
    throw new Error('Invalid Saints Service script');
  }
  // A packaged extension cannot eval remote JS: the "Reload" action must not
  // bypass MV3's prohibition. Other features continue using the local script.
  const bundled = script.replace(
    'async function reloadInterface(btn) {',
    "async function reloadInterface(btn) {\n    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {\n      showToast('Update this Chrome extension by downloading its latest ZIP from Settings, then reload it in chrome://extensions.');\n      return;\n    }"
  );
  return zip([
    ['manifest.json', JSON.stringify(manifest, null, 2) + '\n'],
    ['popup.html', popupHtml],
    ['popup.js', popupJs],
    ['script.js', bundled],
    ['README.txt', installText]
  ]);
}
