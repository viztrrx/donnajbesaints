/* Optional pack installation for the verified EaglercraftX 1.8 u35 filesystem.
 * Runs before main(), in the game frame's own storage partition. All changes
 * commit together; existing packs, worlds and activation settings are retained.
 */
(function () {
  'use strict';
  var DB_PREFIX = '_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_8_8_';
  var FOLDER = 'agent-console-chromebox-lite-8x';
  var MANIFEST = 'resourcepacks/manifest.json';
  var MARKER = 'resourcepacks/' + FOLDER + '/.agent-console-revision';
  var OWNER = 'agent-console-chromebox-lite';

  window.eaglerPreloadResourcePacks = function (dbName) {
    return new Promise(function (resolve, reject) {
      var pack = window.__eaglerBundledPack;
      var db, tx, finished = false;
      var timer = setTimeout(function () { finish(new Error('Resource-pack storage timed out')); }, 5000);
      function finish(error, state) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error && tx) { try { tx.abort(); } catch (_) { /* already finished */ } }
        if (db) db.close();
        if (error) reject(error); else resolve(state);
      }
      var entries, encoder;
      try {
        if (!pack || pack.format !== 1 || pack.folder !== FOLDER || !/^[a-f0-9]{64}$/.test(pack.revision)) {
          throw new Error('Bundled texture pack is unavailable');
        }
        if (!pack.files || !pack.files['pack.mcmeta']) throw new Error('Bundled texture pack is incomplete');
        encoder = new TextEncoder();
        var size = 0;
        entries = Object.keys(pack.files).map(function (path) {
          if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(path) || path.split('/').some(function (s) { return !s || s === '.' || s === '..'; })) {
            throw new Error('Invalid bundled texture path');
          }
          var binary = atob(pack.files[path]);
          size += binary.length;
          if (size > 1048576) throw new Error('Bundled texture pack is too large');
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return { path: 'resourcepacks/' + FOLDER + '/' + path, data: bytes.buffer };
        });
        var open = indexedDB.open(DB_PREFIX + dbName, 1);
        open.onupgradeneeded = function () {
          if (finished) { open.transaction.abort(); return; }
          // u35 uses a compound key containing the single field "path".
          open.result.createObjectStore('filesystem', { keyPath: ['path'] });
        };
        open.onblocked = function () { finish(new Error('Resource-pack storage is busy')); };
        open.onerror = function () { finish(open.error || new Error('Resource-pack storage unavailable')); };
        open.onsuccess = function () {
          db = open.result;
          if (finished) { db.close(); return; }
          db.onversionchange = function () { db.close(); };
          try {
            tx = db.transaction('filesystem', 'readwrite');
            var store = tx.objectStore('filesystem');
            if (JSON.stringify(store.keyPath) !== '["path"]') throw new Error('Unsupported resource-pack storage format');
            var result = 'available';
            tx.oncomplete = function () { finish(null, result); };
            tx.onabort = function () { finish(tx.error || new Error('Resource-pack installation cancelled')); };
            var read = store.get([MANIFEST]);
            read.onsuccess = function () {
              try {
                // A malformed manifest is not replaced: preserve the user's data.
                var manifest = read.result ? JSON.parse(new TextDecoder().decode(read.result.data)) : { resourcePacks: [] };
                if (!Array.isArray(manifest.resourcePacks)) throw new Error('Invalid existing resource-pack manifest');
                var existing = manifest.resourcePacks.find(function (p) { return p.folder === FOLDER; });
                var marker = store.get([MARKER]);
                marker.onsuccess = function () {
                  try {
                    var previous = marker.result ? JSON.parse(new TextDecoder().decode(marker.result.data)) : null;
                    if (existing && (!previous || previous.owner !== OWNER)) throw new Error('A user pack already uses the bundled pack folder');
                    if (existing && previous.revision === pack.revision) return;
                    entries.forEach(function (row) { store.put(row); });
                    if (!existing) manifest.resourcePacks.push({ folder: FOLDER, name: pack.name, timestamp: Date.now(), domains: ['minecraft'] });
                    store.put({ path: MANIFEST, data: encoder.encode(JSON.stringify(manifest)).buffer });
                    store.put({ path: MARKER, data: encoder.encode(JSON.stringify({ owner: OWNER, revision: pack.revision })).buffer });
                    result = existing ? 'updated' : 'installed';
                  } catch (error) { finish(error); }
                };
              } catch (error) { finish(error); }
            };
          } catch (error) { finish(error); }
        };
      } catch (error) { finish(error); }
    });
  };
})();
