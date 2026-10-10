import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, ROOT } from './harness.mjs';
const host = await serve((req, res) => {
  if (req.url === '/performance.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(ROOT, 'eaglercraft/loader/performance.js'))); }
  else res.end('<script src="/performance.js"></script>');
});
const browser = await launch();
try {
 const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${host.port}`);
 const r = await page.evaluate(async () => {
  const encode = async text => {
   const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
   return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
  };
  const decode = async key => new Response(new Blob([Uint8Array.from(atob(localStorage.getItem(key)), c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  await eaglerApplyPerformancePreset('fresh'); const fresh = await decode('fresh.g');
  const original = await encode('renderDistance:12\nmaxFps:260\nshaders:true\nfxaa:1\nresourcePacks:["my-pack"]\nkey_key.forward:17\nlang:es_ES\nsoundCategory_music:0.2\ncustom:value:with:colons\n');
  localStorage.setItem('existing.g', original);
  await eaglerApplyPerformancePreset('existing'); const merged = await decode('existing.g');
  const backup = localStorage.getItem('existing.agent-console.performance-original');
  localStorage.setItem('existing.g', await encode(merged.replace('renderDistance:2', 'renderDistance:8')));
  await eaglerApplyPerformancePreset('existing'); const repeated = await decode('existing.g');
  localStorage.setItem('bad.g', 'not valid gzip');
  const bad = await eaglerApplyPerformancePreset('bad').then(() => false, () => true);
  const originalCompression = window.CompressionStream;
  window.CompressionStream = undefined;
  const unsupported = await eaglerApplyPerformancePreset('unsupported').then(() => false, () => true);
  window.CompressionStream = originalCompression;
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
  const quota = await eaglerApplyPerformancePreset('fresh').then(() => false, () => true);
  Storage.prototype.setItem = set;
  return { fresh, merged, repeated, backup, original, bad, badValue: localStorage.getItem('bad.g'), unsupported, unsupportedValue:localStorage.getItem('unsupported.g'), quota, freshAfter: await decode('fresh.g') };
 });
 assert.match(r.fresh, /renderDistance:2\n/); assert.match(r.fresh, /maxFps:60\n/); assert.match(r.fresh, /fxaa:2\n/); assert.match(r.fresh, /shaders:false\n/);
 for (const line of ['resourcePacks:["my-pack"]', 'key_key.forward:17', 'lang:es_ES', 'soundCategory_music:0.2', 'custom:value:with:colons']) assert.ok(r.merged.includes(line));
 assert.equal(r.backup,r.original); assert.match(r.repeated,/renderDistance:2\n/);assert.equal(r.repeated.split('renderDistance:').length,2);
 assert.equal(r.bad,true);assert.equal(r.badValue,'not valid gzip');assert.equal(r.unsupported,true);assert.equal(r.unsupportedValue,null);assert.equal(r.quota,true);assert.equal(r.freshAfter,r.fresh);
 console.log('PASS fresh defaults, selective merge, backup, every-launch reset, corrupt settings, unsupported compression, quota failure');
} finally { await browser.close(); await host.close(); }
