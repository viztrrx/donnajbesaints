// Offline shell and owner notifications for the Saints Service app. Only the
// app's own files are cached (shell, icons and the console script); API
// calls, chat, AI answers and anything from other origins always go to the
// network. Push messages come from the Worker (web/console/push.js).
const CACHE = 'agent-console-app-v3';
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

self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (e) { m = { body: event.data ? event.data.text() : '' }; }
  const title = m.title || 'Saints Service';
  // "Who's online" carries the count for the app icon badge (iOS 16.4+).
  if (typeof m.badge === 'number' && self.navigator && self.navigator.setAppBadge) {
    try { (m.badge > 0 ? self.navigator.setAppBadge(m.badge) : self.navigator.clearAppBadge()).catch(() => {}); } catch (e) { /* unsupported */ }
  }
  event.waitUntil(self.registration.showNotification(title, {
    body: m.body || '',
    tag: m.tag || undefined,
    icon: '/console/icon-192.png',
    badge: '/console/icon-192.png',
    timestamp: m.ts || Date.now(),
    silent: m.silent === true,
    // A newer message for the same chat replaces the old one and still alerts.
    renotify: !!m.tag,
    data: { url: typeof m.url === 'string' && m.url.startsWith('/console/') ? m.url : '/console/' }
  }));
});
// Tapping a notification opens the app on the right tab (chat, admin…).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/console/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const app = list.find((c) => new URL(c.url).pathname.startsWith('/console/'));
    if (app) { app.postMessage({ type: 'agent-console-open', url }); return app.focus(); }
    return self.clients.openWindow(url);
  }));
});
