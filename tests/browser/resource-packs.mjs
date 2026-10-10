// Browser storage regressions for the u35 optional bundled-pack installer.
// Run: node tests/browser/resource-packs.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, ROOT } from './harness.mjs';
const host = await serve((req, res) => {
  const name = req.url.slice(1);
  if (['resource-packs.js', 'chromebox-lite.js'].includes(name)) {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(fs.readFileSync(path.join(ROOT, 'eaglercraft/loader', name)));
  } else res.end('<script src="/chromebox-lite.js"></script><script src="/resource-packs.js"></script>');
});
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${host.port}`);
  const results = await page.evaluate(async () => {
    const DB = '_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_8_8_';
    const MANIFEST = 'resourcepacks/manifest.json';
    const folder = 'agent-console-chromebox-lite-8x';
    const marker = 'resourcepacks/' + folder + '/.agent-console-revision';
    const enc = new TextEncoder(), dec = new TextDecoder();
    const open = (name) => new Promise((resolve, reject) => {
      const r = indexedDB.open(DB + name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('filesystem', { keyPath: ['path'] });
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const write = async (name, rows) => {
      const db = await open(name);
      await new Promise((resolve, reject) => {
        const tx = db.transaction('filesystem', 'readwrite');
        rows.forEach(([path, value]) => tx.objectStore('filesystem').put({ path, data: enc.encode(value).buffer }));
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      }); db.close();
    };
    const read = async (name) => {
      const db = await open(name);
      const rows = await new Promise((resolve, reject) => {
        const r = db.transaction('filesystem').objectStore('filesystem').getAll();
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      }); db.close(); return rows;
    };
    const text = (rows, path) => dec.decode(rows.find(r => r.path === path).data);
    const result = {};
    result.fresh = await eaglerPreloadResourcePacks('fresh');
    let rows = await read('fresh');
    result.manifest = JSON.parse(text(rows, MANIFEST));
    result.fileCount = rows.length;
    result.expectedCount = Object.keys(__eaglerBundledPack.files).length + 2;
    result.repeat = await eaglerPreloadResourcePacks('fresh');
    result.repeatCount = (await read('fresh')).length;
    const other = { folder: 'my-pack', name: 'My custom pack', timestamp: 5, domains: ['minecraft'] };
    await write('existing', [[MANIFEST, JSON.stringify({ resourcePacks: [other], keep: 'yes' })], ['resourcepacks/my-pack/pack.mcmeta', 'custom'], ['unrelated', 'retain']]);
    await eaglerPreloadResourcePacks('existing');
    rows = await read('existing');
    result.existing = JSON.parse(text(rows, MANIFEST));
    result.otherFile = text(rows, 'resourcepacks/my-pack/pack.mcmeta');
    result.unrelated = text(rows, 'unrelated');
    __eaglerBundledPack.revision = 'f'.repeat(64);
    result.update = await eaglerPreloadResourcePacks('existing');
    result.updated = JSON.parse(text(await read('existing'), marker)).revision;
    await write('bad', [[MANIFEST, '{broken']]);
    result.badRejected = await eaglerPreloadResourcePacks('bad').then(() => false, () => true);
    result.badCount = (await read('bad')).length;
    await write('collision', [[MANIFEST, JSON.stringify({ resourcePacks: [{ ...other, folder }] })]]);
    result.collisionRejected = await eaglerPreloadResourcePacks('collision').then(() => false, () => true);
    result.collisionCount = (await read('collision')).length;
    result.concurrent = await Promise.all([eaglerPreloadResourcePacks('concurrent'), eaglerPreloadResourcePacks('concurrent')]);
    result.concurrentPacks = JSON.parse(text(await read('concurrent'), MANIFEST)).resourcePacks.length;
    // Simulate a storage/quota failure midway through the writes. No partial
    // textures or modified manifest should survive the transaction abort.
    await write('abort', [[MANIFEST, JSON.stringify({ resourcePacks: [other] })]]);
    const originalPut = IDBObjectStore.prototype.put;
    let writes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (++writes === 3) throw new DOMException('Test quota failure', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
    result.abortRejected = await eaglerPreloadResourcePacks('abort').then(() => false, () => true);
    IDBObjectStore.prototype.put = originalPut;
    result.abortRows = (await read('abort')).length;
    result.abortManifest = JSON.parse(text(await read('abort'), MANIFEST)).resourcePacks;
    return result;
  });
  assert.equal(results.fresh, 'installed');
  assert.equal(results.manifest.resourcePacks[0].name, 'Chromebox Lite 8x');
  assert.equal(results.fileCount, results.expectedCount);
  assert.equal(results.repeat, 'available');
  assert.equal(results.repeatCount, results.fileCount);
  assert.equal(results.existing.resourcePacks.length, 2);
  assert.equal(results.existing.resourcePacks[0].name, 'My custom pack');
  assert.equal(results.existing.keep, 'yes');
  assert.equal(results.otherFile, 'custom');
  assert.equal(results.unrelated, 'retain');
  assert.equal(results.update, 'updated');
  assert.equal(results.updated, 'f'.repeat(64));
  assert.equal(results.badRejected, true); assert.equal(results.badCount, 1);
  assert.equal(results.collisionRejected, true); assert.equal(results.collisionCount, 1);
  assert.deepEqual(results.concurrent.sort(), ['available', 'installed']);
  assert.equal(results.concurrentPacks, 1);
  assert.equal(results.abortRejected, true); assert.equal(results.abortRows, 1);
  assert.equal(results.abortManifest[0].folder, 'my-pack');
  console.log('PASS fresh install, repeat launch, preserve custom packs, update, malformed manifest, folder collision, concurrent launch, atomic rollback');
} finally {
  await browser.close(); await host.close();
}
