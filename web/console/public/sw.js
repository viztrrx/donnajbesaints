// Offline shell for the Agent Console app. Only the app's own files are
// cached (shell, icons and the console script); API calls, chat, AI answers
// and anything from other origins always go to the network.
const CACHE = 'agent-console-app-v1';
const SHELL = ['/console/', '/console/app.css', '/console/app.js', '/console/manifest.webmanifest',
  '/console/icon-180.png', '/console/icon-192.png', '/console/icon-512.png', '/console/icon-maskable-512.png'];
const SCRIPT = '/console/script.js';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('agent-console-app-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  if (!SHELL.includes(url.pathname) && url.pathname !== SCRIPT) return;
  // Network first, so every launch gets the latest console; the cached copy
  // is the offline fallback.
  event.respondWith(fetch(event.request).then((res) => {
    if (res.ok) { const copy = res.clone(); event.waitUntil(caches.open(CACHE).then((c) => c.put(event.request, copy))); }
    return res;
  }).catch(() => caches.match(event.request).then((hit) => hit || Response.error())));
});
