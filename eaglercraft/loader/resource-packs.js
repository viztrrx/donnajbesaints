/* Install the original bundled pack into the verified u35 filesystem before
 * main(). Only its own folder is updated; unrelated packs/manifest fields stay.
 * The small pack-config.js is checked each launch; the payload is fetched only
 * when the installed revision is missing/outdated. All writes commit together.
 */
(function () {
  'use strict';
  var DB_PREFIX = '_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_8_8_';
  var MANIFEST = 'resourcepacks/manifest.json';
  var OWNER = 'agent-console-chromebox-lite';
  window.eaglerPreloadResourcePacks = async function (dbName) {
    var cfg = window.__eaglerPackConfig;
    if (!cfg || cfg.format !== 1 || cfg.folder !== 'agent-console-chromebox-lite-8x' || !/^[a-f0-9]{64}$/.test(cfg.revision)) throw new Error('Pack configuration unavailable');
    var base = 'resourcepacks/' + cfg.folder + '/';
    var markerPath = base + '.agent-console-revision';
    var db, transaction, cancelled = false, timer;
    var controller = new AbortController();
    var parse = function (row) { return row ? JSON.parse(new TextDecoder().decode(row.data)) : null; };
    var open = function () { return new Promise(function (resolve, reject) {
      var r = indexedDB.open(DB_PREFIX + dbName, 1);
      r.onupgradeneeded = function () {
        if (cancelled) { r.transaction.abort(); return; }
        r.result.createObjectStore('filesystem', { keyPath: ['path'] });
      };
      r.onblocked = function () { reject(new Error('Resource-pack storage is busy')); };
      r.onerror = function () { reject(r.error || new Error('Resource-pack storage unavailable')); };
      r.onsuccess = function () { if (cancelled) { r.result.close(); return; } db = r.result; resolve(); };
    }); };
    var transact = function (entries) { return new Promise(function (resolve, reject) {
      if (cancelled) { reject(new Error('Installation cancelled')); return; }
      try {
        var tx = transaction = db.transaction('filesystem', entries ? 'readwrite' : 'readonly');
        var store = tx.objectStore('filesystem');
        if (JSON.stringify(store.keyPath) !== '["path"]') throw new Error('Unsupported resource-pack storage format');
        var state = 'available';
        tx.oncomplete = function () { transaction = null; resolve(state); };
        tx.onabort = function () { reject(tx.error || new Error('Resource-pack transaction cancelled')); };
        var read = store.get([MANIFEST]);
        read.onsuccess = function () {
          try {
            var manifest = parse(read.result) || { resourcePacks: [] };
            if (!Array.isArray(manifest.resourcePacks)) throw new Error('Invalid existing resource-pack manifest');
            var existing = manifest.resourcePacks.find(function (p) { return p.folder === cfg.folder; });
            var marker = store.get([markerPath]);
            marker.onsuccess = function () {
              try {
                var previous = parse(marker.result);
                if (existing && (!previous || previous.owner !== OWNER)) throw new Error('A user pack already uses the bundled folder');
                // Include the actual pack metadata in the cache check, so a
                // deleted/incomplete installation cannot masquerade as current.
                var meta = store.get([base + 'pack.mcmeta']);
                meta.onsuccess = function () {
                  try {
                    if (existing && previous.revision === cfg.revision && meta.result) return;
                    if (!entries) { state = 'missing'; return; }
                    entries.forEach(function (row) { store.put(row); });
                    if (!existing) manifest.resourcePacks.push({ folder: cfg.folder, name: cfg.name, timestamp: Date.now(), domains: ['minecraft'] });
                    else existing.name = cfg.name;
                    var encode = function (path, value) { store.put({ path: path, data: new TextEncoder().encode(JSON.stringify(value)).buffer }); };
                    encode(MANIFEST, manifest);
                    encode(markerPath, { owner: OWNER, revision: cfg.revision, version: cfg.version });
                    // Only the old pack's verified invalid name is removed.
                    store.delete([base + 'assets/minecraft/textures/blocks/packed_ice.png']);
                    state = existing ? 'updated' : 'installed';
                  } catch (error) { tx.abort(); reject(error); }
                };
              } catch (error) { tx.abort(); reject(error); }
            };
          } catch (error) { tx.abort(); reject(error); }
        };
      } catch (error) { if (transaction) { try { transaction.abort(); } catch (_) {} } reject(error); }
    }); };
    var work = async function () {
      await open();
      db.onversionchange = function () { db.close(); };
      if (await transact(null) === 'available') return 'available';
      var url = new URL(cfg.url, location.href);
      if (url.origin !== location.origin || !/^\/eagler\/loader\/[A-Za-z0-9_-]+\.json$/.test(url.pathname)) throw new Error('Invalid same-origin pack URL');
      var response = await fetch(url.href, { signal: controller.signal });
      if (!response.ok) throw new Error('Pack download failed: ' + response.status);
      var raw = await response.text();
      if (raw.length > 2097152) throw new Error('Pack bundle too large');
      var pack = JSON.parse(raw);
      if (pack.format !== 1 || pack.folder !== cfg.folder || pack.revision !== cfg.revision || !pack.files || !pack.files['pack.mcmeta']) throw new Error('Pack revision mismatch or incomplete bundle');
      var total = 0;
      var entries = Object.keys(pack.files).map(function (path) {
        if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(path) || path.split('/').some(function (s) { return !s || s === '.' || s === '..'; })) throw new Error('Invalid texture path');
        var binary = atob(pack.files[path]); total += binary.length;
        if (total > 1048576) throw new Error('Pack too large');
        var data = Uint8Array.from(binary, function (c) { return c.charCodeAt(0); });
        return { path: base + path, data: data.buffer };
      });
      if (cancelled) throw new Error('Installation cancelled');
      return transact(entries);
    };
    try {
      return await Promise.race([work(), new Promise(function (_, reject) {
        timer = setTimeout(function () { cancelled = true; controller.abort(); if (transaction) { try { transaction.abort(); } catch (_) {} } reject(new Error('Resource-pack install timed out')); }, 8000);
      })]);
    } finally { cancelled = true; clearTimeout(timer); controller.abort(); if (db) db.close(); }
  };
})();
