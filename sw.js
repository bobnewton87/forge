// Network-first for app code and schedule data (so updates land without cache-busting),
// falling back to cache when offline.
const CACHE = 'forge-v11';
const CORE = ['./', './index.html', './manifest.json', './css/base.css', './css/train.css', './css/plan.css', './css/body2.css', './css/body3d.css', './css/supp.css', './js/main.js', './icons/icon-192.png', './data/crunch-schedule.json', './assets/body/body.json', './assets/body/body.bin'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Cache under the URL without its query string so cache-busting params (?t=…) don't pile up entries.
  const u = new URL(e.request.url); u.search = '';
  const key = u.toString();
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key))
  );
});
