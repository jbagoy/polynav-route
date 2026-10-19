/**
 * Keeps the phone page working when the signal drops.
 *
 * - The page, map image and the list of destinations are saved when the site is first opened.
 * - Each route is saved the first time it is opened, so it can be reopened offline.
 * - Data is fetched fresh when there is a connection, and from the saved copy when not.
 *
 * 2f6ff129-mvelnu5n is replaced by build-phone-site.js, so every rebuild clears old saved copies.
 */
const CACHE = 'polynav-__BUILD__';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'campus-map.jpg', 'manifest.webmanifest', 'data/index.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('polynav-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isData = new URL(req.url).pathname.includes('/data/');

  if (isData) {
    // Network first, so a republished site shows new routes; saved copy when offline
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }

  // Page files and the map: saved copy first (they only change when the site is rebuilt)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }))
  );
});
