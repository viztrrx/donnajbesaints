// Focused Manifest V3 package and download authorization smoke tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSaintsExtensionZip } from '../extension/package.js';
import worker from '../worker.js';

const data = '/* Saints Service */\n(function () { /* gpa-root-host */ async function reloadInterface(btn) {} })();\n' + ' '.repeat(10500);
const bearer = 'example-owner-token-with-enough-length';
const makeKV = () => {
  const map = new Map();
  return {
    map,
    get: async (key, type) => type === 'json' ? JSON.parse(map.get(key) ?? 'null') : map.get(key) ?? null,
    put: async (key, value) => { map.set(key, String(value)); },
    list: async () => ({ keys: [], list_complete: true }),
    delete: async (key) => { map.delete(key); }
  };
};
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = new Map();
  let pos = 0;
  while (pos + 30 <= bytes.length && view.getUint32(pos, true) === 0x04034b50) {
    const size = view.getUint32(pos + 18, true);
    const length = view.getUint16(pos + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + length));
    const start = pos + 30 + length;
    found.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    pos = start + size;
  }
  assert.equal(view.getUint32(pos, true), 0x02014b50);
  return found;
}
test('generated Chrome extension uses minimal click-to-activate MV3 permissions', async () => {
  const zip = buildSaintsExtensionZip(data);
  const entries = zipEntries(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual([...entries.keys()], ['manifest.json', 'popup.html', 'popup.js', 'script.js', 'README.txt']);
  const manifest = JSON.parse(entries.get('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting']);
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.ok(!('host_permissions' in manifest));
  assert.match(entries.get('popup.js'), /chrome\.scripting\.executeScript/);
  assert.match(entries.get('script.js'), /Update this Chrome extension by downloading/);
});

test('extension routes reject anonymous and regular sessions without the allowlist', async () => {
  const env = { ADMIN_TOKEN: bearer, OWNER: 'ivan', TELEMETRY: makeKV() };
  const handle = (path, options) => worker.fetch(new Request('https://example.test' + path, options), env, { waitUntil() {} });
  const anon = await handle('/extension/access');
  assert.equal(anon.status, 401);
  const download = await handle('/extension/download');
  assert.equal(download.status, 401);
});

test('verified owner can add or revoke usernames and sees allowlist', async () => {
  const env = { ADMIN_TOKEN: bearer, OWNER: 'ivan', TELEMETRY: makeKV() };
  const call = (path, options) => worker.fetch(new Request('https://example.test' + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' }
  }), env, { waitUntil() {} });
  const allow = await call('/extension/access', {
    method: 'POST', body: JSON.stringify({ user: '  Adrian  ', allow: true })
  });
  assert.equal(allow.status, 200);
  assert.deepEqual((await allow.json()).users, ['adrian']);
  const read = await call('/extension/access');
  assert.deepEqual((await read.json()).users, ['adrian']);
  const revoke = await call('/extension/access', {
    method: 'POST', body: JSON.stringify({ user: 'ADRIAN', allow: false })
  });
  assert.deepEqual((await revoke.json()).users, []);
});
