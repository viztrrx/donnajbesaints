const CACHE='saints-shell-v1';
const SHELL=['/app/','/app/app.css','/app/app.js','/app/model.js','/app/operations.json','/app/manifest.webmanifest','/app/icon-180.png','/app/icon-192.png','/app/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('saints-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||!SHELL.includes(u.pathname)||u.search) return;
 event.respondWith(fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return r;}).catch(()=>caches.match(event.request)));});
