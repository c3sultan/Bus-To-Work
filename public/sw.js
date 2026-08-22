const CACHE = 'bus-to-work-v2-shell';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/.netlify/functions/')) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(c => c.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
